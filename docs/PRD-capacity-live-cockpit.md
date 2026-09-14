# PRD · 产能推演「活台」— 从只读 BI 升级为原子因子·人机对话·方案存比的活系统

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-07-24 |
| 取代/扩展 | 扩展 `PRD-capacity-inference-completion.md` · `WO-CAPACITY-DEEPEN-ADDITIVE.md`（只读深化已落）· `WO-PROJECT-SIM-WHATIF.md`（动态杠杆范式·黄金参照） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `docs/PRD-generic-inference.md` · `docs/PRD-simulation-sandbox.md` · `docs/WO-PROJECT-SIM-WHATIF.md` |
| 页面 | 产能推演页 = view key **`risk`** · renderer `risk-board` · `apps/frontend-shell/src/views/RiskBoardView.tsx`（`view-manifest.ts:54`）。**注意**：`capacity_forecast` 求解器也叫「产能推演」（`catalog.ts:49`），`project-sim`「项目推演」是另一页——本 PRD 指 **`risk` 页**。 |

> 一句话：产能推演页今天是**"死"BI**——四线前瞻 / byModel / 根因树 / 方案比对 / 派生诊断DAG / 20因素图例**全是一次性只读结论投影**（`RiskBoardView.tsx:477-594` RiskDetailPanel 内 8 个只读块）。本 PRD 把它升级成**"活台"**：用户可（①）下钻并**拨动任意原子影响因子**（细到每工序×每型号-物料）→ 就地 `generic_inference` 真重算；（②）**人机对话**（真 NL·非 QaPanel 假 NL）问因子、问根因、给变量；（③）**存/分支/比对**自己的方案。**引擎全已建（57 solver 全在），本 PRD 主要是"接线 + 一处原子因子深化"，非绿地重造。**

---

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（§2）：`Base`/`Line`/`Process`/`Equipment`/`Model`/`Bom`/`Material`/`MaterialBalance`/`Routing`/`ProcessCapabilityWindow`（产能派生一等对象·`capacity.ts computeRollup`）· `CapacityForecast`/`SimCheckpoint`（方案快照·复用沙盘存档）· `ActionDraft`（采纳走 R4）。
- **触及链路**（§3）：产能金字塔自下而上派生链（节拍×OEE→设备→工序→min瓶颈→产线→∩物料→预测→缺口，§3 line 76 自引）；**新接** what-if 重算链（⑤瓶颈→原子因子反推→`generic_inference` recompute→deltas+provenance→方案存比→采纳 Action），与 `WO-PROJECT-SIM-WHATIF` 项目推演⑥同款机制、迁到 `risk` 页。
- **触及事件/数据流**（§4）：`sim.checkpoint_saved`/`sim.branched`（方案存/分支·复用沙盘事件 L-sim）· `action.executed`（采纳回灌·驱动下一轮）· 遵守 D-29 下游订阅。
- **触及不变量**（§5，R1–R18）：**R6** 确定性重算（ε/探针/tiebreak 确定·`recompute` 无 Date/random·同输入同输出）· **R13** 每 delta/因子/方案数字可溯源（`<Provenance>` 出处·派生公式·输入因子·关联规则）· **R14** 因子/边界/文案非内联（原子因子表自本体派生·边界自 C08 规则闸·i18n·`debattery:check` 守）· **R4** 采纳走 Action 审批不静默写真值 · **R17** 决策单页（数据→推演→溯源→动作→AI 一页看全，就地下钻不跳页）。
- **CLI 打通（R15，强制）**：`generic_inference`/`gap_attribution`/`decision_play` 已在 `OPERATION_CATALOG`·`platform do` 万能路由可达；本 PRD 无新对外能力（原子因子深化仅扩现有 solver 输入颗粒），复用现有 CLI，不产功能洼地。
- **关闭/影响的已知断点**（§8）：新登 **G-CAPACITY-DEAD-BI**（产能推演页全只读·无就地重算/真NL/方案存比）+ **G-CAPACITY-FACTOR-SHALLOW**（20 因素宽而浅·仅~7有真张力/4有可写属性·派生用代表工序均值未到工序×型号-物料）；延伸 **G-CAPACITY-INFER-PROCESS**（已闭只读版·本 PRD 加交互）；复用 **G-WHATIF-HARDCODED-LEVERS**（已闭·动态杠杆范式）、**G-GAP-SCOPE**（已闭·gap_attribution 现支持 base×factor 作用域·前端待接）；共享 **G-SIMSESSION-NO-BIZ-REUSE**（方案存比让沙盘会话首次被业务页复用）。
- **需走的检测门禁**（§7）：`genuine-sim:check`（推演输出带 dataMode 不裸渲染）· `no-hardcoded-rules:check`（因子阈值/边界读参不内联）· `debattery:check`（前端无业务常数）· `chain:check`+SHAPE（若扩 solver 输出形状）· `ontology:check` · `prd:check`（本 §0）· 四包 gate。
- **回写承诺**：WO 落地后回写本体——§3 新增「产能推演 what-if 重算链」、§8 登 G-CAPACITY-DEAD-BI/G-CAPACITY-FACTOR-SHALLOW 并随 WO 收敛状态、§2.I 补「SimSession 首次被业务页（产能/全局推演）复用为方案快照」。**本体不回写即过期失效。**

