# AUDIT · 存量测试断言形态回溯（WO-TEST-RETROFIT 第一阶段）

日期：2026-09-12 · 基线：`claude/inspiring-gates-aqczjg` = `c69d345d4` · 分支：`claude/handoff-test-retrofit`
性质：**只读审计**。本阶段未改任何测试/产品源码（判据 3 的反证为临时变异，已还原，`git status` 干净）。

---

## 0 · 派单背景数复核（纪律 D：坐标是线索不是结论）

| 派单数 | 实测复核 | 结论 |
|---|---|---|
| 测试文件 881 | **897**（`.test.ts` 593 + `.test.tsx` 304，`.spec.*` 0；`find apps packages -name "*.test.*"` 排除 node_modules/dist） | 顶回：树在动，差 16 个 |
| 「两次调用做对比」67 (7.6%) | 严口径 **177** / 宽口径 **356**（口径见 §2-R） | 不可复现，以本文口径为准 |
| 「只断言有东西/形状对」514 (58%) | 六种合理口径实测：2 / 60 / 120 / 264 / 284 / **717**（见 §2-S） | 不可复现，以显式口径 717 (79.9%) 为准 |

**量法金丝雀**（纪律 G：否定结论必附金丝雀）：
- 匹配器抽取器的阳性对照：窄口径（仅 `toBeDefined/toBeTruthy/toHaveLength` 三种匹配器的文件）命中 2 个文件 ⇒ 抽取器工作正常，「514 复现不出」不是量法坏了。
- 已知 R 形态样例（`order-line.test.ts:140` 两次调用字节对拍、`interbase-transfer.test.ts:127/145` 前后态相比、`revenue-reconcile.seam.test.ts:219` 扰动前后相比、`decision-causal-graph.test.ts:181` 大小图倍数、`turn-loop.seam.test.ts:136` 两轨迹相异）⇒ R 启发式**全中**。

## 1 · 五类定义与判据（本单执行版）

| 形态 | 执行判据 | 风险 |
|---|---|---|
| **R · 关系断言** | 严口径：同一函数作用于两组输入的对拍（`expect(F(a)).toBe(F(b))`，a≠b）∪ 前后态变化断言（`.not.toBe(变量.属性)`）。宽口径：任何比较断言的两个操作数落在两个不同根变量上 | 低 |
| **S · 单点断言** | 文件全部断言匹配器 ∈ {存在性/形状} ∪ {具体值}；`toBeGreaterThan` 等区间匹配器仅当参数全是字面量才算单点 | 对「算错了」无能为力 |
| **M · 复刻公式** | 断言里重算实现公式。两个子型：**M-a 自指输入**（重算的输入取自 SUT 回包本身 ⇒ 实现把数算错、公式保持一致时断言照样绿）；**M-b 公式复刻**（实现的系数/公式手抄进断言 ⇒ bug 被写进断言，公式错时被守护） | 最危险 |
| **F · 夹具量级不足** | 夹具规模比生产（订单簿 500 张，WO-ORDER-BOOK-500）小 ≥1 个数量级，且测的是规模相关性质（topN/截断/排序/半径/敞口/阈值判定） | 规模缺陷不可见 |
| **P · 实参不相交** | 布尔/枚举开关：测试传的值 ∩ 生产传的值 = ∅。子型 P0：生产零传参（恒走缺省）；P1：值不相交 | 验的是生产已放弃的路 |

一个文件可同属多类。

## 2 · 全扫分布（897 个文件）

| 形态 | 计数 | 启发式（可复核） |
|---|---|---|
| R · 严口径 | **177** (19.7%) | 正则：`expect(F(a…)).toBe(F(b…))` a≠b；`.not.toBe/toEqual(标识符.属性)` |
| R · 宽口径 | 356 (39.7%) | 另加：比较断言两操作数根变量不同（`expect(a.x).toBeLessThan(b.y)`，a≠b） |
| S · 单点（执行口径） | **717** (79.9%) | 匹配器集合 ⊆ 白名单；RANGE 匹配器参数全字面量 |
| S · 其他口径（三角定位 514） | 仅存在性三种匹配器=2；纯存在性/形状=60；存在性出现占比≥80%=120；≥50%=264；含存在性且无 RANGE=284 | 均≠514 |
| M · 候选→确认 | 候选 67 → **确认 15 文件 / 17 处**（§3） | 候选：`expected/want` 变量赋算术式 + `toBe(expected)`；`toBe(含算术表达式)`；`severity…重算`字样；再逐条精读 |
| F · 候选 | 循环型候选 69（其中 38 用真种子 `seedBattery` 驳回 → 31 手写夹具池）+ 字面量数组盲区补扫 21 hits | 小 N 循环（`i<N`、`Array.from({length:N})`、`slice(0,N)`、`repeat(N)`，N≤12）+ 规模词；字面量元组数组 3–12 元素 + 不用真种子 |
| P · 候选→确认 | 357 开关键 → 54 候选 → **确认 3**（全 P0；P1 = 0） | 生产 src 类型定义抽 `key?: boolean` / 字符串枚举键 → 全域比对测试写位与生产写位的字面值 |

