# HANDOFF-WO-SKILL-DEPENDSON-COVER

断点：本体 §8 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 缺口②（dependsOn 数据覆盖不足）。
分支：`claude/handoff-wo-skill-dependson-cover`（基线 = 集成线 `claude/verify-reclaim-6` @ `776b7d33e`）。

## 1. 实测数

| 量 | 前 | 后 | 实测方式 |
|---|---|---|---|
| 出厂种子 `dependsOn` 边数 | 1 | **6** | `grep -c 'kind: "skill", key:' apps/agentcore/src/mocks/seed.ts` = 6 |
| 持有 dependsOn 的技能数 | 1 / 7 | **4 / 7（多数）** | `seedRegistry().skills.filter(s => (s.dependsOn ?? []).length > 0).length`，金丝雀断言钉住 |
| 环检测分支触发 | 从未（要 ≥2 条边才成环） | 测试里构造真环 → **发布 422 + 环路径文本** | `skill-dependson-cover.seam.test.ts` ①，HTTP 打进 |
| 检测逻辑实现 | 未改 | **未改**（本单只补数据；`skill-lint.ts` / `resource-projector.ts` 等零 diff） | `git diff 776b7d33e -- apps/agentcore/src/skill-lint.ts apps/agentcore/src/dril/` 为空 |

新补 5 条边（另 1 条为 WO-SKILL-PARTIAL-A 既有）：

| 从 | 到 | 业务依据（出自技能自身 body/summary，非凑数） |
|---|---|---|
| sop_meeting | capacity_analysis | body 步骤 2 供给侧「可供给量」口径出自产能分析 |
| sop_meeting | supply_chain_mgmt | 同步骤「物料缺口」出自齐套分析 |
| risk_analysis | capacity_analysis | body 步骤 1 三维度之首「产能利用率」口径出自产能分析 |
| quality_control | supply_chain_mgmt | body 步骤 2 五维归因（人/机/料/法/环）之「料」以齐套结论为输入 |
| capacity_action_draft | risk_analysis | 适用边界明写「已有推演结论（capacity_forecast / risk_timeline 输出）」，risk_analysis 是 risk_timeline 的解读层 |

约束全部满足：6 条边全部指向 **PUBLISHED** 目标（发布门 `requirePublishedDeps=true` 过得去）；依赖图保持 **DAG**
（capacity_action_draft→{capacity_analysis, risk_analysis}，risk_analysis→capacity_analysis，无回边）——
有专门断言钉住（「出厂依赖图是 DAG」用例），防止有人把环误种进生产 seed 炸掉启动期种子审计与正常发布流。

## 2. 改法论据

- 本单是**补数据**不是改逻辑：缺口②的定性（2026-08-17 复核）是「线接好了、数据不够」，
  `detectSkillDependencyCycle` / `validateRefResolution` 的实现读过后确认无需动（见「没做的部分」）。
- 环**只在测试里构造**（`cyc_dep_a ⇄ cyc_dep_b` fixture，仓储直插）：种进生产 seed 会让
  `auditSeededSkills` 启动期审计报 VIOLATIONS、且任何持有 dependsOn 的技能发布都会被 422——那是拿正常启动/发布流祭旗。
- 断言全部从 **HTTP 打进**（`POST /b/v1/skills/:id/publish` 与 `POST /b/v1/skills/lint` 干跑），
  咬的是链路不是函数；干跑与发布门本就共用同一份 `lintSkill` 实现（WO-SKILL-PARTIAL-A 已修「两套输入」）。
- 发布门的 422 报文只含 rule 名（`metadata.dependencyCycle`），环路径文本在 lint 违规的 message 里——
  故「被拒」咬发布路、「环路径文本」咬干跑lint（同一份判据的两个出口），两条都断言。
- 金丝雀硬计数保持**单点**（`skill-compiler.seam.test.ts`，0→1→4 三次变更都走「先查提交再改数」纪律）；
  其余断言一律从种子现算，不手抄键名（本体旧文曾把边记在 sop_meeting 头上、实测持有者是 capacity_action_draft 的教训）。

## 3. 判据对照表

