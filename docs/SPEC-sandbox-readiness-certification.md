# 推演沙盘 · 增量 2 就绪认证落地规格（SimCertification = 投影既有 closure · 零新校验逻辑）

> 这是什么：增量 2「就绪认证」的**逐字段、可照抄**工程规格。配 `SPEC-sandbox-propagation-and-session.md`（增量 1/3）。本规格把 SimSession 能不能进推演，落成对**既有 closure / GapReport / 一次 Trial Tick 的只读投影**。
> **铁律（RL3 单源 · 增量2 唯一纪律）**：**不写任何新校验逻辑**。L0-L4 / 三维准备度 / L4 三元组 / 世界完整度，全部 **DERIVE 自既有 `closure.ts` 的 5 维 findings + 计数**。增量 2 真正新写的只有：① 一个纯投影函数 `deriveCertification` ② 一次 Trial Tick 调用 ③ 三张映射表的常量阈值。**任何"我重新算一遍就绪"= 违 RL3，打回。**
> 给实现 agent（你当自己什么都不知道，照抄）：所有"我方来源"都给了 `file:line`；所有公式、阈值、字段名都钉死；阈值全部 config（R14，换租户改配置不改码）。

---

## 0. 数据来源（全是既有，逐个 file:line — 你只投影它们，不重算）

| 既有产物 | 来源 | 字段（你要读的） |
|---|---|---|
| **ClosureReport** | `apps/datacore/src/databuilder/closure.ts validateClosure` | `gatePassed` · `findings[{kind:OBJECT\|DATA\|FORWARD\|CHAIN\|SHAPE, ref, status:BOUND\|ORPHAN_PASSED\|DROPPED\|MISSING\|FAILED, severity}]` · `objectsBound` · `dataOrphans` · `forwardMissing` · `chainBroken` · `shapeBroken` · `buildMode:STRICT\|PROVISIONAL` · `advisoryCount` · `blocked` |
| **GapReport（7 码）** | `databuilder/selfcheck.ts` | `gapCode: NO_SLICE\|NO_RULE\|SOLVER_NOT_FOUND\|NO_INTENT\|NO_PLAN\|SHAPE_MISMATCH\|...` + ref + suggestedFill |
| **Trial Tick** | `simclock.ts tick()` → `ClockTickReport.firedEvents`（`:64`/`:166`），或增量3 `propagateTick` 单遍 | 触发规则/事件数 + 是否抛错 |
| **既有就绪投影（对齐口径，别另造）** | `ScenarioOntogenesisRun.rings{data,ontology,capability}` + `maturity:PROVISIONAL\|GOVERNED`（`contracts/agentcore.ts:217/226`） | 已有"诚实就绪"语义：GOVERNED=验证真可用 / PROVISIONAL=有缺口不假装。**SimCertification 的 `canEnterSimulation` 对齐 maturity 语义** |

> 关键：上表全部**已存在**。增量 2 = 把它们投影成沙盘认证视图。**meta:sync 门**保证"就绪算法只有一处（closure），认证只是它的投影"。

---

## 1. SimCertification 契约（增量 0 已入本体；这里给精确 schema · 放 `@platform/contracts/src/sim.ts`）

