# 部署指南 · 全域数字化智能决策支撑系统

本指南面向本机/局域网一键部署：`docker compose up --build` 拉起 PostgreSQL ×2、MinIO、DataCore（System A）、AgentCore（System B）、前端 SPA 与 nginx 网关，配好域名后浏览器直接访问，登录 admin 即可看到全部模块（前后端真连，无 mock）。

---

## 1. 先决条件

| 项 | 要求 |
|---|---|
| Docker | Docker Engine 20+（含 `docker compose` v2 插件）；macOS/Windows 用 Docker Desktop |
| 内存 | 建议 ≥ 4 GB 可用内存（两个 Postgres + 两个 Node 服务 + nginx） |
| 磁盘 | ≥ 2 GB（镜像 + 演示数据卷） |
| 端口 | 80（网关）、4001/4002（后端直连调试）、5441/5442（数据库）、9000/9001（MinIO）空闲 |

> 无需本机安装 Node/pnpm —— 全部在镜像内构建。

## 2. 部署步骤

```bash
git clone <仓库地址> && cd <仓库目录>
docker compose up --build          # 首次构建约几分钟；后台运行加 -d
```

等待 `gateway` 服务就绪（`docker compose ps` 全部 healthy）。首次启动 DataCore 会自动：

1. 对空库执行幂等迁移（`migrations/*.sql`，服务启动时自动执行，也可手动 `pnpm --filter datacore migrate`）；
2. **平台引导（Bootstrap，管理平台增量 §1）**：bootstrap 检查先于 SEED_DEMO 播种决策执行 ——
   检查时刻 `users` 表为空且配置了 `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`，
   则在自动创建的 `default` 租户下创建平台超管（角色 `platform_admin`，邮箱即登录名）；
   幂等（表非空则跳过，pg 重启不会重复创建）；
3. `SEED_DEMO=1`（默认开）播种电池制造演示数据（seed 42，确定性：12 基地 / 6 型号 / 20 订单 / 90 天历史时序 / 规则 / 权限策略 / 四个演示账号）。两者可叠加：BOOTSTRAP 创建超管、SEED_DEMO 创建演示账号，互不影响。

> **优先级（与代码注释一致，见 `apps/datacore/src/bootstrap.ts`）**：
> `users` 表为空 + 未配 BOOTSTRAP 变量 + `SEED_DEMO=0`（即播种后表仍为空）→ `/readyz` 持续返回 **503**，
> 响应与日志明示原因 `BOOTSTRAP_REQUIRED`；`SEED_DEMO=1` 播种出的演示账号使表非空 → 不 503。
> 空系统冷启动（`SEED_DEMO=0`）必须配置 BOOTSTRAP 变量，再由 platform_admin 在 `/admin/tenants`
> 建租户 → 建首个 tenant_admin → 登录 → 一键合成或克隆行业模板，各管理页即有内容可配。
> platform_admin 是唯一跨租户角色（建租户/建首管/管行业模板），**不能读任何租户的业务对象**。

## 3. 配域名（二选一）

**方式 A · 本机 hosts：**编辑 hosts 文件（Linux/macOS `/etc/hosts`，Windows `C:\Windows\System32\drivers\etc\hosts`）追加：

```
127.0.0.1  decision.local
```

**方式 B · 局域网访问：**把上面的 `127.0.0.1` 换成部署机的局域网 IP（如 `192.168.1.50  decision.local`），写进每台访问机器的 hosts；或在内网 DNS 上加 A 记录。

网关对 `server_name` 不挑剔，直接 `http://localhost` 也能访问。

## 4. 访问与登录

浏览器打开 **http://decision.local**。

