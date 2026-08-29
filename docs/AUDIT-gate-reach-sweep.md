# AUDIT · WO-GATE-REACH-SWEEP —— 门的射程对账与「假绿」整类五条

**分支** `claude/handoff-wo-gate-reach-sweep` · **画像 轻**（只改门脚本/台账/本体，未跑测试套件，未动一行 `apps/**`、`packages/**`） · 2026-08-20 交付。

本文件是交付①（现算射程对账表）+ 交付②③④⑤的 census 证据 + 交付⑥的变异反证原文的合订本。
交单报告（①-⑥格式）另见 `docs/HANDOFF-WO-GATE-REACH-SWEEP.md`。

---

## 交付① · 现算射程对账表（声称 vs 实际 vs 差集）

**算法**（全部机器现算，一个字都没手抄）：

- **声称** = `scripts/gate-ledger.json` 每道门的 `guardedPaths`（台账责任边界）；
- **实际** = `scripts/lib/reach-surface.mjs` 从门源码 **AST**（TypeScript 编译器 API，与
  `check-gate-exit-discipline.mjs` 同一个解析器）抽出的扫描面，本地 `import` 由门追两层并入
  （深度感知 + 环安全缓存）；
- **差集** = 双向：`声称⊄实际` = 射程缺口候选（gap）· `实际⊄声称` = 台账欠账候选（undeclared）。

**为什么是 AST 不是正则**（本单实测，不许退回）：正则抽取死在词法层 ——
① 正则字面量里的反引号（`check-bstack-derive.mjs:42` 实物形状）被抹串器当模板串起点，
其后的真代码全被吞；② 金丝雀样例模板串里的假路径（`packages/canary`）被当真射程抽进来。
词法问题只能用词法器解。

**总量结论**（2026-08-20 实测，`node scripts/check-gate-reach.mjs --table` 原文）：

```
✅ 射程抽取器金丝雀：三十七向全通过
· 对账：门 100 道 · 双向零差 92 道 · 有差集 8 道 · 差集条目 12 条
🟢 gate-reach:check 通过：100 道门对账完毕（双向零差 92 道）· 差集 12 条全部定性（POINTER 11 · EXTRACTOR-SHAPE 1）· 棘轮 12 ≤ 12。
```

**100 道门逐行对账表**（✓ = 双向零差 · ◑ = 有差集，定性见下节）：

