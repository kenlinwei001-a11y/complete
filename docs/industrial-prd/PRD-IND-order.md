# 工业级 PRD · 项目 / 订单推演（order）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 数据）。**只读本文 + 像素参照 HTML 即可 1:1 实现**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`：`buildOrderView` L3341 · `orderJudge` L3230-3260 · `odNodes`（11 节点 DAG）L3263-3302 · `odDagSVG` L3304-3321 · `odDetHTML`/`odPick` L3322-3340 · 三判明细表 L3365-3388 · 结论与对冲 L3390-3394 · `adoptOrder` L3396-3399 · 数据 `MODEL_DEF` L1542 · `ORDERS`（24 单）L1558 · `T0` L1584 · `BOM_T` L3220 · `SEG_FLOOR` L3221 · `ORDER_OVR` L3222-3229 · `SEG_PRICE`/`SEG_MARGIN`/`ordSeg` L2379-2382 · `DATA_HEALTH` L1599 · `hashN` L1605 · `dateOf` L1636 · `linkRules` L5198——本文已把其全部常量/公式/交互转录,研发以本文为准、HTML 仅作像素核对。 |
| 落点（融入,不新建视图） | 前端 `apps/frontend-shell/src/views/plan/OrderChainView.tsx`（renderer `order-chain`,当前 262 行,稀疏——仅 affected_orders 4 类问题归并）· **新求解器** `apps/datacore/src/solvers/risk.ts` 内 `orderFullchain()`（与现有 `affectedOrders` L275 / `buildOrderProblems` L439 同文件并存）· 注册 `apps/datacore/src/solvers/service.ts`（SOLVER_KEYS L17 + SOLVER_OUTPUT_SHAPES L64 + invoke switch L565）· 契约 `packages/contracts/src/solvers.ts`（新 `OrderFullchainOutputSchema`）· 种子 `apps/datacore/src/synthetic/battery.ts`（ORDER_OVR/BOM_T/SEG_FLOOR/SEG_PRICE/SEG_MARGIN 入种子参数）· ViewDef `apps/datacore/src/synthetic/service.ts:1027`（`order-chain` layout 扩 `odDag`/`orderSolverKey`） |
| 不变量 | R14（前端零写死,值来自管线）· R6（同 seed/同 so 字节一致——`orderJudge` 全部确定性,`hashN` 纯字符串哈希无随机）· R13（11 节点每节点 formula+输入表[源系统·新鲜度]+本体链+规则可溯）· R-一致（周供给口径与产能推演/S&OP/季度同源 C02；齐套 MRP 口径同 S&OP ③ C06；现金垫口径同规划体检/AOP C18）· 1:1=结构/数据/交互 100%,**唯色调/字体可调** |

> 一句话：本视图是**订单全链推演**——选一张 SO（项目=订单），一次性跑 **交期(产能 CTP) + 齐套(MRP) + 财务(毛利 C15→信用 C13→现金 C18)** 三关联判，把结论从「缺口 X 万套」升级为 **「可接 / 提价 X% 接 / 不接」**，并展开 **11 节点业务建模链 DAG**（订单→4 个本体对象→3 个求解判→结论）+ 三判明细表 + 采纳→Action(C10 留痕)。系统现状是最大缺口：`OrderChainView` 只做了跨基地"问题归并 4 类"（affected_orders），**缺订单选择器 + 6 KPI 卡 + 统一结论 + 11 节点 DAG + 三判明细表 + C18 现金闸 + 采纳按钮**。本 PRD 落地新求解器 `order_fullchain`（逐单三判）并重建 `OrderChainView` 为订单中心，保留现 4 类归并作下方跨单超集面板。结构性提案见 `docs/PRD-order-project-sim-1to1.md`，本文是其字段级工业化落地。

---

## 0. 本体引用与影响（强制 · 先读 `docs/SYSTEM-ONTOLOGY.md`）
- **触及对象类型**（§2.E）：`Solver(order_fullchain)`（**新**：逐单三判 + 统一结论 + 11 节点 DAG）· `Order/Model/Base/Line/Material/Customer/ARInvoice/Shipment/PurchaseOrder/Segment/PriceList`（11 节点业务建模链关联对象,已在本体）· `Rule(C02/C03 交期 · C06/C16 齐套 · C13 信用/C15 毛利线/C18 现金 财务 · C10 采纳留痕)` · `ActionType(订单结论采纳 → 工单 MO / 合同)`。
- **触及链路**（§3）：`订单 Order →(解构) {net 可产网络(Model→认证产线→Base) · bom BOM展开(正极净需求 MRP) · eco 单价与细分(价格表→毛利) · cred 信用档案(应收→额度→舆情)} →(三关联判) {jcap ①交期(周供给 P50/P90 vs 周需求 C02/C03) · jkit ②齐套(净缺口=需求×(1−覆盖) C06/C16) · jfin ③财务(C15 毛利线→C13 信用→C18 现金 三闸)} →(合议) vrd 统一结论(可接/提价接/不接) + 对冲条件 conds[] → 采纳 Action(C10 留痕→工单/合同)`。
- **触及事件/数据流**（§4）：`order_fullchain` 即时算（选单/换单触发 useLiveSolver,无副作用）；采纳走 `action.executed`（R4 写真相,审计 ref=C10）。
- **触及不变量**（§5）：R14（订单/型号/BOM/价格/信用阈值配置化,ORDERS/ORDER_OVR/BOM_T/SEG_FLOOR/SEG_PRICE/SEG_MARGIN 仅作生成器种子,前端零写死）· R6（同 (so, seed) 字节一致——`hashN` 纯字符串哈希）· R13（11 节点深度=HTML `odDet`：logic+formula+inputs[源系统·新鲜度]+chain[本体对象]+rule）· R-一致（周供给/齐套/现金口径跨视图同源）· R4（采纳走 Action）。
- **关闭/影响断点**（§8）：G-5（应用层电池锁死——去 `OrderChainView` 的 `CHAIN_TITLES`/`SEG_COLOR`/`CHAIN_COLORS` 硬编码,移入 ViewDef/求解器/种子）；与 `docs/PRD-order-project-sim-1to1.md` 提案归一。
- **门禁**（§7）：`debattery:check`（前端零写死）· `chain:check`（order_fullchain 注册 + 11 节点链路登记 + ruleRefs）· `ontology:check`（回写 §2.E/§3/§7）· 前端回归（order-chain testid）· FDE 亲手跑逐单三判。
- **回写承诺**：`order_fullchain` 求解器 + 11 节点业务建模链 + C18 现金闸接入 → 回写本体 §2.E（新求解器）/§3（新链路）/§7（新门禁 chain:check 条目）。

