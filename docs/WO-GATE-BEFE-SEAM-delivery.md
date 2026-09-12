# WO-GATE-BEFE-SEAM 交付说明 · 后端↔前端接缝门 `befe-seam:check`

> 机制单，不是功能单。交付物 = 一道门 + 一份棘轮基线 + 本体回写。
> 分支 `claude/handoff-wo-gate-befe-seam`（从 canonical `origin/claude/inspiring-gates-aqczjg` 重开）。

---

## 0 · 为什么要这道门

本仓已有 SEAM-GATE 纪律（`CLAUDE.md`「接缝门」一条），但它只列了两种拆法：
「数据+引擎两半」与「A+B 两系统」，**从没把「后端+前端两半」列进去** ⇒ 这一类缺口一路裸奔。

2026-08-09 实测到的同族缺口（前端生产代码消费方全是 0）：
`skill-graphs` · `compile` · `SkillGraph` · `execution` · `dependsOn` · `maxBudgetRounds` ·
`AgentTrace` · `reflection` · `loopControl` · `promptVersion` · `contextSnapshot` · `Retriever`。

**标本**：`apps/agentcore/src/router/orchestrator.ts:2532 (emitWithRole)` 发 `role`/`roleLabel`，
`:2538` 注释白纸黑字写着「结构化字段（role/roleLabel）供前端分栏」，
而 `apps/frontend-shell/src/sse/taskStreamReducer.ts:139 (selectStepRows)` 只解构
`{ stepId, type, outcome, durationMs, text }` —— **注释里的承诺从来没兑现，且没有任何机制会说话**。

本体断点编号：`G-BE-FE-SEAM-DEAD`（本单新登）。

---

## 1 · 门的判据

`scripts/check-backend-frontend-seam.mjs` · 别名 `pnpm befe-seam:check` · 已并入 `pnpm gates`。

判据一句话：**凡后端在发 / 在暴露的东西，前端必须有生产代码消费方**
（`apps/frontend-shell/src/**`，剔除 `src/mocks/**` 与 `*.test.tsx?` / `__tests__/`）。

### 载体① SSE 事件字段

agentcore `src/` 里 `emit(...)` 的 payload 对象字面量顶层字段名 → 前端生产代码必须提到该字段名。

抽取分两条规则，**缺一不可**：

| 规则 | 形态 | 为什么必须有 |
|---|---|---|
| **R1 直接字面量** | `emit(taskId, "step.completed", { stepId, type, … })` | 常规情形 |
| **R2 变量 payload 回溯** | `payload = { … }` … `emit(taskId, e, payload)` | **`roleLabel` 那条就长这样**（`emitWithRole` 包装器，事件名是变量）。只做 R1 会把本门要治的头号实例整个漏掉，门照样绿 |

事件名**不认位置、认形状**（长得像 `xxx.yyy` 的字符串字面量）——
`outbox.emit(x, "evt.name", p)` 的事件名是**第二个**实参，认位置就会全漏
（`CLAUDE.md` 铁律 0.6 第 5 例的教训）。

### 载体② HTTP 端点

datacore/agentcore `src/` 注册的 `/a/v1` `/b/v1` `/api/v1` 路由 → 前端生产代码必须有对应 URL 字面量。

- `/b/v1` ↔ `/api/v1` 别名重写表**从 `apps/agentcore/src/server.ts` 的 `rewriteUrl` 单源抽取**，不硬编码
  （今天是 `queries/catalog/ops/growth` 四条；改了重写表，门自动跟着改）。
- 路径归一：`${…}` 配平替换成 `*`、`:param` → `*`、去 query、去尾斜杠；匹配要求段数相同、逐段通配兼容。
- **结构性豁免 13 条**，每条带理由（探活 `healthz/readyz/metrics` · 服务间 `/internal/` ·
  认证基础设施 `.well-known` / `jwks` · `SERVICE_TOKEN` 专用 `references/report`、`/credential` · `openapi`）。
  无理由豁免不许加。

### 棘轮，不是全量

