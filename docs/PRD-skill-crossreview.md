# Skill 改造五份 PRD · 对照审查（审核方）

> 五份 PRD 由五个 dev 并行产出，各自独立读码。本文件是**并线前的对照审查**：
> 只记**跨文档的冲突、重复、传播性错误与口径分歧**，不复述任何单份 PRD 的内容。
>
> 纪律：本文每条结论的 `file:line` 都是我**亲手核过的**，不是据 PRD 转述。
> 凡我核不动的，明写"未核"。（本会话已发生过四次"据 grep 下结论、漏一层间接"的错误，
> 三次是同一种病；本文按"先核后写"执行。）

**被审五份**

| # | 文档 | 分支 | 行数 |
|---|---|---|---|
| 1 | `docs/PRD-skill-contract-dsl.md` | `claude/handoff-prd-skill-contract` | 643 |
| 2 | `docs/PRD-skill-compiler-registry.md` | `claude/handoff-prd-skill-compiler` | 741 |
| 3 | `docs/PRD-skill-governance-learning.md` | `claude/handoff-prd-skill-governance` | 722 |
| 4 | `docs/PRD-skill-runtime-orchestrator.md` | `claude/handoff-prd-skill-runtime` | ~~720~~ **725**（⚠️ 2026-08-09 `wc -l` 实测） |
| 5 | `docs/PRD-skill-migration.md` | `claude/handoff-prd-skill-migration` | ~~534~~ **545**（⚠️ 同上） |

> ⚠️ **2026-08-09 复验（drift-f）**：本表 5 行里 **3 行对、2 行错**
> （643 / 741 / 722 全对；runtime 与 migration 两行已按 `wc -l` 订正）。
> 复跑：`wc -l docs/PRD-skill-*.md`。
> 注：以上是**本次订正前**的行数；本单给八份文档加了就地标注，行数会再涨 ——
> **这正是"行数"这类数字不该写死在文档里的理由**（它每被人改一次就过期一次，而没有任何门在守）。

---

## 0. 并线前必须先处理的一条机械风险（与内容无关）

四份分支（contract / compiler / runtime / migration）从 `f1a37a7e` 或更早切出，
而 canonical 已到 `620090c8`，其间新增了 `docs/TEST-PLAYBOOK.md`（205 行）。
故 `git diff canonical..<branch>` 对这四条都显示 **`docs/TEST-PLAYBOOK.md | 205 ------`**。

> **并线方式必须是 cherry-pick 单个 PRD commit，不能 merge 分支**——
> merge 会把 TEST-PLAYBOOK.md 删掉，而它正是仓主要求交付、准备派给其他 agent 执行的测试手册。

---

## 1. C1 · `requires` vs `references[]/dependsOn[]` —— **真冲突，需仓主裁决**

**两方主张**

| 方 | 主张 | 位置 |
|---|---|---|
| contract PRD | `skill.requires.{objectTypes, relations, slices, rules, solvers, tools, mcp, workflows, agents, dependsOn}`，每条带 `required` / `minStatus` / `properties[]` | §4.5 |
| migration PRD | **保留现名 `references[]` / `dependsOn[]`，不改叫 `requires`**（自标"⚠ 这是我提的偏离，请裁决"） | §10.3 表 · §1.5 G3 |

**migration 的理由与我的核验结论**

> 理由原文：`requires` 已被 `FeatureDef.requires`（entitlement 依赖级联）占用，再用一次 =
> 同名不同义的第三套词表，正是 `G-SIDEEFFECT-VOCAB-SPLIT` 那一族的病。

- ✅ **占用属实**：`packages/contracts/src/features.ts:15` `requires: z.array(z.string()).optional()`。
- ❌ **但类比不成立**。`G-SIDEEFFECT-VOCAB-SPLIT` 是**同一个概念**有三套互不相识的词表
  （判定分支永不触发、测试自产自销照样绿）。这里是**两个不同对象**（`FeatureDef` / `SkillDefinition`）
  各有一个同名字段，语义各自自洽——与 `id` / `key` / `version` 同类，是常态不是病。
- ❌ **也不构成导出冲突**。`ExecutionPlanSchema` 那次是**真的同命名空间导出撞车**，
  所以 `packages/contracts/src/execution-plan.ts:6-7` 才改叫 ComposePlan；那条先例
  （compiler PRD §2.4 引以为据）在此**不适用**：两个 `requires` 是对象内字段，不是顶层导出。

**更要紧的是：这两个提案的表达力不同，不只是拼写不同。**

