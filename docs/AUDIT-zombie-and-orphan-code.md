# AUDIT · 僵尸代码与孤立代码彻查

> **WO-ZOMBIE-AUDIT** · 基线 `640acb74`（`claude/integration-sandbox-batch`）· 2026-08-08
> **零代码改动**：本单只出证据，不改一行实现。
> **纪律**：铁律 0.5 —— grep 的结果不是结论，每条都追到「真正被谁调用、在什么条件下触发」才allowed下结论。
> 拿不准的一律标「存疑·未追实」并**排除在结论清单之外**（见 §6）。

---

## 0 · 结论摘要

| 清单 | 条数 | 说明 |
|---|---|---|
| ③ **幽灵引用**（引用了不存在的东西 → 静默失效） | **4** | 危害最高：静默错答，无报错 |
| ④ **诚实缺席声明过期**（写着「不存在」而今天已存在） | **3**（另 1 条已修·作范本） | 会让下一个人去造已经有的东西 |
| ① **僵尸代码**（有实现、零生产调用方） | **43 条真死**（**追实 14 条**）+ 234 条 test-only 候选 | 逐条列出调用方集合与形态判定 |
| ② **孤立代码**（文件级无人 import） | 12 个候选 → **真孤立 2 · 有害 1 · 其余 9 条为正常形态** | 12 个**全部**逐个追实并分类 |

**追实率**：本报告下结论的每一条都追到了「真正被谁调用、在什么条件下触发」。
**6 条一开始判错、追一层后被推翻**（见 §7 与 §5.5）——这是本单最值钱的部分。
另有**负结果 2 组**（§5.5：6 个 feature flag 全在册 · 10 个疑似幽灵导航项全有真种入），
**已排除，别再查一遍**。

### 最狠的三条

1. **【③-1】产能页拨杆：整个「设备层」四个原子因子永远反推不出来，其中 `设备OEE` 单独传入时返回零杠杆——空面板，无报错。**
   `LEVER_FACTOR_PROPS.设备OEE = ["Equipment.oee_current"]`，而 `CAPACITY_FACTOR_BINDINGS` 里**没有 `oee_current`**（它把 OEE 建模成 `oeeA/oeeP/oeeQ` 三个分量）。两张注册表口径不一致，交集处静默塌陷。
   **更狠的是**：本该交叉校验这两张表的函数 `factorPropKeys()` 就写在 `capacity-factors.ts:94`，注释白纸黑字写着「LEVER_FACTOR_PROPS 派生/校验用」——**零调用方**。防这个 bug 的门造好了，从没挂上。

2. **【④-1】前端两块「诚实缺席」面板把早已存在的数据当面宣告为不存在，且是无条件硬渲染。**
   `transitFlow.ts` 的 `PROCUREMENT_BRANCH` / `CADENCE_ABSENCE` 是 `const` 字面量，JSX 里 `EMPTY` 是**写死的**，不查任何数据。它们声称「清关与到货检验 0 命中」「Cadence 0 命中」——今天 `CustomsClearance`/`IncomingInspection` 各在 8 个文件里真实存在，`Cadence` 经 `synthetic/service.ts:712` 真落库。
   这正是 `chain-loss.ts` 的 `STRUCTURAL_GAPS` 已经被治好过一次的**同一种病（#67 同病复发），后端半治了，前端半还病着**。

3. **【①-1】契约明令「不许手拼字符串」的单源函数 `chainOpNodeId()` 零调用方，而生成侧正在手拼。**
   `chain-sim.ts:224` 原文：「生成侧与消费侧都必须走本函数 / `CHAIN_OP_NODE_PREFIX`，不许手拼字符串。」
   实际：消费侧（`sandboxConsole.ts:252`）守规矩用了前缀常量；**生成侧 `chain-loss.ts:589` 写的是 `` `capacity.op.${opCode}` `` 模板字面量**。门 `check-chain-node-singlesource.mjs` 抓不到——它只校验 id **在册或匹配 op 前缀**，手拼出来的串恰好合法。这就是 `G-CHAIN-NODEID-FREESTRING`（两个 dev 各造一套词表、交集为 0）的**动态半残留**。

---

## 1 · 金丝雀与工具自证（每批扫描都做过）

本仓踩过「工具骗人 → 得出恰好相反的结论」的坑，故每批扫描先自证工具。

| 批次 | 金丝雀 | 结果 |
|---|---|---|
| 全批 pathspec 自证 | `git grep -c "createIntent" -- "apps/*/src"` | **0 个文件命中 ⇒ 工具坏了**（pathspec 的 `*` 不跨 `/`）。已弃用该写法。 |
| 全批 pathspec 自证 | `git grep -c "createIntent" -- "apps/**/src/**"` | 5 文件命中 ⇒ 正确写法 |
| 符号扫描（scan2/scan3） | 脚本内置 `createIntent` 断言，命中 0 即 `exit 2` 中止 | 每次运行都打印 `CANARY OK: createIntent in 5 src files` |
| 扫描面非空自证 | 脚本打印 `src=519 test=573 scripts=71` | 与 `find` 独立计数（597 含 .sh/.mjs）一致，未静默扫空 |
| import 图·金丝雀 1（相对/别名路径） | `endpoints.ts` 必须有 ≥1 importer | 107 个 ⇒ 该路径通 |
| import 图·金丝雀 2（barrel/`.js` 说明符） | `contracts/src/solvers.ts` 必须有 ≥1 importer | **首版为 0 ⇒ 解析器坏了**（`.js` 说明符没回映射到 `.ts`）。修好后边数 696→1761，孤立数 317→12 |

> **金丝雀的正确用法（本单实测教训）**：**一个金丝雀只为它走过的那条路径作证。**
> import 图有「相对路径 / `@/` 别名 / barrel `.js` 说明符 / 动态 import」四条解析路径，
> 我只给了第一条金丝雀，它绿了，于是我差点发布一份说「contracts 整包是死代码」的报告。
> **多路径的工具必须每条路径一个金丝雀。**

**额外避开的坑**：
- `rg -r` 是 `--replace` 不是 recursive —— 全程未用 `-r`。
- 对象字面量简写 `{ ...spec, vocab }` 对 `grep 'vocab:'` 不可见 —— 故符号扫描走**标识符 token 索引**（把每个文件 `match(/[A-Za-z_$][\w$]*/g)` 全量切词），不依赖 `符号:` 这类形状。
- 字符串键分发（如 `args.mode === "levers"`、`putAll("Cadence", …)`）grep 符号名看不见 —— 故对每条结论**额外按字符串实参再搜一次**。

**证据可复现**：本报告 §2.1 的杠杆交集结论由一段纯函数重放脚本产出（两张表都是模块级常量，过滤逻辑是纯函数，无需起服务）。

> **本次未能起服务取证**：本 worktree **没有 `node_modules`、没有 `dist`**（`ls node_modules` → 不存在；`apps/datacore/dist/server.js` → 不存在），起内存态服务需先 `pnpm install && build`，而本单纪律明令不跑 build。故所有结论均为**静态追链 + 纯函数重放**，未经 curl 实测。**凡结论依赖运行态数据的，我一律标了「存疑·未追实」并排除**（见 §6）。

---