今天的缺口量太大，一上来要求全绿会当场卡死所有人。缺口清单记进
`scripts/backend-frontend-seam-baseline.json`，门只断言「**不许比基线更差**」。

- `--seed`：首次建账（基线已存在则**拒绝执行**）。
- `--update`：**只删不加** —— 摘掉已修复项，新增缺口一律**不**自动收编。
  要把一条新缺口记进存量，必须**人手编辑基线文件**——那是一个可评审的显式动作，不是脚本的副作用。
  （若 `--update` 能自动招安，棘轮秒变橡皮图章。）

---

## 2 · 金丝雀：是什么、怎么与主逻辑共用实现

### 共用实现的做法

门把全部抽取/判定逻辑写成**导出函数**：
`lex` / `splitTopLevel` / `stripComments` / `objectTopLevelKeys` / `extractEmitFields` /
`extractBackendRoutes` / `extractFrontendPaths` / `normalizePath` / `extractRewritePrefixes` /
`pathMatches` / `mentionsInProd` / `frontendProdFiles`。

**金丝雀调用的就是这些函数本身，不另抄一份正则。**
抄了就是装饰品：改主正则时金丝雀拿旧的去测、照样绿（本仓 2026-08-08 实测踩过）。
两处刻意的体现：

- C7b 判「这条端点算不算有人调」时，用的是**主逻辑同一个** `pathMatches`，不另立标准。
- C11 造假前端文件时，mask 由**同一个** `lex` 现算，不手写"哪些是注释"。

### 14 条金丝雀

| # | 名称 | 已知必中的样例 | 不中意味着什么 |
|---|---|---|---|
| C1 | lex/正则内双斜杠 | `"a".replace(/\/$/,"")` 后面的 emit 仍要抽到 | 正则里的 `//` 被读成行注释 ⇒ 整行代码被吞 ⇒ 抽取器少数据 ⇒ 报出「干净」 |
| C2 | lex/注释内 emit 不计 | 注释掉的 emit 抽出 0 条 | 把示例代码当真接线 ⇒ 幻觉缺口 |
| C3 | emit/事件名非首参 | `outbox.emit(tx,"sim.tick_advanced",{…})` | 认位置 ⇒ 「`sim.*` 一处都没 emit」（铁律 0.6 第 5 例原样复现） |
| C3b | emit/payload 内含注释 | 字段上一行有 `//` 注释仍要抽到 | **变异反证抓出来的真洞**，详见 §3.0 |
| C4 | emit/真文件 `orchestrator.roleLabel` | 真 orchestrator.ts 必须抽到 `roleLabel` | R2 变量 payload 回溯失效 ⇒ 本门头号实例漏掉 ⇒ 这道门没有存在的理由 |
| C5 | emit/真文件 `step.completed.stepId` | 真源码里最常见的一条 | 抽不到 ⇒ 抽取器在真源码上瞎了 |
| C6 | route/真文件 后端 `/api/v1/queries` | 真 server.ts | 路由正则在真文件上失效 ⇒ 端点清单恒空 ⇒ 报「零缺口」 |
| C7 | route/真文件 前端 `/a/v1/me/workspace` | 真 endpoints.ts | 前端 URL 抽取失效 ⇒ **全部**后端路由被误报成零消费 |
| C7b | route/真文件 端到端切 `${}` 路径 | 真 endpoints.ts 的 `objects/${…}/neighbors` | **本门第一版真漏洞的补丁**，详见 §3.0 |
| C8 | route/模板归一配平 | `${…}` 必须配平替换 | 懒惰正则吃掉后面的路径段 ⇒ 段数错 ⇒ 匹配全错 |
| C9 | route/别名前缀单源 | 从 server.ts 抽出的前缀含 `queries` | 抽空 ⇒ `/b/v1/queries` 与 `/api/v1/queries` 被当两条路 ⇒ 幻觉缺口 |
| C10 | **consume/双向判据** | 已知存在的 `stepId` 命中 >0 文件 **且** 已知不存在的名字命中 =0 文件 | 单向金丝雀测不出恒真/恒假匹配器 —— 恒真报「零缺口」、恒假报「全是缺口」，**两种坏法都会被单向金丝雀放过** |
| C11 | consume/注释不算消费 | 只在注释里出现的 `roleLabel` 判为未消费 | 把注释当消费 ⇒「后端注释承诺了前端接」自证成功 ⇒ 门永远绿（`roleLabel` 正死在这上面） |
| C12 | consume/前端面剔 mocks 与测试 | 生产文件 >50 且混入 mocks/测试 =0 | 把 MSW mock 当消费方 ⇒「前端有了」是假的 |

