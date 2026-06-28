# HANDOFF · 全系统彻底深扫 · 缺口施工清单（审核方 workflow 13 切片 find→对抗verify→综合 · 真跑证据）

> **这份是什么**：审核方按用户「跑 workflow 做彻底深扫，查出所有缺口」指令，跑了一个 **13 功能切片 → 对抗式复验 → 综合** 的多 agent workflow（36 agents·真 curl/真渲染·非 grep）。**报告缺口 22 → 对抗复验确认 21 → 去重合并 13 根因项**。每条都有真跑 repro。这是该统一转给开发的 **master 工单**（取代零散补项）。
>
> ⛔ **核心教训（深扫三次实证）**：**"绿测试 ≠ 能用"** —— 4 包全绿，但**链路接缝**（LLM 用途绑定、前后端响应信封、A6/归域门半接通、陈旧 dist、mock eval 谐振）系统性断裂。**铁律0：一切以解决根本问题为准绳**——修接缝而非贴补丁。

---

## §0 五条横切主题（根因模式 · 修一处灭多条）

1. **LLM 用途绑定接缝 = 单点雪崩源**：demo 种子用途绑定不全 → 凡未绑用途回落**无凭据 Anthropic 客户端** → 抛 SDK 原始鉴权串泄漏给用户。一条接缝同时打死 A2 抽取、未知行业合成、（同症状不同接缝）路径B Agent。**修接缝（补绑 + 回落改结构化错误）即灭多条 P0/P1。**
2. **「绿测试≠能用」三实证**：①陈旧 dist（S&OP 跑的是 baaee9b 前的二进制，源码对部署错→空壳）；②mock eval 谐振（evals 恒 MOCK + 0 用例 passRate=1，结构上发现不了路径B 真故障）；③单测全绿但接缝无人覆盖。→ **须补 real-backend 烟测 + 真打 LLM 的 eval + dist↔源码一致性门。**
3. **前端↔DataCore 响应信封契约漂移（R1 反例）**：endpoints.ts 把 `{items}` 信封端点谎报成裸数组类型，TS 类型说谎 + 无运行时校验 → `.filter/.map` 崩 ErrorBoundary。**契约应单一来源，前端不得自行重声明形状。**
4. **门/过滤「半接通」——一路拦、平行路漏**：A6 行级过滤 query 路径对、solver 读出层只过滤 Order（Base/Line/Process/Equipment 全漏）；归域门只校存在性不校 14 合法域成员。**门禁覆盖不全 = 比没门更危险（给已闭的错觉）。**
5. **测试/探针数据污染生产面 + 诚实性裂缝**：历次 FDE 遗留垃圾域（CONN_GARBAGE_XYZ/FdeProbe*）直达对象浏览器/business-domains；data-health 徽章自相矛盾（延迟超阈却判 OK）。

---

## §1 缺口清单（13 根因项 · 按严重度排序）

