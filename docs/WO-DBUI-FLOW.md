# WO-DBUI-FLOW · 数据构建发动机：按「故事 → 缺口 → 建 → 复验 → 入库/下载」重排，并补上入库前的冲突复验

<!-- wo-anchors: allow-missing: apps/frontend-shell/src/pages/admin/DataBuilderFlow.tsx, apps/frontend-shell/src/pages/admin/PromotePrecheckPanel.tsx, apps/frontend-shell/test/dbui-flow.seam.test.tsx, apps/datacore/test/promote-precheck.test.ts -->

## 🚦 范围边界（本单身份）

**只碰**：
- 前端：`apps/frontend-shell/src/pages/admin/DataBuilderPage.tsx` · 新建 `DataBuilderFlow.tsx` / `PromotePrecheckPanel.tsx` · `api/endpoints.ts` · `locales/zh.ts` · `mocks/**`
- 后端：`apps/datacore/src/databuilder/service.ts`（限 `promoteDomain` 与新增预检）· `apps/datacore/src/app.ts`（限 `/a/v1/databuilder/*` 路由）· `packages/contracts/src/databuilder.ts` 或 `storybuildrun.ts`
- 测试：`apps/frontend-shell/test/dbui-flow.seam.test.tsx` · `apps/datacore/test/promote-precheck.test.ts`
- `docs/SYSTEM-ONTOLOGY.md`

**不碰**：`apps/agentcore/**` · 其它 admin 页 · `views/sim/**`。

## 0 · 环境前置（少一条就会得到与本单无关的假红）

```bash
CANON=origin/claude/inspiring-gates-aqczjg
git fetch origin
git checkout -B claude/handoff-wo-dbui-flow origin/claude/verify-reclaim-6
git merge-base --is-ancestor HEAD $CANON && echo "落后 ⇒ 停手回报" || echo ok
pnpm install --prefer-offline
pnpm --filter @platform/contracts build      # ⚠ 不 build 会得到 "xxx is not a function" + 500 这种与本单无关的假红
pnpm --filter @platform/llm-adapters build
```

## 1 · 需求来源（仓主原话，逐字）

> 「我谈前端的逻辑：**输入故事脚本 - 显示目前缺少的信息（数据字段，求解器，约束，规则，本体…）- 人工触发创建 - 开始创建 - 完成创建（显示创建的信息）- 人工确定入库或选择下载**」

> 「然后模拟的数据是否可以入库，**需要系统再次复验自检，因为人不清楚系统里面的数据现状，是否有冲突等等**」

> （看完当前页三张截图后）「**这些都是我看不懂的功能**」

## 2 · 现场（审核方现测，你仍要自己复核）

### 2.1 能力基本都在，问题是**排布**与**命名**

主组件真实渲染顺序（`DataBuilderPage.tsx`，共 1360 行）：

```
1156  QuickSynthPanel        合成数据模板      ← 从「合成数据页」收编来的
1216  WorkflowTimelinePanel  工作流时间线
1269  ManifestForm           补录表单
1276  BuildPlanComprehension 区2 故事理解
1281  ModuleSyncMatrixView   区5 模块矩阵
1303  ClosureVizView         区6 闭包完整性
1318  InferenceButton        区7 一键推演
1331  GrowthConsolePanel     缺口工单看板      ← 从「自成长发动机页」收编来的
```

四个毛病：
1. **屏顶第一个不是入口**：最上面是 `QuickSynthPanel`（合成数据模板），而「输入故事脚本」在下面。用户的第一个动作在第二屏。
2. **区号有洞且上了屏**：实测 `区1`=0 处 · `区3`=0 处 · `区8`=0 处，而屏上写着「区2/区4/区5/区6/区7」。**PRD 内部编号不该上屏。**
3. **三页归一没重排**：两个收编来的面板一个塞最上、一个塞最下，把主流程夹在中间。
4. **「显示缺少的信息」被埋三层**：`GapAnalysis` 的四分（`needed/existing/toCreate/missing`，渲染在 `:741`）**只有展开七阶段瀑布流、点进 `gap_analysis` 那一步才看得见**（`:974` `s.stepKey === "gap_analysis" && s.checkpoint?.gapAnalysis`）。而仓主要的是**主屏一等内容**。

### 2.2 ⛔ 5 个入口做同一件事（仓主截图直接点名的那一片）

