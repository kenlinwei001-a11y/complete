# HANDOFF · WO-QUANTILE-UNIT-TWO-REDS

分支 `claude/handoff-wo-quantile-unit-two-reds`（基线 `origin/claude/verify-reclaim-6` = `955b8ca7`，check-branch-base RC=0）。

## ① 实测数（自己跑的，不是转述）

| 项 | 工单给的数 | 我实测 | 一致性 |
|---|---|---|---|
| 红① 形态 | `缺 @unit：capWanP50@actions.ts:378, capWanP90@actions.ts:380` | 逐字复现（`node scripts/check-quantile-field-naming.mjs` 改前输出：`UNDECLARED · capWanP50 …:378` / `capWanP90 …:380`，`🔴 2 处违规（COLLISION 0 · BARE 0 · UNDECLARED 2）`，RC=1） | ✅ 一致 |
| 红② 形态 | 门点名 `keyprops-ontology-parity.seam.test.ts:380` 的 `mk(["segment", "p50", "demandPct"])` | 复现（首次全量跑 §2b 红；standalone 判据复核命中同一行） | ✅ 一致 |
| 基线测试态 | `2 failed \| 6 passed` | 我首次跑是 `4 failed \| 4 passed` —— **多的 2 条是共享机负载假红**（当时 8 个别的 vitest 进程、loadavg 15 分钟均值 900+；多出的 §3 两条均为 `findByTestId` 1s 超时/20s 测试超时，非断言失败）。负载窗口里重跑，基线态与工单一致 | ⚠️ 数字不一致，病因是环境不是工单错 |
| §2b 既有规则数 | 「加**第三条**上下文规则」 | 文件里**已有三条**（① DOM 钩子 ② 缺席断言 ③ 检索关键词表，③ 是 08-15 扩扫描面时加的）——我加的是**第四条**。头注「两类」本就过期，已顺手改为如实计数 | ⚠️ 工单计数滞后一条，实质要求不变 |

## ② 改法与论据

### 红①（真缺陷 · 补标记）—— `packages/contracts/src/actions.ts:377-380`

散文口径改成「散文 + `@unit` 收尾」，照抄同文件 275/277 行（`CapacityForecastSnapshotSchema`）已合规形态：

```ts
/** P50 累计产能（= Σ可产基地 Σ周 周产能×爬坡×检修×认证）。@unit 万套/窗口 */
capWanP50: z.number(),
/** P90 累计产能（= capWanP50 × healthFactor）。@unit 万套/窗口 */
capWanP90: z.number(),
```

- 口径**逐字取自散文**（万套/窗口），且与 275/277 同名字段的 `@unit` 一致 —— 写任何别的值都会立刻制造 COLLISION。
- `@unit` 必须放在注释**末尾**：门的 `UNIT_TAG` 正则 `/@unit[ \t]+([^\n*]+?)[ \t]*(?:\*\/|$)/m` 会一路取到 `*/`，若把 `(= Σ…)` 括注留在 `@unit` 后面，量纲串会把整段括注吃进去，§2 的 `toBe("万套/窗口")` 会红。
- 不改门判据迁就散文 —— 门的存在理由就是让口径机器可读（`G-LEVER-SNAPSHOT-UNIT-LIE` 前科）。

**`gapWan` / `healthFactor` 核对结论：「已经合规」，不是「门没扫到」。** 证据：
门的 `QUANTILE_TAIL` 只判**分位名结尾**的字段；这两个名字不是分位字段，本就不在这道门（分位命名/量纲冲突门）的适用域内。扫描面覆盖本文件这件事用金丝雀证过 —— 临时在同一 schema 加 `canaryP90: z.number()`（无 @unit）：

```
❌ UNDECLARED · `canaryP90`（…/actions.ts:386）没有 `@unit` 标注 ⇒ 本门无从判定量纲。
gate RC=1   （撤掉后 RC=0）
```

门咬得到这个文件、这段语法 ⇒ 它不点 `gapWan`/`healthFactor` 的名是**设计内的适用域**，不是盲区。无需另开单。

### 红②（门判错 · 加第四条语法上下文规则）—— 两个文件

**为什么裸豁免字面量数组不行**：反样本 `mk(["segment", "p50", "demandPct"])` 与**活**数据键清单
（2026-08-15 真事故形态 `keyProps: ["segment", "p50", …]`）在语法上**逐字同构**——都是字符串字面量数组。
任何「豁免数组里的 `"p50"`」的规则都会把真事故形态一起放掉。这正是工单提示的方向：让反样本
**不以裸字面量出现**，把「这是反样本」变成代码结构上的事实。

