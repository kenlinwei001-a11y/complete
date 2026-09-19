# PRD · 工业级 AI+推演系统（2026-09-18）

> 仓主令（原文）：「按照工业级系统的标准，输出PRD」。
>
> 本文不是从架构草图长出来的，是从**三轮实测**长出来的：
> ① 统一推演控制台 E2E（`PRD-sim-console-e2e-remediation.md`，下称「整改 PRD」，R1–R7 照旧有效）；
> ② 子系统亲测（`evidence/sim-subsystem-probe/REPORT.md`，亲手施扰、双臂对照）；
> ③ 两轮根因复验教训（信注释病 / 链路边界≠系统边界 / grep 不如施扰）。
> 全部「现状」断言都可沿证据索引复算，引用不复制。

---

## 0. 定义与毕业判据

**工业级 AI+推演系统** = 编排可审计 · 推演可证伪 · 数值可复现 · 降级必显式 · 规模有闸。
分工铁律（沿用设计裁决）：**引擎负责真，求解器负责全，agent 负责问和译，人负责断。LLM 永不进演化层。**
（agent 的目标运行内核 = dsh，见 §2.1；原生 loop 仅过渡态。）
⚠ 边界澄清（2026-09-19 仓主反馈收编）：禁的是**不可复现、不可审计的生成**，不是**从数据拟合的模型** ——
拟合出的响应面同数据同参数 ⇒ 同输出（R6 成立）、系数有出处（G2 成立）、可对照实验证伪（T1 成立），
与手写传导边**双臂并存**（B7）。「演化层 = 手写规则」是要拆除的错误二分。

毕业判据（全部可度量，任一条不满足不毕业）：

| # | 判据 | 测量法 |
|---|---|---|
| G1 | agent 编排的每次推演 100% 带 `disclosure.plan`（无计划不执行） | 审计抽样 + 门 |
| G2 | 屏上与 agent 引用的数值 100% 带出处（traceId/ruleKey/cellId/solverRunId）；编造注入测试全红 | 机械审计器 |
| G3 | 敞口类读数 100% 带分布档（P50/P90）或 `deterministic-only` 显式标注 | 契约门 |
| G4 | 每条受阻环节带 `causingPerturbations[]`（无归因维 ⇒ 门红） | seam 测试 |
| G5 | agent/人/种子/演习施扰 100% 分账可查（`proposedBy`） | 契约门 + 审计 |
| G6 | 校准 `run paired>0`（实料，非种子），回测门进 CI | CI 记录 |
| G7 | 整改 PRD R1–R7 清账；未知参数拒绝纪律全平台统一 | 整改 PRD 验收 |
| G8 | NFR 表达标（§4，含 10 万节点世界 3 拍 ≤60s） | 压测报告 |
| G9 | 预言层：真决策输入 ⇒ 60 天结果量纲差分轨迹逐格可复算；输出带 provenance 分级（外推/仿真/校准预测），级别虚标 ⇒ 门红 | T1+T5 |

### 0.1 「达到 AI 推演系统」的定义边界（仓主问「开发后就可以达到吗」的正面回答）

**G1–G8 全绿 = 机制层工业级**：agent 能检索、规划、施扰、演化、归因、报告，每步可审计、可证伪、
可复现、降级必显式。这一层本 PRD 负全责。

**以下四层决定「预言得准不准」，本 PRD 明文不承诺**（成熟路径各不同，不许拿机制绿冒充预言准）：

| 层 | 不承诺 | 为什么 / 靠什么成熟 |
|---|---|---|
| 世界模型保真度 | **已改判：有收敛机制、待实料**（原判「不承诺」，2026-09-19 仓主反馈收编——改 1/2/3 落地后结构上有变准路径） | 收敛机制 = B7 拟合双臂 + C5 结构校准 + C6 经验库（全在 M6）；收敛速度取决于实料；**企业真实数据接入仍是部署计划** |
| 生态丰富度 | 对抗生态的真实性 | B3 交付框架 + 第二个物种（选型归产品裁决）；供应商/银行/物流/竞对逐物种积累，无捷径 |
| UQ 口径 | 校准概率 | B1 分布档 = 种子扰动档（诚实但有界）；真校准概率待 C 流实料成熟后另立专项 |
| 洞察力 | agent 提出高价值假设的能力 | 引用绑定保证「说的都有据」，不保证「问得都值钱」；⑥环只建脚手架（C4 覆盖图喂养），洞察质量不设假度量 |

外部依赖三样（登记不拥有）：dsh 融合线三前置销账（R-7）· 企业真实数据接入 · LLM 预算与 key。
**底线纪律**：实料不到 ⇒ G6 拒绝毕业；以上四层任一未成熟 ⇒ 系统如实标注，不许装成已达到。

**仓主第二问（2026-09-19）：「这份 PRD 是否只是工业级求解器系统，而不是 AI 推演系统？」——是，代码级结论。**
原 M1–M5 工业级化的是**求解器阵列 + what-if 传导机 + agent 编排 + 审计诚实**——那是「诊断与反事实簿记」，
不是「预言」。「预言层可信」（算得准真实经营、仿真决策后果）缺四层能力，代码级证据与补法见 §3 WS-F
（F1–F5）与**学习簇**（A10 假设搜索 / A11 解释切片 / B7 代理模型 / C5 结构校准 / C6 经验库——
仓主反馈改 1–5 收编），统一 M6 毕业，G9 判据。WS-F 落地前，本系统对预言类问题的唯一诚实回答是
「无法回答」——F5 纪律条把这条钉死，防「拿静态读数穿预言衣服」。

---

## 1. 现状盘点（实测基线，三档标注）

### 1.1 已验证资产

**E2E 实测过（控制台主链）**：计算范围 GLOBAL 未裁剪（12,499节点/13,533边 0丢弃 = 图物化完整，**不是切片能力**；
裁剪机制 `scopePropagationGraph` 在且 LOCAL 路有 seam 门，控制台该次 session 未设 scope ⇒ 契约缺省 GLOBAL——
⑤⑥ 环需要的 ≤20 节点解释切片见 A11）· 规则（声明49/触发48，全内联系数）·
约束（stateVarBounds 33 + saturations 40 + cadenceSkipped 4）· 求解器×4（chain_impediments 经 OBO /
bottleneck_matrix / mitigation_select / chain_loss_attribution）· 披露五段 timings · 暂停 409 真冻结 ·
verdict 3,580 格与独立差分逐字一致 · 扰动目录 12 类 landable 门 + 真候选列表。

**亲手施扰验证过（本轮）**：drill 演习（对路事件真打 254/6,363 格、一事件真调 3 求解器、错配事件诚实记
「未能评估」、只读不改世界线、fork 诚实 null）· counterfactual 产品级双臂（关边 564 格差 +
firedInBaseline 诚实位 + 未知键 400 拒跑）· 对抗方还手（开关真控：关=0/开=119 行，延迟 1 拍在途入账，
力度按敞口拉开）· 校准管线（GET×3 + runAll 真跑，`paired:0` 如实回零）· 场景目录 20 卡带 presetContext ·
base_capacity_outlook 逐行 provenance（实测/派生带 drill 出处）。

