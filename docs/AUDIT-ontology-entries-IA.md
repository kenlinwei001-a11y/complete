# AUDIT · 本体域入口信息架构（IA）审计

> **单号** WO-ONTOLOGY-IA · **日期** 2026-08-11 · **画像** 轻（只读代码 + 写文档）
> **触发**：仓主一天内连问三个问题 —— ①「本体建模工作台是干哈用的？与本体切片的价值区别是？」
> ②「对象/类型浏览器是干啥用的，点『看实例』没有反应」③「导航栏的『本体图谱』与『图谱全景』有什么区别？」
>
> **结论先行**：这不是三个孤立问题，是**同一个症状的三次出现**。本体域当前有 **18 个并列入口**
> （建模与图谱组 9 + 图谱体系折叠组 8 + 平台治理组 1），其中**至少两对是"同一功能的两份配置"**，
> 而把它们区分开的那个唯一差异**在生产链路上是坏的**。用户分不清该点哪个，不是用户的问题。

---

## 0 · 本体引用与影响（铁律 0 强制节）

| 维度 | 触及内容 |
|---|---|
| **对象类型**（§2） | `ViewConfig` / `ObjectType` / `OntologySlice` / `BusinessDomain` / `ModelingDraft` / `MergeCandidate` / `SystemOntologyNode`(meta) |
| **链路**（§3） | 本体发布链（A3 suggest→draft→publish→物化）· 视图下发链（`BUILTIN_VIEWS`→`VIEW_DEFS`→`ViewConfig`→`/a/v1/me/workspace`→`ViewPage`→renderer）· 切片投影链（slice→layers→SliceInspector） |
| **事件** | 本单纯只读审计，**未新增/改变任何事件** |
| **不变量** | R3（功能关闭 = 不存在）· R6（确定性）· R14（零业务常数写死）—— 均未违反；本单不改代码 |
| **断点** | **新增 4 条**：`G-GRAPH-ENTRY-DUP` · `G-GRAPH-DESC-CONTRACT-SPLIT` · `G-OT-INSTANCE-PANEL-OFFSCREEN` · `G-SLICE-ENTRY-DUP`（已回写 §8） |
| **门禁**（§7） | 触及 `nav-group-coverage:check`（`scripts/check-nav-group-coverage.mjs`）射程 —— 见 §4 每条建议的「门影响」栏 |

**范围边界**：本单只写 `docs/AUDIT-ontology-entries-IA.md` + `docs/SYSTEM-ONTOLOGY.md`。
**一个 `apps/**` 源文件都没改**（`git status` 可验）。导航 IA 是产品决策，本单只出建议。

---

## 1 · 入口全景（18 个）

导航结构的两个真相源必须同时看，它们**分属不同文件、各管一半**：

- `apps/frontend-shell/src/pages/ShellLayout.tsx:56 (NAV_GROUPS)` —— 一级分组与组内顺序（含 `kind:"view"` 业务视图）
- `apps/frontend-shell/src/pages/adminRegistry.ts:91 (ADMIN_NAV_GROUPS)` —— 管理页归组（须与上表对齐，历史上漂过）

### 1.1 「建模与图谱」组（9 项 · `ShellLayout.tsx:108-116`）