**不中的处置**：打印 `⛔ 门自己坏了`、逐条给出「期望/实际/为什么它重要」、`exit 2`，
**本次不产出任何结论** —— 绝不允许报「代码干净 / 零缺口」。

---

## 3 · 变异反证（红/绿输出原文）

工作区起点：`git status --porcelain` 为空，`HEAD = ae5e7759`。

### 3.0 先说一件事：变异反证抓出了门自己的两个洞

这两个洞**都是 13/14 条金丝雀全中的情况下漏过去的**，正是本节存在的理由：

> **金丝雀证明工具在「我想到的」输入上没坏；变异反证才检验它在「我没想到的」输入上坏没坏。**

| 洞 | 形态 | 后果（若不修） | 修法 | 补的金丝雀 |
|---|---|---|---|---|
| **① 前端路径切分早停** | `extractFrontendPaths` 用字符类 `[^"'\`\s)\\,]*` 吃到底，在 `${encodeURIComponent(objectId)}` 的 `)` 上停住 ⇒ `/a/v1/objects/${…}/neighbors` 被切成 `/a/v1/objects/*`，段数 4≠5 | **前端明明在调的 23 条端点被报成「零调用」**（199→176） | 改 `scanPathFrom`：`${…}` 整段**原子跳过** | **C7b**（端到端跑真 `endpoints.ts`，且用主逻辑同一个 `pathMatches` 判定） |
| **② payload 内含注释挡住字段名** | `splitTopLevel` 切出的段落形如 `\n // 注释\n fieldLabel: "x"`，`trim()` 后首字符是 `/`，`^ident\s*:` 一条都匹配不上 ⇒ **凡带注释的字段一律读作不存在** | 门对「新增带注释的字段」**完全无反应**（变异①第一次跑就是 RC=0），而本仓 emit payload 里注释满地都是 | `objectTopLevelKeys` 先经 `stripComments`（复用 `lex` 的 mask，不另抄正则）；实测 emit 发点 127→128，顺带找回 1 个此前被注释挡住的真字段 | **C3b** |

洞① 的教训与 `CLAUDE.md` 铁律 0.6 **完全同形**：
我单测了 `normalizePath`（C8 全绿），而 `normalizePath` 并不度量「端到端切得对不对」。
两件事都写进了脚本顶注，防有人图省事删掉那一步。

### 3.1 变异① —— 后端 emit 加一个前端不读的字段（载体①）

改 `apps/agentcore/src/agent/loop.ts:518`，在 `step.completed` 的 payload 里加：

```ts
      // 结构化字段，供前端分栏展示升级原因（变异反证用·前端并未消费）
      escalationRationaleLabel: "budget-exhausted",
```

**红（原文）**：

```
· 金丝雀 14/14 全中（词法 2 · SSE 抽取 3 · 路由 5 · 消费判据 3）——抽取器在真源码上有效，下面的否定结论才有资格被相信。
· 载体① SSE 字段：后端 emit 出 44 个不同字段（129 处发点 · 变量 payload 未解析 9 处，其字段由契约类型管辖） · 前端零消费 9（基线 8 · 新增 1 · 已修复 0）
· 载体② HTTP 端点：后端注册 474 条（结构性豁免 13）· 前端 URL 字面量 231 条 · 前端零调用 176（基线 176 · 新增 0 · 已修复 0）

✗ befe-seam:check 未通过（1 条新增接缝缺口 · 棘轮只许降不许升）：
  - 载体① 新增「后端发了·前端零消费方」字段 `escalationRationaleLabel`（step.completed@apps/agentcore/src/agent/loop.ts:518）
      → 这就是 G-BE-FE-SEAM-DEAD：后端把字段发出去了，前端生产代码一个字都没读（注释里写「供前端…」不算消费）。
        修：在 apps/frontend-shell/src 里真接上（reducer/选择器/组件读它），或者别发这个字段。
        确属暂不接：人手加进 scripts/backend-frontend-seam-baseline.json 的 sseFields 并在 PR 里说明理由。
RC=1
```

