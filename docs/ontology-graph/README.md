# 本体图谱（机器抽取面）
`docs/SYSTEM-ONTOLOGY.md`（人读的散文本体）**保留不动**；本目录是它旁边一份 **100% 从源码抽取、零人工维护字段**的事实快照。
⛔ 不是门、不是棘轮、不是基线：无红绿判定，不进 `gate.sh`，不进 `package.json` 的 `gates`。

## 怎么跑
```bash
pnpm --filter @platform/contracts build && pnpm --filter @platform/llm-adapters build && pnpm --filter datacore build
node scripts/ontology-graph/extract.mjs            # 抽取（只重建 INDEX.yaml/atoms/slices，本 README 不动）
node scripts/ontology-graph/extract.mjs --canary   # 只自证工具没坏
node scripts/ontology-graph/extract.mjs --verify   # 四条对照实验（只打数字，rc 恒 0）
```
datacore `dist/` 是**软前置**：没有它 `registers` 边全退化成 `parsed`（不可信）、切片层整个跳过。
实测 5 个 program · 1626 文件 · **26s** · 峰值 RSS **2.2GB**（故逐包建 program，不建全仓巨型 program）。

## 读哪一份
- **`INDEX.yaml`（135KB，唯一入口，小到能被 agent 全量读）**：总数 · **两套口径的三态** · 金丝雀证据 · **机器可读盲区 `blindSpots[]`** · **注册表真值 `registries[]`** · **字段长度分布 `fieldStats[]`** · 分片表 · **切片目录索引**。判据：只靠它自己就能回答「哪条切片覆盖 rootType=X 且跨到 Y」，不必加载任何分片。
- `slices/<sliceKey>.yaml`：切片本体。切片**不是本目录造的** —— 复用 `ontology/slice-library.ts` + `slice-index.ts` 的真实现，喂 `batteryObjectTypes()`/`batteryLinkTypes()` 的真求值；`tokens` 用真实现的 `tokenizeQuestion`。
- `atoms/<package>.yaml`：原子 + 该包发出的非 `inSlice` 边。

## 八种边
- `calls` 引用方→原子：**不单列**，materialize 成原子的 `inbound.{src,test}`（计数**从不截断**，样例封顶 25 条）
- `registers` 注册表→条目：**优先 import dist 真求值**。`confidence` = `evaluated` / `evaluated-mismatch`（以求值为准）/ `evaluated-uncountable`（AST 数不出、只有求值数得出，如 `[...A,...B]`）/ `parsed`（没 build，不可信）
- `reexports` 薄壳→真实现（壳原子带 `reexportOf`）· `declares` zod schema→字段 · `reads` 原子→`ctx/state/world.*`
- `seeds` 种子/mock 文件→字段（带 `count`，答「接了线没数据」那一态）
- `asserts` 测试→字段：旧名以**字符串**形态被钉住的位置（`toContain(...)`/对象键/`props["x"]`）—— typecheck 一个都看不见
- `inSlice` 原子→切片：判据是原子声明里以**字符串字面量**出现该切片的某个 spannedType（用标识符会被 Model/Order/Base 这类常见英文词淹掉）
- `seeds`/`asserts` 只对**有鉴别力的字段**发边（被 ≤3 个 schema 声明）。`id`/`name`/`key` 被 400+ schema 声明，出现在某测试里不构成「契约字段被钉住」的证据；不加这条 `asserts` 从 7,963 涨到 18,847，全是噪声。

## 三态有**两套口径**，`INDEX.byState` 两套并列（⛔ 引用时必须说清用哪一套）
- `includingSelfFileUse`（**5750 / 70 / 446**）答「有没有生产代码在用」，同文件内的生产使用也算 —— 找**真死代码**与**假绿第 9 形态**用这套（假阳性代价高）。
- `strictCrossFile`（**3354 / 558 / 2354**）答「有没有**别的文件**在用」，忽略同文件使用 —— 找**导出了但没人跨文件用**的过度导出面用这套。
两套差 **2396** 个原子，差的就是「只在自己文件里被用」那批。⛔ 只报一个数 = 拿一个数盖住两个不同事实。
三个计数 `srcCount`/`selfUses`/`testCount` 在每个原子上，谁都能自己重算任一口径。

