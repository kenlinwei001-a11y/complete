# 工业级 PRD · 业务建模映射 / 图谱族（map）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 数据）。**只读本文 + 像素参照 HTML 即可补齐缺口**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`：图谱视图定义 `VIEWS` L1353-1479（`map` L1474）· 映射表渲染 `openMap()` L5397-5420 / `closeMap()` L5421 · map-overlay HTML L849-854 · 数据域 `DOMAIN` L916-933 / 源系统 `SRC` L935-939 · 节点 `N(...)` L942 起 / 决策应用域一等对象 L1185-1196 · 分层 `TIER1/TIER3/TIERNAME` L1211-1217 · 配色 `KINDCOLOR` L1481 · 实例 `INSTANCES` L1512-1524 / 基地档案 `BASE_DATA` L1526-1539 · 四注册表 `LINK_TYPES` L1658-1677 / `RULES_REG` L1678-1698 / `ACTION_TYPES` L1699-1704 / `EVENT_TYPES` L1705-1709 |
| 落点（融入,不新建） | 前端 `apps/frontend-shell/src/views/OntologyGraphView.tsx`（图谱族已坍缩为单 renderer + colorBy/focusId）· 弹层 `apps/frontend-shell/src/views/graph/MappingOverlay.tsx`（map-overlay）· 后端 `apps/datacore/src/mapping.ts buildMappingRows`（映射表行）· 元数据 `apps/datacore/src/graphmeta.ts`（域/源/求解器/Agent）· 视角预设 `apps/datacore/src/synthetic/service.ts:1040-1052`（graph-* 八视角）· 契约 `packages/contracts/src/planviews.ts MappingRowSchema L100 / GraphOptionsSchema L237` |
| 不变量 | R14（前端零写死,值来自管线）· R6（同 seed 字节一致）· R13（每数可溯）· 1:1=结构/数据/交互 100%,**唯色调/字体可调** |
| **本视图特殊声明** | **图谱族（all/backbone/flow/source/solver/agent/loop/mvp/map）已按路线图坍缩进 `OntologyGraphView` 单 renderer + `graphOptions` 八视角预设（service.ts:1040-1052）。本视图 90% 已覆盖 ——「借鉴/已坍缩」。本 PRD 篇幅较短：§4.5 只列 **少量真实缺口**（四注册表未入映射表、决策应用域未着色、部分预设叙事描述未挂），并诚实标注其余已覆盖。** |

---

## 1. 视图概述
**业务建模映射（map）= 决策平台本体的「单一接线视图」**：把全量对象类型、关系类型、规则、Action、事件统一呈现为一张可下钻、可定位、可着色的图谱 + 一张全屏映射表，回答「**这个数字从哪来 · 受哪条规则约束 · 由哪个求解器/Agent 派生 · 关系基数与边属性是什么**」。

原型中它由两部分构成：
1. **图谱本体（force-directed SVG）**——一个力导向图，外加 `VIEWS` 中 9 个**视角切片**（`all` 全景 / `backbone` 主干分级 / `flow` 产能推演网络 / `source` 数据来源 / `solver` 求解器布局 / `agent` 智能体网络 / `loop` 学习闭环 / `mvp` 基础对象网络 / `map` 映射表）。视角只改**着色/过滤/高亮/链路类型**，不改底图。
2. **映射表（map-overlay）**——`map` 视角点开的全屏弹层 `openMap()` L5397，含①对象映射行 + ②关系类型注册表 + ③规则注册表 + ④Action 类型注册表 + ⑤事件对象表。「**所有数字派生自同一本体（一个事实一个出处）**」是其口号（L1187）。

**系统现状**：图谱族已坍缩为 `OntologyGraphView` 单渲染器 + `graphOptions` 八视角预设（service.ts:1040），映射表已实现为 `MappingOverlay`（mapping.ts 拼装行）。本视图主要是「**借鉴/已坍缩**」，仅余少量缺口（§4.5）。

