# WO-FE-SKILL-STUDIO 交付说明

分支 `claude/handoff-wo-fe-skill-studio`（基线 canonical `c50fc3ec`，祖先关系判据：
`git merge-base --is-ancestor HEAD $CANON` 判定原 worktree 落后 ⇒ 已从 canonical 重开）。

**问题陈述（仓主原话）**：「skill 前端没有任何变化」。实测属实——改前 `SkillsPage.tsx` 只渲染
`id / name / status / version / summary / body / resources` 这几个字段，**全是 Skill 大改造之前就有的**；
改造新增的每一样东西前端消费方都是 0。`docs/PRD-skill-compiler-registry.md:50` 早就预言了这个结果：
「否则又是『有端点无入口』」。

---

## ① 后端能力盘点（自己盘的，不是照工单抄）

### 金丝雀先行（否定结论的前置条件）

本节所有「**没有**」的结论，都先跑了一个「已知必中」的样例证明工具没坏：

| 用途 | 金丝雀命令 | 结果 |
|---|---|---|
| 契约面 grep 有效 | `grep -rn 'SkillDefinitionSchema' packages/contracts/src/` | **5 命中**（agentcore.ts:236 定义 + 4 处引用）✅ |
| 路由面 grep 有效 | `grep -c 'skills/:id/publish' apps/agentcore/src/server.ts` | **1 命中** ✅ |
| 种子面 grep 有效 | `grep -c 'references:' apps/agentcore/src/mocks/seed.ts` | **7 命中** ✅ |
| 字段面 grep 有效 | `grep -c 'references' packages/contracts/src/agentcore.ts` | **2 命中** ✅ |

金丝雀全中 ⇒ 下面的「0 命中」才敢读作「它不存在」，而不是「我没找到」。

### A. canonical 上**真有**

**契约字段**（`packages/contracts/src/agentcore.ts:236` `SkillDefinitionSchema`）：

| 字段 | 形状 | 本期是否做了可见面 |
|---|---|---|
| `id / tenantId / key / version / name / summary / body / resources / status` | 必填（status: DRAFT/PUBLISHED/RETIRED） | 改前就有 |
| `capability` | enum: analysis / forecast / diagnosis / prescription / optimization / planning / approval | ✅ 新增 |
| `sideEffect` | enum: READ / COMPUTE / WRITE | ✅ 新增 |
| `approvalGate` | enum: none / human / workflow | ✅ 新增 |
| `provenancePolicy` | enum: required / best_effort / none | ✅ 新增 |
| `maxBudgetRounds` | 正整数 | ✅ 新增 |
| `inputSchema` / `outputSchema` | `JsonSchemaObject`＝`z.record(z.string(), z.unknown())` | ✅ 新增（结构化表） |
| `references[]` | `SkillReferenceSchema`：`kind`(8 值) + `key` + `version?` + `required`(默认 true) + `role`(4 值，默认 context) | ✅ 新增 |
| `dependsOn[]` | 同上形状 | ✅ 新增 |

**契约导出的判定函数**（不是字段，是**单一出处的判定**，前端直接复用而非自己重写一遍）：

- `isWriteEffectSkill(skill)` — 会不会改真值（含跨域词表归一）
- `isWriteModeSkill(skill)` — **写模式** ＝ 会改真值 **或** 需要审批。
  契约里那段注释交代了它的来历：探针只判了 `sideEffect` 一半、运行时判的是两半，
  于是 `COMPUTE + approvalGate:human` 的技能「运行时要求出 action_draft、探针却不给它这个工具」——
  探针在比生产更小的工具集上发合格证。**本期前端一律调这个函数，不在前端另写一遍布尔表达式。**
- `SKILL_REFERENCE_KINDS` / `SKILL_REFERENCE_ROLES` — 词表具名导出（避免消费方手抄第二份）

**端点**（`apps/agentcore/src/server.ts` 1190–1450）：

