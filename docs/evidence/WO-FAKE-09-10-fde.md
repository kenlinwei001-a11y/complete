# WO-FAKE-09 + WO-FAKE-10 · FDE 交付证据（P0 前端 defake 堵根）

两单合一（同触 `ProjectSimView.tsx` + 外部信号）。基线 `7ae47fc`（origin/claude/vigilant-knuth-b1nmxn）。

## 一、改动清单（根因·非贴标签）

### WO-FAKE-09 · 外部信号 provenance + ProjectSim 写死 batches 徽标

- **F4 `ExternalSignalStrip.tsx`**（PlanGenerate/PlanAudit 顶部环境感知 strip）：外部信号均为合成种子
  （`connectors/registry.ts` `MOCK_EXTERNAL_DATA` · 无真实 EXTERNAL 行情/政策连接器实测），`source` 冠真机构名
  （上海有色网/LME/发改委/乘联会/中国外汇交易中心/国网）会误导为权威实测。
  - 后端 `GET /a/v1/external-signals` **additive** 下发 `dataMode: "SYNTHETIC"`（`app.ts`）。
  - 前端 strip 复用**既有 `DataModeBadge`**（非新造）挂 SYNTHETIC「合成数据」诚实位；逐信号 tooltip 追加「（合成占位·非实测）」。
- **F5 `ProjectSimView.tsx` 写死 batches**（`DEFAULT_BATCHES`）：分批模式初值为示例占位。
  - 挂**既有 `DataModeBadge` mode=PARTIAL**（示例占位）+ **运行闸**：采纳（adopt）前若 batches 未编辑则软阻断强确认
    （改任一批次即解闸），对齐姊妹 `SopBalanceView` 的「徽标 + confirmRun」范式。裁决交期/缺口前诚实标数据模式。

### WO-FAKE-10 · 魔法系数/硬编码阈收口（阈值/系数由后端下发·additive 契约·前端不硬编码）

- **瓶颈紧张度阈 85/75/60**（`ProjectSimView` bnColor + StepBody + bn-matrix 弹窗 note）：
  - 契约 **additive** `tightnessThreshold` 加入 `CapacityForecastOutputSchema` + `BottleneckMatrixOutputSchema`。
  - 后端 `capacity.ts` / `risk.ts#bottleneckMatrix` 下发 `tightnessThreshold = params.risk.threshold`（SolverParam 三层真值源·可校准）。
  - 前端色阶带 red≥T / orange≥T-10 / amber≥T-25 由下发阈值推导；常量 85 仅 `out.tightnessThreshold` 缺失兜底。
  - agentcore `solver-field-labels.ts`：`tightnessThreshold` 登记为 META_FIELD（配置元字段·非 KPI）。
- **`RiskPopover ?? 85`**：越线阈值取后端 `data.threshold`；缺阈值 → 不再内联 85 伪造，走中性灰（非 LIVE 着色），对齐 OrderChainView E4。
- **`PropagationTimeline × 0.6`**：财务击穿敞口去前端魔法折算 —— 无逐单真营收（`revenueWan`）→ `financeYi=null` 诚实空态
  「财务敞口待接入真营收·不前端折算估算」，不再 `qty × 0.6` 冒充敞口。
- **`DashboardView { price:0.6, margin:13 }`**：综合毛利率兜底自算跳过非规范细分（SEG_REGISTRY 无此 seg），不再魔法系数凭空折算。
- **`ExternalSignalsPage` 去伪断言**：删「经 EXTERNAL 连接器同步可溯」，据后端 dataMode 诚实标「当前为合成种子·非实测同步」+ DataModeBadge。

## 二、真起服务 · 真浏览器渲染 · 逐值对照后端（铁律 0.4）

真起 datacore(4001·SEED_DEMO=1) + agentcore(4002) + Vite(5188·VITE_DATACORE_URL/VITE_AGENTCORE_URL 指真后端·CORS origin:true)；
Playwright/Chromium(`/opt/pw-browsers`) 真登录 demo/admin/demo1234 → 真渲染 → 截图 + DOM 逐值对照。

### 后端真值（curl `X-Debug-User: demo:admin`）
`GET /a/v1/external-signals` → `dataMode=SYNTHETIC total=6`；
`li_carbonate_price 96000元/吨(上海有色网)` · `nickel_price 18600USD/吨(LME)` · `usd_cny 7.18` · `industrial_power_price 0.78` · `ev_demand_index 112.4` · `ess_subsidy_signal 0.72`。

### 前端真渲染（DOM 抽取·`verify-results.json`）逐值对照
| 视图 | 断言 | 前端真渲染值 | 对照后端 |
|---|---|---|---|
| PlanGenerate strip | SYNTHETIC 徽标 | badge=「合成数据」 | = dataMode SYNTHETIC ✓ |
| PlanGenerate 逐信号 tooltip | 机构名后挂合成位 | 「来源 上海有色网（合成占位·非实测）」等 6 信号 | 值/机构名逐一 = 后端 seed ✓ |
| PlanAudit strip | SYNTHETIC 徽标 | badge=「合成数据」 | = dataMode SYNTHETIC ✓ |
| ExternalSignalsPage | 去伪断言 + 徽标 | badge=「合成数据」+「当前为合成种子…非实测同步」 | 旧「经 EXTERNAL 连接器同步可溯」已删 ✓ |
| ProjectSim 分批 | 占位徽标 + 运行闸 | batchBadge=「部分估算」(PARTIAL) + note「示例占位…请编辑真批次后再据裁决」 | 采纳软阻断在位 ✓ |
| ProjectSim 瓶颈矩阵 | 阈后端下发 | note「紧张度（<60 / <75 / <85 / ≥85·阈值后端下发）」 | T=85 来自 tightnessThreshold ✓ |

截图（scratchpad）：`plan-generate.png`（环境感知 strip「合成数据」黄徽 + 6 信号链）、`plan-audit.png`、`external-signals-page.png`、
`project-sim-single.png`、`project-sim-batch.png`（分批「部分估算」徽标 + 占位批次）、`project-sim-bnmatrix.png`。

## 三、牙齿（回潮即红）
- `genuine-sim:check` EXIT=0 —— PropagationTimeline 保 `revenueWan`+`hasRealRevenue`（去 0.6 主路径仍守）；ProjectSim 消费 r.live/dataMode。
- `no-fake-data:check` EXIT=0 —— 决策路径无 hash 数值裸冒充（0 SUSPECT/LABELED）。
- `css-vars:check` / `no-silent-mock:check` / `solver-label-coverage:check` EXIT=0（tightnessThreshold 登记 META_FIELD）。
- 徽标一律复用既有 `DataModeBadge`（非新造）；阈值下发契约 additive（optional·向后兼容）。

## 四、门与测试
- 4 包 build 绿 · `pnpm -r typecheck` 绿（5 projects）。
- 完整 `pnpm gates` EXIT=0（含 genuine-sim / no-fake-data / css-vars / propagation / no-silent-mock / solver-label-coverage 等 45 门 + `pnpm -r test`）。
- 逐包测试（隔离跑·避 4 核过订阅超时）：contracts 29 / llm-adapters 18 / datacore EXIT=0 / agentcore / frontend 回归全绿。
