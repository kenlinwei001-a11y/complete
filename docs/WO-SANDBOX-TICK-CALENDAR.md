# WO · SANDBOX-TICK-CALENDAR（tick↔业务时间 + 时间轴事件标注 + 节点归因·让人看得懂）· 详细施工单

> 状态：**待派单**（给 dev 的施工规格；作者不实现）。
> 一句话：把抽象"推进 tick"绑到业务时间（"推进到第 N 周/某里程碑"），时间轴 heat 加刻度+越线/事件标注，节点点开加**归因**（哪条边×什么系数把它传红）——消费引擎**已产**的 `PropagationTrace`，让计划员看得懂。
> 依据：`docs/REVIEW-sandbox-intent-vs-reality.md #4改/#6/#8`（tick 不绑日历·时间轴无刻度·节点无归因）。所有锚点已核对真实存在。
> 纪律：`DESIGN-refit-rollback-plan.md` 七原则。

---

## §0 本体引用与影响（铁律 0 · 门 `prd:check` 机器解析）

**触及对象类型（母体 §2）**：`PropagationTrace`（§2.I·`contracts/sim.ts:28`·**已产·本 WO 消费**）· `SimTickState.trace`（`sim.ts:81`）· `SimSession`（tick↔时间映射）。
**触及链路（母体 §3）**：沙盘链 `propagateTick`→trace→**前端归因/时间消费**（不新增链路·消费既有产物）。
**不变量（母体 §5）**：R6 确定性（tick↔时间映射纯函数·无 Date.now） · R13 溯源（归因=trace 真链路·不造） · R14 零业务常数（时间单位/事件标注配置驱动） · R17 决策单页（看得懂）。
**断点（母体 §8）**：G-1（预诊断）· G-10（系数经规则·归因显真系数）。
**回写母体**：§3 补"trace 前端归因消费"关系；`pnpm ontology:slices`（若改母体）。

---

## §1 背景·目标·依赖

### 1.1 问题（REVIEW 模拟脚本2/5）
- "推进 tick" **不绑日历**——推 3 次=多久？（`simclock` tick=1 模拟日，但页面不显）。
- 时间轴 heat（`HeatStrip`）只有色，**无刻度/事件标注**（哪 tick 越线、发生什么）。
- 点 DAG 节点只弹 R13 血缘（对象哪来），**看不到"它为什么红"**——尽管引擎**已产** `PropagationTrace`（`sim.ts:28`·挂 `SimTickState.trace:81`），前端没消费成归因。

### 1.2 目标
tick↔业务时间 + 时间轴事件标注 + 节点归因链 → 计划员看得懂"何时、为什么、多严重"。

### 1.3 依赖
- **前置**：S1（渲染器落地·时间/归因挂在统一触发之后）；部分可独立（trace 消费）。
- **复用**：`PropagationTrace`（已产）· `SimTickState.trace`（已挂）· `PropagationTimeline.tsx`/`HeatStrip`（时间轴）· `PmDag`（节点点击）· `simclock` tick=1 模拟日语义。

---

## §2 范围与非范围

**In scope**：
1. 契约：`SimSession` 加 `tickUnit`（tick↔时间映射·如 `{unit:"day", perTick:1}`·additive）；里程碑/事件标注可选。
2. 前端：命令条"推进 tick"→"推进到第 N {周/里程碑}"；时间轴加刻度+越线/事件标注（消费 trace 的 `firedRules`/越阈 tick）；节点点击加"归因"面板（消费 `trace`：哪条边 via 哪条规则×什么系数×延迟 传入本节点）。
3. 后端：`propagateTick` trace 已含贡献来源——确保 trace 携"每贡献的 (源对象,规则key,系数,delay,量)"足够前端归因（若缺则补 trace 字段·additive）。

**Out of scope**：
- ❌ 改传导数学（引擎不动·只消费 trace）。
- ❌ 真实日历/排班集成（tick↔时间是会话内映射·非真日历）。