**绿（撤销后，原文）**：

```
· 金丝雀 14/14 全中（词法 2 · SSE 抽取 3 · 路由 5 · 消费判据 3）——抽取器在真源码上有效，下面的否定结论才有资格被相信。
· 载体① SSE 字段：后端 emit 出 43 个不同字段（128 处发点 · 变量 payload 未解析 9 处，其字段由契约类型管辖） · 前端零消费 8（基线 8 · 新增 0 · 已修复 0）
· 载体② HTTP 端点：后端注册 474 条（结构性豁免 13）· 前端 URL 字面量 231 条 · 前端零调用 176（基线 176 · 新增 0 · 已修复 0）

✓ befe-seam:check 通过：后端↔前端两半无**新增**「后端发了/暴露了、前端零消费方」缺口（存量 SSE 8 · 端点 176 已记基线，只减不增）。
RC=0
```

### 3.2 变异② —— 后端加一条前端不调的端点（载体②）

`apps/agentcore/src/server.ts:217` 加 `app.get("/b/v1/agent-trace-summary", …)`。

**红（原文）**：

```
· 金丝雀 14/14 全中（词法 2 · SSE 抽取 3 · 路由 5 · 消费判据 3）——抽取器在真源码上有效，下面的否定结论才有资格被相信。
· 载体① SSE 字段：后端 emit 出 43 个不同字段（128 处发点 · 变量 payload 未解析 9 处，其字段由契约类型管辖） · 前端零消费 8（基线 8 · 新增 0 · 已修复 0）
· 载体② HTTP 端点：后端注册 475 条（结构性豁免 13）· 前端 URL 字面量 231 条 · 前端零调用 177（基线 176 · 新增 1 · 已修复 0）

✗ befe-seam:check 未通过（1 条新增接缝缺口 · 棘轮只许降不许升）：
  - 载体② 新增「后端注册了·前端零调用」端点 `GET /b/v1/agent-trace-summary`（apps/agentcore/src/server.ts:217）
      → 后端开了口子没人用。修：前端 apps/frontend-shell/src/api/endpoints.ts 接上；
        或属结构性非前端端点（探活/服务间/认证基础设施）→ 加进本脚本 ROUTE_EXEMPTIONS 并写明理由；
        或确属暂不接 → 人手加进 scripts/backend-frontend-seam-baseline.json 的 endpoints。
RC=1
```

### 3.3 变异③ —— 保留该端点，**补上前端消费方**（证明门量的是接缝，不是「有没有新路由」）

在 `apps/frontend-shell/src/api/endpoints.ts` 末尾加：

```ts
export const fetchAgentTraceSummary = () => api.b<{ items: unknown[] }>("/b/v1/agent-trace-summary");
```

**绿（原文）** —— 注意后端仍是 475 条，前端 URL 字面量 231→232，零调用 177→176：

```
· 金丝雀 14/14 全中（词法 2 · SSE 抽取 3 · 路由 5 · 消费判据 3）——抽取器在真源码上有效，下面的否定结论才有资格被相信。
· 载体① SSE 字段：后端 emit 出 43 个不同字段（128 处发点 · 变量 payload 未解析 9 处，其字段由契约类型管辖） · 前端零消费 8（基线 8 · 新增 0 · 已修复 0）
· 载体② HTTP 端点：后端注册 475 条（结构性豁免 13）· 前端 URL 字面量 232 条 · 前端零调用 176（基线 176 · 新增 0 · 已修复 0）

✓ befe-seam:check 通过：后端↔前端两半无**新增**「后端发了/暴露了、前端零消费方」缺口（存量 SSE 8 · 端点 176 已记基线，只减不增）。
RC=0
```

