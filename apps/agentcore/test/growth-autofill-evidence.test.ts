import { describe, expect, it, vi } from "vitest";
import { SubmitQueryBodySchema, type GapFinding, type GapReport, type GrowthFillResult } from "@platform/contracts";
import { createTestApp, PKG, TENANT, type TestApp } from "./helpers.js";
import { buildGrowthLoopWiring } from "../src/growth/scenario-grow.js";
import { runGrowthLoop } from "../src/growth/loop.js";
import { probeRepresentativeNL } from "../src/capability/verify.js";
import type { RequestAuth } from "../src/auth.js";

/**
 * AUTOFILL-SOP（用户亲令 2026-07-06·SPEC-autofill-sop §4/§5）· 自动补 before→after 前后端逐值可见 + 每类 NL-E2E。
 *
 * C1 契约+产出：GapFillEvidence{gapCode,fillAction,before,after,evidence,dataMode} 落 contracts；growth fill 逐类产出该证据块；
 *              GrowthRunReport 逐轮携带（round.fillApplied.fillEvidence）；GrowthLedger 持久化后 round-trip 保真。
 * C2 后端逐值：触发一次自动补 → 报告返 before→after + 证据；前端逐值渲染对账见 frontend f64（jsdom+MSW）。
 * C3 每类 NL-E2E：每类自动补一条经 probeRepresentativeNL（orchestrator.submitQuery·非直调 solver）的 E2E，断言走 NL 路由。
 * C4 green→red：摘掉 fillEvidence 产出 / 改坏 dataMode 勾稽 → 本测红（revert 演练亲跑，EXIT 写进提交）。
 *
 * 诚实边界：合成/占位/骨架诚实标 SYNTHETIC/PROVISIONAL/DRAFT；登记在办未实际补标 NONE（before==after 数据不变）。
 */

const AUTH: RequestAuth = { tenantId: TENANT, userId: "user-admin", roles: ["admin"] };
const noopEmit = async () => {};
const gap = (gapCode: GapFinding["gapCode"], evidence = "探测证据"): GapFinding => ({ gapCode, evidence, suggestedFill: "-", blocking: true });
const body = (query: string) => SubmitQueryBodySchema.parse({ packageId: PKG, query, context: { view: "dash", selectedObjects: [], filters: {} } });

