# 亲手用一遍 · 真相审计（§0）

> 方法（`fde-delivery` SOP）：起真服务（datacore:4001 + agentcore:4002，SEED_DEMO，跨系统 SERVICE_TOKEN+AGENTCORE_BASE_URL 已配），以 admin 身份用真实端点驱动端到端流程，记录"声称完成 vs 实际能用"。**非单测**。
> 首轮覆盖：数据构建发动机主线（故事→倒推→各模块生成→场景启动器→推演）。

## 数据构建发动机主线 · 实测结果（2026-06，真服务真请求）

对照两条故事跑同一条主线:

| 验收项（体验） | 策展故事「常州…风险推演」 | 真实新颖故事「工序/设备/共享瓶颈/降级/后果」 |
|---|---|---|
| build 成功 | ✅ SUCCEEDED | ✅ SUCCEEDED **（但空心）** |
| 倒推对象类型 | ✅ Base/Order/… | ◐ 仅 Order/Line/Customer（**漏 Process/Equipment**） |
| 倒推规则 | ✅ C03/C13/C05 | 🔴 **0** |
| 倒推求解器 | ✅ affected_orders/capacity_forecast | 🔴 **0** |
| 倒推切片入库 | ✅ slice_*（本轮已修，库里看得见） | ◐ slice_order/line/customer（**无工序/设备切片**） |
| 倒推 agent | ✅ agt_*（跨系统 scaffold 全 SCAFFOLDED） | 🔴 **0** |
| 跨系统全链闭包 | ✅ fullChainOk=true（plan/intent/scene/wf/skill/agent 全建） | —（无可建） |
| 场景进启动器 | ◐ **仅 `?includeDraft=true` 可见**；默认（PUBLISHED）看不到 | 🔴 **0，启动器无此卡** |
| 自检 verdict | （未测此句） | 🔴 **ANSWERABLE（谎报"无缺口"）** |
| 真能推演该问题 | （未测此句） | 🔴 **FAILED，无答案**（path AGENT，无 LLM） |

## Verdict（诚实）

**1. 策展故事 + 跨系统已配 → 倒推到各模块的生成是真的、可用的（给应得的肯定）。**
solvers/rules/scenes/agents 全部真建出，跨系统 scaffold 全链 `fullChainOk=true`。这条不是 vapor。

**2. 但即便 happy path，终态闭环仍缺一环（离"在启动器看到并真推演"还差）：**
生成的场景是 **DRAFT**，默认不进场景启动器（只有 `includeDraft` 才看得见）→ 用户看不到、跑不了。缺"**审批(R4)→publish→进启动器→重跑验证**"的末步。建域也不自动产出推演答案（answer=无）。

**3. 真实新颖故事 → 完全空心，且系统自己不知道（核心差距 + 一个真 bug）：**
- comprehend 关键词目录听不懂"工序/设备/瓶颈/降级/后果" → 0 规则/求解器/agent/场景；
- 🔴 **selfCheckGaps 谎报 `ANSWERABLE`**：因为它只查"已倒推的制品有没有 MISSING"，而"comprehend 压根没倒推出东西"时无 MISSING 项 → 误判无缺口。**"听不懂"没被当成缺口**——这是这次亲手跑才暴露、任何单测都没抓到的真 bug。
- 把该问题真提交 QOS → **FAILED 无答案**（无 LLM、path B 兜底也跑不动）。

## 这次审计的元价值

`status=SUCCEEDED` + `gapReport=ANSWERABLE` + 单测/gates 全绿——**全是绿的,却完全没回答用户的问题**。这正是"绿测试≠能用"的活样本,而且**是亲手跑真系统才发现的,单测一个没抓到**。印证 `fde-delivery` SOP 的必要性。

## 由此确认的下一步（按离北极星距离排序）

1. 🔴 **修 selfCheckGaps 谎报**：comprehend 覆盖率低（故事大量句子未映射）时,必须报"未理解/缺口",而非 ANSWERABLE。让系统"知道自己不懂"。
2. 🔴 **LLM comprehend 大脑**：听懂任意业务语言 → 真倒推 Process/Equipment + 瓶颈求解器 + 降级规则 + 后果推演 + agent（§2 核心）。
3. **终态闭环**：DRAFT 场景 → 审批 → publish → 进启动器 → 重跑验证可推演。
4. 富多跳切片 + 拟真值（§3）。

> 其余模块（连接器/对象浏览/Agent 页/推演链路）的逐一 hand-run 待续,方法同上。

## 真服务端到端 + 大数据压测（补"能用级"验证）

