import { describe, expect, it } from "vitest";
import { createMockDataCore } from "../src/mocks/clients.js";
import { DataCoreRequestCancelledError, type ToolAuthCtx } from "../src/tools/clients.js";

/**
 * WO-MOCKDC-SIGNATURE · **接缝门**：`MockDataCore` 收下的 `ctx` / `asOfEpoch` / `signal`
 * 必须**真的改变行为**，不是签名对齐了就算完。
 *
 * ## 这道门在防哪一种假绿
 *
 * 形态（照铁律 0.6 句式）：
 * > **「我用『mock 实现了这个接口』当作『mock 遵守这个接口的语义』的证据，而前者并不度量后者。」**
 *
 * TypeScript **允许实现方比接口少写形参**（形参个数少是合法子类型），所以 `implements` 与
 * `const m: DataCoreClient = {...}` 都一声不吭。后果不是「类型不严」，是**语义被静默改写**：
 *  · 漏 `ctx`       ⇒ 收了租户上下文却不认 ⇒ **mock 里跨租户是通的**（违 `tenant_id everywhere`）；
 *  · 漏 `asOfEpoch` ⇒ 收了时点却不认     ⇒ **读历史时点 == 读当前**（违 A8 / §13.1 任务快照）；
 *  · 漏 `signal`    ⇒ 收了取消信号却不认 ⇒ **取消永远无效**（违 WO-D1 取消传导）。
 * 它**专门骗测试**：任何拿本 mock 验这三件事的用例，验的都是一个不看这些参数的替身。
 *
 * ## 两道门是分工的，缺一不可
 *
 * ① **编译期**（`src/mocks/signature-parity.ts` + `clients.ts` 底部的 `MockDataCoreParamParity`）：
 *    少写形参 ⇒ `tsc` 直接点名方法名。防的是「**签名再漂回去**」。
 * ② **运行期**（本文件）：形参收了但**不用** ⇒ 断言红。防的是「签名对了、形同虚设」——
 *    这是同一个病换个位置，光靠 ① 挡不住（形参写了不用，`tsc` 照样绿）。
 *
 * ## 实测基线（2026-08-17，整套 agentcore 插桩 4097 次调用）
 * 补齐前**1099 次实参被静默丢弃**：`queryObjects` 收 argc=5 共 149 次（第 5 个 `asOfEpoch` 丢），
 * `listObjectTypeDefs` / `listPublishedRules` 各收 argc=1 共 323 次（`ctx` 丢），
 * `solver.invoke` 收 argc=4 共 16 次（`signal` 丢），`epoch.current` 87 次（`ctx` 丢）。
 */

const ctxOf = (tenantId: string): ToolAuthCtx =>
  ({ tenantId, userId: "u1", roles: ["planner"] }) as unknown as ToolAuthCtx;

const A = ctxOf("tenant-a");
const B = ctxOf("tenant-b");

describe("WO-MOCKDC-SIGNATURE · ctx 承重：租户私有数据跨租户不可见（R2 · tenant_id everywhere）", () => {
  it("对象类型：A 建的私有类型，B 一个都看不到（listObjectTypeDefs / Keys / listObjectTypes 三个出口同守）", async () => {
    const dc = createMockDataCore();
    dc.ontology.addTypeForTenant(A, {
      key: "__TenantAOnly",
      displayName: "A 租户私有类型",
      description: "R2 探针",
      status: "ACTIVE",
      properties: [{ propKey: "probeNum", dataType: "number", description: "探针数值" }],
    });

    // A 看得见（证探针本身有效——否则下面 B 看不见就成了「什么都没建」的假绿）。
    expect((await dc.ontology.listObjectTypeDefs(A)).map((d) => d.key)).toContain("__TenantAOnly");
    expect(await dc.ontology.listObjectTypeKeys(A)).toContain("__TenantAOnly");
    expect((await dc.ontology.listObjectTypes(A)).map((t) => t.key)).toContain("__TenantAOnly");

    // B 看不见 —— 拆掉租户过滤这一行，本断言红在「读到了别的租户的数据」。
    expect((await dc.ontology.listObjectTypeDefs(B)).map((d) => d.key)).not.toContain("__TenantAOnly");
    expect(await dc.ontology.listObjectTypeKeys(B)).not.toContain("__TenantAOnly");
    expect((await dc.ontology.listObjectTypes(B)).map((t) => t.key)).not.toContain("__TenantAOnly");

    // getTypeSemantics 同守（field 投影的属性口径源，漏了它 B 就能读到 A 的字段口径）。
    expect((await dc.ontology.getTypeSemantics(B, ["__TenantAOnly"])).types).toEqual([]);
    expect((await dc.ontology.getTypeSemantics(A, ["__TenantAOnly"])).types).toHaveLength(1);
  });

  it("对象行：A 写的私有行，B 的 queryObjects 读不到", async () => {
    const dc = createMockDataCore();
    dc.ontology.addObjectForTenant(A, "Base", { objectId: "base_a_secret", name: "A私有基地", util: 0.9, gwh: 1 });

    const seen = async (ctx: ToolAuthCtx): Promise<string[]> => {
      const p = await dc.ontology.queryObjects(ctx, "Base", {});
      return (p.data as { items: Record<string, unknown>[] }).items.map((i) => String(i.objectId));
    };
    expect(await seen(A)).toContain("base_a_secret");
    expect(await seen(B)).not.toContain("base_a_secret");
    // 出厂共享集对两边同构（这是忠实的"每租户都跑过 seed"，不是泄漏）——防把过滤做成"B 什么都看不见"。
    expect((await seen(B)).length).toBeGreaterThan(0);
  });

  it("规则：A 置为草稿的规则只在 A 消失，B 仍可引用（listPublishedRuleKeys / listPublishedRules 同守）", async () => {
    const dc = createMockDataCore();
    dc.rules.setDraftForTenant(A, "C03");

    expect(await dc.rules.listPublishedRuleKeys(A)).not.toContain("C03");
    expect(await dc.rules.listPublishedRuleKeys(B)).toContain("C03");
    expect((await dc.rules.listPublishedRules(A)).map((r) => r.key)).not.toContain("C03");
    expect((await dc.rules.listPublishedRules(B)).map((r) => r.key)).toContain("C03");
  });

  it("epoch 是租户级的：A 写入只进位 A 的 epoch，B 不受影响", async () => {
    const dc = createMockDataCore();
    const before = await dc.epoch.current(B);
    dc.ontology.addObjectForTenant(A, "Base", { objectId: "base_a2", name: "A2" });
    expect((await dc.epoch.current(A)).epoch).toBeGreaterThan(before.epoch);
    expect((await dc.epoch.current(B)).epoch).toBe(before.epoch);
  });
});

