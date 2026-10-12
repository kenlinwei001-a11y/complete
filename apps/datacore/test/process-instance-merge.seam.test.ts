import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROCESS_INSTANCE_ORIGINS,
  PROCESS_TASK_WAIT_STATES,
  PROCESS_WAIT_KINDS,
  ProcessInstanceSchema,
  processInstanceId,
} from "@platform/contracts";
import { DEMO_TENANT, seedDemoProcessLayer } from "../src/seed.js";
import { reconstructAndPersist } from "../src/process/reconstruct.js";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-R9-PROCESS-MERGE · **合并本身的接缝门**（SEAM-GATE）。
 *
 * ══ 为什么两侧各自全绿证明不了合并成立 ═══════════════════════════════════════
 *
 * 合并前两张工单各做了一份 `ProcessInstance`，**两边的测试都是绿的**：
 *   · `process-instance.test.ts` 23/23（运行时半）
 *   · `process-flow-time.seam.test.ts` 11/11（反推半）
 * 但**没有一条测试让两半同时落在同一张表上**——而那正是它们唯一会互相伤害的地方。
 * 这是本仓「绿测试 ≠ 能用 · 断在接缝」的标准形态：两半各自测得很细，接缝一条不测。
 *
 * 本文件专测接缝，头号断言是 ①：**同一个 `(租户, P##, 承载对象)` 被两个引擎各写一次，
 * 两行都必须活下来**。合并前这条**必然红**——两边的 id 生成式逐字节相同：
 *   · `process/runtime.ts` ── `` `pinst_${tenantId}_${def.key}_${subjectRef.objectId}` ``
 *   · contracts 反推器 ───── `` `pinst_${input.tenantId}_${st.processKey}_${obj.id}` ``
 * 后写的那行会把先写的**静默覆盖**掉，没有任何报错。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_APP = join(__dirname, "..");

/** 与 `process-instance.test.ts` 同一条暗发门（`process.runtime` defaultOn:false）。 */
async function enableRuntime(t: TestApp) {
  await t.repos.featureConfigs.put({
    id: `fcfg_${DEMO_TENANT}`,
    tenantId: DEMO_TENANT,
    overrides: { "process.runtime": true },
    configVersion: 1,
    updatedBy: "test",
    updatedAt: "2026-03-01T00:00:00.000Z",
  });
}

