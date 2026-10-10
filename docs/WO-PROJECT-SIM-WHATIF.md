# WO-PROJECT-SIM-WHATIF · 项目推演⑥ What-if「焊死 3 滑杆」→ 本体派生·瓶颈反推·敏感度排序的动态杠杆集（走 generic_inference 真重算）

**派发对象**：整单一个 fresh dedicated dev（**跨前端面板重构 + 可能补 `generic_inference` 薄封装/杠杆发现服务** = 数据/引擎两半必须同一 dev 整单做，不得拆两半用不同机制不对接 —— 这是 metric-aware 反复炸的根）。
**基线**：`claude/inspiring-gates-aqczjg` @ `0736908d`（原稿基于 c52f6600；已推进 scale-coherence + m11-fix + Tier-3·89 类型/11082 实例·四包全绿。**本单依赖 SCALE-COHERENCE 已满足**——gwh 派生产能已入 canonical，瓶颈反推可读真产能。dev 请 rebase 到 `0736908d` 开工，勿基 c52f6600）
**handoff 分支**：`claude/handoff-project-sim-whatif`（dev 建 → push，不碰正线）

> **⚠ 依赖 note（先落再收本单）**：本单杠杆敏感度/真重算**有意义的前提是产能尺度自洽** —— 依赖 **WO-SCALE-COHERENCE 先落**。原因：当前 P50/gap 是 `capacity_forecast` **求解器内部聚合**，不是本体派生属性（`baseDerived` 仅 `orderCount/committedQty/oeeIndex`，`battery.ts:412-417`；无 `weeklyCap/P50` 派生），`generic_inference` 的前向重算只能到达**已建模的派生属性**。若产能相关量未由 WO-SCALE-COHERENCE 升成派生链（OEE/利用率/良率 → 产能 → gap 的派生 DAG），本单杠杆撬动的将是**玩具级派生数字**，敏感度排序不指向真产能。**本单 SEAM 亲验必须在 WO-SCALE-COHERENCE 合并态跑**（接缝驱动通，非各半绿）。

---

## 🚦范围边界

**只碰**：
- `apps/frontend-shell/src/views/sim/ProjectSimView.tsx` —— ⑥「结论与对策」的 what-if 面板 + whatIf state + 传参（**本单重构主战场**）。
- 新增前端子组件（如 `apps/frontend-shell/src/views/sim/DynamicLeverPanel.tsx`）承载动态杠杆集 + tornado 条（从 ProjectSimView ⑥ 拆出，保 ProjectSimView 可读）。
- `apps/frontend-shell/src/locales/zh.ts` —— 杠杆/边界/tornado i18n 文案（R14：文案下发不内联）。
- **接线/registry**：`apps/frontend-shell/src/views/registry.ts`（若需暴露 project-sim 的 layout 配置）、`apps/frontend-shell/src/api/endpoints.ts`（若加杠杆发现调用薄封装）。
- **可能补 `generic_inference` 薄封装/杠杆发现能力**（净室·确定性·服务端算敏感度）：`apps/datacore/src/solvers/service.ts`（`genericInference` 旁加 `mode:"levers"` 或新 companion，见实施②③）+ 其契约/输出形状登记 + `apps/datacore/src/solvers/service.ts:136-198` `SOLVER_OUTPUT_SHAPES` 同步。
- SEAM 组合测（前端 + datacore）。

**禁碰**：
- **求解器算法本体**：`capacity.ts`（capacityForecast 数学）、`risk.ts bottleneckMatrix/liveTightness` 数学、`ontology-core.ts recompute` 前向重算引擎算法（只读它、只加"反向依赖查询/杠杆发现"薄层，**不动 recompute 数学**）。
- 其他视图（WhatIfView / MultiObjWhatifPanel / RiskBoardView / 驾驶舱 …）—— 本单不重构它们；WhatIfView 仅作**参照实现**复用其形状。
- C08 等规则 DSL 定义（`livedin/engine.ts`）—— 只**读**规则闸值作杠杆边界，不改规则。

---

## 目标

把 ⑥ 的**焊死 3 滑杆**（夜班 0-3 / 加产线 0-6 / 外协 0-20%，`ProjectSimView.tsx:851-895`，焊进 `capacity_forecast` 契约 `whatIf:{nightShifts,extraChannels,outsourceRatio}` @ `:178-187`）替换为：

