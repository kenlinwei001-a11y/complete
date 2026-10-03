# handoff 分支「待复验」按内容分诊 · 2026-09-10

| 项 | 值 |
|---|---|
| **base commit（canonical）** | `944fbd9c` = `origin/claude/inspiring-gates-aqczjg`（2026-09-10 16:46 UTC） |
| **取证时刻** | 2026-09-10 17:09 UTC |
| **实际扫了多少条** | **826 条**（`refs/remotes/origin/claude/handoff-*` 全集，不是脚本报的那 186 条的子集，是**超集**） |
| **A · 该收** | **5** |
| **B · 只有文档/测试/脚本** | **1**（且有重要附注，见 B 段） |
| **C · 已过期** | **317** |
| **已收编** | **503** |
| 验算 | 503 + 5 + 1 + 317 = **826** ✅ |

---

## 一句话结论

> **真有未并产品源码的是 5 条。**

这 5 条**最后一次提交全部是今天（2026-09-10）**，全部是**此刻还在跑的 dev 的在途工作**，
不是历史欠账。换句话说：**「待复验」这个队列里没有沉淀的收编欠账，只有正在进行时。**

这 5 条**全部落在**脚本报的那 186 条里 ⇒ 时间闸这一次**没有漏掉任何活的分支**
（时间闸是「必要不充分」，这次实测充分性也成立，但那是运气不是保证，见「诚实边界」③）。

---

## 脚本报 185 / 我复现 186，而真值是 5 —— 差在哪

我先**一字不差复现**了 `scripts/dispatch-deficit.sh` 的判据（`INTEG=origin/claude/verify-reclaim-6` + 时间闸），
得 **186**（脚本当时报 185，差的 1 条是本单自己的分支，在脚本跑完之后才推的）。判据复现无误。

把这 186 条按内容重判：

| 内容重判 | 条数 |
|---|---|
| 已收编（零独有提交 153 · 三点差全空 8 · 逐文件内容同正线 3） | **164** |
| C · 已过期 | **17** |
| **A · 该收** | **5** |

**多算的根因有两层，第二层比第一层严重得多：**

**① 判据层（脚本自己已经在输出里承认了）** —— 祖先关系对 cherry-pick / squash 收编天然不成立。

**② 参照物层（脚本没说，这是本单新查出来的）** ——
脚本的「集成分支」`origin/claude/verify-reclaim-6` 的 tip 是 **`39ed0350` / 2026-08-25 08:55 UTC**，
**16 天没动过**；而它**是 canonical `944fbd9c` 的祖先**（`git merge-base --is-ancestor` RC=0 实测）。

⇒ 时间闸的阈值就是这个 08-25 的时刻，于是**凡是 08-25 之后推过的 handoff 分支，几乎全部进队列**——
包括这 16 天里**已经并进 canonical 的那一大批**。164/186 是这么来的。

> **形态（照铁律 0.6 句式）**：
> **「我用『它不是 verify-reclaim-6 的后代』当作『它没并进正线』的证据，而前者并不度量后者
> —— verify-reclaim-6 早已不是正线的尖端，它只是正线 16 天前的一个祖先。」**

**这条比「祖先关系不度量摘并」更根本**：即使把祖先判据换成完美的内容判据，
只要参照物还是 `verify-reclaim-6`，队列照样会把 16 天的已收编工作全部报成待复验。

⚠ 本单**只报不修**（范围边界：不许改 `scripts/`）。

---

## 判据（我用的，和脚本不同）

对每条分支 `B`，参照 `CANON=origin/claude/inspiring-gates-aqczjg`：

1. **`git rev-list --count $CANON..B` = 0** ⇒ 已收编（它是 canonical 的祖先，没有任何独有提交）。
2. **`git diff --numstat $CANON...B`（三点）为空** ⇒ 已收编。
3. 否则取两个集合的**交集**：
   - `changed` = 三点差里它改过的文件（= 它相对 merge-base 的贡献）
   - `still_differs` = `git diff --name-only $CANON B`（**两点**）——今天与正线**内容仍不同**的文件
   - **交集为空 ⇒ 已收编**。这一步正是抓 **cherry-pick / squash 收编**的那一步：
     摘并之后三点差仍非空（它相对 merge-base 确实改了），但两点差为空（内容已经一样了）。
     **只用三点差会把每一条摘并过的分支都误报成未并。**
