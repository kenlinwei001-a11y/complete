# SPEC · 全域可信溯源交互层（每个展示数据都可溯源→建立信任 · 融合优先）

> **原则（用户立）**：**界面上每一个展示给用户的数据,对用户都存在"可信性"疑问**(这数字哪来的?这规则谁定的、还有效吗?这风险怎么算的?)。**必须通过交互让用户能就地溯源,形成信任。** 且**下钻不能是死路**(进得去出不来)。
>
> **融合优先(承上一条红线)**:每个溯源交互的数据**必须接现有后端能力**(规则库/求解器 provenance/R13 lineage),**接/扩/换三选一,禁前端编造、禁新建并行**。
>
> **关键发现(摸真代码)**:系统的溯源基建**比想象的全**——`RuleRef`/`Provenance`/`DagNodeDrawer`/`RiskPopover` 都已存在且好用。问题是**没接全**(部分渲染点裸文本)+ **缺一层后端 provenance**(规则无"谁定/何时/边界")。所以这份 SPEC 大头是"**接**"和"**扩**",不是重做。

---

## 1. 现状摸底（已有什么 · 缺在哪）

| 溯源组件 | 现状 | 锚点 | 显示什么 |
|---|---|---|---|
| `RuleRef` | ✅ 已建好用 | `components/RuleRef.tsx` | 悬浮弹 规则 key/name/严重级/版本/表达式/阈值params/作用域(从 `fetchRules` 真取) |
| `Provenance` | ✅ 已建 | `components/Provenance.tsx` | 数字的 公式/输入/来源系统/新鲜度(降级标) + 内嵌 RuleRef(两跳:数字→规则→规则详情) |
| `DagNodeDrawer` | ✅ 已建 | `ProjectSimView.tsx:1122` | DAG 节点点穿:判定逻辑/公式/输入表(值·来源·新鲜度)/本体链/关联规则 |
| `RiskPopover` | ✅ 已建 | `components/RiskPopover.tsx` | 风险 chip 悬浮(部分信息) |
| `EvaluatedRules` | ✅ 已建 | `components/EvaluatedRules.tsx` | 规则闸门 PASS/WARN/BLOCK + ruleSetVersion |

**缺口(本 SPEC 要补的)**:
- **R13a 没接全**:`OrderChainView.tsx:465-467` 三关联判的规则列是 `ruleRefs.join("/")` **裸文本**(C02 悬浮无反应)——`RuleRef` 没接进来。**全仓需审计所有"裸渲染规则号/数字/风险点"的渲染点**。
- **R13b 后端缺规则 provenance**:Rule 对象有 expression/severity/version/params/scope,**无 createdBy/createdAt/有效边界**(用户要"谁设定·设定时间·使用边界"判规则有效性)。
- **R13c 下钻死路**:`DashboardView.tsx:199` `navigate("/v/order-chain")` 路由跳转无回退;`:145` 问题卡同样跳走。
- **R13d 风险点详情浅**:`RiskPopover` 悬浮只给部分,缺"详情"弹窗(基地瓶颈工序细节)。

---

## 2. 数据类 → 必备溯源交互 → 融合决策（接/扩/换）

> **铁律**:界面上**每一类展示数据**都必须挂它的溯源交互;每个交互**接现有后端**。

| 数据类(界面上出现的) | 必备交互 | 数据来自(现有后端) | 融合决策 |
|---|---|---|---|
| **KPI/数字**(八卡/聚合/综合毛利率) | 悬浮 `Provenance`:公式+输入+来源系统+新鲜度 | `metric_rollup`/求解器输出 + R13 lineage | **接** `Provenance` 到所有数字;来源/新鲜度字段不足则**扩**求解器输出 |
| **规则引用**(C01–C33) | 悬浮 `RuleRef`:定义/阈值/作用域/严重级/版本 **+ 谁设定/设定时间/有效边界** | 规则库 `fetchRules`(已含定义);**provenance 字段缺** | **接** RuleRef 到所有规则号渲染点;**扩** Rule 对象 += `definedBy/definedAt/effectiveFrom/effectiveTo/basis` |
| **判定/verdict**(可接/提价接/不接·PASS/WARN/BLOCK) | 点开看:依据哪条规则+哪些输入触发该判定 | `EvaluatedRules` + 求解器 evaluatedRules(`solvers.ts:50` 已带 expression/evidence) | **接** EvaluatedRules + evidence 字段;evidence 空则**扩**求解器填 |
| **风险点**(基地·因素·越线日) | 悬浮给摘要 + **"详情"按钮→弹窗**:该基地瓶颈工序逐项细节 | `bottleneck_matrix`(基地×7因素)/`risk_timeline` 已算 | **接** 现有求解器输出进详情弹窗;逐工序粒度不足则**扩**输出 shape |
| **DAG 节点**(根因/推演链) | 点穿 `DagNodeDrawer`:逻辑/公式/输入/本体链/规则 | 已建(ProjectSim) | **接**:把 `DagNodeDrawer` 复用到驾驶舱/规划的所有 DAG |
| **聚合数**(综合毛利率/Σ勾稽) | 展开看逐项贡献勾稽闭合 | 毛利勾稽求解器(见 AUDIT §1) | **扩/换**现有 `margin_attribution`(先判能否扩) |

---

## 3. 用户报的三个具体问题 · 处置（含融合）

