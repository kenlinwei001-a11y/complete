# HANDOFF · WO-ONTO-S8-MERGE-GUARD（§8 消红 + 「状态只许前进」门）

- 分支：`claude/handoff-onto-s8-merge-guard`（本 worktree 分支 `worktree-agent-a93307f49a6c186d0`）
- 集成线：`claude/verify-reclaim-6` @ `7c52b9b4280f9ccfd60e3abfb2bd70bc9b2a1c05`（收编日复核仍为 tip）
- 交付 tip：见文末提交清单（共 6 个提交，逐单元落账）
- 范围边界遵守：全程只碰 `docs/SYSTEM-ONTOLOGY.md`（§8 + §7 一条目）、`scripts/check-ontology-s8-status.mjs`、
  `scripts/ontology-s8-status-exemptions.json`（新建）、`scripts/gate-ledger.json`（单条目 append）+ 本文档。
  **零源码改动**（`apps/**` / `packages/**` 一行未动）。

---

## 1. 红文原文（开工当日两门实测输出，逐字留存）

### 1a. `ontology-s8-dedupe:check` RC=1

```
✗ §8 有 12 个编号各占多行（编号行 202 · 唯一编号 182）：
   G-PRD-DATA-UNGROUNDED → 行 2124 / 2126
   G-BE-FE-SEAM-DEAD → 行 2125 / 2128 / 2132 / 2136
   G-BE-FE-FIELD-DEAD → 行 2127 / 2134 / 2137
   G-SEAM-GATE-METHOD-BLIND → 行 2129 / 2133
   G-MOCK-OVERCLAIM → 行 2130 / 2131 / 2135 / 2138
   G-CELL-PACK-2STAGE → 行 2183 / 2203
   G-CAPACITY-DEAD-BI → 行 2204 / 2205
   G-ADOPT-SCHEME-NO-CARRIER → 行 2225 / 2227
   G-ACTION-NOOP-EXEC → 行 2226 / 2230
   G-PROCESS-TICK-COVERAGE → 行 2320 / 2321 / 2323
   G-GATE-ROSTER-HANDCOPIED → 行 2322 / 2324 / 2329 / 2332
   G-MOCK-PARAM-ARITY-SILENT-DROP → 行 2331 / 2333
```

机制（WO-QUEUE-breakpoints-2 记载 + 本单复核属实）：**dedupe 收口被后续收编 merge 逐次带回**
——merge 解冲突把旧副本行当新增内容合回来，同一编号重新占多行。12 组里有 10 组是
WO-ONTO-DEDUPE（2026-08-17）已收口过的编号又被带回，2 组（G-CELL-PACK-2STAGE /
G-CAPACITY-DEAD-BI）是该单之后新产生的重复。

### 1b. `onto-s8-status:check` RC=1

```
🔴 §8 有 2 个编号行**没有状态标记**（🔴/◑/✅ 三态之一）：
   L2126 G-PRD-DATA-UNGROUNDED
   L2205 G-CAPACITY-DEAD-BI
```

两行无标记行**恰好都是被 merge 带回的旧副本**（1a 的 2126 / 2205）——dedupe 删行即同时消掉这两条 status 红，
无需另行补标（对旧副本补标反而会把它留在表里）。

---

## 2. 消红 · 12 组重复逐条处置（判据：同一笔账 ⇒ 留信息最全行，旧行独有内容并入；逐行 diff 后才删）

