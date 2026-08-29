# AUDIT · `/metrics` 鉴权与租户隔离（欠账 #65）

> ## ⚠️ 过期横幅（收编时加·2026-08-13）
> - **基线 sha**：`c7b9206e` — **canonical 已在其后 262 个提交**。
> - **本次有没有重跑**：**没有**（本文性质即「只读 + 写文档」）⇒ 改做**抽查 3 个 `file:line` 锚点回代码核对**。
> - **抽查结论（3 命中 / 1 漂移 ⇒ 核心判定仍成立）**：
>   | 文中锚点 | 收编日实测 | 判 |
>   |---|---|---|
>   | `apps/datacore/src/actions.ts:511` `submit(ctx: AuthCtx, draftId)` | **:511 逐字命中** | ✅ |
>   | `apps/datacore/src/actions.ts:667` `this.am.approval(...)` | **:667 逐字命中** | ✅ |
>   | `apps/datacore/src/metrics.ts:32-43` `render()` 无差别 dump | **:32 `render(): string {` 命中**，仍无过滤参数 | ✅ |
>   | `apps/agentcore/src/main.ts:21` `new Metrics()` | **:21 逐字命中** | ✅ |
>   | `apps/datacore/src/app.ts:317` `new Metrics()` | 实为 **`app.ts:333`** `const metrics = deps.metrics ?? new Metrics()` | ⚠️ 漂移 +16 |
> - ⇒ **欠账 #65 在收编日仍未闭**（`/metrics` 仍是进程级单例、无租户过滤、`render()` 无参）。
>   本文点名的 `actions.ts` 修点（传 `ctx.tenantId`）行号仍准，可直接据以开工。

- **审计日期**：2026-08-11
- **分支**：`claude/handoff-wo-metrics-audit`（自 canonical `origin/claude/inspiring-gates-aqczjg` @ `c7b9206e` 重开）
- **画像**：轻（只读 + 写本文档）。**未跑** `pnpm -r test` / `-r build` / `gate.sh`。
- **范围边界**：只写本文件；只读 `apps/**` `packages/**` `docs/**`。**未改任何 `apps/**` 生产代码**（安全改动属仓主决策）。

---

## 0 · 结论速览

| # | 账面记录 | 判定 | 一句话 |
|---|---|---|---|
| ① | `/metrics` 未鉴权公开 | **真缺陷 · 完全属实**，且比账面更宽 | 两个服务**各有一个** `/metrics` 均无鉴权；泄露面不止 Action 埋点，**最敏感的是 LLM provider 记录 ID 与模型名** |
| ② | 稳定率指标跨租户混算 | **部分属实**——实质成立，**措辞需推翻** | 混算是真的，但「**聚合端没按 tenantId 分组**」这个说法不成立：**仓内根本没有聚合端**。病在**写入端标签集不含 tenantId**，修法因此不同 |
| ③ | （查证中新发现） | **需仓主知悉** | `/b/v1/internal/invalidate` 同样无鉴权，**且它经网关对外可达**——比 `/metrics` 更容易被摸到（危害较低但暴露面更大） |

> **一句话给仓主**：①③ 是同一类问题的两个实例（无鉴权端点），但**暴露路径不同**——`/metrics` 只在直连 4001/4002 时可达，`/b/v1/internal/invalidate` 在 80 端口就可达。②不是「忘了写一行 groupBy」，而是「标签集设计如此」，改它要先决策基数与隔离的取舍。

---

## 1 · 置顶：查证中新发现的第三项

### `POST /b/v1/internal/invalidate` 无鉴权，且**经网关对外可达**

**证据** `apps/agentcore/src/server.ts:1870-1875`（注释是有意为之，不是遗漏）：

```
  // 引用模式增量 §2.4：内部缓存失效钩子 —— A 的 C-2 webhook 注册表回调此端点
  // （{kind}.updated 事件 → 立即失效 B 侧对 A 资源的缓存；TTL 60s 兜底）。
  // 该操作幂等无害（仅清缓存），不要求鉴权 —— 与 webhook 投递形态（裸 POST JSON）对齐。
  app.post("/b/v1/internal/invalidate", async (req) => {
    const body = (req.body ?? {}) as { event?: string; tenantId?: string; payload?: unknown };
```

**为什么置顶**：它接受 body 里的**任意 `tenantId`**（`server.ts:1878/1883/1891/1897` 逐处 `body.tenantId` 透传给各 `invalidate()`），而 `deploy/nginx.conf:24` 的 `location ~ ^/(b|api)/v1/` **反代整个 `/b/v1/` 前缀**——即 **80 端口直接可达**。相较之下 `/metrics` 不在任何 nginx location 的后端映射里（落到 `location /` → `frontend:80`，拿到的是 SPA 而非指标）。