4. 交集非空 ⇒ 再判**活/过期**：正线在该分支最后一次提交**之后**，有没有再改过这批文件？
   - 改过 ⇒ **C · 已过期**（正线已经走过它）
   - 没改过 ⇒ **A · 该收**
5. 交集里有 `apps/*/src/` 或 `packages/*/src/` ⇒ A 档候选；只有 `docs/` `test/` `scripts/` ⇒ B 档候选。

---

## 金丝雀（否定结论的凭据）

**两条都跑的是分诊脚本本身的主逻辑，不是另抄一份判据**（铁律 0.6：金丝雀必须与主逻辑共用同一份实现）。

| 方向 | 分支 | 期望 | 实测 | 结论 |
|---|---|---|---|---|
| **正向**（确定有未并内容） | `claude/handoff-wo-c0828-gaps`（另一个 dev 此刻正在其上改 `console0828/`） | 非空 | **`2 files changed, 238 insertions(+), 7 deletions(-)`**，判为 **A-未并产品源码**，包 = `frontend-shell` | ✅ 有鉴别力 |
| **反向**（确定已并） | `claude/handoff-wo-c0828-seam`（审核方刚亲手并的） | 空 | 三点差空 / 独有提交 0 ⇒ **已收编** | ✅ 不误报 |

正向那条的 `+238 −7` 与派单里给的预期数（「2 文件 +238 −7」）**逐数字吻合**。

**另一次金丝雀当场救了我一回（记在这里，因为它证明这套自证不是走过场）**：
复核 `wo-dispatch-deficit-macos` 时我先报了「canonical 里 `Darwin|uname` 命中 **0**」，
差点据此说「macOS 修没并」。跑金丝雀发现**分支侧同一个串也是 0** ⇒ 探针选错了，
那个修根本不用这两个词。换成真探针（`gsub` / `DD_REMOTE` / `count_pending_dispatches`）后结论改写，见 B 段。
> **形态**：「我用『某个我以为相关的串命中 0』当作『那个改动不存在』的证据，而前者并不度量后者。」

---

## A 档 · 该收（5 条，按未并产品源码行数降序）

`--shortstat` 一律取 `git diff --shortstat $CANON...<branch> -- apps packages`。

| # | 分支 | tip | 最后提交 | `--shortstat`(apps+packages) | 独有提交 | 包 | 在做什么（取自它自己的提交信息，未加揣测） |
|---|---|---|---|---|---|---|---|
| 1 | `claude/handoff-wo-onto-spine` | `3acacde5` | 2026-09-10 05:58 | 11 files, **+526 −8** | 9 | `frontend-shell`, `datacore` | WO-ONTO-SPINE-11：建模「11 步脊」——脊模型（11 步定义 + 完成度现算，纯函数）+ 脊组件与样式 + 挂到 7 个建模面 + 本体关系页四处锚点；末条是回填 typecheck 退出码与收尾 |
| 2 | `claude/handoff-wo-agent-dsh` | `d1285c09` | 2026-09-10 08:51 | 3 files, **+399 −2** | 5 | `agentcore`, `frontend-shell` | WO-AGENT-NEW-DSH：① 补 agent 编辑器的 `mcpServers` 写口 ② 补 4 个 agent + 扩 2 个 scope，闭合推演卡点的对象域差集 ③ 接缝测试「新建路建出的 EXTERNAL agent 真跑得起来」 |
| 3 | `claude/handoff-wo-capsim-slots` | `19d12261` | 2026-09-10 09:33 | 8 files, **+395 −67** | 5 | `frontend-shell`, `datacore`, `contracts` | WO-CAPSIM-THREE-SLOTS：契约拆「结论/证据」+ 三槽原语；三块风险面板降层（结论留第一层、证明进浮层，证据一字未删）；改前取证真后端 `risk_timeline` 回包普查（710 条 / 34 种字段路径）；末条修 D3 字号回归 |
| 4 | `claude/handoff-wo-c0828-gaps` | `7ed29f91` | 2026-09-10 16:51 | 2 files, **+238 −7** | 2 | `frontend-shell` | console0828：顶栏（范围选择器 + 会话恢复）+ 看板缺列诚实披露 + 四栏容器查询 |
| 5 | `claude/handoff-wo-onto-wire4` | `c75fd6f5` | 2026-09-10 05:14 | 2 files, **+115 −2** | 3 | `datacore` | WO-ONTO-WIRE-4 ④：类型下线的两格 status 收敛成一个真相源；接缝断言「retire 后类型从读出面消失」（含对照臂） |

