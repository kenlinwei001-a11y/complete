# HANDOFF · WO-PRD-GROUNDING-BURNDOWN（棘轮 7 条豁免逐条 burn-down）

- **分支**：`claude/handoff-wo-prd-grounding-burndown`
- **基线**：`claude/verify-reclaim-6` 实测 tip `7c52b9b4280f9ccfd60e3abfb2bd70bc9b2a1c05`（fetch 实测，非 WO 写的 d89b81393——d89b81393 之上又收编了 WO-FACT-USAGE-REGISTRY）
- **门**：`node scripts/check-prd-data-grounding.mjs`（判据逻辑一字未动）
- **结果**：**7/7 全收 + 新增 1 条顺手收掉，基线清零（exemptions 7→0 · adjudicated 5→0 · maxExemptions 7→0 · ratchetHigh 7→0 只降不升锁死），门 RC=0**

## 开工金丝雀（与 WO 预期的一处偏差，已坐实非我引入）

WO 预期「开工门 RC=0 + 7 条清单」。实测 tip 上门 **RC=1**：除基线 7 条豁免外有 **1 条未豁免的新增违规** `PRD-capacity-inference-completion.md:56` `DemandSegment.p50`（PDG-4 断言语境）。已核 `d89b81393..7c52b9b` 的 diff 不碰门脚本 / 基线 / 真值源（`apps/datacore/src/synthetic/*`）/ 该 PRD ⇒ **该 RC=1 在两个 tip 上逐字一致地存在**，是 WO 立单时的实况，不是收编带进来的回归，也不是我改出来的。该条属本单 5 份 PRD 射程内，按命名漂移顺手收掉（见 item 8）。

## 逐条处置 + 三段证据

三段证据口径：①旧文案在门下会红（豁免/裁定是承重墙）；②新文案下门绿（改文后门报「棘轮回弹」指名该 key = 旧豁免锚的是旧文案，新文案本身不被咬）；③新判据引用的关系真实存在（追到调用点 file:line）。

### item 1 · `PRD-sandbox-redesign.md#VAR:06caab0f7841171e`（PDG-6 · A6 判据）——收

- 判据「改 `SEG_REGISTRY` 一个值 → 结论真跟着变」补上缺失的前置半：跨 seg 争用真实发生（locus 的 segClaims 由订单 `Order.businessType` 聚合，规则 C34 要求 ≥2 条业务线争同一基地），「保谁」经 `resolveContentionKeep` 真读 `SEG_REGISTRY.marginPct/floorPct`；前置不成立时该函数返回 null/unknownReason，本判据不适用。
- ① 开工 `--list`：该 key 以 PDG-6 直接红挂账（豁免承重）。② 改文后门报「棘轮回弹：PRD-sandbox-redesign.md#VAR:06caab0f7841171e」，删豁免后绿。③ 关系真实存在：`packages/contracts/src/chain-sim.ts:400`（`resolveContentionKeep`「保谁」唯一实现，经 `segOfBusinessType` 桥读册）· 调用点 `apps/datacore/src/solvers/chain-impediment.ts:949`（A6 段注释在册）· segClaims 生产侧 `chain-impediment.ts:335` + 接线 `impediment-options.ts:505` · C34 规则 `battery.ts:413`（`COUNT(Base.segClaims.dailyRate) > 1`）。原豁免 why 里「Line 无任何 seg 归属字段」仍属实，但归属关系今天不走 `Line`——它物化成了 Base locus 上的 segClaims（订单 businessType 聚合），判据的决定半已经真接线。

### item 2 · `PRD-simulation-sandbox.md#VAR:20207e562d88b168`（PDG-6 · PropagationRule 判据）——收

- 判据「编辑某 `PropagationRule` 系数 0.85→0.6 发布→传导结果随之变」补前置：被编辑的规则实例真实存在且真被引擎读取——`propagateTick` 系数一律经 `effectiveCoefficient` 取自规则字段（coefficientRef 优先、内联 coefficient 兜底），demo 租户实例经 SEED_DEMO 播种；前置不成立时本判据无法失败，验收先验前置。
- ① 开工 `--list`：PDG-6 直接红挂账。② 改文后棘轮回弹指名该 key，删豁免后绿。③ `apps/datacore/src/sim/propagation.ts:319`（`effectiveCoefficient(rule, ruleParams)` 真读规则系数）· `:445`（`rules: PropagationRule[]` 引擎入参）· `apps/datacore/src/seed.ts:188-228`（SEED_DEMO 播 PropagationRule 种子、`putPropagationRule` 幂等覆盖、migration026 独立 sim 表）。