describe("WO-R9-PROCESS-MERGE · 两份 ProcessInstance 合并后的接缝", () => {
  // ══════════════════════════════════════════════════════════════════════════
  // ① 头号接缝：两个引擎写同一个 (租户, P##, 承载对象)，两行都要活下来
  // ══════════════════════════════════════════════════════════════════════════
  it("① 同一 (租户,P##,承载对象) 两个产地各写一行 ⇒ 两行并存，谁都没被静默覆盖", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoProcessLayer(t.repos);
    await enableRuntime(t);

    // 先跑反推，拿一条**真的**反推出来的实例（不喂 fixture —— 那测的是"我抄得对不对"）
    const out = await reconstructAndPersist(t.repos, DEMO_TENANT);
    const derived = out.instances.find((i) => i.processKey === "P35");
    expect(derived, "P35 应能从真种子反推出实例；取不到说明前置断了，本条什么都没证明").toBeTruthy();
    const { processKey, carrierObjectId, carrierTypeKey } = derived!;

    // 再用运行时引擎，在**同一个** (租户, P##, 承载对象) 上建一条 MANAGED 实例。
    // ⚠ 走真端点而不是直接 put 仓储：要驱动的是**生产链路**，不是我手搓两行 doc。
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/process-instances",
      headers: ADMIN,
      payload: {
        definitionKey: processKey,
        subjectRef: { typeKey: carrierTypeKey, objectId: carrierObjectId },
        tasks: [{ name: "复检判定", ownerFunctionKey: "quality" }],
      },
    });
    expect(created.statusCode, created.body).toBe(200);

    // 🔴 判据：两行**同时**在表里，且 id 不同、产地不同、key 相同（key 认的是"哪个流程作用在哪个对象"）。
    const rows = await t.repos.processInstances.list(
      DEMO_TENANT,
      (i) => i.processKey === processKey && i.carrierObjectId === carrierObjectId,
    );
    expect(rows.length, "两个产地各一行 —— 少一行就是被静默覆盖了（合并前必然如此）").toBe(2);
    const byOrigin = new Map(rows.map((r) => [r.origin, r]));
    expect([...byOrigin.keys()].sort()).toEqual(["DERIVED_FROM_DOCUMENT", "MANAGED"]);
    expect(byOrigin.get("DERIVED_FROM_DOCUMENT")!.id).not.toBe(byOrigin.get("MANAGED")!.id);
    expect(byOrigin.get("DERIVED_FROM_DOCUMENT")!.key).toBe(byOrigin.get("MANAGED")!.key);

    // 🐤 金丝雀：证明"两个 id 不同"不是因为我随便挑了两个不相干的对象 ——
    // 若把 origin 从 id 里抽掉，两个产地拼出来的就是**同一个串**（这就是合并前的原状）。
    const naive = `pinst_${DEMO_TENANT}_${processKey}_${carrierObjectId}`;
    expect(byOrigin.get("DERIVED_FROM_DOCUMENT")!.id, "反推支必须与合并前逐字节一致（幂等覆盖靠它）").toBe(naive);
    expect(byOrigin.get("MANAGED")!.id, "运行时支必须与那个串不同，否则就是撞车").not.toBe(naive);

    // 再跑一遍反推：幂等（覆盖同一行不堆行），且**不许把运行时那一行冲掉**
    await reconstructAndPersist(t.repos, DEMO_TENANT);
    const rows2 = await t.repos.processInstances.list(
      DEMO_TENANT,
      (i) => i.processKey === processKey && i.carrierObjectId === carrierObjectId,
    );
    expect(rows2.length, "重跑反推后仍是两行：既不堆行，也不冲掉运行时那一行").toBe(2);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ② 合并新立的诚实位：waitState 那一格是"模板抄的"还是"gate 判的"，必须分得出
  // ══════════════════════════════════════════════════════════════════════════
  it("② waitStateOrigin 真的按产地分流：反推=DEFINITION_TEMPLATE，运行时=TASK_GATE（且带 waitRef）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoProcessLayer(t.repos);
    await enableRuntime(t);
    const out = await reconstructAndPersist(t.repos, DEMO_TENANT);

    // 反推侧：卡着的实例，等待态**只能**标模板出处 —— 单据上没有"在等什么"这个事实。
    const stuckDerived = out.instances.filter((i) => i.exitedAt === null);
    expect(stuckDerived.length, "P47 只记 inspectDate 一端 ⇒ 应有一批未出站实例").toBeGreaterThan(0);
    for (const i of stuckDerived) {
      expect(i.waitStateOrigin).toBe("DEFINITION_TEMPLATE");
      // 模板抄来的等待类型说不出"具体是哪一张单" ⇒ 不许有 waitRef（契约 superRefine 也挡）
      expect(Object.hasOwn(i, "waitRef"), "模板出处不该带 waitRef").toBe(false);
      // 且值必须落在**模板四值**里（反推侧不会产生 WAITING_APPROVAL）
      expect(PROCESS_WAIT_KINDS as readonly string[]).toContain(i.waitState);
    }
    // 已出站的两个字段同为 null（同生共死，由契约锁死）
    for (const i of out.instances.filter((x) => x.exitedAt !== null)) {
      expect(i.waitState).toBeNull();
      expect(i.waitStateOrigin).toBeNull();
    }

    // 运行时侧：gate 判出来的现场值 + 具体卡在哪张审批单
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/process-instances",
      headers: ADMIN,
      payload: {
        definitionKey: "P17",
        subjectRef: { typeKey: "Order", objectId: "ord_merge_1" },
        tasks: [{ name: "信用超额审批", ownerFunctionKey: "finance", gate: { requiresApprovalOf: "adraft_x1" } }],
      },
    });
    expect(created.statusCode, created.body).toBe(200);
    const inst = (created.json() as { instance: Record<string, unknown> }).instance;
    expect(inst.status).toBe("WAITING");
    expect(inst.waitState).toBe("WAITING_APPROVAL"); // 第五值 —— 只有运行时侧产得出
    expect(inst.waitStateOrigin).toBe("TASK_GATE");
    expect(inst.waitRef).toBe("adraft_x1"); // 现场值答得出「具体是哪一张单」，模板值答不出
    // 五值词表是模板四值的**派生**：第五值只在实例层出现，模板层 waitKind 一个字没动
    expect(PROCESS_TASK_WAIT_STATES.slice(0, 4)).toEqual([...PROCESS_WAIT_KINDS]);
    expect(PROCESS_WAIT_KINDS as readonly string[]).not.toContain("WAITING_APPROVAL");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ③ 卡点投影按产地收窄，且**被排除的那批不许静默消失**
  // ══════════════════════════════════════════════════════════════════════════
  it("③ /process-instances/stuck 只答 MANAGED，但把反推侧卡着的条数如实报出来（derivedStuckCount）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoProcessLayer(t.repos);
    await enableRuntime(t);
    await reconstructAndPersist(t.repos, DEMO_TENANT);

    const res = await t.app.inject({ method: "GET", url: "/a/v1/process-instances/stuck", headers: ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { stuck: unknown[]; derivedStuckCount: number };

    // 反推侧确有一批卡着的（否则本条什么都没证明 —— 金丝雀）
    const derivedStuck = await t.repos.processInstances.list(
      DEMO_TENANT,
      (i) => i.status === "WAITING" && i.origin === "DERIVED_FROM_DOCUMENT",
    );
    expect(derivedStuck.length, "金丝雀：反推侧应有卡着的实例；为 0 则下面两条断言是空的").toBeGreaterThan(0);

    // 🔴 它们**进不了** stuck[]（没有"第几步"，编一个步名就是造假）……
    expect(body.stuck.length).toBe(0);
    // ……但**必须被报出来**。不报数 = 把「本投影没算它们」伪装成「它们不存在」。
    expect(body.derivedStuckCount).toBe(derivedStuck.length);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ④ id 单一产地：全仓不许再有第二处手拼 `pinst_` 模板串
  // ══════════════════════════════════════════════════════════════════════════
  it("④ 手拼 pinst_ 的地方只许有一处（= processInstanceId 自己），合并前正是两处各拼一份才撞的车", async () => {
    /** 手拼判据：模板字符串里出现 `pinst_` 且紧跟一个 `${` 插值。注释行不算（点名这条红线是好事）。 */
    const HANDROLLED = /`pinst_[^`]*\$\{/;
    /** 只留代码行（注释里出现这条红线是**好事**，读它才是坏事 —— 同 ③ 那条 stdDurationDays 门的判据）。 */
    const codeLines = (src: string) =>
      src
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => !l.startsWith("*") && !l.startsWith("//") && !l.startsWith("/*"));

    // 🐤 金丝雀与主逻辑**共用同一个正则**（各抄一份就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿）。
    expect(HANDROLLED.test("`pinst_${tenantId}_${key}_${objectId}`"), "金丝雀不中 ⇒ 正则坏了，下面的 0 命中什么都没证明").toBe(true);
    expect(HANDROLLED.test("processInstanceId(origin, tenantId, processKey, objectId)")).toBe(false);

    // ── (a) 消费方**一处都不许有**（合并前 runtime.ts 就是在这里拼的那一份）─────
    for (const f of [
      join(REPO_APP, "src/process/runtime.ts"),
      join(REPO_APP, "src/process/reconstruct.ts"),
      join(REPO_APP, "../../packages/contracts/src/process-runtime.ts"),
    ]) {
      const hits = codeLines(await readFile(f, "utf8")).filter((l) => HANDROLLED.test(l));
      expect(hits, `${f} 里有手拼的 pinst_ 模板串 ⇒ 第二个 id 产地回来了：${hits.join(" | ")}`).toEqual([]);
    }

    // ── (b) 契约里只许 `processInstanceId` 函数体内有 —— 「唯一产地」正是这个命题 ──
    // 判据不是"契约里 0 命中"（那会把产地自己也判掉，是把门写错了），
    // 而是"**把产地那段挖掉之后** 0 命中"。
    const contract = await readFile(join(REPO_APP, "../../packages/contracts/src/process-instance.ts"), "utf8");
    const start = contract.indexOf("export function processInstanceId(");
    expect(start, "金丝雀：找不到产地函数 ⇒ 抽取器坏了，不是「契约干净」").toBeGreaterThan(-1);
    const end = contract.indexOf("\n}", start);
    expect(end).toBeGreaterThan(start);
    const producer = contract.slice(start, end);
    const rest = contract.slice(0, start) + contract.slice(end);
    // 🐤 金丝雀：产地那段里**必须**有命中（没有的话下面那个 0 是因为整个仓库都没这个串，什么都没证明）
    expect(codeLines(producer).filter((l) => HANDROLLED.test(l)).length, "产地函数体内应有手拼串；为 0 ⇒ 抽取窗口切错了").toBeGreaterThan(0);
    const restHits = codeLines(rest).filter((l) => HANDROLLED.test(l));
    expect(restHits, `产地函数之外还有手拼的 pinst_：${restHits.join(" | ")}`).toEqual([]);
    // 正向：唯一产地真的在按 origin 分流（不是三档都回同一个串）
    const a = processInstanceId("DERIVED_FROM_DOCUMENT", "demo", "P35", "obj1");
    const b = processInstanceId("MANAGED", "demo", "P35", "obj1");
    const c = processInstanceId("MEASURED", "demo", "P35", "obj1");
    expect(new Set([a, b, c]).size, "三档必须两两不同，否则合并只是把撞车挪了个地方").toBe(3);
    expect(a).toBe("pinst_demo_P35_obj1"); // 反推支逐字节冻结（幂等覆盖靠它）
    expect(PROCESS_INSTANCE_ORIGINS.length).toBe(3);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑤ 契约的跨字段不变量是**机器**在管，不是注释在管（各给一个证伪样例）
  // ══════════════════════════════════════════════════════════════════════════
  it("⑤ superRefine 三条不变量各能被证伪：编的溯源 / 缺出处 / 模板值硬塞 waitRef 全部当场拒", () => {
    const base = {
      id: "pinst_demo_P35_o1",
      tenantId: "demo",
      key: "P35::o1",
      processKey: "P35",
      carrierObjectId: "o1",
      carrierTypeKey: "IncomingInspection",
      flowKey: "f::1",
      stationIndex: 0,
      enteredAt: "2026-06-10",
      exitedAt: null as string | null,
      waitState: "WAITING_USER" as string | null,
      waitStateOrigin: "DEFINITION_TEMPLATE" as string | null,
      ownerRef: { functionKey: "quality", partyField: null, partyValue: null },
      status: "WAITING",
      origin: "DERIVED_FROM_DOCUMENT",
      sourceDocuments: [
        { objectId: "o1", typeKey: "IncomingInspection", field: "arrivedDay", rawValue: 3, unit: "DAY_OFFSET", resolvedAt: "2026-06-13", role: "ENTERED" },
      ],
      scopeObjectTypes: ["IncomingInspection"],
    };
    // 🐤 金丝雀：基线必须**过**。基线若本来就红，下面三条"红了"什么都没证明。
    expect(() => ProcessInstanceSchema.parse(base)).not.toThrow();

    // (a) 反推产物没有溯源 ⇒ R13 破，必须红
    expect(() => ProcessInstanceSchema.parse({ ...base, sourceDocuments: [] })).toThrow();
    // (b) MANAGED 却带着一条溯源 ⇒ 那是编的，必须红（合并前的 `.min(1)` 挡不住这个方向）
    expect(() => ProcessInstanceSchema.parse({ ...base, origin: "MANAGED" })).toThrow();
    // (c) 有等待态却说不出出处 ⇒ 诚实位缺席，必须红
    expect(() => ProcessInstanceSchema.parse({ ...base, waitStateOrigin: null })).toThrow();
    // (d) 模板出处硬塞一个 waitRef ⇒ 假装知道"卡在哪张单"，必须红
    expect(() => ProcessInstanceSchema.parse({ ...base, waitRef: "adraft_1" })).toThrow();
    // (e) 同一个 waitRef 换成 gate 出处就合法（证明拒的是"出处不匹配"，不是"waitRef 这个字段"）
    expect(() =>
      ProcessInstanceSchema.parse({ ...base, origin: "MANAGED", sourceDocuments: [], waitStateOrigin: "TASK_GATE", waitRef: "adraft_1" }),
    ).not.toThrow();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ⑥ 诚实位一条都没在合并中丢（② 登记的三条，逐条在位）
  // ══════════════════════════════════════════════════════════════════════════
  it("⑥ ② 的三条诚实位在合并后逐条仍在（9/65 可反推 · 三类栽点 · impact-analysis 未接线）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoProcessLayer(t.repos);
    const out = await reconstructAndPersist(t.repos, DEMO_TENANT);

    // 诚实位 1：65 条流程只有一小撮反推得出，其余**逐条**诚实缺席（不是空数组冒充"没卡顿"）
    expect(out.coverage.totalProcesses).toBe(65);
    expect(out.coverage.reconstructedProcesses).toBeLessThan(out.coverage.totalProcesses);
    expect(out.absences.length).toBe(out.coverage.totalProcesses - out.coverage.reconstructedProcesses);

    // 诚实位 2：四类栽点**真的按输入分档**，不是写死的标签（三档同时出现且理由互不相同）
    const kinds = new Set(out.absences.map((a) => a.kind));
    expect(kinds.size, "缺席只有一种 kind ⇒ 分档退化成装饰").toBeGreaterThan(1);
    for (const a of out.absences) {
      expect(a.reason.length).toBeGreaterThan(20); // 「无数据」这种什么都没说的话过不了
      expect(a.probe.length).toBeGreaterThan(10); // 必须给得出复验探针
    }

    // 诚实位 3：`impact-analysis.ts` 的 instanceLevel 仍**硬写 available:false**（合并没有偷偷改口）。
    // 这条是 ② 自己登记的边界；合并不是把不好看的话删掉的机会，故此处正面钉住它还在。
    const ia = await readFile(join(REPO_APP, "src/sim/impact-analysis.ts"), "utf8");
    expect(ia, "金丝雀：读到的必须是那个文件").toContain("instanceLevel");
    expect(ia).toContain("available: false as const");
    expect(ia).toContain("missingCarrier: \"ProcessInstance\"");
  });
});
