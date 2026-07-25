# 全局蓝图 · DRIL 决策对话端到端主链（Decision Dialogue Blueprint）

> 这份蓝图的唯一使命：**拥有跨 WO 的全链接缝**。
> 每张 WO 只测自己那半（WO-0 测路由、HARNESS 测提示词、DRIL 测检索、growth 测补数据）——
> 但"**真问句 → 路由对 → 缺数据自动补 → 数字接地 → 结构化决策答案**"的**端到端行为没有一张 WO 拥有**。
> 这正是 CLAUDE.md 的头号病：**SEAM-GATE·绿测试≠能用·断在接缝**。
> 本蓝图把所有 WO 钉在一根主链上，逐接缝定契约、定谁测，并立**唯一的全链验收门**。
>
> 遵铁律 0：见 §8《本体引用与影响》。所有阶段均已对代码核实（非空谈）。

---

## §0 三条被纠正的认知（写进蓝图，防重犯）

产品负责人在评审中纠正了三处，蓝图据此立论：

1. **"prompt 不参与" 错**：有**两个** prompt——**分类器 prompt**（`buildClassifierSystem`·prompts.ts:195·**每查询都参与·路由源头**）与 **agent 推理 prompt**（`AGENT_SYSTEM_CORE`·只管 path-B 开放题）。前者接近命门，后者锦上添花。
2. **"开放题是小部分" 错**：**开放 query 远超预设·意图无法穷举**。分类器拿真问句匹配有限目录→大部分 outOfCatalog→落开放长尾。**DRIL 检索式资源发现服务的是主流长尾，不是 niche。**
3. **"数据是天花板" 错**：数据在库里，**growth-engine 按需诊断+补齐**（classifyGap 7 码 → decideDataGap HARD/SOFT → runGrowthLoop 补+重跑）。数据是**链上一环**，不是固定上限。

---

## §1 端到端主链（The Spine·全链单一来源）

```
                                 真问句 + PageContext
                                        │
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ ① 分类器 prompt → 意图分类   buildClassifierSystem + classify（LLM）          │  WO-0 接线 · WO-CLASSIFIER-PROMPT 提质
 │      命中预设 / 半命中 / outOfCatalog                                         │
 └───────────────┬──────────────────────┬───────────────────────┬─────────────┘
                 │命中                   │半命中                  │不中(开放长尾·主流)
                 ▼                       ▼                       ▼
 ┌───────────────────────┐   ┌────────────────────┐   ┌──────────────────────────┐
 │ ② 意图 router → path-A │   │ ②' clarification   │   │ ③ DRIL 检索（开放长尾主路）│  DRIL-P1..P4
 │ domainResolve/ceo-route│   │ 让用户选/补槽        │   │ 问句→语义检索 solver/slice │
 │ →invoke_solver(确定性)  │   └────────────────────┘   │ /rule（不靠穷举意图）      │
 └───────────┬───────────┘                             └─────────────┬────────────┘
             │                                                       ▼
             │                                    ┌──────────────────────────────────┐
             │                                    │ ④ Harness+ReAct+Reflect（agent）  │  HARNESS-PROMPT · REFLECT-LOOP
             │                                    │ 拿检索到的资源 Think→Act→Observe→ │
             │                                    │ Reflect（出口前复盘·失败重规划）    │
             │                                    └─────────────┬────────────────────┘
             ▼                                                  ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ ⑤ 数字接地 / 缺数据自动补（不是天花板·是一环）                                     │  growth-engine wiring
 │   invoke_solver 出真数据；若 classifyGap==EMPTY_DATA → decideDataGap →           │
 │   HARD(真人正门 DataRequest) / SOFT(合成 PROVISIONAL) → runGrowthLoop 补+重跑     │
 └───────────────────────────────────┬────────────────────────────────────────────┘
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ ⑥ 结构化决策输出   final_answer：结论/分析/证据/建议/风险/下一步 + 每数字 ⟦ref:N⟧  │  HARNESS-PROMPT(结果结构)
 └───────────────────────────────────┬────────────────────────────────────────────┘
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ ⑦ 全链验收门（本蓝图拥有）  真问句集 → 端到端断言 路由对+补数据+接地+决策结构        │  ★WO-E2E-DIALOGUE-ACCEPTANCE
 └────────────────────────────────────────────────────────────────────────────────┘
```