| 屏上叫什么 | 实际调用 | 差别 |
|---|---|---|
| `运行构建`（勾 dry-run 变「预览构建」） | `runDataBuilder({script, seed, dryRun, builderKey})`（`:1011`） | 一次性，**不进历史** |
| `建域并记入历史`（primary·"推荐默认"） | `storyM` → `runStoryBuild`（`:1129`） | 进历史时间线 |
| `倒推建域（先补录）` | `previewM` → `previewStoryBuild`（`:1133`） | 先倒推缺的字段让人补 |
| `运行工作流`（同步） | 持久化步骤状态机（`:898`） | 崩溃可 resume |
| `异步运行` | 同上，立即返回（`:895`） | — |

再乘两个 checkbox（`dryRun`（`:1000`）· `provisional`（`:1001`））。

**设计失败的自证**：屏上有**两个折叠区**，唯一职责就是解释按钮 ——
`:1145`「**三种建域方式怎么选？**」与 `:903`「**这个运行时保证什么？**」。
且 `:1121` 的代码注释写着「这条说明已整句收进下方折叠区，**未删**」——
有人试过简化，但把说明**藏进折叠区**而不是**消灭需要说明的复杂度**。

⚠️ **这是 D4 守恒用错了地方**。诚实位是给「系统答不出的事」用的（例：某数据没有真值源），
**不是**给「界面自己造出来的选择困难」用的。选项过多的正确修法是**砍选项**，不是折叠解释。

### 2.3 ⛔ 入库那一刻**没有冲突复验**（仓主第二条要求的落点）

`promoteDomain`（`apps/datacore/src/databuilder/service.ts:938`，端点 `app.ts:4924` `POST …/runs/:id/promote`）：

```js
// ① 对象类型：真租户已有同 key ⇒ **静默跳过**
for (const t of provTypes) {
  if (!(await this.ontology.getType(ctx, t.key))) { await this.ontology.upsertType(...); migratedTypes++; }
}
// ② 链路类型：**无条件 upsert**
for (const lt of await this.repos.ontologyLinks.list(provNs)) {
  await this.ontology.upsertLinkType(ctx, { key: lt.key, fromTypeKey: ..., toTypeKey: ..., cardinality: ... });
}
```

两个不同的冲突处理，**都不告诉人**：
1. **对象类型同 key ⇒ 静默沿用既有的**。人以为建了新类型，实际用的是库里那个 ——
   而它的字段可能与故事要的**不一致**。且 `migratedTypes` 计数**不含**它 ⇒ 屏上数字也看不出。
2. **链路类型同 key ⇒ 无条件覆盖**。既有链路的端点/基数可能被悄悄改掉 ——
   **这是一次静默的本体真值写入**。

而且 `promoteDomain` **完全不重算闭包与对账**：缺口分析是建域时（T1）算的，
人点「入库」时（T2）世界可能已变（别人建了同名类型、改了规则），它不看。

现有的 `SchemaReconcileCandidate`（`packages/contracts/src/prototype-intake.ts`）确实是冲突对账
（`candidates[]` 按分降序 + `suggestedAction` USE/NEW + 人可改 `resolvedAction`），
但它**只在 intake 阶段**，**不在 promote 阶段**。

## 3 · 要做什么

### 3.1 前端：按仓主那 6 步重排为**单列线性流程**

一步一区，做完才亮下一步（未完成的步骤置灰但可见，让人知道后面还有什么）：

```
① 输入故事脚本        ← 屏顶第一屏，一个 textarea + 一个「开始」
② 系统读出来什么 & 还缺什么   ← GapAnalysis 四分提到一等位置 + 13 类分组卡片（带溯源 hint）
③ 人工确认开始创建    ← 明确的「开始创建」动作
④ 创建中              ← 七阶段进度
⑤ 创建完成，建了什么   ← 12 模块同步矩阵 + 「去核对 →」
⑥ 入库前复验 → 人工裁决：入库 / 下载
```

**把 5 个入口砍成 1 个「开始」**，原选项各自的归宿（逐条给出你的实现与理由）：

