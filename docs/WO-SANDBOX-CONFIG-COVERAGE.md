# WO · SANDBOX-CONFIG-COVERAGE（把沙盘配套纳入 gap 引擎覆盖）· 详细施工单

> 状态：**待派单**（本文件是给 dev 的施工规格；作者不实现，dev 据此开发）。
> 一句话：给 gap 引擎的 `MODULE_PROVISIONERS` 增加 `propagation_rule` 与 `state_var` 两类模块，使"某推演问题缺哪些传导规则/状态变量"**可被 `diffGap`/`preAnalyzeQuery` 诊断、可落 GrowthTicket**——沙盘最核心的配套从此对"检测缺什么"的引擎不再隐形。
> 依据：`docs/REVIEW-sandbox-intent-vs-reality.md §7`（配套缺口 2）+ `docs/PRD-gap-analysis-engine.md`（gap 引擎）。所有锚点 file:line 均已核对真实存在。
> 纪律：沿 `docs/DESIGN-refit-rollback-plan.md` 七原则（暗发/只加不改/旁路/影子/回退演练入齿/单期复验/失败判据前置）。

---

## §0 本体引用与影响（铁律 0 · 门 `prd:check` 机器解析）

**触及对象类型（母体 §2）**：`GapAnalysis`/`GapAnalysisEntry`/`GapItem`（§2 · `contracts/databuilder.ts`）· `PropagationRule`（§2.I · `contracts/sim.ts:38`）· `ObjectType.derivedProperties`（=状态变量载体·§2.B）· `BuildPlan`（need 数组）· `GrowthTicket`（§2.H·缺则落工单）。
**触及链路（母体 §3）**：倒序发育"比对现状 gap_analysis"这一等步（`provisioners.ts analyzeGap`）扩两类；沙盘链 世界态→`propagateTick` 的配套前置。
**不变量（母体 §5）**：R1 contracts-only · R2 tenant · R6 确定性（provisioner 纯读比对·无时钟随机）· R9 仓储双实现（若新增 BuildPlan need 数组则四处同改）· R13 溯源 · R14 零业务常数（roleType/typeKey 抽象）· R16 发育闭环（gap=生长信号）。
**断点（母体 §8）**：G-9（场景→推演发育·沙盘配套是其一环）· G-10（"改规则即改推演"·传导系数经 `rule.params`）· G-1（预诊断覆盖扩到沙盘配套）。
**门禁（母体 §7）**：`provisioners.test`（13→15 kind 覆盖门）· gap 覆盖门（NEED_ARRAY_TO_KIND 每 need 数组须登记）· 四包 build/test。
**回写母体**：落地后回写 §2.I 登记 `propagation_rule`/`state_var` 为 gap 可诊断模块、§3 补"沙盘配套进 gap 覆盖"关系措辞；跑 `pnpm ontology:slices`。

---

## §1 背景与依赖/跳转关系分析（设计前提）

### 1.1 为什么要做（配套缺口 2）
`MODULE_PROVISIONERS`（`provisioners.ts:35`）现有 **13 类**：dataset/kb_doc/ontology_type/rule/slice/solver/intent/plan/workflow/skill/agent/scene/mcp。**无 propagation_rule、无 state_var**。而沙盘要跑,必须有:①对象上的**真数值派生属性**(状态变量·`app.ts:1361/1504`)②沿 link 的**传导规则**(`contracts/sim.ts:38`·表 `sim_propagation_rule` migration026)。→ **gap 引擎（主 PRD `diffGap`）当前诊断不出"这问题的推演缺 2 条传导规则/1 个派生属性"**,只会让沙盘惰性静止而无缺口提示。本 WO 补这层覆盖。

