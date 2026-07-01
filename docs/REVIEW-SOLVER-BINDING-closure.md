# REVIEW · SOLVER-BINDING 复验闭环（B3 命门 · G-17 · WO-SOLVER-ONTOLOGY-BINDING · 8bffa3a）

> 审核方按 ACCEPTANCE-CONTRACT **逐条亲手跑 method + 逐条引证据**。本 WO 是**真实数据出真答案的命门**（B3/G-17）：canonical 业务求解器此前硬编码 `listByType(t,"Order")`，上传/合成的任意类型喂不进 → 拒「需先合成 Order」。
> 复验环境：真 datacore（`dist` rebuilt @ `bd62857` · 内存态 · SEED_DEMO · 127.0.0.1:4001）。全链真 curl（非仅单测）。

## 判决：✅ DONE（B3 命门真闭 · 上传真实数据→配绑定→出真答案·HTTP 全链实证）

### 契约实现 vs 我起草 method 的形状差异（诚实标注·均属我起草时的猜测被 dev 实际实现细化，行为意图全中）
| 项 | 我 method 猜测 | dev 实际（更优） | 处理 |
|---|---|---|---|
| 绑定请求体 | `{bind:{kind,ref}}` 嵌套 | `{role,typeKey,fieldMap}` 扁平（契约 `SolverRoleBindingSchema`） | 按实际 API 验 |
| 拒绝文案 | "需先合成 Order" | "需先有 {resolvedType}（配 SolverBinding role=order…或合成 Order）" | 更优·引导修法·意图同 |
| 生效时机 | 建即生效 | DRAFT→**activate** 才生效（RL4 人工确认） | 更稳·验含 activate |
| demo 回退响应 | `deliveryJudge.ruleRefs=C02` | `{so,verdict,kpis,judges:{cap,kit,fin},summary(含C13/C06)}` | 行为意图（非空 canonical 答案）中 |
| 确定性门作用域 | `--filter datacore` | 根 `pnpm run …`（与其余 check-*.mjs 一致·并入 `pnpm gates`） | 更对·根作用域验 |

> 契约原则：CRITERIA 对的是**用户可观察外部行为**（拒/真答案/回退/接地/确定性），请求体形状是实现细节。行为逐条中 → 契约满足。

## 契约 7 条逐条真跑证据

| # | 断言（意图） | 类型 | 实测证据（真 curl / 门 / 测） | 判 |
|---|---|---|---|---|
| C1 | 未配绑定·realco 无 canonical Order → invoke order_fullchain 被拒（复现 B3） | curl | 新租户 realco invoke → **HTTP 400** `order_fullchain 需先有 Order（配 SolverBinding role=order 指向租户真实订单类型，或合成 Order）` | ✅ |
| C2 | 配 SolverBinding(order→真实类型+fieldMap)+激活 → invoke 出**非空真答案**(读上传值) | curl | **全链真跑**(realco4)：注册域(sales/product/material 201)→建4类型+publish(SalesOrder/ProductModel/SegmentDemand/MatBalance 全 ACTIVE)→上传4 CSV+objectify(materialized SalesOrder×2/ProductModel×2/SegmentDemand×2/MatBalance×1)→建绑定(DRAFT)→invoke **仍拒**"需先有 Order"(DRAFT 不生效)→activate(200 ACTIVE)→invoke **200 真答案** `{so:"RO-2001",verdict:"提价4%接",qty:500,segment:"储能",marginPct:8,floorPct:12,kitGap:30,material:"碳酸锂"}`——qty/segment 读上传 SalesOrder·marginPct/floorPct 经 fieldMap(gm/gmFloor)读 SegmentDemand·kitGap/material 读 MatBalance·**求解器代码零改仅绑定不同** | ✅ |
| C3 | demo 零绑定 → 200 且回退 canonical Order 仍工作(向后兼容不回归) | curl | demo(24 canonical Order)零绑定 invoke → **200** `{so:"SO-3391",verdict:"不建议接",summary:"…信用占用超限(C13)…三元正极缺口654吨(C06)…"}`·GET bindings=空 → 与修前逐字段一致(FDE 对照) | ✅ |
| C4 | DF.8：绑不存在类型/字段 → 400 且不落库 | curl | 绑 GhostType → **400** `DF.8 接地失败…类型 'GhostType'(role=order)不在本租户已发布本体内`；绑 fieldMap ghostField → **400** `…字段 'ghostField'…不在类型 'SalesOrder' 内`；GET bindings count=2(仅有效绑定)·ghost 未落库 | ✅ |
| C5 | 确定性+接地门存在且 exit 0 | gate | `pnpm run solver-binding-determinism:check` → **exit 0** `✓ 通过（回退一致性·DF.8 接地·orderFullchain 去硬编码·缓存失效·违规 0）`·并入 `pnpm gates`(package.json:56) | ✅ |
| C6 | 回归四包全绿·datacore≥69/agentcore≥66/frontend≥25·datacore 数因新增测上升 | gate | `pnpm -r build`(BUILD_OK 4 包) `&& pnpm -r test` → **exit 0**·datacore **838 passed**\|15 skipped(853·较 FIX-2 时 830 **+8** solver-binding.test.ts)·agentcore 355\|1skip(356)·frontend 299·contracts 3·llm-adapters 15 → **全绿零回归**·datacore 数如期上升 | ✅ |
| C7 | R14 行业无关单测：A/B 租户各绑各类型各出非拒答案·求解器源码零改 | unit | `vitest test/solver-binding.test.ts` → **8 passed**·含「realco 真上传→真答案」「demo 零绑定回退不回归」「R14 两行业：物流租户绑自定义类型→各出真答案(代码零改)」「R6 确定性字节一致」「DF.8×2」「回退一致性(DRAFT 不生效)」「RL4 自动草案」 | ✅ |

