# 本体图谱 · 数据模型与产生逻辑

> **这份文档存在的理由**：`docs/ontology-graph/` 曾经装着 **154,602 行 / 6.8 MB** 的 YAML，
> 其中 **97.4% 是机器生成的快照**。仓主的裁决是：
> 「**15 万行数据不应该进入代码，而是在后台数据库里面，但是需要对应 15 万行数据的产生的
> 逻辑，关系放到一个代码说明文档里面。**」
>
> 数据去了数据库（`migrations/041_ontology_graph.sql`），**产生它的逻辑与关系在这里**。
>
> 判据：**一个没读过 `extract.mjs` 一行源码的人，读完这份应当能回答**
> 「这 6,273 个原子从哪来 · 21,032 条边分几种 · 三态怎么算出来的 · 这套抽取看不见什么」。

**本文所有数字均为本次实测**（`generatedFrom = 0224325a`，TypeScript 5.9.3，抽取耗时 16.6–25.1s，峰值 RSS 2,205 MB）。
⚠ 数字会随代码库变 —— 见 §8「怎么重新量」。⛔ 别把本文的数当常量引用，要引就引产生它的**命令**。

---

## §0 · 三句话说清这是什么

| | |
|---|---|
| **它是什么** | 本仓 5 个 TS 包的**源码事实快照**：谁导出了什么、谁在用谁、谁声明了哪些字段、哪些符号属于哪条本体切片 |
| **它不是什么** | ⛔ 不是门、不是棘轮、不是基线。**没有红绿判定**，不进 `gate.sh`，不进 `package.json` 的 `gates` |
| **谁是真相源** | **源码**。图谱是投影，`docs/SYSTEM-ONTOLOGY.md`（人读的散文本体）是另一份平行投影，两者互不覆盖 |

它要回答的是一类**具体**的问题，而这类问题本仓每天都在答错：

> 「`X` 有没有消费方？」「这条链断在哪？」「派单里写的『只有 3 个求解器』对不对？」

CLAUDE.md 铁律 0.5 记着四次真实的误判，**其中三次是同一个病** —— 拿 `grep` 的直接命中数当结论。
图谱的用处就是把那个 grep 换成一次**编译器级**的查询。

---

## §1 · 数据来源：编译器，不是正则

### 1.1 为什么是 TS Compiler API

`grep` 数不清三类东西，而这三类恰好是本仓误判的高发区：

| grep 看不见的 | 后果（本仓真实案例） |
|---|---|
| **别名 import**（`import { X as Y }`） | 求解器 `globalSimOptimize` 被判「零生产调用方」，而 `solvers/service.ts:42` 别名导入 → `:3552` 真调用 |
| **动态 import 解构**（`const { f } = await import(...)`） | `mapMcpConfig` 被判零调用方，实际 `agentcore/src/engine.ts:634` 解构 → `:649` 真调用 |
| **路径别名**（`@/*`、`@platform/contracts`） | 未配 `paths` 时 contracts 解析到 `dist/*.d.ts`，跨包边**全丢** ⇒ 「contracts 整包是死代码」 |

抽取器用 `ts.createProgram` + `TypeChecker.getSymbolAtLocation` / `getAliasedSymbol`，
把**符号**（而不是字符串）当成节点，上面三类一次解决。

### 1.2 逐包建 program，不建全仓巨型 program

**5 个 program，不是 1 个**（`PACKAGES` 表：datacore · agentcore · frontend-shell · contracts · llm-adapters）。

实测（本次）：

| 包 | 文件 | src | test | 建 program | 累计 RSS |
|---|---:|---:|---:|---:|---:|
| datacore | 559 | 198 | 361 | 3,877 ms | 693 MB |
| agentcore | 332 | 117 | 215 | 2,437 ms | 1,047 MB |
| frontend-shell | 624 | 302 | 322 | 4,432 ms | 1,791 MB |
| contracts | 101 | 92 | 9 | 768 ms | 1,903 MB |
| llm-adapters | 10 | 10 | 0 | 856 ms | 2,034 MB |
| **合计** | **1,626** | **719** | **907** | — | **峰值 2,205 MB** |

理由是**内存**：五个 program 依次建、依次用完，峰值停在 2.2 GB。合并成一个全仓 program 会把这个数再推高，
而抽取器是个要在开发机上随手跑的脚本，不是 CI 专用件。

⚠ `packages/dsh-harness` **不在表里**：它是 vendored `.mjs`，没有 `src/` 的 TS 出口。见 §7 盲区 ⑥。

### 1.3 ⛔ 为什么不能用 `tsconfig.include`

抽取器**自己 walk `src/` + `test/`** 喂给 `createProgram`，并 `delete rootDir`，
**刻意不走** `parseJsonConfigFileContent(...).fileNames`。

原因是实测的：各包 `tsconfig.json` 的 `include` 本来就不是为"扫全仓"写的。

| 包 | `include` 实测值 | 走它的话 test 进不进 program |
|---|---|---|
| datacore | `["src"]` | ❌ 361 个测试文件全丢 |
| agentcore | `["src/**/*.ts"]` | ❌ 215 个全丢 |
| contracts | `["src"]` | ❌ 9 个全丢 |
| llm-adapters | `["src"]` | （本来就 0 个） |
| **frontend-shell** | **`["src", "test"]`** | ✅ 322 个**都在** |