---

## 1. 目标 / 非目标

**目标**
1. **原子因子活推演**：产能页任一基地卡展开后，用户能拨动**该基地瓶颈反推出的原子因子**（设备OEE/工序良率/产线利用率/物料齐套/换型/班次…细到**每工序×每型号-物料**），拖动即经 `generic_inference` 沿派生 DAG **真重算** → before/after deltas + 每值 provenance + tornado 敏感度排序。
2. **原子因子深化（治宽而浅）**：把 20 因素本体从"仅 ~7 有真张力/4 有可写属性"深化到**每个因子有 object.property 落点**、可下钻到 **per-工序 × per-型号-物料**（`Process`/`Model`/`Bom`/`Material`/`Routing` 均一等对象，数据模型已支持）。
3. **人机对话**：产能页接**真 NL**（经 orchestrator·非 QaPanel 正则假 NL），用户可问「常州化成良率降到 92% 产能少多少」「哪个工序物料最卡 4680」并**给任意变量**推演。
4. **方案存/分支/比对**：用户把一次拨动结果**存为命名方案**、**分支**出变体、**多方案横比矩阵**（复用 `decision_play` 比对范式 + `SimCheckpoint` 存档），一键采纳走 Action。

**非目标**
- 不重画产能页视觉（复用现页色板·纯增量插入，抄 `WO-CAPACITY-DEEPEN-ADDITIVE` 纪律）。
- 不改 `recompute`/`capacityForecast` 数学内核算法（只加"反向依赖/原子因子颗粒/作用域入参"薄层）。
- 不做全订单全局最优（那是全局推演页 `portfolio`·见 `PRD-global-sim-live-upgrade.md`）——本页是**单基地×原子因子**局部 what-if。

---

## 2. 现状与缺口（对照代码 · file:line）

