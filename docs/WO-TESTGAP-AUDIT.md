# WO-TESTGAP-BACKFILL · 取证半（欠账 #73）

> **本文是取证单，不是执行单**：只出清单、分类、证据、排序与建议修法。
> 本轮**未写任何测试、未改任何生产代码、未跑 `scripts/gate.sh`、未跑全量 datacore vitest**（审核方 gate 正占着 datacore）。
>
> - canonical 口径：`origin/claude/wave4-integration` @ `c0b7ee0d`（本文全部探测均对**已提交 ref**，不读工作区）
> - 取证日期：2026-08-06
> - 前一轮定性产物：`docs/TESTGAP-TRIAGE.md`（2026-08-04，canonical 为 `origin/claude/inspiring-gates-aqczjg` @ `d4be4224`）。
>   本文**不是**它的复制：canonical 已前进 86 个 commit，清单变了，且本文用的是**另一套分类口径**（按"实现今天的覆盖态"分，而非按"这个测试文件怎么处置"分）。

---

## 0 · 三句话结论

1. **登记的「18 个文件」今天是 22 个**（实测 · §1）。而且 **「18」这个数从一开始就不是文件数**——
   它是前一轮文档里「20 个文件，分布在 **18 条** handoff 分支」的**分支数**被转录成了文件数。今天是 **22 个文件 / 23 条分支**。
2. **病名「实现在正线、咬它的测试不在」对 22 个里只有 3 个成立。** 其余 19 个是**另外两种病**——
   14 个是「实现也不在正线」（整单未并，补测试必红），5 个是「实现在、测试也在，只是换了文件名/更强的版本」。
   三者修法完全不同，**混着做必然做错**（这正是 CLAUDE.md 铁律 0.5 的判据①）。
3. **真正符合病名的东西，大部分不在这 22 个文件里。** 我沿链路追的时候另挖出 **2 处**「实现在正线、生产路径真走、零断言」的缺口——
   其中 **P0 那处是部署态 demo 每次启动都会走的代码**，而所有咬它的测试走的是同一个 `if` 的**另一条分支**。
   删掉那段实现，四包 gate 全绿，部署出来的东西坏掉。
   **根因还更早**：`082186ef`(2026-07-14) 把生产从 B 路切到 A 路，**测试没跟着切** ——
   套件三周来验证的是一条生产已经不走的路。这是本轮唯一一个我认为**值得单独设门**的形态（见附录断点）。

---

## 1 · 今天的真实清单（22 个 · 实测）

**取数方式**（可复现）：

```bash
node scripts/check-handoff-integration.mjs --canonical origin/claude/wave4-integration --days 21 --json
# RC=1（预期：有 PENDING 分支未在台账登记，非本文关心）
# 取 rows[].missing 里匹配 /\.(test|spec)\.(ts|tsx)$/ 的项，去重
```

| 实测量 | 值 |
|---|---:|
| 缺失测试文件（去重） | **22** |
| 涉及 handoff 分支 | **23** |
| 分支态分布 | REVIEW 146 · PENDING 28 · INTEGRATED 33 |

**与登记（"18 个文件"）的差异 = 2 个新增 + 转录错误**。前一轮（08-04）是 20 个；今天多出的两个：

| 新增文件 | 分支 | 为什么现在才出现 |
|---|---|---|
| `apps/agentcore/test/qos-nl-robust.test.ts` | `claude/handoff-wo-nl-robust` | 08-04 之后才推上来的分支 |
| `apps/datacore/test/modeling-provenance.test.ts` | `claude/handoff-wo-modeling-interactive` | 同上 —— **而且它是本轮头号发现，见 §4 P0** |

> **对台账的建议**（本文不改台账）：`docs/HANDOFF-LEDGER.md:23` 的「27 个是测试（去重 21 个）」与
> 欠账 #73 的「18 个文件」都已过期。这个数**每周都会变**，登记里写死一个数必然过期 ——
> 建议登记改为写**取数命令**而不是写数字，或让台账门直接把该数打进产物。

---

## 2 · ⚠ 方法学：两个会让整篇取证失效的坑（本轮**真踩到**，都是铁律 0.5 的形态）

写在最前面，因为**下一个人不知道这两条就会得出相反的结论**。

### 坑 1 · `git grep -- "apps/*/src"` 恒零命中（会把"存在"误判成"零命中"）

git 的 **pathspec** 里 `*` **不跨 `/`**。所以对着一个 ref 做 `git grep -F <sym> <ref> -- "apps/*/src"` 时，
pathspec 匹配不到任何路径，**任何符号都返回 0**。实测：

```
$ git grep -c -w ScriptedLlmClient origin/claude/wave4-integration -- "apps/*/src"
（无输出 → 看起来"零命中"）

$ git grep -c -w ScriptedLlmClient origin/claude/wave4-integration -- "apps/*/src/**"
origin/claude/wave4-integration:apps/agentcore/src/llm/mock.ts:2      ← 实际存在
```

我第一版探针就是这么写的，据此差点判 `ScriptedLlmClient` 未并线 ——
而它就在 `apps/agentcore/src/llm/mock.ts:39`。**本文全部探测已改为显式列目录**
（`apps/agentcore/src apps/datacore/src apps/frontend-shell/src packages/contracts/src packages/llm-adapters/src`）。