这一条比「撤销即转绿」强：它证明门判的是**两半有没有接上**，而不是「后端多了一行」。

### 3.4 变异④ —— 只在 `src/mocks/` 里消费，门必须**仍红**

撤掉 §3.3 的前端消费方，改成只在 `apps/frontend-shell/src/mocks/handlers.ts` 里出现该路径。

**仍红（原文）**：

```
· 金丝雀 14/14 全中（词法 2 · SSE 抽取 3 · 路由 5 · 消费判据 3）——抽取器在真源码上有效，下面的否定结论才有资格被相信。
· 载体① SSE 字段：后端 emit 出 43 个不同字段（128 处发点 · 变量 payload 未解析 9 处，其字段由契约类型管辖） · 前端零消费 8（基线 8 · 新增 0 · 已修复 0）
· 载体② HTTP 端点：后端注册 475 条（结构性豁免 13）· 前端 URL 字面量 231 条 · 前端零调用 177（基线 176 · 新增 1 · 已修复 0）

✗ befe-seam:check 未通过（1 条新增接缝缺口 · 棘轮只许降不许升）：
  - 载体② 新增「后端注册了·前端零调用」端点 `GET /b/v1/agent-trace-summary`（apps/agentcore/src/server.ts:217）
```

坐实「**只有 mock/test 引用 = 已排练，不是已实现**」（假绿第 9 形态同族）。

### 3.5 变异⑤ —— 把门自己改坏，验金丝雀是真牙

把 `mentionsInProd` 改成恒真（`const hits = ["__MUTATION__"]`），
即「所有字段都算被消费了」——这是**会安静地报「零缺口·通过」**的坏法。

**原文**：

```
⛔ 门自己坏了 —— befe-seam:check 的金丝雀未命中，本次**不产出任何结论**。
   （铁律 0.6：金丝雀不中只许报「工具坏了」，绝不许报「代码干净 / 零缺口」。）

  ✗ 金丝雀「consume/双向判据」未中
      为什么它重要：单向金丝雀测不出恒真/恒假匹配器——两种坏法一个报「零缺口」一个报「全是缺口」
      期望："前者 >0 且 后者 =0"
      实际："已知存在 stepId 命中 14 文件 · 已知不存在命中 1 文件"
  ✗ 金丝雀「consume/注释不算消费」未中
      为什么它重要：把注释当消费 ⇒ 「后端注释承诺了前端接」自证成功 ⇒ 门永远绿
      期望：[]
      实际：["__MUTATION__"]
RC=2
```

**若只有单向金丝雀（"已知存在的名字必须命中"），这个坏法会全绿通过。**
这就是 C10 必须双向的原因。

### 3.6 还原证明

- 门脚本自变异后 `diff` 备份：**逐字节一致**（`脚本已完全还原（与自变异前逐字节一致）`）。
- 全部变异撤销后 `git status --porcelain` 为空（见 §6）。

---

## 4 · 今天的基线数字，以及它是怎么数出来的

`scripts/backend-frontend-seam-baseline.json`（`--seed` 一次性建账）：

| 载体 | 后端总量 | 结构性豁免 | 前端消费面 | **零消费方（= 基线）** |
|---|---|---|---|---|
| ① SSE 事件字段 | 43 个不同字段 / 128 处发点 | — | 前端生产文件 **181** 个（`src/**` 共 190 个 ts/tsx，剔 `mocks/` 与测试后） | **8** |
| ② HTTP 端点 | 474 条注册 | 13 条 | 231 条 URL 字面量 | **176**（GET 80 · POST 88 · PUT 8；`/a/v1` 122 · `/b/v1` 37 · `/api/v1` 17） |