---

## 1. 视图概述
计划员选一张销售订单（SO，ORDERS 24 单）→ 系统把这张订单当作**一个项目**,从订单解构出**业务建模链上的 4 类本体对象**（可产网络/BOM/单价细分/信用档案）→ 交**三类求解判**（交期/齐套/财务）→ 三判合议收敛为**统一结论**（可接 #62BE77 / 提价 X% 接 #E8B54A / 不接 #DD7E9E）+ 对冲条件 → 采纳即生成 Action（C10 审批留痕→工单）。**系统只把"这单能不能接、卡在哪一判、提价几个点能接"摆清楚并可溯源,接不接由计划员拍板。** 三判明细表（交期·产能 / 齐套·MRP / 财务·经营）逐项可读；11 节点 DAG 点击任一节点看判定逻辑/推导公式/输入数据（含来源系统与新鲜度）/本体链/关联规则。

页面顶部双 tier-chip 切换 `订单全链推演`（本 PRD 主体,默认）/ `型号产能推演`（model 面,`renderProjModel`,系统 `ProjectSimView` 已近 1:1,本 PRD 不展开——见 `docs/PRD-order-project-sim-1to1.md`）。

---

## 2. UI 规格（布局 · 像素结构）
### 2.1 整页（`buildOrderView` L3341-3395,容器 `#orderwrap`）
```
┌ rk-top ────────────────────────────────────────────────────────────┐
│ <h3>项目推演</h3>                                                     │
│ rk-sub: "订单全链推演：一次推演 交期(产能) + 齐套(MRP) + 财务(毛利/    │
│   信用/现金)，结论从「缺口 X 万套」升级为「可接 / 提价接 / 不接」。"    │
│ 右 rk-hsel: [AI 对话条 aiBar('proj')]                                 │
│   [tier-chip.on「订单全链推演」][tier-chip「型号产能推演」]            │
│   [rk-basesel「选择订单：」<select min-width:330px>ORDERS 24 option]   │
└──────────────────────────────────────────────────────────────────────┘
[AI 对话面板 aiPanelHTML('proj')（折叠,见 §3.6）]
┌ rk-kpi（6 卡横排,rk-k）───────────────────────────────────────────────┐
│ ① {qty}万套 / {seg}·{model}   ② {可达/紧张} / 交期{MM-DD}（{wk}周）     │
│ ③ {gapT 吨/齐套} / 正极缺口    ④ {rev}亿 / 订单收入                     │
│ ⑤ {m0}% / 毛利率（线{floor}%）⑥【结论框 border 1.5px vc66】{verdict}/推演结论 │
└──────────────────────────────────────────────────────────────────────┘
┌ rk-det「🗺 推演 DAG · 全链引用数据」(副见 §2.3) ──────────────────────┐
│ #odDag: odDagSVG（11 节点 4 层 + 11 条边,viewBox 0 0 1100 H,maxH 430）  │
│ #odDet: odDetHTML（默认 dl-hint；点节点→该节点判定逻辑/公式/输入表/链/规则）│
└──────────────────────────────────────────────────────────────────────┘
┌ grid 1fr 1fr 1fr · gap 14 ────────────────────────────────────────────┐
│ ① 交期·产能关联判(rk-det) │ ② 齐套·MRP 关联判 │ ③ 财务·经营关联判      │
│   table.cmp 5 行           │   table.cmp 5 行   │   table.cmp 5 行       │
└──────────────────────────────────────────────────────────────────────┘
┌ rk-det「推演结论与对冲条件」(副 linkRules"采纳即生成 Action(C10…)") ────┐
│ verdict 框（border vc66 / bg vc10）：<b vc>{verdict}</b> —— {解释文案}   │
│ condH：j.conds.map → rk-sol「⚠ {cond}」 ／ 无条件→dl-hint              │
│ button.fc-go「采纳结论 → 生成工单 Action」/「提交信用例外审批」 + 提示span│
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 6 KPI 卡（`rk-kpi` > 6×`rk-k`,L3353-3360,逐卡精确）
| # | `<b>` 值 | `<b>` 色 | `<span>` 副 |
|---|---|---|---|
| ① 数量×细分 | `{o.qty} 万套` | `#7E8BEE`（固定紫） | `{j.seg} · {o.model}` |
| ② 交期 | `{j.capOK?'可达':'紧张'}` | `j.capOK ? var(--quality) : #DD7E9E` | `交期 {o.due.slice(5)}（{j.wk} 周）` |
| ③ 齐套 | `{j.gapT? j.gapT+' 吨' : '齐套'}` | `j.gapT ? #E8B54A : var(--quality)` | `正极缺口` |
| ④ 收入 | `{j.rev.toFixed(1)} 亿` | `var(--forecast)` | `订单收入` |
| ⑤ 毛利率 | `{j.m0.toFixed(1)}%` | `j.m0>=j.floor ? var(--quality) : #E8B54A` | `毛利率（线 {j.floor}%）` |
| ⑥ **结论框** | `{j.verdict}` | `j.vc` | `推演结论`；卡 `border:1.5px solid {j.vc}66` |

> 颜色变量映射（系统 CSS）：`var(--quality)`≈#62BE77 绿 · `var(--forecast)`≈蓝/收入色 · `#DD7E9E` 红粉(不可达/不接) · `#E8B54A` 黄(风险/提价)。色调可调（§1:1 唯色字可调）,但**绿/黄/红三态语义与阈值不可改**。

### 2.3 推演 DAG 区（`rk-det`,L3361-3363）
- 头 `rk-det-h`：`<b>🗺 推演 DAG · 全链引用数据</b>` + 副 `订单 → 业务建模链 → 三关联判（求解器） → 结论 · 点击任意节点看判定逻辑 / 输入数据 / 来源 / 本体链 / 规则`。
- `#odDag`：`odDagSVG(o,j)` 渲染 11 节点（见 §4.4）。
- `#odDet`（margin-top:8px）：默认 `odDetHTML()` 返回 `dl-hint`「点击 DAG 任意节点 → 查看该节点的判定逻辑、推导公式、输入数据（含来源与新鲜度）、业务建模链与关联规则。」；选中节点后渲染节点详情卡（§2.4）。

