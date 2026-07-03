import {
  BASE_REGISTRY,
  SEG_REGISTRY,
  type DataRequest,
  type SlotDef,
  type TriggerBoundaryDecision,
  type GenerationPlanPreview,
} from "@platform/contracts";

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

/* ============================================================================
 * FILL-BOUNDARY-GUARDRAIL · 触发补数据三闸（B1 槽位完备 / B2 模式封闭 / B3 越界）
 *
 * 用户钉：**触发补数据必须有边界**，否则任意泛问题（无月份/型号/仓类/物料）自由补数据 = 数据混乱。
 * 与既有 `decideDataGap`（词表 HARD/SOFT 一道闸）叠加为三道内容闸，确定性纯函数（R6）。
 * 值域/枚举全取注册表既有值（R14·零硬编码实体）。
 * ==========================================================================*/

/**
 * R14 触发补数据的**有界维度**（必需槽位候选）——枚举值全取自注册表既有值（BASE/SEG_REGISTRY），
 * 换行业=换 IndustryPack 注册表·0 码改。`identifying`=定位性维度（pin 其一即视为已接地）。
 */
export interface TriggerDimension {
  slot: string;
  type: SlotDef["type"];
  enumValues?: string[];
  identifying: boolean;
  clarifyPrompt: string;
  description: string;
}

/** 从注册表派生触发补数据的必需槽位维度（对象域/实体/型号/时间窗）。 */
export function triggerDimensions(): TriggerDimension[] {
  const bases = BASE_REGISTRY.map((b) => b.name);
  const segs = SEG_REGISTRY.map((s) => s.seg);
  const models = [...new Set(BASE_REGISTRY.map((b) => b.mainProduct))];
  return [
    { slot: "base", type: "enum", enumValues: bases, identifying: true, clarifyPrompt: "请指定基地（对象域）", description: "补数据的目标基地——取自基地注册表" },
    { slot: "segment", type: "enum", enumValues: segs, identifying: true, clarifyPrompt: "请指定应用细分", description: "补数据的应用细分——取自细分注册表" },
    { slot: "model", type: "enum", enumValues: models, identifying: true, clarifyPrompt: "请指定型号", description: "补数据的型号——取自型号注册表" },
    { slot: "timeWindow", type: "timeWindow", identifying: false, clarifyPrompt: "请指定时间窗（月份/区间）", description: "补数据的时间范围" },
  ];
}

export interface TriggerBoundaryInput {
  question: string;
  /** 上下文实体文本（选中对象 id + 过滤值拼接）。 */
  contextText: string;
  /** 已解析的槽位（澄清回填累计；键=维度 slot）。 */
  providedSlots: Record<string, unknown>;
  /** R14 必需槽位维度（注册表派生·由调用方传入）。 */
  dimensions: TriggerDimension[];
  /** B2 模式封闭：已发布 ObjectType 键集（跨服务真后端 listObjectTypes）。 */
  publishedTypes: string[];
  /** 目标对象类型（来自 selectedObjects[0].objectType 或视图）。 */
  targetTypeKey: string;
  /** 目标类型是否为**显式声明的对象类型**（来自 selectedObjects）——仅此时做 B2 类型封闭校验（视图名不是类型）。 */
  targetIsExplicitType: boolean;
  /** 当前澄清轮次（第 n/2 次确认）。 */
  round?: number;
}

const CLARIFY_MAX_ROUNDS = 2;

function hardBlockNewEntity(slot: string, value: string, typeKey: string, newType = false): TriggerBoundaryDecision {
  const dataRequest: DataRequest = {
    typeKey,
    columns: ["（该类型待人工描述的字段/值域/样例）"],
    entities: [value],
    reason: newType
      ? `目标类型「${typeKey}」不在已发布 ObjectType schema 内——越界新类型不得自动合成；须人工输入数据描述（字段/值域/样例）→ R4 审批物化为值域模板后才允许 SOFT 合成`
      : `「${value}」不在注册表既有${slot}枚举内——疑为词表外新实体；自动合成将发明不存在的业务实体，拒绝；须人工输入数据描述（字段/值域/样例）→ R4 审批物化为值域模板后才允许 SOFT 合成`,
    newEntity: true,
    descriptionRequired: true,
    descriptionSchema: [
      { field: "fields", hint: "该类型的字段列表（如 id/name/capacity）" },
      { field: "valueDomain", hint: "各字段值域/枚举/量纲" },
      { field: "samples", hint: "2-3 条样例行" },
    ],
  };
  return {
    outcome: "HARD_BLOCK",
    dataRequest,
    reason: newType ? `B3 越界新类型「${typeKey}」→ 人工正门（数据描述 + R4）` : `B3 词表外新实体「${value}」→ 人工正门（数据描述 + R4）`,
  };
}

