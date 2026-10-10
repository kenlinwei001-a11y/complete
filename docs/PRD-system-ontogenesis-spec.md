# PRD · 系统发育闭环总纲（System Ontogenesis Spec · 倒序发育 ⊕ 正序运作）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 宪法级总纲（统摄诸 PRD）|
| 性质 | **总纲**——把"系统像受精卵长成人一样自我成长"从比喻落成机制:**倒序发育(从场景倒推长出数据/本体/能力)⊕ 正序运作(用户使用)是同一有机体两相**;每次发育必自动闭合**数据/本体/能力三环**,产物按 **AUTO-DERIVE / NEEDS-HUMAN** 二分处置,发育过程**透明可视**,成熟分相位(PROVISIONAL→GOVERNED)。 |
| 统摄 | `PRD-data-closure-spec`(数据环)· `PRD-A15`+`deriveOperationCatalog`(能力环)· `PRD-dogfooding-self-ontology`/本体§9(本体环)· `PRD-demand-pulled-growth-engine`(生长信号)· `PRD-fullstack-story-build-g8`(倒推建域)· `PRD-A18`(成熟态)· `PRD-inference-process-enhancement`(透明)· `PRD-agent-data-generation-tools`/`PRD-in-dialog-gap-fill-loop`/`PRD-empty-tenant-bootstrap`/`PRD-admin-self-approval`(冷启动闭环) |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.D1/D11 · §4 · §5 R4/R6/R13 · §8 G-3/G-8 · §9 落库 dogfooding · §10.2/10.3 域+切片 `sys.meta.change_loop`）· `docs/OPERATING-MODEL.md`（机制宪法）· 各被统摄 PRD |

> 一句话：系统应是**个体发生(ontogenesis)的有机体**——**倒序发育**(数据构建发动机 `runStory` + 自成长 LOOP:从场景/需求倒推长出数据/对象/规则/求解器/Agent/工作流)与**正序运作**(QOS 问句→答案,沿已长成的管线)是**同一个体两相**(系统已用 `StoryBuildRun⊕GrowthLedgerEntry by runId` 认成两面)。但它现在**只会发育、发育记录却靠人手抄**:**本体是文档(非活体)、能力目录手维护、产物 DRAFT 后转正/回写全靠自觉**。本总纲立**发育闭环不变量 R16**:每次发育必**自动闭合数据/本体/能力三环** + 产物**二分处置(可派生→自动生成 / 须人工→自动开工单提示)** + **发育过程透明可视** + **成熟分相位**,并以 `sys.meta.change_loop` 为元链路。正序的 `GapReport` 即**生长信号**自动触发倒序生长——系统**越用越大**。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.D1/D11/D7）：`StoryBuildRun⊕GrowthLedgerEntry`(发育记录两面)·`BuildPlan/ClosureReport/ScaffoldReceipt`·`GapReport`(生长信号)·`GrowthTicket`(NEEDS-HUMAN)·`OPERATION_CATALOG/FEATURE_REGISTRY/SOLVER_CATALOG`(能力名册)·`OntologyType/Link`(落库后=活体自我模型)·`ActionDraft`(成熟转正)·`ProducedArtifact/ModuleSyncMatrix`(透明)。
- **触及链路**（§3 / §10.3 `sys.meta.change_loop`）：`场景/需求(受精卵) → comprehend 倒推全栈 BuildPlan → scaffold(数据/对象/规则/求解器/Agent/工作流 = 器官) → 闭包 → 产物(PROVISIONAL) → 正序使用暴露 GapReport(环境刺激) → 自成长生长 → 验证成熟(GOVERNED) → 回写活体本体 + 派生能力目录 → 下一轮正序更强`。
- **触及事件/数据流**（§4）：`storybuild.run_recorded`/`growth.ticket_opened`/`action.executed`;新增 `ontogenesis.organ_matured`(产物 GOVERNED 转正,可选)。
- **触及不变量**（§5，**新增 R16**）：
  - **R16 发育闭环（本总纲立）**：每次发育(建域/补缺/scaffold)**必自动闭合三环**——①数据(build-to-verify,真能在正序跑通)②本体(新对象/链路/事件自动进**活体本体**,非手抄)③能力(目录从注册表**自动派生**,非手维护);产物**二分处置**(AUTO-DERIVE 自动生成 / NEEDS-HUMAN 自动开 typed 工单+通知+收件箱+深链,**绝不静默残缺**);发育过程**透明可视**;成熟**分相位**(PROVISIONAL→ADVISORY→GOVERNED,只 GOVERNED 计真值)。
  - 复用 **R4**(成熟转正经审批)· **R6**(发育确定性)· **R13**(发育记录/产物可溯)· **R12/R11**(双向/全链闭包)· **R-一致**· **R14**(配置化/活体派生)。
