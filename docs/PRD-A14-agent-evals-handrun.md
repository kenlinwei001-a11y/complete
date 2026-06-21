# PRD · A14 · 亲手跑 agent evals 比对 PRD（真 Kimi，可观测 parity 报告）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 4（现状 ◐ 收尾） |
| 取代/扩展 | 扩 `PRD-addendum-agent-runtime.md`（评测）· 关联 `PRD-A13-*`（去 Kimi 抖动让 evals 可稳定比对） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§7 检测门禁 · §5 R6/R8） · `apps/agentcore/src/evals.ts`（EvalService：逐 case 跑真 QOS，观测 intent/toolSequence/answer）· `apps/frontend-shell/src/pages/admin/EvalsPage`（/admin/evals） |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：eval 基建已在（`evals.ts` 逐 case 跑真 QOS 管线、观测意图/工具序列/回答；管理页 `/admin/evals`），且现已可接**真 Kimi**。A14 把它做成**对 PRD 期望的系统化 parity 比对**——从 PRD/场景目录派生期望用例 → 真 Kimi 实跑 → 观测 vs 期望 diff → **parity 报告**（哪些场景的意图/工具/答案与 PRD 不符），并固化为 env-gated 回归。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.H）：`EvalCase`/`EvalSuite`/`EvalRunReport`/`EvalCaseResult`·`Scenario`（期望来源）·`Intent`/`ExecutionPlan`/`Agent`（被测）·`FallbackTrace`（兜底转用例）·`LlmProvider`（真 Kimi 绑定）。
- **触及链路**（§3 编排链）：`EvalCase(期望:intentKey/toolSequence/answerAssertion) → 真 QOS 实跑(分类→路径A/B) → 观测 → diff → EvalRunReport(parity)`。
- **触及事件/数据流**（§4）：复用既有；可选 `eval.run_completed`（失效 evals 页）。
- **触及不变量**（§5）：
  - **R6**：mock LLM 路径用于 CI（确定）；**真 Kimi 路径 env-gated**（`KIMI_*`/provider 配置时才跑，固化为单独回归，不进默认 CI 抖动）——与本分支既有"真 Kimi 分类 20/20 env-gated"同范式。
  - **R8**：真 LLM 经 LlmProvider 绑定（凭据 AES-GCM，R5 不回显）。
  - **R13**：parity 报告每项可下钻到实跑 trace（观测的意图/工具/答案 + validationTrace）。
- **关闭/影响断点**（§8）：把"声称 agent 能力达标"用**真 LLM 实跑比对 PRD**坐实（守"绿测试≠能用"）；消费 A13（去 LLM 角色消歧抖动 → 工具序列稳定可比）。
- **门禁**（§7）：mock evals 进默认 CI；真 Kimi evals env-gated 回归 · `chain:check`（被测场景求解器注册）· FDE 验收纪律（亲手跑一遍真 Kimi 看 parity）。
- **回写承诺**：回写本体 §7（agent evals parity 门）· §2.H（EvalSuite parity 维）。

## 1. 目标 / 非目标
### 目标
1. **PRD 期望用例库**：从场景目录 + PRD 验收项派生 `EvalCase`（期望 `intentKey` + `toolSequence` 子序列 + `answerAssertion` 关键断言），覆盖 20 场景。
2. **真 Kimi 实跑比对**：env-gated 用真 Kimi 跑 QOS 全管线，观测意图分类/工具调用序列/回答，与期望 diff。
3. **parity 报告**：`EvalRunReport` 标每场景 PASS/FAIL + 失因（意图错分 / 工具序列偏 / 答案断言未中），`/admin/evals` 可视、可下钻 trace。
4. **亲手跑通**：提供 CLI/页面一键"真 Kimi 全量跑"，人工看一遍 parity（FDE 纪律）。

