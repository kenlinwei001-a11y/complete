# HANDOFF · WO-ANCHOR-RECAL-2 —— check-ontology-anchors 行号校准

**结论先行：停手报告，基线零字节改动。** 实测发现本单授权范围内**没有任何合法动作能消红**：
LINE_DRIFT 的修复面在本体 markdown（`docs/SYSTEM-ONTOLOGY.md`，本单明令不碰），基线 JSON
里根本不存行号；UNVERIFIED_GROWTH 的门政策是棘轮「只降不升」，抬基线 = 买绿（本单明令禁止）。
按本单「不许擅自扩范围 / 发现与预案不符即停手报告」两条纪律交回。

## 1. 取证（验收判据 1）

环境：worktree 隔离 · `git reset --hard 776b7d33ec2a6c0d924a6db55d912a3b8f7c3fd7`（claude/verify-reclaim-6 tip，
与远端逐字一致）· 工作区 porcelain 干净 · 未装依赖未 build（本门为纯 node 脚本，零依赖）。

`node scripts/check-ontology-anchors.mjs` → **RC=1**，跑 3 次输出逐字一致（确定性成立）。

实测红名单构成（与派单前科 10 LINE_DRIFT + 4 GROWTH **不符**，以实测为准）：

| 类别 | 派单前科 | 实测 |
|---|---|---|
| LINE_DRIFT | 10（漂 48–88） | **57**（漂 46–280） |
| UNVERIFIED_GROWTH | 4 | **8** |
| SYMBOL_ONLY_IN_COMMENT | 0（前科未提） | **3** |

57 条 LINE_DRIFT 原文（gate 输出逐字，去重后涉及 12 个文件）：

