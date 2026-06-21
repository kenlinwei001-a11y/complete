# TODO · 决策平台 PRD 套件（decision-platform-prd-pack）· 逐项追踪

> 来源：用户上传的 `decision-platform-prd-pack.zip`（25 文件 / 19 份 PRD + SOP + 路线图）。
> 施工规程 = `DEV-SOP-and-LOOP.md` 七步闭环（① READ → ② PLAN 契约先行 → ③ DEV 后端→前端→CLI →
> ④ T1–T12 工业级检测 → ⑤ 亲手跑通真服务/真 UI → ⑥ 回写本体 → ⑦ COMMIT），任一红回退。
> **波次 LOOP**：同波并行、跨波须前波 DoD 全绿才进。核心纪律：**绿测试 ≠ 能用**。
>
> 状态：✅ 完成（DoD 全绝 + 亲手跑通 + 本体回写）· 🔄 进行中 · ⬜ 未开始 · ⏸ 设计延后（裁决）
> 纪律：**完成一个标记一个，不能遗漏**。每轮回看本表，主动报"还差哪些"。
>
> ⚠️ 待负责人拍板（开工前置，SOP §0.5 / 五.1）：**基线分支** `wizardly-gauss`（推荐·超集）vs
> `vigilant-knuth`（当前工作分支）——涉 migration 序号 / `generateBattery` 字节回归 / `SyntheticPage` 分叉。
> 当前默认在 `claude/vigilant-knuth-b1nmxn` 推进（与既有指派一致）；如需切超集分支请明示。
>
> PRD 全文暂存于上传包；**实现某 PRD 时**再将其文本与《本体引用与影响》§0 落入本仓库 `docs/PRD-*.md`
> 并同步回写 §5 新不变量（R15 CLI 对等）等，避免 `prd:check` 悬空引用先红。

## 全局裁决（已定，写死）
- A9 仅设计延后（不引真依赖，守 R6）。
- A1 全部 28 求解器注册为 MCP 工具。
- A3 参考原型 16 域裁成 14 业务域（factory/product/process/equip/people/quality/capacity/forecast/sales/material/finance/plan/external/decision）。
- A11 连接 category 允许自定义值。
- A15 意图路由 = `POST /b/v1/operations/classify`；"求解器上传"不做 CLI 子命令 → CLI 输出深链跳 GUI。
- R15 CLI 对等 = 新不变量 + `cli-parity:check` 门 + PRD 模板必填（今后每功能必 CLI 打通或登记 GUI 深链）。

---

## Wave 1 · 基座（同波并行；A3 是 A4/A5/A10 前置）

- [ ] ⬜ **A3 · 14 域参考本体 + 域内/跨域两库 + 多跳切片规划器（图路径搜索）+ 切片索引**
  在 OntologyLink 图上做确定性路径搜索 → 自动产 SliceSpec；切片索引先查复用、查不到再规划。R1 R2 R6 R12 R14。
- [~] ◐ **A6 · 拟真值域合成数据（值落业务区间 + 确定性植入越线样本）**
  **A6.1 ✅** `GenSpec.valueDomain` + 值域库 `synthetic/value-domains.ts`(按属性语义配置化 R14) + `genValue`
  扩(normal/banded/uniform 确定性采样,落业务区间);**A6.2 ✅** `PlantSpec` + `applyPlantCrossings`(固定索引
  植入越线/近边界) + `autoPlant` 从 BLOCK 规则 `derivePlantFromRule` 反推 + `instantiateGeneric` opt-in 接入
  (护 R6 向后兼容) + `pnpm value-domain:check` 门(test-backed)。测试 a6-value-domains(×7:三形采样落区间+
  R6 字节一致+植入查准+lt 方向+规则反推)。datacore 470 全绿(+7,无字节回归:synthetic/genspec/scale-baseline 通过)。
  **余(诚实)**：A6.3 电池路收编同机制(generateBattery 未改→字节保持,收编后续);**全服务 e2e 未跑**——
  注册自定义模板跑 synthetic job 被无关的模板 plumbing(views/workspace)500 挡住,逻辑由 7 单测+门+无回归验证,
  **未亲手过真服务合成路**(守"绿测试≠能用",诚实标 ◐ 非 ✅)。回写本体 §2.A/§8(G-5 8f)。
