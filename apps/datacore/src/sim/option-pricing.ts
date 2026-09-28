/**
 * WO-C0828-P2 · D2 逐候选反事实定价（PRD-sim-options-decision-surface.md §4.2）
 *
 * 六步装配，全部复用既有件（本文件零新增业务常数、零新增门）：
 *   ① 查绑定   findPricingBinding       —— 调用方注入的 ACTIVE 规格（`repos.derivationSpecs`）
 *   ② 代入     computePressureTarget    —— `translateSpecFormula` + `evalArithmetic`（与 runDerivations 同一套）
 *   ③ 构造扰动 buildCandidatePerturbation —— mode:"set" 永久；落点 = 规格 targetProp（压力格）
 *   ④ 平行世界 priceCandidate           —— `simAdvanceTicks` 的 persist:false + `ephemeralPerturbations`
 *                                          临时扰动路（WO-MATERIAL-REPRICE 演习路已验证）；三次推进：
 *                                          基准（排除会话扰动的裸世界）/ 对照（不处置）/ 候选（+候选扰动），
 *                                          全部零写入 ⇒ E2-g「世界态逐字节不变」结构成立
 *   ⑤ 同尺读数 orderDisplacement        —— diffTickStates(无扰动基准, ·) → 与前端 buildMoneyView.magnitude
 *                                          同一口径（NOISE_FLOOR=0.01 / 档 [0.01,1,10] / 最近秩分位）
 *                                          对照 = diff(基准, 不处置世界) = E0（场景全量冲击的残余）；
 *                                          候选 = diff(基准, 候选世界) = Ec（补救后的残余位移）
 *   ⑥ 披露     disclosure               —— specKey、扰动落点、tick 数、各环节耗时、agentInvolved:false
 *
 * 与 PRD 原机制（branch 重放）的实现差异（语义等价，判据 E2-b′/c/d/g 不受影响）：
 * PRD 选 branch 的理由是「路由现成、零新端点」——那是按**前端编排**写的。本装配在服务端内部直接调
 * `simAdvanceTicks` 的临时扰动路：平行世界、不碰真实世界、对照与「不处置」共用的语义逐条成立，
 * 且免去「已 baked 进世界态的扰动在子会话里重放会二次施加」的相位问题（branch 子会话 tick 空间
 * 与父会话不同，startTick 需要换算，算错就是静默的双重冲击）。临时扰动不入库（`persist:false`
 * 是 deps 接口的结构保证——本接口根本没有 persist 旋钮），世界态零写入由机制保证而非注释保证。
 *
 * ⚠ 口径对照锚（改前先读）：
 *  - NOISE_FLOOR/档边界/最近秩分位 与 `console0828Model.ts` buildMoneyView 的
 *    `NOISE_FLOOR` / `MAG_EDGES` / `quant` 逐字节同值。前端定价接线（WO-C0828-P2 接线轮）
 *    **只渲染本模块返回的分布、不重算** —— 两份实现并存即第二份真相源。
 */
import { createHash } from "node:crypto";

import {
  diffTickStates,
  type Perturbation,
  type SimStateDiffCell,
  type SolutionCandidate,
  type TickState,
} from "@platform/contracts";

import type { DerivationSpecRecord } from "../domain.js";
import { evalArithmetic, translateSpecFormula } from "../ontology.js";
import { round } from "../prng.js";

/* ══ ① 查绑定 ═══════════════════════════════════════════════════════════════ */

/** 公式裸标识符集合（§2 DSL 带 `this.` 前缀，token 化后天然剥掉前缀）。 */
const formulaIdentifiers = (formula: string): ReadonlySet<string> => new Set(formula.match(/[A-Za-z_][\w]*/g) ?? []);

/**
 * 候选杠杆 → 压力规格绑定。
 * 判据：`targetType === objectType` 且公式引用 `this.<prop>`，且式子可译
 * （聚合式 `out(`/`in(` 运行期被 runDerivations 诚实跳过 ⇒ 当不了定价绑定：拨了也不会按式子传导）。
 * 多条命中取规格列表里第一条（列表顺序 = 调用方注入顺序，确定性由注入方保证）。
 */
