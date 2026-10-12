# PRD · 系统本体自反落库与活查询面（Dogfooding：用平台分析平台自身）

| 项 | 值 |
|---|---|
| 版本 | v0.2 · 状态 DRAFT · 日期 2026-06-18（v0.1 评审后定：鉴权=admin 默认+角色白名单可配置;本分支直接同步回写本体） |
| 取代/扩展 | **落实** `docs/SYSTEM-ONTOLOGY.md` §9 / §10.5 dogfooding 远期 + `docs/TODO.md` Tier 4 #12/#13/#14；不新建业务模块，复用平台自有本体引擎承载平台自身 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§9 演进 / §10 系统自我域）· `docs/OPERATING-MODEL.md` · `docs/prd-ontology-index.json` |
| 核心一句话 | 把系统本体（`SYSTEM-ONTOLOGY.md` + `prd-ontology-index.json`）从"只能读散文 + grep 的文档"升级为"平台里一组可查询、可切片、可影响分析的对象"——解析为元租户 `__platform__` 的 `ObjectInstance/Link`，开 `/a/v1/meta/*` 活查询面 + MCP 工具，让人和 Agent 能问运行中的系统"改 R14 影响什么 / 哪些断点未修 / 这个需求拉动了哪些功能"。**markdown 仍是单一来源，对象是确定性投影。** |

> **本 PRD 自身即一次 dogfooding**：用本体模板 + §0《本体引用与影响》描述"如何让本体可被平台自己查询"。

## 0. 本体引用与影响（强制）

- **触及对象类型**（§2）：
  - **复用承载**：`ObjectType`/`ObjectInstance`/`Link`/`PropertyDef`/`SliceSpec`/`Rule`（D2 本体域引擎）· `Tenant`（D6 元租户隔离）· `executeSlice`（图遍历）。
  - **新增元层对象类型**（= §2 目录本身的落库投影，挂元租户）：`SystemObjectType` · `SystemLink` · `SystemInvariant`(R*) · `SystemBreakpoint`(G*) · `SystemEvent` · `SystemDomain`(D*) · `SystemSlice` · `SystemGate`。正式化 §10.2 D11 治理元域为可查询数据。
- **触及链路**（§3）：**新增** `本体源(markdown + prd-index) → 解析(确定性) → 物化为元租户 ObjectInstance+Link → BFS/executeSlice 可查`——复用"数据→本体→对象链"的形态，但源是文档不是连接器（落地 §10.3 `sys.meta.change_loop` 的可查询化）。
- **触及事件/数据流**（§4，遵守 R10/D-29）：**新增** `meta.ontology_synced`（重解析完成 → 失效 `/meta` 查询缓存 + MCP 工具结果）。**本分支与代码同步登记 §4（顺延号），不延后**——否则 `ontology:check`（强制代码事件数==本体覆盖数）即红。
- **触及不变量**（§5，R1–R14）：
  - **R2 tenant_id everywhere（铁纪律①）**：自我模型挂独立元租户 `__platform__`，业务租户经现有 R2 过滤天然见不到;`/meta/*` 固定查元租户、不接受业务 tenantId 跨读。
  - **R6 确定性（铁纪律②）**：同 markdown → 同投影字节级一致（重解析即重生成，不漂）。
  - **R4 真值经 Action —— 豁免边界**：元对象是**只读派生投影**，不经 Action 写真值（非用户真值，从 markdown 源确定性重生成）;改本体仍改 markdown（人工 PR + 评审），sync 只重投影。一事一源 + 生成方向明确（机器可派生事实源=code、人类语义源=markdown、对象=可查投影）。
  - **R3 entitlement / 认证（鉴权门限，v0.2 定）**：`/meta/*` + meta MCP 工具**默认仅 `admin`**;**可配置**——per-tenant 角色白名单 `MetaAccessPolicy{roles[]}`（默认 `["admin"]`，admin 可改）决定哪些角色可访问。`feature.meta-ontology` 门控（先于 authz）。
  - **R9 仓储双实现**：元对象走现有 `objects`/`links` 仓储（已双实现），不新建表;`MetaAccessPolicy` 走配置仓储（双实现四处）。
  - **R10 D-29**：sync 发 `meta.ontology_synced`，下游 `/meta` 视图订阅失效。
  - **R14 无业务常数**：默认角色白名单 `["admin"]` 为可配置默认值，非硬编码业务常数。
