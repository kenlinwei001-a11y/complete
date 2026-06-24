# 推演沙盘的倒序发育规格（从一句场景 → 倒推全部所需 → 经现有管道正向长出 → 仿真闭环）

> 立意（与历史原则一致 · R16 发育闭环）：**沙盘不硬编码它的数据/规则/agent/意图——而是从"一句场景需求"倒序推演出全部所需制品（原始数据/本体/状态变量/传导规则/约束/动作/查询/意图/工作流/agent/KPI），再逐步经现有「数据连接器与上传 → 合成数据 → 数据构建发动机」正向长出来、闭环、就绪认证，最后才"可进入推演"。** 缺一环 → GapReport 触发倒序生长或开真人正门工单，**绝不静默**。
> 复用既有机件（不重写）：`runStory`/`BuildPlan`(13 need)/`ModuleProvisioner`/连接器/合成/`GapReport`→`runGrowthLoop`/A10 验证/A18 相位。**沙盘 = ontogenesis 的一个发育目标。**

---

## 1. 倒序：沙盘需要什么（从场景反推，映射 BuildPlan 13 need）

输入 = 一句场景（"模拟常州供应商断供，看风险传导到订单"）→ comprehend（LLM 听懂 / 关键词地板兜底）→ 倒推出沙盘 BuildPlan：

| 沙盘所需 | 是什么（对沙盘的作用） | BuildPlan need（映射） | 倒推方法 | 正向长出的源模块 |
|---|---|---|---|---|
| **原始数据** | 世界初始态（实体行 + 风险字段） | `dataSources` | 从场景实体名 → 数据需求 | **连接器与上传**(真实) / **合成数据**(冷启动,确定性 R6) |
| **本体对象/链路** | 世界图谱拓扑（节点+边） | `objectTypes` | 从实体+关系词 → 类型/link | **数据构建发动机**(建模) |
| **状态变量** | 节点上随时间变的量（delay_risk…） | `objectTypes.derivations` | 从"风险/状态"语义 → 派生属性 | 派生引擎 `DerivationSpec` |
| **传导规则** ★ | 风险沿 link 按系数+延迟逐 tick 传 | `ruleNeeds`(传导子类) | 从"传导/影响"→ PropagationRule(系数/延迟=`rule.params`) | **规则库**(规则即引用) |
| **约束/边界规则** | 拦非法操作(仅断供可恢复…) | `ruleNeeds` | 从"校验/不可"→ BLOCK 规则 | 规则库 + VLE |
| **业务动作** ★ | 沙盘可执行的干预(断供/调产能…) | `actionNeeds`(新,需注册 provisioner) | 从动词 → ActionType(沙盘态+R4态) | actions |
| **图谱查询/切片** | 观测入口 + 范围裁剪 | `sliceNeeds` | 从"看/查"→ slice-planner 子图 | 切片规划器 |
| **意图理解** | NL 指令→沙盘操作映射 | `intentNeeds` | 从指令样式 → sim 意图(sim.act/tick/branch) | QOS 意图目录 + `OPERATION_CATALOG`(sim op) |
| **工作流(path A)** | 确定性沙盘操作编排 | `planNeeds`/`workflowNeeds` | 从操作序 → ExecutionPlan(sim 步) | QOS 计划 |
| **Agent(path B)** | 自由沙盘指令兜底 | `agentNeeds` | 目录外指令 → 沙盘 agent + MCP `sim.*` | QOS agent + MCP |
| **KPI/目标** | 底部指标 + 目标冲突 | `metricNeeds`(新或并 objectTypes) | 从"指标/目标"→ Metric/PlanTarget | SPINE metric_rollup |
| **就绪认证** | 三件套门 + L0-L4 + 三维 | （派生,非 need） | 对上述算闭包 | closure surfaced |
| **沙盘视图配置** | 前端渲染(节点/边/着色/动作/KPI) | `sandboxConfigNeeds`(新) | 从本体 → SandboxViewConfig | view-config |

> ★=沙盘新增的 need（传导规则/业务动作/视图配置）→ 按 ModuleProvisioner 纪律**必须在 BuildPlan 13 need 后追加并注册对应 provisioner**（新增 need 不注册即测试红）。其余全复用既有 need。

---

## 2. 正向：经现有管道逐步长出（走正门，与原则一致）

```
① 一句场景 ──comprehend(LLM/关键词地板)──> 沙盘 BuildPlan（倒推上表）
② 数据：连接器与上传(真实导入) 或 合成数据(冷启动,确定性) ──> RawDataset 可见
③ 数据构建发动机 runStory ──倒序发育──> ModuleProvisioner 比对现状(EXISTS/TO_CREATE/MISSING):
     本体类型/状态变量/传导规则/约束/动作/切片/意图/计划/agent/KPI 逐一 provision
     ├ AUTO-DERIVE：确定性生成（合成走正门 / slice-planner / 规则即引用）
     └ NEEDS-HUMAN：缺真实业务数据 → DataRequest 真人正门工单（R4 审批），不静默合成
④ 闭包 closure ──> 三环闭合(数据/本体/能力) ──> 发布(R4 EXECUTED 落真值)
⑤ 就绪认证 ──> 三件套门齐 + L0-L4 + Trial Tick 通过 ──> 「可进入推演」
⑥ 沙盘运行 ──> 正序：init→tick→传导→act→branch→compare
⑦ 正序 GapReport（跑不动:缺规则/缺数据）──生长信号──> 回 ③ runGrowthLoop 倒序补齐(越用越大)
```

