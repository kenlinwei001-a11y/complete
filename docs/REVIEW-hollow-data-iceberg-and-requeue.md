# 审核方 · 空洞数据冰山 + 全量未闭项重新入队

> **缘起**：用户 "**1. 还有哪些类似问题？都找出来，重新入队**"。触发点是预判推演看板「洛阳·物料齐套 D+13 红色预警，点开却『暂无数据』——没有数据如何推演出红色？」（U2/#10）。审核方据此把全平台同类问题（哈希/魔数冒充真算 + 点击死路）一次扫到底，并归并 2 路独立 hollow-data 审计 + 审核方亲手读源/真跑复核。
>
> **证据标注（每行显式）**：`📖读源`=审核方本轮亲手读源码逐行坐实（非 grep 推断·非 agent 转述）；`✅真跑`=审核方起真系统双路（curl/真浏览器）取证；`◐agent`=审计 agent 报告、审核方择要复核；`🔎grep`=仅静态锚点（可能漏报已修）。
>
> **红线**：禁 mock 冒充真算 / 禁 skip-by-default / 解析失败诚实报不静默 / 只推 `claude/vigilant-knuth-b1nmxn` / 密钥仅 env 不入 git（R5）。

---

## §0 一句话结论

用户的旗舰投诉（洛阳红色点开空）**不是孤例，是一座冰山**：平台多处把「**哈希/魔数派生值**」当作「求解器真算」静默喂进与真值无差别的 UI。根因是**结构性**的——`packages/contracts/src/solvers.ts` 只有 3 个求解器带 `dataMode` 诚实位，其余求解器（含 audit_timeline + 13 个 extended）**无输出契约、无诚实位**，于是哈希曲线能冒充真算。

但**好消息（agent 扫查纠偏）**：用户先前点名的几处（风险看板/订单全链/传导时序/项目仿真）**已被 dev 加上诚实徽章或改接真值**，不应重新入队。真正残留的是：**1 个可证伪的 HIGH（份额数字与自己的闸门自相矛盾）** + 一批后端求解器静默哈希/魔数 + 用户旗舰投诉的「死路」本身。

---

## §A 空洞数据冰山（hollow-data）

### A0 · 结构性根因（📖读源坐实）

`packages/contracts/src/solvers.ts` 的 `dataMode` 诚实位覆盖（审核方逐行读）：

| 求解器 | 输出契约 | `dataMode` 诚实位 | 现状 |
|---|---|---|---|
| `capacity_forecast` | `CapacityForecastOutputSchema:22` | ✅ 有(`:27` optional) | 已带徽章 |
| `bottleneck_matrix` | `BottleneckMatrixOutputSchema:62` | ✅ 有(`:63` 必填) | 已带徽章 |
| `risk_timeline` | `RiskTimelineOutputSchema:115` | ✅ 有(`:119` LIVE/MOCK/PARTIAL) | 已带徽章（但底层值仍 mock·见 A-旗舰） |
| `audit_timeline` | `PlanAuditOutputSchema:157` | ❌ **无** | **静默哈希**（A1） |
| `plan_generate` | `PlanGenerateOutputSchema:209` | ❌ **无** | 见 §B-HIGH（前端 -17 错算） |
| 13×`extended.*` | **无 zod 输出契约** | ❌ **无** | **静默魔数/硬编码**（A2–A4） |

> **这就是冰山的根**：契约层不强制诚实位 → 求解器可静默返回哈希/魔数 → UI 无从区分真假 → 全部渲染成权威结论。修复方向是**结构性**的：把 `risk_timeline`/`capacity_forecast` 已有的 `dataMode` 范式推广到 `audit_timeline` + extended 全族（契约加字段 → 求解器据数据来源置 LIVE/MOCK/PARTIAL → UI 据此标）。

### A-旗舰 · risk_timeline 底层值仍哈希 + 洛阳点击死路（用户原始投诉·**未闭**）

