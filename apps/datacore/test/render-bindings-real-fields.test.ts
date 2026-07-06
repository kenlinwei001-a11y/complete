import { describe, expect, it } from "vitest";
import { SOLVER_RENDER_BINDINGS, DATADEP_ROLE_CANONICAL, SOLVER_DATADEP } from "@platform/contracts";
import { SOLVER_OUTPUT_SHAPES } from "../src/solvers/service.js";
import { ROLE_CANONICAL } from "../src/solvers/datadep-context.js";
import { invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO ONTO-SCEN-RENDER-PROJ ① 真值齿（不作假·闭 G-2/SHAPE）：
 * 渲染投影绑定（contracts SOLVER_RENDER_BINDINGS = 场景卡 genome.renderBindings 出厂单源）必须是
 * **真实输出字段**，两层钉死：
 *  1) 静态：每条 fromSolverField ⊆ 该求解器 SOLVER_OUTPUT_SHAPES 登记形状（违反=形状漂移，红）。
 *  2) 运行期：真起 datacore（确定性合成种子世界，seed=42）→ 真 invoke 每个绑定求解器 →
 *     断言**每个绑定字段真在输出中在场**（占位/挂名字段=红）。绿即证「答案投影的字段=求解器真算出的值」。
 * 另钉 ③ 的角色映射单源：contracts DATADEP_ROLE_CANONICAL 与 datacore ROLE_CANONICAL 逐键一致（漂移红）。
 */

// 与出厂卡 presetContext/ARG_OVERRIDE 同口径的代表性入参（agentcore seed 派生计划真实会发的形态）。
const REPRESENTATIVE_ARGS: Record<string, Record<string, unknown>> = {
  plan_audit: { dem: 100, seg_pas: 50, seg_ess: 32, seg_com: 18, sup: 98, ltaCov: 60, kitGap: 100, gmTarget: 14, cashCushion: 45, capex: 8 },
  plan_generate: {},
  cert_schedule: { horizonWeeks: 12 },
  kit_readiness: { fromDay: 1, toDay: 14 },
  lta_gap: { material: "三元正极", month: "2026-07" },
  inventory_optimize: {},
  changeover_sequence: { lineId: "常州·动力线-A", week: 1 },
  yield_diagnosis: { processKey: "涂布", baseName: "常州" },
  maintenance_stagger: {},
  outsourcing_split: { gap: 80000, weeks: 6 },
  quote_margin: { custName: "电网公司F", modelId: "4680-NCM", qty: 500 },
  credit_exposure: { custName: "商用车集团G" },
  capex_scenario: { demand: [50, 48, 49, 51], s0: [45, 45, 45, 45], projects: [{ id: "P", name: "P", q0: 1, cap: 4, capex: [3, 5], m: 1800, salvageRate: 0.05, lifeQuarters: 40 }] },
  mrp_netting: {},
  quarterly_gap: { quarter: "2026Q2" },
  carbon_footprint: { modelId: "4680-NCM", baseName: "成都" },
  // QUERY30-ORCH Q01：急单挤占推演——显式争抢集（日需求 100 > 自由产能 → 触发挤占·产出四型方案+挤占清单）。
  what_if_displacement: {
    model: "MX", qty: 4200, weeks: 6, advancePct: 0.2, baseId: "常州",
    lines: [{ lineId: "L1", capacityDaily: 120, certifiedModels: ["MX", "MA"] }],
    orders: [
      { so: "A2", cust: "客户2", model: "MA", qty: 2100, pri: "低", marginPct: 20, penaltyClause: 0.05, substitutable: false, unitPrice: 500 },
      { so: "A1", cust: "客户1", model: "MA", qty: 2100, pri: "高", marginPct: 10, penaltyClause: 0.1, substitutable: false, unitPrice: 500 },
    ],
    newUnitPrice: 600,
  },
  // CORE-NL-SOLVER-ROUTING：5 个通用多跳求解器（route=graph·读对象图）代表性入参（结构合法·seedBattery
  // 世界真类型/字段/路径；handler 无条件回全形状——即便结果集空，绑定字段仍在输出中在场，真值齿只钉字段在场）。
  shared_bottleneck: { resourceType: "Base", sharedByType: "Line", viaField: "baseId", capacityField: "formationCapDaily", demandField: "capacityDaily" },
  concentration_risk: { startType: "Order", path: [{ viaField: "model", toType: "Model" }] },
  margin_attribution: { targetType: "Order", costFields: [{ field: "unitPrice", label: "单价" }] },
  supplier_disruption_radius: { rootType: "Base", rootId: "changzhou", layers: [{ type: "Line", viaField: "baseId" }, { type: "Process", viaField: "lineId" }, { type: "Equipment", viaField: "processId" }] },
  multisource_fusion: { role: "order", fields: ["due"], sources: [{ sourceLabel: "ERP", typeKey: "Order", authority: 1 }, { sourceLabel: "MES", typeKey: "Model", authority: 2 }] },
};

describe("渲染投影绑定 = 真实输出字段（WO ONTO-SCEN-RENDER-PROJ ①·真值齿）", () => {
  it("静态：每条绑定字段 ⊆ 该求解器 SOLVER_OUTPUT_SHAPES 登记形状（G-2/SHAPE 违反即红）", () => {
    expect(Object.keys(SOLVER_RENDER_BINDINGS).length).toBeGreaterThanOrEqual(16);
    for (const [solverKey, bindings] of Object.entries(SOLVER_RENDER_BINDINGS)) {
      const shape = SOLVER_OUTPUT_SHAPES[solverKey];
      expect(shape, `求解器 ${solverKey} 未在 SOLVER_OUTPUT_SHAPES 登记形状`).toBeDefined();
      for (const b of bindings) {
        expect(shape, `绑定 ${solverKey}.${b.fromSolverField} 不在登记形状 [${(shape ?? []).join(",")}]`).toContain(b.fromSolverField);
      }
    }
  });

  it("运行期：真合成种子世界 + 真 invoke 每个绑定求解器 → 每个绑定字段真在输出中（挂名/占位字段即红）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    for (const [solverKey, bindings] of Object.entries(SOLVER_RENDER_BINDINGS)) {
      const args = REPRESENTATIVE_ARGS[solverKey];
      expect(args, `缺 ${solverKey} 的代表性入参（补 REPRESENTATIVE_ARGS）`).toBeDefined();
      const res = await invokeSolver(t, solverKey, args!);
      expect(res.statusCode, `${solverKey} invoke 失败：${res.body.slice(0, 200)}`).toBe(200);
      const data = (res.json() as { data: Record<string, unknown> }).data;
      for (const b of bindings) {
        expect(
          Object.prototype.hasOwnProperty.call(data, b.fromSolverField),
          `求解器 ${solverKey} 真实输出缺绑定字段「${b.fromSolverField}」（输出键：${Object.keys(data).join(",")}）`,
        ).toBe(true);
      }
    }
  }, 60_000);

  it("③ 角色映射单源：contracts DATADEP_ROLE_CANONICAL 与 datacore ROLE_CANONICAL 逐键一致（漂移红）", () => {
    expect(DATADEP_ROLE_CANONICAL).toEqual(ROLE_CANONICAL);
    // 且清单里每个角色都可解析（deriveSliceTargetCandidates 的派生域完备）
    for (const dep of Object.values(SOLVER_DATADEP)) {
      for (const req of dep.requires) {
        expect(DATADEP_ROLE_CANONICAL[req.roleType], `角色 ${req.roleType} 无 canonical 映射`).toBeDefined();
      }
    }
  });
});
