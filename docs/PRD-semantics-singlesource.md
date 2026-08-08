# PRD · 节点语义表的「单源」到底该怎么落（WO-SEMANTICS-SINGLESOURCE）

> **一句话结论**：`chain-node-singlesource` 门的 `C·抄表` 判据把
> `apps/frontend-shell/src/views/sim/chainNodeSemantics.ts` 判红，**门有理但理由用错了对象**——
> 它数出了 12 个在册 nodeId 字面量，却看不见这 12 个键在**编译期**就绑死在契约注册表上。
> 采**路线 A（门加一条按机制豁免的判据）**，并给该豁免配了反伪造 + 双向金丝雀。
> 路线 B 实测是死的，路线 C 代价与收益不成比例 —— 逐条理由见 §5。

---

## §0 本体引用与影响

| 维度 | 触及项 | 影响 |
|---|---|---|
| **不变量** | **R1 contracts-only-shared** | **承重**。本单的豁免判据把 R1 从「评审口头约定」变成**机器判据**：豁免只认锚在 `@platform/contracts` 上的键类型，从别的前端文件 re-export 再 import 一律不认（fail-closed）。 |
| | **R6 确定性** | 不变。门是纯静态扫描，新判据不引入时钟/网络/随机。 |
| | **R13 结论可溯源** | 不变。本表是**编辑口径**不是引擎下发，`SEMANTICS_ORIGIN_NOTE` 常驻上屏的约定原样保留。 |
| | **R14 应用层无业务常数** | 不变。本单不动 `pos`/`cf` 正文（那批文案早前已按 R14 治过一轮：去掉行业常数、改指契约字段名）。 |
| **断点** | `G-CHAIN-NODEID-FREESTRING`（§8，已闭） | **加固**。该断点的防复发门就是本门；本单把它的 `C` 判据从「对类型瞎」修成「按机制豁免 + 反伪造」，并补上一条**编译期绑定**的接缝门。 |
| **对象类型** | 无新增/无变更 | `CHAIN_NODE_REGISTRY`（契约 §2.5）形状一字未动。 |
| **链路 / 事件** | 无新增/无变更 | 纯构建期门禁，不上运行时链路。 |
| **门禁** | `chain-node-singlesource:check` | **判据变更**，须回写本体 §7（本单已回写，措辞新旧对照见 §7）。 |

**新增制品**

- `apps/frontend-shell/test/chain-node-semantics-typebinding.seam.test.ts`（新门，见 §6）

---

## §1 事实起点：门说了什么

```
❌ chain-node-singlesource:check 失败：
  · apps/frontend-shell/src/views/sim/chainNodeSemantics.ts:69 [C·抄表] 本文件把 12 个在册 nodeId
    写成了字面量（demand.consensus@69, order.review@87, order.cash@91, order.settlement@109,
    capacity.schedule@127…）——id 全对也仍然是**第二份注册表**：改册时这里不会跟着变，
    就退回 D1/E1 各持一套的状态。
```

该文件在 canonical（`ee66d9ef`）上**不存在**，是本批新增 ⇒ 这条红是本批引入的，不是存量。

**`C` 判据的立论**（原文）：「id 全对也仍然是第二份注册表：**改册时这里不会跟着变**」。
本单要判的就是这一句对本文件成不成立。

---

## §2 被判红的那段代码到底是什么形状

```ts
import { CHAIN_NODE_REGISTRY, type ChainNodeDef } from "@platform/contracts";

export type RegisteredChainNodeId = ChainNodeDef["nodeId"];   // ← 注册表 as const 派生的字面量联合

export const CHAIN_NODE_SEMANTICS: Partial<Record<RegisteredChainNodeId, ChainNodeSemantics>> = {
  "demand.consensus": { pos: "…", cf: [ … ] },
  …共 12 条
};
```

两件事必须分开看，混一起就会选错路：

| | 能不能从注册表派生 | 说明 |
|---|---|---|
| **键**（12 个 nodeId） | **能**（但派生出来没用，见 §5 路线 B） | 键的合法性已由类型系统兜住 |
| **内容**（`pos` / `cf` / `basis`） | **不能** | 人写的原创：一句白话定位 + 从代码里读出来的跨节点耦合 + 逐条 `file:line` 依据 |

「没有键就挂不住内容」—— 这是本表键必须逐个写出来的根本原因，不是偷懒。

---

## §3 门在这里瞎在哪：`C` 数的是字面量，看不见类型

`C` 的立论「改册时这里不会跟着变」对**本文件**为假。实测（`tsc --strict`，原文见 §4）：

- 写一个**不在册**的键 ⇒ `TS2353`，构建当场失败；
- **注册表里改掉一个 id** ⇒ 语义表里的旧键掉出联合 ⇒ 同样 `TS2353`。

