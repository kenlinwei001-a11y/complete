# AUDIT · 全门「写死的受检对象集合」普查（WO-GATE-ROSTER-SWEEP · 2026-08-16）

> **一句话结论**：全仓 **83 道门 / 351 个顶层常量集合**，抽出 **69 个候选名册**，
> 逐条定性后 **`criteria` 39 · `computed` 18 · `roster`（真债）12**。
> 本单**修掉 5 处**（其中 2 处拿出了 A/B 假绿实证），**建了 1 道机制门**让这病下次由机器先说话，
> 并顺带测出**一个此前没人知道的真洞**（plan 发布路携带规则引用却无引用探针）。
> 断点 `G-GATE-ROSTER-HANDCOPIED` 因此从 **🔴 未修 → ◑ 部分闭合**（**不是 ✅**，剩 12 处逐条在册）。

---

## §0 这次要治的到底是什么

一道门只能证明「**它问过的那些**是对的」，证明不了「**该问的都问了**」。
凡把**受检对象集合**手抄成数组写死在门自己的源码里，不在名单里的对象就**永远绿**。

**形态**（CLAUDE.md 铁律 0.6 句式）：

> **「我用『名单里那几个都合格』当作『所有该合格的都合格』的证据，而前者并不度量后者。」**

### ⚠️ 最要紧的一条：不是所有写死都是病

阈值表 / 错误码表 / 词法表 / 金丝雀样例 / 规范条文抄录 —— 这些**本身就是判据**，
写死是对的；改成「现算」反而是拿被测物去定义判据（**自证循环**），比原来更糟。

**区分只有一句**：

> **这个集合会随仓库演进而变吗？**
> 会变（新增一页 / 一个求解器 / 一个消费方就该进来）⇒ **该现算**（`roster`）
> 不会变（它定义"什么算合格"，改它 = 改规范）      ⇒ **是判据本体**（`criteria`）

这句话**机器判不了** —— 它问的是集合的**语义**，源码里只有**写法**。
所以本单的分工是刻意这样切的，并落成了三个可执行件：

| 谁 | 干什么 | 落在哪 |
|---|---|---|
| **机器** | 按客观形态抽全部候选 + 给可核对信号（路径类/路由类/键类/散文类） | `scripts/lib/roster-hardcode.mjs` |
| **人** | 逐条定性 + 写 `why`（`roster` 的 `why` 必须写清差集） | `scripts/gate-roster-baseline.json` |
| **门** | 未定性的候选 = 红 · 死账 = 红 · `roster` 债只降不升 | `scripts/check-gate-roster-handcopied.mjs` |

---

## §1 双向自证（工具没瞎 ≠ 扫描面选对了）

### 1.1 正向：拿**确定写死**的门过检测器

`check-edge-active-mounts.mjs` —— 它自己的注释就写着「前 8 条来自工单 §1；**第 9 条 `risk-board` 是复核时补的**」。

```
检测器判定：候选名册 1 个 -> PAGES(n=18,路径9)
✓ 正向自证通过（确定写死的门被检出）
```

### 1.2 反向：把**零候选**的门逐个人工过一遍 —— **当场抖出检测器自己的盲区**

首版检测器报「44 道门零候选」，逐个人工核时发现 **`check-ref-closure.mjs` 报零候选，
而它明明手抄了 `GUARDED_PUBLISH_ROUTES` 三条发布路**（全仓实测 9 条发布路由）。

漏因：那三条元素既不以 `apps` 起头（不是仓内路径）、又以斜杠起头（键类判据要求首字符是字母），
且它们**连同引号**存在名册里（`route: '"/b/v1/agents/:id/publish"'`），
抽出来的元素首字符是 `"`，路由/键两个判据一个都匹配不上 ⇒ 整条名册被读作"散文"，**静默漏掉**。

**这一条按铁律 0.6 记账，写进了 `ROUTEISH_RE` 的头注**：

> **「金丝雀证明的是工具没瞎，不是扫描面选对了。」**
> 首版金丝雀**六向全通过**，却完全没能证明扫描面选对了。这两件事必须分开验。

处置：补 `ROUTEISH_RE` + 第⑦向金丝雀（**取真实写法当样例，不是我编的**——
编一个自己保证能过的样例，正是当初漏掉这一整类的原因）+ 剥嵌套引号。
补后候选 **69 → 71**，并因此测出下面 §3.3 那个真洞。

### 1.3 检测器的诚实边界（不许读成「全仓已无写死名册」）

- **只扫门源码的顶层常量**。函数体内的临时数组、`switch` 分支里的字符串、**基线 json 里的名册**一律看不见。
  顶层限制是**刻意的**：全扫会把候选从 71 涨到几百条，真信息被噪声淹没 —— 噪声即失效。
- **元素少于 3 条的集合不当名册看**。实测因此漏掉 `check-debattery.mjs:ROOTS` 这类两元素扫描根
  （它同样只扫 `views` + `pages/admin`，与 §3.4 修掉的那个是同一族病）。
- **判不了差集是多少** —— 那要跑进被测系统现算，每道门逻辑各异。差集逐条测在下面 §2/§4。
- **定性是人写的**，把 `roster` 写成 `criteria` 就能骗过门。这一步靠「改定性 = 一处显眼 diff」+ 人工复审接住。

---

## §2 全门定性表

### 2.1 汇总