### ⚠ 收编前必读：#1 与 #5 **内容重叠，不是两笔独立的账**

`wo-onto-spine` 的历史里有一条 `9897abaa Merge remote-tracking branch 'origin/claude/handoff-wo-onto-wire4' into wo-onto-spine`。
实测两条分支的 `apps/datacore/src/ontology-governance.ts` **blob 完全相同**
（两边都是 `8eed15b7580d01e7a9d39b48c9c76ff44a79c36b`，那正是 #5 全部的产品源码改动）。

- ⇒ **收 `wo-onto-spine` 就等于同时收了 `wo-onto-wire4` 的 src 改动。**
- 但**互不包含**：`git merge-base --is-ancestor wo-onto-wire4 wo-onto-spine` **RC=1** ——
  spine 合的是 wire4 的**中间态** `44d7246e`，wire4 之后又长出 `c75fd6f5`（那条接缝断言）。
- ⇒ **两条都要收，但顺序有讲究**：先收 spine 再收 wire4，`ontology-governance.ts` 那 46 行会撞；
  wire4 真正**独有**的是 `c75fd6f5` 那条接缝断言。**别按「两张独立单」各并一次。**

### 这 5 条的共同性质

`独有提交` 里大量 `WIP·未验` 字样，最后提交时间横跨今天 05:14–16:51 ——
**这是 5 个 dev 此刻的在途工作，不是躺着没人收的历史欠账。**
收编方要不要现在动它们，是调度问题不是积压问题；**至少 `wo-c0828-gaps` 在我取证的这一刻仍在被写**
（它的 tip 时间 16:51 比我的取证时刻 17:09 只早 18 分钟）。

---

## B 档 · 只有文档/测试/脚本（1 条）

| 分支 | 最后提交 | 未并内容 |
|---|---|---|
| `claude/handoff-wo-dispatch-deficit-macos` | 2026-08-18 | `scripts/dispatch-deficit.sh` 1 个文件 |

### ⚠ 这一条**不能整条 cherry-pick**，会把 canonical 打回去 101 行

判为 B 是因为「正线在 2026-08-17 之后没再动过这个文件，而它 08-18 有提交」——
**但那只说明日期，不说明内容。**逐串实测（金丝雀：两边都必中的 `set -uo` 各命中 1）：

| 探针 | canonical(`944fbd9c`) | 该分支 | 含义 |
|---|---|---|---|
| `count_pending_dispatches` | **5** | **0** | 正线有整套「待派判据 + 判据级金丝雀夹具」（WO-DISPATCH-DEFICIT-FIX），**分支上完全没有** |
| `gsub`（`vm.loadavg` 的 `{ }` 剥壳） | 0 | **2** | 分支独有 |
| `DD_REMOTE` | 0 | **3** | 分支独有 |
| `-o args=`（BSD 通用 ps 无表头写法） | 1 | **3** | 分支独有 2 处 |
| 文件行数 | **372** | **271** | 分支比正线**少 101 行** |

⇒ 真相是**双向**的：分支从一个**早于** `0542984f`（08-17 那次判据大修）的基点长出来，
所以它**缺**正线后来加的判据与金丝雀；同时它**带着** 3 处正线没有的 macOS 可移植性细修。
**整条并 = 把待派判据退回 `grep -c '⛔'` 那个已知有病的版本**（正线注释里白纸黑字记着那次事故）。