### 2.4 节点详情卡（`odDetHTML` L3322-3336,选中态）
左竖线 `border-left:3px solid {n.c}`,依次：
1. 标题：`<b color:n.c>{n.l}</b> <span muted>{n.s}</span>`
2. `节点逻辑：{d.logic}`（lh 1.65）
3. `推导：<code>{d.formula}</code>`（若有 formula）
4. **输入数据表** `table.cmp`：列 `输入数据 | 值 | 来源系统 · 新鲜度`；每行 `{x[0]} | <b>{x[1]}</b> | {x[2]}{DATA_HEALTH[x[2]].detail ? ' · '+detail : ''}`
5. `业务建模链（本体对象路径）：` → `d.chain` 各 `rk-fchip`（边色 #54B5C4,点击 `setView('all')→pickNode(c)` 跳图谱）以 `→` 连。
6. `关联规则：{linkRules(d.rule)}`（C 编号悬停出规则卡）。

### 2.5 三判明细表（grid 1fr/1fr/1fr,L3364-3389,各 `rk-det` + `table.cmp`）
**① 交期 · 产能关联判**（头副"聚合+CTP"）：

| 行 | 值 |
|---|---|
| 可产基地 | `<b>{j.bases.join(' / ')||'—'}</b>` |
| 周需求 | `{j.need.toFixed(1)} 万套/周` |
| P50 周供给 | `<b>{j.wkCap.toFixed(1)}</b> 万套/周` |
| P90 口径 | `{(j.wkCap*0.9).toFixed(1)} 万套/周 {j.capP90?'✓':'<span #E8B54A>风险</span>'}` |
| 判定 | `<b color:capOK?quality:#DD7E9E>{j.capOK?'交期可达':'需对冲'}</b> {linkRules('（C02/C03 口径）')}` |

**② 齐套 · MRP 关联判**（头副"BOM 展开"）：

| 行 | 值 |
|---|---|
| 正极需求 | `<b>{Math.round(j.tons).toLocaleString()}</b> 吨（{BOM_T[o.model]} 吨/万套）` |
| 库存+在途覆盖 | `{(j.cover*100).toFixed(0)}%` |
| 净缺口 | `<b color:gapT?#E8B54A:quality>{j.gapT?j.gapT+' 吨':'无'}</b>` |
| 最早齐套 | `{j.kitDay}` |
| 判定 | `<b color:kitOK?quality:#DD7E9E>{j.kitOK?'齐套可达':'齐套风险'}</b> {linkRules('（C06/C16）')}` |

**③ 财务 · 经营关联判**（头副"财务测算"）：

| 行 | 值 |
|---|---|
| 收入 | `<b>{j.rev.toFixed(1)}</b> 亿（{j.price} 万/套）` |
| 毛利 | `{j.gp.toFixed(2)} 亿 · {j.m0.toFixed(1)}%` |
| 毛利线 C15 | `{j.seg} ≥ {j.floor}% {j.m0>=j.floor?'✓':'<span #E8B54A>未达</span>'}` |
| 信用 C13 | `{j.creditBad?'<span #DD7E9E>超限</span>':'额度内 ✓'}` |
| 现金 C18 | `账期 T+60 · 安全垫达标 ✓`（固定文案,见 §4.7 C18 落地） |

### 2.6 结论与对冲条件区（`rk-det` margin-top:14,L3390-3394）
- 头副：`linkRules('采纳即生成 Action（C10 审批留痕）；条件写入工单')`。
- `verdict` 框（`border-color:{j.vc}66; background:{j.vc}10`）：`<b color:vc>{j.verdict}</b> —— {解释}`,解释三分支（L3391）：
  - `j.creditBad` → `信用红线为阻断级，先解决担保再谈交付。`
  - `j.m0<j.floor` → `提价后毛利达标，交付与齐套{j.conds.length>1?'按下列条件对冲。':'无碍。'}`
  - 否则 → `交期/齐套/财务三判通过{j.conds.length?'，附对冲条件。':'，可直接承诺。'}`
- `condH`：`j.conds.length` → 各 `<div class="rk-sol"><div class="rk-sol-m">⚠ {cond}</div></div>`；否则 `<div class="dl-hint">无对冲条件：三关联判全部直接通过。</div>`。
- 按钮 `fc-go`（padding 8px 20px）：`j.creditBad?'提交信用例外审批':'采纳结论 → 生成工单 Action'`,onclick `adoptOrder(o.so)`；右侧 `#ordAdoptMsg` 提示 span。

### 2.7 跨单超集面板（系统现状保留,非 HTML 元素）
现 `OrderChainView` 的「受影响订单明细表 + 4 类问题归并卡」（`affected_orders`,跨基地视角）作为**单订单推演下方的可选超集面板**保留（折叠默认收起）：选中单订单是 1:1 复刻主体,跨单 4 类归并是系统既有增值,二者并存不冲突。

---

## 3. UX 规格（交互 · 状态 · 流）
| 交互 | 触发（HTML） | 行为 |
|---|---|---|
| 切 tier「订单全链推演」 | `orderMode='order';buildOrderView()` | 渲染订单面（本 PRD） |
| 切 tier「型号产能推演」 | `orderMode='model';buildOrderView()` → `renderProjModel()` | 切型号面（ProjectSimView） |
| **选订单** | select `onchange="orderSelSo=this.value;odSel=null;buildOrderView()"` | 切 SO → 清节点选中 → **重算 order_fullchain 全页**（6 KPI/DAG/三判表/结论实时变） |
| 初始默认单 | `if(!orderSelSo)orderSelSo=ORDERS[3].so` | 默认 **SO-3402**（ORDERS[3],整车厂B·4680-NCM·12 万套·07-02） |
| **点 DAG 节点** | `<g onclick="odPick('{id}')">` | `odSel=toggle(id)` → 重渲 `#odDag`（选中节点描边 2.4px + "已选"角标）+ `#odDet`（详情卡） |
| 节点链 chip 点击 | `rk-fchip onclick="setView('all');pickNode(c)"` | 跳「图谱·全景」并定位该本体对象（跨视图溯源） |
| 规则编号悬停 | `linkRules` 生成 `rule-link onmouseenter` | 出规则卡浮层（C 编号 → RULES_REG） |
| **采纳** | button `onclick="adoptOrder(o.so)"` | 提交 Action（审计 push,ref=C10）→ `#ordAdoptMsg` 显「已写入 Action 并留审计（当前 N 条）」 |
| AI 对话 | `aiBar('proj')`/`aiToggle('proj')` | 展开/收起预设 QA（§3.6） |
| 状态:信用阻断 | `j.creditBad` | 结论框/KPI⑥/jfin/cred 节点全红 #DD7E9E；按钮变"提交信用例外审批"；conds[0]=C13 |
| 状态:毛利未达 | `j.m0<j.floor` | verdict="建议提价 X% 接"黄 #E8B54A；conds 含 C15 提价条目 |
| 状态:交期紧 | `!j.capOK` | KPI②"紧张"红；conds 含"夜班/外协对冲" |
| 状态:齐套缺 | `j.gapT>0` | KPI③黄；conds 含"正极缺口 X 吨…最早齐套 Y" |

