# 分支删除执行清单 · 复核后的可删 / 不可删 / 已过期

> **WO-R3** · 实测日 **2026-08-13** · 分支 `claude/handoff-wo-branch-cleanup`
> canonical = `origin/claude/inspiring-gates-aqczjg` @ `9ee260ab55`（1833 个 blob / 1831 个不同 blob）
> 复核对象：`docs/AUDIT-branch-reconcile-2026-08-11.md` §5（已过期 118）· §6（已收编 42）· §4.2（重复分支）
>
> ⛔ **本单一条分支都没删、没合、没强推。** 全部命令交仓主执行。
> `git push` 只推了 `claude/handoff-wo-branch-cleanup` 一条，内容只有本文件。

---

## §0 · 一句话结论

**393 条 `handoff-*`/`integ-*`/`rescue-*` 分支里，278 条现在就可以删，6 条有条件可删，119 条不可删。**

- 审计的 **118 条已过期全部复核通过**、**42 条已收编全部复核通过** —— 换到今天的 canonical 重算，
  160 条**没有一条**出现整文件缺口或未并入的改动。**审计这两段是对的。**
- 🔴 **审计有一条判错、且方向危险**：`handoff-prd-audit-b4` 被判为 b1/b2 的子集「可删」——
  **实测不是**。三条分支的 `docs/AUDIT-prd-reality-batch4.md` 是**两个不同 blob**：
  b1/b2 带的是 **16,739 字节的中间态**，b4 带的是 **82,540 字节的完成态**（+348 行）。
  照审计删 b4 会**丢掉 65,801 字节**。⚠️ 讽刺的是这正是审计自己在 §4.2 警告过的病
  ——「别顺手把 b3/b5 删了」，它对 b3/b5 查了 blob，对 b4 只查了**路径**。
- 🔴 **反向分支全仓普查完成：确实只有 1 条**（`handoff-wo-gate-rc2`）。
  393 条逐条量了「自分叉起 +行/-行」，净删除的只有 2 条，另一条（`handoff-wo-dialogue-theme`
  +124/-129）经手查是 CSS 改版不是回退。**没有第二个 gate-rc2。**
- ⚠️ **审计漏掉了最大的一堆**：它明说「没有碰 110 条领先 0 的分支」。那批今天是 **113 条**，
  逐条 `merge-base --is-ancestor` 验过 **113/113 全部是 canonical 的祖先**，是风险最低的可删组。

| 组 | 条数 | 判据 | 处置 |
|---|---|---|---|
| **A · 反向回退** | 1 | 自分叉起 +0/-1819，父提交已在 canonical | **只可删，绝不可合** |
| **B · 领先 0** | 113 | `merge-base --is-ancestor` 全部为真 | 可删（风险最低） |
| **C · 已收编** | 42 | 独有文件全 SAME 或行级全吸收 | 可删 |
| **D · 已过期** | 118 | 缺口 0 + 未并改动 0，只剩 canonical 已改写的文件 | 可删 |
| **E · 重复** | 4 | 各留超集，删被包含的那条 | 可删 |
| **F · 有条件** | 6 | 内容全在 `integ-ui-w5` 里，但那条还没采收 | **采收后**才可删 |
| **不可删 · 真欠账** | 92 | 仍有 canonical 缺的整文件或未并入的改动 | 保留待捞 |
| **不可删 · 判不了** | 27 | 两边都动了同一批文件，无独立佐证 | 保留待人工看 |
| 合计 | **393** | | |

---

## §1 · 判据与工具自证

### 1.1 判据按内容，不按祖先关系

cherry-pick 进 canonical 的内容 SHA 不同、`merge-base` 恒假、内容却在。本单四条判据全落在 blob / 行内容上：

| 判据 | 定义 | 用途 |
|---|---|---|
| **缺口 real_gap** | 分支自分叉起碰过的文件里，canonical `git rev-parse --verify -q` **退出码非 0**，且该 blob 不在 canonical 任何路径下、该路径在 canonical 历史里也从未存在 | 整文件丢失 |
| **未并改动 clean_unmerged** | 两侧 blob 不同，但 **canonical 的 blob 仍等于分叉点的 blob** ⇒ canonical 自分叉起根本没动过这个文件 ⇒ 分支的改动纯粹没并进去 | 改动型欠账 |
| **吸收率** | 分支新增的行有多少出现在 canonical 的同名文件里（去空白、去空行） | 二次信号 |
| **方向 own +行/-行** | `git diff --numstat $(merge-base) $branch` | 认回退型分支 |

**「缺口 0 且未并改动 0」= 可删**：此时分支与 canonical 的每一处差异，都落在
**canonical 已经独立改写过**的文件上 —— 删掉最多丢一个被取代的旧改法，丢不掉任何 canonical 没有的内容。

⚠️ **退出码陷阱（本单亲手复现）**：不带 `--verify -q` 时路径不存在会**把输入串原样打到 stdout**：

```
naive  git rev-parse origin/claude/inspiring-gates-aqczjg:docs/__canary_wo_r3_absent_7c1e__.md
       rc=128  stdout='origin/claude/inspiring-gates-aqczjg:docs/__canary_wo_r3_absent_7c1e__.md'
带 --verify -q                              rc=1    stdout 为空
```
**判据落在 rc 上，不是「输出非空」。**

### 1.2 金丝雀 —— 否定结论的前置（与主逻辑共用同一份实现）

本单报了大量否定结论（「这条分支没有 canonical 缺的内容」「全仓只有 1 条反向分支」）。
每个分类器**先跑已知必中的样例**，全部命中才允许报数。

**① 三态分类器（`blob_at` / `tree_map`，就是主逻辑那两个函数）**
```
[PRESENT arm] blob_at(CANON, CLAUDE.md)                    rc=0 sha=de37421730a4
[ABSENT  arm] blob_at(CANON, docs/__canary_wo_r3_absent_7c1e__.md)  rc=1 sha=None
[naive trap ] git rev-parse 不带 --verify -q               rc=128 stdout=<输入串原样>
[tree    arm] canonical 树 1833 条路径；'CLAUDE.md' 在: True；ghost 在: False
VERDICT: PASS
```

**② 「有独有内容的分支必须报不可删」—— 派单要求的那条金丝雀，命中证据如下**

| 分支 | 本单分类器输出 | 判定 |
|---|---|---|
| `handoff-wo-sandbox-g1` | 缺口 **8** · 未并改动 0 · own +828/-0 | **不可删** ✅ |
| `handoff-wo-process-instance` | 缺口 **8** · 未并改动 4 · own +2661/-4 | **不可删** ✅ |
| `integ-ui-w5` | 缺口 **9** · 未并改动 5 · own +18263/-1368 | **不可删** ✅ |

其中 `handoff-wo-sandbox-g1` 的 8 个缺口逐个手敲复验（不信脚本）：
```
$ git rev-parse --verify -q CANON:scripts/gate-sandbox-g1.sh                 -> rc=1（无）
$ git rev-parse --verify -q origin/claude/handoff-wo-sandbox-g1:scripts/gate-sandbox-g1.sh
                                                                             -> rc=0（有）
```
**分类器在这三条上都报「不可删」⇒ 它不是一台只会说「可删」的机器。**

**③ 吸收率正反双控**
```
POSITIVE（blob 逐字节相同的文件，必须 1.00）:
   handoff-cleanroom-attr :: .../cleanroom/CleanroomAttrView.tsx  ratio=1.00 (387 行)
NEGATIVE（同一批 387 行拿去比一个无关文件 001_init.sql，必须 ~0）:
   ratio=0.04
VERDICT: PASS
```
反向控制是必须的：只有正控会被「匹配器把什么都算命中」骗过去。

**④ 回退形态识别器（双臂）**
```
handoff-wo-gate-rc2      +0/-1819   flagged=True   (期望 True)
handoff-wo-sandbox-g1    +828/-0    flagged=False  (期望 False)
VERDICT: PASS
```

**⑤ 祖先判定器负臂**
```
sandbox-g1 是否 canonical 祖先 -> rc=1（非 0，正确）
113 条「领先 0」逐条判 -> 不是祖先的: 0 条
VERDICT: PASS
```

**⑥ 审计文档抽取器**（我从审计里抽名单，抽错了整份复核就歪）
```
bucket stale    : n=118（审计声称 118）  金丝雀 'handoff-wo-route-nav' 命中: True
bucket absorbed : n= 42（审计声称  42）  金丝雀 'handoff-cleanroom-attr' 命中: True
bucket unknown  : n= 27（审计声称  27）  金丝雀 'handoff-a3-fix' 命中: True
bucket debt     : n= 93（审计声称  93）  金丝雀 'handoff-wo-aip-cap0' 命中: True
ghost 'handoff-zzz-definitely-not-a-branch-7c1e' 落任何桶: False
VERDICT: PASS —— 四个桶的条数与审计声称的**逐个相等**，抽取器没漏没多
```

**⑦ 日志佐证器 —— 这个金丝雀当场抓到了一个真问题**（详见 §6.4）
```
CANARY 大小写敏感  : {'skill-partial-a': True, 'rule-scope-drop': True,
                     'databuilder-pipeline': True, 'a6-contention': **False**}
CANARY 大小写不敏感: {... 'a6-contention': **True**}
ghost 'zzz-definitely-not-a-wo-7c1e': False
```
`a6-contention` 在日志里只以 **`A6-CONTENTION`（大写）** 出现 ⇒ 大小写敏感的搜索器会对一个
**内容已经完整并入**的 WO 报「日志从未提过」。**这是审计那条第二信号的假阴模式。**

### 1.3 pathspec 自证（报「零」之前）

```
git ls-files -- 'apps/*/src'    -> 0 个文件      （含通配的 pathspec 不能当目录前缀用）
git ls-files -- 'apps/*/src/*'  -> 94 个文件     （补上 /* 才对）
```
本单所有文件枚举一律走 `git ls-tree -r` 与 `git diff --name-only`，**不用带通配的 pathspec**，规避此坑。

---

## §2 · 可删清单

### 2.1 A 组 · 反向回退（1 条）—— 只可删，绝不可合

**`handoff-wo-gate-rc2`** tip `7e5864459f`

```
7e586445 parents=3e64870b  2026-08-11T07:10:09Z  wip: 额度用尽被叫停瞬间的现场
3e64870b parents=7e7ff193  2026-08-11T06:42:56Z  wip(gate): 门退出码纪律改造

$ git merge-base --is-ancestor 3e64870b CANON     -> rc=0（父提交已在 canonical）
$ git diff --numstat $(merge-base) 7e586445       -> 自分叉起 **+0 行 / -1819 行**
```

**本单的逐行核对（比审计更强的结论）**：

| 计法 | 数 | canonical 今天仍有 |
|---|---|---|
| `--stat` 报的删除行（含空行） | 1819 | — |
| 删除的**非空**行 | 1661 | **1661（100%）** |
| 删除的**去重非空**行 | 525 | **525（100%）** |
| 新增行 | **0** | — |

⇒ **它删掉的每一行，canonical 今天全都还在。** 合进去 = 净掉代码，一行都换不回来。
它另外整文件删掉了 canonical 仍有的 `scripts/check-gate-exit-discipline.mjs` 与
`scripts/gate-exit-discipline-baseline.json`。

⚠️ 台账（`WO-BACKLOG-2026-08-11.md` §2）记的是 `@3e64870b`，**分支实际 HEAD 是 `7e586445`**。
照台账 checkout 会拿到被回退过的树。

### 2.2 反向分支同族普查 —— 结论：**没有第二条**

派单要求「把同族的都揪出来」。本单对 **393 条分支逐条**量了自分叉起的 +行/-行：

