# 派发清单 · 待开发 agent 施工的全部工单（链接 + 提示词）

> 审核方已成文施工单的**可直接派发**清单。每单：优先级 / 一句话 / 详细单链接（GitHub blob，分支 `claude/vigilant-knuth-b1nmxn`）/ 复制即用的提示词。
> **链接 base**：`https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/`（下表 `docs/X.md` 即拼此前缀）。
> **通用红线（每单适用·已写进各提示词）**：`pnpm -r build`(全4包·非本地半门) + `pnpm -r test` 全绿 + 按该单 FDE 真跑自验贴证（绿测试≠能用）；只 commit/push 到 `claude/vigilant-knuth-b1nmxn`；密钥仅 env 不入 git（R5）；改链路/事件/对象/不变量/门禁须回写 `docs/SYSTEM-ONTOLOGY.md`；命名禁外部产品名；模型标识不入任何提交物。

## §1 · 派发总表（按建议施工顺序）

| # | WO | 优先级 | 一句话 | 详细单（链接） |
|---|---|---|---|---|
| ~~1~~ | ~~**WO-P0-LOCK**~~ | ✅闭 | PG execution_locks 写入崩——**审核方真 PG 复验核发闭合** | [`REVIEW-WO-P0-LOCK-closure…md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/REVIEW-WO-P0-LOCK-closure-and-resume-finding.md) |
| 1b | **WO-T5-RESUME-LEASE** | **P1** | 重启续跑被死锁 60min 租约阻断→doc 卡 EXTRACTING（续跑机制本身对·被陈旧租约挡）。修：续跑前 steal 陈旧锁 | [`REVIEW-WO-P0-LOCK-closure…md` §2](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/REVIEW-WO-P0-LOCK-closure-and-resume-finding.md) |
| 2 | **WO-SCENE-A** | P1·速胜 | 规划体检对话入口 `WORKFLOW_ONLY`→`WORKFLOW_FIRST`（1 行解拒答） | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) |
| 3 | **WO-SHARE17** | P1·小 | 方案份额/收入魔数(-17/-100)→求解器下发 shareDelta/revGrowthPct（消自相矛盾） | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) |
| 4 | **WO-CSS** | P2 | DAG 深字 typo `--text`→`--txt` + `css-vars:check` 门 + 全站对比度审计 | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) |
| 5 | **WO-DM** | P1·keystone | dataMode 诚实位推广到全求解器契约 + `no-silent-mock` 门（hollow-data 地基） | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) · [`REVIEW-hollow-data…md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/REVIEW-hollow-data-iceberg-and-requeue.md) |
| 6 | **WO-AStar** | P1 | 洛阳红色点开「暂无数据」死路（红=哈希非真订单·点击落诚实面板，禁裸空） | [`REVIEW-hollow-data…md` §A-旗舰](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/REVIEW-hollow-data-iceberg-and-requeue.md) |
| 7 | **WO-SCENE-B** | P1·核心 | 规划体检配成完整场景 agent（本页数据+规则 C15-C23+求解器 MCP 子集+本体切片） | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) · [`HANDOFF-scene…md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/HANDOFF-scene-entry-agent-config.md) |
| 8 | **WO-DM-tail** | P2 | A1-A4/B-MED 各求解器接真源或标 PARTIAL（audit_timeline 哈希/yield/credit/loadByWeek/SopBalance） | [`REVIEW-hollow-data…md` §A1-A4/§B-MED](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/REVIEW-hollow-data-iceberg-and-requeue.md) |
| 9 | **GATE-B** | P2 | 本地 `pnpm gates` 只构建 2/4 包→改全 `pnpm -r build`（tsc-red 当绿出的根因解） | [`DEV-TODO…md` §GATE-B](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/DEV-TODO-reviewer-open-items.md) |
| 10 | **WO-SCENE-C/D** | P2/P3 | 场景 agent 铺到 20+ 入口 + `scene-agent-config:check` 门 | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) |

> **③类·需审核方先行后再派**（不在上表直派）：**轨O 主题/配色开关**（`HANDOFF-theme-switch-…md`·先由审核方真浏览器核"真缺到哪步"再交 dev，grep 可能漏报）· **WO-10② 真分核查**（`REVIEW-WO11-WO10b-verdict.md`·dev 复核分类器真分证据）。
> **审核方自留·非派发**（dev 修完后由审核方真跑）：P0-LOCK 修复复验 + T5 续跑真 PG 实拍 + d8498ae（§3③ 证据）复验。

## §2 · 逐单提示词（复制即用·发给开发 agent）

**WO-P0-LOCK（P0）**
```
你是开发 agent。实现 WO-P0-LOCK：修 PG 模式 execution_locks 写入崩（resource_kind NOT NULL）导致 rule-doc 抽取全失效。规格见 docs/WO-P0-lock-pg-fix.md（自包含·含根因/改 apps/datacore/src/repo/pg.ts 的 PgExecutionLockStore super() 补 extraColumns:{resource_kind,resource_key,holder_id,lease_until}/真 PG 回归测试/FDE 判据）。完成判据：真 PG 起 datacore，POST /a/v1/rule-docs(3 规则)→IN_REVIEW·candidateCount≥3 不再 PARTIAL；心跳真更新 lease_until 列；新增真 PG live-fire 回归并入 CI。红线：pnpm -r build(全4包)+pnpm -r test 全绿+真 PG 判据自验贴证；只推 claude/vigilant-knuth-b1nmxn；密钥仅 env；改锁语义回写 SYSTEM-ONTOLOGY.md；模型标识不入提交物。
```

**WO-T5-RESUME-LEASE（P1）**
```
你是开发 agent。实现 WO-T5-RESUME-LEASE：修 rule-doc 抽取重启续跑被死锁租约阻断。规格见 REVIEW-WO-P0-LOCK-closure-and-resume-finding.md §2。根因：进程崩在抽取中途，其 execution_locks 租约(rule_extraction=60min)未过期→重启时 resumeInflightExtractions→fireExtraction→withLock→acquire 命中未过期租约→SKIPPED→doc 卡 EXTRACTING 最长 60min。修向①(根因解)：resumeInflightExtractions 对每个遗留 EXTRACTING doc 先强制过期/夺取其锁再 fireExtraction（新进程启动时"在抽取中"doc 的锁必属已死进程·fencing 已防僵尸写），或给 withLock 续跑路径传 steal/force 选项。完成判据(真 PG)：杀 datacore 抽取中→立即重启→doc ≤一个抽取周期续到 IN_REVIEW（无需手动过期租约）·候选幂等不重复·fence 递增。红线：pnpm -r build+test 全绿+真 PG 续跑自验贴证(绿测试≠能用)；只推 claude/vigilant-knuth-b1nmxn；续跑须 steal 陈旧锁回写 SYSTEM-ONTOLOGY.md 执行语义；模型标识不入提交物。
```

**WO-SCENE-A（P1·速胜）**
```
你是开发 agent。实现 WO-SCENE-A：规划体检对话入口不再「请换个问法」拒答。规格见 docs/WO-design-landing-items-1-2-3.md 的 item3·WO-SCENE-A。改 apps/agentcore/src/mocks/seed.ts:512 scn_plan_audit mode "WORKFLOW_ONLY"→"WORKFLOW_FIRST"（全表唯一 WORKFLOW_ONLY）；并审计其余入口 mode/defaultAgentId。完成判据：真浏览器规划体检入口问开放式管理问句不再拒答、回落 agent。红线：pnpm -r build+test 全绿+真浏览器自验；只推 claude/vigilant-knuth-b1nmxn；改场景/入口链回写 SYSTEM-ONTOLOGY.md §8 G-3；模型标识不入提交物。
```

**WO-SHARE17（P1·小）**
```
你是开发 agent。实现 WO-SHARE17：消除 PlanGenerateView 份额/收入显示值与求解器 ✓/✗ 闸门自相矛盾。规格见 docs/WO-design-landing-items-1-2-3.md 的 item1·WO-SHARE17。求解器 apps/datacore/src/solvers/plan.ts 在 outcome 下发 shareDelta(outcome.share-base.share)+revGrowthPct，契约补字段；前端 apps/frontend-shell/src/views/sim/PlanGenerateView.tsx:238/240/275 渲染该字段、删 -17/-100 魔数。完成判据：方案 C 显示份额 +Npct 逐位=闸门所用值；改 base.share 前端跟随。红线：pnpm -r build+test 全绿+真跑自验；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-CSS（P2）**
```
你是开发 agent。实现 WO-CSS：修 DAG 深字深底 + 立门防同类。规格见 docs/WO-design-landing-items-1-2-3.md 的 item2·WO-CSS。① apps/frontend-shell/src/components/InferenceProcessDag.module.css:60 fill:var(--text)→var(--txt)（--text 全仓零定义）；② 新增 scripts/check-css-vars.mjs（扫所有 .css 的 var(--X)，X 须∈tokens.css 定义集，否则红）并入 pnpm gates；③ 全站对比度审计（硬编码深 hex 作文本/fill 的低对比处改 token）。完成判据：真浏览器 DAG 标签浅色清晰；css-vars:check 故意引 var(--nope)→门红。红线：pnpm -r build+test 全绿；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-DM（P1·keystone）**
```
你是开发 agent。实现 WO-DM：dataMode 诚实位推广到全求解器契约（hollow-data 根问题解）。规格见 docs/WO-design-landing-items-1-2-3.md 的 item1·WO-DM（背景 REVIEW-hollow-data-iceberg-and-requeue.md §A0）。① packages/contracts/src/solvers.ts 给 PlanAuditOutputSchema/PlanGenerateOutputSchema 补 dataMode（同 RiskTimelineOutputSchema）；② 为 extended.ts 13 求解器建最小输出 schema(含 dataMode)并入 SOLVER_OUTPUT_SHAPES；③ 求解器走兜底魔数/哈希置 MOCK/PARTIAL、走真数据置 LIVE；④ UI 复用 RiskBoardView:79-90 徽章范式铺到 audit/generate/extended 落点；⑤ 新增 scripts/check-no-silent-mock.mjs（每 SOLVER_KEYS 输出 schema 须含 dataMode）并入 pnpm gates。完成判据：audit 卡带 dataMode 徽章、兜底数标 PARTIAL、漏 dataMode 的求解器门红。红线：pnpm -r build+test 全绿+真跑自验；只推 claude/vigilant-knuth-b1nmxn；回写 SYSTEM-ONTOLOGY.md §2.E/§7；模型标识不入提交物。
```

**WO-AStar（P1）**
```
你是开发 agent。实现 WO-AStar：预判推演看板「洛阳红色点开暂无数据」死路。规格见 REVIEW-hollow-data-iceberg-and-requeue.md §A-旗舰。根因：红/越线日源自 risk.ts:28 mockTightness charCode 哈希、非真订单；点红→RiskBoardView.tsx:462-491 AffectedOrdersModal searchObjects(base=洛阳,day) 命 0→裸 zh.common.none。修向：给 mock 因素补真数据源 OR 点击落「该红基于 mock 基线·无真订单」诚实面板，禁裸「暂无数据」。完成判据：洛阳 D+13 红→点开→真受影响订单非空 OR 明确诚实文案、绝不裸空。红线：pnpm -r build+test 全绿+真浏览器实拍自验；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-SCENE-B（P1·核心）**
```
你是开发 agent。实现 WO-SCENE-B：把规划体检配成完整场景 agent（试点·做模板）。规格见 docs/WO-design-landing-items-1-2-3.md 的 item3·WO-SCENE-B + HANDOFF-scene-entry-agent-config.md §3。定义场景级 agent agent_plan_audit（systemPrompt 基于本页规划/财务/物料数据·tools 限 plan_audit/plan_generate/mrp_netting/query_objects/get_object/discover·ruleBindings[C15,C16,C18,C21,C23]·skills 解读规划体检），出厂幂等播种；scn_plan_audit 设 defaultAgentId+presetContext(view:plan-audit,planVersion)+sliceTargets(plan 域切片)+intentFilter；答案带「部分数字未能溯源」诚实位。完成判据（真 Kimi 真浏览器）：问「需要做哪些管理事项才能完成？」→接地结构化答复(引本页真值+调 plan_audit/plan_generate+透出 C15/C18 裁决+三条管理事项)，非拒答/非泛答/非预算耗尽。红线：pnpm -r build+test 全绿+真浏览器实拍；只推 claude/vigilant-knuth-b1nmxn；回写 SYSTEM-ONTOLOGY.md §2.H/§3/§8 G-3；模型标识不入提交物。
```

**WO-DM-tail（P2）**
```
你是开发 agent。实现 WO-DM-tail：hollow-data A1-A4/B-MED 各求解器接真源或诚实标。规格见 REVIEW-hollow-data-iceberg-and-requeue.md §A1-A4/§B-MED。逐项：audit_timeline(risk.ts:392-424 哈希曲线)、yield_diagnosis(extended.ts:477 良率台阶)、credit_exposure/quote_margin(extended.ts:457/463 魔数)、maintenance_stagger(extended.ts:472 负荷)、SopBalance 兜底簇(SopBalanceView.tsx:26/288/615)——有真数据源就接、无则置 dataMode PARTIAL+UI 标「示例/部分估算」。依赖 WO-DM(契约 dataMode)先落。完成判据：各项 UI 带诚实徽章、无凭空业务数。红线：pnpm -r build+test 全绿+真跑自验；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**GATE-B（P2）**
```
你是开发 agent。实现 GATE-B：本地构建门补全（tsc-red 当绿出的根因解）。规格见 docs/DEV-TODO-reviewer-open-items.md §GATE-B。本地 pnpm gates 当前只构建 contracts+datacore(2/4)→前端/agentcore tsc-red 漏过；改 package.json gates 把两处 --filter ... build 换成 pnpm -r build；并确认 CI gates.yml(已跑 pnpm -r build)为分支保护必过项。完成判据：本地 pnpm gates 能复现前端 tsc-red(不再 2/4 漏)。红线：pnpm -r build+test 全绿；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-SCENE-C/D（P2/P3）**
```
你是开发 agent。实现 WO-SCENE-C/D：以 WO-SCENE-B 为模板把场景 agent 铺到 dash/risk/order/sop-balance… 各入口（各自数据上下文/规则/求解器子集），并立 scene-agent-config:check 门（每 PUBLISHED 视图对话入口须 mode≠WORKFLOW_ONLY 或显式只读+defaultAgentId 已发布+rules⊆已发布+solverMcpAllow⊆注册表+sliceTargets 可达，否则红），纳入场景 maturity=GOVERNED。规格见 docs/WO-design-landing-items-1-2-3.md 的 item3·WO-SCENE-C/D。完成判据：抽样≥3 入口接本页数据真答；半截配置入口→门红。红线：pnpm -r build+test 全绿+真浏览器抽验；只推 claude/vigilant-knuth-b1nmxn；回写 SYSTEM-ONTOLOGY.md G-3/G-9；模型标识不入提交物。
```

---
*审核方派发清单（design+review·非 dev 实装）· dev 实装贴证后审核方按各单 FDE 判据独立真跑复验核发 · 仅 `claude/vigilant-knuth-b1nmxn`*