- **关闭/影响断点**（§8）：**G-8**(建域闭包→补"自动回写活体本体 + 自动派生目录")· **G-3**(正序 GapReport→自动触发倒序生长,对话/CLI/GUI 三面)· **G-5**(活体本体根治电池锁死)。
- **门禁**（§7）：新增/强化 `ontogenesis:check`(三环自动闭合声明 + 二分处置覆盖 + 透明产物登记)· 并入 `pnpm gates`;复用 `closure(HARD)`/`chain:check`/`prd:check`(§6 checklist)/`cli-parity:check`/`auto-onboard:check`。
- **数据闭环合规**：本总纲**统摄** data-closure-spec(数据环即其一环);`// 其余维由被统摄 PRD 各自满足`。
- **回写承诺**：**R16** + `sys.meta.ontogenesis_loop` 切片 + `ontogenesis.organ_matured` 事件 + 活体本体落库约定 → 回写本体 §5/§3/§4/§10。

## 1. 目标 / 非目标
### 目标
1. **立 R16 发育闭环不变量**(§0)为系统宪法,统摄诸 PRD。
2. **三环自动闭合**(§3):数据(已~闭)/本体(待活体化)/能力(待自动派生)各自落点 + 缺口。
3. **二分处置 + 自动提示**(§4):每产物 AUTO-DERIVE 或 NEEDS-HUMAN(typed 工单+通知+统一收件箱+深链),绝不静默残缺。
4. **发育过程透明**(§5):活过程 DAG + 模块同步矩阵 + 覆盖度,一等视图、系统级全景。
5. **正序↔倒序自动咬合**(§6):GapReport=生长信号→自动触发生长→成熟→回写→目录刷新→正序更强。
6. **治理落地**(§7):靠 必读/模板/门禁/回写 四层强制,不靠自觉。
### 非目标
- 不重写各被统摄 PRD(本总纲只立不变量+三环+二分+透明+咬合,细节在各 PRD)。
- 不一步到活体本体(分相位演进:先门禁防漂 → 后落库 dogfooding)。

## 2. 两轴与双面（系统已具雏形）
| 相 | 机制(已有) | 缺口 |
|---|---|---|
| **倒序发育** | `runStory`(comprehend 倒推全栈→scaffold)+ 自成长 LOOP(probe→fill→run→converge) | 发育记录靠人回写本体/手维护目录 |
| **正序运作** | QOS 问句→答案,沿已长成管线 | 空料/缺口未自动回灌为生长信号(G-3) |
| **同一个体** | `StoryBuildRun⊕GrowthLedgerEntry by runId`(构建期⊕运行期) | 两面未驱动"三环自动闭合" |
| **成熟分相位** | A18 `PROVISIONAL→…→GOVERNED` | 转正/回写未自动咬合 |

## 3. 三环自动闭合（R16 核心）
| 环 | 应自动闭合 | 现状 | 落点 PRD |
|---|---|---|---|
| **① 数据环** | 生长数据 build-to-verify(真能在正序跑通) | ◐ A10+inferenceProbe 已有;模版/单一上传口缺口 | `data-closure-spec` |
| **② 本体环** | 新对象/链路/事件→**活体自我模型自动更新** | ❌ 本体是文档+ontology:check 防漂,靠人回写 | `dogfooding-self-ontology`/§9 落库 |
| **③ 能力环** | 新模块/Agent/求解器→**目录自动派生** | ❌ OPERATION_CATALOG/REGISTRY 手维护 | `A15`+`deriveOperationCatalog`+auto-onboard |

> 原则:**派生,不手抄**。环②③ 是当前最大断点——器官能长,身体图谱(本体)与名册(目录)不自动跟长。

