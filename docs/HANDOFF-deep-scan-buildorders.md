# HANDOFF · 深扫缺口实施工单（dev-ready · 审核方设计 · 派开发 agent 照建）

> **这份是什么**：审核方据深扫 master 工单（`HANDOFF-deep-scan-gaps.md` · run `wp24hdnwq`）把 11 个未闭缺口细化成 **dev-ready 施工单**，按**根因聚类**（非 1:1 症状——铁律0：修接缝不修症状）。每单自洽，dev agent 认领一单照建。
>
> 🔖 **角色**（铁律0.5）：本文是**审核方设计交付物**；dev agent **照本建+commit+push**，**审核方独立真跑复验**（curl oracle + 真浏览器），不替你写代码。
> ⛔ **接单先做增量0**：起真系统（datacore 4001 带 `KIMI_API_KEY` env / agentcore 4002 / vite 5173）+ 读 `docs/SYSTEM-ONTOLOGY.md` 本体对应章 → 真跑复现缺口 → 再动手。**完成=真跑实拍能用，非测试绿。**
> 🔴 **通用红线**：① 接现有不新建并行 ② contracts-only-shared（前端不重定义契约·跨包只依赖 @platform/contracts）③ tenant_id everywhere ④ R5 凭据不回显 ⑤ `pnpm -r build` 真绿 + 改了链路/事件/对象/不变量/门禁**回写本体** ⑥ 平台术语·模型标识不进提交物 ⑦ 只推 `claude/vigilant-knuth-b1nmxn`。
>
> 优先级：**WO-1（两 P0·同根 LLM 接缝）最高** → WO-2..6（P1）→ WO-7..9（P2）→ WO-10..11（P3）。

---

## WO-1 · LLM 用途接缝根治（P0×2 + 次生）——回落改结构化错误 + 路径B Agent 解析对齐

**根因（单点雪崩源）**：凡未经用途绑定解析到 provider 的 LLM 调用，回落**无凭据 Anthropic 客户端**→抛 SDK 原始鉴权串泄漏给用户。打死 A2 抽取、未知行业合成、路径B Agent。

**子任务 1A · DataCore 回落改结构化错误（P0）**
- 现状锚点：`apps/datacore/src/llmproviders.ts` `TenantRoutedLlmClient.parseStructured`（~370-372）：`resolveBinding` 返 undefined → 直接 `this.fallback.parseStructured`（无凭据 Anthropic）→抛 SDK 内部串。
- 怎么建：无绑定时**不**裸调无凭据 SDK，改抛结构化 `AppError('LLM_PURPOSE_UNBOUND', '用途 {purpose} 未绑定 LLM provider，请在 设置→LLM 用途绑定 配置', 400)`（R7 错误信封·message 对用户有引导、不泄漏 SDK 串）。仅当 env 真有默认凭据时才允许回落 env client。
- FDE 真值判据：未绑定某用途的租户调该用途 → 响应 `{error:{code:LLM_PURPOSE_UNBOUND,message:中文引导}}`，**curl 响应体不含** "Could not resolve authentication method"。

**子任务 1B · 路径B Agent LLM 解析对齐路径A（P0）**
- 现状锚点：`orchestrator.ts:685` `roleModel(tenantId,'agent')`→`dcp:<pid>:<model>`；`agent/loop.ts:448` `opts.llm.agent({...})` 用 `opts.model`。路径A classifier（:354）解析对、真打 Kimi 9-18s；路径B Agent 3ms AGENT_ERROR=没真调 LLM。
- 怎么建：排查 `orchestrator.runPathB→runAgentLoop` 传入的 `opts.llm`/`opts.model` 是否为能解析 `dcp:` 前缀到 DataCore provider 的 RoutingLlmClient（与路径A 同一解析）。若 agent-loop 用的是不识 `dcp:` 的 client→换成同款路由 client；接缝错误统一走 1A 的优雅降级，**禁止**把 SDK 串透传进 `AGENT_ERROR.message`。
- FDE 真值判据：`POST /api/v1/queries` 目录外问句（demo·已配 Kimi）→ **COMPLETED·trust=AGENT_EXPLORATORY·真答案**，decision-trace 含 `kimi-k2.6`、completedAt-createdAt **>5s**（真打 LLM）；非 3ms AGENT_ERROR。

