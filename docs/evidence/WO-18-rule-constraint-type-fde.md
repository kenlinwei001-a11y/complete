# WO-18 · 规则库纳入「约束条件」规则类型 — FDE 真值证据

> 源单 `HANDOFF-deep-scan-buildorders.md` WO-18（P1）。缺口：规则无 type；「约束条件」（类型化约束 GEO_WITHIN 等·原 C3 RESERVED）未作为规则的一种类型存在。**约束条件就是规则的一种**（评估/闸门语义·非求解器输入），统一在规则库管理、统一被引用。

## 实现

| 层 | 改动 |
|---|---|
| 契约 `contracts/datacore.ts` | `RuleTypeSchema=z.enum(["evaluation","constraint"])`；`RuleEntrySchema += ruleType?`（可选·缺省 evaluation 向后兼容） |
| 领域 `datacore/domain.ts` | `Rule += ruleType?` |
| 服务 `rules.ts` | `create` 入参 + 构造 `ruleType ?? "evaluation"`；`update` patch 允许 ruleType |
| 路由 `app.ts` | `RuleCreateSchema += ruleType?`（`.partial()` 自动流到 PUT 更新路由） |
| 前端 `RulesPage.tsx` | 规则/约束条件子页（typeFilter tab）+ 编辑器类型 select + 列类型徽章 |
| 引用控件 | `WorkflowsPage`/`AgentsPage` 规则选择器按 `status===PUBLISHED` 列规则、**不按类型过滤** → 约束条件发布即可被勾选（同库同引用，零改自动生效） |

## 真值证据 · 真起 datacore（create→publish→引用 全链）

```
POST /a/v1/rules {key:K01, ruleType:"constraint", expression: GEO_WITHIN(欧盟订单须欧盟基地), status:PUBLISHED}
  → created ruleType=constraint status=PUBLISHED ✓

GET /a/v1/rules:
  总规则=29 | {evaluation:28, constraint:1}        # 旧种子规则缺省落 evaluation（向后兼容生效）
  约束条件: ['K01']
  K01 in PUBLISHED(可被引用勾选): True             # workflow/agent/skill 引用控件列 PUBLISHED·约束条件在内
```

→ FDE 判据全过：① `/admin/rules` 有"约束条件"子页/筛（typeFilter tab + 列徽章）；② 建一条约束类规则→发布→ruleType 持久化为 constraint；③ 在 workflow/agent/skill 规则引用里**可被勾选**（与评估规则同库·picker 不按类型过滤）。

## 门

`pnpm -r build` 全绿；`pnpm -r test` contracts3/llm-adapters15/agentcore354/frontend289/datacore786 全绿（ruleType additive·optional·不破既有规则测）；`ontology:check` 绿。本体 §2.C 规则章 + G-10 回写。

## 距北极星（诚实）

- WO-18 闭：规则类型字段全链（契约/服务/路由/UI/引用）+ 真跑 create→publish→可引用。
- **类型化约束语义（GEO_WITHIN 求值实现）**：本单把"约束条件"作为**规则类型**纳入库 + 可声明 expression（用既有 DSL，如 IMPLIES 表达 GEO_WITHIN 语义）+ 统一引用。若需 GEO_WITHIN 作为**一等 DSL 算子**（专用空间约束求值）是更上游的 DSL 扩展（原 C3 类型化约束的完整落地·路线图），本单未含——当前约束条件用既有 DSL 表达式承载，诚实标注。
- 引用控件可加"类型徽章"区分（现 picker 仅列名称+key）——P3 抛光，非阻断。
