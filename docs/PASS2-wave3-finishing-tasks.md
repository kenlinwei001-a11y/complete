# PASS2-WAVE3 · 收尾任务清单（核心平台模块 6 块定级）

> **这是什么**：Pass-2 第三波摸**核心平台模块**（账号权限/B1-B7/求解器/本体核心/数据流闭环/连接器）。**5 块 72-95% 已建（收尾）+ 数据流闭环 50%（第二大真缺口 = "能用"命脉）**。同前纪律：已建只接不重写；先 FDE 真跑；完成=亲手跑+证据；只 push `claude/vigilant-knuth-b1nmxn`、push 前 rebase。
>
> **建设度**：B1-B7 95% · 本体核心 92% · 账号权限 88% · 求解器 78% · 连接器 72% · **数据流闭环 50%**。
>
> ⚠️ **求解器好消息**：核心算法（S1.1 产能聚合 / S1.2 capacity_forecast / S1.6 plan_audit / S1.7 plan_generate）**公式精确真算非桩**，V1-V12 测试绿——G-1/G-2 场景卡的求解器值**可信**。缺的是 LIVE 数据口径（接真 ERP/SCADA）。

---

## 1. 🔴 数据流闭环 TR1-TR8（50% · 第二大真缺口 · 优先）

> **诊断**：订阅声明(`event-subscriptions.ts` 99 条)、outbox(5 档退避/幂等/有序)、前端失效框架**都在**；**但一串产出事件没发射 + AgentCore→DataCore 的 outbox 通道整个缺** → "产出了下游看不到/要重载才见"，**TR1-TR8 全部未真通**（违 D-29/R10/UP-1/PROP-1）。这是"能用"的闭环另一半。

| # | 任务 | 锚点（现状） | 优先级 | 完成判据 |
|---|---|---|---|---|
| DF-1 | **raw_dataset.uploaded 发射** | `connectors/service.ts:178-257` sync 无 emit | **P0** | 上传→建模页**不重载**列出新数据集（TR1·UP-1） |
| DF-2 | **derivation.completed 发射** | `modeling.ts` 无 outbox 依赖 | **P0** | 派生完成→驾驶舱数字自动变（TR1/5/8） |
| DF-3 | **materialize.completed 发射** | `app.ts` POST `/objectify` 无 emit | **P0** | 对象化完成→对象浏览/驾驶舱刷新（TR1/4/8） |
| DF-4 | **connection.sync_completed / dataset.regenerated / connector.sync_failed 发射** | `synthetic/service.ts`、`connectors/service.ts:248` 均无 emit | **P0** | 合成/同步完成→消费页联动；失败→通知（TR5/8） |
| DF-5 | **AgentCore→DataCore outbox 通道**（workflow/agent/intent/scenario.published 信号） | `apps/agentcore/src` 无 outbox 服务/无 emit（C-2 零调用架构需回路） | **P0** | B 栈资源发布→A 侧/前端绑定下拉失效（TR2/3） |
| DF-6 | kb.indexed 发射 | `kb.ts:44-80` addDoc/sync 无 emit | P1 | 知识库索引完成→可检索提示 |
| DF-7 | **TR1-TR8 端到端真跑确认** | `test/tr-dataflow.test.ts` 框架在但产出端缺 | **P0(验收)** | 逐条轨迹**真浏览器走通、不重载**（贴截图） |

> ⚠️ **可能值得独立 HANDOFF**：DF-5 跨栈 outbox 通道是架构级（AgentCore 至今 C-2 零调用 A，需建受控回路）。若收尾时发现牵动面大，停手报审核方升级为独立 HANDOFF。

---

## 2. 收尾任务（5 块 · P0/P1）

