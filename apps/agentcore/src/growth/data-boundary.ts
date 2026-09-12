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
  /**
   * DF.9-TS 时序维度接地：问句是否要一条"时间维度序列"（逐日/时序/未来N天/趋势）——
   * 如"设备 OEE 逐日""物流时长未来30天时序"。决定补法的**形状**：
   *  - HARD（真实体）：DataRequest 声明须补**真实逐日时序**（时间戳+度量列），走真人正门（连接器/上传），**绝不伪造真实体时序**；
   *  - SOFT（无具体实体）：经管线确定性合成 **PROVISIONAL 时序**（标"未接实测"），供探索，业务真值由后续接实测覆盖。
   */
  timeseries: boolean;
  /** HARD 时给出的精确补数请求（走真人正门）。 */
  dataRequest?: DataRequest;
}

/**
 * 时序维度探测（纯函数·确定性 R6·零业务常数 R14——仅语言标记，不写死天数/度量阈值）。
 * 命中"逐日/时序/未来/趋势/序列/每日…"等**时间维度**措辞即判为时序诉求（如 OEE/物流时长的逐日推演）。
 */
const TS_MARKERS = [
  "时序", "逐日", "逐月", "逐周", "逐时", "逐年", "每日", "每月", "时间维度", "时间序列",
  "趋势", "未来", "序列", "timeseries", "time series", "time-series", "trend", "daily",
];
export function detectTimeseries(text: string): boolean {
  const lc = text.toLowerCase();
  return TS_MARKERS.some((m) => lc.includes(m.toLowerCase()));
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
  const timeseries = detectTimeseries(hay);
  const entities = [...new Set(vocab.filter((v) => v && hay.includes(v)))];
  if (entities.length === 0) return { mode: "SOFT", entities: [], timeseries };
  const typeKey = opts.typeKey || "Object";
  // 显式列优先；缺省给真人可读占位。时序诉求 → 缺省列声明须补的时间维度（时间戳+度量），不臆造具体度量名。
  const defaultColumns = timeseries
    ? ["ts（时间戳/日期·逐日）", "value（该实体逐日度量值·随时间变化）", "（其余按该对象类型已发布字段——连接器导入页/数据模版可见）"]
    : ["（按该对象类型已发布字段——连接器导入页/数据模版可见）"];
  const columns = opts.columns && opts.columns.length > 0 ? opts.columns : defaultColumns;
  const tsReason = timeseries
    ? `（时序维度：须补真实**逐日时序**——时间戳+度量列，绝不伪造真实体时序）`
    : "";
  return {
    mode: "HARD",
    entities,
    timeseries,
    dataRequest: {
      typeKey,
      columns,
      entities,
      reason: `问句涉及真实业务实体「${entities.join("、")}」——自动合成将造业务事实；须经真人正门（连接器导入 / Excel 上传 → Action 审批）补真实数据，不静默合成${tsReason}`,
    },
  };
}
