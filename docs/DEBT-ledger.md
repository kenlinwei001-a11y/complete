# 欠条清单 · 用户明确提过但未做/半通的需求（DEBT ledger）

> 立此清单的背景（2026-06）：用户明确提的"数据接入控制台分类"需求曾记在 TODO §4 却长期 ⬜、
> 险些被无限期搁置。教训：**记进 TODO ≠ 会被做**；扁平 ⬜ 无强制力。本清单是"欠条"——每轮交付
> 必须回看、更新、并主动报"还欠什么"，把强制执行内建进循环，而非靠用户每次盯。
>
> 状态：✅ 已亲手验过 · ◐ 半通 · ⬜ 未做 · 🔒 阻塞在用户（我做不了）
> 验收纪律：`fde-delivery` skill —— 亲手用一遍能用才算 ✅。

## A. 未做 / 半通（我能做，欠着）

| # | 需求（用户明确提过） | 状态 | 实情 |
|---|---|---|---|
| A1 | **封装引擎暴露为 MCP 工具**（"封装成 API 就要在 MCP 工具里看到他们,包括 API"） | ⬜ | §8g。OR-Tools sidecar 已封装为平台 API + datacore 求解器,但**未注册成 MCP server**、MCP 页看不到、agent 经 mcp-router 调不到。我曾用 AskUserQuestion 把它排在 FDE 之后,用户选了 FDE，此条留欠。 |
| A2 | **comprehend 地板认新求解器** | ◐ | FDE 参数倒推已贯通(选中求解器后自动填多跳参数→启动器出答案)，但**关键词地板 SOLVERS 只认 affected_orders/capacity_forecast**；无真 Kimi 时，"共享瓶颈/集中度/毛利倒挂"故事**选不中**对应新求解器。需加地板关键词 或 真 Kimi。 |
| A3 | **14 域参考运营本体 + 域内/跨域两库 + 多跳切片规划器 + 切片索引复用** | ⬜ | §3 用户"最新需求"整块未动。当前切片=单根/全字段覆盖根，**无图路径搜索的多跳切片规划器**，无两库读模型，无切片索引复用。 |
| A4 | **对象/类型浏览器管理页**（用户实测"找不到"） | ⬜ | §5。无 admin 对象浏览页（列已发布类型+物化计数+下钻实例）；对象图仅 `/v/graph` 业务视图。 |
| A5 | **FDE 编排工作流（可观测节点图）** | ⬜ | §6。无一条显式、节点状态可视、有保证终态的 FDE 工作流（意图→倒推→查能力→比差→各模块生成→回填节点→进启动器）。 |
| A6 | **拟真值域合成数据** | ◐ | scenarioTopology 可植入争用/定值，但通用合成仍 hash 值域（demandDelta=390 类）；非"落业务区间 + 恰当越线样本"。 |
| A7 | **B 栈 scaffold 单机可见** | ◐ | agents/意图/计划/场景仅在配 `AGENTCORE_BASE_URL+SERVICE_TOKEN` 时跨系统生成；否则用户本地看不到生成的 agent。 |
| A8 | **8d 扩更多最优化模型** | ◐ | CP-SAT sidecar + selection_optimize(背包)已落；assignment(订单分配)/sequencing(换型排序)/packing 待扩。 |
| A9 | **8b 传导 Datalog / 8a 图库 / 8e 因果 DoWhy** | ◐ | Q1/Q2/Q3/Q5 已由净室求解器覆盖（affected_orders/supplier_disruption_radius/margin_attribution/concentration_risk）；Soufflé/Neo4j/DoWhy 依赖**暂未引**（规模/精度顶不住再上，已在 §8 定调"默认不全上"）。 |
| A10 | **终态闭环末步"重跑验证真能推演"** | ◐ | publish-chain + InferenceButton + 参数倒推已让"建域→进启动器→点一下出答案"成立；但"建域→R4 审批→publish→**自动重跑问句验证**"未全自动化、未亲手全程跑通。 |
| A11 | **连接打 Connection.category 标签**（per-connection 归类） | ⬜ | §4 细化项：分类层(组织+模版+模式)已成，单个连接尚未带 category。 |
| A12 | **§0 全量真相审计 + §7 hand-run 验收登记常态化** | ◐ | `docs/AUDIT-hand-run.md` 已记数据构建发动机主线 + 求解器 live；其余模块(连接器/对象浏览/Agent 页)逐一 hand-run 未补全。 |

## B. 阻塞在用户（我做不了，需你处理）

| # | 事项 | 为什么我做不了 |
|---|---|---|
| B1 | **真调 Kimi（comprehend 用真 LLM）** | 需你填 Kimi API key（凭据，我不能代填）。机制(provider/用途绑定/降级地板)已就绪，缺 key。 |
| B2 | **泄露的 Gemini key 轮换/吊销** | 外部凭据安全，必须你在 Google 侧吊销/换。 |
| B3 | **浏览器像素级 hand-run** | 沙箱无浏览器；前端验证到 vitest+MSW 组件层 + HTTP 端到端层，未到像素层。 |

## C. 本会话已交付并验过（闭环，移出欠条）

- ✅ 5 个杀手级多跳求解器（affected_orders/supplier_disruption_radius/margin_attribution/shared_bottleneck/concentration_risk）+ 真实 HTTP 端到端。
- ✅ OR-Tools CP-SAT 自托管 sidecar + selection_optimize（可证最优，真求解 6 测、TS↔Py live）。
- ✅ FDE 求解器参数自动倒推贯通启动器（故事→点一下出答案，arg-binding 收口 G-3 一环）。
- ✅ 数据接入控制台数据分类全套（§4：12 类 taxonomy + 全类型归并 + 系统对接/文件上传 + 模版可看可下载 + 合成字段对齐 + 100% 切片字段覆盖）。

---

> **更新纪律**：每轮交付结束，回看本清单 → 把做完的移到 C、把新欠的加进 A/B → 汇报时附"本轮还欠 A 区哪些"。
> 不靠用户盯，靠这张表当强制执行的力量。
