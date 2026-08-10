# PRD v2 · Agent（对齐实测的统一规格）

> **这份文件取代/合并的前作**：`PRD-agent-react-harness.md`(375) · `PRD-agent-execution-governance-loop-control.md`(218) ·
> `PRD-agent-navigation-slice-latency.md`(107) · `PRD-agent-data-generation-tools.md`(91) ·
> `PRD-addendum-agent-runtime.md`(85) · `PRD-llm-agent-empty-response-guard.md`(81) · `WO-QOS-2-AGENT-SPEEDUP.md`(66)
> ＋ 总纲 `PRD-platform-foundry-aip.md §8.1/§8.5` ＋ QOS 规格 `PRD-query-orchestration-service.md §5.4/§6.3/§8.2`。
> 前作不删（历史依据），但**冲突时以本文为准**。
>
> **写作纪律**：铁律 0（先读 `docs/SYSTEM-ONTOLOGY.md`，见 §6《本体引用与影响》）· 铁律 0.5（grep 是线索不是结论，
> 每条否定结论都追到调用点条件）· 铁律 0.6（每条扫描类结论先跑金丝雀）。
> **本文所有"现状"结论均来自 2026-08-10 在本机活系统上的亲手真跑**（内存模式双服务，见 §2.1 复现命令），
> 不是读代码推断。凡只读了代码没跑到的，一律进 §7 诚实边界，不猜一个状态填进去。
>
> 版本 v2.0 · 日期 2026-08-10 · 基线 canonical `claude/inspiring-gates-aqczjg` @ `282b8239`

---

## §1 一页纸：Agent 今天为推演贡献什么

### 1.1 一句话结论（不粉饰）

**今天 Agent 不在推演链的主干上。** 在**功能全点亮**的 demo 租户上真跑四类代表性推演问句，
**0 条**真进了 ReAct agent 循环——三条被确定性求解器层接走（这是设计意图，是好事），
第四条进了"组合路径"但**只做确定性汇总、没有 agent 参与**。
Agent 站的是三级路由的**第③级兜底格**，而这一格今天**要么是空的**（无 LLM provider → 诚实降级一句话），
**要么是崩的**（本体图谱视图的 AGENT_FIRST 场景 → 原始 SDK 错误串泄漏到用户面）。

用仓主的话对齐：**"这些不是我之前期望的"**——之前交付的是**治理面**（运行观测台、门审计、降级出口、预算闸）。
那些都真做了、也真有用，但它们回答的是**"Agent 不会失控"**；
仓主问的是**"Agent 能多推演出什么"**——这个问题今天的答案是：**几乎没有额外推演**。

### 1.2 为什么会变成这样（机制，不是态度问题）

推演能力这半年被系统性地**往确定性层搬**，而且搬对了：

| 层 | 今天覆盖 | 实测时延 | 谁在算 |
|---|---|---|---|
| ① path-A 确定性求解器（`domainResolve`→`ceo-route`→`invoke_solver`） | 定式深问（为什么/差多少/能不能交/怎么补） | **~1.0s** | solver（R6） |
| ② 确定性多域并行 + L3 耦合联合求解（`runMultiRoute`/`l3-coupled`） | 跨域会诊型（良率↓+长协+延误+外协） | **~1.0s** | portfolio solver（R6） |
| ③ 组合路径（`compileSolverPlan`→`executePlan`） | 需 2+ solver 拼的题 | **~1.0s** | 多 solver 服务端编排（R6）＋一次 LLM 综合 |
| ④ **path-B ReAct agent** | 以上都接不住的**真开放题** | **（今天跑不起来）** | LLM + 工具循环 |

前三层是**确定性的、秒级的、可溯源的**——它们把绝大多数"看起来需要智能"的题都吃掉了。
这是正确的架构选择（`G-AGENT-BLIND-REACT` 的修法就是把题从慢 agent 拉回确定性层）。
**副作用是：Agent 被挤到了一个又窄又深的位置上——只剩"三层都答不了"的题，而恰恰是这些题最需要 LLM，
今天却因为没有可用 provider 而完全空转。**

所以"Agent 没有推演贡献"**不是** agent 代码没写。恰恰相反：
七要素提示词、导航切片、反思闭环、循环治理、合规产数据工具、技能挂载——**代码基本都在，而且大多在生产路径上**。
断的是**两个接缝**：

- **接缝 A（能力接缝）**：Agent 手里的"能力地图"是**一份写死在 agentcore 里的 19 条静态求解器目录**
  （`apps/agentcore/src/agent/navigation-slice.ts:76 (SOLVER_CATALOG)`），
  而平台活着的资源目录里有 **59 个求解器 / 94 个对象类型 / 813 个字段**（§2.4 实测）。
  **租户自己建出来的东西，Agent 一个都看不见。** 它不是"不聪明"，是"看不见"。
- **接缝 B（燃料接缝）**：第③级全模式**本质要 LLM**（前作 `PRD-agent-react-harness.md §1.5` 自己写了这句），
  而没有 provider 时，泛化 path-B 诚实降级（对），注册 agent 路径**直接 FAILED 且泄漏原始 SDK 错误**（错，§2.3-⑦）。

### 1.3 Agent 应该贡献什么（本 PRD 的立论）

不要把 Agent 定位成"更聪明的路由"——**路由今天已经足够确定，再让 LLM 去选型是往回走**。
Agent 唯一无可替代的三件事，都是确定性层**结构上**做不到的：

1. **拼**：没有单一对口 solver 时，把问题拆成"哪几个 solver、按什么顺序、上一个的输出怎么喂下一个"。
   确定性层今天只能拼**已登记 args schema 且静态可填**的 solver（`compileSolverPlan`），拼不出来就整体放弃。
2. **补证据**：证据不足时**自己去造证据**再推演——`fill_data` / `run_synthetic` / `build_domain`
   三把合规工具已经注册好了（`apps/agentcore/src/tools/registry.ts:295/311/328`），
   但**从来没有一次真实运行用过它们**（§7-U3）。这是今天离"多推演一步"最近的一块。
3. **把数字变成决断**：solver 给的是 `totalGap=27.8%`；用户要的是"先动哪一步、动多少、谁批"。
   五段决策结构（结论/分析/证据/建议/风险）＋ `create_action_draft` 已在提示词里
   （`apps/agentcore/src/agent/prompts.ts:28`），但没有 LLM 就渲染不出来。

**判据（本 PRD 全篇的验收基准）**：一条能力算不算"推演贡献"，看它做完之后
**用户在屏上看到的答案内容是不是变了**——不是"日志里多了一行"、不是"多了一个 KPI"、不是"测试多绿了一条"。

---

## §2 实测现状（亲手真跑 · 非读码推断）

### 2.1 复现命令（任何人可原样重跑）

```bash
# 1) 构建（本单只构 3 个必需包，不跑 pnpm -r build）
pnpm --filter @platform/contracts build
pnpm --filter @platform/llm-adapters build
pnpm --filter datacore build && pnpm --filter agentcore build

# 2) 内存模式双服务（端口避开 4001/4002 以免与在跑的门冲突）
PORT=4401 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-a508 SEED_DEMO=1 \
  CREDENTIAL_KEY=0123...ef node apps/datacore/dist/server.js &
PORT=4402 DATACORE_BASE_URL=http://127.0.0.1:4401 node apps/agentcore/dist/main.js &

# 3) 登录 demo/admin/demo1234 → POST /b/v1/queries → 轮询 GET /b/v1/queries/:id
```

**环境定性（必须先说清，否则下面每个数字都会被误读）**：
- 本次跑的是**内存模式 + SEED_DEMO=1**，与 `docker-compose.yml` 的部署态**同一份种子路径**。
- **没有任何 LLM provider 绑定**（无 key）。这不是"测试环境残缺"——它恰好是**部署方开箱那一刻的真实状态**，
  也是仓主实测"推演中断"的那个状态。凡结论依赖"有 provider"的，一律进 §7。

### 2.2 先纠正一个会导致结论完全相反的读法（铁律 0.5 · 判据 #6）

读 `apps/agentcore/src/features/registry.ts` 会看到 **14 条 Agent 相关能力全是 `defaultOn: false`**，
再读 `apps/datacore/src/features.ts:160 (QOS_DARK_LAUNCH_FEATURES)` 会看到它们**连"行业模板全开"都被诚实排除**。
**照这两处下结论 = "生产上这些能力全是关的"——恰好相反。**