> 注意 CLAUDE.md 铁律 0.5 里写的 `grep -rn <sym> apps/*/src packages/*/src` **是对的** ——
> 那是**不带引号的 shell glob**，由 shell 展开成真实目录。坑只在**引号包起来交给 git 当 pathspec** 时才出现。
> 两种写法长得几乎一样，这是它阴的地方。
>
> **我没有去认定前一轮 `docs/TESTGAP-TRIAGE.md` 踩了这个坑**——它 §3 记的判据串是 `-- <dirs>`，
> 我无法从文档还原作者当时敲的是带引号还是不带引号的形式。我的处置是：**不指控，全部自己重验一遍**（§4 每条都是本轮新测的）。
> 重验结果是它的结论大体成立（见 §4 逐条），但这不改变"该重验"这个判断。

### 坑 2 · 三点 diff 显示为「+」≠ canonical 没有

`git diff <canonical>...<branch>` 是从 **merge-base** 到 branch 的差异。若 canonical **独立地**（cherry-pick / 等价实现）
也长出了同样的代码，它**仍然显示为分支的 `+` 行**。

实测（本轮差点据此下反结论）：`git diff canonical...handoff-wo-modeling-interactive` 把
`setSourceBindings` 与 `materializedBindings` 整块显示为分支新增 → 看着像"实现没并"。
直接探 canonical 才发现 **它们已经在正线**：

```
apps/datacore/src/ontology.ts:222          async setSourceBindings(...)
apps/datacore/src/synthetic/service.ts:657 const materializedBindings = new Map<...>()
apps/datacore/src/synthetic/service.ts:1143 for (const [typeKey, b] of materializedBindings)
```

**判据**：要断言"canonical 有没有 X"，必须**直接探 canonical**（`git grep <sym> <canonical-ref> -- <显式目录>`），
永远不要从 diff 的方向反推。这一条正是把本轮 P0 从"整单未并"翻成"真无覆盖"的那一下。

### 坑 3 · 符号级 grep 会漏掉「行为被测了、只是没 import 这个符号」

`UNIT_DICTIONARY` 在 `apps/*/test` 符号级 **0 命中**，我一度把它列进"实现在正线·零测试"。
再追一层（探它的**报错文案**而非符号名）：

```
apps/datacore/test/ontology-governance.test.ts:311  it("G10: object-type 未知单位被拒；KPI/属性带单位元数据")
apps/datacore/test/ontology-governance.test.ts:327  // 未知单位 → 400
```

**行为有覆盖，只是测试不 import 那个常量。** 已从清单剔除（§3「不该有测试」类）。
所以 §4 里每一条"零测试"的判定，我都**同时探了符号名和行为文案/端点**，两者皆 0 才敢写零。

---

## 3 · 分类口径与总表

工单给的四分类，落到本欠账时**必须加第五类**——因为 22 个里最大的一堆根本不是测试问题：

| 类 | 判据 | 修法 | 本轮计数 |
|---|---|---|---:|
| **A · 真无覆盖** | 实现在 canonical **且生产路径真走到**，但符号与行为在 `apps/*/test` 双双 0 | 补测试 | **2** |
| **B · 有覆盖但咬的是组件不是链路** | 测试直接 import 该模块断言，生产路径没被驱动 | 补**可达门** | **0**（见下说明） |
| **C · 有覆盖但断言太弱** | 有等价测试，但少了具体分支/更强的判据 | 加强断言（补丁，不新增文件） | **4** |
| **D · 不该有测试 / 应丢弃** | 行为已被别处覆盖、或原文件与现语义冲突 | 从清单剔除并说明 | **2** |
| **E · ⛔ 实现也不在正线**（**新增类**） | 测试所依赖的符号/模块/迁移在 canonical 0 命中 | **不属本 WO** —— 这是"整单要不要并"的裁决 | **14** |

> **为什么 B 类是 0，而不是"我没找到"**：本仓刚为 F2/F3/F4 建了 `scripts/check-view-reachable.mjs`（视图可达门），
> 它已经把 `apps/frontend-shell/src/views/**` 的孤儿模块机器化了。本欠账这 22 个文件里，
> 前端只有 3 个（`admin-plan-builder` / `gray-node-autofill-seam` / `schema-readability-view`），
> 而这 3 个的**实现根本不在 canonical**（E 类）——没有模块，也就谈不上"模块没接线"。
> 所以 B 类为 0 是**这批文件的性质决定的**，不是漏查。
> **但**：这不等于全仓没有 B 类。可达门只管 `views/`，`router/` `solvers/` 等目录今天没有同类门 ——
> 那是另一张 WO 的事，我在 §6 记为未查项，不冒充查过。

### 总表

