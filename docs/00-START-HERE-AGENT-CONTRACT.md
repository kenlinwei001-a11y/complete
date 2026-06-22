# 00 · START HERE · 开发 Agent 强制契约（读不懂就别动手）

> 本文件是**验收契约**，不是建议。你的产物**不满足下方 DoD 即被拒**——与你是否读过其它文档无关。
> 仓主已（或将）在 GitHub 开启**分支保护**：`gates` 工作流不绿，PR **合不进**。

## 0. 你是谁、在哪开发
- 开发分支：`claude/vigilant-knuth-b1nmxn`（源码与本包 PRD 锚点字节一致，`file:line` 通用）。
- 本包根目录的 `.claude/`（`CLAUDE.md` + `hooks/` + `skills/`）是**可移植强制件**：若你是 Claude Code agent，把本包作为工作区，SessionStart 钩子 + 铁律 0 + `ontology`/`fde-delivery` skill **会自动触发**。不要删除它们。

## 1. 强制阅读顺序（铁律 0，违反即返工）
1. `CLAUDE.md`（项目宪法）
2. `_reference/SYSTEM-ONTOLOGY.md`（系统接线单一来源——**产出任何 PRD/架构/跨模块改动前必须完整读**）
3. `PRD-data-closure-spec.md`（数据闭环 21 维基线 + 逐模块 checklist）
4. 你要实现的具体 PRD（见 `PRD-reference-views-1to1-roadmap.md` 索引）
5. `_reference/reference-prototype-decision-platform.html`（1:1 的唯一真相源）

## 2. 机械化 DoD（验收 = 命令 + 输出，不是"我觉得做完了"）
你**必须**在交付说明里**贴出**以下命令的真实输出，全绿才算完成：

```bash
pnpm install
pnpm -r build
pnpm -r test          # 四包全绿：datacore / agentcore / frontend / contracts
pnpm gates            # = ontology:check + chain:check + debattery:check + prd:check + prd-coverage + meta-sync
```

- 任一红 = **未完成**，不得宣布"done"。禁止用绿测试冒充"能用"（见 `skills/fde-delivery`）。
- **FDE 亲手跑**：实现的功能你必须真人/真 agent 端到端走一遍（数据从生成→物化→派生→渲染），核对可见值=HTML，而不是只看测试绿。

## 3. 每份 PRD 的 §0 必填（漏即 `prd:check` 红）
你新写或修改的任何 PRD，《本体引用与影响》§0 **必须**逐项声明：
- 触及对象类型/链路/事件/不变量（R1–R15）/断点（G-1…G-8）；
- **数据闭环 checklist（21 维，见 `_PRD-TEMPLATE.md §0` 与 `PRD-data-closure-spec.md §6）**——每项填 ✅+锚点 或 `// 理由` 豁免；
- CLI 对等（R15）；回写承诺。
- 纯前端/纯文档/不碰数据者可整体标 `// 不涉数据闭环` 跳过。

## 4. 不可违反的硬约束（命中即返工）
- **数据走管线**：HTML 精确值作**生成器种子配置**产出，**前端零写死**（R14 / `debattery:check`）。
- **单一上传口**：同一字段只能一个 DataCategory/来源（避免互斥，R-一致）。见 `data-closure-fullchain.svg`。
- **真值经 Action 审批**（R4）；**租户隔离**（R2）；**确定性**（R6，同 industry/seed 字节一致）。
- **回写本体**：改了链路/事件/对象类型/不变量/门禁 → 必须回写 `SYSTEM-ONTOLOGY.md` 对应章节，否则 `ontology:check` 红。
- 命名禁用外部产品名，用平台自有术语。

## 5. 仓主一次性动作（启用 100% 强制，开发者无法绕过）
> 把 `.github/workflows/gates.yml`（本包已含）放进仓库，并在 GitHub → Settings → Branches 开启分支保护：
> **Require status checks to pass before merging → 勾选 `gates`**。
> 自此任何 PR 不绿合不进——这是"100% 执行"的最后一把锁，在仓主侧，开发 agent 关不掉。

## 6. 实施顺序（见 `PRD-reference-views-1to1-roadmap.md` + `PRD-data-closure-spec.md`）
先骨架 `spine` →（数据闭环规范打底）→ aop/sop/quarter → audit→generate → order → inference-process。每份照 §2 DoD 闭环交付。

---
**一句话**：文档负责说清楚，门禁负责绕不过。你照 §2 跑命令贴输出、照 §3 填 §0、不违 §4，就能合并；否则 `gates` 红，到此为止。
