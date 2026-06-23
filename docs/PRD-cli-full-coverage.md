# PRD — CLI 能力全覆盖（操作目录自动派生 `deriveOperationCatalog` + 覆盖门 `cli-coverage:check`）

> 版本 v1.0 · 状态 DRAFT · 落地分支 `claude/vigilant-knuth-b1nmxn` · **增量**（CLI/A15/R15 已在，补"全覆盖 + 构造上不回潮"）。
> 目标读者：本仓实现 agent。先读：根 `CLAUDE.md`、`docs/SYSTEM-ONTOLOGY.md`（本 PRD grounded 于 v1.0）。
> 一句话：CLI（`scripts/platform-cli.mjs` 18 命令 + `do` 万能 NL + `shell` REPL）+ **R15「CLI 对等」** + `cli-parity:check` 门**已在**；但 `OPERATION_CATALOG` 是**手维护、域级**（~18 op），**约 10 个能力区无 CLI op**，且新能力忘登记门照绿（catalog rot）。本 PRD = 把操作目录**从能力注册表自动派生** + 加**注册表↔目录覆盖门**，使"每个功能 CLI 可达"且**构造上不回潮**（落实 **R16 能力环**）。**不重建 CLI。**

---

## 本体引用与影响（铁律0 · `prd:check` 强制）

- **触及不变量**：**R15**（CLI 对等——主，每对外能力必须有 CLI 命令或 `uiDeepLink`）· **R16**（发育闭环·**能力环 = 目录从注册表自动派生 `deriveOperationCatalog`/`FEATURE_REGISTRY`/`SOLVER_CATALOG`，非手维护**——本 PRD 是其落地）· **R6**（确定性派生，同注册表同目录字节一致）· **R3**（entitlement 先于 authz——CLI op 同受 feature 门）· **R2**（租户隔离）· **R7**（错误信封统一）。
- **触及断点**：**G-7**（LLM 用途枚举写死不可扩展——LLM provider/binding 正是"无 CLI op"缺区之一，本 PRD 顺带把它纳入覆盖）。
- **触及对象类型（§2）**：`OperationCatalogEntry`/`OPERATION_CATALOG`/`classifyOperation`（§116，`contracts/operation-intent.ts`）· `SOLVER_KEYS`（§88，`solvers/service.ts:14`，32 个）· `FEATURE_REGISTRY`（`apps/agentcore/src/features/registry.ts`，VIEW/BLOCK/ACTION 级）· `Scenario`/`SceneEntry`（§118/§119，views 经 `ask`/`scenarios` 可达）。
- **触及链路（§3）**：`CLI → POST /b/v1/operations/classify → {QUERY:ask / OPERATION:模块}`（§116 通用操作外壳）。
- **触及门禁（§7）**：扩 `cli-parity:check`（现验"目录↔CLI"）→ **新增 `cli-coverage:check`**（验"注册表↔目录"）。
- **触及域（§10）**：D7 编排（CLI 客户端）· D11 治理元（R16 能力环自动派生）。
- **回写承诺**：实现后回写本体 **§5 R16**（能力环自动派生落地）+ **§7**（新门）+ **§2.H A15**（目录改为自动派生）。

---

## 0. 现状（grounded audit，实测 file:line）

- **CLI 入口**：`scripts/platform-cli.mjs`（336 行，run 表 :328）—— 18 命令 `login·ask·do·shell·import·model·rule·solve·synth·build·generate·types·scenarios·approve·whoami·tickets·claim·grow`；**`do`** = NL 万能（:289 → `/b/v1/operations/classify`）；**`shell`** = 交互 REPL（:277）。
- **操作目录**：`OPERATION_CATALOG`（`contracts/operation-intent.ts:44`）≈18 op（import/model/browse/rule/solve/synth/build/scenario/approve/agent/calibration/policy/signal/quarantine/features/growth/kb/bootstrap）；分类器 `classifyOperation`（:96，确定性 R6）。
- **门**：`cli-parity:check`（`scripts/check-cli-parity.mjs`）现绿——`cli-parity-baseline.json` = `{"missingImpl": []}`。
- **覆盖现状**：views 全经 `ask`/`scenarios` 可达；32 求解器经 `solve <key>` 可达；~18 操作域有子命令。
- **缺口（真）**：
  | 类型 | 说明 |
  |---|---|
  | **~10 能力区无 op** | 时序/聚合(A8)·模拟时钟 tick(A8)·**LLM provider/binding(G-7)**·config-bundle 迁移(OC3)·evals·meta-ontology/影响分析·slices/slice-planner·lineage 溯源·OC 平台配置(prompt/budget/calendar/writeback)·replay/ops-schedule —— `OPERATION_CATALOG` 无对应条目 |
  | **目录手维护 → rot** | 目录是显式数组；`cli-parity:check` 只验"**目录↔CLI**"，**不验"注册表↔目录**" → 新增能力忘登记，门照绿、CLI 却缺 |
  | **部分 GUI 深链** | 如 `solve` 的 `uiDeepLink:/admin/solvers/new`（可发现、执行跳 GUI） |