```
✓ check-action-wiring.mjs  声称 4 条 · 射程 4 条 · gap 0 · undeclared 0
◑ check-agent-config-complete.mjs  声称 3 条 · 射程 11 条 · gap 1 · undeclared 0
✓ check-arg-drop-seam.mjs  声称 7 条 · 射程 22 条 · gap 0 · undeclared 0
✓ check-backend-frontend-seam.mjs  声称 9 条 · 射程 8 条 · gap 0 · undeclared 0
✓ check-baseline-writer-honesty.mjs  声称 3 条 · 射程 4 条 · gap 0 · undeclared 0
✓ check-boundary-singlesource.mjs  声称 19 条 · 射程 26 条 · gap 0 · undeclared 0
✓ check-branch-base.mjs  声称 2 条 · 射程 2 条 · gap 0 · undeclared 0
✓ check-bstack-derive.mjs  声称 3 条 · 射程 10 条 · gap 0 · undeclared 0
✓ check-carrier-has-instances.mjs  声称 3 条 · 射程 15 条 · gap 0 · undeclared 0
✓ check-case-collision.mjs  声称 3 条 · 射程 2 条 · gap 0 · undeclared 0
✓ check-chain-closure.mjs  声称 2 条 · 射程 9 条 · gap 0 · undeclared 0
✓ check-chain-node-singlesource.mjs  声称 4 条 · 射程 8 条 · gap 0 · undeclared 0
✓ check-chain-scan-honesty.mjs  声称 8 条 · 射程 20 条 · gap 0 · undeclared 0
✓ check-claim-strength.mjs  声称 7 条 · 射程 7 条 · gap 0 · undeclared 0
✓ check-cli-parity.mjs  声称 3 条 · 射程 3 条 · gap 0 · undeclared 0
✓ check-cockpit-widgets.mjs  声称 3 条 · 射程 3 条 · gap 0 · undeclared 0
✓ check-coverage-blind.mjs  声称 7 条 · 射程 7 条 · gap 0 · undeclared 0
✓ check-crossbranch-reinvent.mjs  声称 3 条 · 射程 2 条 · gap 0 · undeclared 0
✓ check-css-token-defined.mjs  声称 4 条 · 射程 2 条 · gap 0 · undeclared 0
✓ check-dark-launch-integrity.mjs  声称 3 条 · 射程 11 条 · gap 0 · undeclared 0
✓ check-dbui-flow-order.mjs  声称 3 条 · 射程 1 条 · gap 0 · undeclared 0
✓ check-debattery.mjs  声称 4 条 · 射程 5 条 · gap 0 · undeclared 0
✓ check-deploy-governance.mjs  声称 2 条 · 射程 2 条 · gap 0 · undeclared 0
✓ check-derived-recompute.mjs  声称 4 条 · 射程 16 条 · gap 0 · undeclared 0
✓ check-dev-jargon-onscreen.mjs  声称 5 条 · 射程 6 条 · gap 0 · undeclared 0
✓ check-dist-freshness.mjs  声称 2 条 · 射程 7 条 · gap 0 · undeclared 0
✓ check-dril-quality.mjs  声称 12 条 · 射程 19 条 · gap 0 · undeclared 0
✓ check-dril-registry.mjs  声称 9 条 · 射程 16 条 · gap 0 · undeclared 0
✓ check-dril-retrieval.mjs  声称 12 条 · 射程 19 条 · gap 0 · undeclared 0
✓ check-dsh-dormancy.mjs  声称 11 条 · 射程 4 条 · gap 0 · undeclared 0
✓ check-edge-active-mounts.mjs  声称 10 条 · 射程 11 条 · gap 0 · undeclared 0
✓ check-fact-usage.mjs  声称 8 条 · 射程 13 条 · gap 0 · undeclared 0
✓ check-factlock-anchor.mjs  声称 5 条 · 射程 3 条 · gap 0 · undeclared 0
✓ check-feature-default-parity.mjs  声称 4 条 · 射程 6 条 · gap 0 · undeclared 0
✓ check-file-truncation.mjs  声称 4 条 · 射程 6 条 · gap 0 · undeclared 0
✓ check-function-signature.mjs  声称 5 条 · 射程 12 条 · gap 0 · undeclared 0
✓ check-gate-exit-discipline.mjs  声称 4 条 · 射程 14 条 · gap 0 · undeclared 0
✓ check-gate-ledger.mjs  声称 3 条 · 射程 20 条 · gap 0 · undeclared 0
✓ check-gate-reach.mjs  声称 6 条 · 射程 26 条 · gap 0 · undeclared 0
✓ check-gate-roster-handcopied.mjs  声称 5 条 · 射程 23 条 · gap 0 · undeclared 0
✓ check-genuine-sim.mjs  声称 7 条 · 射程 7 条 · gap 0 · undeclared 0
✓ check-handoff-integration.mjs  声称 1 条 · 射程 3 条 · gap 0 · undeclared 0
✓ check-harness-ux-splitaccount.mjs  声称 4 条 · 射程 6 条 · gap 0 · undeclared 0
✓ check-layout-legibility.mjs  声称 11 条 · 射程 24 条 · gap 0 · undeclared 0
◑ check-lever-binding-drift.mjs  声称 3 条 · 射程 10 条 · gap 1 · undeclared 0
✓ check-lever-landing-exists.mjs  声称 3 条 · 射程 13 条 · gap 0 · undeclared 0
✓ check-lever-prop-resolvable.mjs  声称 3 条 · 射程 11 条 · gap 0 · undeclared 0
✓ check-link-stabilize.mjs  声称 2 条 · 射程 9 条 · gap 0 · undeclared 0
✓ check-loop-control.mjs  声称 4 条 · 射程 4 条 · gap 0 · undeclared 0
✓ check-merge-conflict-markers.mjs  声称 2 条 · 射程 2 条 · gap 0 · undeclared 0
✓ check-meta-sync.mjs  声称 2 条 · 射程 2 条 · gap 0 · undeclared 0
◑ check-migration-numbering.mjs  声称 4 条 · 射程 4 条 · gap 0 · undeclared 1
✓ check-mock-fidelity.mjs  声称 3 条 · 射程 7 条 · gap 0 · undeclared 0
✓ check-modeling-wire.mjs  声称 4 条 · 射程 4 条 · gap 0 · undeclared 0
✓ check-name-consistency.mjs  声称 6 条 · 射程 7 条 · gap 0 · undeclared 0
✓ check-nav-group-coverage.mjs  声称 6 条 · 射程 6 条 · gap 0 · undeclared 0
✓ check-no-hardcoded-rules.mjs  声称 1 条 · 射程 1 条 · gap 0 · undeclared 0
✓ check-no-raw-nul.mjs  声称 7 条 · 射程 2 条 · gap 0 · undeclared 0
✓ check-object-interface.mjs  声称 11 条 · 射程 21 条 · gap 0 · undeclared 0
◑ check-oee-ssot.mjs  声称 8 条 · 射程 8 条 · gap 4 · undeclared 0
✓ check-ontogenesis.mjs  声称 5 条 · 射程 5 条 · gap 0 · undeclared 0
✓ check-ontology-anchors.mjs  声称 2 条 · 射程 8 条 · gap 0 · undeclared 0
✓ check-ontology-descriptions.mjs  声称 2 条 · 射程 11 条 · gap 0 · undeclared 0
◑ check-ontology-s8-dedupe.mjs  声称 2 条 · 射程 3 条 · gap 1 · undeclared 0
✓ check-ontology-s8-status.mjs  声称 2 条 · 射程 8 条 · gap 0 · undeclared 0
✓ check-ontology-slice-coverage.mjs  声称 1 条 · 射程 12 条 · gap 0 · undeclared 0
✓ check-ontology-writeback.mjs  声称 3 条 · 射程 15 条 · gap 0 · undeclared 0
✓ check-opt-determinism.mjs  声称 3 条 · 射程 3 条 · gap 0 · undeclared 0
✓ check-opt-template.mjs  声称 5 条 · 射程 5 条 · gap 0 · undeclared 0
◑ check-outsource-redline.mjs  声称 5 条 · 射程 20 条 · gap 1 · undeclared 0
✓ check-prd-coverage.mjs  声称 4 条 · 射程 5 条 · gap 0 · undeclared 0
✓ check-prd-data-grounding.mjs  声称 7 条 · 射程 15 条 · gap 0 · undeclared 0
✓ check-prd-ontology.mjs  声称 2 条 · 射程 3 条 · gap 0 · undeclared 0
✓ check-propagation.mjs  声称 2 条 · 射程 3 条 · gap 0 · undeclared 0
✓ check-quantile-field-naming.mjs  声称 2 条 · 射程 1 条 · gap 0 · undeclared 0
✓ check-redline-wired.mjs  声称 8 条 · 射程 10 条 · gap 0 · undeclared 0
◑ check-ref-closure.mjs  声称 4 条 · 射程 4 条 · gap 2 · undeclared 0
✓ check-req-coverage.mjs  声称 3 条 · 射程 4 条 · gap 0 · undeclared 0
✓ check-resource-descriptor.mjs  声称 3 条 · 射程 10 条 · gap 0 · undeclared 0
✓ check-rule-closure.mjs  声称 3 条 · 射程 3 条 · gap 0 · undeclared 0
✓ check-scenario-slot-keys.mjs  声称 2 条 · 射程 9 条 · gap 0 · undeclared 0
✓ check-screen-value-provenance.mjs  声称 3 条 · 射程 3 条 · gap 0 · undeclared 0
◑ check-sim-readiness.mjs  声称 3 条 · 射程 2 条 · gap 1 · undeclared 0
✓ check-sim-ux-criteria.mjs  声称 9 条 · 射程 20 条 · gap 0 · undeclared 0
✓ check-sim.mjs  声称 6 条 · 射程 6 条 · gap 0 · undeclared 0
✓ check-slice-connectivity.mjs  声称 2 条 · 射程 12 条 · gap 0 · undeclared 0
✓ check-solver-arg-key-drift.mjs  声称 7 条 · 射程 11 条 · gap 0 · undeclared 0
✓ check-solver-field-seam.mjs  声称 7 条 · 射程 8 条 · gap 0 · undeclared 0
✓ check-solver-license.mjs  声称 1 条 · 射程 6 条 · gap 0 · undeclared 0
✓ check-stale-claims.mjs  声称 21 条 · 射程 8 条 · gap 0 · undeclared 0
✓ check-system-ontology.mjs  声称 3 条 · 射程 3 条 · gap 0 · undeclared 0
✓ check-text-legibility.mjs  声称 4 条 · 射程 3 条 · gap 0 · undeclared 0
✓ check-typecheck-coverage.mjs  声称 6 条 · 射程 5 条 · gap 0 · undeclared 0
✓ check-ui-first-layer.mjs  声称 6 条 · 射程 6 条 · gap 0 · undeclared 0
✓ check-unit-value-provenance.mjs  声称 6 条 · 射程 6 条 · gap 0 · undeclared 0
✓ check-validation.mjs  声称 1 条 · 射程 16 条 · gap 0 · undeclared 0
✓ check-verdict-rollup.mjs  声称 1 条 · 射程 5 条 · gap 0 · undeclared 0
✓ check-view-reachable.mjs  声称 2 条 · 射程 2 条 · gap 0 · undeclared 0
✓ check-wo-anchors.mjs  声称 1 条 · 射程 2 条 · gap 0 · undeclared 0
✓ check-worktree-canonical.mjs  声称 2 条 · 射程 2 条 · gap 0 · undeclared 0
```