- `📖读源` `apps/datacore/src/solvers/risk.ts:28` `mockTightness()` = `charCodeAt` 哈希；`:64` `return { value: mockTightness(...), live: false }`；洛阳·物料齐套实测 `dataMode:"MOCK", live:false, crossDay:14`。
- `📖读源` 死路：`RiskBoardView.tsx:140` 点红 → `AffectedOrdersModal`(`:462`) → `searchObjects("Order","",{ base:"洛阳", day })`(`:465`)。**「洛阳」是 risk.ts 注入的 mock 标签、不是真 Order 字段**，`day` 也不是 Order 过滤维度 → 命中 0 → `:491` 裸渲染 `zh.common.none`「暂无数据」。
- **= 用户原话的精确答案**：红色来自 `kind 名哈希`、不来自真订单，所以点进去当然没有订单。
- **现状**：顶层**已**有「估算·无实测（mock 基线 N）」黄标（轨M·`RiskBoardView:79-90`·agent 复核确认已诚实标）——但①数值本身仍是哈希②点击仍落到裸「暂无数据」死路。**徽章只诚实标注，没解决「点进去是死路」**。
- **修向**：给 mock 因素补真数据源 **或** 至少让点击落到「该红基于什么（mock 基线 N·无真订单）」的诚实解释面板，**禁裸「暂无数据」**。
- **FDE 真值判据**：洛阳 D+13 红 → 点开 → 要么真受影响订单非空，要么明确诚实文案「此为 mock 基线、无真订单关联」；**绝不再出裸『暂无数据』死路**。

### A1 · audit_timeline 整条曲线 = kind 名哈希（📖读源·静默无徽章）

- `risk.ts:392-424`：`h=hashString(kind)` → `peakDay=16+(h%40)`(`:397`)、`peakVal=clamp(threshold+2+h%12)`(`:398`)、`base=48+h%10`(`:399`)、`series=分段线性+hashString(\`${kind}:${d}\`)%7-3 抖动`(`:401-404`)、`crossDay`(`:420`)。整条 90 天传导度曲线 + 越线日**全由 kind 字符串哈希派生**，**无 dataMode**。
- UI 落点：audit/generate 视图每审计项独立时序（**与产能推演共用逐日组件** → 用户无法区分真假）。
- 注（诚实）：`:418` `affectedOrders()` 接的是真引擎 → 波及订单 real-ish，但**曲线/峰值/越线日是哈希**。混合，未标。
- **比风险看板更糟**：风险看板至少有 MOCK 徽章，audit_timeline 一点诚实位都没有。
- **FDE 判据**：audit 时序卡带 `dataMode` 徽章；曲线若派生自 kind 哈希则显式标「确定性派生·无实测」；点节点不死路。

### A2 · yield_diagnosis 良率台阶硬编码（📖读源·extended.ts:477）

- `extended.ts:475-478`：`series = Array.from({length:40}, (_,d) => ({ day:d+1, yield: d<33 ? 0.95 : 0.85 }))` + 事件 `{day:33, kind:"换批", source:"MES"}` **全写死**（仅 `if(has("series"))` 给了真值入口，但默认租户走兜底）。无 dataMode。
- **FDE 判据**：良率序列来自真 MES/工序派生，或显式标「示例·未接实测」。

### A3 · credit_exposure / quote_margin 财务魔数兜底（📖读源·extended.ts:457/463）

- `:463` `creditLimit: num(cust.creditLimit, 5000)`；`:457` `price: num(args.price, 500)`、`mfgRate:0.1`、`logistics:8`、`segmentFloor:0.12`。**`num(x, 魔数)` 兜底模式**：有真数据用真、缺则魔数，**但无诚实位告诉 UI 用了哪个**。
- **FDE 判据**：财务结论（信用敞口/报价毛利）落兜底魔数时，输出带 `partial:true`/`dataMode:PARTIAL`，UI 标「部分估算」。

### A4 · maintenance_stagger 负荷曲线纯写死（📖读源·extended.ts:472）

- `:472` `loadByWeek:{ "6":20,"7":5,"10":80,"11":8,"12":12 }` + `:473` `peakWeeks:[10,11,12]` **恒写死**（无真数据路径）。无 dataMode。
- **FDE 判据**：检修错峰负荷来自真产能/排程派生，或显式标示例。

> **A1–A4 统一修向**：求解器 arg-enrichment 层（`extended.ts` enrich + `risk.ts` 哈希派生）一旦走兜底/哈希，就在求解器输出置 `dataMode:MOCK|PARTIAL`；契约（`solvers.ts`）补字段；UI 据此标——**完全复用 `risk_timeline`/`capacity_forecast` 已落地的范式，有现成代码可抄**。