## 金丝雀怎么验
`--canary` 跑 18 条，结果同时写进 `INDEX.yaml` 的 `canary:` 段。**任一条不中 ⇒ 报「工具坏了」，⛔ 不许报「没有命中 / 零调用方 / 不存在」。** 每条钉死一个已知必中的出处（`buildSliceIndex` 必有 `app.ts` 的 src 入边、`mapMcpConfig` 必有经 `await import()` 的 src 入边），所以能分辨「真的没有」与「解析器坏了」。
这四条 bug 都是逐条手工复核抓出来、**然后才补上金丝雀**的：① frontend-shell 的 `@/*` 别名被 `paths` 覆盖冲掉 ⇒ 624 文件读成零跨文件引用；② 同文件内的生产使用没算 ⇒ 真被调用的符号判成 `test-only`；③ `await import()` 解构绑定走不通标识符路；④ 预筛按名字过滤，**别名 import**（`X as Y`）的使用点整条漏掉 ⇒ 求解器 `globalSimOptimize` 被判零生产调用方，而 `service.ts:3552` 真在用。修前 `no-ref` **3031**、修后 **446** —— 修前那份图谱会让人得出「全仓一半是死代码」这个**恰好相反**的结论。

## ⚠ 本抽取器看不见什么（比上面的功能清单重要）
**下面这段散文只配说「疑似」；程序判「这条结论可不可信」必须读 `INDEX.blindSpots[].dims`**，维度枚举
`COUNT`（计数）/`NOREF`（零调用方）/`EMPTYFILE`（空文件）/`COORD`（坐标）/`LENGTH`（长度分布），共 14 条、五维全覆盖。
⚠ 实测教训：散文「引用图看不见 re-export」本意是 `NOREF`，被关键词撞到 `EMPTYFILE` 上，
给一条本来可信的结论**错扣了「自认盲区」** —— 所以别撞 `text`，读 `dims`。
1. **结构化类型使用**：`interface`/`type` 不出现名字也能被结构匹配使用 ⇒ `no-ref` 的 type/interface（324 个）**不等于没被用**。
2. **字符串键分发 / 事件订阅 / DI 容器**：运行时按名字派发的调用，静态一条都看不见。
3. **高阶函数**：能看到"被传进去"，看不到"什么时候真触发" ⇒ 答不了「接了线没数据」，只有 `seeds` 边能侧面答。
4. **传递性存活**：只被另一个死符号引用的符号仍读作 `wired`（如 `SimRunDisclosureSchema` 只被自己的 `z.infer` 用）。
5. **只 import 不使用**：import/export 说明符**有意不发边**（那是管道不是使用），故「import 了从不用」读成 `no-ref`。同理**命名空间成员访问**（`import * as ns` 后的 `ns.foo`）不发边 —— 本仓今天 `import * as` 实测 **0 处**，故不构成现实缺口，但换了写法会变成缺口。
6. **非 TS 出口**：`packages/dsh-harness`（vendored `.mjs`，无 `src/`）、SQL migrations、nginx/docker-compose、YAML 配置全不在图里。
7. **运行时条件**：feature flag / entitlement 关掉的分支，图上仍是 `wired`。
8. **`docSource` 只认 `/** */`**：`//` 行注释一律记 `none`，⛔ 绝不编造、绝不让 LLM 补。本轮 **2968/6266 = 47.4%** 的原子没有自述。
9. **`inSlice` 靠字符串字面量**：用变量拼出来的类型键看不见。
10. **顶层有副作用的模块拒绝 import 求值**（判据：顶层有裸调用语句，如 `server.ts` 末尾的 `main()`）⇒ 其中的注册表只能 `parsed`。

## 确定性（R6）
同一 commit 跑两次，全部 YAML **逐字节一致**（实测 `diff -r` 零差异）。⛔ 不打时间戳、排序全部显式、目录遍历先排序。
⚠ `generatedFrom` 取 HEAD 短 hash：**换了 commit 它当然会变**，那不是非确定性 —— 复验要在同一个 commit 上跑两次。
