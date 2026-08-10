# WO-LEADTIME-SPLIT 交付说明 —— 「全链前置期」拆成两个不合成的指标

> 裁决出处：`docs/DECISION-2026-08-09-four-calls.md` §① （仓主 2026-08-09 授权）。
> 本单只负责落地，不重新讨论要不要拆。
> 分支：`claude/handoff-wo-leadtime-split`（已 rebase 到 canonical `a7f3555f`）。

---

## ⚠️ 先更正一条我自己的取证（照铁律 0.6 记账）

**开工时我实测「`docs/DECISION-2026-08-09-four-calls.md` 不存在」，并准备照 §4.4 诚实报出来。
这个结论在写下的那一刻是真的，两小时后就是假的 —— 我必须自己订正。**

- 我在 `f6c61869`（当时的 canonical）开的分支，那个提交里确实没有这份文档；
  金丝雀也证明了工具没坏（`grep -rln "SYSTEM-ONTOLOGY" docs` 命中 3 份，同一条命令搜裁决文档 0 命中）。
- 但 canonical 在我干活期间前进到了 `a7f3555f`，**裁决文档正是在那一步落进来的**。
- 形态就是本仓写过的那句：**「我没找到」和「它不存在」是两个不同的命题」** ——
  这次还多一层：**「它当时不存在」也不等于「它现在不存在」**。取证是有时效的。
- 已 rebase 到新 canonical，逐字读过裁决原文，确认本单落地与裁决**逐条对得上**（见 §5 对照表）。

**教训（给下一个 dev）**：worktree 隔离的 agent 看到的 canonical 是**开工那一刻的快照**。
凡要报「某文档/某实现不存在」，**必须在收工前 `git fetch` 再验一次**，否则报的是一个已经过期的世界。

---

## ① 今天这个数在哪算、有没有混算、有几个消费方

### 在哪算

**唯一产出点**：`apps/datacore/src/solvers/chain-loss.ts:888`（改前）

```ts
const leadTimeDays = nodes.reduce((sum, n) => sum + nodeLeadTimeDays(n), 0);
```

`nodes` 是**全部**节点，所以这一行把账期节点 `order.cash` 一起加了进去。

账期进链的地方是同文件的 `order.settlement_terms` 草稿（改前 `chain-loss.ts:566-582`）：
`drillType: "Customer"` · `drillField: "termDays"` · `kind: "queue"` —— 账期被当成一段**普通排队**。

### 有没有混算 —— **有，而且不止一处**

实测（seed 42 · 锚点订单 `SO-3391` · 客户 `cust_0` 广汽集团 · 内存态真跑）：

| 读数 | 改前 | 其中账期 | 说明 |
|---|---|---|---|
| `totals.leadTimeDays` | **85.3889 天** | **60 天** | 账期直接进总数 |
| `totals.nonValueDays`（损失归因**分母**） | 84.1944 天 | **60 天** | 账期把生产侧占比全压扁 |
| `totals.flowEfficiency` | **1.3988%** | — | 分母含账期 ⇒ 被稀释 |

对照：整条产线**十道工序**的作业 + 换型加起来只有 **1.5486 天**。
一段 60 天的账期 vs 十道工序 1.55 天 —— 这就是裁决说的「生产侧改进在这个数上看不见」。

> **📌 顺带订正裁决文档里的一个数（不影响裁决，但该说清楚）**
> 裁决原文写「账期占非增值时长 **85.5%**」。**今天实测是 71.26%**（60 ÷ 84.1944）。
> 差额不是谁算错了，是**链长大了**：D1 节拍落库 +8 天（`qc_batch` 0.5 + `schedule` 0.5 + `S&OP 共识会` 7）、
> WO-CHAIN-24 采购三腿 +6 天（入厂在途 3 + 到货检验 3），共 +14 天非增值。
> 回推：`(84.1944 − 14) = 70.194`，`60 ÷ 70.194 = 85.48%` —— **与 85.5% 逐位吻合**，
> 说明那个数在写下时是准的，现在过期了。**裁决结论不受影响**（账期仍是压倒性的第一大项）。

### 有几个消费方（grep 只是线索，逐个追到调用点）

金丝雀先行：`grep -rn "chainLossAttribution" apps/*/src packages/*/src` → 5 命中（工具正常）。

`totals.leadTimeDays` 的**真实**消费方共 **6 处**，全部在前端；**datacore/agentcore 的 src 侧零消费方**
（`npx tsc --noEmit` 在删掉该字段后 datacore **零报错**，这是比 grep 更硬的证据）：

