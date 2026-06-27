# HANDOFF · UI 缺口施工清单（审核方真渲染逐屏比对核发 · 母版侧 + 竞品侧）

> **这份是什么**：审核方对 **系统 ↔ HTML 母版（10 屏业务板）** 和 **系统 ↔ 竞品参考产品（5 屏沙盘/建模族）** 做完**真渲染逐屏比对**后，把缺口整理成 dev 可直接照建的施工清单。证据与逐屏判定见 `docs/AUDIT-ui-master-comparison-verified.md`（每屏 master/竞品 vs 系统 双截图取证）。
>
> ⛔ **接这份先做增量0**：起真系统 + 真渲染母版（`docs/reference-prototype-decision-platform.html` 用 `setView(key)` 切视图）逐项实拍现状，确认"真缺口"再建（审核方反复踩坑：板块常比文档建得多）。
>
> 🔴 **红线**：① 接现有不新建并行（M2接 business-domains·M5接 EXT_SIG·M6接 data-health·M4接 risk 求解器）② 真推演 not 假推演（M4 mock→真数据，诚实标 dataMode）③ 平台术语（竞品侧禁写竞品产品名）④ `pnpm -r build` 真绿（tsc+vite）⑤ 完成=真浏览器实拍能用，非测试绿。

---

## §1 母版侧缺口（系统 ↔ HTML 母版 · 10 屏业务板）

| # | 优先 | 缺口 | 现状锚点 | 怎么建（接现成） | 真值判据（FDE oracle） |
|---|---|---|---|---|---|
| **M1** | **P0·易** | **页头 chrome 跨全部 10 屏缺**：母版每屏顶部有 全局统计条 `对象/关系/求解器/智能体/数据域` counts + 周期标题(如 2026-07) + 版本徽(V5评审中)；系统都无 | 各业务视图（`DashboardView`/`RiskBoardView`/`OrderChainView`/`PlanAuditView`…）顶部 | 加一个共享 `<BoardHeader>`：counts 接真后端（`ontology.listTypes`/links/`SOLVER_KEYS`/agents/`business-domains`），**非写死 R14**；周期/版本接当前 S&OP 版本 | 每屏顶部出统计条，5 个 count 与后端一致；切租户数变 |
| **M2** | **P0·易** | **14 数据域图例（左栏带计数）缺**：母版左栏常驻 14 域+物化对象计数；系统是标准 app 导航 | 业务板左栏 | 业务板内加 `<DomainLegend>` panel（**非替换 app nav**）：14 域 + 每域物化对象数，接 `GET /a/v1/business-domains` + `object-type-stats`（域均就绪现成） | dash/risk 等出 14 域+真计数图例，点域可筛 |
| **M3** | **P1** | **S&OP 整屏空壳**：母版满载 5步tab+5KPI+需求评审三线对照表；系统 `/v/sop-balance` "暂无数据·需新建版本" | `SopBalanceView` + demo seed | demo seed 种一个可显示 `SopVersion`(2026-07·五步法数据)，复用 G-3 CL.4 `bootstrap` 建版本路径 | demo 打开 /v/sop-balance **直接出三线对照表**（目标/滚动P50/滚动P90/上月实际/vs目标/规则），非空壳 |
| **M4** | **P1·后端深修** | **risk #10 mock 基地**（=补齐清单 §2D #10）：系统 risk 卡是 mock 基地（洛阳重复4×·charCode哈希），母版是 8 真实基地+经理名 | `solvers/risk.ts:28-38 mockTightness`·`RiskBoardView` | `risk_timeline` MOCK 因素补真数据源（真张力+真受影响订单关联）；基地集换 8 真实基地（江门/邯郸/常州/厦门/信阳/自贡/武汉/眉山）+经理名 | risk 卡=真基地+经理名+真数据，点红出**真受影响订单**，dataMode 真 LIVE |
| **M5** | **P1** | **外部信号 chip 面板缺**（audit/generate）：母版顶部 环境感知 chip strip（碳酸锂/铜箔/主机厂上险/客户舆情/欧盟电池法/汇率海运/区域电力/竞争动态 7-8 chip）；系统只在 per-item 折进敏感性 | `PlanAuditView`/`PlanGenerateView` 顶部 | 加 `<ExternalSignalStrip>`：接 `GET /a/v1/external-signals`（**EXT_SIG 一等对象已建**·signalKey/value/trend/impact），悬浮出详情 | plan-audit/generate 顶部出 7-8 外部信号 chip，接真 `ExternalSignal`（非写死） |
| **M6** | **P2** | **系统来源总览无单屏**：母版 map/model 右栏有 对象↔源系统+新鲜度；系统有 data-health/lineage 但非此单屏 | 新页 or 本体图谱右栏 | 加 `<SourceSystemOverview>`：每对象/求解器/Agent 的源系统 + 新鲜度状态，接 `data-health` + `lineage`（现成）；按源系统分组 | 一屏列每对象的源系统(ERP/MES/PLM…)+新鲜度(正常/延迟)，与 data-health 一致 |
| **M7** | **P0·查 bug** | **疑似利用率格式 bug**：驾驶舱 `平均利用率 0.78%`/`计划达成 0.91`，疑似比率未 ×100（母版同口径 86%/103%） | `DashboardView` KPI 渲染/单位 | 查 KPI 值是比率(0.78)还是百分(78)、单位串是否重复加 %；修显示口径 | 利用率显 **78%** 非 0.78%；达成显 91% 非 0.91 |
| **M8** | **P0·UX** | **本体建模 AI 建议路径裸 500（审核方亲跑坐实）**：建模模态主按钮"生成建议"调 LLM（`/modeling/suggest`），demo 无 LLM provider → **裸 500 + 无引导**；用户大概率先点醒目蓝色主按钮 → 以为"本体建模坏了"，实则应点次要灰色的"确定性建模（全字段）"（`/modeling/derive`·无 LLM·真能用）。**注：确定性路径审核方已端到端真跑（derive→改名→归域→发布 ok:true→物化 12 对象），本身能用；问题纯在 AI 路径的错误处理 + 按钮默认态。** | `ModelingPage` SuggestModal | ① catch LLM-未配置 → 标"需配置 LLM provider，或用确定性建模"，不裸 500 ② 或无 LLM 环境把"确定性建模（全字段）"设为默认/主按钮 | demo 点"生成建议"出清晰提示而非裸 500/控制台错；或确定性建模为默认、一键可完成建模 |

