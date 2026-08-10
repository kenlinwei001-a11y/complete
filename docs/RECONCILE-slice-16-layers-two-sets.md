# RECONCILE · 两套「十六层」对账（欠账 #167 · WO-SLICE16-RECONCILE）

> 2026-08-10 · 起点 SHA `246e4c88` · 分支 `claude/handoff-wo-slice16-reconcile`
>
> **触发**：`docs/AUDIT-slice-16-layers.md:362-365` 自己记的一笔账 ——
> 「两套『十六层』是否同一套**尚未对账**，谁也别拿其中一套的覆盖数去解释另一套」。
> 本文把这笔账结掉。
>
> **本文只对账、不改运行时行为**：产出 = 对照表 + 判定 + 受影响表述清单 + 命名裁决。

---

## 0 · 金丝雀（否定结论的前置自证 · 铁律 0.6）

本文有三处**否定结论**（「契约里没有 Interface」「B 集从未被枚举」「历史里也没有」）。
按铁律 0.6，报否定结论前必须先跑一个「已知必中」的样例证明**工具是对的**，
否则只能报「工具坏了」。**「我没找到」和「它不存在」是两个不同的命题。**

| 要报的否定结论 | 检索 | 结果 | 金丝雀（同一工具·同一路径·已知必中） | 判定 |
|---|---|---|---|---|
| `packages/contracts/src` 里没有 `Interface` | Grep `Interface` 于该目录 | **0 命中** | 同目录 Grep `SliceLayer\|z\.object` → **807 命中 / 69 文件** | ✅ 工具正常 ⇒ 0 是真 0 |
| 全仓没有「含 Function/Interface 的十六层枚举」 | Grep `⑯` 于 `docs/ apps/ packages/` | 18 个文件，**逐个读完，无一是该枚举** | 同一次 Grep 命中 `packages/contracts/src/slice-layers.ts`（已知存在的那套枚举） | ✅ 工具正常 |
| 历史里也没有（含已删目录 `docs/req-inventory/`） | `git grep -n "Interface" be35aa6c -- docs/req-inventory` | 2 命中，**均非层名**（`User→Interface→Agent…` 定位链 / `Decision Interface 差异化定位`） | 同树 `git grep -c "需求" be35aa6c -- docs/req-inventory` → 12 文件命中 | ✅ 工具正常 |

**两条工具坑，已避开并留证**：

1. ⚠️ **未使用** `git grep -- "apps/*/src"` —— pathspec 里的 `*` 不跨 `/`，该写法**恒 0 命中**（CLAUDE.md 铁律 0.5 判据 5）。本文全部用 Grep 工具的 `path` 参数或显式目录列举。
2. ⚠️ **假朋友**：全仓搜「十六」会大量命中**十六进制**
   （`docs/HANDOFF-theme-switch-build-and-review-contract.md:15/30/36/39/48/56` ·
   `docs/AUDIT-three-boards-vs-design-master-alignment.md:94/99` ·
   `docs/START-HERE-dev-agent.md:47/126`）。这些与本题**无关**，不得计入。

---

## 1 · 一句话结论

**两套不是同一套 —— 用反例证，不用感觉判。但对账做不完，缺的那份输入不在仓里。**

| | **A 集 · 契约集** | **B 集 · 台账集** |
|---|---|---|
| 单一来源 | `packages/contracts/src/slice-layers.ts:19-34`（`SLICE_LAYER_IDS`） | `docs/REQ-LEDGER-sandbox.md:246`（REQ153）**转述**的外部文档 |
| 16 个层名是否写下来过 | ✅ **逐字枚举，机器可读** | ❌ **从未写下来**（当前树 + 全部历史，只出现过 **4** 个名字） |
| 含 Function 层 | ❌ 无 | ✅ 有（"Function 签名 0"） |
| 含 Interface 层 | ❌ 无 | ✅ 有（"Interface 8"） |
| 有无代码落点 | ✅ 契约 → 端点 → 前端 → 测试，全链在（§3.3） | ❌ **零代码落点** |

**反例即证**：B 集明确含 Function 与 Interface 两层；A 集的 16 个 id 逐字列在那里，
这两个名字**一个都没有**（金丝雀背书的 0 命中）。⇒ **A ≠ B**。
这个判定**不需要**知道 B 的全部 16 个层名 —— 一个反例就够。

