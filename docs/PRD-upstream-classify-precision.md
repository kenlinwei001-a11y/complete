# PRD：上游分类精度与求解器覆盖（倒推精度的真瓶颈 · 兄弟单 A）

> 状态：草案待审 · 版本 v1 · 日期：2026-07-09 · 作者：Claude
> 关系：`docs/PRD-gap-analysis-engine.md`（统一 GapAnalysis 引擎）的**兄弟单**。主单解决"听懂之后依赖算得准不准"（下游②），本单解决"到底听没听懂、有没有对的求解器"（上游①）——**①是②精度的上限**。冲突时以平台总纲为准。
> 所有引用符号已核对真实存在，附 `file:line`。

---

## §0 本体引用与影响（铁律 0 · 门 `prd:check` 机器解析）

**触及对象类型（母体 §2.H）**：`ClassificationResult`（`qos.ts:224`）· `IntentDefinition` · `ExecutionPlan` · `Solver`/`SOLVER_REGISTRY`（`solvers/solver-registry.ts`）· `QueryTask` · `GapReport`/`GapCode`（`growth.ts`）。
**触及链路（母体 §3 编排链）**：`Query --①classify--> Intent --planRef--> ExecutionPlan --step--> {Solver|Slice|Rule|render}`；τ 决策分流 Path A / INTENT_CHOICE / Path B。
**不变量**：R3（entitlement 先于 authz·候选收窄）· R6（确定性地板·`deterministicMatchScore` 纯函数无时钟随机）· R7（错误信封）· R11（全链闭包·求解器必接通才算能用）· R13（溯源·分类依据可亮出）· R16（发育闭环·缺求解器→`SOLVER_NOT_FOUND`→骨架 GrowthTicket）。
**断点（母体 §8）**：G-1（全链闭合）· G-3（presetContext/QOS 注入）· G-4（意图执行计划入口）。
**回写母体**：本单**不新增**对象类型/事件/链路（改的是既有 classify 融合策略 + 补既有 kind=solver 的覆盖），故落地时只需在 §3 编排链补一句「classify = LLM ⊕ 确定性融合」的措辞、§2.E 求解器覆盖矩阵登记；不新增门则无需 §7 回写。草案阶段仅本 §0 引用既有 R/G。

---

## §1 问题：倒推的真瓶颈在上游①，不在下游②

系统"倒推"两段串联：
```
查询 --①classify(听懂→意图/路由)--> 显式需求 --②依赖闭包(意图→计划→求解器→类型→数据)--> 完整需求树
```
- **②下游**由主单 `docs/PRD-gap-analysis-engine.md` §8 解决（`SOLVER_DATADEP` + 真本体图闭包，不造假 key）——给定意图，精确算出还差什么。
- **①上游**是精度的**真瓶颈**且主单**未动**（主单 §6 明写 `const c: ClassificationResult = await classify(query, ctx)` 复用现有分类器）。
- **串联铁律**：①听错意图/认错求解器，②只会把"错的东西"的依赖闭包算得无比精确——**garbage in → precise closure of garbage**。所以在**结果精度**口径上，不修①，②的净收益被上限锁死。

真实痛点复现："常州物料齐套"落 Path B（Agent 兜底、未验证），根因正在①（没识别到对的意图/求解器），不在②。

---

## §2 As-Is 精确现状（逐条核对）

### 2.1 classify 主流水线（`router/orchestrator.ts:400-590`）
`candidate narrowing(entitlement 过滤) → 短路(场景绑定/单候选跳过 LLM) → ②LLM classify → τ 决策`：
- **LLM classify 是主路**：`const llmClassification = await this.classify(task, pkg, candidates)`（≤2 重试）。
- **确定性只是"无 LLM 兜底"**：`const classification = llmClassification ?? this.deterministicClassify(task, candidates)`（`orchestrator.ts:520`）——**仅当 LLM 返回 null 才用**；LLM 可用但弱/错时，确定性信号**完全被忽略**。源码注释自证：*"确定性分类回退…只用于 LLM 缺失时的兜底，绝不冒充 LLM 分类"*（`orchestrator.ts:275-278`）。
- **τ 决策**（默认 `QOS_TAU_HIGH=0.85`、`QOS_TAU_LOW=0.55`，`config.ts:15-16`）：`outOfCatalog || top.confidence<τ_low` → **Path B（Agent 兜底·未验证）**；`τ_low≤conf<τ_high` → INTENT_CHOICE 澄清；`conf≥τ_high` → Path A。
- **`deterministicClassify`**（`orchestrator.ts:661`）：`deterministicMatchScore`（char bigram 覆盖率，`orchestrator.ts:288`）打分，`STRONG=0.5/WEAK=0.34/MARGIN=0.15`；`<WEAK` 返 undefined → 上层诚实降级。

