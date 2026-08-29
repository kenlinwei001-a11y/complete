# 优化求解器融合 · 开工与评审契约（实现 agent 照此开工 · 架构 agent 负责评审）

> 这是什么：把"借鉴某参考开源优化推演项目（MIT）+ 其行业 OR 模型数据集（CDLA-2.0），把优化求解能力融进本平台"串成**一张可交接、可评审的契约**。**实现 agent**：从本文开工，照增量顺序做、守红线、过门、附 FDE 证据，逐增量提交（同分支 commit，非 PR）。**架构评审 agent（我）**：按第 5 节逐增量评审，对照红线/门/本体回写/不分叉/许可证，通过才"可合"。
> 分支：只推 `claude/vigilant-knuth-b1nmxn`；模型标识不进提交物。
> 北极星：任意行业租户经 CLI/UI 调一个**抽象优化模板**绑到自己本体 → 求最优 → 对它做目标级 what-if（扰动重解）→ 看 Δ目标值/冲突约束/溯源解释，全程配置驱动、确定性、可回退、可按租户暗发分模块；**借鉴=重写方法+派生产物+评测，绝不训练**。

---

## 1. 先读这些（canonical · 按序）+ 对齐这些（既有 · 禁分叉）

**先读（本仓库 docs/）**：
0. `SPEC-optimization-template-pool.md §14` — **接地核验与校正（最先读）**：本设计对当前真实代码的逐条核验 + 复用锚点(file:line) + 7 条校正。凡设计与 §14 冲突，以 §14 为准。
1. `SPEC-optimization-template-pool.md`（§1–§13）— 做什么（5 层架构：抽象模板池/本体绑定层/embedding 复用检索 advisory/optimize_whatif/行业租户=绑定演示，全按租户配置）。
2. `THIRD-PARTY-NOTICES.md` — **许可证合规（硬约束）**：MIT 署名 / CDLA 取 Results / Gurobi 不碰 / **不训练红线**。

**对齐（既有代码/PRD，融合扩展不另起，违反=RL10 红）**：
- 求解器层 `solvers/service.ts`（SOLVER_KEYS:26 / SOLVER_OUTPUT_SHAPES:101 / invoke 拦截:1333）+ `optimizer-client.ts`（CP-SAT sidecar:85/94）。
- A13 `solvers/field-roles.ts:67`（角色解析）· 切片 `ontology/slice-planner.ts:69` + `slice-index.ts:38`（复用检索结构层）。
- DF.8 `solvers/llm-gen.ts:23 checkGrounding` + `service.ts:212 deriveGroundingVocab`（接地）。
- 不落真值 what-if `ontology-core.ts:341 recompute(dryRun)` + `service.ts:368 genericInference` + 端点 `app.ts:2340`。
- A18 锁沙箱 `solvers/sandbox.ts` + `sandbox-runner.mjs`（**仅纯函数**）· `SolverArtifact` 相位 `contracts/solvers.ts:267` + `promoteSolver service.ts:348` + `provisional-honesty.ts`。
- `features.ts:12 FeatureDef`（entitlement 形状，沙盘 sim.* :83-90 为样板）。

---

## 2. 建什么（范围 · 收敛不增殖）

**建**：一个抽象优化模板池 + 一个本体绑定层 + embedding 复用检索（advisory）+ optimize_whatif + 行业租户绑定演示，全部按租户 entitlement 暗发。

**真正新写的（其余全复用 §1 对齐件）**：
1. **5 个 CP-SAT 核心**（facility_location/min_cost_flow/set_cover/independent_set/combinatorial_auction）—— 照 `optimizer-client` 扩，派生表达（非拷贝上游/不碰 Gurobi）。
2. **OntologyBinding 绑定层**（invoke 前统一 args 预处理：本体类型→模型角色，复用 A13/slice/DF.8）。
3. **optimize_whatif**（结构化扰动 → **sidecar 重解** → Δ目标值，复用 recompute(dryRun) 不落真值骨架）。
4. **embedding 复用检索**（advisory，net-new 基建，平台今天无 embedding 层）。
5. **行业租户配置 + opt.* entitlement**（绑定演示，非另写代码）。

**不在范围**（诚实边界）：上游 `exec` 任意 LLM 代码（我们换结构化扰动+sidecar）；Gurobi 商业求解器；把上游内容训练任何模型；一次性铺所有行业租户（先 2 个证 R14，渐进）。

---

## 3. 怎么建（增量顺序 · 每增量 DoD · FDE 亲手）

