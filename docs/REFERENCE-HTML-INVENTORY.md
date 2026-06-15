# 参考原型完整盘点与采纳清单（reference-prototype-decision-platform.html）

> 目的：对参考原型（5436 行单文件）做**逐节完整盘点**，把"有价值的部分"逐条标注**采/不采 + 融到系统哪里**，作为 P3 前端与本体浏览器/字段全建模/驾驶舱升级的**施工依据**。命名禁用外部产品名。
> 方法：分 5 段并行通读（1-1200 / 1200-2300 / 2300-3500 / 3500-4500 / 4500-5436），逐函数/逐数据注册表记录，带 `行号` 锚点。
> 状态：5 段全部盘点完成（含 §A 节点注册表 1-1200）。

---

## 0. 一句话结论

原型是**纯静态演示**（数据写死、无后端、无多租户），但它把"**可信 = 出处 + 推导可当场亮出**"这件事做到了**每一个数字**——这正是我们系统当前最缺的"活数据可溯"的**前端范式**。最高价值可采项：**通用出处机制 `provSpan/provTip`**、**节点检视器（数据源+schema+样例+CSV）**、**来源系统·数据详情钻取模态**、**规则/Action/事件 一等对象检视**、**外部信号层 EXT_SIG**、**S&OP 五步与版本演进**、**学习闭环根因台**。

---

## 1. 核心机制（最高采纳价值）

### 1.1 通用出处机制 `provSpan` / `provTip`（`:4759-4777`）★★★ 必采
用户点名的"结论里的数据，悬浮弹出引用来源"就是它。
```js
const PROV={};
function provSpan(id,def,inner){PROV[id]=def;
  return `<span class="pv" onmouseenter="provTip('${id}',event)" onmouseleave="hideDayTip()">${inner}</span>`;}
function provTip(id,ev){const d=PROV[id];if(!d)return;
  const fresh=d.fresh||((DATA_HEALTH[d.src]||{}).detail||'');
  // 渲染：标题·值 / 来源(+新鲜度) / 推导(formula) / 输入因子(inputs[]) / 关联规则(rule) / note
}
```
- **范式**：任何数字用 `provSpan(id, {t,v,src,formula,inputs,rule,note}, "<b>123</b>")` 包一层 → 带虚线下划线（`.pv` `:373`）→ 悬浮出 `{来源, 新鲜度, 推导公式, 输入因子, 关联规则, 备注}`。
- **CSS**：`.pv{border-bottom:1px dashed; cursor:help}` `.pv:hover{border-bottom-color:强调色}`。
- **融到系统哪里**：做一个 React `<Provenance>` 包裹组件 + `provTip` 浮层；`def` 不写死，而是来自**我们 P2 的 lineage 端点**（`GET /a/v1/lineage/object/:type/:id` → source.connection/rawDataset/rawRow + derivations.formula）和 `resolvedRefs`。即：原型用静态 PROV 字典，我们用**活 lineage**。这把"活数据可溯 P3"和驾驶舱出处升级一次性落地。

### 1.2 节点检视器 `renderInspector`（`:1982-2124`）★★★ 必采 → 本体浏览器
点节点右侧依次出：① 头部(名/类型/域/层级) ② 变体面板(rule/action/event/base/bottleneck) ③ 下级(可展开) ④ **数据来源 pill** ⑤ 属性 ⑥ **派生/计算公式** ⑦ 规则 ⑧ 约束 bound ⑨ **由谁操作(solver/agent 反查)** ⑩ 下游关系 ⑪ **字段 schema + 5 行样例 + 下载 CSV** ⑫ 派生对象"数据获取方式"。
- **融到**：本体浏览器页节点检视器（PRD-ontology-browser-field-coverage §3.3）。我们的等价数据：schema=PropertyDef、formula=DerivedPropertyDef、规则=scope 该类型的 Rule、由谁操作=refs.ts 反查、数据来源=lineage 的 connection、样例=A7 合成行、CSV=`/a/v1/ontology/types/:typeKey/template.csv`。

### 1.3 CSV 模板下载 `downloadTemplate`/`synthVal`（`:2246-2253` 区）★★ 必采
表头=schema 字段(+单位/%) ；3 行确定性样例由 `synthVal(field,i)` 按字段类型生成；UTF-8 BOM。→ 本体浏览器每节点"下载导入模板"，样例改走我们的确定性合成器（R6）。

