# LEDGER-V4-1 · 开发第四卷逐句需求台账（Ch65/67/69/70·全卷 4232 行）

- 源文件：`/tmp/req-unzip/设计文档/开发第四卷.md`（**无 Ch66/Ch68，属 ZIP 原样，如实记录**）
- 判定依据：`docs/ANALYSIS-decision-os-spec-vs-system.md`（下称 A 文）· `docs/DESIGN-refit-rollback-plan.md`（下称 D 文）· `docs/PRD-gap-analysis-engine.md` · `/tmp/req-records/F-devvol4-security-iam.md`（下称 F 记录，Ch65 逐节判定复用）· 本次 grep 实证（solver-registry/scenarios-catalog/connectors/registry 等）
- verdict 口径：
  - **SYS-HAS**：能力已在系统（引 file:line；"等价"= 功能等价实现，非规格字面）。
  - **PLAN-L3**：归 D 文 §2 L3 正交 track（K8s/helm · AI 原生安全〔注入防护/输出安全/Agent 一等身份/数据分级 为**点名**项〕；A 文 §1 表 row F 把开发四卷安全域整体判"AI 原生安全另立 track"，故 F 缺口集其余项标 **L3 概称**）。
  - **PLAN-L2/L1/L0**：D 文对应期（L2 统一 Decision 内核等）。
  - **Q30**：QUERY30 在建工作流（`docs/DESIGN-query30-orch-split.md` P0–P5）。
  - **DEFER-OK**：有明确理由的搁置（范式分歧判例＝A 文 §1 row E"范式分歧非刚需"；无自托管模型；路线图/商业叙述非功能需求）。
  - **OMISSION**：系统无、任何计划/记录未涉——高亮。
- 结构原样记录：§69.13/§69.14 编号在 L1767/L1803 重复出现（前为 Order Ontology，续篇改作 Sales Order）；空节/截断：L2239-2245(69.27 数值空)、L3091-3093(69.60 空)、L3266-3271(69.69 数值空)、L3466-3467(70.1.4 空)、L3657(70.3 标题截断"模")、L3298("Syste"截断)、L4232-4233(文末"从："截断)。均 ZIP 原样，无隐藏需求内容。

## Chapter 65 · Decision OS Security Architecture（L2–695）

