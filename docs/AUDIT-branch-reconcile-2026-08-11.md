# 分支内容级对账 · 281 条领先 canonical 的分支

> **WO-BRANCH-RECONCILE** · 实测日 **2026-08-13** · 分支 `claude/handoff-wo-branch-reconcile`
> canonical = `origin/claude/inspiring-gates-aqczjg` @ `d3bf55d5`（1826 个 blob）
> 本单**只出结论，不动任何分支**：没有删除、没有合并、没有强推。

---

## §0 · 一句话结论

**281 条里，93 条是真欠账，118 条已过期，42 条已被完整收编，27 条我判不了，1 条是反向回退（合进去会掉代码）。**

- 真欠账里 **218 个文件实例（181 条不同路径）** canonical 里根本没有 —— 含 **9 个 migration**、
  **9 个 contracts schema**、**9 道 `check-*.mjs` 门**（另有 11 个配套脚本/库）、以及 67 个测试文件。
- **`integ-ui-w5` 一条顶六条**：它是 `befe-seam-field` / `scope-honesty-fe` / `disposition-inline-row` /
  `order-row-detail` / `ontology-ia` / `ot-instance-reach` 六条的**逐字节超集**（9 个文件 blob 哈希全等，见 §4.1）。
- ⚠️ **派单人给的「头部 5 条」有 4 条判错了方向** —— 它们不是欠账，是已过期。详见 §9。

---

## §1 · 判据：按内容判，不按祖先关系判

`git merge-base --is-ancestor` 与「领先 N 个提交」**都不度量「内容在不在」**。本单三条判据全部落在 blob / 行内容上：

| 态 | 判据 | 含义 |
|---|---|---|
| **SAME** | 两侧 blob 哈希相同 | 内容已在 canonical（多半是 cherry-pick 进去的） |
| **DIFF** | 两侧都有、哈希不同 | 有差异，需再判方向 |
| **ABSENT** | canonical 侧 `git rev-parse --verify -q` **退出码非 0** | canonical 里没有这个文件 |

**判据落在退出码上，不是「输出非空」。** 实测原文（本单跑的）：

```
naive `git rev-parse origin/claude/inspiring-gates-aqczjg:docs/__canary_definitely_absent_9f3a__.md`
   rc=128  stdout='origin/claude/inspiring-gates-aqczjg:docs/__canary_definitely_absent_9f3a__.md'
带 --verify -q                    rc=1    stdout 为空
```
不带 `--verify -q` 时它**把输入串原样吐回 stdout** —— 只看 `-n "$out"` 的调用会被骗成「存在但内容不同」。

### 三条判据不够，还加了四条

单靠 SAME/DIFF/ABSENT 会得出错误结论，因为：

1. **ABSENT ≠ 欠账** —— 文件可能被改名，或被 canonical 有意删除。
   → 加 **改名/删除排查**：blob 是否出现在 canonical 树的其它路径、同名文件是否存在、该路径在 canonical 历史里是否被动过。
   248 个 ABSENT 里排掉 **30** 个（7 个改名 + 23 个 canonical 有意删除），剩 **218** 个才算真缺口。
2. **DIFF ≠ 欠账** —— 带冲突解决的 cherry-pick 会让「改动已并入」但 blob 仍不同。
   → 加 **行级吸收率**：分支新增的行（merge-base→分支）有多少出现在 canonical 的同名文件里。
   ≥0.95 判已吸收，≤0.20 判未吸收，中间判部分（进「判不了」桶）。
3. **未吸收 ≠ 欠账** —— canonical 可能有意改写了那块。
   → 加 **分叉点判别**：`merge-base:f` 的 blob 是否**仍等于** `canonical:f`。
   相等 ⇒ canonical 自分叉起**根本没动过这个文件**，分支的改动就是纯粹没并进去（高置信欠账）；
   不等 ⇒ 两边都动了，是分叉不是欠账。
4. **纯删除分支会伪装成「已收编」** —— 分支只删不加时，新增行为 0，吸收率无信号，会被算作「无缺口」。
   → 加 **回退形态识别**：分支删掉的行里有多少 canonical 今天仍然有。抓出 1 条（见 §7）。

---

## §2 · 工具自证（金丝雀）—— 否定结论的前置

本单报了大量否定结论（「canonical 没有这个文件」「这条分支没有欠账」）。按纪律，每个分类器**先跑已知必中的样例**，
且金丝雀与主逻辑**共用同一份实现**（`classify_one()` / `canon_map` / `absorption()` 都是主逻辑那一份，没有另抄正则）。

### 2.1 三态分类器 —— 三条臂各命中一次

```
SAME  arm: classify_one(CANON, CLAUDE.md) = SAME   [blob de37421730a4 两侧相同]
DIFF  arm: classify_one(CANON~1, docs/SYSTEM-ONTOLOGY.md) = DIFF   [f7064524ae85 vs c8bae54d2d43]
ABSENT arm: classify_one(origin/claude/handoff-causal-deepchain,
                         apps/datacore/test/causal-deepchain.test.ts) = ABSENT
            分支侧 rc=0 (1f83a99478e7) | canonical 侧 rc=1
VERDICT: PASS - classifier hits all three arms
```

⚠️ **第一版金丝雀当场报了 TOOL BROKEN，并且它是对的。** 我最初的 ABSENT 样例两侧都用 `CANON`，
结果落进 `NEITHER` 而不是 `ABSENT` —— 分类器根本没被验到那条臂。若当时跳过金丝雀直接跑，
「ABSENT=248」这个数是从一条**从未验证过**的代码路径里出来的。原始输出：

```
ABSENT arm: blob_at(CANON, docs/__canary_definitely_absent_9f3a__.md) rc=1; classify_one -> NEITHER
VERDICT: FAIL - TOOL BROKEN
TOOL BROKEN -> refusing to report any counts.
```

### 2.2 改名/删除排查器

```
canon_map 有 1826 条路径；探针 'CLAUDE.md' 命中: True
canon_blobs 有 1824 个 blob；探针 blob 在集合里: True
basename 索引: 'CLAUDE.md' -> ['CLAUDE.md']
ghost 'docs/__ghost_9f3a__.md' 在 canon_map: False（必须为 False）
VERDICT: PASS
```

### 2.3 行级吸收率 —— 正反双控

```
POSITIVE control（blob 逐字节相同的文件，必须 ratio 1.00 -> ABSORBED）:
   handoff-a3-fix :: apps/agentcore/src/catalog/service.ts  ratio=1.00 -> ABSORBED
NEGATIVE control（同一批新增行拿去比一个**无关的** canonical 文件，必须 ~0）:
   ratio=0.00 -> NOT_ABSORBED
VERDICT: PASS
```
反向控制是必须的：只有正控会被「匹配器把什么都算命中」骗过去。

### 2.4 分叉点判别器 —— 必须能答出两个方向

```
CLEAN_UNMERGED 臂: handoff-ceo6 :: apps/agentcore/test/ceo-agent-context.test.ts
                   （merge-base blob == canonical blob e6e7751457ad）
DIVERGENT      臂: handoff-a3-fix :: apps/datacore/src/sim/propagation.ts
                   （85cbefd50716 vs 5f5921b91a65）
VERDICT: PASS
```

### 2.5 回退形态识别器

```
已知回退型 handoff-wo-gate-rc2 被识别: True
已知新增型 handoff-wo-sandbox-g1 revert_shaped: None（必须非 True）
VERDICT: PASS
```

### 2.6 日志佐证器（独立第二信号）

```
canonical 日志 1497975 字符, rc=0
已知并线的 WO slug 在日志里找到: ['skill-partial-a', 'rule-scope-drop', 'databuilder-pipeline']
ghost slug 'zzz-definitely-not-a-wo-9f3a' 在日志里: False
VERDICT: PASS
```

### 2.7 手工复验（工具之外，亲手跑）

不信自己的脚本，抽三条真欠账逐个手敲：

```
$ git rev-parse --verify -q CANON:scripts/gate-sandbox-g1.sh          -> rc=1（无）
$ git rev-parse --verify -q handoff-wo-sandbox-g1:scripts/gate-sandbox-g1.sh
                                                   -> 6f867a80849f  rc=0（有）
$ git rev-parse --verify -q CANON:packages/contracts/src/process-runtime.ts   -> rc=1（无）
$ git rev-parse --verify -q handoff-wo-process-instance:...            -> 9337d391c533 rc=0（有）
$ git rev-parse --verify -q CANON:scripts/check-solver-field-seam.mjs  -> rc=1（无）
$ git rev-parse --verify -q integ-ui-w5:scripts/check-solver-field-seam.mjs
                                                   -> f435475f533e  rc=0（有）
```
3/3 与脚本结论一致。

---

## §3 · 四态计数

| 定性 | 条数 | 判据 | 处置建议（⛔ 我不删，交仓主） |
|---|---|---|---|
| **真欠账** | **93** | 有 canonical 缺的整文件，或有「canonical 自分叉起没动过该文件」的未并改动 | 见 §4 逐条，按值排序捞 |
| **已过期** | **118** | 无整文件缺口、无干净未并改动；只剩 canonical 已独立改写的文件，且 canonical 日志确实提过本单 | 可删 |
| **已收编** | **42** | 独有文件全部 SAME 或行级全吸收 | 可删 |
| **判不了** | **27** | 证据只有「部分吸收」，或只有分叉文件且 canonical 日志从未提过本单 | 需人工看 |
| **反向回退** | **1** | 分支尖端**删掉** canonical 今天仍有的行 | **绝不可合**；删分支 |
| 合计 | **281** | | |

**文件级底数**：独有文件 **3098** 个 —— SAME 730 · DIFF 2116 · ABSENT 248 · 分支侧删除 2 · 两侧都无 2
（合计 3098 ✅ 对得上）。
DIFF 2116 拆开：行级已吸收 1000 · 未吸收 575 · 部分吸收 466 · 无新增行 75。
ABSENT 248 拆开：**真缺口 218**（181 条不同路径）· canonical 有意删除 23 · 改名 7。

真缺口 181 条路径按类型：测试 67 · 源码/其它 45 · docs 31 · 脚本与门 20 · migration 9 · contracts 9。

**两个独立信号互相印证**（内容判据 × canonical 日志是否提过本单）：

| | 日志提过 | 日志没提过 |
|---|---|---|
| 已收编 | 35 | 7 |
| 已过期 | **118** | **0** |
| 真欠账 | 23 | **70** |
| 判不了 | 0 | 27 |
| 反向回退 | 1 | 0 |

已过期 **118/118 全部**有日志佐证（零例外）；真欠账 70/93 canonical 从未提过。
两条完全独立的判据方向一致 —— 这是结论可信的主要理由。
反过来看也自洽：判不了那 27 条**一条都没有**日志佐证，这正是它们判不了的原因之一。

---

## §4 · 真欠账（93 条）

### 4.1 先看这个：`integ-ui-w5` 一条顶六条（逐字节验证）

捞之前先去重，否则会把同一份内容捞六遍。`integ-ui-w5` 的 9 个缺失文件里，有 9 个与另外 6 条独立欠账分支
**blob 哈希完全相同**：

| 文件 | `integ-ui-w5` blob | 也在这条分支上 | 该分支的 blob | 相同 |
|---|---|---|---|---|
| `scripts/check-solver-field-seam.mjs` | `f435475f53` | `handoff-wo-befe-seam-field` | `f435475f53` | ✅ |
| `scripts/lib/seam-lex.mjs` | `32dec19c20` | `handoff-wo-befe-seam-field` | `32dec19c20` | ✅ |
| `scripts/solver-field-seam-baseline.json` | `82e5b2d287` | `handoff-wo-befe-seam-field` | `82e5b2d287` | ✅ |
| `apps/frontend-shell/src/views/ScopeHonesty.tsx` | `0aab0c6514` | `handoff-wo-scope-honesty-fe` | `0aab0c6514` | ✅ |
| `apps/frontend-shell/test/scope-honesty-fe.seam.test.tsx` | `cdded09c65` | `handoff-wo-scope-honesty-fe` | `cdded09c65` | ✅ |
| `apps/frontend-shell/test/disposition-inline-row.seam.test.tsx` | `8d9d88945e` | `handoff-wo-disposition-inline-row` | `8d9d88945e` | ✅ |
| `apps/frontend-shell/test/order-row-detail.seam.test.tsx` | `2854e2aba1` | `handoff-wo-order-row-detail` | `2854e2aba1` | ✅ |
| `docs/AUDIT-ontology-entries-IA.md` | `cbdd69bed5` | `handoff-wo-ontology-ia` | `cbdd69bed5` | ✅ |
| `apps/frontend-shell/src/pages/admin/ObjectTypesBrowserPage.module.css` | `009af997ff` | `handoff-wo-ot-instance-reach` | `009af997ff` | ✅ |

⇒ **捞 `integ-ui-w5` 一条，这 6 条的缺失文件全部到位。** 这才是「integ 优先」的真实理由（见 §9.4）。

并且不只是整文件：这 6 条的**改动型欠账也全被覆盖**。实测三条有改动型欠账的分支，
其文件集合全部落在 `integ-ui-w5` 的 5 个改动文件之内，无一遗漏：

```
integ-ui-w5 改动型欠账文件（5）:
  ObjectTypesBrowserPage.tsx · OrderChainView.tsx · PlanViews.module.css
  f23.order-chain.test.tsx · f57.object-types-browser.test.tsx
  scope-honesty-fe   (1 个)  未被覆盖: none
  order-row-detail   (3 个)  未被覆盖: none
  ot-instance-reach  (2 个)  未被覆盖: none
```

### 4.2 其它重复分支（捞一条即可，另一条可删）

| 关系 | 实测 |
|---|---|
| `handoff-wo-decision-info-fe` ↔ `handoff-wo-decision-info-oncanonical` | **5/5 blob 全等** —— 完全重复，任捞其一 |
| `handoff-wo-agentrun-attribution` ⊂ `handoff-wo-agentrun-fanout-persist` | 2/2 全等，后者另有 `013_agentrun_fanout.sql` ⇒ **捞后者** |
| `handoff-wo-69-p2-function-signature` ⊂ `handoff-wo-69-p3-interface` | 3/3 全等，后者另有 `028_object_interfaces.sql` + `object-interface.ts` ⇒ **捞后者** |
| `handoff-prd-audit-b1` ↔ `b2` | 缺的是**同 4 个文件**，其中 2 个 blob 全等、2 个 b2 更新（b2 提交题写「batch2 完成 22/22」）⇒ **捞 b2** |
| `handoff-prd-audit-b4` ⊂ `b1`/`b2` | b4 只缺 `AUDIT-prd-reality-batch4.md`，b1/b2 都带 ⇒ b4 可删 |

