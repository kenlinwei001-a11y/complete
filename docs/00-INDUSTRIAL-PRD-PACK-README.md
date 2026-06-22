# 工业级 1:1 复刻 PRD 包 · 全 12 视图（研发交付）

> 每份 PRD **自包含**:研发只读对应那一份 + `_reference/reference-prototype-decision-platform.html`(像素参照)即可 1:1 实现（UI + UX + 数据）。

## 怎么用
1. 先读 `PRD-verbatim-1to1-replication.md`(总纲:逐行标准 + 数据来源归属 5 分流 + 融合映射 + 验收口径)。
2. 按视图开 `PRD-IND-{view}.md`——每份 8 节:§1 概述 · **§2 UI 规格**(布局线框+组件)· **§3 UX 规格**(交互逐条)· **§4 数据规格**(全部常量/公式 + ★§4.5 系统字段级落地:现状种子/字段 vs HTML → 精确改哪些值/加哪些字段)· §5 契约/端点 · §6 融合点 · §7 验收(像素+交互勾验)· §8 实施任务。
3. 像素核对:与 HTML 对应视图并排,逐元素勾(色/字可调,结构/值/字符串/交互必须一致)。

## 12 份清单（含各自字段级关键发现）
| # | PRD | 视图 | 系统融入落点 | 关键字段级发现 |
|---|---|---|---|---|
| 1 | `PRD-IND-plan-generate.md` | 规划建议(黄金样板) | PlanGenerateView | 评分系数已对;改 6 个 base/targets 种子值 + 加 invTurns/extSensitivity |
| 2 | `PRD-IND-dash.md` | 经营驾驶舱 | DashboardView | 系统 IA 不同(约6卡 vs 八卡+台账+3DAG);9 区块缺;4 类 vs 8 根因 |
| 3 | `PRD-IND-risk.md` | 产能推演 | RiskBoardView | 命名不匹配 + forecastStart 差 21 天 + targetHash 口径;系数已对 |
| 4 | `PRD-IND-aop.md` | 年度情景规划台 | AnnualScenarioView | **真 bug**:YEAR=2027 写死但种子=2026→三卡空白;系统超集 |
| 5 | `PRD-IND-sop.md` | 月度 S&OP | SopBalanceView | 补 P90列/MRP物料线/量价本利/版本对比;revBudget 248 实为滚动(应 240) |
| 6 | `PRD-IND-quarter.md` | 季度滚动 | QuarterlyRollingView | 近 1:1;调种子复现 6 季 + 枣庄项目 + LTA 3 行 |
| 7 | `PRD-IND-audit.md` | 规划体检 | PlanAuditView | series 被丢弃;scoreH/M 25/8 vs 22/7;verdict 3态 vs 4态;缺 E01-03/KSF |
| 8 | `PRD-IND-order.md` | 项目/订单推演 | OrderChainView | 新 order_fullchain;11 节点 DAG(我原说9条错);补三判+C18+选择器+6KPI |
| 9 | `PRD-IND-order-aggregate.md` | 受影响订单聚合 | OrderChainView | econTable 无系统对应;细分按客户 vs 系统按型号 |
| 10 | `PRD-IND-model.md` | 型号产能推演 | ProjectSimView | ~70% 已成;补可产网络收敛标注 + CSV;capacity_forecast 数学已 1:1 |
| 11 | `PRD-IND-story.md` | 编排推演 DAG | InferenceProcessDag(横切) | 10节点/12边;projectTrace 投影图(9 PlanStep→10节点) |
| 12 | `PRD-IND-map.md` | 业务建模映射 | OntologyGraphView | 多已坍缩;仅补 6 域配色 + 决策域对象 + 4 注册表段 |

## 诚实声明
- 每份均**实读系统代码**做字段级落地,并在 §4.5/§8 标注了**待人工裁决的不确定项**(如基地命名、口径选择、verdict 枚举扩展)——这些是真实接缝,不是糊弄。
- 这是**设计 PRD,非已实现**;研发照 §7 的"像素+交互勾验 + FDE 亲手跑"验收,守"绿测试≠能用"。
- 数据走管线、前端零写死(R14);精确值入种子配置、同 seed 字节一致(R6);每数可溯(R13)。

`_reference/`:`reference-prototype-decision-platform.html`(1:1 真相源)· `SYSTEM-ONTOLOGY.md`(铁律 0)· `_PRD-TEMPLATE.md`。
