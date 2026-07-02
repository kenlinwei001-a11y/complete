# REVIEW · SANDBOX-RUN-HISTORY 复验闭环（推演沙盘「历史推演记录」·G-VIS-1·后端 sim_session 有真值前端无面板）

> 审核方真 curl + 真浏览器（chromium + 真 vite:5200 直连真 datacore:4001·非 mock）逐条闭合。判决 **✅ DONE**（C1-C6 真跑·前端所见=后端 sim_session 真值·零新后端）。

## 判决：✅ DONE

| # | 断言 | 类型 | 证据 | 判 |
|---|---|---|---|---|
| C1 | 推 tick 后 GET /sim/sessions 返 ≥N 含{id,status,curTick,createdAt}；/sim/compare?a=<id> 非空 tick 序列 | curl | 建 3 会话(锂电产能-基线/扩产/常州合肥)各推 tick → `/sim/sessions` 返 3·全含 id/status/curTick/createdAt/scope；`/sim/compare?a=ID1` 返 4 tick 序列(0,1,2,3)·tick0 state={util:0.82,gap:35.1,oee:0.76}=baseSnapshot | ✅ |
| C2 | 沙盘页出现「历史推演记录」面板·记录数与 C1 一致·每行时间/status/推进步数/分支标记真渲 | browser | `sandbox-run-history` 面板present·**4 行=后端 4 会话**（导航沙盘自动新建 1 会话·面板即时反映=C4 侧证）·每行时间/READY|RUNNING 徽标/curTick/scope 标签/根推演‖分支 真渲 | ✅ |
| C3 | 点一条→详情显逐 tick 全局态轨迹+scope+终值·数值与 compare 后端真值一致 | browser | 点 `sandbox-history-row-<ID3>`→详情 open·**终值 terminal="0.8"** = 审核方独立按 tickMean 口径 compute 后端 compare(0.765→0.8) **逐值对上**·火柴图 spark present·3 点·前端所见=后端真值 | ✅ |
| C4 | 新推进一次 tick→历史面板对应会话 curTick 实时更新（事件失效真生效·D-29） | browser | AI 指挥台输入「推进 1 tick」→echo「意图：推进 1 个 tick ✓」→活动会话 `sims_7zf…` 历史行 curTick **0 tick→1 tick** 实时更新（refreshKey=`${sessionId}:${curTick}` 变→re-fetch·非手刷） | ✅ |
| C5 | 无匹配会话→诚实空态引导·不伪造 | browser+curl | fresh 租户（R2 隔离）`/sim/sessions`=0 → 前端渲 `sandbox-history-empty`「暂无推演记录——推进一次后此处留痕」·非伪造记录·真值驱动（demo 有 4 会话时 empty 正确 absent） | ✅ |
| C6 | endpoints 类型自 contracts·build/test 退0·gates 绿·复用 SimComparePanel/HeatStrip 不新建引擎 | gate | `SandboxRunHistory.tsx` 类型 `import type {SimSession,TickState} from "@platform/contracts"`·复用 `fetchSimCompare`（零新引擎/零新后端）·`sandbox-run-history.test.tsx` **4/4**·`pnpm -r build` 退0 | ✅ |

## 治法（G-VIS-1 · 后端有真值前端可见）
后端 sim_session 每次推演真留痕（curTick/status/parentCheckpointId/scope/createdAt），此前前端 0 历史面板——跑完即从视野消失（IPO 断层）。`SandboxRunHistory` **只读消费现成端点**（`GET /sim/sessions` 列表 + `/sim/compare?a=<id>` 逐 tick 轨迹）·`tickMean` 与 SandboxView globalKpi 同口径（R6）·refreshKey 驱动 tick/分支后自动重取。零新后端·零新引擎。

## 本体引用与影响
- 链路：`推演 SimSession(tick 真留痕) → 历史面板(GET /sim/sessions + /sim/compare) → 详情逐 tick 轨迹`。
- 不变量：R2（fresh 租户 0 会话·隔离真生效）· R6（tickMean 同口径确定性）· R13（sim_session 可溯源留痕·前端所见=后端真值）。
- 断点：G-VIS-1（后端有真值前端整块无处可见→本单补沙盘历史面板接缝）。
