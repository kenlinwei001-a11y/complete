# PRD · A7 · B 栈 scaffold 单机可见（不配 AGENTCORE_BASE_URL 也能看到生成的 agent）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 3 |
| 取代/扩展 | 扩 `PRD-fullstack-story-build-g8.md`（g8-P3 跨系统 scaffold）· 关联 `PRD-A5-*`（FDE 节点图⑤模块生成） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.H ScaffoldReceipt · §5 R8/R11） · `apps/datacore/src/databuilder/{service.ts,artifacts.ts}` · `apps/datacore/src/config.ts`（AGENTCORE_BASE_URL）· `apps/agentcore/src` `POST /b/v1/internal/scaffold` |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：建域倒推出的 B 栈制品（agent/skill/workflow/intent/plan/scene）目前**只有在配了 `AGENTCORE_BASE_URL`、A→B 下发成功后**才在 AgentCore 可见；**单机/未配 B 时，生成的 agent 等于"看不见"**。A7 让 scaffold 产物**在 DataCore 侧就持久可见**（ScaffoldManifest 落库 + 浏览），B 上线后再对账落地——"看得到"不再依赖 B 在线。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.H）：`ScaffoldReceipt`/`ScaffoldManifest`·`ProducedArtifact`（B 栈项 SCAFFOLDED/REUSED/MISSING）·`StoryBuildRun`·`Agent/Skill/Workflow/Intent/ExecutionPlan/Scenario`（B 栈目标制品）。
- **触及链路**（§3）：`comprehend 倒推 B 栈需求 → ScaffoldManifest(落 DataCore 持久) → (B 在线) POST /b/v1/internal/scaffold 对账落 DRAFT → ScaffoldReceipt.fullChainOk`；**断开"可见"与"B 在线"的强耦合**。
- **触及事件/数据流**（§4）：复用 `storybuild.run_recorded`；**新增** `scaffold.manifest_recorded`（DataCore 侧 manifest 落库，IN_SESSION，失效 scaffold 浏览）+ B 上线对账后 `scaffold.reconciled`。
- **触及不变量**（§5）：
  - **R8 认证**：A→B 下发仍经 `SERVICE_TOKEN` 守闸；A7 只增"A 侧本地可见"，不放松跨系统鉴权。
  - **R11 全链闭包**：单机态 manifest 标 `pending-bstack`（未对账 = SOFT 可见、非 fullChainOk）；B 对账后才 HARD 闭合——**诚实区分"看得到"与"真生效"**。
  - **R2** 租户隔离：manifest 按租户存。
- **关闭/影响断点**（§8）：闭合 g8-P3 遗留"scaffold 可见性依赖 B 在线"；补 G-8 单机可观测。
- **门禁**（§7）：仓储双实现一致 · `ontology:check` · 跨服务冒烟（B 上线对账幂等）· 前端回归。
- **回写承诺**：回写本体 §2.H（ScaffoldManifest 持久 + scaffold.manifest_recorded/reconciled）· §3（可见/在线解耦）· §8（g8-P3 闭合）。

## 1. 目标 / 非目标
### 目标
1. **scaffold 产物 DataCore 侧持久可见**：comprehend 倒推出的 B 栈需求落 `ScaffoldManifest`（每项 {module,kind,key,status:PENDING_BSTACK/SCAFFOLDED/REUSED/MISSING}），**不依赖 AGENTCORE_BASE_URL**。
2. **单机可浏览**：FDE 节点图⑤/DataBuilderPage 列出"将生成/已生成的 agent/skill/workflow/…"，单机态标 `pending-bstack`（诚实：看得到、待 B 对账生效）。
3. **B 上线幂等对账**：配置 `AGENTCORE_BASE_URL` 后，按 manifest 幂等下发 `POST /b/v1/internal/scaffold` → 状态升 SCAFFOLDED + `scaffold.reconciled`，无重复建。
4. **诚实闭合**：未对账 manifest 不计 `fullChainOk`（R11 SOFT）；对账后才 HARD。

