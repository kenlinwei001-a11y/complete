# 优化求解器模板池 · 融合落地规格（抽象模板池 + 本体绑定层 + embedding 复用检索[advisory] + 行业租户=绑定演示 · 全程按租户配置驱动）

> 这是什么：把"借鉴某参考开源优化推演项目（MIT）+ 其行业 OR 模型数据集（CDLA-2.0），把优化求解能力融进本平台"落成**可照抄的工程规格**。**核心架构不是"N 个特例求解器 + N 个行业租户"，而是"一个抽象模板池 + 一个本体绑定层 + embedding 复用检索（advisory）+ 行业租户=绑定演示"——求解器/embedding/模板全部经不同租户的 entitlement + 配置按需开（呼应沙盘 `sim.*` 分模块）。**
> 上游署名与许可见 `docs/THIRD-PARTY-NOTICES.md`（MIT 署名 + CDLA 声明 + Gurobi 不含 + **不训练红线**）。本规格按"禁外部产品名"用平台自有术语；上游产品名只在 NOTICES 作法律署名。
> 三条铁律（与全平台一致）：**① R14 去行业锁死**（模板/引擎零业务常数，行业是绑定进来的内容）；**② R6 确定性地板**（CP-SAT seed+单线程；embedding/LLM 只做 advisory 听懂层，不进求解路径）；**③ 借鉴=重写方法+派生产物+评测，绝不训练**（守上游 Prohibitions）。

---

## 0. 架构骨架（5 层 · 收敛不增殖）

```
NL/场景需求
  │ ① comprehend ⊕ embedding 复用检索(advisory, R6 地板之上的"听懂/排序"层)
  ▼   命中既有模板→复用 · 未命中→覆盖缺口信号(需求驱动,非为多样而生)
② 抽象优化模板池 OptModelTemplate(声明式 · 零业务常数 R14 · 可扩展注册表)
  │ ③ 本体绑定层 OntologyBinding(类型→实体 / 链路→关系 / 属性→系数 · A13字段角色 + DF.8接地)
  ▼   绑定到某租户已发布本体
④ 通用 CP-SAT 引擎(A8 sidecar `optimizer-client.ts`, seed+单线程 R6) ⊕ optimize_whatif(结构化扰动→**sidecar 重解**;复用 `recompute(dryRun)` 克隆+不落真值骨架)
  ▼   Δ目标值 + 可行性 + 冲突约束(IIS 式)
   R13 溯源解释 → R4 走正门(模拟态,采纳才落真值)
⑤ 行业租户 = 绑定演示(entitlement + 绑定 + 合成数据, 非另写代码 → 证 R14 多行业)
```

> 一句话：**多行业靠"收敛"服务——一个抽象池 + 一个绑定层 + embedding 导航复用，不是每行业一套。所有能力按租户配置开。**

---

## 1. 抽象优化模板池（OptModelTemplate · 契约进 `@platform/contracts`）

```ts
// packages/contracts/src/opt-template.ts (NEW)
export const OptModelTemplateSchema = z.object({
  key: z.string(),                          // 稳定键, 进 SOLVER_CATALOG 派生(R15/R16)
  displayName: z.string(),
  family: z.enum(["facility_location","min_cost_flow","set_cover","independent_set",
    "assignment","scheduling","knapsack","packing","combinatorial_auction","custom"]), // 初始 9 核心
  objectiveSense: z.enum(["minimize","maximize"]),
  decisionVars: z.array(z.object({ name: z.string(), vtype: z.enum(["B","I","C"]), indexBy: z.array(z.string()) })),
  constraintFamilies: z.array(z.object({ key: z.string(), kind: z.string(), expr: z.string() })), // 声明式, 零业务常数
  requiredRoles: z.array(z.object({ role: z.string(), of: z.enum(["objectType","link","property"]) })), // 绑定层要填的"角色"
  params: z.record(z.string(), z.number()),  // 可缩放规模参数(R14 config)
  status: z.enum(["DRAFT","PROVISIONAL","GOVERNED","RETIRED"]).default("DRAFT"),
  provenance: z.object({ derivedFrom: z.string(), license: z.string() }), // CDLA Results 派生留痕
});
export type OptModelTemplate = z.infer<typeof OptModelTemplateSchema>;
```

