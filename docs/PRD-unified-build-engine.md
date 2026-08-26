# PRD · 统一构建发动机（数据先行 ⊕ 图谱先行 ⊕ 故事先行 + 全链闭包）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-15 |
| 取代/扩展 | **扩展**现有 A7「数据构建发动机」(`apps/datacore/src/databuilder/`)，不另起模块 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `docs/AUDIT-0614-fullchain.md` · `docs/DATA-BUILDER-PIPELINE.md` |
| 核心一句话 | 平台已有的 A7 发动机是「故事→DataCore 栈」的需求拉动引擎；本 PRD 把它**扩成「故事→可运行场景」全栈编译器**：闭包门从单系统升级为**全链（故事→答案）**，并统一三入口、生成应用、通用推演、自助闭合 |

## 0. 本体引用与影响（强制）

- **触及对象类型**（本体 §2）：BuildPlan / BuildJob / ClosureReport / DataBuilderAgent（A）· OntologyType / SliceSpec / Rule / ActionType / Solver / IndustryTemplate / SyntheticJob / Connector / RawDataset（A）· **Intent / ExecutionPlan / Workflow / Skill / Agent / SceneEntry / ScenarioCard（B，本 PRD 新纳入闭包）** · LlmPurposeBinding。
- **触及链路**（§3）：编排链 `ScenarioCard→Intent→Plan→Solver→render`（修 G-1/G-2）· 场景/入口链（修 G-3）· 数据→本体→推演链 · 数据构建发动机链（扩闭包，修 G-8）。
- **触及事件/数据流**（§4）：复用 `ontology.published`/`materialize.completed`/`rules.updated`/`intent.published`/`workflow.published`/`dataset.regenerated`；新增构建期事件 `buildplan.closure_evaluated`、`scaffold.completed`（须登记 §4 + 下游订阅，遵守 D-29）。
- **触及不变量**（§5）：R4 真值经 Action · R6 确定性（freezePlan+seed）· R11 **全链闭包**（本 PRD 的核心，把它做成构建时门禁）· R12 双向闭包扩为全链 · R3 entitlement(`feature.data-builder`)。
- **关闭/影响断点**（§8）：**G-1 G-2 G-3 G-4 G-5 G-6 G-7 G-8 全部**（本 PRD 是这些断点的系统级解）。
- **需走门禁**（§7）：闭包门（扩全链）· validate · 准备度 · VLE · 断链审计。
- **回写承诺**：落地后回写本体 §3（新链路）、§4（新事件）、§5（R11 升为构建时强制）、§7（全链闭包门）、§8（断点关闭）。

## 1. 目标 / 非目标

### 1.1 目标
1. **三入口统一**到同一构建发动机：**数据先行**（源表长出本体）/ **图谱先行**（先画结构再补数据源+处理）/ **故事先行**（故事反解全栈 + 全链闭包）；三者共用一条产物模型 + publish/Action 主干 + 一道闭包门 + 一个 generic-inference。
2. **全链闭包门**：BuildPlan 扩到 AgentCore 栈（意图/计划/工作流/技能/Agent/场景入口），闭包校验从「数据↔本体↔求解器入参」升级为「**故事→意图→计划→求解器(输出形状匹配渲染)→渲染** 全链可运行」，不接通拒发布。
3. **场景为主实体**：场景 → 归视图组（规划与平衡 / 推演与风险）→ **派生绑定** presetContext/意图/计划/agent；agent 降为下游绑定（修 G-3）。
4. **执行计划为生成产物**：发动机据场景生成 ExecutionPlan 并绑回意图；补前端创建/编辑入口（修 G-4）。
5. **rawin 三路统一填数**：闭包先算「需要哪些字段」→ ① 在线**数据模版**(按需求字段定义 schema) → ② 上传 Excel(补 parseXlsx) **或** ③ 合成生成（并入连接器入口），由需求字段统一驱动（修 G-6）。
6. **生成应用 + 通用推演去电池锁死**：scaffold 从任意已发布本体生成视图/场景/Agent/求解器绑定；新增 `generic-inference`（通用 what-if：对属性施 Δ→沿派生/链路重算→前后对比），任意本体即用（修 G-5）。
7. **LLM 用途矩阵可扩展**：每个用 LLM 的构建阶段 = 一个可绑、可读名的用途行（修 G-7）。
8. **瀑布流 + 逐产物 HITL**：数据构建发动机页以瀑布流展示每步与生成产物，逐产物预览 + 人工确认后经 Action 物化。

