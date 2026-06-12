import type { ExecutionPlan, IntentDefinition, ScenarioPackage } from "@platform/contracts";
import { BUILTIN_TOOLS } from "../tools/registry.js";

/** QOS-PRD §7.6 seed data: battery-manufacturing scenario package. */

export const SEED_TENANT = "tenant-demo";
export const SEED_PACKAGE_ID = "pkg_battery_manufacturing";

export interface SeedBase {
  objectId: string;
  name: string;
  util: number;
  bottleneck: string;
  gwh: number;
  kind: "动力" | "储能";
}

export const SEED_BASES: SeedBase[] = [
  { objectId: "base_changzhou", name: "常州", util: 0.92, bottleneck: "化成", gwh: 24, kind: "动力" },
  { objectId: "base_hefei", name: "合肥", util: 0.81, bottleneck: "卷绕", gwh: 18, kind: "动力" },
  { objectId: "base_yibin", name: "宜宾", util: 0.77, bottleneck: "涂布", gwh: 30, kind: "动力" },
  { objectId: "base_xian", name: "西安", util: 0.69, bottleneck: "装配", gwh: 12, kind: "动力" },
  { objectId: "base_liyang", name: "溧阳", util: 0.88, bottleneck: "化成", gwh: 20, kind: "动力" },
  { objectId: "base_yancheng", name: "盐城", util: 0.73, bottleneck: "注液", gwh: 15, kind: "储能" },
  { objectId: "base_zhaoqing", name: "肇庆", util: 0.66, bottleneck: "涂布", gwh: 10, kind: "储能" },
  { objectId: "base_yichun", name: "宜春", util: 0.71, bottleneck: "卷绕", gwh: 14, kind: "储能" },
  { objectId: "base_chengdu", name: "成都", util: 0.84, bottleneck: "装配", gwh: 16, kind: "动力" },
  { objectId: "base_qingdao", name: "青岛", util: 0.62, bottleneck: "化成", gwh: 8, kind: "储能" },
  { objectId: "base_xiamen", name: "厦门", util: 0.79, bottleneck: "注液", gwh: 11, kind: "储能" },
  { objectId: "base_guiyang", name: "贵阳", util: 0.58, bottleneck: "涂布", gwh: 9, kind: "储能" },
];

export interface SeedModel {
  objectId: string;
  name: string;
  bases: string[]; // 可产基地（名称）
}

export const SEED_MODELS: SeedModel[] = [
  { objectId: "model_4680_ncm", name: "4680-NCM", bases: ["常州", "宜宾", "溧阳"] },
  { objectId: "model_4680_lfp", name: "4680-LFP", bases: ["合肥", "宜宾"] },
  { objectId: "model_m3p", name: "M3P-标准", bases: ["常州", "成都"] },
  { objectId: "model_blade_lfp", name: "刀片-LFP", bases: ["西安", "盐城", "肇庆"] },
  { objectId: "model_21700_ncm", name: "21700-NCM", bases: ["溧阳", "厦门"] },
  { objectId: "model_ctp_lfp", name: "CTP-LFP", bases: ["宜春", "青岛", "贵阳"] },
];

export interface SeedOrder {
  objectId: string;
  so: string;
  cust: string;
  model: string;
  qty: number;
  due: string;
  bases: string[];
}

const CUSTS = ["蔚云汽车", "极风出行", "北辰储能", "光启能源", "山海重工"];

export const SEED_ORDERS: SeedOrder[] = Array.from({ length: 20 }, (_, i) => {
  const model = SEED_MODELS[i % SEED_MODELS.length] as SeedModel;
  const primaryBase = model.bases[i % model.bases.length] as string;
  return {
    objectId: `order_${String(i + 1).padStart(3, "0")}`,
    so: `SO-${String(10001 + i)}`,
    cust: CUSTS[i % CUSTS.length] as string,
    model: model.name,
    qty: 500 + ((i * 137) % 4500),
    due: `2026-0${(i % 6) + 1}-${String((i % 27) + 1).padStart(2, "0")}`,
    bases: [primaryBase, ...(i % 3 === 0 ? [model.bases[(i + 1) % model.bases.length] as string] : [])],
  };
});

