import { hashString, mulberry32 } from "../prng.js";

/**
 * 回放编排器 §2 文本池（提问问句 / 审批意见 / S&OP 决议）。
 *
 * 规格红线：文本池由 A9 `llm_text` 在**合成时一次性预生成并缓存**——回放执行期零
 * LLM 调用（确定性、离线、零成本）。本模块即「预生成缓存」的事实源：给定 (poolKey)
 * 返回固定候选列表；具体抽取由 (seed, tick, persona) 派生子流确定（drawFromPool）。
 *
 * 这些候选文本本身是行业语料的成品（电池制造），等价于 llm_text 的离线产出——
 * 因此回放不依赖网络/时钟/随机性，同 seed 逐字一致（R6）。
 */

export type PoolKey =
  | "planner_daily"
  | "base_manager_daily"
  | "catalog_daily"
  | "approver_comment"
  | "sop_resolution";

const POOLS: Record<PoolKey, readonly string[]> = {
  // 计划员每日提问（路径 A 工作流意图措辞，view=dash/risk/audit 通用）
  planner_daily: [
    "今天哪些订单受产能风险影响？",
    "本周排产达成率怎么样？",
    "未来两周哪些基地利用率会越线？",
    "当前在手订单的齐套覆盖天数够吗？",
    "这个月的计划缺口在哪几个细分？",
    "最近一次产能预测和实绩偏差多少？",
    "有哪些工单卡在审批没推进？",
    "瓶颈工序集中在哪些设备上？",
  ],
  // 基地负责人每日提问（行级 —— 只应问出本基地数据，R7）
  base_manager_daily: [
    "本基地这周产出趋势如何？",
    "本基地有没有越线告警需要处置？",
    "本基地的检修窗口对产出影响多大？",
    "本基地受影响的订单有哪些？",
    "本基地良率最近是否回落？",
  ],
  // 目录运营每日提问（探查本体/图谱/规则）
  catalog_daily: [
    "最近哪些规则触发最频繁？",
    "本体里哪些对象类型缺少派生属性？",
    "型号到基地的认证覆盖完整吗？",
    "图谱里有哪些断链需要补？",
  ],
  // 审批意见（被拒必带；按金额/类型语境通用）
  approver_comment: [
    "外协贴近 C08 红线，改用夜班方案后重报",
    "现金垫低于 C18 底线，本月不批增产投入",
    "该基地检修窗口未结束，方案时点不可行，驳回",
    "与当月 S&OP 决议冲突，请走计划版本变更重新提报",
    "风险评估缺少受影响订单清单，补充后再报",
    "外协供应商资质未过审，改用跨基地借调",
    "需求依据为单一客户口头预测，证据不足",
    "成本超出预算上限，请压缩空运比例后重报",
  ],
  // S&OP 第⑤步决议（对策池，按当月缺口选；name + delta 两段，这里只存 name 文本）
  sop_resolution: [
    "枣庄一线提前爬坡补缺口",
    "正极提前备料专项（到货风险对冲）",
    "检修季错峰排产平滑产出",
    "跨基地产能借调消化高峰需求",
    "夜班 + 渠道扩容组合保交付",
    "外协受控释放（不破 C08 红线）",
  ],
};

/** 公开的池快照（前端/审计可展示「这批文本从哪来」；回放只读此处）。 */
export function poolSnapshot(): Record<PoolKey, readonly string[]> {
  return POOLS;
}

/** 从池中确定性抽取一条：子流由 (seed, tick, persona, poolKey, salt) 派生。 */
export function drawFromPool(
  poolKey: PoolKey,
  derive: { seed: number; tick: number; persona: string; salt?: number },
): string {
  const pool = POOLS[poolKey];
  const key = `${derive.seed}|${derive.tick}|${derive.persona}|${poolKey}|${derive.salt ?? 0}`;
  const rng = mulberry32(hashString(key));
  return pool[Math.floor(rng() * pool.length)] as string;
}

/** 确定性掷签（ask.prob / review policy 同一派生方式）。返回 [0,1) 的确定性值。 */
export function deterministicDraw(derive: {
  seed: number;
  tick: number;
  persona: string;
  salt?: number;
}): number {
  const key = `${derive.seed}|${derive.tick}|${derive.persona}|draw|${derive.salt ?? 0}`;
  return mulberry32(hashString(key))();
}