| 方法 | 路径 | 本期是否用到 |
|---|---|---|
| GET | `/b/v1/skills` | ✅ 已在用（返回**完整** SkillDefinition，新字段全在里面，无需额外请求） |
| GET | `/b/v1/skills/:id` | 未用（详情附带同 key `versions[]`） |
| POST | `/b/v1/skills` | ✅ 已在用（＋新建技能） |
| PUT | `/b/v1/skills/:id` | ✅ 已在用（仅 DRAFT 可改，否则 409 `IMMUTABLE_VERSION`） |
| POST | `/b/v1/skills/:id/publish` | ✅ 已在用，**本期新增对拒绝原因的消费** |
| POST | `/b/v1/skills/lint` | 未用（编辑器结构 lint 干跑） |
| POST | `/b/v1/skills/:id/new-version` | 未用 |
| GET | `/b/v1/skills/:id/references` | 未用（**反向**引用：谁在用这个技能） |
| POST | `/b/v1/skills/:id/retire` · DELETE `/b/v1/skills/:id` | 未用 |
| GET | `/b/v1/skills/:id/resources/:name` | 未用 |
| POST | `/b/v1/skill-graphs/run` | 未用（图编排执行） |

**发布门的四道闸**（决定了「发布失败」到底可能是什么，本期把原文透出给用户）：

1. `422 SKILL_LINT_FAILED` — 结构 lint（含 dependsOn 可解析 / 依赖图无环）
2. `422 SKILL_REF_UNRESOLVED` — **跨系统引用存在性探针**（2026-08-09 才接到 skill 发布路上）。
   message 逐条列出死路，形如 `求解器「k」在 DataCore 未注册`；`force=true` **不豁免**（事实错误不是质量问题）；
   拒绝发生在 `repos.skills.update` 之前 ⇒ **未落库**。
   诚实边界（后端注释自己写明的）：探针只覆盖 `solver` / `rule` / `ontologyType` 三种 kind，
   `constraint` / `slice` / `workflow` / `agent` 今天**两侧都无人校验**。
3. `422 SKILL_EVAL_INSUFFICIENT` / `SKILL_EVAL_COVERAGE` — 评测用例数量与三类覆盖
4. `422 SKILL_EVAL_FAILED` — 评测未全过

### B. canonical 上**没有**（本期不做，已跳过）

| 能力 | 判据 | 处置 |
|---|---|---|
| `POST /b/v1/skills/:id/compile` | `grep 'skills/:id/compile\|/compile"' apps/agentcore/src/server.ts` → **0 命中**（同文件 `skills/:id/publish` 金丝雀 1 命中） | **后端不在，本期不做**。未去别的分支 cherry-pick（那是审核方的活）。 |
| `SkillDefinition.execution`（steps / graph 编排挂在 Skill 上） | `grep 'execution' packages/contracts/src/agentcore.ts` → **0 命中**（同文件 `references` 金丝雀 2 命中）。`skill-graph.ts:348` 的注释写「本形状要挂在 `SkillDefinitionSchema.execution` 上」——**是计划，还没挂**。 | **契约上没有这个字段，本期不做**。`/b/v1/skill-graphs/run` 只接受请求体里现给的 execution/graph，不是从 Skill 上读的。 |

### C. 一处必须纠正工单的事实

工单写「种子里 7 个技能中 6 个 references 非空、**1 条 dependsOn**」。**前半对，后半不对**：

```
grep -n 'dependsOn'    apps/agentcore/src/mocks/seed.ts   → 0 命中
grep -c 'references:'  apps/agentcore/src/mocks/seed.ts   → 7 命中（金丝雀：同文件同工具，证明 grep 没坏）
```

canonical 的种子里 `dependsOn` **一条都没有**。这正是 `CLAUDE.md` 铁律 0.5 已经记过一次的账
（`dependsOn` 属「**接了线没数据**」——消费方 `skill-lint.ts` 确实在读它，只是输入恒空所以分支从没进过；
而 `references` 属「接了线有数据、会触发」。两者定性不同、修法不同，必须拆开说）。