### 1.2 该页面与其他功能的依赖/跳转关系（核实·影响本 WO 定位）
- **上游依赖（谁进沙盘）**：`RiskBoardView`/`ProjectSimView`/`LedgerView`/`components/WhatIfCalculatorCard` 经 `views/sim/whatif.ts whatIfQuery` 生成 `/v/sim-sandbox?whatif=…`；导航「推演」组；`SimInitWizard`。
- **下游出口**：采纳→`useActionDraft`→Action 草稿（/admin/actions·RL4 不直写真值）；深链 `/admin/tickets`（缺口收口·= 本 WO 产出的 GrowthTicket 落点）。
- **同类重叠**：`project-sim`（registry.ts:56）亦推演类视图,与沙盘概念重叠——**沙盘独有的是会话/checkpoint/branch/compare 工作台**。
- **渲染分发事实**：`views/registry.ts` 注册了 dashboard/risk-board/project-sim/plan-audit/sop-balance/order-chain 等为**意图落地渲染器**;**`SandboxView` 不在注册表**,是独立路由 `/v/sim-sandbox`（`App.tsx:143`）。

### 1.3 该页面是否无需独立存在（架构裁定·见 REVIEW §8）
**裁定：沙盘不应主要作为独立页存在,应改为"时序推演"意图的落地渲染器（主）+ 沙盘工作台（副）。** 本 WO **不做**这个重定位（那是 sibling `WO-SANDBOX-AS-RENDER-TARGET`）,但**是它的前置**——因为要判"某时序意图能否渲染进沙盘 / 还是配套缺该显缺口",`preAnalyzeQuery` 必须先能看见传导规则/状态变量。**本 WO 只做后端 gap 覆盖,不碰前端路由/渲染器**（爆炸半径最小）。

---

## §2 范围（Scope）与非范围

**In scope（后端·契约·gap 引擎）**：
1. 契约:`ModuleKindSchema` 增 `propagation_rule`、`state_var` 两枚（`contracts/databuilder.ts`,枚举 additive）。
2. `BuildPlan` 增 `propagationRuleNeeds[]`、`stateVarNeeds[]` 两个 need 数组（全 `.default([])`·向后兼容·R1）。
3. `MODULE_PROVISIONERS` 增 2 条 provisioner（planned/existing/side/autoCreatable）。
4. `NEED_ARRAY_TO_KIND` 登记两新 need 数组（过覆盖门）。
5. query 目标:`preAnalyzeQuery` 的需求推导（主 PRD §6 `deriveRequirements`）对**时序推演意图**补出所需 propagation_rule/state_var（见 §3.4）。

**Out of scope（明确不做·留 sibling WO）**：
- ❌ 沙盘注册为渲染器 / targetView 落地（→ `WO-SANDBOX-AS-RENDER-TARGET`）。
- ❌ 前端任何改动（本 WO 零前端触点）。
- ❌ 传导系数校准（→ `WO-design-E-calibration-sandbox-live-loop`）。
- ❌ 自动生成传导规则的"智能建模"（本 WO 只做 existing 检测 + 缺口诊断 + 骨架/工单,系数真值仍人工/校准）。

---

## §3 详细设计（dev 照此实现）

### 3.1 契约变更（`packages/contracts/src/databuilder.ts`）
```typescript
// ModuleKind 枚举 additive 追加两枚（顺序追加·prd 现有序列化零破坏）
export const ModuleKindSchema = z.enum([ /* …现有 13… */, "propagation_rule", "state_var" ]);

// BuildPlan 增两 need 数组（全 default([])·向后兼容）
propagationRuleNeeds: z.array(z.object({
  key: z.string(),                 // 规则 key
  sourceStateVar: z.string(), viaLinkKey: z.string(), targetStateVar: z.string(),
})).default([]),
stateVarNeeds: z.array(z.object({
  typeKey: z.string(),             // 挂在哪个对象类型
  stateVar: z.string(),            // 派生属性名（数值）
})).default([]),
```

