# WO-ADOPT-DECISION-PLAY 交付说明

> 分支 `claude/handoff-wo-adopt-decision-play`（基于 canonical `origin/claude/inspiring-gates-aqczjg`）
> 收口目标：欠账 #81 / #71 —— 「公司级战略方案」缺一个语义正确的已接线动作类型。

---

## ① 盘点（带金丝雀）

### 1.1 已 WIRED 的 9 个动作各自长什么样（本单照它们的形状做，不自创）

单一出处 `apps/datacore/src/actions.ts:35 ACTION_WIRING` + 真分支 `apps/datacore/src/app.ts domainExecutor`。

| # | key | 执行器落点 | 写什么真值 | 形状特征（本单借鉴处） |
|---|---|---|---|---|
| 1 | `plan_change`(source=`global-sim`) | `GlobalSimPlanExecutor`（`actions.ts:154`·**唯一**在 actions.ts 里的执行器类） | WorkOrder UPSERT / Order UPDATE / InterBaseTransfer UPSERT + `runDerivations` | 确定性指纹幂等；**id/值全由 payload+forecastStart 派生，禁 `Date.now`**；`BUILTIN_ACTION_EFFECTS` 逐属性声明 |
| 2 | `AOP情景拍板` | `plan.applyFinalize`（app.ts:432） | S&OP/情景版本记录（非 ObjectInstance） | 委派领域服务，targetRef 由服务给 |
| 3 | `校准参数变更` | `calibration.applyAction`（app.ts:436） | 校准参数 | 同上 |
| 4 | `定稿月度计划版本` | `sop.applyFinalizeAction`（app.ts:441） | 版本 FINAL 锁定 | 同上 |
| 5 | `计划版本变更` | `sop.applyChangeAction`（app.ts:445） | 版本 inputs patch | **带前置条件**（`typeof payload.versionId === "string"`），条件不满足即落兜底 |
| 6 | `对象数据变更` | app.ts:451 内联 | `objects.put({...obj, props:{...props,...patch}})` + `runDerivations` | 对象不存在 → `ok:false`（不猜） |
| 7 | `流水线发布物化` | app.ts:462 内联 | 经 `runProcessing` 折叠成对象落库（坏行入隔离区）+ `runDerivations` | 主键缺失 → 隔离区，不静默丢 |
| 8 | `采纳产能保障方案` | app.ts:500 内联 | `levers[{objectId,prop,value}]` → **本体属性真值** + `runDerivations` | 缺任一要素即诚实失败；`targetRef` = `CAP-ADOPT:n:first`，**刻意不用 MO- 前缀** |
| 9 | `adopt_mitigation` | app.ts:533 内联 | `AdoptedMitigation` 台账（`risk_timeline` 真曲线消费） | **本单模板**，见 1.2 |

兜底：`UnwiredActionExecutor`（`actions.ts:90`）—— NOT_IMPLEMENTED 诚实失败、NO_WRITE 显式自证无写入，**绝不产出 MO 形态字符串**。

### 1.2 `adopt_mitigation` 这条走通的链（本单最好的模板·#72 已闭）

```
前端/replay/kernel → POST /a/v1/action-drafts {actionTypeKey:"adopt_mitigation", payload:{base,factor,planKey}}
  → S2 审批链 planner → admin（battery.ts BATTERY_ACTION_TYPES）
  → app.ts:533 分支：
      ① base 解析复用 risk.ts `resolveBaseId`（**唯一严格出处**）——解不出即拒，不挑一个基地写
      ② factor/planKey → `params.risk.mitigations[factor]` 解出量化 {eff,tn}——解不出即拒，不猜
      ③ 单源不并存：同 (baseId,factor) 旧 ACTIVE 先置 REVOKED（写时不变量）
      ④ 落 `AdoptedMitigation` 对象；`adoptedAt` 取确定性时间锚 `forecastStart`（禁 Date.now·R6）
      ⑤ targetRef = `MIT-ADOPT:<adoptionId>`（非 MO 形态）
  → risk.ts:512 `AdoptedMitigation`(ACTIVE) → `${baseId}|${factor}` → {eff,tn} → **真曲线**自第 tn 天起扣 eff
```

**本单逐条照抄的四点**：payload 只带身份不带量化 · 量化只从声明库解出 · 解不出即整单诚实失败 ·
确定性时间锚 + 非 MO 形态 targetRef + 单源不并存台账。