> **结论合议优先级（L3251-3258 严格顺序,不可乱）**：`信用阻断(C13) > 毛利提价(C15) > 可接`；在此基础上 `交期对冲(C02/C03)` 与 `齐套对冲(C06/C16)` 作为附加条件追加进 `conds[]`（不改 verdict 文案,只加对冲项）。即 verdict 由财务三闸定档,交期/齐套只补条件。

### 3.6 AI 对话（`aiBar('proj')` / `aiPanelHTML('proj')`,与 dash/audit/gen 同构）
order 页 4 条预设 QA（§4.8）：`这单能不能接 / 为什么要提价 / 卡在哪一判 / 提价几个点能接`,答案取实时 `orderJudge(o)` 数据。`AI_REBUILD.proj='buildOrderView'`（L3459）。

---

## 4. 数据规格（值 + 来源 + 系统字段级落地）
> 前端**零写死**（R14）；所有值来自:①合成种子→物化（ORDERS/MODEL_DEF/价格表）②config/种子参数（阈值 SEG_FLOOR/SEG_PRICE/BOM_T）③求解器口径（orderJudge）④i18n（文案/规则名）⑤ViewDef（11 节点 DAG 结构/边）。每个常量在下表标①-⑤分类。

### 4.1 24 张订单 `ORDERS`（①合成种子 → Order 对象物化,L1558-1583,逐字录）
`T0 = 2026-06-10`（L1584,推演基准日,`dueDay(d)=max(1,round((due−T0)/1天))`）。

| # | so | cust | model | qty(万套) | due | pri |
|---|---|---|---|---|---|---|
| 0 | SO-3391 | 整车厂A | 4680-NCM | 8 | 2026-06-24 | 高 |
| 1 | SO-3402 | 整车厂B | 4680-NCM | 12 | 2026-07-02 | 高 |
| 2 | SO-3415 | 整车厂C | 4680-NCM | 6 | 2026-07-18 | 中 |
| **3** | **SO-3402→实为 SO-3420**（注:默认单是 ORDERS[3]）| 海外车企E | 4680-NCM | 10 | 2026-07-09 | 高 |
| 4 | SO-3431 | 整车厂A | 2170-NCM | 9 | 2026-06-28 | 中 |
| 5 | SO-3437 | 商用车集团G | 2170-NCM | 7 | 2026-07-14 | 中 |
| 6 | SO-3445 | 整车厂B | 方形-NCM | 11 | 2026-07-05 | 高 |
| 7 | SO-3452 | 储能集成商D | 方形-LFP | 14 | 2026-06-30 | 高 |
| 8 | SO-3458 | 电网公司F | 方形-LFP | 18 | 2026-07-12 | 高 |
| 9 | SO-3464 | 储能集成商H | 方形-LFP | 9 | 2026-07-25 | 中 |
| 10 | SO-3470 | 电网公司F | 圆柱-LFP | 6 | 2026-07-08 | 中 |
| 11 | SO-3476 | 储能集成商D | 4680-LFP | 8 | 2026-07-20 | 中 |
| 12 | SO-3481 | 整车厂A | 4680-NCM | 10 | 2026-07-11 | 高 |
| 13 | SO-3486 | 整车厂C | 方形-NCM | 7 | 2026-07-22 | 中 |
| 14 | SO-3490 | 海外车企E | 4680-NCM | 13 | 2026-07-06 | 高 |
| 15 | SO-3495 | 电网公司F | 方形-LFP | 15 | 2026-07-16 | 高 |
| 16 | SO-3501 | 储能集成商H | 方形-LFP | 11 | 2026-07-28 | 中 |
| 17 | SO-3506 | 商用车集团G | 2170-NCM | 8 | 2026-07-19 | 中 |
| 18 | SO-3512 | 整车厂B | 方形-NCM | 9 | 2026-07-03 | 高 |
| 19 | SO-3518 | 储能集成商D | 方形-LFP | 13 | 2026-07-24 | 中 |
| 20 | SO-3523 | 整车厂A | 4680-NCM | 11 | 2026-07-13 | 高 |
| 21 | SO-3529 | 电网公司F | 圆柱-LFP | 7 | 2026-07-10 | 中 |
| 22 | SO-3534 | 海外车企E | 4680-NCM | 12 | 2026-07-27 | 高 |
| 23 | SO-3540 | 商用车集团G | 2170-NCM | 6 | 2026-07-17 | 低 |

> **修正**：`ORDERS[3]` 是 **SO-3420**（海外车企E）——HTML L3343 注释写 `// SO-3402` 是源码笔误（SO-3402 实为 index 1）；初始默认单**以 `ORDERS[3]` 即 SO-3420 为准**（数组下标优先于注释）。下拉 option 文案：`{so} · {cust} · {model} {qty}万套 · {due.slice(5)}`（L3345）。

### 4.2 型号定义 `MODEL_DEF`（①种子 → Model 对象 + 认证关系边,L1542-1548）
| model | chem | pos | bases（可产基地,认证关系） |
|---|---|---|---|
| 4680-NCM | NCM | 动力 | 常州基地·总部 / 成都基地 / 合肥基地 |
| 2170-NCM | NCM | 动力 | 厦门基地 / 武汉基地 / 自贡基地 |
| 方形-NCM | NCM | 动力 | 常州基地·总部 / 成都基地 |
| 方形-LFP | LFP | 储能 | 江门基地 / 眉山基地 / 邯郸基地 / 枣庄基地 |
| 圆柱-LFP | LFP | 储能 | 信阳基地 / 洛阳基地 |
| 4680-LFP | LFP | 动力+储能 | 常州基地·总部 / 枣庄基地 |
- `j.bases = MODEL_DEF[o.model].bases`（决定可产网络节点 + `wkCap` 周供给基数）。

