# WO-OPTIMAL-WORDING 交单报告 —— 屏上「最优」承诺与求解器最优性对账

分支：`claude/handoff-wo-optimal-wording`（基于 canonical + 并入 WO-IA-E2E5E6 改名基线 `8c097fc7`）
复验入口：`node scripts/check-claim-strength.mjs`（RC=0）· `--selftest`（12 条全中）· `--list`（25 条命中逐条对账）

---

## ① 求解器最优性判定：**双模** —— docker 态精确最优 / 内存态启发式贪心

### 判定方法与自证

判别准则：**求解器是否只在数学证明成立时才声称最优**（`optimal:true ⟺ 求解器证明 OPTIMAL`）。
用这条准则同时读了一个已知精确的求解器和一个已知启发式的求解器，两者被干净分开 —— 准则可分辨，工具没瞎。

### 证据 A · docker 态 = **精确最优**（可证最优）

`services/optimizer/server.py`（OR-Tools CP-SAT sidecar）：

- `_new_solver`（server.py:535 附近）：`num_search_workers=1`、固定种子、**不设 `max_time_in_seconds`**（注释原文：挂钟时限破坏可复现性 R6）—— **无截断**，求解器跑到证明为止。
- `solve_portfolio` 返回（server.py:956 附近）：`"optimal": status == cp_model.OPTIMAL` —— 只有 CP-SAT 数学证明最优才标 true；`FEASIBLE`（找到可行解但未证完）落 false。
- 覆盖面：portfolio（全订单×全基地×时间联合，共享产能守恒 `Σ qty·x ≤ cap[b,t]`）/ cross_object_occupancy / OPT_FAMILIES 五模型（`apps/datacore/src/app.ts` `OPT_FAMILIES = [facility_location, min_cost_flow, set_cover, independent_set, combinatorial_auction]`）。

按四分法归类：**精确最优**（非有界近似、非截断 —— 没有挂钟/迭代上限）。

### 证据 B · 内存态 = **启发式**（无最优性保证）

`apps/datacore/src/solvers/inproc-optimizer.ts`（无 `OPTIMIZER_BASE_URL` 时的兜底，**本机部署默认路径**）：

- `solvePortfolio`（inproc-optimizer.ts:54-171）：确定性**贪心**（按交期/优先级排序逐单塞产能），恒返 `{status:"FEASIBLE", optimal:false}`（「诚实红线」：宁可永不声称最优，不许谎称）。OPT_FAMILIES 五模型**一个都没实现** → datacore 显式抛「未接入」。
- `solveCrossObjectOccupancy`：同样贪心，恒 `optimal:false`。
- 换班现任诚实（WO-D2 既有账）：带 deadline 截断时 `optimal` 强制 false。

按四分法归类：**启发式**（无 gap 界、无证明）。

### 结论（直接答仓主的真问题）

> **本机内存态部署下，求解器没有任何最优性保证；docker 态（CP-SAT sidecar）下 portfolio/occupancy/OPT_FAMILIES 是可证最优。**
> 同一张屏两种部署承诺强度不同 ⇒ **静态大字一律不许写死「最优」**；允许的只有跟求解器自述字段 `optimal` 走的动态标注，或登记在册的有据字面量。

---

## ② 全仓强承诺词清单（25 条命中，file:line + 定性 + 处置）

扫描面：`views/sim/**` + `OptimizeWhatifView.tsx` + `DecisionPlayPanel.tsx` + `sandboxModes.ts` + **`locales/zh.ts`（i18n 词表 —— 只 grep 组件会漏的 5 条全在这里）**。词表：`最优/最划算/最佳/最好的/最好方案/保证`。

### A. 改掉的（13 处无撑静态承诺 →「优选」系 + 依据句）—— 见 ③

`GlobalSimView.tsx` ×6 · `ProjectSimView.tsx` ×2 · `GlobalSimLevers.tsx` ×1 · `MultiObjWhatifPanel.tsx` ×4（含写死的「CP-SAT 可证最优」徽标改动态）。

### B. 保留的（25 条现存命中全部登记在 `scripts/claim-strength-registry.json`）

