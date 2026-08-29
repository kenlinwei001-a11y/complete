# A6 · 我方 AgentCore 能力面（实测基准）

**测法**：不信文档。除共享的 DataCore 4201 / AgentCore 4202 外，另起 **私有实例**（DataCore 4301 + AgentCore 4303/4304/4305/4306/4307）+ **假 OpenAI 兼容端点**（`a6-work/zz-fake-openai.mjs`，落盘每一个发往模型的整包请求），从而能：① 看到模型**实际拿到的工具集与 system prompt**；② 脚本化制造超预算 / 死循环 / 连续失败场景；③ 自由开关 entitlement 而不动共享服务。
所有"我方有 X"的结论都来自这些真跑，不来自 PRD。

---

## 一、能力清单

| 能力 | 实测值 | 证据（命令+输出） | 是真接线还是只有声明 |
|---|---|---|---|
| **工具面：给模型多少工具** | **27 个**（含 `final_answer`）。全部来自**代码里的 `BUILTIN_TOOLS` 常量表**（`tools/registry.ts:4`），非数据库；**运行时无法加新工具**（无注册 API，只能改代码重新部署） | 落盘的真实请求 `reqs-loop/req-003-agent.json`：`TOOL COUNT = 27` → `discover, retrieve_knowledge, resolve_slice, plan_slice, query_ontology, query_objects, query_system_ontology, get_breakpoint, impact_of, aggregate_objects, get_object, invoke_solver, evaluate_rules, search_knowledge, query_timeseries_agg, read_skill_resource, search_experience, fill_data, run_synthetic, build_domain, sim_init, sim_tick, sim_world, sim_certify, create_action_draft, discover_growth_tickets, final_answer` | ✅ 真接线（对照 pi 默认 4 个） |
| **工具是唯一取数口** | system prompt 1905 字，含数字红线 / 写降级 / 注入防护 / 求解纪律 / 错误恢复分类 | 同上文件 `messages[0].content` | ✅ 真接线 |
| **预算维度** | **6 维**：`maxIterations=24` `maxToolCalls=40` `maxSolverCalls=8` `maxDurationMs=600_000` `maxDiscoverCalls=8` `maxRoundTrips=24`（`contracts/src/qos.ts:616`），另有 opt-in 的 `perToolCallCap`。**默认值真生效，无需显式传** | 死循环任务实测停在 24 轮：答案文案 `已达最大探索轮次/预算（round-trip/迭代上界（已 24 轮））`；fake 端点收到 `24` 个 agent 请求 | ✅ 真接线 |
| **诚实降级 `degrade()`** | 4 种出口全部实跑触发，产出见下节「实物」 | 见 §「四个降级实物」 | ✅ 真接线·**我方最强资产** |
| **S01 停滞早停**（连续失败≥3 且近≥2 轮零成功） | **默认配置下即生效**。工具每轮失败 → **3 次 LLM 调用**就停（而非 24） | 4305（零 governance env）+ 脚本 `invoke_solver(zz_no_such_solver_$N)`：`ls reqs-fail\|grep -c agent` = **3** | ✅ 真接线·默认开 |
| **P1 环检测 loopRepeatCap** | **默认关**。关：同参调 `query_objects` **24 轮**烧到硬顶；开（=3）：**3 轮**停 + STALL_LOOP 专属文案 | 4303/4307（默认）=24 次 vs 4304（`QOS_AGENT_LOOP_REPEAT_CAP=3`）=**3 次**；`/metrics` 出 `qos_agent_loop_repeat_total 1` | ⚠️ 机制真接线，**生产默认不注入** |
| **P2 perToolCallCap** | **默认关**。开（=8）：同工具异参刷屏第 9 次被拦，`exhaustedReason=perToolCallCap:query_objects` | 4306（`QOS_AGENT_PER_TOOL_CALL_CAP=8`）：9 次 LLM 调用后停，降级文案含 `（perToolCallCap:query_objects）` | ⚠️ 机制真接线，**生产默认不注入** |
| **Entitlement 前置** | **真生效，但只在 JWT 链路**。`sim.commander`+`sim.sandbox` 关 → 模型工具集 **27→23**，4 个 `sim_*` 被剔除；`qos.agent-fallback` 关 → 域外问句**根本不进 agent**，直接回"请换个问法"+预设问题清单 | 关门后 JWT 跑：`reqs-gated/req-051-agent.json` `TOOL COUNT = 23`，`sim: （已剔除）`。`qos.agent-fallback` 关时 task `path=WORKFLOW`，fake 端点收到 **0** 个请求 | ✅ 真接线（JWT 链路） |
| **Entitlement 在 X-Debug-User 链路** | **完全失效（fail-open 全开）**。同样关掉 sim.*，dev 头跑出来仍是 **27 个工具含 sim_\*** | `reqs-gated` 首个请求 27 工具 vs 末个（JWT）23 工具；根因 `features/gate.ts:88` `if (!res.ok) return cached ? cached.features : "ALL"`，dev 头无 Bearer → DataCore 401 → 全开 | ❌ **声明了但在 dev 链路没接线** |
| **多租户隔离** | 真隔离。`acme` 租户列 skills 返回 `[]`；跨租户读具体资源 404；无凭据 401；角色不足 403 | `curl -H "X-Debug-User: acme:admin:admin" /b/v1/skills` → `[]` HTTP:200；无头 → `UNAUTHORIZED` 401；`base_manager` 写 skill → `FORBIDDEN 资源管理需要 catalog_admin 角色` 403 | ✅ 真接线 |
| **Skill 注册表** | 7 条（5 PUBLISHED / 2 DRAFT），version 整数 + status DRAFT/PUBLISHED/RETIRED，`new-version` 产出 v2 | `GET /b/v1/skills` count=7 | ✅ |
| **Agent 注册表** | 11 条（4 PUBLISHED / 7 DRAFT） | `GET /b/v1/agents` count=11 | ✅ |
| **Workflow 注册表** | 6 条（4 PUBLISHED / 2 DRAFT） | `GET /b/v1/workflows` count=6 | ✅ |
| **MCP 注册表** | 3 条（2 ACTIVE/PUBLISHED，1 DISABLED/DRAFT）。响应只回 `credentialRef`，**无明文密钥** | `GET /b/v1/mcp-configs`：`"credentialRef":"cred-market","credentialKind":"static_bearer"` | ✅ |
| **Solver / 场景 / 场景入口** | solver **38** 个 · scenario **20** 个全 PUBLISHED · scene-entry **9** 个 · 对象类型 **90** 个 | CLI `types` → `对象类型（90）`；`GET /b/v1/solvers` items=38 | ✅ |
| **Skill 发布门（结构 lint）** | **真拦**。劣质 skill 发布 → 422 `SKILL_LINT_FAILED`，11 项具体违规，状态仍 DRAFT | `POST /b/v1/skills/{id}/publish` → `422 技能结构 lint 未通过（11 项）：summary.triggerTemplate, summary.exclusion, body.section×7, body.positiveExample, body.negativeExample` | ✅ 真接线·**质量很高** |
| **Skill 发布门（评测覆盖）** | **真拦**。`SKILL_EVAL_INSUFFICIENT`：需 ≥3 个 skill_quality 用例，当前 0 | `POST /b/v1/skills/skl_seed_sop_meeting/publish` → 422 | ✅ |
| **发布门可被 `?force=true` 绕过** | **两道门全绕**。11 项 lint 违规的垃圾 skill 加 `?force=true` → **PUBLISHED**（仅在记录里留 `lint:{ok:false,violations:[...]}`） | `POST /b/v1/skills/{id}/publish?force=true` → `"status":"PUBLISHED"` + 内嵌违规清单 | ⚠️ 软门·自助豁免·无第二人复核 |
| **Agent 发布门** | **真拦且跨系统校验**：不存在的内置工具 / 不存在的技能 / **DataCore 本体里不存在的对象类型**都被逐条列出，状态仍 DRAFT | `{"ok":false,"errors":[{"field":"tools","message":"内置工具不存在：zz_不存在的工具"},{"field":"skills",...},{"field":"scopeDeclaration.objectTypes","message":"对象类型「ZZNoSuchType」在 DataCore 本体不存在（死路）"}]}` | ✅ 真接线·**A/B 接缝真校验** |
| **Workflow 发布门** | **真拦**：引用未注册求解器 → `求解器「zz_nonexistent_solver」在 DataCore 未注册（死路）`，状态仍 DRAFT | 同上 | ✅ |
| **发布门返回码不合规** | agent/workflow 发布被拒返回 **HTTP 200 + `{ok:false,errors:[]}`**，不是错误信封 `{error:{code,message,requestId}}`（skill 门是正确的 422） | 见上两行 HTTP:200 | ⚠️ 契约不一致 |
| **上下文截断 `truncateToolResultJson`** | **真生效**。8KB 上界，JSON 在最大数组维度二分截断保结构合法 + 尾注引导模型自纠 | 24 轮真跑，末轮 messages 中出现 **23 处** `[已截断：共 24 条，仅含前 23 条。请用更精确的过滤条件或聚合工具重查]` | ✅ 真接线 |
| **折叠 + 滚动摘要 + 锚定防线** | **代码在，但 24 轮真跑一次都没触发**——折叠阈值是 0.7×200k=140k token，8KB×24 轮≈55k token 远不到 | 末轮请求里 `结果已折叠` 出现 **0** 次，`SUMMARY_DEGRADED` **0** 次 | ⚠️ **[未验证生效]** 机制存在（`context.ts:260 summaryLooksAnchored`），但常规负载下是死代码 |
| **Action 审批链** | **真跑通**：draft → PENDING_APPROVAL → planner APPROVE → admin APPROVE → 执行 | `act_5sgg7acxp0ea5ayn` 两级 approvalSteps 带 approverId/decidedAt | ✅ |
| **`adopt_mitigation` 诚实失败** | **确认是 `UnwiredActionExecutor` 诚实失败，不是假单号** | `"status":"EXECUTION_FAILED"`，`executionResult.error = "EXECUTOR_NOT_IMPLEMENTED: 动作类型「adopt_mitigation」尚未接入真实执行器，审批通过后不会写入任何真值。此处诚实失败而非返回占位单号——曾经的兜底会返回 MO-2026-xxxx 形态的假工单号…（G-ACTION-NOOP-EXEC）"` | ✅ **核实通过** |
| **WIRED 动作也拒绝臆造** | `采纳产能保障方案` 标 WIRED，但载荷缺字段时**不猜**：`杠杆行缺 objectId/prop/value（收到 {"key":"outsource","delta":0.1}）——拒绝臆造写入` | 同上流程 | ✅ 真接线 |
| **CLI（R15 对等）** | 真可用：`login` / `whoami` / `types`（90 类型带属性·派生·物化计数）/ `resources`（1000 条 10 类）/ `solve`（真出 p50/p90/gap/perBaseRows）；另有 `do` `ask` `shell` `build` `ontology-query` `generate` `synth` `scenarios` `approve` `tickets` | `node scripts/platform-cli.mjs solve capacity_forecast --args '{"modelId":"4680-NCM","demandDelta":0.2,"weeks":6}'` → `✓ capacity_forecast snapshot=1.1 {"p50":12.3016,"p90":11.4405,"gap":-2.4394,"ok":true,...}` | ✅ 真接线 |
| **无 LLM 时的行为** | 诚实拒答，不编。共享 4202 无任何 LLM 凭据，域外问句 → `当前未接入可用的 LLM 提供商，无法对这类自由问句做开放推理。请在「设置 → LLM」绑定一个提供商后重试；或改用场景卡/确定性入口提问` | `POST /api/v1/queries` → COMPLETED / path=AGENT / 该文案 | ✅ 真接线 |
| **治理指标可观测** | `/metrics` 出 `qos_agent_loop_repeat_total` `qos_agent_budget_exhausted_total` `qos_agent_timeout_total` `qos_agent_escalation_total` `qos_unverified_numerics_total{path="AGENT"}` | 4304 跑完环检测后 `qos_agent_loop_repeat_total 1` + `qos_unverified_numerics_total{path="AGENT"} 1` | ✅ 真接线 |

