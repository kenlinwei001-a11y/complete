# 空洞数据冰山 · A0（dataMode 诚实位推广·结构性根因）— FDE 真值证据

> 源单 `REVIEW-hollow-data-iceberg-and-requeue.md` §A0/§F P1。冰山的**根**：契约层不强制诚实位 → 求解器可静默返回哈希/魔数 → UI 无从区分真假 → 全渲染成权威结论。本单把 risk_timeline/capacity_forecast 已有的 dataMode 范式**推广到 audit_timeline + 13 extended 全族**。

## 结构性根因解

| 层 | 改动 |
|---|---|
| 契约 `contracts/solvers.ts` | `SolverDataModeSchema = z.enum(["LIVE","MOCK","PARTIAL"])` 立为诚实位**单一来源** |
| 求解器 `risk.ts auditTimeline` | 透 `dataMode`：逐日曲线 kind 名哈希派生(无实测)+波及订单真算 → `PARTIAL`（无真订单时 MOCK） |
| 求解器 `extended.ts` | 新 `extendedDataMode(c,key,args)`：据真对象 vs 魔数/硬编码兜底确定性分类 LIVE/MOCK/PARTIAL |
| 分发 `service.ts` | 扩展求解器分发统一附 `dataMode`（`{dataMode, ...out}`） |
| 前端 `components/DataModeBadge.tsx` | 共用诚实位徽章（抽自 RiskBoardView 内联标）：LIVE 低调"实测"·MOCK"估算·无实测"·PARTIAL"部分估算" |
| 前端 `PlanAuditView` | 审计时序卡标 DataModeBadge（消费 audit_timeline.dataMode，A1 旗舰修） |
| 门 `check-genuine-sim.mjs ⑦` | 断言 audit_timeline/extended 透 dataMode + 契约枚举 + 徽章消费防回潮 |

## 真值证据 · 真起 datacore 逐求解器 invoke（dataMode 分类正确）

```
audit_timeline       PARTIAL   (曲线 kind 哈希 + 2 真受影响订单)
yield_diagnosis      MOCK      (A2 默认良率序列写死 0.95/0.85)
quarterly_gap        MOCK      (默认 options/参数)
quote_margin         PARTIAL   (A3 真 bom + price/mfgRate/logistics/floor 魔数)
credit_exposure      PARTIAL   (A3 真客户 + creditLimit 兜底 5000)
maintenance_stagger  PARTIAL   (A4 真 bases + loadByWeek 写死)
countermeasure_combo PARTIAL   (默认 levers 启发系数)
kit_readiness        LIVE      (真 orders+materials 派生)
lta_gap              LIVE      (真 materials)
inventory_optimize   LIVE      (真 materials)
changeover_sequence  LIVE      (真 orders+changeoverMatrix)
carbon_footprint     LIVE      (真 materials+energyMeters)
outsourcing_split    LIVE      (真 orders)
mitigation_select    LIVE      (canonical 方案库)
cert_schedule        LIVE      (真 certifications)
```

→ 与审核方 §A 逐行读源结论**精确吻合**：A1 audit_timeline 哈希曲线、A2 yield_diagnosis 硬编码、A3 credit/quote 魔数兜底、A4 maintenance loadByWeek 写死——全部从"静默无诚实位"变为输出带 LIVE/MOCK/PARTIAL。demo 有真对象的 7 个求解器诚实判 LIVE。

## 门

`pnpm -r build` 全绿；`pnpm -r test` contracts/llm-adapters/agentcore354/frontend289/datacore786 全绿（dataMode 为 additive 字段·不破 solvers-extended/render-contract-autogen/rules-p3-payload 既有断言）；`genuine-sim:check ⑦` 绿（green→防回潮）；`ontology:check` 绿。

## 距北极星（诚实）

- **A0 P1 闭**：契约层诚实位单一来源 + audit_timeline/extended 全族**输出**带 dataMode + audit_timeline UI 徽章 + 防回潮门。
- **A2–A4（P2）UI 标的尾巴**：13 extended 求解器现**已输出** dataMode（结构性根因已除），但其前端**逐视图徽章**仅 audit_timeline + mitigation_select(RiskBoardView) 接入；其余 extended 主要经 QOS 自动渲染（render-contract）surface，逐视图徽章接入是 A2-A4（P2）增量。已诚实标注，非冒充已完成。
- **底层值仍是魔数/哈希**：dataMode 是**诚实披露**层（守"绿测试≠能用"），不等于把魔数换成真数据源——把 yield/credit/loadByWeek 接真 MES/财务/排程是更上游的真数据接入（路线图）。本单做到"不再静默冒充真算"，未做到"全部变真实测"。