> ⚠ **订正一处流传中的说法**：`extract.mjs` 文件头与 README 写的是
> 「`apps/*/tsconfig.json` 的 include 只有 `["src"]`，program 里**一个测试文件都没有**」——
> **对 4 个包成立，对 frontend-shell 不成立**（它自己就 include 了 `test`）。
> 实测影响：走 `tsconfig.include` 会丢掉 **585 / 907 = 64.5%** 的测试文件，不是 100%。
>
> 这个差别不是抠字眼：照"全都丢"去想，`test-only` 三态会被当成**整个**不可用；
> 照实测去想，**前端那一片是可用的、另外四个包不可用** —— 两种判断导出的动作完全不同。
> 形态（CLAUDE.md 铁律 0.6 句式）：
> **「我用『多数包是这样』当作『所有包都是这样』的证据，而前者并不度量后者。」**

**若这一步做错，屏上的症状是**：`asserts` 边接近 0、`test-only` 恒为 0、
`有 test 入边的原子数` 这条金丝雀报 0 —— 而它们读起来全都像「本仓没人写测试」。
金丝雀 ⑪（见 §6）就是为这一刻准备的。

### 1.4 `registers` 边要 `dist/`（软前置）

`registers` 的条目数**优先 import 已 build 的 `dist/` 真求值**，而不是数 AST。
没有 `dist/` 时它退化成 `confidence: "parsed"`，且**切片层整个跳过**。

所以跑之前要：

```bash
pnpm --filter @platform/contracts build \
  && pnpm --filter @platform/llm-adapters build \
  && pnpm --filter datacore build
```

理由见 §3 的 `registers` 行 —— 一句话：`ALL_SOLVER_CATALOG = [...A, ...B, ...C]`
**按 AST 数是 0，按求值是 63**。

---

## §2 · 四类实体与它们的字段

### 2.1 原子 `atom` —— 一个被导出的符号

`id` 格式：`` sym:<相对路径>#<符号名> ``，例如 `sym:apps/datacore/src/app.ts#buildSliceIndex`。
**快照内唯一**，即「同一个文件里的同名导出只有一个」。

| 字段 | 它**度量什么** |
|---|---|
| `id` | 符号的坐标身份（文件 + 名字）。⛔ 不是稳定 ID：文件改名它就变 |
| `name` | 导出名 |
| `kind` | 五值之一。实测分布：`function` 2,081 · `const` 1,766 · `interface` 1,142 · `type` 1,136 · `class` 148（合计 6,273 ✓） |
| `file` / `line` | **声明**所在的文件与行。⚠ 不是"使用处" |
| `brief` | JSDoc 的首句。⛔ **只认 `/** */`**，`//` 行注释一律记空 |
| `docSource` | `jsdoc` \| `none` —— 上一格是**真有自述**还是**没有**。实测 3,305 / 2,968（47.31% 无自述） |
| `tags` | 从路径机器派生：`[包名, ...src/test 之后的目录段]`，去重排序。⛔ 不是人填的分类 |
| `wo` | 声明**前导注释**里第一个 `WO-[A-Z0-9-]+` 锚点，没有就是 `null` |
| `state` | 三态，见 §4。**这一格用的是 `includingSelfFileUse` 口径** |
| `reexportOf` | 非空 = 本原子是**薄壳**，真实现在那个坐标（见 §3 `reexports`） |
| `registry` | 仅注册表原子有：`{parsedCount, evaluatedCount, confidence}` |
| `slices` | 本原子属于哪几条切片（从 `inSlice` 边反查） |
| `inbound.srcCount` | **跨文件**生产引用方数。**全量，从不截断** —— `state` 就是从它判的 |
| `inbound.selfUses` | **同文件内**的生产使用次数。两套三态口径的差额**全部**来自这一格 |
| `inbound.selfLine` | 同文件使用的一个样例行号 |
| `inbound.testCount` | 跨文件 test 引用方数（全量） |
| `inbound.src[]` / `test[]` | 引用方坐标**样例**，⚠ **封顶 25 条**（`INBOUND_CAP`）。计数可信，清单可能不全 |

> **为什么计数与样例分开**：截样例只是省体积；**截计数**就等于把「有多少人在用」
> 偷换成「我列了几条」。这两个数在屏上长得一模一样，而只有前者能判三态。

### 2.2 边 `edge` —— 谁对谁做了什么

`{ kind, from, to, pkg?, line?, count?, confidence?, via? }`。
**八种边的字段集合互不相同**（所以存储上整条进 `doc`-jsonb，见 §9）。详见 §3。

### 2.3 切片 `slice` —— 一条本体子图

⚠ **切片不是本目录造的**。抽取器 `import` 的是 datacore 的**真实现**
（`ontology/slice-library.ts` + `slice-index.ts`），喂 `batteryObjectTypes()` / `batteryLinkTypes()` 的真求值；
`tokens` 用真实现的 `tokenizeQuestion`。**图谱在这里是转述，不是第二套实现。**

| 字段 | 度量什么 |
|---|---|
| `sliceKey` | 切片键，如 `biz.equip.equipment` |
| `scope` | `intra`（域内）\| `cross`（跨域）。实测 **7 域内 / 40 跨域** |
| `rootType` | 根对象类型 |
| `domain` | 所属业务域 |
| `spannedTypes[]` | 本切片覆盖的对象类型键 |
| `spannedDomains[]` | 跨到哪些域 |
| `paths[]` | 从根出发的链路 |
| `brief` / `indexEntities[]` | 真实现给的描述与索引实体 |
| `tokens[]` | 检索词元 —— 与 `lookupReusableByQuestion` 内部算法**逐字一致**，故只读索引就能复现它的选择 |
| `counts.atoms` / `atoms[]` | 成员原子数与 `{atom, via}` 清单（`via` = 命中了哪几个 spannedType） |
| `counts.consumers` / `consumers[]` | **从引用边反查**：引用了本切片任一原子的 src 文件。⛔ 不是人填 |

### 2.4 索引目录 `INDEX` —— 唯一入口

