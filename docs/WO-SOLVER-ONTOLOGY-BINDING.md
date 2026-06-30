# WO-SOLVER-ONTOLOGY-BINDING · 求解器 schema 由本体绑定驱动（解 B3 命门）

> option A 真跑钉死 **B3**：canonical 业务求解器硬编码 `listByType(tenantId,"Order")`（`service.ts` 7 处）+ `probeTypes`（`:1721`），上传产 `Orders`/`Bases` → 拒 `需先合成 Order`。**这是"真实数据出真答案"的命门**（真物化≠真答案）。
> **修法（已有证过的范式）**：把 opt 求解器已落的 `opt-binding.ts` 本体绑定层范式，扩到 canonical 业务求解器——求解器按 **role** 经 per-tenant **SolverBinding** 取真实类型/字段，而非硬编码 type key。铁律0.5 自包含设计。

## §0 目标 + DoD-as-experience
**目标**：求解器读对象类型/字段**由本体绑定驱动**（role→租户真实类型），任意上传/合成类型经绑定都能喂求解器出真答案。
**完成定义（亲手走一遍）**：
1. realco 租户（上传产 `Orders`/`Bases`）配 `SolverBinding`（order→Orders·base→Bases·字段 qty→qtyGwh…）→ `POST /solvers/order_fullchain/invoke` → **出真答案**（非 `需先合成 Order`）。
2. demo 租户（canonical `Order`）**零绑定回退默认仍工作**（向后兼容·不回归）。
3. DF.8 接地：绑不存在的类型 → 报错不造实体。

## §1 现状（钉 file:line）
| 维度 | 现状 | 证据 |
|---|---|---|
| B3 根因 | 求解器硬编码 type key | `service.ts:260/481/482/547/554/599/652 listByType(t,"Order"/"Base"/"SopVersionRow"…)` + `:1721 probeTypes=["Base","Line","Order","Model"]` |
| 已证范式在 | OntologyBinding role→ref·DF.8 接地·R6·R14 | `solvers/opt-binding.ts:2-59`（"invoke 前统一 args 预处理层"·roleBindings·接地校验类型/字段须在已发布本体） |
| opt 端点用绑定 | `bindingId` 载落库绑定 | `app.ts:2492-2506 /opt/solve {bindingId}`·`opt_bindings` 表 migration027·5 CP-SAT 求解器已跨行业零改 |
| 缺 | canonical 业务求解器无此层 | order_fullchain/capacity_forecast/... 硬编码 |

## §2 施工范围（dev 可直接照做）
- **A. 契约 `SolverBinding`**（类比 OntologyBinding）：`{solverKey, tenantId, roleBindings: {role, typeKey, fieldMap?: Record<canonicalField, realField>}[]}`·复用 opt-binding 的 **DF.8 接地校验**（类型/字段须在本租户已发布本体）。
- **B. 求解器读类型经绑定**：抽 `resolveSolverType(ctx, solverKey, role) → typeKey`（查 SolverBinding；**无绑定回退默认 canonical key**·向后兼容 demo 零改）。把 `service.ts` 7 处 `listByType(t,"Order")` 改 `listByType(t, resolveSolverType(ctx,solverKey,"order"))`；`probeTypes` 同改经绑定。
- **C. 字段映射**：绑定带 `fieldMap`（canonical field→上传 field·如 qty→qtyGwh）·求解器读字段经映射（抽 `resolveField`）。
- **D. 端点**：`/a/v1/solvers/:key/bindings` CRUD（R2 仅本租户）·invoke 时载 binding。
- **E. 建模后自动建议绑定（不自动发布·RL4）**：A3 `derive/publish` 后，按 role 词表（确定性·借 A13 `resolveFieldRoles` 思路·无 LLM）自动产 `SolverBinding` **草案**（role→最贴切类型/字段）→ 人工确认。
- **F. 门**：`solver-binding-determinism:check` + DF.8 接地（绑外部实体报错）。

## §3 验收（FDE 亲手）
1. realco（Orders/Bases）配绑定 → invoke order_fullchain → **真答案**（curl 实证·非拒）。
2. demo（Order）零绑定 → 默认回退仍工作（全回归绿·不回归）。
3. DF.8：绑不存在类型 → 400 不造实体。
4. **两行业 R14**：电池(Order)+物流(自定义类型)同求解器绑不同类型各出答案（代码零改·仅绑定不同）。
5. 回归四包绿 + 绑定测（确定性/接地/回退/字段映射）。

## §4 不在本次范围
- 自动无人绑定发布（RL4：绑定草案须人工确认·不自动）。
- N1 多源融合（建在本绑定层之上·WO-MULTISRC-FUSION-DOMAIN）。
- LLM 角色推断（用确定性词表·LLM 仅"未显式绑定"时 advisory）。

## 本体引用与影响
- **链路**：`上传/合成类型 → SolverBinding(role→真实类型/字段·DF.8接地) → 求解器 listByType(真实类型) → 答案`（**补 B3 接缝**：本体对象↔求解器 schema）。
- **不变量**：R6（绑定确定）·R14（行业无关·非电池正则）·DF.8（接地不造实体）·R2（租户）·RL4（绑定草案人工确认）·**向后兼容**（无绑定回退 canonical 默认）。
- **断点**：解 **B3 / G-17「上传类型→求解器 schema 映射层缺失」**——这是"真实数据全流程能用"的命门。与 N1 同源（多源/多名→同一 canonical role）。
- **回写**：落地后回写 §3 链路（绑定边）+ §5（SolverBinding 不变量）+ §8（G-17 闭 / B3）。

---
*审核方自包含施工单（design+review·铁律0.5·钉真实 file:line·复用已证 opt-binding 范式·非真起服务实拍——验收 §3 由 dev 亲手 FDE）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