### ① 真服务 live HTTP 端到端（datacore:4001 + agentcore:4002，非内存 inject）
起真服务、真 HTTP 请求驱动 FDE 链，真实响应：
- **消歧**：`GET /a/v1/entity-catalog/resolve?q=常州&type=Base` → `resolved=true, top=常州`。
- **能力清单**：`GET /a/v1/capability-inventory` → `26 类型, solvers 含 shared_bottleneck=true`。
- **比对差异**：`POST /a/v1/capability-inventory/diff {solvers:[…,margin_attribution]}` → `GAPS: margin_attribution:SOLVER_NOT_FOUND`。
- **求解器**：`POST /a/v1/solvers/shared_bottleneck/invoke` → HTTP 200，返回 bottlenecks/contention/downgraded 形状。
- **P4 终态闭环（live）**：createPlan/createIntent(201) → DRAFT 场景 → `POST /b/v1/scenarios/scene_live_demo/publish-chain` → HTTP 200，`chain=plan→intent→scenario`；**场景启动器 `GET /b/v1/scenarios` 从 20 → 21，新场景可见**。无死路门 live 生效（缺意图时 409）。

### ② 大数据压测（1000 工序 / 10000 订单，stress-bottleneck.test）
- FK 一致生成 11k 行：**23ms**，全量闭合 + 确定性字节级一致。
- shared_bottleneck 求解 11k 对象：**51ms**，20 瓶颈 / 10000 单争用 / 20 单降级，正确。线性，无 O(n²)。

### ③ 5 个杀手级多跳求解器全部落地 + 真实 HTTP 端到端（generic-solvers-http-e2e.test）
5 问全有确定性求解器后端（净室零依赖、R6、读对象图）：
- Q1 `affected_orders`（客户违约传导面）· Q2 `supplier_disruption_radius`（断供影响半径,反向逐层扇出）·
  Q3 `margin_attribution`（毛利倒挂根因,成本项归因）· Q4 `shared_bottleneck`（产能瓶颈优先级冲突）·
  Q5 `concentration_risk`（隐性客户集中度,多源收敛）。
- **经真实路由** `POST /a/v1/solvers/{key}/invoke`（entitlement 闸 + 鉴权 + zod 反序列化 + JSON 序列化）：
  Q2/Q3/Q4/Q5 各 HTTP **200** + 正确形状（化成瓶颈 / 华东电解液敞口 3 / 2 单倒挂 / 半径 3 层）;
  缺参 → **≥400 错误信封**（不静默空结果）。补齐了 service 层 invoke() 抓不到的"路由/契约/序列化"那一层。
- 注：4 个通用求解器未绑定任何 feature → entitlement `requireByBinding` 视为不受控放行（任意租户可调）。

> **诚实更正（FILL-AUDIT-OBS-LINE·2026-07-09·闭 WO-6 曝 Q9 洞 GAP-AUDIT-OBS）**：上文"真实 HTTP 端到端"实为 **4 个直调** `POST /a/v1/solvers/{key}/invoke`（手搓 args），**NL→QOS 从未真跑**，审计散点未成一线——WO-6 回炉如实曝此洞。**现补齐 NL 真跑 + 决策链审计一线**：`supplier_disruption_radius`/`margin_attribution` 代表问经 QOS **NL 真路由**（CORE-NL-SOLVER-ROUTING 接进 S21–S25·`submitQuery` 分类→路径A 工作流→`invoke_solver`·非直调）→ 达终态经 `GET /api/v1/queries/:taskId/decision-trace` 取出**完整决策链审计一线**（`decisionId`=task.id 作 spine·串 数据[classification/resolvedRefs]→推演[toolCalls 求解器真实调用]→结论[trustLevel/provenance/ontologyValidation]·R2 跨租户 404 隔离），编排 DAG 投影（`/trace`）非空成链。teeth `apps/agentcore/test/audit-obs-line.test.ts`（revert NL 路由→回直调→无 task/无 spine→红·green→red 自证）·`classifyGap` 视之 ANSWERABLE（非 OTHER）。

### ④ 组合最优化引擎落地（CP-SAT sidecar，自托管，真求解实证）
回应"复杂推演 TS 解不动、是否要引擎/谷歌在线 API"：查证后**自托管 OR-Tools CP-SAT**（不直连谷歌
在线 API——那会让 tenant 数据出境，违 R2/离线部署姿态）。`selection_optimize` 走 sidecar 给可证最优。
- **真求解实证（沙箱已装 ortools 9.15，非 mock）**：`services/optimizer/test_optimizer.py` 6 测全过——
  经典 0/1 背包反例上 **CP-SAT=100 严格胜过贪心=60**（B+C 装满 vs 贪心先吞 A 后装不下）；
  **R6 确定性**同 seed 重跑字节级一致；maxCount/minValue/浮点 scale/不可行 全覆盖。
