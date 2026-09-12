# HANDOFF · WO-CHANGE-IMPACT-PREVIEW · 变更传播预览（模型层 previewChangeImpact + POST /a/v1/sim/change-impact-preview）

- 分支：`claude/handoff-wo-change-impact-preview`
- 范围边界遵守：只碰模型层纯函数 + 最小接线 + 测试 + 本文档。**未碰** `apps/frontend-shell/src/views/sim/**`（UI 另开单）。
- 背景：本仓此前完全没有「变更传播预览」——用户改扰动 / 关传导边 / 改派生公式，按下去之前看不到波及面（与事故 `G-LEVER-SNAPSHOT-UNIT-LIE` 同源：假数进审批留痕，屏上看不见）。参照物 `docs/REF-ontology-twin-ux.html:156` 有「假设焦点节点变动，按关系类型分桶列出必须执行的动作」。本单交付模型层纯函数 `previewChangeImpact` + 最小接线 `POST /a/v1/sim/change-impact-preview`。

---

## ① 传播关系清单（实测）

预览引擎要覆盖的传播关系，实测共 **五族**，全部有 file:line 证据。另有四项查过后**点名排除**（理由见 §1.6）。

### 1.1 传导规则 PropagationRule（35 条种子，PUBLISHED）

- **契约**：`packages/contracts/src/sim.ts:39` `PropagationRuleSchema`——`sourceTypeKey.sourceStateVar` →`viaLinkKey`→ `targetTypeKey.targetStateVar`，另带 `coefficient` / `delayTicks` / `combine(sum|max)` / `decay` / `clamp` / `coefficientRef(ruleKey+paramKey)` / `cadenceNodeId` / `domainKey`。
- **引擎**：`apps/datacore/src/sim/propagation.ts:442` `propagateTick`——每 tick 单跳（源读 `effState` ≤t，贡献落 `next`，跨跳 = 跨 tick）；`sourceVal===0` 跳过；`delayTicks` 排 pending（`arriveTick>tick`）；cadence 闸门拿不到进 `unresolvedGates`；`round12` 固定精度。
- **装配唯一处**：`apps/datacore/src/sim/propagation-inputs.ts:65` `buildPropagationInputs`。
- **种子**：`apps/datacore/src/seed.ts` `seedDemoPropagationRules`，35 条 PUBLISHED；既有测试 `apps/datacore/test/seed-demo-propagation.test.ts` 断言 `propagationCount===35`。
- **金丝雀 3 跳链**（真实存在于种子，预览的跳数展开以它为锚）：
  `demo_order_demand_pressure`（Order.demandPressure →order_for_model→ Model.demandLoad，0.8 / delay0）→ `demo_model_demand_to_base_load`（Model.demandLoad →model_producible_at→ Base.loadIndex，0.6 / 0）→ `demo_base_load_to_line_util`（Base.loadIndex →line_belongs_to_base→ Line.utilPressure，delayTicks=1）。

### 1.2 结构边 LinkType + link 实例（100 个 link key）

- 实测：`apps/datacore/src/synthetic/battery.ts` `batteryLinkTypes` 函数体内 `key: "..."` 去重计 **100**。
- 是传导导航的基底：`propagateTick` 的 `navOut` 索引与 ontology-core `recompute` 的 `navIn`/`navOut` 两个引擎都吃它。

### 1.3 派生属性 ObjectTypeDef.derivedProperties（14 条种子公式）

- 实测：grep `formula:` 于 `battery.ts`，命中 `:781-784` `:809-810` `:1028` `:1160-1161` `:1218` `:1245-1246` `:1277` `:1351` `:1371`，共 **14 条**。
- **契约**：`apps/datacore/src/domain.ts:249` `DerivedPropertyDef {propKey, formula}`。
- **引擎**：`apps/datacore/src/ontology.ts:862` `runDerivations` 批量触发；两型公式——聚合 `FN(Type.prop BY field)`（`parseAggregate` :64，跨类型，`byField` 匹配目标主键 `primaryKeyProp` :119）/ 算术（`evalArithmetic` :78，同对象标识符，未知标识符按 0 计）；`topoOrder` :804 遇环直接 throw `derivation cycle at X`。
- 种子举例：`Base.orderCount = COUNT(Order.so BY bases)`、`Base.committedQty = SUM(Order.qty BY bases)`、`Model.totalDemand = SUM(Order.qty BY model)`、`Order.value = qty*unitPrice`。

