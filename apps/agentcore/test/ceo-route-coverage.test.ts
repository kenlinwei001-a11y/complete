import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { resolveCeoRoute, ceoIntentKeyForRoute, isCeoQuestion, isCeoIntentKey } from "../src/router/ceo-route.js";
import { domainResolve, preferDeterministicSolver, DETERMINISTIC_PREFERENCE_THRESHOLD } from "../src/router/domain-resolver.js";
import { createTestApp, submitQuery, waitForTask, ADMIN } from "./helpers.js";

/**
 * WO-QOS-ROUTE-COVER · 场景意图覆盖 + CEO 路由优先级根因修（真 Kimi 10 题 v3/v4 实测结论：
 * 「问题在场景意图覆盖和 CEO 路由优先级，不在分类器模型」）。
 *
 * v4 病灶：
 *   #4「常州瓶颈卡在哪道工序」被 RE_ROOTCAUSE 的「瓶颈/为什么」过度捕获成 gap_attribution（答非所问）。
 *   #4b「化成 OEE / 换型损失」类**无 为什么/瓶颈** → isCeoQuestion 恒假 → 根本不入 CEO 路由 → path-B 洪泛。
 *   #9「未来 90 天产能够不够 / 穿仓」无对口确定性意图 → path-B 洪泛。
 *
 * 根因修（本单守）：① ceo-route 新增 bottleneck_matrix / base_capacity_outlook 路由（置于 RE_ROOTCAUSE 之前、
 * 达标语境分支之后 → #10 储能份额逐层拆根因不回归）；② isCeoQuestion 纳入两新正则（否则纯瓶颈/前瞻词题不入路由）；
 * ③ seed 补 ceo_bottleneck / ceo_base_outlook 对口意图各绑真 solver；④ args 派生 baseId/baseIds（BASE_REGISTRY 单一来源）。
 *
 * SEAM（数据形状 seed × 引擎路由 orchestrator 两半接缝·驱动组合断言）：真 orchestrator 跑到对口意图（非 gap_attribution），
 * 证「补意图 + 改路由」两半合起来端到端生效——任一半漏即红（绿测试≠能用·断在接缝的老坑靠此门堵死）。
 *
 * 诚实边界：本单证**路由决策确定性正确**（纯函数 + 真 orchestrator 绑定）；整体 10 题真 Kimi 通过率仍需用户在
 * 绑真 provider 的部署态复跑坐实（本地无真 LLM）。
 */

const pc = (focus: NonNullable<PageContext["focus"]>, view = "risk"): PageContext => ({
  view,
  focus,
  entities: [],
  selection: [],
  drillPath: [],
  actions: [],
});

describe("WO-QOS-ROUTE-COVER · 瓶颈/产能前瞻确定性路由 + 对口意图（纯函数 golden）", () => {
  it("#4 瓶颈定位（含「瓶颈/为什么」）→ bottleneck_matrix（不被 gap_attribution 过度捕获）", () => {
    const q = "常州瓶颈卡在哪个工序？为什么是化成不是分容？";
    expect(isCeoQuestion(q)).toBe(true);
    const route = resolveCeoRoute(q, pc({ base: "changzhou" }), "ceo");
    expect(route.route).toBe("bottleneck_matrix");
    expect(route.solverKey).toBe("bottleneck_matrix");
    expect(ceoIntentKeyForRoute(route.route)).toBe("ceo_bottleneck");
    expect(route.args.baseIds).toEqual(["changzhou"]); // 问句基地名 → 规范 baseId（BASE_REGISTRY）
  });

  it("#4b 纯瓶颈词（OEE/换型损失·无 为什么/瓶颈）→ isCeoQuestion 真 + bottleneck_matrix（关键：此前恒假不入路由）", () => {
    const q = "常州化成工序现在OEE多少？换型损失占几成？";
    // 此题不含 为什么/根因/瓶颈/卡在 —— 若 isCeoQuestion 未纳入 RE_BOTTLENECK 则恒假，落 path-B 洪泛（v4 病根）。
    expect(isCeoQuestion(q)).toBe(true);
    const route = resolveCeoRoute(q, pc({ base: "changzhou" }), "ceo");
    expect(route.route).toBe("bottleneck_matrix");
    expect(ceoIntentKeyForRoute(route.route)).toBe("ceo_bottleneck");
  });

  it("#9 未来产能前瞻/穿仓 → base_capacity_outlook + baseId 派生（求解器必填）", () => {
    const q = "常州未来90天产能够不够接住在手订单？何时穿仓？";
    expect(isCeoQuestion(q)).toBe(true);
    const route = resolveCeoRoute(q, pc({ base: "changzhou" }), "ceo");
    expect(route.route).toBe("base_capacity_outlook");
    expect(route.solverKey).toBe("base_capacity_outlook");
    expect(ceoIntentKeyForRoute(route.route)).toBe("ceo_base_outlook");
    expect(route.args.baseId).toBe("changzhou"); // 无 baseId 求解器抛 validationError → 必须派生
  });

  it("#9b 基地名从问句解析（无 focus.base 也能派生 baseId）", () => {
    const route = resolveCeoRoute("眉山未来两个月产能接得住吗？会不会穿仓？", pc({ metric: "x" }), "ceo");
    expect(route.route).toBe("base_capacity_outlook");
    expect(route.args.baseId).toBe("meishan"); // 中文名「眉山」→ baseId
  });

  it("#10 储能份额逐层拆根因（达标语境）→ gap_attribution 不回归（守既有口径）", () => {
    const q = "储能份额没达标，逐层拆根因";
    const route = resolveCeoRoute(q, pc({ metric: "seg_attain_ess" }), "ceo");
    expect(route.route).toBe("gap_attribution"); // 达标语境 + 归因 → 先于瓶颈分支落 gap_attribution
    expect(ceoIntentKeyForRoute(route.route)).toBe("ceo_root_cause");
  });

  it("新意图 key 登记为 CEO 专属（进候选池门控·避免污染既有 classifier 语义）", () => {
    expect(isCeoIntentKey("ceo_bottleneck")).toBe(true);
    expect(isCeoIntentKey("ceo_base_outlook")).toBe(true);
  });
});

