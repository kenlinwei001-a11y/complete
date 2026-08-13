# WO 套件 · `docs/PRD-skill-migration.md` 的可执行切片

> ## ⚠️ 过期横幅（收编时加·2026-08-13）
> - **基线 sha**：`9b49b5f6` — **canonical 已在其后 473 个提交**。
> - **本次有没有重跑**：**没有可执行断言可跑**（纯 WO 规划文档）⇒ 改做**抽查 3 个 `file:line` 锚点回代码核对**。
> - **抽查结论**：
>   | 文中锚点 | 收编日实测 | 判 |
>   |---|---|---|
>   | `apps/agentcore/src/resources.ts:11` `probeMissingRefs` 存在 | 符号在，实为 **`resources.ts:107`** | ⚠️ 行号漂移（结论仍成立） |
>   | `server.ts:690` / `server.ts:1008` 两处已接 | 实为 **`server.ts:762`** / **`server.ts:1080`** | ⚠️ 行号漂移（结论仍成立） |
>   | §「WO-A 引用闭包接线 ✅ 今天就能做」：`server.ts:1235-1293` **无**挂载点 | **⛔ 已被推翻** —— 收编日实测 `apps/agentcore/src/server.ts:1332` 已有 `probe: (want) => probeMissingRefs(deps.dataCore, a, want)`，且 `:1327` 注释已写明 fail-**closed**（`503 REF_PROBE_UNAVAILABLE`），非原文所述 fail-open | ❌ 结论过期 |
> - ⇒ **WO-A 这张单的缺口在 473 个提交内已被闭掉**；本文的排期表须按此重排，不得照原文再派 WO-A。
>   其余 4 张 WO 未逐条复核（需另起单）。

| 项 | 值 |
|---|---|
| 版本 | v1.0（2026-08-09） |
| 上游 | `docs/PRD-skill-migration.md`（路线与验收判据·零代码）· `docs/PRD-skill-compiler-registry.md` · `docs/PRD-skill-runtime-orchestrator.md` |
| 本文解决 | 把迁移 PRD 拆成 **5 张可派发的 WO**，把依赖关系与切片顺序**定死**，并标出哪一张**今天就能开工**、哪几张**必须等另两条线的产物形状** |
| 本文不解决 | 不写实现代码。不替仓主做那两处**真互斥**的裁决（§4.1 冲突 A / 冲突 B） |
| 基线 commit | `9b49b5f6`（`origin/claude/inspiring-gates-aqczjg`） |
| 交付形态 | **零代码改动**。本单只新建本文件一份 |

> **本文的核心主张**：这次迁移最容易失败的方式，不是切片切错，而是**三份 PRD 对同一个字段用了两个名字，
> 而没有任何一层会喊一声**。§4.1 冲突 A 就是这个形状 —— 它今天不解决，M0 生成的 32 份声明
> 与运行时 `compileGraph` 的入口对不上，且四包测试会全绿。

---

## 1. 它到底要迁什么（一句话）

> **把「一个意图怎么答」这件事的权威，从 `ExecutionPlan`（今天 32 份，是唯一真源）
> 迁进 `Skill`（今天 7 份，与意图零引用边），使 32 份 Plan 降为 `Skill` 内的一个字段，
> 迁移过程零行为漂移、迁移之后单一真源。**

原文出处：`docs/PRD-skill-migration.md:75`「把「一个意图怎么答」的权威从 ExecutionPlan 迁到 Skill，
且保证迁移过程零行为漂移、迁移之后单一真源」；标题 `:1`「32 份 ExecutionPlan 升格进 Skill」。

### 1.1 ⚠ 工单前提与 PRD 不符（本节是本单最重要的产出，请先读）

派单文本写：

> 「迁的是 Skill 的版本/格式」「『迁移』在语义上依赖前两者的产物形状」

**这个前提不成立。** 逐条对照：

| 派单的说法 | PRD 实际写的 | 判定 |
|---|---|---|
| 版本间迁移（v1 → v2 数据升级） | 全文无此意。`version` 是既有的**每 key 单调整数**，本迁移**不动它** | ❌ 不符 |
| 格式迁移（Skill 声明格式换代） | 全文无此意。反而**要求格式不变**：`PlanStep` 判别联合「**保留不动**（步骤语义是资产，不是负债）」（`:21`） | ❌ 不符 |
| 租户间迁移 | 全文无此意。租户维出现的是**播种缺口**（R-B，非 demo 租户无 Skill），不是"把数据从 A 租户搬到 B 租户" | ❌ 不符 |
| **对象权威迁移**（Plan → Skill） | 正是全文主题 | ✅ 这才是它 |

**但派单的结论方向仍然对，只是理由不同。** 迁移确实必须等另两条线 —— 不是因为"迁的是版本/格式"，
而是因为 **§4.1 的两处词表/状态机冲突今天真实存在**，且它们的裁决权分别在 compiler 与 orchestrator 两条线上。
**理由错了会导致切片错**：若按"迁版本/格式"去切，会切出一张"写数据升级脚本"的 WO —— 那张 WO 在 PRD 里**没有对应物**，
纯属凭空造需求；而真正卡住的 §4.1 反而没人认领。

---

## 2. 今天的起点（三分法定性 · 逐条 file:line · 本单静态读码实测）

> **工具自证（铁律 0.6）**：本节所有"0 命中"结论，均先跑金丝雀证明 grep 没坏。
> 金丝雀 = `resolvePlanForIntent`，命中 **8** 条（`apps/agentcore/src` 内 8 条，见 §2.3）；
> 金丝雀 = `SkillDefinitionSchema`，命中 **6** 条。两个金丝雀都中 ⇒ 工具是好的，下面的 0 才是真 0。

### 2.1 契约层（`packages/contracts/src/agentcore.ts`）

