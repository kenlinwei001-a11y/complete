# WO-ADOPT-SCHEME-CARRIER 交单报告 —— 方案采纳台账 + AOP 读端（G-ADOPT-SCHEME-NO-CARRIER 收口）

> 分支 `claude/handoff-wo-adopt-scheme-carrier` · 基线 `claude/verify-reclaim-6` · 重画像
> 断点原文：屏上「采纳这个方案」→ 审批 → EXECUTED 全链绿，但**没有一个对象承载「方案被采纳」这件事**。
> 本断点即 `G-ACTION-NOOP-EXEC` 的 ◑ 剩余项（11 型中唯一 NOT_IMPLEMENTED），两笔账实际是一笔，收编时合并——按仓主指示点名 **WO-ONTO-DEDUPE**。

## ① 实测数

| 项 | 改前 | 改后 | 证据 |
|---|---|---|---|
| ACTION_WIRING 归类 | WIRED 10 · NOT_IMPLEMENTED 1 | **WIRED 11 · NOT_IMPLEMENTED 0** | `node scripts/check-action-wiring.mjs` RC=0 原文：「11 个已注册 ActionType 全部显式归类（WIRED 11 · NO_WRITE 0 · NOT_IMPLEMENTED 0）」 |
| 落兜底线型数 | 2 型（plan_change、采纳经营方案） | 1 型（plan_change） | dependent-tests 小节 |
| 「采纳经营方案」审批后落库 | 零写入（EXECUTED 空转） | `scheme_adoptions` 台账 1 条 ACTIVE，AOP 读端可见 | seam-test 小节 |
| 迁移编号 | 下一可用 037 | 037 占用·无撞号·下一可用 038 | `node scripts/check-migration-numbering.mjs` RC=0 原文 |
| 三包编译 | — | contracts build RC=0 · datacore tsc RC=0（显式取码） | 本报告③节 |

## ② 改法论据

**病灶定性（沿本体 §3 链路走）**：断在 S2 审批链的执行器落点——`采纳经营方案` 在 battery.ts 有注册、前端有生产者（PlanGenerateView.adoptScheme，payload = 方案快照+目标面板），但 ACTION_WIRING 标 NOT_IMPLEMENTED，审批通过落 UnwiredActionExecutor 诚实失败。缺的不是执行器本身，是**承载对象**（断点名即此意）。

**为什么承载是专用 doc-jsonb 表而不是照 AdoptedMitigation/ForecastAdoption 走 repos.objects**（两处理由写进契约与迁移头注）：
1. 工单硬约定：「新增对象类型同时改四处（migrations + repo/pg + repo/memory + repo 接口），漏一处即退」——照 objects 先例走就无法满足这条明令。
2. 本体语义：方案采纳是**公司级年度拍板的审批留痕**（与 Decision 台账同族），不是推演艺联的本体对象——`plan_generate` 在 solvers/service.ts 的对象读取声明是空数组，塞进 objects 会让它在本体图谱里冒充「可被推演关联的实体」（断点论据①警告的形态）。
probe-gates 报告确认 effects 登记纪律与此兼容：BUILTIN_ACTION_EFFECTS 只登记与声明同文件的 ObjectInstance 写入执行器，独立 Store 表「宁可 coverage=NONE 不编造」（actions.ts 范围注释已据实补记「采纳经营方案」于未登记清单）。

**执行器语义**（app.ts domainExecutor「采纳经营方案」分支，搜 `SCHEME-ADOPT`）：
- payload 不过 `SchemeAdoptionPayloadSchema`（strict zod）→ ok:false 诚实失败，**拒绝臆造写入**；
- year = payload.year ?? forecastStart 前 4 位，解不出 → 诚实失败（不把台账挂到猜的年度上）；
- adoptionId 确定性派生（`sa_${hashString(year|schemeNo|pathKey|outcome 六字段)}`，R6 禁 Date.now/random）→ 同方案重复采纳覆盖同 id（幂等）；
- 同 (tenant,year) 旧 ACTIVE 置 SUPERSEDED——「至多一条 ACTIVE」是**写时不变量**，读侧无需在多条里挑（同 AdoptedMitigation 的「单源不并存」裁决）；
- adoptedAt = forecastStart 前 10 位（确定性时间锚，同 GlobalSimPlanExecutor/adopt_mitigation 纪律）；
- targetRef = `SCHEME-ADOPT:${adoptionId}`，**刻意非 MO 形态**；
- **不碰 PLAN_GOAL_TARGETS**（业务裁定）：targets 只作拍板那一刻的面板快照留痕对账，无写回基线路径。