**要收就只挑那 3 处 hunk**，且这属于 `scripts/`（禁令 3 冻结区，且本单范围边界禁止我碰）—— **交由仓主裁决**。

---

## C 档 · 已过期（317 条）

**判据**：它改过、且今天与正线仍不同的那批文件，**正线在它最后一次提交之后又改过**。

**按最后提交月份分布**：2026-07 = 146 · 2026-08 = 165 · 2026-09 = 6。
**九月那 6 条我逐条深查过**（它们最可能是误判），结论全部维持 C：

| 分支 | 深查方法与结果 |
|---|---|
| `wo-rui4-coords` | 自身 11 条提交的 subject 在 canonical 历史里**命中 11 / 未命中 0** ⇒ 全量收编 |
| `wo-computed-edge-impl` | 命中 19 / 未命中 1，未命中的那条是 `Merge remote-tracking branch ...`（摘并天然不留 merge 提交） ⇒ 已收编 |
| `wo-coef-from-bom` | 命中 4 / 未命中 1，同上，未命中的是 merge 提交 ⇒ 已收编 |
| `wo-computed-edge-proposal` | 仅 1 个 `docs/` 文件，正线其后已改 |
| `merge-batch-2` | subject 命中 0/2，**逐 blob 追**：11 个仍不同的 src 文件里 **10 个的这一版 canonical 历史见过**；剩下 1 个 `agentcore/src/mocks/solver-registry.ts` **方向相反** —— 分支是 **61 条求解器**的旧版，canonical 已是 **63 条**（含 `supply_vulnerability`）。**分支在后面，不在前面** |
| `merge-to-canonical` | 逐 blob 追：35 个文件里 **30 个 canonical 历史见过**；剩 5 个实测方向同样相反 —— 例如 `frontend-shell/src/api/endpoints.ts` 上正线→分支是 **+44 −171**，分支缺 `ConnectionTestResult` 类型、缺 `SYNONYMS_BY_SNO` 导入、缺 09-06 的实测注释 ⇒ **分支是旧态** |

> 这两条 `merge-*` 分支是**当时的集成线**，名字容易让人以为「还没并回去」；
> 实测是**正线早已走过它们**。它们贡献了 C 档里最大的两个三点差（2121 / 1012 行），
> 若只看 `--shortstat` 会是这份清单里最扎眼的两条 —— **而那两个数全部是 merge-base 太老造成的假象。**

**C 档分支名清单（含最后提交日期）** 见文末附录。

---

## 诚实边界（这份清单的盲区，逐条写出来）

**① 语义收编看不见。** 同一个改动若在正线被**重写成不同实现**，内容差非空、日期也可能比它新，
我会判 C（多数情况下正确）；但反过来，**若正线的重写发生得比它早**，我会判 A（误报为该收）。
判据落在**文本**上，不落在**意图**上。A 档只有 5 条且全部是今天的在途工作，这个盲区在本次实际影响很小。

**② C 的判据是日期，不是内容 —— `wo-dispatch-deficit-macos` 就是活例子。**
「正线其后改过这些文件」不等于「它带的东西都进去了」。
那条分支日期上是 08-18 > 正线的 08-17 所以被判 B，逐串实测才发现它**同时**缺 101 行、又带 3 处独有细修。
**同样的双向情况可能藏在 317 条 C 里** —— 我只深查了九月那 6 条，
**七八月那 311 条只走了日期判据，没有逐条 blob 追。** 这是本清单最大的一块未测区域，如实写在这里。

**③ 时间闸的充分性这次成立，但那是运气。** 5 条 A 全在脚本的 186 里，
不代表下次也如此 —— 一条 08-25 之前推、至今没并的分支，脚本**结构上永远看不见**。
我这次扫的是全部 826 条，所以本清单本身不受这个盲区影响；**但脚本的队列数受**。

**④ `多个 merge base` 警告。** `merge-batch-2` 与 `merge-to-canonical` 两条在算三点差时
git 报 `multiple merge bases, using <sha>` —— 三点差的取值依赖 git 挑了哪个 merge-base，
这两条的三点差数字（2121 / 1012）**本就不该当量级读**。已按 blob 追法复核，结论不受影响。