- **零业务常数（R14）**：模板只认抽象 `(role, vtype, constraintFamily, 数值参数)`——无任何行业实体名。供应链/医疗/能源是**绑定进来的内容**。门 `debattery:check` 扫 `opt/` 目录。
- **初始池 = 9 个 OR 核心**（去重自参考数据集 485 类）：`facility_location`(选址910) · `min_cost_flow`(多商品流293) · `set_cover`(覆盖193) · `independent_set`(独立集425) · `assignment` · `scheduling` · `knapsack` · `packing` · `combinatorial_auction`(56)。**全部 DERIVE（读懂结构→CP-SAT 重表达），非拷贝上游代码**（CDLA Results 无约束 + 不碰 Gurobi 例）。
- **可扩展注册表**（呼应 `SOLVER_CATALOG`/`deriveOperationCatalog`）：新模板追加即派生进目录；R16 离线进化器（§7）可长出 PROVISIONAL 模板。

---

## 2. 本体绑定层（OntologyBinding · R14/DF.8 真正落点）

```ts
export const OntologyBindingSchema = z.object({
  id: z.string(), tenantId: z.string(),       // R2
  templateKey: z.string(),
  scope: z.record(z.string(), z.unknown()),   // 子图范围(复用 slice-planner)
  roleBindings: z.array(z.object({            // 模板要求的 role → 该租户本体的真实对象
    role: z.string(),                         // 如 "facility" / "client" / "open_cost"
    bind: z.object({ kind: z.enum(["objectType","link","property"]), ref: z.string() }),
  })),
  coeffSource: z.enum(["property","rule_params"]).default("property"), // 系数取本体属性 或 rule.params(G-10, 改规则即改优化)
  status: z.enum(["DRAFT","PUBLISHED"]).default("DRAFT"),
});
```

- **同一模板，每租户不同绑定**（R14）：`facility_location` 绑到物流租户的 `仓库/门店/开设成本`，绑到医疗租户的 `诊所/社区/建设成本`——**零代码改动，纯配置**。
- **复用既有件**：`A13 resolveFieldRoles`（`solvers/field-roles.ts`，确定性角色解析推荐绑定）+ `slice-planner`（范围）+ **DF.8 接地**（`solvers/llm-gen.ts checkGrounding`：绑定不得引用本体外实体，绝不编造）。
- **系数可编辑**：`coeffSource=rule_params` 时系数引用 `rule.params`（G-10 P1 已落，"改规则即改优化结果"），呼应沙盘 PropagationRule。

---

## 3. embedding 复用检索（advisory · 目标从上游"多样性"倒转为"复用/补缺"）

> ⚠ 上游用 code-embedding 余弦相似度做**多样性适应度**（生成尽量不同的模型，造数据集广度）。**我们目标相反**：用同一工具做**相似度检索复用**（收敛），绝不增殖。

```ts
// 平台级(跨租户共享元资产)模板 embedding 索引;租户场景检索侧守 R2。
export interface OptEmbeddingIndex {
  upsertTemplate(key: string, text: string): Promise<void>;          // 模板描述 → 向量
  nearestTemplates(needText: string, k: number, tenantId: string): Promise<{key:string;score:number}[]>; // 复用检索
  coverageGap(needText: string, threshold: number): Promise<boolean>;// 离所有模板都远 → 补缺信号
}
```

- **三用途（全是收敛/需求驱动）**：① 场景来 → 检索**最近现有模板复用**（= `slice-index lookupReusable` 的求解器版，避免增殖）；② **覆盖缺口**（need 离任何模板都远 → 才发"长新模板"信号）；③ **跨行业迁移证据**（"EV充电选址"≈"疫苗冷链选址" → 一模板服两行业，实证 R14）。
- **advisory，不进确定性路径（R6）**：embedding 只做候选**排序/听懂**；真正绑定+求解是确定性 CP-SAT。**embedding 是 R16 "听懂"层，确定性是地板**。
- **平台级索引，不按租户**（行业共享核心只有全局索引看得见）；**租户场景文本进检索须守 R2**（不跨租泄漏）。
- **顺带闭 comprehend 缺口**：语义"需求→模板"检索 > 关键词目录（comprehend 现为关键词、新颖故事退化）。
- **按租户配置**：embedding 检索是**可开关的 advisory 模块**（entitlement `opt.embedding-retrieval`，§6）；关掉则退回 comprehend 关键词 + 显式列模板供人选（确定性兜底，不静默）。