**危害面**：匿名者可对任意 tenantId 无限次强制清 B 侧对 A 的缓存（llm-providers / features / type-semantics / prompt-templates）→ 每次清完下一请求都要回源 DataCore，构成**放大型缓存击穿**。不泄露数据、不写业务真值。

**定性**：**低危害 · 高暴露**。与①合并处置更省事（同属「无鉴权端点策略」决策）。是否收口请仓主定——注释显示这是**有意设计**，我不擅自推翻。

---

## 2 · ① `/metrics` 未鉴权公开

### 判定：**真缺陷，完全属实**。且账面低估了泄露面。

### 2.1 证据 · DataCore

路由：`apps/datacore/src/app.ts:930`

```
  app.get("/metrics", async (_req, reply) => reply.type("text/plain").send(metrics.render()));
```

鉴权钩子（全仓唯一的 onRequest 钩子）：`apps/datacore/src/app.ts:860-866`

```
848:  const PUBLIC_PATHS = new Set([
851:    "/metrics",                        ← 显式列为公开
...
860:  app.addHook("onRequest", async (req: FastifyRequest, _reply: FastifyReply) => {
863:    if (PUBLIC_PATHS.has(path)) return;      ← 出口 1：/metrics 命中，直接放行
864:    if (!path.startsWith("/a/")) return;     ← 出口 2：即便删掉上面那行，这里照样放行
```

**注意这是双重旁路**：`/metrics` 不以 `/a/` 开头，所以**就算把它从 `PUBLIC_PATHS` 里删掉也依然免鉴权**。只删 `PUBLIC_PATHS` 那一行 = 无效修复。这一点很容易看漏——必须两处一起看。

（`app.ts:864` 这条 `!startsWith("/a/")` 的兜底放行，当前只影响 3 条路由：实测 `app.ts` 共 321 处路由注册，非 `/a/` 的只有 `/healthz`(903) `/readyz`(929) `/metrics`(930)。所以它今天不是活口子，但它是**下一个非 `/a/` 路由上线时的静默陷阱**。）

### 2.2 证据 · AgentCore

路由：`apps/agentcore/src/server.ts:211-214`

```
  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4");
    return deps.metrics.render();
  });
```

AgentCore **没有任何全局钩子**——鉴权是逐路由 `await auth(req)`：

```
$ grep -rn "addHook" apps/agentcore/src --include=*.ts
（零命中 —— 见 §2.3 金丝雀，此处的「零」是可信的）
```

因此 `/metrics` 的 handler 里没有 `auth(req)` ⇒ **没有任何一层会拦**。

### 2.3 金丝雀（否定结论的必附证据）

判据要求的不是「路由定义里没写 auth」，而是「**请求真的走到 handler 之前有没有任何一层会拦**」。所以我不拿 grep 当证据，**拿仓内已有的、真跑过的断言当证据**——同一个测试 harness、同样不带任何 header 的 `inject`，一个返回 401、一个返回 200：

| | 已知**有**鉴权的路由（金丝雀） | `/metrics` |
|---|---|---|
| **DataCore** | `test/authz.test.ts:194-196`<br>`inject({ method:"GET", url:"/a/v1/rules" })` → `expect(res.statusCode).toBe(401)` | `test/action-metrics-endpoint.seam.test.ts:23-24`<br>`inject({ method:"GET", url:"/metrics" })` → `expect(before.statusCode).toBe(200)` |
| **AgentCore** | `test/api.test.ts:40-46`<br>`inject({ url:"/api/v1/queries", headers:{content-type} })` → `expect(noAuth.statusCode).toBe(401)` | `test/api.test.ts:27-28`<br>`inject({ method:"GET", url:"/metrics" })` → `expect(metrics.statusCode).toBe(200)` |

**金丝雀命中**：同方法对已鉴权路由报 401（不是「一律报无鉴权」）⇒ 检测方法没坏，`/metrics` 的 200 是真的。
**且这不是我 grep 出来的推论**——这四条断言都是仓内**已在跑的绿测试**，`/metrics` 无鉴权是被现有测试**正面固化**下来的行为。

### 2.4 逐字段列：无鉴权端点上到底下发了什么

