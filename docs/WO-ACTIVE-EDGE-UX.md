# WO-ACTIVE-EDGE-UX · 推演边的 active 开关 + 关掉后的结果对照（横向铺到所有推演页）

<!-- wo-anchors: allow-missing: apps/frontend-shell/src/views/sim/EdgeActivePanel.tsx, apps/frontend-shell/src/views/sim/edgeActiveModel.ts, apps/frontend-shell/test/edge-active.seam.test.tsx, apps/datacore/test/edge-active-counterfactual.test.ts -->
<!-- 这四条是本单要新建的产物，现在当然不存在。豁免≠隐身：门仍会逐条列出；本单落地后门会反过来点名「豁免过期」提醒清表。 -->

## 🚦 范围边界（本单身份）

**只碰**：
- 后端：`packages/contracts/src/sim.ts` · `apps/datacore/src/sim/propagation.ts` · `apps/datacore/src/app.ts`（**仅** `/a/v1/sim/*` 那几条路由）· `apps/datacore/src/repo/{repo,memory,pg}.ts` · `apps/datacore/migrations/*.sql`（如需新表/新列）
- 前端：`apps/frontend-shell/src/views/sim/**`（新建 `EdgeActivePanel.tsx` + `edgeActiveModel.ts`，其余页只做**接线级**小改）· `apps/frontend-shell/src/views/WhatIfView.tsx` · `OptimizeWhatifView.tsx` · `DecisionPlayView.tsx` · `apps/frontend-shell/src/mocks/**` · `apps/frontend-shell/src/locales/zh.ts`
- 测试：`apps/datacore/test/edge-active-counterfactual.test.ts` · `apps/frontend-shell/test/edge-active.seam.test.tsx`
- `docs/SYSTEM-ONTOLOGY.md`

**不碰**（有别的 agent 正在里面，碰了就是合并冲突）：
- `apps/frontend-shell/src/views/OntologyGraphView.tsx` 与 `views/graph/**` —— **WO-BEFE-A 正在改**（本体关系 CRUD 那 41 条）。本单是「推演时把边关掉」，那单是「人工创建/编辑本体关系」，两回事，别互相伸手。
- `apps/frontend-shell/src/views/sim/SandboxConsole.tsx` / `SandboxPlaysPanel.tsx` / `ProcessCanvasView.tsx` / `ChainLineMapView.tsx` —— 有 4 个 agent 在这几个文件里（沙盘 v3/v4·metro UX·对比度）。你要在沙盘上落地开关时，**只改挂载点那一两行**，把逻辑放进你自己的新文件。
- `chain-sim.ts` 的 `CHAIN_NODE_REGISTRY` 已在册 24 个 id（S0 冻结，改一个即返工）。

## 0 · 环境前置（少一条就会得到与本单无关的假红）

```bash
CANON=origin/claude/inspiring-gates-aqczjg
git fetch origin
git checkout -B claude/handoff-wo-active-edge origin/claude/verify-reclaim-6
git merge-base --is-ancestor HEAD $CANON \
  && { echo "HEAD 是 canonical 的祖先 ⇒ 落后，停手回报"; } || echo "ok"
pnpm install --prefer-offline
pnpm --filter @platform/contracts build
pnpm --filter @platform/llm-adapters build
```
⚠️ 基线是 **`origin/claude/verify-reclaim-6`**（集成分支），不是 canonical。worktree 可能没有 `node_modules`；
`@platform/contracts` 未 build 会报 `Failed to resolve entry for package "@platform/contracts"` 这种**与本单无关的假红**。

## 1 · 需求来源（仓主原话，一字不改）

> 「所有推演的功能，包括"推演沙盘"就需要借鉴这个设计UX」

指的是仓主给的参考 HTML 里那个能力：**关系边上有 active 开关，关掉这条边，就能看到推演结果怎么变**。

**关键**：仓主说的是「**所有**推演的功能」。所以本单**不是**「给沙盘加个 checkbox」，
是**一条横向要求**，必须铺到下列全部推演页：

| 页 | renderer id | 文件 |
|---|---|---|
| 推演沙盘 | `sandbox` | `views/sim/SandboxView.tsx` / `SandboxConsole.tsx` |
| 项目推演 | `project-sim` | `views/sim/ProjectSimView.tsx` |
| 全局推演 | `global-sim` | `views/sim/GlobalSimView.tsx` |
| 方案生成 | `plan-generate` | `views/sim/PlanGenerateView.tsx` |
| 通用假设推演 | `what-if` | `views/WhatIfView.tsx` |
| 优化推演 | `optimize-whatif` | `views/OptimizeWhatifView.tsx` |
| 决策推演 | `decision-play` | `views/DecisionPlayView.tsx` |
| S&OP 平衡 | `sop-balance` | `views/sim/SopBalanceView.tsx` |

