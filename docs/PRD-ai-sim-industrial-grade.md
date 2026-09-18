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
| G8 | NFR 表达标（§5，含 10 万节点世界 3 拍 ≤60s） | 压测报告 |

---

## 1. 现状盘点（实测基线，三档标注）

### 1.1 已验证资产

**E2E 实测过（控制台主链）**：本体切片（GLOBAL 12,499节点/13,533边 0丢弃）· 规则（声明49/触发48，全内联系数）·
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
③ 演化[引擎]    逐拍传导 + 全披露 · ensemble 按 seed 名单并行（B1）—— LLM 禁入
④ 诊断[求解器]  卡在哪/为什么/怎么办 + 扰动归因维（B2）
⑤ 解读[agent]   只对披露事实说话，每数挂出处、继承最低 provenance 档（A7）
⑥ 新假设[agent] 红队搜索/覆盖审计提议下一组实验，人裁决（C4、自主梯 §6 R-2）
贯穿：计划披露（A1）· 分账（A2）· 预算（A3）· 核对环金丝雀（A6）· skill 编排件（A5）
```

---

## 3. 功能需求（五工作流；每条：证据 → 需求 → 对照实验验收 → 依赖/优先级）

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
验收：`POST /b/v1/resources/search` 查「涨价」双命中扰动事件与求解器；grep 控制台 `chain_impediments`
字面量零命中（防回退门）。

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

**A8（P2）意图编译金标门**
证据：live-capability-map 金标问句范式（Top-1 即期望 solver）。需求：自然语言→（扰动事件,落点,幅度,时长,求解器）
编译的金标集回归门；误编译（错事件种类/错落点类型）零容忍。验收：金标集 Top-1 ≥门槛且误编译=0；
新增事件种类 ⇒ 金标集必须同批扩（门）。

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

### WS-D · 控制台与引擎诚实债（整改 PRD R1–R7 原样承接，此处只登记变更）

- D1=R1（P0）timings 契约消费——**本 PRD 唯一直接修屏条目，仍属禁碰区开账**；
- D2=R2（P1）传导图画或不画都给今日真理由；D3=R3（P1）时间/代价维先产口径再上列；
- D4=R4（P2）逐拍采集；D5=R5（P2）普查级取数；D6=R6（P2）源侧占位三变量真实化（0.16%/拍）；
- D7=R7 演习结论页签**升级 P2**：后端 drill 已亲测就绪（R1 证据），只缺版面。

### WS-E · 工业级横切（并入 §4/§5 指标，不单列需求条）

特性开关治理模板化（adversary 先例：默认关 + 双臂门 + 注册表可查）推广到全部「危险能力」。

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
| N8 | LLM 成本 | 零调用（未配 key） | token 预算+单价台账，超限即停（A3 同闸） | 账单单测 |
| N9 | 超时 | solver 15s+真取消（已验） | 范式推广到全部编排调用 | 故障注入 |

---

## 5. 契约与本体影响（铁律 0 必填）

- **对象类型**：无新增。B3 行为体规格走规则 `reaction` 段（已有）+ 注册表，不建类型。
- **链路**：无新增 linkType；新 actor 如需逆边，沿用 `customer_places_order` 补边范式，单独 WO。
- **事件**：drill 11 类已注册；新增走 `DRILL_EVENT_SPECS` + `assertDrillRoutingTableComplete` 门。
- **契约**（全部 additive，R6 语义保持）：`SimPlanDisclosure`（新）· `Perturbation.proposedBy`（改）·
  tick/drill `ensemble` 入参与分布输出（改）· `Impediment.causingPerturbations`（改）·
  `strippedKeys` 回执（改）· drill `forkedFromStateId` 文档化（不改形状）。
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

## 7. 非目标（明文排除）

LLM 进演化层（永不）· agent 专用数据后门 · 替人拍板（排序与拍板归人）· 实时流式 tick（无需求证据）·
跨行业通用本体（本 PRD 只保电池场景包的工业级）· 重做已验证资产（drill/counterfactual/校准/outlook 只接不重建）。

## 8. 里程碑（出口判据即毕业判据的子集）

| 程 | 内容 | 出口判据 |
|---|---|---|
| M1 审计地基 | A1 A2 A3 B5 D1 | 编排三件套契约合并；agent 上岗前提齐；timings 缺陷清账 |
| M2 编排闭环 | A4 A5 A6 A7 A8 | 一句自然语言 → plan 披露完整 → 报告每数有出处（G1 G2 G5） |
| M3 推演科学 | B1 B2 B3 D2 D3 | 敞口带分布档；每条受阻环节带归因（G3 G4） |
| M4 V&V 闭环 | C1 C2 C3 C4 | paired>0、回测门进 CI、决策回流走通（G6） |
| M5 工业化 | N1–N9 D4–D7 | NFR 表全绿；R1–R7 清账（G7 G8） |

## 9. 证据索引

- `docs/PRD-sim-console-e2e-remediation.md`（R1–R7 与本 PRD D 流全文）
- `docs/evidence/sim-console-e2e/`（REPORT.md 含根因复验记录 · findings · network.log · tick-response-1.json · 截图）
- `docs/evidence/sim-subsystem-probe/`（REPORT.md · probe.mjs/probe2.mjs · 逐步 .json/.rc · findings.md/findings2.md）
- 复跑：两目录 REPORT「复现」节。