### 差集 12 条的逐条定性（`scripts/gate-reach-baseline.json`，每条 why 含门头原文引证）

| 差集条目 | 方向 | 定性 | 一句话证据 |
|---|---|---|---|
| `check-agent-config-complete.mjs` → `apps/datacore/src/mapping.ts` | gap | POINTER | 台账写的是证据链下游消费方 —— 门头原文「mapping.ts:57 → buildMappingRows → GET /a/v1/ontology/mapping」是红时排查路径；门的检测对象 graphmeta（经 dist 桥在射程内）。 |
| `check-lever-binding-drift.mjs` → `apps/datacore/src/solvers/capacity.ts` | gap | POINTER | 门头对历史漂移落点的描述「capacity.ts:112 读的是 Process.utilization」= 病灶档案指针；门实读 contracts capacity-factors 的 src+dist（均在射程）。 |
| `check-oee-ssot.mjs` → `apps/datacore/src/solvers/capacity.ts` | gap | POINTER | 门头「诚实边界」原文：「后端把两套口径算进同一个响应（capacity.ts:264 的 oeeAvg…）本门**不覆盖**——那是 §5 建议的后续单。」 |
| `check-oee-ssot.mjs` → `apps/datacore/src/synthetic/battery.ts` | gap | POINTER | 门头「诚实边界」原文：「battery.ts PROP_DISPLAY_NAMES…经 withPropDisplayNames → REST 下发，前端文件里没有任何字面量…这一半只能靠接缝测试或后端侧的门接住。」 |
| `check-oee-ssot.mjs` → `packages/contracts/src/capacity-factors.ts` | gap | POINTER | 门头声明「只扫前端屏文件」（SCREEN_ROOTS）；契约侧由 lever-binding-drift 门守（其射程含 capacity-factors src+dist）。 |
| `check-oee-ssot.mjs` → `docs/DECISION-oee-ssot.md` | gap | POINTER | DECISION 文档是裁决档案住所（「那是 docs/DECISION-oee-ssot.md 要的裁决」），人维护门不扫。 |
| `check-ontology-s8-dedupe.mjs` → 自身 | gap | POINTER | 台账列门自己=「红了找谁」；门名在源码中只出现于门头与日志串（grep 实测 3 处全在注释/输出），门不读自己。 |
| `check-outsource-redline.mjs` → `docs/SYSTEM-ONTOLOGY.md` | gap | POINTER | 本体在源码中只出现于注释引用（「断点 G-C08-EXPR-PARAM-SPLIT，见 SYSTEM-ONTOLOGY §8」等三处）= 断点档案指针；门扫四棵 src 树（均在射程）。 |
| `check-ref-closure.mjs` → `apps/agentcore/src/skill-lint.ts` | gap | POINTER | 判据对象是 server.ts/resources.ts 三条发布路 handler 体（均在射程）；skill-lint.ts 是历史病灶涉事模块指针。 |
| `check-ref-closure.mjs` → `apps/agentcore/test/skill-ref-closure.seam.test.ts` | gap | POINTER | seam 测试是行为层互补（门守静态形态、测试守运行时行为），台账记它=行为证据住所；本仓纪律「绿测试≠能用」，门与测试互为冗余而非互相扫描。 |
| `check-sim-readiness.mjs` → `apps/datacore/test/sim-certification.test.ts` | gap | POINTER | 门头原文「运行时行为由 apps/datacore/test/sim-certification.test.ts 覆盖」= 行为证据指针；门读 certification.ts/app.ts 接线形态（均在射程）。 |
| `check-migration-numbering.mjs` → `apps/**/migrations` | undeclared | EXTRACTOR-SHAPE | 抽取器得到的 glob 形态与台账已登记的两条具体目录（datacore+agentcore migrations）同义同范围 —— 仓里恰好只有这两个包有 migrations；第三个包加 migrations 时本条复活逼人对账。 |