| # | 现状（AS-IS） | 缺口 | 锚点 |
|---|---|---|---|
| C1 | 8 个块全**只读结论投影**（DAG/爬坡/四线/根因树/方案矩阵/图例/逐日/QaPanel） | 无任何"改因子→就地重算"面板 | `RiskBoardView.tsx:477-594`；DAG「不改链路仅可视化」`CapacityDerivationDag.tsx:160` |
| C2 | 根因树 `invokeSolver("gap_attribution", {})` **不传作用域**、客户端按基地过滤、UI 披露"不接受 base×factor" | 引擎**已支持** `scope.baseId`/`scope.factorId`（G-GAP-SCOPE 已闭），前端**未接** → 因子级根因缺 | 前端 `:495,:500,:613-628`；引擎 `service.ts:1165-1222`（baseId）/`:1060-1064`（factorId） |
| C3 | 产能派生 `computeRollup` **与 modelId 无关**、基地产能用**代表工序=车间均值** | 未到 per-工序 × per-型号-物料·per-model 仅"基地×型号 P50+主瓶颈名" | `capacity.ts:213`（rollup）/`:146-158`（lineMean·SA-3 注 `:142-145`）；byModel join `service.ts:2229-2285` |
| C4 | 20 因素本体**无 object.property 绑定**（只有 op+圈号）；仅 `LEVER_FACTOR_PROPS` 4 个可写、`bottleneck_matrix` 7 个有张力 | ~13/20 因子是纯展示徽标·无可拨动落点 | `factorOntology.ts:47-74`；`LEVER_FACTOR_PROPS service.ts:230-235`；7 因子枚举 `contracts/solvers.ts:69` |
| C5 | `QaPanel` 有输入框但**正则关键词假 NL**、非真 LLM/ontology_query | 无真人机对话·不能给任意变量推演 | `RiskBoardView.tsx:785-822`（`answer()` 正则 `:792-798`） |
| C6 | 无方案存/分支/比对（唯一"写"是采纳→Action 草稿） | 不能存自己的方案、不能横比、不能分支 | 采纳 `:753,:772-774`；SimSession 存档能力在 `sim.ts`/`app.ts:1228-1496` 但**未被本页复用** |
| — | 动态杠杆范式**已在项目推演页跑通**（`DynamicLeverPanel`+`generic_inference`） | 只落 `project-sim`、`risk` 页未复用；且 `DynamicLeverPanel` 硬编 `targetType:"Base"/targetProp:"oeeIndex"`、`scopeObjectIds` 未接 | `DynamicLeverPanel.tsx:70,:91`；仅 `ProjectSimView.tsx:20,:862` 复用 |

---

## 3. 设计（复用现有接缝优先）

### 3.1 复用清单（绿地新建 = 仅 1 处·其余全复用）

| 能力 | 复用什么 | 锚点 |
|---|---|---|
| 自由因子 what-if 重算 | `generic_inference`（`recompute(dryRun+apply)` 克隆图前向重算不落真值） | `service.ts:461-484`；端点 `POST /a/v1/inference/whatif` `app.ts:2619-2634` |
| 原子因子反推 + 敏感度排序 | `generic_inference mode:"levers"` = `discoverLevers`（反向 walk `derivationSpecs.deps`→叶输入 + ±ε recompute 敏感度） | `service.ts:466,:494-589`；`LEVER_FACTOR_PROPS:230-235` |
| 因子级根因树 | `gap_attribution` 传 `scope.baseId`/`scope.factorId`（已支持·前端只需接线） | `service.ts:1165-1222,:1060-1064` |
| 动态杠杆面板 UI | `DynamicLeverPanel`（top-K 滑杆+tornado+drag→useLiveSolver+Provenance+C08 闸）**参数化** `targetType/targetProp/scopeObjectIds` 后跨页复用 | `DynamicLeverPanel.tsx:70-309` |
| 人机对话 | orchestrator compose/path-B（`qos.compose-path`）+ 新增产能意图路由（共享 WO-LIVE-NL） | `sim-planner.ts`/`orchestrator.ts` |
| 方案存/分支/比对 | `SimCheckpoint`/`branch`/`compare`（沙盘存档·solve-mode 快照）+ `decision_play` 比对矩阵范式 | `app.ts:1307-1338`；`decisionPlay service.ts:2295-2388` |
| **绿地新建（唯一）** | 原子因子→object.property 绑定单源 + per-工序×per-型号-物料 颗粒（WO-CAPLIVE-1） | 新 `packages/contracts` 因子绑定表 + `capacity.ts`/`risk.ts` 深化 |

### 3.2 三段"活"能力落点

- **活能力①·原子因子活推演**（WO-CAPLIVE-1 引擎 + WO-CAPLIVE-2 前端）：`DynamicLeverPanel` 参数化后挂进 RiskDetailPanel，`targetType/targetProp` 传产能目标（`Base.formationCapDaily`/`Base.agingCapDaily`——`capacity.ts` 共享产能真读的基地日产能属性——或 `Process` 级），`scopeObjectIds` 传该基地×型号的真对象实例 → 杠杆集从**深化后的原子因子**反推、拖动 `generic_inference` 真重算。
- **活能力②·人机对话**（WO-LIVE-NL 共享）：产能页新增真 NL 框（替 QaPanel 假 NL 或并存），问句 → orchestrator 识别产能 what-if 意图 → 路由 `generic_inference`/`gap_attribution(scope)`/`capacity_forecast` → 叙述带溯源。
- **活能力③·方案存/分支/比对**（WO-LIVE-SCENARIO 共享 + WO-CAPLIVE-2 前端）：拨动结果存为 `SimCheckpoint`（solve-mode·`state`=jsonb{apply,kpis,provenance}）→ 分支变体 → `decision_play` 范式横比矩阵 → 一键采纳走 `adopt_mitigation`/`plan_change` Action。

