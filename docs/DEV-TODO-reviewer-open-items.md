# 待 dev 清单 — 审核方复验后开出的未闭项（可直接转发开发 agent）

> **来源**：审核方（独立真跑复验）对 lastmile / 四链路走查 / WO-1 / A6 的复核结论。每项均**审核方亲手真跑发现/定位**，含 FDE 真值判据；dev 实装 + 自验贴证后，审核方按判据**独立真跑复验**核发闭合。
> **红线（全项通用）**：禁 mock 冒充 / 禁 skip-by-default / 禁门空过 / 禁造假过判据；解析失败/降级**诚实报不静默**；只推 `claude/vigilant-knuth-b1nmxn`；密钥仅 env 不入 git（R5）。

> **🆕 本轮重新入队（用户「都找出来·重新入队」）→ 详见 `docs/REVIEW-hollow-data-iceberg-and-requeue.md`**：空洞数据冰山（哈希/魔数冒充真算）+ 死路 + 已登记未做，全部 📖读源逐行坐实。下表 H/A/B 段即其 §F 优先级总表落地。

| # | 工单 | 优先级 | 状态 | 详细单 |
|---|---|---|---|---|
| **P0-LOCK** | **PG 模式 rule-doc 抽取 100% 崩**：`PgExecutionLockStore` 继承通用 `put` 未传 `extraColumns`→`tryAcquire:213 this.put(rec)` 写 `(id,tenant_id,doc)` 漏 NOT NULL `resource_kind`/`resource_key`→PG 抛→抽取瞬崩 PARTIAL·0 候选（Kimi 没调到）。99e7538 锁首次引爆潜伏 P0；内存 Map.set 无约束故单测全绿 | **P0** | 🆕 待开工 | `REVIEW-T5-pg-execlock-P0-verdict.md`（真 PG 16 复现+逐行根因+经验证伪+修向） |
| **GATE-B** | **本地 `pnpm gates` 只构建 contracts+datacore（2/4 包）**→前端/agentcore tsc-red 本地门照绿（sseScripts:34 即此漏）。CI `gates.yml` 跑全 `pnpm -r build` 是真后盾。修：本地 gates 改跑全 `pnpm -r build`；「完成」判据=CI 绿非本地 test；可加 `css-vars:check` | P2 | 🆕 待开工 | 见 §GATE-B |
| **H** | **B-HIGH** 方案「份额 +Npct」-17 魔数错算·与求解器自己的 ✓/✗ 闸门差 1pct·自相矛盾（`PlanGenerateView.tsx:240` vs `plan.ts:297`/`battery.ts:297` base.share=18） | **P1** | 🆕 待开工 | `REVIEW-hollow-data-iceberg-and-requeue.md` §B-HIGH |
| **A0** | **契约层 dataMode 推广**：`audit_timeline`+13×extended 全族补诚实位（抄 `risk_timeline` 范式·`solvers.ts`+求解器+UI） | **P1** | 🆕 待开工 | 同上 §A0 |
| **A★** | **洛阳红色死路**：点红→裸「暂无数据」（红=kind 哈希非真订单·`risk.ts:28/64`→`RiskBoardView:491`） | **P1** | 🆕 待开工 | 同上 §A-旗舰 |
| **A1** | **audit_timeline 哈希曲线**：整条 90 天曲线+越线日 = kind 名哈希·无徽章（`risk.ts:392-424`） | P2 | 🆕 待开工 | 同上 §A1 |
| **A2-4** | **extended 魔数**：yield 0.95/0.85·creditLimit 5000·loadByWeek 写死·兜底无诚实位（`extended.ts:457/463/472/477`） | P2 | 🆕 待开工 | 同上 §A2-A4 |
| **B-M** | **SopBalance 兜底簇**：`sopConfig` 永不填→默认租户恒走魔数兜底喂 C15/C18 verdict（`SopBalanceView.tsx:26/288/615`）+ 收入增 100 魔数（`PlanGenerateView:238/275`） | P2 | 🆕 待开工 | 同上 §B-MED |
| **S3** | **人机对话入口=配置完整的场景入口**（场景级 Agent 接地：本页数据上下文+规则/意图/skill/MCP/求解器/本体检索）——规划体检问开放式管理问句被「请换个问法」拒答 = 入口未完成预设配置·系统性冰山 | **P1** | 🆕 待开工 | `HANDOFF-scene-entry-agent-config.md`（含本体引用与影响·分阶段·FDE判据） |
| **UI-C** | **深色字对比度**：DAG 节点「2. 检索切片」深色字落深色底（`InferenceProcessDag.module.css:60` `fill:var(--text)` 是**未定义变量 typo**·应 `--txt`；`--text` 全仓零定义→SVG fill 回落黑）+ 全站对比度审计（用户："界面词深色的都调浅色"） | P2 | 🆕 待开工 | 本文件 §UI-C |
| **C-O** | **轨O 主题/配色开关**（U8）——**先真浏览器核「真缺到哪步」再交 dev**（grep 可能漏报） | P3 | 待核 | `HANDOFF-theme-switch-…md` |
| E | **核查·WO-10② 真分** dev 称 0.90·审核方干净 run 仅 0.20·未复现→dev 复核证据/分类器真分 | P3 | 待核 | `REVIEW-WO11-WO10b-verdict.md` |