真跑 `GET /a/v1/tenants/demo/features`（configVersion=1，89 键）实测：

```
ON  agent.critic          ON  agent.coordinator     ON  agent.escalation
ON  ceo.free-llm          ON  qos.compose-path      ON  qos.dril-routing
ON  qos.reasoning-trace   ON  agent.skill-on-free-qa ON  qos.agent-fallback
ON  qos.multi-intent-l2-decompose  ON  qos.multi-intent-orchestration
ON  qos.deterministic-multi-domain ON  qos.multi-intent-l3-coupled
ON  qos.opt-whatif-route
off qos.llm-budget-enforce      ← 唯一刻意不点（理由见 datacore/src/seed.ts:64 注释）
```

来源是 `apps/datacore/src/seed.ts:64 (DEMO_LIGHTUP)`——**只在生产 `SEED_DEMO=1` 路径调用，不进单测基座**。
所以：**单测里这些门全关（字节兼容基线），部署态全开。** 本 PRD 下面所有"现状"都是在**全开**态下测的。

> 这条本身就是一次 §0.6 意义上的自证：我差一点用 `defaultOn:false` 当作"生产是关的"的证据，
> 而 `defaultOn` 并不度量"租户 resolved 结果"。**金丝雀**：同一次响应里 `qos.agent-fallback`（唯一 `defaultOn:true` 的）
> 也返回 ON，且 `qos.llm-budget-enforce` 返回 off —— 说明这个端点确实在区分开关，不是无脑全返 true。

### 2.3 四类代表性问句真跑结果（这就是"Agent 站在哪"的答案）

| # | 问句 | 期望（前作 PRD） | **实测** `path` / `classification.model` | 时延 | 进 ReAct agent 了吗 |
|---|---|---|---|---|---|
| ① | 储能份额逐层拆根因（带 `focus.metric+factorId`） | path-A（金标 Q5） | `WORKFLOW` / `deterministic:ceo-route` | **1017ms** | ❌ 否 |
| ② | 综合信用、毛利、供需三维评估能不能继续接单 | path-B 编排（金标 Q11） | `AGENT` / `agent:ceo-free-llm`，实际走**组合路径确定性汇总** | **1018ms** | ❌ 否（`runAgentLoop` 未调） |
| ③ | 如果明年储能需求翻倍而锂价再涨 30%，怎么排产能与长协 | path-B **真开放**（金标 ③类） | `WORKFLOW` / `deterministic:ceo-route-fallback` → `decision_play` | **2017ms** | ❌ 否 |
| ④ | 常州涂布良率下滑…长协不足…订单延误…要不要外协或加班 | Coordinator 三角会诊 | `WORKFLOW` / `deterministic:multi-domain` → **L3 耦合 portfolio 守恒解** | **1020ms** | ❌ 否 |
| ⑤ | 我们下一步该不该进军储能海外市场（无 PageContext·真域外） | path-B agent | `AGENT` / `undefined` → **诚实降级一句话** | 1018ms | ❌ 否（无 provider） |
| ⑥ | 帮我把上周会议纪要整理成待办（域外·带 PageContext） | path-B agent | `AGENT` / `undefined` → 同上诚实降级 | 1010ms | ❌ 否 |
| ⑦ | 「这张图里哪些对象和产能瓶颈相关」（view=`graph`，AGENT_FIRST 场景） | 注册 agent 真跑 | **`FAILED`** · `AGENT_ERROR` | 1009ms | ❌ 否（**崩了**） |

**②的证据细节**（这是最容易被误读成"agent 跑了"的一条）：`path=AGENT`、`model=agent:ceo-free-llm`，
但答案首块原文是
`【组合路径·确定性汇总（未接入 LLM 提供商 → 未作综合叙述…）】…步骤 0 · credit_exposure（outcome=OK·⟦ref:0⟧）：limit=151294, exposure=48331, available=102963, newOrderVerdict=冻结…`
——这是 `executePlanPath` 的产物，`runPathB` 在 `orchestrator.ts:1932` 判 `composeCompiled.ok` 即 `return`，
**全程不落 `runAgentLoop`**（`orchestrator.ts:1934` 注释原文：「走组合路径·全程不落 runAgentLoop」）。
`path=AGENT` 只是**任务状态机的标签**，不代表 agent 真跑了。

**⑦的证据细节**（新发现·需登记新断点）：
```json
"status":"FAILED",
"error":{"code":"AGENT_ERROR",
 "message":"Could not resolve authentication method. Expected one of apiKey, authToken,
            credentials, config, or profile to be set. Or for one of the \"X-Api-Key\" or
            \"Authorization\" headers to be explicitly omitted"}
```
**这是 Anthropic SDK 的原始错误串直接泄漏到用户面。**
根因追到调用点条件（铁律 0.5 判据 #4）：诚实降级的唯一入口 `completeNoLlmDegradation`
（`apps/agentcore/src/router/orchestrator.ts:2657`）**全仓只有 1 个调用方**——
`orchestrator.ts:779`，且只挂在**分类器失败**这一个分支上。
而 `runSceneAgent`（`orchestrator.ts:2593`，AGENT_FIRST/AGENT_ONLY 场景入口）
**根本没调 `providerAvailable`**，直接 `runRegisteredAgent` → SDK 抛 → `failFromError`。
金丝雀：同文件 `providerAvailable` 共 4 处命中（:778/:1989/:2196 + 定义）⇒ grep 工具是活的，
是 `runSceneAgent` 真的没接。
**受影响面**：`apps/agentcore/src/mocks/seed.ts:846 (scn_graph)` 把 `viewKey=graph`（本体图谱视图）配成
`AGENT_FIRST` + `agt_seed_analyst` —— **这是全平台唯一一条不受暗发门约束、直达注册 agent 的生产路径**，
而它开箱即崩。

### 2.4 Agent 的"能力地图"与平台真实资源的差距（接缝 A 的量化）

| 池 | Agent 导航图看得见（静态镜像） | 平台活着的资源目录（真跑 `GET /b/v1/resources`） | 覆盖率 |
|---|---|---|---|
| 求解器 | **19**（`navigation-slice.ts:76 SOLVER_CATALOG`，逐条 grep 计数） | **59** | **32%** |
| 对象类型 | 只有那 19 个 solver 的 `reads[]` 并集 | **94** | — |
| 字段 | 不进导航图（口径层才有，且只覆盖导航图选出的类型） | **813** | — |
| 切片 | 不进导航图 | 2 | 0% |
| 技能 | 走另一条路（§2.5） | 7（5 PUBLISHED） | — |
| 工作流 | 不进导航图 | 6 | 0% |

`navigation-slice.ts:23` 自己写明了这一层的性质：「输出形状**镜像** DataCore `SOLVER_OUTPUT_SHAPES`（权威在 A 侧）」——
**它是一份手工维护的只读镜像，不是从租户真实本体投影出来的**。
问句→能力的映射也是 14 条写死正则（`navigation-slice.ts:51 FAMILY_SIGNALS`）。
后果：**任何租户自建的对象类型 / 求解器 / 切片 / 工作流，Agent 结构上看不见**——
不是"检索排序靠后"，是**根本不在候选集里**。

第二层（口径语义 `apps/agentcore/src/agent/ontology-context.ts`）**确实读 A 的单一真值**（`getTypeSemantics`），
这一半是接对的；但它只对**第一层已经选中的类型**取口径 —— 第一层漏掉的，第二层也补不回来。

**这直接回答工单问题 5「Agent 推演时用的是哪份本体视图」：
选型层用的是 agentcore 内的出厂静态目录（19/59），口径层用的是 A 的真值但受选型层裁剪。
两层都不是"租户本体的动态切片"。**

#### 2.4.1 关键补充：能查全 59 条的检索**已经有了，而且好用** —— 只是第一轮地图没用它

这一条把 C2 的工作量从"造一个检索系统"改写成"把注入源换成已有的那个"，**必须写清楚**。

真跑 `POST /b/v1/resources/search`（= `retrieve_knowledge` 工具背后的同一个 `ResourceRegistryService`，
注入条件 `apps/agentcore/src/engine.ts:220-227`：`deps.features` 存在即建，**生产必然满足**）：