**一份，134 KB 量级，小到能被一个 agent 全量读进上下文。**
设计承诺是：**只靠它自己就能回答「哪条切片覆盖 `rootType=X` 且跨到 `Y`」，不必加载任何分片。**

| 段 | 装什么 | 实测条数 |
|---|---|---:|
| `counts` | 总数 + `byEdgeKind` + `docSourceNone` | — |
| `byState` | **两套口径并列**（§4） | 2 套 |
| `canary` | 18 条探针的 expect/actual/ok（§6） | 18 |
| `blindSpotDims` + `blindSpots` | 机器可读盲区（§7） | 14 |
| `registries` | 注册表真值表（名字/坐标/两个计数/confidence/trustworthy） | 119（可信 98） |
| `fieldStats` | 字段字面量长度分布 | 867 |
| `atomShards` | 分片表（包 → 文件 / 原子数 / 边数） | 5 |
| `slices` | **切片目录索引**（§5 解释为什么要两层） | 47 |

---

## §3 · 八种边：语义 · 抽法 · 各自堵住哪一类误判

本轮 **21,032 条**，分布如下（实测 `INDEX.counts.byEdgeKind`，另经 psql 独立复核）：

| 边 | 条数 | `from → to` |
|---|---:|---|
| `asserts` | 7,963 | `file:<测试文件>` → `field:<字段名>` |
| `declares` | 5,437 | 原子 → `field:<字段名>` |
| `registers` | 3,257 | 注册表原子 → `entry:<条目>` |
| `seeds` | 2,284 | `file:<种子文件>` → `field:<字段名>` |
| `inSlice` | 1,734 | 原子 → `slice:<sliceKey>` |
| `reads` | 266 | 原子 → `state:<路径>` |
| `reexports` | 91 | 薄壳原子 → 真实现原子 |
| **`calls`** | **不单列** | 见下 |

### ① `calls` —— 引用边（**materialize 成原子的 `inbound`**）

**语义**：谁在用谁。
**抽法**：遍历每个 program 的每个标识符 → `checker.getSymbolAtLocation` →
`getAliasedSymbol` 解到**真声明**，再按「声明文件 vs 使用文件」分三路：跨文件 src / 跨文件 test / 同文件。
⛔ **import / export 说明符与 re-export 转手有意不发边** —— 那是管道不是使用。

**为什么不单列成一种边**：它是唯一一种数量级在**十万**的边，单列会把图谱撑到没法读。
Materialize 成每个原子上的 `{srcCount, selfUses, testCount}` 三个数 + 两份样例，信息一点没少，
因为**三态只需要这三个数**。

**它堵的误判**：全部四类「零调用方」误判。修好别名 import 那一路之前，
`no-ref` 是 **3,031**；修好之后是 **446**。**修前那份图谱会让人得出「全仓一半是死代码」这个恰好相反的结论。**

### ② `reexports` —— 薄壳 → 真实现（91 条）

**语义**：`export { X } from "./y.js"` 这类转手。
**抽法**：导出说明符带 `moduleSpecifier` 时，解析目标模块 + 目标符号，发一条边；
同时给壳原子打 `reexportOf`。
**它堵的误判**：**「某文件是空的」**。本仓真实发生过把 `args-schemas.ts` 判成「空文件」，
实际它是一层**薄 re-export**，内容在 `packages/contracts/src/solver-args.ts`。
「空」与「转手」在 `wc -l` 眼里差不多，在这条边眼里完全不同。

### ③ `declares` —— zod schema → 它声明的字段（5,437 条）

**语义**：这个契约由哪些字段构成。
**抽法**：识别 `z.object({...})` / `z.strictObject({...})` 的属性名。
**它堵的误判**：契约字段**改名**。它同时是 `seeds` / `asserts` 的**字段词表**来源（见下）。

实测：被声明的**不同字段名** 2,265 个，其中**有鉴别力的** 1,993 个。

> **什么叫「有鉴别力」**：被 **≤3 个 schema** 声明的字段（`DISTINCTIVE_MAX_SCHEMAS = 3`）。
> `id` / `name` / `key` 被 400+ 个 schema 声明 —— 它们出现在某个测试里，
> **不构成**「这个契约字段被字符串钉住了」的证据。
> 实测：不加这条过滤，`asserts` 从 **7,963 涨到 18,847**，多出来的**全是噪声**。

### ④ `reads` —— 原子 → `ctx/state/world.*`（266 条）

**语义**：这个函数读了运行时上下文的哪些路径。
**抽法**：AST 里形如 `ctx.a.b` / `state.x` / `world.y` 的属性访问链。
**它堵的误判**：「这个函数不依赖世界态」—— 依赖是隐式的，签名上看不出来。

### ⑤ `registers` —— 注册表 → 条目（3,257 条）

**语义**：这张注册表里到底有几条、分别是什么。
**抽法（三档，不许混）**：

| `confidence` | 含义 | 可信？ |
|---|---|---|
| `evaluated` | AST 数得出 **且** `dist/` 求值一致 | ✅ |
| `evaluated-mismatch` | 两者不一致 ⇒ **以求值为准**，两个数都留在产物里 | ✅（但要看一眼） |
| `evaluated-uncountable` | AST **数不出来**（展开 / 计算键 / `Object.keys(...)`），只有求值得出 | ✅ |
| `parsed` | 只有 AST（那个包没 build）| ❌ **不可信** |

**它堵的误判**：**「求解器 60 / 62 / 63」那一次**。
`ALL_SOLVER_CATALOG = [...A, ...B, ...C]` 按 AST 数是 **0**，按 `grep -c '"'` 会把注释里的串也数进去，
按求值是 **63**。本轮 `evaluated-uncountable` 实测 **1,161 条** —— 这就是「AST 数不出来但确实存在」的规模。

