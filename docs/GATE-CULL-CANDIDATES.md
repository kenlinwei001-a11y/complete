# 门系统裁撤候选标记（2026-08-20）

> **状态：只标记，不删除。** 仓主指令：「你先做标记，以后我要求你彻查冗余代码时就删除」。
> 同批指令：**冻结** —— 门数不再增长，`dispatch-deficit.sh` 停止用于派单。

## 为什么要这份标记

现算体量：门脚本 **101 个 / 40379 行** + 基线 36 份 / 7484 行，
合计约 **47863 行 ≈ 产品源码（230,688 行）的 21%**。

来历（仓主问「谁让你做的」，如实答）：仓主只直接要求过三条 ——
「绿测试≠能用」(SEAM-GATE) · 「少于 4 个 agent 就触发派单」(`dispatch-deficit.sh`) ·
「复验发现的问题自己解决」。**其余是照 `CLAUDE.md` 铁律 0.6「同一个错第二次必须建机制」
一道道自增长出来的，而那条铁律本身也是审核方自己写的。**

2026-08-20 单日实测：交付 19 张 WO，**改到产品行为的 5 张，维护本系统的 14 张**。

## 判据（唯一一条，不许加第二条）

> **这道门删了，用户会不会看到坏东西？**
> · 会 ⇒ **A 类·留**
> · 不会，只是审核方会再犯一次记账错误 ⇒ **B 类·删**
> · 守某个具体特性的接线，价值随该特性走 ⇒ **C 类·冻结**，等真机跑过再判

## A 类 · 留（24 道）
守产品正确性 / 安全 / 可读性。删任一条都会让用户看到坏东西。

- `check-action-wiring.mjs`
- `check-backend-frontend-seam.mjs`
- `check-case-collision.mjs`
- `check-css-token-defined.mjs`
- `check-dark-launch-integrity.mjs`
- `check-dist-freshness.mjs`
- `check-feature-default-parity.mjs`
- `check-file-truncation.mjs`
- `check-genuine-sim.mjs`
- `check-layout-legibility.mjs`
- `check-merge-conflict-markers.mjs`
- `check-migration-numbering.mjs`
- `check-mock-backend-scale.mjs`
- `check-mock-fidelity.mjs`
- `check-no-hardcoded-rules.mjs`
- `check-no-raw-nul.mjs`
- `check-opt-determinism.mjs`
- `check-outsource-redline.mjs`
- `check-redline-wired.mjs`
- `check-screen-value-provenance.mjs`
- `check-solver-license.mjs`
- `check-text-legibility.mjs`
- `check-ui-first-layer.mjs`
- `check-validation.mjs`

⚠️ 其中 `layout-legibility` / `ui-first-layer` / `text-legibility` **正是在守仓主 2026-08-20
抱怨的那件事**（「太多说明性文字，密密麻麻」）—— 这三条尤其不许删。

## B 类 · 裁撤候选（34 道 · 约 17506 行）
守的是审核方自己的记账（本体行状态、台账划没划掉、门自己的账、分支纪律、声称强度…）。
删了产品行为一字不变；代价是审核方的自查变成人工。

- `check-baseline-writer-honesty.mjs`
- `check-branch-base.mjs`
- `check-chain-scan-honesty.mjs`
- `check-claim-strength.mjs`
- `check-coverage-blind.mjs`
- `check-crossbranch-reinvent.mjs`
- `check-dev-jargon-onscreen.mjs`
- `check-fact-usage.mjs`
- `check-factlock-anchor.mjs`
- `check-gate-exit-discipline.mjs`
- `check-gate-ledger.mjs`
- `check-gate-reach.mjs`
- `check-gate-roster-handcopied.mjs`
- `check-handoff-integration.mjs`
- `check-harness-ux-splitaccount.mjs`
- `check-meta-sync.mjs`
- `check-name-consistency.mjs`
- `check-ontology-anchors.mjs`
- `check-ontology-descriptions.mjs`
- `check-ontology-s8-dedupe.mjs`
- `check-ontology-s8-status.mjs`
- `check-ontology-slice-coverage.mjs`
- `check-ontology-writeback.mjs`
- `check-prd-coverage.mjs`
- `check-prd-data-grounding.mjs`
- `check-prd-ontology.mjs`
- `check-req-coverage.mjs`
- `check-sim-ux-criteria.mjs`
- `check-stale-claims.mjs`
- `check-system-ontology.mjs`
- `check-typecheck-coverage.mjs`
- `check-verdict-rollup.mjs`
- `check-wo-anchors.mjs`
- `check-worktree-canonical.mjs`

**连带要删的**：`scripts/*-baseline.json` 里只服务上述门的那些 · `package.json` `gates` 串里对应段 ·
`scripts/gate-ledger.json` 里对应条目。

## C 类 · 冻结（43 道）
守具体特性接线。**不删不加**，等 `docker compose up` 真跑一轮后，看哪些从没拦住过东西再定。

- `check-agent-config-complete.mjs`
- `check-arg-drop-seam.mjs`
- `check-boundary-singlesource.mjs`
- `check-bstack-derive.mjs`
- `check-carrier-has-instances.mjs`
- `check-chain-closure.mjs`
- `check-chain-node-singlesource.mjs`
- `check-cli-parity.mjs`
- `check-cockpit-widgets.mjs`
- `check-dbui-flow-order.mjs`
- `check-debattery.mjs`
- `check-deploy-governance.mjs`
- `check-derived-recompute.mjs`
- `check-dril-quality.mjs`
- `check-dril-registry.mjs`
- `check-dril-retrieval.mjs`
- `check-dsh-dormancy.mjs`
- `check-edge-active-mounts.mjs`
- `check-function-signature.mjs`
- `check-lever-binding-drift.mjs`
- `check-lever-landing-exists.mjs`
- `check-lever-prop-resolvable.mjs`
- `check-link-stabilize.mjs`
- `check-loop-control.mjs`
- `check-modeling-wire.mjs`
- `check-nav-group-coverage.mjs`
- `check-object-interface.mjs`
- `check-oee-ssot.mjs`
- `check-ontogenesis.mjs`
- `check-opt-template.mjs`
- `check-propagation.mjs`
- `check-quantile-field-naming.mjs`
- `check-ref-closure.mjs`
- `check-resource-descriptor.mjs`
- `check-rule-closure.mjs`
- `check-scenario-slot-keys.mjs`
- `check-sim.mjs`
- `check-sim-readiness.mjs`
- `check-slice-connectivity.mjs`
- `check-solver-arg-key-drift.mjs`
- `check-solver-field-seam.mjs`
- `check-unit-value-provenance.mjs`
- `check-view-reachable.mjs`

## 执行时的两条纪律

1. **删门要连基线、`gates` 串、门账一起删** —— 只删 `.mjs` 会让 `pnpm gates` 直接崩。
2. **删之前先跑一次 `pnpm gates` 存基线**，删之后再跑一次逐条对比：
   剩下的门 RC 必须与删前**逐条相同**。任一条从绿转红 ⇒ 说明删掉的那道门在被别人依赖，退回。

## 名单自检（金丝雀）
分类表里每个名字都在磁盘上有对应门文件（A+B+C 全覆盖，无遗漏无幻影）✅
