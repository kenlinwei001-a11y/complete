import type {
  IntelligenceResource,
  PageContext,
  ResourceSearchRequest,
  ResourceSearchResponse,
  ResourceSearchResultItem,
} from "@platform/contracts";
import type { ToolAuthCtx } from "../tools/clients.js";
import { domainResolve } from "../router/domain-resolver.js";
import { extractTieredTags } from "../dril/tag-taxonomy.js";
import { lexTokens } from "./skill-router.js";
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
 * ⚠️ **WO-TOOLS-LIST 改判（2026-09-12）：下面这段「裁剪策略」的结论只对了一半，照它读会读出反结论。**
 * 它把「**全文**全量注入不现实」正确地推出，却接着当成了「**目录**也不能全量」——
 * 而这两件事的成本差一个数量级：实测 63 条求解器，capability 全文 = 8,647 字 / 17,529 字节，
 * 截到 40 字的一句话目录 = 3,4xx 字 / 6,6xx 字节。前者确实喂不起，**后者完全喂得起**。
 * 代价是实的：按这个结论，63 个注册求解器里 **57 个模型从未被告知存在**，而它们在权限上全都调得动
 * （`tools/executor.ts` 的 `invoke_solver` 不按候选集限制）—— 卡点从来不是鉴权，是**发现面**。
 * 形态（照 CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『全文注入放不下』当作『目录也放不下』的证据，而前者并不度量后者。」**
 * 现在分两段（标准 MCP 的 tools/list ⊥ 按需详情）：
 *   · 阶段① **全量目录** —— 全部求解器 key + 一句话（tier `"roster"`），无条数上限；
 *   · 阶段② **按需详情** —— 相关性 top-N 展开全文（tier `"detail"`），模型另可
 *     `discover(kind:"solvers", query:<key>)` 自取任意一条的完整参数说明。
 * 下面这段仍然成立 —— 但它现在**只管阶段②**，不再是"模型能看见几个"的上限：
 *
 * **裁剪策略（token 预算·仅限阶段② 详情段）**：全文全量注入不现实（单条 capability 就上百字，
 * 63 条 ≈ 数千 token，且大部分与本题无关 —— 噪声本身会拉低选型质量）。
 * 故按**本题相关性检索 top-N**，N = {@link LIVE_CAPABILITY_TOP_N}：
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
 * **详情段**相关性门槛（= `ResourceSearchRequestSchema.minScore` 的契约默认值 0.3）。
 *
 * 为什么必须有门槛：检索**恒返回**排序后的 top-N，分再低也返回。不设门槛 ⇒ 任何问句（哪怕"你好"）
 * 都会被塞进 6 条不相干求解器 —— 那是把"漏 40 条"换成"永远在灌噪声"，并且让下游
 * `buildOntologySemanticContext` 对一堆无关对象类型做真实取数（实测把一次 agent 调用从
 * ~200ms 拖到 ~2s）。改造前"无族信号 ⇒ 不注入"这一条是**对的**，不能丢。
 *
 * ⚠️ **WO-RELEVANCE-FLOOR 改判（2026-09-12·50 条问句真服务实测）：下面这段旧依据把两件事合成了一句。**
 * 旧文写「0.30 恰好落在噪声与信号之间」——**这句话只在「有信号的那批问句」上成立**，
 * 而它被当成了「0.30 能分辨业务问句与寒暄」。实测这两个命题差得很远：
 *
 *   · `score` 里 **0.11 是与问句完全无关的常数** —— `history`(0.1×0.1) + `cost`(0.1×1.0)，
 *     50 条问句 × 63 个求解器**全部等于 0.11**（`projectSolvers` 不投 quality，运行时质量分表又是空的）。
 *     它占「你好」那 0.245 的 **45%**。
 *   · 余下大头是 `semantic`(权重 0.35) 走 `pseudoEmbed` —— 该函数**源码自述**
 *     "**NOT a production embedding**"（256 维 FNV 字符 uni+bigram 哈希），中文任意两串都有
 *     0.34~0.40 的碰撞基线，且**基线本身随问句长度/用字浮动**（「谢谢，辛苦了」0.204 vs 「你好」0.245）。
 *   · 于是「**你能做什么**」(0.2795) **压过 8 条真业务问句**（0.224~0.279）。
 *     形态（照 CLAUDE.md 铁律 0.6 句式）：
 *     **「我用『总分离 0.30 有多远』当作『这题与求解器有多相关』的证据，而总分里 45% 是常数、
 *     大半是哈希噪声，它并不度量相关性。」**
 *
 * **结论：0.30 这个数没有错，错的是它守的范围。** 它是照**详情段的代价**标定的，
 * 却被 `rank === 0 ⇒ return undefined` 拿去**连目录段一起守**。故本常数**一字不改**，
 * 只把目录段的准入交给 {@link hasBusinessIntent}（见其文档）。
 *
 * 单独的兜底：**确定性路由选出的对口 solver 无条件保留**（见 `domainResolve`），
 * 防"整体分偏低但确有唯一对口 solver"的题被门槛筛空。
 */
