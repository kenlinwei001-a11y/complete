# HANDOFF-WO-FACT-USAGE-RENAME-INFLATION

**单**：WO-FACT-USAGE-RENAME-INFLATION（fact-usage 棘轮「键改名膨胀照绿」盲区后续单 · 轻画像）
**分支**：`claude/handoff-wo-fact-usage-rename-inflation` · 基线 = 集成线 `claude/verify-reclaim-6` tip **914d0289b**
**日期**：2026-08-19

## 1 · 病灶复现证据（改前实证，不是推断）

`scripts/check-fact-usage.mjs` 原判据 D2 的度量单位是**四个总数**（facts / multiScreenFacts / pairs / caliberDivergent），键级身份它看不见。

**变异**：把基线登记的求解器键 `bottleneck_matrix` 在两处读取位纯改名（值/路径/页全不变）：
- `apps/frontend-shell/src/views/RiskBoardView.tsx:170` `invokeSolver("bottleneck_matrix" → "bottleneck_matrix_v2"`
- `apps/frontend-shell/src/views/sim/ProjectSimView.tsx:224` `runSolver("bottleneck_matrix" → "bottleneck_matrix_v2"`

结果：6 条事实键全部从 `solver:bottleneck_matrix#…` 换成 `solver:bottleneck_matrix_v2#…`，**四个总数一个没变**（462 / 72 / 824 / 6）。

- **旧门**（`git show HEAD:scripts/check-fact-usage.mjs` 原物，置 scripts/ 下以解析相对 import）：**RC=0 照绿**（`/tmp/fu-mut-old.out`，输出与未改名逐字节相同）。
- 形态（铁律 0.6 句式）：「我用『四个总数没跌』当作『注册表内容没被偷换』的证据，而前者并不度量后者。」

## 2 · 修法判据（新增 D5，判据四条 → 五条）

对账粒度从「键」升到「内容」：

- 基线 `scripts/fact-usage-baseline.json` 新增 **`factKeys` 段**：事实键 → **内容签名** = sha256-16(族 | 字段路径 | 页集合 | args 口径)，**不含源键名本身** —— 改名必改键名、必不改签名。
- 现算 vs 基线对账：「消失键 + 新增键」且**内容签名一致** ⇒ **RC=1 点名**「D5 疑似改名：旧键 X → 新键 Y」，要求显式 `--tighten` 重记基线，不许静默放行。
- 正常新增（无同签名消失键）与正常删除（无同签名新增键）**不红**，既有行为不变（删除仍归 D2 规模棘轮管）。
- 基线无 `factKeys` 段（老形态）⇒ **不红**，显式报「未建账」，建账走 `--tighten`（绝不在红绿路径上静默补账）。
- D5 金丝雀 `renamePairCanary()` 五向（纯改名必中 / 正常新增不误判 / 正常删除不误判 / 改名兼改内容不算纯改名 / 未建账识别），与 `reconcileRenamePairs`/`factContentSig` **共用本体**，不过 ⇒ RC=2。

## 3 · 自适应检查结果

`scripts/lib/ratchet-conservation.mjs` **不在线内**（tip 914d0289b 的 `scripts/lib/` 无此文件，它在待并分支 `bcce72f00` 上）⇒ 按单**未 import**，在门内实现本地最小版（`factContentSig` + `reconcileRenamePairs`，对齐其内容键对账 / 未建账不红 / `--tighten` 显式落账三范式）。
**与 ratchet-conservation 的收敛点**：并线后可用 `reconcileContents` 替换 `reconcileRenamePairs`（factKeys 段 ≈ contents 段，内容签名 ≈ 内容键；本门的「签名一致配对」即其两阶段匹配的特例）。

## 4 · 双向验收实录（亲手跑，管道先重定向再 echo $?）

**① 变异反证（改名必须红）**
- 改名前门：RC=0，输出签名 = 改代码前原签名（`diff /tmp/fu-before.out /tmp/fu-final.out` 逐字节一致，金丝雀成立）。
- 施加 §1 变异 ⇒ 新门 **RC=1**，点名全部 **6 对**（`solver:bottleneck_matrix#factors[] → solver:bottleneck_matrix_v2#factors[]` 等，每条带内容签名哈希）。
- 改名态 `--tighten` ⇒ RC=0，factKeys 462 键重记（v2 键 6 条落账）——显式重记路径实证可用；随后还原源码 + 再 `--tighten`，基线回到原内容。

**② 正常演进反证（新增不误伤）**
- `RiskBoardView.tsx` 加一条真读取 `const horizonDaysProbe = data.horizonDays;` ⇒ 事实 462→463，**RC=0** 绿（增长放行，D5 无了一对）。
- 还原后 `git status --porcelain` 净（只剩本单四个文件）。

**③ 既有红签名零消零增**
- 本门：改前 RC=0 ⇒ 改后 RC=0，输出逐字节一致（见①金丝雀）。
- 关联元门 A/B（改前文件 vs 改后文件，同机同刻）：
  - `gate-ledger:check`：改前 RC=2 / 改后 RC=2，红行逐字节一致（27 条 guardedPaths 指向未构建 dist = 环境早退，与本单无关；门账内容判据「均已核过且相符」）。
  - `baseline-writer-honesty:check`：改前 RC=1 / 改后 RC=1，输出逐字节一致（红在 `check-unit-value-provenance.mjs`，非本单文件）。
  - `check-gate-exit-discipline:check`：改后 RC=0（99 门全有 RC=2 出口 + 顶层兜底，本门含在内）。
  - `check-system-ontology`：本体追加后曾 RC=1（引用了不在线内的 `scripts/lib/ratchet-conservation.mjs` 路径锚点）⇒ 已改为不含路径的表述，复跑 **RC=0**。
  - `check-ontology-s8-dedupe` / `check-ontology-writeback`：改前 RC=1 / 改后 RC=1，签名逐字节一致（既有红，非本单引入）。
  - `check-ontology-anchors` RC=0 · `check-ontology-s8-status` RC=0 · `check-ontology-descriptions` 改前 RC=2 / 改后 RC=2（datacore dist 未构建，环境早退）。

## 5 · gate-ledger 改动键清单（避让 ONTO-S8-MERGE-GUARD）

- **未新增键**。只改了既有键 `gates["check-fact-usage.mjs"]` 的 `notes`（句尾追加 2026-08-19 D5 判据语义变化登记）。
- 并线取并集时：本键 notes 为字符串追加，若对方也改同键 notes，取两边追加后的合并文本即可，无语义冲突。

## 6 · 触碰文件（范围边界内）

- `scripts/check-fact-usage.mjs` — D5 判据 + 金丝雀 + factKeys 写账 + 头注判据四条→五条
- `scripts/fact-usage-baseline.json` — 迁移形态：新增 `factKeys` 段（462 键）+ `_doc` 两行说明（`lastSeen` 顺带刷新：ast.rest 318→321 为改前实测值，旧账是过期收紧残留）
- `scripts/gate-ledger.json` — 上节所述 notes 追加
- `docs/SYSTEM-ONTOLOGY.md` — §7 该门条目句尾追加 D5 判据（铁律 0 回写）· §8 `G-FACT-USAGE-UNREGISTERED` 行末补记盲区闭合

## 7 · merge-tree 对线 tip / porcelain

- 交付时线 tip 已前移到 **716a81ad4**（开工时 914d0289b 的下游）：`git merge-tree --write-tree 716a81ad4 HEAD` ⇒ **RC=0**（净合并，无冲突）。
- push 后 `git status --porcelain` 空（净），分支 `claude/handoff-wo-fact-usage-rename-inflation` 已推远端。
