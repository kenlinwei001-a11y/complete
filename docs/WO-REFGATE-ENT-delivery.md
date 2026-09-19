# WO-REFGATE-ENT 交付说明 — Skill 发布门的三个缺口

**分支**：`claude/handoff-wo-refgate-ent`
**基线**：`69804185`（`origin/claude/inspiring-gates-aqczjg` 在开工时的 HEAD；见文末「并线提示」）
**日期**：2026-08-09

| # | 缺口 | 结论 |
|---|---|---|
| ① | **N-01** 引用可校验门对 rule 只查「存在」不查「状态」 | ✅ 已修 + 效果层实测 + 变异反证 |
| ② | **X-09 / N-02** `POST /b/v1/skills/:id/compile` 无 entitlement 门 | ⛔ **端点不在 canonical，本条不可做**（照实报告并跳过） |
| ③ | **F14** 出厂 Skill 走旁门，一次也没过发布门 | ✅ 已修 + 真启动实测 + 变异反证 |

---

## ① N-01 · 可引用性收敛为单一判据

### 复核（不转述工单，亲手核过）

`apps/agentcore/src/tools/datacore-http.ts` 同一个类里有**两条 URL**：

| 方法 | URL | 过滤语义 |
|---|---|---|
| `listRuleKeys` | `GET /a/v1/rules` | **无** |
| `listRules` | `GET /a/v1/rules?status=PUBLISHED` | 只要已发布 |

发布期引用探针 `apps/agentcore/src/resources.ts:80` `probeMissingRefs` 用的恰是**前者**。
`apps/datacore/src/app.ts:3281` 的真实现 `rules.list(ctx(req), status)` 确实按 status 过滤，
所以裸 URL 拿回的是**含 DRAFT 的全集** ⇒ 一个 Skill 引用未发布的 DRAFT 规则可以正常发布。

**根因不是"少写了个 filter"，是「两个方法过滤语义不同、名字看不出差别」**——
门确实在跑，只是它问错了问题：问的是「这个 key 在库里有没有」，该问「这个 key **可不可以被引用**」。

### 修法

不在调用点补 filter（那只是把判据又抄一份），而是把判据收敛进**命名 + 单点**：

- `RuleEngineClient.listRuleKeys → listPublishedRuleKeys`；`listRules → listPublishedRules`
  （`apps/agentcore/src/tools/clients.ts:126`）
- 新增常量 `PUBLISHED_RULES_PATH = "/a/v1/rules?status=PUBLISHED"`；
  `listPublishedRuleKeys` **从 `listPublishedRules` 派生**，不再自带 URL
  ⇒ 过滤语义只剩一处，抄不出第二份也就漂移不了
- 错误报文同步改诚实：`规则「X」不在 DataCore 已发布规则库中（未注册，或仍是 DRAFT 未发布）`
  ——只说"不存在"会把「引用了一条 DRAFT 规则」误导成「key 打错了」
- mock 客户端加 `draftRuleKeys` 旋钮，让 mock 与 HTTP 两个实现**语义一致**（不许一宽一严）

### 判据实测（效果层，原文）

测试文件 `apps/agentcore/test/skill-ref-published-only.seam.test.ts`。
**必须走真 HTTP**（`createHttpDataCore` + node http stub）：缺陷长在**那条 URL 的查询串**上，
mock 客户端根本没有 URL，用 mock 测这条等于测我自己写的假货。

```
 ✓ test/skill-ref-published-only.seam.test.ts (6 tests) 323ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

六条分别是：金丝雀（自证 stub 真按 `status` 过滤）· ① DRAFT 引用 → 422 且未落库 ·
② 同一条规则翻 PUBLISHED → **同一个请求** 200 · ② 本来已发布不受影响（零回归）·
变异反证 · mock 链路同语义。

① 还额外咬**接线层**（不只看效果）：

```ts
const ruleCalls = stub.requestedUrls.filter((u) => u.startsWith("/a/v1/rules"));
expect(ruleCalls.every((u) => u.includes("status=PUBLISHED"))).toBe(true);
```

### 变异反证（源码层，实跑并已还原）

把 `listPublishedRuleKeys` 改回裸 `GET /a/v1/rules`：

```
 FAIL  test/skill-ref-published-only.seam.test.ts > ① 引用 DRAFT 规则 → 422 SKILL_REF_UNRESOLVED 且未落库（修前：200 PUBLISHED）
