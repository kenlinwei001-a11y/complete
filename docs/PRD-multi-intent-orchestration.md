# PRD · 跨域/多意图问句编排（L1 独立多意图 · L2/L3 路线图）

> **一句话**：一个复杂问句里若含**多个相互独立**的子问题，平台应**同时**跑对口的多个 solver、把各自 grounded 的结论
> **拼成一份带溯源的综合答案**——而不是只答置信度最高的那一个，也不是频繁反问用户。
>
> **诚实边界（本 PRD 的灵魂·别跳过）**：本期只做**独立**多意图。**耦合**型复杂推演（如"转 30% 给宜宾 → 改产能 →
> 改哪些订单延误 → 改外协需求"这种**依赖链**）**不在本期**——它需要联合求解（L3·复用 `solve_portfolio` 守恒），
> 拿并行独立 solver 硬做只会得到"数字各自对、合起来不勾稽"的**假综合**（绿测试≠能用）。本 PRD 把这条钉死。

---

## 0. 本体引用与影响（强制 · 已完整读 `docs/SYSTEM-ONTOLOGY.md`）

- **对象类型**（§2H 交互/编排域）：`Task/Query`、`Intent`（分类器 `candidates[]`）、`ExecutionPlan`、`Solver`、`Answer`。**无新增对象类型**。
- **链路**（§3 编排链）：现状 `classify → top-1 candidate → proceedWithIntent → path-A(single solver)`；
  本 PRD 插入 `classify → 多候选(独立·槽可填·无冲突) → 并行 invoke_solver → 确定性块装配综合 → Answer`
  ——**插点在 top-1 路由 _与_ 澄清(clarification)之前**（否则澄清会把多意图逼成单选）。
- **事件**（§4 / §8.2）：**不新增事件名**——复用 `step.completed` 伪 step（`type=multi_intent_dispatch / multi_intent_solver / multi_intent_synthesis`），
  与 `agent_degraded` 同款做法（`ontology:check` 保 51/51·前端 TaskDetail 零改）。⚠ **修正原稿**：原 PRD 拟加 `multi_intent.executed/synthesized`
  两个 §4 事件——违"不新增 §8.2 事件名"惯例且触发 `ontology:check` 漂移红，改为复用伪 step。
- **不变量**（§5）：
  - **R6 确定性**：多意图判定为纯函数（`candidates × slotBag × 依赖表 → 选中集`·无随机/时钟）；**确定性块装配零 LLM**、亦确定。
  - **R13 结论可溯源 / 真推演 not 假推演**：每个子结论保留**独立** `toolCalls` + `⟦ref:N⟧`；综合答案**顶部诚实标**"以下 N 个子结论各自**独立**测算·未相互耦合"（若检出耦合对→标记）。
  - **R3 entitlement 先于 authz**：暗发 `qos.multi-intent-orchestration`（defaultOn:false·逐步灰度）；关=逐字节沿用现单意图路径。
  - **R7 错误信封 / R2 tenant**：并行 solver 单失败不塌整体（partial）；失败子意图诚实标"该部分未计算+原因"，不 hallucinate。
- **断点**（§8）：
  - **G-PORTFOLIO-LOCAL-ONLY**（逐个求解→只到局部最优·无联合）：**本 PRD 只对"独立"子意图安全**；**耦合子意图正是此断点**——L1 诚实标"独立非耦合"、**不假装做了联合**，真解在 **L3**（复用 `solve_portfolio` 共享产能守恒）。
  - **G-DECISION**（多方案+比对+触发行动）：多意图综合是其近亲·可后续融合。
- **回写**：§3 编排链加"多意图分路"节点；新增 feature 键回写 §2.G/features.ts。**无 §4 事件变更**（复用 step.completed）。

---

## 1. 目标 / 非目标

### 目标
1. **多独立子意图并行答全**：一个问句含 ≥2 个**相互独立**、槽位可分别抽满的子意图 → 并行跑对口 solver → 综合成一份带溯源答案。
2. **不再只答 top-1**、**不再把复合题逼成澄清单选**。
3. **诚实分层**：独立多意图（本期）与耦合联合推演（L3）**明确切开**，L1 绝不假装做了 L3。

### 非目标（本期不做·钉死）
- ❌ **耦合链式推演**（转拨→产能→延误→外协的依赖传导）——**L3**，需联合求解（`solve_portfolio` 守恒），本期只诚实标"独立非耦合"。
- ❌ **真 NL 全分解**（找回分类器**漏掉**的子意图·如 Q1 的 `capacity_forecast`）——**L2**，本期只跑分类器**已吐出**的候选。
- ❌ **solver 结果缓存**（收益 50ms→1ms·却破 R13 新鲜/溯源·原 PRD 已正确否决·此处重申）。
- ❌ **改 DataCore 求解器数学** / **加 LLM 用途枚举**（§3 purpose 枚举固定不可扩展·综合复用 `compose`）。