## 2 · 清单③ · 幽灵引用（危害最高：静默失效，不报错）

### 2.1 【③-1】`设备OEE` 杠杆恒空 + 整个设备层不可达 🔴 最狠

**链路（逐跳追实）**

| 跳 | 位置 | 内容 |
|---|---|---|
| 1 | `apps/frontend-shell/src/views/RiskBoardView.tsx:876-888` | 产能页渲染 `<DynamicLeverPanel grain="process-model" factors={[card.factor, ...bnFactors]} …>` —— **生产实参同时带 `grain` 和 `factors`** |
| 2 | `apps/frontend-shell/src/views/sim/DynamicLeverPanel.tsx:136` | `discoverLevers({ factors, …, ...(grain ? { grain, modelId } : {}) })` |
| 3 | `apps/datacore/src/solvers/service.ts:657` | `if (str(args.mode) === "levers") return this.discoverLevers(...)` ← **字符串键分发，grep 符号名看不见** |
| 4 | `apps/datacore/src/solvers/service.ts:703` | `if (args.grain) return this.discoverCapacityLevers(ctx, args);` ← **路径开关** |
| 5 | `apps/datacore/src/solvers/service.ts:850` | `wantProps = new Set(factorFilter.flatMap((f) => LEVER_FACTOR_PROPS[f] ?? []))` |
| 6 | `apps/datacore/src/solvers/service.ts:851-853` | `cands = CAPACITY_FACTOR_BINDINGS.filter((b) => b.writable && matchesGrain(b.grain, grain) && wantProps.has(\`${b.objectType}.${b.prop}\`))` |

**断点**：第 5 跳产出的属性键，与第 6 跳过滤的属性键**来自两张互不校验的表**。

- `LEVER_FACTOR_PROPS`（`service.ts:355-363`）
- `CAPACITY_FACTOR_BINDINGS`（`packages/contracts/src/capacity-factors.ts:47-73`）

**纯函数重放结果**（两表皆模块级常量 ⇒ 过滤是纯函数，结论确定性）：

```
A. LEVER_FACTOR_PROPS 中 CAPACITY_FACTOR_BINDINGS 没有的属性（5 个）：
   Equipment.oee_current · MaterialBalance.coverage · Order.outsourceRatio
   Process.shiftHours    · Shipment.etaDay

B. grain='process-model'（生产实参）下逐因子候选数：
   设备OEE   -> 0 个候选   <<< 硬空：返回零杠杆
   瓶颈工序  -> 1（⑩Line.utilization）
   良率波动  -> 1（⑥Process.yield_baseline）
   物料齐套  -> 2（⑬Material.onHand, ⑮Material.leadTime）
   人力工时  -> 2（⑯Process.shifts, ⑰Process.attendance）
   换型损失  -> 1（⑤ChangeoverMatrix.changeoverMin）
   物流时长  -> 1（⑮Material.leadTime）
   对照组：不传 factors -> 13 个候选（全部可写绑定）

D. 传入全部 7 因子（bnFactors 携 bottleneck_matrix 七因子枚举时的真实情形）-> 7 个候选，
   而以下 6 个 writable + 同颗粒的绑定**永远不可达**（没有任何因子指向它们）：
   ① Equipment.ctSeconds · ③ Equipment.oeeA · ④ Equipment.oeeP · ⑦ Equipment.oeeQ
   ② Process.channels    · ⑧ Process.utilization
```

**危害（两种，都静默）**

1. **硬空**：当传入的因子集合全部解析不出可用属性时（如 `bn` 未加载 ⇒ `bnFactors=[]` 且 `card.factor==="设备OEE"`），`cands=[]` ⇒ 杠杆面板全空。用户看到的是「这个瓶颈没有可拨的杠杆」，实际是两张表对不上。
2. **静默缺项**（更常见）：传 7 因子时面板有 7 根杠杆，但 **`Equipment.*` 一根都没有**——产能金字塔第 1 层（设备层 ①③④⑦）整层不可达。卡面明明写着主瓶颈是「设备OEE」，能拨的却全是别的层。

**形态判定**：**② 接了线没数据 / 接错口径**（不是没接线——`matchesGrain` 在 `service.ts:853` 有真生产调用方）。精确说是**两张注册表口径漂移**，交集处静默塌陷。

**同一处的第二个病灶（放大器）**：`packages/contracts/src/capacity-factors.ts:94 factorPropKeys()` —— 注释写明「`${objectType}.${prop}` 全集（LEVER_FACTOR_PROPS 派生/校验用）」，**src 0 调用方、test 0 调用方、门脚本 0 调用方**。本该防住本条 bug 的交叉校验函数从未接线（见 §4 僵尸清单 Z-01）。

**建议处置**：不是删代码，是**接线 + 对齐**。二选一：
- (A) `LEVER_FACTOR_PROPS.设备OEE` 改为 `["Equipment.oeeA","Equipment.oeeP","Equipment.oeeQ"]`（与绑定表同口径），并给 `节拍/通道/利用率` 补因子键；
- (B) `CAPACITY_FACTOR_BINDINGS` 补 `Equipment.oee_current` 一行。
无论选哪条，**都应把 `factorPropKeys()` 接进一条断言**（单测或门），否则同一处必然再漂。

> ⚠ **这是「路径开关假绿」的教科书形态**（CLAUDE.md 铁律 0.5 第 6 条）：
> `apps/datacore/test/ontology-core.test.ts:594` 确实测了 `factors: ["设备OEE"]` 并断言有杠杆——
> 但它**不传 `grain`**，于是走的是 `service.ts:703` 的另一条分支（通用 `discoverLevers` 沿派生 DAG 反推），
> **根本不碰 `CAPACITY_FACTOR_BINDINGS`**。生产传的那个值（带 `grain`）× 传因子，**没有任何测试覆盖**。
> 「这个函数有测试」证明不了「生产走的那个分支有测试」。

---

### 2.2 【③-2】`decision-play` 在导航里是幽灵条目

**已在 `docs/PRD-nav-gate.md:168-171` 记录，本单复核为真并补强了证据。**

- `apps/frontend-shell/src/pages/ShellLayout.tsx:57`：`decision-play` 登记在「推演」组，`kind:"view"`。
- `UnifiedNav`（`ShellLayout.tsx:~100`）：`const it = viewByKey.get(ref.key); if (!it) return null;` —— 查不中**静默 return null**，永远不渲染，也不报错。
- **本单补强的判据（两种模式都查了）**：
  - `rg '"decision-play"' apps/datacore/src` → **0 命中**（既不在 `BUILTIN_VIEWS`，也不在 `synthetic/service.ts` 的 `EXTRA_VIEW_KEYS`/`VIEW_DEFS` 那条**第二种种入路径**）
  - `rg '"decision-play"' apps/frontend-shell/src/mocks` → **0 命中**（mock 模式的 `allViews` 也没有）
  ⇒ **真实模式与 mock 模式下 `viewByKey.get("decision-play")` 都恒 `undefined`。**
- 后端 `view-manifest.ts:54-56` 写明是**知情的诚实排除**：「只有前端 renderer + 专用静态路由，**没有** VIEW_DEF / VIEW_FEATURE_MAP / view.decision-play 功能——配置不完整。种一个会 404 的破视图不如不种」。
- **第三张表还以为它存在**：`packages/contracts/src/admin.ts:92` 的视图键清单里有 `decision-play`。

