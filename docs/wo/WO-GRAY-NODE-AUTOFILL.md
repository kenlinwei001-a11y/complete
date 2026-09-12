# WO-GRAY-NODE-AUTOFILL · 灰节点（物流时长/设备OEE）从"诚实灰"变"自动补齐起点"

> 一句话：产能推演里物流时长/设备OEE 时序节点是"诚实灰"（EMPTY_DATA·无逐日源）——现在停在终点。本 WO 让它触发数据构建发动机自动补时序，灰→有数（PROVISIONAL）或→精确 DataRequest。

## 背景（审核方已核实·真跑铁证）
- `RiskBoardView.tsx:50-65`：值为空（无实测/无逐日时序源）→ 中性灰 + 徽章"合成·未接实测"（KILL-MOCK-RED·铁律 0.4·用户裁定"选项c=接受诚实的灰"）。**灰是对的（不编造），但是终点。**
- 具体缺：**物流时长 + 设备OEE 的实测/逐日时序源**（A8 时序维度）——合成种子没生成这两维度。
- 真跑铁证（DATABUILDER-SELFIMPROVE-LOG 迭代0）：这类 query 目前先卡在 **NO_INTENT**（路由层），根本没走到 EMPTY_DATA。**故本 WO 依赖路由/引擎侧先通**（见依赖）。

## 🚦 文件边界
- `apps/frontend-shell/src/views/RiskBoardView.tsx`（灰节点加"补数据"可点击入口 / 自动探测触发）
- `apps/frontend-shell/src/views/capacity/*`（若灰节点在 capacity 子组件）
- `apps/agentcore/src/growth/*`（EMPTY_DATA 时序补·**若 WO-DATABUILDER-HARNESS 未先落则本 WO 含引擎侧半**）
- `apps/*/test/**`
- 禁碰：灰的"诚实标记"逻辑本身（:50-65 保留·补齐后仍标 PROVISIONAL/未接实测）。

## 产出
1. **灰节点→可触发补齐**：EMPTY_DATA 灰节点旁给"补此维度数据"入口（admin 可点）或页面加载时自动探测——调 `POST /api/v1/growth/{probe,run}`（问句=该维度时序，如"常州设备OEE逐日时序"）。
2. **引擎补时序**（依赖 WO-DATABUILDER-HARNESS 产出②·若未落则本 WO 一并做）：`decideDataGap` 对时序维度——真实基地实体 → **HARD 真人正门 DataRequest**（KILL-MOCK·不伪造真实体时序）；无具体实体 → **SOFT 合成 PROVISIONAL 逐日时序**。
3. **重渲染**：补齐后灰节点变——SOFT→"有数·标 PROVISIONAL/未接实测"（诚实灰升级为诚实 PROVISIONAL）；HARD→"精确 DataRequest 待人工/连接器补"（灰旁显"需导入 X 数据"·非静默）。
4. **绝不把灰变假实测**：补齐产物一律标来源（PROVISIONAL / 未接实测），永不显"实测/LIVE"（延续 :64-65 纪律）。

## 硬约束
- **KILL-MOCK-RED**：真实业务实体（常州/设备）的时序数据走 HARD 真人正门·不静默合成。SOFT 仅限无具体实体·且标 PROVISIONAL。
- **R6**：补齐确定性（同 seed 同结果）。**R4**：合成产物 DRAFT/PROVISIONAL·不冒充真值。
- 诚实标记不丢：补齐后仍诚实披露来源等级。

## SEAM 门 / 验收（头号判据 = 灰真的动了）
- `gray-node-autofill-seam.test.tsx`：① 灰 EMPTY_DATA 节点 → 触发补齐 → 节点从灰变 PROVISIONAL 有数（标未接实测）或显精确 DataRequest；② 真实基地实体 → HARD DataRequest（不静默合成）。
- 真跑：物流时长/OEE 灰节点 → 补齐闭环 → 灰不再是终点。
- 四包全绿；handoff `claude/handoff-wo-gray-node-autofill`。

## 依赖（关键·别单独跑）
- **上游路由先通**：WO-0/WO-CLASSIFIER-PROMPT/DRIL——否则该 query 卡 NO_INTENT 进不了 EMPTY_DATA（真跑已证）。
- **引擎侧**：WO-DATABUILDER-HARNESS 产出②（EMPTY_DATA 时序自补）——本 WO 是它的**前端触发+重渲染半**；两者可同 dev 整单做（跨 A+B 别拆）。

## 参考
`docs/DATABUILDER-SELFIMPROVE-LOG.md`（真跑证据）；`docs/wo/WO-DATABUILDER-HARNESS.md`（引擎侧）；`docs/BLUEPRINT-DRIL-decision-dialogue.md` §3。
