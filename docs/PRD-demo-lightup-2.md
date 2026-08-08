# PRD-demo-lightup-2 · demo 暗发功能第二轮点亮（WO-DEMO-LIGHTUP-2）

> 一句话：`apps/datacore/src/features.ts` 有 15 条暗发键（`QOS_DARK_LAUNCH_FEATURES` 14 + `PERF_DARK_LAUNCH_FEATURES` 1），
> `seed.ts` 的 `DEMO_LIGHTUP` 此前点亮 9 条；本轮**再点 5 条、明确不点 1 条**，并对每一条给出「关 vs 开」的实测对照。
>
> **头号判据不是"改了一行常量"，是"点亮后那条路真的走得通"。** 下文每条都附真跑原文。

---

## 1 · 本轮裁决表

| 键 | 裁决 | 关态实测 | 开态实测 | 结论 |
|---|---|---|---|---|
| `agent.skill-on-free-qa` | **点亮** | 自由问答 path-B 工具集 **27 个·无 `load_skill`**；system prompt 1905 B·无技能段 | 工具集 **28 个·含 `load_skill`**；system prompt **2431 B**·含技能段与 5 个 `skl_*` id（= 该租户全部 5 条 PUBLISHED，2 条 DRAFT 未进）；`load_skill` **真被调**且技能全文（566 B）真进对话 | ✅ 真接通·端到端可用 |
| `qos.multi-intent-l2-decompose` | **点亮** | 同一复合问句落 `agent:role:supply-chain`（单角色 agent·一段自由文本） | 落 `llm-l2-decompose`·`path=WORKFLOW`·**3 路并行确定性求解**（kit_readiness / lta_gap / bottleneck_matrix·各自 ⟦ref:N⟧） | ✅ 真接通·产出形态整体改变 |
| `qos.multi-intent-orchestration` | **点亮** | 「推荐哪个经营方案？另外下周哪些订单缺料开不了工？」**只答第一问**（单意图 plan_recommend） | 落 `llm-multi-intent`·**2 路并行**（plan_generate + kit_readiness）·**两问都答** | ✅ 真接通·治「问了两件事只答一件」 |
| `qos.opt-whatif-route` | **点亮** | 该问句从不触碰 `optimize_whatif`，直接落 path-B agent | 路由**真命中**（`facility_location`·selection 3·扰动 `facilities.f1.openCost=150`）→ **真 invoke `optimize_whatif`** → DataCore 装配**诚实报缺** → `routing.degraded` → 落 path-B | ◐ 路由真接通，**但 demo 数据不足以完成**（见 §3 残口） |
| `dc.lazy-solver-context` | **点亮** | — | 同进程 A/B：3 个声明求解器输出**逐字节一致**（497885 / 6331 / 9973 B） | ✅ 前置门 SEAM-EQ 6/6 真跑通过后才点（见 §2.5） |
| `qos.llm-budget-enforce` | **刻意不点** | 只记账不拦（账本照记） | 配额耗尽 → 新任务 429 `LLM_BUDGET_EXCEEDED` | ❌ demo 上点亮 = 用户用着用着撞墙 |

---

## 2 · 逐条理由与证据

### 2.1 `agent.skill-on-free-qa` —— 有数据、有挂点，只差一把钥匙

**为什么点**：demo 租户在 AgentCore `mocks/seed.ts seedRegistry().skills` 里有 **7 条出厂 Skill，
其中 5 条 PUBLISHED**（`sop_meeting` / `quality_control` 是 DRAFT），`main.ts` 启动即幂等播种。
但它们此前**只对注册 agent 路径可达**（skill 绑在 `agent.skills` 上）；
用户在对话坞随便问一句走的是泛化 path-B（裸 `AGENT_SYSTEM_CORE`），一个技能都看不见
（本体 §8 `G-SKILL-UNREACHABLE-FREE-QA`）。

> ⚠ **我在这里差点报错一个数**：按 `seed.ts` 里的条目数我先写成"7 条 PUBLISHED"，
> 真打 `GET /b/v1/skills` 才发现是 **5**（`total skills: 7 / PUBLISHED: 5`）。
> 数条目 ≠ 数状态 —— 顺带实测坐实了 `selectTenantSkills` 的 DRAFT 过滤在**生产链路**上真生效。

**关态原文**（真起双服务 + 本地 mock provider·真发问句）：

```
tools offered: [... 27 个 ...,"create_action_draft","discover_growth_tickets","final_answer"]
system prompt bytes: 1905   skillSectionMarkers=false   skillIdsInSystem=[]
```