`Metrics.render()`（`datacore/src/metrics.ts:32-43`、`agentcore/src/metrics.ts:155-185`）**无差别 dump 全部序列**，不接受任何过滤参数。注册表是**进程级单例**（`datacore/src/app.ts:317` / `agentcore/src/main.ts:21` 各 `new Metrics()` 一次），**全租户共用一份**。

#### DataCore `/metrics`（`dc_*`）

| 指标 | 标签 | 标签值来自 | 泄露什么 |
|---|---|---|---|
| `dc_llm_calls_total` | `{purpose, provider, model}` | `llmproviders.ts:362-366`，`provider: target.rec.id` | **⚠ 最敏感**：租户 LLM provider **记录 ID**（`newId("llmp")`，`llmproviders.ts:134/183`）+ **模型名** + 用途；`resolveBinding(req.tenantId,…)` 说明这是**租户私有配置** |
| `dc_llm_fallback_total` | `{from, to}` | `llmproviders.ts:385` | 同上两个 provider 记录 ID + **供应商正在故障降级**这一事实 |
| `dc_action_submit_total` | `{action_type, outcome}` | `metrics.ts:100` | 租户的业务动作类型名（中文业务语义，如 `对象数据变更` / `采纳经营方案`）+ 失败分型 |
| `dc_action_approval_total` | `{action_type, outcome}` | `metrics.ts:104` | 审批通过/拒绝/越权被拦的量 |
| `dc_action_execute_total` | `{action_type, outcome}` | `metrics.ts:108` | 执行成功/失败量（= **稳定率的分子分母本体**） |
| `dc_action_execute_attempts_total` | `{action_type, outcome}` | `metrics.ts:112` | 重试次数、执行器异常 vs 有序拒绝 |
| `dc_deprecated_ref_calls_total` | `{kind, key}` | `ontology-governance.ts:242` | **租户本体的类型/链路 key**（业务模型命名） |
| `dc_connector_sync_total` | `{type, outcome}` | `connectors/service.ts:252/277` | 接了哪些外部系统类型 + 同步失败率 |
| `dc_rule_extract_segments_total` | `{status}` | `ruledocs.ts:187` | 规则抽取失败量 |
| `dc_rule_extract_candidates_total` | `{disposition}` | `ruledocs.ts:221/224/353/375` | 规则候选 接受/丢弃/驳回/批准 量 |
| `dc_epoch_approx_reads_total` | — | `ontology.ts:324/382` | 读放大信号 |
| `dc_modeling_suggestion_accept_ratio` | `{}` | `modeling.ts:463` | A3 建模建议采纳率 |
| `dc_synthetic_job_duration_ms` | `{industry}` | `synthetic/service.ts:286` | **租户所属行业** |
| `dc_livedin_replay_ms` | `{scale}` | `synthetic/service.ts:282` | 租户数据规模档位 |

#### AgentCore `/metrics`（`qos_*` / `ac_*`，清单见 `agentcore/src/metrics.ts:79-142`）

| 指标 | 标签 | 泄露什么 |
|---|---|---|
| `qos_llm_tokens_total` | `{model, direction, provider}` | **⚠ 最敏感**：provider 记录 ID（`llm/providers.ts:95/97` `providerLabel: provider.id`）+ 模型名 + **token 消耗量**（≈ 业务量与成本） |
| `qos_llm_fallback_total` / `qos_llm_breaker_total` | `{from,to}` / `{provider,state}` | provider 记录 ID + 熔断状态 |
| `qos_tasks_total` | `{path, status}` | 查询总量、路径 A/B 分布、失败/取消量 |
| `qos_tool_calls_total` | `{tool, outcome}` | **正在使用的工具名**（含 MCP 工具）+ 被拒次数 |
| `qos_path_a_hit_ratio` / `qos_classifier_latency_ms` / `qos_classifier_errors_total` | — | 编排质量与延迟分布 |
| `qos_entitlement_fail_open_total` | `{reason}` | **⚠ 运营安全信号**：功能门禁 fail-open（未生效）的次数——非零即代表**该部署当前 entitlement 未在强制执行**，等于对外广播「现在防线是开的」 |
| `qos_agent_*`（timeout/budget/loop_repeat/retry/escalation） | — | Agent 稳定性与预算耗尽情况 |
| `qos_unverified_numerics_total` | `{path}` | 有多少答案带未核验数字 |
| `qos_clarification_rounds_total` / `qos_tasks_cancelled_total` | `{kind}` / `{reason}` | 澄清轮次、取消原因 |
| `ac_nested_invocations_total` / `ac_obo_denied_total` / `ac_context_ops_total` / `ac_mcp_alerts_total` / `ac_interrupted_tasks_total` | 各自 | 嵌套调用、OBO 令牌拒绝、上下文压缩、MCP 生命周期告警、重启中断任务数 |
| `dc_version_conflicts_total` | `{resource}` | 乐观锁冲突资源名 |