describe("WO-QOS-ROUTE-COVER · QOS-1 确定性优先门开（domainResolve → preferDeterministicSolver）", () => {
  it("#4 瓶颈题：置信 ≥ 阈值 + 对口 solver（拉回 path-A·免被 path-B/free-LLM 劫持）", () => {
    const det = preferDeterministicSolver(domainResolve("常州瓶颈卡在哪个工序？为什么是化成不是分容？", pc({ base: "changzhou" })));
    expect(det.solverKey).toBe("bottleneck_matrix");
    expect(det.intentKey).toBe("ceo_bottleneck");
    expect(det.confidence).toBeGreaterThanOrEqual(DETERMINISTIC_PREFERENCE_THRESHOLD);
  });

  it("#9 产能前瞻题：置信 ≥ 阈值 + 对口 solver", () => {
    const det = preferDeterministicSolver(domainResolve("常州未来90天产能够不够接住在手订单？何时穿仓？", pc({ base: "changzhou" })));
    expect(det.solverKey).toBe("base_capacity_outlook");
    expect(det.intentKey).toBe("ceo_base_outlook");
    expect(det.confidence).toBeGreaterThanOrEqual(DETERMINISTIC_PREFERENCE_THRESHOLD);
  });

  it("无页面上下文 → 置信 0（fail-safe：绝不把开放题误降级给窄 solver）", () => {
    const det = preferDeterministicSolver(domainResolve("常州瓶颈卡在哪个工序？", undefined));
    expect(det.confidence).toBe(0); // contextRich 假 → 照落 path-B
  });
});

describe("WO-QOS-ROUTE-COVER SEAM · 真 orchestrator 端到端绑对口意图（数据 seed × 引擎路由 两半接缝）", () => {
  it("#4 瓶颈题经真 orchestrator → matchedIntent=ceo_bottleneck（非 gap_attribution·非 classifier 兜底）", async () => {
    const t = await createTestApp();
    const context = { view: "risk", pageContext: pc({ base: "changzhou" }) };
    const { taskId, statusCode } = await submitQuery(t, ADMIN, "常州瓶颈卡在哪个工序？为什么是化成不是分容？", context);
    expect(statusCode).toBe(202);
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.classification?.model).toMatch(/^deterministic:ceo-route/); // 确定性 CEO 路由（非 LLM/兜底）
    expect(task.matchedIntent?.intentKey).toBe("ceo_bottleneck"); // 关键：不再落 ceo_root_cause(gap_attribution)
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    await t.app.close();
  });

  it("#9 产能前瞻题经真 orchestrator → matchedIntent=ceo_base_outlook + baseId 达 path-A 求解器", async () => {
    const t = await createTestApp();
    const context = { view: "risk", pageContext: pc({ base: "changzhou" }) };
    const { taskId } = await submitQuery(t, ADMIN, "常州未来90天产能够不够接住在手订单？何时穿仓？", context);
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.classification?.model).toMatch(/^deterministic:ceo-route/);
    expect(task.matchedIntent?.intentKey).toBe("ceo_base_outlook");
    expect(task.slots?.baseId).toBe("changzhou"); // args 从问句/PageContext 真派生并达求解器
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    await t.app.close();
  });

  it("#10 no-regression：储能份额逐层拆根因经真 orchestrator → 仍 ceo_root_cause（gap_attribution·不被瓶颈分支劫持）", async () => {
    const t = await createTestApp();
    const context = { view: "gap-waterfall", pageContext: pc({ metric: "seg_attain_ess" }, "gap-waterfall") };
    const { taskId } = await submitQuery(t, ADMIN, "储能份额没达标，逐层拆根因", context);
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.matchedIntent?.intentKey).toBe("ceo_root_cause"); // 达标语境归因 → 不回归
    await t.app.close();
  });
});
