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

- [~] ◐ **A3 · 14 域参考本体 + 域内/跨域两库 + 多跳切片规划器（图路径搜索）+ 切片索引**
  **A3.3 ✅（keystone）多跳切片规划器**：`ontology/slice-planner.ts planSlice` 在 OntologyLink 图上确定性
  BFS 最短路 + 固定 tie-break（跳数→域内边优先→toType 字典序→linkKey 字典序）→ SlicePlan（root→每目标
  最短路 + 路径证据 + 跨域集），搜不到→NO_PATH(unreachable[])；纯函数 R6 字节一致；`POST /a/v1/slices/plan`
  (R2 仅本租户图) + 契约 `contracts/slice-planner.ts` + 门 `pnpm slice-planner:check`。测试 a3-slice-planner ×9
  (链式/多目标/反向 in 边/NO_PATH/maxHops/R6/tie-break 域内优先 + 端点 root===target/未知类型/R2 空租户)。
  回写本体 §2/§10.1。
  **A3.1 ✅ 14 域注册表**：`graphmeta.ts BUSINESS_DOMAINS`(14 域 key/显示名/配色/primaryTypes，新增 sales/material/
  finance/external/decision 5 域，配置驱动 R14)+ `GET /a/v1/business-domains` + GRAPH_DOMAIN 补 ExternalSignal→external。
  测试 a3-business-domains ×4(恰好 14 域/无野域/primaryTypes 自洽/端点)。**A3.1 余**：参考本体基线(元租户 95 节点)数据量大待后续。
  **A3.4 ✅ 切片索引复用 + slice.planned 事件**：`ontology/slice-index.ts buildSliceIndex/resolveSpannedTypes/
  lookupReusable`(派生投影 R13——沿 link 图解析每切片覆盖类型集，按 rootType 索引)；`POST /a/v1/slices/plan`
  先查索引命中即复用(reused:true)、未命中才新规划 + `GET /a/v1/slices/index` + `slice.planned` 事件(§4 L1)。
  测试 a3-slice-planner +4(resolveSpannedTypes/lookup 复用/tie-break 最贴合/端点索引)。回写本体 §2/§4。
  **A3 余分期**：A3.2 域内/跨域两库派生(biz.<域>.<形状> / biz.x.<seam>)。**A3.1 参考本体基线**。
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
- [ ] ⬜ **A16 · LLM 临时求解器（origin=LLM · 沙箱跑通 · 可溯可替换 · 受治理晋升）**（用户新增需求，修订"求解器不可由 LLM 生成"红线）：
  缺求解器时 LLM 生成 `{compute 纯函数 + outputSchema + rationale}` → **冻结 SolverArtifact(hash+版本 R6)** → **锁死沙箱跑通自检**(无网络/fs/clock/random，R5) → 注册 `origin=LLM_PROVISIONAL, status=PROVISIONAL, trustLevel=UNVERIFIED` → 推演可调(全程标"临时·未验证" R13)，**输出不可自动写真值(R4)** → 人工 看代码/编辑/替换/晋升(VLE+校准 advisory+审批→GOVERNED 解锁写真值)。分期 A16.1 沙箱+SolverArtifact+`solver-sandbox:check` · A16.2 LLM 生成+跑通+注册+写真值门控 · A16.3 人工生命周期+MCP 标+接 A5/A10。
  **⚠ 开工前需用户确认 2 点**：① 沙箱技术(默认 isolated-vm 进程内 V8 隔离;或子进程/容器;或 Python sidecar) ② 临时求解器能否写真值(默认**不能**,晋升 GOVERNED 才解锁——若要临时件也能写真值需明确接受"未验证逻辑进真值链"风险)。

## 特性（已 APPROVED，可独立排期）

- [ ] ⬜ **cockpit · 经营驾驶舱 + 产能推演 参考原型 1:1 复刻**（数字全部从本体关系算出=数据闭环，非写死/非挪配置）。
- [ ] ⬜ **synthetic-wizard · 合成向导「生成进度」按 nano-ontoprompt 分阶段集成链重设计**（把"看数据逐阶段策展本体"的 UX 精髓真正落进页面，非仅算法）。

---

## 进度账（每完成一项回填）
- 合计：**22 项**（20 PRD[+A16 新增] + A9 设计延后 + 2 特性）。完成 **1 ✅ + 2 ◐ / 22**。
- ✅ A11（per-connection 归类，Wave 1，亲手验过真 UI）。
- ◐ A6（拟真值域 + 越线植入，A6.1/A6.2 完成+门+无回归；A6.3 收编 + 全服务 e2e 待补）。
- ◐ A3（**keystone A3.3 多跳切片规划器**完成+门 9 测；A3.1 域基线 / A3.2 两库 / A3.4 索引待补）。
- 下一步：补 A3 余分期（A3.1→A3.2→A3.4）收尾 Wave 1，或先把 A6 尾巴补 ✅；再进 Wave 2。