```ts
export const SimCertLevelSchema = z.enum([
  "L0_INVALID",      // 类型未定义/未发布
  "L1_CONFIGURED",   // 已定义+归域,未发布/未跑派生
  "L2_RUNNABLE",     // 已发布,能跑派生/求解器
  "L3_VERIFIED",     // closure.gatePassed 且 Trial Tick PASS
  "L4_CERTIFIED",    // L3 + L4 三元组全真
]);

export const SimCertificationSchema = z.object({
  scope: z.enum(["GLOBAL", "LOCAL"]),            // 全局整本体 / 局部逐对象
  targetRef: z.string().nullable(),             // LOCAL 时 = objectId 或 typeKey
  level: SimCertLevelSchema,
  dims: z.object({                              // 三维准备度 0-100（投影,非新算）
    structure: z.number(),                      // 结构 ← OBJECT 维
    knowledge: z.number(),                      // 知识 ← DATA 维 + 利用率
    behavior:  z.number(),                      // 行为 ← FORWARD 维 + Action
    composite: z.number(),                      // 综合 = 加权
  }),
  l4Checks: z.object({                          // L4 三元组（竞品 L4 Certified 的三子项）
    fanoutSafe:        z.boolean(),             // 无高风险扇出
    writebackComplete: z.boolean(),             // writeback 行动已配置
    observabilityMet:  z.boolean(),             // 图查询/切片达标
  }),
  trialTick: z.object({                         // ⚠ WO-CERT-HONESTY ③ 改名：字段名 = 实测口径
    passed: z.boolean(),                        // = 空跑未抛异常（派生图无环）；**不是**"世界推得动"
    derivationNodes: z.number().int(),          // 拓扑排序出的派生规格节点数（图规模，非触发数）
    propagationCovered: z.boolean(),            // 本次空跑是否覆盖传导栈（今天恒 false，欠账 #152）
    at: z.string().nullable(), error: z.string().nullable(),
  }),
  worldCompleteness: z.object({                 // 世界完整度（范围预检 = init step③）
    pct: z.number(),                            // 0-100
    // ⚠ WO-CERT-HONESTY ① 删 `stateVars: {present, needed}`：两半都是 derivationRules 的复制品
    //   （present 同一变量 / needed 同一表达式）⇒ 零独立事实，且把派生在 pct 里数了两遍。
    derivationRules: z.object({ present: z.number().int(), needed: z.number().int() }),
    actions:         z.object({ present: z.number().int(), needed: z.number().int() }),
    propagationRules:z.object({ present: z.number().int(), needed: z.number().int() }),
    stateVarKeys:    z.array(z.string()),       // 真状态变量名（传导规则 source∪target，清单非比值，不入 pct）
    entering: z.array(z.object({                // "将进入沙盘的**要素**"清单（三类混装，前端按 kind 分组）
      key: z.string(),                          // 如 order_risk
      kind: z.enum(["DERIVATION", "ACTION", "PROPAGATION"]),
      source: z.string(),                       // 如 "FULFILLS r_order_risk_from_factory"
    })),
  }),
  // 运行期两雷达（§2.4/§2.5 · 我 PRD 初版漏、2026-06 补 · 投影既有信号 · 非可计算维诚实 RESERVED）。
  // 全 optional：缺则前端不渲染该雷达、不阻断主流程（守 RL3 不新算 / provisional-honesty 不编造）。
  healthRadar: z.object({                        // 竞品 Runtime Health Radar 6 维（§2.4）
    ruleCoverage: z.number(), utilization: z.number(), closure: z.number(),
    cycleSafety: z.number(), observability: z.number(), activation: z.number(),
    composite: z.number(),
  }).optional(),
  trustRadar: z.object({                         // 竞品 Runtime Trust Radar 4 维（§2.5）
    runtimeTrust:   z.union([z.number(), z.literal("RESERVED")]),
    explainability: z.union([z.number(), z.literal("RESERVED")]),
    temporalTrust:  z.union([z.number(), z.literal("RESERVED")]),
    dataTrust:      z.union([z.number(), z.literal("RESERVED")]),
    computableOf4:  z.number().int(),            // 竞品"2/4 可计算"——诚实计数
  }).optional(),
  canEnterSimulation: z.boolean(),              // = L4 ∧ trialTick.passed ∧ closure.gatePassed
  gaps: z.array(z.object({ gapCode: z.string(), ref: z.string(), detail: z.string() })), // 缺件诚实清单
  computedAt: z.string(),
});
export type SimCertification = z.infer<typeof SimCertificationSchema>;
```

> SimCertification 是**派生投影对象（非真值）**：每次按需算、可缓存，不经 R4 写真值。

---

## 2. 三张映射表（**钉死** ← 这是本规格的核心，照此实现，别自由发挥）

### 2.1 L0-L4 ← closure 状态（单调投影 · 逐级判据）

