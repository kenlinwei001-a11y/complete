# PRD 增量 · 回放编排器与虚拟操作团队（Replay Orchestrator）

| 项 | 值 |
|---|---|
| 版本 | v1.0（增量：补全 A9/运营态回放链路中的"人环"自动化；修订 运营态 PRD §1.2 的任务史/审批史/S&OP 史产生方式） |
| 解决问题 | A9 只产源头数据，③④⑤⑦ 等计算环节自动级联，但 ⑥ 求解发起、⑧ 提问、⑨ 审批、S&OP 五步、意图孵化是**人环操作**——无人执行则运营态历史出现断层，或退化为"写死的记录"（下钻穿帮）。本模块用虚拟人员经真实 API 把人环跑出来 |
| 核心红线 | **只许走正门**：虚拟操作一律调用与真人相同的 API（QOS 提问、审批端点、S&OP 工作流、孵化端点），**禁止直写任何结果表**——这样产生的任务详情有真实事件流、审批有真实状态机流转、一切可下钻可审计 |

## 1. 虚拟操作团队（Virtual Personas）

```ts
interface VirtualPersona {              // 随运营态合成任务创建，账号与真人同表
  username: string;                      // 如 vp_planner_zhang / vp_approver_li / vp_sop_host
  roles: string[];                       // 与真实角色同体系（planner / tenant_admin / catalog_admin…）
  attributes: Record<string, unknown>;   // 行级属性（基地负责人等）
  isVirtual: true;                       // 标记：登录禁用（不能交互登录）、审计中可识别、前端显示头像徽标
  styleSeed: number;                     // 决定其审批意见/提问措辞从哪个预生成文本池抽取
}
```

默认编制 6 人：计划员 ×2（不同基地视角）、审批人 ×1、S&OP 主持人 ×1、基地负责人 ×1、目录运营 ×1。审计记录里出现的是这些具体身份——"谁批的、谁问的"经得起追问。

## 2. 操作剧本（OpsPlaybook DSL，场景包内容，版本化）

```ts
interface OpsPlaybook {
  key: string; version: number;
  cadence: {                             // 挂载到模拟时钟的节拍槽
    daily?: OpsAction[];                 // 每日：按概率提问（见 queries）
    weekly?: OpsAction[];                // 每周：发起型号产能预测（⑥ 的来源）、审批积压处理
    monthly?: OpsAction[];               // 每月：S&OP 五步走完并定稿、孵化评审
    onEvent?: { event: string; actions: OpsAction[] }[];   // 剧本事件钩子：到货危机→采纳处置
  };
}
type OpsAction =
  | { kind: "ask"; persona: string; view: string; queryPool: string;          // 经 POST /b/v1/queries
      prob?: number }                                                          // 每日触发概率（默认 0.6）
  | { kind: "run_forecast"; persona: string; modelPool: string[] }            // 经 /b/v1/solvers/capacity_forecast/run
  | { kind: "review_actions"; persona: string;
      policy: { approve: number; reject: number; cancel: number };            // 默认 0.82/0.11/0.04（余量=失败重试）
      commentPool: string }                                                    // 被拒必带意见（预生成文本池）
  | { kind: "sop_cycle"; persona: string }                                    // 走五步工作流 API 至定稿（决议项从对策池按当月缺口选）
  | { kind: "adopt_mitigation"; persona: string }                             // 风险越线事件钩子：采纳对症方案
  | { kind: "promote_intent"; persona: string; afterFallbackCount: number };  // 兜底聚类达阈值→孵化（产生孵化记录）
```

文本池（提问问句、审批意见、决议措辞）由 A9 的 `llm_text` 在**合成时一次性预生成并缓存**——回放执行期零 LLM 调用（确定性、零成本、可离线）。

## 3. 执行模型

1. **挂载点**：A8 模拟时钟每个 tick 末尾增加第 ⑦ 步"执行当日 OpsPlaybook"——在当日数据已聚合/派生/扫描完成之后执行（虚拟计划员问到的是"当天最新"的数）。
2. **确定性**：动作触发与池抽取全部由 `(seed, tick, persona)` 派生的子流决定——同 seed 重放产生逐字相同的运营史；概率型动作（ask.prob）同样确定性掷签。
3. **身份与权限**：每个动作以对应 persona 的真实 JWT 执行（OBO 全链生效）——基地负责人 persona 问出的回答只含其基地数据，审计与权限语义与真人完全一致。
4. **回答消费**：`ask` 动作产生的 QueryTask 即任务史本体（含完整事件流/审计/溯源）——**运营态 PRD §1.2"任务/对话史"由本机制取代"预置记录"方案**；前端对话历史区改为按 conversationId 拉取真实任务。
5. **失败容忍**：单动作失败（如规则拦截）不是错误——拦截记录本身就是运营痕迹；编排器只在动作产生 5xx 时告警并跳过，tick 报告记录跳过项。
6. **隔离**：仅 `origin=SYNTHETIC` 的租户可挂 OpsPlaybook；虚拟账号在真实租户中禁止创建（与 `FORGE_ALLOW_PROD` 同闸）。

## 4. 与既有 PRD 的修订关系

