# 仓主要求 ↔ WO 追溯台账

> **为什么有这份文件**：2026-08-14 容器重启把 9 个后台任务一起杀掉，2 张单的产出因未 push 丢失。
> 口头追踪的要求同样会随上下文丢失。此表是**唯一台账**。
>
> **⚠️ 2026-08-14 第二版 —— 仓主指出第一版「不完整」，属实，两类错都记在这里**：
> 1. **漏记**：做了但没进表（如「这些数据是什么」的屏上读法说明）。
> 2. **过度声称**：把「数据构建发动机」的 6 步流程记成一个 ✅ + 两个 🟡，
>    而依据是 `dbui-flow-order` 门 RC=0 —— **那道门只量「主流程排第一」，不量「6 步各自做没做」**。
>    形态：**「我用『门 RC=0』当作『这 6 步都做好了』的证据，而前者并不度量后者。」**
>    第二版逐步读源码复核，结论是**比我记的更完整**（⑤⑥ 都做了）。
>
> **状态口径**：✅ 已交付并收编且**亲手复验过**（注明复验方式）· 🟡 部分（缺口写明）·
> ⛔ 未派 · 🔶 等仓主裁决（产品/信息架构决策）· 🔷 在仓主手上

---

## A · 推演沙盘 / 推演页前端

| # | 仓主原话 | 状态 | 复验方式 |
|---|---|---|---|
| A1 | 「推演沙盘前端开发完毕了吗」「何时可以上线最新的」 | ✅ | 多批收编，前端全量 1554/1561 |
| A2 | 「没有看到类似**地铁线路**的 UX」 | ✅ | `docs/shots/WO-R9-METRO-UX/` 四张截图 + 可重跑 `shot-metro.mjs` |
| A3 | 「文字都看不清楚，文字与背景色**反差太低**」 | ✅ | 三套皮肤各 422 元素，**184/141/318 → 0/0/0**；`check-text-legibility` RC=0 |
| A4 | 「**关系边（本体图谱结构）**，为何目前系统里没有这个功能？」 | ✅ | **现算名册 10 页 · 挂对 9 · 在册裁决 1**（`node scripts/check-edge-active-mounts.mjs`，判据②③④ 全过）。⚠️ **原文那个「9 页」曾经是个假数**：它是门里**手抄**的 9 条名单，`cleanroom-attr` / `disruption-radius` / `order-chain` 三页不在名单里 ⇒ **从未被这道门问过一次**（本体 §8 `G-GATE-ROSTER-HANDCOPIED`）。名册改现算（`WO-INFER-PAGE-SSOT`）后当场多问出 3 页，`WO-EDGE-PANEL-3PAGES` 逐页判定并收口：`order-chain` **补挂**（左导航「推演」组 · demo 传导边里 Order 是一等端点）；`disruption-radius` **补挂 + 另做本页自有的关系边开关**（关掉一跳 ⇒ 扇出改道或断链 ⇒ 半径/波及数/DAG 真变 —— 这一条才是本行原话点名的「关系边（本体图谱结构）」本身）；`cleanroom-attr` 判**不适用**并在棘轮基线里逐条写明理由 + 差什么才能收（见 `scripts/edge-active-mounts-baseline.json`）。接缝门 `test/edge-panel-3pages.seam.test.tsx`（6 例，含两个变异反证）。 |
| A5 | 「目前系统的页面**都参照这个做了调整**吗？」 | ✅ | **10/10 页逐页有结论**（9 挂 + 1 判不适用带理由），名册**现算**不再手抄 ⇒「都」这个字第一次可核对。此前记的「9/9」度量的是「门问过的那几页都合格」，不是「该合格的都合格」——**同一个形态换了张脸**（铁律 0.6）。 |
| A6 | 「输入扰动因素后会出现一个『**求解**』的 icon，很难看」 | ✅ | 改 `inflightStrip`：`min-height` 无跳动 + 呼吸点 + 文字取消 |
| A7 | 「没价值则展示**汇总数据**，点击后再展示详细数据」 | ✅ | 汇总条 + `<details>` 折叠；**刻意不报「缺口 X→Y」**（面板拿不到 gap，编造就是造数） |
| **A8** | **「这些是什么数据？对客户的价值是？」** | ✅ **（第一版漏记）** | 屏上读法说明：`对象 = 基地\|产线\|型号 · cellsPerDayP50 = 该格产能 P50（电芯/日）`，表头三列全带单位。**改名后同步更新过**（原写 `p50`） |
| A9 | 「推演沙盘的 UI 的**图片**发我一下」 | ✅ | 已发；证据留在 `docs/shots/` |
| A10 | 「你输出一个推演前端**完整的 html**，包含多一个页签」 | ✅ | 已交付 |
| A11 | 「为何我希望看到的都在**别的页**，是第一个页面多个页签模式？」 | ✅ | 沙盘改为多档同页（第五档即由此而来） |

