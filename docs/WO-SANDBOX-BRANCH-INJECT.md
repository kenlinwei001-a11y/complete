# WO · SANDBOX-BRANCH-INJECT（分支注入不同应对 + 对比换决策维·让方案对比真有意义）· 详细施工单

> 状态：**待派单**（给 dev 的施工规格；作者不实现）。
> 一句话：分支后每条时间线可**注入不同应对**（A 外协 / B 加班），且对比维从"全局态曲线"换成决策者真在意的量（交付缺口/成本/齐套）——把现在"分支=两条一样的空容器"变成"真方案对比"。
> 依据：`docs/REVIEW-sandbox-intent-vs-reality.md #3/#11`（分支放不了不同方案·对比维错）。所有锚点已核对真实存在。
> 纪律：`DESIGN-refit-rollback-plan.md` 七原则。

---

## §0 本体引用与影响（铁律 0 · 门 `prd:check` 机器解析）

**触及对象类型（母体 §2）**：`SimSession`/`PropagationRule`/`SimCompareSeries`（§2.I·`contracts/sim.ts`）· `ActionType`（§2.G·应对=Action 模板/系数增量）· `SolverOutput`（§2.E·决策维来自求解器）。
**触及链路（母体 §3）**：沙盘链 checkpoint→branch→各自 tick→compare（**分支注入 disruption 增量·对比消费求解器决策维**）。
**不变量（母体 §5）**：R2 tenant · R4（应对采纳仍经 Action 审批·RL4 不直写） · R6 确定性（同注入同 tick 序同对比） · R13 溯源 · R14 零业务常数（应对/对比维抽象·配置驱动）。
**断点（母体 §8）**：G-9（场景发育）· G-1（预诊断）。
**回写母体**：§3 补"分支注入应对增量"关系；§2.I 若加"应对模板"对象则登记；`pnpm ontology:slices`。

---

## §1 背景·目标·依赖

### 1.1 问题（REVIEW 模拟脚本4）
命令条有「分支（多场景对比）」（`SandboxView.tsx:1021`），点存档→分支→子会话，但 **A/B 现在一模一样**——分支只复制当前态（`app.ts:1473` child scope=parent scope），**没法往 B 分支说"这条走外协/那条走加班"**。且 `SimComparePanel`（`SimComparePanel.tsx:32 meanSeries`）比的是"全局态均值曲线"，**不是交付/成本/齐套**这些决策者真在意的量。

### 1.2 目标
分支可注入不同应对 + 对比换决策维 → 方案对比真能支持决策。

### 1.3 依赖
- **前置**：S1（渲染器落地·分支/对比挂在统一触发之后）。
- **复用**：`simBranch`（`app.ts:1473`）· `SimComparePanel`/`fetchSimCompare`（已有）· `PropagationRule.coefficient/coefficientRef`（应对=改系数）· 求解器输出（决策维·如 `affected_orders`/`order_fullchain` 出交付/齐套）。

---

## §2 范围与非范围

**In scope**：
1. 契约：`SimSession.scope` 加 `mitigation`（应对增量·additive）；`SimCompareSeries` 扩决策维（不止 mean）。
2. 后端：branch 时接受 `mitigation`（作用=改指定传导规则系数 / 叠加 Action 模板效果）；compare 端点算决策维（调相关求解器在 A/B 末态上算交付/成本/齐套）。
3. 前端：`SimComparePanel` 支持"给 B 分支选应对"+ 对比表列决策维（复用既有对比面板骨架）。

**Out of scope**：
- ❌ 应对的真执行（采纳才经 Action R4·本 WO 只推演应对效果）。
- ❌ 应对模板库的完整建模（可先给 2-3 个内置抽象应对·扩展留后）。

---

## §3 详细设计

