import type { ObjectRef, PageContext } from "@platform/contracts";
import type { Answer, AnswerBlock, OptPerturbation, OptTemplateFamily, ProvenanceRef } from "@platform/contracts";
import { newId } from "../ids.js";

/**
 * WO-OPTWHATIF-NL-WIRING · optimize_whatif 会话路由抽取器（AgentCore 半 · R6 纯函数）。
 *
 * 病根（§8 G-WHATIF-NL-UNREACHABLE）：CP-SAT 可证最优的 `optimize_whatif`（改一约束/系数→重解→Δ目标+可行性+
 * 冲突约束 IIS+决策方案切换）已注册可跑，但**只有前端「优化推演」页能触达·人机对话调不到**（三处接缝断裂）。
 * 本模块闭「意图/装配」接缝的 AgentCore 半：把结构化优化 what-if 问句（选址/网络流…改一参数）**确定性**抽成
 * `{family, selection, perturbations, roleHints}`——供 domain-resolver 路由 + orchestrator 暗发门 → path-A
 * `invoke_solver("optimize_whatif", {family, selection, autoBind:true, perturbations})`（DataCore 半据 selection
 * 从已发布本体真装配基线并重解）。
 *
 * **R6 命门**：纯函数（无 LLM/时钟/随机）——同问句同 selection → 字节一致。
 * **诚实边界**：无 family / 无可抽取扰动 / 无选中决策对象 → `{applicable:false, reason}`（不硬凑·让位 path-B）。
 * **KILL-MOCK**：本层只抽结构化扰动，绝不臆造系数/方案；真解由 DataCore CP-SAT sidecar（或 MockFive 真重解）产出。
 */

// WO-OPTWHATIF-NL-WIRING · opt_whatif 双命中信号（高精度·避免误抓普通 what-if）：**优化决策族词**（选址/设施/覆盖/
// 网络流…）**且**参数改动词（涨到/降到/设为…到 <数>）**两者同时命中**才归 opt_whatif（单命中不触发·守回归门）。
// 本 leaf 模块是该判据**单一来源**（navigation-slice / domain-resolver 均 import·无环）。
const RE_OPT_DECISION_FAMILY = /(选址|设施|开设|布点|指派|覆盖|集合覆盖|独立集|竞价|调拨网络|运输网络|流量)/;
const RE_OPT_PARAM_CHANGE = /(涨到|降到|设为|改到|提高到|下调到|=\s*\d|到\s*\d)/;
/** opt_whatif 双命中判定（决策族词 ∧ 参数改动值）——R6 纯正则。 */
export function isOptWhatifSignal(q: string): boolean {
  const s = q ?? "";
  return RE_OPT_DECISION_FAMILY.test(s) && RE_OPT_PARAM_CHANGE.test(s);
}

/** 优化决策族词 → 抽象模板族（选址/设施→facility_location·调拨/运输网络/流量→min_cost_flow）。 */
const RE_FACILITY = /(选址|设施|开设|布点|指派|集合覆盖|覆盖|独立集|竞价)/;
const RE_FLOW = /(调拨网络|运输网络|调拨|运输|流量|网络流)/;

/** 扰动“种类”判定（涨到/提高→data_override 增·降到/放松→relax_constraint·收紧→add_constraint·设为/改到→data_override）。 */
function perturbKind(q: string): OptPerturbation["kind"] {
  if (/(收紧|压缩|限到|限制到)/.test(q)) return "add_constraint";
  if (/(放松|降到|下调到|放宽)/.test(q)) return "relax_constraint";
  return "data_override"; // 涨到/提高到/设为/改到/到/= 均落 data_override
}

