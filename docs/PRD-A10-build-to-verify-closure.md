# PRD · A10 · 终态闭环末步（建域→R4 审批→publish→自动重跑问句验证）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 3（现状 ◐ 收尾） |
| 取代/扩展 | 扩 `PRD-fullstack-story-build-g8.md`（g8-P5 inferenceProbe）· `PRD-demand-pulled-growth-engine.md`（LOOP CONVERGED）· 消费 `PRD-A5-*`（节点图末节点） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.H StoryBuildRun/inferenceProbe · §5 R4/R11/R13） · `apps/datacore/src/databuilder/service.ts:217-345`（inferenceProbe/runInference）· `apps/agentcore/src/growth/{probe,loop}.ts` · `apps/datacore/src/app.ts:290`（domainExecutor R4） |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：建域 → R4 审批 → publish 之后，**自动把"最初那句问句"再经 QOS 实跑一遍验证"现在真能答了"**——这一步现状 ◐：`inferenceProbe/runInference` 已能在建域时探针实跑（RUNTIME_PROBE），但**publish 后的"自动重跑 + 终态验证"未焊死**。A10 把它做成**全自动**（publish 完成事件触发重跑）+**可亲手跑通**（手动按钮），终态记 `VERIFIED`/`NOT_VERIFIED(缺口码)`，守"绿测试≠能用"。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.H）：`StoryBuildRun`（终态 + verification）·`ActionDraft`（publish 经 R4）·`BuildPlan`（主问句 script）·`Scenario`（targetView 启动器）·`GapReport`（验证失败缺口）·`GrowthLedgerEntry`（与建域 runId 归一）。
- **触及链路**（§3 + §10.3 `sys.meta.change_loop`）：`建域 → ActionDraft(物化/本体变更) → R4 审批 EXECUTED → publish → [自动] 重跑主问句(QOS probe) → 验证 answerable → StoryBuildRun.verification=VERIFIED`；闭合 §10.3 协同进化环的"验证"末段。
- **触及事件/数据流**（§4，D-29）：消费 `action.executed`（publish 落真值 → 触发自动重跑）；**新增** `build.verified`（验证终态，IN_SESSION，失效 FDE 节点图 + 成长账本）。
- **触及不变量**（§5）：
  - **R4 真值经 Action（核心）**：publish 必经 `domainExecutor` 审批（EXECUTED）才落真值，A10 在 EXECUTED 后触发验证（不绕审批）。
  - **R11 全链闭包**：验证 = 全链"真能跑通"的活证据（RUNTIME_PROBE）；未通过诚实记 `NOT_VERIFIED + 缺口码`，不假绿。
  - **R13 可溯源**：验证答案带 validationTrace（一致性 + 交叉验证）。
  - **R6**：探针经 QOS 实跑（LLM mock 测试）；兜底 BUILD_STATIC 诚实区分"未过 QOS"。
- **关闭/影响断点**（§8）：闭合 **G-3/G-8** 的"建域→答案"终态验证一环；与 growth LOOP `CONVERGED` 归一。
- **门禁**（§7）：闭包门 · `chain:check` · 跨服务冒烟（publish→probe 实跑）· `ontology:check` · FDE 验收纪律（亲手跑通）。
- **回写承诺**：回写本体 §2.H（StoryBuildRun.verification + build.verified）· §3（publish→自动验证末段）· §10.3（change_loop 验证段）· §8（G-3/G-8 收尾）。

## 1. 目标 / 非目标
### 目标
1. **全自动末步**：`action.executed`（publish 的 R4 EXECUTED）触发 → 自动以 BuildPlan 主问句经 QOS 重跑 → 记 `StoryBuildRun.verification{status, answer, evidence, answerable, gapCode?, validationTrace}`。
2. **可亲手跑通**：FDE 节点图末节点 / DataBuilderPage 提供"重跑验证"按钮（手动触发同一逻辑）。
3. **诚实终态**：answerable → `VERIFIED`（evidence RUNTIME_PROBE）；不可答 → `NOT_VERIFIED` + 缺口码（回灌 FDE 节点图断点 / 成长工单）；QOS 未配 → `BUILD_STATIC`（诚实标"未过 QOS 运行时"）。
4. **归一 growth**：验证通过即等价 growth LOOP `CONVERGED`（同 runId，写成长账本）。