| # | 级 | 区域 | 缺口（一句话） | 真值证据（repro 见报告） | 根因解 | 本体引用 | 状态 |
|---|---|---|---|---|---|---|---|
| **1** | **P0** | A2抽取/A7合成/llm-adapters | **LLM 用途绑定断链**：未绑用途回落无凭据 SDK→裸鉴权串；A2 抽取 100% 死、未知行业合成 500 | `GET /llm-bindings` 缺 extraction/template_gen；`POST /rule-docs`→段 FAILED「Could not resolve authentication method…」；`POST /synthetic/jobs{industry:foobar}`→500 同串 | ① seed 补绑全用途 ② `TenantRoutedLlmClient` 无绑定回落改抛 `{code:LLM_PURPOSE_UNBOUND}` 而非裸调无凭据 SDK | R7错误信封·RuleDoc/SyntheticJob/IndustryTemplate·extraction/template_gen 用途路由 | **◐ 审核方已修①binding(00ff4c4·验证不再泄漏SDK串)；②回落结构化错误 + 次生「Kimi 抽取 unparseable」待 dev** |
| **2** | **P0** | B1 Agent/路径B接缝 | **路径B Agent 全不可用**：目录外问句 3ms AGENT_ERROR，把 SDK 鉴权串当错误吐给用户 | `POST /api/v1/queries` 目录外→3ms FAILED·path=AGENT·error=SDK串；createdAt→completedAt 仅 3-30ms=没真调 LLM（对照路径A 真打 Kimi 9-18s） | 排查 `agent/loop.ts` LLM client 是否经 RoutingLlmClient 按 agent 用途解析到 provider（对齐路径A datacore-directory 解析）；接缝错误统一优雅降级 | QOS路径B(分类→Agent→SSE)·Agent LLM 用途绑定解析·R8·LLM增量§1.3 | **dev 待修** |
| **3** | **P1** | A0权限/A4求解器读出 | **A6 行级过滤求解器读出半失效**：base_manager:常州 经 capacity_rollup/bottleneck_matrix 读全 12 基地（仅 Order 过滤） | BM token：`objects?type=Base`→count 1（对）；但 `solvers/capacity_rollup/invoke`→.bases=12（含外地逐产线产能/OEE） | solver loadContext/读出层对所有 scopeObjectTypes（Base/Line/Process/Equipment）套同一套 A6 行级过滤（按 attrs.baseScope），非只过滤 Order；补测 | R6·§7 A6行级过滤门(query/slice/solver读出)·Base/Line/Process/Equipment | dev 待修 |
| **4** | **P1** | S1.8 S&OP/部署 | **S&OP 工作台启动即空壳**：`/sop/versions`→[]，跑的是 baaee9b 前陈旧 dist（丢 seedDemoSopVersion） | `GET /sop/versions`→200 `[]`（entitled 非404）；手跑源码 seed 逻辑 HTTP 200 全过 | **重建+部署 datacore**（运行 dist 含 seedDemoSopVersion）；CI 加 dist↔最新提交一致性门 | SopVersion·S1.8 五步法状态机·seedDemoSopVersion(server.ts:51)·R6 | **◐ 审核方已重建 dist；重启 4001 即闭（见 §3）** |
| **5** | **P1** | A1连接器 | **5 连接器类型「测试连接」假绿**：sap_erp/salesforce_crm/generic_jdbc/knowledge_base/external_feed 仅校必填不探活，建成功但 sync 必失败（无 adapter） | `connections/test{sap_erp,host:invalid}`→`{ok:true}`；建后 sync→FAILED、schema→500「no adapter implementation yet」 | 无 adapter 的类型 `connections/test` 返 `{ok:false,reason:'该类型尚无实现'}`，使测试反映真实可用性 | Connector/Connection/SyncJob·Connector--sync-->RawDataset·UX真实性 | dev 待修 |
| **6** | **P1** | B5场景/growth | **growth/probe 5s 轮询预算 << LLM 10-90s**：可答问句被误报 BLOCKED「人工核实内部错误」，污染 StoryBuildRun | `growth/probe` 对可答 in-catalog 问句→BLOCKED/gapCode:OTHER；同问句 scenarios/launch→COMPLETED 真6行表；探针任务35s后仍 EXECUTING_AGENT | probe 轮询预算提到覆盖 LLM 时延（或异步轮询/SSE 直到终态）；非终态报「仍在推演」非 BLOCKED | sys.orch.query_to_answer·G-9自成长·StoryBuildRun·GapReport「诚实定级不静默」 | dev 待修 |
| **7** | **P1** | 前端契约漂移 | **两管理页点开即崩 ErrorBoundary**：隔离区(.filter)/验证引擎(.map)——后端返 `{items}`，前端谎报裸数组 | `/quarantine`→`{items,byReason,total}`，`QuarantinePage:17 .filter` 崩；`/validation/runs`→`{items}`，`ValidationPage .map` 崩；「刷新」是死按钮 | endpoints.ts 这两端点改 `{items:T[]}` 取 .items（或统一解包）；用 contracts 信封 schema 运行时校验（R1） | 前端契约vs响应shape接缝·R1 contracts-only-shared·R7 | dev 待修 |
| **8** | **P1** | A3建模/A4本体 | **归域门只校存在性不校14合法域** + AI suggest 灌 connId 进 domain + 探针垃圾域泄漏对象浏览器 | `setDomain('conn_garbage_xyz')`→publish `{ok:true}`→object-types/stats 出幽灵域；suggest 回填 domain=`conn_xxx`；/admin/object-types 含 CONN_GARBAGE_*/FdeProbeBogus | ModelingSuggestionSchema.domain + 归域门约束为 BUSINESS_DOMAINS(14) enum 成员（非成员→VALIDATION_ERROR）；suggest prompt 移除 connId；清理已落库垃圾域 | R12归域门·publishDraft/suggest·graphmeta BUSINESS_DOMAINS(14)·A4按域分组 | dev 待修 |
| **9** | **P2** | 数据健康/R13 | **数据健康新鲜度↔对象彻底断链**：9 业务源全显0对象，39对象挤在 conn_xxx 一行套假新鲜度（两套 connId 命名空间不相交） | `/data-health` connId=sourceId(ems/erp/…)；`/ontology/graph` 39节点 connId 唯一=conn_s7fan…；join=0 | 统一 connId 命名空间（sourceBindings.connId 与 data-health connId 对齐或建映射），使「对象↔源系统+新鲜度」join 真闭合 | DataSourceHealth·M6(970ee3a)·C09·R13可溯源 | dev 待修 |
| **10** | **P2** | B5场景 | **功能注册表边界漂移**：view.scenarios 在 AgentCore 注册(defaultOn) 但 DataCore 缺 → launcherEnabled 恒 false + SL2 门禁结构性永不触发 | `/tenants/demo/features` 无 view.scenarios；agentcore/registry.ts:56 有；gate.ts→featureEnabled=false | datacore/features.ts 补注册 view.scenarios（与 AgentCore 同源）；或 FEATURE_REGISTRY 收敛到 contracts 共享 | SL2门禁·Entitlement先于authz·contracts单一来源·Feature | dev 待修 |
| **11** | **P2** | A3建模/R12 | **A3 链发布类型不自动建 coverage 切片**：field-coverage 0%、不落本体切片（R12 反向闭包落空） | 完整 A3 链发布物化的 FdeProbeBase（11字段全映射·readiness100%）在 `/field-coverage` 显 covered 0/uncovered 全部；ontology/slices 无它 | publishDraft 发布新类型时同步建单实体全字段 coverage 切片（复用 batteryCoverageSlices），登记一等切片 | R12双向闭包(反向-对象HARD)·computeFieldCoverage·batteryCoverageSlices | dev 待修 |
| **12** | **P3** | evals | **Eval 谐振空跑**：0用例 passRate 强制=1、`/b/v1/evals/run` 恒 llmMode=MOCK——结构上发现不了 P0 Agent 真故障 | `evals/run`→total:0,passed:0,passRate:1,llmMode:MOCK；evals.ts:155/164·REST 不传 llmMode | 空用例 passRate=N/A 或0；REST 透传 llmMode + 提供真打 LLM eval 模式覆盖路径B | eval质量回归门·诚实边界·R6 | dev 待修 |
| **13** | **P3** | 跨切片 UX | **若干 UX/语义裂缝**：data-health 徽章自相矛盾·schema 裸500·PUT llm-bindings add-only 无DELETE·深链F5掉登录·query-history 孤儿页 | 见报告 evidence（5 子项合并） | 逐条修（见报告 fix）：非critical源不下发误导阈值·schema外部4xx优雅降级·补DELETE+PUT幂等替换·ShellLayout 启动先 silentRefresh·NAV 补 query-history | datahealth/C09·认证链路·路由表↔NAV接缝 | dev 待修 |

