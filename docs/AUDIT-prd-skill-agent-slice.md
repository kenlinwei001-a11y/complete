# AUDIT · skill / agent / 本体切片 PRD 的「说了什么 × 做没做」逐条对账

| 项 | 值 |
|---|---|
| 日期 | 2026-08-10 |
| 分支 | `claude/handoff-audit-prd-sas` |
| 取证基线 commit | **`282b823965fb63a6a66e4e88611b234c10219616`**（= `origin/claude/inspiring-gates-aqczjg`，canonical，2026-08-10） |
| 性质 | **纯审计 · 只读取证 · 不改一行生产代码**（本文件是唯一新增文件） |
| 起手自证 | worktree 原 HEAD `778cc589` 经 `git merge-base --is-ancestor` 实测**是 canonical 的祖先 ⇒ 落后**，已从 canonical 重开分支后取证（铁律 0.6 第 2 条机制：判据是祖先关系，不是文件存在性） |
| 回答的问题 | 仓主原话：「**我发了很多关于 skill、agent、本体切片的 PRD，都没有做吗**」 |

> **所有 `file:line` 只对 `282b8239` 有效。** 换 commit 必须重取证。

---

## 0 · 工具自证（金丝雀 · 铁律 0.6：报否定结论前先证明工具是活的）

本文出现的每一处「0 命中 / 不存在 / 零调用方」，都配下表某一条金丝雀。**金丝雀不中 ⇒ 报「工具坏了」，不报「代码里没有」。**

| # | 我要报的否定结论 | 金丝雀（已知必中） | 金丝雀结果 | 若不中我会报什么 |
|---|---|---|---|---|
| K1 | 符号普查 `grep -rn <sym> apps/*/src packages/*/src` 报 0 | `SkillDefinitionSchema` | **13 命中** ✅ | 「grep 坏了」而非「全是死代码」 |
| K2 | `"skill.compiler"` entitlement **全仓 0**（字面量，非 `skill-compiler` 文件名） | 同命令找 `skill-compiler`（含 `.`/`-` 两形态） | **17 命中** ✅ | 「grep 坏了」 |
| K3 | `fill_data` **不在 `OPERATION_CATALOG`** | 同文件 `packages/contracts/src/operation-intent.ts` 找 `synth` | **命中 `:59`** ✅ | 「文件读不到」 |
| K4 | `callSignature`/`perToolCallCap` 等治理符号是否存在 | `BudgetTracker` | **28 命中** ✅ | 「grep 坏了」 |
| K5 | `refbase` 是否存在 | `BUSINESS_DOMAINS` | **15 命中** ✅ | 「datacore 读不到」 |
| K6 | 分支是否已并 canonical | **不用文件存在性**，用 `git merge-base --is-ancestor` | `compiler-s1` RC=0（**已并**）· `partial-a` RC=0（**已并**）· `skill-agent-reconcile` RC=1（**未并**） | 用「某文件在不在」判断会误判（CLAUDE.md 铁律 0.6 第 2 条实测骗过 4 个 dev） |
| K7 | 「只在非 canonical 分支上的文档」差集 | 先用 canonical 自身跑同一条命令得 **33** 份，再对 310 条远端分支求并集得 **68** 份 | 差集 **35** 份，逐份反查落在哪条分支（见 §1.1） | 若 canonical 侧也报 0，就是脚本坏了 |
| K8 | seed 中 `resources` 恒空 | 同文件 `references:` | **7 命中** ✅（`resources: []` 7 处全空） | 「seed 文件读不到」 |

⚠️ **本单刻意避开的两个已知会骗人的工具**（CLAUDE.md 铁律 0.6 记载）：
① `git grep -- "apps/*/src"`（pathspec 的 `*` 不跨 `/`，恒 0 命中）——本单用的是 **shell glob 传给 `grep -r`**，K1 已自证跨得了 `/`；
② `git rev-parse <rev>:<path>` 不带 `--verify -q`（路径不存在会原样回显且 RC=0）——§1.1 的分支反查脚本**全部带 `--verify -q`**。

### 0.1 ⛔ 本单自己犯的错（第 3 种骗法 · 当场自纠 · 照铁律 0.6 记账）

**我在本单第一版里连报 6 条错误的否定结论，全部同一个根因：`grep … | head -20` 把命中截掉了。**

我跑的是一条**多符号或查 + `head -20`** 的命令：
```bash
grep -rn "callSignature\|LOOP_REPEAT_CAP\|perToolCallCap\|EscalationLadder\|loop-control:check" \
     apps/agentcore/src packages/contracts/src scripts package.json | head -20
```
`callSignature` 一个符号就占满了 20 行 ⇒ 排在后面的 `loop-control:check`（在 `package.json`）与
`EscalationLadder` 的邻近证据**一行都没露面**。我据此报了「0 命中」。

**形态（照铁律 0.6 的句式）**：
> **「我用『前 20 行输出里没有 X』当作『X 不存在』的证据，而前者并不度量后者。」**

与本仓已记载的三次同族（pathspec `*` 不跨 `/` · `--include` 过滤让 docs 恒不命中 · 120 字窗口截断 ID）
**结构完全相同**，只是这次的截断器叫 `head`。

**被这个错误坑掉的 6 条结论（均已在正文订正，并标 ⟪已自纠⟫）**：

| 我原本报的 | 实测 | 订正后 |
|---|---|---|
| `loop-control:check` 门不存在 | `scripts/check-loop-control.mjs` **存在**，且**在 `pnpm gates` 链内第 12 位**，还有具名 npm script `loop-control:check` | AG-LC-21 ❌ → **✅** |
| 三个治理 metric 不存在 | `apps/agentcore/src/metrics.ts:108/113/118` 三个全在（而且 `check-loop-control.mjs` 判据⑥**就在守这条接线**） | AG-LC-30 ❌ → **✅** |
| EscalationLadder 只有开关没有机制 | 机制在 `agent/loop.ts:507-530 maybeEscalate`（rung① 换策略）+ `orchestrator.ts:2388`（rung② 升 Coordinator） | AG-LC-15 ⚠️ → **✅** |
| `agent_escalated` 伪 step 没做 | `loop.ts:509,520` 真 emit | AG-LC-25 ❌ → **✅** |
| 四条 SEAM 测试文件名不符/不存在 | `loop-detector-seam.test.ts` · `retry-manager-seam.test.ts` · `per-tool-cap-seam.test.ts` · `escalation-ladder-seam.test.ts` · `escalation-reroute-seam.test.ts` **五个全在** | AG-LC-24 ⚠️ → **✅** |
| 复现脚本 `slice-scenarios-excel.mjs` 不在仓库 | `scripts/slice-scenarios-excel.mjs` **存在**；`deliverables/` 是 **`.gitignore:27` 里的产物目录**，本来就不该进仓 | A-16 **整条撤回**；建议断点 `G-DOC-EVIDENCE-NOT-IN-REPO` **撤回** |

**为什么这一节必须留在文里**：这 6 条如果没自纠，本审计会把一份**P1+P2 已完整交付**的 PRD
报成「路线图大半没做」——**恰好是与事实相反的结论**，正是本仓被 grep 骗过四次的那个后果。
**机制（本单当场执行）**：凡要报**否定结论**的那一次 grep，**单符号单跑、不加 `head`、先看 `wc -l`**。
§6 复验命令里所有否定型检查都已改成这个形状。

---

## 1 · 一页纸结论

### 1.0 直接回答仓主那句话

**「都没有做吗」的答案是：三个域的答案完全不同，不能用一句话回答。**

| 域 | 一句话定性 | 判据 |
|---|---|---|
| **Skill** | **PRD 写完了并线了，实现只落地了一小截。** 1630 条可验收条款里，**实体层真满足 434 条（26.6%），无承载物 624 条（38.3%）**；而 434 条 ✅ 里至少 **133 条**只是「PRD 对现状的事实断言复核正确」——证明**盘点做对了**，不是**能力做出来了**。剔掉后**实现层 ✅ ≈ 301/1630 = 18.5%** | §2.1 |
| **Agent** | **绝大部分做了，而且在生产链路上。** 6 份 PRD 里 5 份**已实现已并线**（含容器态默认启用），1 份（ReAct Harness）**接了线但暗发默认关**。共 **155 条**，实体层真满足 **105 条（67.7%）**，无承载物 **17 条（11.0%）**；治理层 PRD 的 P0+P1+P2 **全部落地**（含门 + metric + 五条 SEAM），只剩它自己排「低优先」的 P3 四项 | §2.2 |
| **本体切片** | **做了，而且是三域里最完整的。** 后端 98 条切片真数据、规划器/索引/两库/参考基线/十六层投影全在生产链路上；前端「切片库」「十六层面板」页真接后端。共 **62 条**，实体层真满足 **47 条（75.8%）**，无承载物 **5 条（8.1%）** | §2.3 |

**⚠️ 与派单给的三条已知事实的分歧（按纪律显式说明，以我的实测为准）**：

| # | 派单说 | 我实测 | 分歧性质 |
|---|---|---|---|
| 1 | Skill「做了，但卡在集成分支上没并进正线（近期已并 canonical）」 | **「已并」这半句成立**：`compiler-s1` / `partial-a` 经 `merge-base --is-ancestor` 实测 **RC=0 已并**。**但「都已经开发了」这个前提不成立** —— 5 条 `handoff-prd-skill-*` 分支**每条只有 1 个提交、只动 1 个 `docs/*.md`**，它们是「写 PRD」的分支不是「写实现」的分支。真相是 **PRD 并线了，实现有相当一部分从来没开工** | **修正前提**，不是修正结论 |
| 2 | Agent「管理台此前 372 行一字未改，运行观测是今天才新建的」 | **成立**。`AgentsPage.tsx` 今天 **686 行**，最近一次改动 `1c156ebc feat(frontend): Agent 管理页接上运行观测台`。但**要分清两件事**：管理台（前端可见面）是今天才补的；**Agent 运行时本身（loop/reflect/治理/上下文三刀/数据生成工具）早就在生产链路上** —— 「管理台没改」≠「Agent 没做」 | **补充区分**，不是分歧 |
| 3 | 本体切片「首屏默认那 4 条多跳切片全带 `{{args.X}}`，面板以 `args={}` 调用 ⇒ 点开十六张空卡」 | **病灶描述属实，但今天已修**。`47bb96d0`（datacore，2026-08-10）+ `0e2bf500`（frontend，2026-08-10）已在 canonical：后端 `slice-layers.ts:82 diagnoseEmptyGraph` 区分 `missing_args` / `no_root_objects` / `no_match` 三因，并从**真 root 对象**读出候选值；前端 `SliceLayersPanel.tsx:87 EmptyGraphBar` 渲染诚实条 + 一键试切。**残留缺口**：首屏仍以 `args={}` 起手（空子图 + 诚实条），**不是**默认带参解出真子图 | **已修，需更新账本** |

### 1.1 范围清单（文档全集 · 含未合并分支上的）

**canonical 上与 skill/agent/slice 相关的文档 33 份**（K7 金丝雀已自证）。按性质分：

| 类 | 份数 | 清单 |
|---|---:|---|
| **Skill PRD/SPEC**（可施工规格） | 8 | `PRD-skill-contract-dsl.md`(751) · `PRD-skill-compiler-registry.md`(907) · `PRD-skill-runtime-orchestrator.md`(789) · `PRD-skill-governance-learning.md`(747) · `PRD-skill-migration.md`(660) · `PRD-skill-crossreview.md`(234·审查报告) · `PRD-addendum-skill-authoring.md`(255) · `SPEC-industrial-skill.md`(627) |
| **Skill 已有逐条复验账**（本单的上游） | 4 | `CHECK-DSL-CMP.md`(962) · `CHECK-MIG-XR.md`(718) · `CHECK-RT-GOV.md`(1047) · `CHECK-SPEC-AUT.md`(687) |
| **Agent PRD** | 6 | `PRD-addendum-agent-runtime.md`(85) · `PRD-agent-react-harness.md`(375) · `PRD-agent-execution-governance-loop-control.md`(218) · `PRD-agent-navigation-slice-latency.md`(107) · `PRD-agent-data-generation-tools.md`(91) · `PRD-llm-agent-empty-response-guard.md` |
| **Agent 审计/评估** | 2 | `AUDIT-agent-console-gap.md`(317) · `ASSESS-pi-agent-harness-replacement.md` |
| **切片 PRD/实施记录** | 4 | `PRD-A3-multihop-slice-completion.md`(59) · `IMPLEMENTATION-phase1-4-slice-rules.md`(130) · `SLICE-order-fulfillment-360.md`(76) · `ONTOLOGY-SLICE-GAPS.md`(299·门产物) |
| **切片审计** | 1 | `AUDIT-slice-16-layers.md`(365) |
| **总纲相关章节** | — | `PRD-platform-foundry-aip.md` §8.1 B1(Agent 注册表) · §8.4 B4(Skill 库) · §12 验收 SK1 |
| 其余（工单/清单/协议） | 8 | `CHECKLIST-skill-4209.md` · `WO-*SKILL*` · `WO-FE-AGENT-TRACE-delivery.md` 等 |

**⚠️ 只存在于未合并分支上的 10 份**（K7 差集 + 逐份 `git rev-parse --verify -q` 反查，已排除 `docs/evidence/*` 截图与 `req-inventory` 供参资料）：

| 文档 | 落在哪条分支 | 该分支已并 canonical？ | 重要性 |
|---|---|---|---|
| **`RECONCILE-skill-agent-prd-2026-08-09.md`**（689 行） | `origin/claude/handoff-skill-agent-reconcile` | ❌ **未并**（`merge-base --is-ancestor` RC=1） | 🔴 **最高** —— 这就是仓主要的那张账的上一版（14 份 skill/agent PRD 逐份对账 + 分支侧对账）。**它证明这个问题上一轮已经被回答过，但答案卡在一条没并的分支上，canonical 上看不见** |
| `RECONCILE-slice-16-layers-two-sets.md` | `handoff-wo-slice16-reconcile` · `integ-w1-cert5` | ❌ 未并 | 🟠 中（十六层两套口径对账） |
| `PRD-A3-reference-ontology-slice-planner.md` | `origin/claude/wizardly-gauss-7enbzy` | ❌ 未并 | 🟡 低（A3 早期设计稿，其内容已由 canonical 的 `refbase.ts` + `slice-planner.ts` 覆盖） |
| `PRD-A14-agent-evals-handrun.md` | `origin/claude/wizardly-gauss-7enbzy` | ❌ 未并 | 🟡 低 |
| `PRD-agent-native-absorb.md` · `PRD-agent-universal-fallback.md` · `WO-AGENT-ASSET-BREADTH.md` | `complete-app-recovery` / `complete-repo-recovery` / `sandbox-reconstruction-dev3-duun6o` / `vigilant-knuth-july-recovery`（四条 recovery 支线） | ❌ 未并 | 🟡 低（recovery 支线快照，非在研 PRD） |
| `WO-SUITE-skill-migration.md` | `handoff-skill-migration-scope` | ❌ 未并 | 🟡 低 |
| `req-inventory/SUPPLEMENT_Chapter49_SkillPlatform.md` · `Chapter51_AgentRuntime.md` | 三条 recovery 支线 | ❌ 未并 | 🟡 低（外部需求清单供参） |

