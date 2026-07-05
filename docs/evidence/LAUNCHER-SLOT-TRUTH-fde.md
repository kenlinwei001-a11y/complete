# LAUNCHER-SLOT-TRUTH — 真实测试实证（P0·最恶性静默错答·问合肥答常州绿标照发）

日期 2026-07-05 · 真起 datacore(4001) + agentcore(4012) 内存模式 · 真 curl 逐值对照。

## 治本 5 点

| # | 治 | 位置 |
|---|---|---|
| ① | extractedSlots 形状钉死（prompt 钉扁平 schema + adapter 注 + orchestrator 归一 `normalizeExtractedSlots`） | prompts.ts / anthropic.ts / router/slots.ts / orchestrator.proceedWithIntent |
| ② | 派生意图从 slotPresets 生成可绑定槽 + `applyExtractedArgOverrides` 让本轮显式真进求解器（破种子期烘焙） | mocks/seed.ts `deriveSlotsFromCard` / orchestrator.runPathA |
| ③ | 槽优先级 = 本轮显式 > 上一轮 chip > preset（fillSlots 重排：extraction > defaultFrom(chip) > preset） | router/slots.ts fillSlots |
| ④ | 答案回显所用关键实体/参数（基地/型号/月份/金额）→ 错配可见非静默 | orchestrator.buildSlotTruthBlocks |
| ⑤ | 无法映射 → 诚实横幅『你说的 X 未能对应…本次按 Y 作答』（记 substitution）绝不静默换题 | router/slots.ts substitutions + buildSlotTruthBlocks |

## 真起双服务 curl 实证（真 datacore·真 12 基地/24 订单）

真 datacore 有 12 个 Base 实例（changzhou/hefei/wuhan/… 逐值可查），affected_orders 求解器按基地真算受影响订单。

同一意图（affected_orders）三个**不同基地** → 三个**不同答案**，且每个答案**回显所用基地**（④）：

```
(A) chip=常州(changzhou)  → COMPLETED · slots.base={objectId:changzhou} · 表 6 行
    文本: 本次回答所用参数：基地=常州。
    文本: 受影响订单共 6 张，明细见上表 ⟦ref:0⟧。

(B) 本轮显式 base=hefei   → COMPLETED · slots.base={objectId:hefei}   · 表 8 行
    文本: 本次回答所用参数：基地=hefei。
    文本: 受影响订单共 8 张，明细见上表 ⟦ref:0⟧。

(C) 本轮显式 base=wuhan   → COMPLETED · slots.base={objectId:wuhan}   · 表 4 行
    文本: 本次回答所用参数：基地=wuhan。
    文本: 受影响订单共 4 张，明细见上表 ⟦ref:0⟧。
```

**逐值结论**：本轮供给的基地**真驱动答案**（6/8/4 张各异·非静默锁死某默认），且答案**回显实际所用基地**——
问 hefei 答 hefei（8 张）、问 wuhan 答 wuhan（4 张），**不再问 A 答 B 静默绿标**。④回显令任何错配肉眼可见。

> 说明（诚实边界）：本沙箱**无 live Kimi 密钥**（`a14-real-kimi.integration.test` 恒 skip），真服务的意图分类走
> `deterministic:example-match` 兜底（extractedSlots={}），无法在真 HTTP 端注入「按意图键嵌套的 extractedSlots」
> 与「与 chip 同轮冲突的本轮实体」。故本轮显式经**澄清回填**通道（真 HTTP `POST /queries/:id/clarification`）
> 注入真绑（上 B/C）。**根 A 嵌套归一**、**③ 本轮显式胜 chip**、**⑤ 诚实横幅** 由**进程内 HTTP 级齿检**
> （`test/launcher-slot-truth.test.ts` 16 例·跑真 orchestrator/slots/server via `app.inject` + 复刻 Kimi 嵌套形态）覆盖。

## 齿检（`test/launcher-slot-truth.test.ts` · 16 例 · revert→red）

- ① `normalizeExtractedSlots({affected_orders:{base:合肥}})` → `{base:合肥}`；已扁平/泛化嵌套三形态归一。
- ① **e2e**：queue 嵌套分类 `{affected_orders:{base:合肥}}` + chip=常州 → 答案 `slots.base.label=合肥`、回显「基地=合肥」、
  **不含「基地=常州」**；**revert（不归一原样喂 fillSlots）→ base 落 chip 常州**（红线复现）。
- ③ 本轮显式 合肥 胜 chip 常州；chip 胜 preset；无 chip 时 preset 兜底（点卡零反问）。
- ② `deriveSlotsFromCard(S20)` 键==`{modelId,baseName}`·全可选；派生意图种子 slots 非空且键==卡 slotPresets 键；
  `applyExtractedArgOverrides`：extracted 覆盖烘焙入参、preset/chip 不覆盖、objectRef 压标量、不改共享 plan 对象。
- ④ 回显块含「基地=合肥」；⑤ substitution → 顶部诚实横幅（含 attempted「火星基地」+ 改用值·「未能对应」·横幅在回显前）。
- ⑤ e2e：域外 火星基地 + chip 常州 → 答案含「火星基地」「未能对应」（非静默换题）。

## 测试/门

- `pnpm --filter agentcore test` → 461 passed(+16)/1 skipped · 四包 build 绿 · `pnpm gates` exit 0。
