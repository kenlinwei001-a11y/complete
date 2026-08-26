# HANDOFF · WO-ONTO-STATUS-BACKFILL（§8 断点状态回填 + 状态标记门）

分支：`claude/handoff-wo-onto-status-backfill`（自 `origin/claude/verify-reclaim-6` 开出，交单时落后集成线 0 提交）

## ① 实测数（以我的现算为准，明确顶回工单给的数）

| 数 | 工单口径 | 本单实测（2026-08-18 · `node /tmp/wo-onto-extract.mjs`，行级抽取、整行判标记、不做列切分） |
|---|---|---|
| §8 编号行总数 | 190 | **193**（另有 5 个非 `G-*` 编号行：BP-6/BP-7/GAP-ATTR/GAP-GOAL/SUPPLY-DEMAND，合计 198；5 条均已带标记） |
| 无状态标记行 | 104 | **27** |
| 无标记唯一编号 | 95 | **27** |

差额成因：工单数字已过期——文档在持续演进（`G-1`…`G-12`、`G-BE-FE-SEAM-DEAD`、`G-MOCK-OVERCLAIM` 那一大批**今天都已带标记**，是此前各单陆续补的）。按「我没找到 ≠ 它不存在」纪律：本单的 27 是行级抽取器现算，金丝雀（已知带标记行必认出、表头不诬告）随门常驻。

补标结果：**🔴 11 · ◑ 13 · ✅ 3**，逐条复核论据（每条都先跑金丝雀或读到调用点，非按名推断）：