**AOP 读端**：`AopResponse.schemeAdoption` additive optional（同 capexScenario 先例，老客户端零影响），PlanService.aop 下发本年度 ACTIVE 一条（tenantId 不下发，未采纳年份字段缺省）。

## ③ 量纲核对表（交付③ · 前科 G-LEVER-SNAPSHOT-UNIT-LIE 的三者对拍）

生产者 PlanGenerateView.tsx:231-251 → payload（SchemeAdoptionPayloadSchema）→ 台账 scheme_adoptions，逐字段同轴同量纲：

| 屏上显示 | payload 字段 | 台账落库值 | 量纲（三者同轴） |
|---|---|---|---|
| 营收增速 (rev/100−1)×100% | scheme.outcome.rev | outcome.rev 原样 | **归一指数（base=100），非元** |
| 毛利率 ×100 显示 % | scheme.outcome.gm | outcome.gm 原样 | **0-1 小数** |
| 市场份额 % | scheme.outcome.share | outcome.share 原样 | **百分数** |
| 库存周转 次/年 | scheme.outcome.turns | outcome.turns 原样 | 次/年 |
| 现金垫 亿元 | scheme.outcome.cash | outcome.cash 原样 | 亿元 |
| CAPEX 亿元 | scheme.outcome.capex | outcome.capex 原样 | 亿元 |
| 六维评分 | scheme.scores.{profit,scale,cash,growth,stability,total} | scores 原样 | 0-100 无量纲 |
| 硬违规清单 | scheme.hardViol | hardViol 原样 | 规则键数组 |
| 营收增长目标 % | targets.revGrowthPct | targets.revGrowthPct 原样 | **百分数** |
| 毛利底线（面板 % ÷100） | targets.gmFloor | targets.gmFloor 原样 | **0-1 小数**（= gmFloorPct/100，生产者 :243 实证） |
| 份额提升 pct 点 | targets.sharePts | targets.sharePts 原样 | pct 点 |
| 周转底线 次/年 | targets.turnsFloor | targets.turnsFloor 原样 | 次/年 |
| CAPEX 上限 亿元 | targets.capexCap | targets.capexCap 原样 | 亿元 |
| 现金底线 亿元 | targets.cashFloor | targets.cashFloor 原样 | 亿元 |
| 硬约束开关 | targets.hard.{gm,cash,capex} | targets.hard 原样 | boolean |

⚠️ 对账陷阱（已写进契约头注）：台账 `targets.gmFloor`（0-1 小数）与基线册 `PLAN_GOAL_TARGETS.gmFloorPct`（百分数）名字差一个 Pct 后缀、量纲差 100 倍——这是**有意的**（前者是求解器入参口径，后者是面板口径），别当成抄错。
执行器**全字段原样落库**（payload 已过契约，量纲即契约标注的量纲），零换算零派生 ⇒ 不存在换算错位的缝。机器对拍 = 接缝测试主用例逐字段断言（④节）。

## ④ T1-T5 实测原文

**接缝测试（头号判据）** `apps/datacore/test/action-adopt-scheme.seam.test.ts` 8 用例 —— 两轮独立证据：

seam-test agent 轮：`Test Files 1 passed (1) · Tests 8 passed (8)`（首轮 228s / 确认轮 128s，EXIT=0）；
审核方独立复跑轮：`pnpm --filter datacore exec vitest run test/action-adopt-scheme.seam.test.ts`（包相对路径）→ **SEAM_RC=0，8/8 全绿（106s）**，逐条 ✓：
头号效果断言（读回逐字段对拍）· AOP 读端（含 tenantId 剥离 + 1999 年缺省）· SUPERSEDED 轮换 · 幂等覆盖 · 诚实失败×2 · 基线未动 · R9 表名对账。

