# WO-FRESHNESS FDE 证据 · 置信度三维贯通（新鲜度 STALE + 真实↔合成 SYNTHETIC + 实测↔估算）

工单 #20 · P2 · 并入 WO-DM dataMode。把求解器诚实位从二维（实测↔估算 LIVE/MOCK/PARTIAL）扩到**三维**：
`真实↔合成 × 新鲜↔陈旧 × 实测↔估算`，并入 `dataMode` 头条 + structured `confidence`，跨求解器统一叠加。

## 本体引用与影响

- **对象类型**：Solver（§2.E）· ObjectInstance.origin（SYNTHETIC/MATERIALIZED，§2.B）· DataSourceHealth（dataHealth.critical/lagHours）。
- **链路**：求解/推演 → 答案（§3 输出侧）。`invoke` wrapper 末统一叠加 `applyConfidenceDimensions`。
- **不变量**：R13（结论可溯源 · 信任=出处+新鲜度；本工单把 C09 新鲜度从仅 capacity 升为跨求解器 + 真实↔合成维）· R6（确定性 · `isSyntheticDecision` 按租户缓存、无随机/时钟）· R2（tenant 隔离 · 按 tenantId 探测）· R14（用 `config.synthetic` 通用标识判合成源，非业务名）。
- **门**：新建 `pipeline-freshness:check`（§7，已并入 `pnpm gates`）；不破 `no-silent-mock:check`/`genuine-sim:check`（扩枚举为追加）。
- **回写**：`docs/SYSTEM-ONTOLOGY.md` §2.E（求解器诚实位=决策置信度三维）+ §5 R13（三维延伸）+ §7（pipeline-freshness:check 门）。

## 落点

| 维 | 诚实位 | 触发 | 落点 |
|---|---|---|---|
| 实测↔估算 | LIVE/MOCK/PARTIAL | 求解器自报（WO-DM 已立） | `confidence.measurement` |
| 新鲜↔陈旧 | STALE | 关键源 `dataHealth.critical` 新鲜度 `lagHours>staleHours`（C09 跨求解器化） | `confidence.stale/lagHours/staleSources` + 头条 STALE |
| 真实↔合成 | SYNTHETIC | 纯合成对象决策（`origin=SYNTHETIC` 或 MATERIALIZED-from-合成源 `config.synthetic`） | `confidence.synthetic` + 头条 SYNTHETIC |

头条 `dataMode` 取最审慎：**MOCK > SYNTHETIC > STALE > PARTIAL > LIVE**（MOCK 纯估算不被横切维洗白）。

- 契约：`packages/contracts/src/solvers.ts` — `SolverDataModeSchema` 追加 `STALE`/`SYNTHETIC`（不破既有 LIVE/MOCK/PARTIAL）+ 新增 `SolverConfidenceSchema`（synthetic/stale/measurement/lagHours/staleSources/note）；capacity/risk/bottleneck schema 的 dataMode 扩为 `SolverDataModeSchema` + 加 `confidence`。
- 服务：`apps/datacore/src/solvers/service.ts` — `invoke` 末调 `applyConfidenceDimensions`（关键源 dataHealth 新鲜度 + `isSyntheticDecision`）；`SOLVER_OUTPUT_SHAPES` 自动追加 `confidence`（G-8 shape-drift 同步）。
- 前端：`apps/frontend-shell/src/components/DataModeBadge.tsx` — STALE/SYNTHETIC 标签 +「基于 N 小时前 / 合成数据(非真实接入)」+ `confidence` 三维 title；`RiskBoardView.tsx` — 决策置信度横幅消费 `confidence` 显三维（`data-testid=risk-confidence-banner`）。
- 门：`scripts/check-pipeline-freshness.mjs`（关键源 dataHealth 接进决策置信度·缺即红·并入 `pnpm gates`）。

## 真跑证据（内存 datacore · build 产物 · 真 HTTP inject）

脚本：`scratchpad-fde-freshness.mjs`（运行后已删，命令 `node scratchpad-fde-freshness.mjs`），boot `apps/datacore/dist/app.js` + `seedDemo`+`seedDemoSynthetic`（同 server.js SEED_DEMO 路径）。