| 增量 | 内容 | 完成定义（DoD） |
|---|---|---|
| **0 本体先行+许可证** | `OptModelTemplate`/`OntologyBinding`/`OptPerturbation` + `optimize_whatif` + 9 模板族 + `sim.*`类比 `opt.*` entitlement + **G-12** + 3 门登记，写进 `SYSTEM-ONTOLOGY.md §2.D4/§3/§4/§7/§8`；建 `THIRD-PARTY-NOTICES.md` + `solver-license:check`（不训练/无 Gurobi 指纹/MIT 署名） | `ontology:check`+`prd:check`+`solver-license:check` 绿；零代码 |
| **1 CP-SAT 5 核心** | `optimizer-client.ts` 加 5 个 `solveXxx` + `service.ts` 加 5 求解器 + 并入 `SOLVER_KEYS`/`SOLVER_OUTPUT_SHAPES` + invoke 拦截；派生表达零业务常数 | **CLI 无头求一个最优解**（贴输出）；`chain:check`+`debattery:check`+`opt-determinism:check`（seed 字节一致）绿；**不碰 Gurobi**（solver-license 绿） |
| **2 本体绑定层** | `OntologyBinding`（invoke 前 args 预处理：A13 角色推断+slice 范围+**DF.8 接地去电池化**）；系数=绑定类型化字段(可选 `coefficientRef→rule.params`) | **同一模板绑两租户本体各求解**（代码零改，仅绑定不同）；`opt-template:check`（零业务常数+requiredRoles+provenance）绿 |
| **3 optimize_whatif** | 结构化扰动 schema → DF.8 接地 → **sidecar 重解** → {Δ目标,可行性,冲突约束}；复用 `recompute(dryRun)` 克隆+不落真值，invoke 前拦截；R4 采纳才写 | **CLI 改一参/加一约束→出 Δ目标值+冲突约束**（贴输出）；确定性 R6；R4 模拟态不写真值 |
| **4 embedding 复用检索** | 平台级模板 embedding 索引（net-new）；`opt retrieve` 检索最近模板/覆盖缺口；**advisory 不入确定性求解路径（R6 地板）**；关 entitlement 退回 comprehend 列表不静默 | `opt retrieve` 返候选；**关 entitlement→退回确定性列表**；embedding 不在 solve 路径（`opt-determinism:check` 守） |
| **5 行业租户=绑定演示** | ~7 行业租户配置（合成→runStory→绑定→求解器）；`opt.*` 7 条 `defaultOn:false` 暗发分模块 | **两行业各端到端跑通**（证 R14，代码零改）；lite/Pro/旗舰 entitlement 各得不同模块（关=404） |
| **6 离线模板进化器（远期·可选）** | 借遗传操作/可行性过滤/参数自调，**目标倒转**(覆盖缺口非多样)；产物 PROVISIONAL→接地→GOVERNED；跑 **A18 锁沙箱**（纯函数模板代码） | 离线长出 ≥1 PROVISIONAL 模板，经接地+验证才 GOVERNED；`provisional-honesty:check` 绿；**绝不训练** |

增量 4 可在 2/3 后并行；6 远期。**优化 UI 不另起大页**——optimize_whatif 作 G-11 沙盘内一类"优化推演"求解器（`SimSession`/`propagateTick` 可调任意已发布求解器），结果走既有渲染 + 沙盘决策页，additive 暗发。

---

## 4. 红线（越线即停）

**复用沙盘十红线**（RL1 本体先行 · RL2 暗发 · RL3 单一来源 · RL4 走正门 · RL5 零业务常数 · RL6 确定性 · RL7 CLI 先于 UI · RL8 倒序长出 · RL9 additive 可回退 · RL10 不与在建分叉），**叠加许可证 + 融合专属红线**：

| # | 红线 | 兜底 |
|---|---|---|
| **LIC1 不训练** | 绝不把上游任何内容（QA/模型/数据集）喂任何模型训练/微调 | `solver-license:check` |
| **LIC2 Gurobi 不碰** | 不移植/不转发 Gurobi 版权示例 | `solver-license:check`（指纹） |
| **LIC3 MIT 署名** | 借鉴的 MIT 代码保留版权声明进 `THIRD-PARTY-NOTICES` | 同上 |
| **LIC4 CDLA 取 Results** | 只取派生产物；不原样转发上游数据文件 | 评审 |
| **FUS1 重解走 sidecar** | optimize_whatif 重解走 `optimizer-client` sidecar，**不进 A18 沙箱**（沙箱跑不了 CP-SAT） | 评审 + §14.2 |
| **FUS2 embedding advisory** | embedding 只做检索/排序听懂层，**不进确定性求解路径**（R6 地板） | `opt-determinism:check` |
| **FUS3 接地去电池** | 多行业绑定前先把 `checkGrounding` 正则去电池化（现仅认 基地/产线/工厂） | `opt-template:check` |
| **FUS4 系数语义** | 系数=绑定类型化字段（可选引 rule.params），**不把系数硬塞进规则**（规则是 gate 非系数源） | 评审 |