**形态判定**：**幽灵引用**，但**不是不可达**——`App.tsx:138` 有静态路由 `/v/decision-play`，`DashboardView.tsx:159` 有按钮直达。
**危害等级：中**（不是「用户到不了」，是「导航里那一条恒不显示」）。门 `scripts/check-nav-group-coverage.mjs:45` 已显式豁免这个键（「走 App.tsx 静态路由**不报**」）——**豁免是知情的，不是遗漏**。

**建议处置**：留证不动。`docs/WO-GLOBALSIM-GLASS-REDESIGN.md:104` 已排期「decision-play 单独入口去留另起小 WO」。

---

### 2.3 【③-3】`LEVER_FACTOR_PROPS` 另外 4 个属性在绑定表缺席

同 §2.1 的 A 组，除 `Equipment.oee_current` 外还有 4 个，危害低一档（它们所属因子还有别的属性兜底，不会硬空）：

| 属性 | 声明处 | 在 `CAPACITY_FACTOR_BINDINGS` | 后果 |
|---|---|---|---|
| `MaterialBalance.coverage` | `service.ts:358` + `:374`(META) | ❌ | 物料齐套因子少一个候选 |
| `Order.outsourceRatio` | `service.ts:358`/`:360` | ❌ | 外协杠杆在 capacity grain 下不可达 |
| `Process.shiftHours` | `service.ts:359` | ❌ | 班次工时不可拨 |
| `Shipment.etaDay` | `service.ts:361` | ❌ | 在途时效在 capacity grain 下不可达 |

> **注意区分**：这 4 个属性**本身在本体里是存在的**（`MaterialBalance.coverage` 见 `docs/PRD-data-backfill.md` G1 已裁决补数据；`Shipment.etaDay` 已存在）。
> 缺的是**它们在 `CAPACITY_FACTOR_BINDINGS` 里没有登记**，所以 capacity grain 这条路过滤不到。
> 这与「属性不存在」是两回事，**修法不同**——不要去补数据，要去补绑定表登记。

**形态判定**：③ 接了线接错地方（挂在 `LEVER_FACTOR_PROPS` 上，但 capacity 路走的是绑定表）。

---

### 2.4 【③-4】`Equipment.oee_current` 与绑定表的 OEE 三分量口径分裂（根因登记）

单独列出是因为它是 §2.1 的**根因**，且会误导修复方向：

- `Equipment.oee_current` **真实存在且有真数据**：`synthetic/battery.ts:954` 定义属性，`battery.ts:3623` 由 `oeeA×oeeP×oeeQ` 派生落值，`solvers/risk.ts:157-159` 真读它算张力。
- `CAPACITY_FACTOR_BINDINGS` 把设备 OEE 拆成 ③`oeeA` ④`oeeP` ⑦`oeeQ` 三个可写原子。

两种建模都对，但**没有任何一处声明二者的换算关系给过滤器用**。
⚠ **谁去修都要先读这一条**：看到「`oee_current` 不在绑定表」的第一反应是「补数据」——**错**。数据在，缺的是登记/换算。

---

## 3 · 清单④ · 「诚实缺席声明」过期（会让下一个人去造已经有的东西）

### 3.1 【④-1】`transitFlow.ts` 两块 EMPTY 面板宣告的「不存在」，今天全部为假 🔴

**文件**：`apps/frontend-shell/src/views/sim/transitFlow.ts`
**渲染处（无条件硬渲染，不查数据）**：
- `TransitFlowLayer.tsx:830-838`（`<b>{PROCUREMENT_BRANCH.label} · EMPTY</b>` —— **`EMPTY` 是 JSX 里的字面量**）
- `TransitFlowLayer.tsx:552-560`（`CADENCE_ABSENCE`）
- `SandboxConsole.tsx:795-806`（两块都渲染）

**逐条核对**

| # | `transitFlow.ts` 原文声明 | 今天的事实 | 判定 |
|---|---|---|---|
| a | `:131` 「清关（customs）与到货检验（IQC）在 `apps/datacore/src` 与 `packages/contracts/src` **均 0 命中** —— 两段完全无承载。」 | `CustomsClearance` 命中 **8 个文件**（`solvers/extended.ts`·`solvers/service.ts`·`solvers/chain-loss.ts`·`synthetic/battery-extended.ts`·`synthetic/data-categories.ts`·`synthetic/service.ts`·`synthetic/battery.ts`·`contracts/procurement.ts`）；`IncomingInspection` 同样 8 个文件 | **过期·为假** |
| b | `:126` `reason`（UI 主显那一行）「本体缺在途承载物：无 ASN、无清关段、无到货检验段」 | 同上，清关段与到货检验段都已存在 | **过期·为假**（`无 ASN` 这半句**仍为真**，未核出 ASN 对象） |
| c | `:135` `unblockedBy`「等 **WO-SANDBOX-D2**（补清关/到货检验两段）」 | D2 已落地——`chain-loss.ts:286-290` 的注释明写「D2 在那之后落了 `CustomsClearance`/`IncomingInspection`/`PurchaseOrder` 四段日戳」 | **过期** |
| d | `:146` 「`"Cadence"` 作为对象类型在 `apps/datacore/src` 与 `packages/contracts/src` **0 命中**；`apps/datacore/src/synthetic/cadence.ts` 在本分支基线**不存在**（D1 未并线）」 | `cadence.ts` **存在**；`synthetic/service.ts:712` `await putAll("Cadence", cadenceObjectRows(deriveChainCadences(g)), "nodeId")` **真落库**；`Cadence` 在 contracts 命中 4 个文件；`app.ts:1426` 有真消费方 | **过期·为假** |

**为什么这条最危险**：它不是注释，是**渲染给用户看的产品文案**。用户在推演沙盘上读到的是「采购在途支线 · EMPTY · 本体缺在途承载物」，而后端此刻真有这些对象。同时它会让下一个 dev 去「补清关段」——**造一个已经有的东西**。

**形态判定**：**④ 诚实缺席声明过期**，叠加 **② 接了线没数据 → 实为「接了线但前端从不查」**。
根子上是**硬编码诊断**：`PROCUREMENT_BRANCH`/`CADENCE_ABSENCE` 是 `const` 字面量，**不接受任何数据输入**，因此它永远不可能自愈。

**这是已治愈过一次的病的复发**：`docs/SYSTEM-ONTOLOGY.md` `G-CHAIN-NODEID-FREESTRING` 记载 E1 的
`chain-loss.ts STRUCTURAL_GAPS` 正是「`const` 字面量数组，无条件 push 成 EMPTY，即便数据落了库也照印不误」，
已按「运行时按对象查表——查到出真环节，查不到才 EMPTY 且 `reason` 取自数据行」修好（见 `chain-loss.ts:286-290` 的修正注释）。
**后端半治好了，前端半是同一个病灶的镜像，没治。**

