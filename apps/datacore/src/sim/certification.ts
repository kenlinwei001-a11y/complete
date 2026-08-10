import type { ClosureReport, GapReport, SimCertification, SimCertLevel } from "@platform/contracts";

/**
 * 推演沙盘 · 增量 2 就绪认证（RL3 单源 · 纯投影 · 零新校验逻辑）。
 *
 * 本文件**只投影**既有产物：`databuilder/closure.ts validateClosure` 的 5 维 findings
 * （OBJECT/DATA/FORWARD/CHAIN/SHAPE）+ `databuilder/selfcheck.ts` 的 GapReport +
 * 一次 Trial Tick（**两相**：派生相 `ontology-core recompute` 的 dryRun + 传导相 沙盘传导核）。
 *
 * ⚠ 这一行有两段来历，**都要留着**（WO-CERT-CONTRACT-RECONCILE 合成 · 别再合并成一句）：
 *   ① 原文曾停在「传导 `propagateTick` 待增量3 → 传导记 0」。那是**一条过期的诚实缺席声明**：
 *      传导核早已实装且有生产调用方（tick 路由 `app.ts`），真实缺口是**这条认证路没去调它**
 *      （欠账 #152）——「还没做出来」与「做出来了没接上」是两回事，修法不同（铁律 0.5）。
 *      → 由 WO-CERT-HONESTY 指出。
 *   ② 接上这条线的是 WO-SIM-SCOPE-TRIAL：装配方现在**真的**跑传导相，且只数「真产出贡献」
 *      的规则（源态为 0 / 无匹配边 / 闸门拿不到都不算触发）。→ 传导那个数是**真·触发计数**。
 *   ③ 但派生那个数**不是**触发数（见下 `TrialTickInput.derivationNodes` 的实测取证），
 *      两者性质不同，**不可相加** —— 旧字段 `rulesFired` 正是这么加出来的，已弃用。
 *
 * 落地规格逐字段照抄 docs/SPEC-sandbox-readiness-certification.md（§2 三张映射表 / §5 函数签名）。
 *
 * ⛔ 铁律（RL3）：不写任何新校验逻辑、不 import/调用 closure 以外的校验器、不写真值、
 *    不 Date.now()/不随机（时间戳由调用方传入，R6 确定性）。环检测复用 recompute
 *    （由调用方跑 Trial Tick 时若派生图有环 → `trial.error` 非空），本文件绝不新写图算法。
 *
 * 门 `scripts/check-sim-readiness.mjs` 静态断言本文件的投影纯度（§9）。
 */

// ── scope 计数（调用方从 live 本体投影传入；本函数只读，不查库） ─────────────────
export interface ObjectTypeRef {
  typeKey: string;
  /** 是否已归域（domain 非空且 ≠ unassigned）= OBJECT 维 BOUND 的前提。 */
  bound: boolean;
  /** 总属性字段数（知识维分母）。 */
  fieldCount: number;
  /** 被消费（DATA 维 BOUND）字段数（知识维分子）。 */
  consumedFieldCount: number;
  /** 该对象是否被 ≥1 切片/查询覆盖（observability：closure 无该对象 OBJECT-orphan）。 */
  sliceCovered: boolean;
  /** 该对象是否求解器入参齐 ∧ 有 Action（行为维分子判据）。 */
  behaviorReady: boolean;
}
export interface DerivationRef {
  typeKey: string;
  propKey: string;
  /** 派生公式依赖的源状态变量（`Type.prop` 形式或裸 prop）—— 用于扇出出边计数。 */
  sourceVars: string[];
  /** 是否已物化（present），否则仅本体声明（needed）。 */
  present: boolean;
}
export interface ActionRef {
  key: string;
  /** 作用对象类型（可空）。 */
  targetTypeKey: string | null;
}
export interface SliceRef {
  key: string;
}
export interface PropagationRuleRef {
  key: string;
  sourceTypeKey: string;
  sourceStateVar: string;
  targetTypeKey: string;
  targetStateVar: string;
  /** 增量3 才有传导规则；present=本体已声明该规则。 */
  present: boolean;
}

