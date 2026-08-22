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

**EMPTY 空块类第 3 条条件豁免（W2 批1，dr50-by/bz/ca 三条）**：纯空答案
（blocks:[] / 空 markdown 块 / 空白软收尾）结构上不可能携带 marker，强留第 3 条
等于判这类任务死刑；空答案 ≠ 没发车。豁免谓词（driver `markerSentinelExempt`）
= 语料显式置位 ∧ expect.answer 序列化确无本任务 id（结构复核，误置不生效）；
A0 闸双恰护栏「豁免 ⇔ 无 marker」+ 豁免任务 prompt 必含 id。豁免期发车事实由
互补证据链锁定（缺一即红）：dsh 臂 ①②不变 + stats/sessionStats turns/steps 锚（A4）
+ **wire 首请求体含本任务 id**（顶替 marker 的剧本身份职能）；native 臂 token 锚
100/50×轮数（ScriptedLlmClient 只按真消费记账）+ 迭代锚。豁免面锁死 EMPTY 类，不可外溢。

## 2. 四面断言

### A1 · Answer 结构（逐字节）
dsh 臂 answer 剥 `stats` 附加键后与 native 臂 answer 深度逐字节等：
blocks 类型序列逐项等 + 每块全字段逐字节等 + trustLevel/provenance/unverifiedNumerics 等。
归一化集（只核形态不核值）：provenance[].id（`prov_` 前缀随机）。
声明映射集：provenance[].toolCallId（两臂各自生成 → 归一占位）。
provenance 形态任务 = unknown 引用形态（两臂同引未解析 id ⇒ toolName "unknown" 两臂一致；
真对象溯源的诚实断言属 L5，本层只保接缝保真）。
EMPTY 空块类（W2 批1）同此面：零块数组、空 markdown 串、空白串均逐字节等
（两臂 final_answer 校验同一 zod 形——无 .min(1)，空形态天然可账）；
G4 超长输出同此面（≥32KB 长文深度等 = 比对器自身压力测试）。
G3 length 截断任务（语料 lengthDivergence 置位，W2 批3）本面**不互比**：两臂各锚各的
声明产物（native = expect.answer 本位软收尾原文；dsh = 诚实摘要头 + 截断前文），
设计取向差登记见 §3 #9；非置位任务互比口径零放宽。

### A1b · structured 深等（G2 expectsSchema，W2 批2）
expectsSchema 任务的双臂对账面：`result.structured` 双臂捕获深等 + 语料声明锚；
非结构化任务两臂同 undefined 也逐值咬（反咬「观测面缺失」——driver 先补捕获再断言）。
valid 形态（dr50-ce/cf）：native acceptFinalAnswer 校验过 ⇒ answer 恒固定文案
「已按要求返回结构化结果。」（loop.ts:1287-1295）；dsh reassemble expectsSchema 分支
answer = `lastAssistantText || "（结构化回答见 structured）"`（reassemble.ts:415）⇒
**dsh 剧本末轮文本必须逐字写固定文案**（语料 STRUCTURED_ANSWER_TEXT 单源），A1 才逐字节等。
invalid 形态（dr50-cg，invalid→valid 收敛）：native 拒首轮（checkJsonSchema 回注重规划，
loop.ts:1122-1131）⇒ 次轮 valid 收敛；dsh reassemble 校验**末次** final_answer ⇒ 通过收敛。
**fail-closed 修复登记（W2 批2③，team-lead 裁决判缺陷）**：reassemble expectsSchema 分支
原实现 raw 直通无校验（注释自称「对位 loop.ts:147/256」系误引——:256 只是类型注释），
invalid structured 会落进 `result.structured`；修复 = 同一 checkJsonSchema
（util/jsonschema.ts 单源 import 复用）校验，invalid ⇒ ok:false（与 provenance/writeMode
rejects 同通道，engine 出口 FAILED + 「dsh 重组装拒绝：…」既有映射）。
钉死位：reassemble 单测探针 2 条（dsh-runtime-reassemble.test.ts ③ 组）+ mutation 反证
（摘校验 ⇒ 探针红）。语义差诚实登记：持久 invalid（剧本不收敛）下 native 重规划至剧本耗尽
软收尾 ANSWERED，dsh fail-closed FAILED——两臂对「模型反复给非法结构化结果」的处置
取向不同（native 宽容重试 / dsh 诚实拒绝），语料只钉「拒后收敛」形态（dr50-cg），
持久分歧形态不进双跑（同 §3 #8 的设计取向差性质）。