**改法**（两半）：

1. `apps/agentcore/test/keyprops-ontology-parity.seam.test.ts`：反样本提为显式命名常量——
   ```ts
   const STALE_KEYPROPS_SAMPLE = ["segment", "p50", "demandPct"];
   const stale = renderOntologySemanticContext(mk(STALE_KEYPROPS_SAMPLE), semantics);
   ```
   测试语义零变化（数组内容逐字相同，塌陷断言原样），该文件全量 **11 passed** 实测。

2. `apps/frontend-shell/test/quantile-unit-onscreen.seam.test.tsx` §2b 加规则④：
   ```ts
   const STALE_SAMPLE_DECL = /\bconst\s+[A-Za-z0-9_$]*STALE[A-Za-z0-9_$]*\s*=\s*\[(?:\s*["'][^"'\n]*["']\s*,?)+\]/g;
   ```
   命中段**抹成等长空格**再判（抹段不抹行，同 ③ 的既有戒律），接入 `judgeLine`。

**工单要求想清的三件事，逐条给论据**：

1. **边界不在距离上**：规则认的是「`const` 声明 + 标识符含 `STALE` + 初始化式是**纯字符串字面量**数组」
   这一**语法结构**，与 `.not.toContain` 的远近无关。真违规写在否定断言旁边照样咬（它不会是这种声明形态）。
2. **对新文件照样生效**：判据不含文件名/行号/注释暗号，任何新文件里同形态的反样本常量自动豁免、
   同形态的真违规自动被咬 —— 这是不开白名单的全部理由，成立。
3. **放行口子**：只有「STALE 命名的 const + 纯字面量数组」这一段被豁免。三层收窄：
   数组里混任何表达式（`[seg.p50]`）整段不豁免；同行的数组外数据键（`…; x.p50`）照样咬；
   活 keyProps 清单（真事故形态）照样咬。剩余口子如实记账：谁把**活**数据键清单故意命名成
   `STALE_*` 谁就能绕过 —— 那是标识符撒谎，与本门全家赖以成立的「名字不撒谎」前提同级，
   不是一条正则能管的层（与规则② 缺席断言的信任级别相同）。

## ③ T1–T5 实测输出原文

**T1 变异反证（两处修复各做一次）**

红①：拆掉 `@unit`（即工单基线形态）⇒ 门报 `UNDECLARED · capWanP50/capWanP90`，RC=1 —— 红在
「缺口径标记」这件正事上，不是「字段不存在」（见①表基线复现）。补上后 `🟢 16 个分位字段` RC=0，
且 `actions.ts:378/380` 两行实测解析值均为 `万套/窗口`。

红②：把规则④从 `judgeLine` 拆掉（其余不动），对现形态文件重判：

```
现状+新判据 命中行: []
现状+拆规则④ 命中行: [383]   ← const STALE_KEYPROPS_SAMPLE = ["segment", "p50", "demandPct"]; 重新被点名
```

红在「那条反样本行重新被咬」—— 正是规则④在起作用的直接证据。

**验收判据两侧（红②）**

- 必不咬：现形态 `keyprops-ontology-parity.seam.test.ts` 全文件命中 `[]`；§2b 实测绿（见 T 下）。
- 必咬：在同一文件内把反样本**退回内联字面量形态**（真违规的长相），判据不动 ⇒
  `内联字面量形态+新判据 命中行: [384]` —— 门照样开火并点名那一行。门变准了，不是变哑了。
- 另加三条常驻金丝雀封口子（已进测试）：活 keyProps 清单必咬 · `[seg.p50]` 混表达式必咬 ·
  `STALE` 段外同行 `x.p50` 必咬。金丝雀总数：必咬 8 / 必不咬 7，standalone 全过，
  与主逻辑共用同一份实现（判据只存在于测试内 `judgeLine` 一处）。

**T2 没碰的东西有没有被弄红**：merge-base = `955b8ca7`（分支 0 分叉，占位提交为空 ⇒ 我的首次
全量跑就是在 merge-base 同树上跑的）。基线 vs HEAD 同命令对比：