⚠️ **注意别顺手把 b3/b5 一起删了** —— 我最初以为 b3/b4/b5 都是 b1/b2 的子集，实测**不是**：
`b3` 独有 `docs/AUDIT-prd-reality-batch3.md`、`b5` 独有 `docs/AUDIT-prd-reality-batch5.md`，
这两份 b1/b2 都没有。**b3 与 b5 必须单独捞。**

去重后（integ-ui-w5 顶掉 6 条，另 5 组重复各省 1 条），93 条真欠账实际只需捞约 **82 条**的内容。

### 4.3 逐条清单

按「canonical 缺的整文件数 × 3 + 干净未并改动数」排序。

| # | 分支 | tip sha | canonical 缺的整文件 | 未并入的改动(canonical 自分叉起未动过该文件) | canonical 日志提过本单 |
|---|---|---|---|---|---|
| 1 | `handoff-wo-aip-cap0` | `5e6c1368fa` | **9** | 11 | 是 |
| 2 | `integ-ui-w5` | `c4cc753b55` | **9** | 4 | **否** |
| 3 | `handoff-wo-69-p3-interface` | `4427af2a7d` | **9** | 3 | 是 |
| 4 | `handoff-wo-process-instance` | `24204b745f` | **7** | 4 | **否** |
| 5 | `handoff-wo-sandbox-g1` | `712e93f2a9` | **8** | 0 | **否** |
| 6 | `handoff-wo-s08-kit-fe` | `387fff8f52` | **7** | 1 | **否** |
| 7 | `handoff-wo-agentrun-fanout-persist` | `e7e978db5b` | **4** | 8 | **否** |
| 8 | `handoff-wo-metrics-authz` | `51d05f9d9a` | **4** | 8 | **否** |
| 9 | `handoff-wo-org-world` | `972e14187a` | **5** | 4 | 是 |
| 10 | `handoff-diag-100q` | `55636f5d24` | **6** | 0 | **否** |
| 11 | `handoff-wo-69-p2-function-signature` | `cea5f85dd7` | **5** | 2 | **否** |
| 12 | `handoff-wo-63-schema-readability` | `333ab6f3b3` | **5** | 1 | **否** |
| 13 | `handoff-wo-approval-policy` | `6c40efed23` | **5** | 1 | 是 |
| 14 | `handoff-wo-decision-info-fe` | `19e9db0db7` | **5** | 0 | 是 |
| 15 | `handoff-wo-decision-info-oncanonical` | `54e299cc1e` | **5** | 0 | 是 |
| 16 | `handoff-wo-quote-margin-customer` | `ad4407ee02` | **5** | 0 | **否** |
| 17 | `handoff-wo-sandbox-a10` | `f4fb2abc5e` | **5** | 0 | 是 |
| 18 | `handoff-wo-slice-discovery` | `17e1e05fb1` | **4** | 3 | **否** |
| 19 | `handoff-wo-66-rules-p1p2` | `7b92660a0a` | **3** | 6 | 是 |
| 20 | `handoff-wo-solver-scope-fe` | `7b52d4f2f2` | **4** | 2 | 是 |
| 21 | `handoff-wo-hover-layer` | `0691a55aad` | **0** | 15 | **否** |
| 22 | `handoff-wo-decision-graph` | `c931742ea4` | **4** | 1 | **否** |
| 23 | `handoff-wo-agentrun-attribution` | `c0b70d42e8` | **2** | 7 | **否** |
| 24 | `handoff-prd-audit-b1` | `a2ff344553` | **4** | 0 | **否** |
| 25 | `handoff-prd-audit-b2` | `5ef6503c9f` | **4** | 0 | **否** |
| 26 | `handoff-wo-procurement-frontend` | `5c95027ebb` | **4** | 0 | **否** |
| 27 | `handoff-wo-65-metrics` | `ef5e9fc898` | **2** | 5 | **否** |
| 28 | `handoff-wo-graph-desc-contract` | `fd88703bc0` | **2** | 4 | **否** |
| 29 | `handoff-wo-modeling-no-llm` | `e662d13119` | **2** | 4 | **否** |
| 30 | `handoff-wo-slice-ref-producer` | `5ebc6cf2f0` | **2** | 4 | 是 |
| 31 | `handoff-wo-a6-contention` | `9a54d5daa1` | **1** | 7 | **否** |
| 32 | `handoff-wo-argname-and-units` | `09d6275f5d` | **3** | 0 | **否** |
| 33 | `handoff-wo-befe-seam-field` | `763c0d1b77` | **3** | 0 | **否** |
| 34 | `handoff-wo-gate-selftest` | `2083bf9aac` | **3** | 0 | **否** |
| 35 | `handoff-wo-leadtime-split` | `ee6a5800dd` | **2** | 3 | **否** |
| 36 | `handoff-wo-adopt-decision-play` | `eefaabfc20` | **2** | 2 | **否** |
| 37 | `handoff-wo-decision-info-frontend2` | `8e77af09c1` | **2** | 2 | **否** |
| 38 | `handoff-wo-rules-dsl-family` | `8a5e6e93d3` | **1** | 5 | **否** |
| 39 | `handoff-sandbox-action-propagation` | `b8db35b575` | **2** | 1 | 是 |
| 40 | `handoff-wo-decision-info-frontend` | `18f10d4015` | **2** | 1 | **否** |
| 41 | `handoff-wo-prd-grounding-gate` | `9ecd52ea87` | **2** | 1 | **否** |
| 42 | `handoff-wo-scope-honesty-fe` | `0ae2df51c4` | **2** | 1 | **否** |
| 43 | `handoff-metric-aware-seam` | `b2c3a1e590` | **2** | 0 | **否** |
| 44 | `handoff-ontology-context` | `93913c2e8e` | **2** | 0 | 是 |
| 45 | `handoff-wo-coverage-blind` | `fe93efbb2c` | **2** | 0 | **否** |
| 46 | `handoff-wo-multi-intent-p1` | `f4fa91b6f3` | **2** | 0 | 是 |
| 47 | `handoff-wo-sandbox-prop-direction` | `4aabd4bc27` | **2** | 0 | **否** |
| 48 | `handoff-wo-sim-checkpoints` | `32f817d805` | **2** | 0 | **否** |
| 49 | `handoff-plankpi-mq` | `9c1716521a` | **1** | 3 | **否** |
| 50 | `handoff-wo-69-ontology-primitives` | `d0396227c4` | **1** | 2 | **否** |
| 51 | `handoff-wo-order-row-detail` | `e9f810f956` | **1** | 2 | **否** |
| 52 | `handoff-wo-ot-instance-reach` | `7bf51807cb` | **1** | 2 | **否** |
| 53 | `handoff-wo-sandbox-candidates-fe` | `d6d4d550ad` | **1** | 2 | 是 |
| 54 | `handoff-ceo6` | `873eebc1a4` | **1** | 1 | 是 |
| 55 | `handoff-wo-agentpath-hint-truth` | `8a4dfffc45` | **1** | 1 | **否** |
| 56 | `handoff-causal-deepchain` | `a14dea7e4b` | **1** | 0 | **否** |
| 57 | `handoff-geo-real-signal` | `ff780e8443` | **1** | 0 | **否** |
| 58 | `handoff-metric-aware-gap` | `ce726e51bc` | **1** | 0 | 是 |
| 59 | `handoff-onto-writeback-p1` | `e17385d0f9` | **1** | 0 | **否** |
| 60 | `handoff-prd-audit-b3` | `ddac597c02` | **1** | 0 | **否** |
| 61 | `handoff-prd-audit-b4` | `dd3e87f9a5` | **1** | 0 | **否** |
| 62 | `handoff-prd-audit-b5` | `cb494eb02b` | **1** | 0 | **否** |
| 63 | `handoff-prd-coverage-full` | `2cdc882d7d` | **1** | 0 | **否** |
| 64 | `handoff-qos-live-evidence` | `69543dffce` | **1** | 0 | **否** |
| 65 | `handoff-sandbox-a10-audit` | `317f37e8d3` | **1** | 0 | **否** |
| 66 | `handoff-sandbox-a6-audit` | `bcce7269ca` | **1** | 0 | **否** |
| 67 | `handoff-sandbox-field-inventory` | `db976009b7` | **1** | 0 | **否** |
| 68 | `handoff-sandbox-gap-audit` | `ec5cbbc4e7` | **1** | 0 | **否** |
| 69 | `handoff-skill-migration-scope` | `6cddca17f7` | **1** | 0 | **否** |
| 70 | `handoff-tier2-semantic-discover-v2` | `1ad5073854` | **1** | 0 | **否** |
| 71 | `handoff-wo-0-nl-wiring` | `b5e53261a2` | **1** | 0 | 是 |
| 72 | `handoff-wo-66-rules-first-class` | `c05137e41c` | **1** | 0 | **否** |
| 73 | `handoff-wo-a10-events` | `89370e3aba` | **1** | 0 | **否** |
| 74 | `handoff-wo-a6-rule-scan` | `844267f2dd` | **1** | 0 | **否** |
| 75 | `handoff-wo-a6-seg` | `2f54e84d06` | **1** | 0 | **否** |
| 76 | `handoff-wo-changeover-key` | `ff9ebf546b` | **1** | 0 | **否** |
| 77 | `handoff-wo-delta-compare` | `4430958868` | **1** | 0 | **否** |
| 78 | `handoff-wo-disposition-inline-row` | `115fe884f2` | **1** | 0 | **否** |
| 79 | `handoff-wo-e2e-dialogue-acceptance` | `a05e52d9f6` | **1** | 0 | 是 |
| 80 | `handoff-wo-gray-node-autofill` | `ca9d6ff040` | **1** | 0 | 是 |
| 81 | `handoff-wo-metrics-audit` | `a4cea8edb3` | **1** | 0 | **否** |
| 82 | `handoff-wo-modeling-interactive` | `92ac7ce51b` | **1** | 0 | 是 |
| 83 | `handoff-wo-multiintent-l2` | `37003a4179` | **1** | 0 | **否** |
| 84 | `handoff-wo-multiintent-l3` | `6307959159` | **1** | 0 | **否** |
| 85 | `handoff-wo-nl-robust` | `fd01770a0e` | **1** | 0 | **否** |
| 86 | `handoff-wo-ontology-ia` | `97ad494d76` | **1** | 0 | **否** |
| 87 | `handoff-wo-pipeline-ui` | `b5e1b6c7a5` | **1** | 0 | 是 |
| 88 | `handoff-wo-prd-field-audit` | `8ed7727b6f` | **1** | 0 | **否** |
| 89 | `handoff-wo-qos-cross-domain-unified-graw0b` | `f0c7df24f7` | **1** | 0 | **否** |
| 90 | `handoff-wo-82-peak-crossday` | `01f8b799da` | **0** | 2 | **否** |
| 91 | `handoff-wo-82` | `c971b9763e` | **0** | 1 | 是 |
| 92 | `handoff-wo-phase1-d-a` | `a0363f26ef` | **0** | 1 | **否** |
| 93 | `rescue-r13-drillfield-0811` | `f9b0c0ec46` | **0** | 1 | 是 |

### 逐条：它做了什么 · 独有内容是什么

**1. `handoff-wo-aip-cap0`** `5e6c1368fa` · 2026-07-29 · canonical 日志提过：是
  - 提交题：handoff(wo-aip-cap0): plan-builder Phase 1 + live-disposition + scenario launcher input passthrough
  - 提交题：WO-CAP-0: CapabilityMeta envelope + Skill/SolverDraft/ModelArtifact schemas + ontology update
  - canonical **没有**这些文件（9）：`apps/agentcore/migrations/010_plan_builder_canvases.sql` · `apps/agentcore/src/plan-builder/compiler.ts` · `apps/agentcore/test/plan-builder.test.ts` · `apps/frontend-shell/src/mocks/planBuilderFixtures.ts` · `apps/frontend-shell/src/pages/admin/PlanBuilderPage.module.css` · `apps/frontend-shell/src/pages/admin/PlanBuilderPage.tsx` · `apps/frontend-shell/test/admin-plan-builder.test.tsx` · `packages/contracts/src/capability.ts` · `packages/contracts/src/plan-builder.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，11）：`apps/agentcore/test/api.test.ts` · `apps/agentcore/test/compose-plan-seam.test.ts` · `apps/agentcore/test/growth-loop.test.ts` · `apps/agentcore/test/growth-probe.test.ts` · `apps/agentcore/test/live-endpoints-seam.test.ts` · `apps/datacore/src/solvers/sop-reschedule.ts` · `apps/frontend-shell/test/dash-export.test.tsx` · `apps/frontend-shell/test/f41.external-signals.test.tsx` · `apps/frontend-shell/test/f56.connection-category.test.tsx` · `apps/frontend-shell/test/gap-card.test.tsx` · `packages/contracts/src/operation-intent.ts`

**2. `integ-ui-w5`** `c4cc753b55` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：Merge remote-tracking branch 'origin/claude/handoff-wo-ot-instance-reach' into HEAD
  - 提交题：Merge remote-tracking branch 'origin/claude/handoff-wo-order-row-detail' into HEAD
  - canonical **没有**这些文件（9）：`apps/frontend-shell/src/pages/admin/ObjectTypesBrowserPage.module.css` · `apps/frontend-shell/src/views/ScopeHonesty.tsx` · `apps/frontend-shell/test/disposition-inline-row.seam.test.tsx` · `apps/frontend-shell/test/order-row-detail.seam.test.tsx` · `apps/frontend-shell/test/scope-honesty-fe.seam.test.tsx` · `docs/AUDIT-ontology-entries-IA.md` · `scripts/check-solver-field-seam.mjs` · `scripts/lib/seam-lex.mjs` · `scripts/solver-field-seam-baseline.json`
  - 改动未并入（canonical 自分叉起没动过这些文件，4）：`apps/frontend-shell/src/pages/admin/ObjectTypesBrowserPage.tsx` · `apps/frontend-shell/src/views/plan/OrderChainView.tsx` · `apps/frontend-shell/test/f23.order-chain.test.tsx` · `apps/frontend-shell/test/f57.object-types-browser.test.tsx`

**3. `handoff-wo-69-p3-interface`** `4427af2a7d` · 2026-07-31 · canonical 日志提过：是
  - 提交题：docs(ontology): §7 补登 P2 function-signature:check（跨阶段收口·闭 writeback 门对本单的告警）
  - 提交题：fix(a4): WO-69 P3 · Approvable 审批字段确定性合成（补 synthetic-field-alignment 红）
  - canonical **没有**这些文件（9）：`apps/datacore/migrations/028_object_interfaces.sql` · `apps/datacore/src/solvers/ontology-signature.ts` · `apps/datacore/test/column-security.test.ts` · `apps/datacore/test/object-interface.seam.test.ts` · `apps/datacore/test/ontology-signature.recorder.ts` · `apps/datacore/test/ontology-signature.seam.test.ts` · `packages/contracts/src/object-interface.ts` · `scripts/check-function-signature.mjs` · `scripts/check-object-interface.mjs`
  - 改动未并入（canonical 自分叉起没动过这些文件，3）：`apps/datacore/src/authz.ts` · `apps/datacore/src/errors.ts` · `apps/datacore/src/ontology-governance.ts`

**4. `handoff-wo-process-instance`** `24204b745f` · 2026-08-10 · canonical 日志提过：**否**
  - 提交题：docs+test: 交付说明 + 暗发防回归锁（第三个暗发集合 INCOMPLETE_DATA）
  - 提交题：feat(frontend): 流程卡点面板（四问）+ registry 接线 + endpoints + mock + 14 例 SEAM
  - canonical **没有**这些文件（7）：`apps/datacore/migrations/030_process_instances.sql` · `apps/datacore/test/process-instance.test.ts` · `apps/frontend-shell/src/views/ProcessStuckView.module.css` · `apps/frontend-shell/src/views/ProcessStuckView.tsx` · `apps/frontend-shell/test/process-stuck.seam.test.tsx` · `docs/WO-PROCESS-INSTANCE-delivery.md` · `packages/contracts/src/process-runtime.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，4）：`apps/datacore/src/features.ts` · `apps/datacore/test/dark-feature-default-off.test.ts` · `apps/datacore/test/helpers.ts` · `packages/contracts/src/process.ts`

