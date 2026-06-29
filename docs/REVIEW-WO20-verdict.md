# 评审核发 — WO-20 ErrorBoundary 崩页导航自愈（dev a260943）

> **角色**（铁律0.5）：审核方独立真跑（真浏览器·**route 拦截强制真崩**·实拍 before/after），非信单测/截图。
> **核发**：**WO-20 = 闭合 ✅**（崩页态导航别页真自愈·实拍坐实）。

## 真跑复验（真浏览器·强制触发真 ErrorBoundary 崩页）
WO-3 已修隔离区/验证引擎崩源 → 审核方用 **Playwright route 拦截**强制造一次真崩来验"复位机制"本身：

| 步骤 | 操作 | 结果（实拍） |
|---|---|---|
| 1 触发真崩 | 拦 `/a/v1/rules` 返非数组 → `/admin/rules` | **💥 ErrorBoundary 显错**：`页面出错了 · (rules ?? []).map is not a function`（实拍 `wo20-1-crashed.png`） |
| 2 崩页态 | 停在 /admin/rules | `仍崩=true`（错误屏在·有「刷新」按钮） |
| 3 导航别页 | 切到 `/admin/connections` | **仍崩=false · 新页真渲染**——数据接入控制台 13 类全出（实拍 `wo20-2-recovered.png`） |

**判据（崩页→导航→自愈）✅ 通过**：崩一页后切别页**自动复位、新页正常渲染**，不再"一崩全卡错误屏"。

## 机制对码（标准 React 复位模式·正确实现）
- `ErrorBoundary.tsx`：加 `resetKey?:string` + `componentDidUpdate(prev)`：`if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({error:null})` —— resetKey 变且处错误态即复位。
- `ShellLayout.tsx`：`<ErrorBoundary resetKey={location.pathname}>` —— 路由变即触发复位。
- 门 `error-boundary-reset.test` 2/2（resetKey 变→自愈 / resetKey 不变→不误清·守"同页崩不被误复位"）。
- **诚实边界**（与 WO-3 协同）：本单只修"韧性/复位"——崩源由 WO-3 修（已闭）、reload 掉登录由 WO-11.4 修（WO-11 未开发·见下）。三单合力才彻底，但 WO-20 "导航即复位"独立生效、已实拍坐实。

## 顺带核（本轮 P1 双闭）
- **WO-Q1 增量2**：上一轮审核方已核发**闭合 ✅**（真 Kimi·answer.delta token 级流式 + reasoning 捕获·`REVIEW-WO-Q1-inc2-verdict.md`）。整体仍剩增量3（QueryDock 渲染·用户可见逐字流）+ §3③。
- **前端 3 测试失败（f43.admin-cluster + vle-segment-matrix·15s 超时）**：dev 回应我"未独立确认"——用 `git stash` 移本轮改动、干净基线复跑两次仍同样 3 失败，证"既存"。审核方判断：方法可信（stash 两验 + 与 ErrorBoundary/data-health/streaming 无文件交集），**采信其"既存"结论**（审核方未再独立复跑·诚实标注）；**建议单开一单核查超时根因**，不混入本轮交付。

## 核发结论
- **WO-20 闭合**：真浏览器实拍——强制崩页→导航别页→自愈渲染，机制（resetKey=pathname + componentDidUpdate）正确、门测 2/2。本轮 **P1 双闭（WO-Q1 增量2 + WO-20）**。
- 开口：WO-Q1 增量3 · WO-10-② · WO-11（含 11.4 reload 掉登录·与 WO-20 协同）· 1C · A6-T2 · 前端 3 测试超时（建议另单）。