## 2. UI 规格（布局 · 像素结构）
### 2.1 图谱底图（`buildSVG` · force-directed）
```
┌ main ─ svg#svg ────────────────────────────────────────────┐
│  force-directed：圆=对象 · ◆品红=求解器 · ⬡青=Agent         │
│  节点半径 radius(n) L1508：编排Agent 21 · hex 13 · diamond  │
│    15 · capacity/forecast 12 · 其余 10；tier1 +3 / tier3 −1 │
│  边按 KINDCOLOR L1481 着色（struct/flow/use/agg/infl/...）  │
│  defs#glow 高斯模糊光晕 L1498                                │
│  右侧 inspector#inspector：点节点看 域/类型/源/属性/规则/派生 │
└─────────────────────────────────────────────────────────────┘
图例 renderLegend：colorBy='domain' → 14 域 + 求解器层 + Agent 层
                   colorBy='src'    → 源系统着色（source 视角）
```
- **shape 编码**（`N` L942 注释 941）：circle 默认对象 / diamond 求解器 / hex agent。
- **DOMAIN**（L916-933,16 项）：工厂域#5E8FE8 / 产品域#36BFA5 / 工艺域#DD9551 / 设备域#9D8BF0 / 人员域#DD7E9E / 质量域#62BE77 / 产能域#43B7D7 / 预测域#D2B04C / 销售域#7E8BEE / 物料域#BC9A63 / 财务域#DF747E / 计划域#B07FD8 / 外部域#D08A66 / **决策应用域#54B5C4** / 求解器层#C470B8 / Agent层#5FC2AE。

### 2.2 map-overlay 映射表弹层（HTML L849-854 · `openMap` L5397）
```
┌ .map-overlay (rgba(8,11,16,.72) + blur4) ─────────────────┐
│ ┌ .map-box (max-w 1000 / max-h 88vh) ───────────────────┐ │
│ │ .map-top: <h2>业务建模映射表</h2>      [✕ closeMap]    │ │
│ │ .map-scroll:                                           │ │
│ │  <table#mapTable>                                      │ │
│ │   thead: 对象 │ 类型 │ 数据域 │ 源系统 │ 关键约束/派生  │ │
│ │   tbody①: 每对象一行（td-dot=域色 · ·扩充徽章 · 源色） │ │
│ │   ─ map-sec ① 关系类型注册表（LINK_TYPES 18 行）       │ │
│ │   ─ map-sec ② 规则注册表（RULES_REG 21 行）           │ │
│ │   ─ map-sec ③ Action 类型注册表（ACTION_TYPES 4 行）   │ │
│ │   ─ map-sec ④ 事件对象表（EVENT_TYPES 3 行）          │ │
│ └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```
- **对象行**（L5399-5404）：`<div.ob><span.td-dot 域色>{id}{·扩充?}</div>` · `<span.en>{type}` · `{域名}` · `<span.sys 源色>{src}` · `<span.cons>{约束/派生}`（cons=formula||bound.join||rules[0]||'—'）。
- **map-sec 组头**（CSS L212-213）：12px/700/产能色,顶部 2px 分隔线;map-sub 子表头 10px。
- **四注册表列**逐字见 §4.4。

### 2.3 视角切片（`VIEWS` L1353-1479,9 个与图谱相关）
| key | label | dot | 切片性质 | 关键字段 |
|---|---|---|---|---|
| all | 业务建模全景 | #43B7D7 | 全域 domain 着色 | desc L1356 长文 |
| backbone | 推演主干分级 | #43B7D7 | isTier;TIER1 高亮 | desc L1359 |
| flow | 产能预测推演网络 | #43B7D7 | nodes 子集 + flowLinks | nodes L1363 |
| source | 数据节点网络 | #5E8FE8 | colorBy:'src';派生淡出 | desc L1367 |
| solver | 求解器布局 | #C470B8 | nodes 子集 + showSolveLinks | nodes L1372 |
| mvp | 基础业务对象网络 | #43B7D7 | mvpView;⊕缺口虚线 | desc L1376 |
| agent | 智能体网络 | #5FC2AE | nodes 子集 + flowLinks | nodes L1381 |
| loop | 学习闭环 | #D2B04C | nodes 子集 + loopFocus | nodes L1472 |
| map | 业务建模映射表 | #AEB7C4 | isMap → openMap() | tag:映射 L1474 |

## 3. UX 规格（交互 · 状态 · 流）
| 交互 | 触发（HTML） | 行为 |
|---|---|---|
| 切视角 | tab onclick → `setView(key)` L3050 | 改 colorBy/过滤/高亮;`v.isMap`→`openMap()`L3117 |
| 打开映射表 | setView('map') → openMap L5397 | 渲染 mapTable + 5 段 → `.map-overlay.show` |
| 关闭映射表 | ✕ onclick `closeMap()` L5421 | 移除 show;若 activeView==='map' → 回退到 all tab L5422 |
| 点对象节点 | 节点 click → 选中 | inspector 显示 域/类型/源/属性/规则(点看 expr)/派生公式 |
| 点节点展开实例 | `toggleInstances(id)` L2086 | INSTANCES[id] 二级实例下钻到图谱（⊕展开 N 个 / ⊟收起） |
| 聚焦数据域 | 图例域 click → `focusDomain(key)` L5381 | 仅高亮该域,域内边加亮,余域 dim;modecard 显计数 |
| 全域还原 | 图例「全域」/空白 click `showAllDomains` L5394 | focusedDomain=null → setView('all') |
| colorBy=src | source 视角 `colorBySource(true)` | 按源系统着色;派生/求解/agent 淡出 |
| 缩放/平移 | wheel / drag | zoom/panX/panY;节点可拖拽 reheat |