- **关闭/影响的已知断点**（§8）：不直接关 G-1..G-8;而是把"§8 断点 / §5 不变量 / §3 链路"变成**可查询对象**，使对全部 G 的影响分析与状态查询从"人工 grep"升级为"图查询"（强化治理可观测）。落实 §9「接线单一来源可落库」+ §10.5「用平台分析平台自身」。
- **需走的检测门禁**（§7）：复用 `ontology:check`（解析 §4 事件/求解器/锚点）+ `prd:check`（解析 §0）的解析器;**新增** `meta:sync` 漂移门（投影必须与 markdown 一致，重解析不变）。
- **回写承诺（本分支直接同步，v0.2 定）**：本分支即 `SYSTEM-ONTOLOGY.md` 写权所在（demand-pulled/g8 已在此提交）。**落地时直接回写**：§2（八类元层对象类型）· §3（解析→物化链）· §4（`meta.ontology_synced` **与代码同步**登记，顺延号）· §10（切片落库实现注记）。`ontology:check` 不漂。

## 1. 目标 / 非目标

### 1.1 目标（Tier 4 #12/#13/#14）
1. **#12 本体落库 PoC**：解析 `SYSTEM-ONTOLOGY.md`（§2/§3/§4/§5/§7/§8/§10）+ `prd-ontology-index.json` → 物化为元租户 `__platform__` 的 `ObjectInstance`+`Link`（八类元对象 + 关系）。markdown 仍为单一来源，对象为投影。
2. **#13 本体活查询面**：
   - 只读 `GET /a/v1/meta/{ontology, object-types/:key, invariants/:id, breakpoints/:id, events/:name, domains/:id, slices/:key}`（每断点带：状态 + 关联不变量 + 覆盖 PRD + 链路位置）。
   - **影响分析** `GET /a/v1/meta/impact?node=<R14|G-5|ObjectType:Solver|…>`：沿 `SystemLink` 轻量 BFS → 受影响节点集 + 路径（"改 X 影响什么"= 一次图查询）。
   - **MCP 工具** `query_system_ontology` / `get_breakpoint` / `impact_of`：让 Agent 问运行中的系统（§10.2 AI 可操作平台），同受 `MetaAccessPolicy` 门控。
3. **#14 自动派生（保守、默认关、最后做）**：§2/§3/§4 机器可派生段（求解器注册表 / 事件订阅 / 端点）从 code 内省生成 → diff 提示人确认，不自动改 markdown、不自动 commit。

### 1.2 非目标（铁纪律）
- 元对象不成为新真值源（markdown 是源、对象是投影;不允许改对象回写 markdown）。
- 不污染租户数据（元租户严格隔离 R2;绝不进业务租户查询/切片/推演）。
- 不全自动 #14（code→本体派生易把策展本体稀释成噪声;人只策展语义）。
- 不替换 `ontology:check`/`chain:check`/`prd:check`（复用解析器;三门仍是构建期硬门，本 PRD 只加运行时可查投影）。

## 2. 现状与缺口（对照代码）