| 编号 | 标 | 今日复核证据 |
|---|---|---|
| G-PRD-DATA-UNGROUNDED | ◑ | 门 `check-prd-data-grounding.mjs` + 基线在位（基线含 9 条「待修」挂账）；存量 80 份清册待 WO-PRD-FIELD-AUDIT |
| G-SLICE-REF-PRODUCER-EMPTY | 🔴 | `refs/report.ts` 仍只产 `kind:"rule"`（L46），`kind:"slice"` 零产出；金丝雀 = 该文件 `kind:` 命中 2 处 |
| G-ACTIONTYPE-NO-TARGET | 🔴 | `domain.ts` 仍无 `targetTypeKey`（0 命中）；金丝雀 `ActionTypeRecord` 命中 |
| G-SLICE-ROOT-ARGS-UNDISCOVERABLE | 🔴 | 读 `app.ts` 的 `GET /a/v1/ontology/slices`（L4144-4158）：摘要投影仍只给 rootType/hops/linkKeys/maxNodes/fixtures |
| G-DERIVSPEC-EMPTY | 🔴 | `seed.ts` 零 `DerivationSpec`；金丝雀同文件 `DEMO_` 33 中 ⇒ 查询正常 |
| G-UPSERTTYPE-DROPS-FIELDS | ✅ | `ontology.ts upsertType`（L200）已改 `...input` 摊开 + WO-D6 注释在位——**行内「逐字段列举重建」描述已过期** |
| G-SLICE16-TWO-VOCABS | ◑ | 对账文/注记在位；B 集 16 层名仍未补录（REQ153 仍只有转述·外部阻塞） |
| G-SERIAL-GRAPH-EXECUTION | 🔴 | `executor.ts` L110 仍 `for…of` 串行；`multi-route.ts` L210 `Promise.all` 与 Coordinator（55 处）均在，三处既有扇出零收编 |
| G-SKILL-GRAPH-NO-RENDER-CLOSURE | 🔴 | contracts `skill-graph.ts` 头注 L22-23 仍写明「R11 本切片不校验·render 仍 NOT_IMPLEMENTED」 |
| G-SECURITY-COLUMN-LEVEL | ◑ | 契约 `propertyPolicy` + 互斥校验在位（datacore.ts L438-452）；残口②③④仍登记 |
| G-NO-INTERFACE | ◑ | contracts `object-interface.ts` 在位；残口见行内 |
| G-3 | ✅ | `CommandPalette` 已挂 `ShellLayout.tsx`（L14 import / L672 挂载）· `ScenarioLauncherPage` · `updateScenario` API 均在——**行内「待：前端启动器+场景编辑器(P3)」已落、描述据此过期** |
| G-7 | ◑ | `LlmProvidersPage` 修复在位；枚举扩展仍待 PRD P5 |
| G-CAPACITY-DEAD-BI | ◑ | `DynamicLeverPanel` 已挂 `RiskBoardView.tsx`（L22/1144）· 方案存/分支/横比（L1503）· 真 NL `CapacityLiveDialog`（L1187）已落；**行内「全只读投影」描述已过期**；残留 = QaPanel 正则假 NL 仍并列（L1184/1899-1933）未摘 |
| G-SIMSESSION-NO-BIZ-REUSE | 🔴 | `sim/sessions` 前端消费方仍全在 `views/sim/**`；PAUSED/ENDED 在 sim 会话上仍零置位（app.ts 唯一 PAUSED 在 L5342，是 workflow scheduler 不是 SimSession）。PRD 已立·实现未落 |
| G-AUDIT-TIMELINE-HASH-PROJECTION | ◑ | `risk.ts auditTimeline` dataMode 披露机制在位（L216-248）；真时序源仍待接 |
| G-SOLVER-SCOPE-DEAF | ◑ | 最危险的 `risk_timeline` 双键守卫已不在（`args.base && args.factor` 零命中）；4/16 已闭结论未见反证，其余仍静默 |
| G-YIELD-SERIES-SOURCE-MISMATCH | 🔴 | `extended.ts` 仍 `dataMode:"EMPTY"` 诚实空（L350-352）；A8→SolverContext 新数据通道未建 |
| G-UI-FIRSTLAYER-OVERLOAD | ◑ | `check-ui-first-layer.mjs` 门 + 棘轮基线在位；存量 burn-down 未完 |
| G-RULE-SCOPE-NAMESPACE-CONFUSION | ◑ | `rule-scope.ts` `findUnknownScopeTypes`（L108）+ `rule.scope_unresolved` 事件（L54）在位；C31/C10 仍开 |
| G-RULE-SCOPE-NO-CARRIER-C31 | 🔴 | `battery.ts` L3208-3209 注释仍写「故意保持原样」·承载类型仍零候选；金丝雀 `Material.outsourceYield` 在 battery-extended.ts L713 命中 |
| G-RULE-SCOPE-CATEGORY-ERROR-C10 | 🔴 | C10 expression 原样（battery.ts L390）；范畴错误待「另立作用域维度或退役」裁决 |
| G-GATE-RC1-MASQUERADE | ◑ | `check-gate-exit-discipline.mjs` 在位（本单新门也过了它：96/96 守纪律） |
| G-GATE-SCOPE-MISSES-SUBJECT | ◑ | `check-dev-jargon-onscreen.mjs` 扫描面已含 `locales/**`（头注 L25/37/57）；其余 60+ 门扫描面普查未完 |
| G-RATCHET-NEWFILE-BLIND | ◑ | `ui-first-layer` 门双盲区已修；其余 18 个基线写入方普查未完 |
| G-PROV-DRILL-DANGLING | ✅ | 同族残口 `supply_demand_gap_attribution` 已由 WO-R9-SDGA-DRILLID 修（service.ts L3018 起：聚合叶一律 `drillId:"*"`·单对象叶真主键·注释逐条写明判定）；**行内「4 处未闭」描述据此过期** |
| G-PROCESS-TICK-COVERAGE | ◑ | 现算：`DEMO_PROPAGATION_RULES` 13→**35**、覆盖流程 9/65→**29/65（44.6%）**，仍非全覆盖 |

**队列效果**（本单的立法目的）：`dispatch-deficit.sh` 的待写WO 计数（`grep -cE '🔴 *未修|◑ *部分闭合'`）在本文档上 **14 → 38**（+24 = 11 条 🔴 + 13 条 ◑，逐字对应补标行；§7 新条目刻意不写这两个字面序列，实测贡献 0）。这 24 个编号今天起进得了派单队列。⚠️ 该脚本在本机（macOS 无 `nproc`）整体 RC=2「取不到核数」——既存边界、本单范围外，队列计数部分已用同一正则独立验证。