export function findPricingBinding(
  specs: readonly DerivationSpecRecord[],
  objectType: string,
  leverProp: string,
): DerivationSpecRecord | null {
  for (const s of specs) {
    if (s.targetType !== objectType) continue;
    if (!formulaIdentifiers(s.formula).has(leverProp)) continue;
    if (translateSpecFormula(s.formula) === null) continue;
    return s;
  }
  return null;
}

/* ══ ② 代入 ════════════════════════════════════════════════════════════════ */

/**
 * 以真对象当前 props 为上下文、把杠杆 prop 替换为 toValue，按声明式公式算出压力目标值。
 * 求值语义与 `runDerivations`（ontology.ts 规格层后算段）逐条对齐：
 * 不可译 ⇒ null；坏式子抛 ⇒ null；非有限值 ⇒ 顶层 COALESCE 兜底，无兜底 ⇒ null；结果 round 6。
 */
export function computePressureTarget(
  spec: DerivationSpecRecord,
  objProps: Record<string, unknown>,
  leverProp: string,
  toValue: number,
): number | null {
  const translated = translateSpecFormula(spec.formula);
  if (translated === null) return null;
  const ctx: Record<string, unknown> = { ...objProps, [leverProp]: toValue };
  let value: number;
  try {
    value = evalArithmetic(translated.inner, ctx);
  } catch {
    return null;
  }
  if (!Number.isFinite(value)) {
    if (translated.fallback === undefined) return null;
    value = translated.fallback;
  }
  return round(value, 6);
}

/* ══ ③ 构造扰动 ════════════════════════════════════════════════════════════ */

export function buildCandidatePerturbation(parts: {
  id: string;
  tenantId: string;
  sessionId: string;
  candidate: SolutionCandidate;
  targetStateVar: string;
  magnitude: number;
  /**
   * 引擎寻址用的内部对象 id。候选 `lever.objectId` 是业务键（matId/lineId/processId），
   * 世界态与对象库按内部 `o.id` 寻址 —— 解析由接线方经 `resolveBusinessRefToObjectId` 做，
   * 本函数不自己解析（单源禁令）。缺省回落业务键（无解析时与旧行为逐字节同）。
   */
  targetObjectId?: string;
  /**
   * 生效起始 tick。⚠ 引擎只在 `startTick === producedTick` 的**首次生效**拍落笔
   * （propagation.ts 扰动段 ② entersAt）—— 传 0 而推进从 curTick(>0) 起 ⇒ entersAt
   * 恒 false ⇒ 扰动**从不落地**，候选与对照推进逐字节相同（E2 取证实抓过的坑）。
   * 接线方传 `curTick + 1`（候选推进第一拍生效）。
   */
  startTick: number;
  /** 借会话的建单时刻（R6：本函数不读时钟 —— 同 app.ts 演习路 `createdAt: s.createdAt`）。 */
  createdAt: string;
}): Perturbation {
  const { candidate } = parts;
  return {
    id: parts.id,
    tenantId: parts.tenantId,
    sessionId: parts.sessionId,
    // kind 对临时扰动零语义（不入库、引擎不读；真实语义在 disclosure 的 specKey + lever 落点）。
    // 五个枚举值都是事件语义，候选不是事件；取产能族只是占位，落盘路径绝不使用本对象。
    kind: "capacity_loss",
    targetObjectId: parts.targetObjectId ?? candidate.lever.objectId,
    targetStateVar: parts.targetStateVar,
    startTick: parts.startTick,
    durationTicks: null,
    magnitude: parts.magnitude,
    mode: "set",
    label: `反事实定价 · ${candidate.label}（不入库）`.slice(0, 200),
    createdAt: parts.createdAt,
  };
}

/* ══ ⑤ 同尺读数 ════════════════════════════════════════════════════════════ */

