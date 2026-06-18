# PRD · 系统本体自反落库与活查询面（Dogfooding：用平台分析平台自身）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-18 |
| 取代/扩展 | **落实** `docs/SYSTEM-ONTOLOGY.md` §9 / §10.5 的 dogfooding 远期 + `docs/TODO.md` Tier 4 #12/#13/#14；不新建业务模块，**复用平台自有本体引擎承载平台自身** |
| 先读 | 根 `CLAUDE.md` · **`docs/SYSTEM-ONTOLOGY.md`（尤其 §9 演进 / §10 系统自我域）** · `docs/OPERATING-MODEL.md` · `docs/prd-ontology-index.json` |
| 核心一句话 | 把系统本体（`SYSTEM-ONTOLOGY.md` + `prd-ontology-index.json`）从"**只能读散文 + grep 的文档**"升级为"**平台里一组可查询、可切片、可影响分析的对象**"——解析为元租户 `__platform__` 的 `ObjectInstance/Link`，开 `/a/v1/meta/*` 活查询面 + MCP 工具，让人和 Agent 能问运行中的系统"改 R14 影响什么 / 哪些断点未修 / 这个需求拉动了哪些功能"。**markdown 仍是单一来源，对象是确定性投影。** |

> **本 PRD 自身即一次 dogfooding**：它用本体模板、带《本体引用与影响》§0，描述"如何让本体可被平台自己查询"——写它的过程就是在吃自己的狗粮。

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（本体 §2）：
  - **复用承载（不改其语义）**：`ObjectType` / `ObjectInstance` / `Link` / `PropertyDef` / `SliceSpec` / `Rule`（D2 本体域引擎）· `Tenant`（D6，提供元租户隔离）· `executeSlice`（图遍历）。
  - **新增元层对象类型（= §2 目录本身的落库投影，挂元租户）**：`SystemObjectType` · `SystemLink` · `SystemInvariant`(R*) · `SystemBreakpoint`(G*) · `SystemEvent` · `SystemDomain`(D*) · `SystemSlice` · `SystemGate`。它们正式化 **§10.2 D11 治理元域** 为可查询数据。
- **触及链路**（§3）：**新增** `本体源(markdown + prd-index) → 解析(确定性) → 物化为元租户 ObjectInstance+Link → executeSlice/BFS 可查` —— 复用"数据→本体→对象链"的**形态**，但**源是文档不是连接器**。即把 §10.3 切片 `sys.meta.change_loop` 的"可查询化"落地。
- **触及事件/数据流**（§4，遵守 R10/D-29）：**新增** `meta.ontology_synced`（重解析完成 → 失效 `/meta` 查询缓存 + MCP 工具结果）。事件号落地时顺延登记（**不占用母体分支已加的 L13**）。
- **触及不变量**（§5，R1–R14）：
  - **R2 tenant_id everywhere（铁纪律①·成败所系）**：自我模型挂**独立元租户** `__platform__` / `meta` 命名空间，**严格隔离**——任何业务租户（demo 等）查询一律见不到元对象，元查询也不串入租户数据。
  - **R6 确定性（铁纪律②）**：同 markdown → 同投影**字节级一致**（重解析即重生成，不漂）。
  - **R4 真值经 Action —— 明确豁免边界**：元对象是**只读派生投影**，**不经 Action 写真值**（它不是用户写入的真值，而是从 markdown 源确定性重生成）；**改本体仍改 markdown**（现有人工 PR + 评审流程），sync 只重投影。**一事一源 + 生成方向明确**：机器可派生事实源=code、人类语义源=markdown、对象=可查投影。
  - **R9 仓储双实现**：元对象走现有 `objects`/`links` 仓储（已双实现），不新建表。
  - **R10 D-29**：sync 发 `meta.ontology_synced`，下游 `/meta` 视图订阅失效。