**代码存在、质量未验**：DRIL 资源注册表（59 solver/94 object_type/813 field，QA 线已接活能力地图两段注入）·
skill 图编排器（分层并发唯一化、数据沿边强制、StepAudit）· LLM 多 provider 路由（anthropic/openai/
openai_compatible + 租户配置）· m11-calibration 算法族（EMA/quantile/replayAttribution）·
enterpriseState.fork · C12→calibration.required 钩子。

### 1.2 已坐实缺口（亲测，非推断）

| # | 缺口 | 坐实方式 |
|---|---|---|
| H1 | **编排层缺席**：控制台求解器键硬编码、runM 五步焊死在前端、无计划披露载体、无 agent 预算概念 | 模块矩阵 agent/skill/LLM 三 ❌ + Console0828 硬编码 |
| H2 | **引擎级 UQ 缺席**：tick 塞 ensemble/seeds → 200 零回声静默吞 | S9 探针 |
| H3 | **扰动归因维缺席**：chain_impediments 按 scope 全扫，答不了「哪几条是本次扰动造成」 | 直调回包 56.5KB |
| H4 | **proposedBy 分账缺席**：PerturbationSchema 全字段无施加者 | sim.ts:1435-1452 |
| H5 | **ABM 种群=1**：行为体仅 Customer CUT_ORDER 一种，无生态框架 | 双臂 + 规则普查 |
| H6 | **拒绝纪律不一致**：counterfactual 未知键 400 vs tick 未知字段静默吞 | S4 vs S9 |
| H7 | **控制台诚实债 R1–R7**（含唯一真缺陷 timings 手搓） | 整改 PRD §2 |

### 1.3 验证纪律（本 PRD 每条验收的执行纪律，由来即三轮教训）

① 凡引用「产品自己的注释/屏上文案/种子数据」当结论，先对真回包/真日志验一把再引用；
② 存在性判断必须亲手施扰+双臂对照，禁止 grep 下单结论、禁止按名推断；
③ 每条需求配**对照实验验收**（铁律 1.5 判据一）+ 金丝雀 + 变异反证；
④ 卡住/降级/mock 只记录不绕行。

---

## 2. 目标态架构

```
① 立意[agent]    自然语言 → 形式化扰动/范围/时长（金标门度量，A8）
② 审查[规则]    landable 门 · 域表 · 冲突 · 会话状态机（确定性，现状已合格）
③ 演化[引擎]    手写传导边 ∥ 数据拟合代理模型（B7 双臂并存）· 逐拍传导 + 全披露 · ensemble（B1）· 外生过程账（F1）· 结果量纲恒等推导（F2）—— LLM 禁入（禁生成，不禁拟合）
④ 诊断[求解器]  卡在哪/为什么/怎么办 + 扰动归因维（B2）
⑤ 解读[agent]   只对披露事实说话，每数挂出处、继承最低 provenance 档（A7）
⑥ 新假设[agent] **自主假设搜索环（A10，P0 主环）**：预算内提出→推演→看结果→修正→再推演；人只在采纳处裁决（C4 覆盖图喂养、自主梯 §6 R-2）
贯穿：计划披露（A1）· 分账（A2）· 预算（A3）· 核对环金丝雀（A6）· skill 编排件（A5）
```

### 2.1 目标运行内核：DSH 即 agent（仓主 2026-09-18 明谕：「deepseek harness(DSH)是agent」）

分工铁律里「agent 负责问和译」的那个 agent，**目标运行内核 = 外部运行时 dsh（deepseek-harness，
被集成的外部产品，照实称呼；平台自有概念不用它命名）**。原生 `runAgentLoop` 是**过渡期脚手架 +
灰度回退路**，不是目标态。

| 内核 | 坐标 | 定位 |
|---|---|---|
| **dsh（目标内核）** | `packages/dsh-harness` + `apps/agentcore/src/dsh-runtime/`；分叉守卫 `engine.ts`（`agent.kernel==="EXTERNAL"` 优先，缺省回落 `DSH_HARNESS` env）；LLM 路由常量 `PRODUCTION_DSH_HARNESS_PROVIDER="platform"`；POC 6 提交 S0–S4/E1–E6 全绿（`REPORT-dsh-poc-s0.md`）；**自带全仓唯一的无条件数字红线硬闸**（`dsh-runtime/reassemble.ts` `NUMERIC_REDLINE_CODE`，`AUDIT-solver-arithmetic.md:182` 坐实）——A7 审计器的天然落点 | 毕业验收内核 |
| 原生 ReAct 循环（过渡） | `apps/agentcore/src/agent/loop.ts`；其升级规格 `docs/PRD-agent-react-harness.md`（全文 0 次提及 dsh，与 dsh 线是两条线，勿混） | 开发期验收脚手架 + 灰度秒级回退路（ROLLOUT 机制基础） |

**现状与桥（如实标注，不回避）**：

- **现状 = 休眠**：`DECISION-dsh-fusion.md` 裁决「代码可以并，flag 不能翻」——§3 三前置未销账前，
  任何部署面设 `DSH_HARNESS=1` 即红（D1 门）、入口唯一（D3）；`ROLLOUT-dsh-external-kernel.md`
  全部档位停 G0。因此本 PRD 已有亲测证据（loop.ts 循环 / 27 工具 / sim.commander 关态）**全部采自原生路**，
  一律标「过渡态」。
- **桥归融合线**：三前置销账与灰度推进是**外部依赖**（已有专线与裁决文档，本 PRD 不越俎派活）；
  销账后按 ROLLOUT 的 per-agent `kernel=EXTERNAL` 逐 agent 灰度，每 run 直读配置、秒级可退。
- **判级分两环境类**：**E-native**（`DSH_HARNESS=0` 或不设、agent 不设 `kernel`：开发期逐条需求验收用）
  与 **E-dsh**（销账后灰度租户 `kernel=EXTERNAL`）。**G1/G2/G5 的毕业测量必须在 E-dsh 采** ——
  E-native 证据只证「契约与链路对了」，不单独构成毕业依据；每件证据文件标注采集环境类。
- **A 流契约保持内核无关**：plan 披露 / 分账 / 预算 / 工具面定义在契约与 API 层（OBO、R4 模拟态），
  两核通用 —— 这让 M1（A1/A2/A3）不必等内核翻牌即可先行落地。

---

## 3. 功能需求（六工作流；每条：证据 → 需求 → 对照实验验收 → 依赖/优先级）

> 归属：涉 frontend-shell 的条目为禁碰区开账（D 流大半）；涉契约的走契约包评审；实施均另派 WO。

### WS-A · 编排层（把 QA 线的件接到推演线）

**A1（P0）计划披露契约 `SimPlanDisclosure`**
证据：H1。需求：disclosure 增加 plan 段 —— `{retrieved[], selected[], rationale, order, args[],
perStepVerification[], budget{declared,consumed}}`；无 plan 的编排执行被拒绝（不只是不记录）。
验收：跑一次 agent 编排的 what-if，plan 与 agentcore/datacore 双日志逐条对上；变异：删掉一步执行记录 ⇒ 门红。
依赖：契约包评审。

