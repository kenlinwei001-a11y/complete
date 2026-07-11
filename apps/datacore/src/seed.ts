import type { PropagationRule } from "@platform/contracts";
import type { Repos } from "./repo/repo.js";
import { AuthService } from "./auth.js";
import type { AuthCtx, ObjectTypeDef } from "./domain.js";
import type { CalibrationService } from "./calibration/service.js";
import { buildReplayModel, replayPredictedDaily } from "./calibration/index.js";
import { datePlus } from "./calibration/config.js";
import { simNow } from "./calibration/pairing.js";
import { round } from "./prng.js";
import { mcP90Single } from "./solvers/method-mc.js";
import type { SyntheticService } from "./synthetic/service.js";
import type { SopService } from "./sop.js";
import { projectCase, type DecisionArtifact } from "./memory/decision-case.js";
import type { SolverService } from "./solvers/service.js";
import type { LlmProviderService } from "./llmproviders.js";
import type { FeatureService } from "./features.js";
import { currentMonth } from "./clockderive.js";

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
      // WO-1C：structuredOutput true（原 false 走 JSON-mode，复杂抽取 schema 解析率低致 "unparseable output"）。
      // 审核方实测 classifier/modeling 用 true（原生 strict json_schema）可解析；提升 A2 抽取/A3 建模解析率。
      models: [{ modelId: cfg.model, displayName: cfg.model, capabilities: { tools: true, structuredOutput: true, maxContext: 131072 } }],
      status: "ACTIVE",
      scope: "tenant",
    }));
  const cur = await llm.bindings(ctx.tenantId);
  // 绑全部 DataCore 用途（深扫 P0 坐实：凡未绑用途回落无凭据 SDK→裸鉴权串）：
  // extraction=A2 规则抽取 · template_gen=未知行业合成 · modeling=A3 AI 建议 · comprehend=A2 故事解析。
  // compose 运行期回落 agent 绑定（roleModel），无需单列。
  const want = ["classifier", "agent", "comprehend", "modeling", "extraction", "template_gen"] as const;
  // classifier 默认关思考（kimi-k2.6 是思考模型，分类一次 10–90s；关思考后秒级直出，QOS 分类不再静默卡）。
  // agent 等留思考（工具循环需要推理）。运营可在用途矩阵改回。
  const disableFor = (purpose: string): boolean => purpose === "classifier";
  const missing = want.filter((p) => !cur.some((b) => b.purpose === p));
  // classifier 已绑但未关思考 → 也需回写补开关（重启/旧 seed 升级路径）。
  const classifierNeedsFlag = cur.some((b) => b.purpose === "classifier" && b.disableThinking !== true);
  if (missing.length > 0 || classifierNeedsFlag) {
    const merged = [
      ...cur
        .filter((b) => !missing.includes(b.purpose as (typeof want)[number]))
        .map((b) => ({ ...b, ...(disableFor(b.purpose) ? { disableThinking: true } : {}) })),
      ...missing.map((purpose) => ({
        purpose,
        providerId: provider.id,
        modelId: cfg.model,
        ...(disableFor(purpose) ? { disableThinking: true } : {}),
      })),
    ];
    await llm.putBindings(ctx, merged);
  }
}

/**
 * UI缺口 M3：demo 种一个月度 S&OP 版本（sim-clock t0 当前月）并五步法推进到评审态，使 /v/sop-balance 直接出
 * 三线对照表（目标/滚动P50/滚动P90/上月实际），非"暂无数据"空壳。复用 CL.4 bootstrap ⑤ 同一编排
 * （sop.create + advance 1..5·步④财务取参数基线种子），幂等（已有该月版本则跳过）。不 FINAL（留评审态）。
 * HARDCODE-CLOCK-DERIVE：月份改由 t0 派生（currentMonth(forecastStart)），非硬编码 "2026-07"
 * （旧字面 2026-07 与 t0 2026-06 错位·真 bug 修正）。
 */