### A2 · 拒绝口径（deny 类 ≥10 条：deny_pre / deny_mid / deny_all / deny_prefork）
1. 双臂最终 Answer 拒绝文案**逐字节等**（A1 同一条断言覆盖）；
2. dsh 臂**真强制证据**（wire 级）：`stub.requests[声明位].body` 含
   `mock rule engine: tool <名> denied by ruleBindings PRE_CHECK`——治理桥 mock 模式
   真 deny 的回注逐字可见（上一轮的 isError 工具结果进入下一轮请求消息）；
3. 双臂**真强制证据**：deny_pre/mid/all = POST_CHECK 替换（provId `prov_post_check` 锚）——
   WO-DSH-PROD-READY W1 起双臂在 engine 出口共用 applyPostChecks 闭包，强制点**逐字节同码**
   （evidence 2b「dsh 无 POST_CHECK 外挂」自此作废）；deny_prefork = skill precondition 预检
   （provId `prov_skill_rule_check` 锚 + 零迭代早退）；
4. **强制点位置差登记为固有不对称（不进断言）**：native 无 ruleBindings PRE_CHECK 执行点
   （蓝图 evidence 2a）——仅存的不对称；POST_CHECK 侧 W1 已销账（见 item 3）。
   deny_prefork 的 skill 预检在分叉**之前**，两臂对称经过（dsh 臂零 spawn，反向哨兵）。
   stats 回声与治理替换正交：dsh 臂 answer 被 POST_CHECK 替换后 stats 键仍必须在
   （A4 stats 锚不按后验结果分支）。

### A3 · SSE 事件名序列
N2 形态继承：双臂 emit 序列（测试镜像 orchestrator:2187 补 answer.final）→ 剥 answer.final
stats 键 → 滤收缩白名单（ALLOWED_PSEUDO_TYPES 去 final_answer/load_skill）→ 逐项相等；
差集实际项 ⊆ ALLOWED_PSEUDO_TYPES（反向咬白名单不膨胀）；事件名 ⊆ KNOWN_EVENTS 十名。
meta-only 语料下两臂非伪步序列均空（load_skill/final_answer 两臂同不产 step 事件）——
本面价值 = 50 任务扫频下零意外事件泄漏 + 白名单反咬；真工具 SSE parity 物理不可达
（dsh 臂无真工具），登记为固有不对称 #3 的推论。

#### A3 补表 · 事件族覆盖矩阵（W5 块1；15 族 = KNOWN_EVENTS 十名 ∪ ALLOWED_PSEUDO_TYPES 五名）

族 = 观测面对账单元 `事件名:伪类型`（driver seqOf 形态）。每族二选一：真触发（语料条目 +
臂别，driver A3c 自跑实证精确族集）或登记不可达（原因四类闭枚举，不冒充覆盖）。

| 族 | 覆盖真相 |
|---|---|
| task.accepted | 编排层事件·本驱动级不可达（orchestrator:538 在 runRegisteredAgent 之外发射） |
| routing.completed | 编排层事件·本驱动级不可达（orchestrator 路由面发射点群） |
| clarification.required | 编排层事件·本驱动级不可达（orchestrator:1351） |
| coordinator.planned | 编排层事件·本驱动级不可达（orchestrator:2546） |
| step.started（真工具名族） | 真工具步族·meta-only 语料不可达（固有不对称 #3；发射点 loop.ts:847 / mapper tool/call 分支） |
| step.completed（真工具名/status 族） | 真工具步族·meta-only 语料不可达（固有不对称 #3；loop.ts:848 / mapper tool/result 分支） |
| answer.final | **真触发**：全部 64 条（双臂；测试镜像 orchestrator:2187 同行发射；矩阵实证锚 dr50-aa） |
| action_draft.created | 编排层事件·本驱动级不可达（orchestrator:2171 runPathB 段） |
| task.failed | 编排层事件·本驱动级不可达（orchestrator:1727/:2876；runRegisteredAgent 层 FAILED 无 SSE 发射） |
| task.cancelled | 编排层事件·本驱动级不可达（orchestrator 取消面发射点群） |
| agent_narration（step.completed 伪步族） | **真触发**：dsh 臂文本轮（dr50-aa 等凡带 rTx 轮次者；白名单差集项，N2 evidence 12 既有登记；native 臂 emitNarration 缺省关） |
| agent_think（step.completed 伪步族） | **真触发**：dr50-ck（dsh 臂 reasoning-delta 流式透传，stub reasoning 通道确定性触发；白名单差集项；native 臂 loop.ts 无 agent_think 发射点） |
| compaction（step.started/step.completed 伪步族） | harness 内部决策·剧本面无确定性触发通道（压缩由子进程上下文压力触发；mapper 三分支由 N2 A6b + N2-A3/A4 黄金帧单测钉死） |
| final_answer（meta 伪步族） | meta-skip 销账项·绿态恒不出现（D-7 双臂同不产 meta 步事件；出现即差集反咬 + 收缩过滤后序列不等 ⇒ M10 咬点） |
| load_skill（meta 伪步族） | meta-skip 销账项·绿态恒不出现（同上行口径） |