**A2（P0）扰动分账 `Perturbation.proposedBy`**
证据：H4。需求：`{kind: HUMAN|AGENT|SEED|DRILL, actorId, planId?}`；扰动列表/世界账按此过滤；
历史扰动迁移标 SEED/LEGACY。验收：agent 施的扰动与人施的在账上可分；G5 达标。
依赖：R2 租户账面评审。

**A3（P0）预算申报与运行时强制**
证据：H1 + shadow 段实测 11.1s/13s（成本大头）+ 500 闸先例。需求：plan 申报
`{ticks, solverCalls, worldCells, llmTokens}`，运行时照预算执行，超限即停并披露 `budgetExceeded`
（⛔ 不许静默截断）。验收：申报 1 拍跑 2 拍必被拦且披露；ensemble K 超预算 ⇒ 排队而非超发。

**A4（P1）推演资源入册（DRIL 投影扩展）**
证据：H1 + DRIL 实测规模（59/94/813）。需求：投影面加 perturbation-event / sim-session / datasource 三类；
资源 schema 加 `costHints / preconditions`；控制台求解器键改从注册表取（消灭 Console0828 硬编码字面量）。
验收：① `POST /b/v1/resources/search` 查「涨价」双命中扰动事件与求解器；
② grep 控制台 `chain_impediments` 字面量零命中（防回退门）；
③ **动态发现变异反证**：新注册一个求解器（或扰动事件种类），不改控制台/agent 一行代码 ⇒
下一次检索即可见且可调用（防 live-capability-map「59 在册、手写镜像只 19 可见」病灶复发——
「入册」不等于「被发现」，这条门度量的正是差集）；
④ 扰动事件条目必须带**候选获取路径**（argHints 指向 landable 候选端点，复用控制台 8/15/500/500 真候选那一路）
与 costHints/preconditions，三者任一为空 ⇒ 入册门红（⛔ 不许注册一个调不了的条目）。

**A5（P1）runM 五步下沉为发布 skill**
证据：H1 + skill-orchestrator 成熟度（分层并发唯一化、数据沿边强制、StepAudit）。需求：
「施扰→tick→world→diff→solver」编排为一条已发布 skill（`what-if-run`），控制台与 agent 共用同一执行体，
逐步 StepAudit。验收：同输入下控制台五步与 skill 执行逐字节一致；变异：控制台私留一套编排 ⇒ 门红。

**A6（P1）核对环金丝雀契约**
证据：探针第一击空世界事故（探针自身缺陷记录）+ 测试文件金丝雀范式。需求：编排每步回包做存在性校验
（候选>0、回包键齐、世界格数>0），失败记 `perStepVerification[i].failed` 并停止后续步（或走显式降级分支），
⛔ 不许静默换路。验收：杀掉一个 solver ⇒ plan 披露该步标 failed、后续步未执行、结论标降级。

**A7（P2）报告环引用绑定 + 机械审计器**
证据：堵点②「~」范式 + outlook 逐行 provenance 范式。需求：agent 叙事每个数值挂
`{traceId|ruleKey|cellId|solverRunId}`，自由文本只做连接词；引用不存在 ⇒ 机械审计器红；
provenance 档继承（引 ≈ 级数据 ⇒ 结论不许写「是」）。验收：注入一个编造数 ⇒ 审计器当场红；G2 达标。
**落点 = 目标内核的重装配层**：全仓唯一的无条件数字红线硬闸已在 `dsh-runtime/reassemble.ts`
（`NUMERIC_REDLINE_CODE`，`AUDIT-solver-arithmetic.md:182` 坐实）——机械审计器**在该层扩成全引用绑定**
（接不重造，§7 同纪律）；原生过渡路不另建第三套，其叙事证据只作开发期参考，G2 毕业测量在 E-dsh 采（§2.1）。

**A8（P2）意图编译金标门**
证据：live-capability-map 金标问句范式（Top-1 即期望 solver）。需求：自然语言→（扰动事件,落点,幅度,时长,求解器）
编译的金标集回归门；误编译（错事件种类/错落点类型）零容忍。验收：金标集 Top-1 ≥门槛且误编译=0；
新增事件种类 ⇒ 金标集必须同批扩（门）。

**A9（P1）ReAct 工具面：全资源可调、工具与注册表同源、施扰必须走账**
证据（本轮亲核）：ReAct 循环在（`agent/loop.ts`：迭代 toolCalls + 停滞检测）；executor 27 工具
（本体/对象/切片/invoke_solver 全量按权限/evaluate_rules/知识/时序/create_action_draft）；
sim 指挥台四工具（sim_init/sim_tick/sim_world/sim_certify，OBO+R4 模拟态）被 `sim.commander`
特性键关着（demo 实测 OFF，`tools/registry.ts:344`「关→工具不存在」R3 暗发）；
⛔ **无施扰工具**（sim_act/sim_drill/sim_counterfactual grep 零命中——推演第一环对 agent 是断的）；
⛔ skill 不能作为工具被 loop 调用；⚠ sim_init 的 `baseSnapshot` 入参可绕开扰动账/landable 门（后门形态）。
需求：
① **工具面与 DRIL 注册表同源**（tools/registry 从注册表投影，消灭「注册表一本账、工具面另一本账」）；
② sim 工具族补全：`sim_act`（**必须走 /perturbations 账 + proposedBy=AGENT + landable 门**，
⛔ 不许直改状态）、`sim_drill`、`sim_counterfactual`（沿用 OBO + R4 模拟态纪律）；
③ `run_skill` 工具化（消费 A5 的发布 skill，调用进 plan 披露）；
④ `sim.commander` 上线判据 = **A1/A2/A3 合并之后**（M1 出口联动：无计划披露/分账/预算，不开工具），
且**生产开通随目标内核（dsh）灰度**（§2.1：三前置销账前 E-native 只作验收脚手架，开通即标「过渡态」）；
⑤ 堵后门：agent 身份的 `sim_init` 禁传 `baseSnapshot`（或强制标 `derived-from-agent` 审计）；
⑥ `propose_model_change`（仓主反馈改 4）：agent 可提出「这里应有一条边」「这个系数不对」——
走 S2 Action 审批（既有 draft→review→publish 流，不重造），**必须附对照实验证据**（T1 双臂数据），人裁决；
规则/约束写侧保持提案制，不开直写后门。**这是「AI 参与推演」与「AI 操作推演器」的分界线。**
验收（对照实验）：开通 sim.commander 后 agent ReAct 跑「铝箔+20% 会怎样」⇒ plan 披露显示
discover→sim_init→sim_act（扰动账 proposedBy=AGENT）→sim_tick→invoke_solver 全链；
关 sim.commander ⇒ 工具列表零 sim_*（R3 暗发门）；agent 试直传 baseSnapshot ⇒ 被拒并披露。

