# HANDOFF — WO-ONTO-S8-MERGE-GUARD（§8 状态只许前进门 + 存量收口）

- 分支：`claude/handoff-wo-onto-s8-merge-guard`
- 基线：集成线 `claude/verify-reclaim-6` 派单时 tip `914d0289b`（SSH 一次性 URL fetch 实测）
- 交付 tip：**远端 `claude/handoff-wo-onto-s8-merge-guard` 的 HEAD**（2 个提交：①② 收口 `9c1c0d267` + 本 HANDOFF；porcelain 净。HANDOFF 自记哈希会随 amend 漂移，以远端分支为准）
- 日期：2026-08-19 · dev worktree `agent-af833dc44683a3ae1`

---

## ① 新门「§8 状态只许前进」—— 已在基线上，本单复核验证（未重复建设）

**关键事实**：派单定性「这道门不存在」已过期。基线 `914d0289b` 的祖先链上已有提交
`3db1d3c70`（2026-08-19 12:03，同名 WO 的前一线产出）把判据二并入了
`scripts/check-ontology-s8-status.mjs`，且 §7 门清单条目、`scripts/gate-ledger.json` 条目、
§8 `G-STEP-VOCAB-SPLIT-TWO-HOMES` 行回滚实录、豁免册 `scripts/ontology-s8-status-exemptions.json`
全部在位。本单对它做了**复核验证**而非重建：

### 判据（现基线门实际实现）
- 区间 `merge-base(HEAD, 集成线)..HEAD` 逐提交审（合并按第一父）：任一编号在父提交有任一行带 ✅，
  而本提交该编号的行一个 ✅ 都不剩、且带着 🔴/◑ ⇒ RC=1。判据落行内容 diff，不落提交信息。
- 整行消失不归本判据（诚实边界②，门头注明写）；叙述性提及标记字符的理论漏报通道门头注明写。
- 唯一放行路：`scripts/ontology-s8-status-exemptions.json` 同 (commit, 编号) ≥20 字理由
  （豁免册现有一条：`e6a19e3f6` / `G-STEP-VOCAB-SPLIT-TWO-HOMES`，真回退非有意打回的历史事实登记）。
- 已接进 `pnpm gates`（`check-ontology-s8-status.mjs` 在链上，随 WO-ONTO-STATUS-BACKFILL 注册）。

### 金丝雀双向实录（本单真跑）
```
$ node scripts/check-ontology-s8-status.mjs --selftest
✓ 金丝雀全中（判据一 3 条 · 判据二 7 条含真史双向，均与主逻辑共用同一份实现）。
SELFTEST_RC=0
```
判据二 7 条全部走同一份 `judgeRegressions()`/`scanCommitGuard()`（非抄录）：
合成 ✅→🔴 必咬 · 删除线作废必咬 · ✅→✅ 不咬 · 🔴→✅ 不咬 · dedupe 删行不咬 ·
**真史必咬：合并 `3ddd98dff` 咬在 `G-STEP-VOCAB-SPLIT-TWO-HOMES`** ·
**真史必不咬：回写提交 `a81062e29` 不咬该编号**。

### 验收落在门上（正常本体增改必须绿）——本单 ② 的收口提交即此实证
```
$ node scripts/check-ontology-s8-status.mjs   # ② 收口提交后
✓ 判据一（行必带标记）通过 —— §8 编号行 184 条全部带状态标记。
✓ 判据二（状态只许前进）通过 —— 区间提交 6 个 · 触碰本体 2 个 · 状态回退 0（豁免 0）。
STATUS_RC=0
```
本单的收口提交一次性删 26 行（含多行带 🔴/◑/✅ 的旧副本）、改 1 行，判据二扫过该提交判绿——
正是金丝雀⑨「dedupe 合法删行不咬」在主路径上的真实行使。

### 本单对 ① 的增量改动
无（门脚本、豁免册、§7 条目、gate-ledger 条目均已在位且实测有效，未画蛇添足）。

---

## ② 存量收口：dedupe 门 RC=1→0（s8-status 门在基线已是 0）

### 现算数字 vs triage-2 原数（必须以现算为准）
| 口径 | triage-2（08-18 存量） | 本单基线现算（914d0289b） | 差异说明 |
|---|---|---|---|
| §8 重复编号组 | 12 组 | **11 组**（编号行 210 · 唯一编号 184） | WO-ONTO-DEDUPE 收的 13 组之后，后续收编 merge 又带回了新旧混合的 11 组（含 4 行带 2026-08-19 去重注记却只并内容没删行的残留）；anchor-recal2 等并入也改过 §8。两个数度量的都是「当时 §8」，文档持续演进，不可直接对拍。 |
| 无状态标记行 | 2 行 | **0 行**（判据一绿：184 条全带标记） | 已被 WO-ONTO-STATUS-BACKFILL（823216bdd）逐条补标，门守「不许再长回来」。 |
| 已闭未回写 | 4 行 | 门口径下等价物 = 判据一/二均绿 | triage-2 该口径定义在其工单内、无对应门；本单以两道门的实际红绿为准收口，不另造口径。 |