export const LIVE_CAPABILITY_MIN_SCORE = 0.3;

/**
 * **目录段**准入的词法熟悉度下限：至少这么多个求解器"认得"问句里的词。
 *
 * ⚠️ 这是本单引入的**唯一**常数，实测依据（50 条问句·真起服务·见
 * `docs/AUDIT-relevance-distribution-20260912.md` 分布表）：
 *   · 寒暄/元问题 14 条：熟悉求解器数 **最大 2**（`{0×11, 1×2, 2×1}`·均值 0.29）
 *   · 真业务问句 36 条：**中位数 12.5**，36 条里只有 1 条 < 3
 * 两类之间 2↔3 是一条**空带**，不是我挑的分位点。
 *
 * 语义上它问的是：**"这句话里有没有本平台的业务词汇"** —— 一个偶然撞上的 token 只会让 1~2 个
 * 求解器"认得"（实测「今天天气怎么样」=2、「你是谁」=1），而真业务词（订单/产能/物料/库存/成本…）
 * 天然被一大批求解器的描述共享。要求 ≥3 就是滤掉这种**单 token 偶然碰撞**。
 */
export const LEX_FAMILIAR_MIN_SOLVERS = 3;

/**
 * 检索取回上限（= 契约 `maxResults` 上限 100）。
 * 截断由本模块按 `LIVE_CAPABILITY_TOP_N` + 门槛做，故这里要全量：见 fetch 内注释（primary 破例）。
 *
 * WO-TOOLS-LIST：阶段① 全量目录也吃这一份结果 ⇒ **本常数现在是"模型能看见几个求解器"的真上限**。
 * 实测 `ALL_SOLVER_CATALOG` = **63 条**（PIN 树·真数组 length，不是 grep 数的 60、也不是正则数的 62），
 * 100 > 63 有余量；逼近 100 时目录会**静默**变成"前 100 名"而不再是全集 —— 那正是本单要治的病换个数字复发。
 * 故 `capability-map-live-seam.test.ts` 有一条断言盯着 `全集条数 < SEARCH_FETCH_LIMIT`，
 * 越线是机器先说话，不靠人想起来。
 */
export const SEARCH_FETCH_LIMIT = 100;

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

/** 资源的语义候选文本（与 `dril/search-engine.ts` 的 `semanticCandidates` 同一组字段·保持一致）。 */
function lexCandidates(r: IntelligenceResource): string[] {
  const out: string[] = [r.description, r.label];
  if (r.capability) out.push(r.capability);
  for (const q of r.answersQuestions ?? []) out.push(q);
  for (const q of r.suitableQuestions ?? []) out.push(q);
  if (r.tags && r.tags.length > 0) out.push(r.tags.join(" "));
  return out.filter(Boolean);
}

/** "认得这句话里的词"的求解器数：与问句至少共享一个词法 token 的资源条数（R6 纯函数）。 */
function familiarSolverCount(query: string, items: readonly ResourceSearchResultItem[]): number {
  const qt = lexTokens(query ?? "");
  if (qt.size === 0) return 0;
  let n = 0;
  for (const item of items) {
    if (item.resource.kind !== "solver") continue;
    let hit = false;
    for (const c of lexCandidates(item.resource)) {
      const ct = lexTokens(c);
      for (const t of qt) {
        if (ct.has(t)) { hit = true; break; }
      }
      if (hit) break;
    }
    if (hit) n++;
  }
  return n;
}

