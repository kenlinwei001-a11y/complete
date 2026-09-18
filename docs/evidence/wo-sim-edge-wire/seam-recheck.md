# WO-EDGE-WIRE-SEAM-RECHECK · 窄口径归因（只量不修）

**被验树**：`claude/handoff-edge-wire` tip = `631c9730`
**复验分支**：`claude/handoff-edge-wire-seam-recheck`
**取证时刻**：2026-09-18 02:28–（UTC）
**产物**：`/tmp/claude-0/.../scratchpad/recheck/<file>-run{1,2}.{txt,rc,canary}`（断言原文全文落盘）

---

## §0 前提自证（派单给的坐标是线索，我逐条实测过）

| 核的是 | 实测 | 判据 |
|---|---|---|
| HEAD | `631c9730` | `git rev-parse --short HEAD` |
| `desat3@f072c8dc` 是祖先 | ✅ | `git merge-base --is-ancestor f072c8dc HEAD` RC=0 |
| `real-cells@4bde203f` 是祖先 | ✅ | 同上 RC=0（**判据落在提交上，不是分支名** —— 派单已点明 `handoff-real-cells` tip 已前进到 `150143af`） |
| 四个目标测试文件 | ✅ 全在 | `ls` 四条全中 |
| `vitest.config.ts` `testTimeout` | **180000**（`hookTimeout` 同） | 读原文 |
| `seed-world.ts` `DEMO_SIM_WORLD_TICKS` | **= 96**（`seed-world.ts:129`） | 读原文 |

### ⚠ 派单 §2 判读钥匙 ② 的一处前提，实测不成立（**不影响结论，但会误导后来人**）

派单原文：「文件 ④ 的 4 条耗时远超 180s（**自带超大自定义超时**），饥荒可解释」。

**实测：`sim-seed-world.seam.test.ts` 一个自定义超时都没有** —— 全文零个 `it(..., <ms>)` 第三实参、零个 `timeout:`。
它的 4 条用例跑的就是全局 **180s**。金丝雀（证明我的查法是好的）：同一查法在
`sim-order-real-fields.seam.test.ts` 命中 **6 处 `}, 180000)`**、`seed-demo-propagation.test.ts` 命中 **1 处 `}, 180_000)`**（`:901`）。

⇒ **四个文件的每条用例，有效预算都是同一个 180s。** 那么基线里 246s–3491s 的读数只能是
「超时在 180s 名义上触发，但事件循环被饿到计时器回调晚发，墙钟被拉长」，**仍然是饥荒指纹**——
派单的**结论对，给的病因错**。照原文去找「超大自定义超时」会一个都找不到，然后以为这条钥匙过期了。

> **形态（照铁律 0.6 句式）**：「我用『它跑了 3491s』当作『它有个超大自定义超时』的证据，而前者并不度量后者。」

**同族的第二处订正**：派单说「文件 ①②③ 的 **5 条** × 全部死在 180s 预算之内」，
而 ①②③ 的 × 合计是 **6 条**。对得上的是：34.7 / 17.4 / 44 / 66 / 70 这 **5 个数**在 180s 内，
**①的 §6 那条 496s 不在**（它属超时族）。本报告按 6 条逐条归因，不按 5 条。

---

## §1 量法自证 · vitest 避让探针的**双向**金丝雀

判据 = 「父进程不是 vitest 的 vitest 进程」，即每棵进程树只算根（CLAUDE.md 铁律 1.6 已达第 3 次那条）。

| 方向 | 要求 | 实测 | 证据 |
|---|---|---|---|
| **空闲必须报 0** | 报非 0 ⇒ 把自己/worker 算进去了 | ✅ **0** | 每个 `.canary` 文件头都是 `vitest_tree_roots=0` + `vitest_proc_total=0` |
| **只跑一个 run 必须报 1** | 报 ≥2 ⇒ 在数 worker | ✅ **1** | 见下方原文 |