---

## 4. optimize_whatif 求解器（what-if over optimization · 不 exec 裸代码）

```ts
export const OptPerturbationSchema = z.object({   // 结构化扰动, 非任意代码(守 A18/R6)
  kind: z.enum(["data_override","add_constraint","relax_constraint","change_objective_weight"]),
  target: z.string(),                              // 受扰动的 role/参数(本体内, DF.8 校验)
  value: z.union([z.number(), z.string()]),
});
```

- **回路**（借上游 what-if 8 步，收敛进我们安全栈）：`NL --comprehend/embedding(听懂)--> 结构化扰动 --DF.8接地--> **optimizer-client sidecar 重解(CP-SAT)** --> {Δ目标值, 可行性, 冲突约束(IIS式)} --R13--> 解释(新 vs 原)`。
- **⚠ 接地校正（核验 `sandbox.ts`/`sandbox-runner.mjs`）：A18 锁沙箱跑不了 CP-SAT**（子进程 `--permission` 无 `require`/import、只跑纯计算 + FrozenDate/禁 Math.random）。所以 **optimize_whatif 的重解走 `optimizer-client.ts` sidecar**（已隔离的 CP-SAT 服务），**不在 A18 沙箱内**。A18 锁沙箱专给 **§7 进化引擎的 LLM 生成纯函数模板代码**用。
- **不照搬上游 `exec` 任意 LLM 代码**：上游 `_run_with_exec` + LLM 判 SAFE → 我们换 **结构化扰动 schema + sidecar 重解**；扰动施加+结果对比**复用 `recompute(dryRun)` 克隆图+不落真值骨架**（`ontology-core.ts:341`，`genericInference` 同款），在 `invoke()` 里**先于 loadContext 拦截**（如 `generic_inference` `service.ts:~1333`）。比上游安全得多。
- **R4 走正门**：what-if 是模拟态，不写真值（复用 `recompute(dryRun)` 不 persist）；采纳才出 R4 ActionDraft。
- 并入 `SOLVER_KEYS`（42→+1，过 `chain:check`）+ 声明 `SOLVER_OUTPUT_SHAPES`（否则 chain:check 报 SHAPE 盲区）；可作 **G-11 沙盘内一类"优化推演"**（`SimSession`/`propagateTick` 可调任意已发布求解器，已两行业验收）。

---

## 5. 行业租户 = 绑定演示（按需配置 · 证 R14 多行业，非另写代码）

参考数据集 99 个行业皮 → 归 ~7 个**行业租户配置**，**每个 = entitlement + 绑定 + 合成数据种子，零新代码**：

| 行业租户(配置) | 池模板(复用) | 走正门长出 |
|---|---|---|
| 物流/供应链 | facility_location + min_cost_flow | 合成(R6)→runStory 建本体→绑定→求解器注册→沙盘可推演 |
| 能源/电力(EV) | facility_location + min_cost_flow + scheduling | 同上 |
| 医疗/公卫 | facility_location + set_cover + assignment | 同上 |
| 应急/赈灾 | min_cost_flow + set_cover + assignment | 同上 |
| 云/数据中心 | packing + scheduling + assignment | 同上 |
| 制造/排产 | scheduling | 同上 |
| 采购/拍卖 | combinatorial_auction | 同上 |

- **每租户走既有正门**：`synthetic.runJob`(确定性 industry×scale×seed) → `runStory`(倒序发育建本体) → `OntologyBinding`(绑池模板) → 求解器派生注册 → `optimize_whatif`/沙盘可跑。
- 行业模型只作**派生灵感**（CDLA Results 无约束），**不原样转发上游 .py**。

---

## 6. 按需配置（per-tenant entitlement 暗发 · 呼应沙盘 sim.* 分模块）

`features.ts FEATURE_REGISTRY` 追加（全 `defaultOn:false` 暗发，R3）：

