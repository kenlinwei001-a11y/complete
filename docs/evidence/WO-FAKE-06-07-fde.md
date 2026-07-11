# WO-FAKE-06 + WO-FAKE-07 · FDE 交付证据（P0 前端 defake 堵根）

铁律 0.4：真起服务·真浏览器渲染·前端所见逐值对照后端真值·漂移注入红/修正绿（KILL-MOCK-RED）。

两单合一因同触 `apiClient` + `mocks/handlers` 层。

---

## WO-FAKE-06 · apiClient 关键端点加 zod 运行时校验堵根

### 根病
`apps/frontend-shell/src/api/apiClient.ts` 的 `request<T>` 末行 `return (await res.json()) as T` —
零运行时校验：mock↔真后端形状漂移被 `as T` 静默吞掉、测试却绿。

### 修法
新增 `validatedShape<T>(schema, raw)`（`src/api/endpoints.ts`）：对关键端点响应跑 zod
`safeParse` —— 漂移即 `console.error` 高亮（**告警可见**）+ 抛错（react-query 进错误态），
**非静默**。关键：校验为副作用后**返回原始对象**而非 `parse` 的剥离结果——因部分前端 VM
（如 ProvenanceRef 的 `rules/value/formula`）是契约 `ProvenanceRefSchema` 未覆盖的扩展字段，
zod strip 会误删前端消费所需字段。故"验形状不改数据"，既有牙齿又不破坏既有正常解析（C3）。

复用 `@platform/contracts` 已有 schema（不重定义契约·contracts-only-shared）：

| 端点（QOS 查询链 / objects / sim / calibration 主链） | schema |
|---|---|
| `fetchTask` (`GET /b/v1/queries/:id`) | `QueryTaskSchema`（contracts） |
| `submitQuery` (`POST /b/v1/queries`) | 本地 `SubmitQueryResponseSchema` |
| `fetchQueryHistory` (`GET /b/v1/queries`) | `QueryHistoryResponseSchema`（复用 `ClassificationResultSchema`） |
| `searchObjects` / `queryObjectsPaged` (`GET /a/v1/objects`) | `ObjectsPageSchema` |
| `createSimSession` (`POST /a/v1/sim/sessions`) | `SimSessionSchema`（contracts） |
| calibration report / convergence / run / sweep | 既有 `.parse`（本批前已有） |

### C1 真跑（真起 datacore:4001 + agentcore:4102 + 前端 Vite:5273 + Playwright/Chromium）
注入形状漂移（route 拦截 `GET /b/v1/queries` 回 `path:"PATH_A"`·非 WORKFLOW/AGENT 枚举）：

```
driftInjected:            path="PATH_A"（非 WORKFLOW/AGENT 枚举）
qhRowsRendered:           0
showsHonestEmptyState:    true
silentlyRenderedDriftRow: false      ← 漂移未被静默渲染
```
真浏览器控制台可见告警（非静默）：
`[apiClient] 响应形状校验失败（契约漂移·堵根 WO-FAKE-06）: [Object]`（捕获 2 次·react-query 双取）。
截图：`docs/evidence/wo-fake-06-07/query-history-drift-rejected.png`（诚实空态·不渲染 PATH_A 假行）。

### C2 test 牙齿（`test/wo-fake-06-07.defake.test.tsx`）
- 历史响应注入 `path=PATH_A`（陈旧枚举）→ `fetchQueryHistory()` **rejects.toThrow**（红）。
- 历史响应 classification 扁平化（缺 candidates）→ **rejects.toThrow**（红）。
- objects 响应 `total` 非 number → `searchObjects()` **rejects.toThrow**（红）。
- 默认对齐契约 mock → 解析通过（绿）·`candidates[0].intentKey==="capacity_feasibility"`。

### C3 回归
前端全量 **549 passed**（含新增 6）；`validatedShape` 返回原值→既有正常解析不破坏
（f5.provenance 的 ProvenanceRef 扩展字段 rules/value 保留·3 tests 绿）。

---

## WO-FAKE-07 · 契约漂移三修

