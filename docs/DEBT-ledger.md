# 欠条清单 · 用户明确提过但未做/半通的需求（DEBT ledger）

> 立此清单的背景（2026-06）：用户明确提的"数据接入控制台分类"需求曾记在 TODO §4 却长期 ⬜、
> 险些被无限期搁置。教训：**记进 TODO ≠ 会被做**；扁平 ⬜ 无强制力。本清单是"欠条"——每轮交付
> 必须回看、更新、并主动报"还欠什么"，把强制执行内建进循环，而非靠用户每次盯。
>
> 状态：✅ 已亲手验过 · ◐ 半通 · ⬜ 未做 · 🔒 阻塞在用户（我做不了）
> 验收纪律：`fde-delivery` skill —— 亲手用一遍能用才算 ✅。

## A. 未做 / 半通（我能做，欠着）

| # | 需求（用户明确提过） | 状态 | 实情 |
|---|---|---|---|
| A1 | **封装引擎暴露为 MCP 工具**（"封装成 API 就要在 MCP 工具里看到他们,包括 API"） | ◐ | §8g。**大部覆盖（PLATFORM-AGENT-SURFACE·CAPACITY-W-RECONCILE 2026-07-05 纠账）**：平台已开**对外 MCP/A2A 服务端表面**——外部 agent 可反向调用平台求解器 `platform__solver__{key}`（→既有 invoke REST·OBO/R2/R3 门随行·见本体 §8 G-14「对外表面正向补充 WO-A」+ §3）。即引擎**已作为 MCP 工具暴露**（出站方向）。**余（诚实）**：内部 agent 经 mcp-router 反向调本平台求解器的入站闭环、MCP 管理页对这些工具的可见化尚未逐一验证——留 ◐ 不冒充全闭。 |
| A2 | **comprehend 地板认新求解器** | ✅ | 地板加 Process/Equipment 实体 + Order 扩 procRef/prio/revenue/rawCost + shared_bottleneck/margin_attribution 关键词 + SOLVER_TARGET_VIEW；无 Kimi 时锂电故事即可选中新求解器并经 deriveSolverArgs 自动倒推参数（共享瓶颈→Process/Order/procRef…；毛利倒挂→Order/revenue/rawCost）。测试 llm-comprehend 地板用例 + comprehend-floor-a2(×2)。**余**：concentration_risk/supplier_disruption_radius 的地板语义选择仍依赖 Kimi（多源/标量歧义）。 |
| A14 | **hand-run agent evals 比对 PRD** | ✅✅ | (1) MOCK 链路：种子 20 场景(=PRD)逐条经真实 QOS，修 4 真断点（并发旁路/slotPresets/mock主键/期望一刀切）→ **20/20 意图命中 + 20/20 真执行产出非空答案**（evals-scenario-suite.test）。(2) **真 Kimi 分类**：实测 20 场景触发问句经真 kimi-k2.5 分类，修 classify 三断点（围栏/strict:false/有界重试）→ **真分 20/20 命中期望意图**。A14 mock+真 双闭环。 |
| A3 | **14 域参考运营本体 + 域内/跨域两库 + 多跳切片规划器 + 切片索引复用** | ⬜ | §3 用户"最新需求"整块未动。当前切片=单根/全字段覆盖根，**无图路径搜索的多跳切片规划器**，无两库读模型，无切片索引复用。 |
| A4 | **对象/类型浏览器管理页**（用户实测"找不到"） | ⬜ | §5。无 admin 对象浏览页（列已发布类型+物化计数+下钻实例）；对象图仅 `/v/graph` 业务视图。 |
| A5 | **FDE 编排工作流（可观测节点图）** | ⬜ | §6。无一条显式、节点状态可视、有保证终态的 FDE 工作流（意图→倒推→查能力→比差→各模块生成→回填节点→进启动器）。 |
| A6 | **拟真值域合成数据** | ◐ | scenarioTopology 可植入争用/定值，但通用合成仍 hash 值域（demandDelta=390 类）；非"落业务区间 + 恰当越线样本"。 |
| A7 | **B 栈 scaffold 单机可见** | ◐ | agents/意图/计划/场景仅在配 `AGENTCORE_BASE_URL+SERVICE_TOKEN` 时跨系统生成；否则用户本地看不到生成的 agent。 |
| A8 | **8d 扩更多最优化模型** | ◐ | CP-SAT sidecar + selection_optimize(背包)已落；assignment(订单分配)/sequencing(换型排序)/packing 待扩。 |
| A9 | **8b 传导 Datalog / 8a 图库 / 8e 因果 DoWhy** | ◐ | Q1/Q2/Q3/Q5 已由净室求解器覆盖（affected_orders/supplier_disruption_radius/margin_attribution/concentration_risk）；Soufflé/Neo4j/DoWhy 依赖**暂未引**（规模/精度顶不住再上，已在 §8 定调"默认不全上"）。 |
| A10 | **终态闭环末步"重跑验证真能推演"** | ◐ | publish-chain + InferenceButton + 参数倒推已让"建域→进启动器→点一下出答案"成立；但"建域→R4 审批→publish→**自动重跑问句验证**"未全自动化、未亲手全程跑通。 |
| A11 | **连接打 Connection.category 标签**（per-connection 归类） | ⬜ | §4 细化项：分类层(组织+模版+模式)已成，单个连接尚未带 category。 |
| A13 | **数据接入控制台数据归类页（与 §6.x 一致）** | ✅ | （见 C）补 上传文件 + 模版可替换。 |
| A12 | **§0 全量真相审计 + §7 hand-run 验收登记常态化** | ◐ | `docs/AUDIT-hand-run.md` 已记数据构建发动机主线 + 求解器 live；其余模块(连接器/对象浏览/Agent 页)逐一 hand-run 未补全。 |
| A15 | **新工作流代码的工业级压测**（用户："你做了工业级压测吗？"） | ⬜ | 工作流运行时 / ModuleProvisioner / gap_analysis / 异步执行只有功能性单测+集成(20 条)，**无规模/并发/负载压测**。该仿 `stress-bottleneck`/`scale-baseline`：大 BuildPlan(数百对象/规则/求解器)的 gap_analysis 规模、N 条并发异步运行、resume 风暴、确定性(R6)+性能预算。我曾说"工业级"指架构形态，非压测验证——不该混说。 **更新（2026-06-22）**：本会话新增码（FDE 投影 projectFdeNodes / prototype-intake 解析 / 双模闭包 validateClosure / operation-classify）同样**无规模压测**，一并归此项。 |
| A16 | **真浏览器 UI E2E 测试套件**（用户："包括前端 UI 的测试？"+"前后端联调是必须的"） | ◐ | **进展（2026-06-21）**：① 成文测试标准 `docs/TESTING-STANDARD.md`（分层 L0–L9 + 必测层矩阵，闭 A17）；② **前后端真联调 E2E 脚本固化** `scripts/e2e-realbackend.mjs`（真 datacore:4001 + 真 agentcore:4002 + 前端真后端模式/非 mock，Playwright 真浏览器），**实跑一次 4/4 通过**：admin/demo1234 真登录 → A4 真物化计数(26 类型/Equipment=72，区别于 mock 写死值) → A11 连接归类 → 工作流 7 步 + 比对现状表 + cross_scaffold 真下发 agentcore。**余**：未进 CI `pnpm test`（需下载 Chromium/起双后端，重）；前端组件测试仍 jsdom+MSW；无 UI 性能/负载。**待用户拍板**：E2E 进 CI 还是本地/夜间。 **更新（2026-06-22 已补实）**：装 playwright-core 1.61 + 扩 `e2e-realbackend.mjs` 到 9 项覆盖 5 新组件 + `run-l4-realbackend.sh` 一键编排 → 真 Chromium↔真后端 **9/9 通过**，5 项回 ✅。**余**：① 未进 CI（`pnpm e2e:realbackend` 本地/夜间，需起 datacore+agentcore+vite 三进程 + chromium 缓存）；② A14 真 Kimi parity 实跑仍 env-gated 未执行（mock 证框架，≠ agent 质量达标）。 |
| A19 | **§3 测试登记纪律未随 PR 履行**（TESTING-STANDARD §3 要求每 PR 填登记表） | ◐ | 本会话各 PR 提交时**未填 §3 表**，已于 2026-06-22 追溯补齐到 `TESTING-STANDARD §8`（10 项逐层登记 + 诚实边界）。**根治**：把 §3 登记接进 commit/PR 模板，今后随 PR 填（同 R9/R15 注册纪律）。 |
| A17 | **成文测试标准 `docs/TESTING-STANDARD.md`**（用户："测试标准有吗？"） | ✅ | **已成文**（`docs/TESTING-STANDARD.md` 11247 字·分层 L0–L9 + 必测层矩阵·A16 note 已述"闭 A17"）——此前 ⬜ 标为**陈旧失载**（CAPACITY-W-RECONCILE 2026-07-05 纠：文件早已存在且被 A16 引用，标记未同步）。分类法 + 必备测试矩阵 + 覆盖门 + `pnpm gates` 接线俱在；过期数字修正随各 WO 滚动。 |