## B · 后端有功能、前端没有（接缝断链）

| # | 仓主原话 | 状态 | 复验方式 |
|---|---|---|---|
| B1 | 「**彻查**所有后端有功能、前端没有的情况还有哪些」 | ✅ | 建 `befe-seam:check`；零调用 **196 → 128** |
| B2 | 「**都派**」 | ✅ | BEFE-A/B/C/D/E/F/G 七张全收编 |
| B3 | 「不局限在推演沙盘，而是**整体系统**」 | ✅ | + REFERENCES-FAMILY：引用族 9 条 → 一个客户端 + 一块共享面板 |
| B4 | 剩余 `POST /a/v1/process-instances` | 🟡 | **诚实挂账不接**：契约要 `tasks.min(1)`，而流程定义**零步骤字段** ⇒ 前端无数据源可填。前置是**步骤模板层**，⛔ 未派 |
| B5 | 屏上承诺的 Action 要真接上（WO-SIM-ACTION-REAL：「我需要完成一个可交付的系统，不是 demo 系统」⇒ 对假承诺的处置是**接上，不是撤文案**） | ✅ | 项目推演屏 DAG fc 节点「结论可采纳为 Action」原零接线（金丝雀自证后四个 Action 符号 0 命中）→ 步骤⑥「采纳结论」真接既有 S2 链：ActionDraft（参数组合+量纲核对过的推演快照）→ 审批 → domainExecutor 新分支**真落 ForecastAdoption 台账对象** + 选中订单回 stamp（targetRef 用 `FC-ADOPT:` 不用假 MO 号）；头号验收 = 审批后**另一条路读回**字段逐值对拍（datacore seam 4/4 + 前端 2/2），变异反证真红（拆写入 → 「expected [] to have a length of 1 but got +0」）；剩 `采纳经营方案` 一型 NOT_IMPLEMENTED（本体 G-ACTION-NOOP-EXEC 已回写 ◑ 部分闭合） |
| B4 | 剩余 `POST /a/v1/process-instances` | ✅ | **前置已补、线已接、接缝已驱动通**。前置（步骤模板层）落地：契约 `process-step-template.ts` + 表 + 种子 + 读端点 `GET /a/v1/process-definitions/{key}/step-template`；`tasks.min(1)` **一个字未放宽**，改的是步骤从**模板**来。前端 `views/process/ProcessStartFromTemplate.tsx`（挂 `/v/process-stuck` 页内）经契约 `tasksFromStepTemplate()`（前后端共用的唯一一处转换）折出 `tasks` 再 POST。**实测**：`apps/datacore/test/process-instance-wire.seam.test.ts` 走界面同形链路 ①模板 → ②`GET /a/v1/objects?type=<carrierTypeKey>`（按钮的渲染前提）→ ③转换 → ④POST → ⑤`GET …/{id}` **读回**，7 条有模板的流程**全部走通**且读回步数 == 模板步数（P25/2步/对象9 · P34/2/1 · P35/2/20 · P41/3/17 · P42/2/20 · P43/2/20 · P51/2/20）；变异反证 RC=1。前端侧 `test/process-start-from-template.seam.test.tsx` 8/8 绿 |
| B4a | 同族**仍欠**：`POST …/{id}/advance`、`GET …/{id}` | 🟡 | **诚实挂账**：两个客户端函数（`api/endpoints.ts` `advanceProcessInstance` / `fetchProcessInstance`）**生产消费方为 0**（金丝雀：同法查 `createProcessInstance` 命中组件 2 处 ⇒ 工具是好的），属「死端点换成死客户端函数」那一形态。⚠ 接缝门**照不见**它们：门的前端侧只比**路径字面量**不比方法，`endpoints.ts` 里有字面量就判"已接"（该盲区基线 note 已记）。后果：实例建出来后**界面上再也看不到它**（除非它恰好卡住进了卡点清单），也**无法推进**。卡在「实例详情/推进要放哪个页」= 导航信息架构，属仓主决策 |

## C · 数据构建发动机 / 逆向数据推演 —— **第二版逐步复核**

仓主原话：「输入故事脚本 - 显示目前缺少的信息（数据字段，求解器，约束，规则，本体…）
- 人工触发创建 - 开始创建 - 完成创建（显示创建的信息）- 人工确定入库或选择下载」