### item 3 · `PRD-capacity-live-cockpit.md#REF:Base.weeklyCap`（PDG-4A）——收

- `targetType/targetProp` 传产能目标的示例从 `Base.weeklyCap` 改为 `Base.formationCapDaily`/`Base.agingCapDaily`。
- ① 裁定表承重（PDG-5→PDG-4A 升红）。② 改文后棘轮回弹 + 裁定表烂账双指名，删豁免+裁定后绿。③ `Base` 22 属性无 `weeklyCap`；`formationCapDaily`/`agingCapDaily` 是 `apps/datacore/src/solvers/capacity.ts:159-160` 共享产能**真读**的基地日产能属性（`num(b.props.formationCapDaily, …)` / `num(b.props.agingCapDaily, …)`）。

### item 4 · `PRD-capacity-live-cockpit.md#REF:Material.coverage`（PDG-4A）——收

- SEAM-GATE 判据「改一个 `Process×Model` 的 `Material.coverage`/`Process.yield_baseline` → …」中的 `Material.coverage` 改为 `MaterialBalance.coverage`。
- ① 裁定表承重。② 棘轮回弹+裁定烂账双指名，删后绿。③ 裁定时（WO-PRD-FIELD-AUDIT）`MaterialBalance` 只有 7 属性、无 `coverage`——**此后 WO-V4-INSPECT 已把 `coverage` 作为派生属性补建**：`apps/datacore/src/synthetic/battery.ts:1217-1218`（`materialBalanceDerived`，公式 `(netDemandTon - gapTon) / netDemandTon`），`LEVER_PROP_META["MaterialBalance.coverage"]` 已登记（`lever-meta.ts:26`），基线 why 里「类型名可能也写错了」的猜测坐实——真名真型是 `MaterialBalance.coverage`。`Process.yield_baseline` 本就在（Process 17 属性之一），未动。

### item 5 · `PRD-capacity-inference-completion.md#REF:Metric.gap`（PDG-4A）——收

- 链路定义 `Metric.gap → 结构反向分摊…` 改真名 `Metric.delta`，并注「`Metric` 无 `gap` 属性——缺口真名是 `delta`（=actual−target），相对口径为派生 `gapPct`」。
- ① 裁定表承重。② 双指名，删后绿。③ `Metric` 16 属性含派生 `delta`/`gapPct`、无 `gap`；`apps/datacore/src/solvers/service.ts:4098` 注释坐实缺口口径即 `delta=actual−target`。

### item 6 · `PRD-lever-binding-drift.md#REF:ChangeoverMatrix.changeoverMin`（PDG-4A）——收

- §6 遗留表 ⑤ 换型损失行的落点名改真名 `ChangeoverMatrix.minutes`，并把根因诊断订正到当前事实：① 真名 `minutes`（旧写法 `changeoverMin` 在对象上不存在）；② WO-ENGINE-2 已补 `patchCapacityContext` 的 `ChangeoverMatrix` 分支（原文「`capacity.ts` 全文不出现 `ChangeoverMatrix`」「switch 只认 Process/Equipment/Line/Material」**均已过期**）；③ 残死因为 `computeByProcessModel` 的 cellsPerDayP50 公式不含换型项 ⇒ ∂/∂minutes 恒 0。§7 建议 §8 措辞引用块里的同名人（行 246）一并订正，免两处自相矛盾。
- ① 裁定表承重。② 双指名，删后绿。③ 真名证据：`battery-extended.ts:213`（ChangeoverMatrix 六属性 pairId/fromModel/toModel/**minutes**/hours/lineId）· `lever-meta.ts:29`（已登记 `ChangeoverMatrix.minutes` 并注明旧名不存在）· `capacity.ts` `patchCapacityContext` 的 `case "ChangeoverMatrix"` 与注释（WO-ENGINE-2 件一，「本文件全文 0 次 changeover」「∂cellsPerDayP50/∂minutes 仍恒 0」）。

### item 7 · `PRD-sandbox-redesign.md#REF:Order.changeoverMin`（PDG-4A）——收

- 「基线为何是 4 不是 3」段落里「**C22** `Order.changeoverMin`=120」的取值断言，按 `PRD-sandbox-a2.md` 的诚实口径改写：补「`Order.changeoverMin` **无对象承载**——它不是 `Order` 的对象属性，运行期由 changeover_sequence 求解器算出逐单换型分钟，该绑定因此恒 UNKNOWN」（缺失自认，正是本门要的行为，不是绕过）。
- ① 裁定表承重。② 双指名，删后绿。③ 关系现状证据：`chain-impediment.ts:151-157` 注释（「`Order.changeoverMin` **不是 Order 的对象属性**（由 changeover_sequence 求解器算出），故本判据今天恒 UNKNOWN」）· `service.ts:5840-5844`（C22 另一路径由求解器 sequence 取最大单步换型）· `PRD-sandbox-a2.md:50`（UNRESOLVED 记账，且该句是门的必不咬金丝雀样例）。两份 PRD 的自相矛盾以 a2 为准消解。