| # | 导航标题 | key / kind | 它到底干什么（一句话） | 消费链路 / 对象类型 | 当前可用性 |
|---|---|---|---|---|---|
| 1 | **本体图谱** | `graph` · view | 把已发布本体渲染成力导向图，按域着色，点节点看详情 | `GET /a/v1/ontology/graph?packageId=` → `ObjectType`+关系 | 可用；**与 #10 图谱·全景渲染完全相同**（见 §2.1） |
| 2 | **本体建模** | `modeling` · admin | **建**本体：从原始数据集出 AI 草案 → 三栏（源字段｜映射画布｜操作面板）→ 发布 → 物化 | A3 suggest/draft/publish 链；产 `ObjectType` | 可用；无草案时走空态 |
| 3 | **对象/类型浏览** | `object-types` · admin | **查**本体：已发布类型按 14 域分组 + 物化对象计数 → 下钻实例 → Object360 | `GET /a/v1/ontology/object-types/stats` + `/a/v1/business-domains` | 可用但**「看实例」体感失灵**（见 §2.2） |
| 4 | **域管理** | `domains` · admin | 维护「域」这个一等治理单元（域键/显示名/颜色），图谱按域分组、域 owner 会签 | `GET/POST /a/v1/ontology/domains` | 可用；空态「暂无域」 |
| 5 | **本体切片** | `slices` · admin | **已注册**切片清单 + 新建/试切/推进为契约 | `GET /a/v1/ontology/slices` | 可用；demo 98 条中 94 条是 `coverage_*`，默认只显多跳 4 条 |
| 6 | **切片库** | `slice-library` · admin | **派生**切片两库（域内/跨域）+ 规划 tab | `GET /a/v1/slices/library` | 可用；**规划 tab 与 #5 新建切片是同一个规划器**（见 §2.3） |
| 7 | **实体合并** | `merge` · admin | 多源同实体去重：扫候选 → 并排选 golden 合并 → 72h 可还原 | `/a/v1/objects/merge*`；`MergeCandidate` | 可用 |
| 8 | **边界册治理** | `boundary` · admin | 只读看业务常数册（基地/细分/规划目标）版本指纹与影响图 | `GET /a/v1/boundary/{impact,version}` | 可用；**语义上不属本体域**（见 §4 建议 D） |
| 9 | **原型 intake** | `prototype-intake` · admin | 上传原型 HTML 当文件型数据源导入 | `prototype_html` 连接器 | 可用；**语义上属数据接入**（见 §4 建议 D） |

### 1.2 「图谱体系」折叠组（8 项 · `ShellLayout.tsx:118-122`）

八个视角**全部 renderer = `ontology-graph`**，彼此只差 `options.graphOptions`
（后端 `apps/datacore/src/synthetic/service.ts:1624 (graphView)` 起 8 行）：

| 导航标题 | key | graphOptions（生产真值） | 与 #1 本体图谱的真实差别 |
|---|---|---|---|
| 图谱·全景 | `graph-all` | `{colorBy:"domain", layoutSeed:42}` | **无差别**（等于前端默认值，见 §2.1） |
| 图谱·主干分级 | `graph-backbone` | `nodeFilter:{tiers:[0,1]}` + `dimOthers` | 真差别：只亮一/二级节点 |
| 图谱·产能推演网络 | `graph-flow` | `linkKinds:["flow","agg"]` | 真差别：只画流量/聚合边 |
| 图谱·数据来源 | `graph-source` | `colorBy:"source"` | 真差别：按源系统着色，派生/求解/智能体淡出 |
| 图谱·求解器 | `graph-solver` | `nodeFilter:{domains:["solver"]}` + `linkKinds:["calc"]` | 真差别 |
| 图谱·MVP | `graph-mvp` | `mvpOverlay:true` | 真差别：缺口节点 ⊕ 虚线 |
| 图谱·智能体网络 | `graph-agent` | `nodeFilter:{domains:["agent","solver"]}` + `linkKinds:["orch"]` | 真差别 |
| 图谱·学习闭环 | `graph-loop` | `nodeFilter:{ids:LOOP_NODE_IDS}` + `linkKinds:["fb","orch"]` | 真差别 |

**7/8 是真视角，1/8（全景）是重复入口。** 八项确实被下发（`service.ts:56 (PLANVIEW_EXTRA_KEYS)`
含全部 8 键 → `service.ts:247` → `seedViewConfigs`），**不是幽灵条目**——这一点我特意追到了下发侧，
没有停在 grep 到 `NAV_GROUPS` 就收工。

### 1.3 相邻但归在别处（1 项）

| 导航标题 | key | 位置 | 干什么 |
|---|---|---|---|
| **系统自我** | `meta` · admin | 「平台与系统」组 | 把**平台自身**的本体（本文件所属的 SYSTEM-ONTOLOGY.md）投影成对象，做「改 R14 影响什么」图查询 |

归组正确：它建模的是**平台自己**，不是租户业务本体。`adminRegistry.ts:99` 与 `ShellLayout.tsx:130`
两处已对齐（历史上漂过一次，注释里有账）。

---

## 2 · 四条核心发现（每条带 `file:line` 证据链）

### 2.1 【最重要】「本体图谱」与「图谱·全景」是**同一个页面的两个配置，且那个配置是空的**

仓主问的第三个问题，答案是：**它们没有区别 —— 渲染输出逐像素相同。**

**证据链（沿链路走，不是 grep 一次）**：

