# PRD · <标题>

> 任何 PRD 必须先读 `docs/SYSTEM-ONTOLOGY.md`（或 `/ontology`），并填写 §0《本体引用与影响》。
> 删除本行与上一行后开始编写。命名禁用外部产品名（用平台自有术语）。

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 YYYY-MM-DD |
| 取代/扩展 | <旧 PRD 或 "新建"> |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · <相关 PRD> |

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（本体 §2）：<如 Intent / ExecutionPlan / Solver / Connector …>
- **触及链路**（§3）：<如 ScenarioCard→Intent→Plan→Solver→render>
- **触及事件/数据流**（§4）：<新增或改动的领域事件 + 下游订阅；遵守 D-29>
- **触及不变量**（§5，R1–R15）：<本变更如何满足 tenant_id / entitlement 先于 authz / 真值经 Action / 确定性 / 全链闭包 R11 / 应用层无业务常数 R14 / **CLI 对等 R15** …>
- **CLI 打通（R15，强制）**：<本功能是否对外模块能力？若是，其 **CLI 等价命令**（注册进 `OPERATION_CATALOG`，复用同一 REST/R3/R4/事件）= ？；纯 GUI-only 须在此声明理由。详 `PRD-A15-cli-universal-operation-shell.md`。>
- **关闭/影响的已知断点**（§8）：<G-1…G-8 中本 PRD 解决或触及哪些>
- **需走的检测门禁**（§7）：<闭包门 / validate / 准备度 / A6 / VLE / 断链审计 / **cli-parity:check（R15）**>
- **回写承诺**：本 PRD 落地后需回写本体 §<…>（新增/改变的对象类型/链路/事件/门禁）。

## 1. 目标 / 非目标
## 2. 现状与缺口（对照代码，带 file:line）
## 3. 设计（复用现有接缝优先；标清"复用 / 绿地新建 / 门禁新增"）
## 4. 契约 / 端点 / 数据模型（双仓储四处同改；contracts-only-shared）
## 5. 关键流程（端到端，沿链路）
## 6. 非功能与约定（§5 不变量逐条满足）
## 7. 验收（DoD：构建/测试全绿 + parity + ontology:check + 该期回归锁）
## 8. 分期