对照门**已经明文豁免**的数据侧同族 `apps/datacore/src/synthetic/cadence.ts`：
它的 `CADENCE_NODES` 在 `cadence.ts:400` **运行时**对注册表验真、不在册直接抛。
两者是同一类机制的两个强度档：

| | 验真时机 | 绕过成本 | 门今天的态度 |
|---|---|---|---|
| `cadence.ts` | **运行时**（要跑到那条路径才红） | 不跑到就发现不了 | **已豁免** |
| `chainNodeSemantics.ts` | **编译期**（`tsc` 不过，构建就断） | 绕不过去 | 判红 ← 反了 |

⇒ 门对**更强**的那一档判红、对**更弱**的那一档放行。缺的不是代码纪律，是**门的一条判据**。

---

## §4 实测证据（`tsc --strict --noEmit`，亲手跑的，不是推理）

### 4.1 编译期包含关系确实存在

```
probe.ts(23,3): error TS2353: Object literal may only specify known properties,
  and '"capacity.made_up"' does not exist in type
  'Partial<Record<"demand.consensus" | "order.review" | "order.cash", Sem>>'.
probe.ts(28,3): error TS2353: Object literal may only specify known properties,
  and '"order.reviw"' does not exist in type
  'Partial<Record<"demand.consensus" | "order.review" | "order.cash", Sem>>'.
TSC_RC=2
```

第二条是**拼错**的在册键（`order.reviw`）——连手滑都咬得住。

### 4.2 三条「洗白」路子（豁免必须逐条堵死，否则等于把门拆了）

同一份探针里加三种写法，只有一种仍然报错：

```
probe2.ts(15,3): error TS2353: Object literal may only specify known properties,
  and '"capacity.made_up"' does not exist in type
  'Partial<Record<"demand.consensus" | "order.review", Sem>>'.
TSC_RC=2
```

| 写法 | `tsc` 咬不咬 | 门的处置 |
|---|---|---|
| `{…} satisfies Partial<Record<Id, Sem>>` | **咬**（上面那条 15 行就是它） | **认**（可豁免） |
| `{…} as Partial<Record<Id, Sem>>`（强制断言） | **不咬**（21 行零诊断） | **不认** |
| `Partial<Record<Id \| string, Sem>>`（掺 `string` 泡宽） | **不咬**（26 行零诊断） | **不认** |

**这两条阴性结果是本单最值钱的取证**：它们说明「看起来锚在契约上」和「真的锚在契约上」是两回事，
豁免若只按写法长相放行，随手一个 `as` 就白嫖到了。

---

## §5 三条路评齐：为什么选 A、为什么**不**选 B 和 C

### 路线 A —— 门加一条「按机制豁免」的判据 ✅ **采纳**

**判据**：`C` **跳过**「处于**键位** ⊕ 该对象字面量的**声明类型**的键类型锚在 `@platform/contracts` 上」的字面量。

反伪造五条（每条都对应 §4 里一个实测过的洗白路子，不是设想）：

1. 本地伪造 `type RegisteredChainNodeId = string` ⇒ 键类型解析不到契约导入名 ⇒ **不豁免**；
2. 键类型里出现 `string`/`any`（`Id | string`）⇒ **不豁免**（§4.2 实测 `tsc` 已经不咬了）；
3. `as` 强制断言 ⇒ **不认**；只认 `const X: T = {…}` 与 `{…} satisfies T`；
4. **只豁免键位**，同一张锚定表里的**值**照常计入 `C`（值不受键类型约束，那才是真词表）；
5. 锚点只认 `@platform/contracts` **本尊**——从别的前端文件 re-export 再 import **不豁免**（fail-closed）。
   严得刻意：合法修法只是多写一行 import，成本近零；放开跨文件追溯就等于开一条门看不见的路。

**`L·抄标签` 判据完全不受影响**（刻意）：键绑死不代表值干净，「中文映射表副本」的形态恰恰是在**值**位抄 `label`。

**代价**：门 +1 条判据、+1 组自检；被扫代码零改动。

### 路线 B —— 前端从注册表派生键 ❌ **实测是死的**

工单要求先花 5 分钟验证这条路是不是死的。**是死的**，三种写法各自死在不同地方：

