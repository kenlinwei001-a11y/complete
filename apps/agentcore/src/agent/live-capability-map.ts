import type { IntelligenceResource, PageContext, ResourceSearchRequest, ResourceSearchResponse } from "@platform/contracts";
import type { ToolAuthCtx } from "../tools/clients.js";
import { domainResolve } from "../router/domain-resolver.js";
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

/**
 * 相关性门槛（= `ResourceSearchRequestSchema.minScore` 的契约默认值 0.3）。
 *
 * 为什么必须有门槛：检索**恒返回**排序后的 top-N，分再低也返回。不设门槛 ⇒ 任何问句（哪怕"你好"）
 * 都会被塞进 6 条不相干求解器 —— 那是把"漏 40 条"换成"永远在灌噪声"，并且让下游
 * `buildOntologySemanticContext` 对一堆无关对象类型做真实取数（实测把一次 agent 调用从
 * ~200ms 拖到 ~2s）。改造前"无族信号 ⇒ 不注入"这一条是**对的**，不能丢。
 *
 * 门槛取值有实测依据（test/mock 与真起服务两侧同分布）：
 *   · 无关问句：「三路并查」max 0.219 · 「你好」max 0.245  → 全部 < 0.30 ⇒ 空图（不注入·同改造前）
 *   · 真业务问句：「储能份额为什么没达成目标」top 0.500（11 条 ≥0.30）·「全局联合排产」top 0.405
 * 即 0.30 恰好落在噪声与信号之间。
 *
 * 单独的兜底：**确定性路由选出的对口 solver 无条件保留**（见 `domainResolve`），
 * 防"整体分偏低但确有唯一对口 solver"的题被门槛筛空。
 */
export const LIVE_CAPABILITY_MIN_SCORE = 0.3;

/** 检索取回上限（= 契约 `maxResults` 上限 100·当前求解器全集 59 全覆盖）。
 *  截断由本模块按 `LIVE_CAPABILITY_TOP_N` + 门槛做，故这里要全量：见 fetch 内注释（primary 破例）。 */
const SEARCH_FETCH_LIMIT = 100;

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
  opts: { topN?: number; minScore?: number } = {},
): Promise<SolverCatalog | undefined> {
  if (!source) return undefined; // registry 未装配（features 缺省）→ 降级
  const topN = opts.topN ?? LIVE_CAPABILITY_TOP_N;
  const floor = opts.minScore ?? LIVE_CAPABILITY_MIN_SCORE;
  // 确定性路由选出的对口 solver：无条件保留（即便分低于门槛）——它是"这题该调谁"的另一路判据，
  // 与检索相关性互补。复用 domainResolve 单一来源（同 navigation-slice·R6 纯函数·不另写路由）。
  const primaryKey = domainResolve(query ?? "", pageContext).solverKey;
  try {
    const req = {
      query: query ?? "",
      kinds: ["solver"],
      // ⚠️ 取**全量**而非 topN：截断要在本函数里做，因为 primaryKey 必须破例保留，而它完全可能
      // 排在 topN 之外（实测「SO-3402 提前两周交怎么排…」的对口 sop_reschedule 连前 12 都没进 ——
      // 若按 topN 截断，破例逻辑根本轮不到执行，图里就没有那条真正对口的 solver）。
      // 代价近乎为零：贵的是投影，不是多返几行。
      maxResults: SEARCH_FETCH_LIMIT,
      // 这里取 0：**门槛在下面自己判**，因为要对 primaryKey 破例保留。
      minScore: 0,
      ...(pageContext ? { context: pageContext as unknown as Record<string, unknown> } : {}),
    } as ResourceSearchRequest;
    const res = await source.search(ctx, req);
    const catalog: SolverCatalog = {};
    let rank = 0;
    // 先收对口 solver（无条件·置 rank 0），再按相关性收 topN —— 保证"这题该调谁"永远在图里。
    const primaryHit = primaryKey ? res.results.find((i) => i.resource.key === primaryKey) : undefined;
    if (primaryHit) {
      catalog[primaryHit.resource.key] = {
        capability: capabilityOf(primaryHit.resource),
        outputShape: outputShapeOf(primaryHit.resource),
        reads: readsOf(primaryHit.resource),
        rank: rank++,
      };
    }
    for (const item of res.results) {
      const r = item.resource;
      if (r.kind !== "solver") continue; // kinds 过滤已在引擎侧做，此处兜底（防未来放宽 kinds）
      if (catalog[r.key]) continue; // 同 key 只取最相关的一条（引擎已按分降序·含上面的 primary）
      if (rank >= topN) break; // 相关性 topN 截断（token 预算）
      // 相关性门槛：不达标即不进图——避免无关问句被灌一堆噪声求解器。
      if (item.score < floor) continue;
      const entry: SolverCatalogEntry = {
        capability: capabilityOf(r),
        outputShape: outputShapeOf(r),
        reads: readsOf(r),
        rank: rank++,
      };
      catalog[r.key] = entry;
    }
    // 一条都不达标 → 返 undefined 退降级镜像（而非给一张空图）：空图会让"无族信号"的问句
    // 连镜像那点兜底候选都拿不到，比改造前更差。
    return rank > 0 ? catalog : undefined;
  } catch {
    return undefined; // fail-open：A 不可达 / 未开通 / 检索异常 → 降级镜像，绝不阻断查询
  }
}
