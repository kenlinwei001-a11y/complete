import type {
  Answer,
  CeoAgentRole,
  CeoQueryRoute,
  PageContext,
  PageEntity,
  ProvenanceRef,
  ToolPayload,
} from "@platform/contracts";
import { resolveCeoRoute, ceoIntentKeyForRoute } from "../router/ceo-route.js";
import type { DataCoreClient, ToolAuthCtx } from "../tools/clients.js";

/**
 * WO-CEO-6 · CEO agent（确定性·无 LLM）。
 *
 * 读页面 PageContext，走 resolveCeoRoute 决策落到 gap_attribution / decision_play /
 * metric_rollup / signal，经 DataCore HTTP(OBO) 读 Metric/GapAttribution/DecisionOption
 * 并调用对应求解器，产出带 drillRef 溯源链的答案（R13）。
 *
 * 角色化 scope：CEO 全域 / base-planner 基地 scope（A6 行级过滤由 DataCore OBO 真执行，
 * 本层只声明 scopeBasesFor）。
 */
export interface CeoAgentDeps {
  dataCore: DataCoreClient;
}

export interface CeoAgentAnswerOptions {
  question: string;
  pageContext?: PageContext;
  role?: CeoAgentRole;
  baseScope?: string[];
  auth: ToolAuthCtx;
}

export interface CeoAgentAnswer {
  answer: Answer;
  route: CeoQueryRoute;
}

const ENTITY_READABLE_TYPES = new Set(["Metric", "GapAttribution", "DecisionOption"]);

function entityDrillRef(e: PageEntity): string | undefined {
  return e.drillRef ?? (ENTITY_READABLE_TYPES.has(e.type) ? `${e.type}:${e.id}` : undefined);
}

function safeString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArrayOfRecords(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && v.every(isPlainRecord);
}

/** 从求解器返回中抽出首个对象数组，尝试生成表。 */
function extractTable(data: unknown): { columns: string[]; rows: (string | number | null)[][] } | undefined {
  if (!isPlainRecord(data)) return undefined;
  for (const value of Object.values(data)) {
    if (isArrayOfRecords(value)) {
      const columns = [...new Set(value.flatMap((r) => Object.keys(r)))];
      const rows = value.map((r) => columns.map((c) => {
        const cell = r[c];
        if (cell === null || cell === undefined) return null;
        if (typeof cell === "number") return cell;
        return safeString(cell);
      }));
      return { columns, rows };
    }
  }
  return undefined;
}

/** 从求解器返回中抽出顶层数值标量作为 KPI（限少量，避免噪音）。 */
function extractKpis(data: unknown): { label: string; value: string; unit?: string }[] {
  if (!isPlainRecord(data)) return [];
  const out: { label: string; value: string; unit?: string }[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "number") {
      const label = k;
      const unit = k.toLowerCase().includes("pct") || k.toLowerCase().includes("rate") ? "%" : undefined;
      out.push({ label, value: String(v), unit });
      if (out.length >= 4) break;
    }
  }
  return out;
}

export class CeoAgent {
  constructor(private readonly deps: CeoAgentDeps) {}