**测试为何没咬住**（假绿形态）：`apps/frontend-shell/test/transit-flow.seam.test.tsx:310` 断言的是
`expect(PROCUREMENT_BRANCH.evidence.length).toBeGreaterThanOrEqual(3)` —— **断言的是「理由条数 ≥ 3」，
从不校验这些理由是否为真**。`:386` 对 `CADENCE_ABSENCE` 同样只数条数。测试咬的是**借口的数量**，不是**借口的真假**。

**建议处置**：改成运行时查表（照抄 `chain-loss.ts` 已验证的修法）——查到出真数据，查不到才 EMPTY 且 `reason` 取自数据行。**在那之前，这两块面板显示的内容是错的。**

---

### 3.2 【④-2】`chain-loss.ts STRUCTURAL_GAPS` —— ✅ **已修**（作范本收录，无需行动）

`apps/datacore/src/solvers/chain-loss.ts:286-290` 现存的注释本身就是这次修复的记录：

> ⚠ 这三行是**一条过期诊断的修正**，不是新功能：本文件 §3 的 `STRUCTURAL_GAPS` 直到本单之前
> 还写着「清关段在本体里完全不存在…grep 0 命中（2026-08-05 实测）」，而 D2 在那之后落了
> `CustomsClearance`/`IncomingInspection`/`PurchaseOrder` 四段日戳。**那句取证在写下的当天是真的，今天是假的。**

**收录理由**：这段话是本仓对该病的最佳自述，且**它的前端镜像（§3.1）还没修**。

---

### 3.3 【④-3】`PRD-sandbox-redesign.md` 引 `G-DECISION` 的闭合前措辞

- `docs/SYSTEM-ONTOLOGY.md:942`：`G-DECISION` 状态为 **`✅ 已闭`**（decision_play 引擎垂直切片真跑，7 测绿）。
- `docs/PRD-sandbox-redesign.md` §3.3 第 2 条仍引用其**闭合前**的「无决策推演引擎」措辞。

**形态判定**：④ 文档过期（**仅文档，无运行时危害**）。
**建议处置**：由审核方在回写本体时一并订正措辞（本单不动文档）。

> **未追实的部分**：我核对了 `SYSTEM-ONTOLOGY.md` 侧的 `✅ 已闭` 状态属实，但**未逐字比对
> `PRD-sandbox-redesign.md` §3.3 的全文**（该文件很长且不在本单危害优先级前列）。此条按「已知范本」收录，
> 结论限于「本体侧已闭合」这半句，其余标**存疑**。

---

## 4 · 清单① · 僵尸代码（有实现、零生产调用方）

**扫描方法**：单遍标识符 token 索引（519 src / 573 test / 71 scripts 文件），对 3835 个导出符号求
「除自身定义文件与 `index.ts` barrel 外的 src 引用集」。**类型/接口已排除**（结构化使用是正当的，不算调用方）。
筛出 **43 个行为型导出（const/function/class）在自身文件内也只出现 1 次**——即连内部都没用。

**下表 12 条是逐条追实的**（追了 barrel re-export / 字符串键分发 / 高阶函数 / 事件订阅四条隐路）。
剩余 31 条列在 §4.13 作**候选**，标注为未逐条追实。

| # | 符号 | file:line | 调用方集合（逐个列出） | 形态 | 建议处置 |
|---|---|---|---|---|---|
| **Z-01** | `factorPropKeys` | `packages/contracts/src/capacity-factors.ts:94` | src **0** · test **0** · 门脚本 **0** · 文档 1（`PRD-capacity-live-cockpit.md:100` 只提名） | **① 没接线** | **接线**（不是删）——它正是 §2.1 那个 bug 的解药 |
| **Z-02** | `writableFactorBindings` | `packages/contracts/src/capacity-factors.ts:83` | src **0** · test **0** · 门脚本 **0** | **① 没接线**（且有**行内重复实现**） | 用它替换 `service.ts:851-853` 的行内 filter，或删 |
| **Z-03** | `chainOpNodeId` | `packages/contracts/src/chain-sim.ts:227` | src **0** · test **0** · 门脚本 **0** | **① 没接线，且契约明令必须用它** | **接线**：`chain-loss.ts:589` 改调本函数 |
| **Z-04** | `isDecisionRoute` | `apps/agentcore/src/router/ceo-route.ts:177` | 全仓仅定义行本身（`rg` 全库 1 命中） | **① 没接线** | 查证是否漏挂路由判定；否则删 |
| **Z-05** | `subscriptionsForView` | `apps/agentcore/src/event-subscriptions.ts:108` | 全仓仅定义行本身 | **① 没接线** | 见下方⚠事件订阅追证 |
| **Z-06** | `compileWithResourcePackage` | `apps/agentcore/src/router/compile-plan.ts:196` | 全仓仅定义行本身 | **① 没接线** | 查证资源包编排是否漏挂 |
| **Z-07** | `VirtualList` | `apps/frontend-shell/src/components/ui/VirtualList.tsx:6` | 全仓仅定义行本身 | **① 没接线**（整文件孤立，见 §5） | 删或接线 |
| **Z-08** | `rngFromInput` | `apps/datacore/src/prng.ts:33` | src 0 · test 0 · 脚本 0 | ① 没接线 | 存疑：R6 确定性相关，删前需确认 |
| **Z-09** | `CHAIN_LOSS_STEP_KINDS` | `apps/datacore/src/solvers/chain-loss.ts:940` | src 0 · test 0 · 脚本 0 | ① 没接线 | 候选删 |
| **Z-10** | `ceoDatasetReport` | `apps/datacore/src/synthetic/ceo-dataset.ts:279` | src 0 · test 0 · 脚本 0 | ① 没接线 | 候选删 |
| **Z-11** | `scenarioByIntent` | `apps/agentcore/src/scenarios-catalog.ts:124` | src 0 · test 0 · 脚本 0 | ① 没接线 | 候选删 |
| **Z-12** | `summarizeSteps` | `apps/datacore/src/databuilder/workflow-engine.ts:195` | src 0 · test 0 · 脚本 0 | ① 没接线 | 候选删 |
| **Z-13** 🔴 | `checkProvisionalHonesty` | `apps/datacore/src/databuilder/provisional-honesty.ts:12` | src **0** · 门脚本 **0** · test **5 处**（`a18-provisional-closure.test.ts:5/45/47/55/75`） | **① 没接线 = 假绿第 9 形态** | **接线**（红线守门函数，详见 §5.2） |
| **Z-14** | `NoopWorkflowCheckpointStore` 及整模块 | `apps/agentcore/src/workflow/checkpoint.ts:22` | src **0**（`executor.ts` 的 `WorkflowRunDeps` 无 checkpoint 字段）· test 1 | **① 没接线**，且唯一实现是空体 Noop | 删或真实现，别留形状（§5.1） |

### 4.1 Z-03 详解（最狠的一条僵尸）

`packages/contracts/src/chain-sim.ts:220-231` 原文：

```
 * **逐工序节点的动态命名空间**（`capacity.op.<opId>`）。
 * 工序节点数量随 Routing/Operation 实例变化，**不可能进静态注册表**。
 * 但前缀仍须单源 —— 否则「注册表管固定节点、工序节点各写各的」等于漏了一半。
 * 生成侧与消费侧都必须走本函数 / `CHAIN_OP_NODE_PREFIX`，不许手拼字符串。
export const CHAIN_OP_NODE_PREFIX = "capacity.op." as const;
export function chainOpNodeId(opId: string): string { return `${CHAIN_OP_NODE_PREFIX}${opId}`; }
```

