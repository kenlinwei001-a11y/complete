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
- **触及不变量**（§5，R1–R16）：<本变更如何满足 tenant_id / entitlement 先于 authz / 真值经 Action / 确定性 / 全链闭包 R11 / 应用层无业务常数 R14 / **CLI 对等 R15** / **发育闭环 R16**（产物三环自动闭合 + AUTO-DERIVE/NEEDS-HUMAN 二分处置）…>
- **CLI 打通（R15，强制）**：<本功能是否对外模块能力？若是，其 **CLI 等价命令**（注册进 `OPERATION_CATALOG`，复用同一 REST/R3/R4/事件）= ？；纯 GUI-only 须在此声明理由。详 `PRD-A15-cli-universal-operation-shell.md`。>
- **关闭/影响的已知断点**（§8）：<G-1…G-8 中本 PRD 解决或触及哪些>
- **需走的检测门禁**（§7）：<闭包门 / validate / 准备度 / A6 / VLE / 断链审计 / **cli-parity:check（R15）**>
- **数据闭环合规（强制 · `PRD-data-closure-spec.md` §6）**：本 PRD 若新增/改动任何**数据、对象、字段、指标、模块**，必须逐项声明达成（填 ✅+锚点）或豁免（填 `// 理由`）。漏项 = `prd:check` 红。**仅纯前端/纯文档/不碰数据的 PRD 可整体标 `// 不涉数据闭环` 跳过。**

  ```
  [ ] T1 schema 单一源：对象类型在 ObjectType 注册（非前端/求解器内联）
  [ ] T2 模版：新数据经 IndustryTemplate 上传/编辑/fork（不写死代码常数）
  [ ] T3 双层：精确值入种子配置(可编辑)，非 bespoke 代码
  [ ] I1 登记：新类型登记 data-categories.ts（三模式 connectorTypeKeys）
  [ ] I2 上传闭环：上传→建模→发布(Action)→自动重生成 路径声明
  [ ] M1 物化走 R4；M2 派生/时序登记
  [ ] S1 切片：自动 coverage slice + 场景 mustIncludeTypes 含新类型
  [ ] S2 求解器注册 + chain:check 过
  [ ] V1 声明式渲染 ViewDef（前端零写死 R14 / debattery:check）
  [ ] V2 溯源 R13（Provenance + 派生级 lineage）
  [ ] C1 闭包 HARD 过；C3 缺口诚实（断显 GapReport 码）
  [ ] C2 真值经 Action 审批；C4 backfill 脚本 + SOLVER_TARGET_VIEW
  [ ] X1 tenantId；X2 确定性 + 字节一致测试；X3 事件失效 ≤60s
  [ ] X4 KPI 注册进 Metric(target/actual) + Principal(owner)
  [ ] X5 数据源健康/新鲜度→P90；X6 CLI 命令 + cli-parity:check
  ```
  > 单一上传口铁律：同一字段只能一个 DataCategory/来源（避免互斥，R-一致）。全链图见 `docs/data-closure-fullchain.svg`。
- **回写承诺**：本 PRD 落地后需回写本体 §<…>（新增/改变的对象类型/链路/事件/门禁）。

## 1. 目标 / 非目标
## 2. 现状与缺口（对照代码，带 file:line）
## 3. 设计（复用现有接缝优先；标清"复用 / 绿地新建 / 门禁新增"）
## 4. 契约 / 端点 / 数据模型（双仓储四处同改；contracts-only-shared）
## 5. 关键流程（端到端，沿链路）
## 6. 非功能与约定（§5 不变量逐条满足）
## 7. 验收（DoD：构建/测试全绿 + parity + ontology:check + 该期回归锁）
## 8. 分期