**M 启发式金丝雀**：派单点名的两处 severity 断言（`a6-cross-segment-contention.seam.test.ts:132`、`chain-scan-honesty.test.ts:231`）均在 67 候选内 ✓；且额外捕获派单未点名的第三处 severity M（`chain-impediment.seam.test.tsx:577`）⇒ 量法有效。
**P 启发式金丝雀**：派单点名的 `lineGranularity` 在 54 候选中 ✓。

## 3 · M 类逐条点名（15 文件 / 17 处）—— 本单全部价值（其一）

| # | 文件：行 | 子型 | 为什么 |
|---|---|---|---|
| M-1 | `apps/datacore/test/a6-cross-segment-contention.seam.test.ts:132-134` | M-a | `expected = clamp(round((metricValue−threshold)/\|threshold\|×100))`，metricValue/threshold 取自回包 ⇒ severity 单因子公式被断言守护；实现把 metricValue 算错时两侧一致地错、照样绿 |
| M-2 | `apps/datacore/test/chain-scan-honesty.test.ts:231-257`（SCAN-3） | M-a | 抽 5 条回包阻滞点，用回包的 metricValue/threshold 重算 severity 对拍；阈值为 0 的样本被「诚实排除」⇒ 那一支连自指校验都没有 |
| M-3 | `apps/frontend-shell/test/chain-impediment.seam.test.tsx:577-589` | M-a+b | 同样的 severity 公式复算（输入来自 fixture/mock 回包），且 :588 用 `factHits(checkedTree("apps/datacore/src"…))` **grep 引擎源码锁公式文本**——公式即断言，教科书级「bug 编码进断言」 |
| M-4 | `apps/frontend-shell/test/metro-semantics.seam.test.tsx:178-181` | M-a | `s.col === s.index % perRow`，`s.index` 与 `perRow` 都来自 `buildChainLineMap` 回包 ⇒ perRow 算错时全绿 |
| M-5 | `apps/datacore/test/capacity-demanddelta.test.ts:38,44` | M-a | `effective = round(baseline×(1+Δ))`，baseline 取自回包 ⇒ 基线需求算错时自洽通过。**判据 3 反证载体，见 §5** |
| M-6 | `apps/datacore/test/capacity-threshold.test.ts:37,47` | M-a | `thresholdQty = P90 − baseline` 的两个输入都取自回包；注释自承「口径纠正命门」⇒ 命门由实现自己把守 |
| M-7 | `apps/datacore/test/solvers.test.ts:129-134` | M-b | weeklyCap 全链镜像（线体串行 min、良率缩放 yf、化成/老化封顶、`daily×7/packCellCount/10000`），注释自承「WO-SCALE-COHERENCE **镜像**」 |
| M-8 | `apps/datacore/test/solvers.test.ts:443-455` | M-b | 五维评分公式系数逐一手抄（`50+(gm−floor)×22`、`40+share×3`、`50+(cash−floor)×4`、`30+(rev−base)×2.5`、`90−capex×2.2`、`−15×hardViol`）；改业务权重 = 先改测试 ⇒ 公式被冻结 |
| M-9 | `apps/datacore/test/sim-certification.test.ts:52-55,111,119` | M-b | 认证维度/综合权重 `0.4/0.3/0.3` 与 `round(100×6/7)` 复刻进断言 |
| M-10 | `apps/datacore/test/m11-calibration.test.ts:218` | M-b | 「单次变幅 clip −10%」的 `×0.9` 手抄进断言 |
| M-11 | `apps/datacore/test/seed-demo-propagation.test.ts:211` | M-a+b | `0.8×(numerator/denominator)×10`：分子分母取自回包 explain、系数手抄；注释自承「各自独立地算一遍**同一个式子**」 |
| M-12 | `apps/datacore/test/seed-demo-propagation.test.ts:634` | M-a+b | `COEFF×weight×SHOCK`，weight 取自回包 explain |
| M-13 | `apps/datacore/test/gsim-integrate.test.ts:55` | M-b | `expectedTransit = max(1, ceil(baseDistanceKm(...)/600))`：oracle 就是实现的 `baseDistanceKm`（有 hefei<changzhou 金丝雀探针缓解，但 600 km/日这个公式常数被锁死） |
| M-14 | `apps/frontend-shell/test/global-sim-seam-realsolver.test.tsx:122-123` | M-b | 同 M-13 形态（前端接缝侧，同样 import 实现的 `baseDistanceKm`） |
| M-15 | `apps/datacore/test/sandbox-e4-cadence-propagation.seam.test.ts:195,251-252` | M-b | 闸门等待期望 `(E−1)/2` 内联手抄（差值用契约函数 `expectedCadenceWaitDays` 是对的做法，绝对值钉子把同一公式又抄了一遍） |
| M-16 | `apps/datacore/test/planviews.test.ts:172,183` | M-a+b | :172 `dem = decomp.value×1.02`（rollingCorr 系数手抄 + 跨端点自指）；:183 `actual = planned×(1+deviationPct/100)` 三个字段同包自指 |
| M-17 | `apps/agentcore/test/context-threshold-reachability.test.ts:82` | M-lite | `TOOL_RESULT_CONTEXT_LIMIT === 8*1024`：常量钉值，等价于断言常量等于它自己 |