| # | 文件 | 类 | 一句话 |
|---:|---|:--:|---|
| 1 | `datacore/test/modeling-provenance.test.ts` | **A** | 实现在正线且部署态每次都走；咬它的测试走的是同一个 `if` 的另一分支 |
| 2 | `agentcore/test/multi-intent-seam.test.ts`（残条 R7） | **A** | R7 partial 诚实分支实现在正线，符号+文案双 0 |
| 3 | `agentcore/test/e2e-dialogue-acceptance.test.ts` | **C** | 唯一整文件可补并者；独有价值 = S7 效果层 |
| 4 | `agentcore/test/deterministic-multi-domain-seam.test.ts` | **C** | 被更强的 `qos-cross-domain-seam` 取代，残 1 条分支 |
| 5 | `datacore/test/metric-aware-composition.test.ts` | **C** | 被 `ceo-data2-seam` 严格取代，残 2 条 |
| 6 | `agentcore/test/multi-intent-seam.test.ts`（其余） | **C/D** | 模块已重构消失，原文件丢弃；残条并入 #2/#4 |
| 7 | `agentcore/test/tier2-bc-route.test.ts` | **D** | 7 条断言全被覆盖，且含 1 条**与现语义冲突**的 → 丢弃 |
| 8 | `datacore/test/causal-deepchain.test.ts` | **E** | `cf-oee-deficit` 全仓 0 |
| 9 | `datacore/test/gap-attribution-metric-aware.test.ts` | **E** | `boundMetricKeys` 只有前向兼容读处，零写入方 |
| 10 | `datacore/test/geo-real-signal.test.ts` | **E** | 种子里 `provenanceSynthetic: true` 硬编码，无"翻真"通路 |
| 11 | `datacore/test/plankpi-month-quarter.test.ts` | **E** | `demand_attain_2026-Q1` 全仓 0 |
| 12 | `datacore/test/sim-action-propagation.test.ts` | **E** | `ActionPropagationRule` 全仓 0 |
| 13 | `datacore/test/column-security.test.ts` | **E** | `propertyPolicy`/`PROPERTY_FORBIDDEN`/`SOLVER_COLUMN_RESTRICTED` 全 0 |
| 14 | `datacore/test/ontology-signature.seam.test.ts` | **E** | 模块 + 配套 recorder 均缺 |
| 15 | `datacore/test/object-interface.seam.test.ts` | **E** | 模块 + 迁移均缺 |
| 16 | `datacore/test/rules-first-class-seam.test.ts` | **E** | 台账已独立退单，互相印证 |
| 17 | `datacore/test/schema-readability-seam.test.ts` | **E** | `synthetic/ontology-readability.ts` 整文件缺 |
| 18 | `frontend-shell/test/schema-readability-view.test.tsx` | **E** | 同 17（前端半） |
| 19 | `agentcore/test/plan-builder.test.ts` | **E** | `plan_builder` 全仓 0 |
| 20 | `frontend-shell/test/admin-plan-builder.test.tsx` | **E** | 同 19（前端半） |
| 21 | `frontend-shell/test/gray-node-autofill-seam.test.tsx` | **E** | `gray-node-*` testid 全仓 0 |
| 22 | `agentcore/test/qos-nl-wiring-seam.test.ts` | **E** | `classifier-failsafe` 全仓 0 |
| 23 | `agentcore/test/qos-nl-robust.test.ts` | **E** | `nl-solver-route` 全仓 0（**新增文件**） |

（行数 23 是因为 `multi-intent-seam.test.ts` 一个文件跨 A 与 C/D 两类，拆两行记。文件仍是 22 个。）

---

## 4 · 逐条证据

### A 类 · 真无覆盖（实现在正线 · 生产路径真走 · 零断言）

#### 【P0】`apps/datacore/test/modeling-provenance.test.ts` — 对象类型来源回填（A 路）

**分支** `claude/handoff-wo-modeling-interactive` · 75 行 · 2 例

**实现在 canonical（追到声明点 + 调用点）**：

| 件 | canonical file:line |
|---|---|
| 回填方法 | `apps/datacore/src/ontology.ts:222` `async setSourceBindings(ctx, key, sourceBindings)` |
| 采集来源 | `apps/datacore/src/synthetic/service.ts:657` `const materializedBindings = new Map<...>()` |
| 写入点 | `apps/datacore/src/synthetic/service.ts:683` `materializedBindings.set(type, {...})` |
| **回填执行** | `apps/datacore/src/synthetic/service.ts:1142-1148`，包在 `if (!chainMode) { ... }` 里 |

**生产路径真走（这是本条的命门，追了两层）**：

```
apps/datacore/src/seed.ts:92（函数 seedDemoSynthetic）
  await synthetic.runJob(ctx, { industry: "battery-manufacturing", scale: "S", seed: 42, livedIn,
                                viaModelingChain: false });     ← A 路
apps/datacore/src/synthetic/service.ts:201
  await this.instantiateBattery(ctx, seed, input.scale, origin, input.viaModelingChain === true);
                                                                 ← chainMode = false
apps/datacore/src/synthetic/service.ts:1142
  if (!chainMode) { ...回填... }                                 ← 真执行
```

`seed.ts` 就是 `SEED_DEMO` 的种子路径 —— **部署态 demo 每次启动都会跑这段回填**。

**零断言（符号 + 行为都探了）**：

| 探测 | `apps/*/test` 命中 |
|---|---:|
| `setSourceBindings` | **0** |
| `materializedBindings` | **0** |

**排除了全部三个看起来像取代者的现有测试**（逐个追到判据，非只看文件名）：

