# HANDOFF · 三板块 HTML 母版欠账补齐（审核方真浏览器实拍核发 · 取代 stale 粗清单）

> **这份是什么**：审核方（评审方）**真系统起服务、逐板块真浏览器走查**（经营驾驶舱 / 规划决策推演 / 项目决策推演 · 5 视图实拍）后核发的**当前唯一可信欠账清单**。
>
> **为什么取代 `AUDIT-three-boards-vs-design-master-alignment.md` / 轨M HANDOFF 的粗清单**：那两份**已严重 stale**——把**已经建好的功能列成缺口**（实拍证明 #5 X01-X05、#6 三案五维雷达取舍矩阵 都已满载）。照它盲建 = 重建已能用的东西（违 `COMPLETION-LEDGER §3` 警告）。
>
> ⛔ **铁律（本份也可能再 stale·板块一直在动）**：**dev 接这份先做增量0——逐项真浏览器实拍现状，确认"真缺口"，再建。别照本清单的判断盲建。** 审核方反复踩坑：每次摸真代码/真跑，板块都比文档建得多。
>
> 🔴 **红线（破一条即打回）**：① **接现有不新建并行**（接/扩/换，禁另起平行数据层/组件）② **真推演 not 假推演**（mock/哈希/写死不得冒充真算；无真数据→诚实标"估算/无数据"，见 `AUDIT-fake-simulation-inventory.md`）③ **显示即可溯源**（裸数字/规则号接 RuleRef/Provenance）④ **平台术语**（无外部产品名）⑤ **完成=真浏览器实拍能用，非测试绿/typecheck绿**（轨Q 刚因 vitest 绿但 tsc 断被打回）。

---

## §1 ⛔ 已建·禁碰（审核方实拍坐实 · 重建即返工）

**这些母版功能已经建好且能用——dev 别动、别"补齐"、别重写：**

| 已建项 | 实拍证据（审核方真浏览器） |
|---|---|
| **#5 规划体检 X01-X05 命名校验 + 一键 fix** | plan-audit 满载：体检 65/100·5 软风险逐条带规则芯片 [C15/C06/C16/C21/C24/C13] + 命名 ID [X03/X04/R01/E01/E03] + **一键应用** + 采纳为草稿（HITL 走 S&OP/Action 审批 C10/C22） |
| **#6 规划建议 3 案 + 五维雷达 + 取舍矩阵** | plan-generate 满载：3 案（稳健 72/均衡 75★/进取）+ 五维评分雷达 + 取舍矩阵（得/舍）+ 目标达成清单逐项对标 + 外部信号敏感性 + 风险传播链 C08 |
| **2a 综合毛利率勾稽闭合** | 驾驶舱台账"综合毛利率勾稽 16.13% vs 目标 16.0%·缺口 +0.13pp·**已闭合 ✓**" |
| **2b 板块级 AI 对话栏** | 驾驶舱"AI 问驾驶舱"+ 预设问 → QOS |
| **3a/3b 反事实排除层** | 驾驶舱根因归因 DAG"**已排除 物流时效/安全库存·反事实:反算达标**" |
| **假推演诚实化（轨M 红线）** | risk-board mock 卡黄底标"**估算·无实测(mock 基线 N)**"——没把红当真 |
| **型号产能 6 步 / 风险卡网格 / 处置方案 / 年季态势** | project-sim 六步 DAG 点亮·risk-board 8 卡 + 行动计划表·年/季真算 |

---

## §2 待补项（实拍欠账 · 标确信度 · 增量0 必先逐项实拍）

> 每项标审核方**确信度**（高=实拍确认缺；中=半建需精修；存疑=锚点显示可能已大部建·增量0 必先实拍）。

### A · 高确信缺（实拍确认）

| # | 板块 | 母版 ref（HTML 行·数据值） | 现系统锚点 | 真缺 | 真值判据（FDE oracle） |
|---|---|---|---|---|---|
| **#1** | 经营驾驶舱 | 待解决问题 8 根源（line 4097 ROOT_LIB：crm/push/frame/credit/lta/ramp/maint/cost） | `DashboardView.tsx` ProblemPanel(`:141`) → `affected_orders`；根因链种子 `synthetic/battery.ts:1520+`（rc-profit-mix/scale-demand/material-gap…）；实拍问题面板**仅 3 卡**(DELIVERY/CREDIT/MARGIN) | **补根因链种子到 8 类**（扩 battery.ts rootCause chains，**别动求解器**） | demo 驾驶舱问题面板出 **8 类**根源-问题卡，各可下钻 |
| **#7 ✅已闭(2fb1d46)** | 项目决策推演 | C-1 订单驱动：逐单 **交期判(C02/C03)·齐套判(C06/C16)·财务判(C13/C15/C18) → 4 态 verdict(可接/提价接/不接)+对冲条件**（line 3429） | `ProjectSimView.tsx` OrderVerdictPanel（additive·型号六步零改·守§1） | **✅已建·审核方复验闭合(2026-06-27)**：接现成 `order_fullchain`·选 SO-3391 → 裁决「不建议接」/①交期判 可达 P50 2100·P90 1890[C02/03]/②齐套判 缺料 三元正极654吨·2026-06-28[C06/16]/③财务判 信用阻断 占用1.15[C15/13/18]/对冲2/**7 RuleRef 芯片**——**全=后端 order_fullchain oracle**（curl+真浏览器双路）·型号六步 additive 未破坏·`pnpm -r build` 亲验绿 | ~~选一单 → 三表+verdict+对冲~~ ✅达成 |