### 1.2 三域计数

> **判定口径**：本单沿用四份 `CHECK-*.md` 已建立的五档（它们已用脚本机械校验编号连续无重号），并映射到派单要求的四态：
> ✅ 实体层真满足 = **已实现且在生产链路上**（有实现 + 有非 test 生产调用方 + 已追到触发条件）；
> 🔗 有实现·接线不全 = **接了线接错地方 / 只覆盖部分路径**；
> ⚠️ = **只有实现没接线（只有 test 引用）** 或 **接了线没数据（输入恒空）**——⚠️**两者在上游 CHECK 里被合成了一档，本单在 §2.1.3 逐条拆开**；
> ❌ 无承载物 = **没做**（金丝雀已跑）；
> ⛔ 文档自标非目标 = **不计缺口**（「没做」不是缺口，**「宣称做了」才是** → §3）。

#### Skill 域（8 份文档 · 1630 条）

| 档 | DSL(215) | CMP(240) | MIG(224) | XR(46) | RT(311) | GOV(320) | SPEC(196) | AUT(78) | **合计** | 占比 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ✅ 已实现且在生产链路上 | 45 | 77 | 77 | 25 | 78 | 67 | 30 | 35 | **434** | 26.6% |
| 🔗 接了线接错地方/覆盖不全 | 24 | 39 | 12 | 5 | 31 | 2 | 58 | 21 | **192** | 11.8% |
| ⚠️ 只有实现没接线 / 接了线没数据 | 4 | 1 | 1 | 0 | 3 | 0 | 8 | 5 | **22** | 1.3% |
| ❌ 没做 | 115 | 95 | 15 | 6 | 126 | 179 | 72 | 16 | **624** | 38.3% |
| ⛔ 文档自标非目标（不计缺口） | 27 | 28 | 119 | 10 | 56 | 67 | 28 | 1 | **336** | 20.6% |
| ◐ 未核实（诚实标注） | 0 | 0 | 0 | 0 | 9 | 4 | 0 | 0 | **13** | 0.8% |
| 双档行（✅+❌ / ❌+⛔ / ✅+🔗 / 🔗+⚠️） | 0 | 0 | 0 | 0 | 8 | 1 | 0 | 0 | **9** | 0.6% |
| **小计** | **215** | **240** | **224** | **46** | **311** | **320** | **196** | **78** | **1630** | 100% |

**✅ 434 条必须再拆一刀（不拆会高估 30%）**：其中至少 **133 条**是「PRD 对**现状**的事实断言经复核正确」——
DSL 17 · CMP 26 · RT 36 · GOV 54（四份 CHECK 各自点名的数）。它们证明**盘点做对了**，不是**需求满足了**。
⇒ **实现层 ✅ ≈ 434 − 133 = 301 条 = 18.5%。**
（MIG/XR 的同类条数上游未量化，本单**未判定**，故 301 是**上界不确定的下限估计**——真实实现层 ✅ 只会更低。见 §5。）

**⚠️ 本单发现四份 CHECK 的一处系统性过期，必须校正**：`CHECK-DSL-CMP.md` 在 `f392ae00` 取证时把 **34 条标 `[未并]`**（✅17 · 🔗16 · ❌1），依赖 `compiler-s1` 合并才成立。**今天两条分支都已并**（K6 实测 RC=0），故：

| 上游 CHECK 结论 | 今日 canonical 实测 | 证据 |
|---|---|---|
| `compileGraph` **0 命中·未实现** | ✅ **已实现** | `packages/contracts/src/skill-graph.ts:175` `export function compileGraph`；生产调用方 `skill-graph.ts:508`（`upgradeplan` 唯一升格入口） |
| `GraphScheduler` **0 命中·未实现** | ✅ **已实现且在生产链路上** | 实现 `apps/agentcore/src/skill-orchestrator.ts:95`；**生产调用方** `apps/agentcore/src/server.ts:1432` `new GraphScheduler({...})`，挂在 `POST /b/v1/skill-graphs/run` |
| `SkillReasoningGraph` **0 命中** | ✅ **已实现** | 契约 `packages/contracts/src/skill-compile.ts:321`；生产消费方 `apps/agentcore/src/skill-compiler.ts:125/241` `deriveSkillReasoningGraph` |
| `maxBudgetRounds` **零生产消费方** | 🔗 **接了线接错地方**（详见 §3 X-02′） | 唯一 src 读点 `apps/agentcore/src/skill-probe.ts:133 skillBudgetOverride([skill])`，归一函数 `packages/contracts/src/agentcore.ts:224`；种子已有数据 `apps/agentcore/src/mocks/seed.ts:1286 maxBudgetRounds: 6` |

#### Agent 域（6 份 PRD + 1 份审计 · 154 条）

> 条款为本单自行提取（每条 = 一句可判真假的验收陈述），编号 `AG-*`。逐条见 §2.2。

| 档 | RT<br>(38) | HAR<br>(40) | LOOP<br>(34) | NAV<br>(13) | DG<br>(24) | GUARD<br>(6) | **合计** | 占比 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ✅ 已实现且在生产链路上 | 30 | 21 | **29** | 11 | 8 | 6 | **105** | 67.7% |
| 🔗 接了线接错地方/覆盖不全 | 2 | 4 | 1 | 0 | 3 | 0 | **10** | 6.5% |
| ⚠️ 只有实现没接线 / 接了线没数据 | 3 | 5 | 0 | 1 | 2 | 0 | **11** | 7.1% |
| ❌ 没做 | 1 | 6 | **4** | 0 | 6 | 0 | **17** | 11.0% |
| ⛔ 文档自标非目标（不计缺口） | 1 | 3 | 0 | 0 | 4 | 0 | **8** | 5.2% |
| ◐ 未判定（需起服务 / live 测 / 未逐行读完） | 1 | 1 | 0 | 1 | 1 | 0 | **4** | 2.6% |
| **小计** | **38** | **40** | **34** | **13** | **24** | **6** | **155** | 100% |

> ⟪**已自纠**⟫ 本表 LOOP 列由「✅24 / ❌8」订正为「✅29 / ❌4」——第一版因 `grep … | head -20` 截断，
> 把 5 条已交付条款错报成没做（详见 §0.1）。**订正后 LOOP 的 4 条 ❌ 全部是 PRD 自己排的 P3「低优先·排后」。**

（RT=`PRD-addendum-agent-runtime` · HAR=`PRD-agent-react-harness` · LOOP=`PRD-agent-execution-governance-loop-control` · NAV=`PRD-agent-navigation-slice-latency` · DG=`PRD-agent-data-generation-tools` · GUARD=`PRD-llm-agent-empty-response-guard`）

#### 本体切片域（4 份文档 + 总纲相关 · 62 条）

| 档 | A3<br>(25) | IMPL<br>(24) | SL360<br>(8) | 16L<br>(5) | **合计** | 占比 |
|---|---:|---:|---:|---:|---:|---:|
| ✅ 已实现且在生产链路上 | 17 | 23 | 5 | 2 | **47** | 75.8% |
| 🔗 接了线接错地方/覆盖不全 | 2 | 0 | 1 | 1 | **4** | 6.5% |
| ⚠️ 只有实现没接线 / 接了线没数据 | 1 | 0 | 1 | 1 | **3** | 4.8% |
| ❌ 没做 | 4 | 0 | 1 | 0 | **5** | 8.1% |
| ⛔ 文档自标非目标（不计缺口） | 1 | 1 | 0 | 1 | **3** | 4.8% |
| **小计** | **25** | **24** | **8** | **5** | **62** | 100% |

（A3=`PRD-A3-multihop-slice-completion` · IMPL=`IMPLEMENTATION-phase1-4-slice-rules` · SL360=`SLICE-order-fulfillment-360` · 16L=`AUDIT-slice-16-layers` 的四项承载物结论）
⟪**已自纠**⟫ IMPL 列由「✅20 / ❌3」订正为「✅23 / ❌0」——SL-IM-22/23 是我误判（§0.1）。

#### 三域合计（1847 条）

| 档 | Skill(1630) | Agent(155) | 切片(62) | **合计** | 占比 |
|---|---:|---:|---:|---:|---:|
| ✅ 已实现且在生产链路上 | 434 | 105 | 47 | **586** | 31.7% |
| 🔗 接了线接错地方/覆盖不全 | 192 | 10 | 4 | **206** | 11.2% |
| ⚠️ 只有实现没接线 / 接了线没数据 | 22 | 11 | 3 | **36** | 1.9% |
| ❌ 没做 | 624 | 17 | 5 | **646** | 35.0% |
| ⛔ 文档自标非目标（不计缺口） | 336 | 8 | 3 | **347** | 18.8% |
| ◐ 未判定 / 双档 | 22 | 4 | 0 | **26** | 1.4% |
| **合计** | **1630** | **155** | **62** | **1847** | 100% |

> **⚠️ 这张总表最容易被误读，读之前先记住两件事**：
> ① **585 条 ✅ 里至少 133 条只是「PRD 把现状写对了」**，不是「能力做出来了」（§1.2 Skill 段）；
> ② **647 条 ❌ 里 96%（624 条）来自 Skill 一个域**，而 Skill 的 ❌ 又有一大半落在
> **文档自己标了「本期不做/后续 WO 承接」的那 336 条 ⛔ 的邻域**（MIG 一份就占 119 条 ⛔）。
> **把三个域加总求一个「完成率」是没有意义的** —— 三个域的成熟度差一个数量级，加总只会掩盖这个差别。
> 要看的是 §1.0 那张三行表，不是这张总表。

### 1.3 最值得先修的 5 条（按「对用户可见价值」排序，不是按工作量）

| 序 | 缺口 | 今天用户看到什么 | 修法 | 覆盖条数 | 证据 |
|---:|---|---|---|---:|---|
| **1** | **首屏 4 条多跳切片默认 `args={}` ⇒ 十六层第一眼仍是空的** | 点开「本体切片」→ 十六张卡全空（有诚实条解释，但没有一眼可见的真数据）。**这是仓主唯一亲手点到的那个面** | 后端 `diagnoseEmptyGraph` 已给出真候选值（`slice-layers.ts:107 candidatesFor`）；前端把「首个候选值」作为**默认试切参数**起手（而非 `args={}`），再保留手改入口。**改一行默认值，不是造功能** | 3（16L 的 🔗+⚠️） | `apps/datacore/src/ontology/slice-layers.ts:120-130` · `apps/frontend-shell/src/pages/admin/SliceLayersPanel.tsx:87` |
| **2** | **`RECONCILE-skill-agent-prd-2026-08-09.md` 卡在未并分支** | 仓主问「都没做吗」时，**上一轮已经查过的答案在仓库里看不见** ⇒ 同一个问题被问第二次、被查第二次（本单就是第二次） | `git cherry-pick` 该分支的文档提交到 canonical（**纯 `docs/` 文件，零代码风险**）。同批把 `RECONCILE-slice-16-layers-two-sets.md` 一起收编 | — | `origin/claude/handoff-skill-agent-reconcile`（`merge-base --is-ancestor` RC=1） |
| **3** | **`POST /b/v1/skills/:id/compile` 无 entitlement 门** | 「技能结构」页的编译按钮对任何 `catalog_admin` 恒开，**关不掉**。CMP §0 R3 白纸黑字要求「暗发 `skill.compiler`、双注册、关闭 404」——**R3「Entitlement 先于 authz」被实打实违反**，不是"没做"是"做了但漏了门" | 在 `features/registry.ts` 加 `{key:"skill.compiler", defaultOn:false}` + handler 前置 `requireFeature`。照抄同文件 `agent.critic`(`:104`)/`agent.escalation`(`:108`) | 2（CMP C017 + N-02） | 端点 `apps/agentcore/src/server.ts:1465`（只有 `auth` + `requireCatalogAdmin`）；`"skill.compiler"` 字面量全仓 **0**（金丝雀 K2 = 17 命中） |
| **4** | **`maxBudgetRounds` 挂在 eval 探针路，不在生产 agent loop 上** | 用户在技能页填「探索预算 6 轮」，**保存成功、发布通过、跑起来毫无变化** —— 因为生产 6 处 `new BudgetTracker(...)` 全走 `residualBudgetFromConfig()`（只读 env），skill 声明**不在优先级链上**。DSL §4.6 的验收原话「改这个数 → 该类题实际探索轮次真变」**今天不成立** | 在 `orchestrator.ts` 的 `residualBudgetFromConfig()` 之后叠一层 `skillBudgetOverride(本轮在场 skills)`（**只收紧不放宽**的语义归一函数已现成） | 3（DSL D136-143 组 + X-02） | 唯一 src 读点 `apps/agentcore/src/skill-probe.ts:133`；生产站点 `apps/agentcore/src/router/orchestrator.ts:929/1028/1705/1883/2347/2506` 全部 `residualBudgetFromConfig()` |
| **5** | **引用可校验门对 rule 只查"存在"不查"状态"** | 一个 Skill 引用**未发布的 DRAFT 规则**今天可以正常发布，用户以为「门过了 = 引用可用」，运行时才发现规则不生效 | `apps/agentcore/src/tools/datacore-http.ts:233 listRuleKeys` → `GET /a/v1/rules`（**无 `?status=PUBLISHED`**）改为复用同文件 `:238 listRules` 的过滤语义 | 1（N-01） | 探针 `apps/agentcore/src/resources.ts:80` 用的是**前者**；CMP §14.2 早已预言这一条并写明"实施时必须先核对"，**P0 落地时没人回来核** |

> **不列进前 5、但排第 6 的**：`agent.critic`（reflect 闭环）与 `agent.escalation`（升级阶梯）两个 feature 都是 `defaultOn:false`
> （`apps/agentcore/src/features/registry.ts:104/108`）。它们**接了线、代码完整、测试绿**，但默认租户走不到那条分支。
> 这是「开关即可，无需施工」，与前 5 条的性质不同 —— **但如果没人知道要开，效果上等同于没做**。

---

## 2 · 逐条对账表

### 2.1 Skill 域

#### 2.1.1 本单与四份 `CHECK-*.md` 的关系（不重复劳动，只做增量）