**精读后驳回的代表性候选**（展示候选≠定罪）：`sandbox-detail-pixel`（SPEC 来自 `docs/ux-spec` 独立设计稿，是合格外部 oracle）；`revenue-reconcile`（§1 有独立预言机对拍生产口径函数，:144 专门防「生产口径与独立预言机分叉」）；`engine-scope-fidelity`（m 来自仓储独立读路径，能耗×因子是业务定义）；`node-semantics`（RAW 是签入的 live-evidence 夹具 JSON）；`befe-b-ops-scheduler-calendars`（断言的是「屏上数=后端数」同一性，不是公式）；`three-zone:688`（屏上恒等式自检）；`interbase-transfer` / `turn-loop` / `decision-causal-graph:181`（是 R，金标准形态）。

## 4 · P 类逐条点名（3 条，全 P0）—— 本单全部价值（其二）

| # | 开关 | 测试写位 | 生产实况 | 为什么危险 |
|---|---|---|---|---|
| P-1 | `lineGranularity`（`apps/datacore/src/solvers/portfolio.ts:55` 声明） | `apps/datacore/test/gsim-solver.test.ts:81` 传 `true`（全域唯一测试写位） | 生产唯一写位是 `service.ts:3512` 的 API 透传 `asBool(args.lineGranularity)`；`apps/frontend-shell/src` 与 `apps/agentcore/src` **全域零发送** ⇒ 生产恒为缺省 false | 派单点名样本，复核确认：拆线粒度（每 Line 一产能单元、`baseId#lineId`、lineModelCompat 过滤）整支只有测试在走，生产走的是 base 级旧口径。测试一直绿 ≠ 生产这条路活着 |
| P-2 | `allowSplit`（`portfolio.ts:67`） | `gsim-solver.test.ts:139` 传 `true` | 同上：`service.ts:3517` 透传，前端零发送。注意 `splitOrderIds`（per-order 分流）在 `GlobalSimView.tsx:273` 有真控件 ⇒ 分批代码本体在生产活着，**死的是「全局 allowSplit=true」这一支**（`portfolio.ts:366/374` 的 `input.allowSplit === true` 条件） | 全局分流分支生产零触发 |
| P-3 | `requireFullCoverage`（`apps/datacore/src/modeling.ts:347`、读位 :382） | `apps/datacore/test/modeling.test.ts:363` 传 `true` | `app.ts:7123` 从请求体读、缺省关（注释：「默认关，保持向后兼容」）；生产前端**没有任何发送面**——唯一认识它的是 MSW mock（`apps/frontend-shell/src/mocks/handlers.ts:5585`） | R12「字段全建模门」在生产永不触发；阻断逻辑只有测试验过 |

**P1（值不相交）= 0**。初扫 14 个 P1 候选全是**键名撞车**（同名不同义），精读全部驳回：`confirm:"确认"`/`open:"看实例"`/`violated:"—"`/`stillIn:"仍卡着"`/`recommended:"在推荐组合内"` 等是文案字段，`v`/`template`/`failed` 是不同域的同名字段。

**精读后驳回的代表性 P0 假阳性**：
- `enableCompaction`：生产构造（`providers.ts:67/95`）不传 ⇒ 走构造缺省 `?? true`（`anthropic.ts:83`）——生产恰是 true，与测试交集非空。**缺省值不看清楚就会把阴阳判反**。
- `withAdoptions` / `scanOnly` / `detached`：生产传的是非字面量 RHS（`ADOPTION_AWARE_SOLVERS.has(k)`、`events.length===0`、`opts.async`），字面值扫描漏报 ⇒ 交集其实非空。
- org 代理分支（`org/service.ts:79` 注释自承「生产里一次都不会进」）：该单已补触发源 `setAvailability`，且 `OrgWorldPage.tsx:82/138` 有真「在岗/不在岗」开关 ⇒ 已愈合，驳回。
- `fkFallback`：测试传 false 是**对照组**（证明兜底真生效），同文件另一支走生产缺省 ⇒ 不是「验已放弃的路」，驳回。
- 响应字段类（`offTarget`/`slotsFillable`/`candidatesTruncated`/`moqApplied`/`inactive` 等）：实现按数据算出，测试构造夹具是正常夹具工作，全部驳回。

