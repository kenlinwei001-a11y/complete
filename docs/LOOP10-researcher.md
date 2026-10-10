# LOOP10 · 研究者（向外看：这一行认为什么是必须的）

> **base commit** `3408572c`（`git merge-base HEAD origin/claude/inspiring-gates-aqczjg`）· **取证时刻** 2026-08-29 13:00–13:05 UTC · **`wc -l apps/datacore/src/synthetic/battery.ts` = 5357**（今天的树；非 06-15 那棵 1249 行的旧树）
>
> 真后端 `datacore:4351 / agentcore:4352 / vite:5351` · `SEED_DEMO=1` · **非** `VITE_MOCK` · 真浏览器登录 demo/admin。
> 树龄佐证：本树 `/a/v1/objects?type=Order&page=1&pageSize=500` 实测 **total=500**（与其余四人一致）；另 `type=Customer` **total=20** —— 「20」这个数在本树上是**客户数**，不是订单数，两者别混。

**核心立场**：这一行按 **EBIT / 服务 / 现金周期** 三个 Δ 给高管排方案[^1][^4]；本仓三块决策屏零金额零日期，**排不出敞口** —— 缺的不是功能，是计价单位。

| 高敞口场景 | 频次[^2] | 这一行的排序口径[^1][^3] | 本仓屏上 |
|---|---|---|---|
| 产能 / 外包 / 加班补缺口 | 月 | EBIT Δ | 缺 |
| 提前建库存 pre-build | 月 | 现金 DIO Δ | 缺 |
| 限量分配保供 | 周 | 缺货营收 + 服务 Δ | 缺 |
| 订单承诺取舍 | 日 / 周 | 订单毛利 | **有**（接单组合优选） |
| 呆滞减值清库 | 月 / 季 | 减值额 | 缺 |

**金丝雀**：同一正则在「接单组合优选」命中 钱 16 · 历 70，在统一推演控制台 / 决策推演 / 月度规划均 **0 / 0** ⇒ 工具是好的。另：「演习结论」**页签置灰**（title：版面还没接）；月度规划五步状态机在，版本列表**暂无数据**。

**只有我会说的一条**：**按敞口排不上号、我们却做了的，是那 42 条无量纲压力传导边。** 它占两块决策屏下半屏，真算得动（对照实验：幅度→80，`shortageRisk` Δ+336→+560、`supplyRisk` Δ+280→+350，单调）；但产出 `supplyRisk 2897.89 Δ+210`，无一 COO 场景以此计价[^5]。最贵的屏占给了排不上号的装置，排第一的钱没有。

---

### 脚注（外部一手来源 · 检索日 2026-08-29 · 不计字数）

[^1]: 高管档按 EBIT / 服务 / 现金周期三 Δ 排 3–5 个应对包；执行档只看一页记分卡 + 2–3 个已框定权衡 + 带责任人与期限的决策台账。
 <https://umbrex.com/resources/strategic-cost-cutting-playbook/sales-operations-planning-sop-soe-discipline/> ·
 <https://umbrex.com/resources/inventory-management-playbook/demand-review-supply-review-and-executive-sop-meetings/>
[^2]: 月度档（产品→需求→供应→财务→高管决策会，逐周落位，各有责任人 / 输入 / 输出）与周度执行档（0–13 周、SKU 级：给谁分货、要不要加急）是两条不同节奏。
 <https://demandforecast.ai/blog/the-sop-process/> · <https://www.onepint.ai/insights/what-is-sales-operations-execution-soe-a-complete-guide> · <https://www.leafio.ai/blog/sales-operations-execution-soe-vs-sop/>
[^3]: 敞口排序的成熟做法：ABC / XYZ（价值 × 波动）与风险矩阵（可能性 × 影响 / 财务敞口）；高管时间按例外管理分配，只有超过金额门槛的条目上会。
 <https://remira.com/en/glossary/abc-xyz-analysis> · <https://www.zycus.com/glossary/what-is-supply-chain-risk-matrix>
[^4]: 滚动 24–36 个月视界，月度五步评审。<https://www.oliverwight-americas.com/whitepapers/the-management-business-review-deploying-strategy-with-integrated-business-planning/>
[^5]: 这一行自己的复盘：失败不在情景不够多，而在**模型没接到决策是怎么做的**；仅 15% 的计划组织自认 S&OP 落地成功，70% 仍以表格为主。
 <https://www.cio.com/article/4069640/why-static-scenario-planning-fails-in-a-dynamic-world.html> · <https://koerber-stellium.com/sap-ibp-sop-planning/>

### 证据文件（`docs/assets/loop10-researcher/`）
`sim-unified.png` 8 页签 · 3 灰 ｜ `sop-balance-empty.png` 五步状态机 · 暂无数据 ｜ `decision-play.png` 六维比对矩阵 · 代价 248/90/173 无单位
