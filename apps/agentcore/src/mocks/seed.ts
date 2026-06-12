import type {
  AgentDefinition,
  ExecutionPlan,
  IntentDefinition,
  ScenarioPackage,
  SceneEntryConfig,
  SkillDefinition,
  WorkflowDefinition,
} from "@platform/contracts";
import { BUILTIN_TOOLS } from "../tools/registry.js";

/** QOS-PRD §7.6 seed data: battery-manufacturing scenario package. */

// 真连部署批次：与 DataCore 演示租户对齐（admin/planner/base_manager@demo, 密码 demo1234）
export const SEED_TENANT = "demo";
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
    views: ["dash", "graph", "risk", "order", "plan-audit", "plan-generate", "project-sim", "sop-balance"],
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

// ---------------------------------------------------------------------------
// 真连部署批次：B5 场景入口 + B1/B2/B4 演示注册表（boot 时缺失才播种）
// ---------------------------------------------------------------------------

export function seedSceneEntries(): SceneEntryConfig[] {
  return [
    {
      id: "scn_dash", tenantId: SEED_TENANT, viewKey: "dash", mode: "WORKFLOW_FIRST",
      uiHints: {
        placeholder: "问问经营数据，如：本月计划达成率怎么样？",
        suggestedQuestions: ["4680-NCM 加 20% 六周能不能接？", "对比一下储能基地和动力基地的平均利用率"],
      },
    },
    {
      id: "scn_risk", tenantId: SEED_TENANT, viewKey: "risk", mode: "WORKFLOW_FIRST",
      uiHints: {
        placeholder: "针对选中基地提问，如：影响哪些订单？",
        suggestedQuestions: ["影响哪些订单？", "为什么这天越线", "采纳常州的三班制方案"],
      },
    },
    {
      id: "scn_order", tenantId: SEED_TENANT, viewKey: "order", mode: "WORKFLOW_FIRST",
      uiHints: { placeholder: "查订单，如：影响哪些订单？", suggestedQuestions: ["影响哪些订单？"] },
    },
    {
      id: "scn_graph", tenantId: SEED_TENANT, viewKey: "graph", mode: "AGENT_FIRST", defaultAgentId: "agt_seed_explore",
      uiHints: { placeholder: "围绕本体随便问", suggestedQuestions: ["哪个客户的订单延期风险最高"] },
    },
    {
      id: "scn_plan_audit", tenantId: SEED_TENANT, viewKey: "plan-audit", mode: "WORKFLOW_ONLY",
      uiHints: { placeholder: "规划体检相关问题", suggestedQuestions: [] },
    },
    {
      id: "scn_plan_generate", tenantId: SEED_TENANT, viewKey: "plan-generate", mode: "WORKFLOW_FIRST",
      uiHints: { placeholder: "方案生成相关问题", suggestedQuestions: [] },
    },
    {
      id: "scn_project_sim", tenantId: SEED_TENANT, viewKey: "project-sim", mode: "WORKFLOW_FIRST",
      uiHints: { placeholder: "项目沙盘推演相关问题", suggestedQuestions: ["4680-NCM 加 20% 六周能不能接？"] },
    },
    {
      id: "scn_sop_balance", tenantId: SEED_TENANT, viewKey: "sop-balance", mode: "WORKFLOW_FIRST",
      uiHints: { placeholder: "S&OP 月度平衡相关问题", suggestedQuestions: [] },
    },
  ];
}

export function seedRegistry(now = new Date().toISOString()): {
  agents: AgentDefinition[];
  workflows: WorkflowDefinition[];
  skills: SkillDefinition[];
} {
  const workflows: WorkflowDefinition[] = [
    {
      id: "wf_seed_capacity", tenantId: SEED_TENANT, key: "capacity_check", version: 1,
      name: "产能校核流程", description: "型号需求增量可行性校核（resolve → solve → rules → render）",
      inputs: {
        type: "object",
        properties: { model: { type: "string" }, demandDelta: { type: "number" }, weeks: { type: "number" } },
      },
      steps: [
        { id: "s1", type: "query_objects", params: { objectType: "Model", filter: {} } },
        {
          id: "s2", type: "invoke_solver",
          params: { solverKey: "capacity_forecast", args: { modelId: "{{slots.model}}", demandDelta: "{{slots.demandDelta}}", weeks: "{{slots.weeks}}" } },
        },
        { id: "s3", type: "evaluate_rules", params: { ruleIds: ["C03"], payload: { demandDelta: "{{slots.demandDelta}}" } } },
        { id: "s4", type: "render_answer", params: { blocks: [{ type: "text", markdown: "产能校核结论（见步骤溯源）" }] } },
      ] as WorkflowDefinition["steps"],
      status: "PUBLISHED",
      createdAt: now,
      updatedAt: now,
    },
  ];
  const skills: SkillDefinition[] = [
    {
      id: "skl_seed_capacity", tenantId: SEED_TENANT, key: "capacity_analysis", version: 1,
      name: "产能分析方法论", summary: "产能金字塔口径与 P50/P90 解读要点。",
      body: "# 产能分析\n\n1. 先看型号认证状态（量产/认证中）。\n2. P50 看均衡产线，P90 看保守口径。\n3. 缺口为负时优先评估外协与排程平移。",
      resources: [], status: "PUBLISHED",
    },
  ];
  const agents: AgentDefinition[] = [
    {
      id: "agt_seed_explore", tenantId: SEED_TENANT, key: "explore_agent", version: 1,
      name: "探索分析 Agent", description: "目录外问题兜底分析（路径 B）",
      model: "claude-opus-4-8",
      systemPrompt: "你是企业决策系统的分析助手。所有业务数字必须来自工具结果并以 ⟦ref:N⟧ 标注；无法溯源的数字需声明 unverified。",
      tools: [
        { kind: "BUILTIN", name: "query_objects" },
        { kind: "BUILTIN", name: "invoke_solver" },
        { kind: "WORKFLOW", workflowId: "wf_seed_capacity", version: "latest" },
      ] as AgentDefinition["tools"],
      ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "POST_CHECK" },
      skills: [{ skillId: "skl_seed_capacity", version: "latest" }],
      mcpServers: [],
      scopeDeclaration: { objectTypes: ["Base", "Order", "Model", "Line"], toolNames: ["query_objects", "invoke_solver"] },
      budget: { maxIterations: 8, maxToolCalls: 10 },
      status: "PUBLISHED",
    },
  ];
  return { agents, workflows, skills };
}