| 文档 | 修订 |
|---|---|
| 运营态 PRD §1.2 | 任务/对话史、Action 审计史（含被拒意见）、S&OP V1–V12、意图孵化记录 四行的产生方式改为"OpsPlaybook 经真实 API 产生"；量改为剧本节拍的自然结果（不再硬写条数，验收改为下限断言） |
| A8 §6.2 | tick 流水追加第 ⑦ 步（执行剧本） |
| A9 §9.4 | 售前定制流程的"回放 12 个月"明确含 OpsPlaybook（半天交付时效预算内：回放性能目标 ≤8 分钟） |
| M11 | 每周 `run_forecast` 即校准配对样本的正式来源（解除"预测对象从哪来"的悬空） |

## 5. 验收用例

| # | 用例 | 预期 |
|---|---|---|
| R1 | 正门红线 | 全程零直写：审计中每条运营记录都能回链到一次真实 API 调用（静态断言：编排器代码不 import 任何 Store/Repo） |
| R2 | 任务史可下钻 | 回放产生的任意历史问答，打开任务详情有完整事件流、工具审计、溯源——与真人提问产物结构无差异 |
| R3 | 审批叙事 | 审批史比例命中 policy ±5pct；每条被拒带意见且署名虚拟审批人；审批人身份在审计中可识别 isVirtual |
| R4 | S&OP 真流转 | V1–V12 全部经五步工作流 API 产生（含 C21 提报项与第⑤步决议），定稿后版本锁定语义成立 |
| R5 | 校准闭环 | 52 周每周存在预测对象，calibration_pairs 连续，MAPE 序列无断档 |
| R6 | 确定性 | 同 seed 两次回放：任务问句、审批决定、决议措辞逐字一致 |
| R7 | 权限一致性 | 基地负责人 persona 的历史回答只含其基地数据（抽查跨基地泄露=0） |
| R8 | 性能 | S 规模 365 tick 含剧本全量回放 ≤8 分钟 |
| R9 | 隔离 | 真实租户挂 playbook / 创建虚拟账号均被拒 |

---

## 6. 真实租户的运营自动化（OpsSchedule——与虚拟回放的分界）

> 同样的"定期自动"诉求在**真实生产租户**中按动作性质分三类处理。配置载体为 `OpsSchedule`（租户级，tenant_admin 在管理台配置，底层复用 S3 调度器）——**人定义"定期"，系统执行**。

### 6.1 三类动作的自动化边界

| 类 | 动作 | 自动化方式 | 依据 |
|---|---|---|---|
| **A 全自动**（计算类，无权责） | 定期发起产能预测（默认每周一 06:00，按型号清单）→ 这是 M11 校准配对样本在真实租户的**正式来源**；派生全量重算；规则扫描；风险推演刷新 | S3 调度器新 kind `SCHEDULED_FORECAST`（即包装为定时 workflow），ServiceAccount 身份执行（平台 PRD §6.3 Q1 例外条款），产物标 `executedAs: SERVICE_ACCOUNT` | 计算不涉权责，自动无害且必要 |
| **B 半自动**（流程推进类，人保留决策点） | S&OP 月度周期：系统按 cron **自动开启**新版本、自动完成①–④的计算与议程生成、按节点**催办**（事件通知→责任人）；第⑤步决策与定稿**必须人做**。审批：超时催办、超时升级（N 天未审→上级角色），可选"低风险自动批准策略"（按 actionType+金额阈值配置，**默认关闭**，开启需 tenant_admin 显式配置并全审计——先例为 M11 autoApply） | OpsSchedule 配置项 + S&OP 工作流模板 + Action 催办策略 | "系统算路径与后果，拍板由人"的原则不破 |
| **C 禁止自动**（演示专属） | 虚拟提问刷任务史、虚拟审批 | **仅限 SYNTHETIC 租户**（§3-6 隔离条款）——真实租户的任务史必须来自真实用户行为，机器人刷史污染审计与孵化统计 | 审计真实性红线 |

### 6.2 OpsSchedule 配置模型

```ts
interface OpsSchedule {                 // (tenantId) 唯一，管理台 /admin/ops-schedule
  forecasts: { cron: string; modelIds: string[] | "ALL_ACTIVE"; weeks: number }[];
  sopCycle: { openCron: string;        // 如每月25日开启下月版本
              stepDeadlines: number[]; // ①–④各步催办期限（天）
              escalateAfterDays: number };
  approvalReminder: { remindAfterDays: number; escalateAfterDays: number; escalateToRole: string };
  autoApprove?: { actionTypes: string[]; maxAmount?: number; enabled: boolean };  // 默认 enabled=false
}
```

### 6.3 验收用例增量

| # | 用例 | 预期 |
|---|---|---|
| R10 | 定时预测 | cron 触发后预测对象产生、executedAs=SERVICE_ACCOUNT、calibration_pairs 随真实实绩到达自动配对 |
| R11 | S&OP 半自动 | 自动开启版本+①–④计算完成+议程生成；⑤未到人保持 IN_REVIEW；催办事件按期发出；任何"自动定稿"路径不存在（静态断言） |
| R12 | 审批催办与升级 | 超期催办→再超期升级到上级角色；autoApprove 默认关；开启后仅命中白名单类型且全审计 |
| R13 | C 类隔离 | 真实租户配置"自动提问"类动作无入口、API 直调被拒 |