**子任务 1C · 抽取/合成 schema 解析率（次生·P2）**
- 现状：补绑 extraction 后 A2 不再泄漏 SDK 串，但 Kimi 产出 "LLM returned unparseable output"（疑 demo seed `structuredOutput:false` JSON-mode 对复杂抽取 schema 解析率低）。
- 怎么建：评估把 demo seed provider capabilities `structuredOutput` 由 false→true（strict json_schema·审核方实测 classifier/modeling 用 true 可解析），或抽取 prompt/schema 降复杂度 + 提高 JSON-mode 重试上限。锚点 `apps/datacore/src/seed.ts seedDemoLlmProvider`（capabilities）+ `ruledocs.ts:213` 抽取 prompt。
- FDE 真值判据：`POST /a/v1/rule-docs`（3 条中文规则文档）→分段 status≠FAILED、`candidateCount>0`、出真规则候选。

- 本体引用与影响：链路 §3 `Connector→RuleDoc→抽取`、`synthetic.runJob→template_gen`、QOS 路径B；接缝=LlmPurposeBinding 用途路由 + agent-loop LLM 解析；R7 错误信封；LLM 增量 §1.3。**若改了路径B 解析的接线 → 回写本体 §8 断点/§3 编排链。**
- 审核方复验点：1A/1B 真 curl 三类未绑/路径B 问句无 SDK 串、路径B 出真答案；1C A2 出候选。

---

## WO-2 · A6 行级过滤补到求解器读出层（P1）

- 缺口：`base_manager:常州` 经 `capacity_rollup`/`bottleneck_matrix` 读全 12 基地车间级产能/OEE（对象查询路径已对、求解器读出只过滤 Order，Base/Line/Process/Equipment 全漏）。R6/§7 门禁三处声明覆盖、实测只 query 闭。
- 现状锚点：求解器 loadContext/读出层（`apps/datacore/src/solvers/*` capacity_rollup/bottleneck_matrix 的对象读取）；对照 query_objects 已有的 A6 行级过滤（按 `attrs.baseScope`）。
- 怎么建：在求解器读出层对**所有** scopeObjectTypes（Base/Line/Process/Equipment…）套用与 `query_objects` 同一套 A6 行级过滤（按 `ctx.attributes.baseScope`），而非只过滤 Order。抽一个共享 filter 函数复用，避免再漏平行路径。补 solver-readout 行级过滤单测。
- FDE 真值判据：`base_manager:常州` token 调 `capacity_rollup/invoke`→`.bases` **只含常州**（length 1）；`bottleneck_matrix` 同；admin 仍见全 12。
- 本体引用与影响：R6 · §7 A6 行级过滤门（query/slice/solver 读出）· §3 `Policy(A6)--行级过滤-->solver 读出` · Base/Line/Process/Equipment。**门覆盖范围变化 → 回写本体 §7 门禁条目（标 solver 读出已闭）。**
- 审核方复验点：BM token 三求解器只见常州 + admin 全见 + 单测绿。

---

## WO-3 · 前端↔DataCore 响应信封契约对齐（P1·R1 反例）

- 缺口：隔离区(`.filter`)/验证引擎(`.map`)两管理页点开即崩 ErrorBoundary——后端返 `{items}` 信封，前端 `endpoints.ts` 谎报裸数组类型，且"刷新"是死恢复按钮。
- 现状锚点：`endpoints.ts:908`（QuarantineRowView[] 谎报）·`:902`（ValidationRunView[]）；后端 `/a/v1/quarantine`→`{items,byReason,total}`、`/a/v1/validation/runs`→`{items}`（app.ts:1109）；`QuarantinePage.tsx:17`、`ValidationPage.tsx:67/110`。
- 怎么建：① `endpoints.ts` 这两条端点返回类型改 `{items:T[]}` 信封并取 `.items`（或加统一 `unwrapItems` 解包）；② 用 `@platform/contracts` 的信封 schema 做**运行时校验**（zod parse），杜绝前端自行重声明形状；③ 顺手审计 `endpoints.ts` 其余 `{items}` 端点是否同类谎报（防同根复发）。
- FDE 真值判据：真浏览器登录 demo → 打开 隔离区 / 验证引擎两页**不崩 ErrorBoundary**、正常渲染（空列表显空态非崩）；实拍。
- 本体引用与影响：R1 contracts-only-shared（前端不重定义契约类型）· R7。**无链路/对象变更 → 不回写**（纯契约对齐）。
- 审核方复验点：两页真渲染不崩 + endpoints.ts 全量 `{items}` 端点核一遍。