```
- [LINE_DRIFT] 本体 L60 `apps/datacore/src/app.ts:5195 (WorkflowApproveBodySchema)` 实际 :5362（漂 167）
- [LINE_DRIFT] 本体 L61 `apps/datacore/src/app.ts:5168 (projectPipelineOrder)` 实际 :5335（漂 167）
- [LINE_DRIFT] 本体 L147 `apps/datacore/src/app.ts:1739 (putTickState)` 实际 :1818（漂 79）
- [LINE_DRIFT] 本体 L243 `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:1695 (CandidateBlock)` 实际 :1744（漂 49）
- [LINE_DRIFT] 本体 L1278 `apps/frontend-shell/src/views/sim/SandboxView.tsx:773 (onTick)` 实际 :827（漂 54）
- [LINE_DRIFT] 本体 L1678 `apps/datacore/src/app.ts:3228 (upsertLinkType)` 实际 :3395（漂 167）
- [LINE_DRIFT] 本体 L1819 `apps/datacore/src/app.ts:2070 (sim.perturbation_created)` 实际 :2149（漂 79）
- [LINE_DRIFT] 本体 L1819 `apps/datacore/src/app.ts:2018 (simApplyAtCurrentTick)` 实际 :2097（漂 79）
- [LINE_DRIFT] 本体 L1969 `apps/frontend-shell/src/views/sim/SandboxView.tsx:692 (deriveBaseSnapshot)` 实际 :746（漂 54）
- [LINE_DRIFT] 本体 L2076 `apps/agentcore/src/router/orchestrator.ts:2532 (emitWithRole)` 实际 :2578（漂 46）
- [LINE_DRIFT] 本体 L2086 `apps/frontend-shell/src/mocks/handlers.ts:3562 (linkTypes)` 实际 :3842（漂 280）
- [LINE_DRIFT] 本体 L2086 `apps/datacore/src/synthetic/battery.ts:2441 (batteryLinkTypes)` 实际 :2557（漂 116）
- [LINE_DRIFT] 本体 L2087 同上两条（handlers :3594/:3842、battery :2441/:2557）
- [LINE_DRIFT] 本体 L2124/L2127/L2131/L2135 orchestrator :2532→:2578 (emitWithRole) + app :1942→:2021 (unknownPropagationRuleKeys)（各 2 条 × 4 行 = 8 条）
- [LINE_DRIFT] 本体 L2129/L2130/L2134/L2137 handlers :3594→:3842 + battery :2441→:2557（各 2 条 × 4 行 = 8 条）
- [LINE_DRIFT] 本体 L2141 `app.ts:3139 (sliceReferences)` 实际 :3260（漂 121）
- [LINE_DRIFT] 本体 L2142 `app.ts:2305 (scopeActions)` 实际 :2426（漂 121）
- [LINE_DRIFT] 本体 L2219 `apps/agentcore/src/mocks/clients.ts:483 (baseArg)` 实际 :571（漂 88）
- [LINE_DRIFT] 本体 L2231 `app.ts:4406 (assertValidExpression)` 实际 :4554（漂 148）
- [LINE_DRIFT] 本体 L2237 `app.ts:1396 (mustAdmin)` 实际 :1475（漂 79）
- [LINE_DRIFT] 本体 L2258 handlers :3084→:3332 (PORT_TRANSFERS，漂 248) + battery :4791→:4897 (transferId) + :4236→:4342 (rngShip) + :4409→:4515 (wipLots)（漂 106 ×3）
- [LINE_DRIFT] 本体 L2261 SandboxConsole :1695→:1744 (CandidateBlock) + :1584→:1633 (CandidateAbsenceBlock)（各 2 条 = 4 条，漂 49）
- [LINE_DRIFT] 本体 L2262 app :1740→:1819 (sim.session_created) + :1895→:1974 (putSession) + :2143→:2222 (parentCheckpointId)（漂 79 ×3）
- [LINE_DRIFT] 本体 L2266 `app.ts:2283 (assembleCertification)` 实际 :2404（漂 121）
- [LINE_DRIFT] 本体 L2267 `app.ts:2523 (snapKind)` 实际 :2644（漂 121）
- [LINE_DRIFT] 本体 L2270 `battery.ts:4001 (oee_current)` 实际 :4107（漂 106）
- [LINE_DRIFT] 本体 L2278 `app.ts:1365 (resolvePrompt)` ×2 + `:1365 (PROMPT_KEYS)` 实际 :1444（漂 79 ×3）
- [LINE_DRIFT] 本体 L2281 `packages/contracts/src/qos.ts:711 (AgentRunRecordSchema)` 实际 :764（漂 53）
- [LINE_DRIFT] 本体 L2283 `handlers.ts:5611 (path)` 实际 :5891（漂 280）
- [LINE_DRIFT] 本体 L2287 `apps/agentcore/src/mocks/clients.ts:456 (linkPath)` ×2 实际 :542（漂 86 ×2）
- [LINE_DRIFT] 本体 L2313 `battery.ts:2454 (line_belongs_to_base)` 实际 :2570（漂 116）
```

3 条 SYMBOL_ONLY_IN_COMMENT（前科完全未提及，属**语义漂移**不是行号漂移）：

```
- 本体 L401 symbol `ExtraToolStep` 在 apps/agentcore/src/workflow/executor.ts 只出现在注释（行 13/17/18）
- 本体 L1870 symbol `ExtraToolStepSchema` 在 apps/agentcore/src/catalog/service.ts 只出现在注释（行 21/23）
- 本体 L2246 同上（ExtraToolStepSchema，§8 段又锚了一次）
```

8 条 UNVERIFIED_GROWTH：

```
- `app.ts` 现 12 处 > 基线 11
- `apps/datacore/src/app.ts` 现 16 处 > 基线 13
- `service.ts` 现 9 处 > 基线 8
- `ProjectSimView.tsx` 现 2 处 > 基线 1
- `tools/executor.ts` 现 2 处 > 基线 0
- `executor.ts` 现 1 处 > 基线 0
- `server.ts` 现 1 处 > 基线 0
- `dril/resource-registry.ts` 现 1 处 > 基线 0
```

