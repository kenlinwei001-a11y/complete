# TODO · 系统协同进化路线（按重要程度排序）

> 状态：✅ 已完成 · 🔄 进行中 · ⬜ 待办。断点编号见 `docs/SYSTEM-ONTOLOGY.md` §8；域/切片见 §10；不变量 R1–R13 见 §5。
> 纪律：每批 `pnpm -r build && test` + `pnpm gates`(ontology:check+chain:check) 全绿；改链路/事件/不变量回写系统本体。
> 哲学北极星：**可信赖的推演 = 出处 + 推导可当场亮出**（R13）；输入侧"字段全建模"(R12) ⊕ 输出侧"结论可溯源"(R13)。

## 🎯 目标达成度对照（2026-06-17 评审 —— 对照用户为本体设定的目标）

> 把"用户描述的本体目标 → 现状判定 → 未达成 to-do"一张表理清。✅=达成 · ◐=部分 · ⬜=未达成。明细见各自章节，本表只做总账与未达项指向。

| 目标 | 判定 | 未达成 to-do（指向明细） |
|---|---|---|
| **G1 系统本体=接线大脑**（单一来源/read-first/回写/守"绿测试≠能用"/四门禁） | ✅ 基本达成 | ⬜ **本体落库自反 dogfooding**（把本体注册为平台对象，用平台切片/规则/推演分析平台自身）→ Tier 4 #12/#13/#14（⏸ 暂缓） |
| **G2 Loop**（改数据/规则 → 引用方 workflow/agent/场景 自动更新） | ✅ 达成 | —（引用闭合上架门 + invalidateForEvent + D-29 + rule/solver 反查已闭环） |
| **G3 推演结果展示一致性+交叉验证痕迹，让用户信任** | ✅ 达成（本轮交付） | ◐ 余项：统一 Decision Trace 可导出制品 → 见「实时验证审计层」组 |
| **G4 四不变量纪律**（R11 全链闭包 / R12 双向闭包 / R13 溯源 / R14 无业务常数） | ✅ 达成 | —（四门禁全绿；字段全建模门升 HARD 已落） |
| **G5 本体驱动 Agent 架构（6 模块）** | ◐ 部分（约 50–55%） | 见 `💭 to-do consider` 全部七组（感知层/语义解析/可验证规划/约束执行/实时审计/索引记忆 + 形式化本体）；两根本差距：形式化本体(OWL/DL) + 动态语义解析路线（均待议、属范式取舍） |

> **总判定**：作为"治理大脑 + 可信赖推演平台"——**基本达成**（唯缺 dogfooding 落库）；作为"形式化本体驱动 Agent"——**达成约一半**，余项是已入册的范式选择，非失误。

## 🚀 主线 · 需求拉动的自成长发动机（PRD 已立，2026-06-17）

> `docs/PRD-demand-pulled-growth-engine.md`（含《本体引用与影响》R3/R4/R6/R10/R11/R13·G-1/G-8）。把"客户明确问题"当燃料：QOS缺口探针实跑→GapReport→自动补(数据真人正门/结构/求解器B兜底)→缺功能C骨架工单→厂商中立 code-agent 施工→LOOP收敛→成长账本。融合 OPERATING-MODEL 融合层 P5。

- ✅ **P1 已落（2026-06-17）** QOS 缺口探针 + GapReport：`classifyGap`(终态→7码分类,确定性纯函数) + `POST /api/v1/growth/probe`(提交→等终态→分类)；growth-probe ×7 回归；本体 §2 回写 GapReport。静态闭包→运行时实跑(验收 G-8/G-1)
- ✅ **P2 已落（2026-06-17）** 缺数据真人正门自动补 `POST /a/v1/growth/fill-data`（确定性生成 CSV→经公开上传门 connectors.upload 导入→RawDataset 可见，与手动上传无差别，R6 字节级一致；growth-fill ×2）+ **就地 Action 审批面板**（DataBuilderPage 内嵌 PENDING_APPROVAL 列表 + 页内批准/驳回，无跳转；f44 ×1）；本体 §2 回写
- ✅ **P3 已落（2026-06-17）** LOOP `POST /api/v1/growth/run`(探针→补齐→重跑→收敛,K有界前端可配 maxRounds) + `runGrowthLoop`(纯编排) + 补法分派(缺数据真人正门真实补/否则出工单→BOUNDARY) + fillData DataCore客户端(http+mock)；终态 CONVERGED/BOUNDARY/MAX_ROUNDS；growth-loop ×5；本体§2回写。余: scaffold切片/规则/意图 + generic-inference 兜底的"真实自动补"待 P4(当前出工单)
- ✅ **P4 部分落（2026-06-17）** GrowthTicket 契约(厂商中立施工:I/O契约+本体引用+验收+OPEN→VERIFIED) + 成长账本 GrowthLedgerEntry(demand-indexed) 持久化(仓储四处+migration007) + loop 运行落账+缺功能落工单 + `GET /api/v1/growth/{ledger,tickets}`；growth-loop 集成验证。余: C 骨架(按问句反推求解器 I/O 自动生成 stub) + scaffold/兜底真实自动补
- ✅ **P5 部分落（2026-06-17）** code-agent 执行器接缝：工单施工闭环 `POST /api/v1/growth/tickets/:id/{claim,submit,verify}`(claim→IN_PROGRESS/submit→IN_REVIEW/verify=重跑问句→可答则 VERIFIED 否则停 IN_REVIEW 回带新缺口) + CLI 活查询面 `platform tickets/claim/grow`(厂商中立·人与 code agent 共用) + 推送事件 `growth.ticket_opened`(§4 L13)+拉兜底 GET tickets；growth-tickets ×2；本体§4回写。余: MCP 工具暴露(当前 REST/CLI 为厂商中立基线) + 真实施工(agent 写代码)接真实 code-agent 运行时
- ✅ **P6 部分落（2026-06-17）** 自成长驾驶舱前端 `/admin/growth`（GrowthCockpitPage：运行 LOOP→GapReport 逐轮+收敛终态 / 成长账本 demand-indexed / 工单看板+认领 / 需求可答率指标）+ `/b/v1/growth` 别名；f45 ×1。余: 瀑布流逐产物 HITL（数据构建发动机页）+ 全链闭包可视化（PRD §16，待后续）
- ⬜ **前端·构建驾驶舱**（PRD §16，收编历史未落地页面缺口）：`DataBuilderPage.tsx` 现仅"七阶段状态灯+闭包数字+JSON dump"，**远落后 `PRD-unified-build-engine.md` §1.1.8/§5.3 的瀑布流逐产物HITL**；GapReport/就地审批/真人正门可视化/成长账本/工单看板全未建

## 🚀 主线 · 故事驱动全栈倒推与跨系统闭包 G-8（PRD v0.2，2026-06-18 · 发动机「构建期/故事驱动」燃料口）