---

## 二、我们的独有资产（pi 没有的，强在哪、靠什么机制）

### 1. 诚实降级是**唯一出口**，且有四种可判别形态 —— 最大差异点
`loop.ts` 里 **11 处** `return await degrade(...)`，没有任何一条路径能落到 500 或空答案。四种实物（全部真跑得到）：

**① 硬预算耗尽**（默认配置，同参死循环 24 轮）
```
[预算耗尽·诚实摘要] ⚠️ 已达最大探索轮次/预算（round-trip/迭代上界（已 24 轮））：本次深问未能完全解答。以下为已探索到的线索：
已探索线索（仅复述调用轨迹，未形成最终结论）：
- 调用 query_objects（入参 {"objectType":"Order","filter":{"zz":"same"}}）
```

**② STALL_LOOP 环检测**（`QOS_AGENT_LOOP_REPEAT_CAP=3`）
```
[预算耗尽·诚实摘要] ⚠️ 检测到无进度循环：反复以相同参数调用同一工具、未获新信息（环检测·loopRepeatCap=3）——本次深问未能完全解答（已诚实终止，未烧尽预算）。以下为已探索到的线索：
```

**③ per-tool 上界**（`QOS_AGENT_PER_TOOL_CALL_CAP=8`，同工具异参刷屏）
```
[预算耗尽·诚实摘要] ⚠️ 已达最大探索轮次/预算（perToolCallCap:query_objects）：本次深问未能完全解答。以下为已探索到的线索：
已探索线索（仅复述调用轨迹，未形成最终结论）：
- 调用 query_objects（入参 {"objectType":"Order","filter":{"n":"2"}}）
… 共 9 条，逐条列出真实入参
```

