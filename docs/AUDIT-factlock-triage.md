# AUDIT · 位置锚事实锁逐条分诊（WO-FACTLOCK-TRIAGE · 2026-08-16）

门：`scripts/check-factlock-anchor.mjs`（别名 `factlock-anchor:check`）·
断点：`G-FACTLOCK-POSITION-ANCHOR`（本体 §8）·
基线：`scripts/factlock-anchor-baseline.json`

---

## 0 · 结论先行

| 项 | 数 |
|---|---|
| 派单时门报的新增位置锚 | **41** |
| 本单**修好门之后**实际存在的新增位置锚 | **42**（+1，见 §1） |
| **A · 位置就是事实本身**（登记基线） | **10 条 · 23.8%** |
| **B · 锚点脆弱**（改测试） | **32 条 · 76.2%** |
| 门最终退出码 | **RC=0** |

A 类占比 **23.8%**，远低于派单给的 90% 警戒线。

> ⚠ **41 → 42 不是我数错，是门原先漏报了一条。** 详见 §1 —— 这条正是派单那句
> 「金丝雀证明的是工具没瞎，不是扫描面选对了」的实例：门的 13 条金丝雀全绿，
> 而它对生产代码里最常见的一种格式化形状**完全免疫**。

---

## 1 · 先修门：一个静默漏报（41 → 42）

`findExpectSites` 原先把匹配器括号内的**整段原文**当探针：

```js
probeRaw: matcherClose > 0 ? code.slice(matcherOpen + 1, matcherClose).trim() : "",
```

于是 prettier 的多行尾逗号会让探针带上一个 `,`：

```ts
expect(pg, `033 建了 ${table}，但 repo/pg.ts 没有它的 PgStore 落点 ⇒ pg 模式启动即炸`).toContain(
  `new PgStore(pool, "${table}")`,     // ← 这个尾逗号
);
```

`probeIsSymbol` 的三条外壳正则（`^"…"$` / `` ^`…`$ `` / `^/…/[a-z]*$`）都要求**整串**就是一个字面量，
带上 `,` 一条都不匹配 ⇒ 判「不是代码符号」⇒ **整个站点被静默跳过**。

**实测后果**：`process-flow-time.seam.test.ts:354` 的 `repo/pg.ts` 落点锚一直没被咬中，
而它 **4 行之下**、同一个 `it`、同一条仓规、形态一模一样的 `repo/memory.ts` 落点（单行、无尾逗号）
被咬中了 —— 一个报一个不报。

照铁律 0.6 的句式：

> **「我用『括号里的整段原文』当作『探针实参』的证据，而前者并不度量后者
> —— 只要 prettier 换了行，两者就不是一回事。」**

**为什么 13 条金丝雀一条都没照到**：它们全是**单行、单实参、无尾逗号**的手写样例，
与生产格式化后的真实形状**交集为空** —— 与铁律 0.5 判据 #6（「生产实参与测试实参交集为空」）同形。

**修法**：探针改取匹配器的**第一个顶层实参**（走已有的 `splitTopLevel`），
并补金丝雀 **C7**，逐字取自 `process-flow-time.seam.test.ts:352-357` 的真实格式化结果。
**变异反证**：把 `probeRaw` 改回修前写法 → C7 当场不中 → **RC=2「门自己坏了」**（原文见 §5）。

全仓实测这个形态共 **6** 个站点被跳过，其中**只有 1 个是真锚**（其余 5 个主语是运行时值
`r.error` / `calls[0]!.url` / `detectPlaintextLeaks(probe2)` / `rule`，本就不该咬）。

---

## 2 · 分诊判据（先写死判据，再逐条套；不许"感觉"）

派单给的总判据：**「如果有人把这个东西挪到别的文件，是不是真的坏了？」答不是 ⇒ B。**
落到本仓，A 只有三种合法形态：

