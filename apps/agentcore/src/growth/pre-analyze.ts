import type {
  ClassificationResult,
  GapAnalysis,
  GapItem,
  GapSide,
  HiddenReqGraph,
  MaterializedIntent,
  ModuleKind,
  PreAnalysisReport,
} from "@platform/contracts";
import { DATADEP_ROLE_CANONICAL, MODULE_KINDS, SOLVER_DATADEP, deriveSandboxConfigNeeds, diffGap, expandHiddenRequirements, sandboxConfigNeedKeys } from "@platform/contracts";
import type { AppConfig } from "../config.js";
import type { Repos } from "../persistence/repos.js";

/**
 * UPG-L0-PREANALYSIS · 统一 GapAnalysis 引擎（AgentCore 侧·PRD-gap-analysis-engine §5/§6）。
 *
 * 「后台异步全景预分析」旁路：复用 QOS 既有 `ClassificationResult`（不造轮子），据其候选意图的
 * **真实绑定**（MaterializedIntent.bindings）推需求树 → 自组装**两侧** `existing`（A 栈经服务间
 * `GET /a/v1/databuilder/registry-snapshot` 6 类·B 栈查自己 repos）→ 调**同一** `diffGap` 纯核
 * （do NOT reimplement·R1/R6）→ enrich 叠 severity/explanation/remediation（§10 咨询信号最高 WARNING，
 * 永不误红——权威判决仍归 reactive classifyGap）→ PreAnalysisReport。
 *
 * 暗发：本路径 additive，仅在 feature `growth.pre_analysis`（defaultOn:false·RL2）开时被热路由起后台；
 * 关时既不起后台、端点 404 → 改造前系统零行为变化。
 */

/** kind → side（与 DataCore MODULE_PROVISIONERS 同源·provisioners.ts:36）。 */
const SIDE_BY_KIND: Record<ModuleKind, GapSide> = {
  dataset: "content",
  kb_doc: "content",
  ontology_type: "structure",
  rule: "structure",
  slice: "structure",
  solver: "code",
  intent: "cross_system",
  plan: "cross_system",
  workflow: "cross_system",
  skill: "cross_system",
  agent: "cross_system",
  scene: "cross_system",
  mcp: "cross_system",
  // S0 沙盘配套（WO-SANDBOX-CONFIG-COVERAGE §3.2）：state_var=结构层；propagation_rule 取 cross_system
  // 拓扑序最后位（先有派生属性/链路才建规则）——与 DataCore MODULE_PROVISIONERS 同源。
  propagation_rule: "cross_system",
  state_var: "structure",
};

/** kind → autoCreatable（solver 是代码不能自动建 → 缺则 MISSING·落工单；其余可 scaffold）。 */
const AUTOCREATABLE_BY_KIND: Record<ModuleKind, boolean> = {
  dataset: true,
  kb_doc: true,
  ontology_type: true,
  rule: true,
  slice: true,
  solver: false,
  intent: true,
  plan: true,
  workflow: true,
  skill: true,
  agent: true,
  scene: true,
  mcp: true,
  // S0：二者无 scaffolder（系数/formula 需领域判断）→ 缺则 MISSING → MANUAL/工单（诚实·与 DataCore 同源）。
  propagation_rule: false,
  state_var: false,
};

/** DataCore 直查 8 类（有 existing()·registry-snapshot 返回；PRD §3 + S0 沙盘配套两类）。 */
const A_STACK_KINDS: readonly ModuleKind[] = ["dataset", "kb_doc", "ontology_type", "rule", "slice", "solver", "propagation_rule", "state_var"];

/**
 * 需求树推导（纯函数·R6·§6「复用分类器不造轮子」）：ClassificationResult 候选意图 → 各意图**真实绑定**
 * （MaterializedIntent.bindings：solverKey/ruleKeys/ontologySliceKey/skillId/agentId）→ 需求集。
 * 命名空间对齐 existing：intent/solver/rule/slice 用 key，skill/agent 用 id（bindings 存 id）。
 * 找不到物化意图 → 该意图键仍计入 intent 需求（NO_INTENT 缺口）。
 */