| 步 | 屏上真有的 | 状态 | 复验方式（读源码 `DataBuilderFlow.tsx`） |
|---|---|---|---|
| ① 输入故事脚本 | `STEPS[0] "输入故事脚本"` + `dbf-start` 按钮 | ✅ | :29 STEPS 定义 · :286 StepBox |
| ② 显示还缺什么 | `"系统读出来什么 · 还缺什么"`，**提到一等位置**（原埋在「展开七阶段→点进 gap」三层之下）；分项列**求解器入参缺 / 全链未注册 / 渲染形状不匹配** | ✅ | :322 注释 + :338–344 |
| ③ 人工触发创建 | `"确认开始创建"` 独立一步 | ✅ | :350 |
| ④ 开始创建 | `"创建中"` | ✅ | :361 |
| ⑤ 完成创建（**显示创建的信息**） | 汇总条 `dbf-module-summary`（触及 N 个模块）**＋ `ArtifactDetailTable` 明细表** | ✅ **（第一版记成 🟡，低估了）** | :373–388；「汇总条回答波及面，下面那张表回答具体是哪些 —— 两个问题不同，都要」 |
| ⑥ 人工确定入库或下载 | `"入库前复验 · 入库或下载"`：`PromotePrecheckPanel` + `downloadPlan` | ✅ **（第一版记成 🟡，低估了）** | :390；下载的是**可重放的 `BuildPlan` JSON**（含 script / scriptHash / seed / 13 类 needs），文件名带 scriptHash 前 8 位与 seed ⇒ 同一份 plan 两次下载同名 |

| # | 仓主原话 | 状态 | 复验方式 |
|---|---|---|---|
| C7 | 「模拟的数据是否可以入库，需要**系统再次复验自检**（人不清楚系统里数据现状、**是否有冲突**）」 | ✅ **（第一版记成 🟡）** | `PromotePrecheckPanel`：**三类冲突分开显示，绝不合成一个「N 条冲突」**（「会改掉既有定义」与「写了个一样的」性质不同）；无冲突时明说「没有撞上任何既有数据，可以直接入库」；预检**一个字节都不写** |
| C8 | 「逆向数据推演…你解决了吗」 | ✅ | v4 反推三缺口全闭：哈希占位诚实位 · `coverage` 死杠杆判定为**派生不存储**（避免同一自由度存第三份）· 流程运行时两半 |
| C9 | 「你目前数据构建发动机的前端 UX 逻辑，**我看不懂**」「这些都是我**看不懂**的功能」 | ✅ | 建 `dev-jargon:check` 用 TS 解析 JSX **只取真上屏的字**，禁「区2/区4」「三页归一」「厂商中立施工」；建 `dbui-flow-order:check` 咬死主流程排第一 |
| C10 | 「13 类需求卡片在第 ② 步展示」 | ✅ | 13 类**全部上屏**，一类不少。**权威清单** = `MODULE_KINDS`（`contracts/src/databuilder.ts` §模块全集，13 项）+ `MODULE_KIND_REGISTRY`（人话名 + 去哪核对）。屏上渲染 `BuildJob.needs.groups`（`DataBuilderFlow.tsx` 的「逐类清点」段）。**7 类跨系统的现状诚实挂账**：A→B 今天只有「下发即创建」一条通道、没有只读探针 ⇒ 建之前查不到，故出 `evidence=NOT_PROBED` 并在屏上明说「要等创建时才知道」，**不渲染 0**（0 会被读成「不缺」）。复验：`pnpm --filter frontend-shell exec vitest run test/dbui-13-needs.seam.test.tsx`（7/7）+ `pnpm --filter datacore exec vitest run test/databuilder-needs.seam.test.ts` |
| C10-注 | 上一版那条**分诊是错的**，记账防复发 | — | 原文写「`BuildPlan` 无 by-id 读端点（全仓 grep 无 `/build-plans`）」。**两句都不成立**：端点是 `/a/v1/data-builders/plans/:id`（`datacore/src/app.ts`，搜 `data-builders/plans`），前端 `endpoints.ts` 的 `fetchBuildPlan` 早已接上；`BuildPlan` 顶层**恰好 13 个 need 数组**（`scenarioTopology` 是 object 不计）。形态：**「我用『我猜的那个路径 grep 不中』当作『端点不存在』的证据，而前者只度量我猜错了名字」**。真缺口从来不是「没端点」，而是**干跑那条路上没去比对现状**、回执只塞了没类型的 5 键散记 `BuildJob.preview`（`z.record`，历史消费方仍在读，故保留）。**「5 类」与「13 类」是两个不同字段**（`preview` vs `needs`），不是同一个数少了 8 —— 混为一谈会去修错的地方 |

## D · 决策质量（「传统 BI」那条）