| # | 判据 | 结果 | 证据 |
|---|---|---|---|
| 1 | 数据覆盖：1 条 → 多数技能有边（≥4-5 条合理边） | ✅ 6 条边 / 4 持有者 | §1 表；逐边业务依据写在 seed.ts 各边注释 |
| 2 | 头号：真环被拒 + 环路径文本 | ✅ | 发布 422 `SKILL_LINT_FAILED` 含 `metadata.dependencyCycle` 且 status 停 DRAFT（未落库）；干跑 lint message 命中 `Skill 依赖图存在环：cyc_dep_[ab] -> ... -> cyc_dep_[ab]` |
| 3 | 金丝雀同批改 | ✅ | `skill-compiler.seam.test.ts` `toBe(1)` → `toBe(4)`，与 seed 同 commit |
| 4 | 金值/注册即更 | ✅ 无连带 | 技能数不变（7）；无快照/目录计数锚住 dependsOn；全仓唯一硬计数就是那条金丝雀（grep 实证） |
| 5 | 变异反证两条亲手做 | ✅ | 见 §4 实测原文：①摘环检测接线 ⇒ 头号断言红（报文只剩 `dependsOn[0].notPublished`）；②边改指 `__no_such_skill_mutation_probe__` ⇒ `dependsOn[0].unresolved` 红。做完 `git status --porcelain` 干净 |
| 6 | 邻域不塌 | ✅ | skill 相关 9 个既有测试文件 + 新文件全绿（48 + 50 + 4 = 102 通过，RC=0），`--maxWorkers=1`、跑前探 vitest 进程数 = 2 ≤ 3 |
| 7 | 本体回写 | ✅ | §8 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ② 句尾追加「⊕ 2026-08-18 已闭」段（不动编号不动他行） |

## 4. 测试实测原文

新文件（4 绿）：
```
 ✓ test/skill-dependson-cover.seam.test.ts (4 tests) 1541ms
   ✓ ① 头号判据 … 真环 → 发布 422 SKILL_LINT_FAILED（未落库）+ 干跑报出环路径文本  1121ms
 Test Files  1 passed (1)      Tests  4 passed (4)
```

邻域批 1（compiler / partial-a / seed-publish-gate / ref-closure）：
```
 Test Files  4 passed (4)      Tests  48 passed (48)
```
邻域批 2（seed-gate-freshness / solver-precondition / dril-registry / skill-lint / skill-contract）：
```
 Test Files  5 passed (5)      Tests  50 passed (50)
```

变异反证①（`skill-lint.ts` 环检测接线临时摘掉 → 已 `git checkout` 还原）：
```
 × ① 头号判据 … 真环 → 发布 422 …
 AssertionError: expected '技能结构 lint 未通过（1 项）：dependsOn[0].notPu…' to contain 'metadata.dependencyCycle'
 Tests  1 failed | 3 passed (4)
```

变异反证②（seed 边改指 `__no_such_skill_mutation_probe__` → 已还原）：
```
 × ② … 每个持有 dependsOn 的出厂技能：干跑 lint … 零 dependsOn/环违规
 → 出厂技能 risk_analysis 的 dependsOn 必须全部可解析且无环：
   [{"rule":"dependsOn[0].unresolved","message":"dependsOn[0] 引用的 skill「__no_such_skill_mutation_probe__」不存在",…}]
 Tests  1 failed | 3 passed (4)
```

还原后复跑：`Tests 4 passed (4)`；`git status --porcelain` 空。`pnpm --filter agentcore typecheck` 绿。

## 5. 基线变化

- 基线 `776b7d33e`（集成线 tip）→ 本单 2 个 commit：
  ① seed 数据 + 金丝雀 + 新 seam 测试；② 本体 §8 ② 回写 + 本交单文档。
- 行为变化面：仅 mock/seed 数据与测试。生产运行时路径（启动审计、发布门、DRIL 投影）判据逻辑零 diff；
  启动期种子审计对 PUBLISHED 种子的结论保持 **CLEAN**（`skill-seed-publish-gate.seam.test.ts` ② 用例原样绿）。
- 前端 mock fixtures 是独立副本（`apps/frontend-shell/src/mocks/fixtures.ts`），不读本 seed，不在本单范围。

## 6. 没做的部分

- **检测逻辑一行未动**（范围边界）。实测中环检测正确拒绝了真环、链式无环对照不误拒——没有「种真环不被拒」的病灶，无需停手报告。
- `mcp_integration`（平台文档向技能）与 `capacity_analysis`（根方法论）保持无 dependsOn——为凑 5/7 硬连会违反「不许为了凑数乱连」；4/7 已是多数。
- 本体 §8 该行①（死抽取器接线）与③（引用探针）早已闭合，本单不动；「残留」段（constraint/slice/workflow/agent 四种 kind 无人校验）依旧未闭，归后续单。
- 未跑四包全量 gate（派单纪律禁全量 `pnpm -r test`；agentcore skill 邻域 102 条已全绿）。