| 定性 | 条数 | 含义 | 处置 |
|---|---:|---|---|
| `criteria` | **39** | 判据本体（金丝雀样例 / 规范条文 / 语言词法 / 枚举），写死是对的 | 不动 |
| `computed` | **18** | 已现算（抽到的只是现算逻辑的输入常量：扫描根、跳过表、门自身依赖清单） | 不动 |
| `roster` | **12** | **真债**：受检对象集合写死了 | 逐条在册，本单修 5 / 剩 12 |

> 本单开工时 `roster` 为 **15**，修掉 5 处、期间新暴露 2 处（路由类盲区补上后），
> 收尾 **12**，棘轮 `ratchetHigh` 同步降到 12（**只降不升**）。
>
> ⏩ **后续收口见 §7**（WO-GATE-ROSTER-SWEEP-2 · 2026-08-18）：`roster` 13 → **7**，`ratchetHigh` 12 → **7**。

### 2.2 `roster` 全表（12 条 · 差集实测 · 差什么才能修）

| 门:常量 | 手抄 | 现算 | **差集** | 状态 | 为什么这轮没改（「差什么」，不是「未做」） |
|---|---:|---:|---:|---|---|
| `check-ui-first-layer.mjs:SCAN_DIRS` | 122 文件 | 176 | **54** | 待改 | `components/**`（44 个，含 Answer/QueryDock/Dag/CausalGraph/Provenance 等真上屏组件）+ `pages` 非 admin(7) + `src` 顶层(2) + `workspace`(1) **全在射程外**。门自己已记「27 个未登记文件」并为此建了 D6，但 D6 只覆盖 `SCAN_DIRS` **之内**的新文件。**差什么**：扩面后一次涌入 54 个文件的存量账（`--tighten` 落账即可，不动 `apps/**`），但本门每次运行要加载 typescript 做 AST 遍历，**扩面 44% 的耗时与内存需实测**；且**首轮落账值必须人工抽审**（棘轮首账落错就锁死一个坏基线）。属中等工作量。 |
| `check-boundary-singlesource.mjs:SEG_CONSUMERS` | 4 | 16 | **12** | 待改 | SEG 这一半**只有正向断言、没有全仓负向扫描** ——「某文件内联了 seg 价/利/色但压根不引用 `SEG_REGISTRY`」今天一个都扫不到（BASE 那一半本单已改成现算）。**差什么**：`SEG_REGISTRY` 的值是价格/毛利/颜色三类，**缺一个像 `baseId` 那样稳定可判的字面量形状**；要先在契约里给 SEG 值定可机检形状（如统一走取值函数），才有得扫。属契约改动，动 `packages/**`，超范围边界。 |
| `check-chain-scan-honesty.mjs:SCAN_TARGETS` | 3 | 14 | **11** | 待改 | 全仓引用 `ChainImpediment` 的文件 14 个（含 `solvers/impediment-options.ts`、`decision/causal-graph.ts` 这类同样产数字的地方），门只问写死的 3 个，别处塞裸阈值一样绿。**差什么**：不能简单把 14 个全扫（前端 mock 与视图层出现字面量是正常的），得按「**是否写入 `ChainImpedimentSchema` 字段**」判，要求解析赋值目标而不只是文件引用 —— 属中等工作量的**判据设计**。 |
| `check-edge-active-mounts.mjs:PAGES` | 9 | 12 | **3**（反向多 2） | 已由他单收 | `cleanroom-attr`/`disruption-radius`/`order-chain` 从未被问；反向多了 `plan-generate`/`sop-balance`（标题里没有「推演」二字）。**差什么**：已由 `WO-INFER-PAGE-SSOT` 在 `claude/handoff-wo-infer-page-ssot` 收口（`scripts/lib/sim-page-roster.mjs` + `BUILTIN_VIEWS` 加显式 `sim` 字段），**该分支尚未并入本基线所在的 canonical**；本单重复做会造成两份现算实现打架。收口 = 并入那条分支，本条自动转 `computed`。 |
| `check-object-interface.mjs:FOUR` | 3+1 | — | 迁移维 >0 | 待改 | `repo.ts`/`memory.ts`/`pg.ts` 三件套是架构常量（合理），但同表钉死了**一个迁移文件名**。后续对象接口相关迁移（033、034…）不会进表 ⇒ CLAUDE.md 明令的「新增表需同时改三处」在新迁移上永远绿。**差什么**：需要一条能识别「哪张迁移属于对象接口族」的判据（按内容而非文件名），小到中等工作量。 |
| `check-outsource-redline.mjs:CONSUMERS` | 14 | 15 | **1** | 待改 | 漏 `packages/contracts/src/livedin.ts`，从未被断言③「必须引用契约 token」问过。缓解：该门**负向半已是全仓现算**，漏的只是正向断言这一半。**差什么**：改成「现算引用方 ⊇ 名册」的交叉断言即可，**工作量小**；本单没排上是因为优先修了差集更大、且能拿出 A/B 假绿实证的 `boundary-singlesource`。 |
| `check-opt-template.mjs:CORES` | 5 | 6 | **1** | 待改 | `opt-binding.ts` 的 `bindToSolverArgs` 实测有 **6 个 case**（多 `cross_object_occupancy`），该核的 `requiredRoles` 是否在契约枚举落地从未被问。**差什么**：`CORES` 应从 `packages/contracts/src/opt-template.ts` 的 family 枚举**现算**再与 binding 的 case 集合双向交叉断言（工作量小），但**要先裁定 `cross_object_occupancy` 是「五核心之外的扩展核」还是「漏登记的第六核」** —— 属产品语义裁决。 |
| `check-deploy-governance.mjs:APPS` | 2 | 3 | **1** | 待改 | `apps/datacore/src/calibration/config.ts` 从未被部署治理门问过。**差什么**：需先裁定「标定子模块的配置算不算需要同等 env 治理约束的部署配置」—— **属产品/治理裁决，不是门能自己定的**，故本单不擅自扩面。 |
| `check-ontology-slice-coverage.mjs:EXEMPT_TYPES` | 7 | — | 豁免膨胀 | 待改 | 豁免名单（基础设施类型不计入切片覆盖）**会随仓库演进而变**，但今天**既无棘轮也无 `why`**，任何人加一条即可让一个真业务类型静默免检。**差什么**：豁免**不该现算**（现算 = 自动豁免），正确修法是加**棘轮 + 逐条 `why`**，条数只降不升（工作量小）。本单未排是因为它与「扫描面写死」**同族不同病**（这是豁免膨胀，不是漏检），改法不同，混进来会把两件事搅成一件。 |
| `check-boundary-singlesource.mjs:PLAN_GOAL_CONSUMERS` | 3 | 3 | **0**（今日） | 待改 | 机制与 SEG 同病（只有正向断言、无全仓负向扫描）。**差什么**：目标阈值是**纯数字**，比 `baseId` 难判得多，裸扫会把无关的同值数字全误伤 —— 需先定可机检的字面量形状。 |
| `check-verdict-rollup.mjs:FILES` | 4 | 4 | **0**（今日） | 待改 | 新增第 5 份 `docs/CHECK-*.md` 不会被汇总门问，且不会以任何方式报警。**差什么**：改成 `readdirSync("docs")` 按 `/^CHECK-.*\.md$/` 现算即可，**工作量极小**；未排是因为差集为 0、改了买不到当下信息。 |
| `check-dbui-flow-order.mjs:FILES` | 3 | 3 | **0**（今日） | 待改 | 同上，新增 DataBuilder 面板文件不会被顺序门问。**差什么**：按 `pages/admin` 文件名前缀现算即可，工作量极小。 |