---

## §B 前端展示层 hollow-data（◐agent 扫查 + 审核方复核）

### B-HIGH · 方案「份额 +Npct」与自己的 ✓/✗ 闸门自相矛盾（📖读源·**已逐行证伪·真 HIGH**）

- `📖读源` 前端 `PlanGenerateView.tsx:240`：`meetShare = \`+${(o.share - 17).toFixed(0)}pct\``（基线魔数 **17**），渲染于 `:301`，**紧挨着 `:303` 的 ✓/✗**（`ok = s.meets[k]`，来自求解器）。
- `📖读源` 求解器真相：`battery.ts:297` `base.share=18`；`plan.ts:285` `outcome.share=base.share+eff.share`；`plan.ts:297` 闸门 `meetShare = (outcome.share - base.share) ≥ sharePts` = **`(outcome.share - 18) ≥ sharePts`**。
- **可证伪矛盾**：方案 C（扩产型）`eff.share=22` → `outcome.share=40` → **求解器闸门按 `40-18=22pct` 判**，但**前端显示 `40-17=23pct`**。**用户看到「+23pct」、闸门实际用「22pct」做 ✓/✗** —— 假数 + 自相矛盾，且裹在 `<Provenance src="plan_generate 求解器">` 权威外衣里。
- **修向**：求解器在 `outcome` 直接下发 `shareDelta`（`outcome.share - base.share`，它内部已算），前端渲染该字段，**删掉 `-17`/`-100` 魔数**。
- **FDE 判据**：方案 C 显示的「份额 +Npct」**逐位等于**求解器闸门所用值；改 `base.share` 后前端跟随、不再写死。

### B-MED · 其余前端魔数兜底（◐agent·审核方采信）

| 项 | file:line | 类型 | 判据 |
|---|---|---|---|
| 方案「收入增 N%」 | `PlanGenerateView.tsx:238/275` | 魔数 `100` 烤进 Provenance formula 文案；`base.rev=100` 时巧合对、≠100 即静默错 | 求解器下发增长率字段、前端渲染（它 `plan.ts:295` 已算） |
| S&OP ② 需求三线表 | `SopBalanceView.tsx:26-30` `DEFAULT_SEGMENTS`→`:441` 可编辑表 | 静默填入（仅代码注释 `// debattery-allow`、**无用户可见示例徽章**）；`sopConfig` 在 workspace 契约/datacore **从未被填** → 默认租户**恒走兜底**（非偶发） | 旁边 P90 列已读真 `DemandSegment.p90`；target/rolling/lastActual 应同源、或标「未配置/示例」 |
| S&OP 需求 P50 卡 | `SopBalanceView.tsx:288`(`?? demTotal`)·`:68` `demTotal:132` | ② 未跑前把硬编码 132 当「需求 P50」渲染 | ② 跑前显「—」、或种子自基线计划版 |
| S&OP ④ 财务默认 | `SopBalanceView.tsx:615` `{revSum:248,gmSum:39.7,gmBudget:16.4,cashCushion:58}` | 无 debattery-allow 标记；用户不编辑即点运行 → 喂 C15/C18 毛利/现金 verdict | 预填自当前计划版财务、或留空；值须源自 `v.inputs` 非字面量 |
| 驾驶舱毛利率兜底 | `DashboardView.tsx:199` `?? {price:0.6,margin:13}` | **主路 `marginLedger` 已真算·OK**；仅 legacy 兜底分支无估算徽章 | 兜底分支加「估算」徽章、或后端恒供 |

### B-已修·勿重新入队（◐agent 复查纠偏·审核方 §D 二次坐实）

- `RiskBoardView.tsx:79-90` — 已渲染「估算·无实测（mock 基线 N）」徽章消费 `card.dataMode`。
- `OrderChainView.tsx:253-255` — 已渲染「估算·22%」上标 + `econNote`「无实测库存」；hashN 假精度已删（毛利/价改 `SEG_REGISTRY` 单一来源）。
- `PropagationTimeline.tsx:62-67/102` — 已用真 `revenueWan` 并标「真算/估算」，`*0.6` 仅无真营收时回落。
- `ProjectSimView` bottleneck/capacity — 请 `dataMode:"LIVE"`，⑤紧张度逐基地标「实测/估算」，色阶是真 solver 值的展示分级。