| 判据 | 命中 |
|---|---|
| 净删除（-行 > +行），任意规模 | **2 条** |
| 其中 `own_added == 0`（纯删除，gate-rc2 形态） | **1 条** —— 只有 `handoff-wo-gate-rc2` |
| 删除 ≥ 3× 新增 且删除 ≥ 100 行 | **0 条** |
| 删掉 canonical 仍有的整文件（`DEL_ON_BRANCH>0`） | **1 条** —— 只有 `handoff-wo-gate-rc2` |

第 2 条净删除分支是 **`handoff-wo-dialogue-theme`（+124/-129，净 -5）**，手查定性**不是回退**：

```
$ git diff --stat $(merge-base) handoff-wo-dialogue-theme
 .../sim/GlobalSimView.module.css   | 220 ++++++-----------
 （另 5 个文件小改）
 6 files changed, 124 insertions(+), 129 deletions(-)
缺口 0 · 未并改动 0 · DEL_ON_BRANCH 0
```
是一次 CSS 改版，加减基本抵消。**归 D 组（已过期），可删。**

> 金丝雀已证该识别器两条臂都活着（gate-rc2 报 True / sandbox-g1 报 False），
> 所以「只有 1 条」是**测出来的**，不是「我没找到」。

### 2.3 B 组 · 领先 canonical 0 个提交（113 条）—— 审计漏掉的最大一堆

审计 §10 明说「没有碰 110 条领先 0 的分支」。今天这批是 **113 条**，
逐条 `git merge-base --is-ancestor $b $CANON` 验证：**113/113 全部是 canonical 的祖先**
（负臂对照：`sandbox-g1` 同一判据 rc=1，说明判据不是恒真）。
**它们的每一个提交都已在 canonical 历史里，删除零风险。**

`handoff-audit-prd-sas` · `handoff-check-dsl-cmp` · `handoff-check-mig-xr`
`handoff-check-rt-gov` · `handoff-check-spec-aut` · `handoff-perturbation`
`handoff-prd-v2-agent` · `handoff-prd-v2-skill` · `handoff-prd-v2-slice`
`handoff-process-layer` · `handoff-propagate-perturb` · `handoff-propagation-edges`
`handoff-route-gate-base` · `handoff-sandbox-batch-a2s3` · `handoff-sandbox-metro-prd`
`handoff-sim-events` · `handoff-skill-compiler-s1` · `handoff-skill-orchestrator-s1`
`handoff-skill-partial-a` · `handoff-skill-partial-b` · `handoff-skill-precond`
`handoff-skill-refclosure-a` · `handoff-wo-a6-contention` · `handoff-wo-agent-admin-console`
`handoff-wo-anchor-importline` · `handoff-wo-base-unify` · `handoff-wo-befe-seam-prosemask`
`handoff-wo-befe-wire-3` · `handoff-wo-branch-reconcile` · `handoff-wo-capacity-card-layout`
`handoff-wo-capmap-live` · `handoff-wo-cert-contract-reconcile` · `handoff-wo-chain-map-layout`
`handoff-wo-classify-filter` · `handoff-wo-coord-terminal` · `handoff-wo-d6-upserttype`
`handoff-wo-databuilder-pipeline` · `handoff-wo-decision-info-rebased` · `handoff-wo-derived-intent-slot-deaf`
`handoff-wo-dist-freshness-guard` · `handoff-wo-docfix-skill-claims` · `handoff-wo-engine-2`
`handoff-wo-engine-scope-fix` · `handoff-wo-engine-scope-fix2` · `handoff-wo-engine-scope-forensics`
`handoff-wo-f2-transit-wiring` · `handoff-wo-factlock-anchor` · `handoff-wo-fe-agent-trace`
`handoff-wo-fe-layer-2` · `handoff-wo-fe-skill-studio` · `handoff-wo-fe-wire-2`
`handoff-wo-fix-p1-regression` · `handoff-wo-gate-befe-seam` · `handoff-wo-gate-blindspots`
`handoff-wo-gate-onto-2` · `handoff-wo-impediments-reachable` · `handoff-wo-integration-loop`
`handoff-wo-l7a-solver-taxonomy` · `handoff-wo-mainline-reconcile` · `handoff-wo-migration-collision`
`handoff-wo-onto-anchor-recal` · `handoff-wo-ontology-7elements` · `handoff-wo-ontology-emit-blind`
`handoff-wo-provenance-popover-legibility` · `handoff-wo-r4-freeqa-gate` · `handoff-wo-refgate-ent`
`handoff-wo-risk-perfactor-series` · `handoff-wo-route-1` · `handoff-wo-rule-scope-drop`
`handoff-wo-sandbox-d2` · `handoff-wo-sandbox-d2-close` · `handoff-wo-sandbox-d2-close2`
`handoff-wo-sandbox-d4` · `handoff-wo-sandbox-declutter` · `handoff-wo-sandbox-e3`
`handoff-wo-sandbox-e4` · `handoff-wo-sandbox-e4-close` · `handoff-wo-sandbox-f1`
`handoff-wo-sandbox-f2` · `handoff-wo-sandbox-f4` · `handoff-wo-sandbox-f4-close`
`handoff-wo-sandbox-ia-consolidate` · `handoff-wo-sandbox-s3-enum` · `handoff-wo-sandbox-ui-integrate`
`handoff-wo-sandbox-view-mount` · `handoff-wo-scope-honesty-fe2` · `handoff-wo-seedgate-freshness`
`handoff-wo-silent-wrong-answer-3` · `handoff-wo-sim-act-close` · `handoff-wo-sim-perturb-timeline`
`handoff-wo-sim-scope-trial` · `handoff-wo-sim-trial-scope-reconcile` · `handoff-wo-slice-16-layers`
`handoff-wo-slice-16-layers-emptygraph` · `handoff-wo-slice-default-args` · `handoff-wo-slice16-reconcile`
`handoff-wo-slot-entity-resolve` · `handoff-wo-slot-harvest` · `handoff-wo-testgap-audit`
`handoff-wo-transit-geometry` · `handoff-wo-ui-declutter-top3` · `handoff-wo-ui-layering-census`
`handoff-wo-unblock-skill-fe` · `handoff-worktree-stale-guard` · `integ-s0-rest`
`integ-sim-rec` · `integ-w2-all` · `integ-w2-all-fixed`
`integ-w3-sandbox` · `integ-wave-fe-3` · `integ-wave-fe-skill`
`integ-wave-metric-4fe` · `integ-wave-ui-11`

### 2.4 C 组 · 已收编（42 条）—— 审计 §6 复核通过 42/42

换到今天的 canonical 重算，**42 条全部**仍然是缺口 0 + 未并改动 0。

| # | 分支 | tip | 领先 | 独有文件 | 逐字节已在 | canonical 已改写 | 缺口 | 未并改动 | 吸收率 | 最后提交 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `handoff-cleanroom-attr` | `f39d60973c` | 1 | 6 | 3 | 3 | **0** | **0** | 1.00 | 2026-07-19 |
| 2 | `handoff-counterfactual-basesel` | `96cd0757a6` | 1 | 3 | 0 | 3 | **0** | **0** | 0.99 | 2026-07-18 |
| 3 | `handoff-debattery-fix` | `d21813dbd1` | 1 | 2 | 1 | 1 | **0** | **0** | 1.00 | 2026-07-19 |
| 4 | `handoff-debattery-fix-2` | `1935d74924` | 1 | 1 | 0 | 1 | **0** | **0** | 1.00 | 2026-07-21 |
| 5 | `handoff-disruption-radius` | `531f5709e9` | 1 | 4 | 2 | 2 | **0** | **0** | 1.00 | 2026-07-19 |
| 6 | `handoff-ext-signal-detail-be` | `4d5595f876` | 1 | 3 | 1 | 2 | **0** | **0** | 1.00 | 2026-07-18 |
| 7 | `handoff-generic-whatif` | `630e3ec7e3` | 1 | 5 | 1 | 4 | **0** | **0** | 0.98 | 2026-07-19 |
| 8 | `handoff-inference-prd` | `8e8f2817e9` | 1 | 2 | 1 | 1 | **0** | **0** | 1.00 | 2026-07-18 |
| 9 | `handoff-memory-view-resilience` | `82528b7fbc` | 1 | 10 | 3 | 7 | **0** | **0** | 0.99 | 2026-07-24 |
| 10 | `handoff-mock-stubs` | `2e4b2bde21` | 1 | 3 | 1 | 2 | **0** | **0** | 1.00 | 2026-07-19 |
| 11 | `handoff-prd-skill-compiler` | `373a84d98e` | 1 | 1 | 0 | 1 | **0** | **0** | 0.99 | 2026-08-03 |
| 12 | `handoff-prd-skill-contract` | `86a90bab62` | 1 | 1 | 0 | 1 | **0** | **0** | 0.99 | 2026-08-03 |
| 13 | `handoff-prd-skill-governance` | `4f3cfa70a0` | 1 | 1 | 0 | 1 | **0** | **0** | 1.00 | 2026-08-03 |
| 14 | `handoff-provenance-hover` | `e61986e2d5` | 1 | 2 | 1 | 1 | **0** | **0** | 0.99 | 2026-07-18 |
| 15 | `handoff-qos-budget-600s` | `80480a60fb` | 1 | 3 | 1 | 2 | **0** | **0** | 1.00 | 2026-07-21 |
| 16 | `handoff-skill-agent-reconcile` | `93528faa94` | 1 | 1 | 1 | 0 | **0** | **0** | 1.00 | 2026-08-09 |
| 17 | `handoff-supply-demand-fe` | `6fe412a91d` | 1 | 2 | 1 | 1 | **0** | **0** | 0.99 | 2026-07-18 |
| 18 | `handoff-w9-windowdays` | `c0226b4199` | 1 | 3 | 0 | 3 | **0** | **0** | 0.98 | 2026-07-25 |
| 19 | `handoff-wo-agent-runtime-s01` | `01fd9fe72a` | 1 | 8 | 2 | 6 | **0** | **0** | 0.99 | 2026-07-25 |
| 20 | `handoff-wo-d2d3-diag` | `b409a2ceda` | 2 | 8 | 4 | 4 | **0** | **0** | 1.00 | 2026-08-03 |
| 21 | `handoff-wo-d5d4-ux` | `225de68c7a` | 1 | 7 | 5 | 2 | **0** | **0** | 1.00 | 2026-08-03 |
| 22 | `handoff-wo-factor-scope-singlesource` | `e32918984d` | 6 | 13 | 7 | 6 | **0** | **0** | 1.00 | 2026-08-10 |
| 23 | `handoff-wo-globalsim-suite` | `6f89fd5b90` | 2 | 18 | 5 | 13 | **0** | **0** | 0.99 | 2026-07-25 |
| 24 | `handoff-wo-impact-propagation` | `a259c746df` | 5 | 7 | 4 | 3 | **0** | **0** | 1.00 | 2026-08-10 |
| 25 | `handoff-wo-impediment-fe` | `5f1db104c6` | 4 | 9 | 4 | 5 | **0** | **0** | 1.00 | 2026-08-07 |
| 26 | `handoff-wo-live-endpoints` | `cdbcb6aac4` | 1 | 5 | 3 | 2 | **0** | **0** | 1.00 | 2026-08-06 |
| 27 | `handoff-wo-multiplan-prd` | `785f5eac46` | 1 | 1 | 1 | 0 | **0** | **0** | 1.00 | 2026-08-07 |
| 28 | `handoff-wo-node-semantics` | `084abd8679` | 5 | 7 | 5 | 2 | **0** | **0** | 1.00 | 2026-08-07 |
| 29 | `handoff-wo-ontology-7elem` | `c01f30f226` | 1 | 1 | 1 | 0 | **0** | **0** | 1.00 | 2026-08-04 |
| 30 | `handoff-wo-prov-drillfield` | `3840dd4424` | 1 | 2 | 1 | 1 | **0** | **0** | 1.00 | 2026-08-04 |
| 31 | `handoff-wo-r13-drillfield` | `e8f67f334f` | 3 | 0 | 0 | 0 | **0** | **0** | n/a | 2026-08-06 |
| 32 | `handoff-wo-reflect-loop` | `389586b41c` | 1 | 4 | 2 | 2 | **0** | **0** | 1.00 | 2026-07-25 |
| 33 | `handoff-wo-rule-expr-params` | `573596b544` | 2 | 23 | 14 | 9 | **0** | **0** | 1.00 | 2026-08-04 |
| 34 | `handoff-wo-sandbox-d3` | `10b1cf5762` | 1 | 7 | 2 | 5 | **0** | **0** | 1.00 | 2026-08-05 |
| 35 | `handoff-wo-sandbox-e2` | `4ebca28265` | 1 | 5 | 3 | 2 | **0** | **0** | 1.00 | 2026-08-05 |
| 36 | `handoff-wo-sandbox-s0` | `b22f1323be` | 1 | 3 | 0 | 3 | **0** | **0** | 0.99 | 2026-08-05 |
| 37 | `handoff-wo-sandbox-s3` | `a44c6002a4` | 2 | 6 | 0 | 6 | **0** | **0** | 0.98 | 2026-08-08 |
| 38 | `handoff-wo-synth-validation-lite` | `b54691e692` | 1 | 5 | 2 | 3 | **0** | **0** | 1.00 | 2026-07-23 |
| 39 | `handoff-wo-testgap-triage` | `858d9dc1aa` | 1 | 1 | 1 | 0 | **0** | **0** | 1.00 | 2026-08-04 |
| 40 | `handoff-wo-topo-realdata` | `26dc7f9825` | 5 | 7 | 6 | 1 | **0** | **0** | 1.00 | 2026-08-07 |
| 41 | `handoff-wo-unitprice-scale` | `68285bbc47` | 1 | 5 | 1 | 4 | **0** | **0** | 1.00 | 2026-07-31 |
| 42 | `handoff-wo-waiting-states-fe` | `091f6cdb06` | 4 | 15 | 6 | 9 | **0** | **0** | 1.00 | 2026-08-10 |