**A10（P0）假设搜索环：agent 自主决定「推演什么」**
证据：仓主反馈改 2——今天的系统里推演什么 100% 由人指定，⑥环只是 P2 脚手架（C4），§0.1 原写
「洞察力不设度量」等于放弃 AI 推演最核心的能力。需求：预算内（A3 同闸）自主
「提出→推演→看结果→修正→再推演」，人只在采纳处裁决；目标函数可度量：**单位预算推翻的先验条数** +
**命中的高敞口未覆盖场景数**（C4 覆盖图正好是输入）。
⚠ 反 Goodhart 纪律（审核方加注）：「推翻先验」必须锚在**场景敞口**上（推翻的是挂得到金额的先验），
不许靠挑琐碎先验刷数；验收用**埋真法**（在种子世界里埋一条 agent 不知道的结构，看它能否发现），
不许拿它已见过的世界当考题。验收（T1 双臂）：同预算开环臂 vs 关环臂 ⇒ 开环臂发现的埋真结构
显著更多，否则这一环没价值（装饰即红）。依赖：A1/A2/A3（计划/分账/预算）、C4（覆盖图）。

**A11（P0）解释切片 ≤20 节点（⑤⑥ 环的前置）**
证据：仓主亲核 + 审核方复核成立（`contracts/sim.ts:1112` `resolveSimScope` 缺省即 GLOBAL；
裁剪点 `propagation-inputs.ts` 的 `scopePropagationGraph` 工作得很细，分摊权重注释专门声明吃已裁剪的图）——
§1.1 原标的「本体切片 0 丢弃」**不是切片是全世界未裁剪**；12,499 节点喂不进任何模型，
⑤解读与⑥假设两环都卡在这。需求：从 trace 反向收敛出「本次结论依赖的 ≤20 节点解释切片」，
带 coverage 截断账本（截掉多少、为什么），纯函数保 R6。
（注：仓主报已写 explain-slice 骨架 WIP 未验；**本 worktree 未见该文件**（git status 仅 PRD 一处改动），
落单时先对齐其位置，以其为起点不另起炉灶。）
验收：一次真推演 ⇒ 解释切片 ≤20 节点且能沿它复算结论主数；截断账本与全图差分一致。

### WS-B · 推演科学

**B1（P1）引擎级 UQ：确定性 ensemble**
证据：H2。需求：tick/drill 接 `ensemble:{seeds:[…]}`（seed 名单显式入参并进 disclosure ⇒ R6 保持）；
占位/采样类不确定性按 seed 扰动，输出按格聚合 `{p50,p90,min,max}`；单值读数必须标 `deterministic-only`。
验收：同 seed 名单重跑字节一致；异名单产出异分布；G3 达标；变异：某 seed 未入 disclosure ⇒ 门红。
依赖：A3（ensemble 成本闸）。

**B2（P1）扰动归因维 `causingPerturbations[]`**
证据：H3 + counterfactual 双臂已产品化（复用其原语）。需求：chain_impediments 对每条环节附归因集
（逐扰动关臂现算；基线扫出者标 `baseline:true`）。验收：施 2 件已知扰动，归因集与「单独施扰臂」实测一致；
⛔ 不许用相关代替因果（归因必须出自关臂差分，相关排序 ⇒ 门红）。

**B3（P2）ABM 生态框架**
证据：H5 + reaction spec 已在规则内（tolerance/move/selectedBy/clamp/delay）。需求：行为体注册表
（规格数据驱动，新增 actor 零引擎改动）、每 actor 独立开关（沿用 adversary 特性键范式）、
生态预算（总还手力度上限）+ 振荡检测（N 拍压力振荡 ⇒ 报警不静默）。第二个物种选型由产品裁决
（候选：供应商延交反击 / 银行抽贷 / 客户改址）。验收：新增 actor 规格不改引擎代码即生效，双臂验证开关真控；
构造振荡场景 ⇒ 报警触发。

**B4（P2）反事实泛化**
证据：counterfactual 现仅「关边臂」。需求：扩「撤销扰动臂」（negate perturbationId）与「参数臂」。
验收：对已施扰动做撤销臂，差分与其施加效果镜像一致。

**B5（P3）拒绝纪律统一**
证据：H6。需求：tick body 改 zod 解析；未知字段 ⇒ 400（或显式 strip + 回执 `strippedKeys[]`），
与 counterfactual 同纪律；全平台手读 body 普查（同族一并收）。验收：S9 探针重跑 ⇒ 明确反馈而非静默。

**B6（P2）传导边参数治理：weightRef 裁决 + coefficientRef 纪律复归**
证据：仓 canon 实测——48 条传导边 **43 条 weightRef=null**（走不加权支路，铁律 1.5 绿框）；
coefficientRef 注释自称「禁内联业务常数（RL5）」而实测 **0 条走配置**（铁律 1.5 判据四
「信注释=信台账」的活例）。需求：① 逐边业务裁决「是否需要用量加权」，未裁决边在 disclosure
显式标 `weightAssumption:"equal"` ——⛔ 不许静默等权；② coefficientRef 二选一：复归配置化，
或明文修订纪律并把「内联为现状」写进披露——不许注释说一套、种子做一套。
验收：施扰触达一条未裁决边 ⇒ 其 trace 行带等权标注；把某边 weightRef 从 null 改为已裁决 ⇒
同扰动下其下游差分按 BOM 份额拉开（铁律 1.5 判据一同款四数法）。

**B7（P1）代理模型（surrogate）双臂：演化层从「纯手写」到「可学习」**
证据：仓主反馈改 1——「LLM 禁入演化层」被实现成了「演化层 = 手写规则」的错误二分；
48 条边 43 条 weightRef=null 全是人写的，结构上没有变准的路径（§0.1 原判「不承诺」的直接成因）。
需求：从实料/历史拟合响应面（代理模型），与手写传导边**双臂并存**：disclosure 标明本次用了哪一支；
两臂差异超阈即报警（⛔ 不许静默取其一）；拟合臂在**留出集**上 MAPE 优于手写臂才允许成为默认，
且必须可一键退回（adversary 特性键范式：默认关 + 双臂门 + 注册表可查）。
R6 不破：拟合模型 = 同数据同参数 ⇒ 同输出；模型版本 + 训练数据指纹入 disclosure（G2 出处成立）。
验收（T1）：同扰动两臂各跑，差分逐格可比；留出集 MAPE 对比落盘；拟合臂不达标 ⇒ 默认臂恒为手写臂。
依赖：C1/C2 实料（M4）、B1 ensemble 闸。

### WS-C · V&V 与校准闭环

**C1（P1）校准实料定义与上线**
证据：S6（paired:0 如实回零；现存提案为 `calp_demo_seed_*` 种子）。需求：定义 replayPairs 实料来源
（企业快照序列/工单结案），上线判据 = 手动 run `paired>0` 且提案由实料产生。验收：造 N 对已知预测/实际
⇒ run 产出 MAPE 与手算一致；G6 达标。

**C2（P1）回测门进 CI**
证据：m11 算法族在（replayAttribution/mapePct）。需求：历史快照 replay → 偏差台账按规则/参数归因 →
超阈自动生成校准提案（C12 链接实料）。验收：注入已知系数漂移 ⇒ 回测门红且提案指向正确参数。