### 1.3 `PLAN_GOAL_TARGETS` 今天在哪、谁能写它

| 层 | 位置 | 可写性 |
|---|---|---|
| **常量本体** | `packages/contracts/src/base-registry.ts:107` | 编译期常量，运行期**写不了** |
| **运行期派生承载①** | `solver_params.planGenerate.targets`（`battery.ts:575-582`：`gmFloor=gmFloorPct/100`、`turnsFloor=turns`，**键名与常量侧不同名**） | 可写：`solvers.mutateParams()`（`solvers/service.ts:4019`·所有 solver_params 写入的唯一通道） |
| 派生承载②（前端·本单范围外） | `PlanGenerateView.tsx:47 DEFAULT_GOALS` / `mocks/fixtures.ts:586 planGoals` | 只读派生 |
| 单一来源门 | `scripts/check-boundary-singlesource.mjs`（3 个 PLAN_GOAL 消费端须派生不内联） | — |

⚠️ **红线断言必须同时咬住常量与承载①**：只断言常量恒等于自己是空断言（它写不了）；
真正能被"体贴的实现"改掉的是承载①。本单的红线断言两层都比（见 ③）。

### 1.4 `decision_play` 这个域今天有什么数据

`solvers/service.ts:2860 decisionPlay`：任何 `metricKey` 都恒产 **3 条公司级供应链战略**，
每条自带 `provenance{drillType,drillId,drillValue}` = 求解器算这条方案时**真读的那个对象**：

| optionId | 中文 | provenance 指名的杠杆对象 | 求解器真读的字段 |
|---|---|---|---|
| `opt-backup-cert` | 缩短备份供应商认证周期 | `BackupSupplierPool` / `pool-cathode` | `certWeeks`（16）→ `effBackup = 1 − certWeeks/26` |
| `opt-lta-clause` | 长协加价格联动条款 | `LongTermAgreement` / 首条正极长协 | `priceLinked`（false）→ `effClause`；**方案名也随之变** |
| `opt-insource` | 上游自采矿+战略储备 | `LongTermAgreement` / `lta-lfp-cylk` | `ltaShortfall`（约定−实交） |

而 `params.risk.mitigations` 的键是 **7 个基地级产能风险因子**、方案是 `early_stock`/`air_freight`/`reroute`
这类基地处置动作 —— **两域没有任何真实映射**，这正是 `decision/kernel.ts:117-143` 论证「诚实不派」的依据。

**否定结论取证（照铁律 0.6 先自证工具）**：判定 `opt-insource` 今天**没有**可落的本体属性 ——
- 金丝雀（已知必中）：`grep -c 'def("LongTermAgreement"' apps/datacore/src/synthetic/battery-extended.ts` → **1**（工具是好的）；
- 同一把尺子扫矿权/储备类对象：`grep -rniE 'def\("[A-Za-z]*(Mine|Reserve|Stockpile|Equity|Stake)' apps/datacore/src/synthetic/` → **0 命中**。
  故「无矿权/自有产能/战略储备对象」是取证结论，不是"我没找到"。

---

## ② 新动作写了什么、没写什么

### 2.1 写了什么

| 文件 | 内容 |
|---|---|
| `apps/datacore/src/synthetic/battery.ts:2828` | 注册 ActionType **`adopt_decision_play`**（名「采纳战略方案」·审批链 planner→admin·`required:["metricKey","optionIds"]`） |
| `apps/datacore/src/synthetic/battery.ts:473` | **战略杠杆库** `BATTERY_SOLVER_PARAMS.decisionPlay.levers`（量化的唯一出处）+ `noLeverRationale`（留白的签字） |
| `apps/datacore/src/solvers/types.ts:54` | `SolverParamsShape.decisionPlay?`（可选 → 老租户参数没这段时**诚实拒绝**，不回落默认杠杆） |
| `apps/datacore/src/actions.ts:57` | `ACTION_WIRING.adopt_decision_play = "WIRED"` |
| `apps/datacore/src/actions.ts:117-224` | 纯函数 `resolveDecisionPlayLever()` + `objectIdOf()`（**唯一**决定"写不写/写哪儿/写成什么"的地方） |
| `apps/datacore/src/actions.ts:425` | `BUILTIN_ACTION_EFFECTS.adopt_decision_play`（`coverage: PARTIAL` + `undeclared` 交底） |
| `apps/datacore/src/app.ts:623-726` | `domainExecutor` 真分支 |
| `apps/datacore/src/synthetic/battery.ts:1211/2343/1786` | 对象类型 **`AdoptedDecisionPlay`**（props / 注册 / 归 `decision` 域） |
| `apps/datacore/src/synthetic/data-categories.ts:92` | 归入 `decision_cockpit` 数据类目（守 `uncategorizedTypes==[]` 不变量） |
| `apps/datacore/test/action-adopt-decision-play.seam.test.ts` | 效果层 SEAM（7 用例） |
| `apps/datacore/test/demo-chain-provenance.test.ts:46/93` | 金值 94 → 95 |