**对本期的影响**：`dependsOn` 的渲染路径对着真后端今天是**空的 ⇒ 按设计不渲染**。
为了让这条路径有活体可验，mock 里种了 1 条**契约合法**的 `kind:"skill"` 依赖，
并在 `fixtures.ts` 的注释里把这个差异写死（勿删）。

---

## ② 做了什么

### 新增 `apps/frontend-shell/src/pages/admin/SkillStructure.tsx`

| 组件 | 职责 | 空数据行为 |
|---|---|---|
| `SkillGovernanceStrip` | 治理属性带：status / version / key / capability / sideEffect / approvalGate / provenancePolicy / maxBudgetRounds ＋**写模式**标 | 逐字段判在不在，缺的**不渲染那一枚徽标** |
| `SkillReferenceTable` | 引用/依赖表：类型 · 资产 key · 角色 · 必需（＋死路标记） | 空/未给 ⇒ **返回 null，整块不渲染** |
| `SkillSchemaView` | 契约表：字段 · 类型 · 必填 · 说明（含 enum 取值） | 未给 ⇒ 不渲染；给了但 `properties` 不可解析 ⇒ **原样摊 JSON** |
| `SkillPublishGateFeedback` ＋ `parseDeadRefKeys` | 发布被拒的**常驻**面板：错误码 ＋ 后端原文；从 message 的 `「」` 里抽死路 key | 无拒绝 ⇒ 不渲染 |

### 改 `apps/frontend-shell/src/pages/admin/SkillsPage.tsx`

- 编辑器里挂上上述四块
- 左栏列表加「写」标（写模式技能一眼可辨）
- 发布失败改为 `useState` 常驻，**不再只弹一个三秒就没的 toast**——
  「哪条引用死了」是要照着去修的信息

### 改 mock，与真后端对齐（本仓吃过「mock 与真后端口径分家」的亏）

- `fixtures.ts` `SKILLS`：2 条 → **4 条**，逐条对齐 `apps/agentcore/src/mocks/seed.ts`，
  含两个**对照样本**：`skl-action`（唯一 WRITE ＋ approvalGate=human ＋ provenancePolicy=required）
  与 `skl-mcp-guide`（`references: []`，用来钉死「空则不渲染、不崩、不出假值」）
- `handlers.ts` 发布路：**补上引用存在性门**，三件事与真后端一字对齐——
  ① 422 `SKILL_REF_UNRESOLVED` ② 同款 message 文案 ③ **未落库**（被拒时不改 status）。
  改前 mock 无脑 `status = "PUBLISHED"`，那段 UI 在 mock 模式下**永远走不到**。
  覆盖范围也照抄真后端（只探 solver/rule/ontologyType、只探 `required !== false`）——
  **mock 比真后端严会造出「本地红、线上绿」的反向假信号**。
- `MOCK_SOLVER_REGISTRY` 提升为模块级常量，`/a/v1/solvers/registry` 与发布探针**共用同一份**。
  不抄第二份词表——那正是 `sideEffect` 三套词表导致判定永不触发（假绿第 6 例）的成因。

### 三条硬约束的落实

- **只读后端真值**：字段缺失 ⇒ 整块/整枚徽标不渲染。全文件**零**「未知 / 暂无数据 / N/A」占位。
  最容易犯规的一处已单独设防：`sideEffect` 缺省在**运行时**兜底为 READ，但那是后端行为，
  **不等于这个技能声明了 READ**；界面若替它显示「只读」，就是替后端签了一个它没签的字。
  这条有专门的变异反证守着（下方 M5）。
- **不开 feature flag 默认值**：本期一个 flag 都没碰。
- **contracts-only-shared**：`SkillDefinition` / `SkillReference` 类型与 `isWriteModeSkill` 判定
  全部从 `@platform/contracts` import，前端零重定义。

---

## ③ 变异反证（红绿两次输出）

判据：把某个新增展示块回退掉，对应断言**必须变红**；还绿 = 断言没咬住效果，需重写。
脚本显式捕获退出码（**不用** `cmd | tail; echo $?` —— `$?` 取的是 `tail` 的，恒 0）。

