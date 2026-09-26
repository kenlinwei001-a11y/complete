# WO-QOS-CROSS-DOMAIN-UNIFIED · 跨域编排统一单（②确定性多路 + ⑤多意图兜底 + Coordinator 降级）

> **本单取代** `WO-QOS-CROSS-DOMAIN.md`（旧·引两份已作废 PRD）。**一个 dev 整单做**（跨数据/引擎两半特性，铁律禁拆两半）。
>
> **必读 PRD（why 在这里·本单只写 how）**：`docs/PRD-qos-cross-domain-unified.md`
> —— 尤其 **§3.7**（对照另外两版补充 PRD 的「采哪些/拒哪些/为什么」，5 个坑逐条钉死）。
>
> **一句话目标**：跨域复杂问句（Q1/Q2）从「落 Coordinator 黑洞烧 5 分钟 / 落慢 LLM 只答 top-1」
> → 变成「**确定性层秒级拆多 solver 并行答全**（能确定性就零 LLM），确定性没覆盖才 LLM 兜底」。

---

## 0. 🚦 起手式 · base 分支（**先 fetch 再开·这坑已炸 4 次**）

**必须从远端最新 canonical 开分支，别从本地旧 ref：**
```bash
git fetch origin claude/inspiring-gates-aqczjg
git checkout -B claude/handoff-wo-qos-cross-domain-unified origin/claude/inspiring-gates-aqczjg
```
该 base **已含**你之前反馈「不存在」的所有件：`isCapacityFeasibilityQuery`(sim-planner.ts:266·S01) / harness 七要素提示词(prompts.ts:22-28) / providerAvailable / capacity-factors(byProcessModel)。**旧 base `85a99f04` 落后 74 个 commit**——从它开就会再次「找不到 S01」。

**salvage（省一半功）**：以已作废的 `handoff-wo-det-cross-domain` 的 `router/multi-route.ts` 为**后半基底**（它已有 `domainResolveMulti` + `runParallelRoutes` + `routeSource` 契约雏形），在其上补本单 §3 两件事。**其 `migrations/010_multi_intent_plan.sql` 独立表不要**（见 §4·multiIntentPlan 随 DecisionTrace 持久化·无需新表）。

---

## 1. 🚦 范围边界（只碰这些文件）

**改**
- `apps/agentcore/src/router/domain-resolver.ts` —— 扩 `DOMAIN_FAMILIES` + 新增 `domainResolveMulti` / `selectDeterministicMultiRoute`
- `apps/agentcore/src/router/coordinator.ts` —— `planCoordination` 加**第二道降级**（紧跟 `:74` 那道 `isCapacityFeasibilityQuery→undefined`）
- `apps/agentcore/src/router/orchestrator.ts` —— ② 插点（Coordinator 门 `:478` **之前**）+ ⑤ 插点（classify 之后）
- `packages/contracts/src/qos.ts` —— **一份** `MultiIntentPlanSchema`（additive）+ `DecisionTrace.multiIntentPlan?`
- `apps/datacore/src/features.ts` + `apps/agentcore/src/features/registry.ts` —— 2 暗发键双注册
- `apps/datacore/src/seed.ts` —— 可选 demo override（灰度演示态开）

**新建**
- `apps/agentcore/src/router/multi-route.ts` —— **共享后半**（②⑤ 都用·salvage det-cross-domain 那份为基）
- `apps/agentcore/test/qos-cross-domain-seam.test.ts` —— SEAM 门

**不碰**
- solver 数学 / DataCore 求解器本体 / `SCENARIO_CATALOG` / LLM provider 绑定机制 / 前端（复用 `step.completed`·Timeline 零改）
- **不新建** `domain-keyword-matrix.ts`（§3.7 拒·第三张关键词表 = 铁律「不同机制不对接」老炸点）
- **不加**新 §8.2 事件名（复用 `step.completed`·保 `ontology:check` 51/51）
- **不加**新迁移表 / 不加 solver 结果缓存 / 不硬编码路由 / 不让 LLM 算数

