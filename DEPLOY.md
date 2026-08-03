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

### 2.0 部署分支（先看这一条 · WO-INTEGRATION-LOOP 收口）

> ⛔ **本节存在的理由 = 一次真实故障**：本文档此前只写 `git clone <仓库地址>`，没有任何分支说明。
> 照做即 clone 默认分支，而当时默认分支**落后集成分支 919 个提交**——部署方与 Codespaces
> 拿到的都是死分支，「拉不到最新代码」的根因在此，不在网络也不在缓存。

| 分支 | 角色 | 谁该用 |
|---|---|---|
| `main` | **发布分支**：只接收跑通完整门禁（`scripts/gate.sh` + `pnpm gates` + 并线台账门）的代码 | **部署方、Codespaces、部署 agent 一律用它** |
| `claude/inspiring-gates-aqczjg` | 集成分支：handoff 经复验后并入此处，门禁全绿后同步到 `main` | 开发/审核方 |
| `claude/handoff-*` | 单工单交付分支，未复验 | 只用于 PR 复验，**不要部署** |

```bash
# 首次部署
git clone -b main <仓库地址> && cd <仓库目录>
docker compose up -d --build       # 首次构建约几分钟
```

```bash
# 更新到最新（部署方 / Codespaces / 部署 agent 的**唯一**刷新命令）
git fetch origin main
git checkout main && git pull --ff-only origin main
docker compose up -d --build       # compose 自动停旧容器→换新镜像→起新容器，无需手动 kill 进程
docker compose ps                  # 全部 healthy 即完成
```

> `--ff-only` 是刻意的：若它失败，说明本地有偏离发布分支的改动，**应当停下来查**，
> 而不是让 merge 悄悄产生一个只存在于部署机上的版本（那正是「线上和仓库对不上」的来源）。
>
> `/readyz` 在 `SEED_DEMO=1` 预热期间返回 **503 是正常的**（正在生成合成数据集），
> 日志出现 `datacore 预热完成 · /readyz ready` 后转 200。别把预热 503 当成部署失败。

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
| 项目推演 project-sim | S1 `capacity_forecast` 求解器（P50/P90 产能、What-if 调参，`POST /b/v1/solvers/{key}/run`） |
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
| `OPTIMIZER_BASE_URL` | 最优化引擎 sidecar 地址（CP-SAT·组合最优化族 + `optimize_whatif` Δ目标推演）。**compose 态已自动接**（`docker-compose.yml` `${OPTIMIZER_BASE_URL:-http://optimizer:4003}`）。**源码/内存模式默认不设** → **整个组合最优化族**（`portfolio` 全局联合推演、`cross_object_occupancy` 多目标+跨对象占用、`selection`/`assignment`/`sequencing`/`packing`/`job_shop_schedule`、5 个 CP-SAT 核心、`optimize_whatif`）显式返「未接入最优化引擎」400（诚实兜底·不静默）。**后果：前端「全局联合推演」「项目推演·多目标」「优化推演」等面板结果区全空/红字"求解失败"——非 bug，是没起引擎。要用这些面板见 §6.x（必起）** |
| `SEED_DEMO` | 置 `0` 关闭演示数据播种（空系统冷启动 —— 此时必须配置 BOOTSTRAP 变量，否则 `/readyz` 503） |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | 管理平台增量 §1：空库首启创建平台超管（`default` 租户，角色 `platform_admin`，登录名 = 邮箱）；幂等，表非空跳过 |
| **Loop Control 五开关**（`QOS_AGENT_MAX_ROUND_TRIPS` / `MAX_DISCOVER_CALLS` / `LOOP_REPEAT_CAP` / `PER_TOOL_CALL_CAP` / `RETRY_MAX_ATTEMPTS`） | AgentCore 执行治理层。**代码态是 opt-in（缺省不设 = 不限）**，但 **compose 出货已默认设为 `4 / 1 / 3 / 8 / 1`**（`docker-compose.yml` agentcore·`${VAR:-建议值}` 形态，可用 `.env` 覆写放宽）。分别管：轮次上界 / 盲扫（discover·search_experience·query_system_ontology）配额 / 同参重复环检测 / 同工具异参刷屏上界 / 瞬时错有界重试。超任一 → 优雅降级 `BUDGET_EXHAUSTED`·`STALL_LOOP`（诚实部分发现，不静默）。**曾经的坑（#88）**：这五个只写在代码注释的「部署态建议」里，出货 compose 一个都没设 → 容器只带第一层治理（超时），其余全是死开关；现由 `scripts/check-deploy-governance.mjs` 守门（删行即红） |
| HTTPS | 自备 `decision.local` 证书放 `deploy/certs/`，取消 `deploy/nginx.conf` 末尾 443 server 块与 `docker-compose.yml` 中 gateway 的 443 端口/证书挂载注释，浏览器改走 `https://decision.local` |