### A4 · 审计逐字段（重定义口径）
逐字段对账 AgentRunRecord：
- **归一化集**：id（`run_` 形态）；iterations[].toolCalls[].toolCallId（`tc_` 形态）、durationMs（非负数值）。
- **scalar 逐值等**：taskId / model（两臂同 = `dcp:llmp_stub:kimi-k3`，探针 P1 坐实 roleModel
  回落原值）/ budget（深等）/ budgetExhausted / tenantId / agentId / agentKey / agentVersion /
  attribution / origin / contextOps 缺省一致。
- **kernel = 唯一白名单值差**：dsh 恒 "EXTERNAL"、native 恒 "NATIVE"（N5 已落线，真咬）；
  断言两臂值各为锚定字面量 **且其余字段零值差**（差集恰 = {kernel}，反咬白名单不膨胀）。
- **native 迭代锚**：native 臂 iterations 按语料声明逐轮锚定（轮数 + 每轮 toolCalls 的
  toolName/outcome 序列 + load_skill input 深等）；dsh 臂 iterations 锚 = W9-full 帧流骨架
  （固有不对称 #4 已销 + #10 部分销：step 分组每 LLM 轮一迭代（含空轮，native 同粒度）+ 剧本
  非 meta 调用逐轮对点 + outcome 词表四态（OK/DENIED/ERROR/BUDGET_EXCEEDED——侧表命中支
  有源；本语料 meta-only 侧表恒空，值面恒 OK/ERROR，锚值不变）+ toolCallId tc_ 形态许可
  （命中支 tc_/未命中支帧 callId 原值；结构齿：DENIED/BUDGET_EXCEEDED 唯侧表可产 ⇒ 该两态
  必 tc_ 形态）+ durationMs 非负形态锚；零 spawn 任务恒 === [] 维持空壳诚实缺省）。
- **dsh stats 对齐**（固有不对称 #4 的另一半）：dsh 臂 token 账双载体同源——answer.stats
  与 run 记录同出一份帧流 fold。断言 `stats.tokenUsage` 逐桶等 = 语料声明的 stub 剧本
  usage 折出和（pi-ai 口径：prompt_cache_hit_tokens→cacheReadTokens，余入 uncachedInputTokens）、
  `stats.contextPressure.pressureTokens` = 末轮 prompt_tokens；run.totalInputTokens/
  totalOutputTokens 锚 = stats 对应桶**同源等值**（W9-lite 起，B11 验收判据；零 spawn 任务
  恒 0/0 维持）。native 臂 tokens 锚 = 100/50 × 剧本轮数（ScriptedLlmClient 固定账）。
  两臂 token 账**不互比**（物理不同源），各锚各的剧本。
- **budgetExhausted 分锚（G3 length 截断任务，W2 批3）**：finish_reason=length 场景两臂
  语义取向不同（§3 #9 缝观察）⇒ 该字段对 lengthDivergence 置位任务**不互比**，逐臂锚定
  （native 恒 false——loop.ts:1027 软收尾不走 finishRun(true)；dsh = 语料声明 true），
  scalar 尾其余字段照常逐值等——先例即上方 token 账「两臂不互比，各锚各的剧本」。
  全局白名单零膨胀：仅语料显式置位的任务走分锚，其余任务差集恰 = {kernel} 不变。
- 时间量（stats.sessionStats 的 llmMs/ttftMs/decodeMs 等）为墙钟，只核非负数值形态，
  不进字节断言（A5 确定性同样豁免）。

### A5 · 确定性
A5 子集（语料声明 8 条：每类至少一 + 长上下文 + 多轮 + provenance + 空块混排 + structured）同臂连跑两遍，
四面产物过**同一比对器同臂变体**（kernel 期望同值、其余同口径）必须全绿——
证明比对器不把噪声当差集。