实测 119 张注册表，**可信 98**；那 98 张里 `registers` 边数 **== 真数组 `.length`**，98/98 全中（金丝雀 ⑯）。

### ⑥ `seeds` —— 种子/mock/fixture 文件 → 它填的字段（2,284 条，带 `count`）

**语义**：这个字段**有没有数据**。
**抽法**：文件路径命中 `seed|seeds|mock|mocks|fixture|fixtures|synthetic` 且**不在 `/test/` 下**，
统计对象字面量里对**有鉴别力字段**的赋值次数。
**它堵的误判**：CLAUDE.md 铁律 0.5 三分法里最阴的那一态 —— **「接了线没数据」**。
原文记着 `dependsOn` 当时 **0 条种子**（接了线从没触发）而 `references` **已有 7 条、其中 6 条非空**（会触发），
两者定性不同、修法不同。`calls` 边答不了这个，只有 `seeds` 能侧面答。

### ⑦ `asserts` —— 测试 → 被**字符串**钉住的字段（7,963 条，带 `line`）

**语义**：这个字段名以**数据键**的形态被写死在测试里 —— **`tsc` 一个都看不见**。
**抽法**：只在 `/test/` 下的文件里，抓三类位置：

1. matcher 期望串：`toContain("DemandSegment.p50")`（7 个 matcher：`toContain|toMatch|toBe|toEqual|toStrictEqual|toHaveProperty|toContainEqual`）
2. 对象字面量数据键：`{ p50: 1 }`
3. 下标取值：`props["p50"]`

**它堵的误判**：CLAUDE.md 铁律 0.6「**第 4 条已达第 3 次**」那一族 ——
`xservice-smoke` → `base-outlook-card` → `skill-studio`，三次契约字段改名，
三次 `pnpm -r typecheck` 全绿、`pnpm -r build` 全绿，直到有人真跑那个测试文件才红。
形态原文：**「我用『三包 typecheck 绿』当作『改名改全了』的证据，而前者并不度量后者。」**

### ⑧ `inSlice` —— 原子 → 切片（1,734 条，带 `via`）

**语义**：这个符号参与哪条本体切片。
**抽法**：原子的**声明节点**里，以**字符串字面量**出现该切片的某个 `spannedType`。

> ⚠ **为什么必须是字符串字面量而不是标识符**：`Model` / `Order` / `Base` / `Line`
> 都是极常见的英文词，按标识符匹配会造出海量假边。而本体类型键在运行时**正是**以字符串键形态使用的。
> 代价写在盲区 ⑨：用变量拼出来的类型键看不见。

---

## §4 · 三态：为什么有两套口径，为什么差 2,397 个原子

### 4.1 判定式（就是这三行）

```js
function stateOf(a) {
  if (a.inboundSrc.size > 0 || (a.selfUses ?? 0) > 0) return "wired";
  if (a.inboundTest.size > 0) return "test-only";
  return "no-ref";
}
```

严格跨文件口径**只把第一行的 `|| selfUses > 0` 去掉**。差别只有这一项。

### 4.2 两套口径的实测值

| 口径 | `wired` | `test-only` | `no-ref` | 它回答的问题 | 什么场合用 |
|---|---:|---:|---:|---|---|
| **`includingSelfFileUse`** | 5,757 | 70 | 446 | 「这个符号**有没有生产代码在用**？」同文件内的生产使用**也算** | 找**真死代码**、找假绿第 9 形态。**假阳性代价高**的场合 |
| **`strictCrossFile`** | 3,360 | 558 | 2,355 | 「有没有**别的文件**在用？」忽略同文件使用 | 找「**导出了但没人跨文件用**」的过度导出面 —— 这批可降成文件内私有 |

**差 2,397 个原子**（5,757 − 3,360）。差的就是「**只在自己文件里被用**」那一批。

### 4.3 为什么非要两套（这不是洁癖）

只报一套就是**拿一个数盖住两个不同事实**，而两边各有一次真实代价：

- **只报 strictCrossFile** ⇒ 假阳性。实测取样的 3 个 `test-only` 全是同文件生产使用
  （`defaultAdapterFactory` providers.ts:231 · `seedWorldCompleteness` seed-world.ts:584 ·
  `RefKindSchema` refs.ts:22/30/50），三个都在生产代码里真被调用，
  却因为「只看跨文件」被判成零生产调用方 —— **这是假绿检测器最不该犯的错**。
- **只报 includingSelfFileUse** ⇒ 假阴性。2,397 个「导出了但只有自己用」的符号会读成 `wired`，
  于是「本仓导出面是不是太大了」这个问题永远问不出来。

⛔ **引用时必须说清用的是哪一套。** 每个原子上都留着 `srcCount` / `selfUses` / `testCount`
三个数，任何人都能自己重算任一口径 —— 这是「不让口径变成只有作者知道的暗知识」的做法。

### 4.4 ⚠ 三态答不了第四态

CLAUDE.md 铁律 0.5 的三分法（没接线 / 接了线没数据 / 接了线接错地方）**三态全是「有没有」**。
它答不了铁律 1.5 那一态：**接对了、跑通了、但算错了**。
`Material.priceShock → Model.costPressure` 那条边链路完整、规则已发布、读数会动，三分法全部通过，
而两个 BOM 占比差 19 倍的物料产生**逐字节相同**的成本压力。

**图谱对这一态零鉴别力。** 别拿它当计算正确性的证据。

---

## §5 · 切片与切片目录索引：为什么要分两层

| 层 | 文件 | 一份多大 | 回答什么 |
|---|---|---|---|
| **目录索引** | `INDEX.yaml` 的 `slices:` 段（47 条） | 全 INDEX ≈ 134 KB | 「**哪条**切片覆盖 `rootType=X` 且跨到 `Y`」 |
| **切片本体** | `slices/<sliceKey>.yaml`（47 份） | 每份 KB 级 | 「**这条**切片具体含哪些原子、被谁引用」 |

