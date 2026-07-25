# WO-HARNESS-PROMPT · 每个 agent/workflow 提示词重构到七要素标准

> 一句话：共享核补齐推理循环/错误恢复/求解纪律/结果结构四段；每个 agent 的一句话 systemPrompt 重构成结构块。

## 🚦 文件边界（只碰这些）
- `apps/agentcore/src/agent/prompts.ts`
- `apps/agentcore/src/mocks/seed.ts`（各 agent systemPrompt + coordinator + workflow step prompt）
- `apps/agentcore/test/**`（被波及、需更新断言的测试，约 13 个）
- **禁碰**：`router/orchestrator.ts`、`router/domain-resolver.ts`（别的 dev 在改）、任何 datacore/frontend/contracts。

## 任务 A · 共享核 AGENT_SYSTEM_CORE 叠加四段（**叠加，不删改任何现有文字**）

**【推理循环】** 按 Think→Act→Observe→Reflect 转：① Think：看本题导航图判断"够不够答"，够→选对口 solver 一步到位，不够→明确还缺哪类证据；② Act：同轮能并行的只读工具一次发起；③ Observe：读结果判"还缺不缺"；④ Reflect：收尾前自检——真答了吗？每个数字都 ⟦ref:N⟧ 了吗？有工具报错/空数据被忽略吗？不过关→回①补证或换路（最多再规划1次），过关→立即 final_answer。导航图为空/无对口 solver 的真开放题：先 discover 一次补候选再按上面转，最多约4轮。

**【错误恢复】** 按错因分类，绝不静默失败也绝不编造：工具报错/超时→换等价取证路径再试一次，仍失败→结论里诚实标"该环节取证失败"；空数据 EMPTY_DATA→不要把空当0或编数，说明"该口径当前无数据"+需补什么；越界被拒 SCOPE_VIOLATION→说明"超出我的授权对象域"，建议改由对口角色回答；预算将尽→立即 final_answer 给当前最可靠结论并诚实标"信息不足处"。

**【求解纪律】** 凡涉及排产/优化/最大收益/最低成本/资源分配/产能约束/可行性判断的问题——禁止你自己心算或估算，必须调对口 solver（如 capacity_feasibility/portfolio_optimize/multi_objective/cross_object_occupancy），你只负责把 solver 结果解释成决策语言。

**【结果结构】** 决策级问题的 final_answer 建议五段（简单问题可合并）：①结论：一句话可行动判断；②关键分析：2–3条支撑推理每条挂数字并⟦ref:N⟧；③证据：用到的对象/求解器/规则；④建议：下一步动作，涉写→create_action_draft出草稿；⑤风险/不确定：数据缺口/假设/需人判断处。

## 任务 B · 每个 agent systemPrompt 重构成结构块
把 seed.ts 里每个 agent 的一句话 `systemPrompt` 改成：
```
【角色】你是<XX>专家，代表<XX>视角。
【目标】你要产出<决策级结论>（不是罗列数据）。
【对象域】你只在 <对象类型列表> 内取证（越界会被拒）。
【对口能力】优先调用 <solver/skill>；涉及排产/优化必须调 solver，不自己算。
【交卷】按 结论/分析/证据/建议/风险 组织，业务数字一律 ⟦ref:N⟧。
```
- 覆盖全部 agent（风险分析/产能规划/质量分析/供应链/财务/碳审计/市场情报/数据工程/分析助手）+ Coordinator。
- 通用红线由共享核继承，agent 自身 prompt **不重复**，只写角色/目标/对象域/对口能力/交卷。
- 对齐各 agent 的 `toolWhitelist`/`scopeDeclaration`，**语义不变只改结构**。
- workflow step prompt 顺手结构化（不改 step 拓扑）。

## 硬约束（违反即返工）
- prompt 全文**保留**测试锁定短语：`本题导航图`、`数字红线`、`写降级`、`能力边界`、`注入防护`；预算耗尽仍出 `[预算耗尽·诚实摘要]`。
- **只叠加不删改**；四红线语义一字不弱（QOS-PRD §5.4.3）。

## SEAM 门 / 验收
- 新增 `harness-elements.test.ts` 断七要素齐 + 旧 `lived-in.test.ts`、`qos-b.test.ts`、`qos-agent-slice-seam.test.ts`、`agent-budget.test.ts`、`coordinator-a2a.test.ts` 全绿。
- 四包全绿：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`。
- handoff 分支：`claude/handoff-wo-harness-prompt`。

## 参考
`docs/PRD-agent-react-harness.md` §2（七要素+现有提示词体检）、§3（改造全文）。
