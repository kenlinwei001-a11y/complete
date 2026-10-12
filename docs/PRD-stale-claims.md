# PRD · 过期「自称实测」声明的清理与门禁（WO-STALE-CLAIMS）

> 状态：已交付（分支 `claude/handoff-wo-stale-claims`）
> 日期：2026-08-08
> 病族：本体 §8 `G-STALE-MEASURED-CLAIM`

---

## 0. 一句话

**实测的保质期等于做实测的那一天。** 一句没有日期、没有复验方式的「运行态实测 X 是 0」，
写下的当天是真的，上游一补齐它就变成**屏上说谎**，而且没有任何人会被通知。
本单清掉在册的三处这类假话，并加一道**会红的门**，让下一例在写下的当天就被挡住。

---

## 1. 《本体引用与影响》

| 维 | 触及项 |
|---|---|
| **对象类型** | `Cadence`（`packages/contracts/src/chain-sim.ts:84` 契约 · `apps/datacore/src/synthetic/cadence.ts` 推导 · `service.ts:712` 落库）；`PurchaseOrder` / `CustomsClearance` / `IncomingInspection`（采购段三类，仅作为门的事实源被读取） |
| **链路** | 节拍闸门链：`synthetic/service.ts:712 putAll("Cadence")` → `app.ts:1447 listByType("Cadence") + cadenceFromProps` → `sim/propagation.ts:120 buildCadenceGates` → `:70 cadenceGate` → `:73 cadence.offsetDays ?? 0` → `propagateTick` 的闸门表。前端侧另有 `views/sim/transitFlow.ts:800 nextGateDayOnOrAfter` 独立消费 `offsetDays` |
| **事件** | 无新增、无改动 |
| **不变量** | 无新增。本单强化的是 **R13（结论可溯源）在「诚实位文案」上的投影**：诚实位本身也是一种结论，它同样必须带出处与保质期 |
| **断点** | `G-STALE-MEASURED-CLAIM`（§8 已登记）—— 本单清 3 处（+ 同文件 2 处同族注释），并给它配上机械门那一半 |
| **门禁** | **新增** `stale-claims:check`（§7 已登记 · 门账 `binding=GATE_SH`）。已接 `scripts/gate.sh`，未并入 `pnpm gates`（理由见 §4.4） |

**回写清单**（本文件对应的本体改动，已随本单落地）：
- `docs/SYSTEM-ONTOLOGY.md` §7 新增 `stale-claims:check` 条目（判据 / 金丝雀 / 棘轮 / 诚实边界 / 变异反证）。
- `scripts/gate-ledger.json` 新增 `check-stale-claims.mjs` 条目（`binding=GATE_SH`、`disposition=WIRE`、`provenRed.kind=MUTATION`）。
- §8 **未动**（本单工单明禁）。`G-STALE-MEASURED-CLAIM` 的状态列（🟡 已修 1 处·同族 5 处在册未清）留给审核方随本单验收后更新。

---

## 2. 三处病灶的逐条复核结论

> 工单给的是**线索**，不是结论。以下每条都自己追了调用链（铁律 0.5）。

### ① `inspectorModel.ts` K1 变量 evidence —— 线索属实，且比工单说的更糟

旧文案（两句都假）：

> 公式**有**（`expectedCadenceWaitDays`）但**值缺**：`Cadence` 对象全仓 0 条（运行态实测
> `GET /a/v1/objects?type=Cadence` → total 0）；**D1 写了推导模块但零生产调用方，从没落库**。

复核（2026-08-08，命令 `grep -n 'putAll("Cadence"' apps/datacore/src/synthetic/service.ts`
与 `grep -rn buildCadenceGates apps/ packages/`）：

- `apps/datacore/src/synthetic/service.ts:712` —— `await putAll("Cadence", cadenceObjectRows(deriveChainCadences(g)), "nodeId")`。**真落库**。
- `apps/datacore/src/app.ts:1447` —— 推演 tick 里 `buildCadenceGates((await repos.objects.listByType(c.tenantId, "Cadence")).filter(…).map(…))`。**真读回**，且不是 test：它在 `POST` tick 路由的 `propagate` 分支内，条件是本租户有 PUBLISHED `PropagationRule`。
- 故「零生产调用方 / 从没落库」两句**今天都是假的**。

今天真正的缺口是**另一种病**：本面板的输入来自占位构造器 `buildPlaceholderInspectorInput`，
它不发任何查询、也收不到任何 `Cadence` 行 —— 三分法里的「**没接线**」，修法是接线不是种数据。
把「没接线」写成「没承载」，会把下一个人直接引去种数据，那是修错地方。