另有 **9 处变量 payload 未解析**（`emit(taskId,"answer.final",answer)` 这类），
其字段来自 `@platform/contracts` 契约类型，归 contracts-only-shared 纪律管，本门不猜、如实计数。

### 8 条 SSE 字段缺口的全名单

`actionDraftIds` · `decisionId` · `dispatches` · `iteration` · `nearest` · `plannedSlices` ·
**`roleLabel`** · `supersededBy`

### 数出来的过程（可复算）

1. 遍历 `apps/agentcore/src/**` 非测试非 mock 的 `.ts`，对含 `emit(` 的文件跑 `extractEmitFields`
   （R1 直接字面量 + R2 变量 payload 回溯），得 43 个字段名。
2. 遍历 `apps/datacore/src/**` + `apps/agentcore/src/**` 跑 `extractBackendRoutes`，
   只留 `/a/v1` `/b/v1` `/api/v1` 与探活三条，按 `METHOD 归一路径` 去重，得 474 条。
3. 遍历前端生产文件跑 `extractFrontendPaths`，得 231 条归一路径。
4. 逐条判定：字段名在前端生产代码（剔注释）零出现 ⇒ 记为缺口；
   端点的全部别名都无前端路径 `pathMatches` ⇒ 记为缺口。
5. `--seed` 落账。

### 这些数字被独立复核过（不是「我 grep 了」）

按铁律 0.5「grep 的结果不是结论，必须再追一层」，抽样沿调用链追到了触发条件：

| 抽样 | 追的那一层 | 结论 |
|---|---|---|
| `roleLabel` | 读 `selectStepRows` 的解构类型（`taskStreamReducer.ts:139`），只有 `{stepId,type,outcome,durationMs,text}` | **真零消费**（且前端全树 0 次提及） |
| `POST /b/v1/scenarios/:key/launch` | 读 `components/ScenarioLauncher/useScenarioLaunch.ts` → `useQuickLaunch` → 调的是 `submitQuery`（`POST /b/v1/queries`），顶注写明「前端直接组装提交（PRD §4 二选一之一）」 | **真零调用**（前端走了另一条路绕开这个端点） |
| `POST /b/v1/queries/:id/cancel` | 前端全树搜 `cancel`，命中的全是 UI 局部取消（`cancelScheduled` / `setPreview(null)` / `forecast.cancel`），无一条打这个端点 | **真零调用**（用户在界面上没有取消正在跑的查询的入口） |
| `POST /a/v1/sim/sessions/:id/act` | `endpoints.ts:580` 有一行现成的人写注释：「此前沙盘唯一的扰动入口 `POST /a/v1/sim/sessions/:id/act` **在本文件里没有封装** ⇒ 零调用方」 | **真零调用**，且与人肉结论一致 |
| 全量反向复核 | 另写一套**独立方法**（`xcheck.mjs`：拿每条缺口的末两个非通配段裸搜前端全树），97 条「尾段出现过」逐类看 | 未发现新的误报；一致的那批全部是同名词在别处出现 |
| 前端是否有"泛化消费" | 搜前端有无 `JSON.stringify(事件data)` 式整包渲染（会让载体① 误报） | 无。三处 `JSON.stringify` 都不是 SSE payload |
| 前端是否有非字面量 URL | 搜 `api.a(变量` / `api.b(变量` | **0 处**——全部调用点都是字面量/模板，载体② 的抽取面是完整的 |

---

## 5 · 我怎么避开已知的 grep 陷阱