### 1.2 非目标
实时流式摄取（本期批量）· 多人实时协同画布 · 跨租户模板市场 · **自动发明领域求解器**（缺领域求解器时绑 generic-inference 或标记"需开发"，不臆造）。

## 2. 现状与缺口（对照代码）

**已存在（复用，勿重造）**：A7 七阶段 `intake→comprehend→gap→rawin→transform→closure→publish`（`databuilder/service.ts:160-369`）；LLM 拆解 `BuildPlan{dataSources,objectTypes,rules,solverNeeds,kbDocs}`（`contracts/databuilder.ts:132`）+ `freezePlan+seed` 确定性；双向闭包 `validateClosure`（`closure.ts`：反向-对象 HARD/兜底 BIND_EXISTING_SLICE、反向-data SOFT、正向-求解器入参 HARD）；publish 经 Action + dry-run 预览 + 隔离区；前端 `DataBuilderPage` 阶段步进 + 闭包报告。通用底座：切片 `executeSlice`、派生 `recompute`、规则求值、aggregate、`instantiateGeneric` 均领域无关。

**缺口**（本体 §8）：
- BuildPlan 不含 AgentCore 栈；闭包正向只到「求解器入参字段存在」，**不验全链接通**（G-8 → 致 G-1）。
- 跨服务输出形状未校验（G-2：`affected_orders` plan 读 `data.rows/count`，真实返回 `affected/total`）。
- 场景模型以视图+agent 为主键、与 SCENARIO_CATALOG 断开（G-3）；执行计划无前端创建入口（G-4）。
- 应用层电池锁死、`generic-inference` 不存在（G-5）；Excel 解析 TODO、无数据模版、合成在独立页（G-6）；LLM 用途枚举写死（G-7）。

## 3. 设计（分层 · 复用优先 · 标清三类）

```
入口三模式 ───────────────────────────────────────────────────────────
  故事先行 STORY_FIRST  故事→BuildPlan(全栈) →覆盖/缺口 →编排下面两层 ↓     [扩 A7]
  数据先行 DATA_FIRST   源表→PROCESS→实体                                  [复用 modeling]
  图谱先行 GRAPH_FIRST  先画结构→补数据源/处理                              [绿地：画布]
        └────────────────┬────────────────────────────────────────────
                         ↓ 同一产物模型 (domain.ts ObjectTypeDef)
  本体建模层：types/links/slices + 对象库                                  [复用 ontology/modeling]
                         ↓
  生成层 scaffold（唯一生成器）：视图/场景/意图/工作流/agent/求解器绑定      [绿地：泛化 seedViewConfigs]
                         ↓
  全链闭包门：故事→意图→计划→求解器(形状匹配渲染)→渲染 可运行性             [扩 closure.ts，门禁新增]
                         ↓
  瀑布流 HITL 逐产物确认 → Action 物化/发布（确定性·多租户·审计·隔离区）     [复用 domainExecutor]
                         ↓
  通用推演 generic-inference（唯一，两边共用）                              [绿地：包 recompute]
```

| 设计块 | 性质 | 锚点 |
|---|---|---|
| BuildPlan 扩 `intents/skills/workflows/agents/sceneEntries` | 扩契约 | `contracts/databuilder.ts:132` |
| 全链闭包：正向延伸到「意图绑计划→计划步骤求解器存在→求解器输出形状匹配渲染模板→渲染 block 合法」+ 跨系统查 B 的 catalog | 门禁新增 | `closure.ts` + B `catalog/service.ts` |
| 生成层 scaffold 从本体派生视图/场景/意图/工作流/agent；跨系统经 B catalog 端点 seed | 绿地（泛化） | `synthetic/service.ts:840` seedViewConfigs |
| `generic-inference`：Δ注入 + `recompute` 反向增量重算 + 前后 aggregate 对比；注册为 SOLVER_KEYS + 工具 | 绿地（包现成底座） | `ontology-core.ts:339` recompute |
| 场景为主实体：ScenarioCard 升为一等，归视图组，派生 SceneEntry+presetContext+意图绑定 | 重构 | `scenarios-catalog.ts` + `contracts/agentcore.ts:171` |
| rawin 三路：数据模版(新)→Excel(parseXlsx 补)→合成(并入)；由 BuildPlan.dataSources.fields 驱动 | 复用+补 | `connectors/parsers.ts`,`registry.ts:172`,`SyntheticPage` |
| LLM 用途可扩展 + 按页面标注 + 矩阵 model 健壮显示 | 扩契约+修 UI | `contracts/llm.ts:205`,`LlmProvidersPage.tsx` |
| 瀑布流逐产物 HITL | 前端 | `DataBuilderPage.tsx` |