`docs/CHECK-DSL-CMP.md` / `CHECK-MIG-XR.md` / `CHECK-RT-GOV.md` / `CHECK-SPEC-AUT.md` 四份文档
**已把 8 份 skill 文档逐条拆成 1630 条并逐条给了 file:line 证据**（编号连续性经脚本机械校验：
`D001–D215` / `C001–C240` / `SK-MIG-1…216`+`R-A…R-H` / `SK-XR-1…46` / `RT-001…311` / `GOV-001…320` /
`SK-SPEC-*` 196 / `SK-AUT-*` 78）。**本单不重抄这 1630 行**，只做三件上游做不到的事：

1. **基线校正**：四份 CHECK 取证于 `f392ae00` / `b50f42a`，此后 `compiler-s1`+`partial-a` 已并 → §1.2 已列出四条定性反转；
2. **⚠️ 档的拆分**：上游把「只有 test 引用」与「接了线没数据」合成一档，两者修法完全不同 → §2.1.3 逐条拆开；
3. **跨文档汇总**：三个域放在一张表里比较（上游每份只看自己那两份）。

#### 2.1.2 八份文档的逐份定性（每份一行，证据在 CHECK 的对应表）

| 文档 | 条数 | 一句话定性 | 关键证据（今日 canonical 复核） |
|---|---:|---|---|
| `PRD-skill-contract-dsl.md` | 215 | **契约字段大部分已实现已并线；`execution` 挂载点缺失、`maxBudgetRounds` 挂错路** | `SkillDefinitionSchema` 18 字段（`packages/contracts/src/agentcore.ts:236-261`）中 `capability`/`sideEffect`/`inputSchema`/`outputSchema`/`references`/`approvalGate`/`provenancePolicy` 均有真消费方；**无 `requires`/`identity`/`businessIntent`/`trigger`/`progress`/`acceptance` 六个字段组**；`SkillExecutionSchema`（`packages/contracts/src/skill-graph.ts:384`）**没挂在 `SkillDefinition` 上** |
| `PRD-skill-compiler-registry.md` | 240 | **七段流水线落地 3 段**（Parser=zod · Validator=`lintSkill` · Execution Graph=`deriveSkillReasoningGraph`）；Optimizer / Runtime Package / `.skill` 包 / 签名 / CLI **全 0** | 端点在 `apps/agentcore/src/server.ts:1465`；`skill-compiler.ts:213` 把 optimize/package **显式标 `NOT_IMPLEMENTED`**（诚实拒绝，不是静默跳过）；`"bin"` 字段全仓无输出 ⇒ CLI 零实现 |
| `PRD-skill-runtime-orchestrator.md` | 311 | **S1 切片已落**（图契约 + 分层并发调度 + 引用探针 ≈ 42 条真满足）；**W2 收编未开工** —— 本 PRD 自己的 G1「不引入第三套扇出」**被自己违反**（现为「三套 + 一套新的」） | `GraphScheduler`（`apps/agentcore/src/skill-orchestrator.ts:95`）→ 生产调用方 `server.ts:1432`；本体 `docs/SYSTEM-ONTOLOGY.md:983` **主动承认「比 PRD §3.4 目标态更远」** |
| `PRD-skill-governance-learning.md` | 320 | **P0–P4 五期在 canonical 上交付量为 0**；67 条 ✅ 里 **54 条**是「AS-IS 断言仍成立」，真满足 13 条**全是既有资产**，无一条来自本 PRD | `CHECK-RT-GOV.md` §C.2/§C.3；P0 硬前置两项（`metrics-tenant:check` 门 / `/metrics` 鉴权）**都没闭** |
| `PRD-skill-migration.md` | 224 | **M0 影子声明零开工**；224 条里 **119 条 ⛔**（PRD 自标「零代码改动，实施由后续 WO 承接」）——**「没做」不是缺口**，但 §3 列出 6 条**别处宣称做了**的 | `migrateSkill` 等迁移符号 0 命中（金丝雀 `SkillDefinitionSchema`=13 ✅） |
| `PRD-skill-crossreview.md` | 46 | **审查报告，非可施工 PRD**。其最要害的一条（「引用可校验门今天做不了」是传播性错误）**今天复核仍正确** | `probeMissingRefs`（`apps/agentcore/src/resources.ts`）**今日 canonical 实测三处调用点**：`server.ts:747`(agent 发布·校 `scopeDeclaration.objectTypes`) · `:1065`(workflow 发布·校 `solverKeys`/`ruleKeys`) · **`:1317`(skill 发布·经 `probe:` 回调注入，fail-closed，`:1312` 注释明写 503 向上冒泡)**。⚠️ 上游 CHECK 文档里的 `690/1008/1272` 三个行号**已漂**，本单已订正 |
| `PRD-addendum-skill-authoring.md` | 78 | **本批最扎实的一份**（✅ 45%）。发布三重门真在链路上；但门名（`skill-lint:check` 等）在 `package.json`/`scripts/` **0 命中** → §3 F1/F2/F3 | 三重门 `apps/agentcore/src/server.ts:1246`(lint) `:1252-1267`(评测覆盖) `:1268-1273`(评测真跑) |
| `SPEC-industrial-skill.md` | 196 | **12 层里契约/注册/校验/执行/权限层有等价物；编译/包格式/CLI/签名层零实现**。✅ 仅 15% | `SKILL_REFERENCE_KINDS`（`agentcore.ts:216`）8 值**无 `tool`/`mcp`/`relation`/`connector`** ⇒ 第③⑦层「声明不了」不是「不声明」 |

#### 2.1.3 ⚠️ 档拆开：「只有实现没接线」 vs 「接了线没数据」（上游合成一档，本单拆开）

**修法完全不同，混了必修错地方**（CLAUDE.md 铁律 0.5 判据 1）：

| 条目 | 真形态 | 证据 | 修法 |
|---|---|---|---|
| `buildNavigationSliceSection`（agent 侧，一并列此） | **没接线**（只有 test 引用） | 实现 `apps/agentcore/src/agent/navigation-slice.ts:384`；引用方**只有** `apps/agentcore/test/qos-agent-slice-seam.test.ts:9,125`，零生产调用方 | 删（死代码）或接上 |
| `SkillDefinition.resources`（附件） | **接了线没数据** | 消费方齐：`read_skill_resource` 工具（`tools/registry.ts:258` → `tools/executor.ts:467`）、`engine.ts:481` 注入附件清单；**但 seed 7/7 全是 `resources: []`**（`apps/agentcore/src/mocks/seed.ts:1046/1093/1137/1181/1224/1268/1320`，金丝雀 K8：同文件 `references:` 7 命中） | **补种子数据**，不是接线 |
| `SkillDefinition.dependsOn` | **接了线有数据（已脱离 ⚠️）** | 消费方 `skill-lint.ts:212`(环检测)/`:302`；`partial-a` 并入后种子从 0 → **1 条**（`mocks/seed.ts:1350` `sop_meeting --dependsOn--> capacity_analysis`）。⚠️ 这个数是被 `skill-compiler.seam.test.ts` 的金丝雀**当场报红逼出来的** | 无需动作 |
| `skill_quality` EvalCase | **接了线没数据** | 门真在（`server.ts:1252`「≥3 用例 + 三类各 ≥1」）；`seedRegistry()` 返回键只有 agents/workflows/skills，**skill_quality 用例 0 条** ⇒ 出厂 7 个 Skill **一个都跑不到这道门** | 补种子用例 |
| 依赖环检测（`checkDependencyCycle`） | **接了线没数据**（生产从未触发） | `dependsOn` 长期为 0 ⇒ 环检测分支从未进入 | 补数据（已部分改善） |
| `SkillAttachment` / `read_skill_resource` | **接了线没数据** | 同 `resources` 空 | 同上 |

#### 2.1.4 总纲 `PRD-platform-foundry-aip.md` §8.4 B4（Skill 库）逐条

| 条款（截断） | 状态 | 证据 |
|---|---|---|
| `SkillDefinition{id,tenantId,key,version,name,summary,body,resources,status}` | ✅ | `packages/contracts/src/agentcore.ts:236-261`（实际 18 字段，是超集） |
| `summary ≤200 字，常驻 agent system prompt` | 🔗 **口径分裂** | 常驻已实现（`agent/prompts.ts:72` → `engine.ts:320`）；但**长度三处不一致**：PRD 200 / 契约 `agentcore.ts:242` `max(400)` / 前端 `SkillsPage.tsx:77-78` `maxLength=400`；lint 按 200 在发布期拦 ⇒ 用户写到 350 字保存成功、发布被拒 |
| `body markdown 全文（≤50KB）` | ✅ | 契约 `max(50_000)`；lint `BODY_MAX=3000` 是**有意的两层语义**（SPEC §9.3 定案），**不是冲突** |
| `resources 附件走 BlobStore` | ⚠️ **接了线没数据** | 见 §2.1.3 |
| `CRUD + 发布 API` | ✅ | `server.ts:1201-1300` 全套 + `:1477 new-version` / `:1494 references` / `:1503 retire` / `:1512 delete` |
| `内置工具 load_skill 返回 body` | ✅ | `tools/registry.ts:481` + `engine.ts:370 resolveSkill` |
| `资源给预签名 URL` | ❌ **没做** | `read_skill_resource` 返回的是**内容/元信息**（`tools/executor.ts:527`，文本 ≤64KB 截断），**不是预签名 URL**（金丝雀：同文件 `blobKey` 相关符号可命中 ⇒ 工具正常） |

#### 2.1.5 总纲 §12 验收 SK1

| 条款 | 状态 | 证据 |
|---|---|---|
| `SK1 · agent 经 load_skill 拉取技能全文并在回答中应用（夹具断言提示词包含 skill body 片段）` | ✅ **已实现且在生产链路上** | `agent/skill-router.ts:39`(相关性打分) → `agent/prompts.ts:69-79`(注入 summary) → `engine.ts:320`(常驻) → `engine.ts:370 resolveSkill`(全文)；测试 `apps/agentcore/test/skill-runtime.test.ts` |

---

### 2.2 Agent 域逐条

> 条款为本单自行提取。每条给「状态 + 证据 file:line」。**否定结论均配 §0 金丝雀。**

#### 2.2.1 `PRD-addendum-agent-runtime.md`（38 条 · ✅30 / 🔗2 / ⚠️3 / ❌1 / ⛔1 / ◐1）

| # | 条款（截断） | 状态 | 证据 file:line |
|---|---|---|---|
| AG-RT-01 | §1.1 Token 预算器：每次迭代前估算 messages 总量 | ✅ | `apps/agentcore/src/agent/context.ts:309` `ContextBudgeter`；生产调用 `agent/loop.ts:287,597` |
| AG-RT-02 | §1.1 软阈值 = min(maxContext,200K)×70%，硬阈值 90% | ✅ | `agent/context.ts:309-360`；阈值口径在 `docs/SYSTEM-ONTOLOGY.md:1063` 有单源说明 |
| AG-RT-03 | §1.2-1 单个 tool_result 截断至 8KB + 尾注 | ✅ | `agent/loop.ts:224-225`（`TRUNCATION_EXEMPT_TOOLS` 白名单证明主路径在截断） |
| AG-RT-04 | §1.2-2 完整结果仍全量入审计 | ✅ | `tools/executor.ts:622` 回执落 `toolCalls`；`server.ts:431,452` 读端 |
| AG-RT-05 | §1.2-3 `query_timeseries_agg` 不受二次截断 | ✅ | `agent/loop.ts:225` 白名单含 `query_timeseries_agg` |
| AG-RT-06 | §1.3 第 1 刀 折叠最旧迭代 tool_result，最近 2 轮永不折叠 | ✅ | `agent/context.ts` `foldOldestFrame`；`loop.ts:747` 分支 |
| AG-RT-07 | §1.3 第 2 刀 Anthropic 服务端 compaction（beta `compact-2026-01-12`） | ⚠️ **接了线没数据** | 分支在（`loop.ts:747`），但 `docs/SYSTEM-ONTOLOGY.md:1063` + `server.ts:498-501` 记载：阈值需 ≤128k provider 才够得到 ⇒ **`contextOps` 常态返回 `[]` 是真值不是缺陷** |
| AG-RT-08 | §1.3 第 3 刀 硬阈值强制收尾 | ⚠️ 同上 | 同 AG-RT-07 |
| AG-RT-09 | §1.3 `contextOps[]` 入 AgentRunRecord + metric `ac_context_ops_total{op}` | ✅ | 写端 `agent/loop.ts:423`；metric `src/metrics.ts:134,176`；契约 `packages/contracts/src/qos.ts:721` |
| AG-RT-10 | §1.3 三刀留痕的 **HTTP 读端** | ✅ **今天补上** | `GET /b/v1/queries/:taskId/agent-run`（`server.ts` 新增）；此前为「写了没人读」，见 `docs/AUDIT-agent-console-gap.md` §6-1 |
| AG-RT-11 | §1.4 多轮连续性：不复用上一任务原始 messages，注入前情摘要块 | ✅ | `agent/prompts.ts` `agentPriorSummary`；`AGENT_SYSTEM_CORE` ⑤状态管理 |
| AG-RT-12 | §1.4 分类器 6 轮摘要与 agent 共用同一摘要构建器 | 🔗 **覆盖不全** | 摘要器可插拔（`production-cognition.llmRollingSummarizer`），但**未见两处共用同一构建器的单源断言** |
| AG-RT-13 | §2-1 workflow 总时限 ≤5 分钟，发布校验超限拒绝 | ✅ | `workflow` 发布路 `server.ts:1008` 区段 |
| AG-RT-14 | §2-2 崩溃语义：启动扫描 `EXECUTING_*` >10min → `INTERRUPTED_BY_RESTART` | ✅ **已实现且在生产链路上** | 实现 `apps/agentcore/src/ops/sweep.ts:6,12,22`；**生产调用方** `apps/agentcore/src/main.ts:81`（启动时扫描） |
| AG-RT-15 | §2-2 前端显示「系统重启中断，请重试」+ 一键重发 | ✅ | 文案在 `ops/sweep.ts:22`；前端任务详情消费 |
| AG-RT-16 | §2-3 预留 `WorkflowCheckpointStore`（空实现 + 接口） | ⛔ **文档自标 v2** | `apps/agentcore/src/workflow/checkpoint.ts:4` 存在且注释明写「崩溃语义由启动扫描覆盖」 |
| AG-RT-17 | §3-1 新增内置工具 `read_skill_resource`（sideEffect=READ） | ✅ | 注册 `tools/registry.ts:258`；分派 `tools/executor.ts:467`；端口 `deps.ts:49` + `tools/skill-resources.ts:8` |
| AG-RT-18 | §3-1 文本类返回内容 ≤64KB + 截断提示；二进制返回元信息 | ✅ | `tools/executor.ts:527` |
| AG-RT-19 | §3-2 `SkillDefinition.resources` 增加 `mime` 与 `description` | ⚠️ **接了线没数据** | 字段在契约；**seed 7/7 `resources: []`**（K8） |
| AG-RT-20 | §3-3 body 中 `{{resource:name}}`；load_skill 返回附资源清单 | ✅（清单）/ ⚠️（数据） | `engine.ts:481` 注入附件清单；同样受 §2.1.3 空数据限制 |
| AG-RT-21 | §4.1 streamable_http 连接池 ≤4、空闲 30s、tools/call 超时 20s | ✅ | `apps/agentcore/src/mcp/runtime.ts` |
| AG-RT-22 | §4.1 失败退避 1s/2s/4s，连续 5 次 → server 置 ERROR + 告警 | ✅ | `mcp/runtime.ts` |
| AG-RT-23 | §4.1 stdio 持久子进程 + 30s 心跳 + 崩溃重启 ≤3 次/小时 | ✅ | `mcp/runtime.ts:16` 起 |
| AG-RT-24 | §4.1 工具 schema 缓存 TTL 10min + 「刷新工具清单」按钮 | ✅ | `mcp/runtime.ts`；前端 MCP 配置页 |
| AG-RT-25 | §4.2 工具名一律 `mcp__{serverName}__{toolName}` | ✅ **已实现且在生产链路上** | 归一 `packages/contracts/src/agentcore.ts:100 mcpToolFullName`；消费 `engine.ts:306` · `tools/executor.ts:250` · `agent/navigation-slice.ts:272` · `mcp/solvers-catalog.ts:2` |
| AG-RT-26 | §4.2 serverName 校验 `^[a-z0-9_]{2,24}$` 且租户内唯一 | ✅ | 契约层校验 |
| AG-RT-27 | §4.3-1 stdio 默认禁用，需 `MCP_STDIO_ENABLED=1` + `MCP_STDIO_COMMAND_ALLOWLIST` | ✅ | `config.ts:60,88`；拒绝文案 `mcp/runtime.ts:44` |
| AG-RT-28 | §4.3-2 stdio 仅 platform_admin 可创建/修改 | ✅ | `mcp/runtime.ts:16` 注释 + 端点鉴权 |
| AG-RT-29 | §4.3-3 command 全路径精确匹配白名单；args 禁 shell 元字符 | ✅ | `mcp/runtime.ts:16` |
| AG-RT-30 | §4.3-4 任一不满足 → 创建/启动即拒绝，原因明确 | ✅ | `mcp/runtime.ts:44` |
| AG-RT-31 | §4.4 本期 MCP 仅消费 tools（prompts/resources 不支持） | ⛔→✅ | 边界声明，实现符合 |
| AG-RT-32 | §4.4 凭据仅静态 bearer，v2 预留 `credentialKind` | ✅ | 契约字段在 |
| AG-RT-33 | §5 同轮多 tool_use：READ 并行（≤4），含 COMPUTE/ACTION 全串行 | ✅ | `agent/loop.ts` 并行分支 + `sideEffect` 词表 |
| AG-RT-34 | §5 tool_result 按 tool_use 原顺序回填 | ✅ | `agent/loop.ts` |
| AG-RT-35 | 验收 R5 workflow 执行中 kill 重启 → INTERRUPTED_BY_RESTART + 一键重试 | ✅ | 同 AG-RT-14/15 |
| AG-RT-36 | 验收 R7 MCP 宕机 → 退避→ERROR→agent 得 is_error 不阻塞→恢复回 ACTIVE | ✅ | `mcp/runtime.ts` |
| AG-RT-37 | 验收 R9 stdio 安全四拒 | ✅ | `mcp/runtime.ts:44` |
| AG-RT-38 | 验收 R10 并行耗时断言 < 串行 | ◐ **未判定** | 机制在（AG-RT-33），但**耗时型断言**只在 `apps/agentcore/test/runtime-workflow.test.ts` 找到（那是 workflow 并行不是 agent 同轮工具并行）。**本单未逐一读完 agent 侧测试的断言内容，不下否定结论**（§5.2-7） |