| 级 | 名 | **精确判据**（从 ClosureReport / 本体态 DERIVE） | 竞品对应 |
|---|---|---|---|
| **L0** | Invalid | 类型未定义 **或** 无 PUBLISHED 本体版本 | L0 Invalid |
| **L1** | Configured | 类型已定义 **且** 已归域（`objectsBound>0` 且 OBJECT 维无 `FAILED`），但未发布或未跑派生 | L1 Configured |
| **L2** | Runnable | 已发布 **且** DATA/FORWARD 维无 `MISSING`（能跑派生与求解器） | L2 Runnable |
| **L3** | Verified | L2 **且** `closure.gatePassed===true`（STRICT 口径：OBJECT+DATA+FORWARD+CHAIN+SHAPE 全过，即 `forwardMissing=chainBroken=shapeBroken=0` 且无 OBJECT-FAILED） **且** `trialTick.passed===true` | L3 Verified（Trial Tick 已通过） |
| **L4** | Certified | L3 **且** `l4Checks` 三项**全 true** | L4 Certified |

> **单调**：高级必含低级全部条件；任一条件回落即降级到对应级。`level` 取**满足的最高级**。

### 2.2 L4 三元组 ↔ 我方 closure 维（逐项 source + 算法 + 阈值）

| 竞品 L4 子项 | 我方来源（既有） | **怎么算（精确）** | 阈值（config R14） |
|---|---|---|---|
| **Fanout安全**（无高风险扇出规则） | recompute 拓扑序（`ontology-core.ts`，已有环检测）+ 派生/PropagationRule 图 | ① 图无环：recompute topo-sort 不抛环错（**复用既有，不新写**）；② 每 `sourceStateVar` 出边数 ≤ `maxFanout`（**唯一新读的一个计数**） | `maxFanout` 默认 **8** |
| **Writeback完整**（已配置 writeback 行动 N） | ActionType（`actions`，R4 `domainExecutor`） | scope 内对象有 ≥ `minWriteback` 个可写本体的 writeback ActionType | `minWriteback` 默认 **1** |
| **Observability达标**（图查询 N 个） | SliceSpec（`ontology/slice-planner.ts`）+ 图查询 | scope 内对象被 ≥ `minQueries` 个切片/查询覆盖（即 closure 无该对象 OBJECT-orphan） | `minQueries` 默认 **1** |

> ⚠ **诚实标注**：除"Fanout 出边数 ≤ maxFanout"这**一个计数**外，三元组全部投影既有 closure / actions / slices。**环检测复用 recompute，绝不新写图算法。**

> 🔗 **与"三件套门"的关系（消歧 · 必读 — RUNBOOK §2 与本 SPEC 用词不同但同源）**：竞品有**两组**三元组——① §1.2「三大核心能力 = 衍生规则 ∧ 业务动作 ∧ 图谱查询」是**可推演前提**（三类配置都得在，否则"不具备推演条件"）；② L4 Certified「Fanout/Writeback/Observability」是**质量认证**。二者**同源不同关口**：`Writeback完整`=业务动作够、`Observability达标`=图谱查询够、`Fanout安全`=衍生/传导规则无危险扇出。**前提**在 L2/L3 已校（派生可跑 = DATA/FORWARD 维 BOUND、closure.gatePassed）；**质量**在 L4 校。RUNBOOK §2 写的"三件套门"= 前提（派生∧动作∧查询存在），本 SPEC 的 L4 三元组 = 认证（质量达标）——**实现时两者都由同一个 `deriveCertification` 输出（前提进 level≤L3 判据、质量进 `l4Checks`），不是两套代码。**

### 2.3 三维准备度 ↔ closure kind（逐维公式）

| 维 | ← closure kind | **公式（0-100）** | 竞品对应（image5） |
|---|---|---|---|
| **结构准备度** | OBJECT（反向-对象 HARD） | `100 × objectsBound / 总类型数` | 结构 100/100 |
| **知识准备度** | DATA（反向-data SOFT）+ 利用率 | `100 × 被消费字段数 / 总字段数`（被消费 = DATA 维 BOUND） | 知识 67/100 |
| **行为准备度** | FORWARD + Action | `100 × (求解器入参齐 ∧ 有 Action 的对象数) / 应有数` | 行为 90/100 |
| **综合** | 加权 | `w_s×结构 + w_k×知识 + w_b×行为` | 综合 86/100 |