**与历史原则一一对齐**：
- **R16 倒序发育⊕正序运作**：①–⑤ 倒序发育，⑥ 正序运作，⑦ 正序喂倒序。
- **走正门（replay 红线）**：数据经连接器/合成正门，动作经 R4，**禁直写**。
- **三环闭合**：数据(②)/本体(③④)/能力(意图/计划/agent/CLI op 自动派生)。
- **二分处置**：AUTO-DERIVE / NEEDS-HUMAN 工单，**绝不静默残缺**。
- **R6 确定性**：合成同 seed 字节一致；同基准+范围+操作序列字节一致。
- **R14 去行业锁死**：全程按"类型/link/状态变量"，锂电只是某租户的内容。
- **DF.9 真人正门 HARD/SOFT**：缺真实业务实体 → HARD 出 DataRequest，不静默合成。

---

## 3. 逐 need 的"长出"细则（给实现 agent）

1. **原始数据**：真实场景 → 连接器(file_upload/同步/WebSocket)导入 → RawDataset；冷启动/demo → `POST /a/v1/synthetic/jobs`(确定性 industry×scale×seed) → 同走 RawDataset。**沙盘 init 读的是物化对象，不是凭空造。**
2. **本体+状态变量**：`runStory` 从数据集建模(dataset→type/column→属性/FK→link) + 派生状态变量；新类型人工归域(A4)后发布。
3. **传导规则**：倒推出 PropagationRule(sourceStateVar/viaLink/coefficient/delay)，系数/延迟落 `rule.params`(规则即引用,可编辑)；缺则 GapReport `NO_RULE` → 生成草案待审。
4. **业务动作**：倒推出 ActionType(断供/调产能…)，标 `sandbox=true`(模拟态)；采纳才转 R4。新 `actionNeeds` 注册 provisioner。
5. **意图/计划/agent**：sim 操作注册进 `OPERATION_CATALOG`(R15 CLI 对等) + QOS 意图/计划；自由指令兜底 path-B agent + MCP `sim.*`。缺则 GapReport `NO_INTENT/NO_PLAN` → scaffold。
6. **KPI/目标**：倒推出 Metric/PlanTarget，metric_rollup 算达成/冲突。
7. **就绪认证**：对 1–6 算 closure → 三件套门(派生∧动作∧查询) + L0-L4 + Trial Tick(空跑1tick触发规则)。**缺一件 → 显式"不可进入推演 + 缺什么"**，不静默。

---

## 4. 一个走通的例子（供应链断供沙盘，冷启动）

```
场景:"模拟常州供应商断供,看风险传导到订单,并对比恢复方案"
→ comprehend 倒推:
   数据:Supplier/Factory/Order 行 · 本体:3类型+SUPPLIES/FULFILLS · 状态变量:delay_risk/supply_risk/fulfill_risk
   传导规则:supplier.delay_risk--SUPPLIES,0.85,d0-->factory.supply_risk · factory--FULFILLS,0.7,d1-->order
   动作:断供/恢复/调产能/延期 · 约束:仅断供可恢复(BLOCK) · 查询:高风险供应商 · KPI:全链平均风险/越线订单
   意图:sim.act/sim.tick/sim.branch · agent:沙盘兜底
→ 正向:
   ② 合成数据(seed=42,确定性) → RawDataset(12供应商/10工厂/18订单)
   ③ runStory → 建 3 类型+2link+状态变量 · 发布传导规则(系数可编辑) · 注册动作/意图/计划
      缺真实供应商名? → DF.9 HARD:出 DataRequest 真人正门(不静默编名)
   ④ closure 三环闭 → 发布
   ⑤ 就绪认证:三件套齐(派生4∧动作4∧查询2)→ L4 → 可进入推演
   ⑥ 沙盘:init(基准+范围)→断供→tick×6 传导→分支恢复方案→对比KPI
   ⑦ 若传导跑不动(某link无系数)→ GapReport NO_RULE → runGrowthLoop 补草案
```

---

## 5. 《本体引用与影响》

- **对象类型**（§2）：复用 `BuildPlan`/`StoryBuildRun`/`ModuleProvisioner`/`GapReport`/`SyntheticJob`/`Connection`/`RawDataset`；新增 need 类型 `PropagationRule`/`ActionNeed`/`SandboxConfigNeed`（追加 BuildPlan + 注册 provisioner）。
- **链路**（§3）：`场景 --comprehend--> 沙盘BuildPlan --连接器/合成--> RawDataset --runStory(倒序发育)--> 本体/规则/动作/意图闭包 --就绪认证--> 可进入推演 --正序GapReport--> runGrowthLoop`。沙盘并入既有"数据构建发动机"链路，非新管道。
- **不变量**：R16（沙盘是发育目标）、R6（合成/仿真确定性）、R4（走正门/采纳审批）、R14（去行业锁死）、R11/R12（全链/逐字段闭包）、DF.9（真人正门 HARD/SOFT）。
- **门禁**（§7）：`ModuleProvisioner` 覆盖门（新 need 必注册 provisioner）+ `chain:check`（沙盘依赖闭包）+ `ontogenesis:check`（三环）+ `cli-parity:check`（sim op）。
- **断点**（§8）：闭 G-11 的"数据闭环"半边——沙盘不靠硬编码起步，靠倒序发育长出。
- **回写**：新增 need/链路/provisioner → 回写 §2/§3/§7。

---

## 6. 一句话

**沙盘的每一个新页面，背后都不是写死的数据，而是"一句场景 → 倒推全部所需 → 经连接器/合成/数据构建发动机正向长出 → 闭包 → 就绪认证 → 可进入推演"——缺一环就 GapReport 倒序补齐或开真人正门工单。** 这与"胚胎到系统、走正门、三环闭合、确定性、去行业锁死"历史原则完全一致；沙盘不是例外，是这套发育闭环的又一个发育目标。