### 3.2 provisioner 定义（`apps/datacore/src/databuilder/provisioners.ts`）
```typescript
// —— 沙盘配套类（新）——
{
  kind: "state_var", side: "structure", autoCreatable: true,  // 可 scaffold DRAFT 派生属性（formula 待填→PROVISIONAL）
  planned: (p) => p.stateVarNeeds.map((s) => `${s.typeKey}.${s.stateVar}`),
  existing: async ({ ontology }, ctx) => {
    // 现有 = 各对象类型已声明的数值派生属性（derivedProperties[].propKey）
    const types = await ontology.listTypes(ctx);
    return new Set(types.flatMap((t) =>
      (t.derivedProperties ?? []).map((d) => `${t.key}.${d.propKey}`)));
  },
},
{
  kind: "propagation_rule", side: "cross_system", autoCreatable: true, // 可 scaffold DRAFT 规则(默认系数·PROVISIONAL)·校准/审批才 GOVERNED
  planned: (p) => p.propagationRuleNeeds.map((r) => r.key),
  existing: async ({ repos }, ctx) =>
    new Set((await repos.sim.listPropagationRules(ctx.tenantId)).map((r) => r.key)), // 表 sim_propagation_rule
},
```
> **side 选择理由**：`state_var`=structure（本体结构层·先于 code/cross_system,与 ontology_type/rule 同层）；`propagation_rule`=cross_system（依赖 state_var + link 都在,拓扑序最后补·避免"规则引用了还没建的派生属性"）。→ 复用现有 `side` 四层拓扑序（content→structure→code→cross_system），传导规则自然排在派生属性之后。

> **autoCreatable 语义**：两者 `true` = 可 scaffold **DRAFT/PROVISIONAL**（state_var 建占位派生属性待填 formula；propagation_rule 建默认系数规则待校准）——**不是自动 GOVERNED**。系数真值/formula 需人工或校准（R4 晋升）。若 dev 判"传导规则必须人工建模不宜 scaffold",可改 `autoCreatable:false` → 缺则直接 MISSING→GrowthTicket（二选一,派单时定；推荐 `true`+PROVISIONAL,与系统 provisional→governed 范式一致）。

### 3.3 覆盖门登记（`NEED_ARRAY_TO_KIND`）
```typescript
export const NEED_ARRAY_TO_KIND = { /* …现有… */,
  propagationRuleNeeds: "propagation_rule", stateVarNeeds: "state_var" };
```
（`provisioners.test` 断言"BuildPlan 每个根级 need 数组都登记 + 有 provisioner"；不加即测试红。）

### 3.4 query 目标需求推导（`preAnalyzeQuery` 侧·主 PRD §6）
时序推演意图命中时,`deriveRequirements` 除现有 objectTypes/solvers/intents 外,补:
- `stateVarNeeds` = 该意图涉及的对象类型 × 其决策关注的数值变量（来自意图绑定/view-config 的 stateVars）。
- `propagationRuleNeeds` = 沿相关 link 的传导规则 key（来自目标 SandboxViewConfig 应有的规则集）。
> **诚实边界**：本 WO 只保证"**若需求树声明了 propagation_rule/state_var,gap 能 diff 出缺哪些**"。"某问题**到底**需要哪些传导规则"的智能推导属 `WO-SANDBOX-AS-RENDER-TARGET`/RequirementGraph;本 WO 先打通"能诊断 + 能落工单"的通道,需求树可先由 view-config 现有规则集/scope 静态给出（确定性·R6）。

### 3.5 GrowthTicket 落点（复用·零新造）
缺的 propagation_rule/state_var（MISSING 或 PROVISIONAL 未晋升）→ 复用既有 `SOLVER_NOT_FOUND`/`NO_PLAN` 同款 GrowthTicket 路径（`growth/scenario-grow.ts SCAFFOLDABLE`）产带 I/O 契约的骨架工单,收口 `/admin/tickets`。

---

## §4 触点清单（dev 改哪些文件）

| 文件 | 改动 | R9? |
|---|---|---|
| `packages/contracts/src/databuilder.ts` | ModuleKind +2 · BuildPlan +2 need 数组（default []） | 契约 |
| `apps/datacore/src/databuilder/provisioners.ts` | MODULE_PROVISIONERS +2 · NEED_ARRAY_TO_KIND +2 | — |
| `apps/datacore/src/persistence/repos.ts`（或 sim repo 接口） | 若无 `sim.listPropagationRules` 则补只读方法 | **是·四处**（repos 接口 + pg + memory；表 `sim_propagation_rule` 已存,**无需新迁移**） |
| `apps/agentcore/src/growth/pre-analyze.ts`（主 PRD 落地后） | `deriveRequirements` 补两 need（§3.4） | — |
| `docs/SYSTEM-ONTOLOGY.md` §2.I/§3 | 回写登记两 kind + 关系 | 回写 |