`requires` 能表达 `objectTypes[].properties: ["capacity"]` + `required: false` + `rules[].minStatus: "PUBLISHED"`；
扁平的 `references[]`（`{kind, key}`）**表达不了**「Factory 必须有 capacity 属性」这种契约式需求，
而这正是 SPEC §7 定案 1「`requires` 是契约不是副本 · 装载期校验 · 不满足拒装」要的东西。
**照 migration 的写法，定案 1 的语义落不了地**——它说"语义全盘采纳、只是不用这个词"，
但扁平结构承载不了那个语义。

**我的建议（供裁决）**：**采纳 contract PRD 的 `requires` 结构**，
并把 `references[]` / `dependsOn[]` 降为**解析期归一的输入别名**——
读入即折进 `requires`，运行时只有一处真源（contract PRD §5.3「一份声明、一处读」）。
这样既拿到表达力，又不产生第二套**活的**词表（别名是入口不是真源），
且 7 个存量 Skill 与 `skill-lint.ts:212/302`、`resource-projector.ts:334` 无需大爆炸迁移。

> 若仓主选 migration 方案，则 contract PRD §4.5 与 SPEC §7 定案 1 都要改，
> 且必须同时回答「`properties[]` / `minStatus` 这类契约式需求放哪」——不能留空。

---

## 2. C2 · 引用闭包门被提了两次，两个名字 —— **C1 的症状，不是独立问题**

| PRD | 门名 | 判据 |
|---|---|---|
| contract §0.6-5 | `skill-refs:check` | `requires` 的引用静态可校验 + 运行态发布门 |
| migration §5.2-2 | `skill-ref-closure:check` | 每个 `references[]` 的 key 真已注册 |

**同一件事、两个名字**，且各自锚在自己那套字段名上。**C1 一裁决，这两道门合并成一道**。
不裁决就并线 → 仓里会同时出现两道功能重叠的门（第 5 形态假绿的温床：
两道门互相以为对方管着，实际都只管一半）。

---

## 3. C3 · 门总数 16 → 33，**没有任何一份 PRD 负责这张合并清单**

五份 PRD 新提的门（去重后 **17 道**）：

```
contract    : skill-refs
compiler    : skill-compiler
governance  : skill-permission · skill-trace · skill-eval · skill-lint · growth-hitl · metrics-tenant
runtime     : graph-runtime · progress-reachability
migration   : skill-ref-closure · skill-plan-parity · skill-single-source · skill-export
              skill-business-intent · skill-budget-effect · skill-entitlement-single
```

~~叠加现有 16 道 = **33 道**~~，而 `ontology-writeback:check` 强制每道门都要登记进本体 §7。

> ### ⚠️ 2026-08-09 复验订正（drift-c）· 「现有 16 + 新 17 = 33」**两个加数今天都不对**
>
> 依据 `docs/CHECK-MIG-XR.md` §5 附表 **c**。
>
> | 加数 | 本节写 | 2026-08-09 实测 | 说明 |
> |---|---:|---:|---|
> | 现有门 | 16 | **26** | `node -e 'console.log(require("./package.json").scripts.gates.split("&&").length)'` → 26。**现算，不看行号**（`package.json` 行号已漂多次） |
> | 五份 PRD 新提的门 | 17 | **0 已落地** | 上面代码块列的 17 个门名，**今天 `scripts/` 下一个都不存在**：`ls scripts/ \| grep -i skill` → 无（金丝雀：`ls scripts/check-ref-closure.mjs` → 文件存在 ⇒ 目录读得到，0 是真 0） |
> | 合计 | 33 | **26**（今天）· **43**（五份全落地后：26 + 17） | 原式的 33 = 16+17 —— **两个加数都错，且这次没有互相抵消** |
>
> **两个方向的误导都要说清**：
> - 「现有 16」偏低 ⇒ 会**低估存量治理面**（今天实际有 26 道门要维护）；
> - 「新 17 已计入总数」的写法 ⇒ 会让人以为**这 17 道门已经有着落**，而它们**一道都还没建**。
>
> **本节的核心论点完全不受影响、且更成立了**：门多不等于治理强，合并门账必须先立。
> ⚠️ 事实上**这张账已经立了** —— 见 §9 收口表 C3 行的同日订正（那一行标的 🟡「仍无人认领」也已过期）。

**风险**：门多不等于治理强。本仓已登记的第 5 形态假绿就是「**被制度指定的死门**」
（红 + 零接线，见 #76）；门一多，"某道门长期红/长期没人跑"的概率线性上升。

