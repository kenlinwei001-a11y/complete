# WO-C0828-P2 收编附记（反事实定价 · 2026-09-29）

被验 commit：51a13d002（ab3e045a5 P2 merge no-ff 干净零冲突 + 本体回写 51a13d002）
分支 claude/handoff-wo-c0828-p2 tip 4dfc8b595 全量并入；PRD 依据 docs/PRD-sim-options-decision-surface.md 终稿 canonical 4a8e02fc6。

## 复验结果（全部独立重跑，不采信实施方数值）

- 单测 21+E2 25/25（rc=0）
- E2 live 双世界 23/23 PASS，数值与实施方逐字节一致：
  - E2-b′ 剂量对 p90 单调不增：w1 0.5898104503240003→0.5240231994620004；w2 0.5835048219210002→0.5524699271200006
  - E2-c 对照恒同：150 张 / 15663001584 元；Line.utilization 候选 after.displacement 与 control 逐字节同（no-fake）
  - E2-e 4×gap 点名 missingBinding{Process,attendance|yield_baseline}，specKey null/undefined（不返 0 不返 =E0）
  - E2-f 10 条披露全字段 + agentInvolved:false + elapsedMs 五段
  - E2-g 双世界定价前后快照逐字节不变（persist:false 零写入坐实）
- E6-a 1680×900 ratio=1.0000（444/444）≤1.15，终态两次采样相同，真后端 33 条命中；屏上文本同证 E2-b″（150 张 · 156.6 亿 · 位移 p90 0.09 + 四档位移分布 + 口径声明 + 披露全文）
- 前端 76/88：12 红 = sim-rail-forms ④（工单已知红清单在案）+ sandbox-ia-consolidate 11（baseline A/B 逐字节同 = 继承红，非 P2 引入）

## 三件禁令自查（§11.3）

① 敞口定义未改（PRESSURE_DOMAIN_SOURCE 口径声明现行有效）② 7/13 杠杆绑定未补（impediment-options.ts diff 仅为 export 可见性 + resolveBusinessRefToObjectId 复用同链，单源无绑定变更）③ 未新增门/棘轮/基线 JSON。全部未触碰。

## 机制偏差裁定

branch 重放 → simAdvanceTicks persist:false + ephemeralPerturbations 语义等价成立：E2-g 零写入实测 + 对照=不处置实测 + 守卫三重已读。

## 两披露裁决

① **leadTime 候选 Ec>E0 过冲**：独立复现（dose-10 p90=0.5898 远超 control 0.0927）。机制正确——PEER_BEST 档把杠杆拨到「同类真值极值」，反事实幅度大是口径本身；**枚举语义（26→10 这样的极端拨动该不该枚举进默认档）交仓主裁决**。
② **本体回写缺口**：确认（P2 diff 零本体文件）。已补五条：SolutionCandidate 第三消费方（§2.I）、§3 对策定价链路段、§8 G-IMPEDIMENT-OPTION-NOJOIN 控制台侧闭合、§8 新账 G-C0828-EXPOSURE-STEP（敞口门槛后全额求和=阶跃量，已知口径缺陷只登记不修）、measuredCells 过期句订正（450=150×3）。

## 四包电池（收编门 · 被验 commit 51a13d002）

工作树 `/Users/apple/deploy/complete`；五包 build 见 `master.txt` / `build-*.txt`。
**本机为共享机**（同期另有别的 agent 的 datacore 全包在跑），datacore 侧我这一方同时只跑一条线。

### ⚠️ datacore：全包被砍 + 改线，两件事都如实披露

**① 全包跑到 132/364 文件被砍（5.5h）**，不采信为交付证据。理由：P1 电池验的就是本树的
**父提交**（`b4cd399c4`，同一条 canonical 线），P2 相对它只动 12 个文件；P1 报告自己写着
「真实成本约 9.5h 在盘点共享机环境、0.5h 在验代码」⇒ 再全量跑一遍度量的是机器不是这次改动。
**该决定经仓主批准**（「砍 datacore 改 delta 线」）。
被砍前跑出的 132 文件里 6 红**已逐个 solo A/B 定性**（下表），不是丢弃。

**② 「delta 线（`vitest related`）」实测在本仓不成立** —— 已用路由族线替代，此偏差如实登记：
本仓 `apps/datacore/test/helpers.ts` 是唯一直接 import `../src/app.js` 的测试文件，而
**324/364（89%）测试 import `./helpers.js`**（即每条测试都起整个 app）⇒ `vitest related <app.ts>`
机械地捞出 89% 的包，**等于换个名字的全包**。
替代判据落在**真的构造请求**的语法位置（`url: *[`"]/a/v1/sim/sessions`）——P2 新路由所在的路由族，
**32 个文件**；双向金丝雀验过：正（sim-session 系 3 命中）、反（`option-pricing.test.ts` 为纯函数单测、
不打 HTTP，必须 0 命中 ⇒ 实测 0）。

