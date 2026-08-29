# PRD · 多意图 L2 真分解 + L3 耦合联合求解（Q1/Q2 的「真组合方案」）

> 状态：路线图 PRD（最难一环·L1 已交付·L2/L3 分期落）
> 前置：`PRD-qos-cross-domain-unified.md`（**L1 = 独立多域并行 + 耦合诚实标**·已派 `WO-QOS-CROSS-DOMAIN-UNIFIED`）
>
> **一句话**：L1 把跨域题从「Coordinator 黑洞/慢 LLM」救到「确定性多路并行答全」，但**独立子结论·未链式传导**（诚实标"见 L3"）。
> 本 PRD 定义把「转拨→产能→延误→外协」这条**耦合链**真正联合求解的路——**复用已有 `portfolio.ts` 的联合守恒引擎**，不新造 solver。

---

## 0. 本体引用与影响（强制 · 已读 `docs/SYSTEM-ONTOLOGY.md`）

- **对象类型**：`Task/Query`·`Intent`·`Solver`（`portfolio_optimize`/`capacity_forecast`/`affected_orders`/`outsourcing_split`/`lta_gap`/`yield_diagnosis`）·`Answer`·`DecisionTrace.multiIntentPlan`。**无新增对象类型**。
- **链路**（§3 编排链）：
  - **L2** = 在 `⑤ LLM 多意图`（`selectMultiIntent`）之上加**真分解**：LLM 产**solver 计划**（哪些 solver + 各 args）→ 确定性校验 → 并行（补 ② 关键词覆盖不到的意图）。
  - **L3** = 新增一条**耦合联合求解路**：识别耦合链 → **映射成一次 `portfolio_optimize` 请求**（良率↓=cap 缩·转拨=跨基地分配·残差=外协）→ 单次联合解**原生传导**。
- **不变量**：**R6 确定性**（portfolio 已 forecastStart 锚·无时钟/随机）· **R13 可溯源**（portfolio 每分配/被挤带 provenance）· **联合守恒**（`Σ qty·x[i,b,t] ≤ cap[b,t]`·portfolio.ts:17·capacityLedger 硬校验）· **KILL-MOCK-RED**（L3 真联合·不再"独立测算假装综合"）。
- **断点**：
  - **G-PORTFOLIO-LOCAL-ONLY**（逐单单独求解=局部最优）——**portfolio.ts 已治**（联合守恒）；L3 是把**跨域耦合链**接到这台已有联合引擎上。
  - **G-SOP-COMPOSE**（自由问句无落地求解器）——L2 缩小其残面。
- **回写**：L3 落地 → `SYSTEM-ONTOLOGY.md` §3 新增「耦合联合求解路」链路 + §8 标 G-PORTFOLIO-LOCAL-ONLY 从"局部"扩到"跨域耦合已联合"。**L2/L3 复用 `step.completed` 伪 step·不新增 §8.2 事件名**（保 `ontology:check` 51/51）。

---

## 1. L1/L2/L3 分层（钉死边界·别混）

| 层 | 是什么 | 触发 | 求解 | 综合 | 状态 |
|---|---|---|---|---|---|
| **L1** | 独立多域并行 | 关键词多路(②) / 候选多意图(⑤) | N 个 solver **各自独立** invoke | **确定性分节装配** + 耦合诚实标 | ✅ 已交付（`WO-QOS-CROSS-DOMAIN-UNIFIED`） |
| **L2** | **真分解**（补漏意图） | LLM 产 solver 计划（超关键词） | 计划内 solver 并行·仍**独立** | 同 L1 装配 | 🔜 本 PRD P1 |
| **L3** | **耦合联合求解** | 检出耦合链（依赖对） | **映射成一次 `portfolio_optimize`**·联合守恒原生传导 | portfolio 结果直译 + 真组合方案 | 🔜 本 PRD P2（最难） |