**已存在（复用）**：
- `docs/SYSTEM-ONTOLOGY.md`（单一来源 §1–§10）+ `docs/prd-ontology-index.json`（PRD↔R/G↔实现文件双向）。
- 解析器：`scripts/check-system-ontology.mjs`（已解析 §4 事件/求解器/锚点/钩子）· `scripts/check-prd-ontology.mjs`（已解析 §0）——解析逻辑可提取共享。
- 平台自有本体引擎 `ObjectType`/`ObjectInstance`/`Link`/`SliceSpec`/`executeSlice`/`Rule`（datacore D2）——足以承载元模型。
- 多租户隔离 R2 + `admin`/`platform_admin` 等角色 + 配置仓储——提供元租户隔离基座 + 可配置鉴权基座。

**缺口（本 PRD 补）**：
- 本体只能读散文 + grep，不能图查询;§8/§5/§3/§10 不是可查询对象，无 `/a/v1/meta/*`。
- 无 MCP 让 Agent 问系统自己（§10.2 未落地）。
- 治理三门是构建期红/绿，非运行时活查询。
- 运行时需读 `docs/SYSTEM-ONTOLOGY.md`+`prd-ontology-index.json`——**需确认这两文件随 datacore 容器发布**（部署注记）。

## 3. 设计（复用优先;标清 复用/绿地/门禁新增）

### 3.1 元租户与可配置鉴权
- 元租户 `__platform__`，元对象 `tenantId="__platform__"`;`/meta/*` 固定查元租户，不接受业务 tenantId 跨读。
- **鉴权（可配置）**：`MetaAccessPolicy{roles:string[]}`（默认 `["admin"]`，per-tenant 配置仓储，admin 可改）。`/meta/*` + meta MCP 门：调用者角色 ∩ policy.roles ≠ ∅ → 放行，否则 403。`GET/PUT /a/v1/meta/access-policy`（仅 admin 可改）。

### 3.2 解析→物化（绿地编排，复用解析器 + objects 仓储）
- 提取 `meta/parse.ts`（共享解析逻辑）：markdown + prd-index → 结构化记录。
- 物化为元对象（`ObjectInstance`，origin 记 `{source:"SYSTEM-ONTOLOGY.md", anchor}` 可溯回章节）+ `Link`：八类元对象 + 关系即 Link 实例（`invariant --detected_at--> gate` · `breakpoint --sits_on--> slice/node` · `prd --covers--> breakpoint` · `objectType --in--> domain` · `event --consumed_by--> view`）。
- **确定性 R6**：同 markdown → 同投影;`POST /a/v1/meta/sync` 幂等重物化，发 `meta.ontology_synced`。

### 3.3 活查询面（绿地端点）
- 只读 `GET /a/v1/meta/*`（§1.1）。
- **影响分析** `/meta/impact?node=X`：在 `__platform__` 的 links 上**轻量 BFS**（深度可控）→ 受影响节点 + 路径（SystemLink kinds 非注册 LinkType，BFS 比硬套 executeSlice 简单）。

### 3.4 MCP 工具（#13 后段，复用 B3）
- 注册 `meta` MCP server：`query_system_ontology(filter)` / `get_breakpoint(id)` / `impact_of(node)`;同受 `MetaAccessPolicy` 门控（business-tenant agent 默认够不到）。

### 3.5 #14 自动派生（保守、默认关）
- `meta/derive.ts` 从 code 内省（`SOLVER_KEYS` / 事件订阅 / 路由表）生成 §2/§3/§4 机器段 → 与 markdown diff → 人确认后才改。默认不开。

## 4. 契约 / 端点 / 数据模型
- **契约**：新 `packages/contracts/src/meta-ontology.ts`（八类元对象 schema + impact 响应 + `MetaAccessPolicy`）。
- **端点**：`GET /a/v1/meta/{ontology,object-types/:key,invariants/:id,breakpoints/:id,events/:name,domains/:id,slices/:key,impact}` · `POST /a/v1/meta/sync` · `GET/PUT /a/v1/meta/access-policy`。
- **仓储**：复用 `objects`/`links`（`tenantId="__platform__"`，不新建表）;`MetaAccessPolicy` 走配置仓储（R9 双实现四处）。
- **MCP**：`meta` server 工具注册（复用 B3）。