### 4.3 阈值/价格常量（②config / 种子参数）
| 常量 | 值 | 来源行 | 分类 |
|---|---|---|---|
| `SEG_PRICE` 万元/套 | 乘用车 2.2 · 商用车 1.8 · 储能 1.4 | L2379 | ②价格表(PriceList) |
| `SEG_MARGIN` 基准毛利 | 乘用车 0.18 · 商用车 0.15 · 储能 0.13 | L2380 | ②细分毛利基准 |
| `SEG_FLOOR` C15 接单毛利线 % | 乘用车 12 · 商用车 11 · 储能 11 | L3221 | ②阈值(config) |
| `BOM_T` 正极 吨/万套 | 4680-NCM 6.2 · 2170-NCM 5.8 · 方形-NCM 6.0 · 方形-LFP 4.6 · 圆柱-LFP 4.4 · 4680-LFP 4.8 | L3220 | ②BOM 单耗 |
| `ordSeg(o)` 细分判定 | `/商用车/→商用车 ; /储能\|电网/→储能 ; 否则→乘用车` | L2382 | ③口径 |

### 4.4 订单议价/信用覆盖 `ORDER_OVR`（①种子 → Order.ovr,L3222-3229,6 单有覆盖）
| so | mAdj | credit | why（i18n④） |
|---|---|---|---|
| SO-3470 | −3.2 | — | 电网公司F 框架价压价 |
| SO-3437 | — | true | 商用车集团G 在手应收 9.8亿 + 新单 12.6亿 > 信用额度 21亿 |
| SO-3506 | — | true | 商用车集团G 二次追单，叠加在手应收超信用额度 21亿 |
| SO-3458 | −3.0 | — | 电网公司F 框架协议低价，毛利率压至接单线下 |
| SO-3518 | −2.6 | — | 储能集成商D 价格战跟价 |
| SO-3540 | — | true | 商用车集团G 低优先级单，信用额度已被占满 |
> 其余 18 单 `ORDER_OVR[so]={}`（无议价偏移、信用正常）。`creditBad=!!ovr.credit`（3 单不接：SO-3437/3506/3540）；`mAdj<0` 拉毛利下接单线（SO-3470/3458/3518 触发提价）。

### 4.5 求解器口径 `orderJudge(o)`（③核心,L3230-3259,确定性 R6）
> `hashN(s,mod)=Σ(x*31+charCode)%997 然后 %mod`（L1605,纯字符串哈希,无随机/时钟,**R6 同 so 字节一致**）。`dateOf(d)=T0+d 天 → 'MM-DD'`（L1636）。

**① 解构（4 本体对象派生）**
```
seg   = ordSeg(o)                          // 细分
price = SEG_PRICE[seg]                      // 单价 万/套
ovr   = ORDER_OVR[o.so] || {}              // 议价/信用覆盖
bases = MODEL_DEF[o.model].bases           // 可产网络
```
**② 财务测算**
```
m0   = SEG_MARGIN[seg]*100 + (hashN(o.so+'m',5)−2)*0.4 + (ovr.mAdj||0)   // 测算毛利率 %（细分基准±抖动±议价偏移）
rev  = o.qty * price                        // 收入 亿（qty 万套 × 万/套 = 亿）
gp   = rev * m0/100                          // 毛利额 亿
floor= SEG_FLOOR[seg]                        // C15 接单线 %
```
**③ 交期判（产能 CTP,P50/P90）**
```
wk    = max(1, round(dueDay(o.due)/7))       // 交付窗口 周数
wkCap = bases.length*1.6 + hashN(o.so+'c',8)/10   // P50 周供给 万套/周（可产基地数×1.6 聚合 + 抖动）
need  = o.qty / wk                           // 周需求 万套/周
capOK = wkCap >= need                        // P50 达
capP90= wkCap*0.9 >= need                    // P90（健康度折扣）达
```
**④ 齐套判（MRP,正极）**
```
tons  = o.qty * BOM_T[o.model]               // 正极需求 吨
cover = 0.78 + hashN(o.so+'k',18)/100        // 库存+在途覆盖率（0.78~0.95）
gapT  = max(0, round(tons*(1−cover)))        // 净缺口 吨
kitDay= gapT ? dateOf(10+hashN(o.so+'e',9)) : '即时'   // 最早齐套日
kitOK = gapT===0 || dueDay(o.due) >= 12      // 交期≥12 天则缺口可在窗口内齐套
```
**⑤ 信用 + 结论合议（L3251-3258,严格优先级）**
```
creditBad = !!ovr.credit
verdict/vc/conds[] :
  if creditBad:                 verdict='不建议接' ; vc=#DD7E9E
                                conds.push(linkRules('C13 信用额度超限：'+ovr.why+'——除非预付款≥40% 或追加担保'))
  elif m0 < floor:              verdict='建议提价 '+(floor−m0+1).toFixed(1)+'% 接' ; vc=#E8B54A
                                conds.push(linkRules('C15 毛利线：测算 '+m0.toFixed(1)+'% < '+seg+'线 '+floor+'%'+(ovr.why?'（'+ovr.why+'）':'')+'，提价后达标'))
  else:                         verdict='可接' ; vc=#62BE77
  // 追加对冲（不改 verdict）：
  if !capOK:   conds.push('交期紧：P50 周供给 '+wkCap.toFixed(1)+' < 周需求 '+need.toFixed(1)+' 万套 → 需夜班/外协对冲')
  elif !capP90:conds.push('P90 口径交期风险 → 建议预留 1 周缓冲或化成夜班')
  if gapT:     conds.push('正极缺口 '+gapT+' 吨（覆盖 '+(cover*100).toFixed(0)+'%）→ 加急采购，最早齐套 '+kitDay+(kitOK?'（交期内可达）':'（晚于交期！）'))
```
返回 `{seg,price,rev,gp,m0,floor,bases,wk,wkCap,need,capOK,capP90,tons,cover,gapT,kitDay,verdict,vc,conds,creditBad}`（L3259,KPI/三判表/DAG 全取自此）。