> 权重 config（R14），默认 `w_s=0.4 / w_k=0.3 / w_b=0.3`。

### 2.4 运行健康雷达 6 维 ↔ closure/规则/拓扑（**我 PRD 初版漏设计，2026-06 补 · 竞品 image1 Runtime Health Radar**）

> ⚠ **补设计由来**：竞品沙盘主屏除"三维准备度"外，另有**两张运行期雷达**（健康 6 维 + 信任 4 维），我增量 2 SPEC 初版只设计了三维准备度，漏了这两张（`AUDIT-sandbox-ui-design-alignment.md 轴1`）。这里补上，**仍守 RL3——全部投影既有信号，不新写校验**；某维无既有信号则**诚实标 `RESERVED`**（对齐竞品自己也只"2/4 可计算"），不编造。

| 健康维（竞品 image1） | ← 我方既有来源（投影） | **算法（0-100 · 零新校验）** |
|---|---|---|
| **Rule Coverage** 规则覆盖 | `rule-closure:check` 的 ⋃引用⊆已定义 + `SOLVER_RULE_REFS` | `100 × 已定义规则数 / 被引用规则数`（复用 rule-closure，不新算） |
| **Utilization** 利用率 | closure DATA 维 + Action 引用计数（同 §2.3 知识准备度的"利用率"） | `100 × 被 Action/派生消费的状态变量数 / 总状态变量数` |
| **Closure** 闭包 | `ClosureReport.gatePassed` + 五维 findings | `100 × 通过维数 / 5`（OBJECT/DATA/FORWARD/CHAIN/SHAPE） |
| **Cycle Safety** 环安全 | recompute 拓扑序环检测（**复用既有，同 §2.2 Fanout**） | 无环=100；有环=`100 × (1 − 环边数/总边数)` |
| **Observability** 可观测 | SliceSpec 覆盖（同 §2.2 Observability） | `100 × 被切片/查询覆盖的对象数 / 总对象数` |
| **Activation** 激活 | recompute 可达性（静态可达 + 条件激活派生数） | `100 × 可达派生数 / 总派生数` |

> 综合健康分 = 6 维均值（竞品 image1 显"综合84"）。**6 维全部来自既有 closure / rule-closure / recompute / slice，无一新写算法。**

### 2.5 运行信任雷达 4 维 ↔ 溯源/时序（**同上补设计 · 竞品 image1 Runtime Trust Radar · 诚实部分可计算**）

| 信任维（竞品 image1） | ← 我方既有来源 | **算法 / 诚实状态** |
|---|---|---|
| **Runtime Trust** 运行信任 | `canEnterSimulation` + closure.gatePassed | `100 × 可计算维数 / 4`（与竞品"可计算覆盖度"同义；未达则 <100，诚实） |
| **Explainability** 可解释 | R13 `Provenance`/`RuleRef` 覆盖 | `100 × 有 provenance 的 KPI/状态变量数 / 总数`（复用 R13，不新写） |
| **Temporal Trust** 时序信任 | 传导核 Temporal Trust 不变量（`propagateTick` 不窥未来，增量3 已守） | tick 全程不读未来=`RESERVED→可计算`：传导已跑则投影"无未来读"为 100，否则 **`RESERVED`**（诚实，竞品此维也标 Reserved） |
| **Data Trust** 数据信任 | 数据血缘 / 源系统绑定（连接器 lineage） | 当前无统一血缘投影 → **`RESERVED`**（诚实留空，不编造；待数据血缘成一等再接） |

> **诚实红线**：`Temporal/Data Trust` 暂 `RESERVED` 的，前端显"🔒 Reserved + 原因"，**不渲染假分数**（对齐 `provisional-honesty.ts` + A18；竞品自己也只 2/4 可计算）。契约 §1 两雷达字段全 `optional`，缺则不渲染该雷达，不阻断主流程。

---

## 3. Trial Tick（空跑 1 tick · 复用既有 · 确定性 R6）