### B · 半建·需精修（中确信）

| # | 板块 | 差距 | 现系统锚点 | 真值判据 |
|---|---|---|---|---|
| **#2** | 驾驶舱 KPI 八卡溯源富度 | ⓘ 溯源徽已在（20 个 `widget-prov-*`）但**只显推导/输出路径/快照**，缺母版的**来源系统·新鲜度·规则号 C01-25·公式串**逐卡挂载 | `DashboardView.tsx:376` `widget-prov-{key}` + `Provenance.tsx` 六要素组件 | 逐卡悬停出**来源系统/新鲜度/推导公式/输入因子/规则号/备注**六要素，与母版同口径（接 RuleRef，**别造假规则号**） |
| **#3** | 驾驶舱 问题级归因 DAG event 层 | 有 result→KSF→factor(贡献breakdown)→**反事实排除层**(已建✅)，但**未见 event 层(驱动事件，如 CRM 合同变更 06-05)+ 受影响订单聚合可点跳** | `ProvenanceDag`(`:10`) + `plan_rootcause`(`:218`) | 点问题卡出 5 层 DAG，event 层有真驱动事件 + 受影响订单可点跳（接真事件，**禁现编**） |
| **#4** | 规划侧 项目级聚合勾稽表 | 驾驶舱有毛利勾稽闭合(已建✅)，但**规划侧(plan-audit/generate)未见等价"项目级聚合勾稽表(Σ负+正贡献闭合)"** | plan-audit 根因侧（KSF 图已在）；同源驾驶舱 marginLedger | 规划根因 DAG 下出聚合表，负+正贡献**勾稽闭合**（与驾驶舱毛利勾稽同源，**别另起并行求解器**） |

### C · 存疑·锚点显示可能已大部建（**增量0 必先实拍**·别想当然判缺）

| # | 锚点新发现（审核方核实） | 处置 |
|---|---|---|
| **#8** PropagationTimeline 组件挂载 | **已不是孤儿**——现被 `PlanAuditView.tsx` + `PlanGenerateView.tsx` import；系数已去写死(轨M 增量1d 真算)。**可能已大部建** | dev 增量0 真浏览器实拍 plan-audit/generate 的传播时序是否真渲染+财务击穿真算 → 确认真缺(是否需补 risk 页挂载/逐日曲线)再建 |
| **#9** 同源本体底座·决策应用域 5 一等对象 | **后端已有部分**——`solvers/service.ts:76,729` 有"KSF 5 一等对象投影(问题→KSF→财务)"、`synthetic/service.ts:467` 有"决策应用域归域"。**比 AUDIT 说的'各板块各自算'建得多** | dev 增量0 摸真代码盘点 5 一等对象(经营KPI/待解决问题/KSF/经营方案/问题传播时序)后端到哪步 → 真缺口可能只剩前端统一引用/小部分；**牵动大·确认后可拆独立 HANDOFF** |

---

## §3 归属 HANDOFF（dev 配合读的合同）

- 主合同：`docs/HANDOFF-three-boards-html-alignment-build-and-review-contract.md`（轨M·§1.A/B/C + 增量2/3/4）——**但其增量2/3 的 DoD 多已被实拍达成，以本份 §1 禁碰 + §2 待补为准**。
- 逐元素母版规格（含 HTML 行 + file:line + 母版数据值）：`docs/AUDIT-three-boards-vs-design-master-alignment.md`——**查元素细节用，状态以本份为准（它把已建的列成了缺口）**。
- 真推演红线：`docs/AUDIT-fake-simulation-inventory.md`。
- #2 溯源富度配合：`docs/HANDOFF-trust-traceability-build-and-review-contract.md` + `docs/SPEC-trust-traceability-interaction.md`（轨N）。
- #1/#3 驾驶舱数据层交叠：`docs/PASS2-wave2-finishing-tasks.md §2`（轨I）。

## §4 验收（审核方怎么验 · 不认口头/不认测试绿）

审核方将**真系统起服务 + 真浏览器逐项复审**（像验 轨A/L/P/Q 那样）：① 每项对母版实拍；② MOCK/估算**不得冒充真**；③ 数字**溯真后端**（curl 求解器 oracle 比对）；④ **`pnpm -r build` 必须真绿**（tsc + vite·不是只跑 vitest——轨Q 刚因这条被打回）。**再发现一处假推演冒充真 / typecheck 断 / 重建已建项 = 打回。**
