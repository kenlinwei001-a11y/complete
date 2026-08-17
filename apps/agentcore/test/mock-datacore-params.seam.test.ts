import { describe, expect, it } from "vitest";
import { MockOntologyClient, MockPromptClient, MockRuleEngineClient, MockSolverClient, createMockDataCore } from "../src/mocks/clients.js";
import { DataCoreRequestCancelledError, type ToolAuthCtx } from "../src/tools/clients.js";
import { createTestApp } from "./helpers.js";

/**
 * WO-MOCKDC-PARAMS · 接缝测试：**mock 收下的形参必须真的被用上**。
 *
 * ── 病灶（本文件要钉死的那件事）────────────────────────────────────────────
 * `MockDataCore` 的三个方法比接口**少写形参**（TS 允许少写形参实现接口，故 mock 的具体类型比契约窄）：
 *   · `queryObjects` 漏第 5 个 `asOfEpoch`   → 「按某时刻读」这个维度在 mock 上**根本不存在**
 *   · `listObjectTypeKeys` 漏 `ctx`          → 租户维度在 mock 上根本不存在
 *   · `listPublishedRuleKeys` 漏 `ctx`       → 同上，规则可引用性这条路上也不存在
 *
 * 形态（照 CLAUDE.md 铁律 0.6 的句式）：
 *   **「我用『测试在 mock 上绿』当作『真后端也会这么行为』的证据，
 *     而 mock 少收了参数 ⇒ 它连那个维度都不存在。」**
 *
 * 这不是洁癖：本仓铁律是 `tenant_id everywhere`（跨租户一律 403/404），而验它的测试若跑在这个 mock 上，
 * 测的是一个**不认租户的世界**；`executor.ts` 明明按并发一致性 §13.1 把 taskEpoch 作第 5 实参注入了
 * （`await this.taskSnapshotEpoch(ctx)`），到 mock 这里被丢弃 ⇒ 时点读恒等于读当前。
 *
 * ── 为什么本文件与 `task-snapshot.test.ts` 不重复 ──────────────────────────
 * 那个文件把 `queryObjects` **打桩**并在桩里丢掉 `asOfEpoch`（`orig(ctx, type, filter, limit)`），
 * 所以它证明的是「执行器**传了**这个参数」，证明不了「mock 会照它返回不同结果」。
 * 本文件**不打桩**，直接驱动同一份 mock 的真实现，咬的是行为而非调用痕迹。
 *
 * ── 变异反证（每条判据都配一条）────────────────────────────────────────────
 * 把补上的形参「改回忽略」（`Degraded*` 类：ctx.tenantId 塌缩成一个桶 / asOfEpoch 直接丢），
 * 判据必须**红**，且红在「跨租户读到了」/「时点没生效」——
 * **不是**红在「函数签名不对」（退化类的签名与契约完全一致，TS 一声不吭）。
 * 这一点是本文件的关键：签名对了但行为没接上，正是「收了假装认」，比「收了不认」更坏。
 */

const A: ToolAuthCtx = { tenantId: "tenant-A", userId: "ua", roles: ["planner"] };
const B: ToolAuthCtx = { tenantId: "tenant-B", userId: "ub", roles: ["planner"] };
/** 出厂种子里没有的类型 —— 保证读到的行只可能来自本测试自己写的那两行。 */
const TYPE = "SecretPlan";
const A_ROW = { objectId: "sp_A", owner: "A", note: "A 的私有计划" };
const B_ROW = { objectId: "sp_B", owner: "B", note: "B 的私有计划" };

/** 退化实参：把 `ctx.tenantId` 塌缩成同一个桶 = 「mock 里没有租户这一维」（本单修复前的世界）。 */
const COLLAPSED = "__no-tenant-dimension__";

/**
 * 变异体：形参**照收**（签名与契约一致，TS 无话可说），但**不理它们**。
 * 这正是「补一个形参然后不理它」的样子，本文件用它来证明判据真的咬得住行为。
 */