```
=== CANARY DIRECTION 2 (one run active => must be 1) 2026-09-18T02:29:25+00:00 ===
tree_roots=1
proc_total=3
--- raw (pid ppid comm) ---
 1168  1158 npm exec vitest
 1181  1180 node (vitest)
 1216  1181 node (vitest 1)
```

**这三行正是「只有单向金丝雀不够」的当场实证**：同一时刻朴素计数 `proc_total=3`，
树根计数 `tree_roots=1`。⇒ 拿 `ps | grep -c vitest` 当并发数，单个 run 会被读成 3。

`run.sh` 里两条硬闸：`roots != 0` ⇒ RC=99 拒跑；**`roots==0` 但 `proc_total>0` ⇒ RC=98 报「匹配坏了」，不许报「空闲」**。
八次跑全部 RC=0 通过闸门（无 98/99），⇒ **八次都在清洁窗口起跑**。

---

## §2 环境前置 · 一次与本单无关的假红（已排除，不计入两次跑）

第一次起跑 `seed-demo-propagation` 直接 RC=1、`Tests no tests`：

```
Error: Failed to resolve entry for package "@platform/llm-adapters".
  Plugin: vite:import-analysis
  File: .../apps/datacore/src/llm.ts
```

**不是合并树的问题，是 worktree 缺 build 产物。** 派单 §3.1 只点名了 `@platform/contracts`；
实测 **`@platform/llm-adapters` 同样必须先 build**，否则 datacore 一个测试文件都跑不起来
（`packages/dsh-harness` 无 `main`/`exports`/`build`、且不是 datacore 依赖，不用管）。

补跑 `pnpm --filter @platform/llm-adapters build`（RC=0）后重开 run1。**该次作废，不计入「连跑 2 次」。**

---

## §3 逐文件四栏

### ① `apps/datacore/test/seed-demo-propagation.test.ts` — **真红**

| 栏 | 内容 |
|---|---|
| **两次 RC** | run1 `RC=1` / 62s · run2 `RC=1` / 59s（两次均 `2 failed \| 17 passed (19)`） |
| **失败用例名** | (a) `🔴 效果层 SEAM：供应侧扰动（Supplier.deliveryDelay）跨 3 跳真的传导到 Order.shortageRisk`<br>(b) `🔴 联立接缝：播完种的世界 0 格反算越界；同一把尺子在 tick0 必须量出数百格（金丝雀）` |
| **断言原文** | 见下 |
| **归因** | **合并树真红**（两次红 + 两次读数**逐字节相同**） |

**(a) `seed-demo-propagation.test.ts:324:42`**
```
AssertionError: expected 0.44585 to be 0.8917 // Object.is equality
- Expected   0.8917
+ Received   0.44585
 ❯ test/seed-demo-propagation.test.ts:324:42
    322|     const exp1 = Math.round(10 * coefOf("demo_supplier_delay_to_materi…
    323|     expect(exp1, "第 1 跳的期望值算成 0 ⇒ 系数或权重取数坏了（0 会让下面三句自洽成绿）").toBeGreate…
    324|     expect(t1[materialId]!.shortageRisk).toBe(exp1);
```
**指纹：received 恰好是 expected 的 1/2**（`0.8917 / 0.44585 = 2.000000`，两次跑同值）。
期望式是 `exp1 = 10 × coefOf(rule) × w1`，其中 `w1 = weightSumOf(tick1 回包, rule, materialId)`，
而 `weightSumOf` 在**回包里没有该规则的逐对出处时回落为 1**（`:316` `rows.length === 0 ? 1 : Σweight`）。
⇒ **期望式与引擎读数之间差一个精确的 0.5。** 注意 `:323` 的防线（`exp1 > 0`）**通过了**
⇒ 不是「取数坏了自洽成绿」那一态，是真差一半。