## 5 · 判据 3 反证：M-5（capacity-demanddelta）把实现改坏，断言仍然绿

载体：M-5（M-a 自指）。变异点：`apps/datacore/src/solvers/capacity.ts:531`（已还原，工作区干净）。

| 运行 | 变异 | RC | 结果 |
|---|---|---|---|
| 基线 | 无 | **0** | 4/4 通过 |
| 值变异 | `baselineDemand = computeBaselineDemand(...) × 3`（基线需求三倍虚报——「还能再接多少单」全错的生产事故级 bug） | **0** | **4/4 仍然全绿** ⇒ 断言从回包取 baseline 重算，实现把数算错、公式保持一致 ⇒ 自洽通过，全盲 |
| 公式变异（对照） | `effectiveDemand = …×(1+2×demandDelta)`（只动公式） | **1** | 2 failed ⇒ 断言不是空转，它是公式锁：只咬公式漂移，不咬数值污染 |

三个 RC 完备证明 M-5 是教科书 M 类：**它守护的是公式本身（那个 bug），对「输入被一致地算错」天然失明**。日志：`/tmp/test-retrofit/{baseline,mutant,mutant2}.log`（执行机本地）。

并发纪律：运行前 `vitest run` 进程 = 1（另一 agent 的 agentcore 单文件跑），本跑期间 = 2，结束后回到 1；本跑全程 `--no-file-parallelism`。

## 6 · F 类分布与确认清单

- 循环型启发式候选 69 → 38 个用 `seedBattery`/`generateBattery`（与生产同生成器同规模，驳回）→ 31 个手写小夹具池。抽样精读 3 个：1 确认（`dril-retrieval`）、2 驳回（`coord-yield-terminal-seam` 的 `i<3` 是重试循环、`contracts/chain-sim` 是参数网格单测）⇒ 池精度有限，**31 个全池留作第二阶段精读对象**。
- 启发式盲区（字面量数组夹具）补扫 21 hits，精读确认：

| # | 文件 | 夹具 | 生产规模 | 不可见的缺陷类 |
|---|---|---|---|---|
| F-1 | `apps/datacore/test/concentration-risk.test.ts:39` | 6 单 / 6 客 / 3 物料 | 订单簿 500 张 | 「敞口多少才算隐性单点」的量级判定在 6 节点上不存在；topN/截断不可见 |
| F-2 | `apps/datacore/test/supplier-disruption-radius.test.ts:35` | 6 单 / 6 客 | 500 张 | 波及集合的截断/排序/分页不可见 |
| F-3 | `apps/datacore/test/generic-solvers-http-e2e.test.ts:27` | 3 单 | 500 张 | HTTP 全链在真实订单簿规模下的形状未验 |
| F-4 | `apps/datacore/test/opt-pareto-assemble.seam.test.ts` | 6 单 / 5 客 | 500 张 | pareto 前沿规模/截断不可见 |
| F-5 | `apps/datacore/test/margin-axis-honesty.seam.test.ts` | 6 单 / 5 客 | 500 张 | 同上形态（同族夹具） |
| F-6 | `apps/agentcore/test/dril-retrieval.test.ts:19` | 手工镜像的「代表性」求解器目录 | 真实 SOLVER_CATALOG 全量 | 「top-3 ≥90%」的排序性质在目录膨胀后未验 |

## 7 · 总结账

| 形态 | 计数 | 备注 |
|---|---|---|
| R（严）/ R（宽） | 177 / 356 | 金标准形态存在且不少，但占比 minority |
| S | 717 (79.9%) | 多数文件没有任何跨值比较 |
| M | **15 文件 / 17 处**（§3 逐条） | 含派单点名的 2 处 + 新发现的第 3 处 severity（M-3） |
| P | **3 条全 P0**（§4 逐条） | P1 = 0；54 候选精读驳回 51 |
| F | 确认 6 + 待精读池 31+16 | §6 |

第二阶段建议（不在本单）：M 类按 §3 清单把「自指重算」改为「独立输入 + 关系断言」（M-5/M-6 的修法是给 baseline/capWanP90 各找一个独立真相源，断言两边相等）；P 类按 §4 决定「接线或删除」（P-1/P-2 要么前端补开关，要么删分支与测试）；F 类先精读 31+16 池再定改造面。
