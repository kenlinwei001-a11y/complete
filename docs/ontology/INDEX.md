# 本体索引（母体克隆·层层索引入口 · 层 1）

<!-- 自动生成·勿手改 -->
<!-- ontology-hash: 7cbaa5d02e814400 -->
> ⚠ **由 `scripts/build-ontology-slices.mjs` 从母体 `docs/SYSTEM-ONTOLOGY.md` 派生。** 母体=唯一真相源；本目录=可追溯克隆切片（R-一致·不新增事实）。
> **协议**：先按下方"任务→切片"检索该读哪片 → 只读对应切片（简洁）→ 改接线改母体后 `node scripts/build-ontology-slices.mjs` 同步（门 `ontology-slices:check` 守漂移）。

> **这是平台的自我元模型——用平台自己的本体语言（对象类型 / 链路 / 规则 / 行动 / 检测 / 数据流）给平台自身建模。**
> **使用协议（强制）**：任何需求改进或 bug 解决，**先读本文 → 定位涉及的对象类型与链路 → 检查相关不变量 → 走对应检测门禁 → 再动手**。改完若新增/改变了某条链路或事件，**必须回写本文**（本文是系统接线的单一来源）。
>
> 版本 v1.0 · 日期 2026-06-15 · 锚点为 `file:line`（随代码演进需校准）。两系统：**DataCore A**（`apps/datacore`，`/a/v1`，170 端点）· **AgentCore B**（`apps/agentcore`，`/api/v1`+`/b/v1`，88 端点）· **frontend-shell**。

---

---

## 任务 → 切片 快速路由（层 1·先查这里）

| 我要做… | 读哪些切片/文档 |
|---|---|
| 改前端视觉/换肤/布局/新页 | 05-invariants(R-QUANT/R-PRD/R14/R17) · 07-gates · PRD-frontend-visual-redesign.md |
| 改链路/接线/跨模块改动 | 03-relations · 04-dataflow · 08-breakpoints · 10-self-domains(跨域节点) |
| 修 bug/为什么这里断了 | 08-breakpoints · 03-relations(接缝) · 10-self-domains §10.4 |
| 写/改 PRD/架构文档 | 05-invariants(全铁律) · 01-topmap · 对应域 02-object-types · 必含《本体引用与影响》 |
| 数据怎么进系统(连接器/合成/构建) | 02-object-types §A · 03-relations · 08-breakpoints(G-8) |
| 对象/派生/切片/建模 | 02-object-types §B · 05-invariants(R6/R11/R12) · 10-self-domains(类型血缘) |
| 求解器/校准/仿真/S&OP | 02-object-types §E · 03-relations(求解器↔计划) · 05(R6/R13/G-DM-1) |
| 推演沙盘 | 02-object-types §I · 05(R17/十红线) · PRD-frontend-visual-redesign.md §5 |
| 租户隔离/权限/Entitlement/审计 | 02-object-types §G · 05(R2/R3/R-AUDIT/R-DR) |
| QOS/Agent/Skill/意图/工作流 | 02-object-types §H · 03(中枢链) · 08(G-1/G-3/G-4) |
| 事件/失效/订阅刷新 | 04-dataflow · 05(R10/D-29) |
| 下发任务/写 WO(量化+PRD 纪律) | 05-invariants(R-QUANT 色号·R-PRD 整页) 必读 |

---

## 切片清单（层 2·逐节克隆）

| 切片 | 母体节 | 主题 |
|---|---|---|
| [`00-howto.md`](./00-howto.md) | §0 | 怎么用这个大脑（read-first 协议） |
| [`01-topmap.md`](./01-topmap.md) | §1 | 顶层地图 |
| [`02-object-types.md`](./02-object-types.md) | §2 | 对象类型目录（系统制品 = 自我本体的"实体"） |
| [`03-relations.md`](./03-relations.md) | §3 | 关系图谱（链路 = 模块间关系） |
| [`04-dataflow.md`](./04-dataflow.md) | §4 | 数据流与事件失效图（模块间数据关系的单一来源） |
| [`05-invariants.md`](./05-invariants.md) | §5 | 系统不变量（规则 = 改动不可违反的铁律） |
| [`06-actions.md`](./06-actions.md) | §6 | 行动（系统状态变更，多数经 Action 审批） |
| [`07-gates.md`](./07-gates.md) | §7 | 检测/门禁（改动必须过） |
| [`08-breakpoints.md`](./08-breakpoints.md) | §8 | 已知断点登记（截至 0614 全链审核） |
| [`09-evolution.md`](./09-evolution.md) | §9 | 演进与维护 |
| [`10-self-domains.md`](./10-self-domains.md) | §10 | 系统自我域 · 域内切片 · 跨域节点 |

---

## §0.5 快查索引（母体导航层·节号已 repoint 到切片）

> 本节只是**人读导航**：告诉你"要找 X 该跳哪一节 / 搜什么"。**零新事实**——所有真相仍在 §2〔→02-object-types.md〕–§10〔→10-self-domains.md〕 正文；改接线仍改对应正文节并按 §9〔→09-evolution.md〕 回写，**本节不承载、不回写接线**。（对机器读者：本节刻意不含可被 meta 投影解析的形态，见节末声明。）