**建议**：任一份 PRD 落地前，先出**一张合并门账**（谁跑、何时跑、红了谁修、
以及**每道门的"曾经真红过"证据**——没红过的门不算门）。这张账目前无人认领。

---

## 4. C4 · 同一条不准确说法在三份文档里传播 —— **必须一次性掐掉**

**说法**：「引用可校验门今天做不了」。
- migration §5.2-2 原文：「**这道门今天做不了**（`skill-lint.ts:177` 明确跳过所有非 skill 引用）」
- `docs/SPEC-industrial-skill.md` 亦有同源表述（已随本批更正）

**我的核验（逐条 file:line 亲手看过）**

| 断言 | 核验结果 |
|---|---|
| `skill-lint` 只校验 `kind=skill` 的引用 | ✅ 属实（`skill-lint.ts:165` 注释「仅针对 kind=skill（本地资源）」） |
| 「所以这道门今天做不了」 | ❌ **不成立**。`probeMissingRefs`（`apps/agentcore/src/resources.ts:11`）**已经能校验非 skill 引用**，且**已接线两处**：workflow 发布 `server.ts:1008`（`solverKeys` / `ruleKeys`）、agent 发布 `server.ts:690`（`objectTypes`） |
| 真实缺口 | **skill 发布路没接**——`POST /b/v1/skills/:id/publish` 只调 `lintSkill`（`server.ts:1243`）；**且 `probeMissingRefs` 自身 fail-open** |

**为什么这条必须纠正**：它把工作量从「**接一条已有的线 + 关掉 fail-open**」
错报成「**从零造一道门**」，会让排期与风险判断整体偏移。

---

## 5. C5 · **「Phase 2」在这套 PRD 里指三件不同的事** —— 最高风险的口径冲突

| 出处 | 「Phase 2」的含义 |
|---|---|
| migration §3 分期总览 | **权威翻转**：执行改读 `Skill.execution.plan`，删 Plan 独立入口 |
| runtime §7.1（对 WO Track A 的裁决） | **正则门降级为白名单**（路由改造的第三步） |
| runtime §3.6 / §2 非目标 | **图运行态跨请求持久化 + `human` 节点 resume** |

三个 Phase 2 分属三条互不相干的时间线，而 runtime §7.1 写着
「**Phase 2 是 Runtime 的硬前置**」——**读者无法判断是哪个 Phase 2**。

同理 `Phase 1`：migration 指"一致性门"，runtime §7.1 指"给 10 道门打 `routeSource` 标签"，
runtime §3.6 又指"`human` 节点非阻塞形态"。

**这不是文风问题**。本仓所有反复炸的坑（metric-aware、接缝丢参、两张词表）
都是**两半各自用一套词、没人对接**。三条时间线共用一个编号词，是同一个病在文档层的复现。

**建议（并线前必须做，成本极低）**：三条线各自加前缀，全文替换——

```
迁移线   : M0 影子声明 · M1 一致性门 · M2 权威翻转 · M3 独有能力
路由线   : R0 先量后改 · R1 routeSource 标签 · R2 正则门降白名单 · R3 检索前置
运行时线 : T1 单请求图 · T2 跨请求 resume
```

于是 runtime §7.1 的裁决读作「**R2 是 T1 的硬前置，R1 必须与 T1 合并实施**」——一读即明。

---

## 6. C6 · 已显式声明的口径差异（**不是冲突**，但要收敛成一个数）

runtime PRD 自己标注了两处与 WO 的口径差异，处理是对的（显式声明 > 悄悄不一致）：

1. **决策点计数**：runtime 数 `runPipeline` 内 **13 个可返回决策点** + classify 作第 14；
   WO 说「分类器前有 **10 道正则门**」。二者**统计口径不同**（前者含非正则的提前返回），
   不矛盾。但**本体 §8 里我这次只写了「10 道」**（`G-ROUTE-REGEX-PREEMPTS-RETRIEVAL`）——
   建议在本体里把两个口径一并写明，否则迟早冒出第三个数。
2. **E9「旁白一条不发」**：那是 `518e46b1` **之前**的基线；现存缺口收窄为
   角色 agent / 场景 agent 无旁白 + 无结构化进度 + 前端 reducer 丢 `role/roleLabel`。

---

## 7. 一致性检查：五份 PRD **没有**冲突的地方（记录下来，免得下轮重查）