### 非目标
- 不在 DataCore 真建 AgentCore 制品（B 栈真值仍归 AgentCore，R8）；A7 只持久"清单 + 可见 + 待对账"。
- 不改 comprehend 倒推内容；只持久其 B 栈产物清单。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| 倒推 B 栈 | `comprehend.ts:487` 等倒推 agent/skill/workflow/场景 | 产物只在下发时存在于 B |
| 下发 | `POST /b/v1/internal/scaffold`（SERVICE_TOKEN，AGENTCORE_BASE_URL 配置时） | 未配 → 不下发 → B 栈不可见 |
| 回执 | `ScaffoldReceipt`（artifacts.ts:23 并入 producedArtifacts） | receipt 依赖下发成功；单机无 |
| 可见性 | `producedArtifacts` 含 B 栈项 | 但 SCAFFOLDED 仅当 B 在线；单机 MISSING/空 |

## 3. 设计（DataCore 侧 manifest 持久 + 单机可见 + B 对账）
### 3.1 ScaffoldManifest 落库（DataCore）
- comprehend 倒推后，**无条件**把 B 栈需求写 `ScaffoldManifest`（StoryBuildRun 子结构或独立仓储项），每项 status 初始 `PENDING_BSTACK`。
- 发 `scaffold.manifest_recorded`。
### 3.2 单机可见
- FDE 节点图⑤模块生成 / DataBuilderPage 模块同步矩阵：B 栈行从 manifest 读，单机态显示"待 B 对账（pending-bstack）"+ 制品定义（systemPrompt/tools/skills 等倒推内容可看）。
- **"生成的 agent 看得到"**：即使 B 没跑，用户能看到倒推出的 agent 名/职责/工具绑定（DRAFT 定义存 DataCore manifest）。
### 3.3 B 上线幂等对账
- `AGENTCORE_BASE_URL` 配置时（启动或定时或手动 `POST /a/v1/databuilder/reconcile-scaffold`）：按 manifest 未对账项幂等下发 `POST /b/v1/internal/scaffold` → 升 SCAFFOLDED + 写 ScaffoldReceipt + `scaffold.reconciled`。幂等键 = (tenant, runId, kind, key)。
### 3.4 闭包诚实
- `fullChainOk` 仅在所有 manifest 项 SCAFFOLDED/REUSED 时 HARD；含 PENDING_BSTACK → SOFT（R11，"看得到≠真生效"）。

## 4. 契约 / 端点
- `contracts`：`ScaffoldManifestSchema`（items[{module,kind,key,definition,status}]）；扩 `StoryBuildRun` 引用 manifest。
- 端点：`GET /a/v1/databuilder/runs/:id/scaffold-manifest`（浏览）· `POST /a/v1/databuilder/reconcile-scaffold`（B 上线对账，SERVICE_TOKEN/admin）。
- 事件 `scaffold.manifest_recorded`/`scaffold.reconciled` 入 `event-subscriptions.ts`。
- 仓储：manifest 双实现（R9；可挂 story_build_runs 或新 scaffold_manifests 表）。

## 5. 关键流程（端到端）
单机建域（无 AGENTCORE_BASE_URL）→ comprehend 倒推出 `agent: 瓶颈诊断Agent` 等 → ScaffoldManifest 落库（PENDING_BSTACK）→ DataBuilderPage 可见该 agent 定义（看得到）→ 闭包标 SOFT（诚实）→ 后续配上 B + `reconcile-scaffold` → 幂等下发 → SCAFFOLDED + fullChainOk HARD。

## 6. 非功能（§5）
R8（跨系统仍 SERVICE_TOKEN）· R11（SOFT/HARD 诚实区分）· R2 隔离 · R9 双仓储 · 幂等对账。

## 7. 验收（DoD）
- 不配 AGENTCORE_BASE_URL 建域：scaffold 产物（agent 等）DataCore 侧可见（manifest + 定义），闭包标 SOFT。
- 配上 B + reconcile：幂等下发，状态升 SCAFFOLDED，fullChainOk HARD，无重复建。
- `pnpm -r build && pnpm -r test` 全绿（manifest 双仓储 + 对账幂等 + 单机可见前端用例 + 跨服务冒烟）；`ontology:check` 过。
- 回写本体 §2.H/§3/§8。

## 8. 分期
- **A7.1** ScaffoldManifest 落库（无条件）+ `scaffold.manifest_recorded` + 单机可见（DataBuilderPage/FDE 节点图）。
- **A7.2** `reconcile-scaffold` 幂等对账 + `scaffold.reconciled` + 闭包 SOFT/HARD 诚实。

> 依赖 A5（节点图⑤承载可见）。基线分支：manifest 仓储涉 migration，对准基线。