**每个项目显示"能撬动它自己瓶颈的那几根杠杆"** —— 杠杆集**自本体派生 + ⑤步瓶颈反推 + 敏感度排序**动态生成（物料卡的项目出物料杠杆、产能卡出产能杠杆、各项目随瓶颈变），拖动某杠杆走 **`generic_inference` 真重算**（沿派生 DAG 前向重算 → before/after deltas + 每值 provenance），**非焊死 `capacity_forecast`、非客户端算敏感度**。保留 A/B 对比 + 规则闸提示 + 缺口归零 UX。

这正是 Palantir 的 what-if 本体：引擎（`generic_inference` = `recompute(dryRun)` 通用包装，`solvers/service.ts:79-81,146,422-440`·G-5 §8e）**平台已建好**、只是项目推演面板没调它（现调焊死的 `capacity_forecast`）。

---

## 实施

### ① 从 ⑤瓶颈 + 派生 DAG 反推候选杠杆集

**瓶颈种子（已在手·⑤步真数据）**：
- `out.perBaseRows[].bottleneck`（瓶颈名）/ `.tightness`（紧张度）/ `out.mainBn`（主瓶颈），渲染于 `ProjectSimView.tsx:737-787`。
- ⑤ 多维瓶颈矩阵 `bottleneck_matrix`（LIVE）：`ProjectSimView.tsx:191-201` 已按需取 `{factors, rows[].tightness[factor], rows[].primary}`。求解器 `solvers/risk.ts:67-89`；因子集 `c.params.bottleneck.factors`（**R14 参数化，非内联**）。

**因子 → 可写对象输入属性映射（杠杆的落点·honest 来源）**：`risk.ts liveTightness`（`:44-61`）已把瓶颈因子映到具体对象属性 —— 这就是"撬得动该瓶颈"的真输入：
- `设备OEE` → `Equipment.oee_current`（per base）
- `利用率`（产线） → `Line.utilization`
- `良率波动` → `Process.yield_baseline`
- （物料齐套/物流/换型/检修等 MOCK 因子 → 对应 `MaterialBalance`/换型/检修对象属性，随本体扩展补映射表）
- 这些叶输入前向喂 `baseDerived.oeeIndex = AVG(Equipment.oee_current BY baseId)`（`battery.ts:412-417`）等派生 → 再喂产能（WO-SCALE-COHERENCE 落的派生链）。

**反向依赖机制（"杠杆自 DAG 反推"的引擎来源）**：`ontology-core.ts recompute` 内部已构 **正向依赖索引** `propToSpecs`（`:391-398`，`${typeKey}.${prop}` → 消费它的派生 spec）；每条 `DerivationSpecRecord.deps:[{typeKey,prop,via?,direction?}]`（`domain.ts:399`）声明该派生的输入。**反向 walk** = 从目标派生属性（产能/gap 相关派生 target）取其 spec.deps → 若某 dep 本身是派生 target（另一 spec）则递归 chase（沿 `topoSort` 逆序）→ 落到**叶输入属性（非派生·可写）= 候选杠杆**。

> **现状：无现成的对外反向依赖查询 API**（`propToSpecs` 是 `recompute` 内部局部量，不导出）。本单二选一：
> - **优先**：补一个**净室薄层**（服务端·确定性 R6）做反向 walk —— 建议作 `generic_inference` 的 `mode:"levers"`（`service.ts:422` `genericInference` 旁），入参 `{rootTypes|targetType,targetProp}`，读 `derivationSpecs.list` + 逆 walk deps → 候选杠杆 `{objectType,prop}` 集。**不动 recompute 数学**。
> - **退化（若产能派生链未就绪或反向 walk 覆盖不到 solver-internal 目标）**：**候选杠杆 = ⑤主瓶颈对象类型的可写（非派生）输入属性**（用 `risk.ts liveTightness` 的因子→属性映射 + `bottleneck_matrix.primary` 取每基地主因子对应属性）。此退化路径**同样满足**"杠杆随瓶颈变"（因子由 ⑤ 真算），且不依赖派生链完备。**WO 二选一由 dev 视 WO-SCALE-COHERENCE 落地形态定，但必须服务端算、可溯 R13。**