| 问题 | 实测 | file:line | 定性 |
|---|---|---|---|
| `SkillDefinitionSchema` 有版本字段吗 | **有**。`version: z.number().int()`（必填、非 optional） | `agentcore.ts:240` | **接了线有数据**（7 个种子 skill 全部 `version: 1`；`new-version` 路由真会写 max+1） |
| 版本是 semver / schemaVersion 吗 | **不是**。是**每 key 单调整数**，无 major/minor、无兼容语义 | `agentcore.ts:240` | — |
| 状态机今天几态 | **3 态**：`z.enum(["DRAFT", "PUBLISHED", "RETIRED"])` | `agentcore.ts:247` | **已实现** |
| 规格要几态 | **5 态**：`DRAFT → TESTING → PUBLISHED → DEPRECATED → RETIRED` | `docs/PRD-skill-compiler-registry.md:313` | **未实现**（且**规格属 compiler 线，不属迁移线** —— 见 §4.1 冲突 B） |
| `execution` 字段 | **0 命中** | — | **未实现** |
| `businessIntent` 字段 | **0 命中**（`apps/*/src`＋`packages/*/src`＋`apps/agentcore/test` 全域） | — | **未实现** |
| `examples` 字段（Skill 侧） | **0 命中**（`agentcore.ts` 内 `examples` 一次都不出现） | — | **未实现**·且**无人认领**（见 §4.2） |
| `antiExamples` / `exclusivity` / `acceptance` / `progress` | **0 命中** | — | **未实现** |
| `references` / `dependsOn` | **已有**，`z.array(SkillReferenceSchema).optional()` | `agentcore.ts:256-257` | 见 §2.2 |
| 引用 kind 词表 | 8 种：`rule/constraint/slice/ontologyType/solver/skill/workflow/agent`，**已导出成具名数组供消费方 import**（刻意防手抄） | `agentcore.ts:216` | **接了线有数据** |

**SkillDefinition 今天的完整字段表**（本单逐字段读出，`agentcore.ts:236-261`）：
`id · tenantId · key · version · name · summary · body · resources · status · capability? · sideEffect? ·
inputSchema? · outputSchema? · references? · dependsOn? · approvalGate? · provenancePolicy? · maxBudgetRounds?`
—— **迁移 PRD §2 目标形态里的 `execution` / `businessIntent` 两组，今天一个都不在。**

### 2.2 引用可校验（**这是本套件里定性最容易错的一条，PRD 已被更正过一次**）

| 事实 | 实测 | file:line |
|---|---|---|
| `probeMissingRefs` 存在吗 | **存在** | `apps/agentcore/src/resources.ts:11` |
| 有几个 src 调用方 | **2 个**（+1 处 import，`server.ts:64`；`grep -c` = 3） | `server.ts:690`（agent 发布·objectTypes）· `server.ts:1008`（workflow 发布·solverKeys/ruleKeys） |
| skill 发布路接了吗 | **没接**。`POST /b/v1/skills/:id/publish` 全段（`server.ts:1235-1293`）只有 lint + evalCases + runSkillProbe，**零 `probeMissingRefs`** | `server.ts:1235-1293` |
| `skill-lint` 校验非 skill 引用吗 | **不校验**：`if (ref.kind !== "skill") continue;` | `apps/agentcore/src/skill-lint.ts:176` |
| 它自身 fail-open 吗 | **是，且有两层**：① 三处 `catch { /* fail-open */ }`（`:27` `:35` `:43`）② **更隐蔽的一层** —— `if (known.size > 0)` 守卫（`:26` `:34` `:42`）：注册表**返回空集时不报任何缺失**。①是"A 挂了放行"，②是"A 活着但答了空也放行" | `resources.ts:22-46` |

> **定性 = 接了线接错地方**（不是"未实现"，不是"没接线"）。
> 本体 `docs/SYSTEM-ONTOLOGY.md:1011` `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` **已登记这一条**，
> 分类与本单独立实测**逐字一致**。迁移 PRD `:230-236` 也已就此更正过原稿。
> **工作量 = 接一条已有的线 + 关掉两层 fail-open，不是造一道门。**

⚠ **顺带抓到一条注释谎报**：`skill-lint.ts:176` 的行尾注释写
「非 skill 引用由**发布时的跨系统探针**或各自注册表保证」——
**skill 发布路上那个探针根本没接**。注释描述的是 workflow/agent 两条路的现实，
读它的人会以为 skill 侧也有。WO-A 须**同批订正这行注释**，否则下一个人还会被它骗。

### 2.3 执行链读取点（PRD §7.1 清单 · **行号已漂移，本单重测**）

| PRD §7.1 写的 | 本单实测 | 差异 |
|---|---|---|
| `orchestrator.ts:1412` runPathA | `orchestrator.ts:1113` **与** `orchestrator.ts:1678`（两处） | 行号漂移；且 PRD 把两处写成一处 |
| `server.ts:460` trace 端点 | `server.ts:464` | 漂移 +4 |
| `server.ts:1995` scenarioClosure | `server.ts:2182` | 漂移 +187 |
| `server.ts:2247` capabilityOk | `server.ts:2434` | 漂移 +187 |
| 定义处 `catalog/service.ts:83` | `catalog/service.ts:83` ✅ | 未漂移 |

`resolvePlanForIntent` 全域命中 8 条（金丝雀）：定义 1（`catalog/service.ts:83`）+ import 2 + 调用 5。
**定性 = 接了线有数据**（32 份 plan 真在跑）。
**⚠ 派单纪律**：WO-E 的 dev **不许照抄 PRD §7.1 的行号**，必须自己重跑 `grep -rn resolvePlanForIntent apps/agentcore/src` 现取。

### 2.4 多租户播种缺口（PRD R-B）

| 函数 | 签名 | file:line | 定性 |
|---|---|---|---|
| `seedIntentsAndPlans` | `(tenantId = SEED_TENANT, now)` —— **有** tenantId 入参 | `seed.ts:210` | 接了线有数据 |
| `seedRegistry` | `(now = new Date().toISOString())` —— **无** tenantId 入参 | `seed.ts:909` | **接了线接错地方**（7 个种子 skill 全部硬编码 `tenantId: SEED_TENANT`，`seed.ts:1018/1065/1109/1153/1197/1240/1289`；唯一 src 调用方 `main.ts:27` 只在 boot 为 demo 播种） |

**7 个种子 skill 逐条实测**（`grep -c 'id: "skl_seed'` = **7**，与 PRD §1.1 相符）：
`capacity_analysis · sop_meeting · risk_analysis · supply_chain_mgmt · quality_control · mcp_integration · capacity_action_draft`。

### 2.5 既有的"迁移/升级机制"能复用什么（本单去找了，结论分三档）