**但是**（本单最重要的产出）：**不能**据此判「B 是 A 的旧版、A 是 B 的订正版」，
也**不能**判「本来就是两套毫不相干的东西」。两种说法今天**都没有证据**，
因为 B 集的 16 个层名从来没有被写进本仓（§3.2 给检索证据）。
**缺的那一份输入 = REQ 台账出处 S7「16 层本体切片」的原文档，它不在仓里。**

> 这正是本单要防的病的镜像：**我不能拿「我在仓里找不到 B 的枚举」当作「B 和 A 是同一套」的证据。**
> 找不到就是找不到，判定只能停在反例能支撑的那一步。

---

## 2 · 逐层对照表

### 2.1 A 集 —— 十六层逐字枚举（`packages/contracts/src/slice-layers.ts:19-34`）

| # | id | 中文层名（`apps/frontend-shell/src/locales/zh.ts:1113-1128`） | B 集里有对应名字吗 |
|---|---|---|---|
| ① | `business_scenario` | 业务场景 | **未知**（B 未枚举） |
| ② | `decision_intent` | 决策意图 | **未知** |
| ③ | `object` | 对象 | **未知** |
| ④ | `property` | 属性 | **未知** |
| ⑤ | `relation` | 关系 | **未知** |
| ⑥ | `event` | 事件 | **未知** |
| ⑦ | `state` | 状态 | **未知** |
| ⑧ | `metric` | 指标 | **未知** |
| ⑨ | `time` | 时间 | ✅ 名义对应 B 的「时间语义」（**口径不同，见 §2.3**） |
| ⑩ | `rule` | 规则 | **未知** |
| ⑪ | `constraint` | 约束 | **未知** |
| ⑫ | `data_binding` | 数据绑定 | ✅ 名义同名（**口径不同，见 §2.3**） |
| ⑬ | `scenario` | 场景 | **未知** |
| ⑭ | `evidence` | 证据 | **未知** |
| ⑮ | `action` | 行动 | **未知** |
| ⑯ | `governance` | 治理与溯源 | **未知** |

「未知」**不是**「B 里没有」—— 是「B 的那 12 个名字从没被写下来，无从判断」。

### 2.2 B 集 —— 本仓出现过的全部层名，只有 4 个

出处 `docs/REQ-LEDGER-sandbox.md:246` 原文：

> `- [x] **REQ153** 16 层切片规格 · 🔗 · 平台覆盖 12/16 层（Function 签名 0 · Interface 8 · 时间语义 26 · 数据绑定 25 偏弱）`

| B 集层名 | 附带的数 | A 集对应 | 判定 |
|---|---|---|---|
| **Function（签名）** | 0 | **无此层** | 🔴 **只在 B** —— 反例① |
| **Interface** | 8 | **无此层** | 🔴 **只在 B** —— 反例② |
| 时间语义 | 26 | ⑨ `time` 时间 | ⚠️ 名义对应，**数对不上**（§2.3） |
| 数据绑定 | 25 | ⑫ `data_binding` 数据绑定 | ⚠️ 名义同名，**数对不上**（§2.3） |
| **其余 12 层** | — | — | ❓ **本仓无记载**，无法对账 |

### 2.3 ⚠️ 两个「12/16」长得一模一样，量的是两件事，弱层集合**交集为空**

这是本单最要命的一条 —— 也是派单里点名的那句「**今天已有交付说『12/16 层有承载物』，但没注明按哪一套算**」。

| | **A 集的 12/16** | **B 集的 12/16** |
|---|---|---|
| 出处 | `docs/AUDIT-slice-16-layers.md:192` · `docs/SYSTEM-ONTOLOGY.md:1097` | `docs/REQ-LEDGER-sandbox.md:246` · `docs/PRD-UPGRADE-decision-sandbox-v2.md:1369` |
| **口径** | **某一条切片实取了几层**（`GET /a/v1/ontology/slices/order_fulfillment_360/layers?args={"so":"SO-3391"}` → 12 present / 1 not_in_slice / 3 absent） | 「**平台覆盖** 12/16 层」—— 平台级、与切片无关 |
| 是常数吗 | ❌ **是变量**，随切片翻。实测（`AUDIT-slice-16-layers.md:229-236`）：`coverage_exceptionevent` = **7/2/7**；`coverage_order` = **10/1/5**；`aop_scenario_chain` 无参 = **3/3/10** | 表述为一个固定结论 |
| 非 present 的 4 层 | ①业务场景(absent) · ②决策意图(absent) · ⑥事件(not_in_slice) · ⑮行动(absent) | Function签名 · Interface · 时间语义 · 数据绑定 |
| **两个弱集的交集** | **∅（空集）** | |
| 更反过来 | A 集实测 **⑨时间 = present 10** · **⑫数据绑定 = present 9**（`AUDIT-slice-16-layers.md:204/207`） | B 集恰恰说这两层「偏弱」 |