### 2.5 D 组 · 已过期（118 条）—— 审计 §5 复核通过 118/118

换到今天的 canonical 重算，**118 条全部**仍然是缺口 0 + 未并改动 0。**审计这一段没有一条判错。**

⚠️ 表里「吸收率」是本单加的二次信号。**它低不等于不可删** —— 低只说明 canonical 把那些文件
改得离分支很远。本单对吸收率最低的 7 条**逐条手查了它们新增的整文件**，
canonical **全部都有**（`order-line.ts` / `qos-agent-timeout.test.ts` / `multi-route.ts` /
`OptimizeWhatifView.tsx` 等，`rc=0` 逐个验过）⇒ 是**功能落地了、行漂移了**，不是内容丢了。

| # | 分支 | tip | 领先 | 独有文件 | 逐字节已在 | canonical 已改写 | 缺口 | 未并改动 | 吸收率 | 最后提交 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `handoff-wo-route-nav` | `2dbef25143` | 31 | 47 | 25 | 21 | **0** | **0** | 0.99 | 2026-08-08 |
| 2 | `handoff-wo-opt-whatif-data` | `010627a903` | 29 | 44 | 21 | 22 | **0** | **0** | 0.98 | 2026-08-08 |
| 3 | `handoff-wo-transit-wire` | `c5a1fe419f` | 28 | 45 | 24 | 20 | **0** | **0** | 0.99 | 2026-08-08 |
| 4 | `handoff-wo-sim-scope-local` | `a0d3c3686e` | 27 | 52 | 22 | 27 | **0** | **0** | 0.99 | 2026-08-08 |
| 5 | `handoff-wo-demo-lightup-2` | `2ce20275f4` | 26 | 41 | 24 | 16 | **0** | **0** | 1.00 | 2026-08-08 |
| 6 | `handoff-wo-lever-binding` | `02e1e55eac` | 26 | 45 | 21 | 23 | **0** | **0** | 0.99 | 2026-08-08 |
| 7 | `handoff-wo-semantics-singlesource` | `f64a12ee71` | 26 | 44 | 22 | 21 | **0** | **0** | 0.99 | 2026-08-08 |
| 8 | `handoff-wo-zombie-audit` | `f7be27e7ae` | 26 | 42 | 21 | 20 | **0** | **0** | 0.99 | 2026-08-08 |
| 9 | `handoff-wo-hardcoded-absence` | `8c9b2264af` | 25 | 43 | 21 | 21 | **0** | **0** | 0.98 | 2026-08-08 |
| 10 | `handoff-wo-console-cleanup` | `b95b8f4136` | 21 | 37 | 19 | 17 | **0** | **0** | 0.99 | 2026-08-08 |
| 11 | `handoff-wo-nav-gate` | `457ac9d74a` | 21 | 41 | 19 | 21 | **0** | **0** | 0.99 | 2026-08-08 |
| 12 | `handoff-wo-levers-rootcause` | `f6e89e7f71` | 19 | 35 | 19 | 15 | **0** | **0** | 1.00 | 2026-08-08 |
| 13 | `handoff-fix-imp2plan-seam` | `528d3a85cd` | 14 | 23 | 4 | 18 | **0** | **0** | 0.98 | 2026-08-09 |
| 14 | `handoff-wo-opt-whatif-close` | `28a54d4712` | 12 | 10 | 4 | 6 | **0** | **0** | 1.00 | 2026-08-08 |
| 15 | `handoff-wo-sandbox-console` | `2dc26bc56b` | 12 | 26 | 5 | 20 | **0** | **0** | 0.95 | 2026-08-07 |
| 16 | `handoff-cross-object-multiobj` | `e0341c3da8` | 6 | 31 | 9 | 22 | **0** | **0** | 0.94 | 2026-07-19 |
| 17 | `handoff-wo-sandbox-a2` | `05588622f5` | 6 | 7 | 4 | 3 | **0** | **0** | 1.00 | 2026-08-08 |
| 18 | `handoff-orderline-atpbase` | `218797fe1e` | 5 | 18 | 8 | 10 | **0** | **0** | 0.98 | 2026-07-19 |
| 19 | `handoff-wo-decision-info` | `b06f582f42` | 5 | 12 | 3 | 9 | **0** | **0** | 0.98 | 2026-08-05 |
| 20 | `handoff-wo-fix-dark-launch-gate` | `97ad5dc261` | 5 | 6 | 2 | 4 | **0** | **0** | 0.99 | 2026-08-10 |
| 21 | `handoff-atp-promise` | `0bd885fb5a` | 4 | 16 | 6 | 10 | **0** | **0** | 0.98 | 2026-07-18 |
| 22 | `handoff-qos` | `61137dd25f` | 4 | 30 | 4 | 26 | **0** | **0** | 0.93 | 2026-07-17 |
| 23 | `handoff-qos-wip` | `61137dd25f` | 4 | 30 | 4 | 26 | **0** | **0** | 0.93 | 2026-07-17 |
| 24 | `handoff-wo-enterprise-state` | `aeb13d8298` | 4 | 17 | 4 | 13 | **0** | **0** | 0.99 | 2026-08-10 |
| 25 | `handoff-wo-stale-claims` | `aebd4ccf54` | 4 | 12 | 2 | 10 | **0** | **0** | 0.98 | 2026-08-08 |
| 26 | `handoff-ceo-data-2` | `c068306fd3` | 3 | 17 | 6 | 11 | **0** | **0** | 0.77 | 2026-07-17 |
| 27 | `handoff-inventory-3tier` | `44ac0028cb` | 3 | 11 | 4 | 7 | **0** | **0** | 0.98 | 2026-07-18 |
| 28 | `handoff-wo-capacity-100pct` | `d52def35ff` | 3 | 9 | 2 | 7 | **0** | **0** | 0.87 | 2026-07-31 |
| 29 | `handoff-wo-cert-honesty` | `ab69aa12e8` | 3 | 16 | 2 | 14 | **0** | **0** | 0.81 | 2026-08-10 |
| 30 | `handoff-wo-chain-24` | `dcefb5fd9a` | 3 | 13 | 4 | 8 | **0** | **0** | 1.00 | 2026-08-07 |
| 31 | `handoff-wo-dril-p4` | `142d08dcac` | 3 | 32 | 8 | 24 | **0** | **0** | 0.99 | 2026-07-25 |
| 32 | `handoff-wo-phase2-c` | `7c07b9f356` | 3 | 12 | 4 | 8 | **0** | **0** | 0.99 | 2026-07-23 |
| 33 | `handoff-wo-qos-cross-domain-unified` | `aff51b55da` | 3 | 13 | 2 | 11 | **0** | **0** | 0.98 | 2026-07-26 |
| 34 | `handoff-wo-scenario-input-phase0` | `13ab118b76` | 3 | 25 | 7 | 18 | **0** | **0** | 0.95 | 2026-07-31 |
| 35 | `handoff-capacity-infer` | `127ef840da` | 2 | 3 | 0 | 3 | **0** | **0** | 0.78 | 2026-07-20 |
| 36 | `handoff-five-role-ai-employee` | `c55b5c4f0e` | 2 | 24 | 4 | 20 | **0** | **0** | 0.97 | 2026-07-18 |
| 37 | `handoff-interbase-transfer` | `c09759e6db` | 2 | 8 | 1 | 7 | **0** | **0** | 0.96 | 2026-07-19 |
| 38 | `handoff-portfolio-optimal` | `516a4a1bff` | 2 | 18 | 1 | 17 | **0** | **0** | 0.87 | 2026-07-20 |
| 39 | `handoff-role-fallback` | `f851d78ec6` | 2 | 4 | 0 | 4 | **0** | **0** | 0.95 | 2026-07-21 |
| 40 | `handoff-seg-attr-scope` | `c94d348328` | 2 | 5 | 1 | 4 | **0** | **0** | 0.96 | 2026-07-27 |
| 41 | `handoff-warehouse-custloc` | `1efff7f14c` | 2 | 9 | 2 | 7 | **0** | **0** | 0.98 | 2026-07-18 |
| 42 | `handoff-wo-cap-demanddelta` | `53f82bcb40` | 2 | 12 | 3 | 9 | **0** | **0** | 0.98 | 2026-07-28 |
| 43 | `handoff-wo-dialogue-theme` | `a4c1f71e61` | 2 | 6 | 3 | 3 | **0** | **0** | 0.99 | 2026-07-27 |
| 44 | `handoff-wo-dril-p3` | `56ec110b6f` | 2 | 21 | 5 | 16 | **0** | **0** | 0.99 | 2026-07-25 |
| 45 | `handoff-wo-imp2plan` | `d042531abe` | 2 | 5 | 0 | 4 | **0** | **0** | 0.98 | 2026-08-08 |
| 46 | `handoff-wo-l2-decompose` | `4d4617b387` | 2 | 7 | 1 | 6 | **0** | **0** | 0.96 | 2026-07-27 |
| 47 | `handoff-wo-live-disposition` | `cc022645de` | 2 | 14 | 3 | 11 | **0** | **0** | 0.98 | 2026-07-29 |
| 48 | `handoff-wo-resource-catalog-ontology` | `146489b646` | 2 | 12 | 3 | 9 | **0** | **0** | 0.99 | 2026-08-01 |
| 49 | `handoff-wo-sandbox-e1` | `32371d042e` | 2 | 8 | 0 | 8 | **0** | **0** | 0.97 | 2026-08-05 |
| 50 | `handoff-a3-refbase` | `6fd5189ec6` | 1 | 5 | 3 | 2 | **0** | **0** | 1.00 | 2026-07-17 |
| 51 | `handoff-a3-refbase-wip` | `6fd5189ec6` | 1 | 5 | 3 | 2 | **0** | **0** | 1.00 | 2026-07-17 |
| 52 | `handoff-base-outlook` | `fa67ea9605` | 1 | 13 | 1 | 12 | **0** | **0** | 0.90 | 2026-07-20 |
| 53 | `handoff-block-dialogue` | `9153cd959e` | 1 | 11 | 4 | 7 | **0** | **0** | 0.99 | 2026-07-18 |
| 54 | `handoff-c1` | `f8f19b4847` | 1 | 11 | 1 | 10 | **0** | **0** | 0.92 | 2026-07-17 |
| 55 | `handoff-capacity-infer-process` | `746ffc79a1` | 1 | 4 | 1 | 3 | **0** | **0** | 0.87 | 2026-07-18 |
| 56 | `handoff-capacity-timeline` | `3eaa87dfdc` | 1 | 3 | 1 | 2 | **0** | **0** | 0.95 | 2026-07-17 |
| 57 | `handoff-ceo-data` | `9996c84906` | 1 | 9 | 1 | 8 | **0** | **0** | 0.98 | 2026-07-17 |
| 58 | `handoff-ceo-q7` | `8e4719fc1c` | 1 | 6 | 0 | 6 | **0** | **0** | 0.97 | 2026-07-17 |
| 59 | `handoff-cockpit-infer` | `24644f64ff` | 1 | 5 | 0 | 5 | **0** | **0** | 0.93 | 2026-07-17 |
| 60 | `handoff-decision-kernel-wire` | `9bc19f431f` | 1 | 8 | 1 | 7 | **0** | **0** | 0.97 | 2026-07-18 |
| 61 | `handoff-decision-play-fe` | `34f6230786` | 1 | 5 | 0 | 5 | **0** | **0** | 0.98 | 2026-07-18 |
| 62 | `handoff-exception-event` | `73f7e25bcc` | 1 | 8 | 2 | 6 | **0** | **0** | 0.98 | 2026-07-19 |
| 63 | `handoff-fix-datacore-fake` | `93941a92c6` | 1 | 6 | 0 | 6 | **0** | **0** | 0.97 | 2026-08-06 |
| 64 | `handoff-fix-frontend-fabricate` | `2a46626b06` | 1 | 7 | 2 | 5 | **0** | **0** | 0.88 | 2026-08-06 |
| 65 | `handoff-gate-ledger` | `a212e100ca` | 1 | 10 | 3 | 7 | **0** | **0** | 1.00 | 2026-08-04 |
| 66 | `handoff-globalsim-glass` | `eb61516780` | 1 | 5 | 0 | 5 | **0** | **0** | 0.79 | 2026-07-21 |
| 67 | `handoff-jobshop-schedule` | `c393a70771` | 1 | 7 | 1 | 6 | **0** | **0** | 0.99 | 2026-07-19 |
| 68 | `handoff-learning-loop` | `91a75ba72c` | 1 | 6 | 2 | 4 | **0** | **0** | 1.00 | 2026-07-19 |
| 69 | `handoff-ontology-context-a` | `1309f2e0b8` | 1 | 6 | 2 | 4 | **0** | **0** | 0.99 | 2026-07-24 |
| 70 | `handoff-optimize-whatif-fe` | `453a043650` | 1 | 9 | 1 | 8 | **0** | **0** | 0.56 | 2026-07-19 |
| 71 | `handoff-orderline` | `a3c0caf90d` | 1 | 8 | 0 | 8 | **0** | **0** | 0.20 | 2026-07-19 |
| 72 | `handoff-prd-skill-migration` | `25ce5c6fda` | 1 | 1 | 0 | 1 | **0** | **0** | 0.81 | 2026-08-03 |
| 73 | `handoff-prd-skill-runtime` | `5b7a6e1dc0` | 1 | 1 | 0 | 1 | **0** | **0** | 0.95 | 2026-08-03 |
| 74 | `handoff-project-sim-whatif` | `215bb6816f` | 1 | 9 | 1 | 8 | **0** | **0** | 0.96 | 2026-07-20 |
| 75 | `handoff-q7-reconciled` | `855e6708a4` | 1 | 3 | 1 | 2 | **0** | **0** | 0.97 | 2026-07-18 |
| 76 | `handoff-qos-det-gate` | `e1c3b48c25` | 1 | 5 | 1 | 4 | **0** | **0** | 0.99 | 2026-07-21 |
| 77 | `handoff-real-llm-free-query` | `e6bff23e2c` | 1 | 12 | 1 | 11 | **0** | **0** | 0.96 | 2026-07-18 |
| 78 | `handoff-resource-descriptor` | `2d2bc73564` | 1 | 9 | 2 | 7 | **0** | **0** | 0.95 | 2026-07-19 |
| 79 | `handoff-sop-reschedule` | `f572080bb9` | 1 | 14 | 5 | 9 | **0** | **0** | 0.98 | 2026-07-19 |
| 80 | `handoff-surface-7dim` | `6b2379aa41` | 1 | 8 | 1 | 7 | **0** | **0** | 0.98 | 2026-07-24 |
| 81 | `handoff-tier3-agent-timeout-fallback` | `f376836fb5` | 1 | 10 | 0 | 10 | **0** | **0** | 0.42 | 2026-07-19 |
| 82 | `handoff-tier3-agent-timeout-fallback-v2` | `7d7e2fc745` | 1 | 10 | 0 | 10 | **0** | **0** | 0.96 | 2026-07-19 |
| 83 | `handoff-tier3-metric-rollup-split` | `c9f05a934d` | 1 | 3 | 1 | 2 | **0** | **0** | 0.99 | 2026-07-19 |
| 84 | `handoff-unit-normalize` | `e96c9825c8` | 1 | 7 | 1 | 6 | **0** | **0** | 0.86 | 2026-07-17 |
| 85 | `handoff-wo-76` | `c0a1bcda88` | 1 | 5 | 0 | 5 | **0** | **0** | 0.99 | 2026-08-03 |
| 86 | `handoff-wo-79` | `6dd0b0c0f2` | 1 | 13 | 6 | 7 | **0** | **0** | 0.97 | 2026-08-03 |
| 87 | `handoff-wo-80` | `a8df283050` | 1 | 4 | 0 | 4 | **0** | **0** | 0.96 | 2026-08-03 |
| 88 | `handoff-wo-base-id-fidelity` | `36f7e6ab2f` | 1 | 10 | 2 | 8 | **0** | **0** | 0.97 | 2026-07-28 |
| 89 | `handoff-wo-capacity-provenance` | `f17f87019d` | 1 | 8 | 3 | 5 | **0** | **0** | 0.98 | 2026-07-24 |
| 90 | `handoff-wo-caplive-truechain` | `b8fc5ddf1b` | 1 | 7 | 1 | 6 | **0** | **0** | 0.99 | 2026-08-06 |
| 91 | `handoff-wo-chainnode-gate-widen` | `86e573478c` | 1 | 1 | 0 | 1 | **0** | **0** | 0.00 | 2026-08-07 |
| 92 | `handoff-wo-cockpit-wiring` | `33b7c81860` | 1 | 5 | 1 | 4 | **0** | **0** | 0.98 | 2026-07-28 |
| 93 | `handoff-wo-context-compression` | `590806007e` | 1 | 3 | 0 | 3 | **0** | **0** | 0.93 | 2026-07-25 |
| 94 | `handoff-wo-databuilder-harness` | `379a20392f` | 1 | 8 | 7 | 1 | **0** | **0** | 1.00 | 2026-07-25 |
| 95 | `handoff-wo-dril-p1` | `421018ee7a` | 1 | 16 | 1 | 15 | **0** | **0** | 0.97 | 2026-07-25 |
| 96 | `handoff-wo-dril-p2` | `d7a9fde5e4` | 1 | 12 | 1 | 11 | **0** | **0** | 0.98 | 2026-07-25 |
| 97 | `handoff-wo-dril-precision` | `7b255aad3f` | 1 | 7 | 1 | 6 | **0** | **0** | 0.94 | 2026-07-25 |
| 98 | `handoff-wo-gsim-action` | `e7e8600bc8` | 1 | 7 | 1 | 6 | **0** | **0** | 0.97 | 2026-07-23 |
| 99 | `handoff-wo-gsim-data` | `130e357691` | 1 | 5 | 2 | 3 | **0** | **0** | 0.99 | 2026-07-23 |
| 100 | `handoff-wo-gsim-solver` | `3e0654b71c` | 1 | 8 | 2 | 6 | **0** | **0** | 0.98 | 2026-07-23 |
| 101 | `handoff-wo-gslive-live` | `2bcc34c183` | 1 | 1 | 0 | 1 | **0** | **0** | 0.40 | 2026-08-06 |
| 102 | `handoff-wo-gui4-multiobj-real` | `330a6ecd76` | 1 | 6 | 1 | 5 | **0** | **0** | 0.98 | 2026-07-25 |
| 103 | `handoff-wo-harness-prompt` | `d0135cecff` | 1 | 3 | 0 | 3 | **0** | **0** | 0.96 | 2026-07-25 |
| 104 | `handoff-wo-loop-control-p1` | `250582262a` | 1 | 11 | 1 | 10 | **0** | **0** | 0.96 | 2026-07-26 |
| 105 | `handoff-wo-loop-control-p2` | `485248304b` | 1 | 14 | 4 | 10 | **0** | **0** | 0.99 | 2026-07-27 |
| 106 | `handoff-wo-memsim-optimizer` | `4f3b051d0e` | 1 | 5 | 0 | 5 | **0** | **0** | 0.95 | 2026-07-22 |
| 107 | `handoff-wo-phase3-b` | `6a0a43e8a6` | 1 | 16 | 4 | 12 | **0** | **0** | 0.99 | 2026-07-23 |
| 108 | `handoff-wo-prompt-defaults-wiring` | `9a41029377` | 1 | 7 | 1 | 6 | **0** | **0** | 0.99 | 2026-07-25 |
| 109 | `handoff-wo-qos-cross-domain-unified-v2` | `f7adf50960` | 1 | 12 | 0 | 12 | **0** | **0** | 0.49 | 2026-07-26 |
| 110 | `handoff-wo-rules-classify` | `cd2ca8bd5e` | 1 | 13 | 3 | 10 | **0** | **0** | 0.96 | 2026-07-25 |
| 111 | `handoff-wo-sandbox-d1` | `f353c08875` | 1 | 2 | 0 | 2 | **0** | **0** | 0.93 | 2026-08-05 |
| 112 | `handoff-wo-sandbox-f3` | `6f4f7ba2b6` | 1 | 4 | 0 | 4 | **0** | **0** | 0.93 | 2026-08-05 |
| 113 | `handoff-wo-scene-concretize` | `fa04a0e1bd` | 1 | 2 | 0 | 2 | **0** | **0** | 0.97 | 2026-07-27 |
| 114 | `handoff-wo-seam-arg-drop` | `8bf25c359a` | 1 | 10 | 2 | 8 | **0** | **0** | 0.98 | 2026-07-28 |
| 115 | `handoff-wo-slice-connectivity` | `bd7968d603` | 1 | 6 | 2 | 4 | **0** | **0** | 0.91 | 2026-07-23 |
| 116 | `handoff-wo-slice-governance` | `926f883f46` | 1 | 2 | 0 | 2 | **0** | **0** | 0.31 | 2026-08-06 |
| 117 | `handoff-wo-slice-governance-full` | `96278d2e36` | 1 | 9 | 3 | 6 | **0** | **0** | 0.98 | 2026-08-06 |
| 118 | `handoff-wo-warm-structural` | `00a54a8425` | 1 | 4 | 2 | 2 | **0** | **0** | 0.98 | 2026-07-27 |

