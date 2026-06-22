# TODO · 决策平台 PRD 套件（decision-platform-prd-pack）· 逐项追踪

> **2026-06-22 新包 `decision-platform-prd-pack.zip`（78 PRD）已研判**：绝大多数是已交付特性的 PRD 文档（A1–A18 / spine / 1:1 复刻 / empty-response-guard=W0 已做 / gap-fill=W4 / synthetic-wizard=W5）——`data-closure-spec` 与本仓 docs/ 字节一致。
> **真正新增需求 = "驾驶舱问'本月未达成原因'端到端答不出"闭合增量（CL 簇，7 PRD 依赖链）+ 3 独立件**。逐环修复后空租户也能端到端答出（达成率/偏差/逐日时间归因）。诚实边界：缺任一环都会卡在对应断点。
>
> **CL 簇 · "本月未达成原因"端到端闭合（依赖链，按序）**
> - [x] CL.0 **空响应护栏**（PRD-llm-agent-empty-response-guard）= **W0 已完成** ✅。
> - [x] CL.1 ✅ **admin 自审批**（PRD-admin-self-approval｜SA.1/.2）：放宽 `actions.ts` 硬职责分离为**可配置留痕例外** `selfApproveAllowed`（租户/ActionType；默认 STRICT=现行为，demo=ALLOW_ADMIN）；submit 不再 `NO_ELIGIBLE_APPROVER`、approve 放行 + `ApprovalStep.selfApproved=true` 留痕。**⚠️ 有意放宽 R4**（须回写本体 §5 注记）→ **解锁所有 R4 收尾闭环**（provisional→governed / SOP 定稿 / gap-fill 收尾 / 数据生成转正）。**无依赖，是后续闭环前提**。
> - [x] CL.2 ✅ **agent 合规产数据工具**（PRD-agent-data-generation-tools｜ADT.1–.3）：`BUILTIN_TOOLS` 补 `fill_data`(客户端已在仅注册)/`run_synthetic`/`build_domain`；触发确定性合成→落 PROVISIONAL→agent `query_*` 读回真实物化值再推演（**触发合成≠伪造**，回执只含元信息不产业务数字，铁律自洽）；登记 OPERATION_CATALOG（R15）。deps CL.1。闭 G-3 agent 侧。
> - [x] CL.3 ✅ **discover 暴露真实类型名**（PRD-discover-real-type-names｜DTN.1/.2）：`discover{object_types}` 返本租户已发布 `ObjectType{key,label,domain,instanceCount}`；`query_objects/get_object` 未知 typeKey → `UNKNOWN_TYPE`+did-you-mean（编辑距离），不静默返空；区分"空 vs 不存在"。agent 照真名查不再猜 `plan_version/production_target`。与 ADT 同处 discover 增强。闭 G-3。
> - [x] CL.4 ✅ **空租户冷启动引导**（PRD-empty-tenant-bootstrap｜BS.1–.3）：`POST /a/v1/bootstrap` 编排端点串 7 步（合成 seed 计划域→核对物化→建 SopVersion→五步法→定稿 FINAL 走 R4→核对 currentPlanVersion→plan_audit 有料），幂等确定（R6）；CLI `platform bootstrap` + GUI 空态向导 + agent 工具组合三面同源。**注：与既有 `bootstrap.ts`(platform_admin 超管创建)无关，是新的计划域冷启动**。deps CL.1+CL.2。闭 G-3 冷启动入口。
> - [x] CL.5 ✅ **基地级日达成率时序**（PRD-attainment-base-daily-timeseries｜TS.1/.2）：补 `attainment:base`（基地级日序，建议复用 `attainment:line` 日上卷 TsAgg → `Base.attainment_daily`，加权 by output）；达成率口径接 `Metric{achievement,day}`（spine，R-一致）；seed/lived-in 一并产。deps spine ✅。供"逐日时间维度归因"。
> - [x] CL.6 ✅ **达成率/偏差归因路由**（PRD-attribution-routing-plan-audit｜AR.1/.2）：comprehend/classify 关键词（达成率归因/未达成原因/偏差根因）→ `plan_audit`；`discover` 暴露 plan_audit 为归因入口；plan_audit 入参三级兜底 `plan_version_id ?? currentPlanVersion ?? deriveBaseline(PlanTarget)`（solvers.ts:170 已支持，补到调用/agent 路径）；配 CL.5 日序做逐日归因；真空→结构化缺口提示引导。deps CL.4+CL.5。闭 G-3 路由接缝。
> - [x] CL.7 ✅ **对话坞 gap-fill HITL**（PRD-in-dialog-gap-fill-loop）：GF.1 `AnswerBlock.gap`+`<GapCard>`（按码▶触发 growth/run LOOP+续推+诚实断点）；GF.2 orchestrator `failTask` 路径 B agent 失败并入 gap 块（对话坞出缺口卡而非红错）。**GF.3 就地审批=数据契约决策，缺口卡→触发→续推闭环已可用（用户确认收口）**。测 ×3。
>
> 
> **待确认事项（需你拍板，已按依赖隔离，不阻塞其他推进）**
> - [待确认] **CL.7 GF.3 就地 R4 审批面板**：gap 卡触发 growth/run LOOP 后，若产数据需写真值转正（R4），PRD 要"对话内就地审批面板（复用 DataBuilderPage §6.4）"。但 `GrowthRunReport` 当前不回传可审批 draftId/provisional 域引用——需先定**数据契约**（LOOP 输出附待审 draft 引用 ⇒ 对话内嵌审批），属架构决策。GF.1+GF.2 已让缺口卡→触发→续推闭环可用。
> - [待确认] **riskCases 真闭环**（W5）：livedin 历史快照回算，**高风险**（触 F40/replay 重算路径），评估为延后；是否承担风险请示下。
> - [PRD 待发] **quarter / 其余 1:1 视图取值对齐**：plan-generate 工业 PRD 已交付并完成；其 §结尾注明"其余 11 视图各须一份同样的完整工业 PRD"。quarter/dash/risk/sop/audit/order/model/story/map 的逐字取值对齐待各自工业 PRD 到位（你在逐一提供）。生成器调参须跨 sop/aop/quarter/cockpit 同回归。
> 
> **独立新增件（非 CL 链）**
> - [x] **nav-ia-reorg** ✅（PRD-nav-ia-reorg｜N1–N3 全做完）：N3 字号父级≥子级 ✅ · N1 统一域分组 `NAV_GROUPS`（业务视图+管理页合一套域分组，替代'业务/管理'双堆+admin flat）✅ · 图谱(view)并入「建模与图谱」与本体/建模同组（闭'图谱与本体拆两区'）✅ · meta 补回「平台与系统」✅。配置驱动 R14、逐项角色/entitlement 过滤、空组隐藏、折叠记忆复用。更新 f1/f12/f40/f61 至统一 IA，frontend 205 全绿（3 角色覆盖）。
> - [x] **R16 发育闭环总纲** ✅（PRD-system-ontogenesis-spec｜宪法级）：本体 §5 立 R16（倒序发育⊕正序运作两相、三环自动闭合、二分处置、透明可视、分相位成熟）+ `ontogenesis.organ_matured` 事件 + `sys.meta.ontogenesis_loop` 切片 + `scripts/check-ontogenesis.mjs` 门并入 `pnpm gates`（保守声明性校验）。回写本体 §5/§3/§4/§10。
>