> ⚠️ **差集为 0 不等于机制对**。判据错的时候，**差集为几只是今天的偶然** ——
> 明天多一个对象，它就一辈子免检。这就是为什么这 3 条仍记作 `roster` 债而不是 `criteria`。

### 2.3 `computed` 18 条（已现算，抽到的只是现算的输入常量）

`SKIP_DIRS`×3（遍历跳过表）· `JS_EXT` · `SRC_ROOTS` · `CODE_DIRS` · `PROD_ROOTS` ·
`SCAN_ROOTS`×2 · `sim-ux-criteria:SRC`（四源现算的输入）· `need`×5（**门自身的 dist 依赖自证清单**，
不是受检对象）· `boundary-singlesource:CONSUMERS`（本单已降级为正向断言名册）·
`arg-drop-seam:ROUTER_EMITS` + `PROJECT_BASE_EMITS`（单一来源 = `ceo-route.ts`，
**实测差集 0**：ceo_* intent 恰 11 个逐个对上，且门另有动态半读真种子比对）。

### 2.4 `criteria` 39 条（判据本体，写死是对的）

三类：
1. **金丝雀 / 变异样例**（`CANARIES` · `MUST_BITE` / `MUST_NOT_BITE` · `SAMPLE_*` · `CANARY_*` · `POSITIVE`）
   —— 它们**定义「这道门认得出什么」**，现算化即自证循环。
2. **语言 / 规范常量**（`JS_RESERVED` · `GENERIC_MEMBERS` · `REGEX_PREV_KEYWORDS` · `GEOMETRY_TARGETS`
   · `TRANSPARENT_TYPE_WRAPPERS`）—— 随 JS/SVG/TS 规范变，**不随本仓演进而变**。
3. **枚举 / 规范要求**（`DISPOSITIONS` · `STAGES` · `ONSCREEN_VERDICTS` · `REQUIRED_WIDGET_TYPES`
   · `REQUIRED_COMPONENTS` · `MUST_FOLLOW` · `REQUIRED_EVIDENCE` · `SLACK_FIELDS` · `SENTINELS` …）
   —— 它们是「**什么算合格**」的定义，不是「**现在有哪些**」的枚举；现算化 = 「代码怎么写就算对」。

逐条 `why` 见 `scripts/gate-roster-baseline.json`（门强制每条 ≥20 字，缺 `why` 当场红）。

---

## §3 本单改掉的 5 处（改前/改后差集对照 + 反证原文）

### 3.1 `check-boundary-singlesource.mjs` —— 差集 **0 → 5 个文件 / 24 处**（旗舰案例）

**病灶最毒的形态：名单自带幸存者偏差。** 名单当初照「已知有问题的那几个」抄，
那 3 个**修干净之后名单不变** ⇒ 门每天打印「内联基地字面量 0（零容忍）」，
而全仓真有 5 个名单外文件、24 处内联，**从未被问过一次**。

| 文件 | 内联册内 `baseId` | 在旧名单里吗 |
|---|---:|---|
| `apps/datacore/src/connectors/registry.ts` | 4 | ❌ |
| `apps/datacore/src/livedin/engine.ts` | 10 | ❌ |
| `apps/frontend-shell/src/mocks/livedInFixtures.ts` | 7 | ❌ |
| `apps/frontend-shell/src/mocks/handlers.ts` | 2 | ❌ |
| `apps/frontend-shell/src/mocks/planFixtures.ts` | 1 | ❌ |
| 旧名单里的 3 个文件 | **0** | ✅（所以永远绿） |