---

## 4. 契约 / 端点 / 数据模型

- **原子因子绑定单源**（WO-CAPLIVE-1·新建·`packages/contracts`）：`CapacityFactorBinding{ mark(①–⑳), factorName, objectType, prop, grain('base'|'process'|'model-material'), writable, ruleGate? }` —— 把 `factorOntology.ts` 的 20 因子补齐 object.property 落点（R14 单源·前端 `factorOntology.ts` 派生引用之，不再各处散配）。
- **`capacity_forecast` 颗粒扩**（WO-CAPLIVE-1·向后兼容）：输出 additive 加 `byProcessModel?: Array<{ process, model, material?, p50, bottleneck, gap }>`（现有 per-base/per-model 字段零改）；`ForecastArgs` 加 `granularity?: 'base'|'process-model'`。

#### 4.1 冻结契约（WO-CAPLIVE-1-ATOM 交付·字段名一字不改·WO-CAPLIVE-2 前端据此并行构建）

**`CapacityFactorBinding`**（`packages/contracts/src/capacity-factors.ts`·`CAPACITY_FACTOR_BINDINGS` 20 条·marks ①–⑳）：

```ts
type FactorGrain = "base" | "process" | "model-material";
interface CapacityFactorBinding {
  mark: string;        // 圈号 ①–⑳（= factorOntology.ONTO_FACTORS.mark 单源）
  num: number;         // 序号 1..20
  factorName: string;  // 因子名（业务术语·= ONTO_FACTORS.name）
  objectType: string;  // 落点对象类型（真本体 key·如 Equipment/Process/Line/Material/MaintPlan/Order/ChangeoverMatrix）
  prop: string;        // 落点属性（真本体属性·可读/可拨动）
  grain: FactorGrain;  // base / process(每工序) / model-material(每型号-物料)
  writable: boolean;   // 是否派生叶输入（可作杠杆拨动落点）
  ruleGate?: string;   // 拨动约束规则闸（C03/C06/C08/C16…）
}
// 关键落点（SEAM 咬点）：⑥ 工序良率 = Process.yield_baseline · ⑬ 物料齐套 = Material.onHand
// 辅助：factorBindingByMark(mark) · writableFactorBindings(grain?) · matchesGrain(bindingGrain, scope)
```

**`byProcessModel` 行**（`CapacityForecastOutputSchema.byProcessModel?`·`granularity:'process-model'` 时输出·per-base/per-model 字段零改）：

```ts
interface ByProcessModelRow {
  baseId: string;          // = perBaseRows.baseId 同源
  base: string;            // 基地名
  process: string;         // 工序 id（Process.processId）
  processName: string;     // 工序名
  model: string;           // = 请求 modelId
  material?: string;       // 关键物料名（层4 ∩ 物料齐套约束·无物料数据时省）
  p50: number;             // 工序×型号日产能贡献（工序产能×认证系数×良率基线再基×物料齐套系数）
  bottleneck: string;      // 逐格主瓶颈（BN 词表：良率波动/设备OEE/物料齐套·与 perBaseRows.bottleneck 同源）
  bottleneckMark?: string; // 主瓶颈圈号（①–⑳·映射 CapacityFactorBinding.mark）
  tightness: number;       // 该格主瓶颈张力（0–100）
  gap: number;             // = p50 × tightness/100（因主瓶颈处于风险的产能）
  provenance: { objectType: string; objectId: string; prop: string; formula: string }; // R13 每值溯源
}
```