（这张表是我现算的 —— `apps/frontend-shell/src/views/registry.ts:29-98`。**你仍要自己复核**，
尤其要复核「这 8 个是不是全部」：我用的判据是 registry 里带推演语义的 renderer，
可能漏了走专用 route 而不进 registry 的页。报「就这 8 个」之前先跑金丝雀。）

**只修撞见的那一例 = 本单失败。** 本仓反复栽在这上面。

## 2 · 现场（我现算的，你仍要自己复核）

### 2.1 三分法定性 = **「没接线」**

```
grep -rn "disabledRule|excludeRule|ruleOverride|mutedRule|disabledEdge|edgeOverride|suppressRule" \
     apps/*/src packages/*/src   →  0 命中
金丝雀（同一条命令、同一个工具）：propagateTick  →  13 命中 ⇒ 工具是好的，0 是真的 0
```
⇒ **「本次推演里屏蔽某条传导边」这个概念全仓不存在**。不是「接了线没数据」，不是「接了线接错地方」。
三者修法不同（接线 / 补数据 / 补挂载点），本单是**第一种：要造**。

### 2.2 ⛔ 现成的 `status` 字段**不能拿来当这个开关**（这是本单最容易做错的地方）

`PropagationRuleSchema`（`packages/contracts/src/sim.ts:39-82`）有：
```ts
status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]).default("DRAFT"),
```
仓库层按它过滤：`listPropagationRules(tenantId, publishedOnly = true)`
（`repo.ts:376` · `memory.ts:74-79` · `pg.ts:111-115`）。

**它是"这条规则对全租户是否生效"的持久发布态，不是"我这次推演想试着关掉它"。**
拿它当开关会同时炸三头：
1. **顶 R4**：真值变更必须经 Action 审批。把 PUBLISHED 改成 RETIRED 是**本体真值写入**，
   不是推演。用户点一下"关掉看看"就永久改了全租户的本体 —— 这是事故不是功能。
2. **顶 R2 的精神**：一个用户的假设推演污染同租户所有人的推演结果。
3. **不可对照**：`status` 一改，"改之前"就没了。而用户要的恰恰是**对照**（见 §3）。

正确落点是**会话级（SimSession 级）的反事实集合**，与 `status` 正交：
`status` 决定"这条边在不在世界里"，本单的开关决定"这次推演假装它不在"。
**两个字段都要，不许合并。** 你在本体回写里要把这条正交关系写清楚。

### 2.3 引擎接缝在哪

`propagateTick`（`apps/datacore/src/sim/propagation.ts:442`）签名第三个参数就是：
```ts
rules: PropagationRule[],
```
—— 规则是**入参**，不是函数内部现查的。这意味着反事实**可以做成调用点的过滤**，
引擎本体可以一行不改（additive·可回退）。调用点在 `app.ts`（`listPropagationRules` 的 5 处调用：
`1519` / `1811` / `1825` / `1946` / `5124`）。

**但你必须自己核**：这 5 处是不是**都**该受反事实影响。我的判断是不是全都该改
（例如 `1811` 是列表查询、`1946` 传 `false` 拿全量 —— 这两处语义就不同）。
**逐处给判定 + 依据**，别一刀切。

### 2.4 前端现状：几乎是空的

```
grep -rln "propagationRule|/sim/propagation-rules" apps/frontend-shell/src/
  → views/sim/SimReadinessPanel.tsx   （只是完整度面板，数了个数）
  → mocks/handlers.ts
```
⇒ **没有任何一页把传导边画出来给人看，更别说开关。** 这是本单前端半的起点。

## 3 · 要做什么

### 3.1 后端：会话级反事实（`SimSession` 上的一等概念）

1. 在 `SimSessionSchema` 上加 `disabledRuleKeys: z.array(z.string()).default([])`
   （**用 `key` 不用 `id`** —— `key` 是契约里写明「稳定键，可被 OPERATION_CATALOG/审计引用」的那个）。
   缺省空数组 ⇒ **不传时与本字段引入前逐字节相同**（additive·可回退）。
