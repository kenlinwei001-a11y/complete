# Enterprise Decision Twin 需求 · 逐条实测缺口账

> 仓主二次确认「推演沙盘需求有没有遗漏」。答：**没遗漏**，但此前只量过七世界，本文把这份文档里
> **最硬的四组判据**（§14 / §16 / §20 / §27）也逐条量完。
> 基线 canonical `c50fc3ec`。每个数字都是本次亲手跑的；**其中一组我第一遍量错了，订正过程写在 §2**。

---

## 1 · §27「最关键的 5 张表」—— 5 张里只有 1 张有

| 表 | 语义 | 后端命中 | 判定 |
|---|---|---|---|
| `Enterprise_State` | 企业**现在**是什么状态 | **0** | ❌ 无承载物 |
| `Process_Instance` | 业务**现在走到哪里** | **0** | ❌ 无承载物 |
| `Ontology_Slice` | 这次决策**涉及哪些对象** | 57 | ✅ 有 |
| `Decision` | **为什么**做这个决定 | **0** | ❌ 无承载物 |
| `State_Delta` | 这个决定让企业**发生了什么变化** | **0** | ❌ 无承载物 |

金丝雀 `SimSession` = 35（>0 证明工具有效）。

### 1.1 一处必须分清的差别：Definition ≠ Instance

`ProcessDefinition` = **11** · `ProcessInstance` = **0**。

WO-Q0 交付的「13 域 × 65 流程」是**流程定义（模板）**，不是**流程实例（某张单现在走到哪一步）**。
需求 §4 要的是「把真实企业流程建成**可执行状态机**」，§18 要的是「每个流程节点都有
Start/End/Duration/Owner/Status/Input/Output/Decision」—— **这些都挂在 Instance 上，不在 Definition 上**。

⇒ **「流程层已做」这句话今天只成立一半**，且是不能回答「为什么这个流程现在卡住了」的那一半。

---

## 2 · §16 产销端到端 23 个 Skill —— 🔴 我第一遍量错了，订正在此

**第一遍报「16/23 有承载物」。这个数是错的。**
原因：我用的关键词（`order_commit` / `delivery_risk` / `material_avail` …）**不是本仓的真实命名**。
照铁律 0.5「报 0 之前追一层」复核，7 个「0」里 6 个是假 0：

| 需求项 | 我第一遍的模式 → 结果 | 换真实命名 → 结果 |
|---|---|---|
| 04 Order Commitment | `order_commit\|atp_promise` → **0** | `atp\|ATP\|承诺` → **173** |
| 06 Material Availability | `material_avail` → **0** | `物料可用\|缺料\|material_shortage` → **40** |
| 13 Material Allocation | `material_alloc` → **0** | `物料分配\|allocat` → **67** |
| 18 Delivery Risk | `delivery_risk\|otd_` → **0** | `otd\|OTD\|准时率\|交付风险` → **64** |
| 01 Customer Demand Intake | `demand_intake` → **0** | `demand\|需求录入\|CustomerDemand` → **130** |
| 22 Exception Handling | `exception_` → **0** | `异常\|exception` → **74** |
| 21 Execution Monitoring | `exec_monitor` → **0** | `执行监控\|monitor` → **2**（真弱） |

**订正后：22/23 后端有领域能力，不是 16/23。**

> 形态（照铁律 0.6 的句式）：**「我用『我猜的那个命名有没有命中』当作『这个能力存不存在』的证据，而前者并不度量后者。」**
> 这是本仓今天第 N 次同族错误。它没造成损害，是因为我在报给仓主之前追了那一层。

### 2.1 但 22/23 这个数同样会骗人 —— 必须分三层说

| 层 | 实测 | 含义 |
|---|---|---|
| ① **领域能力在后端存在** | **22/23** | 有代码在算这件事 |
| ② **注册成 Skill 的** | **7 个种子**（`capacity_analysis` / `sop_meeting` / `risk_analysis` / `supply_chain_mgmt` / `quality_control` / `mcp_integration` / `capacity_action_draft`） | 与 23 项对得上的约 **4 项** |
| ③ **构成 §17 那张 Skill Graph 的** | **0** | `Skill.execution` 恒空，图挂不上 Skill 实体（欠账 #159/#162） |

