# PRD — 规则即引用 · 推演全入口统一 · 规则可编辑（去硬编码规则）

> 状态：定稿设计，供其他 agent 遵循开发。**不分 A/B 侧**——按链路与不变量组织。
> 一句话目标：**所有推演入口（项目推演 / 人机对话 / CLI / 驾驶舱 / 启动器 / Agent）的规则判定，全部从"可编辑的一等规则库"按引用读取，不再写死在代码里——改一条规则即所有入口的推演行为自然随之变化，无需改代码、无需重新部署。**

---

## 0. 问题（本会话实测证据）

用户在「项目推演 / 聚合求解器 capacity_forecast」的「关联规则」里看到 **C01/C02「当前库中没有找到定义」**，却仍出推演结论。逐层核（前后端 + 活系统）：

1. **求解器不读规则**：`capacityForecast`（`capacity.ts:179`）从对象图确定性算 P50/P90/缺口，**全程不碰规则库**；`SolverContext`（`types.ts:210-236`）**根本不带 `rules`** → 求解器读不到规则定义。
2. **规则逻辑写死在代码**：C09（数据健康降级，`capacity.ts:189-197`）、C01（产能上限，`battery.ts:1285` 注释）等**烘在求解器里**，规则引擎不可见、改不动。
3. **引用 ≠ 定义**：全代码库被引用 **29 个规则码**，规则库只定义 **15 个**（活系统实测：`C03 C05 C08 C12 C13 C18 C23 C26 C27 C28 C29 C30 C31 C32 C33`）→ **14 个被引用但未定义**：`C01 C02 C04 C06 C09 C10 C11 C15 C16 C21 C22 C24 C25 C90`。
4. **关联规则半空 + 规则闸空过**：前端 `RuleRef.tsx:34` 查不到定义即显示"（当前库中未找到定义）"；`evaluate_rules` 遇未定义规则 fail-open（跳过）→ 推演照出数，但**那道规则闸空过**，结论**从未被这些规则真校验**。
5. **全入口共一个汇聚点**：所有推演（前端 `invokeSolver` / CLI `solve` / QOS path A `invoke_solver` / Agent OBO）**最终都汇到 `POST /a/v1/solvers/:key/invoke`**（`endpoints.ts:176`、`platform-cli.mjs:241`、orchestrator path A、agent executor）。

**根因**：规则**不是引用，是散落的硬编码 + 半截迁移**。本体 §2.C 已记录"C26–C33 此前硬编码在求解器、规则引擎不可见 → 已迁成一等规则"——**这迁移没做完**，C01/C02/C09 等仍停在旧态；且**求解器机制上就读不到规则**（SolverContext 无 rules）。违 R14（零业务常数）的规则维度。

> 戒律：**绿数字 ≠ 规则真把过关**。推演出了数，不等于声称的规则真的评估过、真的能拦。

---

## 1. 北极星（用户视角完成定义）

1. **改规则即改推演**：管理员在规则编辑器把 C03 的阈值从 `>0.5` 改成 `>0.4` 并发布 → **项目推演 / 人机对话 / CLI / 驾驶舱 / 启动器 / Agent 全部入口**的承接判定**立即随之变化**，无需改代码、无需重启。
2. **零未定义引用**：任何"关联规则"码都能在库里查到定义、可编辑、被真评估；**绝不**出现"（当前库中未找到定义）"。
3. **零规则闸空过**：`evaluate_rules` / 求解器内每一道规则判定，都对应一条**已发布**规则；未定义即门禁红、拒发布，不静默 fail-open 冒充已校验。
4. **所有规则可编辑**：UI 规则编辑器 + API（已存在 CRUD）+ CLI `rule` 三入口皆可增删改、dry-run、发布/退役；编辑走版本（R6 可复现）。
5. **不在本次范围**（诚实边界）：规则 DSL 表达式语言扩展（新算子）；跨租户规则模板市场；规则的自然语言抽取（A2 另有）。

---

## 2. 设计

