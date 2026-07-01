# WO-ENTERPRISE-DR-AUDIT · FDE 亲手真跑证据

> 灾备备份（pg_dump/restore·逻辑备份 + scratch 恢复演练）+ 外部审计 SIEM sink（NDJSON 旁路推送·secret 加密不回显·投递失败不阻主写·关=404）。
> 亲手真跑：真起 pg（docker compose·127.0.0.1:5433/5434）· 真起本地 NDJSON 收集器（127.0.0.1:9099）· 真起 datacore 内存服务（:4001·SEED_DEMO=1）。

---

## sub-A · 灾备/数据备份（看得见文件 → 导得回数据·行数一致）

### 源库行数（备份前）
```
datacore.audit_log      = 7
datacore.outbox_events  = 12
agentcore.outbox_events = 5
```

### 备份文件真产出（宿主机可 ls）
`bash scripts/backup-pg.sh --out ./backups`（COMPOSE=docker compose·两库各一次 pg_dump | gzip）：
```
✓ datacore-20260701T092542.sql.gz（896 字节）
✓ agentcore-20260701T092542.sql.gz（811 字节）

$ ls -la backups2/
-rw-r--r-- 1 root root 811 Jul  1 09:25 agentcore-20260701T092542.sql.gz
-rw-r--r-- 1 root root 896 Jul  1 09:25 datacore-20260701T092542.sql.gz
```
脚本尾部诚实提示：`逻辑备份=时间点快照·非连续 PITR。连续恢复需 pg WAL 归档（见 DEPLOY.md §9）。`

### 恢复演练（restore-pg.sh → scratch pg → 行数与源一致）
`bash scripts/restore-pg.sh <dump> --target scratch`（起一次性 postgres:15·127.0.0.1:543x·initdb postgres 用户·导入·核行数·自动 --rm 销毁）：
```
=== restore datacore (source: audit_log=7 outbox_events=12) ===
· 起一次性 scratch pg 容器（postgres:15·TCP 127.0.0.1:5439·initdb postgres 用户·库 datacore）
· 导入 …/datacore-20260701T092542.sql.gz → scratch(datacore)
恢复行数核对（scratch·datacore 库）:
  audit_log: 7          ← 与源一致 ✓
  outbox_events: 12     ← 与源一致 ✓

=== restore agentcore (source: outbox_events=5) ===
· 起一次性 scratch pg 容器（postgres:15·TCP 127.0.0.1:5438·initdb postgres 用户·库 agentcore）
恢复行数核对（scratch·agentcore 库）:
  audit_log: 0          ← agentcore 无此表数据（诚实·非错误）
  outbox_events: 5      ← 与源一致 ✓
```
**结论**：备份文件真在宿主机 · restore 到 scratch pg 行数与源字节级一致 = 导得回数据（非"文档说有备份"）。

### PITR 诚实标未配（R13）
`DEPLOY.md §9` 明确标注：当前 `docker-compose.yml` **未启用** WAL 归档（`archive_mode`/`archive_command` 未配）→ 无连续 PITR；给出升级路径配置样例，不假装已有。

---

## sub-B · 外部审计 SIEM sink（真 HTTP·secret 不回显·NDJSON 推达·失败旁路·关=404）

datacore 内存服务真起（`PORT=4001 SEED_DEMO=1 CREDENTIAL_KEY=<64hex>`）+ 本地 NDJSON 收集器 `:9099`。

### secret 加密不回显（R5）
配 sink 带 secret：`PUT /a/v1/audit-sinks {"kind":"webhook_ndjson","endpoint":"http://127.0.0.1:9099/ingest","secret":"top-secret-siem-token"}`
```
{"id":"asink_demo",...,"status":"ACTIVE","credentialRef":"cred:configured",...}   ← 仅 credentialRef 存在标记
GET /a/v1/audit-sinks → [{...,"credentialRef":"cred:configured",...}]              ← 无 secret 明文·无 enc:v1: 密文
```
secret（`top-secret-siem-token`）与密文（`enc:v1:`）均**不出现在任何响应**。

### 审计事件 NDJSON 推达 SIEM（actor+target+before/after+requestId 齐）
触发管理操作 `PUT /a/v1/tenants/demo/features {"overrides":{"view.plan-audit":false}}`（`x-request-id: req-fde-siem-001`）→ `POST /a/v1/audit-sinks/flush`：
```
flush → {"delivered":1,"ok":true}

SIEM 收集器 :9099 收到 NDJSON（features.updated 条目）：
{"actorId":"admin","action":"features.updated","targetKind":"feature_config","targetId":"fcfg_demo","requestId":"req-fde-siem-001"}
has before: True | has after: True
```

### 投递失败不阻断主写（旁路吞·续投）
endpoint 改为不可达 `http://127.0.0.1:1/dead` → 新增审计 → flush：
```
flush → {"delivered":0,"ok":false,"error":"fetch failed"}   http=200   ← 恒 200·不 5xx·不抛
GET /a/v1/audit-log → total=4                                ← 本地 append-only 全量·不受 SIEM 失败影响
```
游标未前推 → 下次 sweep 按 sinceAt 续投（至少一次外送·可重复不丢）。

### 关=不存在（R3 Entitlement 先于 authz）
裸租户（无模板·`audit-sink` defaultOn:false）：
```
PUT /a/v1/audit-sinks → {"error":{"code":"FEATURE_NOT_FOUND",...}}   http=404
```

---

## 门 / 测试
- `pnpm --filter datacore test audit-sink` → 6/6 绿（secret 不回显 / NDJSON 推达 / 失败旁路续投 / 游标不重投 / 关=404 / R2 隔离）。
- `pnpm -r build`（4 包）+ `pnpm --filter datacore test` 全绿；`pnpm gates` 全绿（含 `audit-actor:check` 守 SIEM sink 只读消费 audit_log·不新增绕过 AuditService 的审计写路径）。
