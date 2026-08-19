# L1 双跑对账定义（dualrun50 · §16.2 层①）

本文件是 L1 对账口径的**单源**。driver `dsh-e2e-dualrun50.test.ts` 的断言按本文件实现；
语料 `corpus.ts` 每条任务按本文件声明期望值。裁决来源：team-lead 2026-08-19 L1 口径重定义
（scalar + kernel 唯一白名单 + native 迭代锚 + dsh stats 对齐），蓝图 node-plan-E2E.md D-1/D-7。

## 0. 驱动级与确定性载体

- 驱动级 = engine.runRegisteredAgent（真 fork 分叉），flag off = native runAgentLoop /
  flag on = dsh 子进程（生产档 cordis.yml + platform-llm 真 provider 缝）。
- 确定性载体 = helpers-dsh-stub.ts（startStubOpenAi 剧本化端点 + stubDirectory/stubProvider
  + `dcp:llmp_stub:kimi-k3` spec）；native 臂 = ScriptedLlmClient 队列剧本。
  **mock-llm 剧本外置化（蓝图 changes #1）已裁决撤销**，本层零 product 改动。
- dsh 臂 **meta-tools only**（裁决）：生产档零真工具插件，scoped 世界可用 =
  final_answer（恒）+ load_skill（挂技能时）。语料剧本只用这两件 + 纯文本轮。

## 1. 发车哨兵（防 native-vs-native 假绿，蓝图 risks #3）

每条任务的 dsh 臂必须同时满足，缺一即红：
1. `stub.requests.length === 剧本轮数`——子进程真 spawn、真走完整剧本（HTTP wire 实证）；
2. `run.kernel === "EXTERNAL"`——engine 分叉真返回（emptyAgentRunRecord 仅分叉两点给 EXTERNAL）；
3. answer 含该任务独有 marker——证明消费的是**本任务**剧本而非旁路。
反向哨兵（deny_prefork 类）：`stub.requests.length === 0` 且 kernel === "EXTERNAL"
（分叉前预检早退点 :432 的 flag 态值语义——标「本会走哪个内核」，未真 spawn）。

## 2. 四面断言

### A1 · Answer 结构（逐字节）
dsh 臂 answer 剥 `stats` 附加键后与 native 臂 answer 深度逐字节等：
blocks 类型序列逐项等 + 每块全字段逐字节等 + trustLevel/provenance/unverifiedNumerics 等。
归一化集（只核形态不核值）：provenance[].id（`prov_` 前缀随机）。
声明映射集：provenance[].toolCallId（两臂各自生成 → 归一占位）。
provenance 形态任务 = unknown 引用形态（两臂同引未解析 id ⇒ toolName "unknown" 两臂一致；
真对象溯源的诚实断言属 L5，本层只保接缝保真）。

### A2 · 拒绝口径（deny 类 ≥10 条：deny_pre / deny_mid / deny_all / deny_prefork）
1. 双臂最终 Answer 拒绝文案**逐字节等**（A1 同一条断言覆盖）；
2. dsh 臂**真强制证据**（wire 级）：`stub.requests[声明位].body` 含
   `mock rule engine: tool <名> denied by ruleBindings PRE_CHECK`——治理桥 mock 模式
   真 deny 的回注逐字可见（上一轮的 isError 工具结果进入下一轮请求消息）；
3. native 臂**真强制证据**：answer 由规则强制点产出——deny_pre/mid/all = POST_CHECK 替换
   （provId `prov_post_check` 锚），deny_prefork = skill precondition 预检
   （provId `prov_skill_rule_check` 锚 + 零迭代早退）；
4. **强制点位置差登记为固有不对称（不进断言）**：native 无 ruleBindings PRE_CHECK 执行点
   （蓝图 evidence 2a），dsh 无 POST_CHECK 外挂（evidence 2b）；deny_prefork 的 skill 预检
   在分叉**之前**，两臂对称经过（dsh 臂零 spawn，反向哨兵）。

### A3 · SSE 事件名序列
N2 形态继承：双臂 emit 序列（测试镜像 orchestrator:2187 补 answer.final）→ 剥 answer.final
stats 键 → 滤收缩白名单（ALLOWED_PSEUDO_TYPES 去 final_answer/load_skill）→ 逐项相等；
差集实际项 ⊆ ALLOWED_PSEUDO_TYPES（反向咬白名单不膨胀）；事件名 ⊆ KNOWN_EVENTS 十名。
meta-only 语料下两臂非伪步序列均空（load_skill/final_answer 两臂同不产 step 事件）——
本面价值 = 50 任务扫频下零意外事件泄漏 + 白名单反咬；真工具 SSE parity 物理不可达
（dsh 臂无真工具），登记为固有不对称 #3 的推论。