| 机制 | 实测 | file:line | 能否复用 |
|---|---|---|---|
| **SQL 迁移** | `apps/agentcore/migrations/` 现有 **001–011**（最大 `011_pending_clarification.sql`）；`apps/datacore/migrations/` 到 **027** | — | **可复用范式**，但本迁移**不需要新表**：compiler PRD `:570` 方案 A 已定「复用既有 `skills.definition` JSONB」（`apps/agentcore/migrations/001_init.sql:118-126`）。**`execution`/`businessIntent` 落进 JSONB ⇒ 零 migration、零四处同改** |
| **迁移号唯一门** | `scripts/check-migration-numbering.mjs`（已在 `pnpm gates`） | — | **是硬约束**：若哪张 WO 真新建了 `.sql`，编号必须顺延到 012+，否则门红。**本套件按"不新建表"设计，故不触发** |
| **契约级 schema 版本化先例** | **有，且是唯一一处**：`CONFIG_BUNDLE_SCHEMA_VERSION = "1.0"`（`packages/contracts/src/config-bundle.ts:10`）+ **major 兼容校验**（`apps/datacore/src/config-bundle.ts:84`：major 不等即 FAILED） | 见左 | **可作范式，但本迁移不需要**。理由：迁移的是**权威归属**不是**数据格式**，新增字段一律 additive（optional），老消费方读不到新字段 = 走既有缺省兜底，不存在跨 major 破坏 |
| **Skill 版本派生** | `POST /b/v1/skills/:id/new-version`：`version = max(同 key siblings)+1`，复制为 DRAFT，**insert 不 update**（历史版本全留） | `server.ts:1312-1322` | **已实现，直接用**。M0 的 32 份影子一律 `version: 1` 新建即可 |
| **运行时版本选择** | `selectTenantSkills`：只收 PUBLISHED、同 key 取**最高 version**、按 key 字典序 | `orchestrator.ts:257-265` | **已实现**。但注意它今天只服务自由问答（`orchestrator.ts:1997`），**不是**确定性路径的解析源 |
| **门登记账** | `scripts/check-gate-ledger.mjs` + `scripts/gate-ledger.json`：新加 `scripts/check-*.mjs` **不登账即红**（判据①），且要求 `guardedPaths` 非空且真实存在、`escalation ∈ {审核方,仓主}` | — | **是硬约束**：本套件每张加门的 WO，出口判据里都必须含 `node scripts/check-gate-ledger.mjs` RC=0 |
| **棘轮基线范式** | 现有 6 份：`debattery-baseline.json` · `cli-parity-baseline.json` · `gate-ledger-baseline.json` · `ontology-anchor-baseline.json` · `ontology-description-baseline.json` · `stale-claim-baseline.json` | `scripts/` | **直接照抄**给 `skill-business-intent:check` 用 |

> **一句话**：**没有任何"Skill 数据升级/迁移器"需要写** —— 因为迁的不是数据格式。
> 该复用的是 ① JSONB 承载（免建表）② `new-version` 版本派生 ③ 门账 ④ 棘轮基线，四件全部**已存在**。

### 2.6 `pnpm gates` 金值：**PRD 已过期**

| 出处 | 说法 | 实测 |
|---|---|---|
| `PRD-skill-migration.md:47` / `:513` | 「当前 16 条（`package.json:29`）」→ 加 7 道 → **16 → 23** | ❌ |
| 本单实测 | `package.json:32` 的 `gates` 串含 **24** 条（`node -e` 解析 `check-*.mjs` 计数）；`scripts/` 下共 **31** 个 `check-*.mjs`（其余未进 gates 链） | ✅ |

⇒ **PRD §12.2 的金值「16 → 23」今天就是错的，正确基数是 24**。加 7 道 → **24 → 31**。
派单时必须带上这一条，否则 WO 的 dev 会照 PRD 写一个恒红（或恒绿）的计数断言。
**⚠ 且这个数字会随另两条线继续变** —— compiler / orchestrator 两线各自也在加门。
**故所有 WO 的出口判据一律写「`node scripts/check-gate-ledger.mjs` RC=0」，禁止写死聚合条数。**

### 2.7 两条断点尚未回写本体

`PRD-skill-migration.md:64-73` 要求 M0 立项时把 `G-SKILL-PLAN-DUAL-AUTHORITY` 与
`G-SKILL-TENANT-SEED-ASYMMETRY` 写进本体 §8。**实测两个名字在 `docs/SYSTEM-ONTOLOGY.md` 命中 0**
（金丝雀：同文件 `G-SKILL` 命中 4 条、`G-1|G-4` 命中 31 条 ⇒ 工具没坏）。**未回写，是 WO-B 的出口项。**

---

## 3. 三分法总表（一屏速查）

| # | 对象 | 定性 | 证据 | 修法 |
|---|---|---|---|---|
| 1 | `SkillDefinition.version` | 接了线有数据 | `agentcore.ts:240` · `server.ts:1319` | 不动 |
| 2 | `SkillDefinition.status` 3 态 | 已实现 | `agentcore.ts:247` | 不动（5 态归 compiler 线） |
| 3 | `execution` / `businessIntent` / `examples` | **未实现**（契约 0 命中） | — | 加字段（WO-B） |
| 4 | `probeMissingRefs` → skill 发布 | **接了线接错地方** | `resources.ts:11` · `server.ts:690/1008` 有 · `server.ts:1235-1293` 无 | 补挂载点（WO-A） |
| 5 | `probeMissingRefs` 两层 fail-open | 接了线接错地方 | `resources.ts:22-46` | 收紧（WO-A） |
| 6 | `skill-lint.ts:176` 注释谎报 | 文档与代码不符 | `skill-lint.ts:176` | 订正（WO-A） |
| 7 | `seedRegistry` 无 tenantId | **接了线接错地方** | `seed.ts:909` vs `seed.ts:210` | 补入参 + 接懒播种（WO-E） |
| 8 | `resolvePlanForIntent` 5 处调用 | 接了线有数据 | `catalog/service.ts:83` + 5 调用点 | 翻转（WO-E） |
| 9 | `resolveSkillForIntent` | **未实现**（0 命中） | — | 新建（WO-D） |
| 10 | `qos.skill-execution-authority` flag | **未实现**（3 命中**全在 PRD 文本里**，代码 0） | `PRD-skill-migration.md:262/374/473` | 新建（WO-D） |
| 11 | `skill-export.ts` 导出器 | **未实现**（`apps/agentcore/src/mocks/` 只有 `clients.ts`/`prng.ts`/`seed.ts`） | — | 新建（WO-C） |
| 12 | 两条断点回写本体 | 未做 | `SYSTEM-ONTOLOGY.md` 0 命中 | 回写（WO-B） |
| 13 | `pnpm gates` 金值 16 | **PRD 过期**，实为 24 | `package.json:32` | 改判据口径（全部 WO） |

