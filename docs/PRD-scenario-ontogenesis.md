# PRD — 场景卡发育闭环（从胚胎到可用）· 根治「点卡→OUT_OF_CATALOG→探索→空答」

> 状态：定稿设计，供其他 agent 遵循开发。**不分 A 侧/B 侧**——按链路与发育相位组织。
> 一句话目标：把"场景卡"从**静态手装、浅门放行、缺则静默掉探索**的死物，变成 **R16 发育闭环的活体器官**——投下一颗胚胎（卡）→ 系统自动长出全闭包并**亲手验证能用**才上架 → 正序点卡确定性走通；缺一环就**生长或诚实开工单，绝不静默"未能产出回答"**。

---

## 0. 问题即原则被违反（实测证据 · 本会话亲手跑出）

用 planner 点 S01「4680-NCM 加 20% 六周能不能接」→ 前端显示**「（探索模式未能产出回答）」**。逐层定位（前后端一起跑）：

| 层 | 实测 | 锚点 |
|---|---|---|
| 路由 | task 的 `classification = OUT_OF_CATALOG`（候选空）→ 转 Path B 探索 | 任务详情页「分类结果」 |
| 探索 | agent 真跑 discover→get_object→invoke_solver→query_objects（全 OK），第 6 步撞 `BUDGET_EXCEEDED`(90s 墙钟) → `lastText` 空 → 兜底串 | `agent/loop.ts:215`、`DEFAULT_AGENT_BUDGET`(qos.ts) |
| 种子 | **意图/计划的播种守卫挂在"包是否存在"**：包已存在 → 意图永不再种 → 候选空 | `main.ts:22-29` |
| 解耦 | `ensureScenarios` 独立懒种**场景卡**（挂 `scenarios.byKey`）→ 卡可见、意图空 | `server.ts:1775` |
| 上架门 | `scenarioClosure` 只查 intent/plan/agent **存在**，不验"真能跑出答案" → 20/20 假绿 | `server.ts:1791` |
| 渲染 | 16/20 卡计划是 `invoke_solver→render(静态文本)`，不投影求解器输出 | `seed.ts:389-400` |

**根因**：场景卡这条路**没走 R16 发育闭环**——闭包靠一次性手装播种（挂错键、PG 真部署即失效），上架靠浅门（查存在≠能用），运行缺则**静默掉探索**（违 R16「绝不静默残缺」「GapReport=生长信号触发倒序生长」）。`StoryBuildRun⊕A10⊕自成长发动机` 这套发育机件**已存在**，却只服务"数据构建发动机/故事建域"，**没接到场景卡**。

> 核心戒律（R16 + 「绿测试≠能用」）：器官"看得见"≠"长成了"≠"能用了"。**三者必须由"亲手跑通一遍"绑定。**

---

## 1. 北极星（用户视角完成定义 · DoD-as-experience）

1. 用户点**任一**场景卡 → 必得**该业务的真决策视图**（KPI/表/图/时序），或**诚实**"此卡发育中，缺 X（已为你建工单/正在生长）"——**永不**"未能产出回答"。
2. **新建/导入一张卡 = 投下一颗胚胎**：系统自动**倒序发育**长出全闭包（意图发布 / 计划+投影渲染 / 规则接进 / 切片生成 / 求解器 / 数据）→ **A10 亲手跑主问句验证真出答案** → 才标 GOVERNED 上架；缺人工环节自动开 `GrowthTicket`。
3. 与 **classifier 死活、目录种没种、部署模式（内存/PG）、角色**全部**解耦**——卡的闭包一旦长成并验证，正序点卡走**确定性**绑定，不靠 LLM 重新分类。
4. **不在本次范围**（诚实边界）：自由问句（非卡）的探索体验优化；Path B agent 预算调参；真实外部数据源接入（仍走真人正门）。

---

## 2. 设计：场景卡 = 发育器官（把 R16 落到卡）

### 2.1 卡 = 基因组（声明目标闭包）
`ScenarioCard` 已有 `intentKey/triggerQuestion/solver/rules/presetContext`。**显式补全它声明的目标闭包**（基因组）：意图、计划步骤序（含**渲染投影目标** = 要把求解器哪些输出字段投成哪种 block）、要评估的规则、要用的切片、求解器输出形状、数据需求。这是"要长成什么"的单一来源。