### 2.2 执行语义（三道解析，全部**只解不猜**）

```
payload {metricKey, factorId?, optionIds[]}          ← 只带身份，不带任何量化
  ① 重跑 decision_play 真推演（A6 正门 invokeSolver）→ optionIds ⊄ 真方案 ⇒ 拒「幽灵方案」
  ② 杠杆对象 = 方案自己的 provenance.drillType/drillId（不由 payload 指定 —— 能指定就能指错）
  ③ 杠杆属性/目标值 = solver_params.decisionPlay.levers[optionId]（未登记 ⇒ 拒，并带出 noLeverRationale）
  ── 全部解完再写（先解后写，任一条解不出即整单失败，不留"半采纳"状态）──
  ④ objects.put 杠杆真值（origin: ACTION/adopt_decision_play）
  ⑤ AdoptedDecisionPlay 台账（含 leverFrom→leverTo；同 (optionId,杠杆对象) 至多一条 ACTIVE）
  ⑥ runDerivations
  ⑦ targetRef = `DP-ADOPT:<n>:<objId>.<prop>:<from>→<to>`（非 MO 形态）
```

`to` 是**绝对目标值**而非增量 → 重复采纳幂等（不会越采越小），且"从多少变到多少"在审计里一望可知。

### 2.3 **没写**什么（诚实边界·逐条说明为什么）

1. **没有复用 `adopt_mitigation`**，也**没有**改 `采纳经营方案`（它仍 `NOT_IMPLEMENTED`）。
   后者被 `test/action-noop-exec.seam.test.ts:77` 与 `test/action-metrics-endpoint.seam.test.ts:104` 双双咬住，
   且裁决原文要求新建类型。G-ACTION-NOOP-EXEC 现状因此是 **WIRED 10 / NO_WRITE 0 / NOT_IMPLEMENTED 1**。
2. **没有给 `opt-insource` 编一根杠杆** —— 已在 `noLeverRationale` 里签字说明为什么（见 ①1.4 的取证）。
   它是本单**兜底判据的真实样本**：同一次推演里既有解得出的方案、也有解不出的方案。
3. **没有改 `decision/kernel.ts`**（决策内核仍诚实不派）。
   理由：裁决 §3.3 明写「kernel 的诚实拒绝必须**保留**为兜底」；且改派会让 5 处既有断言转红
   （`decision-kernel-c1.test.ts:58/70`、`decision-wire-seam.test.ts:57`、
   `adopt-mitigation-dispatch.seam.test.ts:190/203`、`adversary-adopt-mitigation.test.ts:306`），
   其中两个文件正是「不许动 `adopt_mitigation` 既有链路」保护的那条链。
   **⚠ 由此产生的诚实缺口（必须报给审核方，勿当成已闭环）**：
   `adopt_decision_play` 今天的生产触发路径**只有通用的 `POST /a/v1/action-drafts`**（与
   `采纳产能保障方案`/`采纳经营方案` 同一条路），**datacore 内部没有任何 src 生产者**。
   按铁律 0.5 的三分法，它是「**接了线没生产者**」，不是「没接线」，也不是「已闭环」——
   两个候选生产者（`decision/kernel.ts` commit 改派、前端 `DecisionPlayView` 采纳按钮）
   **都在本单范围边界之外**，故登记为下一单，不在此偷做。
4. **没有碰 `mapping.ts`**（业务侧写回登记表）。它不是写端，且动它会改 `check-action-wiring.mjs` 断言④的输入集；
   本类型的写回意图出处已在 `ACTION_WIRING` 注释里据实标注为杠杆库自身。**建议下一单补一条**登记。
5. **没有前端**（范围边界禁止）。

---

## ③ 三条效果层断言 · 实测输出

命令（**只跑单文件**，未跑 `gate.sh` / `pnpm -r test`）：
```
npx vitest --root apps/datacore run --maxWorkers=1 test/action-adopt-decision-play.seam.test.ts
```

