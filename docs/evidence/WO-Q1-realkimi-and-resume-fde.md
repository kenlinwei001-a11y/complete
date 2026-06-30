# 待办收尾 FDE：§3③ 真分布观察(#3) + 真 Kimi 端到端浏览器逐字流(#4) + T5 续跑

> 真起 datacore :4301 + agentcore :4302（真 KIMI_API_KEY·运行期 env·不入库不回显）。

## #3 §3③ 真分布观察（开放式深问句·真 Kimi）

真 curl 提交开放式问句「请发散评估我们电池业务的长期战略风险，并给出尽可能详尽的应对建议」：
```
status=COMPLETED · trust=AGENT_EXPLORATORY · 含「未能产出」=false
answer=「我将系统性地收集电池业务相关数据、知识库、经验和系统规则…让我先发现可用的资源。」
路径=AGENT（Path B）· ROUTING ~50s + EXECUTING_AGENT ~120s（真 Kimi 推理慢）
```
- **§3③ 收敛成立**：`含未能产出=false`——开放式深问句**不再死答**「探索模式未能产出回答」。✓
- 本次走 **lastText 预览路径**（模型先吐文本前言 → lastText 非空 → 直接用，**未触发** T2 重述）；
  此前 §3③ FDE（`WO-Q1-inc3-streaming-convergence-fde.md`，len=3889）走的是**推理回落路径**（lastText 空→surface reasoning）。两路径均**非死答**，§3③ 双路径真分布均覆盖。
- **诚实缺口**：本次答案是「我将收集数据…」前言（demo 数据稀疏 + 预算内 agent 未完成收集）——**收敛（不死答）是 §3③ 的交付**；答案**深度**取决于数据可用性与预算（属 agent 质量/数据富度，非 §3③ 范围）。T2 重述仅在「终答空+有推理」触发（单测 `qos-b` 已证），真分布命中该路径需更长推理/无文本前言的问句。

## #4 真 Kimi 端到端逐字流·真浏览器实拍

`scripts/fde-wo-q1-realkimi-shot.mjs`：前端(非 mock·`VITE_DATACORE_URL/VITE_AGENTCORE_URL`→真 4301/4302·两服务 CORS `origin:true`)→登录 demo/planner→/v/dash 发开放式问句→真 Kimi Path B 流式→QueryDock 逐字流预览→截图（最长等 180s 穿过 ROUTING）。
- **实拍**（`docs/evidence/WO-Q1-realkimi-streaming.png`）：对话坞「探索模式」+ **`classify 14940ms`（真 Kimi 往返）** + 旋转中 +「▶ 思考中…」**流式推理**（捕获文本「用户要求评估电池业务的长期战略风险…需要：1.了解当前系统…」）+「正在生成回答…」。
- 即 **真后端 + 真模型** 下逐字流贯通到**真 Chromium**——合 T3（mock-SSE 浏览器 render·像素）+ §3③ FDE（真 Kimi→answer.delta SSE 帧）两半为**端到端单证**。

## T5 续跑（restart-safe·补 T1 异步的重启续跑）

- `resumeInflightExtractions()`：启动跨租户扫 EXTRACTING 文档重跑（幂等清旧候选）；server.ts outbox 后 fire-and-forget。
- 单测 `ruledocs.test` T1 续跑用例：遗留 EXTRACTING doc → resume → flush → IN_REVIEW + 候选 ≥3 + 再续跑无重复堆积 ✓。seed-demo-smoke 启动门 ✓。
- **边界**：单实例 docker 重启续跑根因解；**多实例需真分布式 job 队列**（另立单·非本单）。

## 待办#2（审核方独立复验）说明
按角色边界（fde-delivery 铁律0.5），「审核方独立复验」是**审核方**对 dev 交付的独立再验证步骤——**dev 自己执行会使其失去独立性**，故非 dev 可代办项；此处仅备注：以上各项均附 dev 自验 + 真跑证据，待审核方按各 FDE 判据独立复验核发。