**追一层的结果**（这一层是关键，只看 `chainOpNodeId` 的 0 命中会得出「删掉它」的错结论）：

- **消费侧守规矩**：`apps/frontend-shell/src/views/sim/sandboxConsole.ts:33` import `CHAIN_OP_NODE_PREFIX`，`:252` 用 `n.nodeId.startsWith(CHAIN_OP_NODE_PREFIX)`。✅
- **生成侧违规**：`apps/datacore/src/solvers/chain-loss.ts:589` —— `` const nodeId = `capacity.op.${opCode}`; `` ⇐ **正是契约禁止的手拼字符串**。
- **门为什么不报**：`scripts/check-chain-node-singlesource.mjs` 的 `N 命名空间` 判据是「字面量必须在册**或属 `capacity.op.`**」。手拼出来的串**恰好合法**，门绿。门校验的是「取值合法」，契约要求的是「必须走单源函数」——**两件事**。

**危害**：今天不出错。但 `CHAIN_OP_NODE_PREFIX` 一旦改动，`chain-loss.ts:589` 静默不跟随 ⇒ 生成侧与消费侧词表分裂 ⇒ 精确复现 `G-CHAIN-NODEID-FREESTRING`（D1/E1 两套词表交集为 0、两边单测全绿、链路整条断开）。**这个门就是为防这件事造的，而它防不住这一处。**

**处置**：`chain-loss.ts:589` 改为 `chainOpNodeId(opCode)`（一行接线，零风险）。**不要删 `chainOpNodeId`。**

### 4.2 ⚠ Z-05 `subscriptionsForView` 的追证（本条我改过一次结论，见 §7）

`apps/agentcore/src/event-subscriptions.ts:108` `subscriptionsForView(view: string)` —— 全仓 `rg` 仅命中定义行。
按「事件订阅可能被间接调用」的提醒，我额外追了：`EVENT_SUBSCRIPTIONS` 表本身**是否**有别的消费方（有，见下），
以及是否存在字符串键分发绕过函数名。

**结论**：`subscriptionsForView` 这个**函数**零调用方；但它读的那张表 `EVENT_SUBSCRIPTIONS` 另有消费方
（`event-subscriptions.ts` 内部与其它路径），所以**不能说「视图事件订阅整体没接线」**——
只能说「按 view 查订阅的这个便捷函数没人用」。**形态 = ① 没接线（仅此函数），危害低。**

---

### 4.13 其余 31 条真死候选（**未逐条追实 —— 不作为结论**）

以下为 scan3 的原始产出，**我只跑到「token 索引 0 引用」这一步，没有逐条追第二层**，
故按本单纪律**列为候选而非结论**。其中 `endpoints.ts` 一族（19 条）是前端 API 客户端封装，
形态大概率同为「① 没接线」，但**未逐个确认是否经字符串路径/动态 key 调用**：

`apps/frontend-shell/src/api/endpoints.ts` — `finalizeSopVersion:256` · `fetchRuleDoc:347` ·
`fetchScenarioPackages:400` · `createScenarioPackage:401` · `patchScenarioPackage:403` ·
`fetchModelingDraft:497` · `fetchSolverArtifact:664` · `checkSolverWriteTruth:666` ·
`fetchActionDraft:673` · `fetchScenes:681` · `putScene:682` · `fetchAgent:784` · `fetchWorkflow:791` ·
`cloneLlmProvider:858` · `fetchBuildPlan:872` · `fetchStoryRun:877` · `fetchWorkflowRun:891` ·
`newDataBuilderVersion:909` · `publishDataBuilder:911`

其余：`ReconcileResultSchema`（`contracts/writeback-echo.ts:17`）· `RuleDocStatusSchema`（`contracts/datacore.ts:79`）·
`ReferencesResponseSchema`（`contracts/ontology-governance.ts:83`）· `PROCUREMENT_LEG_STEP_KIND`（`contracts/procurement.ts:76`）·
`EXC_SEVERITY_ORDER`（`contracts/exception-event.ts:44`）· `ActionErrorCodes`（`contracts/actions.ts:194`）·
`FeatureErrorCodes`（`contracts/features.ts:43`）· `SKELETON_SCENARIO_EXAMPLE`（`agentcore/router/orchestration-skeleton.ts:193`）·
`SCOPE_WIRING_BADGE`（`frontend/views/sim/sandboxConsole.ts:77`）· `EQUIPMENT_TYPE_SOURCE`（`frontend/views/sim/physicalTopology.ts:45`）·
`inspectorControlOf`（`frontend/views/sim/InspectorNodePanel.tsx:688`）· `gapTier`（`frontend/views/plan/QuarterlyRollingView.tsx:15`）

> ⚠ **`ActionErrorCodes` / `FeatureErrorCodes` 这类错误码常量要特别小心**：错误码极可能以
> **字符串字面量**形式在别处使用（`"FEATURE_NOT_FOUND"` 直接写），token 索引看不见这种用法。
> 判「死」之前必须按**取值**再搜一遍。本单未做，故不下结论。

---

### 4.14 test-only 导出（假绿第 9 形态候选，234 条 —— **未逐条追实**）

`scan2` 另筛出 234 个「src 零消费、仅 test 引用」的导出。**这一类必须与「零引用」严格分开**：
它们是**已排练，不是已实现**——实现有、测试有、且是绿的，零生产调用方，测试咬的是**函数**不是**链路**。

因绝大多数是**类型/接口**（`optimizer-client.ts` 的 Request/Result 族就占了 20+，它们是 RPC 契约类型，
被同文件的函数签名结构化使用，属正当），**逐条追实成本远高于收益**，本单**只报总数与形态，不逐条列举**。
若要治理，建议先按「行为型（const/function/class）+ 非 Schema」二次收窄再追。

---

## 5 · 清单② · 孤立代码（文件级无人 import）

**方法**：建**真 import 图**（518 个 src 文件，解析 1761 条边），处理静态 `import`、`export … from`、
动态 `import("…")`、`@/` 别名、以及 **ESM `.js` 说明符回映射到 `.ts`**（见下方⚠）。排除入口文件
（`server.ts`/`main.ts`/`index.ts`/`migrate.ts` 等天然无人 import）。

> ### ⚠ 本节差点整节报废 —— 第三次「工具骗人」
> 首版 import 图报出 **317 个孤立文件**，`packages/contracts/src/` 几乎全表在列。
> 这个数字本身就是警报：`solvers.ts` 不可能没人用。
> **病根**：contracts 的 barrel 用的是 ESM NodeNext 写法 `export * from "./solvers.js"`，
> 而我的解析器只试了 `./solvers` + `.ts/.tsx`，**从没把 `.js` 说明符映射回 `.ts` 源文件** ⇒ 整个 barrel 的边全丢。
> **我的第一个金丝雀（`endpoints.ts` 有 107 个 importer）是绿的**，但它只证明了
> **相对路径 + `@/` 别名**这条路通，**没覆盖 barrel/`.js` 这条路**。
> 补第二个金丝雀（`packages/contracts/src/solvers.ts` 必须有 ≥1 importer，否则 `exit 2`）后修好解析器：
> **边数 696 → 1761，孤立文件 317 → 12（缩水 26 倍）**。
> **教训：一个金丝雀只为它走过的那条路径作证。** 多路径解析器就得有多个金丝雀。
> 若照首版发布，本报告会得出「contracts 整包是死代码」这个恰好相反的结论。