| # | 变异 | RC | 结果 |
|---|---|---|---|
| — | **BASELINE**（未变异） | **0** | `Test Files 1 passed` / `Tests 11 passed (11)` ✅ 绿 |
| M1 | 摘掉「引用与依赖」两块 | **1** | **3 failed** / 8 passed 🔴 |
| M2 | 摘掉「治理属性带」 | **1** | **4 failed** / 7 passed 🔴 |
| M3 | 摘掉「输入/输出契约」两块 | **1** | **4 failed** / 7 passed 🔴 |
| M4 | 摘掉「发布门反馈面板」（退回只弹 toast 的老行为） | **1** | **1 failed** / 10 passed 🔴 |
| M5 | **诚实位**：给 `sideEffect` 补一个前端自造的缺省 `READ` | **1** | **1 failed** / 10 passed 🔴 |
| M6 | 死路标记退化成「有死路就全标红」 | **1** | **1 failed** / 10 passed 🔴 |

变红的具体用例：

```
M1 × references 非空 → 逐条列出它引用的资产 key（含类型/角色/必需）
   × dependsOn 非空 → 单独成块列出所依赖的技能
   × 发布被拒 → 显示具体是哪条引用死了，并标到那一行；技能未落库

M2 × 写回型技能：capability / sideEffect / approvalGate / provenancePolicy / 预算 全部可见
   × 只读技能：不打写模式标（缺省不冒充声明值）
   × 字段缺失 → 该徽标整个不渲染，不填假值
   × 发布被拒 → 显示具体是哪条引用死了，并标到那一行；技能未落库

M3 × references 为空 → 不显示该块、不崩、不出现假值
   × inputSchema / outputSchema → 字段名/类型/必填/说明 逐行成表
   × enum 取值可见；schema 未给 → 整块不渲染
   × schema 结构不可解析（无 properties）→ 原样摊 JSON，不假装成一张空结构表

M4 × 发布被拒 → 显示具体是哪条引用死了，并标到那一行；技能未落库
M5 × 字段缺失 → 该徽标整个不渲染，不填假值
M6 × 发布被拒 → 显示具体是哪条引用死了，并标到那一行；技能未落库
```

M5 / M6 是本组里最要紧的两条：它们证明断言咬的不是「有没有渲染」而是「**渲染得对不对**」——
M5 里那块 UI 照样渲染、照样好看，只是多了一个后端没说过的值，断言当场抓住；
M6 里死路标记照样出现，只是标到了健康的那一行上，断言同样抓住。

M1/M2/M3 会连带打红几条邻近用例（如 M2 打红发布门用例，因为它同时断言了「未落库 ⇒ status 仍 DRAFT」
是从治理带上读的），这是断言交叉覆盖，不是误报。

变异脚本每轮结束都 `git checkout --` 还原；收尾 `git status --porcelain` 为空，工作树干净。

---

## ④ 亲手跑的观察（绿测试 ≠ 能用）

### 4.1 真起了 dev server

```
cd apps/frontend-shell && VITE_MOCK=1 ./node_modules/.bin/vite --port 5199 --strictPort
  VITE v5.4.21  ready in 253 ms   ➜  Local: http://localhost:5199/

curl /admin/skills                        → HTTP=200
curl /src/pages/admin/SkillStructure.tsx  → HTTP=200，返回真实转译产物
                                            （`grep -c 'Internal server error|Transform failed'` = 0）
```

生产构建：`pnpm --filter frontend-shell build` → **BUILD_RC=0**（显式捕获，非管道尾）。

### 4.2 真把界面渲出来读了一遍

（临时观察脚本，读完即删；下表是它打出来的**实际可见文本**，不是我描述的应然）

