# PRD · 推演入口数据依赖清单 + 通用就绪探测（数据补齐拱心石·大面积）

> 用户问：**如何大面积根据前端推演入口，补齐需要的数据，仿真前端可见、后端存储、不硬编码/不写前端？**
> 审核方结论：**补数据的「器官」平台已全有**（合成/真人正门/缺口卡/冷启动，全 R6·全落库·origin=SYNTHETIC）——缺的是**上游一颗拱心石：每个推演入口没有声明式「数据依赖清单」**。所以缺口靠"跑一遍发现空"（run-first）而非清单预检（precondition-first），补齐是**逐面各自反应式**触发，撑不起「大面积」。本 PRD 补这颗拱心石，让**同一条 探测→看板→认领→合成→重跑 闭环覆盖所有入口**。

## 1. 现状：器官齐、拱心石缺（实证锚点）

**已有器官（复用·勿重造）**：

| 站 | 机制 | 锚点 | 状态 |
|---|---|---|---|
| 合成物化 | `synthetic.runJob`（值域库·viaModelingChain·origin=SYNTHETIC·`mulberry32(seed^hash)`·幂等只清 SYNTHETIC 行） | `synthetic/service.ts:1012,174,177` | ✅ R6·落库 |
| 建世界 | `POST /a/v1/growth/provision-world`（guard>20 拒·industry 取租户配置 R14） | `app.ts:1212-1223` | ✅ |
| 单类补 | `POST /a/v1/growth/fill-data`（SOFT·**但通用正则造值·非接地**） | `app.ts:1188-1199` | ◐ 值不接地 |
| HARD 正门 | `data-boundary.ts decideDataGap`（命中 BASE/SEG 词表→精确 DataRequest 走真人导入） | `growth/data-boundary.ts:35` | ✅ |
| 缺口探测 | `probe.ts classifyGap`→`GapReport{findings:GapFinding{gapCode,atStep,evidence,suggestedFill}}`·`isDataBearing` 诚实门（VERIFIED 但无 kpi/table→EMPTY_DATA） | `growth/probe.ts:39-63`·`contracts/growth.ts:10-37` | ◐ run-first |
| 前端缺口卡 | `GapCard`（▶触发生成缺失数据→runGrowth→CONVERGED→继续推演；不可达诚实"断在<码>"+深链） | `components/Answer/GapCard.tsx:18-86` | ✅ 仅对话侧 |
| 沙盘就绪 | `certification.ts worldCompleteness{present,needed,pct}`·诚实缺件清单 | `sim/certification.ts:59-73`·`SimReadinessPanel.tsx:246` | ✅ **唯一 precondition-first** |
| 冷启动 | `POST /a/v1/bootstrap`（幂等 7 步·任一步核对未达停并报码） | §8 CL.4 | ✅ |
| 反推清单 | BuildPlan 13-need + `MODULE_PROVISIONERS`（测试门强制每 need 注册 provisioner） | `databuilder/provisioners.ts:35-99` | ✅ 但**查询反推·非入口声明** |

**缺的拱心石（根因）**：
- **入口无输入数据契约**：求解器数据需求是 `loadContext` 里一张**写死的 22 类清单**（`solvers/service.ts:1613-1628`）——加个需要新对象类型的求解器要改 `loadContext`，而非声明清单。**输出侧有 DF.6 覆盖门（`app.ts:1718`），输入侧一无所有。**
- **场景卡假设特定种子 id 存在**（`4680-NCM`/`changzhou`·`scenarios-catalog.ts:61-63`）→ 新租户这些对象不在，一键推演依赖 demo seed。
- **探测 run-first**（除沙盘）：EMPTY_DATA 靠跑完发现无数据块，非清单预检。
- **合成分裂 + 自动补在 LOOP 内**（`scenario-grow.ts:54-118`·GROWTH-WORKLIST 尚未落）。

## 2. 目标架构：六站一脊（同一闭环·大面积）