| file:line | 命中词 | 定性 | 撑着它的东西 |
|---|---|---|---|
| locales/zh.ts:774 | 保证 | backed | zod strictObject 契约层真实拒绝未知键，「不可能多发一个字段」是对该机制的事实描述 |
| locales/zh.ts:2398 / :2402 | 保证 | negation | 「**不是**引擎保证」—— 撤销承诺的否定句 |
| locales/zh.ts:2454 | 最优 | backed | 「每列最优」= 对屏上已展示方案集按维 argmax/argmin，是对屏上数据的数学事实 |
| locales/zh.ts:2765 | 最优 | not-a-claim | 「最优化引擎」是组件技术名词（部署指引标题），指物不指结果 |
| DecisionPlayPanel.tsx:1134 | 最优 | backed | 同 zh.ts:2454 —— 逐维 argmax，better 方向语义来自 DIM_META |
| OptimizeWhatifView.tsx:261/374/519/528/532 | 最优 | backed + solverField:optimal | 本页五 family 仅 CP-SAT 实现；内存态一律显「未接入」诚实态到不了这些句，能出结果必是可证最优路径 |
| OptimizeWhatifView.tsx:376/379/381 | 最优 | backed + solverField:optimal | 「可证最优」跟 `baseSolve.optimal` 动态走，非写死 |
| OptimizeWhatifView.tsx:376/379/381 | 最优 | negation | 「非最优」是 optimal:false 分支的明示标注 |
| OptimizeWhatifView.tsx:429 | 最优 | not-a-claim | 「未接入最优化引擎」= 诚实未接入态标题，披露无结果而非承诺 |
| GlobalSimView.tsx:588 | 最优 | glossary | verdict 徽标 title 的术语释义串（定义「可证最优」与「可行解·未证最优」边界） |
| MultiObjWhatifPanel.tsx:127 | 最优 | backed + solverField:optimal | 动态 title 两分支，跟 `occ.data.optimal` 走（本单改的） |
| MultiObjWhatifPanel.tsx:127 | 最优 | negation | optimal:false 分支明示「未证明它是最优（内存态为确定性贪心）」 |
| MultiObjWhatifPanel.tsx:134 | 最优 | backed + solverField:optimal | 动态徽标：optimal:true 才显示「CP-SAT 可证最优」（本单改的） |
| MultiObjWhatifPanel.tsx:134 | 最优 | negation | 否则显示「优选解（可行 · 未证最优）」 |
| sandboxModes.ts:38 / :47 | 最优 | backed + solverField:optimal | 「求最优」模式名描述动作意图；承载页 OptimizeWhatifView 同上述 CP-SAT-only 论证 |

---

## ③ 改后措辞与依据句（13 处）

**GlobalSimView.tsx**
1. h2 `（全局最优在先）` → `（全局优选在先）`
2. 副标题「一次算出全局最优」→「一次联合求解，按所选目标（按期 / 延误 / 换型 / 库存 / 成本）在产能约束下比较出优选组合」（**依据句**：目标 + 约束 + 比较三要素齐全）
3. 徽标 title「最优方案」→「优选方案」+ 依据说明
4. grpLabel title「最划算」→「比较出更划算的组合」
5. leverHint「分层最优换形」→「分层优选换形」
6. 新增 `optimalityLabel(d)`：`optimal:true → "✓ 可证最优"`；`FEASIBLE → "可行解 · 未证最优"` —— batchStatus 与 verdict 徽标统一走它，verdict title 两个术语都释义

**ProjectSimView.tsx**
7.「以全局联合最优为准」→「以『接单组合优选』页的全局联合方案为准」
8. 链接「把这批一起求全局最优 →」→「把这批一起做组合优选 →」

**GlobalSimLevers.tsx**
9.「ε约束=主目标最优下约束次目标」→「ε约束=先锁主目标、再给次目标设上限」

**MultiObjWhatifPanel.tsx**（本单抓住的真谎话）
10. 徽标原写死「CP-SAT 可证最优 · 推演结果（非数据库事实）」—— **内存态 InProc 贪心（optimal:false）回答时它照显示**，是屏上谎言。改动态：`occ.data.optimal ? "CP-SAT 可证最优…" : "优选解（可行 · 未证最优）…"`，title 同步两分支
11.「最优真漂移」→「优选真漂移」
12.「最优方案」（caption）→「优选方案」
13.「最优取舍」→「优选取舍」

两种情形都没用「大字最优 + 小字免责」—— WO 明令禁止的形态一处都没有。

---

## ④ 门 `claim-strength:check` —— RC 0/1/2 与变异反证（原文）