---

## 2. 现状锚点（file:line·先看清再动）

| 锚点 | 位置 | 说明 |
|---|---|---|
| 路由顺序 | `orchestrator.ts:458→478→488` | `scenario-bind → Coordinator门 → domainResolve(单域)`。**Q2 根因 = Coordinator(:478) 在 domainResolve(:488) 之前抢走跨域题** |
| Coordinator 触发 | `coordinator.ts:22-26` ROLE_KEYWORDS | 已认 `长协→供应链`/`涂布→生产`/`良率→质量`；Q2 三词共现→`matched.size=3≥2`(:91)→扇出 3 agent 烧 300s |
| **既有降级先例** | `coordinator.ts:74` | `isCapacityFeasibilityQuery(q)→undefined`（S01）——**本单第二道降级紧跟其后·同款机制** |
| 域族表 | `domain-resolver.ts:31-37` | 只 5 域（信用/毛利/供需/ATP/重排）·**不含 Q2 域**（良率/产出/长协/延误/外协）→ 必须扩 |
| 跨域压分 | `domain-resolver.ts:80` | `domainFamilies>=2 → −0.4`·`domainResolveMulti` 的 `perDomainScore` **不含**这惩罚 |
| solver 金名 | `datacore service.ts:36-58` | 真名 `yield_diagnosis`/`capacity_forecast`/`lta_gap`/`affected_orders`/`outsourcing_split`/`quarterly_gap`（**别写 `_q` 后缀·那是场景意图 key**） |

---

## 3. 建法（三步 · 先建共享后半 · 再接两前半 + 降级）

### 步 1 · 共享后半 `router/multi-route.ts`（②⑤ 都用它）
`runParallelRoutes(routes: RouteSpec[], task, ctx) → Answer`，`RouteSpec = {intentKey, solverKey, args, domain}`：
1. **并行** `invoke_solver`（barrier·单 solver 失败→该路 `{ok:false,reason}`·**不塌整体**·R7）。
2. **确定性块装配（零 LLM·R6）**：每 solver 的 `solver_summary` 投影块（KPI/表/规则 + `⟦ref:N⟧`·**复用既有投影不重造**）按域拼分节答案 + 顶部一句总览。**装配不造跨域新数字。** —— **默认 `synthesisMode="deterministic"`**；compose LLM 只做**默认关的埋点**（§3.7 拒「强制 compose」·防假综合 KILL-MOCK-RED）。
3. **耦合诚实标**：查 `solverDepGraph`（静态表·步 1b）→ 检出依赖对 → 顶部标 **"⚠ 各子结论独立测算·未链式传导（如转拨对延误/外协影响未计）·完整联合方案见 L3"**。**绝不假装做了耦合综合。**
4. 发 `step.completed` 伪 step（`type=multi_route_dispatch/multi_route_solver/multi_route_synth`·**不新增事件名**）。

**步 1b · `solverDepGraph`**（静态声明表）：已知 solver 依赖对（`outsourcing_split←capacity_forecast`残差·`affected_orders←capacity_forecast`转拨后产能·`*←lta_gap`物料约束）。**只用于步 3 诚实标**（L1 不真做耦合·那是 L3）。

### 步 2 · 前半 A = ② 确定性多路（**主路·零 LLM**）
- **扩 `DOMAIN_FAMILIES`（单一真值源·治缺口④）**：在现表追加 Q2 缺的域族 + 各自 route→solverKey 映射（沿用 ceo-route/scenarios-catalog 既有 route 名·不新造语义）：
  - `良率/合格率/CPK/一致性 → yield_diagnosis`
  - `有效产出/产出/OEE/涂布/卷绕 → capacity_forecast`
  - `长协/覆盖/齐套/缺口 → lta_gap`
  - `延误/受影响/交期 → affected_orders`
  - `外协/加班/补缺口 → outsourcing_split`