### A4 · 审计逐字段（重定义口径）
逐字段对账 AgentRunRecord：
- **归一化集**：id（`run_` 形态）；iterations[].toolCalls[].toolCallId（`tc_` 形态）、durationMs（非负数值）。
- **scalar 逐值等**：taskId / model（两臂同 = `dcp:llmp_stub:kimi-k3`，探针 P1 坐实 roleModel
  回落原值）/ budget（深等）/ budgetExhausted / tenantId / agentId / agentKey / agentVersion /
  attribution / origin / contextOps 缺省一致。
- **kernel = 唯一白名单值差**：dsh 恒 "EXTERNAL"、native 恒 "NATIVE"（N5 已落线，真咬）；
  断言两臂值各为锚定字面量 **且其余字段零值差**（差集恰 = {kernel}，反咬白名单不膨胀）。
- **native 迭代锚**：native 臂 iterations 按语料声明逐轮锚定（轮数 + 每轮 toolCalls 的
  toolName/outcome 序列 + load_skill input 深等）；dsh 臂 iterations 恒 === []
  （emptyAgentRunRecord 无源——登记为固有不对称 #4 的一半）。
- **dsh stats 对齐**（固有不对称 #4 的另一半）：dsh 臂 token 账不在 run 记录在 answer.stats——
  断言 `stats.tokenUsage` 逐桶等 = 语料声明的 stub 剧本 usage 折出和（pi-ai 口径：
  prompt_cache_hit_tokens→cacheReadTokens，余入 uncachedInputTokens）、
  `stats.contextPressure.pressureTokens` = 末轮 prompt_tokens；run.totalInputTokens/totalOutputTokens
  恒 0/0 锚定。native 臂 tokens 锚 = 100/50 × 剧本轮数（ScriptedLlmClient 固定账）。
  两臂 token 账**不互比**（物理不同源），各锚各的剧本。
- 时间量（stats.sessionStats 的 llmMs/ttftMs/decodeMs 等）为墙钟，只核非负数值形态，
  不进字节断言（A5 确定性同样豁免）。

### A5 · 确定性
A5 子集（语料声明 6 条：每类至少一 + 长上下文 + 多轮 + provenance）同臂连跑两遍，
四面产物过**同一比对器同臂变体**（kernel 期望同值、其余同口径）必须全绿——
证明比对器不把噪声当差集。

## 3. 固有不对称登记（D-7 对齐，不冒充对称）
1. native 无 ruleBindings PRE_CHECK 执行点 / dsh 无 POST_CHECK 外挂 ⇒ A2 只断言最终文案 + 两臂各自
   真强制证据，强制点位置不进断言。
2. skill precondition 预检在分叉前 ⇒ deny_prefork 类 dsh 臂零 spawn（反向哨兵），kernel 为 flag 态值。
3. 两臂工具集物理不同（dsh meta-only vs native builtin）⇒ 语料两臂同用 meta 剧本保 parity；
   真工具对账物理不可达，L1 不声明该覆盖。
4. dsh 臂审计记录为空壳（iterations []、tokens 0/0）⇒ native 迭代锚 + dsh stats 对齐代之，
   两臂 token/迭代不互比。
5. **缝观察（denied final_answer 的 blocks 仍上 answer 面）**：dsh 帧流 tool/call 在派发前记录
   （agent-loop lib/index.js:275），pre-execute deny 不抹帧；reassemble collectToolCalls 不滤成败
   ⇒ 被拒 final_answer 的 blocks 仍成 answer。deny 的执行证据只能在 wire/帧面断言，answer 面
   不体现 deny。本层如实登记，不修缝（L1 是测试层；若评审裁定这是缺陷，另立 WO）。
6. runPathB 不过分叉（蓝图 evidence 1）⇒ 本层驱动只走 runRegisteredAgent。
7. 角色路（runRolePathB）/场景路（runSceneAgent）STALL_LOOP 两条语料槽（跨单回执）：
   本树 orchestrator 仅 :2179 一处 agent_degraded 发射，两处 degraded 静默缝 WO 未落线
   ⇒ 语料留 gated 槽（`GATED_SLOTS`），driver 鸣报 skipped，不冒充覆盖。

## 4. 语料构成（50 条 + 2 gated）
- 内容源：20 条 = SCENARIO_CATALOG triggerQuestion（执行通道不借 evals——蓝图 evidence 5）；
  30 条合成：四维造（长度：短问句 / ≥4KB 长上下文；工具轮：0/1/3 轮 load_skill；
  多轮：1/2/5 次 LLM 往返；拒绝混合：deny_pre 前置 / deny_mid 中段 / deny_all 全 deny /
  deny_prefork 分叉前）。
- 每条 = 数据对 {native 臂 mock 队列剧本，dsh 臂 stub 剧本（+PLATFORM_GOV_DENY 声明），
  期望值声明（answer / native 迭代锚 / native token 锚 / dsh stats 锚 / deny wire 证据位）}。
- 自检闸（driver 首条 it）：总数 50、deny ≥10、四维覆盖全到位、A5 子集 ∈ 语料、gated 槽在册。