### 基线上的门实际红（收口对象，逐条如下）
```
✗ §8 有 11 个编号各占多行（编号行 210 · 唯一编号 184）：DEDUPE_RC=1
```

### 逐组 before/after（口径：同一笔账 → 留信息最全款、独有内容并入、不丢字）
| 编号 | before（行号@914d0289b） | 组内版本关系（机检） | 处置 | after |
|---|---|---|---|---|
| G-PRD-DATA-UNGROUNDED | 2124/2125/2127/2133 | L2125 是其余三行的严格前缀超集（共前缀 100%），另多 08-19 burn-down 清零段 | 留 L2125 删 3 | 单行，含棘轮清零更新 |
| G-BE-FE-SEAM-DEAD | 2126/2129/2132/2135/2139/2143 | 两族六行；逐字 diff 枚举证明两族**仅差 3 处行号锚点**；现核 app.ts：4500=actions.approve · 4394=actions.submit · 5119=processRuntime.create，与 L2135 族一致（另一族 4345/4244/4778 已漂移） | 留 L2135 删 5 | 单行，锚点与现行代码一致 |
| G-BE-FE-FIELD-DEAD | 2128/2134/2141/2144 | 四行逐字节相同（sha 一致） | 留 1 删 3 | 单行 |
| G-MOCK-OVERCLAIM | 2130/2137/2138/2142/2145 | L2130 为超集且自带 08-17 去重注记（旧行仅状态格更旧 + 一处锚点漂移，已被吸收）；句级覆盖机检：被删行未覆盖段仅为被超越的旧状态格 | 留 L2130 删 4 | 单行 |
| G-SEAM-GATE-METHOD-BLIND | 2131/2136/2140 | L2131==L2140；L2136 独有物仅为已被 08-18 修复超越的旧状态格（pathMatches 旧实现描述+工单指针），问题实质已在共前缀「(乙) 通配段冒领」段 | 留 L2131 删 2 | 单行 |
| G-CELL-PACK-2STAGE | 2190/2211 | L2190 是 WO-ONTO-DEDUPE 的合并行，行内已逐字并录数据半旧行（7 项独有串机检全含）；L2211 是 merge 带回的残留旧行 | 留 L2190 删 1 | 单行 |
| G-CAPACITY-DEAD-BI | 2210/2212/2213 | L2213 是 L2212 的 100% 前缀；L2210 与 L2212 逐字 diff 仅差锚点形态（`ProjectSimView.tsx:862` vs 全路径 `:991 (DynamicLeverPanel)`） | 留 L2212 删 2 | 单行，含 08-18 复核段 |
| G-ADOPT-SCHEME-NO-CARRIER | 2234/2235/2237 | L2234 与 L2237 逐字 diff 仅差锚点粒度（短路径 vs 全路径 `(pathKey)`）；L2235 为最老「接线前」行，其独有实质（**已可观察**：错误信息带四条论据 · 接缝测试 `action-plan-change-levers.seam.test.ts` 咬住「诚实失败+基线未动」）保留行原来没有 | 留 L2237，**把 L2235 独有实质逐字并录进其状态格的去重注记**（注记规避队列抽取序列，不把已闭行误判进待写WO），删 2 | 单行 |
| G-ACTION-NOOP-EXEC | 2236/2240 | L2240 自带 2026-08-19 去重注记（08-16 逐型实测段已逐字并入）；L2236 未覆盖段机检 = 旧状态格 + 与 L2240 开头 ✅ 段同源的 08-18 收口段 | 留 L2240 删 1 | 单行 |
| G-GATE-ROSTER-HANDCOPIED | 2331/2339 | L2331 自带 08-19 去重注记（SWEEP-2 段逐字并入·最老行证伪结论即其 08-17 补记）；L2339 未覆盖段机检 = 加了「历史态」/日期订正的同文段 | 留 L2331 删 1 | 单行 |
| G-MOCK-PARAM-ARITY-SILENT-DROP | 2337/2338/2340 | 三行逐字 diff 仅差锚点粒度；现核 executor.ts:246=dispatch 声明 · :378=taskSnapshotEpoch 实传点 · server.ts:2293=solver.invoke 调用 · :118=buildServer，L2338 锚点最准 | 留 L2338 删 2；**并把锚点基线注册而仅存于被删行的 `server.ts:118 (buildServer)`、`executor.ts:246 (dispatch)` 两枚回补进保留行链路格**（见「连带事故」） | 单行 |

