import type {
  ClassificationResult,
  GapAnalysis,
  GapItem,
  GapSide,
  MaterializedIntent,
  ModuleKind,
  PreAnalysisReport,
} from "@platform/contracts";
import { MODULE_KINDS, diffGap } from "@platform/contracts";
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
};

/** A 栈 6 类（有 existing()·DataCore registry-snapshot 返回；PRD §3）。 */
const A_STACK_KINDS: readonly ModuleKind[] = ["dataset", "kb_doc", "ontology_type", "rule", "slice", "solver"];

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
  }
  return req;
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
}

/**
 * 预分析主入口（可测单元·R6 确定性）：给定同一 classification + 同一 repo 现状 + 注入 generatedAt →
 * 字节一致的 PreAnalysisReport。A 栈快照不可达时诚实降级（只诊断可靠取到 existing 的 kind，不造假缺口）。
 */
export async function preAnalyzeQuery(deps: PreAnalyzeDeps, input: PreAnalyzeInput): Promise<PreAnalysisReport> {
  const { tenantId, taskId, query, classification, generatedAt } = input;
  const mis = await deps.repos.materializedIntents.listByTenant(tenantId);
  const byKey = new Map(mis.map((m) => [m.key, m] as const));
  const required = deriveRequirements(classification, byKey);

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