### 2.6 E 组 · 重复分支（4 条可删）—— 含我对 b3/b4/b5 的独立复核

| 关系 | 本单实测 | 处置 |
|---|---|---|
| `prd-audit-b1` vs `b2` | 4 个独有文件同路径。`batch4.md` 与 `sandbox-redesign-gap.md` **blob 全等**；`batch1.md`/`batch2.md` **b2 的更新**（b1 提交题＝「抢救落盘…**中间态**」，b2＝「batch2 完成 22/22」） | **删 b1，留 b2** |
| `decision-info-fe` vs `-oncanonical` | **8/8 独有文件 blob 全等**（审计写 5/5，那是只数了 ABSENT 的 5 个；连 DIFF 的 3 个也全等）。互相**都不是**对方的祖先，是平行重复 | **删 `-oncanonical`，留 `-fe`** |
| `agentrun-attribution` ⊂ `agentrun-fanout-persist` | 前者的 2 个缺口文件 blob 全等于后者；后者另有 `013_agentrun_fanout.sql` + `agent-run-fanout.seam.test.ts`。**且 `merge-base --is-ancestor` rc=0 —— 前者是后者的真祖先** | **删 attribution，留 fanout-persist** |
| `69-p2-function-signature` ⊂ `69-p3-interface` | 前者 **5** 个缺口文件 blob 全等于后者（审计写 3/3，实测 5/5）；后者另有 `028_object_interfaces.sql`·`object-interface.ts`·`check-object-interface.mjs`·`object-interface.seam.test.ts`。**`--is-ancestor` rc=0** | **删 p2，留 p3** |

