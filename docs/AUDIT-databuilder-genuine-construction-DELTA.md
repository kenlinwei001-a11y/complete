# AUDIT · 数据构建发动机「真构建 vs 盖预制件」· 增量对账（DELTA）

> **这份是什么**：对「数据构建发动机」做一次**真起服务、真跑 10 场景脚本**的对抗式审计——核心问题：它产出的每一类制品，是**真从数据/字段/关系派生生成**的（如同客户真实导入），还是**盖一个预制件让闭包能过、矩阵能 +1**？
> **定位（钉死·防误读）**：本文是**增量 DELTA**，**不覆盖、不推翻**既有 `docs/TODO-fde-build-engine.md`（北极星靶）与 `docs/HANDOFF-comprehend-engine-build-and-review-contract.md`（H3·摸底合同）。既有文档已记录的（LLM comprehend / 富多跳切片 / 值域合成）本文只**引用不重复**；本文只贡献**3 个既有文档未记录的新洞** + 一处 UX 叙事收口。H3 明确"照 stale TODO 从零重写=红线级打回"——本文遵守该纪律，只**补漏**。
> **方法**：origin `8f8f161` worktree，内存模式 + SEED_DEMO=1 + **无 LLM key（故全程走确定性关键词地板 comprehendScript）**，datacore(4101)+agentcore(4102) 真互配。10 脚本真打端点、逐值对照。证据均 `file:line`。
> **状态**：审计稿待审。

---

## §0 本体引用与影响（铁律 0）
- **对象类型**（§2）：`BuildPlan`/`ClosureReport`/`SliceSpec`/`Rule`/`ValidationTrace`/`StoryBuildRun`（§2.B/§2.E·`contracts/databuilder.ts`）· B 栈 `Intent/ExecutionPlan/Workflow/Skill/Agent/Scenario`（§2.H）。
- **链路**（§3）：数据构建发动机链 故事→comprehend→BuildPlan→transform→closure→publish；本审计定位其中"派生真实性"断点。
- **不变量**（§5）：**R11 全链闭包 / R12 双向闭包**（本审计发现闭包判据被空壳满足）· **R13 溯源**（发现 ValidationTrace 盖 PASS 章）· **KILL-MOCK-RED**（"产物在但空/写死冒充真派生"= 本审计红线）· R6（地板确定性·真）· R16（倒序发育）。
- **断点**（§8）：拟登 **G-BUILD-SHELL**（闭包只验"对象有 domain"、不验切片非空/paths→空壳满足闭包）· **G-BUILD-VERIFY**（ValidationTrace 逐条写死 PASS·不查真值）。
- **回写**：治本 WO 落地后登 §8 两断点并标闭；§7 若加 green→red 门则登记。跑 `pnpm ontology:slices`。

---

## §1 既有文档已覆盖的（本文引用·不重复立项）

| 我真跑发现 | 既有文档已记 | 不重复 |
|---|---|---|
| comprehend 关键词地板 = 7 实体封闭词表（Order/Base/Line/Process/Equipment/Material/Customer），非电池故事静默降级、兜底 Order+Base | `TODO-fde §2`（LLM comprehend 大脑）+ H3（引擎主体已建·收 3 断点） | ✅ 已覆盖·引用 |
| 切片单根、`hops:[]`、无多跳 | `TODO-fde §2/§3`（富切片/多跳切片规划器 BFS） | ✅ 已覆盖·引用 |
| 合成数据 hash 编数、值域不真 | `TODO-fde §2`（拟真值域合成） | ✅ 已覆盖·引用 |
| 存在真"从数据派生"路 A3 `deriveModelingSuggestion`（column→PropertyDef/FK→LinkType/主键=唯一率≥0.95） | `modeling.ts:85` + `HANDOFF-modeling-lowcode-pipeline` | ✅ 已存在·故事发动机未接（见 §2 洞3 治法） |

**结论**：真伪构建问题的**理解层与切片层，既有 TODO/H3 已立靶**。本文只补下面 §2 的**三个未被任何文档记录的、更深一层的洞**。

---

## §2 三个新洞（既有文档未记录 · 均 origin 源码坐实 · green→red 可自证）

