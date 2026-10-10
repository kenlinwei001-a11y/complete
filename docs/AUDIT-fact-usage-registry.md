# AUDIT-fact-usage-registry — 事实使用注册表全量审计

> 单：WO-FACT-USAGE-REGISTRY（2026-08-17 建门 · 2026-08-18 收口接线）
> 门：`fact-usage:check`（`scripts/check-fact-usage.mjs`，已并入 `pnpm gates` · 门账 `binding=GATES_CHAIN`）
> 数据复现：`node scripts/check-fact-usage.mjs --census`（一条命令现算全量，本文是它的落账快照 + 解读）
> 机器消费：`node scripts/check-fact-usage.mjs --json`

---

## 1 · 这张表是什么、为什么值得收口

`docs/PRD-harness-ux-adoption.md` §4.2 明账 **B-3（U5 跨屏面）** 的原账写着：

> 要比对「同一事实在两屏的值」，先得知道**哪个事实出现在哪两屏**。
> 本仓没有「事实 → 读取它的页面集合」的可枚举注册表 —— 连该比哪两个数都列不出来，真浏览器也无从下手。

本审计交付的就是这张注册表（`scripts/lib/fact-usage.mjs` **现算自前端 AST，不手抄名单**），
以及守它不退化的门（`fact-usage:check`）。⚠️ **注册表收口 ≠ B-3 已验**：
「两屏的值相不相等」要真渲染读 DOM，归 `WO-GATE-B-BROWSER-HARNESS` —— 本表是它的**输入清单**。

## 2 · 粒度裁决：事实键 = `<族>:<源键>#<字段路径>`

三族并存、不互译：

| 族 | 键形 | 例 |
|---|---|---|
| solver | `solver:<key>#<path>` | `solver:affected_orders#rows` |
| object | `object:<TypeKey>#<path>` | `object:Line#utilization` |
| rest | `rest:<METHOD /url/模板>#<path>` | `rest:A /a/v1/sim/sessions#id` |

候选①「按端点当事实键」被现算证据否掉：本仓求解器调用全部塌缩进两条 URL 模板
（`/a/v1/solvers/{}/invoke` ← `invokeSolver` · `/b/v1/solvers/{}/run` ← `runSolver`，
`--census` 首段逐条打印塌缩证据），按端点则 21 个求解器只剩 2 个键，跨屏比对无意义。

**args 不进键、单列 argsSig** ⇒ 跨屏对分两类：

- **EQUAL-EXPECTED**：两屏同口径，该断言读数相等；
- **CALIBER-DIVERGENT**：同源同字段不同 args（「7 日 vs 14 日」那类分叉），
  值**本就该不同**，该断言的是**屏上各自标明口径**。

## 3 · 全量数据（2026-08-18 现算 · 集成线 `claude/verify-reclaim-6` tip）

| 指标 | 数 |
|---|---|
| 页（现算名册：renderer 注册表 + 静态 route 两支） | **80** |
| 前端源文件（`apps/frontend-shell/src`，剔 `mocks/` 假数据源） | 226+ |
| 事实总数 | **462**（solver 151 · object 49 · rest 262） |
| 跨 ≥2 屏的事实 | **72**（solver 36 · rest 25 · object 11） |
| B-3 该比的跨屏对 | **824**（EQUAL-EXPECTED 818 · CALIBER-DIVERGENT 6） |
| 抽不出来的读取位（如实留白，§7） | 16 |

读取面 = 页根组件的**本地 import 传递闭包**（类型导入与动态 import 不入图，理由见 §6 坑①）。
闭包规模前十的页（`--census` 逐页全量打印备查）：

```
 86 读取位 · 闭包 64 文件 · sim-sandbox
 79 读取位 · 闭包 18 文件 · cleanroom-attr
 66 读取位 · 闭包 34 文件 · order-chain
 55 读取位 · 闭包 15 文件 · dashboard
 50 读取位 · 闭包 23 文件 · plan-audit
 49 读取位 · 闭包 31 文件 · global-sim
 46 读取位 · 闭包 41 文件 · risk-board
 45 读取位 · 闭包 27 文件 · plan-generate
 44 读取位 · 闭包 25 文件 · project-sim
 32 读取位 · 闭包  7 文件 · quarterly-rolling
```

## 4 · 口径分家 6 组（B-3 的真候选 · 全量）

这 6 对是「同一事实、两屏、不同 args」——值本就该不同，**该断言屏上各自标明口径**：