| # | 仓主原话 | 状态 | 复验方式 |
|---|---|---|---|
| D1 | 「典型的传统 BI，只展示发生了什么，**不提供根因分析，不提供解决推演后的方案**」 | ✅ | 查实**真病比原报的重**：不是「数值写死」，是**方案身份与根因语义无关**（现金域根因是应收账龄，照样推「正极供应链战略」）。改为**依据可核对才下发** |
| D2 | 同上·下半场（不然屏上变成无缘无故的空白） | ✅ | 三种态说**三句不同的话**；`gapClose=null` 时**屏上一个 0 都不出现**；依据强度靠**字形+词+边框**分档不靠颜色 |
| D3 | 门抖出的同族矛盾 | ✅ | 「因为 A 家违约 ⇒ 给 B 家加条款」治根；顺带查出屏上那个「160 万」**从头到尾指错人**（cost 也读了错的那份长协） |
| D4 | 同族·更狠的一条 | ✅ | 入口因子改为**本域因果 DAG 的源点**。**反例已躺在库里**：`capacity` 域 2 条非根因子，字母序恰好选中零出边那个孤点 |
| D5 | 5 条阻滞点对不上 | ✅ | `DYNAMIC-*` 解析从播种期搬到查询期。对上率 **12/17 → 17/17**（诚实拆分：EXACT 2→1 · TYPE 10→16 · NONE 5→0） |

## E · 导航与信息架构

| # | 仓主原话 | 状态 | 说明 |
|---|---|---|---|
| E1 | 「导航栏里面的『决策推演』**不应该在这个位置**，而是嵌入到每个需要决策的点」 | ✅ | 抽成 `DecisionPlayPanel` 唯一实现，壳与嵌入同一份（改一处文案两处同时变，门咬） |
| E2 | 是否**删掉**导航项 | ✅ **已裁决·已落**（WO-IA-E2E5E6） | 删导航项留 route：NAV_GROUPS 条目删、`ROUTE_NO_NAV` 登记（门判据④+ f61 同读此表）；深链 `imp*` query 契约不动，双断言接缝测试 `nav-ia-decision-play.seam.test.tsx` |
| E3 | 「『流程等待态』是干嘛用的？客户什么场景需要进入？」（问了两次） | ✅ | 答：模板层「这**类**流程通常等什么」+ 实例层「**这一张单**卡在第几站」 |
| E4 | 「它应该在**推演沙盘里面**，且是**动态的数据变化**，基于某个时间 screenshot 有个总结」 | ✅ | 第五档接推演节拍；覆盖率 9/65 → **29/65**，且 29 条**条条真动** |
| E5 | 两页是否合并 / 移组 | ✅ **已裁决·已落**（WO-IA-E2E5E6） | **不合页**（类 vs 张两问正交），做双向入口：模板层每站行内「现在有 N 张单卡在这里 →」→ 实例层 `?proc=<key>` 过滤；实例层每张卡「这类流程通常在这站等什么 →」→ 模板层 `?focus=<key>` 行定位。验收接缝测试 `process-wait-stuck-link.seam.test.tsx`：**模板层计数 == 实例层过滤后实际条数**（非链接存在性）+ 计数拿不到摆「暂不可得」绝不摆 0 + focus 查无此站明说（P44 活样本） |
| E6 | 「订单全链条推演与项目推演，**是否部分功能重复**？」 | ✅ **已裁决·已落**（WO-IA-E2E5E6） | 订单那个已改「订单进展与卡因」；本次改名：**项目推演→接单可行性 · 全局项目推演→接单组合优选 · plan-generate 导航标题→规划建议**（「优选」非「最优」：求解器无最优性保证，强承诺不上屏）；featureName 名册两键暂留旧名（与 agentcore 受检副本互锁，超出本单范围，见交单报告残留登记） |
| E7 | 「是否修改为**订单状态**，且需要类似地铁线路图的 UX 展示进展？」 | ✅ | 单订单地铁图已接（复用组件零改动，锚 `data.so` 真实订单） |
| E8 | E6 残留③：页内「最优」措辞与「优选非最优」裁决的张力 | ✅ **已闭**（WO-OPTIMAL-WORDING） | 求解器最优性先取证（docker CP-SAT 可证最优 / 内存态 InProc 贪心恒 `optimal:false`）→ 13 处无撑静态承诺改「优选」系 + 依据句；`MultiObjWhatifPanel` 写死「CP-SAT 可证最优」徽标改动态跟 `occ.data.optimal` 走（内存态那是谎话）；机制 = `claim-strength:check` 门（命中必须有登记依据，死账也红）+ `scripts/claim-strength-registry.json` 对账表（首扫 25 条命中全部登记）。复验：`node scripts/check-claim-strength.mjs` RC=0 · `--selftest` 12 条全中 |

## F · 产能推演可读性