| 现有测试 | 断言什么 | 为什么**不**覆盖本条 |
|---|---|---|
| `demo-chain-provenance.test.ts:52`<br>`expect(ty.sourceBindings.length).toBeGreaterThan(0)` | 物化类型 sourceBindings 非空 | 它**只有 2 个用例**（`:12` `:72`），**都传 `viaModelingChain: true`** → `chainMode===true` → **正好被 `if (!chainMode)` 跳过**。它测的是回填**没跑**的那条路 |
| `planviews.test.ts:230-233`<br>`order.lineage.dataset === "erp_sales_orders"` | Order 的血缘数据集 | `Order` **在 BINDINGS 表里**（`synthetic/battery.ts:1623`）→ 它的 `sourceBindings` 出厂即非空 → 被回填的 `if ((ty.sourceBindings?.length ?? 0) === 0)` 守卫**跳过**。回填真正要填的是 BINDINGS **没覆盖**的类型（`Material` / `AnnualScenario` / 全部 `extendedObjectTypes`） |
| `modeling.test.ts:102 OM1` | publish 后 sourceBindings | 走的是**交互建模链**（`uploadCsv` → `/a/v1/modeling/suggest` → publish），与合成 A 路完全不同的代码路径 |

**而且这条缺口不是"新写的代码还没来得及配测试"，是"测试守着一条生产已经不走的路"**（实测）：

```
commit 082186ef  2026-07-14  「恢复工作区修改（vite proxy / seed fix / Phase2 扩展 / 本体同步）」
- viaModelingChain: true
+ viaModelingChain: false          ← 生产从 B 路切到 A 路
```

该 commit **只改了这一行，没动上面那两行注释** —— 于是 `seed.ts:90-91` 至今仍写着
「demo 本体经真建模链产出…类型 sourceBindings 真由 publish 读真 rawDataset 算出，非短路直注」，
**描述的是生产 2026-07-14 起就不再走的 B 路**。
`demo-chain-provenance.test.ts` 也停在 B 路 —— **三周来它一直在验证一条已经废弃的路径**。
`WO-MODELING-INTERACTIVE` 那个 A 路回填之所以需要存在，正是这次切换的后果；而它落地时零测试。

> **这就是本欠账病名的教科书形态**：实现在正线、生产走它、测试也有一条长得很像的 ——
> 但那条测试咬的是**同一个 `if` 的另一条分支**。
> **失效场景是实的**：今天谁把 `service.ts:1142-1148` 整段删掉，
> `demo-chain-provenance` 照绿、四包 gate 照全绿，而**部署出来的 demo 已发布本体重新大量"无来源"、
> 左栏合成数据集重新"未建模"**（这正是该 WO 的原始病症）。今天没有任何门会红。

**另一条附带证据**：测试 helper `seedBattery`（`apps/datacore/test/helpers.ts:58`）POST `/a/v1/synthetic/jobs`
时**不传** `viaModelingChain` → 全仓 ~692 个用它的测试点走的都是 A 路（回填真跑），
**但没有一个断言回填的结果** —— 覆盖率工具会显示这几行"被执行过"，而它们的**效果**从未被检查。
这是"行覆盖 ≠ 断言覆盖"的一个干净例子。

**建议修法**：补并原文件（它就是为这条写的，且只依赖 `makeApp`/`seedBattery`/`ADMIN`，无缺失符号）。
**工作量档位：S（半天以内）** —— 唯一需现场确认的是 `expect(materialized.length).toBeGreaterThanOrEqual(30)`
与 `["Material","AnnualScenario"]` 两处硬编码是否仍成立（canonical 类型数已演进）。

---

#### 【P1】`apps/agentcore/test/multi-intent-seam.test.ts` 的 R7 残条 — 多域并行的"单域失败"诚实分支

**分支** `claude/handoff-wo-multi-intent-p1`（原文件整体应丢弃，见 D 类；**只有这一条**是真空）

**实现在 canonical**：

```
apps/agentcore/src/router/multi-route.ts:152-156
  // R7 诚实 gap：该域未计算 + 原因（不 hallucinate·不占位假数）。
  return { type: "text", markdown:
    `## ${label}（${p.route.solverKey}）\n该域未计算（原因：${p.outcome}）——诚实标·不臆造。` };

apps/agentcore/src/router/l3-coupled.ts:170                       ← 同形态第二处
  blocks.push({ type:"text", markdown:`该环未计算（原因：${os.outcome}）——诚实标·不臆造。` });