/**
 * **目录段**准入：这条问句问的是不是"经营上的事"。
 *
 * 为什么目录段该有自己的判据，而不是跟着详情段的 {@link LIVE_CAPABILITY_MIN_SCORE} 走 ——
 * **两段的代价差一个数量级，而且贵的那部分实测与目录段无关**：
 *   · **详情段**贵：能力全文 + 它的 `reads` 会进 `NavigationSlice.objectTypes`
 *     → `selectSemanticTypeKeys` → `buildOntologySemanticContext` **真取数**（200ms→2s 那条路）。
 *   · **目录段**便宜：key + 一句话。`projectNavigationSlice` 算 `objectTypes` 时
 *     **只遍历 `solverKeys`（详情段·≤MAX_SOLVERS）**，`roster` 一条都不进 —— 故目录段
 *     **零额外取数、零额外往返**（它吃的就是详情段那一次 `search` 的同一份结果）。
 *     且它按 key 字典序渲染 ⇒ 同租户逐字节相同 ⇒ 可被 prompt 缓存命中。
 *
 * 判据由**三路既有信号**取并集，阈值除下面那一个熟悉度下限外**全是"非零"**（不是调出来的分位点）：
 *   ① `extractTieredTags(query)` 非空 —— 与检索引擎**同一个**抽取器，问句自带业务标签；
 *   ② 有求解器在 `domain` / `ontology` 两个**真·查询相关**子分上非零
 *      （`semantic` 刻意不算：它就是那个 0.34~0.40 的哈希噪声源；`history`/`cost` 更不算：恒定 0.11）；
 *   ③ 词法熟悉度 ≥ {@link LEX_FAMILIAR_MIN_SOLVERS}。
 * （确定性路由 `domainResolve` 命中的情况不在此判 —— 那条已在上游无条件进详情段，`rank>0` 直接放行。）
 *
 * **实测（50 条问句·真起 datacore+agentcore·SEED_DEMO=1·分布表见
 * `docs/AUDIT-relevance-distribution-20260912.md`）**：
 *   · 真业务问句 **35/36 放行**（今天的门槛只放行 28/36）
 *   · 寒暄/元问题 **0/14 放行**（"你好"/"你能做什么"/"帮我写首诗"… 一条都没漏）
 * 三路**各自**在 14 条寒暄上都是零误放，并集仍是零 —— 这就是敢并的依据。
 *
 * R6：三路全是纯函数（正则/关键词/集合交），无 `Date.now`、无随机、无 LLM。
 */
