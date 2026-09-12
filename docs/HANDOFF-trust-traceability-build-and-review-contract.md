# HANDOFF ③ · 全域可信溯源交互（施工/评审合同）

> **三 HANDOFF 之三**（①板块对齐=轨M ②主题开关 ③本份）。**先做本份**（可信是地基,且与假推演同源）。
>
> **一句话目标**：界面上**每一类展示数据都能就地溯源→建立信任**,且**下钻不死路**。**融合优先**:接现有 `RuleRef`/`Provenance`/`DagNodeDrawer`(基建已全),扩一层规则 provenance,**禁前端编造/禁新建并行**。
>
> **读这两份再动手**：`SPEC-trust-traceability-interaction.md`(原则+数据类→交互→接/扩/换全表)、`AUDIT-fake-simulation-inventory.md`(溯源弹窗的数据**必须真**,别把假数据包成"可溯源"的样子)。

---

## 0. 先读什么

1. **铁律0** `SYSTEM-ONTOLOGY.md`：本份触 **R13(结论可溯源,核心)** / **G-10(规则一等引用)**;扩规则 provenance 字段→回写本体。
2. **SPEC-trust**(交互全表)+ **AUDIT-fake-simulation**(溯源内容须真,不可包装 mock)。
3. **增量0 先做**：全仓审计"裸渲染规则号/数字/风险点"+"下钻死路"清单,实拍取证,只看不改。
4. `.claude/skills/fde-delivery`：完成=亲手悬浮/点穿走一遍,不是测试绿。

---

## 1.《现状 ↔ 设计》（融合优先 · 基建已全 · 大头是"接全"+"扩一层"）

| 数据类 | 现状(已建·锚点) | 缺 | 融合决策 | 真值判据 |
|---|---|---|---|---|
| 规则号 C0x | `RuleRef.tsx` 已建好用(弹 表达式/作用域/严重级/版本/阈值,从 `fetchRules`) | 没接全(`OrderChainView.tsx:465-467` `ruleRefs.join` **裸文本**)；**无 谁设定/设定时间/有效边界** | **接** RuleRef 到所有规则号渲染点；**扩** Rule += `definedBy/definedAt/effectiveFrom/effectiveTo/basis` | 任意板块任意位置的 C0x 悬浮出 定义/阈值/作用域/版本 **+ 谁设定·设定时间·有效边界** |
| KPI/数字 | `Provenance.tsx` 已建(公式/输入/来源/新鲜度) | 没接全到每个数字 | **接** Provenance；来源/新鲜度字段不足则**扩**求解器输出 | 任意 KPI 悬浮出 公式+输入+来源系统+新鲜度 |
| 判定/verdict | `EvaluatedRules.tsx`;求解器 `evaluatedRules`(`solvers.ts:50` 带 expression/evidence) | evidence 未必填全 | **接** EvaluatedRules + evidence | 点 verdict 看依据哪条规则+哪些输入触发 |
| 风险点(基地·因素·越线日) | `RiskPopover.tsx` 已建(悬浮部分信息) | 缺"详情"弹窗(逐工序细节) | **接** `bottleneck_matrix`/`risk_timeline` 已算输出进详情弹窗 | 风险点旁"详情"按钮→弹窗出该基地瓶颈工序逐项 |
| DAG 节点 | `DagNodeDrawer`(`ProjectSimView.tsx:1122` 已建:逻辑/公式/输入/本体链/规则) | 未复用到驾驶舱/规划 DAG | **接**:复用 DagNodeDrawer 到所有 DAG | 任意 DAG 节点点穿出溯源抽屉 |
| 下钻导航 | `DashboardView.tsx:199` `navigate("/v/order-chain")` 路由跳转 | **无回退=死路** | **接**:改 modal(保上下文)或加面包屑,数据不动 | 逐单下钻进得去**也回得来** |

> **铁证**:`OrderChainView.tsx:465-467` 把规则渲染成 `ruleRefs.join("/")` 裸文本——这就是用户"C02 悬浮无信息"的根。换成 `<RuleRef>` 立即有(组件现成)。

---

## 2. 增量（串行 · 每增量一 PR）