```ts
{ key:"opt.solver-pool",        name:"优化模板池",       level:"VIEW",  defaultOn:false },
{ key:"opt.whatif",             name:"优化 what-if",     level:"BLOCK", defaultOn:false, requires:["opt.solver-pool"] },
{ key:"opt.embedding-retrieval",name:"模板复用检索",     level:"BLOCK", defaultOn:false, requires:["opt.solver-pool"] }, // advisory, 关=退回 comprehend
{ key:"opt.evolve",             name:"模板进化(离线)",   level:"BLOCK", defaultOn:false, requires:["opt.solver-pool"] }, // §7 远期
// 逐模板/逐行业可再细分 entitlement(opt.template.facility_location ...), 按租户档位组装
```

- **类似求解器、embedding 都按租户配置开**：lite 租户给 `opt.solver-pool`+几个模板；Pro 给 `opt.whatif`+`opt.embedding-retrieval`；旗舰再给 `opt.evolve`。关掉的模块对该租户 404（R3）。

---

## 7. 离线模板进化器（R16 能力环 · 远期 · 目标倒转 · 借方法不借目标）

- **借**（重写，非拷贝）：参考项目的遗传操作（mutate=换行业皮 / crossover=融合两模板 / add-delete=调复杂度）+ 可行性过滤（CP-SAT 真解）+ 参数自调（解时落目标区）。
- **目标倒转**：适应度从"**多样性**"改成"**覆盖缺口 + 能接地 + 服务真实需求**"（§3 embedding 补缺信号触发）；产物标 **PROVISIONAL**，经 **R16 倒序发育接地 + 验证**才转 GOVERNED（A18 相位，`provisional-honesty:check` 守诚实）。
- **跑在 A18 锁沙箱**（`solvers/sandbox-runner.mjs`），不裸 subprocess；R6 确定性。
- **绝不训练**（守 Prohibitions）：进化用 LLM **生成**模板（运行时），不拿上游内容**训练**任何模型。

---

## 8. 许可证合规（硬约束 · 详 `THIRD-PARTY-NOTICES.md`）

- **MIT 代码**（参考 what-if/optimind）：方法重写进 TS + `THIRD-PARTY-NOTICES` 保留 MIT 版权声明。
- **CDLA-2.0 数据**：只取**派生 Results**（我们的模板/租户），无约束；**不原样转发**上游 .py（转发才需附 CDLA 文本）。
- **Gurobi 基准例**：⛔ **不碰、不移植、不转发**（上游版权非己有）。
- **⛔ 不训练红线**：绝不把参考项目任何内容（QA 对 / 模型 / benchmark）喂进任何模型训练/微调——运行时模板/评测/代码参考=可以，训练语料=禁止。
- **门 `solver-license:check`（新建）**：静态断言 `opt/` 新增求解器模板均有 `provenance.license` + `THIRD-PARTY-NOTICES` 收录；禁止出现 Gurobi 例文件指纹；禁止 `train(` 等把上游数据导入训练管线的调用。

---

## 9. 端点 + CLI（R15 · CLI 先于 UI）

| REST（过 R2/R3） | CLI | entitlement |
|---|---|---|
| `GET/POST /a/v1/opt/templates`（池 CRUD/列） | `platform opt template ...` | opt.solver-pool |
| `POST /a/v1/opt/bindings`（建绑定） | `platform opt bind` | opt.solver-pool |
| `POST /a/v1/opt/solve`（绑定→CP-SAT 求最优） | `platform opt solve` | opt.solver-pool |
| `POST /a/v1/opt/whatif`（结构化扰动→重解） | `platform opt whatif` | opt.whatif |
| `GET /a/v1/opt/retrieve?need=`（embedding 复用检索 advisory） | `platform opt retrieve` | opt.embedding-retrieval |

---

## 10. 门（新建·并入 `pnpm gates`·回写本体 §7）

- `solver-license:check`（§8 许可证合规 + 不训练）。
- `opt-template:check`（模板池零业务常数[debattery 扩 `opt/`] + 每模板有 requiredRoles + provenance）。
- `opt-determinism:check`（CP-SAT seed+单线程字节一致 R6；embedding 不在求解路径）。
- 复用 `chain:check`（求解器注册）+ `debattery:check`（R14）+ `provisional-honesty:check`（进化产物诚实）。

---

## 11. DoD（FDE 亲手 · 两行业验收 R14）