---

## 2. 现状与缺口（对照代码 · file:line）

- 现状：`orchestrator.ts` 分类后取 **top-1** → `proceedWithIntent` → path-A 单 solver（阈值 `:~549`·单意图路由 `:~572`·场景直路 `:~434`）。
- 实测铁证（`docs`/测试复盘）：
  - **Q1**（`常州 4680-NCM 缺口8万·转30%给宜宾·长协65%·哪些订单延误·补多少外协/加班`）：只跑了 `outsourcing_q`；**分类器候选压根不含 `capacity_forecast`**（Kimi 给 outsourcing_q/affected_orders/lta_gap_q；Moonshot 给 affected_orders/outsourcing_q/quarterly_gap_q）→ **候选就不全**。
  - Moonshot 分类置信度分散（0.95/0.85/0.8）→ **触发 `AWAITING_CLARIFICATION`**（把多意图逼成单选）。
- 缺口：① 无多候选并行；② 澄清抢在多意图之前；③ 即便并行，**Q1 是耦合的**——并行独立跑数字不勾稽（G-PORTFOLIO-LOCAL-ONLY）。

---

## 3. 设计（复用现有接缝优先）

### 3.1 分层与分期（诚实切开——本 PRD 的骨架）
| 层 | 做什么 | 本 PRD | 旗舰验收例 |
|---|---|---|---|
| **L1 独立多意图** | 跑分类器**已吐**的多个高置信候选（槽可填·无冲突·**独立**）→ 并行 → **确定性块装配** | ✅ **P1（本期）** | **风控员例**（下 §5·真独立） |
| **L2 真分解** | 补分类器**漏掉**的子意图（NL→子问→solver，如 Q1 的 capacity_forecast） | 🗺 路线图 | — |
| **L3 耦合联合求解** | 依赖链传导（转拨→产能→延误→外协）·联合守恒 | 🗺 路线图 | **Q1**（真耦合·本期只诚实标） |

### 3.2 多意图判定（纯函数 R6·`router/multi-intent.ts` 新建·插在 top-1 路由 **和 clarification 之前**）
`selectMultiIntent(candidates, slotBag, pageContext, solverDepGraph) → { selected: SelectedIntent[], coupledPairs: [k1,k2][] } | null`：
1. **多候选**：≥2 候选 `confidence ≥ tauMid`（默认 0.80·`QOS_MULTI_INTENT_TAU_MID`）。
2. **槽位可满足**：每个入选意图的**必填槽**能从共享 `slotBag`（分类器抽出的富槽包）+ pageContext 抽满——**抽不满即丢弃该意图**（绝不带缺槽跑出错答）。这是"slot independence"的正确落法。
3. **无 scope 冲突**：入选意图的 solver 无对象/资源 scope 冲突。
4. **独立性检查（关键·治 G-PORTFOLIO）**：查 `solverDepGraph`（solver 间已知依赖：如 `outsourcing_split` 依赖 `capacity_forecast` 的残差、`affected_orders` 依赖转拨后产能）——
   - 入选集**两两无依赖边** → 纯独立 → 正常并行。
   - 检出**依赖对** → 标进 `coupledPairs` → **L1 仍并行跑**（各用原始输入）**但综合答案诚实标注"该组子结论存在耦合·本期独立测算未链式传导·完整联合方案见 L3"**——**绝不假装做了耦合**。
5. **上界**：`MAX_INTENTS`（默认 4·`QOS_MULTI_INTENT_MAX_INTENTS`）。
6. 命中 → `runMultiIntentPath`；否则 return null → **逐字节沿用现单意图路径**（byte-compat）。
7. **排序铁律**：本判定**先于** clarification——多意图命中即并行，不反问；未命中才走既有澄清逻辑。

### 3.3 并行 solver（barrier·各独立 args·单失败不塌）
- 每个入选意图**从 slotBag 独立生成** `invoke_solver` args（槽→solver 映射：`affected_orders←baseId`·`margin_attribution←baseId/metricKey`·`yield_diagnosis←baseId` …）。
- 并行执行（`parallel`）；单 solver 失败 → 该子意图标 `{ok:false, reason}`，**不影响其余**（R7·partial）。