## §2 竞品侧缺口（系统 ↔ 竞品参考产品 · 沙盘/建模族 5 屏 · 已登记 ③类 TO-DO）

> **背景**：当前系统沙盘/建模族 5 屏已**全部匹配竞品**（轨P/Q/L/A 交付·审核方复验闭合）。以下是 vs 竞品**仍缺**项，均**后端整块未建**，登记在 `SPEC-replica-design-system.md §10.1` ③类 TO-DO，前端现为诚实 RESERVED——**不硬造壳**。

| # | 缺口 | 竞品参照 | 怎么建 | 真值判据 |
|---|---|---|---|---|
| **C1** | **图查询能力**（几乎整块）：查询构建器 + **查询代码生成（平台自有查询语言·非竞品名）** + 结果表（高风险筛选/连锁排查）+ `Query→Skill 绑定` + `Query→MCP 暴露` | 竞品 image4③/image1 | **接现有 B3 MCP / B4 Skill**（融合非新建）；端点同义 `query_save_code/bind_skill/update_exposure`；单列一页（design-system §9） | 建模/沙盘 图查询 tab 真出构建器+codegen+绑定（非 RESERVED 壳） |
| **C2** | **逐对象业务动作编辑** + RL4：`断供/恢复供货/产能调整(adjustCapacity)/订单延期(delayOrder)/prioritize/cancelOrder` 等运行态可调用业务动作 | 竞品 image4②/image5 | 动作列表+参数表单；**接现有 Action/RL4 走正门**（采纳才写真值），运行态由 AI 指挥台/手动触发 | 对象浏览器/沙盘 出业务动作，调用→Action 草稿(R4)，非直写 |
| **C3** | **GEO_WITHIN 类型化约束**：`+ GEO_WITHIN 约束`（约束类型枚举:地理围栏…）+ `+ 声明目标` | 竞品 image8 | 约束类型体系（枚举化约束）+ 声明目标入口；接现有规则/约束层 | 建模工作台可加类型化约束(GEO_WITHIN 等) |
| **C4** | **完整 demo 世界**：世界完整度仍 35%（状态变量 0/11·派生规则 0/11；轨A P0 只种 4 状态变量+3 传导规则） | 竞品 image1（满世界可推演） | 扩 demo sim seed：补齐状态变量(11)+派生规则(11)，使世界完整度→高 | demo 沙盘 世界完整度 ≫35%（状态变量/派生规则种齐），可真推演 |

---

## §3 归属与验收

- 证据底本：`docs/AUDIT-ui-master-comparison-verified.md`（10+5 屏逐屏双截图）。
- M4(#10) 与 `docs/HANDOFF-three-boards-remaining-gaps-verified.md §2D` 同条，别重复建。
- C1-C4 与 `SPEC-replica-design-system.md §10.1` ③类 TO-DO 同源。
- 母版真渲染：`docs/reference-prototype-decision-platform.html`（`setView('dash'/'risk'/'order'/'audit'/'generate'/'sop'/'aop'/'quarter')`）。竞品原图：`docs/assets/sandbox-ui-audit/compare-{1-5}.png` 左栏。
- **审核方将真系统起服务 + 真浏览器逐项复审**：① 每项对母版/竞品实拍 ② counts/数据**溯真后端**非写死 ③ MOCK 不冒充真 ④ `pnpm -r build` 真绿。