**`discoverCapacityLevers` 出参**（`generic_inference {mode:'levers', grain:'base'|'process'|'process-model', modelId, processKey?, factors?, topK?, epsilon?}`·输出与默认 levers 同键 + 每杠杆 `{objectType,objectId,prop,factorName,mark,grain,currentValue,sensitivity,provenance}`）。
- **`discoverLevers` 扩**：`LEVER_FACTOR_PROPS`（`service.ts:230-235`）从 4 因子扩到覆盖深化后可写因子；`mode:"levers"` 入参加 `grain`/`modelId`/`processKey` 作用域。
- **`gap_attribution` 前端接线**（WO-CAPLIVE-2·引擎零改）：`invokeSolver("gap_attribution", { scope:{ baseId, factorId? } })`。
- **方案快照端点**（WO-LIVE-SCENARIO·复用沙盘表 R9 双实现）：`SimCheckpoint.state` 承载 what-if 快照；`GET /a/v1/sim/compare` 已存在（A/B 比对）；如需多方案矩阵，`decision_play` 范式在前端组装。**双仓储四处同改**若新增字段（migrations+pg+memory+repo 接口）。

---

## 5. 关键流程（端到端 · 沿链路）

```
基地卡展开 → DynamicLeverPanel(targetType=Base/Process, scopeObjectIds=本基地×型号真实例)
  → discoverLevers(mode:levers, grain:process-model) 反推 top-K 原子因子 + ±ε 敏感度排序
  → 用户拖某因子(如 化成工序·4680 良率) → useLiveSolver("generic_inference",{apply:[{objectType:"Process",objectId,prop:"yield_baseline",value}]})
  → recompute(dryRun) 克隆图前向重算 → deltas(before/after) + affectedObjects + 每值<Provenance>
  → [活②] 或 NL 框问「良率降到92%产能少多少」→ orchestrator → 同 generic_inference 路由 → 叙述带溯源
  → [活③] 存为方案 A → 分支方案 B(改另一因子) → decision_play 范式横比矩阵(gap收窄/代价/换型/可逆性)
  → 一键采纳最优 → adopt_mitigation/plan_change ActionDraft → S2 审批(C5 门·不绕) → 采纳后基线真变
```

**R13 每一跳可溯**：原子因子→deltas→方案矩阵每格都挂 `<Provenance>`（来源 `generic_inference`·派生公式取自 `spec.formula`·输入因子·C08 规则闸）。

---

## 6. 非功能与约定（§5 逐条）

- **R6**：`recompute`/`discoverLevers` 无 Date/random；ε/探针/tiebreak/方案排序确定；同输入两跑字节一致。
- **R13**：因子/deltas/方案矩阵数字绝不裸渲染；`genuine-sim:check` 守推演输出带 `dataMode`（LIVE=实测·合成标"合成·未接实测"不谎报）。
- **R14**：原子因子绑定表单源、边界自 C08/valueDomain、文案 i18n；`debattery:check`/`no-hardcoded-rules:check` 守不回潮。
- **R4/R17**：采纳走 Action 审批（RL4 正门）；决策单页——因子/对话/方案/采纳全在基地卡展开层就地完成不跳页。
- **视觉纪律**：新面板只用现页 `RiskBoardView.module.css` 变量，像素级与现页一致（抄 `WO-CAPACITY-DEEPEN-ADDITIVE` 铁约束）。

---

## 7. 验收（DoD）

- [ ] **四包全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest）；金值：`capacity_forecast` 若扩输出形状 → 同步 `SOLVER_OUTPUT_SHAPES`+`chain:check`+SHAPE；无新 solver key 则 SOLVER_KEYS 保 57。
- [ ] **SEAM-GATE 组合测通**（见各 WO·活系统亲验·非各半绿）。
- [ ] **现页所有既有测试一条不改、全绿**（只读功能 100% 保留的硬证据）。
- [ ] 门：`genuine-sim:check`/`no-hardcoded-rules:check`/`debattery:check`/`ontology:check`/`prd:check` 全绿。
- [ ] **亲手真跑**（绿测试≠能用）：内存态起 datacore+frontend → 点常州基地卡 → 拨化成良率滑杆看产能 deltas 真变 → NL 问一句得溯源答 → 存两方案横比 → 采纳走审批。
- [ ] **本体回写**：§3/§8/§2.I（见 §0 回写承诺）。

---

## 8. 分期与 WO 拆分（并行可派 · 靠文件边界不靠身份）