**改法**：扫描面 = `SCAN_ROOTS` 全仓现算（**612 个 `.ts/.tsx`**）；三张 `*_CONSUMERS` 表
**降级为正向断言名册**（不再兼任「该扫谁」——两个职责合在一张表上正是病因）；
存量 19 组进棘轮基线逐条带 `why`；加死账断言与扫描面下界自证。

#### A/B 差集实证（同一棵树，只换脚本）

在 `apps/datacore/src/catalog.ts` 注入一条内联 `baseId: "yangzhou"`：

```
$ node scripts/__old-boundary.mjs      # HEAD 上的旧脚本
✓ boundary-singlesource:check：BASE_REGISTRY(13 基地) + SEG_REGISTRY + PLAN_GOAL_TARGETS 单一来源，
  3 BASE / 4 SEG / 3 PLAN_GOAL 消费端均派生、内联基地字面量 0（零容忍）。
OLD_GATE_RC=0                          ← **假绿，且绿得理直气壮**

$ node scripts/check-boundary-singlesource.mjs   # 改后
✗ boundary-singlesource:check 未通过（1 条）：
  - ④ 新增内联基地字面量：apps/datacore/src/catalog.ts:394 baseId: "yangzhou"
M2_RC=1
```

#### 五向变异反证（每条先证「变异体 != 原文」，再显式捕获退出码）

| # | 变异 | RC | 输出要点 |
|---|---|---:|---|
| M1 | 旧名单**内**文件加内联 | **1** | `④ 新增内联基地字面量：…simSolvers.ts:2095 baseId: "changzhou"` |
| M2 | 旧名单**外**文件加内联 | **1** | 见上 A/B（旧脚本 RC=0） |
| M3 | 基线注入死账条目 | **1** | `④ 棘轮松弛：基线仍挂着 …#yangzhou，但现算已无此内联 …请跑 --tighten 收紧`；`--tighten` 后回绿且**人手 `why` 逐字留存** |
| M4 | 移走基线 | **2** | `⛔ …工具坏了：找不到 scripts/boundary-singlesource-baseline.json`（**不是 RC=1**） |
| M5 | 打断册解析器令 `BASE_IDS` 变空 | **2** | `⛔ …读不到 …BASE_REGISTRY baseId 全集（单一来源册结构变了？门失去判据）` —— **拒绝报「内联 0」** |

逐条还原后复绿 **RC=0**，`git status --porcelain` 对 `apps/` 为空。

### 3.2 `check-gate-roster-handcopied.mjs` —— 新建的**机制本体**

照铁律 0.6：同一个错第 2 次必须建机制，**机制的判据只有一条 —— 下次是机器先说话**。
逐道门去修是一次性的；明天新加的门照旧可以手抄一份名册，病当天复发。

#### 四向变异反证

| # | 变异 | RC | 输出要点 |
|---|---|---:|---|
| N1 | 新建一道门，里面手抄一份受检文件名册且未定性 | **1** | `① 未定性的写死集合：check-zzmutant-probe.mjs:PAGES（3 个字面量 · 路径类 3 · 键类 0）…` + 追问「这个集合会随仓库演进而变吗？」 |
| N2 | 基线注入死账条目 | **1** | `② 死账：基线里有 __zz_fake__:X…` ＋ `④ 棘轮：roster 债 15 条 > ratchetHigh 14` **双报** |
| N3 | 把一条 `roster` 的 `why` 缩到 2 字 | **1** | `③ …缺 why（<20 字）` ＋ `③ …定性为 roster 但 why 里没写差集/漏了什么` **双报** |
| N4 | 打断 lib 抽取器主正则 | **2** | `⛔ …金丝雀未通过：①必中·路径类… ②必中·键类… ③判据本体也被抽出… ④必不中·散文…` ＋「**不许**读作『全仓没有写死的名册』」 |

逐条还原后复绿 **RC=0**。

### 3.3 `check-ref-closure.mjs` —— 差集 **6**，并测出**一个真洞**

这道门原文自陈「新增一条发布路就该进这张表——表本身是可 review 的边界」，
**而这句话恰恰是病灶**：它把「谁该被守」交给人的记性。
本门 D1 号称治「新增一条发布路忘了接探针」，可**忘了接的那条同时也会忘了进这张表**。
更讽刺的是：本门文件头**自己**已经点名过这个病（"grep 得到 `probeMissingRefs` 有 2 个调用方
这个看起来很健康的数字，而它并不度量每条发布路都被守住了"）—— 旧实现只是把同一个错
从「数调用方」挪到了「数名单」。

现算 9 条发布路由（手抄 3 条），**逐条追过一层**才定性，不是 grep 命中数：

| 路由 | 定性 |
|---|---|
| `/api/v1/catalog/plans/:planId/publish` | **🔴 真洞**：`publishPlan` 确证携带规则引用（调 `planStepRuleRefs` 并 `reportRefs` 上报 A），**却从不调 `probeMissingRefs`** ⇒ 引用一条不存在/仍是 DRAFT 的规则照样发布成功 |
| `/b/v1/plan-builders/:id/publish` | **🔴 同洞第二入口**：`publishCanvas` → `publishPlan` |
| `/b/v1/scenarios/:key/publish` | ✅ 非缺口：另有 `scenarioClosure` 闭合守卫（不同机制，守同一件事） |
| `/b/v1/scenarios/:key/publish-chain` | ◑ 经服务层间接守 —— **暴露本门一条边界：D1 判 handler 文本，判不了跨文件间接守护** |
| `/api/v1/catalog/intents/:intentId/publish` | ◑ 今日未测出携带 solver/rule/objectType 引用 |
| `/b/v1/mcp-configs/:id/publish` | ◑ 引用的是外部 MCP 服务器与工具，`probeMissingRefs` 三个切面都不适用（拿它去探等于问错注册表） |

