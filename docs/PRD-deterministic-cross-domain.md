# PRD · 确定性跨域分解（把跨域题留在确定性层 · 零 LLM 拉回 path-A）

> **一句话（根本解）**：跨域问句现在被确定性路由器**故意 punt 给慢 LLM**（`domain-resolver.ts:41`：`domainFamilies≥2 → −0.4` 压到阈值下）。
> 本 PRD 反过来——让**确定性层（R6 纯函数·零 LLM）自己把跨域题分解成逐域 solver**，并行跑、确定性拼答。
> **跨域题不再落 LLM 推理路径**，秒级、grounded。这才是"把跨域题留在确定性层"的根本解；换分类器/换 agent 模型都只是"落了 LLM 之后减负"。
>
> **与 `PRD-multi-intent-orchestration.md` 的关系**：那份是 **LLM 兜底**（分类器出多候选→并行）；本份是 **确定性主路**（domainResolve 出多路→并行·**根本不碰 LLM**）。两者**共享后半**（并行 solver + 确定性块装配），**前半两个 trigger**：确定性优先、LLM 兜底。本 PRD 只写确定性前半 + 路由接线，后半复用多意图 PRD §3.3/3.4。

---

## 0. 本体引用与影响（强制 · 已完整读 `docs/SYSTEM-ONTOLOGY.md`）

- **对象类型**（§2H）：`Task/Query`、`DomainResolution`（`domainResolve` 产物·`domain-resolver.ts`）、`Intent/ExecutionPlan`、`Solver`、`Answer`。**无新增对象类型**。
- **链路**（§3 编排链·**WO-QOS-1 确定性优先门的直接延伸**）：
  现状 `domainResolve → preferDeterministicSolver → 单 solver path-A`；跨域则 `scoreFor 压分 → 落 LLM classify`。
  本 PRD：`domainResolve → 多域枚举 + 逐域路由 → 确定性**多路** path-A（并行 solver + 装配）·零 LLM`；**只有确定性没覆盖的域才落 LLM**。
- **事件**（§4/§8.2）：**不新增事件名**——复用 `step.completed` 伪 step（`type=det_multi_domain_*`·同多意图 PRD 做法·`ontology:check` 保 51/51）。
- **不变量**（§5）：
  - **R6 确定性**：`domainResolveMulti` + 逐域路由 + 确定性块装配**全纯函数·零 LLM/随机/时钟**；同问句同解同装配（字节一致）。**这是本 PRD 的命门**——跨域分解必须确定性，否则就退化成"又一个 LLM 猜"。
  - **R13 / KILL-MOCK-RED**：每域独立 `⟦ref⟧`；检出耦合诚实标"独立测算·未链式传导·见 L3"；**装配不造跨域新数字**。
  - **R3 entitlement**：暗发 `qos.deterministic-multi-domain`（defaultOn:false）；关=逐字节沿用现"跨域压分→punt LLM"行为。
- **断点**（§8）：
  - **承接 G-AGENT-BLIND-REACT**（WO-QOS-1/QOS-2 把"有对口 solver 的高置信题"挡在慢 path-B 前）——本 PRD 把这条**从单域扩到跨域**：更多题在确定性层就被接住，不落慢 LLM。
  - **G-PORTFOLIO-LOCAL-ONLY**：确定性多路对**独立**域安全；**耦合**域仍只能诚实标、真解在 **L3**（`solve_portfolio` 守恒）。
- **回写**：§3 编排链扩"确定性多域分路"节点（排在 LLM classify 之前）；新 feature 回写 §2.G/features.ts。

---

## 1. 目标 / 非目标

### 目标
1. **跨域题留在确定性层**：一个问句跨 ≥2 域、且**每个子域都有可识别的确定性模式 + 对口 solver + 可填槽** → domainResolve 直接分解成**多路确定性 solver**、并行、装配、**零 LLM、秒级**。
2. **消灭 `domainFamilies≥2 → punt LLM` 的根**（`domain-resolver.ts:41`）——从"跨域=我不会=甩给 LLM"改成"跨域=拆成我会的几路"。

### 非目标（钉死）
- ❌ **LLM 候选多意图**（那是**兜底**·`PRD-multi-intent-orchestration.md`）——本 PRD 是确定性主路，两者互补不重复。
- ❌ **耦合联合求解**（转拨→产能→延误→外协依赖链·**L3**·`solve_portfolio`）——本 PRD 独立域并行，耦合诚实标。
- ❌ **任意 NL 全覆盖**：确定性靠**模式识别**（`DOMAIN_FAMILIES` regex + ceo-route/block-route pattern·R6）——**只覆盖有已知模式的子域**；novel 措辞/无模式的域**诚实落 LLM 或 gap**，不假装确定性接住（这是 R6 的诚实边界，**必须写清**）。
- ❌ 改 solver 数学 / 加 LLM 用途枚举。