```
 ✓ test/action-adopt-decision-play.seam.test.ts (7 tests) 37743ms
   ✓ ① 正向：采纳「缩短备份供应商认证周期」→ BackupSupplierPool.certWeeks 16→8，且 decision_play 重推真读到新值  7861ms
   ✓ ① 正向（第二根杠杆·证不是只对一条方案硬编码）：采纳「长协加价格联动条款」→ priceLinked false→true  6239ms
   ✓ ② 🔒 红线：采纳战略方案之后 PLAN_GOAL_TARGETS 与其运行期派生承载**逐字节未变**（「目标不能改」）  6174ms
   ✓ ③ 兜底：未映射的战略方案（opt-insource）仍诚实拒绝——不静默成功、不降级到「最接近」的一条  5701ms
   ✓ ③ 兜底：幽灵方案（不是本次推演产出的）拒绝采纳——payload 说了不算，真推演说了算  5939ms
   ✓ ③ 兜底仍在：决策内核对 decision_play 方案**依然诚实不派** adopt_mitigation（补了新类型不等于放开旧的错映射）  5823ms
   ✓ 纯函数层（解析器单一出处）：真方案+有登记→解出；未登记→带留白理由拒；幽灵→拒；provenance 缺失→拒  1ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

### 正向 —— 指名道姓：哪根杠杆、从多少变到多少

| 方案 | 杠杆（对象.属性） | 从 → 到 | 引擎真读到新值的证据 |
|---|---|---|---|
| `opt-backup-cert` | `obj_backupsupplierpool_pool-cathode`.**`certWeeks`** | **16 → 8** | 重推 `decision_play`：`provenance.drillValue` 16→8、`cycleDays` 降、`cost` 降、`closesGap` 升 |
| `opt-lta-clause` | `obj_longtermagreement_*`.**`priceLinked`** | **false → true** | 重推：方案 label 由「长协加价格联动条款」变、`closesGap` 变 |

断言不止于"库里变了"，还咬住"**引擎真读到了**"——只改库不被消费是另一种空转。
台账逐字段对拍：`leverFrom:"16"` / `leverTo:"8"` / `actionDraftId` 溯回 Action。

### 红线 —— `PLAN_GOAL_TARGETS` 逐字节未变

比较的是整串 JSON（常量 + `solver_params.planGenerate.targets` 两层），实测两次采纳后完全相等：
```
{"constant":{"revGrowthPct":18,"gmFloorPct":15.5,"sharePts":12,"capexCap":20,"cashFloor":50,"turns":6},
 "params":{"gmFloor":0.155,"cashFloor":50,"capexCap":20,"revGrowthPct":18,"sharePts":12,"turnsFloor":6}}
```
**空断言防护**：断言前先校验基线里六个目标键都在、且本次采纳确实写了 2 条台账
（否则"目标没变"可能只是因为整单没跑）。

### 兜底 —— 未映射的域仍诚实拒绝

`opt-insource` → `EXECUTION_FAILED`，错误原文含「没有登记」+ `noLeverRationale` 全文；
**零回写**（`AdoptedDecisionPlay` 为空 + `pool-cathode` 的 props JSON 逐字节未变 → 证明没有顺手改别人的杠杆）。
幽灵方案（`opt-not-a-real-plan`）同样拒。决策内核 commit 仍 `actionDraftIds:[]` + trace 写「诚实不派」。

---

## ④ 变异反证（红/绿输出全贴）

### MUTATION-1 · 把新动作退化成 no-op（只落台账、不改真值）

改 `app.ts` 杠杆写入为 `void obj;`。

```
 ❯ test/action-adopt-decision-play.seam.test.ts (7 tests | 2 failed)
   × ① 正向：…certWeeks 16→8…
     → 认证周期没落到状态上：16 → 16: expected 16 to be 8
   × ① 正向（第二根杠杆）…
     → 条款没落到状态上: expected false to be true
   ✓ ② 🔒 红线…    ✓ ③ 兜底×3    ✓ 纯函数层
 Tests  2 failed | 5 passed (7)