1. **CLI 跑通**：`platform opt bind`（绑 `facility_location` 到某租户本体）→ `opt solve` 出最优目标值 → `opt whatif`（改一个开设成本/加一约束）→ 出 Δ目标值 + 冲突约束，**贴输出**。
2. **两行业各跑通**（证 R14）：同一 `facility_location` 模板，绑**物流租户**（仓/店）⊕ **医疗租户**（诊所/社区），各出最优解，**代码零改、仅绑定不同**。
3. **embedding 复用 advisory**：`opt retrieve --need "选址类需求"` → 返最近模板候选；**关 entitlement → 退回 comprehend 列表，不静默**。
4. **确定性 R6**：同绑定+同参数两次求解字节一致。
5. **许可证**：`THIRD-PARTY-NOTICES.md` 存在且 `solver-license:check` 绿；无 Gurobi 例文件；无训练管线引用。
6. **门**：`pnpm gates`（含新门）绿。

---

## 12. 《本体引用与影响》（回写 `SYSTEM-ONTOLOGY.md` · 增量 0 先行）

- **对象/求解器**（§2 D4 推演域，挂在 `Calibration` 之后）：新增 `OptModelTemplate`/`OntologyBinding`/`OptPerturbation` 对象 + 求解器 `optimize_whatif` + 9 核心模板（并入 `SOLVER_KEYS`[当前 42]/`SOLVER_OUTPUT_SHAPES`，过 `chain:check`）。契约进 `packages/contracts/src/opt-template.ts`。
- **链路**（§3）：`NL --comprehend⊕embedding(advisory)--> 复用/补缺 --OntologyBinding(A13+DF.8)--> CP-SAT sidecar 求最优 ⊕ optimize_whatif(扰动重解,**sidecar**,复用 recompute(dryRun) 不落真值) --Δ目标--R13--> 解释 --R4--> 采纳`；`行业模型 --派生(CDLA Results)--> 行业租户(合成→runStory→绑定→求解器)`。
- **不变量**（复用既有，**不新增 R18**——"不训练"是合规规则进 NOTICES/门，非平台接线不变量）：R3 · R6（CP-SAT 确定，embedding advisory 不入路径）· R4 · R13 · R14（两行业验收）· R16（进化产物 PROVISIONAL→接地→GOVERNED）· A18（**进化引擎生成代码**走锁沙箱；optimize_whatif 重解走 sidecar 非沙箱）· DF.8（绑定接地不造实体）。
- **门**（§7）：`solver-license:check` / `opt-template:check` / `opt-determinism:check` **追加到当前 16 门聚合末（→19）**。
- **断点**（§8）：登记 **G-12**（G-1..G-11 已用，G-11 沙盘已全闭）「有确定性派生 what-if 无优化目标级 what-if + 无行业无关优化模板池」→ 本规格修。
- **回写**：增量 0 把上述对象/链路/事件/门 + `THIRD-PARTY-NOTICES` 红线写进本体。

---

## 13. 一句话给实现 agent

**不是写 N 个行业求解器，是建"一个抽象优化模板池（9 核心，零业务常数）+ 一个本体绑定层（A13 角色+DF.8 接地，每租户绑同一模板到自己本体）+ embedding 复用检索（advisory，目标从'多样'倒成'复用/补缺'，R6 地板之上）+ optimize_whatif（结构化扰动→**optimizer-client sidecar** CP-SAT 重解，复用 recompute(dryRun) 不落真值，不 exec 裸代码）"，行业租户只是绑定演示，全部能力按 entitlement 配置开。** 借鉴=重写方法+派生产物+评测，绝不训练；MIT 署名、CDLA 取 Results、Gurobi 不碰，全进 `THIRD-PARTY-NOTICES` + `solver-license:check`。

---

## 14. 接地核验与校正（对当前真实代码 · 4 路 Explore 核验 · 2026-06-25）

> 本节把 §1–§13 的假设逐一对照分支 `claude/vigilant-knuth-b1nmxn` 当前代码核验，钉死复用锚点（file:line），并记**与初稿的校正**。凡上文与本节冲突，**以本节为准**。

### 14.1 可复用件（已核验 · 直接调）