### 洞 A · 规则是预制固定表达式，不从字段/故事阈值生成 —— CONFIRMED
- **现状**：`comprehend.ts:484 const RULES` 是一张**关键词→固定表达式**表：`C03 "Order.demandDelta <= 0.5"`、`C05 "Line.utilization > 95"`（`:485/:487`）。规则由 `matches(script, r.keywords)` 命中，**表达式与阈值全写死**。
- **失败场景**：故事说"月产能 2 万套、利用率超 95% 告警"——引擎**不会**生成 `capacity <= 20000`，只会命中关键词盖一条 `demandDelta<=0.5`（与故事数字无关）。换域（冷链"4 小时时效"）→ 无匹配关键词 → **0 规则**，却不报"我没为你的阈值建规则"。
- **判据（green→red）**：给一个含明确数值阈值但关键词不匹配的故事 → 应生成对应规则；现状产 0 规则且 closure 不报缺 → 红。
- **锚点**：`comprehend.ts:484-487`（RULES 表）· `comprehend.ts:268/670`（`RULES.filter(matches...)`）。

### 洞 B · B 栈 6 件是"每求解器一模板 fan-out"，非从故事编排派生 —— CONFIRMED
- **现状**：`comprehend.ts:283 deriveBStack` 对每个 solverNeed **机械 fan-out 6 个固定形状壳**：
  - plan `steps:["invoke_solver","render"]`（`:285`）· workflow **同样** `["invoke_solver","render"]`（`:288`）——**plan 与 workflow 恒等两步、无条件/无编排**；
  - intent `slots:[]`（`:286`·无槽位抽取）· skill `resources:[]`（`:289`·空壳）· agent `systemPrompt:"针对 X 的推演分析 agent"`（`:290`·模板串）。
- **失败场景**：故事无论多复杂（多步、有分支、需澄清），产出的 workflow 永远是"调求解器→渲染"两步；agent 永远是同一句模板 prompt。**"为匹配故事新增了 workflow/agent"在矩阵上 +1，但那个 workflow/agent 是空的。**
- **判据**：两个复杂度悬殊的故事 → deriveBStack 产出的 workflow.steps/agent.systemPrompt **逐字节相同（除 solverKey）** → 证模板非派生 → 红。
- **锚点**：`comprehend.ts:283-291`。

### 洞 C · 闭包被"空壳"满足：只验"对象有 domain"，不验切片非空/字段真消费 —— CONFIRMED（最深一层）
- **现状**：`closure.ts:27` 判"对象落切片"的判据是 **`const sliced = !!t.domain && t.domain !== "unassigned"`**——**它根本不读 SliceSpec、不读 paths**，只看对象类型有没有 `domain` 字段。而 domain 是 comprehend 出厂就带的（`EntityTemplate.domain`）。
  - → `registerStorySlices`（`service.ts:1225`）落的是 `paths:[]` 空切片；但 closure 的 `objectsBound++` **与切片是否为空、是否真能解析出子图无关**。
- **叠加洞 D·verify 假绿**：`service.ts:629-632` 的 ValidationTrace 逐条 **写死 `status:"PASS"`**——`ENTITY_DEFINED` 恒 PASS、`NUMERIC_PROVENANCE` 恒 PASS 且 detail 写死"结论数字溯源至求解器输出形状"（**根本不检查有没有结论数字**）；S5 真跑坐实：verify 落 `BUILD_STATIC`、answer="推演跳过(modelId required)"（无任何结论数字），ValidationTrace 仍判 **ALL_PASS**；交叉验证还拿 `obj_base_changzhou`（常州）验一个讲**合肥**的故事，判 ALL_CONSISTENT。
- **净效果（本审计最关键结论）**：**`gatePassed=true` + `ALL_PASS` 这两个用户最信任的绿灯，可以在"切片是空的、规则是盖的、推演没跑、验证盖章"的情况下同时点亮。** 这比 comprehend 词表更深——**不是"没建全"，是"建了空的、还判了绿"**，正是 KILL-MOCK-RED 要杀的形态。
- **判据**：植入一个 `domain` 有值但 `paths:[]` 的类型 → closure 应报 slice 空 → 现状 objectsBound++ 判绿 → 红（green→red 自证）；BUILD_STATIC 无 answer 数字 → NUMERIC_PROVENANCE 应 NOT_PASS → 现状 PASS → 红。
- **锚点**：`closure.ts:20-36/157`（objectsBound/gatePassed 判据无切片非空校验）· `service.ts:629-632`（ValidationTrace 写死 PASS）· `service.ts:264/489`（BUILD_STATIC）。

---

## §3 UX 叙事收口（补 unified-spec 未收的一层）

`PRD-databuilder-page-unified-spec` 规划了"8 区单页"，但真跑现状（origin）是 **2 Tab（engine/studio）× 2 模式（onboarding/operational）× ~15 面板**——8 区叙事被 `OntologyWorkflowStudio` 与 operational 看板冲散，同页承载四种任务、无主线（真跑 20 场景脚本共性）。本文补一个**叙事收口方案：五幕向导**（不替换 unified-spec 的区，是给它一条时间轴主线）：