⚠ **到此为止是实测；再往下是候选，本单不裁决**（铁律 0.5：不许拿一层推断当结论）。
`coefOf` 与引擎读的是同一张规则表 ⇒ 系数是共享的，差异只可能落在 `w1` 这一侧。两个候选：
① 引擎按 Σ=1 对两个源各施 0.5，而回包 `explain` 里该 (ruleKey,targetObjectId) **一行都没有** ⇒
`weightSumOf` 走 `:316` 的 `rows.length === 0 ? 1` 回落成 1；② 回包有行但口径与引擎实际施加的不同。
**分辨这两者要打印 `tick1.pairWeighting.report.explain` 的实际行数 —— 留给修单，本单不改代码不下此结论。**
可以确定的是：**这是两半合并才暴露的接缝** —— 权重口径（`real-cells` 侧）与三跳断言（`desat3` 侧）各自成立、合起来不一致。

**(b) `seed-demo-propagation.test.ts:847:54`**
```
AssertionError: 末拍一个已声明量纲的格都没数到 ⇒ 取数坏了: expected +0 to be 4937 // Object.is equality
- Expected   4937
+ Received   0
 ❯ test/seed-demo-propagation.test.ts:847:54
    845|     // ── 主判据：播完种的世界，已声明量纲的格 0 格反算越界 ──────────
    846|     const atEnd = overDomain(last as unknown as Record<string, Record<…
    847|     expect(atEnd.declared, "末拍一个已声明量纲的格都没数到 ⇒ 取数坏了").toBe(atT0.declare…
```
**它死在哪一档，很重要**（该用例自带两只金丝雀，**两只都活着**）：
- `:825` `session.curTick === DEMO_SIM_WORLD_TICKS` **通过** ⇒ 96 拍预滚正常，播种落地；
- `:827` `tick96` 行**不为 null** ⇒ 末拍行在库里；
- 金丝雀① `unsaturate ∘ saturateToDomain` 往返 **通过** ⇒ 普查器的逆没写错；
- 金丝雀② `overDomain(baseSnapshot).declared = 4937 > 1000`、`.over > 100` **通过** ⇒ **普查器本身是好的**。

⇒ **同一支普查函数，量 `baseSnapshot` 得 4937 格，量 `tick96` 行得 0 格。**
不是「越界了」，是**末拍行里一个「已声明量纲的数值格」都认不出来** ⇒ 末拍行的**单元格形状**与 baseSnapshot 不同
（`overDomain` 只认 `typeof v === "number"`）。**指纹与 `real-cells`（真格）改动的落点一致**，
但本单只量不修，**根因不在本单射程内，留给修单去证**。

> ⚠ 派单 §2 钥匙 ② 提醒防的那种真红（断言写死 desat3 时代 `curTick=3`）**在本文件不成立**：
> `:825` / `:826` 用的都是 `DEMO_SIM_WORLD_TICKS` 常量，不是字面量 3，且该断言**通过**。
> 这一条红与「3 → 96」无关。

**最小复现**
```bash
cd apps/datacore
npx vitest run test/seed-demo-propagation.test.ts -t "效果层 SEAM" --pool=forks --maxWorkers=1
npx vitest run test/seed-demo-propagation.test.ts -t "联立接缝" --pool=forks --maxWorkers=1
```

**× 的耗时对照（清洁窗口 vs 基线污染窗口）**

| 用例 | 基线（污染） | 本次 run1 | 本次 run2 |
|---|---|---|---|
| 效果层 SEAM 3-hop | 34.7s | **2.168s** | **2.214s** |
| §6 DESAT-3 联立 | 496s | **21.807s** | **20.806s** |

耗时塌了 **16×–23×** ⇒ 基线那两个数确实是饥荒读数；**但红本身不是饥荒来的，清洁窗口照样红。**

---

### ② `apps/datacore/test/object-constraint-refs.seam.test.ts` — **环境伪红**

| 栏 | 内容 |
|---|---|
| **两次 RC** | run1 `RC=0` / 22s · run2 `RC=0` / 22s（两次均 `8 passed (8)`） |
| **失败用例名** | 无 —— **全绿** |
| **断言原文** | 无 |
| **归因** | **环境伪红**（基线那 1 条 × 是污染窗口产物） |