> ⚠️ **本门只让洞可见，没有把洞补上**：接探针要动 `apps/agentcore/src`，
> 超出本单纯门单的范围边界。基线里逐条写了「差什么才能修」。

#### 三向变异反证（含第二例 A/B 假绿实证）

```
===== R1: 在 server.ts 新增一条未接探针的发布路 /b/v1/zzprobe-widgets/:id/publish =====
变异体 != 原文: true

$ node scripts/__old-refclosure.mjs        # HEAD 上的旧脚本
✓ ref-closure:check 通过（三条发布路均接探针 · 两层 fail-open 均关死 · skill 路拦在落库之前）。
旧脚本_RC=0                                 ← **假绿：D1 号称治的正是这个形态，却够不着**

$ node scripts/check-ref-closure.mjs        # 改后
✗ ref-closure:check 未通过（1 条）：
  - D1 摘门：/b/v1/zzprobe-widgets/:id/publish（"…"）的 handler 里没有 probeMissingRefs(
      （该路不在棘轮基线里 = **新增**未守发布路，当场红）
新脚本_RC=1

===== R2: 把已守的 agents 路塞进基线 =====
✗ - 棘轮松弛：基线仍挂着 "/b/v1/agents/:id/publish"，但现算它已被探针守住 …请跑 --tighten 收紧
R2_RC=1

===== R3: 移走基线 =====
⛔ ref-closure:check 工具坏了：找不到 scripts/ref-closure-baseline.json —— 棘轮基线是判据①的输入
R3_RC=2                                     ← 旧版此处退 1，方向正好相反
```

逐条还原后复绿 **RC=0**，`git status --porcelain` 对 `apps/` 为空。
既有五向金丝雀（摘探针 / 注释掉探针 / 空集放行 / 静默 catch / 抽取器失灵）仍 **5/5** 全中。

### 3.4 `check-screen-value-provenance.mjs` —— 差集 **3**，扫描面 174 → 220

漏的是 `App.tsx`（挂路由与 Guard）/ `main.tsx` / `workspace/featureGate.tsx`。
改为现算全遍历 `apps/frontend-shell/src` + `EXCLUDE_DIRS` **排除判据** ——
方向从「**默认排除、纳入具名**」翻成「**默认纳入、例外具名**」。
排除是判据（每条带理由、会被 review），名单不是。改后门仍 **RC=0**、存量违规 0。

> ⚠️ **差集 3 很小，但机制方向是反的**：明天在 `src/` 顶层新写一个上屏组件，它照样一辈子免检。
> 修它买的不是今天的信息，是**将来不再漏**。

### 3.5 `check-prd-coverage.mjs` —— 差集 **1**（语料根）

`packages/contracts/test` 存在且有测试文件，**从未进过 PRD 覆盖语料**。
改为枚举 `apps/*/test` + `packages/*/test` 现算。
加**语料根下界自证**：<3 个目录即 **RC=2「工具坏了」** —— 集合塌陷会把**每一项**报成「未覆盖」，
这是**假红**的危险方向（与多数门的假绿方向相反，故单独说明）。

> ⚠️ **诚实记账**：改后「有测试引用 210 · 零测试引用 11」两个数**一字未变**，
> 因为 `contracts/test` 今天不引用任何验收编号。
> 本次买到的是**机制正确**（新增工作区包自动进语料），**不是**当下的数字变化。
> 不许把它写成「修好了 1 处漏检」。

---

## §4 顺带测出、但**不属本单射程**的两件事（如实记，不夹带）

1. **册外 `baseId` 悬空引用**：`apps/datacore/src/connectors/registry.ts` 的 `MOCK_ERP_DATA`
   里有 `yibin` / `xian` / `qingdao` / `liyang` **四个册外 id**。
   `boundary-singlesource` 今天只咬**册内** id（`baseIds.has(...)`），册外的是**另一种病**（悬空引用）。
   但它很可能是**有意**的（演示「上游 ERP 的基地编码与本体对不上」，正是 A1 连接器映射要处理的对象）——
   **属产品语义裁决**，故本单只记录、不擅自入门。
2. **`gates` 串 vs 磁盘门数**：磁盘 83 道门，`gates` 串跑 56 道，**27 道不在串里**。
   看起来是同族最大的一笔，**但追一层后定性相反**：`check-gate-ledger.mjs` 的判据①③
   已经用 `gate-census.mjs` 的 `listGateScripts()` **现算**了门的全集，
   每道门的 `binding` 与 `disposition` 逐条在账 ⇒ **不存在「因名单手抄而永远绿」**。
   那 27 道属另一个已登记的断点（`G-DEAD-GATE-BY-POLICY`：宣称存在、实际不执行），
   **不是本条断点**。—— 这一条特意写下来，因为它正是「拿一个看起来相关的数字当结论」的诱饵。

---

## §5 本体回写的准确状态