### 1.4 DerivationSpec 第二套派生系统（机制在、demo 零种子——「接了线没数据」态）

- **契约**：`apps/datacore/src/domain.ts:434` `DerivationSpecRecord {specKey, targetType, targetProp, formula, deps[{typeKey, prop, via?, direction?}], status}`。
- **引擎**：`apps/datacore/src/ontology-core.ts:219` `compileSpecs`（`parseFormula`→`extractDeps`→Kahn `topoSort` :267，拒环 `CYCLIC_DERIVATION` 带环路径）；`:341` `recompute`（增量 + dryRun what-if；`propToSpecs` 含 `Type.*` 通配 :391-397；`resolveAffectedTargets` :400 沿 `navIn`/`navOut` 反导航：`direction=out` ⇒ target 在 `fromId` 侧，`direction=in` ⇒ target 在 `toId` 侧；沿 topo 序传播 dirty :447）。
- **唯一写者**：`ontology-core.ts:246`（`compileSpecs` 内 `repos.derivationSpecs.put`）；生产调用方 `app.ts:4095` 路由。
- **必须点名**：**两套派生系统并存是实测发现**——`derivedProperties`（§1.3）批量全量 vs `DerivationSpec` 增量按变更集；机制全在但 demo 零种子，是「接了线没数据」态（不是没接线），预览引擎须明确标注这一族当前无实例可波及。

### 1.5 规则表达式 RuleEntry.expression（29 条种子）

- 实测：`grep -c "expression:" battery.ts` = **29**。
- **DSL**：`apps/datacore/src/ruledsl.ts` `parseExpression` :334 / `collectFieldPaths` :391（抽字段引用，rejudge 桶的依据）/ `evaluateExpression` :558。
- 种子举例：`battery.ts` C03 / C05 / C08 / C13 等（expression 经 `parityRuleExpression` 派生引用 params）。

### 1.6 排除项（查过、点名、给理由）

| 候选 | 排除理由 |
|---|---|
| causal-graph `CausalEdge` | gap_attribution 查询时投影，非传播关系本体 |
| finance-world 的 PropagationRule 使用 | 读端投影 |
| `Metric.ksfRef` | 求解器内部 |
| 既有端点 `POST /a/v1/simulation/impact-analysis`（`app.ts:2230` → `sim/impact-analysis.ts`） | 走 DerivationSpec `recompute` dryRun 栈——与本 WO **不同栈**：本单覆盖 sim 传导 + 两套派生 + 规则判定四族，且按关系分桶带跳数；不重复造 |

### 1.7 金丝雀自证（铁律 0.6 纪律）

本节每个计数 / 否定结论都跑过正向金丝雀：

1. **35 条传导规则**：由既有测试 `apps/datacore/test/seed-demo-propagation.test.ts` 断言确认，非本单次 grep 数出来的。
2. **3 跳链**：`demo_order_demand_pressure` / `demo_model_demand_to_base_load` / `demo_base_load_to_line_util` 三条 key 在种子中均可取到实例，逐跳 viaLinkKey 对得上。
3. **100 个 link key**：计数集中含已知必中的 `order_for_model` / `model_producible_at` / `line_belongs_to_base`——三枚金丝雀全中，工具没瞎，100 可信。
4. **14 条 derivedProperties——差点报假阴性的教训**：第一次按 `derivedProperties: []` 形态 grep，零命中（种子不是内联空数组形态）；换 `formula:` 才追到变量赋值形态。**这是铁律 0.6 的实例：「我用 `derivedProperties:` 字面量当作派生公式存在性的证据，而前者并不度量后者。」** 否定结论前先自证工具的判据，在此节直接决定结论真假。
5. **29 条 expression**：`grep -c "expression:"` 命中 29，同文件内已知必中的 C03/C05/C08/C13 在命中集内。

---

## ② 改法与论据

**交付物**（全部新增/纯加性，0 删除）：