#### 有没有**跨租户**的东西？——逐字段核查结论

**没有任何一个标签是 tenantId 本身**（核查见 §3.3 金丝雀）。但这**不等于没有跨租户问题**，恰恰相反，问题有两面：

1. **跨租户混算**：所有序列是**全租户合计**。读到 `dc_action_execute_total{action_type="采纳经营方案",outcome="failed"} 37` 的人，看到的是**平台上所有租户合计 37 次**。见 §3。
2. **跨租户内容泄露**：标签值本身携带**租户私有的业务语义**——provider 记录 ID、模型名、本体类型 key、中文动作类型名、行业。租户 A 的运维（或任何摸到 4001/4002 的人）从这些标签里能读出**租户 B 才有的**动作类型名与本体命名。

### 2.5 危害面：谁能看到什么

**可达路径（实测配置）**

| 入口 | `/metrics` 可达？ | 依据 |
|---|---|---|
| 网关 80 端口 | **否** | `deploy/nginx.conf` 只映射 `/a/v1/`(13) `^/(b\|api)/v1/`(24) `=/healthz/a`(40) `=/healthz/b`(41)，其余落 `location /`(44) → `frontend:80`（拿到 SPA，不是指标） |
| 宿主 4001 / 4002 | **是** | `docker-compose.yml:94-95` `- "4001:4001"`、`:132-133` `- "4002:4002"`，**未绑定 127.0.0.1 ⇒ 监听 0.0.0.0**；`DEPLOY.md:14` 把 4001/4002 列为部署需空闲端口（预期开放） |
| 容器网络内 | **是** | 同一 compose 网络内任意容器可直连 |

**谁能看到什么（具体化）**

- **任何能到达宿主 4001/4002 的人**（同机用户、同内网主机、若安全组放行则公网）——**无需任何凭据、无需属于任何租户**——`curl http://<host>:4001/metrics` 与 `:4002/metrics` 即取全量。
- 他能读出：平台**接了哪些 LLM 供应商与模型**、各租户 provider 记录 ID、**token 消耗量**（推算业务规模与成本）、**平台上存在哪些业务动作类型与本体类型命名**（中文业务语义 ⇒ 客户是谁、在做什么业务）、各租户所属**行业**、查询总量与失败率、**entitlement 是否正在 fail-open**（`qos_entitlement_fail_open_total` 非零 = 门禁当前未强制）、MCP/工具清单。
- **租户 A 的管理员**若能直连端口，可读到**租户 B 的**动作类型名与本体 key（`action_type` / `key` 标签值），违反 R2 的语义边界。
- **不会泄露**：明文凭据（R5 由 AES-GCM + credentialRef 守住，指标里只有 provider **记录 ID** 不是密钥）、对象实例数据、用户身份、请求内容。

**定性**：**机密性泄露 + 侦察面**，非完整性/可用性问题。严重度取决于 4001/4002 的网络暴露——**在 `DEPLOY.md` 默认姿势下这两个端口是开的**。

---

## 3 · ② 跨租户混算

### 判定：**部分属实**。实质（混算）成立；**账面措辞「聚合端没有按 tenantId 分组」不成立，予以推翻**。

### 3.1 写入端：tenantId **在作用域内，但没进标签**

标签集定义在 `apps/datacore/src/metrics.ts:99-113`，**四段全部只有两个标签**：

```
 99:  submit(actionType: string, outcome: ActionSubmitOutcome): void {
100:    this.m.inc(ACTION_METRIC_NAMES.submit, { action_type: actionType, outcome });
...
108:    this.m.inc(ACTION_METRIC_NAMES.execute, { action_type: actionType, outcome });
```

关键：**tenantId 在每一个调用点都拿得到，只是没传下去**——

| 写入点 | tenantId 可得性 |
|---|---|
| `actions.ts:521` `this.am.submit(typeKey, outcome)` | 所在方法 `submit(ctx: AuthCtx, draftId)`（`actions.ts:511`）⇒ `ctx.tenantId` 现成 |
| `actions.ts:667/676/694/715/729/732` `this.am.approval(...)` | 同属带 `ctx: AuthCtx` 的审批方法 |
| `actions.ts:776/790/791/804/807/812` `this.am.execute/executeAttempt(...)` | 所在方法 `execute(tenantId: string, draftId: string)`（`actions.ts:773`）⇒ **tenantId 就是第一个形参** |

