# WO-QOS-CROSS-DOMAIN · 跨域题留确定性层(②) + LLM 多意图兜底(⑤) 合单

> 合并施工两份 PRD 的**共享后半 + 两个前半 trigger**。目标：跨域复杂问句从"落 82s LLM、只答 top-1"
> 变成"**确定性层秒级拆多 solver 并行答全**（能确定性就零 LLM），确定性没覆盖才 LLM 兜底"。
>
> **必读 PRD**（why 在这里·本单只写 how）：
> - `docs/PRD-deterministic-cross-domain.md`（② 确定性主路·根本解）
> - `docs/PRD-multi-intent-orchestration.md`（⑤ LLM 兜底）

## 🚦 范围边界（只碰这些）
- **改**：`apps/agentcore/src/router/orchestrator.ts`（两插点+分路）· `apps/agentcore/src/router/domain-resolver.ts`（`domainResolveMulti`）· `packages/contracts/src/qos.ts`（`multiIntentPlan` additive）· `apps/datacore/src/features.ts` + `apps/agentcore/src/features/registry.ts`（2 暗发键双注册）· `apps/datacore/src/seed.ts`（可选 demo override）。
- **新建**：`apps/agentcore/src/router/multi-route.ts`（**共享后半**：判定+并行+装配+耦合标）· `apps/agentcore/test/qos-cross-domain-seam.test.ts`。
- **不碰**：solver 数学 / DataCore 求解器本体 / `SCENARIO_CATALOG` / LLM provider 绑定机制 / 前端（复用 step.completed·Timeline 零改）。

## 建法（三步·**先建共享后半·再接两前半**）

### 步 1 · 共享后半（`router/multi-route.ts`）—— ②⑤ 都用它
`runParallelRoutes(routes: RouteSpec[], task, ctx) → Answer`，`RouteSpec = {intentKey, solverKey, args, domain}`：
1. **并行** `invoke_solver`（barrier·单 solver 失败→该路 `{ok:false,reason}`·**不塌整体**·R7）。
2. **确定性块装配（零 LLM·R6）**：每 solver 的 `solver_summary` 投影块（含 KPI/表/规则 + `⟦ref:N⟧`·**复用既有投影不重造**）按域拼**分节答案**（`## <域> …⟦ref⟧`）+ 顶部一句总览。**装配不造跨域新数字。**
3. **耦合诚实标**：查 `solverDepGraph`（静态表·见步 1b）——检出依赖对 → 答案顶部标 **"⚠ 以下子结论各自独立测算·未链式传导（如转拨对延误/外协的影响未计）·完整联合方案见 L3"**。**绝不假装做了耦合综合。**
4. 发 `step.completed` 伪 step（`type=multi_route_dispatch / multi_route_solver / multi_route_synth`·**不新增 §8.2 事件名**·`ontology:check` 保 51/51）。
5. 失败路在答案里诚实标"该部分未计算+原因"·不 hallucinate（R13）。

**步 1b · `solverDepGraph`**（静态声明表·`router/multi-route.ts` 内或旁）：已知 solver 间依赖对（如 `outsourcing_split←capacity_forecast`（残差）·`affected_orders←capacity_forecast`（转拨后产能）·`*←lta_gap`（物料约束））。**只用于步 3 的诚实标**（L1 不真做耦合求解·那是 L3）。

**契约**（`contracts/qos.ts`·additive·可选）：
```ts
export const MultiIntentPlanSchema = z.object({
  routeSource: z.enum(["deterministic-multi-domain", "llm-multi-intent"]),
  selectedIntents: z.array(z.object({ intentKey: z.string(), confidence: z.number(), solverKey: z.string(), slots: z.record(z.unknown()) })),
  parallelResults: z.record(z.string(), z.object({ ok: z.boolean(), durationMs: z.number(), summary: z.string() })),
  coupledPairs: z.array(z.tuple([z.string(), z.string()])),
  synthesisMode: z.literal("deterministic"),   // 本单只做确定性装配(独立子结论不需跨结论推理)
});
// DecisionTraceSchema 追加 multiIntentPlan: MultiIntentPlanSchema.optional()
```

