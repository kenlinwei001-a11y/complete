# MERGE-ORDER-ADVISORY · 并线顺序建议书

> 生成：2026-08-18 · WO-MERGE-ORDER-DRYRUN（轻画像·只读干跑）
> 方法：全部结论来自 `git merge-tree --write-tree` 干跑（不落盘）+ `git show` 合并树内容实证；零 vitest / 零 build / 零 push 正线 / 零改基线。
> 落线 dev 按本文波次执行；每并一张前建议重跑一次该张的 merge-tree 干扫（集成线在动）。

## 0. 基线与清单核对

- **集成线 tip 实测 = `d89b8139388fbef9b477956d6ee21082c94a863b`**（`claude/verify-reclaim-6`）。
  WO 所述 `776b7d33` 在扫描期间被推进：`776b7d33..d89b81393` 新落两张——
  - `quantile-unit-two-reds` @ e0436c537（merge 373897615，**按哈希已并入**，ahead=0）
  - `r13-ontochain-panel` @ 1366256db（merge d89b81393，**按哈希已并入**，ahead=0）
  - 本文全部落后数 / merge-tree RC / 冲突清单均以 **d89b81393** 为准重核。
- 18 张清单 tip 与 `ls-remote` 实测**逐张相符**（无漂移）。
- 实际待并 **16 张**：mock-discover-parity（WO 注明已并）、quantile-unit-two-reds、r13-ontochain-panel 三张划掉。

## 1. 汇总表（16 张，按建议落线序预排）

| # | 分支 | tip | ahead | 落后 | merge-tree RC | 冲突文件 | 机械解难度 |
|---|------|-----|-------|------|---------------|----------|-----------|
| 1 | dispatch-deficit-fix | 50a0170ee | 3 | 199 | 0 | — | 自动并 |
| 2 | dispatch-deficit-macos | 2634591fb | 1 | 15 | 0 | — | 自动并（与 #1 互撞 `scripts/dispatch-deficit.sh`，后落者解一处） |
| 3 | trace-ledger-sweep | d964339e5 | 4 | 134 | 0 | — | 自动并 |
| 4 | oee-ssot-c | 523245882 | 3 | 199 | 0 | — | 自动并 |
| 5 | ref-closure-tail | f63c06db5 | 1 | 30 | 0 | — | 自动并 |
| 6 | roster-reg-2 | a2349bc57 | 1 | 15 | 0 | — | 自动并（**必须先于 gate-b**，见 §3-C） |
| 7 | plan-change-lever-map | dde9ee3d2 | 2 | 15 | 0 | — | 自动并（**必须先于 sandbox-action**，见 §3-E） |
| 8 | publish-refprobe | ea86916e1 | 6 | 261 | 1 | `apps/agentcore/src/catalog/service.ts` · `docs/REQUIREMENTS-TRACE.md` · `docs/SYSTEM-ONTOLOGY.md` | 需手工（3 文件） |
| 9 | mock-fe-registry-parity | 9e64711e7 | 10 | 261 | 1 | 同 #8 三文件（全来自其内含的 refprobe 提交） | refprobe 先并后**近乎自动并**（见 §3-B） |
| 10 | doctrine-writeback | 6d7500b90 | 5 | 261 | 1 | `docs/SYSTEM-ONTOLOGY.md` · `package.json` · `scripts/gate-ledger.json` | 机械并集（ledger 为纯追加 `check-md-section-dup.mjs` 条目） |
| 11 | gate-b-browser-harness | f209c6cf0 | 4 | 134 | 1 | `docs/PRD-harness-ux-adoption.md` · `package.json` · `scripts/gate-ledger.json` · `scripts/gate-roster-baseline.json` | 需手工（**ledger 只许追加**，见交互点 3） |
| 12 | fact-usage-registry | 8325a2043 | 4 | 134 | 1 | `docs/SYSTEM-ONTOLOGY.md` · `package.json` · `scripts/check-fact-usage.mjs`(add/add) · `scripts/fact-usage-baseline.json`(add/add) | 需手工 + **ledger 重复键去重**（见交互点 2） |
| 13 | mockdc-params-increment | 597f3b757 | 1 | 30 | 1 | `docs/SYSTEM-ONTOLOGY.md` | 机械（单文件） |
| 14 | gsim-cockpit-nl | 22792d945 | 3 | 261 | 1 | `docs/SYSTEM-ONTOLOGY.md` | 需手工（**丢 stale 行**，见交互点 5） |
| 15 | config-collapse | fd024625e | 7 | 134 | 1 | `scripts/ui-first-layer-baseline.json` | 机械（单文件；先于 sandbox-action） |
| 16 | splitaccount-b2-baseline | c445a8d9a | 1 | 15 | 1 | `scripts/harness-ux-splitaccount-baseline.json` | 需手工（**判据⑤重记**，见交互点 6 操作步骤） |
| 17 | sandbox-action | 27c5e3684 | 5 | 208 | 1 | `apps/datacore/src/actions.ts` · `apps/datacore/src/app.ts` · `apps/frontend-shell/src/views/cleanroom/CleanroomAttrView.tsx` · `docs/PRD-harness-ux-adoption.md` | 需手工 + **棘轮现算**（见交互点 4）· 压轴 |

