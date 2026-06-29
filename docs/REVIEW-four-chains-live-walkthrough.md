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

**诚实边界**：上述 34 类型/物化数据**全部来自确定性合成种子（合成走正门）**。真接入臂走查时**未验**——后经**审核方真跑复验补齐**（见下）。

> ### ✅ 补验（结构化接入臂·真 curl + 真浏览器·非信本体 G-6 声称）
> 走查后审核方重起服务、真跑两条上传链坐实「真连接器接入→对象」：
> - **Chain A · CSV file_upload**（真 curl 上传 `maint-schedule.csv` 设备检修排程·新颖数据）→ 自动建 `file_upload` 连接 + **字段画像正确**（planDate→date·durationH→number·status→enum[SCHEDULED,PENDING]·uniq/null 率）→ RawDataset 5 行落库。G-6 CSV/XLSX 三路解析**真能用**。
> - **Chain B · HTML 原型 intake**（上传 3 个新客户原型）→ 确定性解析→对账(autoMap 6/7 列·custName 1 列诚实留候选)→ import 建 `prototype_html` 连接→ **objectify 物化 3 个真 Customer 对象**（计数 **8→11**·总 **469→472**·NEWCO-001 props 真值非空壳·对象浏览器可见）。
> - **真浏览器落点**：数据接入控制台底部列表真见两条新连接 `原型导入:客户主数据原型.html(prototype_html·ACTIVE)` + `upload:maint-schedule.csv(file_upload·ACTIVE)`；对象浏览器 Customer 显 11。
> **更正结论**：**结构化连接器接入臂（CSV/XLSX/HTML 原型→连接→RawDataset→物化→可浏览对象）真能用**（本体 G-6 ✅ 经审核方独立真跑坐实，非仅信声称）。Flow 1 由「◐ 真接入臂未验」**升为 ✅**。**唯一仍未闭子臂 = 规则文档 LLM 抽取（= 1C·已开单 `HANDOFF-1C-...md`）**——那条空是因 Kimi 复杂 schema 抽取产 0 候选，非链路缺失。
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

> ### ⚠️ 复验更正（dev WO-1 走查中途落地·审核方重建复测）
> 上述 Path B「~5min」实测于**走查时的旧构建（WO-1 前）**。走查途中 dev 推 `f99ac77 WO-1 LLM 用途接缝根治`（含 `seedDemoLlmProvider` `structuredOutput` false→true，提升 classifier 解析率）。审核方**重建 + 重启 datacore/agentcore 后重测同一问句**：
> - **同问句「设备检修计划加剧交付风险」现路由到 Path A 工作流**（`maintenance_stagger`·VERIFIED_WORKFLOW）·**26.0s 收敛**·富答案（text+kpi+table）——classifier 修复使其命中工作流、不再落慢速 Agent。**原「5min 挂死」对此问句已被 WO-1 间接消解**。
> - **真·开放式问句**（"综合评估常州运营韧性·设备/物料/订单三方面三建议"）仍**正确落 Path B Agent**·审核方实测：~30s 出首个 step 反馈（分类期静默）→ 多轮真工具(discover/query_objects/resolve_slice，每轮 Kimi 7–30s)→ t+76.5s `BUDGET_EXCEEDED` → **t+142.0s `answer.final` = 「（探索模式未能产出回答）」**（AGENT_EXPLORATORY·优雅降级占位·**无真答案**，与 dev WO-1 自承 122.5s 一致）。**即：开放式综合分析类问句（"评估X并给3条建议"，AI 最高价值场景）当前产不出富答案、只回占位**——这是 Path B 当前真天花板（dev 已记预算/收敛为另议）。
> - **SSE 确有 step 级流式**（step.started/completed 实时帧·UI「推演过程 DAG」可呈现），但**前 ~30s 分类期零反馈 + 无终答 token 级流式**仍在。
> **修正后的 WO-Q1**：核心剩余缺口收窄为 **① 分类期 ~30s 静默（首反馈过慢）② 终答无 token 级流式 ③ 开放式深问句预算/收敛调优（dev 已记为另议）**——**非「永久挂死」**。WO-1 已闭合「接缝裸泄漏 SDK 串 + 错误信封」根因（审核方另核 WO-1）。

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
- **剩余缺口（经 WO-1 复验收窄）**：QOS **Path B 首反馈过慢 + 无终答 token 级流式**（分类期 ~30s 静默；开放式深问句易预算降级）→ **WO-Q1**（待 dev·P1）。**原「~5min 挂死」已被 dev WO-1 的 classifier 修复间接消解**（同问句改走 26s Path A 工作流）。
- **诚实边界（非缺陷，记备查）**：① ~~数据接入只验合成正门~~ **已补验**：结构化接入臂（CSV/HTML 原型→对象）真 curl+真浏览器坐实可用（Flow 1 升 ✅）；仅**规则文档 LLM 抽取**子臂未闭（=1C·已开单）；② 沙盘 **L4 认证门控**（世界完整度 35%·G-9 发育闭环范畴），确定性 tick 不受限；③ 本走查横跨 dev 主动推 WO-1/A6 两提交，**Flow 2 结论已据新构建更正**（FDE：勿据旧码下结论）。

### 施工单 WO-Q1（待 dev·P1）— QOS Path B 流式反馈（WO-1 后收窄）
- **判据（FDE 真值）**：真浏览器自由问句，**分类期 ≤5s 见首个进度帧**（step DAG 或思考态可见，非纯「仍在执行」静默）；终答**增量流式呈现**（token/段级）；开放式深问句**收敛或显式降级有清晰提示**（非长时间无反馈）。
- **方向**：① classify 阶段前端即时呈现「分析中」step（后端已有 `query.classified` 事件可前置）；② 终答 `stream:true` + 解析 `delta.content`；③（已部分由 WO-1 缓解）classifier 命中工作流即走快 Path A；④ 开放式 Path B 预算/收敛调优（dev WO-1 已记为另议）。**不改 Path A**。
- **关联本体**：QOS 链路 Path B（AGENT_EXPLORATORY）· LLM 适配器接缝；与 dev WO-1（用途接缝/错误信封·已闭）**互补不重叠**。