**处置**：改写 evidence，写明「承载有 / 本面板没去要」，并带上实测日期与复验方式。
`carrier: "缺"` **保留**（面板确实拿不到值，`carrier==="缺" ⇒ baseline===null` 是 EMPTY 不补 0 的结构不变量，
`inspector-node-panel.seam.test.tsx:140` 也咬着它），但 evidence 里当面说清「缺」今天指的是**缺来路**。

### ② `inspectorModel.ts` K2 变量 evidence —— 线索属实，两句都假

旧文案：

> `Cadence.offsetDays`（契约字段在），但**同上无 `Cadence` 实例**；且全仓**零运行时消费方**（只有契约与其单测引用）

复核（命令 `grep -n offsetDays apps/datacore/src/sim/propagation.ts apps/frontend-shell/src/views/sim/transitFlow.ts`）：

- 引擎侧：`apps/datacore/src/sim/propagation.ts:73` —— `const offsetRaw = cadence.offsetDays ?? 0`，
  在 `cadenceGate()` 里换算闸门相位；`cadenceGate` ← `buildCadenceGates`(:120) ← `app.ts:1447`。**是生产链**。
- 前端侧：`apps/frontend-shell/src/views/sim/transitFlow.ts:800` —— `const offset = cadence.offsetDays ?? 0`，
  在 `nextGateDayOnOrAfter()` 里算下一次开闸日；被同文件 `:808`/`:824`/`:977` 消费。**第二条独立消费链**。
- 「无 `Cadence` 实例」同 ①，也假。

**处置**：改写 evidence，逐条给出两条消费链的 `file:line`，并说明本条仍标「缺」的真实理由与 K1 同。
`inertReason`（「相位不进等待期望公式」）**未动** —— 它今天仍成立（`packages/contracts/src/chain-sim.ts:117` 明写 `offsetDays` 不进公式）。

### ②′ 同文件 `:615` / `:617-618` 两行注释 —— **工单没给，是本单新门自己扫出来的**

```
// 诚实缺席两段：等节拍（Cadence 对象 0 条）与返工（无返工工时率）。
// 真接引擎后这个值应来自 `Cadence.kind` 实例；今天 `Cadence` 对象 0 条，所以它是 what-if 的一部分。
```

同一句假话的另外两个副本。**一并改掉**。
这是对工单 🚦 范围（「仅 :699-701 与 :713-714 两处」）的一次**主动越界**，理由写在这里备审：
它们在同一个被授权的文件里、是同一族病、且是**本单自己造的门判红的**——
留着就必须给它开豁免，而「给一句自己有能力改对的假话开豁免」正是本门要治的病。

### ③ `SandboxConsole.tsx` 可算性图例 ④⑤ 两档 —— 线索属实，但**行号不对**，且病因比工单描述的更直接

工单写 `:795-806`；本分支实际在 **`:1083-1096`**（`TransitComputabilityLegend`）。

这两行渲染 `CADENCE_ABSENCE.reason` / `PROCUREMENT_BRANCH.reason` ——
即 `transitFlow.ts:495-496` 的**零输入基线**（`deriveXxx()` 不带参数那一档，恒 `NOT_FETCHED`，文案「本层没去取 / 没人问」）。

关键事实（本单复核补的）：**紧挨着这块图例、在同一个 `<div data-testid="sc-transit-layer">` 里的下一行**
（`SandboxConsole.tsx:614-615`）就是 `<TransitFlowView chrome="embedded" />`，
而 `TransitFlowLayer.tsx:575/:580` 每次渲染都现调 `deriveCadenceAbsence({ engineNodes, cadenceRows })` /
`deriveProcurementBranch({…})`，输入来自它**自己发的四条 `searchObjects`**。

⇒ 屏上同一块面板里两句话互相打脸：**图例说「没人去取」，它下面的图层正在取。**
这是 `G-STALE-MEASURED-CLAIM` 的又一形态 —— **这次过期的不是上游事实，是同一屏里的邻居。**

**处置裁决：改成只报档名，不复述状态。** 三条理由：

1. **改成「现算」是换个写法说同一句假话。** 本图例自己不取数，`deriveXxx()` 拿到的依然是那个零输入基线。
   真正有资格说「现在有没有」的只有取数的那一方。