⛔ **12 条里没有一条 REAL-GAP** —— 本单唯一一处真缺口（`check-arg-drop-seam.mjs` 台账声称
`apps/agentcore/src/router/ceo-route.ts` 而实现从未读它）的处置是**修门**（断言⓪，见交付④），
不落账。定性账棘轮 `ratchetHigh 12`，只降不升。

### 对账过程中抖出并修掉的三个**抽取器/判据自身缺陷**（本单的副产品，全部有金丝雀）

1. **undeclared 只认 dir/glob 不认 file ⇒ 文件级射程漂移永久绿卡**（M3 变异首跑假绿抖出）。
   修：`reconcile()` 放宽为「file 类非 self-read 也纳入 undeclared」—— 当场暴露 **70 条真实台账欠账**
   （25 道门读了台账没写的文件），已全部**补登进台账**（undeclared 的正解是修账，且补登后
   受 `covered()` 反向核验：台账写了实现不读 = gap = 红，买不了绿）。
2. **金丝雀包装器调用内的样例路径被当射程**（`expect("…", !isProtected("docs/SYSTEM-ONTOLOGY.md.bak"))`，
   file-truncation 实物形状）。补登后被 ledger 门判「guardedPaths 指向空气」抖出。
   修：抽取器加调用栈跟踪，`expect/assert/…` 包装器内部不抽；金丝雀⑯常驻。