class DegradedOntologyClient extends MockOntologyClient {
  override putObjects(ctx: ToolAuthCtx, objectType: string, rows: Record<string, unknown>[], epoch = 0): void {
    super.putObjects({ ...ctx, tenantId: COLLAPSED }, objectType, rows, epoch);
  }
  override async queryObjects(
    ctx: ToolAuthCtx,
    objectType: string,
    filter: Record<string, unknown>,
    limit?: number,
    _asOfEpoch?: number, // ← 收了，丢了
  ) {
    return super.queryObjects({ ...ctx, tenantId: COLLAPSED }, objectType, filter, limit);
  }
  override async listObjectTypeKeys(ctx: ToolAuthCtx): Promise<string[]> {
    return super.listObjectTypeKeys({ ...ctx, tenantId: COLLAPSED });
  }
}

class DegradedRuleEngineClient extends MockRuleEngineClient {
  override publishRule(ctx: ToolAuthCtx, key: string): void {
    super.publishRule({ ...ctx, tenantId: COLLAPSED }, key);
  }
  override async listPublishedRuleKeys(ctx: ToolAuthCtx): Promise<string[]> {
    return super.listPublishedRuleKeys({ ...ctx, tenantId: COLLAPSED });
  }
}

class DegradedSolverClient extends MockSolverClient {
  override async invoke(ctx: ToolAuthCtx, solverKey: string, args: Record<string, unknown>, _signal?: AbortSignal) {
    return super.invoke(ctx, solverKey, args); // ← 收了 signal，丢了
  }
}

// ───────────────────────────── 判据（不成立就抛，消息带明确原因）─────────────────────────────

async function rowIds(onto: MockOntologyClient, ctx: ToolAuthCtx, asOfEpoch?: number): Promise<string[]> {
  const res = await onto.queryObjects(ctx, TYPE, {}, undefined, asOfEpoch);
  return ((res.data as { items: Record<string, unknown>[] }).items ?? []).map((i) => String(i.objectId));
}

/**
 * §1 判据 —— 租户隔离。
 * ⚠ 「B 读到空数组」**不算通过**：那与「本来就没有」分不开。
 * 所以 B 也写自己那行：B 必须**恰好看到自己那行**（证明读路径是通的、不是查询坏了），
 * 且**看不到** A 那行（证明隔离真的存在）。两条缺一不可。
 */
async function assertTenantIsolation(onto: MockOntologyClient): Promise<void> {
  onto.putObjects(A, TYPE, [A_ROW]);
  onto.putObjects(B, TYPE, [B_ROW]);
  const seenByA = await rowIds(onto, A);
  const seenByB = await rowIds(onto, B);

  if (!seenByB.includes("sp_B")) {
    throw new Error(`读路径不通：B 连自己写的行都读不到（seenByB=[${seenByB}]）—— 这不是隔离，是查询坏了`);
  }
  if (!seenByA.includes("sp_A")) {
    throw new Error(`读路径不通：A 连自己写的行都读不到（seenByA=[${seenByA}]）`);
  }
  if (seenByB.includes("sp_A")) {
    throw new Error(`跨租户读到了：B(${B.tenantId}) 读到了 A(${A.tenantId}) 写的行 sp_A（seenByB=[${seenByB}]）`);
  }
  if (seenByA.includes("sp_B")) {
    throw new Error(`跨租户读到了：A(${A.tenantId}) 读到了 B(${B.tenantId}) 写的行 sp_B（seenByA=[${seenByA}]）`);
  }
  // 类型清单层同样隔离：A 建的类型，B 连"有没有这个类型"都不该看到。
  const bTypes = await onto.listObjectTypeKeys(B);
  const aTypes = await onto.listObjectTypeKeys(A);
  if (!aTypes.includes(TYPE) || !bTypes.includes(TYPE)) {
    // 两边都写了同名类型，所以两边都该看得见 —— 这里只是防"类型清单整个塌掉"的自证。
    throw new Error(`类型清单不通：aTypes.includes=${aTypes.includes(TYPE)} bTypes.includes=${bTypes.includes(TYPE)}`);
  }
}

/**
 * §2 判据 —— 时点读。
 * 同一租户、同一类型、同一份数据，**只改 asOfEpoch** ⇒ 返回必须不同。
 * 两条证据（行集 + snapshotVersion），后者与真 DataCore 同形（`${snapshot}@${asOfEpoch}`）。
 */