| ID | 行 | 章 | 需求(≤25字) | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V4-1-001 | 12 | 65.1.1 | 安全架构=智能系统安全基础设施层 | SYS-HAS | 地基已在：auth.ts/authz.ts/audit.ts/actions.ts 全栈（F 记录结论"地基级到位"） |
| V4-1-002 | 24-56 | 65.1.1 | 安全对象覆盖人-Agent-模型-数据-决策-执行全链 | PLAN-L3 | AI 安全面空白（F§4）；D 文 §2 L3"AI 原生安全" |
| V4-1-003 | 61 | 65.1.2 | 安全目标·身份可信 | SYS-HAS | datacore/src/auth.ts:19（RS256+JWKS auth.ts:63；agentcore/src/auth.ts:39 验签） |
| V4-1-004 | 62 | 65.1.2 | 安全目标·权限最小化 | SYS-HAS | authz.ts:28 + entitlement features.ts（粒度粗=3op·F§5 注） |
| V4-1-005 | 63 | 65.1.2 | 安全目标·数据隔离 | SYS-HAS | R2 tenant_id everywhere·跨租户 403/404（F§22） |
| V4-1-006 | 64 | 65.1.2 | 安全目标·Agent 可控 | PLAN-L3 | 点名"Agent 一等身份"（D 文 L3；F§2） |
| V4-1-007 | 65 | 65.1.2 | 安全目标·决策可追溯 | SYS-HAS | contracts/qos.ts:307 ProvenanceRef + decisions.ts + audit |
| V4-1-008 | 66 | 65.1.2 | 安全目标·行为可审计 | SYS-HAS | audit.ts append-only R13 + audit-sink.ts SIEM 旁路 |
| V4-1-009 | 69-132 | 65.2 | 四层安全平台(IAM/AI安全/数据安全/审计) | PLAN-L3 | AI Security 层为主缺（F 结论"AI 安全两成"）；IAM/审计层已 HAS 注 |
| V4-1-010 | 135-155 | 65.3 | SecurityObject 9 类统一受控 | PLAN-L3 | 未收敛统一授权面（F§4 PARTIAL·授权仅 4 资源类） |
| V4-1-011 | 158-171 | 65.4 | 五类身份(人/Agent/服务/外部系统/设备) | PLAN-L3 | Human HAS·Agent/Service 残·Device 无（F§1-3；L3 概称） |
| V4-1-012 | 174-186 | 65.5 | Human 身份字段(部门/角色) | SYS-HAS | auth.ts:19 用户+roles+attributes |
| V4-1-013 | 189-201 | 65.6 | 每 Agent 独立身份(owner/risk_level) | PLAN-L3 | 点名；现 agentId 仅审计回溯（agent/loop.ts:57,244·F§2） |
| V4-1-014 | 203-204 | 65.6 | 禁止多 Agent 共享账号 | PLAN-L3 | 现一律 OBO 用户身份行权（agents/universal.ts:13·F§2） |
| V4-1-015 | 207-220 | 65.7 | 每服务独立 Credential | PLAN-L3 | L3 概称；现共享 SERVICE_TOKEN（agentcore/config.ts:9·F§3）；连接器/LLM 凭据 per-instance AES-GCM 已 HAS 注 |
| V4-1-016 | 222-253 | 65.8 | RBAC User→Role→Permission→Resource | SYS-HAS | authz.ts:28 + PermissionPolicySchema contracts/datacore.ts:315（限定名角色 authz.ts:19） |
| V4-1-017 | 257-266 | 65.9 | SQL·security_role 表 | PLAN-L3 | L3 概称；角色为 user 字符串·无规范化角色表/继承（F§5） |
| V4-1-018 | 269-279 | 65.9 | SQL·security_permission 表 | SYS-HAS | 等价 permission_policies（datacore/migrations/001_init.sql:31） |
| V4-1-019 | 282-305 | 65.10 | ABAC 属性判权(用户+对象+环境) | SYS-HAS | rowFilter 表达式 authz.ts:91（环境属性缺→L3 概称注·F§6） |
| V4-1-020 | 306-311 | 65.10 | 工厂经理仅访问本基地数据 | SYS-HAS | base_manager:常州 行级过滤正是此场景（authz.ts:19,91） |
| V4-1-021 | 314-334 | 65.11 | ABAC Policy user.factory==object.factory | SYS-HAS | rowFilter DSL 可直写该式（ruledsl evaluateExpression）；无独立 YAML 策略语言注 |
| V4-1-022 | 336-350 | 65.12 | Agent 四类权限(Data/Tool/Exec/Decision) | PLAN-L3 | per-agent 施权无（F§7）；Tool 清单+S2 兜底 partial 注 |
| V4-1-023 | 353-371 | 65.13 | Agent Sandbox·CPU/Mem/API 限制 | PLAN-L3 | 资源隔离缺·属 K8s 运行时底座（F§8；D 文 L3 K8s/helm） |
| V4-1-024 | 360 | 65.13 | Sandbox·Tool 白名单 | SYS-HAS | mcp/runtime.ts:33,46 commandAllowlist + AgentDefinition.tools |
| V4-1-025 | 374-382 | 65.14 | MCP Tool 必须注册 | SYS-HAS | mcp/ client-runtime + mcp-server/projection.ts 投影注册 |
| V4-1-026 | 383-387 | 65.14 | 危险操作禁止清单(禁删工单/改财务) | PLAN-L3 | L3 概称；显式 deny 清单无·写操作 S2 审批兜底注（F§9） |
| V4-1-027 | 389-404 | 65.15 | MCP 安全网关前置 Policy Check | PLAN-L3 | L3 概称；现 OBO→数据层权威裁决（mcp-server/routes.ts:10-11·F§10），无专职前置网关 |
| V4-1-028 | 406-417 | 65.16 | 数据分级四级(Public…TopSecret) | PLAN-L3 | 点名"数据分级"（F§11 MISSING·全库无敏感级标签） |
| V4-1-029 | 418-427 | 65.16 | 制造密级清单(BOM/配方=密·价格/投资=绝密) | PLAN-L3 | 同上·规格点名场景（F TOP1） |
| V4-1-030 | 430-433 | 65.17 | 静态加密·数据库 AES-256 | PLAN-L3 | L3 概称；现仅凭据 AES-256-GCM（crypto.ts·F§12） |
| V4-1-031 | 435-436 | 65.17 | 传输加密 TLS | SYS-HAS | deploy/nginx.conf 网关（F§12） |
| V4-1-032 | 438-442 | 65.17 | 敏感字段加密(客户价格) | PLAN-L3 | 随"数据分级"track（F TOP1·业务字段明文） |
| V4-1-033 | 444-464 | 65.18 | Lineage·AI 回答必须知数据来源 | SYS-HAS | ProvenanceRef qos.ts:307 + 数字强制 ⟦ref:N⟧（agent/loop.ts:108）·现系统强项 |
| V4-1-034 | 467-472 | 65.19 | 模型四风险(泄露/注入/污染/越权)防护 | PLAN-L3 | L3 概称（F§14 MISSING；注入项与 036 点名重叠） |
| V4-1-035 | 475-487 | 65.20 | Model Registry 安全六要素 | DEFER-OK | 无自托管模型·现外部 LLM 供应商+加密凭据治理（llmproviders.ts·F§14 刚需低中）；若自托管随 L3 K8s 再议 |
| V4-1-036 | 490-504 | 65.21 | Prompt 注入三层防护 | PLAN-L3 | 点名"注入防护"（F§15 MISSING·仅 sanitizeLlmAuthLeak 非防注入） |
| V4-1-037 | 507-515 | 65.22 | AI 输出安全检查(合规/权限/敏感) | PLAN-L3 | 点名"输出安全"（F§16 MISSING·行级过滤仅限入不查出） |
| V4-1-038 | 518-536 | 65.23 | 重大决策审批流(建议→评估→审批→执行) | SYS-HAS | S2 actions.ts:101（R4·审批链 1-3 步·禁自批） |
| V4-1-039 | 539-556 | 65.24 | Audit Event 全行为记录(actor/action/object) | SYS-HAS | audit.ts append-only + requestId 贯穿 + SIEM 旁路（F§18·G-SIEM-1 已闭） |
| V4-1-040 | 559-571 | 65.25 | 实时安全监控三类异常(Agent/数据/模型) | PLAN-L3 | L3 概称（F§19 MISSING·TOP5#5；现 metrics 为运营非安全检测） |
| V4-1-041 | 574-598 | 65.26 | 工业分层网络架构 | SYS-HAS | 部署分层（nginx 网关）+平台不下沉现场（F§20） |
| V4-1-042 | 601-623 | 65.27 | 不直接控制设备(OS 建议/MES 执行/PLC 控制) | SYS-HAS | 建议式设计立场·Action 只产 Draft→审批（F§20 架构原则内建） |
| V4-1-043 | 626-645 | 65.28 | 锂电案例·允生成计划禁直改 MES+经理审批 | SYS-HAS | actions.ts:101 + writeback.ts（mock 诚实标注·WRITEBACK_NOT_CONFIGURED） |
| V4-1-044 | 648-671 | 65.29 | POST /security/check→{allowed,requireApproval} | SYS-HAS | 等价 POST /a/v1/authz/explain（authz.ts:108）；requireApproval 字段/Agent actor 入参缺→L3 概称注（F§21 刚需低） |
| V4-1-045 | 674-682 | 65.30 | 安全 MVP：IAM/RBAC/AgentID/网关/审计/审批 | PLAN-L3 | Agent Identity+MCP 网关残（点名/概称）；IAM/RBAC/Audit/Approval 4/6 已 HAS 注 |
| V4-1-046 | 685-692 | 65.31 | 验收六条(人+Agent 统一管理…可审批) | PLAN-L3 | "人和 Agent 身份统一管理"残（点名）；隔离/审批/审计/追踪已 HAS 注 |

