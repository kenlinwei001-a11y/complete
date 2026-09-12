# WO-DATACORE-LAZY-SOLVER-CONTEXT · SolverContext 按需加载（冷启 187→≤80ms）

> **来源**：跨域性能 PRD 的 FR-8（DataCore 上下文按需加载）抽出为**独立 datacore 性能单**——与跨域路由（`WO-QOS-CROSS-DOMAIN-UNIFIED`）**正交**，不同 dev 可并行。
>
> **一句话**：`loadContext` 现在对**每个** solver 都全量加载**核心 10 类对象表**（冷启 152ms 花在这）。让每个 solver 声明 `requiredObjectTypes` → 只加载它真需要的那几类·未声明保持全量（向后兼容）。
>
> **头号判据（KILL-MOCK-RED·先说死）**：裁剪加载的结果**必须与全量加载逐字节一致**。漏声明一个类型 → solver 拿到**空数组** → 出**错数字而非报错**（比崩溃更毒·静默污染 R13）。SEAM-EQ 是唯一真门。

---

## 0. 本体引用与影响
- **对象类型**：无新增。触及 **DataCore 求解上下文加载层**（`SolverService.loadContext`）——非 solver 数学。
- **链路**：`invoke_solver → loadContext（全量）→ solve` 的**加载半**收窄为按需；求解半零改。
- **不变量**：**R6 确定性**（裁剪不改结果·SEAM-EQ 逐字节守）· **R2 租户隔离**（loadContext 已 tenantId 隔离·不动）· **R13 可溯源**（不造数·空≠0）。
- **断点**：无新增；这是纯性能收窄·不碰任何门。
- **回写**：性能优化·不改链路/事件/对象 → **本体无需回写**（仅注释级）。

## 0.1 🚦 起手式 · base 分支（先 fetch 再开）
```bash
git fetch origin claude/inspiring-gates-aqczjg
git checkout -B claude/handoff-wo-datacore-lazy-context origin/claude/inspiring-gates-aqczjg
```

---

## 1. 🚦 范围边界（只碰这些）
**改**
- `apps/datacore/src/solvers/service.ts` —— `loadContext` 加 `opts.solverKey` 裁剪分支 + 新增静态 `SOLVER_REQUIRED_TYPES` 表 + solver 派发处（:3578/:3635）把 solverKey 透传进 loadContext。
- `apps/datacore/src/solvers/types.ts` —— 仅注释（`SolverContext` 字段结构**不改**）。

**新建**
- `apps/datacore/test/solver-context-lazy-loading.seam.test.ts` —— SEAM-EQ 等价门。

**不碰**
- solver 数学 / `SolverContext` 字段结构 / **扩展层 `withExtended`**（那 10 类 E6b 已经是按需·见 §2）/ agentcore / 前端 / 契约 / SCENARIO_CATALOG。
- **不加** solver 结果缓存（红线·破 R13 数据新鲜度·收益 50→1ms 不值）。

---

## 2. 现状锚点（file:line · 已核对）
| 锚点 | 位置 | 说明 |
|---|---|---|
| `loadContext` 定义 | `service.ts:3396` | `(tenantId, visibleOrders?, opts?:{withExtended?})` |
| **核心 10 类全量** | `service.ts:3401-3413` | `Base/Line/Process/Equipment/MaintPlan/Model/Order/Shipment/Segment/DataSourceHealth` 一律 `Promise.all` 全表扫——**FR-8 就治这里** |
| `certByModel`（派生） | `service.ts:3414-3428` | 由 `Line`+`Model`+`model_certified_on` link 派生——**需它的 solver 必须连带声明 Line+Model** |
| `params`/`rules`/`ruleSetVersion` | `service.ts:3429-3436` | 便宜·共享·**永远加载**（别裁） |
| 扩展 10 类（E6b） | `service.ts:3440-3454` | **已经按需**（`opts.withExtended`·仅 13 扩展 solver·注释 :3437）——**本单不动这层** |
| `isSynthProvenance`（谓词） | `service.ts:3458` | 扫连接/数据集·**永远构造**（便宜谓词·别裁） |
| **无 solverKey 的调用方** | `simclock.ts:289`·`sop.ts:86/176/471`·`planviews.ts:52/199/377/410`·`calibration/*.ts` | 这些不传 solverKey → **必须保持全量**（向后兼容·别退化） |
| solver 派发（有 solverKey） | `service.ts:3578`·`service.ts:3635` | invoke/runWithParams——**在这把 solverKey 透传进 loadContext** |
| solver key 清单 | `service.ts:36-58` `SOLVER_KEYS` | `SOLVER_REQUIRED_TYPES` 表就建在旁边 |

---