删行合计 26 · 改行 1（ADOPT-SCHEME 注记）· 锚点回补 1 处。收口后：**编号行 184 == 唯一编号 184**。

### 连带事故与修复（如实记账）
1. **首次删除脚本把删除序列写成局部降序**（2124–2145 簇 17 行删完后，后续 9 行仍按旧行号删），
   删错 9 行。安全网生效：删前 ID 断言是在删除前统一校验的、 splice 按数组序执行——
   重跑门当场 RC=1 报 6 组仍在。处置：`git checkout` 还原整文件重删（严格全局降序 + 降序断言 +
   逐行 ID 二次校验）。教训落 HANDOFF：按行号批量删行必须全局降序。
2. **删 G-MOCK-PARAM 旧行砸红 `check-ontology-anchors`**（ANCHOR_DELETED × 2）：
   锚点基线注册的 `server.ts::buildServer` / `executor.ts::dispatch` 两枚已校准锚点只存在于被删行。
   修复：把两枚锚点以现行语义（信号源 / 分发点）回补进保留行链路格，门回绿。
   这正是不丢字口径的机器兜底——锚点也是内容。

### 门 RC 证据（收口后，全部真跑 · 管道先重定向再 echo $?）
```
node scripts/check-ontology-s8-dedupe.mjs   → RC=0（184==184，金丝雀 3/3 在位）
node scripts/check-ontology-s8-status.mjs   → RC=0（判据一+二均干净，判据二扫到本单提交仍绿）
node scripts/check-ontology-s8-status.mjs --selftest → RC=0（金丝雀 10 条全中）
node scripts/check-system-ontology.mjs      → RC=0
node scripts/check-ontology-anchors.mjs     → RC=0（回补后；基线对照 RC=0）
node scripts/check-merge-conflict-markers.mjs → RC=0
```
### 基线既有红（非本单制造，worktree 隔离对照实测）
```
node scripts/check-wo-anchors.mjs   → 基线 RC=1 · 本单后 RC=1（7/13 份历史工单锚点漂移/
  过期豁免，如 WO-FIELD-DEAD-6.md 的 STALE_EXEMPT；本单零触碰 docs/WO-*.md 与其引用文件）
node scripts/check-gate-ledger.mjs  → RC=2（门自述「自己没准备好」：27 条 guardedPaths 指向
  未构建的 datacore/agentcore dist——本单按纪律只 build 了 contracts；RC=2 不读作红也不读作绿）
```

### merge-tree 对线 tip
```
fetch 线 tip：716a81ad4（较派单时 914d0289b 已前进）
git merge-tree --write-tree HEAD 716a81ad4 → MERGETREE_RC=0（干净可并）
```

---

## gate-ledger.json：本单加了哪些键
**零个**。判据二的 `check-ontology-s8-status.mjs` 条目（含 08-19 变异实跑记录）已由 `3db1d3c70` 登记；
本单无新门、无门改动，无需加键。并线时若 fact-usage 后续单加了键，取并集即可，本单不动该文件。

## 避让行零触碰证明
```
git diff 914d0289b..HEAD -- docs/SYSTEM-ONTOLOGY.md | grep -c "G-GATE-SCOPE-MISSES-SUBJECT" → 0
该行在文件中仍在（1 处），本单 diff 零命中。census 分支（388caa6b6）并线时不会因本单叠加冲突。
```

## porcelain 净证明
```
git status --porcelain | wc -l → 0（push 前实测，分支已推远端）
```

## 已知残余（如实写明，不归本单）
- §8 个别已闭行的历史订正段内含字面「🔴 未修 → ◑ 部分闭合」序列（如 G-ACTION-NOOP-EXEC 保留行
  的 08-16 订正文），会被 `dispatch-deficit.sh` 的待写WO 抽取数进行数——属历史行文，
  改写历史段风险大于收益，留待 STATUS-BACKFILL 口径的专人定夺；本单追加的去重注记已刻意规避该序列。
- §7 的 `ontology-s8-dedupe` 门条目仍是 08-17 叙事（其所述事实当时为真）；「13 组收了又长的
  11 组再收」这段 08-19 历史记在本 HANDOFF 与提交信息里（范围边界限定本单只动 §8）。