---

## WO-4 · 归域门约束为 14 合法域 enum + suggest 不灌 connId + 清垃圾域（P1）

- 缺口：归域门只校存在性不校 14 合法业务域成员 → `setDomain('conn_garbage_xyz')`→publish `{ok:true}` 成幽灵域；AI suggest 把 `connId` 灌进 domain；历史探针垃圾域（CONN_GARBAGE_*/FdeProbeBogus）泄漏对象浏览器/business-domains。
- 现状锚点：`modeling.ts:361` 归域门仅判 `!t.domain||==='unassigned'`；`contracts/datacore.ts:182` `domain:z.string().default('unassigned')` 无 enum；`modeling.ts:223` suggest prompt 塞 `connId:sourceConnId`；合法域 `graphmeta.ts BUSINESS_DOMAINS`(14)。
- 怎么建：① `ModelingSuggestionSchema.domain` 与 `publishDraft` 归域门约束为 `BUSINESS_DOMAINS` enum 成员（非成员→`VALIDATION_ERROR`，列出 14 合法域）；② suggest prompt 移除 connId 字段（connId 入 provenance/sourceBindings，**不**入 domain）；③ 写一次性清理：删已落库的探针垃圾域类型/域分组。
- FDE 真值判据：`setDomain('not_a_domain')`→publish **400 VALIDATION_ERROR**（非 ok:true）；suggest(Equipment 数据集)→draft `objectType.domain` ∈ 14 合法域（非 conn_xxx）；`/admin/object-types`+`/business-domains` **无** CONN_GARBAGE_*/FdeProbe* 垃圾域。
- 本体引用与影响：R12 归域门 · `modeling.publishDraft/suggest` · `BUSINESS_DOMAINS(14)` · A4 按域分组。**门判据收紧（存在性→enum 成员）→ 回写本体 §7 R12 门禁条目。**
- 审核方复验点：三条真 curl（垃圾域被拒 / suggest 归真域 / 浏览器无垃圾域）。

---

## WO-5 · 连接器"测试连接"反映真实可用性（P1·假绿）

- 缺口：sap_erp/salesforce_crm/generic_jdbc/knowledge_base/external_feed 五类 `connections/test` 仅校必填字段、不探活 → `{ok:true}` 谎报可用，建后首次 sync 必 FAILED、schema 500「no adapter implementation yet」。
- 现状锚点：`app.ts:2687` connections/test 仅按 `configSchema.required` 校存在性；这 5 类无 adapter 实现（本体 §2.A 标注）。
- 怎么建：对**无 adapter 实现**的连接器类型，`connections/test` 返 `{ok:false,reason:'该连接器类型尚无 adapter 实现，创建后无法同步'}`（或明确 `stub:true` 标识），使测试结果反映真实可用性；至少不返 ok:true。有 adapter 的类型维持现有探活。
- FDE 真值判据：`connections/test{sap_erp,...}`→`{ok:false,reason:...}`（非 ok:true）；有 adapter 类型（如 file_upload/rest_api 真端点）仍 ok:true。
- 本体引用与影响：Connector/Connection/SyncJob · `Connector--sync-->RawDataset` · UX 真实性。**无新链路 → 不回写**（除非给连接器类型加 `hasAdapter` 元字段 → 回写 §2.A）。
- 审核方复验点：五类 test 不再假绿 + 有 adapter 类型不误伤。

---

## WO-6 · growth/probe 轮询预算覆盖 LLM 时延（P1）

- 缺口：`growth/probe` 5s 轮询预算 << Kimi 10-90s → 可答 in-catalog 问句被误报 `BLOCKED/gapCode:OTHER/人工核实内部错误`，污染 StoryBuildRun。
- 现状锚点：`apps/agentcore/src/server.ts:219` `for(i<100, setTimeout 50ms)`=最长 5s，到期把非终态 ROUTING task 当失败交 classifyGap。
- 怎么建：把 probe 轮询预算提到覆盖 LLM 时延上界（或改异步轮询/SSE 直到终态）；对非终态（ROUTING/EXECUTING_AGENT）task 报"仍在推演"而非 BLOCKED；不把未完成任务误判 gap 写进 StoryBuildRun。前端 maxRounds 可配。
- FDE 真值判据：`growth/probe` 对可答问句（"常州基地影响哪些订单？"）→**非 BLOCKED**（COMPLETED 或诚实"仍在推演"），与 `scenarios/launch` 同问句结果一致。
- 本体引用与影响：`sys.orch.query_to_answer` · G-9 自成长 · StoryBuildRun · GapReport「诚实定级不静默」。**probe 时序语义变 → 回写本体 §8 G-9。**
- 审核方复验点：可答问句不再误判 BLOCKED。