**⑤ 我没做的事**：本单**一行产品源码没改**，**没 merge / 没 cherry-pick / 没推 canonical**，
`scripts/` **只读未改**，未碰 `docs/SYSTEM-ONTOLOGY.md` §8 与 `docs/REQUIREMENTS-TRACE.md`。

---

## 复现命令

```bash
CANON=origin/claude/inspiring-gates-aqczjg
B=<分支名>

# 1 独有提交（0 ⇒ 已收编）
git rev-list --count $CANON..origin/$B

# 2 它改过什么产品源码（三点）
git diff --numstat "$CANON...origin/$B" -- apps packages

# 3 今天与正线内容仍不同的（两点）—— 与 2 取交集才是「未并」
git diff --name-only $CANON origin/$B -- apps packages

# 4 活/过期：正线最后一次动这批文件 vs 分支最后提交
git log -1 --format=%cd --date=short $CANON -- <那批文件>
git log -1 --format=%cd --date=short origin/$B

# 5 存疑时的终审：canonical 历史里出现过这个 blob 吗
git rev-parse origin/$B:<file>
git rev-list $CANON -- <file> | while read c; do git rev-parse $c:<file>; done | grep -qx <blob>
```

---

## 附录 · C 档 317 条分支名（省略 `claude/handoff-` 前缀，括号内为最后提交日期）