3. **CANARIES 顶层常量里的金丝雀样例路径被当射程**（dsh-dormancy 实物形状，样例按铁律 0.6
   必须取生产形状所以个个像真射程）。修：名含 canary 的顶层常量整枚不抽；金丝雀⑰常驻。

另修一处已记账的文档漂移：金丝雀向数字样曾写死「三十七向」（实测 35 条），改为**现算**（当前三十七向）。

---

## 交付② · G-GATE-RC1-MASQUERADE —— 逐门顶层兜底核验

机制早已在位（`gate-exit-discipline:check`，AST 判据：①exit(2) 出口②顶层兜底通向 2，豁免棘轮为空起点）。
本单做的是**全量复核**（含本单新建的门）。实测输出原文：

```
· 门脚本 100 个 · 守纪律 100 · 不守 0（其中已豁免 0）
· 分项：有 RC=2 出口 100 · 有顶层兜底(通向 exit(2)) 100
✓ gate-exit-discipline:check 通过（每道门都有 RC=2 出口 + 顶层兜底 · 豁免名单无冗余）
```

新门 `check-gate-reach.mjs` 的顶层 `try` 是 Program 直接子语句、`catch` 走 `toolBroken()`→exit(2)，
被守门门当场承认（不守纪律的新门会被它判红，这就是「明天新加的门天然带纪律」的机制）。
残留边界（守门门自己声明的，如实保留）：静态 import 链接期失败堵不住；各门「读 dist/读基线」
的语义层路径随用随修。