1. **两者 renderer 相同**
   - `apps/datacore/src/synthetic/view-manifest.ts:60 (BUILTIN_VIEWS)` → `graph` renderer=`ontology-graph`，`layout:{}`，**无 `options`**
   - `apps/datacore/src/synthetic/service.ts:1532 (graphView)` → 工厂函数，renderer 写死 `ontology-graph`
   - `apps/datacore/src/synthetic/service.ts:1624 (graphView)` → `graph-all` 用该工厂，故 renderer 同为 `ontology-graph`

2. **`graph` 到达前端时 `options` 不存在**
   - `apps/datacore/src/synthetic/service.ts:1580 (CORE_VIEW_LAYOUTS)` → `graph: {}`
   - `apps/datacore/src/synthetic/service.ts:1595 (BUILTIN_VIEWS)` → VIEW_DEFS 仅在 `bv.options` 存在时才带 `options`；`graph` 没有 ⇒ 不带
   - `apps/datacore/src/synthetic/service.ts:1704 (VIEW_DEFS)` → 同样条件下发到 `ViewConfig.views[]`

3. **前端对「无 options」的回落，恰好等于 `graph-all` 的显式配置**
   - `apps/frontend-shell/src/views/OntologyGraphView.tsx:82 (GraphOptionsSchema)` → `safeParse(undefined)`；
     `packages/contracts/src/planviews.ts:247 (GraphOptionsSchema)` 是 `z.object({...})`，**parse `undefined` 必失败**
   - `apps/frontend-shell/src/views/OntologyGraphView.tsx:69 (DEFAULT_OPTIONS)` → 回落值 `{colorBy:"domain"}`
   - `apps/frontend-shell/src/views/OntologyGraphView.tsx:188 (seed)` → `seed={graphOptions.layoutSeed ?? 42}`

4. **逐分支比对两者的"有效配置"**（这一步是判据，不是感想）

   | 分支 | 消费点 | `graph`（回落） | `graph-all`（显式） | 同否 |
   |---|---|---|---|---|
   | `nodeFilter` | `OntologyGraphView.tsx:104` | `undefined` → `filterOn=false` → 全选 | `undefined` → 全选 | ✅ 同 |
   | `dimOthers` | `:117` | falsy，但 subset 含全部 → 全可见 | 同 | ✅ 同 |
   | `linkKinds` | `:121` | `undefined` → 全边 | `undefined` → 全边 | ✅ 同 |
   | `mvpOverlay` | `:116/:130` | falsy | falsy | ✅ 同 |
   | `colorBy` | `:132` | `"domain"` | `"domain"` | ✅ 同 |
   | `layoutSeed` | `:184/:188` | `undefined ?? 42` = **42** | **42** | ✅ 同 |

   **六个分支全同 ⇒ 渲染输出相同。**

5. **唯一本应存在的差别（视角描述卡）在生产链路上是死的** —— 见 §2.1b。

> **定性**（照铁律 0.5 的三分法）：这不是"没接线"，是**「接了线接错地方」+「接了线没数据」**的叠加。
> `graph-all` 的 `graphOptions` 接线是通的、有数据，但数据值恰好等于默认值 ⇒ 等价于没配。
> 断点 ID：`G-GRAPH-ENTRY-DUP`。

#### 2.1b 视角描述卡：后端写 `layout.description`，前端读 `options.desc` —— **字段名与容器双重错位**

这是本单**次重要**的发现，也是 §2.1 之所以成立的直接原因：八视角本来各有一段叙事描述卡，
**生产态一张都渲染不出来**。

| 侧 | 写/读的位置 | 容器 | 字段名 |
|---|---|---|---|
| **生产后端** | `apps/datacore/src/synthetic/service.ts:1532 (graphView)` 第 3 形参 = `layout` | `layout` | `description` / `descriptionLink` |
| | `apps/datacore/src/synthetic/service.ts:1624 (graphView)` · `:1635 (descriptionLink)` | | |
| **前端读** | `apps/frontend-shell/src/views/OntologyGraphView.tsx:85 (desc)` · `:86 (descLink)` | `options` | `desc` / `descLink` |
| **渲染** | `apps/frontend-shell/src/views/OntologyGraphView.tsx:165 (desc)` → `data-testid="graph-desc-card"` | — | — |
| **Mock** | `apps/frontend-shell/src/mocks/fixtures.ts:471 (desc)` · `:486 (descLink)` | `options` | `desc` / `descLink` ✅ **与前端一致** |