#### `prd-audit-b1` 可删的证据 —— **我不能在 b1 上重犯我抓 b4 的那个错**

判 b1 可删，就等于判「b1 的内容 b2 全有」。**只比路径是不够的（那正是 b4 翻车的地方），
所以逐 blob、逐行都验了**：

```
b1 batch1 blob d6d6c4aea8e6  23,083 字节   b2 batch1 blob 7ffd7fc31fa1  47,571 字节
b1 batch2 blob 212110490a60  25,192 字节   b2 batch2 blob 9506ae590e33  88,762 字节

$ git diff --stat d6d6c4aea8e6 7ffd7fc31fa1 -> 132 insertions(+), 0 deletions   （b2 纯增）
$ git diff --stat 212110490a60 9506ae590e33 -> 674 insertions(+), 1 deletion(-)

逐行：b1-batch1 的 103 个非空行，**不在 b2 里的 = 0**
      b1-batch2 的 246 个非空行，**不在 b2 里的 = 1**
那 1 行是什么：
  -  - **S4.1 知识库语义检索**：`apps/datacore/src/kb.ts` + `appsls/embeddings.ts`（…）
  ⇒ b1 的**错别字**（`appsls/`），b2 已改正。**不是内容，是 bug。**

（比较器金丝雀：同一段 b1-batch1 拿去比一个无关文档 b3-batch3 -> 91 行不命中 ⇒ 比较器没坏，
  不是「什么都算命中」）
```
⇒ **b2 是 b1 的真超集（唯一差异是 b1 的一个错别字）。删 b1 零损失。**

#### 🔴 `prd-audit-b4` —— 审计判错，**不可删**

审计 §4.2 与 §11 写：「`handoff-prd-audit-b4` ⊂ `b1`/`b2`，b4 只缺 `AUDIT-prd-reality-batch4.md`，
b1/b2 都带 ⇒ **b4 可删**」。**实测不成立**：

```
b1/b2 : docs/AUDIT-prd-reality-batch4.md  blob 356aaf531af0   16,739 字节
b4    : docs/AUDIT-prd-reality-batch4.md  blob d8184661a15c   82,540 字节
$ git diff --stat 356aaf531af0 d8184661a15c  ->  1 file changed, 348 insertions(+)

b1 tip a2ff344553  「docs(audit): 抢救落盘 PRD 对账 batch2/4 **中间态**（审核方隔离失误的产物）」
b4 tip dd3e87f9a5  「docs: PRD 对账 batch4 · 16-22 + 汇总表 + 按投产比排序的补做建议（**全 22 份完**）」
```
b1/b2 带的是**中间态**，b4 带的才是**完成态**。**删 b4 丢 65,801 字节 / 348 行。**

**形态**（照铁律 0.6 句式）：**「审计用『b1/b2 有同名路径』当作『b4 无独有内容』的证据，而前者并不度量后者。」**
——这与它自己在 §4.2 特意警告的 b3/b5 是**同一个错**，只是它对 b3/b5 查了 blob，对 b4 只查了路径。

#### `prd-audit-b3` / `b5` —— 独立复核：**审计是对的，不可删**

```
b3: docs/AUDIT-prd-reality-batch3.md  blob cf1520f93957  canonical rc=1（无）· b1/b2 均无此路径
b5: docs/AUDIT-prd-reality-batch5.md  blob f02647a29c5b  canonical rc=1（无）· b1/b2 均无此路径
canonical 全仓 docs/ 下 'prd-reality' 命中 **0**
  （同一条 grep 的金丝雀：docs/ 下 'AUDIT-' 命中 22，含 AUDIT-branch-reconcile-2026-08-11.md ⇒ 工具没坏）
```
**b3 与 b5 各自独有一份文档，必须单独捞，确认不可删。**

#### 附带发现：两组 tip 完全相同的分支

| tip | 分支 | 说明 |
|---|---|---|
| `61137dd25f` | `handoff-qos` · `handoff-qos-wip` | **同一个提交**，两个名字 |
| `6fd5189ec6` | `handoff-a3-refbase` · `handoff-a3-refbase-wip` | **同一个提交**，两个名字 |

两组四条都已在 D 组（已过期）里，一并删除即可，无需额外处置。

### 2.7 F 组 · 有条件可删（6 条）—— **必须先采收 `integ-ui-w5`**

审计 §4.1 说 `integ-ui-w5` 是这 6 条的逐字节超集。**我先按 blob 复核，报出 2 条「未覆盖」；
再追一层按行复核，推翻了我自己 —— 审计是对的。** 过程如实记录（这正是铁律 0.5 要的那一层）：

```
第一层（blob 比对）：
  scope-honesty-fe / order-row-detail 的 OrderChainView.tsx 与 integ-ui-w5 **blob 不同**
  -> 我一度判「integ-ui-w5 不是超集」

第二层（行比对，正确的问法：分支自分叉起新增的行，有多少不在 integ-ui-w5 里）：
  handoff-wo-scope-honesty-fe   own-added 116 行，不在 integ-ui-w5 的: **0**
  handoff-wo-order-row-detail   own-added 377 行，不在 integ-ui-w5 的: **0**
  （金丝雀：integ-ui-w5 侧该文件 663 行非空行 >0；ghost 行在集合里 False）
-> blob 不同只是因为三方各自演化，**内容确实是超集**。审计 §4.1 成立。
```

| 分支 | 缺口 | 未并改动 | 全部内容在 `integ-ui-w5` 里 |
|---|---|---|---|
| `handoff-wo-befe-seam-field` | 3 | 0 | ✅ |
| `handoff-wo-disposition-inline-row` | 1 | 0 | ✅ |
| `handoff-wo-ontology-ia` | 1 | 0 | ✅ |
| `handoff-wo-ot-instance-reach` | 1 | 2 | ✅ |
| `handoff-wo-order-row-detail` | 1 | 3 | ✅（行级 0 缺失） |
| `handoff-wo-scope-honesty-fe` | 2 | 1 | ✅（行级 0 缺失）**且已被 canonical 另行实现，见 §4.2** |

⛔ **顺序不能反**：`integ-ui-w5` 今天**仍有 7 个 canonical 缺的整文件**（原 9 个，
见 §4.2 扣掉已被另行实现的 2 个）。**没采收就删这 6 条 = 真丢内容。**

---

## §3 · 不可删清单

### 3.1 真欠账 92 条 —— 今天仍有 canonical 缺的内容

审计判 93 条，今天 **92 条**（`handoff-wo-a6-contention` 已并入，见 §4.1）。
逐条实测「canonical 缺的整文件 / 未并入的改动」，两个数**任一非 0 即不可删**：

| 分支 | canonical 缺的整文件 | 未并入的改动 | 领先 |
|---|---|---|---|
| `handoff-wo-aip-cap0` | 11 | 16 | 2 |
| `integ-ui-w5` | 9 | 5 | 24 |
| `handoff-wo-69-p3-interface` | 9 | 3 | 6 |
| `handoff-wo-process-instance` | 8 | 4 | 6 |
| `handoff-wo-sandbox-g1` | 8 | 0 | 4 |
| `handoff-wo-s08-kit-fe` | 7 | 2 | 5 |
| `handoff-wo-agentrun-fanout-persist` | 4 | 8 | 9 |
| `handoff-wo-metrics-authz` | 4 | 8 | 5 |
| `handoff-wo-org-world` | 7 | 4 | 6 |
| `handoff-diag-100q` | 6 | 0 | 1 |
| `handoff-wo-69-p2-function-signature` | 5 | 2 | 3 |
| `handoff-wo-63-schema-readability` | 5 | 1 | 6 |
| `handoff-wo-approval-policy` | 5 | 1 | 6 |
| `handoff-wo-decision-info-fe` | 5 | 0 | 2 |
| `handoff-wo-decision-info-oncanonical` | 5 | 0 | 2 |
| `handoff-wo-quote-margin-customer` | 5 | 0 | 8 |
| `handoff-wo-sandbox-a10` | 5 | 0 | 16 |
| `handoff-wo-slice-discovery` | 4 | 3 | 3 |
| `handoff-wo-66-rules-p1p2` | 3 | 6 | 1 |
| `handoff-wo-solver-scope-fe` | 0 | 2 | 4 |
| `handoff-wo-hover-layer` | 0 | 16 | 5 |
| `handoff-wo-decision-graph` | 4 | 1 | 6 |
| `handoff-wo-agentrun-attribution` | 2 | 7 | 4 |
| `handoff-prd-audit-b1` | 4 | 0 | 3 |
| `handoff-prd-audit-b2` | 4 | 0 | 8 |
| `handoff-wo-procurement-frontend` | 4 | 0 | 1 |
| `handoff-wo-65-metrics` | 2 | 5 | 8 |
| `handoff-wo-graph-desc-contract` | 2 | 4 | 2 |
| `handoff-wo-modeling-no-llm` | 2 | 5 | 3 |
| `handoff-wo-slice-ref-producer` | 2 | 4 | 3 |
| `handoff-wo-argname-and-units` | 3 | 0 | 6 |
| `handoff-wo-befe-seam-field` | 3 | 0 | 5 |
| `handoff-wo-gate-selftest` | 3 | 0 | 3 |
| `handoff-wo-leadtime-split` | 2 | 4 | 7 |
| `handoff-wo-adopt-decision-play` | 2 | 2 | 6 |
| `handoff-wo-decision-info-frontend2` | 2 | 2 | 8 |
| `handoff-wo-rules-dsl-family` | 1 | 6 | 4 |
| `handoff-sandbox-action-propagation` | 2 | 1 | 1 |
| `handoff-wo-decision-info-frontend` | 2 | 1 | 5 |
| `handoff-wo-prd-grounding-gate` | 2 | 1 | 4 |
| `handoff-wo-scope-honesty-fe` | 2 | 1 | 4 |
| `handoff-metric-aware-seam` | 2 | 0 | 5 |
| `handoff-ontology-context` | 4 | 0 | 1 |
| `handoff-wo-coverage-blind` | 2 | 0 | 2 |
| `handoff-wo-multi-intent-p1` | 2 | 0 | 1 |
| `handoff-wo-sandbox-prop-direction` | 2 | 0 | 3 |
| `handoff-wo-sim-checkpoints` | 2 | 0 | 3 |
| `handoff-plankpi-mq` | 1 | 3 | 1 |
| `handoff-wo-69-ontology-primitives` | 1 | 2 | 2 |
| `handoff-wo-order-row-detail` | 1 | 3 | 3 |
| `handoff-wo-ot-instance-reach` | 1 | 2 | 2 |
| `handoff-wo-sandbox-candidates-fe` | 1 | 2 | 7 |
| `handoff-ceo6` | 1 | 1 | 1 |
| `handoff-wo-agentpath-hint-truth` | 1 | 1 | 1 |
| `handoff-causal-deepchain` | 1 | 0 | 1 |
| `handoff-geo-real-signal` | 1 | 0 | 1 |
| `handoff-metric-aware-gap` | 1 | 0 | 1 |
| `handoff-onto-writeback-p1` | 1 | 0 | 2 |
| `handoff-prd-audit-b3` | 1 | 0 | 5 |
| `handoff-prd-audit-b4` | 1 | 0 | 3 |
| `handoff-prd-audit-b5` | 1 | 0 | 4 |
| `handoff-prd-coverage-full` | 1 | 0 | 4 |
| `handoff-qos-live-evidence` | 1 | 0 | 1 |
| `handoff-sandbox-a10-audit` | 1 | 0 | 14 |
| `handoff-sandbox-a6-audit` | 1 | 0 | 14 |
| `handoff-sandbox-field-inventory` | 1 | 0 | 15 |
| `handoff-sandbox-gap-audit` | 1 | 0 | 1 |
| `handoff-skill-migration-scope` | 1 | 0 | 1 |
| `handoff-tier2-semantic-discover-v2` | 1 | 0 | 1 |
| `handoff-wo-0-nl-wiring` | 1 | 0 | 2 |
| `handoff-wo-66-rules-first-class` | 1 | 0 | 1 |
| `handoff-wo-a10-events` | 1 | 0 | 2 |
| `handoff-wo-a6-rule-scan` | 1 | 0 | 1 |
| `handoff-wo-a6-seg` | 1 | 0 | 1 |
| `handoff-wo-changeover-key` | 1 | 0 | 1 |
| `handoff-wo-delta-compare` | 1 | 0 | 1 |
| `handoff-wo-disposition-inline-row` | 1 | 0 | 2 |
| `handoff-wo-e2e-dialogue-acceptance` | 1 | 0 | 2 |
| `handoff-wo-gray-node-autofill` | 1 | 0 | 2 |
| `handoff-wo-metrics-audit` | 1 | 0 | 1 |
| `handoff-wo-modeling-interactive` | 1 | 0 | 1 |
| `handoff-wo-multiintent-l2` | 1 | 0 | 3 |
| `handoff-wo-multiintent-l3` | 1 | 0 | 4 |
| `handoff-wo-nl-robust` | 1 | 0 | 2 |
| `handoff-wo-ontology-ia` | 1 | 0 | 2 |
| `handoff-wo-pipeline-ui` | 2 | 0 | 2 |
| `handoff-wo-prd-field-audit` | 1 | 0 | 2 |
| `handoff-wo-qos-cross-domain-unified-graw0b` | 1 | 0 | 2 |
| `handoff-wo-82-peak-crossday` | 0 | 2 | 4 |
| `handoff-wo-82` | 0 | 1 | 1 |
| `handoff-wo-phase1-d-a` | 0 | 1 | 3 |
| `rescue-r13-drillfield-0811` | 0 | 1 | 10 |