## 3. 固有不对称登记（D-7 对齐，不冒充对称）
1. native 无 ruleBindings PRE_CHECK 执行点 ⇒ A2 只断言最终文案 + 两臂各自
   真强制证据，强制点位置不进断言。POST_CHECK 外挂差已销账（WO-DSH-PROD-READY W1：
   双臂共用 engine 出口 applyPostChecks 闭包，evidence 2b 作废）。
2. skill precondition 预检在分叉前 ⇒ deny_prefork 类 dsh 臂零 spawn（反向哨兵），kernel 为 flag 态值。
3. 两臂工具集物理不同（dsh meta-only vs native builtin）⇒ 语料两臂同用 meta 剧本保 parity；
   真工具对账物理不可达，L1 不声明该覆盖。
4. **【已销账·W9-full 2026-08-22】** dsh 臂审计记录为空壳（iterations []、tokens 0/0）⇒
   native 迭代锚 + dsh stats 对齐代之，两臂 token/迭代不互比。销账路径：W9-lite 帧流骨架
   （iterations/tokens 回填）→ W9-full 侧表合流（四态+tc_+宿主 durationMs）→ A4 单翻落线。
   「两臂 token/迭代不互比」维持——物理不同源各锚各的剧本，是口径选择不是不对称。
   **审计行维度扩锚（W5 块3，A4b）**：native 臂每轮 load_skill
   落一行 toolCalls 审计（loop.ts:731），dsh 臂恒零行（reassemble 纯重组装零 IO）——
   该不对称从「登记」升级为「锚」：driver A4b 断言 native 行数 == 剧本 load_skill
   tool_use 数且逐行 toolName/outcome/input 深等、dsh 臂 `toEqual([])`、deny_prefork 类
   两臂同零。双向反咬：dsh 臂若开始写审计行 = 未登记的行为漂移 ⇒ 红；native 臂若丢行
   = 审计丢失 ⇒ 红。entitlement 拒证时序同此口径：同一 agent 配置下两臂拒绝点位
   逐字节同码（A2 强制点），kernel 字段值差仍是唯一白名单差（A4 先例）。
   **（W9-lite 加注 2026-08-21：W9-lite 起 iterations/tokens 有骨架——iterations 按 step
   分组（team-lead 裁决②：native 迭代粒度 = 每 LLM 轮 = step；turn 恒 1 时 turn 分组恒产
   单迭代、无 parity 价值），每 LLM 轮一迭代含空 step 轮（对位 native loop.ts:1041/:1083
   空轮形态），index 0 基顺编号对位 native index=i；outcome 两态（OK/ERROR）+ 推导
   durationMs（tool/call↔tool/result 帧 time 差，配对键 turn-step-callId）+ run.total*
   回填帧流 usage 折出和（B11 同源等值入锚：run.total* === answer.stats.tokenUsage 对应桶）。
   A4 锚路径两步走——**空壳锚 → 骨架锚（W9-lite 本步）→ 真对账（W9-full 单翻）**：
   本步只把 dsh 臂每臂锚定值从空壳翻成骨架，跨臂互比结构未动（scalarTail 差集仍恰 =
   {kernel}），复验不得把骨架锚误判为已提前翻成真对账。四态 + tc_ 合流 + A4 双臂互比
   待 W9-full 一次翻。空壳口径仅余零 spawn 早退路（deny_prefork 类）。A4b 审计行锚与
   本骨架正交：骨架进 run.iterations（记录内字段），审计行 = 宿主 tool_calls 表（IO 面），
   W9-lite 仍零行——A4b「dsh 臂若开始写审计行 = 红」反咬维持，行写入属 W8主/W9-full。）**
   **（W8主 落线加注 2026-08-21：反向通道落线后 dsh 臂真调 BUILTIN 反向工具即落宿主
   审计行——dualrun50 语料 meta 剧本声明 query_objects 但从不真调 ⇒ 语料面 dsh 臂仍恒零行，
   A4b 反咬维持有效；未来语料引入真反向调用时 A4b 须按本登记翻锚。）**
   **（W9-full 销账加注 2026-08-22：空壳本体已销（见条首）。A4b 审计行维度**不随本条销账**——
   语料面 dsh 臂仍恒零行，「dsh 臂若开始写审计行 = 红」反咬维持有效，翻锚时点同 W8主 加注。）**