**每阶段的代码锚点（已核实·非空谈）**：
| 阶段 | 代码 | 建它的 WO |
|---|---|---|
| ① 分类器 prompt + 分类 | `agent/prompts.ts:195 buildClassifierSystem` · `orchestrator.ts:580 classify` | WO-0（接线）+ WO-CLASSIFIER-PROMPT（提质）|
| ② 意图 router → path-A | `router/domain-resolver.ts` · `router/ceo-route.ts` · `orchestrator.ts:406 preferDeterministicSolver` | WO-0（确定性入口吃到已知意图）|
| ②' clarification | `orchestrator.ts:486 requestClarification` | 现有（WO-0 覆盖半命中路径）|
| ③ DRIL 检索 | `catalog.discover`(现 2 kind) · `ResourceDescriptor` · `agent/navigation-slice.ts` | DRIL-P1..P4 |
| ④ Harness+Reflect | `agent/prompts.ts AGENT_SYSTEM_CORE` · `agent/loop.ts` | WO-HARNESS-PROMPT · WO-REFLECT-LOOP |
| ⑤ 数字接地/补数据 | `growth/probe.ts:33 classifyGap` · `growth/data-boundary.ts:35 decideDataGap` · `growth/loop.ts:17 runGrowthLoop` · `/api/v1/growth/{probe,run}` | growth-engine wiring（已在·需织入对话链）|
| ⑥ 决策输出 | `agent/loop.ts final_answer` | WO-HARNESS-PROMPT |
| ⑦ 全链门 | 新建 | **WO-E2E-DIALOGUE-ACCEPTANCE**（本蓝图拥有）|

---

## §2 真实 query 分布驱动的双路（为什么 DRIL 是主路不是补丁）

- **预设命中路**（少数·可穷举那部分）：分类器 prompt 命中意图 → router → path-A 确定性。**分类器 prompt 质量**决定命中率（WO-CLASSIFIER-PROMPT）。
- **开放长尾路**（多数·无法穷举）：分类器 outOfCatalog → **DRIL 按语义检索资源**（solver/slice/rule），不需预先定义 intent。**这是主路。** DRIL 优先级据此**上调到第一波**。
- 两路都要：分类器 prompt 撑预设那头，DRIL 撑开放那头。**任一缺失，真实分布覆盖不全。**

---

## §3 数据接地织入主链（growth-engine 是⑤号环，不是外挂）

**纪律**：对话链遇到 `EMPTY_DATA` 不是"到天花板了"，而是触发数据生长：
```
invoke_solver/query → classifyGap(task)   （7 码：NO_INTENT/NO_PLAN/NO_SLICE/EMPTY_DATA/NO_RULE/SOLVER_NOT_FOUND/SHAPE_MISMATCH/NO_CAPABILITY）
  · EMPTY_DATA → decideDataGap：命中真实业务实体 → HARD（出精确 DataRequest 走真人正门·拒静默造事实）
                                无具体实体   → SOFT（确定性合成 PROVISIONAL）
  · 补齐后 runGrowthLoop 重跑 → 收敛 CONVERGED / 边界 BOUNDARY
```
**接线要求**：QOS 对话失败（尤其 EMPTY_DATA）应能**触发/建议** growth probe（`/api/v1/growth/probe` 已在）→ 让"引擎知道如何补齐"落到每个真实失败。**这条接线是否覆盖对话链的所有失败模式 = 可测的，不是天花板。**

---

## §4 跨 WO 接缝所有权（★本蓝图的核心★）

每个接缝 = 一处"绿测试≠能用"高发区。逐缝定契约 + 定谁测：

| # | 接缝 | 契约（必须成立） | 半测（各 WO） | 全链测（本蓝图） |
|---|---|---|---|---|
| S1 | 分类器 → router | 分类命中的意图，router 真能吃到并走 path-A（含场景卡绑定） | WO-0 SEAM | E2E |
| S2 | router → DRIL | 分类不中的开放题，落到 DRIL 检索（不是崩/不是洪泛 path-B） | WO-0(降级) + DRIL SEAM | E2E |
| S3 | DRIL → agent | 检索出的 top-k 资源真喂进 navigation-slice，agent 命中它 | DRIL-P4 SEAM | E2E |
| S4 | agent → solver | agent 涉算题真调 solver（Solver-first·不自己算） | HARNESS/REFLECT SEAM | E2E |
| S5 | solver → 数据 | solver 出真数据；EMPTY_DATA → 触发 growth 补 | growth SEAM | E2E |
| S6 | agent → reflect → 输出 | 出口前复盘拦下"未接地/工具静默失败"，重规划 | REFLECT-LOOP SEAM | E2E |
| S7 | 输出结构 | final_answer 五/六段 + 每数字 ⟦ref:N⟧ | HARNESS SEAM | E2E |

> **头号判据**：各 WO 的半测全绿 **≠** 对话能用。**唯有 §5 的全链门（把 S1–S7 串起来跑真问句）通过，才算能用。**