```
【产能分析方法论】
  治理属性  : PUBLISHED v3 capacity_analysis 能力 分析 副作用 只读 免审批 尽力溯源
  引用资产  : 求解器 | capacity_forecast | 上下文   | 必需
              规则   | C03               | 后置校验 | 必需
  依赖技能  : «整块未渲染»
  输入契约  : modelId | string | 必填 | 型号键
              weeks   | number |      | 推演周数
  输出契约  : conclusion|string  p50|number  p90|number  gapPct|number

【产能处置行动拟稿】
  治理属性  : DRAFT v1 capacity_action_draft 能力 处置建议 副作用 写真值
              人工审批 必须溯源 预算 6 轮 写模式（须出 action_draft）
  引用资产  : 求解器 | capacity_forecast | 前置条件 | 必需
  依赖技能  : 技能   | capacity_analysis | 前置条件 | 必需

【MCP 集成指南】（references: []）
  引用资产  : «整块未渲染»      ← 空则不渲染，且全页无「暂无数据」字样
  依赖技能  : «整块未渲染»
  输入契约  : serverName|string   transport|string|streamable_http·stdio（enum 取值可见）
  输出契约  : «整块未渲染»        ← 该技能没有 outputSchema
```

发布被拒的实际界面：

```
面板   : 发布被拒 · SKILL_REF_UNRESOLVED · req_wvpulcpp · [知道了]
         技能引用存在死路（1 项，发布被拒且未落库）：求解器「ghost_solver_不存在」在 DataCore 未注册
引用表 : 求解器 | capacity_forecast      | 前置条件 | 必需
         求解器 | ghost_solver_不存在 [死路·发布被拒] | 上下文 | 必需
发布后 db 状态 : DRAFT          ← 未落库，与真后端同口径
```

### 4.3 手跑里真抓到的一个东西（记账）

第一版观察脚本打出来的引用表**少一行**——`ghost_solver_不存在` 没出现。
差点据此报「死路行没渲染」。追下去发现是**观察脚本自己的错**：我在 `renderApp` **之后**才改 `db`，
而页面在加载那一刻就已经把列表拉走了，看到的是陈旧数据。

照 `CLAUDE.md` 铁律 0.6 的句式写一遍：**「我用『改完 db 之后的界面』当作『界面渲染了新数据』的证据，
而前者并不度量后者」**——中间隔着一次早已完成的 fetch。
真正的测试用例（`skill-studio.test.tsx`）本来就是先改 db 再 render，所以它一直是对的；
错的是我为了"亲手看一眼"临时写的那个脚本。已修正后重跑，上面 4.2 的输出是修正后的真值。

**这正是「亲手跑一遍」的价值**：如果只看绿测试，我不会发现自己对这个页面的数据时序有误解。

### 4.4 回归

| 检查 | 命令 | 结果 |
|---|---|---|
| 本单测试 ＋ 三个受影响的既有测试 | `npx vitest run test/skill-studio.test.tsx test/g4.self-service-create.test.tsx test/admin-closure-refs.test.tsx test/admin-closure-solvers.test.tsx` | **TEST_RC=0**，`4 passed` / `17 passed (17)` |
| 受影响面的判定方式 | `grep -rln 'skills\|SKILLS\|solvers/registry\|skl-' apps/frontend-shell/test/` | 命中 4 个文件，即上表全部 |
| typecheck | `pnpm --filter frontend-shell typecheck` | 2 个错误，**与本单无关**：`git stash` 后在**基线上跑出完全相同的两条**（`chain-impediments-route.test.tsx:48` / `sim-event-invalidation.seam.test.ts:32`）⇒ 本单**净增 0** |
| lint | `pnpm --filter frontend-shell lint` | 13 个 error 全部落在既有文件；本单四个文件（`SkillsPage.tsx` / `SkillStructure.tsx` / `fixtures.ts` / `handlers.ts` / `skill-studio.test.tsx`）**一条都没有**（金丝雀：对已知有问题的 `f41.external-signals` grep 得 1 命中，证明 grep 有效） |

未跑 `scripts/gate.sh`、未跑 `pnpm -r test`（工单纪律）。

---

## ⑤ 「后端不在，所以没做」清单