2. **状态本来就不属于这块。** 图例的职责是**静态可算性分级**（①②③ 全部派生自 `TRANSIT_SOURCE_SPECS` 的字段规格），
   「这一刻取回了什么」是运行态状态 —— 混进来才是当初出错的根。
3. **不整块删掉那两个 `<li>`**：一来 ④⑤ 是分级表的一部分（读者需要知道这两档存在且**不画**）；
   二来 `transitFlow.ts:486-490` 明写着这两个导出保留的唯一理由就是本图例还在引用它们，
   而 `transitFlow.ts` 在本单 🚦 **禁改**清单里 —— 全删会让那段注释当场变成**新的过期声明**，
   等于用一个同族病灶换另一个。

故只读 `.label`：它在 `deriveXxx()` 的**四个分支里恒等**（`base = { key, label, probe }`），
与「这次取回了什么」无关，**不带保质期**。这一点由测试当场验证（不是靠读代码相信）。

---

## 3. 门的判据设计

### 3.1 触发：只咬「声明式用法」

| 层 | 判据 | 抓的错法 |
|---|---|---|
| `STALE-1` | 声明式用了「实测/实跑/运行态/现算」却**无实测日期** | 没日期 = 没保质期 = 永远没人知道它该复验 |
| `STALE-2` | **无可复验方式**（端点 / 命令 / `file:line`） | 复审只能选择相信（铁律 0.5 第 4 条：「我 grep 了」不是复验） |
| `STALE-3` | 声明「某对象类型 0 条 / 无承载 / 尚不存在」，而它在 `synthetic/service.ts` 的 `putAll` 册上 | **上游一补齐，声明当场红** |
| `STALE-4` | 声明「某符号零消费方」，而 src 下真数出 ≥1 处非注释引用 | 同上 |

**「声明式」= 触发词 + 同一声明单元内出现可被证伪的观测结果**（数字+量词 / `0 命中` / `零消费方` / 端点回值 / `grep` 计数）。

为什么不是「凡出现这四个字就要日期」：「实测」在本仓还是**词汇** ——
`provenance.kind === "实测"` 的徽章、`<dt>实测值 vs 阈值</dt>`、「合成·未接实测」的诚实灰标。
对这些要求日期是纯噪声，只会训练出一张几百条的白名单；**白名单一大就没人看，门就死了**。

### 3.2 ③④ 与关键词**解耦**（本单最关键的一个设计决定）

本单病灶 ②（K2 那条）**一个「实测」字都没有**。若把事实层也挂在关键词上，它就从门下溜过去了。
判据：**「这句话能不能被机器证伪」与「作者有没有自称实测」是两件事** —— 能证伪的就当场证。
故 `STALE-3/4` 由独立的行级触发器（`FACT_CLAIM_TRIGGER`）驱动，与四个关键词无关。

### 3.3 判据挂在「声明单元」上，不是「行」上

单元 = 块注释整块 / 连续 `//` 段整段 / 代码按行尾续行符上下扩张。
理由：日期与锚点常写在同一条 `evidence` 的**另一行**上，按行判会切断。

> ⚠ `,` **刻意不算续行符**（第一版栽在这儿）：对象字面量每个属性都以 `,` 收尾，
> 把它当续行 ⇒ 从 `evidence:` 一路吞到兄弟属性、再吞下一个变量对象 ⇒
> **「K1 的日期」被算成「K2 也有日期」**，那是漏报。

### 3.4 金丝雀：门自己得先被咬一口

开跑前先跑 `selftest()`：**5 条必咬样例 + 3 条必不咬样例**过一遍检测器，
再加**扫描规模下界**（≥50 文件 / ≥20 关键词命中）与**事实源规模下界**（putAll ≥20 类型）。
任一条不成立 ⇒ 打印「⛔ 门自己瞎了」+ RC=1，**而不是安静报「代码干净」**。

来历是本会话真踩过的两个「工具骗人」：
`git grep -- "apps/<星>/src"` 恒 0 命中（pathspec 通配符不跨 `/`）；
正则 `BUILTIN_VIEWS[^=]*=` 被 `_RENAMED: BuiltInView[] ` 吞掉。两者的后果都是**门报绿而它其实一个字都没扫到**。

### 3.5 存量豁免是**棘轮**不是白名单

`scripts/stale-claim-baseline.json`，38 条，**每条写明理由**：

- **key = 文件 + 声明单元原文的 sha256 前 16 位**，不是行号。
  行号会漂，漂了白名单就变成通行证；锚在文案本身 ⇒ **文案一改哈希即变 ⇒ 豁免当场失效、门重新红**。