⇒ 这不是「拿不到租户」，是「**设计上就没打算按租户分**」。（旁证：`docs/SYSTEM-ONTOLOGY.md:109` 把标签集**原样记作** `dc_action_submit_total{action_type,outcome}`——本体文档自己也是这么定义的。所以这是**有记录的设计**，不是某次遗漏。）

### 3.2 聚合端：**仓内不存在聚合端**（推翻账面措辞）

我按要求「两端都要看」，第二端**找不到**——不是没找到，是不存在：

```
$ grep -rn "dc_action" apps packages --include=*.ts --include=*.tsx   # 全部命中：
apps/datacore/src/metrics.ts:58-61          ← 名字定义
apps/datacore/src/actions.ts:420            ← 注释
apps/datacore/src/app.ts:375                ← 注释
apps/datacore/test/action-metrics-endpoint.seam.test.ts   ← 测试
$ grep -rn "ACTION_METRIC_NAMES" apps packages --include=*.ts        # 生产侧消费方：
apps/datacore/src/metrics.ts:100/104/108/112 ← 只有写入，无读取
（其余 20 处全在 test/）
```

- 唯一的「读」是 `Metrics.render()`（`metrics.ts:32-43`）——它**逐条 dump，不做任何分组、过滤或计算**。
- **仓内没有任何代码计算 Action 稳定率**。「稳定率」是**外部**（Prometheus/人）拿 `execute_total{outcome="success"}` 与 `{outcome="failed"}` 相除得到的；验收判据「跑 100 次同 Action 失败率 <1%」（`metrics.ts:49-51`）也是人工判读。

**⇒ 因此「聚合端没有按 tenantId 过滤/分组」这句话没有指称对象。** 正确表述是：

> **标签集不含 tenantId ⇒ 序列本身就是全租户合计 ⇒ 下游任何消费方（Prometheus / 人 / 未来的看板）都* 没有能力 *按租户拆分。**

**为什么这个区别要紧（决定修哪儿）**：
- 若真是「聚合端漏了 groupBy」⇒ 修聚合端一处。
- 事实是「写入端标签缺维」⇒ **只能改写入端**；且历史数据不可追溯拆分（已合并的计数无法事后按租户还原）。修法与影响面完全不同。

### 3.3 金丝雀（两个否定结论各配一个）

**否定结论 A：「所有 `dc_*`/`qos_*` 标签里没有 tenantId」**

```
# 控制样例（必中）——已知确实按 tenantId 分桶的实现：
$ grep -rn "tenantId" apps/agentcore/src/router/perception-metrics.ts | head -3
7:  tenantId: string;
19:function bucket(tenantId: string) {
20:  let c = counters.get(tenantId);
# 目标：
$ grep -rn "\.inc(\|metrics\.set(" apps/datacore/src apps/agentcore/src --include=*.ts | grep -i tenant
（零命中）
```
金丝雀命中 ⇒ 该 grep 确实能在标签/分桶代码里找到 tenant，「零命中」可信。

**否定结论 B：「无鉴权」** —— 见 §2.3 的 401/200 对照表（同 harness 同调用形态，已鉴权路由报 401）。

**最强的金丝雀是仓内的正面反例 `perception-metrics.ts`**——**同一个仓、同一个服务**，把两件事都做对了：

```
apps/agentcore/src/server.ts:352-355
  app.get("/api/v1/perception/metrics", async (req) => {
    const a = await auth(req);              ← ① 有鉴权
    return perceptionMetrics(a.tenantId);   ← ② 按租户取数
  });

apps/agentcore/src/router/perception-metrics.ts:17    const counters = new Map<string, {...}>();   ← 按 tenantId 分桶
apps/agentcore/src/router/perception-metrics.ts:52    ring.filter((r) => r.tenantId === tenantId)  ← 明细也按租户过滤
```

⇒ 「本仓做不到 / 没有先例 / 是 Prometheus 的固有限制」这三种辩解都不成立。**同款需求在 5 行外就有正确实现**。

### 3.4 混算的实际后果

`dc_action_execute_total{action_type="采纳经营方案",outcome="failed"} 37` 读作「**全平台**所有租户合计 37 次」。因此：