| 账号 | 密码 | 角色 | 看到什么（"不同账号不同前端"） |
|---|---|---|---|
| `admin` | `demo1234` | admin + planner + catalog_admin + tenant_admin | 全部业务视图 + 全部管理台（admin 导航组，含 /admin/users 用户管理） |
| `planner` | `demo1234` | planner | 全部业务视图，无管理台，主题强调色不同 |
| `base_manager` | `demo1234` | base_manager:常州 | 业务视图子集（仅推演/台账等），数据行级过滤到常州基地，主题强调色不同 |
| `approver` | `demo1234` | approver + admin | 第二审批人：S2 审批链「发起人不得自批」，admin 自己发起的审批（校准批准 / AOP 拍板等）由此账号通过 |

租户固定为 `demo`。

## 5. 各模块导览（登录 admin 后）

**业务视图（左侧"业务视图"导航组，元数据驱动）**

| 视图 | 后端能力 |
|---|---|
| 经营驾驶舱 dash | 声明式 widget：对象聚合（总产能/利用率/计划达成率/在手订单）+ 时序趋势（A8 聚合查询）+ 订单表 |
| 本体图谱 graph | A4 本体：对象类型/关系/规则绑定/派生公式 + 求解器节点（`GET /a/v1/ontology/graph`） |
| 预判推演看板 risk | S1 `risk_timeline` 求解器（14 天风险时间线、越线日、受影响订单下钻） |
| 订单台账 order | 对象分页查询 + 列筛选（`GET /a/v1/objects?type=Order&f_*=`，行级权限过滤） |
| 规划体检 plan-audit | S1 `plan_audit` 求解器（约束扫描 + 一键修正 Action） |
| 方案生成 plan-generate | S1 `plan_generate` 求解器（处置方案候选 + 采纳为草稿） |
| 项目沙盘推演 project-sim | S1 `capacity_forecast` 求解器（P50/P90 产能、What-if 调参，`POST /b/v1/solvers/{key}/run`） |
| S&OP 月度平衡 sop-balance | S1.8 `/a/v1/sop/*` 五步月度平衡流程（版本/推进/锁定） |
| 查询对话 Dock | QOS 全链路：意图分类 → 工作流（路径 A）/探索 Agent（路径 B）→ SSE 流式过程 → 可溯源回答 |

**管理台（左侧"管理台"导航组，admin 可见）**

| 页面 | 对应后端模块 |
|---|---|
| 数据接入 /admin/connections | A1 连接器（类型注册表/动态表单/测试连接/同步作业/文件上传字段画像） |
| 规则文档审核 /admin/rule-docs | A2 文档 → 规则候选抽取（LLM）→ 人工审批入库 |
| 本体建模 /admin/modeling | A3 半自动建模（字段画像 → 建议 → PATCH 微调 → 发布 → 物化） |
| 规则库 /admin/rules | A5 规则 DSL（列表/发布/评估） |
| 权限策略 /admin/permissions | A6 策略表 + authz explain 调试器（行级过滤表达式） |
| 合成数据 /admin/synthetic | A7 行业模板六阶段生成 + A8.6 模拟时钟（tick 推进/重置） |
| Action 审批 /admin/actions | S2 Action 草稿状态机（多级审批，决不直接执行） |
| 意图目录 /admin/catalog | B6/QOS 意图与执行计划（发布/退役/兜底孵化闭环 /admin/ops/fallback） |
| Agent/Workflow/Skill/MCP/场景 /admin/agents 等 | B1–B5 注册表（统一资源模式：DRAFT 可改 / PUBLISHED 不可变 409 IMMUTABLE_VERSION / new-version 派生 / references 引用清单 / retire 确认；发布校验、环检测、凭据不回显、连接测试） |
| 租户管理 /admin/tenants | 管理平台增量 §2：仅 platform_admin —— 租户列表/创建/首个 tenant_admin |
| 用户管理 /admin/users | 管理平台增量 §2：tenant_admin —— 邮箱/角色 chips（参数化角色带参数输入）/属性编辑/状态开关/重置密码（最后管理员不可禁用 409 LAST_ADMIN） |
| 视图配置 /admin/views | 管理平台增量 §3：ViewConfig CRUD（renderer 12 选 1，创建自动注册 feature `view.{viewKey}`，删除级联提示引用并需确认，导航上下移排序，保存即 configVersion+1） |