- **HTTP 面实证**：起 `server.py` → `GET /healthz` ok、`POST /solve` 返回 OPTIMAL B+C=100、坏 model→400 错误信封。
- **TS↔Python 契约 live**：编译后的 `HttpOptimizerClient` 真打运行中的 sidecar → `optimal B+C=100`，
  错误路径正确抛 `optimizer 400`。datacore 侧接线（取候选/组请求/映射/R2/未接入报错）由 vitest mock 引擎证。
- **可部署**：docker-compose 加 `optimizer` 服务（仅内部网络、无端口映射、healthcheck），datacore 经
  `OPTIMIZER_BASE_URL` 发现；`docker compose config` 校验通过。Apache-2.0 以 pip 依赖引入、不剥版权、UI 无外部名。

### 仍诚实欠的
- 🔴 **真调 Kimi**：需用户填 API key（凭据,我无法代填）；本次 comprehend 走确定性地板 live。
- 🔴 **浏览器 UI hand-run**：沙箱无浏览器；live 验证到 HTTP 端到端层,未到像素层。
- 🔴 **§8g MCP 暴露 selection_optimize**：引擎已封装为平台 API + datacore 求解器,但尚未注册成 MCP 工具
  （在 MCP 页可见/可治理）——下一增量。
- 🔴 **sidecar 镜像 live `docker compose up`**：沙箱未实际构建镜像跑容器;ortools 真求解已在宿主 Python 证。

---

## A12 · 其余模块逐一 hand-run（第二轮 · 2026-06-21 真服务真请求）

> 起真服务 datacore:4001 + agentcore:4002（SEED_DEMO=1，SERVICE_TOKEN + AGENTCORE_BASE_URL 配齐，跨系统在线），以 `X-Debug-User: demo:admin:admin` 真请求逐模块走端到端。**非单测**。首轮 🔴/◐ 多由 A5/A6/A10/A7/A1 修复，本轮复验。

| 模块 | 体验验收项 | 实测（真服务真请求） | 证据/锚点 |
|---|---|---|---|
| **A12.1 连接器（+A11）** | 连接器归类可枚举（内置并集 + 本租户已用） | ✅ | `GET /a/v1/connector-categories` → `["CRM","ERP","EXTERNAL","FILE","KB"]` |
| **A12.2 对象浏览（A4）** | 按域分组列已发布类型 + 真物化计数（非 mock） | ✅ **真实数据** | `GET /a/v1/ontology/object-types/stats` → 26 类型 / 11 域有物化；`Base.count=12`、`Equipment.count=72`（远超 mock Base=3，证真后端） |
| **A12.2 业务域注册表** | 14 域配置驱动 | ✅ | `GET /a/v1/business-domains` → 14 域（factory/product/process/equip/people…） |
| **A12.3 Agent / MCP（A1）** | `solvers` MCP server 跨服务暴露全部求解器为工具 | ✅ **跨服务** | `GET /b/v1/mcp/servers/solvers`（真 AgentCore→真 DataCore 注册表）→ `count=31`，全 `mcp__solvers__*` |
| **A12.4 场景启动器（PUBLISHED 可见性）** | 默认（PUBLISHED）即可见场景卡 | ✅ **首轮 🔴 已闭合** | `GET /b/v1/scenarios` → **20 张 PUBLISHED 默认可见**（首轮"仅 includeDraft 可见"已修：出厂 SCENARIO_CATALOG 启动期 upsert 为 PUBLISHED） |
| **A10 终态闭环（cross-service）** | publish 后自动重跑主问句、经**真 AgentCore QOS** 验证 | ✅ **跨服务活证据** | `POST /a/v1/databuilder/runs {inference:true}` → `status=SUCCEEDED` + `verification=VERIFIED/RUNTIME_PROBE`（onComplete 自动触发，probe 走真 agentcore growth/probe 实跑，非兜底 BUILD_STATIC） |

### Verdict（第二轮，诚实）
- 首轮记录的"启动器无卡/仅 includeDraft 可见"（G-3 末段）**本轮复验已闭合**：20 场景默认 PUBLISHED 可见。
- A4 对象浏览跑真后端取到**真实物化计数**（Equipment=72），证"绿测试≠能用"的真服务体检通过，非 mock 假绿。
- A10 终态闭环在**跨系统在线**下 evidence=RUNTIME_PROBE（真 QOS 实跑），非 BUILD_STATIC 兜底——publish→自动验证末步端到端真通。
- 跨服务关键路径（solver invoke / `solvers` MCP 注册表 31 工具）已由 `xservice-smoke.test.ts` 固化为回归（守不回潮）。

### 仍待后续（诚实留账）
- ◐ Agent 页"配 Agent→真 LLM 调用出答案"未在本轮跑真 Kimi（A14 env-gated 真 Kimi parity 已建框架，待配 provider 实跑）。
- ◐ 规则 BLOCK / 校准注入 / 权限行级过滤的体验级 hand-run 留作 A12 滚动下一批（单测已绿，体验级真请求待补）。