**开态原文**（同一问句、同一进程构建）：

```
tools offered: [... 27 个 ...,"final_answer","load_skill"]
system prompt bytes: 2431   skillSectionMarkers=true
skillIdsInSystem=["skl_seed_capacity_action","skl_seed_capacity","skl_seed_mcp_guide",
                  "skl_seed_risk_analysis","skl_seed_supply_chain"]
assistant tool_calls seen in history: ["load_skill"]
tool result (call_ls_1) len=566 head="<tool_data>{\"body\":\"## 目的\n把产能推演结论转成**可审批的行动草案**…"
```

system prompt 里真出现的技能段：

```
可用技能（调用 load_skill(skillId) 获取全文）：
- [skl_seed_capacity_action] 产能处置行动拟稿: 当产能推演已给出结论、需要把结论落成可审批的行动项时使用…
- [skl_seed_capacity] 产能分析方法论: 当用户问某型号产能口径、P50/P90 含义或缺口解释时使用…
- [skl_seed_mcp_guide] MCP 集成指南: …
- [skl_seed_risk_analysis] 风险分析方法论: …
- [skl_seed_supply_chain] 供应链管理技能: …
```

注入的 5 个 id **恰好等于**该租户的 5 条 PUBLISHED（`skl_seed_capacity` / `risk_analysis` /
`supply_chain` / `mcp_guide` / `capacity_action`），两条 DRAFT 一条都没进 —— 池子的口径是对的。
全文不常驻 system（渐进披露），模型需要时 `load_skill` 取；上面第二轮报文里全文真的进来了，
**这才是"技能被用上"的效果层证据，而不是"工具挂上了"**。

### 2.2 `qos.multi-intent-l2-decompose` —— 顺带澄清一个**看起来像缺陷其实不是**的依赖

**先回答工单的疑问**：`qos.multi-intent-l3-coupled` 已亮而 `qos.multi-intent-l2-decompose` 未亮，
**不是缺陷，也不存在依赖关系**。追了两层调用链核实：

1. `features.ts` 里两个键**都没有 `requires` 字段**（L1 层无声明依赖）；
2. 运行期也不是层叠：
   - **L2** 在 `orchestrator.ts:731`（`submitQuery` 主流程·free-LLM 门之前）——它是**进入多路并行的三个触发器之一**；
   - **L3** 在 `orchestrator.ts:946`，位于 `runMultiRoute` **内部**——它是"进去之后的升格"。
3. 三个触发器分别是：② `qos.deterministic-multi-domain`（:668）、L2（:731）、⑤ `qos.multi-intent-orchestration`（:802）。
   demo 早已点亮 ②，L3 靠 ② 供给耦合路由即可生效 —— `seed.ts` 原注释「两门缺一不可：det-multi × l3-coupled」写的正是这件事。

⇒ 本轮点 L2 是**新增第三个触发器**，不是补 L3 的前置。

**为什么点**：`shouldUseFreeLLM` 里有一条**纯长度门**（`q.length >= 24`），中文把话说清楚天然更长
→「说得越具体越被判为开放深问 → 越绕开确定性求解器」，因果是反的。L2 在 free-LLM 之前插一道，
先试 LLM 产 solver 计划 + 确定性校验；一条都映射不到才落 free-LLM（不劫持真开放题）。

**关态**（问句：「我这边现在有点乱…一方面下周有些活儿因为料没到位怕是开不了工，另一方面长协那边的覆盖也让我心里没底，你怎么看？」）：

```
status=COMPLETED  path=AGENT  classification.model=agent:role:supply-chain
answer: MOCKLLM 最终回答（用于验证链路，不含真实业务结论）。
```

**开态**（同一问句）：

```
status=COMPLETED  path=WORKFLOW  classification.model=llm-l2-decompose
answer: 【确定性多域分路·零 LLM 块装配】以下 3 个子域各自**独立**测算（并行 solver·每节独立溯源）：
        ## 物料齐套（kit_readiness） 本域确定性测算完成，结论与数值见 ⟦ref:0⟧。
        ## 长协覆盖（lta_gap）       本域确定性测算完成，结论与数值见 ⟦ref:1⟧。
        ## 瓶颈定位（bottleneck_matrix） 本域确定性测算完成，结论与数值见 ⟦ref:2⟧。
```

一条自由文本 → 三路确定性求解 + 逐节溯源。**路径、模型标记、答案结构三者全变**。