## 4. 契约 / 端点 / 数据模型

- **BuildPlan 扩**：`+ intents[] + skills[] + workflows[] + agents[] + sceneEntries[]`（各带 `status: EXISTS|GAP|GENERIC`）。
- **ClosureReport 扩**：新 finding 类 `CHAIN`（故事→…→渲染每段 BOUND/MISSING）+ `SHAPE`（求解器输出键 vs 渲染模板引用键，治 G-2）。
- **新端点**（DataCore，`feature.data-builder` 门控）：`POST /a/v1/build/preview`（瀑布流 dry-run 全栈）· `POST /a/v1/build/scaffold`（生成应用）· `POST /a/v1/data-templates`（数据模版 CRUD）· `POST /a/v1/connections/:id/upload`（含 xlsx）。跨系统生成经 B `POST /api/v1/catalog/.../plans|intents|workflows|agents`（服务间令牌）。
- **LlmPurpose 扩**：用途登记表化（保留枚举校验，加 `registerPurpose` 或配置驱动），新增 `build_decompose` 等并按页面标注。
- **仓储**：新表/字段四处同改（migrations + pg + memory + repo 接口，R9）；`dataTemplates`、BuildPlan 扩字段持久化。

## 5. 关键流程（故事先行端到端）

1. 输入故事脚本（或选 SCENARIO_CATALOG 既有故事）→ `comprehend`(LLM, freeze) → BuildPlan(全栈)。
2. `closure`（全链）：逐产物查覆盖（已有→复用 / 缺→生成 / 求解器缺→绑 generic-inference 或标"需开发"）；**全链不接通 = HARD 失败**。
3. 瀑布流展示每产物（原始数据需求/字段/是否被切片覆盖/规则/约束/skill/意图/计划/agent）→ 逐产物 HITL 确认。
4. `rawin`：缺数据 → 数据模版/Excel/合成三选一填。
5. `transform`+`scaffold`：生成本体/规则/派生 + 视图/场景/意图/计划/agent。
6. `publish`：经 Action 物化真值 + seed AgentCore 栈 + 发领域事件（D-29）→ 场景**端到端可推演**（全链闭包已保证）。

## 6. 非功能（§5 不变量逐条）
contracts-only-shared · tenant_id everywhere · entitlement 先于 authz · 真值经 Action · no-secrets-echo · 确定性(freezePlan+seed) · 错误信封 · 双仓储四处同改 · A6 行级+脱敏贯穿预览/物化/推演 · **D-29 产出必发事件**。

## 7. 验收（DoD）
- 全链闭包：喂 20 个故事 → 闭包门通过 → 20 场景**端到端出答案**（修 G-1）；故意制造形状不匹配 → 闭包 SHAPE 报红（治 G-2）。
- scaffold：发布一个**非电池**本体 → 自动得视图/场景/agent/通用 what-if（修 G-5）。
- rawin：上传 Excel(.xlsx 真解析) + 数据模版 + 合成三路均产出对象（修 G-6）。
- 自助闭合：前端可创建执行计划/工作流/技能并绑定（修 G-4）；场景启动器点卡→注入→出答案（修 G-3）。
- LLM 矩阵：新增构建用途可绑、按页面标注、已绑 model 不在目录仍显示（修 G-7）。
- `pnpm -r build && test` 全绿 + `parity` + **`ontology:check`** + 各期回归锁；回写 SYSTEM-ONTOLOGY.md。

## 8. 分期

| 期 | 范围 |
|---|---|
| P1 | BuildPlan 扩 AgentCore 栈 + ClosureReport 扩 CHAIN/SHAPE + 全链闭包校验（先验证、不生成）→ **立即用作 G-1/G-2 的构建时门禁** |
| P2 | 跨系统生成（B catalog seed）+ 场景为主实体重构（G-3）+ 执行计划前端创建入口（G-4） |
| P3 | rawin 三路：parseXlsx + 数据模版 + 合成并入（G-6）|
| P4 | scaffold 去电池锁死 + `generic-inference` 通用 what-if（G-5）|
| P5 | LLM 用途可扩展 + 矩阵 model 健壮（G-7）+ 瀑布流逐产物 HITL 前端 |
| P6 | 三入口端到端联调 + 文档回写（SYSTEM-ONTOLOGY/DATA-BUILDER-PIPELINE）+ 全绿交付 |

> 每期：`pnpm -r build && test` 全绿 + `ontology:check` + 该期回归锁；任何新链路/事件回写系统本体。
