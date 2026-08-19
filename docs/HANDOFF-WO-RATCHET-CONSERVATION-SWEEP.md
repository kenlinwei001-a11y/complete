# HANDOFF · WO-RATCHET-CONSERVATION-SWEEP（棘轮守恒整类普查 · 18 残留写入方逐门复核）

- 分支：`claude/handoff-wo-ratchet-conservation-sweep`（基线 388caa6b6 = census tip）
- 范式：`scripts/check-ui-first-layer.mjs`（WO-RATCHET-NEWFILE-BLINDSPOT 已修的 D5/D6 判据形态）
- 共享实现：`scripts/lib/ratchet-conservation.mjs`（contentKey / reconcileContents 两阶段多重集对账 / buildContentsSegment / conservationCanary）——18 门共用一份，不抄录
- 断点：`docs/SYSTEM-ONTOLOGY.md` §8 `G-RATCHET-NEWFILE-BLIND`（本单 = 该行「其余 18 个基线写入方尚未逐个复核」的普查收口）

## 结论一行

18 门逐门复核完毕：**7 门**棘轮键含文件/行号（真瞎）⇒ 接入共享对账器改码；**11 门**键本为无文件维度的纯内容键且未登记内容已按名报红 ⇒ D5/D6 **内生**，不改码（加 helper 即装饰品，判据逐门见下表）。双向验收（搬家沙盘 + 新内容沙盘 + 金丝雀）逐门亲手做过并还原；既有红签名一门未消、一门未新增（一处自伤已修，见 §4）。

## 1 · 18 门逐门落点表

### 1a · 改码 7 门（接入 scripts/lib/ratchet-conservation.mjs）

| # | 门 | 提交 | 原键的病 | D5/D6 落点 |
|---|---|---|---|---|
| 1 | text-legibility | b8640e781 | 键含文件 ⇒ 搬家罚 | 内容键=选择器+字号+字重+色（文件无关）；基线加 contents 段（14 条/12 键；SandboxConsole 死账 1 条按实落注记，不消账）；未登记文件只红未匹配内容，登记文件 D6 同数调包点名 |
| 2 | dev-jargon-onscreen | e27073029 | 同上 | 内容键=形态+命中原文；松弛检测建 contents 后按内容判（搬走不算消失）；未登记文件只红未匹配命中；登记文件 D6 调包点名 |
| 3 | debattery（双探测器） | af3c19a18 | 基线平铺文件→计数 | 基线重构 {files, contents}（读兼容旧平铺）；内容键 A=行文本 / B=表名+行数+数值数；未登记文件只对未匹配条数比基线；登记文件 D6 调包点名；迁移自核 23 个登记文件现算=基线计数 |
| 4 | screen-value-provenance | 6c517bb3f | 键含文件 | 内容键=来源点代码片段哈希；未豁免文件全部来源点被 contents 认领 ⇒ 搬家守恒；D2 过期豁免判在文件消失时先分「搬走 / 真消失」 |
| 5 | ontology-anchors | 190c1a926 | 同数调包恒绿 | 未校准侧补内容键=目标文件+目标行代码文本（行号仅兜底）；调包红 [UNVERIFIED_SWAP] 点名；行号漂移内容不变 ⇒ 键不变不红（TOL 语义保留）；grown/vanished 计数判据原样（既有 5 条 UNVERIFIED_GROWTH 红签名不动）；基线迁 contents 72 键/100 条 |
| 6 | chain-scan-honesty | 289f46ec1 + 7a0d81e58 | H5 键含文件；H8 只有条数棘轮 | H5 内容键=token+原文；H8 内容键=bindingId+ruleKey+metricPath+value（调包当场点名）；旧 exemptions 账簿迁入 contentsH5（人手理由逐字节进 why，origin=manual，单一账簿）；--update 新落账键 why 置空 ⇒ 「豁免无理由」红直到人手补（与旧 reason:"" 同级纪律）；段缺失 ⇒ notEstablished 走旧逻辑逐字节 |
| 7 | coverage-blind | 2c952c4d9 | 指纹含文件 ⇒ 测试搬家假红 | 内容键=it标题+检测器+目标符号（剔文件）；搬家 ⇒ 跨文件认领基线剩余槽 ⇒ 守恒不红且打印 D5 守恒行；--update 对 contents 同守「只删不增」（不收新槽、数量只缩）；基线迁 235 键/236 槽，34 条既有红原样保留 |

### 1b · 内生 11 门（不改码；判据 = 键无文件维度 ∧ 未登记内容按名报红）

