import type { ProcessWaitKind, PropagationRule } from "@platform/contracts";
import { ProcessDefinitionSchema, ProcessDomainSchema } from "@platform/contracts";
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
 * WO-LIGHTUP → WO-DEMO-LIGHTUP-2：demo 租户显式点亮 **14 条**暗发功能（13 条 QOS 路由门 + 1 条 DataCore 性能门）。
 * 这些键被 battery「all on」模板诚实排除（`QOS_DARK_LAUNCH_FEATURES` / `PERF_DARK_LAUNCH_FEATURES`·见 features.ts），
 * 只能经**显式** override 开 —— 本表就是那份显式 override。让 demo 开箱即体验：
 * DRIL 智能检索路由 / 反思闭环 / CEO 真 LLM 自由推理 / 多角色编排 / 组合路径 / 推理旁白 / 停滞升级 /
 * 确定性跨域 + L3 耦合联合求解 / 自由问答挂技能 / L2 真分解 / LLM 多意图兜底 / 优化 what-if 会话路由 / 求解器上下文按需加载。
 *
 * ⚠ 暗发集合共 15 条，本表 14 条 —— 差的那一条（`qos.llm-budget-enforce`）是**刻意不点**，理由写在下方。
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
 *  - 沿真链路：sourceTypeKey/viaLinkKey/targetTypeKey 均为 demo 本体真有的对象类型/链路 key，
 *    且每条都经**实测**确认「链路存在 + 方向对 + 两端在 demo 真有实例」（#158 的教训）。
 *
 * WO-P1（PRD-UPGRADE-decision-sandbox-v2 §3.1.4 · REQ143）：补齐**六个方向**，共 13 条规则。
 * 此前三条边全部指向 `Base.loadIndex`，走不到 North Star 要的「断点/卡点/时长/消耗」。
 *
 *   方向 | 链                                                              | 回答哪一维
 *   -----|-----------------------------------------------------------------|------------
 *   需求 | Order.demandPressure → Model.demandLoad → Base.loadIndex         | —
 *   产能 | Base.loadIndex → Line.utilPressure → Process.queuePressure       | 卡点 BOTTLENECK
 *   供应 | Supplier.deliveryDelay → Material.shortageRisk → Model.supplyRisk → Order.shortageRisk | 断点 MATERIAL
 *   交付 | Material.shortageRisk → PurchaseOrder.expeditePressure → IncomingInspection.queueDays | 时长
 *   成本 | Material.priceShock → Model.costPressure → Order.costPressure    | 消耗
 *   现金 | Order.costPressure → Customer.receivablePressure → ARInvoice.overduePressure | 消耗
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
  // ③ 基地负载 → 沿"基地辖下产线"边摊到产线利用率压力（延迟 1 tick，演示时序传导）。
  //
  // 🔧 **WO-P1 修 #158：这条边原来是反的，从来没触发过**。原文是
  //    `Line.utilPressure --line_belongs_to_base--> Base.loadIndex`，而实测两处都不支持它：
  //    ① 方向：`line_belongs_to_base` 在本体里声明为 **Base→Line 1:N**（`battery.ts:2321`，
  //       其上一行注释写明"N:1 语义通过翻转方向表达为 1:N"），`synthetic/service.ts` 落的实例
  //       也是 `from=obj_base_changzhou → to=obj_line_…`（实测 130 条，全部 Base→Line）。
  //       而 `propagateTick` 的 navOut 只沿 `fromId→toId` 走 ⇒ 从 Line 出发**取不到任何 target**。
  //    ② 源恒为 0：全 demo 没有任何东西写 `Line.utilPressure`，`sourceVal === 0` 直接 continue。
  //    即：这条规则**同时**踩了「接错方向」和「接了线没数据」两种死法。
  //
  // 为什么选"改规则方向"而不是"补一条反向 line_belongs_to_base"：
  //    · **业务语义**：本沙盘传导的是**需求压力/规划负载**，不是实测利用率上卷。既有 ①②
  //      已经把方向定死为「需求自市场向生产层级下达」（Order→Model→Base）；负载到了基地再
  //      **摊到产线**，产线利用率是**结果**不是原因。反向（Line→Base）是"实际利用率上卷"的
  //      报表口径，不是本引擎在做的事。
  //    · **本体单源**：往一个已声明 `from=Base,to=Line` 的 key 里塞 Line→Base 的行，等于违反
  //      它自己的类型声明，还会污染三处按 `direction:"out"` 从 Base 走这条边的 battery 切片
  //      （`battery.ts:2438/2483/2550`）与 `slice-order-fulfillment` 测试。
  //    · 代价：改一行种子 vs 造一条与声明打架的边——前者最小且不撒谎。
  //    · 顺带把 demo 主链从 2 跳变 3 跳（Order→Model→Base→Line），且 `Line.utilPressure`
  //      第一次有了**产出者**（此前它是个谁都不写的死源）。
  //
  // id 保持 `simpr_demo_line_to_base` 不变：`putPropagationRule` 是按 id 幂等覆盖，
  // 换 id 会让已落库的 pg 租户**残留一条已知失效的旧规则**（新旧并存、旧的继续不触发）。
  // 覆盖旧行才是干净的迁移，故 id 记录的是"第 ③ 条槽位"，不是它的语义。
  {
    id: "simpr_demo_line_to_base",
    key: "demo_base_load_to_line_util",
    sourceTypeKey: "Base",
    sourceStateVar: "loadIndex",
    viaLinkKey: "line_belongs_to_base",
    targetTypeKey: "Line",
    targetStateVar: "utilPressure",
    coefficient: 0.5,
    delayTicks: 1,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null, // 同上
    status: "PUBLISHED",
  },

  // ══════════════════════════════════════════════════════════════════════════════════
  // WO-P1 · 补齐六方向传导边（PRD-UPGRADE-decision-sandbox-v2 §3.1.4 · 关闭 REQ143）
  //
  // 此前三条边**全部指向 Base.loadIndex** ⇒ 无论施加什么扰动，传导都只走到"基地负载"为止，
  // 走不到 North Star 要的「断点 / 卡点 / 时长 / 消耗」。以下按 §3.1.4 那张表补齐其余五向。
  //
  // ⛔ 这些边是**数据**（`sim_propagation_rule` 行），不是代码 —— 本单一行都没碰 `sim/propagation.ts`。
  // 每条边的 viaLinkKey 都经**实测**确认「链路真实存在 + 方向对 + demo 租户两端都有实例」，
  // 不是照 PRD 示例抄一遍就算（#158 的教训正是"种子写了但方向不对，规则恒不触发还没人发现"）。
  // ══════════════════════════════════════════════════════════════════════════════════

  // ── 供应（断点 MATERIAL）：供应商交付延迟 → 物料短缺 → 型号缺料 → 订单缺口 ──
  // 三跳全部走 WO-P1 新补的**影响向逆边**（见 battery.ts/service.ts）：既有 supply 边是归属 FK
  // 方向（下游→上游），跑影响传导会走反。实测全本体除此之外**没有任何一条边能走到 Order**。
  {
    id: "simpr_demo_supplier_to_material",
    key: "demo_supplier_delay_to_material_shortage",
    sourceTypeKey: "Supplier",
    sourceStateVar: "deliveryDelay",
    viaLinkKey: "supplier_supplies_material", // 实测 Supplier→Material，8 条
    targetTypeKey: "Material",
    targetStateVar: "shortageRisk",
    coefficient: 0.9,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
  },
  {
    id: "simpr_demo_material_to_model_supply",
    key: "demo_material_shortage_to_model_supply_risk",
    sourceTypeKey: "Material",
    sourceStateVar: "shortageRisk",
    viaLinkKey: "material_used_by_model", // 实测 Material→Model，24 条
    targetTypeKey: "Model",
    targetStateVar: "supplyRisk",
    coefficient: 0.7,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
  },
  {
    id: "simpr_demo_model_supply_to_order",
    key: "demo_model_supply_risk_to_order_shortage",
    sourceTypeKey: "Model",
    sourceStateVar: "supplyRisk",
    viaLinkKey: "model_demanded_by_order", // 实测 Model→Order，24 条
    targetTypeKey: "Order",
    targetStateVar: "shortageRisk",
    coefficient: 0.8,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
  },

  // ── 产能（卡点 BOTTLENECK）：产线利用率压力 → 工序排队压力 ──
  // 承接修好的第 ③ 条（Base→Line），把负载再下推一层到**工序**——卡点落在工序上，不在产线上。
  {
    id: "simpr_demo_line_to_process",
    key: "demo_line_util_to_process_queue",
    sourceTypeKey: "Line",
    sourceStateVar: "utilPressure",
    viaLinkKey: "line_has_process", // 实测 Line→Process，650 条
    targetTypeKey: "Process",
    targetStateVar: "queuePressure",
    coefficient: 0.7,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
  },

  // ── 交付（时长）：物料短缺 → 采购加急 → 到货检验排队天数 ──
  // 口径取自 `solvers/chain-loss.ts` 对前置期的分段（…→material_supplied_by_po→po_inspected_by），
  // 即"到货检验"是一段**真实前置期**。⚠ 刻意**不用** `base_has_shipment`：
  // `chain-loss.ts:456` 已经查实 Shipment 是 **SRM 来料在途**、不是成品发运，
  // 拿"基地负载 → 来料在途变长"当交付链就是口径错标。
  {
    id: "simpr_demo_material_to_po",
    key: "demo_material_shortage_to_po_expedite",
    sourceTypeKey: "Material",
    sourceStateVar: "shortageRisk",
    viaLinkKey: "material_supplied_by_po", // 实测 Material→PurchaseOrder，30 条
    targetTypeKey: "PurchaseOrder",
    targetStateVar: "expeditePressure",
    coefficient: 0.5,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
  },
  {
    id: "simpr_demo_po_to_inspection",
    key: "demo_po_expedite_to_inspection_queue",
    sourceTypeKey: "PurchaseOrder",
    sourceStateVar: "expeditePressure",
    viaLinkKey: "po_inspected_by", // 实测 PurchaseOrder→IncomingInspection，30 条
    targetTypeKey: "IncomingInspection",
    targetStateVar: "queueDays",
    coefficient: 0.6,
    delayTicks: 1, // 检验排队是"下一批才排得上"，故留一个 tick 行程
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
  },

  // ── 成本（消耗）：物料涨价 → 型号成本压力 → 订单成本压力 ──
  // 与"供应"两条共用同一对逆边、但走**不同 stateVar**：缺料与涨价是两件事，
  // 同一条链路上并行传导两种压力（PRD §3.1.4「成本」行 Material.price → Order.cost）。
  {
    id: "simpr_demo_material_price_to_model_cost",
    key: "demo_material_price_to_model_cost",
    sourceTypeKey: "Material",
    sourceStateVar: "priceShock",
    viaLinkKey: "material_used_by_model",
    targetTypeKey: "Model",
    targetStateVar: "costPressure",
    coefficient: 0.65,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
  },
  {
    id: "simpr_demo_model_cost_to_order_cost",
    key: "demo_model_cost_to_order_cost",
    sourceTypeKey: "Model",
    sourceStateVar: "costPressure",
    viaLinkKey: "model_demanded_by_order",
    targetTypeKey: "Order",
    targetStateVar: "costPressure",
    coefficient: 0.9,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
  },

  // ── 现金（消耗）：订单成本压力 → 客户应收压力 → 发票逾期压力 ──
  // 两条边都是既有的、方向本来就对（Order→Customer→ARInvoice），无需补逆边。
  {
    id: "simpr_demo_order_cost_to_customer_ar",
    key: "demo_order_cost_to_customer_receivable",
    sourceTypeKey: "Order",
    sourceStateVar: "costPressure",
    viaLinkKey: "order_of_customer", // 实测 Order→Customer，24 条
    targetTypeKey: "Customer",
    targetStateVar: "receivablePressure",
    coefficient: 0.5,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
  },
  {
    id: "simpr_demo_customer_ar_to_invoice",
    key: "demo_customer_receivable_to_invoice_overdue",
    sourceTypeKey: "Customer",
    sourceStateVar: "receivablePressure",
    viaLinkKey: "customer_has_invoice", // 实测 Customer→ARInvoice，24 条
    targetTypeKey: "ARInvoice",
    targetStateVar: "overduePressure",
    coefficient: 0.4,
    delayTicks: 1, // 逾期是"账期到了才显形"，留一个 tick
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
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

// ══════════════════════════════════════════════════════════════════════════
// WO-Q0 · 业务流程层种子（13 一级业务域 × 65 核心业务流程）
// PRD-UPGRADE-decision-sandbox-v2 §3.2 · DECISION-13domain-65process-layering.md
// ══════════════════════════════════════════════════════════════════════════

/**
 * 13 个一级业务域。
 *
 * 🔴 **每个 D## 都锚到 `graphmeta.ts` 的 `BUSINESS_DOMAINS`（14 域注册表）**，不新造词表。
 * 理由与实测证据写在 `packages/contracts/src/process.ts` §3：裁决文档说「平台无域概念」是错的，
 * 那份 14 域注册表真接线（`GET /a/v1/business-domains` · `refbase.ts` · `refbase-coverage.ts`），
 * 还被 `test/a3-business-domains.test.ts` 锁在 14 条。不锚 = 造第二套业务域词表。
 *
 * ── 14 域里唯一没有对应流程域的是 `external`（外部信号）—— **这是判断，不是遗漏** ──
 * `external` 是**数据来源域**（`ExternalSignal` / `CommodityPriceTrend` 是外部行情数据），
 * 不是「企业内部的一类业务活动」。真正消费外部信号的活动（采集、研判、跟踪）
 * 已落在 D02 需求与预测（P08/P09/P10），承载物就是那两个类型。
 * 为它单开一个流程域会造出一个域名叫「外部信号」、里面全是别的域已有的活动的空域。
 */
const DEMO_PROCESS_DOMAINS: ReadonlyArray<{ key: string; name: string; businessDomainKey: string }> = [
  { key: "D01", name: "经营规划与情景", businessDomainKey: "plan" },
  { key: "D02", name: "需求与预测", businessDomainKey: "forecast" },
  { key: "D03", name: "销售与客户", businessDomainKey: "sales" },
  { key: "D04", name: "产品与工程", businessDomainKey: "product" },
  { key: "D05", name: "采购与供应", businessDomainKey: "material" },
  { key: "D06", name: "计划与排产", businessDomainKey: "capacity" },
  { key: "D07", name: "生产制造", businessDomainKey: "process" },
  { key: "D08", name: "质量管理", businessDomainKey: "quality" },
  { key: "D09", name: "设备与维护", businessDomainKey: "equip" },
  { key: "D10", name: "基地与仓储交付", businessDomainKey: "factory" },
  { key: "D11", name: "财务与成本", businessDomainKey: "finance" },
  { key: "D12", name: "人员与班组", businessDomainKey: "people" },
  { key: "D13", name: "决策与改善", businessDomainKey: "decision" },
];

/**
 * 65 条核心业务流程。四件齐：`ownerFunctionKey`（谁做）· `stdDurationDays`（多久）·
 * `waitKind`（卡在哪种等待）· `carrierTypeKey`（🔴 承载物）。
 *
 * ── 🔴 承载物纪律（红线 3）───────────────────────────────────────────────
 * 每条的 `carrierTypeKey` 都是 **battery 种子真物化出来的 94 个对象类型之一**
 * （实测枚举，非照文档抄）。`test/process-layer.test.ts` 断言① 真跑一次种子后逐条核对，
 * 拼错一个字母就红。**论证不出承载物的流程一条都没建**（放弃清单见本注释末尾）。
 *
 * ── 两个编号锚点，别改 ────────────────────────────────────────────────────
 * PRD §3.2.2 用 `P37 MPS` 与 `P40 APS排产` 举例说明「映射是 N:M」，WO-Q1 的
 * `process_chain_node_map` 会照它建映射。故本表的 **P37 = 主生产计划（MPS）编制**、
 * **P40 = 详细排产（APS）** 是对外承诺过的编号，改动会让 PRD 的例子与数据对不上。
 * 这两条**共用同一个承载物 `ProductionSchedule`** —— 这正是 `chain-sim.ts` 里
 * 「全仓只有一个排产承载物」那条实测事实，在流程层的合法形态（共用 ≠ 空壳，见 process.ts 文件头）。
 *
 * ── 放弃的流程（论证不出承载物，宁可少建也不填空壳）────────────────────
 *  ① **流程审批/会签**（跨域通用）—— 仓主已裁「流程审批不体现」（PRD §6.4 #1 维持不做），
 *     且平台无流程级审批承载物（`ActionDraft` 是 S2 行动审批，不是业务流程审批）。
 *     这与 `waitKind` 不收 `WAITING_APPROVAL` 是**同一条理由**。
 *  ② **招聘与培训**（人员域）—— 无 `TrainingPlan`/`Recruitment` 类型；
 *     `OperatorSkillCert` 承载的是「已认证」这个结果，承载不了培训过程本身。
 *  ③ **合同与法务评审**（销售/采购域）—— 无通用 `Contract` 类型；
 *     `LongTermAgreement` 是采购长协的专用承载物，套给销售合同就是错挂。
 *  ④ **售后与退换货（RMA）**（销售域）—— 无 `ReturnOrder`/`ServiceTicket`/`Complaint` 类型；
 *     `ExceptionEvent` 是产线异常事件，不是客户投诉，借用它会把两类东西搅成一摊。
 *  ⑤ **碳足迹核算与碳护照申报**（供应域）—— `CarbonFactor` 是**因子字典**
 *     （`factorId/kind/key/factor`），不是核算流程的产出物；碳足迹本身只作为
 *     `Order.carbonFootprint` **属性**存在（规则 C33 挂在它上面），属性不是一等承载物。
 *
 * R6：固定 id/key/时长，同 SEED_DEMO 重跑字节级一致；幂等（固定 id + put 覆盖）。
 */
const DEMO_PROCESS_DEFINITIONS: ReadonlyArray<{
  key: string; domainKey: string; name: string;
  ownerFunctionKey: string; stdDurationDays: number; waitKind: ProcessWaitKind; carrierTypeKey: string;
}> = [
  // ── D01 经营规划与情景（plan）· P01–P06 ────────────────────────────────
  { key: "P01", domainKey: "D01", name: "年度经营目标分解", ownerFunctionKey: "strategy_office", stdDurationDays: 30, waitKind: "WAITING_USER", carrierTypeKey: "PlanTarget" },
  { key: "P02", domainKey: "D01", name: "关键成功要素（KSF）梳理", ownerFunctionKey: "strategy_office", stdDurationDays: 15, waitKind: "WAITING_USER", carrierTypeKey: "KSF" },
  { key: "P03", domainKey: "D01", name: "年度情景测算与选案", ownerFunctionKey: "strategy_office", stdDurationDays: 20, waitKind: "WAITING_DATA", carrierTypeKey: "AnnualScenario" },
  { key: "P04", domainKey: "D01", name: "情景触发条件维护", ownerFunctionKey: "strategy_office", stdDurationDays: 5, waitKind: "WAITING_USER", carrierTypeKey: "ScenarioTrigger" },
  { key: "P05", domainKey: "D01", name: "产能投资立项与评审", ownerFunctionKey: "strategy_office", stdDurationDays: 45, waitKind: "WAITING_USER", carrierTypeKey: "CapexProject" },
  // S&OP 例会是典型的节拍等待（`chain-sim.ts` 的 demand.consensus 也在测这段）——本层只标类别，不算天数。
  { key: "P06", domainKey: "D01", name: "S&OP 产销平衡例会", ownerFunctionKey: "strategy_office", stdDurationDays: 3, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "SopVersionRow" },

  // ── D02 需求与预测（forecast）· P07–P11 ────────────────────────────────
  { key: "P07", domainKey: "D02", name: "需求细分预测编制", ownerFunctionKey: "demand_planning", stdDurationDays: 7, waitKind: "WAITING_DATA", carrierTypeKey: "DemandSegment" },
  { key: "P08", domainKey: "D02", name: "外部信号采集与研判", ownerFunctionKey: "demand_planning", stdDurationDays: 2, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "ExternalSignal" },
  { key: "P09", domainKey: "D02", name: "原材料价格趋势跟踪", ownerFunctionKey: "demand_planning", stdDurationDays: 2, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "CommodityPriceTrend" },
  { key: "P10", domainKey: "D02", name: "竞品份额监测", ownerFunctionKey: "demand_planning", stdDurationDays: 5, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "CompetitorShare" },
  { key: "P11", domainKey: "D02", name: "竞品价格监测", ownerFunctionKey: "demand_planning", stdDurationDays: 3, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "CompetitorPrice" },

  // ── D03 销售与客户（sales）· P12–P19 ───────────────────────────────────
  { key: "P12", domainKey: "D03", name: "商机漏斗跟进", ownerFunctionKey: "sales", stdDurationDays: 10, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "PipelineOpportunity" },
  { key: "P13", domainKey: "D03", name: "询报价与投标", ownerFunctionKey: "sales", stdDurationDays: 14, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "BidRecord" },
  { key: "P14", domainKey: "D03", name: "赢单丢单复盘", ownerFunctionKey: "sales", stdDurationDays: 5, waitKind: "WAITING_DATA", carrierTypeKey: "WinLossRecord" },
  { key: "P15", domainKey: "D03", name: "客户准入与信用授信", ownerFunctionKey: "sales", stdDurationDays: 15, waitKind: "WAITING_USER", carrierTypeKey: "Customer" },
  { key: "P16", domainKey: "D03", name: "客户收货地点与物流条款维护", ownerFunctionKey: "sales", stdDurationDays: 3, waitKind: "WAITING_USER", carrierTypeKey: "CustomerLocation" },
  { key: "P17", domainKey: "D03", name: "销售订单评审接单", ownerFunctionKey: "sales", stdDurationDays: 3, waitKind: "WAITING_USER", carrierTypeKey: "Order" },
  { key: "P18", domainKey: "D03", name: "订单拆行与排产要素确认", ownerFunctionKey: "sales", stdDurationDays: 1, waitKind: "WAITING_USER", carrierTypeKey: "OrderLine" },
  { key: "P19", domainKey: "D03", name: "交期承诺（ATP/CTP）", ownerFunctionKey: "sales", stdDurationDays: 1, waitKind: "WAITING_DATA", carrierTypeKey: "OrderPromise" },

  // ── D04 产品与工程（product）· P20–P27 ─────────────────────────────────
  { key: "P20", domainKey: "D04", name: "产品平台规划", ownerFunctionKey: "product_engineering", stdDurationDays: 60, waitKind: "WAITING_USER", carrierTypeKey: "ProductPlatform" },
  { key: "P21", domainKey: "D04", name: "产品系列规划", ownerFunctionKey: "product_engineering", stdDurationDays: 30, waitKind: "WAITING_USER", carrierTypeKey: "ProductSeries" },
  { key: "P22", domainKey: "D04", name: "型号立项与定义", ownerFunctionKey: "product_engineering", stdDurationDays: 45, waitKind: "WAITING_USER", carrierTypeKey: "Model" },
  { key: "P23", domainKey: "D04", name: "产品版本发布", ownerFunctionKey: "product_engineering", stdDurationDays: 15, waitKind: "WAITING_USER", carrierTypeKey: "ProductVersion" },
  { key: "P24", domainKey: "D04", name: "BOM 编制与维护", ownerFunctionKey: "product_engineering", stdDurationDays: 10, waitKind: "WAITING_DATA", carrierTypeKey: "BOMHeader" },
  { key: "P25", domainKey: "D04", name: "工程变更（ECN）处理", ownerFunctionKey: "product_engineering", stdDurationDays: 14, waitKind: "WAITING_USER", carrierTypeKey: "EngineeringChange" },
  { key: "P26", domainKey: "D04", name: "工艺路线与工序设计", ownerFunctionKey: "process_engineering", stdDurationDays: 20, waitKind: "WAITING_USER", carrierTypeKey: "Routing" },
  { key: "P27", domainKey: "D04", name: "工艺能力窗口标定", ownerFunctionKey: "process_engineering", stdDurationDays: 12, waitKind: "WAITING_DATA", carrierTypeKey: "ProcessCapabilityWindow" },

  // ── D05 采购与供应（material）· P28–P36 ────────────────────────────────
  { key: "P28", domainKey: "D05", name: "供应商准入与评估", ownerFunctionKey: "procurement", stdDurationDays: 30, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "Supplier" },
  { key: "P29", domainKey: "D05", name: "长期协议谈判与签订", ownerFunctionKey: "procurement", stdDurationDays: 45, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "LongTermAgreement" },
  { key: "P30", domainKey: "D05", name: "备份供应池维护", ownerFunctionKey: "procurement", stdDurationDays: 20, waitKind: "WAITING_USER", carrierTypeKey: "BackupSupplierPool" },
  { key: "P31", domainKey: "D05", name: "替代料评估与切换", ownerFunctionKey: "process_engineering", stdDurationDays: 15, waitKind: "WAITING_USER", carrierTypeKey: "MaterialAlternative" },
  { key: "P32", domainKey: "D05", name: "物料平衡（MRP）运行", ownerFunctionKey: "supply_chain", stdDurationDays: 1, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "MaterialBalance" },
  { key: "P33", domainKey: "D05", name: "请购与采购下单", ownerFunctionKey: "procurement", stdDurationDays: 3, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "PurchaseOrder" },
  { key: "P34", domainKey: "D05", name: "进口清关", ownerFunctionKey: "supply_chain", stdDurationDays: 7, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "CustomsClearance" },
  // 承载物跨域是设计（domainKey 说「谁的活」，carrierTypeKey 说「作用在什么上」）：IQC 归采购段流程，
  // 但 IncomingInspection 这个类型属质量域 —— 与 procurement.ts 的四段责任方划分（QUALITY_IQC）一致。
  { key: "P35", domainKey: "D05", name: "到货检验（IQC）", ownerFunctionKey: "quality", stdDurationDays: 2, waitKind: "WAITING_DATA", carrierTypeKey: "IncomingInspection" },
  { key: "P36", domainKey: "D05", name: "物料批次入库与呆滞盘点", ownerFunctionKey: "warehouse_logistics", stdDurationDays: 2, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "MaterialBatch" },

  // ── D06 计划与排产（capacity）· P37–P41 ────────────────────────────────
  // ⚓ P37 / P40 是 PRD §3.2.2 点名的编号锚点，WO-Q1 的映射表按它建 —— 不许改号。
  { key: "P37", domainKey: "D06", name: "主生产计划（MPS）编制", ownerFunctionKey: "production_planning", stdDurationDays: 5, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "ProductionSchedule" },
  { key: "P38", domainKey: "D06", name: "产能与瓶颈复核（RCCP）", ownerFunctionKey: "production_planning", stdDurationDays: 2, waitKind: "WAITING_DATA", carrierTypeKey: "Line" },
  { key: "P39", domainKey: "D06", name: "节拍闸门维护", ownerFunctionKey: "production_planning", stdDurationDays: 5, waitKind: "WAITING_USER", carrierTypeKey: "Cadence" },
  { key: "P40", domainKey: "D06", name: "详细排产（APS）", ownerFunctionKey: "production_planning", stdDurationDays: 1, waitKind: "WAITING_DATA", carrierTypeKey: "ProductionSchedule" },
  { key: "P41", domainKey: "D06", name: "跨基地调拨决策", ownerFunctionKey: "supply_chain", stdDurationDays: 3, waitKind: "WAITING_USER", carrierTypeKey: "InterBaseTransfer" },

  // ── D07 生产制造（process）· P42–P45 ───────────────────────────────────
  { key: "P42", domainKey: "D07", name: "工单下达", ownerFunctionKey: "production_planning", stdDurationDays: 1, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "WorkOrder" },
  { key: "P43", domainKey: "D07", name: "齐套发料与投料", ownerFunctionKey: "warehouse_logistics", stdDurationDays: 1, waitKind: "WAITING_DATA", carrierTypeKey: "WIPLot" },
  { key: "P44", domainKey: "D07", name: "工序流转报工", ownerFunctionKey: "manufacturing", stdDurationDays: 1, waitKind: "WAITING_USER", carrierTypeKey: "WIPMove" },
  { key: "P45", domainKey: "D07", name: "换型切换执行", ownerFunctionKey: "manufacturing", stdDurationDays: 1, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "ChangeoverMatrix" },

  // ── D08 质量管理（quality）· P46–P49 ───────────────────────────────────
  { key: "P46", domainKey: "D08", name: "质量标准与检验特性制定", ownerFunctionKey: "quality", stdDurationDays: 20, waitKind: "WAITING_USER", carrierTypeKey: "QualityStandard" },
  { key: "P47", domainKey: "D08", name: "过程质检攒批与判定", ownerFunctionKey: "quality", stdDurationDays: 1, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "QualityLot" },
  { key: "P48", domainKey: "D08", name: "缺陷记录与不良分析", ownerFunctionKey: "quality", stdDurationDays: 2, waitKind: "WAITING_DATA", carrierTypeKey: "DefectRecord" },
  { key: "P49", domainKey: "D08", name: "异常事件处置闭环", ownerFunctionKey: "quality", stdDurationDays: 2, waitKind: "WAITING_USER", carrierTypeKey: "ExceptionEvent" },

  // ── D09 设备与维护（equip）· P50–P53 ───────────────────────────────────
  { key: "P50", domainKey: "D09", name: "计划检修窗排定", ownerFunctionKey: "maintenance", stdDurationDays: 10, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "MaintPlan" },
  { key: "P51", domainKey: "D09", name: "设备告警响应与维修派工", ownerFunctionKey: "maintenance", stdDurationDays: 1, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "MaintenanceOrder" },
  { key: "P52", domainKey: "D09", name: "OEE 采集与损失分解", ownerFunctionKey: "maintenance", stdDurationDays: 1, waitKind: "WAITING_DATA", carrierTypeKey: "EquipmentOEE" },
  { key: "P53", domainKey: "D09", name: "备件消耗与补货", ownerFunctionKey: "maintenance", stdDurationDays: 7, waitKind: "WAITING_DATA", carrierTypeKey: "SparePartConsumption" },

  // ── D10 基地与仓储交付（factory）· P54–P57 ─────────────────────────────
  { key: "P54", domainKey: "D10", name: "基地与车间产能台账维护", ownerFunctionKey: "production_planning", stdDurationDays: 10, waitKind: "WAITING_USER", carrierTypeKey: "Base" },
  { key: "P55", domainKey: "D10", name: "产线型号认证", ownerFunctionKey: "quality", stdDurationDays: 30, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "Certification" },
  { key: "P56", domainKey: "D10", name: "成品入库与库存对账", ownerFunctionKey: "warehouse_logistics", stdDurationDays: 1, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "FinishedGoodsInventory" },
  { key: "P57", domainKey: "D10", name: "发运与在途跟踪", ownerFunctionKey: "warehouse_logistics", stdDurationDays: 2, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "Shipment" },

  // ── D11 财务与成本（finance）· P58–P60 ─────────────────────────────────
  { key: "P58", domainKey: "D11", name: "财务预算编制", ownerFunctionKey: "finance", stdDurationDays: 20, waitKind: "WAITING_USER", carrierTypeKey: "FinancePlan" },
  { key: "P59", domainKey: "D11", name: "开票、应收与账龄监控", ownerFunctionKey: "finance", stdDurationDays: 3, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "ARInvoice" },
  { key: "P60", domainKey: "D11", name: "逾期催收", ownerFunctionKey: "finance", stdDurationDays: 15, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "OverdueRecord" },

  // ── D12 人员与班组（people）· P61–P62 ──────────────────────────────────
  { key: "P61", domainKey: "D12", name: "班次计划排定", ownerFunctionKey: "hr_operations", stdDurationDays: 5, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "ShiftPlan" },
  { key: "P62", domainKey: "D12", name: "操作工技能认证与授权", ownerFunctionKey: "hr_operations", stdDurationDays: 20, waitKind: "WAITING_USER", carrierTypeKey: "OperatorSkillCert" },

  // ── D13 决策与改善（decision）· P63–P65 ────────────────────────────────
  { key: "P63", domainKey: "D13", name: "经营指标越线监控", ownerFunctionKey: "decision_support", stdDurationDays: 1, waitKind: "WAITING_DATA", carrierTypeKey: "Metric" },
  { key: "P64", domainKey: "D13", name: "根因归因与复盘", ownerFunctionKey: "decision_support", stdDurationDays: 3, waitKind: "WAITING_DATA", carrierTypeKey: "RootCauseChain" },
  { key: "P65", domainKey: "D13", name: "处置方案采纳与跟踪", ownerFunctionKey: "decision_support", stdDurationDays: 7, waitKind: "WAITING_USER", carrierTypeKey: "AdoptedMitigation" },
];

/**
 * 播 demo 的业务流程层种子（13 域 + 65 流程）。幂等：固定 id + `putMany` 覆盖。
 *
 * **写前先 zod parse**：种子是本层唯一的数据来源，形状错了要在播种时就炸，
 * 而不是等到某个消费方读到一条缺字段的记录再报一个没头没尾的错
 * （`strictObject` 同时挡住"多写一个字段"——那通常是改名改了一半）。
 *
 * 由 SEED_DEMO 启动路径调用（`server.ts` / `seed-cli.ts`）。**不放进基座 `seedDemo`**：
 * 与 `seedDemoEntitlements` 同一条理由 —— 单测 `makeApp()` 需要「干净 demo」基线，
 * 流程层是行业模板内容，不该出现在每个不相干的单测里。
 *
 * ⚠ 本函数**不校验 `carrierTypeKey` 在本体里存在**（那需要本体已物化，而播种顺序不该由它绑架）。
 * 那条判据由 `test/process-layer.test.ts` 断言① 守 —— 门在测试层，不在运行时。
 */
export async function seedDemoProcessLayer(repos: Repos): Promise<void> {
  const domains = DEMO_PROCESS_DOMAINS.map((d, i) =>
    ProcessDomainSchema.parse({ ...d, id: `pdom_${DEMO_TENANT}_${d.key}`, tenantId: DEMO_TENANT, order: i }),
  );
  const defs = DEMO_PROCESS_DEFINITIONS.map((p) =>
    ProcessDefinitionSchema.parse({ ...p, id: `pdef_${DEMO_TENANT}_${p.key}`, tenantId: DEMO_TENANT }),
  );
  await repos.processDomains.putMany(domains);
  await repos.processDefinitions.putMany(defs);
}