**5. `handoff-wo-sandbox-g1`** `712e93f2a9` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：docs(本体): §8 登记两条新断点（诚实缺席声明过期 / 互斥裁决结构性不可达）+ §7 登记 G1 收口总门
  - 提交题：feat(G1): 补互斥裁决结构性不可达的诚实登记棘轮（变异反证实测：裁决摘掉仍绿）
  - canonical **没有**这些文件（8）：`apps/datacore/test/g1-probe.test.ts` · `apps/datacore/test/sandbox-g1-seam.test.ts` · `apps/frontend-shell/test/sandbox-g1-views.seam.test.tsx` · `scripts/g1-run-dc.sh` · `scripts/g1-run-fe.sh` · `scripts/g1-run-probe.sh` · `scripts/g1-run-static.sh` · `scripts/gate-sandbox-g1.sh`

**6. `handoff-wo-s08-kit-fe`** `387fff8f52` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：test(kit-fe): SEAM 门 —— 用**真链路抓下来的答案块**驱动，不用我自己捏的
  - 提交题：chore(kit-fe): lint 洁净（去掉未用的 taskId 形参与未用 import）
  - canonical **没有**这些文件（7）：`apps/frontend-shell/src/components/Answer/KitProcurementLegs.module.css` · `apps/frontend-shell/src/components/Answer/KitProcurementLegs.tsx` · `apps/frontend-shell/src/components/Answer/kitProcurement.ts` · `apps/frontend-shell/src/mocks/kitFixtures.ts` · `apps/frontend-shell/test/kit-procurement-answer.test.tsx` · `apps/frontend-shell/test/kit-procurement.seam.test.tsx` · `apps/frontend-shell/test/kit-readiness.real-block.json`
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/frontend-shell/src/mocks/sseScripts.ts`

**7. `handoff-wo-agentrun-fanout-persist`** `e7e978db5b` · 2026-08-10 · canonical 日志提过：**否**
  - 提交题：WO-AGENTRUN-FANOUT-PERSIST · 注释里的 file:line 改成符号引用（本单自己把它们挤漂了）
  - 提交题：WO-AGENTRUN-FANOUT-PERSIST · 回写本体 §8（铁律 0：改动闭了断点 → 本体不回写即过期失效）
  - canonical **没有**这些文件（4）：`apps/agentcore/migrations/012_agentrun_attribution.sql` · `apps/agentcore/migrations/013_agentrun_fanout.sql` · `apps/agentcore/test/agent-run-attribution.seam.test.ts` · `apps/agentcore/test/agent-run-fanout.seam.test.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，8）：`apps/agentcore/src/persistence/memory.ts` · `apps/agentcore/src/persistence/pg.ts` · `apps/agentcore/src/persistence/repos.ts` · `apps/agentcore/src/workflow/executor.ts` · `apps/frontend-shell/src/pages/admin/AgentsPage.tsx` · `apps/frontend-shell/test/agent-admin-console.test.tsx` · `docs/AUDIT-agent-console-gap.md` · `packages/contracts/src/qos.ts`

**8. `handoff-wo-metrics-authz`** `51d05f9d9a` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：清除测试文件里的裸 NUL 字节（git 曾把该文件判为 binary）
  - 提交题：DEPLOY.md 同步部署变更 + 修正 outbox.ts 注释错位
  - canonical **没有**这些文件（4）：`apps/agentcore/test/internal-endpoints-authz.test.ts` · `apps/datacore/test/action-metrics-tenant.seam.test.ts` · `apps/datacore/test/metrics-authz.seam.test.ts` · `apps/datacore/test/outbox-service-token.seam.test.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，8）：`DEPLOY.md` · `apps/agentcore/test/api.test.ts` · `apps/datacore/src/actions.ts` · `apps/datacore/src/metrics.ts` · `apps/datacore/src/outbox.ts` · `apps/datacore/test/action-metrics-endpoint.seam.test.ts` · `apps/datacore/test/ontology.test.ts` · `docker-compose.yml`

**9. `handoff-wo-org-world`** `972e14187a` · 2026-08-10 · canonical 日志提过：是
  - 提交题：WO-ORG-WORLD 交付说明：盘点/种子/接缝形状/四判据实测/变异反证/#139 规避/本体回写清单
  - 提交题：WO-ORG-WORLD 补在岗状态写面（代理链生产可达·此前只在测试里手改仓储驱动=接了线没数据）+ 守权测试
  - canonical **没有**这些文件（5）：`apps/datacore/migrations/030_org_world.sql` · `apps/datacore/src/org/routes.ts` · `apps/datacore/test/org-world.test.ts` · `docs/WO-ORG-WORLD-delivery.md` · `packages/contracts/src/org-world.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，4）：`apps/datacore/src/features.ts` · `apps/datacore/src/seed-cli.ts` · `apps/datacore/src/seed.ts` · `apps/datacore/src/server.ts`

**10. `handoff-diag-100q`** `55636f5d24` · 2026-07-19 · canonical 日志提过：**否**
  - 提交题：WO-DIAG-100Q: 28 题真测台账+原始数据+脚本
  - canonical **没有**这些文件（6）：`docs/DIAG-100Q-RESULTS-preview.md` · `docs/DIAG-100Q-RESULTS.md` · `docs/WO-DIAG100Q.md` · `scratchpad/diag100-results.json` · `scratchpad/diag100.pid` · `scratchpad/diag100.py`

**11. `handoff-wo-69-p2-function-signature`** `cea5f85dd7` · 2026-07-31 · canonical 日志提过：**否**
  - 提交题：feat(a6): WO-69 P2 · Function 本体签名——把「一刀切拒」收窄成「只拒真读到受限列的求解器」
  - 提交题：fix(a6): P1 兜底守卫——列级受限调用者拒绝求解器，堵死"算错数"（宁可少答，不许错答）
  - canonical **没有**这些文件（5）：`apps/datacore/src/solvers/ontology-signature.ts` · `apps/datacore/test/column-security.test.ts` · `apps/datacore/test/ontology-signature.recorder.ts` · `apps/datacore/test/ontology-signature.seam.test.ts` · `scripts/check-function-signature.mjs`
  - 改动未并入（canonical 自分叉起没动过这些文件，2）：`apps/datacore/src/authz.ts` · `apps/datacore/src/errors.ts`

**12. `handoff-wo-63-schema-readability`** `333ab6f3b3` · 2026-07-31 · canonical 日志提过：**否**
  - 提交题：fix(gate): H3 同源守恒改判「副本不得存在」——门此前红在自己的成果上
  - 提交题：Merge remote-tracking branch 'origin/claude/inspiring-gates-aqczjg' into claude/handoff-wo-63-schema-readability
  - canonical **没有**这些文件（5）：`apps/datacore/src/synthetic/ontology-readability.ts` · `apps/datacore/test/schema-readability-seam.test.ts` · `apps/frontend-shell/test/schema-readability-view.test.tsx` · `scripts/check-schema-readability.mjs` · `scripts/schema-readability-baseline.json`
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/datacore/src/ontology-governance.ts`

**13. `handoff-wo-approval-policy`** `6c40efed23` · 2026-08-10 · canonical 日志提过：是
  - 提交题：docs: 订正路由条数 9→10（实测 grep -c = 10）
  - 提交题：WO-APPROVAL-POLICY: 交付说明（盘点/正交性/合并口径/判据实测/变异反证/组织权限缺口/本体回写清单）
  - canonical **没有**这些文件（5）：`apps/datacore/migrations/030_approval_policy.sql` · `apps/datacore/src/approval-policy.ts` · `apps/datacore/test/approval-policy.test.ts` · `docs/WO-APPROVAL-POLICY-delivery.md` · `packages/contracts/src/approval-policy.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/datacore/src/features.ts`

**14. `handoff-wo-decision-info-fe`** `19e9db0db7` · 2026-08-07 · canonical 日志提过：是
  - 提交题：test+mock(WO-DECISION-INFO-FE): 决策三块 mock 口径照抄真后端 + 14 条链路红咬
  - 提交题：feat(WO-DECISION-INFO-FE): 决策三块接前端消费方 —— 影响面/不作为后果上风险卡 · 多方案代价上处置表 · 看板按 exposureOrder 排
  - canonical **没有**这些文件（5）：`apps/frontend-shell/src/views/risk/DispositionOptionsPanel.tsx` · `apps/frontend-shell/src/views/risk/DoNothingPanel.tsx` · `apps/frontend-shell/src/views/risk/ExposurePanel.tsx` · `apps/frontend-shell/src/views/risk/decisionInfoShared.tsx` · `apps/frontend-shell/test/decision-info-fe.test.tsx`

**15. `handoff-wo-decision-info-oncanonical`** `54e299cc1e` · 2026-08-07 · canonical 日志提过：是
  - 提交题：test+mock(WO-DECISION-INFO-FE): 决策三块 mock 口径照抄真后端 + 14 条链路红咬
  - 提交题：feat(WO-DECISION-INFO-FE): 决策三块接前端消费方 —— 影响面/不作为后果上风险卡 · 多方案代价上处置表 · 看板按 exposureOrder 排
  - canonical **没有**这些文件（5）：`apps/frontend-shell/src/views/risk/DispositionOptionsPanel.tsx` · `apps/frontend-shell/src/views/risk/DoNothingPanel.tsx` · `apps/frontend-shell/src/views/risk/ExposurePanel.tsx` · `apps/frontend-shell/src/views/risk/decisionInfoShared.tsx` · `apps/frontend-shell/test/decision-info-fe.test.tsx`

**16. `handoff-wo-quote-margin-customer`** `ad4407ee02` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：fix(#118): 堵最后一条静默回落 —— 点名的客户算不出真 BOM 时报 EMPTY_SCOPE，不拿通用 BOM 冒充
  - 提交题：docs(#118): §8 补登记残留 —— 种子无客户折扣维，同主力型号的两个客户毛利率必然相同
  - canonical **没有**这些文件（5）：`apps/datacore/test/quote-margin-customer.seam.test.ts` · `scripts/wo118-build.sh` · `scripts/wo118-gates.sh` · `scripts/wo118-test-agentcore.sh` · `scripts/wo118-test.sh`

**17. `handoff-wo-sandbox-a10`** `f4fb2abc5e` · 2026-08-08 · canonical 日志提过：是
  - 提交题：docs(a10): 消除文档内部矛盾（前文仍称本体已登记 G-SIM-EVENT-NOSUB）
  - 提交题：docs(a10): 纠正第二处 —— 本体里并没有 G-SIM-EVENT-NOSUB，回写是新建不是更新
  - canonical **没有**这些文件（5）：`docs/AUDIT-prd-reality-batch1.md` · `docs/AUDIT-prd-reality-batch2.md` · `docs/AUDIT-prd-reality-batch4.md` · `docs/AUDIT-sandbox-redesign-gap-2026-08-07.md` · `docs/PRD-sandbox-a10.md`

**18. `handoff-wo-slice-discovery`** `17e1e05fb1` · 2026-08-10 · canonical 日志提过：**否**
  - 提交题：WO-SLICE-DISCOVERY: 记账 CatalogClientItem 跨分支同名收敛 + 重造门自己瞎了
  - 提交题：WO-SLICE-DISCOVERY: 接缝驱动门（A 侧 7 例 + B 侧 5 例）+ 本体 §8 回写
  - canonical **没有**这些文件（4）：`apps/agentcore/test/dril-slice-discovery.seam.test.ts` · `apps/datacore/src/ontology/slice-args.ts` · `apps/datacore/src/ontology/slice-summary.ts` · `apps/datacore/test/slice-discovery.seam.test.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，3）：`apps/datacore/src/ontology-core.ts` · `apps/datacore/src/ontology/slice-layers.ts` · `packages/contracts/src/intelligence-resource.ts`