### 2.2 倒序发育（卡 publish/seed 时长全闭包，复用既有发育机件）
新增 `growScenario(card)`：把卡当 `BuildPlan` 喂给**已有**发育管线，逐项 provision（复用，不重写）：
- **意图**：`upsert` 并 PUBLISH（候选可被 classify 命中）。
- **计划**：scaffold `ExecutionPlan`，render 步**绑定求解器真实输出字段**（`SOLVER_OUTPUT_SHAPES` 校验，闭 G-2/SHAPE）——**消灭静态占位**。
- **规则**：卡声明的 `rules[]` → 自动插 `evaluate_rules` 步（消灭"规则只挂卡面不执行"）。
- **切片**：计划需要的本体子图 → `slice-planner.planSlice`（A3.3 确定性 BFS）自动生成 + 索引复用（A3.4）。
- **求解器**：缺 → A18 生成临时求解器（PROVISIONAL，接地校验 DF.8）或开工单。
- **数据**：缺 → DF.9 真人正门 HARD（真实业务实体）/ SOFT 合成（通用）。
- 复用：`databuilder/provisioners.ts ModuleProvisioner`、`runStory`、`slice-planner`、A18。**ModuleProvisioner 的 13 need 数组天然覆盖这些器官**。

### 2.3 A10 验证即上架门（build-to-verify，不跑通不 GOVERNED）
卡**不因"意图/计划存在"就 ready**，而是：`growScenario` 末步**把卡的 `triggerQuestion` 经 QOS 正序实跑一遍**（复用 `verifyBuild`，A10）→ 终态产出**真 answer（非空、非占位、非探索兜底）** 才标 `GOVERNED/ready`；否则 `PROVISIONAL` + 记录缺口码。**`scenarioClosure` 从"查存在"升级为"查跑通"**——`ready=true ⟺ 这张卡被亲手跑到 VERIFIED`。

### 2.4 正序运作：确定性绑定已长成的闭包（D8 是发育的自然结果，非补丁）
点卡（`launch`/`useScenarioLaunch`）时：卡若 `GOVERNED` 且声明了 `intentKey` 且该意图已发布 → **直接确定性绑定意图→计划，跳过 LLM classify**；classify **只服务自由问句**。因为闭包已被**长成并验证**，正序信任它——这从根上让点卡**不受 classifier/目录/角色/缓存影响**。这不是绕过分类器的补丁，而是"发育已闭合 ⇒ 正序确定运作"的 R16 应有之义。

### 2.5 GapReport = 生长信号（缺则生长/开单，绝不静默掉探索）
任何卡运行（或验证）若不可答：跑 `classifyGap`（7 码）→ `GapReport`：
- **AUTO-DERIVE**：触发 `runGrowthLoop` 倒序补齐（生长缺的意图/计划/切片/求解器/数据）→ 重验。
- **NEEDS-HUMAN**：自动开 `GrowthTicket` + 通知 + 收件箱 + 深链；**前端诚实显示**"此卡发育中：缺 X，已建工单 #N"——**替换** `agent/loop.ts:215` 那句无信息的"未能产出回答"。
- **越用越大**：正序点卡产生的 GapReport 持续喂倒序生长。

### 2.6 相位成熟 + 二分处置（A18）
卡 `maturity ∈ {PROVISIONAL, ADVISORY, GOVERNED}`；只 GOVERNED 在启动器**默认**呈现为"可用"，PROVISIONAL 卡**诚实标**"发育中/未审核"。产物**二分**：AUTO-DERIVE 自动生成 / NEEDS-HUMAN 开工单，**绝不静默残缺**。

### 2.7 能力环自派生（不漂）
启动器卡目录、意图目录、求解器目录、CLI op 目录**全从注册表派生**（`deriveOperationCatalog`/`FEATURE_REGISTRY`/`SOLVER_CATALOG`，R16 ring-3）——杜绝"卡声明 vs 实际长成"再漂。

---

## 3. 三环闭合（R16，逐卡声明性校验）

| 环 | 对场景卡的含义 | 验证 |
|---|---|---|
| **数据环** | 卡的 `triggerQuestion` 正序经 QOS 真跑出非空、非占位、非探索兜底的答案 | A10 `verifyBuild` 跑到 `VERIFIED`（§2.3） |
| **本体环** | 卡新增/用到的意图/计划/切片/求解器/规则进**活体本体**（dogfooding §9），非手抄 | 落库 + `meta:sync` |
| **能力环** | 卡、意图、求解器、CLI 目录从注册表**自动派生** | `ontogenesis:check`（§6） |

