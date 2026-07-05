import { describe, expect, it } from "vitest";
import { normalizeViewKey } from "@/views/registry";
import { workspaceForAccount, ACCOUNTS } from "@/mocks/fixtures";

/**
 * LAUNCH-VIEW-KEY-ALIGN · 齿检（治簇② 404/403·单一键口径）：
 * 场景卡 targetView 短键经 normalizeViewKey 归一后，必须落 **workspace.views 真实注册键**，
 * 且 ViewPage 的两道守卫都放行（feature 存在=非 404·view 存在=非 403）。
 *
 * 断链根因回归锁：dash 曾被别名成 dashboard → `/v/dashboard` 无 feature=404；
 * risk 曾被别名成 risk-board → `/v/risk-board` 无 view key=403。真视图键就是 dash / risk。
 * 若谁再把 dash→dashboard / risk→risk-board 别名回去，本文件立即变红。
 */

// 受影响卡（agentcore scenarios-catalog.ts 真目录）：S12/S13→risk（曾 403）·S15/S16/S20→dash（曾 404）。
// 一并覆盖 sim 类短键（sop/audit/project/…）确认单一口径全对。
const AFFECTED_CARDS: { sNo: string; targetView: string; expectRealKey: string }[] = [
  { sNo: "S12", targetView: "risk", expectRealKey: "risk" }, // 良率波动诊断（曾落 /v/risk-board 403）
  { sNo: "S13", targetView: "risk", expectRealKey: "risk" }, // 检修窗口错峰（曾落 /v/risk-board 403）
  { sNo: "S15", targetView: "dash", expectRealKey: "dash" }, // 接单毛利评审（曾落 /v/dashboard 404）
  { sNo: "S16", targetView: "dash", expectRealKey: "dash" }, // 客户信用风险（曾落 /v/dashboard 404）
  { sNo: "S20", targetView: "dash", expectRealKey: "dash" }, // 碳足迹核算（曾落 /v/dashboard 404）
  { sNo: "S01", targetView: "project", expectRealKey: "project-sim" }, // sim 类基准
  { sNo: "S04", targetView: "audit", expectRealKey: "plan-audit" },
];

// planner 账号具 admin 全角色 → 拿到全部业务视图（能验 dash/risk/sim 全落点）。
const planner = ACCOUNTS.find((a) => a.username === "planner")!;
const ws = workspaceForAccount(planner, {}, 1) as {
  features: string[];
  views: { key: string; renderer?: string }[];
};

// ViewPage 落点解析的真复刻（pages/ViewPage.tsx §①②）：先 feature（404），后 view key（403）。
function resolveLikeViewPage(viewKey: string): "OK" | "404" | "403" {
  if (!ws.features.includes(`view.${viewKey}`)) return "404";
  if (!ws.views.find((v) => v.key === viewKey)) return "403";
  return "OK";
}

describe("LAUNCH-VIEW-KEY-ALIGN · 场景卡落点视图键单一口径（无 404/403）", () => {
  it.each(AFFECTED_CARDS)("$sNo（$targetView）归一到真键 $expectRealKey 且 ViewPage 放行", ({ targetView, expectRealKey }) => {
    const resolved = normalizeViewKey(targetView) ?? targetView;
    expect(resolved, `${targetView} 应归一到 workspace 真键`).toBe(expectRealKey);
    expect(resolveLikeViewPage(resolved), `${targetView}→/v/${resolved} 必须放行（非 404/403）`).toBe("OK");
  });

  it("回归锁：dash/risk 短键即真键，不得再别名成 dashboard/risk-board", () => {
    // 一旦别名回退，下面两断言其一变红 → 直接暴露 404/403 复发。
    expect(normalizeViewKey("dash")).toBe("dash");
    expect(normalizeViewKey("risk")).toBe("risk");
    // 反证：若归一到旧长键，ViewPage 立即 404 / 403。
    expect(resolveLikeViewPage("dashboard")).toBe("404");
    expect(resolveLikeViewPage("risk-board")).toBe("403");
  });

  it("sim 类短键别名仍在（sop/quarter/audit/generate/project → 长真键·不误删）", () => {
    expect(normalizeViewKey("sop")).toBe("sop-balance");
    expect(normalizeViewKey("quarter")).toBe("quarterly-rolling");
    expect(normalizeViewKey("audit")).toBe("plan-audit");
    expect(normalizeViewKey("generate")).toBe("plan-generate");
    expect(normalizeViewKey("project")).toBe("project-sim");
  });
});