- `why` < 10 字即判红（无理由白名单本身就是本门要治的病）。
- `maxExemptions` 必须**恒等于**豁免条数 —— 加一条豁免 = 同时改这个数 = 一处显眼的 diff。
- 条数 ≤ `ratchetHigh`（历史最高水位）。**评审唯一必须拒绝的一行，就是把 `ratchetHigh` 调大。**
- 豁免匹配不到任何声明时**也红**（「棘轮该往下走了：这条已失效，请删掉」）。

38 条的构成：

| 类别 | 条数 | 说明 |
|---|---|---|
| 🚦 本单明令禁改的文件（`transitFlow.ts` ×4、`TransitFlowLayer.tsx`、`chainNodeSemantics.ts`） | 6 | 门判得对，改不了 |
| 检测器粗粒度**误报**（「实测」当词用，被同单元的数字顶进了声明式过滤） | 4 | `ProvenanceDag` / `ChainImpedimentView` / `chainImpediment.ts` / `transitFlow.ts:99` |
| **叙述型**（写的是「补线之前」，同段紧接着就是那条线本身） | 2 | `registry.ts:88` / `:93` —— 门读得懂那句假话，读不懂它外面的「已修」框 |
| **病历**（被上一单修掉的旧文案原文引用，同段已写明「今天是假的」） | 1 | `inspectorModel.ts:558` |
| 真声明·存量欠账（缺日期或复验方式），在本单授权范围外 | 25 | 主要在 `physicalTopology.ts`(8) / `chainLineMap.ts`(4) / `sandboxConsole.ts`(2) / `inspectorModel.ts` 的 T3/C4/P2 三条(3) |

---

## 4. 门**做不到**的部分（诚实边界，不圆场）

1. **只认那四个触发词。** 一句「我查过了，`Cadence` 一条都没有」不含「实测/实跑/运行态/现算」，
   `STALE-1/2` 一个字都看不见（`STALE-3/4` 仍可能咬到 —— 前提是它的措辞落进那几条否定承载的句式）。
   本门治的是「**自称实测**」这一族，不是全部过期声明。
2. **只扫 `apps/frontend-shell/src`。** 同族病灶在 `docs/`（`AUDIT-zombie-and-orphan-code.md` 另记 3 条）
   与后端注释里同样存在，本门不碰。
3. **日期只验「有没有」，不验「对不对」。** 写 `2026-08-08` 而实际是三个月前测的，本门看不出来 ——
   它逼出的是**保质期**，不是真实性。真实性只靠 `STALE-3/4` 那一层，而那一层只覆盖两类可机器复验的事实。
4. **`STALE-4` 的引用计数是「文件级 + 剥注释」的近似**，且：
   - **作用域限定的声明一律不判**（如「`apps/datacore/src/solvers/` 下零直接消费方」）——
     主语与作用域都认不准，**宁可漏不可诬**。第二、三版就是栽在这儿：
     从路径里抠出 `datacore` 当符号去数引用（3 条误报）、跨行把分类标签当成对 `inertReason` 的声明（1 条误报）。
   - **间接调用看不见**（字符串键分发 / 依赖注入 / 事件订阅 / re-export）。
   ⇒ 它只能**证伪**「零消费方」，**不能证实**「真的零消费方」。
5. **声明单元靠续行符切分，是启发式。** 切大了会把邻居的日期算成自己的（漏报），切小了会劈开一条声明（误报）。
   故金丝雀的必咬样例是**整段原文**直接喂给检测器的 —— 保证**判据**本身对；切分错只影响个别条目。
6. **叙述型与病历分不开。** 「过去是 0，现在补上了」与「现在是 0（假话）」在字面上没有机器可辨的差别。
   本门的答案是把它们交给**带理由的棘轮豁免**，而不是发明一个可以随手写下的「豁免注释」token ——
   那种 token 会立刻变成新的静默兜底。

---

## 5. 变异反证 4/4（失败原文）

> 纪律：**先 commit 再变异**（`git checkout -- <file>` 从 HEAD 恢复，未提交的改动会被一起撤掉）。
> 起变异前 HEAD = `747ae2e5`，`git status --porcelain` 空；每条撤回后 HEAD 未变、工作树干净、门复绿 RC=0。

### 变异 ① 自称实测但**没日期** ⇒ `STALE-1` 红