**主表「我要找 X → 去哪」**（诉求 → 主节 / 相关节 / 相关不变量·断点）：

| 我要找… | 主节 | 相关 | 不变量 / 断点 |
|---|---|---|---|
| 数据怎么进系统（连接器 / 原始表 / 合成 / 构建发动机） | §2.A〔→02-object-types.md〕 数据接入域 | §3〔→03-relations.md〕 关系图 · §10.2〔→10-self-domains.md〕 D1 | R2 · G-8 |
| 对象类型 / 实例 / 派生 / 切片 | §2.B〔→02-object-types.md〕 本体对象域 | §10.2〔→10-self-domains.md〕 D2 · §10.3〔→10-self-domains.md〕 类型血缘 | R6 · R11 |
| 规则 / 约束 / 规则文档抽取 | §2.C〔→02-object-types.md〕 规则约束域 | §10.2〔→10-self-domains.md〕 D3 | G-10 |
| Action 审批 / 真值写回 / 出站执行 | §2.D〔→02-object-types.md〕 行动权限域 | §6〔→06-actions.md〕 行动 · §10.2〔→10-self-domains.md〕 D5 | R4 |
| 求解器 / 校准 / 仿真 / S&OP / 多源融合 | §2.E〔→02-object-types.md〕 求解推演域 | §3〔→03-relations.md〕（求解器↔计划）· §10.4〔→10-self-domains.md〕 | R6 · G-2 |
| 时序 / 模拟时钟 / 回放 / 达成率下钻 | §2.F〔→02-object-types.md〕 时序运营域 | §10.2〔→10-self-domains.md〕 D10 | R13 · R14 |
| 租户隔离 / 权限行级过滤 / Entitlement / 审计外流 | §2.G〔→02-object-types.md〕 治理平台域 | §5〔→05-invariants.md〕 · §10.2〔→10-self-domains.md〕 D6 | R2 · R3 · R-DR |
| 意图 / 执行计划 / QOS / Agent / Skill / MCP | §2.H〔→02-object-types.md〕 交互编排域 | §3〔→03-relations.md〕 中枢链 · §10.3〔→10-self-domains.md〕 问句到答案链 | G-1 · G-3 · G-4 |
| 场景包 / 场景卡 / 场景入口 / 视图 | §2.H〔→02-object-types.md〕 · §10.2〔→10-self-domains.md〕 D8 | §10.3〔→10-self-domains.md〕 场景启动链 | G-9 |
| 事件 / 失效 / 通知 / 订阅刷新 | §4〔→04-dataflow.md〕 数据流事件图 | §10.2〔→10-self-domains.md〕 D9 | D-29 |
| 灾备备份 / 恢复演练 / 审计 SIEM 旁路 | §2.G〔→02-object-types.md〕 治理平台域 | §4〔→04-dataflow.md〕（审计外流作业行）· DEPLOY 第 9 节 | R-DR · G-DR-1 |
| 系统不变量清单（改动铁律） | §5〔→05-invariants.md〕 系统不变量 | — | R1–R17 · R-QUANT · R-PRD · R-DR |
| WO/PRD/任务下发纪律（量化色号/尺寸·重构配整页 PRD） | §5〔→05-invariants.md〕 系统不变量 | 根 CLAUDE.md 关键约定 | R-QUANT · R-PRD |
| 检测 / 门禁（改完必过） | §7〔→07-gates.md〕 检测门禁 | §10.5〔→10-self-domains.md〕 | R11 闭包 |
| 已知断点登记 | §8〔→08-breakpoints.md〕 断点登记 | §10.4〔→10-self-domains.md〕 跨域节点 | G-1…G-15 · G-DR-1 |
| 系统自我域 / 域内切片 / 跨域接缝 | §10〔→10-self-domains.md〕 | §10.2〔→10-self-domains.md〕 / 10.3 / 10.4 | — |

**高频锚点速查**（纯文本要点，指向正文节号）：

- 中枢链（问句 → 答案）在 §10.3〔→10-self-domains.md〕；数据构建链在 §10.3〔→10-self-domains.md〕；断点几乎全落在跨域"接缝"节点，见 §10.4〔→10-self-domains.md〕。
- 求解器输出形状：先 §2.E〔→02-object-types.md〕，再 §3〔→03-relations.md〕（求解器↔计划接线）与 §5〔→05-invariants.md〕 的确定性铁律，断点看 §8〔→08-breakpoints.md〕 的 G-2。
- "绿测试 ≠ 能用"的总训在 §0〔→00-howto.md〕 结尾；read-first 五步也在 §0〔→00-howto.md〕。
- 不变量权威集与断点权威集由 §5〔→05-invariants.md〕 / §8〔→08-breakpoints.md〕 及机器索引维护；本表的 R / G 仅作"去哪找"的指路，非计数来源。

> 本节为人读导航，非机器投影源；meta 投影的元对象仍从 §2〔→02-object-types.md〕–§10〔→10-self-domains.md〕 正文抽取。本节刻意不含领域事件反引号形、切片键、加粗域形（Dn）、行首加粗制品名、真实文件锚点等可解析模式，以免污染投影计数（守 R6 确定性投影稳定）。

---