```

**关键发现（必须记账）**：这次变异下，`targetRef` 里那句 `certWeeks:16→8` **照样是绿的** ——
因为它由 `from`/`r.to` 拼出来，不读回真值。**这正是"运输层断言"的标本**：
`ok:true` / `targetRef 含期望字符串` / 台账写了，三个都绿，而真值一个字节没动。
本测的红只能来自 `repos.objects.get(...).props.certWeeks` 那一行。

### MUTATION-2 · 摘掉「目标不能改」红线保护

在执行末尾加 `solvers.mutateParams(... targets.revGrowthPct = 1 ...)`（模拟"体贴地把目标改成方案够得着的数"）。

```
 ❯ test/action-adopt-decision-play.seam.test.ts (7 tests | 2 failed)
   × ① 正向：…  → 采纳战略方案覆写了经营目标基线——「目标不能改」被破
   × ② 🔒 红线：… → 采纳战略方案覆写了经营目标基线——「目标不能改」被破（业务裁定·已定）
     Expected: …"revGrowthPct":18…    Received: …"revGrowthPct":1…
   ✓ ① 正向（第二根杠杆）  ✓ ③ 兜底×3  ✓ 纯函数层
 Tests  2 failed | 5 passed (7)
```
差异恰好落在 `params.revGrowthPct` 上（常量侧仍 18）—— 印证 ①1.3 的判断：
**真正能被改掉的是承载①，只断言常量是空断言**。

### MUTATION-3 · 静默降级到「最接近」的一条（裁决 §3.3 明令禁止的形态）

改 `resolveDecisionPlayLever`：未登记时回落 `Object.values(levers)[0]`。

```
 ❯ test/action-adopt-decision-play.seam.test.ts (7 tests | 2 failed)
   × ③ 兜底：未映射的战略方案（opt-insource）仍诚实拒绝…
     → expected 'adopt_decision_play：杠杆属性 LongTermAgre…' to contain 'opt-insource'
       Received: "adopt_decision_play：杠杆属性 LongTermAgreement.certWeeks 在对象
                  obj_longtermagreement_lta-lfp-cylk 上不存在——…"
   × 纯函数层… → expected true to be false
   ✓ ① 正向×2   ✓ ② 红线   ✓ ③ 幽灵/内核兜底
 Tests  2 failed | 5 passed (7)
```
附带发现：降级后**第二道护栏**（"杠杆属性在对象上不存在"）接住了它 —— 两道独立防线。
但**失败的理由变了**，测试因此变红（断言咬的是 `reason`，不是"反正失败了"）。
若只断言 `status === "EXECUTION_FAILED"`，这次变异会**假绿**通过 —— 这就是为什么兜底断言必须咬理由。

---

## ⑤ `check-action-wiring` 输出

```
$ node scripts/check-action-wiring.mjs
✓ action-wiring:check 通过：11 个已注册 ActionType 全部显式归类（WIRED 10 · NO_WRITE 0 · NOT_IMPLEMENTED 1）；
WIRED 者在 domainExecutor 均有真分支；兜底为诚实执行器（无假 MO 号产地）；
mapping.ts 3 条写回声明与接线态无矛盾；NO_WRITE 内置项 0 个均已签实名理由。
ACTION_WIRING_RC=0