| 事实 | 屏对 | args 口径 |
|---|---|---|
| `solver:affected_orders#rows` | `dashboard` ↔ `order-chain` | `...,horizon` vs `∅` |
| `solver:affected_orders#rows` | `dashboard` ↔ `risk-board` | `...,horizon` vs `∅` |
| `solver:affected_orders#rows` | `order-chain` ↔ `risk-board` | `...,horizon` vs `∅` |
| `solver:affected_orders#rows[].risks[].base` | `order-chain` ↔ `risk-board` | `...,horizon` vs `∅` |
| `solver:bottleneck_matrix#factors[]` | `project-sim` ↔ `risk-board` | `baseIds,dataMode` vs `dataMode` |
| `solver:bottleneck_matrix#rows[].base` | `project-sim` ↔ `risk-board` | `baseIds,dataMode` vs `dataMode` |

注：`solver:affected_orders#rows` 一条事实在三屏两两组合出 3 对，故 4 条事实 ⇒ 6 对。

## 5 · 跨 ≥2 屏的事实 72 条（B-3 真正要比的清单 · 全量）

| 事实键 | 屏数 | args 口径 | 屏集合 |
|---|---|---|---|
| `rest:A /a/v1/sim/propagation-rules?published={}#items` | 12 | `∅` | admin/ontology-relations · decision-play · disruption-radius · global-sim · optimize-whatif · order-chain · plan-generate · project-sim · risk-board · sim-sandbox · sop-balance · what-if |
| `rest:A /a/v1/sim/propagation-rules?published={}#items[].sourceTypeKey` | 11 | `∅` | decision-play · disruption-radius · global-sim · optimize-whatif · order-chain · plan-generate · project-sim · risk-board · sim-sandbox · sop-balance · what-if |
| `rest:A /a/v1/sim/propagation-rules?published={}#items[].sourceTypeName` | 11 | `∅` | decision-play · disruption-radius · global-sim · optimize-whatif · order-chain · plan-generate · project-sim · risk-board · sim-sandbox · sop-balance · what-if |
| `rest:A /a/v1/sim/propagation-rules?published={}#items[].targetTypeKey` | 11 | `∅` | decision-play · disruption-radius · global-sim · optimize-whatif · order-chain · plan-generate · project-sim · risk-board · sim-sandbox · sop-balance · what-if |
| `rest:A /a/v1/sim/propagation-rules?published={}#items[].targetTypeName` | 11 | `∅` | decision-play · disruption-radius · global-sim · optimize-whatif · order-chain · plan-generate · project-sim · risk-board · sim-sandbox · sop-balance · what-if |
| `rest:A /a/v1/sim/propagation-rules?published={}#stateVarNames` | 11 | `∅` | decision-play · disruption-radius · global-sim · optimize-whatif · order-chain · plan-generate · project-sim · risk-board · sim-sandbox · sop-balance · what-if |
| `rest:A /a/v1/sim/sessions#id` | 11 | `∅` | decision-play · disruption-radius · global-sim · optimize-whatif · order-chain · plan-generate · project-sim · risk-board · sim-sandbox · sop-balance · what-if |
| `rest:A /a/v1/lineage/object/{}/{}#derivations` | 10 | `∅` | dashboard · global-sim · ledger · optimize-whatif · order-chain · plan-audit · project-sim · risk-board · sop-balance · what-if |
| `rest:A /a/v1/lineage/object/{}/{}#derivations[].formula` | 10 | `∅` | dashboard · global-sim · ledger · optimize-whatif · order-chain · plan-audit · project-sim · risk-board · sop-balance · what-if |
| `rest:A /a/v1/lineage/object/{}/{}#source.connection.id` | 10 | `∅` | dashboard · global-sim · ledger · optimize-whatif · order-chain · plan-audit · project-sim · risk-board · sop-balance · what-if |
| `rest:A /a/v1/lineage/object/{}/{}#source.connection.lastSyncAt` | 10 | `∅` | dashboard · global-sim · ledger · optimize-whatif · order-chain · plan-audit · project-sim · risk-board · sop-balance · what-if |
| `rest:A /a/v1/lineage/object/{}/{}#source.connection.name` | 10 | `∅` | dashboard · global-sim · ledger · optimize-whatif · order-chain · plan-audit · project-sim · risk-board · sop-balance · what-if |
| `rest:A /a/v1/lineage/object/{}/{}#source.rawDataset` | 10 | `∅` | dashboard · global-sim · ledger · optimize-whatif · order-chain · plan-audit · project-sim · risk-board · sop-balance · what-if |
| `rest:A /a/v1/lineage/object/{}/{}#source.rawDataset.name` | 10 | `∅` | dashboard · global-sim · ledger · optimize-whatif · order-chain · plan-audit · project-sim · risk-board · sop-balance · what-if |
| `rest:A /a/v1/lineage/object/{}/{}#source.rawRowIdx` | 10 | `∅` | dashboard · global-sim · ledger · optimize-whatif · order-chain · plan-audit · project-sim · risk-board · sop-balance · what-if |
| `rest:A /a/v1/timeseries/agg-query#points` | 4 | `∅` | dashboard · risk-board · sim-sandbox · tasks/:taskId |
| `rest:B /b/v1/queries#taskId` | 3 | `∅` | admin/data-builder · scenarios · sim-sandbox |
| `solver:affected_orders#rows` | 3 | `...,horizon` vs `∅` | dashboard · order-chain · risk-board |
| `solver:decision_play#rootCause` | 3 | `«args»` | chain-impediments · decision-play · order-chain |
| `object:Base#items[].id` | 2 | `∅` | admin/calibration · geo-map |
| `object:Base#items[].props.name` | 2 | `∅` | admin/calibration · geo-map |
| `object:Cadence#items` | 2 | `∅` | sim-sandbox · transit-flow |
| `object:CustomsClearance#items` | 2 | `∅` | sim-sandbox · transit-flow |
| `object:IncomingInspection#items` | 2 | `∅` | sim-sandbox · transit-flow |
| `object:InterBaseTransfer#items` | 2 | `∅` | sim-sandbox · transit-flow |
| `object:Order#items[].id` | 2 | `∅` | global-sim · project-sim |
| `object:Order#items[].props.so` | 2 | `∅` | global-sim · order-chain |
| `object:PurchaseOrder#items` | 2 | `∅` | sim-sandbox · transit-flow |
| `object:Shipment#items` | 2 | `∅` | sim-sandbox · transit-flow |
| `object:WIPLot#items` | 2 | `∅` | sim-sandbox · transit-flow |
| `rest:A /a/v1/process-definitions#definitions` | 2 | `∅` | process-instances/:instanceId · process-stuck |
| `rest:A /a/v1/solvers/registry{}#solvers[].key` | 2 | `∅` | admin/plan-builder · admin/workflows |
| `rest:A /a/v1/solvers/registry{}#solvers[].name` | 2 | `∅` | admin/plan-builder · admin/workflows |
| `rest:A /a/v1/sync-jobs/{}#status` | 2 | `∅` | admin/connections · admin/modeling |
| `rest:A /a/v1/synthetic/jobs/{}#report` | 2 | `∅` | admin/data-builder · admin/synthetic |
| `rest:B /b/v1/catalog/packages/{}/intents{}#[].key` | 2 | `∅` | admin/catalog · admin/scenes |
| `rest:B /b/v1/queries/{}#answer.provenance[].id` | 2 | `∅` | sim-sandbox · tasks/:taskId |
| `rest:B /b/v1/scenarios/{}/launch#taskId` | 2 | `∅` | admin/data-builder · scenarios |
| `solver:affected_orders#rows[].risks[].base` | 2 | `...,horizon` vs `∅` | order-chain · risk-board |
| `solver:audit_timeline#crossDay` | 2 | `kind` | plan-audit · plan-generate |
| `solver:audit_timeline#peak` | 2 | `kind` | plan-audit · plan-generate |
| `solver:audit_timeline#series` | 2 | `kind` | plan-audit · plan-generate |
| `solver:audit_timeline#threshold` | 2 | `kind` | plan-audit · plan-generate |
| `solver:bottleneck_matrix#factors[]` | 2 | `baseIds,dataMode` vs `dataMode` | project-sim · risk-board |
| `solver:bottleneck_matrix#rows[].base` | 2 | `baseIds,dataMode` vs `dataMode` | project-sim · risk-board |
| `solver:generic_inference#[].capGain` | 2 | `...,apply` | project-sim · risk-board |
| `solver:generic_inference#[].impact` | 2 | `...,apply` | project-sim · risk-board |
| `solver:generic_inference#[].key` | 2 | `...,apply` | project-sim · risk-board |
| `solver:generic_inference#[].label` | 2 | `...,apply` | project-sim · risk-board |
| `solver:generic_inference#[].ruleFlag` | 2 | `...,apply` | project-sim · risk-board |
| `solver:ksf_graph#edges` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#edges[].from` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#edges[].kind` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#edges[].to` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#finNodes[]` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#finNodes[].actual` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#finNodes[].id` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#finNodes[].name` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#finNodes[].status` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#finNodes[].target` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#finNodes[].unit` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#ksfNodes` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#ksfNodes[]` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#ksfNodes[].id` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#ksfNodes[].key` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#ksfNodes[].name` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#ksfNodes[].sub` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#problems[]` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#problems[].id` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#problems[].name` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#problems[].severity` | 2 | `∅` | plan-audit · plan-generate |
| `solver:ksf_graph#summary` | 2 | `∅` | plan-audit · plan-generate |