### ② 每杠杆 `generic_inference` dryRun ±ε 算敏感度 ∂目标/∂杠杆 → 排序

对候选集每根杠杆，取该项目 scope 内真对象实例（可产基地的 `Equipment/Line/Process/...` 实例，`objectId` 从对象图取，**非写死**），以当前值 ±ε 各跑一次 `recompute(dryRun,apply)` → 取"产能/gap 相关目标派生属性"的 after 差 → **敏感度 = Δ目标 / Δ杠杆**。按 |敏感度| 排序。

- 引擎：`solvers/service.ts:426-440` `genericInference` → `ontologyCore.recompute(ctx, changes, {dryRun:true, apply:[{objectId,prop,value}]})`（`ontology-core.ts:341-542`；克隆图不落真值 `:365,368-373`；dryRunDeltas `:496-497`）。
- **服务端算敏感度（铁律"非客户端算"）**：把 K 根杠杆 × 2 探针（±ε）的 dryRun + 敏感度打分**收进 `mode:"levers"` 一次调用服务端算**（避免 K×2 次前端 round-trip 且把数学留服务端 R6/R14）。输出每杠杆 `{objectType, prop, unit, currentValue, sensitivity(∂目标/∂杠杆), bound{min,max}, provenance}`，按 sensitivity 排序取 **top-K**。
- **确定性 R6**：ε、探针、排序 tiebreak 全确定（`recompute` 无 Date/random；同输入同输出）。

### ③ top-K 出滑杆 + tornado 条

- 每根杠杆一条滑杆（label/unit 来自对象属性元数据 + i18n，`zh.ts` 扩），**动态渲染 top-K**（非焊死 3 根）。
- **tornado 条** = 各杠杆敏感度横条按 |∂目标/∂杠杆| 降序（tornado 排序 = ②的真敏感度，**非写死顺序**）。
- 参照 `WhatIfView.tsx` 的 deltas 表 / 方向箭头（`:59-67 deltaDir`）/ 诚实空态（`:240-253`）复用形状。

### ④ 边界自本体 / 规则闸（R14：边界非内联）

- 外协类杠杆上限 **C08** = `Order.outsourceRatio > 0.2`（当前 PUBLISHED v1.3，`livedin/engine.ts:660-662,685`；求解器侧 `extended.ts:258` cap=`totalDemand*0.2`；参数 `battery.ts:119 whatIf.outsourceMax:0.2`）—— 杠杆 `bound.max` **读规则闸/参数**，不内联 `20`。
- 其余杠杆边界（OEE/利用率/良率的物理域 0–1、节拍上限等）取对象属性 `valueDomain`/`solver_params`（R14 值域库 G-5 §8f，`synthetic/value-domains.ts`），缺则物理域兜底并标注。
- 触边界 → 提示（复用现有 C08 提示 UX，`ProjectSimView.tsx:896-900`；i18n `zh.ts:502 outsourceCap`）。

### ⑤ 拖动 → `generic_inference` recompute 真重算 → deltas + provenance（非焊死 `capacity_forecast`·非客户端算）

- 拖动某杠杆 → 以 `{objectType,objectId,prop,value}` 调 **`generic_inference`**：
  - **live 路径（保竞态最后发出者胜 + debounce）**：复用 `useLiveSolver("generic_inference", {apply:[...]}, parse)`（`useLiveSolver.ts:19-73`，debounce 300ms + AbortController，B 侧 `runSolver`→`POST /b/v1/solvers/generic_inference/run`，`endpoints.ts:202-206`）。**替换** ⑥ 现在的 `useLiveSolver("capacity_forecast", {…whatIf:{nightShifts,extraChannels,outsourceRatio}})`（`ProjectSimView.tsx:178-187`）。
  - 或 A 侧 `invokeSolver("generic_inference", {apply:[...]})`（`endpoints.ts:184-185`→`POST /a/v1/solvers/generic_inference/invoke`，返 `{deltas,rows,affectedObjects,count,rootTypes}`）/ 精简端点 `POST /a/v1/inference/whatif`（`app.ts:2512-2527`，返 `{deltas,affectedObjects}`）。**live 拖动优选 useLiveSolver 版**（已有 race/debounce 纪律）。