**C3（P2）决策回流**
证据：act.adopt-to-draft 特性键在。需求：采纳 ActionDraft 时快照「推演说了什么」（disclosure 引用集），
结案回写 realizedOutcome，进入 calibration 配对池。验收：采纳→结案一条链路的数能被 run 配到对。

**C4（P2）场景覆盖审计**
证据：20 场景目录 + 场景敞口表（插单/停机/延期/砍单/调价/换产）。需求：敞口×已推演场景交叉，
未覆盖高敞口场景明列（供 agent ⑥ 环消费）。验收：删掉某场景 ⇒ 审计报告该敞口档标「未覆盖」。

**C5（P1）结构校准：从「参数微调」到「结构学习」**
证据：仓主反馈改 3——m11 算法族（EMA/quantile/replayAttribution）只能调系数不能改结构；
43 条 weightRef=null 靠「逐边业务裁决」是 48 次人工决策（B6 的局限）。
需求：边的存在性与加权口径进回归——**但回归只许提议，不许入院**（审核方加注，本 PRD B2 自家纪律：
⛔ 相关 ≠ 因果——从观测数据回归「边的存在性」正是相关陷阱）。结构提案的入院路径 =
**反事实双臂干预验证**（B4 既有原语：在仿真里开关该结构实测）+ 人审异常；实料不足时如实标
`structure:hand-authored`，⛔ 不许用手写值冒充拟合值。
验收：注入一条已知为真的结构 ⇒ 回归能提议、双臂能验证、人审能过；注入一条纯相关假结构 ⇒
干预臂证伪、不许入院。

**C6（P1）推演经验库：让第 100 次比第 1 次准**
证据：仓主反馈改 5——现在每次推演无状态；「预测存证→对账」模式已有先例（`capacity_forecast` 的
forecastSnapshot/T9 偏差线，`service.ts:6413`），本条件它从产能推广到全部预测。
需求：（扰动, 预测, 实际）三元组沉淀；新推演检索相似历史，把历史偏差作为先验修正（修正量入 disclosure）。
⚠ 必须可关，且**双臂验证它真的有用**：开经验库臂 vs 关臂后验 MAPE 无显著改善 ⇒ 如实报「暂无价值」，
不许当装饰常开。验收（T1）：造 20 组已知三元组 ⇒ 相似检索命中率与 MAPE 改善落盘；
关掉 ⇒ 预测回退到无修正形态。

### WS-D · 控制台与引擎诚实债（整改 PRD R1–R7 原样承接，此处只登记变更）

- D1=R1（P0）timings 契约消费——**本 PRD 唯一直接修屏条目，仍属禁碰区开账**；
- D2=R2（P1）传导图画或不画都给今日真理由；D3=R3（P1）时间/代价维先产口径再上列；
- D4=R4（P2）逐拍采集；D5=R5（P2）普查级取数；D6=R6（P2）源侧占位三变量真实化（0.16%/拍）；
- D7=R7 演习结论页签**升级 P2**：后端 drill 已亲测就绪（R1 证据），只缺版面。

### WS-E · 工业级横切（并入 §4 指标与 §6 风险，不单列需求条）

特性开关治理模板化（adversary 先例：默认关 + 双臂门 + 注册表可查）推广到全部「危险能力」。

### WS-F · 预言层（仓主 2026-09-19 定的目标层：算得准真实经营、仿真决策后果）

> 来历：仓主两问——「trace 推演是否真推演」「PRD 是否只是工业级求解器系统」。
> 代码级裁决（全量读完，非 grep）：**机械上真、预言上缺**。
> 传导机本身是真推演（不是 mock 不是查表：扰动相位→衰减相→延迟结算→规则传导→夹值→饱和账，
> 全披露可复算）；但它是 **what-if 簿记机**，四层缺席使它产不出「未来」：
> ① **封闭世界无外生过程**——tick 循环（`app.ts:2440-2472`）拍间唯一入流 = 扰动账 + 延迟队列到期；
>    入度 0 根源（forecastBias/priceShock/equipmentFailure）恒持种子常数（`propagation.ts` 衰减相
>    「外生输入不衰减」段的反面：也没有任何机制让它们**变**）。60 拍无新扰动 = 纯弛豫到种子稳态。
> ② **状态域全压力量纲，无经营结果量纲**——margin 的全部代码坐标是两个**静态**求解器：
>    `margin_attribution`（`service.ts:1585`，读对象静态属性 o.props 算倒挂归因）与
>    `quote_margin`（`:6653` 注释原文「margin=(price-bom-mfg-logistics)/price」静态比率）——
>    **两者都不读 sim 世界态**。TickState 里没有 margin/revenue/cash。
> ③ **基线未来无定义**——没有外生过程，「什么都不做会怎样」在数学上 = 弛豫曲线，不是经营轨迹。
> ④ **决策→结果链断在压力层**——drill 11 类决策形状事件真跑（亲测 254 格），终点全在 pressure。
>
> ⚠ 唯一已有预言脚手架：`capacity_forecast` 的 forecastSnapshot/T9 偏差线（`service.ts:6413`，
> 产能 P50 点预测存证供 tick 对账 + 校准配对）——证明「预测-存证-配对」机制通，但只有产能一个量、
> 且是点预测。F 流与学习簇（A10/A11/B7/C5/C6）合力，系统才从「工业级求解器系统」长向「AI 推演系统」。

**F1（P0）外生过程层（让世界自己会变）**
证据：缺席层①。需求：外生过程注册表（需求到达/消耗、价格游走、产能与停机日历），全部种子驱动
（R6 保持：seed 名单入 disclosure，与 B1 同闸）；引擎每拍先结外生账再结传导账；
外生过程为零的租户逐字节同旧（additive·RL9）。
验收：零扰动 60 拍，基线世界与「恒等世界」逐字节不同且同 seed 名单字节一致；关掉某过程 ⇒
其驱动的格子回到弛豫形态。

**F2（P0）经营结果量纲入状态域 + 会计恒等式**
证据：缺席层②。需求：margin/revenue/cash/OTIF 作为一等状态量纲（声明取值域进 domains）；
会计恒等式注册为**恒等约束**（不是传导边）：每拍由状态量推出结果量，推不出 ⇒ 诚实空
（unresolvedWeights 同款范式），恒等式违反 ⇒ saturations 同款账。
验收：施扰（铝箔+20%）60 拍 ⇒ margin 轨迹逐拍可追、每格能沿 trace+恒等式复算；
删掉恒等式 ⇒ 披露报缺不编数。

**F3（P1）基线未来（do-nothing trajectory）**
证据：缺席层③。需求：基线 = 外生过程在 seed 名单下的 ensemble 轨迹（复用 B1 闸）；
what-if = 基线 ⊕ 决策扰动的**双臂差分**（影子线原语 `app.ts:2416` 已是这个形状，
从度量装置升级为产品语义）。验收：零决策 60 天基线带 P50/P90 档；同 seed 重跑字节一致；
决策臂与基线臂逐拍差分可归因到决策（B2 归因维联动）。