- `domainResolveMulti(query, pc) → DomainRoute[]`：逐域枚举·`perDomainScore` **去 −0.4 跨域惩罚**·R6 纯函数。
- `selectDeterministicMultiRoute(routes)`：≥2 域各 `perDomainScore ≥ THRESHOLD(0.6)` **且**各有对口 solver **且**必填槽可填（`fillSlots`）→ 多路；任一不够格 → 该域不硬凑（诚实 gap 或整体回落）。**"槽可填"是硬门**（只认词不校验槽 = 绕开后建不出 args = 更差）。
- `orchestrator` 插点：**Coordinator 门(:478) 之前** → 命中 `runParallelRoutes`（`classification.model="deterministic:multi-domain"`·**`agentRequests=0`·不调 classify LLM**）。
- 门：`qos.deterministic-multi-domain`。

### 步 3 · Coordinator 降级（**Q2 关键修复**·紧跟 coordinator.ts:74）
`planCoordination` 在 `isCapacityFeasibilityQuery→undefined` 之后加**同款一道**：
```
若 selectDeterministicMultiRoute(该题) 能拆 ≥2 solver 路（各有真 solver + 槽可填）→ return undefined（让位 ②）
```
- 即 orchestrator 在 Coordinator 门**先试 ②**；② 命中就走 ②、**根本不进 Coordinator**；② 不命中才 `runCoordinator`。
- **只用 `selectDeterministicMultiRoute` 这一个判据**（§3.7 拒「命中多域关键词就无脑 bypass·默认开」）——保住「真开放无 solver 锚」的会诊题仍归 Coordinator。
- 暗发兼容：`qos.deterministic-multi-domain` 关 → Coordinator 逐字节不变（现状）。

### 步 4 · 前半 B = ⑤ LLM 多意图兜底（确定性没覆盖时）
- `orchestrator` **classify 之后、clarification 之前**：`selectMultiIntent(candidates, slotBag, pc)`——≥2 候选 `confidence≥tauMid(0.80)`·各槽可填·无 scope 冲突 → `runParallelRoutes`（`routeSource="llm-multi-intent"`）。**多意图命中即并行·不反问**（排在澄清前）。
- 门：`qos.multi-intent-orchestration`。

**路由顺序（改后）**
```
scenario-bind → [② 确定性多路] → Coordinator【降级·让位②】 → 单域 WO-QOS-1 → CEO/block → LLM classify → [⑤ 多意图兜底] → agent
```

---

## 4. 契约（**合一·消重复·无新表**）
`qos.ts` **只留一份** `MultiIntentPlanSchema`（additive·可选）：
```ts
export const MultiIntentPlanSchema = z.object({
  routeSource: z.enum(["deterministic-multi-domain", "llm-multi-intent"]),
  selectedIntents: z.array(z.object({ intentKey: z.string(), confidence: z.number().optional(), solverKey: z.string(), slots: z.record(z.unknown()) })),
  parallelResults: z.record(z.string(), z.object({ ok: z.boolean(), durationMs: z.number(), summary: z.string() })),
  coupledPairs: z.array(z.tuple([z.string(), z.string()])),
  synthesisMode: z.literal("deterministic"),
});
// DecisionTraceSchema 追加 multiIntentPlan: MultiIntentPlanSchema.optional()
```
**无新迁移表**：`multiIntentPlan` 是 `DecisionTrace` 上的可选字段，随既有 DecisionTrace 持久化管线走（memory spread 自动 · pg 已有 trace 列）。**删掉 salvage 分支带来的 `migrations/010_multi_intent_plan.sql`。**

## 5. 门 / feature（双注册 · defaultOn:false）
- `qos.deterministic-multi-domain` + `qos.multi-intent-orchestration`：datacore `features.ts` + agentcore `features/registry.ts` 双注册（`reasoningTraceEnabled` 同款 helper：`set==="ALL"`→false·`set.has(key)`）。
- 可选 demo override：`seed.ts seedDemoEntitlements`（灰度演示态开）。
- env：`QOS_MULTI_INTENT_TAU_MID`(0.80)·`QOS_MULTI_INTENT_MAX_INTENTS`(4)。