export interface CertScope {
  kind: "GLOBAL" | "LOCAL";
  targetRef: string | null;
  objectTypes: ObjectTypeRef[];
  derivations: DerivationRef[];
  actions: ActionRef[];
  slices: SliceRef[];
  propagationRules: PropagationRuleRef[];
  /** §4 needed 计数（本体声明的应有数）—— present 计数从上面数组数。
   *  ⚠ 原有 `stateVars` 已删（WO-CERT-HONESTY ①）：装配方 `app.ts` 给它的表达式与 `derivationRules`
   *  **逐字节相同**，它从来不是一个独立的应有数。留着就是一个名不副实的入参。 */
  needed: {
    derivationRules: number;
    actions: number;
    propagationRules: number;
  };
}

export interface CertConfig {
  maxFanout: number; // §2.2 默认 8
  minWriteback: number; // §2.2 默认 1
  minQueries: number; // §2.2 默认 1
  weights: { s: number; k: number; b: number }; // §2.3 默认 0.4/0.3/0.3
}

/** §2 三张映射表的钉死默认阈值（R14 config，换租户改配置不改码）。 */
export const DEFAULT_CERT_CONFIG: CertConfig = {
  maxFanout: 8,
  minWriteback: 1,
  minQueries: 1,
  weights: { s: 0.4, k: 0.3, b: 0.3 },
};

/**
 * Trial Tick 的**实测口径**（WO-CERT-CONTRACT-RECONCILE 合成 · 欠账 #152）。
 * 由调用方（`app.ts`）跑完再传进来 —— 本文件是纯投影，不许自己跑重算器/传导核，
 * 门 `scripts/check-sim-readiness.mjs` 静态咬死这一点。
 *
 * 【派生相】调用方跑 `ontology-core recompute` 的 dryRun 且**不喂变更集**（`changes=[]`）。
 *   它实际做的只有两件事：装载/索引对象、对全部 ACTIVE DerivationSpec 做拓扑排序。
 *   空变更集 ⇒ dirty 集为空 ⇒ 逐节点循环全部 `continue` ⇒ **零条派生公式被求值**。
 *   ⇒ 这里能诚实承载的只有「图有多大」与「排序有没有崩」，故字段名叫 `derivationNodes`。
 *
 * 【传导相】调用方**真跑**沙盘传导核一 tick，并只数「真产出了贡献」的规则 key
 *   （遍历到但源态为 0 / 无匹配边 / 闸门拿不到 **都不算触发**）⇒ `propagationRulesFired`
 *   是**真·触发计数**，与派生那个规模数**性质不同、不可相加**。
 *
 * ⚠ 两者必须同时报，且传导要连**分母** `propagationRulesDeclared` 一起报：
 *   只报 fired 的话，「本来就没有传导规则」与「声明了一堆但一条都没触发」在屏上都是 0，
 *   而后者是本仓最常见的病样（`declared > 0 && fired === 0`），必须看得见。
 *
 * ⚠ 本文件是纯投影（RL3）：以上是**调用方**的行为描述，本文件不调用任何校验器/重算器
 *   （门 `scripts/check-sim-readiness.mjs` 静态守此约束，**连注释里的函数名后跟左括号都会被它咬住**
 *    —— 这是对的，别为了让注释好看去放宽那条正则；已有两个 dev 各踩红一次）。
 */