| 问句 | Top-1 | 命中里**不在静态 19 条目录**中的求解器 |
|---|---|---|
| 储能份额为什么没达成目标 | `solver/gap_attribution` **0.384**（与 20 题金标期望的对口 solver 一致） | `plan_rootcause` · `order_fullchain` · `chain_loss_attribution` |
| 常州涂布良率↓…长协不足…订单延误 | `object_type/IncomingInspection` 0.289 | `cross_object_occupancy` · `chain_loss_attribution` · `audit_timeline` |
| 如果需求翻倍而锂价涨 30%，怎么排产能与长协 | `skill/capacity_analysis` 0.343 | `shared_bottleneck` · `portfolio` · `chain_impediments` · `base_capacity_outlook` |

**三条问句共surface 出 9 个静态目录里没有的求解器**（`plan_rootcause`/`order_fullchain`/`chain_loss_attribution`/
`cross_object_occupancy`/`audit_timeline`/`shared_bottleneck`/`portfolio`/`chain_impediments`/`base_capacity_outlook`），
而且第一条的 Top-1 就是金标期望的那个——**检索质量不是瓶颈，可见性才是。**

矛盾点在这里：agent 理论上可以自己调 `retrieve_knowledge` 去够到这 40 条，
但 `AGENT_SYSTEM_CORE`【工作方式】段（`apps/agentcore/src/agent/prompts.ts:16`）写的是
「**选型已替你做完，不必再用 discover 盲扫或逐跳试探**」——
**提示词在劝它别去查那个能查到全部答案的地方。**
这不是提示词写错了（在 19 条覆盖得住的题上它是对的），是**两层的覆盖面不一致**：
提示词按"地图是全的"写，地图实际只有 32%。

### 2.5 Agent ↔ Skill 的接线（复核账上 #156，并纠正它）

账上 #156 记的是「`skl_seed_capacity_action` 未挂任何 agent」。**复核结论：一半对，一半必须纠正。**

- ✅ **对的一半**：`grep "skills: \[" apps/agentcore/src/mocks/seed.ts` 全部 12 处逐条看过——
  出厂 agent 只挂 `skl_seed_capacity`(×4) / `skl_seed_supply_chain` / `skl_seed_mcp_guide`，
  **`skl_seed_capacity_action` 确实 0 个 agent 挂载**（`seed.ts:1294` 定义，`seed.ts` 内零 `skillId` 引用）。
  金丝雀：同一次 grep 命中了 `skl_seed_capacity` 的 4 处挂载 ⇒ 工具是好的。
- ❌ **必须纠正的一半（追一层调用后反转）**：「未挂 agent」**不等于**「不可达」。
  实测 `GET /b/v1/skills` 返回 7 条，`skl_seed_capacity_action` 是 **PUBLISHED**；
  而 `agent.skill-on-free-qa` 在 demo 上是 **ON**（§2.2），于是泛化 path-B 走
  `selectTenantSkills`（`orchestrator.ts:257`，只筛 PUBLISHED）→ **它会进技能池、会被注入 system prompt、可被 `load_skill` 取全文**
  （`orchestrator.ts:2053-2072`）。
  **定性因此从「没接线」改判为「接了线、但要 path-B 真跑起来才触发，而 path-B 今天跑不起来」。修法完全不同。**

**同时发现一处此前没记过的半接线（新断点候选 `G-SKILL-GOVERNANCE-DROPPED-ON-FREE-QA`）**：
free-QA 这条路只透传了 `loadSkillEnabled`/`loadSkill` 两个字段，
**没有透传 `writeMode` / `provenancePolicy`**（`orchestrator.ts:2053-2072` 逐行读过）。
金丝雀反证：同样两个字段在注册 agent 路径上**是传的**（`apps/agentcore/src/engine.ts:458-459`），
且 `grep -n "writeMode\|provenancePolicy" apps/agentcore/src/router/orchestrator.ts` = **0 命中**，
而同一条 grep 在 `engine.ts` 上 4 命中 ⇒ 工具是活的，是 orchestrator 真的没接。
**后果**：`skl_seed_capacity_action` 声明的 `sideEffect: WRITE` + `approvalGate: "human"`
（本体 §2.H 称它是「出厂态唯一活体样本」）在 free-QA 路径上**整段失效**——
技能正文能读到，"必须出 `action_draft` 才准收尾"的治理契约读不到。
**这是 R4（真值只经 Action 审批）在这条路径上的一个真实豁口。**

### 2.6 逐条四态对账（PRD 可验收条款 × 实现）

判据：**已实现在链**（有非 test 生产调用方且条件可达）／**只有实现没接线**（调用方只有 test）／
**接了线没数据 · 接错地方 · 只接一半**／**没做**（附金丝雀）。

#### A. `PRD-agent-react-harness.md`（375 行）

| 条款 | 判据 | 状态 | 证据 |
|---|---|---|---|
| G2 · 七要素提示词补 ③推理循环 / ⑥错误恢复 / ⑦结果规范 | 三段在 `AGENT_SYSTEM_CORE` | **✅ 已实现在链** | `apps/agentcore/src/agent/prompts.ts:22/24/28`；生产调用方 `orchestrator.ts:1998`（泛化 path-B）＋ `engine.ts:412`（全部注册 agent 继承） |
| G3 · Solver-first 硬纪律（prompt 段） | 【求解纪律】段在 core | **✅ 已实现在链** | `prompts.ts:26`，同上两个调用方 |
| G3 · Solver-first **执行期门**（R6·非靠自律） | reflect ④ 检查项 | **⚠️ 只接一半** | 实现在 `apps/agentcore/src/agent/reflect.ts:93`（`SOLVER_REQUIRED_RE` ∧ 未调 solver → 打回）；但只在 `opts.reflect` 开时跑，且**只接泛化 path-B**（下一行） |
| G1/G4 · Reflect 反思闭环挂进 loop | `if (opts.reflect)` | **⚠️ 接错地方（只接一半）** | 判定点 `apps/agentcore/src/agent/loop.ts:881`；**唯一生产注入点** `orchestrator.ts:2024 (reflect: true)`。`grep -n "reflect" apps/agentcore/src/engine.ts` = **0 命中**（金丝雀：同文件 `runAgentLoop` 2 命中）⇒ **角色 agent / Coordinator 扇出 / 场景 agent / skill 探针全部不过反思** |
| §7.2 复盘清单 5 项 | 逐项 | **⚠️ 4/5 实现，1 项没做** | 已做：答了吗 / 数字落地(⟦ref⟧ 越界+裸数) / 工具静默失败 / Solver-first（`reflect.ts:73-97`）。**未做：越 scope 检查 · 口径一致 `crossValidate`** —— `reflect.ts:71` 自己写明"本纯函数不承载" |
| §7.3 重规划硬有界 replanBudget=1 | loop 内 | **✅ 已实现在链**（受同一门约束） | `loop.ts:881-928`，`reflected`/`replanReason` 回填 `:928-929` |
| §10.3 新增事件 `agent.reflected` | 事件名 | **❌ 没做（诚实偏离，已登记）** | 全仓 `grep -rn "agent.reflected"` 零命中；本体 §3 已记「实现改为不新增」，改走 `AgentLoopResult.reflected` |
| §10.6 新增门 `harness-elements:check` | `scripts/` | **❌ 没做** | `ls scripts/ \| grep harness` = 空。**金丝雀**：同目录 `check-loop-control.mjs` 存在且已并入 `pnpm gates`（package.json:33）⇒ 目录与 grep 都是好的。只有 vitest `apps/agentcore/test/harness-elements.test.ts` |
| §1.5 第③级"全模式"（router 检索补位 + 完整 ReAct） | 真跑 | **❌ 今天跑不起来** | §2.3 ⑤⑥⑦ 三条实测 |
| §5 `retrieve_knowledge` 工具 | registry | **✅ 已注册在链**（但 §7-U4 未验真跑） | `apps/agentcore/src/tools/registry.ts:26`，executor case `tools/executor.ts:305` |

#### B. `PRD-agent-execution-governance-loop-control.md`（218 行）