| # | 仓主原话 | 状态 | 复验方式 |
|---|---|---|---|
| F1 | 「**看不懂**『产能推演』这个 UX，你希望用户看到这个做什么？」 | ✅ | 6 层产能金字塔按 `role` 公式可读化；分层欠账 **21 → 0**，`check-ui-first-layer` **首次 RC=0** |

## G · Agent 系统换心

| # | 仓主原话 | 状态 |
|---|---|---|
| G1 | 「期望用 deepseek-harness 替换目前的 agent 系统，**是否可行**」 | ✅ `docs/REPORT-harness-migration-feasibility.md` |
| G2 | 「所有推演的功能都需要**借鉴这个设计 UX**」 | 🔶 **等仓主一句话** —— 「这个」的指代物**仓内有三份互相冲突的记录，全出自我，从未对账**：（甲）台账 §G 的章节归属暗示是 deepseek-harness；（乙）`docs/WO-ACTIVE-EDGE-UX.md` 第 43–45 行写「参考 HTML 里关系边上的 active 开关」；（丙）`docs/ASSESS-pi-agent-harness-replacement.md` 记着仓主校正「把 agent 的 UI/UX/CLI 升级到 pi 的水准」。⚠️ 我这张派单**引用了乙的原话，却按甲的章节归属去认指代物** —— 形态：「我用『这条记录躺在 §G 里』当作『它说的是 deepseek-harness』的证据」。⚠️ 且**本行此前记 🟡 与 §A 的 A4/A5 记 ✅ 是同一件事** —— 同一条要求在台账里同时是 🟡 和 ✅。**已交付**：从仓内 `docs/reference-prototype-decision-platform.html` 抽出 **9 条可逐页对照的判据**，12 页 × 10 判据 = 120 格三态表（符合 17 · 不符合 46 · **判不了 57**），并建门 `sim-ux-criteria:check` 守判据表本身。 |
| G3 | 「关于换心，是否需要做一个 **POC** 验证？」「你发我提示词，我转发给做 POC 的 dev」 | 🔷 **在仓主手上**，进度我不掌握 |
| G4 | 「你看一下 **POC 测试报告**」 | ✅ 已阅并反馈 |

## H · 交付节奏（仓主对我的要求）

| # | 仓主原话 | 状态 |
|---|---|---|
| H1 | 「赶快把 65 条并进 canonical」「gate 绿了再并」 | 🟡 **仍欠**：canonical 停在 `c87656a1`，集成分支已积 300+ 提交。四包 `build` RC=0，`test` 段待起 |
| H2 | 「未派发 3 张为何不派」「为何不是 7 个 agents 跑」「火力全开」 | ✅ 按 CPU 画像分层派；本轮峰值 7 |
| H3 | 「为何你不即时 push？」「沙箱定期重启，需要有应对机制」 | ✅ 每单元即 push；**本次重启实测 4/6 分支幸存** |
| H4 | 「**输出中文**，只要论点论据，不要思考过程」 | ✅ |
| H5 | 「完成了 PRD 就派单，无需我确认」 | ✅ 铁律 0.6「不许为派活请示」 |

---

## I · 交付底座：typecheck 扫描面（WO-TEST-TYPECHECK-BLIND · 2026-08-16）

> 仓主原话：「**我需要完成一个可交付的系统，不是 demo 系统。**」
> 这一条不是某个功能，是**判据本身的可信度** —— 本表序言里那句
> 「我用『门 RC=0』当作『这 6 步都做好了』的证据，而前者并不度量后者」，
> 在 typecheck 上有一个更彻底的版本：**它连看都没看。**

| # | 事实 | 状态 |
|---|---|---|
| I1 | `datacore`/`agentcore` 的 `typecheck` **从不检查测试文件** —— `tsconfig.typecheck.json` 早在 `7302a0fc`（2026-08-13 · WO-R4「件一(1/2)」，标题自陈只做一半）就建好且注释写明要纳入 `test/`，而 `package.json` 的脚本**从来指向 `tsconfig.json`**；第二半的接线躺在 `claude/handoff-wo-typecheck-testblind` 上、被标注「[待裁·勿盲并]」而未并 —— **因为光翻开关会当场变红**。三天里 **466 个测试文件零检查** | ✅ **已接线**（两包脚本改指宽面；build 用的 `tsconfig.json` 未动） |
| I2 | 接线后暴露 **354 个**真类型错误（datacore 272 + agentcore 82，涉 69 个文件） | ✅ **全部修完归零**，亲手复验：两包 `tsc -p tsconfig.typecheck.json --noEmit` 各 **0 error** |
| I3 | 修的位置 | ✅ **全在测试侧，生产源码零改动**；`as any`/`@ts-ignore` **一处未用**（那是把「看不见」换成「假装看见了」，比原状更坏） |
| I4 | 防复发 | ✅ 新门 `typecheck-coverage:check`，判据落在 `tsc --listFilesOnly` 的程序全集上（**刻意不读 `include`/`exclude`** —— 读配置去推断正是本单栽的跟头）；反向金丝雀 + 三向变异反证 RC=0/1/2 全机验；已接 `pnpm gates` + 门账 + 本体 §7/§8 |
| I5 | 复验方式 | ✅ **金丝雀实测**：接线前往两包测试文件塞 `const __canary: number = "str"` ⇒ `typecheck` RC=**0**（漏网）；接线后同一探针 ⇒ RC=**2** + TS2322（抓住）。金丝雀用完已还原，`git status --porcelain` 为空 |