**描述过期清单**（按工单要求单独标出，未动描述原文）：G-UPSERTTYPE-DROPS-FIELDS（整段机制描述已被 WO-D6 推翻）· G-3（「待 P3」已落）· G-CAPACITY-DEAD-BI（「全只读投影」已非现状）· G-PROV-DRILL-DANGLING（「同族残口 4 处未闭」已修）。留给后续 P3 去重单一并收口。

## ② 改法与论据

- **§8 只加标记**：27 行全部整行原位替换（`git diff --stat` = 27 ins / 27 del，全文行数 2328 不变），标记统一追加在末尾单元格内，编号/描述/链路列一字未动。
- **新门 `scripts/check-ontology-s8-status.mjs`**（alias `onto-s8-status:check`）：守「§8 每个编号行必须带 🔴/◑/✅ 之一」。编号口径 = 行首 `| <ID> |` 且 ID 匹配 `[A-Z][A-Z0-9]*(-[A-Z0-9]+)+`（覆盖 G-*/BP-*/GAP-*/SUPPLY-DEMAND；表头 CJK 与 `|---` 天然不匹配）。**按整行抽标记序列**（工单坑①：单元格内嵌竖线、列数 2/3/4/6/13 不等，按列切会碎）。金丝雀三向 + 扫描面下界（§8 编号行 <100 ⇒ RC=2），与主判据共用同一份 `scanLines()`/`ID_ROW_RE`/`MARK_RE`。退出码三分；顶层 `try { process.exit(main()) } catch → exit(2)` 是 Program 直接子语句（已过 `gate-exit-discipline`：96/96）。
- **登账 + 接线**：`gate-ledger.json` 新增条目（binding=GATES_CHAIN·guardedPaths=[docs/SYSTEM-ONTOLOGY.md]·provenRed=MUTATION 带两连变异证据）→ `package.json` 加 alias 并把门接进 `pnpm gates` 链尾（改前 `grep -c '"gates"'`=1，改后先 `node -e require` 解析成功再提交）。
- **§7 登门**：新增 `onto-s8-status:check` 条目（+1 行，在 §8 标题前）。条目内不写「🔴 未修」「◑ 部分闭合」字面序列（工单坑②——会被 dispatch-deficit 数进去），标记以 `🔴/◑/✅` 形态出现，实测队列计数贡献为 0。

## ③ T1–T5 实测输出原文

**T1（变异反证·红在正确的地方）**——摘掉 L2206 `G-RULE-SCOPE-NO-CARRIER-C31` 的标记后跑门：
```
🔴 §8 有 1 个编号行**没有状态标记**（🔴/◑/✅ 三态之一）：
   L2206 G-RULE-SCOPE-NO-CARRIER-C31
   没标记 = 没人判过，不等于已闭；它永远进不了 dispatch-deficit 的待写WO 队列。
变异① RC=1
```
红在「门报出了那条违规」，不是「门崩了」。复原后：`✓ onto-s8-status:check 通过 —— §8 编号行 198 条全部带状态标记（金丝雀 3/3 在位）。RC=0`

**T2（没碰的东西没红）**——stash A/B 逐字对比（本单只动 1 文档 + 2 脚本账 + package.json，所跑门均为纯 node 读文件脚本、不依赖 dist，故树内 stash 对比与 merge-base worktree 内容等价）：
- `check-ontology-anchors.mjs`：基线 RC=1 / HEAD RC=1，§8 补标后输出**逐字一致**；§7 登门（+1 行）后唯一 diff 是「本体 Lxxxx」定位号 +1（同批既存违规、同漂移量，零新增）。该红为既存（23 条行号漂移等），**本单范围外**。
- `check-gate-roster-handcopied.mjs`：BASE/HEAD 均 RC=1（既存未定性名单），diff 仅 `门 95 道 → 96 道`（本门被计入、零新增候选）。
- `check-gate-ledger.mjs`：BASE/HEAD 均 RC=2（agentcore/datacore dist 未构建的环境态，按派单只 build 了 contracts 与 llm-adapters），diff 仅条目数 95→96；「账无遗漏/无幽灵·binding 与现算一致」判据通过。
- `check-wo-anchors.mjs` RC=1、`check-ontology-descriptions.mjs` RC=2：BASE/HEAD **逐字一致**（均既存/环境态）。
- `check-system-ontology.mjs`：HEAD **RC=0**（断点编号：§8 已登记 175 · 声称已闭 64 · 悬空 0）。