### 3.4 综合 = **确定性块装配（零 LLM 地板）** + 可选 compose 润色 —— **这一节解决原稿的延迟矛盾**
**核心洞察：综合方法由"独立性"决定——独立子结论只需"摆放"，不需"跨结论推理"。**
- **地板（默认·R6·零 LLM·<50ms）**：每个子 solver 的 `solver_summary` 块（含 KPI/表/规则依据 + `⟦ref:N⟧`·**既有投影·不重造**）按域拼成**分节答案**：`## 受影响订单 …⟦ref:0⟧ / ## 长协缺口 …⟦ref:1⟧ / ## 外协加班 …⟦ref:2⟧`，顶部一句总览 + 诚实标签。
- **为什么零 LLM 就够**：独立子结论之间**没有要 reason 的东西**（它们不相互影响）——综合就是**布局**。`compose`（推理档综合）只在**需要跨结论推理**时才有价值，而那**只发生在耦合场景 = L3**。所以 **L1 用确定性装配既最快又正确**，L3 才用推理综合。
- **可选润色**（暗发 `qos.multi-intent-synthesis-llm`·默认关）：开则 `compose` 把分节答案润成连贯散文（延迟 = compose 绑定模型延迟·若 compose=Kimi 推理则慢·故**默认关**·地板已可交付）。
- **延迟结论**：总耗时 = `classify + max(并行 solver) + 装配(<50ms)` ≈ **classify 主导**（classifier 已切非推理 → 秒级）。**SEAM-3 ≤10s 由此达成**，不再有"综合 82s"矛盾。

### 3.5 事件（复用 · 不新增 §8.2）
`step.completed` 伪 step：`multi_intent_dispatch`（选中意图集 + coupled 标记）·每 solver 一条 `multi_intent_solver`·`multi_intent_synthesis`（装配模式：deterministic|compose）。前端 Timeline 零改（已渲染 step.completed）。

### 3.6 复用 / 绿地新建 / 门禁
| 项 | 处置 |
|---|---|
| `candidates[]` / `invoke_solver` / `solver_summary` 投影 / `compose` / `step.completed` / slotBag(`fillSlots`) | **复用** |
| `router/multi-intent.ts`（判定+槽映射+独立性检查+确定性装配·纯函数为主） | **绿地新建** |
| `qos.multi-intent-orchestration`（BLOCK·defaultOn:false·双注册 datacore+agentcore）+ 可选 `qos.multi-intent-synthesis-llm` | **门禁新增**（R3 暗发） |
| `solverDepGraph`（solver 间已知依赖·独立性检查用·静态声明·治 G-PORTFOLIO 的诚实标签源） | **绿地新建**（小·静态表） |

---

## 4. 契约 / 端点 / 数据模型

- **SubmitQuery 不变**（用户侧零改）。
- **`DecisionTraceSchema` 扩 `multiIntentPlan?`**（`contracts/qos.ts`·additive·可选）：
  ```ts
  export const MultiIntentPlanSchema = z.object({
    selectedIntents: z.array(z.object({ intentKey: z.string(), confidence: z.number(), solverKey: z.string(), slots: z.record(z.unknown()) })),
    parallelResults: z.record(z.string(), z.object({ ok: z.boolean(), durationMs: z.number(), summary: z.string() })),
    coupledPairs: z.array(z.tuple([z.string(), z.string()])),   // 检出的耦合对（诚实标·L1 未链式传导）
    synthesisMode: z.enum(["deterministic", "compose"]),
  });
  // DecisionTraceSchema 追加：multiIntentPlan: MultiIntentPlanSchema.optional()
  ```
- **无新事件名**（复用 step.completed·§3.5）。
- **feature**：`qos.multi-intent-orchestration`（+可选 `qos.multi-intent-synthesis-llm`）。
- **env**：`QOS_MULTI_INTENT_TAU_MID`(0.80)·`QOS_MULTI_INTENT_MAX_INTENTS`(4)。
- **无新表 / 无契约破坏**（R9 不触发）。

---

## 5. 关键流程（旗舰例 = **风控员·真独立**·非 Q1）

**风控员例（L1 正确做·SEAM-1 验收）**：
> `常州基地良率掉了 2%，交期和毛利分别受多大影响？`
- 分类 → 候选 `yield_diagnosis(0.9) / affected_orders(0.85) / margin_attribution(0.82)` 三者 ≥ tauMid。
- 槽位：均可从 `{base:常州, deltaYield:-2%}` 抽满；**独立性检查：三者读同一"良率掉 2%"的态、各算不同指标（交期/毛利）·无依赖边 → 纯独立** → 并行。
- 并行跑 3 solver → 确定性装配三节答案（各带 ⟦ref⟧）→ 秒级出。**这是 L1 的甜点区：一因多果、果与果独立。**