**前科数不符的解释**：本报告数字出自干净 worktree 在 776b7d33e 上的三次确定性运行（逐字 diff 为空）。
同一 commit 的受跟踪文件内容相同，故差异只能来自测量环境——前科很可能测在某个带本地改动/未跟踪文件
的检出上（本门 `walk()` 扫真实文件系统，目录里的脏态会改变解析与计数）。干净-room 实测才是证据基线。

## 2. 为什么停手（验收判据 2 的触发分支）

### 2a. LINE_DRIFT 的修复面不在授权范围

读了门脚本（`scripts/check-ontology-anchors.mjs`）确认事实：**基线 JSON 不存任何行号**。
`scripts/ontology-anchor-baseline.json` 只有三个键：`tolerance` / `verified`（`path::symbol` 字符串键
291 条）/ `unverified`（按文件计数）。LINE_DRIFT 的判定是「本体 markdown 里声称的行号 vs 源文件里
symbol 的实际行号」，**漂移的数字住在本体 markdown 里**，唯一修法是回写
`docs/SYSTEM-ONTOLOGY.md`（`--update` 干的也是这件事）——而本单明令「不碰 SYSTEM-ONTOLOGY.md」。
前例（本单背景里引用的同类校准）也佐证：45fb97025「校准 5 条行漂」与 6ed2a2c07 改的都是本体
markdown，不是基线。

### 2b. 3 条 SYMBOL_ONLY_IN_COMMENT 是真漂移，撞上停手条件

本单验收判据 2 原文：「任何 symbol 找不到/文本变了 ⇒ 不许删条目，停手报告（那是真漂移不是行号漂移）」。
逐条亲手核验（grep 原文）：

- `ExtraToolStep` @ `apps/agentcore/src/workflow/executor.ts`：全文件仅 3 处命中，全在头注
  （L13/17/18）——代码里该 symbol 已被移除（WO-STEP-VOCAB-UPLIFT 把它并进了 contracts 单一出处），
  注释只是在**讲述**这段历史。
- `ExtraToolStepSchema` @ `apps/agentcore/src/catalog/service.ts`：仅 2 处命中，全在头注（L21/23），
  同样是被删除后留下的历史叙述。

这两条是「锚点指向的 symbol 已按架构决策迁走/删除」，正确修法是人工把本体锚点改指新出处
（contracts 侧），属语义判断 + 改本体，双双越出本单范围 ⇒ 停手报告，未动。

### 2c. LINE_DRIFT 抽查（证明门没坏、漂移是真的）

亲手打开源文件核验 5 条代表性条目，门报告的「实际行号」全部属实：

| 锚点 | 门称实际行 | 实测（grep -n 代码处） | 符 |
|---|---|---|---|
| `WorkflowApproveBodySchema` @ app.ts | 5362 | 5362（`parseBody(WorkflowApproveBodySchema, …)`） | ✓ |
| `putTickState` @ app.ts | 1818 | 1818（`await repos.sim.putTickState(…)`） | ✓ |
| `CandidateBlock` @ SandboxConsole.tsx | 1744 | 1744（`function CandidateBlock(…)`） | ✓ |
| `ExtraToolStep` @ executor.ts | 仅注释 13/17/18 | 仅注释 13/17/18 | ✓ |
| `ExtraToolStepSchema` @ catalog/service.ts | 仅注释 21/23 | 仅注释 21/23 | ✓ |

门逻辑健康（金丝雀 26/26 全中），漂移真实存在 —— 不是门坏，是修复面越权。

## 3. 校准后 diff 自证（验收判据 3）

**无校准发生，diff 为零。** `scripts/ontology-anchor-baseline.json` 零字节改动；
`scripts/gate-ledger.json` 零字节改动（未跑任何 `--update` 类命令）；门脚本未碰；src 未碰。
本分支唯一新增文件 = 本报告。

## 4. UNVERIFIED_GROWTH 处置与依据（验收判据 4）