---

## §5 全链验收门 · WO-E2E-DIALOGUE-ACCEPTANCE（本蓝图拥有·封顶硬门）

- **🚦边界**：`apps/agentcore/test/e2e-dialogue-acceptance.test.ts`(新·env-gated 真 LLM + 无 LLM 双跑) · 复用 `/api/v1/growth/probe` 观测。
- **问句集**（三类·覆盖真实分布）：
  1. **预设命中**：场景卡触发问句（应 path-A 出真答案）。
  2. **开放长尾**：不在意图目录的自由问（应 DRIL 检索到资源出答案·**证 S2/S3**）。
  3. **CEO 深问**：根因/方案类（应 agent+reflect 出结论/建议/风险·**证 S4/S6/S7**）。
- **端到端断言**（全链·非各半）：
  - 路由对：命中题走 path-A·开放题走 DRIL·无 LLM 时诚实降级不崩（**S1/S2**）。
  - 补数据：故意问一个 EMPTY_DATA 题 → 断言触发 growth 诊断/补齐建议（**S5**）。
  - 数字接地：答案每个业务数字有 ⟦ref:N⟧ 且可溯（**S5/S7**）。
  - 决策结构：final_answer 含 结论/证据/建议/风险（**S7**）。
- **通过标准**：三类问句端到端全绿 = 对话真能用。**这是唯一防"各半绿·断在接缝"的门。**
- **定位**：**所有对话 WO（WO-0/HARNESS/CLASSIFIER-PROMPT/REFLECT/DRIL-P*）的头号复验判据**——它们各自 merge 前，本门必须随之绿。

---

## §6 WO 全景与依赖（钉在主链上）

| WO | 主链阶段 | 波次（据本蓝图调整）|
|---|---|---|
| **WO-0-NL-WIRING** | ①② | 第一波（急救·命门）|
| **WO-CLASSIFIER-PROMPT** | ① | 第一波（分类器 prompt 提质·决定命中率）|
| **WO-DRIL-P1** | ③ | 第一波（开放长尾主路地基·**优先级上调**）|
| **WO-HARNESS-PROMPT** | ④⑥ | 第一波 |
| WO-DRIL-P2/P3/P4 | ③ | 第二波（检索/图谱/质量分/接 agent）|
| WO-REFLECT-LOOP | ④ | 第二波（等 WO-0 落地·避 orchestrator 接缝）|
| WO-PROMPT-DEFAULTS-WIRING | ①④ | 第二/三波（消模板漂移·与 HARNESS 顺序）|
| growth-engine 对话接线 | ⑤ | 第二波（EMPTY_DATA→probe 触发织入对话链）|
| **WO-E2E-DIALOGUE-ACCEPTANCE** | ⑦ | **贯穿全程·每张对话 WO merge 前必绿** |

---

## §7 一句话总纲

**对话能用 = ①分类器 prompt 撑预设 + ③DRIL 撑开放长尾 + ②路由不误不崩 + ⑤缺数据自动补 + ④Harness/Reflect 想对验对 + ⑥结构化接地输出 + ⑦全链门守死接缝。**
单独任何一张 WO 绿都不算数——**全链门（§5）绿，才算对话真能用。这就是本蓝图拥有的、此前没人拥有的那道缝。**

---

## §8 本体引用与影响（铁律 0）

- **对象类型（§2）**：H 域 `Intent`/`ExecutionPlan`/`Skill`/`Agent`/`Task/Query`/`GapReport`/`ResourceDescriptor`/`EvalSuite`；B/C/E 域 `ObjectType`/`OntologyLink`/`RuleEntry`/`SliceSpec`/`SOLVER_CATALOG`。
- **链路（§3）**：编排链（问句→答案）+ 自成长探针链（`classifyGap`→`decideDataGap`→`runGrowthLoop`）+ DRIL 检索插入位（domainResolve 候选扩充 + navigation-slice 排序/补位）。
- **不变量**：R6（分类/路由/检索/gap 分类全确定性·embedding advisory 不进确定性路径）· R13（DRIL/gap 派生投影非新真值源）· R14（不穷举业务常数·靠检索+生长）。
- **断点（§8）**：本蓝图整体推进 **G-AGENT-BLIND-REACT**（路由+agent 两侧全修）+ **G-9**（场景卡走 R16 发育闭环 via growth）+ **G-DECISION**（决策结构输出）。
- **回写**：落地后回写 `docs/SYSTEM-ONTOLOGY.md` §3（补 DRIL 检索插入位 + growth 织入对话链）+ §7（新门 `dril-e2e:check`）+ §8（G-AGENT-BLIND-REACT 全修）。
