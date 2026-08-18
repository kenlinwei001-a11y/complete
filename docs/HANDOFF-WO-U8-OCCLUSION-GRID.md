# WO-U8-OCCLUSION-GRID 交单报告 —— B 线遮挡报告更细粒度纯加性并入 A 线门

分支：`claude/handoff-wo-u8-occlusion-grid`（**stacked**：从 A 线 tip `f209c6cf` 长出，非集成线）
复验入口：`node scripts/check-harness-ux-behavior.mjs --selftest`（金丝雀九向 RC=0）· 全量真跑 `node scripts/check-harness-ux-behavior.mjs`（12 页）

裁决背景（仓主 2026-08-18 条件 b）：B 线（已归档 `fdd19a43d`）的 U8 遮挡量测报告粒度更细 ——
**九宫格分区定位 + coverRect**，A 线只报采样点坐标与覆盖百分比。真优势不丢，纯加性追加进 A 线门。

---

## ① 修前后对照

| 维度 | 修前（A 线 `f209c6cf`） | 修后（本单，纯加性） |
|---|---|---|
| 被压采样点定位 | 只有像素坐标 `at`（如 "78,66"） | `at` 原样保留，追加**九宫格分区名** `cell`（左上/上中/右上/左中/正中/右中/左下/下中/右下） |
| 压人元素 | 只有 `<tag.class>` 字符串 + `byText` | 追加**压人元素像素矩形** `byRect`（{x,y,w,h} 相对视口） |
| 被压区域 | 无 | 追加 `occludedRect`（全部被压采样点的包围盒 = B 线 coverRect 的 A 线对应物；口径 = 采样点包围盒，非精确遮挡区域，docstring 已自陈） |
| covers 条目 | tag/cls/text/coverPct | 追加被盖元素自身矩形 `rect` |
| judgeOcclusion 文案 | `78,66 被 <div.x>「…」压住` | `78,66（右下） 被 <div.x>「…」压住` + `（被压区域 ≈ W×H@x,y）`——**旧读数一字未删，只增** |
| 判据/对账语义 | §4.2.3 三向对账 | **原样保留，一行未动**（见 ② 边界证据） |

**范围边界**：只碰 `scripts/lib/layout-probe.mjs` + `scripts/check-harness-ux-behavior.mjs`。
PRD §4.2.3 登记表 9 笔欠账键未动、`gate-ledger.json` 未动、`apps/**` 一行未动。

## ② diff 两实现的结论（B 有哪几维、各怎么落的）

B 线 `measureOcclusion`（`git show fdd19a43d:scripts/lib/layout-probe.mjs`）vs A 线 `measureOcclusionInPage`，
B 有而 A 无的确切维度共四条，处置如下：

| # | B 有 A 无的维度 | 处置 | 落法 |
|---|---|---|---|
| 1 | **九宫格分区名**（cells：被盖采样点落在目标的哪个方位） | ✅ 并入 | A 的 3×3 采样点本来就有 fx/fy ∈ {0.15,0.5,0.85}，行列序号沿用 B 线同一个公式（`Math.min(2, floor(相对位置×3))`，按真实采样点位置算不按循环下标），命名按中文自然阅读序（四角列+行「右下」、边中点方向在前「下中」、中心「正中」；B 线源码是行+列「下右」式，本单按 WO 金丝雀措词「左下/右下」取自然序） |
| 2 | **压人元素矩形**（B 线 per-occluder `rect`） | ✅ 并入 | 每个 occludedBy 点追加 `byRect` = 栈顶元素 `getBoundingClientRect` |
| 3 | **coverRect**（被盖采样点的像素包围盒） | ✅ 并入 | A 线逐点已带坐标，聚合一笔总包围盒 `occludedRect`（无被压点时为 null） |
| 4 | **网格密度参数化**（stepX/Y = max(4, w/40, h/30)，约 40×30 网格） | ❌ 不并入（有意） | 它会把 samples 从 9 改成 ~1200，从而改变 judgeOcclusion 的「N/M 点」读数与 §4.2.3 对账语义（欠账属实/未登记判红的计数面全变）——**那是替换不是加性**，WO 边界明令不许替换判据逻辑/对账语义 |

另：A 线独有的 `covers` 维（浮层盖住了哪些文本元素）B 线没有，原样保留并追加 `rect`。

## ③ 金丝雀证据 + 真浏览器全量亲跑（本机 Chrome，2026-08-18）

`--selftest`（金丝雀**九向**，RC=0）：

> ✓ 必咬①改输入即变探到 changed（107ms）· 必咬②提交闸探到 unchanged 且对「符合」格判红、对「不符合」格放行 · 必咬②b 纯回显归因为 echo · 判据单元四向 · 必咬③被压浮层报出 4/9 个被压采样点并判红（方位 正中/下中/右中/右下 · byRect/occludedRect 命中夹具真值）· **方位变异向只压右下角报出且只报出「右下」** · 必不咬置顶浮层 0 误报且盖住 1 个文本元素（covers 带被盖元素矩形）· 对账⑤三向 · 解析⑥§4.2.3 登记表

金丝雀加向明细（同一套 CANARY_OCCLUDED 夹具，原夹具一个字未改）：