| # | 块 | 任务 | 锚点 | 优先级 | 判据 |
|---|---|---|---|---|---|
| AU-1 | 账号权限 | ServiceAccount 权限 Admin UI（/admin/service-accounts）+ scope 声明 | `opsteam/schedule.ts:213` 仅 seed 播种 | P0 | 后台定时任务可显式设最小授权 |
| AU-2 | 账号权限 | Agent 发布时 workflow 环检（agent→workflow→agent） | `server.ts:738` 仅运行期捕获 NestingError | P0 | 构造 A→W→A 环发布被拒（WF2） |
| AU-3 | 账号权限 | **MCP 不可信包裹 untrusted 标记 + render_answer 信任等级按工具分级**（安全） | `loop.ts:229` 无条件 VERIFIED_WORKFLOW | P1 | MCP 工具结果标 untrusted；含 EXTERNAL 步答案不冒充 VERIFIED |
| AU-4 | 账号权限 | 嵌套预算继承验证（防套娃刷预算） | `runtime.ts:9` budget 共享引用未验 | P1 | 套娃调用工具计入顶层计数 |
| B7-1 | B1-B7 | B7 求解器适配规约 + SolverRef 工具绑定模式 | PRD §8 仅标题；`tools/registry.ts` 无 solver 条目 | P1 | workflow/agent 可绑求解器（同 MCP/WORKFLOW 平行） |
| B7-2 | B1-B7 | create_action_draft 转发实装 + B→A 审批链 | `tools/executor.ts` 无该逻辑 | P1 | 采纳→B 调 A 草稿端点→PENDING_APPROVAL（与 DF-5 相关） |
| SV-1 | 求解器 | S1.5 affected_orders 真排产仿真（现 MOCK 哈希延误） | `risk.ts:507-547` delay=hash 抖动 | P0 | 延误天数来自排产仿真非哈希（可信值） |
| SV-2 | 求解器 | S1.3 bottleneck LIVE 4 因素（人力/物料/物流/换型，现回落 MOCK） | `risk.ts:40-65` liveTightness 仅 3 因素 | P0 | 接真指标后 4 因素归一非 MOCK seed |
| SV-3 | 求解器 | risk 事件源接真对象 / logistics 地址规范化 / S4.2 去重阈值 validate / S1.8 segMargin 来源校验 | `risk.ts:120-166`/`capacity.ts:362`/`battery.ts:176`/`plan.ts:31` | P1 | 各诚实标来源；阈值参数化 |
| OB-1 | 本体核心 | derivation_runs 表命名统一 + list 查询验证 | `ontology-core.ts:520` put 正确，无 list | P1 | 溯源弹窗可读 derivation_runs |
| CN-1 | 连接器 | FK 驱动字段映射模板（→A3 modeling 输入） | PRD §2.1 下行，无映射 API | P1 | 上传后 FK 候选自动关联引导建模 |
| CN-2 | 连接器 | REST 嵌套提取 / XLSX 多 sheet / 字段类型推断完整 | `registry.ts:237`/`parsers.ts:8` | P2 | 双层嵌套 JSON、多 sheet、date 推断 |

> 注：CN（connector.sync_failed）= DF-4，**数据流闭环 §1 是事件类的唯一主清单**，别重复实现。

---

## 3. 已建·别重写速查
- **B1-B7**：agent 注册+ruleBindings POST_CHECK+workflow invoke_agent/mcp+MAX_DEPTH=3 环检+MCP 客户端+skill 路由+场景 4 模式+QOS 路由（`engine.ts`/`runtime.ts`/`orchestrator.ts`）。
- **本体核心**：元模型 DDL+派生 DSL+Kahn 环检+增量重算 dryRun+切片执行+行级剪枝（O1-O10 全绿，`ontology-core.ts`/`ontology-dsl.ts`）。**别动。**
- **账号权限**：argon2+JWT+JWKS+四要素 workspace+三层权限+数据层强制+OBO+scope 检测（`auth.ts`/`authz.ts`）。
- **求解器**：S1.1/S1.2/S1.6/S1.7 **精确真算**+S1.8 五步+S2 审批+S3 调度+S4 知识库（`capacity.ts`/`plan.ts`/`risk.ts`/`sop.ts`）——**核心算法别碰，只补 LIVE 口径**。
- **连接器**：上传三路(csv/json/xlsx)统一+schema discovery+RawDataset 幂等+凭据密文+7 类型注册（`connectors/`）。

## 4. 派活 + 评审
- **数据流闭环（§1）单独一个 agent**——它牵动 A/B 两栈事件，DF-5 跨栈通道可能升级独立 HANDOFF（牵动大就停手报审核方）。其余 5 块按块认领。
- **评审**：同各 HANDOFF §5——不重写已建 · 门绿(尤 chain:check/事件类核 D-29) · **FDE 亲手证据**（数据流必真浏览器走 TR1-8 不重载）· 北极星距离。
- **诚实定性**：5 块收尾无架构断裂；数据流闭环是真补"产出→事件→下游"的另一半（D-29/R10 落地）。