export function deriveRequirements(
  classification: ClassificationResult | undefined,
  materializedByKey: Map<string, MaterializedIntent>,
): Partial<Record<ModuleKind, string[]>> {
  const req: Partial<Record<ModuleKind, string[]>> = {};
  const push = (kind: ModuleKind, key: string | undefined) => {
    if (!key) return;
    (req[kind] ??= []).push(key);
  };
  for (const cand of classification?.candidates ?? []) {
    push("intent", cand.intentKey);
    const mi = materializedByKey.get(cand.intentKey);
    if (!mi) continue;
    const b = mi.bindings;
    push("solver", b.solverKey);
    push("slice", b.ontologySliceKey);
    push("skill", b.skillId);
    for (const rk of b.ruleKeys ?? []) push("rule", rk);
    for (const ck of b.constraintKeys ?? []) push("rule", ck);
    if (mi.mode === "AGENT_FIRST") push("agent", b.agentId);
    // S0（WO-SANDBOX-CONFIG-COVERAGE §3.4）：时序推演意图声明的沙盘配套 → 需求树（声明了才诊断,
    // 不声明零变化——诚实边界:智能推导属 S1,此处只消费绑定里的静态声明·R6）。
    for (const sv of b.stateVarKeys ?? []) push("state_var", sv);
    for (const pk of b.propagationRuleKeys ?? []) push("propagation_rule", pk);
  }
  return req;
}

// —— S0（WO-SANDBOX-CONFIG-COVERAGE §3.5）沙盘配套缺口 → GrowthTicket 落点（纯函数·server 侧接线消费） ——
export interface SandboxConfigGap {
  kind: "propagation_rule" | "state_var";
  key: string;
}

/**
 * 从预分析报告抽沙盘配套 MISSING 项（传导规则/状态变量·autoCreatable:false → 非 EXISTS 即 MISSING）。
 * 纯函数（R6）；无该两 kind（未声明需求/S1 未落）→ 空数组 = 零行为变化（暗发惰性）。
 */
export function listSandboxConfigGaps(report: PreAnalysisReport): SandboxConfigGap[] {
  const out: SandboxConfigGap[] = [];
  for (const e of report.gapAnalysis?.entries ?? []) {
    if (e.kind !== "propagation_rule" && e.kind !== "state_var") continue;
    for (const i of e.items) if (i.status === "MISSING") out.push({ kind: e.kind, key: i.key });
  }
  return out;
}

/** 严重度/补法叠加（§10：预分析咨询信号·永不 BLOCKER/ERROR；EXISTS=INFO·缺口=WARNING）。 */
function enrichItem(item: GapItem, side: GapSide): GapItem {
  if (item.status === "EXISTS") {
    return { ...item, severity: "INFO" };
  }
  if (item.status === "MISSING") {
    // solver（code）缺 → 需开发；其余不可自动建的缺 → 人工正门。
    const develop = side === "code";
    return {
      ...item,
      severity: "WARNING",
      explanation: {
        why: develop ? "求解器是纯函数代码·不能自动建" : "该制品缺失且不可自动建",
        evidence: `预分析（咨询信号·非判决）：${item.key} 未在现状快照中命中`,
        alternative: develop ? "产出带 I/O 契约的求解器骨架工单交 code agent 施工" : "经真人正门补齐后重跑",
      },
      remediation: {
        strategy: develop ? "DEVELOP" : "MANUAL",
        estimatedEffort: develop ? "DAYS" : "HOURS",
        canBeParallel: true,
      },
    };
  }
  // TO_CREATE：可自动建（content 直合成 / structure·cross_system 经 scaffold 待审批）。
  const withApproval = side !== "content";
  return {
    ...item,
    severity: "WARNING",
    explanation: {
      why: "现状未命中·可自动建（scaffold DRAFT·R4 不自动发布）",
      evidence: `预分析（咨询信号·非判决）：${item.key} 需新建`,
    },
    remediation: {
      strategy: withApproval ? "AUTO_WITH_APPROVAL" : "AUTO",
      estimatedEffort: "MINUTES",
      canBeParallel: true,
    },
  };
}