**F4（P1）决策编译：从 drill 词汇到 P&L 终点**
证据：缺席层④。需求：决策（调价/换料/插单/停机/接单）编译为「外生过程参数变更 ⊕ 状态扰动」
组合件；传导链必须闭合到 F2 的结果量纲，闭合不了 ⇒ 诚实「该决策的后果超出当前模型边界」。
验收：输入「铝箔改用供应商B+涨价15%」⇒ 输出 60 天 margin 差分轨迹、每格出处齐；
编译不出的决策 ⇒ 拒答 + 披露缺什么。

**F5（P0·纪律条）预言声明校验**
证据：今天 agent 被问「60 天利润率」只能路由到静态求解器——拿当下读数穿预言衣服是假预言唯一敞口。
需求：输出强制分级 `extrapolation（静态外推）| simulation（仿真轨迹）| calibrated-prediction（校准后预测）`；
A7 机械审计器加「预言声明校验」：声明级别高于实际路径 ⇒ 当场红；F1–F4 路径缺席时预言类问题必须拒答。
验收：命令 agent 拿 quote_margin 答「60 天利润率」⇒ 审计器红；F1–F4 上线后同问 ⇒
输出标 simulation 带 ensemble 档。

---

## 4. 非功能需求（工业级指标）

| # | 项 | 现状（实测） | 目标 | 验证 |
|---|---|---|---|---|
| N1 | 演化性能 | 12.5k节点/6,363格 3拍=12,955ms（shadow 占 86%） | 10万节点世界 3拍 ≤60s | 压测+timings 披露复核 |
| N2 | drill 30 天 | 7 天级实测秒级 | 30 天 ≤90s（含求解器路由） | 压测 |
| N3 | ensemble | 不存在 | K=20 线性扩展、排队有闸（A3） | 压测+预算披露 |
| N4 | 回包预算 | 500 闸单点 | 全列表/序列端点「请求决定规模」+ truncated 诚实位（普查） | 端点普查门 |
| N5 | 确定性 R6 | 字节一致（已验） | ensemble 下同 seed 名单字节一致；时钟禁令扩到校准窗 | seam 门 |
| N6 | 多租户/权限 | entitlement + OBO 透传（已验） | agent=独立 principal 走同一 OBO 无后门；租户级预算隔离 | 越权测试 |
| N7 | 审计 | tick/drill/counterfactual 全披露 | + plan/校准/决策回流全留痕可重放 | 重放测试 |
| N8 | LLM 成本 | 零调用（未配 key） | token 预算+单价台账，超限即停（A3 同闸）；计量覆盖目标内核路由（`PRODUCTION_DSH_HARNESS_PROVIDER="platform"`）与过渡期原生路由 | 账单单测 |
| N9 | 超时 | solver 15s+真取消（已验） | 范式推广到全部编排调用 | 故障注入 |

---

## 5. 契约与本体影响（铁律 0 必填）

- **对象类型**：无新增。B3 行为体规格走规则 `reaction` 段（已有）+ 注册表，不建类型。
- **链路**：无新增 linkType；新 actor 如需逆边，沿用 `customer_places_order` 补边范式，单独 WO。
- **事件**：drill 11 类已注册；新增走 `DRILL_EVENT_SPECS` + `assertDrillRoutingTableComplete` 门。
- **契约**（全部 additive，R6 语义保持）：`SimPlanDisclosure`（新）· `Perturbation.proposedBy`（改）·
  tick/drill `ensemble` 入参与分布输出（改）· `Impediment.causingPerturbations`（改）·
  `strippedKeys` 回执（改）· drill `forkedFromStateId` 文档化（不改形状）·
  **F 流**：结果量纲入 StateVarDomain 注册（对象类型不变）· 会计恒等式注册（恒等约束，非传导边）·
  外生过程注册类别（seed 驱动，seed 名单入 disclosure）· disclosure 加 exogenous/outcome 段 ·
  输出 provenance 分级枚举（extrapolation|simulation|calibrated-prediction）·
  **学习簇**：代理模型版本 + 训练数据指纹入 disclosure（B7）· `structure:hand-authored|learned` 标注（C5）·
  经验库三元组契约（C6）· propose_model_change 走既有 ActionDraft 流（A9⑥，零新契约）。
- **不变量**：R6（seed 名单入 disclosure）· 诚实降级（⛔ 静默吞/静默换路/静默截断一律门红）·
  disclosure 唯一叙事来源 · 演化层 LLM 禁入（架构级，非配置级）。

## 6. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R-1 | LLM 不确定性污染数值真相 | 演化层禁入 + A7 引用绑定 + 机械审计器；G2 门 |
| R-2 | agent 意图误编译（错事件/错落点） | A8 金标门 + 自主梯：propose→人审→auto 按风险级开放（默认人审） |
| R-3 | ensemble/探索成本爆炸 | A3 预算强制 + N3 排队 + N8 台账 |
| R-4 | UQ 假精确（分布档被当精确值） | provenance 档继承（A7）+ deterministic-only 标注（B1） |
| R-5 | ABM 振荡/失控 | 生态预算 + 振荡检测（B3）+ 每 actor 开关 |
| R-6 | 范围蔓延 | §7 非目标 + M 出口判据；每 M 出口不过不收编下一段 |
| R-7 | 目标内核上线被外部依赖卡住：融合线 §3 三前置未销账 ⇒ dsh 不能翻 flag ⇒ G1/G2/G5 毕业测量无环境 | 契约内核无关 ⇒ M1（A1/A2/A3/B5/D1）不等内核先行；E-native 过渡证据持续采并标注、不冒充毕业依据；灰度 per-agent 秒级可退（ROLLOUT）；销账进度与融合线定期对账 |
| R-8 | 外生过程本身是编的 ⇒ 假预言穿上真仿真衣服（比今天的静默更危险） | 外生参数全部进 C1/C2 校准配对 + 来源披露；F5 分级虚标即红；实料不足 ⇒ G6 拒毕业 |
| R-9 | 学习目标被刷（Goodhart）：推翻先验数、经验库「有用性」、拟合臂 MAPE 被 gaming | A10 敞口锚定 + 埋真法验收；C6 双臂有用性门；B7 留出集强制 + 一键退回 |

## 7. 非目标（明文排除）

LLM 进演化层（永不）· agent 专用数据后门 · 替人拍板（排序与拍板归人）· 实时流式 tick（无需求证据）·
跨行业通用本体（本 PRD 只保电池场景包的工业级）· 重做已验证资产（drill/counterfactual/校准/outlook 只接不重建）。
**另明文排除四样**（边界与成熟路径见 §0.1，不重复开条）：世界模型保真度成熟 · 校准概率级 UQ ·
洞察力质量指标 · 企业真实数据接入计划。

## 8. 里程碑（出口判据即毕业判据的子集）