**为什么不合成一层**：

- **合成一份大的** ⇒ 想知道「有哪些切片」也得把 47 条的成员表全加载。
  目录索引的设计承诺正是「**只读它自己就能选中切片**」—— 合了就没了。
- **只留 47 份小的** ⇒ 「哪条切片覆盖 X」要遍历 47 个文件；
  而这恰好是**最高频**的问题（`lookupReusableByQuestion` 就在答它）。

目录里的 `tokens` 与真实现的 `tokenizeQuestion` **逐字一致**，
所以「只读 INDEX 选出的切片」与「真实现选出的切片」可以逐条对照 ——
`extract.mjs --verify` 的验收 ③ 跑的就是这个对照，且带**鉴别力金丝雀**
（非 null 命中数为 0 时，「全部一致」不构成证据 —— 恒 null 的坏实现也会全一致）。

---

## §6 · 金丝雀：18 条探针，各守什么

> **规矩（CLAUDE.md 铁律 0.6）**：任何 `grep` / 解析器 / 差集统计 / 计数，
> 在报出结论之前，必须先跑一个「已知必中」的样例。
> **金丝雀不中 ⇒ 报「工具坏了」，⛔ 不许报「代码干净 / 没有命中 / 不存在」。**
> 报否定结论时，报告里**必须同时给出**金丝雀的命中证据。

18 条全部写进 `INDEX.canary`，每条是 `{probe, expect, actual, ok, note?}`。
本轮 **18/18 全中**。按它们守的东西分组：

| # | 探针 | 不中说明什么 | 本轮实测 |
|---:|---|---|---:|
| 1–3 | `buildSliceIndex` 在节点表 / src 入边数 / 入边含 `app.ts` | 引用图整个坏了 | present / 1 / true |
| 4–5 | `inSlice` 边总数 / 切片 `biz.equip.equipment` 的入边 | 切片层没跑（多半是 `dist/` 没建） | 1,734 / 34 |
| 6 | contracts 原子被外包引用数 | **`paths` 映射坏了**，不是 contracts 死了 | 982 |
| 7 | frontend-shell 内部跨文件引用数 | **`@/*` 别名没解析**，不是前端全是死代码 | 1,202 |
| 8 | 经 `@/` 别名被测试引用的符号（`NodeDetailProvenance`） | 别名桥断了 | 5 |
| 9 | 只经 `await import()` 解构拿到的符号（`mapMcpConfig`） | **动态 import 桥断了** | 1 |
| 10 | 经别名 import 被调用的符号（`globalSimOptimize`） | 别名 import 那一路断了 | 1 |
| 11 | **有 test 入边的原子数** | **program 里没有测试文件**（§1.3 那个坑），不是没人写测试 | 1,702 |
| 12–13 | `reexports` 边总数 / 已知 re-export（`LEVER_PROP_META`）命中 | re-export 解析断了 | 91 / true |
| 14 | `evaluated` 置信度的 `registers` 边 | **`dist/` 没建**，全退化成 `parsed` | 1,803 |
| 15 | AST 数不出、靠求值拿到的 `registers` 边 | 求值这一步**没有鉴别力** ⇒「AST 与求值一致」不构成证据 | 1,161 |
| 16 | `registers` 边数 == 真数组 `.length` | 求值与发边两侧漂了 | 98/98 |
| 17 | `blindSpots.dims` 全在枚举内且非空 | 写错一个词，消费方会**静默匹配不上** | 0 条越界 |
| 18 | 五类对账维度**都**至少有一条盲区 | 少一类 ⇒ 消费方在那一维拿不到任何自认盲区，会以为该维无风险 | 5/5 |

**第 15 条值得单说**：它守的不是"有没有结果"，而是"**这个观测有没有鉴别力**"。
如果 AST 和求值永远一致，那么"两者一致"这句话就不含信息。
`evaluated-uncountable` 有 1,161 条 ⇒ 求值确实在做 AST 做不到的事 ⇒ 对照才算数。

这四条 bug 都是**逐条手工复核抓出来、然后才补上金丝雀的**：
① `@/*` 别名被 `paths` 覆盖冲掉 ⇒ 624 个文件读成零跨文件引用；
② 同文件内的生产使用没算 ⇒ 真被调用的符号判成 `test-only`；
③ `await import()` 解构绑定走不通标识符路；
④ 预筛按名字过滤，**别名 import** 的使用点整条漏掉。

---

## §7 · 盲区：这套抽取看不见什么，以及每条会导致哪种错误结论

> ⚠ **程序判「这条结论可不可信」必须读 `INDEX.blindSpots[].dims`，⛔ 不许去撞 `text` 的关键词。**
> 实测教训：散文「引用图看不见 re-export」本意是 `NOREF` 维度，被关键词撞到 `EMPTYFILE` 上，
> 给一条本来可信的结论**错扣了「自认盲区」**。
>
> 维度枚举（5 个）：`COUNT` 计数 · `NOREF` 零调用方 · `EMPTYFILE` 空文件 · `COORD` 坐标 · `LENGTH` 长度分布。
> 本轮 **14 条**盲区，五维全覆盖（金丝雀 ⑱ 守这一点）。