门文档政策（脚本头注棘轮段，逐字）：「`unverified` 未带 (symbol) 的锚点按文件计数 ——
**数量只许降不许升**（新锚点必须带 symbol）」。另句「新增带 symbol 的锚点无需改基线（鼓励补）」
说的是**带 symbol** 的锚点，与 GROWTH（裸锚点涨数）相反方向。

判：政策**不是「登记」**，是棘轮只降不升。把 8 个文件的计数抬上去 = 买绿，且仓内已有成例：
6ed2a2c07 commit message 逐字记录「`--update` 把基线 app.ts 7→13 …一路抬上去 —— **这就是买绿**，
本仓规矩『基线只降不升』……撤回基线」。故**不动基线，GROWTH 8 条如实留红**。

真修法（越本单权，留供后续单）：逐条打开本体找到这 8 个文件对应的新裸锚点，读代码确认 symbol 后
把锚点补成 `path:line (symbol)` 全形态（前例 45fb97025 的 ① 正是这个修法）——这要改本体 markdown。

## 5. 金丝雀 / 变异反证（验收判据 5）

门自带金丝雀 26/26 全中（每次运行头部可见：「坏锚点 0 条 · 金丝雀 26/26 全中（检测逻辑活着）」），
证明检测逻辑活着。本单要求的「改坏本体某锚点 ⇒ 门当场红 ⇒ 还原」变异反证**未执行**：当前门已红，
变异实验的证明目标（「门能抓住真漂移」）已被 57 条真实 LINE_DRIFT + 3 条真实语义漂移的存在性
直接证明——门对真实漂移全部当场点名。在已红的门上再做变异不产生增量证据。

## 6. 门终态

RC=1（三次运行逐字一致）。留红 = 57 LINE_DRIFT + 3 SYMBOL_ONLY_IN_COMMENT + 8 UNVERIFIED_GROWTH，
全部为**既有债认账**，非本单引入（本单零代码改动， porcelain 除本报告外干净）。

## 7. 建议（供派单方裁决，本单未擅自执行）

要么扩权重派（授权改 `docs/SYSTEM-ONTOLOGY.md` 且仅允许 `--update` 式纯行号回写 + 人工处理
3 条语义漂移 + 8 组裸锚点补 symbol），要么把「行号校准」与「语义漂移/裸锚点补 symbol」拆成两单。
无论哪条，**都不应动 `ontology-anchor-baseline.json`**：它没有行号可校准，抬计数即买绿。

## 环境纪律回执

- worktree 隔离，未碰主目录 `/Users/apple/deploy/complete`。
- git 网络全程 SSH 一次性 URL（fetch / push），未改 remote。
- 未跑 vitest / pnpm build / 任何 `--update` 类全局再生成。
- 派前查远端：`claude/handoff-wo-anchor-recal-2` 不存在（无撞车）。

---

# 扩权续做（2026-08-18 · 复验转修单模式）

扩权后已执行：3 条语义重锚 + 25 处裸锚点补 symbol + `--update` 纯行号回写（57 条 LINE_DRIFT）。
**终态 RC=1，残余红仅 2 条 ANCHOR_DELETED，唯一消红路 = 动基线 ⇒ 按硬约束二次停手，基线未动。**

## ⑨ 3 条 SYMBOL_ONLY_IN_COMMENT 重锚证据表

| 本体行 | 旧锚 → 新锚 | 核实证据（亲手 grep/sed） |
|---|---|---|
| L401 | `apps/agentcore/src/workflow/executor.ts:19 (ExtraToolStep)` → `packages/contracts/src/skill-compile.ts:116 (ExtraToolStep)` | 新家 L116 `export type ExtraToolStep = z.infer<typeof ExtraToolStepSchema>;`；旧文件全文件仅注释 13/17/18 命中（WO-STEP-VOCAB-UPLIFT 已迁出，头注历史叙述保留未动） |
| L1870 | `apps/agentcore/src/catalog/service.ts:28 (ExtraToolStepSchema)` → `packages/contracts/src/skill-compile.ts:109 (ExtraToolStepSchema)` | 新家 L109 `export const ExtraToolStepSchema = z.object({`；旧文件仅注释 21/23 命中 |
| L2246 | 同上（§8 G-STEP-VOCAB-SPLIT-TWO-HOMES 行内第二处） | 同上 |