### F1 · QueryHistoryPage 意图列整列空白
真后端 `GET /api/v1/queries`（`apps/agentcore/src/server.ts:880`）直下发完整
`ClassificationResult`（`classification: t.classification ?? null`），意图键在
`candidates[0].intentKey`（`qos.ts:225`）**非顶层扁平**。前端此前把 classification 当扁平
`{intentKey}` 读 → 对真后端整列 "—"。修：
- `QueryHistoryItem.classification` 类型对齐契约（`ClassificationResultSchema.nullable()`）。
- `QueryHistoryPage.tsx` + `HistoryPanel.tsx`（同病第二处）改读 `candidates[0].intentKey`。
- mock `/b/v1/queries` classification 改为完整 `ClassificationResult`（与真后端同形）。

**C1 真后端渲染·逐值对照**（截图 `query-history-real-backend.png`）：
真起双服务→提交 3 条真查询（确定性 classifier `deterministic:example-match`·无需 LLM）→
`/admin/query-history` 真浏览器渲染意图/路径列**逐行有值**（不再整列长横线）：

| 前端渲染 意图列 | 前端 路径列 | 后端真值 candidates[0].intentKey | 后端 path |
|---|---|---|---|
| `plan_audit_q` | WORKFLOW | `plan_audit_q` | WORKFLOW ✓ |
| `capacity_feasibility` | —（null 正确渲染） | `capacity_feasibility` | null ✓ |
| `affected_orders` | — | `affected_orders` | null ✓ |

逐值一致（3/3）。

### F7 · queries mock path 枚举陈旧
mock `/b/v1/queries` 的 `path` 由 `PATH_A` 改 `WORKFLOW`/`AGENT`（对齐 `qos.ts:433`
`QueryTask.path` 枚举）。C2 断言路径列 `["WORKFLOW","WORKFLOW","AGENT"]` 且不含 `PATH_A`。
牙齿：WO-06 的 `QueryHistoryResponseSchema` path 用严格 enum → 若 mock 回 PATH_A 即校验红。

### F6 · calibration 永远显健康收敛
默认收敛 mock 从不发 `baselineOnly` → 前端永远显"收敛良好"。修（对齐真后端
`datacore app.ts:4202` `baselineOnly = last?.baselineOnly === true`）：
- sweep mock 追加轮（无新真配对·flat·静止）标 `baselineOnly:true`（诚实"未测得改进"）。
- `GET /a/v1/calibration/convergence` 据末轮 `baselineOnly` 派生顶层 dataMode。
效果：初始 3 轮真值下降→"收敛良好"；跑 sweep（无真配对）→ 徽章如实翻"静态基线·未测得改进"
+ 诚实降级提示，**绝不把 flat 水平线冒充收敛**。
C2 断言（`test/wo-fake-06-07.defake.test.tsx` F6 用例·默认 mock）：sweep 前"收敛良好"→
sweep 后徽章含"静态基线"、`calib-convergence-baseline` 提示存在、不含"收敛良好"（红/绿有牙齿）。

---

## 收尾门禁

- 4 包 build 绿（`pnpm -r build`）· `pnpm -r typecheck` 全 Done。
- `pnpm gates`：45+ check 脚本全过（`&&` 链抵达末步 `pnpm -r test`；no-fake-data / genuine-sim /
  no-silent-mock / ontology-slices:check 等均绿）。末步 `pnpm -r test` **并行跑 4 包**在本沙箱触
  cgroup OOM（exit 137·`ERR_IPC_CHANNEL_CLOSED`·非测试失败）。改**分批限并发**逐包跑，全绿：
  - contracts **29**、llm-adapters **18**、frontend-shell **549**（一次跑全量）
  - datacore **195 文件全过**（分批 b0/b1 + rc_00..04·0 fail·仅 skip）
  - agentcore **117 文件全过**（分批 ac_00..05·0 fail·仅 skip）
- 我方改动文件 eslint EXIT=0（余 14 lint error 均在**未触碰**的既有文件·非本批引入·lint 非 gates 步）。

真起真渲染真看·逐值对照·漂移红/修正绿·不作假。