### 2.1 唯一汇聚点：在 `/a/v1/solvers/:key/invoke` 注入规则解析（全入口一次覆盖）
所有推演入口都汇到 datacore 的 solver invoke（§3 矩阵）。**只要在 invoke 构建 `SolverContext` 时注入规则、并让求解器从规则读判定，全部入口自动获得"规则即引用"——无需逐入口改。**

### 2.2 求解器读规则（references，不硬编码）
- `SolverContext += rules`（**本租户已发布规则快照**，按 ruleKey 索引）`+ ruleSetVersion`（规则集版本指纹）。
- 求解器**两类用法**：
  - **闸门判定**：求解器算出原始值后，调**规则引擎** `evaluate(rule, values)` 得 BLOCK/WARN/pass → 闸门结论**来自规则表达式**，非硬编码阈值。
  - **计算输入阈值**（如 C09 staleHours、C03 产能上限系数）：从 `rule.params[key]` 读 → 改规则 params 即改计算。
- **ruleRefs 从装饰标签升为真正驱动行为的引用**：求解器声明它用哪些 ruleKey（`SOLVER_RULE_REFS[solverKey]`），invoke 时解析为规则对象注入；输出 `evaluatedRules[]`（哪几条真评估了、各自结果）供"关联规则"面板显示**真**结果。