## 5.x LLM Provider 配置与变更传播（增量）

- **多 LLM 厂商**：`/admin/llm-providers`（tenant_admin）配置 provider（anthropic / openai_compatible / custom_http 预留）
  与「用途绑定矩阵」（classifier/agent/extraction/modeling/template_gen/compose）。apiKey write-only（AES-GCM 落 A 库），
  AgentCore 经服务间凭证 `SERVICE_TOKEN`（两服务同值）拉取配置与解密密钥（密钥内存缓存 5min，永不落 B 库、永不到前端）。
- **变更传播 SLO ≤60s**：B 对 A 资源（provider 配置/用途绑定/功能集）缓存统一 TTL 60s；发布即发 outbox 事件
  `{kind}.updated`（llm_provider.updated / llm_binding.updated / rules.updated），经 C-2 webhook 注册表回调 B 的
  失效钩子 `POST {B}/b/v1/internal/invalidate` 立即失效（事件通路故障由 TTL 兜底）。注册方式：
  `POST /a/v1/webhooks { "url": "http://agentcore:4002/b/v1/internal/invalidate", "events": [] }`。
- **引用模式**：意图 → 计划为 `planRef {planKey, version|"latest"}`（执行时解析）；规则引用永远取 PUBLISHED 最新版；
  发布响应附影响面 impact；workflow 破坏性 inputs 变更 + latest 引用 → `BREAKING_CHANGE_WITH_LATEST_REFS`（force=true 越过，全审计）。

## 6. 可选配置（环境变量，`docker compose up` 前 export 或写 `.env`）

| 变量 | 作用 |
|---|---|
| `ANTHROPIC_API_KEY` | 打通真实 LLM：QOS 意图分类（默认 `claude-haiku-4-5`）、探索 Agent / 文档抽取 / 建模建议（默认 `claude-opus-4-8`）。**不配置时**：求解器/对象查询/规则等全部可用，但查询对话的分类与探索回答、A2/A3 的 LLM 抽取会失败报错（界面有明确错误提示） |
| OpenAI 兼容 LLM | 登录后在 `/admin/`（意图目录-模型供应商）经 `POST /b/v1/llm/providers` 配置 `openai_compatible`（baseUrl + credential，凭据 AES-GCM 加密存储不回显），再用 `PUT /b/v1/llm/bindings` 把 classifier/agent 角色绑到该供应商；DataCore 侧用 `DC_LLM_PROVIDER=openai_compatible` + `DC_LLM_BASE_URL` + `DC_LLM_API_KEY_ENV` |
| `EMBEDDING_PROVIDER` | 默认 `pseudo`（确定性哈希向量，零依赖可演示）。配 `openai_compatible` + `EMBEDDING_BASE_URL` + `EMBEDDING_MODEL`（及对应 key 环境变量 `EMBEDDING_API_KEY_ENV`）启用真实向量；postgres-a 用 pgvector 镜像，扩展可用时知识库走原生向量索引，不可用时自动回退 JSONB + 应用侧余弦 |
| `SEED_DEMO` | 置 `0` 关闭演示数据播种（空系统冷启动 —— 此时必须配置 BOOTSTRAP 变量，否则 `/readyz` 503） |
| `SEED_LIVED_IN` | compose 默认 `1`：demo 播种后跑 **livedIn 合成**（标准合成 → 回放一年 T−365d→T0），使 **OEE 14 日趋势 / 运营回顾 / `GET /a/v1/history/bundle` 开箱有数据**（否则这些依赖型页因无 livedIn 快照显诚实空态）。置 `0` 关闭（本地 `node dist/server.js` 裸跑默认不设此变量→快启，可 opt-in `SEED_LIVED_IN=1`）。幂等·确定性（R6）。**注**：rule-docs / decisions / evals / quarantine 等子系统的数据需真实运营动作（跑 eval / 抽 rule-doc / 记 decision）才产生，demo 不硬塞样本，保持诚实空态 + 空态引导 |
| `SEED_EMPTY_TENANT` | 置 `1`（dev/demo）建一个**可登录但对象世界全空**的租户 `fresh`（登录 `fresh / admin / demo1234`），用于演示 **G-9「一键长出此卡」onboarding 招牌**（见下方 §6.1）；默认关，不影响生产 |
| `OPTIMIZER_BASE_URL` | 最优化引擎 sidecar 地址（CP-SAT/OR-Tools·`services/optimizer`）。compose 默认 `http://optimizer:4003`（已起 sidecar 服务）。**未配则 `/a/v1/opt/*` 求解器诚实报「未接入最优化引擎」**（区别于功能关闭的 404）。本地裸跑：`PORT=4003 python3 services/optimizer/server.py &` 后 export 此变量 |
| `SEED_OPT_INDUSTRY` | 置 `1`（compose 默认 1）建**非电池行业租户** `logi`（物流仓配·登录 `logi / admin / demo1234`·`opt.*` 已开·空世界），用于演示 **G-12 两行业 R14 真 CP-SAT**（见下方 §6.2） |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | 管理平台增量 §1：空库首启创建平台超管（`default` 租户，角色 `platform_admin`，登录名 = 邮箱）；幂等，表非空跳过 |
| HTTPS | 自备 `decision.local` 证书放 `deploy/certs/`，取消 `deploy/nginx.conf` 末尾 443 server 块与 `docker-compose.yml` 中 gateway 的 443 端口/证书挂载注释，浏览器改走 `https://decision.local` |