| 机制 | PRD 期望 | 状态 | 证据 |
|---|---|---|---|
| P0 Budget Controller（maxIter/roundTrip/duration/per-call 超时） | ✅ 已建 | **✅ 已实现在链** | `loop.ts` 守卫序列；部署态**真配了**：`docker-compose.yml:127-128` `QOS_AGENT_MAX_ROUND_TRIPS=4` / `MAX_DISCOVER_CALLS=1` |
| P0 停滞早停 S01 | ✅ 已建 | **✅ 已实现在链** | `loop.ts:1067 (STALL_CONSECUTIVE_FAILURES=3)` |
| P0 `degrade` 唯一诚实出口 | ✅ 已建 | **✅ 已实现在链 + 有门守** | `loop.ts` degrade；静态门 `scripts/check-loop-control.mjs`，已并入 `pnpm gates` |
| P1 Loop Detector（callSignature 环检测） | 待派 | **✅ 已落 + 部署态已配** | `docker-compose.yml:129 QOS_AGENT_LOOP_REPEAT_CAP=3`；注入点 `orchestrator.ts:2046` **和** `engine.ts:452`（**唯一双路都接的 loop-control 参数**） |
| P2 Retry Manager | 待派 | **⚠️ 只接一半** | 配置已给（`docker-compose.yml:131=1`），注入 `orchestrator.ts:2051`；`grep -n "retry" apps/agentcore/src/engine.ts` = 0 ⇒ **注册 agent 路径无重试** |
| P2 per-tool 调用上界 | 待派 | **⚠️ 只接一半** | 同上：`docker-compose.yml:130=8`，注入 `orchestrator.ts:2050`；engine 侧 0 命中 |
| P2 Escalation Ladder（rung①换策略） | 待派 | **⚠️ 只接一半** | `orchestrator.ts:2048 (escalation: escalationEnabled(...))`；engine 侧 0 命中 |
| P2.5 rung② 反应式重路由 Coordinator | — | **✅ 已实现在链**（泛化 path-B） | `orchestrator.ts:2113 (result.stalled && escalationEnabled && !usedCoordinator)` → `:2392 maybeRerouteToCoordinator` |
| P3 mid-loop Goal Monitor / 跨 agent Deadlock / State Monitor trace | 排后 | **❌ 没做**（PRD 自己排 P3） | — |
| §7 DoD「铁保证」 | 任意病态输入有界终止 | **未判定** | 需 mock LLM 驱动病态输入才能验，本单只读+真跑，未构造。见 §7-U1 |

> **本节最重要的一条结论**：Loop Control 的 P2 三件套 **在部署态配置齐全、在泛化 path-B 上接线正确**，
> 但 **`engine.runRegisteredAgent` 只拿到 `loopRepeatCap` 一个参数**（`engine.ts:437-461` 逐行读过）。
> 也就是说：**Coordinator 扇出的每一个角色子 agent、每一个场景 agent、每一条 workflow 的 `invoke_agent` 步、
> 每一次 skill 发布探针，都跑在"没有重试、没有 per-tool 闸、不会升级、不会反思"的裸循环上。**
> 这不是"没做"，是**接错了地方**——修法是补挂载点，不是造机制。

#### C. `PRD-agent-navigation-slice-latency.md`(107) + `WO-QOS-2-AGENT-SPEEDUP.md`(66)

| 条款 | 状态 | 证据 |
|---|---|---|
| A · 确定性优先门 | **✅ 已实现在链·实测生效** | `orchestrator.ts:708-714`；§2.3 ①③④ 三条实测全被确定性层接走，时延 1–2s（PRD 目标 <5s，达标） |
| B · NavigationSlice 注入 | **✅ 已实现在链** | `navigation-slice.ts:283 (projectNavigationSlice)`，双注入点 `orchestrator.ts:1893` ＋ `engine.ts:417` |
| B · 但切片源是静态目录 | **⚠️ 接了线接错源** | §2.4：19/59。PRD 原文说要复用「`catalog.ts discover` 供给侧 + `ontology/slice-index` 切片」，**实际是新写了一份镜像**，两者已漂 |
| C · plan-then-execute（round-trip ≤4） | **未判定** | 需真 LLM 才能量 round-trip。见 §7-U2 |
| D · 模型分层 | **未判定**（配置面在，效果面没跑到） | `llmSettings.roleModel(tenantId,"agent"/"classifier"/"compose")` 三档在；无 provider 未验 |
| §7.4「唯一未闭环 = 真 Kimi 20 题 live 重测」 | **❌ 仍未闭** | 本单同样没有 key，无法闭。见 §7-U2 |

#### D. `PRD-agent-data-generation-tools.md`（91 行）

| 条款 | 状态 | 证据 |
|---|---|---|
| 三工具进 `BUILTIN_TOOLS` + executor case | **✅ 已实现在链** | `registry.ts:295 (fill_data)` / `:311 (run_synthetic)` / `:328 (build_domain)`；三者 `sideEffect: COMPUTE` ⇒ 过 `runPathB` 的 `{READ,COMPUTE}` 过滤（`orchestrator.ts:1867`），且 seed package `toolWhitelist = BUILTIN_TOOLS.map(name)`（`seed.ts:203`）⇒ **泛化 path-B 上真可见** |
| 回执只含元信息、数字须 query 工具读回 | **未判定** | 需真跑一次 agent 循环才能验护栏。见 §7-U3 |
| 空租户闭环（问→判缺数据→合成→读回→答，标 PROVISIONAL） | **❌ 从未真跑过** | 这是本 PRD 认为**离"多推演一步"最近**的一块（§3-C1） |
| 三工具登记 `OPERATION_CATALOG`（R15 CLI 对等） | **⚠️ 2/3 已对等·1/3 是 R15 洼地** | 逐条核 `packages/contracts/src/operation-intent.ts:53`（40 条）：`run_synthetic`→`{op:"synth", endpoint:"/a/v1/synthetic/jobs", cliCommand:"synth"}` ✅ 同端点；`build_domain`→`{op:"build", endpoint:"/a/v1/databuilder/runs", cliCommand:"build"}` ✅ 同端点；**`fill_data`（`POST /a/v1/growth/fill-data`）无对应条目**——catalog 里的 `{op:"growth", endpoint:"/api/v1/growth", cliCommand:"tickets"}` 是 AgentCore 的成长工单端点，**不是** DataCore 的 fill-data。金丝雀：3 条里 2 条命中 ⇒ 读法正确，第 3 条是真缺 |

#### E. `PRD-llm-agent-empty-response-guard.md`（81 行）

| 条款 | 状态 | 证据 |
|---|---|---|
| `loop.ts` 空响应护栏（不再裸读 `.usage`） | **✅ 已实现在链** | §2.3 ⑤⑥ 实测：无 provider 时返回可读中文降级句，**不是** `Cannot read properties of undefined` |
| 错误冒泡为 R7 信封 | **⚠️ 只接一半** | 泛化 path-B ✅；**注册 agent 路径 ❌**——§2.3 ⑦ 泄漏 SDK 原始英文串，既不是 R7 语义码也不可读 |
| 「让推演真正跑通需另配 agent 用途 provider」 | PRD 自己划在范围外 | **仍未配**（部署态开箱即此状态） |

#### F. `PRD-addendum-agent-runtime.md`（85 行）

| 条款 | 状态 | 证据 |
|---|---|---|
| §1 Token 预算器 + 三刀清理 + `contextOps` | **✅ 已实现在链** | `apps/agentcore/src/agent/context.ts` + `loop.ts` ContextBudgeter；读端已补（下行） |
| §1.4 多轮前情摘要 `agentPriorSummary` | **✅ 已实现在链** | `orchestrator.ts:1889`（泛化）＋ `:2601`（场景 agent） |
| §3 `read_skill_resource` 工具 | **✅ 已注册在链** | `registry.ts:258` |
| §4 MCP 运行时（连接池/命名空间/stdio 安全三条） | **未判定** | 本单未测 MCP。见 §7-U6 |
| §5 同轮 READ 工具并行 ≤4 | **未判定** | 需真 LLM 返回多 tool_use。见 §7-U2 |

#### G. 总纲 §8.1 / §8.5 + QOS §5.4

