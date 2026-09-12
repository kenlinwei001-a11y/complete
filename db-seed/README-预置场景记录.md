# 预置场景记录安装包（自带「历史推演」数据）

本目录的两份 PostgreSQL 种子让**全新安装即自带已完成的推演与历史数据**——
无需任何手工配置，登录后在「运营复盘 / 对话坞历史推演」即可看到推演的全过程、数据与结果。

## 一键启动（Docker，推荐）

```bash
docker compose -f docker-compose.yml -f docker-compose.seed.yml up --build
# 打开 http://localhost  （或按 DEPLOY.md 配 hosts 指向 decision.local）
# 登录：租户 demo · admin / demo1234（另有 planner / base_manager:常州）
```

`docker-compose.seed.yml` 把本目录两份种子挂进 postgres 的 `/docker-entrypoint-initdb.d/`，
数据库**首次初始化时自动加载**；应用启动再跑幂等迁移，与种子并存不冲突。

> 重新加载需先清卷：`docker compose down -v` 后再带 `-f docker-compose.seed.yml` 起。

## 手工恢复（已有 PG 实例）

```bash
psql "$DATACORE_DATABASE_URL"  -v ON_ERROR_STOP=1 -f db-seed/datacore-seed.sql
psql "$AGENTCORE_DATABASE_URL" -v ON_ERROR_STOP=1 -f db-seed/agentcore-seed.sql
```

种子用 `--inserts --no-owner --no-privileges` 导出（pg16 导出，pg15 可加载）。

## 种子里有什么（全部经 REST 正门配置 + 真实求解产生，确定性 seed=42）

| 维度 | 数量 |
|------|------|
| 数据域 domains | 11 |
| 跨域本体对象类型 | 23 |
| 求解器 solvers | 21 |
| 约束规则 constraints | 16（C01–C33 子集） |
| skills | 20 |
| 场景 agents / 场景入口 | 10 / 10 |
| 评测用例 / MCP 集成位 | 20 / 1 |
| 工业级数据 | 订单 10060 · 物料批次 2000 · 采购单 3000 · 客户 60 |
| 对象 / 链路 / 时序点 | 17820 / 20208 / 61320 |
| 跨 6 域本体切片 | order_fulfillment_360（产品→工厂→工艺→设备→供给→商务） |

## 在哪里看「历史推演」

### A. 运营复盘页（renderer=review，消费 `GET /a/v1/history/bundle`）
livedIn 回放一年（T−365d→T0，12 月批次）写入 `lived_in_states`，页面可见：
- 12 个月产出趋势（检修月/到货危机下凹）
- 60 张已交付订单台账（含延期天数）
- 52 周 MAPE 收敛曲线（校准闭环 12%→7%）
- 10 个风险案例时间线、12 个 S&OP 版本（V1–V12）、200 条 Action 审计

### B. 对话坞「历史推演」（场景入口 preloadedHistory）
两个仿真场景的**完整推演记录**已写入对应场景入口，确定性可溯源：

1. **交期风险推演**（场景 `ent-risk-s02_affected`）
   - 问：「常州基地影响哪些订单？」
   - 推演：先经跨 6 域切片 order_fulfillment_360 逐单检索完整履约链（受影响单并集 **145 节点**，snapshot 1.14）→ affected_orders 在 [−7,+14] 交期窗口按四类问题归并。
   - 结果：命中受影响 **45 单**，逐单含延误天数/影响度，可下钻溯源。

2. **月度规划体检**（场景 `ent-audit-s04_audit`）
   - 问：「现金垫 55 亿、毛利目标 18% 过得了体检吗？」
   - 推演：先经切片检索代表订单跨域输入（供给齐套/商务信用/工厂产能，**46 节点**）→ plan_audit 按硬矛盾/软风险口径打分。
   - 结果：总评 **34/100**，结论「不通过」，硬矛盾 2 项。

> 完整逐节点明细见 `deliverables/跨域切片-两场景推演节点.xls`（5 表：概览 + 两场景节点明细 + 两场景链路血缘）。

## 二次推演

种子内每条数据都有来源（origin=SYNTHETIC）与引用，全部可经 REST 增删改查；
改完重跑求解器即二次推演。重新生成整套可执行：

```bash
DC_DATABASE_URL=... AC_DATABASE_URL=... PROVISION_SCALE=XL node scripts/provision-enterprise.mjs
```