| 文件 | 内容 |
|---|---|
| `apps/datacore/src/sim/change-impact.ts`（新建 675 行） | 模型层：`previewChangeImpact(world, focus)` 纯函数（无 React、无 I/O）+ `buildChangeImpactWorld(repos, tenantId)` 唯一装配处 |
| `packages/contracts/src/sim.ts`（+37 行） | `ChangeFocusSchema`（五态 discriminatedUnion）/ `ChangeImpactItemSchema` / `ChangeImpactPreviewSchema` / `ChangeImpactPreviewRequestSchema` |
| `apps/datacore/src/app.ts`（+16 行） | 最小接线 `POST /a/v1/sim/change-impact-preview`（卫兵 `requireSim(c, "sim.propagation")`，纯只读） |
| `apps/datacore/test/change-impact-preview.seam.test.ts`（新建 440 行） | 21 例验收测试（17 例验收 + 4 例对抗审查复发闸） |

**设计要点与论据**：

1. **焦点五态**（比工单三例多两态，均有实测依据）：`stateVar`（改扰动）/ `link`（关传导边）/ `derivedProp`（改派生公式）是工单点名的三态；`propagationRule`（改/停一条传导规则）是 §1.1 族的天然焦点；**`prop`（改一个普通对象属性）是实测中补的第五态**——没有它，rederive/rejudge 两桶没有真实触发场景（派生公式与规则表达式读的都是对象属性，不是 sim 状态变量），那就真是做样板了。
2. **四桶**（对位参照物 recompute/rejudge/restate 三桶，按本仓实测五族映射）：`recompute`（传导规则沿 link 实例逐跳，镜像 propagateTick 的 navOut 导航与类型匹配）· `rederive`（两套派生：derivedProperties 聚合/算术 + DerivationSpec 反导航，后者**逐行镜像 ontology-core resolveAffectedTargets**：self dep⇒自身、direction=out⇒目标在 fromId 侧、in⇒toId 侧，含 `Type.*` 通配）· `rejudge`（规则表达式字段引用，含 `SUM()` 等 func 参数—— ruledsl 的 collectFieldPaths 只抽 cmp 直挂 field，会漏 func 参数，预览自行 walk AST）· `rewire`（link 焦点下吃这条边的规则与规格）。
3. **跳数**：焦点 hop 0 不计，每经一条边 +1，BFS 首达最短跳数。环由 visited 集终止（环上节点只列一次、焦点不被回列——实测发现：初版测试把「焦点在 hop2 回列」当成期望，实现是对的、测试错了，已修正为三环链验证「真走完一整圈且恰两项」）。
4. **MAX_HOPS=32 保险丝**：终止由 visited 保证（有限节点集），32 只是防御性上限；本仓最深真链 3 跳，32 给 10× 余量；参照物 MAX_DEPTH=256 是遍历上限（它不记跳数）。触发即 `truncated:true` + unresolved 点名断点，不静默。
5. **诚实位**（⛔ 空集不冒充「没有波及」）：焦点不存在 / 派生公式解析失败 / 规则表达式解析失败（无法判定是否波及）/ 可达规则零实例（「接了线没数据」，只对本焦点可达的规则报，不全租户扫）/ 类型无实例 / 截断——全部进 `unresolved[]` 写明「什么追不到、缺什么」。`items` 空 + `unresolved` 空 = 焦点确为叶子（有专项测试把这一态与「算不出来」区分开）。
6. **同一实现纪律**：聚合/算术公式解析复用 `ontology.ts` 的 `parseAggregate`/`evalArithmetic`（不另抄正则）；规则表达式复用 `ruledsl.parseExpression`。装配口径与 `buildPropagationInputs` 同源（对象非 mergedInto、规则只 PUBLISHED）。
7. **与既有 `POST /a/v1/simulation/impact-analysis` 划界**：那条走 DerivationSpec recompute dryRun（栈B）；本条覆盖 sim 传导 + 两套派生 + 规则判定四族、按关系分桶带跳数——不重复（§1.6 排除项表）。

## ③ T1–T5 实测输出原文

**验收测试 21/21 全绿**（对抗审查修复轮后重跑，`VITEST_RC=0`）：