### 6.1 G-9「一键长出此卡」onboarding 招牌复现（新租户开箱自助）

验证"**缺件卡 → 自动补 → GOVERNED 活体**"：新租户对象世界全空时，发育闭环经合成正门
（`POST /a/v1/growth/provision-world` → `synthetic.runJob`，FK 一致·R6·SYNTHETIC 可溯·仅入空租户不覆盖真数据）
一次性 provision 确定性起步世界 → 路由归位 → 求解器真投影 → 验证 GOVERNED。

```bash
# datacore 同时播 demo（满世界）与 fresh（空世界，可登录）
SEED_DEMO=1 SEED_EMPTY_TENANT=1 ... node apps/datacore/dist/server.js
```

1. 浏览器登录 **`fresh / admin / demo1234`**（顶栏显「新租户 fresh·空世界开箱」；此时对象库为空）。
2. 进 `/admin/scenes`（场景入口配置）→ 任一卡点 **「一键长出此卡」**。
3. 观察：徽章转 **「已验证·可用」**；发育留痕显「触发自动补齐（CONVERGED）· **经合成正门 provision N 对象起步世界（SYNTHETIC·可溯）**」+ 真答案预览（带 `⟦ref⟧` 溯源）。
   - 实拍证据：`docs/evidence/g9-grow-empty-tenant-fde.png`、口径与多根诊断见 `docs/evidence/g9-autofill-governed-fde.md`。

### 6.2 G-12 两行业 R14 真 CP-SAT 复现（非电池行业 + 优化融合活系统通电）

验证"**≥1 非电池行业租户全链立起来 + 真 CP-SAT 出最优 + optimize_whatif 出 Δ目标**"（同一 `facility_location`
抽象模板对电池/物流两行业**代码零改仅 OntologyBinding 不同**各出不同最优·R14 去行业锁死）：

