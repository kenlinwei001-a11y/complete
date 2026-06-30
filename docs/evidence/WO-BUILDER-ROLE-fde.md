# WO-BUILDER-ROLE · FDE 证据（数据构建发动机 + 合成数据职责收敛 · 冷启动建域 vs 运营管线两态）

> P1 · 改造非重写。规格：`docs/PRD-decision-support-maturity.md` §3.0③⑤ · 派工 `DISPATCH-dev-agent-worklist.md` WO-BUILDER-ROLE。
> 模型标识不入提交物。只推 `claude/vigilant-knuth-b1nmxn`。

## 1. 职责边界落点（清晰化·非重写）

### ① 数据构建发动机 = 冷启动/onboarding 建域引擎
七阶段（intake→comprehend→gap→rawin→transform→closure→publish）**定位明确为冷启动/onboarding 建域引擎**：把故事/原型/模板变成一套可用本体域。
- **保留全部能力**：BuildWorkflowRun（持久化步骤状态机·可 resume·可重试）/ ScaffoldManifest / growth LOOP / 双模闭包 / 整域晋升 / FDE 节点图 全部不动。
- **不背运营态持续职责**：运营态数据流走 **WO-PIPE-INCR**（连接器真增量同步 CDC·watermark + 调度自增量 + `connection.sync_completed` 事件 → 受影响切片/派生增量重算）。**杜绝用 build-time 引擎冒充 operational 管线**（PRD §3.0③ 当前隐患）。

### ② 合成数据（synthetic）= bootstrap 源
收敛为 **冷启动 provision-world / 演示 / 测试确定性（R6）/ 有界 generic gap-fill** 源；**不做运营态真实数据替身**。
- A6 拟真值域（`value-domains.ts` 业务区间 + 越线植入）**保留**——是"让合成够真以测推演/VLE"的质量特性，非真实接入。
- **来源诚实分类单一来源**：`classifySourceOrigin(connectorTypeKey, config)` →
  - `synthetic`：`mock_erp` / `mock_crm` / `mock_external`，或 `config.synthetic===true`
  - `real-sourced`：其余真连接器（rest_api / generic_jdbc / file_upload / prototype_html / external_feed / KB / 真 ERP/CRM…）
  - 位置 `packages/contracts/src/datacore.ts`（确定性 R13 · 零写死业务常数 R14 · 跨前端运营看板 + 后续决策 dataMode 贯通共用）。

## 2. 两态 UI（DataBuilderPage）

`apps/frontend-shell/src/pages/admin/DataBuilderPage.tsx` 顶部新增两态切换器 `db-mode-switch`：

- **建域态（onboarding·默认）** `db-mode-onboarding`：既有发动机全控制台（故事建域 / 快速合成 / 工作流时间线 / 历史推演记录 / 自检 / 整域晋升），标题与文案点明"冷启动建域引擎 + 职责边界（运营走 WO-PIPE-INCR）"。
- **运营管线态（operational）** `db-mode-operational` → `OperationalPipelineBoard`（`db-operational-board`）：**消费 WO-PIPE-INCR 既有产物**（连接器 `lastSyncAt` / RawDataset `watermark`·`syncedAt`·`rowCount` / 隔离区），逐源呈现：
  - **来源**：`synthetic`（amber）vs `real-sourced`（绿），`db-origin-<connId>` 带 `data-origin`
  - **last sync** + **新鲜度**（小时·超 24h 标"陈旧 ⚠"→ 决策置信度应标 STALE）`db-freshness-<connId>`
  - **增量量（CDC）**：带 watermark 的数据集数 → 标"N 增量"否则"全量" `db-incremental-<connId>`
  - **隔离行数** `db-quarantine-<connId>`
  - 每源手动触发增量同步按钮 `db-sync-<connId>`（运营态常态由调度自动跑）

## 3. 真浏览器贴证（Playwright · headless chromium · VITE_MOCK 模式）

真起前端（`VITE_MOCK=1 vite dev` :5200）→ planner 登录 → SPA 导航至 `/admin/data-builder` → 截图两态：

- `docs/evidence/WO-BUILDER-ROLE-onboarding-mode.png`（建域态：故事脚本 + 快速合成 + 工作流时间线 + 历史推演）
- `docs/evidence/WO-BUILDER-ROLE-operational-mode.png`（运营管线态：逐源看板）