```
推演入口(solver/intent/scenario/view/sandbox)
  │ ①声明 DataDependency 清单（本体绑定·IndustryPack 内·R14）
  ▼
②通用就绪探测 checkReadiness(entry,tenant)  ← precondition-first·读清单查后端计数
  │ EntryReadiness{ready, gaps:GapFinding[]}   （复用 classifyGap/certification 形态）
  ▼
③HARD/SOFT 分流 decideDataGap（复用 data-boundary）
  │ HARD→DataRequest 真人正门        SOFT→可合成
  ▼
④在办看板 WorklistItem{status,kind,entryRef,gapCode}  ← 后端存·tenant_id·按状态/认领人/类型筛（GROWTH-WORKLIST）
  │ 人点「认领」→「补数据缺口」（不是自动补）
  ▼
⑤物化 provision（后端·R6·origin=SYNTHETIC）  ← 统一走 synthetic.runJob/MODULE_PROVISIONERS（非通用正则）
  │ 写 repos.objects/links + 域表·synthetic:true
  ▼
⑥重跑可见 继续推演 → 前端消费后端权威值渲染（FRONTEND-VALUE-AUTHORITY）
      {kind}.updated 事件失效 B→A 缓存（≤60s）→ 重跑见新数据
```

### 站①声明（本 PRD 新增·拱心石）
每个推演入口声明 `DataDependency` 清单（**契约·本体绑定·零业务常数**）：
```ts
// packages/contracts/src/datadep.ts（新）
DataDependencySchema = z.object({
  requires: z.array(z.object({
    roleType: z.string(),        // 本体角色类型键（经 SolverBinding 映射真类型·R14 抽象角色·非"Base"字面）
    minRows: z.number().int().min(1),
    viaLinks: z.array(z.string()).optional(),
    props: z.array(z.string()).optional(),   // 必需属性（空态判定用）
  })),
  params: z.array(z.string()).optional(),    // 必需 SolverParam 键
  slices: z.array(z.string()).optional(),    // 必需可解析切片键
})
```
- **落点**：扩 `SolverArtifact`（`contracts/solvers.ts:347`）加 `requires: DataDependency`；场景卡从其 solver 的清单 + `presetContext` 派生；**清单声明在 IndustryPack 数据里（R14）→ 换行业=换 pack·0 码改**（挂 INDUSTRY-PACK-CONVERGE）。
- **治本副产**：`loadContext` 从写死 22 类改为**读各求解器清单的并集**——杀掉 Hα/Hγ 硬编码；每求解器只加载自己声明的子集（更快·更清晰）。

### 站②通用就绪探测（本 PRD 新增）
纯函数 `checkReadiness(entry, tenantCtx): EntryReadiness`：读清单 → `objects.listByType` 计数 vs `minRows`、参数存在性、切片可解析 → 产 `EntryReadiness{ready:boolean, gaps:GapFinding[]}`。**把沙盘 `certification.ts` 的 present-vs-needed 预检泛化到所有入口**；复用 `GapFinding`/`GapCode`（`contracts/growth.ts`）与 CL.3（空 vs 不存在）。端点 `POST /b/v1/entries/{ref}/readiness`（或求解器 invoke 前置）。

### 站③④⑤⑥ = 复用既有 + 一处统一
- ③ `data-boundary.decideDataGap` 原样复用。
- ④ **GROWTH-WORKLIST-HUMAN-FILL**（已设计待落）：所有入口的 gap 统一登记 `WorklistItem`·后端存·筛·人工闸；本 PRD 只需让 readiness 的 gaps 喂进同一看板。
- ⑤ **统一合成**：SOFT 填走 `synthetic.runJob`/`MODULE_PROVISIONERS`（值域接地）替代通用正则 `fill-data`（收编 §1 "值不接地"弱点）。
- ⑥ **FRONTEND-VALUE-AUTHORITY**（✅ 已落）：重跑后前端消费后端权威值·不客户端重算；`GapCard`「继续推演」形态从对话侧扩到 view/scenario 入口。

## 3. 为什么这样就「大面积」而非逐面

今天每个面（对话 GapCard / 沙盘 readiness / 视图空态）各自重造探测+空态。**清单 + 通用探测器**让**一条闭环覆盖所有入口**：任何声明了清单的入口，自动获得 就绪检查→看板→认领→合成→重跑，免费。**新增求解器/场景/视图 = 声明其清单即完成**，无逐面代码。这就是"大面积"的机制根。

## 4. 门（守拱心石不空转·teeth-proven）

- **`datadep-manifest:check`**（新·并入 `pnpm gates`）：每个已注册求解器/出厂场景入口**必须声明 DataDependency 清单**（无声明入口→门红）；清单 `roleType` ∈ 已发布本体类型（或 SolverBinding 角色）；`minRows≥1`。**镜像 DF.6 输出覆盖门到输入侧**。牙齿：删一个清单→红。
- 复用门：`no-silent-mock`/KILL-MOCK-RED（禁前端造值）·`debattery`（禁内联业务常数）·`scene-agent-config`（入口绑定完整）·`boundary-singlesource`（词表单一源）。