| 幕 | 内容 | 治哪个洞 |
|---|---|---|
| 1 输入 | 故事⊕数据⊕"信息不够会问你"（intake 合并·消 S3 岔路） | S3 补录不问 |
| **2 理解确认门** | 建之前强制停一拍：展示理解+**覆盖度%**+**读不懂的原句红色高亮**，可拒绝/改故事 | **P0-1 静默降级**（把词表替换变可拒绝的显式选择） |
| 3 构建直播 | 默认 async+SSE·瀑布流主视觉 | S8 无反馈 |
| 4 诚实结算单 | 矩阵+闭包+缺口+待审合一·徽章三态语义（灰=草稿待审/亮=已发布/红=下发失败） | S2/S7/P1-4/P2-8 |
| **5 亲手验证** | 真跑才绿；BUILD_STATIC/跳过显**灰"未验证"**+去补，点开必看"验了哪个对象哪个数" | **洞 C/D 假绿**（暴露给人） |

**诚实边界**：五幕向导（尤其幕2/幕5）**只能把后端的塌方暴露给人**，治本仍需 §2 三个后端修复单。UX 不替代真派生。

---

## §4 建议治本 WO（不覆盖既有·与 TODO-fde/H3 分工）

| WO | 治 | 与既有文档分工 |
|---|---|---|
| WO-DB-RULE-DERIVE | 洞A：规则从字段+故事数值阈值确定性生成（关键词命中仅作模板种子·数值填真值） | TODO 未记·新增 |
| WO-DB-BSTACK-DERIVE | 洞B：B 栈按故事编排真派生（workflow 多步/条件·agent prompt 含故事上下文·skill 真资源） | TODO 未记·新增 |
| WO-DB-CLOSURE-HARDEN | **洞C/D（最高优先）**：closure 验"切片非空且可解析出 minNodes"（非只看 domain）；ValidationTrace 逐条据实判（BUILD_STATIC/无结论数字 → NOT_PASS；交叉验证采样须属故事主体基地）；加 green→red 门 | TODO 未记·新增·最深 |
| WO-DB-MODELING-WIRE | 故事发动机接 A3 `deriveModelingSuggestion`：上传数据即从列/FK 真派生类型/链路（现只在 /admin/modeling 独立用） | 复用既有 modeling.ts·接线 |
| WO-DB-FIVE-ACT-UX | §3 五幕向导（含理解确认门 + 真绿才绿） | 合流 unified-spec 八区 |
| （引用·不新立） | LLM comprehend 大脑 / 富多跳切片 | = TODO-fde §2/§3 + H3·**照既有推进** |

---

## §5 十场景真跑证据表（附·verdict）

| # | 脚本 | 结果 | verdict |
|---|---|---|---|
| S1 | 电池急单建域 | 5 对象/23 制品/gatePassed=true | ✅ 主链真（但含空切片·洞C） |
| S2 | 冷链新域 | →Order/Process/Base·温区货位丢·0 缺口 | 🔴 静默降级 |
| S3 | 零信息故事 | 直接 SUCCEEDED·无补录 | 🔴 补录不问 |
| S4 | A18 PROVISIONAL | trust=UNVERIFIED | ✅ 诚实 |
| S5 | verify 亲跑 | BUILD_STATIC·推演跳过·却 ALL_PASS | 🔴 假绿（洞D） |
| S6 | 跨系统 scaffold | 干净配对真下发 /b/v1/internal/scaffold | ◐ 真但失败态无引导 |
| S7 | BOM/断供缺求解器 | 只建 Order·0 缺口 0 工单 | 🔴 静默替换 |
| S8 | durable workflow 7 步 | RUNNING→SUCCEEDED·逐步真实 | ✅ 真 |
| S9 | 运营数据源 | connections/raw-datasets 200 | ✅ |
| S10 | 产出事件 outbox | 真发·但 fde.node_advanced 洪水 66%·无 ontology.published(DRAFT正确) | ◐ |

## §6 真 LLM 实测（2026-07-11 补·绑真 Kimi/moonshot-v1-32k 后重跑 · 结论:理解层已达标·去修下游）

> 前面 §5 十脚本是**无 LLM 地板路**。本节补**绑真 LLM 后**的实测(datacore 绑 comprehend→Kimi provider)，把"缺理解 vs 结构空壳"彻底分开。