$ node scripts/check-boundary-singlesource.mjs
✓ boundary-singlesource:check：BASE_REGISTRY(13 基地) + SEG_REGISTRY + PLAN_GOAL_TARGETS 单一来源，
3 BASE / 4 SEG / 3 PLAN_GOAL 消费端均派生、内联基地字面量 0（零容忍）。
BOUNDARY_RC=0
```

**接线态由 9/0/1 变为 10/0/1**（新增一条 WIRED，`采纳经营方案` 原样保留为唯一 NOT_IMPLEMENTED）。

### 回归（只跑受影响的单文件，未跑全量套件）

| 批次 | 文件 | 结果 |
|---|---|---|
| 本单 | `action-adopt-decision-play.seam` | ✅ 7/7 |
| 动作/采纳链 | `action-metrics-endpoint.seam` · `adopt-mitigation-dispatch.seam` · `adversary-adopt-mitigation` · `action-adopt-mitigation.seam` | ✅ 22 passed \| 1 skipped |
| 决策/动作类型 | `decision-kernel-c1` · `decision-wire-seam` · `decision-play` · `action-capacity-adopt.seam` · `sop-actions` · `action-noop-exec.seam` | ✅ 32/32 |
| 本体/类目/金值 | `data-categories` · `catalog` · `entity-catalog` · `boundary-impact` · `boundary-version` | ✅ 23/23 |
| 金值 | `demo-chain-provenance` | ✅ 2/2（94→95 已更） |

`npx tsc -p apps/datacore/tsconfig.json --noEmit` 无输出（通过）。

**两处金值被本单改动（注册即更）**：
- `demo-chain-provenance.test.ts:46/93`：类型数 **94 → 95**（`AdoptedDecisionPlay`·**出厂零实例** → `objs` 计数 11320 不变）；
- `data-categories.ts:92`：类目 typeKeys 增一（否则 `data-categories.test.ts` 首例
  「分类把全部出厂对象类型恰好归入一类」立即红 —— 这条**真的**被跑红过再修的）。

---

## ⑥ 需回写 `docs/SYSTEM-ONTOLOGY.md` 的清单（本单**未改**该文件·范围边界禁止）

| 章节 | 现文 | 应改为 |
|---|---|---|
| **§2.A 对象类型** | 无 `AdoptedDecisionPlay` | 新增一等对象类型 `AdoptedDecisionPlay`（已采纳战略方案台账·`decision` 域·出厂零实例·13 属性·主键 `adoptionId`）。与 `AdoptedMitigation` **分属两域**：前者战略杠杆（量化 = 本体属性真值），后者单基地战术处置（量化 = `{eff,tn}` 张力削减）——合并即静默错答 |
| **§2.D / §8 ActionType 接线账** | 「`adopt_mitigation`/`采纳经营方案`/`采纳产能保障方案`/非 global-sim 的 `plan_change` **四型**落 `MockActionExecutor` 实际零回写」**（早已过期·`docs/ONTOLOGY-7ELEM-AUDIT.md:260` 已指出）** | HEAD 实为 **WIRED 10 / NO_WRITE 0 / NOT_IMPLEMENTED 1**；唯一 NOT_IMPLEMENTED 是 `采纳经营方案`；兜底执行器是 `UnwiredActionExecutor` |
| **§2.D `ActionType.effects` 覆盖交底** | 「只有 `plan_change`(global-sim) 一条内置声明」 | 改为**两条**：新增 `adopt_decision_play`（`PARTIAL`——台账那半静态可声明，**杠杆那半的 objectType/propKey 运行期解出、静态枚举不了**，已进 `undeclared`） |
| **§3 链路** | 无 | 新增链路：`decision_play(公司级战略) → ActionDraft(adopt_decision_play) → S2 审批 → 本体属性真值 + AdoptedDecisionPlay 台账 → 下一次 decision_play/gap_attribution 读到新值`。⚠ 同时注明**当前生产触发端只有通用 `POST /a/v1/action-drafts`**（见 ②2.3 第 3 条） |
| **§8 `G-ACTION-NOOP-EXEC`** | 🔴 未修（4 型零回写） | 收口至**仅剩 1 条**（`采纳经营方案`）；并记明本单**不是**靠"把战略方案映射到 `adopt_mitigation`"收的口，而是新建了语义正确的类型；决策内核的诚实不派**仍在且仍是正确行为** |
| **§8 新增断点建议** | — | 建议登记 `G-ADOPT-DECISION-PLAY-NO-PRODUCER`：类型已 WIRED、执行器有效果层测试护着，但 **datacore src 内零生产者**（kernel 改派 + 前端按钮两个候选均在本单范围外）。形态 = 「接了线没生产者」，**不是**「没接线」 |
| **不变量** | — | R4「真值经 Action」在战略域补齐；新增写时不变量：同 `(optionId, 杠杆对象)` 至多一条 ACTIVE。**红线（业务裁定·已定·勿改）**：采纳动作永不写 `PLAN_GOAL_TARGETS` 及其派生承载（`solver_params.planGenerate.targets`）—— 目标是只读对照基准 |

其它建议同步（本单未改）：`docs/PRD-sandbox-multiplan.md:330 L2-A6` 的「采纳挂对执行器」白名单
`{adopt_mitigation, 采纳产能保障方案, plan_change}` 现应扩为四项，加 `adopt_decision_play`。

---

## 落盘确认

| 项 | 值 |
|---|---|
| 分支 | `claude/handoff-wo-adopt-decision-play` |
| 提交 | 开工占位 → 执行器 → SEAM 测试 → 归域+金值 → 数据类目 → 本交付说明 |
| 变异反证 | 3 个，全部跑完**已还原**（`git status --porcelain` 空） |
| 未跑 | `scripts/gate.sh` / `pnpm -r test` / 任何全量包套件（并发纪律） |