## 6.y 部署态验证 checklist（Phase4 硬预算 / dark-feature / live 叙述 —— 沙箱证不了、部署时坐实）

以下三项机制**已在代码态由单测/SEAM 坐实**，但真 live 值（真 LLM 时延、真租户 resolve）**只能在真部署环境验**（无真 provider 的沙箱不编造）：

1. **QOS 硬预算真收紧（对照 137s 基线）** —— compose 出货已默认设 `QOS_AGENT_MAX_ROUND_TRIPS=4` + `QOS_AGENT_MAX_DISCOVER_CALLS=1`（见 §6 表；起容器后用 `docker compose config | grep QOS_AGENT` 复核实际生效值）。验：跑一道「有对口确定性 solver」的复杂问句（如「储能份额没达标，逐层拆根因」），墙钟应从 free-LLM 盲选的 ~137s 降到确定性 path-A 秒级；path-B 自由深问题 round-trip ≤4 触顶即 `BUDGET_EXHAUSTED` 优雅降级。**该预算同样作用于 coordinator 每个子 agent / 角色 agent / 场景 path**（WO-Phase4 §6·`computeResidualBudget` 统一注入 5 处 BudgetTracker）。
2. **dark-feature 部署态默认关** —— `scripts/provision-enterprise.mjs` 建 `industry:"battery-manufacturing"` 租户后，验该租户 resolved features **不含** `QOS_DARK_LAUNCH_FEATURES` 排除项（`apps/datacore/src/features.ts` 从 battery all-on 模板剔除）。代码态 `dark-feature-default-off.test.ts` 已锁 `resolve("demo")` 两项 false；部署态用真 provision 建租户后复核 `GET /a/v1/features/registry` 的 resolved 结果。
3. **live 叙述真跑（§3.2 多方案权衡综合）** —— 推演类 NL 问句的一次 `llm.compose` 综合需真 LLM provider。**无 provider 时走确定性兜底 `deterministicSynthesis`（诚实·不假装 LLM），非缺陷**；要真 live 叙述，经 `/admin/`（意图目录-模型供应商）配真 provider（凭据 AES-GCM 加密存储不回显·见 §5.x），把 `agent` 角色绑上去即可。

> 诚实边界（KILL-MOCK-RED）：以上 live 数字（60s / round-trip / 真 resolve）沙箱无真 provider 证不了 → 机制单测坐实、live 值留部署态复核，不编造。

## 6.x 起最优化引擎 sidecar（CP-SAT·组合最优化推演必需·源码模式不用 Docker）

> **源码/内存模式部署必读**：CLAUDE.md 的本地内存双服务命令**不含** `OPTIMIZER_BASE_URL`。不设时，整个**组合最优化求解器族**——
> `portfolio`（全局联合推演）/ `cross_object_occupancy`（多目标+跨对象占用）/ `selection` / `assignment` / `sequencing` /
> `packing` / `job_shop_schedule` / `optimize_whatif`（优化推演页 `/v/optimize-whatif`）+ 5 个 CP-SAT 核心
> （facility_location / min_cost_flow / set_cover / independent_set / combinatorial_auction）——全部显式返
> 「未接入最优化引擎」400。**后果：前端「全局联合推演视图」「项目推演·多目标+跨对象占用」「优化推演」等面板结果区全空 /
> 红字"求解失败"——这不是 bug，是没起引擎。** 要用这些推演面板，此 sidecar **必起（非可选）**。sidecar 是纯 Python 进程、
> 唯一依赖 `ortools`、**不需要 Docker**。三行起 sidecar 再给 datacore 加一个 env：

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