---

## WO-7 · 数据健康新鲜度↔对象 connId 命名空间统一（P2·R13）

- 缺口：9 业务源全显「0 对象」，39 对象挤在 `conn_s7fan…` 一行套合成连接器假新鲜度——`data-health` connId=sourceId(ems/erp/…) vs `ontology/graph` sourceBindings.connId=conn_xxx，两套命名空间永不相交。
- 现状锚点：`/a/v1/data-health`（connId=sourceId）· `ontology/graph` sourceBindings.connId（conn_xxx）· 前端 `SourceSystemOverviewPage`+`Provenance.tsx` join `membersByConn.get(s.connId)`。
- 怎么建：统一 connId 命名空间——让 `sourceBindings.connId` 与 data-health 的 connId 取同一标识（把 sourceId 与 conn_xxx 对齐，或建映射表），使「对象↔源系统+新鲜度」join 真闭合。
- FDE 真值判据：`SourceSystemOverview` 页 9 业务源各 join 到真实对象数（非全 0）、对象的新鲜度来自其真实源系统（非合成假值）。
- 本体引用与影响：DataSourceHealth · M6 链路(970ee3a) · C09 · R13 可溯源。**connId 映射是链路接缝 → 回写本体 §3/§4。**
- 审核方复验点：真渲染源系统总览 join 闭合。

---

## WO-8 · 功能注册表两系统同源（P2）

- 缺口：`view.scenarios` 在 AgentCore 注册(defaultOn) 但 DataCore 缺 → `launcherEnabled` 恒 false + SL2「关 view.scenarios 隐藏启动器」门禁结构性永不可触发。
- 现状锚点：`agentcore/registry.ts:56`（有 view.scenarios）· `datacore/features.ts`（无）· `gate.ts:65`→`server.ts:1946` viewAllowed 因解析集无→false。
- 怎么建：`datacore/features.ts` 补注册 `view.scenarios`（与 AgentCore 同 defaultOn），两系统功能注册表对齐；或把 FEATURE_REGISTRY 收敛到 `@platform/contracts` 共享单一来源（更根因）。
- FDE 真值判据：`/tenants/demo/features` 含 view.scenarios；`/b/v1/scenarios` `launcherEnabled=true`；关掉 view.scenarios → 启动器真隐藏（SL2 可触发）。
- 本体引用与影响：SL2 门禁 · 「Entitlement 先于 authz」「contracts-only-shared 单一来源」· Feature/FeatureSet。**两注册表同源 → 回写本体相关门禁/不变量。**
- 审核方复验点：launcherEnabled 真 + SL2 可触发。

---

## WO-9 · A3 建模链发布类型自动建 coverage 切片（P2·R12 反向闭包）

- 缺口：A3 链发布的类型不自动建 coverage 切片 → `field-coverage` 显 0%、不落本体切片（R12 反向-对象 HARD/反向-data 落空），成建模二等公民。
- 现状锚点：`slice-coverage.ts:33-71` computeFieldCoverage 纯按 slices 算；种子类型靠 `batteryCoverageSlices()` 生成 `coverage_<tk>` 切片；`modeling.publishDraft` 发布新类型时**不**建对应切片。
- 怎么建：`publishDraft` 发布新类型时，同步为其生成单实体全字段 coverage 切片（复用 `batteryCoverageSlices` 同款逻辑）并登记为一等切片，使 A3 链产出类型与种子类型同享 R12 反向闭包。
- FDE 真值判据：经 A3 链发布物化一个新类型（如 derive→publish→materialize）→ `GET /a/v1/field-coverage` 该类型 `coveredFields>0`、`/ontology/slices` 含其 root 切片。
- 本体引用与影响：R12 双向闭包（反向-对象 HARD）· `computeFieldCoverage` · `batteryCoverageSlices`。**回写本体 §7 R12（A3 产出类型纳入反向闭包）。**
- 审核方复验点：真跑 A3 链后该类型 coverage>0。