async function assertAsOfEpoch(onto: MockOntologyClient): Promise<void> {
  onto.putObjects(A, TYPE, [{ objectId: "t1", v: "早" }], 1);
  onto.putObjects(A, TYPE, [{ objectId: "t2", v: "晚" }], 5);

  const at1 = await onto.queryObjects(A, TYPE, {}, undefined, 1);
  const at5 = await onto.queryObjects(A, TYPE, {}, undefined, 5);
  const ids1 = ((at1.data as { items: Record<string, unknown>[] }).items).map((i) => String(i.objectId)).sort();
  const ids5 = ((at5.data as { items: Record<string, unknown>[] }).items).map((i) => String(i.objectId)).sort();

  if (ids1.length === 0) throw new Error("读路径不通：asOfEpoch=1 时点连早于它写入的行都读不到");
  if (JSON.stringify(ids1) === JSON.stringify(ids5)) {
    throw new Error(`时点没生效：asOfEpoch=1 与 asOfEpoch=5 返回了同一批行 [${ids1}]（epoch=5 那行本不该出现在 t=1 的快照里）`);
  }
  if (ids1.includes("t2")) {
    throw new Error(`时点没生效：asOfEpoch=1 的快照里出现了 epoch=5 才写入的行 t2（[${ids1}]）`);
  }
  if (at1.snapshotVersion === at5.snapshotVersion) {
    throw new Error(`时点没生效：snapshotVersion 未随 asOfEpoch 变（两次都是 ${at1.snapshotVersion}）`);
  }
}

// ───────────────────────────── §1 租户隔离 ─────────────────────────────

describe("WO-MOCKDC-PARAMS §1 · ctx 真的被用上：跨租户读不到", () => {
  it("A 写、B 读 ⇒ 读不到 A 的行，且 B 读得到自己的行（区分「隔离」与「本来就没有」）", async () => {
    const onto = new MockOntologyClient();
    await expect(assertTenantIsolation(onto)).resolves.toBeUndefined();

    // 判据之外再显式钉一次形状，便于失败时一眼看出是哪一半塌了。
    expect(await rowIds(onto, A)).toEqual(["sp_A"]);
    expect(await rowIds(onto, B)).toEqual(["sp_B"]);
  });

  it("变异反证：把 ctx.tenantId 改回忽略 ⇒ 判据必红，且红在「跨租户读到了」（不是签名不对）", async () => {
    const degraded = new DegradedOntologyClient();
    // 先证明退化体的读路径仍然是通的 —— 否则"红"可能只是查询坏了，那就不能拿它当反证。
    degraded.putObjects(A, TYPE, [A_ROW]);
    expect(await rowIds(degraded, A)).toEqual(["sp_A"]);

    const fresh = new DegradedOntologyClient();
    await expect(assertTenantIsolation(fresh)).rejects.toThrow(/跨租户读到了/);
  });

  it("规则可引用性同样认租户：A 发布的规则 key，B 的 listPublishedRuleKeys 里查不到", async () => {
    const rules = new MockRuleEngineClient();
    rules.publishRule(A, "C99_A_ONLY");
    const aKeys = await rules.listPublishedRuleKeys(A);
    const bKeys = await rules.listPublishedRuleKeys(B);
    expect(aKeys).toContain("C99_A_ONLY");
    expect(bKeys).not.toContain("C99_A_ONLY");
    // 出厂夹具集两边都在 ⇒ B 的"查不到"是隔离，不是"规则库整个空了"。
    expect(bKeys).toContain("C03");
    // 元数据投影从 keys 派生 ⇒ 租户维度自然贯通，过滤语义无处漂移。
    expect((await rules.listPublishedRules(B)).map((r) => r.key)).not.toContain("C99_A_ONLY");
    expect((await rules.listPublishedRules(A)).map((r) => r.key)).toContain("C99_A_ONLY");
  });

  it("变异反证：把 listPublishedRuleKeys 的 ctx 改回忽略 ⇒ B 读到了 A 的规则", async () => {
    const degraded = new DegradedRuleEngineClient();
    degraded.publishRule(A, "C99_A_ONLY");
    expect(await degraded.listPublishedRuleKeys(A)).toContain("C99_A_ONLY"); // 读路径通
    expect(await degraded.listPublishedRuleKeys(B)).toContain("C99_A_ONLY"); // ← 跨租户读到了
  });

  it("经真执行器驱动（不打桩）：A 私有类型对 B 触发 UNKNOWN_TYPE 守卫 —— R2 贯到 query_objects 生产路径", async () => {
    const t = await createTestApp();
    t.dataCore.ontology.putObjects(A, TYPE, [A_ROW]);

    const exA = t.deps.engine.makeExecutor("mockdc_params_a", A);
    const resA = await exA.run("query_objects", { objectType: TYPE, filter: {} });
    expect(resA.ok).toBe(true);
    expect((resA.payload as { data: { items: { objectId: string }[] } }).data.items.map((i) => i.objectId)).toEqual(["sp_A"]);

    const exB = t.deps.engine.makeExecutor("mockdc_params_b", B);
    const resB = await exB.run("query_objects", { objectType: TYPE, filter: {} });
    // 守卫走的是 listObjectTypeKeys(ctx)：B 的类型清单里没有 A 私有的类型 ⇒ 不是"空结果"，是"没这个类型"。
    expect((resB.payload as { error?: string }).error).toBe("UNKNOWN_TYPE");
  });
});