export async function seedDemoSopVersion(sop: SopService, solvers: SolverService, ctx: AuthCtx): Promise<void> {
  const params = await solvers.getParams(ctx.tenantId);
  const month = currentMonth(params.forecastStart);
  const existing = (await sop.list(ctx)).filter((v) => v.month === month);
  if (existing.length > 0) return; // 幂等
  let version = await sop.create(ctx, { month });
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

/**
 * G-12 收口（增量B·U2）：真立 **≥1 非电池行业租户**（物流仓配 logistics-warehouse）。
 * env `SEED_OPT_INDUSTRY=1`·dev/demo 专用。建可登录租户 `logi`（admin 账号 logi/admin/demo1234），
 * industry=logistics-warehouse（对应内置确定性模板，无 LLM），并开 opt.solver-pool+opt.whatif（L3 override）。
 * **不跑合成**（世界空）——让「provision-world → synthetic.runJob 真物化 Warehouse/Store → facility_location 真 CP-SAT」
 * 这条全链在活系统作为可复现步骤被实拍（DEPLOY.md 给复跑命令）。幂等：账号/override 已在则跳过/合并。
 * R14：非电池行业=绑定进来的内容（内置模板配置），求解器/绑定层代码零改。
 */
export async function seedLogisticsTenant(repos: Repos, features: FeatureService, tenantId = "logi"): Promise<void> {
  const tenant = await repos.tenants.get(tenantId, tenantId);
  if (!tenant) {
    await repos.tenants.put({ id: tenantId, tenantId, name: "物流仓配选址（非电池行业演示）", industry: "logistics-warehouse" });
  }
  const existing = (await repos.users.list(tenantId, (u) => u.username === "admin"))[0];
  if (!existing) {
    await repos.users.put({
      id: `usr_${tenantId}_admin`,
      tenantId,
      username: "admin",
      passwordHash: await AuthService.hashPassword("demo1234"),
      roles: ["admin", "catalog_admin", "tenant_admin", "planner"],
      attributes: {},
    });
  }
  // 开 opt 暗发（L3 override，出厂可覆盖）——非电池租户同样需开 entitlement 才见 /a/v1/opt/*（R3）。
  const ctx: AuthCtx = { tenantId, userId: `usr_${tenantId}_admin`, roles: ["admin"], attributes: {} };
  await features.mergeTenantOverride(ctx, tenantId, { "opt.solver-pool": true, "opt.whatif": true });
}

/**
 * A6 收尾（全服务 e2e·env `SEED_A6_DEMO=1`·dev/demo）：注册一个用 `valueDomain + autoPlant` 的参考行业模板
 * 到独立租户 `a6demo`（不污染 demo/内置下拉），让「拟真值落业务区间 + 越线植入」能经**真服务 HTTP**
 * (POST /a/v1/synthetic/jobs)端到端实跑实拍（非仅 vitest app.inject）。模板与 a6-value-domains 单测同构。
 * 幂等：固定 id 直接 put 覆盖。R6：同 (seed,scale) 字节一致。
 */
export async function seedA6ReferenceTemplate(repos: Repos, tenantId = "a6demo"): Promise<void> {
  const tenant = await repos.tenants.get(tenantId, tenantId);
  if (!tenant) {
    await repos.tenants.put({ id: tenantId, tenantId, name: "A6 拟真值域参考（e2e 演示）", industry: "a6-reference" });
  }
  await repos.industryTemplates.put({
    id: `tmpl_a6_${tenantId}`,
    tenantId,
    industryKey: "a6-reference",
    source: "CUSTOM",
    createdAt: new Date(0).toISOString(),
    template: {
      industryKey: "a6-reference",
      ontology: {
        objectTypes: [
          {
            key: "Order",
            displayName: "订单",
            properties: [
              { propKey: "orderId", dataType: "string", isPrimaryKey: true },
              { propKey: "util", dataType: "number" },
            ],
          },
        ],
      },
      generation: [
        {
          typeKey: "Order",
          count: { S: 12, M: 12, L: 12 },
          // util 走 A6 拟真值域（业务区间 [0.62,0.95]·normal）；autoPlant 从 BLOCK 规则反推植入越线样本。
          propGenerators: { orderId: { kind: "pattern", pattern: "O-{seq:3}" }, util: { kind: "valueDomain", domainKey: "util", shape: "normal" } },
          autoPlant: true,
        },
      ],
      rules: [{ key: "C_UTIL", name: "产能利用率越线", expression: "Order.util > 0.95", severity: "BLOCK" }],
      scenarioSeed: { views: [], intents: [] },
    },
  } as never);
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
 * WO-L1.5-5（企业记忆·出厂 SEED 案例·PRD-L1.5 §10 诚实边界·KILL-MOCK-RED）：
 * demo 租户出厂 SEED 决策案例（**真确定性派生**·全 `origin:SEED` 诚实标·**绝不合成冒充真实累积**）——
 * 给案例库出厂"底料"，真实积累仍由真 Decision 摄取逐条累积（越用越大·R16）。抄 `seedDemoCalibrationConvergence`
 * 真产物范式：从固定决策模板经 `projectCase` 确定性投影（固定 now·非墙钟·R6 字节一致）。检索命中透 SEED 位、
 * SEED 数字不被当已核验业务真值（disclaimer 随行）。幂等 upsert-by-caseId。
 */
export const SEED_CASE_NOW = "2026-01-01T00:00:00.000Z"; // 固定播种时点（R6·非墙钟）
const SEED_CASE_TEMPLATES: DecisionArtifact[] = [
  {
    source: "SEED",
    refId: "seed_cap_delay",
    title: "产能缺口·延期在手单处置",
    context: "基地主力产线降产致产能缺口，需在延期/外协/拆单间抉择 交付风险",
    options: [
      { key: "delay", label: "延期在手单" },
      { key: "outsource", label: "外协消化" },
      { key: "split", label: "拆单分线" },
    ],
    chosen: "delay",
    rejectedRationale: [{ optionKey: "outsource", rationale: "外协比过高·毛利受损" }],
    predicted: { summary: "延期约 5 天·保交付率", metrics: { deliveryRate: 0.92 } },
    ctx: { intentKey: "adopt_mitigation", metrics: ["deliveryRate"] },
  },
  {
    source: "SEED",
    refId: "seed_displace_outsource",
    title: "急单插入·外协消化挤占",
    context: "高优先级急单插入挤占在产订单，需消化产能缺口",
    options: [
      { key: "delay", label: "延期" },
      { key: "outsource", label: "外协" },
    ],
    chosen: "outsource",
    rejectedRationale: [{ optionKey: "delay", rationale: "延期违约金高" }],
    predicted: { summary: "外协比 30%·准时交付", metrics: { deliveryRate: 0.95 } },
    ctx: { intentKey: "what_if_displacement_q", metrics: ["deliveryRate"] },
  },
  {
    source: "SEED",
    refId: "seed_margin_attribution",
    title: "毛利率下滑·归因与处置",
    context: "季度毛利率低于目标，需归因主因并处置",
    options: [
      { key: "price_up", label: "提价" },
      { key: "cost_cut", label: "降本" },
    ],
    chosen: "cost_cut",
    rejectedRationale: [{ optionKey: "price_up", rationale: "客户价格敏感·份额风险" }],
    predicted: { summary: "降本 2pp·毛利改善", metrics: { grossMargin: 0.31 } },
    ctx: { intentKey: "margin_attribution_q", metrics: ["grossMargin"] },
  },
  {
    source: "SEED",
    refId: "seed_credit_hold",
    title: "客户信用敞口·放行抉择",
    context: "客户应收敞口接近授信额度，订单放行需评估信用风险",
    options: [
      { key: "hold", label: "暂缓放行" },
      { key: "release", label: "放行" },
    ],
    chosen: "hold",
    rejectedRationale: [{ optionKey: "release", rationale: "敞口超授信·坏账风险" }],
    predicted: { summary: "暂缓待回款·控风险", metrics: {} },
    ctx: { intentKey: "credit_check", metrics: [] },
  },
  {
    source: "SEED",
    refId: "seed_maint_stagger",
    title: "检修错峰·排程处置",
    context: "多线检修集中致产能骤降，需错峰排程",
    options: [
      { key: "stagger", label: "错峰检修" },
      { key: "defer", label: "推迟检修" },
    ],
    chosen: "stagger",
    rejectedRationale: [{ optionKey: "defer", rationale: "推迟致设备风险累积" }],
    predicted: { summary: "错峰保产能·检修不欠账", metrics: {} },
    ctx: { intentKey: "maint_stagger", metrics: [] },
  },
];

export async function seedDemoDecisionCases(repos: Repos): Promise<void> {
  for (const tmpl of SEED_CASE_TEMPLATES) {
    const kase = projectCase(tmpl, { tenantId: DEMO_TENANT, now: SEED_CASE_NOW, origin: "SEED" });
    await repos.decisionCases.put({ ...kase, id: kase.caseId }); // 幂等 upsert
  }
}

/**
 * G-12 收口（增量 A·U1）：demo 租户出厂开 `opt.solver-pool` + `opt.whatif` 暗发功能（L3 租户 override）。
 *
 * 为什么：opt.* 平台默认 `defaultOn:false`（R3 暗发），且 battery 模板 L2=ALL_FEATURE_KEYS 仅"不删"
 * 不"加" defaultOn:false 键 → demo 不开 override 则 `/a/v1/opt/*` 恒 404，CP-SAT 这一公里在活系统从不发生。
 * 这里以 **L3 租户 override** 出厂开启（=true），使 demo admin 即见优化模板池/什么-if 功能；
 * **"出厂默认可覆盖"**：admin 仍可经管理台把 override 设 false → 关→ `/a/v1/opt/solve` 404（验收点1 R3 双向可证）。
 *
 * 边界：merge 写入（幂等·不 clobber 其他 override）；opt.whatif requires opt.solver-pool（cascade 守）。
 * 仅开 entitlement，**不配 OPTIMIZER_BASE_URL**（那是部署/启动链接 sidecar 的事，见 DEPLOY.md）——
 * 未接 sidecar 时端点可见但求解器诚实报"未接入最优化引擎"（非 404，区别于功能关闭）。
 */
export async function seedDemoOptEntitlement(features: FeatureService, ctx: AuthCtx): Promise<void> {
  await features.mergeTenantOverride(ctx, DEMO_TENANT, {
    "opt.solver-pool": true,
    "opt.whatif": true,
  });
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
 *  - **接真对象态（CORE-E2-PROPAGATE C3·治本）**：sourceStateVar 一律取**真对象已物化的数值属性名**
 *    （Order.demandDelta 需求偏差 / Model.totalDemand 型号总需求[派生] / Line.utilization 产线利用率[TS 聚合]），
 *    使 view-config nodeObjectState 与 Trial Tick 起跑态命中真值 → **推进 tick 真有反应**（不再空世界记 0）。
 *    targetStateVar（demandLoad/loadIndex）是传导写出的沙盘态。清空这些真源属性即 snapshot 归 0（teeth）。
 *  - stateVars 非显式声明——view-config 自动从规则 source/target stateVar 派生（种了规则即非空）。
 */
const DEMO_PROPAGATION_RULES: ReadonlyArray<Omit<PropagationRule, "tenantId">> = [
  // ① 订单需求偏差（真属性 Order.demandDelta）→ 沿"订单属型号"边推到型号需求负载（即时，强相关）。
  {
    id: "simpr_demo_order_demand",
    key: "demo_order_demand_pressure",
    sourceTypeKey: "Order",
    sourceStateVar: "demandDelta",
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
  // ② 型号总需求（真派生属性 Model.totalDemand）→ 沿"型号可产于基地"边推到基地负载指数（即时）。
  {
    id: "simpr_demo_model_to_base",
    key: "demo_model_demand_to_base_load",
    sourceTypeKey: "Model",
    sourceStateVar: "totalDemand",
    viaLinkKey: "model_producible_at",
    targetTypeKey: "Base",
    targetStateVar: "loadIndex",
    coefficient: 0.6,
    delayTicks: 0,
    combine: "sum",
    // WO-CAP-02-SEED-VARY（治"只涨不落"）：基地负载传导加**衰减** decay（每 tick 贡献 ×(1−1/den)=0.9·PRD 0.85~0.95，
    // 压低单调爬升斜率）+ **上限 clamp**（把 loadIndex 夹进有限区间 [0, 2e6]，**根治原 sum+decay:null 的无界暴涨**——
    // 原每 tick 恒 +0.6·totalDemand 的巨量、单调线性冲到千万级恒顶）。加 clamp 后各基地按其真需求负载**先后触顶**、
    // 高需求基地先到顶(热)、低需求基地留在顶下(凉)→ 逐日曲线**有升有平·基地间有高有低**（非全基地同步暴涨恒红）。
    // 诚实边界：propagateTick 以 sum 累加"携带态"，源为常量 → 单条基地曲线本征单调（引擎不衰减携带值）；
    // 真正"逐日有涨有落"的风险曲线由 risk_timeline 的事件脉冲(到货间隙/检修窗)提供，见 battery.ts scenarioScript/eventAmps。
    // decay/clamp 全确定性（无 rng/时钟·守 R6）。
    decay: { window: 1, den: 10 },
    clamp: { min: 0, max: 2000000 },
    coefficientRef: null,
    status: "PUBLISHED",
  },
  // ③ 产线利用率（真属性 Line.utilization·TS 聚合物化）→ 沿"产线归属基地"边推到基地负载指数（延迟 1 tick，演示时序传导）。
  {
    id: "simpr_demo_line_to_base",
    key: "demo_line_util_to_base_load",
    sourceTypeKey: "Line",
    sourceStateVar: "utilization",
    viaLinkKey: "line_belongs_to_base",
    targetTypeKey: "Base",
    targetStateVar: "loadIndex",
    coefficient: 0.5,
    delayTicks: 1,
    combine: "sum",
    // WO-CAP-02-SEED-VARY：产线利用率→基地负载同加衰减 + 上限 clamp（与 model→base 同口径·延迟 1 tick 保留时序传导）。
    decay: { window: 1, den: 10 },
    clamp: { min: 0, max: 2000000 },
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

/**
 * WO-MULTISRC-FUSION-DOMAIN（N1·收尾）：给 demo 播**真多源同事实**数据，让活体 NL 问句
 * 「多源数据打架时按什么口径仲裁？有没有测谎命中的可疑源？」（场景卡 S25→multisource_fusion）
 * 有真材料可融——此前 demo 无任一对象存在两源同 pk 冲突态，S25 活体一跑必空。
 *
 * ⚠️ 诚实数据边界（铁律0.4·非冒充真源）：本函数播的 ErpOrder/MesOrder/SrmOrder 是 **DEMO 合成夹具
 * （SYNTHETIC fixture）**，用真实 demo 订单号（SO-3391 等）演示"同一订单事实被 ERP/MES/SRM 三源各执
 * 一词"的融合机制；**不是**从真实 ERP/MES/SRM 系统抽来的真源数据。origin 一律标 SYNTHETIC（jobId
 * = seed-multisrc-fusion-demo）。真实租户的多源融合由真连接器同步 + SolverBinding 归一喂入，机制同、数据真。
 *
 * 播什么（确定性 R6·同 SEED_DEMO 重跑字节一致·R2 全落 DEMO_TENANT）：
 *  - 三个已发布对象类型（domain=sales）：
 *      ErpOrder{so(pk), due, cap, asOf}   — ERP 计划系统：交期乐观（偏早）、计划占用产能
 *      MesOrder{so(pk), due, cap, asOf}   — MES 制造执行：交期为现场实际（偏晚·更权威）、**自报产能虚高**
 *      SrmOrder{so(pk), cap, asOf}        — SRM 供方确认：仅报可供产能（作测谎第三参照·无交期）
 *  - 五张真实 demo 订单号跨三源同 pk（cap 三源方能定中位、揪出 MES 虚报为离群；两源无法判谁虚报）：
 *      SO-3391/SO-3431 → due 冲突 + cap 测谎命中 SUSPECT（MES 虚高被揪·审慎取最保守最小值·不照单全收 R13）
 *      SO-3402/SO-3445 → due 冲突（仅仲裁·无测谎）
 *      SO-3415        → 三源全一致（无冲突无测谎·演示 dataMode LIVE 侧）
 * 融合口径：defaultStrategy=AUTHORITY（MES 权威最高→交期采实际值）；测谎命中字段强制 CONSERVATIVE。
 * 整批输出 dataMode=MOCK（有测谎命中→头条最审慎·不冒充真值；若只有冲突无测谎则 PARTIAL）。
 */
const MSF_JOB_ID = "seed-multisrc-fusion-demo";
/** 每行：订单号 → 三源取值（cap 数值·due 交期·asOf 新鲜度）。固定表 = R6 确定性。 */
const DEMO_MULTISRC_ORDERS: {
  so: string;
  erp: { due: string; cap: number; asOf: string };
  mes: { due: string; cap: number; asOf: string };
  srm: { cap: number; asOf: string };
}[] = [
  // MES 虚报产能（20 vs ERP 8 / SRM 9）→ 极差远超阈值 0.15 → 测谎命中 SUSPECT；交期 ERP 早 vs MES 晚 → 冲突。
  { so: "SO-3391", erp: { due: "2026-06-24", cap: 8, asOf: "2026-06-10" }, mes: { due: "2026-07-08", cap: 20, asOf: "2026-06-25" }, srm: { cap: 9, asOf: "2026-06-22" } },
  // 交期冲突（ERP 早 vs MES 晚），产能三源相近（12/13/12·极差 <阈值）→ 仅仲裁·无测谎。
  { so: "SO-3402", erp: { due: "2026-07-02", cap: 12, asOf: "2026-06-11" }, mes: { due: "2026-07-16", cap: 13, asOf: "2026-06-26" }, srm: { cap: 12, asOf: "2026-06-23" } },
  // 三源全一致（交期同·产能同）→ 无冲突无测谎（诚实"一致即高置信"侧）。
  { so: "SO-3415", erp: { due: "2026-07-18", cap: 6, asOf: "2026-06-12" }, mes: { due: "2026-07-18", cap: 6, asOf: "2026-06-27" }, srm: { cap: 6, asOf: "2026-06-24" } },
  // MES 再次虚报（24 vs 9/10）→ 测谎命中；交期冲突。
  { so: "SO-3431", erp: { due: "2026-06-28", cap: 9, asOf: "2026-06-13" }, mes: { due: "2026-07-12", cap: 24, asOf: "2026-06-28" }, srm: { cap: 10, asOf: "2026-06-25" } },
  // 交期冲突，产能相近（11/12/11）→ 仅仲裁·无测谎。
  { so: "SO-3445", erp: { due: "2026-07-05", cap: 11, asOf: "2026-06-14" }, mes: { due: "2026-07-19", cap: 12, asOf: "2026-06-29" }, srm: { cap: 11, asOf: "2026-06-26" } },
];

/**
 * 播 demo 多源融合夹具（幂等：固定类型 id/对象 id + 直接 put 覆盖·R6 字节一致）。仅新增 sales 域三型 +
 * 其对象，正交于 battery 合成（不改电池字节基线）。由 SEED_DEMO 在 seedDemoSynthetic 之后调用。
 */
export async function seedDemoMultiSourceFusion(repos: Repos): Promise<void> {
  const mkType = (key: string, displayName: string, hasDue: boolean): ObjectTypeDef => ({
    id: `otype_${DEMO_TENANT}_${key}`,
    tenantId: DEMO_TENANT,
    key,
    displayName,
    domain: "sales",
    properties: [
      { propKey: "so", dataType: "string", isPrimaryKey: true, searchable: true, description: "订单号（多源共享业务主键）" },
      ...(hasDue ? [{ propKey: "due", dataType: "date" as const, isPrimaryKey: false, description: "交期" }] : []),
      { propKey: "cap", dataType: "number", isPrimaryKey: false, description: "该订单占用/申报产能（数值·测谎维）" },
      { propKey: "asOf", dataType: "date", isPrimaryKey: false, description: "该源取值的观测时点（新鲜度）" },
    ],
    derivedProperties: [],
    sourceBindings: [],
    version: 1,
    status: "ACTIVE",
    published: true,
  });
  await repos.ontologyTypes.put(mkType("ErpOrder", "订单·ERP 源（计划）", true));
  await repos.ontologyTypes.put(mkType("MesOrder", "订单·MES 源（制造执行）", true));
  await repos.ontologyTypes.put(mkType("SrmOrder", "订单·SRM 源（供方确认产能）", false));

  const origin = { type: "SYNTHETIC" as const, jobId: MSF_JOB_ID };
  for (const r of DEMO_MULTISRC_ORDERS) {
    await repos.objects.put({ id: `obj_${DEMO_TENANT}_erp_${r.so}`, tenantId: DEMO_TENANT, type: "ErpOrder", objectKey: r.so, props: { so: r.so, due: r.erp.due, cap: r.erp.cap, asOf: r.erp.asOf }, origin });
    await repos.objects.put({ id: `obj_${DEMO_TENANT}_mes_${r.so}`, tenantId: DEMO_TENANT, type: "MesOrder", objectKey: r.so, props: { so: r.so, due: r.mes.due, cap: r.mes.cap, asOf: r.mes.asOf }, origin });
    await repos.objects.put({ id: `obj_${DEMO_TENANT}_srm_${r.so}`, tenantId: DEMO_TENANT, type: "SrmOrder", objectKey: r.so, props: { so: r.so, cap: r.srm.cap, asOf: r.srm.asOf }, origin });
  }
}

/**
 * WO-CALIB-CONVERGENCE-UI（G-VIS-1·退回窄修·根因治本）：给 demo 播「越用越准」收敛史——**真引擎产物·非手绘**。
 * 退回根因（reviewer·KILL-MOCK-RED 同源·违铁律0.4 不作假）：曾直接写死收敛记录 9.4→6.1 冒充真值，真 sweep 一跑
 * （demo 无 live 配对）返 paired:0/静止 6.53 自曝假曲线。治本：改播**真校准配对**（predicted/actual 观测·逐轮偏差
 * 缩小=校准后预测更准的真实语义），让**真 CalibrationService.sweep 逐轮算出** mapeAfter（同 m11 测试驱动·§2.E 记：
 * actual=predicted×(1-bias)、bias 0.20/0.12/0.05 → ape=bias/(1-bias) → mapePct **25→13.64→5.26**·R6 确定）。
 * 收敛记录 = 真引擎从真配对派生·非另编；**保留末轮配对** → 用户后续真 sweep 再跑得一致值（不再自曝）。
 * 边界：pairs 是 demo 确定性合成观测（走正门·非 A8 live 回采）；真实租户由真 CALIBRATION_SWEEP 逐轮累积真观测。
 */
const DEMO_CALIB_BIASES = [0.2, 0.12, 0.05]; // 逐轮偏差缩小 → 真引擎算出 mapeAfter 25→13.64→5.26（§2.E）

export async function seedDemoCalibrationConvergence(
  repos: Repos,
  solvers: SolverService,
  calibration: CalibrationService,
): Promise<void> {
  const c = await solvers.loadContext(DEMO_TENANT);
  const model = buildReplayModel(c);
  const modelId = [...c.certByModel.keys()][0];
  if (!modelId) return; // demo 本体未物化型号 → 跳过（诚实空态·非编造）
  const baseIds = [...(c.certByModel.get(modelId) ?? new Map<string, string>()).keys()].sort();
  if (baseIds.length === 0) return;
  const version = await solvers.paramsVersion(DEMO_TENANT);
  const week = 5;
  // 配对日期锚在引擎"今天"（simNow：sim 时钟或真实钟）前 12 天内 → 恒落 30 天评估窗口内（不因时钟漂移失效）。
  const { date: nowDate } = await simNow(repos, DEMO_TENANT);
  // 播一条真配对：predicted 来自真 replay 引擎·actual=predicted×(1-bias)（偏差随轮缩小=校准后预测更准的真语义）。
  const putPair = async (date: string, baseId: string | undefined, bias: number): Promise<void> => {
    const predicted = replayPredictedDaily(c, model, modelId, baseId, week);
    if (predicted <= 0) return;
    const actual = round(predicted * (1 - bias), 6);
    const error = round(predicted - actual, 6);
    await repos.calibrationPairs.put({
      id: `calpair_demo_${modelId}_${baseId ?? "all"}_${date}`,
      tenantId: DEMO_TENANT,
      solverKey: "capacity_forecast",
      entityRef: baseId ? `Model:${modelId}@Base:${baseId}` : `Model:${modelId}`,
      modelId,
      ...(baseId ? { baseId } : {}),
      windowFrom: date,
      windowTo: date,
      predicted,
      predictedP90: round(mcP90Single(predicted, { solver: "cal_seed_p90", modelId, baseId: baseId ?? "all", date, predicted }), 6),
      actual,
      error,
      ape: round(Math.abs(error) / Math.max(actual, 1e-6), 6),
      paramsVersion: version,
      staleParams: false,
      sliceKey: `capacity_forecast|${baseId ?? "all"}|${modelId}`,
      weekOfWindow: week,
      pairedAt: `${nowDate}T00:00:00.000Z`,
    });
  };
  for (const bias of DEMO_CALIB_BIASES) {
    // 清上一轮配对（模拟"新窗口新一批观测"·不与旧轮混样）。
    for (const p of await repos.calibrationPairs.list(DEMO_TENANT)) await repos.calibrationPairs.remove(DEMO_TENANT, p.id);
    for (let d = 0; d < 12; d++) {
      const date = datePlus(nowDate, d - 12); // 落评估窗口内（now 前 12 天）
      await putPair(date, undefined, bias); // 聚合配对（report 趋势 / runAll basePairs 用无 baseId 的这条）
      for (const baseId of baseIds) await putPair(date, baseId, bias); // 逐基地配对（切片评估用）
    }
    // 真引擎清扫 → 逐轮落真收敛度（mapeBefore→mapeAfter 由 report() 从真配对派生·非另编）。
    await calibration.sweep(DEMO_TENANT, "CALIBRATION_SWEEP");
  }
  // 保留末轮（bias=0.05）配对：用户后续真 sweep 再跑得一致值（≈5.26 静止·"本轮无新观测"诚实语义），不自曝跳变。
}