`docs/SYSTEM-ONTOLOGY.md` §8 `G-GATE-ROSTER-HANDCOPIED`：**🔴 未修 → ◑ 部分闭合**。

**为什么是 ◑ 不是 ✅**（按实际写，不为好看写满，也不为保险写低）：

- ✅ 机制本体已落地并接进 `pnpm gates`（`gate-roster:check`，§7 有条目、门账有条目）；
- ✅ 全门普查已完成，71 个候选逐条定性、逐条有 `why`；
- ✅ 修掉 5 处，其中 2 处拿出了 A/B 假绿实证；
- ❌ **仍有 12 处 `roster` 债**（逐条在 §2.2，各自写明差集与「差什么才能修」），
  其中 `ui-first-layer` 那笔差集 **54** 是全仓最大的一笔；
- ❌ **普查本身有覆盖不到的层**（§1.3）：只扫门源码顶层常量，
  函数体内/`switch`/基线 json 里的名册看不见，<3 元素的集合看不见。

> **「我没找到」和「它不存在」是两个命题。** 本条按前者写。

`docs/SYSTEM-ONTOLOGY.md` §7 新增 `gate-roster:check` 条目
（是 `ontology-writeback:check` 当场报「§7 漏登 1」逼出来的，不是人想起来的）。

---

## §6 复验命令

```bash
node scripts/check-gate-roster-handcopied.mjs            # 机制门（0/1/2）
node scripts/check-gate-roster-handcopied.mjs --census    # 全表：71 候选 + 信号 + 定性
node scripts/check-gate-roster-handcopied.mjs --selftest  # 七向双向金丝雀
node scripts/check-boundary-singlesource.mjs --census     # 现算内联命中（19 组，全部旧名单外）
node scripts/check-ref-closure.mjs --census               # 现算 9 条发布路 · 谁守了谁没守
```

**本单改过的门当前状态**（逐个实跑，显式捕获退出码）：
`boundary-singlesource` 0 · `gate-roster` 0 · `ref-closure` 0 ·
`screen-value-provenance` 0 · `prd-coverage` 0 ·
`gate-exit-discipline` 0（83/83 门守纪律）· `ontology-writeback` 0 · `ontology-anchors` 0 ·
`stale-claims` 0 · `baseline-writer-honesty` 0（走共享写入器 12 → 15，本单一条豁免都没加）。

**本单一共被机器点名 4 次**（全都不是人想起来的，逐条如实记）：
① `ontology-writeback` 报「§7 漏登 1」⇒ 才去补本体 §7 条目；
② `ontology-anchors` 咬红我写进本体的 `catalog.ts:394`（行号越界 + 未校准新增）⇒ 改成不带行号的说法；
③ 本单自己建的 `gate-roster` 接住我改 `ref-closure` 造成的死账与未定性常量 ⇒ `--tighten` + 补定性；
④ `baseline-writer-honesty` 把本单三处新写入器判为 `HAND_ROLLED` —— 我确实 import 并调用了 `buildBaselineDoc`，
   但先赋给中间变量再写，静态判定看不出「写的那一刻」用没用共享写入器（「导入了」≠「写的时候用了」）。
   三处一律改成内联在写入表达式里，`ref-closure` 另补 `baselineDocCanary()`。

`gate-ledger` 与 `system-ontology` 报 RC=2 / RC=1，**均为预存在**：
本 worktree 未 `pnpm -r build`，两者引用的 `dist/**` 路径解析不到。
已用 `git stash` A/B 核实过：**改前改后同样报，与本单无关**。

---

## §7 SWEEP-2 收口（WO-GATE-ROSTER-SWEEP-2 · 2026-08-18）

> **一句话结论**：开工时 `roster` **13 条**（sweep-1 收尾 12 + 期间新暴露 1 条），
> 本单**修掉 7 处**、他单收口 1 处（`--tighten` 收死账）、扩面新暴露 2 处（如实登记为 roster），
> 收尾 **`roster` 7 条 · `ratchetHigh` 12 → 7（只降不升）· 元门 RC=0**（无未定性 · 无死账 · 债不升）。
> 断点 `G-GATE-ROSTER-HANDCOPIED` 维持 **◑ 部分闭合**（剩 7 条逐条在册，不写 ✅）。

### 7.1 总数账

| 口径 | sweep-1 收尾 | sweep-2 开工 | sweep-2 收尾 |
|---|---:|---:|---:|
| `roster` 债 | 12 | **13**（新暴露 1 条期间进来） | **7** |
| `ratchetHigh` | 12 | 13（开工时自动抬起） | **7**（`--tighten` 自动 `min(prev, rosterCount)`） |
| 候选总数 | 71 | 71 | 74（新常量净增 3，全部人手定性） |
| `criteria` | 39 | 39 | 48（含本单翻 verdict 的 2 条：名册被一致性断言锁死后即判据本体） |
| `computed` | 18 | 18 | 19 |

### 7.2 本单修掉的 7 处（改法 + T1 变异反证）