| # | 盲区 | dims | **会导致哪种错误结论** |
|---:|---|---|---|
| 1 | **结构化类型使用**：`interface`/`type` 名字不出现也能被结构匹配用 | NOREF, COUNT | 把 `no-ref` 的 type/interface 读成「没被用」⇒ 删掉就炸。实测 446 个 `no-ref` 里 **type 297 + interface 27 = 324 个（72.6%）落在这条盲区下**（金丝雀：同一把尺子扫到 6,273 个原子 = INDEX 自述数 ⇒ 量法可信） |
| 2 | **字符串键分发 / 事件订阅 / DI 容器** | NOREF | 运行时按名字派发的调用静态一条看不见 ⇒ 活代码判死 |
| 3 | **高阶函数**：只见「被传进去」不见「何时真触发」 | NOREF, COUNT | 答不了「接了线没数据」；只有 `seeds` 能侧面答 |
| 4 | **不做传递性存活**：只被另一个死符号引用的符号仍读作 `wired` | NOREF | 死代码丛**整块**读成活的（如 `SimRunDisclosureSchema` 只被自己的 `z.infer` 用） |
| 5 | **import/export 说明符与命名空间成员访问不发边** | NOREF | 「import 了从不用」读成 `no-ref`（这是**有意**的，那是管道不是使用）。`import * as ns` 后的 `ns.foo` 同样不发边 —— 本仓今天 `import * as` 实测 **0 处**（金丝雀：同一把尺子查 `import type` 命中 **799** ⇒ 是真的没有，不是 grep 坏了），故不构成现实缺口，**换了写法就会变成缺口** |
| 6 | **非 TS 出口不在图里**：`packages/dsh-harness`（vendored `.mjs`）、SQL migrations、nginx/docker-compose、YAML 配置 | COUNT | 「全仓一共 N 个 X」漏掉这些面 |
| 7 | **运行时条件**：feature flag / entitlement 关掉的分支 | — | 图上仍是 `wired` ⇒ 「这条路在跑」是假的 |
| 8 | **`docSource` 只认 `/** */`**，`//` 一律记 `none` | COUNT | 「47.31% 的原子没有自述」**偏高** —— 有些是写成了行注释。⛔ 绝不编造、绝不让 LLM 补 |
| 9 | **`inSlice` 靠字符串字面量** | COUNT, NOREF | 用变量拼出来的类型键看不见 ⇒ 切片成员数**偏低** |
| 10 | **顶层有副作用的模块拒绝 import 求值**（判据：顶层有裸调用语句，如 `server.ts` 末尾的 `main()`） | COUNT | 其中的注册表只能 `parsed` ⇒ 那几张表的条数**不可信** |
| 11 | **`inbound.src/test` 样例封顶 25 条** | COORD | **计数可信、坐标清单可能不全** ⇒ 「引用方就这 25 个」是错的 |
| 12 | **`fieldStats` 只统计字面量赋值**（`x:"abc"`→3、`x:[1,2,3]`→3）；变量/函数调用赋的值不计 | LENGTH, COUNT | `n` 偏低 ⇒ 不能当「该字段出现次数」用 |
| 13 | **`fieldStats`/`seeds`/`asserts` 只覆盖有鉴别力的字段**（被 ≤3 个 schema 声明） | LENGTH, COUNT | `id`/`name`/`key` 这类整批不在清单里 ⇒ **缺席不等于没有数据** |
| 14 | **空文件判定**（见 `reexports` 那条堵的误判） | EMPTYFILE | 把薄 re-export 读成空文件 |

**一句话总结这一节**：
图谱擅长回答「**有**」，不擅长回答「**没有**」。
每一次要说「没有」，都得先看 `dims` 有没有把这条否定结论圈进盲区，再看金丝雀中没中。

---

## §8 · 数据规模与增长

### 8.1 今天的数

| 量 | 本轮实测（`0224325a`） |
|---|---:|
| 原子 | **6,273** |
| 边 | **21,032** |
| 切片 | **47** |
| YAML 产物 | **53 份 · 154,602 行 · 6.8 MB** |
| 扫描文件 | 1,626（719 src + 907 test） |
| 抽取耗时 / 峰值内存 | 16.6–25.1 s / 2,205 MB |

分片（`INDEX.atomShards`）：

| 包 | 原子 | 该片的边 |
|---|---:|---:|
| contracts | 2,271 | 5,700 |
| frontend-shell | 1,922 | 4,787 |
| datacore | 1,364 | 5,944 |
| agentcore | 669 | 2,860 |
| llm-adapters | 47 | 7 |
| **合计** | **6,273** | **19,298** |

⚠ 分片边合计 **19,298** ≠ 总边 **21,032**，差 **1,734** —— 那正是 `inSlice` 边：
它**不属于任何包**（没有 `pkg`），在 YAML 里只以切片的成员表形式隐含存在。
**落库那一份把它显式存了**，所以 `counts.edges` 这个数在数据库里第一次可以被逐条核对。

### 8.2 它怎么随代码库变

**原子数 ≈ 导出符号数，线性跟随代码库。** 一个可核的例子就在本单里：

> 本单往 `apps/datacore/src/domain.ts` 加了 5 个 `export interface`，
> 往 `repo/repo.ts` 加了 2 个（`OntoGraphCounts` / `OntoGraphRepo`）。
> 图谱从 **6,266 → 6,273**，**正好 +7**；`wired` 从 5,750 → 5,757，同样 +7。
> —— 这既是增长规律的演示，也是一次意外好用的端到端自证。

| 量 | 增长驱动 | 大致比例（本轮） |
|---|---|---|
| 原子 | 导出符号数 | — |
| `declares` | zod schema 的字段总数 | 0.87 边/原子 |
| `asserts` | 测试里的字符串数据键 | **最大的一种**（37.9% 的边） |
| `registers` | 注册表条目总数 | 0.52 边/原子 |
| `inSlice` | 切片数 × 平均成员数 | 1,734 / 47 ≈ 36.9 成员/切片 |
| YAML 体积 | ≈ 24.6 行/原子 | 6,273 × 24.6 ≈ 154 k |

