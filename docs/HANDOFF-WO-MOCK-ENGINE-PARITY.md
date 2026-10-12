# HANDOFF · WO-MOCK-ENGINE-PARITY

分支 `claude/handoff-wo-mock-engine-parity`（基 `origin/claude/verify-reclaim-6` @ `9945e77c`，`check-branch-base` RC=0）。
提交：`a5caa454` 占位 → `f1465211` 修复 → `d8565a9e` parity 测试 → 本文件与本体回写（末提交）。

## ① 实测数（全部现算，无写死）

**病灶① G-AGENTCORE-MOCK-DIVERGED-FROM-ENGINE（🔴→✅）**
- 真引擎今日 Base→Order 实算路径：`["model_producible_at:in", "model_demanded_by_order:out"]`
  （`planSlice` BFS + tie-break：sameDomain → toType 字典序 → linkKey 字典序 → out 先于 in；
  `"model_demanded_by_order" < "order_for_model"` 故走前者）。
- mock 原写死：`["model_producible_at:in", "order_for_model:in"]`（P1 之前旧路）——**第二跳逐字段不同**，
  而 `navigation-ontology-query.test.ts` 断言的正是 mock ⇒ 恒绿 11 天（2026-08-09 取证至本单）。
- 本体图规模（两种独立口径交叉核验一致）：**61 类型 / 100 链路**（正则抽取 vs `grep -c "fromTypeKey:"`）。

**病灶② G-MOCK-OVERCLAIM（agentcore mock 方向新实证）**
- 既有门 `mock-fidelity:check` 只扫**前端** mock；agentcore mock 方向此前无人看守。
- 实测 agentcore mock **超发 1 键**：`affected_orders.orders`（真侧 `risk.ts affectedOrders` 返回里没有；
  且被 `qos-f-entitlement.test.ts` 当「既有字段」断言 = 咬 mock 自洽）。**欠发 11 键**：
  `affected`/`total`/`fallback`（affected_orders）· `optionsOmitted`/`optionsEvidence`/`impedimentPlays`（decision_play）·
  `deltaByObjective`/`explanation`（optimize_whatif）· `healthFactor`/`perBaseRows`/`pendingCertList`（capacity_forecast）。

**病灶③④ G-BE-FE-FIELD-DEAD / G-BE-FE-SEAM-DEAD（◑ 维持，门已在）**
- 字段粒度门 `solver-field-seam:check`：基线 102 条（ratchetHigh 120，只降不升）——**交付⑤要求的字段粒度门已存在**。
- 端点粒度门 `befe-seam:check`：基线 SSE 字段 3 · 端点 150。两门均已在 `scripts/gate-ledger.json` 登账。
- 本单未动其基线（提交触碰文件清单无 `scripts/*baseline*.json`）；其扫描面（datacore solvers + 前端生产码）
  不含 agentcore mocks，本单改动对其零影响。

## ② 改法与论据（方向：mock 对齐真侧，真侧只读）

- **新 `apps/agentcore/src/mocks/ontology-graph.ts`**：镜像本体图（数据从 `battery.ts` 一次性抽取落盘、
  头注「不许手改」）+ `buildOntologyAdjacency`/`shortestOntologyPath` 逐字移植 slice-planner（tie-break 同序）
  + `matchQueryFilter` 移植 query-engine + `MockNoQueryPlanError`（code `NO_QUERY_PLAN`）。
- **改写 `clients.ts` `ontology_query`**：闭包守卫 → rootFilter 求值（零匹配即抛，与真侧同）→ BFS 现算路径 →
  postFilter/aggregate/orderBy/limit → 真格式 summary。`overrides` 入即抛「不支持」——**报缺，不编数**。
- **四求解器形状对齐**：删 overclaim `orders`；补 11 个欠发键（值为代表性种子值，键的存在性是断言对象）。
- **两测试改断**：`navigation-ontology-query` 改断言现算路径 + 反向钉死旧路不再出现；
  `qos-f-entitlement` 改断 `data.affected`/`data.total`（注释写明 `orders` 是 mock 私自超发）。
- **牙 `mock-engine-parity.test.ts`（8 节）**：抽取器读 A 侧源码为**文本**（contracts-only-shared 合规，
  沿袭 mock-discover-parity 先例；契约 schema 活引用）；§2 镜像图==现抽图**集合相等**；
  §6 五求解器顶层键==`SOLVER_OUTPUT_SHAPES` 集合相等 + 条件键台账 3 条各带 why
  （`deltas` 仅 overrides 分支 / `locusPlay` 仅 locus 入参 / `summary` 仅 aggregate 分支）；
  capacity_forecast 特口径（zod `.catchall` 别名 `gapPct`/`mainBottleneck` 锚 capacity.ts 文本）；
  nested provenance/queryPlan/hop 键对活契约 schema，双源互核。

