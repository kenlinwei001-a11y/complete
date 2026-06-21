# PRD · 数据构建发动机 · 工业级工作流运行时（持久化步骤状态机）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 LANDED · 日期 2026-06-21 |
| 取代/扩展 | 落地深化 `docs/PRD-fullstack-story-build-g8.md` 的执行层：把 g8 主链 `runStory/executeStoryBuild`（内存 try-块）升级为持久化、可重入、可重试、可观测的工作流运行时。不改 g8 的倒推/闭包/scaffold 语义，只换"执行容器"。 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `docs/PRD-fullstack-story-build-g8.md` · `docs/PRD-unified-build-engine.md` |
| 核心一句话 | 数据构建发动机的"故事→建域"执行，从**一段内存 try-块**升级为**工业级工作流**：6 步状态机逐步落库检查点 → 进程崩溃可从未完成步 `resume`；瞬时失败有界退避重试；致命失败止于该步保留现场；每步状态迁移发可观测/审计事件。让发动机"可运维"而非玩具。 |

## 0. 本体引用与影响（强制 · 不填即未读本体）

**触及对象类型**（本体 §2）：
- 既有：BuildPlan / BuildJob / ClosureReport / DataBuilderAgent · StoryBuildRun · ScaffoldManifest/ScaffoldReceipt(DTO) · Connector / RawDataset · SliceSpec · Solver(SOLVER_KEYS)。
- **新增对象类型（已回写 §2 数据接入域，追加新行）**：**BuildWorkflowRun**（一次"故事→建域"的持久化执行记录：串 6 步 `BuildWorkflowStep`{stepKey/status/attempts/maxAttempts/计时/error/checkpoint} + 累积 context + storyRunId）。
- 传输/内部契约（仅 contracts，不入 §2 持久本体）：`BuildWorkflowStep` / `BuildStepError` / `BuildWorkflowStartBody`。

**触及链路**（§3）：数据构建发动机链（StoryScript→BuildPlan→ClosureReport→…→真值）。新增执行容器：链上 HARD 门以 `BuildWorkflowEngine` 的 6 步状态机（dry_build→cross_scaffold→publish_build→validation→inference→record）承载；`runStory` 与新端点共用同一组步骤（单一执行路径）。

**触及事件/数据流**（§4，遵守 D-29）：**不新增缓存失效事件**——产出操作的缓存事件仍是已注册的 `storybuild.run_recorded`（L15，record 步发）。每步状态迁移额外发 `buildworkflow.{run_started,run_resumed,step_succeeded,step_skipped,step_retry,step_failed,run_failed,run_completed}` 到 DataCore outbox，作**可观测/审计流**（`GET /a/v1/outbox` 实时尾随），**不是**缓存失效事件，故不登记 §4（§4 集合 = AgentCore `event-subscriptions.ts`，保持不漂）。

**触及不变量**（§5，R1–R14）：
- **R2 tenant_id everywhere**：BuildWorkflowRun 带 tenantId；`resume` 跨租户取不到即 not-found（测试覆盖）。
- **R4 真值经 Action**：publish_build 步仍走既有 run() 七阶段 publish 门，工作流不绕过审批/闭包。
- **R6 确定性**：被包裹的阶段仍幂等 + freezePlan，产出制品字节级一致；工作流日志的时间戳/尝试次数不属确定性范畴（已在代码与本 PRD 显式声明）。重试因步骤幂等不破坏 R6。
- **R7 错误信封**：步错误结构化为 `BuildStepError{code,message,retryable}` 落库。
- **R9 仓储双实现**：新表 `build_workflow_runs` 四处同改（migrations023 + repo.ts 接口 + memory.ts + pg.ts）。
- **R10 D-29**：产出操作（建域完成）发 `storybuild.run_recorded`（既有），下游 story-runs 视图已订阅；新增观测事件不构成新失效环。

**关闭/影响的已知断点**（§8）：深化 **G-8**（数据构建闭包/执行）——执行从内存 try-块升级为持久化步骤状态机：崩溃不再丢状态、单步可重试、逐步可观测/可审计、失败可 resume 自愈。不影响其余断点。

**需走的检测门禁**（§7）：`ontology:check`（事件不漂——故未把观测事件塞进 §4）· `chain:check` · `prd:check` / `prd:coverage` · datacore 测试套件（含本 PRD 的 workflow-engine 单测 + HTTP 端到端）。