| 陷阱 | 本单的处置 |
|---|---|
| `git grep -- "apps/*/src"` 恒 0 命中（pathspec 的 `*` 不跨 `/`） | **全程不用 pathspec 通配**。门内遍历用 `readdirSync` 递归**目录**（`walk()`）；命令行核查用 `grep -rn <目录>` 直接给目录名 |
| `git rev-parse <rev>:<path>` 不带 `--verify -q` 会把输入串原样打到 stdout 且 RC=0 | **完全没用文件存在性判分支**。分支判据用**祖先关系**：`git merge-base --is-ancestor HEAD $CANON` → 实测「HEAD 是 canonical 的祖先 ⇒ 落后」→ 从 canonical 重开 |
| 事件名是 `emit(x, "evt.name", p)` 的**第二个**实参 | 抽取器**不认位置、认形状**（扫所有实参找 `^["'][a-z_]+(\.[a-z_]+)+["']$`），payload 取事件名之后那一个/最后一个实参。金丝雀 C3 用 `outbox.emit(tx,"sim.tick_advanced",{…})` 原样钉死 |
| 正则字面量里的 `//` 被读成行注释 | 自写**正则字面量感知**的 `lex`（本仓真有 5 个文件这么写）。金丝雀 C1 钉死 |
| 懒惰正则跨过路径段 | `${…}` 用**配平括号**跳过（`skipBracedExpr`），不用懒惰匹配。金丝雀 C8 + C7b 钉死 |
| 「我没找到」当成「它不存在」 | 门在报任何否定结论**之前**先跑 14 条金丝雀；不中就 `exit 2` 报「门自己坏了」，**拒绝产出结论**。屏上每次都先打印金丝雀命中证据 |

另外一条**不在清单里、但本单实测踩到**的：
`node --check` 报的 `SyntaxError` 位置可能离真凶很远 ——
块注释里写 `/a/v1/objects/*/neighbors`，那个 `*/` 把 `/** … */` 提前关掉，
报错却指在 20 行之后的一个完全正常的正则上。已在脚本里避开（注释内不写 `*/` 序列）。

---

## 6 · 交付前自检

```
$ git status --porcelain
（空）
```

- 变异反证期间动过的三个生产文件（`apps/agentcore/src/agent/loop.ts`、
  `apps/agentcore/src/server.ts`、`apps/frontend-shell/src/mocks/handlers.ts`、
  `apps/frontend-shell/src/api/endpoints.ts`）全部 `git checkout --` 还原，工作区干净。
- 门脚本自变异（§3.5）后与备份 `diff` **逐字节一致**。
- 本单**没有**跑 `bash scripts/gate.sh`，**没有**跑 `pnpm -r test`（照工单纪律）。

### 顺带核过的既有门（确认本单没把别人的红算到自己头上，也没制造新红）

| 门 | 结果 | 说明 |
|---|---|---|
| `check-backend-frontend-seam.mjs`（本门） | **RC=0** | 金丝雀 14/14，新增缺口 0 |
| `check-system-ontology.mjs` | **RC=0** | 文件锚点 157 个缺失 0 · 断点编号悬空 0 |
| `check-ontology-anchors.mjs` | **RC=0** | 本单 2 个新锚点写成 `path:line (symbol)` 可机器核，已校准 88→90；未校准存量 67 = 基线，未回潮 |
| `check-gate-ledger.mjs` | RC=1（**pristine HEAD 同样 RC=1，同样 28 条**） | 28 条全是 `guardedPaths` 指向未 build 的 `dist/`，与本单无关。本单条目**零违规**；`provenRed` 从未红过 35 = 基线 35（本单是 `MUTATION`，棘轮不升） |
| `check-ontology-writeback.mjs` | RC≠0（**pristine HEAD 同样，且漏的是同一个门**） | 漏登的是 `check-req-coverage`，非本单。本单的门已在 §7 登记，`gates` 链 27→28 |

「pristine HEAD 同样」是**实测**的：把 `package.json` / `gate-ledger.json` / `SYSTEM-ONTOLOGY.md`
`git checkout HEAD --` 回去跑一遍，条数与内容一致，再从备份还原。

---

## 7 · 本体引用与影响