### 4.4★ 11 节点业务建模链 DAG（⑤ViewDef 结构 + ③节点态,`odNodes` L3263-3302 / `odDagSVG` L3304）
**结构**：4 层 · 11 节点 · 11 条边（HTML L3309 `E[]` 实为 11 条,roadmap"9 边"表述偏差,以 11 为准）。
```
L0:  so(订单根·#7E8BEE)
L1:  net(可产网络·#54B5C4) bom(BOM展开·#BC9A63) eco(单价与细分·#DF747E) cred(信用档案·动态色)
L2:  jcap(①交期判·动态) jkit(②齐套判·动态) jfin(③财务判·动态)
L3:  vrd(结论·j.vc)
边 E[11]: so→net · so→bom · so→eco · so→cred · net→jcap · bom→jkit · eco→jfin · cred→jfin · jcap→vrd · jkit→vrd · jfin→vrd
```
SVG 常量（L3306-3320）：`W=1100 · NH=46（节点高）· LH=82（层高）· topY=27`；层内 `x=W/(n+1)*(i+1)`,`y=topY+L*82`；节点宽 `min(arr.length>3?198:250, g−12)`；边贝塞尔 C 曲线 stroke `#7C8896` w1.4 op.6 + marker `odar`；选中 `odSel===n.id` → fill `n.c26`(否则`n.c12`) + stroke `n.c` w2.4(否则1.5) + 左上"已选"角标。`max-height:430px`。

**11 节点详情 `det`（每节点 logic/formula/inputs[源系统·新鲜度]/chain[本体对象]/rule,R13,L3266-3301 逐字）**：

| id | l 标题 | s 副 | c 色 | rule |
|---|---|---|---|---|
| so | `{o.so} · {o.cust}` | `{model}·{qty}万套·交期{MM-DD}` | #7E8BEE | C10 字段完整性校验 ✓ |
| net | 可产网络 | `{N}基地·{基地名/}` | #54B5C4 | 认证中产线按 60% 计 |
| bom | BOM 展开 | `正极{tons}吨` | #BC9A63 | C06 / C16 |
| eco | 单价与细分 | `{seg}·{price}万/套` | #DF747E | C15 接单毛利线 |
| cred | 信用档案 | `creditBad?'⚠ 额度超限':'额度内 ✓'` | creditBad?#DD7E9E:#62BE77 | C13 信用校验(+超限·阻断) |
| jcap | ① 交期判 | `capOK?'交期可达':'需对冲'` | capOK?#62BE77:#DD7E9E | C02 / C03 |
| jkit | ② 齐套判 | `gapT?'缺{gapT}吨':'齐套'` | gapT?#E8B54A:#62BE77 | C06 覆盖<5天冻结 / C16 |
| jfin | ③ 财务判 | `{m0}% vs 线{floor}%` | creditBad?红:m0>=floor?绿:黄 | C15 / C13 / C18 |
| vrd | 结论：{verdict} | `conds.length+' 项对冲条件' / '无条件直接承诺'` | j.vc | C10 采纳留痕 |

各节点 `det.logic` / `det.formula` / `det.inputs` / `det.chain` 逐字（HTML L3266-3301,实施须 1:1 录入种子,以下列关键 3 节点示例,余 8 节点同法）：
- **net**（L3270）：logic`按「型号→已认证产线→基地」收敛可产网络：只点亮相关网络，不点亮全部工厂。` formula`可产基地 = MODEL_DEF[{model}].已认证(PLM)` inputs`[型号,{model},PLM][可产基地,{bases.join('、')},PLM][交付窗口,{wk}周,CRM/合同]` chain`型号→产线→基地→认证关系`。
- **jcap**（L3287）：logic`CTP 口径：可产网络周供给（聚合求解器）vs 订单周需求；P90 再打健康度折扣。` formula`周需求={qty}/{wk}={need}；P50 周供给={wkCap}；P90={wkCap*0.9}` inputs`[周供给,聚合求解器（爬坡×检修×认证）,AIP/求解器][数据健康度,IoT 延迟 4.2h → P90 降级,IoT/SCADA]` chain`基地→产线产能→聚合求解器→产能预测`。
- **jfin**（L3294）：logic`三道闸：毛利线 C15 → 信用 C13 → 现金 C18；任一阻断级不过即改写结论。` formula`毛利 {m0}% {≥/<} {seg}线 {floor}%；信用 {超限/达标}；现金垫 58≥50 ✓` inputs`[毛利测算,单价×数量×(1−成本率),FIN/总账·预算][信用,客户额度台账,FIN/总账·预算][现金,滚动13周,决策中台派生]` chain`毛利→应收账款→经营现金流`。
- `det.inputs[*][2]` 来源系统命中 `DATA_HEALTH`（§4.6）→ 追加 `· {detail}` 新鲜度后缀。

### 4.6 DATA_HEALTH 新鲜度映射（①运行态,L1599-1604,节点输入表来源后缀）
| 来源系统 | status | detail（新鲜度,追加进输入表） |
|---|---|---|
| IoT/SCADA | 延迟 | 实时节拍数据延迟 4.2h（采集网关拥塞）→ jcap 节点 P90 降级 |
| CRM/合同 | 正常 | 当日批同步 |
| WMS/ERP | 正常 | 30 分钟内 |
| PLM | 正常 | 当日批同步 |
| FIN/总账·预算 | 正常 |（无 detail,不追加） |
| SRM/长协 / 价格表(CRM) / AIP/求解器 / 决策中台派生 | — | 无 DATA_HEALTH 条目 → 不追加后缀 |

### 4.7 C18 现金闸落地（系统缺口,HTML L3295/L3387 现为固定文案）
HTML 中 C18 在 jfin 节点 formula 与三判③表均为**固定达标态**：`现金垫 58≥50 ✓` / `账期 T+60 · 安全垫达标 ✓`（不随单变）。1:1 复刻**保留固定达标文案**（基线 13 周现金垫 58 ≥ 底线 50,与规划体检/AOP 同源 §R-一致）。结构性升级（`docs/PRD-order-project-sim-1to1.md` 提案）可让 `order_fullchain` 真算"新单账期×金额对 13 周现金垫的占用",但**1:1 验收以 HTML 固定文案为准**,真算为增量非阻塞项。

### 4.8 AI QA（④i18n,order 页 4 预设,答案取实时 orderJudge）
1. `这单能不能接` → `{verdict}`（+ 三判态汇总）
2. `为什么要提价 / 提价几个点能接` → `m0={m0}% < {seg}线 {floor}% → 提价 {(floor−m0+1)}%`
3. `卡在哪一判` → 信用阻断/毛利未达/交期紧/齐套缺 中命中项
4. `这单收入与毛利多少` → `rev={rev}亿 · gp={gp}亿 · m0={m0}%`

