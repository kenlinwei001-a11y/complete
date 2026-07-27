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
 * WO-LIGHTUP：demo 租户显式点亮 5 个 QOS 暗发功能（battery「all on」模板诚实排除它们·须显式 override 开·见 features.ts
 * QOS_DARK_LAUNCH_FEATURES）。让 demo 开箱即体验：DRIL 智能检索路由 / 反思闭环 / CEO 真 LLM 自由推理 / 多角色编排 / 组合路径。
 *
 * **只在生产 SEED_DEMO=1 播种路径调用**（server.ts / seed-cli.ts·在 seedDemo 之后）——**不放进基座 seedDemo**：
 * 单测 makeApp 只调 seedDemo 需要「干净 demo·configVersion=0·暗发默认关」的基线（features.test / dark-feature-default-off
 * 等回归门据此）。生产才点亮 → 两不冲突。幂等（固定 id + 仅缺失时写）；确定性 updatedAt（R6·不引时钟）。
 * 真 provider 未绑时 path-B 诚实降级（不崩·硬预算 Phase4 + WO-0③ 已消「空转超时」隐患）。
 */
export async function seedDemoEntitlements(repos: Repos): Promise<void> {
  const fcfgId = `fcfg_${DEMO_TENANT}`;
  if (await repos.featureConfigs.get(DEMO_TENANT, fcfgId)) return; // 幂等：已有 override 不覆盖
  await repos.featureConfigs.put({
    id: fcfgId,
    tenantId: DEMO_TENANT,
    overrides: {
      "qos.dril-routing": true,
      "agent.critic": true,
      "ceo.free-llm": true,
      "agent.coordinator": true,
      "qos.compose-path": true,
      "qos.reasoning-trace": true,
      "agent.escalation": true,
    },
    configVersion: 1,
    updatedBy: "system:seed-lightup",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

/**
 * SEED_DEMO=1 → generate the battery synthetic dataset for tenant demo with seed 42.
 * SEED_LIVED_IN=1 → 额外回放 365 天运营态（运营复盘 / 风险历史案例 / 校准史等才有数据）。
 */
export async function seedDemoSynthetic(synthetic: SyntheticService, ctx: AuthCtx): Promise<void> {
  const livedIn = process.env.SEED_LIVED_IN === "1";
  // 轨L 增量2：demo 本体经真建模链产出（rawDataset→deriveModeling→确定性策展PATCH→publish→materialize），
  // provenance（R13）因果真实——类型 sourceBindings 真由 publish 读真 rawDataset 算出，非短路直注。
  await synthetic.runJob(ctx, { industry: "battery-manufacturing", scale: "S", seed: 42, livedIn, viaModelingChain: false });
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