| # | 位置 | 用途 | 处置 |
|---|---|---|---|
| 1 | `SandboxConsole.tsx:883`（改前） | 底部指标卡 `label="前置期"` —— **裸卡，正是 WO 点名的形态** | 拆成两张卡 |
| 2 | `SandboxConsole.tsx:381` | 顶栏 `前置期 {n}D · 增值 {%}` | 拆成两个 tag |
| 3 | `SandboxConsole.tsx:424` | 流动效率卡副文案 `增值 / 前置期` | 标名为交付前置期 |
| 4 | `chainLineMap.ts:92` | zod 载荷 schema（**运行时校验**，不改会当场 parse 失败） | 换成新三字段 |
| 5 | `metro-semantics.seam.test.tsx:93` | 造族线差异用 | 改用交付前置期 |
| 6 | 两份 fixture 的 `totals` | 捕获的真实返回体 | 从活跑重抓 |

另有 **7 处 `leadTimeDays` 是节点级**（`inspectorModel.ts` / `sandboxConsole.ts` 的 `n.steps.reduce`），
**与本单口径无关**（一个节点的自身耗时不存在"含不含账期"的歧义）——
但它们的**标签**被我改了，理由见 §2。

---

## ② 改前 / 改后各是多少天

seed 42 · 锚点 `SO-3391`（内存态真跑，非推算）：

| 指标 | 改前 | 改后 | 差 |
|---|---|---|---|
| 展示给生产/供应链的前置期 | 85.3889 天（`leadTimeDays`） | **25.3889 天**（`deliveryLeadTimeDays`） | **−60.0000 天** |
| 展示给经营的现金口径 | **不存在** | **85.3889 天**（`cashConversionDays`） | 新增 |
| 结算段（单列） | 混在总数里 | **60.0000 天**（`settlementDays`） | 单列 |
| 损失归因分母 `nonValueDays` | 84.1944 天 | **24.1944 天** | −60.0000 天 |
| 流动效率 | 1.3988% | **4.7046%** | **×3.363** |
| 归因表行数 | 18 | 17 | 账期移出 |

**一句话**：那 60 天没有被删，它被**移到了它该在的地方**。
生产侧看到的数从 85.39 天变成 25.39 天，同一笔排产改进在指针上的分量因此放大 3.36 倍。

### 「现金周转期」这个数今天有没有？—— **有，但改前不是一个独立指标**

照 §4.4 诚实交代：**不是「现编了一个」，也不是「本来就有」**，是第三种情况——
账期这段数据**真实存在且有真承载物**（`Customer.termDays` = 60，`cust_0` 广汽集团，可逐位回仓储对拍），
它一直被算进那个合成数里，**只是从来没有被单独命名和单独展示过**。
本单做的是**给它一个名字并单列**，没有新造任何数据、没有引入任何常量。

反过来说清楚**缺什么**（不夸大交付）：

- 现金周转期今天的终点是 `order.cash`（账期到期），**不是「回款真的到账」**。
  仓里没有「实际回款日」字段 —— `Customer.receivables` 是**余额**不是时刻。
  所以这个数是**承诺口径**（按合同账期），不是**实际口径**（按真实回款）。已写进契约注释。
- `order.settlement`（开票对账 / 月结）**在册但今天无实例** —— 结算段目前只由账期一段构成。
  分类表已把它算作结算段，等它有了承载物会自动进现金侧、**不会**误入交付前置期。

---

## ③ 两条效果层断言的实测输出

门：`apps/datacore/test/leadtime-split.seam.test.ts`（新建，5 用例全绿）

```
 ✓ test/leadtime-split.seam.test.ts (5 tests) 26692ms
   ✓ ① 交付前置期 !== 现金周转期（且先自证本数据集账期 > 0 —— 账期为 0 的数据不适合做这条断言）
   ✓ ② 灵魂断言：termDays 60 → 90 ⇒ 现金周转期 +30，交付前置期/增值/非增值/流动效率/归因表**逐位不变**
   ✓ ③ 口径定义单一出处：结算段分类表钉死，两个指标的起点/终点/含不含账期写在契约里
   ✓ ③.2 契约三函数自洽：现金周转期 === 交付前置期 + 结算段（纯函数层再断一次，绕过求解器）
   ✓ ④ totals 里不许再有裸的 leadTimeDays —— 每个消费方必须显式选一个口径
```

### 断言 ① 两个指标不得相等

WO 特别叮嘱「若某测试数据上恰好相等（如账期为 0），换一条数据，别放宽断言」。
本门把这条**写成了机器判据**而不是靠人记得 —— **先断言数据适格，再断言本体**：

```ts
expect(r.totals.settlementDays,
  "本数据集结算段（账期）为 0 ⇒ 两个指标天然相等，这条数据不适合做本断言（换一条，别放宽断言）",
).toBeGreaterThan(0);          // ← 数据适格性自证，实测 60
expect(r.totals.deliveryLeadTimeDays).not.toBe(r.totals.cashConversionDays);  // 25.3889 ≠ 85.3889
```