| 条款 | 状态 | 证据 |
|---|---|---|
| `AgentDefinition` 全字段（tools/skills/mcp/ruleBindings/scopeDeclaration/budget） | **✅ 契约与存储在** | `packages/contracts/src/agentcore.ts`；管理页可配 |
| §8.2 workflow `invoke_agent` 步 | **⚠️ 接了线没数据** | 类型与执行器都在（`engine.ts:651 runAgentStep`）；但**出厂唯一一条带 `invoke_agent` 的工作流 `wf_seed_risk_digest` 是 `status: "DRAFT"`**（`seed.ts:936-946`）⇒ 永不发布、永不被计划选中。金丝雀：同数组相邻工作流为 `PUBLISHED` ⇒ 读法正确 |
| §8.5 AGENT_FIRST/AGENT_ONLY 场景 | **⚠️ 接了线但开箱即崩** | 唯一实例 `scn_graph`（`seed.ts:846`）→ §2.3 ⑦ |
| QOS §4.5 `AgentRunRecord` 有读端 | **✅ 今日刚闭** | `GET /b/v1/queries/:taskId/agent-run`；前端 `AgentsPage.tsx` 运行观测区（commit `1c156ebc`，2026-08-10） |
| 一次运行归属到具体 Agent | **❌ 没做**（已登记） | 本体 §8 `G-AGENTRUN-NO-AGENT-ATTRIBUTION`；契约 `qos.ts:484/711` 无 `agentId` |

### 2.7 "写了 PRD 没做吗"——正面回答仓主

**不是"没做"。是"做了治理面、没做推演面"，而且做的那部分有一半只接了泛化 path-B 这一条腿。**
量化如下（本节表格逐条汇总）：

| 分类 | 条数 | 占比 |
|---|---|---|
| ✅ 已实现且在生产链路上 | 17 | 45% |
| ⚠️ 只接一半 / 接错地方 / 接了线没数据 | 12 | 32% |
| ❌ 没做（含 PRD 自己排后的 P3） | 5 | 13% |
| 未判定（无 provider / 未构造） | 4 | 10% |

**"⚠️ 11 条"才是真正的病灶所在**——它们全都不是"要造新东西"，而是"把已经造好的东西接到该接的地方"。
这也解释了为什么"看起来做了很多，用起来什么都没变"：
**做的每一件事都真做了，只是都停在离用户屏幕最后一格的前面。**

对仓主那句「Agent 管理台 372 行一字未改」的补充事实：属实——
`git log --format="%h %ad" -- apps/frontend-shell/src/pages/admin/AgentsPage.tsx` 显示
2026-06-15 建、2026-06-20 改模型下拉、2026-06-25 加 13 行空态链接、**然后直到 2026-08-10 才动**（`1c156ebc`）。
中间 46 天里后端 agent 侧的所有产出（反思/治理/切片/技能/旁白），**在这个页面上一个字都没有体现**。

---

## §3 目标能力（按用户可见的推演价值排序）

> **排序原则**：一条能力排前面，当且仅当它做完后**用户在屏上看到的答案内容会变**。
> 每条给**机器可验证**的验收判据（能写成 SEAM 测试或一条 curl 断言的），不给"体验更好"这类无法证伪的话。

### C1 · 让 Agent 在"证据不够"时自己把证据造出来再推演 ★最高价值

**用户看到的变化**：今天空数据 → 「该口径当前无数据」；做完后 → 「我合成了一批未审核数据、算完是 X、结论是 Y（标 PROVISIONAL）」。

- 三把工具已注册且在 path-B 可见（§2.6-D 实证），**缺的只是一次真实闭环**。
- 验收判据（可机器验）：
  1. 空租户提问 → `GET /b/v1/queries/:id/decision-trace` 中**存在** `run_synthetic` 或 `fill_data` 的 `outcome=OK`；
  2. **紧随其后**存在 `query_objects`/`query_timeseries_agg` 的 `outcome=OK`（证明数字是**读回来的**不是回执里抄的）；
  3. `answer.blocks` 里每个业务数字带 `⟦ref:N⟧` 且 N < `provenance.length`；
  4. 答案文本命中 `PROVISIONAL|未审核` 之一（R13 诚实标注）；
  5. 变异反证：把 `run_synthetic` 的回执改成含业务数字 → 上述断言 3 必须变红。

### C2 · 让 Agent 看得见租户真正有什么（接缝 A：19 → 59）

**用户看到的变化**：今天问租户自建域的问题 → agent 盲扫或答不了；做完后 → 直接命中自建 solver。

**这条的工作量比看上去小得多——§2.4.1 实证：能查全 59 条的检索已经在跑，质量也不差（金标问句 Top-1 命中）。
缺的只是把"第一轮注入的地图"从静态镜像换成那个已经存在的检索。**

- 修法**不是**把 59 条抄进静态目录（那只是把漂移期延后），**也不是**造新的检索。
  修法是让 `projectNavigationSlice`（`navigation-slice.ts:283`）的候选来源改为
  **`ResourceRegistryService.search`**——即 `retrieve_knowledge` 背后同一份实现
  （`engine.ts:220-227` 注入条件，生产必然满足），静态目录降级为**排序先验**而非候选集。
  **单一来源纪律**：不许 orchestrator/engine/navigation-slice 各建各的检索客户端。
- 顺带必须一起改（否则新地图会被提示词劝退）：`prompts.ts:16`【工作方式】那句
  「选型已替你做完，不必再用 discover 盲扫」要加一个诚实条件——
  「若图中无对口能力，用 `retrieve_knowledge` 现场检索一次再下手」（这句 §3 补③段其实已有，
  但【工作方式】段的绝对化措辞在实践中更强，两段互相打架，需对齐）。
- 验收判据：
  1. 新建并发布一个自定义 solver（不改任何 agentcore 源码）→ 同一问句的首轮 prompt 中**出现**该 solver key；
  2. **回归实证**：对 §2.4.1 那三条问句，首轮地图中**必须出现**至少 `portfolio` / `shared_bottleneck` /
     `base_capacity_outlook` 三者之一（今天一个都没有）；
  3. R6：同问句同租户同资源快照，两次投影**逐字节一致**（排序不得引入时钟/随机）；
  4. 不误伤：既有 20 题金标（`apps/agentcore/test/fixtures/qos-20q-goldset.ts`）路由结论**逐条不变**——
     尤其"误降级=0"这条硬门不许松；
  5. 金丝雀：把资源目录打回空 → 必须退回静态目录且**不崩**（fail-open），且该退化在 trace 中可见
     （不许静默退化——那正是"我没找到"被读成"它不存在"的老坑）。

### C3 · 把治理三件套接到"所有 agent"而不只是泛化 path-B（接缝：11 条 ⚠️ 里最集中的一块）

**用户看到的变化**：今天 Coordinator 扇出的子 agent 卡住 → 烧满预算吐空话；做完后 → 秒级诚实收尾/自动换策略。

- 具体动作：`engine.runRegisteredAgent`（`engine.ts:437`）补传 `reflect` / `escalation` / `perToolCallCap` / `retry`
  四个字段，来源与 `orchestrator.ts:2046-2051` **同一份**（不许各读各的 config）。
- 验收判据：
  1. 构造子 agent 连续工具失败场景 → Coordinator 扇出路径上出现 `agent_escalated` 伪 step **早于** `agent_degraded`；
  2. flag 关时该路径**逐字节等同今天**（字节兼容对照）；
  3. 静态门 `loop-control:check` 扩一条：**枚举全部 `runAgentLoop` 调用点**，每个调用点必须传齐同一组治理字段，
     漏一个即红（这是把"下次别忘了"变成"机器先说话"的机制，铁律 0.6 二级处置）。

### C4 · 让"没有 provider"这件事在**每一条** agent 路径上都诚实（补 §2.3 ⑦）

**用户看到的变化**：本体图谱视图今天点进去问一句 → 红色 `AGENT_ERROR` + 一串英文 SDK 报错；做完后 → 一句可执行的中文提示。

- 具体动作：把 `providerAvailable` 判定从 `orchestrator.ts:778` 的**分支内**提到
  **所有落 agent 的入口共用的一道前置**（`runSceneAgent` / `runRolePathB` / `runCoordinator` / workflow `invoke_agent`）。
- 验收判据：
  1. 无 provider 时，上述 4 条入口各提交一次 → **全部** `status=COMPLETED`（非 FAILED），
     `answer.blocks[0].markdown` 命中「未接入…LLM 提供商」；
  2. 任一条返回 `error.message` 含 `apiKey|authToken|credentials` 等 SDK 词 → 判红；
  3. 有 provider 时行为**逐字节不变**（不劫持）。