### B-LOW·诚实披露的 sim 种子（非缺陷·列此免误判）

- `SandboxView.tsx:39-63`/`SimInitWizard.tsx:28-51` `hash01(charCodeAt)` 播 tick-0 世界态——标题明示「确定性派生·无业务常数」，tick 后真 `simTick` 引擎覆盖，采纳标 `simulated:true`。**披露的 sim 种子，非冒充实测**。
- `InferenceProcessPanel` 恒传 `solved=true` → 编排 DAG 恒全绿——渲染节点状态色非业务数字。结构性 LOW。
- `forceLayout.ts:120` `Math.random` — 图节点布局抖动、非数据。

> **agent 交叉事实（重要诚实位）**：前端默认运行路径**零** import `mocks/fixtures` / `simSolvers` / `handlers`（仅 MSW/测试）；**无 `Math.random`/`hashN` 喂业务 KPI**，除已披露的 Sandbox 种子。⇒ 前端层「冒充」风险其实集中在 **B-HIGH 一处** + SopBalance 兜底簇；冰山主体在**后端求解器（§A）**。

---

## §C 已登记·未做（用户点名要求·非遗漏·正确诚实延期）

| 项 | 登记 | 状态 | 入队建议 |
|---|---|---|---|
| 轨O 主题/配色开关（U8 浅色↔黑曜石） | `HANDOFF-theme-switch-…md` | 🔎grep 称功能未建（无 `[data-theme=light]`/toggle/localStorage）——**审核方未真浏览器复核**，按纪律 grep 可能漏报 | P3·**先真浏览器核「真缺到哪步」再交 dev**，避免照纸面盲建 |
| 业务动作 + RL4 | `design-system §10.1` | 📋 RESERVED·后端未建·前端诚实不画假壳 | 路线图·不强插 |
| 图查询低代码 / 平台查询语言 / Query→Skill 绑定（U12） | `design-system §10.1` + PlatformConsole tab | 📋 RESERVED·前端显式标「后端整块未建」·后端未建 | 路线图·不强插 |
| 分层目标（GEO_WITHIN 约束等） | `design-system §10.1` | 📋 RESERVED·后端未建 | 路线图·不强插 |

---

## §D 文档纠偏（审核方📖读源坐实·防 dev 照过期纸面盲建/重做）

- **D1 · 轨N 可信溯源「0 提交」是过期误报**。`COVERAGE-user-requirements-vs-tracking.md` 称「轨N 0 提交·`OrderChainView:464-466` 裸文本仍在」——**已过期**：`RuleRef.tsx`（带 `definedBy/definedAt/effectiveFrom/effectiveTo/basis` 全字段·`:55-61`）+ `Provenance`/`ProvenanceDag` **已建并接入** Dashboard/Ledger/SopBalance/PlanGenerate/ProjectSim/PlanAudit/OrderChainView（含「轨N 增量1·N-R1/R2/R3·跟进2」commit 标记）；`OrderChainView.tsx:486/495/504` 的 `ruleRefs.join("/")` **已包进 `<RuleRef>`**（悬浮溯源·非裸文本）；`:141` 下钻面包屑+返回已加。
  → **纠正后状态：◐ 大部接全**（组件全建 + 多视图已接 + 裸文本已换 + 下钻回退已加），**待审核方真浏览器复验**①下钻回退真不死路②Rule provenance 字段后端真返回非空。**不是 ✅ auto-闭**（守「绿测试≠能用」），但**绝不是「0 提交」**。
- **D2 · DEV-TODO「1C/A6-T2 待开工」已过期**。`1C` commit `3e82e91`（真 Kimi 抽取 `candidateCount=4`·修前 0）；`A6-T2` commit `be4eeb0` + `apps/datacore/test/a6-e2e-socket.test.ts` 文件已存在（真 socket e2e 回归）。→ 改「待审核方复验闭合」。
- **D3 · WO-Q1 增量3「待补」已闭**。真 Kimi 真浏览器实拍：逐字流 `task-streaming` ✓ · 思考中折叠 `task-reasoning`（Kimi `reasoning_content`）✓ · `answer.final` → 切 AnswerCard ✓ · §3③ 非死答（标「探索推理·未结构化收尾」兜底真分析）✓。→ **闭合**。

