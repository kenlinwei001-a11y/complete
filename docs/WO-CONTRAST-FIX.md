# WO-DagNodeContrast · DAG 编排节点字色深色→浅色提对比度

> 由来：R22(L8438②) 用户点名——规划体检"推演过程 DAG"节点"**2.检索切片**"字深色、对比度不足；实指该节点副行 kind 文字 `#67737f` 深底低对比（本体 D7 `sys.orch.query_to_answer` 的 `<InferenceProcessDag>` 横切组件，ONTOLOGY.md L535）。依赖：`css-vars:check` 门（scripts/check-css-vars.mjs·守"文字用 --txt 非 --text"不回潮）+ tokens.css 单一暗色主题。

## §0 目标 + DoD-as-experience

**目标**：把推演过程编排 DAG 节点上"深到看不清"的文字调亮到可读对比度，主行标签不回退。

**DoD（用户视角·亲手走一遍能用，非测试绿）**：
1. 登录 demo/admin（demo1234）→ 进"规划体检"（S&OP/Plan Audit）视图。
2. 展开结论旁"▸ 推演过程（编排 DAG）"折叠面板。
3. 肉眼看节点"**2. 检索切片**"：主行"检索切片"清晰（本就浅），**其下副行"SliceSpec"不再是灰暗糊字**——在深底/绿底/红底节点上都能一眼读清 kind 与图例文字。
4. 同一 DAG 里 5、6、7… 各节点 kind（Solver/Rule/…）、底部图例（并行分叉/汇聚/…）一并变清晰。
5. 主标签、缺口红、running 蓝、pending 半透明等状态语义视觉不变，只有"暗字"变亮。

## §1 现状盘点（钉真实 file:line·已核实）

| 项 | 位置（真实 file:line） | 状态 | 说明 |
|---|---|---|---|
| 用户点名节点"2.检索切片" | `apps/frontend-shell/src/components/InferenceProcessDag.tsx:24` | ✅已在 | `{ id: 2, label: "检索切片", …, kind: "SliceSpec" }` |
| 节点主行字（label）渲染 | `apps/frontend-shell/src/components/InferenceProcessDag.tsx:146` | ✅已在 | `<text … className={styles.nodeLabel}>{n.id}. {n.label}</text>` |
| 节点副行字（kind）渲染 | `apps/frontend-shell/src/components/InferenceProcessDag.tsx:147` | ✅已在 | `<text … className={styles.nodeKind}>{n.kind}</text>` |
| 主行 `.nodeLabel` 字色 | `apps/frontend-shell/src/components/InferenceProcessDag.module.css:58-62` | ✅已在 | `fill: var(--txt)` = `#e9eef5` 近白，**已高对比（历史 typo `--text` 已被门修正，勿动）** |
| 副行 `.nodeKind` 字色 | `apps/frontend-shell/src/components/InferenceProcessDag.module.css:63-67` | 🔴缺（低对比） | `fill: var(--muted2)` = `#67737f`；8px 小字在 `--bg #0d1117` 上 ≈3.6:1（低于 WCAG AA 4.5），绿/红底节点更糊——**这才是"深色文字"** |
| 图例文字 | `InferenceProcessDag.module.css:13` + `Dag/ProcessDag.module.css:7` | 🔴缺（低对比） | 均 `color: var(--muted2)` 10.5px，同上偏暗 |
| token 定义（单一暗主题） | `apps/frontend-shell/src/styles/tokens.css:8-10` | ✅已在 | `--txt:#e9eef5` / `--muted:#9aa8b6` / `--muted2:#67737f`；无 light/data-theme 覆盖 |
| 规划体检挂载点 | `apps/frontend-shell/src/views/sim/PlanAuditView.tsx:186` | ✅已在 | `<InferenceProcessPanel testId="inference-audit" solved />` → `InferenceProcessDag`（同图另挂 QueryDock/TaskRun.tsx:70） |
| css-vars 门 | `scripts/check-css-vars.mjs:41-49` | ✅已在 | 裸 `var(--X)` 的 X 必须已定义；改值只要 token 仍在 tokens.css 即天然过门 |

**结论**：主行不是问题；"深色文字"= 节点 kind 副行 + 图例用的 `--muted2 #67737f` 在暗底/状态底上对比不足。

## §2 施工范围（dev 可直接照做）

二选一，**首选方案 A**（作用面最小、精准命中用户点名处）：