### C5 · 把 Skill 的治理契约接到 free-QA 路径（补 §2.5 新发现）

**用户看到的变化**：今天在对话里用到写回型技能 → 可能直接给出"建议这么改"而没有可审批草案；做完后 → 必出 `action_draft`。

- 具体动作：`orchestrator.ts:2053-2072` 补传 `writeMode = skillWriteMode(freeQaSkills)`
  与 `provenancePolicy = effectivePolicy(freeQaSkills)`，**复用 `engine.ts:31/361` 同一份纯函数**（不新写）。
- 验收判据：
  1. free-QA 路径注入含 `sideEffect:WRITE` 的技能 → `final_answer` 不含 `action_draft` 块时**必须被拒并重来**；
  2. 对照：池内全 READ 技能时行为逐字节不变；
  3. 金丝雀：`grep -n "writeMode" apps/agentcore/src/router/orchestrator.ts` 从 0 命中变为 ≥1（今天是 0，见 §2.5）。

### C6 · 一次运行归属到具体 Agent（让管理台的运行观测区真正有意义）

**用户看到的变化**：今天 Agent 管理页只能说"本租户 AGENT 路径的运行"；做完后 → "这个 Agent 的历次运行"。

- 本体 §8 已登记 `G-AGENTRUN-NO-AGENT-ATTRIBUTION`，消除路径也已写明（契约加可选 `agentId/agentKey` +
  两处回填 + `agentRuns.listByAgent`）。**必须一个 dev 整单做**（跨契约＋引擎）。
- 验收判据：`GET /b/v1/agents/:id/runs` 返回的每条 run 的 `agentId` 都等于路径参数；
  泛化 path-B 的 run 该字段为空且页面**继续**显示诚实横幅（不许用界面话术糊）。

### C7 · Reflect 补齐 §7.2 缺的两项（越 scope / 口径一致）

**用户看到的变化**：答案里引用了越权对象域或与知识图谱冲突的口径时，今天静默通过；做完后 → 显式标 CONFLICT/超授权域。

- 复用既有 `ontology.crossValidate`（`ValidationTrace` 已在用）＋ `agent.scopeDeclaration.objectTypes`，
  不新造校验逻辑（PRD-react-harness §7.4 原意）。
- 验收判据：构造一条引用 scope 外对象的答案 → reflect 返回 `ok:false` 且 reason 命中「超授权域」。

### C8 · 补 `harness-elements:check` 门（PRD §10.6 承诺过、没做）

- 验收判据：门必须与 `prompts.ts` **共用同一份**七要素常量（不许门里另抄一份正则——铁律 0.6 已明令），
  且变异反证：删掉【错误恢复】段 → 门必须红。

---

## §4 分期交付

> **P0 判据（硬）**：做完**当天**，用户在屏上能看到推演结果变了。
> 看不到变化的一律不进 P0，无论工作量多大。

### P0（用户当天可见）

| WO | 内容 | 屏上可见的变化 | 🚦范围边界 |
|---|---|---|---|
| **WO-AGENT-V2-P0-A** | C4 · 无 provider 时**所有** agent 入口诚实降级 | 本体图谱视图问一句：红色英文 SDK 报错 → 一句可执行中文提示 | `router/orchestrator.ts`（`runSceneAgent`/`runRolePathB`/`runCoordinator` 前置）＋ 对应 seam test |
| **WO-AGENT-V2-P0-B** | C1 · 合规产数据闭环真跑通（空租户→合成→读回→答，标 PROVISIONAL） | 空数据问句：「无数据」 → 「合成了一批未审核数据，算出 X」 | `tools/executor.ts` 护栏 ＋ 新 `test/agent-datagen-closure.seam.test.ts`；**不改** registry 已注册的三工具定义 |
| **WO-AGENT-V2-P0-C** | C3 · 治理三件套接进 `runRegisteredAgent` ＋ 门扩枚举断言 | Coordinator 扇出卡住：烧满预算吐空话 → 秒级诚实收尾 | `engine.ts` 注入段 ＋ `scripts/check-loop-control.mjs` ＋ 3 条 seam |

> P0-A 与 P0-C 都动"落 agent 的入口"，但**文件边界不重叠**（A 在 orchestrator 的四个入口方法内，C 在 engine 的注入段），
> 可并行两个 dev。P0-B 完全独立。

### P1（推演能力真正变宽）

| WO | 内容 | 判据 |
|---|---|---|
| **WO-AGENT-V2-P1-A** | C2 · NavigationSlice 候选源改活目录（19 → 59），静态目录降级为排序先验 | 新发布自定义 solver 免改码即可被 agent 命中；20 题金标逐条不变 |
| **WO-AGENT-V2-P1-B** | C5 · Skill 治理契约接进 free-QA（writeMode/provenancePolicy） | 写回型技能必出 `action_draft` |
| **WO-AGENT-V2-P1-C** | C6 · run→Agent 归属（跨契约＋引擎，**一个 dev 整单**） | `GET /b/v1/agents/:id/runs` 真按 agent 过滤 |

### P2（质量与信任）

| WO | 内容 |
|---|---|
| **WO-AGENT-V2-P2-A** | C7 · Reflect 补越 scope / 口径一致两项 |
| **WO-AGENT-V2-P2-B** | C8 · `harness-elements:check` 门（与 prompts 共用同一份常量 + 变异反证） |
| **WO-AGENT-V2-P2-C** | 真 provider live 重测：20 题墙钟（path-A <5s / path-B <10s）· round-trip ≤4 · discover ≤1 —— **闭 `PRD-agent-navigation-slice-latency.md §7.4` 挂了半年的那条唯一未闭环** |

---

## §5 砍掉与降级（逐条给理由）

> 不敢砍就是把决策推给仓主。以下每条都是**我的判断**，写明理由与反悔成本。

### 砍掉 · S1 · `agent.reflected` 事件（PRD-react-harness §10.3）
**理由**：QOS §8.2 事件名一字不差是硬约定，新增事件名要动前端订阅、SSE 契约、本体 §4 事件表，
换来的信息量 `AgentLoopResult.reflected/replanReason` 已经承载（loop.ts:928-929），
且与 `agent_escalated`/`agent_degraded` 复用伪 step 的既定做法一致。
**已经实际这么做了**，本 PRD 只是把这个偏离**正式定为决策**，不再当"欠账"挂着。
**反悔成本**：低（真需要时加事件仍是 additive）。

### 砍掉 · S2 · PRD-react-harness §1.5 里"router 向量检索补位"作为 Agent 的前置依赖
**理由**：DRIL 的 `qos.dril-routing` 已经点亮且注入点在（`orchestrator.ts:1958-1979`），
但它是**注入更多候选**，解决不了 §2.4 那个"候选集本身只有 19 条"的问题——
在候选集修好之前（C2），把更多检索堆上去只是让 prompt 更长。
**降级为**：C2 完成后再评估 DRIL 的增益，用同一批 20 题做 A/B。
**反悔成本**：低（DRIL 代码不动，只是不再把它算作 Agent 能力的前置）。

### 降级 · S3 · P3 全套（mid-loop Goal Monitor / 跨 agent Deadlock / State Monitor trace）
**理由**：原 PRD 自己就排 P3 且写明"收尾侧最高价值已由 P0 reflect 覆盖"。
更硬的理由是：**这三项都是"agent 跑起来之后"的精度问题，而今天 agent 根本没跑起来**——
先修跑不起来（P0），再谈跑得好不好。
**降级为**：不排期，等 P2-C（真 provider live 重测）拿到真实卡点数据后再决定做哪一项。
**反悔成本**：低。

### 降级 · S4 · MCP 运行时三条红线（`PRD-addendum-agent-runtime.md §4`）
**理由**：stdio 安全（RCE 面）是**必须保留**的红线，但连接池/心跳/重连退避/schema 缓存属于
"有真实 MCP server 在用之后"的运维质量问题。本单未测（§7-U6），无证据说明今天有租户在真用 MCP。
**降级为**：stdio 安全三条留在红线（不动）；连接生命周期归入"有第一个真实 MCP 接入时"再排。
**反悔成本**：中（真接入 MCP 时会集中暴露，但那时也才有真实负载可测）。