> **2026-06-22 依赖排序 to-do（含 2 新 PRD：空响应护栏 / 对话坞 gap-fill）**——按"谁阻塞谁"排，✅=已就绪可接，⛔=被阻塞。
> 已完成底座（不重列）：SPINE.1–.4 · 求解器 38（plan_rootcause/metric_rollup/counterfactual_timeline/order_fullchain/mrp_netting/finance_pnl/audit_timeline）· SopVersionRow · AUDIT.1 逐日圆点轴 · ORD 订单全链前端 · A18 全部 · cockpit P1–P3。L4 真后端 17/17。
>
> **W0 立即（活崩溃·根·无依赖）**
> - [x] **PRD-A 空响应护栏** ✅（=CL.0，已完成）：FIX.1 `agent/loop.ts:473` 判空 + `LlmEmptyResponseError`→R7 信封 + **定位"返回 undefined 不抛"的适配器路径补 throw**（核验:未绑定是 throw 路径，非本崩；崩在 adapter 解析 undefined）· FIX.2 `anthropic.ts` 5 处(129/158/175/194/228)+215 加固 + 错误码。修的是路径 B agent 推演（cockpit/order/audit 推演同路）。
>
> **W1 后端已就绪的前端（零跨依赖，可并行）**
> - [x] **sop 前端** ✅（MRP表/科目表/版本对比/P90 列已在 SopBalanceView）（deps ✅ mrp_netting/finance_pnl/SopVersionRow）：SOP.1 ② 滚动 P90 列 · SOP.2 ③ 物料线 MRP 表 · SOP.3 ④ 量价本利科目表 · SOP.4 ⑤ 版本演进对比表。
> - [x] **aop 前端** ✅：note 行 + 三情景对比 chip + 分解 header 基准数字 + 缺口/过剩窗口曲线 + C18/C23 行内 RuleRef；修 2027/2026 年份接线；契约 AnnualScenario.note + 生成器 note 种子；f21 +1 L3，frontend 202 全绿，回写本体 §2.B。
> - [x] **cockpit P5 前端** ✅（V5/V7 版本切换+反事实双线图已落；AI 对话=GF.2 路径）（deps ✅ SopVersionRow/counterfactual_timeline）：V5/V7 版本切换 · 反事实双线图（counterfactual_timeline）· 回采校准链 · AI 对话 · 导出。
>
> **W2 需新建共享组件（audit.3 → generate，有序）**
> - [x] **audit.3 KsfGraph** ✅：`ksf_graph` 求解器（38→39，问题=越线 Metric→KSF 5→财务 Metric，威胁/支撑边）+ `<KsfGraph>` 组件（audit/generate 共用，问题节点点击高亮+联动 audit_timeline DailyDotAxis）。datacore 602 / frontend 204 全绿，回写本体 §2.E。
> - [x] **generate 前端** ✅（PRD-IND-plan-generate 工业级 1:1）：五维雷达 + 目标达成 6 行 + 得/舍取舍 + **外部信号敏感性面板** + **必须解决问题(why+4 节点传导链)** + 执行关键点 + KsfGraph + 采纳→AOP + invTurns 目标字段；后端取值对齐 HTML(gm0.16/cash58/gmFloor0.155…) + §4.4 pickMax 方案选择(壹/贰/叁) + extSensitivity/focus 种子(逐字)。datacore 602/frontend 205 全绿，回写本体 §2.E。
>
> **W3 横切 + 生成器调参（planview 耦合，须同回归）**
> - [x] **inference-process `<InferenceProcessDag>`** ✅（全做完）：QOS 轨迹投影 10 节点 + par/conv/aux/fb 边 + 逐节点 IPO + 缺口红。**横切挂载 6 入口**：QueryDock(实时轨迹) + risk/project/order/audit/generate(solved 全节点 done，经 `<InferenceProcessPanel>` 复用)；**model 收敛子模式**(型号→认证产线→基地，project-sim)。测 inference-dag ×3（编排+solver 视图+model-network），frontend 207 全绿。
> - [ ] **quarter 生成器调参 + 1:1 取值对齐 pass**：6 季精确值 + sop/aop/quarter/cockpit HTML 精确值→生成器种子（改 planview 须同回归产能推演/AOP/SOP，防漂移）。
>
> **W4 对话坞闭环（⛔ 依赖 W0 PRD-A + W3 inference-process）**
> - [ ] **PRD-B 对话坞 gap-fill HITL**：GF.1 `AnswerBlock.gap` 类型 + QueryDock `<GapCard>` + 按码触发（**注:无独立 `/growth/fill-data` 端点，需改调 `/growth/run` 或加薄端点**）· GF.2 SSE 回灌 + 就地 R4 审批(复用 §6.4) + "继续推演"重跑 · GF.3 databuilder/scaffold 触发 + 诚实断点 + GrowthTicket + presetContext 闭 G-3。
>
> **W5 收尾/延后（低优先或高风险）**
> - [ ] riskCases 真闭环（livedin 历史快照回算，**高风险**触 F40/replay，延后）· synthetic-wizard（ontoprompt 链 UX）· prototype-intake P3（resolve 真应用本体 + 串发动机 closure/publish）· A3 参考本体基线（元租户 95 节点，低价值）。
>
> **关键依赖边**：PRD-A ⊳ PRD-B（同路径 B 推演，崩溃不修则 gap-fill 走不到）· audit.3(KsfGraph) ⊳ generate · inference-process ⊳ PRD-B(过程 DAG 复用) · sop/aop/quarter 共享 planview(取值对齐须同回归)。

---


> **2026-06-22 新增包 · 参考原型全视图 1:1 复刻 + 经营骨架**（`PRD-1to1-replication.zip`，8 PRD + spine + SOP，已入 docs/）。
> 评估结论：cockpit-capacity PRD 的 P1–P5 = 我已做的 cockpit P1–P3（结构闭环 ✅，但 1:1=100% 要求 HTML 精确值→生成器种子，
> 我的合成值需"取值对齐"补丁）。**spine（Metric/KSF/Principal）是各视图 KPI 单一出处底座，最大改动面 → 决定先做（用户裁决）**。
> 调整后顺序：**① spine → ② cockpit P4/P5(+取值对齐) → ③ 计划三视图 sop/quarter/aop(共享 planview) → ④ audit→generate → ⑤ order → ⑥ inference-process**。
> - **SPINE.1 ✅**：`KSF`/`Metric`/`Principal` 绿地对象（R9 免新表，走 ObjectInstance）+ `metric_rollup` 求解器（SOLVER_KEYS 32→33）
>   + 骨架链路 `metric_affects_ksf`/`metric_ownedby` + 端点 `/a/v1/{metrics,ksf,principals}` + 契约 `spine.ts`。**PlanKpi 已归一为 Metric**
>   （plan_rootcause/dash/data-categories/tests 全切 Metric，零回归）。测 spine ×5(L6 字节一致 · L1 物化+链路 · metric_rollup delta/miss · level 过滤 · R2)。
>   datacore 577 · agentcore 278 · frontend 196 全绿;gates 全过(33 求解器/44 事件本体覆盖);**L4 真后端 14/14**(A4 33 类型)。回写本体 §2.B/§2.E/§3。
> - 余 spine：SPINE.2(Metric↔Connection 血缘 + Principal 责任闭环 + metric.snapshot_recorded/breached 事件) · SPINE.3(KSF 越线推演接入) · SPINE.4(7 视图绑定迁移读 Metric 去硬编码,附录B)。
> - **SPINE.2/.3/.4 ✅**：血缘 `GET /metrics/:key` + 责任闭环 `plantarget_ownedby` + `metric.snapshot_recorded`/`metric.breached` 事件 ·
>   `plan_rootcause` 插 KSF 层(Metric→KSF→factor→evidence) · 驾驶舱 `metric-strip` 读 Metric(R-一致)。L4 真后端 15/15。
> - **cockpit P4 后端 ✅**：`counterfactual_timeline`(反事实双轨"如不解决XX未来N天") + `order_fullchain`(订单三判+统一结论+11节点DAG)。
> - **wave③ sop 后端 ✅**：`SopVersionRow`(V1-V7 版本演进,服务 cockpit P5 V5/V7) + `mrp_netting`(物料线) + `finance_pnl`(量价本利)。
> - **wave④ audit 后端 ✅**：`audit_timeline`(每审计项 kind 逐日 series + 4 阶段,audit/generate 共用)。
> - **求解器 33→38**(plan_rootcause/metric_rollup/counterfactual_timeline/order_fullchain/mrp_netting/finance_pnl/audit_timeline)；datacore 592 全绿。
> - **余(主要为前端视图 1:1 复刻 + 取值对齐,各需 L3/L4/FDE)**：cockpit P5 前端(V5V7/AI/导出/回采链) · riskCases 真闭环(livedin 回算,已评估为高风险延后) ·
>   sop 前端(P90列/MRP表/科目表/版本对比) · audit 前端(逐日圆点轴+KsfGraph,消费已产 series) · generate 前端(雷达+复用audit) ·
>   order 前端(OrderChainView 接 order_fullchain) · quarter 生成器调参 · inference-process `<InferenceProcessDag>` · 1:1 取值对齐(HTML 精确值→种子)。
> - 注：包内 bundled `SYSTEM-ONTOLOGY.md`(372 行)是旧快照,**未覆盖**——本仓本体(440+行,含 A18/cockpit/spine/R15/38 求解器)更新。