---

## 交付③ · G-RATCHET-NEWFILE-BLIND —— 新文件判据普查（36 个基线写入方全扫）

普查判据：**凡棘轮以「文件路径」为键的，核对「新文件出现时门会不会问它」** ——
正确判据是「文件在**扫描面**内 ⇒ 被问」（扫描面现算），错误判据是「文件在**基线**内 ⇒ 才被问」
（未登记 = 永久免检区）。36 个 `scripts/*-baseline.json` 中以文件/路径族为键的共 **11 个**，逐个核对：

| 门（基线） | 键形态 | 新文件判据（源码证据） | 结论 |
|---|---|---|---|
| `boundary-singlesource` | `路径#锚点` | 扫描面全仓现算 612 文件；「现算消费方未登记：…不在名册里 ⇒ 红」（门源码 382）+「正向：新增内联（不在基线里）⇒ 红」（456） | ✅ 安全 |
| `coverage-blind` | 指纹（含路径） | 「基线里没有的指纹 = 增量 = 红」（56）+ `--update` 拒绝新增条目（58）—— 新文件带盲区 = 新指纹 = 红 | ✅ 安全 |
| `dev-jargon-onscreen` | 文件路径 | 反向遍历基线（851：「rows 只含有命中的文件…必须反向遍历基线」）+ MIN_FILES/MIN_LOCALE_LITERALS 分母下界 | ✅ 安全（本病同族第三例的修处） |
| `debattery`（两份基线） | 文件路径 | 扫描面全仓现算；「无新增内联业务常数；存量见基线」（298/328）—— 新增 = 不在基线 = 红 | ✅ 安全 |
| `text-legibility` | 文件路径 | 「新文件（无基线）硬上限 = 0」（724）+ 金丝雀「棘轮必红-3 新文件带违规」（749） | ✅ 安全 |
| `ui-first-layer` | 文件路径 | D6 未登记文件进 `unlisted` 机器落账、未落账即红、新文件硬上限 3（28/48-54）—— 本病机制本体 | ✅ 安全 |
| `unit-value-provenance` | 文件路径 | 反向遍历基线松弛检测（314：「基线高于实测 = 一格免检名额 ⇒ 判红」）；新文件 UNPROVEN ⇒ 实测>基线 0 ⇒ 红 | ✅ 安全 |
| `ref-closure` | 发布路（非文件） | 发布路全集现算 server.ts 9 条 + 抽取器下界金丝雀（104）；新发布路未接探针即红 | ✅ 安全（键非文件，同形态已覆盖） |
| `edge-active-mounts` | 页键（非文件） | 名册现算（sim-page-roster）：「名册里新出现的页没挂且不在基线里 ⇒ 真违规，红」（36） | ✅ 安全 |
| `layout-legibility` | 页键（非文件） | 「名单 vs 现算」一致性断言每次运行打印差集（653）+ 债登记在 `gate-roster-baseline.json:PAGES`（ratchetHigh 0，新债即红） | ◑ 半形态：新页不静默（打印+债在册），但门不因此红 —— 这是 SWEEP-2 登记的 roster 债残余，不是「新文件盲」 |
| `solver-field-seam` | 字段 id（长在文件上） | 「新增死字段不自动收编…只删不加」（704/758）—— 新字段 = 新增缺口 = 红 | ✅ 安全 |