  async answer(opts: CeoAgentAnswerOptions): Promise<CeoAgentAnswer> {
    const role = opts.role ?? "ceo";
    const route = resolveCeoRoute(opts.question, opts.pageContext, role, opts.baseScope ?? []);

    // 1) 调用目标求解器（PageContext 派生的 args 真注入到求解器）。
    const solverResult: ToolPayload = await this.deps.dataCore.solver.invoke(
      opts.auth,
      route.solverKey,
      route.args,
    );

    // 2) 可选：读页面上引用的真对象，用于 enrichment + provenance（失败不阻断）。
    const entityReads: { entity: PageEntity; result: ToolPayload }[] = [];
    for (const entity of opts.pageContext?.entities ?? []) {
      if (!ENTITY_READABLE_TYPES.has(entity.type)) continue;
      try {
        const result = await this.deps.dataCore.ontology.getObject(opts.auth, entity.type, entity.id);
        entityReads.push({ entity, result });
      } catch {
        // 诚实跳过：对象不存在也继续，答案不因此编造。
      }
    }

    // 3) 组装答案 + 每跳溯源链（R13）。
    const provenance: ProvenanceRef[] = [
      {
        id: "prov_ceo_solver",
        source: "TOOL_RESULT",
        toolCallId: "tc_ceo_solver",
        toolName: route.solverKey,
        outputPath: "",
        snapshotVersion: solverResult.snapshotVersion,
      },
    ];
    for (let i = 0; i < entityReads.length; i++) {
      const { entity, result } = entityReads[i]!;
      provenance.push({
        id: `prov_ceo_entity_${i}`,
        source: "TOOL_RESULT",
        toolCallId: `tc_ceo_get_object_${i}`,
        toolName: "get_object",
        outputPath: `${entity.type}:${entity.id}`,
        snapshotVersion: result.snapshotVersion,
      });
    }

    const answer = this.buildAnswer(route, opts.pageContext, solverResult, provenance);
    return { answer, route };
  }

  private buildAnswer(
    route: CeoQueryRoute,
    pageContext: PageContext | undefined,
    solverResult: ToolPayload,
    provenance: ProvenanceRef[],
  ): Answer {
    const lines: string[] = [];
    lines.push(`**CEO 深问路由**：${route.reason}`);

    if (pageContext) {
      if (pageContext.focus?.metric) {
        lines.push(`- 聚焦指标：${pageContext.focus.metric}`);
      }
      if (pageContext.selection.length) {
        lines.push(`- 当前选中：${pageContext.selection.join(", ")}`);
      }
      const drillable = (pageContext.entities ?? [])
        .map((e) => (entityDrillRef(e) ? `${e.type}:${e.label}（drillRef=${entityDrillRef(e)}）` : undefined))
        .filter(Boolean);
      if (drillable.length) {
        lines.push(`- 可反向下钻实体：${drillable.join("；")}`);
      }
      if (pageContext.drillPath.length) {
        lines.push(`- 下钻路径：${pageContext.drillPath.join(" → ")}`);
      }
    }

    lines.push(`\n求解器 **${route.solverKey}** 输出如下：`);

    const blocks: Answer["blocks"] = [{ type: "text", markdown: lines.join("\n") }];

    const table = extractTable(solverResult.data);
    if (table) {
      blocks.push({
        type: "table",
        columns: table.columns,
        rows: table.rows,
        provId: "prov_ceo_solver",
      });
    }

    for (const kpi of extractKpis(solverResult.data)) {
      blocks.push({
        type: "kpi",
        label: kpi.label,
        value: kpi.value,
        ...(kpi.unit ? { unit: kpi.unit } : {}),
        provId: "prov_ceo_solver",
      });
    }

    return {
      trustLevel: "VERIFIED_WORKFLOW",
      blocks,
      provenance,
      unverifiedNumerics: false,
    };
  }
}

/** 从角色 + baseScope 生成 CEO agent 画像（schema 单一来源在 contracts/ceo-agent.ts）。 */
export function createCeoAgentProfile(role: CeoAgentRole = "ceo", baseScope: string[] = []): {
  profileId: string;
  role: CeoAgentRole;
  scope: { allBases: boolean; baseIds: string[] };
  focusMetrics: string[];
} {
  const scope = role === "ceo"
    ? { allBases: true, baseIds: [] }
    : { allBases: false, baseIds: [...baseScope].sort() };
  return {
    profileId: `ceo_profile_${role}`,
    role,
    scope,
    focusMetrics: role === "ceo" ? ["revenue", "gm_rate", "market_share", "cash_cushion"] : ["utilization", "achievement"],
  };
}

export { resolveCeoRoute, ceoIntentKeyForRoute };