> `docs/PRD-fullstack-story-build-g8.md`（v0.2，已并入另一并行稿《故事先行入口与全栈 scaffold》：吸收其分工边界表/单事件足迹/StoryBuildRun 命名/零冲突追加回写纪律。含《本体引用与影响》R2/R3/R4/R5/R6/R8/R11/R12·G-8主修/G-1/G-5/G-6/G-3/G-7）。与上面 demand-pulled（运行期/问句驱动燃料口，**母体**）**归一为同一发动机**：共用 `classifyGap` 7码/`GapReport`/`runGrowthLoop`/GrowthTicket/GrowthLedger；`StoryBuildRun`⊕`GrowthLedgerEntry`=同一"历史推演记录"两面（分工边界表 + 归一三点见 g8 §9）。把"数据发动机"从「故事→DataCore 栈」升级为「故事→全栈(数据/本体/切片/规则/求解器 ⊕ 意图/计划/工作流/技能/Agent/MCP/场景)」跨系统倒推编译器。**全部为 backlog（尚未动工）**，逐期对齐 g8 §8 分期。
>
> **覆盖盲区登记（2026-06-18，用户复核 17 原子需求矩阵后补）**：以下能力此前**既不在 demand-pulled P1–P6，也不在 TODO**——正是 `prd:coverage` 盲区在 g8 层面的复发（PRD 有但未跟踪）。现逐条拉进 backlog：

- ✅ **g8-P1（A 栈先行·G-6 残留收口）已落（2026-06-18）**：① `StoryBuildRun`/`InputManifest`/`ScaffoldReceipt` 契约 + 仓储双实现（R9 四处 + migration015）；② `POST/GET /a/v1/databuilder/runs` 端点（`runStory` 复用既有七阶段 run + 仓储差集精确捕获产出连接器/数据集）；③ 历史推演记录前端时间线（DataBuilderPage `sbr-timeline`，逐 run 展开见闭包/全栈计划/产出源数据→连接器页下钻）；④ **rawin 去模板化收口 G-6 残留**：删 databuilder 私有 `genCsv`/`genCell`，统一到合成模块 `synthetic/schema-gen.ts generateFromSchema`（schema 驱动·FNV-1a 同哈希字节级一致，DB2/DB4 无漂移证实）。本体 §2 回写 StoryBuildRun。回归：storybuildrun-repo ×2 · databuilder SBR1/SBR2 · schema-gen ×3 · f46 ×1【覆盖需求 O 过程数据持久化 + G-6 收口】
- ✅ **g8-P2（倒推页面录入·自描述表单）已落（2026-06-18）**：`StoryRunRequest`(stage=manifest)/`StoryInputsBody` 契约 + `previewStory`（comprehend → 产 InputManifest：STORY 抽取对象类型/ASK_USER seed/REUSE_EXISTING 既有连接器 → PENDING_INPUT 不建域）+ `PATCH /a/v1/databuilder/runs/:id/inputs`（补录 → 续跑既有七阶段建域 → 同条记录转 SUCCEEDED）+ 前端 `ManifestForm`（按 source 动态渲染补录表单，DataBuilderPage 时间线内 PENDING_INPUT 项内联，无跳转）。回归：databuilder SBR3 · f46 P2 ×1【覆盖需求 J 倒推页面录入项 —— 唯 g8 有】
- ✅ **g8-P3（跨系统闭包·G-8 核心）已落（2026-06-18）**：① `BuildPlanSchema` 扩 8 B 栈需求字段（全 `.default([])`）+ comprehend 故事倒推全栈（求解器→计划/意图/场景，对象→切片）；② AgentCore `POST /b/v1/internal/scaffold`（`x-service-token` 守闸,用户 JWT/无 token→403 R8;幂等 `catalog.createPlan/createIntent`+`scenarios.upsert` 建 DRAFT;DRAFT-aware 无死路门 `resolvePlanByRef(forValidation)`→ScaffoldReceipt）;③ DataCore `runStory`/`submitStoryInputs` closure 后经 SERVICE_TOKEN 下发（app.ts 注入 scaffoldClient,未配 AGENTCORE_BASE_URL 则跳过）,`fullChainOk` 并入 StoryBuildRun 终态（断链→FAILED,R11 跨系统）;④ 前端时间线显示跨系统 scaffold 全链闭合/制品状态。本体 §2/§8(G-8 大部闭合)回写。回归:scaffold ×3(agentcore) + databuilder SBR4 + f46 跨系统断言。**余**：scaffold 前置到 A publish 阻断（当前记于终态,A 数据已建）；workflow/skill/agent/mcp scaffold（comprehend 当前只倒推 WORKFLOW 脊柱意图/计划/场景）【覆盖需求 D/E/F agent/skill/mcp 倒推 + 全链闭包】
- ✅ **g8-P4（自检/压测副产物）已落（2026-06-18）**：① **功能缺失自检** `selfCheckGaps`（纯函数:A 栈闭包 CHAIN→SOLVER_NOT_FOUND/SHAPE→SHAPE_MISMATCH/FORWARD→NO_SLICE + B 栈 scaffold MISSING→NO_INTENT/NO_PLAN/NO_CAPABILITY,聚合为 7 码 GapReport 附 StoryBuildRun.gapReport;干净建域→ANSWERABLE 0 缺口）;② **自动生成压测** `POST /a/v1/databuilder/stress`（跑一组脚本统计覆盖率/失败率,复用 BackfillReport）;③ 前端时间线显示自检 verdict + 缺口码。回归:selfcheck ×3 + databuilder SBR6 + f46 自检断言【覆盖需求 L 压测 + M 自检】
- ✅ **g8-P5（推演回填 + 自动脚本）已落（2026-06-18）**：① **故事脚本自动生成器** `deriveGeneratedScripts`（从平台能力目录确定性派生:求解器能力覆盖 ⊕ 规则覆盖,programmatic 无写死脚本）+ `GET /a/v1/databuilder/generate-scripts` + 前端「自动生成脚本压测」按钮（generate→stress→报告）;② **推演回填** `runInference`（建域后以求解器在建好对象上跑一次推演 → answer 摘要回填 StoryBuildRun.answer,best-effort 确定性;`inference` 可选,backfill 默认开 = 闭环 故事→建域→推演→答案）+ 前端时间线显示推演答案。回归:databuilder SBR7 + f46 P5/answer【覆盖需求 B 脚本自动生成 + 推演答案回填】
- ✅ **g8 主线全部收口（P1–P6 已落）**：故事→全栈倒推→跨系统 scaffold→闭包→自检/压测→存量回填→推演回填,数据发动机成为"持续输入/自动生成故事脚本→倒推一切→历史推演记录"的发动机。余技术债见各 P 的「余」注（scaffold 前置 publish 阻断 / workflow·skill·agent·mcp scaffold 全集）。
- ✅ **g8-P6（存量回填·覆盖已有场景）已落（2026-06-18）**：`deriveBackfillScripts`（comprehend 把既有推演能力 affected_orders=风险推演/capacity_forecast=产能推演——即推演与风险+规划与平衡两模块——逆向导出为确定性故事脚本,programmatic 无写死脚本）+ `POST /a/v1/databuilder/backfill`（逐条经 g8 主链 runStory 建域 → 每个存量推演能力获 StoryBuildRun 血缘:源数据/图谱/意图/计划/场景可下钻;断的标 MISSING/FAILED）+ `BackfillReport`（total/succeeded/failed = 首次全量压测覆盖率/失败率）+ 前端「存量回填（首次全量压测）」按钮 + 压测报告横幅。回归:databuilder SBR5 + f46 P6。**不删手敲种子,并行补血缘**【覆盖需求 P 存量覆盖 —— demand-pulled 完全缺】
- 📌 **归一执行（2026-06-18 已落文档侧）**：g8 PRD 落盘 + demand-pulled PRD 顶部加归一交叉引用 + 本主线入册。**代码侧归一**（StoryBuildRun↔GrowthLedger 关联实现、入口端点内外层串接）随 g8-P1/P5 落地。