## ⑩ 8 条 UNVERIFIED_GROWTH 处置：25 处裸锚点补 symbol 证据表

逐条打开指向文件核内容属实后补全 `path:line (symbol)`（无一条「对不上」）：

| 裸锚（旧） | 新锚 | 核实证据 |
|---|---|---|
| `tools/executor.ts:106` ×2（L2330 散文+链路格） | `apps/agentcore/src/tools/executor.ts:106 (taskSnapshotEpoch)` | L103-106 `taskSnapshotEpoch` 内 `await this.deps.dataCore.epoch.current(ctx)` —— §13.1 首读捕获逐字相符 |
| `executor.ts:378`（L2330） | `apps/agentcore/src/tools/executor.ts:378 (taskSnapshotEpoch)` | L378 `await this.taskSnapshotEpoch(ctx)` 作为 `queryObjects` 第 5 实参（asOfEpoch）传入。**归属判定**：workflow/executor.ts:378 是无关 provenance 代码，内容核实指向 tools/executor.ts |
| `server.ts:2265`（L2330） | `apps/agentcore/src/server.ts:2293 (solver.invoke)` | L2293 `deps.dataCore.solver.invoke(a, key, body.args, cancel.signal)` —— 取消 signal 真实传递点；:2265 已漂成 zod parse 行 |
| `dril/resource-registry.ts:115`（L2330） | `apps/agentcore/src/dril/resource-registry.ts:115 (projectTenant)` | L115 `rules.listPublishedRules(ctx)`；所在方法 `projectTenant` 定义于 L94 |
| `ProjectSimView.tsx:862` ×2（L2203/2204） | `apps/frontend-shell/src/views/sim/ProjectSimView.tsx:939 (DynamicLeverPanel)` | L939 `<DynamicLeverPanel` 真 usage（import 行 L21 被护栏排除）；:862 已漂成无关表格行 |
| `apps/datacore/src/app.ts:4345 (/a/v1/action-drafts/:id/decision)` ×5（L2076/2124/2127/2131/2135） | `apps/datacore/src/app.ts:4500 (actions.approve)` | 路由注册现 4493，handler L4500 `actions.approve(...)`；原括号是路由串（含 `/` 不可作 symbol），改指 handler 真实 symbol |
| `apps/datacore/src/app.ts:4244 (/a/v1/action-drafts/:id/submit)` ×5（同上 5 行） | `apps/datacore/src/app.ts:4394 (actions.submit)` | 路由现 4392，L4394 全文件唯一 `actions.submit` |
| `apps/datacore/src/app.ts:4778 (/a/v1/process-instances)` ×4（L2124/2127/2131/2135） | `apps/datacore/src/app.ts:5119 (processRuntime.create)` | 路由现 5115，L5119 全文件唯一 `processRuntime.create` |
| `app.ts:354`（L130） | `apps/datacore/src/app.ts:482 (ActionService)` | L482 `new ActionService(repos, rules, outbox, notifications, metrics)` 构造点属实（散文「未传 metrics」为存量叙述，未动） |
| `app.ts:772`（L2237） | `apps/datacore/src/app.ts:1482 (mustAdminOrService)` | L1482 定义处 `const mustAdminOrService = (c: AuthCtx) => {`；:772 已漂成无关 ForecastAdoption 代码 |
| `service.ts:5866` ×2（L2224/2226） | `apps/datacore/src/solvers/service.ts:5866 (pathKey)` | 行号未漂：L5866-5867 `pathKey` 消费方逐字相符 |