#### 2.2.2 `PRD-agent-react-harness.md`（40 条 · ✅21 / 🔗4 / ⚠️5 / ❌6 / ⛔3 / ◐1）

| # | 条款（截断） | 状态 | 证据 file:line |
|---|---|---|---|
| AG-HAR-01 | G1 loop 升级为「理解→计划→分解→执行→反思」 | ✅ | `agent/reflect.ts:73 reflectAnswer` → `agent/loop.ts:21`(import) → `:312`(调用) → `:879`(收尾前反思步) |
| AG-HAR-02 | G2 `AGENT_SYSTEM_CORE` 补齐 ③推理循环/⑥错误恢复/⑦结果规范三段 | ✅ | `apps/agentcore/test/harness-elements.test.ts` 存在并断言七要素齐 |
| AG-HAR-03 | G3 Solver-first 硬纪律（prompt 硬约束） | ✅ | `agent/prompts.ts`【求解纪律】段 |
| AG-HAR-04 | G3 Solver-first **执行期门**（reflect 判「该类问题却没调 solver」） | 🔗 **覆盖不全** | `reflect.ts:73` 复盘清单在，但 solver-first 判据是否覆盖「排产类问题未调 solver」需读 `reflect.ts` 全文确认——**本单未逐条读完**（见 §5） |
| AG-HAR-05 | G4 Critic 验证前置（出口前批判性自检） | 🔗 **接了线·默认关** | `orchestrator.ts:2019-2024` 注入被 `reflectEnabled(...)` 包着（`:200-204`），而 `features/registry.ts:104` `agent.critic` **`defaultOn:false`** ⇒ 默认租户走不到 |
| AG-HAR-06 | G5 只在 path-B 生效，path-A 字节兼容零回归 | ✅ | `orchestrator.ts:200` 注释明写「既有 path-B 逐字节不变·不劫持」 |
| AG-HAR-07 | §1.2 非目标：不训练模型；反思以 R6 确定性为主、LLM critic 为辅可 fail-open | ⛔→✅ | `loop.ts:304` 注释「确定性 `reflectAnswer`（R6 主判）+ 可选 LLM critic（advisory）」 |
| AG-HAR-08 | §1.2 非目标：不无限重试，重规划硬预算 ≤1 | ✅ | `loop.ts:281-284` `replanBudget` 默认 1 |
| AG-HAR-09 | §3 补③【推理循环】Think→Act→Observe→Reflect | ✅ | `harness-elements.test.ts` |
| AG-HAR-10 | §3 补⑥【错误恢复】四类分类恢复 | ✅ | 同上 |
| AG-HAR-11 | §3 补⑦【结果结构】五段决策模板 | ✅ | 同上 |
| AG-HAR-12 | §3 硬约束：保留 `本题导航图`/四红线/`注入防护`/`[预算耗尽·诚实摘要]` | ✅ | `qos-agent-slice-seam.test.ts` / `qos-b.test.ts:172` / `lived-in.test.ts:49` / `agent-budget.test.ts` 全在 |
| AG-HAR-13 | §4 Ontology Awareness：NavigationSlice 投影相关对象/solver/链路/规则 | ✅ | `agent/navigation-slice.ts` `projectNavigationSlice`；生产 import `orchestrator.ts:39` + `engine.ts:4` |
| AG-HAR-14 | §4 type-semantics 口径语义锚定注入 | ✅ | `agent/ontology-context.ts` |
| AG-HAR-15 | §5 `selectSkills` 语义 top-k 注入 | ✅ | `agent/skill-router.ts:39` |
| AG-HAR-16 | §5 升级为 DRIL 向量检索 `retrieve_knowledge` | ✅ | `tools/registry.ts:26` `retrieve_knowledge` 已注册 |
| AG-HAR-17 | §6 门 1：prompt【求解纪律】段 | ✅ | 同 AG-HAR-03 |
| AG-HAR-18 | §6 门 2：未挂 ⟦ref:N⟧ 的业务数字 → 判违规打回 | ✅ | `reflect.ts` 复盘项「数字落地」 |
| AG-HAR-19 | §7.1 `reflectAnswer(task, runRecord, answer)` 挂在收尾判定处 | ✅ | `loop.ts:879` |
| AG-HAR-20 | §7.2 复盘项「答了吗」 | ✅ | `reflect.ts:73` |
| AG-HAR-21 | §7.2 复盘项「数字落地」 | ✅ | 同上 |
| AG-HAR-22 | §7.2 复盘项「工具静默失败」 | ✅ | 同上（SEAM `reflect-loop-seam.test.ts`） |
| AG-HAR-23 | §7.2 复盘项「越 scope」 | ✅ | 同上 |
| AG-HAR-24 | §7.2 复盘项「口径一致」（复用 `ontology.crossValidate`） | ⚠️ **需确认** | 未在 `reflect.ts` 找到 `crossValidate` 调用——**本单未逐行读完 `reflect.ts`，标未判定** |
| AG-HAR-25 | §7.2 可选 LLM Critic（`agent.critic` entitlement · fail-open） | 🔗 **接了线·默认关** | 同 AG-HAR-05 |
| AG-HAR-26 | §7.3 重规划-重试硬有界（`replanBudget=1`） | ✅ | `loop.ts:281-284` |
| AG-HAR-27 | §7.3 耗尽走 `synthesizePartialFindings` 诚实收尾 | ✅ | `loop.ts` degrade 出口 |
| AG-HAR-28 | §7.3 `standardMd` 明标「反思发现的缺口：<原因>」 | ✅ | `loop.ts:461` 降级文案 |
| AG-HAR-29 | §7.3 `AgentRunRecord.reflected?: boolean` | ✅ | `loop.ts:916,929` |
| AG-HAR-30 | §7.3 `AgentRunRecord.replanReason?: string[]` | 🔗 **类型偏离** | 实现是 `replanReason?: string`（**单数**，`loop.ts:184`），PRD 写的是 `string[]` |
| AG-HAR-31 | §8 五段决策结构（结论/分析/证据/建议/风险） | ✅ | prompt 层已进（AG-HAR-11） |
| AG-HAR-32 | §9 WO-HARNESS-PROMPT + `harness-elements.test.ts` | ✅ | `apps/agentcore/test/harness-elements.test.ts` |
| AG-HAR-33 | §9 WO-REFLECT-LOOP + `agent/reflect.ts`(新) | ✅ | `apps/agentcore/src/agent/reflect.ts` |
| AG-HAR-34 | §9 WO-SOLVER-FIRST-GATE | ⚠️ **未见独立 SEAM** | `apps/agentcore/test/` 下无 `solver-first*` 文件（金丝雀：同目录 `reflect-loop-seam.test.ts` 命中 ⇒ 目录可读） |
| AG-HAR-35 | §10.3 **新增事件 `agent.reflected`** | ⛔ **诚实偏离（PRD 未回写，本体已回写）** | 全仓零命中；`docs/SYSTEM-ONTOLOGY.md:329` 明写「PRD 原计划新增 `agent.reflected`，**实现改为不新增**」。**本体做对了，PRD 没同步** |
| AG-HAR-36 | §10.6 回写本体 §3 编排链补 Reflect 插入点 | ✅ | `docs/SYSTEM-ONTOLOGY.md:329` |
| AG-HAR-37 | §10.6 回写 §7 新增门 `harness-elements:check` | ❌ **没做** | `package.json` / `scripts/` 无该门名（金丝雀：同命令找 `ref-closure:check` 命中） |
| AG-HAR-38 | §11-2 Reflect 拦截 SEAM（头号判据） | ✅ | `apps/agentcore/test/reflect-loop-seam.test.ts` + `reflect-wiring-seam.test.ts` |
| AG-HAR-39 | §11-3 Solver-first SEAM（漏调 solver 即红） | ❌ **没做** | 同 AG-HAR-34 |
| AG-HAR-40 | §0.2 七要素诚实体检表（对现状的事实断言） | ◐ **未判定** | 需读 `prompts.ts` 全文逐要素比对，本单未做 |

#### 2.2.3 `PRD-agent-execution-governance-loop-control.md`（34 条 · ✅29 / 🔗1 / ⚠️0 / ❌4）

**这份 PRD 最值得单独说：它是三个域里交付度最高的一份 —— P0+P1+P2 全部落地（含门、metric、五条 SEAM、容器态默认开），只剩 PRD 自己排「低优先·排后」的 P3 四项。**
⟪本节 5 行经 §0.1 自纠，第一版把它错报成「路线图大半没做」⟫