**容器错位**（`layout` vs `options`）**叠加字段名错位**（`description` vs `desc`）
⇒ `desc` 恒 `undefined` ⇒ `{desc && (...)}` 恒不渲染。

**为什么没被任何测试抓到**（假绿形态复现）：
- **mock 走的是对的形状，生产走的是错的形状** —— 这正是 CLAUDE.md 铁律 0.5 判据 #6 说的
  「生产实参与测试实参交集为空」。MSW mock 模式下描述卡**会**出现，真后端下**永远不会**。
- **`graph-desc-card` 零测试引用**（否定结论，附金丝雀见 §3）。

> 断点 ID：`G-GRAPH-DESC-CONTRACT-SPLIT`。
> **修法提示（不在本单范围）**：改前端读 `view.layout.description/descriptionLink` 一处即可（后端 8 处不动），
> 或统一收进契约 `ViewConfigSchema`。**注意 mock fixtures 也须同步**，否则修完 mock 反而坏。

---

### 2.2 「对象/类型浏览器」点「看实例」没反应 —— **面板渲染在页尾，且无滚动定位**

仓主问的第二个问题。代码里 **onClick 是接了的**，所以「没反应」不是没接线，而是**反应发生在屏幕外**。

**两个叠加机制，都在 `apps/frontend-shell/src/pages/admin/ObjectTypesBrowserPage.tsx`**：

1. **主因 · 面板渲染在整页最底部，没有任何滚动定位**
   - `:110 (setSelected)` → 按钮 `onClick={() => setSelected(s)}`（**接线正常**）
   - `:92 (byDomain)` → 先渲染**全部 14 个域面板**，每个域一张表
   - `:119 (InstancePanel)` → 实例面板渲染在**所有域面板之后**，即页面最末
   - 该文件**零 `scrollIntoView`、零 `useRef`、零 Modal**（否定结论，金丝雀见 §3）

   demo 租户下已发布对象类型约 **94 个**（可由 `slices` 页 94 条 `coverage_*` 覆盖切片交叉印证，
   `apps/frontend-shell/src/pages/admin/SlicesPage.tsx:36` 注释记录了该实测）。
   ⇒ 用户在第 1 个域的表里点按钮，面板出现在几千像素之下，**视口内毫无变化**，观感就是"点了没反应"。

2. **次因 · 零物化类型的按钮是 `disabled`**
   - `:110 (setSelected)` → `disabled={s.count === 0}`
   - `:107` → 该行「物化对象数」显示为灰色 `0`
   - `count` 是真算的（`apps/datacore/src/app.ts:2182 (mergedInto)`），不是恒 0
   ⇒ 对 `count===0` 的类型，点击**确实**不会有任何反应，且这是设计行为。

> **定性**：#1 是**交互缺陷**（有反应但不可见），#2 是**可供性缺陷**（禁用态不够明显）。两者修法不同，不许合并成一句。
> 断点 ID：`G-OT-INSTANCE-PANEL-OFFSCREEN`。
> **诚实边界**：本单为轻画像，未启服务实拍。以上为静态代码结构推定 —— #2 由代码可**确证**，
> #1 是 `:119` 渲染位置 + 无滚动定位的**结构性后果**，建议修复前用真后端实拍一次坐实。

---

### 2.3 「本体切片」与「切片库」：**同一个规划器，两个入口**

仓主问的第一个问题（「本体建模工作台 vs 本体切片的价值区别」）在追查中暴露出一个他没问到的重复：
**真正难分的不是「建模 vs 切片」，而是「本体切片 vs 切片库」。**

先答仓主原问 —— 这一对**是真差别，不该合并**：

| | 本体建模（`modeling`） | 本体切片（`slices`） |
|---|---|---|
| 动词 | **建**（写） | **取**（读） |
| 输入 | 原始数据集 `RawDataset` | 已发布的 `ObjectType` 图 |
| 产出 | 新 `ObjectType`（草案→发布→物化） | 可追溯子图 root→hops |
| 何时点它 | 「我有一批新数据，要变成对象类型」 | 「本体已建好，我要圈一块子图喂给求解器/契约」 |

**但 `slices` 与 `slice-library` 是同一功能的两份配置**：