---

## 4. 依赖关系：为什么迁移必须等另两条线（真正的理由）

### 4.1 两处**真互斥**冲突 —— 必须仓主裁决，dev 不能自决

#### 冲突 A · 同一个字段，两份 PRD 两个名字 🔴

| 出处 | 写的字段名 |
|---|---|
| `docs/PRD-skill-migration.md:165` | `execution.plan[]` |
| `docs/PRD-skill-compiler-registry.md:176` | **`skill.execution.steps`** |
| `docs/PRD-skill-runtime-orchestrator.md:22/41` | 读 `Skill.execution`，`compileGraph(Skill.execution ⊕ legacy plan.steps)` 为**唯一升格入口** |

**为什么这是事故而不是笔误**：本仓已有一族专治此病的断点 —— `G-SIDEEFFECT-VOCAB-SPLIT`
（同一概念多套互不相识的词表 → 判定分支永不触发、测试照样绿）。
三条线若各按各的名字落地：M0 生成 32 份带 `execution.plan` 的声明 → orchestrator 的 `compileGraph` 去读 `execution.steps`
→ 读到 `undefined` → 按 `legacy plan.steps` 回落 → **一切照常工作、四包全绿、而整个迁移等于没发生**。
这正是 M1 §6.4 变异反证要演示的那个形状，只不过这次是**真的**。

**裁决点**：`plan` 还是 `steps`？（本单不替仓主定。倾向 `steps` —— 因为 compiler PRD `:162` 已明令
产物**不得**叫 `ExecutionPlan`/「执行计划」，而 `execution.plan` 这个名字离那条禁令最近。）

#### 冲突 B · 状态机 3 态 vs 5 态，**规格在 compiler 线** 🟠

- 今天：`agentcore.ts:247` = 3 态。
- 规格：`PRD-skill-compiler-registry.md:313` = 5 态（`DRAFT→TESTING→PUBLISHED→DEPRECATED→RETIRED`）。
- **归属**：这是 **compiler 线的 O4 目标**（`:75`），**不是迁移线的**。迁移 PRD 全文没要求改状态机。
- **耦合点**：compiler PRD `:327` 要求「引入新状态的**同一个 PR** 必须把所有 `status === "PUBLISHED"` 的判定点
  收敛为契约导出的谓词（如 `isRunnableSkill()`）」。而 M0 一次生成 **32 份 DRAFT**，
  M2 之后它们要变 PUBLISHED —— **32 份声明正好是那批判定点的最大消费方**。
- **顺序结论**：**5 态改造必须排在 M0 之前或之后，不能与 M0 同期**。同期 = 一边在批量造 DRAFT，
  一边在改 DRAFT 的语义与判定谓词，冲突面是同一批数据。

> ⚠ 派单文本说「审核方实测：状态只有 3 态，而规格要 5 态」——**事实对，但归属要说清**：
> 5 态的规格**不在迁移 PRD 里**。照着"迁移要把 3 态改 5 态"去派单，会派出一张越界的 WO
> （改了 compiler 线的地盘），且迁移 PRD 里找不到它的验收判据。

### 4.2 一处**无人认领**的字段 🟠

`docs/PRD-skill-compiler-registry.md:339`：「`examples` 非空 …… Skill 今天没有 `examples`
（触发面缺失）…… 本期作为**编译期 warning**，**字段落地由 Track E 做**」。
—— compiler 线明确**把 `examples` 字段的落地推给迁移线**。
而迁移 PRD `:104` 的自动导出表**直接假定 Skill 有 `examples` 可写**，从未说要新建这个字段。
**两边都以为对方会加。实测契约里 0 命中。** ⇒ **WO-B 必须显式认领 `examples`**，否则 WO-C 的导出器会写进一个不存在的字段。

### 4.3 一处**双重认领** 🟡

**字节相等验收**被两份 PRD 各自声明为自己的命门：
- `PRD-skill-migration.md:206` 硬约束① → `skill-plan-parity:check`（M1）
- `PRD-skill-runtime-orchestrator.md:69` R6 →「迁移验收 = 同意图同槽位，answer 与 provenance **字节相等**（§10 A1）」

**同一条断言、两个门名、两条线。** 风险是经典的"都以为对方做了" ⇒ 两边都不做，或做两份互不相识的规范化器
（而规范化器是 PRD §11 R-A 亲自标的 🔴 单点故障）。
**处置**：WO-D 出口判据里**显式写明**「本门即 orchestrator PRD §10 A1，两处指向同一实现，规范化器只此一份」。

### 4.4 一处**文件级撞车** 🟡

- 迁移 WO-E 改 `apps/agentcore/src/router/orchestrator.ts`（runPathA 的解析源，`:1113`/`:1678`）。
- orchestrator 线 W2（`PRD-skill-runtime-orchestrator.md:636`）也改 `router/orchestrator.ts`（Coordinator 段）。
- 迁移 PRD `:444` 另记 G1 与 Track B1 撞 `workflow/executor.ts:104`。

⇒ **WO-E 与 orchestrator W2 必须串行，或一个 dev 整单做。**

### 4.5 依赖图（结论）

```
                        ┌─ WO-A 引用闭包接线（零依赖·今天就能开工）
                        │
仓主裁决 冲突A/冲突B ──▶ WO-B 契约冻结 ──▶ WO-C 导出器+M0 门 ──▶ WO-D M1 一致性门 ──▶ WO-E M2 权威翻转
   ▲                                                                                      ▲
   └── compiler 线（5 态 / requires 形状）  orchestrator 线（compileGraph 入口）───串行───┘
```

**唯一不被任何东西挡住的是 WO-A。** 其余四张的关键路径起点是**仓主对冲突 A 的一句裁决**（不是代码工作量）。

---

## 5. WO 套件（5 张）

> **全套通用纪律**（每张 WO 顶部都要复制）：
> ① 一 WO 一 handoff 分支 `claude/handoff-<wo>`，**不碰 canonical**；
> ② **每完成一个可命名单元立刻 commit + push**（推旁支零成本；"gate 跑着"不是"工作已落盘"）；
> ③ 出口判据里**禁止**写死 `pnpm gates` 聚合条数（§2.6），一律用 `node scripts/check-gate-ledger.mjs` RC=0；
> ④ 新加 `scripts/check-*.mjs` **必须**同批登记 `scripts/gate-ledger.json`（`guardedPaths` 非空且真实存在 + `escalation`），否则门账门当场红；
> ⑤ 门脚本里的金丝雀**必须与主逻辑共用同一份实现**，不许各抄一份正则；
> ⑥ 报任何"0 命中/不存在"必须同时给出金丝雀命中证据；
> ⑦ 变异反证前先 `pnpm --filter agentcore exec tsc --noEmit` RC=0（否则红是编译红，不是断言红）。

