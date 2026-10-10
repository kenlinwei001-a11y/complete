# WO-THREE-QUERY-LIVE-UI · 证据档索引

**这是取证档，产品码零改动。** 三条复杂 query 在**活服务 + 真浏览器**上从登录走起的原始读数。

- 取证时刻：2026-10-10 12:22–12:35（本机）
- 活服务：datacore 4001 · agentcore 4002 · 前端 `vite preview` 5173（`127.0.0.1`）
- 被测树：**cb352a47e**（= `/Users/apple/deploy/wo-live` 工作树 HEAD，即活服务所跑的那棵树；`git rev-parse --short` 实测）
- 探针：`../three-query-ui.mjs`（驱动+读屏） · `../three-query-collect.mjs`（API 侧原始档） · `../three-query-sse-cors-repro.mjs`（SSE 上屏失败的 A/B 复现）
- 三条 query 的**屏上真实输入**由 `qN-screen.json` 与探针 stdout 双记录；提交走屏幕底部全局提问条（`query-dock-bar` input），⛔ 非场景启动器

## 文件地图

| 文件 | 是什么 | 产出方式 / RC |
|---|---|---|
| `taskids.json` | 三条 query 的屏上原文 + taskId + 终态 + 耗时 | 探针 stdout，`probe-stdout.rc` = RC 0 |
| `qN-screen.json` | 终态瞬间**屏上**读数（think-row/narration/step 计数、答案卡 innerText、失败块原文、金丝雀） | 同上 |
| `qN-task.json` | `GET /api/v1/queries/:id` 全量（classification / path / matchedIntent / answer / error） | `three-query-collect.mjs`（登录取 token 后只读） |
| `qN-decision-trace.json` | `GET .../decision-trace`（工具账：工具名+outcome+耗时，逐条） | 同上 |
| `qN-agent-runs.json` | `GET .../agent-runs`（kernel / agentKey / attribution / iterations 内层工具） | 同上 |
| `qN-events.txt` | `GET .../events` SSE 全量回放原文 | 同上 |
| `qN-think.json` | 从 events 解析：`agent_think` 帧数 / 段数 / 逐段全文 + `agent_narration` 段 | 同上 |
| `derived-qN-*.txt` | **派生档**（非原始）：屏上/服务端答案原文、思考段与旁白段全文 | `derived-` 前缀，勿当原始档引用 |
| `qN-*.png` | 终态截图（1680×900 视口） | CDP `Page.captureScreenshot` |
| `net-hits.txt` | 探针会话内打到 4001/4002 的全部回包（含失败，不筛） | CDP Network 监听（⚠ 对 SSE 连接**漏收**，连数见下） |
| `cors-sse-headers.txt` / `cors-json-headers.txt` | 带 `Origin: http://127.0.0.1:5173` 的响应头 A/B（同机同任务） | curl，各自 `.rc` |
| `sse-cors-repro.json` | 浏览器内 A/B：跨源 `EventSource` vs 跨源 `fetch` | `three-query-sse-cors-repro.mjs`，RC 0 |
| `routing-and-terminal.json` | 三条任务的 `routing.completed` / `answer.final` / `task.failed` 帧原文 | 从 `qN-events.txt` 解析 |
| `agents-roster.json` | 活服务 agent 名单（含 kernel/role/status） | curl `/b/v1/agents`，`.rc` |
| `console-errors.txt` | 探针会话内浏览器 console error（0 条） | CDP |

## 时间线（同一件事在服务端 vs 在屏上的时刻差）

| query | 提交（task.createdAt） | 服务端出答/判死 | 屏上出现答案/失败块 | 差 |
|---|---|---|---|---|
| q1 | 12:22:48 | 12:25:48（180s 看门狗强制 FAILED，answer.final=中止说明） | 探针在计时 226s 时读到失败块（≈12:26:34） | ≈ +46s |
| q2 | 12:26:43 | completedAt 12:26:48（**5.2s**） | 探针计时 66s 时读到答案卡（≈12:27:50） | **≈ +61s** |
| q3 | 12:27:54 | 12:30:54 看门狗 FAILED → 12:31:28 completedAt | 探针计时 208s 时读到失败块（≈12:31:22） | 见 qN-screen.json |

（服务端时刻 = `qN-task.json` 的 createdAt/completedAt（UTC+8 换算）；屏上时刻 = 探针 stdout 的「终态: … · Ns」+ 轮询间隔 3s。）

## ⚠ 量法边界（读数前先看这里）

1. `net-hits.txt` 由 CDP `Network.responseReceived` 收集，**对长连 SSE 会漏收**（实测：浏览器侧对三条任务共发起 **42** 次 `/events` 连接——q1 14 / q2 7 / q3 21——CDP 只留下了 1 条 500）。连接次数以 agentcore 服务端日志为准（`~/Library/Logs/com.decision.agentcore.log`，按时间窗+reqId 双键匹配；另有我方 curl 探测 10 次不计入）。
2. `qN-think.json` 的「帧」是 **token 级 delta**（同一段思考会被切成成百上千帧）；「段」= 不同 `stepId`（`think-<turn>-<step>-<index>`）。两个数一起给才不误导。
3. 屏上「思考段出现没有」用 `[data-testid="think-row"]` / `[data-testid="agent-narration"]` 计数，金丝雀 = 同一根下 `[data-testid]` 元素总数（42/53/57 > 0，量法活着）。
4. q2 走 WORKFLOW（确定性求解器），**本来就不会有 agent 思考帧** —— 该条 0 帧不是缺陷。