**这批错误的形态**（说明为什么「三周没人发现」不是偶然）：契约字段改名后 fixture 没跟上 ·
`ObjectInstance.origin` 这类**必填**字段 91 处缺失 · 测试本地断言类型漏声明生产真会发的字段
（`RiskCard.adoptedMitigation` / `GA.reconChecks` / `no` / `amp`）· `status: "RUNNING"` 这种
**枚举里根本不存在**的值 · `origin: "MANUAL" as ObjectInstance["origin"]`（用 `as` 把
「字符串塞进判别联合」整个盖住）。**没有一条是靠读代码能稳定发现的，全部要靠类型系统看见它们。**

**留给审核方的两条**（本单范围边界外，未擅动）：
① `apps/agentcore/src/mocks/clients.ts:240/376/706` —— `MockDataCore` 若干方法**比接口少写形参**
（`queryObjects` 漏 `asOfEpoch`、`listObjectTypeKeys`/`listPublishedRuleKeys` 漏 `ctx`）。
TS 允许少写形参实现接口，于是 mock 的**具体类型比契约窄**，测试按契约调就编译不过；
更要紧的是 **mock 因此对 R2 租户隔离与 §13.1 任务快照读是「收了参数不认」**。
本单在测试侧用「上转到它实现的那个接口」绕开（非 `as any`），**生产侧建议补齐形参**。
② `claude/handoff-wo-typecheck-testblind` 分支里的 `pipeline-config-seam.test.tsx`（55 行新测试）
属另一单（WO-R4 件二）产出，本单未收编，**别随分支删除一起丢了**。

---

## ⛔ 未派（我欠的）

1. **步骤模板层** —— B4 的前置
2. ~~**13 类需求卡片补齐** —— C10~~ ✅ **已闭**（见上 C10 行）。13 类全部上屏，跨系统 7 类如实标「查不到」不摆 0；两侧接缝测试各自钉死。**未派的其实只是这条记账没回写**，功能本身在 `6ddf76f6`/`2242f9bc`/`dac4b1d2` 就已落地 —— 队列与代码脱节了一轮
3. ~~**`STALE-8` 正则盲区**（实测漏 6 条：带点 slug 与非 `view.` 前缀）~~ ✅ **2026-08-16 WO-STALE-REGEX-BLIND 收单** —— ⚠️ **本条自己就是一条过时声明**：那两类盲区**早在 2026-08-15 的 `8244c82b`（WO-STALE-TEXT-SWEEP）就已修好**（变异反证 M1/M2 逐条复现：把 `FEATURE_KEY` 改窄回去，金丝雀当场点名抽不到 `view.graph.persp.all` / `qos.agent-fallback` / `view.project-sim.whatif`，RC=2）。真正还在的是**更深一层**：本门的扫描范围（`apps/frontend-shell/src` + `apps/*/src` + `packages/*/src`）**里没有 `scripts/` ⇒ 门看不见自己**，而它自己的文件头与《做不到的部分》写满「今天全仓 N 条 / 实测命中 N 行」这类自称现状的计数 —— 实测 **6 个数字已变假**（`@stale-fact` 生产记号「0 条」实为 **11** · 基线赌注「6 条」实为 **0** · CONFIRMED-STALE「两条」实为 **0** · 注释命中「147 行」实为 **63** · 字面量命中「14 行」实为 **13**），而门 RC=0 报绿。已新增第三层判据 **STALE-9/10（门自述层，无豁免段无棘轮）**：`@stale-self <口径名> <op><n>` 赌在门每次运行现算的 17 个口径上，现挂 9 条；⑩ 逐**句**判（同句无日期戳也无赌注即红）。六条过时自述**逐条改对、零条进基线**，基线五个水位一字未动（37/37 · 11/11）。**遗留另立单**：⑧ 的 `VIEW_TITLE_SLOTS` 仍要求 `key` 与 `name`/`title` **紧邻**，实测放宽后多抽到 29 个键并暴露 3 条真分叉（`aop-base` 亿/万 · `oee-trend` 14 日/7日 · `aop` 年度规划（旧）/年度规划）—— 修它必须动 `apps/**`，超出本单 🚦 边界
4. ~~**`sandboxConsoleModel.ts:709` 过时文案**（写着已被删除的 `worstMbal`）~~ ✅ **本条记账本身已过期（WO-STALE-TEXT-4 · 2026-08-16 实测）**：
   2026-08-15 提交 `75f0adfe` 已修，`REQUIREMENTS-TRACE` 漏改这一行。今天该文件里 `worstMbal` 只剩 **2 处**（`:713`/`:715`），
   两处都在那条 **2026-08-15 订正块**里，原文就写着「**符号已不存在** …… 已被 WO-DYNAMIC-DRILL-RESOLVE 整个删除」
   —— 属**合法历史记录**，不是过时文案（本仓要求的正是这种「说清错法与修法」的记账）。
   **机器复验（否定结论必附金丝雀）**：剥注释后扫 7 棵树 1319 个源文件，`worstMbal` 在**可执行代码里 0 处**，
   同一趟扫描里已知必中的 `resolveDynamicDrill` 命中 **4 处**（若它也是 0 就是工具坏了，不是代码干净）。
   ⚠️ **行号 `:709` 也已漂**（现 713/715）—— 印证「写死行号的引用天生带保质期」，本行改用符号串锚定。
