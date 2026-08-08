# PRD · 沙盘验收 A2「零写死」门 `chain-scan-honesty:check`（WO-SANDBOX-A2）

## 1. 为什么建这道门

`docs/PRD-sandbox-redesign.md` §9 验收 **A2** 与 §10.1 点亮判据 A2 白纸黑字点名：

> **零写死**：`chain-scan-honesty:check` 绿；随机抽 5 个数字，逐个溯源到求解器输出

**而这道门在本单之前根本不存在**（`scripts/` 下无此文件）。这是本仓已坐实的病的又一例：
`boundary-singlesource` 曾是一道**被制度指定的死门**（欠账 #76 · §7 谎称"已并入 pnpm gates"，
实际红着且零接线 24 个 commit；假绿第 5 形态 `G-DEAD-GATE-BY-POLICY`）。

**验收判据点名一道不存在的门，比没有判据更危险** —— 它让复验方以为这条已被机械核过，
于是不再追那一层（同 `stale-claims:check` 咬的"自称实测"那族心理机制）。

## 2. 守的命题

**屏上/回包里的每个数字，都来自求解器输出或对象库，不是源码里的字面量。**

`chain-impediment.ts` 的文件头自称"本引擎里没有任何业务阈值。一个数字都没有。"
本门把这句**自称**变成**机械可证伪的断言**。自称是保质期最短的东西。

## 3. 八条判据（各抓一种错法）

| # | 判据 | 抓什么错法 | 事实源 |
|---|---|---|---|
| **H1** | 判据表零数值 | `IMPEDIMENT_RULE_BINDINGS`/`UNBOUND_IMPEDIMENT_JUDGEMENTS` 剥注释+剥字符串后残留数字 ⇒ 引擎有了"第二个存阈值的地方" | 自身 |
| **H2** | 输出构造位无裸字面量 | **区域层**：`ChainImpedimentSchema.parse({…})` 等 4 个回包构造区内的 `key: <数字>` 与含中文的裸字符串；**文件层**：`severity\|metricValue\|threshold` 在任何位置被赋数字字面量（防绕开构造区先算好再塞） | 自身 |
| **H3** | 无兜底默认阈值 | `?? <数字>` / `\|\| <数字>` —— "读不回来就给个看着合理的默认值"那条路的入口 | 自身 |
| **H4** | 溯源可机械核 | 构造区必须以**符号** `solverKey: CHAIN_IMPEDIMENT_SOLVER_KEY` 写（非内联串）且带 `ruleKey`/`metricValue`/`threshold`/`unit`；该 key 的字面值当场读回核 `SOLVER_KEYS` | `solvers/service.ts` |
| **H5** | 业务名棘轮 | 扫描面内内联行业业务名（基地/工序/产品）。**词表自 `BASE_REGISTRY` 机械派生**，门自己不写中文词表（门里写死一张词表，本身就是本门要治的病） | `base-registry.ts` |
| **H6** | 规则在册（事实层） | 判据声称"阈值出自 C22"，而 `BATTERY_RULES` 里没这条规则 ⇒ 溯源链第一环就断 | `synthetic/battery.ts` |
| **H7** | 溯源可达 | 规则表达式必须**真以该 `metricPath` 为比较操作数**。口径不符 ⇒ 运行期要么恒 UNKNOWN，要么读回一个不相干的数（后者是静默错答） | `synthetic/battery.ts` |
| **H8** | 字面量阈值棘轮 | `source==="literal"` 的判据条数只降不升（基线 4） | `synthetic/battery.ts` |

### 3.1 H8 的口径来自实测，不是我拍的

审核方 2026-08-08 起真服务跑了一次 `chain_impediments`（demo 租户，15 个阻滞点：BREAK 7 /
CONGESTION 6 / BOTTLENECK 2），回包 `thresholds[]` 显示 5 个生效阈值里 **3 个是 `literal`**。

**这直接改了本门该断言什么**：若把 A2 做成"源码里不许有数字字面量"，那道门今天必红 3 条，
而且**红得没道理** —— 那 3 个 literal 不在引擎源码里，而在**规则表达式**里
（`C05: SUSTAIN(Line.utilization > 95, 3)` / `C28: Batch.idleDays > 90` / `C06: MaterialBalance.gapTon > 0`），
并且它们**主动声明了自己是 literal**。

> **「声明了的字面量」与「藏在源码里的字面量」是两种东西**：前者可审计、改规则即改判定；
> 后者不可审计、改现实也不会变。把两者混为一谈的门只会逼出白名单，白名单一大门就死了。

故 H8 不禁 literal，只**记账 + 挡新增**：新判据的阈值请用 `params.<名>`（改旋钮即改判定）。
静态口径为 4（多出的 C22=120 在运行期因 `Order.changeoverMin` 无对象承载而 UNRESOLVED，故实测只见 3）。

### 3.2 刻意**没有**做的一条：A1 式「solverKey 被调用过」

实测 15 条阻滞点的 `evidence.solverKey` **全部等于 `chain_impediments` 自己** —— 这个扫描器
直接读对象属性 + 比规则阈值，上游根本没有别的求解器。故 §9 A1 的"solverKey 指向的求解器真被调用过"
**指向自己永远为真，这条断言无法失败**，做成门也是恒绿的哑门。

H4 因此只做**弱得多但真有牙**的那一层：key 是符号引用（防漂移）+ key 在 `SOLVER_KEYS` 册上
（防指向空气）。**H4 不是 A1 的实现，A1 那条判据本身需要重写** —— 记为交回审核方的一笔。

## 4. 金丝雀：门自己瞎了 ≠ 代码干净