> **✅ 本轮转闭/转复验（📖读源坐实·原「待补/待开工」过期）**：
> - **WO-Q1 增量3** → **闭合**：真 Kimi 真浏览器实拍 逐字流(`task-streaming`)✓·思考中折叠(`task-reasoning`)✓·`answer.final`切 AnswerCard✓·§3③非死答(标「探索推理·未结构化收尾」)✓。
> - **1C** → **done·待审核方复验闭合**：commit `3e82e91` 真 Kimi `candidateCount=4`（修前 0）。
> - **A6-T2** → **done·待审核方复验闭合**：commit `be4eeb0` + `apps/datacore/test/a6-e2e-socket.test.ts` 已存在。
> - **轨N 可信溯源** → **◐大部接全·待真跑**（**非「0 提交」**·见 COVERAGE 纠偏 D1）：`RuleRef`+`Provenance`+`ProvenanceDag` 全建并接入 7 视图；`OrderChainView:486/495/504` join 已包进 `<RuleRef>`、`:141` 下钻回退已加。

> **已闭（审核方核发）**：WO-1/2/3/**4(+FIX)**/5/**6(活体)**/**8**/**11**/**20** + lastmile + A6尾巴① + 四链路走查 + 结构化接入臂。
> **⚠️ 另需核查**：前端 3 测试（f43.admin-cluster + vle-segment-matrix·15s 超时）dev 称既存——建议另开单独立确认。

## §S3 · 人机对话入口=配置完整的场景入口（P1·系统性·见独立 HANDOFF）

- **完整规格**：`docs/HANDOFF-scene-entry-agent-config.md`（自包含·含《本体引用与影响》G-3/G-9/G-10 + 根因 R1-R4 + SceneAgentSpec 设计 + Phase A-D + FDE 判据）。
- **一句话**：对话入口 mode 落 `WORKFLOW_ONLY`（拒答）/ 回落是通用 agent（未按场景配本页数据+规则+skill/MCP/求解器+本体切片）→ 用户开放式管理问句被「请换个问法」拒。Scenario 一等对象槽位齐但未填满。
- **先做**：Phase A（mode 收口）+ Phase B 试点「规划体检」一个场景做模板。

## §UI-C · 深色字对比度（P2·用户实测"界面词深色的都调浅色"）

