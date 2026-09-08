# LOOP11 · 实施者 · FDE · 阶段① 第 1 轮（共 2 次发言之第 1 次）

**base commit**：`ec1e707c`
**取证时刻**：2026-09-07T03:44:30Z（UTC）
**树龄探针**：`wc -l apps/datacore/src/synthetic/battery.ts` = **6618**
**取证环境**：真后端 `SEED_DEMO=1` 内存模式，`PORT=4441`，全程 curl，**禁 VITE_MOCK**

---

## 发言正文

**论点：数据进不来是死结，其余两条都是它的下游。**

**① 首次落地客户要交 17 类目 / 97 张表 / 843 列**（实测 `/a/v1/data-categories` 逐类目取 template 累加；金丝雀「销售订单」36 列 > 0）。而 `sap_erp` / `salesforce_crm` / `generic_jdbc` **三个连接器全无适配器**：建连后取 schema 返 `connector type 'sap_erp' is registered but has no adapter implementation yet`、sync 直接 `FAILED`（金丝雀：`mock_erp` 同两步返真 schema）；更难看的是「测试连接」对主机 `nonexistent.invalid` 仍返 `{"ok":true}`（金丝雀：缺必填才 `ok:false`）——**客户 IT 在验收会上第一个点的就是它**。⇒ 4 个默认「系统对接」的类目（客户与应收 / 产能与基地 / 物料与库存 / 财务与碳）现场只剩 CSV。

**② 对照实验（演示品判据）**：换掉客户的订单簿（今 500 单 / 2,436,095 套），驾驶舱头号数**「AOP 基准营收 601.5 亿」一位不动** —— 它读的是 `AnnualScenario(baseline).revenue` **一格**；同屏 `Metric.kpi-revenue.actual` = **700 亿**，两数差 **98.5 亿 / 16%**。客户第一天就看得见。

**③ 长期那一半交不出**：65 条流程定义只有 `stdDurationDays`、**零 runtime**；`process.runtime` `defaultOn:false` ⇒ `/a/v1/process-instances/stuck` 返 `FEATURE_NOT_FOUND`（金丝雀：同头 `?type=Order` 返 500 单）。51 项导航里只有模板层「流程等待态」，没有实例层「流程卡点」。`AdoptedMitigation` 已接线但 **0 条**。⇒ 今天只交得出**一次推演读数**，交不出**「该改哪条流程」**。

**该扔（挂不到有金额场景）**：商务情报 5 表 26 列（竞品份额 3 条 / 投标 / 赢丢单）——客户给不出，也挂不到订单敞口。金丝雀：订单类量追得到 601.5 亿营收，追法是好的。

---

## 取证附录（不计入 200 字，仅供主持方复核，不进阶段②）

| 判据 | 命令 | 实测 |
|---|---|---|
| 类目/表/列 | `GET /a/v1/data-categories` + `/{key}/template` ×17 | 17 / 97 / 843 |
| 测试连接假绿 | `POST /a/v1/connections/test` `{sap_erp, host:nonexistent.invalid,…}` | `{"ok":true}` |
| 金丝雀（同端点） | 同上但缺 `client/username/password` | `{"ok":false,"message":"缺少必填配置：client、username、password"}` |
| 适配器缺失 | `GET /a/v1/connections/{id}/schema`（sap_erp） | `VALIDATION_ERROR … no adapter implementation yet` |
| 金丝雀（同端点） | 同上换 `mock_erp` | 返 `production_orders` 真 schema（含 5 个样例值） |
| sync | `POST /a/v1/connections/{id}/sync`（sap_erp） | `status: FAILED` |
| 驾驶舱营收 | `POST /a/v1/solvers/cockpit_kpi/invoke` | `aopBaseRev: 601.5`（源 `solvers/service.ts` `cockpitKpi`：`AnnualScenario(key="baseline").props.revenue`） |
| 同屏第二个营收 | `GET /a/v1/objects?type=Metric` | `kpi-revenue.actual = 700`（单位「亿」） |
| 订单簿规模 | `POST /a/v1/objects/aggregate` `{Order, sum qty}` | `count_id: 500`, `sum_qty: 2,436,095` |
| 流程定义 | `GET /a/v1/process-definitions` | 13 域 / 65 定义 / **带 runtime 字段者 0** |
| 卡点面板 | `GET /a/v1/process-instances/stuck` | `FEATURE_NOT_FOUND`（`features.ts` `process.runtime` `defaultOn:false`） |
| 金丝雀（同鉴权头） | `GET /a/v1/objects?type=Order&pageSize=1` | 返真订单 `SO-3391` |
| 决策域「输入即输出」 | aggregate count | `RootCauseChain` 4 · `DecisionGap` 2 · `CausalFactor` 37 · `AdoptedMitigation` **0** · `Cadence` 8 |
| 导航规模 | `GET /a/v1/me/workspace` | 51 项（demo/admin） |