---

## 6. SEAM 验收（`qos-cross-domain-seam.test.ts` · **头号判据 = SEAM-Q2 亲手真跑**）

1. **SEAM-Q2（新·最重·治 5 分钟）**：提交 Q2（`常州 4680-NCM 涂布良率↓2%·未来4周有效产出↓5%·7月三元长协覆盖70%·哪些订单延误·外协还是加班`）
   → **不进 Coordinator**（无 `coordinator.planned`·`classification.model=deterministic:multi-domain`）·`agentRequests=0`
   → 并行 `yield_diagnosis`+`capacity_forecast`+`lta_gap`+`affected_orders`+`outsourcing_split` 中 **≥3**·秒级出分节答案带 `⟦ref⟧`·耦合诚实标。
   **对照：flag 关 → 走老路进 Coordinator（证明修的就是这条）。**
2. **SEAM-1（Q1/独立多域）**：风控员例 `常州良率掉2%·交期和毛利分别受多大影响` → `deterministic:multi-domain`·`agentRequests=0`·并行 3 solver·三域分节 + 各 `⟦ref⟧`。
3. **SEAM-2（根治）**：同一跨域题 flag 关→落 LLM/Coordinator·开→确定性接住（**0 classify LLM·0 agentRequests**）。直接证明「跨域题从落 LLM 变留确定性层」。
4. **SEAM-3（⑤兜底）**：确定性没覆盖的跨域题 → classify 出 ≥2 候选 → 并行（**非只 top-1**）。
5. **SEAM-4（耦合诚实）**：Q1/Q2 → `coupledPairs` 非空 + 标"独立测算·未链式传导"·**断言不出现"已给联合/组合方案"措辞**（防假综合）。
6. **SEAM-5 partial**：单 solver 失败 → 该节标"未计算+原因"·其余正常·无 hallucinate。
7. **SEAM-6 零回归**：两 flag 全关 → 逐字节现行为（**含 Coordinator 行为不变**）。

## 7. DoD（交付底线）
- 四包 `pnpm -r build && pnpm -r --workspace-concurrency=1 test` 全绿（datacore 勿并发多 vitest·= 别同时起多个 datacore vitest 进程）。
- `ontology:check` **51/51 不变**（复用 step.completed·无新事件）。
- a14 evals 不回归（跨域金标从 path-B 慢 → 确定性快·答案不劣化）。
- **审核方头号判据**：**亲手真跑 SEAM-Q2**（关→Coordinator·开→确定性秒答）+ 亲手用一遍风控员例看三域答全带溯源。

## 8. 金值 / 派发纪律
- **无新 solver / 事件 / 对象类型 → 不动 golden 计数**（demo-chain/catalog/ontology-core 不改）。
- 一 handoff 分支 `claude/handoff-wo-qos-cross-domain-unified`；push 后审核方隔离复验（组合四包 gate + SEAM-Q2 亲手真跑）→ cherry-pick 上 canonical。
- **诚实边界必须落测**：无模式的子域诚实 gap/回落·不硬凑（SEAM-4）；耦合不假综合（SEAM-4）。
- **作废清理**：`handoff-wo-det-cross-domain`（②旧）+ `handoff-wo-multi-intent-p1`（⑤旧）并入本单后删·别再单独并。

## 9. 非目标（钉死·别顺手做）
- ❌ 耦合联合求解（转拨→产能→延误→外协依赖链·**L3**·`solve_portfolio` 守恒）——独立域并行·耦合诚实标。这是 Q1/Q2 的真组合方案，**单列 P3**。
- ❌ DataCore SolverContext 按需加载（`requiredObjectTypes`）——**另一张 datacore 性能 P2 单**，不在本单。
- ❌ 分类器提速——已完成（非推理模型·commit 274d02b7）。