**19. `handoff-wo-66-rules-p1p2`** `7b92660a0a` · 2026-07-31 · canonical 日志提过：是
  - 提交题：feat(rules): WO-66 规则一等化 P1+P2 —— 阈值读规则唯一入口 + 求解器→规则绑定一等表（闭 G-10 死代码洞）
  - canonical **没有**这些文件（3）：`apps/datacore/migrations/028_solver_rule_bindings.sql` · `apps/datacore/src/solvers/rule-params.ts` · `apps/datacore/test/rules-first-class-seam.test.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，6）：`apps/datacore/src/solvers/opt-binding.ts` · `apps/datacore/src/solvers/sop-reschedule.ts` · `apps/datacore/test/ceo-data2-seam.test.ts` · `apps/datacore/test/decision-play.test.ts` · `apps/datacore/test/gap-attribution.test.ts` · `apps/datacore/test/helpers.ts`

**20. `handoff-wo-solver-scope-fe`** `7b52d4f2f2` · 2026-08-11 · canonical 日志提过：是
  - 提交题：WO-SOLVER-SCOPE-HONESTY-FE：补实测日期与复验命令（stale-claims 门当场逼出来的）
  - 提交题：WO-SOLVER-SCOPE-HONESTY-FE：订正注释里的 file:line 引用 + 记下刻意不接的第四种形状
  - canonical **没有**这些文件（4）：`apps/frontend-shell/src/components/ScopeHonestyBadge.module.css` · `apps/frontend-shell/src/components/ScopeHonestyBadge.tsx` · `apps/frontend-shell/src/lib/solverScopeHonesty.ts` · `apps/frontend-shell/test/solver-scope-honesty.seam.test.tsx`
  - 改动未并入（canonical 自分叉起没动过这些文件，2）：`apps/frontend-shell/src/mocks/simSolvers.ts` · `apps/frontend-shell/src/views/sim/ProjectSimView.tsx`

**21. `handoff-wo-hover-layer`** `0691a55aad` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：WO-HOVER-LAYER ⑤：口径出 title= 进 InfoPopover ×3 + 棘轮门（规范 §6 自己要求的那道门）
  - 提交题：WO-HOVER-LAYER ④：变异反证补洞 —— 判据从「有没有 position」改成「颜色写没写死」
  - 改动未并入（canonical 自分叉起没动过这些文件，15）：`apps/frontend-shell/src/components/GlobalSearch/GlobalSearch.module.css` · `apps/frontend-shell/src/components/Health/HealthBadge.module.css` · `apps/frontend-shell/src/components/QueryDock/Timeline.tsx` · `apps/frontend-shell/src/components/Risk/RiskPopover.tsx` · `apps/frontend-shell/src/components/ui/Modal.module.css` · `apps/frontend-shell/src/components/ui/Toasts.module.css` · `apps/frontend-shell/src/pages/LoginPage.module.css` · `apps/frontend-shell/src/pages/admin/LlmProvidersPage.tsx` · `apps/frontend-shell/src/pages/admin/ResourcesPage.tsx` · `apps/frontend-shell/src/pages/admin/ValidationPage.tsx` · `apps/frontend-shell/src/styles/tokens.css` · `apps/frontend-shell/src/views/DecisionPlayView.tsx` · `apps/frontend-shell/src/views/graph/MappingOverlay.module.css` · `apps/frontend-shell/src/views/plan/PlanViews.module.css` · `apps/frontend-shell/test/f23.order-chain.test.tsx`

**22. `handoff-wo-decision-graph`** `c931742ea4` · 2026-08-10 · canonical 日志提过：**否**
  - 提交题：WO-DECISION-GRAPH · 交付说明 + 清掉源码里一个字面 NUL 字节
  - 提交题：WO-DECISION-GRAPH · 亲手跑真链路撞出的断链修复 + 连通性自检写进返回体
  - canonical **没有**这些文件（4）：`apps/datacore/src/decision/causal-graph.ts` · `apps/datacore/test/decision-causal-graph.test.ts` · `docs/WO-DECISION-GRAPH-delivery.md` · `packages/contracts/src/causal-graph.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/datacore/src/features.ts`

**23. `handoff-wo-agentrun-attribution`** `c0b70d42e8` · 2026-08-10 · canonical 日志提过：**否**
  - 提交题：WO-AGENTRUN-ATTRIBUTION: 本体回写（铁律 0）+ 前任审计文档去过期
  - 提交题：WO-AGENTRUN-ATTRIBUTION: 前端接线「本 Agent 的运行」+ 诚实横幅降层不删除
  - canonical **没有**这些文件（2）：`apps/agentcore/migrations/012_agentrun_attribution.sql` · `apps/agentcore/test/agent-run-attribution.seam.test.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，7）：`apps/agentcore/src/persistence/memory.ts` · `apps/agentcore/src/persistence/pg.ts` · `apps/agentcore/src/persistence/repos.ts` · `apps/frontend-shell/src/pages/admin/AgentsPage.tsx` · `apps/frontend-shell/test/agent-admin-console.test.tsx` · `docs/AUDIT-agent-console-gap.md` · `packages/contracts/src/qos.ts`

**24. `handoff-prd-audit-b1`** `a2ff344553` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：docs(audit): 抢救落盘 PRD 对账 batch2/4 中间态（审核方隔离失误的产物）
  - 提交题：docs: PRD 实现状态对账 batch4 · 前 5 份（inference-dag/live-traceable/empty-guard/maturity/L2L3）
  - canonical **没有**这些文件（4）：`docs/AUDIT-prd-reality-batch1.md` · `docs/AUDIT-prd-reality-batch2.md` · `docs/AUDIT-prd-reality-batch4.md` · `docs/AUDIT-sandbox-redesign-gap-2026-08-07.md`

**25. `handoff-prd-audit-b2`** `5ef6503c9f` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：docs: PRD 对账 batch2 完成 22/22 + 汇总表 + 按投入产出排序的补做建议
  - 提交题：docs(audit): 抢救落盘 PRD 对账中间态（第二次·审核方隔离失误的持续后果）
  - canonical **没有**这些文件（4）：`docs/AUDIT-prd-reality-batch1.md` · `docs/AUDIT-prd-reality-batch2.md` · `docs/AUDIT-prd-reality-batch4.md` · `docs/AUDIT-sandbox-redesign-gap-2026-08-07.md`

**26. `handoff-wo-procurement-frontend`** `5c95027ebb` · 2026-08-06 · canonical 日志提过：**否**
  - 提交题：feat(WO-PROCUREMENT-FRONTEND): 采购四段腿分解接前端消费方（闭 G-PROCUREMENT-OPAQUE 前端半）
  - canonical **没有**这些文件（4）：`apps/frontend-shell/src/views/sim/ProcurementLegsView.module.css` · `apps/frontend-shell/src/views/sim/ProcurementLegsView.tsx` · `apps/frontend-shell/src/views/sim/procurementLegs.ts` · `apps/frontend-shell/test/procurement-legs-reachable.test.tsx`

**27. `handoff-wo-65-metrics`** `ef5e9fc898` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：docs(code): 把「假修」那条注释改成实测原文（两种坏法各是什么）
  - 提交题：fix(test): 补合成租户的审批人 + 用确定性探针序列替换弱断言
  - canonical **没有**这些文件（2）：`apps/agentcore/test/metrics-auth.test.ts` · `apps/datacore/test/metrics-tenant-and-auth.seam.test.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，5）：`apps/agentcore/test/api.test.ts` · `apps/datacore/src/metrics.ts` · `apps/datacore/test/action-metrics-endpoint.seam.test.ts` · `apps/datacore/test/action-type-evolution.test.ts` · `apps/datacore/test/ontology.test.ts`

**28. `handoff-wo-graph-desc-contract`** `fd88703bc0` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：fix(graph): 闭 G-GRAPH-ENTRY-DUP —— 「本体图谱」与「图谱·全景」渲染输出完全相同
  - 提交题：fix(graph): 闭 G-GRAPH-DESC-CONTRACT-SPLIT —— 八视角描述卡生产态一张都不渲染
  - canonical **没有**这些文件（2）：`apps/frontend-shell/test/fixtures/workspace-graph-views-live.json` · `apps/frontend-shell/test/graph-desc-contract.seam.test.tsx`
  - 改动未并入（canonical 自分叉起没动过这些文件，4）：`apps/datacore/src/synthetic/service.ts` · `apps/datacore/test/planviews.test.ts` · `apps/frontend-shell/src/views/OntologyGraphView.tsx` · `packages/contracts/src/planviews.ts`

**29. `handoff-wo-modeling-no-llm`** `e662d13119` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：WO-MODELING-NO-LLM: DEPLOY.md 补「不配 LLM 时哪些功能不可用 + 替代路」
  - 提交题：WO-MODELING-NO-LLM: 测试 —— 咬文案内容不咬"toast 被调用了"
  - canonical **没有**这些文件（2）：`apps/datacore/test/llm-not-configured.test.ts` · `apps/frontend-shell/test/modeling-no-llm-provider.test.tsx`
  - 改动未并入（canonical 自分叉起没动过这些文件，4）：`DEPLOY.md` · `apps/datacore/src/llm.ts` · `apps/datacore/src/llmproviders.ts` · `apps/frontend-shell/src/pages/admin/ModelingPage.tsx`

**30. `handoff-wo-slice-ref-producer`** `5ebc6cf2f0` · 2026-08-10 · canonical 日志提过：是
  - 提交题：docs: 回写本体与审计 —— G-SLICE-REF-PRODUCER-EMPTY 闭环并更正定性
  - 提交题：test(seam): 切片引用上报双侧接缝 + ①业务场景层 absent→present 翻转断言
  - canonical **没有**这些文件（2）：`apps/agentcore/test/slice-ref-producer.seam.test.ts` · `apps/datacore/test/slice-ref-producer-seam.test.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，4）：`apps/agentcore/src/catalog/service.ts` · `apps/agentcore/src/refs/report.ts` · `apps/datacore/src/ontology/slice-layers.ts` · `packages/contracts/src/refs.ts`

**31. `handoff-wo-a6-contention`** `9a54d5daa1` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：merge: canonical d3bf55d5 并入 WO-A6 分支（chain-sim.ts 加性冲突，两字段并存）
  - 提交题：wip: 被中途叫停瞬间的工作现场 —— **未完成·未验证**，仅为防丢落盘
  - canonical **没有**这些文件（1）：`apps/datacore/test/a6-cross-segment-contention.seam.test.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，7）：`apps/datacore/src/solvers/chain-impediment.ts` · `apps/datacore/src/solvers/decision-info.ts` · `apps/datacore/src/solvers/impediment-options.ts` · `apps/datacore/src/solvers/service.ts` · `apps/datacore/src/synthetic/battery.ts` · `apps/datacore/test/chain-impediment-seam.test.ts` · `packages/contracts/src/chain-sim.ts`

**32. `handoff-wo-argname-and-units`** `09d6275f5d` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：fix(#103): 键名判据收紧两头 —— 变体要认、形似判据不许过宽（**测试自己抓出来的**）
  - 提交题：fix(ontology-anchors): 本次改动带出的锚点漂移逐条校准（门自己抓出来的，不是我先想到的）
  - canonical **没有**这些文件（3）：`apps/datacore/test/argname-scope-fidelity.seam.test.ts` · `packages/contracts/src/solver-units.ts` · `scripts/check-output-units.mjs`

**33. `handoff-wo-befe-seam-field`** `763c0d1b77` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：feat(gates): solver-field-seam 自曝「单一来源自己不穷尽」这处盲区（+catchall 探测金丝雀）
  - 提交题：chore(gates): solver-field-seam 接进交付链 + 门账 + 本体 §7/§8 登记
  - canonical **没有**这些文件（3）：`scripts/check-solver-field-seam.mjs` · `scripts/lib/seam-lex.mjs` · `scripts/solver-field-seam-baseline.json`

**34. `handoff-wo-gate-selftest`** `2083bf9aac` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：chore(gate): mock-fidelity 接进 gates 链 + 门账 + 本体 §7/§8 回写；订正 crossbranch 门账的假记录
  - 提交题：feat(gate): mock 谎报门 mock-fidelity:check（欠账 #190 · 铁律 0.6 第 2 级处置）
  - canonical **没有**这些文件（3）：`scripts/check-mock-fidelity.mjs` · `scripts/lib/source-lex.mjs` · `scripts/mock-fidelity-baseline.json`

**35. `handoff-wo-leadtime-split`** `ee6a5800dd` · 2026-08-10 · canonical 日志提过：**否**
  - 提交题：WO-LEADTIME-SPLIT 交付说明：混算取证 / 改前改后 / 双断言实测 / M1+M2 变异反证 / 本体回写清单
  - 提交题：WO-LEADTIME-SPLIT：fixture provenance counts 对齐活跑 + formatPct 断言与数据解耦
  - canonical **没有**这些文件（2）：`apps/datacore/test/leadtime-split.seam.test.ts` · `docs/WO-LEADTIME-SPLIT-delivery.md`
  - 改动未并入（canonical 自分叉起没动过这些文件，3）：`apps/datacore/test/chain-loss-attribution.test.ts` · `apps/frontend-shell/src/views/sim/InspectorNodePanel.tsx` · `apps/frontend-shell/test/fixtures/chain-loss-real.json`

**36. `handoff-wo-adopt-decision-play`** `eefaabfc20` · 2026-08-10 · canonical 日志提过：**否**
  - 提交题：WO-ADOPT-DECISION-PLAY: 交付说明（盘点 / 新动作 / 三条效果层断言 / 三个变异反证 / 门输出 / 本体回写清单）
  - 提交题：WO-ADOPT-DECISION-PLAY: AdoptedDecisionPlay 归入 decision_cockpit 数据类目（守 uncategorizedTypes==[]）
  - canonical **没有**这些文件（2）：`apps/datacore/test/action-adopt-decision-play.seam.test.ts` · `docs/WO-ADOPT-DECISION-PLAY-delivery.md`
  - 改动未并入（canonical 自分叉起没动过这些文件，2）：`apps/datacore/src/solvers/types.ts` · `apps/datacore/src/synthetic/data-categories.ts`

**37. `handoff-wo-decision-info-frontend2`** `8e77af09c1` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：docs(ontology): 回归证据改写为实测三段（争用超时 ≠ 回归，但也不许当绿用）
  - 提交题：docs(ontology): §3/§8 回写 —— 单源「三处」更正为四处 + 6 次变异反证实测原文
  - canonical **没有**这些文件（2）：`apps/frontend-shell/src/views/DecisionInfoPanel.tsx` · `apps/frontend-shell/test/decision-info-reachable.test.tsx`
  - 改动未并入（canonical 自分叉起没动过这些文件，2）：`apps/frontend-shell/src/views/BaseOutlookPanel.tsx` · `apps/frontend-shell/src/views/DispositionDetailPanel.tsx`

**38. `handoff-wo-rules-dsl-family`** `8a5e6e93d3` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：fix(test): 反向闸把老测试里的分叉写法逼了出来 —— 四例改回引用式
  - 提交题：docs(ontology): 回写 §7/§8 —— 一条断点结案、一条新登记，并修掉过期的自述
  - canonical **没有**这些文件（1）：`scripts/check-rule-parity.mjs`
  - 改动未并入（canonical 自分叉起没动过这些文件，5）：`apps/datacore/src/rules.ts` · `apps/datacore/test/rules-param-binding.test.ts` · `apps/frontend-shell/test/rules-expr-params.seam.test.tsx` · `packages/contracts/src/base-registry.ts` · `packages/contracts/src/datacore.ts`

**39. `handoff-sandbox-action-propagation`** `b8db35b575` · 2026-07-18 · canonical 日志提过：是
  - 提交题：feat(sim): 沙盘 action→stateVar 传导闭环——决策落 Action 真传导到下游(闭 G-11 动作维·兑现 entering.kind=ACTION)
  - canonical **没有**这些文件（2）：`apps/datacore/migrations/028_sim_action_propagation_rule.sql` · `apps/datacore/test/sim-action-propagation.test.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/datacore/test/sim-propagation.test.ts`

**40. `handoff-wo-decision-info-frontend`** `18f10d4015` · 2026-08-06 · canonical 日志提过：**否**
  - 提交题：autosave(claude/handoff-wo-decision-info-frontend): 08-06 16:50:15 容器重启防丢快照
  - 提交题：autosave(claude/handoff-wo-decision-info-frontend): 08-06 16:46:06 容器重启防丢快照
  - canonical **没有**这些文件（2）：`apps/frontend-shell/src/views/DecisionInfoPanel.tsx` · `apps/frontend-shell/test/decision-info-reachable.test.tsx`
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/frontend-shell/src/views/DispositionDetailPanel.tsx`