本门开扫前先跑 **8 条必咬 + 9 条必不咬 + 7 条规模下界**。任一不成立 ⇒ 打印
「⛔ 门自己瞎了」并 RC=1，**而不是安静报「代码干净」**。

理由是 `docs/VERIFY-batch-2026-08-08.md` 记的四个实测陷阱（`git grep -- "apps/<星>/src"` 的
pathspec 通配符不跨 `/` 恒 0 命中 / import 图解析器不认 ESM `./x.js` / 正则窗口截断符号名）——
**三者都让扫描器报 0 命中，而 0 命中在门里长得跟"通过"一模一样**。

**它在本单开发期真抓到了本门两次自伤**（不是演习）：

1. `matchBlock(code, indexOf("IMPEDIMENT_RULE_BINDINGS"), "[", "]")` 先匹上了**类型标注里的空方括号**
   `ImpedimentRuleBinding[]` ⇒ 解析出 **0 条 binding**。若无下界，H1/H6/H7/H8 会全部静默失效而门报绿。
2. 阈值归类正则右侧终止符没排除逗号 ⇒ `SUSTAIN(Line.utilization > 95, 3)` 读成 `"95,"` ⇒
   归类失败被判 ABSENT。这条是**必不咬样例**抓到的（门会把好代码报红）。

## 5. 诚实边界（本门做不到什么）

- **只做静态扫描**：证明"源码里没有写死的数"，**不证明**"跑出来的数是对的"。
  A2 后半句"随机抽 5 个数字逐个溯源"的**运行态**那一半**本单未做**（见 §7 未完成项）；
  A5「亲手真跑」仍必须人做。
- **只认字面量形态**：`Number("95")` / 从写死 JSON 读 / 算术拼出来的常数一律看不见。
  门能**证伪**"有裸字面量"，不能**证实**"没有写死"。
- **H2 区域层靠锚点**：构造方式被重构成别的写法 → 区域数掉到下界之下 → 金丝雀当场红（不静默放行）。
- **H5 只咬 `BASE_REGISTRY` 派生得出的词**：册外的行业名（新工序名等）看不见。
- **H7 用正则找比较节点，不是 AST**：复杂表达式（多个合取项里同一字段出现两次）只认第一个。

## 6. 变异反证（2026-08-08 实跑 · 失败原文）

**① 在输出构造位塞裸数字**（`severity,` → `severity: 87,`）→ **RC=1**：

```
✗ chain-scan-honesty:check 未通过（2 条 · PRD-sandbox-redesign §9 验收 A2「零写死」）：
  - H2 输出构造位（区域层）：apps/datacore/src/solvers/chain-impediment.ts:633 构造区
    `ChainImpedimentSchema.parse(` 内出现裸数字 `severity: 87,`
        severity: 87,
  - H2 输出构造位（文件层）：apps/datacore/src/solvers/chain-impediment.ts:633
    数值输出键被赋字面量 `severity: 87`
```

区域层与文件层**双红**，证明两层不是同一条判据的重复。

**② 把门的扫描逻辑改坏**（`detectRegionLiterals` 的裸数字正则置 `null`）→ **RC=1，且报的是「门瞎了」不是「代码干净」**：

```
⛔ 门自己瞎了（不是「代码干净」）—— chain-scan-honesty:check 无法给出有效结论：
  - 必咬样例没咬住：H2 构造区裸 severity —— 检测器失灵，0 命中会被读成「代码干净」

  修法：修门（锚点/正则/事实源解析），不是修被扫代码。
```

两条变异均 `git checkout -- <file>` 撤回后门复绿 **RC=0**。

## 7. 交付状态与未完成项（诚实）

| 项 | 状态 |
|---|---|
| `scripts/check-chain-scan-honesty.mjs` | ✅ 绿 RC=0 |
| 接 `scripts/gate.sh` | ✅ binding 现算 = `GATE_SH`（普查 5→6） |
| `scripts/gate-ledger.json` 登账 | ✅ disposition=WIRE · provenRed=MUTATION |
| `scripts/chain-scan-honesty-baseline.json` 棘轮 | ✅ H5 豁免 4 条（3 key，每条理由 ≥10 字）· H8 literal 基线 4 |
| 变异反证 ×2 | ✅ 见 §6 |
| **本体 §7 登记** | ❌ **未做**（截止时间到）—— 审核方需补，`ontologyRef` 字段现为 `"§7"` 占位 |
| **运行态溯源抽验测试** | ❌ **未做** —— `apps/datacore/test/chain-scan-honesty.test.ts` 未建；A2 后半句"抽 5 个数字逐个溯源"目前仍靠人核 |
| **§9 A1 判据本身需重写** | ⚠ 见 §3.2：现文本恒真，无法失败 |

## 8. 本体引用与影响

- **对象类型**：`ChainImpediment`（contracts `chain-sim.ts` §6）· `Rule`（A5 规则 DSL）· `Process`/`Line`/`Order`/`MaterialBatch`/`MaterialBalance`/`DataSourceHealth`
- **链路**：规则发布（A5）→ `SolverService.loadContext` 规则快照 → `detectChainImpediments` 判定 → `chain_impediments` 回包 → 沙盘面板
- **不变量**：R6（确定性）· R13（结论可溯源到旋钮）· R14（应用层无业务常数）· R16（诚实缺席 = 生长信号）
- **断点**：`G-DEAD-GATE-BY-POLICY`（制度点名的门实际不存在 —— 本门所闭的正是这一条在沙盘 A2 上的实例）
- **门禁**：新增 `chain-scan-honesty:check`（binding=GATE_SH）