- **增量0（零代码·审计取证）**：全仓 grep "裸渲染规则号(未包 RuleRef)/裸数字(未包 Provenance)/下钻 navigate 无回退"清单,实拍现状,存 `docs/evidence/traceability-baseline.md`。只看不改。
- **增量1（接全·零后端改）**：① 所有裸规则号换 `<RuleRef>`(`OrderChainView` 三处起,全仓扫尽)② 关键数字接 `<Provenance>` ③ 下钻改 modal 或加面包屑(去死路)④ DagNodeDrawer 复用到驾驶舱/规划 DAG。**纯接现成组件,不动后端。**
- **增量2（扩后端·规则 provenance）**：Rule 对象 += `definedBy/definedAt/effectiveFrom/effectiveTo/basis`;`fetchRules` 透出;RuleRef 弹窗增"由 ___ 于 ___ 设定 · 有效区间 ___ · 依据 ___"。**诚实**:种子规则 `definedBy` 标"系统治理基线 vX",**不编造人名**;`basis` 标真实出处。回写本体。
- **增量3（风险详情 + 门）**：① 风险点加"详情"弹窗接 `bottleneck_matrix` 逐工序 ② 加 `traceability:check` 门(静态扫裸渲染规则号/数字防回潮),并入 `pnpm gates`。

---

## 3. 红线（破一条即打回）

1. **无不可溯源的展示数据**：界面每一类数据(数字/规则/判定/风险点/DAG节点)必须挂其溯源交互;新增渲染点缺溯源=打回。
2. **无下钻死路**：任何 drill/跳转要么 modal(保上下文)要么带回退/面包屑。
3. **溯源数据必真**：弹窗内容**接现有后端真值**,**禁前端写死/编造**(承 AUDIT-fake-simulation:别把 mock 包成"可溯源");规则 provenance 诚实(种子标系统基线,不假装有人签字)。
4. **融合接/扩/换 · 禁新建并行**：接现成 RuleRef/Provenance/DagNodeDrawer;扩须回写本体。
5. **FDE**：完成=亲手悬浮/点穿/下钻走一遍+实拍,不认测试绿。

---

## 4.《本体引用与影响》

- **不变量**：**R13 结论可溯源**(本份是 R13 在交互层的落地;扩到规则 provenance)。
- **断点**：**G-10**(规则一等→RuleRef 接全 + provenance)。
- **对象**：Rule += provenance 字段(definedBy/definedAt/effectiveFrom/effectiveTo/basis)→回写 §2 对象。
- **门**：新增 `traceability:check`→回写 §7。

---

## 5. 评审协议（我怎么验）

- **两轴**：轴1 对 §1 表逐行;轴2 对 demo 真态(真值判据)。
- **FDE 真跑**：我亲手 → ① order-chain 的 C02 悬浮**必须**出规则详情(含谁设定/时间/边界)② 抽查任意板块规则号/数字均可溯 ③ 风险点"详情"出真逐工序 ④ 逐单下钻能回退 ⑤ 抽查溯源弹窗数字**能对到后端真值**(非编造)。
- **判定**：任一红线破/真值判据不达=打回;**发现把 mock 包成"可溯源"=打回**。

---

## 6. 完成判据（FDE · 用户视角）

demo 真跑:**所见皆可溯**——任意位置看到 C0x→悬浮出定义/阈值/作用域/版本/谁定/时间/边界;任意 KPI→公式/输入/来源/新鲜度;风险点→详情弹窗逐工序;逐单下钻→进得去回得来;且每个溯源弹窗数字**对得到后端真值**。用户对每个数字都能"点一下知道凭什么信它"。

---

## 7. 禁止清单

❌ 裸渲染规则号/数字 ❌ 下钻死路 ❌ 溯源弹窗里放前端编造/mock 数(把假包成可溯源) ❌ 新建第二套展示组件(该接 RuleRef/Provenance/DagNodeDrawer) ❌ 规则 provenance 编造作者(种子诚实标系统基线) ❌ 代码先行本体不回写 ❌ 测试绿冒充能用。

> 契约生效：从增量0 起逐增量提 PR,我逐 PR 按 §5 评审。有疑义先问,越红线先停。