export interface TrialTickInput {
  /** 空跑未抛异常 ⇒ 派生依赖图无环。**不等于**「这个世界推得动」。 */
  passed: boolean;
  /**
   * 拓扑排序出的派生规格节点数 = 派生依赖图**规模**。⚠ **不是触发数**（本次求值恒 0 条）。
   *
   * 实测取证（`apps/datacore/test/sim-cert-contract-reconcile.seam.test.ts` ③，亲手跑过）：
   * 同一份本体调两次重算，一次 `changes=[]`、一次喂真变更集 —— `order.length` **两次同为 2**，
   * 而 `updatedObjects` 分别是 0 与 1。同一个数在「零触发」与「真触发」下不变
   * ⇒ 它度量的是**图的规模**，不是本次触发了几条。名字即口径。
   */
  derivationNodes: number;
  /** 传导相（沙盘传导核）本次**真正产出贡献**的规则数（真·触发计数）。 */
  propagationRulesFired: number;
  /** 本次 Trial Tick **范围内已发布**的传导规则数 = 上面 fired 的**分母**（用于看见「全哑火」病样）。 */
  propagationRulesDeclared: number;
  /** 本次 Trial Tick **是否真的覆盖了传导相**。装配方今天真跑 ⇒ 传 `true`；摘掉/短路则必须翻 `false`。 */
  propagationCovered: boolean;
  at: string | null;
  error: string | null;
}

function pct(num: number, den: number): number {
  if (den <= 0) return 100; // 无应有项 = 满分（空 scope 不拖累综合）
  return Math.round((100 * num) / den);
}

/**
 * §5 纯投影函数。输入既有 closure / gaps / trial + scope 计数 → 输出 SimCertification。
 * 全局与局部**同一函数**，只换 scope（meta:sync 防漂）。computedAt 由调用方传入（R6）。
 */