**实务含义**：代码库翻倍，这份快照就翻倍。这正是它不该进 git 的原因 ——
`git clone` 会带上**历次**快照的全量副本，而每一次抽取都会产生六位数行的 diff，把真实改动淹掉。

### 8.3 怎么重新量（⛔ 别引用本文的数，引用这条命令）

```bash
pnpm --filter @platform/contracts build \
  && pnpm --filter @platform/llm-adapters build \
  && pnpm --filter datacore build
node scripts/ontology-graph/extract.mjs           # → .ontology-graph/（不进 git）
node scripts/ontology-graph/extract.mjs --canary  # 只自证工具没坏（18 条）
node scripts/ontology-graph/extract.mjs --verify  # 四条对照实验（只打数字，rc 恒 0）
```

---

## §9 · 数据住在哪：出仓与入库

### 9.1 出仓

| 进 git | 不进 git |
|---|---|
| `scripts/ontology-graph/**`（抽取器 1,327 行 + 自检器 2,022 行 + 落库桥 224 行 + **夹具**） | `.ontology-graph/**`（默认输出，53 份 YAML） |
| `docs/ontology-graph/README.md` · `PREMISE-CHECK.md` · **本文件** | `docs/ontology-graph/{INDEX.yaml,atoms/,slices/}`（旧家，仍然拦着） |

**夹具必须留**（`scripts/ontology-graph/fixtures/**`，14 份 YAML）：
它们是自检器 5 条回归用例 × 双向 + 5 条金丝雀的**唯一依据**，
砍了自检器就再也证明不了自己没坏。

**默认输出目录换到 `.ontology-graph/` 而不是继续用 `docs/ontology-graph/`，理由是机制而非洁癖**：
生成物与手写文档同住一个目录时，「只清生成物、不许整目录 `rm`」那条纪律就是**唯一的防线**，
而它是一句**注释**（第一版就是 `rmSync(OUT_DIR)`，写完 README 跑第二次才会发现 README 没了）。
换个目录之后，那条纪律变成**目录边界** —— 机器守，不靠自觉。

### 9.2 入库：四张表，doc-jsonb

`apps/datacore/migrations/041_ontology_graph.sql`，走本仓既有的**仓储双实现**约定
（R9 四处同改：migration + `repo/repo.ts` 接口 + `repo/memory.ts` + `repo/pg.ts`）。

| 表 | 一行是什么 | 本轮行数 |
|---|---|---:|
| `ontograph_snapshot` | 一次抽取（`doc` = INDEX 全文，**一个键都不裁**） | 1 |
| `ontograph_atom` | 一个原子 | 6,273 |
| `ontograph_edge` | 一条边（**含 `inSlice`**） | 21,032 |
| `ontograph_slice` | 一条切片 | 47 |

**为什么四张而不是一张**：四种东西的基数差三个数量级（1 / 47 / 6,273 / 21,032）。
合成一张会逼每个读者为了拿 47 行的切片目录去扫两万行 ——
而「只读索引就能选中切片」正是 §5 那条设计承诺。

**为什么全是 `doc`-jsonb**：八种边的**字段集合互不相同**
（`registers` 带 `confidence`、`seeds` 带 `count`、`asserts` 带 `line`、`inSlice` 带 `via` 且没有 `pkg`）。
逐列建表要么建成稀疏宽表，要么每加一种边就加一次 migration。
`PgStore` 的 doc-jsonb 假设与本表逐字吻合，含它注释里已经踩过的三条坑
（同批 id 去重 / **绑定参数 65,535 上限按列数反算 chunk** / `extraColumns` 取并集）。

> ⚠ 第二条**在边表上是必炸不是可能炸**：21,032 行 × 5 列 = **105,160 个绑定参数**，
> 而 pg 线协议上限是 int16 的 65,535。一次 INSERT 打完整批直接报
> `bind message has N parameter formats but M parameters`。

### 9.3 行 id 的铸法（**唯一一处**，`scripts/ontology-graph/graph-db.mjs`）

| 行 | id |
|---|---|
| 快照 | `${tenantId}:${generatedFrom}` |
| 原子 | `${snapshotId}:${atomId}` |
| 切片 | `${snapshotId}:slice:${sliceKey}` |
| 边 | `${snapshotId}:edge:${6 位序号}` |

⚠ **边为什么用序号而不是 `(kind, from, to)`**：同一个三元组可以**合法地重复出现**
（同一测试文件在两行各钉一次同一个字段）。拿三元组当主键会**静默去重** ⇒
「21,032 条」落库变成「20,xxx 条」，**而两侧都不报错**。
序号来自一次**显式排序**（`edgeSortKey` 把八个可能出现的字段全排进键里），故 R6 成立。

### 9.4 幂等 = 覆盖，不是追加

`replaceAtoms/Edges/Slices` 的语义是「**先删该快照的旧行，再写新行**」，**不是 upsert**。

> upsert 只保证「写进去的那些对」；上一轮多出来的行会**永远活着**，
> 而两次的条数都"看起来对"。抽取器删掉一个符号之后，库里那一条再也没人动它。

pg 侧这一对删+插**在同一个事务里**：中途崩掉会留下「这个快照零条原子」，
而那在读侧与「抽取器本来就没抽到东西」**完全同形** —— 又是一次「我没读到」冒充「它不存在」。

### 9.5 两条读路，一个下游

```
目录 .ontology-graph/ ──┐
                        ├──→ finishGraph()  ──→ 对账表
后台数据库 ─────────────┘
```

`premise-check.mjs` 的 `--graph <dir>` 与 `--from-db` 在 **`finishGraph()` 汇合**，
之后完全同一条代码路径。于是「两条路对同一份数据跑出同一张对账表」是**结构上成立**的，
而不是靠两份各自演进的代码碰巧一致。