---

## 4. 契约（`packages/contracts`，发自 contracts 单一来源）

```ts
// 卡的发育态（叠加既有 ScenarioCard / Scenario）
export const ScenarioMaturitySchema = z.enum(["PROVISIONAL", "ADVISORY", "GOVERNED"]);

export const ScenarioGenomeSchema = z.object({          // 基因组 = 要长成什么
  intentKey: z.string(),
  planSteps: z.array(z.object({                          // 含渲染投影目标
    type: z.enum(["resolve_slice","invoke_solver","evaluate_rules","create_action_draft","render_answer"]),
    params: z.record(z.string(), z.unknown()),
  })),
  renderBindings: z.array(z.object({ block: z.string(), fromSolverField: z.string() })), // 投影：求解器字段→block（闭 G-2）
  ruleIds: z.array(z.string()).default([]),              // 必接进 evaluate_rules
  sliceTargets: z.array(z.string()).default([]),         // 要覆盖的目标类型
  solverKey: z.string().optional(),
  dataNeeds: z.array(z.string()).default([]),
});

export const ScenarioOntogenesisRunSchema = z.object({  // 一张卡的发育运行（⊕ StoryBuildRun by runId，R16）
  runId: z.string(), tenantId: z.string(), scenarioKey: z.string(),
  rings: z.object({ data: z.boolean(), ontology: z.boolean(), capability: z.boolean() }),
  verification: z.object({ status: z.enum(["VERIFIED","NOT_VERIFIED","PROVISIONAL_ANSWER"]), gapCode: z.string().nullable(), answerPreview: z.string().nullable() }),
  gaps: z.array(z.object({ gapCode: z.string(), disposition: z.enum(["AUTO_DERIVE","NEEDS_HUMAN"]), ticketId: z.string().nullable() })),
  maturity: ScenarioMaturitySchema,
});
```
`Scenario` 增 `maturity`、`genome`、`lastOntogenesisRunId`。

## 5. 端点 + 数据流（不分 A/B，按链路）

```
新建/导入/出厂 卡(胚胎)
  └─POST /b/v1/scenarios/:key/grow ──倒序发育──> growScenario
        ├─ provision 意图/计划(+投影render)/规则/切片/求解器/数据 (复用 ModuleProvisioner/slice-planner/A18)
        ├─ A10 verifyBuild: triggerQuestion 经 QOS 正序实跑 ──> VERIFIED? 
        │     ├─ 是 → maturity=GOVERNED, rings 全闭, scenario.matured 事件
        │     └─ 否 → maturity=PROVISIONAL, classifyGap → GapReport
        │            ├─ AUTO_DERIVE → runGrowthLoop 补齐 → 重验
        │            └─ NEEDS_HUMAN → GrowthTicket + 通知 + 收件箱 + 深链
        └─ 落 ScenarioOntogenesisRun（前端 FDE 节点图可视，复用 fde-graph）

点卡(正序) POST /b/v1/scenarios/:key/launch
  └─ 卡 GOVERNED + intentKey 已发布 → 确定性绑定意图→计划(跳过 classify)
        └─ 不可答 → GapReport（同上倒序生长/开单），前端诚实显示，不"未能产出回答"
```
事件：`scenario.matured`、`scenario.gap_detected`、`scenario.growth_triggered`（并入既有 outbox/L15，下游驾驶舱/收件箱订阅）。

## 6. 门禁 `ontogenesis:check` 扩展（守不回潮）

`scripts/check-ontogenesis.mjs` 增**逐卡**断言：
1. 每张 PUBLISHED/GOVERNED 卡有 `ScenarioOntogenesisRun` 且 `verification.status==VERIFIED`（数据环）。
2. 卡计划 render 的 `renderBindings.fromSolverField ⊆ SOLVER_OUTPUT_SHAPES[solverKey]`（消灭占位/G-2）。
3. 卡声明的 `ruleIds` 全部出现在计划的 `evaluate_rules` 步（消灭"规则摆设"）。
4. 卡 `sliceTargets` 被计划 `resolve_slice` 覆盖。
5. **无静默残缺**：任何未闭环的卡必须 `maturity!=GOVERNED` 且有 `gaps[].disposition`（AUTO_DERIVE 或 NEEDS_HUMAN+ticketId）。
6. 卡/意图/求解器目录从注册表派生（能力环）。
违反即红 → 并入 `pnpm gates`。