5. **缝观察（denied final_answer 的 blocks 仍上 answer 面）**：dsh 帧流 tool/call 在派发前记录
   （agent-loop lib/index.js:191 appendToolCall 在派发 :196 之前），pre-execute deny 不抹帧；reassemble collectToolCalls 不滤成败
   ⇒ 被拒 final_answer 的 blocks 仍成 answer。deny 的执行证据只能在 wire/帧面断言，answer 面
   不体现 deny。本层如实登记，不修缝（L1 是测试层；若评审裁定这是缺陷，另立 WO）。
6. runPathB 不过分叉（蓝图 evidence 1）⇒ 本层驱动只走 runRegisteredAgent。
7. 角色路（runRolePathB）/场景路（runSceneAgent）STALL_LOOP 两条语料槽（跨单回执）：
   agent_degraded 发射缝已落线（886c436a7，发射点 :2182/:2433/:2694；发射点在分叉后编排层
   共享码，两臂对称经过——W5 块4 实证：runRolePathB :2406 / runSceneAgent :2669 同走
   engine.runRegisteredAgent 过分叉，「两臂对称性不适用（不过分叉）」预设不成立；
   runPathB :2027 直调 runAgentLoop 不过分叉，#6 登记维持）。**覆盖缺口非发射缝** =
   ①编排层驱动级缺：dualrun50 直驱 runRegisteredAgent，捕获不到编排层发射的 agent_degraded；
   ②STALL_LOOP 确定性触发通道缺：dsh 臂须 watchdog 真 cancel 落帧，语料面无确定性通道。
   team-lead 2026-08-21 裁决（W5 块4）：gated 槽**维持不解**且**不建编排层双跑驱动级**——
   a. STALL_LOOP 触发无确定性通道，建驱动级也得先造新观测缝，属新增观测面（撞冻结扩面禁令）；
   b. 两臂对称性由「发射点在分叉后共享码」码结构论证 + L4/L6 真跳层覆盖，登记即够。
   ⇒ 语料维持 gated 槽（`GATED_SLOTS`），driver 鸣报 skipped，不冒充覆盖；
   **转 W7 输入**：灰度文档须载明「degraded 事件面 parity = 码对称论证，非双跑实证」。
8. **缝观察（纯空 stop 的 outcome 分歧；已裁决·不判缺陷，不进断言，W2 批1 实证）**：native 臂
   纯空文本轮走 `lastText || "（探索模式未能产出回答）"` 软收尾 ⇒ outcome ANSWERED；
   dsh 臂 pi-ai 适配器对「stop + 零内容块」判 EMPTY_RESPONSE 错误
   （dsh-llm-pi-ai/lib/index.js mapStopReason：`message.content.length === 0` ⇒ kind:error，
   注释自述「空消息会让 turn 无可行动内容静默终结，故归类为可重试失败」），
   turn/end reason=error ⇒ reassemble outcome FAILED（answer 块面巧合同形——兜底文案
   两臂逐字同——但 outcome 与 run 记录分歧）。W2 批1 dr50-ca 故取空白串 `" "` 形态
   （适配器侧合法内容块，两臂 ANSWERED 逐字节可账）。
   **team-lead 判词（2026-08-20）：缝观察，不判缺陷、不动码**——①字面零内容 stop 是
   provider 病态响应，harness 诚实判失败、native 兜底放行，两个方向都站得住，
   「过度防卫 vs 过宽」是设计取向差不是对错差；②dr50-by 已覆盖 kimi 系真实吐空块形态
   （blocks:[] 是实证的，零内容 stop 目前无真跳证据）；③动哪一侧都要改上游 vendor lib
   或 native 宽限，不成比例；④若后续 L2/L6 真跳证据显示真 provider 真撞此形态，再翻案。
