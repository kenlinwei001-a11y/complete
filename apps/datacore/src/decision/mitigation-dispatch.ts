/**
 * WO-ADOPT-MITIGATION-DISPATCH · `adopt_mitigation` 派单的**单一出处**（kernel commit ＋ opsteam replay 共用）。
 *
 * ── 病灶（本单要清的欠账）────────────────────────────────────────────────
 * `adopt_mitigation` 的载荷 `{base, factor, planKey}` 有且只有一个真消费者：
 * `risk_timeline(args.mitigation)` → `params.risk.mitigations[factor].find(p => p.key===planKey || p.name===planKey)`
 * → 取该方案的真 `{eff, tn}` 让张力曲线从第 tn 天起降 eff。解不出就 `throw`（`risk.ts:439`
 * `unknown mitigation plan '<planKey>' for factor <factor>`；base 解不出则 `risk.ts:341` `unknown base`）。
 * 执行器同样**刻意不猜 eff/tn**——解不出即诚实失败。
 *
 * 于是上游两处派单的欠账浮出水面（本单前实测，非臆断）：
 *  ① `decision/kernel.ts` commit 派的是 `{base: rootRef.topBase ?? "全域", factor: option.factorId, planKey: option.optionId}`。
 *     实测（seed=42·demo）载荷 = `{"base":"handan","factor":"cf-decision-gap","planKey":"opt-backup-cert"}`：
 *     `factor` 是 gap_attribution 的**因果因子 id**（cf-*），不是 `params.risk.mitigations` 的 7 个产能风险因子键
 *     （物料齐套/设备OEE/人力工时/瓶颈工序/物流时长/换型损失/良率波动）；`planKey` 是 decision_play 的**战略方案 id**
 *     （opt-backup-cert/opt-lta-clause/opt-insource·全表写死 3 条），也不是任何处置方案 key。
 *     并且 `topBase` 本身在 metric-domain / market_share 域是 `"metricgap:cash"` / `"share:share-ess"`
 *     （levels[depth=1] 根本不是基地层）——比 WO 描述的 `"全域"` 更坏：它**长得像**一个值。
 *  ② `opsteam/replay.ts` 的 adopt_mitigation 载荷**根本没有 factor/planKey**，在 submit 阶段就被
 *     ActionType.paramsSchema（required: base/factor/planKey）挡下。
 *
 * ── 纪律（本模块的存在理由）──────────────────────────────────────────────
 * **绝不放宽解析、绝不代执行器编 eff/tn**（那正是本仓刚清掉的「假 MO 号」病的同款）。
 * 派单方的责任只有一条：**要么派出真能解析、真能落效果的单，要么诚实地不派**。
 *
 * 判据不是"我觉得像"，而是**拿真消费者干跑一遍**（`dryRunMitigation`）：同一条载荷喂给
 * `risk_timeline`，能算出 `card.mitigated`（真降的曲线）才算可执行。base/factor/planKey 三者
 * 任一不成立，`risk_timeline` 自己就会抛——用它当门，口径与执行期逐字一致，不另起一套校验。
 */

/** `adopt_mitigation` 的可执行三元组（= ActionType.paramsSchema required 字段）。 */
export interface MitigationPayload {
  base: string;
  factor: string;
  planKey: string;
}

