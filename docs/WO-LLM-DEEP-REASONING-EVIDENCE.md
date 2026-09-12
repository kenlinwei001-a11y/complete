# WO-LLM-DEEP-REASONING-EVIDENCE · 真 Kimi path-B 复杂推演 10 场景批跑（坐实"真 LLM 推演≠绿测试"·暴露多跳深度）

> 基线 canonical `claude/inspiring-gates-aqczjg` @ **Tier-2 discover 落地后的 HEAD**（含 `discover('solvers')` 工具池 22→36·B/C 决策域 gap_attribution/sop_reschedule/supply_demand_gap_attribution/atp_check/credit_exposure 等对 agent 可见）。开工前 `git pull` 取最新。
> **性质：纯验证/取证 WO——不改产品代码**（只写批跑脚本 + 产出报告）。产物 = 一份可核查的证据 md，不进四包 gate（无源码改动）。

## 🚦 范围边界（本单只碰）
- 新增：`scratchpad/` 或 `apps/agentcore/scripts/` 下的批跑脚本（一次性·非产品代码）。
- 新增：`docs/EVIDENCE-llm-deep-reasoning.md`（结果报告·入库供溯源）。
- **禁碰**：任何 `src/` 产品代码、任何测试金值、路由/求解器逻辑。发现 bug → 只记录进报告 + 起独立 fix-WO，不在本单改。

## 背景（为什么要这份证据）
用户核心质疑贯穿全程：「是不是没用 LLM 真推演，只是跑求解器？」。此前一次批跑（PID 19073）**中途死掉、无结果落盘**（task #79）。当前只有零散单点亲验（Kimi path=AGENT 出过接地答案），**缺一份系统性、可核查的"真 LLM 复杂推演"证据**。且 path-B agent 的**多跳深度**（单问句是否链式调多个求解器）**从无证据**——本单一并暴露。

## 头号判据（SEAM·绿测试≠能用·据实报告不得美化）
对下方 10 个真实产销问句，逐题记录并在报告里给出：
1. **path 真是 path-B 真 LLM**：`routingPath`/`path` = agent/path-B（**非 mock LLM、非纯 path-A 确定性劫持**）；classifier.model = 真 Kimi 模型 id。凡落 mock 或 path-A 直绑，如实标注（不算 path-B 证据）。
2. **工具链真调求解器**：`answer.provenance[].toolName` 非空，列出该题 agent 真 invoke 了哪些求解器（期望见 sop_reschedule/capacity_forecast/gap_attribution/supply_demand_gap_attribution/atp_check 等——**这些正是 Tier-2 discover 扩面后新可见的**）。
3. **★多跳深度（#3 真相）**：统计每题 `provenance` 里**不同求解器的调用条数**。单题 ≥2 个不同求解器 = 真多跳链式推演（如"合肥缺料→gap_attribution→sop_reschedule→capacity_forecast"）；单题只 1 个 = 浅推演。报告给出**多跳率**（≥2 求解器的题数/10）——这是"复杂推演"成色的硬指标。
4. **答案接地**：答案摘要基于真数据（真基地名/订单号/套数/日期），**非编造**。凡见幻觉实体（边界外基地/瞎编数字）如实标注。
5. **对比 solver-only**：同 10 问直调对应确定性求解器（path-A `resolveCeoRoute` 落点），对比 path-B LLM 编排的**增量价值**（LLM 是否做了单求解器给不了的跨求解器综合/取舍/优先级）。报告给结论：真 LLM 推演在这 10 问上**是否比 solver-only 多给了东西**。

## 步骤
1. **起服务**（内存模式·无需 DB）：
   ```
   PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=devsvc node apps/datacore/dist/server.js
   PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=devsvc node apps/agentcore/dist/main.js
   ```
2. **绑 Kimi provider**（凭据 AES-GCM 落库·**任何响应/日志/报告不得回显明文 key**·只留 credentialRef）：
   - `POST /b/v1/llm/providers` {kind:"openai_compatible", baseUrl:"https://api.moonshot.cn/v1", model:"kimi-k2.6", apiKey:<user 提供·不入库明文/不进 git>}
   - `PUT /b/v1/llm/bindings` {role→providerKey:model}（QOS agent 角色绑 Kimi）
   - 核验解析链：LlmSettings.roleModel → binding → env QOS_AGENT_MODEL 落到 Kimi（非 mock）。
3. **跑 10 问**（脚本模板见 `scratchpad/qinyan-llm-batch.mjs`·S1–S10 产销重排问句·POST `/api/v1/queries` → 轮询到终态 → 抽 path/classifier/matchedIntent/provenance/答案）。
4. **汇总** → `docs/EVIDENCE-llm-deep-reasoning.md`：① 逐题表（status/秒/path/classifier/intent/工具链/多跳数）② 多跳率 ③ path-B 真 LLM 占比 ④ vs solver-only 增量结论 ⑤ 逐题答案摘要 + 幻觉/降级标注。

## 10 场景（4680-NCM 产销重排·真实订单号/套数/交期）
（同 `scratchpad/qinyan-llm-batch.mjs` 的 S1–S10；覆盖：单单提前挤占跨基地拆产 / 双高优并发 / 中优插空 / 逾期追回代价 vs 违约金 / 批量提前瓶颈 / 硬约束可行性 / 全月能否交完缺口定位 / 供需缺口最大周归因。）

## 诚实门（KILL-MOCK·反美化）
- LLM 一律**真 Kimi**（禁 mock 冒充）；凡某题落 mock/path-A，报告显式标"非 path-B 证据"。
- 答案接地校验：出现边界外实体/瞎编数字 → 标"幻觉"，不计入"真推演成功"。
- **多跳率、path-B 占比据实报**——低就是低（暴露真相正是本单价值），不得凑数美化。若多跳率低 → 报告给出根因假设（agent prompt 未引导链式？工具描述不足？）+ 建议 fix-WO。

## 本体引用与影响
- **链路**：QOS 查询编排（分类→路径B Agent 工具循环→SSE）· `orchestrator.ts discover 元工具` → `catalog.discover(solvers)`(36) → `invoke_solver`。
- **断点**：`G-SEMANTIC-DISCOVER`（Tier-2 已闭·工具池 22→36）本单是其**下游真跑取证**；顺带取证 path-B 多跳深度（本体未立断点·若浅则本单据此新增 G-AGENT-SHALLOW-REASONING 并回写 §8）。
- **不变量**：R6（求解器确定性·LLM 编排非确定性但求解器输出确定）；no-secrets-echo（Kimi key 不回显）。
- **产出回写**：证据报告 + （若发现多跳浅/幻觉）新断点回写 `docs/SYSTEM-ONTOLOGY.md §8`。
