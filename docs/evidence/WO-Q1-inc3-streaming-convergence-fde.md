# WO-Q1 增量3（P1）· QueryDock 逐字流渲染 + §3③ 开放式预算收敛 — FDE 证据

> 背景：增量1（分类期进度帧）+ 增量2（SSE token 级 answer.delta + Kimi reasoning_content 捕获）后端已闭。增量3 = ① 展示层渲染（用户真看到逐字流）+ ② §3③ 开放式深问句收敛（此前 1944 reasoning 帧后仍「探索模式未能产出回答」）。

## ① 展示层：QueryDock 逐字流实时预览

- **现状根因**：reducer 自增量2 已累计 `streamingText`/`reasoningText`（单测绿），但 `TaskRun` 从不渲染它们 → 终端用户看不到逐字流，只能干等 `answer.final`。
- **修**：`TaskRun.tsx` 在 `!answer && status==="streaming" && (streamingText||reasoningText)` 时渲染——可折叠「思考中」(reasoningText) + 逐字流答案预览(streamingText)+ 光标 `▍`；`answer.final` 到（`state.answer` 真）即切 `AnswerCard`、预览隐去。新增 `zh.dock.thinking/streaming`。
- **真渲染单测**（`test/wo-q1-inc3-streaming.test.tsx`，真 SSE 脚本经 MockEventSource）：
  - 段0 routing+3 个 answer.delta（reasoning + text×2）→ 断言 `task-streaming-*` 出现、文本逐帧累加为「这是答案预览」、`task-reasoning-*` 含思考文本。
  - 释放段1 `answer.final` → 断言预览隐去（`queryByTestId(task-streaming-*)===null`）、AnswerCard 接管。✅

## ② §3③ 开放式预算收敛（根因解）

- **现状根因**（审核方 inc2 verdict 实测）：开放式问句「评估韧性+三建议」→ 1944 reasoning 帧、text=0 → 终答 `lastText` 空 → `degrade` 落「（探索模式未能产出回答）」死答，丢掉模型真产出的全部分析。
- **修（loop.ts，两处互补）**：
  1. **强制收尾**：「最后机会」轮（`finalizePending`，预算/上下文耗尽）**只暴露 final_answer 工具**（`iterTools = llmTools.filter(final_answer)`）→ 逼模型结构化收尾，不再续发工具/纯推理把预算烧光。
  2. **推理兜底**：捕获每轮 `response.reasoningText`→`lastReasoning`；`degrade` 时 `markdown = lastText || 「探索推理·未结构化收尾」+reasoning || 「未能产出回答」` → 终答文本为空但有推理时，**收敛到真模型推理的初步结论**（trustLevel 仍 AGENT_EXPLORATORY·诚实标注），而非死答。
- **mock 收敛单测**（`test/qos-b.test.ts` §3③）：agent 轮 content=[]（无 text/无工具）+ reasoningText（三条建议）→ 终答含「多源采购」「探索推理」、**不含**「未能产出回答」、trustLevel=AGENT_EXPLORATORY。✅
- **诚实红线**：reasoning 也空才回落最终兜底文案；强制 final_answer 是约束工具集，不伪造内容。

## 测试 / 门禁
- llm-adapters 15 ✓ · agentcore 353 ✓（+§3③）· frontend streaming 1 ✓ · 全量 build 绿。
- `mock.ts ScriptedTurn += reasoningText`（测试桩支持，agent() 透传）。

## 真 Kimi 实跑 FDE（env-gated·真 moonshot）

真起 datacore(:4201,SEED_DEMO=1,KIMI_API_KEY)+agentcore(:4202) · 真 Kimi kimi-k2.6 · 开放式问句「综合评估电池业务供应链整体韧性并给三条改进建议」经 Path B agent：

**结果（真 Kimi·taskId=task_01KW9ZFSS9H33V7F8TVPFDKYQA）**：
```
path=AGENT  trustLevel=AGENT_EXPLORATORY  len=3889 字
答案首段：「（探索推理·未结构化收尾，仅供参考）\n\n基于已有数据，我需要综合评估…」
答案正文含真数据：12 个生产基地（利用率 0.62–0.90 / OEE 0.743–0.765 / 瓶颈工序）
            + 8 种关键物料（LFP/NCM/石墨/铜箔/铝箔… leadTime/onHand/inTransit/dailyUse 真值）
```
- **正中 §3③ 靶心**：真 Kimi agent 烧预算在推理（经工具拉到真基地/物料数据并逐条分析），但未结构化收尾（final_answer/text 空）——**旧实现此处必落「探索模式未能产出回答」死答**；新实现 `degrade` 回落兜底，把这 3889 字真分析（含真业务数据）作为「探索推理·未结构化收尾」呈现给用户。
- 即审核方 inc2 verdict 实测的「1944 reasoning 帧 → text=0 → 未能产出回答」场景，现**收敛到真实、可用、含真数据的答案**（守"绿测试≠能用"：不再空答）。
- 诚实边界：终答是「未结构化的推理」而非「结构化 final_answer」——理想是模型直接产 final_answer（强制工具集已尽力逼它）；但即便模型不配合，用户也拿到真分析而非死答。这是收敛的地板保证。

## ① 真浏览器实拍（T3·Chromium·非 jsdom）

`scripts/fde-wo-q1-streaming-shot.mjs`：起 vite(VITE_MOCK=1) → 登录 → /v/dash 开查询 Dock →
发哨兵问句「逐字流演示…」（mock SSE 拉开 answer.delta 间隔 + 延迟 answer.final）→ 等
`task-streaming-*` 预览出现 → 截图 + 断言累加文本。
- **实拍结果**（`docs/evidence/WO-Q1-inc3-streaming.png`）：对话坞内「探索模式」徽章 + 旋转中 +
  「▶ 思考中…」可折叠推理 + 逐帧累加答案「供应链韧性评估：① 多源采购降低单点风险；② 关键物料
  安全库存；③ 本地化产能布局。▍」（**实时光标**），终答 AnswerCard 到达前可见。✓
- 即增量3(a) 用户可见逐字流，**真 Chromium 像素级坐实**（补 jsdom render 测的最后一环）。
- 哨兵 SSE 分支仅「逐字流」问句触发（既有测试问句不含此词·零影响；f2/f6/f39 SSE 消费测全绿）。

## 本体回写
- §2 Task/Query（WO-Q1）：增量3 两项（展示层逐字流 + §3③ 收敛）记为已落，「余」缩为 answer.delta 批量化生产优化。