| 代号 | 形态 | 判据 |
|---|---|---|
| **A-1** | **金丝雀同锚** | 该正向断言的作用是为**同一个 `it` 内一条文件/页作用域的否定断言**背书。否定断言按门自身 N2 规则合法地锚在文件上（"**这个文件**不许出现 X"），**且整树化会让它恒红**（必须实测证明）。否定锚在文件上，金丝雀就必须同扫描面 —— 金丝雀扫 A 面、结论扫 B 面正是铁律 0.6 的原形态。 |
| **A-2** | **仓规四落点** | CLAUDE.md《关键约定》「仓储双实现」明文：「新增表需同时改 `migrations/*.sql` + `repo/pg.ts` + `repo/memory.ts` + `repo.ts` 接口」。**落点在不在那个文件**就是这条仓规的全部内容。 |
| **A-3** | **反空胜守卫** | 该正向断言与同 `it` 内一条否定断言**正负成对**（两条一起被删则否定空胜通过）。 |

**B 的反面判据（任一成立即 B）**：
1. 挪到别的文件 ⇒ **假红**，而能力一行没少；
2. 在原文件写一句同名**注释** ⇒ **假绿**（本仓 `readRepoFile` / `readFileSync` 一律**不剥注释**）；
3. 同一命题在**同一个测试文件里**已有更硬的运行时断言（真渲染 / 真发请求 / 真比对响应）。

---

## 3 · 逐条分诊表（42 条）

行号是**派单时**的行号（改写后已漂）。`key` 是内容哈希，不随行号变。

### 3.1 A 类 · 10 条

| # | file:line | 断言原文（节选） | 锚的文件 | 类 | 理由 | 处置 |
|---|---|---|---|---|---|---|
| A1 | `apps/datacore/test/org-world.test.ts:563` | ``toContain(`new PgStore(pool, "${tbl}")`)`` | `src/repo/pg.ts` | **A-2** | 032 建的 4 张表在 pg.ts 都要有 PgStore 落点；挪走 ⇒ pg 模式启动即少表（且测试全绿，只有真起 pg 才炸） | 登记基线 |
| A2 | `apps/datacore/test/org-world.test.ts:567` | ``toContain(`${field}: new MemStore()`)`` | `src/repo/memory.ts` | **A-2** | 同上，memory 侧落点 | 登记基线 |
| A3 | `apps/datacore/test/process-flow-time.seam.test.ts:94` | `toContain("PROCESS_INSTANCE_ORIGINS")` | `packages/contracts/src/process-instance.ts` | **A-1** | 背书「**这两份文件**的代码行里一次都不出现 `stdDurationDays`」。**实测**该串在别处合法存在 **7** 处（contracts 2 + datacore 5），整树扫会让否定恒红 ⇒ 否定必须留在文件作用域 ⇒ 金丝雀必须同锚 | 登记基线 |
| A4 | `…process-flow-time.seam.test.ts:95` | `toContain("BATTERY_PROCESS_FLOW_RULES")` | `src/process/flow-rules.ts` | **A-1** | 同 A3，规则表侧那一半 | 登记基线 |
| A5 | `…process-flow-time.seam.test.ts:354` ⭐ | ``toContain(`new PgStore(pool, "${table}")`)`` | `src/repo/pg.ts` | **A-2** | ⭐ **本单修门后才浮出来的第 42 条**（§1）。失败文案自己写着后果：「pg 模式启动即炸」 | 登记基线 |
| A6 | `…process-flow-time.seam.test.ts:358` | ``toContain(`${camel}: new MemStore()`)`` | `src/repo/memory.ts` | **A-2** | 同上，memory 侧 | 登记基线 |
| A7 | `apps/datacore/test/process-instance-merge.seam.test.ts:297` | `toContain("instanceLevel")` | `src/sim/impact-analysis.ts` | **A（最弱）** | 诚实位台账复核，登记主语是**那个模块**。⚠ 它**不**满足 A-1（同 `it` 内无否定断言）—— 见 §6 U-1 | 登记基线 + 列入拿不准 |
| A8 | `apps/frontend-shell/test/befe-e-opt-template-pool.seam.test.tsx:215` | `toContain("const FAMILY_COPY:")` | `../src/views/OptimizeWhatifView.tsx` | **A-3** | 与 `not.toContain("const FAMILIES:")` 正负成对；命题是「**这一页**不许自持权威清单」，别处有权威清单是合法的 | 登记基线 |
| A9 | `apps/frontend-shell/test/befe-wire-d.seam.test.tsx:318` | `toContain("resolveApprovers")` | `../src/pages/admin/OrgWorldPage.tsx` | **A-1** | 背书「**组织世界页**没 import 任何审批写函数 ⇒ 没绕过 R4」。别的页调 `createActionDraft` 完全合法，整树扫恒红 | 登记基线 |
| A10 | `apps/frontend-shell/test/befe-wire-f.seam.test.tsx:456` | `toContain("hasApiKey")` | `../src/mocks/handlers.ts`（门报 4 路径多锚） | **A-1** | 背书「**这三份 mock 源码**里不许出现明文凭据形态」；`it` 名写着「写进 fixture = 泄漏进仓库」，被查对象就是那三个仓库文件本身 | 登记基线 |

