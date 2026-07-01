# WO-DR-SIEM · 灾备数据备份 + 外部审计 SIEM 对接
> 由来：R27 运营/合规/商业化融合单（`docs/TODO-prd-pack.md` L10341/L10393）中 ④灾备/数据备份 与 ⑥外部审计对接两环；缺口出处 `docs/ANALYSIS-ops-compliance-commercial-gap-scan.md` L11（灾备 ❌「`pg_dump`/`pg_restore` 零命中」）+ L25（外部审计对接 ❌「无审计证据导出（SOC2 式）」）。地基已就位：留存 TTL（commit 565a748·`retention.ts`）+ append-only 审计日志（commit 399e6ca·`audit.ts`）。A/B 决策实验（③）已由 WO-EXPERIMENT baba605 落地，本单**不重复**。
> 依赖：`apps/datacore`（`retention.ts` / `audit.ts` / `adminplatform.ts` 审计只读面 / `scheduler.ts` cron / `outbox.ts` 事件 / `crypto.ts` 凭据加密）· `packages/contracts`（`admin.ts` AuditLogEntry / `actions.ts` ScheduledJobKind）· `docker-compose.yml`（pg×2）· `DEPLOY.md`。**先读 `docs/SYSTEM-ONTOLOGY.md`** §2.F/G（留存+审计对象）·§4（outbox 事件）·§5（R-RETENTION/R-AUDIT/R2/R5/R9）·§7（retention-coverage/audit-actor 门）·§8（G-RET 已闭）。

本单可分两子项独立交付：**子项 A = 灾备/数据备份**（pg dump/PITR runbook + 租户级导出端点）· **子项 B = 外部审计 SIEM connector**（审计日志推送到外部 SIEM/审计系统）。

---

## §0 目标 + DoD-as-experience（用户视角·亲手走一遍能用·非测试绿）

**子项 A — 灾备/数据备份**
1. **运维（SRE）亲手**：照 `DEPLOY.md` 新增《§9 灾备与备份》一节，跑 `scripts/backup-pg.sh` → 在宿主机拿到 `datacore-<ts>.sql.gz` + `agentcore-<ts>.sql.gz` 两个逻辑备份文件；跑 `scripts/restore-pg.sh <dump>` → 起一个 scratch pg，导入成功、行数与源一致。**看得见文件、导得回数据**，而非"文档说有备份"。
2. **合规官/租户 offboarding 亲手**：admin 调 `POST /a/v1/tenant-export`（本租户）→ 拿到一个**该租户全量业务数据**的 JSON bundle（可携带权 GDPR-lite），字节可复核；跨租户调 → 403。
3. **诚实边界可见**：PITR 段在 runbook 里明确标注"需 pg WAL 归档（当前 compose 未配·见 §2 配置样例）"，**不假装已有 PITR**（R13）。

**子项 B — 外部审计 SIEM 对接**
1. **审计员/安全团队亲手**：admin 配一个 SIEM connector（`POST /a/v1/audit-sinks`，类型 `webhook_ndjson`，填 endpoint + secret），secret **加密落库不回显**（仅 `credentialRef`·R5）→ 触发一次管理操作（如改 feature 开关）→ 在外部 SIEM 端（FDE 用一个本地 ndjson 收集器 mock）**看到该审计事件以 NDJSON 推达**（actor+target+before/after+requestId 齐全）。
2. **可续投/不丢**：SIEM sink 复用 append-only `audit_log` 作馈源 + 游标（`sinceAt`）；投递失败不阻断主写路径（旁路推送），下次 sweep 续投。**审计事件既留在本地 append-only、又外流到 SIEM**，双写不互相拖累。
3. **关=不存在**：`audit-sink` feature 关 → 404 `FEATURE_NOT_FOUND`（R3）。

---

## §1 现状盘点（钉真实 file:line·grep/read 核实）

