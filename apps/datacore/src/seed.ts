import type { PropagationRule } from "@platform/contracts";
import type { Repos } from "./repo/repo.js";
import { AuthService } from "./auth.js";
import type { AuthCtx } from "./domain.js";
import type { SyntheticService } from "./synthetic/service.js";

export const DEMO_TENANT = "demo";

/** Seed tenant "demo" + admin/planner/base_manager(常州) accounts (password demo1234). */
export async function seedDemo(repos: Repos): Promise<AuthCtx> {
  const tenant = await repos.tenants.get(DEMO_TENANT, DEMO_TENANT);
  if (!tenant) {
    await repos.tenants.put({
      id: DEMO_TENANT,
      tenantId: DEMO_TENANT,
      name: "全域数字化智能决策支撑系统",
      industry: "battery-manufacturing",
    });
  }
  const wanted: { username: string; roles: string[]; attributes: Record<string, unknown> }[] = [
    // admin 演示账号持有全部管理角色（admin + planner + catalog_admin + tenant_admin），保证所有管理台可见
    // tenant_admin 为管理平台增量 §2 的用户管理入口角色（additive）
    { username: "admin", roles: ["admin", "planner", "catalog_admin", "tenant_admin"], attributes: {} },
    { username: "planner", roles: ["planner"], attributes: {} },
    {
      username: "base_manager",
      roles: ["base_manager:常州"],
      attributes: { baseScope: ["changzhou"], baseName: "常州" },
    },
    // 第二位 admin 审批人：S2 审批链「发起人不得自批」——若租户只有一个 admin，
    // admin 发起的审批（校准批准/AOP 拍板等）会 422 NO_ELIGIBLE_APPROVER。
    { username: "approver", roles: ["approver", "admin"], attributes: {} },
  ];
  for (const w of wanted) {
    const existing = (await repos.users.list(DEMO_TENANT, (u) => u.username === w.username))[0];
    if (existing) continue;
    await repos.users.put({
      id: `usr_${DEMO_TENANT}_${w.username}`,
      tenantId: DEMO_TENANT,
      username: w.username,
      passwordHash: await AuthService.hashPassword("demo1234"),
      roles: w.roles,
      attributes: w.attributes,
    });
  }
  return { tenantId: DEMO_TENANT, userId: `usr_${DEMO_TENANT}_admin`, roles: ["admin"], attributes: {} };
}

/**
 * SEED_DEMO=1 → generate the battery synthetic dataset for tenant demo with seed 42.
 * SEED_LIVED_IN=1 → 额外回放 365 天运营态（运营回顾 / 风险历史案例 / 校准史等才有数据）。
 */
export async function seedDemoSynthetic(synthetic: SyntheticService, ctx: AuthCtx): Promise<void> {
  const livedIn = process.env.SEED_LIVED_IN === "1";
  await synthetic.runJob(ctx, { industry: "battery-manufacturing", scale: "S", seed: 42, livedIn });
}

/**
 * SEED_DEMO=1 → 给 demo 租户播 sim PropagationRule 种子（消"空世界"，审计 §3.5）。
 *
 * 为什么需要：传导引擎（增量3）真过 live-fire，但 demo 租户从没种过传导规则 →
 * `GET /a/v1/sim/view-config` 返 propagationCount=0 / stateVars=[]，沙盘开箱无内容可推。
 * 这里沿 demo 真实本体（battery）已有对象类型/链路播几条 PUBLISHED 规则，让沙盘开箱即有传导拓扑。
 *
 * 边界（不变量）：
 *  - R2 tenant_id：全部落 DEMO_TENANT；跨租户读不到。
 *  - R6 确定性：固定 id/key/系数/延迟，同 SEED_DEMO 重跑字节一致；putPropagationRule 幂等覆盖。
 *  - 正交于电池合成：PropagationRule 是独立 sim 表（migration026），不碰 battery 字节一致基线。
 *  - 沿真链路：sourceTypeKey/viaLinkKey/targetTypeKey 均为 demo 本体真有的对象类型/链路 key
 *    （battery.ts：Order/Model/Base/Line + order_for_model/model_producible_at/line_belongs_to_base）。
 *  - stateVars 非显式声明——view-config 自动从规则 source/target stateVar 派生（种了规则即非空）。
 */
const DEMO_PROPAGATION_RULES: ReadonlyArray<Omit<PropagationRule, "tenantId">> = [
  // ① 订单需求压力 → 沿"订单属型号"边推到型号需求负载（即时，强相关）。
  {
    id: "simpr_demo_order_demand",
    key: "demo_order_demand_pressure",
    sourceTypeKey: "Order",
    sourceStateVar: "demandPressure",
    viaLinkKey: "order_for_model",
    targetTypeKey: "Model",
    targetStateVar: "demandLoad",
    coefficient: 0.8,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    status: "PUBLISHED",
  },
  // ② 型号需求负载 → 沿"型号可产于基地"边推到基地负载指数（即时）。
  {
    id: "simpr_demo_model_to_base",
    key: "demo_model_demand_to_base_load",
    sourceTypeKey: "Model",
    sourceStateVar: "demandLoad",
    viaLinkKey: "model_producible_at",
    targetTypeKey: "Base",
    targetStateVar: "loadIndex",
    coefficient: 0.6,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    status: "PUBLISHED",
  },
  // ③ 产线利用率压力 → 沿"产线归属基地"边推到基地负载指数（延迟 1 tick，演示时序传导）。
  {
    id: "simpr_demo_line_to_base",
    key: "demo_line_util_to_base_load",
    sourceTypeKey: "Line",
    sourceStateVar: "utilPressure",
    viaLinkKey: "line_belongs_to_base",
    targetTypeKey: "Base",
    targetStateVar: "loadIndex",
    coefficient: 0.5,
    delayTicks: 1,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    status: "PUBLISHED",
  },
];

/**
 * 播 demo 的 sim 传导规则种子（幂等：固定 id + 直接 put 覆盖）。仅写 sim 仓储，不动合成。
 * 由 SEED_DEMO 启动路径在 seedDemoSynthetic 之后调用（本体已物化才有链路可挂）。
 */
export async function seedDemoPropagationRules(repos: Repos): Promise<void> {
  for (const r of DEMO_PROPAGATION_RULES) {
    await repos.sim.putPropagationRule({ ...r, tenantId: DEMO_TENANT });
  }
}