## 7. 《本体引用与影响》

- **对象类型**（§2）：Scenario/ScenarioCard、Intent、ExecutionPlan/PlanStep、SliceSpec/SlicePlan、Solver/SolverArtifact、Rule、ActionDraft、QueryTask/AnswerBlock、StoryBuildRun、GapReport/GrowthTicket、ScenarioOntogenesisRun（新）。
- **链路**（§3）：`卡(胚胎) --grow(倒序发育)--> 意图/计划/切片/规则/求解器/数据 --A10 verify(正序)--> GOVERNED --launch(确定性绑定)--> answer`；正序 `GapReport --生长信号--> 倒序 runGrowthLoop`。**新增"卡发育"链路 → 必回写本体 §3。**
- **不变量**：**R16（核心，本 PRD 即把 R16 落到场景卡）**、R3（entitlement 先于 authz，卡呈现按相位/角色）、R4（求解器/数据转正经审批，A18）、R6（slice-planner/投影确定性）、R13（渲染是派生投影非新真值）、R14（零业务常数）、R-一致。
- **事件**（§4）：新增 `scenario.matured`/`scenario.gap_detected`/`scenario.growth_triggered`（L 序，下游订阅）→ 回写 §4。
- **断点**（§8）：**闭 G-1**（"16 卡静态渲染"——本 PRD 用投影渲染+发育验证根除）；**新登记断点 G-9「场景卡未走发育闭环：靠一次性手装播种+浅存在门+静默掉探索」**，本 PRD 即其修法 → 回写 §8。
- **门禁**（§7）：`ontogenesis:check` 扩 6 条（§6）+ `scenarioClosure` 升级为 A10 验证门 → 回写 §7。
- **落地须回写**：本 PRD 实施后，§2（ScenarioOntogenesisRun）/§3（卡发育链）/§4（事件）/§5（R16 状态）/§7/§8（G-1 闭、G-9 登记）全部回写 `docs/SYSTEM-ONTOLOGY.md`。

## 8. 验收（FDE 亲手 · 不接受测试绿冒充）

1. **逐卡跑通**：20 张卡每张 `grow` → `verification==VERIFIED` → 点卡得真决策视图（截图/curl 贴答案 blocks，非占位非探索）。
2. **PG 真部署复现修复**：在"包已存在但意图空"的 PG 库上 `grow`/启动 → 意图自动补齐发布 → 点 S01 Path A 出 KPI（根治本会话实锤的 `main.ts:24` 守卫 bug）。
3. **classifier 关掉仍 Path A**：解绑 classifier LLM → 点 GOVERNED 卡仍确定性走 Path A 出答案（验证 §2.4 解耦）。
4. **缺则不静默**：人为缺一环（删某求解器）→ 卡降 PROVISIONAL + 前端显示"发育中：缺 X，工单 #N"，**不出现**"未能产出回答"。
5. **门绿**：`pnpm gates`（含扩展 `ontogenesis:check`）+ 4 包测试。
6. **北极星距离**：汇报须列"还差哪几环 + 哪些是合成/happy-path"（fde-delivery）。

## 9. 分期

- **P1（根治当前 bug + 上架门）**：`growScenario` + A10 验证门 + §2.4 确定性绑定 + §2.5 缺则诚实开单（替换"未能产出回答"）。**先把"点卡必出答案或诚实缺口"立住。**
- **P2（投影渲染 + 规则/切片接线）**：render 投影（闭 16 占位）+ rules 自动接 evaluate_rules + slice-planner 自动生成。
- **P3（自动生长 + 相位 + 门 + 本体回写）**：GapReport→runGrowthLoop 自动补齐 + PROVISIONAL→GOVERNED + `ontogenesis:check` 扩 6 条 + 回写本体。

> 即时旁注（不属本 PRD 设计，仅解你当前 PG 部署被堵）：临时可在你的 PG 库手动补种意图/计划（`seedIntentsAndPlans()` 的 20 条），或把 `main.ts:24` 守卫从"包不存在"改为"意图不存在"——但这是**补丁**；根治是 P1 的发育闭环。