### 砍掉 · S5 · 把 `wf_seed_risk_digest`（唯一带 `invoke_agent` 的出厂工作流）继续留在 DRAFT
**理由**：它今天是"接了线没数据"的活标本——步骤类型和执行器都对，就因为 `status: "DRAFT"` 而永不触发。
留着它既不产生价值，也让"`invoke_agent` 已实现"这句话在审计里显得比实际更真。
**决策**：**要么发布它并配一条 SEAM（证明 workflow→agent 这条边真活着），要么把它删掉**。
我倾向**发布**——它是 §8.2 嵌套语义（深度上限 3 / 环检测 / 预算继承）唯一的出厂活体样本，
删了这三条防失控逻辑就再没有生产数据能触发。
**反悔成本**：低（发布后若造成 demo 噪声可再退回 DRAFT，但那时至少测过一次）。

### 不砍但明确不做 · S6 · 任何 pi 相关改造
`docs/ASSESS-pi-agent-harness-replacement.md`(525) 只作背景阅读。
**治理边界已锁：须仓主决策后方可开工。** 本 PRD 的 P0/P1/P2 **一条都不涉及**它。见附录 A。

---

## §6 《本体引用与影响》（铁律 0）

> 已完整通读 `docs/SYSTEM-ONTOLOGY.md`（1226 行 / 768KB）相关章节：
> §2.H 交互/编排域 · §3 编排链（path-A/path-B/compose/Coordinator/L2/L3）· §4 事件与失效图 ·
> §5 不变量 · §7 门禁 · §8 已知断点（含全表逐条扫描）· §10.3 域内切片。

### 6.1 触及对象类型（§2）

- **H 交互/编排域**：`Task/Query`（QOS 任务·SSE）· `Skill / Agent`（`agent/loop.ts` 宿主）·
  `Agent 执行治理层（Loop Control）`（§2.H 独立条目）· `AgentRole / CeoAgentProfile / Coordinator 编排` ·
  `ExecutionPlan / Workflow`（`invoke_agent` 步）· `SceneEntry`（AGENT_FIRST 模式）·
  `EvalSuite / EvalCase / EvalRunReport`（parity 与 reflect 失因同构）· `ValidationTrace`（C7 复用其 crossValidate）·
  `ResourceDescriptor`（C2 的候选源）· `SkillProbeRunner`（受 C3 影响：探针今天也跑裸循环）。
- **B/E 域**：`ObjectType` / `OntologyLink` / `Slice·SliceSpec`（C2 让 agent 真看见它们）· `SOLVER_CATALOG`（C2 的 19/59 差）。
- **D 域**：`ActionDraft`（C5 的落点·R4 写降级唯一出口）。

### 6.2 触及链路（§3）

| 链路 | 本 PRD 的改动 |
|---|---|
| `Query --classify--> {path-A \| path-B}` | **不动分水岭**。C1–C7 全部作用在**已经落到 agent 的题**上 |
| `Query --(路径B回退)--> Agent --uses--> Skill/Tool` | C1（产数据工具真跑）· C5（技能治理契约补全）· C2（候选源换活目录） |
| `NavigationSlice 注入 + 规划式执行（WO-QOS-2）` | **C2 改的就是这条**：候选源 静态镜像 → 活资源目录；注入点/R6/字节兼容不变 |
| `收尾反思步 Reflect（WO-REFLECT-LOOP + WO-LIGHTUP）` | C3 把它扩到 `runRegisteredAgent`；C7 补 §7.2 缺的两检查项 |
| `跨域 Coordinator 编排（WO-FIVE-ROLE·Ch63）` | C3（子 agent 拿到治理参数）· C4（无 provider 时诚实降级而非崩） |
| `场景入口 AGENT_FIRST → runSceneAgent → runRegisteredAgent` | **C4 主战场**（今天唯一不受暗发门约束却开箱即崩的 agent 路径） |
| `workflow invoke_agent 步 → runAgentStep → runRegisteredAgent` | S5（发布或删除 `wf_seed_risk_digest`）· C3（治理参数） |

### 6.3 触及事件（§4）

**本 PRD 不新增任何 §8.2 事件名**（与既有 `agent_narration` / `agent_escalated` / `agent_degraded` /
`compose_fallback` / `dril_package_injected` 同款：一律复用 `step.completed` 伪 step）。
- C1 的合成触发在 trace 中以既有 `step.completed{type=tool_call}` 承载；
- C4 的诚实降级复用既有 `answer.final`（终态 COMPLETED，不是 FAILED）；
- C2 若需可诊断，复用 `step.completed{type=dril_package_injected}` 同款伪 step，**不新增名字**。
- 复用既有 `{kind}.updated` 失效钩子：C2 让 agent 读活资源目录后，
  资源变更需经既有 `POST /b/v1/internal/invalidate`（TTL 60s + 事件失效，SLO ≤60s）——**不新造缓存**。

### 6.4 触及不变量（§5 · R1–R16）

| 不变量 | 本 PRD 的承诺 |
|---|---|
| **R1 contracts-only-shared** | C6 的 `agentId/agentKey` 落 `packages/contracts/src/qos.ts`；C2 只读 B 侧已有 `/b/v1/resources`，**不跨包 import A 的源** |
| **R2 tenant everywhere** | C2 的资源目录查询必带 tenantId；C6 的 run 归属先校 task 归属再取 run（run 记录本身不带 tenantId） |
| **R3 Entitlement 先于 authz** | C1–C7 **一律不新增暗发门**——今天 14 条已够多了（§2.2）。已有门的语义（`set==="ALL"`→false）不动 |
| **R4 真值只经 Action** | **C5 是直接修 R4 豁口的**（§2.5：free-QA 路径丢了 writeMode ⇒ 写回型技能不强制 `action_draft`） |
| **R6 确定性地板** | C2 的候选投影必须保持纯函数：同问句同租户同资源快照 → 逐字节一致；排序不得引入 `Date.now()`/随机 |
| **R7 错误信封** | **C4 是直接修 R7 破口的**（§2.3 ⑦：SDK 原始串泄漏，既非 `{code,message,requestId}` 也不可读） |
| **R9 双仓储** | C6 新增 `agentRuns.listByAgent` 须 memory + pg + repo 接口三处同改（+ migration） |
| **R13 结论可溯源 / 真推演非假推演** | C1 的硬判据就是"数字必须读回来、必须标 PROVISIONAL"；C7 补口径冲突显式标注 |
| **R15 CLI 对等** | C1 的三工具须核 `OPERATION_CATALOG` 登记（§7-U5 未判定，做时补） |
| **SEAM-GATE** | 每条 WO 必须带一条**驱动接缝**的组合测试（真 submitQuery → 真链路 → 断言），非各半 unit |

### 6.5 触及断点（§8）

**引用既有断点（不新增 ID）**：

| 断点 | 与本 PRD 的关系 |
|---|---|
| `G-AGENT-BLIND-REACT` | 本体记为"已闭（QOS-1 路由侧 + QOS-2 agent 侧）"。**§2.4 实测表明 agent 侧只闭了一半**——切片注入了，但切片本身只覆盖 19/59。C2 是补这半。**建议本体 §8 该条状态从"已闭"改为"◐ 半闭（候选源 32% 覆盖）"** |
| `G-AGENTRUN-NO-READ-SURFACE` | 已闭（`1c156ebc`，2026-08-10）。本 PRD 无改动 |
| `G-AGENTRUN-NO-AGENT-ATTRIBUTION` | 🔴 未闭。**C6 = 它的消除路径**，本体已写明修法 |
| `G-SKILL-UNREACHABLE-FREE-QA`（#90） | 已闭（技能**可见性**）。**§2.5 发现它只闭了可见性一半、治理契约那半没接** → C5 |
| `G-SHIP-CONFIG-IGNORES-CODE`（#88） | 已闭：`docker-compose.yml:127-131` 五个 Loop Control 旋钮真配了（本单实证）。**但配置只对泛化 path-B 生效**（§2.6-B）→ C3 |
| `G-ENTITLEMENT-FAIL-OPEN-DEBUG`（#89） | 已闭（`features/gate.ts:113-119` 透传 `x-debug-user`）。本单实测 demo 租户 resolved 正确（§2.2） |
| `G-DRIL-PATHB-INJECT` | 已闭（注入点在、feature 点亮）。**S2 把它降级**：候选集没修好之前不算 Agent 能力前置 |
| `G-SEMANTIC-DISCOVER` | 与 §2.4 同源，但**实测把它细化了**：仓里其实有**三份**能力目录各自扩容、互不相认——① `discover` 供给侧（本体记 36）② `ResourceRegistryService`（实测 **59** solver·§2.4.1 检索质量已验）③ NavigationSlice 静态镜像（**19**）。**首轮注入用的是最小的那份。** C2 = 把 ③ 的候选源指向 ②（不新造第四份） |
| `G-ROUTE-REGEX-PREEMPTS-RETRIEVAL` | 本体记「10 道正则门排在分类器之前」。**§2.3 ③ 是它的新证据**：真开放假设题（"如果需求翻倍而锂价涨 30%"）被 `ceo-route-fallback` 接走给了 `decision_play`——LLM 一次口都没开。本 PRD **不修**（属路由域，且今天没 provider 时这样反而更好），但**必须在 §7 说清：这意味着"落 path-B 的题"比金标预期的更少** |
| `G-TIMEOUT-AS-VERDICT` | 🟡 修复在途。C4 与它同族（都是"agent 出事时给用户什么"），修法互不冲突 |
| `G-9`（场景发育闭环）/ `G-3`（对话坞未消费缺口） | C1 是 G-3 的 agent 侧闭合（`PRD-agent-data-generation-tools.md §0` 原意） |