**⇒ 两个 12/16 不但口径不同，结论方向还相反。** 谁把其中一个当另一个的解释，都会得出反向的排期。

### 2.4 B 集那四个数（0 / 8 / 26 / 25）在本仓**不可复现**

- REQ153 **没有给任何口径**：没有 file:line、没有命令、没有「数的是类还是条还是字段」。
  同节邻居 REQ154/REQ155/REQ156 都带反引号符号证据（`resolve_slice`、`SliceSpecRecord.spec{…}`），
  **只有 REQ153 是四个裸数**。
- 逐个试对，**没有一个对得上今天的实测**：
  - 「数据绑定 25」vs 实测 **94 类中 93 类有 `sourceBindings`**（`docs/AUDIT-slice-16-layers.md:106` · `docs/SYSTEM-ONTOLOGY.md:1104` 的金丝雀行同源）；
  - 「Interface 8」vs 全仓 `Interface` 契约 **0**（§0 金丝雀背书；旁证 `docs/TESTGAP-TRIAGE.md:274`「canonical `packages/contracts/src/index.ts` 无任何 `Interface` 导出」）；
  - 「Function 签名 0」是四个里**唯一**能对上的（`docs/ONTOLOGY-7ELEM-AUDIT.md` §0 条④「A 侧权威零签名」）。
- **这不是说那四个数是错的** —— 是说**它们量的东西没被写下来**，所以既不能复现也不能证伪。
  按本仓纪律，这样的数**不得再被引用**（§5 给替代写法）。

---

## 3 · 判定与证据（来历，非感觉）

### 3.1 时间线（全部可 `git show` 复核）

| 时间 | commit | 事件 | 与本题的关系 |
|---|---|---|---|
| 2026-08-09 07:01 | `3c8340f6` | 建 `docs/REQ-LEDGER-sandbox.md`，写下 R153（后改名 REQ153） | **B 集首次也是唯一一次出现**。⚠️ 该 commit **只改了一个文件**（`git show --stat 3c8340f6` = `docs/REQ-LEDGER-sandbox.md`）⇒ **出处 S7 的原文档没有随台账入仓** |
| 2026-08-09 16:17 | `f6c61869` | 建 `docs/AUDIT-decision-twin-gap-2026-08-09.md`，:104 写「16 层缺 ①业务场景 ⑥事件 ⑨时间语义」 | **A 集序号方案首次出现**（①=业务场景 ⑥=事件 ⑨=时间，与后来的 `SLICE_LAYER_IDS` 序号**逐个吻合**），但**仍未枚举 16 个名字** |
| 2026-08-10 | `dc11aa2f` | 建 `docs/AUDIT-slice-16-layers.md`（真后端实测取证） | 顶回 `:104` 的 ⑥⑨ 两条误判 |
| 2026-08-10 | `070f0e0a` | 建 `packages/contracts/src/slice-layers.ts` + 端点 | **A 集首次被逐字枚举并落成契约** |
| 2026-08-10 | `a41022e3` / `5ebc6cf2` | 回写 `docs/SYSTEM-ONTOLOGY.md`（链路 `sys.ontology.slice_16layers` + 4 条断点） | A 集进入本体 |

### 3.2 「B 集从未被枚举」的检索证据

- 当前树：Grep `⑯` 命中 18 个文件，逐个读完 —— 除 A 集自身外，其余全是**别的编号体系**
  （产能因子 ①–⑰：`docs/WO-CAPACITY-DEEPEN-ADDITIVE.md:46` · `docs/AUDIT-zombie-and-orphan-code.md:101` ·
  `docs/AUDIT-discoverlevers-empty.md:255` · `apps/frontend-shell/src/views/capacity/factorOntology.ts`；
  清单序号：`docs/PRD-console-cleanup.md:225` · `docs/CHECK-RT-GOV.md:451`），**无一是十六层**。
- 历史：已删目录 `docs/req-inventory/`（`be35aa6c`，2228 条规格台账）里 `Interface` 仅 2 命中，均非层名。
- 主 PRD 侧：`docs/PRD-enterprise-decision-twin.md` §2「七个世界」表里 ③ Ontology 行写的是
  `Object/Relation/Event/State`（`:341`），**没有十六层清单** —— 所以 `AUDIT-decision-twin-gap-2026-08-09.md:104`
  那句「16 层」也不是从这份 PRD 抄的（该文件全文搜 `16` 仅 2 处命中，均与层无关）。

