import { BASE_REGISTRY, SEG_REGISTRY, type DataRequest } from "@platform/contracts";

/**
 * DF.9 真人正门 HARD/SOFT 分流（PRD 生成接地层 §3.5，接地核心）：
 * 自成长 LOOP 遇 EMPTY_DATA 缺口时，决定"能不能自动合成补"——
 *  - **HARD**：缺的数据涉及**真实业务实体**（问句/上下文命中已发布业务词表：基地/应用细分名）。
 *    自动合成 = 造业务事实（凭空发明真实实体的产能/订单/良率）→ 拒绝静默合成，
 *    出**精确 DataRequest**（该补哪个对象类型/哪些列）走真人正门（连接器导入/Excel 上传→Action 审批 R4），
 *    LOOP 收敛到 BOUNDARY（已做完它能做的，剩下要真人给真实数据）。
 *  - **SOFT**：通用/无具体实体的缺数据 → 经管线确定性合成 PROVISIONAL（CL.2「触发合成≠伪造」：
 *    回执只含元信息、业务数字由后续 query 读回真实物化值）。
 * 与 DF.8 同源接地（词表来自 BASE_REGISTRY/SEG_REGISTRY 单一来源 R14），确定性（R6，同问句同上下文同判）。
 */

/** 已发布业务词表（基地名 + 应用细分名），与 DF.8 生成接地同一来源。 */
export function groundingVocab(): string[] {
  return [...BASE_REGISTRY.map((b) => b.name), ...SEG_REGISTRY.map((s) => s.seg)];
}

export interface DataGapDecision {
  mode: "HARD" | "SOFT";
  /** 命中的真实业务实体（HARD 依据；空=SOFT）。 */
  entities: string[];
  /** HARD 时给出的精确补数请求（走真人正门）。 */
  dataRequest?: DataRequest;
}

/**
 * 判定缺数据是 HARD（真人正门）还是 SOFT（可合成）。纯函数、确定性。
 * @param question 客户问句
 * @param contextText 上下文实体文本（选中对象 id + 过滤值拼接）
 * @param vocab 已发布业务词表
 * @param opts.typeKey 目标对象类型（精确 DataRequest 用）；columns 已知精确列（可空）
 */
export function decideDataGap(
  question: string,
  contextText: string,
  vocab: string[],
  opts: { typeKey?: string; columns?: string[] } = {},
): DataGapDecision {
  const hay = `${question} ${contextText}`;
  const entities = [...new Set(vocab.filter((v) => v && hay.includes(v)))];
  if (entities.length === 0) return { mode: "SOFT", entities: [] };
  const typeKey = opts.typeKey || "Object";
  const columns = opts.columns && opts.columns.length > 0 ? opts.columns : ["（按该对象类型已发布字段——连接器导入页/数据模版可见）"];
  return {
    mode: "HARD",
    entities,
    dataRequest: {
      typeKey,
      columns,
      entities,
      reason: `问句涉及真实业务实体「${entities.join("、")}」——自动合成将造业务事实；须经真人正门（连接器导入 / Excel 上传 → Action 审批）补真实数据，不静默合成`,
    },
  };
}