## 3. 建法（三步）
### 步 1 · 声明表 `SOLVER_REQUIRED_TYPES`（service.ts·SOLVER_KEYS 旁）
```ts
// 每个核心 solver 声明它真读的**核心对象类型**（未列 = 不需要 → 裁掉）。
// ⚠ 派生结构连带声明：需 certByModel → 连带 "Line"+"Model"；需 baseName/baseProvenance → 连带 "Base"。
export const SOLVER_REQUIRED_TYPES: Record<string, ObjectType[]> = {
  affected_orders: ["Base", "Order", "Shipment", "Segment"],
  yield_diagnosis: ["Base", "Line", "Process", "Equipment"],
  // …逐个核心 solver 声明（用真跑 SEAM-EQ 校对·漏一个立刻红）
};
```
**只声明确有把握的 solver·其余不列 → 走全量兜底**（诚实·不硬凑·漏声明宁可全量也不出错数）。

### 步 2 · `loadContext` 裁剪分支
- 签名加 `opts.solverKey?: string`。
- 若 `opts.solverKey && SOLVER_REQUIRED_TYPES[solverKey]` → 只 `listByType` 声明的核心类型，其余核心类型置 `[]`；**`params`/`rules`/`ruleSetVersion`/`isSynthProvenance` 照常构造**（便宜·共享）；扩展层仍按 `withExtended`。
- 否则（无 solverKey / 未声明）→ **现状全量核心加载**（逐字节不变）。

### 步 3 · 派发处透传 solverKey
- `service.ts:3578`·`:3635` 的 `this.loadContext(...)` 补 `solverKey`（仅走 flag 开时·见 §5）。
- **无 solverKey 调用方（simclock/sop/planviews/calibration）一律不传** → 全量不变。

## 4. 契约
- `SolverContext` 字段结构**零改**（核心数组本就是必填·裁剪时置 `[]`——但**仅当该 solver 声明不需要**·所以空是正确非丢数）。**无 contract 改动·无 golden 改动。**

## 5. 门 / feature（暗发·defaultOn:false）
- `dc.lazy-solver-context`（datacore `features.ts` 注册·`reasoningTraceEnabled` 同款 helper）。**关 → loadContext 全量·逐字节现行为**（under-declaration 风险默认为零·灰度验证 SEAM-EQ 全绿再开）。
- 可选 demo override：`seed.ts`（灰度演示态开）。

## 6. SEAM 验收（`solver-context-lazy-loading.seam.test.ts` · **头号判据 = SEAM-EQ 亲手真跑**）
1. **SEAM-EQ（头号·最重·治静默污染）**：对 `SOLVER_REQUIRED_TYPES` 里**每个**声明的 solver，同 tenant 同 seed 同参数 → **裁剪加载结果 `≡` 全量加载结果逐字节一致**（`invoke(solverKey)` flag 开 vs 关·`JSON.stringify` 或结构深比一致）。**漏声明一个类型 → 该 solver 结果变化 → 立刻红。** 这是防"空数组→错数字"的唯一真门。
2. **SEAM-PERF**：新服务冷启首次调用某已声明 solver → loadContext 加载对象类型数 < 10 且冷启 ≤80ms（对照：flag 关 = 全量 10 类 187ms）。
3. **SEAM-COMPAT**：未声明的 solver + 非 solver 调用方（simclock/sop/planviews 例）→ 全量加载·逐字节不变。
4. **SEAM-FLAG-OFF（零回归）**：`dc.lazy-solver-context` 关 → loadContext 逐字节现行为（所有既有 datacore 测试不变）。

## 7. DoD
- 四包 `pnpm -r build && pnpm -r --workspace-concurrency=1 test` 全绿（datacore 勿并发多 vitest）。
- `ontology:check` 51/51 不变（无新事件/对象）。
- a14 evals 不回归（solver 结果不变·只加载更快）。
- **审核方头号判据**：**亲手真跑 SEAM-EQ**（对每个声明 solver 比裁剪 vs 全量逐字节一致）——绿测试≠能用·这门专防漏声明静默出错。

## 8. 金值 / 派发纪律
- **无新 solver / 事件 / 对象类型 → 不动 golden 计数。**
- handoff 分支 `claude/handoff-wo-datacore-lazy-context`；push 后审核方隔离复验（四包 gate + **SEAM-EQ 亲手真跑**）→ cherry-pick 上 canonical。
- **声明宁缺毋滥**：没把握的 solver 不列 `SOLVER_REQUIRED_TYPES`（走全量）·比漏声明出错数强。

## 9. 非目标（钉死）
- ❌ 改 solver 数学 / `SolverContext` 字段结构。
- ❌ 动扩展层 `withExtended`（10 类 E6b 已按需·别重造）。
- ❌ 加 solver 结果缓存（红线·破 R13）。
- ❌ 跨域路由 / 多意图（那是 `WO-QOS-CROSS-DOMAIN-UNIFIED`·本单只碰加载层）。
