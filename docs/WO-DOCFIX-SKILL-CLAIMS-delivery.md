# 交付 · `WO-DOCFIX-SKILL-CLAIMS` —— 四份 CHECK 清单里的失实/过期断言逐条回写

| 项 | 值 |
|---|---|
| 分支 | `claude/handoff-wo-docfix-skill-claims` |
| 基线 | 从 `origin/claude/inspiring-gates-aqczjg` @ `69804185` 重开（**判据是祖先关系**：`git merge-base --is-ancestor HEAD $CANON` → **是祖先 ⇒ 落后 ⇒ 重开**，未用「某文件在不在」这种恒真探针） |
| 日期 | 2026-08-09 |
| 性质 | **纯文档单**，未改一行 `apps/` `packages/` `scripts/` 下的代码 |
| 触碰的文件 | `docs/SPEC-industrial-skill.md` · `docs/PRD-addendum-skill-authoring.md` · `docs/PRD-skill-contract-dsl.md` · `docs/PRD-skill-compiler-registry.md` · `docs/PRD-skill-runtime-orchestrator.md` · `docs/PRD-skill-governance-learning.md` · `docs/PRD-skill-migration.md` · `docs/PRD-skill-crossreview.md` · `docs/prd-ontology-index.json`（门重生成） |
| 未碰 | `docs/SYSTEM-ONTOLOGY.md` · `docs/PRD-UPGRADE-decision-sandbox-v2.md` · 四份 `docs/CHECK-*.md` · 任何代码 |
| ⚠️ 并线提示 | **本单开工后 canonical 又前进了 2 个提交**（`69804185 → 431d9249`：`684f78f1` 进度实测账 · `431d9249` 新门 `worktree-canonical:check`）。本分支**不含**这两个提交，`git diff origin/canonical..HEAD` 会把它们显示成"删除"——**那是基线差不是本单改动**。判准：`git diff 69804185..HEAD --stat` = **10 个文件，全在 `docs/` 下**，零代码改动。并线请 cherry-pick 或 rebase 到最新 canonical。 |
| 订正形式 | **一律保留原文**（删除线 / 就地 ⚠️🔁🔴 标注块），**不抹历史** —— 抹掉就看不出「这里曾经骗过人」 |

---

## 0 · 三条纪律的执行情况（先摆判据）

1. **逐条复核证据，不直接抄 CHECK**。每条订正的 `file:line` 都在本单重新跑过；
   **因此抓出了 CHECK 文档自身的 6 处错**（见 §4，那一节比订正本身更值钱）。
2. **金丝雀先行**。凡写下「0 命中 / 不存在 / 零消费方」的地方，同处必附一条已知必中的样例；
   金丝雀不中就报「工具坏了」，不报「代码干净」。
3. **不越权裁决**。`X1`（summary 200/400/400）与 `X-05`（Graph 三名）只摆事实、标**待裁决**；
   `body 3000 vs 50000` **一个字没动**（`SPEC §9.3` 明写是两层治理，不是冲突）。

---

## 1 · 逐条勾选表（**44 条 · 一条不漏**）

> 派单口径写「26 条」。本单把四份 CHECK 里**所有**「宣称做了 / 已过期」类条目做成**超集**逐条处理，
> 实得 **44 条**（差额是**粒度**不是新增：CHECK-RT-GOV §D 的 4 条、CHECK-MIG-XR 的 6 条基数漂移、
> `N-01/N-02`、`X1` 在派单口径里可能被合并计数）。**26 条全部包含在下表内，无一遗漏。**
> 状态列：**已改** / **不改（有意）** / **未改（出范围）**。

### 1.1 `docs/CHECK-SPEC-AUT.md` §4 · F1–F14 + 附录 X1（15 条）