### 3.1 逐单下钻无回退(R13c) — 改导航壳
- **症状**:`DashboardView.tsx:199`/`:145` 路由跳 `/v/order-chain` 无回退,死路。
- **处置**(二选一,**推荐 A**):
  - **A 弹窗式下钻**(推荐):台账行点击→**modal 叠加在驾驶舱上**展示订单全链聚合,关闭即回原位、保上下文。适合"看详情"型下钻。数据仍接 order-chain 求解器,只换外壳。
  - **B 面包屑/回退**:若坚持整页跳转,目标页顶加面包屑(驾驶舱 › 订单全链聚合 › SO-xxxx)+ 返回按钮。
- **融合**:**接**——数据来自现有 order-chain,只改导航壳;不动后端。
- **红线(立)**:**任何下钻都不得是死路**——要么 modal(保上下文)要么带回退/面包屑。

### 3.2 规则号悬浮无信息(R13a+R13b) — 接 RuleRef + 扩后端 provenance
- **症状**:`OrderChainView.tsx:465-467` `ruleRefs.join("/")` 裸文本,C02 悬浮无反应。
- **处置**:
  - **接**:把所有 `ruleRefs.join("/")` 式裸渲染换成 `<RuleRef code={...} />`(`OrderChainView` 三处 + 全仓审计其余裸渲染点)。RuleRef 现成,立即弹 表达式/作用域/严重级/版本/阈值。
  - **扩(后端)**:Rule 对象增 **`definedBy`(谁设定·诚实标"系统种子/治理基线"非编造作者)、`definedAt`(设定/版本时间)、`effectiveFrom/effectiveTo`(有效边界)、`basis`(设定依据/出处)**;`fetchRules` 透出;RuleRef 弹窗增"由 ___ 于 ___ 设定 · 有效区间 ___ · 依据 ___"。**这是用户判"规则是否有效"的核心,不补则可信性闭不上。**
- **融合**:接(组件)+ 扩(后端 provenance 字段),**不新建规则展示组件**。

### 3.3 风险点详情浅(R13d) — 接求解器输出进详情弹窗
- **症状**:`RiskPopover` 悬浮只给部分,缺逐工序细节。
- **处置**:风险点(基地·因素·越线日)悬浮摘要旁加 **"详情"按钮 → 弹窗**:该基地瓶颈工序逐项(工序/负载率/OEE/良率/在途时效/换型占用…)+ 逐日传导曲线 + 驱动事件。
- **融合**:**接** `bottleneck_matrix`(基地×7因素已算)+ `risk_timeline`(逐日)的现有输出;逐工序粒度不足则**扩** shape,不新建风险引擎。

---

## 4. 后端融合清单（扩的部分 · 回写本体）

| 扩什么 | 在哪 | 为什么(可信性) | 本体 |
|---|---|---|---|
| Rule += `definedBy/definedAt/effectiveFrom/effectiveTo/basis` | 规则契约 + 种子 + `fetchRules` | 用户判规则有效性需"谁定/何时/边界/依据" | R13 溯源延伸到规则层;G-10 规则一等 |
| 求解器输出补 `sourceSystem/freshness` | 相关求解器输出 shape | KPI 数字的来源系统/新鲜度溯源 | R13;C09 新鲜度降级 |
| 瓶颈逐工序粒度(若不足) | `bottleneck_matrix` 输出 | 风险点详情逐工序 | R13 |
| 毛利逐单贡献勾稽 | 先判 `margin_attribution` 能否扩 | 聚合数可溯到逐项 | 见 AUDIT §1 |

> **诚实红线**:规则若是系统种子定义的,`definedBy` 就诚实标"系统治理基线 vX",**不编造人名**;`basis` 标真实出处(PRD/治理规则集)。可信 = 真相可溯,不是假装有人签字。

---

## 5. 红线 + 审计门

1. **无不可溯源的展示数据**:界面上每一类数据(数字/规则/判定/风险点/DAG节点/聚合)**必须挂其溯源交互**;新增渲染点缺溯源 = 打回。
2. **无下钻死路**:任何 drill/跳转要么 modal(保上下文)要么带回退/面包屑。
3. **溯源数据必真**:弹窗内容**接现有后端真值**(规则库/求解器/lineage),**禁前端写死/编造**(违则同 PropagationTimeline 写死系数老坑)。
4. **接/扩/换**:每个溯源点先判能否**接**现有组件/后端;要**扩**须回写本体;**禁新建并行**展示组件。
5. **静态门(建议)**:加 `traceability:check`——扫规则号/KPI 裸渲染(未包 RuleRef/Provenance)报警,防回潮。

---

## 6. 真值判据（FDE · 验收对它）

用 demo 真跑,以用户视角:
- 在**任意板块任意位置**看到 `C0x` → 悬浮**就地弹**规则定义/阈值/作用域/版本 **+ 谁设定·设定时间·有效边界**(order-chain 的 C02 不再哑)。
- 看到任意 **KPI 数字** → 悬浮出 公式/输入/来源系统/新鲜度。
- 看到**风险点** → 点"详情"弹窗出该基地瓶颈工序逐项细节(真来自求解器)。
- **逐单下钻** → 进得去**也回得来**(modal 关闭回原位 / 或面包屑返回)。
- 抽查任一溯源弹窗的数字 → **能对到后端真值**(非前端写死)。

---

## 7. 与现有工作的关系

- 本 SPEC 是 `AUDIT-three-boards-vs-design-master-alignment.md` 的**横切补充**(把"provenance 富度"从一句话升级成全域交互层 + 融合清单)。
- 落地建议拆 HANDOFF 时,**每份 §1 追溯表强制带"溯源交互 + 接/扩/换"列**(承融合第7轴)。
- 复用而非重写:`RuleRef`/`Provenance`/`DagNodeDrawer` 全接现成。