**报「全绿」必须贴的金丝雀（起跑前树根 = 0）**：
```
=== PRE-RUN CANARY 2026-09-18T02:32:06+00:00 ===   |   === PRE-RUN CANARY 2026-09-18T02:32:28+00:00 ===
file=object-constraint-refs.seam.test.ts run=1     |   file=object-constraint-refs.seam.test.ts run=2
vitest_tree_roots=0                                |   vitest_tree_roots=0
vitest_proc_total=0                                |   vitest_proc_total=0
```
（两个量同时为 0 ⇒ 不是「匹配坏了假装空闲」；`run.sh` 对 `roots=0 && total>0` 会 RC=98 拒跑。）

基线点名的那条 ⑤b，本次两跑都绿且**快了 7–8 倍**：

| 用例 | 基线（污染） | run1 | run2 |
|---|---|---|---|
| `⑤b 非数字属性…不许塌给 id 字典序` | 17.4s（×） | **2.409s ✓** | **2.080s ✓** |

---

### ③ `apps/datacore/test/sim-order-real-fields.seam.test.ts` — **真红**

| 栏 | 内容 |
|---|---|
| **两次 RC** | run1 `RC=1` / 24s · run2 `RC=1` / 22s（两次均 `3 failed \| 3 passed (6)`） |
| **失败用例名** | ② 改真值 ⇒ 下游读数必须跟着变 · ③ 两张金额差一个量级的真订单…必须拉开 · ⑤ 接缝：真值必须出现在传导结果里，且 max 语义不随拍数漂 |
| **断言原文** | 见下（两次**逐字节相同**） |
| **归因** | **合并树真红** |

```
FAIL ② 改真值 ⇒ 下游读数必须跟着变：把一张单的价格 ×1.5，重跑同一套推演
AssertionError: expected 8376.06 to be 22638 // Object.is equality
 ❯ test/sim-order-real-fields.seam.test.ts:166:24
    165|     // 系数 1.0 原样透传 + max ⇒ 下游读数就是那张 top 单的真实单价（可预言，不是"大概相关"）
    166|     expect(readBefore).toBe(top.props.unitPrice);

FAIL ③ 两张金额差一个量级的真订单，同一个扰动 ⇒ 下游读数必须拉开
AssertionError: expected 5430.4900000000125 to be 14677 // Object.is equality
 ❯ test/sim-order-real-fields.seam.test.ts:228:8
    226|     // 可预言：差额恰等于两张单真实台数之差（系数 1.0 + delta 同幅 + max）
    227|     expect((readBig as number) - (readSmall as number))
    228|       .toBe((big.props.qty as number) - (small.props.qty as number));

FAIL ⑤ 接缝：真值必须**出现在传导结果里**，且 max 语义不随拍数漂（不是纯积分器）
AssertionError: obj_model_4680-NCM.backlogHorizonDays @tick1: expected 40.7 to be 110 // Object.is equality
 ❯ test/sim-order-real-fields.seam.test.ts:262:70
    262|         expect(w1[modelId]?.[target], `${modelId}.${target} @tick1`).t…
```

#### 指纹：三条 × 是**同一个**因子，不是三个 bug

```
8376.06            / 22638 = 0.370000000000   inverse = 2.702703
5430.4900000000125 / 14677 = 0.370000000000   inverse = 2.702703
40.7               / 110   = 0.370000000000   inverse = 2.702703
```

**三条读数全是期望值的 `×0.37`，精确到 12 位小数。** 这个 `2.702703` 不是巧合 ——
`seed-demo-propagation.test.ts:851` 的失败信息里白纸黑字写着「**② 没 ×λ ⇒ 每格稳态大 2.7 倍**」。