### 4.9 采纳 `adoptOrder(so)`（L3396-3399 → 系统 Action）
HTML：`AUDIT.push({t:now,act:'订单全链推演结论采纳 · '+so,who:'计划员 → 生产计划部',ref:'C10'})` + 提示「已写入 Action 并留审计（当前 N 条）」。系统：`POST /a/v1/action-drafts`（C10 留痕→工单 MO / 合同）。

---

## 4★. ★系统字段级落地（现状 → 须改/须加,精确)
> 系统 `OrderChainView` 现仅消费 `affected_orders`（跨基地 4 类问题归并,无单订单三判）。**缺口 = 新求解器 `order_fullchain`（逐单 orderJudge）+ 前端订单中心重建**。

### 4★.1 新求解器 `order_fullchain`（`apps/datacore/src/solvers/risk.ts`,与 `affectedOrders` 并存）
- **入参**：`{ so: string }`（单订单号）。
- **处理**：1:1 实现 `orderJudge`（§4.5 全部公式 + `hashN`/`dateOf` 工具）+ 组装 11 节点 `odNodes`（§4.4★）+ 11 条边。
- **输出**（顶层 key,声明进 `SOLVER_OUTPUT_SHAPES`）：
  ```
  { so, verdict, vc, kpis:{qty,seg,model,capOK,due,wk,gapT,rev,m0,floor},
    judges:{ cap:{bases,need,wkCap,capP90,capOK}, kit:{tons,bomT,cover,gapT,kitDay,kitOK}, fin:{rev,gp,m0,floor,creditBad,cashOK} },
    conds:[string], dag:{ nodes:[{id,layer,label,sub,color,det:{logic,formula?,inputs:[[k,v,src]],chain:[obj],rule}}], edges:[[from,to]] },
    ruleRefs:["C02","C03","C06","C10","C13","C15","C16","C18"] }
  ```
- **确定性 R6**：`hashN` 纯字符串哈希,无 `Math.random`/`Date.now`；`T0` 取种子 `forecastStart`（与 affected_orders 同源,risk.ts 已有 `dayFrom(p.forecastStart,due)`）。
- **注册三处**：`SOLVER_KEYS`（service.ts:17 数组加 `"order_fullchain"`）· `SOLVER_OUTPUT_SHAPES`（:64 加上列顶层 key）· invoke switch（:565 加 `case "order_fullchain": return this.orderFullchain(c, args)`）。

### 4★.2 契约（`packages/contracts/src/solvers.ts`）
- 新 `OrderFullchainOutputSchema = z.object({...})`（与 §4★.1 输出同构,zod 4）；导出类型 `OrderFullchainOutput`。
- 前端 `apps/frontend-shell/src/api/types.ts` 加 `OrderFullchainOutputVM`。

### 4★.3 种子（`apps/datacore/src/synthetic/battery.ts`）
- 把 `ORDER_OVR`（6 单议价/信用,§4.4）、`BOM_T`/`SEG_FLOOR`/`SEG_PRICE`/`SEG_MARGIN`（§4.3）写入 Order 对象 props（`ovr`/`unitPrice`/`bomT`/`segFloor`/`segMargin`）或 solver_params(`orderJudge` 子节点),**前端零写死**。ORDERS 24 单已是 Order 对象（affected_orders 已消费 `o.props.so/cust/model/qty/due/bases`）,补 `ovr`/`pri` 字段即可。
- 阈值 1.6（周供给/基地系数）、0.78（覆盖基线）、抖动系数 → solver_params（可校准,默认 = HTML 值,R6 字节一致）。

### 4★.4 ViewDef（`apps/datacore/src/synthetic/service.ts:1027` `order-chain` layout）
- 扩 `layout`：加 `orderSolverKey:"order_fullchain"` · `odDagEdges:[[so,net],...]`（11 边,⑤结构）· `nodeColors:{so:'#7E8BEE',net:'#54B5C4',...}` · `kpiColors`/`verdictColors:{ok:'#62BE77',raise:'#E8B54A',reject:'#DD7E9E'}` · `defaultOrder`（= ORDERS[3].so / 或留空让前端取首个有效单）。
- 去前端硬编码：`OrderChainView` 的 `SEG_COLOR`(L17)/`CHAIN_COLORS`(L29)/`CHAIN_TITLES`(L30) 全部移入 ViewDef.layout（现已部分 `view.layout?.segColors` 兜底,补全 11 节点结构）。

### 4★.5 前端重建（`OrderChainView.tsx`）
现 262 行（4 类归并）→ 重构为订单中心：
1. **订单选择器**（`<select>`,选项来自 `order_fullchain` 可选单列表 / 或独立 `GET /a/v1/orders` 轻查询）→ `useLiveSolver("order_fullchain",{so})` 即时算。
2. **6 KPI 卡**（§2.2）每卡 `Provenance` 溯源（复用现 `Provenance` 组件,L110/126）。
3. **11 节点 `<ProvenanceDag>`**（复用/扩 `LayeredDag` 支持 4 层 + 节点点击抽屉 `odDetHTML` 等价：logic/formula/inputs 表/chain chip/rule）。
4. **三判明细表 ×3**（grid 1fr/1fr/1fr,§2.5）。
5. **结论与对冲区**（verdict 框 + conds + 采纳按钮 → `useActionDraft` POST action-drafts,C10）。
6. **下方超集面板**：现 affected_orders 4 类归并折叠保留（§2.7）。
- 全部文案入 `locales/zh`（`zh.orderChain.*` 已部分在,补 verdict/三判/节点文案）。

---

## 5. 契约 / 端点
- `contracts/solvers.ts`：新 `OrderFullchainOutputSchema`（§4★.2）；`affected_orders` 输出不变。
- `service.ts`：`SOLVER_KEYS`+`SOLVER_OUTPUT_SHAPES`+invoke switch 三处注册 `order_fullchain`。
- 端点：
  - `POST /a/v1/solvers/order_fullchain/invoke`（body `{so}`,useLiveSolver 选单即时重算）
  - `POST /a/v1/solvers/affected_orders/invoke`（跨单超集面板,既有）
  - `POST /a/v1/action-drafts`（采纳 → C10 留痕 → 工单/合同 / 信用例外审批）
  - （可选）`GET /a/v1/orders`（订单选择器选项；或从 affected_orders/order_fullchain 派生单列表）