| datacore 线 | 结果 | 说明 |
|---|---|---|
| 被砍全包 6 红 solo A/B | 6/6 出 RC：`turn-loop` **0**；其余 5 个 = 1 | `datacore-ab6/battery-solo.txt` |
| ── 5 个红的失败模式 | **超时 26 例 · 断言失败 0 例** | 见下方「失败模式」 |
| vle-acceptance | **环境红 · 已定性** | 有对照实验，见下 |
| 路由族线 32 文件 | **第二次启动：全绿 · RC=0** | 32/32 文件、**339 用例全过**、933.6s；见下 |

#### ⚠️ 取证窗口内 canonical 前进了一格（如实登记）

`51a13d002` --ff--> `964070665`（2026-09-28 **18:53:12**，另一张单 WO-CONSOLE-COPY 的收编）。delta 三条：
① `packages/contracts/src/sim-drill.ts` 8 行 —— **仅 payloadKey 的 hint 文案**（如
`"插哪个型号 —— 这一格决定算出来的数，必填"` → `"插单型号（型号 id）"`），schema / 行为零变化；
② `apps/frontend-shell/src/views/sim/`（DecisionConsoleView.tsx / decisionConsoleModel.ts / .module.css）
+ `test/decision-console-model.test.ts`；③ `docs/evidence/wo-console-copy/**`。

**对本次电池的影响已逐条核过**：
- **datacore / agentcore 源码在该 commit 里零改动**（`git diff --name-only 51a13d002 964070665 -- apps/datacore/ apps/agentcore/` 为空）⇒ 这两包结论不受影响。
- 契约侧唯一风险是「有测试咬着旧文案」。**三条旧 hint 串在全仓测试里零命中**；
  `插哪个型号` 命中的唯一一处在 **doc 注释**里（剥注释看语法位置才敢下这个结论，见铁律 0.6 第 6 条）。
- 窗口内混线如实登记：datacore 全包前半 + 6 红 solo 的前两个文件在 `51a13d002` 上跑；
  contracts dist 于 **18:55** 重建（晚 ff 2 分钟）；**前端全包跑在新树 `964070665`** ——
  即「将要部署的那棵树」，比钉 `51a13d002` 更贴部署面。

#### 对照实验：`vle-acceptance` 的红是负载放大，不是 P2 引入（同一文件、同一时段、两棵树）

该用例自己带着 `{ timeout: 120000 }` 的 describe 级硬预算，**CLI 的 `--testTimeout` 覆盖不了它** ——
所以它在负载下不是「变慢」而是「直接红」。三组数：

| 用例 | P1 全包（低载，基线树） | P2 树 solo（18:42） | **基线树 solo（19:03，同负载）** |
|---|---|---|---|
| VL2 | 44.06s ✓ | 59.58s ✓ | **133.89s × 超时** |
| VL4 | 9.39s ✓ | 18.50s ✓ | 54.82s ✓ |
| VL5 | 48.02s ✓ | 132.74s × 超时 | **147.27s × 超时** |
| 整文件 | 101.48s 全绿 | 237.98s / 1 红 | 380.38s / **2 红** |

**判据**：拿 P2 的**父提交**（`b4cd399c4`，P1 验过、该文件 101.5s 全绿的那棵树）在同一负载窗口
（load ~450）跑同一文件 —— **它比 P2 树更红**（连 VL2 都超时）。
⇒ 红是机器的，不是这次改动的。拉伸系数 2–6× 也自洽：48.02s × 2.75 ≈ 132.7s，刚越 120s 预算。
（同族先例：本仓 2026-09-16 已记过同一对用例「120s 超时 → solo 复跑 93s/98s 绿 = 负载抖落」。）

#### 被砍全包 5 个红的失败模式：清一色超时族，零断言失败

`solo` 逐个重跑（每文件独占一次 vitest），6 个文件 6 个 RC：`turn-loop` **RC=0**（绿 ⇒
全包时那条红确系负载），其余 5 个 RC=1。对整条日志做失败模式统计：

| 失败模式 | 计数 |
|---|---|
| `Test timed out in Nms` | **26** |
| `AssertionError` / `expected … to …` | **0** |
| `Tests  no tests`（转换/收集阶段就没起来） | 1 |

⇒ **这条线上没有一个红是「算错了」，全部是「跑不完」**。为 `dynamic-drill-resolve` 单开的
轻载复跑（`drill-recheck/`）给出同一结论的另一面：它连 transform 都没走完
（transform **1346s**、collect 0ms、`Tests no tests`）—— 机器连「把测试装载起来」都做不到。

#### ⚠️ 机器降级：全包 / 路由族线 / 前端包**未能完成**（本段是本轮最该被看见的）

不是「慢」，是近乎停摆。取证窗口实测：

| 读数 | 值 |
|---|---|
| `Pages free` | **~7 MB**（1742–2335 页） |
| 压缩器占用 | ~10 GB（2.6M 页） |
| swap 使用 | **12.5 GB / 23.5 GB** |
| 单条用例耗时（路由族线内） | **1,402,810 ms**（23.4 分钟；正常为秒级） |
| 路由族线进度 | 第一次：9.5 小时完成 **1 / 32** 文件；**第二次：16 分钟 32 / 32 全绿** |
| agentcore 全包进度 | 12 小时完成 **85 / 209** 文件（40%），**零 FAIL 文件**、5 超时、0 断言 |