2. 路由：`PATCH`（或 `POST`）一条会话级开关端点，改这个集合。**必须**：
   - 带 `tenantId` 过滤（R2）· 走 `requireSim(c, "sim.propagation")`（entitlement 先于 authz）
   - 写的是 **SimSession 的世界态**，**不是**本体真值 ⇒ 不需要 Action 审批，
     但**必须在代码注释里写明为什么不需要**（引用 R4 原文），否则下一个人会以为漏了。
   - 传入未知 `ruleKey` ⇒ 显式报错，**不许静默忽略**（静默忽略 = 用户以为关掉了、其实没关，
     这正是「绿测试≠能用」的温床）。
3. 引擎接缝：在 §2.3 那 5 处调用点里**该过滤的那几处**过滤掉 `disabledRuleKeys`。
4. **对照是本单的核心产出，不是附加项**：给一条「同一 tick、开/关两种规则集各跑一遍、返回差异」的能力。
   落点你自己定（新求解器 / tick 响应里加 `counterfactual` 段 / 独立端点都行），但必须满足：
   - **确定性**：同输入同参数版本同输出（本仓铁律）；
   - **不写世界态**：对照跑的那一遍**不许**落 `putTickState`，否则用户点一下"看看"就把真会话推进了一格。
     这条你要**用测试咬死**，不是写注释保证。

### 3.2 前端：一个共享件，八处挂载

**新建**（放你自己的文件里，避免与 4 个在跑的 agent 冲突）：
- `views/sim/edgeActiveModel.ts` —— 纯函数：边列表 → 开关状态 → 请求体；开/关两组结果 → 差异视图模型。**无 React 依赖**，好测。
- `views/sim/EdgeActivePanel.tsx` —— UI：边列表（源类型.状态变量 →via链路→ 目标类型.状态变量 · 系数 · 延迟）+ 每行一个 active 开关 + 「关掉后」的差值展示。

**挂载**：§1 表里 8 个页，每页只加**挂载点那一两行**。
- 页面本身没有边可展示的（如 `optimize-whatif`），**据实说明为什么这一页不适用**，写进报告，
  **不许**为了凑数硬塞一个空面板 —— 空面板比没有更糟，它让人以为这页支持而其实无边可关。
- 这条判定必须逐页给出：**适用 / 不适用+理由**，8 页一个不许空着。

### 3.3 UX 要求（照仓主给的参考件，但用本平台的术语）

- 关掉一条边 ⇒ **立刻看到结果差异**，不是"再点一次运行"。
- 差异要能一眼看出**方向和量级**（涨/跌 + 数值），不是只标个"变了"。
- 关掉的边在图上要**可见地降级**（虚线/灰化），不是从图上消失 —— 消失了用户就不知道自己关了什么。
- **对比度**：正在跑的 `WO-R9-CONTRAST` 刚测出小字 CJK 在 4.52:1 下不可读。
  你新增的任何文字，**正文最小 12px**，弱化色不许低于 `#b6c3d4` 这一档（≈6.6:1）。
  这条已被仓主截图点名过一次，别再犯。

## 4 · SEAM-GATE（头号复验判据）

本单**跨数据+引擎两半**（契约/仓储/引擎 + 前端），按本仓纪律**必须一个 dev 整单做**，
且交回必须含**驱动接缝**的组合测试，不是各半 unit 各绿：

- 后端接缝（`apps/datacore/test/edge-active-counterfactual.test.ts`）：
  真种子 → 关掉一条**确实有下游影响**的边 → 断言下游状态变量**真的变了**，
  且**变的方向和量级可解释**（不是"不等于"就算过）。
  再断言**对照跑没有写世界态**（`getTickState` 前后逐字节相同）。
- 前端接缝（`apps/frontend-shell/test/edge-active.seam.test.tsx`）：
  从**真实 workspace 响应**出发 → 导航到某推演页 → 面板渲染出边 → 拨开关 → 差异显示出来。
  不许从手搓的 props 起跑（那测的是组件不是链路）。

**变异反证**（逐条贴 RC）：
- 把过滤那一行撤掉（规则照旧全跑）⇒ 后端接缝**必须红**；还原 ⇒ 绿。
- 把"对照不写世界态"那条约束破坏掉 ⇒ **必须红**；还原 ⇒ 绿。
- ⚠️ **改完先 diff 断言「变异体 ≠ 原文」再跑测试**。本仓真实踩过两次：
  `sed` 是 BRE、`s.replace()` 静默 no-op —— 变异根本没生效，却被读成「变异后仍绿 ⇒ 判据是哑的」，
  然后去修一个没坏的判据。

