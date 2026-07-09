# DECISION · deploy-0707 择要移植评估结论（dev·2026-07-09）

> WO `DEPLOY0707-PIPELINE-SALVAGE`（P3）。审核方 handoff（`HANDOFF-DEPLOY0707-SALVAGE.md`）staged `deploy0707-salvage.tar.gz`（14 文件·pipeline 源 + 5 PRD），要求 dev **先判并/不并·绝不造第二套并行建模引擎·不能裸拷须适配当前契约**。用户定：以 vigilant 为准·择要移植·失败=不落/零倒退。

## 结论：**不并**（pipeline 源码 + 5 PRD 全不移植）

逐项评估后，tarball 内**无任何真 additive、非重复**的部分——全部是 vigilant 已有能力的**旧分叉**（deploy-0707 基于很旧的 vigilant）。移植任一项都会违反移植纪律。

### A. pipeline / OntologyWorkflow 源码 → 不移植（判定：第二套并行引擎 + 契约缺位）

- **基建在当前 vigilant 完全缺位**：`OntologyWorkflow` / `OntologyWorkflowUpsert` 契约、`repos.ontologyWorkflows` 仓储、`OntologyWorkflowRecord` domain 类型在当前 vigilant **零命中**。pipeline 源引用这些不存在的接口 → **不能裸拷**，须先建整套契约 + 仓储双实现 + domain + service 接线 = **从零建一套引擎**，非 cherry-pick。
- **与既有 databuilder 高度重叠（绝不造第二套）**：vigilant 已有 `apps/datacore/src/databuilder/` **18 模块**成熟建模引擎——含 `workflow-engine.ts`（本体工作流）、`comprehend.ts`（故事→本体倒推）、`provisioners.ts`、`closure.ts`（双向闭包门）、`scaffold-manifest.ts`、`slice-coverage.ts` 等。deploy-0707 的 OntoFlow（一张画布 + 六节点 + 数据先行⊕图谱先行）是**同一概念的旧实现**。移植 = 造第二套并行建模引擎（handoff §二明令禁止）。
- **数据处理引擎（fold/aggregate/mask）已覆盖**：pipeline `processing.ts` 的分组折叠/聚合（Last/First/Sum/…）自述"与 timeseries 聚合同族"——vigilant `timeseries.ts` + solvers 聚合已覆盖此族。

### B. 5 个设计 PRD → 不并（判定：旧分叉·vigilant 已有更新的合并版）

| deploy-0707 文档 | vigilant 现状（更成熟·已合并） |
|---|---|
| `PRD-gap-analysis-engine-v2.md` / `-v3.md` | `docs/PRD-gap-analysis-engine.md`（当前合并版·无版本后缀）+ databuilder `selfcheck/fde-graph/service.ts` 实现 + agentcore `growth/probe` classifyGap |
| `PRD-ontoflow-v2-unified-modeling.md` | `docs/PRD-databuilder-page-unified-spec.md`（统一建模现行规格） |
| `PRD-ontoflow-data-builder.md` | `docs/DATA-BUILDER-PIPELINE.md` + `docs/PRD-prototype-intake-databuilder.md` |
| `DEV-NOTES-admin-row-mode-and-databuilder.md` | databuilder `prototype-intake.ts` + 两态（onboarding/operational·WO-BUILDER-ROLE）已实现 |

引入这些旧分叉 PRD 会与 vigilant 现行合并版**冲突/制造混淆**，非 additive。

### C. 不入 git 项（handoff §三）→ 维持不入
`db-seed/datacore-seed.sql`（159,780 行 dump）+ `deliverables/`（5.6MB 二进制）本就不宜入源码库；需要时走 `SEED_DEMO` 重生成 / 发布物存储。**无动作**。

## 回退与零倒退（用户加订）
本决策是**不落任何移植** → vigilant 主干**零改动、零倒退**（除删除本就应删的 transient salvage 材料）。无 commit 需 revert。若未来确需 OntoFlow 画布式建模 UX，应作为 databuilder **既有引擎之上的前端/编排增量**新开 WO（不复活并行引擎），而非移植旧源。

## 清理（handoff §四："移植完删除本 HANDOFF + tarball·handoff 不留库"）
- 删 `docs/HANDOFF-DEPLOY0707-SALVAGE.md`（transient·不留库）
- 删 `docs/deploy0707-salvage.tar.gz`（transient 移植材料·内容仍在 git 历史可查）
- 保留本决策记录（审计留痕：为何不并·可追溯）。

## 本体引用与影响
无。本决策**不触及**任何对象类型 / 链路 / 事件 / 不变量 / 门禁（零源码改动）→ 无需回写母体。