**变异反证（「不许只断言 EXECUTED」的硬判据）**：临时注释执行器主写入 `repos.schemeAdoptions.put({...})`（审批仍 EXECUTED + targetRef——正是「全链绿而真值没动」形态）→ 5 failed | 3 passed，**全部红在台账读回断言**，原文：
- SUPERSEDED 轮换：`AssertionError: 同年两次采纳不同方案 → 台账恰 2 条（一 SUPERSEDED 一 ACTIVE）: expected [] to have a length of 2 but got +0`
- 幂等：`AssertionError: 同方案重复采纳不得产出重复台账（确定性 id 幂等）: expected [] to have a length of 1 but got +0`
- AOP 读端：`expect(view, "采纳后本年度 AOP 响应必须带 schemeAdoption…" — Received: undefined`
- 头号效果断言与基线闸同形态红；**EXECUTED/targetRef 断言在变异下仍全绿**——咬人的是读回断言。探针已恢复（app.ts 零 diff）并复跑 8/8 绿。

**两处 WO 字面路径的据实修正**（seam-test 发现，审核方复核属实）：
1. 「payload 缺 targets」走不到执行器——battery.ts paramsSchema required 含 targets，submit 期即 4xx。诚实失败用例改为「targets 空壳 {}」（过粗卡口、不过 zod strict），语义不变；类型变异（gm="0.16"）用例单立。
2. WO 给的跑测命令需用包相对路径（`pnpm --filter datacore exec` 的 cwd 是包目录）。

（dependent-tests 四文件实测待填）

**连带测试（审核方独立复跑轮，逐文件显式取码，worktree 根 `pnpm --filter datacore exec vitest run <包相对路径>`）**：

| 文件 | 结果 | 要点 |
|---|---|---|
| action-plan-change-levers.seam.test.ts | RC=0 · 8/8 | 普查机器输出原文「**已注册 11 型｜落兜底线 1 型：plan_change**」；EXPECTED_FALLBACK 摘掉采纳经营方案（残缺载荷进真分支被契约拒收，EXECUTION_FAILED 匹配执行终态闸、不含 EXECUTOR_NOT_IMPLEMENTED 故落 realBranch 桶——机器数出来的落桶，非读码推算） |
| action-noop-exec.seam.test.ts | RC=0 · 5/5 | NOT_IMPLEMENTED 静态清单归零（留补回接口）；采纳经营方案并入 WIRED 反向守（三条「采纳」toBe("WIRED")） |
| action-metrics-endpoint.seam.test.ts | RC=0 · 2/2 | 断言零改动——契约拒绝的诚实失败仍产 `action_type="采纳经营方案",outcome="failed"` 指标；只改过时注释与自证文案 |
| action-metrics-tenant.seam.test.ts | RC=0 · 4/4 | 同上 |

**T1-T5 自测闭环**（WO 门禁纪律优先：禁 `pnpm -r build`/`pnpm -r test`/`gate.sh`，全量验收归集成态）：

| 门 | 命令 | 结果 |
|---|---|---|
| T1 构建 | `pnpm --filter @platform/contracts build` / `pnpm --filter datacore build` | RC=0 / RC=0（显式取码） |
| T2 测试 | 逐文件 vitest（上两表 5 个文件） | 27/27 全绿，每文件 RC=0 |
| T3 类型/规范 | datacore `tsc --noEmit` RC=0；`pnpm --filter datacore lint` RC=1 / contracts lint RC=1 —— **存量基线债**：错误分布 13 个我未碰的文件，contracts 侧在 org-world/process-instance/skill-graph（非本单新增文件）；app.ts 唯一错误 `72:10 cadenceFromProps unused` 经 `git show 955b8ca7` 与 `git show origin/claude/verify-reclaim-6` 双证在 merge-base 与集成线 tip 均在 :71 同态存在。**本单新增代码零 lint 错误** |
| T4 本体门 | `node scripts/check-system-ontology.mjs` | RC=0（175 断点 · 声称已闭 65 · 悬空 0） |
| T5 全链闭包 | `node scripts/check-chain-closure.mjs` | RC=0（首次 RC=2 是 dist 未构建的环境态——门自报「我没查」，补 dist 后重跑） |
| 专项 | `check-action-wiring.mjs` / `check-migration-numbering.mjs` | RC=0（WIRED 11·NI 0）/ RC=0（037 无撞号） |

红对地方对照（T1 变异判据）：拆主写入 → 红在台账读回断言（上文变异反证节）；契约拒绝 → 红在 EXECUTION_FAILED 而非静默成功；EXPECTED_FALLBACK 双向 toEqual——采纳经营方案若回兜底桶当场红且归因指向「代码回潮」而非「手法坏了」（dependent-tests 对 KNOWN_WIRED_CANARIES 不加该型的归因论证已采纳：其证据链骑在契约 strict 上，与无条件分支的金丝雀不同构）。