---

### WO-SKILL-MIG-A · 引用闭包接线（**今天就能开工·零依赖**）

**一句话**：把已经存在、已经接了两处的 `probeMissingRefs` 补挂到 skill 发布路，并关掉它的两层 fail-open。

**🚦 范围边界（只碰这些）**
- `apps/agentcore/src/server.ts`（**仅** `POST /b/v1/skills/:id/publish` 段，`:1235-1293`）
- `apps/agentcore/src/resources.ts`（`probeMissingRefs` fail-open 收紧 + 新增 strict 模式入参）
- `apps/agentcore/src/skill-lint.ts`（**仅** `:176` 行尾注释订正，**不改逻辑**）
- 新建 `apps/agentcore/test/skill-ref-closure.seam.test.ts`
- 新建 `scripts/check-skill-ref-closure.mjs` + `scripts/gate-ledger.json`（登账）

**出口判据（可机械判定）**
1. `grep -c "probeMissingRefs" apps/agentcore/src/server.ts` ≥ **4**（今天 = 3：1 import + 2 调用）。
2. 发布一个含 `references:[{kind:"solver",key:"__no_such_solver__"}]` 的 skill → HTTP **422**，错误码 `SKILL_REF_UNRESOLVED`；同一 skill 换成真实 solver key → **200**。
3. **fail-open 两层各有一条断言**：① DataCore 抛错 → 仍放行（保留，这是刻意的）且**日志留痕**；② DataCore 返回**空集** → **不再**静默放行（今天 `if (known.size > 0)` 会放行）。
4. `node scripts/check-skill-ref-closure.mjs` RC=0；`node scripts/check-gate-ledger.mjs` RC=0。
5. `apps/agentcore/src/skill-lint.ts:176` 的注释不再声称"发布时的跨系统探针"覆盖 skill（订正为事实）。

**🔗 接缝驱动测试**（契约声明 × DataCore 注册表 · A/B 两系统）
`skill-ref-closure.seam.test.ts`：用 `createTestApp` 起 B，配 mock DataCore；
**同一条测试内**先 POST 建 skill（引用一个 DataCore 真有的 solver key）→ publish 成功；
再建第二个 skill 引用一个 DataCore 没有的 key → publish 422。
**必须在同一条测试里跑两条**，拆开 = 各半绿。

**🧬 变异反证**
摘掉 `server.ts` skill 发布路上那一行 `probeMissingRefs` 调用 → **判据 2 的 422 那半必须变红**。
（附加变异：把 `known.size > 0` 守卫改回原样 → 判据 3② 必红。）

**预估触及面**：src 3 文件（其中 1 个只改注释）· test 1 新建 · scripts 1 新建 + 1 登账。**约 5 文件。**

**依赖**：**无**。不依赖冲突 A/B 的裁决，不依赖 compiler/orchestrator 任何产物。**可立即派。**

**为什么值得单独一张**：本体 `SYSTEM-ONTOLOGY.md:1011` 已把它登记为 🔴 未修；它是 M0 三道门里的第 2 道
（`skill-ref-closure:check`），但**不需要等 M0** —— 今天 7 个种子 skill 就有 `references` 数据可跑。
把它提前做掉，M0 落地时这道门已经是绿的。

---

### WO-SKILL-MIG-B · Skill 契约字段冻结 + 本体回写（**卡在仓主裁决**）

**一句话**：把 `execution` / `businessIntent` / `examples` 三组字段一次性冻进契约，并解决 §4.1 冲突 A 的词表分裂。

**🚦 范围边界**
- `packages/contracts/src/agentcore.ts`（**只** additive 加字段，不改既有字段）
- `docs/SYSTEM-ONTOLOGY.md`（§2.H 对象类型 + §8 登记两条断点）
- 新建 `scripts/check-skill-vocab-single.mjs` + `scripts/gate-ledger.json`
- 新建 `apps/agentcore/test/skill-contract-vocab.seam.test.ts`
- **禁止**碰 `apps/*/src` 的任何执行逻辑（本单只冻契约，不接线）

**出口判据（可机械判定）**
1. `execution` / `businessIntent` / `examples` 三字段在 `SkillDefinitionSchema` 中存在，且**全部 additive**（`.optional()` 或带 `.default()`）—— 断言方式：既有 7 个种子 skill **不改一字**仍能通过 `SkillDefinitionSchema.parse`。
2. **词表单一**：全仓（`docs/*.md` ∪ `packages/*/src` ∪ `apps/*/src`）中，确定性步骤字段的拼写**只有一种**。机械判据：裁决取 `steps` 则 `grep -rn "execution\.plan" docs packages apps` = 0（反之亦然），且门脚本自带金丝雀（拿裁决后的那个名字跑一遍必须命中）。
3. `businessIntent` **必填但允许显式哨兵** `{status:"TODO", owner:"<待指派>"}`；断言：缺字段 → parse 失败；哨兵 → parse 成功。
4. `docs/SYSTEM-ONTOLOGY.md` 含 `G-SKILL-PLAN-DUAL-AUTHORITY` 与 `G-SKILL-TENANT-SEED-ASYMMETRY` 两条（今天 0 命中）。
5. `node scripts/check-gate-ledger.mjs` RC=0；`pnpm -r build` RC=0。

**🔗 接缝驱动测试**（契约 × 既有消费方 · 两半）
`skill-contract-vocab.seam.test.ts`：**同一条测试内** ① 用新字段构造一个 SkillDefinition 并 `parse` 成功；
② 把它喂给**真实消费方** `lintSkill`（`skill-lint.ts:234`）与 `projectNavigationSlice` 侧的 `resource-projector`，
断言两者**不崩**且新字段被识别（而不是被 zod strip 掉）。
—— 只测 `parse` 成功 = 只测了契约那半，恰是本仓 D5「填了字段却没有消费方」的形状。