5. ~~**agentcore 3 处 stale 文案**~~ ✅ **已修，但「3 处」这个数错得离谱：实测 40 处**（WO-STALE-TEXT-4 · 2026-08-16）。
   上一单只修了被点名的 `DemandSegment` 一行就收工 —— 形态即铁律 0.5：
   **「我用『被点名的那处修好了』当作『这张表干净了』的证据，而前者并不度量后者。」**
   本单把 `navigation-slice.ts` 的 `OBJECT_KEY_PROPS` **25 个类型 / 85 个属性名**逐个与 DataCore 本体真相源
   （`synthetic/battery.ts` + `battery-extended.ts` 的 `PropertyDef`/`DerivedPropertyDef` 声明）对账，
   **40 个（47%）在其声明的类型上根本不存在**，现已全部归位（实测 40 → 0）。四种错法**修法不同、不许合成一句**：
   **A 改名漏改 16 处**（`Metric.metricKey`→`key` · `Line.util`→`utilization` · `Process.yieldPct`→`yield` ·
   `Equipment.oee`→`oee_current` · `Customer.overdue`→`maxOverdueDays` …）；
   **B 抄错地方**（那名字是**别的类型/别的层**的字段，换新名没用、要换真属性）：`Base.capacityDaily`
   （`capacityDaily` 只长在 **Line** 上）· `Material.gapTon`（在 **MaterialBalance** 上）· `Segment.attainPct`
   （**全 datacore 零 propKey 声明**，那是达成率 Metric 的语义）· `CarbonFactor` 三个名字全不沾边；
   **C 把「求解器输出字段」当对象属性**：`Metric.gap` —— 本体上缺口是**两个派生属性**（`delta`/`gapPct`），
   一个假名把两个真派生属性一起盖住，而派生属性正是 `renderTypeBlock` 唯一会渲染公式的那类；
   **D 把「链路」当属性**：`RootCauseChain.caused_by` —— `caused_by` 是 CausalFactor→CausalFactor 的 **N:N LinkType**。
   同批修 `mocks/solver-registry.ts` 的 `Metric.gap`（→ `Metric.target−Metric.actual`）；剥注释后全 `agentcore/src`
   的 `Type.prop` 引用 **19 处、假名 0 处**（金丝雀：`DemandSegment.demandWanPerYearP50` 必中）。
   🔒 **机制（本单真正的交付）**：`apps/agentcore/test/keyprops-ontology-parity.seam.test.ts` ——
   四节：① 抽取器五条金丝雀自证（含「字符串里的 `∈[0, everyDays)` 把括号配平算歪」这条**本单真踩过**的回归）·
   ② 整张表逐名对账、报错时现算「这名字实际长在哪个类型上」以区分 A/B 两种错法 ·
   ③ 剥注释扫全 `agentcore/src` 的 `Type.prop` 面 · ④ **接缝**：真跑 `projectNavigationSlice → renderNavigationSlice`
   断言名字确实到达 prompt，并驱动 `renderOntologySemanticContext` 断言「真名渲得出口径、假名让整块塌成 null」。
   **修 40 处文案是一次性的，这个文件才是机制 —— 下次改名是机器先说话。**