### 断言 ② 改账期只动现金周转期（灵魂断言）

`Customer.termDays` 60 → 90，同一条链重跑：

| 读数 | 改账期前 | 改账期后 | 判定 |
|---|---|---|---|
| `settlementDays` | 60 | **90** | ✅ +30 |
| `cashConversionDays` | 85.3889 | **115.3889** | ✅ +30 |
| `deliveryLeadTimeDays` | 25.3889 | **25.3889** | ✅ **一字不变** |
| `valueAddDays` | 1.1944 | 1.1944 | ✅ 不变 |
| `nonValueDays` | 24.1944 | 24.1944 | ✅ 不变 |
| `flowEfficiency` | 0.047046 | 0.047046 | ✅ 不变 |
| `attribution`（整表 17 行） | — | — | ✅ `toEqual` **逐位不变** |

最后一行是我在 WO 要求之外**加严**的：只断总数不变还不够——
若账期仍留在归因分母里，改账期会让**每一行**生产侧占比都飘，而总数看起来可能没事。
故直接 `expect(after.attribution).toEqual(before.attribution)` 把整张表钉死。

---

## ④ 变异反证（红/绿）

两个注入点各代表一种复发形态，**都真跑过**：

### M1 · 把拆分整个回退成合成（改契约的分类判据）

`packages/contracts/src/chain-sim.ts` — `isSettlementNodeId` 恒返回 `false`（= 没有结算段，一切回到一个数）：

```
Tests  3 failed | 2 passed (5)
 × ① → 本数据集结算段（账期）为 0 ⇒ 两个指标天然相等…: expected 0 to be greater than 0
 × ② → expected +0 to be close to 30, received difference is 30
 × ③.2 → expected 70 to be 7
```
**红。** 还原 → 5/5 绿。

### M2 · 只让 `totals` 偷偷回报合成值（最像"无害重构"的那种复发）

`chain-loss.ts` — `deliveryLeadTimeDays = chainCashConversionDays(steps)`，其余分流全部保留：

```
Tests  2 failed | 3 passed (5)
 × ① → 交付前置期 == 现金周转期（都是 85.38888888888889）⇒ 有人又把两个指标合并了
 × ② → 改账期把交付前置期也带动了（85.38888888888889 → 115.38888888888887）⇒ 两个指标仍在混算
```
**红，且失败信息直接说出病因。** 还原 → 5/5 绿。

> M2 是特意设计的：它**只改一个赋值**、不动分类表、不动 cash 块、不动归因表，
> 是最容易在未来某次"顺手统一一下"里溜进来的形态。两条 WO 判据都咬住了它。

### 顺带一条真红（不是变异，是本单改动的真实后果，已修）

`chain-loss-attribution.test.ts` 的「删掉锚点客户」用例原本断
`after.totals.nonValueDays ≈ before.totals.nonValueDays − 60`（因为账期当时在损失分母里）。
拆分后账期已不在交付侧任何读数里，这条**必然失败，且失败得对**。
已改判为分别断两侧：现金侧真少 60 天、交付侧**逐位不动**（比原断言更强）。E1 门 **10/10 绿**。

---

## ⑤ 需回写 `docs/SYSTEM-ONTOLOGY.md` 的清单（本单未改该文件，按范围边界只列清单）

| # | 章节 | 回写内容 |
|---|---|---|
| 1 | 对象类型 / 派生量 | `chain_loss_attribution.totals` **删** `leadTimeDays`，**新增** `deliveryLeadTimeDays`（交付前置期·下单→收货·不含账期）/ `cashConversionDays`（现金周转期·下单→回款·含账期）/ `settlementDays`；新增顶层 `cash{}` 块 |
| 2 | 不变量（建议新编号 **R19**） | 「前置期恒为两个不合成的读数」：① `现金周转期 === 交付前置期 + 结算段`；② 改 `Customer.termDays` 只许动现金侧，交付侧逐位不变。门 = `apps/datacore/test/leadtime-split.seam.test.ts` |
| 3 | 口径 / 分母 | 损失归因分母口径由「全链非增值」收窄为「**交付段**非增值」；账期单列不进归因表。守恒律 Σ==100 不变（分母同步收窄） |
| 4 | 节点登记 | 新增分类维度 `CHAIN_SETTLEMENT_NODE_IDS = {order.settlement, order.cash}`（收货后 = 只进现金周转期）。**`CHAIN_NODE_REGISTRY` 的 24 个 id 一字未动** |
| 5 | 断点登记 | 建议记一条 `G-LEADTIME-COMPOSITE`（已修）：一个没有主语的合成数把主用途指标压成噪声；判据 = `totals` 里不许再出现裸 `leadTimeDays` |
| 6 | 求解器输出形状 | `SOLVER_OUTPUT_SHAPES.chain_loss_attribution` 增加 `cash` |
| 7 | 已知缺口（诚实登记） | 现金周转期终点是**账期到期**不是**实际回款**（仓里无「实际回款日」承载物）；`order.settlement` 在册但今天无实例 |