### 3.2 判不了 27 条 —— 保留，需人工看

这 27 条的共同形态：**缺口 0、未并改动 0，但两边都动了同一批文件**。
按内容像已过期，但 canonical 日志从未提过本单（本单用**大小写不敏感**的搜索器重验：
**0/27 命中**，与审计一致）。**两条判据不打架但也不互证，我不替仓主裁决。**

⚠️ **不许把它们和 D 组混为一谈。** D 组有第二条独立信号（日志佐证）撑着，这 27 条一条都没有。
若只看「缺口 0 且未并改动 0」，这 27 条会和 D 组长得一模一样 —— **这正是本单不把它们归入可删的原因。**

| 分支 | 缺口 | 未并改动 | 领先 | 本单实测 +行/-行 |
|---|---|---|---|---|
| `handoff-tier3-cash-gm-attribution` | 0 | 0 | 1 | +142/-12 |
| `handoff-tier2-semantic-discover` | 0 | 0 | 2 | +225/-47 |
| `handoff-wo-flaky-timer` | 0 | 0 | 4 | +126/-34 |
| `handoff-wo-gsim-frontend` | 0 | 0 | 1 | +809/-85 |
| `handoff-wo-phase4-fallback` | 0 | 0 | 1 | +416/-17 |
| `handoff-qos-agent-speed` | 0 | 0 | 2 | +1050/-35 |
| `handoff-a3-fix` | 0 | 0 | 4 | +827/-54 |
| `handoff-ceo2` | 0 | 0 | 1 | +629/-4 |
| `handoff-ceo3` | 0 | 0 | 2 | +981/-4 |
| `handoff-wo-det-cross-domain` | 0 | 0 | 1 | +635/-4 |
| `handoff-cap-deepen` | 0 | 0 | 1 | +867/-9 |
| `handoff-ceo2v2` | 0 | 0 | 2 | +925/-61 |
| `handoff-wo-globalsim-drill-seam` | 0 | 0 | 2 | +885/-107 |
| `handoff-wo-harness-prompt-graw0b` | 0 | 0 | 1 | +176/-13 |
| `handoff-wo-qos-ontology-context` | 0 | 0 | 1 | +662/-3 |
| `handoff-wo-w5-business-type` | 0 | 0 | 1 | +613/-22 |
| `handoff-tier3-cash-gm-attribution-v2` | 0 | 0 | 1 | +166/-17 |
| `handoff-wo-dialogue-q1q2` | 0 | 0 | 1 | +447/-7 |
| `handoff-wo-gates-wire` | 0 | 0 | 1 | +14/-11 |
| `handoff-wo-gsim-agent` | 0 | 0 | 2 | +197/-2 |
| `integ-w1-cert5` | 0 | 0 | 8 | +3531/-112 |
| `handoff-capacity-daily` | 0 | 0 | 1 | +7/-1 |
| `handoff-ontology-drift-fix` | 0 | 0 | 1 | +2/-2 |
| `handoff-optwhatif-nl-wiring` | 0 | 0 | 1 | +826/-8 |
| `handoff-wo-d1-cancel` | 0 | 0 | 1 | +504/-14 |
| `handoff-wo-datacore-lazy-context` | 0 | 0 | 1 | +360/-15 |
| `handoff-wo-loop-control-p2p5` | 0 | 0 | 1 | +387/-8 |

---

## §4 · 审计已过期的部分（这几轮并线之后的变化）

### 4.1 原判「真欠账」、现已完整进 canonical 的：**1 条**

| 分支 | 审计定性 | 今天实测 |
|---|---|---|
| `handoff-wo-a6-contention` | 真欠账（§4.3 第 31 行，缺口 1 · 未并改动 7） | **领先 canonical 0 个提交**，`merge-base --is-ancestor` rc=0 ⇒ **已完整并入**，转入 B 组可删 |

并入路径：`9a54d5da`（canonical 并进 WO-A6 分支）→ `dfd42b06`（A6 存活变异体钉死）→ 合入 `9ee260ab`。

### 4.2 原判「真欠账」、但内容已被 canonical **另行实现**的：1 条（需改判，不是自动可删）

**`handoff-wo-scope-honesty-fe`** ——「求解器作用域诚实位上屏（欠账 #178）」。

它的 2 个缺口文件按路径确实还 ABSENT，但**同一个功能今天已经在 canonical 里，只是换了路径**：

| | 分支上的实现 | canonical 今天的实现 |
|---|---|---|
| 组件 | `src/views/ScopeHonesty.tsx` | `src/components/ScopeHonestyBadge.tsx` |
| 逻辑 | （在同一文件内） | `src/lib/solverScopeHonesty.ts` |
| 接缝测试 | `test/scope-honesty-fe.seam.test.tsx` | `test/solver-scope-honesty.seam.test.tsx` |
| 落地提交 | — | `ffeb5a55` + `c6aed8df`，经 `e6563d1c` 合入 |

两份文件的抬头注释指向**同一笔账**（分支写「WO-SCOPE-HONESTY-FE · 这次算的是谁」，
canonical 写「求解器作用域诚实位上屏（欠账 #178 · 后→前这一跳）」）。

⚠️ **这一形态 blob 级分类器看不见** —— 路径不同、blob 不同，它只会报 ABSENT。
**「canonical 里没有这个文件」≠「canonical 里没有这个功能」。**
连带影响：**`integ-ui-w5` 的缺口应从 9 降到 7**（它也带着同样这两个已被取代的文件）。

### 4.3 审计的 118 / 42 有没有因为这 15 个提交而变化？

**没有，一条都没有。** 逐条重算：

```
已过期 118 条 -> 缺口非 0 或 未并改动非 0 的: 0 条  ⇒ 复核通过 118/118
已收编  42 条 -> 缺口非 0 或 未并改动非 0 的: 0 条  ⇒ 复核通过  42/42
```

---

## §5 · 删除命令块（⛔ 本单没跑，交仓主执行）

**建议执行顺序：A → B → C → D → E，F 组等 `integ-ui-w5` 采收后再执行。**

> **这个命令块过了两道自动门**（不是我肉眼看的 —— 我第一版就写错了两处，是门抓出来的）：
> ```
> bash -n <命令块>                        rc=0        （第一版 `; do` 单独成行是语法错，rc=2）
> 每条 ref 是否真在远端存在               284/284 在   （第一版漏了 `claude/` 前缀，284 条全不存在）
>   金丝雀：'claude/inspiring-gates-aqczjg' 在集合里 True ·「claude/__ghost_7c1e__」在集合里 False
> ```
> ⚠️ **远端 ref 是 `refs/heads/claude/<名>`**，删除时**必须带 `claude/` 前缀**，
> 少写就是 284 条命令全部报 `remote ref does not exist`。

先做一次不可逆前的兜底（分支删了 reflog 不在远端，建议先落一份备份 ref 或至少存下清单）：

```bash
CANON=origin/claude/inspiring-gates-aqczjg
git fetch origin --prune
# 备份：把要删的分支名连同 sha 存一份，万一要复活
git branch -r --format='%(refname:short) %(objectname)' \
  --list 'origin/claude/handoff-*' 'origin/claude/integ-*' 'origin/claude/rescue-*' \
  > /tmp/branch-backup-$(date +%Y%m%d).txt
```