---

## 6. 融合集成点（5 处,不绕过）
1. Renderer `registry.ts:50`（`order-chain` 已注册 → import OrderChainView）。
2. ViewDef `synthetic/service.ts:1027`（layout 扩 orderSolverKey/11 节点结构/色）。
3. Feature `features.ts:25/88`（`view.order-chain` 已在 defaultOn:true）。
4. 导航 ShellLayout（推演组 / base_manager 角色子集含 order-chain,service.ts:1073）。
5. 场景启动器（`order_fullchain_*` intents → 场景入口可选）。
**复用现有 OrderChainView 容器,重建内容、增 order_fullchain,不另注册 renderer。**

---

## 7. 验收（DoD = 真 1:1）
- **像素核对**（与 HTML order 页并排,逐元素勾）：rk-top 标题+sub · 双 tier-chip · 订单选择器（24 option,默认 ORDERS[3]=SO-3420）· **6 KPI 卡（含结论框三色 #62BE77/#E8B54A/#DD7E9E）** · **11 节点 DAG（4 层 11 边）+ 节点点击详情（logic/formula/输入表[来源·新鲜度]/链 chip/规则）深度=HTML odDet** · **三判明细表 ×3（交期 5 行/齐套 5 行/财务 5 行,含 C18 现金行）** · 结论框（vc66 边 + 解释三分支）+ conds rk-sol · 采纳按钮（creditBad 变"提交信用例外审批"）。**结构/值/字符串/交互全一致**（色/字可不同）。漏一项不过。
- **交互**（逐项 FDE 亲手跑）：换单实时重算 6 KPI/DAG/三判/结论 · 点 DAG 节点出详情+"已选"角标 · 节点链 chip 跳图谱 · 规则编号悬停出卡 · 采纳出 Action+提示 · 验证 4 个代表单：**SO-3420 可接 · SO-3458 提价接（mAdj−3.0）· SO-3437 不接（信用阻断）· 交期紧/齐套缺单出对冲条件**。
- **数据**：前端零写死（`debattery:check` 过,SEG_COLOR/CHAIN_* 移入 ViewDef）· 种子值=HTML 精确（ORDERS/ORDER_OVR/BOM_T/SEG_FLOOR/SEG_PRICE/SEG_MARGIN）· **同 (so,seed) 字节一致（R6,`hashN` 重跑同值）** · 每数可溯（R13,11 节点 inputs 表）· orderJudge 公式与 HTML 同值（逐单 verdict/m0/wkCap/gapT 抽样核对）。
- `pnpm -r build && test` 全绿（新增 order_fullchain 单测 + order-chain 前端回归）；`chain:check`（order_fullchain 注册 + 11 节点链路 + ruleRefs C02/C03/C06/C10/C13/C15/C16/C18）/`ontology:check` 过。
- 回写本体 §2.E（Solver order_fullchain）/§3（订单全链推演链路）/§7（chain:check 新条目）。

---

## 8. 实施任务（研发可直接拆）
1. **种子**（battery.ts）：ORDERS 24 单补 `ovr`(ORDER_OVR 6 单)/`pri`/`unitPrice`(SEG_PRICE)/`bomT`(BOM_T) props；SEG_FLOOR/SEG_MARGIN + 周供给系数 1.6/覆盖基线 0.78/抖动 → solver_params（默认=HTML 值）。
2. **契约**（solvers.ts）：`OrderFullchainOutputSchema`（verdict/vc/kpis/judges{cap,kit,fin}/conds/dag{nodes,edges}/ruleRefs）+ 前端 VM 类型。
3. **求解器**（risk.ts）：`orderFullchain(c,args)` 1:1 实现 orderJudge（§4.5）+ odNodes 11 节点 det（§4.4★,inputs 追加 DATA_HEALTH 新鲜度）+ 11 边；纯确定性。
4. **注册**（service.ts）：SOLVER_KEYS + SOLVER_OUTPUT_SHAPES + invoke switch 三处加 order_fullchain。
5. **ViewDef**（synthetic/service.ts:1027）：order-chain layout 扩 orderSolverKey/odDagEdges(11)/nodeColors/verdictColors/defaultOrder；去前端 SEG_COLOR/CHAIN_* 硬编码。
6. **前端**（OrderChainView.tsx）：重建为订单中心——订单选择器 + useLiveSolver(order_fullchain) + 6 KPI(Provenance) + 11 节点 DAG(LayeredDag 4 层 + 节点抽屉 odDet 等价) + 三判明细表 ×3 + 结论框/conds/采纳(useActionDraft C10) + 下方 affected_orders 4 类超集面板保留。
7. **i18n**（locales/zh）：verdict 文案/三判表头/11 节点 logic·formula·chain·rule/AI QA 4 预设 逐字入 `zh.orderChain.*`。
8. **测试**：order_fullchain 单测（SO-3420 可接 / SO-3458 提价接 / SO-3437 不接 / 交期紧 / 齐套缺,断言 verdict/m0/gapT/conds 数 + R6 重跑字节一致）；order-chain 前端回归（选单/换单/点节点/采纳 testid）。

> **诚实声明（不确定项）**：① HTML L3343 注释 `// SO-3402` 与 `ORDERS[3]`（实为 SO-3420）矛盾,本 PRD 以数组下标 SO-3420 为准（§4.1）。② C18 现金闸在 HTML 中为固定达标文案（非真算）,1:1 验收以固定文案为准,真算为增量（§4.7）。③ roadmap"9 边"与 HTML `E[]` 11 边不符,以 HTML 11 边为准（§4.4★）。④ `wkCap=bases.length*1.6+...` 为示意聚合（HTML L3239 自注"示意"）,周供给口径与产能推演 capacity_forecast 严格同源需在 order_fullchain 内对齐（R-一致,落地时若两者数值差异需以 capacity_forecast 为权威重映射,本 PRD 1:1 阶段保留 HTML 示意式）。

> **这是工业级深度的 order 视图工业 PRD**（UI 布局 + UX 交互 + 数据字段级落地 + 融合点 + 验收）。结构性提案与 model 面（型号产能推演）见 `docs/PRD-order-project-sim-1to1.md`；索引见 `docs/PRD-verbatim-1to1-replication.md §2` / `docs/PRD-reference-views-1to1-roadmap.md`。
