# PRD · generic-inference 通用 what-if 求解器（脱离电池）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-16 |
| 取代/扩展 | 新建；关闭本体 §8 **G-5 8e**（22 求解器全电池域、无通用 what-if）。多租户推演内核去锁死。 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.E 求解器 / §2.B 派生 / §3 求解链 / §5 R6 / §8 G-5） · `docs/PRD-de-battery-multitenant-config.md` |

## 0. 本体引用与影响（强制）

- **触及对象类型**（§2）：`Solver`（SOLVER_KEYS，新增 `generic_inference`）· `DerivationSpec/DerivationRun`（A4 派生引擎）· `ObjectInstance`（读，不写）· `SliceSpec`（可选：限定 what-if 影响范围）。
- **触及链路**（§3 求解链）：`ExecutionPlan --invoke_solver(generic_inference)--> DataCore Solver --dryRun recompute--> 派生影响（before/after）`。**纯读、不落真值**（区别于 Action 写回）。
- **触及不变量**（§5）：
  - **R6 确定性**：同 (objects, changes, 派生规格版本) → 同输出；dry-run 不引入随机/时钟。
  - **R4 真值经 Action**：generic-inference **不写真值**（dry-run），故不违反；若用户要落地，再走 Action（与现有写回一致）。
  - **R2 tenant_id**：读对象/派生规格/链路全程租户隔离；A6 行级过滤。
- **关闭/影响断点**（§8）：关闭 **G-5 8e**（通用 what-if 缺失）；让任何**有派生规格的租户/行业**免费获得 what-if（不限电池）。
- **门禁**（§7）：`chain:check`（若有场景声明 generic_inference 需注册）· `ontology:check`（SOLVER_KEYS 计数同步本体 §2.E）· 确定性回归 · **无副作用回归**（dry-run 后对象库字节不变）。
- **回写承诺**：落地后回写本体 §2.E（SOLVER_KEYS +1 → 23）· §3（求解链补 generic_inference dryRun 边）· §8（G-5 8e 标 ✅）。

## 1. 目标 / 非目标

**目标**：一个**行业无关**的 what-if 求解器——给定"假设某对象的属性变 Δ"，**用本体自己的派生规格（A4）**前向重算受影响的派生属性，返回 before/after + 影响面，**不落真值**。任何有 `DerivationSpec` 的租户/行业即得 what-if，无需写新求解器。

**非目标**：不替换电池域的专用求解器（capacity_forecast 等仍是电池行业的专家逻辑）；不做优化/排程（仅前向重算）；不写真值（要落地走 Action）。

## 2. 现状与缺口（对照代码）

| # | 现状（file:line） | 缺口 |
|---|---|---|
| C-1 | 22 个 SOLVER_KEYS 全电池域（`solvers/service.ts:14`） | 无通用 what-if，换行业无推演 |
| C-2 | 派生引擎 `recompute(ctx, changes)` 做拓扑重算（`ontology-core.ts:339`），但**写真值 + 历史 + run**（`:481-483`） | 无 dry-run；直接复用会污染对象库 |
| C-3 | `evaluate(ast, {self, navigate, warn})` 是纯函数（`:478`） | 可复用做 dry-run 计算 |

## 3. 设计（复用优先）

### 3.1 dry-run 重算（修 C-2/C-3）【派生引擎扩 dryRun】
- `recompute` 增 `opts.dryRun?: boolean`。dryRun 时：
  - **先克隆**受影响对象（`structuredClone(obj)`），在克隆上 `evaluate` + 赋值（**绝不 put、绝不 mutate 原对象**，避免污染 R6/无副作用）。
  - **不写** objects/history/derivation_value_run。
  - 返回 `{ objId, prop, before, after, inputs }[]`（before=原派生值，after=假设后）。
- 提取纯计算核（evaluate + navigate）为可在克隆图上跑的内层，持久化路径与 dry-run 共用，杜绝两套漂移。

### 3.2 generic_inference 求解器（绿地，注册）
- 入参：`{ changes: [{ objectType, objectId, prop, value }], scope?: sliceKey }`。
- 流程：① A6 读出涉及对象（scope 限定可选）→ ② 调 `recompute(ctx, changes, { dryRun:true })` → ③ 汇总受影响派生属性 before/after + 变化量 → ④ 渲染形状对齐前端（table：对象/属性/before/after/Δ + kpi 汇总）。
- 注册进 `SOLVER_KEYS`（+1=23），输出形状走标准渲染模板（R11 全链）。

### 3.3 前端消费（可选，后续）
- 任何视图/对话坞可 `invoke_solver(generic_inference, {changes})` → 通用 what-if 结果；与 `<Provenance>` 溯源联动（inputs 即来源）。

## 4. 契约 / 端点
- 求解器经既有 `POST /a/v1/solvers/generic_inference/invoke`（统一求解器端点，无需新端点）。
- `recompute` 签名加 `dryRun`（datacore 内部，不入 contracts）。
- `RecomputeResult` 增 dry-run 分支返回 before/after（datacore 内部类型）。

## 5. 关键流程
```
invoke_solver(generic_inference, { changes:[{objectType:"X",objectId:"o1",prop:"p",value:v}] })
  → A6 读对象 → recompute(ctx, changes, dryRun:true)
       └─ 克隆受影响对象 → 拓扑 evaluate 派生 → 不持久化
  → 汇总 [{obj,prop,before,after,Δ}] + kpi → table/kpi 渲染（+Provenance inputs）
真值不变（无副作用）；要落地 → 另走 Action 写回（R4）
```

## 6. 非功能（§5 逐条）
- **R6**：dryRun 纯函数 + 克隆，同输入同输出；测试 mock、无网络/时钟。
- **R4**：不写真值。**无副作用回归**：dryRun 前后 `repos.objects.list` 字节级不变。
- **R2/A6**：读出全程租户 + 行级过滤。
- **R1**：前端引契约，不重定义。

## 7. 验收（DoD）
- `pnpm -r build && test` 全绿 + 新测试：① 通用 what-if 在**非电池**的小本体（如 SY3 的 vertical-farming Farm/Batch）上前向重算正确；② **无副作用**（dryRun 后对象库不变）；③ 确定性（重跑一致）。
- `ontology:check` 绿（SOLVER_KEYS 23 同步本体 §2.E）；`chain:check` 绿。
- 本体 §2.E/§3/§8 已回写（G-5 8e ✅）。

## 8. 分期
- **P1**：`recompute` dryRun（克隆+不持久化）+ 无副作用回归。
- **P2**：`generic_inference` 求解器注册 + 渲染形状 + 通用本体（vertical-farming）what-if 回归。
- **P3**（可选）：前端通用 what-if 入口 + Provenance 联动。