- **稳定率不可按租户判定**。验收判据「某 Action 失败率 <1%」在多租户部署下**算不出租户级的数**——一个租户把某动作跑挂 100 次，会拉低所有租户共享的那个比率；反之一个大租户的成功量会**掩盖**小租户的持续失败。
- **告警不可归属**。失败率越线时，无法从指标定位是哪个租户——只能回查日志。
- **与 R2 的关系（诚实表述）**：R2 原文是「所有**读写/事件/缓存键**带 tenantId」（`SYSTEM-ONTOLOGY.md:848`）。指标**不在** R2 的字面枚举里。所以这**不是 R2 的硬违反**，而是「R2 的精神未覆盖到指标面」——这个判断请仓主确认，我不替仓主把 R2 的边界扩大。

---

## 4 · 我推翻了哪几条前提

| # | 被推翻的前提 | 出处 | 真相 |
|---|---|---|---|
| 1 | 「**聚合端**没有按 tenantId 过滤/分组」 | 派单 ② | **仓内没有聚合端**。唯一的读是 `render()` 无差别 dump；无任何代码算稳定率。病在写入端标签缺维 ⇒ 修法不同（§3.2） |
| 2 | 「Action 三段埋点**尚未汇入** `/metrics`，残口：`app.ts:354` 未传 metrics 实参」 | **`docs/SYSTEM-ONTOLOGY.md:109`（本体已过期）** | 已接通。`app.ts:376`：`new ActionService(repos, rules, outbox, notifications, metrics)` —— metrics **已传**。本体这段残口记录**陈旧**，须回写（§6）。派单说「已接通」是**对的**，错的是本体 |
| 3 | 隐含前提：这条只关乎 Action 稳定率埋点 | 派单 ① 措辞 | 泄露面远宽于 Action：**最敏感的是 `dc_llm_calls_total{provider,model}` 与 `qos_llm_tokens_total{provider,model,direction}`**（租户 provider 记录 ID + 模型名 + token 量），以及 `qos_entitlement_fail_open_total`（对外广播门禁是否失效） |
| 4 | 隐含前提：`/metrics` 无鉴权 ⇒ 从公网可读 | 我自己的初判 | **经网关(80)读不到**（`nginx.conf` 无该映射，落 `location /` → frontend）。真实暴露面是 `docker-compose` 把 **4001/4002 发布到 0.0.0.0**。危害面必须按这个说，不能笼统写「公网可读」 |
| 5 | 我自己的中间结论：agentcore 有 **21** 条路由无鉴权 | 我的扫描脚本 | **18 条是假阳性**。`/b/v1/resources*`(910-964) 的鉴权在**共享 handler 闭包**里（`listResources` `server.ts:888-889`、`getResource` `:895-896`、`searchResources` `:903-904`、`getRelations` `:919-920`、`getQuality/postQuality` `:942/:951`）；`/b/v1/scenarios*`(2842-2843) 在 `upsertScenario`（`:2795-2797`）里；`/b/v1/internal/scaffold`(2368) 有 **SERVICE_TOKEN 门**（`:2369-2372`）我的正则没认。**真实无鉴权集只有 6 条**：4 个健康探针 + `/metrics` + `/b/v1/internal/invalidate`。—— 铁律 0.5 现场兑现：只 grep 路由定义会把这 18 条误报成漏洞 |
| 6 | 我自己的中间结论：`qos_llm_tokens_total` 是**死计数器**（`grep llmTokens apps/agentcore/src` 只命中声明与 render） | 我的 grep | **错，它是活的**。增量发生在**另一个包**、经**接口端口依赖注入**：`packages/llm-adapters/src/types.ts:161-163` 定义 `TokenMetricsPort`，`anthropic.ts:87-92` / `openai.ts:173` 里 `this.metrics?.llmTokens.inc(...)`，由 `apps/agentcore/src/llm/providers.ts:95/97` 注入（`providerLabel: provider.id`）。**跨包 + DI，grep 一次看不见**——若照初判上报，会漏掉最敏感的那条泄露 |

---

## 5 · 最小修路径（方案，**未实施**）

> **本单不改 `apps/**`。** 以下每条都标注了必然波及的测试，供排期。

### 5.1 ① 鉴权 —— 需仓主先做一个决策

**决策点：`/metrics` 用哪种守法？** 三选一，我不替仓主选：

| 方案 | 改法 | 代价 |
|---|---|---|
| **A. SERVICE_TOKEN**（与 `/b/v1/internal/scaffold` 同款，`server.ts:2369-2372` 已有范式） | 校验 `x-service-token` | Prometheus 抓取端需配 header；两服务已共享该 env（`SERVICE_TOKEN`） |
| **B. 用户 JWT + 角色** | 走既有 auth + `requireAdmin` | 标准 Prometheus 抓不了（拿不到 JWT）；且指标是全租户合计，给某个租户的 admin 看**反而扩大**跨租户可见面 |
| **C. 不加鉴权，改为收网络面** | `docker-compose.yml` 端口改 `"127.0.0.1:4001:4001"` / `"127.0.0.1:4002:4002"` | 零代码改动、不破任何测试；但只挡住外部主机，挡不住同机与容器网内 |