describe("AUTOFILL-SOP · C1 契约+产出：每类自动补产 GapFillEvidence（before→after 逐值·诚实 dataMode）", () => {
  it("SYNTHETIC：空世界 EMPTY_DATA → provisionWorld → before{objectCount:0}→after{objectCount:120}·SYNTHETIC", async () => {
    const t: TestApp = await createTestApp();
    t.deps.dataCore.ontology.listObjectTypes = async () => []; // 世界全空
    const w = buildGrowthLoopWiring(t.deps, AUTH, body("通用探测问句"), noopEmit, { registerWorklist: false });
    const r = await w.fill(gap("EMPTY_DATA", "工作流跑通但未投影承载数据"));

    expect(r.advanced).toBe(true);
    const ev = r.fillEvidence!;
    expect(ev).toBeDefined();
    expect(ev.dataMode).toBe("SYNTHETIC");
    expect(ev.fillAction).toBe("provisionWorld");
    expect(ev.before.objectCount).toBe(0);
    expect(ev.before.worldEmpty).toBe("true");
    expect(ev.after.objectCount).toBe(120); // mock provisionWorld 真返 120（逐值对后端真返值）
    expect(ev.after.worldEmpty).toBe("false");
    expect(ev.evidence).toContain("provisionWorld");
    expect(ev.evidence).toContain("SYNTHETIC");
  });

  it("PROVISIONAL：非空世界 EMPTY_DATA(SOFT·无业务实体) → fillData → before{rows:0}→after{rows:6}·PROVISIONAL", async () => {
    const t: TestApp = await createTestApp();
    // 世界非空（避免落 provisionWorld 分支）→ 走单类型 fillData。
    t.deps.dataCore.ontology.listObjectTypes = async () => [{ key: "Base", label: "基地", domain: "factory", instanceCount: 5 }];
    const fillSpy = vi.spyOn(t.deps.dataCore.ontology, "fillData");
    const w = buildGrowthLoopWiring(t.deps, AUTH, body("通用占位指标是多少"), noopEmit, { registerWorklist: false });
    const r = await w.fill(gap("EMPTY_DATA"));

    expect(r.advanced).toBe(true);
    expect(fillSpy).toHaveBeenCalledTimes(1); // 真调 fillData（非直调 solver）
    const ev = r.fillEvidence!;
    expect(ev.dataMode).toBe("PROVISIONAL");
    expect(ev.fillAction).toBe("fillData");
    expect(ev.before.rows).toBe(0);
    expect(ev.after.rows).toBe(6); // fillData 真返 rowCount（逐值对后端）
    expect(ev.after.typeKey).toBe("Object");
    expect(ev.evidence).toContain("PROVISIONAL");
  });

  it("DRAFT：NO_PLAN → scaffoldDraftPlan → before{plan:none}→after{plan:plan_growth_*}·DRAFT", async () => {
    const t: TestApp = await createTestApp();
    const w = buildGrowthLoopWiring(t.deps, AUTH, body("缺执行计划的问句"), noopEmit, { registerWorklist: false });
    const r = await w.fill(gap("NO_PLAN", "PLAN_NOT_FOUND"));

    expect(r.advanced).toBe(true);
    expect(r.scaffolded?.length).toBeGreaterThan(0);
    const ev = r.fillEvidence!;
    expect(ev.dataMode).toBe("DRAFT");
    expect(ev.fillAction).toBe("scaffoldDraftPlan");
    expect(ev.before.plan).toBe("none");
    expect(ev.before.drafts).toBe(0);
    expect(String(ev.after.plan)).toMatch(/^plan_growth_/);
    expect(ev.after.drafts).toBe(r.scaffolded!.length); // 逐值：后端 scaffold 出的制品数
    expect(ev.evidence).toContain("DRAFT");
  });

  it("NONE：驾驶舱 registerWorklist EMPTY_DATA → 登记在办（未自动补）→ before==after 数据不变·NONE·needsHuman", async () => {
    const t: TestApp = await createTestApp();
    t.deps.dataCore.ontology.listObjectTypes = async () => []; // 空世界 → provisionWorld 登记（不自动跑）
    const w = buildGrowthLoopWiring(t.deps, AUTH, body("驾驶舱缺数据问句"), noopEmit, { registerWorklist: true });
    const r = await w.fill(gap("EMPTY_DATA"));

    expect(r.needsHuman).toBe(true);
    expect(r.advanced).toBe(false);
    expect(r.worklistItemId).toBeTruthy();
    const ev = r.fillEvidence!;
    expect(ev.dataMode).toBe("NONE"); // 诚实：未实际合成
    expect(ev.fillAction).toContain("registerWorklist");
    // 数据未变（对象数不动），仅在办项由 0→1（登记而非补数）。
    expect(ev.before.status).toBe("gap");
    expect(ev.after.status).toBe("OPEN");
    expect(ev.after.worklistItemId).toBe(r.worklistItemId);
    expect(ev.evidence).toContain("未自动补");
  });
});

describe("AUTOFILL-SOP · C1/C2 后端：GrowthRunReport 逐轮携带 fillEvidence + GrowthLedger 持久化 round-trip 保真", () => {
  it("触发一次自动补（provisionWorld）→ 报告 rounds[0].fillApplied.fillEvidence 齐 before→after；存账本读回逐值不丢", async () => {
    const t: TestApp = await createTestApp();
    t.deps.dataCore.ontology.listObjectTypes = async () => [];
    const w = buildGrowthLoopWiring(t.deps, AUTH, body("空世界发育问句"), noopEmit, { registerWorklist: false });
    // 注入确定性 probe：第1轮 EMPTY_DATA（触发 provisionWorld），第2轮 ANSWERABLE（收敛）。
    let round = 0;
    const probe = async (): Promise<GapReport> => {
      round += 1;
      return round === 1
        ? { question: "空世界发育问句", taskId: "t1", verdict: "BLOCKED", path: "WORKFLOW", findings: [gap("EMPTY_DATA")], generatedAt: new Date().toISOString() }
        : { question: "空世界发育问句", taskId: "t2", verdict: "ANSWERABLE", path: "WORKFLOW", findings: [], generatedAt: new Date().toISOString() };
    };
    const report = await runGrowthLoop({ question: "空世界发育问句", maxRounds: 4, probe, fill: w.fill });

    expect(report.terminalState).toBe("CONVERGED");
    const fe = report.rounds[0]!.fillApplied!.fillEvidence!;
    expect(fe.dataMode).toBe("SYNTHETIC");
    expect(fe.before.objectCount).toBe(0);
    expect(fe.after.objectCount).toBe(120);

    // 持久化 round-trip（GrowthLedgerEntry.report 逐轮携带·经 memory repo 存读不丢证据块）。
    await t.repos.growthLedger.insert({ id: "glr_test", tenantId: TENANT, report, createdAt: new Date().toISOString() });
    const back = await t.app.inject({ method: "GET", url: "/api/v1/growth/ledger", headers: { "x-debug-user": `${TENANT}:user-admin:admin` } });
    const items = (back.json() as { items: { report: typeof report }[] }).items;
    const persisted = items.find((e) => e.report.question === "空世界发育问句")!;
    const pfe = persisted.report.rounds[0]!.fillApplied!.fillEvidence!;
    expect(pfe.dataMode).toBe("SYNTHETIC");
    expect(pfe.before.objectCount).toBe(0); // 逐值：读回 == 存入 == 后端真值
    expect(pfe.after.objectCount).toBe(120);
  });
});