---

## 2. 现状与缺口（对照代码 · file:line）

- `domain-resolver.ts`：
  - `scoreFor():34` `if (!contextRich) return 0`（无页面上下文 → 0 → 落 LLM）。
  - `:39` `orchestration −0.6`·`:40` `open −0.6`·`:41` `domainFamilies>=2 −0.4` → 跨域/编排/开放**主动压到阈值 0.6 下 → punt LLM**。
- `domainResolve` **已检测** `signals.domainFamilies`（`DOMAIN_FAMILIES` regex 数命中数）+ 已有单域 route 映射（ceo-route/block-route pattern）——**但 domainFamilies 只被用来压分，从没被拿来"逐域枚举 + 逐域路由"**。**能力就差这一步。**
- 缺口：确定性层**无"多域→多 solver"分解**；跨域题**必 punt LLM**（Q1 = 82s 的根）。

---

## 3. 设计（复用现有接缝优先）

### 3.1 `domainResolve` 从"单路"扩到"多路"（绿地小新建 · 纯函数 R6）
新增 `domainResolveMulti(query, pageContext) → DomainRoute[]`（`router/domain-resolver.ts`）：
- 对每个命中的 `DOMAIN_FAMILY`（产能/物料/订单/决策/…·复用现有 regex），跑**现有单域 route 映射**（ceo-route / block-route pattern·**不新造语义**）→ 得逐域 `{ domain, solverKey, args, perDomainScore }`。
- `perDomainScore` = 该域**单独**看的置信（**不含** `−0.4 跨域惩罚`——那个惩罚正是要消灭的根）。
- **复用**：域族 regex、ceo-route/block-route pattern、slot 抽取（`fillSlots`）——零重写。

### 3.2 确定性多路判定（纯函数 R6 · 插在 LLM classify 之前）
`selectDeterministicMultiRoute(routes) → DomainRoute[] | null`：
- ≥2 域各自 `perDomainScore ≥ THRESHOLD`（逐域高置信）**且**各有对口 solver **且**必填槽可填 → **确定性多路**。
- 任一域**无对口 solver / 槽填不满 / 无模式** → 该域**不硬凑**：要么整体回落 LLM（多意图 PRD 兜底），要么该域诚实标 gap（配置策略）——**绝不带缺槽跑出错答**（诚实边界）。
- 命中 → `runDeterministicMultiPath`（`classification.model="deterministic:multi-domain"`）；否则 null → 逐字节沿用现路径（先 WO-QOS-1 单域，再 LLM classify）。

### 3.3 后半 = 复用多意图 PRD（并行 solver + 确定性块装配 + 耦合诚实标）
并行执行 / partial 容错 / **确定性零 LLM 块装配** / 检出耦合诚实标——**逐条复用** `PRD-multi-intent-orchestration.md §3.3/§3.4/§3.5`（同一后半·两 PRD 共享·一 dev 一起建最省）。

### 3.4 路由顺序（§3 编排链 · 确定性优先）
```
scenario-bind(确定性)
  → 确定性多路(本 PRD·跨域·零 LLM)      ← 新插点·排在 LLM 之前
  → 单域确定性(WO-QOS-1·domainResolve→单 solver)
  → CEO/block 确定性路由
  → LLM classify → (多意图 PRD 兜底 / 单意图)
  → agent(path-B·最后兜底)
```
**跨域题优先被确定性多路接住；接不住才逐级降到 LLM。**

### 3.5 复用 / 绿地 / 门
| 项 | 处置 |
|---|---|
| `DOMAIN_FAMILIES` regex · ceo-route/block-route pattern · `fillSlots` · 多意图 PRD 后半 · `step.completed` | **复用** |
| `domainResolveMulti`（逐域枚举+路由）· `selectDeterministicMultiRoute` · `runDeterministicMultiPath` 分路 | **绿地新建**（纯函数为主·R6） |
| `qos.deterministic-multi-domain`（BLOCK·defaultOn:false·双注册） | **门禁新增**（R3 暗发） |

---

## 4. 契约 / 端点 / 数据模型

- **SubmitQuery 不变**。
- `DomainRoute[]` 为内部结构（非对外契约）。`DecisionTrace` **复用** `multiIntentPlan`（多意图 PRD 已定义）·`synthesisMode="deterministic"` + `routeSource="deterministic-multi-domain"` 区分来源。
- **无新事件名**（复用 step.completed）。**无新表**（R9 不触发）。
- feature：`qos.deterministic-multi-domain`。env：复用 `QOS_MULTI_INTENT_*` 阈值。