/**
 * 触发补数据前置边界判定（B1/B2/B3 合流·确定性纯函数）。
 * 决策顺序：B3 越界（provided 值/目标类型词表外）→ B1 槽位完备（未接地先澄清）→ B2 生成计划预览。
 */
export function decideTriggerBoundary(input: TriggerBoundaryInput): TriggerBoundaryDecision {
  const { question, contextText, providedSlots, dimensions, publishedTypes, targetTypeKey, targetIsExplicitType } = input;
  const round = input.round ?? 1;
  const hay = `${question} ${contextText}`;

  const providedVal = (d: TriggerDimension): string | undefined => {
    const v = providedSlots[d.slot];
    return v == null || v === "" ? undefined : String(v);
  };
  const hitInText = (d: TriggerDimension): string | undefined => (d.enumValues ?? []).find((v) => hay.includes(v));

  // ── B3 越界闸①：provided 的有界枚举值不在注册表 → 词表外新实体 → HARD 拒 + DataRequest。
  for (const d of dimensions) {
    const v = providedVal(d);
    if (v && d.enumValues && !d.enumValues.includes(v)) {
      return hardBlockNewEntity(d.slot, v, targetIsExplicitType ? targetTypeKey : "Object");
    }
  }
  // ── B3 越界闸② / B2 类型封闭：显式目标类型不在已发布 schema 内 → 越界新类型 → HARD 拒。
  if (targetIsExplicitType && publishedTypes.length > 0 && targetTypeKey && !publishedTypes.includes(targetTypeKey)) {
    return hardBlockNewEntity("objectType", targetTypeKey, targetTypeKey, true);
  }

  // ── B1 槽位完备闸：至少一个 identifying 维度被 pin（provided 或问句/上下文命中枚举）→ 已接地；否则先澄清。
  const pinned = (d: TriggerDimension): boolean => !!providedVal(d) || !!hitInText(d);
  const grounded = dimensions.some((d) => d.identifying && pinned(d));
  if (!grounded) {
    const missingSlots: SlotDef[] = dimensions
      .filter((d) => !pinned(d))
      .map((d) => ({
        name: d.slot,
        type: d.type,
        required: d.identifying,
        enumValues: d.enumValues,
        clarifyPrompt: d.clarifyPrompt,
        description: d.description,
      }));
    return {
      outcome: "CLARIFY",
      round,
      maxRounds: CLARIFY_MAX_ROUNDS,
      missingSlots,
      resolvedSlots: providedSlots,
      reason: `问句未解析必需槽位（对象域/实体/时间窗）——先确定性澄清再补，不盲补（第 ${round}/${CLARIFY_MAX_ROUNDS} 次确认）`,
    };
  }

  // ── B2 模式封闭闸：已接地 + 目标类型在已发布 schema 内 → 出生成计划预览（人确认才跑）。
  const boundedEnums = dimensions
    .filter((d) => d.enumValues && pinned(d))
    .map((d) => ({ field: d.slot, values: [providedVal(d) ?? hitInText(d)!] }));
  const plan: GenerationPlanPreview = {
    typeKey: targetIsExplicitType ? targetTypeKey : "Object",
    fields: ["id", "name", "value"],
    rows: 6,
    valueDomainSource: "注册表既有值域（BASE/SEG_REGISTRY）+ 已发布 ObjectType schema（IndustryPack·R14）",
    boundedEnums,
    origin: "SYNTHETIC",
    provisional: true,
  };
  return {
    outcome: "PREVIEW",
    plan,
    resolvedSlots: providedSlots,
    reason: "必需槽位已解析、目标类型在已发布 schema 内——出生成计划预览，人确认才跑（产出 PROVISIONAL/SYNTHETIC）",
  };
}