机制指向（**只指不修**，本单零代码改动）：`src/sim/propagation.ts:743`
```ts
bucket[stateVar] = round12(rest + (1 - lambda) * (cur - rest));
```
`rest = 0` 且 `lambda = 0.63` 时该式恰为 `0.37 × cur`；同文件 `:705` 的注释就拿 0.63 当范例
（`1+0.63+0.397=2.0269`）。而本文件三条断言写的都是「**系数 1.0 原样透传**」——
即 `desat3` 侧新加的每拍衰减 λ，与 `real-cells` 侧「真值原样透传」的断言，**两半各自成立、合起来不成立**。

> **这正是 SEAM-GATE 要抓的那一类**：两个半边分别绿，接缝上红。
> ⚠ 与文件 ① (a) 的 `×0.5` **不是同一个因子** ⇒ 至少两处独立的接缝不一致，别当成一个 bug 去修。

**最小复现**
```bash
cd apps/datacore
npx vitest run test/sim-order-real-fields.seam.test.ts -t "改真值" --pool=forks --maxWorkers=1
```

**耗时对照**：基线 44s / 66s / 70s → 本次 **2.877s / 3.258s / 2.740s**（快 15–25 倍），**清洁窗口照样红**。

---

### ④ `apps/datacore/test/sim-seed-world.seam.test.ts` — **真红（但只剩 1/4，不是基线的 4/4）**

| 栏 | 内容 |
|---|---|
| **两次 RC** | run1 `RC=1` / **328s** · run2 `RC=1` / **323s**（两次均 `1 failed \| 3 passed (4)`，断言读数**逐字节相同**） |
| **失败用例名** | `⑤ 扰动接缝：播种 ⇒ 会话有扰动 ⇒ metric-series 两条线分叉 ⇒ 且被带动的对象不止落点自身`（256487ms） |
| **断言原文** | 见下 |
| **归因** | **合并树真红**（另 3 条 × 是**环境伪红**，清洁窗口全绿） |

**基线 4/4 全红 ⇒ 本次 1/4 红。被平反的三条**：

| 用例 | 基线（污染） | run1（清洁） |
|---|---|---|
| 用例 | 基线（污染） | run1（清洁） | run2（清洁） |
|---|---|---|---|
| ① 播种 / tick 落盘 / 幂等 | × | **✓ 20.889s** | **✓ 20.624s** |
| ⑥ 确定性 R6 逐字节一致 | × | **✓ 45.885s** | **✓ 45.828s** |
| ④ 诚实缺席（不建空世界） | × | **✓ 0.375s** | **✓ 0.492s** |
| ⑤ 扰动接缝 | × | **× 256.487s** | **× 251.214s** |

整文件 328s / 323s vs 基线 **4,527s** ⇒ 快 **13.8 倍**，但**红没被快掉**：
⑤ 两跑都红，且 `expected 2445 to be 3861` **两次逐字节相同** ⇒ 不是 flaky。

```
FAIL ⑤ 扰动接缝：播种 ⇒ 会话有扰动 ⇒ metric-series 两条线分叉 ⇒ 且被带动的对象不止落点自身
AssertionError: 结构可达面与真跑对不上 ⇒ 排序键度量的不是传导: expected 2445 to be 3861 // Object.is equality
- Expected   3861
+ Received   2445
 ❯ test/sim-seed-world.seam.test.ts:459:70
    457|     // `reachCells` 的口径：**不含落点那一格**（落点对象上的其它格仍算下游）。
    458|     const censusDownstreamCells = census.moved.filter((k) => k !== lan…
    459|     expect(censusDownstreamCells.length, "结构可达面与真跑对不上 ⇒ 排序键度量的不是传导").t…
```

**这是真断言失败，不是超时**：`Tests 1 failed | 3 passed` 且报的是 `AssertionError`，
不是 vitest 的 timeout 文案。⚠ 它跑了 256s 却**没被 180s 超时打断** —— 因为该用例的重活是
**同步 CPU 密集**（两条世界线回放），JS 计时器在同步块里根本没机会触发。
**这恰好解释了基线那个 3491s**：不是「超时设得大」，是**超时压根打不断它**。

