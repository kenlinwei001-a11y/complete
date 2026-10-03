import type { PlanBuilderCanvas } from "@platform/contracts";
// 从**叶子**模块取，不从 fixtures 取 —— 从 fixtures 取会成环（见 ids.ts 文件头）。
import { TENANT_ID, PACKAGE_ID } from "./ids";

/** WO-A · PlanBuilder 示例画布（Phase 1：线性 INPUT→SOLVER→TRANSFORM→OUTPUT）。 */
export const PLAN_BUILDER_FIXTURES: PlanBuilderCanvas[] = [
  {
    id: "pbc_demo_1",
    tenantId: TENANT_ID,
    packageId: PACKAGE_ID,
    key: "capacity_chain",
    version: 1,
    name: "产能推演链",
    description: "INPUT baseId → SOLVER capacity_forecast → OUTPUT text block",
    status: "DRAFT",
    dsl: {
      version: "1",
      nodes: [
        { id: "n1", type: "INPUT", label: "输入 baseId", position: { x: 80, y: 200 }, outputSchema: { type: "object", properties: { baseId: { type: "string" } } } },
        { id: "n2", type: "SOLVER", label: "产能推演", position: { x: 320, y: 200 }, solverKey: "capacity_forecast", args: { baseId: "{{n1.output.baseId}}" }, timeoutMs: 30000 },
        { id: "n3", type: "OUTPUT", label: "输出结论", position: { x: 560, y: 200 }, blocks: [{ type: "text", markdown: "产能结果：{{n2.output.capWanP50}}（万套/窗口）" }] },
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2" },
        { id: "e2", from: "n2", to: "n3" },
      ],
    },
    createdBy: "usr_demo_admin",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
  },
  {
    id: "pbc_demo_2",
    tenantId: TENANT_ID,
    packageId: PACKAGE_ID,
    key: "capacity_chain",
    version: 2,
    name: "产能推演链 v2",
    description: "增加 TRANSFORM 公式节点",
    status: "PUBLISHED",
    dsl: {
      version: "1",
      nodes: [
        { id: "n1", type: "INPUT", label: "输入", position: { x: 80, y: 200 } },
        { id: "n2", type: "SOLVER", label: "产能推演", position: { x: 300, y: 120 }, solverKey: "capacity_forecast", args: { baseId: "{{inputs.baseId}}" } },
        { id: "n3", type: "TRANSFORM", label: "格式化", position: { x: 520, y: 200 }, stepType: "llm_compose", params: { instruction: " summarizer", inputs: ["{{n2.output}}"] } },
        { id: "n4", type: "OUTPUT", label: "输出", position: { x: 740, y: 200 }, blocks: [{ type: "kpi", value: "{{n3.output}}" }] },
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2" },
        { id: "e2", from: "n2", to: "n3" },
        { id: "e3", from: "n3", to: "n4" },
      ],
    },
    compiledPlanId: "plan_published_1",
    createdBy: "usr_demo_admin",
    createdAt: "2026-07-28T01:00:00.000Z",
    updatedAt: "2026-07-28T01:00:00.000Z",
  },
  {
    id: "pbc_demo_3",
    tenantId: TENANT_ID,
    packageId: PACKAGE_ID,
    key: "risk_chain",
    version: 1,
    name: "风险订单链",
    status: "DRAFT",
    dsl: {
      version: "1",
      nodes: [
        { id: "n1", type: "INPUT", label: "输入基地", position: { x: 80, y: 200 } },
        { id: "n2", type: "SOLVER", label: "影响订单", position: { x: 320, y: 200 }, solverKey: "affected_orders", args: { base: "{{inputs.baseId}}" } },
        { id: "n3", type: "OUTPUT", label: "输出", position: { x: 560, y: 200 }, blocks: [{ type: "table", rows: "{{n2.output.rows}}" }] },
      ],
      edges: [{ id: "e1", from: "n1", to: "n2" }, { id: "e2", from: "n2", to: "n3" }],
    },
    createdBy: "usr_demo_admin",
    createdAt: "2026-07-28T02:00:00.000Z",
    updatedAt: "2026-07-28T02:00:00.000Z",
  },
];

/** 测试/复位用：创建新的空白画布。 */
export function newPlanBuilderCanvas(id: string, packageId: string): PlanBuilderCanvas {
  return {
    id,
    tenantId: TENANT_ID,
    packageId,
    key: `plan_${id.slice(-6)}`,
    version: 1,
    name: "新建画布",
    status: "DRAFT",
    dsl: {
      version: "1",
      nodes: [
        { id: "n1", type: "INPUT", label: "输入", position: { x: 80, y: 200 } },
        { id: "n2", type: "OUTPUT", label: "输出", position: { x: 320, y: 200 }, blocks: [] },
      ],
      edges: [{ id: "e1", from: "n1", to: "n2" }],
    },
    createdBy: "usr_demo_admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
