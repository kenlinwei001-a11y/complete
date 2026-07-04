# PRD · Agent-Native 模式吸收三单（不换框架·借模式·平台术语落地）

> 背景：评估 github.com/builderio/Agent-native 后裁决**不替换**自有 agent 栈（验证资本/铁律内建/部署体系三重不匹配·该框架前 1.0 高频 churn 且文档未提确定性策略）。其三个模式值得在**自有栈**上原生吸收。本 PRD 定义三张 WO 的范围与验收；均 dep `INDUSTRY-PACK-CONVERGE`（100% 收口后开工）。

## WO-A · PLATFORM-AGENT-SURFACE（P2）：平台自身作为 MCP/A2A 服务端

**动机**：现在平台只"消费"外部 MCP（B3 客户端）；外部 agent 无法反向调用平台的求解器/行动。借"一次定义多表面"思路，但**不引入 defineAction**——我们的 descriptor 已在（`SOLVER_REGISTRY`/`OPERATION_CATALOG` R15/`SOLVER_OUTPUT_SHAPES`/`DataDependency`），只加**投影层**。

**范围**：
1. AgentCore 新增 MCP server 表面：`GET/POST /b/v1/mcp-server`（SSE/stdio 之外的 HTTP 形态即可）——工具集=从 `SOLVER_REGISTRY` 自动派生 `platform__solver__{key}`（含 argHints/outputShape/DataDependency.requires 作为 inputSchema 说明）+ 从 `OPERATION_CATALOG` 派生只读运维操作；**每个工具执行=现有 REST 路径**（invoke/readiness），零新执行逻辑。
2. A2A 端点（最小·agent card + task 提交/查询）：映射到既有 `POST /b/v1/queries` 任务模型（A2A task ≈ QueryTask）。
3. 鉴权：外部调用方持平台签发 token（复用 IAM·OBO 语义=以该账号权限行级过滤）；凭据/审计/R4 原样生效；**无匿名面**。

**验收**：C1 外部 MCP 客户端（测试用最小客户端）list_tools 见 47 求解器工具·调用 `platform__solver__capacity_forecast` 返回==REST invoke 逐值；低权账号行级过滤生效（A6 断言）。C2 工具集随 registry 增删自动同步（加一个 PROVISIONAL 求解器→工具出现·门断言）。C3 A2A task 提交→终态==对话坞同问句终态。C4 齿检+四包绿+回写 §2.H/§3（新表面链路）+G-14 侧记。

## WO-B · AGENT-OBSERVATIONAL-MEMORY（P2）：agent 跨会话观察记忆

**动机**：复验实证 `agt_universal` 无跨会话记忆（`search_experience` 只有读侧）。借"observational memory"概念：**完成任务的轨迹蒸馏→经验库写侧**，下次同域问题免重复摸索。

**范围**：
1. 任务终态钩子（COMPLETED 且 VERIFIED 类）：把 decision-trace（工具序列+关键中间结论+槽位）经**确定性模板蒸馏**（LLM 蒸馏可选·`QOS_MEMORY_LLM=1`·同 rolling-summary 模式）写入经验库条目 `{intentKey/view, toolPath, keyFindings, provenance:taskId}`。
2. **诚实边界**：条目标 `origin:OBSERVED`（非真值·不可被引用为业务数字来源）；`search_experience` 返回时带"仅供路径参考·业务事实以工具结果为准"（同前情摘要纪律）；R2 租户隔离；保留上限走 G-RET 留存策略。
3. agt_universal/场景 agent 的 systemPrompt 增加"先查经验库"一步（已有工具·只改方法论文案）。

**验收**：C1 同类问题第二次运行的工具调用数下降（同租户同意图两连跑·断言 toolCalls₂<toolCalls₁ 或首步含 search_experience 命中）。C2 蒸馏确定性（无 LLM 模式同 trace 同条目字节一致 R6）。C3 经验条目不出现在任何业务数字溯源里（KILL-MOCK-RED 断言）。C4 齿检+回写（§2.H 经验对象扩·§4 事件 `experience.distilled`）。

## WO-C · AGENT-HANDOFF-OBJECT（P3）：交接一等对象

**动机**：现有场景 agent→universal 是**代码内委派**，无可审计交接记录。形式化 handoff：谁交给谁、带什么槽位/证据、为何交接。

**范围**：`Handoff{fromAgentId,toAgentId,taskId,reason,carriedSlots,carriedEvidence[],at}` 一等对象（repo 双实现）；runPathB 委派点与（未来）specialist 分派点落 Handoff 记录；decision-trace/推演 DAG 渲染交接节点；与 AGENT-UNIVERSAL 的 agentId 归属审计（返修中）同一坐标系。

**验收**：C1 场景 agent 回落 universal 的真跑产生 Handoff 记录且 trace 可见；C2 R2 隔离+齿检；C3 回写 §2.H/§6。

## 《本体引用与影响》（三单共用）
- **对象类型**：Solver/OperationCatalog（D4/D11·被投影）·QueryTask（D7·A2A 映射）·Experience（D7·扩 origin/provenance）·**新增 Handoff（D7）**·McpConfig（B3·新增"服务端"方向）。
- **链路**：`sys.orch.query_to_answer` 增外部进入表面（MCP/A2A→Query）；`sys.solving.invoke` 增对外投影段；经验回路挂 §9 演进。
- **不变量**：R2/R3（外部表面同权限模型）·R4（写仍审批）·R6（蒸馏确定性）·KILL-MOCK-RED（记忆不冒充真值）·no-secrets-echo。
- **断点**：G-14（决策出站半手动）——WO-A 的对外表面是其正向补充；不新增断点。
- **回写**：各单 BUILT 时回写对应节 + `pnpm ontology:slices`。