| # | 条款（截断） | 状态 | 证据 file:line |
|---|---|---|---|
| AG-LC-01 | §2-1 Loop Detector：停滞早停双条件（`consecutiveToolFailures` + `roundsWithoutSuccess`） | ✅ | `agent/loop.ts:867-873`，阈值 `:187-188` |
| AG-LC-02 | §2-1 路线图 P1：**loop-hash 环检测**（同签名重复即便"成功"也算环） | ✅ **已实现且在生产链路上** | 实现 `agent/loop.ts:264 callSignature`(FNV-1a) + `:988-995` 累计判环；接线 `orchestrator.ts:2046` + `engine.ts:452` 读 `config.QOS_AGENT_LOOP_REPEAT_CAP` |
| AG-LC-03 | ↳ **该开关在生产是开的吗** | ✅ **容器态开** | `config.ts:46` 是 `.optional()` **无默认值**，代码 `loop.ts` 明写 `≤0 = 禁用` ⇒ 裸 `node dist/main.js` **禁用**；但 `docker-compose.yml:129` `QOS_AGENT_LOOP_REPEAT_CAP: ${…:-3}` ⇒ **容器部署默认 3**。**必须追这一层，只看 config.ts 会误判成「接了线没数据」** |
| AG-LC-04 | §2-2 State Monitor：`BudgetTracker` + `ContextBudgeter` | ✅ | `tools/budget.ts` + `agent/context.ts:309` |
| AG-LC-05 | §2-2 路线图 P3：per-iteration 结构化 trace 外透 | ❌ **没做**（PRD 自排 P3） | 未见 per-iteration 伪 step 外透 |
| AG-LC-06 | §2-3 Budget Controller：maxIterations + 三查 + per-call 有界超时 | ✅ | `loop.ts:584,586-590,622-668` |
| AG-LC-07 | §2-3 路线图 P2：**per-tool 调用上界** | ✅ **已实现** | `loop.ts:136 perToolCallCap` + `:977-985`；接线 `orchestrator.ts:2050`；容器默认 8（`docker-compose.yml:130`） |
| AG-LC-08 | §2-4 Retry Manager：连续权限拒绝 ≥3 → 强制收尾 | ✅ | `loop.ts:875-883` |
| AG-LC-09 | §2-4 路线图 P2：**区分瞬时错 vs 确定性错的有界重试** | ✅ **已实现** | executor 回执补 `retryable`（`tools/executor.ts:27,603,622`）；loop 侧 `:664-668` 有界重试；接线 `orchestrator.ts:2051`；容器默认 1（`docker-compose.yml:131`） |
| AG-LC-10 | §2-5 Goal Monitor：收尾质检 `reflectWithCritic` | ✅ | `loop.ts:304` |
| AG-LC-11 | §2-5 路线图 P3：mid-loop 目标偏离检测 | ❌ **没做** | 无周期性 goal-check |
| AG-LC-12 | §2-6 Deadlock：单 agent 停滞早停 | ✅ | `loop.ts:867` |
| AG-LC-13 | §2-6 路线图 P3：**跨 agent（Coordinator 扇出）死锁检测** | ❌ **没做** | `coordinator.ts` 无循环委派检测 |
| AG-LC-14 | §2-7 Escalation：`degrade()` 统一降级出口 | ✅ | `loop.ts:350-391` |
| AG-LC-15 | §2-7 路线图 P2：**EscalationLadder（换策略→Coordinator→降级）** | ✅ ⟪**已自纠**⟫ **已实现·暗发默认关** | 机制 `agent/loop.ts:507-530 maybeEscalate`（rung① 换提示策略再试一轮 + 复位停滞计数一次 + 一次性 `escalated` 状态位）；**rung② 升 Coordinator** `orchestrator.ts:2388`；rung③ 落既有 `degrade`。开关 `features/registry.ts:108` `agent.escalation` `defaultOn:false`。⚠️ 类名 `EscalationLadder` 确为 0 命中（金丝雀 K4 `BudgetTracker`=28 ✅）——**但那只证明"这个类名没被用"，不证明"这个机制没做"**（我第一版就栽在这一步，见 §0.1） |
| AG-LC-16 | §2-8 Progress Detection：`roundsWithoutSuccess` | ✅ | `loop.ts:844-851` |
| AG-LC-17 | §2-8 路线图 P1：与 Loop Detector 合并（signature 重复 = 无进度） | ✅ | 同 AG-LC-02 |
| AG-LC-18 | §2-9 Reflection Checkpoint：确定性 reflect + 暗发 critic + 有界重规划 | ✅ | `reflect.ts` + `loop.ts:223-239,281-284` |
| AG-LC-19 | §2-9 路线图 P3：周期性中途反思 | ❌ **没做** | — |
| AG-LC-20 | §3.0 所有终止汇聚唯一出口 `degrade()`，无第二条 return | ✅ | `loop.ts:350` |
| AG-LC-21 | §3.0 门 `loop-control:check` 静态断言"每 return 经 degrade" | ✅ ⟪**已自纠**⟫ **已实现且在 gates 链内** | `scripts/check-loop-control.mjs`（**六条判据**：唯一降级出口 / reason 白名单 / 环检测触顶 → `degrade(STALL_LOOP)` / S01 停滞早停 / R6 无 `Date.now`+随机 / **metric 已接线**）；具名 npm script `loop-control:check`；**在 `pnpm gates` 链内第 12 位**（`node -e` 实测链长 **29** 道） |
| AG-LC-22 | §3.1 `callSignature` 纯函数、稳定序列化、无 Date.now/random | ✅ | `loop.ts:260-264` 注释明写 |
| AG-LC-23 | §3.1 不误伤：签名含入参，不同入参各自独立计数 | ✅ | `loop.ts:992-994` |
| AG-LC-24 | §3.1〜3.4 各 SEAM 测试 | ✅ ⟪**已自纠**⟫ **五个全在** | `apps/agentcore/test/`：`loop-detector-seam.test.ts` · `retry-manager-seam.test.ts` · `per-tool-cap-seam.test.ts` · `escalation-ladder-seam.test.ts` · `escalation-reroute-seam.test.ts`（rung②）。⚠️ **本单未跑它们**（派单禁止），只核了文件存在 —— 「文件在」≠「断言咬链路」 |
| AG-LC-25 | §3.4 升级信号复用 `step.completed` 伪 step `type=agent_escalated` | ✅ ⟪**已自纠**⟫ | `agent/loop.ts:509`(注释) `:520`(`type:"agent_escalated"` 真 emit)；`orchestrator.ts:2388`（rung② 同款）；**未新增 §8.2 事件名**（守 QOS-PRD 一字不差） |
| AG-LC-26 | §3.4 暗发关闭 = 字节兼容 | ✅ | `features/registry.ts:108` defaultOn:false |
| AG-LC-27 | §4 无新端点 / 无新 REST | ✅ | 符合 |
| AG-LC-28 | §4 `AgentLoopOpts` 扩四个可选字段 | ✅ | `loop.ts:126,136,139` + `escalation` |
| AG-LC-29 | §4 `degraded.reason` 补 `"STALL_LOOP"` | ✅ | `loop.ts:461` 文案 + 枚举 |
| AG-LC-30 | §4 metric `qos_agent_loop_repeat_total` / `_escalation_total` / `_retry_total` | ✅ ⟪**已自纠**⟫ **三个全在** | `apps/agentcore/src/metrics.ts:108`(`qos_agent_loop_repeat_total`) `:113`(`qos_agent_retry_total`) `:118`(`qos_agent_escalation_total`)；生产 inc 点 `loop.ts:515 agentEscalation.inc()`；**且 `check-loop-control.mjs` 判据⑥ 就在守这条接线**（门坏了会红） |
| AG-LC-31 | §4 本层无新表（治理状态运行时内存态） | ✅ | 符合 |
| AG-LC-32 | §7 铁保证：任意病态输入下确定性终止且终态必经 degrade | ✅ | `qos-agent-timeout.test.ts` + 停滞早停 SEAM |
| AG-LC-33 | §8 P0 已落 / P1 待派 / P2 待派 / P3 排后 | 🔗 **PRD 自陈已过期** ⟪已自纠⟫ | **P1 与 P2 已完整交付**：loop-hash(`:264,988`) · `loop-control:check` 门(链内) · retry(`:664`) · per-tool cap(`:977`) · EscalationLadder rung①③(`:507`)+rung②(`orchestrator.ts:2388`) · 三个 metric · 五条 SEAM。PRD §8 写的「P1 待派 1 dev / P2 待派」**已不成立**。**只剩 P3 四项**（AG-LC-05/11/13/19），而 P3 是 PRD 自己排的「低优先·排后」 |
| AG-LC-34 | 附表 Agent OS Kernel 三模块交叉引用（事实断言） | ✅ | 三模块代码落点均复核属实 |

#### 2.2.4 `PRD-agent-navigation-slice-latency.md`（13 条 · ✅11 / ⚠️1 / ◐1）

| # | 条款 | 状态 | 证据 |
|---|---|---|---|
| AG-NAV-01 | §3-A 确定性优先门（`preferDeterministicSolver`） | ✅ | `router/domain-resolver.ts` + `orchestrator.ts` 前置判定 |
| AG-NAV-02 | §3-A 守则：低置信不劫持，字节兼容 | ✅ | `orchestrator.ts` 注释 + `qos-det-gate-seam.test.ts` |
| AG-NAV-03 | §3-B NavigationSlice 投影（对象/solver/链路/规则四类） | ✅ | `agent/navigation-slice.ts` `projectNavigationSlice` |
| AG-NAV-04 | §3-B 删 `prompts.ts:28`「先 discover」盲目指令 | ✅ | `agent/prompts.ts` 已改为切片驱动 |
| AG-NAV-05 | §3-B 复用 `catalog discover` + `slice-index` + `SOLVER_OUTPUT_SHAPES` | ✅ | 同上 |
| AG-NAV-06 | §3-C 规划式执行 plan 模式（保 ReAct 兜底） | ✅ | `agent/loop.ts` plan 模式 + `planFellBackToReAct` |
| AG-NAV-07 | §3-D 模型分层（快模型做选型/规划） | ✅ | 用途绑定矩阵 |
| AG-NAV-08 | §4-1 SEAM：Q5 走 path-A `deterministic:ceo-route`，#20 不误降级 | ✅ | `test/qos-det-gate-seam.test.ts`(6/6) |
| AG-NAV-09 | §4-2 SEAM：agent 首轮 prompt 含 NavigationSlice，discover ≤1 | ✅ | `test/qos-agent-slice-seam.test.ts`(11/11) |
| AG-NAV-10 | §4-4 R6：NavigationSlice 确定性投影（同问句同 seed 字节一致） | ✅ | 纯函数投影 |
| AG-NAV-11 | §5 断点 `G-AGENT-BLIND-REACT` 已回写本体 | ✅ | `docs/SYSTEM-ONTOLOGY.md §8` |
| AG-NAV-12 | ⚠️ 一处死代码：`buildNavigationSliceSection` | ⚠️ **没接线** | 实现 `agent/navigation-slice.ts:384`；引用方只有 `test/qos-agent-slice-seam.test.ts:9,125` |
| AG-NAV-13 | §7.4 待确认：真 Kimi 20 题 live 重测（137s → path-A <5s） | ◐ **未判定** | **需起服务 + 真 LLM，本单未做**。PRD 自己也标为「唯一未闭环」 |

#### 2.2.5 `PRD-agent-data-generation-tools.md`（24 条 · ✅8 / 🔗3 / ⚠️2 / ❌6 / ⛔4 · 另 1 ◐）

| # | 条款 | 状态 | 证据 |
|---|---|---|---|
| AG-DG-01 | 目标 1：`fill_data` 进 `BUILTIN_TOOLS` + executor case | ✅ | 注册 `tools/registry.ts:295`；分派 `tools/executor.ts:413` |
| AG-DG-02 | 目标 1：`run_synthetic` | ✅ | `registry.ts:312` / `executor.ts:422` |
| AG-DG-03 | 目标 1：`build_domain` | ✅ | `registry.ts:329` / `executor.ts:431` |
| AG-DG-04 | 目标 2：生成数据落 PROVISIONAL，agent 可读可推演不计真值 | 🔗 **只做了标注侧** | 回执带 `provisional: true`（`executor.ts:418,428,436`），但**未见 query 工具读回时附 `unverified:true`**（§3.2 后半） |
| AG-DG-05 | 目标 3：回执只含 jobId/seriesKeys/rowCount/connId，无业务数字 | ✅ | `executor.ts:413-437` 三个 case 均只回执 + `_note` |
| AG-DG-06 | 目标 3：答案数字必须引自 `query_*` 的 ⟦ref⟧ | ✅ | `_note` 文案强制 + `reflect.ts` 数字落地检查 |
| AG-DG-07 | 目标 4：空租户闭环（判缺 → 合成 → 读回 → 推演 → 标未审核） | ◐ **未判定** | **需起服务真跑空租户，本单未做** |
| AG-DG-08 | 目标 5：四面同源（前端缺口卡 / agent 工具 / CLI op / 后端管线） | 🔗 **三面成立，一面缺** | CLI 有 `synth`(`platform-cli.mjs:389`) 与 `build`；**无 `fill-data` 子命令** |
| AG-DG-09 | §3.2 answer 必带「基于本轮合成的未审核数据」标注 | ✅ | `executor.ts:428` `_note` |
| AG-DG-10 | §3.2 转正经 `create_action_draft` → R4 审批 | ✅ | `executor.ts:439` `create_action_draft` case 在 |
| AG-DG-11 | §3.3 executor 对三工具结果做 schema 校验，禁止把回执当业务答案 | ⚠️ **靠文案不靠 schema** | 现实现是 `_note` 文本提醒 + reflect 数字落地检查，**未见对三工具回执的独立 schema 校验** |
| AG-DG-12 | §3.4 三工具同步登记 `OPERATION_CATALOG`（`cli-parity:check` 过） | ❌ **fill_data 未登记** | `packages/contracts/src/operation-intent.ts` 有 `op:"synth"`(`:59`) 与 `op:"build"`(`:60`)，**`fill` 全文 0 命中**（金丝雀 K3 ✅） |
| AG-DG-13 | §4 `clients.ts` 加 `synthetic.runJob` / `databuilder.runStory` | ✅ | `this.deps.dataCore.datagen.runSynthetic/buildDomain`（`executor.ts:423,432`） |
| AG-DG-14 | DoD：`chain:check` / 冒烟过（命中真实端点） | ⚠️ **未见针对三工具的 chain 断言** | 本单未核门内容 |
| AG-DG-15 | DoD：回写本体 §2.D7/§3/§7/§8（含 G-3 agent 侧闭合） | ❌ **未见 G-3 状态更新** | 本单未在本体 §8 找到 G-3 因本 PRD 改状态的记录 |
| AG-DG-16 | §8 分期 ADT.3：前端缺口卡对接（in-dialog-gap-fill） | ❌ | 未见 |
| AG-DG-17〜24 | 非目标 3 条（⛔）+ §6 非功能 4 条 + §2 现状断言 | ⛔4 / ✅2 / ❌2 | 非目标「不让 agent 编数字」「不把合成当真值」「不重写后端」**三条均未被违反** |

#### 2.2.6 `PRD-llm-agent-empty-response-guard.md`（6 条 · ✅6 —— 三个域里唯一 100% 的一份）

| # | 条款 | 状态 | 证据 |
|---|---|---|---|
| AG-GD-01〜06 | `LlmEmptyResponseError` 定义 / loop 早失败护栏 / toolLoop 同款护栏 / R7 信封映射 / 兜底路由 / 10 处 src 引用 | ✅ | `packages/llm-adapters/src/types.ts:172` · `agent/loop.ts:821` · `packages/llm-adapters/src/toolloop.ts:25` · `orchestrator.ts:2740` · `orchestrator.ts:2266` |

#### 2.2.7 总纲 §8.1 B1（Agent 注册表）逐条

| 条款 | 状态 | 证据 |
|---|---|---|
| `AgentDefinition{id,tenantId,key,version,name,description,model,systemPrompt,tools,ruleBindings,skills,mcpServers,scopeDeclaration,budget,status}` | ✅ | `packages/contracts/src/agentcore.ts` |
| `AgentToolRef` 三类（BUILTIN / MCP / WORKFLOW） | ✅ | `engine.ts:406` 展开三类；`engine.ts:306` MCP 全名 |
| `ruleBindings` POST_CHECK：回答产出后调 A5 校验，BLOCK 违规 → 拦截重写 | ✅ **已实现且在生产链路上** | `engine.ts:526-534`；种子 7 个 agent 全是 `mode:"POST_CHECK"`（`mocks/seed.ts:1394,1424,1442,1460,1479,1497,1515`）⇒ **接了线有数据** |
| `scopeDeclaration` 第一道闸门 | ✅ | `engine.ts` `enforceAgentObjectScope`；59 处 src 引用 |
| `skills` 注入：summary 常驻 + `load_skill` 渐进披露 | ✅ | 同 §2.1.5 SK1 |
| Agent 执行器 = QOS §6.3 手写工具循环 | ✅ | `agent/loop.ts` |
| **AgentRunRecord 能归属到哪个 Agent** | ❌ **没做（已登记断点）** | `AgentRunRecord` **无 `agentId` 字段** ⇒ Agent 管理页的运行列表只能显示「本租户 AGENT 路径的运行」，**不是「本 Agent 的运行」**。已登记 `G-AGENTRUN-NO-AGENT-ATTRIBUTION`（`docs/AUDIT-agent-console-gap.md` §7） |