9. **缝观察（finish_reason=length 截断的双臂取向差；已裁决·native 不修，W2 批3 dr50-ch 实证钉死）**：
   native 臂 stopReason≠"tool_use" 一律 `degrade("ANSWERED")` 软收尾（loop.ts:1027 唯一判据，
   全文无 length/max_tokens 分支；连生产适配器 openai.ts:283 也把 length 折成 end_turn，
   anthropic.ts:199 逐字透传 "max_tokens" 但 loop 同样不认）；dsh 臂 pi-ai mapStopReason
   length⇒max-tokens ⇒ reassemble outcome BUDGET_EXHAUSTED + degraded{BUDGET_EXHAUSTED} +
   诚实摘要头 + run.budgetExhausted=true。native 宽容放行截断文本 vs dsh 诚实判预算耗尽 =
   设计取向差，不是对错差。**裁决史**：批1探明差异时原判「修 dsh 对齐 native」——基于
   「native 有 budgetExhausted 语义」的前提；批3读码证前提倒置（语义缺失在 native 侧，
   dsh 反而是带语义更多的一臂），team-lead 2026-08-21 推翻重判，native 不修三理由：
   a. 换心不换身（native loop 是壳，本战役边界不动它）；b. 生产适配器折叠使 loop 加 length
   分支对 OpenAI 路天然死代码、只有 anthropic 路能到——半残机制；c. 改 native = 全 agent
   （非 DSH 范围）行为变更，属仓主级产品裁决——若仓主要 native 诚实截断语义，另立 WO。
   ⇒ 登记缝观察；断言走 §2 A1 分锚 + A4 budgetExhausted 分锚 + outcome/degraded 逐臂锚
   （dr50-ch，双臂不互比）。
   **dsh 自体不一致两件判缺陷、已修**（dsh 对齐 dsh 自己的 outcome，不涉 native）：
   ① engine DSH 出口 run 记录恒 emptyAgentRunRecord（budgetExhausted 恒 false）⇒ dsh 自己的
   outcome=BUDGET_EXHAUSTED 语义在出口被丢、审计记录自体矛盾（管理台可见）——修：
   outcome=BUDGET_EXHAUSTED ⇒ budgetExhausted=true（对位 loop.ts:659 finishRun 同口径）；
   ② reassemble max-tokens 路裸文本、无诚实摘要头（stall 路有模板）——修：镜像 stall 路
   补「[预算耗尽·诚实摘要] ⚠️ 模型输出触长度上限被截断——…」头块（对位 loop.ts:620-634
   有界终止必带诚实前缀约定；语料锚 = corpus.ts LENGTH_TRUNCATION_HEADER 逐字）。
   钉死位：dr50-ch 双臂分锚 + reassemble 探针 max-tokens 头逐字锚 + mutation 双招反证
   （摘 engine budgetExhausted 赋值 ⇒ 分锚红；摘 reassemble 摘要头 ⇒ A1 分锚红 + 探针红）。
10. **MCP 调用在 dsh 臂不过宿主（W9-lite 观测面骨架的物理上限，2026-08-21 登记）**：
   dsh 臂 MCP 工具由 harness 子进程世界直连执行（不过宿主 executor；W8主 HTTP 带外
   tool-execute 反向通道在途）⇒ 调用无 tc_ 形态 id、无宿主 IAM/DENIED 决策记录；
   治理面 deny（允许表/ruleBindings 裁决）落到帧面只是 isError=true 的 tool/result
   （mcp-forward 缝 A4 实证：表外调用 2ms ERROR、server 零到达）。
   ⇒ W9-lite run.iterations 骨架的 outcome 只有 OK/ERROR **两态**（DENIED/BUDGET_EXCEEDED
   帧流无源，不硬造）；toolCallId = dsh 帧 callId 原值（非 tc_ 形态）；durationMs =
   call/result 帧 time 差推导值（墙钟，只锚非负形态）。四态 + tc_ 合流 + A4 双臂互比
   单翻待 W9-full。**（W8主 落线加注 2026-08-21：反向通道已落线——dsh 臂 scope 白名单内
   BUILTIN 28 工具经宿主 GuardedToolExecutor 执行 ⇒ OK/DENIED/ERROR/BUDGET_EXCEEDED 四态 +
   tc_ 形态 id 在宿主 tool_calls 表有源（dsh-engine-tool-bridge.seam A1-A9 钉死）；MCP 工具
   仍不过宿主，本条主体维持。四态 + tc_ 合流进 run.iterations 骨架 + A4 双臂互比仍待
   W9-full 一次翻，本条不销。）**
   **（W9-full 部分销加注 2026-08-22：BUILTIN 维度已销——hostToolCalls 侧表合流落线
   （engine 端点逐调用累积 {outcome/toolCallId/durationMs}，键 = 帧 callId 原值直通；
   reassemble 命中支翻四态 + tc_ 形态 + 宿主实测 durationMs，未命中支维持帧两态推导；
   reassemble 单测 ⑨-⑫ 钉死 + mutation 双招反证：摘侧表合流⇒红、摘 tc_ 换形⇒红），
   A4 单翻同步落线（词表四态 + tc_ 许可 + 结构齿）。MCP 维度维持：MCP/meta 工具不过宿主
   ⇒ 未命中支两态（OK/ERROR + 帧 callId 原值）是物理上限，不硬造。本条由「不销」改
   「部分销」：BUILTIN 已销 / MCP 维持。）**
