import { describe, expect, it } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { isCombinationAsk, parseTransfer, mapCoupledChainToPortfolio } from "../src/router/l3-coupled.js";

/**
 * PRD-multi-intent-L2L3 P2 · L3 耦合联合求解 SEAM（agentcore 半：触发/映射/一次 portfolio/真残差外协/诚实边界/回落）。
 *
 * 分工（跨两半·一 dev 整单）：**守恒联动铁证**（改转拨量 → 延误/残差真变·capacityLedger 硬校验）在 datacore
 * `portfolio-l3-linkage.test.ts` 用真 globalSimOptimize + InProc 优化器驱动——agentcore mock 不产真守恒·在此假装联动
 * 即 KILL-MOCK-RED。本文件只证：路由升格（一次 portfolio 而非 N 独立）、映射正确、真残差 passthrough、近似环诚实标、
 * fail-open 回落 L1。
 */

const Q3 = "常州 4680-NCM 涂布良率下降2%，7月三元长协覆盖70%，转拨5万套给成都，哪些订单会延误，外协还是加班补缺口？";
const richPc = () => ({ view: "risk", entities: [], selection: [], drillPath: [], actions: [], focus: { base: "常州" } });

describe("L3 · 纯函数（R6）", () => {
  it("isCombinationAsk：组合方案/连锁传导型命中·普通并列问不触发", () => {
    expect(isCombinationAsk("外协还是加班补缺口？")).toBe(true);
    expect(isCombinationAsk("给个整体方案")).toBe(true);
    expect(isCombinationAsk("常州毛利多少，交期多少")).toBe(false);
  });

  it("parseTransfer：绝对量（万套→qty）+ 基地名→baseId；百分比只报 pctOnly（无基数不臆造）；无 → null·R6", () => {
    expect(parseTransfer("转拨5万套给成都")).toEqual({ base: "chengdu", qty: 50000 });
    expect(parseTransfer("拨 30000 套到成都")).toEqual({ base: "chengdu", qty: 30000 });
    expect(parseTransfer("转拨30%给宜宾")).toEqual({ pctOnly: 30 });
    expect(parseTransfer("常州产能怎么样")).toBeNull();
    expect(JSON.stringify(parseTransfer(Q3))).toBe(JSON.stringify(parseTransfer(Q3)));
  });

  it("mapCoupledChainToPortfolio：长协环→materialConstraint·转拨绝对量→committedBatches·良率/百分比→近似环诚实标", () => {
    const routes = [
      // requiredArgs 是 DomainRoute 的必填项（domain-resolver.ts:215）；ceo-route 派生的域
      // 无额外硬门，契约注释里写明就是 `[]`。
      { domain: "lta", route: "lta_gap", solverKey: "lta_gap", args: {}, perDomainScore: 0.7, requiredArgs: [] },
      { domain: "yield", route: "yield_diagnosis", solverKey: "yield_diagnosis", args: {}, perDomainScore: 0.7, requiredArgs: [] },
    ];
    const m = mapCoupledChainToPortfolio(Q3, routes, [["lta_gap", "yield_diagnosis"]]);
    expect(m.portfolioArgs.globalSim).toBe(true);
    expect(m.portfolioArgs.materialConstraint).toBe(true); // 长协环入联合解
    expect(m.portfolioArgs.committedBatches).toEqual([{ base: "chengdu", qty: 50000 }]); // 转拨真注入
    expect(m.approximations.join("\n")).toContain("良率"); // 良率环诚实标（负 delta 杠杆 no-op·不假映射）
    expect(m.approximations.join("\n")).toContain("默认估算"); // coeff 兜底诚实标
  });
});