**关键区分**：L1/L2 是「多个独立答案拼一起」（子结论不互相影响）；**L3 是「一次联合解」**（转拨改了产能→延误真变→外协残差真算·守恒保证）。**只有 L3 才是 Q1/Q2 要的"给出调拨/加班/外协的组合方案"。**

---

## 2. 现状锚点（file:line）

- `portfolio.ts:13-21` —— `WO-PORTFOLIO-OPTIMAL` 联合守恒引擎：全订单×全基地×时间·`Σ qty·x[i,b,t] ≤ cap[b,t]`·capacityLedger+reconChecks 逐格硬校验。**L3 的引擎·已在·不新造。**
- `portfolio.ts:30-90` `PortfolioInput` —— 已支持：`modelBaseMap`（型号→可产基地=**转拨**底座）·`finalDueDays`（per-order 最终交期=**延误**度量）·`materialConstraint`/`bom`（**长协/物料约束**）·`levers`（加班等供给侧杠杆）·`priorityLocks`·`twoStage`（电芯-Pack）。**耦合链所需维度基本齐备。**
- `router/multi-route.ts`（L1·`WO-QOS-CROSS-DOMAIN-UNIFIED` 交付）—— `runParallelRoutes` + `solverDepGraph`（静态依赖表·L1 只用于诚实标）。**L3 把 `solverDepGraph` 从"标注"升级为"路由信号"**（检出依赖对 → 走 L3）。
- `domain-resolver.ts` `domainResolveMulti`（L1）—— L2 在其之上加 LLM 分解补漏。

---

## 3. L2 设计 · 真分解（补 ② 关键词覆盖不到的意图）

**问题**：② 靠 `DOMAIN_FAMILIES` 关键词·novel 措辞（没写"产能"但问"接不接得住"）漏意图；⑤ 靠分类器候选·但候选是"意图"非"solver 计划"。
**L2**：classify 之后，对复合问句让 LLM 产一份 **solver 执行计划**（`{intentKey, solverKey, args-抽取}[]`）——**LLM 只做分解/选型（非推理·非算数·§3 D-模型分层）**，计划**确定性校验**（每 solverKey ∈ SOLVER_KEYS·必填槽可填·无 scope 冲突）→ 命中即接 L1 的 `runParallelRoutes`。
- **护栏**：LLM 产的计划**逐条确定性验真**（solver 存在 + 槽可填），验不过的条目丢弃（诚实 gap·不硬凑）。**LLM 绝不产数字·只产"调哪些 solver 用什么参"。**
- 门：`qos.multi-intent-l2-decompose`（暗发·defaultOn:false）。
- 与 L1 关系：L2 命中 → 复用 L1 `runParallelRoutes` 同一后半（**不另建**·铁律"不同机制不对接")。

## 4. L3 设计 · 耦合联合求解（**核心·复用 portfolio 守恒**）

### 4.1 触发（何时升 L3）
`runParallelRoutes` 前查 `solverDepGraph`：若选中意图集**含依赖对**（`outsourcing_split←capacity_forecast`·`affected_orders←capacity_forecast`·`*←lta_gap`）**且**问句是"给组合方案/连锁传导"型 → **不走 L1 独立并行·改走 L3 联合路**。
- 门：`qos.multi-intent-l3-coupled`（暗发·defaultOn:false）。关 → 落 L1（独立并行 + 诚实标·现状）。

### 4.2 映射（耦合链 → 一次 `portfolio_optimize`）—— L3 的关键
把 Q2 型耦合链**翻译**成 portfolio 请求（**不新造 solver·不改 portfolio 数学**）：
| 耦合环 | 映射到 portfolio 输入 |
|---|---|
| 良率↓2%·有效产出↓5% | `cap[b,t]` **缩减**（受影响基地/线的产能系数下调·经 `levers` 或 cap 预处理） |
| 转拨 30% 给宜宾 | `modelBaseMap` 放开目标基地 + `priorityLocks`/`committedBatches` 表达转拨约束 |
| 哪些订单延误 | 联合解输出 `GlobalSimScheduleRow` 延误 + `finalDueDays` 对比（**真传导后的延误·非独立估**） |
| 外协还是加班 | 联合解**残差 gap** → `outsourcing_split`（残差为真·因产能/转拨已联合结算） |
| 长协只覆盖 70% | `materialConstraint`+`bom`（物料约束进联合解） |