```bash
# ① 起真 CP-SAT sidecar（compose 已含 optimizer 服务；裸跑如下）
PORT=4003 python3 services/optimizer/server.py &
# ② datacore 接 sidecar + 建非电池 logi 租户
SEED_DEMO=1 SEED_OPT_INDUSTRY=1 OPTIMIZER_BASE_URL=http://127.0.0.1:4003 ... node apps/datacore/dist/server.js
```

1. 登录 **`logi / admin / demo1234`**（物流仓配·非电池行业·`opt.*` 已开）。
2. `POST /a/v1/growth/provision-world` → `synthetic.runJob` 经**内置确定性物流模板**（`synthetic/logistics.ts`·无 LLM·R6）
   真物化 Warehouse/Store 世界（S 档 16 对象）。
3. `POST /a/v1/opt/solve {family:facility_location, binding:{facility=Warehouse,client=Store,open_cost=Warehouse.openCost,assign_cost=Warehouse.serveCost}}`
   → **status:OPTIMAL**（真 CP-SAT）；对照 demo 电池租户同模板绑 Base/DemandSegment 各出不同最优。
4. `POST /a/v1/opt/whatif {perturbations:[{kind:data_override,target:"facilities.WH-002.openCost",value:9999}]}` → **Δ目标≠0**（真 sidecar 双解）。
   - 全链 FDE 证据与逐条 curl：`docs/evidence/G12-opt-fusion-lastmile-fde.md`（复跑脚本 `docs/evidence/G12-opt-fde.sh`）。
4. **诚实边界**：仅对空/新租户自动合成确定性 starter 世界；**真实业务数据缺口（HARD）走真人正门导入**，不自动合成真数据；非空租户 `provision-world` 拒执行。

## 7. 故障排查

| 现象 | 处理 |
|---|---|
| 80 端口被占用 | `docker compose up` 前停掉本机 nginx/IIS，或把 `gateway.ports` 改成 `"8080:80"` 后访问 `http://decision.local:8080` |
| `pgvector/pgvector:pg15` 拉取失败 | 网络受限时换镜像源，或临时把 `postgres-a.image` 改为 `postgres:15-alpine`（知识库自动回退 JSONB 向量，功能不缺失，仅检索走应用侧余弦） |
| datacore 一直 unhealthy | 首启播种 90 天时序需要 1–2 分钟（healthcheck 已留 120s start_period）；`docker compose logs datacore` 看是否在等 postgres-a |
| 内存不足 / OOM | 确保 Docker 可用内存 ≥ 4 GB（Docker Desktop → Settings → Resources）；或先 `SEED_DEMO=0` 启动再在 /admin/synthetic 里手动生成 S 规模数据 |
| 登录 401 | 确认租户填 `demo`；改过库后想重置：`docker compose down -v` 清卷重来 |
| 查询对话报模型错误 | 未配置 `ANTHROPIC_API_KEY`（见 §6）；其余模块不受影响 |
| 改了代码不生效 | `docker compose up --build` 强制重建镜像 |
| 恢复失败（restore-pg.sh 报错） | ① scratch 端口占用 → 换 `SCRATCH_PORT=5435`（或清残留：`docker ps -a --filter name=dr-restore-scratch -q \| xargs -r docker rm -f`）；② 恢复到生产库需 `--target datacore\|agentcore` 并输入 `YES` 二次确认；③ 备份系另一 pg 主版本 → 用同版本 `SCRATCH_IMAGE=postgres:16` 恢复 |

## 8. 数据持久化与重置

数据库、MinIO、上传 blob 均在命名卷（`pgdata-a`/`pgdata-b`/`minio-data`/`blob-data`）。完全重置：

```bash
docker compose down -v && docker compose up --build
```

> §8 是**卷级**重置（清空全部数据）。§8 的命名卷是"活数据"，不是备份——真正的灾备（可回滚到某个时间点、可换机重建）见 §9。

## 9. 灾备与备份（WO-ENTERPRISE-DR-AUDIT）