// ───────────────────────────── §2 时点读 ─────────────────────────────

describe("WO-MOCKDC-PARAMS §2 · asOfEpoch 真的被用上：同数据不同时点返回不同", () => {
  it("同一份数据带不同 asOfEpoch ⇒ 行集与 snapshotVersion 都不同", async () => {
    const onto = new MockOntologyClient();
    await expect(assertAsOfEpoch(onto)).resolves.toBeUndefined();

    const at1 = await onto.queryObjects(A, TYPE, {}, undefined, 1);
    const at5 = await onto.queryObjects(A, TYPE, {}, undefined, 5);
    const live = await onto.queryObjects(A, TYPE, {});
    expect((at1.data as { total: number }).total).toBe(1);
    expect((at5.data as { total: number }).total).toBe(2);
    expect((live.data as { total: number }).total).toBe(2); // 不给 asOfEpoch = 读当前
    // snapshotVersion 与真 DataCore 同形（ontology.ts: `${snapshot}@${asOfEpoch}`）——「时点读」有外部可见证据。
    expect(at1.snapshotVersion).toMatch(/@1$/);
    expect(at5.snapshotVersion).toMatch(/@5$/);
    expect(live.snapshotVersion).not.toMatch(/@/);
  });

  it("同一行的多个版本：asOfEpoch 取 epoch<=asOfEpoch 的最新版（镜像 datacore objectAsOf）", async () => {
    const onto = new MockOntologyClient();
    onto.putObjects(A, TYPE, [{ objectId: "x", oee: 0.7 }], 1);
    onto.putObjects(A, TYPE, [{ objectId: "x", oee: 0.9 }], 9);
    const older = (await onto.queryObjects(A, TYPE, {}, undefined, 3)).data as { items: { oee: number }[] };
    const newer = (await onto.queryObjects(A, TYPE, {}, undefined, 9)).data as { items: { oee: number }[] };
    expect(older.items[0]?.oee).toBe(0.7);
    expect(newer.items[0]?.oee).toBe(0.9);
  });

  it("变异反证：把 asOfEpoch 改回忽略 ⇒ 判据必红，且红在「时点没生效」（不是签名不对）", async () => {
    const degraded = new DegradedOntologyClient();
    // 先证明退化体的读路径仍然通（否则"红"可能只是查询坏了）。
    degraded.putObjects(A, TYPE, [{ objectId: "t1", v: "早" }], 1);
    expect(await rowIds(degraded, A, 1)).toEqual(["t1"]);

    const fresh = new DegradedOntologyClient();
    await expect(assertAsOfEpoch(fresh)).rejects.toThrow(/时点没生效/);
  });

  it("经真执行器驱动（不打桩）：执行器注入的 taskEpoch 真的改变了 mock 的返回", async () => {
    const t = await createTestApp();
    // 该类型下：epoch=1 写一行、epoch=9 写一行。
    t.dataCore.ontology.putObjects(A, TYPE, [{ objectId: "early", v: 1 }], 1);
    t.dataCore.ontology.putObjects(A, TYPE, [{ objectId: "late", v: 2 }], 9);

    // 任务 1 的 taskEpoch = 5 ⇒ 只应看到 early；任务 2 的 taskEpoch = 100 ⇒ 两行都看到。
    let epoch = 5;
    t.dataCore.epoch.current = async () => ({ epoch });
    const ex1 = t.deps.engine.makeExecutor("mockdc_asof_1", A);
    const r1 = await ex1.run("query_objects", { objectType: TYPE, filter: {} });
    epoch = 100;
    const ex2 = t.deps.engine.makeExecutor("mockdc_asof_2", A);
    const r2 = await ex2.run("query_objects", { objectType: TYPE, filter: {} });

    const ids = (r: typeof r1) => (r.payload as { data: { items: { objectId: string }[] } }).data.items.map((i) => i.objectId);
    expect(ids(r1)).toEqual(["early"]);
    expect(ids(r2)).toEqual(["early", "late"]);
    // 「任务级快照」在 mock 上不再是空词：两个任务读同一份数据得到不同结果。
    expect(ids(r1)).not.toEqual(ids(r2));
  });
});