| # | 出处（订正落点） | 改成了什么 | 状态 |
|---|---|---|---|
| **F1** | `PRD-addendum-skill-authoring.md` §0 触及门禁 | 原行加删除线 + 标注：`skill-lint:check` 全仓 **0 命中**（金丝雀 `ref-closure:check` 命中 `package.json:35`）；真实形态是**运行态发布端点门** `server.ts:1251` → `422 SKILL_LINT_FAILED`(`:1253`)，且 **`force=true` 可豁免** | ✅ 已改 |
| **F2** | 同上 | 加删除线 + 标注：门名 0 命中；且「挂载**真实 agent**」实为**自动创建的探针 agent**（`skill-probe.ts:119 ensureProbeAgent` / `:120 ensureTwinAgent`，定义在 `:166/:208`）⇒ 证明不了「挂真实业务 agent 不误触发」 | ✅ 已改 |
| **F3** | 同上 | **按实测重写（CHECK 原文有错）**：`ontology-writeback:check` **存在且每次交付真跑**（`scripts/gate.sh:86`），不进 `pnpm gates` 是刻意的（理由在 `gate.sh:44-49`）；真缺口是**它守的不是本文的门名**（它只断言「gates 链的门已登记进本体 §7」，`check-ontology-writeback.mjs:42/46`） | ✅ 已改（并订正 CHECK） |
| **F4** | 同上 §0 触及对象类型 | 拆成两条不同形态：`maxBudgetRounds` = **纯声明**（全仓 1 命中 = `agentcore.ts:260` 自己；`BudgetTracker` 三处入参全走 `residualBudgetFromConfig()`）· `resources` = **接了线没数据**（消费方在，7/7 空：`seed.ts:1046/1093/1137/1181/1224/1268/1315`） | ✅ 已改 |
| **F5** | 同上 §0 R13 | 标注「已生效 ≠ 已触发」：门真实（`server.ts:1284/1286/1293-1298/1303`），但 `seedRegistry()` 返回键只有 `{agents,workflows,skills}`（`seed.ts:1591`）⇒ 出厂 `skill_quality` **0 条** ⇒ 生产拦截次数 **0** | ✅ 已改 |
| **F6** | 同上 §5 + §6 | 整节加标注：`production-capacity-interpretation` 全仓 **0 命中**（金丝雀 `capacity_analysis` = 2）⇒ **SA2/SA3 被测对象不存在**，改判 **⛔ 阻塞**，不得计入验收通过数；并列出补齐需要的三件事 | ✅ 已改 |
| **F7** | 同上 §5 | 标注：承诺的「文档内并排展示 + 标注 lint 规则」**两样都没有**，「编写代理的模仿基准」实际不存在 | ✅ 已改 |
| **F8** | `SPEC-industrial-skill.md` §5「引用可校验」 | 原句加删除线 + **【反向过期·最高危害】**大块订正：5 项硬门 **4 项已生效**（`server.ts:1267/1268/1269 → :1272` + `skill-lint.ts:218/347`），并列出三条关键性质（fail-closed / 拦在落库前 / force 不豁免）与**真缺口**（4 种 kind 无人校验 · tool/mcp 声明不了 · 出厂 Skill 门够不着） | ✅ 已改 |
| **F9** | `SPEC-industrial-skill.md` §2-⑧ + §4「三条最该先做」 | 表格加内联标记 + 表后订正；「三条最该先做」第 2 条**划掉**：`params` 已是一等操作数（`ruledsl.ts:39/318-324`），未声明**抛 `DslError`**（`:491-499`），发布期校验料在（`:414-420`）。**保留仍成立的半条**：`kind:"field"` 拼错仍静默恒假 | ✅ 已改 |
| **F10** | `SPEC-industrial-skill.md` §2-⑪ | 拆成两半：「零消费方」**已过期**（`skill-lint.ts:342` 形状校验 · `resource-projector.ts:149` 投影 `outputSpec`）；「无人拿它校验输出」**仍成立**。形态 = **接了线接错地方**，删掉会断 DRIL `outputSpec` | ✅ 已改 |
| **F11** | 生长回路真的会写 | CHECK 明确标注「**复验成立，不是假宣称**，列此仅为闭环记录」 | ⛔ **不改（有意）** |
| **F12** | 5.3 只读不写 | CHECK 明确标注「**复验成立，非假宣称**」（`distillExperienceCases` 唯一 src 调用方是 `main.ts:44` 启动灌常量） | ⛔ **不改（有意）** |
| **F13** | body 3000 vs 50000 | CHECK 明确判「**不是冲突**，`SPEC §9.3` 明写两层治理」。改它就是制造新的失实 | ⛔ **不改（有意）** |
| **F14** | `PRD-addendum-skill-authoring.md` §0 R16 | 标注：出厂 Skill 经 `main.ts:29` `repos.skills.insert(sk)` **直插仓储**，5 条以 PUBLISHED 落库，**一次没走过发布端点** ⇒「门装上了」≠「库里的东西过了门」 | ✅ 已改 |
| **X1** | `PRD-addendum-skill-authoring.md` §1 | 三方口径表 + **标「待裁决 · 本单不裁」**：PRD/lint **200**(`skill-lint.ts:46`) · 契约 **400**(`agentcore.ts:242`) · 前端 **400**(`SkillsPage.tsx:77-78`)；并**显式区分于 body 的两层治理**，给三条可选处置不选 | ✅ 已改（不裁决） |