**12 个文件级孤立候选，逐个追实后分成四类**：

| 类 | 文件 | 追证结论 |
|---|---|---|
| **真孤立**（建议处置） | `apps/frontend-shell/src/components/ui/VirtualList.tsx` | 符号 `VirtualList` 全仓仅定义行；无 src importer、**无 test importer**、不在 `registry.ts` renderer 表、非路由组件。**真·零消费**。建议删或接线 |
| **真孤立**（建议处置） | `apps/agentcore/src/workflow/checkpoint.ts` | 见 §5.1，工作流检查点整模块从未接线 |
| **假绿第 9 形态**（有害） | `apps/datacore/src/databuilder/provisional-honesty.ts` | 见 §5.2，红线守门函数只在测试里跑 |
| **有意保留的兼容垫片**（无害·**我推翻了自己**） | `apps/datacore/src/solvers/args-schemas.ts` | 文件头自述「注册表本体已迁到 `packages/contracts/src/solver-args.ts`；**本文件保留为薄 re-export**，datacore 侧既有测试路径与 API 语义逐字节不变」。零 src importer 是**迁址的预期结果**，不是遗漏。**不建议删**（删了要同步改测试导入路径，收益为负） |
| **入口/CLI**（正常） | `datacore/src/migrate-cli.ts` · `datacore/src/seed-cli.ts` · `agentcore/src/migrate-cli.ts` · `agentcore/src/scripts/smoke-llm.ts` | 由 `package.json` script 调用，无人 import 是正常形态 |
| **测试/门脚本夹具**（正常） | `agentcore/src/llm/mock.ts` · `agentcore/src/mcp/mock.ts` | 见 §5.3 —— **`mcp/mock.ts` 我一开始判成孤立，追一层后推翻** |
| **就地单测**（正常） | `llm-adapters/src/slot-value-shape.test.ts` · `llm-adapters/src/openai.test.ts` | 测试文件与源码同目录（该包无 `vitest.config.ts`，走 vitest 默认 include `**/*.test.ts` ⇒ 能被采集）。**存疑·未追实：我没实跑该包测试确认这两个文件真的被执行**，故不下「它们没跑」的结论 |

### 5.1 `workflow/checkpoint.ts` —— 工作流检查点：接口 + 一个 Noop，没有别的

`apps/agentcore/src/workflow/checkpoint.ts` 全模块引用面：

- `WorkflowCheckpoint`（`:6`）· `WorkflowCheckpointStore`（`:15`）· `NoopWorkflowCheckpointStore`（`:22`）
- **全仓 `rg "checkpointStore|CheckpointStore|WorkflowCheckpoint"` 的命中全部落在 `checkpoint.ts` 自身**，
  外加一个测试导入（`apps/agentcore/test/runtime-workflow.test.ts:6`）。
- **`workflow/executor.ts` 从不引用检查点**：`WorkflowRunDeps`（`executor.ts:44`）里没有 checkpoint 字段。

**形态判定**：**① 没接线**。且唯一的实现是 `Noop`（`save`/`load` 都是空体）——
即便接上去也**什么都不做**。所以这不是「有能力没接」，是「连能力都还没有，只有形状」。
**危害**：工作流长跑中断后无法续跑；但因为从没接过，不存在「以为有检查点其实没有」的运行时错答。
**建议处置**：要么删（诚实承认没这个能力），要么实现——**但不要留着让人误以为已具备**。

### 5.2 `provisional-honesty.ts` —— 红线守门函数只在测试里跑 🔴

`apps/datacore/src/databuilder/provisional-honesty.ts:12` `checkProvisionalHonesty(run)`：

文件头自述其职责（PRD §3.5 / R13 红线）：
> 守"未审核态绝不谎报"的纯函数校验。① 整域 `domainTrustLevel=UNVERIFIED`；
> ② 终态验证恒 `PROVISIONAL_ANSWER`（**绝不 VERIFIED/answerable**）；③ 闭包缺口全降 ADVISORY。

**调用方集合（全仓 `rg` 逐条列出）**：
- `apps/datacore/test/a18-provisional-closure.test.ts:5`（import）· `:45`·`:47`·`:55`·`:75`（4 处断言）—— **全部是 test**
- src：**0** · 门脚本：**0**

**形态判定**：**① 没接线 = 假绿第 9 形态**（实现有、测试有、且是绿的，零生产调用方；
测试咬的是**函数**不是**链路**）。

**为什么这条危害高**：它不是普通工具函数，是一道**诚实红线闸**。今天没有任何生产路径
在 PROVISIONAL 域产出时调用它 ⇒ **没有任何东西阻止一个 PROVISIONAL 构建标成 `VERIFIED` / `answerable=true`**。
测试证明的是「这个函数能识别谎报」，不是「系统不会谎报」。
**建议处置**：**接线**（在 StoryBuildRun 落库/发布路径上挂一次），不是删。

### 5.3 ⚠ `mcp/mock.ts` —— 我判成孤立，追一层后推翻（第 5 次）

我的 import 图把 `apps/agentcore/src/mcp/mock.ts` 报成**零 importer**，且 `rg "mcp/mock"` 在 `apps/agentcore/src` 下确实 0 命中。
按符号名再追一层 `MockMcpClient`，真相翻面：

```
scripts/check-dril-registry.mjs:41   const { MockMcpClient } = await import(abs("apps/agentcore/dist/mcp/mock.js").href);
scripts/check-dril-quality.mjs:109   （同上）
scripts/check-dril-retrieval.mjs:122 （同上）
```

**三个门脚本经「动态 import + 字符串路径 + 指向 `dist/` 编译产物」消费它** ——
这条路对任何 src 层面的 import 图**都是不可见的**（既不是相对路径，也不在 src 树里）。
外加 `apps/agentcore/test/helpers.ts:8` 与 `runtime-mcp.test.ts:6` 两个测试消费方。

**结论：不是孤立文件，是门脚本夹具。** 若照 import 图直接发布，我会建议删掉一个**三道门都在用**的文件。

**方法学备注（给下一个人）**：本仓至少有**三条 import 图看不见的消费路径**，做孤立文件清单前必须先展开：
① `scripts/*.mjs` 里 `await import("apps/*/dist/**")`（**指向编译产物，不在 src 树**）；
② 前端 `registerRenderer("key", () => import("./X"))`（`views/registry.ts:56` 形态，字符串键 + 动态 import）；
③ `package.json` scripts 直接 `node dist/xxx-cli.js`。
漏掉任一条，产出的都是一份**假清单**。

---

## 5.5 · 已排除的假线索（负结果·**别再查一遍**）

负结果和正结果一样值钱——下面这些我查过了，**是干净的**，不要重复劳动：