**运营管线看板实拍文本（各源 synthetic/real + last sync/新鲜度/增量/隔离真值）**：

```
运营管线 · 各源持续同步看板
运营态数据流走 WO-PIPE-INCR（真增量同步 CDC + 调度自增量 + connection.sync_completed → 派生重算）。
各源诚实标 synthetic（合成 2） vs real-sourced（真实 2）——合成是 bootstrap 源，不冒充真实接入。
数据源管线（4 源 · 5 数据集）
数据源	            来源       状态     last sync          新鲜度     数据集 行数    增量(CDC) 隔离
合成数据源（确定性生成）  synthetic  ACTIVE  2026-06-12 02:00  19 天前 ⚠  1     469    全量     0
ERP 主数据            synthetic  ACTIVE  2026-06-11 22:00  19 天前 ⚠  2     1,286  全量     0
CRM 订单              real       ERROR   2026-06-10 22:00  20 天前 ⚠  1     312    1 增量   0
IoT 时序通道           real       ACTIVE  2026-06-12 01:00  19 天前 ⚠  1     9,600  1 增量   0
隔离区共 1 行待处理 · → 连接器页 · → 隔离区
```

- 合成源（mock_erp）正确标 synthetic；真实源（rest_api）正确标 real。
- 真实源 CRM/IoT 带 watermark → 标"1 增量"（走真 CDC，对接 WO-PIPE-INCR ①）；合成源无 watermark → "全量"。
- 新鲜度、last sync 为真值（非裸空）；ERROR 源（CRM 401）状态红显。

## 4. 回归与红线（真跑）

- `pnpm -r build`（全 4 包）：**EXIT=0**（contracts / datacore / agentcore / frontend-shell 全过）。
- `pnpm --filter frontend-shell test`：相关 6 文件（f38/f49/f50/f54/f59 + 新 `wo-builder-role.two-mode.test.tsx`）**15/15 全绿**；新增门 2/2 绿。
- `pnpm --filter datacore test`：synthetic.test.ts 隔离重跑 **8/8 全绿**（SY1 seed42 确定性 deep-equal 不破·R6）；既有合成/建域链零回归。
  - 注：满载并发跑全套时 m11-calibration/replay-ops/synthetic 个别长跑测试出现 20–35s **超时 flake**（机器资源争用·SIGTERM），逐文件隔离重跑均绿——非本改动逻辑回归（本改动 contracts-additive + 前端，未触碰这些链路）。
- 契约 only-shared：新增 `SourceOrigin`/`classifySourceOrigin` 在 `@platform/contracts`；前端经契约消费、不重定义。
- 本体回写：`docs/SYSTEM-ONTOLOGY.md` §2.A（BuildPlan 条目）补 WO-BUILDER-ROLE 职责边界 + 合成 bootstrap 定位 + 两态 UI + 来源诚实分类单一来源。

## 5. 距北极星还差什么（诚实）

北极星（PRD §1）：决策基于本页**真实多源**数据、带置信度溯源、可一键转审批；管线质量封顶决策质量。本单交付的是 **D0 ③⑤（职责收敛 + 合成诚实定位 + 两态可视）**，仍差：

- ⚠ **新鲜度→置信度贯通（D0 ④ / WO-FRESHNESS）未做**：看板已把"新鲜度/synthetic vs real"算出并展示，但**尚未织进求解器 `dataMode`**——合成对象算的结论、陈旧源算的结论，决策答复里还**没**标"基于合成数据 / 基于 N 小时前数据"。本单只把诚实位呈现在管线看板层（`classifySourceOrigin` 已做成可复用单一来源，为 WO-FRESHNESS 把它并入 dataMode 铺好路）。
- ⚠ **运营态看板 last sync/watermark 在 demo 为合成种子值**（mock 与真后端 SEED_DEMO 同口径）；真实接入源的活水位需真连接器 + WO-PIPE-INCR 调度真跑才动（属 WO-PIPE-INCR 既有产物，本单只观测，不重跑同步）。
- ⚠ **真 ERP/MES/SCADA 连接器深度**（D8）仍缺——故现状 demo 仍以合成 bootstrap 为主，看板诚实标 synthetic 即为对此的诚实化（不让合成冒充真实接入）。
- 真浏览器贴证用 VITE_MOCK 前端（环境无真双后端编排）；审核方复验建议起真 datacore（SEED_DEMO=1）核对运营看板各源真值与 mock 同口径。