### 1.2 `docs/CHECK-DSL-CMP.md` §5 · X-01–X-12 + §5.1 N-01/N-02（14 条）

| # | 出处（订正落点） | 改成了什么 | 状态 |
|---|---|---|---|
| **X-01** | `PRD-skill-contract-dsl.md` §2 基线表 | 处置列加内联标记 + 订正块：读作**「已声明 · 未接运行时」**；实测全仓 1 命中，`BudgetTracker` 入参全走 `residualBudgetFromConfig()` ⇒ Skill 声明**不在优先级链上**。并**订正 CHECK 自身**（见 §4-b） | ✅ 已改 |
| **X-02** | 同上 §4.6 `budget.rounds` | 标记「这是**验收判据**不是**已发生的事实**」；**拆开说**「并入后会满足」与「并了也不满足」：`partial-a`（实测 **NOT MERGED**）上唯一 src 读点是 `skill-probe.ts:133`（探针路），生产 loop 未接 ⇒ **并了也不满足** | ✅ 已改 |
| **X-03** | 同上 §11.1 事实核实表 | 该行加删除线 + 今日事实：发布路**今天是四段**（lint `:1251` → **引用探针 `:1272`** → eval `:1284-1298` → probe `:1301`）；并在节首加「自称亲手核实的断言最危险」的元订正 | ✅ 已改 |
| **X-04** | 同上 §10.1 诚实边界段 | 加删除线 + **【反向过期】**订正表（6 行证据）；**保留仍成立的半条**（4 种 kind 无人校验）；坐标 `skill-lint.ts:176 → :218` | ✅ 已改 |
| **X-05** | 同上 §9.2 命名裁定 | 三方对照表：`SkillRuntimeGraph` 全仓 **0 命中** · canonical 用 `SkillGraph` · compiler-s1 用 `SkillReasoningGraph` ⇒ **同一层三个名字**，标**待裁决**，并写明裁决时必须**三处同改** | ✅ 已改（不裁决） |
| **X-06** | `PRD-skill-compiler-registry.md` §2.4 | 加删除线 + 订正表：**5 + 16 + 11 = 32**（不是 4+16+12）；「4」是**被跳过的卡数**不是手写数；`ceoCaps` 实测 **11**；坐标订正 `seed.ts:624-625` / `:677-704` | ✅ 已改 |
| **X-07** | 同上 §4.2 + §14.3 | `SOLVER_KEYS` **59**（不是 57），坐标 `service.ts:44 → :51`；用**文档自己那条命令**跑出来的；并加一条「能现算就别写死」的元教训。`PRD-skill-runtime-orchestrator.md` 同处一并订正 | ✅ 已改 |
| **X-08** | 同上 §1.2 非目标 | 加删除线 + **【反向过期】**：`GraphScheduler`(`skill-orchestrator.ts:95`) + `POST /b/v1/skill-graphs/run`(`server.ts:1360`) 已并入；**保留真缺口**：`SkillDefinitionSchema` 无 `execution` ⇒ 接了线没数据（`skill-graph.ts:347-353` 自述）；`cond` 边 `NOT_IMPLEMENTED`(`:204-212`) 是登记在案的未实现 | ✅ 已改 |
| **X-09** | 同上 §0 R3 | 🔴 标注「**做了但漏了门**，不是本期不做」：canonical 端点不存在；`compiler-s1`（NOT MERGED）`server.ts:1323` 有端点、**无 entitlement 门**，两分支 `skill.compiler` 均 0；给出并入前必补的三件 | ✅ 已改 |
| **X-10** | 同上 §8.1 | 加删除线 + 订正：handler **完全不读 `req.query`** ⇒ 契约不符是**定时的行为漂移**；给二选一处置，明写**不许保持现状** | ✅ 已改 |
| **X-11** | 同上 §12.2 S2（+ §5 `:328` 同病） | 实测码是 **`REF_PROBE_UNAVAILABLE`**（`resources.ts:26/55/62`）非 `DATACORE_UNAVAILABLE`；说明前端会落 default 分支；给二选一并要求**两处同改** | ✅ 已改 |
| **X-12** | 同上 §14.4-1 | 订正该风险的**前提不成立**：种子经 `main.ts:29` 直插仓储 ⇒ 门够不着；**「没有存量被挡」≠「存量干净」**；dry-run 清单必须**离线对种子跑** | ✅ 已改 |
| **N-01** | 同上 §14.2（原「未核实」行） | 🔴 新增缺口块：探针用 `listRuleKeys`（`datacore-http.ts:233`，`GET /a/v1/rules` **无 status 过滤**），而 `listRules`（`:237`）才带 `?status=PUBLISHED` ⇒ **引用 DRAFT 规则今天可正常发布**；形态 =「门在，量的东西不对」，**别再去接一次探针** | ✅ 已改 |
| **N-02** | 同 X-09（同一件事） | 与 X-09 合并在 `§0 R3` 的同一个标注块内处理 | ✅ 已改 |

