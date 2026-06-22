# 交付包 · 参考原型全视图 1:1 复刻 + 经营骨架（补充说明 / 给开发 agent）

> 本包是「年度规划(AOP)页面差异」问题展开后产出的一整套 PRD：**参考原型全业务视图的 1:1 复刻专项（7 份子 PRD + 1 份总纲索引）+ 一条横向底座（经营目标-指标-责任闭环骨架）**。开发在 `claude/vigilant-knuth-b1nmxn` 分支进行。

## 0. 先读这两条（否则返工）
1. **铁律 0**：动任何代码前先完整读 `SYSTEM-ONTOLOGY.md`（系统接线单一来源）。改了链路/事件/对象类型/不变量/门禁，**必须回写本体对应章节**（本体不回写即过期失效）。
2. **绿测试 ≠ 能用**：断点常在模块接缝而非模块内部；分析必须**沿链路走**（合成→物化→派生/求解器→渲染）。前端绿 ≠ 数据真的从管线流通。

## 1. 包内容与阅读顺序
| # | 文件 | 作用 | 何时读 |
|---|---|---|---|
| 1 | `PRD-reference-views-1to1-roadmap.md` | **总纲/索引**：全 19 视图覆盖图谱、子 PRD 队列、全局决定 | **最先读** |
| 2 | `PRD-goal-metric-owner-spine.md` | **横向底座**：KSF/Metric/Principal 一等对象，各视图 KPI 单一出处 | 第二读（决定先落否） |
| 3 | `PRD-aop-annual-scenario-1to1.md` | 年度情景规划台（AOP） | 按队列 |
| 4 | `PRD-sop-balance-1to1.md` | 月度 S&OP（补 P90 列/MRP 物料线/量价本利表/版本对比） | 按队列 |
| 5 | `PRD-quarter-rolling-1to1.md` | 季度滚动看板（主要是生成器调参复现精确值） | 按队列 |
| 6 | `PRD-plan-audit-1to1.md` | 规划体检（时序逐日圆点轴 + KSF 图，1:1 交互） | 按队列 |
| 7 | `PRD-plan-generate-1to1.md` | 规划建议/方案生成（复用 audit 时序+KSF） | 在 audit 之后 |
| 8 | `PRD-order-project-sim-1to1.md` | 项目推演/订单全链（三判+11节点DAG，model 融入） | 按队列 |
| 9 | `PRD-inference-process-enhancement.md` | 推演过程展示增强（横切 DAG，最后接入） | **最后** |
| — | `SYSTEM-ONTOLOGY.md` | 系统本体（铁律 0） | 贯穿 |
| — | `reference-prototype-decision-platform.html` | **1:1 的唯一真相源**（精确数值/字符串/交互按此还原） | 贯穿 |
| — | `REFERENCE-HTML-INVENTORY.md` | HTML 视图清单 | 参考 |
| — | `DEV-SOP-and-LOOP.md` | 施工规程与闭环 loop（通用） | 开工前 |

## 2. 基线分支说明（重要，已核验）
- 开发分支 `claude/vigilant-knuth-b1nmxn`。**已直接核验：该分支 `apps/`+`packages/` 源码与本批 PRD 锚定的代码字节一致（零差异，550=550 文件）**——PRD 里每个 `file:line` 锚点在 vigilant-knuth 上都能对上，可放心使用。
- 本分支需补两点：
  1. 把本包 PRD 放入 `docs/`（vigilant-knuth 原本没有这些 PRD）。
  2. `SYSTEM-ONTOLOGY.md` 需应用 **R15（CLI 对等）** 不变量——**直接用本包内的 `SYSTEM-ONTOLOGY.md` 覆盖**即可（已含 R15 + `cli-parity:check` 门）。

## 3. 1:1 标准（全局，硬约束）
**1:1 = 100%**：**结构 / 功能 / 数据值 / 交互 逐项 100% 对齐 HTML**；**唯色调(配色)与字体可调**。
- HTML 的精确演示数值/字符串/逐项交互都要还原，**但不在前端写死**——把这些值作为**电池域生成器种子配置**产出（不变量 R14 前端零业务常量、R6 同 (industry,seed) 字节一致），数据仍走管线（合成→物化→派生/求解器→声明式渲染）。
- 系统已强于 HTML 的活能力（活求解器/真规则/Action 审批/溯源）**保留为底层实现**，只要可见的数值/结构/交互与 HTML 100% 一致即可；系统独有的额外 UI 收为不破坏 1:1 基线的附加增强（可隐藏/次级）。

## 4. 实施顺序与依赖（建议）
1. **先落骨架或同期**：`spine`（Metric/KSF/Principal）是各视图 KPI 的单一出处底座——否则各视图各拼 KPI 会返工。
2. **AOP / SOP / quarter**：计划域三视图，共享 planview 口径（改生成器要同跑这三者 + 产能推演回归防漂移）。
3. **audit → generate**：generate 复用 audit 的 `audit_timeline` + `KsfGraph`，**audit 先行**。
4. **order**：需新落 `order_fullchain` 求解器（三判 + C18 现金闸 + 11 节点 DAG）。
5. **inference-process**：横切，建议 ≥1 个推演视图(order/risk)就绪后再接入。

## 5. 跨 PRD 归一表（防重复建模，务必遵守）
| 概念 | 归一为 | 出处 |
|---|---|---|
| `PlanKpi`（cockpit） | = `Metric`(plan 域投影) | spine PRD |
| `KsfGraph`（audit/generate） | = `KSF` 对象的图渲染 | spine PRD |
| `MaterialBalance` | sop ③物料线 与 cockpit **同一对象**，择一先落另一引用 | sop / cockpit |
| `audit_timeline` + `KsfGraph` | audit 先落，generate **复用同组件** | audit → generate |
| `order_fullchain` | cockpit 提案 → order PRD **落地** | cockpit / order |
| owner 字符串 | = `Principal` 结构化对象 | spine PRD |
| story 编排 DAG / model 收敛网络 | = `<InferenceProcessDag>` 一个组件两模式 | inference-process |

> 注：`PRD-cockpit-capacity-1to1-parity.md`（经营驾驶舱+产能推演，含 6 个新对象类型与 order_fullchain 提案）是本批多份 PRD 的上游依赖。若它不在本包，请向交付方索取——sop/order/spine 与其共享对象。

## 6. 每份 PRD 的通用验收门禁（DoD）
- `pnpm -r build && pnpm -r test` 四包全绿（datacore/agentcore/frontend/contracts）。
- `debattery:check`（前端零业务常量）· `chain:check`（新求解器注册+链路）· `ontology:check`（新对象类型登记）· `prd:check`（本体引用无悬空）· `cli-parity:check`（R15，新能力须有 CLI 等价或 GUI 深链）。
- **FDE 亲手跑**：不是绿测试，而是真人按链路把该视图的数据从生成→物化→派生→渲染走一遍，核对可见数值=HTML。
- **回写本体**：新增/改动的对象类型/链路/事件/不变量/门禁 → 回写 `SYSTEM-ONTOLOGY.md` 对应章节。

## 7. 命名纪律
- 禁用外部产品名（OntoFlow 等是参考产品），一律用平台自有术语。
- 错误信封统一 `{ error: { code, message, requestId } }`；租户隔离 tenant_id everywhere；凭据 AES-GCM 不回显。
