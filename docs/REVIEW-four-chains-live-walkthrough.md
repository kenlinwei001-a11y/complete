# 评审走查 — 四链路活系统真浏览器实测（数据接入 / QOS / 沙盘 / 审批）

> **角色**（铁律0.5）：审核方以**真用户身份**起全栈（datacore:4001 + agentcore:4002 + optimizer:4003 + frontend:5173·真 Kimi `kimi-k2.6`），真浏览器（Playwright）逐链操作、curl 旁证、实拍。判据 = FDE「亲手用一遍能用」，非门绿/非账面。
> **总判**：四链路**均端到端可用**（真点真发真看）。一个**实质性 UX 缺口**（QOS 自由问句 Path B 约 5 分钟无流式反馈），两个**诚实边界**（数据接入只验了合成正门、沙盘 L4 认证门控）。下附逐链证据 + 1 张待修施工单。

---

## 链路 1 · 数据接入全链 — ◐ 合成正门通，真接入臂未验

| 步骤 | 真实操作 | 结果 |
|---|---|---|
| 连接器与上传 `/admin/connections` | 渲染 | ✓ 14 卡，有上传/新建入口 |
| 对象/类型浏览 `/admin/object-types` | 渲染 + 钻取 | ✓ **34/34 类型·全 100% 就绪（R12·已测）**·物化数真实（Equipment 72·ARInvoice 24·Base 12…） |
| 类型 → 看实例 → 实例 | 点 34 个「看实例」之一 → 实例列表(46) → 点实例 | ✓ 落 `/o/Shipment/SHIP-changzhou` 对象360：**属性(shipId/etaDay=14/status=IN_TRANSIT/qtyTons=132) + 关系(base_has_shipment→常州/Base 可点图遍历)** |
| 切片库 `/admin/slices` | 渲染 | ✓ 38 切片 |
| 规则文档审核 `/admin/rule-docs` | 渲染 | ⚠️ **暂无数据**（有「上传规则文档」入口，未播种） |

**诚实边界**：上述 34 类型/物化数据**全部来自确定性合成种子（合成走正门）**，**非真连接器接入**。真接入臂（上传 CSV/规则文档→抽取→建模→物化）在 demo 里**未验**（规则文档审核空）。可用性结论：合成数据的**浏览/钻取/血缘**链完全可用；**真实数据源接入**链待单独实测。
**过程纠错（FDE）**：审核方首次误走 `/connections`（实为 `/admin/connections`），读到空壳 NotFound——修正路径后才见真内容。

---

## 链路 2 · QOS 真问句 — ✅ Path A 优秀 / ⚠️ Path B 功能对但 ~5min 无流式

**Path A（高频场景卡 → 工作流）✅**：点「交期风险与受影响订单」▶启动 → `POST /b/v1/queries 202`（ROUTING）→ SSE `events 200` → 落 `/v/risk`。对话坞：**分类 `命中工作流·affected_orders·conf 1.00`** → `invoke_solver s1`(23ms) → `render_answer` → **真结构化答案**（6 张受影响订单表 SO-3391 整车厂A 4680-NCM…）+ `✓已验证·工作流` 出处 + 引用 + 👍👎。亚秒级、确定性、无崩页。

**Path B（自由新颖问句 → Agent → 真 Kimi）⚠️**：问「常州基地在途批次库存覆盖天数偏低，哪些设备检修计划会加剧交付风险？」→ `POST 202`（path:AGENT）→ SSE 200。任务**正确分类到 AGENT**、用真工具（`discover`+多次 `query_objects`，2 次 `BUDGET_EXCEEDED` 探针预算护栏）、产出 `answer.final` **`trustLevel:AGENT_EXPLORATORY`** 接地答案（引「常州基地…利用率83%·OEE…」真值）——**功能链是对的**。
**但**：端到端 **~5 分钟才 COMPLETED，全程「🔵 仍在执行」无任何流式 token**。根因（已对码定位接缝）：
- OpenAI 兼容适配器 `agent()` **非流式**（`packages/llm-adapters/src/openai.ts:213`）、`max_tokens:16000`、无显式超时（SDK 默认 ~10min）；
- 配置模型 `kimi-k2.6` 是**推理模型**，输出走 `reasoning_content`、`content` 滞后填充——适配器**只读 `content`、丢弃 `reasoning_content`**（openai.ts:227/269）；多轮 Agent loop × 大 token 非流式 = 分钟级且零反馈。
- 直测 Kimi 实证：`kimi-k2.6` 可达（401 鉴权 1.8s）、`max_tokens:40` 时 `content:""`（全在 reasoning_content）、`max_tokens:2000` 才 `content:"你好"`（finish stop）。
**「绿测试≠能用」判定**：单测 mock LLM → 绿且秒回；真推理模型 → 5min 无反馈。**Path A 不依赖 LLM 故不受影响**。详见施工单 WO-Q1。