> 结论：不是"没 CLI",是"**覆盖未到每个功能 + 无机制保证不回潮**"。修法 = R16 能力环（自动派生 + 覆盖门）。

## 1. 设计（统一·不分服务侧）

### 1.1 `deriveOperationCatalog`（注册表 → 目录，确定性 R6）—— `contracts/operation-intent.ts`（扩）
从平台**能力注册表**确定性派生操作目录，取代/合并手维护数组：
- **求解器**：`SOLVER_KEYS`（32）→ 每 key 派生 `{op:"solve:<key>", endpoint:"/a/v1/solvers/<key>/invoke", cliCommand:"solve <key>", r4:false}`。
- **视图**：`FEATURE_REGISTRY` 的 `view.*` → `{op:"view:<key>", uiDeepLink:"/<route>", cliCommand:"scenarios"（经 launch/ask 可达）}`。
- **缺区（~10）**：新增显式 **`OPERATION_REGISTRY`**（`contracts/operation-registry.ts`）逐条登记：timeseries/clock/llm-provider/config-bundle/evals/meta/slice/lineage/oc-config/replay —— 每条 `{op, label, keywords, endpoint, requiredSlots, r4, cliCommand | uiDeepLink}`。
- **合并**：`deriveOperationCatalog() = 求解器派生 ⊕ 视图派生 ⊕ OPERATION_REGISTRY ⊕ 手写 override`（去重，确定性排序）→ 即新的 `OPERATION_CATALOG`（`classifyOperation` 消费它，零改）。

### 1.2 `cli-coverage:check` 门（注册表↔目录 parity）—— `scripts/check-cli-coverage.mjs`（新）
- 枚举**全能力**：`SOLVER_KEYS ∪ FEATURE_REGISTRY ∪ OPERATION_REGISTRY ∪ 对外端点清单`。
- 断言：每个能力在 `deriveOperationCatalog()` 输出里有 `cliCommand` 或 `uiDeepLink`，否则**红**。
- 棘轮基线 `scripts/cli-coverage-baseline.json` 防回潮；并入 `pnpm gates`。
- **与 `cli-parity:check` 分工**：parity 验"目录条目都可调"（目录↔CLI）；coverage 验"能力都进目录"（注册表↔目录）—— 两道合起来 = "每个功能 CLI 可达"闭环。

### 1.3 CLI 命令补全 —— `scripts/platform-cli.mjs`（run 表 :328 扩）
为缺区补子命令（`timeseries·clock·llm·config·evals·meta·slice·lineage·replay…`），薄客户端打对应公开 REST（OBO）；不宜内联的（复杂可视化）登记 `uiDeepLink`。

### 1.4（可选）GUI `do` 入口 —— 补反向洼地
前端 `CommandPalette`/`QueryDock` 接 `/b/v1/operations/classify`：QUERY 走对话坞、OPERATION 走 `uiDeepLink` 跳管理页 → 网页也能"一句话驱动任意操作"。

## 2. 契约（zod）

```ts
// contracts/operation-registry.ts（新，补缺区）
export const OperationRegistryEntrySchema = z.object({
  op: z.string(), label: z.string(), keywords: z.array(z.string()),
  endpoint: z.string(), requiredSlots: z.array(z.string()).default([]),
  r4: z.boolean().default(false),
  cliCommand: z.string().optional(), uiDeepLink: z.string().optional(),  // 二选一（cli-coverage:check 强制）
});
export const OPERATION_REGISTRY: z.infer<typeof OperationRegistryEntrySchema>[] = [ /* ~10 缺区 */ ];
// contracts/operation-intent.ts：OperationCatalogEntry += source: z.enum(["DERIVED","MANUAL"]).default("MANUAL")
// deriveOperationCatalog(): OperationCatalogEntry[]  // 求解器⊕视图⊕OPERATION_REGISTRY⊕override，确定性排序
```