## ③ T1–T5 实测输出（原文摘录）

**T1 变异反证（两次，均红在正确位置，恢复后 8/8 绿）**
- 变异1：mock linkPath 回退写死旧路 ⇒ `× §4 … mock provenance.linkPath ≠ 抽取图 BFS 现算路径:
  expected [ 'model_producible_at:in', …(1) ]` diff 点名 `- "model_demanded_by_order:out"` / `+ "order_for_model:in"`（RC=1，其余 7 节绿）。
- 变异2：删 `affected_orders.fallback` ⇒ `× §6 … affected_orders：mock 缺真侧声明键（missing）…
  to deeply equal { missing: [ 'summary' ], …(1) }`（received missing 含 fallback，点名到人；RC=1）。
- 恢复后：`Test Files 1 passed (1) · Tests 8 passed (8) · VITEST_RC=0`。

**T2 merge-base 对照**（worktree `/tmp/base-probe` @ `9945e77c`，install + build 两包后）
- 旧断言在基线上绿：`navigation-ontology-query 2 passed · qos-f-entitlement 7 passed · BASE_RC=0`
  —— 证明「基线绿、分支绿、差异全部来自本单两个提交」。
- 强化证据：把新 parity 测试**搬进基线 worktree 对旧 mock 跑** ⇒ §4（linkPath 旧写死）、
  §6（affected_orders missing affected/total/fallback）、§8（未知类型不抛错反回数据）**当场红**，
  §1/§2/§3/§5/§7 绿 —— **这病它早就抓得到**；绿节证明镜像图与金丝雀在基线上无辜。BASE_PARITY_RC=1。

**T3 金丝雀双向**：§1 每轮必跑（已知必中 ∧ 已知不存在必不中），与主逻辑共用同一抽取函数；
T1/T2/正式跑三轮均绿。另有独立计数交叉核验（61/100 两口径一致）。

**T4 基线方向**：`git diff --name-only 9945e77c..HEAD` = 5 个文件全在本单范围内
（clients.ts / ontology-graph.ts / mock-engine-parity.test.ts / navigation-ontology-query.test.ts / qos-f-entitlement.test.ts
+ 本文件 + 本体），**零 baseline 文件、零 gate 脚本**；未跑任何 `--update`。

**T5 终检**：`git status --porcelain` = 0 行；`node scripts/check-branch-base.mjs HEAD` RC=0
（「分叉点落后集成线 0 个提交」）；`node scripts/check-merge-conflict-markers.mjs` RC=0。

**附带复跑**：`navigation-ontology-query.test.ts` 2/2 绿（NAV_RC=0）、`qos-f-entitlement.test.ts` 7/7 绿（QOS_RC=0）。

## ④ 基线变化

无。未触碰 `scripts/*baseline*.json` 与 `scripts/gate-ledger.json`。
parity 测试是 vitest 套件成员（位置即接线，`pnpm -r test` 自动带跑），非门脚本——
先例 `mock-discover-parity.test.ts` 同样不在 gate-ledger 登账（已实测 grep 全仓零命中），故不登。

## ⑤ 文件重叠排查

`git log --oneline -5 -- apps/agentcore/src/mocks/` 在本分支上只有本单两个提交；
基线上该目录最近提交与 canonical 无未并冲突（merge-base = 分支分叉点本身，落后 0）。

## ⑥ 没做的部分 + 差什么

1. **mock `overrides`（deltas 重算）不支持**：真侧该分支要重跑引擎，mock 无真引擎；
   现状 = 入即抛「不支持 overrides」（诚实报缺）。要支持需把 query-engine 重算路径也移植进 mock——超出本单范围，建议另立 WO。
2. **`affected_orders` aggregate 分支** mock 不支持（真侧仅 aggregate 时发 `summary`）——同上，报缺不编数。
3. **widget 集合差盲区**：`solver-field-seam:check` 判「字段有无消费方」，
   判不了「widget 声明的字段集合与后端实发集合之差」——这是另一类门，本单未建（WO 允许「或记录缺什么」）。
4. **G-MOCK-OVERCLAIM / G-BE-FE-FIELD-DEAD / G-BE-FE-SEAM-DEAD 状态维持 ◑**：
   三门的存量 burn-down 各有属主 WO，本单只闭合了 agentcore-mock 方向这一片并补齐了看守牙。