| 现在的选项 | 建议归宿 |
|---|---|
| `dry-run`（仅预览不落库） | **砍**。落不落库是第 ⑥ 步的裁决，不是开始前的选择 |
| 进不进历史（`运行构建` vs `建域并记入历史`） | **砍**。永远进历史 —— 跑了不记录 = 不可复现 |
| `倒推建域（先补录）` | **砍**。它就是第 ② 步的自然结果（缺什么就让人补什么），不是另一个按钮 |
| 同步 / 异步 | **砍**，不上屏 |
| `PROVISIONAL` | **下沉**到第 ⑥ 步（「先不审核，标为未验证入库」） |

⚠️ **砍不等于删能力**：底层三条路径（`runDataBuilder` / `runStoryBuild` / `previewStoryBuild`）
与同异步都保留，只是**不再让用户在开始前做这个选择**。
若你认为某条路径砍不掉（有它独有的、第 ⑥ 步替代不了的语义），**点名并说明**，不要硬砍。

**其余两件**：
- `QuickSynthPanel` 与 `GrowthConsolePanel` 是从别的页收编来的，**移出主流程**（降为侧栏/折叠区/页尾），不许再夹在中间。
- **区号从屏上全部拿掉**（区2/区4/…）。代码注释里保留 PRD 区号做溯源没问题，**屏上不许出现**。
- **给开发看的话不许上屏**：实测屏上有「三页归一（自成长收编）」「厂商中立施工」这类词，用户不需要知道这页是三个页合并来的。

### 3.1b 第 ⑤ 步必须是**逐条明细表**，不是「创建了 XX 条」

**仓主原话**：「需要在前端展示**具体创建了哪些数据详情**的展示（**表格形式**），而不只是说创建了 XX 数据」。

现状：`ProducedArtifact` 逐条明细**数据是有的**（`packages/contracts/src/storybuildrun.ts`：
`module` / `kind` / `key` / `action`(CREATED|UPDATED|REUSED) / `status`(DRAFT|PUBLISHED)），
但屏上是 `ArtifactDiffCard`（`DataBuilderPage.tsx:194`）**卡片**形态，且**嵌在每个模块行的展开层里**
⇒ 要一个模块一个模块点开才看得到，扫不了全貌。

要做的：第 ⑤ 步给一张**平铺表**，一屏看完本次建了什么。列至少含：

| 模块 | 类型(kind) | 键(key) | 动作 | 状态 | 去核对 |
|---|---|---|---|---|---|
| 本体建模 | objectType | `Order` | **CREATED** | 已发布 | → /admin/modeling |
| 规则库 | rule | `mrp_gap` | UPDATED | 草稿（未生效） | → /admin/rules |

硬要求：
1. **可按 `action` / `status` / `module` 筛**（「只看新建的」「只看还没生效的」是最常用的两个问法）。
2. **`REUSED` 必须和 `CREATED` 一样显示出来**，不许因为"没变化"就藏起来 ——
   「复用了既有的 `Order`」恰恰是仓主说的「人不清楚系统里面的数据现状」那个盲区的正面回答。
3. **`DRAFT`（未生效）必须一眼可辨**，不能只靠颜色（色觉障碍 + 浅色皮都收不到颜色传的信息），
   要有文字。
4. 保留每行的 `去核对 →` 深链（`MODULE_REGISTRY.deepLink`，契约单源，前端不重定义）。
5. 模块矩阵**不删**，降为表上方的汇总条（几个模块被触及 / 各几条）——
   矩阵回答"波及面"，表回答"具体是哪些"，两个问题不同，都要。

⚠️ **诚实边界，必须在报告里写明**：`ProducedArtifact` 是**制品级**明细
（建了哪个类型/哪条规则/哪个求解器），**不是行级**（往哪张表插了哪几行）。
行级要走 `producedDatasets` / `producedConnections` 的下钻，且 `BuildPlan.dataSources[].rowCount`
只有总数。**若仓主要的是行级，本单做不到，要如实说，不许拿制品级冒充行级。**
你判断行级能不能在本单射程内做到 —— 能做就做，做不到就点名缺在哪一环。

### 3.2 前端：第 ⑥ 步补「下载」

下载**可重放的 `BuildPlan` JSON**（含 `script` / `scriptHash` / `seed` / 13 类 needs）。
理由：契约里 `buildPlan` 已写明是「**封存可重放的全栈 BuildPlan（R6 确定性，frozen 快照供历史回放）**」
⇒ 下载它才有「拿走能重建」的意义。
（仓主已知会：若之后要产物清单 CSV 再加，不返工。）

