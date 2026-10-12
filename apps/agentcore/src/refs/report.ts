import type { AgentDefinition, ExecutionPlan, Ref, WorkflowDefinition } from "@platform/contracts";
import type { AppConfig } from "../config.js";

/**
 * 引用模式增量 §2.3：B → A 引用上报（B 调 A 公开 REST 合规；A→B 仍零调用）。
 *
 * B 资源（agent / workflow / plan）发布时，把其对 A 资源（规则）的出向引用上报到
 * `POST /a/v1/references/report`（服务间凭证）。A 的规则发布据此反查影响面
 * （publish 响应 impact + /a/v1/rules/{id}/references）。fire-and-forget：
 * 上报失败不影响 B 的发布事务。
 */

/**
 * 切片出向引用（§2.4 slice 反查 · G-SLICE-REF-PRODUCER-EMPTY 修法）。
 * 契约 RefKind 枚举不含 "slice"（A 侧 RefReportSchema/ReportedRefRecord 均为松散 kind:string），
 * 故本地扩一个 SliceRef，与契约 Ref 并集进 RefReport.refs —— 线上载荷形状不变，只是多一种 kind。
 */
export interface SliceRef {
  kind: "slice";
  key: string;
  version: "latest";
}

export type ReportRef = Ref | SliceRef;

export interface RefReport {
  source: { kind: "agent" | "workflow" | "plan" | "intent"; key: string; name?: string };
  refs: ReportRef[];
}

export type RefReporter = (tenantId: string, report: RefReport) => Promise<void>;

export function makeRefReporter(
  config: Pick<AppConfig, "DATACORE_BASE_URL" | "SERVICE_TOKEN">,
  fetchImpl: typeof fetch = fetch,
): RefReporter | undefined {
  const baseUrl = config.DATACORE_BASE_URL;
  const token = config.SERVICE_TOKEN;
  if (!baseUrl || !token) return undefined;
  return async (tenantId, report) => {
    try {
      await fetchImpl(`${baseUrl}/a/v1/references/report`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-service-token": token,
          "x-tenant-id": tenantId,
          "x-service-caller": "agentcore",
        },
        body: JSON.stringify(report),
      });
    } catch {
      /* fire-and-forget：A 不可达不影响发布 */
    }
  };
}

/** 规则引用永远 latest（§2.1 —— 不可 pin）。 */
const ruleRef = (key: string): Ref => ({ kind: "rule", key, version: "latest" });

export function agentRuleRefs(agent: AgentDefinition): Ref[] {
  if (agent.ruleBindings.ruleKeys === "ALL_APPLICABLE") return [];
  return agent.ruleBindings.ruleKeys.map(ruleRef);
}

export function planStepRuleRefs(steps: (ExecutionPlan | WorkflowDefinition)["steps"]): Ref[] {
  const out: Ref[] = [];
  for (const step of steps) {
    if (step.type !== "evaluate_rules") continue;
    const ids = step.params.ruleIds;
    if (ids === "ALL_APPLICABLE") continue;
    for (const id of ids) out.push(ruleRef(id));
  }
  // 去重
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

/**
 * G-SLICE-REF-PRODUCER-EMPTY 修法：resolve_slice 步 → kind:"slice" 出向引用（§2.4）。
 * 与 dril/relations.ts 的 workflow --includes--> slice 边同一事实源（step.type=resolve_slice ·
 * params.sliceKey），但那份关系图只落在 B 侧 resource_relations、不回写 DataCore；
 * 本函数把同一条边喂进 B→A 上报路，使 governance.sliceReferences（十六层 ①②）读得回。
 * 切片引用永远 latest（执行时解析，与规则引用同口径）。
 */
export function planStepSliceRefs(steps: (ExecutionPlan | WorkflowDefinition)["steps"]): SliceRef[] {
  const out: SliceRef[] = [];
  for (const step of steps) {
    if (step.type !== "resolve_slice") continue;
    out.push({ kind: "slice", key: step.params.sliceKey, version: "latest" });
  }
  // 去重（与 planStepRuleRefs 同口径）
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}