**产出**：一次 portfolio 联合解 → **真组合方案**（转拨量 + 加班量 + 外协量·三者在同一守恒约束下同时定·capacityLedger 硬校验）。**这才是 Q1/Q2 要的答案。**

### 4.3 诚实边界（L3 也不能假装）
- portfolio **coeff 缺省兜底**要诚实标（`portfolio_optimize_coeffs` 规则未校准 → 标"系数为默认估算"）。
- 映射覆盖不到的环（如"良率↓"到"cap 缩"的换算系数无实测）→ 诚实标"该换算为近似"·不假装精确。
- **绝不**因为"联合解跑通了"就宣称数字是实测——provenance 维（R13）逐项透传。

---

## 5. 验收（SEAM · **头号判据 = SEAM-L3-守恒**）

1. **SEAM-L3-守恒（头号·最重·亲手真跑）**：Q2 走 L3 → **一次** `portfolio_optimize`（非 N 个独立 solver）·`capacityLedger` reconChecks **逐格守恒通过**·答案给出**转拨+加班+外协三量组合**·**断言延误数字随转拨量变化而变化**（证明真传导·非独立估）。对照 L1（flag 关）：同题 → N 独立子结论 + "未链式传导"标签。
2. **SEAM-L3-守恒硬校验**：篡改一个转拨量 → 延误/外协残差**联动变**（L1 下不会变·因独立）。
3. **SEAM-L2-补漏**：novel 措辞问句（不含"产能"字面但问接单可行）→ L2 分解出 `capacity_forecast`（② 关键词漏·L2 补上）·确定性校验过。
4. **SEAM-L2/L3-诚实**：coeff 未校准/换算近似 → 答案带诚实标·**断言不出现"精确实测组合方案"措辞**（防假综合升级版）。
5. **SEAM-零回归**：`l2`/`l3` 两 flag 全关 → 逐字节 L1 现行为（含 Coordinator/L1 装配不变）。
6. 四包全绿 + `ontology:check` 51/51 + a14 不回归。

## 6. 分期
- **P1 · L2 真分解**：LLM 产 solver 计划 + 确定性校验 + 接 L1 后半。中等难度·先落（补漏意图·收益立现）。
- **P2 · L3 耦合联合求解**：耦合链 → portfolio 映射（**最难·核心**）。先做 Q2 型「良率↓→转拨→延误→外协」一条链跑通（SEAM-L3-守恒），再泛化其他链。
- **P3 · 泛化**：更多耦合链模式（电芯-Pack 两阶段·多基地转拨网络）·L3 覆盖面扩。

## 7. 非目标 / 红线
- ❌ 新造 solver 或改 portfolio 数学——**只做"耦合查询 → portfolio 请求"的映射层**。
- ❌ LLM 算数/产数字——L2 只产 solver 计划·L3 只做映射·真值全来自 portfolio 守恒解（§3 D-模型分层·R6/R13）。
- ❌ 新增 §8.2 事件名（复用 step.completed·保 ontology 51/51）。
- ❌ 假联合（映射覆盖不到就诚实标近似·不假装精确·KILL-MOCK-RED）。

---

## 8. 施工提示（拆 WO 时）
- **L2 一张 WO**（agentcore 分解层·接 L1 后半）· **L3 一张 WO**（agentcore 映射层 + 复用 datacore portfolio·跨两半特性→**一个 dev 整单**·铁律）。
- L3 的 WO 头号判据必须是 **SEAM-L3-守恒亲手真跑**（改转拨量→延误联动变）——这是"真联合 vs 假综合"的唯一真门。
- base 先 `git fetch origin claude/inspiring-gates-aqczjg` 再开（治 stale-base）。