/** 与前端 `console0828Model.ts` buildMoneyView 的 `NOISE_FLOOR` 同值（0–100 压力标度的 0.01%）。 */
export const PRICING_NOISE_FLOOR = 0.01;
/** 分档边界 = [噪声地板, ×100, ×1000]，标签由边界现生成（与前端 `MAG_EDGES` 同值）。 */
export const PRICING_MAG_EDGES = [PRICING_NOISE_FLOOR, PRICING_NOISE_FLOOR * 100, PRICING_NOISE_FLOOR * 1000] as const;

export interface DisplacementBucket {
  readonly label: string;
  readonly n: number;
}

export interface OrderDisplacement {
  /** 读数动了、但幅度 ≤0.01（噪声级）而未计入「被推动」的张数。 */
  readonly faintOnly: number;
  /** 实质受扰（>0.01）订单张数。 */
  readonly touchedOrders: number;
  /** 实质受扰订单 id 集 —— 敞口金额求和的唯一依据（不许拿 faint 单的金额去加）。 */
  readonly touchedOrderIds: readonly string[];
  /** 金丝雀：世界里的订单总数（0 ⇒ 遍历坏了，不许报「没有波及」）。 */
  readonly ordersSeen: number;
  readonly p50: number | null;
  readonly p90: number | null;
  readonly max: number | null;
  readonly buckets: readonly DisplacementBucket[];
}

/**
 * 订单位移分布（PRD §4.2 ⑤b —— 复用 buildMoneyView.magnitude 口径，⛔ 不新造）。
 * 每单取它所有格的最大 |delta|（`diffTickStates` 只回变格，|delta| > 1e-9）。
 * 分位 = 最近秩（`mags[floor(len×f)]`），与前端 `quant` 逐字节同式。
 */
export function orderDisplacement(
  diffs: readonly SimStateDiffCell[],
  orderIds: ReadonlySet<string>,
): OrderDisplacement {
  const maxAbs = new Map<string, number>();
  for (const d of diffs) {
    if (!orderIds.has(d.objectId)) continue;
    if (d.delta === null) continue;
    const m = Math.abs(d.delta);
    const prev = maxAbs.get(d.objectId);
    if (prev === undefined || m > prev) maxAbs.set(d.objectId, m);
  }
  let faintOnly = 0;
  const touchedOrderIds: string[] = [];
  const mags: number[] = [];
  for (const [oid, m] of maxAbs) {
    if (m <= PRICING_NOISE_FLOOR) faintOnly += 1;
    else touchedOrderIds.push(oid);
    mags.push(m);
  }
  mags.sort((a, b) => a - b);
  const quant = (f: number): number | null =>
    mags.length === 0 ? null : (mags[Math.min(mags.length - 1, Math.floor(mags.length * f))] ?? null);
  const inRange = (lo: number, hi: number): number => mags.filter((m) => m > lo && m <= hi).length;
  const [eFaint, eLight, eMid] = PRICING_MAG_EDGES;
  return {
    faintOnly,
    touchedOrders: touchedOrderIds.length,
    touchedOrderIds,
    ordersSeen: orderIds.size,
    p50: quant(0.5),
    p90: quant(0.9),
    max: mags.length === 0 ? null : (mags[mags.length - 1] ?? null),
    buckets: [
      { label: `微弱 ≤${eFaint}`, n: inRange(0, eFaint) },
      { label: `轻 ${eFaint}–${eLight}`, n: inRange(eFaint, eLight) },
      { label: `中 ${eLight}–${eMid}`, n: inRange(eLight, eMid) },
      { label: `重 >${eMid}`, n: inRange(eMid, Number.POSITIVE_INFINITY) },
    ],
  };
}

/* ══ 指纹（PRD §4.2 性能与缓存：输入指纹 = sessionId+curTick+场景扰动集 sha256+candidateId） ══ */