### 1.3 `docs/CHECK-RT-GOV.md` §D 清单（4 条）

> §D 的总结论是「**126 条 ⛔ 逐条核完，未发现任何一条『宣称做了但其实没做』**」——
> 这一点本单**没有推翻**，反而在各处标注里保留了它的正面证据。可动作的是 D.2 的 3 条边缘情形 + D.3。

| # | 出处（订正落点） | 改成了什么 | 状态 |
|---|---|---|---|
| **E1** | `PRD-skill-runtime-orchestrator.md` §2 G1 | 🔴 标注：G1 后半句「不引入第三套扇出」**已被 S1 切片自己违反**（`GraphScheduler` 是第 4 套，三处扇出一处未收编，`executor.ts:104` 仍严格串行）；**明确写它不算「宣称做了」**（诚实标注到位），但债必须记在 G1 旁边，收敛全押在未开工的 W2 | ✅ 已改 |
| **E2** | 同上 §3.4 调度算法 | 加删除线 + 对照表：缺省 **4**（`skill-graph.ts:119/130/457`）、硬上界 **16**（`:121`）、生效点 `skill-orchestrator.ts:149`；并指出「部署态可经 env 收紧」**今天无承载物**（全仓无 env 读取）；给出「护栏缺省必须是安全值」的理由 | ✅ 已改 |
| **E3** | 同上 §8.3 引用真值源表 | 🔴 表内标记 + 表后块：本文自己的反向禁令「不得留**校验不了但看起来能校验**的 kind」**正被 `constraint` 违反**（在 `agentcore.ts:216` 枚举里 · `server.ts:1267-1269` 不看 · `skill-lint.ts:218` 不看 · **零标注**）；`slice/workflow/agent` 同档，活样本 `seed.ts:1106` | ✅ 已改 |
| **D.3** | `PRD-skill-governance-learning.md` §2 | 记账块：纪律零违规是好事，但**代价是前置和学习闭环一起没做**；P0-A/P0-B 逐条实测（含金丝雀）+ **判据：两项独立于学习闭环，不受「不许开工」庇护**；并记 P0-B 的实施坑（`app.ts:860` 钩子先 return，两处必须同改） | ✅ 已改 |

### 1.4 `docs/CHECK-MIG-XR.md` §5 清单（6 + 6 = 12 条）