| # | 门:常量 | 差集 | 改法 | 变异反证（造一处真违规 ⇒ RC=1 点名 file:line） |
|---|---|---:|---|---|
| 1 | `check-ui-first-layer.mjs:SCAN_DIRS` | **54** | `SCAN_ROOT=apps/frontend-shell/src` 全递归现算（122→182 文件），`EXCLUDE_RE` 例外具名（当前零条）+ `MIN_FILES=150` 下界自证；`pageOf` 补 components/pages 非 admin 两桶标签 | `components/BlockConversable.tsx`（原差集文件）造第一层口径 ⇒ RC=1 四处点名 file:line（含【新文件·R-UI-3】硬上限 + D1 + D2 + D2b） |
| 2 | `check-verdict-rollup.mjs:FILES` | 0（今日） | `readdirSync("docs")` 按 `/^CHECK-.*\.md$/` 现算 + 下界 4 自证；顺带修环境致死 bug：第 82 行写死原作者容器 scratchpad 路径（换机恒 ENOENT 砸 RC=2）⇒ 改 `os.tmpdir()` best-effort | 新建 `docs/CHECK-ZZZ-T1MUT.md` ⇒ 自动进汇总表点名 |
| 3 | `check-dbui-flow-order.mjs:FILES` | 0（今日） | `SCAN_DIR=pages/admin` + `FAMILY_RE=/^(DataBuilder\|Promote).*\.tsx$/` + `MIN_FAMILY=3` 现算；读不到目录/塌下界 ⇒ RC=2 | 新建 `DataBuilderT1Mut.tsx` 放屏上 jargon ⇒ RC=1 点名 |
| 4 | `check-outsource-redline.mjs:CONSUMERS` | 1 | 补登 `packages/contracts/src/livedin.ts`；新增**断言⑤**：现算全仓引用方（剥注释命中 CONTRACT_TOKENS、排除单源）⊆ 名册，漏登记即红；名册 verdict 翻 `criteria`（被断言锁死） | 造未登记引用方 ⇒ RC=1 断言⑤点名 |
| 5 | `check-object-interface.mjs:FOUR` | 迁移维 >0 | 迁移维按**内容**现算：`MIGRATION_RE=/CREATE TABLE IF NOT EXISTS object_interfaces/`，编号不问（搬家史 028→032 已证明编号不稳）；多命中⇒红、零命中⇒红；FOUR 其余三维是架构常量 | 造第二份建表迁移 ⇒ RC=1 点名两份路径 |
| 6 | `check-opt-template.mjs:CORES` | 1 | 双向现算 + **精确划分断言**：契约枚举（z.enum 12 族）= 落地 case（bindToSolverArgs 现算 6 族）⊔ `NOT_YET_BOUND`（6 族）；交集非空/幽灵账/新族两边未登记三向红；解析自证（塌陷或已知族不中 ⇒ RC=2） | 注入假 case `zzz_roster_mutation` ⇒ RC=1 点名漂移 |
| 7 | `check-ontology-slice-coverage.mjs:EXEMPT_TYPES` | 14 条全是死账 | 实测旧 14 条豁免**全部不在 94 个已发布类型里**（零平台/元类型）= 纯死账 ⇒ 当场清零（`EXEMPT_TYPES=new Map([])` · `EXEMPT_CAP=0` 只降不升）+ 三断言：条数>CAP⇒红 · why<20字⇒红 · 豁免类型不在 types 里⇒红（死账） | 塞死账豁免 ⇒ RC=1 点名 SystemInvariant |

**修完不等于门绿**：全部 7 处验收口径是「拿一个原本在差集里的文件造一处真违规，门点名到 file:line」——7/7 通过；变异现场均已删除/恢复，复跑全绿，`git status --porcelain` 对 `apps/` 为空。

### 7.3 他单收口 1 处

- `check-edge-active-mounts.mjs:PAGES`：由 `WO-INFER-PAGE-SSOT`（`claude/handoff-wo-infer-page-ssot`）修好（`scripts/lib/sim-page-roster.mjs` 现算），本单在基线 `--tighten` 收死账，条目删除。

### 7.4 扩面新暴露 2 处（如实登基线，不算本单制造）

扫描面扩开后既存违规成片露头是预期现象——这两处是**扩面后才进视野**的，按同一判据定性为 roster：

| 门:常量 | 差集 | 差什么才能修 |
|---|---:|---|
| `check-dev-jargon-onscreen.mjs:SCAN` | 漏 `components/**` + `pages` 非 admin | 与 ui-first-layer **同族病**，修法已有成例（SCAN_ROOT 全递归 + 例外具名）；本轮未排是因为优先修差集更大的 7 处，工作量小、下个工单可单收 |
| `check-typecheck-coverage.mjs:PACKAGES` | 工作区包与名单可能漂移 | 该从 `pnpm-workspace.yaml` 现算并交叉断言（输入即真相源，工作量小） |

### 7.5 剩 7 条 roster 全表（5 旧 + 2 新 · 各自「差什么」）

| 门:常量 | 手抄 | 现算 | 差集 | 差什么才能修 |
|---|---:|---:|---:|---|
| `check-boundary-singlesource.mjs:SEG_CONSUMERS` | 4 | 16 | **12** | SEG 值（价格/毛利/颜色）**缺像 baseId 那样稳定可机检的字面量形状**；要先在契约里给 SEG 值定可机检形状（如统一走取值函数）才有得扫——属契约改动 |
| `check-boundary-singlesource.mjs:PLAN_GOAL_CONSUMERS` | 3 | 3 | 0（今日） | 同 SEG 病：目标阈值是纯数字，裸扫误伤，需先定可机检字面量形状 |
| `check-chain-scan-honesty.mjs:SCAN_TARGETS` | 3 | 14 | **11** | 不能简单全扫（前端 mock/视图层字面量正常），得按「是否写入 ChainImpedimentSchema 字段」判——要求解析赋值目标而不只是文件引用，属判据设计 |
| `check-deploy-governance.mjs:APPS` | 2 | 3 | 1 | 「标定子模块的配置算不算需要同等 env 治理约束」**属产品/治理裁决**，门不能自己定 |
| `check-layout-legibility.mjs:PAGES` | 2 | 13 | **11 页** | 每页需浏览器渲染测字号（12×成本）且**无逐页基线机制**；已有名单vs现算一致性段兜底（新页不进名单当场红） |
| `check-dev-jargon-onscreen.mjs:SCAN` | — | — | 见 §7.4 | 同 ui-first-layer 成例，工作量小 |
| `check-typecheck-coverage.mjs:PACKAGES` | — | — | 见 §7.4 | 从 pnpm-workspace.yaml 现算交叉断言，工作量小 |

