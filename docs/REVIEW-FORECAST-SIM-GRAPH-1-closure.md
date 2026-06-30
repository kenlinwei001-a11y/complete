# 审核核发 · WO-FORECAST-SIM（门修后）+ WO-GRAPH-1 闭合

> 承 `REVIEW-WO-FORECAST-SIM-verdict-gate-blocker.md`：审核方发现 FORECAST-SIM 破 genuine-sim 门 → dev `1326b77` 修 → 审核方在 HEAD 重验。本文核发两单。

## 一句话

**✅ 两单均核发。** WO-FORECAST-SIM 的功能本就四证正确，唯一阻断（genuine-sim 门红）已由 `1326b77` 干净修复（demandGap 升为 RiskCardSchema 一等字段·直接读·去内联类型断言），HEAD 全门绿；WO-GRAPH-1（过程 DAG 共享组件）结构正确、4 组件共用 dagStyles 单一来源、frontend 293 绿无回归。

## WO-FORECAST-SIM · 闭合（门修后复验）

| 项 | 状态 | 证据 |
|---|---|---|
| 功能：紧张度真由需求-产能派生·非哈希 | ✅ | 读源 demandCapacityTightness(computeRollup 真产能÷DemandSegment/SopVersion 真需求) · V5d 测绿(改 p50→曲线变) · **对抗撤回**(neuter 真路径→V5d/V5 红→还原绿) · 真 invoke 物料齐套卡带 demandGap{gapWan:0.0897,source:"…需求−产能"} |
| 阻断修复 | ✅ | 审核发现 genuine-sim 门误命中新增 `const isMock = card.dataMode==="MOCK"` → dev `1326b77` 改 `card.demandGap`(契约一等字段)去内联断言 → **门误命中消除** |
| HEAD 全门绿 | ✅ | genuine-sim / no-silent-mock / css-vars 均绿；build 全绿；solvers.test 14 绿；frontend 293 绿 |

**评**：dev 的修法比审核建议的"改 isMock 判定"更优——把 demandGap 提为 contracts `RiskCardSchema` 一等字段、直接读，既解门误命中又消除脆类型断言。功能零损。

## WO-GRAPH-1 · 闭合（结构 + 回归）

| 项 | 状态 | 证据 |
|---|---|---|
| 抽统一过程 DAG 渲染骨架 | ✅ | `components/Dag/ProcessDag.tsx`(共享 SVG 骨架·renderNode 注入) + `dagStyles.ts`(EDGE_STYLE/GAP_COLOR/bezierPath 单一来源) |
| 4 处共用·语义数据不动 | ✅ | InferenceProcessDag/LayeredDag 渲染层下沉 ProcessDag；ProvenanceDag 越线红接 GAP_COLOR 单一来源(#DD7E9E 字节同·零视觉变)；dagStyles 4 组件消费 |
| 无回归 | ✅ | frontend **293 绿**(含 F18 项目推演 DAG/F58 FdeGraph 等 DAG 相关测试)；build 全绿 |

**诚实边界**：GRAPH-1 是**纯渲染层重构**（DOM 契约/语义/数据不动·commit 声称）——审核按**结构 + 测试回归**核发；**像素级视觉前后对比需真浏览器截图**（本环境未起前端做 pixel-diff·按 commit 声称"#DD7E9E 字节相同·零视觉变化"+ 293 测绿采信渲染一致）。若要 pixel-diff 实拍可另起真浏览器复验。

## 闭环留痕（这次发现→修复的价值）

- 审核方真跑撞出 FORECAST-SIM 破门（**dev 只跑 solvers.test V5d·没跑 pnpm gates**），dev 即推 `1326b77` 修——又一次"只跑子测试≠全门绿"被独立审核抓住并闭合。**门红不核发**纪律生效：先挡、修后才核发。
- genuine-sim 门**脆性**（正则误抓裸 `=== "MOCK"` 赋值）建议仍可加固（`REVIEW-WO-FORECAST-SIM-verdict-gate-blocker.md` 修法 B）——dev 选了改代码(A 类)解锁本单，门加固可作后续小债。

## 本体引用与影响

- **链路**：数据→推演链 `DemandSegment/SopVersion → risk_timeline`（dev 已回写 §3）——审核真跑坐实接线正确。
- **不变量**：R6（确定性·V5d 字节一致）/ R13（诚实位·demandGap 溯源+live 标）成立。
- **断点**：北极星"态势真源驱动"（FORECAST-SIM）一环**真落**——紧张度从哈希升为真需求-产能派生·可溯。
- **门禁 §7**：genuine-sim 修后绿；门脆性加固为可选后续。

---
*审核方独立核发（design+review·门修后 HEAD 重验·真跑+对抗+全门绿为据）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
