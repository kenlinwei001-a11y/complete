# WO-E2E-DIALOGUE-ACCEPTANCE · 全链验收门（防"各半绿·断在接缝"·封顶硬门）

> 一句话：每张对话 WO 只测自己那半，没人测"真问句→路由→补数据→接地→决策答案"的全链。这张门拥有全链——三类真问句端到端跑通，才算对话真能用。

## 背景（本 WO = 蓝图 §5 的落地·capstone）
CLAUDE.md 头号病 = SEAM-GATE「绿测试≠能用·断在接缝」。各 WO 半测全绿 ≠ 对话能用。本门把 S1~S7 接缝串起来跑真问句。**这是所有对话 WO（WO-0/HARNESS/CLASSIFIER-PROMPT/REFLECT/DRIL-P*）的头号复验判据**——它们各自 merge 前本门须随之绿。

## 🚦 文件边界
- `apps/agentcore/test/e2e-dialogue-acceptance.test.ts`（新·env-gated 真 LLM + 无 LLM 双跑）
- 复用 `/api/v1/growth/probe` 观测（不新写业务逻辑·只组织问句集+断言）
- **纯测试 WO**：不改产品代码（若发现断链→回报对应 WO 修·本 WO 只暴露不修）。

## 产出
1. **三类问句集**（覆盖真实分布）：
   - **预设命中**：场景卡触发问句（应 path-A 出真答案）。
   - **开放长尾**：不在意图目录的自由问（应 DRIL 检索到资源出答·证 S2/S3）。
   - **CEO 深问**：根因/方案类（应 agent+reflect 出结论/建议/风险·证 S4/S6/S7）。
2. **端到端断言（全链·非各半）**：
   - 路由对：命中题走 path-A·开放题走 DRIL·**无 LLM 时诚实降级不崩**（S1/S2）。
   - 补数据：故意问一个 EMPTY_DATA 题 → 断言触发 growth 诊断/补齐建议（S5）。
   - 数字接地：答案每业务数字有 ⟦ref:N⟧ 且可溯（S5/S7）。
   - 决策结构：final_answer 含 结论/证据/建议/风险（S7）。
3. **双跑**：env-gated 真 LLM（QOS_*_MODEL + key）全绿 = 对话真能用；无 LLM 跑 = 诚实降级不崩（守 WO-0）。

## 通过标准 / 定位
- 三类问句端到端全绿 = 对话真能用。**唯一防"各半绿·断在接缝"的门。**
- **每张对话 WO merge 前，本门必须随之绿**（写进复验纪律）。

## 依赖（capstone·最后做）
- WO-0 + HARNESS-PROMPT + CLASSIFIER-PROMPT + REFLECT-LOOP + DRIL-P2~P4 **全部合入后**才有完整意义（早跑会大量红·可分阶段先立骨架）。

## 参考
`docs/BLUEPRINT-DRIL-decision-dialogue.md` §4（接缝表 S1~S7）+ §5（本门全文）。