实现注意：走 `Blob` + `URL.createObjectURL` + `<a download>`；文件名带 `scriptHash` 前 8 位与 seed，
保证同一份 plan 下载两次文件名一致（确定性）。

### 3.3 后端 + 前端：**入库前冲突复验**（本单最要紧的一件）

新增一条**只读**的预检端点（例：`POST /a/v1/databuilder/runs/:id/promote-precheck`，命名你定），
在 `promoteDomain` **真写之前**、拿当前真租户状态**现算**，逐条列出冲突。**必须**：

1. **三类冲突分开报，不许合成一个数**：
   | 类 | 判据 | 今天的行为 |
   |---|---|---|
   | **类型同 key** | 真租户已有同 `key` 的 ObjectType | 静默跳过（沿用既有） |
   | **链路同 key 且定义不同** | 同 `key` 但 `fromTypeKey`/`toTypeKey`/`cardinality` 任一不同 | **无条件覆盖** |
   | **链路同 key 且定义相同** | 全同 | 覆盖但无实际变化（无害） |
   后两类**必须分开**——「会改掉既有定义」与「写了个一样的」危险度差一个量级，
   合成一个「N 条冲突」等于让人无法裁决。
2. **每条冲突给出三样**：`既有值` · `将写值` · `建议动作`（沿用既有 / 覆盖 / 改名新建）。
   照 `SchemaReconcileCandidate` 已立的先例（`suggestedAction` + 人可改 `resolvedAction`），
   **不要另发明一套词表**。
3. **重算闭包**：预检时用**当前**世界重跑一次闭包判定，与建域时（T1）那份**并列显示**。
   两份不一致 ⇒ 明确提示「**建域后世界变了**」，并说明变在哪。
4. **预检是只读的**：一个字节都不许写。**这条要用测试咬死**（对照跑前后指纹逐字节相同），
   不是写注释保证。
5. `promoteDomain` 本身：加一道「预检结论 + 人的裁决」入参；**无裁决不许写**。
   ⚠️ 但**不许**把它改成"必须先调预检"这种隐式耦合 —— 老调用方（若有）要么显式适配、要么明确报错，
   **不许静默按默认动作写**。
6. **R4 判定**：晋升本来就是人工审批动作（端点 `requireAdmin`，本体已登记）。
   本单加的预检**不改变**这一点，但要在代码注释里写明：**预检不是审批的替代，是审批的输入**。

## 4 · SEAM-GATE（头号复验判据）

本单**跨前后端两半**，按本仓纪律必须**一个 dev 整单做**，交回必须含**驱动接缝**的组合测试：

- **后端** `apps/datacore/test/promote-precheck.test.ts`：
  真种子建一个 PROVISIONAL 域 → 在真租户里**先造一个同 key 的类型和一条定义不同的链路** →
  跑预检 → 断言三类冲突**各自**被报出且 `既有值`/`将写值` 正确 → 断言**预检没写任何东西**
  （会话/本体/对象全表指纹前后逐字节相同；先跑一次金丝雀证明指纹函数会变，防恒空假绿）。
- **前端** `apps/frontend-shell/test/dbui-flow.seam.test.tsx`：
  从**真实 workspace** 出发导航到该页 → 断言**第一屏第一个可交互控件就是故事脚本输入**（不是合成模板）→
  走完 6 步 → 第 ⑥ 步屏上**同时**出现「入库」与「下载」→ 有冲突时**冲突逐条可见且带建议动作**。

**变异反证**（逐条贴 RC，改完先 `git diff` 自证「变异体 ≠ 原文」）：
- 把「链路定义不同」与「定义相同」合并成一类 ⇒ **必须红**；还原 ⇒ 绿。
- 让预检写一次世界态 ⇒ **必须红**；还原 ⇒ 绿。
- 把故事脚本输入挪出第一屏 ⇒ **必须红**；还原 ⇒ 绿。
- ⚠️ 本仓真实踩过两次：`sed` 是 BRE、python `s.replace()` 静默 no-op —— 变异根本没生效，
  却被读成「变异后仍绿 ⇒ 判据是哑的」，然后去修一个没坏的判据。