**④ S01 连续失败早停**（默认配置，无需任何 env）
```
已探索线索（仅复述调用轨迹，未形成最终结论）：
- 调用 invoke_solver（入参 {"solverKey":"zz_no_such_solver_2","args":{}}）
- 调用 invoke_solver（入参 {"solverKey":"zz_no_such_solver_3","args":{}}）
- 调用 invoke_solver（入参 {"solverKey":"zz_no_such_solver_4","args":{}}）
```

**关键机制**：降级答案的 `trustLevel` 恒为 `AGENT_EXPLORATORY`，`provenance` 只列**真正 OK 的 toolCallId**（无成功调用则为空数组 = 诚实 NO_ANSWER，不编造溯源），且过 `scanBlocks` 未验证数字护栏（命中即 `unverifiedNumerics` 打标 + 指标 +1）。**"部分发现"只复述调用轨迹与入参，绝不复述未验证的数字结论。**

### 2. 写操作物理上出不去 —— `create_action_draft` 是唯一写出口
27 个工具里只有 1 个有写语义，且它只产 **DRAFT**。真跑证实：两级审批（planner → admin）走完，未接执行器的动作**诚实落 `EXECUTION_FAILED`**，错误文案直接把历史坑写进去（"曾经的兜底会返回 MO-2026-xxxx 形态的假工单号"）。连标 WIRED 的动作在载荷不全时也 `拒绝臆造写入`。这是 pi 那种"bash 直接改盘"模型结构上不可能有的。