### 步 2 · 前半 A = 确定性多路（PRD② · **主路·零 LLM**）
- `domain-resolver.ts` 新增 `domainResolveMulti(query, pageContext) → DomainRoute[]`：对每个命中的 `DOMAIN_FAMILY`（复用现有 regex）跑**现有单域 route 映射**（ceo-route/block-route pattern·**不新造语义**）→ 逐域 `{domain, solverKey, args, perDomainScore}`。`perDomainScore` **不含** `−0.4 跨域惩罚`（那个 punt 正是要消灭的根·`domain-resolver.ts:41`）。
- `selectDeterministicMultiRoute(routes)`：≥2 域各 `perDomainScore ≥ THRESHOLD(0.6)` **且**各有对口 solver **且**必填槽可填（`fillSlots`）→ 返回多路；任一域无 solver/槽不满/无模式 → 该域不硬凑（诚实 gap 或整体回落 LLM）。
- `orchestrator` 插点：**scenario-bind 之后、单域 WO-QOS-1(`preferDeterministicSolver`)之前/并列** → 命中则 `runParallelRoutes`（`classification.model="deterministic:multi-domain"`·**`agentRequests=0`·不调 classify LLM**）。
- 门：`qos.deterministic-multi-domain`。

### 步 3 · 前半 B = LLM 多意图兜底（PRD⑤ · 确定性没覆盖时）
- `orchestrator` 在 **LLM classify 之后、clarification 之前**：`selectMultiIntent(candidates, slotBag, pageContext)`——≥2 候选 `confidence ≥ tauMid(0.80)`·各必填槽可填·无 scope 冲突·独立性检查 → `runParallelRoutes`（`routeSource="llm-multi-intent"`）。**多意图命中即并行·不反问**（排在澄清前·否则复合题被逼单选）。
- 门：`qos.multi-intent-orchestration`。

## 路由顺序（`orchestrator` · 确定性优先）
```
scenario-bind → [② 确定性多路] → 单域 WO-QOS-1 → CEO/block → LLM classify → [⑤ 多意图兜底] → agent
```

## 门 / feature（双注册 · defaultOn:false）
- `qos.deterministic-multi-domain` + `qos.multi-intent-orchestration`：**datacore `features.ts` + agentcore `features/registry.ts` 双注册**（`reasoningTraceEnabled` 同款 helper：`set==="ALL"`→false·`set.has(key)`）。
- 可选 demo override：`seed.ts seedDemoEntitlements`（灰度演示态开）。
- env：`QOS_MULTI_INTENT_TAU_MID`(0.80)·`QOS_MULTI_INTENT_MAX_INTENTS`(4)。

## SEAM 验收（`qos-cross-domain-seam.test.ts`·**头号判据 = SEAM-2 亲手真跑**）
- **SEAM-1 确定性多路真做**：风控员例 `常州良率掉2%·交期和毛利分别受多大影响` → `deterministic:multi-domain`·`agentRequests=0`·并行 `yield_diagnosis`+`affected_orders`+`margin_attribution`·答案含三域分节 + 各 `⟦ref⟧`。
- **SEAM-2 根治（最重）**：同一跨域题 —— `qos.deterministic-multi-domain` **关** → 走老路 punt LLM classify（有 classify LLM 调用）；**开** → 确定性接住（**0 classify LLM·0 agentRequests**）。**直接证明"跨域题从落 LLM 变留确定性层"。**
- **SEAM-3 LLM 兜底**：确定性没覆盖的跨域题 → classify 出 ≥2 候选 → 并行 → 装配（**非只 top-1**）。
- **SEAM-4 耦合诚实**：Q1 → `coupledPairs` 非空 + 答案含"独立测算·未链式传导"标签·**断言答案不出现"已给出联合/组合方案"措辞**（防假综合）。
- **SEAM-5 partial**：单 solver 失败 → 该节标"未计算+原因"·其余正常·无 hallucinate。
- **SEAM-6 零回归**：两 flag 全关 → 逐字节现行为（单意图 punt LLM 不变）。

## DoD
- 四包 `pnpm -r build && pnpm -r --workspace-concurrency=1 test` 全绿（datacore 勿并发多 vitest）。
- `ontology:check` **51/51 不变**（复用 step.completed·无新事件）。
- a14 evals 不回归（跨域金标从 path-B 慢 → 确定性快·答案不劣化）。
- **审核方头号判据**：**亲手真跑 SEAM-2**（关→LLM·开→确定性接住）+ **亲手用一遍**风控员例看三域答全带溯源。

## 金值 / 派发纪律
- 无新 solver / 事件 / 对象类型 → **不动** golden 计数。
- 一 handoff 分支 `claude/handoff-wo-qos-cross-domain`；dev push 后审核方隔离复验（组合四包 gate + SEAM-2 亲手真跑 + 亲手用一遍）→ cherry-pick 上 canonical。
- **诚实边界必须落测**：无模式的子域诚实 gap/回落·**不硬凑**（SEAM-4）；耦合**不假综合**（SEAM-4）；确定性覆盖靠模式识别·novel 措辞落 LLM 兜底（现 LLM 已非推理·3.6s·非 82s）。