**我的建议（仅供参考）**：**A + C 一起做**。C 是零风险止血（改两行 compose，不碰代码、不破测试），A 是根治。B 与「指标是全租户合计」这一事实相冲，不推荐。

**若选 A，改动点（共 4 处）**：

| file:line | 改什么 | 为什么是这处 |
|---|---|---|
| `apps/datacore/src/app.ts:851` | 从 `PUBLIC_PATHS` 移除 `"/metrics"` | 关掉旁路出口 1 |
| `apps/datacore/src/app.ts:864` | `if (!path.startsWith("/a/")) return;` 收紧为白名单（仅放行 `/healthz` `/readyz`） | **关掉旁路出口 2 —— 漏掉这处则上一处白改**（§2.1） |
| `apps/datacore/src/app.ts:930` | handler 内校验 `x-service-token` | 端点自守（纵深） |
| `apps/agentcore/src/server.ts:211` | handler 内校验 `x-service-token` | AgentCore 无全局钩子，只能在此处守 |

**必然波及的测试（5 处，全部会从 200 变 401/403）**：
- `apps/agentcore/test/api.test.ts:28`
- `apps/datacore/test/action-metrics-endpoint.seam.test.ts:23` `:46` `:108`
- `apps/datacore/test/ontology.test.ts:170`

修法：给这 5 处 inject 补上 service-token header。**注意**：`action-metrics-endpoint.seam.test.ts` 是接缝门，改它时只能加 header，**不许放宽断言**——该文件 `:73-83` 的注释明确记载过一次「幸存变异」教训。

**③（`/b/v1/internal/invalidate`）**：同属该决策。它的注释（`server.ts:1872-1873`）声明免鉴权是有意的，若要收口，SERVICE_TOKEN 是自然选择（DataCore 侧 webhook 注册见 `DEPLOY.md:134`，需同步改注册的 URL 配置）。**请仓主明示是否一并收口**。

### 5.2 ② 租户维度 —— 需仓主先做一个决策

**决策点：加 `tenant_id` 标签，还是换端点形态？**

| 方案 | 改法 | 代价 |
|---|---|---|
| **A. 标签加 `tenant_id`** | 改 `ActionMetrics` 签名 + 13 个调用点 | **Prometheus 基数膨胀**：序列数 × 租户数。租户多时是真实运维风险 |
| **B. 仿 `perception-metrics.ts`，另开鉴权端点按租户返回** | 新增 `GET /a/v1/actions/metrics`（走既有 `ctx(req)` 鉴权与 R2） | `/metrics` 保持合计不变（不破现有测试）；多一个端点 |
| **C. 不动** | — | 承认 Action 稳定率是**平台级**指标，租户级另行从审计/事件流算 |

**若选 A，改动点（最小集）**：

| file:line | 改什么 |
|---|---|
| `apps/datacore/src/metrics.ts:99-113` | `ActionMetrics` 四个方法各加 `tenantId` 形参，塞进 labels |
| `apps/datacore/src/actions.ts:521` | 传 `ctx.tenantId` |
| `apps/datacore/src/actions.ts:667,676,694,715,729,732` | 传 `ctx.tenantId` |
| `apps/datacore/src/actions.ts:776,790,791,804,807,812` | 传 `tenantId`（已是形参，`actions.ts:773`） |

**必然波及的测试** —— ⚠ **比想象的多，因为 `labelKey` 按键名排序**（`metrics.ts:6`）。加 `tenant_id` 后渲染变成 `{action_type="…",outcome="…",tenant_id="…"}`，凡「`outcome="…"` 后紧跟 `}`」的断言全红：
- `action-metrics-endpoint.seam.test.ts:52`（正则 `\\{action_type="…",outcome="…"\\}`）、`:66`（两标签 `get()` 恒返 0）、`:111`、`:124`
- `action-type-evolution.test.ts:285-291`（四个两标签 `get()` 恒返 0）、`:363`（`toContain('…{action_type="mx_ok",outcome="success"} 5')`）

**⇒ A 方案的真实工作量是「4 处生产代码 + 10 处测试断言」，不是「加个标签」。** 这一点必须在排期时说清楚。