### 3.2 B 类 · 32 条

处置栏的**整树扫**一律指走 `apps/frontend-shell/test/factlock.ts`（`checkedTree` + `factHits`，
剥注释，内建四条金丝雀），即门自身"修法"给的样板。

| # | file:line | 断言原文（节选） | 锚的文件 | 理由（B 的哪一条） | 处置 |
|---|---|---|---|---|---|
| B1 | `org-world.test.ts:228` | `expect(declared).toContain("OrgPrincipal")` | `packages/contracts/src/org-world.ts` | ①②：`it` 名说的是「契约**包**里不存在平行身份类型」，实际只读**一个文件** ⇒ 有人在 `contracts/src/person.ts` 加 `PersonSchema` 照绿（**假绿**，而那正是它唯一想拦的事）；schema 搬文件则金丝雀不中、整条 it 假红 | 改为扫**契约包导出面**（`import * as contracts`）。静态复算：导出面 **800** 个 `*Schema`，五个禁用名（含 as-alias 形态）**零命中**，金丝雀 `OrgPrincipalSchema` 命中 |
| B2 | `org-world.test.ts:234` | `expect(idx).toContain("PrincipalSchema.extend(")` | 同上 | ①＋**它咬不住"是谁在 extend"**：同文件里任何**别的** schema 调一次 `.extend(` 它也绿，而 OrgPrincipal 可以是手抄的 | 改为断言 `.extend()` 的**键序前缀指纹**（结构判据，手抄 z.object 复现不了） |
| B3 | `befe-e-catalog-plan-publish…:209` | `toContain("publishPlan")` | `../src/pages/admin/CatalogPage.tsx` | ①②③（②-A…②-E 已 `renderApp` 端到端真跑） | 整树扫 + **调用形**探针 `publishPlan(`（裸名会咬中声明 `export const publishPlan = (`，还会撞上本仓真实存在的 `publishPlanBuilder`） |
| B4 | `…:210` | `toContain("updatePlan")` | 同上 | 同上 | 同上（`updatePlan(`） |
| B5 | `…:215` | ``toContain("/b/v1/catalog/plans/${encodeURIComponent(planId)}`")`` | `../src/api/endpoints.ts` | ①②：**实测本仓没有任何门要求 URL 住在 `endpoints.ts`** —— `check-backend-frontend-seam.mjs` 主流程走 `frontendProdFiles()` **整棵树**（见 §4 复核 R-1） | 整树扫 |
| B6 | `…:216` | ``toContain("…/publish`")`` | 同上 | 同 B5 | 整树扫 |
| B7 | `befe-e-opt-template-pool…:210` | `toContain("fetchOptTemplates")` | `../src/views/OptimizeWhatifView.tsx` | ①②③ | 整树扫 + **用法形**正则（见 §4 复核 R-2：`fetchOptTemplates(` 全仓 **0** 命中） |
| B8 | `…:211` | `toContain("retrieveOptTemplates")` | 同上 | 同上 | 同上 |
| B9 | `…:212` | `toContain("solveOptTemplate")` | 同上 | 同上 | 同上 |
| B10 | `befe-e-reconcile-queue…:175` | `toContain("fetchReconcileCandidates")` | `../src/pages/admin/PrototypeIntakePage.tsx` | ①②③ | 整树扫 + 用法形正则 |
| B11 | `…:176` | `toContain("resolveReconcileCandidate")` | 同上 | 同上 | 同上 |
| B12 | `…:178` | `toContain("c.prototypeColumn")` | 同上 | ①②③ —— 「屏上渲染的是 prototypeColumn 不是 undefined」在**同一文件 L65-69 已端到端断言过**（比对 `reconcile-col-*` 真 textContent） | 整树扫 |
| B13 | `befe-e-sim-checkpoint-rollback…:224` | ``toContain(`fetchSimCheckpoints`)`` | `../src/views/sim/SandboxView.tsx` | ①②③（①-A…①-D 真渲染 `<SandboxView/>` 并点回滚按钮） | 整树扫 + 用法形正则 |
| B14 | `…:225` | ``toContain(`simRollback`)`` | 同上 | 同上 | 同上 |
| B15 | `…:326` | `toContain("fetchSimPropagationRules")` | 同上 | ①②③ | 整树扫 + 用法形正则 |
| B16 | `befe-e-solver-governance…:228` | `toContain("generateProvisionalSolver")` | `../src/pages/admin/SolverReviewPage.tsx` | ①②③ | 整树扫 + 用法形正则 |
| B17 | `…:237` | `toContain("fetchSolverFieldRoles")` | `../src/pages/admin/SolversPage.tsx` | ①②③ | 整树扫 + 用法形正则 |
| B18 | `…:243` | ``toContain("/b/v1/solvers/${…}/references`")`` | `../src/api/endpoints.ts` | 同 B5（R-1） | 整树扫 |
| B19 | `…:244` | ``toContain("/a/v1/solvers/${…}/field-roles`")`` | 同上 | 同 B5 | 整树扫 |
| B20 | `befe-wire-d…:672` | `toContain("launchScenario(card.sNo")` | `../src/components/ScenarioLauncher/useScenarioLaunch.ts` | ①②，**且与同 `it` 内 `findInSrc` 的顶注自相矛盾**：一半按文件扫、一半按文件名钉 | 改走 `findInSrc` |
| B21 | `…:674` | `toContain("publishScenarioChain")` | `../src/pages/admin/ScenesPage.tsx` | 同上 | 改走 `findInSrc`（调用形） |
| B22 | `…:675` | `toContain("fetchScenarioClosure")` | 同上 | 同上 | 同上 |
| B23 | `…:687`（**一个站点**，循环 3 个 fn） | `for (const fn of […3]) expect(growth).toContain(fn)` | `../src/pages/admin/GrowthCockpitPage.tsx` | 同上 | `findInSrcRe` + 用法形正则 |
| B24 | `…:690`（**一个站点**，循环 5 个 fn） | `for (const fn of […5]) expect(org).toContain(fn)` | `../src/pages/admin/OrgWorldPage.tsx` | 同上 | 同上。⚠ `fetchOrgChart(` 全仓 **0** 命中，真实用法是 `queryFn: fetchOrgChart` —— 只按调用形写会得到一条**恒红**断言（R-2） |
| B25 | `process-wait.test.tsx:534` | `toContain("InstancePanel")` | `../src/views/process/ProcessWaitView.tsx` | ①②；它自称金丝雀，但背书的是两条**正向**断言 —— 正向 `toContain` 在空串上必然失败，本就不会「恒真」，故它不构成 A-1 | 整条 `it` 整树化，撤掉两条手写金丝雀（`checkedTree` 内建四条更硬且与主判据同源） |
| B26 | `process-wait.test.tsx:535` | `toContain("LABEL_TO_KEYS")` | `../src/store/eventInvalidation.ts` | 同上（**实测**无任何门要求 `LABEL_TO_KEYS` 住在该文件，见 §4 复核 R-3） | 同上 |
| B27 | `references-family…:229` | `toContain("REFERENCES_COPY")` | `../src/components/ReferencesPanel.tsx` | ①②，且**它度量不了 `it` 名说的那句话**：「面板只有**一份**实现」—— 复制一份到别处，原写法照绿 | 改为直接数份数 `toHaveLength(1)`（这才是那句话本身） |
| B28 | `references-family…:252` | `toContain("fetchReferences")` | `../src/api/endpoints.ts` | ①②；它背书的否定（「不许再出现 `fetchXxxReferences`」）**整树化后更强**，不是更弱 | 整树扫（否定与金丝雀**一并**整树化，保持同扫描面） |
| B29 | `references-family…:257` | ``toContain("/b/v1/agents/${…}/references`")`` | 同上 | 同 B5（R-1） | 整树扫 |
| B30 | `references-family…:258` | ``toContain("/a/v1/ontology/slices/${…}/references`")`` | 同上 | 同 B5 | 整树扫 |
| B31 | `references-family…:290` | `toContain("export async function computeReferences")` | `apps/agentcore/src/resources.ts` | ①②；背书的否定（「后端没有 `kind === "scene-entry"` 分支」）整树化后更强 | 整树扫 `apps/agentcore/src` |
| B32 | `references-family…:297` | `toContain("REFERENCE_SOURCES")` | `../src/api/endpoints.ts` | 同上 | 整树扫 |