# ③-bis 冒烟验证 portfolio（全局联合推演·本文档作者已亲手真跑：OK OPTIMAL 方案3 分配147 被挤12 守恒True）
curl -s -X POST http://127.0.0.1:4001/a/v1/solvers/portfolio/invoke \
  -H 'content-type: application/json' -H 'x-debug-user: demo:admin:admin|planner|catalog_admin' \
  -d '{"args":{"scenarios":["max_ontime","min_cost","min_changeover"]}}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('OK',d['status'],'方案',len(d['scenarios']),'分配',len(d['allocation']),'被挤',len(d['displaced']),'守恒',d['reconciled'])"
#   期望：OK OPTIMAL 方案 3 分配 147 被挤 12 守恒 True → 前端「全局联合推演」方案对比矩阵/分配台账/被挤单卡/守恒台账满渲。
```

> **源码模式生产守护**：`python3 server.py` 用 `nohup …&` 或 systemd/pm2/supervisor 守护（sidecar 无状态、无业务数据落盘、
> 仅本机可达、R6 确定性同输入同解）。容器化则用 `docker-compose.yml` 的 `optimizer` 服务，无需手动起。

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
| **只重建了前端 → 后端改动不生效（假 bug 制造机）** | 改动落在 `datacore`/`agentcore` 时，只 `docker compose build frontend` 或不带 `--build` 的 `up -d` 会**继续跑旧后端镜像**。症状极具迷惑性：求解器新参数报「unknown key」、时序推演全灰/全平、根因树「暂不可用」、新点亮的功能开关查无此项——**看着像功能没做，实为后端是旧的**。正解：`docker compose build --no-cache datacore agentcore frontend && docker compose up -d`。诊断口诀：**先确认后端是新的，再判断功能有没有 bug**（本项目已因此误诊过多次） |
| **租户功能开关改了却不生效** | PG 卷持久化了租户 override：重建镜像**不会**重置已落库的开关。`PUT /a/v1/tenants/:id/features` 是**整体替换**（非合并），须一次性提交全部开关键，漏传的会被清空；或 `docker compose down -v` 清卷让 `SEED_DEMO` 重新播种 |
| **前端能开、B 系统功能却静默失灵**（对话/QOS 问了没反应、SSE 不流、Agent 无响应） | **前端 `VITE_AGENTCORE_URL` 与 agentcore 实际监听端口不一致**。本项目真实踩过：LaunchAgent plist 配 `PORT=4005`，而前端按文档用了 `4002` → 前端连不上 B 系统，**且不报醒目错误**，极易误判为"功能没做"。诊断：浏览器 Network 看请求打到哪个端口、是否 ERR_CONNECTION_REFUSED；`curl localhost:<两个端口>/healthz` 对比。正解：两边取同一值（改 plist 的 `PORT`，或前端起服时 `VITE_AGENTCORE_URL` 指向实际端口）。**改端口后前端必须重启**（Vite env 在启动时注入，HMR 不会更新它） |
| **拉了新代码、前端却仍显示旧行为**（如因素 chip 还是「设备OEE 76」而非「张力76/100」；矩阵列头无量纲） | 改动落在 `packages/contracts` 时，**Vite 会预打包 workspace 依赖**到 `apps/frontend-shell/node_modules/.vite`，contracts 重新 build 后旧预打包可能仍被复用 → 前端拿到旧契约。「源码改动走 HMR 生效」只对**应用源码**成立，对**被重建的依赖包不成立**。正解：`rm -rf apps/frontend-shell/node_modules/.vite` 后重启 dev server |
| GitHub 上 agent 提交显示 **Unverified** | 本远程环境的 commit 签名密钥 `/home/claude/.ssh/commit_signing_key.pub` 为 **0 字节空文件**（签名 helper `/tmp/code-sign` 本身可用，缺的是密钥内容），故所有 agent 提交均未签名——**本仓 2400+ 个 agent commit 自建仓起一直如此，非新退化**。`git commit --amend --reset-author` 只改 author/committer，**修不了签名**，勿反复 rebase 空转。影响面**仅限 GitHub 那枚 Verified 徽章**，不影响代码、CI、合并。需要 Verified 时：在 **GitHub 网页做 squash merge**（网页产生的 commit 由 GitHub 签名 → Verified）。根治需环境侧下发有效签名密钥（Anthropic 侧配置，可经 `/bug` 反馈） |

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
