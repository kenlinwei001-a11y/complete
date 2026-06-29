# 待 dev 清单 — 审核方复验后开出的未闭项（可直接转发开发 agent）

> **来源**：审核方（独立真跑复验）对 lastmile / 四链路走查 / WO-1 / A6 的复核结论。每项均**审核方亲手真跑发现/定位**，含 FDE 真值判据；dev 实装 + 自验贴证后，审核方按判据**独立真跑复验**核发闭合。
> **红线（全项通用）**：禁 mock 冒充 / 禁 skip-by-default / 禁门空过 / 禁造假过判据；解析失败/降级**诚实报不静默**；只推 `claude/vigilant-knuth-b1nmxn`；密钥仅 env 不入 git（R5）。

| # | 工单 | 优先级 | 状态 | 详细单 |
|---|---|---|---|---|
| 1 | **WO-Q1** QOS Path B 流式反馈 | P1 | 待开工 | 见本文件 §1（走查报告 `REVIEW-four-chains-live-walkthrough.md` 内 WO-Q1） |
| 2 | **1C** 规则文档抽取解析率 | P2 | 待开工 | `docs/HANDOFF-1C-rule-extraction-parse-rate.md`（自包含） |
| 3 | **A6-T2** 真 socket e2e 固化为回归 | P3 | 待开工 | 本文件 §3（核发 `REVIEW-A6-tails-verdict.md`） |

---

## §1 · WO-Q1 — QOS Path B（自由问句/Agent）流式反馈（P1）

- **问题（审核方真跑）**：自由/开放式问句走 Path B Agent 时，**分类期 ~30s 完全静默**（前端只「🔵 仍在执行」），且**终答无 token 级流式**；开放式综合问句（"评估X+三建议"）真跑 **t+142s `BUDGET_EXCEEDED` → 占位「（探索模式未能产出回答）」**、产不出富答案。Path A（命中工作流）不受影响、秒级富答。
- **根因接缝**：`packages/llm-adapters/src/openai.ts` agent 路径**非流式**（`chat.completions.create` 无 `stream`）；Kimi-k2.6 推理模型多轮 loop 慢；`reasoning_content` 被丢弃（只读 `content`）。
- **非**：用途接缝（WO-1 已解）/ 永久挂死（会收敛或降级）。
- **FDE 真值判据**：真浏览器自由问句 → **分类期 ≤5s 见首进度帧**（step DAG/思考态可见，非纯静默）；终答**增量流式**；开放式深问句**收敛或显式降级提示清晰**（非长时间无反馈）。**不改 Path A**。
- **方向（dev 择优）**：① 前端即时呈现 `query.classified` 后的「分析中」step；② 终答 `stream:true` + 解析 `delta.content`；③ 开放式 Path B 预算/收敛调优；④（已部分由 WO-1 缓解：classifier 命中工作流即走快 Path A）。

## §2 · 1C — 规则文档抽取解析率（P2）

- **一句话**：rule-docs 真打 Kimi → `candidateCount=0`（段 FAILED unparseable），规则文档审核台永远空、「文档→规则候选→规则库」正门断首跳。
- **根因**：`parse()`（openai.ts:294）`json_schema + 单次 safeParse·零重试`；Kimi-k2.6 对复杂嵌套抽取 schema 保真不足。
- **方向**：①降抽取 schema 复杂度 + ②parse 加重试（主）+ ③强约束 prompt（辅）。
- **FDE 真值判据**：真 curl 上传 3 条中文规则 → `candidateCount≥3`、段不 FAILED、候选**真进规则库**（`/admin/rules` 可见）、**诚实不造假**。
- **完整规格**：`docs/HANDOFF-1C-rule-extraction-parse-rate.md`（自包含·含本体引用/边界/交付物）。

## §3 · A6-T2 — 全服务 e2e 真 HTTP socket 固化为回归（P3）

- **现状（审核方核）**：A6 尾巴② 的「真 HTTP socket」是 dev 手跑 curl + 审核方本次手跑复现（值逐位吻合·R6 一致），**但 A6 提交未增任何测试**；唯一自动化 `test/a6-value-domains.test.ts` 用 **`app.inject`**（进程内·非真 socket）→ **真 socket 路径无自动回归**。
- **判据**：补一个 `test/a6-e2e-socket.test.ts` 用 `app.listen(0)` 真起 socket + `fetch` 打 `a6-reference`（仿 `test/opt-real-sidecar.integration.test.ts` 真 socket 范式），断言 util 落区间 + autoPlant 越线 + R6 一致；并入 `pnpm --filter datacore test`。**或**：文档把「真 HTTP socket」明确标注为「手测复现（seed 已提交可复跑）」而非「e2e ✅」。
- **注**：尾巴①（电池收编·字节不变）审核方已核发**完全闭合**，不在本清单。

---

## 已闭合（审核方已核发·不在待办，列此备查）
- **lastmile（G-5/G-12/优化融合）**：✅ 闭合（真 CP-SAT 两行业 R14 + whatif + 杀-sidecar 对抗坐实真依赖）·`REVIEW-opensource-fusion-lastmile-verdict.md`。
- **WO-1（LLM 用途接缝）**：1A/1B ✅（结构化错误·不泄漏 SDK 串·Path B 真打 Kimi）；1C 拆出为本清单 §2。
- **A6 尾巴①（电池收编字节不变）**：✅·`REVIEW-A6-tails-verdict.md`。
- **四链路走查**：数据接入(✅ 含结构化接入臂补验) / QOS Path A(✅) / 沙盘确定性推演(✅) / Action 审批流(✅)·`REVIEW-four-chains-live-walkthrough.md`。