⇒ 可预见时间内**不可能**跑完 agentcore 余下 124 文件 + frontend 323 文件。故主动停掉这两条重线
（按确切 pid 逐个 kill，**未触碰别的 agent 的进程**；停线前的部分结果全部保留在证据文件里）。
**这不是「跳过验证」，是「换一个能给出结论的面」**。

**停线后机器恢复（free 内存 7MB → 6.4GB），同一份代码重跑，结果自己把话说了**：

| 线 | 降级窗口（第 1 次） | 恢复后（第 2 次） |
|---|---|---|
| 路由族线 32 文件 | 9.5 小时完成 **1 个文件**（单条用例 1,402,810ms） | **16 分钟全绿：32/32 文件 · 339 用例 · RC=0**（933.6s） |
| 定向集 datacore 单文件 | 单条用例 23 分钟 | **33 秒 25/25 全过** |

⇒ 「跑不完」是机器的，不是这次改动的 —— 这组对照本身就是本轮最强的环境归因证据。

#### 替代证据面：定向集（P2 改动面本身）—— **已收口**

| 定向集 | 结果 | 说明 |
|---|---|---|
| datacore `option-pricing.test.ts` | **25/25 通过 · RC=0**（33.1s） | P2 全部单测 |
| frontend 5 个 P2 触碰文件 | **70/71 通过 · 4/5 文件过** | 唯一红 = `sim-rail-forms ④ 做不到臂`，**工单在案的已知红**（P1 全包红名单里同一文件同一用例） |

被验 commit：datacore 段 `964070665`、frontend 段 `964070665`（该段跑完后 canonical 又前进到 `57918bad8`，
其 delta 为 `docs/evidence/wo-console-copy/**`，**零源码** ⇒ 不影响本段结论）。
**这一面证明的是「P2 改动面自身绿」**，边界见下。

判据 = `git diff --name-status b4cd399c4 ab3e045a5 -- '*/test/*'`：**P2 改过的每一个测试文件**。
覆盖 datacore `option-pricing.test.ts` + frontend 5 个（`console0828-decision.seam`（P2 新增 ⑦c/⑦c-gap
定价用例）/ `exposure-responds-to-perturbation` / `sim-session-lifecycle` / `sim-unified-shell` /
`sim-rail-forms`）；证据 `targeted/`，被验 commit `964070665`（= 将要部署的那棵树）。
**明说它的边界：这一面替不掉全包的「无附带损伤」结论 —— 全包面本轮未取得证据。**

**顺带登记的覆盖缺口（不是本轮引入，是被本轮发现的）**：P2 新增的
`POST /a/v1/sim/sessions/:id/pricing` 这条路由，**全仓没有任何 HTTP 级自动化测试** ——
datacore 侧只有 `option-pricing.test.ts` 这种直接 import 模块的纯函数单测；
前端 ⑦c 用例用的是 `vi.mock("@/api/endpoints")`，打的是替身不是真路由。
它今天的端到端覆盖**只来自本报告的 E2 live 真后端实探（23/23 PASS）**。
⇒ 未来这条路由若被改坏，**机器不会先说话**。建议后续补一条打真路由的接缝测试（本轮不新增门，遵禁令 3）。

### agentcore / frontend-shell

| 包 | 结果 | 说明 |
|---|---|---|
| agentcore 全包 | **未完成（85/209 · 40%）** | 已跑的 85 个文件里 **零 FAIL 文件**（5 超时 / 0 断言）；停线原因见上「机器降级」。P2 对 agentcore **零文件改动** |
| frontend-shell 全包 | **未启动** | 排在 agentcore 之后，agentcore 未收口故未开始；由**定向集**里的 5 个 P2 触碰文件顶替，见上 |
| 已知红基线（供后续复跑参照） | — | P1 全包 323 文件 / 8 红：`disruption-cards` / `references-family` / `sandbox-config-collapse` / `sandbox-config-ux` / `sandbox-kpi-layer` / `sandbox-three-zone` / `sim-rail-forms` / `stale-claims`；另 `sandbox-ia-consolidate` |

**A/B 对照树的口径（原计划用的那棵树已被证伪，记账）**：原打算用 `/tmp/wt-base-front`
（@`4a8e02fc6`）当基线 —— 实测**它早于 P2 的父提交**（缺 1 个测试文件，`18 vs 19`），
拿它做 A/B 会把「基线里没有这个文件」误读成红。改用 **P2 的父提交 `b4cd399c4`**（= P1 验过的收口树）
另建 `/tmp/wt-base-fe`（前端）与 `/tmp/wt-base-dc`（datacore），两侧测试文件数已对账一致（各 323）。
两棵树各跑了金丝雀证明「能真跑测试」而不是「能 grep」：datacore 侧 RC=0；
前端侧 RC=1 但 **DOM 真挂载**（失败是用例自身在基线上就红：`debattery.order-chain` 断言文本缺失）⇒ 树是活的。

## 收编动作

merge（no-ff ab3e045a5 干净）→ 本体回写（51a13d002）→ 电池 → 本附记 → SSH push canonical（一次性 URL 不改 remote）。