| 线索 | 查法 | 结论 |
|---|---|---|
| **前端 6 个 feature flag 是否有幽灵** | 抽出 `flag="…"` 全集（`act.adopt-to-draft`·`act.export`·`opt.multiobj`·`view.global-sim.live`·`view.project-sim.whatif`·`view.task-dag`），逐个比对 `datacore/src/features.ts` 与 `agentcore/src/features/registry.ts` | **6/6 全部在册，无幽灵**。（`opt.multiobj` 与 `view.global-sim.live` 是 `defaultOn:false`，那是**有意的 entitlement 默认关**，不是 bug） |
| **`NAV_GROUPS` 里另外 10 个不在 `BUILTIN_VIEWS` 的视图键** | `order-chain`·`geo-map`·`graph-all/backbone/flow/source/solver/mvp/agent/loop` | **全部有真种入，不是幽灵**。它们走的是**第二条种入路径**——`synthetic/service.ts:60-69`（`EXTRA_VIEW_KEYS`）+ `:1586-1607`（`VIEW_DEFS`），并在 `features.ts:195-206` 有 feature 映射、mock `fixtures.ts:439-515` 也有。**`BUILTIN_VIEWS` 不是视图的唯一来源**——只比对它会误报 10 条 |

> ⚠ **这条差点成为本单第 6 次误判**：我按「`NAV_GROUPS` 视图键 − `BUILTIN_VIEWS`」做差集，
> 得到 11 个候选，几乎就要报「11 条幽灵导航项」。追一层（去 `synthetic/service.ts` 看第二条种入路径）后，
> **10 条被推翻，只剩 `decision-play` 一条是真的**。
> `view-manifest.ts` 自称「内置视图**唯一真相源**」，但那句话的作用域只到「内置」——
> `EXTRA_VIEW_KEYS` 是它管不着的另一批。**「唯一真相源」这五个字要读作用域，不能读字面。**

---

## 6 · 我没扫 / 没追实的部分（明说）

**没起服务**：本 worktree 无 `node_modules`、无 `dist`，起内存态服务需先 install+build，本单纪律禁止。
**因此所有涉及「运行态真实数据」的判断我一律没下结论**，包括：
- §2.1 的杠杆塌陷，我给的是**纯函数重放**（两张表是模块级常量，过滤是纯函数 ⇒ 结论确定性成立），
  但**「产能页实际打开后面板是否真的空」未经 curl/浏览器实测**。
- §3.1 的 `CustomsClearance`/`Cadence`，我核到了**代码与落库调用点**（`synthetic/service.ts:712`），
  但**未实测 `GET /a/v1/objects?type=Cadence` 的真实 total**。

**完全没扫的范围**：
- `packages/llm-adapters/src` —— 只在符号总扫里带过，**未做任何专项追证**。
- `scripts/` 的 71 个门脚本 —— 只作为「调用方集合」的一个来源被查询，**未反向审计门脚本自身的死代码/过期声明**。
- `apps/datacore/src` 的 **A0–A8 各模块内部**、`apps/agentcore/src` 的 **B1–B7 各模块内部** 未做逐模块深扫；
  本单是按「危害排序 + 追实优先」抽查，不是穷举。
- **数据库迁移 `migrations/*.sql` 与 `repo/pg.ts`/`repo/memory.ts` 三处一致性**完全未查
  （这是本仓「新增表需同时改三处」的已知易漏点，值得单独一单）。
- **未扫 `docs/` 全量的过期声明**——清单④只核了工单点名的 3 例 + 顺带发现的 1 例。
  `docs/` 有 80+ 份 PRD，过期声明的存量**几乎可以肯定远不止 3 条**。

**追到一半、按纪律不写进结论的**：
- 234 条 test-only 导出（未逐条区分「正当的结构化类型使用」与「真·假绿第 9 形态」）。
- 31 条真死候选（§4.13，尤其错误码常量需按**取值**而非**符号名**复搜）。
- `llm-adapters` 那两个就地 `.test.ts` 是否真被 vitest 采集执行——**未实跑确认**，
  故未下「它们没在跑」的结论（该包无 `vitest.config.ts`，理论上走默认 include 能采到）。

**本单结论的适用边界（一句话）**：所有结论都是**静态追链**的结论。
「代码里这条路走不通」我有把握；「用户点开那个页面看到的到底是什么」**我没有亲手看过**。
按本仓「绿测试 ≠ 能用」的同款逻辑，**读代码 ≠ 亲手真跑** —— §2.1 与 §3.1 若要进本体作为已坐实的断点，
建议由有完整依赖的环境 curl 一次坐实（两条都给了可直接验证的最小路径）。

---

## 7 · 一开始判错、追一层后被推翻的（本单最有价值的部分）

**五条。前三条是「grep 直接命中数」骗了我，后两条是「我自己的工具」骗了我。**

### 7.1 `matchesGrain` —— 差点连坐进僵尸清单

`capacity-factors.ts` 导出 4 个辅助函数，我第一遍扫下来 `factorPropKeys`/`writableFactorBindings`/
`factorBindingByMark` 全部零生产调用方，**顺手就想把 `matchesGrain` 一起判成「这个模块整体没接线」**。
追一层后：`matchesGrain` 在 `apps/datacore/src/solvers/service.ts:853` **有真生产调用方**，
而且是本次最重要那条链的关键一跳。

**教训**：「同一个文件里其它导出都死了」**不是**「这个导出也死了」的证据。**必须逐个符号追**，不能按文件连坐。
如果我按文件下结论，会把 §2.1 那条真 bug 整个错过——因为我会认定「这个模块没接线」，
而真相恰恰是「**接了线，而且正是这条线在静默塌陷**」。

### 7.2 `Equipment.oee_current` —— 差点判成「幽灵属性」

工单给的范本写「`LEVER_FACTOR_PROPS.设备OEE → Equipment.oee_current`，而 `capacity-factors.ts` 里没有该属性」。
我第一反应是「`oee_current` 是个不存在的属性 ⇒ 幽灵引用 ⇒ 补数据」。

追一层后**推翻**：`oee_current` **真实存在且有真数据**——`synthetic/battery.ts:954` 定义、`:3623` 由 A×P×Q 派生落值、
`solvers/risk.ts:157` 真读它算张力、`app.ts:495` 注释也点名它。

**真相是完全不同的一件事**：属性在，**缺的是它在 `CAPACITY_FACTOR_BINDINGS` 里的登记**。
**修法南辕北辙**——按第一反应会去 `synthetic/` 补数据（那里数据是全的，白改），
正确修法是在绑定表补登记或对齐口径。这正是 CLAUDE.md 说的「三种不工作混为一谈必修错地方」。

### 7.3 `chainOpNodeId` —— 差点判成「删掉它」

零调用方，第一反应「死代码，删」。追一层后**推翻**：契约注释明令
「生成侧与消费侧都必须走本函数」，而生成侧 `chain-loss.ts:589` 正在手拼字符串。

**正确处置从「删」翻转成「接线」**——删掉它等于把契约的单源约束一起删掉，
给 `G-CHAIN-NODEID-FREESTRING` 复发扫清最后障碍。**同一个 grep 结果，两种相反的处置。**

### 7.4 `packages/contracts/src/` 整包 —— 差点报成「全是死代码」🔴 最险的一次

