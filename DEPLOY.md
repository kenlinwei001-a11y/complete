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
| `OPTIMIZER_BASE_URL` | 最优化引擎 sidecar 地址（CP-SAT·组合最优化族 + `optimize_whatif` Δ目标推演）。**compose 态已自动接**（`docker-compose.yml` `${OPTIMIZER_BASE_URL:-http://optimizer:4003}`）。**本地内存模式 dev 默认不设** → 5 个 CP-SAT 核心 + `optimize_whatif` 显式返「未接入最优化引擎」（诚实兜底·不静默）；本地要用见下方「§6.x 本地起 sidecar」 |
| `SEED_DEMO` | 置 `0` 关闭演示数据播种（空系统冷启动 —— 此时必须配置 BOOTSTRAP 变量，否则 `/readyz` 503） |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | 管理平台增量 §1：空库首启创建平台超管（`default` 租户，角色 `platform_admin`，登录名 = 邮箱）；幂等，表非空跳过 |
| HTTPS | 自备 `decision.local` 证书放 `deploy/certs/`，取消 `deploy/nginx.conf` 末尾 443 server 块与 `docker-compose.yml` 中 gateway 的 443 端口/证书挂载注释，浏览器改走 `https://decision.local` |

## 6.x 本地 dev 起最优化 sidecar（CP-SAT·可选）

CLAUDE.md 的本地内存双服务命令**不含** `OPTIMIZER_BASE_URL` → `optimize_whatif`（优化推演页 `/v/optimize-whatif`）与 5 个
CP-SAT 核心（facility_location / min_cost_flow / set_cover / independent_set / combinatorial_auction）会显式返
「未接入最优化引擎」（诚实兜底·前端页显提示不假渲 Δ）。本地要真解，三行起 sidecar 再给 datacore 加一个 env：

```bash
# ① 起 CP-SAT sidecar（本地·services/optimizer·需 python3 + pip）
cd services/optimizer && pip install -r requirements.txt && PORT=4003 python3 server.py &
#   健康检查：curl http://127.0.0.1:4003/healthz  →  {"status":"ok","engine":"cp-sat"}

# ② datacore 本地命令追加 OPTIMIZER_BASE_URL 即真接入（其余 env 见 CLAUDE.md 内存模式命令）
OPTIMIZER_BASE_URL=http://127.0.0.1:4003 \
  PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> \
  node apps/datacore/dist/server.js

# ③ 验证 Δ 真变（改约束→重解→Δ 变·CP-SAT 真解·非 mock）
curl -s -X POST http://127.0.0.1:4001/a/v1/solvers/optimize_whatif/invoke \
  -H 'content-type: application/json' -H 'x-debug-user: demo:admin:admin' \
  -d '{"args":{"family":"facility_location","args":{...},"perturbations":[{"kind":"cost","target":"f1","delta":50}],"seed":42}}'
#   改 perturbations.delta（如 50→600）重跑 → deltaObjective / feasible / conflictConstraints 随之真变。
```

> compose 态（`docker compose up`）已自动接：`docker-compose.yml` 有 `optimizer` 服务（build `services/optimizer` ·
> expose 4003 · healthcheck）+ `OPTIMIZER_BASE_URL` 默认值 + datacore `depends_on optimizer(service_healthy)`——
> 整套里 5 CP-SAT 核心 + `optimize_whatif` 是真接入、真解的，无需手动起 sidecar。

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

## 8. 数据持久化与重置

数据库、MinIO、上传 blob 均在命名卷（`pgdata-a`/`pgdata-b`/`minio-data`/`blob-data`）。完全重置：

```bash
docker compose down -v && docker compose up --build
```

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