| 能力 | 状态 | 真实证据（file:line） |
|---|---|---|
| **append-only 审计日志（馈源地基）** | ✅ 已在 | `apps/datacore/src/audit.ts:40` `AuditService.record`（`auditLog.put` + `outbox.emit` 双写）；域类型 `domain.ts:100` `AuditLogRecord{actorId,action,targetKind,targetId,before,after,at,requestId}`；契约 `packages/contracts/src/admin.ts:60` `AuditLogEntrySchema` |
| **审计日志只读查询面（SIEM 拉取可复用）** | ✅ 已在 | `apps/datacore/src/adminplatform.ts:585` `GET /a/v1/audit-log`（`since`/`actor`/`target`/`limit`·倒序）；读者守卫 `adminplatform.ts:580` `requireAuditReader`（platform_admin/auditor/admin） |
| **auditor 只读角色** | ✅ 已在 | `packages/contracts/src/admin.ts:51` `"auditor"`（内置角色·不授写权） |
| **留存 TTL（清理地基·防馈源无界）** | ✅ 已在 | `apps/datacore/src/retention.ts:36` `RetentionService`；`app.ts:668` `.on("RETENTION_SWEEP",…)`；门 `scripts/check-retention-coverage.mjs`（`package.json:50`） |
| **RETENTION_SWEEP 每日 cron 注册** | ◐ 部分 | 仅在合成生成路径 `apps/datacore/src/synthetic/service.ts:255` `scheduler.register(…,"RETENTION_SWEEP","tenant","0 4 * * *")`，且 `if (this.scheduler)`（:247）——**未跑合成的真实租户可能永不注册此 cron**（本单不修此项，仅记为已知边界，见 §4） |
| **凭据 AES-GCM 加密（SIEM secret 复用）** | ✅ 已在 | `apps/datacore/src/crypto.ts:16` `CredentialCipher.encrypt` → `enc:v1:…`；`app.ts:322` `new CredentialCipher(config.CREDENTIAL_KEY)` |
| **outbox 领域事件（新事件复用）** | ✅ 已在 | `apps/datacore/src/outbox.ts:40` `emit(tenantId,event,payload,aggregateKey?)` |
| **scheduler 作业注册（新 job kind 复用）** | ✅ 已在 | `apps/datacore/src/scheduler.ts:55` `register(tenantId,kind,refId,cron,tz)`；`ScheduledJobKind` 枚举 `packages/contracts/src/actions.ts:97` |
| **配置导出（Saga·仅配置非数据）** | ✅ 已在（不覆盖数据） | `apps/datacore/src/config-bundle.ts:39` `export`（只导 `featureOverrides`）——**非**业务数据导出，是子项 A 租户导出的形状参考、非替代 |
| **应用级数据备份/恢复（pg_dump/restore）** | 🔴 缺 | grep 全仓 `pg_dump`/`pg_restore`/`pg_basebackup` 零命中；`docker-compose.yml:23` `postgres:15-alpine`（B）+ A 侧 pg 纯配置无 `archive_command`/WAL 归档 → 无 PITR 基建 |
| **租户级数据导出/被遗忘权** | 🔴 缺 | 无 `exportTenant`/`purgeTenant` 编排；`DEPLOY.md §8` 仅"数据持久化与重置"（volume 层）无租户级 |
| **备份 runbook** | 🔴 缺 | `DEPLOY.md` grep `备份`/`backup`/`pg_dump` 零命中；§7 故障排查无恢复演练 |
| **审计日志外流 SIEM/审计系统 connector** | 🔴 缺 | grep 全仓 `siem`/`SIEM` 仅命中前端 config-migration 与本分析文档，无审计外送实装；审计日志止于本地 `GET /a/v1/audit-log`（`adminplatform.ts:585`） |
| **审计 sink 契约/推送服务/游标** | 🔴 缺 | 无 `AuditSink`/`audit-sinks` 路由/`AuditSinkService`/`AUDIT_SINK_FLUSH` job |

---

## §2 施工范围（dev 可直接照做）

### 子项 A — 灾备/数据备份

**A-1 逻辑备份脚本（宿主机·两库）** — 新增 `scripts/backup-pg.sh`
- 用 compose 内 pg 容器名对两库各跑一次逻辑备份：
  - `docker compose exec -T postgres-a pg_dump -U datacore datacore | gzip > "$OUT/datacore-$(date +%Y%m%dT%H%M%S).sql.gz"`
  - 同理 `postgres-b` / `agentcore`（`docker-compose.yml:23` 用户名 `agentcore`）。