- [x] ✅ **A11 · 连接创建打 `Connection.category` 标签（per-instance 归类，可自定义值）**
  Connection 加可覆盖 category（默认取连接器类型 registry category）+ RawDataset 溯源继承 `sourceCategory` +
  `GET /a/v1/connector-categories`（内置并集 + 本租户已用值，R2 隔离）+ `connection.created` 事件（§4 L8）+
  前端归类列/筛选/向导可自由输入 category。**亲手验**：Playwright 截图 connections 页归类列 + MES 自定义徽章。
  测试：datacore a11(×5 含 R2) + frontend f56；ontology:check 过。**注**：Connection 是 JSONB doc 存储，
  无需 migration（PRD 的 ALTER TABLE 假设列式存储，实际架构是 doc store）。CLI/R15 待 A15 落地后补登记。

## Wave 2 · 引擎/能力（A1 是 A8/A7 暴露口；A13 让 A14 去抖；A4 依赖 A3/A11）

- [ ] ⬜ **A1 · 28 求解器暴露为 MCP 工具**（MCP 页可治理 + agent 经 mcp-router 可调，OBO 代理到 /a/v1/solvers）。R3 R5 R8 R11。
- [ ] ⬜ **A8 · 扩 CP-SAT 模型**：assignment（订单→基地/产线）/ sequencing（换型排序）/ packing（产能装箱）。R6。
- [ ] ⬜ **A13 · 通用图求解器地板语义确定化**（concentration_risk/supplier_disruption_radius 去 Kimi，root/via/优先级/叶层确定性消歧）。R6。
- [ ] ⬜ **A4 · 对象/类型浏览器管理页**（按 14 域分组列已发布类型 + 物化计数 + 下钻实例）。R2 R3 R14。

## Wave 3 · 编排/闭环

- [ ] ⬜ **A5 · FDE 编排工作流·可观测节点状态图**（意图→倒推→查能力→比差→各模块生成→进启动器）。R10 R11 R13。
- [ ] ⬜ **A7 · B 栈 scaffold 单机可见**（不配 AGENTCORE_BASE_URL 也能看到生成的 agent；DataCore 侧持久可见）。R8 R11。
- [ ] ⬜ **A10 · 终态闭环末步**（建域→R4 审批→publish→**自动重跑问句验证** "现在真能答了"）。R4 R11 R13。

## Wave 4 · 验证/扩展

- [ ] ⬜ **A14 · 亲手跑 agent evals 比对 PRD**（真 Kimi env-gated，观测 vs 期望 diff，parity 报告）。R6 R8。
- [ ] ⬜ **A12 · 其余模块逐一 hand-run 补全**（连接器/对象浏览/Agent 页/规则/校准…，系统化铺 hand-run 纪律）。FDE 纪律。
- [ ] ⏸ **A9 · 外部引擎接入点设计（Datalog/图库/因果）— 仅设计延后**（不实现真依赖，守 R6 自包含；产设计 PRD 即算交付）。R6。

## Wave 5 · CLI / intake

- [ ] ⬜ **A15 · CLI 通用操作外壳**（意图识别→模块路由→CLI 交互补参→触发模块；含 QOS 推演问答；全模块↔CLI 对等矩阵）。R15。
- [ ] ⬜ **prototype-intake · 原型 intake 正门 + schema 对账 HITL**（上传 HTML/原型→抽数据/关系→InputManifest→建域；列不符弹 SchemaReconcile 人确认）。

## 特性（已 APPROVED，可独立排期）

- [ ] ⬜ **cockpit · 经营驾驶舱 + 产能推演 参考原型 1:1 复刻**（数字全部从本体关系算出=数据闭环，非写死/非挪配置）。
- [ ] ⬜ **synthetic-wizard · 合成向导「生成进度」按 nano-ontoprompt 分阶段集成链重设计**（把"看数据逐阶段策展本体"的 UX 精髓真正落进页面，非仅算法）。

---

## 进度账（每完成一项回填）
- 合计：21 项（19 PRD + A9 设计延后 + 2 特性）。完成 **1 ✅ + 1 ◐ / 21**。
- ✅ A11（per-connection 归类，Wave 1，亲手验过真 UI）。
- ◐ A6（拟真值域 + 越线植入，A6.1/A6.2 逻辑完成+门+无回归；A6.3 收编 + 全服务 e2e 待补）。
- 下一步：Wave 1 余 **A3**（14 域本体 + 多跳切片规划器，最大、是 A4/A5/A10 前置）→ Wave 1 收尾后进 Wave 2。