**精确步骤**：
> ⛔ **本节原文与实装不符，已按实测改写（WO-CERT-HONESTY ③ · 2026-08-10 · 欠账 #152）。**
> 原文写「跑 `propagateTick` + `recompute`，统计 `rulesFired`（触发的派生+传导规则数）」，
> 并把缺口描述成「`propagateTick` 未就绪，待增量3」。**两句都已过期且方向相反**：
> 传导核 `propagateTick` 早已实装且有生产调用方，真实缺口是**这条认证路从没调用它**
> （形态是「接了线接错地方」，不是「还没做出来」——修法完全不同）。

**实装步骤（`app.ts` `assembleCertification`）**：
1. 在克隆态上跑 `ontologyCore.recompute(c, [], { dryRun: true })` —— **dryRun 不落真值（R4）**。
   它只做两件事：装载/索引对象 + 对全部 ACTIVE `DerivationSpec` 拓扑排序（有环抛 `CyclicDerivationError`）。
2. ⚠ `changes = []` ⇒ dirty 集为空 ⇒ 逐节点循环全部 `continue` ⇒ **零条派生公式被求值**（`updatedObjects` 恒 0）；
   且**全程没有调用 `propagateTick`** ⇒ 零条传导规则被跑。
3. 故只能诚实写两个数 + 一个覆盖面声明：
   `trialTick = { passed: 未抛异常, derivationNodes: topo.length, propagationCovered: false, at, error }`。
   - `passed` 语义 = 「**重算未抛异常（派生图无环）**」，**不是**「这个世界推得动」。
     ⚠ L3 判据含 `trial.passed`、L4 又要先过 L3 ⇒ 整把梯子的第三级今天架在「重算没崩」上，这是现状实录。
   - `derivationNodes` = 派生依赖图**规模**，不是「触发数」（旧名 `rulesFired` 错了两次：既无触发，数的也不是传导）。
4. **确定性 R6**：同 scope+规则 → 同 `derivationNodes`（单测跑两次断言相等）。
5. **待办（L3-a / 欠账 #152）**：让 Trial Tick 真空跑一个传导 tick，届时 `propagationCovered` 翻 `true`，
   前端「⚠ 传导未纳入本次空跑」提示自动消失（UI 无需改文案）。

> 复用：`simclock.ts tick()` 的 `ClockTickReport.firedEvents` 计数模式（`:64`/`:166`）。

---

## 4. 世界完整度（范围预检 = init wizard step ③ · 复用 closure over scope）

**精确**：
1. 对 init 选定的 **scope（slice 子图）** 跑 `validateClosure` → 算 present/needed。
   **每一对比值都必须能回答「present 与 needed 各自的承载物是谁」，答不上就不许上屏**：
   - `derivationRules`：present = 已物化的 `DerivationSpec(ACTIVE)`；needed = 本体类型上声明的 `derivedProperties`
   - `actions`：`ActionType` present/needed
   - `propagationRules`：`PropagationRule` present/needed（增量3）
   - ⛔ ~~`stateVars`：scope 内派生属性 present（已物化）/ needed（本体声明）~~
     **已删（WO-CERT-HONESTY ① · 2026-08-10）**：这条原文与上面 `derivationRules` 说的是同一件事，
     实装里 present 取的是**同一个变量**、needed 在 `app.ts` 是**逐字节相同的表达式**
     ⇒ 屏上两行恒等、且派生在 `pct` 的分子分母里各被数两遍。
     本平台真正的「状态变量」= 传导规则 `sourceStateVar ∪ targetStateVar` 去重集（同 `SandboxViewConfig.stateVars`），
     但**无任何承载物声明「这个世界应有几个状态变量」** ⇒ 做不出诚实的 needed ⇒ 不做成比值。
2. `worldCompleteness.pct = 100 × Σpresent / Σneeded`（**只含上述三对**）。
3. `worldCompleteness.stateVarKeys` = 世界将承载的**状态变量名**（去重升序）。**是清单不是比值**，不参与 `pct`。
4. `entering[]` = scope 内"将进入沙盘的**要素**"清单，每条标 `kind` + `source`（派生依赖 / Action / PropagationRule）。
   ⚠ **不叫「状态变量」**（WO-CERT-HONESTY ②）：三种 `kind` 里只有 `DERIVATION` 是属性，
   实测 demo（SEED_DEMO=1 真跑 GET /a/v1/sim/sessions/:id/certification）23 条 = 行动 10 · 传导 13 · 派生 0 —— 旧标题里的那个名词在列表里一条都没有。
   前端**必须按 kind 分组显示计数**（行动 N · 传导 N · 派生 N），不许拿一个名词盖三样东西。