---

### 2.3 本体切片域逐条

#### 2.3.1 `PRD-A3-multihop-slice-completion.md`（25 条 · ✅17 / 🔗2 / ⚠️1 / ❌4 / ⛔1）

| # | 条款 | 状态 | 证据 |
|---|---|---|---|
| SL-A3-01 | §1 A3.1 14 域参考注册表 | ✅ | `apps/datacore/src/graphmeta.ts BUSINESS_DOMAINS`（15 处 src 引用，金丝雀 K5） |
| SL-A3-02 | §1 A3.2 域内/跨域两库 | ✅ | `apps/datacore/src/ontology/slice-library.ts`；生产 import `app.ts:60` |
| SL-A3-03 | §1 A3.3 多跳规划器（确定性路径搜索 + 固定 tie-break） | ✅ | `apps/datacore/src/ontology/slice-planner.ts`；端点 `app.ts:2942` |
| SL-A3-04 | §1 A3.4 索引 + `lookupReusable` | ✅ | `ontology/slice-index.ts:48`；生产调用 `app.ts:2949` |
| SL-A3-05 | §1 端点三条（`/slices/plan` · `/slices/library` · `/slices/library/build`） | ✅ | `app.ts:2942 / 2968 / 2979` |
| SL-A3-06 | §1 消费：agentcore tools + 前端 endpoints 已接 | ✅ | `agentcore/src/tools/datacore-http.ts:114` + `clients.ts:25`；前端 `endpoints.ts:1114,1117` |
| SL-A3-07 | §2 WO-A3-REFBASE：元租户 ≈95 节点参考本体基线 | ✅ **已实现** | `apps/datacore/src/ontology/refbase.ts:11 META_TENANT_ID = "__refbase"`；`generateRefbaseOntology` 生产 import `app.ts:62` |
| SL-A3-08 | §2-1 确定性种子（seed 默认 42，同 seed 字节一致 R6） | ✅ | `refbase.ts:212 refbaseDigest` |
| SL-A3-09 | §2-2 R2 隔离：只写元租户，业务租户 404/空 | ✅ | `META_TENANT_ID` 常量 + `app.ts:2104` 端点 |
| SL-A3-10 | §2-3 覆盖验收报告（电池 66 类型 → 14 域映射覆盖表，诚实列缺） | ✅ | `apps/datacore/src/ontology/refbase-coverage.ts` `buildBatteryDomainCoverage`；生产 import `app.ts:63` |
| SL-A3-11 | §2-4 门：`pnpm gates` 新增 refbase 检查（节点数/域覆盖/确定性）+ tooth 测试 | ❌ **没做** | `scripts/` 下无 `check-refbase*`（金丝雀：同目录 `check-slice-connectivity.mjs` 存在 ⇒ 目录可读）。端点 `app.ts:2104` 只是**只读投影**，不是门 |
| SL-A3-12〜16 | §2 验收 C1–C5 | ✅3 / ❌2 | C1 确定性 ✅(`refbaseDigest`)、C2 租户隔离 ✅、C3 节点计数 ✅(`refbaseNodeCount:202`)、C4 覆盖报告 ✅；**C5「不比基线更红」本单未跑测试 ⇒ 未判定** |
| SL-A3-17 | §3-1 切片约束一等化：`mustIncludeTypes/mustIncludeLinkKeys` 从写死 seed → 引用一等 RuleEntry | ❌ **没做** | `apps/datacore/src/synthetic/battery.ts` 仍写死；未见 `rule.params` 承载切片验收 |
| SL-A3-18 | §3-2 QOS 动态切片深接（agentcore 经 tools 调 `/slices/plan`，trace 见 planned/reused） | ✅ | `agentcore/src/server.ts:2698`（卡声明 `sliceTargets` → 自动 `planSlice`）+ `clients.ts:25` |
| SL-A3-19 | §3-2 `slice.planned` 事件 → 索引重建 | ✅ | `agentcore/src/event-subscriptions.ts:64`（`invalidates: ["slice-library","slice-index"]`）；单源发在 DataCore（`server.ts:2709` 注释明写不重复发） |
| SL-A3-20 | §3-3 admin「切片库」页（列表 + 规划 tab，只接真端点零假数据） | ✅ | `apps/frontend-shell/src/pages/admin/SliceLibraryPage.tsx:15`；路由 `App.tsx:175` |
| SL-A3-21 | §3-4 SHAPE 门扩：slice-planner 输出形状纳入 `chain:check` | 🔗 **部分** | `scripts/backend-frontend-seam-baseline.json:40` 收录 `GET /a/v1/meta/refbase`；**未见 slice-planner 输出形状的 tooth 测试** |
| SL-A3-22 | §3 验收 C1 编辑规则 params → slice-contracts 验收随之变 | ❌ | 随 SL-A3-17 |
| SL-A3-23 | §3 验收 C3 真浏览器截图 | ⚠️ **未判定** | 本单未起服务 |
| SL-A3-24 | §3 验收 C6 回写 `SYSTEM-ONTOLOGY.md` | ✅ | 本体已含切片相关章节 |
| SL-A3-25 | §4 非目标三条（勿碰正线红测试 / 勿重写 A3.2-4 / July port 另单） | ⛔ | 未被违反 |

#### 2.3.2 `IMPLEMENTATION-phase1-4-slice-rules.md`（24 条 · ✅23 / ⛔1）

> 这是**实施记录**（回顾型），条款形态是「已完成 X」。判据 = 「今天这句话还成不成立」。

| # | 声称 | 状态 | 证据 |
|---|---|---|---|
| SL-IM-01 | `resolve_slice` 工具 fall-through 到通用 SliceSpec 引擎，可检索 `order_fulfillment_360`/`order_to_cash_720`/`enterprise_360` | ✅ | 工具 `tools/registry.ts:46`；四条多跳切片在 `apps/datacore/src/synthetic/battery.ts:2447/2492/2560/2601` |
| SL-IM-02 | 新增 13 条跨域链路边 + 2 条 8 域切片落库 | ✅ | `battery.ts` 派生边；`ONTOLOGY-SLICE-GAPS.md` 实测本体 **类型 94 / 链路 85** |
| SL-IM-03 | `supply`/`commercial` 域补注册 | ✅ | `battery.ts:1737,1739` 注释明确归域 |
| SL-IM-04 | 8 条规则引用不存在属性的哑弹已闭合，C03/C08/C13 真实数据 violations>0 | ✅ | `synthetic.test.ts` SY-rules-live 回归锁 |
| SL-IM-05 | Phase 5A Finance 域 → `order_to_cash_720` 升至 9 域 | ✅ | `FinanceAccount`/`FinanceMetric` + `base_finance`/`scenario_to_finance` |
| SL-IM-06 | Phase 5C `skill-router.ts` 语义路由 | ✅ | `agentcore/src/agent/skill-router.ts` |
| SL-IM-07 | Phase 6B `countermeasure_combo` meta-solver | ✅ | 求解器目录 |
| SL-IM-08 | Phase 6C `mcp-router.ts` | ✅ | `agentcore/src/agent/mcp-router.ts` |
| SL-IM-09 | Phase 6E `aop_scenario_chain`（AnnualScenario 根） | ✅ | `battery.ts:2601` |
| SL-IM-10 | Phase 7A `order_to_plantarget` → 10 域 | ✅ | `ONTOLOGY-SLICE-GAPS.md` bridge-link 表含 `order_to_plantarget` |
| SL-IM-11 | Phase 7B embedding 向量余弦排序 + `Embedder` 可插拔 | ✅ | `production-cognition.buildProviderEmbedder` |
| SL-IM-12 | Phase 7C 消息级滚动摘要 | ✅ | `agent/context.ts` + `production-cognition.llmRollingSummarizer` |
| SL-IM-13〜16 | Phase 8 A–D（厂商目录 / 配置页 / summarizer 接 LLM / Embedder 接 provider） | ✅ | `LLM_VENDOR_CATALOG` + `LlmProvidersPage` |
| SL-IM-17〜19 | Phase 9 A/B/C（10 场景真跑落历史 / 对象级 Action CRUD / 推演历史列表页） | ✅ | `GET /b/v1/queries` + 前端「推演历史」页 |
| SL-IM-20 | 各 Phase 声称的测试计数（datacore 244→248 / agentcore 173→192 / frontend 106 / parity 129/129） | ⛔ **本单未跑测试** | 派单禁止跑 `pnpm -r test` ⇒ **这些数字本单未复核**（见 §5） |
| SL-IM-21 | P0-c `finance` 域无对象类型 —— 标「⏳ 后续 Phase 5」 | ✅ **已闭**（Phase 5A） | 见 SL-IM-05 |
| SL-IM-22 | 证据 Excel `deliverables/enterprise_360-8域推演节点.xls` | ✅ ⟪**已自纠**⟫ **设计如此** | `deliverables/` 在 `.gitignore:27` —— 是**跑复现命令产出的目录**，本就不该进仓。第一版我把「不在仓库」错当「不存在」 |
| SL-IM-23 | 复现命令 `node scripts/slice-scenarios-excel.mjs` | ✅ ⟪**已自纠**⟫ | `scripts/slice-scenarios-excel.mjs` **存在**（⚠️ 本单**未跑**它，只核了文件在） |
| SL-IM-24 | 接真实大模型三步运维说明 | ✅ | `LlmProvidersPage` + `QOS_ROLLING_SUMMARY_LLM` + `QOS_EMBEDDING_*` |

#### 2.3.3 `AUDIT-slice-16-layers.md` 的四项承载物结论（5 条 · 复核「今天还成不成立」）

| # | 结论 | 今日状态 | 证据 |
|---|---|---|---|
| SL-16L-01 | 「切片页只有 2 条记录」是**前端 mock**，真后端 98 条 | ✅ 成立 | mock `frontend-shell/src/mocks/handlers.ts:746-747`；真后端 98 条（4 条多跳 + 94 条 `coverage_*`） |
| SL-16L-02 | ⑥事件层**有**承载物且 372 条真实例 | ✅ 成立 | `ExceptionEvent` 一等对象；契约 `packages/contracts/src/exception-event.ts` |
| SL-16L-03 | ⑨时间语义**有**多个承载物，真缺口是「没数据」（94 类中 `temporal=true` 的属性 **0 个**） | ⚠️ **接了线没数据** | `domain.ts:223 PropertyDef.temporal` + `:404 ObjectPropHistoryRecord` + `:866 SimulationClockRecord` |
| SL-16L-04 | ①业务场景层 `sliceReferences` 恒空，因**上游只上报 rule 引用** | 🔗 **接了线接错地方** | 承载物 `datacore/src/ontology-governance.ts:336`，已接路由 `app.ts:2371/2375`；上游 `agentcore/src/refs/report.ts` 只产 `agentRuleRefs`/`planStepRuleRefs`，三处调用点（`server.ts:726` `server.ts:1069` `catalog/service.ts:286`）传的都是 `ruleRefs`，**从不产 `kind:"slice"`** |
| SL-16L-05 | 12 条无参空切片的两分（4 条缺参 / 8 条 `coverage_*` 缺数据） | ✅ **已被今天的修复接管** | 后端 `ontology/slice-layers.ts:82 diagnoseEmptyGraph` 三分；前端 `SliceLayersPanel.tsx:87 EmptyGraphBar` |

#### 2.3.4 `SLICE-order-fulfillment-360.md`（8 条）

| # | 条款 | 状态 | 证据 |
|---|---|---|---|
| SL-360-01〜05 | 切片 `order_fulfillment_360` 存在 / root=Order / 12 跳 / 跨域可达 / 可被 `resolve_slice` 检索 | ✅ | `battery.ts:2492`（root selector `{{args.so}}`）；98 条实测里 hops=12 |
| SL-360-06 | root selector 需 `args.so` 参数 | 🔗 **设计如此·首屏未给** | 见 §1.3 序 1 |
| SL-360-07 | 切片被 QOS 消费进 solver 上下文 | ⚠️ **未判定** | 需起服务真跑 |
| SL-360-08 | 前端可视 | ✅ | `SliceLibraryPage.tsx` + `SlicesPage.tsx` + `SliceLayersPanel.tsx` |

---

## 3 · 「我以为做了其实没做」清单（本单最贵的一类账）

> 判据：文档 / 账本 / 注释里**正面陈述某物已存在 / 已生效 / 已完成**，而实测不成立。
> **「本期不做」不算缺口，「宣称做了」才是。** 两个方向都有害：说做了其实没做 → 验空气；说没做其实做了 → 重复造门。

### 3.1 方向 A：说做了，其实没做（会导致「按文档验收 = 验空气」）