| B 的变体 | 结果 | 死因 |
|---|---|---|
| 按**下标**对齐（`CHAIN_NODE_REGISTRY.map((n,i)=>[n.nodeId, SEM_BY_INDEX[i]])`） | **比病还坏** | 把「编译期报错的键」换成「**静默错位**的下标」。注册表一插条目，语义就无声挂到别的节点上——从「构建失败」退化成「屏上说错话且没人知道」。用位置耦合换掉类型耦合是负收益。 |
| 按 **`label`** 建键 | **死** | ① `label` 是显示串、稳定性弱于 id（契约明写 id 冻结）；② 撞 `L·抄标签` 判据（≥3 个在册 label 字面量直接判红）。 |
| `switch (def.nodeId) { case "demand.consensus": … }` | **死** | `case` 子句里还是 12 个字面量，`C` 数得一个不少（门的文件头本来就把 switch case 列为要抓的形状）。换汤不换药。 |

**根因**：`pos`/`cf`/`basis` 是**原创内容**，派生不出来；而任何「nodeId → 内容」的映射都必须把 nodeId 物化成某种键。
能派生的只有键，可键一旦不写出来，就只能拿**位置**或**显示名**去替代身份——两者都比字面量键更弱。
⇒ 路线 B 在每种形态下要么仍被门咬，要么把一个编译期错误换成一个静默错误。

### 路线 C —— 语义上移到后端注册表（真单源）❌ **不选（代价与收益不成比例）**

C 确实是结构上更「真」的单源，但本单不选，四条理由：

1. **它解决不了任何路线 A 没解决的问题**。C 想保证的是「键 ⊆ 注册表」，而这条**路线 A 已经由编译期联合保证了**（§4.1）。
   C 换来的增量安全 ≈ 0，付出的是三个包的改动。
2. **依赖方向会被倒过来**。`cf[].basis` 是逐条 `file:line`，指向 `apps/datacore/src/solvers/*`、`apps/datacore/src/sop.ts` 等**应用内部实现**。
   把它塞进 `packages/contracts` ⇒ 共享契约包开始记录 app 内部行号。契约层是 schema，不是应用实现的注释本；
   这跟 **R1 contracts-only-shared** 的精神正相反（R1 要的是「app 依赖契约」，不是「契约描述 app」）。
3. **生命周期对不上**。`label` 随**链路模型**变（很少），`pos`/`cf`/`basis` 随**代码**变（依据行号会漂）。
   合进同一张表 ⇒ 改一句文案/修一次行号就是一次**契约变更**，四包全量重建、契约版本churn。
   「`label` 单源」这条既有规则之所以成立，正因为 `label` 属于前一类；把后一类硬塞进去是把两种变更频率焊死。
4. **载荷代价是实的**。`CHAIN_NODE_REGISTRY` 今天被前端**整表**引用（`InspectorNodePanel.tsx:785` `const nodes = CHAIN_NODE_REGISTRY`、
   `sandboxConsole.ts:350`）。把 12 条 `pos` + 全部 `cf.text` + `basis[]` 挂上去，等于把这堆中文长文案与行号数组
   塞进**每一个**引用注册表的前端 chunk，而绝大多数消费方只要 `nodeId`/`label`/`stage` 三个字段。

**什么时候该重开 C**：若将来后端真的开始**计算**节点语义（例如 `cf` 由依赖图自动推导、不再是人写），
那它就从「编辑口径」变成「引擎下发」，届时归属该跟着变——那是另一张单，判据是「内容是不是引擎算出来的」，不是「键放哪」。

---

## §6 交付物

### 6.1 门的判据变更

`scripts/check-chain-node-singlesource.mjs`

- `extractLiterals` 每个字面量多返回一位 `anchoredKey`；
- 新增 `recordKeyType`（剥 `Partial`/`Readonly`/`Required`/`Record`/映射类型的键类型）、
  `keyTypeAnchored`（解析到契约导入名 ⊕ 全树无 `string`/`any`）、
  `declaredTypeOfObjectLiteral`（**只**认变量注解与 `satisfies`，**不**认 `as`）；
- `C` 计数跳过 `anchoredKey` 为真的字面量；**`L` 不跳**；
- 通过行打出豁免**实际命中数**（今天：12 处 / 1 文件）——豁免哪天坏成恒 `false`，这个数会掉到 0，看得见。

### 6.2 新门：编译期绑定的接缝测试

`apps/frontend-shell/test/chain-node-semantics-typebinding.seam.test.ts`

豁免的前提（那行类型声明）是**可以被人无声改掉的**：改宽成 `Record<string, …>` 后 `tsc` 不再咬，
文件表面一模一样、既有单测全绿，`C` 对这个文件就等于被拆了且没有任何信号。
门自己的自检只能证明**门的豁免逻辑**没瞎，证明不了**被豁免那个文件**的类型还在。

故该门**真跑 TypeScript 编译器**（内存 program；契约走 `paths` 指到**源码**，
不依赖「先 build 过 contracts」这个隐藏前置，否则没 build 的机器上会静默变成「零诊断 ⇒ 全绿」），
对真实文件做四组正反对拍：

