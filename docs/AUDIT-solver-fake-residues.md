# 审计 · 求解器层假推演/假数据残口（真可信·不打折·2026-07-10）

> 审核方只读审计（真起服务前的静态确证·部分需真跑定级）。触发：用户"不接受打折·你需要解决它"。产能推演 util:line 假推演不是孤例——本审计挖出**同类病的其余实例 + 门的系统盲区**。已排除已知 risk_timeline/util:line（WO-CAP-01 在修）。
> **核心结论**：WO-CAP-01 只修 util:line、**显式排除了 OEE/良率**（同病）→ 假推演只解 1/3；且**三道门都不守"dataMode 值诚实"**，是残口长期藏身的根。

## 确诊残口（分级·file:line）
| # | 残口 | file:line | 病 | 证据 | 级 |
|---|---|---|---|---|---|
| R1 | risk_timeline **设备OEE** 因子 | `risk.ts:172-177` + 种子 `battery.ts:1264`(oee:equip mean0.78) + 系数 `:143`(oeeK220/oeeBase30) | 合成扁平冒充真·标 LIVE | 种子单一全局 mean·全基地全设备同·与订单/需求零耦合·张力=clamp(30+(1-0.78)×220)≈78 恒定·改输入不变·live:true→卡 LIVE | **P1** |
| R2 | risk_timeline **良率波动** 因子 | `risk.ts:186-191` + 种子 `battery.ts:1265`(yield:process mean0.952) + 系数 `:143`(yieldK600/yieldBase35) | 同 R1 | mean0.952 扁平·张力≈64 恒定·标 LIVE·yieldK600 大放大魔数 | **P1** |
| R3 | plan_rootcause 季/年下钻 | `service.ts:861-871` | 绕过真模型·魔数投影·诚实位未下沉 | `PERIODIC={month:1,quarter:0.97,year:1.04}`·季/年 actual=月值×魔数编造(非读真 per-level Metric·而 metric_rollup:1057 是读真的)·驱动 offTarget RED/AMBER/GREEN·默认 LIVE 无披露 | **P1** |
| R4 | risk_timeline 处置责任人 | `risk.ts:553-556`(riskHashN) + `:588` | hash 伪造 + 门盲区 | 责任人=RISK_OWNER_NAMES[hash(基地名)]·伪造"谁负责"·riskHashN 本地 hash 逃过 no-fake-data 门(只 grep hashString() | **P2** |
| R5 | order_fullchain 交期 P90 | `service.ts:1177` | 固定 haircut 伪分位 | p90=producibleWeekly×0.9 固定·未走种子化 MC(capacity_forecast 已走)·驱动 deliveryOk·缓释:p50 真+标建模假设+dataMode PARTIAL | P2 |

## 门系统盲区（根·堵这里才防未来假推演）
1. `check-no-fake-data.mjs` **只 grep `hashString(`** → 漏：①本地 hash(riskHashN)②魔数系数(util×0.9+8·oeeBase+(1-avg)×220·PERIODIC)③固定 haircut(×0.9)④扁平种子标 LIVE。**这四类正是本次全部残口的形态**——门只守最窄一种信号。
2. `genuine-sim.mjs §⑧` **只真跑 risk_timeline 且只测无真源因子**(物流时长/换型损失→断言空态)·**从不真跑 OEE/良率**(它俩有"数据"——扁平的——故 live:true 通过)·从不断言"改业务输入→LIVE 值应变"→**扁平种子标 LIVE 完美绕过语义门**。
3. `no-fake-done.mjs` 只校验 solver key 存在性·不看输出值真假。
4. **共同盲区：dataMode 的"值是否诚实"无门可守**——solver 可恒报 LIVE 而读扁平合成·门只查"字段在不在/前端读没读"。

## 明确排除（真·非假）
capacity_forecast(真种子化 MC 分位·p50×0.93 已根治) · cockpit_kpi/metric_rollup/mrp_netting/finance_pnl/causal_attribution(净室读真对象图) · extended 全族(诚实位已下沉·yield_diagnosis 标 source:SYNTHETIC) · agentcore MOCK_SOLVER_OUTPUTS(逐条标 MOCK) · risk.ts 历史假值(commit 9a6c283 已删·mockTightness 现死代码) · capex_scenario/plan.ts(可覆写假设/无魔数)。

## fix-WO（待安全时机入队·⚠加 `at` 用对象非字符串·避免复发 claim 崩）
- **WO-FAKE-01（P1·补 WO-CAP-01 的洞）**：risk_timeline OEE/良率逐基地分化——`battery.ts:1264-1265` oee:equip/yield:process 加确定性 per-base 乘子(同 util:line·守 R6)+同步放开 `solvers.test.ts:211-314` 对扁平均值钉死；**或**无逐基地分化时 `dataMode=PARTIAL`(诚实标"演示均值·非逐基地实测")。验收:真跑 OEE/良率因子随基地/输入变 或 诚实标 PARTIAL 不冒充 LIVE。
- **WO-FAKE-02（P1）**：plan_rootcause 季/年读真 per-level Metric(对齐 metric_rollup service.ts:1057)或投影档 `dataMode=PARTIAL`+标"月值粒度投影·非实测季/年"(`service.ts:861-871`)。
- **WO-FAKE-03（P2）**：`risk.ts:588` 责任人去 hash——读真责任对象或显"未指派"。
- **WO-FAKE-04（P2）**：`service.ts:1177` order_fullchain P90 收口到 mcP90Single(去 ×0.9)。
- **WO-FAKE-05（P1·堵根·最重要）**：门加固——①`check-no-fake-data.mjs` 扩 SMELL 信号(本地 hash/魔数系数/固定 haircut/扁平种子)②`genuine-sim §⑧` 加**行为断言**"扰动业务输入(改订单/需求/SOP)→LIVE 值须变·否则应标 PARTIAL"·覆盖 OEE/良率③新门守"dataMode 值诚实"(声称 LIVE 的因子其输入不得为扁平常数)。**此单落地=所有同类假推演被门自动逮·防复发**。

## 诚实边界
R1/R2 的**求解器逻辑本身读的是对的属性**(Equipment.oee_current/Process.yield_baseline)·根病在**种子扁平 + 诚实位未按扁平度下沉**·非纯逻辑捏造。P1/P2 定级建议真起 SEED_DEMO 逐基地 curl `risk_timeline{factor:设备OEE/良率波动}` 核实当前是否有基地实出 LIVE 红卡后终定。其余静态确证。