- **关闭/影响的已知断点**（§8）：**不直接关 G-1..G-8**；而是把"§8 断点登记 / §5 不变量 / §3 链路"变成**可查询对象**，使**对全部 G 的影响分析与状态查询从"人工 grep"升级为"图查询"**（强化对所有断点的治理可观测）。落实 §9「接线单一来源可落库」与 §10.5「用平台分析平台自身的闭环」。
- **需走的检测门禁**（§7）：复用 `ontology:check`（已解析 §4 事件/求解器/锚点）+ `prd:check`（已解析 §0）的解析器；**新增** `meta:sync` 漂移门（投影必须与 markdown 一致，重解析不变）。
- **回写承诺（跨分支纪律）**：`SYSTEM-ONTOLOGY.md` 当前写权在**自成长发动机分支**且已改 §2.H/§4。本 PRD **落地前不独立回写本体**；待相关分支合并后，仅以**零冲突追加**方式回写 §2（元层对象类型）/§3（解析→物化链）/§4（`meta.ontology_synced` 顺延号）/§10（切片落库实现注记），**绝不编辑他人已占用的行**。

## 1. 目标 / 非目标

### 1.1 目标（对应 Tier 4 #12/#13/#14）
1. **#12 本体落库 PoC**：解析 `SYSTEM-ONTOLOGY.md`（§2/§3/§4/§5/§7/§8/§10）+ `prd-ontology-index.json` → 物化为元租户 `__platform__` 的 `ObjectInstance` + `Link`（八类元对象 + 它们之间的关系）。markdown 仍为单一来源，对象为投影。
2. **#13 本体活查询面**：
   - 只读端点 `GET /a/v1/meta/{ontology, object-types/:key, invariants/:id, breakpoints/:id, events/:name, domains/:id, slices/:key}`（每个断点带：状态 + 关联不变量 + 覆盖它的 PRD + 链路位置）。
   - **影响分析** `GET /a/v1/meta/impact?node=<R14|G-5|ObjectType:Solver|…>`：沿 `SystemLink` BFS → 返回受影响节点集（"改 X 影响什么"= 一次图查询，复用 `executeSlice`/图遍历）。
   - **可选 MCP 工具** `query_system_ontology` / `get_breakpoint` / `impact_of`：让 Claude/Agent **问运行中的系统自己**（落实 §10.2「AI 可操作平台」）。
3. **#14 自动派生（保守、默认关、最后做）**：§2/§3/§4 的**机器可派生段**（求解器注册表 / 事件订阅表 / 端点）从 code 内省生成 → **diff 提示人确认**，不自动改 markdown、不自动 commit。

### 1.2 非目标（铁纪律，违反即失败）
- **元对象不成为新真值源**：markdown 是源、对象是投影；不允许"改对象回写 markdown"。
- **不污染租户数据**：元租户严格隔离（R2 铁纪律①），绝不让元模型进入任何业务租户的查询/切片/推演。
- **不全自动 #14**：code→本体自动派生**易把策展本体稀释成噪声**，人只策展语义（评审结论：#14 暂缓且保守）。
- **不替换** `ontology:check`/`chain:check`/`prd:check`：复用其解析器，三门继续是构建期硬门，本 PRD 只加"运行时可查投影"。

## 2. 现状与缺口（对照代码，带 file:line）

**已存在（复用，勿重造）**：
- `docs/SYSTEM-ONTOLOGY.md`（单一来源文本，§1–§10）+ `docs/prd-ontology-index.json`（机器可读 **PRD↔不变量(R)/断点(G)↔实现文件** 双向）。
- 解析器：`scripts/check-system-ontology.mjs`（**已解析 §4 事件 / 求解器注册 / 文件锚点 / 钩子**）· `scripts/check-prd-ontology.mjs`（**已解析每篇 PRD §0**）—— 解析逻辑可提取为共享模块复用。
- 平台自有本体引擎：`ObjectType`/`ObjectInstance`/`Link`/`SliceSpec`/`executeSlice`/`Rule`（`apps/datacore/src` D2）——**足以承载元模型**（dogfooding 的承载体）。
- 多租户隔离 R2（`tenant_id everywhere`）——提供元租户 `__platform__` 的隔离基座。

