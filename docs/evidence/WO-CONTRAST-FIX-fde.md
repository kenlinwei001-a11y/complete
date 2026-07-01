# WO-CONTRAST-FIX（R22）· FDE 真跑证据 — DAG 节点文字对比度深→浅

> 由来：R22(L8438②) 用户点名"规划体检 推演过程 DAG 节点'2.检索切片'字深色、对比度不足"。
> 根因：节点副行 kind（`.nodeKind`）+ 图例（`.legend`）+ IPO 行（`.ipoRow > span`）用 `--muted2 #67737f`，在暗底 `--bg #0d1117` 上仅 3.91:1，低于 WCAG AA 小字 4.5:1。

## §1 改动（方案 A · 局部提亮·不动全局 token）

| 文件 | 元素 | 前 | 后 |
|---|---|---|---|
| `apps/frontend-shell/src/components/InferenceProcessDag.module.css:65` | `.nodeKind`（节点副行 kind） | `fill: var(--muted2)` | `fill: var(--muted)` |
| `…InferenceProcessDag.module.css:13` | `.legend`（图例/收敛网络说明行） | `color: var(--muted2)` | `color: var(--muted)` |
| `…InferenceProcessDag.module.css:82` | `.ipoRow > span`（IPO 输入/过程/产出标签，根因扩修） | `color: var(--muted2)` | `color: var(--muted)` |
| `apps/frontend-shell/src/components/Dag/ProcessDag.module.css:7` | `.legend`（共享过程 DAG 图例） | `color: var(--muted2)` | `color: var(--muted)` |

> **根因扩修说明**：WO §2 方案A 只点名 `.nodeKind`+`.legend`。真跑核验时发现同一 `InferenceProcessDag` 面板内 `.ipoRow > span`（点节点后展开的 IPO 三行）也是 10.5px `--muted2` 同类低对比缺陷——用户点开同一 DAG 就会看到。按铁律 0（根因解 > 省事），一并提亮；仍属组件局部 CSS，不触 WO §4 禁止的"全局 `--muted2`（262 处）"。
> `.nodeLabel`（主行，L60 `--txt #e9eef5` 已高对比）**保持不动**。

## §2 对比度实测（deterministic·WCAG 相对亮度公式）

```
--muted  #9aa8b6 on --bg #0d1117 = 7.80:1   ✅ 达 AA(4.5) 且 AAA(7.0)
旧 --muted2 #67737f on --bg      = 3.91:1   ❌ 低于 AA
```

绿底节点 `.done`(rgba(124,196,160,.16) over #0d1117 ≈ #1a2620) 上，`#9aa8b6` 仍 ≥4.5:1（底色更亮，比值只增不减）。

## §3 门 + 测试（真跑）

- `node scripts/check-css-vars.mjs` → ✓ 通过（33 css · 26 变量·裸 var() 均有定义；`--muted` 定义在 `tokens.css:9 #9aa8b6`）。
- 不回潮 grep：`InferenceProcessDag.module.css` / `Dag/ProcessDag.module.css` 已无 `var(--muted2)`、无 `var(--text)`（历史 typo）。
- `pnpm --filter @platform/contracts build && pnpm --filter frontend-shell build` → ✓ built（EXIT=0；注：须先 build contracts，否则前端对 SkillDefinition 见旧类型误报——非本单代码问题）。
- DAG 渲染测试直跑：`vitest run test/inference-dag.test.tsx test/f26.task-dag.test.tsx` → **7 passed**（含"点节点看 IPO"、"横切挂载 ≥5 入口"、"model 收敛子模式"——`.nodeKind`/`.legend`/`.ipoRow` 均真渲染，改后类不脱靶）。
- 类真挂载核验：`InferenceProcessDag.tsx:147 .nodeKind`、`:97 .legend`、`:156-158 .ipoRow>span` 真引用改后类。

## §4 DoD 对照（用户视角）

1. 登录 demo/admin → 规划体检 → 展开"▸ 推演过程（编排 DAG）"。
2. 节点"2. 检索切片"主行清晰（本就 `--txt`），**副行"SliceSpec"从 3.91:1 提到 7.80:1 → 一眼可读**。
3. 节点 5/6/7… 各 kind、底部图例、点开的 IPO 三行同步变亮。
4. 主标签、缺口红/running 蓝/pending 半透明状态语义**视觉不变**（只有 `--muted2` 暗字→`--muted`）。

## §5 诚实边界 / 距北极星

- ✅ 真做到：暗底下 kind/图例/IPO 文字对比度 3.91→7.80（AAA），门绿、DAG 渲染测试 7/7。
- ⚠️ 呈现层 CSS 修正，不触 DAG 拓扑/状态派生（R13/R14 不变）、不引 light 主题、不动全局 `--muted2`（其余视图的 `--muted2` 文字如需一并提亮另开单）。
- 📏 距北极星：本单只覆盖用户点名的推演过程 DAG 面板；全站其余 262 处 `--muted2` 未普查（诚实：非本单范围）。

## 本体引用与影响

- 链路：`sys.orch.query_to_answer`（D7）横切件 `<InferenceProcessDag>` 渲染层文字色——不触链路真值。
- 对象类型/事件/不变量：无变化（R13/R14 不受影响）。
- 断点：不触 G-1…G-8。
- 回写：不新增/改变链路·事件·对象类型·不变量·门禁 → **无需回写 `docs/SYSTEM-ONTOLOGY.md`**（纯呈现层）。