### 2.3 规则作为一等可编辑对象（补全 + 复用既有 CRUD）
- **补全 14 个未定义规则**为一等规则（key/name/expression/severity/**params**），含被写死的 C01/C09 的阈值显式化。
- **编辑入口三处复用**（已存在）：API `POST/PUT /a/v1/rules` `/:id/publish` `/:id/retire` `/dry-run` `/evaluate`；CLI `rule`（`platform-cli.mjs:212`）；前端**规则编辑器**（补/完善 UI：列表 + 编辑表达式/params/severity + dry-run 预览 + 发布）。
- **R14 单一来源**：规则定义只此一处（规则库），求解器/卡/前端**全派生引用**，不得另存阈值副本。

### 2.4 规则版本 ⊕ 推演确定性（R6 不破）
编辑规则会改输出 → **必须版本化**：
- 规则发布生成版本指纹 `ruleSetVersion`（djb2 纯 JS，R6 同内容同指纹）。
- 每次推演**记录所用 `ruleSetVersion`**（落 SolverResult / 溯源）。
- **R6 重述**：同输入 + **同规则集版本** + 同参数版本 = 同输出（字节一致）。改规则=换版本=允许改输出，但每个版本内可复现。

### 2.5 去硬编码规则（审计 + 迁移 + 门禁）
- **审计**所有求解器内联的规则逻辑（C09/C01 等）→ 抽成规则定义（expression + params）+ 求解器改为读规则。
- **门 `rule-closure:check`**：枚举全代码库被引用的规则码（`SCENARIO_CATALOG.rules` ∪ `SOLVER_RULE_REFS` ∪ 输出 ruleRefs）⊆ 已发布规则库 → 有引用无定义即**红**（杜绝"未找到定义"回潮）。
- **门 `no-hardcoded-rules:check`**：求解器源码中与规则同义的"业务阈值常量"（产能上限/红线比例/越线天数…）必须源自 `rule.params` 或 `c.params`（boundary），不得字面硬编码 → 红（呼应 `debattery:check` 的规则维度）。

---

## 3. 全推演入口覆盖矩阵（每个都经汇聚点 → 一次注入全覆盖）

| # | 入口 | 触发路径 | 汇聚点 | 覆盖方式 |
|---|---|---|---|---|
| 1 | **项目推演** ProjectSimView | `useLiveSolver` → `POST /b/v1/solvers/:key/run` → OBO | `/a/v1/solvers/:key/invoke` | §2.2 自动 |
| 2 | **人机对话** 对话坞 QOS | `submitQuery` → path A 工作流 → `invoke_solver` 步 | 同上 | §2.2 自动 |
| 3 | **CLI** | `platform solve <key>` (`cli:241`)；`ask "<问句>"` 走 QOS | 同上 | §2.2 自动 |
| 4 | **场景启动器** | 点卡 → launch → QOS path A → invoke_solver | 同上 | §2.2 自动 |
| 5 | **经营驾驶舱 / 看板** | `invokeSolver(key)` 直调（DashboardView/RiskBoardView） | `/a/v1/solvers/:key/invoke` | §2.2 自动 |
| 6 | **Agent 路径 B** | `invoke_solver` 工具 → OBO | 同上 | §2.2 自动 |
| 7 | **数据构建发动机一键推演 / A10 验证** | `useQuickLaunch` → QOS | 同上 | §2.2 自动 |

> 关键：**因为全部汇到 `/a/v1/solvers/:key/invoke`，规则注入只做一处，7 个入口同时拿到"规则即引用"。** 验收须逐入口实测（§8）。

---

## 4. 契约（`packages/contracts` 单一来源）

```ts
// 规则补 params（求解器可读的命名阈值）+ 版本
export const RuleSchema = z.object({
  key: z.string(), name: z.string(),
  expression: z.string(),                          // 闸门：规则引擎评估
  severity: z.enum(["BLOCK", "WARN"]),
  params: z.record(z.string(), z.number()).default({}), // 计算输入阈值（如 staleHours/ceiling），求解器读
  scopeObjectTypes: z.array(z.string()).default([]),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  version: z.number().int(),
});

// 求解器声明它引用哪些规则（单一来源，门 rule-closure 据此校验）
export const SOLVER_RULE_REFS: Record<string, string[]>; // e.g. capacity_forecast: ["C01","C02","C03","C09"]

// SolverResult 透出真评估结果 + 规则集版本（关联规则面板显示真结果，R6 溯源）
export const EvaluatedRuleSchema = z.object({
  key: z.string(), severity: z.enum(["BLOCK","WARN"]),
  outcome: z.enum(["PASS","WARN","BLOCK","NOT_APPLICABLE"]),
  evidence: z.string().optional(),
});
// SolverContext += rules: Map<string, Rule>; ruleSetVersion: string
// SolverResult  += ruleSetVersion: string; evaluatedRules: EvaluatedRule[]
```

## 5. 端点 + 数据流

```
编辑规则(三入口) ── PUT /a/v1/rules/:id ──> DRAFT ── /publish ──> PUBLISHED(version++, ruleSetVersion 变)
     └─ 发 rule.updated 事件 → B 缓存失效(60s SLO) → 全入口下次推演读新版本

任一推演入口 ──汇──> POST /a/v1/solvers/:key/invoke
     ├─ buildSolverContext: 注入本租户已发布 rules 快照 + ruleSetVersion
     ├─ 求解器 compute: 闸门调 ruleEngine.evaluate(rule,values) · 阈值读 rule.params
     └─ SolverResult { data, ruleSetVersion, evaluatedRules[] } ──> 前端「关联规则」显示真评估结果
门: rule-closure:check（引用⊆定义） · no-hardcoded-rules:check（无硬编码阈值） → pnpm gates
```
事件：`rule.updated`/`rule.published`（已有或补，并入 outbox，B 缓存失效钩子）。

## 6. 门禁（并入 `pnpm gates`）

1. **`rule-closure:check`**：`⋃(SCENARIO_CATALOG.rules, SOLVER_RULE_REFS, 输出 ruleRefs) ⊆ 已发布规则 key 集`，否则红（列出缺失码）。**这条直接杜绝用户看到的"未找到定义"。**
2. **`no-hardcoded-rules:check`**：扫求解器源码，与已登记规则同义的业务阈值常量必须来自 `rule.params`/`c.params`，字面硬编码即红。
3. 既有 `chain:check`/`debattery:check` 扩规则维度。

## 7. 《本体引用与影响》

- **对象类型**（§2.C）：Rule（+params/version）、RuleDoc、Solver、SolverContext/SolverResult（+rules/ruleSetVersion/evaluatedRules）、ScenarioCard（rules 引用）。
- **链路**（§3）：`推演入口 --汇--> solver invoke --读引用--> Rule(已发布) --evaluate--> 闸门结论`；`编辑规则 --publish--> ruleSetVersion 变 --事件失效--> 全入口下次读新版`。**新增"求解器→规则库"读链路 → 必回写本体 §3。**
- **不变量**：**R14（零业务常数 → 规则零硬编码，核心）**、**R6（规则版本钉死，推演记录 ruleSetVersion，同版本可复现）**、R13（evaluatedRules 是派生投影非新真值）、R16（规则目录单一来源、能力环自派生）、R-一致。
- **事件**（§4）：`rule.updated`/`rule.published`（下游缓存失效 + 驾驶舱可订阅）→ 回写 §4。
- **断点**（§8）：**新登记 G-10「规则被引用/被写死，但非一等可编辑引用 → 关联规则半空、规则闸空过、改规则不改推演」**，本 PRD 即其修法 → 回写 §8；并把 §2.C "C26–C33 已迁一等规则" 的备注扩为"全部被引用规则码已一等化（rule-closure 门守）"。
- **门禁**（§7）：新增 `rule-closure:check`、`no-hardcoded-rules:check` → 回写 §7。
- **落地须回写**：实施后 §2.C（Rule+params/version）/§3（求解器读规则链 + 规则编辑→失效链）/§4（事件）/§7/§8（G-10）全部回写 `docs/SYSTEM-ONTOLOGY.md`。

## 8. 验收（FDE 亲手 · 不接受测试绿冒充）

1. **改规则即改推演（核心，逐入口）**：把 C03 阈值 `>0.5`→`>0.4` 发布 → 用**同一组输入**分别从 ①项目推演 ②对话坞问句 ③CLI `solve capacity_forecast` ④驾驶舱 ⑤启动器点卡 ⑥Agent 跑一遍 → **6 个入口的承接判定都随之改变**（截图/贴答案对比改前改后）。
2. **零未定义**：`GET /a/v1/rules` 含全部被引用码；项目推演「关联规则」**不再**出现"（当前库中没有找到定义）"，且每条显示**真评估结果**（PASS/WARN/BLOCK）。
3. **零空过**：人为把某 ruleKey 退役 → 引用它的推演**不再静默 fail-open**，而是门禁红 / 诚实标"规则缺失"。
4. **去硬编码**：grep 确认 C01/C09 等阈值已移入规则定义，求解器读 `rule.params`；`no-hardcoded-rules:check` 绿。
5. **R6 可复现**：同输入 + 同 `ruleSetVersion` 重跑 → 字节一致；换规则版本 → 输出按预期变且记录版本。
6. **门 + 测试全绿**：`pnpm -r build && pnpm -r test` + `pnpm gates`（含两新门）。
7. **北极星距离**：汇报列"还差哪几环 + 哪些是 happy-path"（fde-delivery）。

## 9. 分期

- **P1（止血 + 闭引用）**：补全 14 个未定义规则为一等规则（含写死阈值显式化）+ `rule-closure:check` 门 + 前端「关联规则」显示真定义/真评估。**先让"未找到定义""空过"消失。**
- **P2（求解器读规则）**：`SolverContext += rules/ruleSetVersion` + 求解器闸门改调规则引擎、阈值改读 `rule.params` + `evaluatedRules` 透出 + `no-hardcoded-rules:check` 门。**让"改规则即改推演"成立。**
- **P3（编辑闭环 + 版本 + 全入口验收 + 本体回写）**：规则编辑器 UI 完善 + 版本/事件失效 + 6 入口逐一 FDE 验收 + 回写本体 §2.C/§3/§4/§7/§8。

> 与其它 PRD 关系：本 PRD 是「规则」维度的去硬编码（R14）；`PRD-scenario-ontogenesis.md` 是「场景卡闭包」维度的发育闭环。二者正交、可并行；规则一等化后，场景卡发育的"规则环"直接复用本 PRD 的规则库。