## Chapter 67 · Cloud Native Decision OS Runtime（L698–1483）

| ID | 行 | 章 | 需求(≤25字) | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V4-1-047 | 708-719 | 67.1.1 | Runtime 统一运行 Agent/Skill/模型/求解/模拟/数据/流程 | SYS-HAS | 等价·双服务进程内：agent/loop.ts+workflow/executor.ts+solvers+sim/+timeseries.ts+scheduler.ts |
| V4-1-048 | 722-765 | 67.1.2 | 运行对象=智能任务链(Task→Agent→Skill→Model→Tool) | SYS-HAS | QOS 编排链 Query→classify→Intent→ExecutionPlan→SSE（router/orchestrator） |
| V4-1-049 | 768-824 | 67.2 | 控制面六 Runtime+基础设施面(K8s/GPU/存储) | PLAN-L3 | 基础设施面=K8s/helm 点名（D 文 L3·现 docker-compose）；控制面功能等价注 |
| V4-1-050 | 827-849 | 67.3 | 十核心组件(含 Event Bus/Resource Manager) | SYS-HAS | 9/10 等价（loop/scheduler.ts:1/executor/skill-router/llmproviders/mcp/solvers/sim/outbox）；Resource Manager 缺→L3 注 |
| V4-1-051 | 852-881 | 67.4 | Kubernetes 编排层+五 Namespace | PLAN-L3 | K8s/helm 点名（A 文 §4 第3层"刚需"·现无 K8s 工件） |
| V4-1-052 | 884-901 | 67.5 | Namespace 按运行对象隔离 | PLAN-L3 | 同上（K8s 承载） |
| V4-1-053 | 903-928 | 67.6 | Agent Runtime 六步生命周期 | SYS-HAS | agent/loop.ts + context.ts + skill-router.ts |
| V4-1-054 | 931-951 | 67.7 | Agent Scheduler 按优先级/能力/资源/期限调度 | DEFER-OK | 范式分歧（A 文 row E 判例）：请求/事件驱动即时执行；cron 定时作业已有 scheduler.ts:1 |
| V4-1-055 | 954-980 | 67.8 | Task 模型(task_id/agent/skill/priority/deadline) | SYS-HAS | 等价 QueryTask（contracts/qos.ts:424 taskId/status）；priority/deadline 字段无注 |
| V4-1-056 | 983-1007 | 67.9 | Skill Runtime 五步(定义→映射→绑定→执行→校验) | SYS-HAS | B4 Skill + skill-router.ts + workflow/validate.ts |
| V4-1-057 | 1010-1026 | 67.10 | Skill 容器化独立部署 | PLAN-L3 | K8s track（现进程内） |
| V4-1-058 | 1028-1052 | 67.11 | Workflow Engine 多 Agent 业务流程 | SYS-HAS | workflow/executor.ts（B2） |
| V4-1-059 | 1054-1084 | 67.12 | Workflow DSL(YAML steps) | SYS-HAS | 等价 zod WorkflowDefinitionSchema steps 1-12（contracts/agentcore.ts:68·JSON 非 YAML） |
| V4-1-060 | 1086-1109 | 67.13 | Model Runtime 统一四类模型(LLM/小/时序/优化) | SYS-HAS | 部分等价：LLM 多供应商（llmproviders.ts+llm-adapters）+时序 A8 timeseries.ts+优化 S1；自托管小模型无注 |
| V4-1-061 | 1112-1129 | 67.14 | Model Gateway(路由/负载均衡/版本/权限) | SYS-HAS | 等价·多 LLM 供应商路由+provider 绑定+加密凭据；负载均衡无注 |
| V4-1-062 | 1132-1146 | 67.15 | GPU 资源池四分区 | DEFER-OK | 无自托管模型·LLM 走外部 API（无 GPU 管理对象） |
| V4-1-063 | 1149-1171 | 67.16 | 国产 GPU 适配层(昇腾/寒武纪) | DEFER-OK | 同上；llm-adapters custom_http 留接口（CLAUDE.md §1.2） |
| V4-1-064 | 1174-1193 | 67.17 | Solver Runtime 优化任务独立运行 | SYS-HAS | S1 solver-registry.ts:54（48 求解器）；进程内非独立 runtime 注 |
| V4-1-065 | 1196-1213 | 67.18 | Solver 资源隔离(32C/128G/30min) | DEFER-OK | 现求解器为轻量确定性同步计算（R6）·无长时 OR 作业；需时随 L3 K8s 资源配额 |
| V4-1-066 | 1216-1237 | 67.19 | Simulation Runtime 万次推演 | SYS-HAS | 等价·sim/propagation.ts+capex_scenario+counterfactual_timeline；确定性单例推演（非蒙特卡洛）范式注 |
| V4-1-067 | 1239-1281 | 67.20 | 事件驱动架构(Event→Bus→Agent→Workflow→Action) | SYS-HAS | outbox.ts + emitDomainEvent（agentcore/server.ts:198）+ event-subscriptions.ts（D-29） |
| V4-1-068 | 1283-1297 | 67.21 | Event Bus 用 Kafka/Pulsar+五事件类型 | DEFER-OK | 范式分歧判例（A 文 row E）：outbox+轮询 SLO≤60s；领域事件类型等价注 |
| V4-1-069 | 1299-1315 | 67.22 | Data Runtime(源→Fabric→本体→应用) | SYS-HAS | A1 连接器→A3 建模→A4 本体链 |
| V4-1-070 | 1317-1337 | 67.23 | 多租户 SaaS 隔离(Data/Agent/Model) | SYS-HAS | R2 tenant_id everywhere（仓储/事件/缓存键） |
| V4-1-071 | 1339-1359 | 67.24 | 私有化部署(企业内网) | SYS-HAS | docker-compose.yml + DEPLOY.md 中文部署指南；K8s 形态→L3 注 |
| V4-1-072 | 1361-1377 | 67.25 | 边缘计算 Edge AI Node | DEFER-OK | 系统边界=决策建议层不下沉现场（与 65.27 同立场）；IoT 经连接器/时序摄入 |
| V4-1-073 | 1379-1409 | 67.26 | POST /runtime/task→{task_id,status} | SYS-HAS | 等价·QOS 查询任务提交→QueryTask{taskId,status}（contracts/qos.ts:424） |
| V4-1-074 | 1412-1427 | 67.27 | Runtime 监控(Agent 调用/成功率/延迟·Token·求解时长) | SYS-HAS | agentcore/metrics.ts:78 + datacore/metrics.ts + OTel tracing.ts（G-15 已闭）；GPU 指标无注 |
| V4-1-075 | 1429-1462 | 67.28 | 案例·OrderChanged→多 Agent→10 分钟出方案 | SYS-HAS | 链路等价：事件→QOS→solver→SSE；S01 接单+what_if_displacement（solver-registry.ts:102） |
| V4-1-076 | 1465-1473 | 67.29 | Runtime MVP 六项(K8s/Agent/Workflow/网关/MCP/Solver) | PLAN-L3 | K8s 残（点名）；其余 5/6 已等价 HAS 注 |
| V4-1-077 | 1476-1483 | 67.30 | 验收六条(规模化/多版本/Solver/Sim/私有化/稳定) | PLAN-L3 | Agent 规模化(K8s)+模型多版本治理残；Solver/Sim/私有化已 HAS 注 |