**建议再建一道门**（若你判断值得）：「主流程首屏第一个可交互控件必须是故事脚本输入」+
「屏上不许出现 `区[0-9]` 字样」。人眼查得出，但**人眼不是机制** ——
参考同批 `scripts/check-edge-active-mounts.mjs` 的做法（金丝雀与主判据共用同一份 `analyze`）。

## 5 · 铁律（逐条适用）

- **铁律 0**：动本体前先读 `docs/SYSTEM-ONTOLOGY.md`。本单**新增了一条链路（预检）+ 改变了 promote 的语义**
  ⇒ **必须回写** §3/§5/§7 对应章节。
- **铁律 0.5**：grep 不是结论，再追一层。**只有 test 引用 = 已排练，不是已实现。**
  区分三态：没接线 / 接了线没数据 / 接了线接错地方。
- **铁律 0.6**：报「零命中/不存在/这条路径砍得掉」这类否定结论前先跑金丝雀，报告里附命中证据；
  金丝雀必须与主判据共用同一份实现。
- **门必须显式捕获退出码**：`out=$(cmd 2>&1); rc=$?`，禁止 `cmd | tail; echo $?`。
- **R2 tenant_id everywhere** · **entitlement 先于 authz**（404 不是 403）· **R4 真值写入经审批**。
- **仓储双实现**：新增字段/表要**同时**改 `migrations/*.sql` + `repo/pg.ts` + `repo/memory.ts` + `repo.ts` 接口。
  漏一个 = pg 模式下功能不存在而 memory 测试全绿。
- **契约字段新增一律 `.optional()`**（前端多处以字面量构造这些类型，required 会把整包前端打成编译红）。
- **对比度**：新增文字**正文最小 12px**，语义色作文字用一律走 `-txt` 变体
  （`--danger-txt` / `--warn-txt` / `--amber-txt` / `--txt`；填充值一个字节不改 —— 填充要饱和、文字要对比，方向相反）。
  ⚠️ **不许硬编码 hex**：本仓是双皮肤，实测 `#b6c3d4` 在浅色皮下只有 **1.79:1**。
  门 `node scripts/check-text-legibility.mjs` 会当场咬。
- **每完成一个可命名单元立刻 commit + push**（`git push -u origin claude/handoff-wo-dbui-flow`，
  失败按 2s/4s/8s/16s 退避 4 次）。容器会重启，**推了的全活，没推的全丢**。
- 不要创建 PR。

## 6 · ⛔ 资源纪律

跑 datacore vitest 前先 `bash scripts/dispatch-deficit.sh`；「其中 datacore=M」**M>0 就等**，
隔 120s 再探；该计数会瞬时抖动，**连续两次**读到 0 才开跑。
**禁止**：`bash scripts/gate.sh` · `pnpm -r test` · `pnpm -r build` · 全量 vitest。
**允许**：`pnpm --filter <pkg> exec tsc --noEmit` · 单文件 vitest · `node scripts/check-*.mjs` 单门 · git。

**基线用例数金丝雀（必做）**：跑变异反证前先跑一次未变异基线，确认有真实用例数而不是 `Tests no tests`。
拿不到用例数 ⇒ 报「工具坏了」，**不许**继续做变异反证。

**已知存量红**（不是你引入的）：`pnpm --filter frontend-shell lint` RC=1；前端全量有数条存量失败。

## 7 · 交回报告必须含

1. **6 步重排后的屏上结构**（从上到下逐区列出），以及 §3.1 那张表**逐行**的归宿与理由；
   若判断某条路径砍不掉，点名并给出它独有的、第 ⑥ 步替代不了的语义；
2. **三类冲突各自的判据实现** + 预检输出样例（含 `既有值`/`将写值`/`建议动作`）；
3. 后端接缝测试完整输出 + RC（含基线用例数金丝雀 + 指纹金丝雀）；
4. 前端接缝测试完整输出 + RC；
5. **变异反证逐条 RC** + 「变异体 ≠ 原文」的 diff 证据；
6. 「预检只读」的**测试证据**（不是注释保证）；
7. 仓储双实现对齐证据（memory 与 pg **同一组断言**都跑过）；
8. `check-text-legibility` RC + 新增文字的字号与所用 token；
9. 本体回写章节号；
10. **你认为我这张单写错/漏说了什么**（不许空着）；
11. 分支名 + 最终 sha（`git ls-remote` 确认已推）。

不要创建 PR。