### 3. 发布门做**跨系统死路校验**（A/B 接缝）
agent 发布时会拿 `scopeDeclaration.objectTypes` 去 **DataCore 本体**核对，`ZZNoSuchType` → `在 DataCore 本体不存在（死路）`；workflow 发布核对求解器是否在 DataCore 注册。这不是本地 schema 校验，是**真跨服务查**。skill lint 11 条规则（触发句模板 / 排除边界句 / 7 段骨架 / 正例 / 反例）是我见过最硬的技能质量门。

### 4. 上下文截断带**自纠信号**而非静默丢弃
pi 的压缩是"独立 LLM 调用 + 出口零校验，8 个字的垃圾摘要原样注入且原文永久丢弃"。我们的截断保 JSON 结构合法 + 附 `[已截断：共 24 条，仅含前 23 条。请用更精确的过滤条件或聚合工具重查]` —— 把"取太多"转成模型可自纠的信号。摘要器另有 `summaryLooksAnchored` 锚定校验（摘要必须命中笔记里的数字/标识符锚点，否则退确定性兜底并置 `[[SUMMARY_DEGRADED]]` 标记）。**注意：锚定防线这一层本轮未能触发验证，见 §三.5。**

### 5. Entitlement 关 = 功能不存在（而非 403）
`sim.commander` 关 → 4 个 sim 工具**从模型的工具清单里消失**（27→23），模型根本不知道有这个能力（R3 暗发）。`qos.agent-fallback` 关 → 域外问句连 agent 都不进。这是产品形态级的能力裁剪，pi 没有对应概念。

