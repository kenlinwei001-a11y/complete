# 沙盘验收 A5 · 亲手在真数据上跑全链扫描（审核方，2026-08-08 UTC 11:08–11:14）

## 怎么跑的
起 `apps/datacore/dist/server.js`（port 4401 · `SEED_DEMO=1` · 内存模式），
`POST /a/v1/solvers/chain_impediments/invoke`，body `{}`，`X-Debug-User: demo:admin:admin`。
连跑两次做确定性对拍。原始回包 7782 B。

## 产出
15 个阻滞点：**BREAK 7 · CONGESTION 6 · BOTTLENECK 2**。`ruleSetVersion=rsv_f8216478`。

## A3 确定性 —— ✅ 通过（实测，非推断）
两跑去 `scanId`/`impedimentId` 后 sha256 前 16 位一致：`0cdaaf6216563bc5` = `0cdaaf6216563bc5`。
且 `scanId` 本身两次**相同**（`scan_b49a86cf`）⇒ 它由内容派生，不含时间/随机源。

## A5 人工核对 ≥3 条是真问题 —— ✅ 通过
| # | 阻滞点 | 判据 | 我的判断 |
|---|---|---|---|
| 1 | `Line/LINE-WS-jinhua-slitting`「金华分切线」 | 规则 **C05**，利用率 **95.89% > 红线 95%** | **真问题**（95.9% 无缓冲）。但 `dataMode:PARTIAL`，caveat 明说未校验持续天数 ⇒ 可能是瞬时尖峰。**标注诚实，既非误报也非虚报。** |
| 2 | `MaterialBalance/mbal-6`「铜箔」 | 规则 **C06**，缺口 **398 吨 > 0** | **真问题**（物料平衡为负即断料风险） |
| 3 | `MaterialBatch/elyte_b2`（电解液批次） | 规则 **C28**，停滞 **121 天 > 90 天** | **真问题**（批次呆滞，占用与失效风险） |
三条都能追到 `ruleKey` + `metricValue` vs `threshold` + 单位，不是编的。

## 诚实度（超出我的预期）
- `caveats[]`：「规则 C05 含 SUSTAIN（持续判定），而 SolverContext 无时序访问 —— 本次只比对快照与红线 95%，**未校验持续天数**；结论 dataMode 标 PARTIAL」
- `unresolved[]` 用本仓三分法定性：「`Order.changeoverMin` 在 Order 上无对象承载（扫了 24 个对象，无一含）—— 属**"接了线没数据"**，不是"没接线"」；
  另一条：「断点·时间在规则库 C01–C33 中无任何承载阈值的规则（逐条核过）；**本引擎拒绝自造提前期阈值** —— 需先在规则库定义（R16 生长信号）」
- 逐条 `dataMode`：PARTIAL / SYNTHETIC，不混为一谈。

## ❌ 两条不成立（都是**判据/口径**问题，不是实现问题）

**A1 是空转判据。** PRD §9 A1 写「扫描产出的每个阻滞点，`evidence.solverKey` 指向的求解器**真被调用过**」。
实测：15 条的 `evidence.solverKey` **全部等于 `chain_impediments` 自己**。指向自己 ⇒ **该断言永远为真、无法失败**。
真相是这个扫描器直接读对象属性 + 比规则阈值，**上游没有别的求解器**。
⇒ 该改的是判据措辞（应验「声称的取数来源真存在」），不是去给它硬塞一个上游 solver。
**若照 A1 原文建门，会建出一道恒绿的哑门** —— 本仓 `boundary-singlesource`（欠账 #76）就是这么来的。

**A2「零写死」按字面不成立。** `thresholds[]` 5 条里 **3 条 `source:"literal"`**：C05=95%、C28=90 天、C06=0 吨。
但它们**主动声明了自己是 literal**（另有 C02 `source:"field"` 带 `fieldPath: Process.requiredThroughput`、C09 `source:"param"`）。
「声明了的字面量」与「藏在源码里的字面量」是两种东西：前者可审计，后者不可。
⇒ A2 的门应断言「**无未声明字面量** + literal 条数棘轮只降不升 + ruleKey/fieldPath 在规则库/本体里真存在」，
而不是「源码里不许有数字」。已把这条实测发给建 A2 门的 dev。