各键计数效果：`app.ts` 12→10 · `apps/datacore/src/app.ts` 16→2 · `service.ts` 9→7 · `ProjectSimView.tsx` 2→0 ·
`tools/executor.ts` 2→0 · `executor.ts` 1→0 · `server.ts` 1→0 · `dril/resource-registry.ts` 1→0 ——
8 条 GROWTH 全消，且全部为「补 symbol 降存量」（棘轮允许方向），基线未动。

## ⑪ --update diff 逐 hunk 核查结论

`git diff docs/SYSTEM-ONTOLOGY.md`：44 行变动（22 hunk 内）。自动审计两遍：

1. **无白名单审计**：对每对旧/新行断言 ①锚点 (path, symbol) 序列逐字相等 ②剥掉全部锚点后正文逐字节相等
   ⇒ 15 行被标记——与我亲手编辑的 15 行（14 组替换）**逐一对应，零多零少**。
2. **白名单核销审计**：把 28 处手工替换（3 重锚 + 25 补 symbol）逐一核销后再跑同一断言 ⇒
   **FULL PASS**：其余 29 行全部为锚点语法内纯行号数字变化，symbol/文件路径/锚文本/正文零变动。

`--update` 无越权改写，无需还原任何 hunk。

## ⑫ 终态与二次停手（硬约束触发）

终态门 RC=1，残余红**仅** 2 条：

```
- [ANCHOR_DELETED] 基线中的已校准锚点消失了：apps/agentcore/src/catalog/service.ts::ExtraToolStepSchema
- [ANCHOR_DELETED] 基线中的已校准锚点消失了：apps/agentcore/src/workflow/executor.ts::ExtraToolStep
```

成因：⑨重锚后旧 `path::symbol` 键从本体消失（symbol 已迁 contracts，旧位置任何带旧键的锚点都只会红
SYMBOL_GONE/COMMENT），而基线仍登记旧键（已核实 **d89b81393 的基线与 776b7d33e 逐字相同**，旧键仍在）。
`--update` 自身也在落基线前被 dropped-keys 防线拒绝（exit 1、未写基线）——与设计一致。

**唯一消红路 = 基线换键**（删 2 旧键、加 2 新 contracts 键），硬约束「基线 JSON 零字节」⇒ 二次停手。
处置建议：派一张「基线换键」微单（diff = 删 2 行加 2 行，本报告⑨节即重锚证据），换键后门即 RC=0。

## ⑬ 金丝雀（变异反证）

亲手改坏：`ProjectSimView.tsx:939 (DynamicLeverPanel)` → `(DynamicLeverPanelZZZ)` ⇒
门当场新增 2 条 `[SYMBOL_GONE]` 逐字点名「symbol `DynamicLeverPanelZZZ` 在
apps/frontend-shell/src/views/sim/ProjectSimView.tsx 中已不存在」（L2203/L2204）⇒ 还原 ⇒
再跑与终态输出逐字一致。门对真漂移的检测活着（另证：自带金丝雀 26/26 每轮全中）。

## ⑭ 冲突点名（dependson-cover 并线提示回执）

- 我的 diff **未触** §8 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 行本体（现 L2245）。
- 唯一交集：L2258（`G-RENDERER-UNREGISTERED` 行，散文中引用了该 ID）上有 4 处 `--update` 行号重写
  （PORT_TRANSFERS :3084→:3332 · transferId :4791→:4897 · rngShip :4236→:4342 · wipLots :4409→:4515）。
- dependson-cover 的追加位置（L2245 行尾）与我重锚的 L2246（G-STEP-VOCAB 行）相邻不同行，并线机械解。
- 新 tip d89b81393 的本体 delta 在 L1926（quantile 门登记，§7），与我 44 行变动零交集。

## ⑮ 确定性与完整性回执