---

## 三、我们的真实短板（实测发现，不粉饰）

### 1. ⛔ 治理开关默认全关 —— 这是**第 4 种「没有」**（回应主控/A2 的高优先线索）

**三问三答，全部真跑：**

**Q1：生产路径上这些开关到底被不被注入？**
生产调用点 `orchestrator.ts:1661` 传的是：
```ts
loopRepeatCap: this.deps.config.QOS_AGENT_LOOP_REPEAT_CAP,      // env 未设 → undefined → 禁用
escalation: escalationEnabled(enabledFeatures),                  // feature defaultOn:false
...(config.QOS_AGENT_PER_TOOL_CALL_CAP !== undefined ? {...}: {}) // env 未设 → 整个字段不传
...(config.QOS_AGENT_RETRY_MAX_ATTEMPTS !== undefined ? {...}: {})// 同上
budget: new BudgetTracker(computeResidualBudget(config))         // orchestrator.ts:345，env 未设 → 返回 {} → 用宽松 DEFAULT
```
`computeResidualBudget` 全文只有两个 `if (config.X !== undefined)`，env 不设就返回空对象。

**而 `docker-compose.yml`（出货部署）的 agentcore environment 只有 4 个 QOS_ 变量**：`QOS_CLASSIFIER_MODEL` `QOS_AGENT_MODEL` `QOS_TAU_HIGH` `QOS_TAU_LOW`。
```
$ grep -c "QOS_" docker-compose.yml
4
$ grep "QOS_AGENT_LOOP_REPEAT_CAP\|QOS_AGENT_PER_TOOL_CALL_CAP\|QOS_AGENT_MAX_ROUND_TRIPS" docker-compose.yml
（无输出）
```
DEPLOY.md §6 把 `=4`/`=1` 写成"部署态建议"，**但 compose 没设** → 照 `docker compose up` 起的系统，环检测和 per-tool cap **是关的**。
`agent.escalation` / `agent.critic` / `agent.coordinator` 在 `features/registry.ts` 全是 `defaultOn: false`（新租户默认关；只有 SEED_DEMO 的 demo 租户被种成开）。

**Q2：真造越界场景，拦不拦？**
| 场景 | 默认配置（4303/4305/4307，零 governance env） | 显式注入后 |
|---|---|---|
| 同参死循环 `query_objects` | **不拦**，烧满 **24** 轮才停（fake 端点收到 24 个 agent 请求） | `LOOP_REPEAT_CAP=3` → **3** 轮停 |
| 同工具异参刷屏 | **不拦**（loop-hash 签名含入参 → 每次不同；S01 也不管因为每次都成功） | `PER_TOOL_CALL_CAP=8` → **第 9 次**拦 |
| 工具连续失败 | **拦**（S01 硬编码常量 `STALL_CONSECUTIVE_FAILURES=3` / `STALL_MIN_ROUNDS=2`，非 env） → **3** 轮停 | 同 |