## 🩺 治理缺陷 · PRD-DoD↔实现 coverage 盲区（2026-06-17 发现，根因级）

> **触发**：用户问"数据构建发动机页面差距这么大、PRD 有记录、却不在 TODO？其他模块也类似"。**根因**：`prd:check` 只验"PRD↔本体(R/G) 引用完整 + 制品锚点入图"，**不验 PRD 的《验收/DoD》是否真被实现**。于是"PRD 写了需求→从未实现→无门禁察觉→未进 TODO"是**结构性盲区**——地图记了想要的疆域，但没有机制把"未建的部分"拉进 backlog。这正是本平台自身缺"需求↔缺口↔补"闭环的铁证（= 自成长发动机要解的问题，作用于平台自己的开发）。

- ✅ **一次性审计已跑（2026-06-17，逐 PRD 对照代码核实）**：结果见下表。**审计本身的元教训**：4 个并行子代理审计有 ~25% 误判率（既有误报"已建说成没建"，也有漏报"没建说成已建"），**唯一可信的是对代码的 ground-truth grep 核实**——这反过来再次证明"手工/agent 审计会漂移、必须门禁化"。
- ✅ **门禁化止血已落（2026-06-17）**：`prd:coverage`（`scripts/check-prd-coverage.mjs`，并入 `pnpm gates`，WARN-only）——解析每篇 PRD 验收段的验收项编号 → 测试语料查引用 → 报"零测试引用"项（写 `docs/prd-coverage-index.json`）。**首跑：119 验收项 / 97 有测试 / 22 零引用**。启发式（测试引用≠完整实现），但"零引用"是"已文档化但未测/很可能未实现"的强信号。**它当场纠正了上面手工审计的误报**：OC1/OC9 实有测试引用（手工 grep 错词致"=0"假阳）——再次坐实"机器核实 > 手工 grep"。
- 注：这本身是"需求拉动自成长发动机"在**平台自我开发**维度的最小实例——PRD-DoD 未实现 = 一张平台自己的缺口工单

### prd:coverage 首跑 · 零测试引用验收项（机器核实，22 项）

- ✅ **TR1–TR8**（dataflow-loop-closure）：数据流轨迹验收测试**已补齐（2026-06-17）** —— TR1/2/4/5/6/7/8 在 `datacore/test/tr-dataflow.test.ts`（上传→落地→推演命中 / 规则拦截 / 采纳→审批→写回 / tick 联动 / 学习环 / 权限过滤 / 合成同源相等），TR3 在 `agentcore/test/tr-scenario.test.ts`（建场景→发布→启动器→QOS 推演）。`prd:coverage` 零引用 22→14。
- ✅ **VL2/VL4/VL5/VL7**（validation-loop）：**已补齐（2026-06-17）** —— `datacore/test/vle-acceptance.test.ts`：VL2 注入 broken_aggregate→参照比对红 · VL4 闭环收敛(提案 MAPE↓→批准应用→参数+1) · VL5 扰动后一次性租户隔离→重跑回基线 · VL7 参照预言机对被测求解器零 import。`prd:coverage` 零引用 14→10。
- ◐ **剩余零引用 10 项**：GE-A..GE-H（自成长发动机未来验收，随 P2+ 落地，正确）+ A9 ×2（模块名"A9 数据工坊"误匹配噪声，非真缺口）。
- 注：`prd:coverage` 的"已覆盖"只证"有测试引用"，**不证前端页存在**——七个管理页缺失（上表）后端有测试但无 UI，是该启发式的已知盲区，仍以上表 UI 审计为准。

### 审计结果 · 已文档化但未实现（全部经 grep 核实，✅=已证实未建 / ◐=部分）

| 模块·PRD | 未建项（代码核实） | 证据 |
|---|---|---|
| **管理页整簇**（admin-console-closure §6） | **✅ 7/7 全补（2026-06-17，f43 回归）**：`/admin/validation` · `/admin/quarantine` · `/admin/notifications` · `/admin/domains` · `/admin/evals` · `/admin/slices`(+GET 列表端点) · **`/admin/merge`（OC1 实体解析引擎从零自建：merge_candidates/object_merges 仓储四处 + 归一名称匹配扫描 + 合并(golden存活/mergedInto/links重指) + 72h unmerge；entity-resolution datacore 回归）** | 7 页全接真实后端 |
| **统一构建发动机**（unified-build-engine P2–P6） | ✅ `POST build/scaffold` · `build/preview` · `data-templates` 端点 = 0 匹配；BuildPlan 不含 AgentCore 栈；瀑布流逐产物 HITL 前端 | grep 0；已收编进自成长发动机 PRD §16 |
| **本体浏览器+字段覆盖**（ontology-browser-field-coverage） | ✅ `GET /a/v1/ontology/browser` 端点 = 0；`coverage:check` CI 门 = 0（注：字段全建模门 requireFullCoverage 已建、CSV 模版前端可下） | grep 0 |
| **运营完备性**（operational-completeness） | ◐ OC1 实体解析✅已建(本轮) · OC7 LLM 成本配额 = 0 · OC9 工厂日历 = 0（OC8 通知/OC4 隔离区后端有·前端缺，归管理页组） | grep 0 |
| **能力路由**（capability-routing，G-7） | ✅ 等价能力故障转移 capabilityGroup/groupPriority = 0；◐ `load_tools` 工具未见（呼应本体 G-7 ◐，TODO #10 已暂缓） | grep 0 |
| **数据流闭环**（dataflow-loop-closure §5） | ✅ **TR1–TR8 已补齐（2026-06-17）**：tr-dataflow.test(7)+tr-scenario.test(TR3)；prd:coverage 零引用 22→14。◐ DL6–DL10 事件接线增强待后续 | tr-dataflow/tr-scenario 回归 |
| **VLE**（validation-loop） | ✅ 前端页已补(管理页组) + **VL2/4/5/7 验收测试已补**(vle-acceptance.test) | prd:coverage VL* 全清 |
| **活数据可溯**（live-traceable-data） | ◐ `lineage/task` 端点存否不明（1 弱匹配）；溯源抽屉 UI 部分（Provenance 组件已存在） | 需复核，不武断 |

> **子代理误报（已证伪，不入册）**：`query_timeseries_agg` 工具 · `SUSTAIN` 规则 · 确定性建模 derive · coverage 端点 · **`debattery:check`** · VLE 后端 · ScenarioCard 一等对象 —— 这些**都已建**。
>
> **去重说明**：build-engine P2–P6 已在自成长发动机 PRD §16 + 主线 P1–P6 跟踪；capability-routing = G-7（TODO #10 已暂缓）。**真正新暴露、此前完全未跟踪的**是：① **七个管理页整簇**（最大块）② OC1/OC7/OC9 运营完备性 ③ TR1–TR8 轨迹测试 ④ ontology/browser 端点 + coverage:check 门。