1. ~~**步骤模板层** —— B4 的前置~~ ✅ **已交付并已接线**（见 B4 行；接缝实测 7/7 走通）。
   **改由 B4a 接棒**：同族的 `advance` / 实例详情两条仍无前端消费方，卡在导航信息架构（仓主决策）
2. **13 类需求卡片补齐** —— C10
3. **`STALE-8` 正则盲区**（实测漏 6 条：带点 slug 与非 `view.` 前缀）
4. **`sandboxConsoleModel.ts:709` 过时文案**（写着已被删除的 `worstMbal`）
5. **agentcore 3 处 stale 文案** —— `navigation-slice.ts` 把已不存在的 `p50` 当关键属性**喂给 LLM**（⚠️ 不报错，只是模型拿不到值）
6. **mock 与真后端 S&OP 量级差 4–12 倍**（改它=改值，只报不动）

## 🔶 等你裁决

1. **⚠️ 审批留痕里记着一个假的产能数**（`G-LEVER-SNAPSHOT-UNIT-LIE`）：张力峰值（0–100）被塞进 `snapshot.capWanP50`（万套/窗口），而该快照整个进 `plan_change` 的 **ActionDraft payload**。门守不了「塞进这个名字的值是不是那个量纲」，屏上不显示所以肉眼也看不见
2. **设备 OEE 口径分歧**（**两个 dev 独立发现**）：铭牌 `oeeA×oeeP×oeeQ` vs 时序聚合 `oee_current`，两套给出不同的「最差设备」
   —— ✅ **取证已完成（WO-OEE-SSOT · 2026-08-16）**，裁决材料见 **`docs/DECISION-oee-ssot.md`**（一页纸：三选项逐文件逐测试连坐面 + 推荐 + 第三条路）。
   **⚠️ 本条原文写「两套」——实测是三套**：铭牌 `oeeA×oeeP×oeeQ` / 时序 `oee_current` / **IoT 日事实表 `EquipmentOEE.oee`（5460 行·自带 a/p/q·已接物理拓扑屏）**。
   demo 真实入参（`seed=42, scale="S"`，780 台）算出**三台不同的最差设备**（`changzhou-formation-winding-E2` 0.769233 / `jinhua-slitting-winding-E1` 0.710781 / `xinyang-formation-coating-E1` 0.776429），
   两两「最差 10 台」名单重叠 **0/10 · 0/10 · 1/10**，`|时序−铭牌|` 逐台平均 **0.0814**。**不是精度差异，是指向不同的设备。**
   本体断点已登 **`G-OEE-DUAL-TRUTH`**（§8·🔴 未修）。**推荐选「③ 事实表为权威、①② 从它派生」**（论据见裁决材料 §4–5）。
   **不等裁决已落地的那一半**：新门 `oee-ssot:check`（`scripts/check-oee-ssot.mjs`）守「同屏 ≥2 套口径必须标明哪个数是哪一套」，
   `--selftest` 已起子进程实测 RC=0/1/2 四条路径；全仓现扫出唯一存量违规 `views/capacity/factorOntology.ts`（真缺陷·已按棘轮挂账）。
   **⚠️ 仓主只需裁一件事**：A 维持现状（②）/ B 铭牌为权威（①）/ C 事实表为权威（③）。裁完即可派后续 WO。
3. **删不删导航里的「决策推演」**（E2）
4. **两页合不合**（E5）
5. **后两个改名**（E6）
6. **视图名字不一致 —— 已全量取证 + 已建门，裁决清单见 `docs/AUDIT-name-consistency.md`**（WO-NAME-CONSISTENCY）
   - ⚠️ **原条目的前提被实测推翻**：`view.risk-board` 的**导航与页标题都是「产能推演」、一致**；「风险推演看板」只出现在管理台「功能开通配置」页。「导航点 A、进去看到 B」这一形态**真实存在，但发生在 `plan-generate`**（导航「方案生成」→ 页标题「规划建议」）。照原条目改会漏掉真正扎人的那一处。
   - **全量**：30 个视图逐个核对三处名字（功能名 / 视图标题 / 页内大标题），**分歧 5 处**，定性四类。
   - **门已上线**：`name-consistency:check`（`scripts/check-name-consistency.mjs`）—— 不替仓主拍板「叫哪个名字」，只守「**不一致的必须登记过**」：存量挂 `DECLARED` 等裁决，新增未登记分歧一律红。本体 §8 `G-NAME-DUAL-LABEL`。
   - **待裁决 4 条**（每条已给推荐 + 连坐面）：🔴 `plan-generate` 导航标题 →「规划建议」（改 2 处）· 🟠 `risk` 功能名 →「产能推演」（改 4 处）· 🟢 `dash` 不改 · 🟢 `process-stuck` 不改（要动就另开 WO 拆键）。
