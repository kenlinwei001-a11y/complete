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
const DEMO_LIGHTUP: Record<string, boolean> = {
  "qos.dril-routing": true,
  "agent.critic": true,
  "ceo.free-llm": true,
  "agent.coordinator": true,
  "qos.compose-path": true,
  "qos.reasoning-trace": true,
  "agent.escalation": true,
  // WO-DEMO-L3-LIGHTUP：demo 开箱体验 L3 耦合联合求解——② 确定性多域分路（LLM-free·无超时风险·Q2 治本）
  // 把耦合型问句接进 runMultiRoute，L3 门在其入口升格成一次 portfolio 守恒解（转拨→产能→延误→外协真传导）。
  // 两门缺一不可：det-multi 产耦合路由 × l3-coupled 升格（见 l3-coupled-seam「det+l3 同开 → 一次 portfolio」）。
  "qos.deterministic-multi-domain": true,
  "qos.multi-intent-l3-coupled": true,

  // ── WO-DEMO-LIGHTUP-2（本轮追加 5 条·逐条写明「为什么点」）────────────────────
  //
  // ⚠ 先说清 L2/L3 的关系，免得下一个人照着名字推错依赖：**L3 不 requires L2**。
  //   `features.ts` 两键都没有 `requires` 字段，运行期也不是层叠关系——
  //   L2（`orchestrator.ts:731`）是**进入多路并行的三个触发器之一**（另两个是 ② det-multi
  //   与 ⑤ multi-intent），而 L3（`orchestrator.ts:946`，在 `runMultiRoute` 内部）是
  //   **进去之后的升格**。所以「L3 已亮而 L2 未亮」并不矛盾：L3 此前靠已点亮的
  //   `qos.deterministic-multi-domain` 供给耦合路由即可生效。本轮点 L2 是**新增第三个
  //   触发器**（治 novel 措辞被 free-LLM 长度门劫持），不是补 L3 的前置。
  //
  // ① 自由问答挂载租户技能：demo 出厂 Skill 共 7 条（agentcore `mocks/seed.ts` `seedRegistry().skills`，
  //    main.ts 启动即幂等播种），其中 **5 条 PUBLISHED**（sop_meeting / quality_control 是 DRAFT）。
  //    此前它们**只对注册 agent 路径可达**（skill 绑在 `agent.skills` 上）；用户在对话坞随便问一句
  //    走的是泛化 path-B，一个技能都看不见。点亮 = 那 5 条对默认自由问答可见并可 `load_skill` 取全文。
  //    **有数据才点**——池空时代码本就不挂钩子（挂一个永远返 undefined 的工具只会诱导模型盲试）。
  //    ⚠ 这个「7 还是 5」我一开始按 seed 文件里的条目数推成了 7，真打 `GET /b/v1/skills` 才发现是 5 ——
  //    顺带实测坐实了 `selectTenantSkills` 的 DRAFT 过滤在生产链路上真的生效（不是只有单测里生效）。
  "agent.skill-on-free-qa": true,
  // ② L2 真分解：复合/长问句（novel 措辞、不含域关键词）此前被 free-LLM 的**纯长度门**
  //    （q.length≥24）接走进慢路 ReAct——"说得越具体越被判为开放深问"，因果是反的。
  //    点亮后先试 LLM 产 solver 计划 → 确定性校验 → 命中即走并行确定性求解；一条都映射不到
  //    才落 free-LLM（不劫持真开放题）。demo 上正是最常见的问法形态。
  "qos.multi-intent-l2-decompose": true,
  // ③ LLM 多意图兜底：② 确定性分路按域关键词枚举，覆盖不到的跨域题（分类器能给出 ≥2 个够格候选）
  //    此前只会取 top1 单意图作答——**用户问了两件事只答一件，且答得理直气壮**。点亮后并行跑多路
  //    + 零 LLM 块装配。与 ② 互补（② 确定性主路、⑤ LLM 兜底），demo 已点 ② 故此处补齐另一半。
  "qos.multi-intent-orchestration": true,
  // ④ 结构化优化 what-if 会话路由：`optimize_whatif` 求解器与前端「优化推演」页早就有，
  //    但**自然语言问不到它**（G-WHATIF-NL-UNREACHABLE：能力存在 ≠ 能力可达）。demo 的
  //    依赖链底座 `opt.solver-pool` / `opt.whatif` 已随 battery 模板开着（二者不在暗发排除集），
  //    只差这一把路由钥匙 → 点亮后「f1 开设成本涨到 150，最优选址怎么变」直落 path-A CP-SAT 重解。
  "qos.opt-whatif-route": true,
  // ⑤ 求解器上下文按需加载（纯性能收窄·PERF_DARK_LAUNCH_FEATURES）：invoke 时按 solverKey 只加载
  //    该求解器真读的核心对象类型。**点它的前提是等价性有门守着**——`test/solver-context-lazy-loading.seam.test.ts`
  //    的 SEAM-EQ 逐求解器深比「裁剪 ctx 输出 ≡ 全量 ctx 输出」逐字节一致，且有 invoke 端到端
  //    flag-on/off 对照。本单**先真跑该门通过**才点（跑不通就不点：纯性能优化不值一次静默错答）。
  "dc.lazy-solver-context": true,
  //
  // ⚠ **刻意不点 `qos.llm-budget-enforce`**（别当成漏了——这是本轮明确裁决的一条）。
  //   它的行为是**硬线**：租户 token 配额耗尽 → 新 QOS 任务直接 429 `LLM_BUDGET_EXCEEDED` 拒掉。
  //   demo 是给人随便点、随便问的环境，点亮它 = 用户用着用着突然被拒，而拒的理由（"配额用完了"）
  //   在演示语境里既没人管也没人能改 —— 这不是"体验到一个功能"，是"撞上一堵墙"。
  //   记账侧**本来就无条件在记**（不受此门控·见 orchestrator `llmBudgetEnforceEnabled` 注释），
  //   所以关着它并不让账本变空；关的只是"拿账本拦人"这一个动作。
  //   要在 demo 上演示配额，正确做法是运维显式 PUT 一次 override（合并语义会尊重它·见下），
  //   而不是让种子替所有人做这个决定。
  // ⚠ 这里**刻意不列 sim.***（推演沙盘）。留此注记是因为我差点加错：
  //   `features.ts` 里 `sim.sandbox` 写着 `defaultOn: false`，看上去像"暗发没开"，
  //   而 demo 的 override 里确实没有它 —— 两条线索都指向"门没开"。**但那是错的**：
  //   L2 行业模板（`templateFeatures`，battery = ALL_FEATURE_KEYS 减去
  //   QOS_DARK_LAUNCH_FEATURES 与 PERF_DARK_LAUNCH_FEATURES）**已经把 sim.\* 全开了**，
  //   而 sim.\* 不在那两个排除集合里。实测坐实（非读码推断）：把 override 里的
  //   sim.\* 三键全删，`GET /a/v1/me/workspace` 仍返回全部 7 个 sim.\* 键。
  //   ⇒ 在这里加 `"sim.sandbox": true` 是**纯 no-op**，只会让人以为它起了作用。
  //   （registry 的 defaultOn 是 L1；L2 模板可以把它抬上来。只看 L1 就下结论 = 少追一层。）
};