- 面板忠实投影 deltas（before/after + 方向）+ 影响面计数（`affectedObjects/count`）+ **每 delta provenance**（R13：来源=`generic_inference`·派生公式取自 spec.formula·输入取自 recompute 捕获的 `inputs` `ontology-core.ts:474-490` → `derivationValueRuns`；前端复用 `<Provenance>` 组件 `ProjectSimView.tsx:820-843,921-932`）。
- **MSW 可跑**：mock 桩已在 `mocks/handlers.ts:1278-1286`（A 侧 generic_inference 确定性桩·after 随假设值变）+ `:2138`（B 侧 `/b/v1/solvers/:key/run` 代理），SEAM 前端测直接可驱动。

### ⑥ 保留 A/B 对比 + 规则闸 + 缺口归零 UX

- A/B 对比（before/after）、`EvaluatedRules`（`ProjectSimView.tsx:798`）、缺口归零/富余文案（`:907-909` `zh.sim.proj.gapZero/gapLeft`）、采纳 → Action（`:212-231,938-942`）**全保留**。
- **采纳 payload 迁移**：`whatIf:{nightShifts,extraChannels,outsourcePct}`（`:216-218`）→ 改为**动态杠杆组合**（`[{objectType,prop,value}]` + 推演快照），Action 快照仍记 p50/gap/mainBn。
- gap 口径：若 WO-SCALE-COHERENCE 使 gap 成派生 target，则 gap 直接来自 `generic_inference` 重算的派生 delta；否则 ⑥ 结论 gap 仍由 `capacity_forecast` 出（读被扰动的对象图），但**杠杆集与拖动重算走 generic_inference**（本单的核心迁移）。

---

### ⑦ 一个项目·多方案利弊量化矩阵（C·用户新增·复用 decision_play 比对矩阵）

用户诉求：**一个项目的多个方案的利弊量化分析展示**（不止单点拖参·要多方案横比）。**平台已有比对矩阵能力**——`decision_play`（`catalog.ts:84`·COCKPIT）已产「≥3 决策方案 + 比对矩阵（各维度真算：补缺口/代价/周期/风险/可逆性）」；本单**复用其矩阵范式**，不新造评估口径。

- **候选方案生成**（确定性·objective 驱动·非写死）：就本项目瓶颈自动生成 N 个候选杠杆组合——`max_产能`（拉满高敏感度产能杠杆）/ `min_代价`（优先零成本杠杆）/ `min_换型` / `均衡`。每方案 = 一组 `[{objectType,objectId,prop,value}]`。
- **每方案真算**（走 generic_inference·非客户端估）：每候选经 recompute → 算 `{gap收窄, 加班代价, 换型成本, 交期/延误, 可逆性, 触发规则闸}` → 组成**方案×维度比对矩阵**。
- **渲染 + 采纳**：复用 decision_play matrix 组件（或 `WhatIfView` deltas 表范式）出矩阵；用户从矩阵**一键采纳** → 回填杠杆滑杆 + Action 草案（复用 ⑥ 采纳链 `:212-231`）。
- **每格 provenance 可溯**（R13）：矩阵每数字来源=generic_inference 重算·派生公式·输入杠杆。

> 与 ④WO-PORTFOLIO-OPTIMAL 的**边界**：本单 C = **单项目**多方案横比（局部·what-if 面板内·复用 decision_play）；WO-PORTFOLIO-OPTIMAL = **全订单组合**全局最优。互补不重叠。

---

## SEAM 判据（活系统组合测·非各半 unit·亲手真跑）

**接缝 = 数据种绑定（本体派生 DAG + 瓶颈因子映射）× 引擎路由（generic_inference recompute）× 前端动态杠杆渲染**。审核复验头号判据 = **接缝驱动通**，任一半漏即红：

1. **杠杆随瓶颈变（活系统组合·跨项目）**：
   - 构造/选一个**物料卡**的项目（主瓶颈=物料齐套类）→ 断言其杠杆集**含物料杠杆**、**不含**无关的夜班硬编码杠杆。
   - 选一个**产能卡**的项目（主瓶颈=设备OEE/利用率/良率）→ 断言杠杆集**含对应产能杠杆**（`Equipment.oee_current`/`Line.utilization`/`Process.yield_baseline`）。
   - 断言两项目杠杆集**不同**（随 ⑤ `mainBn`/`bottleneck_matrix.primary` 变），证"杠杆自瓶颈反推"非写死。
