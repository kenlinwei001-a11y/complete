# WO-DECISION-RECORD · FDE 真跑证据

> 一等 **Decision** 记录（PRD 决策支撑成熟化 §3.7 D8 · 问责 + 组织学习）。
> 决策上下文 / 触发 · 备选方案 · 所选 · 否决理由 · 决策人 · 预测 vs 实现（后填）。
> 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入提交物。

## 1. 对象 schema（契约 · `packages/contracts/src/decision.ts`）

`DecisionSchema`（一等对象，R2 租户隔离）：

| 字段 | 含义 |
|---|---|
| `id` / `tenantId` | `dec_*` 主键 + 租户隔离（R2） |
| `title` | 决策标题 |
| `context` | 决策上下文 / 触发（为什么要做这个决策） |
| `options[]` | 备选方案（`{key,label,detail?,expectedImpact?}`） |
| `chosen` | 所选方案 key（须命中某 `options[].key`，否则 400 `CHOSEN_NOT_IN_OPTIONS`） |
| `rejectedRationale[]` | 各被否决方案的理由（`{optionKey,rationale}`，组织学习关键） |
| `decidedBy` | 决策人（缺省取 `ctx.userId`） |
| `predictedOutcome` | 预测（`{summary,metrics?,horizonDate?}`） |
| `realizedOutcome?` | 实现结果（后填：`{summary,metrics?,recordedAt,recordedBy}`） |
| `links[]` | 轻接来源（`ACTION_DRAFT/PLAN_VERSION/RISK_CASE/SCENARIO/OTHER`，不强耦合） |
| `status` | `RECORDED` → `OUTCOME_RECORDED` |

辅助契约：`CreateDecisionSchema`（创建体）、`RecordOutcomeSchema`（补录体）、`DecisionErrorCodes`。

## 2. 端点（`apps/datacore/src/app.ts` · 独立路由区块）+ 服务（`apps/datacore/src/decisions.ts`）

| 方法/路径 | 行为 | 事件 |
|---|---|---|
| `POST /a/v1/decisions` | 创建·校验 chosen∈options → 201 | `decision.recorded` |
| `GET /a/v1/decisions{,?status=}` | 列出本租户（新→旧，可按 status 过滤） | — |
| `GET /a/v1/decisions/:id` | 查单条（跨租户 → 404） | — |
| `POST /a/v1/decisions/:id/outcome` | 补录 realizedOutcome → status OUTCOME_RECORDED | `decision.outcome_recorded` |

## 3. 仓储双实现四处同改（CLAUDE.md「仓储双实现」约定）

- `apps/datacore/migrations/029_decisions.sql`（通用 PgStore 形状：`id/tenant_id/doc/created_at/updated_at` + 两索引；列定义独占整行以过 `repo-pg-notnull:check`）
- `apps/datacore/src/repo/repo.ts`：`Repos.decisions: Store<Decision>` 接口 + `Decision` import
- `apps/datacore/src/repo/memory.ts`：`decisions: new MemStore()`
- `apps/datacore/src/repo/pg.ts`：`decisions: new PgStore(pool, "decisions")`

## 4. 前端（`apps/frontend-shell`）

- 视图 `src/pages/admin/DecisionsPage.tsx`：列表（标题/决策人/状态/时间）+ 详情（上下文 / 备选方案[所选✓+否决理由] / **预测 vs 实现逐指标对比表**[delta 徽章] / 关联制品）+ 补录实现表单 + 速记新决策表单。
- 路由 `src/App.tsx` `admin("decisions", <DecisionsPage/>)`；导航 `src/pages/adminRegistry.ts`（"决策记录"，roles admin/approver/planner；归「运营与审批」组）。
- 端点 `src/api/endpoints.ts`：`fetchDecisions/fetchDecision/createDecision/recordDecisionOutcome`。
- 实时环 F1：`src/store/eventInvalidation.ts` 把 `decision.recorded/outcome_recorded` → 失效 `["a","decisions"]`（跨会话/被动页刷新）。

## 5. curl 真跑（内存模式 · 端口 4011）

```
POST /a/v1/decisions →
{"decisionId":"dec_6vg6dm48tnpymrg3","status":"RECORDED",
 "decision":{...,"chosen":"outsource","decidedBy":"admin","status":"RECORDED",...}}

GET /a/v1/decisions → {"decisions":[{...}]}（1 条）

POST /a/v1/decisions/<id>/outcome →
 status=OUTCOME_RECORDED
 predicted { gapTon: 0, marginPct: 12.5 }
 realized  { gapTon: 0, marginPct: 11.2 }   ← 预测 vs 实现可对比

R2 跨租户 GET（x-debug-user:other:u1:admin）→ 404
chosen 非法（"zzz"）→ 400 CHOSEN_NOT_IN_OPTIONS
outbox 含 decision.recorded + decision.outcome_recorded
```

## 6. PG 真跑（DATABASE_URL · 端口 4012 · 启动自动迁移）

```
\d decisions → 表落库（id/tenant_id/doc jsonb/created_at/updated_at + 3 索引）✓ migration029 真应用
POST create → status=RECORDED
POST outcome → status=OUTCOME_RECORDED | predicted {marginPct:12.5} | realized {marginPct:11.2}
R2 跨租户 → 404
SELECT count(*), max(doc->>'status') FROM decisions → 1 | OUTCOME_RECORDED
```

## 7. 自动化门禁

- 测试 `apps/datacore/test/decisions.test.ts`（4 用例：创建→读回→补录→预测 vs 实现；chosen 非法 400；R2 跨租户 404×3；status 过滤）全绿。
- `pnpm -r build` 全 4 包绿；`pnpm gates` 全绿（含 `repo-pg-notnull:check` / `ontology-writeback:check` / `system-ontology`）。

## 8. 本体回写（铁律 0）

- `docs/SYSTEM-ONTOLOGY.md` §2.D：新增一等对象 **Decision**（端点/事件/仓储/轻接 links）。
- §4 数据流事件表：新增 `decision.recorded` / `decision.outcome_recorded`（L5 行动/问责域，IN_SESSION → decisions）。

## 9. 距北极星

- ✅ 一等 Decision 记录闭环（上下文/备选/否决/决策人/预测 vs 实现）落库 + 读回 + 补录 + 对比，memory+pg 双实现真跑。
- ◐ 轻接：数据模型层 `links` 已就位（可挂 ACTION_DRAFT/PLAN_VERSION 等）；**自动从 Action 审批通过 / plan 定稿 触发记录 Decision 的 UI 联动尚未串**（当前为人工/前端发起，符合"轻接·不强耦合"边界，未做强耦合自动生成）。
- ◐ 复盘分析：当前对比为单条预测 vs 实现；**聚合复盘（MAPE 滚动 / 决策质量趋势）未做**（与 M11 校准引擎合流为后续）。
- 留审核方：前端真浏览器截图未在本环境采集（仅构建 + 组件 + 单测验证），诚实留审核方真浏览器复验。
