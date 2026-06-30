# WO-RETENTION（⑤·P2·数据留存/TTL）· FDE 亲手验收证据

> 真起 datacore（内存模式·`SEED_DEMO=1`·无 DATABASE_URL·端口 4051），以 admin 身份经真 HTTP 走完判据。
> 断点 G-RET 闭合；不变量 R-RETENTION 入 §5；门 `retention-coverage:check` 入 §7 并入 `pnpm gates`。

## 实现概览

- **契约**（`packages/contracts/src/actions.ts`）：`RetentionPolicy{id,tenantId,table,keepDays,status,updatedAt?,updatedBy?}` + `RetentionTableSchema`（`outbox_events`/`ts_points`/`scheduler_runs`）+ `RETENTION_DEFAULTS`（30/365/90）+ `ScheduledJobKind` 枚举补 `RETENTION_SWEEP`。
- **调度**（`apps/datacore/src/app.ts`）：`.on("RETENTION_SWEEP", t => retention.sweep(t))`；boot 注册每日 cron（`synthetic/service.ts`：`register(tenant,"RETENTION_SWEEP","tenant","0 4 * * *")`）。
- **清理实现**（`apps/datacore/src/retention.ts RetentionService`）：按 policy（覆盖优先，否则平台默认 ACTIVE）删过期+已处理行——outbox 仅删 DELIVERED/DEAD（PENDING/FAILED 不删）、ts 按 `ts`、scheduler_runs 仅删终态（RUNNING 不删）；一律 tenantId 限定（R2）；PAUSED 跳过。
- **可观测**：metric `dc_retention_purged_total{table}` + log。`GET/PUT /a/v1/retention-policies`（admin）+ 手动 `POST …/sweep`。
- **仓储双实现**：`table_retention_policies`（migration029·doc JSONB）+ pg.ts + memory.ts + repo.ts 接口（R9 四处）。

## 判据 ① outbox keepDays=0 → 旧 DISPATCHED 真删·PENDING 保留

启动日志（种子链全过 + 监听）：
```
SEED_DEMO=1: generating battery-manufacturing synthetic dataset (seed 42)
datacore listening (port 4051)
```

每日 cron 已注册（boot 经 synthetic.runJob）：
```
GET /a/v1/scheduler/jobs?kind=RETENTION_SWEEP
[{"id":"sjob_demo_RETENTION_SWEEP_tenant","kind":"RETENTION_SWEEP","cron":"0 4 * * *","status":"ACTIVE"}]
```

留存策略（默认）：
```
GET /a/v1/retention-policies
{"policies":[
  {"table":"outbox_events","keepDays":30,"status":"ACTIVE"},
  {"table":"ts_points","keepDays":365,"status":"ACTIVE"},
  {"table":"scheduler_runs","keepDays":90,"status":"ACTIVE"}],
 "defaults":{"outbox_events":30,"ts_points":365,"scheduler_runs":90}}
```

造一条 PENDING（注册死 URL webhook + 创建连接 → 事件投递失败留 PENDING）：
```
outbox BEFORE: total 30 {"DELIVERED":29,"PENDING":1}
```

设 keepDays=0 跑 sweep：
```
PUT /a/v1/retention-policies {"table":"outbox_events","keepDays":0}
  → {"keepDays":0,"status":"ACTIVE","updatedBy":"admin"}
POST /a/v1/retention-policies/sweep
  → {"byTable":{"outbox_events":29,"ts_points":0,"scheduler_runs":0},"total":29}

outbox AFTER:  total 1 {"PENDING":1}   remaining: ["PENDING"]
```
**✓ GET /a/v1/outbox 计数降 30→1；29 条已 DISPATCHED（DELIVERED）真删；1 条 PENDING 保留（防丢未投递事件）。**

## 判据 ② tasks/ts 同理按时间删

> DataCore 无 `tasks` store（tasks 是 AgentCore 概念）；受治理的无界增长表为 `outbox_events`/`ts_points`/`scheduler_runs`。
> ts_points 按事件时间 `ts` 删；scheduler_runs 按 `scheduledAt` 删终态行。

```
PUT ts_points keepDays=0 ; PUT scheduler_runs keepDays=0 ; POST sweep
  → {"byTable":{"outbox_events":0,"ts_points":16200,"scheduler_runs":0},"total":16200}
```
**✓ ts_points 16200 条旧点真删（demo 真实时序数据）；scheduler_runs 0（该短命进程未累积运行历史，无可删——正确）。**

metric 正确按 table 标签累加：
```
GET /metrics
dc_retention_purged_total{table="outbox_events"} 29
dc_retention_purged_total{table="ts_points"} 16200
```

## 判据 ③ 未配 policy 的表不动（不误删）

受治理表恒为 `RETENTION_TABLES`=`{outbox_events,ts_points,scheduler_runs}`（结构性约束）。其余表（objects/links/rules/ontology…）**不在 sweep 范围**，sweep 绝不触碰 → 不误删。`retention-coverage:check` 门静态守"每张无界增长表都在注册表 + sweepTable 有删除分支"。

## R2 tenant_id 限定（勿跨租户删）

- 非 admin（planner）PUT → **403**。
- acme 租户跑 sweep：demo 的 1 条 PENDING 事件**未被碰**（仍为 1）：
```
demo outbox before acme sweep: 1
acme sweep result: {"byTable":{"outbox_events":0,...},"total":0}
demo outbox AFTER acme sweep: 1     ← R2：跨租户不删，确认
```

## 红线

- `pnpm -r build`（contracts/llm-adapters/datacore/agentcore/frontend 全 4+1 包）✓
- `pnpm gates` 全绿（含新门 `retention-coverage:check` + `ontology-writeback:check` 28 门 §7 漏登 0 + `seed-demo-smoke:check` 真启动 + `repo-pg-notnull:check` 校验 84 表）✓
- `test/retention.test.ts`（5 例）+ scheduler/synthetic/connectors/notifications/timeseries/governance/features 受影响域全绿 ✓
- 模型标识不入提交物；密钥不入 git；契约只经 `@platform/contracts`；R2 everywhere；R9 双仓储四处同改。

## 距北极星

WO-RETENTION 招牌（防长跑爆库 + 合规留存上限）在**活系统真发生**：真起服务、真删旧已投递事件/旧时序点、真保留未投递事件、真跨租户隔离、真按 table 计量。本期为**软上限（按时间）**——分区/冷归档、`ts_points` 按 series 排除"当前值/快照"语义、租户级合规导出留痕属后续增强。
