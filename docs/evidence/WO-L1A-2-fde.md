# WO-L1A-2 · Graph Builder（AST→RequirementGraph 八段 Pipeline）+ 三白名单门 —— FDE 证据

> PRD `docs/PRD-L1A-requirement-graph-engine.md` §4.2/§7 · WO-L1A-2。
> 范围：**只落 builder 纯函数 + 门**（不接线编排·旁路挂载归 WO-L1A-3）。additive·纯函数·R6·三白名单 by-construction。
> 依赖 L1A-1（`requirement-graph.ts` parser + 契约）已在基线（commit e250bb5）。

## 交付物

| 制品 | 路径 |
|---|---|
| Graph Builder 纯函数（八段 Pipeline） | `apps/agentcore/src/growth/requirement-graph.ts`（`buildRequirementGraph` + `VALID_SOLVER_KEYS`/`VALID_ROLE_TYPES`/`linkKindOf`·续扩 L1A-1 文件） |
| 三白名单门 | `scripts/check-requirement-graph.mjs` → `pnpm requirement-graph:check`（并入 `pnpm gates`·package.json） |
| 单测（C1–C4） | `apps/agentcore/test/requirement-graph-builder.test.ts`（8 tests·全绿） |
| 本体回写 | `docs/SYSTEM-ONTOLOGY.md` §7 登记 `requirement-graph:check` + `node scripts/build-ontology-slices.mjs`（11 切片重生成·drift check 绿） |

**复用不重造**（PRD §2.2·NG1）：`SOLVER_COVERAGE`（求解器候选）· `SOLVER_DATADEP`（数据依赖）· `DATADEP_ROLE_CANONICAL`（角色→类型）· `expandHiddenRequirements`（L0 隐性需求·**不新造引擎**）· `deriveSliceTargetCandidates`（切片目标）· `HiddenReqGraph.edges` 真 LinkType 图（本体边·断链止步）。零重造图骨架。

---

## C1 · AST→RG 真跑样例（八段 Pipeline·三白名单 by-construction）

输入 AST（问句「未来30天常州基地PACK02产线停机20%，影响哪些订单？」·problemClass=`affected_scope_enumeration`·intentKey=`affected_orders`）→ `buildRequirementGraph` 产 **22 节点 / 30 边**：

**节点**（object.ontologyType 全 ∈ 发布类型·solver.solverKey 全 ∈ SOLVER_REGISTRY·data.roleType 全 ∈ DATADEP_ROLE_CANONICAL）：
```
[question] ...影响哪些订单？        ref=affected_orders          (ast:question)
[object]   常州基地  onto=Base       ref=cz                       (ast:entity)
[object]   PACK02   onto=Line        ref=PACK02                   (ast:entity)
[object]   订单     onto=Order       ref=null（类型级提及）        (ast:entity)
[solver]   affected_orders           solver=affected_orders       (coverage:affected_scope_enumeration)
[data]     base/order/model          role∈canonical               (datadep:affected_orders)
[object]   Model/Shipment            onto∈发布类型                 (hidden_req·图一跳)
[solver]   capacity_rollup/mitigation_select/multi_plan_compare/
           outsourcing_split/what_if_displacement                 (hidden_req·L0 反查)
[data]     line/process/equipment    role∈canonical               (hidden_req:capacity_rollup)
[constraint] OBJECTIVE:成本          ref=成本                     (ast:constraint)
[goal]     MIN:成本                                               (ast:objective)
[event]    SHUTDOWN  onto=Line        value="20%"（保留原文）       (ast:action)
[time]     FUTURE_WINDOW(30,DAY)                                  (ast:time)
```

**边（经真 LinkType 图·断链止步·真 label 存 reason·R13）**：
```
object:Base:cz    -[has]->       object:Line:PACK02   (link:base_has_line)
object:Line:PACK02 -[produces]-> object:Model         (link:line_produces_model)
object:Model      -[depends_on]-> object:Order        (link:order_uses_model)
object:Order      -[fulfills]->  object:Shipment      (link:order_ships_via)
question -[requires]-> solver（×6）
solver   -[depends_on]-> data（据 SOLVER_DATADEP 映射）
event:SHUTDOWN -[affects]-> object:Line:PACK02        (action:SHUTDOWN)
constraint/goal -[optimizes]-> solver:affected_orders
```
→ **Base→Line→Model→Order→Shipment 语义链经真 LinkType 单跳连通·无幻连**（无 Base→Order 直边，因图无该直边·断链止步）。`coverageScore=1`（零幽灵）。

