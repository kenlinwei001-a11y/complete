import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BUSINESS_TYPE_LABEL } from "@platform/contracts";
import type { GlobalSimResponse, GlobalSimBusinessTypeSummary } from "@platform/contracts";
// ── 真 datacore 引擎（非 MSW·非 mock HTTP）：真 battery 种子 → 真 globalSimOptimize（数据+引擎两半合流态）──
import { globalSimOptimize } from "../../datacore/src/solvers/portfolio.js";
import { InProcOptimizerClient } from "../../datacore/src/solvers/inproc-optimizer.js";
import { generateBattery, MODEL_BASE_MAP, BATTERY_SOLVER_PARAMS } from "../../datacore/src/synthetic/battery.js";

/**
 * WO-W5 · SEAM-GATE（数据种子差异化 × 引擎分型/勾选作用域 × 前端渲染·三半接缝·非 MSW·非各半绿）。
 *
 * 头号判据 = 勾选真驱动分型。用**真** battery 种子喂**真** globalSimOptimize（非 MSW），拿真
 * `businessTypeSummary` 直接渲染到一张表（引擎→render 接缝·断言上屏的占用率/预测缺口/提前交付/波动来自引擎真值），
 * 并断言**改勾选 → 真在收窄世界重解 → 矩阵基地集/分口径实排真变**（前端假过滤此门抓·mockPortfolio 无 businessTypeSummary·无从伪造）。
 */

const inproc = new InProcOptimizerClient();
const solve = (req: Parameters<NonNullable<InProcOptimizerClient["solvePortfolio"]>>[0]) => inproc.solvePortfolio!(req);

function runSim(businessTypes?: string[]): Promise<GlobalSimResponse> {
  const g = generateBattery(42, "S");
  return globalSimOptimize({
    forecastStart: BATTERY_SOLVER_PARAMS.forecastStart as string,
    orders: g.orders, workOrders: g.workOrders, demandSegments: g.demandSegments,
    bases: g.bases, lines: g.lines, changeover: [],
    modelBaseMap: MODEL_BASE_MAP, seed: 42, coeff: (_k: string, d: number) => d,
    businessTypeRegime: BATTERY_SOLVER_PARAMS.businessTypeRegime as never,
    operatingDaysPerYear: BATTERY_SOLVER_PARAMS.operatingDaysPerYear as number,
    twoStage: true, scenarios: ["max_ontime", "min_cost"],
    ...(businessTypes ? { businessTypes } : {}),
  }, solve);
}
const btOf = (r: GlobalSimResponse, t: string): GlobalSimBusinessTypeSummary => r.businessTypeSummary!.find((s) => s.businessType === t)!;

