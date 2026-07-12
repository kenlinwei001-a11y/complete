# WO-QOS-CLASSIFY-REBALANCE — 修复 QOS 分类器示例失衡致 signal_propagation_q / shared_bottleneck_q 误路由

> owner: dev4 · P1 · 用户亲定实现spec 2026-07-12 · 原始bug"未来30天每个瓶颈会影响订单的交付？"→"缺乏方案比对"

## 问题根因
`apps/agentcore/src/mocks/seed.ts`：`what_if_displacement_q` 意图有 **3 条示例**（~line 543），而从 `SCENARIO_CATALOG` 自动派生的意图（含 `shared_bottleneck_q` / `signal_propagation_q`）只有 **1 条示例**（`card.triggerQuestion`，~line 605 / ~line 663）。LLM classify 时，示例多的意图在语义重叠问句上抢占匹配 → 本应路由 signal_propagation_q / shared_bottleneck_q 的问句被误分到 what_if_displacement_q → 进错计划 `plan_what_if_displacement_q_v1` → step `multi_plan_compare` 因缺 `args.schemes` 报错"缺乏方案比对"。

（注：直接 `invoke_solver("signal_propagation")` 不带 rootType/rootId/layers 抛 400 是**合理校验**·service.ts:1357-1379·非本单——本单只修 NL→分类误路由。）

## 修复目标
让 `shared_bottleneck_q` / `signal_propagation_q` 示例数 ≥3，与 `what_if_displacement_q` 持平，覆盖用户真实问法（含时间窗口/瓶颈影响/传导扩散语义）。

## 修改（`apps/agentcore/src/mocks/seed.ts`，仿现有 ARG_OVERRIDE 模式新增 EXAMPLES_OVERRIDE）
1. ARG_OVERRIDE 声明附近（~line 622）新增：
```ts
const EXAMPLES_OVERRIDE: Record<string, string[]> = {
  shared_bottleneck_q: [
    "多条产线抢同一个瓶颈资源，谁被挤最狠？",
    "未来30天哪些基地共享同一个瓶颈？影响有多大？",
    "各产线争用瓶颈设备，哪条产线会被挤占最多产能？",
  ],
  signal_propagation_q: [
    "某个信号从常州基地沿产线图传导，会扩散到哪些工序设备？",
    "未来30天每个瓶颈会影响订单的交付？",
    "产能扰动从基地传到产线再到设备，影响半径有多大？",
  ],
  // 如有其他单示例意图也失衡，可一并补充
};
```
2. 两处 examples 生成改为查 override：
   - CHAIN_WORKFLOWS 循环（~line 605）：`examples: EXAMPLES_OVERRIDE[ch.intentKey] ?? [card.triggerQuestion],`
   - SCENARIO_CATALOG 循环（~line 663）：`examples: EXAMPLES_OVERRIDE[card.intentKey] ?? [card.triggerQuestion],`

## 约束
- 示例人话/自然·含时间窗口词("未来30天")+关键词(瓶颈/传导/扩散/影响)。
- **不得与 what_if_displacement_q 示例(急单/加单/挤占/接单)语义重叠**。
- EXAMPLES_OVERRIDE key 与 card.intentKey 严格一致。
- `pnpm -r build && pnpm -r test` 全绿（datacore≥69 / agentcore≥66 / frontend≥25）；分类器单测计数断言若挂则同步修。

## 关联修复点（同族·用户根因补全）
- **计划容错**：`multi_plan_compare` 在 `args.schemes` 缺失时**降级为单方案推演**·不抛"缺乏方案比对"（硬失败→优雅降级）。
- **信号传播意图**：确认 S30 场景卡 `presetContext` 已预填 `{rootType,rootId,layers}`（seed.ts 已做）→ 场景触发不缺参。

## 铁律0 回写
若改动改变意图示例/分类行为 → `docs/SYSTEM-ONTOLOGY.md` §3链路 或 §8 QOS 补一句示例覆盖说明（或确认无需）；跑 `pnpm ontology:slices`·守 `ontology-slices:check` 不红。

## 验收（审核方真跑）
- `git diff` 显示 EXAMPLES_OVERRIDE 存在且仅改上述两处 examples 赋值。
- 真起 DataCore 4001 + AgentCore 4002 内存模式：
```
curl -s -X POST http://localhost:4002/b/v1/query -H "Content-Type: application/json" \
  -H "X-Debug-User: demo:admin:admin" \
  -d '{"query":"未来30天每个瓶颈会影响订单的交付？"}' | jq '.classification.candidates[0].intentKey'
```
→ 应返回 `signal_propagation_q` 或 `shared_bottleneck_q`（不再 what_if_displacement_q）。
- 全包测试绿。