| 维度 | 内容 |
|---|---|
| **新增断点** | `G-BE-FE-SEAM-DEAD` —— 「后端发了 / 暴露了，前端零消费方」整类 |
| **新增门禁** | `befe-seam:check`（`scripts/check-backend-frontend-seam.mjs`），已并入 `pnpm gates`（binding=`GATES_CHAIN`，`gate-census` 现算确认） |
| **触及链路** | AgentCore SSE（`emit` → `/b/v1/queries/:id/events`）→ frontend-shell `sse/taskStreamReducer.ts`；DataCore/AgentCore REST → frontend-shell `api/endpoints.ts` |
| **触及不变量** | 强化 SEAM-GATE 纪律：把「后端+前端两半」补进接缝门的覆盖拆法（此前只有「数据+引擎」「A+B 两系统」） |
| **对象类型 / 事件** | 无新增（本单不改任何生产代码） |

### 回写位置（行号）

| 文件 | 行 | 内容 |
|---|---|---|
| `docs/SYSTEM-ONTOLOGY.md` | **§7 第 975 行** | `befe-seam:check` 门条目（判据 / 两类载体 / 棘轮 / 金丝雀 / 诚实边界 / 脚本路径 + 别名） |
| `docs/SYSTEM-ONTOLOGY.md` | **§8 第 985 行** | 断点 `G-BE-FE-SEAM-DEAD`（形态 / 标本 file:line / 制度层病根 / 性质＝◐ 增量已封死·存量待 burn-down） |
| `scripts/gate-ledger.json` | `check-backend-frontend-seam.mjs` 条目 | `binding=GATES_CHAIN` · `guardedPaths` 7 条 · `escalation=审核方` · `provenRed.kind=MUTATION`（四次变异 + 一次门自变异写进 note） |
| `package.json` | `scripts` | 新增别名 `befe-seam:check`；并入 `gates` 串（`check-worktree-canonical` 与 `check-gate-ledger` 之间） |

**§8 的性质刻意写成「◐ 增量已封死（门在），存量待 burn-down」，不是 ✅。**
门只封死增量；今天 SSE 8 条 + 端点 176 条存量原封不动躺在基线里，`roleLabel` 也还在里面。
写成 ✅ 就是这道门要治的那种病本身。

---

## 8 · 诚实边界（先读这一节，免得把这道门当成它不是的东西）

1. **载体① 的消费判据是「字段名在前端生产代码里出现过」——必要条件，不是充分条件。**
   - 漏报方向：通名撞车。`role` / `type` / `path` 这类名字在前端本来就到处是，
     本门抓不到它们的缺口。`roleLabel` 抓得到，`role` 抓不到 —— 这条限制是真的，别指望它。
   - 误报方向：整包泛化消费（`JSON.stringify(data)`）。本仓当前无此写法（实测过），
     将来若出现，会把真消费误判成零消费。
2. **载体① 只解析对象字面量。** 变量 payload（9 处）的字段来自契约类型，本门不猜。
3. **载体② 的「消费」只看 URL 字面量是否存在**，不校验方法/参数/响应形状是否对得上。
   前端写了 URL 但传错方法，这道门看不见（那是另一类接缝，另立门）。
4. **豁免表是人工维护的**，加豁免必须带结构性理由。它是这道门唯一可以被"说服"的地方，
   评审时重点看这里。
5. **基线里的 184 条存量不代表 184 个 bug**：其中有相当一部分是管理端/运维端端点，
   或前端走了另一条路（如 `scenarios/:key/launch`）。基线的作用是**封死增量 + 让存量可见可数**，
   burn-down 需要逐条判性质，另立 WO。

---

## 9 · 范围边界自检（🚦）

只碰了工单允许的文件：

- `scripts/check-backend-frontend-seam.mjs`（新建）
- `scripts/backend-frontend-seam-baseline.json`（新建 · 基线台账）
- `scripts/gate-ledger.json`（只加自己那一条，未动他人条目）
- `package.json`（只加别名 + `gates` 串）
- `docs/SYSTEM-ONTOLOGY.md` §7 / §8（**只加，未改他人条目**；另把本单自己写的 2 个锚点
  按 `check-ontology-anchors` 的要求补成 `path:line (symbol)`）
- `docs/WO-GATE-BEFE-SEAM-delivery.md`（本文件）

`apps/**` / `packages/**` 的生产代码：变异反证期间临时改过，**已全部还原**，工作区干净（§6）。
