# HANDOFF · WO-ROSTER-REG-2（roster 门两条未定性常量登记）

> 病灶：`check-gate-roster-handcopied.mjs` 在集成线 776b7d33e 裸红 RC=1，点名两条未定性写死集合
> （sweep-2 已并，这两条是后落地的新门常量、未登记）。
> 边界：只许动 `scripts/gate-roster-baseline.json` + 本 HANDOFF；定性为「该现算」须停手报 lead ——
> **两条均定性为非 roster（computed / criteria），未触界，无需改门代码**。
> 分支：`claude/handoff-wo-roster-reg-2`（基线 `origin/claude/verify-reclaim-6` tip `776b7d33e`）。

## 1 · 修前 / 修后对照

| 态 | roster 门 | RC |
|---|---|---|
| 修前（pristine 776b7d33e） | `✗ 未通过（2 条）`：① `check-fact-usage.mjs:EXCLUDE_DIRS`（4 键类）① `check-file-truncation.mjs:PROTECTED_PATTERNS`（3 路径类） | **1** |
| 修后 | `✓ 通过（无未定性候选 · 无死账 · 定性合法且各有理由 · roster 债 7 ≤ ratchetHigh 7）` | **0** |

定性分布：criteria 48→**49** · computed 19→**20** · roster **7→7** · 候选名册 74→**76** · ratchetHigh **7 未动**。

## 2 · 判据形态（改了什么）

只动 `scripts/gate-roster-baseline.json` 一个文件，diff +9/-1：
- 新增条目 `check-fact-usage.mjs:EXCLUDE_DIRS` → **computed**；
- 新增条目 `check-file-truncation.mjs:PROTECTED_PATTERNS` → **criteria**；
- `candidateCount` 74→76（判据④ 基线自洽要求 = entries 条数，一处显眼 diff）。
- `rosterCount` / `ratchetHigh` / 既有 74 条 entries（含 7 条 roster 债）**一字未动**；`note`/`generatedBy` 未动（新候选人手定性是文件头 note ⑤ 的既定流程，非机器写账）。

两条 why 原文（判据③ 要求 ≥20 字且不许套话）：

> **EXCLUDE_DIRS（computed）**：遍历过滤输入常量，不是受检名单：受检对象集合（屏上事实读取位所在的 .ts/.tsx）由 FRONTEND_SRC 递归遍历现算，本表只按目录用途剔除四类非生产源树（mocks=MSW 假数据、locales/styles/assets 无事实读取位）。与 check-chain-node-singlesource.mjs:SKIP_DIRS 同形（先例同判 computed）。四个名字是前端分层约定，加页加事实不动它；真要变只有一种情形——引入新一类非生产目录约定，那是对扫描面定义的有意修订（改判据作用域），不是名单漂移。

> **PROTECTED_PATTERNS（criteria）**：受保护清单 = 「哪类文件被一次提交清空算事故」的治理定义，不是「现存哪些文件」的枚举：三条 glob 按类别圈定（本体单文件 / 全部 PRD / 全部门基线），同类新成员（新 PRD、新门基线）被 * 自动覆盖、不靠加条目，故不随仓库演进而变。无可现算的单一来源——从「现存文件」现算会变成「有什么就护什么」的同义反复（与 check-cockpit-widgets.mjs:REQUIRED_WIDGET_TYPES 同形）。真史金丝雀（3298add3 必须咬在 SYSTEM-ONTOLOGY 上）把最要害一条钉死，删了当场 RC=2。扩保护类（如 HANDOFF/AUDIT 文档）是新的治理裁决，走改门流程，不算名单漂移。

## 3 · 定性取证（凭什么这么判，逐条答门判词「会随仓库演进而变吗」）