11. **B5 并行到达序（W8主 落线回填——ROLLOUT §5 W-1 文件锚）**：W8主 起 dsh 臂 BUILTIN
   工具调用经 HTTP 带外 tool-execute 反向通道进宿主 GuardedToolExecutor——并行调用按网络
   到达序各自过预算门 tryConsume（`apps/agentcore/src/server.ts` /b/v1/dsh/tool-execute
   端点 → `engine.ts` dshToolExecuteRuns 登记的 :491 同实例 executor），到达序不确定 ⇒
   并行预算耗尽场景谁先撞线不可账。dualrun 语料只声明串行预算场景，本差不进断言；
   「并行工具调用到达序不一致」类工单走 ROLLOUT §5 W-1 白名单，排序之外的**内容**差
   不许借本条目放行。
   **（W9-full 加注 2026-08-22：反向通道 callId 来源变更——tool-bridge 废 dshcall_ 自铸，
   改帧 callId 原值直通（platform-world execute 上行 exec.callId，team-lead 2026-08-22 裁决，
   侧表关联白得）；409 语义方向不变、内涵由「重放拒」扩为「重号拒」——provider 重号 ⇒
   409 ⇒ ERROR 包络 fail-closed（已预批）。夹具层配套：共享 stub 多轮剧本 id 铸 call_<seq>
   唯一化（仿真度对位真 provider 每轮唯一 block.id；单调用剧本恒 call_1 逐字节兼容，
   B7 重号撞 409 根因修复）。到达序不确定性登记维持不变。）**
12. **孤儿审计行合法（W8主 反向通道双档超时的构造面）**：桥本地 fetch 放弃线
   （DSH_TOOL_EXEC_FETCH_TIMEOUT_MS）与宿主 per-call withTimeout（DSH_TOOL_EXEC_TIMEOUT_MS
   上行，端点再与预算剩余取 min）相互独立——桥先放弃**不取消**宿主 fastify handler ⇒
   帧面 ERROR（TOOL_EXECUTE_TIMEOUT）而宿主 tool_calls 表晚落 OK 行（孤儿行）。孤儿行是
   合法形态，不作对账差；工具结果事实源 = 宿主 tool_calls 表 ∪ 帧流，任一单面不完整。
   实证锚：dsh-engine-tool-bridge.seam B6（exec 3000ms / fetch 100ms / 宿主 400ms ⇒
   帧 ERROR ∧ 晚落 OK 行）。
13. **MCP 工具 description 前缀差（native 展示性修饰；已裁决·登记不修，W8副 侦察登记）**：
   native 臂 expandAgentTools 给 MCP 工具 description 加 `[MCP·外部] ` 前缀
   （engine.ts:392）；dsh 臂 mcp-client-tenant 注册裸 description
   （mcp-client-tenant.mjs:175）⇒ 两臂 tools 面 description 字节差（工具名集合、
   名称路由、执行面均无差）。
   **team-lead 判词（2026-08-21）：登记不修**——①前缀是 native 侧模型可见面的
   展示性修饰，不影响名称路由与执行；②抹平只能二选一：native 摘前缀（动 native
   代码，越出 W8副 边界）或 dsh 侧 vendor 层复刻前缀（双源漂移风险，与截断逻辑裁
   同源复用同理）——两向不成比例；③W8副 parity 语料按 name-set 对拍，不咬
   description 字节。**任何未来做 tools 面字节 parity 的语料必须先裁决此条。**
   （落地注：判词一字未改；两处 file:line 按落线时点实况由 :382/:170 校正为
   :392/:175——草稿定稿后 W8主/W9-full/W8副 本体的落码使行号漂移，REC 行号扫除
   纪律优先于字面冻结。）