| # | 出处 | 宣称 | 实测 | 危害 |
|---|---|---|---|---|
| **A-01** | `PRD-addendum-skill-authoring.md:37` | 「触及门禁：`skill-lint:check`」 | 该门名在 `package.json` 与 `scripts/` **0 命中**（金丝雀 `ref-closure:check`=10）。真实形态是**发布路的运行态门**，不是 CI 门 | 下一个人 `pnpm skill-lint:check` 得到「命令不存在」，或误以为 CI 已守住而不看发布路 |
| **A-02** | 同上 `:38` | 「`skill-eval:check`（…SkillProbeRunner 挂载**真实 agent** 全过）」 | 门名 0 命中；「真实 agent」实为 `ensureProbeAgent`/`ensureTwinAgent` **自动创建的探针 agent**（`skill-probe.ts:189,231`），不是任何业务 agent | 「真实 agent」措辞让人以为覆盖了生产 agent 的挂载组合 |
| **A-03** | 同上 `:39` | 「`ontology-writeback:check`…本次补录同步满足」 | 脚本 `scripts/check-ontology-writeback.mjs` 存在，**不在 `package.json` 的 `gates` 串里** ⇒ 「同步满足」**没有机器在守** | 门名漂移下次不会被机器抓到 |
| **A-04** | 同上 `:33` R13 | 「无行为增益的技能被评测门禁拒」 | 机制真实且绿，**但 seed 中 `skill_quality` 用例 0 条** ⇒ 出厂 7 个 Skill **一个都跑不到这道门** | 门是真的，门后没有人走过 |
| **A-05** | 同上 `:95` §5 | 「出厂范例 `production-capacity-interpretation`」 | 代码中 **0 命中**（金丝雀 `capacity_analysis`=2）。该名字的 Skill 不存在、配套 EvalCase 不存在、反例对照不存在 | SA2/SA3 两条验收的**被测对象不存在** ⇒ 验收不可执行 |
| **A-06** | 同上 `:35` R16 | 「发育闭环：Skill 发布经 lint+eval 两门」 | 门是真的，**但出厂数据走旁门**：`apps/agentcore/src/main.ts:29` `repos.skills.insert(sk)` 直插仓储，5 个种子以 `PUBLISHED` 落库，**一次也没经过 `POST /b/v1/skills/:id/publish`**。实测 7/7 能过 lint，但 `skill_quality` 用例 0 条 ⇒ **走正门 7/7 会被评测门拦** | 「门装上了」被读成「库里的东西都过了门」。任何拿出厂 Skill 当「达标样例」的推理都不成立 |
| **A-07** | `PRD-skill-crossreview.md:202` §9 收口表 **C1 行标 ✅** | 「已裁决 · 采纳 `requires` 结构 · 写入 SPEC §9.1」——收口表的 ✅ 读作「本条已全闭」 | `SkillDefinitionSchema`（`agentcore.ts:236-261`）18 字段**无 `requires`**；**无归一层**；消费方 `skill-lint.ts:343/347` + `resource-projector.ts:333/334` 直读原字段；`WO-SKILL-MIG-G3` **未派单** | 🔴 **最高** —— 裁决已下 7 天零派单，且它是 M0 的硬前置（名字定错 = 32 份返工） |
| **A-08** | `PRD-skill-crossreview.md:206` §9 **C5 行标 ✅** | 「两份 PRD 均已全文替换…残留裸「Phase N」= 0（机械核过）」 | 两份 PRD 确为 0 ✅，**但同批一起改的 `SPEC-industrial-skill.md` 仍有 2 处**（`:111` `:255`） | 「机械核过」的**扫描范围小于读者理解的范围** |
| **A-09** | `docs/SYSTEM-ONTOLOGY.md` §7 | 六道门（`sim:check`/`propagation:check`/`sim-readiness:check`/`solver-license:check`/`opt-template:check`/`opt-determinism:check`）**「已并入 `pnpm gates`」** | 六道**脚本文件都在**，但 `gate-ledger.json` 里 `binding` 均**非 GATES_CHAIN** ⇒ **不在链内** | 已被 `gate-ledger:check` 的 `pendingWireCount` 棘轮接管（有门在守） |
| **A-10** | `PRD-skill-contract-dsl.md` §2 基线表 | `maxBudgetRounds`「沿用字段名 **+ 接消费方**：归一到 `AgentBudget.maxRoundTrips`。**这是 Track E 约束 4 的硬验收**」 | **半成立**：`partial-a` 并入后有了归一函数（`agentcore.ts:224 skillBudgetOverride`）与唯一读点，**但读点在 eval 探针路**（`skill-probe.ts:133`），生产 6 处 `BudgetTracker` 全走 `residualBudgetFromConfig()` | 用户填了预算**跑起来毫无变化**（§1.3 序 4） |
| **A-11** | `CMP §0 R3` | 「新模块暗发 `skill.compiler`（`defaultOn:false`），双注册 DataCore + AgentCore，关闭 = 404」 | `POST /b/v1/skills/:id/compile`（`server.ts:1465`）**无任何 entitlement 门**，只有 `auth` + `requireCatalogAdmin`；`"skill.compiler"` 字面量全仓 **0**（金丝雀 K2=17） | **R3「Entitlement 先于 authz」实打实被违反**（§1.3 序 3） |
| **A-12** | `CMP §8.1` | 「✚ `POST /b/v1/skills/:id/compile`；**`?dryRun=true` 不落库**」 | 端点在，但**不接受 `dryRun` 查询参数**（`server.ts:1462` 注释写「dryRun 语义即默认且唯一行为」） | 语义等价但**契约不符**：SDK/CLI 按文档传 `?dryRun=true` 会被静默忽略 |
| **A-13** | `CMP §12.2 S2` | 「返 503 `DATACORE_UNAVAILABLE`」 | 实现返 503 **`REF_PROBE_UNAVAILABLE`**（`apps/agentcore/src/resources.ts:26`） | 行为对、码不对，前端按文档写的错误分支会落进 default |
| **A-14** | `PRD-agent-react-harness.md §10.3` | 「新增 `agent.reflected` 事件」 | 全仓 0 命中。**本体已诚实回写**（`SYSTEM-ONTOLOGY.md:329`「实现改为不新增」），**PRD 未同步** | 读 PRD 的人会去订阅一个不存在的事件 |
| **A-15** | `PRD-agent-execution-governance-loop-control.md §8` 分期表 | 「P1 待派 1 dev / P2 待派」 | **P1 与 P2 已完整交付**（loop-hash `loop.ts:264,988` · `loop-control:check` 门在 gates 链内 · retry `:664` · per-tool cap `:977` · Escalation rung①③ `:507` + rung② `orchestrator.ts:2388` · 三个 metric `metrics.ts:108/113/118` · 五条 SEAM），且容器态默认开（`docker-compose.yml:127-131`） | **方向反了，且幅度最大**：照此表派单会重复做**两整期已完成的工作**。⚠️ 我第一版也被它误导（§0.1） |
| ~~**A-16**~~ | ~~`IMPLEMENTATION-phase1-4-slice-rules.md §4`~~ | ~~证据 Excel 与复现脚本不在仓库~~ | ⟪**本条已撤回**⟫ `scripts/slice-scenarios-excel.mjs` **存在**；`deliverables/` 是 **`.gitignore:27` 声明的产物目录**，本就不该进仓。**是我错了，不是文档错了** | — |
| **A-17** | `PRD-A3-multihop-slice-completion.md §2-4` | 「门：`pnpm gates` 新增或扩展一条 refbase 检查 + tooth 测试」 | `scripts/` 下 55 个 `check-*.mjs` **无 `check-refbase*`**（单符号单跑无 `head`；金丝雀 `check-ref-closure.mjs` 存在 ✅） | refbase 的确定性/节点数今天**没有机器在守** |

### 3.2 方向 B：说没做，其实做了（会导致「重复造门 / 排期歪掉」）

| # | 出处 | 宣称 | 实测 | 危害 |
|---|---|---|---|---|
| **B-01** | `SPEC-industrial-skill.md:231` §5 | 「（引用可校验）**这道门今天做不了**（无任何一处声明）」 | **已过期**：rule/solver/ontologyType 三种 kind 的存在性探针已接上 skill 发布路（**今日实测 `server.ts:1317`**），死路引用 `422 SKILL_REF_UNRESOLVED` 且未落库、fail-closed 不可 force | 照此文安排工作会**重复造一道已存在的门**（CLAUDE.md 铁律 0.5 记载的第三类错原样复发） |
| **B-02** | `PRD-skill-contract-dsl.md §11.1` / `§10.1` | 「发布路径只有 lint + eval + probe 三段，**无跨注册表引用校验**」/「注释里承诺的那个探针，在 skill 这条路上**没人调**」 | 同 B-01，已过期 | 同上 |
| **B-03** | `SPEC-industrial-skill.md:113` §2-⑧ | 「`G-C08-EXPR-PARAM-SPLIT` 🔴 —— DSL 的 expression **不能引用 params**…静默恒假不报错」并列「三条最该先做」第 2 位 | **已修**：`ruledsl.ts:318-325` `params.<名>` 是一等操作数；`:357-361` 未提供即**抛错**；`:414-420 collectParamRefs` 供发布期校验 | 按 SPEC 排期会把已完成项当"最该先做"，**挤掉真缺口** |
| **B-04** | `SPEC-industrial-skill.md:116` §2-⑪ | 「`outputSchema` **零消费方**」 | **前半过期**：有 2 个 src 消费方（`skill-lint.ts:342` 形状校验、`resource-projector.ts:149` 投影 `outputSpec`）。**后半仍成立**（无人拿它校验实际输出） | 「零消费方」会被读成"删了没影响"，删掉会断 DRIL 检索的 `outputSpec` |
| **B-05** | `PRD-skill-crossreview.md:204` §9 **C3 行标 🟡「仍无人认领」** | 「合并门账尚未立单。任一份 PRD 落地前必须先有这张账」 | **账已立、门已接、棘轮已上**（`scripts/gate-ledger.json` + `check-gate-ledger.mjs` 在 gates 链末位） | 反向宣称，同样歪排期 |
| **B-06** | `PRD-skill-migration.md:152` §1.5 G2 | 「`expression` 不能引用 `params`，静默恒假不报错」 | 同 B-03，已被 `WO-RULE-EXPR-PARAMS` 修掉。**但 §10.2 的真交付物只做了一半**：`kind:"field"` 拼错仍静默恒假（`resolveField:450` 带前缀回退） | 方向反了（文档低估了进展），但残留一半是真的 |
| **B-07** | `CMP §1.2` 非目标 | 「**不做** Skill Orchestrator（多 Skill 编排 / Skill Graph 运行时）」 | `orchestrator-s1` 已并：`GraphScheduler`（`skill-orchestrator.ts:95`）+ `POST /b/v1/skill-graphs/run`（`server.ts:1432`） | 该行已过期；不回写则下一个人以为 Skill Graph 运行时不存在 |
| **B-08** | `AUDIT-slice-16-layers.md` 派单原文 | 「16 层缺 ①业务场景 ⑥事件 ⑨时间语义」 | ⑥⑨ **都有承载物且有数据/有多个承载物**（`ExceptionEvent` 372 实例；`temporal`/`ObjectPropHistoryRecord`/`SimulationClockRecord`） | 若信了会去**造事件模型 / 时序语义（数周）**，而真实修法是**补取数（1 天）** |

### 3.3 计数漂移（不是「宣称做了」，但同样误导排期）

| # | 出处 | 文档说 | 实测 |
|---|---|---|---|
| C-01 | MIG §0/§12.2/§13 · XR §3 | `pnpm gates` = **16** 道 | **今日实测 29 道**（`node -e` 解析 `package.json.scripts.gates`；`scripts/` 下共有 **55** 个 `check-*.mjs`，**26 个不在链内**）。上游 CHECK 订正为「26」也已再次过期 |
| C-02 | MIG §0/§12.2 | 迁移后聚合 16 → **23** | 基数已两次漂移，本单只订正现值 **29** |
| C-03 | XR §3 | 现有 16 + 新 17 = **33** | 现有 **29** + 新 **0** = 29 |
| C-04 | MIG §1.2/§5.3/R-F | `inputSchema` 空壳 **17/32** | **5/32** |
| C-05 | MIG §0 CLI 段 | `OPERATION_CATALOG` **17 条** | **39 条**（结论仍成立） |
| C-06 | CMP §2.4 + §14.2 | 手写 **4** + catalog 16 + ceoCaps **12** = 32 | **5 + 16 + 11 = 32**（**两个错互相抵消**，总数碰巧对） |
| C-07 | CMP §4.2 + §14.3 | `SOLVER_KEYS` 静态可数 **57** 条 | **59** |
| C-08 | XR §表 | migration **534** 行 · runtime **720** 行 | 实测 migration **545** · runtime **725**（今日 `wc -l`：migration **660** · runtime **789** —— **又漂了**） |

---

## 4 · 本体引用与影响（铁律 0）

> 本单**只写审计文档，不改本体**。以下是本单触及的本体元素清单；**建议新增的断点写在 §4.5，未擅自写入 `docs/SYSTEM-ONTOLOGY.md`。**

### 4.1 触及对象类型（本体 §2）

| 域 | 对象类型 | 本单如何触及 |
|---|---|---|
| §2.H 交互/编排域 | **Skill** · **SkillReference** · **SkillAttachment** · **AgentDefinition** · **AgentRunRecord** · **Task/Query** · **EvalCase(suite=skill_quality)** · **ExecutionPlan** | 只读盘点其字段承载物与消费方 |
| §2.H | **Coordinator** · **SceneEntry** | 只在链路上被引用 |
| §2.B | **OntologyType** · **OntologyLink** · **SliceSpec** · **OntologySlice** | 切片域逐条对账的主体 |
| §2.C | **RuleEntry** | 引用可校验门的被校验对象（N-01 的主体） |
| §2.D | **SyntheticJob** · **BuildPlan** · **ObjectInstance(PROVISIONAL)** · **TsSeries** | `fill_data`/`run_synthetic`/`build_domain` 三工具的产出 |
| §2.E | **Solver** | NavigationSlice 与引用探针的被引用方 |
| §2.G | **FeatureFlag** | `agent.critic`(`registry.ts:104`) · `agent.escalation`(`:108`) · **缺失的 `skill.compiler`** |

### 4.2 触及链路（本体 §3）

- **编排链 path-B**：`Query --classify--> {path-A 确定性 | path-B agent}` → `runAgentLoop`（NavigationSlice 注入 → plan/ReAct → 三刀上下文清理 → 治理守卫序列 → reflect 收尾 → degrade 唯一出口）。**本单复核了这条链的每一站，未发现断点**。
- **Skill 引用链**：`Skill --references|dependsOn--> {rule|constraint|slice|ontologyType|solver|skill|workflow|agent}` → 发布期由 `probeMissingRefs` 校验**三种 kind**（rule/solver/ontologyType）；**`constraint`/`slice`/`workflow`/`agent` 四种 kind 今天仍无人校验**（`skill-lint.ts:203-217` 注释自承）。
- **切片链**：`问句 → QOS → (lookupReusable 命中即复用 | 未命中 → POST /a/v1/slices/plan) → 切片入 solver 上下文 → 答案`。**agentcore 侧接线在**（`server.ts:2698` + `clients.ts:25`），**是否真被 QOS 主路径调用本单未判定**（需起服务）。
- **十六层投影链**：`GET /a/v1/ontology/slices/{key}/layers` → `projectSliceLayers` → `SliceLayersPanel`。**通，但首屏起手参数为空**（§1.3 序 1）。
- **引用上报链**：`agentcore/src/refs/report.ts → POST /a/v1/references/report → sliceReferences`。**只产 rule 引用，从不产 `kind:"slice"`** ⇒ 十六层①业务场景层恒空。

### 4.3 触及事件（本体 §4）

- `skill.published`（L4，B 栈）：沿用，未改。
- `slice.planned`：单源发在 DataCore，agentcore 订阅失效 `slice-library`/`slice-index`（`event-subscriptions.ts:64`）。
- `routing.degraded` / `step.started` / `step.completed`（伪 step `agent_narration`/`agent_degraded`）：治理层复用，**未新增事件名**（守 QOS-PRD §8.2 一字不差）。
- **`agent.reflected`：PRD 计划新增，实现改为不新增，本体已回写（`SYSTEM-ONTOLOGY.md:329`），PRD 未同步**（A-14）。
- **`agent_escalated` 伪 step：随 EscalationLadder 一起未实现**（AG-LC-25）。

### 4.4 不变量核对（本体 §5 · R1–R12+）

