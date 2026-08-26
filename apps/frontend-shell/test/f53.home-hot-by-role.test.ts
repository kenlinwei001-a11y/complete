import { describe, expect, it } from "vitest";
import { rankHotScenarios } from "@/components/ScenarioLauncher/rankHotScenarios";
import type { ScenarioCardVM } from "@/api/endpoints";

/**
 * F53 · 首页高频区按角色排序（场景启动器 §3.5-C 余项）。
 *
 * 故事脚本（~100 字）：同一套 8 张出厂场景卡，规划员小李能进全部业务视图（dash/risk/plan/
 * graph/sop…），常州基地经理老王只能进 dash/risk/order 三视图（导航受角色+功能门收窄）。首页高频区
 * 应据"角色可达落点"分层：老王看到的 6 张里，落点在他可达视图的排前、graph/sop 等不可达的沉底或挤出；
 * 小李则按 sNo 稳定铺开。验证同一份卡、不同角色得到不同高频集，且确定性可复算（R6）。
 */
function card(sNo: string, view: string, name = sNo): ScenarioCardVM {
  return {
    sNo, name, view, intentKey: `intent_${sNo}`, triggerQuestion: `问 ${sNo}`,
    riskLevel: "COMPUTE", summary: "", willProduceDraft: false,
    presetContext: { targetView: view, selectedObjects: [], slotPresets: {} },
  };
}

// 8 张出厂卡（sNo 升序铺开，落点视图各异）
const CARDS: ScenarioCardVM[] = [
  card("S01", "dash"), card("S02", "graph"), card("S03", "risk"), card("S04", "sop-balance"),
  card("S05", "order"), card("S06", "graph"), card("S07", "plan-generate"), card("S08", "dash"),
];

describe("F53 · 首页高频区按角色可达落点排序", () => {
  it("规划员（全视图可达）→ 高频区按 sNo 稳定铺开前 6 张", () => {
    const all = ["dash", "risk", "order", "graph", "sop-balance", "plan-generate"];
    const hot = rankHotScenarios(CARDS, all, 6);
    expect(hot.map((c) => c.sNo)).toEqual(["S01", "S02", "S03", "S04", "S05", "S06"]);
  });

  it("基地经理（仅 dash/risk/order）→ 可达落点卡排前，graph/sop 沉底被挤出", () => {
    const limited = ["dash", "risk", "order"];
    const hot = rankHotScenarios(CARDS, limited, 6);
    // 可达落点（dash/risk/order）按 sNo：S01,S03,S05,S08；其后才是不可达 S02(graph),S04(sop)
    expect(hot.map((c) => c.sNo)).toEqual(["S01", "S03", "S05", "S08", "S02", "S04"]);
    // 前四张落点都在可达集（角色真能用）
    for (const c of hot.slice(0, 4)) expect(limited).toContain(c.view);
  });

  it("两角色的高频集确实不同（按角色个性化生效）", () => {
    const planner = rankHotScenarios(CARDS, ["dash", "risk", "order", "graph", "sop-balance", "plan-generate"], 6).map((c) => c.sNo);
    const manager = rankHotScenarios(CARDS, ["dash", "risk", "order"], 6).map((c) => c.sNo);
    expect(planner).not.toEqual(manager);
    // graph 场景 S06 进了规划员前 6、却被基地经理挤出
    expect(planner).toContain("S06");
    expect(manager).not.toContain("S06");
  });

  it("确定性可复算（R6）：同输入两次排序逐位一致；落点取 presetContext.targetView 兜底", () => {
    const a = rankHotScenarios(CARDS, ["dash"], 6).map((c) => c.sNo);
    const b = rankHotScenarios(CARDS, ["dash"], 6).map((c) => c.sNo);
    expect(a).toEqual(b);
    // 仅 dash 可达 → S01,S08 排前，其余按 sNo
    expect(a.slice(0, 2)).toEqual(["S01", "S08"]);
  });
});