| 我方件 | file:line | 复用点 |
|---|---|---|
| 求解器注册 | `solvers/service.ts:26` SOLVER_KEYS(42) · `:101` SOLVER_OUTPUT_SHAPES · `:1333` invoke 拦截 | 5 核心+optimize_whatif 照此扩，`chain:check` 自动过 |
| CP-SAT sidecar | `solvers/optimizer-client.ts:85` OptimizerClient 接口 · `:94` HttpOptimizerClient(POST /solve) | 5 核心加 5 个 `solveXxx` 方法;未配 OPTIMIZER_BASE_URL 显式"未接入"不兜底 |
| A13 字段角色 | `solvers/field-roles.ts:67` resolveFieldRoles(纯函数,返回 roles/candidates/confidence/ambiguous) | 绑定层推"本体类型→模型角色" |
| 切片复用 | `ontology/slice-planner.ts:69` planSlice · `slice-index.ts:38` buildSliceIndex/lookupReusable | 绑定层选范围 + 结构化复用(embedding 叠其上) |
| DF.8 接地 | `solvers/llm-gen.ts:23` checkGrounding · `service.ts:212` deriveGroundingVocab | 绑定"不引用本体外实体" |
| 不落真值 what-if | `ontology-core.ts:341` recompute(dryRun:克隆+不persist) · `service.ts:368` genericInference · 端点 `app.ts:2340` | optimize_whatif 复用克隆+不落真值+R4 骨架 |
| A18 锁沙箱(纯函数) | `solvers/sandbox.ts:1`(spawn --permission 无 require) · `sandbox-runner.mjs:1`(FrozenDate/禁 random) | **仅 §7 进化引擎的 LLM 生成纯函数模板**用 |
| PROVISIONAL 相位 | `contracts/solvers.ts:267` SolverArtifact · `service.ts:348` promoteSolver · `:325` canArtifactWriteTruth · `provisional-honesty.ts` | 进化产物 PROVISIONAL→GOVERNED |
| entitlement 形状 | `features.ts:12` FeatureDef{key,name,level,defaultOn,requires?,bindings?} · sim.* 7 条 :83-90 | opt.* 照此暗发分模块 |

### 14.2 与初稿的校正（**必读**）

1. **A18 锁沙箱跑不了 CP-SAT**（子进程无 require/import,纯计算）→ **optimize_whatif 重解走 `optimizer-client` sidecar，不在沙箱内**;A18 沙箱只给 §7 进化引擎的纯函数模板代码用。（已改 §0/§4/§12/§13）
2. **`checkGrounding` 现为电池味**（正则只认 `基地/产线/工厂` 后缀,`llm-gen.ts:23`）→ 多行业绑定前须**先去电池化该正则**（R14),否则只挡电池实体。**列为前置任务**。
3. **系数来源语义**：规则是 gate(expression 求值)，非系数源。→ 系数为 `OntologyBinding` **类型化字段**(对齐沙盘 `PropagationRule`)，可选 `coefficientRef→rule.params`(G-10「改规则即改优化」);**不把系数硬塞进规则**。（§2 采此）
4. **embedding 层是全新基建**：平台今天**无** embedding 层(现有复用 `lookupReusable` 是确定性结构匹配)。embedding 是叠其上的 advisory 检索,net-new。（§3 已明）
5. **本体绑定层 = invoke 前统一 args 预处理层**（字段映射+本体加载),别散在各求解器。（§2 采此）
6. **`floor-semantics:check` 门 docs 提及但代码未实现**（`SYSTEM-ONTOLOGY.md:95` vs 代码无)。绑定层别依赖它已存在;如需则新建。
7. **本体编号锁定**：当前 §5 最大 R17(无 R18)、§8 最大 G-11(已全闭)、§7 聚合 **16 门**。→ 本规格用 **G-12** + 追加 3 门(→19) + **不新增 R18**(复用既有不变量)。

### 14.3 一句话

**SPEC 主架构（抽象池+绑定层+embedding advisory+optimize_whatif+按租户配置）对照当前代码全部成立;唯一实质校正是"重解走 sidecar 非 A18 沙箱"。其余件均现成可直接复用,锚点已钉死。** 实现 agent 照 §14.1 锚点 + §14.2 校正开工,不会踩我初稿的坑。