**没拦住的那两条更重要**：默认部署下，一个卡住的 agent 会烧 24 轮 LLM + 24 次 DataCore 查询才认输。按 DEPLOY.md 自己给的基线（137s），这就是 ~2 分钟的空转。

**Q3：`DEFAULT_AGENT_BUDGET` 8 维是默认生效还是要显式传？**
**默认生效，无需显式传** —— `BudgetTracker` 构造函数 `{...DEFAULT_AGENT_BUDGET, ...(overrides ?? {})}`。实测降级文案 `已达最大探索轮次/预算（round-trip/迭代上界（已 24 轮））` 就是 `maxRoundTrips=24` 这个默认值在兜底。**所以不是"完全裸奔"**：24 轮硬顶 + S01 早停是默认在的；**关的是那两道"精细"防线**（环检测、per-tool cap）。

**结论（照实报）**：说"我们比 pi 强在治理"要打折，但**不是打到零**。准确表述是——
> **我方治理有三层：默认在的（6 维预算硬顶 + S01 连续失败早停 + 诚实降级唯一出口），默认关但一行 env 就开的（环检测 / per-tool cap / retry），以及默认关且要租户开 feature 的（escalation 阶梯 / critic / coordinator）。出货 compose 只带了第一层。**
> pi 侧的对照是：裸 `Agent` 类**无 `shouldStopAfterTurn`**、30 连轮全跑、`abort()` 只留空壳无降级钩子（主控已实测）—— pi 连"第一层"都没有。所以**方向上我方仍强，但"开箱即强"是假的，得改 compose**。

### 2. ⛔ Entitlement 在 `X-Debug-User` 链路完全失效（fail-open 全开）
`features/gate.ts:88`：
```ts
if (!res.ok) {
  // degraded: stale cache if any, otherwise fail open
  return cached ? cached.features : "ALL";
}
```
dev 头没有 Bearer → 发往 DataCore 的 `/a/v1/tenants/{id}/features` **401** → 直接返回 `"ALL"` = 所有 entitlement 全开。
实测对照（同一份 tenant 配置，sim.commander/sim.sandbox 均已关）：
- `X-Debug-User: demo:admin:admin` → 模型拿到 **27** 个工具，`sim_init/sim_tick/sim_world/sim_certify` 全在
- `Authorization: Bearer <JWT>` → 模型拿到 **23** 个工具，sim 全剔除

**风险**：任何用 dev 头做的验收/演示/联调，验的都是"全功能"形态，与真实租户形态不一致 —— 这正是本仓"绿测试≠能用"的同款陷阱，只不过换到了 entitlement 维度。而且 DataCore 短暂不可达 + 无缓存时，生产链路也会 fail-open。

### 3. ⛔ Skill 注册表对**默认自由问答 agent 不可达**（声明了没接线）
`load_skill` 工具定义在 `registry.ts:480`，但 grep 全仓 `LOAD_SKILL_TOOL` 只被 `skill-lint.ts` 引用（用来 lint 技能声明），**从未进入任何生产工具集**。
`loadSkillEnabled: true` 全仓只出现一次 —— `engine.ts:359`（注册 B1 agent / 角色 agent / 子 agent 路径）。通用 path-B `orchestrator.ts:1661` 的 `runAgentLoop({...})` 参数表里**没有 `loadSkillEnabled`，也没有 `loadSkill`**。
实测佐证：真跑的 27 工具里**没有 `load_skill`**。
**后果**：注册表里 7 个 skill（含 11 条 lint 规则把关的高质量方法论），**默认自由问句路径一个都用不上**。渐进披露是"注册 agent 专属"，不是平台能力。

