# WO-DEPLOY-LOCAL · 本机内存模式部署（双服务 + 前端）

> 转发给部署 dev 用。**目标**：不装数据库，在本机把 DataCore + AgentCore + 前端三件跑起来，能登录、能点到各模块。
> 内存模式 = 进程内仓储，**重启即清空**；用来验「跑不跑得起来 / 界面对不对」，不用来存数据。

---

## 0 · 环境前置（跳过必踩，今日已有 5 个 dev 中招）

```bash
# Node ≥ 20，pnpm
node -v && pnpm -v

git fetch origin
git checkout claude/inspiring-gates-aqczjg
git pull origin claude/inspiring-gates-aqczjg

pnpm install
pnpm -r build          # ⚠️ 必须全量 build，不能只 build 一个包
```

**为什么强调全量 build**：本仓是 workspace，`@platform/contracts` 与 `@platform/llm-adapters` 是源码依赖。
少 build 任何一个，启动时会报

```
Failed to resolve entry for package "@platform/contracts"
```

这类错**看起来像契约包坏了，其实只是没构建**。今天有 5 个 dev 各自被它骗过一次。
**判据**：build 完先确认四个产物目录都在，`build` 返回 0 但没产物是另一种坏法：

```bash
for d in packages/contracts/dist packages/llm-adapters/dist apps/datacore/dist apps/agentcore/dist; do
  [ -d "$d" ] && echo "✓ $d" || echo "✗ $d 缺失 —— build 报 0 但没产物，别往下走"
done
```

---

## 1 · 起 DataCore（System A · 端口 4001）

```bash
PORT=4001 \
JWT_SECRET=dev \
BLOB_DIR=/tmp/blobs \
SEED_DEMO=1 \
CREDENTIAL_KEY=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f \
SERVICE_TOKEN=dev-service-token \
AGENTCORE_BASE_URL=http://127.0.0.1:4002 \
node apps/datacore/dist/server.js
```

- **不设 `DATABASE_URL` 就是内存模式**（设了会自动切 pg 并跑迁移）。
- `SEED_DEMO=1` 是关键：不设就没有演示租户，登录进去是空的。
- `CREDENTIAL_KEY` 上面这个值就是仓里的默认值，本机随便用；**别拿它上任何真环境**。

**健康检查**（另开一个终端）：

```bash
curl -s localhost:4001/healthz && echo
curl -s localhost:4001/readyz  && echo
```

## 2 · 起 AgentCore（System B · 端口 4002）

```bash
PORT=4002 \
DATACORE_BASE_URL=http://127.0.0.1:4001 \
SERVICE_TOKEN=dev-service-token \
node apps/agentcore/dist/main.js
```

```bash
curl -s localhost:4002/healthz && echo
```

### ⚠️ `SERVICE_TOKEN` 两侧必须**同值**（这条是今天新增的，旧文档没有）

今天并入了一版安全收口，行为**变了**：

| 端点 | 今天之前 | 今天之后 |
|---|---|---|
| `/metrics` | 公开可读 | **仅服务间**（`SERVICE_TOKEN`）· fail-closed |
| `/b/v1/internal/invalidate` | 匿名可调 | **需 `SERVICE_TOKEN`** |

**fail-closed 的含义**：`SERVICE_TOKEN` 没配 ⇒ 这两个端点**恒 403**，不是"退化成公开"。

不配会怎样：服务不会崩，但 **B 对 A 的资源缓存失效钩子失灵** ——
改了规则/本体后，B 侧要等 **缓存 TTL 60 秒**自然过期才看到新值，而不是即时生效。
排查时容易读成"改了没生效 / 数据不对"，实际是缓存没被通知。
**所以两个进程必须传同一个 `SERVICE_TOKEN` 值**，随便什么字符串都行，一致即可。

## 3 · 起前端

前端有**两种模式**，别混：

### (a) 真连双后端（推荐，验的是真链路）
```bash
VITE_DATACORE_URL=http://127.0.0.1:4001 \
VITE_AGENTCORE_URL=http://127.0.0.1:4002 \
pnpm --filter frontend-shell dev
```

### (b) 纯 mock，不需要后端（只看界面）
```bash
VITE_MOCK=1 pnpm --filter frontend-shell dev
```

> ⚠️ **(b) 的结果不能用来下"功能通了"的结论。** 本仓有一整类记录在案的坑叫
> 「mock 声称提供、真后端并不提供（或方向相反）」—— 前端在 mock 上跑得通、前端测试全绿
> （因为测试跑的就是同一份 mock），一接真后端就崩。**验收一律用 (a)。**

---

## 4 · 登录

浏览器开 Vite 打印的地址（默认 `http://localhost:5173`）。

| 租户 | 账号 | 密码 | 角色 |
|---|---|---|---|
| `demo` | `admin` | `demo1234` | admin + planner + catalog_admin |
| `demo` | `planner` | `demo1234` | planner |
| `demo` | `base_manager:常州` | `demo1234` | 基地经理（行级过滤，只看常州） |

**三个账号都要登一遍** —— workspace 按角色返回**不同的导航/视图/主题**，只登 admin 看不出权限分层对不对。
`base_manager:常州` 尤其要看：它验的是 A6 行级过滤，登进去若能看到别的基地的数据，就是真 bug。

---

## 5 · 交回什么

按这个顺序报，**每条带证据**（命令输出 / 截图 / 报错原文）：

1. **三个进程分别起没起来** —— 贴 `/healthz` 与 `/readyz` 的真实返回，不要只说"起来了"。
2. **三个账号分别登进去看到什么** —— 导航项列表 + 落地页截图。三份都要。
3. **点得开 / 点不开的模块清单** —— 点不开的贴**浏览器控制台原文**与**服务端日志原文**，
   别复述成"报错了"。方向要分清：`404 FEATURE_NOT_FOUND` 是**功能未开通**（entitlement），
   不是崩溃；`500` 才是真炸。这两个的修法完全不同。
4. **`base_manager:常州` 有没有看到非常州的数据** —— 有 ⇒ 立刻报，这是行级隔离被击穿。
5. 起不来时**先自证环境**再报 bug：`node -v` · 四个 dist 在不在 · 端口有没有被占
   （`lsof -i :4001 -i :4002`）。**「我这跑不起来」和「它坏了」是两个不同的命题**，
   报之前先排除前者。

---

## 6 · 已知的、不用报的

- 内存模式**重启即清空**，数据不持久 —— 这是设计如此，不是 bug。
- 前端 `pnpm dev` 首次启动慢（Vite 预构建依赖），等它打完 `ready in` 那行。
- 控制台可能有 SSE 重连日志 —— 只要查询能出结果就正常。
