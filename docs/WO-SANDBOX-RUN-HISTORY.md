# WO-SANDBOX-RUN-HISTORY · 推演沙盘「历史推演记录」（点击查看详情）

> 类型：前端可见性落地（G-VIS-1 同类·后端有真值·前端无处可见）
> 分支：`claude/vigilant-knuth-b1nmxn` · 优先级：P0（用户亲点）
> 责任：dev 建，审核方（reviewer）真浏览器复验。**不新建后端**——数据源全部现成。

## 背景（审核方真跑取证，非推断）

审核方以 demo/admin 身份，在推演沙盘（`/v/sim-sandbox`）**亲手跑通 5 个锂电产销 what-if 场景**（经页面自带 AI 指挥台 + 分支 + 存档 + 采纳）：

| # | 我自拟的锂电产销问题 | 沙盘动作 | 全局态传导 |
|---|---|---|---|
| 1 | 4680-NCM 六周需求高企，产能压力如何传导？ | 推进 6 tick + 存档 | 50.2 → 67.4 |
| 2 | 常州基地负荷再加压，四周内全局态走向？ | 分支 + 推进 4 tick + 存档 | 67.4 → 96.0 |
| 3 | 储能-280Ah 排产挤占，八周态势演化？ | 分支 + 推进 8 tick | 96.0 → 194.6 |
| 4 | 极限压测：需求持续高位 12 周，利用率见顶？ | 分支 + 推进 12 tick + 存档 | 194.6 → 445.6 |
| 5 | 缓解方案：先查就绪再小步推演能否采纳？ | 分支 + 查询就绪 + 推进 3 tick + 采纳 | 445.6 → 527.7 |

**真跑结论**：传导每次真生效（全局态逐 tick 变化），5 次共在后端 `sim_session` 表留下 **8 条会话**（`GET /a/v1/sim/sessions` 可列，含 id/status/curTick/parentCheckpointId/createdAt），每条 tick 轨迹经 `GET /a/v1/sim/compare?a=<id>` 可回放。**但沙盘页面对"历史/session 列表/历史推演"命中数 = 0**——跑完即从视野消失（刷新/离开就找不回），决策者无法回看"我上次那个 4680 六周场景推出来啥、采纳没采纳"。这违背 R13 可溯源 + R17 决策留痕，属 G-VIS-1（后端产物真存·前端无处可见）。

## 目标（DoD-as-experience · 用户视角）

用户在推演沙盘做过若干次推演（推进 tick / 分支 / 采纳）后，**页面上有一块「历史推演记录」**，列出每次推演会话（时间、推进步数、是否分支、场景/问题标签、终态），**点任一条 → 展开详情**：该次推演的全局态逐 tick 轨迹曲线 + 范围(scope) + 就绪等级 + 存档点 + 终值/结论。前端所见 = 后端 `sim_session` 真值，不伪造、不写死。

## 根因解设计（复用现成，零新后端）

**数据源（全部已存在，dev 只接不建）**：
- `GET /a/v1/sim/sessions` → 历史推演列表（每 SimSession = 一条记录）。
- `GET /a/v1/sim/compare?a=<id>` → 该 session 逐 tick 全局态序列（详情曲线）。
- `GET /a/v1/sim/sessions/:id/world` → 该 session 世界态（详情态快照）。
- `GET /a/v1/sim/sessions/:id/certification` → 就绪等级（详情就绪徽章）。