**缺口（本 PRD 补）**：
- 本体只能**读散文 + grep**，**不能图查询**："改 R14 影响哪些切片 / 哪些断点未修 / 这个需求拉动哪些功能"靠人脑 + 经验。
- §8 断点 / §5 不变量 / §3 链路 / §10 切片**不是可查询对象**，无 `/a/v1/meta/*` 端点。
- 无 MCP 让 Agent **问系统自己**（§10.2「AI 可操作平台」未落地）。
- 治理三门（ontology/chain/prd:check）是**构建期红/绿**，非**运行时活查询**。

## 3. 设计（复用现有接缝优先；标清"复用 / 绿地新建 / 门禁新增"）

### 3.1 元租户与命名空间（复用 R2 隔离）
- 元租户 `__platform__`，所有元对象 `tenantId="__platform__"`。业务租户查询经现有 R2 过滤天然见不到（铁纪律①）；`/meta/*` 端点固定查元租户，不接受业务 tenantId 跨读。

### 3.2 解析→物化（绿地编排，复用解析器 + objects 仓储）
- 把 `check-system-ontology.mjs`/`check-prd-ontology.mjs` 的解析逻辑提取为共享 `meta/parse.ts`：markdown + prd-index → 结构化记录。
- 物化为元对象（`ObjectInstance`，origin 记 `{source:"SYSTEM-ONTOLOGY.md", anchor}`，可溯回章节/行）+ `Link`：
  - `SystemObjectType{key,domain,anchor,desc}` · `SystemInvariant{id,statement,detectionPoint}` · `SystemBreakpoint{id,title,status,linkPosition,relatedPRDs[],relatedInvariants[]}` · `SystemEvent{name,producer,tier,consumers[]}` · `SystemDomain{id,scope,objectTypes[]}` · `SystemSlice{key,domain,root,hops[]}` · `SystemGate{name,script,checks}` · `SystemLink{from,to,kind,label}`。
  - **关系即 Link 实例**（把 §3/§10 接线变真链路）：`invariant --detected_at--> gate` · `breakpoint --sits_on--> slice/node` · `prd --covers--> breakpoint` · `objectType --in--> domain` · `event --consumed_by--> view`。
- **确定性（R6）**：同 markdown → 同投影；`POST /a/v1/meta/sync` 幂等重物化，发 `meta.ontology_synced`。

### 3.3 活查询面（绿地端点，复用 executeSlice/图遍历）
- 只读 `GET /a/v1/meta/*`（§1.1）。
- **影响分析** `/meta/impact?node=X`：以 X 为 root 在 `SystemLink` 上 BFS（深度可控）→ 受影响节点 + 路径。复用平台 `executeSlice`(root→hops) 或轻量 BFS。**这就是"改 X 影响什么"的自动化**（取代铁律0 的人工 read-first 的一部分）。

### 3.4 MCP 工具（#13 后段，复用 B3 MCP）
- 注册 `meta` MCP server：`query_system_ontology(filter)` / `get_breakpoint(id)` / `impact_of(node)`。Agent 经此**问运行中的系统**，落实「平台 Agent 经元本体推演/改造平台」。

### 3.5 #14 自动派生（保守、默认关）
- `meta/derive.ts` 从 code 内省（求解器注册表 `SOLVER_KEYS` / 事件订阅 `event-subscriptions.ts` / 路由表）生成 §2/§3/§4 机器段 → 与 markdown 现状 **diff** → 人确认后才改。**默认不开**；先用 `ontology:check` 守现状。

## 4. 契约 / 端点 / 数据模型（双仓储四处同改；contracts-only-shared）
- **契约**：新 `packages/contracts/src/meta-ontology.ts`（八类元对象 schema + impact 响应）。
- **端点**：`GET /a/v1/meta/{ontology,object-types/:key,invariants/:id,breakpoints/:id,events/:name,domains/:id,slices/:key,impact}` · `POST /a/v1/meta/sync`。
- **仓储**：**复用现有 `objects`/`links` 仓储**（`tenantId="__platform__"`），**不新建表**（最 dogfooding：系统本体就是平台里的一组对象，R9 已双实现满足）。
- **MCP**：`meta` server 工具注册（复用 B3）。