### 6.1 冷链新域(陌生行业·验行业无关)
无 LLM：冷链故事 → `Order/Process/Base`(温区/货位静默丢·电池味垃圾)。**绑 Kimi**：→ `Base/ColdZone(温区)/StorageSlot(货位)/Order/SortingTask(分拣)/Shipment` + 规则 `SortingTask.leadTimeHours>4`(故事的4小时真派生·非预制C03) + 链路 ColdZone→Base/StorageSlot→ColdZone。**→ 洞A(规则预制)仅地板路成立·LLM 路真派生。**

### 6.2 CALB 真实电池域 · 5 次复杂推演真跑(moonshot-v1-32k·各 16-30s·5/5 SUCCEEDED)
| 场景 | 对象 | 多跳链路 | 求解器(全真注册) | 规则 |
|---|---|---|---|---|
| 设备故障影响半径 | 7 | ✅ **6条全链** Line→Factory·Equipment→Line·ProdOrder→Line·Material→ProdOrder·Supplier→Material·Order→ProdOrder | supplier_disruption_radius/affected_orders/shared_bottleneck/kit_readiness/reroute_decision | ✅ 真 join `Equipment.status=='故障' && ProdOrder=='急单' && 同产线` |
| 接单可行性 | 5 | ⚠️ **空(本次未派生)** | kit_readiness/capacity_forecast/shared_bottleneck | ✅ 交期/齐套/产能 |
| 扩产评估 | 5 | ✅2 | concentration_risk/capex_alternatives | ✅ |
| 良率根因 | 6 | ✅4 Process→Line/Equipment | yield_diagnosis/maintenance_stagger | ✅ |
| 断供半径 | 5 | ✅6 Material→BomLine→Model→CustomerOrder | supplier_disruption_radius/affected_orders/inventory_optimize | ✅ |

**5 场景 LLM 选的 11 个求解器全部真注册**(supplier_disruption_radius/reroute_decision/concentration_risk/yield_diagnosis/capex_alternatives/inventory_optimize/kit_readiness/maintenance_stagger/capacity_forecast/shared_bottleneck/affected_orders)——**纠正 §5 S7"缺求解器"判断:origin(QUERY30)已把求解器库补全，LLM 精确映射·零 SOLVER_NOT_FOUND。**

### 6.3 三条实测结论(钉死改造方向)
1. **✅ LLM 大脑达标**：5/5 建对多跳对象、派生真 join 规则、映射全部真求解器。**理解层不用再花力气·别再从零重写引擎(H3 红线)。**
2. **🔴 §2 结构洞在 LLM 之外·实测坐实**：场景1 建了 Factory→Line→Equipment 全链，**切片仍 `slice_factory hops:[]`(LLM 派生的链路一条不走)**、workflow 仍 `['invoke_solver','render']` 模板。**洞C(空切片)/洞B(模板B栈)LLM 修不了——确定性下游未消费 LLM 产物。**
3. **🆕 洞E · 链路派生不稳定**：5 次里"接单可行性"场景 links **空了**(同模型同 prompt·非确定性)，多跳推演依赖链路却 1/5 断，且 `缺口:[]` 不报。**→ LLM 输出需确定性兜底(FK 式补链 + 覆盖度门)，否则多跳偶发断链。**

### 6.4 改造方向被实测精确到(不是"接 LLM")
- `WO-DB-CLOSURE-HARDEN`：**切片按 LLM 已派生的链路真生成 paths**(洞C·实测最痛)。
- `WO-DB-BSTACK-DERIVE`：workflow/agent 真派生(洞B)。
- **新增 `WO-DB-LINK-STABILIZE`**：LLM 链路输出 + 确定性 FK 兜底补链 + 覆盖度门(洞E)。
- `WO-DB-LLM-REQUIRED-NO-FLOOR`：取消地板路(§6.1 证明有 LLM 就建得好·地板=垃圾)。

## 附录 · 证据锚点（origin 8f8f161）
`comprehend.ts:484-487`(RULES 预制)·`:283-291`(deriveBStack fan-out)·`:284/651`(sliceNeeds hops:[])·`closure.ts:27/157`(objectsBound 只看 domain·gatePassed)·`service.ts:1225`(registerStorySlices paths:[])·`:629-632`(ValidationTrace 写死 PASS)·`:264/489`(BUILD_STATIC)·`modeling.ts:85-89`(A3 真派生·未被故事发动机接)·既有靶 `TODO-fde-build-engine.md §2/§3` + `HANDOFF-comprehend-engine-build-and-review-contract.md`(H3·勿从零重写)。