- 参数：`OUT`（默认 `./backups`）·`--keep N`（保留最近 N 份，删旧）。纯 bash，无新依赖。诚实：脚本头注明"逻辑备份=时间点快照·非连续 PITR"。

**A-2 恢复脚本 + 演练** — 新增 `scripts/restore-pg.sh <dump.sql.gz> [--target scratch]`
- 默认恢复到一个**一次性 scratch pg 容器**（`docker run --rm postgres:16`），`gunzip -c | psql`，跑完打印目标库若干核对表行数（如 `outbox_events`/`audit_log` count）供人核对"导得回"。`--target datacore` 时二次确认（防误覆盖生产）。

**A-3 租户级数据导出端点** — 改 `apps/datacore/src/app.ts` + 新增 `apps/datacore/src/tenant-export.ts`
- `POST /a/v1/tenant-export`（admin·`requireTenantAdmin` 形态见 `app.ts:3910` 附近）→ `TenantExportService.export(ctx)`：按 `Repos` 遍历本租户各 Store（R2 全程 `ctx.tenantId` 限定），产出 `{ tenantId, exportedAt, schemaVersion, tables:{ [logicalName]: Record[] } }` JSON bundle。
- **凭据脱敏（R5）**：导出前对含 `enc:v1:` 字段用 `CredentialCipher.isEncrypted`（`crypto.ts:37`）过滤 → 导出 `credentialRef` 占位，**绝不导明文/密文**。
- 契约：`packages/contracts/src/admin.ts` 新增 `TenantExportBundleSchema`（形状参考 `config-bundle.ts:39` `export`）。
- metric：`dc_tenant_export_total{}`（复用 `metrics.ts:15` `inc`）。
- **边界**：本单只做**导出**（可携带权），**不做** `purgeTenant`（被遗忘权级联删），后者列 §4。

**A-4 备份 runbook** — 改 `DEPLOY.md` 新增《§9 灾备与备份》
- 三段：① 定时逻辑备份（cron 调 `scripts/backup-pg.sh`·保留策略）② 恢复演练（`scripts/restore-pg.sh` → scratch 核行数）③ **PITR 升级路径（诚实标注未配）**：给出 pg WAL 归档 compose 样例（`archive_mode=on`/`archive_command`/独立卷），明确"当前 `docker-compose.yml` 未启用·需运维按样例开启方得连续恢复"。放在现 §8「数据持久化与重置」之后、§7 故障排查补一条"恢复失败排查"。

### 子项 B — 外部审计 SIEM 对接

**B-1 契约** — 改 `packages/contracts/src/admin.ts`
- `AuditSinkSchema{ id, tenantId, kind:"webhook_ndjson", endpoint:string, status:"ACTIVE"|"PAUSED", credentialRef?:string, sinceAt?:string, updatedAt?, updatedBy? }`（secret 不入 schema 明文，仅 `credentialRef`·呼应 R5）。
- 扩 `ScheduledJobKindSchema`（`actions.ts:97`）加 `"AUDIT_SINK_FLUSH"`。

**B-2 推送服务** — 新增 `apps/datacore/src/audit-sink.ts`
- `AuditSinkService`：
  - `setSink(ctx, input)`：secret 经 `cipher.encrypt`（`crypto.ts:16`）→ 存 `credentialRef`；落 `audit_sinks` store（R2）。
  - `flush(tenantId)`：读 sink（ACTIVE）→ 以 `sinceAt` 游标从 `repos.auditLog.list`（复用 `adminplatform.ts:590` 同款过滤）取增量 → 组装 NDJSON（每行一条 `AuditLogEntry`）→ POST 到 `endpoint`（带 secret 解密后作 `Authorization`/签名头）→ 成功则前推 `sinceAt=max(at)`。**失败旁路吞掉**（log + metric `dc_audit_sink_failed_total{}`）**不抛**（不拖垮主写/主 sweep）。幂等：游标单调前推，重投至多重复不丢。
  - 复用馈源：**不新建审计写路径**，直接消费既有 append-only `audit_log`（`domain.ts:100`）——满足"既留本地又外流"。
- 出站 HTTP 走既有出站客户端形态（参考 `agentcore` 侧 `tools/datacore-http.ts` 透传 `x-request-id` 的模式，datacore 侧用 `fetch` + 注入 requestId 便于两端对账）。

