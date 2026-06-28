import type { PropagationRule } from "@platform/contracts";
import type { Repos } from "./repo/repo.js";
import { AuthService } from "./auth.js";
import type { AuthCtx } from "./domain.js";
import type { SyntheticService } from "./synthetic/service.js";
import type { SopService } from "./sop.js";
import type { SolverService } from "./solvers/service.js";
import type { LlmProviderService } from "./llmproviders.js";

export const DEMO_TENANT = "demo";

/**
 * demo LLM 持久化（G-3 收尾）：设了 KIMI_API_KEY 则自动配一个 openai_compatible provider（Kimi）+ 绑定
 * classifier/agent/comprehend，使 demo 重启不丢 LLM 能力。key **仅从 env 读、经 AES-GCM 落库、绝不入 git**（R5）。
 * 幂等：已有同 baseUrl 的 provider 则复用；已绑定的 purpose 不重绑。运行态临时配置由此定型为可复现 seed。
 */
export async function seedDemoLlmProvider(
  llm: LlmProviderService,
  ctx: AuthCtx,
  cfg: { apiKey: string; baseUrl: string; model: string },
): Promise<void> {
  if (!cfg.apiKey) return;
  const existing = (await llm.list(ctx.tenantId)).find((p) => p.kind === "openai_compatible" && p.baseUrl === cfg.baseUrl);
  const provider =
    existing ??
    (await llm.create(ctx, {
      name: "Kimi (Moonshot)",
      kind: "openai_compatible",
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey, // write-only → AES-GCM 密文落库，响应仅 hasApiKey（R5 no-secrets-echo）
      models: [{ modelId: cfg.model, displayName: cfg.model, capabilities: { tools: true, structuredOutput: false, maxContext: 131072 } }],
      status: "ACTIVE",
      scope: "tenant",
    }));
  const cur = await llm.bindings(ctx.tenantId);
  // 绑全部 DataCore 用途（深扫 P0 坐实：凡未绑用途回落无凭据 SDK→裸鉴权串）：
  // extraction=A2 规则抽取 · template_gen=未知行业合成 · modeling=A3 AI 建议 · comprehend=A2 故事解析。
  // compose 运行期回落 agent 绑定（roleModel），无需单列。
  const want = ["classifier", "agent", "comprehend", "modeling", "extraction", "template_gen"] as const;
  const missing = want.filter((p) => !cur.some((b) => b.purpose === p));
  if (missing.length > 0) {
    await llm.putBindings(ctx, [
      ...cur,
      ...missing.map((purpose) => ({ purpose, providerId: provider.id, modelId: cfg.model })),
    ]);
  }
}

/**
 * UI缺口 M3：demo 种一个月度 S&OP 版本（2026-07）并五步法推进到评审态，使 /v/sop-balance 直接出
 * 三线对照表（目标/滚动P50/滚动P90/上月实际），非"暂无数据"空壳。复用 CL.4 bootstrap ⑤ 同一编排
 * （sop.create + advance 1..5·步④财务取参数基线种子），幂等（已有该月版本则跳过）。不 FINAL（留评审态）。
 */
export async function seedDemoSopVersion(sop: SopService, solvers: SolverService, ctx: AuthCtx): Promise<void> {
  const month = "2026-07";
  const existing = (await sop.list(ctx)).filter((v) => v.month === month);
  if (existing.length > 0) return; // 幂等
  let version = await sop.create(ctx, { month });
  const params = await solvers.getParams(ctx.tenantId);
  const baseline = (params.planBaseline as { gmTarget?: number; cashCushion?: number } | undefined) ?? { gmTarget: 16, cashCushion: 58 };
  const cashFloor = Number((params.sop as { cashFloor?: number } | undefined)?.cashFloor ?? 50);
  const gmBudget = Number(baseline.gmTarget ?? 16);
  for (let s = 1; s <= 5; s++) {
    let payload: Record<string, unknown> = {};
    if (s === 4) {
      const dem = Number((version.steps.s3 as { dem?: number } | undefined)?.dem) || 100;
      payload = { revSum: dem, gmSum: Math.round((dem * gmBudget) / 100 * 1e4) / 1e4, gmBudget, cashCushion: Math.max(Number(baseline.cashCushion ?? 58), cashFloor) };
    }
    version = await sop.advance(ctx, version.id, s, payload);
  }
}

/**
 * G-9 招牌可演示性（env SEED_EMPTY_TENANT=1·dev/demo 专用）：建一个**可登录但对象世界全空**的租户 `fresh`
 * （admin 账号 fresh/admin/demo1234，industry=battery 供 provision 取口径），**不跑合成**。
 * 镜像真实"新租户刚开通、还没数据"的开箱态——让「一键长出此卡」的"空→自动 provision 起步世界→GOVERNED"
 * 招牌能在浏览器端到端实拍（普通 demo 租户已预播数据、走不到 provision 分支）。幂等：账号已存在则跳过。
 */
export async function seedEmptyTenant(repos: Repos, tenantId = "fresh"): Promise<void> {
  const tenant = await repos.tenants.get(tenantId, tenantId);
  if (!tenant) {
    await repos.tenants.put({ id: tenantId, tenantId, name: `新租户（${tenantId}·空世界开箱）`, industry: "battery-manufacturing" });
  }
  const existing = (await repos.users.list(tenantId, (u) => u.username === "admin"))[0];
  if (!existing) {
    await repos.users.put({
      id: `usr_${tenantId}_admin`,
      tenantId,
      username: "admin",
      passwordHash: await AuthService.hashPassword("demo1234"),
      // admin+catalog_admin：可进场景管理台「一键长出此卡」；不预播任何对象（世界全空，触发 provision 招牌）。
      roles: ["admin", "catalog_admin", "tenant_admin"],
      attributes: {},
    });
  }
}

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
  // 轨L 增量2：demo 本体经真建模链产出（rawDataset→deriveModeling→确定性策展PATCH→publish→materialize），
  // provenance（R13）因果真实——类型 sourceBindings 真由 publish 读真 rawDataset 算出，非短路直注。
  await synthetic.runJob(ctx, { industry: "battery-manufacturing", scale: "S", seed: 42, livedIn, viaModelingChain: true });
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