### 非目标
- 不改 QOS orchestrator；A14 是观测/比对层。
- 不把真 Kimi 跑进默认 CI（env-gated，避免网络/抖动违 R6 CI 纪律）。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| eval 基建 | `evals.ts`：createCase / seed(从场景 `:38`) / fromFallback(`:58`) / run 跑真 QOS(`:78`) 观测 intent/toolSequence | 期望多为 intentKey；缺 toolSequence/answer 系统化期望 |
| 真 Kimi | 本分支已可接真 Kimi（分类 20/20 env-gated） | 未做"真 Kimi 全管线 parity 比对" |
| 报告 | EvalRunReport + `/admin/evals` | 无"对 PRD 期望"的 parity 维 + 失因分类 |
| 比对稳定性 | 工具序列受 LLM 角色消歧抖动 | 依赖 A13 去抖 |

## 3. 设计（期望库 + 真 Kimi 跑 + parity 报告）
### 3.1 PRD 期望用例库
- `eval-suite-prd.ts`（新或扩 seed）：从 `SCENARIO_CATALOG` + 各 PRD §验收派生 EvalCase，期望三元 `{intentKey, toolSequence[], answerAssertion[]}`（answerAssertion = 关键词/数值断言，确定可判）。
### 3.2 真 Kimi 实跑（env-gated）
- `runSuite(suite, {provider:"kimi"|"mock"})`：provider=kimi 时经 LlmProvider 真跑（env 配置时）；CI 默认 mock。
- 复用 `evals.ts` run（已跑真 QOS）；增 provider 维 + 观测 answer 断言。
### 3.3 parity 报告
- `EvalRunReport` 加 `parity:[{scenario, pass, observed{intentKey,toolNames,answer}, expected, failKind:INTENT|TOOLSEQ|ANSWER}]`。
- `/admin/evals`：parity 表 + 失因色 + 下钻实跑 trace（intent/工具/答案/validationTrace）。
### 3.4 亲手跑通入口
- CLI `platform evals --provider kimi`（人与 agent 共用）+ `/admin/evals` "真 Kimi 全量跑"按钮。

## 4. 契约 / 端点
- `contracts`：`EvalCase.expect` 扩 `toolSequence?/answerAssertion?`；`EvalRunReport.parity`。
- 端点：`POST /b/v1/evals/run`（provider 维）· `GET /b/v1/evals/report/:id`。
- 真 Kimi 经 LlmProvider 绑定（R8/R5）。

## 5. 关键流程（端到端）
配真 Kimi provider → `POST /b/v1/evals/run {suite:prd, provider:kimi}` → 逐场景真跑 QOS → 观测意图/工具/答案 vs PRD 期望 → parity 报告（如 18/20 PASS，2 个 TOOLSEQ 偏）→ `/admin/evals` 下钻失败 case 的实跑 trace → 修 agent/计划 → 重跑。

## 6. 非功能（§5）
R6（mock CI 确定 + 真 Kimi env-gated 回归）· R8/R5（真 LLM 凭据）· R13（trace 可溯）。

## 7. 验收（DoD）
- PRD 期望用例库覆盖 20 场景（intent+toolSeq+answer）；真 Kimi env-gated 跑出 parity 报告；`/admin/evals` 可视可下钻。
- 亲手跑一遍真 Kimi，记录 parity（FDE 纪律产出）。
- `pnpm -r build && pnpm -r test` 全绿（mock evals 默认 CI 绿；真 Kimi env-gated 回归）；维持 agentcore 先存 2 失败基线不恶化。
- 回写本体 §7/§2.H。

## 8. 分期
- **A14.1** EvalCase.expect 扩 toolSequence/answerAssertion + PRD 期望用例库（20 场景）。
- **A14.2** 真 Kimi env-gated runSuite + parity 报告 + 失因分类。
- **A14.3** `/admin/evals` parity 视图 + CLI 一键 + 下钻 trace。

> 依赖 A13（去抖）。基线分支：agentcore 为主，evalCases 仓储已在。