> 来源：用户上传的 `decision-platform-prd-pack.zip`（25 文件 / 19 份 PRD + SOP + 路线图）。
> 施工规程 = `DEV-SOP-and-LOOP.md` 七步闭环（① READ → ② PLAN 契约先行 → ③ DEV 后端→前端→CLI →
> ④ T1–T12 工业级检测 → ⑤ 亲手跑通真服务/真 UI → ⑥ 回写本体 → ⑦ COMMIT），任一红回退。
> **波次 LOOP**：同波并行、跨波须前波 DoD 全绿才进。核心纪律：**绿测试 ≠ 能用**。
>
> 状态：✅ 完成（DoD 全绝 + 亲手跑通 + 本体回写）· 🔄 进行中 · ⬜ 未开始 · ⏸ 设计延后（裁决）
> 纪律：**完成一个标记一个，不能遗漏**。每轮回看本表，主动报"还差哪些"。
>
> ⚠️ 待负责人拍板（开工前置，SOP §0.5 / 五.1）：**基线分支** `wizardly-gauss`（推荐·超集）vs
> `vigilant-knuth`（当前工作分支）——涉 migration 序号 / `generateBattery` 字节回归 / `SyntheticPage` 分叉。
> 当前默认在 `claude/vigilant-knuth-b1nmxn` 推进（与既有指派一致）；如需切超集分支请明示。
>
> PRD 全文暂存于上传包；**实现某 PRD 时**再将其文本与《本体引用与影响》§0 落入本仓库 `docs/PRD-*.md`
> 并同步回写 §5 新不变量（R15 CLI 对等）等，避免 `prd:check` 悬空引用先红。

## 全局裁决（已定，写死）
- A9 仅设计延后（不引真依赖，守 R6）。
- A1 全部 **31** 求解器注册为 MCP 工具（业务场景 22 + 净室通用 9；与 SOLVER_KEYS 对齐，含 A8 CP-SAT 族）。
- A3 参考原型 16 域裁成 14 业务域（factory/product/process/equip/people/quality/capacity/forecast/sales/material/finance/plan/external/decision）。
- A11 连接 category 允许自定义值。
- A15 意图路由 = `POST /b/v1/operations/classify`；"求解器上传"不做 CLI 子命令 → CLI 输出深链跳 GUI。
- R15 CLI 对等 = 新不变量 + `cli-parity:check` 门 + PRD 模板必填（今后每功能必 CLI 打通或登记 GUI 深链）。

---

## Wave 1 · 基座（同波并行；A3 是 A4/A5/A10 前置）

- [~] ◐ **A3 · 14 域参考本体 + 域内/跨域两库 + 多跳切片规划器（图路径搜索）+ 切片索引**
  **A3.3 ✅（keystone）多跳切片规划器**：`ontology/slice-planner.ts planSlice` 在 OntologyLink 图上确定性
  BFS 最短路 + 固定 tie-break（跳数→域内边优先→toType 字典序→linkKey 字典序）→ SlicePlan（root→每目标
  最短路 + 路径证据 + 跨域集），搜不到→NO_PATH(unreachable[])；纯函数 R6 字节一致；`POST /a/v1/slices/plan`
  (R2 仅本租户图) + 契约 `contracts/slice-planner.ts` + 门 `pnpm slice-planner:check`。测试 a3-slice-planner ×9
  (链式/多目标/反向 in 边/NO_PATH/maxHops/R6/tie-break 域内优先 + 端点 root===target/未知类型/R2 空租户)。
  回写本体 §2/§10.1。
  **A3.1 ✅ 14 域注册表**：`graphmeta.ts BUSINESS_DOMAINS`(14 域 key/显示名/配色/primaryTypes，新增 sales/material/
  finance/external/decision 5 域，配置驱动 R14)+ `GET /a/v1/business-domains` + GRAPH_DOMAIN 补 ExternalSignal→external。
  测试 a3-business-domains ×4(恰好 14 域/无野域/primaryTypes 自洽/端点)。**A3.1 余**：参考本体基线(元租户 95 节点)数据量大待后续。
  **A3.4 ✅ 切片索引复用 + slice.planned 事件**：`ontology/slice-index.ts buildSliceIndex/resolveSpannedTypes/
  lookupReusable`(派生投影 R13——沿 link 图解析每切片覆盖类型集，按 rootType 索引)；`POST /a/v1/slices/plan`
  先查索引命中即复用(reused:true)、未命中才新规划 + `GET /a/v1/slices/index` + `slice.planned` 事件(§4 L1)。
  测试 a3-slice-planner +4(resolveSpannedTypes/lookup 复用/tie-break 最贴合/端点索引)。回写本体 §2/§4。
  **A3.2 ✅ 域内/跨域两库**：`ontology/slice-library.ts deriveSliceLibrary`(确定性——域内 `biz.<域>.<root>` 单域子图 +
  跨域 `biz.x.<from>_to_<to>` 每接缝单跳切片) + `GET /a/v1/slices/library?scope=` + `POST /slices/library/build`
  (幂等登记为一等切片→进 A3.4 索引、QOS 可调)。测试 a3-slice-library ×4(域内/跨域派生/R6/端点登记进索引)。回写本体 §2。
  **A3 仅余**：A3.1 参考本体基线(元租户 95 节点,数据量大,低优先)——A3 核心能力链(域→规划器→索引→两库)已闭合。