**症结**：LLM 与确定性是**互斥**关系（`??`），不是**融合**。LLM 在领域术语上误判/低置信时，本可救场的确定性证据被丢弃 → 落 τ_low 以下 → Path B。

### 2.2 求解器覆盖（`SOLVER_REGISTRY` / `SOLVER_DATADEP`）
- `SOLVER_REGISTRY` 每求解器一条 descriptor `{key, route, outputShape, flags}`（`solver-registry.ts:56`），~40 个求解器。
- **缺求解器已可诊断可施工**：`SOLVER_NOT_FOUND` gap（`probe.ts:100`）+ `SCAFFOLDABLE={NO_PLAN,SOLVER_NOT_FOUND}`（`scenario-grow.ts:37`）→ "绑 generic-inference 兜底，或出带 I/O 契约的求解器骨架 GrowthTicket"（`probe.ts:36`）；solver `autoCreatable:false`（代码态·`provisioners.ts:67`）。
- **但覆盖有真实空洞**：`SOLVER_DATADEP`（`datadep.ts:86`）全表无通用**因果归因/root-cause** path-A 求解器（只有窄口径 `margin_attribution` 财务归因、校准里的 `REPLAY_ATTRIBUTION` 方法）。这类问题命中意图也无 path A → 落 generic-inference/Path B。

---

## §3 设计目标

| 目标 | 描述 | 优先级 |
|---|---|---|
| A1 分类融合 | 确定性证据从"仅无-LLM 兜底"升为"与 LLM 融合/再排序"，减 LLM 依赖、救回领域术语误判 | P0 |
| A2 覆盖诊断 | 建"问题类目 → path-A 求解器"覆盖矩阵，把"命中意图但无对求解器"显式化 | P0 |
| A3 覆盖补齐 | 按频次优先为高频未覆盖类目补 path-A 求解器（复用既有 SOLVER_NOT_FOUND→骨架工单路径） | P1 |
| A4 可观测 | 分类失败率/融合救回率/Path B 落点 top 问题类目上报，数据驱动校准 τ 与融合权重 | P1 |

**非目标**：不换 LLM 分类器为纯规则（LLM 仍是自由问句主力）；不碰主单 §8 的下游闭包（那已是真值）；不做前端面收敛（兄弟单 B）。

---

## §4 方案 A1 · 分类融合（确定性 ⊕ LLM，不再互斥）

把 `orchestrator.ts:520` 的 `llmClassification ?? deterministicClassify(...)` 升级为**融合**：

```typescript
// 纯函数（R6·无时钟随机），可单测；LLM 与确定性都算，再合成
function fuseClassification(
  llm: ClassificationResult | undefined,
  candidates: IntentDefinition[],
  query: string,
  tau: { high: number; low: number },
): ClassificationResult {
  const det = candidates
    .map(c => ({ key: c.key, s: deterministicMatchScore(query, c) }))   // 既有函数·orchestrator.ts:288
    .sort((a, b) => b.s - a.s);
  // ① LLM 缺失 → 退回纯确定性（保持现有 deterministicClassify 语义，向后兼容）
  if (!llm) return deterministicClassifyFrom(det);
  // ② LLM 有结果 → 融合：确定性强匹配到 LLM 遗漏/低估的意图 → 提为候选、给置信下限
  const fused = mergeCandidates(llm.candidates, det, { detStrong: 0.5, floorConf: tau.low });
  // ③ LLM top 与确定性 top 一致 → 置信度上浮（一致性加成，减 τ 误判为澄清/Path B）
  return reRankWithAgreement(fused, det);
}
```

规则（全确定性、可单测、可回退）：
- **救回遗漏**：确定性 `score≥0.5` 命中的意图若不在 LLM 候选里 → 以 `confidence=τ_low` 补入候选（避免 τ_low → Path B 的漏路由）。
- **一致性加成**：LLM top 与确定性 top 同一意图 → 置信 `×(1+β)`（`β` 可配·默认 0.1），减少"其实对但落中置信被反问/落 Path B"。
- **冲突不硬塞**：LLM 与确定性 top 分歧且都不强 → 维持 INTENT_CHOICE 澄清（诚实，不赌）。
- **零回归开关**：`QOS_CLASSIFY_FUSE`（env·`defaultOn:false`·RL2 暗发）；关时 100% 等价现行 `??` 语义（`fuse` 退化为 `llm ?? deterministic`）。