---

## §E 平台大盘（区分·**非**用户本会话点名·按路线图节奏·不盲建）

`START-HERE §2` 列 17 条已就绪轨（VLE/优化融合/规则一等/场景发育/管理面/QOS 全量/数据流闭环…）、`COMPLETION-LEDGER` ~679 待真跑点——**这些是更大路线图、不是用户本次「类似问题」的范围**。本次只把「**用户旗舰投诉的同类（hollow-data 冰山 + 死路）**」+「**用户点名未做（§C）**」入队。**别拿 680 点盲建**（违 START-HERE §3 警告）。用户若要逐轨核大盘，另开。

---

## §F 优先级总表（重新入队·给开发 agent）

| P | 工单 | 一句话 | FDE 判据 | 证据 |
|---|---|---|---|---|
| **P1** | **B-HIGH** 方案份额 -17 错算 | 显示值与求解器自己的 ✓/✗ 闸门差 1pct·自相矛盾 | 显示「+Npct」逐位=闸门所用值·删 -17/-100 魔数 | 📖读源·已证伪 |
| **P1** | **A0** 契约层 dataMode 推广 | `audit_timeline`+extended 全族补 `dataMode` 诚实位（抄 risk_timeline 范式） | 静默求解器输出带 LIVE/MOCK/PARTIAL·UI 标 | 📖读源 |
| **P1** | **A-旗舰** 洛阳红色死路 | 点红→裸「暂无数据」死路（红=哈希非订单） | 点开非空 OR 诚实「mock 基线·无真订单」面板·禁裸空 | 📖读源 |
| **P2** | **A1** audit_timeline 哈希曲线 | 整条曲线 kind 名哈希·无徽章 | 卡带 dataMode·派生标「确定性·无实测」 | 📖读源 |
| **P2** | **A2-A4** extended 魔数 | yield/credit/loadByWeek 硬编码·兜底无诚实位 | 兜底置 PARTIAL·UI 标部分估算 | 📖读源 |
| **P2** | **B-MED** SopBalance 兜底簇 | `sopConfig` 永不填→默认租户恒走魔数兜底喂 verdict | 兜底带示例徽章或源自真计划版 | ◐agent |
| **P3** | **C 轨O** 主题开关 | U8·grep 称未建 | **先真浏览器核真缺到哪步**再交 dev | 🔎grep·待真跑 |
| **P3** | **D** 文档纠偏 | 轨N/1C/A6-T2/WO-Q1增量3 状态过期 | 审核方自改（本轮已改 DEV-TODO + COVERAGE） | 📖读源 |

> **P0 = 无**：A-旗舰虽是用户旗舰投诉，但顶层已有诚实徽章（不会让用户误信假值），死路是体验缺陷非数据欺骗，故 P1 非 P0。B-HIGH 是 P1 中最该先修——它是唯一「假数 + 自相矛盾」、且无任何诚实位。

---

## §G 审核方诚实交代（为何此前漏报「洛阳同类」）

- **根因**：四链路走查 Flow 2 我在 `/v/risk` **看到了「mock 基线」黄标**，却只验「渲染对、徽章在」就过，**没 drill 到底层值真伪、没点进死路**。我把「**有诚实徽章**」误当成「**问题已解决**」——而徽章只诚实标注、底层值仍是哈希、点击仍是死路。这正是 fde-delivery 红线「绿测试≠能用」的翻版：把「有诚实位」当成「能用」。
- **纠正承诺（已生效）**：①每份报告带「**已登记·未做**」段（本文 §C/§D）；②audit 数据真伪不止「是否渲染/有无徽章」，按「**是否有真数据源**」判闭；③hollow-data 顺链路 drill 到**点击落点**（死路也是缺陷）。
- **本轮兑现**：A-旗舰死路、A1-A4 后端哈希/魔数、B-HIGH 自相矛盾——均**📖读源逐行坐实**（非 grep、非 agent 转述）；agent 扫查的「已修勿重入队」清单（B-已修）我二次复核采信，**避免给 dev 派已完成的活**。

---

*审核方独立复验 · 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