**🧬 变异反证**
在任意一个 `docs/PRD-skill-*.md` 里塞回被淘汰的那个拼写（如裁决 `steps` 后写一处 `execution.plan`）
→ `check-skill-vocab-single.mjs` **必须红并点名文件行号**。
（第二条变异：把 `businessIntent` 改成 `.optional()` → 判据 3 的"缺字段应失败"必红。）

**预估触及面**：contracts 1 文件 · 本体 1 文件 · test 1 新建 · scripts 1 新建 + 1 登账。**约 5 文件，但全仓 build 面。**

**依赖**：**仓主裁决冲突 A**（`plan` vs `steps`）。
**协调**：须与 compiler 线 dev（`SkillRequiresSchema`，`PRD-skill-compiler-registry.md:560`）
与 orchestrator 线 dev（`compileGraph` 读 `Skill.execution`）**三方确认同一个名字**，否则冻了也白冻。

---

### WO-SKILL-MIG-C · 确定性导出器 + M0 三道门

**一句话**：写纯函数导出器，从现有 intent/plan 机械生成 32 份 DRAFT 影子 Skill；不改一行执行代码。

**🚦 范围边界**
- 新建 `apps/agentcore/src/mocks/skill-export.ts`（**纯函数**，R6：同输入字节一致）
- `apps/agentcore/src/mocks/seed.ts`（**只**调用导出器写入 skills，不改 intent/plan 生成逻辑）
- 新建 `apps/agentcore/test/skill-export.seam.test.ts`
- 新建 `scripts/check-skill-export.mjs` · `scripts/check-skill-business-intent.mjs` · `scripts/skill-business-intent-baseline.json` + `scripts/gate-ledger.json`
- **禁止**碰 `router/` `catalog/` `workflow/`（本期无人消费影子声明）

**出口判据（可机械判定）**
1. **导出完备**：`seedIntentsAndPlans().intents.map(i=>i.key)` 逐条有对应 Skill，且 **用例集从注册表派生不手抄**。断言方式：门脚本读注册表现算，不写死 32。
2. **确定性**：同 `(tenantId, now)` 连跑两次 → `JSON.stringify` **字符串全等**。
3. **线上行为零变化**：`pnpm --filter agentcore test` 全绿且**既有用例一个都没改**（`git diff --stat apps/agentcore/test` 只含新增文件）。
4. **诚实打标**：`slots` 为空的意图导出的 `inputSchema` 必须带 `x-derived:"empty-slots"`；断言"存在 ≥1 条带此标记"且"带标记的条数 == 实测空 slots 条数"（**现算，不写死 17**）。
5. **TODO 棘轮**：`skill-business-intent-baseline.json` 记录当前 TODO 数，`check-skill-business-intent.mjs` 只许降不许升。
6. `node scripts/check-gate-ledger.mjs` RC=0。

**🔗 接缝驱动测试**（种子数据 × 导出器 · 数据/引擎两半）
`skill-export.seam.test.ts`：**同一条测试内** ① 调 `seedIntentsAndPlans()` 拿真实注册表；
② 喂给导出器；③ 断言产出的每份 Skill 的 `references[kind=solver]` 的 key **确实等于**该 intent 对应 plan 里
`invoke_solver` 步的 `solverKey`（回到源物核对，而不是信导出器自报）。
—— 只断言"导出了 32 份"是计数断言，不驱动接缝。

**🧬 变异反证**
往 `seed.ts` 的意图集合里加一条新意图但**不**让导出器产出对应 Skill
→ `check-skill-export.mjs` **必须红并点名那个 key**。
（第二条变异：把某份 plan 的 `solverKey` 改掉但不改导出物 → 接缝测试 ③ 必红。）

**⚠ 反面判据（写进门的注释）**：**禁止**断言「Skill 里的 `execution` 字段 === Plan 的 `steps`」——
影子声明本来就是从 Plan 导出的，这是**同一份数据自己跟自己比，恒真**（`PRD-skill-migration.md:206/252`）。

**预估触及面**：src 2（1 新建）· test 1 新建 · scripts 3 新建 + 1 登账。**约 7 文件。**

**依赖**：**WO-B**（字段不冻，导出器不知道往哪写；尤其 `examples` 见 §4.2）。

---

### WO-SKILL-MIG-D · M1 一致性门（**整条路径的命门**·数据+引擎必须一个 dev 整单做）

**一句话**：建暗发 flag + `resolveSkillForIntent`，让两条解析路各自真跑，规范化后字节相等。

**🚦 范围边界**
- `apps/agentcore/src/catalog/service.ts`（新增 `resolveSkillForIntent`，**保留** `resolvePlanForIntent` 不动）
- `apps/agentcore/src/router/orchestrator.ts`（**仅**加解析分支 + flag 判定，**不删**任何既有路径）
- `apps/agentcore/src/features/registry.ts` + datacore `features.ts`（暗发 flag `qos.skill-execution-authority` **双注册**·`defaultOn:false`）
- 新建 `apps/agentcore/test/skill-plan-parity.seam.test.ts`（含 `canonicalizeAnswer` 规范化器，**≤40 行纯函数**）
- 新建 `scripts/check-skill-plan-parity.mjs` + `scripts/gate-ledger.json`
- **禁止**碰 `workflow/executor.ts`（G1 并行边**必须不与 M1 同期** —— 两个变量同动，字节不等时分不清是谁干的）

**出口判据（四条**同时**成立·缺一即恒真）**
1. **两条路都真跑到底**：`run-OLD`（flag 关）与 `run-NEW`（flag 开）都 `task.status==="COMPLETED"` 且 `task.path==="WORKFLOW"`。
2. **执行源可判别**：`run-NEW` 的 `task.resolvedRefs` 含 `{kind:"skill"}` 且**不含** `{kind:"plan"}`；`run-OLD` 反之。（`RefKindSchema` 已含 `"skill"`，**无需改契约** —— 本单未复核此行，见 §7。）
3. **规范化后字节相等**：`canonicalizeAnswer(OLD) === canonicalizeAnswer(NEW)`（**字符串全等**，不是 deep-equal）。
4. **覆盖全量且从注册表派生**：用例 = `seedIntentsAndPlans().intents`，**现算不写死**。

**规范化器三条自证（与主断言同文件）**
① **自反**：`run-OLD` 连跑两次 → canonical 相等（证真抹平了 `provId` 这类不稳定位）。
② **敏感**：改 `run-NEW` 的 skill 里任一 solverArg（如 `weeks: 6→7`）→ canonical **必须不等**（证没抹过头）。
③ **结构**：canonical 输出中不得出现 `/^prov_[0-9A-Z]{26}$/` 形态（证第①条真执行了，而非正则没匹上）。