- **「Skill 吞并 ExecutionPlan」**：五份口径一致（contract §4.4 / migration §7 / compiler §3.2 术语表脚注 / runtime §3.2）。
- **命名禁外部产品名**：compiler §3.1 红线 2 已把 SDK 规格里的 `dos skill …` 改为 `platform skill …`，复用既有 `scripts/platform-cli.mjs` 不新起二进制——符合铁律 0，其余四份无相反主张。
- **禁止手抄枚举**：compiler §3.1 红线 3 与 governance §3.1「不许出现第二个判定出口」、runtime §4.3「Skill 只能收紧不能放宽」同向，无冲突。
- **Skill 预算只能收紧**：runtime §4.3 与 governance 的权限三面「一处判定」互补，不重叠。
- **`execution.steps` 复用既有 `PlanStepSchema`**：compiler §3.2 明确"复用既有类型是单一来源，不是重名"——与 contract §4.4 一致。

---

## 8. 结论与建议处置顺序

| 序 | 事项 | 谁定 | 阻塞谁 |
|---|---|---|---|
| 1 | **C1 命名裁决**（建议：`requires` 结构 + 旧名降为解析期别名） | **仓主** | contract / migration / compiler 都改不动，C2 也解不了 |
| 2 | **C5 三条时间线加前缀**（M/R/T） | 审核方可直接做 | 所有 PRD 的可读性与派单准确性 |
| 3 | **C4 掐掉传播性错误** | 审核方（本批已改 SPEC，migration §5.2 待改） | 排期判断 |
| 4 | **C3 合并门账 + 每道门"曾真红过"证据** | 需立一张单，无人认领 | 五份 PRD 任一落地 |
| 5 | C6 口径一并写进本体 | 审核方 | 无（防第三个数） |

> **诚实边界**：本文只做了**跨文档对照**与其中关键断言的代码核验，
> **没有**逐份 PRD 做完整技术复审（例如 compiler 的编译管线是否可实现、
> governance 的 trace 采集点是否够用，均未逐条验证）。
> 五份 PRD 各自的 `file:line` 我抽查了本文引用到的那些，未做全量抽验。

---

## 9. 收口记录（本文提出后已落地的部分）