export function deriveCertification(
  closure: ClosureReport,
  gaps: GapReport,
  trial: TrialTickInput,
  scope: CertScope & { computedAt: string },
  cfg: CertConfig = DEFAULT_CERT_CONFIG,
): SimCertification {
  const types = scope.objectTypes;
  const totalTypes = types.length;
  const objectsBound = types.filter((t) => t.bound).length;
  const hasObjectFail = closure.findings.some((f) => f.kind === "OBJECT" && f.status === "FAILED");
  const dataMissing = closure.findings.some((f) => f.kind === "DATA" && f.status === "MISSING");
  const forwardMissing = closure.forwardMissing > 0;

  // ── §2.3 三维准备度（投影 closure kind，非新算） ─────────────────────────────
  const structure = pct(objectsBound, totalTypes);
  const totalFields = types.reduce((a, t) => a + t.fieldCount, 0);
  const consumedFields = types.reduce((a, t) => a + t.consumedFieldCount, 0);
  const knowledge = pct(consumedFields, totalFields);
  const behaviorReady = types.filter((t) => t.behaviorReady).length;
  const behavior = pct(behaviorReady, totalTypes);
  const composite = Math.round(cfg.weights.s * structure + cfg.weights.k * knowledge + cfg.weights.b * behavior);

  // ── §2.2 L4 三元组（逐项 source；唯一新读 = 扇出出边计数） ────────────────────
  // ① Fanout 安全：图无环（recompute topo 不抛 → trial.error===null）∧ 每 sourceStateVar 出边 ≤ maxFanout。
  const outDeg = new Map<string, number>();
  const bump = (k: string) => outDeg.set(k, (outDeg.get(k) ?? 0) + 1);
  for (const d of scope.derivations) for (const sv of d.sourceVars) bump(sv);
  for (const p of scope.propagationRules) bump(`${p.sourceTypeKey}.${p.sourceStateVar}`);
  const maxOut = outDeg.size === 0 ? 0 : Math.max(...outDeg.values());
  const acyclic = trial.error === null; // 环检测复用 recompute（CYCLIC_DERIVATION → trial.error 非空）
  const fanoutSafe = acyclic && maxOut <= cfg.maxFanout;
  // ② Writeback 完整：scope 内 ≥ minWriteback 个 writeback ActionType（§2.2 writeback=ActionType 计数）。
  const writebackComplete = scope.actions.length >= cfg.minWriteback;
  // ③ Observability 达标：scope 内对象被 ≥ minQueries 个切片/查询覆盖（无 OBJECT-orphan）。
  const coveredTypes = types.filter((t) => t.sliceCovered).length;
  const observabilityMet = totalTypes > 0 && coveredTypes >= totalTypes && scope.slices.length >= cfg.minQueries;
  const l4Checks = { fanoutSafe, writebackComplete, observabilityMet };

  // ── §2.1 L0-L4 单调投影（取满足的最高级） ────────────────────────────────────
  // published≈所有对象已归域可跑（live 本体 ACTIVE 即视为可发布；缺归域则降级）。
  const published = totalTypes > 0 && types.every((t) => t.bound);
  let level: SimCertLevel = "L0_INVALID";
  // L1：类型已定义 ∧ 已归域（objectsBound>0 ∧ OBJECT 维无 FAILED）。
  if (totalTypes > 0 && objectsBound > 0 && !hasObjectFail) level = "L1_CONFIGURED";
  // L2：已发布 ∧ DATA/FORWARD 维无 MISSING（能跑派生与求解器）。
  if (level === "L1_CONFIGURED" && published && !dataMissing && !forwardMissing) level = "L2_RUNNABLE";
  // L3：L2 ∧ closure.gatePassed ∧ trialTick.passed。
  if (level === "L2_RUNNABLE" && closure.gatePassed && trial.passed) level = "L3_VERIFIED";
  // L4：L3 ∧ l4Checks 三项全 true。
  if (level === "L3_VERIFIED" && fanoutSafe && writebackComplete && observabilityMet) level = "L4_CERTIFIED";

  // ── §4 世界完整度（范围预检 · present/needed） ───────────────────────────────
  const presentDerivations = scope.derivations.filter((d) => d.present).length;
  const presentActions = scope.actions.length;
  const presentPropRules = scope.propagationRules.filter((p) => p.present).length;
  // ⚠ WO-CERT-HONESTY ①：这里曾有第 4 行 `stateVars: { present: presentDerivations, needed: scope.needed.stateVars }`
  //    —— present 与下一行**同一个变量**、needed 在 `app.ts` 与下一行**同一个表达式**，
  //    于是屏上「状态变量 N/M」与「派生规则 N/M」恒等（两行数同一个数），且派生在 pct 的
  //    分子分母里各被数了两遍（把 pct 系统性拉向派生的那个比值）。已删。
  //    每一对比值都必须能回答「present 与 needed 各自的承载物是谁」：
  //      · derivationRules：present = 已物化的 DerivationSpec(ACTIVE)；needed = 本体类型上声明的 derivedProperties
  //      · actions：present = scope 内 ActionType 数；needed = 装配方给的应有数
  //      · propagationRules：present = present=true 的 PropagationRule；needed = 本体声明的应有数
  //    「状态变量」答不上第二问（无人声明「应有几个」），故不做成比值 —— 见下 stateVarKeys。
  const wc = {
    derivationRules: { present: presentDerivations, needed: scope.needed.derivationRules },
    actions: { present: presentActions, needed: scope.needed.actions },
    propagationRules: { present: presentPropRules, needed: scope.needed.propagationRules },
  };
  const sumPresent = wc.derivationRules.present + wc.actions.present + wc.propagationRules.present;
  const sumNeeded = wc.derivationRules.needed + wc.actions.needed + wc.propagationRules.needed;
  const wcPct = sumNeeded <= 0 ? 100 : Math.round((100 * sumPresent) / sumNeeded);

  // stateVarKeys：这个世界**将承载的状态变量名**。定义与 `SandboxViewConfig.stateVars`（`app.ts` view-config）
  // 单源一致 —— 传导规则的 `sourceStateVar ∪ targetStateVar` 去重升序，也正是 `TickState` 每个对象桶的键。
  // 是**清单不是比值**：没有任何承载物声明「这个世界应该有几个状态变量」，编一个 needed 出来才是错答。
  const stateVarKeys = [
    ...new Set(scope.propagationRules.filter((p) => p.present).flatMap((p) => [p.sourceStateVar, p.targetStateVar])),
  ].sort();

  // entering[]：将进入沙盘的**要素**清单（每条标 source = **真实来源** 派生依赖 / Action / PropagationRule）。
  // ⚠ WO-CERT-HONESTY ②：本注释与前端标题原写「状态变量清单」，而这个数组混装三类 kind，
  //    其中只有 DERIVATION 是属性（ACTION 是写回动作、PROPAGATION 是传导规则）——
  //    实测 demo（SEED_DEMO=1 真跑 GET /a/v1/sim/sessions/:id/certification）23 条 = 行动 10 · 传导 13 · 派生 0，即"标题里的名词一条都没有"。故统一叫「要素」，
  //    并由前端按 kind 分组显示（行动 N · 传导 N · 派生 N），不拿一个名词盖三样东西。
  // 评审遗留修：source 不再用占位 `FULFILLS r_<type>_<prop>`，改投影派生的**真实依赖源变量**（sourceVars，
  // 派生公式所依赖的状态变量）——知道每个将进入态从哪来（R13 可溯源；数据可溯原则）。
  const entering: { key: string; kind: "DERIVATION" | "ACTION" | "PROPAGATION"; source: string }[] = [];
  for (const d of scope.derivations) {
    const source = d.sourceVars.length > 0 ? `派生自 ${d.sourceVars.join("·")}` : `派生 ${d.typeKey}.${d.propKey}（无声明依赖）`;
    entering.push({ key: `${d.typeKey}.${d.propKey}`, kind: "DERIVATION", source });
  }
  for (const a of scope.actions) entering.push({ key: a.key, kind: "ACTION", source: `ACTION ${a.key}` });
  for (const p of scope.propagationRules) entering.push({ key: p.key, kind: "PROPAGATION", source: `PROPAGATION ${p.key}` });

  // ── §7 诚实门：canEnterSimulation = L4 ∧ trialTick.passed ∧ closure.gatePassed ────
  // ⚠ WO-CERT-HONESTY ④：`worldCompleteness` **故意不在判据里**，这是对的，别加进来 ——
  //    两者度量的是两件事：
  //      · canEnterSimulation（认证）＝「**能不能跑**」：结构闭合、三元组达标、空跑没崩。
  //      · worldCompleteness（完整度）＝「**这个世界建得全不全**」：present/needed 的填充率。
  //    互不蕴含：一个只建了 33% 的世界，其已建的那部分完全可以闭合、可跑（L4 ∧ 33% 同时为真，
  //    不是矛盾）；反过来 100% 建全的世界也可能因有环而跑不动。
  //    缺陷不在这行判据，在**表达**：UI 曾把「✓可进入推演」与「完整度 33%」并排贴着且不解释，
  //    读起来像自相矛盾。修在前端 `SimReadinessPanel` 的完整度卡说明行，不动这里的语义。
  const canEnterSimulation = level === "L4_CERTIFIED" && trial.passed && closure.gatePassed;

  // ── 缺件诚实清单 gaps[]（绝不静默；既有 GapReport.findings + L4/门未达项） ────────
  const out: { gapCode: string; ref: string; detail: string }[] = [];
  for (const f of gaps.findings) {
    out.push({ gapCode: f.gapCode, ref: f.atStep ?? "closure", detail: f.evidence });
  }
  if (!fanoutSafe) {
    out.push({
      gapCode: "FANOUT_UNSAFE",
      ref: scope.targetRef ?? "GLOBAL",
      detail: acyclic ? `存在 sourceStateVar 出边 ${maxOut} > maxFanout ${cfg.maxFanout}` : `派生图有环（recompute 抛错：${trial.error}）`,
    });
  }
  if (!writebackComplete) {
    out.push({ gapCode: "NO_WRITEBACK", ref: scope.targetRef ?? "GLOBAL", detail: `writeback ActionType ${scope.actions.length} < minWriteback ${cfg.minWriteback}` });
  }
  if (!observabilityMet) {
    out.push({ gapCode: "NO_SLICE", ref: scope.targetRef ?? "GLOBAL", detail: `图查询覆盖 ${coveredTypes}/${totalTypes} 对象，切片 ${scope.slices.length} < minQueries ${cfg.minQueries}` });
  }
  if (!trial.passed) {
    out.push({ gapCode: "TRIAL_TICK_FAILED", ref: scope.targetRef ?? "GLOBAL", detail: trial.error ?? "Trial Tick 未通过" });
  }
  // 「传导规则声明了一堆，一条都没触发」—— 本仓最常见的病样，必须**看得见**而不是被一个 0 盖住。
  // 判据用的是 declared vs fired 两个数的差（投影入参，非新算）：**只报 fired 分辨不出**
  // 「本来就没规则」（declared=0，正常）与「有规则但全哑火」（declared>0 且 fired=0，有病）。
  // 只在传导相**真跑过**时才判：没跑过就报"全哑火"是冤枉它（那是覆盖面问题，见下一条）。
  if (trial.propagationCovered && trial.propagationRulesDeclared > 0 && trial.propagationRulesFired === 0) {
    out.push({
      gapCode: "PROPAGATION_ALL_SILENT",
      ref: scope.targetRef ?? "GLOBAL",
      detail: `本范围内已发布传导规则 ${trial.propagationRulesDeclared} 条，Trial Tick 实际产出贡献 0 条（源态为 0 / 无匹配边 / 闸门未放行）`,
    });
  }
  // 传导相**没跑**也必须说出来 —— 否则 `propagationRulesFired: 0` 会被读成「跑了，没触发」，
  // 而事实是「没人跑过」。这正是欠账 #152 的原始形态（信号是真的，但不指向要断言的那个对象）。
  if (!trial.propagationCovered) {
    out.push({
      gapCode: "PROPAGATION_NOT_COVERED",
      ref: scope.targetRef ?? "GLOBAL",
      detail: `本次 Trial Tick 未覆盖传导相 ⇒ 传导触发数不可解读（已声明 ${trial.propagationRulesDeclared} 条）`,
    });
  }
  if (!closure.gatePassed && level !== "L0_INVALID" && level !== "L1_CONFIGURED") {
    out.push({ gapCode: "CLOSURE_GATE_FAILED", ref: scope.targetRef ?? "GLOBAL", detail: `closure 未过门（forwardMissing=${closure.forwardMissing} chainBroken=${closure.chainBroken} shapeBroken=${closure.shapeBroken}）` });
  }

  return {
    scope: scope.kind,
    targetRef: scope.targetRef,
    level,
    dims: { structure, knowledge, behavior, composite },
    l4Checks,
    trialTick: {
      passed: trial.passed,
      // 诚实口径（新）：规模 / 真触发 / 分母 / 覆盖面，四个数各答一个问题，互不冒充。
      derivationNodes: trial.derivationNodes,
      propagationRulesFired: trial.propagationRulesFired,
      propagationRulesDeclared: trial.propagationRulesDeclared,
      propagationCovered: trial.propagationCovered,
      // 过渡字段（deprecated）：**在此处由诚实字段算出**，不从入参另收一份 ——
      // 让它们无法与上面四个数漂移（同一份真相的两种表述，而不是两份真相）。
      // 值与本单之前逐字节相同（`rulesFired` = 派生规模 + 传导触发），仅为老消费方可回退。
      // 删除条件见契约 `SimCertificationSchema.trialTick.rulesFired` 注释。
      rulesFired: trial.derivationNodes + trial.propagationRulesFired,
      derivationRulesFired: trial.derivationNodes,
      at: trial.at,
      error: trial.error,
    },
    worldCompleteness: { pct: wcPct, ...wc, stateVarKeys, entering },
    canEnterSimulation,
    gaps: out,
    computedAt: scope.computedAt,
  };
}
