# G·C6/C11/AC8 真浏览器验收 · 引用控件闭合 + 策略编辑器 + 权限 DSL

> 评审打回（REVIEW-VERDICT §1 轨G）："C6 ❌ ruleIds 裸 JSON 框 + 策略↔role 整缺 · C11 ◐ 权限侧裸缺违 D-28 · AC8 ❌ 全 jsdom 无真浏览器证据"。
> 本文件是补做的**真 chromium 浏览器**验收（连真 datacore:4001 + agentcore:4002 + vite dev）。复现：`UI_PORT=<vite> node scripts/ui-smoke-r6-policy-ruleids.mjs`。

## 1. 真改（代码）
- **C6 ruleIds → 引用多选**（`WorkflowsPage.tsx`）：evaluate_rules 步的 ruleIds 从 `json:true` 裸 JSON 框改为 `RuleRefMultiSelect`——ALL_APPLICABLE 单选 ⊕ 勾选具体已发布规则码（数据源 = 已发布规则库 `r.key`，空态去 /admin/rules 创建）。
- **C6 策略↔role 编辑器**（`PermissionsPage.tsx`，此前只读=死路）：新增 `PolicyEditor`——资源(kind+key) + role↔ops（READ/WRITE/EXECUTE 勾选，可加多行）+ 保存写回 `POST /a/v1/policies`（后端已存在）。
- **C11 权限侧 DSL**（`PermissionsPage.tsx`）：rowFilter 用 `DslTextarea`（补全数据源=对象类型属性），不再裸输入，闭 D-28。

## 2. 真浏览器 AC8 验收（chromium-1194，门B；jsdom 测不出死按钮 → 真点击）
`scripts/ui-smoke-r6-policy-ruleids.mjs`（admin 登录 demo/admin/demo1234 → pushState 导航 → 真点击/填写/断言）实测全过：
```
✓ C6/C11 /admin/permissions 策略编辑器渲染（此前只读无编辑器）
✓ C11 rowFilter 用 DSL 输入（非裸输入框，补全数据源=对象类型属性）
✓ C6 策略保存成功（policy-saved 徽章）
✓ C6 新策略真入表（8→9 行，写回 /a/v1/policies 生效）         ← 真持久化（GET 重读多一行）
✓ C6 evaluate_rules.ruleIds 渲染为规则引用多选（ALL_APPLICABLE 单选 + 规则码勾选；非裸 JSON textarea）
✓ R6 真浏览器验收通过
```
截图：`shot-r6-policy-editor.png`（策略编辑器 + role/ops + rowFilter DSL）· `shot-r6-ruleids-multiselect.png`（ruleIds 多选）。

## 3. 单测（jsdom 证渲染/逻辑，与浏览器互补）
`test/admin-r6-policy-ruleids.test.tsx`（2 例全过）：① 策略编辑器填 role/EXECUTE/rowFilter DSL → 保存 → policy-saved；② 加 evaluate_rules 步 → ruleIds 渲染为多选（ALL_APPLICABLE 单选 + 规则码勾选）。

## 4. 诚实边界
- C6 其余裸输入（如某些步骤的通用 args JSON）非 ruleIds 范畴，保持 ParamField（合理——任意 JSON 入参无固定引用源）。
- 策略编辑器为"新建"形态（POST 新策略）；编辑既有策略（PUT）未做（后端 POST 即 upsert by new id，编辑既有走删+建或后续补 PUT）。
- AC8 关键控件已真浏览器逐一点击验证；本轮聚焦评审点名的 C6/C11 三控件，其余 C5-C12 控件由 `ui-smoke-admin-closure.mjs`（轨G 原门B）覆盖。