- [x] ✅ **A6 · 拟真值域合成数据（值落业务区间 + 确定性植入越线样本）**（Wave1 尾巴已清：全服务 e2e 跑通）
  **A6.1 ✅** `GenSpec.valueDomain` + 值域库 `synthetic/value-domains.ts`(按属性语义配置化 R14) + `genValue`
  扩(normal/banded/uniform 确定性采样,落业务区间);**A6.2 ✅** `PlantSpec` + `applyPlantCrossings`(固定索引
  植入越线/近边界) + `autoPlant` 从 BLOCK 规则 `derivePlantFromRule` 反推 + `instantiateGeneric` opt-in 接入
  (护 R6 向后兼容) + `pnpm value-domain:check` 门(test-backed)。测试 a6-value-domains(×7:三形采样落区间+
  R6 字节一致+植入查准+lt 方向+规则反推)。datacore 470 全绿(+7,无字节回归:synthetic/genspec/scale-baseline 通过)。
  **A6 全服务 e2e ✅（Wave1 尾巴已清）**：注册自定义行业模板(util valueDomain + autoPlant + scenarioSeed)→
  真 synthetic job → 物化对象 util 落业务区间[0.62,0.95] + autoPlant 越线>0.95 ≥2 行 + **R6 同 seed 重跑字节一致**
  (a6-value-domains 第 8 测，亲手过真服务合成路)。`pnpm value-domain:check` 即跑此文件含 e2e。回写本体 §2.A/§8(G-5 8f)。
  **唯一余项(诚实)**：A6.3 电池路收编(让 generateBattery 也用共享机制)——纯内部 consolidation，**generateBattery 未改→
  电池字节保持(DoD"电池字节不变"已满足)**，收编是可选优化、不影响通用路价值，留作后续。
- [x] ✅ **A11 · 连接创建打 `Connection.category` 标签（per-instance 归类，可自定义值）**
  Connection 加可覆盖 category（默认取连接器类型 registry category）+ RawDataset 溯源继承 `sourceCategory` +
  `GET /a/v1/connector-categories`（内置并集 + 本租户已用值，R2 隔离）+ `connection.created` 事件（§4 L8）+
  前端归类列/筛选/向导可自由输入 category。**亲手验**：Playwright 截图 connections 页归类列 + MES 自定义徽章。
  测试：datacore a11(×5 含 R2) + frontend f56；ontology:check 过。**注**：Connection 是 JSONB doc 存储，
  无需 migration（PRD 的 ALTER TABLE 假设列式存储，实际架构是 doc store）。CLI/R15 待 A15 落地后补登记。

## Wave 2 · 引擎/能力（A1 是 A8/A7 暴露口；A13 让 A14 去抖；A4 依赖 A3/A11）

- [x] ✅ **A1 · 31 求解器暴露为 `solvers` MCP 工具**（MCP 页可治理 + agent 经 mcp-router 可调，OBO 代理到 /a/v1/solvers）。R3 R5 R8 R11。
  契约 `solvers.ts`：`SOLVERS_MCP_SERVER` + `solverMcpToolName(key)→mcp__solvers__{key}` + `parseSolverMcpToolName`（双向）。
  供给侧 `catalog.ts`：业务场景 `SOLVER_CATALOG`(22，QOS discover 不变) **分列** 净室通用 `GENERIC_SOLVER_CATALOG`(9：
  generic_inference/shared_bottleneck/concentration_risk/margin_attribution/supplier_disruption_radius/selection/
  assignment/sequencing/packing_optimize，均带 LLM 描述「无描述不允许发布」) → `CatalogService.solverRegistry`(31，**同走
  feature 过滤**：关 view.plan-audit → plan_audit 工具消失，R3 先于 authz) + `GET /a/v1/solvers/registry`(附 outputShape)。
  AgentCore `mcp/solvers-catalog.ts buildSolverMcpTools`(确定性按名排序) + `GET /b/v1/mcp/servers/solvers`(源=注册表 31) +
  **executor A1 shim**(mcp__solvers__{key} 调用零重写归一回 invoke_solver 走既有 OBO 路径) + Http/Mock CatalogClient.solverRegistry。
  测试：datacore catalog(+2：注册表=SOLVER_KEYS 全集无漂移·每条带描述·feature 过滤) + a1-solvers-mcp ×3(L1) +
  **xservice-smoke L2**(真 AgentCore HTTP 客户端 ↔ 真 DataCore 端口：注册表 31 构 31 工具，assignment/supplier_disruption 并入)。
  **T12 亲手验 L2**：起真 DataCore:4001 + 真 AgentCore:4002 → curl /b/v1/mcp/servers/solvers → count=31，全 mcp__solvers__ 前缀。
  gates 全绿（SOLVER_KEYS 31 = 注册表 31 = R11-SHAPE 31/31）。回写本体 §3（求解器 MCP 暴露链）。
- [x] ✅ **A8 · 扩 CP-SAT 模型**：assignment（订单→基地/产线）/ sequencing（换型排序）/ packing（产能装箱）。R6。
  **A8.1 assignment_optimize · A8.2 sequencing_optimize · A8.3 packing_optimize 均 ✅**：Python sidecar 三模型
  (assignment 每 item 一指派+容量+成本; sequencing AddCircuit 开放路径最小化换型; packing bin-packing 最小箱数+对称破除)
  + DataCore 代理(loadContext 组请求，未配 OPTIMIZER_BASE_URL 显式"未接入"不兜底) + SOLVER_KEYS 31 + 输出形状 +
  `solve{Assignment,Sequencing,Packing}` client。测试 a8-assignment ×4 + a8-sequencing-packing ×3(mock 接线) +
  Python test_optimizer ×8(真 ortools 9.15：三模型可证最优 + R6 字节一致 + 不可行)。回写本体 §2.E(31 求解器)。
  **余(低优先)**：经 A1 MCP 暴露(待 A1 落地后自动覆盖,3 个新求解器即成 mcp__solvers__ 工具)。
- [x] ✅ **A13 · 通用图求解器地板语义确定化**（concentration_risk/supplier_disruption_radius 去 Kimi）。R6。
  `solvers/field-roles.ts resolveFieldRoles`：纯函数 + 结构信号(扇入/扇出/PK/数值) + 配置词库(`field-role-lexicon.ts` R14)
  + 固定 tie-break → root/sink/resource/priority(地板)/leaf 角色解析，**去 LLM 消歧(R6 字节一致)**；真歧义返回确定性排序候选
  + 置信度 + ambiguous(取 top1 默认/喂 A5 比差/A4 让人选,绝不调 Kimi)。覆盖 4 个通用图求解器(supplier_disruption_radius
  断供根=被 ref 终端汇点)。契约 FieldRoleResolutionSchema + `GET /a/v1/solvers/:key/field-roles` + 门 `floor-semantics:check`。
  测试 a13-field-roles ×6(断供根/R6 字节一致/真歧义候选/shared_bottleneck 角色/覆盖集/端点)。solver-args 未改(byte-compat)。回写本体 §2.E。
- [x] ✅ **A4 · 对象/类型浏览器管理页**（按 14 域分组列已发布类型 + 物化计数 + 下钻实例）。R2 R3 R14。
  后端 `GET /a/v1/ontology/object-types/stats`(每类型 {域(归 14 域注册表)/属性数/派生数/PK/物化 count} 一次算)。
  前端 `ObjectTypesBrowserPage` `/admin/object-types`(adminRegistry+nav)：14 域分组 + 物化计数徽章 + 域/关键词/
  仅有物化 筛选 + 点「看实例」下钻实例表(queryObjectsPaged,A6 行级过滤) → Object360(`/o/:type/:key`)。零业务常数 R14。
  测试 f57(域分组/计数 Base=3·Order=20/域筛选/仅有物化去 count=0/实例下钻 360 链接)。**T12 亲手验**：Playwright 截图
  真 UI(14 域 + Base 实例 12 行下钻)。回写本体 §2.B。消费 A3 14 域 + A11 category(筛选可后续接)。

