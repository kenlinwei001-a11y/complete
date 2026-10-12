# 待复验分支分诊 · 按内容测量

- **集成分支（canonical）**：`origin/claude/inspiring-gates-aqczjg` @ `b15ad19b`
- **测量时刻**：2026-09-19 15:25:25 UTC
- **产出单**：WO-REVERIFY-TRIAGE（只读测量单，零产品代码改动）

`scripts/dispatch-deficit.sh` 现算「待复验 263」，判据是**祖先关系**。本单把判据换成**内容**，重测全部 handoff 分支。

## 0 · 结论先行

- 枚举 **904** 条 `claude/handoff-*` 远端分支。
- 其中 **549** 条**按内容已无残留**（内容已在 canonical 里，无论经 merge / cherry-pick / squash / 他人重做）。
- **355** 条 RESIDUAL>0。
- 但 RESIDUAL>0 里有 **109** 条被**独立旁证（`git cherry` patch-id）判为每一条提交都已在上游** —— 这批是树差的**过报**。
- ⇒ **两个信号都说「不在 canonical 里」的只有 246 条**，这才是可以直接动手的短名单。
- 其中**最近 7 天推的有 19 条**（见 §4），那是最可能还活着的活。

> 263 这个数既不是上界也不是下界：按内容测，RESIDUAL>0 是 **355**，而两信号取交只剩 **246**。

## 0.5 · 263 是怎么来的 —— 根因已定位，一行常量

`scripts/dispatch-deficit.sh` 的待复验判据里写死：

```
INTEG="origin/claude/verify-reclaim-6"
```

**这条集成分支的最后一次提交是 `2026-08-25`，比 canonical 落后 25 天**，而且它本身**已经是 canonical 的祖先**（`git merge-base --is-ancestor` RC=0）。判据于是变成：

> 「不是 **8 月 25 日那棵树** 的祖先，且提交时间晚于 8 月 25 日」 ⇒ 计入待复验

**近 25 天并进 canonical 的分支，一条都不满足『是 verify-reclaim-6 的祖先』，于是全部被计入。**

**实测坐实**（正向金丝雀自己就是受害者）：`handoff-prop-v2-rebase` **今天**经合并提交 `b15ad19b` 并入 canonical，
而它 ① 不是 `verify-reclaim-6` 的祖先（RC=1）② 提交时间 `1789828903` ≥ 闸值 `1787648133` ⇒ **被 `dispatch-deficit.sh` 当作「待复验」计入**。

**独立旁证 —— 我把它的判据照抄重算，得 264，而脚本报 263，差的 1 条正是本单今天推的 `handoff-reverify-triage`**（算这个数时它还不存在）。⇒ 复现精确，根因成立。

**形态**（照铁律 0.6 句式）：

> **「我用『它不是 `verify-reclaim-6` 的祖先』当作『它没并进 canonical』的证据，而前者并不度量后者 —— 因为 `verify-reclaim-6` 已经落后 canonical 25 天。」**

⚠ 这**不是**脚本头注里已经自认的那两条边界（时间闸必要不充分 / 摘并被多算）。那两条说的是判据**方法**的局限；**这一条是基准点本身过期了** —— 方法再对，尺子钉在 25 天前也会错。

⛔ 本单是只读单，**没有改这个常量**（禁令：不碰 `scripts/`）。修不修、怎么修是收编方的决定。

## 1 · 🐤 金丝雀读数（缺任一，整份名单作废）

| 金丝雀 | 期望 | 实测 | 判定 |
|---|---|---|---|
| **正向** `handoff-prop-v2-rebase` (`3c9cce9a`) | RESIDUAL ≈ 0 | **0 文件 / 0 行**，`git cherry` **0** 条未上游 | ✅ 通过（该分支是 canonical 的祖先，经合并提交 `b15ad19b` 并入） |
| **反向** `handoff-edge-wire` (`396a71a7`) | RESIDUAL 显著 >0 | **125 文件 / 80604 行**（其中源码 13 文件 / 2616 行），`git cherry` **43** 条未上游 | ✅ 通过 |
| **枚举非空** | 与 `git ls-remote` 计数一致 | `for-each-ref` **904** 条 vs `ls-remote` **904** 条 | ✅ 一致 |

⚠️ 枚举数说明：首次 `ls-remote` 报 **903**，是在本单推出 `claude/handoff-reverify-triage` **之前**跑的；推完复测即为 904。两个数都对，差的那一条是本单自己。

### 1.1 金丝雀当场抖出一个我自己的量法 bug（已修，修前修后读数都在）

第三条金丝雀（拿**已知是 canonical 祖先**的分支反validate 快路径）报出了**自相矛盾**的读数：

```
handoff-bom-date   AHEAD=141 文件 / 44512 行   RESIDUAL=0
```

祖先分支的三点差 `CANON...B` 必须为**空**（merge-base 就是它自己的 tip，实测 `git merge-base` 与 `git rev-parse` 同为 `913faf7e`）。手工复跑原始命令：三点差 **0 行**、两点差 **141 行** ⇒ **我的脚本把两点差当成了三点差**。

**病因**：awk 的 `FNR==NR` 双文件惯用法。**当第一个文件为空时，`FNR==NR` 对第二个文件的记录依然成立** —— 于是两点差整份被当作 AHEAD 计入，交集分支一次都没跑。

**形态**（照铁律 0.6 句式）：

> **「我用『`FNR==NR` 是 awk 的双文件惯用法』当作『它能区分这两个文件』的证据，而前者并不度量后者 —— 第一个文件为空时它区分不了。」**

**修法**：改用 `FILENAME==f1` 判文件归属，不依赖记录计数。修后同一条分支读数 `AHEAD=0 / RESIDUAL=0`，与祖先关系自洽。

⚠️ **这个 bug 的危险形态**：它**只在第一个文件为空时触发**，而那恰好是「分支已被完整并入」这一类。两个规定的金丝雀（正向/反向）**都不会触发它** —— 正向金丝雀当时报的是 `AHEAD=2/105, RESIDUAL=0`，结论「已并入」**碰巧是对的，但过程是错的**。是第三条自加的快路径金丝雀把它抖出来的。

## 2 · 量法，以及它量不到什么

每条分支三个量，全部按内容：

| 量 | 命令 | 答的问题 |
|---|---|---|
| `AHEAD` | `git diff --numstat --no-renames $CANON...$B` | **它做了什么**（三点差 = 从 merge-base 到它自己） |
| `RESIDUAL` | `git diff --numstat --no-renames $CANON $B`，**只取 AHEAD 里那些文件** | **它还欠什么**（两点差 = 两棵树的实际差异） |
| `CHERRY+` | `git cherry $CANON $B` 里 `+` 的条数 | **它有几条提交的 patch-id 还不在上游** |

### 2.1 ⚠️ RESIDUAL>0 是**必要不充分**的，别拿它当工作量

两点差里**混进了 canonical 自己在同一批文件上的新工作**。实测 `handoff-a3-fix`：

```
AHEAD    = 29 文件 /    881 行     <- 它自己做的
RESIDUAL = 27 文件 / 29195 行     <- 比它自己做的多 33 倍
```

多出来的 28,314 行不是它欠的，是**把 canonical 的新工作倒回去**才需要的改动。所以：

- **`RESIDUAL == 0` 是决定性的**：那批文件两棵树逐字节相同 ⇒ 内容确实已在 canonical 里。
- **`RESIDUAL > 0` 只是「树不一样」**，对一条老分支而言几乎必然成立，**不度量它还欠多少活**。

### 2.2 所以加了第二个独立信号：`git cherry`

两个信号各自漏掉不同的东西，**必须并用**：

| 信号 | 为 0 时证明 | 漏掉什么 |
|---|---|---|
| `RESIDUAL == 0` | 那批文件内容已在 canonical | 分支若同时带**别的**未并文件则不为 0 |
| `CHERRY+ == 0` | 每条提交的 patch-id 都已在上游 | **squash 合并**会改 patch-id ⇒ 认不出 |

⇒ **「还活着」= RESIDUAL>0 **且** CHERRY+>0**。实测这样的分支 **246** 条，而单看 RESIDUAL>0 是 **355** 条 —— 差的 **109** 条正是 WO 里说的「已 cherry-pick/squash 收编却被多算」那一类。

**「两个信号各漏一样」不是推演，是实测到的**：有 **9** 条分支 `RESIDUAL=0`（内容确实已在 canonical）**却** `CHERRY+>0`（`git cherry` 认为它的提交没上游）—— 这正是 **squash / rebase 改掉 patch-id** 的指纹。**只信 `git cherry` 就会把这 9 条当成待复验。**

这 9 条是：`handoff-harness-smoke`, `handoff-reverify-triage`, `handoff-wo-a10-events`, `handoff-wo-diag-rules`, `handoff-wo-diag-worldstate`, `handoff-wo-onto-verify`, `handoff-wo-r13-drillfield`, `handoff-wo-simtai-verify`, `handoff-wo-view-audit-a`

（其中 `handoff-reverify-triage` 是本单自己 —— canonical + 一条**空提交**，`git cherry` 把空提交记作 `+`。它不是 squash，列在这里只为不隐瞒。）

### 2.3 行数会被 evidence JSON 压垮，故另计源码行

`handoff-edge-wire` 的 78,879 行 AHEAD 里，**单个文件 `docs/evidence/sim-console-e2e/tick-response-1.json` 就占 65,651 行**。按总行数排序等于按「谁 dump 的 JSON 大」排序。故表里另给 **源码行**（`apps/` `packages/` `scripts/`）：edge-wire 的源码残留是 **13 文件 / 2,616 行**，这才是可动手的量级。

## 3 · 四个总数

| 量 | 数 |
|---|---|
| 枚举总数 | **904** |
| RESIDUAL > 0 | **355** |
| RESIDUAL = 0 | **549** |
| 相加 | **904** == 枚举总数 ✅ |

RESIDUAL = 0 的 549 条拆开：**521** 条是 canonical 的**祖先**（三点差本身为空，快路径判定）+ **28** 条是**非祖先但内容已在**（cherry-pick / squash / 他人重做 —— 祖先判据看不见的那一类）。

⚠️ 本单自己的分支 `handoff-reverify-triage` 也在枚举内（它是 canonical + 一条空提交，RESIDUAL=0）。

### 3.1 那 263 条里，有多少其实已经并了

| 量 | 数 |
|---|---|
| `dispatch-deficit.sh` 判据重算（含本单分支） | **264** |
| 其中**按内容已无残留**（RESIDUAL=0） | **210** |
| 其中 RESIDUAL>0 但 `git cherry` 说每条提交都已上游 | **6** |
| **两个信号都说未并** | **48** |

⇒ **263 里约 216 条是过报**，真正两信号都说未并的是 **48** 条。

**而它同时在另一个方向漏掉 198 条**：全仓两信号都说未并的是 **246** 条，落在 263 里的只有 **48** 条 —— 其余 **198** 条因为**提交时间早于 2026-08-25 的时间闸**而被整个滤掉。

| 方向 | 条数 | 机制 |
|---|---|---|
| **高估** | 216 | 基准钉在 25 天前的 `verify-reclaim-6`，近 25 天并入 canonical 的分支全部不满足祖先条件 |
| **低估** | 198 | 时间闸 `TS >= 2026-08-25` 把推得早、至今没并的分支整个滤掉 |

**两个方向的误差都比 263 这个数本身大。** 这就是 WO 里那句「同时高估和低估」的具体数字。

## 4 · 最近 7 天推的、且 RESIDUAL>0（19 条）

这是最可能还活着的活。`CHERRY+` 列是独立旁证：为 **0** 表示每条提交的 patch 都已在上游，**树差是过报**。

| # | 分支 | tip | 最近提交 | 距今 | RESIDUAL 文件/行 | 其中源码 | CHERRY+ | 碰哪些包 | 它做了什么（取自最后一条提交信息） |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `handoff-stale-claims-dates` | `43c0af0c` | 2026-09-19 | 0.3h | 2 / 36 | 2 / 36 | **3** | frontend | WIP·未验 zh.ts 阻滞点残差文案注释补实测日期与复验方式（STALE-1） |
| 2 | `handoff-m0-ground-truth` | `4a5c1ad4` | 2026-09-19 | 1.3h | 5 / 251 | 5 / 251 | **3** | frontend | WIP·未验 F0: SandboxView.init 改服务端派生 + src 零命中（含注释叙事清理） |
| 3 | `handoff-edge-wire` | `396a71a7` | 2026-09-19 | 6.0h | 125 / 80604 | 13 / 2616 | **43** | datacore,docs,evidence,root,contracts | docs(prd): 仓主反馈六条全收编+WS-F预言层——§0铁律边界澄清（禁生成不禁拟合）+B7代理模型双臂+A10假设搜索环(P0,反Goodhart埋真法)+A11解释… |
| 4 | `handoff-snapshot-restore` | `0f5ecf8a` | 2026-09-18 | 1.4d | 3 / 1261 | 2 / 918 | **15** | datacore,evidence | WO-SNAPSHOT-RESTORE 阶段②: §10.9 两红归因定案 —— E7 快照语义缺口立案，empty-tenant 与快照无关 |
| 5 | `handoff-edge-wire-seam-recheck` | `0743036f` | 2026-09-18 | 1.5d | 54 / 8254 | 12 / 2582 | **32** | datacore,evidence,contracts | evidence(edge-wire-recheck): 收尾自证——窗口全程独占、本单零残留（判据落在 cwd+cmdline+起始时刻） |
| 6 | `handoff-damping` | `9ebfe7be` | 2026-09-17 | 2.2d | 2 / 1015 | 2 / 1015 | **9** | datacore | WO-SIM-DAMPING 移除一次性实验脚手架（禁令3：不新增门） |
| 7 | `handoff-calibration` | `e6b3591f` | 2026-09-17 | 2.2d | 9 / 2065 | 8 / 2057 | **16** | datacore,evidence,contracts | WO-SIM-CALIBRATION：修 3 处 TS 严格空检查（typecheck RC 2→0） |
| 8 | `handoff-dsh-flip` | `2a591841` | 2026-09-17 | 2.3d | 6 / 976 | 1 / 2 | **5** | root,docs,evidence,packages-other | CLAUDE.md 铁律 1.6 · vitest 计数探针第 4 个错版本 + 可直接粘贴的实现 |
| 9 | `handoff-domain-declare` | `12de5dfe` | 2026-09-17 | 2.3d | 2 / 633 | 2 / 633 | **3** | datacore | WIP·未验 · 订正 B 类不补域的理由（派单给的 leadDays 坐标实测不成立，换成 chain-loss.ts 已核实那条） |
| 10 | `handoff-agent-reasoner` | `68c0f60d` | 2026-09-17 | 2.4d | 55 / 159212 | 2 / 87 | **1** | root,agentcore | WO-AGENT-REASONER · 把推理机的 what-if 暴露给 agent（query_ontology.overrides） |
| 11 | `handoff-sales-ring` | `ceb6c9ff` | 2026-09-17 | 2.4d | 51 / 7331 | 13 / 2729 | **28** | datacore,evidence,contracts | chore: 删除临时探针 _probe-sales-ring.test.ts |
| 12 | `handoff-guard-world` | `0bb51466` | 2026-09-17 | 2.4d | 1 / 91 | 1 / 91 | **1** | datacore | 退③修复：measuredCells 守门员走生产播种路（含反向臂与变异反证） |
| 13 | `handoff-sim-world-single-source` | `670f0497` | 2026-09-17 | 2.4d | 1 / 224 | 0 / 0 | **2** | root | 解冻：measuredCells 守门员获仓主批准 + 四条设计判据 |
| 14 | `handoff-meter` | `24e82377` | 2026-09-16 | 3.5d | 6 / 1346 | 6 / 1346 | **7** | frontend | WIP·未验 · WO-SIM-REALITY-METER · 孪生 scope 去掉 types:0（缺席不补 0） |
| 15 | `handoff-desat3` | `f072c8dc` | 2026-09-16 | 3.5d | 39 / 5787 | 12 / 2737 | **10** | datacore,evidence,contracts | WIP·未验 sim-propagation-direction 三处金值改从规则表/trace 现算 |
| 16 | `handoff-deriv-probe` | `2719065d` | 2026-09-16 | 3.5d | 6 / 785 | 6 / 785 | **5** | datacore | WO-DERIV-DSL-PROBE: 六份探针全绿（25 例）；活服务 15731 端到端复核完成，服务已按 pid 关停 |
| 17 | `handoff-desat2` | `3b26135f` | 2026-09-16 | 3.5d | 15 / 1659 | 0 / 0 | **3** | evidence | WO-SIM-DESAT-2 前提修正：病是真的，但"只动 seed.ts 系数"补不上——三个乘性病因，第三个在本单边界外 |
| 18 | `handoff-desat` | `043e9bc4` | 2026-09-16 | 3.5d | 7 / 898 | 0 / 0 | **2** | evidence | 衰减账本：杀手是 Material→Model 那一跳，一跳掉 19 万倍 |
| 19 | `handoff-ontograph-sop` | `800f625c` | 2026-09-15 | 4.4d | 1 / 358 | 0 / 0 | **3** | docs | docs(PRD): 融合模式四级阶梯（规则+求解器+ReAct+生成求解器）+ dsh 真供应商实测 |