```

**生产调用方（追一层）**：`assembleMultiDomainAnswer` 定义在 `multi-route.ts:125`，
生产调用点 `multi-route.ts:232`（在 `runParallelRoutes` 内）；
`runParallelRoutes` 被 ②确定性多域 / ⑤LLM 多意图 / L2 分解三条路共用
（`features/registry.ts:126,130,139` · `l2-decompose.ts:13`）。**是主干，不是旁支。**

**零断言（符号 + 三条行为文案都探了）**：

| 探测 | `apps/*/src` | `apps/*/test` |
|---|---:|---:|
| `该域未计算` | 2 | **0** |
| `该环未计算` | 1 | **0** |
| `诚实标·不臆造` | 2 | **0** |
| `parallelResults` | 6（含契约 `packages/contracts/src/qos.ts:261`） | **0** |

现有 `apps/agentcore/test/qos-cross-domain-seam.test.ts:94` **确实**直接 import 并调用了
`assembleMultiDomainAnswer` —— 但它构造的 products **全是 `ok:true`**（否则 `该域未计算` 不会是 0 命中）。
**成功路径有覆盖，失败路径一条都没有。**

> **失效场景是实的，而且是本仓最怕的那种"静默错答"**：多域并行里某个 solver 抛错时，
> 今天的实现会把该节标成"未计算（原因：…）"。若有人把它改成"跳过失败域不吭声"，
> 用户拿到的是一份**少了一节、但读起来完整**的答案 —— 没有任何门会红，
> 而用户不可能知道有一个域没算。这比 P0 更隐蔽（P0 至少页面上看得出"无来源"）。

**建议修法**：**不补并原文件**（它 import 的 `../src/router/multi-intent.js` 在 canonical 不存在，见 D 类），
改为给 `qos-cross-domain-seam.test.ts` 加一条：注入一个必抛的 solver → 断言
①该节 markdown 含"未计算"与原因 ②其余节照常出 ③`parallelResults[k].ok` 真分裂 ④不出跨域假综合措辞。
**工作量档位：M（1–2 天）** —— 要找到"让某一个域的 solver 定向失败"的注入点，比 P0 麻烦。

---

### C 类 · 有覆盖但断言太弱（补丁到现有取代者，不新增文件）

#### 【P2】`apps/agentcore/test/e2e-dialogue-acceptance.test.ts` — S7 效果层

**分支** `claude/handoff-wo-e2e-dialogue-acceptance` · 402 行 · 7 describe / 17 it
**它是 22 个里唯一"纯测试 WO"**（分支的 `differing` 只有 `docs/SYSTEM-ONTOLOGY.md`，零产品代码）。

**符号可用性：本轮逐个重探，全部在 canonical**（无一缺失）——
`projectNavigationSlice` / `renderNavigationSlice` / `navigationSliceSolverKeys`（src 8/6/5）·
`buildGrowthLoopWiring`（src 5）· `questionSlug`（src 5）· `ScriptedTurn`（src 3）· helpers 全在。

**独有价值 = S7 效果层（canonical 今天确实零覆盖，本轮重验）**：

| 层 | canonical 现状 |
|---|---|
| **运输层**（我们给模型下了指令） | `apps/agentcore/test/harness-elements.test.ts:45` 断言**提示词模板字符串**含 `["结果结构","结论","关键分析","证据","建议","风险"]` |
| **效果层**（模型产物真长这样） | `关键分析` 在 `apps/*/test` 命中数 = **1**，就是上面那行；**没有任何测试断言产出的 final_answer 真含这些段** |

`AGENT_EXPLORATORY` 虽在 21 处测试出现，但那是 trustLevel 断言，与"答案分段结构"是两回事。

**为什么排在 P2 而不是 P0**：它是 capstone（防的是"对话链整体退化"），
但**不咬任何具体的静默错答分支** —— P0/P1 各自对应一个"改坏了没人知道"的确定场景，价值更硬。

**建议修法**：整文件补并，删掉 `:18` 未使用的 `import { questionSlug }`。
**工作量档位：M（1–2 天）**，其中大半是**跑红了逐条按现语义修**——
风险点已知：`:134` `deterministic:ceo-route` 与 `:135` `ceo_root_cause` 落在 canonical 后来收窄过的
CEO 路由语义区（`tier2-semantic-route.test.ts:29` 把"毛利为什么下滑"从 `gap_attribution` 改判 `finance_pnl`）。
**必须先单跑再定，不许照搬本文当"已验证"**（见 §6）。

#### 【P3】`deterministic-multi-domain-seam.test.ts` 残条 — 无 PageContext 不冒进

取代者 `apps/agentcore/test/qos-cross-domain-seam.test.ts`（更强）。**残 1 条**：
`domainResolveMulti(q, undefined)` → `perDomainScore` 全 0 → 判 null。
实现分支在 `apps/agentcore/src/router/domain-resolver.ts` 的 `contextRich` 计算；
canonical 的 9 处 `domainResolveMulti(` 调用**全部传了 pageContext**，`undefined` 分支零覆盖。
**修法**：给取代者的纯函数 describe 加 4 行。**工作量：S**。

#### 【P4】`metric-aware-composition.test.ts` 残条 — R6 + HTTP 面

取代者 `apps/datacore/test/ceo-data2-seam.test.ts:115`（严格更强：5 指标 vs 4）。**残 2 条**：
① R6 两跑字节一致只在默认 metric 上（`gap-attribution.test.ts:94`），未覆盖 `market_share`；
② 运输层：canonical 零测试用 HTTP `POST /a/v1/solvers/gap_attribution/invoke` 打该 solver。
**工作量：S**。②按"SEAM > 效果层 > 运输层"口径排最末。

#### 【P5】`multi-intent-seam.test.ts` 其余残条 — 同 solver 去重 / compose 通道

`selectMultiIntent`（`multi-route.ts`，src 7 / test 4）的**同 solver 去重**分支零覆盖；
canonical SEAM-3 只断 `agentRequests===0`，**不断 `composeRequests`、不断延迟** → 推理档综合通道是敞的。
**工作量：S**，随 P1 一起做最省。

---

### D 类 · 不该有测试 / 应丢弃

#### `apps/agentcore/test/tier2-bc-route.test.ts` — **含与现语义冲突的断言，补并有害**

52 行 / 7 例，7 条断言 **100% 已被覆盖，0 条独有价值，1 条有害**：

```
缺失文件 :20   resolveCeoRoute("毛利为什么下滑").solverKey === "gap_attribution"
canonical      apps/agentcore/test/tier2-semantic-route.test.ts:29-35 断言的是 finance_pnl
               用例名直接写着「毛利/量价本利 → finance_pnl（不被『为什么』根因吞）」
```

`resolveCeoRoute` 在 canonical 覆盖充分（src 19 / test 68）。
**原样补并要么 CI 红，要么逼人把 `finance_pnl` 路由回退掉 —— 后者是拿更旧的设计盖回更新的，是真正的危险。**
**处置：丢弃，不留残条。工作量：0（只需在台账写明驳回理由）。**

#### `apps/agentcore/test/multi-intent-seam.test.ts` 原文件 — 模块已重构消失

`:4-10` 从 `../src/router/multi-intent.js` import。对 canonical 实测：

| 符号 | src | test |
|---|---:|---:|
| `apps/agentcore/src/router/multi-intent.ts`（模块） | **文件不存在** | — |
| `assembleMultiIntentAnswer` | **0** | 0 |
| `solversCoupled` | **0** | 0 |
| `MultiIntentCandidateInput` / `MultiIntentSubResult` | **0** | 0 |
| `selectMultiIntent` | 7（在 `multi-route.ts`，**签名与返回形状都不同**） | 4 |

**原文件整体丢弃**；其价值已拆进 P1 / P5。

#### 已剔除：`UNIT_DICTIONARY`

我一度把它当"实现在正线·零测试"（符号级 test=0）。追一层查行为文案后
命中 `apps/datacore/test/ontology-governance.test.ts:311` + `:327` —— **行为有覆盖**，剔除。详见 §2 坑 3。

---

### E 类 · ⛔ 实现也不在正线（14 个）—— **不属本 WO**

**共同判据**：测试依赖的符号/模块/迁移在 canonical `apps/{agentcore,datacore,frontend-shell}/src`、
`packages/*/src`、`apps/*/migrations` 命中数为 0（本轮用**显式目录** pathspec 重测，非沿用前一轮）。
**这些文件今天补并 = 必红。** 正确归属是 **WO-INTEGRATION-AUDIT（#9）判「整单要不要并」**。

| 文件 | 关键符号 | canonical 实测 |
|---|---|---|
| `causal-deepchain.test.ts` | `cf-oee-deficit` | src 0 / test 0 |
| `gap-attribution-metric-aware.test.ts` | `boundMetricKeys` | src **4 但全是读处**：`app.ts:2434` 自带注释「前向兼容 metric-aware-gap·未种=空」；`app.ts:2445` 注释「metric-aware-gap **合** + data agent 种后填」＝明说没合。**零写入方**。现有 `ext-signal-references.test.ts:50` 反过来断言它**恒空** → 属铁律 0.5 的「接了线没数据」态 |
| `geo-real-signal.test.ts` | `provenanceSynthetic` 翻真 | 种子 `battery-extended.ts:324` 是**硬编码 `provenanceSynthetic: true`**；`app.ts:2433` 直接 `Boolean(p.provenanceSynthetic)` —— **无任何"真源覆盖→翻 false"通路**。（`buildSynthProvenancePredicate` 确在 `solvers/service.ts:4145` 且已接线 `app.ts:3514`，但**没接到这条链上**）；`rds_real_market_feed` src 0 |
| `plankpi-month-quarter.test.ts` | `demand_attain_2026-Q1` | src 0 / test 0（`demand_attain` 年级实例在，月/季实例不在） |
| `sim-action-propagation.test.ts` | `ActionPropagationRule` | src 0 / test 0 / migrations 0 |
| `column-security.test.ts` | `propertyPolicy` · `PROPERTY_FORBIDDEN` · `SOLVER_COLUMN_RESTRICTED` | 三者 src 0 / test 0 |
| `ontology-signature.seam.test.ts` | `solvers/ontology-signature.ts` · `SOLVER_ONTOLOGY_SIGNATURES` · `mergeReadSurfaces` · `installReadRecorder` · `observedReadSurface` | 模块**文件不存在**；配套 `test/ontology-signature.recorder.ts` 也缺；符号全 0 |
| `object-interface.seam.test.ts` | `BATTERY_OBJECT_INTERFACES` · `BATTERY_TYPE_INTERFACE_BINDINGS` · `SOLVER_ONTOLOGY_SIGNATURES` | 全 0；依赖的 `solvers/ontology-signature.ts` 同样缺 |
| `rules-first-class-seam.test.ts` | `solver_rule_bindings` · `readRuleParam` · `thresholdProvenance` · `publishRuleOverride` | 全 0（含 migrations）。**台账 `HANDOFF-LEDGER.md:120` 已独立退单并列明"真正尚缺的只有这三样"—— 与本轮互相印证** |
| `schema-readability-seam.test.ts` | `synthetic/ontology-readability.ts` · `PROP_READABILITY` · `TYPE_BUSINESS_DEFINITIONS` · `applyPropReadability` · `catalogUnits` | 模块**文件不存在**；符号全 0 |
| `schema-readability-view.test.tsx` | 同上（前端半） | 同上 |
| `plan-builder.test.ts` | `plan_builder` · `planBuilder` | src 0 / test 0（整目录 `src/plan-builder/` 缺 + 迁移缺） |
| `admin-plan-builder.test.tsx` | 同上（前端半） | 同上 |
| `gray-node-autofill-seam.test.tsx` | `gray-node-` testid 前缀 | src 0 / test 0 |
| `qos-nl-wiring-seam.test.ts` | `classifier-failsafe` | src 0 / test 0 |
| `qos-nl-robust.test.ts` ★新 | `nl-solver-route` | src 0 / test 0 |

（表 16 行 / 14 个文件：`schema-readability` 与 `plan-builder` 各占前后端两个文件，合为两单。）

> **对 `qos-nl-robust.test.ts`（新增）的额外说明**：它 import 的 `ScriptedLlmClient`
> **确实在 canonical**（`apps/agentcore/src/llm/mock.ts:39` —— 这正是 §2 坑 1 差点让我判错的那个）。
> 但它的核心断言是 `task.classification?.model` 含 `deterministic`（注释指名 `deterministic:nl-solver-route`），
> 而 `nl-solver-route` 全仓 0 命中 —— **helper 在、被测的病灶修复不在**。仍属 E 类。

---

## 5 · 排序 —— 按「修了能防住什么真实故障」

| 序 | 动作 | 防住的**具体**故障 | 类 | 档位 |
|---:|---|---|:--:|:--:|
| **P0** | 补并 `datacore/test/modeling-provenance.test.ts`<br>（**先确认 §6.6 的 A/B 路意图**） | 有人删/改 `synthetic/service.ts:1142-1148` 的 A 路回填 → **部署态 demo 的已发布本体重新大量"无来源"、数据源左栏重新"未建模"**，而四包 gate 全绿。三个看似取代者的测试全部被排除：`demo-chain-provenance` 走 `chainMode=true` 的另一分支、`planviews` 咬的 `Order` 被 BINDINGS 守卫跳过、`modeling.test.ts` 走交互链。**且生产 2026-07-14 就切到 A 路了，测试至今守着 B 路** | A | **S** |
| **P1** | 给 `qos-cross-domain-seam.test.ts` 补 R7 partial 失败域 SEAM | 有人把多域并行的失败域从"标未计算+原因"改成"静默跳过" → 用户拿到**少一节却读起来完整**的答案，无门会红。`该域未计算`/`该环未计算`/`parallelResults` 在测试里三双 0 | A | **M** |
| **P2** | 补并 `agentcore/test/e2e-dialogue-acceptance.test.ts` | 对话链 S1~S7 **今天没有任何端到端门**，各 WO 只测自己那半；S7 只测了提示词模板（运输层），没测产出结构（效果层） | C | **M** |
| **P3** | 给 `qos-cross-domain-seam.test.ts` 补 4 行 `domainResolveMulti(q, undefined)` | 无 PageContext 时**冒进**把开放题误降级给窄 solver → 自信错答。该 fail-safe 分支今天零覆盖 | C | **S** |
| **P4** | 随 P1 补：同 solver 去重 + `composeRequests===0` + 延迟 | 多意图路径**偷偷引入推理档综合**（成本与延迟回归），今天只断了 `agentRequests===0` | C | **S** |
| **P5** | 给 `ceo-data2-seam.test.ts` 补 `market_share` 的 R6 两跑 | 绑定后归因失去确定性（R6），今天只在默认 metric 上有 R6 | C | **S** |
| **P6** | 挑一条 datacore 测试改走 HTTP `/a/v1/solvers/gap_attribution/invoke` | 求解器 HTTP 面零覆盖（**运输层**，故排最后） | C | **S** |
| — | `tier2-bc-route.test.ts` **驳回**、`multi-intent-seam.test.ts` **丢弃** | 补并会把更旧的路由设计盖回更新的 | D | 0 |
| — | E 类 14 个 → **转 WO-INTEGRATION-AUDIT（#9）** | 不是测试问题，是"整单要不要并"的裁决 | E | 不属本 WO |

**排序理由（不是按文件大小或字母序）**：
P0/P1 是 **A 类**——它们各自对应一个"改坏了今天没有任何门会红"的**确定**场景，且**都在生产主干上**
（P0 在部署态 demo 启动路径，P1 在 ②/⑤/L2 三条路共用的装配器）。
P2 虽是最大的文件（402 行）且是 capstone，但它防的是"整体退化"这种弥散风险，不咬具体分支，故让位。
P3–P6 都是补丁到现有取代者，风险面依次递减，运输层排最末。

---

## 6 · 我没做 / 没查动的（诚实边界）

1. **我没有运行任何一个缺失测试文件。** 范围边界禁止跑全量 datacore vitest（审核方 gate 正占着），
   我也**没有**单跑其中任何一个 —— 因为它们都不在工作树里，要跑必须先落盘，那就越过了"不写测试"的边界。
   所以本文**全部结论是静态取证**（对已提交 ref 的符号/文案/调用链探测），**没有一条是"跑过所以绿"**。
   - 直接后果：**P0 与 P2 补并后是否一次绿，我不知道。** P0 的风险点是
     `expect(materialized.length).toBeGreaterThanOrEqual(30)` 与 `["Material","AnnualScenario"]` 两处硬编码；
     P2 的风险点是 `:134`/`:135` 两条 CEO 路由断言（canonical 已收窄过该语义）。
     **执行的 dev 必须先单跑再定，红了逐条按现语义改并在 PR 里说明理由。**
2. **B 类（有覆盖但咬组件不是链路）我只能对这 22 个文件说"是 0"。** 全仓有没有 B 类，我**没查** ——
   `check-view-reachable.mjs` 只管 `frontend-shell/src/views/`，`router/`、`solvers/`、`agent/` 等目录
   今天没有同类可达门。「这些目录里有没有 F2/F3/F4 那种孤儿模块」是一个**独立且可能有货**的问题，
   本轮没做，不冒充做过。
3. **E 类那 14 个"该不该并"，我不给建议。** 本文只证明了**今天不能单独补测试**。
   要判"这个特性要不要"，得读各自的 PRD 意图，超出取证范围。
   （`wo-66` 台账已退单、`wo-aip-cap0` 台账已判整块未并 —— 这两条台账已有结论。）
4. **前一轮 `TESTGAP-TRIAGE.md` 是否踩了 §2 坑 1，我查不动。** 文档记的判据串是 `-- <dirs>`，
   从文本还原不出作者敲的是带引号（会坏）还是不带引号（正常）的形式。
   我的处置是全部重验而非指控 —— 重验结论与它大体一致。
5. **一个顺手挖到、但不属本欠账的缺口**（不展开，留给别人）：
   `apps/datacore/src/app.ts:2153` 与 `ontology-governance.ts:566` 的**归域 FK 校验**报错文案
   `未知域` 在 `apps/*/test` **0 命中** —— 与被剔除的 `UNIT_DICTIONARY` 是同一个路由（`POST /a/v1/ontology/object-types`）
   上紧挨着的两道校验，一道有测试、一道没有。我**没有**进一步追它是否被别的断言间接咬到，
   所以这是**线索不是结论**（铁律 0.5）。
6. **`seed.ts:90-91` 的注释与代码矛盾，我只做了定性、没做处置建议。**
   实测 `082186ef`（2026-07-14）把 `viaModelingChain` 从 `true` 翻成 `false` 却没动注释（证据见 §4 P0）。
   **我不知道这次翻转是有意的还是回滚事故** —— commit message 是"恢复工作区修改"这种含糊措辞，
   且一次动了 vite proxy / seed / Phase2 / 本体四件事，从中读不出意图。
   这直接决定 P0 之外的一个问题：**demo 到底应该走 A 路还是 B 路**？
   若本该走 B 路，那 P0 补的测试就锁错了行为。**执行 P0 前建议先向仓主确认这一条**，
   这是我在本轮唯一觉得"不问清楚可能会把测试写反"的地方。

---

## 附 · 本体引用与影响

- **对象类型**：`ObjectTypeDef.sourceBindings`（P0 · A 路回填零断言）· `CausalFactor`
  （`boundMetricKeys` 零写入方 = 「接了线没数据」态 · `provenanceSynthetic` 无翻真通路）·
  `Metric`（月/季 level 实例未并）· `ActionPropagationRule` / `ObjectInterface`（未并）
- **链路**：本体 §3 编排链 ②确定性多域 → ⑤LLM 多意图 → `runParallelRoutes`（**R7 partial 分支零测试**）·
  合成种子链 `seed.ts:92 → runJob → instantiateBattery(A 路) → setSourceBindings`（**零断言**）·
  对话链 S1~S7（**无端到端门**）
- **不变量**：**R6**（确定性字节一致 —— P3/P5 两条残条均围绕它）· **R7**（partial 诚实 —— **今天没门**，P1）·
  R13（溯源 ⟦ref⟧）
- **断点**：本轮**新识别 1 个** —— `G-SEED-PROVENANCE-BACKFILL-UNASSERTED`：
  A 路 `sourceBindings` 回填**实现在、生产走、零断言**，而唯一相关测试走同一 `if` 的另一分支（B 路）。
  形态是 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 的**镜像**：那个是「有测试无生产调用方」，
  这个是「**有生产调用方无测试**」，且更阴——**行覆盖是满的，断言覆盖是空的**。
  与前一轮记的 `runParallelRoutes` R7 真空同属此形态（本轮复核仍成立，并新发现 `l3-coupled.ts:170` 同病第二处）。
  **成因值得单独记**：它不是"新代码漏配测试"，而是 `082186ef`(2026-07-14) 把生产从 B 路切到 A 路时，
  **测试没跟着切、注释也没跟着改** —— 于是测试套件三周来一直在验证一条生产已废弃的路径。
  这提示一种本仓尚未设门的假绿形态：**「分支开关翻转后，测试仍锁在旧分支上」**。
  可门化的判据：形如 `viaModelingChain` / `chainMode` 的路径开关，
  其**生产实参取值**应与**测试实参取值**的集合有交集；全无交集 = 测试在守废路 → 红。
  （本轮只提出判据，未实现该门 —— 属执行半。）
- **本文不改 `docs/SYSTEM-ONTOLOGY.md`**（取证单的范围边界）。
  若上述断点被接受，应由**执行半**的 WO 回写本体断点表 —— 本体不回写即过期失效（铁律 0）。