| 组 | 编号 | 保留行(原行号) | 删除行(原行号) | 判据与证据 |
|---|---|---|---|---|
| A | G-PRD-DATA-UNGROUNDED | 2124 | 2126 | 2124 是 2126 的严格超集（difflib 逐段 diff：2126 每一段都含于 2124），2126 且无状态标记 |
| B | G-BE-FE-SEAM-DEAD | 2128 | 2125 / 2132 / 2136 | 超集链：2128⊃2125、2132⊃2136（各单 opcode diff 实证），再判 2128⊇2132 的独有实质 |
| C | G-BE-FE-FIELD-DEAD | 2127 | 2134 / 2137 | 三行逐字节相同（同源复制），任留一行 |
| D | G-SEAM-GATE-METHOD-BLIND | 2133 | 2129 | 2133 是 2129 的 ✅ 收口新版；2129 独有内容 = 当日已被证伪的 🔴 判负理由（2129 自己行内已记载证伪） |
| E | G-MOCK-OVERCLAIM | 2130 | 2131 / 2135 / 2138 | 2130 带 WO-ONTO-DEDUPE 合并注记（是上次收口行），余三行内容逐段含于它 |
| F | G-CELL-PACK-2STAGE | 2183 | 2203 | 2183 是上次逐字并录的合并行，2203 为带回旧副本 |
| G | G-CAPACITY-DEAD-BI | 2204 | 2205 | 2204 超集；2205 无状态标记 |
| H | G-ADOPT-SCHEME-NO-CARRIER | 2227 | 2225 | 2227 是 ✅ 行；2225 独有内容 = 过期 🔴 状态格，其事实已被 2227 行内「接线前为…」括注逐字覆盖 |
| I | G-ACTION-NOOP-EXEC | 2230（并入后） | 2226 | 2226 独有 08-16 逐型实测订正段 + ⚠ G-PLAN-CHANGE-NO-LEVER 提醒句 → **逐字并入 2230** 后删；2226 的 08-18 段与 2230 开头 ✅ 段同源 |
| J | G-PROCESS-TICK-COVERAGE | 2323 | 2320 / 2321 | 2323 是 WO-ONTO-DEDUPE 合并行；2320/2321 独有内容已被其 ①-④ 注记覆盖 |
| K | G-GATE-ROSTER-HANDCOPIED | 2324（并入后） | 2322 / 2329 / 2332 | 2329 独有 SWEEP-2 收口段（roster 债 13→7）→ **逐字并入 2324** 后删；2322（最老行）独有实质 = 「判负理由已证伪」结论，即 2324 末段 08-17 补记；2332 全部段落 2324 逐字持有 |
| L | G-MOCK-PARAM-ARITY-SILENT-DROP | 2331 | 2333 | 两行仅引用格式差异（内容等价），留 2331 |

合计删 20 行、2 行各并入一段独有内容（I 组 08-16 段、K 组 SWEEP-2 段，均在保留行内以原话落地），
并在两个并入行各加一条「去重注记（2026-08-19 · WO-ONTO-S8-MERGE-GUARD）」写明带回路径与并录范围。
**未丢一条独有信息**（每组删除前都跑了逐段 diff，唯一拿不准即停手上报的情形未出现）。
§8 编号行 202 → **182**，与唯一编号数一致。

## 3. 消红 · G-STEP-VOCAB-SPLIT-TWO-HOMES 的 ✅ 回滚恢复（status 红之外的第三处病灶）

WO-QUEUE-breakpoints-2 记载的第二例「✅→🔴 状态回滚」：回写提交 `a81062e29`（WO-STEP-VOCAB-UPLIFT）
本是 HEAD 祖先，收编合并 `3ddd98dff`（refgraph-wire，第一父 `c08657446`）解冲突取旧行，
把状态列从 ✅ 改回 🔴（`git diff c08657446 3ddd98dff` 对该行 -✅/+🔴 实证）。

**代码侧现核（2026-08-19，决定恢复 ✅ 的证据链）**：
- 单一出处在位：`packages/contracts/src/skill-compile.ts:109 (ExtraToolStepSchema)` /
  `:123 (ExtendedPlanStepSchema)`；
- agentcore 三处本地副本已删：`catalog/service.ts` 头注自述引用契约那份，全仓
  `const ExtraToolStepSchema` 仅 contracts（+dist）一处命中；
- 咬合测试双方在位：`packages/contracts/test/step-vocab.test.ts`（5 例）+
  `apps/agentcore/test/step-vocab-single-home.test.ts`（引用相等 toBe）；
- `validatePlanSteps` 形参吃契约类型（`apps/agentcore/src/workflow/validate.ts:72`）。

处置：状态列恢复 `a81062e29` 的 ✅ 全文，行内加「回滚实录」段（合并号/代码证据/机制门指针）。
判「代码侧真回归而非文档回滚」的停手情形**未触发**——代码侧四证齐全支持 ✅。

## 4. 建门 · 判据二「§8 状态只许前进」（并入既有 `onto-s8-status:check`，不另立门文件）

按派单「读现有实现后择一，倾向并现有门」执行：读 `check-ontology-s8-status.mjs` 后在同一文件加判据二，
`scanSectionRows()` 提为两判据共用抽取（判据一行为逐字节不变，开工前后输出 diff 为空——除行数随消红变化）。