14. **W8副 MCP 可见性 name-set parity 的豁免与边界（dr50-cl 对拍口径登记，2026-08-23）**：
   dr50-cl 两臂模型可见工具**名集合**对拍（不咬 description 字节——#13），比对前
   剥除以下**声明制**豁免件（CorpusMcp.dshExtraTools / nativeExtraTools，均带反向钉：
   豁免件消失即红，防豁免掩盖真实漂移）：
   ① **echo_tool（dsh 臂 poc 夹具件）**：cordis.poc.yml echo-tool 插件常量面，
   生产 cordis.yml 无、native 臂无——预存档差，非本 WO 面。
   ② **load_skill（native 臂固有额外面，dr50-cl 首跑实证红出）**：native 注册 agent 路
   engine.ts:811 `loadSkillEnabled: true` **无条件**把 load_skill 挂上模型面（零技能
   也挂，调用期 resolveSkill 才落空）；dsh 路 setup-spec.ts:251 仅在 skills 非空时把
   load_skill 进 scoped 允许表 ⇒ 零技能任务两臂差一件。属元工具策略预存不对称，
   不在 W8副 toolFilter 映射范围；修 dsh 侧（loopMetaTools 无条件加）会破 A6 形态B
   「ref 无 toolFilter ⇒ setup 帧逐字节旧行为」锚，登记不修（若评审裁定对齐，另立 WO）。
   ③ **exotic 裸名（含 `.` 等非法字符）剔除同向不咬**：toolFilter 未含 exotic 名时，
   native 臂由宿主 expandAgentTools 收窄剔除、dsh 臂由 mcp-client-tenant 注册期
   fail-closed 丢弃（publicToolName 规范化名 ≠ contracts 裸拼接表项）——剔除发生在
   不同层但**方向相同**，name-set 无差；toolFilter 若显式含 exotic 裸名则两臂分歧
   （native 按裸拼接命中放行、dsh 规范化后失配丢弃），该形态不进语料（既知缝，
   真 provider 含非法字符工具名的工具面 parity 另立裁决）。
   锚收窄真发生的防假绿断言：mcp__ 前缀子集恰等语料声明的滤后留存名（dr50-cl =
   仅 `mcp__dr50cl__echo`）。

## 4. 语料构成（64 条 + 2 gated）
- 内容源：20 条 = SCENARIO_CATALOG triggerQuestion（执行通道不借 evals——蓝图 evidence 5）；
  43 条合成：四维造（长度：短问句 / ≥4KB 长上下文；工具轮：0/1/3 轮 load_skill；
  多轮：1/2/5 次 LLM 往返；拒绝混合：deny_pre 前置 / deny_mid 中段 / deny_all 全 deny /
  deny_prefork 分叉前）+ W2 批1 扩面 6 条：G1 EMPTY 空块类 4（dr50-by 空 blocks /
  dr50-bz 空 markdown 块 / dr50-ca 空白软收尾 / dr50-cb 空块混排）+ G4 超长输出 2
  （dr50-cc ≥32KB markdown 块 / dr50-cd ≥32KB 软收尾长文——确定性填充、零裸数、携带 marker）
  + W2 批2 扩面 3 条：G2 expectsSchema 结构化（dr50-ce 简单 schema valid /
  dr50-cf 嵌套 schema valid / dr50-cg invalid→valid 拒后收敛——dsh 剧本末轮文本
  恒写固定文案 STRUCTURED_ANSWER_TEXT 单源，invalid 形态锚 A1b 修复后 fail-closed 口径）
  + W2 批3 扩面 1 条：G3 finish_reason=length 截断（dr50-ch 双臂分锚——§3 #9 设计取向差
  登记 + dsh 自体修复两件钉死；stub 夹具增 finishReason 可选键，缺省 "stop" 字节兼容）
  + W5 扩面 3 条：dr50-ci provenance 畸形拒后收敛（final_answer 入参严校验通道双臂同形态）、
  dr50-cj writeMode 缺 action_draft 拒后收敛（语料声明 sideEffect=WRITE ⇒ driver skillDef
  治理位透传）、dr50-ck reasoning 流（stub reasoning 通道 ⇒ dsh 臂 agent_think 族真触发，
  A3c 矩阵精确族集锚）+ W8副 扩面 1 条：dr50-cl MCP 可见性 name-set parity
  （CorpusMcp 声明面：两臂同 seed 三工具表 + toolFilter 滤一留一；豁免与边界 §3 #14，
  不咬 description 字节 §3 #13）。
- 每条 = 数据对 {native 臂 mock 队列剧本，dsh 臂 stub 剧本（+PLATFORM_GOV_DENY 声明），
  期望值声明（answer / native 迭代锚 / native token 锚 / dsh stats 锚 / deny wire 证据位 /
  EMPTY 豁免位 / expectsSchema 与 structured 锚 / lengthDivergence 分锚）}。
- 自检闸（driver 首条 it）：总数 64、deny ≥10、四维覆盖全到位、A5 子集 ∈ 语料、
  EMPTY 豁免位双恰（豁免 ⇔ 期望答案无 marker；豁免任务 prompt 必含 id）、gated 槽在册、
  mcp 声明任务恰 1 条（dr50-cl，§3 #14）。
