# 轨R · 三板块 HTML 母版欠账补齐 · 增量0 基线（真浏览器实拍 + curl oracle 确认真缺口·零代码）

> 合同 `HANDOFF-three-boards-remaining-gaps-verified.md`。铁律：增量0 先逐项真浏览器实拍现状，确认"真缺口"再建（清单可能再 stale）。
> 真系统：datacore:4001 + agentcore:4002 + vite:5173；demo/admin。视图键：dash/plan-audit/plan-generate/project-sim/risk。

## §1 已建·禁碰（实拍坐实·重建即返工）
- **#5 规划体检 X01-X05 命名校验 + 一键 fix**：plan-audit 实拍满载——软风险 5 卡逐条带规则芯片 [C15/C06·C16/C21/C24/C13] + 命名 ID [X03/X04/R01/E01/E03] + 一键应用 + 采纳为草稿。✅（截图 `three-boards-r0-plan-audit.png`）
- **#9 KSF 图**：plan-audit 底部"财务计划 KSF 图（问题→关键成功要素→财务指标）"满载（产销爬坡/信用现金/成本外协/需求结构/物料齐套 → 需求达成95.3/毛利16.4/物料保障94.6）。✅
- **型号驱动六步**：project-sim 实拍——整单/分批 + 型号 4680-NCM + 六步 DAG（场景解析→可产基地收敛→驱动因子装载→逐级聚合P50→瓶颈定位→结论与对策）+ 缺口 35.2 万套。✅（截图 `three-boards-r0-project-sim.png`）

## §2 真缺口（实拍确认 · 标确信度 + 建议增量序）

| # | 板块 | 实拍现状 | 真缺口 | 后端 oracle | 序 |
|---|---|---|---|---|---|
| **#7** | 项目决策推演 | project-sim 有**订单列表**(13单) + 型号驱动六步(已建)；选单**不出**订单三关联判 verdict | 补**订单驱动模式**：选单→三关联判+4态verdict+对冲 | ✅ **`order_fullchain` 100% 现成**：返回 verdict(可接/提价X%接/信用阻断/不建议接)+judges{cap交期判[C02/C03]·kit齐套判[C06/C16]·fin财务判[C15/C13/C18]}+conds对冲+ruleRefs | **增量1（首·最清晰·纯接现成）** |
| **#4** | 规划体检/方案生成 | plan-audit 有 KSF图(问题→KSF→财务)，**无**负+正贡献聚合勾稽闭合表 | 补规划侧聚合勾稽表（Σ负+正闭合·与驾驶舱毛利勾稽同源） | 同源 `margin_attribution`/驾驶舱 marginLedger | 增量2 |
| **#2** | 驾驶舱 | KPI 八卡溯源徽 20 个在，只显推导/输出/快照 | 补六要素（来源系统/新鲜度/规则号C01-25/公式串） | 接 RuleRef·Provenance.tsx 六要素组件 | 增量3 |
| **#3** | 驾驶舱 | provenance-dag 在（result→KSF→factor→反事实排除✅），**未见 event 层** | 补 event 层(驱动事件)+受影响订单可点跳 | 接真事件(affected_orders/outbox) | 增量4 |
| **#1** | 经营驾驶舱 | dash 问题面板 **3 类**(交期13单7亿/信用21单12亿/毛利8单9亿)·"24单逐单归因→汇成3类" | 母版 8 根因 | ⚠ `affected_orders` 按 **effect 4 类**(CREDIT/MARGIN/KIT/DELIVERY)分组非 8 链；battery.ts:1519 仅 6 链；`buildOrderProblems`(risk.ts:733) 按类聚合——**扩 seed 到 8 未必出 8 卡**，需调分组逻辑(触求解器·HANDOFF 说别动)→**存疑·实拍后定·可能要先问** | 增量5（最棘手·先决策） |
| **#8** | 规划体检/方案生成 | PropagationTimeline 在"时序推演（不解决会怎样）"链后（非裸载）；recon 证真算(真算/估算双模) | 已大部建·确认即可（risk 页挂载/逐日曲线是否缺） | risk.ts:550 真算 revenueWan | 增量6（确认·小尾巴） |

## 红线遵守
真推演非假（MOCK 诚实标）· 接现有不新建（#7 接 order_fullchain·#4 接 margin 同源·不另起求解器）· 显示即溯源（judges 带 ruleRefs）· 平台术语。**完成=pnpm -r build 真绿(tsc+vite)+真浏览器实拍能用**。

## 下一步
增量1 = #7 订单驱动 verdict（ProjectSimView 加 orderMode：选单→invokeSolver order_fullchain→三关联判表+4态verdict+对冲·接现成不重写型号六步）。