### 2.3 `qos.multi-intent-orchestration` —— 治「问了两件事只答一件」

**关态**（问句：「推荐哪个经营方案？另外下周哪些订单缺料开不了工？」）：

```
status=COMPLETED  path=WORKFLOW  classification.model=dcp:<provider>:mock-model  multiIntentPlan=no
answer: 经营方案比选（求解器 plan_generate）推演结果：…
```

**只答了第一问**，「缺料」那半句被 τ 决策丢弃 —— 而且答得理直气壮（COMPLETED、无澄清）。

**开态**：

```
status=COMPLETED  path=WORKFLOW  classification.model=llm-multi-intent  multiIntentPlan=yes
answer: 【确定性多域分路·零 LLM 块装配】以下 2 个子域各自**独立**测算（并行 solver·每节独立溯源）：
        ## plan_recommend（plan_generate） 本域确定性测算完成，结论与数值见 ⟦ref:0⟧。
        ## kit_analysis（kit_readiness）    本域确定性测算完成，结论与数值见 ⟦ref:1⟧。
```

### 2.4 `qos.opt-whatif-route` —— 路由真通，**数据没跟上**（诚实标注）

**为什么点**：`optimize_whatif` 求解器与前端「优化推演」页早就有，但**自然语言问不到它**
（本体 §8 `G-WHATIF-NL-UNREACHABLE`：能力存在 ≠ 能力可达）。demo 的依赖链底座已经开着——
实测 `GET /a/v1/me/workspace` 返回含 `opt.solver-pool` / `opt.whatif`（二者不在两个暗发排除集里，
随 battery 模板 all-on）——只差这一把路由钥匙。

**关态**（问句：「如果 f1 的开设成本涨到 150，最优选址方案怎么变？」+ 选中 f1/f2/f3）：

```
status=COMPLETED  path=AGENT  classification.model=dcp:<provider>:mock-model
（全程不触碰 optimize_whatif）
```

**开态**：路由**真命中并真调了求解器**——SSE 事件原文：

```
event: step.completed
data: {"type":"opt_whatif_invoke",
       "outcome":"invoke_solver optimize_whatif（facility_location·selection 3·扰动 facilities.f1.openCost=150）"}
event: routing.degraded
data: {"reason":"装配报缺（缺角色支撑：open_cost（Base 无命中成本词库的数值字段））","fallback":"path-B"}
```

**残口定位（本单范围外·如实登记）**：demo 的 `Base` 对象类型**没有任何成本类数值属性**——
实测 `GET /a/v1/ontology/object-types` 的 Base 数值属性只有
`util / gwh / formationCapDaily / agingCapDaily / lon / lat`。
`assembleBaselineFromSelection`（`apps/datacore/src/solvers/service.ts:3730`）找不到命中成本词库的字段
→ 返回 `applicable:false` → 编排器**诚实降级**（KILL-MOCK：不伪造系数）。

⇒ **这一条属"接了线没数据"，不是"没接线"**：两态行为确有差别（真 invoke + 真降级事件 vs 完全不触碰），
但**用户拿不到 what-if 结论**。要真正可用，需给 demo 的 `Base`（或另一个决策承载类型）补一个成本属性
——落点在 `apps/datacore/src/synthetic/battery.ts`，**在本单 🚦 范围边界之外，未动**。

### 2.5 `dc.lazy-solver-context` —— 先跑通 SEAM-EQ 才点

工单要求：找到并真跑 SEAM-EQ，跑不通不许点。

**找到了**：`apps/datacore/test/solver-context-lazy-loading.seam.test.ts`。**真跑通了**（RC=0·6/6）：

```
✓ 声明表非空且仅含核心 10 类（宁缺毋滥·登记）                                        6ms
✓ SEAM-EQ：每个声明求解器·compute(裁剪ctx) ≡ compute(全量ctx) 逐字节一致（漏声明立刻红）  8121ms
✓ SEAM-EQ 生产路径：invoke(flag off) ≡ invoke(flag on) 逐字节一致（每个声明求解器）      7554ms
✓ SEAM-PERF：声明求解器 loadContext 加载核心对象类型 <10（含 ≤80ms 冷启）              6032ms
✓ SEAM-COMPAT：未声明求解器 + 无 solverKey 调用方 → 全量 10 类（向后兼容）             6841ms
✓ SEAM-FLAG-OFF：flag 关时 invoke 输出 ≡ 全量 compute（零回归）                       6866ms
Test Files  1 passed (1)      Tests  6 passed (6)
```