| 维度 | 本体切片 `slices` | 切片库 `slice-library` | 同否 |
|---|---|---|---|
| 列表数据源 | `endpoints.ts:1110 (fetchSlices)` → `/a/v1/ontology/slices`（**已注册**切片） | `endpoints.ts:1117 (fetchSliceLibrary)` → `/a/v1/slices/library`（**派生**域内/跨域库） | ❌ 真差别 |
| 规划器 | `SlicesPage.tsx:214 (planSlice)` | `SliceLibraryPage.tsx:140 (planSlice)` | ✅ **同一函数** `endpoints.ts:1113 (planSlice)` |
| 子图检视器 | `SlicesPage.tsx:187 (SliceInspector)` | `SliceLibraryPage.tsx:107 (SliceInspector)` | ✅ **同一组件** |

规划器甚至是**同一个端点的两次调用**，只是 `slice-library` 那次多传了 `maxHops`/`question`
（`endpoints.ts:1113 (planSlice)` 的 `opts` 形参）—— 即**切片库的规划 tab 严格更强**，
而「本体切片」页的「新建切片」是它的**功能子集**。

> 断点 ID：`G-SLICE-ENTRY-DUP`。定性：**「接了线接错地方」** —— 两个入口都接对了后端，
> 但同一个能力挂了两个导航位，用户必须读代码才知道该点哪个。

---

### 2.4 附带发现（不在原问范围，但同源）

| # | 发现 | 证据 | 定性 |
|---|---|---|---|
| a | **Mock 与生产对 8 视角的 featureKey + 标题全不一致** | 生产 `apps/datacore/src/features.ts:199 (VIEW_FEATURE_MAP)` = `view.graph.persp.all`／标题「图谱·全景」；mock `apps/frontend-shell/src/mocks/fixtures.ts:187` = `view.graph-all`／名「图谱·业务建模全景」 | mock 漂移。mock 模式下关某个视角的开关，行为与生产不同 |
| b | **Mock 与生产 `layoutSeed` 不同** | 生产 8 视角**全部** `layoutSeed:42`（`service.ts:1624-1636`）；mock 用 23/29/31（`fixtures.ts:470/477/484`） | mock 模式与生产**布局不同**，前端截图对不上生产 |
| c | **`ShellLayout.tsx:117` 注释「图谱页内亦可 tab」与实现不符** | `OntologyGraphView.tsx` 全文对 `tab` 的命中**只有 `<table>`**（金丝雀见 §3）——页内**没有**视角 tab | 陈旧注释。它正是"八视角必须各占一个导航位"的原因，注释却暗示已有页内切换 |
| d | **`VIEW_FEATURE_MAP` 里的 `ontology-graph` 别名疑似无下发方** | `apps/datacore/src/features.ts:192 (VIEW_FEATURE_MAP)` 注册了 viewKey `ontology-graph`，但 `BUILTIN_VIEWS`/`PLANVIEW_EXTRA_KEYS` 均无此键 | **未下定论** —— 别名可能由 `app.ts:972` 的 `view.graph` 反向别名或运维自建 ViewConfig 消费。照铁律 0.5，未追到底不报"死代码" |

---

## 3 · 金丝雀证据（铁律 0.6 · 所有否定结论的自证）

本单共下 **4 个否定结论**，逐条附「已知必中」样例。金丝雀均选**只可能存在于被测维度**的对象。

| # | 否定结论 | 金丝雀（已知必中） | 金丝雀实测 | 结论实测 |
|---|---|---|---|---|
| 1 | `graph-desc-card` **零测试引用** | 同一次 grep 中，该 testid 在**组件内**必然命中 | `OntologyGraphView.tsx:166` + `:169` **2 命中** ✅ 工具正常 | 全仓 `apps/frontend-shell/src`+`apps/datacore/src`+`scripts` 除上述 2 处外 **0 命中** |
| 2 | `ObjectTypesBrowserPage.tsx` **零 `scrollIntoView`** | 该模式在前端**确实存在**于别处 | `apps/frontend-shell/src/pages/TaskDetailPage.tsx` **命中** ✅ 工具正常 | 目标文件 **0 命中** |
| 3 | `OntologyGraphView.tsx` **无视角 tab** | `grep -n "tab\|Tab"` 对该文件 | **2 命中，均为 `<table>`/`</table>`**（`:540`/`:562`）✅ 工具正常且区分得出 | 无任何 tab 组件/状态 |
| 4 | `descLink` 在 **datacore 侧零写入方** | 同一次 grep 跨两目录，前端侧必然命中 | `OntologyGraphView.tsx:86/168/169/170` + `fixtures.ts:486` **5 命中** ✅ 工具正常 | `apps/datacore/src` **0 命中** |