**方案 A · DAG 局部提亮（推荐·不动全局 token）**
仅改 `apps/frontend-shell/src/components/InferenceProcessDag.module.css`：
- L65 `.nodeKind { … fill: var(--muted2); }` → 改为 `fill: var(--muted);`（`#9aa8b6`，对 `--bg` ≈6.3:1，达 AA）。
- L13 `.legend { … color: var(--muted2); }` → `color: var(--muted);`（图例同步提亮）。
- 同源共享图例：`apps/frontend-shell/src/components/Dag/ProcessDag.module.css:7` `.legend { color: var(--muted2); }` → `color: var(--muted);`（此图例经 `<ProcessDag showLegend>` 渲染，L7 是真实来源）。
- 保持 `.nodeLabel`（L60 `var(--txt)`）**原样不动**。

**方案 B · 全局 token 微调（作用面大，仅当希望全站 `--muted2` 都更亮时）**
改 `apps/frontend-shell/src/styles/tokens.css:10` `--muted2: #67737f;` → 提亮至 `#8792a0`（对 `--bg` ≈5.1:1，达 AA）。影响全站 262 处 `var(--muted2)`——需通盘回归，**本次不建议**。

> 门约束：无论 A/B，token（`--txt/--muted/--muted2`）必须仍定义于 tokens.css；不得把 kind 改回 `var(--text)` 或引入未定义变量，否则 `check-css-vars.mjs` 报红。

## §3 验收（FDE 亲手·curl + 真浏览器 + 门）

1. **门（必须绿）**：
   ```bash
   node /home/user/complete/scripts/check-css-vars.mjs   # 期望 ✓ css-vars:check 通过
   pnpm --filter frontend-shell build && pnpm --filter frontend-shell test   # 25+ 绿
   ```
2. **真浏览器（DoD 亲手走）**：
   ```bash
   VITE_MOCK=1 pnpm --filter frontend-shell dev
   ```
   浏览器登录 demo/admin/demo1234 → 规划体检 → 展开"▸ 推演过程（编排 DAG）"→ 定位节点"2. 检索切片"→ 确认副行"SliceSpec"及底部图例文字**明显变亮、可读**；主行"检索切片"与缺口红/蓝/半透明状态视觉不变。
3. **对比度核验**：取改后 kind 色 `#9aa8b6` 与 `--bg #0d1117` 算对比比 ≥4.5:1（AA 小字达标）；绿底 `.done`(rgba 124,196,160,.16 over #0d1117≈#1a2620) 上仍 ≥4:1。
4. **不回潮**：`grep -n "var(--text)\|var(--muted2)" InferenceProcessDag.module.css` 确认 kind/legend 已不再引 `--muted2`（方案 A），且无 `--text`。

## §4 不在本次范围（诚实边界）

- **不引入 light/多主题**：全站单一暗色 `:root`，本次只在暗色下提对比，不做主题切换。
- **不动全局 `--muted2`（除非选方案 B）**：262 处引用，越界即需全站回归。
- **不改 DAG 拓扑/节点语义/状态派生**：`NODES/EDGES/deriveStatus`（InferenceProcessDag.tsx:22-61）不动（R13/R14 结构 config 与真值派生不变）。
- **不改 `.nodeLabel` 主行**（已 `--txt` 高对比）；不动 QueryDock/TaskRun 侧交互，仅共享 CSS 生效即覆盖两处挂载。
- 其他视图（LayeredDag/ProvenanceDag/PmDag 等）的 `--muted2` 文字**不在本单**，如需一并提亮另开单。

## 本体引用与影响

- **链路**：`sys.orch.query_to_answer`（D7，ONTOLOGY.md L535）横切件 `<InferenceProcessDag>`——本单只改其**渲染层文字色**（"SSE→DAG 节点状态映射纯渲染投影，不新增真值"），不触链路真值。
- **对象类型/事件**：无（纯前端 CSS/token 呈现层）。
- **不变量**：R13（状态由真实任务流派生）、R14（拓扑=结构 config）均不受影响；`css-vars:check` 门（WO-CSS 系）继续守"文字用 --txt 非 --text/对比度"不回潮。
- **断点**：不触 G-1…G-8。
- **回写**：不新增/改变链路·事件·对象类型·不变量·门禁 → **无需回写 `docs/SYSTEM-ONTOLOGY.md`**（纯呈现层修正，D7 描述已含"纯渲染投影"，不失效）。

---
*审核方自包含施工单(design+review·铁律0.5·钉真实file:line)· 仅推 claude/vigilant-knuth-b1nmxn · 模型标识不入任何提交物*