## Chapter 69 · 锂电制造 Decision OS 完整案例（L1485–3299）

| ID | 行 | 章 | 需求(≤25字) | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V4-1-078 | 1493-1510 | 69.1 | 大型动力电池集团四业务案例底座 | SYS-HAS | 锂电行业包 demo（synthetic/battery.ts + battery-extended.ts） |
| V4-1-079 | 1513-1534 | 69.2 | 集团/事业群组织规模模拟 | SYS-HAS | 等价·多基地+DemandSegment 细分（乘用/储能/商用） |
| V4-1-080 | 1536-1541 | 69.3 | 12 基地制造网络模型 | SYS-HAS | demo 多基地（常州/成都/眉山/枣庄…battery.ts:349-351）；A7 (industry,scale,seed) 可扩规模 |
| V4-1-081 | 1544-1567 | 69.4 | 产品本体 Cell/Module/Pack/ESS 层级 | SYS-HAS | Model 对象+型号族（4680-NCM 等）；四层装配层级粒度注 |
| V4-1-082 | 1570-1598 | 69.5 | 电芯产品对象(chemistry/capacity/application) | SYS-HAS | Model 对象 demo（battery.ts） |
| V4-1-083 | 1601-1609 | 69.6 | 产品族三类(乘用/商用/储能·314Ah 等) | SYS-HAS | demo 型号族+细分市场 |
| V4-1-084 | 1612-1650 | 69.7 | 制造工艺链十道(Mixing→…→Pack) | SYS-HAS | Process 对象·涂布/化成 demo（S12 processKey=涂布；S24 layers 含 Process） |
| V4-1-085 | 1653-1672 | 69.8 | Process 对象(cycle_time/equipment) | SYS-HAS | Process 类型 demo |
| V4-1-086 | 1675-1695 | 69.9 | Factory 对象(region/capacity) | SYS-HAS | Base 对象 demo |
| V4-1-087 | 1698-1722 | 69.10 | 产线对象(product/daily_capacity/status) | SYS-HAS | Line 对象·capacityDaily 字段（S21 参数用） |
| V4-1-088 | 1725-1745 | 69.11 | Equipment 对象(type/line/status) | SYS-HAS | Equipment demo（S24 断供半径 layers 用） |
| V4-1-089 | 1748-1764 | 69.12 | Customer 对象(OEM/segment) | SYS-HAS | Customer demo |
| V4-1-090 | 1767-1791 | 69.13 | Order 对象(customer/product/qty/delivery) | SYS-HAS | Order demo（54 处引用） |
| V4-1-091 | 1803-1855 | 69.13续 | SalesOrder 需求穿透六级链到产能分配 | SYS-HAS | order_fullchain solver（so/vc/kpis/dag 全链）+capacity 族 |
| V4-1-092 | 1858-1883 | 69.14 | Demand 对象(需求转化/时间窗) | SYS-HAS | DemandSegment demo |
| V4-1-093 | 1886-1941 | 69.15 | 需求分解·产能=需求/良率/可动率(含换型停机保养) | SYS-HAS | capacity_forecast/capacity_rollup + changeover_sequence/maintenance_stagger 因素齐备 |
| V4-1-094 | 1943-1960 | 69.16 | Material 六类本体(正负极/隔膜/电解液/壳/BMS) | SYS-HAS | Material demo（三元正极等） |
| V4-1-095 | 1963-1986 | 69.17 | Material 对象(supplier/lead_time/risk) | SYS-HAS | Material+Supplier demo；lta_gap 用料口径 |
| V4-1-096 | 1989-2026 | 69.18 | BOM 本体+BOM 对象 | SYS-HAS | BomLine demo |
| V4-1-097 | 2029-2080 | 69.19 | 三类库存分开(原料/半成品/成品)+库存对象 | SYS-HAS | MaterialBalance/MaterialBatch/Warehouse + inventory_optimize；三层分账粒度注 |
| V4-1-098 | 2083-2107 | 69.20 | Supplier 对象(lead_time/risk) | SYS-HAS | Supplier demo + supplier_disruption_radius |
| V4-1-099 | 2110-2131 | 69.21 | 制造约束本体七类(产能…碳) | SYS-HAS | 七类均有对应求解器/规则（capacity/mrp/cert/yield/risk/quote_margin/carbon_footprint + A5 规则 DSL） |
| V4-1-100 | 2134-2156 | 69.22 | 产能约束规则(线×日上限) | SYS-HAS | capacity 族 + A5 规则；Line.capacityDaily |
| V4-1-101 | 2158-2170 | 69.23 | 工艺约束(型号必经某工序) | SYS-HAS | 工艺路由/认证约束（cert_schedule·certifiedModels）+规则 |
| V4-1-102 | 2172-2186 | 69.24 | 质量约束(客户良率>99.5%) | SYS-HAS | A5 规则 DSL + outsourceQualityGate（outsourcing_split 出参） |
| V4-1-103 | 2188-2208 | 69.25 | 碳约束(碳=能源+材料+运输) | SYS-HAS | carbon_footprint（breakdown/threshold/verdict·solver-registry.ts:75；battery.ts:384 euThreshold） |
| V4-1-104 | 2210-2237 | 69.26 | 完整 Ontology Graph 九对象贯通 | SYS-HAS | GET /a/v1/ontology/graph（datacore/app.ts:2331）+ demo 链路 |
| V4-1-105 | 2239-2245 | 69.27 | 企业数据规模模拟(主数据/交易数据) | SYS-HAS | A7 合成数据 (industry,scale,seed) 字节级确定；本节数值为空·原样 |
| V4-1-106 | 2247-2280 | 69.28 | 数据架构六源→Data Fabric→本体→OS | SYS-HAS | A1 连接器→A3 半自动建模→A4 本体 |
| V4-1-107 | 2283-2317 | 69.29 | 多模型库(pg+Neo4j+Timescale+Milvus) | DEFER-OK | 范式判例（row E）：单 pg 多模承载——graphmeta.ts 图、timeseries.ts 时序、embeddings.ts 向量（确定性伪向量） |
| V4-1-108 | 2319-2341 | 69.30 | 欧洲新订单 80 万场景→启动需求分析 | SYS-HAS | S01 订单可承接卡 + what_if_displacement（Q30-P1 Q01 NL 打穿在建注） |
| V4-1-109 | 2343-2356 | 69.31 | Demand Agent 输出(需产能日/瓶颈风险) | SYS-HAS | capacity_forecast + bottleneck_matrix |
| V4-1-110 | 2358-2372 | 69.32 | Planning Agent 查各基地可用性 | SYS-HAS | capacity_rollup（bases 出参）+ affected_orders |
| V4-1-111 | 2375-2406 | 69.33 | Solver 多目标(交付+利润−成本−风险−碳)+X(i,j,k,t) | SYS-HAS | 等价·plan_generate 多方案 + selection/assignment/sequencing_optimize 目标函数族；单一全局多目标 MIP 非现范式注 |
| V4-1-112 | 2409-2421 | 69.34 | Solver 四约束(产能/交付/材料/工艺) | SYS-HAS | capacity 族/risk_timeline/mrp_netting+kit_readiness/cert_schedule 等价 |
| V4-1-113 | 2423-2441 | 69.35 | Solver 输出推荐(基地/线/启动/交付日) | SYS-HAS | plan_generate + what_if_displacement（schemes/recommended/comparison） |
| V4-1-114 | 2444-2483 | 69.36 | Simulation 三方案比选(扩产/跨基地/外协) | SYS-HAS | S05 plan_generate 三案 + S17 capex_scenario + S14 outsourcing_split；battery.ts:347-351 方案 A-E 敏感性；Q30-P1 multi_plan_compare 增强在建注 |
| V4-1-115 | 2485-2513 | 69.37 | Executive Decision Package(ID/推荐/原因/风险) | SYS-HAS | decisions.ts 决策台账 + Answer 决策包结构；统一 Decision 内核→PLAN-L2 注（D 文 §2 L2） |
| V4-1-116 | 2515-2546 | 69.38 | 生产执行 Agent 五职责(接计划/转任务/监控/偏差/重排) | SYS-HAS | 等价链：S2 执行（actions.ts）+writeback.ts（WO-ACTUATE 出站适配·mock 诚实）+事件驱动重算；专职执行 agent 无注 |
| V4-1-117 | 2548-2568 | 69.38.2 | 按基地配置生产 Agent 对象 | SYS-HAS | 能力面：/b/v1/agents CRUD（agentcore/server.ts:996-1037）；demo 未 seed 专职注 |
| V4-1-118 | 2571-2608 | 69.39 | 制造工单对象七要素(产品/工艺/设备/人/料/时/质) | SYS-HAS | 能力面：A4 自定义对象类型可建模；demo 无工单粒度对象注 |
| V4-1-119 | 2611-2639 | 69.40 | 分钟级动态排产闭环(事件→重算→MES 更新) | SYS-HAS | 等价：领域事件→solver 重算→Action→writeback（mock 诚实·真 ERP 留 stub） |
| V4-1-120 | 2641-2662 | 69.41 | 设备故障事件对象(equipment/time) | SYS-HAS | 领域事件 + timeseries.ts + audit_timeline/risk_timeline |
| V4-1-121 | 2665-2683 | 69.42 | 设备故障预测(IoT+历史→预停机 18h/影响 42000) | **OMISSION** | 预测性维护模型全平台无（grep 故障预测/predictive 零命中）；现仅处置类 maintenance_stagger+影响类 affected_orders；任何计划未涉 |
| V4-1-122 | 2685-2723 | 69.43 | Impact Graph 五级传播(设备→线→单→客户→收入) | SYS-HAS | supplier_disruption_radius（layers 逐级）+generic_inference+order_fullchain |
| V4-1-123 | 2726-2755 | 69.44 | 自动生成三恢复方案(修/转基地/调排序) | SYS-HAS | mitigation_select（plans/recommended·S06 采纳→ACTION_DRAFT） |
| V4-1-124 | 2757-2782 | 69.45 | COO Decision Package(影响单数/损失/建议) | SYS-HAS | affected_orders + mitigation_select + Answer |
| V4-1-125 | 2785-2814 | 69.46 | 供应链 Agent 监控五级链(供→料→库→产→客) | SYS-HAS | lta_gap/kit_readiness/mrp_netting/supplier_disruption_radius 族 |
| V4-1-126 | 2817-2842 | 69.47-48 | 供应商延期 15 天→第 25 天缺料推理 | SYS-HAS | kit_readiness（缺料开工）+mrp_netting（净需求）+risk_timeline（越线日） |
| V4-1-127 | 2844-2860 | 69.49 | 三措施生成(增购/换供应商/调计划) | SYS-HAS | mitigation_select + countermeasure_combo + quarterly_gap（组合对策） |
| V4-1-128 | 2863-2885 | 69.50 | 财务 Agent 实时四级(订单利润→ROI) | SYS-HAS | finance_pnl（pnl/attribution）+capex_scenario（投资回报） |
| V4-1-129 | 2887-2925 | 69.51 | 产品利润模型(收入−五项成本=毛利) | SYS-HAS | finance_pnl（gmRow/attribution 成本分解） |
| V4-1-130 | 2928-2949 | 69.52 | CFO 低价订单决策(毛利 18→11%·条件接受) | SYS-HAS | quote_margin（S15·margin/floor/verdict）+credit_exposure（长期合同风控 S16） |
| V4-1-131 | 2952-2970 | 69.53 | 质量 Agent 四级监控(来料→过程→电芯→Pack) | SYS-HAS | 等价·yield_diagnosis+质量规则闸；全四级在线监控面粒度注 |
| V4-1-132 | 2973-2985 | 69.54 | 良率预测模型(温度/压力/批次→预测 98.7%) | **OMISSION** | 预测类 ML 无（grep 良率预测/yield_predict 零命中）；现仅事后诊断 yield_diagnosis+基线 yield_baseline 时序；任何计划未涉 |
| V4-1-133 | 2987-3000 | 69.55 | 质量异常归因(容量降→批次→供应商风险) | SYS-HAS | yield_diagnosis（breakpoint/candidates）+MaterialBatch demo 对象 |
| V4-1-134 | 3003-3018 | 69.56 | 能源 Agent 降 kWh 成本+碳排(化成/烘烤) | Q30 | Q30-P3 `energy_cost_schedule` 已规划（DESIGN-query30-orch-split.md:23）；碳侧 carbon_footprint 已 HAS 注 |
| V4-1-135 | 3021-3042 | 69.57 | 碳优化入目标函数(夜间生产·电-12%碳-8%) | SYS-HAS | carbon_footprint（maxLever 杠杆建议·S20）；时段电价调度维度归 Q30-P3 注 |
| V4-1-136 | 3044-3061 | 69.58 | 全集团优化(12 基地/300 线/200 品/100GWh 分配) | SYS-HAS | 等价·S&OP sop.ts（app.ts:365）+多基地 demo+A7 scale；该规模真跑未证注 |
| V4-1-137 | 3063-3089 | 69.59 | 全局求解多目标(利润/交付/稼动↑·成本/风险/碳↓) | SYS-HAS | 等价·plan_generate+sop+optimize 求解器族；单一全局 MIP 范式注（同 111） |
| V4-1-138 | 3095-3111 | 69.61 | Decision Cockpit CEO 四指标(满足率/稼动/利润/碳) | SYS-HAS | cockpit_kpi + metric_rollup + 前端 DashboardView；69.60 输出节为空原样注 |
| V4-1-139 | 3114-3135 | 69.62 | 集团数字孪生五层(厂→线→设备→品→供) | SYS-HAS | 等价·本体图+A8 时序+sim 推演（propagation.ts）构成孪生功能面；无 Twin 专名注 |
| V4-1-140 | 3137-3153 | 69.63 | 推演问题库预置(生产/投资/风险三类) | SYS-HAS | scenarios-catalog.ts 26 卡（S01-S26 三类全覆盖）；Q30-P5 30 intent 扩目录在建注 |
| V4-1-141 | 3155-3177 | 69.64 | 需求降 30% 全局推演(关线/转储能/利润) | SYS-HAS | 等价能力·capex_scenario+plan_generate+counterfactual_timeline；该具体问句未预置·扩目录属 Q30-P5 范畴注 |
| V4-1-142 | 3179-3211 | 69.65 | 完整闭环八环(客户→…→学习→决策) | SYS-HAS | QOS→S2→decisions→growth 发育闭环（R16） |
| V4-1-143 | 3213-3225 | 69.66 | 决策沉淀数据闭环(记忆→知识→未来优化) | SYS-HAS | decisions.ts OUTCOME_RECORDED 复盘 + S4 kb.ts + calibration/ 校准 |
| V4-1-144 | 3227-3243 | 69.67 | AI 企业大脑长期沉淀四资产 | SYS-HAS | 等价（143 同源）·愿景级表述 |
| V4-1-145 | 3245-3263 | 69.68 | 实施路线三阶段(3/6/12 月) | DEFER-OK | 交付路线图非系统功能；各阶段能力（本体/连接/看板/Copilot/Agent/Solver/Sim/多基地）现均有对应 |
| V4-1-146 | 3266-3271 | 69.69 | 商业价值测算(100GWh 改善) | DEFER-OK | 商业叙述·数值为空（ZIP 原样）·非功能需求 |
| V4-1-147 | 3273-3298 | 69.70 | 章结=本体+AI 员工+优化+孪生+Runtime | SYS-HAS | 平台构成吻合（A4+B1/B5+S1+A8+双服务运行时）；"Syste"截断原样注 |

