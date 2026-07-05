# SANDBOX-DAG-NODE-LAYOUT · 交付证据（真实测试·真浏览器·不作假）

**WO**：沙盘本体拓扑 DAG 节点排布（35 节点标签单行互叠不可读·渲染器级疵）。
**根因**：`SandboxView` 旧 `<PmDag layers={[nodes]}>` 把全部对象类型节点塞进**单行** →
节点框收窄至 ~21px、标签溢出互叠成墨条（illegible ink-bar）。

## 治机制（三件套）

1. **分层/网格布局**（`SandboxView.layoutTopology`，纯函数 R6）：按边拓扑 rank 分层（Kahn longest-path·环安全）；
   宽层网格换行（每行 ≤ `SANDBOX_MAX_PER_ROW`=6）；拓扑塌成长链（全独点）或层数>8 时回退纯网格。
2. **标签避让**（`PmDag` opt-in `fitLabel`，复用 geo-map 贪心避让先例）：主标签截断至节点框宽内（`fitLabelToWidth`）
   → 标签框 ⊆ 节点框；配合网格（节点框两两不叠）→ 标签框两两不叠。截断后 `<title>` hover 兜底全名（同 geo-map 气泡）。
   **opt-in 默认 false**——ProjectSim / InferenceDag 等既有 PmDag 消费方渲染零改动。
3. **超密聚合缩略**（`aggregateLayers`）：类型数 > `SANDBOX_DENSE_THRESHOLD`=18 时给「展开全部 / 聚合分层」切换；
   聚合 = 每拓扑层折叠为一聚类节点（`层N · k类对象`·标注成员数·诚实聚合非造数 RL5）。

## 真浏览器 before/after（VITE_MOCK build → preview → Playwright chromium · 真登录 planner/demo · in-app 导航沙盘）

镜像真部署密度：mock `view-config` 置 **35 对象类型**。标签框重叠用**真渲染 `getBoundingClientRect`** 逐对判定（同 geo-map 齿检口径）。

| 指标 | BEFORE（复原旧渲染器·同 35 节点） | AFTER（本单修复） |
|---|---|---|
| 节点数 | 35 | 35 |
| 标签行数（distinctRows） | **1（单行）** | **6（分层网格）** |
| 标签框两两重叠数 | **35（互叠墨条）** | **0** |
| 超密聚合切换 | 无 | 有（切聚合→6 聚类节点·0 重叠） |

- BEFORE 截图：`SANDBOX-DAG-NODE-LAYOUT-before-full.png`（35 节点挤成单行·标签墨条不可读）。
- AFTER 截图：`SANDBOX-DAG-NODE-LAYOUT-after-full.png`（6 行网格·每节点独立框·标签逐个可读）。
- AFTER 聚合截图：`SANDBOX-DAG-NODE-LAYOUT-after-aggregate.png`。
- 复现脚本：`SANDBOX-DAG-NODE-LAYOUT-fde.mjs`（`BASE=... node ... <out> <before|after>`）。

## 齿检（`test/sandbox-dag-layout.test.tsx`·6 用例全绿）

- `layoutTopology`：35 节点分多层（非单行）·每行 ≤ maxPerRow·节点一个不丢。
- 渲染沙盘（35 类）：分层非单行（data-y >1 行）+ 全部标签框两两不叠（矩形碰撞断言）。
- **齿有牙（复原即红）**：旧「单行 + 不避让」渲染 → 标签框必互叠（collisions > 0），证断言非恒绿。
- 超密聚合切换 + `aggregateLayers` 纯函数校验。

## 门禁

- 四包 `pnpm -r build` 绿（frontend build 含 tsc typecheck）。
- 前端全量 `vitest run`：146 文件 / 447 用例全绿（含既有 sandbox / DAG 回归）。
- `pnpm gates` exit 0（含 `ontology-slices` 一致——本单纯前端渲染·未触母体·无链路/事件/对象类型/不变量/门禁变更·G-11 接线不变·无需回写）。