| 项 | 为什么没做 |
|---|---|
| **Skill 编译**（`POST /b/v1/skills/:id/compile`） | canonical 的 `server.ts` 上 **0 命中**（金丝雀 `skills/:id/publish` 1 命中，证明 grep 有效）。端点不存在，前端加按钮只会 404。 |
| **`Skill.execution` 编排可视化**（steps/graph） | `SkillDefinitionSchema` 上**没有** `execution` 字段（金丝雀同上）。`skill-graph.ts:348` 说「本形状**要挂在**」——是计划不是现状。今天一个 Skill 身上读不出任何编排结构，可视化无源可依。 |

## ⑥ 后端有、但本期**主动没做**（不是缺口，是排期）

诚实区分：下面这些**后端是有的**，只是不在本单的四条优先级里，避免把工单撑肿。

| 项 | 端点 | 价值 |
|---|---|---|
| 反向引用「谁在用这个技能」 | `GET /b/v1/skills/:id/references` | 退役/删除前的影响面；与本期的**正向**引用正好凑成完整视图 |
| 版本列表 | `GET /b/v1/skills/:id`（返回同 key `versions[]`） | 版本切换 |
| 编辑器 lint 干跑 | `POST /b/v1/skills/lint` | 存盘前就看到结构问题，不必等发布被拒 |
| 派生新版本 / 退役 / 删除 | `new-version` / `retire` / `DELETE` | 完整生命周期（今天只有 DRAFT→PUBLISHED） |
| 发布成功的返回值 `impact` + `lint` | publish 响应体已带，前端**丢弃了** | 「这次发布影响了 N 个 agent」 |
| 其余三道发布门的**结构化**呈现 | `SKILL_LINT_FAILED` / `SKILL_EVAL_*` | 本期只把 message 原文透出（已比「发布失败」强），未按 violation 逐条渲染 |

## ⑦ 本体引用与影响

- **对象类型**：Skill（B4）· SkillReference · Solver / Rule / ObjectType（被引用侧，A 栈）
- **链路**：B4 Skill 发布链 `前端发布 → POST /b/v1/skills/:id/publish → lintSkill → probeMissingRefs(B→A) → 评测门 → repos.update → outbox skill.published`。
  本期接的是这条链**最前端的一段**：把链路中段的拒绝原因回传到界面。
- **不变量**：R4（真值只经 Action 审批链变更）——写模式标与 approvalGate 的可见化正是为它服务；
  R-一致（一个事实一个出处）——写模式判定复用契约函数、mock 求解器词表单一来源。
- **断点**：本单消的是「有端点无入口」（`docs/PRD-skill-compiler-registry.md:50`）。
- **未新增**任何链路 / 事件 / 对象类型 / 不变量 / 门禁 ⇒ 按铁律 0 **无需回写** `docs/SYSTEM-ONTOLOGY.md`
  （本单是纯前端消费面，后端接线一行未动；范围边界也明令不许碰该文件）。

## ⑧ 范围边界自查

改动文件（全部落在工单允许的范围内）：

```
apps/frontend-shell/src/pages/admin/SkillsPage.tsx        改
apps/frontend-shell/src/pages/admin/SkillStructure.tsx    新增（"及其配套组件"）
apps/frontend-shell/src/mocks/fixtures.ts                 改
apps/frontend-shell/src/mocks/handlers.ts                 改
apps/frontend-shell/test/skill-studio.test.tsx            新增
docs/WO-FE-SKILL-STUDIO-delivery.md                       新增（本文件）
```

`apps/frontend-shell/src/api/endpoints.ts` **一行未改** —— 本期所需数据 `GET /b/v1/skills` 已全量返回，
发布错误由 `apiClient` 抛的 `ApiClientError`（含 code/message/requestId）承载，无需改既有签名。

未碰：`apps/agentcore/**` · `apps/datacore/**` · `packages/contracts/**` ·
`apps/frontend-shell/src/sse/**` · `docs/SYSTEM-ONTOLOGY.md`。