---

## §2 覆盖与盲区（诚实）

**测得透（真 curl/真渲染坐实）**：A0 IAM+A6+租户隔离、A1 连接器全端点、A2 抽取全链、A3 建模全链+A4 全读端点+AI suggest、46 求解器逐个 invoke、A5 规则+S2 审批、A7 合成+A8 时序、S1.8+计划族、校准/验证/data-health/field-coverage、QOS 两路（真打 Kimi）、B1/B2/B4、B3 MCP/B5 场景/growth、不变量 R+断点 G 抽样、前端 21 业务视图+~40 管理页 Playwright。

**盲区（未覆盖·诚实标）**：① 真打 LLM 的「答案质量」未系统评（eval 恒 MOCK·路径B 因 P0 断裂连链路都没起来）；② CP-SAT 优化族未配 OPTIMIZER_BASE_URL，只验 graceful；③ pg 仓储模式未压测（测试默认 memory），pg 双实现一致性未覆盖；④ 陈旧 dist 提示运行二进制可能整体落后源码——**其他模块可能潜伏同类陈旧**，未逐模块核 dist↔源码；⑤ 多租户只测 demo 单租户隔离面。

---

## §3 归属建议（避免再撞车）

- **审核方已处理**：#1 binding 部分（00ff4c4·补全 6 用途·验证不再泄漏 SDK 串）；#4 dist 重建（重启 4001 即闭）；Kimi 持久化 seed（接 dev 24cc648 补 modeling）。
- **审核方将做**：重启主 datacore（带 KIMI_API_KEY·新 dist）做最终全链复验 → #4 闭合 + #1 在真 demo 端复验。
- **建议归 dev**：#1②回落结构化错误 + 次生 unparseable、#2 路径B Agent 接缝、#3 A6 solver 读出过滤、#5 连接器测试探活、#6 probe 轮询预算、#7 前端信封契约、#8 归域门 enum、#9 connId 命名空间、#10 features 注册同源、#11 A3 coverage 切片、#12 eval 真打、#13 UX 裂缝。
- **建议归用户决策**：先修哪些 P0/P1（#1②+#2 同根 LLM 接缝，建议优先；#7 前端崩页用户可见度高）；以及深扫盲区④「其他模块陈旧 dist」是否要审核方专项核一轮。

> 深扫 run：`wp24hdnwq`（13 切片·36 agents·报告22/确认21/去重13）。完整 evidence+repro：workflow 输出（含每条 reproduce 命令）。