- **判据**：区间 `merge-base(HEAD, origin/claude/verify-reclaim-6)..HEAD` 逐提交（合并按第一父 diff）：
  任一编号在父提交有任一行带 ✅、子提交该编号的行一个 ✅ 都不剩且带 🔴/◑ ⇒ RC=1 逐条点名
  （提交号 + 编号 + 父/子标记集）。判据落行内容 diff，不落提交信息。
- **豁免通道**：`scripts/ontology-s8-status-exemptions.json`（新建，交付态为空数组 `[]`），
  同 (commit 前缀, 编号) 且 reason ≥20 字，照 `file-truncation-exemptions.json` 先例；
  豁免册畸形/理由不足 ⇒ RC=2（工具坏）。
- **开关**：`--selftest`（只跑金丝雀）· `--range A..B`（考古/复验）· `--base <ref>`（换参考系）；
  区间为空如实打印「拦门非考古」。
- **诚实边界（写进门头注）**：① 叙述性提及标记字符的理论漏报通道（标记按字符出现抽取，
  先剥 `~~…~~` 删除线）；② 编号整行消失不归本判据（存废决策，diff 里人看得见）；
  ③ 在集成线本体上区间为空是设计使然。
- **金丝雀 7 条全部与主逻辑共用同一份 `judgeRegressions()`/`scanCommitGuard()`**：
  ⑤ 合成 ✅→🔴 必咬 · ⑥ 删除线作废只剩 🔴 必咬 · ⑦ ✅→✅ 演进不咬 · ⑧ 🔴→✅ 前进不咬 ·
  ⑨ dedupe 删行（父同编号两行其一 ✅、子留 ✅ 行）不咬 —— 即本单消红提交的合法形态，
  已被真跑实证（本单 dedupe 提交在区间内判干净）· ⑩ **真史必咬**：合并 `3ddd98dff` 必咬在
  `G-STEP-VOCAB-SPLIT-TWO-HOMES` · ⑪ **真史必不咬**：回写提交 `a81062e29` 不咬（那是前进）。

## 5. 变异反证实录（交付前真跑）

| # | 动作 | 结果 |
|---|---|---|
| M1 | 临时提交 `4af09a65b`：把 G-STEP-VOCAB-SPLIT-TWO-HOMES 行内 4 个 ✅ 全改 🔴 | 门 **RC=1**，逐字点名 `4af09a65b G-STEP-VOCAB-SPLIT-TWO-HOMES —— 父提交标记「🔴◑✅」→ 本提交「🔴◑」` ✔ 必咬成立 |
| M2 | `git reset --hard HEAD~1` 还原 | porcelain 干净（仅豁免册新文件未跟踪），门回 RC=0 ✔ |
| M3 | 金丝雀自坏面：`--selftest` 覆盖判据一 3 条 + 判据二 7 条（含真史双向），任一不中即 RC=2；另有 ROW_FLOOR 扫描面下界自证在主路径常驻 | 全中 RC=0 ✔ |

⚠ 过程事故如实记账：M2 的 `reset --hard` 把**当时尚未提交**的门脚本新代码一并冲掉
（瓷器活教训：变异测试前必须先提交在做的单元）。已按上下文原样重建并复跑 M1 等价验证
（重建版与变异实测版为同一份代码，selftest/gate 输出逐字一致），随后立即提交（`3db1d3c70`）。

## 6. 回写清单（铁律 0）

| 对象 | 动作 | 提交 |
|---|---|---|
| §8 十二组重复行 + G-STEP-VOCAB ✅ 恢复 | 消红主体 | `15957e93b` |
| §8 本单新写文字的字面序列回扫 | 两处「🔴 紧邻未修」改写法（会被 `dispatch-deficit.sh` 的 `grep -cE '🔴 *未修\|◑ *部分闭合'` 数进待写WO 队列；该 grep **不按 §8 限定范围**、全文档计行）。队列匹配行 31→30，G-STEP-VOCAB 已是 ✅ 行本不该再被数成未闭。存量历史引文（删除线段、08-16 订正原话）按既有口径保留 | `48e6cd7d0` |
| §7 门账 `onto-s8-status` 条目 | 续写判据二全量（事故形态/判据/豁免/金丝雀/变异结果/诚实边界） | `661782eb4` |
| `scripts/check-ontology-s8-status.mjs` + `ontology-s8-status-exemptions.json` | 判据二实现 + 空豁免册 | `3db1d3c70` |
| `scripts/gate-ledger.json` | 单条目 append（guardedPaths +豁免册；provenRed.note 续 M1 实录；notes 续判据二一句）。diff 4+/3-，整版格式未动 | `e8db266c0` |
| 本文档 | 交付报告 | （见最终 tip） |