**🔗 接缝驱动测试**（解析源 × 执行器 · 数据/引擎两半）
**判据 2 与判据 3 必须在同一条测试文件里** —— 拆开就是"各半绿"（`PRD-skill-migration.md:521`）。

**🧬 变异反证（两条·复验方必当场看）**
① 打掉 `run-NEW` 的执行源分支让它回落读 plan → **判据 2 必红、判据 3 反而绿**。
  这条的价值不在通过，在于**当场演示"只比字节不验执行源"为什么恒真**。
② 改 skill 的一个 solverArg → **判据 3 必红**（同规范化器自证②）。

**预估触及面**：src 4 · test 1 新建 · scripts 1 新建 + 1 登账。**约 7 文件，但触及 QOS 主链。**

**依赖**：**WO-C**（没有影子声明就没有 `run-NEW` 可跑）。
**协调**：出口判据须显式写明「本门 == `PRD-skill-runtime-orchestrator.md:69` §10 A1，规范化器全仓只此一份」（§4.3）。

---

### WO-SKILL-MIG-E · M2 权威翻转 + 六写入方收口（**跨 A/B 与前后端·必须一 dev 整单**）

**一句话**：执行改读 Skill，六个 Plan 写入方全部收口，entitlement 一处判定，补多租户播种。

**🚦 范围边界**
- `apps/agentcore/src/router/orchestrator.ts` · `catalog/service.ts` · `server.ts` · `dril/resource-projector.ts` · `growth/scaffold.ts` · `ops/fallback.ts` · `scripts/smoke-llm.ts` · `mocks/seed.ts`
- `apps/agentcore/src/features/registry.ts`（entitlement 收敛）
- 前端三处：`api/endpoints.ts` · `pages/admin/CatalogPage.tsx` · `mocks/handlers.ts`
- 新建 `scripts/check-skill-single-source.mjs` · `scripts/check-skill-entitlement-single.mjs` + `scripts/gate-ledger.json`
- **禁止**删 `plans` 表 / 删 migration（`PRD-skill-migration.md:372-377`：翻转与删表**分离**，回退开关不许焊死）

**出口判据（可机械判定）**
1. **双源红**：对每个 PUBLISHED intent，`resolveSkillForIntent` 命中且 `resolvePlanForIntent` **未命中**；两份同时解析出 → 红。
2. **静态禁写**：除 `apps/agentcore/migrations/*.sql` 与 `apps/agentcore/src/persistence/**` 外，全仓 `grep -rn "repos.plans.insert(" apps packages` = **0**（金丝雀：改前跑一次必须 ≥1 命中，证 grep 没坏）。
3. **六写入方逐条收口**（`PRD-skill-migration.md:332-338`，**行号须自测重取**）：出厂播种 / 目录 REST / `internal/scaffold` / `growth/scaffold` / `ops/fallback` / 冒烟脚本。
4. **entitlement 一处**：全 32 意图 × {feature 开, 关} 四象限，不存在"意图允许但 Skill 不可解析"或反之；**必须含一条非 demo 租户用例**。
5. **多租户播种**：`seedRegistry` 接 `tenantId` 入参（今天 `seed.ts:909` 无）并接进 `ensureScenarioPackageSeed`；非 demo 租户跑通。
6. **键空间断言**：启动期断言「每租户 package 数 ≤1」**或**「intentKey 在该租户全局唯一」，不满足则**拒绝启用 flag** 并打诚实日志（**不许**静默取第一个包）。
7. **G-4 不重新挖开**：删 `plan-create` 按钮的同一个 diff 里必须给出 Skill 侧等价入口。
8. `node scripts/check-gate-ledger.mjs` RC=0；四包 `pnpm -r build && pnpm -r --workspace-concurrency=1 test` 全绿。

**🔗 接缝驱动测试**（A/B 两系统 × 前后端两半）
一条测试内：非 demo 租户 → 懒播种造出 intent + skill → 经 QOS 主链跑一条确定性题 → 断言 `resolvedRefs` 是 skill、
且答案与翻转前一致。**必须是非 demo 租户** —— demo 单租户测全绿也测不出 R-B（`PRD-skill-migration.md:208`）。

**🧬 变异反证**
① 把六个写入方里**任意一个**改回 `repos.plans.insert(` → 判据 2 必红并点名 file:line。
② 把 `seedRegistry` 的 `tenantId` 入参去掉 → 判据 5 的非 demo 租户用例必红。

**预估触及面**：agentcore src ~8 · frontend src 3 · test 2+ · scripts 2 新建 + 1 登账。**约 16 文件，全套件最大。**

**依赖**：**WO-D**（没有 M1 的字节相等保证，翻转就是裸奔）。
**互斥**：与 orchestrator 线 W2 撞 `router/orchestrator.ts`（§4.4）→ **串行化，或一 dev 整单做两者**。

---

## 6. 风险 / 今天做不了的（每条注明卡在什么前置）