> **关键**：`sim_propagation_rule` 表与 `ontology.derivedProperties` **都已存在**——本 WO **不新建表、不新迁移**（`existing()` 纯读现有）。R9 只在"补 sim 只读 repo 方法"时触发（memory+pg+接口三处；若 `repos.sim.listPropagationRules` 已存则零 R9）。dev 先 grep 确认。

---

## §5 验收（真跑·铁律 0.4·含回退演练）

1. **单测·覆盖门**：`provisioners.test` 扩 13→15 kind 断言绿；`NEED_ARRAY_TO_KIND` 覆盖门绿（去掉任一登记即红=自证）。
2. **gap 诊断真跑**：构造一个"时序推演"需求树（含 2 条 propagationRuleNeeds + 1 stateVarNeeds，其中 1 条规则/派生属性系统里不存在）→ 调 `diffGap`/`analyzeGap` → **断言 GapAnalysis.entries 出现 `propagation_rule`/`state_var` 两类,缺的那条 status=MISSING/TO_CREATE**（改造前该问题 gap 里**根本没有这两类**=对照）。
3. **R6 确定性**：同需求树双跑 GapAnalysis 字节一致（无时钟随机）。
4. **existing 真读**：给 demo 租户真建 1 条传导规则 + 1 个派生属性 → gap 里该条 status=EXISTS（证 existing 读真表非造）。
5. **GrowthTicket 落点**：MISSING 的 propagation_rule → 真产骨架 GrowthTicket,`/admin/tickets` 可见。
6. **回退演练**：ModuleKind 两枚 + 两 need 数组是 additive；**移除两 provisioner 条目 + 枚举两枚 → 四包 test 绿、gap 回到 13 类**（证 additive 可摘）。契约字段 default([]) → 旧 BuildPlan 反序列化零破坏。
7. **gates 全绿**：`pnpm gates`（含 provisioners 覆盖门 + ontology-slices + prd:check）。

---

## §6 失败判据（中止即回退·派单时写死）
- F1 `provisioners.test` 或覆盖门红（新 kind 未登记/planned-existing 不匹配）→ 修或摘两条。
- F2 旧 BuildPlan 反序列化破坏（need 数组非 default）→ revert,重申 default([])。
- F3 `existing()` 误读/跨租户（未带 tenantId·违 R2）→ 关本 WO,查 sim repo 过滤。
- F4 gap 对现有非时序问题多报了 propagation_rule/state_var 缺口（planned 在 needs 为空时须 `continue`,不得凭空报）→ 修 planned 空数组短路（复用现有 `if (planned.length===0) continue`）。
- F5 任一门禁红 → 不进下一期（P6）。

---

## §7 排序与后续
- **前置**：主 PRD `diffGap` 落地（L0-A）——本 WO 扩的是它的 kind 覆盖。可与主 PRD Phase1 并行（同改 provisioners/contracts,注意合并）。
- **本 WO = S0**：解锁"沙盘配套可诊断可施工"。
- **后续 sibling**：`WO-SANDBOX-AS-RENDER-TARGET`（把沙盘注册为渲染器 + 定义"时序推演"意图类 + targetView 落地·= REVIEW §8 的页面重定位）——本 WO 是其前置（preAnalysis 先能看见沙盘配套,才能判"渲染进沙盘 vs 显配套缺口"）。

## 附录 · 证据锚点
`provisioners.ts:35`(13 kind)/`:67`(solver autoCreatable:false 范式)/`NEED_ARRAY_TO_KIND`·`contracts/sim.ts:38`(PropagationRule)·`app.ts:1361/1504`(状态变量=真数值派生属性·从规则派生)·`migration026 sim_propagation_rule`·`views/registry.ts`(渲染器注册表·无 sandbox)·`App.tsx:143`(沙盘独立路由)·`views/sim/whatif.ts`(what-if 上游)·`growth/scenario-grow.ts SCAFFOLDABLE`(骨架工单路径)·母体 §5 R1/R6/R9/R14/R16 · §8 G-9/G-10。