### 7.6 既存违规登基声明（前置 3.3 · 未动一行 `apps/**`）

ui-first-layer 扩面 122→182 后涌入 58 个未登记文件 + 存量违规露头，全部分解为：

- **58 条 D6 未登记**：`--tighten` 如实落账进 `unlisted`（`files` 95→97 · `unlisted` 87→85 · `conserve.total` 7601）；
- **2 个硬上限违规者**（`components/Answer/KitProcurementLegs.tsx` R-UI-3 公式 · `pages/ShellLayout.tsx` 字号 5 级）：从 unlisted 移入 `files` 带 why——存量认账，unlisted 硬上限对存量首登永红会堵死落账本身；
- **10 条增长认账**（OrgWorldPage first 84→85 · PlanGenerateView 27→33 · PmDag sizes 0→2 等）；
- **6 条 D4 守恒认账**（OntologyRelationsPage totalFloor 117→111 · PerturbationTimeline 66→52 等）。

全部 why 带「2026-08-18 认账（WO-GATE-ROSTER-SWEEP-2 扩面首轮登基）：门在 merge-base 上已红（旧脚本同树实测 31 条红，BASE_RC=1），非本单制造；落账≠达标，整改归 G-UI-FIRSTLAYER-OVERLOAD 后续单」。**未改任何 `apps/**` 文件消红。**

### 7.7 串台事故记录（诚实边界 · 协调者要求专节）

本单执行期间发生**双向串台**（同仓 sibling agent P2 的 worktree 与本树互扰），全过程经 reflog 时间线法医链实证：

1. **我的产出曾写入 P2 树**：`check-ui-first-layer.mjs` 新版本曾误入 P2 worktree。P2 将副本保全至 `/tmp/wo-stray-check-ui-first-layer-gate-roster-sweep-2.mjs`（95532B）。本单 diff 后确认其头注更丰满（断点引用 + 铁律 0.6 句式 + pathspec 警告），已合并精华回本树版本（功能等价）。**stray 副本已消费完毕。**
2. **P2 的产出曾写入本树**：P2 的 `docs/SYSTEM-ONTOLOGY.md` 版本曾写入本树。本单 `git checkout` 恢复 HEAD 状态；P2 内容已在其分支 `a788735ff` 落袋（逐字节 diff 证实**零损失**）。
3. **最严重的单次损失**：00:41 本树被 `git reset --hard HEAD`（reflog 实证）抹掉**未提交**的 check-ui-first-layer.mjs 首轮改造。教训已执行：**此后每个可命名单元立刻 commit+push**（本单 8 个提交全部即做即推）。

**归位状态**：两树现均干净（本树 §7 收口期间 `git status --porcelain` 对 scripts/docs 之外为空；P2 树内我的文件已被其 reset 清除、我的树内 P2 文件已 checkout 还原）。**影响面**：仅 `check-ui-first-layer.mjs`（我的，已取回）与 `docs/SYSTEM-ONTOLOGY.md`（P2 的，已归还）两个文件碰过别的树，均零损失归位。

**防再发**（协调者四条指令已内化）：① 写操作前确认 `git rev-parse --show-toplevel` 含 `agent-af5310a15bdb31dc5`；② stray 副本已对比取回；③ 不再发生 reset 清未提交编辑（铁律1#5：完成即 commit+push）；④ 本节即串台影响面说明。

### 7.8 复验命令（sweep-2 增）

```bash
node scripts/check-gate-roster-handcopied.mjs            # 元门：RC=0 · roster 7 ≤ ratchetHigh 7
node scripts/check-gate-roster-handcopied.mjs --census    # 74 候选全表（criteria 48 · computed 19 · roster 7）
node scripts/check-ui-first-layer.mjs                    # RC=0（182 文件现算面 · 基线已登基）
node scripts/check-verdict-rollup.mjs                    # RC=0（docs/CHECK-*.md 现算）
node scripts/check-dbui-flow-order.mjs                   # RC=0（DataBuilder|Promote 族现算 3 个）
node scripts/check-outsource-redline.mjs                 # RC=0（断言⑤现算引用方⊆名册）
node scripts/check-object-interface.mjs                  # RC=0（迁移维按内容现算）
node scripts/check-opt-template.mjs                      # RC=0（精确划分：枚举12=落地6⊔未接线6）
node scripts/check-ontology-slice-coverage.mjs           # RC=0（豁免清零 · 三断言）
```

**sweep-2 改过的门当前状态**（逐个实跑，显式捕获退出码）：
`gate-roster` 0 · `ui-first-layer` 0 · `verdict-rollup` 0 · `dbui-flow-order` 0 ·
`outsource-redline` 0 · `object-interface` 0 · `opt-template` 0 · `ontology-slice-coverage` 0。

