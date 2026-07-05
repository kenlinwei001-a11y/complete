# 证据 · SLOT-CLARIFY-HUMANIZE（用户亲报·真起真跑复现）

真起 datacore(4001·SEED_DEMO) + agentcore(4002) 内存模式；X-Debug-User=demo:user-admin:admin。
两层根因逐一复现（真服务·真数据·真值对照）。租户 demo · 包 pkg_battery_manufacturing。

## 根因① 澄清人话化（裸内部 key → 人话+单位+示例+取值域）

**用户亲报形态（修前）**：`clarifyPromptFor` 无视 `slot.description`，直接落兜底裸名 → 澄清弹「请提供demandDelta」。

**修后·真服务 SSE 事件**（capacity_feasibility 缺 demandDelta → SLOT_FILLING 澄清）：

```
POST /api/v1/queries  query="4680-NCM 加 20% 六周能不能接？"  context.selectedObjects=[Model 4680-NCM]
event: clarification.required
data: {"kind":"SLOT_FILLING","slots":[
  {"name":"model","type":"objectRef","prompt":"请指明要评估的型号（如 4680-NCM / M3P-标准；也可在页面选中型号自动带入）"},
  {"name":"demandDelta","type":"number","prompt":"请提供需求增量比例（0~1 的小数，如 0.2 表示 +20%；可为负数表示下调，只填数字不带百分号）"}
],"round":1}
```

- before = `请提供demandDelta`（裸内部参数名）
- after  = `请提供需求增量比例（0~1 的小数，如 0.2 表示 +20%；可为负数表示下调，只填数字不带百分号）`（人话 + 单位 + 示例 + 取值域）
- 全站零「请提供<英文camelCase>」形态（门 `clarify-humanized:check` 遍历 40 个 PUBLISHED Intent·12 必填槽守死）。

## 根因② 场景卡改写问句（自由路径）继承卡 presetSlots

前端点卡后 `store.setConversationId(res.taskId)`；对话坞改写问句走 buildContext（PRD §6.2 固定·不带 presetSlots），
仅 conversationId 指向卡的父任务。orchestrator 按会话血缘从父任务继承 presetSlots 作默认。

| 步 | 请求 | 结果 |
|---|---|---|
| 父任务 | `POST /b/v1/scenarios/S01/launch`（presets demandDelta:0.2） | `COMPLETED · capacity_feasibility · demandDelta=0.2` |
| 自由改写 | `POST /api/v1/queries` query="4680-NCM 需求上调后能不能交付" context.conversationId=父taskId·**无 presetSlots** | `COMPLETED · capacity_feasibility · demandDelta=0.2`（**继承·未被反问**·无 clarification.required） |
| 对照组 | 同一 query 但**无 conversationId** | `AWAITING_CLARIFICATION`（demandDelta 被反问·证明继承是差异因） |

对照组的 demandDelta 反问文案同样人话（根因①同源）：
`请提供需求增量比例（0~1 的小数，如 0.2 表示 +20%；可为负数表示下调，只填数字不带百分号）`。

## 齿检（revert→red 自证）

- `apps/agentcore/test/clarify-humanize.test.ts`（6 齿·全绿）：
  - ① `clarifyPromptFor` 优先级 clarifyPrompt ?? description ?? name（revert 描述兜底 → 红）；
  - ① 全 PUBLISHED Intent 必填槽零裸 key（门同源）；
  - ② 卡改写继承（实验组继承·对照组反问；revert `inheritScenarioPresets` → 实验组转 AWAITING_CLARIFICATION 红）。
- 门 `clarify-humanized:check`（`scripts/check-clarify-humanized.mjs`·并入 `pnpm gates`）：遍历全 PUBLISHED 必填槽·缺 clarifyPrompt 且缺 description → 红。
- 全量：`vitest run apps/agentcore` = 445 passed / 1 skipped（含本单 6 齿）。