2. **拖动 → 真重算（引擎路由通）**：拖动某杠杆 → 断言发出 `generic_inference` 请求携带**该杠杆的 `{objectType,objectId,prop,value}`**（objectId 是真对象，非写死）→ 返回 deltas **非零** → 面板逐字投影 before/after（喂显式 mock payload 证零写死，抄 `what-if.test.tsx:72-103` KILL-MOCK 手法）。
3. **每值 provenance 可溯（R13）**：断言每 delta 行可展开 provenance（来源=generic_inference·派生公式·输入因子），非裸数字。
4. **tornado 排序 = 真敏感度**：mock 两根杠杆返回不同敏感度 → 断言 tornado 条顺序 = 敏感度降序（改 mock 敏感度 → 顺序随之变），证排序非写死。
5. **边界自规则闸**：外协类杠杆 `bound.max` 随 C08 闸值（改 mock 规则闸值 → 上限随之变），非内联 `20`。
6. **多方案矩阵真算（C）**：mock ≥3 候选方案（max_产能/min_代价/均衡）返回不同 `{gap收窄, 代价}` → 断言比对矩阵各行 = 各方案 `generic_inference` 真算值（改 mock 方案 → 矩阵随之变，非写死）+ 一键采纳某方案 → 回填对应杠杆滑杆值。

> **组合态**：SEAM 测须在 **WO-SCALE-COHERENCE 合并态**跑（否则杠杆撬玩具级产能）；datacore 侧 `mode:"levers"`/反向 walk 的 unit（`derivationSpecs` deps 逆 walk → 候选杠杆）+ 前端动态渲染，**必须一条测同时压两半**（种绑定 × 引擎路由），不得只测各半。

---

## DoD（交付底线）

- [ ] **四包全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest）；datacore 69 / agentcore 66 / frontend 25+ 基线不退（新增 solver mode → 同步 golden 计数）。
- [ ] **SEAM 组合测通**（上 5 条·活系统亲验杠杆随瓶颈变 + 真重算，绿测试≠能用 → 亲手在 mock 模式拖一遍看杠杆集切换 + deltas 变）。
- [ ] **既有 whatif 测不回归**：`f19.project-sim-whatif.test.tsx`（原 3 滑杆 gap 归零 + C08 + 采纳 payload）—— 若本单改变了 ⑥ 交互契约，**同步改测为动态杠杆断言**并说明迁移，不得删测降覆盖；`f18.project-sim.test.tsx`/`debattery.project-sim*.test.tsx`/`multiobj-whatif.test.tsx`/`what-if.test.tsx` 全绿。
- [ ] **本体回写**：改动新增了链路（what-if 重算接入项目推演）+ 断点 → 回写 `docs/SYSTEM-ONTOLOGY.md`：G-5 §8e 补"项目推演⑥已接 generic_inference 动态杠杆"、新登断点 **G-WHATIF-HARDCODED-LEVERS**（见下）。**本体不回写即过期失效**。
- [ ] **金值/注册即更**：若补 `generic_inference` `mode:"levers"` 或 companion solver → 同步 `SOLVER_OUTPUT_SHAPES`（`service.ts:136-198`）+ `SOLVER_KEYS`（如新 key）+ solver 目录金值计数 + `chain:check`/SHAPE。
- [ ] **R14 门**：`pnpm debattery:check` 基线不涨（杠杆/边界/文案不内联业务常数）。
- [ ] handoff 分支 push `claude/handoff-project-sim-whatif`（不碰正线）。

---

## 《本体引用与影响》

**对象类型**：`Base`（`baseDerived`: orderCount/committedQty/`oeeIndex=AVG(Equipment.oee_current BY baseId)`，`battery.ts:412-417`）· `Equipment`（`oee_current` 叶输入·`battery.ts:704`）· `Line`（`utilization`）· `Process`（`yield_baseline`）· `Model`（`modelDerived`: totalDemand/orderCount，`:440-443`）· `Order`（`value=qty*unitPrice`，`:656`；`outsourceRatio` ← C08）· `MaterialBalance`（物料杠杆，随瓶颈）。杠杆 = 这些类型的**可写叶输入属性**（自 DAG 反推 / 退化为瓶颈类型输入属性）。