每条事实的**逐屏依据链**（哪个 file:line、经哪个绑定读的）见 `--census` 对应条目；
门判据 D3 强制依据链非空，说不出依据的记录 = 手抄名单的等价物，当场红。

## 6 · 三条金丝雀纪律的落实（各被实证栽过一次）

① **扫描面**：金丝雀证明工具没瞎，**不证扫描面选对了**。第一版把 20+ 视图的
`import type { ViewRendererProps } from "./registry"` 纯类型边当依赖，registry 连同它
lazy 到的 28 个渲染器全被拖进闭包 ⇒ 23 个互不相干的页闭包全是 104 文件 / 510 读取位，
而金丝雀当时 14/14 全中。已改判据「类型导入与动态 import 一律不入图」，
并各配一条**可证伪**的金丝雀（⑮⑯，改回即 RC=2）。

② **覆盖率**：金丝雀全中不保证覆盖全。react-query 的 `mutate`/`isPending`/`error`
曾被当成后端字段 ⇒ **256 条伪事实**（金丝雀全中期间）。已按**结构判据**
（必须经 `.data`）修掉，不用字段名黑名单。故门判据 D1 必带**独立词面口径逐族对总数**
（剥注释后的第二把尺；2026-08-18 实测 solver 词面 39 → AST 47 · object 词面 18 → AST 62，
逐族均不少于词面，且不拿含 rest 的总数去盖单族缺口）。