**需新增的断点 ID（本单**不改**本体文件，交由落地 WO 回写 `SYSTEM-ONTOLOGY.md §8`）**：

| 建议 ID | 描述 | 性质 |
|---|---|---|
| `G-AGENT-SCENE-ENTRY-RAW-SDK-ERROR` | AGENT_FIRST 场景入口不查 `providerAvailable`，无 provider 时把 SDK 原始英文串当错误信封返给用户（违 R7）。唯一实例 `scn_graph`（本体图谱视图）开箱即崩 | 🔴 未闭 → C4 |
| `G-AGENT-GOVERNANCE-HALF-WIRED` | Loop Control P2 三件套（retry/per-tool cap/escalation）与 Reflect **只接泛化 path-B**，`runRegisteredAgent` 只拿到 `loopRepeatCap` 一个参数 ⇒ 角色 agent/Coordinator 子 agent/场景 agent/workflow invoke_agent/skill 探针全跑裸循环 | 🔴 未闭 → C3 |
| `G-SKILL-GOVERNANCE-DROPPED-ON-FREE-QA` | free-QA 技能池只透传 `loadSkill`，丢 `writeMode`/`provenancePolicy` ⇒ 写回型技能的 `approvalGate:human` 在该路径上失效（R4 豁口） | 🔴 未闭 → C5 |
| `G-NAVSLICE-STATIC-MIRROR-32PCT` | Agent 首轮导航图的候选源是 agentcore 内手工镜像目录（19 条·`navigation-slice.ts:76`），而**同进程内已有一份能查全 59 solver/94 objectType 的活检索**（`ResourceRegistryService`·`engine.ts:220`·实测 Top-1 命中金标）⇒ 租户自建能力与 40 个既有 solver 对首轮选型结构性不可见；且 `prompts.ts:16` 还劝模型别去现场检索 ⇒ 两层覆盖面不一致 | 🔴 未闭 → C2 |

### 6.6 回写承诺

落地任一 WO 后须回写 `docs/SYSTEM-ONTOLOGY.md`：
§2.H（`Skill/Agent` 与 `Agent 执行治理层` 条目补"注入点覆盖面"一句）·
§3（Reflect/治理参数的注入点从 1 处变 2 处）·
§7（若补 `harness-elements:check` / 扩 `loop-control:check` 枚举断言）·
§8（新增上表 4 个 ID；`G-AGENT-BLIND-REACT` 状态由"已闭"改"◐ 半闭"）。
**本单只写本文件，不改本体、不改代码、不改门。**

---

## §7 诚实边界（未判定的逐条列出 · 不猜状态）

> 铁律 0.5：判不了就写"未判定 + 原因"。初稿列了 6 条；写作过程中 **U4/U5 已被真跑闭掉**（划删线并注明结论），
> **剩 4 条真未判定**，每条给出"要判定它需要什么"。

| # | 未判定的条款 | 为什么判不了 | 要判定它需要 |
|---|---|---|---|
| **U1** | Loop Control §7 DoD「任意 mock LLM 病态输入下有界终止且必经 `degrade`」 | 需构造 mock LLM 驱动病态输入，属跑 vitest 范畴；本单被明确禁止跑测试套件 | 单跑 `apps/agentcore/test/loop-detector-seam.test.ts` 等 5 条 seam（约 1 分钟，中画像） |
| **U2** | `round-trip ≤4` · `discover ≤1` · 同轮 READ 并行 ≤4 · 模型分层 D · 墙钟 <10s | **全部需要一个存活的 LLM provider key**。本机无 key，`providerAvailable=false`，agent 循环一次都没真转起来 | 一个可用 key + 20 题 live 重测（= `PRD-agent-navigation-slice-latency.md §7.4` 挂了半年那条唯一未闭环，本单**没能替它闭**） |
| **U3** | 三把产数据工具的**铁律护栏**（回执不含业务数字 / 数字必须 query 读回 / PROVISIONAL 标注） | 工具**注册**已实证在链（§2.6-D），但**从未有一次真实 agent 运行调用过它们**——没有 provider 就没有模型来决定调用它们 | 同 U2；或写一条不经 LLM 的直调 executor 的 seam（可行，但属改代码，超本单边界） |
| ~~U4~~ | ~~`retrieve_knowledge` 的真实检索质量~~ | **已判定（§2.4.1）**：真跑 `POST /b/v1/resources/search` 三条问句，检索**可用且质量不差**（金标问句 Top-1 命中期望 solver）。剩余未判定的只有"agent 在真循环里会不会调它"——归入 U2 | — |
| ~~U5~~ | ~~三把产数据工具的 `OPERATION_CATALOG` 登记~~ | **已判定（§2.6-D）**：`synth`/`build` 两条已按同端点对等；`fill_data` 无对应条目 = R15 洼地 | — |
| **U6** | MCP 运行时四节（连接池/心跳/命名空间/stdio 安全） | 本单完全未测 MCP；且无真实 MCP server 可连 | 起一个 demo MCP server + 走 `runtime-mcp.test.ts` |

**另有 2 条"实测了但样本不足"，也一并诚实标注**：

- **B1**：§2.3 的 7 条问句是我按金标三分类各取代表挑的，**不是全 20 题**。
  结论"0 条进 ReAct"在这 7 条上是硬的，推广到全 20 题需要跑完整金标（属 U1 范畴）。
- **B2**：§2.3 的时延（1.0–2.0s）是**无 provider 态**的时延——它度量的是**确定性层**的快，
  **不度量** agent 的快慢。任何人拿这几个数去说"agent 已经很快了"都是拿 X 当 Y 的证据（铁律 0.6 判据）。

---

## 附录 A · 待仓主裁定（不进 P0/P1/P2）

`docs/ASSESS-pi-agent-harness-replacement.md`(525) 与 `docs/ASSESS-pi-VERDICT.md` 提出的
**harness 替换方案**，本 PRD **一条都没排期**。理由是治理边界已锁：**须仓主决策后方可开工**。
本 PRD 的 P0/P1/P2 全部是在**现有 harness 之内**接线（补挂载点、换候选源、补诚实出口），
**与该方案不冲突也不互斥**——即便将来决定替换 harness，
§3 的 C1/C2/C4/C5/C6 这五条（合规产数据闭环 / 活资源候选源 / 诚实降级 / 技能治理契约 / run 归属）
**在任何 harness 下都仍然要做**，不构成沉没成本。

---

## 附录 B · 一句话给下一个读这份文件的人

> **前六份 Agent PRD 写的都是"Agent 应该怎么想"，没有一份回答"它今天想没想"。**
> 本文的全部价值就在 §2：把"想没想"这件事拿活系统量了一遍，答案是**没想过**——
> 不是因为不会想，是因为它站的那一格今天要么空、要么崩、要么它根本看不见租户有什么。
> 所以 P0 三张单一张都不是"让它更聪明"，全是"让它能开口"。
