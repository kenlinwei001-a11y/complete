# 覆盖核查 · 用户全部要求 ↔ PRD/HANDOFF 未完成项（审核方核发）

> **这份回答什么**：用户问"**按照所有的 PRD 和 handoff 列出未完成的事项，对应我提到的所有要求里面，看看我的要求是否都被覆盖了**"。
> 审核方把**本会话内用户明确点名的每一项要求**，逐条映射到**它被哪份 PRD/HANDOFF/清单登记、当前真实状态、是否在施工队列**。
>
> **判据来源诚实标注**：✅真跑 = 审核方起真系统+真浏览器/curl 双路取证；◐dev报 = dev 已 commit 但审核方未复验；🔎grep = 仅代码静态确认存在/缺失（非运行时）。**凡 grep 推断的，本表显式标 🔎，未冒充真跑。**

> ### ⚠️ 审核方纠偏（后续 📖读源坐实·本表部分行已过期）
> 本表初写时「轨N 0 提交」**已过期**。审核方 📖读源复核（`REVIEW-hollow-data-iceberg-and-requeue.md` §D1）：`RuleRef.tsx`（带 `definedBy/definedAt/effectiveFrom/effectiveTo/basis` 全字段）+ `Provenance`/`ProvenanceDag` **已建并接入** Dashboard/Ledger/SopBalance/PlanGenerate/ProjectSim/PlanAudit/**OrderChainView**（含 N-R1/R2/R3·跟进2 commit 标记）；`OrderChainView:486/495/504` 的 `ruleRefs.join("/")` **已包进 `<RuleRef>`**（非裸文本）；`:141` 下钻面包屑+返回已加。**⇒ 轨N 现状 = ◐ 大部接全·待真浏览器复验（下钻回退真不死路 + provenance 字段后端真返回），绝非「0 提交」。** 下方 U3-U6/U11/§4 的「轨N 0 提交」按此纠正。

---

## §0 一句话结论

**纸面上全覆盖**——用户点名的每一项要求都能在某份 PRD/HANDOFF/清单里找到登记。**但有两簇"已登记·未在施工"，会随 dev 做完 轨R 而被默认遗忘**，必须显式重新入队：

1. ✅ **可信溯源 4 项（轨N）**：逐单下钻回退 / C02 悬停谁设定·时间·边界 / 数据可信溯源 / 关联风险点详情——**~~0 提交~~ 已纠正：组件全建+接入 7 视图+`OrderChainView` 裸文本已换 `<RuleRef>`+下钻回退已加（见顶部纠偏 + `REVIEW-hollow-data-iceberg-and-requeue.md` §D1）。现状 ◐ 大部接全·待审核方真浏览器复验**（下钻不死路 + provenance 字段真返回）。
2. ⚠️ **主题/配色开关（轨O）**：HANDOFF 已成文，但**功能本体未建**（🔎无 `[data-theme=light]` token 组、无 header toggle、无 localStorage）；"主题接轨O审计"提交只是让 轨P/Q 组件**合规**，非建开关。

外加 2 项**已在清单·尚未做**：预判推演看板红色接真数据（#10·后端 TO-DO）、订单全链 C02 溯源（与轨N同根）。

---

## §1 用户要求 ↔ 覆盖映射（主表）

| # | 用户点名的要求（本会话） | 登记于 | 当前状态 | 取证 | 是否在施工队列 |
|---|---|---|---|---|---|
| **U1** | **假推演诚实化**：mock/哈希/写死不得冒充真算，无真数据→诚实标"估算/无实测" | 轨M + `AUDIT-fake-simulation-inventory.md` | ✅ 大部闭：risk-board/沙盘 MOCK 卡均黄标"估算·无实测(mock 基线 N)" | ✅真跑（实拍坐实） | 持续红线·已生效 |
| **U2** | **预判推演看板红色写死**："点红色→暂无数据，红色是写死的吗" | 补齐清单 §2D **#10**（用户拍板选项2·后端深修） | ❌ 真缺：红/峰值/越线日仍源自 `risk.ts:28-38 mockTightness` charCode 哈希；点红→`AffectedOrdersModal` 查真订单→mock 基地空→裸"暂无数据"死路 | ✅真跑（已诚实标，但底层非真数据） | **已在清单·未做** |
| **U3** | **逐单下钻回退**：下钻不能死路，进得去也回得来 | **轨N** HANDOFF §1（下钻导航行）+ 增量1③ | ❌ 未接：`DashboardView:199 navigate` 跳转无回退 | 🔎grep（HANDOFF 锚点） | ⚠️ **轨N 0 提交·未入队** |
| **U4** | **C02 悬停溯源**：规则号悬浮出谁设定·设定时间·有效边界 | **轨N** HANDOFF §1（规则号 C0x 行）+ 增量1①/增量2 | ❌ 未接 + 未扩：`OrderChainView:464-466 ruleRefs.join("/")` **裸文本仍在**；Rule 无 `definedBy/definedAt/effectiveFrom/effectiveTo/basis` | 🔎grep（刚确认锚点+字段缺） | ⚠️ **轨N 0 提交·未入队** |
| **U5** | **可信性溯源**：每一类展示数据都能就地溯源建立信任 | **轨N** HANDOFF §1（全数据类表）| ◐ 基建全在（`RuleRef`/`Provenance`/`DagNodeDrawer`/`RiskPopover`/`EvaluatedRules` 都已建）但**没接全** | 🔎grep（组件在·未接全） | ⚠️ **轨N 0 提交·未入队** |
| **U6** | **关联风险点详情**：风险点"详情"弹窗（逐工序细节） | **轨N** HANDOFF §1（风险点行）+ 增量3① | ❌ 缺详情弹窗：`RiskPopover` 仅悬浮部分信息，未接 `bottleneck_matrix` 进详情 | 🔎grep | ⚠️ **轨N 0 提交·未入队** |
| **U7** | **HTML 母版对齐**：驾驶舱/规划/项目三板块逐板块对齐设计母版 | 轨M + 补齐清单 §1/§2（审核方实拍核发） | ◐ 大头已建（#5/#6/2a/2b/3a/3b/型号六步 ✅实拍）；残 #2/#3/#4 半建 + #10 后端 | ✅真跑（三板块 5 视图实拍） | 部分在（补齐清单驱动 轨R） |
| **U8** | **主题/配色开关**：浅色 ↔ 黑曜石 | **轨O** `HANDOFF-theme-switch-…md` | ❌ 功能未建：无 `[data-theme=light]` token 组、无 header toggle、无 localStorage；现 `tokens.css` 仅暗色 | 🔎grep（刚确认缺） | ⚠️ **轨O 未入队**（仅"接轨O审计"合规检查跑过） |
| **U9** | **1:1 复刻 建模族**（数据流DAG+L0-L4认证+对象配置） | **轨P** `SPEC-replica-modeling-family.md` | ✅ 全 4 增量闭合（92160da/bc93ff0/3730ef5/f51a022+06605ff） | ✅真跑（curl+真浏览器双路·四增量逐一） | ✅ 完成 |
| **U10** | **1:1 复刻 沙盘族**（初始化向导+运行台+评估+风险榜） | **轨Q** `SPEC-replica-sandbox-family.md` | ✅ 全族增量0–4（de7e4fd…2fa150f）+ BLOCKER 修复（b89c53a）后 build 真绿 | ✅真跑（含 `pnpm -r build` tsc 亲验绿） | ✅ 完成 |
| **U11** | **订单全链聚合页面调整** | 补齐清单（假3库存）+ **轨N**（C02 溯源） | ◐ 假3库存✅修（去 hashN·营收×占比估算·诚实黄标）；但 C02 三判规则号**仍裸文本**（=U4 同根·轨N） | ✅真跑（假3）/🔎grep（C02 裸文本） | 假3已闭 / C02 随 轨N 待入队 |
| **U12** | **本体建模工作台 低代码工作流**（图查询构建器+平台查询语言+codegen+Query→Skill/MCP 绑定） | ③类 TO-DO（`design-system §10.1`）+ PlatformConsole 图查询 tab | 📋 诚实 RESERVED：前端 tab 显式标"后端整块尚未建"，**未画假壳**；后端未建 | ✅真跑（RESERVED 实拍） | 📋 登记 TO-DO·后端未建·诚实不做 |
| **U13** | **订单驱动三关联判（#7）**：逐单交期/齐套/财务判→verdict+对冲 | **轨R** 增量1（补齐清单 §2 #7） | ✅ 闭合（2fb1d46）：接现成 `order_fullchain`·additive 不破型号六步·7 RuleRef 芯片全=oracle | ✅真跑（curl+真浏览器双路·SO-3391） | ✅ 完成 |
| **U14** | **待解决问题 8 根源（#1）**：驾驶舱问题面板 4→8 类 | **轨R** 增量2（补齐清单 §2 #1） | ◐ dev 刚提交（cf06767·扩 buildOrderProblems 按 ROOT_LIB 分桶接真 affected_orders） | ◐dev报（**审核方未复验**） | ✅ 已做·待审核方真跑核 |

---

## §2 沙盘 ③类·诚实延期（用户隐含关心·已登记 TO-DO·正确未造假）

> 轨Q 收尾时按 `design-system §10.1` 登记、**因后端未建而诚实不做**（非遗漏·非偷工）。dev 未画假数据雷达——守红线。

| 项 | 状态 | 登记 |
|---|---|---|
| 图查询低代码（=U12） | 📋 RESERVED·后端未建 | design-system §10.1 |
| 6 维健康雷达 / 4 维信任雷达（真派生版） | 📋 部分（沙盘已有派生 cert 双雷达雏形·轨Q 增量3）·完整版后端待建 | §10.1 |
| 业务动作 + RL4 | 📋 RESERVED·后端未建 | §10.1 |
| 分层目标（GEO_WITHIN 约束等） | 📋 RESERVED·后端未建 | §10.1 |

---

## §3 不属于"用户本会话点名"的平台大盘（区分·防混淆）

> START-HERE §2 列 **17 条已就绪轨（A–R）**，多是平台成熟度收尾（VLE/优化融合/规则一等/场景发育/管理面/QOS 全量/数据流闭环…），`COMPLETION-LEDGER` ~679 待真跑点。**这些不是用户本会话明确要求的**，是更大的路线图。本表只核"用户点名要求"的覆盖；大盘按 START-HERE 节奏走，**别拿 680 点盲建**（违 §3 警告）。用户若要我把大盘也逐轨核覆盖，另开一份。

---

## §4 给开发 agent 的"重新入队"清单（审核方建议·用户拍板转发）

按优先级（轨N 是用户反复点名的"可信"地基·HANDOFF 自己也标"先于 O 做"）：

1. ⚠️ **轨N 全域可信溯源**（`HANDOFF-trust-traceability-build-and-review-contract.md`）——**4 项用户要求(U3-U6)的唯一归属·当前 0 提交**。增量0 审计取证 → 增量1 接全（`OrderChainView:464-466` 三处起换 `<RuleRef>`·去下钻死路·复用 `DagNodeDrawer`）→ 增量2 扩 Rule provenance → 增量3 风险详情+`traceability:check` 门。
2. ⚠️ **轨O 主题/配色开关**（`HANDOFF-theme-switch-build-and-review-contract.md`，U8）——加浅色 token 组 `[data-theme=light]`+header toggle+localStorage+收口硬编码十六进制；语义域色 theme-invariant。
3. **#10 预判推演看板红色接真数据**（补齐清单 §2D·U2·后端深修）——`risk.ts`/`RiskTimelineOutputSchema` 给 MOCK 因素补真数据源，点红出真受影响订单。
4. **#2/#3/#4 半建精修**（补齐清单 §2B·U7 残）——KPI 八卡溯源富度 / event 层 / 项目级聚合勾稽表。

---

## §5 审核方诚实交代（哪些还没真跑·我下一步可做）

- **U14（#1 八根因）** 是 dev 刚提交（cf06767）、**我尚未真浏览器复验**——下一步可起真系统验"问题面板真出 8 类·各可下钻"。
- **U3/U4/U6/U8** 我此处是 **🔎grep 锚点确认**（C02 裸文本仍在、无 provenance 字段、无 theme toggle 是代码静态铁证·可信），但"运行时下钻是否真死路 / 风险弹窗到底缺到哪步"我**还没逐项真浏览器走查**——按既往纪律（grep 常漏报已建功能），我可对 轨N 簇做一次真浏览器实拍把"真缺到哪步"钉死，再交 dev，避免照纸面盲建。
- 要我**起真系统走查 轨N 簇 + 复验 #1**，说一声即可。