**⇒ 「能力有」≠「是 Skill」≠「组成了 Skill Graph」。三者差了两个数量级。**

---

## 3 · §20 五个等待态 —— 后端全有，前端全 0（同一个老病）

| 等待态 | 后端 | 前端 |
|---|---|---|
| `WAITING_USER` | 27 | **0** |
| `WAITING_APPROVAL` | 3 | **0** |
| `WAITING_DATA` | 17 | **0** |
| `WAITING_EXTERNAL_SYSTEM` | 17 | **0** |
| `WAITING_SCHEDULE` | 12 | **0** |

需求 §20 说这点「对真实业务孪生**极其重要**」，因为它回答「为什么这个流程现在卡住了」。
**后端已经知道答案，界面上一个字都没有。** 与 Skill / Agent / 上下文三条线**完全同形**：
后端做了、WO 的范围边界里没有 `apps/frontend-shell` ⇒ 前端零消费方。

⇒ 已建的 `befe-seam:check` 门（本轮 WO-GATE-BEFE-SEAM）正是防这一类的；这 5 个等待态属于**存量**，
门只封增量，存量 burn-down 需另立单。

---

## 4 · §14 Impact Propagation Engine —— 算的东西有，那个契约没有

| 项 | 实测 |
|---|---|
| `POST /simulation/impact-analysis` 端点 | **0** |
| `affectedObjects` 类计数 | 15 |

⇒ 形态是**「接了线接错地方」**：影响面计算存在于别处，但需求要的那个
「给一个 world_id + 一处变更 → 返回 affected_objects/processes/decisions/kpis 四个计数」的
**统一入口不存在**。修法是接一个端点 + 归一四个计数口径，不是从头造引擎。

---

## 5 · 七世界总账（含本文新增的四组判据）

| 世界 | 后端 | 前端 | 判定 |
|---|---|---|---|
| ① Business World | 有 | 有 | ✅ |
| ② Organization World（人/角色/权限/审批额度） | **0** | **0** | ❌ 全缺 |
| ③ Ontology World | 有 | 有 | 🔗 16 层缺 ①业务场景 ⑥事件 ⑨时间语义 |
| ④ Process World | **仅 Definition** | 0 | 🔗 无 Instance ⇒ 答不了「卡在哪」 |
| ⑤ Decision World（Rule/Constraint/Agent/Solver） | 有 | 部分 | 🔗 `Decision` 对象本身 = 0 |
| ⑥ Scenario World（分叉/扰动/传导） | 有 | 有 | ✅ 本轮 P0/P1/P2 刚补完 |
| ⑦ Execution World（Action/Approval/反馈） | Action 有 · **Approval Policy = 0** | 0 | ❌ 批复链缺 |

---

## 6 · 结论：**没遗漏，但完成度远低于此前口径**

按这份文档自己给的 MVP 判据（§27 五张表）算：**1/5**。
按七世界算：**2 个 ✅ · 3 个 🔗 · 2 个 ❌**。

### 6.1 下一步（按「让仓主看得见」的性价比排序）

| 序 | 项 | 状态 |
|---|---|---|
| 1 | **两世界对比 Delta**（§25 · `State_Delta` 表） | **已派单**（WO-DELTA-COMPARE） |
| 2 | **Approval Policy Engine**（§5/§6 · 批复链由规则×组织权限动态生成） | 待派（重画像，等 CPU） |
| 3 | **Decision / Causal Graph**（§9/§10 · 「为什么这个决策被触发」） | 待派 |
| 4 | **Process_Instance + 等待态前端**（§4/§18/§20 · 回答「卡在哪」） | 待派 |
| 5 | **Organization World**（§19 · Person/Role/Authority/ApprovalLimit/Delegation） | 待派 |
| 6 | Impact Propagation 统一端点（§14） | 待派（接线单，不是造引擎） |
| 7 | Enterprise_State 快照表（§3） | 待派 |

### 6.2 诚实边界

本文的判据是**符号级命中**（「后端有没有这个东西」），**不是**「它接线了、能跑、答得对」。
凡本文标 ✅ 的，只证明**承载物存在**；是否真接线、是否被前端消费，四条 CHECK 路线与
`befe-seam:check` 门另有各自的口径。**把本文读成「这些已经能用」是过度解读。**
