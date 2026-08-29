import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { radarPolygonPoints, type RadarScores } from "@/views/sim/RadarChart";
import { mockPlanGenerate } from "@/mocks/simSolvers";
import { db } from "@/mocks/db";

/**
 * F16 · plan-generate（PRD-IND 1:1）：5 路径 → 壹/贰/叁（稳健·守盈利 / 均衡 / 进取·冲规模，§4.4 动态选择）；
 * ★推荐=三案可行 total 最高；雷达 SVG 坐标=mock 同构；外部信号敏感性 + 必须解决问题(why+4 节点传导链) 渲染。
 * 期望值经 mockPlanGenerate 派生（取值对齐 HTML 后不再写死 S1/S2/S3 与固定路径）。
 */
const EXP = mockPlanGenerate({}) as {
  schemes: { no: string; name: string; pathKey: string; hardViol: string[]; scores: RadarScores & { total: number }; extSensitivity?: unknown[] }[];
  recommend: string;
};

describe("F16 · 规划建议（plan-generate）目标面板与三方案卡（1:1）", () => {
  it("三方案 壹/贰/叁 + ★推荐(可行 total 最高) + 雷达坐标 + 外部敏感性/问题传播链", async () => {
    loginAs("planner");
    renderApp("/v/plan-generate");

    // 三方案纵向卡：壹 稳健·守盈利 / 贰 均衡 / 叁 进取·冲规模
    await screen.findByTestId("scheme-壹");
    expect(screen.getByTestId("scheme-壹")).toHaveTextContent("稳健");
    expect(screen.getByTestId("scheme-贰")).toHaveTextContent("均衡");
    expect(screen.getByTestId("scheme-叁")).toHaveTextContent("进取");

    // ★推荐 = mock 派生的 recommend 所在方案（可行且 total 最高）
    const recScheme = EXP.schemes.find((s) => s.pathKey === EXP.recommend && s.hardViol.length === 0)!;
    expect(screen.getByTestId(`recommend-badge-${recScheme.no}`)).toHaveTextContent("推荐");

    // 硬约束 chips 默认 on
    expect(screen.getByTestId("hard-chip-gmFloorPct")).toHaveTextContent("硬约束");
    // 新增目标字段：库存周转
    expect(screen.getByTestId("goal-invTurns")).toBeInTheDocument();

    // 推荐方案默认展开（useEffect 异步）→ 雷达多边形顶点与 mock scores 同构
    const polygon = await screen.findByTestId(`radar-${recScheme.no}-polygon`);
    expect(polygon.getAttribute("points")).toBe(radarPolygonPoints(recScheme.scores, 180));

    // 目标达成六行齐全
    expect(screen.getByTestId(`meet-${recScheme.no}-meetTurns`)).toBeInTheDocument();

    // PRD-IND §2.3-6/7：外部信号敏感性 + 必须解决问题(传导链 4 节点)
    const extsens = await screen.findByTestId(`extsens-${recScheme.no}`);
    expect(within(extsens).getByTestId(`extsens-${recScheme.no}-0`)).toBeInTheDocument();
    expect(screen.getByTestId(`focus-keys-${recScheme.no}`)).toBeInTheDocument();
    expect(screen.getByTestId(`prob-chain-${recScheme.no}-0`)).toBeInTheDocument();
  });

  it("采纳按钮（actionType=采纳经营方案）：payload=方案快照(壹/贰/叁)+当前目标面板值 → 草稿待审批", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/plan-generate");

    const recScheme = EXP.schemes.find((s) => s.pathKey === EXP.recommend && s.hardViol.length === 0)!;
    await screen.findByTestId(`scheme-${recScheme.no}`);
    await user.click(await screen.findByTestId(`adopt-scheme-${recScheme.no}`));
    expect(await screen.findByText(/草稿已创建，待审批/)).toBeInTheDocument();

    const draft = db.actionDrafts[0]!;
    expect(draft.actionTypeKey).toBe("采纳经营方案");
    expect(draft.status).toBe("PENDING_APPROVAL");
    const payload = draft.payload as { schemeNo: string; pathKey: string; targets: { capexCap: number; turnsFloor: number; hard: { gm: boolean } } };
    expect(payload.schemeNo).toBe(recScheme.no);
    expect(payload.pathKey).toBe(recScheme.pathKey);
    expect(payload.targets.capexCap).toBe(20);
    expect(payload.targets.turnsFloor).toBe(6.0); // 新增库存周转目标透传
    expect(payload.targets.hard.gm).toBe(true);
  });
});