## 7. RC 表（开工前 → 交付后）

| 门 | 前 | 后 | 说明 |
|---|---|---|---|
| `ontology-s8-dedupe:check` | **1**（12 组重复） | **0**（182==182，金丝雀 3/3） | 本单消红 |
| `onto-s8-status:check` | **1**（2 行无标记） | **0**（判据一+二均干净，金丝雀 3+7 全中） | 无标记行即被删旧副本；判据二区间 1 提交（本单 dedupe 提交）判干净 |
| `check-system-ontology` | 0 | 0 | 邻门复跑无回归 |
| `check-ontology-writeback` | **1** | **1** | **既有红，非本单造成**：`check-name-consistency` 在 pnpm gates 而 §7 未登记——基线提交复跑同红（该门在 HEAD 的 §7 确无条目，仅 §8 行内提及）。不替别人登记（无其 provenRed 证据 = 编造），如实照报 |
| `check-gate-ledger` | **2** | **2** | **环境性既有**：本 worktree 未构建 datacore/agentcore dist，27 条 dist guardedPaths 无从核；stash 对照实验（无本单改动）同报 27 条逐字一致。内容判据四项（无遗漏/无幽灵/binding 现算一致/escalation 合法）均过 |
| `check-ontology-anchors` | **1** | **1** | **既有红**：LINE_DRIFT/SYMBOL_ONLY 按 `文件:行号(symbol)` 键对拍 base=HEAD=40 条全等（原始红行 62→50 是被删旧副本带走重复引用）；UNVERIFIED_GROWTH base 8 条 → HEAD 4 条（均为 base 子集）。**复验抓到 1 条本单新增 UVG 已修**：回滚实录段裸引 `validate.ts:72` 无 symbol，复验退回后补成 `:72 (validatePlanSteps)`（见本 HANDOFF 之后的修复提交），修后全类红集合对 base 零新增。本单未触源码，LINE_DRIFT 无一可归于我 ⇒ 未动 `--update`（派单授权仅限「我造成的漂移」，没有就是没有） |

## 8. merge-tree 干跑

```
git merge-tree --write-tree 7c52b9b4280f9ccfd60e3abfb2bd70bc9b2a1c05 HEAD
→ RC=0，tree 53d403e6ec04f32c38c7d1fcee5710bdc3931362（干净，无冲突）
```

## 9. 并发与边界注记

- **anchor-recal2 分支（@ccbe76f3a，本体锚点行号校准）** 与本单同碰 `docs/SYSTEM-ONTOLOGY.md`
  但只动锚点行号：本单删/并了 §8 的 20+2 行，**会使该分支校准对象的下游行号整体前移（实测文档总行数 -20）**
  （§8 区内锚点除外——它按 `(symbol)` 机器核，行号漂移在 ±40 容差内不红，超容差的按它自己的
  --update 流程走）。两方无内容冲突（merge-tree 干净），收编顺序不影响正确性。
  并线次序建议（复验方已落账认可）：**本单先并**——拦门早并早保护，且本单 dedupe 语义不可重放、
  anchor-recal2 的行号校准机械可重放。
- **停手上报情形触发数：0**（未碰 §8 以外正文作语义改动——§7 一条目续写属派单明令的门账回写；
  旧副本独有信息全部拿得准；status 红无代码侧真回归；远端分支无撞车）。
- 判据二的默认基线 `origin/claude/verify-reclaim-6`：本 worktree 已 fetch 到 tip `7c52b9b42`。
  若集成线日后改名/前进，门用 `--base` 换参考系即可，无需改代码。

## 10. 提交清单（push 至 `claude/handoff-onto-s8-merge-guard`）

1. `15957e93b` — §8 消红主体（12 组 dedupe + G-STEP-VOCAB ✅ 恢复）
2. `3db1d3c70` — 判据二门实现 + 空豁免册（变异反证 M1-M3 过）
3. `48e6cd7d0` — §8 字面序列回扫（队列计数 31→30）
4. `661782eb4` — §7 门账回写
5. `e8db266c0` — gate-ledger 登账（append 形态）
6. （本 HANDOFF 文档提交）