| # | 门 | 内容键（无文件维度） | D6 已内生的判据（代码点） | 金丝雀原 RC |
|---|---|---|---|---|
| 8 | cli-parity | cliCommand 字符串 | `newDead` 式差集：missingImpl 集合差即逐条点名红 | 0 |
| 9 | ontology-descriptions | `type:<K>:displayName/description`、`prop:<T>.<p>` | `regressions = current.filter(v => !baseSet.has(v))` 逐键点名红 | 0 |
| 10 | req-coverage | `REQ###` ID | `newlyUnlanded = unlanded.filter(i => !baseSet.has(i.id))` 逐 ID 点名红 | 0 |
| 11 | solver-field-seam | `S3:<solver>.<field>` / `S4:<schema>.<field>` / `S5:<solver>.<top>.<row>`（evidence 的 file:line 仅注记） | `newDead = dead.filter(d => !baseIds.has(d.id))` 逐 id 点名红 | 1（既有红 S4:CapacityForecastOutputSchema.unit，保留） |
| 12 | backend-frontend-seam | `METHOD path` / SSE 字段名 | `newEp/newSse = cur.filter(k => !base.has(k))` 逐条点名红 | 1（既有红 POST /a/v1/sim/change-impact-preview，保留） |
| 13 | agent-config-complete | `<side>:<agentKey>\|<code>` | 未豁免违规 `fail.push` 逐 id 点名红 | 0 |
| 14 | carrier-has-instances | `P##\|<CarrierType>` | 未豁免违规 `fail.push` 逐键点名红 | 0 |
| 15 | lever-landing-exists | `Type.prop` | 未豁免违规逐键点名红（L1）；豁免过期另有 L2 反向红 | 1（既有红 L2 MaterialBalance.coverage 豁免已过期，保留） |
| 16 | baseline-writer-honesty | 门脚本文件名 | 扫描面 = `scripts/*.mjs` 全量 ⇒ 新文件写入方自动入判；未豁免即红点名。**文件名即本门主体身份**（被检测物就是脚本自身），改名=换身份 ⇒ 旧豁免过期红 + 新未豁免红是正确语义，不是 D5 缺口。射程边界（门自曝）：只认 `*-baseline.json` 写入目标 + 自更新旗标（`--update`/`--seed` 字面量）——无旗标的 json 写入不是棘轮基线写入方，不在本门判据内 | 1（既有红 check-unit-value-provenance，保留） |
| 17 | gate-exit-discipline | 门脚本文件名 | 扫描面 = `scripts/check-*.mjs` 全量 ⇒ 新门自动入判；未豁免即红点名。身份语义同 #16 | 0 |
| 18 | mock-fidelity | `ROUTE <m> <path>` / `LINK <key>.<field>` / `WIDGET <key>.<field>`（file:line 仅 where/detail 注记） | `fresh = current.filter(v => !(v.id in exempt))` 逐 id 点名红 | 0 |

内生 11 门的 D5 结构性论证（共同）：键不含文件/行号 ⇒ 内容在文件间/文件内任意搬迁都不改键 ⇒ 基线集合与当前集合的差集不变 ⇒ 门不变绿也不变红。守恒不需要额外机制，因为它已塌缩成恒等式。下面 §2 的搬家沙盘是这一论证的实证（每门亲手做一遍，不是纯推理）。

## 2 · 双向验收实录（每门：搬家沙盘 ① / 新内容沙盘 ② / 还原 ③；证据文件均在 /tmp/ratchet-sweep/，本机会话期有效）