**回写承诺**：落地即回写——§2（追加 BuildWorkflowRun 行）· §3（数据构建链追加工作流运行时注）· §8（G-8 补注执行已工作流化）。`ontology:check` 不漂。

## 1. 目标 / 非目标

### 1.1 目标
1. **持久化执行（durable）**：每步状态/尝试/计时/检查点逐步落库（`build_workflow_runs`）；进程在任意步后死掉，状态不丢。
2. **可重入（resumable）**：`POST /a/v1/databuilder/workflow-runs/:id/resume` 从首个未完成步续跑，已成功步跳过、步间 context 复用；失败步重置重试（自愈）。
3. **可重试（retryable）**：瞬时失败（跨系统 scaffold HTTP 标 `RetryableStepError`）按 `maxAttempts` 有界指数退避重试；致命失败止于该步保留现场。
4. **可观测（observable）**：`GET /a/v1/databuilder/workflow-runs[/:id]` 看运行 + 逐步状态/尝试/计时；每步迁移发 `buildworkflow.*` 审计事件。
5. **两轴分离**：工作流执行状态（跑完=SUCCEEDED）与业务结论（StoryBuildRun.status，可 BLOCKED）解耦——闭包未过是合法业务结论（步 SKIPPED + 工作流 SUCCEEDED + StoryBuildRun FAILED），不是基础设施失败。
6. **单一执行路径**：`runStory`（旧端点）与新工作流端点共用同一组步骤，无双实现漂移。

### 1.2 非目标
- 不做通用工作流编排引擎/可视化 DAG 编辑器（步骤序由代码定义，非用户编排）。
- 不复用 AgentCore B2 Workflow（FDE 在 DataCore，复用 B 会反转 A→B 松耦合）。
- 不改 g8 的倒推/闭包/scaffold 语义。
- 前端工作流时间线视图本期未做（端点已可观测，时间线为后续）。

## 2. 实现锚点

- `packages/contracts/src/databuilder.ts`：BuildWorkflowRun / BuildWorkflowStep / BuildStepError / BuildWorkflowStartBody。
- `apps/datacore/src/databuilder/workflow-engine.ts`：`BuildWorkflowEngine`（start/resume/drive + 检查点持久化 + 有界重试 + 事件）· `RetryableStepError` · `summarizeSteps`。
- `apps/datacore/src/databuilder/service.ts`：`buildStorySteps`（6 步定义）· `runStoryWorkflow` / `resumeStoryWorkflow` / `listWorkflowRuns` / `getWorkflowRun`；`runStory` 改为经引擎单一路径。
- `apps/datacore/src/app.ts`：`POST/GET /a/v1/databuilder/workflow-runs`、`POST …/:id/resume`。
- `apps/datacore/src/repo/{repo.ts,memory.ts,pg.ts}` + `apps/datacore/migrations/023_build_workflow_runs.sql`（R9 四处）。
- `apps/datacore/test/build-workflow-engine.test.ts`：引擎工业级保证单测（happy/重试/致命/重试上限/崩溃重入/失败自愈/R2 隔离/跳过）+ HTTP 端到端。

## 3. 验收

- **AC1 持久化**：某步成功后落库可被 `GET` 读到该步 SUCCEEDED + 后续 PENDING。✓ 单测「崩溃后可重入」。
- **AC2 重入**：崩溃（stopAfter 模拟）后 `resume` 续跑，已成功步不重跑、context 复用、终 SUCCEEDED。✓。
- **AC3 重试**：瞬时失败有界退避重试后成功（attempts 累加 + step_retry 事件）；重试上限耗尽即 FAILED（不无限）。✓。
- **AC4 致命隔离**：非可重试错误止于该步，run FAILED，后续步保持 PENDING，错误落库。✓。
- **AC5 自愈**：修复外部依赖后 `resume` 重置 FAILED 步重试 → 成功。✓。
- **AC6 R2 隔离**：A 租户工作流 B 租户 resume 取不到 → not-found。✓。
- **AC7 端到端**：`POST /workflow-runs` 全步终态 + storyRunId 落 StoryBuildRun + GET 可观测；旧端点同源无回归。✓。
- **AC8 无回归**：datacore 全套（449）绿；`pnpm gates` 全通过。✓。