> **计数口径**：一条 = 门的**一个 expect 站点**。B23 / B24 各是**一个**站点（`for` 循环里的
> 单条 `expect`，门把循环变量还原成了字面量清单），不按循环展开算 3 条 / 5 条 ——
> 否则 A/B 分母对不上门报的 42。

### 3.3 顺手清掉的两处**已经在假绿**（不在 42 条内，但同族）

| 位置 | 事实 |
|---|---|
| `references-family…:294`（原）`expect(backend).toContain("scene-entry：无被引用方")` | 该串**只存在于注释里**（`apps/agentcore/src/resources.ts:279` 的行注释）。原写法不剥注释所以是绿的；剥注释后**可执行代码里 0 命中**。已撤（「后端没有该分支」由那条否定断言承担，比它硬） |
| `befe-e-sim-checkpoint-rollback` 的 `/a/v1/sim/propagation-rules` | 裸路径全树 **5** 命中，其中 **4 条是散文**（`zh.ts` 长文案 · `EdgeActivePanel.tsx` 的 `<code>` 说明）。散文里**提到**一条路由 ≠ 前端在**调**它（同 `check-backend-frontend-seam.mjs` 的 `isProseString` 戒律）。探针改带 `?published=`，只剩 `endpoints.ts:705` 那一处真调用 |