| 门 | ① 搬家（期望：门不变） | ② 新内容（期望：RC=1 点名） | ③ 还原 |
|---|---|---|---|
| text-legibility | 搬家守恒不红（见 b8640e781 提交体） | 新文件堆内容 RC=1 点名 | 签名逐字节一致（text-legibility.restored.out） |
| dev-jargon-onscreen | VITE_MOCK 搬家 QueryDock→新文件 RC=0 守恒；旧门反证：松弛红 RC=1 | 新文件堆 strictObject RC=1 D6 点名 | 逐字节一致 |
| debattery | routes 表搬家 App.tsx→新文件守恒不红（修复前同态红，互证） | 新文件堆 evilTable RC=1 点名 | 逐字节一致 |
| screen-value-provenance | 人工落账后搬家 A→B RC=0 守恒（旧门反证：D1 红 B + D2 红 A） | 新文件污染源 D1 红 RC=1 点名 | 逐字节一致 |
| ontology-anchors | 锚点在文档内换行 ⇒ 输出逐字节不变 | 调包（ontology-core.ts:534→:300 同文件同计数）新门 RC=1 1×[UNVERIFIED_SWAP] 点名本体 L78；旧门同样输入零 swap 红（反证旧版瞎） | 逐字节一致 |
| chain-scan-honesty | 语义行 chain-impediment.ts→process-capacity.ts：新门 RC=0 逐字节（模 dist 时间戳行）；旧门同输入 RC=1 两条「新增」（反证旧版罚搬家） | 新语义行 RC=1 [H5] D6 点名；H8 调包 C22 120→130 RC=1 [H8] 点名 battery.ts；旧门 RC=0（反证旧版瞎） | 逐字节一致 |
| coverage-blind | it 块 arg-drop-seam.test.ts→agent-budget.test.ts：新门 RC=1 红集逐字节不变（34 条）+「D5 守恒：2 条」；旧门同输入 36 条红（反证） | 新盲用例 ⇒ 35 条红点名 | RESTORED_IDENTICAL |
| cli-parity | catalog 条目重排 RC=0 逐字节 | doRouted 中和（cmdDo→cmDDoo、operations/classify→operationsXclassify）RC=1，24 条回归逐条点名 | 逐字节一致 |
| ontology-descriptions | batteryObjectTypes 内 Base/Model 两类型定义换位 + 重建 datacore ⇒ RC=0 逐字节（模 dist 新鲜度行） | 删 Equipment.mtbf 的 description + 重建 ⇒ RC=1 点名 `prop:Equipment.mtbf` | RESTORED_IDENTICAL |
| req-coverage | REQ006 唯一引用从 PRD-UPGRADE 搬到 REQUIREMENTS-TRACE ⇒ RC=0 逐字节 | 删 REQ006 唯一引用 ⇒ RC=1 点名 REQ006（新增 1 条未落点） | RESTORED_IDENTICAL |
| solver-field-seam | CapacityForecastOutputSchema 内 capWanP90/unit 两字段换位 ⇒ RC=1 与既有签名逐字节一致（红不多不少） | SOLVER_OUTPUT_SHAPES 加 zzConservationProbe ⇒ RC=1 点名 `S3:capacity_rollup.zzConservationProbe`（新增 2 = 幻影 1 + 既有 1） | RESTORED_IDENTICAL（既有红签名原样） |
| backend-frontend-seam | change-impact-preview 路由块在 app.ts 内搬家（L2283→L2317）⇒ RC=1，红仍恰好 1 条同键，仅 evidence 行号跟踪搬家 | 注册幻影路由 `/a/v1/sim/zz-conservation-probe` ⇒ RC=1 点名该路由（2 条新增 = 幻影 1 + 既有 1） | RESTORED_IDENTICAL |
| agent-config-complete | AGENT_SEEDS 内 report-agent 条目换位 + 重建 ⇒ RC=0，排序后逐字节一致（仅 dist 新鲜度行差；本门输出行序随种子序，集相等） | 加幻影 agent zz-conservation-probe ⇒ RC=1 点名 C1_NO_TOOLS/C2_NO_SCOPE_FIELD/C4_ORPHAN_KEY 三条 | RESTORED_IDENTICAL |
| carrier-has-instances | DEMO_PROCESS_DEFINITIONS 内 P01/P02 换位 ⇒ RC=0（仅新鲜度行差） | 加幻影 P99 carrierTypeKey=ZzConservationProbe ⇒ RC=1 点名 `P99 → ZzConservationProbe（NOT_MATERIALIZED）` B1 没接线 | RESTORED_IDENTICAL |
| lever-landing-exists | LEVER_PROP_META 内 Equipment.oee_current/Line.utilization 换位 + 重建 ⇒ RC=1 与既有签名逐字节一致 | 加幻影 `MaterialBalance.zzConservationProbe` ⇒ RC=1 点名 L1 PROP_MISSING（2 条 = 幻影 L1 + 既有 L2） | RESTORED_IDENTICAL（证据链见 §3） |
| baseline-writer-honesty | check-debattery.mjs 两写入点换位 ⇒ RC=1 与既有签名逐字节一致 | 幻影手搓写入方 check-zz-conservation-probe.mjs（含 --update 旗标）⇒ RC=1 点名 HAND_ROLLED（2 条 = 幻影 + 既有 unit-value） | RESTORED_IDENTICAL |
| gate-exit-discipline | check-req-coverage.mjs 兜底块搬位（process.on 挪到 gateToolBroken 定义后，hoisting 保持有效）⇒ RC=0 逐字节，且 req-coverage 自身复跑 RC=0 | 幻影无兜底门 check-zz-conservation-probe.mjs ⇒ RC=1 点名（无 RC=2 出口 + 无顶层兜底两条） | RESTORED_IDENTICAL |
| mock-fidelity | handlers.ts 内 opt/templates 处理器搬位 ⇒ RC=0 逐字节 | 幻影路由 `*/a/v1/zz-conservation-probe` ⇒ RC=1 点名 `ROUTE GET /a/v1/zz-conservation-probe` | RESTORED_IDENTICAL |