## 代码评审 + 本体回写（铁律0）
- **核心修**：`solvers/solver-binding.ts` `resolveSolverType(idx,solverKey,role)`（ACTIVE 绑定→绑定类型·**否则回退 `SOLVER_CANONICAL_TYPES` 默认**·P0 向后兼容）+ `resolveField`(fieldMap) + `assertSolverBindingGrounded`(DF.8) + `suggestSolverBindings`(RL4 DRAFT)。`service.ts` 去硬编码：orderFullchain 4 类 + loadContext 拓扑 + `probeTypes`(1775-1783) 全经 `resolveSolverType`。per-tenant 绑定索引缓存·写路径 `invalidateBindingCache` 清。
- **契约/仓储/迁移**：`packages/contracts/src/solver-binding.ts`(共享 schema)·`migration033 solver_bindings`·repo 三实现(memory/pg/repo.ts)。
- **本体回写齐全**：SYSTEM-ONTOLOGY.md 新增 SolverBinding 对象类型 + 事件 `L20 solver.binding_suggested` + 门 `solver-binding-determinism:check` + **G-17/B3 断点划删标 ✅已闭**（补 B3 接缝：上传类型→SolverBinding(role→真实类型/字段·DF.8)→求解器 listByType(真实类型)+fieldMap→答案）。
- **不变量**：R2(仅本租户)·R6(绑定确定配置同输入同输出)·R14(行业无关·两行业 FDE+单测实证)·DF.8(接地不造实体)·RL4(DRAFT 人工确认)。

## 距北极星（诚实）
- ✅ **B3 命门真闭**：上传真实数据(非合成)→建模发布→配绑定→激活→**出真答案**·全链 HTTP 实证。这是"真物化→真答案"的关键接缝。
- 📏 **上手摩擦仍在**（非本 WO 范围·属 B2）：fresh 租户需先注册域(未知域 400)+建类型+publish+objectify 多步；`suggestSolverBindings` 已产 DRAFT 草案降摩擦，但 UI 引导链尚薄（RESOURCE-REF/SOURCE-TRANSPARENCY WIP 中覆盖）。
- ⚠️ 我的 C2 全链跑用**上传 CSV+确定性 objectify**（无 LLM）——建模派生的 LLM 富化路径(B1)未在本次覆盖(LLM mock·非本 WO)。

---
*审核方 SOLVER-BINDING 复验闭环（B3 命门·上传真实数据→配绑定→出真答案·HTTP 全链 curl 实证 + 7 契约逐条 + 本体回写核实）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