**最小复现**
```bash
cd apps/datacore
npx vitest run test/sim-seed-world.seam.test.ts -t "扰动接缝" --pool=forks --maxWorkers=1
```

#### ⚠⚠ 派单 §2 判读钥匙 ② 把两半**写反了**（实测，三个提交逐一取证）

派单原文：「断言的是 **desat3 时代行为（全新世界 `curTick=3`）**，而合并树已是 **96 拍预滚**」。

**实测恰恰相反**：

| 提交 | `src/sim/seed-world.ts` 的 `DEMO_SIM_WORLD_TICKS` |
|---|---|
| `desat3@f072c8dc` | **96**（`:129`） |
| `real-cells@4bde203f` | **3**（`:106`） |
| 合并树 `631c9730` | **96**（`:129`） |

⇒ **96 才是 desat3 侧的值，3 是 real-cells 侧的值。** 照钥匙原文去找「desat3 时代的 curTick=3」
会一个都找不到，然后误以为这条钥匙过期。

**而且这条钥匙的『真红』触发条件在本文件不成立**：全文**零个**写死的 tick 字面量断言
（查 `toBe(3)` / `curTick.*3` / `=== 3` 全部零命中；**金丝雀**：同一查法查 `DEMO_SIM_WORLD_TICKS` 命中 **3 次**
⇒ 查法是好的，是那个形状真的不在）。三处 tick 断言（`:201` `:265`，以及 ①的 `:825`）**全部走常量**，
所以 3→96 之后断言自己会跟着走，**不会因此变红**。

**但 3→96 把成本放大了 32 倍，这才是文件 ④ 又慢又是重灾区的真因**：
`sim-seed-world.seam.test.ts:143-144` 的普查助手每次调用都**回放两条完整世界线**
（`replayWorldLine(..., toTick: s.curTick)` × 2 = actual + baseline），
随后对每个格子铺 `curTick + 1` 长的数组并 `JSON.stringify` 比对（`:162` `:168-176`）。
`s.curTick` 从 real-cells 的 **3** 变成合并树的 **96** ⇒ **回放与比对的工作量 ×32**。

> **形态（照铁律 0.6 句式）**：
> 「我用『断言用的是常量所以跟着走了』当作『这个合并没有后果』的证据，而前者并不度量后者
> —— 断言的**正确性**跟着常量走了，断言的**成本**也跟着走了，后者没人看。」

#### 这条红**不可能是「测试文件漂了」** —— 实测

| 对比 | 结果 |
|---|---|
| `sim-seed-world.seam.test.ts` 行数（desat3 / real-cells / 合并树） | **538 / 538 / 538** |
| 合并树 vs `desat3@f072c8dc` | **0 行差异** |
| 合并树 vs `real-cells@4bde203f` | **0 行差异** |
| `:459` 那句断言在两个父提交上 | **两边都有**（各命中 1 次） |

⇒ **三棵树上这个测试文件逐字节相同**，且合并树的 `DEMO_SIM_WORLD_TICKS` 取的是 **desat3 侧的 96**。
测试没变、常量随 desat3，那么 `:459` 的 `2445 ≠ 3861` 只能来自**另一半（real-cells）的源码改动**
与 desat3 的 96 拍世界**合起来**的结果 —— 即**接缝**，不是任何一半自己的回归。

⚠ **边界**：我**没有**在两个父提交上各跑一遍这个文件（超出「只量不修」且每跑 ≈5.5 分钟）。
上面「两半合起来才红」是**从三份逐字节比对推出来的**，不是从两次对照跑测出来的。
要坐实它，修单应当在 `f072c8dc` 与 `4bde203f` 上各跑一次 `-t "扰动接缝"` 做对照。

---

## §4 总判

### 逐文件总判（派单要求的那一句）