（编号即建议顺序；#17 压轴故表尾。）

## 2. 分支两两交互实测（pairwise merge-tree，定序依据）

| 配对 | RC | 冲突文件 | 定序结论 |
|------|----|----------|----------|
| dispatch-deficit-fix × dispatch-deficit-macos | 1 | `scripts/dispatch-deficit.sh` | 串行，后落者解一处（fix 先、macos 后） |
| plan-change-lever-map × sandbox-action | 1 | `actions.ts` · `app.ts` · `CleanroomAttrView.tsx` · `PRD-harness-ux-adoption.md` | plan-change 现干净，**先落**；sandbox 反正手工，一次解完 |
| config-collapse × sandbox-action | 1 | `CleanroomAttrView.tsx` · `PRD-harness-ux-adoption.md` | config-collapse 先于 sandbox |
| roster-reg-2 × gate-b-browser-harness | 1 | `package.json` · `gate-ledger.json` · `gate-roster-baseline.json` | roster-reg-2 先（保住它的零冲突） |
| doctrine-writeback × gate-b-browser-harness | 1 | `SYSTEM-ONTOLOGY.md` · `package.json` · `gate-ledger.json` | 串行：doctrine → gate-b |
| fact-usage-registry × gate-b | 1 | `package.json` · `gate-ledger.json` | 串行 |
| fact-usage-registry × doctrine-writeback | 1 | `SYSTEM-ONTOLOGY.md` · `package.json` · `gate-ledger.json` | 串行 |
| mockdc-params-increment × gsim-cockpit-nl | 1 | `docs/SYSTEM-ONTOLOGY.md` | 串行：mockdc 先（小），gsim 后 |

## 3. 并线顺序建议（五波）

**波次 A · 零冲突先行**（1–7）：dispatch-deficit-fix → dispatch-deficit-macos（解 `dispatch-deficit.sh` 一处）→ trace-ledger-sweep → oee-ssot-c → ref-closure-tail → roster-reg-2 → plan-change-lever-map。
一句话：七张对当前线 RC=0，先把不花人手的落掉，且 roster-reg-2 / plan-change-lever-map 各自有一张后面的手工单等着它们先落。

**波次 B · 栈叠对**（8–9）：publish-refprobe 手工解 3 文件先落 → mock-fe-registry-parity。
实证：mock-fe 的 merge-base 对 refprobe = refprobe tip（**栈叠成立**，其 10 个 ahead 里 6 个是 refprobe 的提交）；refprobe 落地后 mock-fe 有效 delta 缩为自有 5 文件（`mocks/handlers.ts` · `mocks/solverRegistry.ts` · 两个 seam 测试 · HANDOFF 文档），其中与线相交的仅 `handlers.ts`，用 `--merge-base=<refprobe tip>` 强制干跑实证**不在冲突清单** ⇒ 近乎自动并。