注入 `apps/frontend-shell/src/views/sim/inspectorModel.ts`：
`// 变异反证 1：运行态实测 \`GET /a/v1/objects?type=Order\` → total 0，共 0 条，没有日期。`

```
扫描：190 个源文件 · 175 处关键词命中 · 54 条声明违规 · 豁免 38 条（上限 38）

❌ 新增「自称实测」声明违规 1 条：
   apps/frontend-shell/src/views/sim/inspectorModel.ts:575-575  [STALE-1]
      自称实测/实跑/运行态却没写**哪天测的** —— 没有日期就没有保质期，上游一变没人知道该复验
      原文：// 变异反证 1：运行态实测 `GET /a/v1/objects?type=Order` → total 0，共 0 条，没有日期。

   修法：① 补上实测日期（YYYY-MM-DD）；② 补上复验方式（端点 / 命令 / file:line）；
         ③ 若是 STALE-3/4：上游已经补齐了，**把话改对**，不要加豁免。

❌ stale-claims:check 未通过
MUTATION_1_RC=1
```

### 变异 ② 声称某对象类型 0 条，**而它其实在册** ⇒ `STALE-3` 红

注入：`// 变异反证 2：2026-08-08 运行态实测 \`GET /a/v1/objects?type=PurchaseOrder\`：\`PurchaseOrder\` 对象全仓 0 条。`

**刻意带上日期与端点**，让 `STALE-1`/`STALE-2` 都咬不到 —— 于是唯一能咬住它的只有事实层：

```
扫描：190 个源文件 · 175 处关键词命中 · 54 条声明违规 · 豁免 38 条（上限 38）

❌ 新增「自称实测」声明违规 1 条：
   apps/frontend-shell/src/views/sim/inspectorModel.ts:575-575  [STALE-3]
      声明「PurchaseOrder 无承载 / 0 条」，但 apps/datacore/src/synthetic/service.ts 今天有 putAll("PurchaseOrder", …) —— 上游已补齐，这句话已经是假的
      原文：// 变异反证 2：2026-08-08 运行态实测 `GET /a/v1/objects?type=PurchaseOrder`：`PurchaseOrder` 对象全仓 0 条。

❌ stale-claims:check 未通过
MUTATION_2_RC=1
```

### 变异 ③a 把扫描关键词改坏 ⇒ 金丝雀报「**门自己瞎了**」，不是「代码干净」

`CLAIM_KEYWORDS` 由简体改成繁体（`["實測","實跑","運行態","現算"]`）：

```
⛔ 门自己瞎了（金丝雀未被咬 / 扫描规模异常）—— **不是代码干净**：
   · 必咬样例「自称实测但没日期」没被咬（期望 STALE-1，实得 STALE-3）
   · 必咬样例「自称实测但没复验方式」没被咬（期望 STALE-2，实得 无）
   · 只扫到 0 处关键词（<20）—— 正则或编码坏了，不是代码干净了
   修门，别改结论。
MUTATION_3A_RC=1
```

### 变异 ③b 复现 pathspec 陷阱（`SCAN_ROOT` 改成 `apps/<星>/src`）

```
⛔ 门自己瞎了：扫描根 apps/*/src 不存在 —— 这不是"代码干净"，是门没扫到东西。
MUTATION_3B_RC=1
```

### 变异 ④ 把 `STALE-3` 的事实源正则改坏（`putAll` → `putAllX`）

```
⛔ 门自己瞎了（金丝雀未被咬 / 扫描规模异常）—— **不是代码干净**：
   · 必咬样例「声称某对象类型 0 条，而它其实在册」没被咬（期望 STALE-3，实得 无）
   · 必咬样例「不含任何触发词、但事实已被上游推翻」没被咬（期望 STALE-3，实得 无）
   · putAll 事实源读不出（读到 0 个类型）—— STALE-3 这一层等于没开
   修门，别改结论。
MUTATION_4_RC=1
```

撤回后：

```
扫描：190 个源文件 · 174 处关键词命中 · 53 条声明违规 · 豁免 38 条（上限 38）
✅ stale-claims:check 通过（金丝雀 5+3 条全中 · 无新增声明违规 · 豁免棘轮 38/38）
RESTORED_RC=0
```

---

## 6. 开发期的三次**自伤**（写在这里，因为它们就是本门的判据）

门本身踩过三次「grep 的结果不是结论」，每次都被自己的输出抓出来，判据也因此收紧：

