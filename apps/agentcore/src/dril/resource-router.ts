import type { ResourceRegistryService } from "./resource-registry.js";
import type { ToolAuthCtx } from "../tools/clients.js";

/**
 * WO-DRIL-P3 · Resource Router（PRD-decision-resource-intelligence-layer §8.2）。
 *
 * `buildResourcePackage(query, context)` = 混合检索的**组包**封装：先按 query 排出全类候选，取 top solver，
 * 再带「已选中 solver」二次检索让**关联 slice/rule/workflow**（resource_relations invokes/includes/binds
 * 到已选 solver）经 relationStrength(0.2·ontology) 上浮 → 产出 `{solvers,slices,rules,skills,workflows}` 资源包，
 * 交 Compose 路径 `compileSolverPlan` 消费（§8.2·additive·不改既有 Phase2-C compose 语义）。
 *
 * R6：底层 registry.search 确定性（含 planSlice BFS graphDistance + EWMA history），同 (query,context) 同包。
 */

export interface ResourcePackage {
  query: string;
  solvers: { key: string; outputShape?: string[] }[];
  slices: string[];
  rules: string[];
  skills: { key: string; label: string; capability?: string }[];
  workflows: string[];
  /** 组包解释（透传底层检索 explanation·可解释性 §4⑤）。 */
  explanation: string;
}

export interface BuildPackageOptions {
  /** 采纳的 top solver 数（默认 4）。 */
  maxSolvers?: number;
  /** 每类关联资源采纳上限（默认 4）。 */
  maxPerKind?: number;
  /** 组包候选面门槛（默认 0·组包不截断·排序决定优先级）。 */
  minScore?: number;
}

export class ResourceRouter {
  constructor(private readonly registry: ResourceRegistryService) {}

  async buildResourcePackage(
    ctx: ToolAuthCtx,
    query: string,
    context?: Record<string, unknown>,
    opts: BuildPackageOptions = {},
  ): Promise<ResourcePackage> {
    const maxSolvers = opts.maxSolvers ?? 4;
    const maxPerKind = opts.maxPerKind ?? 4;
    const minScore = opts.minScore ?? 0;
    const baseReq = { query, ...(context ? { context } : {}), maxResults: 50, minScore } as Parameters<
      ResourceRegistryService["search"]
    >[1];

    // [1] 首轮：排出全类候选，取 top solver。
    const base = await this.registry.search(ctx, baseReq);
    const solverKeys = base.results
      .filter((r) => r.resource.kind === "solver")
      .slice(0, maxSolvers)
      .map((r) => r.resource.key);

    // [2] 次轮：带「已选中 solver」→ 关联 slice/rule/workflow relationStrength 上浮（§8.2·resource_relations）。
    const selectedKeys = new Set(solverKeys.map((k) => `solver|${k}`));
    const withRel =
      selectedKeys.size > 0 ? await this.registry.search(ctx, baseReq, { selectedKeys }) : base;

    const pick = (kind: string): string[] =>
      withRel.results
        .filter((r) => r.resource.kind === kind)
        .slice(0, maxPerKind)
        .map((r) => r.resource.key);

    const skillDetails = withRel.results
      .filter((r) => r.resource.kind === "skill")
      .slice(0, maxPerKind)
      .map((r) => {
        const resource = r.resource as { key: string; label?: string; capability?: string };
        return { key: resource.key, label: resource.label ?? resource.key, capability: resource.capability };
      });

    return {
      query,
      solvers: solverKeys.map((k) => {
        const shape = (base.results.find((r) => r.resource.key === k)?.resource as { outputSpec?: { shape?: string[] } } | undefined)
          ?.outputSpec?.shape;
        return shape ? { key: k, outputShape: shape } : { key: k };
      }),
      slices: pick("slice"),
      rules: pick("rule"),
      skills: skillDetails,
      workflows: pick("workflow"),
      explanation: base.explanation,
    };
  }
}