其余 25 个基线的键是计数/枚举/定性账/路由/指纹族，「搬家失忆」形态对它们不成立
（没有「文件」这个可搬的单位），不在本断点射程内。
**结论：11 个文件/路径族键基线 10 个判据正确、1 个是已登记的半形态债，无一「新文件永久免检」。**
本断点的开放工作（「其余 18 个基线写入方待逐个复核」）至此全部复核完毕。

---

## 交付④ · G-GATE-ROSTER-HANDCOPIED（现算化收口）+ G-SEAM-GATE-METHOD-BLIND（核验）

### ④a roster 普查门现状

`gate-roster:check` 实测 RC=0：「候选名册 76 个 定性：criteria 54 · computed 22（ratchetHigh 0）」。
本单收口了最后 2 条待定性候选（`check-fact-usage.mjs:EXCLUDE_DIRS`、`check-file-truncation.mjs:PROTECTED_PATTERNS`，
均定性 `criteria` = 判据本体：「哪些目录不算生产 UI 源」「保护判据本体」都是门的定义本身，无独立真相源），
并把 `ROUTER_EMITS` 的 why 改写为「键集已现算化」。

### ④b 本单唯一一处 REAL-GAP 的修门实例：`arg-drop-seam` 断言⓪

对账时发现 `check-arg-drop-seam.mjs` 台账声称守 `apps/agentcore/src/router/ceo-route.ts`
（门头自陈「ROUTER_EMITS 表的单一来源 = ceo-route.ts」），**而实现从未读那个文件** ——
键集靠人肉对齐（G-GATE-ROSTER-HANDCOPIED × G-GATE-SCOPE-MISSES-SUBJECT 双形态叠加）。
处置**不是落账是修门**：新增断言⓪，用 `lib/roster-hardcode.mjs` 的 `extractRosters`
从 ceo-route.ts 的 `CEO_INTENT_KEYS` **现算**真键集，与 ROUTER_EMITS 键集双向求差，
漏登记（路由有门没登记 ⇒ 永远绿）/ 死账（门登记了路由已删）任一向即 RC=1。
金丝雀与主判据**共用同一份** `ceoIntentKeysFrom()`/`rosterDrift()`：拿**真源码**就地变异
（`"ceo_metric",` → 注入 `"ceo_canary_fake"`），抽取器与差集逻辑都必须当场咬出假键，
锚点失效/枚举塌陷（<5 键）报 RC=2「工具坏了」。实测 RC=0（11 CEO intents · 16 entities）。
每个 intent 的实体清单仍人工派生登记（ArgsFrom 条件赋值静态证不了），由断言①动态半兜底 ——
门头已如实改写这一分工。

### ④c SEAM-METHOD-BLIND 核验（本体已记 ✅ 2026-08-16）

本体 §8 该行记「判据升级为方法+路径，判据单源 `routeConsumedByMethod()`，金丝雀 19→28（method 族 7 条全双向）
+ 变异反证三形态常驻」。本单复核：判据升级在位；且 `befe-seam:check` 在本分支**当前是 RC=1**，
红在「载体② 新增后端注册了·前端零调用端点 ×2」（`POST /a/v1/sim/change-impact-preview` datacore app.ts:2283 ·
`POST /b/v1/governance/adjudicate` agentcore server.ts:2161）—— 这正是判据升级后的牙：
方法+路径维度的新增缺口被真咬出。这两条红是**集成线既存**（本单未碰 `apps/**`，见 T2 逐字对比），
按范围纪律**只登记不修**：归 `befe-seam` 基线认账或接线单，差什么 = 一张「给两个端点接前端调用
或具名豁免」的后续 WO。

---

## 交付⑥ · 变异反证原文（M1/M2/M3，每条跑完即还原并复绿）

### M1 · 抽掉一条基线定性 ⇒ 必须 RC=1 点名未定性差集

变异：`scripts/gate-reach-baseline.json` 删 `check-sim-readiness.mjs|gap|apps/datacore/test/sim-certification.test.ts` 条目。

