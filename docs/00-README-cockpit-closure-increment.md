# 增量包导读 · 驾驶舱"本月未达成原因"端到端闭合（7 份 PRD）

> 本增量解决一个真实场景:用户在经营驾驶舱问"**本月计划未达成原因**",系统因 空租户/无计划版本/归因路由缺失/agent 无产数据工具/单 admin 无法定稿 等一连串断点而答不出。本包 7 份 PRD **逐环修复**,开发完即可端到端答出(达成率/偏差/逐日时间归因)。

## 0. 先读
- 强制契约与门禁见 `00-START-HERE.md`(若本包含)/ 仓库 `docs/00-START-HERE-AGENT-CONTRACT.md`;数据闭环基线见 `PRD-data-closure-spec.md` + `data-closure-fullchain.svg`。
- 每份 PRD 的《本体引用与影响》§0 已按数据闭环 checklist 声明。

## 1. 七份 PRD 与依赖链（按此顺序开发）
| # | PRD | 修哪个环 | 依赖 |
|---|---|---|---|
| 1 | `PRD-llm-agent-empty-response-guard.md` | agent 路径裸崩(`reading 'usage'`)→ 结构化 R7 错误 | 无(可先做) |
| 2 | `PRD-admin-self-approval.md` | 单 admin 无法定稿 → 可配置留痕自审,解锁所有 R4 收尾 | 无 |
| 3 | `PRD-agent-data-generation-tools.md` | agent 无"产数据"工具 → fill_data/run_synthetic/build_domain(R4/未审核态) | 2 |
| 4 | `PRD-empty-tenant-bootstrap.md` | 空租户 → 7 步可执行清单(seed→SopVersion→定稿) | 2,3 |
| 5 | `PRD-in-dialog-gap-fill-loop.md` | 对话框内缺口卡→触发→反馈→续推 | 3,4 |
| 6 | `PRD-attainment-base-daily-timeseries.md` | 缺基地级日达成率序 → 时间维度归因数据 | spine |
| 7 | `PRD-attribution-routing-plan-audit.md` | "未达成原因"路由不到 plan_audit + 入参兜底 | 4,6 |

## 2. 端到端闭环（开发完后的实际流程）
```
驾驶舱问"本月计划未达成原因"
 ├─ 数据空?     → bootstrap(seed) + agent 工具(对话触发) + gap-fill(缺口卡)        [3,4,5]
 ├─ 无计划版本? → bootstrap 建+定稿 SopVersion + admin 自审                          [2,4]
 ├─ 找不到归因? → 未达成原因→plan_audit + 入参三级兜底 + discover 暴露              [7]
 ├─ 无时间维度? → attainment:base 日达成率序                                          [6]
 └─ agent 崩?   → 空响应护栏                                                          [1]
 ⟹ 数据→版本→路由→归因→逐日时序→答案(溯源)  端到端可答
```

## 3. 诚实边界（FDE）
- 这是**设计(PRD),非已实现**。开发完才解决;在此之前继续对话只会重复诊断。
- 七份缺任一,都会卡在对应环(如缺 7→找不到归因;缺 6→无逐日时间归因;缺 2→定稿卡死)。
- 真空租户仍需先跑 bootstrap(对话触发或对话外 seed);系统**不伪造**,无数据就诚实报缺口。

## 4. 同源四面
被触发的"产数据/引导"能力,GUI(缺口卡/向导)= 对话(agent 工具)= CLI(bootstrap op)同源(R15),数据走单一上传口 + 未审核态 + R4 转正(单 admin 经自审)。

## 5. 通用 DoD（每份）
`pnpm -r build && pnpm -r test` 四包全绿 + `pnpm gates`(ontology/chain/debattery/prd/...) 全过 + FDE 亲手跑该环 + 回写本体。详见各 PRD §7 与 `00-START-HERE`。
