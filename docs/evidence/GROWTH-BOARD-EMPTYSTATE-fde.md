# GROWTH-BOARD-EMPTYSTATE — FDE 证据（P2·用户亲报 2026-07-06）

## 症状与根因
- **症状**：用户打开自成长驾驶舱 `/admin/growth` 看不到「操作/补」按钮，以为没这功能。
- **根因（审核方查证·非按钮缺失）**：补/认领按钮是**逐行**的；demo 干净租户 `growth-worklist=0` 条 → 看板空 → 无行 → 无按钮附着；且「补数据缺口」按钮须**先认领才现**。属**空状态引导缺失 + 两步流程不可见**的可发现性问题。**后端"空"是真的**（干净租户本就 0 条），不改后端语义——纯前端空态引导。

## 修（两处·纯前端）
1. **空态引导 CTA（成长看板 + 工单中心）**：`items/rows` 为空时不再渲染裸空表文本，改渲染引导卡（`wl-empty-guide` / `tc-empty-guide`）：文案「暂无待补缺口——去对话问一个系统答不出的问题，诊断出缺口后会在此生成待办」+ **深链去问答坞** `<Link to="/v/dash">`（`/v/dash` 是 QueryDock 常驻的默认视图页）。工单中心另附「自成长驾驶舱」深链。筛选态空（allItems>0 但 items=0）仍保留「无匹配筛选」纯文本，语义不混。
2. **认领→补两步可见**：OPEN 行「认领」按钮旁挂 `① 认领后解锁「补数据缺口」`（`wl-claim-hint-*` / `tc-claim-hint-*`）；认领后 CLAIMED/IN_PROGRESS 行前挂 `② 已认领` 徽章（`wl-step2-*` / `tc-step2-*`）+ **行高亮**（`data-claimed="1"`，我的在办项着色）+「补数据缺口」按钮解锁出现。

## 触及文件
- `apps/frontend-shell/src/pages/admin/GrowthCockpitPage.tsx`
- `apps/frontend-shell/src/pages/admin/TicketCenterPage.tsx`
- `apps/frontend-shell/test/growth-board-emptystate.test.tsx`（新增·齿）

## 真实测试（jsdom renderApp 级 · 走真实组件 + MSW 真 handler 响应）
`npx vitest run test/growth-board-emptystate.test.tsx` → **EXIT=0 · 3 passed**。断言逐条：
- 空 worklist/ledger（`server.use` 置 `{items:[]}`）→ `/admin/growth` 渲染 `wl-empty-guide`（含引导文案）、`wl-empty-cta` href=`/v/dash`；无任何 `wl-row-*`；裸 `wl-empty` 不出现。
- 空 board → `/admin/tickets` 渲染 `tc-empty-guide`、`tc-empty-cta` href=`/v/dash`、`tc-empty-growth` href=`/admin/growth`。
- 有 items（默认种子）→ 逐行按钮不回归；OPEN 行见 `① 认领后解锁` 且此时无 `wl-fill`/`wl-step2`；点认领 → 行 `data-claimed="1"` + `② 已认领` 徽章 + `wl-fill` 解锁出现 + `① 提示` 消失。逐值对照 MSW 后端真值（claim 后 status=CLAIMED / owner=usr-planner）。

**齿（revert→red）**：临时把成长看板引导卡换回裸 `empty-state` → 同测试 `Unable to find [data-testid="wl-empty-guide"]` → **EXIT=1**（1 failed）。已还原，还原后 EXIT=0。

**无回归**：`f45.growth-cockpit` + `f62.ticket-center` + 新测一起跑 → **7 passed**。`pnpm --filter frontend-shell build` → **EXIT=0**（0 err）。

## 诚实边界
- 本证据为 **jsdom renderApp 级**（真实 React 组件 + react-router + MSW 真 handler，非纯 mock 断言），非真浏览器像素级截图。**真浏览器全链（空租户开看板→见引导→点 CTA 到问答坞→问缺口问题→回看板见新待办行→认领→补按钮现 + 逐屏截图）待前端/后端真栈恢复后补**（近期 CLARIFY/KIMI 已有此诚实先例）。深链目标 `/v/dash` 经 ShellLayout `onViewPage && dockOn` 常驻 QueryDock 验证（源码路径确认）。
- 未自跑 pnpm gates（主控收口跑）。