5. **全局 vs 局部**：`scope=GLOBAL`（整本体）vs `scope=LOCAL`（单对象子图）—— **同一投影函数，只换 scope 输入**（meta:sync 防漂；竞品 image5 局部 75/100 vs image6 全局 100/100）。
6. **完整度 ≠ 认证（WO-CERT-HONESTY ④）**：`canEnterSimulation` **不含** `worldCompleteness`，这是对的、别加。
   认证判「**能不能跑**」（结构闭合 + L4 三元组 + 空跑未抛异常），完整度判「**这个世界建得全不全**」；
   两者互不蕴含（33% 的世界照样可以是 L4 可跑）。缺陷只在**表达** —— UI 把两者并排贴着且不解释，
   读起来像自相矛盾。修法是在完整度卡加一句说明，**不改判据**。

---

## 5. 投影函数签名（纯函数 · 零新校验 · 这就是增量2 几乎全部新代码）

```ts
// apps/datacore/src/sim/certification.ts  (NEW · 纯投影 · 不调 closure 以外任何校验器)
export function deriveCertification(
  closure: ClosureReport,        // 既有 validateClosure 产出（你不重算）
  gaps: GapReport,               // 既有 selfcheck 产出
  trial: { passed: boolean; derivationNodes: number; propagationCovered: boolean; at: string | null; error: string | null },
  scope: {
    kind: "GLOBAL" | "LOCAL"; targetRef: string | null;
    objectTypes: ObjectTypeRef[]; derivations: DerivationRef[]; actions: ActionRef[];
    slices: SliceRef[]; propagationRules: PropagationRuleRef[];
  },
  cfg: { maxFanout: number; minWriteback: number; minQueries: number; weights: { s: number; k: number; b: number } }, // config R14
): SimCertification
```
**纯函数**：输入既有 closure/gaps/trial + scope 计数 → 输出 SimCertification。**不调 closure 以外校验、不写真值、不 Date.now/随机**（时间戳由调用方传入，R6）。

---

## 6. 端点 + CLI（R15 · CLI 先于 UI）

| REST（过 R2/R3） | CLI | entitlement |
|---|---|---|
| `GET /a/v1/sim/sessions/:id/certification?scope=GLOBAL\|LOCAL&target=` | `platform sim certify` | `sim.certification` |
| `GET /a/v1/sim/sessions/:id/scope-precheck`（init step③ 世界完整度） | `platform sim precheck` | `sim.sandbox` |

> certification 是**只读投影**，复用既有 closure 端点取数，不另造校验端点。

---

## 7. 诚实门（缺件 FAIL 不静默 · 复用 provisional-honesty 口径）

- `canEnterSimulation = (level==="L4_CERTIFIED") ∧ trialTick.passed ∧ closure.gatePassed`。
- 任一不满足 → **显式"不可进入推演 + 缺什么（`gaps[]`）"**，**绝不静默放行**。= 竞品"缺口 0 个（high0/medium0/low0）→ 可进入推演"；我方未达标则列 `gapCode+ref+detail`。
- 复用 `provisional-honesty.ts` 口径：未达 L4 = 诚实标（对齐 `maturity=PROVISIONAL`），不假装可用（守 fde-delivery「绿测试≠能用」）。

---

## 8. 前端（**增量 4 才做 UI**，本增量只交付数据契约）

- L0-L4 stepper（`data-testid=sim-cert-level`）· 三维 **RadarChart**（复用 `views/sim/RadarChart.tsx`，dims=结构/知识/行为）· 世界完整度 gauge + `entering[]` 清单 · 缺件 `gaps[]` 列表。
- **运行健康雷达 6 维**（§2.4，复用 `RadarChart`，dims=RuleCoverage/Utilization/Closure/CycleSafety/Observability/Activation + 综合分）· **运行信任雷达 4 维**（§2.5，Runtime/Explainability/Temporal/Data Trust；**`RESERVED` 维显 "🔒 Reserved + 原因" 不画假分**，标"N/4 可计算"）。两雷达字段 `optional`，缺则不渲染（实拍审计 `AUDIT §3.5`：现 SandboxView 仅小三角三维，缺这两张——P1 补）。
- IA：**folded 进 `modeling`（建模就绪）+ `growth`（运行就绪），不新开就绪页**（见 `ARCH-global-ia-consolidation §2`）。
> 本增量(2)**不写 UI**；数据契约就绪即可，UI 在增量 4。

