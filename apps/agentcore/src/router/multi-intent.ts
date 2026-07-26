import { solversCoupled } from "./multi-route.js";

/**
 * WO-QOS-CROSS-DOMAIN-UNIFIED 步4 · ⑤ LLM 多意图兜底的**判定半**（salvage 自 multi-intent-p1 的 `selectMultiIntent`·
 * 其重复后半 assembleMultiIntentAnswer/runMultiIntentPath 已弃——执行统一走 `multi-route.ts runDeterministicMultiPath`
 * 同一份共享后半，铁律「只建一份后半·不同机制不对接」）。
 *
 * 定位（本体 §3 编排链）：classify 之后、clarification 之前——分类器给出 ≥2 高置信候选（确定性 ② 没接住的复合问句）→
 * 本判定筛出「可并行独立子意图集」→ orchestrator 把入选意图映射成 DomainRoute[] 交共享后半并行 + 确定性装配。
 * **多意图命中即并行·不反问**（排在 INTENT_CHOICE 澄清前——否则中置信多候选会被澄清逼成单选）。
 *
 * R6 纯函数：无 LLM/时钟/随机——LLM 只产生 candidates（分类器既有产物），本判定确定性筛选。
 */

export interface MultiIntentCandidateInput {
  intentKey: string;
  confidence: number;
  solverKey: string;
  /** 该意图的必填槽名（intent.slots.required）。 */
  requiredSlots: string[];
  /** fillSlots 真探针后已填上的槽名（值非空）。 */
  filledSlots: string[];
  /** 分节标题（intent.name·装配用）。 */
  sectionTitle: string;
}

export interface SelectedIntent {
  intentKey: string;
  confidence: number;
  solverKey: string;
  sectionTitle: string;
}

export interface MultiIntentSelection {
  selected: SelectedIntent[];
  /** 已知耦合对（solverKey 对·非空 → 装配层诚实标"独立测算·未链式传导·见 L3"）。 */
  coupledPairs: [string, string][];
}

export interface SelectMultiIntentOpts {
  /** 入选子意图最低置信（env QOS_MULTI_INTENT_TAU_MID·默认 0.80）。 */
  tauMid: number;
  /** 并行子意图上界（env QOS_MULTI_INTENT_MAX_INTENTS·默认 4）。 */
  maxIntents: number;
}

/**
 * ⑤ 多意图判定（R6 纯函数）：① confidence ≥ tauMid ② 必填槽全可填（fillSlots 真探针结果）③ 同 solver 去重
 * （置信序首个胜·无 scope 冲突）④ 截到 maxIntents ⑤ 幸存 <2 → null（**逐字节沿用**现单意图路径·不劫持）。
 * 独立性检查在命中集之后跑：耦合意图**仍并行**（耦合只驱动装配层诚实标·真联合在 L3）。
 */
export function selectMultiIntent(
  candidates: MultiIntentCandidateInput[],
  opts: SelectMultiIntentOpts,
): MultiIntentSelection | null {
  const highConf = candidates.filter((c) => c.confidence >= opts.tauMid);
  const fillable = highConf.filter((c) => c.requiredSlots.every((s) => c.filledSlots.includes(s)));
  const seenSolvers = new Set<string>();
  const distinct = fillable.filter((c) => {
    if (seenSolvers.has(c.solverKey)) return false;
    seenSolvers.add(c.solverKey);
    return true;
  });
  const capped = distinct.slice(0, Math.max(0, opts.maxIntents));
  if (capped.length < 2) return null;

  const coupledPairs: [string, string][] = [];
  for (let i = 0; i < capped.length; i++) {
    for (let j = i + 1; j < capped.length; j++) {
      const a = capped[i]!.solverKey;
      const b = capped[j]!.solverKey;
      if (solversCoupled(a, b)) coupledPairs.push([a, b]);
    }
  }

  return {
    selected: capped.map((c) => ({
      intentKey: c.intentKey,
      confidence: c.confidence,
      solverKey: c.solverKey,
      sectionTitle: c.sectionTitle,
    })),
    coupledPairs,
  };
}