## ⑤ 基线变化

- **merge-base** = `955b8ca7`（开分支时集成线 tip，T2 判据用 merge-base 不用 tip）：HEAD 对 merge-base **17 文件 +705/−74**（4 个提交：① 承载+执行器 ② 接缝测试 ⑤ 连带测试 ⑥ 本体）。
- **集成线已前移**：`origin/claude/verify-reclaim-6` 不再是 HEAD 祖先（WO-STATEVAR-DISPLAYNAME 已并入）。双侧改动交集**仅 2 文件**且区块不相邻——`app.ts`：对方动 :69/:2178/:2208（传播输入接线），本单动 :61-62（import）/:839+（执行器分支）；`SYSTEM-ONTOLOGY.md`：对方 §3/§7（53 行新增），本单 §2.D/:116/§3 另一小节/§8。cherry-pick 预期干净，§3 小节可能需人工对齐。
- **测试基线方向（只降不升 ✓）**：兜底线普查金值 2 型→1 型；NOT_IMPLEMENTED 静态清单 1→0；lint/anchors 存量红未新增一条。
- **金值/注册即更核对（交付⑤）**：本单**未新增** ActionType（采纳经营方案早已注册 battery.ts:2979）也**未新增本体对象类型**（刻意专用表）——`action-type-evolution.test.ts:66 toBe(11)`、`sop-actions.test.ts:224` 注册清单、`coverage-blind-baseline.json`（按 sop-actions 测试名建键）全部不受影响，实测四文件复跑互证。grep 全仓旧计数（WIRED 10/NI 1/落兜底线 2）：tests/scripts 零命中（金丝雀 EXPECTED_FALLBACK 命中 3 行自证工具可信），docs 残留见 ⑥。

## ⑥ 文件重叠与没做的部分

**文件重叠**（`git log --oneline -3 origin/claude/verify-reclaim-6 -- <本单触目录>`）：近 3 笔全属 WO-STATEVAR-DISPLAYNAME（契约/前端消费/本体回写），与本单交集即 ⑤ 节两文件，区块不相邻。本单 4 提交与 WO-PLAN-CHANGE-LEVER-MAP 的 domainExecutor 冲突约束：对方若已开工，app.ts 兜底前插入段是共同热区——**收编时需串行**（本单分支已推，后到者 rebase）。

**没做的部分（据实交代 + 差什么）**：
1. **anchors 门 `--update` 校准没跑**——31 条 LINE_DRIFT 是行号漂移存量（干净 tip `184c19c0` 复验 RC=1 同 31 条，金丝雀 WorkflowApproveBodySchema 实测 :5283 漂移 88 行属实；本单 app.ts +65 行是漂移成因之一）。差什么：集成态跑一次 `node scripts/check-ontology-anchors.mjs --update`（会回写全文档行号 + `scripts/ontology-anchor-baseline.json` 基线），超出本单「只改 SYSTEM-ONTOLOGY.md」边界，故留集成方。
2. **前端 AOP 屏未消费 schemeAdoption**——WO 只要求「AOP 细化读端」（后端契约+组装已交付），屏上展示属 `views/sim/**` 范围边界（4 个 dev 在动）。差什么：一张轻画像前端单（读 `AopResponse.schemeAdoption` 渲染拍板留痕卡片），可随时派。
3. **两处历史审计文档的过期计数未改**——`docs/ONTOLOGY-7ELEM-AUDIT.md:257`、`docs/AUDIT-prd-reality-batch4.md:294` 各存一处旧接线态计数。它们是**带日期的判案快照**（审计时点的事实记录），照「历史记录不回头改」惯例不动；活文档（SYSTEM-ONTOLOGY/WO-QUEUE）已全部回写。
4. **lint 存量基线债未清**（13 文件，与本单无关，证据见 T3）——差一张独立的 lint 清扫单，不宜夹带进本单。

**多 agent 协同记录**：seam-test（接缝测试+变异反证）· dependent-tests（四文件改写+计数核查+金丝雀归因论证）· ontology-writeback（四节回写+anchors 门定性）· probe-gates（门与金值取证，先遣）。全部产出经审核方独立复跑/复验后提交，探针与临时 worktree 均已清。