```
✓ test/change-impact-preview.seam.test.ts (21 tests) 65567ms
  ✓ 接线 > feature 关 ⇒ 404 FEATURE_NOT_FOUND（Entitlement 先于 authz）
  ✓ 预览与实际一致（传导族·真跑 propagateTick 差分）> 预览 recompute 集合 === 真跑 N tick 后实际变值集合
  ✓ 预览与实际一致（传导族）> 多跳正确：3 跳真链逐跳列出且跳数标对
  ✓ 预览与实际一致（派生族·真跑 runDerivations 差分）> 预览 rederive 集合 === 实际变值集合
  ✓ 环与保险丝 > 环检测 / MAX_HOPS=32 保险丝
  ✓ 诚实位 × 4（焦点不存在 / 零实例规则 / 真叶子 / 公式解析失败 / 表达式解析失败）
  ✓ rejudge/rewire/派生链/焦点五态 × 5
  ✓ 对抗审查 REAL-BUG 复发闸 × 4（c①byField / c②目标主键 / f两段路径回退 / 装配器 DRAFT 物化）
  Tests  21 passed (21)
```

**对抗审查轮（impact-reviewer，a–k 全表）**：审查实证抖出 **3 个假阴性 REAL-BUG**——修复前的共同形态正是本单头注明令禁止的说谎诚实位：「items 空 + unresolved 空 = 谎称焦点确为叶子」：

1. **REAL-BUG-c**：聚合依赖索引只索 `${sourceType}.${sourceProp}`，漏 `${sourceType}.${byField}` 与目标主键两键 ⇒ 改 `Order.bases`（byField）或 `Base.id`（目标主键）时预览报「无波及」，而 runDerivations 实际会重算 `Base.committedQty`。修：aggBySource 双键 + 新增 aggByTargetPk 索引与目标侧展开循环。
2. **REAL-BUG-f**：两段规则路径（`Order.qty`，scope=[Line]）漏 ruledsl `resolveField` 的前缀丢弃回退——运行期实际读 `Line.qty`，预览只索 `Order.qty` ⇒ 漏报。修：`p.length===2` 时按 scopeObjectTypes 逐类型追加同名 prop 键；>2 段进 unresolved。
3. **REAL-BUG-装配器**：`buildChangeImpactWorld` 误把 ACTIVE 过滤带进图物化，而 propagateTick 的物化（propagation-inputs）不过滤 status ⇒ DRAFT 类型实例在真传导图里、预览世界里没有。修：allTypes 物化对象/边，ACTIVE 过滤只留 derivedTypes（与 runDerivations 口径一致）。

三处修复各有 1 条复发闸测试把守（机器先说话，不许重构悄悄回去）。审查其余维度 a/b/d/e/g/h/j/k OK、i OK-BUT-NOTE、d-NOTE（LinkType 存在性检查缺失，保守方向留 NOTE 不阻塞）。

**修复轮自伤回归（诚实留痕）**：按审查建议把 navOut/navIn 键分隔符从 `|` 换成 `\0` 时，**只改了构建处、没改 4 处查找处**（当时文件混入字面 NUL 字节，`file` 判 "data"、grep 全盲，核对落空——铁律 0.6「先自证工具」活实例），全量跑 6 红（导航全落空）。修：收敛为唯一 `navKey()` 函数，构建与查找同用，头注写明「不许各写一份字面量」。重跑 21/21 绿。

**首轮 17/17 绿的记录**（审查轮之前）：第三次运行 17/17，`VITEST_RC=0`。

**T1 变异反证（红对地方）**：把 `expandStateVar` 的多跳展开拆掉（主循环插 `if (n.kind === "sv" && n.hops >= 1) continue;`），只跑多跳用例：

```
MUTANT_RC=1
AssertionError: expected [ …(4) ] to include 'sv:obj_base_changzhou.loadIndex@2'
    124|     expect(tagged).toContain(`sv:${baseId}.loadIndex@2`);
```

红在**「预览漏了第 2 跳」**（断言原文点名缺 `@2`），不是「函数不存在」。变异已回退（`git status` 干净）。

**T2 基线**：本单 diff **纯加性 1332 insertions / 0 deletions**（T4 证据见下），无共享可变状态被改 ⇒ 基线行为不可能漂移；邻接既有套件在本分支复跑 `seed-demo-propagation.test.ts` + `impact-propagation.seam.test.ts` = **2 文件 23/23 全绿**（`ADJACENT_RC=0`）。

**T3 金丝雀**：见 §1.7（35 条规则由既有断言确认 / 3 跳链三枚 link key 金丝雀 / derivedProperties 假阴性教训）。测试内金丝雀：方向可达门同款链路取实例（`expect(links.length).toBeGreaterThan(0)` 先于预览断言）。

