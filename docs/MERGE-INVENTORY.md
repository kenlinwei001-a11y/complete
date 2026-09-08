# 收编清单 · 2026-09-08 · base=`0fc852b7`（origin/claude/merge-batch-9）

> **量法**：对每条 `origin/claude/handoff-*` 分支算 `git merge-tree --write-tree <PIN> <branch>`。
> **判据落在内容上，不是祖先关系**（CLAUDE.md 铁律 0.6）：
> 合并结果树 == PIN 的树 ⇒ 这条分支合进来**什么都不带** ⇒ 已并；
> 树不同且 RC=0 ⇒ 待并·干净；RC=1 ⇒ 待并·有冲突。
> 全量枚举 **798 条**，未抽样。试合并全部走 `merge-tree`，**不落盘、不碰工作树**。

## 金丝雀（两个都对才往下读）

| 金丝雀 | 判定 | 结论 |
|---|---|---|
| `handoff-wo-loss-attrib-money` @ `268913a0` | **已并** | ✅ 符合预期 |
| `handoff-wo-adoption-survives-fix` @ `922d5e97` @ base `f7f4a00d` | **待并·有冲突** | ✅ 符合派单预期 |
| `handoff-wo-adoption-survives-fix` @ `922d5e97` @ base `0fc852b7` | **已并** | ⚠️ 见下「量法自证」 |

**这是一个差分金丝雀，比单向金丝雀强**：**同一条分支**在 `f7f4a00d` 上判「待并」、在 `0fc852b7` 上判「已并」，
中间隔的正是收编方把它并进来的那个提交 `0fc852b7`（提交信息就点名了这条分支）。
一个「永远说已并」或「永远说待并」的坏量法**过不了这两半中的一半**。单向金丝雀分不出这两种坏法。

### ⚠️ 量法自证：第一次扫描作废，原因写在这里防复发

第一版扫描**结果全部作废**，因为它把 `INTEG` 当成了一个固定的东西：
脚本开头取一次 `origin/claude/merge-batch-9^{tree}`，然后拿这个值去比对 800 条分支。
**而扫描期间 `merge-batch-9` 被推进了** —— 从 `f7f4a00d`（树 `18be194b`）动到 `0fc852b7`（树 `21bd4d9c`）。
本仓所有 worktree **共用同一份 refs**，任何一个 agent 跑 `git fetch` 都会把远端引用挪到所有人脚下。

后果不是「差一点」，是**结论反向**：动了之后，361 条**其实已并**的分支因为比对的是旧树，
全部被读成 `PENDING_CLEAN`。第一版报「待并 385」，钉住 SHA 重扫后是 **23**。

形态（铁律 0.6 句式）：
> **「我用『扫描开始时取的那个树哈希』当作『集成线现在的样子』的证据，而前者并不度量后者 —— 它在我扫描期间还在动。」**

这与铁律 3 记的 LOOP10 踩坑**是同一个形态**（五个角色以为钉在同一棵树上，实际 canonical 在取证期间还在被推进）。
**改法：PIN 写死 SHA，扫完再核一次引用有没有动。** 本次扫描前后 `merge-batch-9` 均为 `0fc852b7` ⇒ 结果有效。

## 总账（798 条，四类互斥，加起来必须等于 798）

| 段 | 类 | 条数 | 收编方要做什么 |
|---|---|---|---|
| **A** | 待并·干净 | **23** | 直接 merge |
| **B** | 待并·有冲突 | **315** | 见 B 段分组 |
| **C** | 已并 | **449** | 不用管 |
| **D** | 空壳 | **11** | 可删 |
| | **合计** | **798** | |

C 段 449 = 祖先型 440（tip 就在 `0fc852b7` 的历史里）+ 内容型 9（cherry-pick/squash 进来的，
祖先关系不成立但内容已在）。**只看祖先关系会把这 9 条误报成待并** —— 那正是派单说的第一个方向的错。

## A · 待并·干净（按建议顺序，先并的排前面）