---

## §3 详细设计

### 3.1 契约（`packages/contracts/src/sim.ts`）
```typescript
// SimSession additive
tickUnit: z.object({ unit: z.enum(["day","week","milestone"]).default("day"), perTick: z.number().int().min(1).default(1) }).default({unit:"day",perTick:1}),
// PropagationTrace 确保足够归因（若现字段不足则 additive 补）
// 目标形状：{ tick, targetObjectId, targetStateVar, contributions:[{ fromObjectId, ruleKey, coefficient, delay, amount }] }
```

### 3.2 前端 · tick↔时间（`SandboxView.tsx` 命令条）
- "推进 tick" → "推进到第 N 周"（N×perTick×unit 换算·显真实时间）；全局态大数标"（第 W3 周）"。
- 时间轴 `HeatStrip`/`PropagationTimeline` 加刻度轴（周/里程碑）+ 越线周红标 + 事件点（trace `firedRules`）。

### 3.3 前端 · 节点归因（`PmDag` onNodeClick 扩）
- 点节点 → 现 R13 血缘 **保留** + 加"归因"页签：读该节点该 tick 的 `trace.contributions` → 列"由 {源对象} 经 {规则key}（系数 {c}·延迟 {d}）传入 {amount}"——**每项是真链路真系数**（R13·G-10 显真定义），非编造。
- 无 trace（静止/无传导）→ 诚实"本 tick 无传导贡献"（不造）。

---

## §4 触点清单
| 文件 | 改动 | 面 |
|---|---|---|
| `packages/contracts/src/sim.ts` | `SimSession +tickUnit`·`PropagationTrace` 补归因字段（additive） | 契约 |
| `apps/datacore/src/sim/propagation.ts` | trace 携足够归因（源/规则/系数/延迟/量·若缺则补） | 后端 |
| `apps/frontend-shell/src/views/sim/SandboxView.tsx` | 命令条 tick↔周·节点归因面板 | 前端 |
| `apps/frontend-shell/src/views/sim/PropagationTimeline.tsx` | 刻度+事件标注 | 前端 |
| `docs/SYSTEM-ONTOLOGY.md` §3 | 回写（若改） | 回写 |

---

## §5 验收（真跑·含回退演练）
1. **tick↔时间**：命令显"推进到第 3 周"；全局态标真实周；换 `tickUnit` 配置→显示随之变（R14 配置驱动）。
2. **时间轴标注**：越线周红标 + 事件点对 trace `firedRules` 逐值。
3. **节点归因**：点红节点→归因列"由 X 经规则 R（系数 0.85·延迟1）传入 N"，逐值对 `SimTickState.trace`；无 trace 诚实空态。
4. **R6**：同 session 双跑 trace/时间字节一致。
5. **回退演练**：feature `sim.tick_calendar` 关→"推进 tick"回抽象 tick、节点回纯血缘（旧行为）；契约 default→旧会话零破坏。
6. **gates 全绿**。

## §6 失败判据
- F1 归因编造（trace 不足却硬凑）→ 违 R13/KILL-MOCK-RED·诚实空态。
- F2 tick↔时间换算错（周/日混）→ 单测守。
- F3 契约破坏旧会话→revert。
- F4 门红→不进下一期。

## §7 排序
- **前置 S1**；可与 S3 并行（S5 timeline/trace·S3 branch/compare·弱相交）。
- 部分（trace 归因）可独立于 S1 先做（消费既有 trace）。

## 附录 · 证据锚点
`contracts/sim.ts:17/28/81`（DelayedContribution/PropagationTrace/SimTickState.trace·已产）·`SandboxView.tsx onNodeClick`（现只血缘）·`PropagationTimeline.tsx`（时间轴）·`sim/propagation.ts`（trace 产出点·衰减/延迟）·`simclock` tick=1模拟日·母体 §5 R6/R13/R14/R17 · §8 G-10。