**T4 基线 diff 方向**（vs merge-base `2a1a412b`）：

```
apps/datacore/src/app.ts                           |  16 +
apps/datacore/src/sim/change-impact.ts             | 675 +
apps/datacore/test/change-impact-preview.seam.test.ts | 440 +
docs/HANDOFF-WO-CHANGE-IMPACT-PREVIEW.md           | 164 +
packages/contracts/src/sim.ts                      |  37 +
5 files changed, 1332 insertions(+), 0 deletions
```

**T5 交单三条**：见本文件最后一条 commit 的提交信息（porcelain 空 / check-branch-base RC=0 / check-merge-conflict-markers RC=0）。

**初跑失败与修正（诚实留痕，4 处）**：初跑 13/17。① `nodeKey` 对无 member 节点多一个尾点（`pr:r_ab.`）——实现 bug，修实现；② `/a/v1/derivations/run` 按设计返 202（测试断言写错 200）；③ 「feature 关⇒404」用 demo 租户测是**错的**——demo 经 L2 行业模板已把 sim.* 全开（seed.ts 注记早写着，只看 L1 defaultOn = 少追一层），改测无模板租户；④ 加 `prop` 焦点态后没重建 contracts dist，端点 zod 校验 `invalid_union` 返 500——重建即绿（「改代码必须重建 dist」的又一实例）。

## ④ 基线变化

无。本单不碰 `views/sim/**`、无屏上改动 ⇒ `scripts/sim-ux-criteria-baseline.json` 无一格可翻，不 `--tighten`、不动判据表。

## ⑤ 与其他 dev 文件重叠

- `apps/datacore/src/app.ts` / `packages/contracts/src/sim.ts`：近期有别的 dev 提交（`6160f33c` 扰动卡片化、`149909e9` 传导边业务域字段——均在集成线历史里，非并行冲突）；本单对这两个文件**纯加性**（新路由 + 新 schema），冲突面最小化。
- `apps/frontend-shell/src/views/sim/**`：**未碰**（4 个 dev 在动，UI 另开单）。
- `apps/datacore/src/sim/` 下既有文件（propagation.ts / propagation-inputs.ts / impact-analysis.ts）：未改一行，只新增 change-impact.ts。

## ⑥ 没做的部分 + 差什么 + 可派的具体单

1. **UI 呈现**（用户明确指示另开单，views/sim/** 有 4 个 dev 在动）——可派 **WO-CHANGE-IMPACT-UI**：SandboxConsole/EdgeActivePanel 挂预览面板，调 `POST /a/v1/sim/change-impact-preview`，四桶分组渲染 + 跳数标注 + unresolved 诚实位上屏（⛔ 不许把 `items:[]` 渲染成「无波及」——须区分「叶子」与「unresolved 非空」）。模型层与接线本单已备齐，UI 单零后端依赖。
2. **rejudge 桶的「实际一致」强判据**：规则重判定无持久化重算端点可差分（预览给的是结构引用面）。若要把 rejudge 也纳入集合比对，需规则求值器 dryRun 重判端点——可派 **WO-RULE-REJUDGE-DRYRUN**（evaluateExpression 已有，差一个「变更后 payload 重判 N 条规则」的只读端点）。
3. **DerivationSpec 族 demo 零种子**（§1.4「接了线没数据」）：预览支持该族且有合成世界单测覆盖，但 demo 世界无实例可演示。种子归 seed.ts 所有者（本单边界外）——可派 **WO-DERIVATION-SPEC-DEMO-SEED**。
4. **link 焦点下 DerivationSpec 目标给保守全集**（`expandSpec` 注释已注明）：结构改写后目标解析的精确差分静态不可判定，给全集并在 via 注明；精确化需要双世界（改前/改后）各解析一遍取对称差——可派 **WO-CHANGE-IMPACT-REWIRE-DIFF**（非阻塞，全集是诚实上界）。
5. **规则参数变更焦点**（coefficientRef 的 ruleKey+paramKey）：改规则参数 ⇒ 引用它的传导规则系数重估，未纳入焦点五态——可派 **WO-CHANGE-IMPACT-PARAM-FOCUS**（模型层加第六态 + effectiveCoefficient 解析镜像）。