**额外工具自证**（针对已知会骗人的两个工具，铁律 0.6 表格 #1/#4）：

- 本单**全程未使用** `git grep -- "apps/*/src"` 这种 pathspec（`*` 不跨 `/`，恒 0 命中）。
  所有搜索用 `grep -rn <sym> apps/frontend-shell/src apps/datacore/src` 显式列目录。
- `G-` 断点 ID 枚举用 `node -e` 全文正则（**无截断窗口**，避开 `G-NO-FREIGHT-COST` 被截成 `-CO` 那类事故），
  金丝雀 `G-5` 命中 `true`，实测 **133 个 distinct ID**。

**分支前置自证**（铁律 0.6 第 2 条机制 · 判据是祖先关系不是文件存在性）：
```
HEAD(开工前) = 778cc589c6c06089304ddbc666cf7d0721ad492d
CANON        = c7b9206e75ceb4d8d52f491c53d0ef2285a7cc2d (origin/claude/inspiring-gates-aqczjg)
git merge-base --is-ancestor HEAD $CANON → 真 ⇒ 落后 ⇒ 已从 canonical 重开分支
```

---

## 4 · 合并/改名建议

**判据只有一条**：*站在导航栏前的用户，能不能只凭标题就知道该点哪个。*
凡我自己都要读代码才说得清差别的，就是该合并或该改名的。

> ⚠️ **本节只出建议，不改任何 `NAV_GROUPS` / `adminRegistry.ts` / 路由。** 导航信息架构是产品决策，
> 与「feature flag defaultOn 由仓主决定」同源。**全部 4 条主建议均需仓主裁决。**

### 建议 A（P0 · 强烈建议）· 「图谱·全景」退役，或给「本体图谱」一个真配置

**问题**：两个入口渲染输出相同（§2.1）。

| 选项 | 改法 | 影响面 | 风险 |
|---|---|---|---|
| **A1（推荐）** | 从「图谱体系」组删 `graph-all`，让「本体图谱」承担全景角色；八视角变七视角 | `ShellLayout.tsx:121`（删 1 键）· `service.ts:56 (PLANVIEW_EXTRA_KEYS)`（删 1 键）· `service.ts:1624`（删 1 行）· `features.ts:47`+`:199`（删 2 行）· `fixtures.ts:187`（mock 同步） | **中**。`view.graph.persp.all` 是已注册 feature，删除影响既有租户 entitlement 记录；建议改为保留 feature、只摘导航项 |
| **A2** | 保留两者，但把「本体图谱」改成**默认落地页 + 视角切换器**（页内 tab），八视角降为页内 tab 而非 8 个导航项 | 同上 + `OntologyGraphView.tsx` 需新增 tab（`ShellLayout.tsx:117` 注释**已如此承诺**，实现从未做，见 §2.4c） | **中高**。是最干净的 IA，但工作量最大；可作为 A1 之后的第二步 |
| **A3（最小）** | 只改名：`graph` → 「本体图谱（总览）」，`graph-all` → 删；或给 `graph` 配一个**真不同**的 graphOptions | 仅 `view-manifest.ts:60` + `service.ts:1624` | **低**，但治标不治本 |

**门影响**：`nav-group-coverage:check` 判据①②对账「后端 seeded 视图 ↔ NAV_GROUPS」两侧。
**摘导航项必须同时摘后端下发键**，否则该门会红（这正是它的设计意图）。

---

### 建议 B（P0 · 建议直接修，非 IA 决策）· 修复视角描述卡的契约错位

**问题**：`G-GRAPH-DESC-CONTRACT-SPLIT`（§2.1b）—— 八视角的叙事描述**生产态一张都不显示**。

**改法**（前端一处，最小）：
`apps/frontend-shell/src/views/OntologyGraphView.tsx:85-86` 改为读
`view.layout.description` / `view.layout.descriptionLink`，并把 `descriptionLink` 从 `string`
适配为组件期望的 `{to,label}`（后端 `service.ts:1635` 当前只给字符串 `"/admin/calibration"`，
**label 在后端根本不存在** —— 这是第三处错位，修时必须一并定契约）。

