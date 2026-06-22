# PRD 索引 · 参考原型全视图 1:1 复刻总纲

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 ACTIVE · 日期 2026-06-21 |
| 性质 | **索引/总纲**——统辖 HTML 参考原型各业务视图的 1:1 复刻 PRD（差异/优先级/依赖/映射），防再漏 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `docs/REFERENCE-HTML-INVENTORY.md` · 各子 PRD |
| 参考源 | `docs/reference-prototype-decision-platform.html`（19 视图 `VIEWS` L1353-1479） |

> 背景：首份复刻 PRD（`PRD-cockpit-capacity-1to1-parity.md`）只做了 **dash(经营驾驶舱)+risk(产能推演)** 2 个，其余业务视图**未对齐或未立 PRD**。本文把全 19 视图盘清、定优先级、登记映射与横切决定，逐个引子 PRD。

## 0. 已确认的全局决定（写死）
- **story(编排推演 DAG) + model(型号产能推演) = 横切增强，不做独立导航**（用户裁决）：融入**每个推演入口**作为"推演过程展示"增强——model=型号驱动可产网络收敛（融入项目推演/产能推演）；story=11 步可追溯过程 DAG（融入任意推演答案/过程面板，与 A5 FDE 节点图同源）。单列一份"推演过程展示增强"PRD，不占导航。
- **命名映射**：HTML `generate`(规划建议) = 系统 `plan-generate`(**规划建议 / 方案生成**，同一视图，registry.ts:29 已映射)。
- **图谱族**（all/flow/source/solver/agent/loop/backbone/mvp/map）：已坍缩进 `OntologyGraphView`（colorBy/focusId + MappingOverlay）→ **不逐个复刻**，仅借鉴各 preset 叙事高亮（按需小增强）。
- **1:1 尺度 = 100%（用户裁决 2026-06-21，全局）**：**结构/功能/数据值/交互 逐项 100% 对齐 HTML**；**唯色调(配色)与字体可调**。即 HTML 的精确演示数值/字符串/逐项交互都要还原——但**不在前端写死**，而是把这些值作为**电池域生成器种子配置**产出（R14/R6，数据仍走管线）。这把各子 PRD §9 的"1:1 尺度"统一定为**严格档**（原 A/B 选择作废，取 B+色字可调）。
- **数据铁律**：每个 1:1 复刻数据走管线（合成→物化→派生/求解器→渲染），前端零写死（R14）。
- **系统超集处置**：系统已强于 HTML 的活能力（活求解器/真规则/Action 审批/溯源）**保留为底层实现**——只要**可见的数值/结构/交互与 HTML 100% 一致**即可（活算出来的数=HTML 的数）；系统独有的额外 UI 元素（如 finalize 按钮、项目测算 C1 行）默认**收为不破坏 1:1 基线的附加增强**（可隐藏/次级呈现）。若你要"绝不多于 HTML"，在子 PRD 标注即可。

## 1. 全视图覆盖图谱（19 视图）
| HTML view·label | 系统对应 | 状态 | 处置 |
|---|---|---|---|
| dash·经营驾驶舱 | dashboard(DashboardView) | ✅ 已复刻 | cockpit PRD |
| risk·产能推演 | risk-board(RiskBoardView) | ✅ 已复刻 | cockpit PRD |
| map·业务建模映射表 | OntologyGraphView/MappingOverlay | ✅ 有 | 借鉴即可 |
| **aop·年度情景规划台** | annual-scenario | ◐ 有差异 | **子 PRD ✅ `PRD-aop-annual-scenario-1to1.md`** |
| **sop·月度 S&OP** | sop-balance(SopBalanceView) | ◐ 有差异 | **子 PRD ✅ `PRD-sop-balance-1to1.md`** |
| **quarter·季度滚动看板** | quarterly-rolling | ◐ 有差异 | **子 PRD ✅ `PRD-quarter-rolling-1to1.md`** |
| **audit·规划体检** | plan-audit(PlanAuditView) | ◐ 有差异 | **子 PRD ✅ `PRD-plan-audit-1to1.md`** |
| **generate·规划建议（=方案生成）** | plan-generate(PlanGenerateView) | ◐ 有差异 | **子 PRD ✅ `PRD-plan-generate-1to1.md`** |
| **order·项目推演** | order-chain(OrderChainView) | ◐ 有差异 | 子 PRD 待写（model 融入此处） |
| story·编排推演 DAG | —（A5/QOS DAG block） | ➡ 横切增强 | 并入"推演过程展示增强"PRD |
| model·型号产能推演 | —（项目推演子模式） | ➡ 横切增强 | 同上（融入推演入口） |
| all/flow/source/solver/agent/loop/backbone/mvp·图谱族 | OntologyGraphView | ◐ 坍缩 | 不逐个复刻，按需小增强 |

## 2. 子 PRD 队列（按业务价值/依赖排序）
| # | 子 PRD | 视图 | 状态 |
|---|---|---|---|
| 1 | `PRD-aop-annual-scenario-1to1.md` | aop 年度情景规划台 | ✅ 已出 |
| 2 | `PRD-sop-balance-1to1.md` | sop 月度 S&OP（规划脊柱核心） | ✅ 已出 |
| 3 | `PRD-quarter-rolling-1to1.md` | quarter 季度滚动看板 | ✅ 已出 |
| 4 | `PRD-plan-audit-1to1.md` | audit 规划体检（含时序推演交互 1:1） | ✅ 已出 |
| 5 | `PRD-plan-generate-1to1.md` | generate 规划建议/方案生成 | ✅ 已出 |
| 6 | `PRD-order-project-sim-1to1.md` | order 项目推演（model 融入） | ⬜ |
| 7 | `PRD-inference-process-enhancement.md` | **推演过程展示增强**（story DAG + model 收敛网络，融入各推演入口） | ⬜ |

> 依赖：2–6 各自独立（前端+生成器+契约，冲突小）；7 横切，建议在 ≥1 个推演视图(order/risk)就绪后接入，复用 A5 FDE 节点图与 QOS 答案 DAG block。

## 3. 每子 PRD 统一要求（复用 cockpit/aop 范式）
- 含《本体引用与影响》§0；过 `prd:check`。
- **1:1 = 结构/功能/UI/交互对齐 + 数据走管线**（R14 零写死、R6 确定）；**保留系统超集**（活求解器/真规则/Action 审批/溯源）。
- 逐项 gap 表（HTML↔系统，带 file:line）+ DoD parity 勾验 + FDE 亲手跑。
- **1:1 尺度 = 100%**（结构/功能/数据值/交互逐项对齐，唯色调/字体可调；见 §0）——各子 PRD 不再单留尺度确认。

## 4. 状态
- ✅ 已出子 PRD：**aop（年度情景规划台）· sop（月度 S&OP）· quarter（季度滚动看板）· audit（规划体检·含时序推演交互 1:1）· generate（规划建议/方案生成·复用 audit 时序+KSF）**。
- ⬜ 待写：order（项目推演，model 融入）· 推演过程展示增强（story+model）。
- 横切决定（story/model=增强、generate=方案生成、1:1=100% 色字可调）已固化于本文 §0。

> 基线分支：各子 PRD 实现前定准 wizardly-gauss vs vigilant-knuth（涉前端+生成器+契约）。