**41. `handoff-wo-prd-grounding-gate`** `9ecd52ea87` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：WO-PRD-GROUNDING-GATE: 门账补 M3/M4 变异证据 + 判义边界 + seed.ts 责任路径
  - 提交题：WO-PRD-GROUNDING-GATE: 判义在前(四义词) + 裁定表 + 订正被两轮口径骗过的统计数
  - canonical **没有**这些文件（2）：`scripts/check-prd-data-grounding.mjs` · `scripts/prd-data-grounding-baseline.json`
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`docs/_PRD-TEMPLATE.md`

**42. `handoff-wo-scope-honesty-fe`** `0ae2df51c4` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：WO-SCOPE-HONESTY-FE 亲手真跑: mock 库存调到真会缺料的水位（第一版屏上永远「缺料 0 张」）
  - 提交题：WO-SCOPE-HONESTY-FE ⑦: 本体回写（§3 新链路 + §8 三条断点状态）+ 修正被自己咬出来的一个错数
  - canonical **没有**这些文件（2）：`apps/frontend-shell/src/views/ScopeHonesty.tsx` · `apps/frontend-shell/test/scope-honesty-fe.seam.test.tsx`
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/frontend-shell/src/views/plan/OrderChainView.tsx`

**43. `handoff-metric-aware-seam`** `b2c3a1e590` · 2026-07-18 · canonical 日志提过：**否**
  - 提交题：fix(seam): WO-METRIC-AWARE-SEAM-CLOSE 关掉 metric-aware 因果域接缝（数据×引擎一套机制）
  - 提交题：merge: WO-CEO-DATA-2 data (因果域根/每指标边/9下钻类型/生成器) 并入 canonical
  - canonical **没有**这些文件（2）：`apps/datacore/test/metric-aware-composition.test.ts` · `docs/WO-METRIC-AWARE-SEAM-CLOSE-DONE.md`

**44. `handoff-ontology-context`** `93913c2e8e` · 2026-07-23 · canonical 日志提过：是
  - 提交题：feat(ontology-context): 本体口径/语义投影地基（问句→相关类型/求解器/口径 context bundle·导航切片/语义查询/A门共同前置）
  - canonical **没有**这些文件（2）：`apps/agentcore/src/mocks/type-semantics-fixture.ts` · `apps/datacore/src/ontology/type-semantics.ts`

**45. `handoff-wo-coverage-blind`** `fe93efbb2c` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：feat(gate): 覆盖率盲区门接线 + 棘轮建账 217 条 + 本体回写 §7/§8
  - 提交题：feat(gate): 覆盖率盲区门 check-coverage-blind.mjs（假绿第 12 形态 · 四检测器 + 金丝雀）
  - canonical **没有**这些文件（2）：`scripts/check-coverage-blind.mjs` · `scripts/coverage-blind-baseline.json`

**46. `handoff-wo-multi-intent-p1`** `f4fa91b6f3` · 2026-07-26 · canonical 日志提过：是
  - 提交题：feat(qos): 跨域/多意图并行编排 L1 独立多意图（WO-MULTI-INTENT-P1·暗发）
  - canonical **没有**这些文件（2）：`apps/agentcore/src/router/multi-intent.ts` · `apps/agentcore/test/multi-intent-seam.test.ts`

**47. `handoff-wo-sandbox-prop-direction`** `4aabd4bc27` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：docs(ontology): 回写传导方向硬约束 + 新登记断点 G-PROP-DIRECTION-SILENT-DEAD（闭 #158/#160）
  - 提交题：fix(mocks): #160 前端 mock line_belongs_to_base 方向反转 Line→Base ⇒ Base→Line + 机械门
  - canonical **没有**这些文件（2）：`apps/datacore/test/mock-linktype-direction.gate.test.ts` · `apps/datacore/test/sim-propagation-direction.seam.test.ts`

**48. `handoff-wo-sim-checkpoints`** `32f817d805` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：test(datacore): 把 ② 的注释改成变异反证实测原文（[2,8,2]），免得注释与证据不符
  - 提交题：docs: 欠账 #157 判定书 —— 真服务实测 + 变异反证 + 接缝门假阴性
  - canonical **没有**这些文件（2）：`apps/datacore/test/sim-checkpoint-list.seam.test.ts` · `docs/AUDIT-sim-checkpoints.md`

**49. `handoff-plankpi-mq`** `9c1716521a` · 2026-07-18 · canonical 日志提过：**否**
  - 提交题：feat(plankpi): WO-PLANKPI-MONTH-QUARTER 月/季 PlanKpi 真对象化（闭 DS.1 假下钻残口）
  - canonical **没有**这些文件（1）：`apps/datacore/test/plankpi-month-quarter.test.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，3）：`apps/datacore/test/cockpit-rootcause.test.ts` · `apps/datacore/test/plan-drill-levels.test.ts` · `apps/datacore/test/spine.test.ts`

**50. `handoff-wo-69-ontology-primitives`** `d0396227c4` · 2026-07-31 · canonical 日志提过：**否**
  - 提交题：fix(a6): P1 兜底守卫——列级受限调用者拒绝求解器，堵死"算错数"（宁可少答，不许错答）
  - 提交题：feat(a6): WO-69 P1 列级（属性级）Security — 读投影剔除键 + 写门 PROPERTY_FORBIDDEN + 求解器上下文同约束
  - canonical **没有**这些文件（1）：`apps/datacore/test/column-security.test.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，2）：`apps/datacore/src/authz.ts` · `apps/datacore/src/errors.ts`

**51. `handoff-wo-order-row-detail`** `e9f810f956` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：fix(order-chain): 缺数披露文案里的 ** 字面泄漏到界面
  - 提交题：test(order-chain): 接缝驱动测试 —— 相对位置 / 逐字节值 / 诚实态反向用例
  - canonical **没有**这些文件（1）：`apps/frontend-shell/test/order-row-detail.seam.test.tsx`
  - 改动未并入（canonical 自分叉起没动过这些文件，2）：`apps/frontend-shell/src/views/plan/OrderChainView.tsx` · `apps/frontend-shell/test/f23.order-chain.test.tsx`

**52. `handoff-wo-ot-instance-reach`** `7bf51807cb` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：WO-OT-INSTANCE-REACH ② 标注所闭断点 G-OT-INSTANCE-PANEL-OFFSCREEN + 记录选型理由
  - 提交题：WO-OT-INSTANCE-REACH ① 「看实例」详情改行内展开 + 禁用态说明理由
  - canonical **没有**这些文件（1）：`apps/frontend-shell/src/pages/admin/ObjectTypesBrowserPage.module.css`
  - 改动未并入（canonical 自分叉起没动过这些文件，2）：`apps/frontend-shell/src/pages/admin/ObjectTypesBrowserPage.tsx` · `apps/frontend-shell/test/f57.object-types-browser.test.tsx`

**53. `handoff-wo-sandbox-candidates-fe`** `d6d4d550ad` · 2026-08-11 · canonical 日志提过：是
  - 提交题：WO-SANDBOX-CANDIDATES-FE ⑦ stale-claims 门报红：4 处「自称实测」补日期+出处+复验，并改掉一处错引
  - 提交题：WO-SANDBOX-CANDIDATES-FE ⑥ 本体回写（铁律 0）：链路新增消费端
  - canonical **没有**这些文件（1）：`apps/frontend-shell/test/sandbox-candidates.seam.test.tsx`
  - 改动未并入（canonical 自分叉起没动过这些文件，2）：`apps/frontend-shell/src/mocks/simSolvers.ts` · `apps/frontend-shell/src/views/sim/chainImpediment.ts`

**54. `handoff-ceo6`** `873eebc1a4` · 2026-07-17 · canonical 日志提过：是
  - 提交题：feat(agentcore): WO-CEO-6 CEO agent（确定性·无 LLM）+ PageContext 深问兜底路由 + C1/C5/C7 测试 + 本体回写
  - canonical **没有**这些文件（1）：`apps/agentcore/src/agent/ceo.ts`
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/agentcore/test/ceo-agent-context.test.ts`