---

## ⑥ 落地清单 & 自测记录

### 改了什么

| 文件 | 改动 |
|---|---|
| `packages/contracts/src/chain-sim.ts` | **+§4.5**：两个指标的口径定义（起点/终点/含不含账期表）+ `CHAIN_SETTLEMENT_NODE_IDS` / `isSettlementNodeId` / `isDeliveryStep` / `chainDeliveryLeadTimeDays` / `chainSettlementDays` / `chainCashConversionDays` / `CHAIN_LEAD_TIME_METRICS`（UI 标签单一出处） |
| `apps/datacore/src/solvers/chain-loss.ts` | 交付段/结算段分流；`totals` 三字段替代 `leadTimeDays`；归因表只喂交付段；`flowEfficiency` 分母改交付前置期；新增 `cash{}`；`summary` 两指标都点名 |
| `apps/datacore/src/solvers/service.ts` | 输出形状 + `cash` |
| `apps/frontend-shell/src/views/sim/SandboxConsole.tsx` | 底部裸卡 → 两张具名卡；顶栏两个 tag；Pareto 说明写明分母不含账期 |
| `apps/frontend-shell/src/views/sim/chainLineMap.ts` | 载荷 zod schema 换新三字段 |
| `apps/frontend-shell/src/views/sim/InspectorNodePanel.tsx` | 节点级读数一律标「**本节点**前置期」 |
| `apps/datacore/test/leadtime-split.seam.test.ts` | **新建**，5 用例 |
| `apps/datacore/test/chain-loss-attribution.test.ts` | 3 处断言改判到新口径（含加严） |
| 前端 2 份 fixture | **从活跑重抓**（零手改），provenance 记明重抓原因 |

### 「不许出现裸的前置期」怎么落地的

不是靠人自觉，是靠**编译器 + 门**：

1. **删掉** `totals.leadTimeDays` 而不是留别名 —— 每个消费方被 TS 逼着显式选一个口径
   （实测：这一删当场揪出前端 1 处 schema + 1 处测试，datacore 侧零报错 = 后端本就没人读）。
2. UI 文案从契约常量 `CHAIN_LEAD_TIME_METRICS` 取，**前端不许手写「前置期」三个字**。
3. 门 `④` 断言 `Object.keys(totals)` 不含 `leadTimeDays`、且 `summary` 里两个指标都点名。
4. 节点级那 7 处虽与口径无关，标签仍全部加限定词「本节点」——
   因为 `order.cash` 那张卡的节点级读数**就是 60 天账期**，裸写「前置期」必被读成全链数。

### 跑了什么（未跑全量包套件，遵守 §7 并发纪律）

| 套件 | 结果 |
|---|---|
| `apps/datacore` `leadtime-split.seam` + `chain-loss-attribution` | **15/15 绿**（rebase 后复跑） |
| `apps/datacore` `ontology-core` / `jobshop-schedule` / `databuilder` / `solvers-extended` | **68 绿 / 4 skip** |
| `apps/datacore` `sandbox-chain-scope` / `sandbox-d1-cadence` | **24/24 绿** |
| `apps/frontend-shell` **全量** | **182 文件 / 906 用例 全绿** |
| `packages/contracts` `chain-sim` | **31/31 绿** |
| `tsc --noEmit` datacore / contracts build | **零报错** |

**未跑**：`pnpm -r test`、`scripts/gate.sh`（WO §7 禁止，7 dev 并行会压垮 4 核机）。
**遗留（与本单无关，已核实我没碰这两个文件）**：`apps/frontend-shell` 有 2 条**先于本单存在**的 TS 报错
（`test/chain-impediments-route.test.tsx:48` `ws.views` possibly undefined；
`test/sim-event-invalidation.seam.test.ts:32` string|undefined）——
`git diff --stat <canonical> -- <这两个文件>` 输出为空，即本单一行未改。

### 确定性 / 范围边界

- 未引入任何时钟或随机；`chain-loss.ts` 仍是纯函数，R6 确定性用例（两跑字节一致）照旧绿。
- `CHAIN_NODE_REGISTRY` 已在册的 24 个 id **一字未动**（新增的是一个独立分类表）。
- 未碰 `apps/agentcore/**`、`apps/datacore/src/sim/**`、`docs/SYSTEM-ONTOLOGY.md`、`scripts/**`。