## Chapter 70 · Complete Decision OS Product Blueprint（L3301–4232）

| ID | 行 | 章 | 需求(≤25字) | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V4-1-148 | 3303-3309 | 70.1.1 | AI-Native 工业决策 OS·非 ERP/MES/APS/BI 替代 | SYS-HAS | 定位一致：决策层+连接器对接既有系统（CLAUDE.md 架构地图） |
| V4-1-149 | 3311-3328 | 70.1.1 | 位于业务系统层之上(决策/业务/物理三层) | SYS-HAS | A1 连接器对接 ERP/MES 等+建议式不下沉（同 042） |
| V4-1-150 | 3330-3423 | 70.1.2 | 产品全景五层(体验/智能/本体/数据/现实) | SYS-HAS | frontend-shell/agentcore(B)/datacore A4/A1 分层等价 |
| V4-1-151 | 3426-3463 | 70.1.3 | 价值链七步(理解→发现→推演→方案→择优→执行→学习) | SYS-HAS | QOS 分类→solver 推演→plan_generate 择优→S2 执行→growth 学习（R16） |
| V4-1-152 | 3466-3467 | 70.1.4 | 产品能力矩阵 | DEFER-OK | 空节无内容（ZIP 原样）·无可判定需求 |
| V4-1-153 | 3469-3598 | 70.2.1 | 五层技术架构(含三引擎/LLM/Solver/孪生/K8s/GPU/IAM) | SYS-HAS | 主体等价（各层见 150 等）；基础设施层 K8s/GPU→PLAN-L3/DEFER 注（051/062） |
| V4-1-154 | 3600-3645 | 70.2.2 | 核心链路 11 步(问→意图→本体→协作→模拟→优化→包→审批→执行) | SYS-HAS | QOS 编排链+S2 审批+B2 工作流（orchestrator·与 048 同链） |
| V4-1-155 | 3647-3654 | 70.2.3 | 核心技术组件四层 | SYS-HAS | 同 153（AI/优化/本体/数据四层均在） |
| V4-1-156 | 3665-3754 | 70.3.1 | 六大一级模块(体验/AI员工/引擎/本体/数据/治理) | SYS-HAS | 六域对应：前端/B1/S1+sim/A4/A1/A0+A6+audit |
| V4-1-157 | 3757-3783 | 70.4.1 | Executive Cockpit 六页(健康/营收/产能/风险雷达/投资/建议) | SYS-HAS | 等价·workspace 角色导航（contracts/workspace.ts:36）+cockpit_kpi+RiskBoardView+capex_scenario；CEO 专属页非逐项注 |
| V4-1-158 | 3786-3812 | 70.4.2 | COO Cockpit 五模块(生产/产能/交付风险/排产/基地对比) | SYS-HAS | RiskBoardView+bottleneck_matrix+capacity_rollup（bases 对比）+plan 视图 |
| V4-1-159 | 3815-3821 | 70.4.3 | Planner Cockpit(APS 替代/动态排产/资源调度) | SYS-HAS | planner 角色 workspace+changeover_sequence/sequencing_optimize/maintenance_stagger |
| V4-1-160 | 3824-3850 | 70.5.1 | Executive Agents(CEO 战略/COO 运营/CFO 经济) | SYS-HAS | 等价·通用 agent（universal.ts）+职责对应求解器族（capex+plan_generate/mitigation/finance_pnl）；专职三 agent 未 seed 注（B1 可配） |
| V4-1-161 | 3853-3865 | 70.5.2 | 制造五 Agent(计划/排产/质量/设备/能源) | SYS-HAS | 等价·对应求解器/场景卡族（plan_generate/changeover/yield_diagnosis/maintenance_stagger/carbon+Q30-P3 energy） |
| V4-1-162 | 3866 | 70.5.2 | Safety Agent(安全生产智能体) | **OMISSION** | EHS/安全生产场景全平台零对应（grep EHS/安全生产零命中）·任何计划未涉；蓝图清单项·案例级低危 |
| V4-1-163 | 3870-3879 | 70.5.3 | 供应链四 Agent(需求预测/供应商风险/库存/物流) | SYS-HAS | 4/4 等价：capacity_forecast/supplier_disruption_radius+multisource/inventory_optimize/min_cost_flow+facility_location |
| V4-1-164 | 3886-3906 | 70.6.1 | Reasoning Engine 因果推理"为什么" | SYS-HAS | plan_rootcause（dag/offTarget）+margin_attribution；通用因果 NL 路由→PLAN-L1 WO-CAUSAL-PATH 注（A 文 §4 第1层） |
| V4-1-165 | 3908-3927 | 70.6.2 | Optimization Engine 五算法(LP/MIP/CP/启发式/RL) | SYS-HAS | 等价·13 个组合优化求解器（selection/assignment/sequencing/packing/facility/min_cost_flow/set_cover/independent_set/auction/optimize_whatif）；LP/MIP 外部引擎与 RL 非现范式注（R6 确定性立场） |
| V4-1-166 | 3930-3940 | 70.6.3 | Simulation Engine what-if 三问(增线/关基地/涨价) | SYS-HAS | optimize_whatif+capex_scenario+counterfactual_timeline+what_if_displacement |
| V4-1-167 | 3942-3972 | 70.7.1 | 业务对象模型 11 对象(含 Workshop/Employee) | SYS-HAS | 9/11 demo 已有（Base/Line/Equipment/Model/Material/Customer/Supplier/Order+组织）；Workshop 车间层级/Employee 一等对象缺（engineerGroups 雏形）注·A4 可自建 |
| V4-1-168 | 3974-4001 | 70.7.2 | 关系图六动词(places/requires/…/supplied by) | SYS-HAS | A4 links（fromTypeKey/toTypeKey/linkKey/cardinality）+ontology/graph edges |
| V4-1-169 | 4003-4022 | 70.7.3 | 约束模型三例(线型匹配/供应商认证/客户良率) | SYS-HAS | A5 规则 DSL+certifiedModels（cert 约束）+质量闸（同 101/102） |
| V4-1-170 | 4024-4051 | 70.8.1 | 数据连接 11 源(SAP/Oracle/MES/WMS/PLM/CRM/SCADA/IoT/Excel/文档) | SYS-HAS | connectors/registry.ts:27-144（sap_erp/generic_jdbc/rest_api/external_feed/file_upload/knowledge_base/salesforce_crm）；SCADA/IoT 经 rest/feed+timeseries 摄入注 |
| V4-1-171 | 4053-4072 | 70.8.2 | 数据处理五步(清洗→映射→本体绑定→决策数据) | SYS-HAS | connectors/profiler+parsers→mapping.ts→A4 绑定+quarantine.ts/datahealth.ts |
| V4-1-172 | 4074-4086 | 70.8.3 | 知识层六类(SOP/工艺/专家/维修/决策史/纪要) | SYS-HAS | S4 kb.ts+embeddings+A2 ruledocs.ts（规则文档抽取）+decisions.ts 决策史 |
| V4-1-173 | 4089-4099 | 70.9.1 | Agent Runtime(创建/调度/生命周期) | SYS-HAS | /b/v1/agents CRUD（server.ts:996-1037）+agent/loop.ts |
| V4-1-174 | 4102-4121 | 70.9.2 | Workflow 五步自动化(订单变化→…→审批→执行) | SYS-HAS | B2 workflow/executor.ts+S2 审批+事件触发 |
| V4-1-175 | 4124-4136 | 70.9.3 | Security Governance 六项(IAM/RBAC/ABAC/审计/数据/模型安全) | PLAN-L3 | Data Security(分级)/Model Security 残（点名/概称·同 028/034）；IAM/RBAC/ABAC/Audit 4/6 已 HAS 注 |
| V4-1-176 | 4139-4159 | 70.10 | 锂电产品包九模块(产能/计划/APS/供应链/质量/设备/能源/碳/高管) | SYS-HAS | 9 模块对应场景卡/求解器（S01/S05/S11/S24/S12/S13/S20/S04+cockpit_kpi）；能源专项归 Q30-P3 注 |
| V4-1-177 | 4162-4206 | 70.11 | MVP 三阶段(本体+连接+Copilot+看板→Agent+Solver+Sim+流程→员工+孪生+大脑) | SYS-HAS | 三阶段能力均已在：A3/A1/QOS/RiskBoard→B1/S1/sim/B2→agents+本体时序+S4 |
| V4-1-178 | 4209-4231 | 70.12 | 最终定义=本体+AI员工+优化+模拟+数据底座+Runtime | SYS-HAS | 平台构成吻合；文末 L4232"从："截断原样注 |