- **必咬③新维度断言**：分区集合必须恰为 {正中，右中，下中，右下}；`byRect` 必须 = 240×160 且相对浮层右 60 下 40（**相对几何断言** —— 夹具视口原点受 body margin/外边距折叠影响，本单首轮绝对坐标断言咬错对象，改成相对断言才咬的是真维度）；`occludedRect` 必须存在且落在压人块矩形内部。
- **逐点方位映射**（后补，原因见 ④）：x 最大的被压点必须是「右中」、y 最大的必须是「下中」。
- **方位变异向（新夹具 CANARY_OCCLUDED_CORNER）**：遮挡块只罩浮层右下角一个采样点 ⇒ 报告必须说出且只说出「右下」（长度=1 ∧ cell=「右下」）。右下角在对角线上咬不到行/列互换，该责由逐点映射担（注释已自陈）。
- **必不咬追加**：covers 命中条目必须带 `rect`（w>0 ∧ h>0）。

**全量真跑（VITE_MOCK=1 dev server，本机 Chrome，12 页，RC=0）**：

> ══ 合计：B-1 判了 11 页 · 未判（无可编辑输入）1 页（cleanroom-attr，如实报未判）· U8 触发器 67 个 · 开出浮层 52 个 · §4.2.3 欠账 9/9 笔照单属实 ══
> ✓ harness-ux-behavior 通过（B-1 对账 11 页逐格一致 · U8 浮层 52 个无未登记遮挡 · §4.2.3 欠账 9/9 笔照单属实 · 时窗 5000ms）

**四个计数与 A 线基线（f209c6cf 交单读数 11 页 / 67 触发器 / 52 浮层 / 9/9 欠账）逐项相同** ——
加性改动零行为漂移的机器证据。

真页面上新读数的样子（global-sim 一笔在册欠账，照单属实放行）：

> 浮层 rect=380×260@431,654 被压 3/9 点（488,875（左下） 被 \<input.\> 压住 · 621,875（下中）… · 754,875（右下）…）（被压区域 ≈ 266×0@488,875）

—— 改前只会说「488,875 被 \<input.\> 压住」，现在直接说出**压在浮层的左下→右下一条**。

**环境性记账（如实）**：本机负载 570–770 期间两轮全量跑都在「登录表单 30s 未渲染」上 RC=2，
初判像 Chrome 握手超时；**追一层后真因不是负载** —— worktree 里 `@platform/contracts` 的 dist 未构建，
vite 转换报 `Failed to resolve entry for package "@platform/contracts"`（pnpm install 不带 build 的老坑）。
`pnpm --filter @platform/contracts build` 后 + 预热脚本（/tmp/u8-warm.mjs，登录+12 路由各开一遍捂热
vite 按需编译缓存，35s 完成）⇒ 全量一轮通过。**复验方若遇同样「登录 30s 超时」，先 build contracts，不是重跑。**

## ④ 变异反证（亲手做，两遍全中）

| 变异（改 `layout-probe.mjs` 真实现） | 期望 | 实测 |
|---|---|---|
| ① 行/列序号互换（cx↔cy） | selftest 必须红 | **RC=2** ✓：「最右被压点（254,321）必须是『右中』，实得『下中』」「最下被压点（169,378）必须是『下中』，实得『右中』」 |
| ② 丢掉 byRect（恒 null） | selftest 必须红 | **RC=2** ✓：「byRect 应是压人块矩形…实得 …→null」+ occludedRect  containment 同步红 |

**反证的反证（如实记账）**：变异①第一遍**漏网了**（RC=0）——分区集合断言 {正中，右中，下中，右下}
恰好转置对称，行列互换后集合不变；右下夹具在对角线上同样咬不到。当场补「逐点方位映射」断言后
重做，变异①才被咬住。**「集合对不等于逐点对」这个教训已写进断言注释**，防下一个人再踩。
两遍变异后均还原，干净实现 selftest RC=0。

## ⑤ 界外发现（均非本单引入，照实记账）

1. A 线 3×3 采样比 B 线 ~40×30 网格粗：比采样间距还细的遮挡条 A 线本来就会漏（本单不扩网格，
   理由见 ② #4）——`occludedRect` 的口径是「被压采样点包围盒」，不是精确遮挡区域，docstring 已自陈。
2. **gate-ledger.json 该门 `provenRed.note` 里的「金丝雀八向」表述随本单过期为九向** —— WO 边界
   明令不许动 provenRed，故原样保留，在此记账；收编方若获准可一句带过（八向→九向，多「方位变异」向）。
3. worktree 直跑本门前必须 `pnpm --filter @platform/contracts build`（vite 报 `Failed to resolve entry
   for package "@platform/contracts"` 时症状 = 登录表单 30s 超时 RC=2，极易误判成 Chrome 握手/负载问题
   —— 本单亲历，两轮 RC=2 后才追到真因）。

## ⑥ 前置门 RC（本机亲跑）

| 门 | RC | 备注 |
|---|---|---|
| `check-harness-ux-behavior.mjs --selftest` | 0 | 金丝雀九向（见 ③） |
| `check-harness-ux-behavior.mjs`（真浏览器 12 页全量） | 0 | **亲跑过**（见 ③；两轮环境性 RC=2 的真因 = contracts dist 未构建，修后一轮通过） |
| 变异反证两遍 | — | 见 ④（两遍均红，还原后 RC=0） |
| `check-branch-base.mjs wo-u8-occlusion-grid --onto=f209c6cf` | 0 | stacked 分支，onto = A 线 tip；分叉点 = f209c6cf，落后 0 提交 |
| `check-merge-conflict-markers.mjs` | 0 | 2166 个被跟踪文本文件零标记，金丝雀 7/7 |