## 4. 产物二分处置 + 自动提示（绝不静默残缺）
- **AUTO-DERIVE(可派生)** → 自动生成:coverage 切片(auto-onboard)、OPERATION_CATALOG op(deriveOperationCatalog)、上传列模版(buildDataTemplates)、模块同步矩阵(deriveProducedArtifacts)。
- **NEEDS-HUMAN(须人工)** → **自动开 typed `GrowthTicket` + 通知 + 统一"待人工完成"收件箱 + 深链直达完成页**:DRAFT 复核 / 求解器上传 / 新 op 语义 / 歧义映射 HITL / 模版编辑 / 定稿审批。系统**主动推**,不等人翻页。
- 工单 OPEN→VERIFIED 闭环(已有 GrowthTicket 范式),泛化到**所有制品类型**。

## 5. 发育过程透明（一等视图 + 系统全景）
- **活过程 DAG**:`<InferenceProcessDag>` build-mode(inference-process PRD)渲染 `story→comprehend→生成数据/规则/求解器/Agent→填入模块`,逐步、带 DRAFT/GOVERNED 态、缺口红(GapReport)。
- **模块同步矩阵**(已有 区5 `deriveProducedArtifacts`)+ **故事覆盖度**(storyCoverage"没遗漏"证据)提升为一等、系统级"发育全景",正序使用时也可见"本有机体长成了什么、哪些待人工"。

## 6. 正序↔倒序自动咬合（越用越大）
```
正序用户问句 → 命中 GapReport(生长信号)
  → 自动触发倒序生长(fill/scaffold/build,对话/CLI/GUI 三面 G-3)
  → 产 PROVISIONAL 器官 → 透明展示 + NEEDS-HUMAN 自动提示
  → 验证/审批成熟 GOVERNED(R4)
  → 自动回写活体本体(环②) + 自动派生能力目录(环③)
  → 正序下次更强
```

## 7. 治理（四层强制,不靠自觉）
| 层 | 机器 | 作用 |
|---|---|---|
| 必读 | SessionStart 钩子 + CLAUDE.md 铁律 + ontology skill | R16 每会话强制注入 |
| 必填 | `_PRD-TEMPLATE.md §0` 发育闭环声明 | 每 PRD 声明三环达成/豁免 |
| 门禁红 | `ontogenesis:check` + `pnpm gates`(CI + 分支保护) | 漏闭合/漏二分=红,合不进 |
| 回写 | `ontology:check` | 偏离活体本体即红 |

## 8. 验收（DoD）
- 本体 §5 立 **R16**;§10 加 `sys.meta.ontogenesis_loop`;§4 加 `ontogenesis.organ_matured`。
- 一次发育(建域/补缺)→ 三环自动闭合可验:数据 build-to-verify ✓、新对象进活体本体 ✓、新能力进目录 ✓(各接对应 PRD 落地后)。
- 产物二分处置全覆盖:无静默残缺;NEEDS-HUMAN 必有 typed 工单+通知+收件箱+深链。
- 发育过程一等可视;正序 GapReport 自动触发倒序(三面)。
- `ontogenesis:check` 并入 `pnpm gates`;四层治理生效。
- 回写本体 §5/§3/§4/§10;并入 `OPERATING-MODEL.md`。

## 9. 分期（演进,非一步到位）
- **ONT.1** 立 R16 + `sys.meta.ontogenesis_loop` + 模板声明 + `ontogenesis:check`(防漂级)+ 并入 gates。
- **ONT.2** 能力环自动派生(`deriveOperationCatalog`+auto-onboard)+ 二分处置统一收件箱(GrowthTicket 泛化)。
- **ONT.3** 透明一等视图(活过程 DAG + 全景)+ 正序↔倒序自动咬合(GapReport→生长,三面 G-3)。
- **ONT.4** 本体环活体化(dogfooding 落库,§9):能力/对象/链路注册为平台 ObjectType → 目录/本体/门禁全从活体图谱派生 → R16 真自闭环。

> 这是"系统是会成长的有机体"从比喻到机制的收口:**倒序发育 ⊕ 正序运作、三环自动闭合、二分处置不静默、过程透明、成熟分相位、四层强制**。它做诸 PRD 的上位发育宪法——各 PRD 落一环,本总纲保证它们**合起来是一个会自己长大、且长大记录不靠人手抄**的系统。