**B-3 路由 + 调度接线** — 改 `apps/datacore/src/app.ts`
- `GET /a/v1/audit-sinks`（列·admin）· `PUT /a/v1/audit-sinks`（设·admin·entitlement `audit-sink` 暗发 R3）· `POST /a/v1/audit-sinks/flush`（手动触发·FDE 真跑）。守卫复用 `requireAuditReader`/tenant admin 口径。
- boot 接线：`app.ts:668` 附近仿 `RETENTION_SWEEP` 加 `.on("AUDIT_SINK_FLUSH", async (t)=> auditSink.flush(t))`；cron 注册**与 RETENTION_SWEEP 同址**（`synthetic/service.ts:255` 旁加一行，例如 `"*/5 * * * *"`）——**注意继承 §1 那条 ◐ 边界**（真实非合成租户需另处兜底注册，见 §4）。

**B-4 R9 双仓 + 迁移**（audit_sinks 表，遵 R9 四处同改）
- `apps/datacore/migrations/03X_audit_sinks.sql`（表 `audit_sinks`，PK id，tenantId 索引）
- `apps/datacore/src/repo/repo.ts`（接口加 `auditSinks: Store<AuditSink>`，仿 `repo.ts:273` `auditLog`）
- `apps/datacore/src/repo/memory.ts` + `apps/datacore/src/repo/pg.ts` 同加。

**B-5 门（可选·守不回潮）** — 扩 `scripts/check-audit-actor.mjs`
- 加一条静态断言："SIEM sink 只读消费 `audit_log`，不得新增绕过 `AuditService` 的审计写路径"（保护 append-only 单一来源不被 sink 破坏）。并入现 `package.json:55` gates 链（已含 `audit-actor:check`）。

---

## §3 验收（FDE 亲手·curl + 真浏览器 + 门）

**准备**：内存双服务（无需 pg 即可验子项 B + A-3 导出；A-1/A-2 备份脚本需 `docker compose up` 起 pg）。
```
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
```
`H='X-Debug-User: demo:admin:admin|platform_admin'`

**子项 A**
1. **备份可见**：`docker compose up -d` 后 `bash scripts/backup-pg.sh --out ./backups` → `ls ./backups` 见 `datacore-*.sql.gz` + `agentcore-*.sql.gz`（非空·gzip 头正确）。
2. **导得回**：`bash scripts/restore-pg.sh ./backups/datacore-*.sql.gz` → 打印 scratch 库 `audit_log`/`outbox_events` 行数 > 0 且与源一致。
3. **租户导出**：`curl -H "$H" -XPOST :4001/a/v1/tenant-export -o export.json` → `jq '.tables | keys' export.json` 见多表；`jq '.. | strings | select(startswith("enc:v1:"))' export.json` **为空**（无密文/明文泄漏·R5）。跨租户：`X-Debug-User: other:u:admin` 调 → 403。
4. **PITR 诚实**：`DEPLOY.md §9` 打开可见 PITR 段明确标"当前 compose 未启用 WAL 归档"。

**子项 B**
5. **SIEM 收得到**：起本地 ndjson 收集器（如 `nc -l 9099` 或极简 node http），`curl -H "$H" -XPUT :4001/a/v1/audit-sinks -d '{"kind":"webhook_ndjson","endpoint":"http://127.0.0.1:9099/ingest"}'` → 触发一次管理变更（如 `PUT /a/v1/tenants/demo/features` 改一开关，落审计）→ `curl -XPOST :4001/a/v1/audit-sinks/flush -H "$H"` → 收集器端**看到该条审计 NDJSON**（含 actor/target/before/after/requestId）。
6. **secret 不回显**：`curl -H "$H" :4001/a/v1/audit-sinks | jq '.[0]'` → 只见 `credentialRef`，**无** endpoint secret 明文（R5）。
7. **双写不互拖**：把 endpoint 改成不可达 → `flush` **不报 5xx**（旁路吞·主写正常）；`GET /a/v1/audit-log` 仍返回本地全量（本地 append-only 不受 SIEM 影响）。
8. **关=404**：关 `audit-sink` feature → `PUT /a/v1/audit-sinks` 返回 404 `FEATURE_NOT_FOUND`（R3）。