| # | 文件 | 总判 |
|---|---|---|
| ① | `seed-demo-propagation.test.ts` | **真红待修**（2 条） |
| ② | `object-constraint-refs.seam.test.ts` | **清洁窗口成立**（两跑全绿 8/8） |
| ③ | `sim-order-real-fields.seam.test.ts` | **真红待修**（3 条，同一个 ×0.37） |
| ④ | `sim-seed-world.seam.test.ts` | **真红待修**（1 条；另 3 条平反为环境伪红） |

### 18 条 × 里，本单射程内那 10 条的归属

| 文件 | 基线 × | 清洁窗口 × | 平反 |
|---|---:|---:|---:|
| `seed-demo-propagation` | 2 | **2** | 0 |
| `object-constraint-refs.seam` | 1 | **0** | 1 |
| `sim-order-real-fields.seam` | 3 | **3** | 0 |
| `sim-seed-world.seam` | 4 | **1** | 3 |
| **合计** | **10** | **6** | **4** |

⇒ **基线那 10 条 ×，4 条是污染窗口的假象，6 条是合并树真红。**
⚠ 另外 6 个 ❯ 文件（`sim-sessions-projection.seam` 3 · `dynamic-drill-resolve.seam` 1 ·
`engine-scope-fidelity.seam` 1 · `factor-scope-singlesource.seam` 1 · `m11-calibration` 1 ·
`column-security` 1，共 8 条）**不在本单射程**，仍是 **NOT-ADJUDICATED**，本报告不对它们下任何结论。

### 6 条真红是**至少 3 个独立缺陷**，不是一个

| 缺陷 | 指纹 | 涉及 |
|---|---|---|
| **A** | 读数 = 期望 **×0.5** | ①(a) 三跳权重 |
| **B** | 读数 = 期望 **×0.37**（= `1−λ`，λ=0.63） | ③ 全部 3 条 |
| **C** | 计数对不上（`2445 ≠ 3861`）、末拍格数 `0 ≠ 4937` | ①(b) + ④⑤ |

**⛔ 别当成一个 bug 去修** —— 0.5 与 0.37 是两个不同的因子，C 类根本不是比例问题。

### 本单没做、留给修单的两件（明说，免得被当成已核）

1. **①(a) 的两个候选没分辨**（引擎权重 0.5 vs 回包 explain 缺行）——
   需要打印 `tick1.pairWeighting.report.explain` 的实际行数才能定。
2. **④⑤ 的「两半合起来才红」是比对推断，不是对照跑实测** ——
   需在 `f072c8dc` 与 `4bde203f` 上各跑一次 `-t "扰动接缝"` 坐实。

### 纪律自查

- **零代码改动**：本单只量不修。`git diff 631c9730..HEAD --stat` 只含 `docs/evidence/wo-sim-edge-wire/seam-recheck.md` 一个文件。
- **八次跑全部落 `.txt`/`.rc`/`.canary`，RC 由 `$?` 直接捕获**，⛔ 无 `cmd | tail; echo $?`（那取的是 `tail` 的 RC）。
- **八次起跑闸门全部 `roots=0 total=0`，零 ABORT**（§1）。
- **⛔ 未推 canonical**；产出只在 `claude/handoff-edge-wire-seam-recheck`。
- **收尾自证：窗口全程独占，且本单零残留。**
  八次跑的时间跨度 = `02:28:45`（首个 canary）→ `02:44:47`（run2 收尾）。
  收尾时进程表里确有一组 vitest，但**不是我的**：`/proc/<pid>/cwd` 指向
  `worktrees/agent-a9062d94254a902ae`（另一个 agent），`cmdline` 为 `vitest run --root apps/datacore`
  且带 worker 1/2/3，而**本单八次全部 `--maxWorkers=1`**；其进程起始时刻 **02:45**，
  **晚于 run2 结束（02:44:47）** ⇒ 与本单**零重叠**，既没污染我，我也没留下孤儿。
  ⚠ 这一条是照铁律 1「别拿『进程表里有 vitest』当『我的没清干净』的证据」查的 ——
  **判据落在 `cwd` + `cmdline` + 起始时刻上，不是「有没有 vitest 字样」。**
