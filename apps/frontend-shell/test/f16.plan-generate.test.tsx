import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { radarPolygonPoints, type RadarScores } from "@/views/sim/RadarChart";
import { mockPlanGenerate } from "@/mocks/simSolvers";
import { db } from "@/mocks/db";

/**
 * F16（增量 §7.11 / 验收表）：plan-generate 把 CAPEX 上限调至 30 →
 * 进取方案 ⛔ 消失、综合分恢复、推荐徽章按新 total 重新归属；
 * 雷达多边形顶点与 scores 数值一致（自绘 SVG 坐标断言，维度顺序固定 盈利/规模/现金/增长/稳健）。
 */
describe("F16 · 规划建议（plan-generate）目标面板与三方案卡", () => {
  it("CAPEX 上限 20→30：进取 ⛔ 消失（路径 B→C）、综合分恢复、推荐按新 total 归属；雷达 SVG 坐标断言", async () => {
    loginAs("planner");
    renderApp("/v/plan-generate");

    // 默认目标（capexCap=20）下三方案纵向卡：稳健(A) / 均衡(E) / 进取（B 保规模型 → C15 硬约束冲突）
    const s3 = await screen.findByTestId("scheme-S3");
    expect(screen.getByTestId("scheme-S1")).toHaveTextContent("稳健");
    expect(screen.getByTestId("scheme-S2")).toHaveTextContent("均衡");
    expect(s3).toHaveTextContent("进取");
    expect(screen.getByTestId("hardviol-badge-S3")).toHaveTextContent("C15");
    expect(screen.getByTestId("scheme-score-S3")).toHaveTextContent("⛔");
    expect(s3.className).toMatch(/violDim/); // 整卡降透明度（opacity 0.85）
    // ★ 推荐徽章：无硬约束冲突中综合分最高 = 均衡(E)
    expect(screen.getByTestId("recommend-badge-S2")).toHaveTextContent("推荐");
    expect(screen.queryByTestId("recommend-badge-S1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("recommend-badge-S3")).not.toBeInTheDocument();
    // 硬约束 chips（毛利/现金/CAPEX）默认 on
    expect(screen.getByTestId("hard-chip-gmFloorPct")).toHaveTextContent("硬约束");
    expect(screen.getByTestId("hard-chip-capexCap")).toHaveTextContent("硬约束");

    // 目标面板改 CAPEX 上限 → 30（改动即重算全部方案，debounce 300ms）
    fireEvent.change(screen.getByTestId("goal-capexCap"), { target: { value: "30" } });

    // 进取重新收敛为路径 C（扩产型，CAPEX 27 ≤ 30）：⛔ 消失、综合分恢复为 72
    await waitFor(() => expect(screen.queryByTestId("hardviol-badge-S3")).not.toBeInTheDocument());
    expect(screen.getByTestId("scheme-S3")).toHaveTextContent("基于路径 C");
    expect(screen.getByTestId("scheme-score-S3")).toHaveTextContent("72");
    expect(screen.getByTestId("scheme-S3").className).not.toMatch(/violDim/);
    // 推荐按新 total 重新归属：E(73) > A(72) = C(72) → 仍为 S2
    expect(screen.getByTestId("recommend-badge-S2")).toBeInTheDocument();
    expect(screen.queryByTestId("recommend-badge-S3")).not.toBeInTheDocument();

    // 雷达多边形顶点与 scores 数值一致（与 mock 求解器同构计算 → SVG points 逐字相等）
    const expected = mockPlanGenerate({ targets: { capexCap: 30 } }) as {
      schemes: { no: string; scores: RadarScores & { total: number } }[];
    };
    const s2Scores = expected.schemes.find((s) => s.no === "S2")!.scores;
    const polygon = screen.getByTestId("radar-S2-polygon");
    expect(polygon.getAttribute("points")).toBe(radarPolygonPoints(s2Scores, 180));
    // 展开体三栏之一：目标达成清单六项 meet*（server-side meets 字段 → ✓/✗ 行）
    expect(screen.getByTestId("meet-S2-meetGm")).toHaveTextContent("✓");
    expect(screen.getByTestId("meet-S2-meetShare")).toHaveTextContent("✓"); // E 份额 +14 ≥ +12
    expect(screen.getByTestId("meet-S2-meetTurns")).toBeInTheDocument(); // 六项齐全
  });

  it("采纳按钮（actionType=采纳经营方案）：payload=方案快照+当前目标面板值 → 草稿待审批", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/plan-generate");

    await screen.findByTestId("scheme-S2");
    // 推荐方案默认展开 → 采纳
    await user.click(await screen.findByTestId("adopt-scheme-S2"));
    expect(await screen.findByText(/草稿已创建，待审批/)).toBeInTheDocument();

    const draft = db.actionDrafts[0]!;
    expect(draft.actionTypeKey).toBe("采纳经营方案");
    expect(draft.status).toBe("PENDING_APPROVAL");
    const payload = draft.payload as { schemeNo: string; pathKey: string; targets: { capexCap: number; hard: { gm: boolean } } };
    expect(payload.schemeNo).toBe("S2");
    expect(payload.pathKey).toBe("E");
    expect(payload.targets.capexCap).toBe(20);
    expect(payload.targets.hard.gm).toBe(true);
  });
});