### 4. ⛔ 治理开关在两条 agent 路径上不对称
`engine.ts`（注册 agent / coordinator 扇出 / 角色 agent / 场景 path）的 `runAgentLoop` 只传了 `loopRepeatCap`：
```
$ grep -n "perToolCallCap\|escalation\|retry:\|loopRepeatCap" apps/agentcore/src/engine.ts
351:      loopRepeatCap: cfg.QOS_AGENT_LOOP_REPEAT_CAP,
```
即 **per-tool cap / escalation / retry 只保护通用 path-B，不保护子 agent**。Coordinator 扇出多个子 agent 时，每个子 agent 都缺这三道防线（预算是共享的，这点没问题）。

### 5. ⛔ 折叠 / 滚动摘要 / 锚定防线在常规负载下是死代码
折叠阈值 = `0.7 × 200_000 = 140k` token。单个 tool_result 已被截到 8KB，24 轮 ≈ 192KB ≈ 55k token —— **够不到阈值**。实测末轮请求里 `结果已折叠` 出现 **0** 次。
所以我们引以为豪的"锚定防线 + 降级标记"（针对 pi 摘要出口零校验的那块）**本轮没能真跑验证**，它只在超长会话（>140k token）才有机会执行。**这一条我不能算作"已验证的优势"。**

### 6. ⛔ 发布门是软门 —— `?force=true` 自助绕过
11 项 lint 违规的垃圾 skill：
```
POST /b/v1/skills/{id}/publish            → 422 SKILL_LINT_FAILED
POST /b/v1/skills/{id}/publish?force=true → 200 "status":"PUBLISHED"
```
评测门（`SKILL_EVAL_INSUFFICIENT`，需 ≥3 用例）同样被 `?force=true` 绕过。虽然记录里留了 `lint:{ok:false,violations:[…]}` 审计痕迹，但**同一个 catalog_admin 自己就能豁免自己，无第二人复核、无审批流**。门的威慑力取决于人的自觉。

### 7. ⛔ 发布门返回码不合规
agent / workflow 发布被拒返回 **HTTP 200 + `{ok:false,errors:[...]}`**，违反 CLAUDE.md「错误信封 `{error:{code,message,requestId}}` 两系统统一」。skill 门是对的（422 + 标准信封）。前端/CLI 若按 HTTP 状态判成败会把"拒绝发布"当成"发布成功"。

### 8. ⛔ S01 早停的降级文案**归因错误**
S01 触发时走 `degrade("BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED")`，用户看到的是：
```
⚠️ 已达最大探索轮次/预算（round-trip/迭代上界（已 3 轮））
```
明明是"连续失败 3 次早停"（3 轮 ≪ 24 轮上限），文案却说"已达最大轮次上界"。对比 STALL_LOOP 有专属文案，S01 没有 —— 运维看日志会误判成预算配小了。

### 9. ⚠️ 工具集是编译期常量，运行时不可扩展
`BUILTIN_TOOLS` 是 `registry.ts` 里的 TS 常量数组。加一个工具 = 改代码 + 重新构建 + 重新部署。MCP 是唯一的运行时扩展通道（3 条配置），但 MCP 工具不进 `BUILTIN_TOOLS`。相比 pi 的 `pi.on` 扩展层（主控实测：`context` 注入真到达模型 msg[2]，`tool_call` 返 `{block:true}` 真拦住 bash），我们没有等价的"不改主仓就加能力"机制。

### 10. ⚠️ LLM provider 适配器缓存不含 baseUrl（本轮实测踩到）
`providers.ts` 的 `cacheKey = ${cfg.tenantId}|${cfg.id}|${cfg.key}` —— **不含 baseUrl**。我 `PUT /b/v1/llm/providers/{id}` 改了 baseUrl，返回 200 且库里已更新，但后续请求**仍打到旧地址**（我因此浪费了两轮排查）。运维改 provider 地址后不重启服务 = 改了个寂寞，且无任何提示。