### 3.3 「A 集是今天的操作性定义」的证据（不是文档声称，是接线）

| 环节 | file:line |
|---|---|
| 契约（zod enum，且断言恰好 16 层） | `packages/contracts/src/slice-layers.ts:18`（`SLICE_LAYER_IDS` 声明，层名 `:19-34`）· `:145`（`.length(16)`）· `:148`（`total: z.literal(16)`） |
| 导出 | `packages/contracts/src/index.ts:33` |
| 引擎（按 id 逐层投影） | `apps/datacore/src/ontology/slice-layers.ts:8`（import）· `:527`（`SLICE_LAYER_IDS.map`）· `:168`（`projectSliceLayers`） |
| 路由 | `apps/datacore/src/app.ts:4884`（`GET /a/v1/ontology/slices/:sliceKey/layers`）· `:4935` |
| 前端 | `apps/frontend-shell/src/pages/admin/SliceLayersPanel.tsx:192`（`SliceLayersPanel`）· 文案单源 `apps/frontend-shell/src/locales/zh.ts:1113-1128` |
| 测试 | `apps/frontend-shell/test/slice-16-layers.test.tsx:85/313` |
| 本体登记 | `docs/SYSTEM-ONTOLOGY.md:1293`（链路 `sys.ontology.slice_16layers`）· `:1097/1099/1100/1101/1103/1104`（6 条断点） |

**B 集的同一张表是空的**：零契约、零端点、零前端、零测试、零本体登记。

### 3.4 裁决

1. **命名裁决**：「**十六层**」这个词，从今天起**单指 A 集**（`SLICE_LAYER_IDS`）。
   理由不是「A 更好」，是 **A 是唯一被写下来、被机器守住、能被复核的那一套**；
   B 集连 16 个名字都没有，无法作为任何判断的依据。
2. **B 集不作废，改名并降级为「待补录的外部需求」**：称
   **「REQ153 十六层（外部出处 S7，本仓未收录原文）」**，不许再简称「十六层」。
   它**不是**被否定 —— 它只是**在本仓不可核**。
3. **两套的覆盖数互不通用**（§2.3 已给反例）。任何一处引用覆盖数，
   **必须同时写明是 A 集还是 B 集、以及是哪条切片/哪个快照**。
4. **想真正结掉这笔账，唯一的办法是把 S7 原文档收进仓**（`docs/` 下存一份，或至少把它的
   16 个层名逐字抄进 REQ153 的证据位）。在那之前，**A 与 B 的关系只能停在「已证不同、成因未知」**。

---

## 4 · 受影响的既有表述清单（要改的话 · file:line）

> 判据：凡「引用了某个十六层覆盖数**却没注明是哪一套**」，或「拿一套的表述解释另一套」。

| # | file:line | 原表述 | 病 | 处置 |
|---|---|---|---|---|
| 1 | `docs/PRD-UPGRADE-decision-sandbox-v2.md:1369` | 「16 层切片规格（平台覆盖 12/16：Function 签名 0 · Interface 8 · 时间语义弱）… **这 4 层缺口与欠账 #69 是同一件事，不许当两件做**」 | **两处**：① 12/16 未注明口径（是 B 集，与契约 A 集的 12/16 无关）；② 「4 层缺口 = #69」是**过度声称**，实际只重合 **2/4**（§5） | 🔧 加注记指向本文（本单已加） |
| 2 | `docs/REQ-LEDGER-sandbox.md:246` | 「平台覆盖 12/16 层（Function 签名 0 · Interface 8 · 时间语义 26 · 数据绑定 25 偏弱）」 | 四个裸数**无口径、无 file:line、本仓不可复现**（§2.4）；且未注明与契约 A 集不是同一套 | 🔧 加注记指向本文（本单已加，**不改裁决符号、不动条目数**，以免动 `check-req-coverage` 的锁定值） |
| 3 | `docs/AUDIT-decision-twin-gap-2026-08-09.md:104` | 「🔗 16 层缺 ①业务场景 ⑥事件 ⑨时间语义」 | ⑥⑨ 已被 `docs/AUDIT-slice-16-layers.md` §1.2 **实测证伪**（⑥有 372 条真事件 · ⑨有 `TsSeriesRecord.entityType`）。`docs/SYSTEM-ONTOLOGY.md:1097` 已记「该行已由本单证伪」，**但该行本身没有就地注记** —— 直接读到 `:104` 的人照样被骗 | 🔧 **建议**就地加一行注记（本单未改：该文件是 08-09 的历史取证快照，改它需另行裁决；此处先立账） |
| 4 | `apps/frontend-shell/src/pages/admin/SliceLayersPanel.tsx:18` | 注释举例「第一层：`12/16 层有数据` 这个数」 | 与 REQ153 的「12/16」**字面完全相同、口径完全不同**；且此处是**变量**（`zh.ts:1109` 的 `headline: (present) => …`），不是常数 | ⚪ 代码本身正确（数来自后端），仅注释举例易被误采。**建议**改举例为非 12 的数（如 `7/16`）以断开字面耦合；本单未改（属前端范围，非本单边界） |
| 5 | `docs/AUDIT-slice-16-layers.md:362-365` | 「两套『十六层』是否同一套**尚未对账**」 | 记账正确，现已由本文结掉 | ✅ 本单已就地改为指向本文 |