/** 全 entries 逐项叠加咨询信号（纯函数·不改 diffGap 计数）。 */
export function enrichForQuery(analysis: GapAnalysis): GapAnalysis {
  return {
    ...analysis,
    entries: analysis.entries.map((e) => ({ ...e, items: e.items.map((i) => enrichItem(i, e.side)) })),
  };
}

/** 从 enrich 后的 GapAnalysis 派生 summary（§4 契约·全部真源计数）。 */
export function buildSummary(analysis: GapAnalysis): NonNullable<PreAnalysisReport["summary"]> {
  let autoFixable = 0;
  let manualRequired = 0;
  let developRequired = 0;
  for (const e of analysis.entries) {
    for (const i of e.items) {
      const s = i.remediation?.strategy;
      if (s === "AUTO" || s === "AUTO_WITH_APPROVAL") autoFixable += 1;
      else if (s === "MANUAL") manualRequired += 1;
      else if (s === "DEVELOP") developRequired += 1;
    }
  }
  return {
    totalGaps: analysis.totals.toCreate + analysis.totals.missing,
    autoFixable,
    manualRequired,
    developRequired,
    coverageScore: analysis.totals.coverageScore ?? 1,
    executionSteps: analysis.executionPlan?.length ?? 0,
  };
}

/** A 栈现状快照（服务间凭证·SERVICE_TOKEN + x-tenant-id·PRD §11）。不可达/未配置 → undefined（诚实降级）。 */
export async function fetchRegistrySnapshot(
  config: Pick<AppConfig, "DATACORE_BASE_URL" | "SERVICE_TOKEN">,
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string[]> | undefined> {
  const baseUrl = config.DATACORE_BASE_URL;
  const token = config.SERVICE_TOKEN;
  if (!baseUrl || !token) return undefined;
  try {
    const res = await fetchImpl(`${baseUrl}/a/v1/databuilder/registry-snapshot`, {
      method: "GET",
      headers: { "x-service-token": token, "x-tenant-id": tenantId, "x-service-caller": "agentcore" },
    });
    if (!res.ok) return undefined;
    return (await res.json()) as Record<string, string[]>;
  } catch {
    return undefined;
  }
}

/**
 * 真实本体图（UPG-L0-HIDDENREQ §8·白名单①②真类型/真链路的唯一来源）——服务间凭证拉 DataCore
 * `GET /a/v1/ontology/graph`（roles=["service"]·x-tenant-id·R2）。不可达/未配置 → undefined
 * （诚实降级：无真图 → 不做隐藏需求闭包·== 不做·非造假空扩展）。
 */
export async function fetchOntologyGraph(
  config: Pick<AppConfig, "DATACORE_BASE_URL" | "SERVICE_TOKEN">,
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HiddenReqGraph | undefined> {
  const baseUrl = config.DATACORE_BASE_URL;
  const token = config.SERVICE_TOKEN;
  if (!baseUrl || !token) return undefined;
  try {
    const res = await fetchImpl(`${baseUrl}/a/v1/ontology/graph`, {
      method: "GET",
      headers: { "x-service-token": token, "x-tenant-id": tenantId, "x-service-caller": "agentcore" },
    });
    if (!res.ok) return undefined;
    const g = (await res.json()) as { nodes?: { key: string }[]; edges?: { from: string; to: string; label: string }[] };
    return { nodes: g.nodes ?? [], edges: g.edges ?? [] };
  } catch {
    return undefined;
  }
}

/**
 * 隐藏需求闭包折叠（UPG-L0-HIDDENREQ §8·纯函数·R6）：把显式需求（solver/ontology_type）经
 * `expandHiddenRequirements`（三白名单 by-construction·零幽灵）扩为隐藏需求，回并到 `required`——
 * 隐藏对象类型 → `ontology_type`、隐藏求解器 → `solver`（与 diffGap 消费的 required map 同命名空间）。
 * bindings 用 canonical 解析（无租户 SolverBinding 时回退 DATADEP_ROLE_CANONICAL·对齐 solver-binding 门约定）。
 * graph 缺失 → 原样返回（诚实：无真图不扩展）。
 */
export function foldHiddenRequirements(
  required: Partial<Record<ModuleKind, string[]>>,
  graph: HiddenReqGraph | undefined,
): Partial<Record<ModuleKind, string[]>> {
  if (!graph) return required;
  const expansion = expandHiddenRequirements(
    { objectTypes: required.ontology_type ?? [], solvers: required.solver ?? [] },
    graph,
    SOLVER_DATADEP,
    { resolve: (roleType) => DATADEP_ROLE_CANONICAL[roleType] },
  );
  const merged: Partial<Record<ModuleKind, string[]>> = { ...required };
  merged.ontology_type = [...new Set([...(required.ontology_type ?? []), ...expansion.requiredObjectTypes])].sort();
  merged.solver = [...new Set([...(required.solver ?? []), ...expansion.requiredSolvers])].sort();
  return merged;
}

/** B 栈现状（查 agentcore 自己 repos·R2 tenant 谓词）+ A 栈快照 → existing map。 */
export async function assembleExisting(
  deps: PreAnalyzeDeps,
  tenantId: string,
  aSnapshot: Record<string, string[]> | undefined,
): Promise<{ existing: Partial<Record<ModuleKind, ReadonlySet<string>>>; snapshotAvailable: boolean }> {
  const existing: Partial<Record<ModuleKind, ReadonlySet<string>>> = {};
  // B 栈（cross_system）：intent（物化意图 key）·skill/agent（id·bindings 存 id）。
  const [mis, skills, agents, intentSlices] = await Promise.all([
    deps.repos.materializedIntents.listByTenant(tenantId),
    deps.repos.skills.listByTenant(tenantId),
    deps.repos.agents.listByTenant(tenantId),
    deps.repos.intentSlices.listByTenant(tenantId),
  ]);
  existing.intent = new Set(mis.filter((m) => m.status === "PUBLISHED").map((m) => m.key));
  existing.skill = new Set(skills.map((s) => s.id));
  existing.agent = new Set(agents.map((a) => a.id));
  // A 栈（content/structure/code）：来自服务间快照；slice 并入 agentcore 本地 intentSlices（同为 key 空间）。
  const snapshotAvailable = !!aSnapshot;
  if (aSnapshot) {
    for (const kind of A_STACK_KINDS) {
      const keys = aSnapshot[kind] ?? [];
      existing[kind] = new Set(kind === "slice" ? [...keys, ...intentSlices.map((s) => s.sliceKey)] : keys);
    }
  }
  return { existing, snapshotAvailable };
}

export interface PreAnalyzeDeps {
  repos: Repos;
  config: Pick<AppConfig, "DATACORE_BASE_URL" | "SERVICE_TOKEN">;
  fetchImpl?: typeof fetch;
}

export interface PreAnalyzeInput {
  tenantId: string;
  taskId: string;
  query: string;
  classification: ClassificationResult | undefined;
  /** R6：调用方注入生成时刻（纯核不取时钟·同输入字节一致）。 */
  generatedAt: string;
  /**
   * UPG-L0-HIDDENREQ §8：隐藏需求闭包开关（暗发 `growth.hidden_req` defaultOn:false·RL2）。
   * undefined/false → 只诊断显式需求（== 不做隐藏需求发现·回退演练 C3）；true → 折叠三白名单隐藏需求。
   */
  hiddenReqEnabled?: boolean;
  /**
   * WO-SANDBOX-CONFIG-DERIVE（补 S0 §3.4）：从**已构 RequirementGraph 的传导语义**真派生沙盘配套需求
   * （propagation_rule/state_var）并入 required 的开关（暗发 `growth.sandbox_config_derive` defaultOn:false·RL2）。
   * undefined/false → 只诊断意图静态声明的配套（== S0 原行为·回退演练零变化）；
   * true 且该 task 有 RequirementGraph（含传导语义）→ 沿真链路补出 propagation_rule/state_var 需求 → gap 可诊断。
   * 无 RG（QOS_REQUIREMENT_GRAPH 关）/无传导语义 → 空派生 = 零变化（诚实惰性）。
   */
  sandboxConfigDeriveEnabled?: boolean;
}

/**
 * 预分析主入口（可测单元·R6 确定性）：给定同一 classification + 同一 repo 现状 + 注入 generatedAt →
 * 字节一致的 PreAnalysisReport。A 栈快照不可达时诚实降级（只诊断可靠取到 existing 的 kind，不造假缺口）。
 */
export async function preAnalyzeQuery(deps: PreAnalyzeDeps, input: PreAnalyzeInput): Promise<PreAnalysisReport> {
  const { tenantId, taskId, query, classification, generatedAt, hiddenReqEnabled, sandboxConfigDeriveEnabled } = input;
  const mis = await deps.repos.materializedIntents.listByTenant(tenantId);
  const byKey = new Map(mis.map((m) => [m.key, m] as const));
  let required = deriveRequirements(classification, byKey);

  // WO-SANDBOX-CONFIG-DERIVE（补 S0 §3.4·暗发 growth.sandbox_config_derive·flag OFF 零变化）：从该 task 的
  // RequirementGraph 传导语义真派生沙盘配套需求，并入 required（与意图静态声明并集去重）。RG 缺失（QOS_REQUIREMENT_GRAPH
  // 关·getByTaskId → undefined）/无传导语义 → 空派生 = 惰性零变化。纯函数 R6（同 RG → 同需求·同快照可缓存）。
  if (sandboxConfigDeriveEnabled) {
    const rg = await deps.repos.requirementGraphs.getByTaskId(tenantId, taskId);
    if (rg) {
      const derivedKeys = sandboxConfigNeedKeys(deriveSandboxConfigNeeds(rg));
      const mergeKeys = (kind: ModuleKind, keys: string[]) => {
        if (keys.length === 0) return;
        required[kind] = [...new Set([...(required[kind] ?? []), ...keys])].sort();
      };
      mergeKeys("state_var", derivedKeys.state_var);
      mergeKeys("propagation_rule", derivedKeys.propagation_rule);
    }
  }

  // UPG-L0-HIDDENREQ §8（暗发·flag OFF 时零变化·回退演练 C3）：显式需求 → 三白名单隐藏需求闭包，
  // 回并前于组装 existing/diff（隐藏对象类型/求解器一并诊断就绪）。无真图时诚实不扩展。
  if (hiddenReqEnabled) {
    const graph = await fetchOntologyGraph(deps.config, tenantId, deps.fetchImpl ?? fetch);
    required = foldHiddenRequirements(required, graph);
  }

  const aSnapshot = await fetchRegistrySnapshot(deps.config, tenantId, deps.fetchImpl ?? fetch);
  const { existing, snapshotAvailable } = await assembleExisting(deps, tenantId, aSnapshot);

  // 诚实降级：A 栈快照不可达 → 丢弃 A 栈需求（不能自组 existing 就不诊断该侧·避免造假缺口）。
  const requiredScoped: Partial<Record<ModuleKind, string[]>> = {};
  for (const kind of MODULE_KINDS) {
    const need = required[kind];
    if (!need || need.length === 0) continue;
    if (!snapshotAvailable && (A_STACK_KINDS as readonly string[]).includes(kind)) continue;
    requiredScoped[kind] = need;
  }

  const raw = diffGap(requiredScoped, existing, {
    side: SIDE_BY_KIND,
    autoCreatable: AUTOCREATABLE_BY_KIND,
    generatedAt,
    target: { kind: "query", query },
    enrich: true,
  });
  const gapAnalysis = enrichForQuery(raw);
  return {
    taskId,
    tenantId,
    query,
    status: "DONE",
    gapAnalysis,
    summary: buildSummary(gapAnalysis),
    createdAt: generatedAt,
  };
}
