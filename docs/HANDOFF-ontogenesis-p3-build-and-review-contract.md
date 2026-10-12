# HANDOFF · 场景发育闭环 G-9 收尾(P3) · 开工与评审合同

> **这是 H6**（见 `HANDOFF-ROADMAP.md`）。让场景卡"缺什么自动补什么"真闭环，PROVISIONAL 卡能自动长成 GOVERNED。
>
> ⚠️ **特殊背景（防白干）**：本体 §8 G-9 说"待 P3 余：rules 自动接/slice 自动生成/GapReport→runGrowthLoop"。2026-06 摸底：**P1+P2 全部已落，且 P3 三个函数全都已存在**——`runGrowthLoop`(`growth/loop.ts:17` 完整)、`planSlice`(`slice-planner.ts`)、规则解析(`server.ts:961`)。**真缺口只是 `growScenario()` 没调它们 + ADVISORY 相位。这是 wiring，不是从零建。重写这三个函数=红线打回。**

---

## 0. 先读：`SYSTEM-ONTOLOGY §8 G-9` · `PRD-scenario-ontogenesis.md` · `START-HERE-dev-agent.md` · 本文件 §1 · fde-delivery。

## 1. 《源↔现状↔设计》追溯表（H6 宪法）

| # | 元素 | 现状(锚点) | H6 处置 |
|---|---|---|---|
| O1 | 多租户 per-id 幂等播种 | **真实** `agentcore/server.ts:1777-1792` ensureScenarios | 不建 |
| O2 | 确定性绑定(跳 LLM classify) | **真实** `server.ts:2048` scenarioIntentKey | 不建 |
| O3 | grow=验证即上架门(真出数据块才 GOVERNED 否则 PROVISIONAL+gapCode) | **真实** `server.ts:2030-2103` growScenario | 不建 |
| O4 | 留痕 ScenarioOntogenesisRun + 事件 matured/gap_detected | **真实** `contracts/agentcore.ts:221-238` + `server.ts:2100-2101` | 不建 |
| O5 | P2 投影渲染(solver_summary 通用) + BP-4 sop 真数据 | **真实** `mocks/seed.ts:219,412-421` | 不建 |
| O6 | ontogenesis:check 逐卡静态断言 | **真实** `scripts/check-ontogenesis.mjs` | 不建 |
| O7 | runGrowthLoop 函数(倒序补齐) | **真实(函数在)** `growth/loop.ts:17-68` | 复用,不重写 |
| O8 | planSlice 多跳切片 | **真实(函数在)** `ontology/slice-planner.ts` | 复用,不重写 |
| **O9** | **growScenario 自动调 runGrowthLoop(缺则自动补)** | **🟡 桩** `server.ts:2087-2102` 只记 gap 不调 loop | **增量1（P0）** |
| **O10** | **卡 ruleIds → 自动插 evaluate_rules 步** | **🟡 桩** 仅 3/20 卡手工有(`seed.ts:179,236,561`)，无自动 | **增量2（P1）** |
| **O11** | **卡 sliceTargets → 自动调 planSlice 生成 resolve_slice 步** | **🔴 缺** growScenario 未调 planSlice | **增量3（P1）** |
| **O12** | **ADVISORY 成熟相位(三态)** | **🔴 缺** `contracts/agentcore.ts:217` enum 仅 PROVISIONAL/GOVERNED | **增量4（P2）** |
| O13 | ScenarioGenome 契约 | **不需要**(卡字段已覆盖,摸底结论) | 不建 |

> **不建（防重写）**：O1–O8、O13。**H6 范围 = O9/O10/O11(三个 wiring) + O12(ADVISORY)。**

## 2. 范围
**建（wiring，非新引擎）**：growScenario 调 runGrowthLoop(O9)/自动插 evaluate_rules(O10)/自动调 planSlice(O11)；ADVISORY 三态+`scenario.growth_triggered` 事件(O12)。**不建**：三个被调函数本身(都在)。**先验**：增量0 grow 一张 PROVISIONAL 卡，确认现状"只记 gap 不自动补"。

## 3. 增量（每增量 DoD：亲手真跑 + 门绿）

| 增量 | 做什么 | DoD |
|---|---|---|
| **0** 真跑定基线 | 起 agentcore，对一张缺件的 PROVISIONAL 卡 `POST /b/v1/scenarios/:key/grow` | 贴证据：现状=记了 gaps+disposition 但 maturity 停在 PROVISIONAL,不自动补 |
| **1（P0）** O9 自动调 loop | `server.ts:2087-2102` 末段：gap.disposition==AUTO_DERIVE → 调 `runGrowthLoop` 重验直到 CONVERGED/BOUNDARY；发 `scenario.growth_triggered` | grow 一张缺件卡→**自动补齐→GOVERNED**(贴前后对比)；BOUNDARY(NEEDS_HUMAN)诚实停+开 GrowthTicket,不静默 |
| **2（P1）** O10 自动插 evaluate_rules | growScenario 从卡 `rules[]`/`ruleIds` 自动生成 evaluate_rules 步埋进计划(复用 `server.ts:961` 解析) | 带 rules 的卡 grow 后计划含 evaluate_rules 步,推演真出 PASS/WARN/BLOCK(贴证据);确定性 R6 |
| **3（P1）** O11 自动调 planSlice | growScenario 遍历卡 `sliceTargets[]` → 调 `planSlice` 生成 SliceSpec → 埋 resolve_slice 步 | 带 sliceTargets 的卡 grow 后切片库出现新切片,executeSlice 真解析子图(贴证据) |
| **4（P2）** O12 ADVISORY 相位 | `contracts/agentcore.ts:217` enum 加 ADVISORY(已审核未验证中间态);maturity 流转 PROVISIONAL→ADVISORY→GOVERNED | 卡可处于 ADVISORY;前端 badge 显三态;`ontogenesis:check` 适配 |

## 4. 红线
十红线(尤 **RL3** 不重写 runGrowthLoop/planSlice/规则解析 · **RL4** grow 验证真出答案才 GOVERNED,不放水 · **RL6** 确定性 · **RL8** 倒序发育)。**诚实门**：自动补失败→PROVISIONAL+gapCode+GrowthTicket,**绝不静默标 GOVERNED**。stale-source:以 §1 锚点为准。模型标识不进提交物。

## 5. 评审协议
①十红线(尤 RL3/RL4) ②门全绿(+ontogenesis:check) ③本体回写(G-9 状态/ADVISORY) ④**§1 追溯表逐行核**(O1-O8 没重写、O9-O12 真做) ⑤**FDE 亲手证据**:增量1 必附"缺件卡→自动补→GOVERNED"真跑(不认测试绿) ⑥**诚实门专核**:自动补不了的卡是否诚实 PROVISIONAL+开票,没假装 GOVERNED ⑦CLI+可回退+北极星距离。

## 6/7. 提交按 `START-HERE §6`;起步=增量0(grow 一张 PROVISIONAL 卡,贴现状)。push 前 rebase,只推 `claude/vigilant-knuth-b1nmxn`。