### 非目标
- 不绕过 R4 审批自动 publish（审批仍人工/策略）；A10 只在 EXECUTED 后接验证。
- 不改 QOS orchestrator；复用 `POST /api/v1/growth/probe`（实跑→分类）。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| 探针实跑 | `service.ts:340 runInference` → inferenceProbe(QOS growth/probe) RUNTIME_PROBE / 兜底 BUILD_STATIC | 在**建域时**跑，非 **publish 后**自动重跑 |
| publish | `app.ts:290 domainExecutor`（R4 EXECUTED 落真值） | EXECUTED 后无"自动触发验证"钩子 |
| 终态 | StoryBuildRun 有 inferenceEvidence | 无 `verification` 终态字段 + `build.verified` 事件 |
| growth | LOOP `CONVERGED`（probe→可答） | 与建域 publish 验证未归一触发 |

## 3. 设计（EXECUTED 钩子 → 自动重跑 → 终态 + 事件）
### 3.1 publish 后自动触发
- `action.executed`（publish 类 ActionDraft EXECUTED）→ 钩子 `verifyBuild(ctx, runId)`：取 StoryBuildRun.BuildPlan 主问句 → 调 `inferenceProbe`（QOS 实跑）→ 回写 `verification`。
- 触发方式：① DataCore outbox 消费 `action.executed`（建域类）② 或 publish 流程末尾直接调（同事务后）。优先**事件驱动**（解耦、跨会话）。
### 3.2 verification 终态（StoryBuildRun 扩字段）
- `verification:{status:VERIFIED|NOT_VERIFIED|BUILD_STATIC|PENDING, answer, answerable, evidence, gapCode?, validationTrace, verifiedAt}`。
- `VERIFIED` ⇒ 写 `GrowthLedgerEntry`（runId 归一）+ 发 `build.verified`。
- `NOT_VERIFIED` ⇒ gapCode（7 码）回灌 FDE 节点图末节点红 + 可选开 growth 工单。
### 3.3 亲手跑通入口
- FDE 节点图⑧/DataBuilderPage："重跑验证"按钮 → `POST /a/v1/databuilder/runs/:id/verify` → 同 `verifyBuild` → 实时更新终态（用户亲手看一遍真跑通，FDE 纪律）。
### 3.4 诚实区分
- QOS 可达 + answerable → VERIFIED(RUNTIME_PROBE)；QOS 未配 → BUILD_STATIC；可达但不可答 → NOT_VERIFIED + 缺口码。**绝不以建域成功冒充能用。**

## 4. 契约 / 端点
- `contracts/storybuildrun.ts`：`StoryBuildRun.verification`、`BuildVerificationSchema`。
- 端点：`POST /a/v1/databuilder/runs/:id/verify`（手动重跑验证，admin）。
- 事件 `build.verified` 入 `event-subscriptions.ts`；消费 `action.executed`（建域类）。
- 仓储：StoryBuildRun 加 verification 字段（R9 四处）。

## 5. 关键流程（端到端）
建域产出 → publish ActionDraft 提交 → 审批 EXECUTED（R4 落真值）→ `action.executed` → 自动 `verifyBuild`：主问句"哪些工序瓶颈"经 QOS 实跑 → answerable=true → `verification=VERIFIED(RUNTIME_PROBE)` + validationTrace → 写成长账本 + `build.verified` → FDE 节点图⑧绿"已验证可答"。若不可答 → NOT_VERIFIED + "断在 SOLVER_NOT_FOUND" → 节点红 + 工单。

## 6. 非功能（§5）
R4（验证在 EXECUTED 后，不绕审批）· R11/R13（活证据 + 溯源）· R6（QOS mock 测试）· R10（build.verified 实时）。

## 7. 验收（DoD）
- publish（R4 EXECUTED）后**自动**重跑主问句并记 VERIFIED/NOT_VERIFIED；手动"重跑验证"按钮同效。
- VERIFIED 写成长账本（runId 归一）；NOT_VERIFIED 出缺口码回灌节点图。
- 全自动 + 亲手跑通双路验证（FDE 纪律：亲手看一遍真答）。
- `pnpm -r build && pnpm -r test` 全绿（verification 双仓储 + EXECUTED 钩子 + 手动端点 + 跨服务冒烟 publish→probe）；`chain:check`/闭包门/`ontology:check` 过。
- 回写本体 §2.H/§3/§10.3/§8。

## 8. 分期
- **A10.1** StoryBuildRun.verification 字段（R9 四处）+ `POST /runs/:id/verify` 手动末步。
- **A10.2** `action.executed`（建域类）自动触发 `verifyBuild` + `build.verified` 事件。
- **A10.3** VERIFIED→成长账本归一 + NOT_VERIFIED→FDE 节点图/工单回灌。

> 依赖 A5（节点图末节点承载）+ A3/A6（建出的域要真能跑）。基线分支：StoryBuildRun 加字段涉 migration，对准基线。