平台两库（`postgres-a`=datacore / `postgres-b`=agentcore）的应用级逻辑备份 + 恢复演练 + 外部审计对接。脚本纯 bash，无新依赖。

### 9.1 定时逻辑备份

对两库各跑一次 `pg_dump | gzip`，产出宿主机 `<name>-<ts>.sql.gz`：

```bash
bash scripts/backup-pg.sh --out ./backups --keep 14
#   --out DIR   备份目录（默认 ./backups）
#   --keep N    每库保留最近 N 份，删更旧（默认 0=不删）
# 产出：backups/datacore-<ts>.sql.gz + backups/agentcore-<ts>.sql.gz（可 ls 见·gzip 头正确）
```

生产建议 cron（每日 02:30，保留 14 份）：
```cron
30 2 * * *  cd /opt/platform && bash scripts/backup-pg.sh --out /backup/pg --keep 14 >> /var/log/pg-backup.log 2>&1
```
把 `/backup/pg` 同步到异地对象存储（rsync/rclone）以防单机损毁。**逻辑备份 = 时间点快照·非连续 PITR**（连续恢复见 §9.3）。

### 9.2 恢复演练（导得回·行数核对）

把某份备份导入一个**一次性 scratch pg 容器**（默认·不碰生产），导入后打印核对表行数供人核对"导得回"：

```bash
bash scripts/restore-pg.sh ./backups/datacore-<ts>.sql.gz            # 默认 --target scratch
#   打印 scratch 库 audit_log / outbox_events 行数 → 应与源库同表 count 一致
#   scratch 容器 --rm 自动销毁；SCRATCH_PORT 默认 5433（占用则 SCRATCH_PORT=5435 …）
```

恢复到生产库（**危险·覆盖现有数据·需输入 YES 二次确认**）：
```bash
bash scripts/restore-pg.sh ./backups/datacore-<ts>.sql.gz --target datacore
bash scripts/restore-pg.sh ./backups/agentcore-<ts>.sql.gz --target agentcore
```
**恢复演练是灾备有效性的唯一凭证**——只备份不演练 = 未知能否恢复。建议每月跑一次 scratch 恢复 + 行数核对。

### 9.3 PITR 升级路径（当前 compose **未配**·诚实标注·R13）

§9.1 逻辑备份只能恢复到"上次 dump 的时间点"。要连续时间点恢复（PITR·丢数窗口趋近 0），需开启 pg **WAL 归档**——**当前 `docker-compose.yml` 未启用**，需运维按下述样例开启方得连续恢复（本单不改默认 `up`，避免影响开箱体验）：

```yaml
# docker-compose.yml · postgres-a（datacore）示例增量（postgres-b 同理）
  postgres-a:
    image: pgvector/pgvector:pg15
    command:
      - postgres
      - -c
      - wal_level=replica
      - -c
      - archive_mode=on
      - -c
      - archive_command=test ! -f /wal-archive/%f && cp %p /wal-archive/%f   # 归档到独立卷
    volumes:
      - pgdata-a:/var/lib/postgresql/data
      - wal-archive-a:/wal-archive                                            # 独立 WAL 归档卷
# volumes: 追加 wal-archive-a: / wal-archive-b:
```
配套需：① 定期 `pg_basebackup` 取基准备份；② 归档卷异地同步；③ 恢复时 `restore_command` + `recovery_target_time`。开启后 §9.1 逻辑备份仍保留（两者互补：逻辑备份便携·WAL 归档连续）。

### 9.4 外部审计对接（SIEM sink·审计证据外流）

审计日志（append-only `audit_log`·统一 `AuditService.record` 单一写路径）既留本地、又可外送到外部 SIEM/审计系统。功能暗发（feature `audit-sink` 默认关·关=404 `FEATURE_NOT_FOUND`）；secret **AES-GCM 加密落库·响应仅回 credentialRef·绝不回显明文**。