**⚠ 这一条的"两态必须不同"要看对地方**：它是**纯性能收窄**，
「答案逐字节一致」是**契约本身**，不是"线没接上"的信号。真起服务同进程 A/B（同数据、只翻这一个开关）：

```
capacity_rollup   : IDENTICAL (497885 bytes)
bottleneck_matrix : IDENTICAL (6331 bytes)
plan_generate     : IDENTICAL (9973 bytes)
```

差别在**加载了多少**，由 SEAM-PERF 直接 spy `objects.listByType` 断言：全量 10 个核心类型 →
`capacity_rollup` 裁剪后恰为声明集 4 个（`expect(loaded).toEqual([...SOLVER_REQUIRED_TYPES.capacity_rollup].sort())`）。

**诚实边界**：我在真服务上做的延迟 A/B **不足以作为证据**——机器同时被其他任务占用，
两轮测得 44.5/58.0 ms 与 37.7/36.0 ms，噪声大于信号。收窄的证据以 SEAM-PERF 的**直接 spy 断言**为准。

### 2.6 `qos.llm-budget-enforce` —— 刻意不点

行为是**硬线**：租户 token 配额耗尽 → 新 QOS 任务直接 429 `LLM_BUDGET_EXCEEDED`。
demo 是给人随便点、随便问的环境，点亮 = 用户用着用着突然被拒，而"配额用完了"这个理由
在演示语境里既没人管也没人能改 —— 这不是"体验到一个功能"，是"撞上一堵墙"。

**关掉它不会让账本变空**：记账侧**无条件在记**（不受此门控），门只控"拿账本拦人"这一个动作。
要在 demo 演示配额，正确做法是运维显式 PUT 一次 override（合并语义会尊重它）。

理由已写进 `seed.ts` 的 `DEMO_LIGHTUP` 旁注，并加了金值断言
（`demo-lightup-seam.test.ts` 的 `DELIBERATELY_NOT_LIT`）——作用不是"锁死永不点亮"，
而是**逼下一个人先读一遍理由**再改。

---

## 3 · 不变量与机制（一个字都没动的部分）

**`DEMO_LIGHTUP` 的「只补缺失的键、不覆盖已存在的键」语义原样保留**：
`if (k in merged) continue;` 未动。运维显式 `false` 的键，种子不许翻回 `true`；
缺席的键（= "那会儿还没这个功能"）才补。变异反证 ② 已坐实这道守卫真会咬人。

实测口径变化（真起 datacore·`SEED_DEMO=1`·登录 demo/admin）：

```
关态 GET /a/v1/me/workspace → total features=94   configVersion=1
开态 GET /a/v1/me/workspace → total features=99   configVersion=1
差集恰为本轮 5 条；qos.llm-budget-enforce 两态皆 off
```

---

## 4 · 金值同步

| 文件 | 改动 |
|---|---|
| `apps/datacore/test/demo-lightup-seam.test.ts` | `LIT` 7 → 14；新增 `DELIBERATELY_NOT_LIT` 断言 |
| `apps/agentcore/test/scenario-phrasing-seam.test.ts` | 生产镜像 `DEMO_PROD_FEATURES` 9 → 13（QOS 侧） |
| `apps/agentcore/test/deliver-verb-seam.test.ts` | 同上 |
| `apps/agentcore/test/route1-structural-qualifier-seam.test.ts` | 同上 |
| `apps/agentcore/test/demo-lightup-2-prod-set.seam.test.ts` | **新增**：拿生产集跑真编排器（点亮≠能用的那一半） |

> 三份生产镜像不是装饰：镜像一改，那三道门就**换了考卷**——新点亮的路由门若会抢答，
> 必须在这里当场露出来，而不是等部署态。实测：改完后三门仍全绿（新门没有抢走既有意图）。

**未动**：`slot-harvest-floor` / `slot-entity-resolve` / `base-slot-unify` 三处的 4 键局部集合——
它们不自称"生产真实功能集"，只是各自门需要的最小开关组合，改了反而是噪声。

---

## 4.5 · 门跑了什么（含一条**不是我造成**的红，附证明）