③ **计数**：`sourceCalls` 曾按多路 `+=` 累加，同一个 `await runSolver(...)` 被数两次
⇒ 覆盖率虚高。已修为按绑定去重。

**变异反证（建门轮，各跑一次，均当场红）**：
A 类型导入重新入图 → RC=2「⑮ 闭包爆炸」·
B 动态 import 重新入图 → RC=2「⑯ 把别的页读了什么记到本页头上」·
C 基线上调模拟棘轮回退 → RC=1 且指明 `--tighten` 才是显式改账的路。还原后 RC=0。

**变异反证（收口轮 T1，拆哪半哪半红）**：
拆登账（脚本在、`gate-ledger.json` 无条目）⇒ `gate-ledger:check` 判据①红
「门脚本 scripts/check-fact-usage.mjs 未登账」；
账写 `binding=GATES_CHAIN` 但未接 `pnpm gates` ⇒ 判据③红
「账里写 binding="GATES_CHAIN"，现算是 "NONE"——账与现实脱节」。补齐两半后 RC=0。

## 7 · 抽不出来的 16 条（静态分析看不见，如实留白）

**数据源键不是字符串字面量（变量/常量表间接下发）⇒ 事实键不可静态定名**（8 条）
- `apps/frontend-shell/src/components/QueryDock/Clarification.tsx:155`
- `apps/frontend-shell/src/pages/Object360Page.tsx:16`
- `apps/frontend-shell/src/pages/Object360Page.tsx:26`
- `apps/frontend-shell/src/pages/admin/ObjectTypesBrowserPage.tsx:24`
- `apps/frontend-shell/src/pages/admin/PlanBuilderPage.tsx:126`
- `apps/frontend-shell/src/views/DisruptionRadiusView.tsx:195`
- `apps/frontend-shell/src/views/LedgerView.tsx:31`
- `apps/frontend-shell/src/views/WhatIfView.tsx:218`

**useQuery 的取数函数里找不到已知数据源调用（可能经自定义封装/变量键下发）**（2 条）
- `apps/frontend-shell/src/components/ReferencesPanel.tsx:68`
- `apps/frontend-shell/src/pages/admin/SliceLayersPanel.tsx:275`