describe("L3 · SEAM 端到端（一次 portfolio 升格·真残差外协·对照回落）", () => {
  it("SEAM-L3 路由升格：det+l3 同开 + 组合方案型问句 → **一次 portfolio**（非 5 独立 solver）·committedBatches 透传·近似环标·非「未链式传导」", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.deterministic-multi-domain", "qos.multi-intent-l3-coupled"]);
    const invoked: { key: string; args: Record<string, unknown> }[] = [];
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      invoked.push({ key, args });
      return orig(ctx, key, args);
    };
    const { taskId } = await submitQuery(t, ADMIN, Q3, { view: "risk", pageContext: richPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // 命门：一次 portfolio 联合解·不再 N 独立并行。
    expect(invoked.map((i) => i.key)).toEqual(["portfolio"]);
    expect(invoked[0]!.args.globalSim).toBe(true);
    expect(invoked[0]!.args.committedBatches).toEqual([{ base: "chengdu", qty: 50000 }]);
    expect(invoked[0]!.args.materialConstraint).toBe(true);
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("真组合方案");
    expect(md).toContain("近似");
    expect(md).not.toContain("未链式传导"); // L3 ≠ L1 独立拼接
    expect(task.multiIntentPlan?.selectedIntents.map((s) => s.solverKey)).toEqual(["portfolio"]); // mock 无 blocked → 残差 0 → 诚实无外协
    expect(t.llm.agentRequests.length).toBe(0);
    await t.app.close();
  });

  it("SEAM-真残差：portfolio 返 blocked 残差 → outsourcing_split 吃**联合解真残差**（args.gap=Σblocked.qty·passthrough）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.deterministic-multi-domain", "qos.multi-intent-l3-coupled"]);
    const invoked: { key: string; args: Record<string, unknown> }[] = [];
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      invoked.push({ key, args });
      if (key === "portfolio") {
        // 静态 GlobalSimResponse 形状载荷（只供 agentcore 半验「残差 passthrough」——守恒联动真值在 datacore 半测）。
        return {
          data: {
            scenarios: [{ key: "max_ontime", kpi: { ontimeRate: 0.9 } }],
            schedule: [{ orderId: "SO-1", packBase: "changzhou", deliverDay: 9, status: "ok" }],
            blocked: [{ orderId: "SO-2", reason: "capacity", qty: 120 }],
            reconChecks: [{ label: "cap", ok: true }],
            reconciled: true,
          },
          snapshotVersion: "l3-test",
        };
      }
      return orig(ctx, key, args);
    };
    const { taskId } = await submitQuery(t, ADMIN, Q3, { view: "risk", pageContext: richPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(invoked.map((i) => i.key)).toEqual(["portfolio", "outsourcing_split"]);
    expect(invoked[1]!.args.gap).toBe(120); // 真残差 passthrough（产能/转拨/物料已联合结算）
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("守恒校验通过");
    expect(md).toContain("真残差 120");
    expect(task.multiIntentPlan?.selectedIntents.map((s) => s.solverKey)).toEqual(["portfolio", "outsourcing_split"]);
    await t.app.close();
  });

  it("对照（L1 现状零回归）：l3 关·仅 det 开 → 同问句照走独立并行（≥3 solver·「未链式传导」诚实标·无单 portfolio 升格）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.deterministic-multi-domain"]);
    const invoked: string[] = [];
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      invoked.push(key);
      return orig(ctx, key, args);
    };
    const { taskId } = await submitQuery(t, ADMIN, Q3, { view: "risk", pageContext: richPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(invoked.length).toBeGreaterThanOrEqual(3); // L1 独立并行
    expect(invoked).not.toContain("portfolio"); // 无 L3 升格
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("未链式传导"); // L1 耦合诚实标保留
    await t.app.close();
  });

  it("fail-open：portfolio 抛错 → 回落 L1 独立并行（不塌·答案仍出）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.deterministic-multi-domain", "qos.multi-intent-l3-coupled"]);
    const invoked: string[] = [];
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      invoked.push(key);
      if (key === "portfolio") throw new Error("优化引擎不可达（测试注入）");
      return orig(ctx, key, args);
    };
    const { taskId } = await submitQuery(t, ADMIN, Q3, { view: "risk", pageContext: richPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(invoked[0]).toBe("portfolio"); // L3 先试
    expect(invoked.filter((k) => k !== "portfolio").length).toBeGreaterThanOrEqual(3); // 回落 L1 独立并行真跑
    expect((task.answer?.blocks.length ?? 0)).toBeGreaterThan(0);
    await t.app.close();
  });
});