**55. `handoff-wo-agentpath-hint-truth`** `8a4dfffc45` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：fix(frontend): Agent 运行观测空态改说真前置（WO-AGENTPATH-HINT-TRUTH）
  - canonical **没有**这些文件（1）：`apps/frontend-shell/test/agentpath-hint-truth.test.tsx`
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/frontend-shell/src/pages/admin/AgentsPage.tsx`

**56. `handoff-causal-deepchain`** `a14dea7e4b` · 2026-07-18 · canonical 日志提过：**否**
  - 提交题：feat(causal): WO-CAUSAL-DOMAIN-DEEPCHAIN OEE 因果深链 + 多种子 BFS（补利用率瓶颈下钻断头）
  - canonical **没有**这些文件（1）：`apps/datacore/test/causal-deepchain.test.ts`

**57. `handoff-geo-real-signal`** `ff780e8443` · 2026-07-18 · canonical 日志提过：**否**
  - 提交题：feat(provenance): WO-GEO-REAL-SIGNAL 地缘/矿价 provenanceSynthetic 真源派生（闭 G-DM-1）
  - canonical **没有**这些文件（1）：`apps/datacore/test/geo-real-signal.test.ts`

**58. `handoff-metric-aware-gap`** `ce726e51bc` · 2026-07-17 · canonical 日志提过：是
  - 提交题：fix(datacore): gap_attribution 真 metric-aware——拆硬编码 BFS 起点 + 终点门禁认绑定（C1+C2）
  - canonical **没有**这些文件（1）：`apps/datacore/test/gap-attribution-metric-aware.test.ts`

**59. `handoff-onto-writeback-p1`** `e17385d0f9` · 2026-08-10 · canonical 日志提过：**否**
  - 提交题：feat(gate): dark-launch:check —— 守「写了 defaultOn:false 就以为暗发了」（0.6 二级处置）
  - 提交题：docs(ontology): 回写 WO-P1 的 3 条对象边 + 10 条传导规则 + 2 条新断点（铁律 0 补欠）
  - canonical **没有**这些文件（1）：`scripts/dark-launch-baseline.json`

**60. `handoff-prd-audit-b3`** `ddac597c02` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：docs(audit): PRD 对账第3批 · 21-22/22 + 汇总表 + 按投入产出排序的补做建议（完结）
  - 提交题：docs(audit): PRD 对账第3批 · 16-20/22（generic-inference/gslive/global-sim/spine/handbook）
  - canonical **没有**这些文件（1）：`docs/AUDIT-prd-reality-batch3.md`

**61. `handoff-prd-audit-b4`** `dd3e87f9a5` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：docs: PRD 对账 batch4 · 16-22 + 汇总表 + 按投产比排序的补做建议（全 22 份完）
  - 提交题：docs: PRD 对账 batch4 · 11-15（field-coverage/opt-whatif/order/plan-audit/plan-generate）
  - canonical **没有**这些文件（1）：`docs/AUDIT-prd-reality-batch4.md`

**62. `handoff-prd-audit-b5`** `cb494eb02b` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：docs(audit-b5): 16-19/19 + 汇总表 + 按投入产出排序的补做建议（第5批完成）
  - 提交题：docs(audit-b5): 11-15/19（skill 审查/治理/迁移/运行时 + sop 1:1）
  - canonical **没有**这些文件（1）：`docs/AUDIT-prd-reality-batch5.md`

**63. `handoff-prd-coverage-full`** `2cdc882d7d` · 2026-08-09 · canonical 日志提过：**否**
  - 提交题：docs(audit): §5.1 补金丝雀证据（否定结论必须配已知必中样例）
  - 提交题：docs(audit): 全部 147 份 PRD 的写了没做/做了没验 100% 对账
  - canonical **没有**这些文件（1）：`docs/AUDIT-prd-coverage-full-2026-08-09.md`

**64. `handoff-qos-live-evidence`** `69543dffce` · 2026-07-24 · canonical 日志提过：**否**
  - 提交题：docs(qos): 真 Kimi 10 题 live 复测验收日志（一次性证据·非 CI）
  - canonical **没有**这些文件（1）：`docs/acceptance-log-qos-live-10q.md`

**65. `handoff-sandbox-a10-audit`** `317f37e8d3` · 2026-08-08 · canonical 日志提过：**否**
  - 提交题：docs(audit): 补验 ChainImpedimentView 取数方式 —— 未验项 C.3 结清，估时收窄
  - 提交题：docs(audit): WO-SANDBOX-A10-EVENTS-AUDIT · sim.*/chain.* 事件全量台账 + A10 判定
  - canonical **没有**这些文件（1）：`docs/AUDIT-sandbox-events-a10.md`

**66. `handoff-sandbox-a6-audit`** `bcce7269ca` · 2026-08-08 · canonical 日志提过：**否**
  - 提交题：docs(audit): A6 补两条实测 —— seed 42 真有跨 seg 争用，但与阻滞点面交集为空（annotate 形态会恒空）
  - 提交题：docs(audit): WO-SANDBOX-A6-SEG-AUDIT 沙盘业务线维度取证 —— 三个断点不是一个，只修 400 会更糟
  - canonical **没有**这些文件（1）：`docs/AUDIT-sandbox-a6-businesstypes.md`

**67. `handoff-sandbox-field-inventory`** `db976009b7` · 2026-08-08 · canonical 日志提过：**否**
  - 提交题：docs: 修正会话族 E 的字段账（自查发现三处错误）
  - 提交题：docs: 沙盘后端可展示字段全台账（WO-SANDBOX-BACKEND-FIELD-INVENTORY）
  - canonical **没有**这些文件（1）：`docs/INVENTORY-sandbox-backend-fields.md`

**68. `handoff-sandbox-gap-audit`** `ec5cbbc4e7` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：docs(audit): 沙盘重设计 PRD 实现缺口对账 —— 头条=4 个新视图零入口（BUILTIN_VIEWS 未登记）
  - canonical **没有**这些文件（1）：`docs/AUDIT-sandbox-redesign-gap-2026-08-07.md`

**69. `handoff-skill-migration-scope`** `6cddca17f7` · 2026-08-09 · canonical 日志提过：**否**
  - 提交题：docs(wo): WO-SUITE-skill-migration — 把迁移 PRD 拆成 5 张可派发 WO + 今日起点三分法定性
  - canonical **没有**这些文件（1）：`docs/WO-SUITE-skill-migration.md`

**70. `handoff-tier2-semantic-discover-v2`** `1ad5073854` · 2026-07-19 · canonical 日志提过：**否**
  - 提交题：feat(tier2-discover): B/C 决策域求解器语义可发现 + ceo-route B/C 意图直绑（闭 G-SEMANTIC-DISCOVER）
  - canonical **没有**这些文件（1）：`apps/agentcore/test/tier2-bc-route.test.ts`

**71. `handoff-wo-0-nl-wiring`** `b5e53261a2` · 2026-07-25 · canonical 日志提过：是
  - 提交题：fix(qos): WO-0-NL-WIRING 补 SEAM 门残口——path-B 无可用 LLM 转诚实降级（非 raw INTERNAL_ERROR）
  - 提交题：fix(qos): WO-0-NL-WIRING 分类器接 LLM + 确定性兜底（急救·闭 classifier→path-B 洪泛）
  - canonical **没有**这些文件（1）：`apps/agentcore/test/qos-nl-wiring-seam.test.ts`

**72. `handoff-wo-66-rules-first-class`** `c05137e41c` · 2026-07-30 · canonical 日志提过：**否**
  - 提交题：docs(WO-66 P0): 求解器阈值台账普查（solvers/** 21 文件全量·仅文档不改代码）
  - canonical **没有**这些文件（1）：`docs/rule-threshold-ledger.md`

**73. `handoff-wo-a10-events`** `89370e3aba` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：docs(audit): 收紧 §5.3 —— 门与 vitest 两条通道都查，提及≠读取逐个点开
  - 提交题：docs(audit): sim.* 事件消费方全量台账 —— 推翻「零消费方」前提（实测 5/6 已接）
  - canonical **没有**这些文件（1）：`docs/AUDIT-sim-events-consumers.md`

**74. `handoff-wo-a6-rule-scan`** `844267f2dd` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：docs(audit): C01–C33 逐条核完 —— 「保谁」有承载(C15·已验活)、「有争用」无承载但非结构性死路
  - canonical **没有**这些文件（1）：`docs/AUDIT-a6-rule-carriers.md`

**75. `handoff-wo-a6-seg`** `2f54e84d06` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：docs(audit): A6 跨 seg 复验 —— 定性「诚实的未实现」，且本体里有第二套业务线词表
  - canonical **没有**这些文件（1）：`docs/AUDIT-sandbox-cross-seg.md`

**76. `handoff-wo-changeover-key`** `ff9ebf546b` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：wip: 额度用尽被叫停瞬间的现场 —— 未完成·未验证，仅为防丢落盘。接手前必须从头补齐双向变异反证。
  - canonical **没有**这些文件（1）：`apps/datacore/test/zz-probe-changeover.test.ts`

**77. `handoff-wo-delta-compare`** `4430958868` · 2026-08-09 · canonical 日志提过：**否**
  - 提交题：WO-DELTA-COMPARE ①契约：WorldDelta 七维差异（诚实缺席类型层不可绕过）
  - canonical **没有**这些文件（1）：`packages/contracts/src/world-delta.ts`

**78. `handoff-wo-disposition-inline-row`** `115fe884f2` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：WO-DISPOSITION-INLINE-ROW ② 接缝驱动测试：咬「详情在第 k 行与第 k+1 行之间」
  - 提交题：WO-DISPOSITION-INLINE-ROW ① 处置详情改为行内展开（挂到被点那一行下面）
  - canonical **没有**这些文件（1）：`apps/frontend-shell/test/disposition-inline-row.seam.test.tsx`

**79. `handoff-wo-e2e-dialogue-acceptance`** `a05e52d9f6` · 2026-07-25 · canonical 日志提过：是
  - 提交题：test(e2e): 全链对话验收门 capstone — S1~S7 接缝串真问句（诚实绿·非假绿·WO-E2E-DIALOGUE-ACCEPTANCE)
  - 提交题：feat(growth): 数据构建引擎升级为诊断+补齐 harness — NO_INTENT 自补 + EMPTY_DATA 时序接地 (WO-DATABUILDER-HARNESS)
  - canonical **没有**这些文件（1）：`apps/agentcore/test/e2e-dialogue-acceptance.test.ts`

**80. `handoff-wo-gray-node-autofill`** `ca9d6ff040` · 2026-07-25 · canonical 日志提过：是
  - 提交题：feat(risk): 产能推演灰节点从"诚实灰终点"变"自动补齐起点" — 前端触发+据引擎 SOFT/HARD 重渲染 (WO-GRAY-NODE-AUTOFILL)
  - 提交题：feat(growth): 数据构建引擎升级为诊断+补齐 harness — NO_INTENT 自补 + EMPTY_DATA 时序接地 (WO-DATABUILDER-HARNESS)
  - canonical **没有**这些文件（1）：`apps/frontend-shell/test/gray-node-autofill-seam.test.tsx`

**81. `handoff-wo-metrics-audit`** `a4cea8edb3` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：docs: AUDIT-metrics-tenant-authz — /metrics 鉴权与租户隔离审计（欠账 #65）
  - canonical **没有**这些文件（1）：`docs/AUDIT-metrics-tenant-authz.md`

**82. `handoff-wo-modeling-interactive`** `92ac7ce51b` · 2026-08-06 · canonical 日志提过：是
  - 提交题：autosave(claude/handoff-wo-modeling-interactive): 08-06 05:43:43 容器重启防丢快照
  - canonical **没有**这些文件（1）：`apps/datacore/test/modeling-provenance.test.ts`

**83. `handoff-wo-multiintent-l2`** `37003a4179` · 2026-07-26 · canonical 日志提过：**否**
  - 提交题：feat(qos): L2 真分解——LLM 产 solver 计划·确定性校验·接共享后半（PRD-multi-intent-L2L3 P1）
  - 提交题：feat(qos): 跨域编排统一——② 先于 Coordinator + ⑤ 多意图兜底共享确定性后半（WO-QOS-CROSS-DOMAIN-UNIFIED）
  - canonical **没有**这些文件（1）：`apps/agentcore/src/router/multi-intent.ts`

**84. `handoff-wo-multiintent-l3`** `6307959159` · 2026-07-26 · canonical 日志提过：**否**
  - 提交题：feat(qos): L3 耦合联合求解——耦合链映射一次 portfolio 守恒解·真传导（PRD-multi-intent-L2L3 P2）
  - 提交题：feat(qos): L2 真分解——LLM 产 solver 计划·确定性校验·接共享后半（PRD-multi-intent-L2L3 P1）
  - canonical **没有**这些文件（1）：`apps/agentcore/src/router/multi-intent.ts`

**85. `handoff-wo-nl-robust`** `fd01770a0e` · 2026-08-06 · canonical 日志提过：**否**
  - 提交题：autosave(claude/handoff-wo-nl-robust): 08-06 05:43:43 容器重启防丢快照
  - 提交题：feat(agentcore/qos): WO-NL-ROBUST 查询对话 LLM 通不通都能答（自由问句确定性优先 + path-B 失败降级/失因暴露）
  - canonical **没有**这些文件（1）：`apps/agentcore/test/qos-nl-robust.test.ts`

**86. `handoff-wo-ontology-ia`** `97ad494d76` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：docs(ontology): §8 登记本体域 IA 四条断点（铁律 0 回写）
  - 提交题：docs(WO-ONTOLOGY-IA): 本体域 18 入口 IA 审计 + 4 条断点取证
  - canonical **没有**这些文件（1）：`docs/AUDIT-ontology-entries-IA.md`

**87. `handoff-wo-pipeline-ui`** `b5e1b6c7a5` · 2026-08-13 · canonical 日志提过：是
  - 提交题：test(fe): WO-1 件一 · pipeline 配置面×放行面驱动接缝测试 + 幽灵令牌清零
  - 提交题：feat(fe): WO-1 件一 · databuilder pipeline 配置面 + PAUSED 人工放行入口（前端接线）
  - canonical **没有**这些文件（1）：`apps/frontend-shell/src/pages/admin/BuildPipelinesPage.tsx`

**88. `handoff-wo-prd-field-audit`** `8ed7727b6f` · 2026-08-11 · canonical 日志提过：**否**
  - 提交题：docs(audit): 补 §6.3 —— 规则作用域命名漂移（追「未判定」多追一层的产出）
  - 提交题：docs(audit): PRD 字段级引用落地性存量清单（运行态实测 · 四档）
  - canonical **没有**这些文件（1）：`docs/AUDIT-prd-field-grounding.md`

**89. `handoff-wo-qos-cross-domain-unified-graw0b`** `f0c7df24f7` · 2026-07-26 · canonical 日志提过：**否**
  - 提交题：feat(qos): 跨域编排统一——② 先于 Coordinator + ⑤ 多意图兜底共享确定性后半（WO-QOS-CROSS-DOMAIN-UNIFIED）
  - 提交题：feat(qos): 确定性跨域分路（把跨域题留在确定性层·零 LLM 拉回 path-A）
  - canonical **没有**这些文件（1）：`apps/agentcore/src/router/multi-intent.ts`

**90. `handoff-wo-82-peak-crossday`** `01f8b799da` · 2026-08-07 · canonical 日志提过：**否**
  - 提交题：docs(datacore): 两处 withAdoptions 注释去掉写死的"两个求解器"（#82 起集合已含 affected_orders）
  - 提交题：docs(ontology): #82 回写 §8 —— 新登记 G-RISK-PEAK-TWO-SOURCES（已闭）
  - 改动未并入（canonical 自分叉起没动过这些文件，2）：`apps/datacore/test/adversary-adopt-mitigation.test.ts` · `docs/TEST-PLAYBOOK.md`

**91. `handoff-wo-82`** `c971b9763e` · 2026-08-03 · canonical 日志提过：是
  - 提交题：fix(datacore): #82 风险峰值/越线日单一出处 —— 订单全链聚合改为 risk_timeline 的派生投影
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/datacore/test/adversary-adopt-mitigation.test.ts`