### 11. ⚠️ system prompt 与实际预算不一致
prompt 写「真开放深问最多约 **4** 轮工具调用与 **1** 次 discover 盲扫」，但默认预算是 `maxRoundTrips=24` / `maxDiscoverCalls=8`。prompt 里的"纪律"没有对应的强制上界撑腰（除非按 DEPLOY 建议设 `=4`/`=1`，而 compose 没设）。模型只要不听话，就有 6 倍的空转余量。

---

## 四、我没能验证的

1. **锚定防线 `summaryLooksAnchored` + `[[SUMMARY_DEGRADED]]` 标记的真实触发**。需要 >140k token 上下文，本轮 24 轮真跑只到 ~55k。这是我方对标 pi「摘要出口零校验」的核心论据，**目前只有静态代码，没有实物**。建议后续单独造超长会话验。
2. **escalation 阶梯 rung①（换策略再试一轮 + `agent_escalated` 伪 step）**。我私有 DataCore 上 `agent.escalation` 被 override 级联关掉了（关 4 个 feature 导致 79→60，`agent.escalation` 在内），`qos_agent_escalation_total` 恒 0。共享 4201 的 demo 租户是开的，但那边没有 LLM 凭据跑不了 agent。
3. **B1 注册 agent 路径（`engine.ts`）的 `load_skill` 实际调用**。我只验了通用 path-B 没有这个工具；注册 agent 路径有 `loadSkillEnabled:true` 是**静态读码**，没真跑到（需要问句被路由到某个已发布的角色 agent）。
4. **MCP 工具真进模型工具集**。3 条 MCP 配置的端点都是 `https://*.example.com` 假地址，`POST /b/v1/mcp-configs/{id}/test` 返回 `{"ok":false,"tools":[],"message":"fetch failed"}`（诚实失败 ✅），但我没有起真 MCP server 去验"MCP 工具最终出现在给模型的 tools 数组里"。
5. **`retry`（`QOS_AGENT_RETRY_MAX_ATTEMPTS`）的有界重试**。开关我传了，但没造出"瞬时/传输层错"场景来区分它与确定性错。
6. **pg 模式**。全程 memory 仓储（无 `DATABASE_URL`）。pg 下的发布门 / 租户隔离 / Action 审批链未验。
7. **CLI 的 `do` / `ask` / `shell` / `ontology-query` / `generate`**。这几个都依赖 LLM，共享 4202 无凭据；我只验了不需要 LLM 的 `login/whoami/types/resources/solve`。R15「CLI 对等」到什么程度**只验了确定性那一半**。
8. **`claim_growth_ticket` / `submit_growth_ticket`** 在 `BUILTIN_TOOLS` 里但没进模型工具集（27 里没有），我没查清是 package `toolWhitelist` 没放行还是别的原因。

---

## 五、越界线索（交主控）

- **DEPLOY.md ↔ docker-compose.yml 有实质落差**：DEPLOY.md §6/§7 明写"部署态建议设 `QOS_AGENT_MAX_ROUND_TRIPS=4` / `QOS_AGENT_MAX_DISCOVER_CALLS=1`"并给了 137s 基线，但出货 compose 一个都没设。这不在我的范围边界内（我只读不改），但**这是一行 compose 就能补的、收益最大的改动**，建议单独派工单。
- **`features/gate.ts:88` 的 fail-open** 是产品级安全语义问题（注释自辩"entitlement is product shaping, not authz"），是否可接受需要仓主拍板，不该由测试方定。
- **共享 4202 上有两处遗留状态变更**（验证发布门/生命周期时产生，均为内存态，**重启 4202 即恢复**）：`sop_meeting` DRAFT→**PUBLISHED**（`?force=true` 绕门实验）、`risk_analysis` PUBLISHED→**RETIRED**（retire 接口实验）。其余探针数据（zz_bad_probe / zz_bad_wf / zz_bad_agent / zz_bad2 / zz_bad3 / capacity_analysis v2）已全部 DELETE 清理干净；我起的私有实例（DataCore 4301、AgentCore 4303–4307、5 个假 LLM 端点）已全部 kill，共享 4201/4202 健康（features:200 / healthz:200）。