describe("AUTOFILL-SOP · C3 每类自动补一条 NL-E2E（复用 probeRepresentativeNL·orchestrator.submitQuery·非直调 solver）", () => {
  // 每类：构造缺口 → 跑自动补（产 evidence）→ 代表问经 QOS NL 真跑（submitQuery），断言走 NL 路由（非直调求解器）。
  const classes: { name: string; dataMode: string; setup: (t: TestApp) => void; gapFinding: GapFinding }[] = [
    { name: "SYNTHETIC/provisionWorld", dataMode: "SYNTHETIC", setup: (t) => { t.deps.dataCore.ontology.listObjectTypes = async () => []; }, gapFinding: gap("EMPTY_DATA") },
    { name: "PROVISIONAL/fillData", dataMode: "PROVISIONAL", setup: (t) => { t.deps.dataCore.ontology.listObjectTypes = async () => [{ key: "Base", label: "基地", domain: "factory", instanceCount: 3 }]; }, gapFinding: gap("EMPTY_DATA") },
    { name: "DRAFT/scaffold", dataMode: "DRAFT", setup: () => {}, gapFinding: gap("NO_PLAN") },
    { name: "NONE/registerWorklist", dataMode: "NONE", setup: (t) => { t.deps.dataCore.ontology.listObjectTypes = async () => []; }, gapFinding: gap("EMPTY_DATA") },
  ];

  for (const c of classes) {
    it(`[${c.name}] 自动补产 ${c.dataMode} 证据 → 代表问经 NL 路由真跑（submitQuery 非直调 solver）`, async () => {
      const t: TestApp = await createTestApp();
      c.setup(t);
      const registerWorklist = c.dataMode === "NONE";
      const w = buildGrowthLoopWiring(t.deps, AUTH, body("通用发育问句"), noopEmit, { registerWorklist });
      const fillRes: GrowthFillResult = await w.fill(c.gapFinding);
      // 每类都真产出 before→after 证据块（诚实 dataMode）。
      expect(fillRes.fillEvidence?.dataMode).toBe(c.dataMode);

      // ★ NL-E2E：代表问经 orchestrator.submitQuery（QueryDock 打字路径）——无 LLM key 时诚实降级（路径B 兜底）。
      t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
      t.llm.queueAgentTurn({ content: [{ type: "text", text: "参考" }, { type: "tool_use", id: "tu0", name: "final_answer", input: { blocks: [{ type: "text", markdown: "本体外参考（无承载数据·诚实降级）。" }], provenance: [] } }] } as never);
      const spy = vi.spyOn(t.deps.orchestrator, "submitQuery");
      const probe = await probeRepresentativeNL({ orchestrator: t.deps.orchestrator, repos: t.repos }, AUTH, "补后代表问：现在能答吗？");

      // 齿②：唯一入口是 submitQuery（NL 问句），internal 标记；绝无 /a/v1/solvers/{key}/invoke 直调。
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0]![3] as { internal?: boolean })?.internal).toBe(true);
      expect(probe.acceptanceRan).toBe(true); // 真跑到终态
      expect(probe.taskId).toBeTruthy();
      // 走了 QOS NL 路由（分类→路径B agent），非手搓 args 直调求解器（那样 path=NONE）。
      expect(probe.gap.path).toBe("AGENT");
    });
  }
});

describe("AUTOFILL-SOP · C4 green→red 自证（勾稽有牙）", () => {
  it("dataMode 逐值勾稽：改坏 SYNTHETIC↔PROVISIONAL 断言即红（证据块非空壳）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.dataCore.ontology.listObjectTypes = async () => [];
    const w = buildGrowthLoopWiring(t.deps, AUTH, body("q"), noopEmit, { registerWorklist: false });
    const r = await w.fill(gap("EMPTY_DATA"));
    // 若 fill 摘掉 fillEvidence 产出 → r.fillEvidence undefined → 下行 red（守 C1）。
    expect(r.fillEvidence).toBeDefined();
    // 若把 after.objectCount 改成不对后端真返值（如硬编码）→ 下行 red（守逐值勾稽）。
    expect(r.fillEvidence!.after.objectCount).toBe(120);
    expect(r.fillEvidence!.dataMode).not.toBe("PROVISIONAL"); // provisionWorld 是 SYNTHETIC 非 PROVISIONAL
  });
});