`--equiv` 把这句话变成可证伪的：两条路各跑一遍，**逐行 diff**。

> **它当场抓出了两个真 bug**，两个都是「两边各自都跑得通、只有并排放才露馅」那一类：
>
> **① 导入即执行。** `premise-check.mjs` 末尾是 `process.exit(main(process.argv))`，
> 没有 main-module 守卫。`graph-db.mjs --selftest` 去 `import()` 它取一个函数，
> **导入这一步**就把 `main` 跑了，它看见 argv 里的 `--selftest`，跑完**自己的**回归套件然后 `exit(0)`
> —— 落库对账一行都没执行，而屏上是「自测全部通过」+ rc=0。
> 形态：**「我用『命令跑完了、rc=0、屏上一片 ✔』当作『我要验的那件事通过了』的证据 ——
> 通过的是另一个程序。」**
>
> **② SQL 的排序规则不是我的排序规则。** pg 的 `ORDER BY` 走**数据库 collation**，
> 本机集群是 `locale=C`（字节序）⇒ `AtpCheckArgs < argsSatisfiable`；
> 而抽取器写 YAML 用的是 JS `localeCompare` ⇒ `argsSatisfiable < AtpCheckArgs`。
> **集合一模一样、顺序不同**，两张对账表差 3 行，两边都不报错、都 rc=0。
> 换一个 `en_US.UTF-8` 的集群，差异又会变成另一组行 —— **那种随部署环境漂移的绿比直接的红危险得多。**
> 修法：**canonical 顺序由抽取器定义（JS `localeCompare`），不由存储定义** ——
> 读回后在应用层再排一次，⛔ 别指望 SQL。

⛔ **`--graph <目录>` 这条路一个字都没删**，夹具回归全靠它。

### 9.6 ⚠ 没有 `DATABASE_URL` 时会发生什么

仓储按 datacore 自己的规则回落到 **memory**（进程内）。此时：

- **写侧**（`--to-db`）会把「本次**不落盘**」明说在屏上 —— 它验的是**映射与幂等**，不是持久化。
- **读侧**（`--from-db`）**直接拒绝**并返回 rc=3，不给任何对账结论。

理由：空的内存仓储与空的数据库**在屏上一模一样**。
让它往下走，会得到一屏「图谱无此原子」，而那**全是假的**。
**「我没读到」和「它不存在」是两个不同的命题。**

### 9.7 R6 确定性

| 判据 | 怎么验 | 本轮实测 |
|---|---|---|
| YAML 逐字节 | 同一 commit 跑两次 `extract.mjs`，`diff -r` | **零差异** |
| 库内内容 | 同一 commit 连落两次，读回做稳定 JSON 比对 | **一致** |
| 条数不翻倍 | 同上，比三个基数 | 6,273 / 21,032 / 47 **不变** |

⛔ **`doc` 里不许有时间戳。** `created_at` 由 pg 自己打，**不进 `doc`、不参与任何对账**。
谁往 `doc` 里塞一个 `generatedAt`，「同 commit 重跑内容等价」这条命题当场失效，**而且不会报错**。

⚠ `generatedFrom` 取 HEAD 短 hash：**换了 commit 它当然会变**，那不是非确定性。
复验必须在**同一个 commit** 上跑两次 —— 本单第一次复验就栽在这里：
中间提交了一次，`generatedFrom` 从 `388fec35` 变成 `0224325a`、行号跟着漂，
`diff -r` 于是一屏差异，**看起来像 R6 崩了**。

---

## §10 · 常用命令速查

```bash
# 抽取（→ .ontology-graph/，不进 git）
node scripts/ontology-graph/extract.mjs
node scripts/ontology-graph/extract.mjs --out <dir>       # 换输出目录
node scripts/ontology-graph/extract.mjs --canary          # 只自证工具没坏（18 条）
node scripts/ontology-graph/extract.mjs --verify          # 四条对照实验

# 落库（DATABASE_URL 有值走 pg；没值走内存并明说不落盘）
DATABASE_URL=postgres://... node scripts/ontology-graph/extract.mjs --to-db [--tenant platform]

# 库里有什么
DATABASE_URL=postgres://... node scripts/ontology-graph/graph-db.mjs --list
# 目录 → 落库 → 读回 → 对账 + 幂等 + R6
DATABASE_URL=postgres://... node scripts/ontology-graph/graph-db.mjs --selftest --graph .ontology-graph

# 派单前提对账
node scripts/ontology-graph/premise-check.mjs docs/WO-XXX.md                  # 读目录
DATABASE_URL=... node scripts/ontology-graph/premise-check.mjs docs/WO-XXX.md --from-db
DATABASE_URL=... node scripts/ontology-graph/premise-check.mjs docs/WO-XXX.md \
    --graph .ontology-graph --from-db --equiv                                 # 两条路逐行 diff
node scripts/ontology-graph/premise-check.mjs --selftest                      # 回归 + 金丝雀
```

---

## §11 · 相关文档

| 文档 | 讲什么 |
|---|---|
| `docs/ontology-graph/README.md` | 怎么跑 · 读哪一份 · 边与三态的**速记版** |
| `docs/ontology-graph/PREMISE-CHECK.md` | 派单前提对账器：怎么用、三种归因、它自己的金丝雀 |
| `docs/SYSTEM-ONTOLOGY.md` | 人读的散文本体（**保留不动**）。图谱是它旁边的机器抽取面，两者互不覆盖 |
| `apps/datacore/migrations/041_ontology_graph.sql` | 四张表的表结构与设计裁决 |
| `apps/datacore/src/repo/repo.ts` `OntoGraphRepo` | 仓储接口（含两处实测踩坑的注释） |