| 门 | 结果 |
|---|---|
| `pnpm -r build` | **RC=0**（共 3 次，含变异撤回后重建） |
| `pnpm --filter agentcore test` | **RC=0** · 150 files / **870 tests** 全绿（含本单新增门 4/4 与三份改过的生产镜像） |
| `pnpm --filter datacore test` | **RC=1** · **1365 passed / 1 failed / 16 skipped**（唯一那条红见下） |
| `test/solver-context-lazy-loading.seam.test.ts` | RC=0 · 6/6（`dc.lazy-solver-context` 的点亮前置） |
| `test/demo-lightup-seam.test.ts`（干净树） | RC=0 · 7/7 |
| `test/dark-feature-default-off.test.ts` + `features.test.ts` | RC=0 · 10/10 |
| `prd:check` / `prd:coverage` | RC=0 |

**唯一那条红：`empty-tenant-bootstrap.test.ts`——是负载超时，不是断言失败，且与本单无关。三条独立证据：**

1. **失败原文是超时不是断言**：`Test timed out in 180000ms`，该用例实测耗时 **247345ms**。
2. **结构上碰不到**：该测试用 `makeApp()`（**只调 `seedDemo`，从不调 `seedDemoEntitlements`**），
   且全文对 `DEMO_LIGHTUP` / 本轮五个键 / `seedDemoEntitlements` 的引用数 = **0**。
   本单在 datacore 的生产改动只有 `DEMO_LIGHTUP` 这一个常量，其唯一生产消费方就是 `seedDemoEntitlements`。
3. **给足时间就绿**（真跑复验）：`vitest run test/empty-tenant-bootstrap.test.ts --testTimeout=900000`
   → **RC=0 · 2/2 通过**（两用例各 85.8s / 94.2s）。

> 超时的真因是机器争抢：跑这一轮时**另有两个 agent 的 datacore 套件同时在跑**（`wt-int` 与
> `agent-a28b...`），4 核 load 12–17。它跑的是 **scale "M"** 合成建域，本就是全库最重的用例之一。
> **我没有把这条红改弱、也没有调高套件里的 timeout 去让它变绿** —— 只在**复验时**单独放宽时限取证。

## 5 · 本体引用与影响

**对象类型**：无新增/变更。

**链路**：无新增。本轮只把三条**已存在**链路对 demo 租户打开：
- `skills(PUBLISHED) → selectTenantSkills → buildSkillSection → path-B system prompt → load_skill → engine.resolveSkill`（§8 `G-SKILL-UNREACHABLE-FREE-QA` 的接线）
- `Query → buildL2Prompt → parseSolverPlan → validateSolverPlan → runParallelRoutes`（§3 ★L2 真分解）
- `Query → classify → selectMultiIntent → runParallelRoutes`（§3 ★⑤ LLM 多意图兜底）
- `Query → resolveOptWhatifRoute → invoke_solver(optimize_whatif) → assembleOptWhatifAnswer`（§8 `G-WHATIF-NL-UNREACHABLE`）

**事件**：无新增事件名。实测触发到既有事件 `routing.completed` / `routing.degraded` / `step.completed(opt_whatif_invoke)` / `answer.final`。

**不变量**：
- **R3（entitlement 先于 authz）**：只改 demo 租户的 L3 override，暗发键的 `defaultOn:false` 与
  `QOS_DARK_LAUNCH_FEATURES` / `PERF_DARK_LAUNCH_FEATURES` 排除集**一字未动** ⇒ 新 battery 租户仍默认全关
  （`demo-lightup-seam.test.ts` 的「对照 SEAM」守）。
- **R6（确定性）**：`updatedAt` 仍是固定串 `2026-01-01T00:00:00.000Z`，不引时钟；幂等断言未动。
- **R2（tenant_id everywhere）**：只写 `fcfg_demo`。

**门禁（G-）**：
- `G-SKILL-UNREACHABLE-FREE-QA`：接线早已闭；本轮把它**在 demo 上真正打开**并实测走通。
- `G-WHATIF-NL-UNREACHABLE`：路由已闭；本轮实测发现**下游装配层还有一处数据缺口**
  （demo `Base` 无成本属性 → `applicable:false`），已在 §2.4 定位到 `service.ts:3730`。

**需回写本体的地方**：`docs/SYSTEM-ONTOLOGY.md`（由审核方回写，本单不碰）建议补两点：
1. §8 `G-WHATIF-NL-UNREACHABLE` 条目补一句诚实边界：会话入口已闭，但 **demo 租户数据侧
   `Base` 缺成本属性 ⇒ 该链路在 demo 上恒 `applicable:false` 诚实降级**；
2. demo 点亮清单从 9 条更新为 14 条，并记下 `qos.llm-budget-enforce` 是**刻意不点**（附理由）。