## B. 阻塞在用户（我做不了，需你处理）

| # | 事项 | 为什么我做不了 |
|---|---|---|
| B1 | **真调 Kimi（comprehend 用真 LLM）** | ✅ 实测打通 | 用户给 key 实测,修了**两个真断点**：① 适配器直接 JSON.parse 失败于 Moonshot 的 ```围栏```（extractJsonText 剥围栏）；② **完整 comprehend schema** 下 Kimi 用别名措辞（name↔typeKey/type↔dataType/float→number/顶层domain）→ 旧严格 schema 校验失败回落地板（已加 normalizeComprehend 归一层 + 强化 COMPREHEND_SYSTEM 钉死字段名/枚举）。**直调适配器实测：真 Kimi(kimi-k2.5) 对"工序/设备共享瓶颈"故事完整 schema 校验通过——8 对象类型 + 3 DSL 规则 + 4 solverNeeds(含 shared_bottleneck)**。单测 normalizeComprehend 别名归一。**余**：起真服务端到端经路由再确认一次（沙箱 node server 易被 SIGURG kill）;真 Kimi 温度强制=1 不可控(comprehend 后 freezePlan 封存保 R6)。**安全**：key 已在对话泄露,请轮换。 |
| B2 | **泄露的 Gemini key 轮换/吊销** | 外部凭据安全，必须你在 Google 侧吊销/换。 |
| B3 | **浏览器像素级 hand-run** | 沙箱无浏览器；前端验证到 vitest+MSW 组件层 + HTTP 端到端层，未到像素层。 |