**影响面**：`OntologyGraphView.tsx:85/86/168-171` · `fixtures.ts:471/478/485/486`（mock 须同步，否则修完 mock 坏）
**风险**：**低**（纯读取侧）。**但必须补一条断言真后端形状的测试**，否则修完仍是同一个假绿。
**是否需裁决**：❌ 不需要 —— 这是缺陷修复，不是 IA 决策。**建议单独开一张 WO。**

---

### 建议 C（P1）· 「本体切片」与「切片库」合并为一页两 tab

**问题**：`G-SLICE-ENTRY-DUP`（§2.3）—— 同一个规划器、同一个检视器，两个导航位。

**改法**：合并为单一入口「**本体切片**」，页内两 tab：
- 「已注册」（现 `slices` 的列表 + 推进为契约）
- 「派生库」（现 `slice-library` 的域内/跨域）
- 「规划」收敛为**一个**（保留 `slice-library` 那版，因它严格更强：多 `maxHops`/`question`）

**影响面**：`ShellLayout.tsx:114`（删 `slice-library`）· `adminRegistry.ts:49`+`:94`（删登记）·
`SlicesPage.tsx` 与 `SliceLibraryPage.tsx` 合并 · `App.tsx` 路由
**风险**：**中**。两页都有 admin/非 admin 权限分支（`SlicesPage.tsx:45` / `SliceLibraryPage.tsx:59`
都调 `baseRoles`），合并时权限判定须逐条对齐，漏一条就是越权。
**是否需裁决**：✅ **需要** —— 减少一个导航位是 IA 决策。

**改名兜底方案**（若不合并）：当前「本体切片」/「切片库」两个标题**看不出差别**。
建议改为「**本体切片（已注册）**」/「**切片库（自动派生）**」—— 零风险，纯 label 改动
（`zh.ts:91`/`:92`），但仍留两个导航位。

---

### 建议 D（P2）· 「建模与图谱」组收窄，两项迁出

**问题**：该组 9 项里有 2 项语义上不属本体域，稀释了分组的可辨识度。

| 项 | 现组 | 建议组 | 理由 |
|---|---|---|---|
| `boundary` 边界册治理 | 建模与图谱 | **平台与系统** | 它治理的是**业务常数册**（基地/细分/规划目标）与其版本指纹，不是本体对象类型 |
| `prototype-intake` 原型 intake | 建模与图谱 | **数据接入** | 它是 `prototype_html` **连接器**的上传入口，与 `connections` 同族；产出是 `RawDataset` 不是 `ObjectType` |

迁出后「建模与图谱」= 7 项（图谱 + 建模 + 浏览 + 域 + 切片×2 + 合并），语义纯净。

**影响面**：`ShellLayout.tsx:114` · `adminRegistry.ts:94`（`modeling` 组）+ `:92`/`:99`（目标组）
—— **两个文件必须同改**，这正是历史上漂过的地方（`ShellLayout.tsx:112-113` 注释有账）。
**风险**：**低**（纯归组，无路由/权限变更）。
**是否需裁决**：✅ **需要**（IA 决策）。

---

### 建议 E（P1 · 非 IA）· 「看实例」体感修复

`G-OT-INSTANCE-PANEL-OFFSCREEN`（§2.2）。三选一，**都不改导航**：

| 选项 | 改法 | 影响面 | 风险 |
|---|---|---|---|
| **E1（推荐）** | 实例面板改为 `Modal`（仓内已有 `components/ui/Modal`，`ModelingPage.tsx:19` 已在用） | `ObjectTypesBrowserPage.tsx:119` | 低 |
| **E2** | 面板保持原位，加 `ref` + `scrollIntoView({behavior:"smooth"})` | 同上 + 新增 `useRef`/`useEffect` | 低 |
| **E3** | 面板就地内联到被点击的**那一行下方**（与 `SlicesPage.tsx:187` 的 `SliceInspector` 同款交互，全仓一致） | `:92-117` 渲染结构 | 中 |

**另**：`count===0` 的禁用按钮建议加 `title="无物化实例"`，把"禁用"说出来（`:110`）。
**是否需裁决**：❌ 不需要（缺陷修复）。建议与建议 B 合并成一张前端 WO。

---

## 5 · 汇总：哪些是"功能不同"，哪些是"同一功能的不同配置"