**我的建议（仅供参考）**：**B**。它同时满足 R2 精神与 Prometheus 基数纪律，且**不动 `/metrics` 现有形状 ⇒ 不破任何现有测试**，仓内已有 `perception-metrics.ts` 作为可直接照抄的范式。

---

## 6 · 待回写本体清单（我**没有**动 `docs/SYSTEM-ONTOLOGY.md`，另有 dev 在写）

| 位置 | 现状（已过期/缺） | 应改为 |
|---|---|---|
| `SYSTEM-ONTOLOGY.md:109` | 「**残口**：`app.ts:354` 构造 `ActionService` 未传 metrics 实参 → …**尚未汇入 `/metrics` 端点输出**；接通只需构造处多传一个实参」 | **已闭**。实测 `app.ts:376` 已传 metrics；接缝门 `test/action-metrics-endpoint.seam.test.ts` 已守（含失败侧）。行号 `354`→`376` 亦已漂 |
| `SYSTEM-ONTOLOGY.md:109` 标签集 | `dc_action_*{action_type,outcome}` | 建议补一句「**刻意不含 tenant_id ⇒ 全租户合计**」，把这个设计选择显性化（否则下一个人还会把它当 bug 报一次） |
| §8 断点表 | 无 `/metrics` 相关条目 | 建议新增（编号待仓主定）：`G-METRICS-PUBLIC-UNAUTHED`（两服务 `/metrics` 无鉴权 + `/b/v1/internal/invalidate` 无鉴权）与 `G-METRICS-TENANT-BLIND`（指标面无租户维，R2 精神未覆盖） |
| §不变量表 `R2`(`:848`) | 「所有**读写/事件/缓存键**带 tenantId」 | 若仓主认可把指标纳入 R2，需在此显式加「指标标签」；**不认可则维持原样**，并在 §8 用断点记录该缺口（避免下次又被当成 R2 硬违反误报） |

---

## 7 · 复验命令（每条都自带金丝雀）

```bash
# ① /metrics 路由与旁路（金丝雀：同命令必中已知存在的 PUBLIC_PATHS 定义行）
grep -n "const PUBLIC_PATHS\|\"/metrics\"\|if (PUBLIC_PATHS.has\|if (!path.startsWith\|app.get(\"/metrics\"" apps/datacore/src/app.ts
# 预期 848/851/863/864/930 五行

# ② agentcore 全局钩子数（金丝雀：同 grep 对 datacore 必中 2 条，证明 grep 没坏）
grep -rn "addHook" apps/agentcore/src --include=*.ts   # 预期 0
grep -rn "addHook" apps/datacore/src  --include=*.ts   # 预期 2（860 onRequest / 890 onResponse）← 金丝雀

# ③ 标签集无 tenant（金丝雀：控制样例必中）
grep -rn "tenantId" apps/agentcore/src/router/perception-metrics.ts | head -3     # 金丝雀，必中
grep -rn "\.inc(\|metrics\.set(" apps/datacore/src apps/agentcore/src --include=*.ts | grep -i tenant   # 预期 0

# ④ 无鉴权 vs 有鉴权的 401/200 对照（这是真跑过的断言，不是 grep）
grep -n "url: \"/metrics\"" apps/datacore/test/action-metrics-endpoint.seam.test.ts apps/agentcore/test/api.test.ts
grep -n "toBe(401)" apps/datacore/test/authz.test.ts apps/agentcore/test/api.test.ts

# ⑤ 本体 :109 残口是否已过期
grep -n "new ActionService(" apps/datacore/src/app.ts   # 预期 376，且实参含 metrics
```

---

## 8 · 本单没做什么（诚实边界）

- **没跑任何测试/构建/gate**（轻画像纪律 + 有 gate 在跑）。§5 中「必然波及的测试」是**静态推演**（读断言原文 + `labelKey` 排序逻辑 `metrics.ts:6` 推出），**未实测其变红**。实施时须实跑确认。
- **没改任何生产代码**，`/metrics` 与 `/b/v1/internal/invalidate` 当前仍无鉴权。
- **没有实际发起网络请求**验证宿主 4001/4002 的可达性——结论基于 `docker-compose.yml:94/132` 的端口声明与 `deploy/nginx.conf` 的 location 表**静态推断**。若要坐实，需在真部署上 `curl http://<host>:4001/metrics`。
- **没有核查 pg 模式**下是否有额外的指标持久化（当前 `Metrics` 是纯进程内存，重启即清零——这也意味着**指标无持久化、重启丢失**，属另一议题，未展开）。