## 计数

| verdict | 条数 |
|---|---|
| SYS-HAS | 133 |
| PLAN-L3 | 30 |
| PLAN-L0/L1/L2 | 0（独立条目；L2 统一决策内核/L1 因果路由以注记挂 115/164） |
| Q30 | 1 |
| DEFER-OK | 11 |
| **OMISSION** | **3** |
| **总计** | **178** |

分章：Ch65=46（HAS 22/L3 23/DEFER 1）· Ch67=31（HAS 19/L3 6/DEFER 6）· Ch69=70（HAS 64/Q30 1/DEFER 3/OMISSION 2）· Ch70=31（HAS 28/L3 1/DEFER 1/OMISSION 1）

## OMISSION 明细

| ID | 行 | 需求 | 说明 |
|---|---|---|---|
| **V4-1-121** | 2665-2683 | 设备故障预测（Equipment Agent 预测性维护） | 规格要求以 IoT+历史维修+设备模型预测故障与停机时长；全平台无任何预测性维护模型（grep 零命中），现仅有处置类 maintenance_stagger 与影响类 affected_orders/audit_timeline；A 文/D 文/PRD/Q30 均未涉。属"预测类 ML"能力簇缺口之一。 |
| **V4-1-132** | 2973-2985 | 良率预测模型（工艺参数→预测良率） | 规格要求以温度/压力/材料批次/工艺参数预测批次良率；现仅事后诊断（yield_diagnosis 归因）与良率基线时序（yield_baseline/yield_daily），无预测模型；任何计划未涉。与 121 同属"预测类 ML"缺口簇（与现"确定性求解器"范式正交，如立项建议并簇处理）。 |
| **V4-1-162** | 3866 | Safety Agent（安全生产/EHS 智能体） | 70.5.2 制造 Agent 清单点名项；全平台无 EHS/安全生产对应场景卡、求解器或规则（grep 零命中），计划未涉。蓝图清单级要求·低危，但属字面零覆盖。 |

### 边界注记（非 OMISSION·防误读）
1. **Ch65 安全缺口全部有去处**：A 文 §1 表 row F 将开发四卷安全域整体判"AI 原生安全另立 track"（D 文 §2 L3）——其中 注入防护/输出安全/Agent 一等身份/数据分级 为 L3 **点名**项；每服务独立凭证、规范化角色表、危险操作 deny 清单、MCP 前置网关、静态业务加密、模型风险防护、安全监控 等为 L3 **概称**项（源 F 缺口集，L3 清单未逐项点名）——如需逐项立单，此 7 项须在 L3 track 开单时显式列入，否则有滑落风险。
2. **Ch67 无硬缺口**：云原生形态（K8s/Namespace/容器化/资源隔离）齐归 L3 K8s/helm；Kafka 事件总线、Agent 优先级调度、GPU/边缘为 DEFER-OK（范式分歧判例/无自托管模型/系统边界），非遗漏。
3. **Ch69/70 案例与蓝图主体已被现锂电 demo+48 求解器+26 场景卡覆盖**；"具体数值案例句"（如毛利 18→11%、良率 98.7%）按其承载的能力判定，不逐数值开条。