## C. 本会话已交付并验过（闭环，移出欠条）

- ✅ 5 个杀手级多跳求解器（affected_orders/supplier_disruption_radius/margin_attribution/shared_bottleneck/concentration_risk）+ 真实 HTTP 端到端。
- ✅ OR-Tools CP-SAT 自托管 sidecar + selection_optimize（可证最优，真求解 6 测、TS↔Py live）。
- ✅ FDE 求解器参数自动倒推贯通启动器（故事→点一下出答案，arg-binding 收口 G-3 一环）。
- ✅ 数据接入控制台数据分类全套（§4：12 类 taxonomy + 全类型归并 + 系统对接/文件上传 + 模版可看可下载 + 合成字段对齐 + 100% 切片字段覆盖）。
- ✅ 数据分类**上传文件**入口 + **模版可替换**（用户上传 CSV 替换写死模版，可复位）——用户实测反馈即修。

---

> **更新纪律**：每轮交付结束，回看本清单 → 把做完的移到 C、把新欠的加进 A/B → 汇报时附"本轮还欠 A 区哪些"。
> 不靠用户盯，靠这张表当强制执行的力量。

## 2026-07-05 · 审核方内部任务清账移入（三条·处置各注明）
- **genuine-sim 门脆性加固（可选债·原审核内部任务#10）**：check-genuine-sim 对沙盘"真推演"判定依赖固定标记文本，重构易假绿。处置：P3 债记录在案，随下次触碰 sim 门的 WO 顺带加固（断言改为结构化字段而非文本匹配）。
- **option A 断点 B1/B2（原#18）**：B1 无 LLM 建模 UX 降级——已被 comprehend 关键词地板（R6）+ 真 LLM 接入双重覆盖，降级路径已存在；B2 上传后归域引导——已被 dev 设计分支「数据构建发动机统一页」PRD（区1 双输入⊕归域）承接，随该立项落地。两者不再单独开 WO。
- **交互完整性普查 Phase2/3（原#43）**：Phase1 六代理枚举 ~475 控件已完成；Phase2 渲染判空启发式误报率高作废。实际产出已经由其它路径闭环：用户亲报死交互（ORDERCHAIN-DAG-DRILL✅）、空态批（VIS-SIGNALS✅/VIS-SIGNALS-2 复验中）、GapCard/看板死按钮（GROWTH-WORKLIST✅）。全站逐控件普查性价比低于按需复验，正式收档不再作为独立任务。