**派生 DAG（R14 杠杆/边界非内联·自本体派生）**：`DerivedPropertyDef`（`domain.ts:238,261`）→ 编译为 `DerivationSpecRecord{deps:[{typeKey,prop,via?,direction?}]}`（`:399`）；引擎 `ontology-core.ts recompute`（`:341-542`）正向索引 `propToSpecs`（`:391-398`）+ `resolveAffectedTargets` 逆链导航（`:400-430`）+ topo 传播（`:447-516`）。**反向依赖查询本单新建薄层**（逆 walk `spec.deps` → 叶输入 = 候选杠杆），或退化为瓶颈对象类型可写输入属性。

**generic_inference 求解器**（`solvers/service.ts:79-81,146,422-440`）= `recompute(dryRun+apply)` 通用 what-if 包装：入 `apply:[{objectType,objectId,prop,value}]`，出 `{deltas,rows,affectedObjects,count,rootTypes}`；克隆图前向重算不落真值。端点：`POST /a/v1/solvers/generic_inference/invoke`（`endpoints.ts:184-185`）· `POST /b/v1/solvers/generic_inference/run`（live·`endpoints.ts:202-206`）· `POST /a/v1/inference/whatif`（精简·`app.ts:2512-2527`）。

**链路（what-if 重算·新接入项目推演）**：⑤ `bottleneck_matrix`（`risk.ts:67-89` + `liveTightness:44-61` 因子→对象属性）→ 反推候选杠杆 → 每杠杆 `generic_inference` dryRun ±ε 算敏感度 → top-K 滑杆 + tornado → 拖动 `generic_inference` recompute → deltas + provenance → A/B + 采纳 Action。**替换**原 ⑥ `capacity_forecast` 焊死 `whatIf` 三系数链路（契约 `solvers/types.ts:11`·参数 `battery.ts:119`）。

**不变量**：
- **R6 确定性重算**（本体 §invariants L462）：ε/探针/排序 tiebreak 确定；`recompute` 无 Date/random；同输入同输出。
- **R13 每 delta provenance**（L469）：每个 delta 数字可溯源 `{来源系统·派生公式·输入因子·关联规则}`（recompute 捕获 `inputs` `:474-490`→`derivationValueRuns`；前端 `<Provenance>`）；结论数字绝不裸渲染。
- **R14 杠杆/边界非内联**（L471，守 G-5 不回潮）：杠杆集自本体派生/瓶颈反推、边界自规则闸(C08)/valueDomain、文案 i18n —— 换租户/行业=换配置不改代码；`debattery:check` 守。

**断点**：
- **G-5 关联**（本体 L542·应用层电池锁死）：**8a 视图结构写死** = 本单要治的焊死 3 滑杆的直系；**8e generic-inference 已落**（`recompute(dryRun+apply)` + `/a/v1/inference/whatif`）= 本单要接进项目推演的引擎。收本单后 G-5 §8e 回写"项目推演⑥已从焊死 capacity_forecast 迁到 generic_inference 动态杠杆"。
- **新登 G-WHATIF-HARDCODED-LEVERS**（回写 `docs/SYSTEM-ONTOLOGY.md` 断点表）：*「项目推演⑥ what-if 只有 3 个焊死供给侧滑杆（夜班/加产线/外协），范围写死非本体推导、无视⑤已定位瓶颈、任何项目给同一组 —— 反 Palantir。修法：杠杆自派生 DAG 反推 + 瓶颈排序 + 敏感度打分，拖动走 generic_inference 真重算。链路位置：⑤瓶颈→杠杆反推→generic_inference→⑥对策。状态：本单收（◐→✅），依赖 WO-SCALE-COHERENCE（产能派生尺度自洽）。」*
- 关联 **G-8**（闭包不跨 D7/D8）：若补 `mode:"levers"`/companion solver，须过 `chain:check`+SHAPE（输出形状登记）。
