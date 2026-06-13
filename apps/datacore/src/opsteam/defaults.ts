import type { OpsPlaybook, VirtualPersona } from "@platform/contracts";

/**
 * 回放编排器 §1 默认编制 6 人虚拟操作团队 + §2 默认 OpsPlaybook。
 *
 * 账号与真人同表（User），isVirtual:true（登录禁用、审计可识别、前端头像徽标）。
 * roles 与真实角色同体系；attributes 行级（基地负责人持 baseScope，问出的回答只含本基地）。
 */

export const DEFAULT_PERSONAS: VirtualPersona[] = [
  {
    username: "vp_planner_zhang",
    displayName: "张计划员（常州视角）",
    roles: ["planner"],
    attributes: { view: "changzhou" },
    isVirtual: true,
    styleSeed: 101,
  },
  {
    username: "vp_planner_wang",
    displayName: "王计划员（合肥视角）",
    roles: ["planner"],
    attributes: { view: "hefei" },
    isVirtual: true,
    styleSeed: 102,
  },
  {
    username: "vp_approver_li",
    displayName: "李审批人",
    roles: ["admin"],
    attributes: {},
    isVirtual: true,
    styleSeed: 201,
  },
  {
    username: "vp_sop_host",
    displayName: "S&OP 主持人",
    roles: ["planner", "tenant_admin"],
    attributes: {},
    isVirtual: true,
    styleSeed: 301,
  },
  {
    username: "vp_base_mgr_changzhou",
    displayName: "常州基地负责人",
    roles: ["base_manager:常州"],
    attributes: { baseScope: ["changzhou"], baseName: "常州" },
    isVirtual: true,
    styleSeed: 401,
  },
  {
    username: "vp_catalog_op",
    displayName: "目录运营",
    roles: ["catalog_admin"],
    attributes: {},
    isVirtual: true,
    styleSeed: 501,
  },
];

export const DEFAULT_PLAYBOOK: OpsPlaybook = {
  key: "battery_ops_default",
  version: 1,
  cadence: {
    daily: [
      { kind: "ask", persona: "vp_planner_zhang", view: "risk", queryPool: "planner_daily", prob: 0.6 },
      { kind: "ask", persona: "vp_planner_wang", view: "dash", queryPool: "planner_daily", prob: 0.5 },
      { kind: "ask", persona: "vp_base_mgr_changzhou", view: "risk", queryPool: "base_manager_daily", prob: 0.45 },
      { kind: "ask", persona: "vp_catalog_op", view: "graph", queryPool: "catalog_daily", prob: 0.3 },
    ],
    weekly: [
      { kind: "run_forecast", persona: "vp_planner_zhang", modelPool: ["S192-LFP", "4680-NCM"] },
      {
        kind: "review_actions",
        persona: "vp_approver_li",
        policy: { approve: 0.82, reject: 0.11, cancel: 0.04 },
        commentPool: "approver_comment",
      },
    ],
    monthly: [
      { kind: "sop_cycle", persona: "vp_sop_host" },
      { kind: "promote_intent", persona: "vp_catalog_op", afterFallbackCount: 3 },
    ],
    onEvent: [
      { event: "shipment_delay", actions: [{ kind: "adopt_mitigation", persona: "vp_base_mgr_changzhou" }] },
      { event: "risk_crossed", actions: [{ kind: "adopt_mitigation", persona: "vp_base_mgr_changzhou" }] },
    ],
  },
};
