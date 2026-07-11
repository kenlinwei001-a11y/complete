# S5 · WO-SANDBOX-TICK-CALENDAR · 真浏览器证据（2026-07-11 · dev3）

把抽象"推进 tick"绑业务时间（第 N 天/周）+ 点节点看**归因**（哪条边×什么系数把它传变）——**消费引擎已产 `PropagationTrace`**，
让计划员"看得懂"。真起双服务 + 真 chromium + 真 vite + 真 admin 登录 → 真沙盘 → 推 tick → 点 Base 节点 → 归因逐值对照后端 trace。
**非 jsdom·非机制冒充**（铁律 0.4）。

## 真浏览器逐值断言（7/7 全绿）
```
✅ 后端 workspace entitled sim.tick_calendar（battery all-on·暗发键真下发）
✅ 真登录成功 → http://localhost:5174/
✅ tick↔业务时间标真渲染（tick 0 → 「· 第 0 天」·simclock tick=1 模拟日）
✅ 推进 3 tick → curTick=3·业务时间标「· 第 3 天」（tick↔时间同步·R6 纯换算）
✅ 节点归因真渲染 6 条传导贡献·样本「由 (delayed) 经规则 demo_line_util_to_base_load（系数 0.5 · 延迟 1）via …传入 …」
✅ 逐值对照后端：归因引用的规则键出现在真 trace（如 demo_line_util_to_base_load）·消费引擎真产物非造（R13）
✅ 截图 docs/evidence/S5-sandbox-tick-calendar-realbrowser.png
```

截图：全局态标 **`(tick 3 · 第 3 天)`**；点 Base 节点 → R13 溯源 + 归因面板（本 tick 6 条传导贡献·每条真系数真链路）。
S2 诚信位徽标（系数未校准/来源待披露）+ S4 一句人话结论共存——三 feature 正交不打架。

## 顺带实测校正（诚实高于面子·已回写 REVIEW-sandbox-usability-rootcause.md 自我更正节）
S5 真起服务实测发现：**推 1 tick 后端返 52 条非零传导贡献**，基地 `loadIndex` 真被 `demo_line_util_to_base_load`（系数 0.5·延迟 1）
推到 **≈41**（Line 利用率→基地负载·延迟到达）。即**引擎真会传导、基地态真会变**——先前"页面不可用"复盘里"推 tick 全 0 静止"一行
**过度断言**（当时只采样 ARInvoice 非传导目标 + tick0 初态），特此更正：核心推演机制**可用**，S5 归因正是把"基地为什么变 41"逐条讲清楚。
真正可用性缺口收窄为认证门感知（"暂不可进入推演"吓退）+ RC-1 认证达 L4（前向闭合/observability），非"整页死掉"。

## 诚实边界
- **纯前端消费**：`PropagationTrace`（`{ruleKey,fromObjectId,toObjectId,amount,viaLinkKey}`·引擎已产）+ `propRules` join 取系数/延迟——**引擎/传导数学零改**（Dev-1 域不碰）。
- **归因不造**：`computeNodeAttribution` 只映真 trace + 真 propRules；规则不在 propRules → 系数/延迟诚实 `null`；无 trace/无贡献 → "本 tick 无传导贡献"（KILL-MOCK-RED）。
- **tickUnit**：`SimSession +tickUnit?`（additive/optional）·后端未下发时前端退默认 {day,1}（graceful·Dev-1 补下发后自动生效）。
- **暗发闸** `sim.tick_calendar`（defaultOn:false·battery all-on→demo 开）——关=回抽象 tick + 节点纯血缘（回退演练）。

## 配套单测/门
- 前端 `test/sandbox-tick-calendar.test.tsx`（4 测·全绿）：simTickTimeLabel 换算（day/week/milestone/默认）+ computeNodeAttribution（join propRules 真系数·规则缺失诚实 null·无贡献诚实空）。
- 沙盘测组 50 测零回归（sandbox-view/shock-run/render-block/tick-days/radar-collapse/trust-badge/tick-calendar/basecards）。
- 门 css-vars（零新色）/sim/genuine-sim/feature-parity/no-fake-data + ontology-slices 全绿。
- 母体 §2.I 回写（tick↔业务时间 + 节点归因 + trace 前端消费链路补登）+ 切片重生成。