**系统现状交互**（OntologyGraphView.tsx）：视角=`graphOptions` 预设（colorBy/nodeFilter/linkKinds/dimOthers/mvpOverlay/layoutSeed）✓ · 映射表=`MappingOverlay`（按域分组、行点击 `onLocate`→`focus` 定位 L80-85）✓ · 图例域过滤 `hiddenDomains` ✓ · colorBy=source 派生淡出 `NON_SOURCE` L53 ✓ · 节点点击写 sessionStore + inspector ✓。**主体交互已 1:1。**

## 4. 数据规格（值 + 来源 + 系统字段级落地）
> 前端**零写死**(R14);所有值来自:①合成种子→物化本体 ②graphmeta 元数据 ③求解器/规则注册 ④i18n ⑤ViewDef.graphOptions。

### 4.1 DOMAIN 数据域（②graphmeta · 16 项）
L916-933 逐字（见 §2.1 列表）。**系统现状**：`graphmeta.ts GRAPH_DOMAIN` L8 + `OntologyGraphView DOMAIN_COLORS/DOMAIN_LABELS` L16/L29 仅含 10 域（factory/product/process/equip/people/quality/capacity/forecast/solver/agent）。**缺 6 域**：sales/material/finance/plan(已在 GRAPH_DOMAIN 但无颜色 label)/external/**decision**。见 §4.5 缺口①。

### 4.2 SRC 源系统配色（②graphmeta · ⑤source 视角）
L935-939 + 补充 L1198-1200：ERP/SAP#5E8FE8 · MES#DD9551 · EAM/CMMS#9D8BF0 · IoT/SCADA#43B7D7 · QMS/LIMS#62BE77 · HR/排班#DD7E9E · PLM#36BFA5 · 决策中台派生#AEB7C4 · AIP/求解器#D2B04C · AIP/智能体#5FC2AE · WMS/ERP#5E8FE8 · CRM/合同#7E8BEE · SRM/长协#BC9A63 · FIN/总账·预算#DF747E · 行情数据/SMM#D08A66 · 上险/乘联会#E8B54A · 舆情监测#DD7E9E · 政策法规库#9D8BF0 · 汇率/运价指数#54B5C4 · APS/排产#2F8F6B。

### 4.3 决策应用域一等对象（①本体节点 · L1185-1196 逐字,5 个）
| id | type | src | props | note |
|---|---|---|---|---|
| 经营KPI | KPI | 决策中台派生 | 驾驶舱八卡:需求/供给/收入/毛利/利用率/齐套/现金/AOP · 三线差异入口 | 所有数字派生自同一本体（一个事实一个出处） |
| 待解决问题 | Problem | 决策中台派生 | 全量订单根源归并(4 类) · 归因 DAG · 受影响订单 · 财务贡献 | 自下而上:订单逐单归因→汇成问题;与逐单根因 DAG 同源 |
| KSF要素 | KSF | 决策中台派生 | 需求结构/产销爬坡/物料齐套/信用现金/成本外协 五要素 · 财务指标←KSF←问题 | 规划体检与规划建议共用的关键成功要素图 |
| 经营方案 | PlanOption | 决策中台派生 | 稳健/均衡/进取 三案 · 5 路径骨架按目标收敛 · 五维取舍矩阵 | 系统算路径与后果，选哪条由 CEO 拍板（不自动决策） |
| 问题传播时序 | RiskTimeline | 决策中台派生 | 逐日传导度 0-100 · 阶段事件·波及订单·财务击穿 | 与产能推演风险曲线引擎同构:基线爬升+事件脉冲,可解释可复算 |
- 均 domain='decision'(决策应用域#54B5C4),shape='circle'。**系统缺**：本体未种这 5 个 decision 对象（§4.5 缺口②）。

### 4.4 四注册表（①/③静态 · ④i18n,**映射表 ②③④⑤段逐字**）
**① LINK_TYPES**（关系类型,L1658-1677,18 行;列 n/s/card/props/ex）：包含·包含工序·产能核算·聚合·认证(可产)·分配·约束·触发/影响·写回(Action)·识别瓶颈·分解(计划脊柱)·汇总(三线差异)·情景触发·耗用·供给(长协)·采购履约·成本归集·收款。逐字录 L1659-1676。
**② RULES_REG**（规则注册,L1678-1698,21 行;列 id/expr/scope/sev/owner/ver）：C01–C12 + C13/C15/C16/C18/C21/C22/C23（无 C14/C17/C19/C20）。sev∈{阻断/告警/降级/自动},染色:阻断#DD7E9E·告警 forecast·余 capacity。逐字录 L1679-1697。
**③ ACTION_TYPES**（Action 注册,L1699-1704,4 行;列 n/params/check/target/perm[+audit]）：采纳产能保障方案·预警处置方案·调整排产分配·定稿月度计划版本。逐字录 L1700-1703。
**④ EVENT_TYPES**（事件对象,L1705-1709,3 行;列 n/win/aff/src/link）：检修窗口·交付高峰·到货间隙。逐字录 L1706-1708。

### 4.5 ★系统字段级落地（现状 → 须改/须加,精确）
> **诚实结论：图谱族 + 映射表主体已坍缩落地，约 90% 覆盖。** OntologyGraphView 已实现 force-layout/colorBy(domain↔source)/nodeFilter(ids/domains/tiers)/linkKinds/dimOthers/mvpOverlay/layoutSeed/inspector/字段覆盖徽章/CSV 模版（L454-484，这是原型未有的增强），MappingOverlay 已实现按域分组/行定位/规则 expr 展开/CSV·HTML 导出。八视角预设 service.ts:1040-1052 已挂。**仅余以下小缺口：**

- **缺口①（域着色补全）**：`OntologyGraphView.tsx` `DOMAIN_COLORS` L16 / `DOMAIN_LABELS` L29 + `graphmeta.ts GRAPH_DOMAIN` L8 补 6 域 → `sales:#7E8BEE 销售` · `material:#BC9A63 物料` · `finance:#DF747E 财务` · `plan:#B07FD8 计划` · `external:#D08A66 外部` · `decision:#54B5C4 决策应用`。（plan 已在 GRAPH_DOMAIN 但前端无 token/label）。
- **缺口②（决策应用域一等对象）**：本体/种子加 5 个 decision 对象（§4.3）。**建议作派生对象**（KPI/Problem/KSF/PlanOption/RiskTimeline 已是 dash/audit/generate/order 各视图运行态产物，此处仅把它们「本体化」为一等节点，sourceSystem='决策中台派生'）。映射表会自动多出 decision 组（mapping.ts 按 GRAPH_DOMAIN 分组，已支持新域）。
- **缺口③（映射表四注册表段）**：`MappingOverlay.tsx` 当前只有①对象映射行（按域分组）+ solver/agent 行（mapping.ts L38-66），**缺原型 ②关系类型 / ③规则 / ④Action / ⑤事件 四张注册表段**（HTML L5407-5419）。须：
  - 后端 `mapping.ts` 增 4 个聚合查询：LINK_TYPES←关系类型注册（或静态种子）· RULES_REG←`repos.rules`（已有 expr/scope/sev/owner/ver）· ACTION_TYPES←Action 类型注册· EVENT_TYPES←事件对象表；契约 `planviews.ts` 加 `MappingRegistriesSchema { linkTypes[], rules[], actions[], events[] }`（或复用既有 rules 端点 + 新增 3）。
  - 前端 `MappingOverlay` 在对象表后渲染 4 个 `map-sec` 分段表（列见 §4.4），样式对齐原型 `.map-sec`/`.map-sub`。
  - **注**：规则段数据已有（`fetchRules` L19），Action 类型在 datacore action-types 注册可复用；关系类型/事件类型需补静态种子（确定性，R6）。
- **缺口④（预设叙事描述卡）**：原型每视角有长文 `desc`（如 flow L1362 / source L1367 / agent L1380 产能金字塔/源系统/多智能体叙事）。系统 `graphView()` service.ts:967 仅 graph-loop 挂了 description（L1051）；**其余 7 视角 desc 为空**。建议把 7 段 narrative desc（i18n，逐字录自 HTML）挂到各 graphOptions `{ description }`，OntologyGraphView 已有 `descCard` 渲染位（L151-160）。**这是「叙事高亮」增强，非结构必需。**
- **已覆盖（不动）**：force 布局/zoom/pan/drag · colorBy domain↔source · nodeFilter/linkKinds/dimOthers/mvpOverlay/layoutSeed=42 · inspector(属性/源/规则 expr/派生) · 字段覆盖徽章 + CSV 模版（增强）· 映射表按域分组/行定位/导出 · backbone(tiers[0,1])/flow(flow,agg)/source/solver/mvp/agent/loop 七视角预设。**这些勿重做。**

## 5. 契约 / 端点
- `contracts/planviews.ts`：`MappingRowSchema` L100 不变（对象/solver/agent 行）；**新增** `MappingRegistriesSchema`（linkTypes/rules/actions/events 四注册表，缺口③）。`GraphOptionsSchema` L237 不变（已含 nodeFilter/colorBy/linkKinds/dimOthers/mvpOverlay/layoutSeed）；可选给 graphView `description` 字段（缺口④，已被 `view.options.desc` 消费 L71）。
- `graphmeta.ts`：`GRAPH_DOMAIN` 补 6 域（缺口①）。
- 端点：`GET /a/v1/ontology/{pkg}/graph`（图谱）·`GET /a/v1/ontology/{pkg}/mapping`（映射行）· `GET /a/v1/rules`（规则段，已有）·**新增** `GET /a/v1/ontology/registries`（关系/Action/事件三注册表）或并入 mapping 端点返回。

## 6. 融合集成点（5 处,不绕过）
Renderer `registry.ts`（`ontology-graph` 已注册,八视角共用）· ViewDef `service.ts:1040-1052`（graph-* 预设,缺口④加 description）· Feature `features.ts`（view.graph-* / act.export 控导出）· 映射表元数据 `mapping.ts`（缺口②/③扩聚合）· 域元数据 `graphmeta.ts`（缺口①补域）。**复用 OntologyGraphView + MappingOverlay,增强不重建。**

## 7. 验收（DoD = 真 1:1）
- **像素核对**：与 HTML map 视角并排——图谱底图(圆/◆/⬡ + 域色 + glow)、9 视角切片切换、映射表 5 段（对象行 + 4 注册表段）、组头 map-sec、行点击定位、inspector，**结构/值/字符串/交互一致**（色/字可调）。
- **缺口验收**：①16 域全部有色 + label;②映射表含 decision 组 5 行;③映射表显示 ②③④⑤四注册表段（LINK 18 / RULES 21 / ACTION 4 / EVENT 3 行,逐字）;④7 视角描述卡有 narrative 文案。
- **数据**：前端零写死;注册表值=HTML 精确;同 seed 字节一致(R6);每行可定位(R13);colorBy=source 派生淡出。
- **诚实复盘（FDE 纪律）**：本视图「已坍缩」，验收**仅核 4 缺口 + 既有未回归**，不重复验收已覆盖部分;但须 FDE 亲手切 9 视角 + 开映射表逐段核对，**绿测试 ≠ 能用**。
- `pnpm -r build && test` 全绿;`ontology:check` 过。
- 回写本体：若新增 decision 5 对象/4 注册表段,回写 `docs/SYSTEM-ONTOLOGY.md` §对象类型 + §关系类型/规则/Action/事件注册表对应章节。

## 8. 实施任务（研发可直接拆）
1. **域补全**（缺口①）：graphmeta.ts `GRAPH_DOMAIN` + 前端 `DOMAIN_COLORS/DOMAIN_LABELS` 加 sales/material/finance/plan/external/decision 6 域色 + label。
2. **决策应用域对象**（缺口②）：本体/种子加 经营KPI/待解决问题/KSF要素/经营方案/问题传播时序 5 个 decision 派生对象（props/note 逐字 L1185-1196）;映射表自动现 decision 组。
3. **映射表四注册表段**（缺口③）：契约 `MappingRegistriesSchema`;mapping.ts 聚合 LINK_TYPES/RULES_REG/ACTION_TYPES/EVENT_TYPES（规则复用 repos.rules;关系/事件补静态种子,R6）;MappingOverlay 渲染 4 个 map-sec 分段表（列/字符串逐字 §4.4）。
4. **视角叙事描述**（缺口④）：7 段 narrative desc 逐字入 i18n,挂 graphView description（service.ts:967/1040-1052）。
5. **i18n**：DOMAIN 域名、SRC 源系统名、四注册表表头/字段、视角 desc 逐字入 locales。
6. **回归**：确认既有 force/colorBy/nodeFilter/inspector/导出未回归;FDE 亲手切 9 视角核对。

> **本视图属「借鉴/已坍缩」**：图谱族 9 视角 + 映射表主体已落地，本 PRD 篇幅短于数据密集视图属正常。研发只需补 4 个明确缺口（域着色 / decision 对象 / 四注册表段 / 视角叙事），不得重建已覆盖部分。其余 11 视图工业 PRD 索引见 `PRD-verbatim-1to1-replication.md §2`。