| # | 出处（订正落点） | 改成了什么 | 状态 |
|---|---|---|---|
| **1** | `PRD-skill-crossreview.md` §9 C1 行 | canonical 已于 `3dd34ba9` 先行订正；本单**逐条复跑复核**（`requires` 在 `packages/contracts/src/*.ts` 仅 3 行且全非 skill 语境，金丝雀 `SkillDefinitionSchema` = 5；`skill-lint.ts:343/347`、`resource-projector.ts:333/334` 仍直读原字段；`WO-SKILL-MIG-G3` 远端不存在，金丝雀 `handoff-skill` = 8）并加**二次复核戳** | ✅ 已改（复核 + 补戳） |
| **2** | `PRD-skill-crossreview.md` §9 C5 行 + `SPEC-industrial-skill.md` 两处 | C5 加脚注：「两份 PRD = 0」属实，但**同批改的 SPEC 仍有 2 处**；SPEC 两处（§2-⑥ · §5）就地标注并给出应读作的命名空间；并说明本文 §5 自身 6 处是**元讨论不计** | ✅ 已改 |
| **3** | `docs/SYSTEM-ONTOLOGY.md` §7 六道门「已并入 pnpm gates」 | — | ⛔ **未改（出范围）**：本体回写是审核方的活，派单 §4 明确禁止本单碰 `SYSTEM-ONTOLOGY.md`。**本单复核结论供审核方直接采用**：这六道门**确实不在 `pnpm gates` 链内**（现算 `GATES_CHAIN 26`，`node scripts/check-gate-ledger.mjs` 输出），该漂移**已被 `gate-ledger:check` 的棘轮接管**（`NONE 12`），故是**已被机器盯住的漂移**，不是无人看管的谎报 |
| **4** | `PRD-skill-migration.md` §1.4 第三行 | 加删除线 + 订正：**已部分闭合**（solver/rule/ontologyType 三种已守）+ **仍没闭的四种**（`skill-lint.ts:215-217` 自承，活样本 `seed.ts:1106`）；坐标 `:177 → :218`；并同时挡住**两个方向**的误读 | ✅ 已改 |
| **5** | `PRD-skill-migration.md` §1.5 G2 | 加删除线 + **【反向过期】**订正表（5 行证据）；**保留没做的那半**：`kind:"field"` 拼错仍静默恒假（`resolveField:450` 带前缀回退）⇒ §10.2 的解析期门只做了一半 | ✅ 已改 |
| **6** | `PRD-skill-crossreview.md` §9 C3 行 | 🟡「仍无人认领」加删除线 + **【反向过期】**：账已立门已接（`gate-ledger.json` 51 条 + `check-gate-ledger.mjs` 在 gates 链末位 + baseline），**亲手跑 RC=0**；**阻塞条件已解除**；同时写明「账已立 ≠ 门都算门」（`NONE 12` / `provenRed NEVER 35/51`）+ **一条环境坑**（见 §4-f） | ✅ 已改 |
| **a** | `PRD-skill-migration.md` §0/§12.2/§13 | `pnpm gates` **16 → 26**（**现算**，不写行号） | ✅ 已改 |
| **b** | 同上 | 迁移后聚合 **16→23** 改为 **26→33** | ✅ 已改 |
| **c** | `PRD-skill-crossreview.md` §3 | 「现有 16 + 新 17 = 33」**两个加数都错且这次没抵消**：现有 **26**（现算）· 新门 **0 道已落地**（`ls scripts/ \| grep -i skill` 无命中，金丝雀 `check-ref-closure.mjs` 存在）；合计今天 **26**、五份全落地后 **43** | ✅ 已改 |
| **d** | `PRD-skill-migration.md` §1.2/§5.3/R-F/§13（4 处） | **真跑 `seedIntentsAndPlans("demo")`** 得 **5/32**（不是推算的 17/32），并点名这 5 条；写清错因（前提「派生的 16 条一律 `slots: []`」已被 `WO-DERIVED-INTENT-SLOT-DEAF` 修掉，`seed.ts:634/666`）；§13 那行改为「已实测」并加一句正面样例总结 | ✅ 已改 |
| **e** | `PRD-skill-migration.md` §0 CLI 段 | `OPERATION_CATALOG` **39 条**（不是 17）· `plan` 命中 **1**（不是 0，是 `op:"build"` 的 **BuildPlan** 非 `ExecutionPlan`）⇒ **结论仍成立**；并写明「一个恰好为 0 的数字最脆弱」 | ✅ 已改 |
| **f** | `PRD-skill-crossreview.md` 头表 | runtime **720→725** · migration **534→545**（其余三份 643/741/722 全对）；并注明本单加标注后行数会再涨 —— 这正是行数不该写死的理由 | ✅ 已改 |