---

## 5. 评审协议（我怎么 review · 实现 agent 据此自检）

**每增量逐项核对，全过才"可合"，任一红列具体红线/门打回**：

| 评审项 | 通过判据 |
|---|---|
| **① 红线** | 十红线 + LIC1–4 + FUS1–4 逐条不违反 |
| **② 门全绿** | `pnpm -r build && pnpm -r test && pnpm gates`（当前 16 门）+ 该增量命名门(`opt-template`/`opt-determinism`/`solver-license`) |
| **③ 本体回写** | 改链路/事件/对象/门 → 回写 §2.D4/§3/§4/§7/§8，`ontology:check` 绿；G-12 入 §8 |
| **④ CLI 对等** | 新优化能力有 `cliCommand`，`cli-parity:check` 绿，CLI 先于 UI |
| **⑤ 不分叉** | 复用 §1 对齐件（optimizer-client/A13/slice/DF.8/recompute/SolverArtifact），未平行造第二套 |
| **⑥ FDE 证据** | 附"以用户身份亲手跑一遍"（CLI 求最优/whatif 输出、两行业截图），非只单测绿 |
| **⑦ 北极星距离** | 描述含"还差什么 + 哪些 happy-path/合成" |
| **⑧ 可回退** | `opt.*` entitlement 关=404；迁移有 down；旧路径在 |
| **⑨ 许可证合规** | `solver-license:check` 绿；无 Gurobi 文件；无训练管线引用；`THIRD-PARTY-NOTICES` 收录 |

**评审产物**：✅可合 / 🔴打回(列项+红线+建议)。**我不替实现，只评审+守纪律。**

---

## 6. 提交规范（同分支协同纪律 · 同沙盘 HANDOFF §6）

- **不开新分支/不开 PR**；每增量 commit+push 到 `claude/vigilant-knuth-b1nmxn`，评审在分支上做。
- **每次 push 前** `git fetch origin claude/vigilant-knuth-b1nmxn && git rebase origin/claude/vigilant-knuth-b1nmxn`；冲突解完复跑 `pnpm gates` 再 push。
- **三类高冲突文件**（`packages/contracts`/`package.json`/`docs/SYSTEM-ONTOLOGY.md`）改动 commit 描述**单独点名**。
- commit 模板：`增量N·标题 / 做了什么 / 复用什么(证不分叉) / 本体回写§? / 高冲突文件 / CLI / 测试+gates / FDE亲手 / 北极星距离 / 许可证(无Gurobi/不训练) / 回退`。

### 6.1 评审 follow-up（非阻断小项记此，做对应增量带走）
（开工后由评审填）

---

## 7. 禁止清单（速查）

❌ 代码先行本体不回写 ❌ 默认开影响现有租户 ❌ optimize_whatif 跑进 A18 沙箱（沙箱跑不了 CP-SAT）❌ embedding 进确定性求解路径 ❌ 系数硬塞进规则 ❌ 模板/引擎出现行业实体名 ❌ 移植/转发 Gurobi 示例 ❌ 拿上游内容训练模型 ❌ 原样转发 CDLA 数据文件 ❌ exec 裸 LLM 代码 ❌ UI-only 无 CLI ❌ 平行造第二套求解器注册/接地/相位 ❌ 拿绿测试冒充能用。

---

## 8. 起步第一步（建议立刻做）

**增量 0（零代码、最先）**：把 `OptModelTemplate`/`OntologyBinding`/`OptPerturbation`/`optimize_whatif`/9 模板族 + `opt.*` entitlement + **G-12** + 3 门写进 `SYSTEM-ONTOLOGY.md §2.D4/§3/§4/§7/§8`（精确清单照 `SPEC §12`）；建 `THIRD-PARTY-NOTICES.md`（已有→核对完整）+ `scripts/check-solver-license.mjs` 并入 gates → `ontology:check`+`prd:check`+`solver-license:check` 绿 → 提交。我评审这第一步重点核 G-12/3 门入本体 + 许可证红线（不训练/无 Gurobi/MIT 署名）就位。

> 契约生效：实现 agent 从增量 0 起逐增量提交；我逐增量按第 5 节评审。**有疑义先问，不猜；越红线先停，不硬上。**