---

## 4 · 三个"差点下错结论"的复核（铁律 0.5：grep 不是结论）

### R-1 · 差点把 endpoints.ts 判成"URL 单源"（会让 6 条 B 被误判成 A）

`grep endpoints.ts scripts/` 命中 `check-backend-frontend-seam.mjs:686`：

```js
const src = existsSync(join(ROOT, "apps/frontend-shell/src/api/endpoints.ts")) ? readFileSync(…) : "";
const paths = extractFrontendPaths(src);
```

看上去像"befe-seam 门只从 `endpoints.ts` 取前端调用面 ⇒ URL 搬走门就瞎 ⇒ 位置即事实"。
**再追一层就翻案**：那段在**金丝雀 C7b 块**里，不是主流程。主流程是：

```js
const prodFiles = frontendProdFiles();          // :853  —— walk(FE_SRC) 整棵树
for (const t of prodTexts) for (const p of extractFrontendPaths(t.src)) fePaths.add(p);   // :856
```

⇒ befe-seam 门**对 URL 住哪个文件完全不敏感**，「URL 必须在 endpoints.ts」**不是本仓的硬约束**。
形态：**「我用『某门的代码里提到这个文件』当作『该门要求内容住在这个文件』的证据。」**

### R-2 · 差点写出一条恒红断言（用法形 ≠ 调用形）

按门"修法③"的样板 `/(?<!function\s)\bfoo\s*\(/` 写调用形探针，实测：

| 探针 | 全树命中 |
|---|---|
| `fetchOptTemplates(` | **0** |
| `fetchOrgChart(` / `fetchOrgAuthorities(` / `fetchOrgDelegations(` | **0** |

真实用法是 react-query 的**引用传递**：`useQuery({ queryKey: […], queryFn: fetchOrgChart })`。
只按调用形写，这 4 条会变成**恒红**。故探针改为两种用法一次收：
`/(?:queryFn|mutationFn):\s*<fn>\b|\b<fn>\s*\(/`。

### R-3 · `LABEL_TO_KEYS` 出现在 `gate-ledger.json` 的 `guardedPaths` 里