/** 数值抽取：涨到/降到/设为/改到/提高到/下调到/到/= 后的数字（R6 纯正则·取首个）。 */
function extractValue(q: string): number | undefined {
  const m = q.match(/(?:涨到|降到|设为|改到|提高到|下调到|限到|限制到|到|=)\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
}

/** 字段词 → 抽象字段名（按 family 语义·不含行业实体名）。缺省 openCost（facility）/cost（flow）。 */
function fieldFor(q: string, family: OptTemplateFamily): string {
  if (family === "facility_location") {
    if (/(容量|产能|上限)/.test(q)) return "capacity";
    return "openCost"; // 开设成本/开设/成本 → openCost
  }
  // min_cost_flow
  if (/(供应|供给|产出)/.test(q)) return "supply";
  return "cost"; // 运输成本/成本/单价 → arc cost
}

/** collection 名（DF.8 target 语法 <collection>.<id>.<field>·对齐 opt-whatif.ts resolveTarget）。 */
function collectionFor(field: string, family: OptTemplateFamily): string {
  if (family === "facility_location") return "facilities";
  return field === "supply" ? "nodes" : "arcs";
}

/**
 * 决策对象 id 抽取：优先取“出现在问句里”的选中对象 objectId（点名的那个决策对象），
 * 否则从问句抽含数字的标识 token（如 `f1`/`F2`/`node3`）。都取不到 → undefined（诚实落回）。
 */
function extractTargetId(q: string, selectedObjects: ObjectRef[]): string | undefined {
  for (const o of selectedObjects) {
    if (o.objectId && q.includes(o.objectId)) return o.objectId;
  }
  const m = q.match(/\b([A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)\b/);
  return m ? m[1] : undefined;
}

export interface OptWhatifRoleHints {
  /** 选中决策对象的统一类型（候选 facility/node 承载类型·**不硬编类型名**·DataCore 半据此 + 结构/词库接地）。 */
  decisionObjectType?: string;
  /** 选中决策对象 id（装配范围收窄用·slice-planner scope）。 */
  selectionIds: string[];
}

export type OptWhatifRoute =
  | {
      applicable: true;
      family: OptTemplateFamily;
      /** 选中优化决策对象（透传 DataCore 半 assembleBaselineFromSelection）。 */
      selection: ObjectRef[];
      /** 结构化扰动（DF.8 target <collection>.<id>.<field>·守 A18/R6·非裸代码）。 */
      perturbations: OptPerturbation[];
      roleHints: OptWhatifRoleHints;
    }
  | { applicable: false; reason: string };

/** 选中对象是否统一类型（facility_location/min_cost_flow 需单一决策承载类型）→ 返该类型；否则 undefined。 */
function uniformType(selection: ObjectRef[]): string | undefined {
  if (selection.length === 0) return undefined;
  const t = selection[0]!.objectType;
  return selection.every((o) => o.objectType === t) ? t : undefined;
}

/**
 * 结构化优化 what-if 抽取（R6 纯函数）。命中三要件（优化决策族词 ∧ 可抽取「目标参数+数值」∧（选中决策对象 或
 * 问句点名决策对象））→ `{applicable, family, selection, perturbations, roleHints}`；任一缺 → `{applicable:false}`。
 */
export function resolveOptWhatifRoute(
  query: string,
  selectedObjects: ObjectRef[] = [],
  _pageContext?: PageContext,
): OptWhatifRoute {
  const q = query ?? "";
  // ① 双命中门（决策族词 ∧ 参数改动值）——与 navigation-slice 同一判据（单一来源）。
  if (!isOptWhatifSignal(q)) return { applicable: false, reason: "非结构化优化 what-if（缺决策族词或参数改动值）" };

  // ② family 选择（选址/设施→facility_location·调拨/运输网络/流量→min_cost_flow）。
  let family: OptTemplateFamily | undefined;
  if (RE_FACILITY.test(q)) family = "facility_location";
  else if (RE_FLOW.test(q)) family = "min_cost_flow";
  if (!family) return { applicable: false, reason: "识别不出优化模板族（选址/网络流）" };

  // ③ 扰动抽取（目标参数 + 数值 + 决策对象 id）。
  const value = extractValue(q);
  if (value === undefined) return { applicable: false, reason: "抽取不到目标参数数值" };
  const targetId = extractTargetId(q, selectedObjects);
  if (!targetId) return { applicable: false, reason: "问句未点名具体决策对象、且无选中决策对象" };
  const field = fieldFor(q, family);
  const collection = collectionFor(field, family);
  const kind = perturbKind(q);
  const perturbations: OptPerturbation[] = [
    { kind, target: `${collection}.${targetId}.${field}`, value },
  ];

  // ④ 选中 → roleHints（选中对象类型标为候选承载 role·不硬编类型名）。
  const roleHints: OptWhatifRoleHints = {
    ...(uniformType(selectedObjects) ? { decisionObjectType: uniformType(selectedObjects)! } : {}),
    selectionIds: selectedObjects.map((o) => o.objectId).filter(Boolean),
  };

  return { applicable: true, family, selection: selectedObjects, perturbations, roleHints };
}

// ── path-A 答案装配（决策方案切换·零 LLM·R6） ────────────────────────────────

/** optimize_whatif 求解器产物（OptWhatifResult 顶层 + summary + 装配报缺诚实标）。 */
export interface OptWhatifData {
  baselineObjective?: number | null;
  perturbedObjective?: number | null;
  deltaObjective?: number | null;
  deltaByObjective?: Record<string, number>;
  feasible?: boolean;
  conflictConstraints?: string[];
  explanation?: string;
  baselineSolution?: Record<string, unknown>;
  perturbedSolution?: Record<string, unknown>;
  summary?: string;
  /** 装配报缺诚实标（assembleBaselineFromSelection role 支撑属性不存在）→ orchestrator 落回 path-B。 */
  applicable?: boolean;
  missingRoles?: string[];
}

/** ToolPayload 一般为 {data, snapshotVersion}；取 data 作 OptWhatifData（无 data 字段则退回整体）。 */
export function extractOptWhatifData(payload: unknown): { data: OptWhatifData | null; snapshotVersion?: string } {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const snap = typeof p.snapshotVersion === "string" ? p.snapshotVersion : undefined;
    const data = ("data" in p ? p.data : p) as OptWhatifData | null;
    return snap ? { data, snapshotVersion: snap } : { data };
  }
  return { data: null };
}

/** family → 决策方案里“选中/开设的决策项”字段（前端渲“开 f1→开 f2”式切换·异构）。 */
function decisionFieldFor(family: OptTemplateFamily): string {
  if (family === "facility_location") return "openFacilities";
  if (family === "min_cost_flow") return "flows";
  return "chosen";
}

/** 从方案结构取决策项列表（用于“切换”对比·稳定字符串化）。 */
function decisionItems(sol: Record<string, unknown> | undefined, field: string): string {
  const v = sol?.[field];
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("、") || "（空）";
  return v === undefined ? "（未返回）" : JSON.stringify(v);
}

/**
 * 装配「最优决策方案切换」答案（零 LLM·R6）：Δ目标 + 可行性/冲突约束 + baselineSolution→perturbedSolution 决策切换；
 * 业务数字经 `⟦ref:0⟧` 溯到该 invoke_solver 审计（本步不写裸数外的臆造值·KILL-MOCK）。
 */
export function assembleOptWhatifAnswer(
  route: Extract<OptWhatifRoute, { applicable: true }>,
  data: OptWhatifData,
  toolCallId: string,
  snapshotVersion?: string,
): Answer {
  const field = decisionFieldFor(route.family);
  const baseItems = decisionItems(data.baselineSolution, field);
  const pertItems = decisionItems(data.perturbedSolution, field);
  const switched = baseItems !== pertItems;
  const provenance: ProvenanceRef[] = [
    {
      id: newId("prov"),
      source: "TOOL_RESULT" as const,
      toolCallId,
      toolName: "invoke_solver",
      outputPath: "$",
      ...(snapshotVersion ? { snapshotVersion } : {}),
    },
  ];
  const pert = route.perturbations.map((p) => `${p.target} → ${p.value}`).join("、");
  const overview: string[] = [
    `【优化目标级 what-if（CP-SAT 可证最优·推演结果非数据库事实）】模板族 ${route.family}·扰动：${pert}`,
    `目标值：基线 ${data.baselineObjective ?? "—"} → 扰动后 ${data.perturbedObjective ?? "—"}（Δ=${data.deltaObjective ?? "—"}，${data.feasible === false ? "不可行" : "可行"}）⟦ref:0⟧`,
  ];
  if (data.feasible === false && (data.conflictConstraints?.length ?? 0) > 0) {
    overview.push(`冲突约束族（IIS 式）：${data.conflictConstraints!.join("、")}⟦ref:0⟧`);
  }
  const blocks: AnswerBlock[] = [{ type: "text", markdown: overview.join("\n") }];
  blocks.push({
    type: "text",
    markdown:
      `## 最优决策方案切换\n- 基线最优：${baseItems}\n- 扰动后最优：${pertItems}\n` +
      (switched ? `→ **最优决策已切换**（扰动使原方案不再最优）⟦ref:0⟧` : `→ 最优决策未切换（扰动幅度不足以改变最优解）⟦ref:0⟧`),
  });
  if (data.explanation) blocks.push({ type: "text", markdown: data.explanation });

  return {
    trustLevel: "VERIFIED_WORKFLOW", // 确定性 solver 产物 + 零 LLM 装配
    blocks,
    provenance,
    unverifiedNumerics: false, // 业务数字一律 ⟦ref:0⟧ 溯源·无裸臆造
  };
}