**useMutation 的取数函数里找不到已知数据源调用（可能经自定义封装/变量键下发）**（1 条）
- `apps/frontend-shell/src/pages/admin/DomainsPage.tsx:18`

**数据源键不是字符串字面量 ⇒ 事实键不可静态定名**（5 条）
- `apps/frontend-shell/src/views/DashboardView.tsx:646`
- `apps/frontend-shell/src/views/process/ProcessStartFromTemplate.tsx:127`
- `apps/frontend-shell/src/views/sim/DynamicLeverPanel.tsx:316`
- `apps/frontend-shell/src/views/sim/chainFamilyLines.ts:113`
- `apps/frontend-shell/src/views/sim/sandboxConsoleModel.ts:895`

这些读取位**不是「没有事实」，是静态分析定不了名** —— 留白本身被 `--census` 打印、
被本文登记，不许被读成「覆盖全了」。真浏览器 harness 跑 B-3 时可在运行期补认。

## 8 · 守门机制（判据 D1–D4 · 棘轮纪律）

- **D1 抽取器没瞎（先于一切）**：金丝雀（条数现算自 `CANARY_IDS`，与主逻辑共用同一份实现）
  + 独立词面口径逐族对总数。任一不成立 ⇒ **RC=2「工具坏了」**，不许报「注册表没变化」。
- **D2 规模棘轮**：事实条数 / 跨屏事实条数 / 跨屏对数相对 `scripts/fact-usage-baseline.json`
  **只许涨不许跌**。跌 = 有读取位从受检面掉出去（`G-GATE-ROSTER-HANDCOPIED` 同族：
  掉出去的那条永远绿）。有意收缩走 `--tighten` 显式改账，不许静默。
- **D3 依据链非空**：每条事实 × 每个页都要说得出 file:line + 绑定符号。
- **D4 口径分家清单不许静默缩小**：CALIBER-DIVERGENT 对数同样上棘轮 ——
  它悄悄变少通常意味着某一屏的读取位没被认出来。

退出码三分：0 干净 · 1 真违规 · 2 门自己坏了（金丝雀不中 / 扫描面塌了 / 独立口径对不上）。

基线当前值（`scripts/fact-usage-baseline.json` 的 `min`）：facts **462** · multiScreenFacts **72** ·
pairs **824** · caliberDivergent **6** —— 2026-08-18 经 `--tighten` 收紧（只许涨不许跌方向的
正当记账：集成线前进带来真实增长，收紧前门已 RC=0，收紧是把实测下限固化，不是消红）。
建门轮零点为 454/64/546/6；本轮增长全部来自集成线新并的页面与读取位。
基线写入走共享写入器 `scripts/lib/baseline-doc.mjs`（`baseline-writer-honesty:check` 判据②③
合规：写入点实参内联 `buildBaselineDoc()` · 开跑先跑 `baselineDocCanary()`），
人手改过的 `_doc` 与人手新增的顶层键逐字节留存（已实测：埋探针键 + 改 `_doc[0]` 后
`--tighten`，两者原样留存，算出的 `min`/`lastSeen` 确实被更新）。

## 9 · 本体引用与影响（铁律 0）

- **对象类型**：无新增；注册表是派生制品（现算投影，非新真值源）。
- **链路**：`apps/frontend-shell/src/**`（读取位）⊗ `api/endpoints.ts`（端点真值源）
  ⊗ `views/registry.ts` + `App.tsx`（页名册真值源）→ 注册表 → B-3 跨屏比对（待派）。
- **不变量**：与 R13（结论可溯源）同向 —— 每条事实带 file:line 依据链。
- **断点**：闭 §8 `G-FACT-USAGE-UNREGISTERED`；是 `G-SPLITACCOUNT-PROMISE-ONLY`
  缩小后缺口③ 的地基。与 `G-GATE-ROSTER-HANDCOPIED` 同族不同灶的防护（D2/D4 棘轮）。
- **门禁**：§7 新增 `fact-usage:check` 条目；门账 `scripts/gate-ledger.json` 同批登账。

## 10 · 下一步（可派）

**`WO-GATE-B-BROWSER-HARNESS`（B-3 部分）现在可派**：输入 = 本文 §5 的 72 条 × 屏集合
（或 `--json` 的 `pairs` 数组，824 组逐组带 file:line）；其中 §4 的 6 组口径分家对
**不该断言相等**，该断言「屏上各自标明口径」（horizon / baseIds 字样可见）。
16 条静态留白（§7）由运行期补认，不属于静态门的债。