| 程 | 内容 | 出口判据 |
|---|---|---|
| M1 审计地基 | A1 A2 A3 B5 D1 | 编排三件套契约合并；agent 上岗前提齐；timings 缺陷清账 |
| M2 编排闭环 | A4 A5 A6 A7 A8 A9 | 一句自然语言 → plan 披露完整 → 报告每数有出处（G1 G2 G5）；ReAct 全链施扰走账；**G1/G2/G5 毕业测量在 E-dsh 通过**（外部依赖：融合线三前置销账，§2.1） |
| M3 推演科学 | B1 B2 B3 B6 D2 D3 | 敞口带分布档；每条受阻环节带归因（G3 G4） |
| M4 V&V 闭环 | C1 C2 C3 C4 | paired>0、回测门进 CI、决策回流走通（G6） |
| M5 工业化 | N1–N9 D4–D7 | NFR 表全绿；R1–R7 清账（G7 G8） |
| M6 预言与学习层 | F1 F2 F3 F4 F5 B7 C5 C6 A10 A11 | 真决策 ⇒ 60 天结果量纲差分轨迹、逐格可复算（G9）；拟合臂留出集 MAPE 优于手写臂才准默认；假设搜索环双臂证价值（埋真法）；经验库双臂证有用；全部 E-dsh 采 |

## 10. 测试方案（测试标准 + 测试步骤）

> 分层职责：本 PRD 给**策略、标准、程序模板、毕业程序**；每条需求的 step-level 用例随实施 WO
> 各自产出，验收口径不得宽于本节的模板与判级。

### 10.1 测试分层

| 层 | 内容 | 工具/范式 |
|---|---|---|
| L1 契约/单元 | 契约 schema、纯函数（propagation/drill/disclosure/校准算法族） | vitest；既有守门套件必须保绿 |
| L2 seam 接缝门 | 铁律 1.5 判据一句式：「改 X ⇒ Y 必须按预言变」；金丝雀+变异反证 | `*.seam.test.ts` 既有范式 |
| L3 亲手施扰 E2E | 真三服务 + API/浏览器驱动，输入真扰动，逐环追踪——**本 PRD 主验证层** | 三轮实测同款（drive.mjs/probe.mjs 谱系） |
| L4 压测/故障注入 | NFR 表逐项 + 杀进程/塞坏数据 | T4/T6 模板 |

### 10.2 测试标准（四张表，均为本轮实测用过的判据，不是抄来的）

**环境标准**：内存模式 `SEED_DEMO=1`、被测分支合并树 dist；datacore@4001 / agentcore@4002 / vite@5173
（或脚本自起独立端口，端口真 bind + lsof 咬 pid 自证，不连任何遗留服务）；**内核环境类**（§2.1）：
E-native（`DSH_HARNESS=0`/不设、agent 不设 `kernel`）= 开发期逐条验收；E-dsh（销账后灰度租户
`kernel=EXTERNAL`）= G1/G2/G5 毕业测量；每件证据标注采集环境类，混类证据降 NOT-ADJUDICATED；**清洁窗口**：4 核机
datacore vitest ≤1 并发，起跑前窗口双零探针（vitest 树根=0）——有前科：撞窗口曾造成 30s 超时假象，
其产物一律不算数。

**证据标准**：逐步 try/catch 异常原文落盘不绕行；每件捕获 `.txt/.json` 配同名 `.rc` 且与 CAPTURED_RC
一致；计数一律**时间窗 + reqId**（⛔ 禁把全存活期 + OPTIONS 预检行算入）；浏览器网络层看不到
agentcore→datacore 的 OBO 调用 ⇒ 调用计数必须**双服务端日志交叉对账**；证据即写即落盘（mtime 是进度唯一真相）。

**判级标准**：PASS / FAIL / **NOT-ADJUDICATED**（污染窗口产物：不降 PASS 也不记 FAIL）；
产品红须**确定性复现 ×2**（两跑断言逐字节同病）——时长病/环境饿死不判产品红；
探针自身缺陷（空世界臂、错配事件、匹配失败）与产品裁决**分账登记**。

**回归标准**：守门文件全绿（`seed-demo-propagation` 19/19 · `sim-seed-world.seam` ·
`sim-order-real-fields.seam` · `object-constraint-refs.seam` · `adversary-reaction.seam`）；
R6：同输入重跑字节一致；世界初值若被需求改动 ⇒ D4 稳态表/D5 指纹四数**同批重钉**（有联动先例）。

### 10.3 标准测试程序（六模板，全部有本轮实测判例）

| 模板 | 步骤 | 判例 |
|---|---|---|
| **T1 双臂对照** | ① 取同一份 baseSnapshot ② 两臂同扰动同拍数 ③ 处理臂改单一变量 ④ 比差分。金丝雀三条：前提成立 / 处理真落上 / 零扰动臂逐字节零差 | 对抗方：关=0 / 开=119 行 |
| **T2 变异反证** | 关掉/改坏被测逻辑 ⇒ 门必须红；恢复 ⇒ 回绿。不红 = 门是装饰品 | 关掉读取逻辑 ⇒ 报「期望 5 实得 4」 |
| **T3 存在性金丝雀** | 断言前先证取数没坏（count>0、世界格数>0、候选>0）——「为 0 说明取数坏了，不是答案为空」 | 探针第一击空世界臂（反例） |
| **T4 故障注入** | 杀 solver / 注入编造数 / 塞未知键 ⇒ 系统必须显式报错或诚实降级，⛔ 不许静默 | counterfactual 400；drill「未能评估:2」 |
| **T5 重放一致** | 从 disclosure 取输入重放 ⇒ 逐字节一致（R6）；两实现同输入 ⇒ 同输出 | verdict 3,580 格 vs 独立差分 |
| **T6 压测** | 规模世界 + 计时，对照 NFR 表；timings 五段复核成本中心 | shadow 11.1s/13s 实测定位 |

### 10.4 需求 → 测试映射（一条一行；扰动输入为最低要求，实施 WO 只可加不可减）