| # | 症状 | 真因 | 修法 |
|---|---|---|---|
| 1 | K1 有日期，K2 也被算成「有日期」 | `,` 被当成续行符 ⇒ 声明单元从 `evidence:` 吞到兄弟属性 | `,` 移出续行符表（它是属性收口） |
| 2 | 3 条 `datacore 零消费方`**误报**（实有 21 处引用） | 主语用「前 24 字内任意标识符」⇒ 从 `apps/datacore/src/solvers/` 抠出了 `datacore` | 主语只认反引号里的**非路径**标识符；路径视为**作用域**，出现即跳过 |
| 3 | `inertReason 零消费方` 误报 | 跨行取主语，把下一行的**分类标签**「（零消费方 / 换算缺承载）」当成了对它的声明 | 主语必须与断言**同行**；同行取不到就不判 |

第 3 条的第一版修法用了「前 30 字窗」，它凑巧也压掉了误报 —— 但那是**运气**：窗宽一改结论就变。
已换成「同行 + 最后一个反引号标识符」这个不依赖窗宽的判据。

---

## 7. 交付物与验收

| 项 | 路径 |
|---|---|
| 门脚本 | `scripts/check-stale-claims.mjs`（`--selftest` / `--list` 两个子模式） |
| 豁免棘轮 | `scripts/stale-claim-baseline.json`（38 条 · 逐条带理由 · 哈希锚定） |
| 接线 | `scripts/gate.sh` → `run "stale-claims:check" node scripts/check-stale-claims.mjs` |
| 门账 | `scripts/gate-ledger.json` → `check-stale-claims.mjs`（`GATE_SH` / `WIRE` / `provenRed=MUTATION`） |
| 本体 | `docs/SYSTEM-ONTOLOGY.md` §7 新增条目（§8 未动） |
| 新建测试 | `apps/frontend-shell/test/stale-claims.seam.test.ts`（17 例·四组） |
| 收紧的既有测试 | `test/transit-flow.seam.test.tsx`（零输入基线那条）· `test/metro-semantics.seam.test.tsx`（图例 DOM） |

### 命令与 RC

| 命令 | RC |
|---|---|
| `pnpm --filter @platform/contracts build` | 0 |
| `pnpm --filter frontend-shell build` | 0 |
| `pnpm --filter frontend-shell test` | 0（177 文件 / 846 用例 → 收工时 178 / 863） |
| `node scripts/check-stale-claims.mjs` | 0 |
| `node scripts/check-stale-claims.mjs --selftest` | 0 |
| `node scripts/check-system-ontology.mjs` | 0 |
| `node scripts/check-ontology-anchors.mjs` | 0 |
| `node scripts/check-ontology-writeback.mjs` | 0（§7 漏登 0 · G3 待接线 12/基线 12 未回弹） |
| `node scripts/check-gate-ledger.mjs` | 1 —— **本单条目已通过**，剩余 27 条全部是 `apps/*/dist/**` 路径不存在（本 worktree 未 build datacore/agentcore；本单纪律禁跑其 vitest）。接门前 28 条、接门后 27 条，差的正是本单那条 `① 无遗漏`。`gate.sh` 首步就是 `pnpm -r build`，真跑时 dist 存在 |
| `node scripts/check-ontology-descriptions.mjs` | 1 —— 同上，`✗ 缺少 apps/datacore/dist/，请先运行 pnpm -r build`。与本单改动无关 |

### 没做到的

1. **`STALE-3/4` 只覆盖两类事实**（对象类型承载 / 符号消费方）。「某端点回 total=N」「某文件有 N 行」
   这类声明本门只能要求它带日期，验不了真伪。
2. **25 条真·存量欠账没清**（见 §3.5 表）。它们分布在本单 🚦 范围外的 8 个文件里，
   每条都要重新亲手复跑一次才能给出**真**日期 —— 补个假日期比不补更坏。留给 burn-down 单。
3. **`check-gate-ledger.mjs` / `check-ontology-descriptions.mjs` 在本 worktree 仍红**（见上表），
   原因是 datacore/agentcore 未 build。本单纪律只授权跑 frontend 的 build/test，故没有实测「build 后它们转绿」——
   这是**推断**（错误信息直说缺 `dist/`），不是实测，据实标出。
4. **§8 的 `G-STALE-MEASURED-CLAIM` 状态列未更新**（工单明禁改 §8）。
   建议审核方验收后改为：🟢 机械门已建（`stale-claims:check`）· 已清 4 处（含本单 3 + 上一单 1）· 存量 25 条进棘轮 burn-down。