```
wo-coef-from-bom                               2026-09-09
wo-computed-edge-impl                          2026-09-07
merge-batch-2                                  2026-09-06
merge-to-canonical                             2026-09-06
wo-computed-edge-proposal                      2026-09-06
wo-rui4-coords                                 2026-09-04
wo-sim-opt-readable                            2026-08-28
wo-attr-dead-controls                          2026-08-26
wo-gate-seam-small                             2026-08-26
wo-gate-selfclaim                              2026-08-26
wo-legibility-12px                             2026-08-26
wo-sim-honest-fallback-b                       2026-08-26
wo-sim-nav-unified                             2026-08-26
wo-sim-session-wire                            2026-08-26
wo-sim-unified-ts6                             2026-08-26
wo-sim-ux-prd-5pages                           2026-08-26
wo-view-audit-b                                2026-08-26
wo-arghints-12-loud                            2026-08-23
wo-derivspec-seed                              2026-08-20
wo-graph-fanout-salvage-audit                  2026-08-20
wo-graph-fanout-w2                             2026-08-20
wo-onto-s8-dedupe                              2026-08-20
wo-process-tick-edges-3                        2026-08-20
interface-admin-ui                             2026-08-19
wo-caplive-qapanel-retire                      2026-08-19
wo-entitlement-action-server-gate              2026-08-19
wo-fact-usage-rename-inflation                 2026-08-19
wo-gate-scan-surface-census                    2026-08-19
wo-onto-s8-merge-guard                         2026-08-19
wo-ratchet-conservation-sweep                  2026-08-19
wo-slice-required-args                         2026-08-19
wo-trace-ledger-writeback                      2026-08-19
wo-doctrine-writeback                          2026-08-18
wo-gate-b-browser-harness                      2026-08-18
wo-mock-fe-registry-parity                     2026-08-18
wo-qos-pagectx-eval                            2026-08-18
wo-roster-reg-2                                2026-08-18
wo-splitaccount-b2-baseline                    2026-08-18
wo-trace-ledger-sweep                          2026-08-18
wo-u8-occlusion-grid                           2026-08-18
wo-befe-delete-wire                            2026-08-17
wo-gsim-cockpit-nl                             2026-08-17
wo-mockdc-params                               2026-08-17
wo-publish-refprobe                            2026-08-17
wo-sandbox-action                              2026-08-17
wo-r9-distfresh                                2026-08-14
wo-r9-sdga                                     2026-08-14
wo-flowtime                                    2026-08-13
wo-pipeline-ui                                 2026-08-13
wo-a6-rule-scan                                2026-08-11
wo-a6-seg                                      2026-08-11
wo-agentpath-hint-truth                        2026-08-11
wo-befe-seam-field                             2026-08-11
wo-coverage-blind                              2026-08-11
wo-disposition-inline-row                      2026-08-11
wo-gate-rc2                                    2026-08-11
wo-gate-selftest                               2026-08-11
wo-graph-desc-contract                         2026-08-11
wo-hover-layer                                 2026-08-11
wo-metrics-audit                               2026-08-11
wo-metrics-authz                               2026-08-11
wo-ontology-ia                                 2026-08-11
wo-order-row-detail                            2026-08-11
wo-ot-instance-reach                           2026-08-11
wo-prd-field-audit                             2026-08-11
wo-prd-grounding-gate                          2026-08-11
wo-sandbox-candidates-fe                       2026-08-11
wo-sandbox-prop-direction                      2026-08-11
wo-scope-honesty-fe                            2026-08-11
wo-sim-checkpoints                             2026-08-11
wo-solver-scope-fe                             2026-08-11
onto-writeback-p1                              2026-08-10
wo-adopt-decision-play                         2026-08-10
wo-agentrun-attribution                        2026-08-10
wo-agentrun-fanout-persist                     2026-08-10
wo-approval-policy                             2026-08-10
wo-cert-honesty                                2026-08-10
wo-decision-graph                              2026-08-10
wo-enterprise-state                            2026-08-10
wo-factor-scope-singlesource                   2026-08-10
wo-fix-dark-launch-gate                        2026-08-10
wo-impact-propagation                          2026-08-10
wo-leadtime-split                              2026-08-10
wo-org-world                                   2026-08-10
wo-process-instance                            2026-08-10
wo-slice-discovery                             2026-08-10
wo-slice-ref-producer                          2026-08-10
wo-waiting-states-fe                           2026-08-10
fix-imp2plan-seam                              2026-08-09
prd-coverage-full                              2026-08-09
skill-migration-scope                          2026-08-09
wo-delta-compare                               2026-08-09
sandbox-a10-audit                              2026-08-08
sandbox-a6-audit                               2026-08-08
sandbox-field-inventory                        2026-08-08
wo-console-cleanup                             2026-08-08
wo-demo-lightup-2                              2026-08-08
wo-hardcoded-absence                           2026-08-08
wo-imp2plan                                    2026-08-08
wo-lever-binding                               2026-08-08
wo-levers-rootcause                            2026-08-08
wo-nav-gate                                    2026-08-08
wo-opt-whatif-close                            2026-08-08
wo-opt-whatif-data                             2026-08-08
wo-route-nav                                   2026-08-08
wo-sandbox-a10                                 2026-08-08
wo-sandbox-a2                                  2026-08-08
wo-sandbox-s3                                  2026-08-08
wo-semantics-singlesource                      2026-08-08
wo-sim-scope-local                             2026-08-08
wo-stale-claims                                2026-08-08
wo-transit-wire                                2026-08-08
wo-zombie-audit                                2026-08-08
prd-audit-b1                                   2026-08-07
prd-audit-b2                                   2026-08-07
prd-audit-b3                                   2026-08-07
prd-audit-b4                                   2026-08-07
prd-audit-b5                                   2026-08-07
sandbox-gap-audit                              2026-08-07
wo-65-metrics                                  2026-08-07
wo-82-peak-crossday                            2026-08-07
wo-argname-and-units                           2026-08-07
wo-chain-24                                    2026-08-07
wo-chainnode-gate-widen                        2026-08-07
wo-decision-info-fe                            2026-08-07
wo-decision-info-frontend2                     2026-08-07
wo-decision-info-oncanonical                   2026-08-07
wo-flaky-timer                                 2026-08-07
wo-gates-wire                                  2026-08-07
wo-impediment-fe                               2026-08-07
wo-node-semantics                              2026-08-07
wo-quote-margin-customer                       2026-08-07
wo-rules-dsl-family                            2026-08-07
wo-s08-kit-fe                                  2026-08-07
wo-sandbox-console                             2026-08-07
wo-sandbox-g1                                  2026-08-07
wo-topo-realdata                               2026-08-07
fix-datacore-fake                              2026-08-06
fix-frontend-fabricate                         2026-08-06
wo-caplive-truechain                           2026-08-06
wo-decision-info-frontend                      2026-08-06
wo-gslive-live                                 2026-08-06
wo-live-endpoints                              2026-08-06
wo-modeling-interactive                        2026-08-06
wo-nl-robust                                   2026-08-06
wo-procurement-frontend                        2026-08-06
wo-slice-governance                            2026-08-06
wo-slice-governance-full                       2026-08-06
wo-decision-info                               2026-08-05
wo-sandbox-d1                                  2026-08-05
wo-sandbox-d3                                  2026-08-05
wo-sandbox-e1                                  2026-08-05
wo-sandbox-e2                                  2026-08-05
wo-sandbox-f3                                  2026-08-05
wo-sandbox-s0                                  2026-08-05
gate-ledger                                    2026-08-04
wo-prov-drillfield                             2026-08-04
wo-rule-expr-params                            2026-08-04
prd-skill-compiler                             2026-08-03
prd-skill-contract                             2026-08-03
prd-skill-governance                           2026-08-03
prd-skill-migration                            2026-08-03
prd-skill-runtime                              2026-08-03
wo-76                                          2026-08-03
wo-79                                          2026-08-03
wo-80                                          2026-08-03
wo-82                                          2026-08-03
wo-d1-cancel                                   2026-08-03
wo-d2d3-diag                                   2026-08-03
wo-d5d4-ux                                     2026-08-03
wo-resource-catalog-ontology                   2026-08-01
wo-63-schema-readability                       2026-07-31
wo-66-rules-p1p2                               2026-07-31
wo-69-ontology-primitives                      2026-07-31
wo-69-p2-function-signature                    2026-07-31
wo-69-p3-interface                             2026-07-31
wo-capacity-100pct                             2026-07-31
wo-scenario-input-phase0                       2026-07-31
wo-unitprice-scale                             2026-07-31
wo-66-rules-first-class                        2026-07-30
wo-aip-cap0                                    2026-07-29
wo-live-disposition                            2026-07-29
wo-base-id-fidelity                            2026-07-28
wo-cap-demanddelta                             2026-07-28
wo-cockpit-wiring                              2026-07-28
wo-dialogue-q1q2                               2026-07-28
wo-seam-arg-drop                               2026-07-28
optwhatif-nl-wiring                            2026-07-27
seg-attr-scope                                 2026-07-27
wo-dialogue-theme                              2026-07-27
wo-l2-decompose                                2026-07-27
wo-loop-control-p2                             2026-07-27
wo-loop-control-p2p5                           2026-07-27
wo-scene-concretize                            2026-07-27
wo-warm-structural                             2026-07-27
wo-datacore-lazy-context                       2026-07-26
wo-det-cross-domain                            2026-07-26
wo-loop-control-p1                             2026-07-26
wo-multi-intent-p1                             2026-07-26
wo-multiintent-l2                              2026-07-26
wo-multiintent-l3                              2026-07-26
wo-qos-cross-domain-unified                    2026-07-26
wo-qos-cross-domain-unified-graw0b             2026-07-26
wo-qos-cross-domain-unified-v2                 2026-07-26
w9-windowdays                                  2026-07-25
wo-0-nl-wiring                                 2026-07-25
wo-agent-runtime-s01                           2026-07-25
wo-context-compression                         2026-07-25
wo-databuilder-harness                         2026-07-25
wo-dril-p1                                     2026-07-25
wo-dril-p2                                     2026-07-25
wo-dril-p3                                     2026-07-25
wo-dril-p4                                     2026-07-25
wo-dril-precision                              2026-07-25
wo-e2e-dialogue-acceptance                     2026-07-25
wo-globalsim-suite                             2026-07-25
wo-gray-node-autofill                          2026-07-25
wo-gui4-multiobj-real                          2026-07-25
wo-harness-prompt                              2026-07-25
wo-harness-prompt-graw0b                       2026-07-25
wo-prompt-defaults-wiring                      2026-07-25
wo-reflect-loop                                2026-07-25
wo-rules-classify                              2026-07-25
wo-w5-business-type                            2026-07-25
memory-view-resilience                         2026-07-24
ontology-context-a                             2026-07-24
qos-live-evidence                              2026-07-24
surface-7dim                                   2026-07-24
wo-capacity-provenance                         2026-07-24
wo-gsim-agent                                  2026-07-24
ontology-context                               2026-07-23
wo-gsim-action                                 2026-07-23
wo-gsim-data                                   2026-07-23
wo-gsim-frontend                               2026-07-23
wo-gsim-solver                                 2026-07-23
wo-phase2-c                                    2026-07-23
wo-phase3-b                                    2026-07-23
wo-phase4-fallback                             2026-07-23
wo-qos-ontology-context                        2026-07-23
wo-slice-connectivity                          2026-07-23
wo-synth-validation-lite                       2026-07-23
wo-globalsim-drill-seam                        2026-07-22
wo-memsim-optimizer                            2026-07-22
wo-phase1-d-a                                  2026-07-22
cap-deepen                                     2026-07-21
debattery-fix-2                                2026-07-21
globalsim-glass                                2026-07-21
qos-agent-speed                                2026-07-21
qos-budget-600s                                2026-07-21
qos-det-gate                                   2026-07-21
role-fallback                                  2026-07-21
base-outlook                                   2026-07-20
capacity-infer                                 2026-07-20
ontology-drift-fix                             2026-07-20
portfolio-optimal                              2026-07-20
project-sim-whatif                             2026-07-20
tier2-semantic-discover                        2026-07-20
cleanroom-attr                                 2026-07-19
cross-object-multiobj                          2026-07-19
debattery-fix                                  2026-07-19
diag-100q                                      2026-07-19
disruption-radius                              2026-07-19
exception-event                                2026-07-19
generic-whatif                                 2026-07-19
interbase-transfer                             2026-07-19
jobshop-schedule                               2026-07-19
learning-loop                                  2026-07-19
mock-stubs                                     2026-07-19
optimize-whatif-fe                             2026-07-19
orderline                                      2026-07-19
orderline-atpbase                              2026-07-19
resource-descriptor                            2026-07-19
sop-reschedule                                 2026-07-19
tier2-semantic-discover-v2                     2026-07-19
tier3-agent-timeout-fallback                   2026-07-19
tier3-agent-timeout-fallback-v2                2026-07-19
tier3-cash-gm-attribution                      2026-07-19
tier3-cash-gm-attribution-v2                   2026-07-19
tier3-metric-rollup-split                      2026-07-19
atp-promise                                    2026-07-18
block-dialogue                                 2026-07-18
capacity-daily                                 2026-07-18
capacity-infer-process                         2026-07-18
causal-deepchain                               2026-07-18
ceo2v2                                         2026-07-18
counterfactual-basesel                         2026-07-18
decision-kernel-wire                           2026-07-18
decision-play-fe                               2026-07-18
ext-signal-detail-be                           2026-07-18
five-role-ai-employee                          2026-07-18
geo-real-signal                                2026-07-18
inference-prd                                  2026-07-18
inventory-3tier                                2026-07-18
metric-aware-seam                              2026-07-18
plankpi-mq                                     2026-07-18
provenance-hover                               2026-07-18
q7-reconciled                                  2026-07-18
real-llm-free-query                            2026-07-18
sandbox-action-propagation                     2026-07-18
supply-demand-fe                               2026-07-18
warehouse-custloc                              2026-07-18
a3-fix                                         2026-07-17
a3-refbase                                     2026-07-17
a3-refbase-wip                                 2026-07-17
c1                                             2026-07-17
capacity-timeline                              2026-07-17
ceo-data                                       2026-07-17
ceo-data-2                                     2026-07-17
ceo-q7                                         2026-07-17
ceo2                                           2026-07-17
ceo3                                           2026-07-17
ceo6                                           2026-07-17
cockpit-infer                                  2026-07-17
metric-aware-gap                               2026-07-17
qos                                            2026-07-17
qos-wip                                        2026-07-17
unit-normalize                                 2026-07-17
```