`apps/frontend-shell/src/store/eventInvalidation.ts` 确实在 befe-seam 门的 `guardedPaths` 中。
但 `guardedPaths` 是**"改了这些路径就要跑这道门"**的触发清单，**不是**"这些符号必须住在这里"。
逐条读过该门对 `eventInvalidation.ts` 的两处引用 —— 都在**注释**里（`:276` / `:723`），无代码依赖。

---

## 5 · 门的三条退出码实测（RC=0 / 1 / 2）

### RC=0 —— 终态

```
· 扫描面（现算）：712 个测试文件 · 金丝雀 13/13 命中 · 来历样例 命中
· 位置锚：现存 11 条 · 基线豁免 11 条 · 新增 0 条 · 基线已失效 0 条
✅ factlock-anchor:check 通过（无新增位置锚事实锁）
GATE_RC=0
```

（现存 11 = 10 条本单登记 + 1 条既有 `transit-flow` 豁免。）

### RC=1 —— 真有新增位置锚

临时投一个病样 `apps/datacore/test/zz-factlock-rc1-probe.test.ts`
（`expect(readFileSync("apps/datacore/src/app.ts","utf8")).toContain("analyzeImpact(")`）：

```
· 扫描面（现算）：713 个测试文件 · 金丝雀 13/13 命中 · 来历样例 命中
· 位置锚：现存 12 条 · 基线豁免 11 条 · 新增 1 条 · 基线已失效 0 条

✗ factlock-anchor:check 未通过（新增 1 条位置锚事实锁）：
  - apps/datacore/test/zz-factlock-rc1-probe.test.ts:7  正向 toContain("analyzeImpact(")  ← 写死锚点 apps/datacore/src/app.ts
      key: apps/datacore/test/zz-factlock-rc1-probe.test.ts#8d3c33464dd6e0ca
RC1_DEMO_RC=1
```

样例已删除，删后复跑 RC=0。

### RC=2 —— 门自己坏了（同时是 §1 那条修复的变异反证）

把 `probeRaw` 改回修前的"括号内整段 slice"：

```
  ✗ 必咬 C7·多行尾逗号（prettier 格式化后的真实形状） → 命中 0 条（要求 ≥1）  ⛔ 没咬中
· 金丝雀 12/13 命中（现算，非写死）
⛔ factlock-anchor:check —— **门自己坏了**，本次结论作废
   金丝雀 12/13 —— 有必咬样例没咬中或必放样例被误咬
   ⚠ RC=2 只许读作「我没查出来」，**不许**读作「无位置锚 / 代码干净」。
MUTANT_RC=2
```

---

## 6 · 变异反证（B 类改写有没有牙）

**约束**：本单是禁跑 vitest 的轻画像，**一条 vitest 都没跑**。故变异反证做在**判据本体**上，
复用仓库自己的 `apps/frontend-shell/test/factlock.ts` —— 复验台只桩掉它的 `vitest` `expect`
与 `REPO_ROOT` 定位，`stripComments` / `srcCode` / `factHits` / 三条金丝雀**逐字未动**（sha256 自证）。

对**每一条**改写后的探针跑三态：

| 态 | 要求 | 结果 |
|---|---|---|
| ① 真树 | 必须命中（否则我刚写了一条恒红断言） | 57/57 ✓ |
| ② 拆掉真行为（删掉命中行） | 必须**不**命中（否则断言没牙） | 57/57 ✓ |
| ③ 只留注释（把命中行改成 `// …`） | 必须**不**命中（否则"提及 = 调用"的假绿又回来了） | 57/57 ✓ |

另跑 `esbuild` 解析全部 10 个改动文件（**只解析+类型擦除，不跑测试**），带一个故意写坏的金丝雀：

```
🐤 金丝雀（故意写坏的样例）RC=1  （必须非 0，否则这套语法检查本身是装饰品）
✓ …（10 个文件全过）
解析失败 0 个
```