| 需求 | 模板 | 关键输入与通过阈 |
|---|---|---|
| A1 计划披露 | T2+T5 | agent 编排一次 what-if；plan↔双日志逐条对；删一步记录 ⇒ 门红 |
| A2 分账 | T1 | 人/agent/drill/seed 各施一件扰动 ⇒ 四类 `proposedBy` 过滤齐全 |
| A3 预算 | T4 | 申报 1 拍跑 2 拍 ⇒ 必拦 + `budgetExceeded` 披露；ensemble K 超预算 ⇒ 排队非超发 |
| A4 入册 | T2 | **新注册**一个求解器/事件，不改代码 ⇒ 检索可见可调；三要素空 ⇒ 门红 |
| A5 skill 化 | T5 | 同输入：控制台五步 vs skill 执行 ⇒ 逐字节一致 |
| A6 核对环 | T4 | 杀掉一个 solver ⇒ 该步 `failed`、后续不执行、结论标降级 |
| A7 引用绑定 | T4 | 注入一个编造数 ⇒ 审计器红；引 ≈ 级数据 ⇒ 结论不许写「是」 |
| A8 金标门 | T1 | 金标问句集回归：Top-1 ≥ 门槛 且 误编译 = 0；新事件种类 ⇒ 金标同批扩 |
| A9 ReAct 工具面 | T1+T4 | 开通后 ReAct 全链（discover→init→act→tick→solver）施扰走账 proposedBy=AGENT；关开关 ⇒ 工具不可见；直传 baseSnapshot ⇒ 被拒+披露 |
| B1 UQ ensemble | T1+T5 | 同 seed 名单 ×2 ⇒ 字节一致；异名单 ⇒ 异分布；单值读数标 `deterministic-only` |
| B2 归因维 | T1 | 施 2 件已知扰动（如 铝箔+20% ∧ 容百+7天）⇒ 每条环节归因 = 单独施扰臂实测；相关冒充因果 ⇒ 红 |
| B3 ABM 生态 | T1+T4 | 新 actor 规格零引擎改动即生效，双臂验开关；构造振荡场景 ⇒ 报警触发 |
| B4 反事实泛化 | T1 | 对已施扰动做撤销臂 ⇒ 差分与施加效果镜像一致 |
| B5 拒绝纪律 | T4 | S9 探针重跑（塞 ensemble/seeds）⇒ 明确反馈非静默 |
| B6 参数治理 | T1+T2 | 施扰触达未裁决边 ⇒ trace 带 `weightAssumption:"equal"` 标注；某边裁决后同扰动差分按 BOM 份额拉开（四数法） |
| C1 校准实料 | T3+T1 | 造 N 对已知预测/实际 ⇒ run 产出 MAPE 与手算一致；`paired>0` |
| C2 回测门 | T2 | 注入已知系数漂移 ⇒ 门红且提案指向正确参数 |
| C3 决策回流 | T3 | 采纳→结案一条链路 ⇒ 其数能被 calibration run 配成对 |
| C4 覆盖审计 | T2 | 删掉某场景 ⇒ 对应敞口档标「未覆盖」 |
| C5 结构校准 | T1+T4 | 注入已知真结构 ⇒ 提议+双臂验证+人审过；注入纯相关假结构 ⇒ 干预臂证伪不许入院 |
| C6 经验库 | T1 | 20 组已知三元组 ⇒ 检索命中与 MAPE 改善落盘；关掉 ⇒ 回退无修正形态 |
| A10 假设搜索 | T1 | 埋真法：同预算开环臂 vs 关环臂 ⇒ 开环臂发现埋真结构显著更多；琐碎先验刷数 ⇒ 不计 |
| A11 解释切片 | T5 | 真推演 ⇒ ≤20 节点切片能复算结论主数；截断账本与全图差分一致 |
| B7 代理模型 | T1 | 同扰动两臂差分逐格可比；留出集 MAPE 对比；拟合臂不达标 ⇒ 默认恒手写臂 |
| F1 外生过程 | T1+T5 | 零扰动 60 拍：基线 ≠ 恒等世界且同 seed 字节一致；关某过程 ⇒ 其格子回弛豫 |
| F2 结果量纲 | T5 | 施扰 60 拍 margin 轨迹逐格沿 trace+恒等式复算；删恒等式 ⇒ 报缺不编数 |
| F3 基线未来 | T1 | 零决策基线带 P50/P90；决策臂 vs 基线臂逐拍差分可归因 |
| F4 决策编译 | T1+T4 | 「换供应商B+涨15%」⇒ 60 天 margin 差分轨迹出处齐；编译不出 ⇒ 拒答+披露 |
| F5 预言校验 | T4 | agent 拿 quote_margin 答「60天利润率」⇒ 审计器红；级别虚标 ⇒ 红 |
| D1–D7 | — | 按整改 PRD 各自对照实验验收（引用不复制） |
| N1–N9 | T6+T4 | 按 §4 表逐项；越权/故障注入必显式 |

### 10.5 毕业验收程序（G1–G8 逐步；环境按 §10.2 环境标准）

- **G1**：agent 跑 3 句不同自然语言 what-if ⇒ 抽 `disclosure.plan` 与 agentcore+datacore 双日志逐条对；
  步骤有记录率 = 100% 才过；无 plan 的执行必须被拒（T4 试一次）。
- **G2**：篡改 agent 输出一个数 ⇒ 机械审计器红；随机抽屏上 20 个数 ⇒ 全部能沿出处复算（T5 手法）。
- **G3**：ensemble 推演 ⇒ 敞口读数带 p50/p90；关 ensemble ⇒ 同类读数必须标 `deterministic-only`；
  同 seed 名单重跑字节一致。
- **G4**：施 2 件已知扰动 ⇒ 每条受阻环节 `causingPerturbations` 与单独施扰臂实测一致（T1 程序）。
- **G5**：四类来源各施一件 ⇒ 扰动账按 `proposedBy` 过滤四类齐全、数量与双日志一致。
- **G6**：CI 回测门连续绿；手动 run `paired>0` 且产生提案的 id 非 `*_demo_seed_*`。
- **G7**：整改 PRD R1–R7 逐条按各自对照实验复跑（含 R1 变异反证：取值改回 `timings?.total` ⇒ 红）。
- **G8**：NFR 表逐项出压测报告（10 万节点世界 3 拍 ≤60s 等），timings 五段复核成本中心归因。
- **G9**：造一件真决策（drill 词汇内）⇒ 60 天 margin 差分轨迹抽 5 格沿 trace+恒等式复算逐字一致；
  命令 agent 答「预判 60 天利润率」⇒ 输出带 simulation 级标注 + ensemble 档；
  把标注篡改成 calibrated-prediction ⇒ 审计器当场红（T4）。

### 10.6 边界与分工

frontend-shell 的 D 流条目：测试由测试方执行，修复另派 WO（禁碰区纪律不变）；
每实施 WO 交付物 = 代码 + seam 门（L2）+ 亲手施扰记录（L3，按 §10.2 证据标准）；
任何「绿了但说不清怎么绿的」一律判 NOT-ADJUDICATED 重跑，不验收。

## 11. 证据索引

- `docs/PRD-sim-console-e2e-remediation.md`（R1–R7 与本 PRD D 流全文）
- `docs/evidence/sim-console-e2e/`（REPORT.md 含根因复验记录 · findings · network.log · tick-response-1.json · 截图）
- `docs/evidence/sim-subsystem-probe/`（REPORT.md · probe.mjs/probe2.mjs · 逐步 .json/.rc · findings.md/findings2.md）
- 内核线（§2.1 全部断言的出处）：`docs/DECISION-dsh-fusion.md`（休眠裁决 + §3 三前置）·
  `docs/ROLLOUT-dsh-external-kernel.md`（per-agent 灰度，全档停 G0）· `docs/REPORT-dsh-poc-s0.md`（POC E1–E6）·
  `docs/PRD-agentcore-dsh-upgrade.md`（dsh 接入规格）· `docs/PRD-agent-react-harness.md`（原生 loop 升级规格，两条线勿混）·
  `docs/AUDIT-solver-arithmetic.md:182`（数字红线硬闸唯一落点坐实）
- 复跑：两目录 REPORT「复现」节。
