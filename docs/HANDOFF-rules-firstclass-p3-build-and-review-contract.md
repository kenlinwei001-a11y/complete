# HANDOFF · 规则即一等引用 G-10 收尾(P3) · 开工与评审合同

> **这是 H5**（见 `HANDOFF-ROADMAP.md`）。让"改规则即改推演"在**所有**求解器入口真实成立。
>
> ⚠️ **特殊背景（防白干）**：本体 §8 G-10 说"待 P3 编辑器/全求解器映射"——**编辑器部分已 stale**。2026-06 摸底：规则一等化(28 条)/SOLVER_RULE_REFS/rule-closure 门/SolverContext 读规则/evaluateRuleRefs/**规则编辑器 UI(含 dry-run/发布影响面)**/版本指纹/rules.updated 事件失效**全部已建**。**H5 真缺口只剩两件：① 11/19 求解器没接 payload 映射(规则对它们"空过") ② 6 入口 FDE 验收没做。照"建编辑器"重写=红线打回。**

---

## 0. 先读：`SYSTEM-ONTOLOGY §8 G-10` · `PRD-rules-as-references.md` · `START-HERE-dev-agent.md` · 本文件 §1 · fde-delivery skill。

## 1. 《源↔现状↔设计》追溯表（H5 宪法）

| # | 元素 | 现状(锚点) | H5 处置 |
|---|---|---|---|
| R1 | 28 规则一等(C01–C33,含 params) | **真实** `synthetic/battery.ts:951-990` | 不建 |
| R2 | SOLVER_RULE_REFS 单源 + rule-closure 门 | **真实** `contracts/datacore.ts` + `scripts/check-rule-closure.mjs` | 不建 |
| R3 | SolverContext 读规则 + 版本指纹(FNV-1a) | **真实** `solvers/service.ts:1331-1351` | 不建 |
| R4 | evaluateRuleRefs(真 PASS/WARN/BLOCK/NOT_APPLICABLE) | **真实** `solvers/service.ts:1360-1408` | 不建 |
| R5 | 规则编辑器 UI(DSL 内联报错/params 可编/dry-run/发布影响面) | **真实** `RulesPage.tsx:206-349` | 不建 |
| R6 | 版本+事件失效(rules.updated→缓存失效) | **真实** `rules.ts:69,153,179` + `store/eventInvalidation.ts` | 不建 |
| R7 | no-hardcoded-rules 门(C09/C04 必读 params) | **真实** `scripts/check-no-hardcoded-rules.mjs` | 不建 |
| R8 | 规则手工管理 API + CLI(create/update/publish/retire/dry-run/references) | **真实** `rules.ts:32-204` + `platform rule` | 不建 |
| **R9** | **全求解器 payload 映射(规则字段喂进求解器输出)** | **🟡 8/19** `solvers/service.ts:1409-1471`(注释标"P3-b 续")；11 个返 NOT_APPLICABLE | **增量1（P0）** |
| **R10** | **6 入口逐一 FDE 验收(改阈值→6 入口全翻转)** | **🔴 缺** 代码汇聚 `/a/v1/solvers/:key/invoke`，无官方 FDE 报告 | **增量2（P0）** |
| R11 | 本体 stale(声称 19 求解器,实际 20，capacity_rollup 漏列) | 文档错 | **增量3 回写** |

> **不建（防重写）**：R1–R8。**H5 范围 = R9(11 映射) + R10(FDE 验收) + R11(回写)。**

## 2. 范围
**建**：11 个求解器的规则 payload 映射(R9)；6 入口"改规则即改推演"FDE 验收(R10)；本体回写(R11)。**不建**：编辑器/版本/事件/闭包门(都已建)。**先验**：增量0 真跑现有一条改阈值，确认 8 个已映射求解器真翻转。

## 3. 增量（每增量 DoD：亲手真跑 + 门绿）

| 增量 | 做什么 | DoD |
|---|---|---|
| **0** 真跑定基线 | 起 datacore，改 C03 阈值 0.5→0.4 发布，跑 capacity_forecast | 贴证据：C03 判定翻转 + ruleSetVersion 变；记哪 8 个已映射、哪 11 个返 NOT_APPLICABLE |
| **1（P0）** 11 求解器 payload 映射 | `solvers/service.ts:1409+` 扩 `ruleEvalPayload`：plan_audit(C15/16/18/21/23)/plan_generate/risk_timeline/affected_orders/cert_schedule/maintenance_stagger/mitigation_select/outsourcing_split/quarterly_gap/yield_diagnosis/capex_scenario——逐求解器把输出字段按规则 expression 同尺度映射 | 这 11 个 invoke 后 `evaluatedRules` 不再全 NOT_APPLICABLE，出真 PASS/WARN/BLOCK(贴证据)；口径不符诚实标 NOT_APPLICABLE+理由，不冒充 |
| **2（P0）** 6 入口 FDE 验收 | 改一条阈值发布 → 从 6 入口(项目推演/对话坞/CLI/驾驶舱/启动器/Agent 推演)同输入跑 → 截图改前改后承接判定一致变化 | 6 入口截图对比报告(贴)，证"改规则即改推演"全入口真实生效；不一致→报告断点 |
| **3** 本体回写 | `SYSTEM-ONTOLOGY §8 G-10` 19→20 求解器，capacity_rollup 列入 SOLVER_RULE_REFS 或说明无规则 | `ontology:check` 绿；G-10 状态更新为"P3 收尾(映射齐/FDE 验)" |

## 4. 红线
十红线(尤 **RL3** 不重写已建编辑器/引擎 · **RL5** 规则/params 是数据不写死 `no-hardcoded-rules` 守 · **RL6** 确定性版本指纹)。**stale-source 红线**：以 §1 锚点为准，不照本体"待编辑器"建(已建)。映射不准时**诚实 NOT_APPLICABLE**，绝不为凑"PASS"伪造尺度。模型标识不进提交物。

## 5. 评审协议
①十红线(尤 RL3/RL5) ②门全绿(+rule-closure/no-hardcoded-rules) ③本体回写(R11) ④**§1 追溯表逐行核**(R1-R8 没重写、R9/R10 真做) ⑤**FDE 亲手证据**(增量1 的 11 个真出 PASS/WARN/BLOCK；增量2 的 6 入口对比截图——不认测试绿) ⑥**口径专核**:抽查映射的字段与规则 expression 真同尺度,不是硬凑 ⑦CLI 对等+可回退+北极星距离。

## 6/7. 提交按 `START-HERE §6` 模板；起步=增量0(改阈值真跑,贴证据,认清 8 vs 11)。push 前 rebase,只推 `claude/vigilant-knuth-b1nmxn`,co-author `Claude <noreply@anthropic.com>`。