**旧门反证**（改码 7 门）：每次搬家/调包沙盘都用 `git show "HEAD:scripts/check-<gate>.mjs"` 取出旧门在原地跑同一输入，证明旧版罚搬家/对调包瞎（逐门反证记录在上表与提交体）。

## 3 · lever-landing-exists 还原证据链（协调方独立复核过）

幻影条目沙盘后还原链：`cp /tmp/ratchet-sweep/lever-meta.ts.bak apps/datacore/src/solvers/lever-meta.ts` → `pnpm --filter datacore build`（BUILD_RC=0）→ `node scripts/check-lever-landing-exists.mjs` RC=1 且输出与金丝雀逐字节一致（模 dist 新鲜度行）→ `git diff apps/datacore/src/solvers/lever-meta.ts` 为空 → dist 内 zzConservationProbe 零命中（协调方独立核实：tip 2c952c4d9 时 porcelain 净）。

## 4 · 自伤与修复（如实记账）

289f46ec1（chain-scan-honesty 6/18）把共享写入器抽成 `const doc = buildBaselineDoc(...)` 再 `writeFileSync(BASELINE, JSON.stringify(doc))`（为了让 `delete doc.exemptions` 落在写前）——被 baseline-writer-honesty:check 判 HAND_ROLLED：该门判据②认「**写入点实参里**调了 buildBaselineDoc」，抽成变量即不在实参里（其头注自己点名过这种形态）。这构成**本单新增的一条红**，违反「既有红不许新增」。修复（7a0d81e58）：prev 侧先摘 exemptions（buildBaselineDoc 会 `...prev` 全摊开，产出 doc 上 delete 已晚），buildBaselineDoc 内联回 writeFileSync 实参。修后：baseline-writer-honesty 红签名 2→1（回到 census 既有 unit-value 一条）；chain-scan-honesty RC=0 不变；`--update` 真跑一遍，写出的基线与迁移后基线逐字节一致（UPDATE_OUTPUT_IDENTICAL）。

## 5 · 金丝雀证据

- 每门改动前先跑原门记原 RC（输出存 /tmp/ratchet-sweep/<gate>.out）：census 给出的既有红签名逐门复核 —— 改码 7 门迁移后 postmig diff IDENTICAL（红签名逐字节不变，不少一条不多一条）；内生 11 门 RC 见 §1b 末列。
- Census 立的 11 门 MIN_ 扫描面下界与本单无冲突：D5/D6 对账段判在门主判据路径上、不碰 MIN_ 早退（下界先判、RC=2 语义未动；chain-scan 沙盘期曾因 contracts dist 过期吃 RC=2，重建后恢复——下界确实在下界位置拦截）。
- dist 新鲜度守卫：凡 contracts/datacore src 被沙盘碰过的，还原后或 rebuild 或 `touch -r` 对齐 mtime，门禁前后跑通为准。

## 6 · 旧分支救用

`claude/handoff-wo-ratchet-newfile-blindspot` @ 2ac30f641：按内容不按哈希查证（cherry-pick 改哈希、merge-base 恒 false）——基线 388caa6b6（census tip）已含其演进形态，旧分支更老，**无可救用内容**。

## 7 · 本体回写

`docs/SYSTEM-ONTOLOGY.md` §8 `G-RATCHET-NEWFILE-BLIND` 行末追加单句（普查收口 + 指向本文档），行内其余文字未动。

## 8 · porcelain 净证明

终态 `git status --porcelain` 为空（全部沙盘还原，RESTORED_IDENTICAL 逐门验过）；分支全部提交见 `git log 388caa6b6..HEAD`：

```
7a0d81e58 fix(chain-scan-honesty): buildBaselineDoc 内联回 writeFileSync 实参
2c952c4d9 coverage-blind 接入 D5/D6（7/18）
289f46ec1 chain-scan-honesty 接入 D5/D6（6/18）
190c1a926 ontology-anchors 接入 D5/D6（5/18）
6c517bb3f screen-value-provenance 接入 D5/D6（4/18）
af3c19a18 debattery 双探测器接入 D5/D6（3/18）
e27073029 dev-jargon 接入 D5/D6（2/18）
b8640e781 共享 D5/D6 对账器 + text-legibility 接入（1/18）
```

（HANDOFF 文档与本体回写在其后的文档提交。）