**合计：已改 40 条 · 不改（有意）3 条（F11/F12/F13）· 未改（出范围）1 条（MIG-3，属本体回写）。**

---

## 2 · `check-stale-claims.mjs` 实测输出

```
$ node scripts/check-stale-claims.mjs
扫描：190 个源文件 · 182 处关键词命中 · 53 条声明违规 · 豁免 38 条（上限 38）
✅ stale-claims:check 通过（金丝雀 5+3 条全中 · 无新增声明违规 · 豁免棘轮 38/38）
RC=0
```

> **为什么本单的改动没有触发它**：该门的 `SCAN_ROOT = "apps/frontend-shell/src"`
> （`scripts/check-stale-claims.mjs`），**只扫前端源码，不扫 `docs/`**。
> ⇒ 本单在 8 份文档里写下的「2026-08-09 实测 X」**一条都不在它的射程内**。
> 这一点本身值得记账：**「自称实测」这个病在 `docs/` 下今天是无人看管的**，
> 而本仓的 PRD 恰恰是「自称实测」的重灾区（本单订正的 44 条里，`X-03`/`d` 两条正是这个形态）。
> **建议（不在本单范围）**：把 `SCAN_ROOT` 扩到 `docs/`，或加一道同族的 `docs` 版门。

### 其它跑过的门（顺带自证环境）

```
$ node scripts/check-prd-ontology.mjs      → ✓ PRD 库结构化：无悬空引用（7 份被改文档 brokenArtifacts 全为 []）
$ node scripts/check-gate-ledger.mjs       → ✓ 通过；现算 GATES_CHAIN 26 · GATE_SH 6 · CI_ONLY 0 · MANUAL 7 · NONE 12 · 合计 51
                                              门账条目 51 · provenRed 从未红过 35（基线 35）
```

**未跑**：`bash scripts/gate.sh` 与 `pnpm -r test`（派单明令禁止）。
⇒ **本文没有断言「仓库是绿的」**。只 build 了 `@platform/contracts` / `@platform/llm-adapters` / `agentcore` / `datacore`
（为了真跑 `seedIntentsAndPlans()` 与让 `gate-ledger:check` 能解析责任边界）。

### 本单唯一一次「运行态实测」的原始输出（2026-08-09）

```
$ node -e '…seedIntentsAndPlans("demo","2026-01-01T00:00:00.000Z")…'
intents = 32 plans = 32
empty-slot intents = 5 / 32
  keys: plan_recommend, inventory_opt, maint_stagger, sop_status, ceo_finance_pnl
seedRegistry keys = agents,workflows,skills          ← 无 evalCases（F5 的根据）
skills = 7 PUBLISHED = 5
resources 非空 = 0  dependsOn 非空 = 0  references 非空 = 6  execution 非空 = 0  maxBudgetRounds 已设 = 0
body 均值 = 442
```

---

## 3 · 金丝雀总表（凡本单出现否定结论，均先跑过这一条）

| 否定结论 | 金丝雀（已知必中） | 金丝雀结果 |
|---|---|---|
| `maxBudgetRounds` / `businessIntent` / `SkillRuntimeGraph` / `skill.compiler` 零命中 | `grep -rn "SkillDefinitionSchema" apps/*/src packages/*/src` | **7** |
| `production-capacity-interpretation` 全仓 0 | `grep -rn "capacity_analysis" apps/*/src packages/*/src` | **2** |
| `skill-lint:check` / `skill-eval:check` 门名 0 | 同命令跑 `ref-closure:check` | **命中**（`package.json:35` 等） |
| `scripts/` 下无 skill 门 | `ls scripts/check-ref-closure.mjs` | **文件存在** |
| `requires` 在 skill 语境 0 | 同 glob 跑 `SkillDefinitionSchema`（`packages/contracts/src/*.ts`） | **5** |
| `WO-SKILL-MIG-G3` 远端不存在 | `git ls-remote origin \| grep -c handoff-skill` | **8** |
| 两 metrics 文件零 `tenant` | 同两文件 `grep -c "inc("` | **5 / 1** |
| `executor.ts` 无 `Promise.all` | 同 grep 跑 `router/multi-route.ts` | **`:210` 命中** |
| 全仓无 `MAX_PARALLEL` 的 env 读取 | 同 grep 命中常量定义与使用点 | **4 行命中** |
| `agentcore` 分支落后判定 | `git merge-base --is-ancestor`（**祖先关系**，非文件存在性） | 已知已并的 `orchestrator-s1` 判 MERGED |