### 1.4 来源系统·数据详情 钻取模态 `openSrcModal`/`srcDetailRows`/`SRC_META`（`:2531-2570`）★★★ 必采
点结论里的"来源 ⤢"→ 弹模态：**来源系统·模块 / 数据表对象 / 字段·取值明细 / 采集频率 / 最近更新 / 数据责任人 / 数据血缘**。`SRC_META` 每来源含 `{sys,mod,table,steward,freq,lineage}`。
- 这是比悬浮更深一层的"**可核验**"钻取。→ 融为"溯源抽屉"的展开态：从 lineage 端点取 connection + rawDataset(fields/table) + rawRow + 责任人(后续补) + 血缘(origin→derivation 链)。

### 1.5 瓶颈矩阵 `buildBnMatrix`（`:2308-2333`）★★ 选采 → 风险视图组件
`BN_FACTORS`(7 因素) × 12 基地热力矩阵；`BN_PRIMARY` 标当前主瓶颈(◉)；`utilColor` 四档着色（≥92 红/≥85 橙/≥78 黄/else 绿）。

### 1.6 风险时间轴 + 日级钻取 `buildRisk`/`riskEvents`/`showDayTip`/`.rk-pop`（`:2337-2630`）★★ 选采
每基地 × 7 因素 × N 天热力点 + sparkline；悬浮某天 → `{事件(tag/desc/来源), 受影响订单}`；根因文本 `riskWhy` 显式拼"基线→目标位→叠加事件(来源)→首次越线日"。点"来源"→ 1.4 模态。

---

## 2. 数据注册表（逐项内容，融合富矿）

