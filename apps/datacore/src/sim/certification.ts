import type { ClosureReport, GapReport, SimCertification, SimCertLevel } from "@platform/contracts";

/**
 * 推演沙盘 · 增量 2 就绪认证（RL3 单源 · 纯投影 · 零新校验逻辑）。
 *
 * 本文件**只投影**既有产物：`databuilder/closure.ts validateClosure` 的 5 维 findings
 * （OBJECT/DATA/FORWARD/CHAIN/SHAPE）+ `databuilder/selfcheck.ts` 的 GapReport +
 * 一次 Trial Tick（**两栈**：派生栈 `ontology-core recompute` + 传导栈 沙盘传导核）。
 *
 * ⚠ 上面这行原文停在「传导 `propagateTick` 待增量3」—— 而传导栈早已实装并有生产调用方
 *   （tick 路由 `app.ts`），于是注释比实现落后了整整一个增量，认证屏上的「规则触发 N 条」
 *   一直只在数派生栈、传导栈恒记 0（欠账 #152）。**本仓把注释说谎算作缺陷**，
 *   随 WO-SIM-SCOPE-TRIAL 一并改正，别再让它漂回去。
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
  /** §4 needed 计数（本体声明的应有数）—— present 计数从上面数组数。 */
  needed: {
    stateVars: number;
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
 * 一次 Trial Tick 的结果（**由调用方跑完再传进来** —— 本文件是纯投影，不许自己跑重算器，
 * 门 `scripts/check-sim-readiness.mjs` 静态咬死这一点）。
 *
 * `rulesFired` 是**两栈合计**。WO-SIM-SCOPE-TRIAL 之前它只装了派生栈的数
 * （`recompute` 的 topo 长度），传导栈恒记 0（欠账 #152）——
 * 屏上写「规则触发 N 条」，度量的却是另一套栈。两个分栈明细就是为了让"哪一栈在动"不再靠猜。
 */
export interface TrialTickInput {
  passed: boolean;
  rulesFired: number;
  /** 派生栈（ontology-core 重算）触发数。缺省 = 调用方没分栈（老调用点，合计仍成立）。 */
  derivationRulesFired?: number;
  /** 传导栈（沙盘传导核）真正产出贡献的规则数。 */
  propagationRulesFired?: number;
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
  const wc = {
    stateVars: { present: presentDerivations, needed: scope.needed.stateVars },
    derivationRules: { present: presentDerivations, needed: scope.needed.derivationRules },
    actions: { present: presentActions, needed: scope.needed.actions },
    propagationRules: { present: presentPropRules, needed: scope.needed.propagationRules },
  };
  const sumPresent = wc.stateVars.present + wc.derivationRules.present + wc.actions.present + wc.propagationRules.present;
  const sumNeeded = wc.stateVars.needed + wc.derivationRules.needed + wc.actions.needed + wc.propagationRules.needed;
  const wcPct = sumNeeded <= 0 ? 100 : Math.round((100 * sumPresent) / sumNeeded);

  // entering[]：将进入沙盘的状态变量清单（每条标 source = **真实来源** 派生依赖 / Action / PropagationRule）。
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
      passed: trial.passed, rulesFired: trial.rulesFired, at: trial.at, error: trial.error,
      // 分栈明细原样透传（投影，不新算）。调用方没分栈时不下发 —— 不替它编一个 0
      // （编 0 就等于宣称"传导栈没触发"，而事实是"没人告诉我"，这正是 #152 的形态）。
      ...(trial.derivationRulesFired !== undefined ? { derivationRulesFired: trial.derivationRulesFired } : {}),
      ...(trial.propagationRulesFired !== undefined ? { propagationRulesFired: trial.propagationRulesFired } : {}),
    },
    worldCompleteness: { pct: wcPct, ...wc, entering },
    canEnterSimulation,
    gaps: out,
    computedAt: scope.computedAt,
  };
}