## 5. 落地顺序（拱心石先·既有 WO 挂靠）

| WO | 站 | 状态 |
|---|---|---|
| **DATADEP-MANIFEST-READINESS**（本 PRD·新） | ①声明 + ②探测 + 门 | 待建·**脊·先做** |
| INTENT-MATERIALIZE-BINDING-COMPLETE | ①（意图侧绑定含数据清单） | 队列中·挂靠脊 |
| GROWTH-WORKLIST-HUMAN-FILL | ④看板人工闸 | 队列中·消费 readiness gaps |
| LAUNCHER-GROUNDED-QUESTIONS | ⑥（场景入口接地·空→认领） | 队列中·消费脊 |
| INDUSTRY-PACK-CONVERGE | 清单的 R14 家 | 队列中·清单入 pack |
| FRONTEND-VALUE-AUTHORITY | ⑥重跑消费权威 | ✅ 已落 |
| （统一合成：SOFT 走 synthetic.runJob 替正则 fill-data） | ⑤ | 并入本 WO 或紧随 |

**依赖判据（worktree 并行性）**：DATADEP 脊改 `contracts/datadep.ts`(新)+`contracts/solvers.ts`+`solvers/service.ts loadContext`+新门——与 GROWTH-WORKLIST（growth/server）、LAUNCHER（scenarios-catalog）**文件树不相交→可并行**；但**逻辑上后三者消费脊的 readiness 输出**，故脊**先合**、后三者 rebase 消费。

## 6. 《本体引用与影响》

- **对象类型**：Solver/SolverParam/SolverBinding（D4）·ObjectType/ObjectInstance（D2·就绪计数源）·ScenarioCard/SceneEntry/Intent（D8/D7）·SyntheticJob/DataRequest/WorklistItem（D1）·GapReport/GapFinding（D7 growth）。**新增 `DataDependency`（求解推演域 D4 的入口输入契约·与 SOLVER_OUTPUT_SHAPES 输出契约对偶）**。
- **链路**：`sys.solving.invoke`（Solver→ObjectType(读)→SolverParam）**补入口输入契约段**；`sys.ingest.build_closure`（BuildPlan→ClosureReport→{类型/规则/求解器需求}）与本清单**同源对齐**（BuildPlan 反推 vs 入口声明·二者互校）；`sys.scenario.launch`（卡→Intent→presetContext）接地到清单。
- **断点**：**G-8**（构建闭包不跨 D7/D8）——本 PRD 让入口(D7/D8)声明数据需求、通用探测跨到 D1 补齐，**把闭包从"仅 DataCore 栈"扩到"入口→数据"全链**；**G-9**（场景卡靠一次性手装 seed）——清单+按需合成替代写死 seed 依赖；回写 §8 二者状态。
- **事件**：复用 `{kind}.updated`→B→A 缓存失效（D-29·≤60s）使重跑见新数据；无新增域事件（readiness 为读侧派生）。若 gap→WorklistItem 落库，走 GROWTH-WORKLIST 定义的 `growth.fill_claimed/fill_triggered`。
- **不变量**：**R6**（探测/合成确定性·同租户同参数字节一致）·**R14**（清单入 IndustryPack·换行业 0 码）·**R11**（全链闭包门验入口→数据可运行）·KILL-MOCK-RED（禁前端造值）。
- **回写**：`docs/SYSTEM-ONTOLOGY.md` §2.E 新增 DataDependency 对象 + §3 `sys.solving.invoke` 输入契约段 + §7 新门 `datadep-manifest:check` + §8 G-8/G-9 状态推进；`pnpm ontology:slices` 重生成。

## 7. 验收（真实测试·前端逐值对照后端）

- **C1 门**：`datadep-manifest:check` green→red 自证（删一清单红）；`loadContext` 改读清单并集后四包 build/test 绿·R6 字节一致。
- **C2 真浏览器·空租户闭环**：新建空租户→打开某推演视图/场景卡→**就绪探测出诚实缺口清单（非静默空/非假值）**→缺口进看板→人点认领→点补数据缺口→`synthetic.runJob` 物化（origin=SYNTHETIC 落库）→继续推演→**前端渲染真结果·逐值对照后端**（consume authority）。
- **C3 大面积**：抽 ≥5 个不同入口（capacity/affected_orders/sop/order_fullchain/一场景卡）→各自声明清单→同一探测器对各自产出正确 readiness+gaps（不逐面写代码）。
- **C4 R14**：立第三非电池行业→清单随 pack 声明→换行业 0 码改（挂 INDUSTRY-PACK C2）。
