# WO-DIAG-100Q · 前 10 题真测结论（预览）

> ## ⚠️ 过期横幅（WO-R6 收编时加·2026-08-13）—— 先读这段再读下面任何一个数
>
> **本文件是一份历史快照，不是系统现状。**
>
> | 项 | 值 |
> |---|---|
> | 台账基线 | `claude/vigilant-knuth-b1nmxn` @ `e99f23c3`（2026-07-19） |
> | 收编时 canonical | `9ee260ab`（2026-08-13） |
> | 两者相距 | **1164 个提交**（实测 `git log --oneline e99f23c3..$CANON \| wc -l`） |
> | 台账点名的主要修路径 `apps/agentcore/src/router/ceo-route.ts` | 自基线以来**已动 9 个提交** |
>
> 也就是说：下面每一条「✗ 硬失败」「◑ 绿但错」「路由错配」**都可能早已被修**，
> 也可能还在——**本次收编没有重跑，因此一条都没有复验**。
> 照铁律 0.5：**「我一个月前测到它坏」不度量「它现在坏」**，两者是不同的命题。
>
> **怎么用这份文件**：
> - ✅ **可以**用它的**方法论**（28 题真 LLM 探针 · 五分判定 ✅/◐/◑/✗/⏱ · 卡点归类 + 精确修路径）；
> - ✅ **可以**用它作为「2026-07-19 那天确实做过一次真测」的**历史证据**（原始数据在
>   `scratchpad/diag100-results.json`，含 route/status/error/answer/provenance/耗时，可复核）；
> - ⛔ **不可以**拿它的任何一条结论当**今天的缺陷清单**去派单——要用，**先重跑一遍**
>   （`scratchpad/diag100.py`，注意它也停在基线那天的接口假设上，可能要先适配）。
>
> **收编范围说明**：原分支 6 个文件收了 5 个。`scratchpad/diag100.pid`（内容为单行 `95722`）
> **拒收** —— 那是 2026-07-19 那次后台进程的 PID，进程早已不存在，既非文档也非证据也非脚本，
> 且全仓无任何文件引用它（三份文档 + 脚本实测各 0 次命中）。



> 基线：`claude/vigilant-knuth-b1nmxn` @ e99f23c3 · LLM：Kimi 2.6 · 时间：2026-07-19
> 注：后台启动后已意外跑完 28 题，此处按你要求只呈现前 10 题结论；确认后再继续跑剩余 72 题。

## 前 10 题汇总

| 判定 | 题数 | 题号 |
|---|---|---|
| ✅ 真接地 | 4 | Q2、Q4、Q6、Q8 |
| ◑ 绿但错（路由错配） | 3 | Q5、Q7、Q9 |
| ✗ 硬失败 | 3 | Q1、Q3、Q10 |
| ◐ 绿但薄 | 0 | - |
| ⏱ 超时 | 0 | - |

**核心结论**：经营指标域（A 域）里，Agent 探索模式对 **gap_attribution / 根因类** 问句极不稳定——同样的 `seg_attain_ess` 相关意图，Q1 失败但 Q6/Q8 成功；`market_share` 反而意外通过。`metric_rollup` 被过度泛化用于任何带指标词的问句，导致 Q5/Q7/Q9 答非所问。

## 前 10 题详细台账

| 序号 | 问句 | 实际 route | 判定 | 卡点归类 | 精确修路径 |
|---|---|---|---|---|---|
| 1 | 储能业务线目标139.2万套、实际100.5、缺口38.7万套，根子在哪个基地哪个环节？先补哪最快？ | AGENT | ✗ | 缺 agent / 编排断链 | `ceo-route.ts:12-15,120-124` 仅 4 条粗正则，未覆盖 gap_attribution 细意图；path-B 探索模式无 timeout 兜底，直接"未能产出"。应把 `gap_attribution(metricKey)` 暴露为 agent tool，并在 ceo-route 加归因/下钻意图映射。 |
| 2 | 市场份额21.5%没到23%，被哪个竞品在哪个细分抢走？价格还是产能？ | AGENT | ✅ | - | 真接地：引用竞对A、储能细分、方形-LFP 价差 45 元/kWh 等真实体值，有 provenance。 |
| 3 | 现金58亿差目标60亿2亿，缺口主要卡在应收还是库存占用？ | AGENT | ✗ | 缺本体 / 缺 agent | 无 cash 的 RootCauseChain / CausalFactor 消费路径，outOfCatalog 落探索模式失败。需在 `battery.ts` 补 cash 归因链或在 `solvers/service.ts` 补 CausalFactor 兜底。 |
| 4 | 物料覆盖95.8%没满，哪几种物料拖的后腿？ | AGENT | ✅ | - | 真接地：列出铜箔/三元正极/石墨负极等物料缺口，与数据字典一致。 |
| 5 | 需求达成90.8%，是哪条业务线、哪个月拉低的？ | WORKFLOW(metric_rollup) | ◑ | 路由错配 | 时间序列下钻问句被 `metric_rollup` 泛化应答为"10 项指标 2 项越线"，未回答"哪个月"。应在 `ceo-route.ts` 将"哪个月/哪条线/时序"导向 `plan_rootcause` 或 `metric_drill`。 |
| 6 | 毛利率17%虽超标但储能线拖累多少？ | AGENT | ✅ | - | 真接地：量化储能线对整体毛利率拖累约 1.0–1.3pp。 |
| 7 | 乘用车达成99.5%差0.5%，是量还是价的缺口？ | WORKFLOW(metric_rollup) | ◑ | 路由错配 | 同 Q5：被 metric_rollup 泛化，未按"量/价"拆分。扩 ceo-route 细意图。 |
| 8 | 商用车超额到115.8%，是真需求还是压价冲量？ | AGENT | ✅ | - | 真接地：结合 PriceRealization、订单结构、客户信用等多证据排除压价冲量。 |
| 9 | 营收700亿刚好达标，但结构里哪块在透支未来？ | WORKFLOW(metric_rollup) | ◑ | 路由错配 | 结构/透支类问题被 metric_rollup 泛化；需 `decision_play` / `finance_pnl` 路径。 |
| 10 | 毛利总额118.9亿超目标112，超额来自哪个细分？ | AGENT | ✗ | 缺 agent | gross_profit 问句落探索模式未能产出；应暴露 `gap_attribution(metricKey=gross_profit)` 为 agent tool。 |

## Top-3 最该修（前 10 题视角）

1. **ceo-route 过度粗化**（`ceo-route.ts:12-15,120-124`）：所有带指标词的问句倾向 `metric_rollup`，导致 3/10 题绿但错。需把"哪个月/哪条线/量还是价/结构"等细意图拆出。
2. **Agent 探索模式兜底差**：3/10 题直接"未能产出回答"，无 timeout/solver tool fallback。应把核心求解器注册为 agent tools。
3. **cash/gross_profit 归因链缺失**：指标域未完整覆盖，导致 RootCauseChain / CausalFactor 消费断链。

## 下一步

- 确认后，我继续跑完 Q11–Q100（剩余 72 题）。
- 最终交付：`docs/DIAG-100Q-RESULTS.md` 完整台账 + `scratchpad/diag100-results.json` + push `claude/handoff-diag-100q`。