```bash
# ---- A 组 · 反向回退（绝不可合，只可删）（1 条）----
# 它的父提交 3e64870b 已在 canonical；分支尖端是它的回退（+0/-1819）。
for b in \
  claude/handoff-wo-gate-rc2
do
  out=$(git push origin --delete "$b" 2>&1); rc=$?
  printf '%-4s %s\n' "rc=$rc" "$b"
  [ $rc -ne 0 ] && echo "$out"
done

# ---- B 组 · 领先 canonical 0 个提交（内容 100% 已在 canonical，风险最低）（113 条）----
for b in \
  claude/handoff-audit-prd-sas \
  claude/handoff-check-dsl-cmp \
  claude/handoff-check-mig-xr \
  claude/handoff-check-rt-gov \
  claude/handoff-check-spec-aut \
  claude/handoff-perturbation \
  claude/handoff-prd-v2-agent \
  claude/handoff-prd-v2-skill \
  claude/handoff-prd-v2-slice \
  claude/handoff-process-layer \
  claude/handoff-propagate-perturb \
  claude/handoff-propagation-edges \
  claude/handoff-route-gate-base \
  claude/handoff-sandbox-batch-a2s3 \
  claude/handoff-sandbox-metro-prd \
  claude/handoff-sim-events \
  claude/handoff-skill-compiler-s1 \
  claude/handoff-skill-orchestrator-s1 \
  claude/handoff-skill-partial-a \
  claude/handoff-skill-partial-b \
  claude/handoff-skill-precond \
  claude/handoff-skill-refclosure-a \
  claude/handoff-wo-a6-contention \
  claude/handoff-wo-agent-admin-console \
  claude/handoff-wo-anchor-importline \
  claude/handoff-wo-base-unify \
  claude/handoff-wo-befe-seam-prosemask \
  claude/handoff-wo-befe-wire-3 \
  claude/handoff-wo-branch-reconcile \
  claude/handoff-wo-capacity-card-layout \
  claude/handoff-wo-capmap-live \
  claude/handoff-wo-cert-contract-reconcile \
  claude/handoff-wo-chain-map-layout \
  claude/handoff-wo-classify-filter \
  claude/handoff-wo-coord-terminal \
  claude/handoff-wo-d6-upserttype \
  claude/handoff-wo-databuilder-pipeline \
  claude/handoff-wo-decision-info-rebased \
  claude/handoff-wo-derived-intent-slot-deaf \
  claude/handoff-wo-dist-freshness-guard \
  claude/handoff-wo-docfix-skill-claims \
  claude/handoff-wo-engine-2 \
  claude/handoff-wo-engine-scope-fix \
  claude/handoff-wo-engine-scope-fix2 \
  claude/handoff-wo-engine-scope-forensics \
  claude/handoff-wo-f2-transit-wiring \
  claude/handoff-wo-factlock-anchor \
  claude/handoff-wo-fe-agent-trace \
  claude/handoff-wo-fe-layer-2 \
  claude/handoff-wo-fe-skill-studio \
  claude/handoff-wo-fe-wire-2 \
  claude/handoff-wo-fix-p1-regression \
  claude/handoff-wo-gate-befe-seam \
  claude/handoff-wo-gate-blindspots \
  claude/handoff-wo-gate-onto-2 \
  claude/handoff-wo-impediments-reachable \
  claude/handoff-wo-integration-loop \
  claude/handoff-wo-l7a-solver-taxonomy \
  claude/handoff-wo-mainline-reconcile \
  claude/handoff-wo-migration-collision \
  claude/handoff-wo-onto-anchor-recal \
  claude/handoff-wo-ontology-7elements \
  claude/handoff-wo-ontology-emit-blind \
  claude/handoff-wo-provenance-popover-legibility \
  claude/handoff-wo-r4-freeqa-gate \
  claude/handoff-wo-refgate-ent \
  claude/handoff-wo-risk-perfactor-series \
  claude/handoff-wo-route-1 \
  claude/handoff-wo-rule-scope-drop \
  claude/handoff-wo-sandbox-d2 \
  claude/handoff-wo-sandbox-d2-close \
  claude/handoff-wo-sandbox-d2-close2 \
  claude/handoff-wo-sandbox-d4 \
  claude/handoff-wo-sandbox-declutter \
  claude/handoff-wo-sandbox-e3 \
  claude/handoff-wo-sandbox-e4 \
  claude/handoff-wo-sandbox-e4-close \
  claude/handoff-wo-sandbox-f1 \
  claude/handoff-wo-sandbox-f2 \
  claude/handoff-wo-sandbox-f4 \
  claude/handoff-wo-sandbox-f4-close \
  claude/handoff-wo-sandbox-ia-consolidate \
  claude/handoff-wo-sandbox-s3-enum \
  claude/handoff-wo-sandbox-ui-integrate \
  claude/handoff-wo-sandbox-view-mount \
  claude/handoff-wo-scope-honesty-fe2 \
  claude/handoff-wo-seedgate-freshness \
  claude/handoff-wo-silent-wrong-answer-3 \
  claude/handoff-wo-sim-act-close \
  claude/handoff-wo-sim-perturb-timeline \
  claude/handoff-wo-sim-scope-trial \
  claude/handoff-wo-sim-trial-scope-reconcile \
  claude/handoff-wo-slice-16-layers \
  claude/handoff-wo-slice-16-layers-emptygraph \
  claude/handoff-wo-slice-default-args \
  claude/handoff-wo-slice16-reconcile \
  claude/handoff-wo-slot-entity-resolve \
  claude/handoff-wo-slot-harvest \
  claude/handoff-wo-testgap-audit \
  claude/handoff-wo-transit-geometry \
  claude/handoff-wo-ui-declutter-top3 \
  claude/handoff-wo-ui-layering-census \
  claude/handoff-wo-unblock-skill-fe \
  claude/handoff-worktree-stale-guard \
  claude/integ-s0-rest \
  claude/integ-sim-rec \
  claude/integ-w2-all \
  claude/integ-w2-all-fixed \
  claude/integ-w3-sandbox \
  claude/integ-wave-fe-3 \
  claude/integ-wave-fe-skill \
  claude/integ-wave-metric-4fe \
  claude/integ-wave-ui-11
do
  out=$(git push origin --delete "$b" 2>&1); rc=$?
  printf '%-4s %s\n' "rc=$rc" "$b"
  [ $rc -ne 0 ] && echo "$out"
done

# ---- C 组 · 已收编（42 条）----
for b in \
  claude/handoff-cleanroom-attr \
  claude/handoff-counterfactual-basesel \
  claude/handoff-debattery-fix \
  claude/handoff-debattery-fix-2 \
  claude/handoff-disruption-radius \
  claude/handoff-ext-signal-detail-be \
  claude/handoff-generic-whatif \
  claude/handoff-inference-prd \
  claude/handoff-memory-view-resilience \
  claude/handoff-mock-stubs \
  claude/handoff-prd-skill-compiler \
  claude/handoff-prd-skill-contract \
  claude/handoff-prd-skill-governance \
  claude/handoff-provenance-hover \
  claude/handoff-qos-budget-600s \
  claude/handoff-skill-agent-reconcile \
  claude/handoff-supply-demand-fe \
  claude/handoff-w9-windowdays \
  claude/handoff-wo-agent-runtime-s01 \
  claude/handoff-wo-d2d3-diag \
  claude/handoff-wo-d5d4-ux \
  claude/handoff-wo-factor-scope-singlesource \
  claude/handoff-wo-globalsim-suite \
  claude/handoff-wo-impact-propagation \
  claude/handoff-wo-impediment-fe \
  claude/handoff-wo-live-endpoints \
  claude/handoff-wo-multiplan-prd \
  claude/handoff-wo-node-semantics \
  claude/handoff-wo-ontology-7elem \
  claude/handoff-wo-prov-drillfield \
  claude/handoff-wo-r13-drillfield \
  claude/handoff-wo-reflect-loop \
  claude/handoff-wo-rule-expr-params \
  claude/handoff-wo-sandbox-d3 \
  claude/handoff-wo-sandbox-e2 \
  claude/handoff-wo-sandbox-s0 \
  claude/handoff-wo-sandbox-s3 \
  claude/handoff-wo-synth-validation-lite \
  claude/handoff-wo-testgap-triage \
  claude/handoff-wo-topo-realdata \
  claude/handoff-wo-unitprice-scale \
  claude/handoff-wo-waiting-states-fe
do
  out=$(git push origin --delete "$b" 2>&1); rc=$?
  printf '%-4s %s\n' "rc=$rc" "$b"
  [ $rc -ne 0 ] && echo "$out"
done

# ---- D 组 · 已过期（118 条）----
for b in \
  claude/handoff-wo-route-nav \
  claude/handoff-wo-opt-whatif-data \
  claude/handoff-wo-transit-wire \
  claude/handoff-wo-sim-scope-local \
  claude/handoff-wo-demo-lightup-2 \
  claude/handoff-wo-lever-binding \
  claude/handoff-wo-semantics-singlesource \
  claude/handoff-wo-zombie-audit \
  claude/handoff-wo-hardcoded-absence \
  claude/handoff-wo-console-cleanup \
  claude/handoff-wo-nav-gate \
  claude/handoff-wo-levers-rootcause \
  claude/handoff-fix-imp2plan-seam \
  claude/handoff-wo-opt-whatif-close \
  claude/handoff-wo-sandbox-console \
  claude/handoff-cross-object-multiobj \
  claude/handoff-wo-sandbox-a2 \
  claude/handoff-orderline-atpbase \
  claude/handoff-wo-decision-info \
  claude/handoff-wo-fix-dark-launch-gate \
  claude/handoff-atp-promise \
  claude/handoff-qos \
  claude/handoff-qos-wip \
  claude/handoff-wo-enterprise-state \
  claude/handoff-wo-stale-claims \
  claude/handoff-ceo-data-2 \
  claude/handoff-inventory-3tier \
  claude/handoff-wo-capacity-100pct \
  claude/handoff-wo-cert-honesty \
  claude/handoff-wo-chain-24 \
  claude/handoff-wo-dril-p4 \
  claude/handoff-wo-phase2-c \
  claude/handoff-wo-qos-cross-domain-unified \
  claude/handoff-wo-scenario-input-phase0 \
  claude/handoff-capacity-infer \
  claude/handoff-five-role-ai-employee \
  claude/handoff-interbase-transfer \
  claude/handoff-portfolio-optimal \
  claude/handoff-role-fallback \
  claude/handoff-seg-attr-scope \
  claude/handoff-warehouse-custloc \
  claude/handoff-wo-cap-demanddelta \
  claude/handoff-wo-dialogue-theme \
  claude/handoff-wo-dril-p3 \
  claude/handoff-wo-imp2plan \
  claude/handoff-wo-l2-decompose \
  claude/handoff-wo-live-disposition \
  claude/handoff-wo-resource-catalog-ontology \
  claude/handoff-wo-sandbox-e1 \
  claude/handoff-a3-refbase \
  claude/handoff-a3-refbase-wip \
  claude/handoff-base-outlook \
  claude/handoff-block-dialogue \
  claude/handoff-c1 \
  claude/handoff-capacity-infer-process \
  claude/handoff-capacity-timeline \
  claude/handoff-ceo-data \
  claude/handoff-ceo-q7 \
  claude/handoff-cockpit-infer \
  claude/handoff-decision-kernel-wire \
  claude/handoff-decision-play-fe \
  claude/handoff-exception-event \
  claude/handoff-fix-datacore-fake \
  claude/handoff-fix-frontend-fabricate \
  claude/handoff-gate-ledger \
  claude/handoff-globalsim-glass \
  claude/handoff-jobshop-schedule \
  claude/handoff-learning-loop \
  claude/handoff-ontology-context-a \
  claude/handoff-optimize-whatif-fe \
  claude/handoff-orderline \
  claude/handoff-prd-skill-migration \
  claude/handoff-prd-skill-runtime \
  claude/handoff-project-sim-whatif \
  claude/handoff-q7-reconciled \
  claude/handoff-qos-det-gate \
  claude/handoff-real-llm-free-query \
  claude/handoff-resource-descriptor \
  claude/handoff-sop-reschedule \
  claude/handoff-surface-7dim \
  claude/handoff-tier3-agent-timeout-fallback \
  claude/handoff-tier3-agent-timeout-fallback-v2 \
  claude/handoff-tier3-metric-rollup-split \
  claude/handoff-unit-normalize \
  claude/handoff-wo-76 \
  claude/handoff-wo-79 \
  claude/handoff-wo-80 \
  claude/handoff-wo-base-id-fidelity \
  claude/handoff-wo-capacity-provenance \
  claude/handoff-wo-caplive-truechain \
  claude/handoff-wo-chainnode-gate-widen \
  claude/handoff-wo-cockpit-wiring \
  claude/handoff-wo-context-compression \
  claude/handoff-wo-databuilder-harness \
  claude/handoff-wo-dril-p1 \
  claude/handoff-wo-dril-p2 \
  claude/handoff-wo-dril-precision \
  claude/handoff-wo-gsim-action \
  claude/handoff-wo-gsim-data \
  claude/handoff-wo-gsim-solver \
  claude/handoff-wo-gslive-live \
  claude/handoff-wo-gui4-multiobj-real \
  claude/handoff-wo-harness-prompt \
  claude/handoff-wo-loop-control-p1 \
  claude/handoff-wo-loop-control-p2 \
  claude/handoff-wo-memsim-optimizer \
  claude/handoff-wo-phase3-b \
  claude/handoff-wo-prompt-defaults-wiring \
  claude/handoff-wo-qos-cross-domain-unified-v2 \
  claude/handoff-wo-rules-classify \
  claude/handoff-wo-sandbox-d1 \
  claude/handoff-wo-sandbox-f3 \
  claude/handoff-wo-scene-concretize \
  claude/handoff-wo-seam-arg-drop \
  claude/handoff-wo-slice-connectivity \
  claude/handoff-wo-slice-governance \
  claude/handoff-wo-slice-governance-full \
  claude/handoff-wo-warm-structural
do
  out=$(git push origin --delete "$b" 2>&1); rc=$?
  printf '%-4s %s\n' "rc=$rc" "$b"
  [ $rc -ne 0 ] && echo "$out"
done

# ---- E 组 · 重复分支（各留超集，删被包含的那条）（4 条）----
# b1 -> 留 handoff-prd-audit-b2 ；decision-info-oncanonical -> 留 handoff-wo-decision-info-fe
# agentrun-attribution -> 留 handoff-wo-agentrun-fanout-persist（前者是后者的 git 祖先）
# 69-p2-function-signature -> 留 handoff-wo-69-p3-interface（前者是后者的 git 祖先）
for b in \
  claude/handoff-prd-audit-b1 \
  claude/handoff-wo-decision-info-oncanonical \
  claude/handoff-wo-agentrun-attribution \
  claude/handoff-wo-69-p2-function-signature
do
  out=$(git push origin --delete "$b" 2>&1); rc=$?
  printf '%-4s %s\n' "rc=$rc" "$b"
  [ $rc -ne 0 ] && echo "$out"
done

# ---- F 组 · ⚠️ 有条件：仅在 integ-ui-w5 已被采收进 canonical 之后才可删（6 条）----
# 实测：这 6 条自分叉起新增的每一行，都在 integ-ui-w5 里（0 行缺失）。
# 但 integ-ui-w5 本身今天仍有 7 个 canonical 缺的整文件 —— 没采收就删 = 真丢内容。
for b in \
  claude/handoff-wo-befe-seam-field \
  claude/handoff-wo-disposition-inline-row \
  claude/handoff-wo-ontology-ia \
  claude/handoff-wo-ot-instance-reach \
  claude/handoff-wo-order-row-detail \
  claude/handoff-wo-scope-honesty-fe
do
  out=$(git push origin --delete "$b" 2>&1); rc=$?
  printf '%-4s %s\n' "rc=$rc" "$b"
  [ $rc -ne 0 ] && echo "$out"
done
```