export function scenarioPerturbationsHash(perturbations: readonly Perturbation[]): string {
  const canon = perturbations
    .map((p) => [p.id, p.kind, p.targetObjectId, p.targetStateVar, p.startTick, p.durationTicks, p.magnitude, p.mode])
    .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

export function pricingFingerprint(parts: {
  sessionId: string;
  curTick: number;
  scenarioHash: string;
  candidateId: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([parts.sessionId, parts.curTick, parts.scenarioHash, parts.candidateId]))
    .digest("hex");
}

/* ══ 装配 ══════════════════════════════════════════════════════════════════ */

export interface PricingDeps {
  listPerturbations(sessionId: string): Promise<readonly Perturbation[]>;
  /** 当前世界态（tick 态）—— ③ 落点格存在性检查用。 */
  readWorldState(sessionId: string): Promise<TickState>;
  /** 杠杆落点对象的当前 props —— ② 代入上下文用。 */
  readObjectProps(objectId: string): Promise<Record<string, unknown>>;
  listOrderIds(): Promise<readonly string[]>;
  listOrderValues(): Promise<ReadonlyMap<string, number>>;
  /** 历史定格态（基准重放的起点）：tick===0 ⇒ 接线方回 baseSnapshot（同 tick 路影子线语义）。 */
  readTickState(sessionId: string, tick: number): Promise<TickState>;
  /**
   * 一次推进 N 拍。⚠ **接口没有 persist 旋钮** —— 定价的基准/对照/候选世界一律走
   * `simAdvanceTicks` 的 persist:false 支路（接线方的责任，本接口结构上排除 persist:true
   * 的定价推进）⇒ E2-g「世界态逐字节不变」由接口形状保证。
   * `excludeSessionPerturbations` = 排除会话既有扰动（场景假设）的推进；
   * `fromState`/`fromTick` = 从历史定格态起推（基准重放用，与 exclude 配套）。
   */
  advanceTicks(
    sessionId: string,
    opts: {
      n: number;
      ephemeral?: readonly Perturbation[];
      excludeSessionPerturbations?: boolean;
      fromState?: TickState;
      fromTick?: number;
    },
  ): Promise<TickState>;
  /** 单调时钟（接线方传 performance.now；测试传假钟）。 */
  now(): number;
  makeId(prefix: string): string;
}

export interface PricingReading {
  readonly touchedOrders: number;
  readonly faintOnly: number;
  readonly exposureYuan: number;
  readonly displacement: Omit<OrderDisplacement, "touchedOrderIds">;
}

export interface PricingDisclosure {
  readonly specKey: string | null;
  readonly targetObjectId: string | null;
  readonly targetStateVar: string | null;
  readonly tickCount: number;
  readonly elapsedMs: {
    readonly total: number;
    readonly binding: number;
    readonly perturb: number;
    readonly tick: number;
    readonly diff: number;
  };
  /** 推演路零 LLM —— 必须明写，不许留白让人以为调了（铁律 1.5 判据二）。 */
  readonly agentInvolved: false;
}

export type GapReason = "NO_BINDING" | "PRESSURE_TARGET_UNCOMPUTABLE" | "TARGET_CELL_ABSENT";

export type PricingOutcome =
  | {
      readonly kind: "gap";
      readonly candidateId: string;
      readonly reason: GapReason;
      /** NO_BINDING 时列出缺的绑定（PRD ①：列出缺的绑定 prop 名；⛔ 不得返 0、不得降格）。 */
      readonly missingBinding: { readonly objectType: string; readonly prop: string } | null;
      readonly disclosure: PricingDisclosure;
    }
  | {
      readonly kind: "priced";
      readonly candidateId: string;
      readonly specKey: string;
      readonly fingerprint: string;
      readonly perturbation: {
        readonly targetObjectId: string;
        readonly targetStateVar: string;
        readonly mode: "set";
        readonly magnitude: number;
      };
      readonly horizon: number;
      /** 对照（不处置）读数 = diff(无扰动基准, 不处置世界) = E0；无场景扰动时诚实零（与候选读数同形）。 */
      readonly control: PricingReading;
      readonly after: PricingReading;
      readonly disclosure: PricingDisclosure;
    };

export async function priceCandidate(
  deps: PricingDeps,
  input: {
    tenantId: string;
    sessionId: string;
    /** 定价锚点 tick —— 指纹入参（PRD 性能段）。 */
    curTick: number;
    /** 与 runM 同 n 的推演拍数。 */
    horizon: number;
    candidate: SolutionCandidate;
    /**
     * 杠杆落点的**内部对象 id**（接线方经 `resolveBusinessRefToObjectId` 解析；候选
     * `lever.objectId` 是业务键，世界态/对象库按内部 `o.id` 寻址）。②③④ 用它寻址；
     * 披露与对外记录仍说业务键（人读的是业务身份，内部 id 是存储细节）。
     */
    resolvedObjectId?: string;
    /** 本租户 ACTIVE 规格（接线方从 `repos.derivationSpecs` 注入；本函数不改规格）。 */
    specs: readonly DerivationSpecRecord[];
    /** 会话建单时刻 —— 候选扰动借用（R6 不读时钟）。 */
    sessionCreatedAt: string;
  },
): Promise<PricingOutcome> {
  const { candidate } = input;
  const started = deps.now();
  const timings = { binding: 0, perturb: 0, tick: 0, diff: 0 };
  let binding: DerivationSpecRecord | null = null;
  const baseDisclosure = (): PricingDisclosure => ({
    specKey: binding?.specKey ?? null,
    targetObjectId: candidate.lever.objectId,
    targetStateVar: binding?.targetProp ?? null,
    tickCount: input.horizon,
    elapsedMs: { total: deps.now() - started, ...timings },
    agentInvolved: false,
  });
  const gap = (reason: GapReason): PricingOutcome => ({
    kind: "gap",
    candidateId: candidate.candidateId,
    reason,
    missingBinding:
      reason === "NO_BINDING" ? { objectType: candidate.lever.objectType, prop: candidate.lever.prop } : null,
    disclosure: baseDisclosure(),
  });

  /* ① 查绑定 */
  let t = deps.now();
  binding = findPricingBinding(input.specs, candidate.lever.objectType, candidate.lever.prop);
  timings.binding = deps.now() - t;
  if (binding === null) return gap("NO_BINDING");

  /* ② 代入 → 压力目标值 */
  const landingId = input.resolvedObjectId ?? candidate.lever.objectId;
  const objProps = await deps.readObjectProps(landingId);
  const pressureTarget = computePressureTarget(binding, objProps, candidate.lever.prop, candidate.toValue);
  if (pressureTarget === null) return gap("PRESSURE_TARGET_UNCOMPUTABLE");

  /* ③ 落点格必须已存在于世界态（PRD §3.2 段二；不存在 ⇒ 诚实缺格，不许造格） */
  const worldState = await deps.readWorldState(input.sessionId);
  const landingCell = worldState[landingId]?.[binding.targetProp];
  if (typeof landingCell !== "number") return gap("TARGET_CELL_ABSENT");

  /* ④ 平行世界推进，都走 persist:false 临时扰动路：
   * 基准（场景扰动**从未存在**的世界）= 差分锚点；对照（不处置）= 场景全量冲击；候选 = 场景 + 候选扰动。 */
  t = deps.now();
  const scenarioPerts = await deps.listPerturbations(input.sessionId);
  const scenarioHash = scenarioPerturbationsHash(scenarioPerts);
  const candidatePert = buildCandidatePerturbation({
    id: deps.makeId("simpert"),
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    candidate,
    targetStateVar: binding.targetProp,
    magnitude: pressureTarget,
    targetObjectId: landingId,
    // 候选推进第一拍（curTick+1）生效 —— 传 0 会让 entersAt 恒 false、扰动从不落地
    // （propagation.ts 只在 startTick===producedTick 的首次生效拍落笔）。
    startTick: input.curTick + 1,
    createdAt: input.sessionCreatedAt,
  });
  timings.perturb = deps.now() - t;

  t = deps.now();
  // 基准世界与 tick 路信号分离的「影子线」同一纪律（app.ts wantDrift 段的实测教训）：
  // **拿已烘入扰动的当前态排除推进，两条线会逐字节相同** —— 场景扰动在 `POST /perturbations`
  // 建单时已当场施加进当前态。§0.2 的表量的是「对无场景世界的残余位移」，故基准必须从
  // **最早扰动 startTick−1 的历史定格态**零扰动重放到对照口径（R6 确定性 ⇒ 与从锚点带场景
  // 重放、再推 horizon 拍的对照世界逐字节同构）。无场景扰动 / 锚不早于当前 ⇒ 基准 ≡ 对照
  // ⇒ E0 诚实零（不是「没算」）。
  const minStart = scenarioPerts.reduce((m, p) => Math.min(m, p.startTick), Number.POSITIVE_INFINITY);
  const anchor = scenarioPerts.length === 0 ? null : Math.max(0, minStart - 1);
  const needsReplay = anchor !== null && anchor < input.curTick;
  const baselineState = needsReplay
    ? await deps.advanceTicks(input.sessionId, {
        n: input.curTick - anchor + input.horizon,
        excludeSessionPerturbations: true,
        fromState: await deps.readTickState(input.sessionId, anchor),
        fromTick: anchor,
      })
    : await deps.advanceTicks(input.sessionId, { n: input.horizon, excludeSessionPerturbations: true });
  const controlState = await deps.advanceTicks(input.sessionId, { n: input.horizon });
  const candidateState = await deps.advanceTicks(input.sessionId, { n: input.horizon, ephemeral: [candidatePert] });
  timings.tick = deps.now() - t;

  /* ⑤ 同尺读数：对**无扰动基准**取差 —— §0.2 阶跃尺语义（E0/Ec 都是「残余位移」，不是边际 Δ）。
   * diff(基准, 对照) = E0（场景冲击的残余）；diff(基准, 候选) = Ec（补救后的残余）。
   * 无场景扰动时基准 ≡ 对照 ⇒ E0 诚实零（不是「没算」）；⛔ diff(对照,候选) 量的是边际 |Δ|，
   * 复现不出 §0.2 的 0.012/0.009 表（那是残余压力对 0.01 地板的比较）。 */
  t = deps.now();
  const controlDiffs = diffTickStates(baselineState, controlState);
  const candidateDiffs = diffTickStates(baselineState, candidateState);
  const orderIds = new Set(await deps.listOrderIds());
  const orderValues = await deps.listOrderValues();
  const readingOf = (cells: readonly SimStateDiffCell[]): PricingReading => {
    const d = orderDisplacement(cells, orderIds);
    let exposureYuan = 0;
    for (const oid of d.touchedOrderIds) {
      const v = orderValues.get(oid);
      if (typeof v === "number" && Number.isFinite(v)) exposureYuan += v;
    }
    const { touchedOrderIds: _dropped, ...displacement } = d;
    return { touchedOrders: d.touchedOrders, faintOnly: d.faintOnly, exposureYuan, displacement };
  };
  const after = readingOf(candidateDiffs);
  const control = readingOf(controlDiffs); // diff(基准, 不处置世界) = E0；基准 ≡ 对照时诚实零
  timings.diff = deps.now() - t;

  return {
    kind: "priced",
    candidateId: candidate.candidateId,
    specKey: binding.specKey,
    fingerprint: pricingFingerprint({
      sessionId: input.sessionId,
      curTick: input.curTick,
      scenarioHash,
      candidateId: candidate.candidateId,
    }),
    perturbation: {
      // 对外记录说业务键（人读的是业务身份）；引擎实际寻址的落点见 candidatePert（内部 id）。
      targetObjectId: candidate.lever.objectId,
      targetStateVar: binding.targetProp,
      mode: "set",
      magnitude: pressureTarget,
    },
    horizon: input.horizon,
    control,
    after,
    disclosure: baseDisclosure(),
  };
}