## Wave 3 · 编排/闭环

- [x] ✅ **A5 · FDE 编排工作流·可观测节点状态图**（意图→倒推→查能力→比差→各模块生成→闭包→publish→进启动器）。R10 R11 R13 R6。
  L0/L1/L6/L7 ✅ + L3(f58) ✅ + **L4 真后端 ✅**（`e2e-realbackend.mjs` 真 Chromium↔真 datacore/agentcore：展开运行 → FDE 8 节点真浏览器渲染，9/9 通过 2026-06-22）。
  观测层（不重写建域逻辑，PRD-A5 §1 非目标）：把 BuildWorkflowRun 7 执行步**确定性投影**成 8 FDE 语义节点。
  契约 `storybuildrun.ts`：FDE_NODE_KEYS(8)/FdeNodeSchema/FDE_NODE_STATUS + `StoryBuildRun.nodes`（doc store 无 migration）。
  `databuilder/fde-graph.ts projectFdeNodes`（状态主判产物存在性 + 步状态叠加 RUNNING/计时 + 闭包断缺口码，R6 字节一致）+
  引擎 `onAdvance` 钩子（每步迁移回调）→ service 发 `fde.node_advanced`（L15 事件，event-subscriptions + 本体 §4）+ 落
  StoryBuildRun.nodes 快照 + `GET /a/v1/databuilder/workflow-runs/:id/fde-graph` 实时投影。
  前端 `DataBuilderPage <FdeGraph>`（8 节点横向 DAG，状态色 + 缺口码红标，配置化实时刷新轮询）+ MSW mock。
  测试：a5-fde-graph ×8（L0 投影：空/成功全 DONE/闭包断 FAILED+SKIPPED/步叠加/R6 · L1 真服务建域落 8 节点 + 端点 + 事件 + R2）·
  f58 前端 L3（8 节点 DAG + 失败节点缺口码）。gates 全绿（事件 35/35，含 fde.node_advanced）。回写本体 §2.H/§3/§4。
- [x] ✅ **A7 · B 栈 scaffold 单机可见**（不配 AGENTCORE_BASE_URL 也能看到生成的 agent；DataCore 侧持久可见）。R8 R11 R2。
  L0/L1/L7 ✅ + L3(f59) ✅ + **L4 真后端 ✅**（e2e-realbackend：cross_scaffold 步下 scaffold 清单真浏览器渲染）。
  契约 `storybuildrun.ts`：ScaffoldManifestItem/Record（SCAFFOLD_ITEM_STATUS：PENDING_BSTACK/SCAFFOLDED/REUSED/MISSING）+
  `StoryBuildRun.scaffoldManifest`（挂 doc store 无 migration）。`databuilder/scaffold-manifest.ts buildScaffoldManifestRecord`
  （展平 7 类 B 栈需求 + 定义，receipt 缺省=全 PENDING_BSTACK·SOFT，在线=按 (kind,key) 覆盖·HARD，R6）。
  cross_scaffold 步**无条件**落清单 + 发 `scaffold.manifest_recorded`；record 落 StoryBuildRun.scaffoldManifest。
  `GET /a/v1/databuilder/runs/:id/scaffold-manifest` + `POST …/reconcile-scaffold`（B 上线幂等对账→升级 + `scaffold.reconciled`；
  未配 B 显式报错）。不在 DataCore 真建 B 栈真值（R8，真值归 AgentCore）。前端 `ScaffoldManifestTable`（cross_scaffold 下钻，
  pending-bstack 标 + 定义可看）+ MSW mock。测试：a7-scaffold-manifest ×6（L0 投影/receipt 覆盖/空/R6 · L1 单机落库+浏览+事件+
  reconcile 幂等）· f59 前端 L3。gates 全绿（事件 37/37）。回写本体 §2.H/§3/§4。
- [x] ✅ **A10 · 终态闭环末步**（建域→R4 审批→publish→**自动重跑问句验证** "现在真能答了"）。R4 R11 R13 R6 R10。
  L1/L7 ✅(a10 ×5) + L3(f60) ✅ + **L4 真后端 ✅**（e2e-realbackend：sbr-run 建域 → 重跑验证按钮 → 终态徽章真浏览器渲染）。
  契约 `storybuildrun.ts`：BuildVerification（VERIFIED/NOT_VERIFIED/BUILD_STATIC/PENDING）+ `StoryBuildRun.verification`。
  `service.ts verifyBuild`：主问句经 QOS 实跑（inferenceProbe）→ 可答 VERIFIED(RUNTIME_PROBE 活证据)/不可答 NOT_VERIFIED+gapCode/
  未配 QOS 兜底 BUILD_STATIC；复用 inference 步已 probe 结果避免双跑；不越界覆盖 run.answer（归 inference 步）。
  **双路**：引擎 `onComplete` 钩子 publish 后自动触发 + `POST /runs/:id/verify` 亲手跑通。回灌 FDE launcher 节点（VERIFIED 绿/
  NOT_VERIFIED 红+缺口码）+ 发 `build.verified`（runId 与 growth LOOP CONVERGED 归一）。前端 `VerificationPanel`（终态徽章 + 重跑按钮）+ MSW mock。
  测试：a10-build-verify ×5（VERIFIED/NOT_VERIFIED/BUILD_STATIC/自动触发/R2）· f60 前端 L3；修 3 处既有测试回归（verifyBuild 不越界写 answer）。
  gates 全绿（事件 38/38）。回写本体 §2.H/§3/§4。

## Wave 4 · 验证/扩展

- [x] ✅ **A14 · 亲手跑 agent evals 比对 PRD**（真 Kimi env-gated，观测 vs 期望 diff，parity 报告）。R6 R8 R13。
  L0/L1 ✅(a14 ×3) + L3(f43) ✅ + **L4 真后端 ✅**（e2e-realbackend：评测页跑一次 → parity 失因列真浏览器渲染）。
  **诚实留账（非 L4）**：真 Kimi parity 实跑仍 env-gated 未执行（mock 证框架，≠ agent 质量达标）—— 该项属 LLM 真跑欠账，与 L4 无关，仍记 DEBT。
  现状基建已在（evals.ts 逐 case 跑真 QOS + expect.intentKey/toolSequence/answerMust + EvalRunReport.metrics + MOCK/REAL）。
  本轮补 parity 层：契约 `EvalCaseResult.failKind`(INTENT/TOOLSEQ/ANSWER/OTHER) + `EvalRunReport.parity`(byFailKind 直方图 +
  byCase 逐 case 偏差)。`evals.ts classifyFailKind`(首要失因) + `buildParity` + `seedParityCases`(从 20 场景派生 intent+工具序列
  PRD 期望，`POST /b/v1/evals/seed-parity`)。真 Kimi **env-gated**（R6 不进默认 CI），mock 证框架。前端 `EvalsPage` parity 失因列。
  测试：a14-parity ×3（classifyFailKind/run 产 parity 与 results 一致/seed-parity 20 场景幂等）· f43 +parity 列断言。gates 全绿。回写本体 §2.H/§7。