## 3. 现有文件锚点（exact · 已 grep 核实）

| 文件 | 改 |
|---|---|
| `packages/contracts/src/operation-intent.ts:44` `OPERATION_CATALOG` | 改为 `deriveOperationCatalog()` 输出；`OperationCatalogEntry += source`；`classifyOperation:96` 零改 |
| `packages/contracts/src/operation-registry.ts`（新） | `OPERATION_REGISTRY` 补 ~10 缺区 |
| `apps/datacore/src/solvers/service.ts:14` `SOLVER_KEYS` | 只读消费（派生 solve op） |
| `apps/agentcore/src/features/registry.ts` `FEATURE_REGISTRY` | 只读消费（派生 view op） |
| `scripts/platform-cli.mjs:328` run 表 | 补缺区子命令 |
| `scripts/check-cli-coverage.mjs`（新）+ `cli-coverage-baseline.json`（新）+ `package.json "gates"` | 新覆盖门并入 |
| `apps/agentcore/src/server.ts:1701` `/b/v1/operations/classify` | 不改（已消费 catalog） |
| （可选）`apps/frontend-shell/src/components/ScenarioLauncher/CommandPalette.tsx` | 接 `/b/v1/operations/classify`（GUI do） |

## 4. 开发顺序 DF（依赖排序）

- **DF.1 缺区审计**（本 PRD §0 已起）：枚举 `SOLVER_KEYS ∪ FEATURE_REGISTRY ∪ 端点` − `OPERATION_CATALOG` = 精确缺口清单。**无代码。**
- **DF.2 `OPERATION_REGISTRY` + CLI 命令**：补 ~10 缺区条目 + `platform-cli.mjs` 对应子命令（cliCommand 或 uiDeepLink）。**依赖 DF.1。**
- **DF.3 `deriveOperationCatalog`**：求解器/视图/registry 自动派生 + 合并 override；`classifyOperation` 切到它。**依赖 DF.2。**
- **DF.4 `cli-coverage:check` 门**：注册表↔目录 parity + 基线 + 并入 gates。**依赖 DF.3。**
- **DF.5（可选）GUI `do`**：前端接 `operations/classify`。**依赖 DF.3。**
- 起手 **P0 = DF.1+DF.2**（把缺口补齐、立即可用），紧接 **DF.3+DF.4**（自动化 + 不回潮）。

## 5. 门禁 + 测试

- 新门 `cli-coverage:check`（`pnpm gates`）：任何注册能力无 CLI 命令/深链即红。
- 测试（确定性、无网络）：`derive-operation-catalog`（注册表→目录，同输入字节一致 R6 + solve/<key> 全 32 覆盖）· `cli-coverage`（缺区补全后 baseline 全绿；删一条 registry 命令→红）· `operation-registry`（每条有 cliCommand 或 uiDeepLink）。

## 6. 验收

- A1 `deriveOperationCatalog()` 输出覆盖 `SOLVER_KEYS`(32) 全部 + `FEATURE_REGISTRY` view 全部 + `OPERATION_REGISTRY` 缺区全部。
- A2 `pnpm cli-coverage:check` 绿；故意删一条 registry 对应 cliCommand → 红（证门有效）。
- A3 `platform do "<任一缺区自然语>"`（如"看常州时序"/"配 LLM provider"）→ 正确路由到对应操作或 uiDeepLink。
- A4 R6：同注册表 `deriveOperationCatalog()` 重跑字节一致。
- A5 四包 `pnpm -r build && test` 全绿 + `pnpm gates`（含新门）全过 + **回写本体 §5 R16/§7**（否则 `ontology:check`/`prd:check` 红）。

---

> 状态：**v1.0 DRAFT，待评审**。grounded 于本体 v1.0。核心 = CLI 已在，补"操作目录自动派生 + 注册表覆盖门"使**每个功能 CLI 可达且不回潮**（落实 R16 能力环）。只定义设计，落地听指示。