export async function seedDemoEntitlements(repos: Repos): Promise<void> {
  const fcfgId = `fcfg_${DEMO_TENANT}`;
  const existing = await repos.featureConfigs.get(DEMO_TENANT, fcfgId);

  // ⚠ 原实现是「已有配置 → 直接 return」。那条早退有个隐蔽后果：
  //   **已经部署过的环境永远拿不到后来新增的点亮项** —— 库里已有 fcfg_demo 行，
  //   于是本函数每次启动都在第一行掉头就走，新加的 key 一个都不会落地。
  //   凡是「数据卷没删的 redeploy」都属于这种（docker compose 默认保留 volume）。
  //   这不是"少开一个功能"，是**这个点亮机制对存量环境整体失效**，
  //   而且完全无声（日志里连一句都没有）。
  //   本条是**独立于任何具体功能**的缺陷：只要将来往 DEMO_LIGHTUP 加东西就会中招。
  //   （发现它纯属意外——我原本在追一个后来证明判错了的方向，见上面 sim.* 的注记。）
  //
  // 改为**只补缺失的键**：
  //   · 仍然不覆盖任何已存在的键 —— 运维显式关掉的东西不许被种子重新打开
  //     （这才是原注释「已有 override 不覆盖」真正要守的东西）；
  //   · 但缺席的键要补上 —— 缺席不等于"运维决定关"，只等于"那会儿还没这个功能"。
  // 两者的区别就是这个函数有没有用：前者是尊重人的决定，后者是把没做的事当成决定。
  const merged = { ...(existing?.overrides ?? {}) };
  const added: string[] = [];
  for (const [k, v] of Object.entries(DEMO_LIGHTUP)) {
    if (k in merged) continue; // 已有（无论开关）→ 尊重现状，不动
    merged[k] = v;
    added.push(k);
  }
  if (existing && added.length === 0) return; // 无事可做，保持幂等

  await repos.featureConfigs.put({
    id: fcfgId,
    tenantId: DEMO_TENANT,
    overrides: merged,
    // 补写过就推进版本号，让下游缓存/审计看得见这次变更（新建时仍是 1，与原行为一致）
    configVersion: existing ? (existing.configVersion ?? 1) + 1 : 1,
    updatedBy: "system:seed-lightup",
    updatedAt: "2026-01-01T00:00:00.000Z", // 确定性（R6·不引时钟）
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
    // 节拍闸门未绑定（WO-SANDBOX-E4）。**这是诚实缺席，不是忘了填**：
    // demo 世界里「这条需求流要过哪个节拍闸门」是一个**建模判断**，不是能从种子推出来的事实——
    // 绑上 `demand.consensus` 等于替租户断言「需求压力必须等 S&OP 共识会才下传」。
    // E4 只把这条线接通（引擎认闸门 + tick 端点从对象库读 Cadence 建闸 + REST 可声明），
    // 具体哪条流绑哪个节拍留给建模/运营去配（`POST /a/v1/sim/propagation-rules` 带 cadenceNodeId）。
    cadenceNodeId: null,
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
    cadenceNodeId: null, // 同上：未绑定 = 这条流不过节拍闸门（缺省即旧行为，逐字节不变）
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
    cadenceNodeId: null, // 同上
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