> 效果：LLM 可用时不再无视确定性证据；LLM 弱/误判领域术语时确定性救回；无 LLM 时行为不变。**减 LLM 依赖 = 减 UNBOUND/误路由**。

---

## §5 方案 A2/A3 · 求解器覆盖矩阵与补齐

### 5.1 覆盖矩阵（A2·诊断）
建"问题类目 → path-A 求解器"声明式矩阵（`@platform/contracts`·纯数据·R14 抽象不含业务字面量）：
```typescript
// problemClass（因果归因/趋势/对比/约束求解/…）→ 覆盖它的 solverKey[]（∈ SOLVER_REGISTRY）
export const SOLVER_COVERAGE: Record<string, string[]> = { /* 只登记真实 solver key */ };
```
- 门 `solver-coverage:check`（并入 `pnpm gates`·登记母体 §7）：矩阵引用的 solverKey 必 ∈ `SOLVER_REGISTRY`（对齐 `no-fake-done` 精神，防幽灵）；未覆盖类目**显式列为缺口**而非静默落 Path B。
- 与主单 §8 衔接：主单闭包能算"给定意图缺哪个 solver"，本矩阵回答"这个**问题类目**根本没有对的 solver"——两者互补。

### 5.2 补齐（A3·施工，复用既有路径）
- 未覆盖高频类目（如**因果归因**，实测 `SOLVER_DATADEP` 无通用 root-cause 求解器）→ 走**既有** `SOLVER_NOT_FOUND`→骨架 `GrowthTicket`（带 I/O 契约·`probe.ts:36`）路径，不新造机制。
- 按 A4 采集的 Path B 落点频次排序,优先补高频类目。solver `autoCreatable:false` → 人工/开发正门（R4 审批发布）。

---

## §6 方案 A4 · 可观测（数据驱动校准）

复用既有 `metrics.classifierErrors`（`orchestrator.ts:519`）+ 新增：
- `qos_classify_fuse_rescued_total`：融合救回（确定性补入使之落 Path A/澄清而非 Path B）计数。
- `qos_pathb_by_problemclass{class}`：Path B 落点按问题类目分桶 → 暴露"哪些类目最常没听懂/没求解器"。
- 用于校准 τ 阈值与融合 `β`（诚实：当前为经验值），并排 A3 补齐优先级。

---

## §7 实施计划（约 5 周·3 Phase）

- **Phase A1 · 分类融合（2 周）**：`fuseClassification` 纯函数 + 单测（LLM 有/无/冲突/救回四类）；`QOS_CLASSIFY_FUSE` 开关（默认关·RL2）；A4 救回指标。真实测试：常州物料齐套等历史落 Path B 问句，开融合后应落 Path A/澄清。
- **Phase A2 · 覆盖矩阵（1.5 周）**：`SOLVER_COVERAGE` + `solver-coverage:check` 门 + 回写母体 §7；Path B 落点分桶指标。
- **Phase A3 · 覆盖补齐（1.5 周起·按频次滚动）**：高频未覆盖类目走既有骨架工单路径补 path-A 求解器。

---

## §8 风险与回滚
| 风险 | 缓解 |
|---|---|
| 融合把 LLM 好结果拖坏 | `defaultOn:false` 开关；融合只**补候选/上浮一致项**，不下调 LLM top；A4 救回率/误路由率双指标守 |
| 确定性 bigram 误召回 | 仅 `score≥0.5` 才补候选；冲突走澄清不硬塞 |
| 覆盖矩阵引用幽灵 solver | `solver-coverage:check` 门（key 必 ∈ SOLVER_REGISTRY） |
| τ/β 为经验值 | A4 数据驱动校准，诚实标注 |

**回滚**：`QOS_CLASSIFY_FUSE=off` 即 100% 回到现行 `llm ?? deterministic`；覆盖矩阵纯诊断不改路由；补齐走既有工单路径可停。

## 附录 · 关键文件索引（均已核对存在）
`router/orchestrator.ts:288`（deterministicMatchScore）·`:520`（`llm ?? deterministic` 融合点）·`:661`（deterministicClassify）·`config.ts:15-16`（τ 默认）·`contracts/qos.ts:224`（ClassificationResult）·`solvers/solver-registry.ts:56`（SOLVER_REGISTRY）·`contracts/datadep.ts:86`（SOLVER_DATADEP·覆盖空洞证据）·`growth/probe.ts:36/100`（SOLVER_NOT_FOUND→骨架工单）·`growth/scenario-grow.ts:37`（SCAFFOLDABLE）。