### 4.1 假朋友（搜 "12/16" 会命中，但与本题无关，**不得计入**）

| file:line | 内容 | 为什么无关 |
|---|---|---|
| `docs/TEST-PLAYBOOK.md:144` | 「**16/16 → 12/16**，红的恰是 E01 那 4 条」 | 说的是**探索型门的 16 条断言**，不是十六层 |
| `apps/agentcore/test/scenario-phrasing-seam.test.ts:197` | 同上（注释引用） | 同上 |
| `docs/evidence/three-boards-baseline.md:59` | 「三案收入增 12/16% 等显示」 | 是**百分比**，不是分数 |

---

## 5 · 与欠账 #69（本体七要素缺口）的关系

**答：部分同源，不是同一件事。精确说 —— 名义上重合 2/4，根因上真有一个交点。**

### 5.1 名义对照

`#69` 四缺口（`docs/PRD-enterprise-decision-twin.md:416` · `docs/ONTOLOGY-7ELEM-AUDIT.md` §0）：
**Interface 零 · Security 列级零 · Action 无回写声明 · Function 无本体签名**

| | 在 #69 里 | 在 B 集弱 4 层里 | 在 A 集里 |
|---|---|---|---|
| **Interface** | ✅ | ✅ | ❌ **A 集无此层** |
| **Function 签名** | ✅ | ✅ | ❌ **A 集无此层** |
| Security 列级 | ✅ | ❌ | ❌ 无此层 |
| Action 回写声明 | ✅ | ❌ | ⚠️ A 集有 ⑮`action` 层，但缺的字段不同（见 §5.3） |
| 时间语义 | ❌ | ✅ | ⑨`time`（实测 present） |
| 数据绑定 | ❌ | ✅ | ⑫`data_binding`（实测 present） |

⇒ **B 集弱 4 层 ∩ #69 四缺口 = {Interface, Function} = 2 条，不是 4 条。**
所以 `docs/PRD-UPGRADE-decision-sandbox-v2.md:1369` 那句
「这 4 层缺口与欠账 #69 是同一件事，不许当两件做」——
**半对**：说 Function/Interface 同源是对的；把 时间语义/数据绑定 也算进 #69 是**多算**，
把 Security列级/Action回写声明 当成 REQ153 的内容是**串台**。
形态照本仓句式：**「我用『两边都提到 Interface 和 Function』当作『这两套缺口是同一套』的证据，而前者并不度量后者。」**

### 5.2 根因上**确有**一个真交点：`G-UPSERTTYPE-DROPS-FIELDS`

这一条**是**同一件事的两个视角，合并陈述如下：

- **同一个 bug**：`apps/datacore/src/ontology.ts:194 (upsertType)` 逐字段列举重建 `def`，
  把 `stateVariables` / `actions` / `functions` / `security` **一个都没抄** ⇒ 写进去即丢
  （登记于 `docs/SYSTEM-ONTOLOGY.md:1104`）。
- **#69 的视角**：这四个字段正是「接口残片」，所以「Interface 零」不是没定义，是**落不了库**
  （`docs/ONTOLOGY-7ELEM-AUDIT.md` §2.1(b)）。