**波次 C · ledger/package.json 地雷串行**（10–12）：doctrine-writeback → gate-b-browser-harness → fact-usage-registry。
- doctrine：ledger 改动实证为**纯追加** `check-md-section-dup.mjs` 条目（diff 只有 `+` 块），机械并集即可。
- gate-b：**A 线硬条件**——`gate-ledger.json` 以集成线为底、仅追加 `check-harness-ux-behavior.mjs` 条目（分支版在 1759 行起有该条目，照抄该块）；**禁止 take 分支整册**（分支对 ledger 是 1823→1778 行的整册重写，take 它会洗掉线上既有反证记录）。
- fact-usage 放最后：ledger 文本可自动并，但产出**重复键地雷**（见交互点 2），一次去重收口。

**波次 D · 本体 §8 单点串行**（13–14）：mockdc-params-increment（小，先）→ gsim-cockpit-nl（后，带交互点 5 的丢行规则）。

**波次 E · 重手工收尾**（15–17）：config-collapse（`ui-first-layer-baseline.json` 机械解）→ splitaccount-b2-baseline（按交互点 6 五步操作）→ sandbox-action 压轴（4 文件手工 + 棘轮现算，见交互点 4；它扫的 UX 面最大，等前面全部落定后一次现算最稳）。

## 4. 已知交互点逐条核对（WO 7 条，全实证）

**① publish-refprobe 必须先并于 mock-fe-registry-parity —— 相符。**
`git merge-base publish-refprobe mock-fe-registry-parity` = `ea86916e1` = refprobe tip（栈叠实证）；refprobe 冲突恰为 WO 点名 3 文件（catalog/service.ts · REQUIREMENTS-TRACE · SYSTEM-ONTOLOGY）；mock-fe 冲突同样 3 文件且全部来自其内含的 refprobe 提交（自有 delta 5 文件不含它们）。落线操作：先并 refprobe（手工解 3 文件），mock-fe 随后近乎自动并。

**② gate-ledger.json 重复键地雷 —— 相符，且比 WO 所述更具体。**
fact-usage 合并树（tree `576e0498…`）的 `scripts/gate-ledger.json` 文本中 `"check-fact-usage.mjs"` 出现 **2 次**（偏移 33923 / 137682）：
- 前者（分支带入）：`binding: "GATES_CHAIN"`，guardedPaths 7 项完整版——**这是真绑定**；
- 后者（集成线既有）：`binding: "NONE"` stub（integ 现 entry 实测即 NONE）。
`JSON.parse` 取后者 ⇒ 解析结果 = NONE stub ⇒ 合并树上 gate-ledger:check 判据③必红，与 WO 一致。
落线操作：merge 后**手工去重——删 NONE stub、保留 GATES_CHAIN 完整版**；verify：`git show <合并结果>:scripts/gate-ledger.json | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['gates']['check-fact-usage.mjs']['binding']=='GATES_CHAIN'"`，并 `grep -c` 确认键只出现 1 次。

**③ gate-b A 线硬条件 —— 相符。**
实证：分支版 `gate-ledger.json` 对集成线是整册重写（diff 统计 1823→1778 行、全文 minus/plus）；分支确实含 `check-harness-ux-behavior.mjs` 条目（其 ledger 1759 行起），集成线 0 条。落线操作：ledger 冲突一律取集成线文本，再把分支条目**整块追加**进 `gates`，其余 hunk 不 take。

**④ sandbox-action 棘轮符合数落 109 —— 相符（对当前线实测）。**
`scripts/sim-ux-criteria-baseline.json` 现算（cells 全格统计「符合」）：集成线 102/132 · 分支 102/132 · **合并树（tree `ede751d3…`）109/132**。落线操作：sandbox-action 压轴并入后棘轮须**当次现算重记**——若前序波次改了 UX 扫描面，读数以落线时刻现算为准（不得低于前值 102，预期≈109），禁手抄本文数字。