// ───────────────────────────── §3 同族形参（普查一并补上的那几个）─────────────────────────────

describe("WO-MOCKDC-PARAMS §3 · 同族普查补齐的形参同样被用上", () => {
  it("MockSolverClient.invoke 收下 signal：已 abort ⇒ DataCoreRequestCancelledError（499 SOLVER_CANCELLED）", async () => {
    const solver = new MockSolverClient();
    const ac = new AbortController();
    ac.abort();
    await expect(solver.invoke(A, "capacity_forecast", { modelId: "M1" }, ac.signal)).rejects.toBeInstanceOf(DataCoreRequestCancelledError);
    // 未取消的照常返回（不是"一律抛"那种假实现）。
    const ok = await solver.invoke(A, "capacity_forecast", { modelId: "M1" }, new AbortController().signal);
    expect(ok.snapshotVersion).toBeTruthy();
  });

  it("变异反证：把 signal 改回忽略 ⇒ 已 abort 也照样返回结果（「取消」这个维度消失）", async () => {
    const degraded = new DegradedSolverClient();
    const ac = new AbortController();
    ac.abort();
    const res = await degraded.invoke(A, "capacity_forecast", { modelId: "M1" }, ac.signal);
    expect(res.snapshotVersion).toBeTruthy(); // 没抛 —— 这就是「收了不认」的样子
  });

  it("MockPromptClient.invalidatePromptTemplate 收下 tenantId：入台账，可断言钩子传没传对", () => {
    const prompts = new MockPromptClient();
    prompts.invalidatePromptTemplate("tenant-A");
    prompts.invalidatePromptTemplate();
    expect(prompts.invalidated).toEqual(["tenant-A", undefined]);
  });

  it("listObjectTypeDefs / listObjectTypes 同样认租户（与 listObjectTypeKeys 同源）", async () => {
    const dc = createMockDataCore();
    dc.ontology.putObjects(A, TYPE, [A_ROW]);
    const aDefs = (await dc.ontology.listObjectTypeDefs(A)).map((d) => d.key);
    const bDefs = (await dc.ontology.listObjectTypeDefs(B)).map((d) => d.key);
    expect(aDefs).toContain(TYPE);
    expect(bDefs).not.toContain(TYPE);
    // 出厂夹具两边都在 ⇒ B 的"没有"是隔离，不是"投影整个空了"。
    expect(bDefs).toContain("Base");

    const aTypes = (await dc.ontology.listObjectTypes(A)).map((t) => t.key);
    const bTypes = (await dc.ontology.listObjectTypes(B)).map((t) => t.key);
    expect(aTypes).toContain(TYPE);
    expect(bTypes).not.toContain(TYPE);
  });

  it("出厂种子行仍是租户无关夹具（诚实边界·G-MOCK-OVERCLAIM 已挂账，勿静默扩大）", async () => {
    const onto = new MockOntologyClient();
    const basesA = (await onto.queryObjects(A, "Base", {})).data as { total: number };
    const basesB = (await onto.queryObjects(B, "Base", {})).data as { total: number };
    expect(basesA.total).toBeGreaterThan(0);
    // 这一条**故意**断言"两个租户看到同样的种子" —— 它是残余分叉的书面证据，不是通过项。
    // 哪天种子改成按租户隔离，这条会红，红了就该连同本体 §8 的挂账一起改，而不是把断言删掉。
    expect(basesB.total).toBe(basesA.total);
  });
});