export function seedScenarioPackage(now = new Date().toISOString()): ScenarioPackage {
  return {
    id: SEED_PACKAGE_ID,
    tenantId: SEED_TENANT,
    name: "battery-manufacturing",
    views: ["dash", "risk", "order"],
    toolWhitelist: BUILTIN_TOOLS.map((t) => t.name),
    createdAt: now,
    updatedAt: now,
  };
}

/** Published intents ×4 with plans (QOS-PRD §7.6). */
export function seedIntentsAndPlans(now = new Date().toISOString()): {
  intents: IntentDefinition[];
  plans: ExecutionPlan[];
} {
  const plans: ExecutionPlan[] = [
    {
      id: "plan_affected_orders_v1",
      packageId: SEED_PACKAGE_ID,
      key: "affected_orders",
      version: 1,
      status: "PUBLISHED",
      steps: [
        {
          id: "s1",
          type: "invoke_solver",
          params: {
            solverKey: "affected_orders",
            args: {
              baseId: "{{slots.base.objectId}}",
              fromDay: "{{slots.timeWindow}}",
              toDay: "{{slots.timeWindow}}",
            },
          },
        },
        {
          id: "render",
          type: "render_answer",
          params: {
            blocks: [
              {
                type: "table",
                columns: ["订单号", "客户", "型号", "数量", "交期"],
                rows: "{{steps.s1.output.data.rows}}",
                fromStep: "s1",
              },
              {
                type: "text",
                markdown: "受影响订单共 {{steps.s1.output.data.count}} 张，明细见上表 ⟦ref:0⟧。",
              },
            ],
          },
        },
      ],
    },
    {
      id: "plan_capacity_feasibility_v1",
      packageId: SEED_PACKAGE_ID,
      key: "capacity_feasibility",
      version: 1,
      status: "PUBLISHED",
      steps: [
        {
          id: "s1",
          type: "resolve_slice",
          params: { sliceKey: "model_capacity_network", args: { modelId: "{{slots.model.objectId}}" } },
        },
        {
          id: "s2",
          type: "invoke_solver",
          params: {
            solverKey: "capacity_forecast",
            args: {
              modelId: "{{slots.model.objectId}}",
              demandDelta: "{{slots.demandDelta}}",
              weeks: "{{slots.weeks}}",
            },
          },
        },
        {
          id: "s3",
          type: "evaluate_rules",
          params: { ruleIds: ["C03"], payload: { demandDelta: "{{slots.demandDelta}}" } },
        },
        {
          id: "render",
          type: "render_answer",
          params: {
            blocks: [
              { type: "kpi", label: "P50 产能", value: "{{steps.s2.output.data.p50}}", unit: "GWh", fromStep: "s2" },
              { type: "kpi", label: "P90 产能", value: "{{steps.s2.output.data.p90}}", unit: "GWh", fromStep: "s2" },
              { type: "kpi", label: "缺口比例", value: "{{steps.s2.output.data.gapPct}}", unit: "%", fromStep: "s2" },
              {
                type: "text",
                markdown:
                  "主要瓶颈为{{steps.s2.output.data.mainBottleneck}}，P50/P90 与缺口见上方指标 ⟦ref:0⟧⟦ref:1⟧⟦ref:2⟧。",
              },
            ],
          },
        },
      ],
    },
    {
      id: "plan_risk_root_cause_v1",
      packageId: SEED_PACKAGE_ID,
      key: "risk_root_cause",
      version: 1,
      status: "PUBLISHED",
      steps: [
        {
          id: "s1",
          type: "resolve_slice",
          params: { sliceKey: "base_risk_profile", args: { baseId: "{{slots.base.objectId}}" } },
        },
        {
          id: "render",
          type: "render_answer",
          params: {
            blocks: [
              {
                type: "text",
                markdown: "{{steps.s1.output.data.summary}} ⟦ref:0⟧",
                fromStep: "s1",
              },
            ],
          },
        },
      ],
    },
    {
      id: "plan_adopt_mitigation_v1",
      packageId: SEED_PACKAGE_ID,
      key: "adopt_mitigation",
      version: 1,
      status: "PUBLISHED",
      steps: [
        {
          id: "s1",
          type: "evaluate_rules",
          params: {
            ruleIds: ["C13"],
            payload: { baseId: "{{slots.base.objectId}}", solutionName: "{{slots.solutionName}}" },
          },
        },
        {
          id: "s2",
          type: "create_action_draft",
          params: {
            actionType: "adopt_mitigation",
            payload: { baseId: "{{slots.base.objectId}}", solutionName: "{{slots.solutionName}}" },
          },
        },
        {
          id: "render",
          type: "render_answer",
          params: {
            blocks: [
              {
                type: "action_draft",
                draftId: "{{steps.s2.output.draftId}}",
                actionType: "adopt_mitigation",
                summary: "已生成「{{slots.solutionName}}」处置方案草稿，待审批。",
              },
              {
                type: "text",
                markdown: "草稿已提交审批流程，本系统不会直接执行写操作。",
              },
            ],
          },
        },
      ],
    },
  ];

  const intents: IntentDefinition[] = [
    {
      id: "int_affected_orders_v1",
      packageId: SEED_PACKAGE_ID,
      key: "affected_orders",
      version: 1,
      status: "PUBLISHED",
      name: "受影响订单查询",
      description: "查询某基地在给定时间窗内停产/降产时受影响的订单清单。",
      examples: ["影响哪些订单？", "常州停产影响哪些订单", "这个基地的订单交付受什么影响"],
      enabledViews: "*",
      slots: [
        {
          name: "base",
          type: "objectRef",
          required: true,
          defaultFrom: "$.selectedObjects[0]",
          clarifyPrompt: "请提供基地",
          description: "受影响的基地（Base 对象引用）",
        },
        {
          name: "timeWindow",
          type: "timeWindow",
          required: false,
          description: "时间窗（可选）",
        },
      ],
      planId: "plan_affected_orders_v1",
      riskLevel: "COMPUTE",
      owner: "seed",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "int_capacity_feasibility_v1",
      packageId: SEED_PACKAGE_ID,
      key: "capacity_feasibility",
      version: 1,
      status: "PUBLISHED",
      name: "需求增量能否承接",
      description: "判断某型号增加一定需求比例、给定周数内产能是否能承接。",
      examples: ["4680-NCM 加 20% 六周能不能接？", "M3P 增加 10% 产能够吗", "需求上调后能不能交付"],
      enabledViews: "*",
      slots: [
        { name: "model", type: "objectRef", required: true, description: "型号（Model 对象引用）" },
        { name: "demandDelta", type: "number", required: true, description: "需求增量比例（0.2 表示 +20%）" },
        { name: "weeks", type: "number", required: false, description: "周数，缺省 6" },
      ],
      planId: "plan_capacity_feasibility_v1",
      riskLevel: "COMPUTE",
      owner: "seed",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "int_risk_root_cause_v1",
      packageId: SEED_PACKAGE_ID,
      key: "risk_root_cause",
      version: 1,
      status: "PUBLISHED",
      name: "风险根因分析",
      description: "解释某基地在某天风险越线的根因。",
      examples: ["为什么这天越线", "常州为什么风险高", "风险根因是什么"],
      enabledViews: "*",
      slots: [
        {
          name: "base",
          type: "objectRef",
          required: true,
          defaultFrom: "$.selectedObjects[0]",
          description: "基地对象引用",
        },
        { name: "day", type: "date", required: false, description: "日期（可选）" },
      ],
      planId: "plan_risk_root_cause_v1",
      riskLevel: "READ",
      owner: "seed",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "int_adopt_mitigation_v1",
      packageId: SEED_PACKAGE_ID,
      key: "adopt_mitigation",
      version: 1,
      status: "PUBLISHED",
      name: "采纳处置方案",
      description: "把某基地的处置方案落为 Action 草稿提交审批（不直接执行）。",
      examples: ["采纳常州的三班制方案", "执行外协方案", "采纳处置建议"],
      enabledViews: "*",
      slots: [
        {
          name: "base",
          type: "objectRef",
          required: true,
          defaultFrom: "$.selectedObjects[0]",
          description: "基地对象引用",
        },
        {
          name: "solutionName",
          type: "enum",
          required: true,
          enumValues: ["三班制", "外协", "调拨"],
          description: "处置方案名",
        },
      ],
      planId: "plan_adopt_mitigation_v1",
      riskLevel: "ACTION_DRAFT",
      owner: "seed",
      createdAt: now,
      updatedAt: now,
    },
  ];

  return { intents, plans };
}