```bash
# 开功能（tenant admin）
curl -XPUT :4001/a/v1/tenants/<t>/features -H "$AUTH" -d '{"overrides":{"audit-sink":true}}'
# 配 webhook_ndjson sink（endpoint + 可选出站 secret，作 Authorization: Bearer）
curl -XPUT :4001/a/v1/audit-sinks -H "$AUTH" \
  -d '{"kind":"webhook_ndjson","endpoint":"https://siem.example/ingest","secret":"<token>"}'
# 手动触发一次增量推送（常态由调度 AUDIT_SINK_FLUSH 每 5 分钟自动跑）
curl -XPOST :4001/a/v1/audit-sinks/flush -H "$AUTH"    # → {"delivered":N,"ok":true}
```

行为：以游标 `sinceAt` 从 `audit_log` 取增量 → 组 NDJSON（每行一条审计条目·actor+target+before/after+requestId 齐）→ POST endpoint → 成功前推游标。**投递失败旁路吞·不阻断主写路径**（本地 append-only 不受影响·下次续投·至少一次外送）。SIEM 端可按 `x-request-id` 与两系统日志对账。

## 本地 dev 模式的目录可移植性（v0.7）

本地 `pnpm --filter frontend-shell dev` 已对"从其他目录复制/迁移而来"免疫：
- `vite.config.ts` 的 `server.fs.allow` 显式放行整个 monorepo 工作区根（`@platform/contracts` 必可解析）；
- `optimizeDeps.exclude: ["@platform/contracts"]` 使工作区源包不进 `.vite` 预打包缓存，根除"缓存存绝对路径、复制目录后陈旧导致 React 实例为 null / useContext 崩"这一类故障；
- `dev` 脚本为 `vite --force`，每次冷启动重建依赖缓存。
docker 部署路径（`docker compose up --build`）本就是干净 `pnpm install` + `vite build`，不受此影响。

## 锂电企业工业级环境一键配置（provision-enterprise）

`scripts/provision-enterprise.mjs` 以**操作员账号登录后经 REST API 配置**（非硬编码 IPO）站起完整工业级环境：

- **10 数据域**（factory/product/process/equip/quality/capacity/forecast/people/plan/finance + unassigned）+ 跨 ≥5 域本体类型与链接（切片检索可跨域）；
- **工业级数据**（XL 档）：10⁴ 订单 + 2000 物料批次 + 3000 采购单 + 60 客户 + 90 天时序，全部经 A9「一键合成」正门生成，每条带 `origin`/引用，可增删改查；
- **21 求解器 + 15 约束（C01–C33）+ 20 skills（结构 lint 门禁）+ 10 场景 agent + 10 场景入口 + 评测用例 + MCP 集成位（预留对接）**；
- **两个仿真**：受影响订单推演（常州，命中真实订单数，可下钻溯源）+ 规划体检（评分/结论/硬矛盾），跑在工业级数据上、支持二次推演。

```bash
# A) 本地验证（自起内存双服务，跑完打印配置清单，不持久化）
pnpm provision:enterprise

# B) 对已部署实例配置（持久化到 PG —— 部署重启后依旧可见；这是"装进安装包"的方式）
#    前提：docker compose up 起好（datacore 连 DATABASE_URL），下面指向网关/服务地址
PROVISION_TARGET=1 DATACORE_URL=http://localhost:4001 AGENTCORE_URL=http://localhost:4002 \
  node scripts/provision-enterprise.mjs --remote
```

**持久化说明**：B 模式下所有写入经 DataCore/AgentCore 落 **PostgreSQL**（对象/本体/规则/skill/agent/场景/评测），属"系统状态"，随卷持久、部署重启后可见；脚本幂等，可反复运行（同 seed 合成字节级一致）。数据导入当前走 Excel 模板上传（`/a/v1/uploads`）+ 合成正门，并预留连接器 API 对接（mock_erp/mock_crm/rest_api → 替换为生产连接器即可）。