**删完自查**（现算，不写死）：
```bash
git branch -r --list 'origin/claude/handoff-*' 'origin/claude/integ-*' 'origin/claude/rescue-*' | wc -l
# 删完 A+B+C+D+E 后应为 393 - 278 = 115 条
```

---

## §6 · 审计文档 / 派单人哪里说错了

按 §0 通用前置「派单人写的任何事实若与你实测不符 —— 以你的实测为准，并在报告里顶回来」。

### 6.1 🔴 审计错了（最要紧）：`prd-audit-b4` 判成可删，实为不可删

见 §2.6。**审计对 b3/b5 查了 blob、对 b4 只查了路径**，于是把一份 82,540 字节的完成态
判成了 16,739 字节中间态的子集。这是本单发现的**唯一一处方向性错误**，也是唯一一条
「照审计做会真丢内容」的条目。

### 6.2 🔴 派单人错了：审计不是 2026-08-11 做的，是**今天**做的

派单原文：「审计是 **2026-08-11** 做的，canonical 之后又并了**好几轮**」。实测：

```
$ git log --format='%H %ci %s' -- docs/AUDIT-branch-reconcile-2026-08-11.md
9c98a95a  2026-08-13 07:09:51  WO-BRANCH-RECONCILE: 订正五处自查出的错数
fb5e46a7  2026-08-13 07:06:38  WO-BRANCH-RECONCILE: 281 条未并分支的内容级对账
$ git rev-list --count d3bf55d5..9ee260ab5   ->  15
```
文件名里的 `2026-08-11` 是误导：**审计文档本身 §0 就写着「实测日 2026-08-13」**，
落盘时间也是今天 07:06。它的 canonical 基线 `d3bf55d5` 距今天的 `9ee260ab5` **只有 15 个提交**，
不是「好几轮」。**这直接影响判断：审计的时效性远比派单人以为的好，所以 118/42 才会一条不变。**

（派单人列的「A6 / scope 诚实位 / 对账报告 / 降层 / 本体门」这几批，
实测**全部**落在这 15 个提交里，内容描述是对的，只有时间跨度错了。）

### 6.3 ⚠️ 审计的「118/118 全部有日志佐证（零例外）」依赖一个没写出来的归一化

本单用**分支名去前缀**得到的 slug 重跑，得 **114/118**。4 条未命中：

| 分支 | 严格 slug | 命中 | 基名 slug | 命中 |
|---|---|---|---|---|
| `handoff-qos-wip` | `qos-wip` | ✗ | `qos` | ✓ |
| `handoff-a3-refbase-wip` | `a3-refbase-wip` | ✗ | `a3-refbase` | ✓ |
| `handoff-tier3-agent-timeout-fallback-v2` | `…-v2` | ✗ | `tier3-agent-timeout-fallback` | ✓ |
| `handoff-wo-qos-cross-domain-unified-v2` | `…-v2` | ✗ | `qos-cross-domain-unified` | ✓ |

四条都是 `-wip`/`-v2` 变体，**剥掉后缀就全中**。所以审计的 118/118 **站得住**，
但「零例外」这个说法依赖一条它没写出来的归一化规则。**结论不改，方法要补写。**

### 6.4 ⚠️ 审计的日志佐证器是**大小写敏感**的，已产生至少一个假阴

审计 §4.3 第 31 行把 `handoff-wo-a6-contention` 记为「日志提过本单 = **否**」。实测：

```
$ grep -c 'a6-contention' <canonical 全量日志>   -> 0
$ grep -o 'A6[^\n]\{0,40\}' <同一份日志>       -> 'A6-CONTENTION 整段（C34 多主体谓词…'
                                                    'A6 跨业务线竞争规则（含一个…'
```
日志里有，只是**大写**。而这条分支今天**领先 canonical 0 个提交**——内容早就并进去了。
⇒ 审计那个「否」是它自己搜索器的假阴。**这个假阴是本单的金丝雀当场抓出来的**，
不是我想起来的：我把 `a6-contention` 放进已知必中样例，它报 False，逼我去查工具。

**影响面**：这条第二信号是审计用来把「已过期」与「判不了」分开的两条腿之一。
大小写假阴意味着**「判不了」那 27 条里，可能有本该判「已过期」的**。本单未展开重判
（那要逐条读 diff，超出本单范围），但**这个方法缺陷必须记账**。

### 6.5 ⚠️ 审计 §8 的「950 行」我复现不出来

审计写「1819 行纯删除…逐行核对，其中 **950 行** canonical 今天仍然有」。本单三种计法：

| 计法 | 数 | 仍在 canonical |
|---|---|---|
| `--stat` 删除行（含空行） | 1819 | — |
| 非空行 | 1661 | **1661（100%）** |
| 去重非空行 | 525 | **525（100%）** |

**950 落在任何一档之外。** 我的方法是「去首尾空白后逐行在 canonical 同批文件的行集合里查」。
**结论方向完全一致且更强**（审计说 52%，我测 100%），但那个具体数字请以本单为准。

### 6.6 ⚠️ 审计把最大的一堆可删分支排除在处置建议之外

审计 §10 明说「**没有碰 110 条领先 0 的分支**（它们按定义已全在 canonical）」，
§11 的处置汇总表因此只写了「可删 160」。但**领先 0 恰恰是最该删、也最安全删的一批**
（今天 **113 条**，逐条祖先关系验证通过）。
按内容判据它们是**零风险**，比 118 条已过期还稳。**处置建议漏了它，等于把 40% 的清理量留在桌上。**

### 6.7 ⚠️ 派单人给的「118 + 42 = 160 可删」这个数今天要改

派单原文：「审计判定 **118 条已过期 + 42 条已收编 = 160 条可删**」。
本单复核后**可删是 278 条**：160 + 113（领先 0）+ 4（重复）+ 1（gate-rc2）。
另有 6 条有条件可删。**派单人的 160 不是错，是漏 —— 少算了 118 条**
（= 113 领先 0 ＋ 4 重复 ＋ 1 反向；⚠️ 这个差额恰好也是 118，
与「118 条已过期」是两个不相干的数，别看串）。

### 6.8 ✅ 审计对的地方（逐条确认，不含糊）

| 审计结论 | 本单复核 |
|---|---|
| 118 条已过期可删 | ✅ 118/118 复核通过，换今天的 canonical 重算无一例外 |
| 42 条已收编可删 | ✅ 42/42 复核通过 |
| `gate-rc2` 是反向回退、绝不可合 | ✅ 确认，且本单给出更强证据（100% 而非 52%） |
| 反向回退只有 1 条 | ✅ 393 条全量普查确认，无第二条 |
| b3/b5 各有独有文档、不可当重复删 | ✅ 独立复核确认（blob + canonical 全仓 0 命中） |
| `integ-ui-w5` 顶 6 条 | ✅ 确认（我按 blob 一度判否，追到行级后推翻自己） |
| `decision-info-fe` ↔ `-oncanonical` 完全重复 | ✅ 且比审计更强：8/8 而非 5/5 |
| `agentrun-attribution` ⊂ `fanout-persist` | ✅ 且更强：是真 git 祖先 |
| `69-p2` ⊂ `69-p3` | ✅ 且更强：是真 git 祖先，缺口 5/5 而非 3/3 |
| 四个桶的条数（118/42/27/93） | ✅ 抽取器逐个核对，与文中表格**完全相等** |

---

## §7 · 覆盖声明 —— 做到第几条

**393 条全部做完，无截断、无抽样。**

- 枚举：`git branch -r --list 'origin/claude/handoff-*' 'origin/claude/integ-*' 'origin/claude/rescue-*'`
  → **393 条**（审计当日 391 条，今天多 2 条）
- **393 条每一条**都跑了：merge-base → 独有文件枚举 → SAME/DIFF/ABSENT 三态 →
  改名/有意删除排查 → 分叉点判别（未并改动）→ 方向量化（own +行/-行）。ERR **0 条**
- 其中 **160 条**（审计的 118+42）另跑了行级吸收率，逐文件计分
- **113 条**领先 0 的逐条跑了 `merge-base --is-ancestor` 交叉验证
- 重复分支组（prd-audit b1–b5 · decision-info ×2 · agentrun ×2 · 69-p2/p3）逐文件 blob 对照，
  外加 `integ-ui-w5` 对 6 条的**行级**覆盖复核
- 行数核对：已过期 118 + 已收编 42 + 领先0 113 + 真欠账 92 +
  判不了 27 + 反向 1 = **393** ✅

**本单没做的（明说）**：

- **没有删除任何分支**，没有 `git push --delete`，没有 `git branch -D`，没有合并，没有强推。
  `git push` 只推了 `claude/handoff-wo-branch-cleanup`。
- 没有对「判不了」那 27 条逐个读 diff 下人工定性 —— 需读数百个部分吸收文件的 diff，超出轻画像。
- 没有按 §6.4 的大小写假阴**重判**「判不了」那 27 条 —— 只记了账，没重跑分类。
- 没有验证任何欠账分支**能不能干净地 cherry-pick 回来** —— 那要建 worktree、装依赖、跑测试，属重画像，本单禁跑。
- 没跑任何测试套件 / `gate.sh` / `pnpm -r`（派单明令禁止，机器上有别的 dev 在跑 datacore vitest）。
- **没有把「路径 ABSENT」等同于「功能缺失」全量重判** —— §4.2 只查出 `scope-honesty-fe` 这一例
  「换路径重实现」。同类形态在其余 92 条真欠账里**可能还有**，本单未逐条排查。
