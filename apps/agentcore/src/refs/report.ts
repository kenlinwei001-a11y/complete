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

export interface RefReport {
  source: { kind: "agent" | "workflow" | "plan" | "intent"; key: string; name?: string };
  refs: Ref[];
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
