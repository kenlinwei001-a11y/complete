# WO-DRIL-P2~P4 · 混合检索 + 图谱质量分 + Router 接入（DRIL 上层·三阶段串行）

> 一句话：DRIL-P1（契约+Registry）已落。P2~P4 把它变成能用的资源路由器——向量检索、图谱质量分、接进 agent。**三阶段串行**（后依赖前），可一个 dev 整三单。

## 依赖
- **DRIL-P1 已合入 canonical**（契约 IntelligenceResource + Registry + `GET /b/v1/resources`）。
- P2→P3→P4 **严格串行**（同 dril 文件·后依赖前）。

---

## P2 · 五级标签 + 混合检索
- **🚦边界**：`apps/agentcore/src/dril/{tag-taxonomy,search-engine}.ts`(新) · 标签回填脚本 · `server.ts`(加 search 端点)
- **产出**：`TieredTags`(L1业务域/L2决策类型/L3场景/L4对象/L5算法) + `DRIL_TAG_TAXONOMY` + 为现有 solver/slice/operation 回填 tieredTags（L4 从已发布 OntologyType 派生·R14 禁手写业务名）+ `ResourceSearchEngine`（structured filter → embedding → ranking·打分 0.35语义+0.25域+0.20本体+0.10历史+0.10成本）+ `POST /b/v1/resources/search`（返 scoreBreakdown+explanation）+ `retrieve_knowledge` 工具。
- **fail-open**：无 embedding → 退关键词；无 LLM → 退 domainResolve 正则。**不阻断**。
- **SEAM** `dril-retrieval:check`：golden query set 预期资源进 top-3 ≥90%；无 embedding 退关键词字节兼容。

## P3 · 图遍历 + 质量分（跨 A+B·一个 dev 整）
- **🚦边界**：`apps/agentcore/src/dril/{relations,quality}.ts`(新) · `router/compile-plan.ts`(接) · `evals.ts`(parity 回灌钩子)
- **产出**：`resource_relations` 自动抽取（solver.reads→objectType、rule.scope、slice.includes、workflow.step）+ `graphDistance`(复用 datacore `planSlice` BFS·R6) + 运行时质量分 EWMA + `ResourceRouter.buildResourcePackage` 接 `compileSolverPlan`。
- **SEAM** `dril-quality:check`：模拟调用后 quality EWMA 更新·低质资源排名下降。

## P4 · Router 接 Path-B + 治理 UI（跨 A+B·一个 dev 整·**等 WO-0 落地**）
- **🚦边界**：`router/orchestrator.ts`(注入 DRIL 包) · `agent/tools/*`(discover 改查 Registry) · `frontend/pages/admin/ResourcesPage.tsx`(新页)
- **产出**：`runPathB` 注入 `drilContext` 到 system prompt + `discover` 优先查 Registry + `/admin/resources`(列表/标签编辑/质量分/关系图) + 六路由器(Ontology/Solver/Rule/Skill/Workflow/Agent)分 kind 出口。
- **SEAM**（头号判据）`dril-routing-seam`：NL query → DRIL 选对 solver+slice+rule → Compose/Agent 执行 → 答案可溯源（runAgentLoop ≤4 或 Compose 零 agent）。

## 硬约束（三阶段共守）
- **R6/FUS2**：检索/打分/标签/图遍历确定性；embedding advisory **永不进确定性求解路径**。
- **R13**：Registry/Tags/Quality/关系全派生·非新真值源。
- **R3**：未开通 feature 资源不出现在检索结果。
- 四包全绿；handoff `claude/handoff-wo-dril-p2` / `-p3` / `-p4`。

## 参考
`docs/PRD-decision-resource-intelligence-layer.md` §5~§10（你的差距分析·权威）；`docs/BLUEPRINT-DRIL-decision-dialogue.md` §1 阶段③。
