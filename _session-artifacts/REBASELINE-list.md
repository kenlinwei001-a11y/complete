# 重新基线逐项清单 · 37 测试红分类(累积中)

> 数据源:5 个分类 agent(读真实报错+代码+mock)。守 no-blind-green:STALE_GOLDEN 必须是"代码对、测试过期"且新值是真值;REAL_BUG 必须修代码。
> 进度:✅ 前端(7) · ✅ VLE(5) · ⏳ 本体/合成 · ⏳ 切片/治理 · ⏳ 时序/仿真

## 🔴 735231e 引入的真 bug(必须修代码/fixture,不是改测试就完)

| 项 | 文件 | 问题 | 修法 |
|---|---|---|---|
| **luoyang 幽灵基地** | `apps/datacore/src/synthetic/battery.ts:33` | `圆柱-LFP` 基地 `yangzhou→luoyang`,但 luoyang 未注册进 BASE_REGISTRY(省份/开工日映射仍 yangzhou)→ model_producible_at/model_certified_on 2 条悬空链接。VLE 引用完整性门正确逮住。 | 回退 `luoyang→yangzhou`(保 13 基地)**或**完整加 洛阳 进 BASE_REGISTRY+省份+开工日(变 14)。**这是 5 个 VLE 红的根。** |
| **需求 scale 不一致** | `apps/frontend-shell/src/mocks/fixtures.ts:483-486` (sopConfig.segments) | 735231e 把 seed FINAL/audit 需求 scale 到 375.0,但 live `sopConfig.segments` 只 scale 到 367.6 < 供给 367.9 → 缺口从"应为正"翻成 -0.3,毁掉 f17 要验的"gap>2 红标"场景。 | 把 fixtures.ts sopConfig.segments rolling 总和对齐 seed/audit(≈375 → gap≈7.1),再断言 7.1。**不可盲填 -0.3。** |

## 🟡 735231e 需求-scale · 过期金值(改测试断言到新 scale)

| 测试 | 文件:行 | 改 | 置信 |
|---|---|---|---|
| sop-frontend-1to1 | `test/sop-frontend-1to1.test.tsx:26` | `"11"`(11.1)→`"31.5"`;注释 P50 12.0→34.1 | HIGH |
| f14.plan-audit | `test/f14.plan-audit.test.tsx:19-20` | dem `132`→`375`;sup `131.2`→`374.2`(gap 0.8 不变,其余全同) | HIGH |
| f20.live-recompute-race | `test/f20.live-recompute-race.test.tsx:32,67,38` | 哨兵 dem `140`→`383.0`(gap 8.8)、`135`→`378.0`(gap 3.8);慢请求 guard `/867.8/`→`/624.8/`(999−374.2) | HIGH |
| f17.sop-balance | `test/f17.sop-balance.test.tsx:55` | 先修上面 fixtures 不一致 → 再断言 gap≈`"7.1"` | MED(数值待 fixture 对齐后定) |

## 🟢 历史欠账(pre-existing,与 735231e 无关)

| 测试 | 文件 | 类别 | 修法 |
|---|---|---|---|
| g-governance | `test/g-governance.test.tsx:14` | 测试数据 bug(非产品码) | 登录密码 `"demo"`→`"demo1234"`(seed 账号要 demo1234)。**勿改 LoginPage/handler,产品码是对的。** |
| f1.account-switch | `test/f1.account-switch.test.tsx:14,35` | 测试数据 bug | 同上,密码 `"demo"`→`"demo1234"` |
| VLE Base 计数金值 | `apps/datacore/src/vle.ts:61` | STALE_GOLDEN | `GENSPEC_S_COUNTS.Base` `12`→13(BASE_REGISTRY 早已 13 唯一基地,金值在 12-基地时代写死没更新)。**与 luoyang 修法联动**:回退则 13,加洛阳则 14。 |

## ⏳ 待补(3 个 agent 未回)
- 本体/合成:demo-chain-provenance(66≠34 类型)、data-categories、synthetic、solvers(capacity_rollup)
- 切片/治理:slice-order-fulfillment(SL4-7)、planviews、ontology-governance(G6)
- 时序/仿真:timeseries(T4/T5)、simclock(T6/T7/T9)、livedin(Y3/Y4/Y4b)、m11-calibration(C1/C7/C9)

## 关键提醒(给本机 700B agent)
- battery.ts 的 luoyang + 需求 scale 不一致**都在本机 agent 正编辑的文件里**——它做 700B 时应:① 补齐/回退 luoyang;② 让需求数在 **battery.ts SEG_DEMAND / fixtures.ts sopConfig.segments / seed FINAL / plan-audit input** 四处**一致 scale**(现在 367.6 vs 375 打架)。