**① `check-fact-usage.mjs:EXCLUDE_DIRS`**（`scripts/check-fact-usage.mjs:74`，用法 `:82`）
- 角色实证：`collectFiles()` 从 `FRONTEND_SRC`（`apps/frontend-shell/src`）**递归遍历现算**全部 .ts/.tsx 为受检集合；EXCLUDE_DIRS 只在递归下降时按目录名跳过 —— 是现算逻辑的**输入常量**，不是受检名单本身（门头注释自陈：「只收生产 UI 源（mocks/ 是 MSW 假数据源，进来会把 fixture 当成屏上读取）」）。
- 先例：`check-chain-node-singlesource.mjs:SKIP_DIRS`（`:697`，同为遍历跳过表）已判 **computed**，why「受检集合由 SCANNED_TREES 遍历现算」——两条同形。
- 答判词：加页面/加事实/加 solver 都不动这四个目录名；唯一会动它的演进是「引入新一类非生产目录约定」，而那是人对扫描面定义的有意修订，属于改判据，不是名单悄悄过期。

**② `check-file-truncation.mjs:PROTECTED_PATTERNS`**（`scripts/check-file-truncation.mjs:79`，用法 `:95` `isProtected`）
- 角色实证：这是**受检对象集合本身**，但它的内容是三条**类别 glob** 不是文件枚举——`docs/PRD-*.md` 与 `scripts/*-baseline.json` 的 `*` 让同类新成员（新 PRD、新门基线）**自动落入保护**，不需加条目；仓库演进（加 PRD/加门）天然被覆盖，集合定义不变。
- 为什么不是 roster（该现算）：现算需要单一来源，而「哪类文件被清空算事故」没有可现算的来源——从「现存文件」推保护清单是「有什么就护什么」的同义反复（先例 `check-cockpit-widgets.mjs:REQUIRED_WIDGET_TYPES` 同形判 criteria：「它定义什么算合格，不是枚举现在有哪些」）。该门的真史金丝雀（真实事故提交 `3298add3` 必须咬在 `docs/SYSTEM-ONTOLOGY.md` 上）把最要害一条钉在判定器里，清单被删/改坏当场 RC=2。
- 边界声明：若未来要把 HANDOFF/AUDIT 等文档类纳入保护，那是扩判据作用域的治理裁决（改门 + 重跑历史分布取证），不是本清单「漂移」。

## 4 · 金丝雀 / 变异证据

- `--selftest` RC=0：`✓ 金丝雀：七向全通过；基线写入器：四向全通过`（该门金丝雀与主逻辑共用同一份解析器/写入器）。
- 否定结论附证：本单报「仅两条未定性」——修前红文恰好指名这两条、无第三条，即扫描面完整的在册证据；修后 `--census` 两条均显示已定性的 verdict。
- 变异反证（亲手一条）：手改 `candidateCount` 76→75 ⇒ **RC=1**「④ 基线自洽：candidateCount=75 ≠ entries 条数 76（改额度必须是一处显眼 diff）」；还原后 **RC=0**。证自洽判据会咬手改坏账。
  （判据①「未定性必咬」不需另做变异——修前 pristine 红文就是它咬出来的现场。）

## 5 · 界外发现

无新增。两条已知 ambient 事实（与本单无关、未触碰）：
- 其余 7 条 roster 债（含 `check-typecheck-coverage.mjs:PACKAGES` 等）照旧在账，ratchetHigh 7 未动；
- gate-b 分支在同文件 append LOGIN 定性条目（71→72），与本单两条是**不同键的 append**，合并为机械并集；本单 diff 不含 LOGIN 条目、未碰其行。

## 6 · 前置门 RC 表

| 检查 | RC | 备注 |
|---|---|---|
| `node scripts/check-gate-roster-handcopied.mjs`（交单态） | **0** | 绿文见 §1 |
| `node scripts/check-gate-roster-handcopied.mjs --selftest` | **0** | 金丝雀七向 + 写入器四向 |
| `node scripts/check-gate-roster-handcopied.mjs --census` | 0 | 两条新条目 verdict 正确显示 |
| 变异 candidateCount 76→75 / 还原 | 1 / 0 | 实录见 §4 |
| `node scripts/check-merge-conflict-markers.mjs` | 0 | |
| `git status --porcelain`（commit 前） | 空 | |
| `node scripts/check-branch-base.mjs claude/handoff-wo-roster-reg-2` | 0 | 基线 = 集成线 verify-reclaim-6 tip |

未跑：`build-gate-ledger.mjs` 任何模式（纪律照旧）；vitest（纯基线数据登记，零代码改动）。
`scripts/gate-ledger.json` 零字节动。
