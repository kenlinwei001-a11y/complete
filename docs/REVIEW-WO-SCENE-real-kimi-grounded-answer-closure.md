# 审核核发 · QOS 接地富答案（真 Kimi 实拍）—— WO-SCENE-B 北极星闭合

> 用户提供真 Kimi key，审核方据此补上整个会话最后一块未验拼图：**「答得接地」体验层**（此前因无 LLM 凭据仅证路由、未证富答案）。真起 datacore+agentcore、配 openai_compatible Moonshot provider（kimi-k2.5）、走 QOS 真问句端到端实拍。
> **密钥处理**：仅注入 env（apiKeyEnv）/ 用完即删 scratchpad·**绝不回显/不提交/不入任何 doc**；provider 配置在内存仓储随服务停止而灭。本文不含任何密钥。

## 一句话结论

**✅ 北极星闭合（真 Kimi 实拍）。** QOS 三条作答路径**均真跑出接地结构化答案**：① Path B 自由 agent 真调 query_objects/aggregate_objects 出表+分析+provenance；② Path A 工作流 Kimi 分类命中 plan_audit_q → invoke_solver(plan_audit) 出 verdict/score/C18 裁决/**dataMode=LIVE**；③ **场景 agent agt_plan_audit**（off-menu 问句 → `场景入口模式 WORKFLOW_FIRST`）真出 654吨缺口/15.92%毛利/65分 + 管理事项 + C15/16/18/21 裁决。**「答得接地」不再是结构通体验缺——是真能用。**

## 三路真 Kimi 实拍（按证据强度）

### ③ 场景 agent（WO-SCENE-B 真目标·最关键）
- **问句**（off-menu·刻意不命中预设）：「别跑模型了…我作为厂长这周周会最该把火力集中在哪件事、怎么跟团队说？」
- **路由**：`routing.completed note="场景入口模式 WORKFLOW_FIRST"` = **runSceneAgent**（agt_plan_audit 真触发·非通用探索）·path=AGENT·~115s 真 Kimi agent loop。
- **接地富答案**（节选）：
  - 真 plan_audit 数据：**齐套缺口 654吨**（需加急 200吨·C16）、**毛利缓冲 -0.08pp**（结构上限 15.92%·C15）、**储能占比偏离 5.1pp**（C21）、**体检得分 65 分**。
  - 三火力排序 + 每项「跟团队说」话术 + 一句话总结——**真答了"周会盯哪件事"这个问题**（非泛答/非数字堆砌）。
- **判定**：场景 agent 真调求解器取真值 + 按 ruleBindings(C15/16/18/21) 裁决 + 产出可执行管理事项 + 答到点上 = **「答得接地」成立**。

### ② Path A 工作流（Kimi 分类 → 确定性求解器）
- 问句「最近定稿版本规划体检结果如何？」→ Kimi 分类 `plan_audit_q`(0.85) → invoke_solver(plan_audit)。
- 答案：verdict=**站不住** · score=50 · gmStruct=15.86 · **dataMode=LIVE** · 表格 X05 现金垫(**C18 现金垫45亿<底线50亿→CAPEX缩减**) · M4/S3/evaluatedRules5。
- **判定**：Kimi 分类准 → 走确定性最佳接地路径（真求解器+真规则+诚实位 LIVE）。

### ① Path B 自由 agent（smoke:llm 真 Kimi）
- 真调 `query_objects` + `aggregate_objects` → 表（动力 6家 81.8% / 储能 6家 68.2%）+ 分析结论 + **provenance**（toolCallId/snapshotVersion）+ 诚实 `unverifiedNumerics:true`。
- **判定**：Kimi 真驱动 agent 工具循环、答案有溯源、非 echo。

## 关键发现（正面·系统稳健性）

**Kimi 分类器很稳——plan-audit 问句（即便口语化）多被自信路由到 Path A 确定性工作流**（最佳接地路径：真求解器+真规则+dataMode）。**场景 agent 是"预设命不中"的兜底**，要真正 off-menu 的顾问式问句（如"厂长周会盯哪件事"）才触发。这说明 WORKFLOW_FIRST 的预设 plan_audit_q 覆盖面广、确定性优先——**符合"确定性是地板、LLM 是听懂任意问法的层"的设计哲学**。三路都能接地，是系统鲁棒性的体现，非缺陷。

## 诚实边界（未冒充）

1. **测试接线已还原**：为让场景 agent 走 Kimi，临时把 `agt_seed_analyst.model` 由 `claude-opus-4-8` 改 `kimi-k2.5`（agt_plan_audit 复用之）——**实拍后 git checkout 还原 + 重建·不入任何提交**。这是测试环境 LLM 接线，非代码改动。
2. **API 层实拍·非真浏览器**：经 `POST /api/v1/queries` + SSE/轮询取答案 JSON 核证结构与接地性；**未起前端做像素级视觉实拍**（DataModeBadge 等前端徽章按各自单 FDE）。
3. **单租户内存模式·kimi-k2.5**：未跨租户/未真 PG；模型单一（kimi-k2.5，系统已实测兼容形态）。
4. **provider 凭据**：openai_compatible Moonshot·apiKeyEnv 注入·内存仓储·随服务停灭；密钥不入任何持久物。

## 本体引用与影响

- **链路 `sys.orch.query_to_answer`**：三分支（Path A 工作流 / Path B agent / 场景 agent）**真 Kimi 端到端贯通**——分类→路由→求解器/工具→渲染→诚实位，逐段实证。
- **断点 G-3**（场景接地对话）：从"结构通"升级为"**真 Kimi 实拍能用**"——WO-SCENE-B 北极星闭。
- **不变量 R13**（诚实位）：Path A 答案带 dataMode=LIVE 真透出，与本会话 WO-DM 验证一致。

---
*审核方独立核发（真 Kimi 端到端实拍·密钥仅 env 不入提交物·测试接线已还原）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入提交物*
