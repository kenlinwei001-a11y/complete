import type { IntelligenceResource, PageContext, ResourceSearchRequest, ResourceSearchResponse } from "@platform/contracts";
import type { ToolAuthCtx } from "../tools/clients.js";
import type { SolverCatalog, SolverCatalogEntry } from "./navigation-slice.js";

/**
 * WO-CAPMAP-LIVE · 活能力地图（把导航图的注入源从手写镜像换成**活资源目录**）。
 *
 * 病根（实测，非读代码猜）：
 * - `navigation-slice.ts` 的手写 `SOLVER_CATALOG` = **19 条**；
 * - 活资源目录同日实测 = **59 solver / 94 object_type / 813 field**
 *   （`GET /b/v1/resources`·真起 datacore:4001 + agentcore:4002·demo 租户）；
 * - 差集 **40 条**：`portfolio` / `multi_objective` / `cross_object_occupancy` / `plan_rootcause` /
 *   `chain_loss_attribution` / `margin_attribution` / `order_fullchain` / `affected_orders` … 全部
 *   **已注册、已开通、检索得到，但模型一次都没被告知它们存在**。
 * - 而 `prompts.ts` 当时还写着「选型已替你做完，不必再用 discover 盲扫」——**一边漏掉 40 个，一边劝模型别去查**。
 *
 * 所以本模块**不造检索**：检索（`ResourceRegistryService.search` = `POST /b/v1/resources/search` 背后同一实现，
 * 也是 `retrieve_knowledge` 工具背后那套）早就存在、且实测好用（金标问句 Top-1 就是期望的 `gap_attribution`）。
 * 本模块只做一件事：**把它接到导航图的注入口上**，替掉那份手抄表。
 *
 * **裁剪策略（token 预算）**：59 条全量注入不现实（单条 capability 就上百字，59 条 ≈ 数千 token，
 * 且大部分与本题无关 —— 噪声本身会拉低选型质量）。故按**本题相关性检索 top-N**，N = {@link LIVE_CAPABILITY_TOP_N}：
 * - 为什么是"按相关性"而不是"按域"/"分层"：域/层都是**又一张要手工维护的映射表**，等于把手抄从
 *   solver 名单挪到域名单，同一个病换个位置；相关性排序的输入是各 solver **自己声明**的
 *   description/answersQuestions/tags（真值在 A 侧注册表），新增 solver 自动可见，零维护。
 * - 为什么取 12 而不是 6（下游 `MAX_SOLVERS` 就是 6）：`projectNavigationSlice` 之后还要按 agent
 *   `scope.objectTypes` 做隔离过滤，过滤会吃掉候选；**2× 过取**保证窄 scope 的角色 agent 不至于把图筛空。
 *   最终注入模型的仍是 ≤6 条（下游截断），token 预算与改造前同量级。
 *
 * **确定性 R6**：检索引擎确定性（无 LLM/无时钟/无随机），实测同问句两次调用打分**逐位一致**：
 *   `gap_attribution:0.499913|plan_rootcause:0.385149|margin_attribution:0.362439|…`
 * 本模块只做纯映射 + 稳定名次赋值，不引入新的不确定性。
 *
 * **R14 零写死**：本文件**不内联任何求解器 key / 行业实体名**——候选、能力描述、输出形状、对象域
 * 全部取自活目录条目自身字段。要让模型看见某个 solver，去 A 侧注册表登记，别回来改代码。
 *
 * **fail-open**：registry 缺失 / DataCore 不可达 / entitlement 未开 / 检索空 → 返 `undefined`，
 * 调用方退 `FALLBACK_SOLVER_CATALOG`（降级镜像）。**绝不因取活目录失败而阻断查询**。
 */

/** 活目录候选过取数（下游 `MAX_SOLVERS`=6 再按 scope 过滤后截断；2× 过取抗窄 scope 筛空）。 */
export const LIVE_CAPABILITY_TOP_N = 12;