| # | 事项 | 今天能不能做 | 卡在什么 |
|---|---|---|---|
| **1** | **引用闭包接线**（WO-A） | ✅ **今天就能做** | **无前置**。这是本套件唯一不被挡的一张。（⚠ 特别提示：PRD 原稿曾判"这道门今天做不了"，经核对**更正为可做** —— 本单独立复验，结论一致：`probeMissingRefs` 已存在于 `resources.ts:11`、已接 `server.ts:690/1008` 两处、只差 skill 发布这个挂载点。**工作量是"接一条线"，不是"造一道门"**。） |
| **2** | 契约字段冻结（WO-B） | ❌ | **仓主裁决冲突 A**（`execution.plan` vs `execution.steps`，§4.1）。这是**决策阻塞不是工作量阻塞** —— 裁决一到，WO-B 本身很小。 |
| **3** | 5 态状态机 | ❌ 且**不该由本线做** | 规格属 compiler 线（`PRD-skill-compiler-registry.md:75/313`）。本线只需知道"别与 M0 同期"（§4.1 冲突 B）。 |
| **4** | `examples` 字段落地 | ❌ | **无人认领**（§4.2）。compiler 线推给 Track E，迁移 PRD 假定它已存在，实测 0 命中。**必须在 WO-B 里显式认领。** |
| **5** | Business Intent 填 128 个语义判断 | ❌ **且不是 dev 工作量** | 需业务方确认 KPI/决策场景，PRD `:135` 估 **8–16 人时业务方时间**。**处置**：不挡翻转，用"契约必填 + 显式 TODO 哨兵 + 棘轮门"锁死（WO-C 判据 5）。 |
| **6** | G1 executor 并行边 | ⚠ 能做但**必须不与 WO-D 同期** | 会污染 M1 的字节相等对照组（两个变量同动）。且与 Track B1 撞 `executor.ts:104`。 |
| **7** | G2 规则 DSL `params` operand | ✅ 可与 WO-A/B/C/D/E **完全并行** | 不同包（`apps/datacore`）不同文件。但**必须先于 M3 的任何"规则维"扩展**，否则 Skill 里写的 param 会**静默恒假**。 |
| **8** | M3 六项扩展 | ❌ | 全部依赖 WO-E。且 `maxBudgetRounds` 的运行时消费被 compiler PRD `:617/739` 明确推给本线 —— **属实**：本单实测契约有字段（`agentcore.ts:260`），运行时消费方待查（本单未追，见 §7）。 |
| **9** | 真 DataCore 下的字节相等 | ❌ | WO-D 的门跑在 mock DataCore 上。跨服务面须另补 `apps/datacore/test/xservice-smoke.test.ts` 用例（PRD §6.5 边界 1）。 |
| **10** | 删 `plans` 表 | ❌ **且刻意不做** | PRD `:372-377`：翻转与删表**分离**，表级退役排到翻转后连续两个发布周期无回滚。删表是不可回退动作，与翻转绑一起 = 把回退开关焊死。 |

---

## 7. 诚实边界（本文哪些是亲手验的、哪些不是）

**✅ 亲手验的（本单静态读码 + `grep`/`sed`/`node -e` 实跑，每条可复跑）**
- §2.1 契约字段表：逐字段读 `packages/contracts/src/agentcore.ts:236-261` 原文；`status` 3 态 = `:247`；`version` = `:240`。
- §2.2 引用闭包全部 6 行：`resources.ts:11` 定义 + `:22-46` 两层 fail-open 原文 · `server.ts:690/1008` 两个调用点 · `server.ts:1235-1293` 发布段**逐行读完确认无 probe** · `skill-lint.ts:176` 原文。
- §2.3 `resolvePlanForIntent` 8 处命中与**行号漂移**：`grep -rn` 实跑，与 PRD §7.1 逐条对照。
- §2.4 `seedRegistry(now)` 无 tenantId vs `seedIntentsAndPlans(tenantId, now)` 有：两处签名原文；7 个种子 skill `grep -c` = 7。
- §2.5 迁移机制：`ls apps/*/migrations` 实跑（agentcore 到 011、datacore 到 027）；`CONFIG_BUNDLE_SCHEMA_VERSION` 与 major 校验两处原文；`server.ts:1312-1322` new-version 逻辑；`orchestrator.ts:257-265` `selectTenantSkills` 逻辑；`check-gate-ledger.mjs` 四条判据原文 + `gate-ledger.json` 结构。
- §2.6 **gates = 24**：`node -e` 解析 `package.json` 的 `gates` 串计数（不是数 `&&`，是正则抽 `check-*.mjs`）。
- §2.7 两条断点在本体 **0 命中**（金丝雀：同文件 `G-SKILL` 4 命中 / `G-1|G-4` 31 命中）。
- §4.1 冲突 A：三份 PRD 的三处原文行号逐条读出。
- §4.2 `examples` 在契约 **0 命中** + compiler PRD `:339` 原文。
- 新文件 `docs/WO-SUITE-*.md` **不被任何门扫描**：`check-prd-ontology.mjs:39-40` 与 `check-prd-coverage.mjs:47` 都只收 `PRD-*.md`；`check-stale-claims.mjs` 只扫 `apps/frontend-shell/src` 且不在 `pnpm gates`。

**🔍 只 grep 到 / 只读到定义、未追到运行时的**
- `maxBudgetRounds` 的运行时消费方：本单**未追**（PRD `:143` 说全仓仅 3 处、测试自产自销）。WO-E/M3 派单前须自行复验。
- `RefKindSchema` 已含 `"skill"`（PRD `:269` 声称"无需改契约"）：本单**未复核** `packages/contracts/src/refs.ts:9`。WO-D 的 dev 必须先验这一条再写判据 2。
- PRD §7.2 的**六个写入方**：本单只复核了函数签名层（`seed.ts:210/909`），**未逐条追** `growth/scaffold.ts` / `ops/fallback.ts` / `internal/scaffold` 三处。WO-E 须重取。

**📄 从 PRD 抄的（未独立验证）**
- **意图 32 / plan 32 / 场景卡 20 / 场景入口 9** 这组基数：全部来自 `PRD-skill-migration.md:85-89`，本单**未实测**（需跑 `seedIntentsAndPlans()`，而本单纪律禁跑 vitest/build）。
- **17/32 `inputSchema` 空壳**：PRD 自己就标为"静态推算未实测"（`:541`）。**故 WO-C 判据 4 刻意写成"现算不写死 17"。**
- §6 第 5 行的 8–16 人时估算：PRD `:135` 原文。

**❌ 没验证的**
- **本单一个测试、一个 gate、一次 build 都没跑**（工单纪律：纯只读 + 写一份 md）。所有结论均为静态读码。
- 另两个 dev（skill-compiler / skill-orchestrator）**当前分支上的真实进度**未查 —— 本单只读了两份 PRD 文本，
  **未验证其"已完成"章节的当前真伪**。§4.1/§4.4 的冲突判断基于 **PRD 文本**，若那两条线已在各自分支上做了裁决，
  以他们的实际落地为准。
- 部署库（PG）里 `plans`/`skills` 的真实数据分布。

---

## 8. 派单顺序建议（一句话）

1. **立即派 WO-A**（零依赖，且本体已登记为 🔴 未修）。
2. **立即向仓主要冲突 A 的裁决**（`plan` vs `steps`）—— 这是唯一挡住其余四张的东西，且它是**一句话的决策，不是工作量**。
3. 裁决到手 → WO-B（须拉 compiler / orchestrator 两线 dev 三方确认同一个名字）→ WO-C → WO-D → WO-E 串行。
4. **G2 规则 DSL 全程并行**（不同包不同文件），但须先于 M3。
5. **WO-E 与 orchestrator 线 W2 串行化**（撞 `router/orchestrator.ts`）。