## 5 · 铁律（逐条适用）

- **铁律 0**：动本体前先读 `docs/SYSTEM-ONTOLOGY.md`。本单**新增了对象类型上的字段 + 一条新链路语义**
  ⇒ **必须回写** §2/§3/§5，并把 §2.2 那条「`status` 与 `disabledRuleKeys` 正交、不许合并」写进去。
- **铁律 0.5**：grep 不是结论，再追一层，追到「谁调用、什么条件触发」。
  **只有 test 引用 = 已排练，不是已实现。**
- **铁律 0.6**：报「零命中/不存在/这页不适用」这类**否定结论**前先跑金丝雀，报告里附命中证据。
  金丝雀**必须与主判据共用同一份实现**，不许另抄一份正则（抄了就是装饰品）。
- **门必须显式捕获退出码**：`out=$(cmd 2>&1); rc=$?`，禁止 `cmd | tail; echo $?`。
- **R2 tenant_id everywhere** · **entitlement 先于 authz**（404 `FEATURE_NOT_FOUND`，不是 403）。
- **R4**：真值写入经 Action 审批 —— 本单写的是**会话世界态**不是本体真值，
  这个区分必须在代码注释里讲清楚。
- **确定性种子**：同输入同输出，测试不依赖网络/时钟随机性。
- **仓储双实现**：新增字段/表要**同时**改 `migrations/*.sql` + `repo/pg.ts` + `repo/memory.ts` + `repo.ts` 接口。
  漏一个 = pg 模式下功能不存在，而测试默认走 memory ⇒ 全绿且不可用。
- **每完成一个可命名单元立刻 commit + push**
  （`git push -u origin claude/handoff-wo-active-edge`，失败按 2s/4s/8s/16s 退避重试 4 次）。
  ⚠️ 容器会重启，**推了的全活，没推的全丢**。本仓真丢过一次 12 个提交 3397 行。

## 6 · ⛔ 资源纪律（当前载荷已超派）

**我刚实测：载荷 18.9 · vitest 进程 15（其中 datacore=0）· 4 核。**
`scripts/dispatch-deficit.sh` 当场判 🔴 **超派**。

⇒ **先把不跑测试的部分全做完并 push**：契约字段 · 迁移 · 仓储双实现 · 引擎过滤 · 路由 · 前端组件 · 本体回写。
跑 datacore vitest 前 `bash scripts/dispatch-deficit.sh`，看「vitest 进程 N（其中 datacore=M）」：
**M>0 就等**，隔 120s 再探，最多 30 分钟。该计数**会瞬时抖动**（实测同一分钟 2→0），
**连续两次**读到 0 才开跑。

**禁止**：`bash scripts/gate.sh` · `pnpm -r test` · `pnpm -r build` · 任何 frontend/agentcore 全量 vitest。
**允许随时跑**：`pnpm --filter <pkg> exec tsc --noEmit` · `pnpm --filter <pkg> exec vitest run <单文件>` ·
`node scripts/check-*.mjs` 单门 · git。

**基线用例数金丝雀（必做）**：跑变异反证前先跑一次**未变异**基线，确认输出里有真实用例数
而不是 `Tests no tests`。拿不到用例数 ⇒ 报「工具坏了」，**不许**继续做变异反证。

**已知存量红**（不是你引入的，别去修）：`pnpm --filter frontend-shell lint` 在基线上 RC=1；
前端全量有 4 条存量失败。

## 7 · 交回报告必须含

1. **§2.3 那 5 处调用点逐处判定**：该不该受反事实影响 + 依据（file:line）；
2. **§1 那 8 个推演页逐页判定**：适用 / 不适用+理由。**一个不许空着**；
   若你复核出第 9 个推演页（我可能漏了走专用 route 的），点名并一并做；
3. 后端接缝测试完整输出 + RC（含基线用例数金丝雀）；
4. 前端接缝测试完整输出 + RC；
5. **变异反证逐条 RC**（含「变异体 ≠ 原文」的 diff 证据）；
6. 「对照跑不写世界态」的**测试证据**（不是注释保证）；
7. 仓储双实现对齐证据：memory 与 pg **同一组断言都跑过**；
8. 本体回写的章节号 + 那条正交关系的原文；
9. **你认为我这张单写错/漏说了什么**（不许空着）；
10. 分支名 + 最终 sha（`git ls-remote` 确认已推）。

不要创建 PR。