**⑤ gsim-cockpit-nl 丢 G-GSIM-LIVE-FLAG-STALE 新行 —— 相符，且要多丢一处。**
实证：集成线上该断点**已闭**（`SYSTEM-ONTOLOGY.md:2334`「✅ 已闭 2026-08-17 · WO-GSIM-LIVE-FLAG-REASON」，`defaultOn` 已翻 `true`，现 `features.ts:132`）；而分支在 `SYSTEM-ONTOLOGY.md:2048` 新增**同名 🔴 未修行**、并重写 2047 的 G-GSIM-DEAD-COCKPIT 行——并入即倒退。
**额外发现**：分支 `REQUIREMENTS-TRACE.md` 新增的「🔶 等你裁决」第 7 条（`G-GSIM-LIVE-FLAG-STALE` 裁决请求）**文本上是自动并不冲突的**，但集成线 J 节（`:151`）显示该裁决**已被 WO-GSIM-LIVE-FLAG-REASON 执行**（defaultOn false→true 已落）——不手工删掉会静默带进一个已过期裁决请求。
落线操作：解 `SYSTEM-ONTOLOGY.md` 冲突时保留集成线已闭版本、丢分支 🔴 新行；同时检查 `REQUIREMENTS-TRACE.md` 合并结果，删分支新增的第 7 条裁决请求。

**⑥ r13 × splitaccount-b2 判据⑤ —— 情形已变（r13 扫描期间并入），按协调口径改写。**
实证：r13 @ 1366256db 已按哈希并入线（merge d89b81393），其「判据⑤ 现算 5 面板 3 有链」已把集成线基线改写成 `chain: {panels:5, withChain:3}`；b2 分支版是 `{panels:4, withChain:0}`，merge-base 版是 `{3,0}` ⇒ b2 并线时该文件**硬文本冲突**（merge-tree RC=1 已实测），且其 HANDOFF『3→4』叙述与 baseline 读数**双双过期**。
落线操作（五步）：
1. 解 `scripts/harness-ux-splitaccount-baseline.json` 冲突时**文本上取集成线底**（不在冲突块里手填数字）；
2. 跑 `node scripts/check-harness-ux-splitaccount.mjs`，读判据⑤报文（门会报「B-2 现算读数变了」并指向 --tighten）；
3. 按分支收窄后的口径跑 `node scripts/check-harness-ux-splitaccount.mjs --tighten` **机器重记基线**（`accounts`/`chain` 归机器算，禁手抄；协调方预期读数 `chain: {panels:4, withChain:3}`——以当次现算输出为准）；
4. 同批订正叙述：`docs/HANDOFF-WO-SPLITACCOUNT-B2-BASELINE.md` 的『3→4』改成「r13 落 5/3 → 本单收窄口径重记 4/3」口径，`docs/PRD-harness-ux-adoption.md` §4.2 同步；
5. 复跑该门 RC=0 收口（判据⑤⑥全绿）。

**⑦ ancher-recal-2 / dependson-cover（在跑）预留位 —— 已预留。**
两张均将再碰本体 §8。影响面预判：波次 D（mockdc / gsim）与波次 C 的 doctrine 都解 `SYSTEM-ONTOLOGY.md`——若这两张先到线，D 波冲突面变大；若后到，它们自己要重解。落线操作：落这两张前（或它们落线后并 D 波前）重跑一次对应 merge-tree 干扫，本文 §1 表该两张位置留空待填。

## 5. 复扫命令（落线 dev 自取）

```bash
R=git@github.com:kenlinwei001-a11y/complete.git
git fetch $R claude/verify-reclaim-6:refs/scan/integ claude/handoff-wo-<name>:refs/scan/<name>
git merge-tree --write-tree --name-only refs/scan/integ refs/scan/<name>   # RC=0 干净 / RC=1 后附冲突清单
```

— 扫描执行：merge-order-dryrun agent · 全部数字可对 `refs/scan/*`（保留在主仓引用下）复算。