## 5. 关键流程
```
SYSTEM-ONTOLOGY.md + prd-ontology-index.json  （单一来源·markdown）
   │ meta/parse.ts（复用解析器，确定性 R6）
   ▼ materialize → __platform__: SystemObjectType/Invariant/Breakpoint/Event/Domain/Slice/Gate + SystemLink
   │ POST /a/v1/meta/sync（幂等）→ meta.ontology_synced（R10）
   ▼ /a/v1/meta/*（只读，MetaAccessPolicy 门控）+ /meta/impact?node=X（BFS）+ MCP
   ├ 人：治理即查询（哪些断点未修/谁覆盖 G-5/改 R14 影响什么）
   └ Agent：read-first 自动化 + 经元本体推演/改造平台（§10.2，受同一门控）
回写方向（一事一源）：人改 markdown → sync 重生成投影;不允许改对象回写 markdown。
```

## 6. 非功能（§5 逐条）
- **R2**：元租户 `__platform__` 严格隔离，业务租户零可见;`/meta/*` 不跨租户读。回归：demo 任意 `/a/v1/objects` 查不到元对象。
- **R3 鉴权可配置**：默认 `["admin"]`;白名单可经 `PUT /meta/access-policy` 增删角色;非白名单角色 403。
- **R6**：两次 sync → 字节级一致投影。
- **R4**：元对象只读投影，不经 Action;markdown 编辑走人工 PR。
- **R9**：复用 objects/links + 配置仓储双实现。
- **R10/D-29**：`meta.ontology_synced` 登记 §4 + `/meta` 视图订阅。
- **R1**：元 schema + `MetaAccessPolicy` 入 `@platform/contracts`。

## 7. 验收（DoD）
1. `pnpm -r build && test` 全绿;`pnpm gates` 全绿（含新 `meta:sync` 漂移门 + `ontology:check` 含 `meta.ontology_synced`）。
2. **落库 PoC（#12）**：sync 后元租户含八类元对象 + 链路;`/meta/breakpoints/G-8` 返回状态 + 关联不变量 + 覆盖 PRD。
3. **影响分析（#13）**：`/meta/impact?node=R14` 返回受影响节点（视图/门/对象类型），与人工一致;`?node=ObjectType:Solver` 命中 G-2 接缝。
4. **元租户隔离（R2）**：demo 租户 `/a/v1/objects` 查不到 `__platform__` 元对象。
5. **鉴权可配置（R3）**：默认仅 admin 可 `/meta/*`;planner 默认 403;把 planner 加入 `MetaAccessPolicy` 后可访问;移除后回 403。
6. **确定性（R6）**：连续两次 `POST /meta/sync` → 投影字节级一致。
7. **MCP**：Agent 经 `query_system_ontology` 拿到断点状态（受门控;联调冒烟）。
8. **#14 保守**：派生器默认关;开启只产 diff、不自动改 markdown。
9. **本体回写**：直接回写 §2/§3/§4/§10，`ontology:check` 不漂。

## 8. 分期（#12+#13 先行，#14 保守殿后）
- **P1（#12 落库 PoC）**：`meta/parse.ts`（复用解析器）+ 元租户物化 + `POST /meta/sync` + `meta:sync` 漂移门 + `meta.ontology_synced` 同步登记 §4。
- **P2（#13 查询面 + 鉴权）**：`MetaAccessPolicy`（契约+仓储+`GET/PUT /meta/access-policy`）+ `/a/v1/meta/*` 只读端点（门控）+ `/meta/impact` BFS + 前端"系统自我"查询页（可选）。
- **P3（#13 MCP）**：`meta` MCP server 工具暴露（受同一门控）。
- **P4（#14 保守·可选）**：code 内省派生 + diff 人确认;默认关。
- **回写本体**：每期落地即直接回写对应章节（本分支，同步）。
