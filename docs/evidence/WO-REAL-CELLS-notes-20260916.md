# WO-REAL-CELLS · 开工笔记（2026-09-16）

> 基线：`claude/handoff-sim-world-single-source` @ `0207b9c6`（WO 真正的母树；canonical 8775dc67d 上的
> 数 0/7295 与工单 450/6363 不符，全部判据以本树为准）。
> 本文件替代被 `reset --hard` 抹掉的 20260916 旧版笔记；旧版基线（canonical）作废。

---

## 补充 ① · 红门诊断（开工第一件事，已做完）

**实测结论：`apps/datacore/test/sim-order-real-fields.seam.test.ts` 在本树（0207b9c6）6/6 全绿，RC=0。**
（命令：`npx vitest run test/sim-order-real-fields.seam.test.ts --no-file-parallelism`，39.3s，机器当时零 vitest。）

**「6 tests / 3 failed」不成立 ⇒ 按工单「顶回来不扣分」纪律，改台账不改代码。** 证据链：

1. **门不在 desat3 上**。`git cherry HEAD FETCH_HEAD(claude/handoff-desat3 @ f072c8dc)`：10 个提交
   （41176774 e18e1eed 81bd772e 21bd880a c7520cd2 f5cfb931 fafd88d4 1b21abf6 ab579cc8 f072c8dc），
   `git diff --stat HEAD...FETCH_HEAD -- <门文件>` **空** —— desat3 一行没碰这道门。
2. **红是 desat3 自己 worktree 的本地态**。门被 desat3 在 `seed.ts` / `synthetic/battery.ts` /
   `propagation-inputs.ts` 里动的系数、域表、权重、刻度撞红；那些改动**不在我基线上**。
   WO 增补（`0207b9c6`）写下「6/3 红」时看的是那个 worktree。
3. **门的性质决定它不可能在本树红**：它断言「1.0 系数原样透传 + max」——
   `expect(readBefore).toBe(top.props.unitPrice)` 这种**逐字节等式**（测试 ②③⑤）。
   这恰好是本单要守的语义；desat3 的 `inflowCoefficient` 系数化（提交 81bd772e）撞的正是它。
4. **合并 desat3 后会再红吗**：门的 `runWorld` 走 tick1/3/5，全部 ≤ 5 拍，**绕开 TICKS 3→96**
   （提交 21bd880a）与 budgetTicks 2→95 的裁决面；max 语义不随拍数漂（测试 ⑤ 咬死）。
   风险面集中在 desat3 是否改这三条边的**系数**——三条边 `coefficient:1.0 / coefficientRef:null`
   且带「⛔ 不写 0.8」的护注释。合并时复跑本门即可，本单不提前背这口锅。

**三条 X⇒Y（按工单格式，针对「红」这个台账陈述本身）**：

| # | 台账说（X） | 实测（Y） |
|---|---|---|
| 1 | 门今天红（6/3） | 门在本树 6/6 绿；红面 = desat3 的 10 个未并提交，不在本树 |
| 2 | 红说明「传导标定」和「真值进世界」撞了 | 两线在本树未交汇（desat3 未并入）；撞点在 desat3 本地，撞的是 1.0 系数透传语义 |
| 3 | 开工前必须先修门 | 无门可修；要守的是「本单任何改动不得让这 6 条转红」 |

## 补充 ① 的衍生约束（写进本单验收）

- §1/§2/§3 每一步交付都必须**复跑本门保持 6/6** —— 它是 450 格真值的守门员，也是本单增量格的守门员。
- desat3 收编（仓主裁决 A/B/C 后）时，**并线方须复跑本门**；红了归并线方，不归本单。

## 补充 ③ · 第 1 步状态复核（与 WO 增补一致）

desat3 @ f072c8dc 仍未并入本树（`git merge-base --is-ancestor` = false，上同）。
⇒ 按增补纪律：**先做 §1（播种 recompute）与 §3（valueRef），§2 的 32 条式子可以写但验收要等裁决**。

---

## 前置验证（任务 #8，本树重测）

| WO 断言 | 实测（本树） | 出处 |
|---|---|---|
| 播种期零 recompute | ✅ 确认：`seedDemoDerivationSpecs` 只 compileSpecs + indexDerivationRefs；`server.ts` :101→:107 之间无任何 recompute 调用 | `server.ts` 播种序列 / `seed-derivation-specs.ts` |
| 绑定判据 = 名字撞 + 有限数 | ✅ 确认：`o.props[v]` typeof number && isFinite ⇒ measuredCells++，否则 hash 兜底 | `sim/seed-world.ts` `deriveSeedBaseSnapshot` |
| DSL 够用（A 档） | ✅ 确认能力面：单跳 out(L)/in(L) · SUM/MIN/MAX/AVG/COUNT .prop WHERE== · IF/COALESCE/CLAMP · ≤2000 字符 · 逐算子 4 位定点（⇒ 先乘后除）· div-zero→null+warning | `ontology-dsl.ts` |
| 450 格只喂 3 条边 | ✅ 确认：Order.qty/unitPrice/leadDays →（order_for_model）→ Model.backlogQtyTop/backlogPriceTop/backlogHorizonDays，`combine:"max"`、`coefficient:1.0`、`coefficientRef:null`、`weightRef:null` | `seed.ts` :1661-1750 |
| 那 3 个 target asSource=0 | ⏳ 待 ② 全表（51 对逐变量 asSource/asTarget 现算）确认 | 补充 ② |
| recompute 增量语义 | ✅ 确认：changes 空 ⇒ dirty 空 ⇒ 零计算；全量初算 = 每个 dep 的 (typeKey, prop, 全对象 id) | `ontology-core.ts` :341/:400-470 + `ontology-core.test.ts` 模式 |
| DEMO_SIM_WORLD_TICKS | 本树 = 3（desat3 改 96 未并） | `sim/seed-world.ts` :106 |

## 补充 ② · asSource 死胡同判据（待做，排在写式子之前）

- 现算 51 个 (类型,变量) 对的 asSource/asTarget 计数（已发布规则两端）。
- asSource=0 ⇒ 死胡同 ⇒ **先接边再写式子**；接边本身大概率越出本单边界（11 条边需 ① 先落地，
  见 `05cca413f`），这类对如实标注「阻塞在 ①」，不硬凑。
- 输出：每对的 9 列台账（类型·变量·格数·原料·式子·asSource·asTarget·档·处置）。

## 枚举重跑（任务 #9，待做）

`/tmp/enumerate-real-cells.mjs` 是旧树数据（45 对/7295 格/0 真值）。须在本树重跑：
预期 **51 对 / 6363 格 / 450 真值**；金丝雀 = 与活服务（新码）`measuredCells` 逐位一致。

## 未了

- [ ] ② asSource 全表 + 51 对分档台账（任务 #9 的扩展输出）
- [ ] 本树枚举重跑 + 活服务金丝雀
- [ ] §1 播种 recompute（server.ts + seed-cli.ts 双生子同步）
- [ ] §3 valueRef
- [ ] §2 32 条式子（可写，验收等裁决）
- [ ] 远端 `claude/handoff-real-cells` 是旧基线孤儿史 ⇒ 下次 push 须 `--force`