**T3（金丝雀正反两侧·与主逻辑同一份实现）**：
- 正向（必咬）：内嵌无标记样例 `G-CANARY-MISSING` 必被报出（每次运行随门执行）。
- 反向（必不咬）：三条带标记样例（含 BP- 前缀）+ 表头/分隔行不诬告。
- 门自变异：`MARK_RE` 改恒假 →
```
⛔ 金丝雀不中 ⇒ 门自己坏了：② 必不咬不中：带标记样例被诬告（unmarked=3·rows=3）
   本次结论作废——不许读作「§8 全部带标记」。
门自变异 RC=2
```

**T4（基线方向）**：`gate-ledger.json` 只新增本门条目（provenRed=MUTATION，不占 NEVER 棘轮——NEVER 数基线 35 现算 35 不变）；`package.json` 只加 alias + 链尾挂门；无任何 `--update`/`--tighten` 认账。**基线没动。**

**T5（交单前三条）**：
```
git status --porcelain        → 空
check-branch-base.mjs HEAD    → RC=0（落后集成线 0 提交）
check-merge-conflict-markers  → RC=0
```

## ④ 基线变化

没动（既未收紧也未认账）。唯一计数变化是 `dispatch-deficit.sh` 的待写WO 现算 14→38——那是本单的**交付目的**（让 24 个断点进队列），不是基线抬升。

## ⑤ 文件重叠

`git log --oneline -5 -- docs/SYSTEM-ONTOLOGY.md scripts/`：本体文档是高频共改文件。**实测到一次真撞车**：本单进行期间，`wo-gate-roster-sweep-2` 的 dev（worktree `agent-af5310a15bdb31dc5`）把它的 `scripts/check-ui-first-layer.mjs` 新版本**写进了本 worktree**（其 worktree 内副本 94407B，误入本树的副本 95532B、更新），同时本树 §8 的未提交编辑被外部 reset 清掉一次。处置：误入文件已保全至 `/tmp/wo-stray-check-ui-first-layer-gate-roster-sweep-2.mjs`（**审核方请转交该 dev 核对**），本树该文件已 reset 回 HEAD，我的 §8 编辑重放后立即提交落袋。该 dev 自己也在改 `docs/SYSTEM-ONTOLOGY.md`（其 worktree 有 M 记录）——收编时若撞 §8 行，按内容 merge（双方改的是不同行）。另有 P3（§8 去重）串行排在后：本单 §8 全部改动为行内追加标记、行数不变，G-12 双行等重复结构原样保留，去重单可直接接。

## ⑥ 没做的 + 差什么

1. **27 条断点本身的修复不在本单范围**（本单只判状态）。其中 11 条 🔴 现已能进待写WO 队列，逐条修法已写在各行状态格内（如 G-SLICE-REF-PRODUCER-EMPTY = B 侧发布时上报 sliceKey·`dril/relations.ts` 有现成抽取）。
2. **4 条描述过期**（清单见①末节）未改原文——按工单「只加标记」边界留给 P3 去重单/后续单收口。
3. **G-CAPACITY-DEAD-BI 残留**：QaPanel 正则假 NL 仍与真 NL 并列未摘——差一张「摘除 QaPanel 或改挂真 NL」的小单。
4. **G-PROCESS-TICK-COVERAGE 覆盖 29/65**：差传导规则补种（每条需 carrier 类型真数据支撑，非纯文案）。
5. `dispatch-deficit.sh` 在 macOS 因 `nproc` 缺失整体 RC=2（既存，本单范围外）——差一个 `sysctl -n hw.ncpu` 回退，任何 dev 可一行修。