**92. `handoff-wo-phase1-d-a`** `a0363f26ef` · 2026-07-22 · canonical 日志提过：**否**
  - 提交题：ci(datacore): serial test files (fileParallelism:false) to honor 'no concurrent vitest' rule
  - 提交题：ci(datacore): extend vitest timeout to 300s to absorb slow-workstation parallel load
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/datacore/vitest.config.ts`

**93. `rescue-r13-drillfield-0811`** `f9b0c0ec46` · 2026-08-06 · canonical 日志提过：是
  - 提交题：autosave(claude/handoff-wo-r13-drillfield): 08-06 16:50:15 容器重启防丢快照
  - 提交题：autosave(claude/handoff-wo-r13-drillfield): 08-06 16:33:44 容器重启防丢快照
  - 改动未并入（canonical 自分叉起没动过这些文件，1）：`apps/datacore/test/prov-drillfield-truth.test.ts`

---

## §5 · 已过期（118 条）—— 可删

判据：无整文件缺口、无干净未并改动，只剩 canonical 已独立改写的文件，**且 canonical 日志确实提过本单**（118/118 全部有佐证）。

| 分支 | 领先 | 独有文件 | 逐字节已在 | 行级已在 | canonical 已改写 | 最后提交 |
|---|---|---|---|---|---|---|
| `handoff-wo-route-nav` | 31 | 47 | 25 | 13 | 8 | 2026-08-08 |
| `handoff-wo-opt-whatif-data` | 29 | 44 | 21 | 15 | 7 | 2026-08-08 |
| `handoff-wo-transit-wire` | 28 | 45 | 24 | 13 | 7 | 2026-08-08 |
| `handoff-wo-sim-scope-local` | 27 | 52 | 22 | 19 | 8 | 2026-08-08 |
| `handoff-wo-demo-lightup-2` | 26 | 41 | 24 | 13 | 3 | 2026-08-08 |
| `handoff-wo-lever-binding` | 26 | 45 | 21 | 16 | 7 | 2026-08-08 |
| `handoff-wo-semantics-singlesource` | 26 | 44 | 22 | 15 | 6 | 2026-08-08 |
| `handoff-wo-zombie-audit` | 26 | 42 | 21 | 14 | 6 | 2026-08-08 |
| `handoff-wo-hardcoded-absence` | 25 | 43 | 21 | 13 | 8 | 2026-08-08 |
| `handoff-wo-console-cleanup` | 21 | 37 | 19 | 14 | 3 | 2026-08-08 |
| `handoff-wo-nav-gate` | 21 | 41 | 19 | 15 | 6 | 2026-08-08 |
| `handoff-wo-levers-rootcause` | 19 | 35 | 19 | 12 | 3 | 2026-08-08 |
| `handoff-fix-imp2plan-seam` | 14 | 23 | 4 | 13 | 5 | 2026-08-09 |
| `handoff-wo-opt-whatif-close` | 12 | 10 | 4 | 4 | 2 | 2026-08-08 |
| `handoff-wo-sandbox-console` | 12 | 26 | 5 | 13 | 7 | 2026-08-07 |
| `handoff-cross-object-multiobj` | 6 | 31 | 9 | 12 | 10 | 2026-07-19 |
| `handoff-wo-sandbox-a2` | 6 | 7 | 4 | 2 | 1 | 2026-08-08 |
| `handoff-orderline-atpbase` | 5 | 18 | 8 | 5 | 5 | 2026-07-19 |
| `handoff-wo-decision-info` | 5 | 12 | 4 | 5 | 3 | 2026-08-05 |
| `handoff-wo-fix-dark-launch-gate` | 5 | 6 | 2 | 3 | 1 | 2026-08-10 |
| `handoff-atp-promise` | 4 | 16 | 6 | 4 | 6 | 2026-07-18 |
| `handoff-qos` | 4 | 30 | 4 | 20 | 5 | 2026-07-17 |
| `handoff-qos-wip` | 4 | 30 | 4 | 20 | 5 | 2026-07-17 |
| `handoff-wo-enterprise-state` | 4 | 17 | 4 | 10 | 3 | 2026-08-10 |
| `handoff-wo-stale-claims` | 4 | 12 | 2 | 8 | 2 | 2026-08-08 |
| `handoff-ceo-data-2` | 3 | 17 | 6 | 3 | 8 | 2026-07-17 |
| `handoff-inventory-3tier` | 3 | 11 | 4 | 5 | 2 | 2026-07-18 |
| `handoff-wo-capacity-100pct` | 3 | 9 | 2 | 2 | 5 | 2026-07-31 |
| `handoff-wo-cert-honesty` | 3 | 16 | 2 | 4 | 10 | 2026-08-10 |
| `handoff-wo-chain-24` | 3 | 13 | 4 | 7 | 1 | 2026-08-07 |
| `handoff-wo-dril-p4` | 3 | 32 | 8 | 20 | 3 | 2026-07-25 |
| `handoff-wo-phase2-c` | 3 | 12 | 4 | 7 | 1 | 2026-07-23 |
| `handoff-wo-qos-cross-domain-unified` | 3 | 13 | 2 | 8 | 3 | 2026-07-26 |
| `handoff-wo-scenario-input-phase0` | 3 | 25 | 7 | 11 | 7 | 2026-07-31 |
| `handoff-capacity-infer` | 2 | 3 | 0 | 0 | 3 | 2026-07-20 |
| `handoff-five-role-ai-employee` | 2 | 24 | 4 | 14 | 6 | 2026-07-18 |
| `handoff-interbase-transfer` | 2 | 8 | 1 | 4 | 3 | 2026-07-19 |
| `handoff-portfolio-optimal` | 2 | 18 | 1 | 2 | 15 | 2026-07-20 |
| `handoff-role-fallback` | 2 | 4 | 0 | 3 | 1 | 2026-07-21 |
| `handoff-seg-attr-scope` | 2 | 5 | 1 | 2 | 2 | 2026-07-27 |
| `handoff-warehouse-custloc` | 2 | 9 | 2 | 6 | 1 | 2026-07-18 |
| `handoff-wo-cap-demanddelta` | 2 | 12 | 3 | 8 | 1 | 2026-07-28 |
| `handoff-wo-dialogue-theme` | 2 | 6 | 3 | 2 | 1 | 2026-07-27 |
| `handoff-wo-dril-p3` | 2 | 21 | 5 | 14 | 1 | 2026-07-25 |
| `handoff-wo-imp2plan` | 2 | 5 | 0 | 3 | 1 | 2026-08-08 |
| `handoff-wo-l2-decompose` | 2 | 7 | 1 | 4 | 2 | 2026-07-27 |
| `handoff-wo-live-disposition` | 2 | 14 | 3 | 7 | 4 | 2026-07-29 |
| `handoff-wo-resource-catalog-ontology` | 2 | 12 | 3 | 8 | 1 | 2026-08-01 |
| `handoff-wo-sandbox-e1` | 2 | 8 | 0 | 5 | 3 | 2026-08-05 |
| `handoff-a3-refbase` | 1 | 5 | 3 | 1 | 1 | 2026-07-17 |
| `handoff-a3-refbase-wip` | 1 | 5 | 3 | 1 | 1 | 2026-07-17 |
| `handoff-base-outlook` | 1 | 13 | 1 | 7 | 5 | 2026-07-20 |
| `handoff-block-dialogue` | 1 | 11 | 4 | 5 | 2 | 2026-07-18 |
| `handoff-c1` | 1 | 11 | 1 | 5 | 4 | 2026-07-17 |
| `handoff-capacity-infer-process` | 1 | 4 | 1 | 0 | 3 | 2026-07-18 |
| `handoff-capacity-timeline` | 1 | 3 | 1 | 0 | 2 | 2026-07-17 |
| `handoff-ceo-data` | 1 | 9 | 1 | 5 | 3 | 2026-07-17 |
| `handoff-ceo-q7` | 1 | 6 | 0 | 2 | 4 | 2026-07-17 |
| `handoff-cockpit-infer` | 1 | 5 | 0 | 2 | 3 | 2026-07-17 |
| `handoff-decision-kernel-wire` | 1 | 8 | 1 | 3 | 4 | 2026-07-18 |
| `handoff-decision-play-fe` | 1 | 5 | 0 | 4 | 1 | 2026-07-18 |
| `handoff-exception-event` | 1 | 8 | 2 | 4 | 2 | 2026-07-19 |
| `handoff-fix-datacore-fake` | 1 | 6 | 0 | 3 | 3 | 2026-08-06 |
| `handoff-fix-frontend-fabricate` | 1 | 7 | 2 | 2 | 3 | 2026-08-06 |
| `handoff-gate-ledger` | 1 | 10 | 3 | 4 | 3 | 2026-08-04 |
| `handoff-globalsim-glass` | 1 | 5 | 0 | 1 | 4 | 2026-07-21 |
| `handoff-jobshop-schedule` | 1 | 7 | 1 | 3 | 3 | 2026-07-19 |
| `handoff-learning-loop` | 1 | 6 | 2 | 2 | 1 | 2026-07-19 |
| `handoff-ontology-context-a` | 1 | 6 | 2 | 3 | 1 | 2026-07-24 |
| `handoff-optimize-whatif-fe` | 1 | 9 | 1 | 3 | 5 | 2026-07-19 |
| `handoff-orderline` | 1 | 8 | 0 | 0 | 8 | 2026-07-19 |
| `handoff-prd-skill-migration` | 1 | 1 | 0 | 0 | 1 | 2026-08-03 |
| `handoff-prd-skill-runtime` | 1 | 1 | 0 | 0 | 1 | 2026-08-03 |
| `handoff-project-sim-whatif` | 1 | 9 | 1 | 4 | 4 | 2026-07-20 |
| `handoff-q7-reconciled` | 1 | 3 | 1 | 1 | 1 | 2026-07-18 |
| `handoff-qos-det-gate` | 1 | 5 | 1 | 3 | 1 | 2026-07-21 |
| `handoff-real-llm-free-query` | 1 | 12 | 1 | 7 | 4 | 2026-07-18 |
| `handoff-resource-descriptor` | 1 | 9 | 2 | 2 | 5 | 2026-07-19 |
| `handoff-sop-reschedule` | 1 | 14 | 5 | 5 | 4 | 2026-07-19 |
| `handoff-surface-7dim` | 1 | 8 | 1 | 5 | 2 | 2026-07-24 |
| `handoff-tier3-agent-timeout-fallback` | 1 | 10 | 0 | 0 | 10 | 2026-07-19 |
| `handoff-tier3-agent-timeout-fallback-v2` | 1 | 10 | 0 | 7 | 3 | 2026-07-19 |
| `handoff-tier3-metric-rollup-split` | 1 | 3 | 1 | 1 | 1 | 2026-07-19 |
| `handoff-unit-normalize` | 1 | 7 | 1 | 3 | 3 | 2026-07-17 |
| `handoff-wo-76` | 1 | 5 | 0 | 4 | 1 | 2026-08-03 |
| `handoff-wo-79` | 1 | 13 | 6 | 5 | 2 | 2026-08-03 |
| `handoff-wo-80` | 1 | 4 | 0 | 1 | 3 | 2026-08-03 |
| `handoff-wo-base-id-fidelity` | 1 | 10 | 2 | 4 | 4 | 2026-07-28 |
| `handoff-wo-capacity-provenance` | 1 | 8 | 3 | 4 | 1 | 2026-07-24 |
| `handoff-wo-caplive-truechain` | 1 | 7 | 1 | 5 | 1 | 2026-08-06 |
| `handoff-wo-chainnode-gate-widen` | 1 | 1 | 0 | 0 | 1 | 2026-08-07 |
| `handoff-wo-cockpit-wiring` | 1 | 5 | 1 | 3 | 1 | 2026-07-28 |
| `handoff-wo-context-compression` | 1 | 3 | 0 | 1 | 2 | 2026-07-25 |
| `handoff-wo-databuilder-harness` | 1 | 8 | 7 | 0 | 1 | 2026-07-25 |
| `handoff-wo-dril-p1` | 1 | 16 | 1 | 10 | 5 | 2026-07-25 |
| `handoff-wo-dril-p2` | 1 | 12 | 1 | 9 | 1 | 2026-07-25 |
| `handoff-wo-dril-precision` | 1 | 7 | 1 | 3 | 3 | 2026-07-25 |
| `handoff-wo-gsim-action` | 1 | 7 | 1 | 3 | 3 | 2026-07-23 |
| `handoff-wo-gsim-data` | 1 | 5 | 2 | 2 | 1 | 2026-07-23 |
| `handoff-wo-gsim-solver` | 1 | 8 | 2 | 4 | 2 | 2026-07-23 |
| `handoff-wo-gslive-live` | 1 | 1 | 0 | 0 | 1 | 2026-08-06 |
| `handoff-wo-gui4-multiobj-real` | 1 | 6 | 1 | 4 | 1 | 2026-07-25 |
| `handoff-wo-harness-prompt` | 1 | 3 | 0 | 1 | 2 | 2026-07-25 |
| `handoff-wo-loop-control-p1` | 1 | 11 | 1 | 4 | 6 | 2026-07-26 |
| `handoff-wo-loop-control-p2` | 1 | 14 | 4 | 8 | 2 | 2026-07-27 |
| `handoff-wo-memsim-optimizer` | 1 | 5 | 0 | 3 | 2 | 2026-07-22 |
| `handoff-wo-phase3-b` | 1 | 16 | 4 | 9 | 3 | 2026-07-23 |
| `handoff-wo-prompt-defaults-wiring` | 1 | 7 | 1 | 5 | 1 | 2026-07-25 |
| `handoff-wo-qos-cross-domain-unified-v2` | 1 | 12 | 0 | 0 | 12 | 2026-07-26 |
| `handoff-wo-rules-classify` | 1 | 13 | 3 | 8 | 2 | 2026-07-25 |
| `handoff-wo-sandbox-d1` | 1 | 2 | 0 | 0 | 2 | 2026-08-05 |
| `handoff-wo-sandbox-f3` | 1 | 4 | 0 | 1 | 3 | 2026-08-05 |
| `handoff-wo-scene-concretize` | 1 | 2 | 0 | 1 | 1 | 2026-07-27 |
| `handoff-wo-seam-arg-drop` | 1 | 10 | 2 | 4 | 4 | 2026-07-28 |
| `handoff-wo-slice-connectivity` | 1 | 6 | 2 | 2 | 2 | 2026-07-23 |
| `handoff-wo-slice-governance` | 1 | 2 | 0 | 0 | 2 | 2026-08-06 |
| `handoff-wo-slice-governance-full` | 1 | 9 | 3 | 5 | 1 | 2026-08-06 |
| `handoff-wo-warm-structural` | 1 | 4 | 2 | 1 | 1 | 2026-07-27 |

---

## §6 · 已收编（42 条）—— 可删

判据：独有文件全部 SAME（blob 逐字节相同）或行级全部吸收。这些分支的内容 **100% 已在 canonical**。

| 分支 | 领先 | 独有文件 | 逐字节已在 | 行级已在 | 最后提交 |
|---|---|---|---|---|---|
| `handoff-cleanroom-attr` | 1 | 6 | 3 | 3 | 2026-07-19 |
| `handoff-counterfactual-basesel` | 1 | 3 | 0 | 3 | 2026-07-18 |
| `handoff-debattery-fix` | 1 | 2 | 1 | 1 | 2026-07-19 |
| `handoff-debattery-fix-2` | 1 | 1 | 0 | 1 | 2026-07-21 |
| `handoff-disruption-radius` | 1 | 4 | 2 | 2 | 2026-07-19 |
| `handoff-ext-signal-detail-be` | 1 | 3 | 1 | 2 | 2026-07-18 |
| `handoff-generic-whatif` | 1 | 5 | 1 | 4 | 2026-07-19 |
| `handoff-inference-prd` | 1 | 2 | 1 | 1 | 2026-07-18 |
| `handoff-memory-view-resilience` | 1 | 10 | 3 | 7 | 2026-07-24 |
| `handoff-mock-stubs` | 1 | 3 | 1 | 2 | 2026-07-19 |
| `handoff-prd-skill-compiler` | 1 | 1 | 0 | 1 | 2026-08-03 |
| `handoff-prd-skill-contract` | 1 | 1 | 0 | 1 | 2026-08-03 |
| `handoff-prd-skill-governance` | 1 | 1 | 0 | 1 | 2026-08-03 |
| `handoff-provenance-hover` | 1 | 2 | 1 | 1 | 2026-07-18 |
| `handoff-qos-budget-600s` | 1 | 3 | 1 | 2 | 2026-07-21 |
| `handoff-skill-agent-reconcile` | 1 | 1 | 1 | 0 | 2026-08-09 |
| `handoff-supply-demand-fe` | 1 | 2 | 1 | 1 | 2026-07-18 |
| `handoff-w9-windowdays` | 1 | 3 | 0 | 3 | 2026-07-25 |
| `handoff-wo-agent-runtime-s01` | 1 | 8 | 2 | 6 | 2026-07-25 |
| `handoff-wo-d2d3-diag` | 2 | 8 | 4 | 4 | 2026-08-03 |
| `handoff-wo-d5d4-ux` | 1 | 7 | 5 | 2 | 2026-08-03 |
| `handoff-wo-factor-scope-singlesource` | 6 | 13 | 7 | 6 | 2026-08-10 |
| `handoff-wo-globalsim-suite` | 2 | 18 | 5 | 13 | 2026-07-25 |
| `handoff-wo-impact-propagation` | 5 | 7 | 4 | 3 | 2026-08-10 |
| `handoff-wo-impediment-fe` | 4 | 9 | 4 | 5 | 2026-08-07 |
| `handoff-wo-live-endpoints` | 1 | 5 | 3 | 2 | 2026-08-06 |
| `handoff-wo-multiplan-prd` | 1 | 1 | 1 | 0 | 2026-08-07 |
| `handoff-wo-node-semantics` | 5 | 7 | 5 | 2 | 2026-08-07 |
| `handoff-wo-ontology-7elem` | 1 | 1 | 1 | 0 | 2026-08-04 |
| `handoff-wo-prov-drillfield` | 1 | 2 | 1 | 1 | 2026-08-04 |
| `handoff-wo-r13-drillfield` | 3 | 0 | 0 | 0 | 2026-08-06 |
| `handoff-wo-reflect-loop` | 1 | 4 | 2 | 2 | 2026-07-25 |
| `handoff-wo-rule-expr-params` | 2 | 23 | 14 | 9 | 2026-08-04 |
| `handoff-wo-sandbox-d3` | 1 | 7 | 2 | 5 | 2026-08-05 |
| `handoff-wo-sandbox-e2` | 1 | 5 | 3 | 2 | 2026-08-05 |
| `handoff-wo-sandbox-s0` | 1 | 3 | 0 | 3 | 2026-08-05 |
| `handoff-wo-sandbox-s3` | 2 | 6 | 0 | 6 | 2026-08-08 |
| `handoff-wo-synth-validation-lite` | 1 | 5 | 2 | 3 | 2026-07-23 |
| `handoff-wo-testgap-triage` | 1 | 1 | 1 | 0 | 2026-08-04 |
| `handoff-wo-topo-realdata` | 5 | 7 | 6 | 1 | 2026-08-07 |
| `handoff-wo-unitprice-scale` | 1 | 5 | 1 | 4 | 2026-07-31 |
| `handoff-wo-waiting-states-fe` | 4 | 15 | 7 | 8 | 2026-08-10 |

---

## §7 · 判不了（27 条）—— ⛔ 显式列出，不静默归桶

这 27 条我给不出可靠定性。**没有把它们塞进「已过期」凑数** —— 那正是本单要防的病。

两种判不了：
- **证据只有「部分吸收」**（行级吸收率落在 0.2–0.95）：分支的改动有一部分在 canonical 里、一部分不在。
  可能是并线时被改写，也可能是真丢了一半。要人读 diff 才知道。
- **只有分叉文件、且 canonical 日志从未提过本单**：两边都动了同一个文件，但没有任何独立证据表明这个 WO 曾并线。
  按内容像已过期，按日志像从没进来过 —— 两条判据打架，我不替仓主裁决。

| 分支 | 领先 | 独有 | 部分吸收(0.2<r<0.95) | canonical 已改写 | 日志提过 | 判不了的原因 |
|---|---|---|---|---|---|---|
| `handoff-tier3-cash-gm-attribution` | 1 | 9 | 0 | 9 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-tier2-semantic-discover` | 2 | 10 | 0 | 6 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-flaky-timer` | 4 | 6 | 0 | 6 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-gsim-frontend` | 1 | 9 | 0 | 6 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-phase4-fallback` | 1 | 12 | 0 | 6 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-qos-agent-speed` | 2 | 10 | 0 | 5 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-a3-fix` | 4 | 29 | 0 | 4 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-ceo2` | 1 | 9 | 0 | 4 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-ceo3` | 2 | 11 | 0 | 4 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-det-cross-domain` | 1 | 12 | 0 | 4 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-cap-deepen` | 1 | 14 | 0 | 3 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-ceo2v2` | 2 | 13 | 0 | 3 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-globalsim-drill-seam` | 2 | 6 | 0 | 3 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-harness-prompt-graw0b` | 1 | 4 | 0 | 3 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-qos-ontology-context` | 1 | 12 | 0 | 3 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-w5-business-type` | 1 | 12 | 0 | 3 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-tier3-cash-gm-attribution-v2` | 1 | 9 | 0 | 2 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-dialogue-q1q2` | 1 | 8 | 0 | 2 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-gates-wire` | 1 | 2 | 0 | 2 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-gsim-agent` | 2 | 4 | 0 | 2 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `integ-w1-cert5` | 8 | 45 | 0 | 2 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-capacity-daily` | 1 | 2 | 0 | 1 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-ontology-drift-fix` | 1 | 1 | 0 | 1 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-optwhatif-nl-wiring` | 1 | 12 | 0 | 1 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-d1-cancel` | 1 | 11 | 0 | 1 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-datacore-lazy-context` | 1 | 4 | 0 | 1 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |
| `handoff-wo-loop-control-p2p5` | 1 | 6 | 0 | 1 | **否** | 只有分叉文件，且 canonical 日志从未提过本单 |

---

## §8 · 反向回退（1 条）—— **绝不可合**

**`handoff-wo-gate-rc2`** tip `7e5864459f`

这条分支如果按「已收编 ⇒ 可删」处理是对的，但如果有人看它「领先 canonical 1 个提交」就去合，**会掉 950 行代码**。

实测链路：

```
7e586445 parents=3e64870b  2026-08-11T07:10:09Z  wip: 额度用尽被叫停瞬间的现场 ——
                                                 未完成·未验证，仅为防丢落盘