- [x] ✅ **A12 · 其余模块逐一 hand-run 补全**（连接器/对象浏览/Agent 页/场景启动器…，系统化铺 hand-run 纪律）。FDE 纪律 · R10/R11/R13 实跑体检。
  起真服务 datacore:4001 + agentcore:4002（SEED_DEMO + SERVICE_TOKEN + AGENTCORE_BASE_URL 跨系统在线），admin 真请求逐模块复验：
  A12.1 连接器+A11（connector-categories ✅）· A12.2 对象浏览 A4（object-type-stats 26 类型真物化 Equipment=72，非 mock ✅）·
  A12.3 Agent/MCP A1（/b/v1/mcp/servers/solvers 跨服务 31 工具 ✅）· A12.4 场景启动器（**20 PUBLISHED 默认可见，首轮 🔴 闭合** ✅）·
  A10 终态闭环 cross-service（build {inference:true} → VERIFIED/**RUNTIME_PROBE** 真 QOS 实跑非兜底 ✅）。
  回写 `docs/AUDIT-hand-run.md`（A12 第二轮小节：验收项×实测×证据×Verdict + 诚实留账：Agent 真 Kimi 调用/规则 BLOCK/权限行级 体验级待滚动下批）。
  固化跨服务冒烟回归 xservice-smoke +1（对象类型跨服务可枚举，A4 数据路径守不回潮）。`pnpm -r test` 全绿。
- [x] ✅ **A9 · 外部引擎接入点设计（Datalog/图库/因果）— 仅设计延后**（不实现真依赖，守 R6 自包含；产设计 PRD 即算交付）。R6。
  设计 PRD 落 `docs/PRD-A9-external-engines-design-deferred.md`（含 §0 本体引用，过 prd:check 41 篇无悬空）：三引擎统一
  CP-SAT sidecar 范式接入点契约（datalog_transitive/graph_query/causal_estimate）+ 取舍 + 触发条件 + **R6 红线**（因果非确定→
  仅解释层不进真值写回）。**零代码改动**（裁决：按需延后；A3 BFS/派生 = Datalog 替代，A13 结构化归因 = 因果替代，多数场景无需 A9）。

## Wave 5 · CLI / intake

- [x] ✅ **A15 · CLI 通用操作外壳**（意图识别→模块路由→CLI 交互补参→触发模块；含 QOS 推演问答；全模块↔CLI 对等矩阵）。R15 R8 R4 R3 R6。
  **A15.1 backbone ✅（keystone）**：契约 `operation-intent.ts`（`OPERATION_CATALOG` 17 条覆盖矩阵配置化 R14 +
  `classifyOperation` **确定性关键词打分** R6 无 LLM）+ AgentCore `POST /b/v1/operations/classify`（QUERY 走 ask / OPERATION
  路由 + 低置信多候选不瞎猜）+ CLI `platform do "<NL>"` 万能路由（QUERY→ask · OPERATION→路由+下一步命令+R4 标 + uiDeepLink）。
  **R15 永续机制 ✅**：§5 新不变量 R15「CLI 对等」+ §7 `cli-parity:check` 门（`check-cli-parity.mjs` 棘轮基线，并入 pnpm gates）+
  `_PRD-TEMPLATE.md` §0 加"CLI 打通（R15，强制）"必填行。测试 a15-operation-classify ×7（分类/QUERY/深链/R6/端点）。回写本体 §2.H/§5/§7。
  **A15.2–4 ✅（模块交互流 handler + shell REPL）**：`platform-cli.mjs` 加 `build`(FDE,--mode PROVISIONAL)/`solve`(A1,--args)/
  `synth`/`types`(A4)/`generate`(A18.2 LLM 临时求解器)/`shell`(REPL 走 do) 真 handler，复用同一 REST + R3/R4 + `--json` 供 agent 解析。
  **import/model/rule 多步流 ✅**：`import <file>`（base64 上传→连接器+RawDataset）· `model <rds>`（→本体草稿派生）·
  `rule "<DSL>" --key --scope [--publish]`（建规则+发布）。**L2 真后端冒烟** `scripts/run-cli-smoke.sh`（`pnpm cli:smoke`）**8/8 PASS**：
  do→OPERATION/do→QUERY/types/build/solve/**import/model/rule**（generate 需 LLM provider，env-gated 略，同 A14 真 Kimi）。
- [~] ◐ **prototype-intake · 原型 intake 正门 + schema 对账 HITL**（上传 HTML/原型→抽数据/关系→InputManifest→建域；列不符弹 SchemaReconcile 人确认）。R6 R4 R12 R2 R15。
  **P1 + P2-core ✅**：契约 `prototype-intake.ts`（IntakeResult/ProtoDataset/ProtoLink/SchemaReconcileCandidate/ReconcileAction）+
  `databuilder/prototype-intake.ts`：`parsePrototypeHtml`（确定性抽 `const NAME=[...]` 对象数组→数据表 + `L()`/`xxxRef` 命名→关系，
  **绝不 eval 不可信输入**：受限正则+平衡扫描+轻量归一 JSON.parse，失败入 unparsed 诚实，R6 字节锁）+ `reconcileIntake`（列↔既有字段
  确定性对账：精确命中 autoMapped / 映射不上多义→候选给人确认，不调 LLM，类比 MergeCandidate）+ `POST /a/v1/databuilder/intake`
  （解析+对账既有本体预览）+ 事件 `prototype.intake_recorded`（L15）。CLI 经既有 `import` op 覆盖（cli-parity 绿）。
  **P2 HITL ✅**：候选落库（仓储 R9 四处 + migration025 reconcile_candidates）+ `GET /a/v1/databuilder/reconcile-candidates`（队列）+
  `POST …/:id/resolve`（USE/RENAME/NEW/MERGE/DISCARD → RESOLVED + `schema_reconcile.resolved` 事件 L15）。
  测试 prototype-intake ×8（解析/关系/R6 字节锁/无script兜底/对账 autoMap+候选 · L1 端点+事件+R2 · **P2 队列+resolve+R2**）。回写本体 §2.A/B/§3/§4。
  **余（增量）**：P3 串发动机 comprehend→closure→publish（resolve 决议真应用到本体）+ 参考原型回归 + 前端上传面板/对账候选面板（L3+L4）。
- [~] ◐ **A18 · 未审核态全栈建域闭环（吸收并取代 A16+A17，三合一自包含）**（用户新增需求 v0.2）：
  **A18.1 ✅（keystone · 双模闭包解阻断）**：契约 `databuilder.ts`（`BuildMode STRICT|PROVISIONAL` + `ClosureFinding.severity HARD|ADVISORY` +
  `ClosureReport.buildMode/advisoryCount/blocked` + `BuildRunBody/StoryRunRequest/WorkflowStartBody.buildMode`）+ `storybuildrun.ts`
  （`StoryBuildRun.buildMode/domainTrustLevel` + verdict `PROVISIONAL_ANSWER`）。`closure.ts validateClosure(plan,policy,buildMode)`：
  PROVISIONAL 把 FAILED/MISSING 降 ADVISORY、`blocked=false`（守"不靠阻断成 0"）、`gatePassed` 仍诚实=STRICT 口径。
  `verifyBuild` **R13 红线**：PROVISIONAL 终态恒 PROVISIONAL_ANSWER（绝不 VERIFIED/answerable）。`POST /runs {buildMode}` +
  发 `domain.provisional_built`（L15）。诚实门 `provisional-honesty.ts checkProvisionalHonesty` + `pnpm provisional-honesty:check`。
  测试 a18-provisional-closure ×4（STRICT HARD 阻断不变 / PROVISIONAL 降 ADVISORY 不阻断 / 诚实门 / L1 真服务 UNVERIFIED+PROVISIONAL_ANSWER+事件）。
  回写本体 §2.H/§4/§7；docs/PRD-A18-*.md 入库。gates 全绿（事件 40/40，STRICT 行为不变）。
  **A18.2 ✅（锁死沙箱 + LLM 临时求解器，消灭 P5）**：`solvers/sandbox-runner.mjs` + `sandbox.ts runSolverSandbox`（独立子进程
  `--permission` 拒 fs/子进程/worker + Date 冻结/Math.random 禁 R6 + 时限 SIGKILL + 净室 R5）；契约 `SolverArtifact`（origin/status §3.0
  状态机/trustLevel/hash/版本/createdBy）+ 仓储 R9 四处（migration024 solver_artifacts）；`llm-gen.ts generateSolverDraft` +
  `SolverService.generateProvisionalSolver/registerProvisionalSolver`（LLM 生成→冻结 hash→沙箱跑通自检→注册 PROVISIONAL 或
  UNREGISTERED+拒因）+ invoke 拦截（非内置 key 有 artifact → 沙箱执行，输出强标 `__provisional{origin/status/trustLevel}` R13）；
  `POST /a/v1/solvers/generate` + `GET /a/v1/solvers/:key/artifact` + 事件 `solver.provisional_generated`（L15）。
  测试 a18-sandbox ×8（无逃逸/确定性，= `solver-sandbox:check` 门）+ a18-llm-solver ×5（生成/沙箱执行/坏件 UNREGISTERED/看代码/R7）。
  诚实边界：威胁模型=LLM 生成（网络未被 Node 权限 gate，残留风险靠遮蔽+净室缓解）。
  **✅ 用户已裁决（2026-06-21，冲突已解）**：① 沙箱=独立子进程/容器。② **临时件可写真值——但限创建人**：PROVISIONAL
  开 **PROVISIONAL 未审核模式**——闭包门从 HARD 原子闸(缺一环→全 0)降为 **ADVISORY**(如实记缺口不阻断)；缺求解器
  由 **LLM 生成临时件 + 锁死沙箱跑通**；本体/数据/规则/切片/B栈全以未审核态建出(隔离·强标 origin=LLM_PROVISIONAL/
  status=PROVISIONAL/trustLevel=UNVERIFIED) → 端到端 **PROVISIONAL_ANSWER**(绝不 ANSWERABLE/VERIFIED) → 人工审核→发布晋升 GOVERNED。
  目标：那道"30% 储能→动力"问句再跑，实证表 6 行(P1 数据/P2 本体/P3 切片/P4 规则/P5 求解器/P6 B栈)全翻 ✅(未审核态)。
  分期 A18.1 双模闭包+buildMode+PROVISIONAL_ANSWER+origin/status/隔离+`provisional-honesty:check`(消 P2/3/4+解阻断) ·
  A18.2 SolverArtifact+锁死沙箱+`solver-sandbox:check`+LLM 生成跑通注册+写真值门控(消 P5)+修 A5 矩阵乐观误报 bug ·
  A18.3 PROVISIONAL 合成数据物化(消 P1)+B栈 scaffold(消 P6,A7 单机可见) · A18.4 端到端推演+人工审核台+逐项/整域晋升(VLE/校准+R4)+接 A5/A10。
  **✅ 用户已裁决（2026-06-21，冲突已解）**：① 沙箱=独立子进程/容器。② **临时件可写真值——但限创建人**：PROVISIONAL
  求解器的输出**可驱动 Action 写真值，仅当 actor === createdBy（创建人本人）**，且**写入的真值带标签**（status=审核中/
  未认证 · trustLevel=UNVERIFIED · origin=LLM · 代码可查）。**这是 R4 的创建人作用域放宽 + 强标注代偿**：创建人自担风险用
  自己造的临时件写真值，他人/自动链仍需晋升 GOVERNED 才能写。实现：ActionDraft 门检查 `solver.createdBy === ctx.userId`
  → 放行写真值但打"未认证"标；非创建人 → 拒/需晋升。③ 未审核数据默认隔离；④ 默认 STRICT，PROVISIONAL opt-in；⑤ 晋升整域+逐制品。
  注：A16/A17 已被 A18 合并取代（原 A16 文件作废）。
- ~~A16 · LLM 临时求解器~~（**已并入 A18**）：
  缺求解器时 LLM 生成 `{compute 纯函数 + outputSchema + rationale}` → **冻结 SolverArtifact(hash+版本 R6)** → **锁死沙箱跑通自检**(无网络/fs/clock/random，R5) → 注册 `origin=LLM_PROVISIONAL, status=PROVISIONAL, trustLevel=UNVERIFIED` → 推演可调(全程标"临时·未验证" R13)，**输出不可自动写真值(R4)** → 人工 看代码/编辑/替换/晋升(VLE+校准 advisory+审批→GOVERNED 解锁写真值)。分期 A16.1 沙箱+SolverArtifact+`solver-sandbox:check` · A16.2 LLM 生成+跑通+注册+写真值门控 · A16.3 人工生命周期+MCP 标+接 A5/A10。
  **✅ 用户已裁决（2026-06-21）**：① **沙箱技术 = 独立子进程/容器**（复用 CP-SAT sidecar 隔离范式，数据不出边界，比进程内 isolated-vm 更强隔离）。② **临时求解器可写真值**——用户明确接受：只要**每个求解器有状态标签**标注其可信级（origin=LLM/status=PROVISIONAL/trustLevel=UNVERIFIED 全程显示）即可写真值。**这放宽了 R4（真值经 Action 审批）对 PROVISIONAL 件的默认禁写**：实现时 PROVISIONAL 输出驱动的 Action 草稿**允许执行写真值，但必须带醒目"临时·LLM·未验证"标 + provenance 代码可查（R13 强标注代偿）**；用户已知并接受"未验证逻辑可进真值链"的风险。晋升 GOVERNED 仍解除"临时"标。

## 特性（已 APPROVED，可独立排期）

- [x] ✅ **nav-reorg · 左侧导航信息架构整理 + 层级字号修正**（用户新增需求，纯前端 IA/样式，零业务常数 R14）：
  L3(f61) ✅ + **L4 真后端 ✅**（e2e-realbackend：管理区业务域分组头真浏览器渲染，含 数据接入/建模与图谱）。
  **N1+N2+N3 ✅**：`adminRegistry.ts ADMIN_NAV_GROUPS`（7 业务域分组配置驱动 R14：数据接入/建模与图谱[含图谱并入 meta]/规则与校准/
  构建与成长/编排与场景/运营与审批/平台治理）+ `groupAdminPages`（确定性归组，空组剔除，未配置页落「其它」不丢）。
  `ShellLayout` 管理区改用 NavGroup 分组渲染（折叠记忆 + 角色/entitlement 过滤上游保留）。**N3 字号倒挂修复**：navGroupHeader
  11→13px（≥ navItem 13px，消除"父小于子"）+ section-title 10.5→12px。测试 f61 ×3（无遗漏归组/空组剔除+其它兜底/渲染分组头）。
  无需回写本体（纯前端 IA）。
  管理区 32 项扁平 → **按业务域统一分组**(NAV_GROUPS 配置驱动)；推演/数据/建模 立为一级；图谱并入「建模与图谱」组；
  补回 meta(系统自我)；字号改 **父≥子**(navGroupHeader 11→13px / section-title 10.5→12px，层级靠字重/大写/颜色)。
  逐项可见性仍按角色(visibleAdminPages)+entitlement 过滤、空组隐藏、折叠记忆保留。分期 N1 NAV_GROUPS 统一分组+渲染+meta ·
  N2 图谱并入建模组 · N3 字号方案 B。**确认点(默认取消)**：顶层"业务/管理"两 section-title 是否保留(默认全用域分组)。无需回写本体。

- [~] ◐ **cockpit · 经营驾驶舱 + 产能推演 参考原型 1:1 复刻**（数字全部从本体关系算出=数据闭环，非写死）。
  **P1 富 KPI 数据闭环 ✅**：3 绿地对象类型 `DemandSegment`(forecast)/`FinancePlan`(finance)/`MaterialBalance`(material) 走真合成管线
  (`battery.ts` 独立子流 `seed^hash("cockpit")` R6 向后兼容 + `instantiateBattery` putAll) + 派生 `revenueWan/marginWan`(Σ需求×单价×毛利率) +
  `DASH_LAYOUT` 3 富 KPI(需求P50/毛利总额/物料缺口，objects-aggregate 算出，R13 provenance) + features 注册 + data-categories 归类 + 覆盖切片。
  测试 cockpit-kpi ×3(L1 物化+派生回写+聚合 · L6 字节一致+财务交叉一致 · R2) · **L4 真后端 10/10**(富 KPI 真浏览器渲染)。debattery 零写死。
  **P2 规划决策推演 + 根因 DAG ✅**：2 绿地对象类型 `PlanKpi`(decision，actual 经 P1 同源数据算出 + 派生 `gapPct`)/`RootCauseChain`(decision，归因模板配成对象) 走真合成管线
  + `plan_rootcause` 求解器(SOLVER_KEYS 31→32，决策驾驶舱目录 COCKPIT_SOLVER_CATALOG，不进 QOS discover 22、进注册表 32；invoke 拦截读对象图)：经营 KPI 越线沿归因模板逐层取证 → 多根 DAG(kpi→factor→evidence，边权重=活数据贡献占比，「结构=算、模板=配成对象」)
  + `DASH_LAYOUT` dag widget(query.solver) + `<ProvenanceDag>` 前端三层渲染 + features 注册 + data-categories 决策驾驶舱类 + decision 域。
  测试 cockpit-rootcause ×4(L6 字节一致+KPI 与财务交叉一致 · L1 DAG 三层+边归一+逐 KPI 归因 · L1 kpiCategory 过滤 · R2) · cockpit-rootcause-dag ×2(L3 三层渲染) · **L4 真后端 11/11**(根因 DAG 真浏览器渲染)。回写本体 §2.B/§2.E/§3。
  **P3 风险看板补全 · 对症方案→工单闭环 ✅**：修复接缝 G（`mitigation_select` 方案库 canonical 取 `params.risk.mitigations` 经 `deriveExtendedArgs` 注入 → 全 7 风险因子可用，
  消除"风险卡全因子名 vs 方案库短名"漂移）+ `RiskBoardView` 风险卡详情内嵌 `<MitigationPanel>`（mitigation_select 优选方案表 → "采纳→工单"经 `adopt_mitigation` Action 审批，R4 不直改）
  + mock 同源。测试 cockpit-risk ×2(L1 全 7 因子有方案+adopt payload · L1 采纳→Action 草稿) · **L4 真后端 12/12**(对症方案 3 条+采纳按钮真浏览器渲染)。回写本体 §2.B。
  **余**：P4 型号/订单推演+反事实双轨 `counterfactual_timeline`+riskCases 真闭环 · P5 回采校准链/V5V7/AI对话/导出。
- [ ] ⬜ **synthetic-wizard · 合成向导「生成进度」按 nano-ontoprompt 分阶段集成链重设计**（把"看数据逐阶段策展本体"的 UX 精髓真正落进页面，非仅算法）。

---

## 进度账（每完成一项回填）
- 合计：**23 项**（20 PRD[A16+A17 并入 A18] + A9 设计延后 + 2 特性 + nav-reorg 新增）。完成 **14 ✅ + 3 ◐ / 23**（✅ A11/A6/A4/A13/A8/A1/A12/A9/A5/A7/A10/A14/nav-reorg/**A15**；◐ A3/prototype-intake/A18）。
  > **A18 进度**（核心几近完成，均后端测过）：A18.1 双模闭包 ✅ · A18.2 锁死沙箱+LLM 临时求解器 ✅ · A18.3 创建人写真值门控 ✅ + **PROVISIONAL 隔离物化 ✅**（伪租户 `tenant::prov::runId`，R2 天然隔离，P1 真产 rows、governed 不可见、零回归）· A18.4 晋升 GOVERNED ✅ + **审核台前端 UI ✅**（`GET /a/v1/solvers/artifacts` 队列端点 + `SolverReviewPage` `/admin/solver-review`）+ **整域晋升编排 ✅**（`promoteDomain` + `POST /a/v1/databuilder/runs/:id/promote`：审核通过 PROVISIONAL 域 → 隔离命名空间数据整体迁入真租户[本体/对象/链路/原始表/连接器/规则/切片]+发布版本+跑派生 ⊕ 逐制品晋升临时求解器 GOVERNED ⊕ 翻转 domainTrustLevel + `StoryBuildRun.domainPromotion` + 发 `domain.promoted`；前端 `DataBuilderPage` PROVISIONAL run 上"未审核预览"勾选 + "整域晋升"按钮；测 a18-promote-domain ×2 L1 · domain-promote ×3 L3 · L4 真后端 14/14）· **端到端解阻断 ✅**。**A18 全部完成。**
  > **prototype-intake 余**：P3 串发动机(resolve 决议真应用本体 + closure/publish)+ 前端面板。**A3 余**：参考本体基线(元租户 95 节点，低价值数据撰写)。
  > **2026-06-22 测试欠账已补实**：A5/A7/A10/A14/nav-reorg 先按 SOP line-54 由 ✅ 降 ◐（前端只到 L3）；随后**补 L4 真后端 E2E**（`scripts/run-l4-realbackend.sh` 起真 datacore+agentcore+vite 真后端模式 → Playwright 真 Chromium，**9/9 通过**）→ 5 项回 ✅。A14 的"真 Kimi parity 实跑"仍 env-gated 未执行（与 L4 无关，记 DEBT）。
- **Wave 1–4 全清（后端 + L4 真后端 E2E）**；**Wave 5**（A15 backbone · prototype-intake P1+P2-core · A18.1 双模闭包，均后端 ✅）；**特性**（nav-reorg ✅ · 余 cockpit/synthetic-wizard）。
- 余下：**A18.3**（PROVISIONAL 隔离物化+创建人写真值门控）· **A18.4**（审核台+晋升 GOVERNED）· **cockpit**（驾驶舱 1:1）· **synthetic-wizard**（ontoprompt 链 UX）· A15.2–4 handlers · prototype-intake P3 · A3 参考基线。
- ✅ A11（per-connection 归类，Wave 1，亲手验过真 UI）。
- ✅ A6（拟真值域 + 越线植入；全服务 e2e 跑通，仅余 A6.3 电池内部收编=可选，电池字节已保持）。
- ◐ A3（A3.3 规划器 + A3.1 14 域注册表 + A3.4 索引复用 + A3.2 两库 **均 done**；仅余 A3.1 参考本体基线 95 节点，低优先 → A3 核心能力链已闭合）。
- 下一步：A3 核心已闭合（域→规划器→索引→两库）；可进 **Wave 2**（A1 求解器→MCP / A8 CP-SAT / A13 地板语义 / A4 对象浏览器），或补 A6 尾巴 / A3.1 参考基线。A16 决策已定可排期。
