# 审核闭环 · F-DM-KS-1（default-LIVE 过宣称）修复已核发

> 闭环：审核方 `REVIEW-WO-DM-keystone-finishup-verdict.md §F-DM-KS-1`（P2）提出 → dev `fa817c4`「WO-DM-tail 收尾」修 → 审核方真起 datacore 逐 invoke 独立复验。

## 一句话结论

**✅ 修复正确且已核发。** dev 照审核建议把 invoke wrapper 默认从 `LIVE` 改为 **fail-safe `PARTIAL`** + 引入经核实的 `LIVE_DEFAULT_SOLVERS` 白名单。审核方真跑坐实：被点名实例 `order_fullchain` 现 **PARTIAL**（700/周魔数不再冒充"实测"）；白名单纯真对象求解器仍 **LIVE**；非白名单非 hollow 落 **PARTIAL**（fail-safe）；hollow 自置位不受影响；门仍绿。

## 真跑核对（datacore memory·seed 42·demo admin）

| 类 | 求解器 | 修前 | 修后（真跑） | 判 |
|---|---|---|---|---|
| **点名实例** | order_fullchain（交期判 `bases.length*700` 魔数） | LIVE ❌ | **PARTIAL** | ✅ 不再过宣称 |
| 白名单（纯真对象/真优化） | finance_pnl / capacity_rollup / mrp_netting / plan_generate | LIVE | **LIVE** | ✅ 名副其实保留 |
| 非白名单非 hollow（fail-safe） | affected_orders | LIVE | **PARTIAL** | ✅ 默认转保守 |
| hollow（自置·不经默认） | audit_timeline / yield_diagnosis | PARTIAL / MOCK | **PARTIAL / MOCK** | ✅ 不受影响 |

> capex_scenario 真跑 `VALIDATION_ERROR`（需显式入参·空 args 不足）——与 dataMode 默认逻辑无关，不影响本核对。

## 修法评估（根因解·诚实优先）

- `service.ts` invoke wrapper：`out.dataMode ??= LIVE_DEFAULT_SOLVERS.has(solverKey) ? "LIVE" : "PARTIAL"`——**默认方向由 trust-by-default 反转为 fail-safe**（未显式核实 = 不敢称实测）。
- `LIVE_DEFAULT_SOLVERS` 白名单 = 经核实纯真对象读出/汇总（capacity_rollup/mrp_netting/finance_pnl/metric_rollup/cockpit_kpi/ksf_graph/margin_attribution/concentration_risk/generic_inference/shared_bottleneck）+ 真优化族（CP-SAT/确定性求解器）+ 代真规划/财务裁决（plan_audit/plan_generate）。
- 这正是审核建议的**方案①+②合并**（default→PARTIAL ∧ 逐一审计混合者降级），诚实精度命门收口：**LIVE 现"名副其实"**——只有零业务魔数/哈希者才标"实测"。
- 门 `no-silent-mock` / `genuine-sim` 仍绿（白名单改的是默认**值**，不动结构形状）。

## 残留诚实边界

- 白名单的"纯真对象·零魔数"判定基于 **dev 核实 + 审核方抽检**（order_fullchain 反例已坐实剔除；finance_pnl 正例已坐实保留），非全 25 穷举静态证明。若后续新增求解器，需人工判其入不入白名单（门只保证有 dataMode 字段、不保证值精度——值精度仍靠真跑/评审，本质不可静态全证）。

## 本体引用与影响

- **不变量 R13**（诚实位）：值层精度收口——LIVE 不再过宣称。R6 确定性不破（白名单是静态集合·同输入同 dataMode）。
- **断点**：hollow-data 冰山值层精度（F-DM-KS-1）**闭**。冰山 §A0 结构根因（前已闭）+ 值层精度（本次闭）= dataMode 诚实位地基完整。

---
*审核方独立核发（闭环：审核提出→dev 修→审核真跑复验）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入提交物*