### 2.1 关系类型 `links[]` / `L()`（`:1223-1331`）
`L(source,target,rel,kind)`；kind 语义+配色：struct(灰)/flow(橙#DD9551)/use(紫#9D8BF0)/agg(青#43B7D7)/infl(绿#62BE77)/input(黄#D2B04C)/solve(品#C470B8)/orch(青绿#5FC2AE)/fb(黄)/par(绿#36BFA5)。→ 本体图谱边着色参照。

### 2.2 视图注册表 `VIEWS`（19，`:1353-1479`）
all/backbone/flow/source/solver/mvp/agent/dash/audit/generate/aop/quarter/order/sop/story/loop/map/risk/model。每个含 key/label/isFS/wrap/build/linkKinds。**业务视图我们已有同类**（DashboardView/RiskBoardView/sim/*/plan/*）→ 多数**不照搬**，借鉴交互。

### 2.3 字段 schema `SCHEMA_BY_TYPE`(12 类) + `SCHEMA`(10 源对象)（`:2126-2184`）★ 采为数据模版底座
每字段 `{f 名, t 类型(code/str/int/num/pct/date/enum), eg 示例, u 单位, dec 小数, opts/egs 枚举}`。类型含 Base/Routing/ShiftPlan/Product/Equipment/ProcessStep/ProductionLine/Factory/Workshop/Employee/Shift/QualityMetric/BatteryCell/Material；源对象含 生产工单MO/实际产出/OEE指标/OEE历史/良率/换型时间/物料齐套/在制品WIP/需求订单。
- → 喂给**字段全建模门**与本体浏览器：这些是"每字段单位/枚举/类型"的现成口径（确定性映射管线可借此校验）。

### 2.4 规则注册表 `RULES_REG`(C01-C23，`:1678-1698`)★★ 采为规则口径对齐
每条 `{id,expr,scope,sev(阻断/告警/降级/自动),owner,ver}`。如 C01 产线产能≤设计上限(阻断)、C06 齐套<80%冻结排产(阻断)、C08 外协≤20%(阻断)、C13 信用额度(阻断)、C15 接单毛利线(告警)、C18 现金垫≥50亿(阻断)、C23 CAPEX IRR≥15%(阻断)。→ 与我们 Rule C01-C33 对齐口径 + 检视器排版(id/版本/严重级/作用域/负责人/表达式)。

### 2.5 Action 类型 `ACTION_TYPES`(4，`:1699-1704`)★ 采为 Action 检视排版
每条 `{n,params,check(引用规则),target(写回),perm(发起/审批),audit}`。→ 我们 ActionType 检视器展示参数 schema+校验规则+写回目标+权限+审计。

### 2.6 事件类型 `EVENT_TYPES`(3，`:1705-1709`)★ 选采
`{n,win(时间窗),aff(影响边),src(来源),link}`：检修窗口/交付高峰/到货间隙。→ 风险时间轴事件对象。

### 2.7 外部信号层 `EXT_SIG`(8，`:4781-4797`)★★ 采 → 环境感知层（新能力）
7 域：大宗(碳酸锂/铜箔)/终端上险/舆情/政策(欧盟电池法)/汇率运价/区域电力/竞争。每条 `{id,k,v,d,sev(0/1/2),src,tag,impact(+关联规则)}`。→ 这是系统目前**没有的"外部域"**——可作为新连接器类型(EXTERNAL feed)的范式 + 规划体检/建议的敏感性输入。

### 2.8 S&OP 数据台 `SOP_SEG/SUPPLY/MAT/FIN/VERS`（`:4993-5020`）★★ 采 → S&OP 视图真数据
- `SOP_SEG` 需求分细分(tgt/p50/p90/act)；`SOP_SUPPLY` 各基地(cap/bn/tight)；`SOP_MAT` MRP 净需求(net/lta/gap/eta)；`SOP_FIN` 收入/成本/毛利(预算 vs 滚动)；`SOP_VERS` V1→V7 版本演进带决议。
- → 我们 S1.8 S&OP 的真实数据结构参照 + 五步流程。

### 2.9 规划情景 `GEN_PATHS`(5 路径 A-E)/`GEN_GOALS`/`GEN_BASE`/`GEN_EXT_SENS`/`GEN_FOCUS`（`:4284-4559`）★ 选采 → 规划建议求解器口径
5 路径(保毛利/保规模/扩产/外协/混合★)，每路径 `{eff 量价算子, rules, 外部信号敏感性, KSF+问题链(4 段传导)}`。`gen3Plans` 5→3(稳健/均衡/进取)。→ plan_generate 求解器口径与解读。

### 2.10 体检 `AUDIT_PRESETS`(V7/AOP/CEO) + `runAuditDiag`(H/M/S 三层)（`:4804-4909`）★ 选采 → plan_audit 口径
硬矛盾 X01-X05(细分≠总需求/产销缺口/毛利结构/正极缺口/现金垫) + 软风险 R/E + 一键修复 `applyAuditFix`。→ plan_audit 解读与"一键修复 Action"。

### 2.11 年度情景 `AOP_SCEN`(3) + `AOP_TRIGGERS`(2) + `AOP_DECOMP`（`:3150-3158`）★ 选采
保守/基准★/激进 各 `{dem,cap,lta,rev,capex,irr,c18,c23}`；触发条件挂牌监测(海外大单/储能需求)。→ "触发条件 live 监测"是有价值的运营模式（规则常驻而非拍完即弃）。

### 2.12 学习闭环 `ROOTS`(8 根因) + `learn`（`:5254-5266`）★ 选采 → 校准引擎可视化
根因分 缺数据/缺约束/缺函数(`CATC` 配色)；每项 `{对象,症状,修复}`；MAPE 收敛曲线。→ 我们 M11 校准引擎的"为什么越用越准"可视化。

### 2.13 决策 DAG `STORY_SHORT/POS/EDGES`(10 步非线性)（`:5118-5130`）★ 选采
①解析→(②检索|③装载 并行)→④聚合→⑤瓶颈→⑥推演→⑦比对→⑧校验→⑨写回→⑩回采(反馈回 ①④)。→ QOS 编排可视化/教学。

### 2.14 节点注册表 `nodes[]`/`N()` + 域/源配色（`:916-1196`）★★ 采为本体口径底座
`N(id,domain,type,src,shape,props,rules,formula,bound,note)`；shape: circle(对象)/diamond(求解器)/hex(Agent)。95+ 节点跨 16 域。**节点级 formula/bound 是高价值口径**（与我们 Solver/DerivedProperty/Rule 对齐）：

**产能金字塔（capacity 域，逐级 formula）**
- 设备产能 `= (3600/节拍CT) × 可用时间 × OEE`（`:1021`）
- 工序产能 `= 设备产能 × 良率 × 人力可用系数`（`:1024`）
- 产线产能 `= min(各工序产能)`（木桶，`:1027`）
- 工厂产能 `= Σ产线产能（受共享资源约束）`（`:1030`）
- 化成 `= 通道数 × (3600/单通道占用秒)`（并行，`:971`）；老化 `= 库位数 / 老化天数`（`:974`）
- OEE `= A × P × Q`（`:997`）；停机/维保 bound `capacity(t)=0 if t∈维保窗口`（`:1000`）
- 关键正极材料 bound `capacity ≤ material_supply / 单耗`（物料平衡，`:960`）

**4 求解器（diamond，含 bound 口径）**：聚合求解器(逐级聚合 bound 三式 `:1046`)/瓶颈求解器(`瓶颈=argmin(工序产能)` `:1051`)/场景求解器(`产能预测=求解(切片⊕场景Δ,约束)` `:1056`)/精度校准器(`误差=|预测−实际|→校准`，EMA `:1061`)。→ 对齐我们 SOLVER_KEYS + M11 校准。

**10 Agent（hex）**：编排/意图解析/检索(resolveSlice)/建模求解/瓶颈诊断/解释校验/学习/行动/经验记忆库/约束规则。→ 对齐 B1 Agent + Skill。

**财务派生链（finance 域，"一个事实一个出处"）**：收入 `=Σ(量×细分单价)`、销售成本 `=BOM成本+制造费用`、毛利 `=收入−成本`、现金流 `=回款−付款−资金占用变化`、MRP 净需求 `=需求×BOM单耗−库存−在途`。

**6 个 MVP 数据缺口（note=true，原型自标）**：生产工单MO/实际产出/换型时间/物料齐套/OEE历史/在制品WIP——bound 注明"需从 MES/WMS/SCADA 补采"。→ 与我们字段全建模门"未覆盖即拦"呼应。

**16 域配色**：factory#5E8FE8/product#36BFA5/process#DD9551/equip#9D8BF0/people#DD7E9E/quality#62BE77/capacity#43B7D7/forecast#D2B04C/sales#7E8BEE/material#BC9A63/finance#DF747E/plan#B07FD8/external#D08A66/decision#54B5C4/solver#C470B8/agent#5FC2AE。
**19 源系统配色**：ERP/SAP·MES·EAM/CMMS·IoT/SCADA·QMS/LIMS·HR/排班·PLM·决策中台派生·AIP求解器·S&OP/ERP·AIP智能体·WMS/ERP·CRM/合同·SRM/长协·FIN/总账·行情数据/SMM·上险/乘联会·舆情监测·政策法规库·汇率运价。→ 本体浏览器域分组着色 + 数据源 pill 配色直接采用。

**关键 CSS 行为令牌**：`.pv`(出处虚线 `:372`)·`.formula`(公式块 `:570`)·`.bound`(约束块 `:572`)·`.rule-link`/`.src-link`(可点溯源 `:235`)·`.hb.ok/.warn`(新鲜度徽章 `:192`)·暗色主题变量(`:10-22`)。→ 设计令牌可直接移植。

---

## 3. 采纳决策汇总（采/不采 + 融到哪）

| 项 | 价值 | 决策 | 融到系统 |
|---|---|---|---|
| provSpan/provTip 出处机制 | ★★★ | **必采** | `<Provenance>` 组件，def 来自 P2 lineage 端点 + resolvedRefs（活数据可溯 P3） |
| 节点检视器 | ★★★ | **必采** | 本体浏览器（PRD-ontology-browser §3.3） |
| 来源·数据详情钻取模态 | ★★★ | **必采** | 溯源抽屉展开态（lineage 端点） |
| CSV 模板下载 | ★★ | **必采** | 本体浏览器每节点 + `/ontology/types/:k/template.csv` |
| 字段 schema 注册表 | ★★ | **采(口径)** | 字段全建模门 + 数据模版 |
| 规则/Action/事件 一等对象检视 | ★★ | **采(排版)** | 复用现有 Rule/ActionType + 检视排版 |
| EXT_SIG 外部信号层 | ★★ | **采(新能力)** | 新 EXTERNAL 连接器范式 + 规划敏感性 |
| S&OP 五步+版本演进 | ★★ | **采** | S1.8 S&OP 视图真数据结构 |
| 瓶颈矩阵 / 风险时间轴 | ★★ | **选采** | 风险视图组件 |
| 学习闭环根因台 | ★ | **选采** | M11 校准可视化 |
| 规划路径/体检口径 | ★ | **选采** | plan_generate/plan_audit 解读口径 |
| 决策 DAG 可视化 | ★ | **选采** | QOS 编排教学视图 |
| 19 个 view 的实现 | — | **不采** | 业务视图已有；仅借鉴交互 |
| 手写力导向图引擎 | — | **不采** | 用 Cytoscape/d3 |
| 写死数据/单文件结构 | — | **不采** | 我们是真后端+多租户 |

---

## 4. 与现有 PRD/路线的接点
- 出处机制 + 来源钻取 → **PRD-live-traceable-data P3**（前端溯源）。
- 节点检视器 + CSV + 字段 schema → **PRD-ontology-browser-field-coverage**。
- 驾驶舱富出处/三线偏差/问题聚合 → 驾驶舱 widget 升级（场景启动器 P3 阶段并入）。
- EXT_SIG → 未来"外部域"连接器（记入 G-6 rawin 后续）。