**前端（新增，接现有组件不重写引擎）**：
- 沙盘页新增「历史推演记录」面板（R17：留在同页，作为一个可折叠分区/子 tab，**不新开路由**，与后续工业级重构 Option A 的信息分区一致）。
- 列表：每行 = 一次推演，显示 `createdAt`(时间) · `status` · `curTick`(推进步数) · 分支标记(parentCheckpointId 非空 → "分支自 …") · 场景标签(`scope.presetContext.label` 若有，来自 WO-E2 what-if 入口；无则显 scope 摘要)。按时间倒序。
- 点击行 → 详情抽屉/展开：复用 `SimComparePanel`/`HeatStrip`/`PropagationTimeline`（`views/sim/` 已有）渲染该 session 的 tick 轨迹曲线 + scope + 就绪徽章 + 终态全局态；R13 溯源（这次推了什么→结果如何）。
- 诚实空态：无会话 → "暂无推演记录——推进一次推演后，此处留痕可回看"。
- 事件失效（D-29/R10）：订阅 `sim.session_created`/`sim.tick_completed` → 列表自动刷新（新推演落即现，前端所见=后端真值）。
- API 层 `endpoints.ts` 补 `fetchSimSessions`/`fetchSimSessionDetail`，类型 import 自 `@platform/contracts`（未重定义，contracts-only-shared R1）。

## 验收标准（criteria · 审核方逐条真验）

- **C1（curl·baseline）**：推若干次 tick 后 `GET /a/v1/sim/sessions` 返 length≥N，条目含 `{id,status,curTick,createdAt}`；`GET /a/v1/sim/compare?a=<id>` 返非空 tick 序列。
- **C2（browser）**：沙盘页出现「历史推演记录」面板，列出的记录数与 C1 curl 一致；每行显示 时间/status/推进步数/分支标记（交互真渲染，非装饰）。
- **C3（browser）**：点一条记录 → 详情展开，显示该 session 的全局态逐 tick 轨迹 + scope + 终值，数值与 `compare?a=<id>` 后端真值一致（前端所见=后端真值）。
- **C4（browser）**：在页面新推进一次 tick → 「历史推演记录」内对应会话的 curTick/终态实时更新（或新会话出现），无需手刷（事件失效真生效）。
- **C5（browser）**：诚实空态——无匹配会话时显引导空态，不伪造记录。
- **C6（gate）**：`endpoints.ts` 含 `fetchSimSessions`/`fetchSimSessionDetail`，类型来自 `@platform/contracts`；`pnpm -r build && pnpm -r test` 退出码 0（新增历史面板测计入·其余不回退）；`pnpm gates` 绿（含 `ui-smoke:sandbox` 不回退）；复用 SimComparePanel/HeatStrip（不新建并行引擎）。

## 红线

- **零新后端**：list/compare/world/certification 端点全已存在，只接不建；发现缺字段先问，不擅自加后端。
- **R14 零业务常数**：面板不内联基地名/型号/阈值（`debattery:check` 兜底）。
- **R2 租户隔离 / R3 entitlement 先于 authz**：历史只列本租户会话；`sim.sandbox` 关 → 面板不存在（404 语义）。
- **R17 一页看全**：历史面板留在沙盘同页（分区/子 tab/抽屉），不拆新路由；与工业级重构（Option A）的信息分区协调。
- **不重写传导/认证引擎**：只做"读+投影+展示"。

## 本体引用与影响

- **对象类型（§2.I）**：SimSession / SimTickState / SimCheckpoint（均已存在，无新增）。
- **链路（§3 推演沙盘链路）**：新增一条"历史读投影"消费——`SimSession(已持久化) --list/replay(compare/world/cert)--> 历史推演记录面板`（additive 前端消费，无新后端）。**回写 §3**：在推演沙盘链路补此读出投影。
- **事件（§4）**：消费既有 `sim.session_created`/`sim.tick_completed`（L-sim）做列表失效（D-29/R10）。
- **不变量**：R13 可溯源（记录=推了什么+结果）· R2 · R3 · R14 · R6（详情由 tick 态确定性回放）。
- **断点（§8）**：闭合一个 G-VIS-1 实例（沙盘推演历史·后端存前端不可见）。**回写 §8**：G-VIS-1 覆盖登记 +1（沙盘历史）。

## 关联

- 属用户选定的沙盘工业级重构（Option A）首个落地切片；后续密度/层级/渲染 bug 修复见另单（待审核方出 SPEC）。
- what-if 场景标签依赖 WO-E2 `scope.presetContext.label`（已落）；SIM-PRESET-INJECT（队列 P0）落地后标签更丰富，非本单阻塞。
