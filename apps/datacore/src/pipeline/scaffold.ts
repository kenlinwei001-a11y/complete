import type {
  OntologyWorkflow,
  ScaffoldResult,
  ScaffoldView,
  ScaffoldScene,
  ScaffoldAgent,
} from "@platform/contracts";
import { validationError } from "../errors.js";

/**
 * OntoFlow（PRD v2 · P4 · §8.1）从已发布本体生成应用（scaffold）——纯确定性函数。
 *
 * 输入：一条 PUBLISHED 的 OntologyWorkflow（否则抛 VALIDATION_ERROR）。
 * 输出（泛化 seedViewConfigs / scenarioPackages / scene-entries / agents）：
 *   views    —— 每个实体类型一个台账(ledger) + 全局驾驶舱(dashboard) + 全局本体图谱(graph)。
 *   scenes   —— 每个「核心实体」一个 AGENT_FIRST 场景，绑定默认 Agent。
 *   agents   —— 每个核心实体一个默认 Agent，挂载 §8.1 通用工具集；有 description 时注入 systemPrompt。
 *   scenarioPackages —— 通用场景包（默认启用）。
 *   solverBindings   —— 通用求解器（默认启用）；领域求解器不自动绑定（可插拔）。
 *
 * 「核心实体」= storageMode=ONTOLOGY 的实体节点（可参与推演）；若整图无 ONTOLOGY 实体，
 * 则回退为全部实体节点（纯结构骨架也能拿到场景/Agent）。确定性：按节点出现序、typeKey 去重。
 */

/** §8.1 通用工具集（任意本体即可用）。 */
export const GENERIC_AGENT_TOOLS = [
  "query_objects",
  "resolve_slice",
  "invoke_solver",
  "evaluate_rules",
  "aggregate_objects",
] as const;

/** 通用场景包 / 通用求解器（默认启用，领域包/求解器按需另绑）。 */
export const GENERIC_SCENARIO_PACKAGES = ["generic-ontology"] as const;
export const GENERIC_SOLVER_BINDINGS = ["generic_whatif"] as const;

type EntityNode = Extract<OntologyWorkflow["nodes"][number], { kind: "SUBGRAPH_ENTITY" }>;

/** 按节点出现序、typeKey 去重取实体节点。 */
function distinctEntities(wf: OntologyWorkflow): EntityNode[] {
  const seen = new Set<string>();
  const out: EntityNode[] = [];
  for (const n of wf.nodes) {
    if (n.kind !== "SUBGRAPH_ENTITY") continue;
    if (seen.has(n.modeling.typeKey)) continue;
    seen.add(n.modeling.typeKey);
    out.push(n);
  }
  return out;
}

const displayOf = (n: EntityNode): string => n.modeling.displayName || n.modeling.typeKey;

export function buildScaffold(wf: OntologyWorkflow): ScaffoldResult {
  if (wf.status !== "PUBLISHED") {
    throw validationError(`工作流 ${wf.id} 未发布，无法生成应用（需先 publish）`);
  }
  const entities = distinctEntities(wf);
  const core = entities.filter((n) => n.storageMode === "ONTOLOGY");
  const coreEntities = core.length > 0 ? core : entities;

  // views：每实体台账 + 全局驾驶舱 + 全局图谱
  const views: ScaffoldView[] = entities.map((n) => ({
    key: `ledger_${n.modeling.typeKey}`,
    kind: "ledger",
    title: `${displayOf(n)} 台账`,
    typeKey: n.modeling.typeKey,
  }));
  views.push({ key: "dashboard_global", kind: "dashboard", title: "全局驾驶舱" });
  views.push({ key: "graph_global", kind: "graph", title: "本体图谱" });

  // scenes + agents：每核心实体
  const scenes: ScaffoldScene[] = [];
  const agents: ScaffoldAgent[] = [];
  for (const n of coreEntities) {
    const typeKey = n.modeling.typeKey;
    const agentKey = `agent_${typeKey}`;
    scenes.push({
      key: `scene_${typeKey}`,
      title: `${displayOf(n)} 场景`,
      mode: "AGENT_FIRST",
      typeKey,
      agentKey,
    });
    const description = n.modeling.description?.trim();
    agents.push({
      key: agentKey,
      title: `${displayOf(n)} 助手`,
      tools: [...GENERIC_AGENT_TOOLS],
      ...(description ? { systemPrompt: `你负责本体实体「${displayOf(n)}」。${description}` } : {}),
    });
  }

  return {
    views,
    scenes,
    agents,
    scenarioPackages: [...GENERIC_SCENARIO_PACKAGES],
    solverBindings: [...GENERIC_SOLVER_BINDINGS],
  };
}