export function hasBusinessIntent(query: string, items: readonly ResourceSearchResultItem[]): boolean {
  // ① 问句自带业务标签（L1 域 / L2 决策类型 / L3 场景 / L5 算法）。
  const tags = extractTieredTags(query ?? "", {});
  for (const layer of Object.values(tags)) if ((layer ?? []).length > 0) return true;
  // ② 有求解器拿到非零的业务域 / 本体子分（这两项才是随问句动的判别项）。
  for (const item of items) {
    const b = item.scoreBreakdown;
    if ((b?.domain ?? 0) > 0 || (b?.ontology ?? 0) > 0) return true;
  }
  // ③ 词法熟悉度（最贵的一路，故放最后 —— 前两路命中时根本不会算到这里）。
  return familiarSolverCount(query ?? "", items) >= LEX_FAMILIAR_MIN_SOLVERS;
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
    // ── 阶段②「详情」：先收对口 solver（无条件·置 rank 0），再按相关性收 topN ──
    // 展开成本高（能力全文 + 输出形状 + 下游还会为它的对象类型做真实取数），故必须有窗口。
    const primaryHit = primaryKey ? res.results.find((i) => i.resource.key === primaryKey) : undefined;
    if (primaryHit) {
      catalog[primaryHit.resource.key] = {
        capability: capabilityOf(primaryHit.resource),
        outputShape: outputShapeOf(primaryHit.resource),
        reads: readsOf(primaryHit.resource),
        rank: rank++,
        tier: "detail",
      };
    }
    for (const item of res.results) {
      const r = item.resource;
      if (r.kind !== "solver") continue; // kinds 过滤已在引擎侧做，此处兜底（防未来放宽 kinds）
      if (catalog[r.key]) continue; // 同 key 只取最相关的一条（引擎已按分降序·含上面的 primary）
      if (rank >= topN) break; // 相关性 topN 截断（token 预算）
      // 相关性门槛：不达标即不进**详情段**——避免无关问句被灌一堆噪声求解器全文。
      if (item.score < floor) continue;
      const entry: SolverCatalogEntry = {
        capability: capabilityOf(r),
        outputShape: outputShapeOf(r),
        reads: readsOf(r),
        rank: rank++,
        tier: "detail",
      };
      catalog[r.key] = entry;
    }
    // ── 详情段一条都不达标 ──────────────────────────────────────────────────
    // ⚠️ **WO-RELEVANCE-FLOOR 改判**：旧代码这里直接 `return undefined`，于是**目录段陪葬**。
    // 旧注释说"无关问句本就不该被灌 60 行目录"——这半句对；错的是它把
    // 「没有求解器跨过**详情段**门槛」当成了「这题不是经营问题」的证据。实测这两件事差得很远：
    // 50 条问句里 **8 条真业务问句**（「常州这批成品要发出去，怎么装柜最省运费」0.2496 /
    // 「手上这些单子按什么顺序做最划算」0.2542 / 「哪条线最闲，能不能匀点活过去」0.2516 …）
    // 全员低于 0.30 ⇒ **模型拿到 0 个求解器**；而同一把尺子下「**你能做什么**」拿 0.2795，
    // **比这 8 条都高**。门槛分不开它们，是因为它量的根本不是相关性（见 LIVE_CAPABILITY_MIN_SCORE 文档）。
    //
    // 故此处分两步，**不动 0.30，也不放宽它**：
    if (rank === 0) {
      // (a) 先问"这题是不是经营上的事"——三路既有信号，14 条寒暄零误放（见 hasBusinessIntent）。
      //     不是 ⇒ 维持原样 `undefined`（"你好"仍然**零注入**，两段都不给）。
      if (!hasBusinessIntent(query ?? "", res.results)) return undefined;
      // (b) 是经营问句、却全员低于详情门槛 ⇒ 把**检索第 1 名**提进详情段。
      //     为什么恰好 1 条：① "第 1 名"是名次不是阈值，不引入第二个魔数；
      //     ② 代价有界 —— 只有这 1 条的 `reads` 会进 objectTypes → buildOntologySemanticContext，
      //        与一次普通查询同量级，远低于 topN=12 全展开；
      //     ③ 检索的**排序**比它的**绝对分**可信得多：实测「…怎么装柜最省运费」的对口
      //        `packing_optimize` 正是第 1 名（63 选 1），只是绝对分 0.2496 够不着 0.30。
      const top = res.results.find((i) => i.resource.kind === "solver");
      if (!top) return undefined; // 检索空 → 仍退降级镜像（fail-open 不变）
      catalog[top.resource.key] = {
        capability: capabilityOf(top.resource),
        outputShape: outputShapeOf(top.resource),
        reads: readsOf(top.resource),
        rank: rank++,
        tier: "detail",
      };
    }

    // ── WO-TOOLS-LIST · 阶段①「全量目录」：剩下的**全部**求解器进目录层（tier="roster"） ──
    // 病根（本单实测）：改造前这里一返回就只剩 ≤12 条，下游再截到 6 —— 63 个注册求解器中
    // **57 个模型从未被告知存在**。而检索按问句相关性排序 ⇒ 冷门求解器天然排不进窗口
    // ⇒ 没有使用记录 ⇒ 更排不进：**自锁**。把上限从 6 调到 63 只是把锁推后（80 个时复发），
    // 两段式才是拆锁：目录轻（key + 一句话）· 详情按需（模型自己 discover 二次取）。
    // ⚠️ 不重新打一次检索、不放宽 minScore —— 这里用的就是上面那一次 `search` 的**同一份结果**
    //    （`maxResults` 已取 SEARCH_FETCH_LIMIT 全量），零额外往返、零额外延迟。
    for (const item of res.results) {
      const r = item.resource;
      if (r.kind !== "solver") continue;
      if (catalog[r.key]) continue; // 已在详情段
      catalog[r.key] = {
        capability: capabilityOf(r),
        outputShape: outputShapeOf(r),
        reads: readsOf(r),
        tier: "roster", // 无 rank：目录段按 key 字典序渲染（R6·不按热度，见 navigation-slice）
      };
    }
    return catalog;
  } catch {
    return undefined; // fail-open：A 不可达 / 未开通 / 检索异常 → 降级镜像，绝不阻断查询
  }
}