**顺序的尺子**（不是字母序）：① 改同一批文件的排在一起 —— 同一轮 LOOP 的角色报告写进同一个目录，
连着并可以一次看完一轮；② 纯新增（\`-0\`）排在有删改的前面 —— 纯新增合进来不可能压掉别人的东西；
③ 同一簇内改动小的先并。**两条动源码的排最后**，它们是这一段里唯一需要看 diff 的。

| # | 分支 | tip | 它带来了什么 | 文件数 | 行数 | 建议顺序理由 |
|---|---|---|---|---|---|---|
| 1 | `loop11-builder` | `a1b96d51` | LOOP11「builder」角色评审报告 | 1 | +45/-0 | LOOP11 簇 · 最新 · 各 1 文件纯新增，零风险打头 |
| 2 | `loop11-fde` | `805bbb9f` | LOOP11「fde」角色评审报告 | 1 | +41/-0 | LOOP11 簇 · 最新 · 各 1 文件纯新增，零风险打头 |
| 3 | `loop11-flow` | `29961897` | LOOP11「flow」角色评审报告 | 1 | +41/-0 | LOOP11 簇 · 最新 · 各 1 文件纯新增，零风险打头 |
| 4 | `loop11-researcher` | `acc97d35` | LOOP11「researcher」角色评审报告 | 1 | +58/-0 | LOOP11 簇 · 最新 · 各 1 文件纯新增，零风险打头 |
| 5 | `loop11-skeptic` | `52386b97` | LOOP11「skeptic」角色评审报告 | 1 | +30/-0 | LOOP11 簇 · 最新 · 各 1 文件纯新增，零风险打头 |
| 6 | `loop11-user` | `c42425e1` | LOOP11「user」角色评审报告 | 1 | +188/-0 | LOOP11 簇 · 最新 · 各 1 文件纯新增，零风险打头 |
| 7 | `loop10-builder` | `92de0a2d` | LOOP10「builder」角色评审报告（含取证截图） | 1 | +49/-0 | LOOP10 簇 · 同目录连并 |
| 8 | `loop10-researcher` | `2c0842bd` | LOOP10「researcher」角色评审报告（含取证截图） | 4 | +38/-0 | LOOP10 簇 · 同目录连并 |
| 9 | `loop10-skeptic` | `61c3eb69` | LOOP10「skeptic」角色评审报告（含取证截图） | 4 | +39/-0 | LOOP10 簇 · 同目录连并 |
| 10 | `loop10-fde` | `d6095902` | LOOP10「fde」角色评审报告（含取证截图） | 5 | +100/-0 | LOOP10 簇 · 同目录连并 |
| 11 | `loop10-user` | `5b0f0451` | LOOP10「user」角色评审报告（含取证截图） | 14 | +93/-0 | LOOP10 簇 · 同目录连并 |
| 12 | `loop10-flow` | `e3c411b2` | LOOP10「flow」角色评审报告（含取证截图） | 36 | +196/-0 | LOOP10 簇 · 同目录连并 |
| 13 | `loop9-ceo` | `668eb679` | LOOP9「ceo」角色评审报告 | 1 | +444/-0 | LOOP9 簇 · 同目录连并 |
| 14 | `loop9-ops` | `e18ba2dc` | LOOP9「ops」角色评审报告 | 1 | +642/-0 | LOOP9 簇 · 同目录连并 |
| 15 | `loop9-researcher` | `2902ae19` | LOOP9「researcher」角色评审报告 | 1 | +300/-0 | LOOP9 簇 · 同目录连并 |
| 16 | `loop9-skeptic` | `c823b29b` | LOOP9「skeptic」角色评审报告 | 1 | +3/-0 | LOOP9 簇 · 同目录连并 |
| 17 | `loop9-fde` | `54dc60aa` | LOOP9「fde」角色评审报告 | 47 | +569/-0 | LOOP9 簇 · 同目录连并 |
| 18 | `wo-branch-cleanup` | `70f5cfd7` | 分支清理审计方案（本单的前身，1215 行） | 1 | +1215/-0 | 独立新文件 · 与本清单同题，先并可对照 |
| 19 | `wo-breakpoint-triage-2` | `a4a542c2` | 断点二次分诊队列文档 | 1 | +203/-0 | 独立新文件 · 纯新增 |
| 20 | `wo-changeover-key` | `ff9ebf54` | 换型键探针测试（datacore 新增测试文件） | 1 | +35/-0 | 纯新增测试文件 · 不改任何既有源码 |
| 21 | `wo-unit-dict-asymmetry-forensics` | `7ea24d2f` | 单位字典不对称取证报告 | 1 | +158/-0 | 独立新文件 · 纯新增 |
| 22 | `wo-column-security-tail` | `58341a98` | 列级安全残口收尾（datacore app/errors/planviews/simclock） | 7 | +185/-9 | ⚠️ 动源码且有删改（-9），排在纯新增之后 |
| 23 | `wo-modeling-no-llm` | `e662d131` | 建模不依赖 LLM 的回退路径 + DEPLOY 说明 | 8 | +679/-17 | ⚠️ 动源码且有删改（-17）· 本段最大，压轴 |

**A 段合计 23 条**，其中 21 条是纯新增（不可能压掉集成线上任何东西）。

## B · 待并·有冲突（315 条）

**315 条一条一条列出来对收编方没有用**，所以先按**冲突性质**分组 —— 同一组的解法是同一个。

| 冲突性质 | 条数 | 什么意思 | 解法 |
|---|---|---|---|
| 全 `add/add` | **23** | 两边各自新建了同名文件；集成线上那份**已经存在** | 多半是**过期**，见 D 段 |
| 全 `content` | **128** | 同一文件两边都改了同一片区域 | 逐条裁决 |
| 混合 | **164** | 上面两种都有 | 逐条裁决 |

**冲突最集中的一个文件是 `docs/SYSTEM-ONTOLOGY.md`：315 条里有 178 条在它上面冲突**（第二名 `apps/datacore/src/solvers/service.ts` 只有 66 条）。
这不是巧合 —— 它是一份**所有人都往里追加**的台账，天然每条分支都会碰。

> ⚠️ **这一段的解法不许是「取并集」。** CLAUDE.md 铁律 0.6 第 5 条写死了：
> **TRACE / §8 的合并冲突一律不许取并集** —— 取并集会造出**状态相反的双份**，
> 比冲突本身危险得多（冲突会红，双份不会），而且已经真的让调度机制凭空派出过不存在的活。
> `SYSTEM-ONTOLOGY.md` 的 178 条冲突，**每一条都要看那几行说的是不是同一件事**。

### B1 · 只冲突在文档上（40 条）——不碰源码，风险最低

这 40 条的冲突文件里**没有一个 `apps/` / `packages/` / `scripts/` 下的文件**，
所以合错了也压不到产品源码。建议**先清这一段**，它能把 315 砍掉 40。

| 分支 | tip | 日期 | 冲突性质 | 冲突文件 |
|---|---|---|---|---|
| `wo-computed-edge-proposal` | `27cd745e` | 2026-09-06 | 全 add/add（集成线已有同名文件） | `docs/PROPOSAL-computed-edge.md` |
| `wo-sim-ux-prd-5pages` | `976e2b59` | 2026-08-26 | 全 content（同片区域两边都改） | `docs/prd-coverage-index.json<br>docs/prd-ontology-index.json` |
| `wo-gate-selfclaim` | `1f95cb50` | 2026-08-26 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `wo-process-tick-edges-3` | `71b6b4f0` | 2026-08-20 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `wo-onto-s8-dedupe` | `f12b7f1a` | 2026-08-20 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `wo-trace-ledger-writeback` | `2b75f36d` | 2026-08-19 | 全 content（同片区域两边都改） | `docs/REQUIREMENTS-TRACE.md` |
| `wo-onto-s8-merge-guard` | `2788a584` | 2026-08-19 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `wo-gate-scan-surface-census` | `388caa6b` | 2026-08-19 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `interface-admin-ui` | `775024c6` | 2026-08-19 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `wo-trace-ledger-sweep` | `d964339e` | 2026-08-18 | 全 content（同片区域两边都改） | `docs/REQUIREMENTS-TRACE.md` |
| `wo-qos-pagectx-eval` | `ede68794` | 2026-08-18 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `wo-gsim-cockpit-nl` | `22792d94` | 2026-08-17 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `wo-prd-field-audit` | `8ed7727b` | 2026-08-11 | 全 add/add（集成线已有同名文件） | `docs/AUDIT-prd-field-grounding.md` |
| `wo-ontology-ia` | `97ad494d` | 2026-08-11 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `wo-metrics-audit` | `a4cea8ed` | 2026-08-11 | 全 add/add（集成线已有同名文件） | `docs/AUDIT-metrics-tenant-authz.md` |
| `wo-a6-seg` | `2f54e84d` | 2026-08-11 | 全 add/add（集成线已有同名文件） | `docs/AUDIT-sandbox-cross-seg.md` |
| `wo-a6-rule-scan` | `844267f2` | 2026-08-11 | 全 add/add（集成线已有同名文件） | `docs/AUDIT-a6-rule-carriers.md` |
| `skill-migration-scope` | `6cddca17` | 2026-08-09 | 全 add/add（集成线已有同名文件） | `docs/WO-SUITE-skill-migration.md` |
| `prd-coverage-full` | `2cdc882d` | 2026-08-09 | 全 add/add（集成线已有同名文件） | `docs/AUDIT-prd-coverage-full-2026-08-09.md` |
| `sandbox-gap-audit` | `ec5cbbc4` | 2026-08-07 | 全 add/add（集成线已有同名文件） | `docs/AUDIT-sandbox-redesign-gap-2026-08-07.md` |
| `prd-audit-b5` | `cb494eb0` | 2026-08-07 | 全 add/add（集成线已有同名文件） | `docs/AUDIT-prd-reality-batch5.md` |
| `prd-audit-b4` | `dd3e87f9` | 2026-08-07 | 全 add/add（集成线已有同名文件） | `docs/AUDIT-prd-reality-batch4.md` |
| `prd-audit-b3` | `ddac597c` | 2026-08-07 | 全 add/add（集成线已有同名文件） | `docs/AUDIT-prd-reality-batch3.md` |
| `prd-audit-b2` | `5ef6503c` | 2026-08-07 | 全 add/add（集成线已有同名文件） | `docs/AUDIT-prd-reality-batch1.md<br>docs/AUDIT-prd-reality-batch2.md<br>docs/AUDIT-prd-reality-batch4.md<br>docs/AUDIT-sandbox-redesign-gap-2026-08-07.md` |
| `prd-audit-b1` | `a2ff3445` | 2026-08-07 | 全 add/add（集成线已有同名文件） | `docs/AUDIT-prd-reality-batch1.md<br>docs/AUDIT-prd-reality-batch2.md<br>docs/AUDIT-prd-reality-batch4.md<br>docs/AUDIT-sandbox-redesign-gap-2026-08-07.md` |
| `wo-nl-robust` | `fd01770a` | 2026-08-06 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `prd-skill-runtime` | `5b7a6e1d` | 2026-08-03 | 全 add/add（集成线已有同名文件） | `docs/PRD-skill-runtime-orchestrator.md` |
| `prd-skill-migration` | `25ce5c6f` | 2026-08-03 | 全 add/add（集成线已有同名文件） | `docs/PRD-skill-migration.md` |
| `prd-skill-governance` | `4f3cfa70` | 2026-08-03 | 全 add/add（集成线已有同名文件） | `docs/PRD-skill-governance-learning.md` |
| `prd-skill-contract` | `86a90bab` | 2026-08-03 | 全 add/add（集成线已有同名文件） | `docs/PRD-skill-contract-dsl.md` |
| `prd-skill-compiler` | `373a84d9` | 2026-08-03 | 全 add/add（集成线已有同名文件） | `docs/PRD-skill-compiler-registry.md` |
| `wo-66-rules-first-class` | `c05137e4` | 2026-07-30 | 全 add/add（集成线已有同名文件） | `docs/rule-threshold-ledger.md` |
| `wo-databuilder-harness` | `379a2039` | 2026-07-25 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `qos-live-evidence` | `69543dff` | 2026-07-24 | 全 add/add（集成线已有同名文件） | `docs/acceptance-log-qos-live-10q.md` |
| `ontology-drift-fix` | `dbac7845` | 2026-07-20 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `tier3-metric-rollup-split` | `c9f05a93` | 2026-07-19 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `diag-100q` | `55636f5d` | 2026-07-19 | 全 add/add（集成线已有同名文件） | `docs/DIAG-100Q-RESULTS-preview.md<br>docs/DIAG-100Q-RESULTS.md<br>docs/WO-DIAG100Q.md` |
| `inference-prd` | `8e8f2817` | 2026-07-18 | 全 content（同片区域两边都改） | `docs/prd-ontology-index.json` |
| `geo-real-signal` | `ff780e84` | 2026-07-18 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |
| `ext-signal-detail-be` | `4d5595f8` | 2026-07-18 | 全 content（同片区域两边都改） | `docs/SYSTEM-ONTOLOGY.md` |

**B1 的两条实测样例（说明这一段该怎么读）**：

- `handoff-prd-skill-compiler` 冲突在 `docs/PRD-skill-compiler-registry.md`，性质是 `add/add`。
  实测两边行数：**集成线 907 行 vs 分支 741 行**，差 `+174/-8`。
  ⇒ 集成线那份是**后来又长过的**，分支这份是旧的。这条基本可判**过期**，
  但 **`-8` 那 8 行是分支独有的**，删之前要看一眼那 8 行是不是有价值 —— 我没有逐条看，**这是留给收编方的一个动作**。
- `handoff-wo-onto-s8-dedupe` 冲突在 `docs/SYSTEM-ONTOLOGY.md`，性质是 `content`。
  这条恰恰是**去重单** —— 它要做的事和「§8 长出双份」这个病是同一件事。
  ⇒ 合它之前先确认它去掉的那几行**今天还在不在**，不在就说明已经有人做过了（禁令 1 的 B 类，别再做一遍）。

### B2 · 冲突涉及源码（275 条）——按「冲突面」分簇

275 条里绝大多数是 **7 月/8 月推的老分支**：测得日期分布 **7 月 135 · 8 月 135 · 9 月 5**。
老分支的共同点是 merge-base 很旧，集成线在同一批文件上早已走远，所以冲突面大而真正独有的内容少。

**分簇的尺子**：按「第一个源码冲突文件」归簇 —— 同簇的分支在**同一片代码**上打架，
一起处理可以只把那片代码的来龙去脉搞清楚一次。下表是冲突面最集中的簇：

| 冲突面（源码文件） | 撞上它的分支数 |
|---|---|
| `apps/datacore/src/app.ts` | 25 |
| `apps/datacore/src/solvers/chain-loss.ts` | 13 |
| `apps/datacore/src/catalog.ts` | 13 |
| `apps/datacore/src/solvers/service.ts` | 10 |
| `apps/agentcore/src/agent/loop.ts` | 10 |
| `apps/agentcore/src/features/registry.ts` | 9 |
| `apps/datacore/src/synthetic/battery.ts` | 8 |
| `apps/frontend-shell/src/mocks/handlers.ts` | 7 |
| `apps/frontend-shell/src/views/RiskBoardView.tsx` | 6 |
| `apps/frontend-shell/src/App.tsx` | 6 |
| `apps/agentcore/src/event-subscriptions.ts` | 6 |
| `apps/agentcore/src/dril/resource-projector.ts` | 6 |

#### B2a · 9 月 + 8 月下旬的分支（最可能仍然有效，建议先看这一批）

| 分支 | tip | 日期 | 改动文件 | 其中未被吸收 | 源码冲突数 | 主冲突面 | 它带来了什么 |
|---|---|---|---|---|---|---|---|
| `wo-riskboard-truncation` | `f4239eda` | 2026-09-08 | 2 | 2 | 1 | `packages/contracts/src/solvers.ts` | （提交信息为空，需看 diff） |
| `wo-computed-edge-impl` | `063137a8` | 2026-09-07 | 15 | 7 | 1 | `apps/datacore/src/app.ts` | 回退两份门产物索引的 generatedAt 日期噪声（本单没有�… |
| `merge-to-canonical` | `0df3a17a` | 2026-09-06 | 231 | 43 | 15 | `apps/datacore/src/app.ts` | fix(test): 收编引入的红 —— 因果图 DECISION 缺口断言跟�… |
| `merge-batch-2` | `e95b0f3e` | 2026-09-06 | 25 | 20 | 2 | `apps/datacore/test/solvers-extended.test.ts` | merge-batch-2 修合并引入的红（不新增功能，只补注册与�… |
| `wo-rui4-coords` | `5bba74d0` | 2026-09-04 | 15 | 7 | 4 | `apps/datacore/src/decision/causal-graph.ts` | WO-RUI4: 门补 §2 后端载荷侧扫描面 + 取证脚本移出版本�… |
| `wo-sim-opt-readable` | `61f38f8e` | 2026-08-28 | 4 | 4 | 4 | `apps/frontend-shell/src/views/sim/console/ParetoChart.tsx` | （提交信息为空，需看 diff） |
| `wo-view-audit-b` | `c4d68acb` | 2026-08-26 | 2294 | 328 | 297 | `apps/agentcore/src/agent/navigation-slice.ts` | docs(audit): 订正 §6 行数口径不一致（helper 列两处混用�… |
| `wo-sim-session-wire` | `842ed354` | 2026-08-26 | 3 | 3 | 3 | `apps/frontend-shell/src/api/endpoints.ts` | （提交信息为空，需看 diff） |
| `wo-sim-nav-unified` | `67536c0f` | 2026-08-26 | 5 | 3 | 1 | `apps/frontend-shell/src/pages/ShellLayout.tsx` | （提交信息为空，需看 diff） |
| `wo-sim-honest-fallback-b` | `5951a0fd` | 2026-08-26 | 9 | 5 | 3 | `apps/frontend-shell/src/views/sim/console/SandboxOpt.module.css` | （提交信息为空，需看 diff） |
| `wo-legibility-12px` | `1b108e21` | 2026-08-26 | 6 | 4 | 3 | `apps/frontend-shell/src/components/QueryDock/ChatFlow.tsx` | （提交信息为空，需看 diff） |
| `wo-gate-seam-small` | `1f68c0fa` | 2026-08-26 | 6 | 2 | 1 | `apps/agentcore/test/mockdc-params-increment.seam.test.ts` | 验收通过：4 门 RC=0 + BUILD_RC=0 + 三个受影响测试文件全�… |
| `wo-attr-dead-controls` | `c25e4148` | 2026-08-26 | 5 | 4 | 2 | `apps/frontend-shell/src/views/sim/console/SandboxAttr.tsx` | WO-ATTR-DEAD-CONTROLS · 死控件门（11 用例：契约现算/真选�… |
| `wo-arghints-12-loud` | `2508e40f` | 2026-08-23 | 2 | 2 | 1 | `apps/datacore/src/catalog.ts` | （提交信息为空，需看 diff） |

⚠️ **这一批里有两条不是普通工单，是「聚合分支」，不要当成一张 WO 去并**：

- `merge-to-canonical` @ `0df3a17a` —— **231 个改动文件、15 个源码冲突**。它本身就是一次收编尝试的产物。
- `wo-view-audit-b` @ `c4d68acb` —— **2294 个改动文件、297 个源码冲突、328 个文件仍未被吸收**。
  这个体量不可能是一张视图审计单的真实产出，**几乎可以肯定它是从一个很旧的基线长出来的**，
  合并它等于把那个旧基线整个压回集成线。**建议不要合并，改为从它里面挑出真正要的那份审计文档。**

#### B2b · 8 月中上旬及更早（240 条）——建议整批先不并，逐条确认「今天还需不需要」

理由不是「旧」，而是**实测的成本收益**：这批分支的 merge-base 距今很远，
冲突面大（中位数落在多文件），而 CLAUDE.md 铁律 0.6 第 5 条记过五次教训 ——
**台账说「没做」不度量「真没做」**，五张单的前提全部被 dev 实测推翻，其中一张「八个提交前就做完了」。
这 240 条里有多少已经被别的路子实现了，**我没有逐条追**（那需要每条追一层调用，是另一张单的工作量）。

**所以这一段我只给清单，不给「建议合并」的结论** —— 给了就是拿「分支还在」当「活还没做」的证据，
正是本仓禁令里点名的那个错。逐条清单如下（日期 · 分支 · tip · 改动文件数 · 未吸收数 · 源码冲突数 · 主冲突面）：

```
2026-08-20  wo-graph-fanout-w2                             9e2504e0  f=14    u=14    c=7    apps/agentcore/src/router/multi-route.ts
2026-08-20  wo-graph-fanout-salvage-audit                  3b32dbb3  f=15    u=15    c=7    apps/agentcore/src/router/multi-route.ts
2026-08-20  wo-derivspec-seed                              19fb8d9c  f=6     u=6     c=2    apps/datacore/src/seed-cli.ts
2026-08-19  wo-slice-required-args                         a7f3dcca  f=8     u=8     c=2    apps/datacore/src/app.ts
2026-08-19  wo-ratchet-conservation-sweep                  bcce72f0  f=28    u=28    c=1    scripts/check-text-legibility.mjs
2026-08-19  wo-fact-usage-rename-inflation                 d8a4bc5b  f=5     u=5     c=1    scripts/gate-ledger.json
2026-08-19  wo-entitlement-action-server-gate              3420b193  f=3     u=3     c=2    apps/datacore/src/app.ts
2026-08-19  wo-caplive-qapanel-retire                      ba623ad5  f=3     u=3     c=1    apps/frontend-shell/src/views/RiskBoardView.tsx
2026-08-18  wo-u8-occlusion-grid                           1415ea0a  f=9     u=9     c=3    scripts/gate-ledger.json
2026-08-18  wo-splitaccount-b2-baseline                    c445a8d9  f=3     u=3     c=2    scripts/check-harness-ux-splitaccount.mjs
2026-08-18  wo-roster-reg-2                                a2349bc5  f=2     u=2     c=1    scripts/gate-roster-baseline.json
2026-08-18  wo-mock-fe-registry-parity                     9e64711e  f=16    u=16    c=2    apps/agentcore/src/catalog/service.ts
2026-08-18  wo-gate-b-browser-harness                      f209c6cf  f=8     u=8     c=3    scripts/gate-ledger.json
2026-08-18  wo-doctrine-writeback                          6d7500b9  f=5     u=5     c=1    scripts/gate-ledger.json
2026-08-18  wo-dispatch-deficit-macos                      2634591f  f=1     u=1     c=1    scripts/dispatch-deficit.sh
2026-08-17  wo-sandbox-action                              27c5e368  f=24    u=24    c=10   apps/datacore/src/actions.ts
2026-08-17  wo-publish-refprobe                            ea86916e  f=11    u=11    c=2    apps/agentcore/src/catalog/service.ts
2026-08-17  wo-mockdc-params                               ff227410  f=8     u=8     c=1    apps/agentcore/src/mocks/clients.ts
2026-08-17  wo-befe-delete-wire                            136a810e  f=10    u=10    c=1    apps/frontend-shell/src/pages/admin/AgentsPage.tsx
2026-08-14  wo-r9-sdga                                     589c89ab  f=1     u=1     c=1    apps/datacore/test/prov-drillfield-truth.test.ts
2026-08-14  wo-r9-distfresh                                5cd21e8b  f=1     u=1     c=1    scripts/gate.sh
2026-08-13  wo-pipeline-ui                                 b5e1b6c7  f=10    u=10    c=7    apps/frontend-shell/src/App.tsx
2026-08-13  wo-flowtime                                    5ed6724c  f=28    u=25    c=22   apps/agentcore/src/event-subscriptions.ts
2026-08-11  wo-solver-scope-fe                             7b52d4f2  f=7     u=7     c=6    apps/frontend-shell/src/components/ScopeHonestyBadge.module.css
2026-08-11  wo-sim-checkpoints                             32f817d8  f=3     u=3     c=2    apps/datacore/src/app.ts
2026-08-11  wo-scope-honesty-fe                            0ae2df51  f=7     u=7     c=5    apps/frontend-shell/src/locales/zh.ts
2026-08-11  wo-sandbox-prop-direction                      4aabd4bc  f=4     u=4     c=3    apps/datacore/test/mock-linktype-direction.gate.test.ts
2026-08-11  wo-sandbox-candidates-fe                       d6d4d550  f=7     u=7     c=5    apps/frontend-shell/src/locales/zh.ts
2026-08-11  wo-prd-grounding-gate                          9ecd52ea  f=6     u=5     c=3    scripts/check-prd-data-grounding.mjs
2026-08-11  wo-ot-instance-reach                           7bf51807  f=3     u=2     c=2    apps/frontend-shell/src/pages/admin/ObjectTypesBrowserPage.module.css
2026-08-11  wo-order-row-detail                            e9f810f9  f=5     u=5     c=4    apps/frontend-shell/src/locales/zh.ts
2026-08-11  wo-metrics-authz                               51d05f9d  f=14    u=9     c=4    apps/datacore/src/app.ts
2026-08-11  wo-hover-layer                                 0691a55a  f=19    u=17    c=6    apps/frontend-shell/src/components/QueryDock/Timeline.tsx
2026-08-11  wo-graph-desc-contract                         fd88703b  f=9     u=8     c=3    apps/datacore/src/synthetic/service.ts
2026-08-11  wo-gate-selftest                               2083bf9a  f=8     u=7     c=5    scripts/check-backend-frontend-seam.mjs
2026-08-11  wo-gate-rc2                                    7e586445  f=58    u=58    c=15   scripts/check-arg-drop-seam.mjs
2026-08-11  wo-disposition-inline-row                      115fe884  f=3     u=2     c=1    apps/frontend-shell/src/views/RiskBoardView.tsx
2026-08-11  wo-coverage-blind                              fe93efbb  f=5     u=5     c=3    scripts/check-coverage-blind.mjs
2026-08-11  wo-befe-seam-field                             763c0d1b  f=7     u=6     c=4    scripts/check-backend-frontend-seam.mjs
2026-08-11  wo-agentpath-hint-truth                        8a4dfffc  f=3     u=3     c=1    apps/frontend-shell/src/pages/admin/AgentsPage.tsx
2026-08-10  wo-waiting-states-fe                           091f6cdb  f=15    u=14    c=14   apps/datacore/src/app.ts
2026-08-10  wo-slice-ref-producer                          5ebc6cf2  f=12    u=12    c=4    apps/agentcore/src/catalog/service.ts
2026-08-10  wo-slice-discovery                             17e1e05f  f=11    u=11    c=4    apps/agentcore/src/dril/resource-projector.ts
2026-08-10  wo-process-instance                            24204b74  f=20    u=19    c=15   apps/datacore/src/app.ts
2026-08-10  wo-org-world                                   972e1418  f=16    u=13    c=10   apps/datacore/src/features.ts
2026-08-10  wo-leadtime-split                              ee6a5800  f=13    u=13    c=3    apps/datacore/src/solvers/service.ts
2026-08-10  wo-impact-propagation                          a259c746  f=7     u=5     c=4    apps/datacore/src/app.ts
2026-08-10  wo-fix-dark-launch-gate                        97ad5dc2  f=6     u=5     c=3    scripts/check-dark-launch-integrity.mjs
2026-08-10  wo-factor-scope-singlesource                   e3291898  f=13    u=11    c=7    apps/datacore/src/solvers/service.ts
2026-08-10  wo-enterprise-state                            aeb13d82  f=17    u=14    c=12   apps/datacore/src/app.ts
2026-08-10  wo-decision-graph                              c931742e  f=7     u=6     c=4    apps/datacore/src/decision/causal-graph.ts
2026-08-10  wo-cert-honesty                                ab69aa12  f=16    u=15    c=8    apps/datacore/src/app.ts
2026-08-10  wo-approval-policy                             6c40efed  f=11    u=11    c=6    apps/datacore/src/app.ts
2026-08-10  wo-agentrun-fanout-persist                     e7e978db  f=21    u=19    c=10   apps/agentcore/src/agent/loop.ts
2026-08-10  wo-agentrun-attribution                        c0b70d42  f=18    u=18    c=14   apps/agentcore/src/agent/loop.ts
2026-08-10  wo-adopt-decision-play                         eefaabfc  f=8     u=8     c=3    apps/datacore/src/actions.ts
2026-08-10  onto-writeback-p1                              e17385d0  f=5     u=5     c=2    scripts/check-dark-launch-integrity.mjs
2026-08-09  wo-delta-compare                               44309588  f=2     u=2     c=1    packages/contracts/src/index.ts
2026-08-09  fix-imp2plan-seam                              528d3a85  f=23    u=21    c=17   apps/agentcore/src/event-subscriptions.ts
2026-08-08  wo-zombie-audit                                f7be27e7  f=42    u=31    c=21   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  wo-transit-wire                                c5a1fe41  f=45    u=33    c=23   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  wo-stale-claims                                aebd4ccf  f=12    u=11    c=9    apps/frontend-shell/src/views/sim/SandboxConsole.tsx
2026-08-08  wo-sim-scope-local                             a0d3c368  f=52    u=38    c=25   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  wo-semantics-singlesource                      f64a12ee  f=44    u=33    c=23   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  wo-sandbox-s3                                  a44c6002  f=6     u=6     c=6    apps/datacore/src/solvers/chain-impediment.ts
2026-08-08  wo-sandbox-a2                                  05588622  f=7     u=5     c=3    apps/datacore/test/chain-scan-honesty.test.ts
2026-08-08  wo-sandbox-a10                                 f4fb2abc  f=8     u=8     c=3    apps/agentcore/src/event-subscriptions.ts
2026-08-08  wo-route-nav                                   2dbef251  f=47    u=34    c=24   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  wo-opt-whatif-data                             010627a9  f=44    u=33    c=23   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  wo-opt-whatif-close                            28a54d47  f=10    u=7     c=3    apps/datacore/src/synthetic/battery.ts
2026-08-08  wo-nav-gate                                    457ac9d7  f=41    u=31    c=21   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  wo-levers-rootcause                            f6e89e7f  f=35    u=25    c=16   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  wo-lever-binding                               02e1e55e  f=45    u=35    c=24   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  wo-imp2plan                                    d042531a  f=5     u=5     c=5    apps/frontend-shell/src/views/DecisionPlayView.tsx
2026-08-08  wo-hardcoded-absence                           8c9b2264  f=43    u=32    c=23   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  wo-demo-lightup-2                              2ce20275  f=41    u=27    c=16   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  wo-console-cleanup                             b95b8f41  f=37    u=27    c=18   apps/datacore/src/solvers/chain-loss.ts
2026-08-08  sandbox-field-inventory                        db976009  f=24    u=21    c=17   apps/agentcore/src/event-subscriptions.ts
2026-08-08  sandbox-a6-audit                               bcce7269  f=24    u=21    c=17   apps/agentcore/src/event-subscriptions.ts
2026-08-08  sandbox-a10-audit                              317f37e8  f=24    u=21    c=17   apps/agentcore/src/event-subscriptions.ts
2026-08-07  wo-topo-realdata                               26dc7f98  f=7     u=3     c=3    apps/frontend-shell/src/views/sim/PhysicalTopologyView.module.css
2026-08-07  wo-sandbox-g1                                  712e93f2  f=9     u=8     c=2    apps/datacore/test/g1-probe.test.ts
2026-08-07  wo-sandbox-console                             2dc26bc5  f=26    u=25    c=18   apps/frontend-shell/src/mocks/simSolvers.ts
2026-08-07  wo-s08-kit-fe                                  387fff8f  f=9     u=4     c=4    apps/frontend-shell/src/components/Answer/AnswerBlocks.tsx
2026-08-07  wo-rules-dsl-family                            8a5e6e93  f=15    u=14    c=4    apps/datacore/src/synthetic/battery.ts
2026-08-07  wo-quote-margin-customer                       ad4407ee  f=16    u=16    c=10   apps/agentcore/src/mocks/seed.ts
2026-08-07  wo-node-semantics                              084abd86  f=7     u=5     c=5    apps/frontend-shell/src/views/sim/InspectorNodePanel.module.css
2026-08-07  wo-impediment-fe                               5f1db104  f=9     u=8     c=6    apps/frontend-shell/src/mocks/simSolvers.ts
2026-08-07  wo-gates-wire                                  63dec205  f=2     u=2     c=1    scripts/gate-ledger.json
2026-08-07  wo-flaky-timer                                 63f13f0f  f=6     u=6     c=2    apps/frontend-shell/test/inspector-node-panel.seam.test.tsx
2026-08-07  wo-decision-info-oncanonical                   54e299cc  f=8     u=8     c=7    apps/frontend-shell/src/mocks/handlers.ts
2026-08-07  wo-decision-info-frontend2                     8e77af09  f=8     u=8     c=3    apps/frontend-shell/src/mocks/simSolvers.ts
2026-08-07  wo-decision-info-fe                            19e9db0d  f=8     u=8     c=7    apps/frontend-shell/src/mocks/handlers.ts
2026-08-07  wo-chainnode-gate-widen                        86e57347  f=1     u=1     c=1    apps/frontend-shell/src/views/sim/inspectorModel.ts
2026-08-07  wo-chain-24                                    dcefb5fd  f=13    u=11    c=4    apps/datacore/src/solvers/chain-loss.ts
2026-08-07  wo-argname-and-units                           09d6275f  f=15    u=15    c=7    apps/datacore/src/catalog.ts
2026-08-07  wo-82-peak-crossday                            01f8b799  f=6     u=6     c=2    apps/datacore/src/solvers/risk.ts
2026-08-07  wo-65-metrics                                  ef5e9fc8  f=12    u=12    c=6    apps/agentcore/src/server.ts
2026-08-06  wo-slice-governance-full                       96278d2e  f=9     u=8     c=7    apps/datacore/src/app.ts
2026-08-06  wo-slice-governance                            926f883f  f=2     u=2     c=1    apps/datacore/src/ontology-governance.ts
2026-08-06  wo-procurement-frontend                        5c95027e  f=6     u=6     c=4    apps/frontend-shell/src/views/sim/ProcurementLegsView.module.css
2026-08-06  wo-modeling-interactive                        92ac7ce5  f=6     u=6     c=4    apps/datacore/src/ontology.ts
2026-08-06  wo-live-endpoints                              cdbcb6aa  f=5     u=4     c=4    apps/agentcore/src/server.ts
2026-08-06  wo-gslive-live                                 2bcc34c1  f=1     u=1     c=1    packages/contracts/src/global-sim.ts
2026-08-06  wo-decision-info-frontend                      18f10d40  f=6     u=6     c=1    apps/frontend-shell/src/views/RiskBoardView.tsx
2026-08-06  wo-caplive-truechain                           b8fc5ddf  f=7     u=7     c=3    apps/datacore/src/solvers/capacity.ts
2026-08-06  fix-frontend-fabricate                         2a46626b  f=7     u=7     c=7    apps/frontend-shell/src/locales/zh.ts
2026-08-06  fix-datacore-fake                              93941a92  f=6     u=6     c=4    apps/datacore/src/solvers/extended.ts
2026-08-05  wo-sandbox-s0                                  b22f1323  f=3     u=3     c=3    packages/contracts/src/chain-sim.ts
2026-08-05  wo-sandbox-f3                                  6f4f7ba2  f=4     u=4     c=4    apps/frontend-shell/src/views/sim/PhysicalTopologyView.module.css
2026-08-05  wo-sandbox-e2                                  4ebca282  f=5     u=4     c=3    apps/datacore/src/solvers/risk.ts
2026-08-05  wo-sandbox-e1                                  32371d04  f=8     u=8     c=8    apps/datacore/src/catalog.ts
2026-08-05  wo-sandbox-d3                                  10b1cf57  f=7     u=5     c=3    apps/datacore/src/solvers/risk.ts
2026-08-05  wo-sandbox-d1                                  f353c088  f=2     u=2     c=2    apps/datacore/src/synthetic/cadence.ts
2026-08-05  wo-decision-info                               b06f582f  f=12    u=10    c=8    apps/datacore/src/solvers/base-outlook.ts
2026-08-04  wo-rule-expr-params                            573596b5  f=23    u=15    c=7    apps/datacore/src/app.ts
2026-08-04  wo-prov-drillfield                             3840dd44  f=2     u=2     c=2    apps/datacore/src/solvers/service.ts
2026-08-04  gate-ledger                                    a212e100  f=10    u=8     c=3    scripts/check-gate-ledger.mjs
2026-08-03  wo-d5d4-ux                                     225de68c  f=7     u=4     c=3    apps/frontend-shell/src/views/sim/GlobalSimLevers.tsx
2026-08-03  wo-d2d3-diag                                   b409a2ce  f=8     u=5     c=2    apps/datacore/src/solvers/service.ts
2026-08-03  wo-d1-cancel                                   a1b7066f  f=11    u=7     c=4    apps/agentcore/src/server.ts
2026-08-03  wo-82                                          c971b976  f=3     u=3     c=1    apps/datacore/src/solvers/risk.ts
2026-08-03  wo-80                                          a8df2830  f=4     u=4     c=2    scripts/check-ontology-anchors.mjs
2026-08-03  wo-79                                          6dd0b0c0  f=13    u=7     c=6    apps/frontend-shell/src/mocks/handlers.ts
2026-08-03  wo-76                                          c0a1bcda  f=5     u=5     c=2    apps/frontend-shell/src/mocks/fixtures.ts
2026-08-01  wo-resource-catalog-ontology                   146489b6  f=12    u=11    c=4    apps/agentcore/src/dril/resource-projector.ts
2026-07-31  wo-unitprice-scale                             68285bbc  f=5     u=4     c=3    apps/datacore/src/solvers/portfolio.ts
2026-07-31  wo-scenario-input-phase0                       13ab118b  f=25    u=20    c=7    apps/agentcore/src/engine.ts
2026-07-31  wo-capacity-100pct                             d52def35  f=9     u=7     c=6    apps/datacore/src/solvers/risk.ts
2026-07-31  wo-69-p3-interface                             4427af2a  f=33    u=29    c=18   apps/agentcore/src/dril/resource-projector.ts
2026-07-31  wo-69-p2-function-signature                    cea5f85d  f=20    u=16    c=12   apps/agentcore/src/dril/resource-projector.ts
2026-07-31  wo-69-ontology-primitives                      d0396227  f=10    u=8     c=5    apps/datacore/src/app.ts
2026-07-31  wo-66-rules-p1p2                               7b92660a  f=23    u=23    c=10   apps/datacore/src/repo/memory.ts
2026-07-31  wo-63-schema-readability                       333ab6f3  f=18    u=18    c=8    apps/agentcore/src/skill-lint.ts
2026-07-29  wo-live-disposition                            cc022645  f=14    u=12    c=10   apps/datacore/src/solvers/base-outlook.ts
2026-07-29  wo-aip-cap0                                    5e6c1368  f=69    u=58    c=41   apps/agentcore/src/agent/sim-planner.ts
2026-07-28  wo-seam-arg-drop                               8bf25c35  f=10    u=10    c=6    apps/agentcore/src/mocks/seed.ts
2026-07-28  wo-dialogue-q1q2                               2bc0df8e  f=8     u=7     c=5    apps/agentcore/src/mocks/seed.ts
2026-07-28  wo-cockpit-wiring                              33b7c818  f=5     u=4     c=2    apps/frontend-shell/src/mocks/handlers.ts
2026-07-28  wo-cap-demanddelta                             53f82bcb  f=12    u=11    c=8    apps/agentcore/src/mocks/clients.ts
2026-07-28  wo-base-id-fidelity                            36f7e6ab  f=10    u=8     c=7    apps/agentcore/src/agent/sim-planner.ts
2026-07-27  wo-warm-structural                             00a54a84  f=4     u=4     c=2    apps/frontend-shell/src/pages/ShellLayout.tsx
2026-07-27  wo-scene-concretize                            fa04a0e1  f=2     u=2     c=2    apps/agentcore/src/mocks/seed.ts
2026-07-27  wo-loop-control-p2p5                           4510a8b6  f=6     u=6     c=2    apps/agentcore/src/router/orchestrator.ts
2026-07-27  wo-loop-control-p2                             48524830  f=14    u=11    c=6    apps/agentcore/src/agent/loop.ts
2026-07-27  wo-l2-decompose                                4d4617b3  f=7     u=6     c=4    apps/agentcore/src/features/registry.ts
2026-07-27  wo-dialogue-theme                              a4c1f71e  f=6     u=6     c=6    apps/frontend-shell/src/views/OptimizeWhatifView.tsx
2026-07-27  seg-attr-scope                                 c94d3483  f=5     u=5     c=2    apps/datacore/src/solvers/service.ts
2026-07-27  optwhatif-nl-wiring                            d00ae58f  f=12    u=9     c=6    apps/agentcore/src/features/registry.ts
2026-07-26  wo-qos-cross-domain-unified-v2                 f7adf509  f=12    u=12    c=10   apps/agentcore/src/config.ts
2026-07-26  wo-qos-cross-domain-unified-graw0b             f0c7df24  f=16    u=14    c=11   apps/agentcore/src/features/registry.ts
2026-07-26  wo-qos-cross-domain-unified                    aff51b55  f=13    u=12    c=10   apps/agentcore/src/features/registry.ts
2026-07-26  wo-multiintent-l3                              63079591  f=21    u=17    c=14   apps/agentcore/src/features/registry.ts
2026-07-26  wo-multiintent-l2                              37003a41  f=18    u=16    c=13   apps/agentcore/src/features/registry.ts
2026-07-26  wo-multi-intent-p1                             f4fa91b6  f=12    u=12    c=8    apps/agentcore/migrations/010_multi_intent_plan.sql
2026-07-26  wo-loop-control-p1                             25058226  f=11    u=10    c=6    apps/agentcore/src/agent/loop.ts
2026-07-26  wo-det-cross-domain                            01583167  f=12    u=11    c=10   apps/agentcore/src/features/registry.ts
2026-07-26  wo-datacore-lazy-context                       f223f39d  f=4     u=3     c=2    apps/datacore/src/features.ts
2026-07-25  wo-w5-business-type                            82f8508e  f=12    u=10    c=9    apps/datacore/src/solvers/portfolio.ts
2026-07-25  wo-rules-classify                              cd2ca8bd  f=13    u=11    c=5    apps/datacore/src/synthetic/battery.ts
2026-07-25  wo-reflect-loop                                389586b4  f=4     u=2     c=2    apps/agentcore/src/agent/loop.ts
2026-07-25  wo-prompt-defaults-wiring                      9a410293  f=7     u=6     c=4    apps/agentcore/src/agent/prompts.ts
2026-07-25  wo-harness-prompt-graw0b                       81f960d2  f=4     u=4     c=3    apps/agentcore/src/agent/prompts.ts
2026-07-25  wo-harness-prompt                              d0135cec  f=3     u=3     c=3    apps/agentcore/src/agent/prompts.ts
2026-07-25  wo-gui4-multiobj-real                          330a6ecd  f=6     u=6     c=3    apps/frontend-shell/src/mocks/fixtures.ts
2026-07-25  wo-gray-node-autofill                          ca9d6ff0  f=13    u=6     c=3    apps/frontend-shell/src/locales/zh.ts
2026-07-25  wo-globalsim-suite                             6f89fd5b  f=18    u=15    c=11   apps/datacore/src/solvers/inproc-optimizer.ts
2026-07-25  wo-e2e-dialogue-acceptance                     a05e52d9  f=9     u=2     c=1    apps/agentcore/test/e2e-dialogue-acceptance.test.ts
2026-07-25  wo-dril-precision                              7b255aad  f=7     u=6     c=4    apps/agentcore/src/dril/resource-projector.ts
2026-07-25  wo-dril-p4                                     142d08dc  f=32    u=27    c=19   apps/agentcore/src/dril/resource-registry.ts
2026-07-25  wo-dril-p3                                     56ec110b  f=21    u=18    c=10   apps/agentcore/src/dril/resource-registry.ts
2026-07-25  wo-dril-p2                                     d7a9fde5  f=12    u=12    c=7    apps/agentcore/src/dril/resource-registry.ts
2026-07-25  wo-dril-p1                                     421018ee  f=16    u=15    c=9    apps/agentcore/src/dril/resource-projector.ts
2026-07-25  wo-context-compression                         59080600  f=3     u=3     c=2    apps/agentcore/src/router/orchestrator.ts
2026-07-25  wo-agent-runtime-s01                           01fd9fe7  f=8     u=6     c=4    apps/agentcore/src/agent/loop.ts
2026-07-25  wo-0-nl-wiring                                 b5e53261  f=3     u=3     c=1    apps/agentcore/src/router/orchestrator.ts
2026-07-25  w9-windowdays                                  c0226b41  f=3     u=3     c=1    apps/frontend-shell/src/views/sim/GlobalSimView.tsx
2026-07-24  wo-gsim-agent                                  6949be30  f=4     u=4     c=3    apps/agentcore/src/agent/sim-planner.ts
2026-07-24  wo-capacity-provenance                         f17f8701  f=8     u=7     c=3    apps/frontend-shell/src/views/BaseOutlookPanel.tsx
2026-07-24  surface-7dim                                   6b2379aa  f=8     u=7     c=4    apps/datacore/src/solvers/portfolio.ts
2026-07-24  ontology-context-a                             1309f2e0  f=6     u=5     c=3    apps/datacore/src/ontology-validate.ts
2026-07-24  memory-view-resilience                         82528b7f  f=10    u=8     c=5    apps/datacore/src/features.ts
2026-07-23  wo-slice-connectivity                          bd7968d6  f=6     u=4     c=1    scripts/check-slice-connectivity.mjs
2026-07-23  wo-qos-ontology-context                        12d71805  f=12    u=10    c=9    apps/agentcore/src/engine.ts
2026-07-23  wo-phase4-fallback                             04daa3ae  f=12    u=10    c=8    apps/agentcore/src/agent/loop.ts
2026-07-23  wo-phase3-b                                    6a0a43e8  f=16    u=13    c=9    apps/agentcore/src/mocks/clients.ts
2026-07-23  wo-phase2-c                                    7c07b9f3  f=12    u=9     c=8    apps/agentcore/src/features/registry.ts
2026-07-23  wo-gsim-solver                                 3e0654b7  f=8     u=7     c=5    apps/datacore/src/solvers/portfolio.ts
2026-07-23  wo-gsim-frontend                               1b0f847c  f=9     u=9     c=8    apps/frontend-shell/src/mocks/handlers.ts
2026-07-23  wo-gsim-data                                   130e3576  f=5     u=3     c=2    apps/datacore/src/synthetic/battery.ts
2026-07-23  wo-gsim-action                                 e7e8600b  f=7     u=6     c=5    apps/datacore/src/actions.ts
2026-07-23  ontology-context                               93913c2e  f=12    u=12    c=6    apps/agentcore/src/mocks/clients.ts
2026-07-22  wo-phase1-d-a                                  a0363f26  f=11    u=11    c=7    apps/agentcore/src/agent/navigation-slice.ts
2026-07-22  wo-memsim-optimizer                            4f3b051d  f=5     u=5     c=4    apps/datacore/src/app.ts
2026-07-22  wo-globalsim-drill-seam                        457f7eb0  f=6     u=6     c=6    apps/frontend-shell/src/views/sim/GlobalSimView.module.css
2026-07-21  role-fallback                                  f851d78e  f=4     u=4     c=3    apps/agentcore/src/llm/providers.ts
2026-07-21  qos-det-gate                                   e1c3b48c  f=5     u=4     c=3    apps/agentcore/src/router/domain-resolver.ts
2026-07-21  qos-agent-speed                                09a442d7  f=10    u=9     c=8    apps/agentcore/src/agent/loop.ts
2026-07-21  globalsim-glass                                eb615167  f=5     u=5     c=5    apps/frontend-shell/src/views/sim/GlobalSimView.module.css
2026-07-21  debattery-fix-2                                1935d749  f=1     u=1     c=1    apps/frontend-shell/src/views/sim/SandboxView.tsx
2026-07-21  cap-deepen                                     369e9d0a  f=14    u=14    c=13   apps/datacore/src/solvers/base-outlook.ts
2026-07-20  tier2-semantic-discover                        dc024133  f=10    u=8     c=5    apps/agentcore/src/mocks/seed.ts
2026-07-20  project-sim-whatif                             215bb681  f=9     u=8     c=6    apps/datacore/src/solvers/service.ts
2026-07-20  portfolio-optimal                              516a4a1b  f=18    u=18    c=13   apps/datacore/src/catalog.ts
2026-07-20  capacity-infer                                 127ef840  f=3     u=3     c=2    apps/datacore/src/solvers/service.ts
2026-07-20  base-outlook                                   fa67ea96  f=13    u=12    c=11   apps/datacore/src/catalog.ts
2026-07-19  tier3-cash-gm-attribution-v2                   dea0cfa0  f=9     u=9     c=5    apps/datacore/src/solvers/service.ts
2026-07-19  tier3-cash-gm-attribution                      765c0a6e  f=9     u=9     c=8    apps/datacore/src/solvers/service.ts
2026-07-19  tier3-agent-timeout-fallback-v2                7d7e2fc7  f=10    u=10    c=8    apps/agentcore/src/agent/loop.ts
2026-07-19  tier3-agent-timeout-fallback                   f376836f  f=10    u=10    c=9    apps/agentcore/src/agent/loop.ts
2026-07-19  tier2-semantic-discover-v2                     1ad50738  f=7     u=7     c=5    apps/agentcore/src/router/ceo-route.ts
2026-07-19  sop-reschedule                                 f572080b  f=14    u=11    c=10   apps/agentcore/src/router/ceo-route.ts
2026-07-19  resource-descriptor                            2d2bc735  f=9     u=7     c=5    apps/datacore/src/catalog.ts
2026-07-19  orderline-atpbase                              218797fe  f=18    u=13    c=12   apps/datacore/src/catalog.ts
2026-07-19  orderline                                      a3c0caf9  f=8     u=8     c=7    apps/datacore/src/synthetic/battery.ts
2026-07-19  optimize-whatif-fe                             453a0436  f=9     u=8     c=5    apps/frontend-shell/src/App.tsx
2026-07-19  mock-stubs                                     2e4b2bde  f=3     u=3     c=2    apps/frontend-shell/src/mocks/handlers.ts
2026-07-19  learning-loop                                  91a75ba7  f=6     u=4     c=3    apps/datacore/src/app.ts
2026-07-19  jobshop-schedule                               c393a707  f=7     u=7     c=3    apps/datacore/src/catalog.ts
2026-07-19  interbase-transfer                             c09759e6  f=8     u=7     c=5    apps/datacore/src/synthetic/battery.ts
2026-07-19  generic-whatif                                 630e3ec7  f=5     u=5     c=5    apps/frontend-shell/src/App.tsx
2026-07-19  exception-event                                73f7e25b  f=8     u=6     c=5    apps/datacore/src/synthetic/battery.ts
2026-07-19  disruption-radius                              531f5709  f=4     u=3     c=3    apps/frontend-shell/src/App.tsx
2026-07-19  debattery-fix                                  d21813db  f=2     u=1     c=1    apps/frontend-shell/src/views/RiskBoardView.tsx
2026-07-19  cross-object-multiobj                          e0341c3d  f=31    u=25    c=21   apps/datacore/src/catalog.ts
2026-07-19  cleanroom-attr                                 f39d6097  f=6     u=4     c=4    apps/frontend-shell/src/App.tsx
2026-07-18  warehouse-custloc                              1efff7f1  f=9     u=7     c=6    apps/datacore/src/synthetic/battery-extended.ts
2026-07-18  supply-demand-fe                               6fe412a9  f=2     u=2     c=2    apps/frontend-shell/src/views/DashboardView.tsx
2026-07-18  sandbox-action-propagation                     b8db35b5  f=13    u=13    c=8    apps/datacore/src/app.ts
2026-07-18  real-llm-free-query                            e6bff23e  f=12    u=12    c=7    apps/agentcore/src/features/registry.ts
2026-07-18  q7-reconciled                                  855e6708  f=3     u=3     c=1    apps/datacore/test/supply-demand-gap-attribution.test.ts
2026-07-18  provenance-hover                               e61986e2  f=2     u=1     c=1    apps/frontend-shell/src/components/ProvenanceDag.tsx
2026-07-18  plankpi-mq                                     9c171652  f=7     u=7     c=1    apps/datacore/test/demo-chain-provenance.test.ts
2026-07-18  metric-aware-seam                              b2c3a1e5  f=21    u=18    c=13   apps/datacore/src/app.ts
2026-07-18  inventory-3tier                                44ac0028  f=11    u=7     c=6    apps/datacore/src/synthetic/battery-extended.ts
2026-07-18  five-role-ai-employee                          c55b5c4f  f=24    u=22    c=15   apps/agentcore/src/engine.ts
2026-07-18  decision-play-fe                               34f62307  f=5     u=5     c=5    apps/frontend-shell/src/App.tsx
2026-07-18  decision-kernel-wire                           9bc19f43  f=8     u=7     c=6    apps/agentcore/src/mocks/clients.ts
2026-07-18  counterfactual-basesel                         96cd0757  f=3     u=3     c=2    apps/frontend-shell/src/mocks/handlers.ts
2026-07-18  ceo2v2                                         6837fa19  f=13    u=11    c=9    apps/datacore/src/app.ts
2026-07-18  causal-deepchain                               a14dea7e  f=5     u=5     c=2    apps/datacore/src/synthetic/battery-extended.ts
2026-07-18  capacity-infer-process                         746ffc79  f=4     u=3     c=2    apps/frontend-shell/src/components/ProvenanceDag.tsx
2026-07-18  capacity-daily                                 c1ad2141  f=2     u=2     c=1    apps/datacore/src/synthetic/battery.ts
2026-07-18  block-dialogue                                 9153cd95  f=11    u=8     c=4    apps/agentcore/src/router/orchestrator.ts
2026-07-18  atp-promise                                    0bd885fb  f=16    u=11    c=10   apps/datacore/src/catalog.ts
2026-07-17  unit-normalize                                 e96c9825  f=7     u=7     c=2    apps/frontend-shell/src/views/RiskBoardView.tsx
2026-07-17  qos-wip                                        61137dd2  f=30    u=27    c=16   apps/agentcore/src/catalog/service.ts
2026-07-17  qos                                            61137dd2  f=30    u=27    c=16   apps/agentcore/src/catalog/service.ts
2026-07-17  metric-aware-gap                               ce726e51  f=4     u=4     c=2    apps/datacore/src/solvers/service.ts
2026-07-17  cockpit-infer                                  24644f64  f=5     u=5     c=4    apps/frontend-shell/src/components/ProvenanceDag.tsx
2026-07-17  ceo6                                           873eebc1  f=4     u=4     c=1    apps/agentcore/src/router/orchestrator.ts
2026-07-17  ceo3                                           3497f24d  f=11    u=10    c=8    apps/datacore/src/catalog.ts
2026-07-17  ceo2                                           56525000  f=9     u=9     c=7    apps/datacore/src/catalog.ts
2026-07-17  ceo-q7                                         8e4719fc  f=6     u=6     c=5    apps/datacore/src/catalog.ts
2026-07-17  ceo-data-2                                     c068306f  f=17    u=14    c=11   apps/datacore/src/app.ts
2026-07-17  ceo-data                                       9996c849  f=9     u=8     c=6    apps/datacore/src/app.ts
2026-07-17  capacity-timeline                              3eaa87df  f=3     u=2     c=1    apps/frontend-shell/src/views/RiskBoardView.tsx
2026-07-17  c1                                             f8f19b48  f=11    u=10    c=6    apps/datacore/src/app.ts
2026-07-17  a3-refbase-wip                                 6fd5189e  f=5     u=3     c=2    apps/datacore/src/app.ts
2026-07-17  a3-refbase                                     6fd5189e  f=5     u=3     c=2    apps/datacore/src/app.ts
2026-07-17  a3-fix                                         70bb7252  f=29    u=27    c=16   apps/agentcore/src/catalog/service.ts
```