其中**两个信号都说未并**的：**19** 条 —— `handoff-stale-claims-dates`, `handoff-m0-ground-truth`, `handoff-edge-wire`, `handoff-snapshot-restore`, `handoff-edge-wire-seam-recheck`, `handoff-damping`, `handoff-calibration`, `handoff-dsh-flip`, `handoff-domain-declare`, `handoff-agent-reasoner`, `handoff-sales-ring`, `handoff-guard-world`, `handoff-sim-world-single-source`, `handoff-meter`, `handoff-desat3`, `handoff-deriv-probe`, `handoff-desat2`, `handoff-desat`, `handoff-ontograph-sop`

## 5 · 全部 RESIDUAL>0，按 RESIDUAL 行数降序（355 条）

⚠️ 读这张表前先读 §2.1：**RESIDUAL 行数不是工作量**，它含 canonical 自己的新工作。`CHERRY+ = 0` 的行是树差过报。

| # | 分支 | tip | 最近提交 | RESIDUAL 文件/行 | 其中源码 | CHERRY+ | 碰哪些包 | 它做了什么（取自最后一条提交信息） |
|---|---|---|---|---|---|---|---|---|
| 1 | `handoff-agent-reasoner` | `68c0f60d` | 2026-09-17 | 55 / 159212 | 2 / 87 | **1** | root,agentcore | WO-AGENT-REASONER · 把推理机的 what-if 暴露给 agent（query_ontology.overrides） |
| 2 | `handoff-edge-wire` | `396a71a7` | 2026-09-19 | 125 / 80604 | 13 / 2616 | **43** | datacore,docs,evidence,root,contracts | docs(prd): 仓主反馈六条全收编+WS-F预言层——§0铁律边界澄清（禁生成不禁拟合）+B7代理模型双臂+A10假设搜索环(P0,反Goodhart埋真法)+A11解释… |
| 3 | `handoff-wo-view-audit-b` | `c4d68acb` | 2026-08-26 | 403 / 51884 | 382 / 43157 | **3** | root,agentcore,datacore,frontend,docs,contracts,packages-other,scripts | docs(audit): 订正 §6 行数口径不一致（helper 列两处混用了含/不含共享依赖两套算法） |
| 4 | `handoff-wo-aip-cap0` | `5e6c1368` | 2026-07-29 | 58 / 33391 | 57 / 29895 | **2** | agentcore,datacore,frontend,docs,contracts,scripts | handoff(wo-aip-cap0): plan-builder Phase 1 + live-disposition + scenario launcher input … |
| 5 | `handoff-qos` | `61137dd2` | 2026-07-17 | 27 / 29293 | 24 / 22177 | **1** | agentcore,datacore,frontend,docs,contracts,scripts | docs(SYSTEM-ONTOLOGY): update A3-SUITE status in §2/§7/§8 |
| 6 | `handoff-qos-wip` | `61137dd2` | 2026-07-17 | 27 / 29293 | 24 / 22177 | **1** | agentcore,datacore,frontend,docs,contracts,scripts | docs(SYSTEM-ONTOLOGY): update A3-SUITE status in §2/§7/§8 |
| 7 | `handoff-a3-fix` | `70bb7252` | 2026-07-17 | 27 / 29195 | 24 / 22081 | **1** | agentcore,datacore,frontend,docs,contracts,scripts | fix(datacore): A3-SUITE 切片契约元数据出行为规则集——根治 DSL FALSE + planviews 污染 |
| 8 | `handoff-wo-sim-scope-local` | `a0d3c368` | 2026-08-08 | 38 / 27399 | 34 / 22496 | **0** ⚠️ | datacore,frontend,docs,root,contracts,scripts | docs: PRD-sim-scope-local（含《本体引用与影响》+ 两条断点建议 + 诚实遗留清单） |
| 9 | `handoff-cross-object-multiobj` | `e0341c3d` | 2026-07-19 | 25 / 26846 | 23 / 22882 | **6** | datacore,frontend,docs,contracts,root | fix(cross-object-multiobj): 面板导航步骤6 + loading 态不伪装 displaced（收口前端 SEAM） |
| 10 | `handoff-wo-69-p3-interface` | `4427af2a` | 2026-07-31 | 30 / 23904 | 27 / 18215 | **6** | agentcore,datacore,docs,root,contracts,scripts | docs(ontology): §7 补登 P2 function-signature:check（跨阶段收口·闭 writeback 门对本单的告警） |
| 11 | `handoff-wo-opt-whatif-data` | `010627a9` | 2026-08-08 | 33 / 23435 | 29 / 18563 | **2** | datacore,frontend,docs,root,contracts,scripts | WO-OPT-WHATIF-DATA ⑦: 修正 battery.ts 行号锚点 4302→4303（纯注释/文档） |
| 12 | `handoff-metric-aware-seam` | `b2c3a1e5` | 2026-07-18 | 18 / 23026 | 16 / 19215 | **4** | datacore,docs,contracts | fix(seam): WO-METRIC-AWARE-SEAM-CLOSE 关掉 metric-aware 因果域接缝（数据×引擎一套机制） |
| 13 | `handoff-portfolio-optimal` | `516a4a1b` | 2026-07-20 | 18 / 22638 | 14 / 15696 | **1** | datacore,frontend,docs,root | chore(ontology): un-backtick step.completed——消 canonical 预存假漂移(本 handoff 独立门绿·同 drift-fi… |
| 14 | `handoff-ceo2v2` | `6837fa19` | 2026-07-18 | 11 / 21729 | 10 / 17947 | **2** | datacore,docs,contracts | feat(WO-CEO-DATA-2): 每指标多假设因果域数据与真源物化扩展 |
| 15 | `handoff-wo-63-schema-readability` | `333ab6f3` | 2026-07-31 | 18 / 21674 | 16 / 18221 | **5** | agentcore,datacore,frontend,docs,root,contracts,scripts | fix(gate): H3 同源守恒改判「副本不得存在」——门此前红在自己的成果上 |
| 16 | `handoff-wo-w5-business-type` | `82f8508e` | 2026-07-25 | 10 / 20929 | 9 / 17425 | **0** ⚠️ | datacore,frontend,docs,contracts | WO-W5 全局推演按业务类型（乘/商/储）差异化 + 勾选筛选真重算 |
| 17 | `handoff-wo-rules-classify` | `cd2ca8bd` | 2026-07-25 | 11 / 20807 | 11 / 20807 | **0** ⚠️ | datacore,frontend,contracts | WO-RULES-CLASSIFY: 规则+求解器分类可筛选 + 约束条件独立标签（category 加性元数据·向后兼容） |
| 18 | `handoff-wo-globalsim-suite` | `6f89fd5b` | 2026-07-25 | 15 / 20698 | 14 / 17225 | **0** ⚠️ | datacore,frontend,docs,contracts | WO-GLOBALSIM-SUITE: W5乘商储+G-UI-2基地产线列+G-VAR-1/2/3+G-UI-3客户卡+plan_change+预览Modal |
| 19 | `handoff-wo-flowtime` | `5ed6724c` | 2026-08-13 | 25 / 20331 | 24 / 17382 | **3** | agentcore,datacore,frontend,docs,contracts | test(flowtime): 变异反证逼出一道真门——「有实测就不许用计划值」 |
| 20 | `handoff-project-sim-whatif` | `215bb681` | 2026-07-20 | 8 / 19011 | 7 / 15315 | **1** | datacore,frontend,docs | feat(project-sim-whatif): ⑥动态杠杆(瓶颈反推+敏感度排序)走 generic_inference 真重算·闭 G-WHATIF-HARDCODED-… |
| 21 | `handoff-wo-lever-binding` | `02e1e55e` | 2026-08-08 | 35 / 18970 | 30 / 14097 | **0** ⚠️ | datacore,frontend,docs,root,contracts,scripts | docs(prd): WO-LEVER-BINDING-DRIFT —— 缺陷取证 / 选型理由 / 门设计 / 变异反证 / 建议 §8 措辞 |
| 22 | `handoff-wo-semantics-singlesource` | `f64a12ee` | 2026-08-08 | 33 / 18894 | 29 / 14022 | **0** ⚠️ | datacore,frontend,docs,root,contracts,scripts | WO-SEMANTICS-SINGLESOURCE: 补反伪造第 ⑥ 条（解析不动即不豁免）+ 自检条数改派生 |
| 23 | `handoff-wo-hardcoded-absence` | `8c9b2264` | 2026-08-08 | 32 / 18773 | 28 / 13870 | **0** ⚠️ | datacore,frontend,docs,root,contracts,scripts | WO-FRONTEND-HARDCODED-ABSENCE: PRD（含《本体引用与影响》+ 建议断点措辞） |
| 24 | `handoff-wo-nav-gate` | `457ac9d7` | 2026-08-08 | 31 / 18751 | 27 / 13848 | **0** ⚠️ | datacore,frontend,docs,root,contracts,scripts | WO-NAV-GATE ④: 变异 D 抖出本门自己的假绿，收紧声明正则 |
| 25 | `handoff-wo-zombie-audit` | `f7be27e7` | 2026-08-08 | 31 / 18726 | 27 / 13823 | **0** ⚠️ | datacore,frontend,docs,root,contracts,scripts | docs: WO-ZOMBIE-AUDIT 订正 transitFlow 行号 + 补第 5 处过期声明（文件头注释） |
| 26 | `handoff-wo-route-nav` | `2dbef251` | 2026-08-08 | 34 / 18629 | 30 / 13725 | **2** | datacore,frontend,docs,root,contracts,scripts | WO-ROUTE-NAV-COVERAGE ③: PRD（复核更正两处 + 5 条变异失败原文）+ 本体 §7 首次登记本门 |
| 27 | `handoff-wo-enterprise-state` | `aeb13d82` | 2026-08-10 | 14 / 18553 | 12 / 14389 | **4** | datacore,frontend,docs,contracts | WO-ENTERPRISE-STATE ④：回写 docs/SYSTEM-ONTOLOGY.md（铁律 0） |
| 28 | `handoff-sandbox-field-inventory` | `db976009` | 2026-08-08 | 21 / 18381 | 18 / 13988 | **2** | agentcore,datacore,frontend,docs,contracts,scripts | docs: 修正会话族 E 的字段账（自查发现三处错误） |
| 29 | `handoff-sandbox-a10-audit` | `317f37e8` | 2026-08-08 | 21 / 18377 | 18 / 13984 | **2** | agentcore,datacore,frontend,docs,contracts,scripts | docs(audit): 补验 ChainImpedimentView 取数方式 —— 未验项 C.3 结清，估时收窄 |
| 30 | `handoff-sandbox-a6-audit` | `bcce7269` | 2026-08-08 | 21 / 18377 | 18 / 13984 | **2** | agentcore,datacore,frontend,docs,contracts,scripts | docs(audit): A6 补两条实测 —— seed 42 真有跨 seg 争用，但与阻滞点面交集为空（annotate 形态会恒空） |
| 31 | `handoff-fix-imp2plan-seam` | `528d3a85` | 2026-08-09 | 21 / 18365 | 18 / 13972 | **0** ⚠️ | agentcore,datacore,frontend,docs,contracts,scripts | fix(frontend): 补全 imp2plan 接缝门的 SandboxViewConfig fixture（§2 三条真红） |
| 32 | `handoff-wo-transit-wire` | `c5a1fe41` | 2026-08-08 | 33 / 18261 | 29 / 13358 | **0** ⚠️ | datacore,frontend,docs,root,contracts,scripts | WO-TRANSIT-WIRE: PRD（复核 + 缺口锁红原文 + 三条变异反证 + 本体引用与影响） |
| 33 | `handoff-wo-live-disposition` | `cc022645` | 2026-07-29 | 12 / 18224 | 11 / 14823 | **0** ⚠️ | datacore,frontend,docs,contracts | fix(risk): 换推演窗口丢弃上一窗口的处置表重算结果（防串窗·诚实回落基线） |
| 34 | `handoff-ceo-data-2` | `c068306f` | 2026-07-17 | 14 / 17904 | 13 / 14129 | **3** | datacore,docs,contracts | feat(datacore/contracts): WO-CEO-DATA-2 CEO 驾驶舱原子颗粒数据集生成 |
| 35 | `handoff-ceo2` | `56525000` | 2026-07-17 | 9 / 17894 | 8 / 14104 | **1** | datacore,docs,contracts | feat(datacore): WO-CEO-2 gap_attribution 深度反向归因引擎（结构分摊+勾稽+caused_by 因果遍历·GAP-ATTR） |
| 36 | `handoff-ceo3` | `3497f24d` | 2026-07-17 | 10 / 17798 | 9 / 14009 | **2** | datacore,docs,contracts | feat(datacore): WO-CEO-3 decision_play 决策推演引擎（多方案+比对矩阵+触发行动+组合收窄·G-DECISION） |
| 37 | `handoff-base-outlook` | `fa67ea96` | 2026-07-20 | 12 / 17647 | 11 / 13951 | **1** | datacore,frontend,docs | feat(base-outlook): 每基地前瞻产能推演(+30/60/90d 四线)+行动计划逐日 rationale·闭 F1/P1 |
| 38 | `handoff-wo-66-rules-p1p2` | `7b92660a` | 2026-07-31 | 23 / 17434 | 21 / 13952 | **1** | datacore,docs,root,contracts,scripts | feat(rules): WO-66 规则一等化 P1+P2 —— 阈值读规则唯一入口 + 求解器→规则绑定一等表（闭 G-10 死代码洞） |
| 39 | `handoff-wo-rules-dsl-family` | `8a5e6e93` | 2026-08-07 | 14 / 17104 | 12 / 13792 | **4** | datacore,frontend,docs,root,contracts,scripts | fix(test): 反向闸把老测试里的分叉写法逼了出来 —— 四例改回引用式 |
| 40 | `handoff-sop-reschedule` | `f572080b` | 2026-07-19 | 11 / 16787 | 10 / 13019 | **1** | agentcore,datacore,frontend,docs,contracts | feat(sop-reschedule): 产销重排推演求解器（跨基地拆产/挤占在手单/代价·整单跨半 SEAM） |
| 41 | `handoff-wo-console-cleanup` | `b95b8f41` | 2026-08-08 | 27 / 16736 | 24 / 11712 | **0** ⚠️ | datacore,frontend,docs,contracts | WO-CONSOLE-CLEANUP · PRD-console-cleanup.md（含本体引用与影响 / 诚实位逐条清点 / 变异反证 / 实拍） |
| 42 | `handoff-wo-waiting-states-fe` | `091f6cdb` | 2026-08-10 | 14 / 16593 | 14 / 16593 | **1** | datacore,frontend | WO-WAITING-STATES-FE · 测试 29 例 + 变异反证抓出并修掉一个自己写的哑门 |
| 43 | `handoff-wo-sandbox-console` | `2dc26bc5` | 2026-08-07 | 26 / 16547 | 25 / 16517 | **0** ⚠️ | frontend,docs | docs(metro): PRD 七件套字段来源表 + 时序可算性三级判据 + 本体引用与影响 |
| 44 | `handoff-orderline-atpbase` | `218797fe` | 2026-07-19 | 13 / 16215 | 12 / 12491 | **5** | datacore,docs,contracts | feat(order-line): 订单拆行 OrderLine·SO→型号行·一单多型号多行·行级下沉（WO-ORDERLINE·闭 G-ORDER-FLAT） |
| 45 | `handoff-atp-promise` | `0bd885fb` | 2026-07-18 | 11 / 16187 | 10 / 12450 | **4** | datacore,docs,contracts | feat(atp-promise): OrderPromise 承诺台账 + atp_check 求解器（能不能接/何时交·Phase3 P0） |
| 46 | `handoff-wo-rule-expr-params` | `573596b5` | 2026-08-04 | 15 / 15968 | 15 / 15968 | **0** ⚠️ | datacore,frontend,contracts | feat(rules): 规则 DSL 支持 params 引用 + 前端 mock 规则库回正口径（闭 G-C08-EXPR-PARAM-SPLIT） |
| 47 | `handoff-wo-demo-lightup-2` | `2ce20275` | 2026-08-08 | 27 / 15875 | 24 / 10851 | **0** ⚠️ | agentcore,datacore,frontend,docs,contracts | test: datacore 全套安静车道复跑 RC=0（234 files / 1366 tests 全绿） |
| 48 | `handoff-wo-cert-honesty` | `ab69aa12` | 2026-08-10 | 15 / 15740 | 14 / 12517 | **0** ⚠️ | datacore,frontend,docs,contracts,scripts | WO-CERT-HONESTY: 真跑实测校正注释里的数字（工单给的「13 条」是错的，真值 23 条） |
| 49 | `handoff-wo-gray-node-autofill` | `ca9d6ff0` | 2026-07-25 | 6 / 15514 | 5 / 12003 | **1** | frontend,docs | feat(risk): 产能推演灰节点从"诚实灰终点"变"自动补齐起点" — 前端触发+据引擎 SOFT/HARD 重渲染 (WO-GRAY-NODE-AUTOFILL) |
| 50 | `handoff-wo-dril-p4` | `142d08dc` | 2026-07-25 | 27 / 15481 | 24 / 9272 | **1** | agentcore,datacore,frontend,docs,root,contracts,scripts | WO-DRIL-P4 · Router 接 Path-B 组包注入 + discover registry-first + 治理 UI |
| 51 | `handoff-sandbox-action-propagation` | `b8db35b5` | 2026-07-18 | 13 / 15410 | 12 / 11635 | **1** | datacore,docs,contracts,scripts | feat(sim): 沙盘 action→stateVar 传导闭环——决策落 Action 真传导到下游(闭 G-11 动作维·兑现 entering.kind=ACTION… |
| 52 | `handoff-wo-factor-scope-singlesource` | `e3291898` | 2026-08-10 | 11 / 15023 | 10 / 11804 | **1** | datacore,frontend,docs,contracts,scripts | docs(WO-FACTOR-SCOPE-SINGLESOURCE): 审计文档补 §3.5 亲手复验 + 数值退化记账 |
| 53 | `handoff-wo-agentrun-attribution` | `c0b70d42` | 2026-08-10 | 18 / 14879 | 16 / 11633 | **4** | agentcore,frontend,docs,contracts,scripts | WO-AGENTRUN-ATTRIBUTION: 本体回写（铁律 0）+ 前任审计文档去过期 |
| 54 | `handoff-wo-agentrun-fanout-persist` | `e7e978db` | 2026-08-10 | 19 / 14578 | 17 / 11331 | **9** | agentcore,frontend,docs,contracts,scripts | WO-AGENTRUN-FANOUT-PERSIST · 注释里的 file:line 改成符号引用（本单自己把它们挤漂了） |
| 55 | `handoff-five-role-ai-employee` | `c55b5c4f` | 2026-07-18 | 22 / 14294 | 21 / 10527 | **2** | agentcore,datacore,frontend,docs,contracts | feat(five-role): 单一 universal agent 升级为 CEO/供应链/生产/质量/base-planner 五角色化 + Coordinator 跨域… |
| 56 | `handoff-wo-69-p2-function-signature` | `cea5f85d` | 2026-07-31 | 17 / 14226 | 15 / 10781 | **3** | agentcore,datacore,docs,root,contracts,scripts | feat(a6): WO-69 P2 · Function 本体签名——把「一刀切拒」收窄成「只拒真读到受限列的求解器」 |
| 57 | `handoff-wo-slice-governance-full` | `96278d2e` | 2026-08-06 | 8 / 13710 | 8 / 13710 | **1** | datacore,frontend | autosave(claude/handoff-wo-slice-governance-full): 08-06 05:43:43 容器重启防丢快照 |
| 58 | `handoff-wo-levers-rootcause` | `f6e89e7f` | 2026-08-08 | 25 / 13666 | 22 / 8642 | **0** ⚠️ | datacore,frontend,docs,contracts | WO-LEVERS-ROOTCAUSE: 追清 discoverLevers 返回空的真因（取证·无代码改动） |
| 59 | `handoff-wo-quote-margin-customer` | `ad4407ee` | 2026-08-07 | 16 / 13450 | 15 / 10189 | **8** | agentcore,datacore,docs,scripts | fix(#118): 堵最后一条静默回落 —— 点名的客户算不出真 BOM 时报 EMPTY_SCOPE，不拿通用 BOM 冒充 |
| 60 | `handoff-wo-process-instance` | `24204b74` | 2026-08-10 | 19 / 13357 | 18 / 13355 | **5** | datacore,frontend,docs,contracts | docs+test: 交付说明 + 暗发防回归锁（第三个暗发集合 INCOMPLETE_DATA） |
| 61 | `handoff-wo-69-ontology-primitives` | `d0396227` | 2026-07-31 | 8 / 12996 | 7 / 9612 | **2** | datacore,docs,contracts | fix(a6): P1 兜底守卫——列级受限调用者拒绝求解器，堵死"算错数"（宁可少答，不许错答） |
| 62 | `handoff-geo-real-signal` | `ff780e84` | 2026-07-18 | 4 / 12850 | 3 / 9081 | **1** | datacore,docs | feat(provenance): WO-GEO-REAL-SIGNAL 地缘/矿价 provenanceSynthetic 真源派生（闭 G-DM-1） |
| 63 | `handoff-wo-opt-whatif-close` | `28a54d47` | 2026-08-08 | 7 / 12762 | 5 / 8224 | **1** | datacore,docs | WO-OPT-WHATIF-CLOSE ⑥: 终局权威门结果入 PRD（datacore 全套 RC=0 + contracts RC=0） |
| 64 | `handoff-wo-stale-claims` | `aebd4ccf` | 2026-08-08 | 11 / 12545 | 9 / 8023 | **0** ⚠️ | frontend,docs,scripts | WO-STALE-CLAIMS ④: PRD + 本体 §7 登记 + 门账 |
| 65 | `handoff-real-llm-free-query` | `e6bff23e` | 2026-07-18 | 12 / 12262 | 11 / 8493 | **1** | agentcore,datacore,frontend,docs | feat(real-llm-free-query): CEO/块级深问在确定性路由外走 path-B 真 LLM 自由多跳 + AI 指挥台 NL 入口（暗发·确定性兜底） |
| 66 | `handoff-wo-qos-ontology-context` | `12d71805` | 2026-07-23 | 10 / 12248 | 9 / 8593 | **0** ⚠️ | agentcore,datacore,docs,contracts | feat(qos): 口径语义上下文注入综合 LLM（缺口③文档三层投喂第二层·跨 A/B 只读增量） |
| 67 | `handoff-seg-attr-scope` | `c94d3483` | 2026-07-27 | 5 / 12234 | 4 / 8794 | **0** ⚠️ | datacore,docs | test(gap-attr): SEAM 过滤收紧——仅 L2 订单叶(kind:实测)·排 L1 基地节点(kind:派生·drillType 亦 Order) |
| 68 | `handoff-optimize-whatif-fe` | `453a0436` | 2026-07-19 | 8 / 12142 | 6 / 8223 | **1** | root,frontend,docs | feat(optimize-whatif-fe): 优化推演前端 Δ目标页 + 本地 sidecar 文档（闭 G-12 前端半） |
| 69 | `handoff-wo-scope-honesty-fe` | `0ae2df51` | 2026-08-11 | 7 / 12109 | 6 / 8986 | **4** | frontend,docs | WO-SCOPE-HONESTY-FE 亲手真跑: mock 库存调到真会缺料的水位（第一版屏上永远「缺料 0 张」） |
| 70 | `handoff-surface-7dim` | `6b2379aa` | 2026-07-24 | 7 / 12007 | 6 / 8438 | **0** ⚠️ | datacore,frontend,docs,contracts | feat(gsim): WO-SURFACE-7DIM 前端 additively 上屏 SOLVER 7 维 GlobalSimResponse（不回归驾驶舱） |
| 71 | `handoff-cap-deepen` | `369e9d0a` | 2026-07-21 | 14 / 11984 | 13 / 8304 | **0** ⚠️ | datacore,frontend,docs,contracts | feat(capacity): 产能推演纯增量深化 4 块（块A派生DAG/块B爬坡min包络/块C 20因素本体/块D byModel每产品） |
| 72 | `handoff-wo-unitprice-scale` | `68285bbc` | 2026-07-31 | 4 / 11817 | 3 / 8434 | **1** | datacore,docs | fix(solvers): 订单单价口径取证与修正——禁 gap_attribution 静默兜底 600 元/套 + 两处口径显式标注 |
| 73 | `handoff-wo-gsim-frontend` | `1b0f847c` | 2026-07-23 | 9 / 11811 | 8 / 8183 | **0** ⚠️ | frontend,docs | feat(global-sim): 全局推演决策驾驶舱五区·接真 portfolio solver·灰数据修 |
| 74 | `handoff-warehouse-custloc` | `1efff7f1` | 2026-07-18 | 7 / 11787 | 6 / 8022 | **2** | datacore,docs,contracts | fix(warehouse-custloc·收口): 补登 Warehouse/CustomerLocation 进数据接入分类(data-categories) |
| 75 | `handoff-wo-caplive-truechain` | `b8fc5ddf` | 2026-08-06 | 7 / 11741 | 6 / 8230 | **0** ⚠️ | datacore,frontend,docs | autosave(claude/handoff-wo-caplive-truechain): 08-06 05:43:43 容器重启防丢快照 |
| 76 | `handoff-inventory-3tier` | `44ac0028` | 2026-07-18 | 7 / 11714 | 6 / 7963 | **3** | datacore,docs,contracts | feat(inventory-3tier): 库存三层闭环·成品/流水/完工入库（WO-INVENTORY-3TIER·闭 G-WIP-FG-BREAK） |
| 77 | `handoff-wo-sandbox-action` | `27c5e368` | 2026-08-17 | 24 / 11573 | 22 / 10344 | **4** | datacore,frontend,docs,contracts,scripts | WO-SANDBOX-32CELLS dev B 交单报告：8 格明细 + U6 逐字段量纲核对 + rebase 冲突处置 + 界外红登记 |
| 78 | `handoff-cockpit-infer` | `24644f64` | 2026-07-17 | 5 / 11570 | 4 / 7796 | **1** | frontend,docs | feat(frontend): WO-COCKPIT-INFER 驾驶舱换 plan_rootcause→gap_attribution + ProvenanceDag 渲因果… |
| 79 | `handoff-orderline` | `a3c0caf9` | 2026-07-19 | 8 / 11435 | 7 / 7660 | **1** | datacore,docs,contracts | feat(orderline): 订单拆行 OrderLine 一等对象（SO→型号行·行级归因/承诺下沉·Phase3） |
| 80 | `handoff-wo-argname-and-units` | `09d6275f` | 2026-08-07 | 15 / 11265 | 13 / 7946 | **6** | datacore,docs,root,contracts,scripts | fix(#103): 键名判据收紧两头 —— 变体要认、形似判据不许过宽（**测试自己抓出来的**） |
| 81 | `handoff-wo-capacity-100pct` | `d52def35` | 2026-07-31 | 7 / 11193 | 6 / 7819 | **3** | datacore,frontend,docs | 修(产能推演页): R7–R9 轮 LOOP —— 订单聚合窗口写死 180 天、基地筛选下拉自锁死，并修正排序契约的"靠 clamp 巧合"病灶 |
| 82 | `handoff-wo-gsim-action` | `e7e8600b` | 2026-07-23 | 6 / 11143 | 5 / 7549 | **1** | datacore,frontend,docs,contracts | feat(gsim): WO-GSIM-5-ACTION 洞察→行动写回·闭决策环（G-DECISION 行动半 / G-LOOP-FEEDBACK） |
| 83 | `handoff-interbase-transfer` | `c09759e6` | 2026-07-19 | 7 / 10958 | 6 / 7194 | **2** | datacore,docs,contracts | fix(interbase-transfer): 把 InterBaseTransfer 归入采购与供应 data-category（补四包全绿门） |
| 84 | `handoff-exception-event` | `73f7e25b` | 2026-07-19 | 6 / 10837 | 5 / 7074 | **0** ⚠️ | datacore,docs,contracts | feat(exception-event): 四源归一 ExceptionEvent 一等聚合投影（闭 G-EXCEPTION-SCATTER） |
| 85 | `handoff-ontology-context` | `93913c2e` | 2026-07-23 | 12 / 10830 | 11 / 7160 | **1** | agentcore,datacore,docs,contracts | feat(ontology-context): 本体口径/语义投影地基（问句→相关类型/求解器/口径 context bundle·导航切片/语义查询/A门共同前置） |
| 86 | `handoff-unit-normalize` | `e96c9825` | 2026-07-17 | 7 / 10636 | 6 / 6863 | **0** ⚠️ | datacore,frontend,docs | fix(unit): WO-UNIT-NORMALIZE Order.qty=套 全系统单位归一 |
| 87 | `handoff-wo-seam-arg-drop` | `8bf25c35` | 2026-07-28 | 10 / 10613 | 6 / 4824 | **0** ⚠️ | agentcore,datacore,docs,root,scripts | feat(seam): 接缝丢参彻查·三相位（WO-SEAM-ARG-DROP·数据+引擎两半一并） |
| 88 | `handoff-memory-view-resilience` | `82528b7f` | 2026-07-24 | 9 / 10574 | 8 / 7038 | **0** ⚠️ | datacore,frontend,docs | fix(views): 内存模式视图默认配置防丢——内置视图收敛单一来源 + fail-fast（治 global-sim 重启隐身） |
| 89 | `handoff-wo-adopt-decision-play` | `eefaabfc` | 2026-08-10 | 8 / 10255 | 7 / 9954 | **5** | datacore,docs | WO-ADOPT-DECISION-PLAY: 交付说明（盘点 / 新动作 / 三条效果层断言 / 三个变异反证 / 门输出 / 本体回写清单） |
| 90 | `handoff-wo-pipeline-ui` | `b5e1b6c7` | 2026-08-13 | 10 / 10066 | 10 / 10066 | **2** | frontend | test(fe): WO-1 件一 · pipeline 配置面×放行面驱动接缝测试 + 幽灵令牌清零 |
| 91 | `handoff-plankpi-mq` | `9c171652` | 2026-07-18 | 7 / 10048 | 6 / 6277 | **1** | datacore,docs | feat(plankpi): WO-PLANKPI-MONTH-QUARTER 月/季 PlanKpi 真对象化（闭 DS.1 假下钻残口） |
| 92 | `handoff-tier3-cash-gm-attribution` | `765c0a6e` | 2026-07-19 | 9 / 10009 | 8 / 6310 | **1** | datacore,docs,contracts | feat(tier3-cash-gm): gap_attribution 补毛利专属域(量/价/成本)+现金 cf-ar-aging 数值 drill 加固 |
| 93 | `handoff-wo-slice-ref-producer` | `5ebc6cf2` | 2026-08-10 | 12 / 9942 | 10 / 6616 | **3** | agentcore,datacore,frontend,docs,contracts | docs: 回写本体与审计 —— G-SLICE-REF-PRODUCER-EMPTY 闭环并更正定性 |
| 94 | `handoff-metric-aware-gap` | `ce726e51` | 2026-07-17 | 4 / 9938 | 3 / 6164 | **1** | datacore,docs | fix(datacore): gap_attribution 真 metric-aware——拆硬编码 BFS 起点 + 终点门禁认绑定（C1+C2） |
| 95 | `handoff-tier3-cash-gm-attribution-v2` | `dea0cfa0` | 2026-07-19 | 9 / 9802 | 8 / 6107 | **0** ⚠️ | datacore,docs,contracts | feat(gap-attr): 补 gross_profit 专属毛利桥反向归因域 + 加固 cash AR 账龄下钻（WO-TIER3） |
| 96 | `handoff-capacity-daily` | `c1ad2141` | 2026-07-18 | 2 / 9772 | 1 / 6005 | **0** ⚠️ | datacore,docs | feat(synthetic): 派单2 Line.capacityDaily 种入 → 供需归因产能叶从诚实空变真值 |
| 97 | `handoff-c1` | `f8f19b48` | 2026-07-17 | 10 / 9754 | 9 / 5973 | **0** ⚠️ | agentcore,datacore,docs,contracts | feat(datacore): WO-C1 L2 统一决策内核——根因→方案→选定→落 Action 一条龙（闭 C1 双闸） |
| 98 | `handoff-wo-scenario-input-phase0` | `13ab118b` | 2026-07-31 | 20 / 9643 | 15 / 3511 | **1** | root,agentcore,frontend,docs,contracts,scripts | fix(ci): 本分支同步去掉 pnpm version 钉死，否则 CI 8 秒死于 setup |
| 99 | `handoff-fix-datacore-fake` | `93941a92` | 2026-08-06 | 6 / 9549 | 5 / 6038 | **0** ⚠️ | datacore,docs,contracts,scripts | autosave(claude/handoff-fix-datacore-fake): 08-06 05:43:43 容器重启防丢快照 |
| 100 | `handoff-wo-phase3-b` | `6a0a43e8` | 2026-07-23 | 13 / 9379 | 12 / 5735 | **1** | agentcore,datacore,docs,contracts,scripts | feat(ontology): ontology_query 本体查询引擎（薄层遍历+简单聚合·join≠compute·跨 A/B/CLI） |
| 101 | `handoff-ceo-data` | `9996c849` | 2026-07-17 | 8 / 9353 | 6 / 5564 | **1** | datacore,docs,contracts | feat(datacore): WO-CEO-DATA-supply 真源记录颗粒级物化（灌真颗粒·颗粒不聚合） |
| 102 | `handoff-ceo-q7` | `8e4719fc` | 2026-07-17 | 6 / 9337 | 5 / 5556 | **1** | datacore,docs | feat(solver): WO-CEO-Q7 supply_demand_gap_attribution 供需失衡双向归因 |
| 103 | `handoff-wo-76` | `c0a1bcda` | 2026-08-03 | 5 / 9307 | 3 / 5934 | **0** ⚠️ | datacore,frontend,docs,root,scripts | fix(boundary): WO-76 复活「被制度指定的死门」—— boundary-singlesource 自身红了 24 个 commit 且零接线 |
| 104 | `handoff-wo-65-metrics` | `ef5e9fc8` | 2026-08-07 | 12 / 9246 | 10 / 5942 | **8** | agentcore,datacore,docs | docs(code): 把「假修」那条注释改成实测原文（两种坏法各是什么） |
| 105 | `handoff-ontology-context-a` | `1309f2e0` | 2026-07-24 | 5 / 9178 | 4 / 5610 | **0** ⚠️ | datacore,docs | feat(ontology): WO-ONTOLOGY-CONTEXT-A · A 侧消费 type-semantics 口径单一真值（闭「A 侧 unit inert」缺口③… |
| 106 | `handoff-optwhatif-nl-wiring` | `d00ae58f` | 2026-07-27 | 9 / 9170 | 8 / 5739 | **0** ⚠️ | agentcore,datacore,docs | feat(qos): optimize_whatif 接入人机对话（NL→CP-SAT 重解·闭 G-WHATIF-NL-UNREACHABLE） |
| 107 | `handoff-causal-deepchain` | `a14dea7e` | 2026-07-18 | 5 / 9088 | 4 / 5319 | **1** | datacore,docs | feat(causal): WO-CAUSAL-DOMAIN-DEEPCHAIN OEE 因果深链 + 多种子 BFS（补利用率瓶颈下钻断头） |
| 108 | `handoff-wo-gsim-data` | `130e3576` | 2026-07-23 | 3 / 9040 | 2 / 5419 | **0** ⚠️ | datacore,docs | feat(gsim-data): 全局推演源数据补齐——距离派生在途+运费+供芯图+线级可读（WO-GSIM-1-DATA） |
| 109 | `handoff-jobshop-schedule` | `c393a707` | 2026-07-19 | 7 / 9035 | 5 / 4827 | **1** | datacore,docs,root | feat(jobshop-schedule): CP-SAT 工序小时级排程 solver（IntervalVar 可证最优·Phase4） |
| 110 | `handoff-wo-loop-control-p1` | `25058226` | 2026-07-26 | 10 / 8953 | 6 / 2465 | **1** | agentcore,docs,root,scripts | WO-LOOP-CONTROL-P1: Loop Detector 环检测（补「成功但空转」最后一个洞）+ loop-control:check 门 |
| 111 | `handoff-wo-gate-rc2` | `7e586445` | 2026-08-11 | 58 / 8897 | 58 / 8897 | **1** | scripts | wip: 额度用尽被叫停瞬间的现场 —— 未完成·未验证，仅为防丢落盘。接手前必须从头补齐双向变异反证。 |
| 112 | `handoff-q7-reconciled` | `855e6708` | 2026-07-18 | 3 / 8813 | 2 / 5041 | **0** ⚠️ | datacore,docs | fix(q7): WO-Q7-RECONCILED-ROBUST 端内勾稽末叶取余额分摊·reconciled 恒精确 |
| 113 | `handoff-wo-leadtime-split` | `ee6a5800` | 2026-08-10 | 13 / 8751 | 12 / 8489 | **5** | datacore,frontend,docs,contracts | WO-LEADTIME-SPLIT 交付说明：混算取证 / 改前改后 / 双断言实测 / M1+M2 变异反证 / 本体回写清单 |
| 114 | `handoff-wo-memsim-optimizer` | `4f3b051d` | 2026-07-22 | 5 / 8728 | 4 / 5064 | **0** ⚠️ | datacore,docs | feat(solvers): 内存模式确定性优化兜底 InProcOptimizerClient（portfolio 无 sidecar 真出可行解·闭「内存态静默」） |
| 115 | `handoff-wo-d1-cancel` | `a1b7066f` | 2026-08-03 | 7 / 8706 | 7 / 8706 | **0** ⚠️ | agentcore,datacore | fix(solver-cancel): 超时/断开真取消底层求解 —— Promise.race 只是不再等它，不是取消它 |
| 116 | `handoff-a3-refbase` | `6fd5189e` | 2026-07-17 | 3 / 8690 | 2 / 4910 | **0** ⚠️ | datacore,docs | WO-A3-REFBASE: 14-domain reference ontology baseline (95 nodes, meta-tenant R2, battery … |
| 117 | `handoff-a3-refbase-wip` | `6fd5189e` | 2026-07-17 | 3 / 8690 | 2 / 4910 | **0** ⚠️ | datacore,docs | WO-A3-REFBASE: 14-domain reference ontology baseline (95 nodes, meta-tenant R2, battery … |
| 118 | `handoff-wo-gsim-solver` | `3e0654b7` | 2026-07-23 | 7 / 8668 | 6 / 5046 | **1** | datacore,docs,contracts | feat(gsim): WO-GSIM-2-SOLVER 全域联合仿真求解器（7 特性·跨数据/引擎两半·一人整单） |
| 119 | `handoff-learning-loop` | `91a75ba7` | 2026-07-19 | 4 / 8587 | 3 / 4819 | **1** | datacore,docs | feat(learning-loop): Decision 成效反馈闭环（COMMITTED→REALIZED·实测效果%→学习权重） |
| 120 | `handoff-wo-chain-24` | `dcefb5fd` | 2026-08-07 | 11 / 8583 | 9 / 6818 | **0** ⚠️ | datacore,frontend,docs,contracts | WO-CHAIN-24 ③ PRD 补变异反证与门禁诚实边界 |
| 121 | `handoff-ext-signal-detail-be` | `4d5595f8` | 2026-07-18 | 2 / 8577 | 1 / 4808 | **0** ⚠️ | datacore,docs | feat(ext-signal): WO-EXT-SIGNAL-DETAIL CI-b 外部信号→溯源闭环端点(后端半) |
| 122 | `handoff-tier2-semantic-discover` | `dc024133` | 2026-07-20 | 8 / 8423 | 5 / 1482 | **1** | agentcore,datacore,docs,contracts | fix: update resource-descriptor baseline count 22→36 |
| 123 | `handoff-wo-dril-p3` | `56ec110b` | 2026-07-25 | 18 / 8377 | 15 / 2146 | **0** ⚠️ | agentcore,docs,root,contracts,scripts | WO-DRIL-P3 · 图遍历 graphDistance(复用 planSlice BFS) + 运行时质量分 EWMA |
| 124 | `handoff-edge-wire-seam-recheck` | `0743036f` | 2026-09-18 | 54 / 8254 | 12 / 2582 | **32** | datacore,evidence,contracts | evidence(edge-wire-recheck): 收尾自证——窗口全程独占、本单零残留（判据落在 cwd+cmdline+起始时刻） |
| 125 | `handoff-wo-befe-seam-field` | `763c0d1b` | 2026-08-11 | 6 / 8234 | 4 / 4972 | **5** | docs,root,scripts | feat(gates): solver-field-seam 自曝「单一来源自己不穷尽」这处盲区（+catchall 探测金丝雀） |
| 126 | `handoff-wo-gate-selftest` | `2083bf9a` | 2026-08-11 | 7 / 8203 | 5 / 4942 | **3** | docs,root,scripts | chore(gate): mock-fidelity 接进 gates 链 + 门账 + 本体 §7/§8 回写；订正 crossbranch 门账的假记录 |
| 127 | `handoff-wo-sandbox-prop-direction` | `4aabd4bc` | 2026-08-11 | 4 / 8190 | 3 / 4975 | **3** | datacore,frontend,docs | docs(ontology): 回写传导方向硬约束 + 新登记断点 G-PROP-DIRECTION-SILENT-DEAD（闭 #158/#160） |
| 128 | `handoff-gate-ledger` | `a212e100` | 2026-08-04 | 8 / 8120 | 4 / 2740 | **1** | docs,root,scripts | feat(gate): 门账 gate-ledger —— 把 40 道门从「有脚本」变成「有人跑、红过、可追责」 |
| 129 | `handoff-wo-u8-occlusion-grid` | `1415ea0a` | 2026-08-18 | 9 / 8071 | 4 / 5583 | **5** | docs,root,scripts | WO-U8-OCCLUSION-GRID: HANDOFF 六段（diff 结论四维度 · 金丝雀九向 · 变异两遍 · 全量 12 页 RC=0） |
| 130 | `handoff-wo-sandbox-candidates-fe` | `d6d4d550` | 2026-08-11 | 7 / 7905 | 6 / 4738 | **7** | frontend,docs | WO-SANDBOX-CANDIDATES-FE ⑦ stale-claims 门报红：4 处「自称实测」补日期+出处+复验，并改掉一处错引 |
| 131 | `handoff-wo-gate-b-browser-harness` | `f209c6cf` | 2026-08-18 | 8 / 7815 | 4 / 5429 | **3** | docs,root,scripts | WO-GATE-B-BROWSER-HARNESS: 第二轮迭代收口（回显三态归因 + §4.2.3 遮挡欠账对账 + 金丝雀八向）+ 接手收尾 |
| 132 | `handoff-capacity-infer` | `127ef840` | 2026-07-20 | 3 / 7727 | 2 / 4033 | **1** | datacore,docs | chore(ontology): un-backtick step.completed(§4/§8)——消 canonical 预存假漂移(同 handoff-ontology… |
| 133 | `handoff-block-dialogue` | `9153cd95` | 2026-07-18 | 8 / 7640 | 7 / 3871 | **0** ⚠️ | agentcore,frontend,docs,contracts | feat(block-dialogue): 人机对话升到块级——点块就地深问·真实数据推给 agent 按 blockType 定向路由(闭 G-3 块级) |
| 134 | `handoff-wo-loop-control-p2` | `48524830` | 2026-07-27 | 11 / 7502 | 10 / 4062 | **0** ⚠️ | agentcore,datacore,docs,scripts | WO-LOOP-CONTROL-P2: Agent 执行治理层升级阶梯（Retry Manager 瞬时/确定性分流 + per-tool cap + Escalation L… |
| 135 | `handoff-wo-cockpit-wiring` | `33b7c818` | 2026-07-28 | 4 / 7492 | 4 / 7492 | **0** ⚠️ | datacore,frontend | feat(cockpit): 经营指标→根因下钻 per-metric 联动（达成/未达成皆可）+ 面板重命名 |
| 136 | `handoff-qos-agent-speed` | `09a442d7` | 2026-07-21 | 9 / 7470 | 8 / 3798 | **2** | agentcore,docs | feat(agentcore/qos): NavigationSlice 注入 + 规划式执行 — 闭 G-AGENT-BLIND-REACT agent 侧半 (WO-QOS… |
| 137 | `handoff-wo-decision-info` | `b06f582f` | 2026-08-05 | 10 / 7465 | 9 / 4168 | **2** | datacore,docs,contracts | docs(ontology): 回写决策信息三块链 L-DEC-INFO（铁律0：改了链路必回写本体） |
| 138 | `handoff-wo-impact-propagation` | `a259c746` | 2026-08-10 | 5 / 7425 | 4 / 4236 | **0** ⚠️ | datacore,docs,contracts | docs(WO-IMPACT-PROPAGATION): 亲手真跑取证 + 变异反证 + 本体 §3 回写 |
| 139 | `handoff-mock-stubs` | `2e4b2bde` | 2026-07-19 | 3 / 7419 | 3 / 7419 | **0** ⚠️ | frontend | feat(frontend-mock): VITE_MOCK 桩让 mock/demo 态也能看到决策推演页 + 供需失衡双向归因 panel |
| 140 | `handoff-decision-kernel-wire` | `9bc19f43` | 2026-07-18 | 7 / 7358 | 6 / 3589 | **1** | agentcore,datacore,docs | feat(decision-wire): CEO 深问出方案→据意图经 L2 内核成一等 Decision |
| 141 | `handoff-sales-ring` | `ceb6c9ff` | 2026-09-17 | 51 / 7331 | 13 / 2729 | **28** | datacore,evidence,contracts | chore: 删除临时探针 _probe-sales-ring.test.ts |
| 142 | `handoff-wo-slice-required-args` | `a7f3dcca` | 2026-08-19 | 8 / 7238 | 7 / 5153 | **1** | datacore,frontend,docs | feat(WO-SLICE-REQUIRED-ARGS): 切片摘要投影加性下发 requiredArgs + 列表页「需参数」徽标 |
| 143 | `handoff-wo-qos-cross-domain-unified-v2` | `f7adf509` | 2026-07-26 | 12 / 7227 | 11 / 3773 | **1** | agentcore,datacore,docs,contracts | WO-QOS-CROSS-DOMAIN-UNIFIED：跨域编排统一（②确定性多路+⑤多意图兜底+Coordinator降级） |
| 144 | `handoff-counterfactual-basesel` | `96cd0757` | 2026-07-18 | 3 / 7206 | 3 / 7206 | **0** ⚠️ | frontend | feat(cockpit): 反事实双轨推演加基地选择器（WO-C） |
| 145 | `handoff-wo-org-world` | `972e1418` | 2026-08-10 | 13 / 7176 | 12 / 7172 | **5** | datacore,docs,contracts | WO-ORG-WORLD 交付说明：盘点/种子/接缝形状/四判据实测/变异反证/#139 规避/本体回写清单 |
| 146 | `handoff-wo-mock-fe-registry-parity` | `9e64711e` | 2026-08-18 | 16 / 7160 | 13 / 4532 | **9** | agentcore,frontend,docs | docs(handoff): 修单纪要——换基核验 + 四件逐项 + 变异/终跑证据 |
| 147 | `handoff-wo-doctrine-writeback` | `6d7500b9` | 2026-08-18 | 5 / 7152 | 2 / 4096 | **4** | root,docs,scripts | 复验退单 F1/F2 一字修：factlock 金丝雀 12 条非 13、G-* 断点计数 3 次非 2 次 |
| 148 | `handoff-wo-multi-intent-p1` | `f4fa91b6` | 2026-07-26 | 12 / 7151 | 11 / 3673 | **1** | agentcore,datacore,docs,contracts | feat(qos): 跨域/多意图并行编排 L1 独立多意图（WO-MULTI-INTENT-P1·暗发） |
| 149 | `handoff-merge-to-canonical` | `0df3a17a` | 2026-09-06 | 48 / 7143 | 45 / 5782 | **3** | root,agentcore,datacore,frontend,docs,contracts,scripts | fix(test): 收编引入的红 —— 因果图 DECISION 缺口断言跟着 R-UI-4 改名一起改 |
| 150 | `handoff-generic-whatif` | `630e3ec7` | 2026-07-19 | 5 / 7134 | 5 / 7134 | **1** | frontend | feat(frontend): 通用假设推演页 generic_inference 接线（G-5 通用 what-if·CEO「改属性看下游」） |
| 151 | `handoff-tier3-agent-timeout-fallback` | `f376836f` | 2026-07-19 | 10 / 7097 | 9 / 3398 | **1** | agentcore,docs,packages-other | feat(tier3-agent-timeout): path-B agent 有界超时+优雅降级（部分发现+降级事件·诚实） |
| 152 | `handoff-wo-multiintent-l2` | `37003a41` | 2026-07-26 | 16 / 7078 | 15 / 3608 | **3** | agentcore,datacore,docs,contracts | feat(qos): L2 真分解——LLM 产 solver 计划·确定性校验·接共享后半（PRD-multi-intent-L2L3 P1） |
| 153 | `handoff-wo-sandbox-a2` | `05588622` | 2026-08-08 | 5 / 7076 | 4 / 3809 | **1** | datacore,docs,scripts | WO-SANDBOX-A2: 补第三条变异反证（静态门 × 运行态测试双角度同红） |
| 154 | `handoff-wo-decision-info-fe` | `19e9db0d` | 2026-08-07 | 8 / 7044 | 8 / 7044 | **2** | frontend | test+mock(WO-DECISION-INFO-FE): 决策三块 mock 口径照抄真后端 + 14 条链路红咬 |
| 155 | `handoff-wo-decision-info-oncanonical` | `54e299cc` | 2026-08-07 | 8 / 7044 | 8 / 7044 | **2** | frontend | test+mock(WO-DECISION-INFO-FE): 决策三块 mock 口径照抄真后端 + 14 条链路红咬 |
| 156 | `handoff-wo-multiintent-l3` | `63079591` | 2026-07-26 | 17 / 7022 | 16 / 3558 | **4** | agentcore,datacore,docs,contracts | feat(qos): L3 耦合联合求解——耦合链映射一次 portfolio 守恒解·真传导（PRD-multi-intent-L2L3 P2） |
| 157 | `handoff-wo-approval-policy` | `6c40efed` | 2026-08-10 | 11 / 6986 | 10 / 6662 | **5** | datacore,docs,contracts | docs: 订正路由条数 9→10（实测 grep -c = 10） |
| 158 | `handoff-wo-coverage-blind` | `fe93efbb` | 2026-08-11 | 5 / 6926 | 3 / 3665 | **2** | docs,root,scripts | feat(gate): 覆盖率盲区门接线 + 棘轮建账 217 条 + 本体回写 §7/§8 |
| 159 | `handoff-wo-82-peak-crossday` | `01f8b799` | 2026-08-07 | 6 / 6893 | 4 / 3626 | **4** | datacore,docs,scripts | docs(datacore): 两处 withAdoptions 注释去掉写死的"两个求解器"（#82 起集合已含 affected_orders） |
| 160 | `handoff-wo-decision-info-frontend2` | `8e77af09` | 2026-08-07 | 8 / 6746 | 7 / 3489 | **8** | frontend,docs | docs(ontology): 回归证据改写为实测三段（争用超时 ≠ 回归，但也不许当绿用） |
| 161 | `handoff-tier3-agent-timeout-fallback-v2` | `7d7e2fc7` | 2026-07-19 | 10 / 6690 | 9 / 2991 | **0** ⚠️ | agentcore,docs,packages-other | feat(agentcore): path-B agent 工具循环有界超时 + 优雅降级（闭 G-9 空转/挂住·path-B 侧） |
| 162 | `handoff-fix-frontend-fabricate` | `2a46626b` | 2026-08-06 | 7 / 6616 | 7 / 6616 | **1** | frontend | autosave(claude/handoff-fix-frontend-fabricate): 08-06 05:43:43 容器重启防丢快照 |
| 163 | `handoff-cleanroom-attr` | `f39d6097` | 2026-07-19 | 4 / 6614 | 4 / 6614 | **1** | frontend | feat(frontend): 净室归因投影页——三通用求解器首次前端接地 |
| 164 | `handoff-wo-prd-grounding-gate` | `9ecd52ea` | 2026-08-11 | 5 / 6589 | 3 / 3329 | **4** | docs,root,scripts | WO-PRD-GROUNDING-GATE: 门账补 M3/M4 变异证据 + 判义边界 + seed.ts 责任路径 |
| 165 | `handoff-onto-writeback-p1` | `e17385d0` | 2026-08-10 | 5 / 6565 | 3 / 3332 | **2** | docs,root,scripts | feat(gate): dark-launch:check —— 守「写了 defaultOn:false 就以为暗发了」（0.6 二级处置） |
| 166 | `handoff-wo-phase4-fallback` | `04daa3ae` | 2026-07-23 | 10 / 6530 | 9 / 2921 | **1** | agentcore,datacore,docs,contracts | feat(qos): WO-Phase4 · ReAct Fallback 硬预算 + 超时诚实降级 + dark feature 锁默认关 |
| 167 | `handoff-wo-impediment-fe` | `5f1db104` | 2026-08-07 | 9 / 6417 | 9 / 6417 | **0** ⚠️ | frontend | fix(impediment-fe): 亲手看页面文本发现的两处真缺陷（WO-IMPEDIMENT-FE 第 3 单元） |
| 168 | `handoff-wo-qos-cross-domain-unified-graw0b` | `f0c7df24` | 2026-07-26 | 14 / 6411 | 13 / 2946 | **2** | agentcore,datacore,docs,contracts | feat(qos): 跨域编排统一——② 先于 Coordinator + ⑤ 多意图兜底共享确定性后半（WO-QOS-CROSS-DOMAIN-UNIFIED） |
| 169 | `handoff-wo-cap-demanddelta` | `53f82bcb` | 2026-07-28 | 11 / 6242 | 10 / 2783 | **2** | agentcore,datacore,docs,contracts | fix(capacity): clamp non-batch/whatIf gap to ≥0 and align ok predicate\n\n- gap = round(… |
| 170 | `handoff-wo-fix-dark-launch-gate` | `97ad5dc2` | 2026-08-10 | 5 / 6182 | 3 / 2953 | **3** | docs,root,scripts | docs(ontology)+chore(ledger): 回写 dark-launch:check 的新判据（铁律 0 要求） |
| 171 | `handoff-capacity-infer-process` | `746ffc79` | 2026-07-18 | 3 / 6148 | 2 / 2375 | **1** | frontend,docs | feat(frontend): WO-CAPACITY-INFER-PROCESS 产能看板「推演过程」可见——CI-a 基地根因推演树 + CI-b 方案比对推演链 |
| 172 | `handoff-ceo6` | `873eebc1` | 2026-07-17 | 4 / 6140 | 3 / 2357 | **1** | agentcore,docs | feat(agentcore): WO-CEO-6 CEO agent（确定性·无 LLM）+ PageContext 深问兜底路由 + C1/C5/C7 测试 + 本体回写 |
| 173 | `handoff-wo-ratchet-conservation-sweep` | `bcce72f0` | 2026-08-19 | 28 / 6125 | 25 / 3827 | **15** | docs,scripts | WO-RATCHET-CONSERVATION-SWEEP: HANDOFF + 本体 §8 G-RATCHET-NEWFILE-BLIND 回写 |
| 174 | `handoff-diag-100q` | `55636f5d` | 2026-07-19 | 6 / 6075 | 0 / 0 | **1** | docs,root | WO-DIAG-100Q: 28 题真测台账+原始数据+脚本 |
| 175 | `handoff-wo-sandbox-d3` | `10b1cf57` | 2026-08-05 | 5 / 6009 | 5 / 6009 | **1** | datacore,contracts | feat(sandbox-D3): 工序硬容量对象 —— 化成柜位真进瓶颈判定（WO-SANDBOX-D3·数据半×引擎半 SEAM） |
| 176 | `handoff-wo-agent-runtime-s01` | `01fd9fe7` | 2026-07-25 | 6 / 6002 | 5 / 2520 | **0** ⚠️ | agentcore,docs | WO-AGENT-RUNTIME-S01: 变体继承意图+槽位抽取+compose识别feasibility+Coordinator直路+loop停滞早停+工具schema+D… |
| 177 | `handoff-wo-base-id-fidelity` | `36f7e6ab` | 2026-07-28 | 8 / 5875 | 7 / 2469 | **0** ⚠️ | agentcore,datacore,docs,scripts | fix(base-id-fidelity): base 标识跨接缝保真两症 + 规范化单一出处 + 门扩 |
| 178 | `handoff-capacity-timeline` | `3eaa87df` | 2026-07-17 | 2 / 5801 | 1 / 2022 | **1** | frontend,docs | feat(frontend): WO-CAPACITY-TIMELINE CT-a 订单交付 icon（⑤·同源真数据）+ CT-b 诚实灰披露 |
| 179 | `handoff-wo-sandbox-e1` | `32371d04` | 2026-08-05 | 8 / 5793 | 8 / 5793 | **0** ⚠️ | datacore,contracts | feat(datacore): WO-SANDBOX-E1 chain_loss_attribution 环节级损失归因（口径走 S0 冻结契约·Σ非增值 pct==100%·… |
| 180 | `handoff-wo-decision-info-frontend` | `18f10d40` | 2026-08-06 | 6 / 5792 | 5 / 2535 | **5** | frontend,docs | autosave(claude/handoff-wo-decision-info-frontend): 08-06 16:50:15 容器重启防丢快照 |
| 181 | `handoff-desat3` | `f072c8dc` | 2026-09-16 | 39 / 5787 | 12 / 2737 | **10** | datacore,evidence,contracts | WIP·未验 sim-propagation-direction 三处金值改从规则表/trace 现算 |
| 182 | `handoff-wo-live-endpoints` | `cdbcb6aa` | 2026-08-06 | 4 / 5635 | 4 / 5635 | **1** | agentcore,datacore | autosave(claude/handoff-wo-live-endpoints): 08-06 05:43:43 容器重启防丢快照 |
| 183 | `handoff-wo-phase2-c` | `7c07b9f3` | 2026-07-23 | 10 / 5564 | 9 / 1913 | **2** | agentcore,datacore,docs,contracts | feat(qos): WO-Phase2-C-COMPLETE 组合路径「能用半」· executePlan 服务端多步 + 一次综合 + orchestrator 挂点（暗发… |
| 184 | `handoff-wo-det-cross-domain` | `01583167` | 2026-07-26 | 11 / 5562 | 10 / 2106 | **1** | agentcore,datacore,docs,contracts | feat(qos): 确定性跨域分路（把跨域题留在确定性层·零 LLM 拉回 path-A） |
| 185 | `handoff-qos-det-gate` | `e1c3b48c` | 2026-07-21 | 4 / 5497 | 3 / 1817 | **1** | agentcore,docs | feat(agentcore/qos): 确定性优先门 — 有对口 solver 的题在 path-B 入口前拉回 path-A (WO-QOS-1) |
| 186 | `handoff-wo-79` | `6dd0b0c0` | 2026-08-03 | 7 / 5403 | 7 / 5403 | **0** ⚠️ | frontend | fix(test-harness): 残留句柄守卫 —— 没复现出那一红，但把「靠运气的绿」换成会红的断言（WO-79） |
| 187 | `handoff-wo-qos-cross-domain-unified` | `aff51b55` | 2026-07-26 | 12 / 5361 | 11 / 1920 | **2** | agentcore,datacore,docs,contracts | fix(qos): 收口 tweak — MAX_DOMAINS 4→5 让头号例 Q2 全 5 域入选（不丢"外协还是加班"） |
| 188 | `handoff-wo-gsim-agent` | `6949be30` | 2026-07-24 | 4 / 5346 | 3 / 1783 | **0** ⚠️ | agentcore,docs | feat(qos): WO-GSIM-4-AGENT §3.2 多方案叙述 + §3.3 自由追问边界（对 global-sim.ts 契约·rebase 接真） |
| 189 | `handoff-wo-slice-governance` | `926f883f` | 2026-08-06 | 2 / 5258 | 2 / 5258 | **1** | datacore | autosave(claude/handoff-wo-slice-governance): 08-06 05:43:43 容器重启防丢快照 |
| 190 | `handoff-wo-0-nl-wiring` | `b5e53261` | 2026-07-25 | 3 / 5185 | 2 / 1668 | **2** | agentcore,docs | fix(qos): WO-0-NL-WIRING 补 SEAM 门残口——path-B 无可用 LLM 转诚实降级（非 raw INTERNAL_ERROR） |
| 191 | `handoff-wo-gui4-multiobj-real` | `330a6ecd` | 2026-07-25 | 6 / 5177 | 5 / 1689 | **1** | frontend,docs | WO-GUI4-MULTIOBJ-REAL: 多目标面板接真订单簿 + real-orderbook SEAM |
| 192 | `handoff-wo-sandbox-s3` | `a44c6002` | 2026-08-08 | 6 / 5081 | 6 / 5081 | **0** ⚠️ | datacore,contracts | WO-SANDBOX-S3 ② 枚举器：阻滞点 → N 个候选（join + 档位 + 逐候选真试算） |
| 193 | `handoff-wo-graph-fanout-salvage-audit` | `3b32dbb3` | 2026-08-20 | 15 / 5052 | 11 / 2800 | **7** | agentcore,docs,root,contracts,scripts | docs(audit): graph-fanout 收编抢救对账（WO-GRAPH-FANOUT-W2 × verify-reclaim-6 线尖） |
| 194 | `handoff-wo-graph-fanout-w2` | `9e2504e0` | 2026-08-20 | 14 / 4941 | 11 / 2800 | **6** | agentcore,docs,root,contracts,scripts | docs(handoff): WO-GRAPH-FANOUT-W2 交接文档 (单元6) |
| 195 | `handoff-wo-synth-validation-lite` | `b54691e6` | 2026-07-23 | 4 / 4923 | 3 / 1263 | **0** ⚠️ | datacore,docs,contracts | perf(datacore): 合成 VALIDATION_LITE 剖面 + VLE determinismCheck 走 LITE + cloneTenant |
| 196 | `handoff-wo-flaky-timer` | `63f13f0f` | 2026-08-07 | 6 / 4771 | 5 / 1513 | **4** | frontend,docs | docs(ontology/#120): 登记「假时钟纪律」—— 把这次的取证写进本体，别让下一个人重走 |
| 197 | `handoff-wo-metrics-authz` | `51d05f9d` | 2026-08-11 | 9 / 4750 | 7 / 4700 | **0** ⚠️ | root,agentcore,datacore | 清除测试文件里的裸 NUL 字节（git 曾把该文件判为 binary） |
| 198 | `handoff-wo-graph-desc-contract` | `fd88703b` | 2026-08-11 | 8 / 4732 | 7 / 1515 | **2** | datacore,frontend,docs,contracts | fix(graph): 闭 G-GRAPH-ENTRY-DUP —— 「本体图谱」与「图谱·全景」渲染输出完全相同 |
| 199 | `handoff-wo-loop-control-p2p5` | `4510a8b6` | 2026-07-27 | 6 / 4688 | 5 / 1249 | **1** | agentcore,docs,scripts | WO-LOOP-CONTROL-P2.5: 收口升级阶梯 rung②（orchestrator 层停滞反应式重路由到 Coordinator） |
| 200 | `handoff-wo-slice-discovery` | `17e1e05f` | 2026-08-10 | 11 / 4671 | 10 / 1453 | **3** | agentcore,datacore,docs,contracts | WO-SLICE-DISCOVERY: 记账 CatalogClientItem 跨分支同名收敛 + 重造门自己瞎了 |
| 201 | `handoff-wo-imp2plan` | `d042531a` | 2026-08-08 | 5 / 4661 | 5 / 4661 | **0** ⚠️ | frontend | WO-SANDBOX-IMP2PLAN: imp2plan 接缝门（真导航 + 病因文案 + 诚实位随行 + S3 绊线） |
| 202 | `handoff-tier2-semantic-discover-v2` | `1ad50738` | 2026-07-19 | 7 / 4653 | 6 / 953 | **1** | agentcore,datacore,docs | feat(tier2-discover): B/C 决策域求解器语义可发现 + ceo-route B/C 意图直绑（闭 G-SEMANTIC-DISCOVER） |
| 203 | `handoff-role-fallback` | `f851d78e` | 2026-07-21 | 4 / 4574 | 3 / 890 | **0** ⚠️ | agentcore,docs | fix(seed): 种子 agent LLM 模型去 11 处硬编 claude-opus-4-8 → 单一配置源 SEED_AGENT_MODEL(env DEFAULT_… |
| 204 | `handoff-wo-resource-catalog-ontology` | `146489b6` | 2026-08-01 | 11 / 4555 | 9 / 1118 | **2** | agentcore,docs,root,contracts,scripts | fix(wo-resource-catalog-ontology): 复审 F1-F4 修复——守卫同源 + R6 排序 + 漏型 warn + 注释归真 |
| 205 | `handoff-wo-decision-graph` | `c931742e` | 2026-08-10 | 6 / 4551 | 5 / 4528 | **5** | datacore,docs,contracts | WO-DECISION-GRAPH · 交付说明 + 清掉源码里一个字面 NUL 字节 |
| 206 | `handoff-wo-computed-edge-impl` | `063137a8` | 2026-09-07 | 10 / 4475 | 8 / 3371 | **0** ⚠️ | agentcore,datacore,docs | 回退两份门产物索引的 generatedAt 日期噪声（本单没有改 PRD，那两处 diff 只是我跑门时刷的日期） |
| 207 | `handoff-resource-descriptor` | `2d2bc735` | 2026-07-19 | 7 / 4321 | 5 / 483 | **1** | datacore,docs,root,contracts,scripts | feat(resource-descriptor): 统一资源描述契约 + 发现门（全5池 description 覆盖·additive） |
| 208 | `handoff-wo-dril-precision` | `7b255aad` | 2026-07-25 | 6 / 4279 | 5 / 797 | **0** ⚠️ | agentcore,datacore,docs,scripts | WO-DRIL-PRECISION: solver 灌 NL 样例问句 answersQuestions·对口归因 solver 进 top-3 |
| 209 | `handoff-wo-slice-connectivity` | `bd7968d6` | 2026-07-23 | 4 / 4229 | 1 / 30 | **0** ⚠️ | docs,root,scripts | feat(ontology): WO-SLICE-CONNECTIVITY 切片连通性门禁 + auditSliceConnectivity |
| 210 | `handoff-wo-sim-checkpoints` | `32f817d8` | 2026-08-11 | 3 / 4064 | 2 / 4023 | **3** | datacore,docs | test(datacore): 把 ② 的注释改成变异反证实测原文（[2,8,2]），免得注释与证据不符 |
| 211 | `handoff-wo-80` | `a8df2830` | 2026-08-03 | 4 / 4060 | 2 / 686 | **1** | docs,root,scripts | feat(ontology-anchors): 锚点校准门 —— 「需校准」第一次真有机制去执行（欠账 #80） |
| 212 | `handoff-tier3-metric-rollup-split` | `c9f05a93` | 2026-07-19 | 2 / 4058 | 1 / 359 | **0** ⚠️ | agentcore,docs | 收窄 metric_rollup 路由边界（WO-TIER3-METRIC-ROLLUP-SPLIT·闭 G-3 深问侧） |
| 213 | `handoff-wo-hover-layer` | `0691a55a` | 2026-08-11 | 17 / 3955 | 17 / 3955 | **5** | frontend | WO-HOVER-LAYER ⑤：口径出 title= 进 InfoPopover ×3 + 棘轮门（规范 §6 自己要求的那道门） |
| 214 | `handoff-wo-datacore-lazy-context` | `f223f39d` | 2026-07-26 | 3 / 3895 | 3 / 3895 | **0** ⚠️ | datacore | perf(datacore): SolverContext 按需加载 — solver 声明 requiredObjectTypes → 裁剪核心表全扫 (WO-DATACOR… |
| 215 | `handoff-wo-82` | `c971b976` | 2026-08-03 | 3 / 3889 | 3 / 3889 | **1** | datacore | fix(datacore): #82 风险峰值/越线日单一出处 —— 订单全链聚合改为 risk_timeline 的派生投影 |
| 216 | `handoff-wo-d2d3-diag` | `b409a2ce` | 2026-08-03 | 5 / 3771 | 5 / 3771 | **0** ⚠️ | agentcore,datacore,contracts | test(D3): 补硬「耗时是真测的」判据 —— 变异反证曾从这里漏过去 |
| 217 | `handoff-wo-derivspec-seed` | `19fb8d9c` | 2026-08-20 | 6 / 3749 | 4 / 1595 | **2** | datacore,docs | docs(datacore): WO-DERIVSPEC-SEED HANDOFF（取证清单/选路why/对账+变异+回归证据） |
| 218 | `handoff-merge-batch-2` | `e95b0f3e` | 2026-09-06 | 20 / 3708 | 18 / 2340 | **1** | agentcore,datacore,frontend,docs,scripts | merge-batch-2 修合并引入的红（不新增功能，只补注册与金值） |
| 219 | `handoff-ontology-drift-fix` | `dbac7845` | 2026-07-20 | 1 / 3695 | 0 / 0 | **0** ⚠️ | docs | fix(ontology): 去 step.completed 反引号伪声明(§4/§8)——SSE 进度事件非订阅事件·消 check-system-ontology 假漂移 |
| 220 | `handoff-wo-nl-robust` | `fd01770a` | 2026-08-06 | 2 / 3624 | 1 / 102 | **2** | agentcore,docs | autosave(claude/handoff-wo-nl-robust): 08-06 05:43:43 容器重启防丢快照 |
| 221 | `handoff-wo-prompt-defaults-wiring` | `9a410293` | 2026-07-25 | 6 / 3547 | 6 / 3547 | **0** ⚠️ | agentcore | feat(agentcore): 消费 DataCore 可配提示词模板 — classifier 先读 A·失败兜底硬编码（消漂移·WO-PROMPT-DEFAULTS-WI… |
| 222 | `handoff-wo-sandbox-e2` | `4ebca282` | 2026-08-05 | 4 / 3540 | 4 / 3540 | **1** | datacore | feat(datacore): WO-SANDBOX-E2 业务线 scope 入口 —— 扩挂载点到 affected_orders/order_fullchain/atp_… |
| 223 | `handoff-wo-mockdc-params` | `ff227410` | 2026-08-17 | 8 / 3524 | 7 / 1229 | **5** | agentcore,docs | fix(mocks): epoch 客户端从对象字面量转类（消掉形参门的盲区，而不是在盲区里放正确答案） |
| 224 | `handoff-wo-e2e-dialogue-acceptance` | `a05e52d9` | 2026-07-25 | 2 / 3520 | 1 / 8 | **1** | agentcore,docs | test(e2e): 全链对话验收门 capstone — S1~S7 接缝串真问句（诚实绿·非假绿·WO-E2E-DIALOGUE-ACCEPTANCE) |
| 225 | `handoff-wo-databuilder-harness` | `379a2039` | 2026-07-25 | 1 / 3511 | 0 / 0 | **0** ⚠️ | docs | feat(growth): 数据构建引擎升级为诊断+补齐 harness — NO_INTENT 自补 + EMPTY_DATA 时序接地 (WO-DATABUILDER-HA… |
| 226 | `handoff-wo-sandbox-g1` | `712e93f2` | 2026-08-07 | 8 / 3495 | 7 / 235 | **4** | datacore,docs,scripts | docs(本体): §8 登记两条新断点（诚实缺席声明过期 / 互斥裁决结构性不可达）+ §7 登记 G1 收口总门 |
| 227 | `handoff-wo-procurement-frontend` | `5c95027e` | 2026-08-06 | 6 / 3443 | 5 / 188 | **1** | frontend,docs | feat(WO-PROCUREMENT-FRONTEND): 采购四段腿分解接前端消费方（闭 G-PROCUREMENT-OPAQUE 前端半） |
| 228 | `handoff-wo-dril-p1` | `421018ee` | 2026-07-25 | 15 / 3350 | 14 / 3282 | **0** ⚠️ | agentcore,root,contracts,scripts | WO-DRIL-P1 · 契约 + Resource Registry 地基（一次发现全量资源） |
| 229 | `handoff-wo-publish-refprobe` | `ea86916e` | 2026-08-17 | 11 / 3327 | 9 / 903 | **5** | agentcore,docs | WO-PUBLISH-REFPROBE ⑤ 校准本单造成的唯一一条锚点漂移 |
| 230 | `handoff-wo-prov-drillfield` | `3840dd44` | 2026-08-04 | 2 / 3313 | 2 / 3313 | **0** ⚠️ | datacore | fix(datacore): gap_attribution provenance 口径错标 —— drillField 说 Order.value，drillValue 却回… |
| 231 | `handoff-wo-entitlement-action-server-gate` | `3420b193` | 2026-08-19 | 3 / 3281 | 3 / 3281 | **1** | datacore | feat(entitlement): ACTION 级功能服务端补闸 —— 关闭即 404 FEATURE_NOT_FOUND（先于 authz） |
| 232 | `handoff-w9-windowdays` | `c0226b41` | 2026-07-25 | 3 / 3254 | 3 / 3254 | **0** ⚠️ | frontend | W9: windowDays 正口径 + UI 大白话（agent 产出·restart 抢救提交） |
| 233 | `handoff-wo-solver-scope-fe` | `7b52d4f2` | 2026-08-11 | 7 / 3252 | 7 / 3252 | **4** | frontend | WO-SOLVER-SCOPE-HONESTY-FE：补实测日期与复验命令（stale-claims 门当场逼出来的） |
| 234 | `handoff-wo-ontology-ia` | `97ad494d` | 2026-08-11 | 1 / 3221 | 0 / 0 | **2** | docs | docs(ontology): §8 登记本体域 IA 四条断点（铁律 0 回写） |
| 235 | `handoff-integ-sim-wo126` | `04a4a8f5` | 2026-09-11 | 18 / 3056 | 18 / 3056 | **16** | agentcore,datacore,frontend,contracts | merge WO-6 导航命名 + 衰减事实上屏 |
| 236 | `handoff-wo-fact-usage-rename-inflation` | `d8a4bc5b` | 2026-08-19 | 5 / 2990 | 3 / 871 | **1** | docs,scripts | gate(fact-usage): D5 改名膨胀对账 —— 对账粒度从键升到内容，纯改名 RC=1 点名须 --tighten 显式重记 |
| 237 | `handoff-inference-prd` | `8e8f2817` | 2026-07-18 | 1 / 2916 | 0 / 0 | **0** ⚠️ | docs | docs: 新增《推演线 PRD》(根因下钻→决策推演→CEO深问·metric-aware泛化) |
| 238 | `handoff-wo-c0828-voice` | `ba71a109` | 2026-09-11 | 5 / 2883 | 5 / 2883 | **0** ⚠️ | frontend | fix: go 按钮 title 不再承载口径（R-UI-3 棘轮 94>93 咬红），可点时不给 title |
| 239 | `handoff-wo-gates-wire` | `63dec205` | 2026-08-07 | 2 / 2781 | 1 / 2726 | **1** | root,scripts | fix(gates): 三道「写了从没跑过」的门接线（23→26）+ 撤回一道被坐实的哑门 |
| 240 | `handoff-wo-order-row-detail` | `e9f810f9` | 2026-08-11 | 5 / 2703 | 5 / 2703 | **3** | frontend | fix(order-chain): 缺数披露文案里的 ** 字面泄漏到界面 |
| 241 | `handoff-wo-caplive-qapanel-retire` | `ba623ad5` | 2026-08-19 | 3 / 2628 | 2 / 547 | **1** | frontend,docs | WO-CAPLIVE-QAPANEL-RETIRE: 摘除 QaPanel 正则假 NL（G-CAPACITY-DEAD-BI 残留口闭合） |
| 242 | `handoff-wo-agentpath-hint-truth` | `8a4dfffc` | 2026-08-11 | 3 / 2607 | 3 / 2607 | **1** | frontend | fix(frontend): Agent 运行观测空态改说真前置（WO-AGENTPATH-HINT-TRUTH） |
| 243 | `handoff-debattery-fix-2` | `1935d749` | 2026-07-21 | 1 / 2606 | 1 / 2606 | **0** ⚠️ | frontend | fix(debattery): SandboxView AI 指挥台示例去硬编基地名（常州→某基地）·消 canonical 预存 R14 内联·gates 转绿 |
| 244 | `handoff-wo-gate-scan-surface-census` | `388caa6b` | 2026-08-19 | 13 / 2585 | 11 / 393 | **6** | docs,scripts | ontology: §8 G-GATE-SCOPE-MISSES-SUBJECT 句尾最小追加普查收口行 |
| 245 | `handoff-wo-gsim-cockpit-nl` | `22792d94` | 2026-08-17 | 3 / 2582 | 1 / 178 | **2** | frontend,docs | docs(ontology): G-GSIM-DEAD-COCKPIT 按实回写 + 拆出 G-GSIM-LIVE-FLAG-STALE |
| 246 | `handoff-wo-order-scope` | `e5c3d98a` | 2026-09-12 | 3 / 2571 | 3 / 2571 | **5** | frontend | WO-ORDER-SCOPE · 修 stale-claims 门：给「现算」声明补实测日期与复验命令 |
| 247 | `handoff-wo-dialogue-theme` | `a4c1f71e` | 2026-07-27 | 6 / 2570 | 6 / 2570 | **0** ⚠️ | frontend | fix(frontend): 人机对话/推演视图恒黑改主题感知（WO-DIALOGUE-THEME） |
| 248 | `handoff-wo-qos-pagectx-eval` | `ede68794` | 2026-08-18 | 3 / 2413 | 1 / 245 | **2** | agentcore,docs | docs(agentcore): WO-QOS-PAGECTX-EVAL 补 HANDOFF 六段（消本体§8悬空锚） |
| 249 | `handoff-wo-process-tick-edges-3` | `71b6b4f0` | 2026-08-20 | 3 / 2349 | 1 / 197 | **2** | datacore,docs | WO-PROCESS-TICK-EDGES-3: HANDOFF 补 merge-tree 自测结果（RC=0） |
| 250 | `handoff-wo-l2-decompose` | `4d4617b3` | 2026-07-27 | 6 / 2339 | 6 / 2339 | **1** | agentcore,frontend,contracts | feat(qos): L2 多意图真分解门（WO-L2-DECOMPOSE·暗发）——handoff·待复验 |
| 251 | `handoff-wo-capacity-provenance` | `f17f8701` | 2026-07-24 | 8 / 2335 | 8 / 2335 | **0** ⚠️ | frontend | feat(frontend): 产能推演结论数字加 hover 溯源（WO-CAPACITY-PROVENANCE） |
| 252 | `handoff-wo-dril-p2` | `d7a9fde5` | 2026-07-25 | 12 / 2334 | 11 / 2267 | **0** ⚠️ | agentcore,root,contracts,scripts | WO-DRIL-P2 · 五级标签 + 混合检索（ResourceSearchEngine + retrieve_knowledge） |
| 253 | `handoff-globalsim-glass` | `eb615167` | 2026-07-21 | 5 / 2302 | 5 / 2302 | **0** ⚠️ | frontend | feat(frontend/sim): 全局推演磨砂玻璃重设计 + 全局在先 + 从项目推演去重 |
| 254 | `handoff-wo-globalsim-drill-seam` | `457f7eb0` | 2026-07-22 | 6 / 2280 | 6 / 2280 | **0** ⚠️ | frontend | 修复全局↔项目推演下钻接缝：WIP/预测项静默空跳 P0（层叠 glass 之上） |
| 255 | `handoff-wo-phase1-d-a` | `a0363f26` | 2026-07-22 | 11 / 2269 | 10 / 2199 | **2** | agentcore,datacore,root,contracts,scripts | ci(datacore): serial test files (fileParallelism:false) to honor 'no concurrent vitest' … |
| 256 | `handoff-wo-befe-delete-wire` | `136a810e` | 2026-08-17 | 10 / 2235 | 10 / 2235 | **5** | frontend,scripts | WO-BEFE-DELETE-WIRE · 测试选择器加固 + 变异反证实测通过（因仓主调度暂停·此为收工态） |
| 257 | `handoff-wo-modeling-interactive` | `92ac7ce5` | 2026-08-06 | 6 / 2209 | 6 / 2209 | **1** | datacore,frontend | autosave(claude/handoff-wo-modeling-interactive): 08-06 05:43:43 容器重启防丢快照 |
| 258 | `handoff-wo-onto-s8-merge-guard` | `2788a584` | 2026-08-19 | 2 / 2154 | 0 / 0 | **2** | docs | WO-ONTO-S8-MERGE-GUARD：HANDOFF（①判据二复核验证实录 · ②11组收口逐条before/after · 现算vs triage-2差异 · 避让行… |
| 259 | `handoff-interface-admin-ui` | `775024c6` | 2026-08-19 | 2 / 2123 | 0 / 0 | **3** | docs | fix(ontology): anchors 门新增红修复 —— fetchDecisionTrace 锚点行号 1200→1243 |
| 260 | `handoff-calibration` | `e6b3591f` | 2026-09-17 | 9 / 2065 | 8 / 2057 | **16** | datacore,evidence,contracts | WO-SIM-CALIBRATION：修 3 处 TS 严格空检查（typecheck RC 2→0） |
| 261 | `handoff-wo-onto-s8-dedupe` | `f12b7f1a` | 2026-08-20 | 1 / 2018 | 0 / 0 | **3** | docs | docs(ontology): §8 G-ACTION-NOOP-EXEC 2 行合并（状态相反·实测裁定 ✅ 全闭，旧 🔴 留档标注为未跟改的陈迹） |
| 262 | `handoff-debattery-fix` | `d21813db` | 2026-07-19 | 1 / 1937 | 1 / 1937 | **0** ⚠️ | frontend | fix(debattery): 风险因子→根因对齐词表外置 config 层（去 RiskBoardView R14 内联·gates 全绿） |
| 263 | `handoff-wo-sandbox-s0` | `b22f1323` | 2026-08-05 | 3 / 1792 | 3 / 1792 | **0** ⚠️ | contracts | feat(contracts): WO-SANDBOX-S0 推演沙盘契约冻结 —— 五契约一次定死口径（14 单系列唯一串行前置） |
| 264 | `handoff-decision-play-fe` | `34f62307` | 2026-07-18 | 5 / 1765 | 5 / 1765 | **0** ⚠️ | frontend | feat(frontend): WO-D 决策推演页 decision_play 前端接线（5 区决策页·KILL-MOCK） |
| 265 | `handoff-desat2` | `3b26135f` | 2026-09-16 | 15 / 1659 | 0 / 0 | **3** | evidence | WO-SIM-DESAT-2 前提修正：病是真的，但"只动 seed.ts 系数"补不上——三个乘性病因，第三个在本单边界外 |
| 266 | `handoff-wo-context-compression` | `59080600` | 2026-07-25 | 3 / 1627 | 3 / 1627 | **1** | agentcore | feat(agent): 接真 LLM 滚动摘要器——完成上下文压缩最后一块（WO-CONTEXT-COMPRESSION） |
| 267 | `handoff-wo-gate-selfclaim` | `1f95cb50` | 2026-08-26 | 1 / 1582 | 0 / 0 | **2** | docs | WO-GATE-SELFCLAIM ④：§8 十个编号各占多行 → 逐组收敛（208 行 → 184 行 = 唯一编号数） |
| 268 | `handoff-wo-pressure-to-money` | `7399b3a8` | 2026-09-11 | 5 / 1561 | 5 / 1561 | **7** | datacore,contracts | WIP·未验 金丝雀改判据：status 取值须在 ORDER_STATUSES 词表内（Model.status=量产 会静默压 0·被自家测试咬出） |
| 269 | `handoff-wo-coef-from-bom` | `1e24dfa0` | 2026-09-09 | 3 / 1524 | 2 / 1044 | **0** ⚠️ | datacore,docs | test(seam): 补 WO-COEF-FROM-BOM 的真种子回归闸 —— 引擎绿不度量「种子接上了」 |
| 270 | `handoff-integ-wo16` | `acce3229` | 2026-09-11 | 13 / 1497 | 13 / 1497 | **9** | agentcore,datacore,frontend | Merge remote-tracking branch 'origin/claude/handoff-wo-nav-decay-honesty' into integ-wo1… |
| 271 | `handoff-wo-d5d4-ux` | `225de68c` | 2026-08-03 | 4 / 1347 | 4 / 1347 | **0** ⚠️ | frontend | feat(sim/D5+D4): 求解在途看得见 + 二次调参先问一句 + 在途去重（同步求解通道 useLiveSolver） |
| 272 | `handoff-meter` | `24e82377` | 2026-09-16 | 6 / 1346 | 6 / 1346 | **7** | frontend | WIP·未验 · WO-SIM-REALITY-METER · 孪生 scope 去掉 types:0（缺席不补 0） |
| 273 | `handoff-wo-disposition-inline-row` | `115fe884` | 2026-08-11 | 2 / 1335 | 2 / 1335 | **2** | frontend | WO-DISPOSITION-INLINE-ROW ② 接缝驱动测试：咬「详情在第 k 行与第 k+1 行之间」 |
| 274 | `handoff-wo-dialogue-q1q2` | `2bc0df8e` | 2026-07-28 | 7 / 1334 | 7 / 1334 | **0** ⚠️ | agentcore,datacore,contracts | feat(dialogue): 人机对话 Q1 反向产能阈值 + Q2 ceo_bottleneck baseIds 透传 |
| 275 | `handoff-wo-warm-structural` | `00a54a84` | 2026-07-27 | 4 / 1312 | 4 / 1312 | **0** ⚠️ | frontend | style(frontend): warm 结构层落地·WO-WARM-STRUCTURAL——侧栏线性图标 + KPI delta药丸/sparkline/accent卡 +… |
| 276 | `handoff-prd-audit-b1` | `a2ff3445` | 2026-08-07 | 4 / 1285 | 0 / 0 | **3** | docs | docs(audit): 抢救落盘 PRD 对账 batch2/4 中间态（审核方隔离失误的产物） |
| 277 | `handoff-snapshot-restore` | `0f5ecf8a` | 2026-09-18 | 3 / 1261 | 2 / 918 | **15** | datacore,evidence | WO-SNAPSHOT-RESTORE 阶段②: §10.9 两红归因定案 —— E7 快照语义缺口立案，empty-tenant 与快照无关 |
| 278 | `handoff-wo-customer-group` | `88993fc0` | 2026-09-11 | 8 / 1154 | 8 / 1154 | **5** | agentcore,datacore | WIP·未验: 接缝测（结构 + 对照实验 + 确定性 + 派生式自证） |
| 279 | `handoff-wo-sim-honest-fallback-b` | `5951a0fd` | 2026-08-26 | 6 / 1128 | 6 / 1128 | **8** | frontend | WIP·未验 · 把 opt-pixel 的实测数写准（7/7，不是拍脑袋的 8/8） |
| 280 | `handoff-wo-sim-session-wire` | `842ed354` | 2026-08-26 | 3 / 1055 | 3 / 1055 | **5** | frontend | WIP·未验 · 真跑抓到的死路：暂停后会话被自动选取丢掉 ⇒ 壳钉住它正在控制的世界（+接缝门第 ⑨ 臂） |
| 281 | `handoff-wo-onto-spine` | `3acacde5` | 2026-09-10 | 12 / 1018 | 11 / 862 | **6** | datacore,frontend,evidence | WIP·未验 WO-ONTO-SPINE-11 · 回填 typecheck 退出码与收尾清理 |
| 282 | `handoff-damping` | `9ebfe7be` | 2026-09-17 | 2 / 1015 | 2 / 1015 | **9** | datacore | WO-SIM-DAMPING 移除一次性实验脚手架（禁令3：不新增门） |
| 283 | `handoff-dsh-flip` | `2a591841` | 2026-09-17 | 6 / 976 | 1 / 2 | **5** | root,docs,evidence,packages-other | CLAUDE.md 铁律 1.6 · vitest 计数探针第 4 个错版本 + 可直接粘贴的实现 |
| 284 | `handoff-wo-sandbox-f3` | `6f4f7ba2` | 2026-08-05 | 4 / 960 | 4 / 960 | **0** ⚠️ | frontend | feat(sandbox-f3): 物理拓扑视图 —— 13 基地 × 10 工序热力流水矩阵（WO-SANDBOX-F3） |
| 285 | `handoff-wo-sandbox-a10` | `f4fb2abc` | 2026-08-08 | 8 / 947 | 3 / 452 | **14** | agentcore,frontend,docs | docs(a10): 消除文档内部矛盾（前文仍称本体已登记 G-SIM-EVENT-NOSUB） |
| 286 | `handoff-wo-harness-prompt-graw0b` | `81f960d2` | 2026-07-25 | 4 / 914 | 4 / 914 | **1** | agentcore | feat(agent): 提示词重构到七要素标准——共享核叠加四段 + 每 agent 结构块（WO-HARNESS-PROMPT） |
| 287 | `handoff-desat` | `043e9bc4` | 2026-09-16 | 7 / 898 | 0 / 0 | **2** | evidence | 衰减账本：杀手是 Material→Model 那一跳，一跳掉 19 万倍 |
| 288 | `handoff-supply-demand-fe` | `6fe412a9` | 2026-07-18 | 2 / 858 | 2 / 858 | **1** | frontend | feat(frontend): WO-A 供需失衡双向归因 驾驶舱接线 |
| 289 | `handoff-disruption-radius` | `531f5709` | 2026-07-19 | 3 / 806 | 3 / 806 | **0** ⚠️ | frontend | feat(frontend): 断供影响半径投影页接入 supplier_disruption_radius 求解器 |
| 290 | `handoff-deriv-probe` | `2719065d` | 2026-09-16 | 6 / 785 | 6 / 785 | **5** | datacore | WO-DERIV-DSL-PROBE: 六份探针全绿（25 例）；活服务 15731 端到端复核完成，服务已按 pid 关停 |
| 291 | `handoff-wo-splitaccount-b2-baseline` | `c445a8d9` | 2026-08-18 | 3 / 752 | 2 / 663 | **1** | docs,scripts | WO-SPLITACCOUNT-B2-BASELINE：判据⑤扫描面按角色收窄 + B-2 基线重记 3→4 |
| 292 | `handoff-wo-hv-b` | `304c137d` | 2026-09-12 | 6 / 747 | 6 / 747 | **7** | frontend | WO-HV-B: 修 f23 新用例的 TS18048（noUncheckedIndexedAccess 下解构元素可能 undefined） |
| 293 | `handoff-wo-roster-reg-2` | `a2349bc5` | 2026-08-18 | 2 / 708 | 1 / 638 | **1** | docs,scripts | WO-ROSTER-REG-2：roster 门两条未定性常量登记（EXCLUDE_DIRS=computed · PROTECTED_PATTERNS=criteria） |
| 294 | `handoff-wo-node-semantics` | `084abd86` | 2026-08-07 | 5 / 685 | 5 / 685 | **0** ⚠️ | frontend | docs(node-semantics): 订正 cf 计数（7 条 / 6 种机理 / 24 条依据），说明现金垫那条为何两侧各挂一次 |
| 295 | `handoff-wo-trace-ledger-sweep` | `d964339e` | 2026-08-18 | 2 / 685 | 0 / 0 | **2** | root,docs | docs(handoff): WO-TRACE-LEDGER-SWEEP 交单报告（六段） |
| 296 | `handoff-wo-capsim-slots` | `19d12261` | 2026-09-10 | 10 / 652 | 8 / 511 | **4** | datacore,frontend,evidence,contracts | WIP·未验 修 D3 字号回归（13px→12px）+ 落改前/改后实测 |
| 297 | `handoff-domain-declare` | `12de5dfe` | 2026-09-17 | 2 / 633 | 2 / 633 | **3** | datacore | WIP·未验 · 订正 B 类不补域的理由（派单给的 leadDays 坐标实测不成立，换成 chain-loss.ts 已核实那条） |
| 298 | `handoff-wo-scene-concretize` | `fa04a0e1` | 2026-07-27 | 2 / 605 | 2 / 605 | **0** ⚠️ | agentcore,contracts | chore(seed): 场景启动器建议问题/placeholder/历史问答具体化（基地/型号/时间/订单/规则维度·治低置信澄清） |
| 299 | `handoff-wo-rui4-coords` | `5bba74d0` | 2026-09-04 | 8 / 585 | 8 / 585 | **2** | datacore,frontend,contracts,scripts | WO-RUI4: 门补 §2 后端载荷侧扫描面 + 取证脚本移出版本库 |
| 300 | `handoff-wo-hv-a` | `ae0efddb` | 2026-09-12 | 5 / 554 | 5 / 554 | **7** | frontend | WO-HV-A 收口断言：代价行两个数上屏+浮层可达 · 超时路径说清超时≠无解 |
| 301 | `handoff-wo-reflect-loop` | `389586b4` | 2026-07-25 | 2 / 539 | 2 / 539 | **0** ⚠️ | agentcore | feat(agent): 反思/重规划闭环——收尾前确定性复盘 + 硬有界重规划（WO-REFLECT-LOOP） |
| 302 | `handoff-wo-relevance-floor` | `cf0804aa` | 2026-09-12 | 3 / 490 | 2 / 214 | **4** | agentcore,docs | docs: 相关性分布审计（50 条问句·真服务实测） |
| 303 | `handoff-prd-audit-b2` | `5ef6503c` | 2026-08-07 | 4 / 478 | 0 / 0 | **8** | docs | docs: PRD 对账 batch2 完成 22/22 + 汇总表 + 按投入产出排序的补做建议 |
| 304 | `handoff-wo-sim-gate-decouple` | `17203595` | 2026-09-11 | 16 / 467 | 16 / 467 | **8** | datacore,frontend,contracts | WO-7 ⑦: 补修全量套件暴露的 4 个同类断言（旧键当数据键） |
| 305 | `handoff-wo-arghints-12-loud` | `2508e40f` | 2026-08-23 | 2 / 438 | 2 / 438 | **2** | datacore | WIP·未验：12 条 argHints 空头支票改成实现真读的键全集 + 逐求解器一致性测试转绿 |
| 306 | `handoff-wo-sim-nav-unified` | `67536c0f` | 2026-08-26 | 5 / 438 | 5 / 438 | **9** | frontend | WIP·未验：mock 补 view.sim-* 四条功能键（复刻生产 registerViewFeature 动态注册）+ 撤销 featureKeyOf 特例 |
| 307 | `handoff-wo-wip-ratio-gap` | `0beeee41` | 2026-09-11 | 5 / 435 | 4 / 376 | **5** | datacore,docs,contracts | WO-5 缺口登记：在产订单已投料比例全仓零出现（金丝雀自证+词表全覆盖+对象层核验） |
| 308 | `handoff-wo-agent-dsh` | `d1285c09` | 2026-09-10 | 3 / 401 | 3 / 401 | **4** | agentcore,frontend | WO-AGENT-NEW-DSH ③ 修 stub 轮次缺 usage（typecheck）+ 变异反证已还原 |
| 309 | `handoff-wo-sim-opt-readable` | `61f38f8e` | 2026-08-28 | 4 / 380 | 4 / 380 | **0** ⚠️ | frontend | WIP·未验 SandboxOpt/ParetoChart/TradeoffRadar：死控件改真按钮 + 图上字号按渲染缩放校正后提档 |
| 310 | `handoff-wo-sim-money-honesty` | `995b57c5` | 2026-09-11 | 4 / 375 | 4 / 375 | **5** | datacore,contracts | WO-SIM-MONEY-HONESTY 单元4：签名册三个 stateVar 探针读移出 propKeys（S6 不许自造命名判红；运行时动态格不在列级安全论域，注释说透） |
| 311 | `handoff-ontograph-sop` | `800f625c` | 2026-09-15 | 1 / 358 | 0 / 0 | **3** | docs | docs(PRD): 融合模式四级阶梯（规则+求解器+ReAct+生成求解器）+ dsh 真供应商实测 |
| 312 | `handoff-wo-chainnode-gate-widen` | `86e57347` | 2026-08-07 | 1 / 348 | 1 / 348 | **1** | frontend | autosave(claude/handoff-wo-chainnode-gate-widen): 08-07 03:14:25 容器重启防丢快照 |
| 313 | `handoff-wo-nav-decay-honesty` | `eb9d5874` | 2026-09-11 | 5 / 341 | 5 / 341 | **4** | frontend | 补实测日期与复验方式（stale-claims 门实测报红，已修：RC 1 -> 0） |
| 314 | `handoff-wo-inputschema-wire` | `91b78f57` | 2026-09-12 | 4 / 333 | 4 / 333 | **4** | agentcore | WO-INPUTSCHEMA-WIRE · 校验只拦模型写的入参（fromModel）——说明书比真实契约窄，一视同仁会打死 path-A 合法调用 |
| 315 | `handoff-wo-r9-distfresh` | `5cd21e8b` | 2026-08-14 | 1 / 293 | 1 / 293 | **1** | scripts | rescue(WO-R9-DISTFRESH): gate.sh 三分退出码处置 —— 容器重启前未提交，未验证 |
| 316 | `handoff-prd-skill-migration` | `25ce5c6f` | 2026-08-03 | 1 / 278 | 0 / 0 | **0** ⚠️ | docs | docs(PRD): 32 份 ExecutionPlan 升格进 Skill 的迁移路线（Track E 落地） |
| 317 | `handoff-m0-ground-truth` | `4a5c1ad4` | 2026-09-19 | 5 / 251 | 5 / 251 | **3** | frontend | WIP·未验 F0: SandboxView.init 改服务端派生 + src 零命中（含注释叙事清理） |
| 318 | `handoff-qos-budget-600s` | `80480a60` | 2026-07-21 | 2 / 241 | 2 / 241 | **0** ⚠️ | agentcore,contracts | chore(qos): free-LLM 预算 90s→600s + 放开 maxIterations/toolCalls（real-Kimi 多跳复杂推演） |
| 319 | `handoff-wo-delta-compare` | `44309588` | 2026-08-09 | 2 / 239 | 2 / 239 | **1** | contracts | WO-DELTA-COMPARE ①契约：WorldDelta 七维差异（诚实缺席类型层不可绕过） |
| 320 | `handoff-sim-world-single-source` | `670f0497` | 2026-09-17 | 1 / 224 | 0 / 0 | **2** | root | 解冻：measuredCells 守门员获仓主批准 + 四条设计判据 |
| 321 | `handoff-wo-attr-dead-controls` | `c25e4148` | 2026-08-26 | 4 / 219 | 4 / 219 | **4** | frontend | WO-ATTR-DEAD-CONTROLS · 死控件门（11 用例：契约现算/真选真点/全页普查） |
| 322 | `handoff-provenance-hover` | `e61986e2` | 2026-07-18 | 1 / 215 | 1 / 215 | **0** ⚠️ | frontend | feat(frontend): WO-B 推演溯源悬浮 PROVENANCE-HOVER——因果树每数字 hover 三态诚实溯源 |
| 323 | `handoff-wo-sim-unified-ts6` | `5a93535b` | 2026-08-26 | 1 / 211 | 1 / 211 | **0** ⚠️ | frontend | WO-SIM-UNIFIED-TS6·修 6 条 noUncheckedIndexedAccess 类型错(未验测试) |
| 324 | `handoff-wo-gslive-live` | `2bcc34c1` | 2026-08-06 | 1 / 209 | 1 / 209 | **1** | contracts | autosave(claude/handoff-wo-gslive-live): 08-06 05:43:43 容器重启防丢快照 |
| 325 | `handoff-prd-skill-compiler` | `373a84d9` | 2026-08-03 | 1 / 182 | 0 / 0 | **0** ⚠️ | docs | docs(PRD): 技能编译器与技能注册中心（Skill Compiler & Registry） |
| 326 | `handoff-wo-sandbox-d1` | `f353c088` | 2026-08-05 | 2 / 167 | 2 / 167 | **0** ⚠️ | datacore | feat(sandbox-D1): 节拍承载 —— Cadence 从种子自身的发生序列推导（WO-SANDBOX-D1·数据半） |
| 327 | `handoff-wo-trace-ledger-writeback` | `2b75f36d` | 2026-08-19 | 2 / 165 | 0 / 0 | **1** | docs | docs(trace): 未派节记账回写 #1-#5 已做（WO-TRACE-LEDGER-WRITEBACK） |
| 328 | `handoff-wo-topo-realdata` | `26dc7f98` | 2026-08-07 | 3 / 151 | 3 / 151 | **0** ⚠️ | frontend | WO-TOPO-REALDATA·5/5 自查抓出：算式里的样本条数在不等权时是编的 |
| 329 | `handoff-wo-r9-sdga` | `589c89ab` | 2026-08-14 | 1 / 150 | 1 / 150 | **1** | datacore | rescue(WO-R9-SDGA): 容器重启前未提交的那条「口径锚」测试 —— 未完成·未验证 |
| 330 | `handoff-wo-dispatch-deficit-macos` | `2634591f` | 2026-08-18 | 1 / 133 | 1 / 133 | **1** | scripts | fix(scripts): dispatch-deficit.sh macOS 可跑 —— CORES/LOAD/ps/远端四处可移植性回退 |
| 331 | `handoff-wo-sim-ux-prd-5pages` | `976e2b59` | 2026-08-26 | 2 / 123 | 0 / 0 | **4** | docs | PRD §4/§4.1/§4.3/§5 就地订正扩表后的过期计数（含 U4b 那行现算推翻的旧读数） |
| 332 | `handoff-prd-skill-contract` | `86a90bab` | 2026-08-03 | 1 / 118 | 0 / 0 | **0** ⚠️ | docs | docs(PRD): Skill 契约与 DSL（12 层落 zod · execution 吞并 ExecutionPlan · requires 引用模型） |
| 333 | `handoff-prd-skill-runtime` | `5b7a6e1d` | 2026-08-03 | 1 / 117 | 0 / 0 | **0** ⚠️ | docs | docs(PRD): Skill Runtime 与 Reasoning Graph 编排器 —— 把 SPEC 的目标形态翻成可施工可验收的运行时 |
| 334 | `handoff-wo-onto-wire4` | `c75fd6f5` | 2026-09-10 | 2 / 117 | 2 / 117 | **2** | datacore | WIP·未验 WO-ONTO-WIRE-4 ④ 接缝断言：retire 后类型从读出面消失（含对照臂） |
| 335 | `handoff-wo-harness-prompt` | `d0135cec` | 2026-07-25 | 3 / 113 | 3 / 113 | **0** ⚠️ | agentcore | feat(agentcore): 系统提示词升级到七要素 Harness 标准（叠加式） |
| 336 | `handoff-wo-legibility-12px` | `1b108e21` | 2026-08-26 | 4 / 110 | 4 / 110 | **5** | frontend | WIP·未验 fix(ui): 三处说明从 JSX 注释挪进文件头注（JSX 里会被 ui-first-layer D2b 算作第一层长说明串） |
| 337 | `handoff-guard-world` | `0bb51466` | 2026-09-17 | 1 / 91 | 1 / 91 | **1** | datacore | 退③修复：measuredCells 守门员走生产播种路（含反向臂与变异反证） |
| 338 | `handoff-wo-gate-seam-small` | `1f68c0fa` | 2026-08-26 | 2 / 65 | 2 / 65 | **6** | agentcore,datacore | 验收通过：4 门 RC=0 + BUILD_RC=0 + 三个受影响测试文件全绿（AC 5/5 · DC 12/12 · FE 8/8） |
| 339 | `handoff-wo-s08-kit-fe` | `387fff8f` | 2026-08-07 | 4 / 64 | 4 / 64 | **5** | frontend | test(kit-fe): SEAM 门 —— 用**真链路抓下来的答案块**驱动，不用我自己捏的 |
| 340 | `handoff-prd-audit-b4` | `dd3e87f9` | 2026-08-07 | 1 / 43 | 0 / 0 | **3** | docs | docs: PRD 对账 batch4 · 16-22 + 汇总表 + 按投产比排序的补做建议（全 22 份完） |
| 341 | `handoff-sandbox-gap-audit` | `ec5cbbc4` | 2026-08-07 | 1 / 41 | 0 / 0 | **0** ⚠️ | docs | docs(audit): 沙盘重设计 PRD 实现缺口对账 —— 头条=4 个新视图零入口（BUILTIN_VIEWS 未登记） |
| 342 | `handoff-wo-prd-field-audit` | `8ed7727b` | 2026-08-11 | 1 / 37 | 0 / 0 | **2** | docs | docs(audit): 补 §6.3 —— 规则作用域命名漂移（追「未判定」多追一层的产出） |
| 343 | `handoff-stale-claims-dates` | `43c0af0c` | 2026-09-19 | 2 / 36 | 2 / 36 | **3** | frontend | WIP·未验 zh.ts 阻滞点残差文案注释补实测日期与复验方式（STALE-1） |
| 344 | `handoff-prd-coverage-full` | `2cdc882d` | 2026-08-09 | 1 / 28 | 0 / 0 | **3** | docs | docs(audit): §5.1 补金丝雀证据（否定结论必须配已知必中样例） |
| 345 | `handoff-wo-ot-instance-reach` | `7bf51807` | 2026-08-11 | 2 / 26 | 2 / 26 | **2** | frontend | WO-OT-INSTANCE-REACH ② 标注所闭断点 G-OT-INSTANCE-PANEL-OFFSCREEN + 记录选型理由 |
| 346 | `handoff-prd-skill-governance` | `4f3cfa70` | 2026-08-03 | 1 / 25 | 0 / 0 | **0** ⚠️ | docs | docs(PRD): Skill 治理与学习闭环（权限三面 / Trace / 学习前置 / 生长回路人在回路） |
| 347 | `handoff-prd-audit-b3` | `ddac597c` | 2026-08-07 | 1 / 20 | 0 / 0 | **5** | docs | docs(audit): PRD 对账第3批 · 21-22/22 + 汇总表 + 按投入产出排序的补做建议（完结） |
| 348 | `handoff-prd-audit-b5` | `cb494eb0` | 2026-08-07 | 1 / 20 | 0 / 0 | **4** | docs | docs(audit-b5): 16-19/19 + 汇总表 + 按投入产出排序的补做建议（第5批完成） |
| 349 | `handoff-wo-computed-edge-proposal` | `27cd745e` | 2026-09-06 | 1 / 19 | 0 / 0 | **0** ⚠️ | docs | docs(proposal): 订正 ontology-dsl / ontology.ts 引用行号（读原文核对，不写死漂移行） |
| 350 | `handoff-qos-live-evidence` | `69543dff` | 2026-07-24 | 1 / 17 | 0 / 0 | **1** | docs | docs(qos): 真 Kimi 10 题 live 复测验收日志（一次性证据·非 CI） |
| 351 | `handoff-skill-migration-scope` | `6cddca17` | 2026-08-09 | 1 / 17 | 0 / 0 | **1** | docs | docs(wo): WO-SUITE-skill-migration — 把迁移 PRD 拆成 5 张可派发 WO + 今日起点三分法定性 |
| 352 | `handoff-wo-metrics-audit` | `a4cea8ed` | 2026-08-11 | 1 / 14 | 0 / 0 | **1** | docs | docs: AUDIT-metrics-tenant-authz — /metrics 鉴权与租户隔离审计（欠账 #65） |
| 353 | `handoff-wo-66-rules-first-class` | `c05137e4` | 2026-07-30 | 1 / 12 | 0 / 0 | **1** | docs | docs(WO-66 P0): 求解器阈值台账普查（solvers/** 21 文件全量·仅文档不改代码） |
| 354 | `handoff-wo-a6-seg` | `2f54e84d` | 2026-08-11 | 1 / 10 | 0 / 0 | **1** | docs | docs(audit): A6 跨 seg 复验 —— 定性「诚实的未实现」，且本体里有第二套业务线词表 |
| 355 | `handoff-wo-a6-rule-scan` | `844267f2` | 2026-08-11 | 1 / 7 | 0 / 0 | **1** | docs | docs(audit): C01–C33 逐条核完 —— 「保谁」有承载(C15·已验活)、「有争用」无承载但非结构性死路 |

## 6 · 没做到的 / 本名单量不到的

1. **没有对任何分支下「这条可以并」的结论** —— 那是收编方的判断，本单只给残留量这个事实。
2. **`RESIDUAL>0` 不度量工作量**（§2.1）。要得到真实欠账，需要对单条分支跑三路合并预演，本单没做 —— 383 条跑不完。
3. **`CHERRY+` 认不出 squash 合并**（§2.2）。故 `CHERRY+>0` 也是必要不充分；它只能把「肯定已并」剔掉，不能证明「肯定没并」。
4. **「最近推送」用的是 committerdate，不是真实 push 时间** —— git 不在远端 ref 上记录 push 时刻。旁证：`edge-wire` 的 committerdate 距今 5.8h，与 WO 里「6 小时前推的」吻合，故该代理在本仓可用。
5. **没有跑任何测试**（本单纪律：主工作目录正在跑四包 gate，禁 vitest）。故本名单**不含任何「这条分支是绿的吗」的信息**。
6. **提交信息列做了截断**（>88 字符截断并标 `…`），未改写、未概括。
7. **没有碰 `docs/REQUIREMENTS-TRACE.md` / `docs/SYSTEM-ONTOLOGY.md`**（禁令 1），**没有新增门 / 棘轮 / 基线 JSON**（禁令 3）。本单产物只有这一份 `.md`。