## 5. 关键流程（端到端，沿 `sys.meta.change_loop` 落库版）
```
SYSTEM-ONTOLOGY.md + prd-ontology-index.json   （单一来源·markdown）
        │  meta/parse.ts（复用现有解析器，确定性 R6）
        ▼
 结构化记录 ──materialize──> 元租户 __platform__：SystemObjectType/Invariant/Breakpoint/Event/Domain/Slice/Gate + SystemLink
        │  POST /a/v1/meta/sync（幂等）→ 发 meta.ontology_synced（R10）
        ▼
 /a/v1/meta/*（只读查询面） + /meta/impact?node=X（BFS 影响分析） + MCP query_system_ontology
        │
        ├── 人：治理即查询（"哪些断点未修/谁覆盖 G-5/改 R14 影响什么"）
        └── Agent：read-first 自动化 + 经元本体推演/改造平台（§10.2 AI 可操作平台）

回写方向（一事一源）：人改 markdown → sync 重生成投影；**不允许改对象回写 markdown**。
```

## 6. 非功能与约定（§5 不变量逐条满足）
- **R2（铁纪律①）**：元租户 `__platform__` 严格隔离，业务租户零可见；`/meta/*` 不接受跨租户读。回归：demo 租户查不到任何元对象。
- **R6（铁纪律②）**：两次 sync → 字节级一致投影。
- **R4**：元对象只读投影，不经 Action（明确豁免，因非用户真值）；markdown 编辑仍走人工 PR/评审。
- **R9**：复用 objects/links 双仓储。
- **R10/D-29**：`meta.ontology_synced` 登记 §4 + `/meta` 视图订阅。
- **R1 contracts-only-shared**：元 schema 入 `@platform/contracts`。

## 7. 验收（DoD）
1. `pnpm -r build && pnpm -r test` 全绿；`pnpm gates` 全绿（含新 `meta:sync` 漂移门）。
2. **落库 PoC（#12）**：sync 后元租户含八类元对象 + 链路；`/meta/breakpoints/G-8` 返回状态 + 关联不变量(R11…) + 覆盖 PRD。
3. **影响分析（#13）**：`/meta/impact?node=R14` 返回受影响节点（视图/门/对象类型），与人工分析一致；`/meta/impact?node=ObjectType:Solver` 命中 G-2 接缝。
4. **元租户隔离（R2 铁纪律①）**：demo 租户任意 `/a/v1/objects` 查询**查不到** `__platform__` 元对象。
5. **确定性（R6 铁纪律②）**：连续两次 `POST /meta/sync` → 投影字节级一致。
6. **MCP**：Agent 经 `query_system_ontology` 拿到断点状态（联调冒烟）。
7. **#14 保守**：派生器默认关；开启时只产 diff、不自动改 markdown。
8. **本体回写（合并后）**：零冲突追加 §2/§3/§4/§10，`ontology:check` 不漂。

## 8. 分期（收敛版：#12+#13 先行，#14 保守殿后）
- **P1（#12 落库 PoC）**：`meta/parse.ts`（复用解析器）+ 元租户物化（objects 仓储承载）+ `POST /meta/sync` + `meta:sync` 漂移门。
- **P2（#13 查询面）**：`/a/v1/meta/*` 只读端点 + `/meta/impact` BFS 影响分析 + 前端"系统自我"查询页（可选）。
- **P3（#13 MCP）**：`meta` MCP server 工具暴露给 Agent（AI 问系统自己）。
- **P4（#14 保守·可选）**：code 内省派生机器段 + diff 人确认；默认关。
- **回写本体**：相关分支合并 main 后，零冲突追加。

---

> **施工前置（跨分支纪律）**：`SYSTEM-ONTOLOGY.md` 现由自成长发动机分支持写权。本 PRD 落地前本分支只演进文档；落地需 rebase 到含其变更的 main 上，再按 §0 回写承诺以**追加方式**更新本体，绝不编辑他人已占用的章节行。
