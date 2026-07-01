# REVIEW · MULTISRC-FUSION + E1-E2 复验 → 2 门红 BLOCK（回归红·门红不核发）

> 审核方在 HEAD `6d004f2`（含 MULTISRC-FUSION `27288da` + E1-E2 `a8cbdf6`）跑 `pnpm -r test` → **2 个测试红**。按纪律「门红不核发」两单退回 dev 修。诚实：两处根因精确到 file:line，各带一键修法；MULTISRC 的融合行为本身已真跑验证通过（见下），门红仅是"加求解器未同步计数断言"。
> 对照基线：上一次全绿回归（`c7c5e5e`·SOURCE-TRANSPARENCY 复验）datacore 844 passed / frontend 299 passed / **0 failed**。本次两红均为这两个 commit 引入的新回归。

---

## BLOCK-1 · MULTISRC-FUSION（`27288da`）· datacore 计数断言未同步

- **门红**：`apps/datacore/test/ontology-core.test.ts:490` `expect(SOLVER_KEYS.length).toBe(46)` → **实际 47**（`expected 47 to be 46`）。
- **根因**：本单在 `apps/datacore/src/solvers/service.ts:126` 给 `SOLVER_KEYS` **新增 `multisource_fusion`**（46→47 合理），但 `ontology-core.test.ts:490` 的计数断言仍写 46 未同步 → `pnpm -r test` 红。
- **一键修**：`ontology-core.test.ts:487/490` 计数 46→**47**，用例描述补 "+ N1 multisource_fusion"（并核对 `SHAPE`/`chain:check` 覆盖含 multisource_fusion·service.ts:163 已声明输出形状）。
- **诚实·融合行为已验证真跑**（非门红范畴，仅计数断言）：
  - `test/multisource-fusion.test.ts` **7/7 passed**（真求解器 invoke·非 mock）：多源交期仲裁(chosenSource=MES·两源溯源·PARTIAL) / 新鲜度策略 / 测谎 SUSPECT+置信降级+保守值 / AUDIT 留痕 / R6 确定 / R2 隔离 / A5 规则驱动仲裁。
  - 审核方**独立真跑** `node scripts/fde-multisrc-fusion.mjs`(真 HTTP over 127.0.0.1·exit0)+**亲验原始 JSON**：场景2 测谎 常州 SCADA100/MES105/SELF**200(虚报)** → `suspect=true·verdict=SUSPECT·采纳保守 100(非 200)·SELF 置信砍至 0.333·dataMode=MOCK`——**不照单全收好看数字**（用户诉求命中）。
  - 审核方**自建 HTTP invoke** 确认 `multisource_fusion` 求解器存在(200)+R6 确定(字节一致)+`/a/v1/fused-objects` 审计端点存在(200)。（自建端到端 upload→objectify 播种撞 databuilder reconcile 规范列冲突 HITL·与融合无关·已诚实记录。）
- **结论**：融合真能用；**仅因加求解器未更新计数断言致回归红 → BLOCK 退 dev 一键修**（改 46→47），修后重跑 `pnpm -r test` 应全绿即可 built 回来。

---

## BLOCK-2 · E1-E2（`a8cbdf6`）· 沙盘 nav R3 门控回归

- **门红**：`apps/frontend-shell/test/wo-nav-data-sandbox.test.tsx:37` `expect(within(nav).queryByTestId("nav-sim-sandbox")).not.toBeInTheDocument()` 失败——**sim.sandbox entitlement 关（默认态）时，沙盘 nav 项仍渲染**（R3 门控失效）。
- **根因**：本单加"沙盘 what-if openWhatIf 进决策"入口，新增/改动了「推演」组沙盘 nav 项，但**未尊重 `sim.sandbox` entitlement 门控**——功能关=不存在(R3)被破。对照 `wo-nav-data-sandbox.test.tsx` 下一用例（sim.sandbox 开→项出现）说明门控语义要求"关则不渲染"。
- **一键修**：沙盘/初始化 nav 项（`nav-sim-sandbox`/`nav-sim-init`）渲染前判 `features.includes("sim.sandbox")`（entitlement 门控·关则不渲染），与既有 WO-NAV-SANDBOX R3 语义一致。E1-E2 新增的 `wo-e2-whatif.test.tsx` 已绿，仅此 R3 门控回归待修。
- **待补验（BLOCK 期间未及·修后连同复验）**：E1 CALIBRATION_SWEEP 逐轮收敛(mapeAfter 下降)真跑 + E2 openWhatIf presetContext 真进沙盘决策链——`wo-e1`/`wo-e2-whatif` 单测已见绿，但审核方尚未按前后端闭环+像素级真浏览器走一遍（沙盘门控修绿后一并做）。
- **结论**：**BLOCK 退 dev 修 R3 门控**（沙盘 nav 按 entitlement 门控），修后 `pnpm -r test` 全绿 + 审核方补前后端闭环像素级复验。

---

## 本体引用与影响
- 强化「门红不核发」+ C7 回归契约（四包全绿是 built→done 前提）。两红均 dev commit 引入·退回一键修·非审核方代改（reviewer 不改代码/不替 dev 绿测试）。
- MULTISRC 融合本体接线（FusedObject/多源仲裁/测谎/audit·SYSTEM-ONTOLOGY 已回写）行为已验证·仅计数断言待同步。

---
*审核方 2 门红 BLOCK（回归红·精确 file:line·各带一键修·门红不核发）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