/** 经 A6 正门调求解器（kernel 传 ontology.invokeSolver，replay 传 solvers.invoke·同签名收敛）。 */
export type InvokeSolverFn = (solverKey: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** 干跑结果：可执行则带真效果证据（应用方案名 / 生效日 / 处置后峰值），否则带诚实原因。 */
export type DryRunResult =
  | { ok: true; appliedPlan: string; effectiveFrom: number; peakBefore: number; peakAfter: number }
  | { ok: false; reason: string };

/**
 * **真消费者干跑**：把待派载荷原样喂 `risk_timeline`（forced pair·base+factor 给全 → 恒 1 张卡）。
 * 能拿到 `card.mitigated` = 这条 `{base,factor,planKey}` 真能解析出方案的 `{eff,tn}` 且曲线真的降。
 * 抛错（unknown base / unknown mitigation plan）= 这单派出去必然失败 → 不许派。
 */
export async function dryRunMitigation(invokeSolver: InvokeSolverFn, p: MitigationPayload): Promise<DryRunResult> {
  let out: Record<string, unknown>;
  try {
    out = await invokeSolver("risk_timeline", { base: p.base, factor: p.factor, mitigation: { ...p } });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  const cards = (out.cards as Record<string, unknown>[] | undefined) ?? [];
  const card = cards[0];
  if (!card) return { ok: false, reason: `risk_timeline 对 ${p.base}/${p.factor} 无卡片（无可推演的张力曲线）` };
  const mitigated = card.mitigated as { series?: number[]; appliedPlan?: string; effectiveFrom?: number; peak?: number } | undefined;
  if (!mitigated || !Array.isArray(mitigated.series)) {
    return { ok: false, reason: `risk_timeline 未产出处置曲线（方案「${p.planKey}」未作用于 ${p.base}/${p.factor}）` };
  }
  const peakBefore = Number(card.peak ?? 0);
  const peakAfter = Number(mitigated.peak ?? 0);
  // 效果层最后一道：处置后峰值必须真的不高于处置前（不接受"算出来了但没降"的空转）。
  if (!(peakAfter <= peakBefore)) {
    return { ok: false, reason: `处置曲线未下降（peak ${peakBefore} → ${peakAfter}）` };
  }
  return {
    ok: true,
    appliedPlan: String(mitigated.appliedPlan ?? p.planKey),
    effectiveFrom: Number(mitigated.effectiveFrom ?? 0),
    peakBefore,
    peakAfter,
  };
}

/** 为某基地选方案的结果：选到真方案 / 诚实说明为什么选不到（→ 上游据此**不派**）。 */
export type SelectResult = { ok: true; payload: MitigationPayload; dry: Extract<DryRunResult, { ok: true }> } | { ok: false; reason: string };

/**
 * 为某基地选一条**真处置方案**（路径 A·全程正门·R6 确定性·无时钟随机）：
 *
 *  ① `risk_timeline({})` → 风险看板卡 → 取**该基地自己那张卡**的首要风险因子 `card.factor`
 *     ＋ 实测当前张力 `card.currentTightness.value`。看板上没有这个基地 → **不派**（该基地当下
 *     没有越线风险，"采纳处置方案"无对象；编一个因子出来才是错数）。
 *  ② `mitigation_select({baseName, factor, tightness})` → 平台**自有的**方案打分规则
 *     （`extended.ts mitigationSelect`：`score = eff × urgency ÷ (costRank × tn)`，
 *      `urgency = max(0,(tightness−70)/30)`；即「张力越高越急 → 单位成本、单位见效天数的削减量最大者优先」）
 *     → `draftPayload = {base, factor, planKey: recommended}`。
 *     **业务规则写在这里而不是自己重写一遍**：方案库与打分是 `params.risk.mitigations` ＋ mitigation_select
 *     的单一出处（R14），本模块只做编排，不复制一套「按 eff 最大」的第二口径。
 *  ③ `dryRunMitigation` 拿真消费者复核 → 才允许派。
 *
 * 基地入参用 `resolveBaseId` 能认的形态（`Base.baseId` 如 `changzhou` 或中文名 `常州` 皆可）。
 */
export async function selectMitigationForBase(invokeSolver: InvokeSolverFn, baseRef: string): Promise<SelectResult> {
  if (!baseRef) return { ok: false, reason: "无基地（persona/决策未给出可解析的基地）" };
  let board: Record<string, unknown>;
  try {
    board = await invokeSolver("risk_timeline", {});
  } catch (err) {
    return { ok: false, reason: `risk_timeline 不可用：${err instanceof Error ? err.message : String(err)}` };
  }
  const cards = (board.cards as Record<string, unknown>[] | undefined) ?? [];
  const card = cards.find((c) => String(c.baseId) === baseRef || String(c.base) === baseRef);
  if (!card) return { ok: false, reason: `基地「${baseRef}」当前不在风险看板上（无越线因子）→ 无可采纳的具体处置方案` };
  const factor = String(card.factor ?? "");
  const tightness = Number((card.currentTightness as { value?: unknown } | undefined)?.value ?? 0);

  let sel: Record<string, unknown>;
  try {
    sel = await invokeSolver("mitigation_select", { baseName: String(card.base ?? baseRef), factor, tightness });
  } catch (err) {
    return { ok: false, reason: `mitigation_select 失败：${err instanceof Error ? err.message : String(err)}` };
  }
  if (sel.error) return { ok: false, reason: `因子「${factor}」无方案库：${String(sel.error)}` };
  const draft = sel.draftPayload as Partial<MitigationPayload> | undefined;
  if (!draft?.base || !draft.factor || !draft.planKey) return { ok: false, reason: `mitigation_select 未给出 draftPayload（因子「${factor}」）` };
  const payload: MitigationPayload = { base: String(draft.base), factor: String(draft.factor), planKey: String(draft.planKey) };

  const dry = await dryRunMitigation(invokeSolver, payload);
  if (!dry.ok) return { ok: false, reason: `方案「${payload.planKey}」干跑不过：${dry.reason}` };
  return { ok: true, payload, dry };
}