### 3.1 契约（`packages/contracts/src/sim.ts`）
```typescript
export const MitigationSchema = z.object({
  key: z.string(),                                   // 应对 key（外协/加班/…·抽象·R14 配置命名）
  ruleAdjustments: z.array(z.object({                // 应对=对若干传导规则的系数增量
    ruleKey: z.string(), coefficientDelta: z.number(),
  })).default([]),
  actionTemplateRef: z.string().nullable().default(null), // 或叠一个 Action 模板的效果
});
// SimSession.scope additive
mitigation: MitigationSchema.nullable().default(null),
// SimCompareSeries 扩：除 mean 序列，加决策维末值
// v1.1（用户钉·R14 修正）：决策维**不写死**"交付/成本/齐套"（那是电池租户的配置内容）——
// 改为消费与 AS-RENDER-TARGET §2.5 同一份 DecisionDim 注册表（配置：key/label/source{solverKey|stateVar}/direction）。
// 库存域租户配"齐套/持有成本/资金占用/缺货风险"，产能域配"交付/成本/齐套"——同一代码零改（R14/R-一致）。
export const CompareDecisionValueSchema = z.object({
  dimKey: z.string(), a: z.number().nullable(), b: z.number().nullable(),
  verdict: z.enum(["A_BETTER", "B_BETTER", "TIE", "NO_DATA"]),   // delta×direction 机械判（R6）·无数据诚实
});
```

### 3.2 后端（`app.ts` sim/branch + sim/compare）
- **branch 注入**：child session 建时,把 `mitigation.ruleAdjustments` 叠到 child 的有效传导系数（`effectiveCoefficient` 读时加 delta·R6 确定性）；或 `actionTemplateRef` 的效果作为 tick0 增量注入 child baseSnapshot。**A 主线不动**（对照）。
- **compare 决策维**：A/B 各自末态 → 调既有决策求解器（`affected_orders`→交付缺口 / `finance_pnl`→成本 / `kit_readiness`→齐套）→ 填 `CompareDecisionDims`。**求解器零改**（复用）。

### 3.3 前端（`SimComparePanel.tsx`）
- 分支时给"为 B 选应对"下拉（应对项来自 config·R14）。
- 对比表：现"全局态均值曲线" **保留** + **加决策维行**（交付缺口 A vs B / 成本 A vs B / 齐套 A vs B）+ 一句裁定"B 外协交付达标·成本+8%·建议 B"。

---

## §4 触点清单
| 文件 | 改动 | 面 |
|---|---|---|
| `packages/contracts/src/sim.ts` | `Mitigation`·scope +mitigation·CompareDecisionDims（additive） | 契约 |
| `apps/datacore/src/app.ts`（sim/branch·sim/compare） | 注入应对系数增量·compare 调决策求解器 | 后端 |
| `apps/frontend-shell/src/views/sim/SimComparePanel.tsx` | 选应对 + 决策维对比表 | 前端 |
| `apps/frontend-shell/src/views/sim/SandboxView.tsx` | 分支流程接应对选择 | 前端 |
| `docs/SYSTEM-ONTOLOGY.md` §3 | 回写 | 回写 |

---

## §5 验收（真跑·含回退演练）
1. **A≠B**：给 B 注入"外协"（改物流/产能规则系数）→ 推进后 A/B 末态不同、对比表决策维不同。
2. **决策维真算**：对比表交付缺口/成本/齐套逐值对后端求解器输出（非曲线均值）。
3. **R6**：同应对同 tick 序双跑对比字节一致。
4. **R4 正门**：采纳 B → Action 草稿（不直写）。
5. **回退演练**：feature `sim.branch_inject` 关→回"容器分支"（A/B 相同·旧行为）；契约 default→旧会话零破坏。
6. **gates 全绿**。

## §6 失败判据
- F1 应对增量污染 A 主线（对照失效）→ 关闸,查 child 隔离。
- F2 决策维求解器在 A/B 末态上报错/空→诚实空维不造数（KILL-MOCK-RED）。
- F3 契约破坏旧 compare→revert。
- F4 门红→不进下一期。

## §7 排序
- **前置 S1**；可在 S1 DONE 后与 S5 并行（触点：S3 compare/branch，S5 timeline/trace，弱相交）。
- **对账（2026-07-11·origin cap-sim 已合）**：WO-CAP-05-BRANCH-VISIBLE 已解决"对比卡首屏可达+scrollIntoView"——本 WO **只补差量**（注入不同应对 + 决策维注册表），可达性部分**勿重复实现**；锚点行号按 origin 最新校准（SandboxView 已 +195 行）。

## 附录 · 证据锚点
`SandboxView.tsx:1021`（分支按钮）·`app.ts:1473`（simBranch·child scope=parent）·`SimComparePanel.tsx:32`（meanSeries 当前对比维）·`sim/propagation.ts effectiveCoefficient`（系数增量注入点）·求解器 `affected_orders/finance_pnl/kit_readiness`（决策维源）·母体 §5 R4/R6/R14 · §8 G-9。