---

## 4 · **CHECK 文档自身的 6 处错**（本节比订正本身更值钱）

> 派单要求「发现 CHECK 文档本身有错的，有就直说」。**有，6 处。**
> 每一处都会导致下一个人得出错误结论，且**都是我逐条复跑才发现的 —— 直接抄就会把错误传下去**。

| # | 在哪 | CHECK 怎么写的 | 实测 | 为什么要紧 |
|---|---|---|---|---|
| **a** | `CHECK-SPEC-AUT.md` §4 **F3** | 「脚本存在，但**不在 `package.json` 的 `gates` 串里**（26 个脚本无它）⇒ 『同步满足』这件事**没有机器在守**」 | **`ontology-writeback:check` 每次交付门都真跑** —— `scripts/gate.sh:86` `run "ontology-writeback:check" node scripts/check-ontology-writeback.mjs`；不进 `pnpm gates` 是**刻意的**，理由白纸黑字写在 `gate.sh:44-49`（进 gates 链的门必须同批回写本体 §7，而 §7 回写归审核方） | CHECK 用**「不在 gates 串里」**当作**「没有机器在守」**的证据，而前者并不度量后者（`gate.sh` 是另一条链）。**照它去"补一道 CI 门"就是重复劳动**。真缺口是另一回事：这道门守的是「gates 链的门是否登记进本体 §7」，**根本不校验本 PRD 的门名是否存在** —— F1/F2 那两个不存在的门名因此躺了很久没人红 |
| **b** | `CHECK-DSL-CMP.md` §5 **X-01** | 「DSL **全文无一处标注它未接**」 | **有 3 处**：`PRD-skill-contract-dsl.md` 头表「头号纪律」行 · §1 P4 行 · §11.1 事实核实表，全都明写 `maxBudgetRounds` **零消费方** | X-01 的真问题只在**处置列的语气**（用已定事实的口吻写未来时），不是"全文没标注"。按 CHECK 原文去改，会把三处**本来正确**的诚实标注也当成缺陷改掉 |
| **c** | `CHECK-DSL-CMP.md` §5 **X-09/N-02** | compiler-s1 的 handler 在 `server.ts:1333` | 实测在 **`server.ts:1323`** | 坐标差 10 行。本身不致命，但**它是一条"给下一个 dev 照着改"的坐标** —— 派单里带着错坐标会让人怀疑是不是分支拿错了 |
| **d** | `CHECK-DSL-CMP.md` §5 **X-02** | 「读点也只在**探针**（`skill-probe.ts:133`）」 | 坐标**正确**，但 CHECK 没说清该分支上还有 `mocks/seed.ts:1283` 的**注释**与 `test/skill-partial-a-seam.test.ts` 的**单测** | 不是错，是**不完整**。补上之后才能看出这是「只有探针 + 单测」的形态 —— 与「只有 test 引用 = 已排练」是近亲，定性更准 |
| **e** | `CHECK-MIG-XR.md` §5 **第 1 条** | 「`docs/PRD-skill-crossreview.md:202` §9 收口表 **C1 行标 ✅**」 | **canonical 上该行今天标的是 🟡，且已带一整段 🔴 订正** —— 由 commit `3dd34ba9`「订正 crossreview C1 的 ✅ —— 归一层也不存在，这条线根本没画」先行修掉 | CHECK 的基线是 `b50f42af`，而 canonical 已推进到 `69804185`。**照 CHECK 去"把 ✅ 改成 🟡"会重复劳动，甚至覆盖掉一段更好的订正**。⇒ **复验文档也有保质期**，用它派单前必须先核对基线 |
| **f** | 四份 CHECK 都没提 | （无） | `node scripts/check-gate-ledger.mjs` 在 **`apps/datacore/dist/**` 不存在时会报 7 条「责任边界指向空气」并 RC=1** —— 本单第一次跑就踩到；`pnpm --filter datacore build` 之后 RC=0 | 这是一条**环境假红**：它长得和真的治理回归一模一样（错误文案是「责任边界指向空气，等于没填」），**足以让人误判成"门账坏了"**。已写进 `PRD-skill-crossreview.md` §9 C3 行的订正里 |