| | 变异 | 期望 |
|---|---|---|
| §1 | 原样 | 零 `TS2353`（反面锚：红不是 harness 自造的噪声） |
| §2 | 键写歪 | `TS2353` 且点名到那个键 |
| §3 | **改契约注册表的 id** | 语义表当场红（**直接证伪 `C` 的立论**） |
| §4 | 键类型放宽成 `Record<string,…>` | §2 的红**消失**（反面锚：承重的就是那行类型） |

跨「契约包 × 前端包 × 编译器」三方接缝，任一半改动都咬得到。

### 6.3 新判据的金丝雀（写进门里，每次运行都跑）

「类型锚自检」9 段内嵌样本正反对拍：4 段该豁免（`Partial<Record<…>>` / 裸 `Record<…>` / `satisfies` / 别名链多跳）、
5 段**必须不豁免**（本地伪造 `= string` / 掺 `string` 泡宽 / `as` 断言 / 值位 / 非契约模块锚点）。
任一条对不上 ⇒ 报「**门自己瞎了**」（与业务违规分开报，修法完全不同），不是「代码干净」。

---

## §7 本体 §7 该门登记措辞：新旧对照

**旧**（`C` 判据一句，无豁免、无第 5 条自检）：

> `C 抄表`（单个前端文件 materialize ≥3 个**在册** nodeId ⇒ 判为第二份注册表 —— 抓「id 全对但仍是手抄」，
> K/N 只查合法性而**合法的抄写照样是抄写**）

**新**（追加「按机制豁免 + 反伪造 + 让出的边界」，并在「门自身防截断」补第 ⑤ 条自检）：

> `C 抄表`（…同上…）。**`C` 的按机制豁免（WO-SEMANTICS-SINGLESOURCE）**：处于**键位**且该对象字面量
> **声明类型**的键类型锚在 `@platform/contracts` 上的字面量**不计入抄表数** —— 这类键改册即 `tsc` **TS2353**
> （编译期包含关系），`C` 的立论「改册时这里不会跟着变」对它不成立；比门已明文豁免的 `cadence.ts:400`
> （**运行时**验真）还强一档。**反伪造五条**（实测，非推理）：本地伪造 `type Rid = string` 不豁免 ·
> 键类型含 `string`/`any`（`Rid | string` 泡宽，实测 `tsc` 当场不再咬）不豁免 · `as` 强制断言不认
> （实测不咬；只认 `const X: T =` 与 `satisfies`）· 只豁免**键位**（同表**值**位照常计入）·
> 锚点只认 `@platform/contracts` 本尊（跨文件 re-export 不认，fail-closed）。**`L` 判据不受本豁免影响**（刻意）。
> **诚实边界 ⑤（本豁免让出的一块）**：在锚定表里**另造一套中文名**（值是新编的、不等于在册 `label`）
> ⇒ `C`/`L` 都咬不到；这块此前是被 `C` 顺手挡住的，现在让出来了，不补判据的理由是「`C` 数的是 id」。
> **门自身防截断 ⑤ 类型锚自检**（每次运行都跑）：9 段样本正反对拍（4 该豁免 / 5 必须不豁免），
> 任一条对不上判「门自己瞎了」。**编译期绑定另有专门接缝门**
> `apps/frontend-shell/test/chain-node-semantics-typebinding.seam.test.ts`（真跑 `tsc`，四组正反对拍）。

---

## §8 变异反证（先 commit 再变异；失败原文见交付报告）

| # | 变异 | 期望 | 实得 |
|---|---|---|---|
| ① | 新前端文件裸数组写 4 个在册 nodeId（**真手抄**） | `C` 红 | ✅ 红，点名 4 个 |
| ② | 本地伪造 `type RegisteredChainNodeId = string` 白嫖豁免 | `C` 红 | ✅ 红 |
| ③ | `{…} as Partial<Record<Rid,…>>` 强制断言 | `C` 红 | ✅ 红 |
| ④ | `Partial<Record<Rid \| string,…>>` 掺 `string` 泡宽 | `C` 红 | ✅ 红 |
| ⑤ | **合法**锚定表，但在册 id 写在**值**位 | `C` 红（且**只**数值位那 3 个） | ✅ 红，键位 3 个未计 |
| ⑥ | **正对照**：合法锚定表（键位 + 契约锚） | 绿 | ✅ 绿 |
| ⑦ | 把门的 `keyTypeAnchored` 改成恒 `true`（豁免写瞎） | 「**门自己瞎了**」 | ✅ 三条反例样本同时报红 |
| ⑧ | 把**真文件**的键类型放宽成 `Record<string,…>` | 门红 **且** 新接缝门红 | ✅ 双双红（双重覆盖） |
