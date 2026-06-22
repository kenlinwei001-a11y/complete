# PRD 总索引（全库导航 · 按族分组）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 ACTIVE · 日期 2026-06-22 |
| 性质 | **顶层索引**——把全部 PRD 按族归类,标依赖/状态/子索引,给 dev agent 一张总图。开工先读 `docs/00-START-HERE-AGENT-CONTRACT.md`(强制契约)。 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`(铁律 0)· `docs/PRD-data-closure-spec.md`(数据闭环基线)· `docs/PRD-system-ontogenesis-spec.md`(发育闭环总纲) |

## 本体引用与影响（索引性 PRD）

本文为全库索引,不直接触碰对象/链路/事件;各子 PRD §0 各自声明。统辖整体守 R6/R13/R14/R16;过 `prd:check`。

## 0. 三层导航
1. **本文**=全库总图(族级)。
2. **族子索引**：`PRD-A-series-roadmap`(工程 A1–A18)· `PRD-reference-views-1to1-roadmap`(原型 1:1 七件)。
3. **单 PRD**=具体设计。

## 1. 平台总纲与契约
| PRD | 作用 | 状态 |
|---|---|---|
| `PRD-platform-foundry-aip.md` | 平台总纲(系统边界/A0–A8/B1–B7/验收) | 基线 |
| `PRD-query-orchestration-service.md` | QOS 查询编排详规 | 基线 |
| `PRD-frontend.md`(+ addendum-*) | 前端(路由/启动序列/renderer) | 基线 |

## 2. 数据闭环与治理（宪法级 · 全模块强制）
| PRD | 作用 | 状态 |
|---|---|---|
| **`PRD-data-closure-spec.md`** | **数据闭环 21 维基线 + 逐模块 checklist + 系统/PRD 双向遗漏**(全模块强制) | ★ 核心 |
| **`PRD-system-ontogenesis-spec.md`** | **发育闭环总纲(R16)**：倒序发育⊕正序运作/三环自动闭合/二分处置/透明/治理 | ★ 收口 |
| `PRD-goal-metric-owner-spine.md` | 目标-指标-责任骨架(KSF/Metric/Principal,各视图 KPI 单一出处) | 新 |
| `PRD-nav-ia-reorg.md` | 左导航 IA 整理 + 层级字号 | 新 |
| `data-closure-fullchain.svg` | 数据闭环全链端到端图 | 图 |

## 3. 参考原型 1:1 复刻（→ 子索引 `PRD-reference-views-1to1-roadmap.md`）
七件齐：`cockpit-capacity`(dash+risk)· `aop`· `sop`· `quarter`· `plan-audit`· `plan-generate`· `order-project-sim`· `inference-process-enhancement`(横切)。全局 1:1=100%(唯色字可调),数据走管线。

## 4. A 系列工程（→ 子索引 `PRD-A-series-roadmap.md`）
A1–A18：求解器 MCP / 参考本体切片 / 对象浏览 / FDE 编排 / 真实值域 / B 栈 / CP-SAT / 外部引擎(设计延后) / 建域验证 / 连接类目 / 模块手跑 / 地板语义 / Agent evals / **A15 CLI 通用外壳** / **A18 未审核态全栈产出**。

## 5. 驾驶舱端到端闭合（增量族 · → `00-README-cockpit-closure-increment.md`）
> 解"驾驶舱问'本月未达成原因'答不出";按依赖顺序：
| # | PRD | 修哪环 |
|---|---|---|
| 1 | `PRD-llm-agent-empty-response-guard.md` | agent 裸崩→R7 错误 |
| 2 | `PRD-admin-self-approval.md` | 单 admin 定稿(解锁 R4 收尾) |
| 3 | `PRD-agent-data-generation-tools.md` | agent 合规产数据工具 |
| 4 | `PRD-empty-tenant-bootstrap.md` | 空租户 7 步引导清单 |
| 5 | `PRD-in-dialog-gap-fill-loop.md` | 对话框缺口卡→触发→续推 |
| 6 | `PRD-attainment-base-daily-timeseries.md` | 基地级日达成率序 |
| 7 | `PRD-attribution-routing-plan-audit.md` | 未达成原因→plan_audit+兜底 |

## 6. 数据/建域/自成长（底层管线）
`PRD-fullstack-story-build-g8` · `PRD-demand-pulled-growth-engine` · `PRD-unified-build-engine` · `PRD-prototype-intake-databuilder` · `PRD-synthetic-wizard-ontoprompt-chain` · `PRD-dogfooding-self-ontology` · `PRD-external-signal-domain` · `PRD-generic-inference` · `PRD-live-traceable-data` · `PRD-de-battery-multitenant-config`(G-5)。

## 7. addenda（横切增量）
`addendum-*`：a8-timeseries / agent-runtime / capability-routing / dataflow-loop-closure / execution-semantics / feature-entitlement / lived-in-state / llm-providers / m11-calibration / ontology-core / ontology-governance / operational-completeness / replay-orchestrator / skill-authoring / solvers-and-gaps / validation-loop / admin-platform / admin-console-closure / sim-views / remaining-views。

## 8. 交付与强制（给外部 dev agent）
| 件 | 作用 |
|---|---|
| `docs/00-START-HERE-AGENT-CONTRACT.md` | 强制契约(机械化 DoD) |
| `.github/workflows/gates.yml` | CI 门禁(PR 跑 build+test+pnpm gates) |
| `_PRD-TEMPLATE.md` | 新 PRD 模板(§0 本体引用必填) |
| `DEV-SOP-and-LOOP.md` / `LOOP-runbook.md` | 施工规程 |

## 9. 状态说明（诚实）
- 本轮新增 PRD(族 2/5 + spine/nav)**均为设计,未实现**;`pnpm gates` 绿=门禁过,≠功能可用(绿测试≠能用)。
- 本体已登记 R16 + 提案对象/门禁/事件/切片,**全标⏳待落**——记录"该长成什么",非"已实现"。
- 实现状态以代码 + 测试为准;dev agent 按 `00-START-HERE` 的机械化 DoD 验收。