3e64870b parents=7e7ff193  2026-08-11T06:42:56Z  wip(gate): 门退出码纪律改造

$ git merge-base --is-ancestor 3e64870b CANON   -> rc=0（3e64870b 已在 canonical）
$ git diff --stat 3e64870b 7e586445              -> 58 files changed, 1819 deletions(-)
```

`3e64870b`（门退出码纪律改造，每个门脚本 +21 行）**已经在 canonical 里**；
分支尖端 `7e586445` 反而把这 1819 行**删掉**了 —— 逐行核对，其中 **950 行 canonical 今天仍然有**，新增 0 行。

这就是 WO-BACKLOG §2 里那条「被中途叫停的 WIP」`claude/handoff-wo-gate-rc2 @ 3e64870b`。
**账上记的 sha 是 `3e64870b`，但分支实际 HEAD 已经是 `7e586445` 了**，而这个新 tip 是回退。
接手人若按账上的分支名去 checkout，拿到的是被回退过的树。

⛔ 处置：**删分支**（内容已在 canonical）。**不要合**。

---

## §9 · 派单人哪里说错了

按 §0 通用前置「派单人写的任何事实若与你实测不符 —— 以你的实测为准，并在报告里顶回来」。

### 9.1 ✅ 对的：281 这个数

实测 `origin/claude/{handoff,integ,rescue}-*` 共 **391** 条，其中 `git rev-list --count CANON..$b >= 1` 的
**恰好 281 条**（另 110 条领先 0）。派单人自己也说「今天已经低估过一次数量级（说十几条，实测 281）」——
这次的 281 是准的。

### 9.2 🔴 错的（也是最要紧的）：「头部 5 条」有 4 条判错了方向

派单人按「独有文件数 × 最近提交时间」给了 5 条头部，暗示这是最该先捞的。实测**其中 4 条根本没有欠账**：

| 派单人给的头部 | 派单人给的理由 | 实测定性 | 实测内容 |
|---|---|---|---|
| `handoff-wo-route-nav` | +31 提交 / 47 文件 | **已过期** | 整文件缺口 **0** · 干净未并改动 **0** · 25 个文件逐字节已在 canonical · 13 个行级已吸收 · 8 个 canonical 已改写 |
| `handoff-wo-opt-whatif-data` | +29 / 44 | **已过期** | 缺口 0 · 干净未并 0 · SAME 21 · 已吸收 15 · 已改写 7 |
| `handoff-wo-transit-wire` | +28 / 45 | **已过期** | 缺口 0 · 干净未并 0 · SAME 24 · 已吸收 13 · 已改写 7 |
| `handoff-wo-sim-scope-local` | +27 / 52 | **已过期** | 缺口 0 · 干净未并 0 · SAME 22 · 已吸收 19 · 已改写 8 |
| `integ-ui-w5` | +24 / 112 | **真欠账** ✅ | 缺口 **9** · 干净未并 4 —— 唯一说对的一条 |

这四条的**唯一** ABSENT 文件都是同一个 `apps/frontend-shell/src/views/sim/sandboxConsole.ts`
（19 条分支共有），排查结果是 **canonical 有意删除**（`ONCE_EXISTED_DELETED`：该路径在 canonical 历史里被动过后删掉），
不是缺口。

**形态**（照铁律 0.6 句式）：**「派单人用『领先提交数 × 改动文件数』当作『欠账多少』的证据，而前者并不度量后者。」**
这正是 CLAUDE.md 铁律 0.6 已经记过的那笔账 ——「拿 `git log C..b | wc -l` 当有无未合并内容的判据，
rebase 过 canonical 之后该数字彻底失去意义」。派单人在同一张单里既写了这条戒律、又用「+31 提交」排了优先级。

**排序应该按什么**：canonical 缺的**整文件数**。按这个重排，头部是
`wo-aip-cap0`(9) · `integ-ui-w5`(9) · `wo-69-p3-interface`(9) · `wo-sandbox-g1`(8) ·
`wo-process-instance`(7) · `wo-s08-kit-fe`(7)。派单人的头部 5 条里只有 1 条进得来。

### 9.3 🔴 错的：`claude/rescue-*` 只有 1 条，不是一个「族」

派单人写「`claude/rescue-*` 优先（那是抢救出来的，丢了就没了）」，听上去是一批。
实测全仓 `rescue-*` **只有 1 条**：`claude/rescue-r13-drillfield-0811`（领先 10，2026-08-06）。
定性 **真欠账**，但很轻：0 个整文件缺口、1 个干净未并改动、2 个分叉文件。优先级远低于头部那批。

### 9.4 🔴 错的：`claude/integ-*` 优先「一条顶多条」这个理由不成立（但结论歪打正着）

实测 `integ-*` 共 **11** 条，其中 **7 条领先 0**（`integ-s0-rest` `integ-sim-rec` `integ-w2-all`
`integ-w2-all-fixed` `integ-w3-sandbox` `integ-wave-fe-3` `integ-wave-fe-skill` `integ-wave-metric-4fe`
`integ-wave-ui-11` —— 已全部并入 canonical），根本不在 281 里。
真正在 281 里的只有 **4** 条：`integ-ui-w5`（真欠账）· `integ-w1-cert5`（已过期）· 另 2 条在 110 条的领先 0 里。

⚠️ 值得注意：WO-BACKLOG §1 把 `claude/integ-w3-sandbox @ 111983c1` 列为「已完成、待复验并线」——
**实测它领先 canonical 0 个提交，已经并进去了**。那张复验单可以关掉。

**但「integ 优先」这个结论本身是对的，只是理由不对**：`integ-ui-w5` 值钱不是因为它是整合分支，
而是因为它的 9 个缺失文件**逐字节覆盖了 6 条独立欠账分支**（见 §4.1）。

### 9.5 ⚠️ 漏了：账上的 sha 和分支实际 HEAD 已经对不上

WO-BACKLOG §2 记 `claude/handoff-wo-gate-rc2 @ 3e64870b`。实测该分支 HEAD 是 **`7e586445`**，
而 `3e64870b` **已经并进 canonical 了**，`7e586445` 是它的**回退**（见 §8）。
派单人没有校验「账上 sha == 分支 HEAD」，接手人照账 checkout 会拿到被回退过的树。

### 9.6 ⚠️ 派单指令里有一条会让人漏判：只让按 ABSENT 找欠账

派单人给的三态表把「真欠账」绑在 ABSENT 上（「canonical 里根本没有这个文件 ⇒ **可能是真欠账**」），
DIFF 只让「看是分支更新还是 canonical 更新」。照这个走会**漏掉整整 5 条**（实测，逐条列全）：

| 分支 | 整文件缺口 | 未并入的改动 |
|---|---|---|
| `handoff-wo-hover-layer` | **0** | **15** 个文件（tokens.css · Modal/Toasts/GlobalSearch 等一整层 hover 规范） |
| `handoff-wo-82-peak-crossday` | **0** | 2 |
| `handoff-wo-82` | **0** | 1 |
| `handoff-wo-phase1-d-a` | **0** | 1 |
| `rescue-r13-drillfield-0811` | **0** | 1 |

它们**一个整文件缺口都没有**，按派单人的判据会被归进「DIFF ⇒ 看谁更新」然后大概率判成已过期；
但实测 canonical **自这些分支分叉起就没动过那些文件**，改动纯粹没并进去，是实打实的欠账。
本单加了 §1 的第 3 条判据（分叉点判别）才捞出来。

⚠️ 尤其讽刺的是**最后一条正是派单人特意点名要优先的 `rescue-*`** ——
全仓唯一那条 rescue 分支，恰好是「按 ABSENT 找欠账」会漏掉的形态。

---

## §10 · 覆盖声明 —— 做到第几条

**281 条全部做完，无截断。** 不是抽样，不是头部 N 条。

- 枚举：`git branch -r --list 'origin/claude/handoff-*' 'origin/claude/integ-*' 'origin/claude/rescue-*'` → **391** 条
- 逐条 `git rev-list --count CANON..$b` → 领先 ≥1 的 **281** 条（ERR 0 条）
- 281 条**每一条**都跑了：独有文件枚举（`git diff --name-only CANON...$b`）+ 三态分类 + 改名/删除排查
- 其中有 DIFF 的 **259** 条又跑了行级吸收率（2116 个文件逐个）
- 有非吸收 DIFF 的分支再跑分叉点判别（895 + 146 个文件）
- 全部 281 条跑了 canonical 日志佐证
- 输出行数核对：真欠账 93 + 已过期 118 + 已收编 42 + 判不了 27 + 反向 1 = **281** ✅

**排序依据**：报告内按「canonical 缺的整文件数 × 3 + 干净未并改动数」降序 —— 即**按内容缺口量**排，
不按派单人建议的「独有文件数 × 最近提交时间」（理由见 §9.2：那个数不度量欠账）。

**本单没做的（明说）**：
- 没有对「判不了」那 27 条逐个读 diff 下人工定性 —— 那需要读约 466 个部分吸收文件的 diff，超出轻画像。
- 没有验证任何欠账分支**能不能干净地 cherry-pick 回来** —— 那要建 worktree、装依赖、跑测试，属重画像，本单禁跑。
  §4 的「值不值得捞」是**内容价值**判断，不是**可合并性**判断。
- 没有碰 110 条领先 0 的分支（它们按定义已全在 canonical）。

---

## §11 · 处置建议汇总（⛔ 我一条都没删，全部交仓主裁决）

| 动作 | 条数 | 分支 |
|---|---|---|
| **可删** | 160 | 已收编 42 + 已过期 118 |
| **必删、绝不可合** | 1 | `handoff-wo-gate-rc2`（合进去掉 950 行） |
| **优先捞** | 6 | `integ-ui-w5`（顶 6 条）· `wo-aip-cap0` · `wo-69-p3-interface` · `wo-sandbox-g1` · `wo-process-instance` · `wo-s08-kit-fe` |
| **次优先捞** | ~20 | §4 表里第 7–26 行，带 migration / contracts / 门脚本的那批 |
| **低价值但仍需捞** | ~30 | 纯 docs 的（`prd-audit-b2`/`b3`/`b5` · `diag-100q` · `sandbox-*-audit`）—— ⚠️ `b3`/`b5` 各有独有文档，**不可当重复删掉**（见 §4.2） |
| **重复、可随超集一并删** | 11 | §4.1 的 6 条 + §4.2 的 `decision-info-oncanonical` · `agentrun-attribution` · `69-p2-function-signature` · `prd-audit-b1` · `prd-audit-b4` |
| **需人工看** | 27 | §7 |
| **可关掉的复验单** | 1 | WO-BACKLOG §1 的 `integ-w3-sandbox` —— 实测已并入（领先 0） |

⛔ 再说一遍：**本单没有执行上表任何一项。** 没删分支、没合分支、没推非本单分支。
`git push` 只推了 `claude/handoff-wo-branch-reconcile` 一条，内容只有本文件。