```
=== ① 纯合成租户 demo（origin 链路溯回 config.synthetic 合成源）===
capacity_forecast: dataMode=SYNTHETIC confidence={"synthetic":true,"stale":false,"measurement":"LIVE","note":"此决策基于合成数据（非真实接入）"}
risk_timeline:     dataMode=SYNTHETIC confidence={"synthetic":true,"stale":false,"measurement":"PARTIAL","note":"此决策基于合成数据（非真实接入）"}

=== ② 把全部决策对象翻成真实接入（隔离新鲜度维）→ 关键源人为滞后 4.2h ===
真实接入+新鲜:        dataMode=LIVE  confidence={"synthetic":false,"stale":false,"measurement":"LIVE"}
真实接入+关键源滞后:  dataMode=STALE confidence={"synthetic":false,"stale":true,"measurement":"LIVE","lagHours":4.2,"staleSources":["IoT/SCADA 实时采集"],"note":"此决策基于约 4.2 小时前的数据（关键源 IoT/SCADA 实时采集 滞后）"}

=== ③ MOCK 求解器不被横切维洗白 ===
bottleneck_matrix(无 LIVE arg): dataMode=MOCK confidence={"synthetic":false,"stale":true,"measurement":"MOCK",...}
  → 头条仍 MOCK（最审慎不被 STALE/SYNTHETIC 覆盖）；confidence 仍如实记录 stale（结构层不漏标）。
```

亦经 curl 真起服务（`PORT=4063 SEED_DEMO=1`）核实 ①：
```
$ curl -s -XPOST :4063/a/v1/solvers/capacity_forecast/invoke -H 'X-Debug-User: demo:admin:admin' -d '{"args":{"modelId":"4680-NCM","qty":40,"weeks":6}}'
  → data.dataMode=SYNTHETIC · data.confidence.synthetic=true · note=此决策基于合成数据（非真实接入）
```

> 关键源人为滞后用真服务无 HTTP 写口（对象变更走 R4 Action 审批，无直 PATCH 路由），故用 build 产物
> + 真 HTTP inject + 服务级 `markSourceStale`（§6.2 测试钩子，与 iot_delay 情景同源）演示 STALE，仍走真
> `invoke` → `applyConfidenceDimensions` 真代码路径（非单测断言）。

## 单测覆盖（确定性 R6）

`apps/datacore/test/solvers.test.ts`：
- WO-FRESHNESS① 纯合成租户 → capacity_forecast/risk_timeline dataMode=SYNTHETIC + confidence.synthetic=true。
- WO-FRESHNESS② 真实接入隔离 → 关键源滞后 4.2h → dataMode=STALE + lagHours=4.2 + note 含「小时前」。
- WO-FRESHNESS③ bottleneck_matrix（无 LIVE arg）→ dataMode=MOCK 不被洗白。

## 前端徽章（构建 + 组件）

`pnpm --filter frontend-shell build` 通过（1171 modules transformed），`DataModeBadge` 新增 STALE/SYNTHETIC
标签 + 三维 title；`RiskBoardView` 决策置信度横幅（`risk-confidence-banner`/`risk-confidence-datamode`）。
真浏览器截图：本环境 chromium 受限，未实拍 RiskBoardView 横幅渲染 —— **诚实留审核方**用 `pnpm ui-smoke`
（VITE_MOCK :5199）真浏览器核实横幅渲染（mock 模式 dataMode 走 fixtures，三维徽章由组件渲染）。

## 红线核对

- `pnpm -r build`（4 包）✅ · `pnpm --filter datacore test`（804 测·新增 3 WO-FRESHNESS）✅ · `pnpm --filter frontend-shell test`（276 测·两半各 144/132）✅ · `pnpm gates`（含 no-silent-mock/genuine-sim/pipeline-freshness）✅。
- 扩枚举为**追加**（既有 LIVE/MOCK/PARTIAL 消费行为不变·card 级 dataMode 不动·shape-drift/no-silent-mock 守）。
- R2 tenant 隔离 · R6 确定性 · R14 用 config.synthetic 通用标识非业务名 · 契约只经 `@platform/contracts`。