> 三张 page-specific WO + 两张跨页共享 WO（`WO-LIVE-NL`/`WO-LIVE-SCENARIO`·定义见 `PRD-global-sim-live-upgrade.md §8`，两 PRD 共用一次派发）。文件边界**严格不相交**（datacore / frontend / agentcore 三分），可并行开工。

### WO-CAPLIVE-1-ATOM（数据+引擎整单 · 1 fresh dev · 最重）

**🚦范围边界·只碰**：`apps/datacore/src/solvers/capacity.ts`（computeRollup 加 per-工序×型号-物料颗粒·`byProcessModel`）· `apps/datacore/src/solvers/risk.ts`（bottleneck 因子枚举扩）· `apps/datacore/src/solvers/service.ts`（`LEVER_FACTOR_PROPS:230-235` 扩 + `discoverLevers` grain 作用域 + `gapAttribution` 已支持 scope 不改算法）· `packages/contracts/src/solvers.ts`（`CapacityForecastOutputSchema` additive `byProcessModel` + `ForecastArgs.granularity`）· 新 `packages/contracts/src/capacity-factors.ts`（`CapacityFactorBinding` 20 因子绑定单源）。
**禁碰**：任何前端文件、agentcore、`recompute` 数学内核（`ontology-core.ts`）。
**SEAM-GATE（datacore 内·变异反证非重言）**：`capacity-atom-factor.test.ts`——改一个 `Process×Model` 的 `MaterialBalance.coverage`/`Process.yield_baseline` → `capacity_forecast.byProcessModel` 对应格真变 + `discoverLevers` 反推出该原子因子且敏感度非零；改坏因子绑定→红咬。
**handoff 分支**：`claude/handoff-wo-caplive-atom`。

### WO-CAPLIVE-2-COCKPIT（前端整单 · 1 fresh dev · owns RiskBoardView）

**🚦范围边界·只碰**：`apps/frontend-shell/src/views/RiskBoardView.tsx`（RiskDetailPanel 插入活面板挂点 + `gap_attribution` 传 scope + 方案存比 UI）· `apps/frontend-shell/src/views/sim/DynamicLeverPanel.tsx`（**参数化** `targetType/targetProp/scopeObjectIds`·`:91`·保 ProjectSimView 不回归）· 新 `apps/frontend-shell/src/views/capacity/CapacityLiveDialog.tsx`（NL 框 UI·调 WO-LIVE-NL 端点）· `apps/frontend-shell/src/locales/zh.ts`（文案 additive）· `apps/frontend-shell/src/api/endpoints.ts`（append 客户端封装）。
**禁碰**：datacore、agentcore、其他视图（ProjectSimView 仅作参照·参数化后回归它）。
**SEAM-GATE（前端+datacore merge 态·头号判据）**：`caplive-cockpit.test.tsx`——① 拨原子因子→发 `generic_inference` 携真 `{objectType,objectId,prop,value}`→deltas 非零逐字投影（KILL-MOCK：喂显式 mock 证零写死）② 因子级根因传 `scope.factorId` 树随之细分 ③ 存 A 分支 B 横比矩阵各格 = 各方案真算 ④ tornado 排序=真敏感度 ⑤ 采纳走 PENDING_APPROVAL 非 toast。**须在 WO-CAPLIVE-1 合并态跑**（改原子因子→真重算，任一半漏即红·"绿测试≠能用·断在接缝"）。
**handoff 分支**：`claude/handoff-wo-caplive-cockpit`。

### WO-CAPLIVE-3-NL 见共享 `WO-LIVE-NL`（agentcore·产能 what-if 意图路由）；方案存比后端见共享 `WO-LIVE-SCENARIO`。

> **接缝纪律声明**：WO-CAPLIVE-1（引擎深化）↔ WO-CAPLIVE-2（前端渲染）虽分两单，但**用同一 `generic_inference` 机制**（非 metric-aware 式两半异构对不上），§4 冻结契约 + WO-CAPLIVE-2 的 merge 态 SEAM 组合测（改原子因子→真重算→比对·任一半漏即红）作对接铁证——**审核方复验头号判据 = 该组合测在 WO-1+WO-2 合并态通，非各半绿**（抄 GSIM cell-pack 接真收口范式）。