首版 import 图报出 **317 个孤立文件**，contracts 几乎全表在列。
病根是我自己的解析器不认 ESM `.js` 说明符（`export * from "./solvers.js"`），barrel 的边全丢。
**而我的金丝雀是绿的**——它只覆盖了相对路径那条路。

**推翻后**：边数 696→**1761**，孤立文件 317→**12**。
这与 CLAUDE.md 记载的 `git grep -- "apps/*/src"` 恒 0 是**同一种病的不同外衣**：
**工具坏了，会让每个符号都读作「零命中」，从而得出「全是死代码」这个恰好相反的结论。**
判据也一样：**先拿一个你确定存在的东西跑一遍**——`solvers.ts` 不可能没人用，它报 0 就是工具坏了。

### 7.5 `mcp/mock.ts` —— import 图说孤立，门脚本正在用

详见 §5.3。三个门脚本经 `await import("apps/agentcore/dist/mcp/mock.js")` 消费它——
**动态 import + 字符串路径 + 指向编译产物**，src 层面的 import 图对这条路径**结构性地看不见**。
若照图发布，我会建议删掉一个三道门都在用的文件。

**附带推翻**：`apps/datacore/src/solvers/args-schemas.ts` 我一度按「零 src importer」记进僵尸，
读文件头后推翻——它是**迁址后有意保留的薄 re-export 垫片**，零 importer 是预期结果而非遗漏，
**处置从「删」翻转成「不动」**。

### 7.6 「11 条幽灵导航项」→ 只剩 1 条

详见 §5.5。按「`NAV_GROUPS` − `BUILTIN_VIEWS`」做差集得 11 个候选，
追一层发现 10 条走的是 `synthetic/service.ts` 的**第二条种入路径**（`EXTRA_VIEW_KEYS` + `VIEW_DEFS`）。
病根是我信了 `view-manifest.ts` 头注释里「内置视图**唯一真相源**」那句话的**字面**，
没读它的**作用域**（"内置"之外还有一批）。

> **六条的共同点**：`grep`/工具给出的**数字本身都是真的**，错的是我**把数字当成了结论**。
> 四条靠「再追一层调用/再找一条种入路径」翻案，两条靠「换一个我确定存在的东西验工具」翻案。
> **没有一条是靠多 grep 一次翻案的** —— 「我 grep 了」从来不是复验。

---

## 8 · 本体引用与影响

> 本单**只列不写**：以下为定性出的新断点与受影响项，**未改 `docs/SYSTEM-ONTOLOGY.md`**，由审核方回写。

### 8.1 触及的对象类型

`Equipment`（`oee_current`/`oeeA`/`oeeP`/`oeeQ`）· `Process`（`shifts`/`attendance`/`shiftHours`/`yield_baseline`/`channels`/`utilization`）·
`Line`（`utilization`）· `Material`（`onHand`/`leadTime`）· `MaterialBalance`（`coverage`）· `Order`（`outsourceRatio`/`qty`）·
`ChangeoverMatrix`（`changeoverMin`）· `Shipment`（`etaDay`）· `Cadence` · `CustomsClearance` · `IncomingInspection` · `PurchaseOrder`

### 8.2 触及的链路

1. **产能原子因子活推演链**：产能页卡片(⑤瓶颈因子) → `DynamicLeverPanel` → `generic_inference mode:"levers" + grain` →
   `discoverCapacityLevers` → `LEVER_FACTOR_PROPS` ∩ `CAPACITY_FACTOR_BINDINGS` → ±ε 敏感度 → 杠杆表
   **⇒ 交集处静默塌陷（§2.1）**
2. **全链节点 ID 单源链**：`CHAIN_NODE_REGISTRY` + `CHAIN_OP_NODE_PREFIX`/`chainOpNodeId` → 生成侧 `chain-loss.ts` →
   消费侧 `sandboxConsole.ts` **⇒ 生成侧绕过单源函数（§4.1）**
3. **推演沙盘诚实缺席链**：`transitFlow.ts` 常量 → `TransitFlowLayer`/`SandboxConsole` 渲染
   **⇒ 硬编码诊断，不接受数据输入、永不自愈（§3.1）**

### 8.3 涉及的不变量

- **R14（单一真值/非内联）**：§2.1 与 §4.1 皆为 R14 的实质违反——
  `CAPACITY_FACTOR_BINDINGS` 自称「接线单源」，而 `LEVER_FACTOR_PROPS` 是并行的第二张表且无人校验；
  `chainOpNodeId` 自称单源而生成侧手拼。
- **R6（确定性）**：不受影响（本单所有塌陷都是确定性的恒空，不是随机）。

### 8.4 与既有门禁/断点的关系

| 编号 | 关系 |
|---|---|
| `G-CAPACITY-FACTOR-SHALLOW` | §2.1 表明该断点**未真正闭合**：绑定表建起来了，但 `LEVER_FACTOR_PROPS` 这条实际过滤路径没跟着对齐，设备层仍不可拨 |
| `G-CHAIN-NODEID-FREESTRING` | §4.1 是其**动态半的残留**：静态注册表已闭，`capacity.op.*` 生成侧仍手拼 |
| `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`（假绿第 9 形态） | §4.14 的 234 条 test-only 导出是同族存量 |
| `check-chain-node-singlesource.mjs` | 门有效但**覆盖面小于门名承诺**：校验「取值合法」，不校验「是否走单源函数」 |
| `check-nav-group-coverage.mjs` | 对 `decision-play` 的豁免是**知情豁免**，非遗漏（§2.2） |

### 8.5 建议新登记的断点（**本单不写本体，仅提名**）

| 提名编号 | 一句话 |
|---|---|
| `G-LEVER-BINDING-DRIFT` | 杠杆因子表与产能绑定表两张注册表口径漂移，交集处静默返空；本该交叉校验的 `factorPropKeys()` 零调用方 |
| `G-FRONTEND-HARDCODED-ABSENCE` | 前端「诚实缺席」面板为 `const` 硬编码、不接受数据输入 ⇒ 数据落库后仍宣告 EMPTY；且测试只断言「理由条数」不断言「理由为真」 |
| `G-OPNODE-HANDBUILT` | 动态工序节点 ID 生成侧绕过契约单源函数手拼字符串，现有门按「取值合法」放行 |

---

## 9 · 复现方式

本报告的符号扫描可复现（脚本为一次性取证工具，未入库）：

- **金丝雀**：任何扫描先断言 `createIntent` 在 src 有 ≥1 命中，命中 0 即判「工具坏了」并中止。
- **pathspec**：`git grep -- "apps/*/src"` **恒 0**，必须写 `"apps/**/src/**"` 或直接用 `rg <dir>`。
- **符号索引**：对 519 个 src 文件全量 `match(/[A-Za-z_$][\w$]*/g)` 建 `symbol → {file: count}` 索引，
  再对 3835 个导出符号求「除自身文件与 `index.ts` 外的 src 引用集」为空者。
- **§2.1 的纯函数重放**：把 `LEVER_FACTOR_PROPS` 与 `CAPACITY_FACTOR_BINDINGS` 两张常量表逐字转录，
  照 `service.ts:850-853` 原样重放过滤逻辑，输出逐因子候选数。
