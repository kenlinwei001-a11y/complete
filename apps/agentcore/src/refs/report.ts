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

/** 切片引用同样 latest：切片规格按 key 解析当前版本（`GET …/slices/{key}` 不带版本号）。 */
const sliceRef = (key: string): Ref => ({ kind: "slice", key, version: "latest" });

/**
 * 模板占位符不是真 key。种子里 `plan_order_deep_360` 的步骤写着
 * `params.sliceKey = "{{steps.s1.output.sliceKey}}"`（先 plan_slice 动态规划、再 resolve_slice 消费），
 * 照抄 `dril/relations.ts:57` 的 `if (sliceKey)` 会把这串模板当成切片 key 上报，
 * 在 A 侧留下一条**永远反查不到**的悬挂引用。
 * relations.ts 不过滤是安全的 —— 它的下游 registry 有「两端均须在册」这道过滤；
 * 引用上报**没有**那道过滤（`sliceReferences` 只按 key 字符串比对），所以必须在源头挡掉。
 */
const TEMPLATE_PLACEHOLDER = /\{\{[\s\S]*?\}\}/;
const isConcreteKey = (k: unknown): k is string =>
  typeof k === "string" && k.length > 0 && !TEMPLATE_PLACEHOLDER.test(k);

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
  return dedupe(out);
}

/**
 * WO-SLICE-REF-PRODUCER：workflow / plan 的步骤 → 出向**切片**引用。
 *
 * 抽取判据与 `dril/relations.ts:57`（`workflow --includes--> slice`）**同源**：
 * `step.type === "resolve_slice"` 且 `params.sliceKey` —— 那里已经把这条关系算出来了，
 * 只是算在 B 侧、不回流 A，于是 A 的切片反查恒空。此处把同一判据接到 B→A 上报管道上。
 */
export function planStepSliceRefs(steps: (ExecutionPlan | WorkflowDefinition)["steps"]): Ref[] {
  const out: Ref[] = [];
  for (const step of steps) {
    if (step.type !== "resolve_slice") continue;
    const key = (step.params as { sliceKey?: unknown }).sliceKey;
    if (isConcreteKey(key)) out.push(sliceRef(key));
  }
  return dedupe(out);
}

/**
 * 一个 source 的**全部**出向引用，合并成一次上报。
 *
 * ⚠️ 必须合并，不许分两次调用 `reportRefs`：A 侧的记录 id 是
 * `refr_{tenantId}_{source.kind}_{source.key}`（`llmproviders.ts` 的 report 路由），
 * 而 `Store.put` 是按 id **整条覆盖**。分两次上报 ⇒ 后一次把前一次的 refs 抹掉。
 * 种子工作流 `sop_balance_wf` 同时含 `evaluate_rules(["C18","C21"])` 与
 * `resolve_slice("monthly_balance")`，这个覆盖是真会发生的，不是假想。
 */
export function planStepRefs(steps: (ExecutionPlan | WorkflowDefinition)["steps"]): Ref[] {
  return dedupe([...planStepRuleRefs(steps), ...planStepSliceRefs(steps)]);
}

/** 按 (kind, key) 去重并保持首次出现顺序（R6 确定性：同输入同输出）。 */
function dedupe(refs: Ref[]): Ref[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const pk = `${r.kind}:${r.key}`;
    return seen.has(pk) ? false : (seen.add(pk), true);
  });
}