- 终态门连跑 3 次输出逐字一致（含金丝雀还原后 1 次）。
- `scripts/ontology-anchor-baseline.json` / `scripts/gate-ledger.json` **零字节改动**
  （git porcelain 仅 `docs/SYSTEM-ONTOLOGY.md` + 本报告）。
- 未跑 vitest / pnpm build；git 全程 SSH 一次性 URL。
- 校准证据基 = 776b7d33e 的 src。d89b81393 并入 quantile/r13 后 src 有移动，TOL ±40 吸收小漂；
  **并线后需重跑一次门**，若出新 LINE_DRIFT 再走一遍 `--update` + ⑪同款审计即可。

---

# 基线换键（2026-08-19 · 裁决授权原地续做）

## ⑯ 换键 diff 原文（手工编辑，恰好 -2/+2，tolerance 40 与其余字节零动）

```diff
@@ -14,7 +14,6 @@
-    "apps/agentcore/src/catalog/service.ts::ExtraToolStepSchema",
@@ -85,7 +84,6 @@
-    "apps/agentcore/src/workflow/executor.ts::ExtraToolStep",
@@ -280,6 +278,8 @@
+    "packages/contracts/src/skill-compile.ts::ExtraToolStep",
+    "packages/contracts/src/skill-compile.ts::ExtraToolStepSchema",
```

新键落在字典序正确位置（`qos.ts::path` 与 `slice-layers.ts` 之间，`ExtraToolStep` 前于
`ExtraToolStepSchema`），JSON 校验通过，verified 键数 291→291（-2+2）。
**这不是买绿**：旧键登记的符号位置已被 WO-STEP-VOCAB-UPLIFT 搬走（⑨节已核实新家
`skill-compile.ts:109/:116` 真实存在），基线追上重锚事实 = 认账。

## ⑰ 换键后金丝雀（先金丝雀后门绿，按序执行）

改坏 `skill-compile.ts:116 (ExtraToolStep)` → `(ExtraToolStepZZZ)` ⇒ 门当场红且点名：

```
- [SYMBOL_GONE] 本体 L401 §## 3. 关系图谱（链路 = 模块间关系） symbol `ExtraToolStepZZZ`
  在 packages/contracts/src/skill-compile.ts 中已不存在（被改名/删除）—— 语义漂移，--update 不代劳，须人判新锚点
```

还原后门恢复绿（下方 2 连跑即还原后状态）。

## ⑱ 终态：2 连跑 RC=0，输出逐字一致

```
· 本体锚点：共 601 个 `file:line`
· 已校准（带 (symbol) 可机器核）：321 个 · 容差 ±40 行
· 未校准存量：75 条 / 基线 89 条
· 已补 (symbol) 4 个文件的锚点（可 `--update` 收紧基线落账）
· import 行护栏：实查 581/601 条 · 坏锚点 0 条 · 金丝雀 26/26 全中（检测逻辑活着）
  ⚠️ 另有 20 条**未受本护栏覆盖**（非"已确认干净"）：其中 20 条是裸文件名锚点路径不唯一
  （无 (symbol)·按既有设计记入未校准存量、不为此报红）；补上 (symbol) 或写全仓根相对路径即可纳入护栏。

✓ 本体锚点校准门通过（已校准锚点均指向其声称的 symbol；未校准存量未回潮）。
```

RC1=0 · RC2=0 · `diff` 两次输出为空（逐字一致）。
口径注记：未校准存量 75 < 基线 89（本单补 symbol 降了 14 条，棘轮允许方向）；
「收紧落账」提示是信息性输出、非红——收紧属另一动作，本单未做。

## ⑲ 完整性回执

- `scripts/gate-ledger.json` 零字节（全程未碰任何 `--update` 类全局再生成）。
- 本单累计改动文件 = `docs/SYSTEM-ONTOLOGY.md` + `scripts/ontology-anchor-baseline.json` + 本报告，三者之外零触碰。
- 「校准证据基 776b7d33e，并线 d89b81393 后需重跑门」注记保留（见⑮末条）。