## ✅ 已完成（基线 + 本轮）
- 系统本体 `SYSTEM-ONTOLOGY.md` §1–§10 + 治理闭环（铁律0 / SessionStart 钩子 / `/ontology` / `ontology:check` / `chain:check` / PRD 模板）
- 运行模型 `OPERATING-MODEL.md`；审核 `AUDIT-0614-fullchain.md`
- **PRD 全集**：统一构建发动机 · 场景启动器 · 本体浏览器/字段全建模 · 活数据可溯
- **参考原型完整盘点** `REFERENCE-HTML-INVENTORY.md`（逐节/逐注册表 + 采纳决策 + 信任哲学章 + 附录A溯源backlog）
- **断点修复**：G-1（20场景接通）· G-2（跨服务形状）· G-4（前端自助创建）· G-7（model 显示）
- **CLI 对话入口** `platform-cli.mjs`（login/ask/SSE/clarification/approve）
- **场景启动器 P1**：`presetSlots` 注入通道 + fillSlots 消费 + `POST /b/v1/scenarios/:key/launch` + 零反问门（20/20）
- **活数据可溯 P1**：合成→合成源连接器→RawDataset/RawRow→物化，对象 origin 记 rawDatasetId/rowIdx（数据源页可见原始数据）
- **活数据可溯 P2**：对象 lineage 端点 `GET /a/v1/lineage/object/:type/:id`（对象→原始行→RawDataset→连接器+派生口径）
- **活数据可溯 P3 增量1**：`<Provenance>` 悬浮溯源（接 LedgerView）+ 数据源原始表（FieldProfilePage 已现成）
- **R13「结论可溯源」+ R-一致** 固化进本体；`<Provenance>` 升**六要素**（来源/新鲜度/推导/输入因子/关联规则/备注）+ 新鲜度降级（C09）
- **项目推演 DAG 放大**：全宽独占 + maxHeight 480→760 + 节点/字号加大（借鉴 HTML 项目推演布局）

## ✅ Tier 0.5 · 端到端活数据 + 全链可溯（地基，已完成）
- ✅ **0. 活数据可溯 收尾**（`docs/PRD-live-traceable-data.md`）
  - ✅ 结果→入参对象 lineage（`GET /api/v1/queries/:taskId/lineage`：selectedObjects + objectRef 槽位 → 每对象再溯回原始数据）
  - ✅ `DATA_HEALTH` 新鲜度统一来源：`<Provenance>` 的 fresh 接全局 `data-health`（按 connId/源系统名匹配，源延迟→全链一致降级 + C09 影响 P90 0.93→0.90）
  - ✅ `<RuleRef code>` 规则锚点两跳（数字→规则→规则详情，接 fetchRules）
  - ✅ 合并静态 F5 溯源：ProvenancePopover 规则段改用共享 `<RuleRef>`（两套溯源统一规则机制）
  - 注：P1（合成落原始表）/P2（对象 lineage 端点）/P3增量1（Provenance+数据源原始表）已先期完成

## 🥇 Tier 1 · 机制定型
- ✅ **1. 全链闭包门 R11 完整版**：✅ chain:check · ✅ **CHAIN 维**（求解器注册）· ✅ **SHAPE 维（BuildPlan 扩 AgentCore 渲染栈）**——`SOLVER_OUTPUT_SHAPES` 全 **22/22 注册求解器覆盖**（5 个契约 schema `.shape` 权威 + 17 个取自实现）+ `BuildPlan.solverNeeds[].renderBindings` 渲染契约；`validateClosure` 校验渲染绑定 ⊆ 输出形状（不命中即 SHAPE FAIL，建图期挡 G-2）；**chain:check SHAPE 覆盖升为门**（新求解器缺形状即红）；R11-SHAPE ×6 回归；本体 §5/§7/§8 回写。✅ **余项已落（增强）**：`deriveRenderBindings(steps)` 从 ExecutionPlan render_answer 自动派生渲染契约（solverKey→输出字段，取代手工声明，与 closure.ts SHAPE 同源）；derive-render-bindings ×3 回归
- ✅ **2. PRD库结构化**：✅ **`prd:check` 门 + 机器可读索引**（`scripts/check-prd-ontology.mjs` 解析 35 篇 PRD 的《本体引用》§0 → `docs/prd-ontology-index.json`：PRD↔不变量(R)/断点(G) 映射 + 断点 PRD 覆盖(8/8) + 缺口；悬空引用即红；并入 `pnpm gates`）—— PRD 入图 ✅ ·《本体引用》机器可解析 ✅ · 需求↔制品↔缺口可查 ✅。✅ **余项已落**：28 篇遗留 PRD 补 §0（35/35 全含）+ **制品↔需求双向**（`byArtifact` 反向索引：实现文件→文档化它的 PRD，入 prd-ontology-index.json）

## 🥈 Tier 2 · 可信赖的推演（Palantir UX 哲学贯彻）— 本轮主线延伸
- 🔄 **3. 项目推演 = 可点穿/可验证的对象链**（哲学 #1/#3/#6）
  - ✅ `<Provenance>` 升通用（对象 lineage 模式 ⊕ 作者标注模式）；P50/P90 结论数字接六要素溯源
  - ✅ **DAG 节点点击 → 抽屉**（`DagNodeDrawer`）：判定逻辑/推导公式/输入数据(含来源+新鲜度)/关联规则（`dagNodeDetail` 每节点六要素 + 规则两跳 RuleRef；每节点同一份 out，数字一致可溯）；f18 回归（聚合求解器/结论节点点穿）
  - ✅ 缺口/毛利 等其余结论数字补六要素溯源（已随 #4 四视图全覆盖）
  - ✅ **DAG 可拖拽/缩放（直接操纵）**：PmDag 加 viewBox 变换——拖拽平移 + 滚轮(以光标为锚)/按钮(＋/－/⟲)缩放；拖拽位移超阈值抑制节点点穿（区分拖与点）；f18 缩放回归
  - ✅ 结论 → 采纳 Action 写回（项目推演 what-if 采纳产能保障方案 → Action 已落 f19；S&OP 定稿走 Action f17；核心推演结论闭环完成，其余视图结论→Action 为按需增量、非阻塞）
- ✅ **4. 结论溯源覆盖 backlog**（附录A 优先级，全完成）：✅ **S&OP 六卡（三线 需求/供给/缺口 + 收入/毛利/现金）统一走共享 `<Provenance>` 六要素**（取代原 2 要素自绘浮层 → R-一致「一个事实一个出处」；C21/C15/C18 规则两跳；f17 回归改悬浮断言）· ✅ **产能推演峰值/对策量**（项目推演 what-if 对策后P50 六要素 + C03/C08 截顶）· ✅ **订单全链关键数字**（受影响量/营收六要素，财务/订单域）· ✅ **体检结构毛利率**（plan_audit gmStruct 六要素 + C15 口径）—— 至此四大视图结论数字全接共享溯源机制
- ✅ **5. 驾驶舱 widget 升级**（借鉴 HTML dash，全完成）：✅ **富出处悬浮**（widget ⓘ 升共享 `<Provenance>` 六要素）· ✅ **三线偏差复合图**（chartKind `trideviation`：需求/供给/缺口逐月折线 + 偏差柱；数据源 `HistoryBundle.deviation`，后端 bundle 从 trend+危机窗口派生、真实可溯）· ✅ **问题聚合摘要**（type `summary`：`affected_orders` problems[] 四类归并卡）；f37 dash 回归