- **铁证（审核方📖读源坐实）**：`apps/frontend-shell/src/components/InferenceProcessDag.module.css:60` `.nodeLabel { fill: var(--text); }` —— **`--text` 全仓零定义**（真 token 是 `tokens.css:8 --txt:#e9eef5`），SVG `fill` 回落默认黑 → DAG 节点「2. 检索切片」深色字落深色底（用户实测）。
- **最小修**：`var(--text)`→`var(--txt)`（单字符·零歧义）。**仅此一处** typo（全仓 `var(--text)` 唯一命中）。
- **系统性（用户要"都调"）**：补全站对比度审计——① 加门禁禁 CSS 引用未定义变量（catch typo）② 扫硬编码深色十六进制作文本/SVG fill 的低对比处 ③ 最低对比度断言（WCAG AA）。建议立 `css-vars:check`（未定义 var 即红）。
- **FDE 判据**：真浏览器 DAG 节点标签浅色清晰可读（与深底对比 ≥AA）；门红能挡未定义 var。

---

## §GATE-B · 构建底线门漏洞（P2·tsc-red 当绿出的根因解）

- **根因（审核方读源）**：本地 `pnpm gates`（package.json）只 `pnpm --filter @platform/contracts build` + `pnpm --filter datacore build`——**只构建 4 包中的 2 包**，前端/agentcore 的 `tsc --noEmit` 红在本地门照过（sseScripts:34 即此漏：vitest 走 esbuild 不类型检查，289 测绿但前端构建红）。
- **真后盾在 CI**：`.github/workflows/gates.yml:26` 跑 `pnpm -r build`（全 4 包）+ `:28 pnpm -r test` + `:32 pnpm gates`，每 push 触发——**CI 会红**。缺口=声明「全绿」时未等 CI / 未本地跑全 `pnpm -r build`。
- **修向**：① 本地 `pnpm gates` 把两处 `--filter ... build` 换成 `pnpm -r build`（本地门=CI 口径，消除假信心）；② 纪律：「完成」判据 = CI gates.yml 绿，非本地 test/部分门；③ 开分支保护勾 gates 必过（gates.yml 注释已指引）；④ 可加 `css-vars:check`（引用未定义 CSS 变量即红·见 §UI-C）。
- **FDE 判据**：本地 `pnpm gates` 能复现前端 tsc-red（不再 2/4 漏过）；CI 红时 PR 不可合。

---

## §0 · WO-4-FIX — 归域门 14 域枚举 vs 合成种子域不一致（P0·回归·阻断 demo）

- **现象（审核方真跑）**：WO-4(80e351a) 新构建 `SEED_DEMO=1` 真启动 datacore → **崩 Exit 1·demo 整站起不来**：`publishDraft` 拒 Customer/ARInvoice(`commercial`)、Material/MaterialBatch/PurchaseOrder/CarbonFactor(`supply`)——这些域 ∉ 收紧后的 `BUSINESS_DOMAINS`(14：…sales/material…无 commercial/supply)。
- **根因**：归域门由「存在性」收紧为「∈14」，但 14 枚举与合成电池种子实际域名不一致；dev 单测用合法域 `product`、从不跑真合成种子链 → 漏（绿测试≠能用）。
- **修向**：① 种子域↔14 枚举对齐（commercial→sales / supply→material 或补枚举）；② **加 `SEED_DEMO=1` 真启动冒烟门**（CI 真起 datacore，非仅单测）防复发。
- **FDE 判据**：新构建 `SEED_DEMO=1` 启动不崩+对象浏览器 34 类型在 · setDomain 垃圾域仍 400 · 无垃圾域。
- **连带**：修好才能验 **WO-6 活体**（其判据需 demo 数据面）。

---

## §1 · WO-Q1 — QOS Path B（自由问句/Agent）流式反馈（P1）