---

## WO-10 · Eval 真打 LLM + 空用例不报满分（P3）

- 缺口：`/b/v1/evals/run` 恒 `llmMode=MOCK` + 0 用例 `passRate=1`——结构上发现不了 WO-1 的路径B 真故障（mock eval 谐振·绿测试≠能用制度化）。
- 现状锚点：`evals.ts:155`（passRate=total===0?1）· `:164`（llmMode??MOCK）· `server.ts:1725-1729`（REST 不传 llmMode）。
- 怎么建：① 空用例 `passRate` 改 N/A 或 0（不报满分）；② REST 处理器透传 `llmMode` 并提供**真打 LLM** 的 eval 模式，使 `agent_quality` 套件能覆盖路径B 真实故障。
- FDE 真值判据：`evals/run{agent_quality, llmMode:LIVE}`（demo 配 Kimi）→真打 Kimi、对路径B 真故障**能红**（修 WO-1 前红、修后绿）；空用例不报 passRate=1。
- 本体引用与影响：eval 质量回归门 · 诚实边界 · R6（确定性种子边界）。**回写本体 eval 门禁条目。**
- 审核方复验点：eval 真打 + 空用例不满分 + 能复现/回归 WO-1。

---

## WO-11 · UX/语义裂缝合集（P3·5 子项）

逐条修（互不阻塞，可一单内分提交）：
1. **data-health 徽章自相矛盾**：`datahealth.ts:50` 非 critical 源 lag 超阈仍判 OK，但 `thresholdMin` 一律下发 120 → 前端显⚠超阈 + 徽章"正常"矛盾。修：非 critical 源不下发误导 thresholdMin，或徽章/文案按同一 overThreshold 口径。
2. **schema 发现裸 500**：`GET /connections/:id/schema` 外部 4xx→裸 500 INTERNAL_ERROR；对齐 sync 的优雅降级（外部 4xx→可读错误非 500）。
3. **PUT /llm-bindings add-only**：`llmproviders.ts:286` 省略 purpose 不删 + 无 DELETE 路由 → 错绑无法解绑。修：PUT=幂等替换（body 即全集）+ 补 `DELETE /a/v1/llm-bindings/:purpose`。
4. **深链 F5 掉登录**：`ShellLayout.tsx:177-179` 启动内存 token=null 立即跳 /login，refresh cookie 有效却不静默续期。修：启动守卫先尝试 silentRefresh 再判跳登录。
5. **/admin/query-history 孤儿页**：路由+组件在但 NAV_GROUPS 无入口。修：NAV_GROUPS 补入口（或确认顶栏🕐可达即降级标注）。
- FDE 真值判据：逐条真跑/真渲染（徽章一致 / schema 外部失败可读 / 解绑生效 / F5 不掉登录 / query-history 可达）。
- 本体引用与影响：datahealth/C09 · 认证链路（access 内存+refresh cookie）· LlmPurposeBinding API 语义 · 路由表↔NAV 接缝。**深链续期/绑定语义变 → 回写本体相关条目。**
- 审核方复验点：5 子项逐条实拍。

---

## WO-0（收尾·建议）· 防"陈旧 dist"复发 + 越界代码复核

- **CI dist↔源码一致性门**（P1#4 根因·防复发）：S&OP 空壳根因=运行 dist 早于源码修复提交。建议 CI/部署链加「dist 与最新提交一致性」或 real-backend 烟测，拦截陈旧构建。深扫盲区④提示**其他模块也可能潜伏同类陈旧**——建议 dev 跑一轮全模块 dist↔源码核对。
- **越界代码复核**：审核方曾越界亲手写 Kimi 持久化 seed / 补绑用途 / 改 contracts 模板型号（已合并验证·提交 2e96631/8cb0aa0/00ff4c4）。建议 dev agent **复核/接管**这几处使归属正确（功能已审核方真跑验证，复核重在 code review + 归属）。

---

> 证据底本：`docs/HANDOFF-deep-scan-gaps.md`（13 缺口·每条真跑 repro）· 深扫 run `wp24hdnwq`。每单 dev 自行真跑复现缺口再建；审核方按各单「FDE 真值判据」独立复验后才核发闭合。