## 🥉 Tier 3 · 场景启动器 + 本体浏览器（产品可用性）
- 🔄 **6. 场景启动器 P2/P3**（`docs/PRD-scenario-launcher.md`，P1 已完成）
  - ✅ **P2：`Scenario` 升一等对象**（修 G-3 模型倒置）：契约 `ScenarioSchema` + 仓储四处（repos/memory/pg/migration006）+ 出厂幂等 upsert + DRAFT→PUBLISHED→RETIRED + `scenario.*` 事件 + 管理 CRUD（`/scenarios/manage`·POST/PUT·publish·retire）；GET/launch 改 repo 驱动；本体 §2/§4/§8 回写
  - 🔄 **P3：场景配置编辑器 + 启动器三入口**：✅ **场景配置编辑器**（场景为主键 UI——场景第一列 + mode 选择 + 默认 agent + 落点视图闭合 + presetContext 编辑器 + 状态机；治理铁律全展示可配；f37）· ✅ **按域目录墙**（`ScenarioLauncherPage` /scenarios，域分组卡片 + ▶启动）· ✅ **⌘K 命令面板**（`CommandPalette` 全局快捷键搜场景启动）· ✅ 启动复用 `useScenarioLaunch`（注入 presetContext + submitQuery + 对话坞 SSE）+ 左导航入口；f39 回归。⬜ 余：首页高频区（4–6 张按角色高频卡）
  - ✅ **引用闭合「无死路」+ 上架门**：`scenarioClosure`（intent→plan→agent 全配置好，断链拒发布 409）+ manage 就绪态 + `computeReferences` 纳入 Scenario（Agent/Workflow 页可见"被场景引用"）+ ScenesPage 引用闭合列
  - ✅ **响应式失效环（Loop 前端消费端）**：`invalidateForEvent`（本体 §4 event→queryKey）——规则/数据/工作流发布 → 失效引用方 agent/workflow/场景缓存自动重取；接入 RulesPage/ScenesPage 发布；f38 回归
  - ✅ **首页高频区**（`HomePage` 替换裸重定向）：高频场景卡一键启动 + 业务视图快捷入口 + 全部场景入口；至此 P3 启动器三入口（⌘K + 目录墙 + 首页高频）全齐；f39 回归
  - ✅ **命中校验 #2 完成**：intentKey（场景编辑器 datalist + 未命中警示）+ **suggestedQuestions**（QueryDock 建议问句优先取本视图已发布场景的触发问句——经引用闭合验证、点了必命中不落死路）；workflow solverKey/ruleId 闭合（B→A 探针）+ computeReferences 纳入 Scenario。✅ **余项已落**：`computeReferences` 扩 **rule/solver 反查**（`GET /b/v1/rules/:key/references`·`/solvers/:key/references`——改规则/求解器→哪些 agent/workflow/plan/scenario 引用它）；references-rule-solver ×3 回归