/** 检索面（`ResourceRegistryService` 的结构子集——只依赖 search，便于测试替身与解耦）。 */
export interface CapabilityMapSource {
  search(
    ctx: ToolAuthCtx,
    req: ResourceSearchRequest,
    opts?: { selectedKeys?: Set<string> },
  ): Promise<ResourceSearchResponse>;
}

/** 活目录条目里能派生出的对象域（R14：取资源**自身声明/派生**的字段，不手写实体名）。
 *  `tieredTags.l4_object` 由投影期从**已发布 OntologyType** 派生（见 dril/tag-taxonomy.ts），故仍是活的。 */
function readsOf(res: IntelligenceResource): string[] {
  const anyR = res as {
    scopeObjectTypes?: string[];
    inputSpec?: { objectTypes?: string[] };
    tieredTags?: { l4_object?: string[] };
  };
  const out = new Set<string>();
  for (const t of anyR.inputSpec?.objectTypes ?? []) out.add(t);
  for (const t of anyR.scopeObjectTypes ?? []) out.add(t);
  for (const t of anyR.tieredTags?.l4_object ?? []) out.add(t);
  // 稳定序（R6）：集合迭代序依赖插入序，显式排序消除来源顺序影响。
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 输出形状：A 侧 `SOLVER_OUTPUT_SHAPES` 经 `/a/v1/solvers/registry` → 客户端透传 → 投影进 `outputSpec.shape`。 */
function outputShapeOf(res: IntelligenceResource): string[] {
  const anyR = res as { outputSpec?: { shape?: string[] } };
  return anyR.outputSpec?.shape ?? [];
}

/** 一句话能力：资源自报的 capability，退 description，再退 label（投影层已保证 description 非空）。 */
function capabilityOf(res: IntelligenceResource): string {
  const cands = [res.capability, res.description, res.label, res.key];
  return cands.map((c) => c?.trim()).find((c) => c && c.length > 0) ?? res.key;
}

/**
 * 从活资源目录检索本题候选求解器 → 投影成导航图可直接消费的 `SolverCatalog`。
 *
 * @returns 候选目录（key → 条目·带相关性名次 `rank`）；取不到/为空 → `undefined`（调用方退降级镜像）。
 */
export async function fetchLiveSolverCatalog(
  source: CapabilityMapSource | undefined,
  ctx: ToolAuthCtx,
  query: string,
  pageContext?: PageContext,
  opts: { topN?: number } = {},
): Promise<SolverCatalog | undefined> {
  if (!source) return undefined; // registry 未装配（features 缺省）→ 降级
  const topN = opts.topN ?? LIVE_CAPABILITY_TOP_N;
  try {
    const req = {
      query: query ?? "",
      kinds: ["solver"],
      maxResults: topN,
      // 组包同款门槛：0 = 不按绝对分截断，**由相关性排序决定优先级**（低分条目自然排在 topN 之外）。
      // 用绝对阈值会在"整体分偏低但仍有唯一对口 solver"的题上把图筛空 —— 那正是旧镜像的失败形态。
      minScore: 0,
      ...(pageContext ? { context: pageContext as unknown as Record<string, unknown> } : {}),
    } as ResourceSearchRequest;
    const res = await source.search(ctx, req);
    const catalog: SolverCatalog = {};
    let rank = 0;
    for (const item of res.results) {
      const r = item.resource;
      if (r.kind !== "solver") continue; // kinds 过滤已在引擎侧做，此处兜底（防未来放宽 kinds）
      if (catalog[r.key]) continue; // 同 key 只取最相关的一条（引擎已按分降序）
      const entry: SolverCatalogEntry = {
        capability: capabilityOf(r),
        outputShape: outputShapeOf(r),
        reads: readsOf(r),
        rank: rank++,
      };
      catalog[r.key] = entry;
    }
    return rank > 0 ? catalog : undefined; // 检索空 → 降级（空目录会让导航图恒空，反而更糟）
  } catch {
    return undefined; // fail-open：A 不可达 / 未开通 / 检索异常 → 降级镜像，绝不阻断查询
  }
}