| 测试 | merge-base 树（改动前） | HEAD | 归因 |
|---|---|---|---|
| §2 全扫（红①） | ❌ 断言红（缺 @unit ×2） | ✅ | 本单修复 |
| §2b 全扫（红②） | ❌ 断言红（点名 :380） | ✅ | 本单修复 |
| §1 · §2 其余 3 条 | ✅ | ✅ | 未动 |
| §3 渲染 2 条 | ✅（负载窗口）/ ❌ findBy 超时（高负载） | 同左，行为逐字一致 | 未动，负载敏感是既存的 |

我改的三处：契约**注释**两行（JS 产物无语义变化，contracts dist 已重建）、两个**测试文件**。
不碰任何 `src/**` 行为 ⇒ §3 渲染两条在两侧同涨同落，差异为零。

**T3 金丝雀正反两侧**：见上（必咬 8 / 必不咬 7，含新增 4 条）；门的自带金丝雀
`node scripts/check-quantile-field-naming.mjs` 每次运行前置 `✅ 金丝雀 4/4` 均过。

**T4 基线有没有被抬**：没动任何台账/基线文件。`git diff` 全量仅 3 文件：
`actions.ts`（2 行注释）、两个测试文件。无 `--update`、无 ledger 触碰。

**T5 交单前三条**（最终提交时复跑，数值见 commit message / 下方）：
`git status --porcelain` 空 · `check-branch-base.mjs HEAD` RC=0 · `check-merge-conflict-markers.mjs` RC=0。

**交付命令实测**：

```
cd apps/frontend-shell && ../../node_modules/.bin/vitest run test/quantile-unit-onscreen.seam.test.tsx
```

- 负载窗口（§2b 在 20s 默认超时内跑得完）：**7 passed** 实测两次，唯一 red 是 §2b 的
  `Test timed out in 20000ms`（**不是断言红**）。
- §2b 单跑 `--testTimeout=120000`：**1 passed，RC=0**（实测测试体 24.29s）——断言级全绿，
  含全部金丝雀与 7 树零命中。
- ⚠️ 如实标注：本机是 4 核共享机，复跑期间持续有 3–8 个**别的 dev** 的 vitest 在跑
  （loadavg 一度 900+）。§2b 是 CPU 密集扫（实测 1363 文件 / 35 万行，光判据扫描裸跑 6.3s，
  我新加的规则④ 实测增量 ≈ 0ms：6377ms → 6259ms），在默认 20s 预算内是否跑得完**取决于共享负载**。
  审核方机器上基线态 §2b 是按断言红完赛的（说明那边 20s 内跑得完），故交付命令在审核方环境应得
  `8 passed`。若审核方环境也高负载，看到的是超时红而非断言红 —— 那是负载，不是本单逻辑。

## ④ 基线变化

没动。无门台账、无 baseline 文件、无 `package.json` 变更（规则④加在既有的 §2b 测试内，不是新门脚本，
§3.6 门账登记不适用）。

## ⑤ 与其他 dev 的文件重叠

`git log --oneline -5 -- <三个文件>`：除本单两个提交外，最近的都是已收编的旧单
（`9dd86bad` sim-action-real 契约并集 · `8843a9c3`/`22e19e4e` keyprops 对账 · `cb8a2ab9` §2b 扫描面），
**无在跑 dev 的同文件重叠**。范围边界核对：未碰 `frontend-shell/src/**`、`views/sim/**`、`locales/zh.ts`、
datacore seed/features、PRD 文档；未改任何字段名（只补 `@unit` 注释标记）。

## ⑥ 没做的部分 + 差什么才能做

1. **裸对象键形态 `{ p50: 1 }` 不在门的判据面内**（工单验收举例的这种形态）。
   实测 `OLD_AS_DATA_KEY = /(?:\.|["'"]|:\s*["'"])p(?:50|90)\b/` 对它不命中（前置符要求 `.`/引号/冒号引号），
   本单**前后都不咬** —— 这是门建立时就有的扫描面决策，不是规则④ 放行的。
   差什么：扩 `OLD_AS_DATA_KEY` 覆盖无引号对象键（如 `[\{,\s]p50\s*:` 形态）是一次判据扩张，
   需要先全树影响面评估（会咬到多少既存合法代码）+ 自己的金丝雀/变异反证，体量够单独一张单。
   本单验收的「必咬」用**内联字面量数组**（真事故原貌）完成，门的「没哑」已被证明。
2. **§2b 的 20s 超时预算在高负载共享机上不够用**（测试体裸跑 ~6.3s，负载下 24–75s）。
   差什么：要么给该 `it` 显式提 timeout（改测试配置，超出本单边界），要么接受它只在正常负载机器上
   跑默认超时 —— 留审核方定夺，本单未动。