AssertionError: expected 200 to be 422 // Object.is equality
- Expected   - 422
+ Received   + 200

 FAIL  test/skill-ref-published-only.seam.test.ts > ② 同一条规则改 PUBLISHED → 同样的发布请求 200 PUBLISHED
AssertionError: expected 200 to be 422 // Object.is equality

 Test Files  1 failed (1)
      Tests  2 failed | 4 passed (6)
```

**`200` 就是缺陷原貌**：DRAFT 规则引用照样发布成功。还原后 6/6 全绿。
测试文件里另写死了一条常驻变异反证用例（stub 退化成"不认 status"→ 断言 200），
保证这条判据将来不会悄悄退化成"恒 422"。

### 顺带修的一处（被改名波及、且原本就 fail-open）

`scripts/check-ontogenesis.mjs:78` 的规则集抽取正则锚在 `listRuleKeys()[\s\S]*?return [` 上，
mock 现已 `return this.allRuleKeys.filter(...)` ⇒ 旧正则会**越过**该方法去咬文件里下一个 `return [`。
更糟的是它下游是 `if (definedRules.size > 0)`——**抽出 0 条就静默跳过整项检查**（fail-open，无信号）。

改：锚点移到数组声明本身，并补金丝雀（抽不到必中样例 `C03` 即报「解析器坏了」，不报「规则集为空」）。
实跑 `node scripts/check-ontogenesis.mjs` → `RC=0`，输出含
`C rules⊆已发布规则集`。

---

## ② X-09 / N-02 · **不可做**（端点不在 canonical）

工单已预写此分支的处置：「若 `compile` 端点在 canonical 上不存在，照实报告并跳过，不要去 cherry-pick 别的分支」。
实测结论正是如此。

### 金丝雀先行（报否定结论前自证工具）

| 命令 | 目标/金丝雀 | 命中数 |
|---|---|---|
| `grep -rn "SkillDefinitionSchema" apps/agentcore/src` | **金丝雀**（必中） | 2 |
| `grep -rn 'qos\.compose-path' apps/agentcore/src` | **金丝雀**（已知 feature key） | 5 |
| `grep -rnF '"/b/v1/skills/:id/publish"' apps/agentcore/src` | **金丝雀**（已知路由字面） | 1 |
| `grep -rn "skill.compiler" apps/agentcore/src` | 目标 | **0** |
| `grep -rn 'skill\.compiler' apps/{agentcore,datacore}/src packages/contracts/src` | 目标（转义点） | **0** |
| `grep -rnE '"(/api/v1\|/b/v1)[^"]*compile[^"]*"' apps/agentcore/src` | 目标（任何 compile 路由） | **0** |

金丝雀全部命中 ⇒ 工具是好的，「0 命中」这个否定结论可信。

### 再追一层（grep 不是结论）

`grep -rn "compile" apps/agentcore/src` 共 41 处，**全部**落在 `router/compile-plan.ts` /
`router/orchestrator.ts` 的 `compileSolverPlan`（QOS 组合路径编译器），与技能编译毫无关系。

端点确实存在，但在**未并分支**上（只读核对，未 cherry-pick）：

```
$ git grep -nE '"(/api/v1|/b/v1)[^"]*compile' FETCH_HEAD -- 'apps/agentcore/src'
FETCH_HEAD:apps/agentcore/src/server.ts:1323:  app.post("/b/v1/skills/:id/compile", async (req) => {
        # FETCH_HEAD = origin/claude/handoff-skill-compiler-s1 @ 1cc304e6
```

该分支上也**没有** `skill.compiler` 这个 feature key（`git grep 'skill\.compiler'` 去掉
`skill-compiler` 文件名命中后为空）。

### 结论与建议

**本条跳过，零改动。** 端点落 canonical 后，补门是两行：
在 `apps/agentcore/src/features/registry.ts` 注册
`{ key: "skill.compiler", name: "技能编译器", level: "BLOCK", defaultOn: false }`
（照 `qos.compose-path` / `agent.skill-on-free-qa` 等暗发条目的写法），
并在 compile 路由 `auth` 之后、`requireCatalogAdmin` **之前**插 FeatureGate 判定
（Entitlement 先于 authz ⇒ 关闭态 404 `FEATURE_NOT_FOUND`，不是 403）。
`defaultOn:false` 是产品决策，本单不擅自改动。

---

## ③ F14 · 出厂 Skill 被同一道发布门补问一遍

### 复核

`apps/agentcore/src/main.ts:29` `repos.skills.insert(sk)` 直插仓储；
`seedRegistry()` 产 7 条技能，其中 **5 条 `status:"PUBLISHED"`**，
`POST /b/v1/skills/:id/publish` **一次也没被调用**。
⇒「门装上了」被读成「库里的东西都过了门」，而这是两个不同的命题。

### 修法：抽单源，不是抄一份

新增 `apps/agentcore/src/skill-publish-gate.ts`：

| 导出 | 性质 | 职责 |
|---|---|---|
| `crossSystemSkillRefs()` | **纯函数** | 抽 `references` + `dependsOn` 两条通道的跨系统引用（`required!==false`） |
| `evaluateSkillPublishGate()` | **纯函数·零 I/O** | 判断核：结构 lint + 引用闭合。`deadRefs` 由调用方解析后传入 |
| `runSkillPublishGate()` | 两条路**唯一入口** | 持有顺序 / force 策略 / 短路语义；`probe` 由调用方注入 |
| `auditSeededSkills()` | 启动期审计 | 只审 PUBLISHED 种子，记诚实位 |

```
  POST /b/v1/skills/:id/publish ──┐
                                  ├─→ runSkillPublishGate()   ← 唯一判据
  main.ts 启动期种子审计 ──────────┘
```

把 I/O 挡在纯函数外，正是为了让这道门能在**启动期**（没有 HTTP、DataCore 可能没起来）直接跑。

**发布路语义原样保留**（逐条核对）：短路顺序（lint 未过不打 DataCore）· force 只豁免质量门
不豁免事实门 · 探针 503 向上冒泡 · 仍在 `repos.skills.update` 之前 ⇒ 拒发布 = 未落库。

### 诚实位（可查询）

`GET /b/v1/ops/skill-seed-gate`（经 `rewriteUrl` 折到 `/api/v1/ops/...`，两条 URL 都通）。
四态：

| status | 含义 | **绝不可读成** |
|---|---|---|
| `NOT_RUN` | 还没审计过（**默认值**） | 干净 |
| `CLEAN` | 跑完，零违规 | — |
| `VIOLATIONS` | 跑完，有违规 | — |
| `GATE_UNAVAILABLE` | 注册表读不出/空集，无法判定 | 干净 |

默认值刻意是 `NOT_RUN` 而非 `CLEAN`：默认若是"干净"，一个根本没跑审计的部署与一个审计通过的部署
在可观测面上一模一样，这道位就白加了。

**不阻断启动**：出厂数据有问题是运维要看见的事实，不是让服务起不来的理由。

### 判据实测 —— 真启动，不是只跑测试

**去掉 → 干净**（`PORT=4102 node apps/agentcore/dist/main.js`，启动日志原文）：

```json
{"level":30,"time":1786283713214,"pid":16108,"hostname":"vm","tenantId":"demo","checked":5,
 "msg":"出厂技能发布门审计：全部通过（与 POST /b/v1/skills/:id/publish 同一份判据）"}
```

```
$ curl -s -H 'x-debug-user: demo:user-admin:catalog_admin' http://127.0.0.1:4102/b/v1/ops/skill-seed-gate
{"status":"CLEAN","ranAt":"2026-08-09T13:55:13.211Z","tenantId":"demo","checked":5,"findings":[]}
# /api/v1/ops/skill-seed-gate 别名返回同一份
```

### 变异反证（真启动层，实跑并已还原）

在 `apps/agentcore/src/mocks/seed.ts` 的 `risk_analysis` 种子里塞一条死路引用
`{ kind: "rule", key: "__MUTANT_DEAD_RULE__", required: true }`，重新 build 后启动：

```json
{"level":50,"skillId":"skl_seed_risk_analysis","skillKey":"risk_analysis","code":"SKILL_REF_UNRESOLVED",
 "detail":"技能引用存在死路（1 项，发布被拒且未落库）：规则「__MUTANT_DEAD_RULE__」不在 DataCore 已发布规则库中（未注册，或仍是 DRAFT 未发布）",
 "msg":"出厂技能未过发布门（种子经 repos.insert 旁路落库，从未走过 POST /b/v1/skills/:id/publish）"}
{"level":50,"tenantId":"demo","checked":5,"violating":1,
 "msg":"出厂技能发布门审计：有违规——详见 GET /b/v1/ops/skill-seed-gate"}
```

```json
{"status":"VIOLATIONS","ranAt":"2026-08-09T13:56:13.447Z","tenantId":"demo","checked":5,
 "findings":[{"skillId":"skl_seed_risk_analysis","skillKey":"risk_analysis",
 "violations":[{"code":"SKILL_REF_UNRESOLVED","message":"技能引用存在死路（1 项…）：规则「__MUTANT_DEAD_RULE__」…"}]}]}
```

`/healthz` 同时仍返 `{"status":"ok"}` —— 证实「报出来」与「不阻断启动」两条同时成立。
种子已还原（`git diff apps/agentcore/src/mocks/seed.ts` 为空），重新 build 通过。

### 「单源」不是靠注释保证的

`apps/agentcore/test/skill-seed-publish-gate.seam.test.ts`（13 用例全绿）里有一组专咬单源：
同一个死路技能分别喂给 ① 真 HTTP 发布端点 ② 纯函数门，断言**两边给出同一个 code**。
哪天有人在 seed 侧抄一份校验（装饰品形态），这条当场红。另有：
force 只豁免 lint 不豁免事实门（两路同口径）· 短路语义保持（lint 未过时 `probed === 0`）·
DRAFT 种子不算违规 · 违规种子**仍留在库里**（审计如实报账，不偷偷回滚出厂数据）。

```
 ✓ test/skill-seed-publish-gate.seam.test.ts (13 tests) 292ms
```

### 这道门第一次跑就抓到一处真东西（顺手修，非本单预期产出）

首次运行审计报了 2 条违规：`risk_analysis→risk_timeline`、`supply_chain_mgmt→kit_readiness`。
**没有直接当成种子缺陷**，先追了一层：这两个求解器在**真** DataCore 目录里都在
（`apps/datacore/src/catalog.ts:51 / :59`，另 `yield_diagnosis` 在 `:63`），
而 `apps/agentcore/src/mocks/clients.ts` 的 `discover("solvers")` 只列了 2 个。

**是 mock 保真缺口，不是种子死路。** 形态照铁律 0.6 记账：
> 「我用 **mock 目录**当作 **DataCore 注册表**的证据，而 mock 目录并不度量它。」

补齐三条并写下自检判据：新增 mock solver 必须同时满足「覆盖出厂种子引用到的每一个 key」
+「该 key 在 `apps/datacore/src/catalog.ts` 里确有其人」——否则就是拿 mock 掩盖真死路引用，
恰好把这道门变成装饰品。三条已逐条核对真目录后才加入。

### 门脚本 `check-ref-closure.mjs` 先报了「门自己瞎了」（报得对）

重构后该门直接红：

```
⛔ ref-closure:check 门自己瞎了（金丝雀未被咬 / 空转）——本次结论作废，不许读作「代码干净」：
  - M1b 把 skill 发布路的探针调用**注释掉**（注释 ≠ 接线）：变异构造失败（目标片段不存在——可能它已经被摘了）
```

先验基线（把 canonical 的 `server.ts`/`resources.ts`/脚本单独摊到临时树跑）：
`5/5 变异全部被咬 … ✓ 通过`，`BASELINE_RC=0` ⇒ **是我的重构改了锚点，不是历史红**。

根因：M1b 金丝雀把 `const deadRefs = await probeMissingRefs(` 这句**字面量抄进了自己**。
F14 把判据抽走后调用形态变成 `probe: (want) => probeMissingRefs(...)`，那句字面量随之消失。
正是铁律 0.6 点名的「抄一份就是装饰品」。

改：变异点**从抽取器现算**（在 handler 切片里按行找真代码行，跳过注释行），不再写死语句形态。
实测新金丝雀在**新旧两种调用形态**上都 `5/5 全咬`（把新脚本单独放到 canonical 代码树里跑过）：

```
· 金丝雀：5/5 变异全部被咬（摘探针 / 注释掉探针 / 空集放行 / 静默 catch / 抽取器失灵）—— 扫描器可信
· 发布路守护：agent 发布 / workflow 发布 / skill 发布 共 3 条，均已抽取到 handler
✓ ref-closure:check 通过（三条发布路均接探针 · 两层 fail-open 均关死 · skill 路拦在落库之前）。
RC=0
```

---

## 回归与门

| 项 | 结果 |
|---|---|
| `pnpm --filter agentcore exec tsc --noEmit` | 干净 |
| `pnpm --filter agentcore build` | RC=0 |
| **agentcore 全量 vitest** | **156 passed / 1 skipped（157 文件）· 933 passed / 1 skipped（934 用例）** |
| `node scripts/check-ref-closure.mjs` | RC=0（金丝雀 5/5） |
| `node scripts/check-ontogenesis.mjs` | RC=0 |
| `node scripts/check-outsource-redline.mjs` | RC=0 |
| `node scripts/check-ontology-anchors.mjs` | **RC=1 —— 历史红，与本单无关**（见下） |

`check-ontology-anchors.mjs` 的 5 条失败全部落在 `apps/datacore/src/app.ts`
（`putSession` / `parentCheckpointId` / `assembleCertification` / `snapKind` / `buildCadenceGates` 行号漂移）。
**已验证是历史红**：把 canonical 整棵树摊到临时目录单独跑，`BASELINE_ANCHORS_RC=1`，同样 5 条。
我改动的文件在失败列表里出现 **0 次**。修法是 `--update` 一键校准，但那要动
`apps/datacore/**` 与 `docs/SYSTEM-ONTOLOGY.md`——两者都在本单的**不许碰**清单里，故未动。

---

## 没做的与原因

| 项 | 原因 |
|---|---|
| **② X-09 entitlement 门** | `POST /b/v1/skills/:id/compile` 不在 canonical（金丝雀齐备的 0 命中）。工单明确要求"照实报告并跳过、不要 cherry-pick 别的分支——那是审核方的活"。 |
| `docs/SYSTEM-ONTOLOGY.md` 回写 | 在本单**不许碰**清单里。本单确实**新增了一道门**（出厂技能发布门审计）与**一个诚实位**（`GET /b/v1/ops/skill-seed-gate`），按铁律 0 应回写 §7（门）与 §8。**请审核方并线时补写**，或另开一单。 |
| `check-ontology-anchors` 的 5 条历史红 | 同上，需动 `apps/datacore/**` + 本体文档，均在不许碰清单。已验证与本单无关。 |
| 契约扩展 | 无。`packages/contracts/**` **零改动**——新类型全部落在 `apps/agentcore/src/skill-publish-gate.ts` 内（AgentCore 内部实现细节，不跨包）。 |

## 范围边界核对

改动 13 个文件，全部在允许范围内：

- `apps/agentcore/src/**`：`tools/{clients,datacore-http}.ts` · `resources.ts` ·
  `dril/resource-registry.ts` · `mocks/clients.ts` · `server.ts` · `main.ts` · `skill-publish-gate.ts`（新）
- `apps/agentcore/test/**`：`skill-ref-closure.seam.test.ts`（改名同步）+ 两个新文件
- `scripts/`：`check-ontogenesis.mjs` · `check-ref-closure.mjs`
  —— **不在清单里但属必要连带**：两者都**读取**我改名/重构的源码，不同步就会一个静默 fail-open、
  一个自报「门瞎了」。两处都已实测 RC=0，且都**顺带补强了**（前者加金丝雀，后者去掉写死的字面量副本）。
- `apps/datacore/**` · `apps/frontend-shell/**` · `docs/SYSTEM-ONTOLOGY.md` · `packages/contracts/**`：**零改动**。

## 并线提示

分支基线是 `69804185`；期间 canonical 前进到 `684f78f1`，新增
`docs/STATUS-2026-08-09-loop-ledger.md` 与 `scripts/check-verdict-rollup.mjs`。
**与本单改动零交集**（`git diff --name-only 69804185 origin/…` 只有那两个文件），cherry-pick 无冲突。