| 入口对 | 判定 | 证据 |
|---|---|---|
| 本体图谱 ↔ 图谱·全景 | 🔴 **同一功能同一配置**（完全重复） | §2.1 六分支比对 |
| 本体图谱 ↔ 其余 7 视角 | 🟢 功能相同、**配置真不同** | `service.ts:1625-1636` graphOptions 各异 |
| 本体建模 ↔ 本体切片 | 🟢 **功能不同**（建 vs 取） | §2.3 上半表 |
| 本体切片 ↔ 切片库 | 🟠 **列表源不同、规划器与检视器完全相同** | §2.3 下半表 |
| 对象/类型浏览 ↔ 本体图谱 | 🟢 **功能不同**（表格下钻 vs 关系图） | 数据源与交互均不同 |
| 域管理 ↔ 对象/类型浏览 | 🟢 功能不同（**治理**域 vs **按域查看**类型） | `DomainsPage.tsx:19` 写 vs `ObjectTypesBrowserPage.tsx:51` 读 |
| 系统自我(meta) ↔ 本体图谱 | 🟢 **功能不同**（平台自身元模型 vs 租户业务本体） | `MetaPage.tsx:42` |

**只凭标题就能选对的**：建模 / 合并 / 域管理 / 系统自我。
**必须读代码才说得清的**：本体图谱 vs 图谱·全景 · 本体切片 vs 切片库 —— **这两对就是该动的。**

---

## 6 · 复验命令（交给下一个 dev / 审核方）

```bash
# F1 · 本体图谱与图谱·全景同 renderer
grep -n 'key: "graph"' apps/datacore/src/synthetic/view-manifest.ts
grep -n '"graph-all"' apps/datacore/src/synthetic/service.ts
grep -n 'DEFAULT_OPTIONS' apps/frontend-shell/src/views/OntologyGraphView.tsx     # 期望 :69 与 :83

# F2 · 描述卡契约错位（后端 layout.description / 前端 options.desc）
grep -rn "descLink" apps/datacore/src apps/frontend-shell/src --include=*.ts --include=*.tsx
#   期望：datacore 侧 0 命中；frontend 侧 5 命中（含 mock fixtures.ts:486 —— 这就是金丝雀）

# F3 · 看实例面板位置 + 无滚动定位
grep -n "InstancePanel\|setSelected\|scrollIntoView" apps/frontend-shell/src/pages/admin/ObjectTypesBrowserPage.tsx
grep -rln "scrollIntoView" apps/frontend-shell/src        # 金丝雀：TaskDetailPage.tsx 必中

# F4 · 切片两页共用同一规划器
grep -n "planSlice\|SliceInspector" apps/frontend-shell/src/pages/admin/SlicesPage.tsx \
                                    apps/frontend-shell/src/pages/admin/SliceLibraryPage.tsx

# 本体锚点门（本单唯一允许跑的脚本）
node scripts/check-ontology-anchors.mjs
```

---

## 7 · 本单**推翻**的派单前提

派单表格里有两条与实测不符，按本仓惯例直接顶回：

| 派单原文 | 实测 | 差在哪 |
|---|---|---|
| 「图谱·全景 …… 只是**多带** `graphOptions:{colorBy:"domain",layoutSeed:42}`」 | 属实，但**结论更强**：这组值**恰好等于前端默认值**（`OntologyGraphView.tsx:69` + `:188` 的 `?? 42`），所以「多带」等于「没带」 | 派单说的是"两个配置不同"，实际是"**两个配置等价**" —— 从"配置差异小"升级为"**零差异**"，建议 A 的力度随之改变 |
| 「图谱·全景」被列为与「本体图谱」并列的**单个**入口 | 实为**八视角之一**（`service.ts:1624-1636` 八行 + `ShellLayout.tsx:121` 八键） | 派单把 8 个入口数成了 1 个。**本体域实际入口是 18 个不是 5 个**，问题规模大 3 倍 |

派单表其余 3 行（本体建模 / 对象类型浏览器 / 本体切片）**逐条复验属实**，
`file:line` 与实测一致，未作改动。

**派单未提、本单补上的**：`domains`（域管理）· `merge`（实体合并）· `boundary` · `prototype-intake`
· `meta`（系统自我）· 以及 `graph-backbone` 等 7 个视角 —— 共 12 个入口。
