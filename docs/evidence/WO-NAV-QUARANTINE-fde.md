# WO-NAV-DATA + WO-NAV-SANDBOX + WO-QUARANTINE · FDE 证据

> dev 实装 · 隔离 worktree · 仅推 `claude/vigilant-knuth-b1nmxn`。真跑自验（绿测试≠能用）。

## 1. 改了哪些组/项（导航 IA 重组）

文件 `apps/frontend-shell/src/pages/ShellLayout.tsx` `NAV_GROUPS`：

| 改动 | 之前 | 之后 |
| --- | --- | --- |
| **WO-NAV-DATA** 组改名 | 「数据接入」 | 「数据」 |
| **WO-NAV-DATA** 移入 `order` | 在「台账与地图」组 | 进「数据」组（订单台账）|
| **WO-NAV-DATA** 移入 `data-builder` | 在「构建与成长」组 | 进「数据」组（数据构建发动机）|
| **WO-NAV-SANDBOX** sim 项归位 | `sim-sandbox`/`sim-init` 游离于 nav 末尾（特殊项）| 并入「推演」组（经 `extra:"sim-sandbox"` 渲染槽）|

「数据」组最终成员（按序）：连接器与上传 · 规则文档审核 · 合成数据 · 外部数据 · 数据构建发动机 · 订单台账 · 隔离区。
「台账与地图」组改后只剩 `geo-map`（基地地理视图，地理可视非源数据，按 WO 边界保留）。

`apps/frontend-shell/src/locales/zh.ts`：`nav.externalSignals`「外部信号」→「外部数据」（该 key 仅用于 admin nav 标签）。

**R3 不破**：sandbox 项仍由 `featureOn(workspace, "sim.sandbox")` 门控——关 entitlement → `simSandboxLinks()` 不渲染。路由守卫 `SimSandboxGuard`/`SimInitGuard`（App.tsx）未动。

`apps/frontend-shell/src/pages/admin/QuarantinePage.tsx`：空态文案
- 旧：「隔离区为空 ✓」（像坏了）
- 新：「无异常行 ✓ / 合成数据洁净；真实上传的坏行（结构不符 / 主键重复等）将在此排队修复。」（诚实的好消息）

## 2. 真跑证据（VITE_MOCK=1 真起前端 + 真浏览器 Playwright/chromium）

起服务：`VITE_MOCK=1 pnpm vite`（:5173），planner/demo 登录，chromium headless 实跑。

### ① 「数据」组（截图 `wo-nav-leftnav-admin.png`）
左导实拍逐项：规划与平衡 / 推演（项目推演·预判推演看板·订单全链聚合）/ 台账与地图（基地地理视图）/ **数据（连接器与上传·规则文档审核·合成数据·外部数据·数据构建发动机·订单台账·隔离区）** / 建模与图谱 …
Playwright 文本断言通过：`数据 GROUP TEXT` = 上述 7 项；订单台账已不在「台账与地图」。空组自动隐藏正常。

### ② 推演组 + R3 门控
- mock 默认 `sim.sandbox` 关 → 真浏览器推演组**无**沙盘项（`nav-sim-sandbox`/`nav-sim-init` count=0）= R3 门控生效。
- 开 `sim.sandbox`（test 经 `server.use` 注入 features）→ 沙盘/初始化项**出现在「推演」组内**（非游离），见 `test/wo-nav-data-sandbox.test.tsx` 第 3 例真渲染断言 `within(推演组).getByTestId("nav-sim-sandbox")` 通过。

### ③ 隔离区（截图 `wo-quarantine-rows.png`）
- 隔离区是**真接线**：mock 回一条真 PENDING 坏行（orders / 结构不符 / 缺主键 so）。真浏览器点「重入」→ 弹 toast「已重入正门」（reprocess 真生效）。
- 诚实空态：mock 总有 1 行，故空态由单测覆盖（`server.use` 回空 items → 断言「无异常行 / 合成数据洁净 / 真实上传的坏行」、不含旧「隔离区为空」）。

## 3. 红线核对

- `pnpm -r build`（全 4 包）exit=0 ✓
- `pnpm --filter frontend-shell test`：119 文件 / 293 测试全绿 ✓（新增 `wo-nav-data-sandbox.test.tsx` 3 例 + f43 隔离区空态 1 例；同步 f1/f12/f61 的「数据接入」→「数据」断言）。
  - 注：`dash-export.test.tsx` 有一条 jsdom「Not implemented: navigation」stderr（锚点下载，**既有现象与本改动无关**，该测试本身通过）。
- `pnpm gates`（27 门）exit=0 ✓
- entitlement R3 不破：关 `sim.sandbox` 沙盘项消失（真浏览器 + 单测双证）。
- 命名无外部产品名；模型标识不入提交物；密钥仅 env。

## 4. 距北极星还差什么（诚实）

- 本批是**前端 IA 重组 + 文案诚实化**，纯配置驱动，无后端/契约改动；不触及链路/事件/对象/不变量/门禁 → 无需回写 `docs/SYSTEM-ONTOLOGY.md`（隔离区接线 §2.A QuarantineRow 与 modeling.ts 坏行路由本就在本体，未改）。
- 隔离区**真值演示**（上传含重复+缺主键的真实 CSV → connectors.upload → materialize → 坏行真落 `GET /a/v1/quarantine` → reprocess 修复进对象库）属真后端链路，本单在 mock 下以单条 demo 坏行 + reprocess 实拍证活体；端到端真后端演示留审核方/后续真 PG 复验。
- 「数据」组把 `order`（业务台账视图，base_manager 亦可见）纳入后，base_manager 该组不再恒空（含订单台账）——这是 IA 决策的真实后果，已在 f1/f12 用纯 admin 组「建模与图谱」隐藏断言保留「无管理页」原意。
