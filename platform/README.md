# 全域智能决策平台 · 骨架版（拎包入住）

本体 + AI 推演系统的可运行骨架：**登录即用**，自带电池制造种子数据、6 个已配置的场景入口、真实求解器算法、双路径查询（Workflow / Agent）、行级权限、Action 审批闭环。LLM 双模式：无 Key 时用确定性 Mock（全功能演示），配置 `ANTHROPIC_API_KEY` 后路径 B 由真实 Claude Agent 接管。

## 快速开始

```bash
pnpm install
pnpm dev          # DataCore :8081 + AgentCore :8082
# 浏览器打开 http://localhost:8082
```

启用真实 LLM（可选）：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# 可选：QOS_CLASSIFIER_MODEL=claude-haiku-4-5  QOS_AGENT_MODEL=claude-opus-4-8
pnpm dev
```

## 演示账号

| 账号 | 密码 | 角色 | 演示点 |
|---|---|---|---|
| planner | planner123 | 计划员 | 全量数据、全部场景 |
| czmgr | cz123 | 常州基地负责人 | **行级权限**：同样的问题只见常州数据 |
| admin | admin123 | 管理员 | Action 草稿**审批**（采纳方案 → 审批 → 生成 MO 工单号） |

## 已配置的场景入口（workflow vs agent 按入口决定）

| 视图 | 模式 | 行为 |
|---|---|---|
| dash 驾驶舱 / risk 产能推演 / project 项目推演 / generate 规划建议 | `WORKFLOW_FIRST` | 命中意图走确定性工作流（绿徽章·已验证）；未命中兜底给 Agent（琥珀徽章·探索） |
| audit 规划体检 | `WORKFLOW_ONLY` | 只接受预设问答，超纲明确拒绝并给可用问法 |
| explore 自由探索 | `AGENT_FIRST` | 跳过意图目录，问题直接交给 Agent 自由编排工具 |

种子意图 6 个：受影响订单 / 需求增量可承接（含 C03 拦截）/ 风险越线根因 / 规划体检 / 经营方案推荐 / 采纳处置方案（→Action 草稿）。

## 试这些问题（右侧对话框）

- `4680-NCM 加 20% 六周能不能接？` → 路径 A：真实产能算法（爬坡 0.88→1.0、检修周 ×0.72、认证中 ×0.6、P90=×0.93）+ 溯源角标
- `4680-NCM 加 60% 六周能不能接？` → C03 规则拦截（阻断不是报错）
- 在 risk 视图选中基地后问 `影响哪些订单？` → 上下文槽位补全
- `采纳常州的三班制方案` → Action 草稿（用 admin 登录可在 API 审批）
- explore 视图任意问题 → Agent 路径（Mock 或真实 Claude）

## 架构（与 PRD 文档集对应）

```
apps/datacore   :8081  System A：IAM/JWT、Workspace、本体对象（行级过滤在数据层）、规则引擎、Action 草稿
apps/agentcore  :8082  System B：QOS 路由（意图分类→路径A/B）、Workflow 执行器、Agent 循环、
                       求解器（capacity_forecast/affected_orders/risk_timeline/plan_audit/plan_generate）、
                       SSE 事件流、同步求解端点、静态前端
packages/contracts     共享契约（字段名与 PRD 一致）
```

松耦合：B 只经 A 的 REST API 访问数据，每次工具调用透传用户 JWT（OBO）——同一 Agent 不同用户得到不同数据。

## 团队接手清单（按优先级）

1. **存储**：内存仓库 → PostgreSQL（接口已隔离在 datacore Store 区 / agentcore TaskHub）
2. **意图/计划/场景/Agent 配置化**：现为代码内种子（qos.ts），按《管理平台增量 PRD》落 CRUD + 管理台
3. **澄清交互**：缺槽位现降级路径 B，按 QOS-PRD §8.3 补 clarification 端点与前端表单
4. **Agent 上下文管理**：已实现 8KB 截断；按《Agent 运行时增量 PRD》补三刀清理与多轮摘要
5. **LLM 多厂商**：LlmClient 已隔离（llm.ts），按《LLM Providers 增量 PRD》接 openai_compatible
6. 其余按 13 份 PRD 文档集（docs/ 目录）逐项实施；验收用例即测试清单

## Docker

```bash
docker compose up --build   # 同样 :8082 打开
```