---

## 9. 门：`sim-readiness:check`（新建 · 并入 `pnpm gates` · 回写本体 §7）

静态断言：
1. `deriveCertification` 是**纯投影**：静态扫 `sim/certification.ts` 的 import，**不得 import/调用 closure 以外的校验器**（防重造就绪算法 → RL3）。
2. **L4 必须三子项全真**才置 `L4_CERTIFIED`（防"假 L4"）。
3. `canEnterSimulation` 必含 `trialTick.passed`（防跳过 Trial Tick 直接放行）。
4. 缺件必入 `gaps[]`（诚实，不静默）。
5. 全局/局部用**同一** `deriveCertification`（单源，呼应 meta:sync）。

---

## 10. DoD（FDE 亲手 · 两行业验收 R14）

1. **CLI 跑通**：`platform sim certify` 对一个 L4 本体出 `level=L4_CERTIFIED` + 三维 + 世界完整度 100% + Trial Tick PASS，**贴输出**。
2. **缺件诚实回退**：删一条 writeback Action → 重认证 → `level` 回退 `L3_VERIFIED` + `l4Checks.writebackComplete=false` + `canEnterSimulation=false` + `gaps` 列出该缺，**贴输出**（证不静默）。
3. **局部 vs 全局**：同本体，补全对象 local=100、缺字段对象 local<100（复刻竞品 75/100），**贴**。
4. **两行业**（R14）：供应链 ⊕ 另一行业（医疗/物流），同 `deriveCertification` 各出认证，**代码零改**。
5. **门**：`sim-readiness:check` + `chain:check` + `pnpm gates`（含新门）绿。

---

## 11. 《本体引用与影响》（回写 SYSTEM-ONTOLOGY.md · 增量 0 先行）

- **对象类型**（§2）：`SimCertification`（投影对象，非真值；增量 0 已入）。
- **链路**（§3）：`closure(validateClosure) ⊕ GapReport(selfcheck) ⊕ TrialTick(propagateTick/recompute) --deriveCertification(纯投影)--> SimCertification --canEnterSimulation--> 「可进入推演」`。
- **不变量**：R3（entitlement `sim.certification` 暗发）· R6（Trial Tick 确定性）· R13（认证每个数字可溯源到具体 closure finding）· **RL3 单源**（认证 = closure 投影，不新造就绪算法）· **meta:sync**（全局/局部/scenario-ontogenesis rings 同一 closure 源）。
- **门禁**（§7）：新增 `sim-readiness:check`（投影纯度 + L4 三子项 + 诚实 FAIL，并入 gates）；复用 `chain:check`（CHAIN 维）。
- **断点**（§8）：闭 G-11 的"就绪认证"半边——folded 进 modeling/growth，**不新页**（IA 合并方案）。
- **回写**：增量 0 把 SimCertification + `sim-readiness:check` 写进 §2/§3/§7。

---

## 12. 一句话给实现 agent

**就绪认证不是新校验器，是把既有 closure 五维（OBJECT/DATA/FORWARD/CHAIN/SHAPE）+ GapReport + 一次 Trial Tick，按 §2 三张映射表投影成 L0-L4 / 三维 / L4三元组 / 世界完整度 的只读视图；全局与局部同一投影函数换 scope；唯一新读的是"扇出计数"（环检测仍复用 recompute）。缺件诚实列进 `gaps[]`，`L4 ∧ TrialTick ∧ gatePassed` 才置 `canEnterSimulation`。** 你新写的几乎全部 = 一个纯函数 `deriveCertification` + 一次 Trial Tick + 三张映射表的常量。**敢重算就绪 = 违 RL3，打回。**
