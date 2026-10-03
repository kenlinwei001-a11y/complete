import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { resolveCeoRoute, isCeoQuestion } from "../src/router/ceo-route.js";
import { createTestApp, submitQuery, waitForTask, ADMIN } from "./helpers.js";

/**
 * WO-METRIC-ROLLUP-SPLIT · 收窄 metric_rollup 路由边界（闭 G-3 深问侧·SEAM 一测两侧驱动）。
 *
 * 病根：问句本该走 gap_attribution(深度归因)/decision_play(方案)，却因 RE_ATTAIN 含裸 token
 * 达成/达标 + RE_ROOTCAUSE/RE_OPTION 词表太窄，被 metric_rollup(经营指标卷算)过度泛化劫持
 * （28 题实测 5 条"绿但错"Q5/Q7/Q9/Q11/Q26）。本单两头一起收：收窄 RE_ATTAIN 只留纯对账，
 * 拓宽根因/方案词表纳入"拖累/拉低/短板/卡在哪/哪个环节"（根因）、"改善/提升/追平/杠杆/抓手/补上"（方案）。
 *
 * SEAM 判据（非各半绿）：
 *  ① 5 条"绿但错"深问 → 深路由(gap_attribution/decision_play·非 metric_rollup) + isCeoQuestion===true（门真开）
 *     + args.metricKey 仍从 PageContext.focus 派生（收窄未打断上下文注入）。
 *  ② 对照组纯对账 → 仍 metric_rollup（收窄没误伤纯对账，"还差/完成率/目标 vs 实际"不回归）。
 *  ③ 端到端一条经真 orchestrator（submitQuery→waitForTask）：深问 → classification.model==="deterministic:ceo-route"
 *     + matchedIntent.intentKey==="ceo_root_cause"（证 ceoIntentKeyForRoute 绑定跟着走·接缝落 intent key 才算通）。
 * 纯函数 resolveCeoRoute 直驱 R6 确定性零 LLM。
 */

const pcEss: PageContext = {
  view: "gap-waterfall",
  focus: { metric: "seg_attain_ess", gap: 27.8, factorId: "cf-cathode-shortage" },
  entities: [{ type: "Metric", id: "seg_attain_ess", label: "储能达成率", value: 72.2, drillRef: "obj_metric_kpi-seg-ess" }],
  selection: ["cf-cathode-shortage"],
  drillPath: ["seg_attain_ess", "base:changzhou", "cf-cathode-shortage"],
  actions: ["decision_play"],
};

// 5 条"绿但错"深问：旧正则裸 达成/达标 命中 → metric_rollup（劫持），实为根因/方案深问。
const DEEP: Array<{ q: string; route: "gap_attribution" | "decision_play" }> = [
  { q: "哪个环节拖累了整体达成", route: "gap_attribution" }, // 哪个环节/拖累=根因（曾被裸 达成 劫持）
  { q: "储能短板卡在哪个环节没达标", route: "gap_attribution" }, // 短板/卡在=根因（曾被裸 达标 劫持）
  { q: "毛利被什么拉低才没达成目标", route: "gap_attribution" }, // 拉低=根因（曾被裸 达成 劫持）
  { q: "怎么把储能达成率追平目标", route: "decision_play" }, // 追平=方案（曾被 达成率 劫持）
  { q: "用什么抓手提升份额达标", route: "decision_play" }, // 抓手/提升=方案（曾被裸 达标 劫持）
];

// 对照组：纯对账（目标 vs 实际/还差/完成率/缺口是多少）→ 仍 metric_rollup（收窄不误伤）。
const CONTROL = ["各经营指标目标vs实际达成多少", "储能还差多少达成", "完成率是多少缺口是多少"];

describe("WO-METRIC-ROLLUP-SPLIT · 收窄 metric_rollup（闭 G-3·SEAM）", () => {
  it("① 5 条深问 → 深路由(gap_attribution/decision_play·非 metric_rollup) + isCeoQuestion===true + metricKey 仍从 focus 派生", () => {
    for (const { q, route } of DEEP) {
      const r = resolveCeoRoute(q, pcEss, "ceo");
      expect(r.route, `「${q}」应落 ${route}`).toBe(route);
      expect(r.route, `「${q}」不该被 metric_rollup 劫持`).not.toBe("metric_rollup");
      expect(isCeoQuestion(q), `「${q}」拓宽后仍 isCeoQuestion===true（门真开·防隐性回归）`).toBe(true);
      expect(r.args.metricKey, `「${q}」metricKey 仍从 PageContext.focus 派生`).toBe("seg_attain_ess");
    }
  });

  it("② 对照组纯对账 → 仍 metric_rollup（收窄没误伤·还差/完成率/目标 vs 实际不回归）", () => {
    for (const q of CONTROL) {
      const r = resolveCeoRoute(q, pcEss, "ceo");
      expect(r.route, `「${q}」纯对账应仍 metric_rollup`).toBe("metric_rollup");
      expect(r.args.metricKey).toBe("seg_attain_ess");
    }
  });

  it("③ 既有分类不回归：为什么→gap_attribution·怎么补→decision_play·还差多少达成→metric_rollup·锂价信号→signal", () => {
    expect(resolveCeoRoute("储能为什么没达标", pcEss, "ceo").route).toBe("gap_attribution");
    expect(resolveCeoRoute("这个根因怎么补", pcEss, "ceo").route).toBe("decision_play");
    expect(resolveCeoRoute("储能还差多少达成", pcEss, "ceo").route).toBe("metric_rollup");
    expect(resolveCeoRoute("锂价信号触发了什么", pcEss, "ceo").route).toBe("signal");
  });

  it("④ R6 确定性：同问句+同 PageContext 两跑 deep-equal（零 LLM/时钟/随机）", () => {
    for (const { q } of DEEP) {
      const a = resolveCeoRoute(q, pcEss, "ceo");
      const b = resolveCeoRoute(q, pcEss, "ceo");
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it("⑤ 端到端接缝：深问经真 orchestrator → deterministic:ceo-route + matchedIntent=ceo_root_cause（intent key 绑定跟着走）", async () => {
    const t = await createTestApp();
    const { taskId, statusCode } = await submitQuery(t, ADMIN, "哪个环节拖累了整体达成", {
      view: "gap-waterfall",
      pageContext: pcEss,
    });
    expect(statusCode).toBe(202);
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.classification?.model).toBe("deterministic:ceo-route"); // 确定性 CEO 路由（非蒙 LLM）
    expect(task.classification?.candidates?.[0]?.intentKey).toBe("ceo_root_cause");
    expect(task.matchedIntent?.intentKey).toBe("ceo_root_cause"); // 接缝落 intent key 才算通（非仅 route 分类对）
    expect(task.slots?.metricKey).toBe("seg_attain_ess"); // args 从 PageContext.focus 派生真达 path A
    expect(task.answer?.blocks?.length ?? 0).toBeGreaterThan(0);
    await t.app.close();
  });
});