**门**：`pnpm -r build && pnpm -r test`（datacore 现 69 基线 + 新增 `tenant-export.test.ts`/`audit-sink.test.ts` 应全绿）；`pnpm audit-actor:check` + `pnpm retention-coverage:check` 绿；`pnpm gates` 绿。

---

## §4 不在本次范围（诚实边界）

- **被遗忘权 `purgeTenant`（级联删两系统全资源）**：本单只做导出（可携带权），删除权列 WO-DSR 后续（gap-scan L22·`docs/ANALYSIS-ops-compliance-commercial-gap-scan.md`）。
- **真 PITR / WAL 连续归档**：本单只给 compose 样例 + runbook 升级路径，**不改 `docker-compose.yml` 默认起 WAL 归档**（避免影响默认 up）；真启用由运维决策。
- **RETENTION_SWEEP / AUDIT_SINK_FLUSH cron 对"非合成真实租户"的兜底注册**：§1 已钉此 ◐（`synthetic/service.ts:255` 仅合成路径注册）。本单沿用同址注册，**不新建 tenant-provision 级 cron 兜底**（那是独立的"租户开通时注册系统级 cron"缺口，值得单独 WO）。
- **SIEM 主流协议原生适配**（Splunk HEC / OTLP-logs / syslog RFC5424）：本单只做通用 `webhook_ndjson`；具体协议 codec 按客户按需扩 `AuditSink.kind`。
- **A/B 决策实验（③）**：已由 WO-EXPERIMENT baba605 交付，不重复。
- **跨服务追踪（⑥中的 OBS 部分）**：requestId 透传已由 399e6ca、OTel span 树已由 WO-OBSERVABILITY 落地，本单只复用 requestId 贯穿 SIEM 事件、不新做追踪。

---

## 本体引用与影响（链路/对象类型/不变量/断点/回写）

- **对象类型（§2）**：新增 `TenantExportBundle`（G 治理域·租户可携带导出·凭据脱敏）· `AuditSink`（G 治理域·审计外送目标·`{kind,endpoint,credentialRef,sinceAt}`·R2/R5）。回写 §2.G。
- **链路/事件（§4）**：SIEM sink **消费**既有 append-only `audit_log` 馈源（不新建审计写路径）；`AUDIT_SINK_FLUSH` 作旁路投递作业（失败不阻断主写·至少一次外送、可重复不丢）。若 `tenant-export` 落审计动作，新增 `tenant.exported` outbox 事件（`outbox.ts:40` emit）需登记 §4 事件表。
- **不变量**：R2（导出/推送全程 tenantId 限定·跨租户 403）· R5（SIEM secret AES-GCM 落库仅 credentialRef·导出脱敏 `enc:v1:` 字段·`crypto.ts:37`）· R9（`audit_sinks` 新表四处同改）· R13（PITR 未配诚实标注·不假装；审计外流不改本地 append-only 单一来源）。**建议新增不变量 R-DR**：「每个持久化 pg 库有逻辑备份脚本覆盖 + 恢复演练路径」——回写 §5。
- **断点（§8）**：本单闭 **G-DR-1「无应用级数据备份/恢复」**（gap-scan ①）与 **G-SIEM-1「审计日志无外部审计系统对接」**（gap-scan ⑥），入 §8 与 G-RET（已闭）并列。**保留登记** G-CRON-1「系统级 cron 仅合成路径注册、真实租户可能漏 RETENTION_SWEEP/AUDIT_SINK_FLUSH」（§1 ◐·本单不修）。
- **门禁（§7）**：扩 `audit-actor:check` 守"SIEM sink 不得绕过 `AuditService` 新增审计写路径"（保 append-only 单一来源）；回写 §7。
- **回写清单**：新增对象类型 + `tenant.exported` 事件 + R-DR + G-DR-1/G-SIEM-1 闭合 + G-CRON-1 登记 + `audit-actor:check` 扩项，均须回写 `docs/SYSTEM-ONTOLOGY.md` 对应章节（本体不回写即过期）。

---
*审核方自包含施工单（design+review·铁律0.5·钉真实 file:line）· 仅推 claude/vigilant-knuth-b1nmxn · 模型标识不入任何提交物*