| 条 | 状态 | 落地方式 |
|---|---|---|
| **C1 命名** | 🟡 **已裁决（仓主 2026-08-03「ok」= 采纳）** | 采纳 `requires` 结构；`references[]`/`dependsOn[]` 降为**解析期输入别名**（读入即归一，不作为运行时字段）。写入 `docs/SPEC-industrial-skill.md` §9.1；`PRD-skill-migration` §10.3 的偏离行已改为「裁决结果 + 原提案存档」 | 🔴 **2026-08-09 订正：这个 ✅ 是错的。** 收口表记的是「文档改完了」，被当成了「事情做完了」。实测（`agentcore.ts:236-261` 18 字段逐个点名）：`SkillDefinition` 无 `requires`，也无任何变体；全仓 `requires` 命中全是 `FeatureDef.requires`/`requiresSidecar`，**无一在 skill 语境**。再追一层：SPEC §9.1 的落地口径是「旧名降为解析期归一别名，读入即折进 `requires`」——**归一层同样不存在**，消费方 `skill-lint.ts:343/347` 与 `resource-projector.ts:333/334` **直读** `s.references`/`s.dependsOn`。三分法定性：**这条线根本没画**（不是「接了线没数据」也不是「接错地方」）。且 `WO-SKILL-MIG-G3` 在 13 条 skill 分支里不存在 —— **裁决 2026-08-03 下达，6 天零派单**。<br>✅ **2026-08-09 二次复核（`WO-DOCFIX-SKILL-CLAIMS`）：上面这段订正逐条复跑通过，不需要再改。** 复跑证据：`grep -rn "requires" packages/contracts/src/*.ts` → **仅 3 行**，全是 `features.ts:15` 的 `FeatureDef.requires` 与 `intelligence-resource.ts:75/137` 的 `requiresSidecar`，**skill 语境 0**（金丝雀：同 glob 跑 `SkillDefinitionSchema` → **5 命中** ⇒ 工具有效）；`skill-lint.ts:343/347` 与 `resource-projector.ts:333/334` 逐行确认仍是**直读原字段**（`skill.references` / `skill.dependsOn`）；`git ls-remote origin | grep -i mig-g3` → **无**（金丝雀：同命令 `grep -c handoff-skill` → **8** ⇒ 远端读得到）。**⇒ 裁决至今 6 天仍零派单，这条是本轮排期的第一优先级。**
| **C2 门重名** | ✅ 随 C1 收口 | `skill-refs:check` 与 `skill-ref-closure:check` 合并为一道 `skill-refs:check` |
| **C3 门总数 16→33** | ~~🟡 **仍无人认领**~~ → **✅ 2026-08-09 复验：账已立、门已接、棘轮已上（反向过期）** | ~~合并门账（谁跑 / 何时跑 / 红了谁修 / **每道门"曾真红过"的证据**）尚未立单。**任一份 PRD 落地前必须先有这张账**~~ → **🔁 这一行今天在"说没做、其实已做"的方向上误导排期**（`docs/CHECK-MIG-XR.md` §5-6）。承载物三件齐全：`scripts/gate-ledger.json`（51 条门账）· `scripts/check-gate-ledger.mjs`（在 `pnpm gates` 链**末位**，`package.json` 的 `gates` 串最后一项）· `scripts/gate-ledger-baseline.json`（棘轮基线）。**亲手跑 `node scripts/check-gate-ledger.mjs` → RC=0**，门自己的现算输出：`GATES_CHAIN 26 · GATE_SH 6 · CI_ONLY 0 · MANUAL 7 · NONE 12 · 合计 51`。⇒ **「任一份 PRD 落地前必须先有这张账」这个阻塞条件已解除**，五份 PRD 不再被它卡住。<br>⚠️ **但别把"账已立"读成"门都算门"**：现算 `NONE`（已建未接进任何链）**12 道**、`provenRed=NEVER`（从未真红过）**35 道 / 51** —— 按本文自己的判据，今天仍有约七成的门**不算门**；**棘轮只防新增，不烧存量**。数字请用 `node scripts/check-gate-ledger.mjs` 现算，别抄本行。<br>⚠️ **跑这道门前必须先 `pnpm --filter datacore build`**（本单实测踩到）：`apps/datacore/dist/**` 不存在时，它会报 **7 条「责任边界指向空气」并 RC=1** —— 那是**环境假红**，不是治理回归。<br>另：本行与 §3 的「16 + 17 = 33」同批订正，实测**现有 26 道 · 新门 0 道已落地**（drift-c）。 |
| **C4 传播性错误** | ✅ 三处已掐掉 | `SPEC-industrial-skill.md` 两处（§2-⑫ 表格 + §4「三条最该先做」）· `PRD-skill-migration` §5.2 已改为「接一条已有的线 + 关掉 fail-open，不是造门」 |
| **C5 Phase 2 三义** | ✅ 已改名 **（⚠️ 2026-08-09 加脚注：扫描范围小于读者理解的范围）** | 拆成 **M0–M3**（迁移线）· **R0–R4**（路由线 / WO Track A）· **T1–T2**（运行时线）。两份 PRD 均已全文替换且插入命名空间图例，**残留裸「Phase N」= 0**（机械核过）<br>⚠️ **脚注（`docs/CHECK-MIG-XR.md` §5-2）**：「两份 PRD = 0」**属实**（`grep -c "Phase [0-9]"` → `PRD-skill-migration.md` **0** · `PRD-skill-runtime-orchestrator.md` **0**），**但同批一起改的 `docs/SPEC-industrial-skill.md` 没被扫到**，那里仍有 **2 处**裸 Phase（§2 第 ⑥ 层「Track A Phase 4」· §5「Phase 0 的自动导出」，已在该文就地标注并给出应读作的命名空间）。<br>**形态**：「我用『两份 PRD 扫描为 0』当作『裸 Phase 已清零』的证据，而前者并不度量后者。」**「机械核过」四个字最容易让人不再追问"核的是哪几份"。**<br>（本文 §5 自身的 6 处 `Phase [0-9]` 是**讨论这个词本身**的元文本，不计残留 —— 这也说明**光看计数会误判，必须点开看**。） |
| **C6 口径差异** | 🟡 部分 | 决策点计数两种口径（13+1 vs 10 道正则门）尚未在本体里并列写明——留待下次回写本体时补 |

> **另记一条本文写作时未预见、实施中才暴露的事**：`PRD-skill-crossreview.md` 自身被
> `check-prd-ontology.mjs` 索引为 `hasOntologyRef: false`（它是审查记录不是 PRD，无《本体引用与影响》节）。
> 门不因此红（该门只生成索引不强制），但 `docs/prd-ontology-index.json` 会被每次 gate 重写 —— 需随提交同步，否则工作区永远脏。
