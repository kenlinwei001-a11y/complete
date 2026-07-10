# WO-CAP-07-MODEL-DIM · FDE 真跑证据（型号维度·本体链路⑤前端 surface）

铁律 0.4：真起 datacore + agentcore（内存模式 SEED_DEMO=1）+ 真浏览器（Chromium/Playwright）+ 逐值对照后端 `capacity_forecast` 端点。绝不用合成/兜底冒充真值。

## 环境
- datacore `:4021`（SEED_DEMO=1）· agentcore `:4033`（DATACORE_BASE_URL=:4021）· 前端 vite preview（VITE_DATACORE_URL/AGENTCORE_URL 指向上述）。
- 账号 demo / admin / demo1234。落点 `/v/sim-sandbox?whatif=1&source=project-sim&subject=常州&model=4680-NCM&demand=40&weeks=6`。

## C2 · 型号列表来自本体 Model 对象（非写死）
`GET /a/v1/objects?type=Model` → `2170-NCM, 4680-LFP, 4680-NCM, 圆柱-LFP, 方形-LFP, 方形-NCM`
前端下拉 options 逐值相同（`__RESULT__.options`）。对比 ProjectSimView 的兜底常量 `DEFAULT_MODELS`（4680-NCM/4680-LFP/刀片-LFP/VDA-NCM/储能-280Ah/储能-314Ah）——刀片-LFP/VDA-NCM/储能-* 全不出现 → 列表确来自本体、非组件写死。

## C1 · 逐值对照 `capacity_forecast` 端点（4680-NCM · qty=40 · weeks=6）

| 字段 | 端点原值（agentcore `/b/v1/solvers/capacity_forecast/run`） | 前端显示（fmt 一位小数） | 判定 |
|---|---|---|---|
| P50 | 5.1836 | **5.2** | ✓ |
| P90 | 4.8667 | **4.9** | ✓ |
| 缺口 gap | 35.1333 | **35.1** | ✓ |
| 主瓶颈 mainBn | 设备OEE | **设备OEE** | ✓ |
| 收敛 producibleCount/totalBases | 3 / 12 | **3/12（PRODUCIBLE_AT）** | ✓ |

型号可产基地网络（PRODUCIBLE_AT · perBaseRows）逐值：

| 基地 | 瓶颈 | 紧张度 | live | 周产能 | 前端显示 |
|---|---|---|---|---|---|
| 常州 | 瓶颈工序 | 65 | true | 0.42 | 常州·瓶颈工序·65·实测·0.42 ✓ |
| 成都 | 设备OEE | 85 | true | 0.44 | 成都·设备OEE·85·实测·0.44 ✓ |
| 合肥 | 设备OEE | 87 | true | 0.43 | 合肥·设备OEE·87·实测·0.43 ✓ |

不可产基地（nonProducible·9）：信阳/厦门/枣庄/武汉/江门/洛阳/眉山/自贡/邯郸 —— 前端逐一 line-through + reason（业态不匹配 / NCM 体系产线未铺设·认证）。

## 型号维度真生效（切型号重算）
下拉切 `4680-LFP` → 重调 `capacity_forecast(4680-LFP,40,6)`：端点 P50 3.6 / P90 3.3 / 缺口 36.7 / 主瓶颈 瓶颈工序 == 前端切换后显示（逐值）。证明结果随型号变、非静态。

## 截图
- `scratchpad/wo-cap-07-model-slice.png`（4680-NCM 全景：型号维度 panel + P50/P90/缺口/主瓶颈 + 型号可产基地网络 + 3/12 收敛，位于 KPI 区之上、独立不侵占 KPI 区）
- `scratchpad/wo-cap-07-model-slice-lfp.png`（切 4680-LFP 后重算）

## 结论
链路⑤（型号产能链 `capacity_forecast(modelId)→型号可产基地网络 PRODUCIBLE_AT`）前端 surface 已闭：型号列表本体驱动（R14）、P50/P90/缺口/主瓶颈+可产基地网络逐值对后端、型号维度真生效、KILL-MOCK-RED 诚实位保留。additive·不动后端·不侵占并发 KPI 口径修区。