---

## 链路 3 · 沙盘推演 — ✅ 确定性传导真推进

`/v/sim-sandbox` 渲染富仪表（状态变量·就绪认证 L0–L4·健康71/信任84 雷达·世界完整度·3 传导规则）。
**AI 指挥台（确定性 NL 解析·无 LLM）✅**：输入「推进 5 个 tick」→执行 → **意图解析✓** → 5× `POST /a/v1/sim/sessions/{id}/tick 200` → **全局态 50.0→62.7·loadIndex 51.2→92.5·demandLoad 50.7→60.2**（3 条种子传导规则真驱动）·tick 时间轴 5 段·**知识激活 DORMANT→ACTIVE·已推进5tick**。Trial Tick 空跑✓通过。
**诚实边界**：L4 认证级「进入推演」被门控（`✗暂不可进入推演`·综合54·知识28/行为18·世界完整度35%）——但**确定性 tick 驱动不受其限、真推进**。后端 `tick` 200（curTick 真增）。
**过程纠错（FDE）**：首点通用「推进 tick」按钮命中门控控件（看似不动）；改用设计主入口 AI 指挥台才见真传导——**得找对控件，非第一个按钮**。

---

## 链路 4 · Action 审批流 — ✅ 写回→草稿→两步审批→执行 全 UI 实操

| 步骤 | 真实操作 | 结果 |
|---|---|---|
| 写回生成草稿 | 点「处置方案采纳·写回·采纳常州三班制方案」▶启动 | ✓ QOS 写回 → 真建 Action 草稿 `adopt_mitigation`·payload{base:常州,factor:物料齐套,planKey:三班制} |
| 审批列表 `/admin/actions` | 渲染 | ✓ 1 条 PENDING_APPROVAL·两步链(planner→admin) |
| UI 审批①(planner) | 点行→详情→approve-btn→二次确认 | ✓ `POST /decision 200` → planner APPROVE |
| UI 审批②(admin) | 重开详情→approve→确认 | ✓ `POST /decision 200` → admin APPROVE → **status EXECUTED** |
| 审计 | `/audit` | ✓ 每步 approver/comment/decidedAt 全留痕 |

**小 UX 提示**：详情面板每次决策后自动关闭（`onChanged→setSelected(null)`），两步审批需重开草稿——可用但略绕。

---

## 结论与待办

- **可用性**：四链路均**真用户操作走通**。QOS Path A、沙盘确定性推演、Action 全审批流、对象浏览钻取——**眼见为实地能用**。
- **唯一实质缺口**：QOS **Path B 自由问句 ~5min 无流式反馈**（接缝在 LLM 适配器：非流式 + 推理模型 reasoning_content 丢弃）→ **WO-Q1**（待 dev）。
- **诚实边界（非缺陷，记备查）**：① 数据接入只验了**合成正门**，真连接器接入臂未验；② 沙盘 **L4 认证门控**（世界完整度 35%·G-9 发育闭环范畴），确定性 tick 不受限。

### 施工单 WO-Q1（待 dev·P1）— QOS Path B 流式 + 推理模型适配
- **判据（FDE 真值）**：真浏览器自由问句，**≤3s 见首 token、增量流式呈现**；推理模型 `reasoning_content` 不丢（至少思考态可见或折叠）；单 Agent 轮设合理超时 + 超时 graceful 降级（非静默挂起）。
- **方向**：`openai.ts` agent 路径上 `stream:true` + 解析 `delta.content`/`delta.reasoning_content`；或为 agent loop 选非推理快模型；或拆分「分类用快模型 / 终答用推理模型」。**不改 Path A**。
- **关联本体**：QOS 链路 Path B（AGENT_EXPLORATORY）· LLM 适配器接缝；「绿测试≠能用」复发点。