机制：屏上强承诺词命中 → 必须在 `scripts/claim-strength-registry.json` 有同文件登记且 `backedBy` ≥20 字；声明 `solverField` 的机械验证字段真存在于 `optimizer-client.ts`；登记了而屏上已无该串（死账）⇒ 红。金丝雀与主逻辑共用 `analyze()/judge()`；12 条 selftest（analyze 必咬 4 · 必不咬 3 · judge 变异 M1-M5）；扫描面 <25 文件 ⇒ RC=2。

**RC=0（现状，原文）：**
```
✅ claim-strength:check 干净 —— 扫描面 38 文件 · 屏上强承诺词 25 条全部有登记且依据成立。
   诚实边界：经变量间接上屏的字面量本门看不见（金丝雀必不咬-3 钉死）；mock 数值口径不查；扫描面外的页面不查。
```

**RC=1 · 变异 M1（扫面里加一个违规文件，原文）：**
```
⛔ claim-strength:check 真违规 1 条（扫描面 39 文件 · 命中 26 条）：
   · 屏上强承诺词无登记：apps/frontend-shell/src/views/sim/__m1-canary.tsx:1 「一次算出全局最优」（命中词「最优」）——要么改成「优选」系说法，要么在 scripts/claim-strength-registry.json 登记它**被什么撑着**
```
（删除该文件后复跑 RC=0 —— 红绿双向都真。）

**RC=1 · 变异 M2（登记册清空 `{"allowed":[]}`，原文首行）：**
```
⛔ claim-strength:check 真违规 25 条（扫描面 38 文件 · 命中 25 条）：
```
25 条命中全报无登记 ⇒ 门不是永远绿的摆设。（恢复后 RC=0。）

**RC=2 · 变异 M3（登记册删除，原文）：**
```
⛔ 登记册不存在：scripts/claim-strength-registry.json ⇒ **工具坏了，不是代码坏了**。
   本次结论作废：**不许**读作「屏上没有强承诺词 / 承诺都有撑」——
   本门这次根本没有扫描成功，它什么都没证明。
```

**selftest（原文）：** `✅ 金丝雀 + 变异反证全中（12 条：analyze 必咬 4 · 必不咬 3 · judge 变异 5）`

挂账：`package.json` `gates` 链尾 + `claim-strength:check` 别名；`scripts/gate-ledger.json` 登记（binding GATES_CHAIN · 本报告为 provenRed 证据）；本体 §7 回写。

---

## ⑤ 本结论**没有**推翻仓主裁决 —— 无需反驳，裁决前提成立

WO 预设：若①判出求解器是启发式 ⇒「优选非最优」裁决前提成立，措辞统一按此执行；若判出精确最优 ⇒ 须把论证顶回仓主、不许擅自改回。

实测①的结论是**双模**：docker 态精确最优**且**内存态启发式。内存态是本机部署默认路径，且（WO-D2 既有账）即便 docker 态带 deadline 截断也强制 `optimal:false`。 ⇒ 存在无最优性保证的真实部署路径 ⇒ **「屏上静态大字不许写死最优」的裁决前提成立**，②③按启发式分支执行，无需第五节反驳论证。

docker 态的精确最优性也没有被浪费：动态标注（`optimal` 字段驱动）让 docker 部署的屏上**照样显示「可证最优」**——承诺强度跟着部署实况走，这正是本单机制（门 + 登记册 + 动态字段）要守的命题。

---

## 附：复验命令汇总

```bash
node scripts/check-claim-strength.mjs            # RC=0（25 条全登记）
node scripts/check-claim-strength.mjs --selftest # 12 条金丝雀/变异全中
node scripts/check-claim-strength.mjs --list     # 逐条命中对账
node scripts/check-gate-exit-discipline.mjs      # 83 门全绿（本门形态合规）
node scripts/check-gate-ledger.mjs               # 台账一致
node scripts/check-ontology-anchors.mjs          # 锚点绿（merge 后已 --update 修漂移）
pnpm --filter frontend-shell exec vitest run test/multiobj-whatif.test.tsx   # 7 文件 21 测试全绿（逐个文件名）
```

**预先存在的红（非本单引入，已在 pristine canonical 临时 worktree 复核同红）**：`check-wo-anchors` RC=1（4/11 WO 锚不匹配）、`check-ontology-descriptions` RC=2 —— 只登记，不在本单范围修。