describe("WO-MOCKDC-SIGNATURE · asOfEpoch 承重：给不给行为不同（§13.1 任务级快照读）", () => {
  it("时点早于写入 ⇒ 读不到那行；不给时点 ⇒ 读活数据", async () => {
    const dc = createMockDataCore();
    const e0 = (await dc.epoch.current(A)).epoch; // 写入前的时点
    const eWrite = dc.ontology.addObjectForTenant(A, "Base", { objectId: "base_late", name: "后写入的基地" });
    expect(eWrite).toBeGreaterThan(e0);

    const ids = async (asOf?: number): Promise<string[]> => {
      const p = await dc.ontology.queryObjects(A, "Base", {}, undefined, asOf);
      return (p.data as { items: Record<string, unknown>[] }).items.map((i) => String(i.objectId));
    };

    // 头号判据：**同一次调用，只因第 5 个形参不同而结果不同**。
    // mock 漏掉 asOfEpoch 的那个版本里，下面三行的结果完全一样 —— 那就是「读历史 == 读当前」。
    expect(await ids(e0)).not.toContain("base_late"); // 钉在写入前的时点：看不见
    expect(await ids(eWrite)).toContain("base_late"); // 钉在写入时点：看得见
    expect(await ids(undefined)).toContain("base_late"); // 不钉时点：活数据
  });

  it("执行器注入的 taskEpoch 与 mock 真正咬合：任务钉住时点后，新写入对该任务不可见", async () => {
    const dc = createMockDataCore();
    // 模拟执行器 tools/executor.ts:106 首读捕获 → :378 逐读注入同一 taskEpoch。
    const taskEpoch = (await dc.epoch.current(A)).epoch;
    dc.ontology.addObjectForTenant(A, "Base", { objectId: "base_after_snapshot", name: "快照之后写入" });

    const pinned = await dc.ontology.queryObjects(A, "Base", {}, undefined, taskEpoch);
    const live = await dc.ontology.queryObjects(A, "Base", {});
    const idsOf = (p: typeof live): string[] => // merge 层销债：live 已 await，Awaited<ReturnType<…>> 是函数型语法误用（c4e2df8d8 携带债，tsc TS2344）
      (p.data as { items: Record<string, unknown>[] }).items.map((i) => String(i.objectId));

    expect(idsOf(pinned)).not.toContain("base_after_snapshot");
    expect(idsOf(live)).toContain("base_after_snapshot");
  });
});

describe("WO-MOCKDC-SIGNATURE · signal 承重：取消真的取消（WO-D1）", () => {
  it("已 abort 的 solver.invoke 抛 DataCoreRequestCancelledError（与生产同错误类型），不返回结果", async () => {
    const dc = createMockDataCore();
    const ac = new AbortController();
    ac.abort();
    await expect(dc.solver.invoke(A, "capacity_forecast", {}, ac.signal)).rejects.toBeInstanceOf(
      DataCoreRequestCancelledError,
    );
    // 未取消照常返回（防把门做成"恒抛"）。
    await expect(dc.solver.invoke(A, "capacity_forecast", {})).resolves.toBeDefined();
    await expect(dc.solver.invoke(A, "capacity_forecast", {}, new AbortController().signal)).resolves.toBeDefined();
  });
});

describe("WO-MOCKDC-SIGNATURE · 诚实标注的两处（不假装承重）", () => {
  it("invalidatePromptTemplate：mock 无缓存故无副作用，但 tenantId 留痕可断言", () => {
    const dc = createMockDataCore();
    dc.prompts.invalidatePromptTemplate("tenant-a");
    dc.prompts.invalidatePromptTemplate();
    expect(dc.prompts.invalidations).toEqual(["tenant-a", undefined]);
  });

  it("queryMetaOntology：元本体是平台级、对所有租户同一份（这是真值，不是漏过滤）；缺租户上下文即拒", async () => {
    const dc = createMockDataCore();
    expect(await dc.ontology.queryMetaOntology(A)).toEqual(await dc.ontology.queryMetaOntology(B));
    await expect(dc.ontology.queryMetaOntology(undefined as unknown as ToolAuthCtx)).rejects.toThrow(/租户上下文/);
  });
});