**Q1 例（耦合·L1 不做·SEAM-2 验诚实）**：
> `…缺口8万·转30%给宜宾·长协65%·哪些订单延误·补多少外协/加班`
- 依赖链：`capacity_forecast(转拨后产能) → affected_orders(延误) → outsourcing_split(外协)`+`lta_gap` 约束。
- L1 行为：**要么**（若分类器候选含多个且检出耦合对）并行跑 + **综合顶部诚实标**"⚠ 这些子结论存在产能→延误→外协的耦合·本期为独立测算·未链式传导·完整联合方案见 L3"；**要么**（候选不全，如实测漏 capacity_forecast）走单意图 + 诚实 gap。**绝不**输出一份"看着全、数字不勾稽"的假组合方案。

---

## 6. 非功能与约定（§5 不变量逐条）

- **R6**：判定 + 装配纯函数、无随机/时钟；同问句同候选同槽 → 同选中集同装配（字节一致）。
- **R13 / KILL-MOCK-RED**：每子结论独立 ⟦ref⟧；耦合诚实标；**装配不造跨结论的新数字**（只摆放各 solver 真出的数）。
- **R3**：暗发关 = 逐字节现单意图路径；`set==="ALL"`→关（不劫持）。
- **R7 / partial**：单 solver 失败诚实标、不塌、不 hallucinate。
- **SEAM-GATE**：验收**必须**含"耦合题不被当独立题假综合"的驱动测（SEAM-2）——这是本特性的头号接缝（数据耦合性 × 编排独立性假设，漏判即红）。

---

## 7. 验收（DoD）

1. **SEAM-1（独立并行真做）**：提交风控员例 → `multiIntentPlan.selectedIntents` ≥3、并行真跑 `yield_diagnosis`+`affected_orders`+`margin_attribution`、答案含三域分节 + 各 ⟦ref⟧。
2. **SEAM-2（耦合诚实·头号判据）**：提交 Q1 → **要么** `coupledPairs` 非空且综合答案含"独立测算·未链式传导·见 L3"诚实标签、**要么**走单意图 gap——**断言答案里不出现"已给出联合组合方案"的措辞**（防假综合）。
3. **SEAM-3（延迟）**：多意图（确定性装配）总耗时 ≈ classify + max(solver)（装配 <50ms）·目标 ≤ 3s（classifier 非推理后）；**不因综合引入推理档延迟**。
4. **SEAM-4（partial 诚实）**：任一 solver 失败 → 该节标"未计算+原因"、其余正常、无 hallucinate。
5. **SEAM-5（零回归）**：`qos.multi-intent-orchestration` 关 → 行为与现单意图逐字节一致。
6. **门**：四包 `pnpm -r build && pnpm -r --workspace-concurrency=1 test` 全绿 + `ontology:check` **51/51 不变**（无新事件）+ a14 evals 不回归。

---

## 8. 分期

| 期 | 内容 | 状态 |
|---|---|---|
| **P1（本 PRD·独立多意图）** | MultiIntentDispatcher（判定+槽映射+独立性检查）+ 并行 solver + **确定性块装配** + 诚实耦合标 + 暗发 + SEAM-1..5 | 待派 1 dev |
| **P2（真分解·L2）** | 补分类器漏掉的子意图（NL→子问→solver·如 Q1 的 capacity_forecast）；DRIL 粗排 Top-K 意图省 token | 路线图 |
| **P3（耦合联合求解·L3）** | 依赖链传导（转拨→产能→延误→外协）·复用 `solve_portfolio` 联合守恒·推理档 compose 跨结论综合——**这才是 Q1 的真解** | 路线图（最难·单独立项） |

**旁路优化（独立 track·非本 PRD 阻塞）**：DataCore `SolverService.loadContext` 按 `requiredObjectTypes` 只加载需要的对象表（现全量 `Promise.all` 10 类·冷启动 ~150ms → 30–50ms·`solvers/service.ts:~3401`）——**属 datacore 性能优化·与本编排 PRD 解耦**·可另派。

> **派发纪律（CLAUDE.md LOOP）**：P1 一张 handoff·dev 顶部写🚦范围边界（只碰 `router/orchestrator.ts` 插点 + 新 `router/multi-intent.ts` + `contracts/qos.ts` multiIntentPlan + features 双注册 + `multi-intent-seam.test.ts`）；审核方隔离复验 = 四包 gate + **SEAM-2 亲手真跑（耦合题不假综合）** + 亲手用一遍。金值：无新 solver/事件 → 不动 golden。