---

## 5. 关键流程

**风控员例（确定性多路·零 LLM·SEAM-1）**：
> `常州基地良率掉了2%，交期和毛利分别受多大影响？`
- `domainResolveMulti` → `[良率域→yield_diagnosis, 交期域→affected_orders, 毛利域→margin_attribution]`·三域各逐域够格·槽 `{base:常州,deltaYield:-2%}` 均可填·无依赖边 → **确定性多路**。
- 并行 3 solver → 确定性装配三节答案 → **零 LLM·秒级**（`classification.model=deterministic:multi-domain`·`agentRequests=0`）。

**Q1 例（跨域·部分确定性 + 耦合诚实）**：
> `…缺口8万·转30%给宜宾·长协65%·哪些订单延误·补多少外协/加班`
- `domainResolveMulti` → 尽力枚举 `[产能→capacity_forecast, 物料→lta_gap, 订单→affected_orders, 决策→outsourcing_split]`；
- **检出耦合**（产能→延误→外协依赖链）→ 若各域够格则并行 + 综合**顶部诚实标**"⚠ 独立测算·未链式传导·完整联合方案见 L3"；**某域无模式/槽不满** → 该域诚实 gap 或整体回落 LLM 兜底。**绝不输出"看着全、数字不勾稽"的假组合方案。**

---

## 6. 非功能与约定（§5 逐条）

- **R6**：跨域分解**全确定性**（这是与"又一个 LLM 猜"的分界线）；同输入字节一致。
- **R13/KILL-MOCK-RED**：逐域独立溯源；耦合诚实标；装配不造新数字。
- **R3**：暗发关 = 现"跨域压分→punt LLM"逐字节不变。
- **SEAM-GATE**：验收**必须**含"跨域题被确定性接住·零 LLM"驱动测（SEAM-2）——这是本特性的头号接缝（确定性覆盖 × 路由接线，漏判即 punt LLM）。

---

## 7. 验收（DoD）

1. **SEAM-1（确定性多路真做·零 LLM）**：风控员例 → `classification.model=deterministic:multi-domain`·**`agentRequests=0`·无 LLM classify**·并行 3 solver·装配三域答案 + 各 ⟦ref⟧。
2. **SEAM-2（根治·头号判据）**：同一跨域题——`qos.deterministic-multi-domain` **关** → 走老路 `punt LLM classify`（分类耗时 >0）；**开** → 确定性接住（分类耗时 =0·零 agentRequests）。**直接证明"跨域题从落 LLM 变成留确定性层"。**
3. **SEAM-3（延迟）**：确定性多路总耗时 ≈ `max(并行 solver) + 装配(<50ms)`·**无 classify LLM**·目标 <1s。
4. **SEAM-4（诚实边界）**：某子域无模式/槽不满 → 诚实 gap 或回落 LLM·**不硬凑出错答**；耦合诚实标。
5. **SEAM-5（零回归）**：flag 关 → 逐字节现行为。
6. **门**：四包全绿 + `ontology:check` **51/51**（无新事件）+ a14 evals 不回归（跨域题金标从 path-B 慢 → 确定性快·答案不劣化）。

---

## 8. 分期

| 期 | 内容 | 状态 |
|---|---|---|
| **P1（本 PRD·确定性跨域主路）** | `domainResolveMulti` + `selectDeterministicMultiRoute` + `runDeterministicMultiPath`（复用多意图后半）+ 暗发 + SEAM-1..5 | 待派 |
| **P2（扩覆盖）** | 扩 `DOMAIN_FAMILIES` / 逐域 pattern 覆盖面（更多子域可确定性识别·缩小"落 LLM"残面）；DRIL 粗排辅助 | 路线图 |
| **P3（耦合·L3）** | 依赖链传导联合求解（`solve_portfolio` 守恒）——Q1 的真解 | 路线图（最难·单独立项） |

> **共建提示**：本 PRD 的**后半（并行+装配）= 多意图 PRD 的后半**。**建议一 dev 一起做**：先建共享后半（并行 solver + 确定性块装配 + 耦合标 + `multiIntentPlan` 契约），再各接两个前半 trigger（确定性多路 = 本 PRD·主路；LLM 多候选 = 多意图 PRD·兜底）。🚦范围边界：`router/domain-resolver.ts` + 新 `router/multi-route.ts`（判定+装配）+ `router/orchestrator.ts` 两个插点 + `contracts/qos.ts multiIntentPlan` + features 双注册 + `deterministic-multi-domain-seam.test.ts`。审核方头号判据 = **SEAM-2 亲手真跑（关→punt LLM·开→确定性接住）**。