---

## C2 · 三白名单测谎牙齿（green→red 自证）

门 `scripts/check-requirement-graph.mjs` 四道断言全绿：
```
· ①存在性：对抗性 AST（塞幽灵 GHOST_TYPE_ø）→ 22 节点全 ∈ 三真白名单（零幽灵）·幽灵被剔除+记 gap。
· ②测谎：注入 3 幽灵（solver/type/role）→ 校验器抓出 3 项越界节点（green→red 有牙齿·自证）。
· ③白名单：VALID_SOLVER_KEYS（58 = coveredSolverKeys 58 ∪ SOLVER_DATADEP 28）全 ∈ SOLVER_REGISTRY（58 注册·零幽灵）。
· ④源码：builder 三白名单 filter + expandHiddenRequirements 复用在位·契约字段无漂移。
✓ requirement-graph:check 通过    EXIT=0
```

**亲验 green→red（真牙齿）**：把 builder `if (!publishedTypes.has(ontologyType))` filter 改为 `if (false)`（放幽灵进图）→ `pnpm -r build` 重构 → 门：
```
✗ ①存在性：buildRequirementGraph 产出白名单外幽灵节点（造假）：object.ontologyType:GHOST_TYPE_ø
✗ ①存在性：幽灵类型 GHOST_TYPE_ø 混入图（filter 失效）
✗ ④源码：buildRequirementGraph 缺白名单守卫 publishedTypes.has
EXIT=1
```
revert filter → 重构 → 门 **EXIT=0**。证「若 builder 漏 filter 让幽灵漏出，本门必红」。
门层 solver 白名单用 **datacore `REGISTRY_SOLVER_KEYS` 真值**对账（非契约层近似）——真牙齿。

---

## C3 · 下游投影逐值对账（solver/data/slice）

| 投影 | builder 产出 | 权威源 | 一致 |
|---|---|---|---|
| `solverCandidates` ⊇ | `["affected_orders", ...hidden]` | `SOLVER_COVERAGE[affected_scope_enumeration]=["affected_orders"]` | ✓ 含全部 |
| `dataRequirements` | `[base,equipment,line,model,order,process]`（各 minRows=1） | `SOLVER_DATADEP.affected_orders.requires=[base,order,model]` ∪ hidden 求解器 datadep 并集 | ✓ 逐值 |
| `sliceTargets` | `{rootType:"Base",targets:["Model","Order"]}` | `deriveSliceTargetCandidates("affected_orders","Base")={rootType:"Base",targets:["Model","Order"]}` | ✓ `.toEqual` |

（单测 C3 `.toEqual(deriveSliceTargetCandidates(...))` 断言逐值一致·非近似。）

---

## C4 · R6 确定性 + 隐性需求复用 L0

- **双跑字节一致**：`JSON.stringify(buildRequirementGraph(x)) === JSON.stringify(buildRequirementGraph(x))`（generatedAt 注入固定·无随机/时钟/LLM·节点插入序 + 投影 sort 恒定）。单测 C4 断言。
- **隐性需求经 `expandHiddenRequirements`（不新造）**：`hidden_req` 源节点（Model/Shipment 类型·capacity_rollup 等求解器）全经 L0 三白名单 by-construction·全 ∈ 三真白名单；`hiddenReqEnabled=false` 时零 `hidden_req` 节点（回退对照）。
- **graph 缺失诚实降级**：无对象节点·无本体边·仍出 solver/data 投影（不臆造类型）。

---

## 收尾门禁

- **4 包 build 绿**：`pnpm -r build` ✓
- **builder 单测**：`vitest run test/requirement-graph-builder.test.ts` → 8 passed ✓
- **新门**：`pnpm requirement-graph:check` EXIT=0 ✓（并入 `pnpm gates`）
- **本体切片无漂移**：`build-ontology-slices.mjs --check` EXIT=0（hash f19cfe42a4de9408·11 切片）✓
- **完整 `pnpm gates`**：见提交报告 EXIT=0。

**诚实边界**：本 WO 只落 builder 纯函数 + 门·**未接线编排**（orchestrator 旁路挂载 / 持久化 / 读端点 / 真起双服务真调求解器闭环归 WO-L1A-3）。此处「真跑」= builder 纯函数真跑真数据结构（非冒烟）·下游投影逐值对账；端到端真起服务闭环（V5）在 L1A-3 复验。
