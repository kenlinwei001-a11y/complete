# WIP · 订单/型号集整体重播（HTML 24 单 + 6 型号）—— 落地计划与现状

> 用户已拍板「整体重播」。本目录存放**进行中**的迁移：把出厂 20 单 + 6 旧型号替换为
> PRD-IND-order-aggregate 的 **HTML 24 单 + 6 型号**，连带 segment-by-customer(B)、
> forecastStart 2026-06-10、ORDER_OVR 6 单激活(F)。这是全 backlog 最高回归项，
> 级联 6 视图 + 需逐值重基线 ~34 datacore 测试 + 前端。

## 已完成并验证（在 `order-set-replay-WIP.patch`）
- `battery.ts`：MODELS 6 型号改 HTML（4680-NCM/2170-NCM/方形-NCM/方形-LFP/圆柱-LFP/4680-LFP）；
  MODEL_BASE_MAP 键同步（基地拓扑此前已 HTML 对齐，仅 model id 变）；CUSTOMERS 改 HTML 8 客户；
  forecastStart `2026-07-01`→`2026-06-10`；**订单生成从随机改为 HTML_ORDERS 24 单逐字**（so/cust/model/qty/due/pri）。
- `risk.ts`：`segOfCust(cust)` 按客户名正则分细分（含商用车→com·含储能/电网→ess·否则 pas，PRD §4.5-B）；
  segmentOf 三处调用改传 cust。
- 非测试 src/mocks 旧 model id 全局重命名（L300-NCM→2170-NCM·L148-LFP→方形-LFP·P28-NCM→方形-NCM·S192-LFP→圆柱-LFP）：
  service/opsteam/connectors/livedin/contracts + 前端 livedInFixtures/planFixtures。
- **真前端核验**：重启 datacore 后 `GET /objects?type=Order` 返回 24 单，cust/model/qty/due/bases 正确。

## 待重基线（revert 前 datacore 34 失败 / 16 文件，按类）
1. **机械改名**（model id 字面量）：`model-producible`(S192→圆柱-LFP)·`replay-ops`。
2. **订单数/值断言**：`planviews`·`solvers`(V?)·`synthetic-field-alignment`。
3. **slice/契约 fixture**（引用具体实体）：`slice-order-fulfillment`(7)·`ontology-governance` G6 —— 契约 fixture 的 root order/型号需改既有实体。
4. **字节一致 digest 重钉**（数据变=合法重钉，须取新输出值）：`m11-calibration`(5)·`scale-baseline`·`synthetic`·`timeseries`·`simclock`。
5. **livedin 回放叙事**（订单/型号依赖）：`livedin`(4)·`vle`/`vle-acceptance`(4)·`authz`(行级按订单)。
6. **前端**（未测，预计 ~15-25）：f23.order-chain·sop-frontend-1to1·f17/f18·order/dash 相关 + mock fixtures 订单。
7. **ORDER_OVR(F) 激活**：6 单 override 现命中 HTML SO-34xx → 台账出现「未接/提价接」，补门B。
8. **门B**：order/sop/risk/dash/model/quarter 六视图逐一真前端核验取值。

## 恢复方式
```
cd /home/user/complete && git apply docs/wip/order-set-replay-WIP.patch
# 然后逐类重基线（上表），每绿一批提交；datacore 全绿前不提交主干。
```

## 为何 revert 而非半成品提交
delivery 纪律：绝不提交破基线的树。本迁移血缘半径（34 datacore + 前端，混合语义/字节/fixture）
超出单次会话安全预算，逐值重基线需谨慎核验（非盲改期望）。故存 patch + 计划，待专注续做。