**六条的共同形态（照 CLAUDE.md 铁律 0.6 的句式）**：
> **「我用 X 当作 Y 的证据，而 X 并不度量 Y。」**
> a：不在 gates 串 ↛ 没有机器在守 · b：处置列语气不对 ↛ 全文没标注 ·
> e：CHECK 写的状态 ↛ canonical 今天的状态 · f：门红 ↛ 治理回归。

**⇒ 给审核方的一条建议**：四份 CHECK 是 2026-08-09 早些时候基于 `b50f42af` 做的，
而 canonical 当天已推进到 `69804185`。**再拿它们派单前，先跑一遍 `git log b50f42af..HEAD -- docs/`**，
否则会像 e 那样派出"修一个已经修好的东西"的单。

---

## 5 · 本单的诚实边界（没做什么）

1. **没跑四包 gate、没跑任何 vitest**（派单明令）。⇒ 本文**不断言仓库是绿的**。
2. **未碰 `docs/SYSTEM-ONTOLOGY.md`**。MIG §5-3 那条（六道门「已并入 pnpm gates」）**留给审核方**，
   本单只把复核结论写在上表里（漂移属实，但已被 `gate-ledger:check` 棘轮接管）。
3. **两条真冲突只摆事实不裁决**：`X1`（summary 200/400/400）· `X-05`（Graph 三名）。
   `body 3000 vs 50000` **一个字没动**。
4. **未并分支上的判定**（`compiler-s1` / `partial-a`）基于 `git grep FETCH_HEAD` 静态读源码 + `merge-base --is-ancestor` 判并入态，
   **未在该分支上跑过任何测试**。两支实测均 **NOT MERGED**。
5. **未复核 CHECK 文档里与本单 44 条无关的部分**（如 CHECK-SPEC-AUT 的 274 条逐条表、CHECK-DSL-CMP 的 455 条）。
   **「我没核」不是「它没错」。**
6. **行号会漂**。本单写下的每一个 `file:line` 都是 2026-08-09 在 `69804185` 上实测的；
   **每条订正都同时给了复跑命令**，坐标漂了以命令为准。

---

## 6 · 建议的下一步（按性价比，供审核方裁）

| 序 | 动作 | 依据 |
|---|---|---|
| 1 | **派 `WO-SKILL-MIG-G3`** 落地 `requires` 裁决（契约加字段 + 解析期归一层 + 两处消费方改读归一结果） | 裁决 2026-08-03 下达、**6 天零派单**，且是 M0 硬前置（名字定错 = 32 份返工） |
| 2 | **修 N-01**（探针换 `listRules` 或给 `listRuleKeys` 加 `minStatus`）—— **一行改动，堵住"引用 DRAFT 规则可发布"** | 本单新发现；**注意别误修成"再接一次探针"** |
| 3 | **修 P0-B**（`/metrics` 两服务鉴权）—— **当下就可被利用的信息泄漏面**，与学习闭环是否开工无关 | `CHECK-RT-GOV.md` §D.3 + 本单 `PRD-skill-governance-learning.md` §2 记账 |
| 4 | **裁 X1 与 X-05 两条口径** —— 都卡在"仓主拍板"上，卡着就一直漂 | 本单已把三方事实摆齐，裁完照标注里的「必须几处同改」回写 |
| 5 | **把 `check-stale-claims.mjs` 的 `SCAN_ROOT` 扩到 `docs/`** —— 今天 PRD 里的"自称实测"**无人看管** | §2 实测：该门只扫 `apps/frontend-shell/src` |
| 6 | **给「基数类断言」加机械门**（或一律改成现算） | 本单 5 处基数漂移（a/b/c/d/e）**今天全部进不了任何门，靠人读，读一次错一次** |