```
M1_RC=1
🔴 gate-reach:check 未通过（1 条）：
  · ① 未定性差集：check-sim-readiness.mjs 的台账声称「apps/datacore/test/sim-certification.test.ts」不在其实现的扫描面里（射程缺口候选） —— 定性（POINTER / EXTRACTOR-BLIND / EXTRACTOR-SHAPE，各带原文证据）或修门/修账。
```

还原后 RC=0。**红对地方**：红在判据①（未定性差集），不是门崩了。

### M2 · 给某门台账塞一条它根本不读的 guardedPath ⇒ 必须 RC=1 点名 GAP

变异：`check-sim-readiness.mjs` 台账 guardedPaths 加 `apps/datacore/src/synthetic/m2-mutation-fake.ts`。

```
M2_RC=1
🔴 gate-reach:check 未通过（1 条）：
  · ① 未定性差集：check-sim-readiness.mjs 的台账声称「apps/datacore/src/synthetic/m2-mutation-fake.ts」不在其实现的扫描面里（射程缺口候选） —— 定性（POINTER / EXTRACTOR-BLIND / EXTRACTOR-SHAPE，各带原文证据）或修门/修账。
```

还原后 RC=0。**红对地方**：门报出的正是那条假声称（射程缺口方向）。

### M3 · 给某门源码加一个扫描常量 ⇒ 必须 RC=1 点名 UNDECLARED

变异：`check-migration-numbering.mjs` 尾部加
`const M3_SURFACE = readFileSync("packages/contracts/src/databuilder.ts", "utf8")`。

**首跑 M3_RC=0（假绿！）** —— 变异反证先把门自己抓了一遍：`reconcile()` 的 undeclared
当时只认 dir/glob 类条目，file 类被沉默排除，等于给「文件级射程漂移」发永久绿卡。
当场放宽（file 类非 self-read 纳入）并补金丝雀后**重跑**：

```
M3_RC=1
🔴 gate-reach:check 未通过（1 条）：
  · ① 未定性差集：check-migration-numbering.mjs 的实际射程「packages/contracts/src/databuilder.ts」不在台账 guardedPaths 里（台账欠账候选） —— 定性（POINTER / EXTRACTOR-BLIND / EXTRACTOR-SHAPE，各带原文证据）或修门/修账。
```

还原后 RC=0。**红对地方**：门报出的正是那条新扫描面（台账欠账方向）。
M3 放宽同时暴露了 70 条真实台账欠账（25 道门），已全部补登（见交付①副产品 1）。

### ④b 修门的变异反证（arg-drop-seam 断言⓪金丝雀，每次运行自动执行）

金丝雀拿 ceo-route.ts **真源码**就地变异（注入 `"ceo_canary_fake"`）⇒ 同一套
`ceoIntentKeysFrom()`/`rosterDrift()` 必须咬出 `missing=["ceo_canary_fake"]`；
锚点失效、枚举塌陷（<5 键）、假键抽不出/咬不出 → RC=2「工具坏了」。
即：每次门跑起来，「门没瞎」这件事都被重新证明一遍，而不是建门那天证明过一次。

---

## 诚实边界（不许把本单读成「全仓门射程已对齐」）

1. 抽取器抽的是**源码里写得出的**扫描面。环境变量/运行时参数/HTTP 响应/子进程输出决定的读取
   看不见 —— 看得见才记账，看不见的就是看不见（`EXTRACTOR-BLIND` 定性就是给这一类的，
   本批 12 条里没用上，是事实不是避讳）。
2. 「实际 ⊇ 声称」成立**不证明**门真检查了那些内容 —— 只证明它读了那些文件；
   读没读到该看的那几行，是各门自己的判据课。
3. POINTER 定性的 11 条**仍是台账上的指针条目** —— 它们的意义是「红时找谁」，
   不是「门在扫它」。哪天某个指针变成该扫的对象，改台账会当场制造 gap 差集逼人复核 ——
   这正是账活着的方式。