- 🔄 **7. 本体浏览器 + 字段全建模门 + 半自动建模引擎**（`docs/PRD-ontology-browser-field-coverage.md`）—— 大
  - **参考软件**：[`jingw2/nano-ontoprompt`](https://github.com/jingw2/nano-ontoprompt)（半自动·基于数据的本体建模；v2 数据集成链 Data→Raw→Transform→Curated→Ontology Mapping，确定性映射 dataset→entity / column→property / FK→link + 基数推断）— 融进 A3 `modeling.ts`；+ 参考原型 `reference-prototype-decision-platform.html` 的节点检视器/CSV模板/覆盖徽章 UI
  - ✅ **确定性映射管线**（`deriveModelingSuggestion`：dataset→ObjectType · column→PropertyDef(类型按画像推断) · FK→ref+LinkType · PK=唯一率最高字段；`POST /a/v1/modeling/derive` 无 LLM 出草稿，构造上 100% 覆盖）
  - ✅ **字段全建模门**（`computeFieldCoverage` + `GET /a/v1/modeling/drafts/:id/coverage`；publish `requireFullCoverage` 开门则未建模字段阻断；R12 落地。OM4/OM5/OM6 回归）· ✅ **升 HARD 默认 + 前端开关已落**：ModelingPage 字段全建模门默认勾选（HARD by R12），取消勾选可放宽；f10 回归更新
  - 🔄 **本体浏览器**（域分组图谱已有）：✅ **节点检视器增强**（OntologyGraphView Inspector）——字段全建模覆盖徽章（源/派生/手工占比，R12）+ 每字段来源溯源（← 源字段 / 派生 / 手工）+ **CSV 数据模版下载**（借鉴参考原型"每字段100%本体建模覆盖 + 数据模版下载"）；f7 回归
  - ✅ **确定性映射前端工作台**：ModelingPage 新建草案加「确定性建模（全字段）」入口（接 `/modeling/derive`，无 LLM·构造 100% 覆盖）+ **字段全建模覆盖徽章**（接 `/coverage`：modeled/total + 未建模清单）+ **字段全建模门发布开关**（`requireFullCoverage`，勾选则未建模字段阻断发布）；f10 回归（确定性建模→100%→门控发布）

## 🔧 Tier 3.5 · 剩余断点
- 🔄 **8. G-5 去电池锁死 / 多租户配置层**（本轮审计量化：范围远超"一行断点"，**撑不起其他租户/行业**）—— 大 —— **PRD 已出** `docs/PRD-de-battery-multitenant-config.md`（含 R14「应用层无业务常数」+ `debattery:check` 门）；本体 §5(R14)/§8(G-5) 已回写
  - **8a 视图结构写死**：✅ PlanAudit 字段组 · ✅ PlanGenerate 目标字段 · ✅ **项目推演 DAG 驱动因子层**（回答"DAG 哪里可配"）· ✅ OrderChain 分类/配色 · ✅ Quarterly 缺口档位 · ✅ GeoMap 利用率阈值 · ✅ **后端 VIEW_DEFS 真下发**（前后端闭环，改后端配置界面就变）· 余项（**纯颜色映射、低价值**，建议交 `debattery:check` 盘出后批量）：RiskBoard 色阶 · GeoMap 定位色(POSITION_COLORS) · AnnualScenario 配色/YEAR · SopBalance 五步标签
  - **8b 业务数据写死** ✅ **全部完成 + 后端闭环**：ProjectSim 型号（**接真实 Model 对象**，消对不齐）/地址/物流（`simConfig`）· GeoMap 坐标（`Base.props.lon/lat`）· Calibration 基地（Base 对象）· SopBalance 阈值+三段（`sopConfig`）· PlanGenerate 目标（`planGoals`）
  - **8c 文案/业务常数写死** ✅ **完成（de-battery 目的达成，debattery 基线 22→0）**：always-rendered 电池专属文案 genericize（ProjectSim 对策行 化成→产能瓶颈、SopBalance 增量行→通用名）· SopBalance 决议默认项 config-drive（`sopConfig.defaultResolutions`，电池名移入租户配置）· 其余兜底逐行 `// debattery-allow`（gate 扫描 0 未声明业务常数）· **`zh.ts` 行业专属串已清零**：GeoMap 定位配色/图例 config-drive（`view.layout.positionColors`，POSITION_COLORS 仅兜底）+ 删除死 i18n 项 `geo.power/storage/mixed`（实测未被引用，图例本就数据驱动自 `base.position`）
    - **审计澄清**：原"~35 处内联文案"实测为 **~500 处通用中文 UI 文案**（表头/步骤标签/提示语），属**多语言 i18n 外化**（仅当新增英文 locale 才需），**与多租户/去电池无关**（业务术语死路已 0）。**判定为刻意非目标**（单语中文产品 + 多租户经配置已满足）；若未来需多语言，另起 i18n PRD 专项，勿在此塞 churn。
  - **8d Agent/配置** ✅ **经核实已满足**（既有架构已解决）：运行时模型走 `roleModel(tenant,"agent",fallback)` LLM Provider 用途绑定（`orchestrator.ts:618`，seed 的 `model` 字段运行时不读）· 既有 Agent 可经 `PUT /b/v1/agents/:id` + AgentsPage 编辑 systemPrompt/tools · seed=出厂默认可覆盖 · `BATTERY_SOLVER_PARAMS` 为电池行业模板，其他行业走各自 IndustryTemplate（SY3 已证）
  - **8e `generic-inference`** ✅ **已落**（PRD `docs/PRD-generic-inference.md`）：`recompute(dryRun+apply)` 克隆图前向重算派生、不落真值 + `POST /a/v1/inference/whatif`，行业无关；O4b 回归（前向重算+无副作用）。注：作用于 compileSpecs 派生本体；合成 demo 用 runDerivations 另一路（后续可统一）
  - **门禁 `debattery:check`**（待办）：静态扫描视图/页内联业务常数 + i18n 租户串 → 自动盘出剩余 + 防回潮（落地 R14）
  - 注：出厂种子（场景目录/意图/计划/场景入口/经验库/规则库）经核实**可被租户 DRAFT→PUBLISH 覆盖 = 可接受**
- ⬜ **8.5 `debattery:check` 门禁**（独立工具，与 `ontology:check`/`chain:check` 同级，并入 `pnpm gates`）：静态扫描 `views/`+`pages/` 内联业务常数（基地名/型号/工序/坐标）+ `zh.ts` 租户专属串 → 自动盘出剩余写死项 + 防回潮（落地不变量 R14）。`DEFAULT_*` 兜底常量白名单豁免。
- ✅ **9. G-6**（全完成）：✅ `parseXlsx`（node-xlsx，三路 csv/json/xlsx 统一；CN1b 回归）· ✅ 合成并入连接器（活数据 P1）· ✅ **在线数据模版**（本体浏览器节点检视器：CSV 数据模版下载 + 每字段来源溯源——在线可见可下，已覆盖）
- ⏸ **10. G-7 余项**（评估为低价值，暂缓）：6 用途各对应固定调用点（classifier/agent/compose…），"枚举可扩展"无消费点即无意义；真实 LLM 扩展性（多供应商/按用途绑定模型/降级）已由 `roleModel`/`bindingFor` 满足。如需自定义用途，须先定义其调用点（另起 PRD）。
- 🔄 **11. 外部域（EXT_SIG）** —— PRD `docs/PRD-external-signal-domain.md`：✅ **P1 一等对象化 + EXTERNAL 连接器**：`ExternalSignal` 对象（domain=external；锂价/镍价/汇率/需求指数/政策/电价，带 value/unit/asOf/source/trend/impact，R13 可溯）+ `mock_external` 连接器（EXTERNAL 类，StaticAdapter）+ 合成出厂期 putAll 落对象 + `GET /a/v1/external-signals`；本体 §2/§3/§10 回写；synthetic/connectors 回归。✅ **P2 敏感性**：`POST /a/v1/external-signals/sensitivity`（信号冲击 → 规划指标，确定性弹性 Δ指标pp=Δ信号%×elasticity，按 impact 聚合：毛利/需求/出口营收/成本；锂价+10%→毛利-0.8pp 回归）。✅ **前端面板**：`ExternalSignalsPage`(/admin/external-signals)——信号清单(来源/单位/新鲜度可溯)+敏感性 what-if(冲击→指标聚合)；左导航入口；f41 回归。✅ **信号时序**：`GET /a/v1/external-signals/:key/series`（近 12 月确定性历史，从当前值按 trend 反推）+ 前端面板「时序」迷你折线（懒加载）。注：A8 ts_points 管道服务高频传感器序列；稀疏市场信号走此轻量时序。**EXT_SIG 端到端全闭合**（一等对象+连接器+敏感性+时序+前端）

## 🔭 Tier 4 · dogfooding 终态（⏸ **暂缓** —— 思路已评审通过，待启动）

> **决策（2026-06-16）**：方向正确、地基扎实（SYSTEM-ONTOLOGY.md 已是单一来源、prd-ontology-index.json 已机器可读、check-system-ontology 已解析 §4），但**优先级低于租户功能**（服务平台团队的治理/自治，非终端用户），故暂缓、入册。启动前先出 `docs/PRD-dogfooding-self-ontology.md`（含 §0，本身即一次 dogfooding）。
>
> **收敛版（评审结论）**：**#12+#13 先行**（投影+查询面，低风险高治理价值）；**#14 暂缓且保守**（code→本体自动派生易把策展本体稀释成噪声）。
>
> **三条铁纪律（成败所系）**：① **元/租户严格隔离**（自我模型挂独立元租户 `__platform__`/`meta` 命名空间，勿污染租户查询——本体 §10.1「两级域辨析」）；② **一事一源 + 生成方向明确**（机器可派生事实以 code 为源、人类语义以 markdown 为源、对象是可查投影，重生成即不漂）；③ **#14 保守**（人只策展语义，勿全自动）。
>
> **满足的需求/场景**：① 按需影响分析（"改 R14 影响什么/谁覆盖 G-5/哪些断点未修"= 图查询，自动化铁律0 read-first）；② 治理即查询（三门变活查询）；③ 自描述/上手（运行时可查接线）；④ **AI 可操作平台**（平台 Agent 经元本体+MCP 推演/改造平台——管理平台=另一个租户的本体+场景，走同一 QOS/Action 机器；§10.2 D11 治理元域升格为可查可推演数据）；⑤ 需求↔制品↔缺口运行时可溯。
>
> **与传统开发的本质区别**：传统=地图（文档/图）与疆域（代码）分离且漂移、"改这影响什么"靠 grep+经验；狗粮化=地图即系统从疆域派生并校验的活数据，且系统用同一引擎读取/重塑自己——"关于系统的文档" → "构造上自反的系统"。

- ⏸ **12.** 本体落库 PoC（解析 SYSTEM-ONTOLOGY+prd-index → SystemObjectType/Link/Invariant/Breakpoint/Event/Domain 物化为元租户 ObjectInstance；markdown 仍为源、对象为投影）
- ⏸ **13.** 本体活查询面（`GET /a/v1/meta/ontology`·`/meta/breakpoints/:id`(状态+PRD覆盖+关联不变量)·`/meta/invariants/:id` + 可选 MCP 工具让 Claude 问运行中的系统）
- ⏸ **14.** 本体自动派生扩展（§2/§3/§4 机器段从 code 内省生成，人只策展语义）—— **保守、最后做**

## 💭 to-do consider（待讨论，未排期 —— 架构差距评审 2026-06-16）

> 来源：与「本体驱动企业 Agent 架构」参考的差距分析（6 模块图 + 感知层本体校验 + 本体语义解析层）。结论：信任级双轨/可解释性/确定性执行强匹配；动态语义解析/关系路径规划/形式化本体为主要差距，**逐条裁决、未排期**。

- ❌ **多模态（语音/图像入口）—— 不考虑**（用户裁决 2026-06-16；当前定位为结构化决策平台，非多模态交互层）。
- 🟡 **形式化本体（OWL/RDF + DL 推理机 / SPARQL）—— 待讨论**：当前为「自有务实本体」（zod 契约 + markdown 元模型 + 规则/派生 DSL + 构建/发布时一致性校验），非 W3C 形式化栈，**无 DL 推理机做连续语义推断**。取舍点：① 形式化栈带来标准化推理/可移植性，但落地成本高、与现有确定性求解器范式割裂；② 现状的「实时一致性」实为构建/发布时 + 规则驱动，非连续 DL 推理。**需讨论：是否值得引入，还是继续夯实自有务实本体（倾向后者）。** 不实现，仅记录待议。

### 感知层 · 输入解析时本体校验（差距评审 2026-06-16，源自「感知层+本体校验」需求）

> 现状：实体经本体解析才放行（约 60–70%）——`objectRef` 槽位强制 `ontology.getObject` 命中（`router/slots.ts:44`），解析不到则澄清/降级。差距如下。

- 🟢 **动态对象类型 + 显式域外预警（低成本，可优先）**：`router/slots.ts:5` `OBJECT_TYPES=["Base","Model","Order"]` 硬编码（踩 R14 应用层无业务常数），裸串实体（如「供应商A」/Supplier 类）解析不到 → 改为从 DataCore 本体动态拉对象类型清单；并在解析失败时发显式 `entity.out_of_domain` 预警（带最近邻候选 + 可埋点「域外误触发率」），把隐式澄清升级为显式信号。
- 🟡 **自由文本全实体 NER 对照本体（高成本）**：当前仅校验意图声明的 `objectRef` 槽位；自由文本里未进槽位的实体不逐个对照本体。需独立 NER 抽取层（对等参考伪代码 `extract_entities`）。
- 🟡 **关系类型校验 `is_valid_relation`（高成本）**：关系是否符合本体 link 规范，目前只在建模期/派生闭包校验，不在输入感知期。

### 本体语义解析层 · 意图→标准化本体查询计划（差距评审 2026-06-16，分歧最大块，约 40–50%）

> 现状走「分类→策展计划→槽位填充→确定性执行 + 信任级标记」（换 R6 确定性），而非「动态本体语义解析→关系路径规划→查询合成」。**本体内/外双轨标记已具备**（路径A `VERIFIED_WORKFLOW` / 路径B 探索模式 `unverifiedNumerics`，`orchestrator.ts:244,582`）；缺前段动态解析。

- 🟡 **关系路径规划器（最大缺口）**：在本体图上自动推出连接/计算路径（如 `Supplier→Region ∧ class=A ∧ avg(...)`）；当前路径写死在 slice 定义 + plan 步骤，无图遍历 path planner。依赖部分形式化本体决策（见上「形式化本体」条）。
- 🟡 **统一 Entity Linking 层（含语义维度展开）**：相对时间归一（「去年」→2025）、地理层级展开（「华东区」→{江苏,浙江,上海,安徽}）、分类/派生指标短语链接（「A类」→等级=A、「交货延迟率」→派生）。当前散落在各 slice 定义，无统一链接层。
- 🟡 **按需查询计划合成**：当前 `ExecutionPlan` 是一等制品但来自目录绑定（`resolvePlanForIntent`）、非按 query 动态生成；「生成」实为「解析/绑定」。是否引入动态合成需权衡 R6 确定性与可溯源。
- ↪ 输出非 SPARQL（自有 resolve_slice + 派生/规则 DSL）—— 归并入上「形式化本体」条，不重复立项。
- 🟡 **超域答案置信度标记（贯通上两条的产物）**：动态语义解析 + 关系路径规划在本体上尝试映射后，对**无法映射的部分**（超出本体定义域）由 LLM 做"本体外推理"，并在最终答案上打一个**显式置信度/超域标记**（覆盖度：本体内可验证占比 vs 超域推理占比 + 风险等级）。这是把现有「本体内/外双轨」(路径A `VERIFIED_WORKFLOW` / 路径B `unverifiedNumerics`，整任务级) **细化到答案片段级的覆盖度信号** —— 让用户一眼看出"哪部分有本体支撑、哪部分是 LLM 自由推理"。依赖「关系路径规划器」+「统一 Entity Linking 层」先落地（映射尝试 = 覆盖度的来源）。
- 🟡 **本体切片缺失时的推演策略（不止超域）**：超域=整问题落在本体定义域外；**切片缺失**=问题在域内、但所需的具体本体切片/派生/对象类型尚未建模（如问到某指标但该 slice 未定义）。需明确缺失时的推演降级策略：① 报"缺失切片"并提示可建模项（而非静默用 LLM 瞎答）；② 允许 LLM 在标记风险下做近似推演；③ 与「数据构建发动机 gap 阶段」打通——把缺失切片回流为建模待办。
- 🟡 **后台「域/缺失切片」记录（治理可观测）**：把每次超域问题涉及的**域**、以及**缺失的本体切片/对象类型/派生**落后台记录（按 tenant 聚合），用于：① 发现本体盲区（高频缺失=优先建模）；② 量化本体覆盖度演进；③ 反哺「数据构建发动机」与建模待办。事件/表新增需遵 R2 tenant 隔离 + R9 仓储双实现四处同改 + R10 事件闭环。

### 可验证推理规划层 · 公理约束 + 每步可验证（差距评审 2026-06-16，约 50–60%，范式不同）

> 现状走「预策展确定性计划 + 运行时规则裁决 + 数据来源溯源 + Action 审批」（换 R6 确定性/可审计）；非「LLM 生成推理链→逐步公理自校验自愈→逐步置信度」。**地基坚实**：规则 DSL=公理表示（`ruledsl.ts`：字段比较+AND/OR/NOT+聚合 COUNT/AVG/SUM+SUSTAIN 时序，Axiom1/3 可写）；`evaluate_rules` 步骤+`rules.evaluate`（`rules.ts:204`）产 RuleVerdict(passed/severity/explanation/ruleVersion)；答案带 trustLevel+provenance(R13 六要素)+unverifiedNumerics；建议→处置经 Action 审批(R4)。差距如下。

- 🟡 **推理链逐步公理校验 + 违规自愈闭环（最大缺口）**：当前公理检查是计划里**显式编排的 `evaluate_rules` 步骤**（路径A 计划人工预策展、非 LLM 生成；路径B agent 可调但非强制每步校验），**无** `check_axiom_violations(step)→replan_step(step, violations)` 的逐步自校验/重规划循环。
- 🟡 **forward-chaining 公理推理（条件→后果）**：现有规则是**约束(condition→BLOCK/WARN/INFO 裁决)**，非**产生式(→ level=\"C\" / → status=\"suspended\")**；后果落地靠派生属性+Action 效果，无前向链推理机（与「形式化本体/DL 推理机」条相关）。
- 🟡 **计划发布期公理校验**：`validatePlanSteps`（`workflow/validate.ts:37`）仅做结构校验（步骤引用/顺序/超时/render_answer），**不校验计划是否违反领域公理**；公理校验只在运行时经 `evaluate_rules` 发生。可加发布期静态公理一致性门。
- 🟡 **逐步 axiom_check_log + confidence_per_step 作为一等可视化制品**：现 provenance 是**数据来源级**（outputPath/snapshot/时序聚合/KB chunk），非"这步通过了哪些公理检查"的逐步日志；信任度是任务级（trustLevel+unverifiedNumerics+分类 confidence），无推理链**逐步置信度**。3.2 那种"每步 ✓公理检查 + 可解释性评分"需作为结构化制品透出。

### 本体约束执行层 · 工具调用受本体约束（差距评审 2026-06-16，约 55–65%，**已有可选配置开关**）

> 现状**已具备约束配置项**（命中"目标场景下至少有开关"诉求）：agent `scopeDeclaration.{objectTypes,toolNames}`（工具白名单+对象类型范围，`contracts/agentcore.ts:45`）；路径B `package.toolWhitelist ∩ {READ,COMPUTE}`（`orchestrator.ts:602`）；`invoke_agent.expectsSchema` 结构化输出校验开关（`loop.ts:597`）；求解器输出经 DataCore 契约 schema 校验 + SHAPE 闭包门（构建期挡"算得出取不到"，`closure.ts:118`）；B→A `probeMissingRefs` 发布期引用闭合；写操作经 Action 审批(R4)。差距如下。

- 🟡 **动态"语义→能力→工具"路由 + 等价能力故障转移**：当前计划步骤**显式指名**工具/求解器（solverKey/toolName），无 `map_to_ontology_capability`+`filter_tools_by_capability` 的能力推断与等价替换（G-7 用途枚举 PRD 有、代码未落）。
- 🟡 **统一"全工具输出按本体类/值域强制校验"关卡（最大缺口）**：求解器有契约校验、`invoke_agent` 有可选 `expectsSchema`，但 `query_objects`/`search_knowledge`/`query_timeseries`/**MCP/外部 API 原始输出**无强制"符合本体对象类型 schema + 属性值域"的统一运行时关卡（对应案例"查征信API输出必须符合 CreditRecord 本体类"）。需一个 `validate_output_against_ontology` 运行时关卡，按对象类型/属性值域校验、不符即拒/隔离。
- 🟡 **值域/取值范围自动校验**：当前靠 `evaluate_rules` 显式编排，非自动对每个输出按本体属性值域约束校验。

### 实时验证审计层 · 一致性检查 + 决策痕迹（差距评审 2026-06-16，约 60–70%，**系统最强项**）

> 现状证据要素**几乎全已采集**：数字必有出处（`scanBlocks`/`unverifiedNumerics` + provenance 六要素 R13，`util/numerics.ts`、`workflow/executor.ts:292`）；高风险写真值强制审批 + 审批痕迹（Action R4：DRAFT→PENDING_APPROVAL→APPROVED…，多步链/不得自批/approverId+decision，`datacore/actions.ts:52`）；版本钉留痕 `resolvedRefs`（plan/solver/rule 当时生效版本）；规则裁决 `rule_violation` block（ruleId/severity/explanation/ruleVersion）；本体外标记（trustLevel=AGENT_EXPLORATORY）。差距如下。

- ✅ **Layer 2 知识图谱交叉验证（已落地 2026-06-16）**：`POST /a/v1/ontology/cross-validate` 对结论对象断言反查 KG 已有 props/链路（CONSISTENT/CONFLICT/NO_EVIDENCE），凡用到本体切片即组装入 `Answer.validationTrace`，前端 `ValidationTracePanel` 展示。**余项**：当前对**结构化对象断言**（切片解析出的对象属性）核对；自由文本里的断言（如"已通过ISO9001"）抽取为结构化 claim 仍需 NER（见「感知层·自由文本全实体 NER」条）。
- 🟡 **统一 Decision Trace 一等制品 + 导出**：证据要素现**散落**在 task（classification/resolvedRefs）/answer（provenance/blocks/trustLevel）/actionDraft（审批链）/toolCalls（审计）多处，无聚合成单一可导出 JSON（`{decision_id, decision_trace[], ontology_validation:ALL_PASS, human_review_required, review_history}`）。监管"直接出示决策痕迹"目前需跨端点拼。需一个**决策痕迹聚合/导出层** + `ontology_validation` 总判定字段 + `human_review_required` 显式字段。
- ↪ 逐步 `axiom_check` + `confidence_per_step`（置信度<80%自动标"需人工确认"）—— 见「可验证推理规划层」条，不重复立项。
- ↪ 数据取值范围自动校验（概率∈[0,1]）+ 输出实体/关系统一本体校验 —— 见「本体约束执行层」条，不重复立项。

### 本体索引记忆层 · 跨会话知识沉淀复用（差距评审 2026-06-16，约 35–45%，**现为向量范式**）

> 现状机制多落在参考图要对比的**传统向量记忆**一侧：经验记忆库 `repos.experience`（跨会话持久、tenant 隔离、50 例出厂种子、路径B 完成自动回写 `recordExperience`）+ `search_experience` 工具——但**向量索引**（`pseudoEmbed`+余弦，`tools/executor.ts:303`），非本体路径索引；语义记忆=本体（类型/链路/规则，支持版本化增量更新 ✓，但非 OWL）；工作记忆≈会话摘要（`agentPriorSummary`，部分）。差距如下。

- 🟡 **本体路径索引检索（核心差异，最大缺口）**：`search_experience` 用向量余弦相似度（黑盒），无 `find_by_path(ontology_path)` / `rank_by_ontology_similarity`（白盒、可展示推理路径、精确匹配）。要把经验改为本体实体+关系索引的事件 KG。
- 🟡 **经验映射到本体实体/关系的事件记忆（episodic KG）**：现经验存为 `{scene, question, approach, outcome}` 文本 + embedding，未抽取为本体实体/关系图；故无法按本体路径精确检索/可解释复用。
- 🟡 **本体自学习 / 公理挖掘（6.3，记忆进化）**：M11 校准引擎已具备"观测偏差→生成提案→回测门→`校准参数变更` Action 人工审批→生效/回滚+元闭环"机器（`datacore/calibration/service.ts`），但只校准**求解器参数**；缺"同类案例频率>80%→挖掘规律→提议**新公理/规则**→人工审核纳入本体"的案例模式挖掘。**M11 是 6.3 的现成模板**——把提案对象从参数扩到规则/公理、复用同一 Action 审批即"人工审核后纳入本体"。

## 📌 非开发遗留
- ⚠ **吊销并更换暴露的 Gemini API key**（早前明文发过）
- ⬜ 上云部署脚本（本机 `docker compose up --build` 已可；公网域名需自控主机）

---
**建议下一步**：Tier 2 #3（把放大的 DAG 接上六要素溯源 → "大画布 + 每节点可验证"，一次兑现 Palantir 哲学 #1/#3/#6）。