- **A 集的视角**：同一个 bug 让 ⑦`state` 的承载物 (a)`ObjectTypeDef.stateVariables` 实测 **94 类 0 类非空**、
  ⑮`action` 的承载物 (a)`ObjectTypeDef.actions[]` 实测 **94 类 0 类非空**
  （金丝雀：同一查询下 `sourceBindings` 非空 **93 类** ⇒ 查询正常）。
- ⇒ **修一处，两边同时好转。** 这一条不许当两件做。

### 5.3 但 A 集 ⑮行动 与 #69 的 Action 缺口**不是**同一件事

| | #69 · Action 无回写声明 | A 集 ⑮行动 缺席 |
|---|---|---|
| 缺的字段 | `ActionType.effects`（10 个内置里只有 1 条有声明） | `ActionType.targetTypeKey`（**字段根本不存在**） |
| 缺的读出口 | `describeImpact` 零生产调用方（假绿第 9 形态） | 无法把动作 join 回切片类型集 |
| 断点编号 | `docs/ONTOLOGY-7ELEM-AUDIT.md` §0 条③ | `G-ACTIONTYPE-NO-TARGET`（`docs/SYSTEM-ONTOLOGY.md:1100`） |
| 修法 | 补 effects 声明 + 暴露 impact 端点 | 加 `targetTypeKey`，或回填 `ObjectTypeDef.actions[]` |

两条修法互不覆盖 —— 把 `effects` 补齐，⑮行动 层**照样**取不出来。

### 5.4 结论

- **合并陈述的部分**：`G-UPSERTTYPE-DROPS-FIELDS` 一条，同时是 #69 的「Interface 残片落不了库」
  和 A 集 ⑦状态(a)/⑮行动(a) 恒空的根因。**一处修，两边好。**
- **必须拆开说的部分**：
  1. B 集弱 4 层与 #69 四缺口只重合 2/4（§5.1）；
  2. A 集**没有** Interface / Function / Security 三个层，#69 的这三条在 A 集里**无对应层**，
     谈不上「同一件事」；
  3. A 集 ⑮行动 缺的是 join 键，#69 缺的是 effects 声明，**两个字段、两条修法**（§5.3）。

---

## 6 · 今后引用覆盖数的写法（本单立的口径纪律）

**禁止**再出现光秃秃的「N/16 层」。任何一处引用，三要素缺一不可：

1. **哪一套** —— 「A 集（`SLICE_LAYER_IDS`）」或「REQ153 十六层（外部出处 S7）」；
2. **什么口径** —— A 集必须写清「哪条切片 + 什么 args + 哪个 snapshot」，
   因为它是**变量**不是常数（`coverage_exceptionevent` 是 7/2/7，`order_fulfillment_360` 是 12/1/3）；
3. **三态分开写** —— `present / not_in_slice / absent` 不许合并成一个「有/无」，
   合并即重演 ⑥事件 那类误判（`docs/AUDIT-slice-16-layers.md` §3.3）。

✅ 合规示例：
> A 集实测 `order_fulfillment_360` @`args={"so":"SO-3391"}` = **12 present / 1 not_in_slice / 3 absent**。

❌ 违规示例（本单要改的那类话）：
> 平台 12/16 层有承载物。

---

## 7 · 本体引用与影响

- **对象类型**：不新增、不改。本文只对账。
- **链路**：不新增。涉及既有链路 `sys.ontology.slice_16layers`（`docs/SYSTEM-ONTOLOGY.md:1293`）——
  该链路的层定义**保持不变**，本文只是把「这十六层是 A 集，不是 REQ153 那套」写死。
- **事件**：不新增，不 emit。
- **不变量**：不改。本文与 R1–R19 无交互。
- **断点**：**新登记 1 条** `G-SLICE16-TWO-VOCABS`（`docs/SYSTEM-ONTOLOGY.md` §8 已有行），
  状态 ◐ —— 命名纪律与 A 集权威性本单定死，但 B 集 16 个层名仍待补录（需 S7 原文档，仓外）。
  相关既有断点不改定性：`G-SLICE-16LAYER-PROJECTION`（:1097）· `G-UPSERTTYPE-DROPS-FIELDS`（:1104）·
  `G-ACTIONTYPE-NO-TARGET`（:1100）。
- **门禁**：不新增门。本单跑过的两个静态门，改动前后均绿（退出码显式捕获）：
  `node scripts/check-system-ontology.mjs` · `node scripts/check-req-coverage.mjs`。

---

## 8 · 需求编号落点

本文引用并结账：**REQ153**（`docs/REQ-LEDGER-sandbox.md:246`）。