- **问题（审核方真跑）**：自由/开放式问句走 Path B Agent 时，**分类期 ~30s 完全静默**（前端只「🔵 仍在执行」），且**终答无 token 级流式**；开放式综合问句（"评估X+三建议"）真跑 **t+142s `BUDGET_EXCEEDED` → 占位「（探索模式未能产出回答）」**、产不出富答案。Path A（命中工作流）不受影响、秒级富答。
- **根因接缝**：`packages/llm-adapters/src/openai.ts` agent 路径**非流式**（`chat.completions.create` 无 `stream`）；Kimi-k2.6 推理模型多轮 loop 慢；`reasoning_content` 被丢弃（只读 `content`）。
- **非**：用途接缝（WO-1 已解）/ 永久挂死（会收敛或降级）。
- **FDE 真值判据**：真浏览器自由问句 → **分类期 ≤5s 见首进度帧**（step DAG/思考态可见，非纯静默）；终答**增量流式**；开放式深问句**收敛或显式降级提示清晰**（非长时间无反馈）。**不改 Path A**。
- **方向（dev 择优）**：① 前端即时呈现 `query.classified` 后的「分析中」step；② 终答 `stream:true` + 解析 `delta.content`；③ 开放式 Path B 预算/收敛调优；④（已部分由 WO-1 缓解：classifier 命中工作流即走快 Path A）。

## §2 · 1C — 规则文档抽取解析率（P2）

- **一句话**：rule-docs 真打 Kimi → `candidateCount=0`（段 FAILED unparseable），规则文档审核台永远空、「文档→规则候选→规则库」正门断首跳。
- **根因**：`parse()`（openai.ts:294）`json_schema + 单次 safeParse·零重试`；Kimi-k2.6 对复杂嵌套抽取 schema 保真不足。
- **方向**：①降抽取 schema 复杂度 + ②parse 加重试（主）+ ③强约束 prompt（辅）。
- **FDE 真值判据**：真 curl 上传 3 条中文规则 → `candidateCount≥3`、段不 FAILED、候选**真进规则库**（`/admin/rules` 可见）、**诚实不造假**。
- **完整规格**：`docs/HANDOFF-1C-rule-extraction-parse-rate.md`（自包含·含本体引用/边界/交付物）。

## §3 · A6-T2 — 全服务 e2e 真 HTTP socket 固化为回归（P3）

- **现状（审核方核）**：A6 尾巴② 的「真 HTTP socket」是 dev 手跑 curl + 审核方本次手跑复现（值逐位吻合·R6 一致），**但 A6 提交未增任何测试**；唯一自动化 `test/a6-value-domains.test.ts` 用 **`app.inject`**（进程内·非真 socket）→ **真 socket 路径无自动回归**。
- **判据**：补一个 `test/a6-e2e-socket.test.ts` 用 `app.listen(0)` 真起 socket + `fetch` 打 `a6-reference`（仿 `test/opt-real-sidecar.integration.test.ts` 真 socket 范式），断言 util 落区间 + autoPlant 越线 + R6 一致；并入 `pnpm --filter datacore test`。**或**：文档把「真 HTTP socket」明确标注为「手测复现（seed 已提交可复跑）」而非「e2e ✅」。
- **注**：尾巴①（电池收编·字节不变）审核方已核发**完全闭合**，不在本清单。

---

## 已闭合（审核方已核发·不在待办，列此备查）
- **lastmile（G-5/G-12/优化融合）**：✅ 闭合（真 CP-SAT 两行业 R14 + whatif + 杀-sidecar 对抗坐实真依赖）·`REVIEW-opensource-fusion-lastmile-verdict.md`。
- **WO-1（LLM 用途接缝）**：1A/1B ✅（结构化错误·不泄漏 SDK 串·Path B 真打 Kimi）；1C 拆出为本清单 §2。
- **A6 尾巴①（电池收编字节不变）**：✅·`REVIEW-A6-tails-verdict.md`。
- **四链路走查**：数据接入(✅ 含结构化接入臂补验) / QOS Path A(✅) / 沙盘确定性推演(✅) / Action 审批流(✅)·`REVIEW-four-chains-live-walkthrough.md`。