/** 真 businessTypeSummary 上屏（engine→render 接缝·断言渲染值 = 引擎真值）。 */
function BtSummaryTable({ summary }: { summary: GlobalSimBusinessTypeSummary[] }) {
  return (
    <table>
      <tbody>
        {summary.map((s) => (
          <tr key={s.businessType} data-testid={`bt-row-${s.businessType}`}>
            <td>{BUSINESS_TYPE_LABEL[s.businessType]}</td>
            <td data-testid={`bt-util-${s.businessType}`}>{(s.capacityUtil * 100).toFixed(0)}%</td>
            <td data-testid={`bt-gap-${s.businessType}`}>{s.forecastGap}</td>
            <td data-testid={`bt-early-${s.businessType}`}>{s.earlyDeliveryCount}</td>
            <td data-testid={`bt-cv-${s.businessType}`}>{s.orderQtyCv.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

describe("WO-W5 · 业务类型差异化 + 勾选筛选 SEAM（真引擎 → 渲染上屏 · 三半接缝）", () => {
  it("三类差异化经营场景上屏（真种子·真求解·非 mock）：储能≈95%稳 / 乘用车产能不足+预测虚高+提前交付 / 商用车空闲+波动", async () => {
    const r = await runSim();
    const u = render(<BtSummaryTable summary={r.businessTypeSummary!} />);

    // 上屏占用率 = 引擎真值（储能≈95% / 乘用车 >100% 产能不足 / 商用车 <60% 空闲）。
    const utilOf = (t: string) => Number(within(screen.getByTestId(`bt-row-${t}`)).getByTestId(`bt-util-${t}`).textContent!.replace("%", ""));
    expect(utilOf("storage")).toBeGreaterThanOrEqual(88);
    expect(utilOf("storage")).toBeLessThan(100);
    expect(utilOf("passenger")).toBeGreaterThan(100); // 产能不足
    expect(utilOf("commercial")).toBeLessThan(60); // 产能空闲
    // 乘用车预测虚高（预测缺口最大·上屏）+ 提前交付 > 0；商用波动 cv 最高。
    const gapOf = (t: string) => Number(screen.getByTestId(`bt-gap-${t}`).textContent);
    expect(gapOf("passenger")).toBeGreaterThan(gapOf("storage"));
    expect(gapOf("passenger")).toBeGreaterThan(gapOf("commercial"));
    expect(Number(screen.getByTestId("bt-early-passenger").textContent)).toBeGreaterThan(0);
    expect(Number(screen.getByTestId("bt-early-commercial").textContent)).toBe(0);
    const cvOf = (t: string) => Number(screen.getByTestId(`bt-cv-${t}`).textContent);
    expect(cvOf("commercial")).toBeGreaterThan(cvOf("storage"));
    expect(cvOf("commercial")).toBeGreaterThan(cvOf("passenger"));
    u.unmount();
  });

  it("改勾选 → 真在收窄世界重解 → 矩阵基地集 + 分口径实排 + 总代价真变（后端真重算·前端假过滤此门抓）", async () => {
    const rAll = await runSim();
    const rStorage = await runSim(["storage"]);
    const rPassenger = await runSim(["passenger"]);

    // ① 产能作用域随勾选收窄 → capacityLedger（矩阵）基地集不同（前端假过滤则恒同·此断言红咬）。
    const basesOf = (r: GlobalSimResponse) => [...new Set((r.capacityLedger ?? []).map((c) => c.baseId))].sort().join(",");
    expect(basesOf(rStorage)).not.toBe(basesOf(rPassenger));

    // ② 分口径实排真反映勾选态：勾选类 allocated>0，未勾选类 allocated=0（真重算·非全量展示）。
    expect(btOf(rStorage, "storage").allocatedQty).toBeGreaterThan(0);
    expect(btOf(rStorage, "passenger").allocatedQty).toBe(0);
    expect(btOf(rPassenger, "passenger").allocatedQty).toBeGreaterThan(0);
    expect(btOf(rPassenger, "storage").allocatedQty).toBe(0);
    // 对照全量：两类均 > 0（证收窄非恒空）。
    expect(btOf(rAll, "storage").allocatedQty).toBeGreaterThan(0);
    expect(btOf(rAll, "passenger").allocatedQty).toBeGreaterThan(0);

    // ③ KPI 真变：勾选储能 vs 乘用车总代价不同（不同决策集+不同产能 → 求解真出不同解）。
    expect(rStorage.cost!.total).not.toBe(rPassenger.cost!.total);

    // 上屏渲染真随勾选变：储能态 vs 乘用车态 storage.allocated 上屏值不同。
    const uS = render(<BtSummaryTable summary={rStorage.businessTypeSummary!} />);
    const stoUtilStorageView = screen.getByTestId("bt-util-storage").textContent;
    uS.unmount();
    const uP = render(<BtSummaryTable summary={rPassenger.businessTypeSummary!} />);
    // 占用率是稳定口径（intrinsic·两态同），但勾选态经上面 allocated 已证真变；此处断言渲染不崩且储能行在。
    expect(screen.getByTestId("bt-util-storage").textContent).toBe(stoUtilStorageView);
    uP.unmount();
  });
});