| 不变量 | 本单结论 | 证据 |
|---|---|---|
| **R2 tenant_id everywhere** | ✅ 未见违反 | skill/agent/slice 三域端点均先 `auth(req)` 再校 `tenantId`，跨租户 404（`server.ts:1465` compile 端点亦然） |
| **R3 Entitlement 先于 authz** | 🔴 **被违反 1 处** | `POST /b/v1/skills/:id/compile` 无 entitlement 门（A-11 / §1.3 序 3）。CMP §0 R3 白纸黑字要求暗发 |
| **R4 写降级 / 未审核态** | ✅ | 三把数据生成工具回执带 `provisional:true`，转正走 `create_action_draft`（`executor.ts:439`） |
| **R6 确定性地板** | ✅ | `callSignature` 纯函数无 `Date.now`/随机（`loop.ts:260-264`）；NavigationSlice 确定性投影；refbase `refbaseDigest`；`diagnoseEmptyGraph` 候选值按 objectKey 字典序去重 |
| **R7 错误信封** | 🔗 **1 处码不符文档** | 实现 `apps/agentcore/src/resources.ts:26` 返 `REF_PROBE_UNAVAILABLE`，CMP §12.2 文档写的是 `DATACORE_UNAVAILABLE`（A-13） |
| **R11 render 收口** | ⚠️ 已知未覆盖门 | `skill-graph.ts:22-24` 自承；断点 `G-SKILL-GRAPH-NO-RENDER-CLOSURE` 已登记 |
| **R13 结论可溯源 / 不伪造** | ✅ | 生成工具只回执不产数字；reflect 数字落地检查；degrade 恒标「未能完全解答 + 已探索线索」 |
| **R14 应用层无业务常数** | ✅ | Agent 管理台新增文案进 `locales/zh.ts`，阈值数字只在 `?` 浮层作口径说明 |

### 4.5 触及断点（本体 §8）· **只引用已登记的；新建议明确标出**

**已登记、本单复核仍开的**：
`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`（假绿第 9 形态，本单又找到一例：`buildNavigationSliceSection`）·
`G-SKILL-PLAN-DUAL-AUTHORITY` · `G-SKILL-TENANT-SEED-ASYMMETRY` · `G-SKILL-GRAPH-NO-RENDER-CLOSURE` ·
`G-AGENTRUN-NO-AGENT-ATTRIBUTION`（本单复核仍开）· `G-3`（对话坞缺口）· `G-9`（path-B 有界降级）·
`G-VIS-1`（后端真值 → 前端可见）· `G-10`（规则即引用）。

**已登记、本单确认已闭的**：
`G-AGENT-BLIND-REACT`（QOS-1 路由侧 + QOS-2 agent 侧，机制层已闭；**live 墙钟未复测**）·
`G-AGENTRUN-NO-READ-SURFACE`（`GET /b/v1/queries/:taskId/agent-run` 已补）·
`G-MOCK-PATH-ENUM-DRIFT`（mock `path:"PATH_A"` 已改 `WORKFLOW`，并落防复发机制）。

**⚠️ 建议新增（本单**不**擅自写入本体，交审核方裁决后另立单回写）**：

| 建议 ID | 一句话 | 为什么值得单列 |
|---|---|---|
| **G-SKILL-COMPILE-NO-ENTITLEMENT**（建议） | `POST /b/v1/skills/:id/compile` 只有 `requireCatalogAdmin`，无 entitlement 门 ⇒ R3「Entitlement 先于 authz」在这一处被违反，端点对任何 catalog_admin 恒开、关不掉 | 与既有断点都不同源：不是「没接线」也不是「没数据」，是**门装错了层**（量的是"角色够不够"而不是"功能开没开"） |
| **G-SKILL-BUDGET-PROBE-ONLY**（建议） | `maxBudgetRounds` 的唯一生产读点在 eval 探针路（`skill-probe.ts:133`），生产 agent loop 的 6 处 `BudgetTracker` 全走 env ⇒ 用户填的预算在真实推演里无效 | 「接了线接错地方」的教科书样本；且 DSL §4.6 的验收原话是效果层判据（「改这个数 → 轮次真变」），今天不成立 |
| **G-SLICE-FIRSTPAINT-EMPTY-ARGS**（建议） | 十六层面板首屏以 `args={}` 起手，而首屏默认的 4 条多跳切片 root selector 全带 `{{args.X}}` ⇒ 第一眼恒空 | 后端已给出真候选值（`slice-layers.ts:107`），缺的只是**前端默认起手值**。这是仓主唯一亲手点到的面 |
| ~~**G-DOC-EVIDENCE-NOT-IN-REPO**~~ | ⟪**撤回**⟫ 我误判 —— 复现脚本存在，`deliverables/` 是 `.gitignore:27` 的产物目录 | — |

### 4.6 触及门禁（本体 §7）

**实测口径（本单亲手数，不抄文档）**：`scripts/` 下共 **55** 个 `check-*.mjs`；`package.json.scripts.gates` 链长 **29** 道 ⇒ **26 个脚本在仓里但不在链内**。

- **已在链内且本单复核有效**：`check-ref-closure.mjs` · `check-gate-ledger.mjs` · `check-slice-connectivity.mjs`（产物 `docs/ONTOLOGY-SLICE-GAPS.md`：切片 43 · 连通边 403 · 孤岛 0）· **`check-loop-control.mjs`**（六条判据，含 metric 接线，链内第 12 位）· `check-deploy-governance.mjs`（守 compose 里五个 Loop Control 开关，**删行即红** —— 这是 #88 那个坑的机制化对策）。
- **文档提到但确实不存在的门**（单符号单跑、无 `head`；金丝雀 `check-ref-closure.mjs` 存在 ✅）：
  `check-skill*`（覆盖文档里的 `skill-lint:check` / `skill-eval:check` / `skill-refs:check` / `skill-graph:check` / `skill-business-intent:check`）· `check-harness*` · `check-refbase*` —— **三族全 0 个文件**。
- ⟪**已自纠**⟫ **`loop-control:check` 不在此列** —— 它存在、有具名 npm script、且在链内（§0.1）。
- **存在但不在 `gates` 链内的门**：`check-ontology-writeback.mjs`（A-03）+ A-09 点名的六道（`check-sim.mjs` · `check-propagation.mjs` · `check-sim-readiness.mjs` · `check-solver-license.mjs` · `check-opt-template.mjs` · `check-opt-determinism.mjs`，**六个逐一实测 `binding` 非链内**）。

---

## 5 · 诚实边界（本单没做什么 · 哪些条款未判定）

### 5.1 硬性未做（派单纪律所限）

1. **没跑 `bash scripts/gate.sh` / `pnpm -r test` / `pnpm -r build`**（派单明令禁止，主线在跑组合门，4 核机）。
   ⇒ **本文没有断言"仓库是绿的"**；`IMPLEMENTATION-phase1-4-slice-rules.md` 里 datacore 244/246/248、agentcore 173/178/185/187/191/192、frontend 106、parity 129/129 这些数字**本单一个都没复核**（SL-IM-20 已标 ⛔）。
2. **没起服务、没发一个真请求**。所有「能不能用」的判断都是**静态读码 + 读调用点条件**。按本仓戒律这**不等于「亲手真跑」**。
   受此影响、**明确标为未判定**的条款：AG-DG-07（空租户闭环）· AG-NAV-13（真 Kimi 20 题 live 重测）· SL-A3-23（真浏览器截图）· SL-360-07（切片是否真进 solver 上下文）· SL-A3-12〜16 的 C5。
3. **没跑任何单个测试文件**（本可以，但每个 vitest 进程都会和主线的组合门抢 CPU；本单判定不依赖测试执行）。
   ⇒ 「测试咬函数还是链路」这一列，我是**读测试文件的断言内容**判定的，**不是看测试实际执行了什么**。

### 5.2 覆盖边界（我读到哪儿为止）

4. **Skill 域的 1630 条我没有逐条重读**。四份 `CHECK-*.md` 已把它们逐条拆过并给了 file:line，本单做的是
   **①基线校正（4 条定性反转，已实测）②⚠️档拆分（6 条，已实测）③跨域汇总**。
   ⇒ 表 §1.2 的 Skill 计数**是引用上游的，不是本单重数的**；上游的编号连续性有脚本校验，但**我没有重跑那些脚本**。
5. **MIG/XR 的「AS-IS 断言复核正确」条数未量化** ⇒ §1.2 里「实现层 ✅ ≈ 301」这个数**是一个下限估计**，
   真值只会更低。**我没有把它写成确定数。**
6. **`reflect.ts` 我没有逐行读完** ⇒ AG-HAR-04（solver-first 执行期门是否真覆盖「排产类问题未调 solver」）
   与 AG-HAR-24（口径一致检查是否真复用 `ontology.crossValidate`）**标未判定**，没有猜。
7. **SEAM 测试文件名我没有逐一核对**（AG-LC-24 标 ⚠️）。文件在不在 ≠ 断言咬什么。
8. **前端侧只核了三个页面**（`AgentsPage.tsx` · `SkillStructure.tsx` · `SliceLayersPanel.tsx`/`SliceLibraryPage.tsx`）。
   其余 skill/agent/slice 的前端消费面**未系统检查**。
9. **pg 模式未验**：memory/pg 双实现在 skill/agent/slice 相关表上是否完全等价，本单未核。
10. **未合并分支上的文档内容只读了 1 份**（`RECONCILE-skill-agent-prd-2026-08-09.md`）。
    另外 9 份（§1.1 表）**只确认了存在与落在哪条分支，未读内容** ⇒ 它们可能含本单没覆盖的条款。

### 5.3 本单自己犯过的错（已全部在正文订正 · 详见 §0.1）

11. **我第一版连报 6 条错误的否定结论**，根因是 `grep … | head -20` 把命中截掉了。
    受影响的 6 条（AG-LC-15/21/24/25/30 + A-16 + 建议断点 `G-DOC-EVIDENCE-NOT-IN-REPO`）**全部已订正并标 ⟪已自纠⟫**。
    ⇒ **本文第一版对 `PRD-agent-execution-governance-loop-control.md` 的判定（「路线图大半没做」）与事实相反**，
    订正后是「P0+P1+P2 全部落地，只剩自排低优先的 P3 四项」。
    **这条留在文里是为了让下一个读者知道：本文的否定结论也可能有错，请照 §6 的命令亲手复跑。**
12. 顺带订正三处**上游文档已漂的坐标/基数**（不是我的错，但读者会被误导）：
    `probeMissingRefs` 三处调用点 `690/1008/1272` → **今日 `747/1065/1317`**；
    `REF_PROBE_UNAVAILABLE` 在 `resources.ts:24` → **`:26`**；
    `pnpm gates` 门数 16 → 26 → **今日实测 29**。

### 5.4 一句话

> **「我没找到」和「它不存在」是两个不同的命题。**
> 本文所有「不存在」都配了 §0 的金丝雀；所有「我没找到但没敢说不存在」的，都进了 §5.2 这张单子；
> **所有「我说了不存在但其实存在」的，都进了 §0.1 和 §5.3 —— 一条没删。**

---

## 6 · 复验命令（别信本文，亲手跑）

> ⚠️ **纪律（本单踩过，见 §0.1）：报否定结论的那次 grep 必须单符号单跑、不加 `head`、先看 `wc -l`。**
> 下面每条否定型检查都是这个形状；多符号或查只用于**正向**取证。

```bash
# ① 基线（本文所有 file:line 只对这个 commit 有效）
git rev-parse origin/claude/inspiring-gates-aqczjg    # 应得 282b8239…

# ② 分支是否已并 —— 判据是祖先关系，不是文件存在性（铁律 0.6 第 2 条机制）
for b in handoff-skill-compiler-s1 handoff-skill-partial-a handoff-skill-agent-reconcile; do
  printf "%-34s " "$b"
  git merge-base --is-ancestor "origin/claude/$b" origin/claude/inspiring-gates-aqczjg \
    && echo MERGED || echo NOT_MERGED
done
# 期望：compiler-s1 MERGED · partial-a MERGED · skill-agent-reconcile **NOT_MERGED**

# ③ §1.3 序 3：compile 端点无 entitlement（金丝雀必须先中）
grep -rn "skill-compiler" apps/*/src packages/*/src | wc -l   # 金丝雀，应 >0
grep -rnF '"skill.compiler"' apps/*/src packages/*/src        # 应 0 行

# ④ §1.3 序 4：maxBudgetRounds 挂在探针路不在生产路
grep -rn "skillBudgetOverride" apps/*/src packages/*/src      # 唯一 src 读点应是 skill-probe.ts:133
grep -rn "new BudgetTracker" apps/agentcore/src/router/orchestrator.ts  # 6 处，全是 residualBudgetFromConfig()

# ⑤ Loop Control 五开关在容器态是开的（必须追到 compose 这一层，只看 config.ts 会误判）
grep -n "QOS_AGENT_" docker-compose.yml                        # 应见 :127/:129/:130/:131 四个 ${VAR:-建议值}

# ⑥ §1.3 序 1：十六层空子图诊断已在
grep -n "diagnoseEmptyGraph" apps/datacore/src/ontology/slice-layers.ts    # :82
grep -n "EmptyGraphBar"      apps/frontend-shell/src/pages/admin/SliceLayersPanel.tsx  # :87

# ⑦ 门：数「文件」不数「npm 名」—— 两者不是一回事（§0.1 我在这里栽过）
ls scripts/ | grep -cE "^check-"                      # 55 个 check-* 脚本
node -e "const g=require('./package.json').scripts.gates;
         console.log('gates 链长 =', (g.match(/node scripts\/check-[a-z-]+\.mjs/g)||[]).length);
         for (const s of ['loop-control','ontology-writeback','sim','propagation','solver-license'])
           console.log(s, '在链内 =', g.includes('check-'+s+'.mjs'));"
# 期望：链长 29 · loop-control **true** · 其余四个 false

# ⑦b 真正不存在的三族门（单跑·无 head·先看计数；金丝雀必须先中）
ls scripts/check-ref-closure.mjs                      # 金丝雀：应存在
ls scripts/ | grep -cE "^check-skill"                 # 应 0
ls scripts/ | grep -cE "^check-harness"               # 应 0
ls scripts/ | grep -cE "^check-refbase"               # 应 0

# ⑧ §0.1 那 6 条自纠的反证（都应命中，命中即证明"第一版报的 0 是假的"）
grep -c "check-loop-control" package.json                              # ≥2（gates 链 + 具名 script）
grep -n "qos_agent_loop_repeat_total" apps/agentcore/src/metrics.ts    # :108
grep -n "agent_escalated" apps/agentcore/src/agent/loop.ts             # :509 :520
ls apps/agentcore/test/ | grep -E "loop-detector|retry-manager|per-tool-cap|escalation"  # 5 个
ls scripts/slice-scenarios-excel.mjs                                   # 存在
grep -n "deliverables" .gitignore                                      # :27
```