### item 8（新增·不在基线）· `PRD-capacity-inference-completion.md:56` `DemandSegment.p50`（PDG-4）——收

- 命名漂移（quantile 改名同族）：真名 `demandWanPerYearP50`/`demandWanPerYearP90`。3 处全改：行 56 数据就绪断言（反引号，门咬的这条）+ 行 57 前瞻段 + 行 68 验收判据 F1「改 Order.due/DemandSegment.p50 → 前瞻真变」（裸写但同一段落族，一并改免漂移回流）。
- 证据：门报红原文指名（DemandSegment 现有属性清单逐字列出 `demandWanPerYearP50`）；改后该违规消失，门 RC 1→0。

## 变异反证（必做·通过）

把 item 8 改完引用的真关系名改错一个字符：`DemandSegment.demandWanPerYearP50` → `DemandSegment.demndWanPerYearP50`（删一个 `a`）。
门当场 **RC=1** 红并指名：

```
❌ 新增 PRD 数据承载违规 1 条：
   docs/PRD-capacity-inference-completion.md:56  [PDG-4]
      正文**断言**`DemandSegment.demndWanPerYearP50` 已有，但真值源里该字段不存在（DemandSegment 现有属性：segId/segment/tgt/demandWanPerYearP50/demandWanPerYearP90/…）
```

随后 `git checkout --` 还原，门复绿 RC=0。证明新判据咬的是「引用属不属实」，非重言。

## 门 RC 轨迹

| 时点 | RC | 违规/豁免 |
|---|---|---|
| 开工（tip 7c52b9b 实测） | 1 | 8 违规（7 豁免 + 1 新增 `DemandSegment.p50`）/ 上限 7 |
| item 1 收后 | 1 | 7（6+1 新增）/ 6 |
| item 2 收后 | 1 | 6（5+1）/ 5 |
| item 3 收后 | 1 | 5（4+1）/ 4 |
| item 4 收后 | 1 | 4（3+1）/ 3 |
| item 5 收后 | 1 | 3（2+1）/ 2 |
| item 8 收后 | **0** | 2 / 2 |
| item 6 收后 | 0 | 1 / 1 |
| item 7 收后（基线清零·ratchetHigh 7→0） | **0** | **0 / 0** |
| 变异注入 | 1（指名变异字段） | — |
| 变异还原（收尾） | **0** | 0 / 0 · 未判定 36 条不变 |

## 基线 diff 摘要（`scripts/prd-data-grounding-baseline.json`）

- `exemptions`：7 → 0（逐条删除，无一条靠改文案「自动失效」——每条都先由门报「棘轮回弹」指名、确认新文案不被咬后才删）；
- `adjudicated`：5 → 0（裁定表随豁免同步清，门报「裁定表烂账」指名后删）；
- `maxExemptions`：7 → 0（恒等于豁免数）；
- `ratchetHigh`：7 → 0（**只降不升**——清零后水位锁 0，任何未来豁免即「棘轮回升」红；评审请注意这是本单刻意的一行）；
- `note`/`$schema` 一字未动。

## 范围自查

只碰：5 份 PRD 的判据/断点行文段落（`PRD-sandbox-redesign` · `PRD-simulation-sandbox` · `PRD-capacity-live-cockpit` · `PRD-capacity-inference-completion` · `PRD-lever-binding-drift`）+ `scripts/prd-data-grounding-baseline.json` + 本文件 + `docs/SYSTEM-ONTOLOGY.md` §8 `G-PRD-DATA-UNGROUNDED` 行句尾最小追加一句（7/7 全收，工单允许）。门脚本 `check-prd-data-grounding.mjs` 一字未动；`gate-ledger.json` 零触碰；无 build/vitest（轻画像）。

**顺带发现（不属本单范围，未动，登记）**：`docs/SYSTEM-ONTOLOGY.md` 在 tip `7c52b9b` 上存在**两行近乎逐字重复的 `G-PRD-DATA-UNGROUNDED`**（约行 2124/2126，2124 多一段「◑ 部分闭合（2026-08-18 复核…）」后缀）——merge 或重锚残留的重复行，本单只在 2124 句尾追加，重复本身留给本体维护方裁决。