> ⚠ **诚实边界（必须由审核方补齐）**：以上证明的是
> **「新判据在真树上成立、且有牙」＋「改动文件语法可解析」**。
> **没有**证明「vitest 跑起来是绿的」—— 类型层（`factHits` 的重载、`SHARED_NONE` 作用域、
> `import * as contracts` 在 datacore vitest 下的解析）与运行时只有真跑一次才算数。
> 本单画像禁跑 vitest，故这一步**留给审核方的四包门**。

---

## 7 · 拿不准 / 留给后续单

### U-1 · `process-instance-merge.seam.test.ts:297`（表 A7）—— 本单**判据最弱**的一条

**两面都写清楚，不藏**：

- **判 A 的理由**：⑥ 是一条**诚实位台账复核**。前一张工单登记的边界原文是
  「`sim/impact-analysis.ts` 的 `instanceLevel` 硬写 `available:false`」，本条查合并没有把这句
  不好看的话偷偷删掉。台账条目的**主语就是那个模块**，故文件名是命题的一部分
  （与既有豁免 `transit-flow`「契约侧单源 = 只有 `procurement.ts` 一份」同族）。
- **判 B 的理由（我认为更有力，只是本单验不了）**：它**不满足 A-1** —— 同 `it` 内没有任何
  否定断言给它背书（另两条 `available: false as const` / `missingCarrier: "ProcessInstance"`
  也是正向，只是探针不是符号形所以门没咬）。而挪到别的文件，**产品一点没坏**。
- **真正的修法**：把这三条一起换成**运行时**断言 —— 打 `POST /a/v1/simulation/impact-analysis`
  （路由在 `apps/datacore/src/app.ts:2071`），断言
  `affectedProcesses.instanceLevel.available === false` 且 `missingCarrier === "ProcessInstance"`。
  样板见 `apps/datacore/test/impact-propagation.seam.test.ts:136`（同款 `t.app.inject`）。
- **为什么本单没做**：需要在该 `it` 里新建 sim world + change payload，**改完必须真跑一遍**才敢交，
  而本单画像禁跑 vitest。**登记基线不是给它发免死金牌** —— 基线里的 `verdict` 已逐字写明它不满足 A-1。

### U-2 · `org-world.test.ts` 契约包导出面的阈值 `> 100`

静态复算导出面是 **800** 个 `*Schema`，阈值 `100` 有 8 倍余量。
但这是**静态**算出来的（`index.ts` 的 85 条 `export *` × 各文件 `export const *Schema`），
不是真 import 出来的 —— `packages/contracts/dist` 当前不存在，而本单不许 build。
若审核方跑门时该断言红在这一行，那是 barrel 解析问题，不是"契约包真没有 100 个 schema"。

### U-3 · `factlock.ts` 住在 `apps/frontend-shell/test/`，datacore 测试用不了

它是**仓库级**工具（`srcCode("apps/datacore/src")` 这种调用满仓都是），却住在某一个 app 的
test 目录里。datacore 测试要整树扫就得跨 app 相对 import —— 会撞 `contracts-only-shared`
与 vite 的 `server.fs.allow`。本单因此对 datacore 的两条 B（B1/B2）改用了**运行时判据**
（导出面 + 结构指纹）绕开，没有引入第二份 `factlock` 实现。
**建议后续单**：把它提到 `packages/` 下的测试工具包，或明确认定"datacore 侧一律用运行时判据"。

### U-4 · `A-1` 这条判据本身没有机器守卫

「金丝雀必须与它背书的否定断言同扫描面」目前只写在本文档和基线的 `why` 里 ——
**写在文档里的纪律不是机制**（`docs/SOP-reviewer-claim-discipline.md` 第 11 条错账原话）。
今天有 4 条 A 靠它。若后续有人把某条否定断言整树化却忘了同步它的金丝雀，没有任何东西会报警。
**建议后续单**：给门加一条检查 —— 基线里 `verdict` 含"金丝雀同锚"的条目，
其所在 `it` 必须仍存在锚在同一文件上的 `not.toContain` / `toEqual([])`，否则该豁免自动失效。

---

## 8 · 复验命令

```bash
node scripts/check-factlock-anchor.mjs            # RC=0
node scripts/check-factlock-anchor.mjs --selftest # 金丝雀 13/13 + 扫描面下界
node scripts/check-factlock-anchor.mjs --report   # 现存 11 条逐条 + 豁免状态
```
