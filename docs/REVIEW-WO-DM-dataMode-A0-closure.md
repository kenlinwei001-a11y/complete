# 审核核发 · WO-DM（dataMode 诚实位 A0·空洞数据冰山结构性根因）闭合

> 提交物 `3f0d30c`「空洞数据冰山 A0：dataMode 诚实位推广到 audit_timeline + 13 extended」。
> 源单：`docs/REVIEW-hollow-data-iceberg-and-requeue.md §A0 P1`（冰山 keystone）。
> 审核方**蒙眼独立真跑复验**（真起 datacore·逐 invoke·对抗式撤回证门咬），非纸面采信 commit。判据来自 `WO-design-landing-batch2.md`/源单 A0 FDE。

## 一句话结论

**✅ 闭合（A0 P1 范围内）。** 诚实位 `dataMode` 真从「契约单一来源 → 求解器分发 → 输出 → 前端徽章」贯通；审核方真跑 15 个求解器的 dataMode 与 dev commit 声称**逐字吻合**（非编造）；防回潮门**实证会咬**；datacore 786 / frontend 289 回归不破。残留（底层魔数接真源、A2-A4 逐视图徽章）已被 dev **诚实标注为上游/增量**，未冒充已做——符合「绿测试≠能用」纪律。

## FDE 判据 · 逐条真跑核对

| 源单 FDE 判据 | 状态 | 审核方独立证据（本会话真跑） |
|---|---|---|
| ① audit 视图卡带 dataMode 徽章 | ✅ | 真起 datacore（memory·SEED_DEMO=1）`POST /a/v1/solvers/audit_timeline/invoke` → `data.dataMode="PARTIAL"`；`PlanAuditView.tsx:344` `<DataModeBadge mode={dot.data?.dataMode} …/>` 读的正是该路径（`data.dataMode`），渲染于审计传导曲线框 |
| ② 兜底数标 PARTIAL（不冒充真算） | ✅ | 真跑 5 路 PARTIAL：audit_timeline（曲线哈希派生·订单真算）+ quote_margin / credit_exposure / maintenance_stagger / countermeasure_combo（真对象+魔数兜底）；2 路 MOCK：yield_diagnosis / quarterly_gap（纯硬编码默认） |
| ③ 漏 dataMode 的求解器门红 | ✅（对抗式实证） | `genuine-sim:check ⑦` 绿；**撤回实证**：把 `service.ts:1552` 的 `extendedDataMode(c,solverKey,…)` 分发删掉 → 门变红「扩展求解器分发未附 extendedDataMode」；还原 → 复绿 |

## 贯通链路 · 四段独立坐实（非看 commit）

1. **契约单一来源**：`packages/contracts/src/solvers.ts:14` `export const SolverDataModeSchema = z.enum(["LIVE","MOCK","PARTIAL"])` —— 真存在（dev commit 所述属实；早先 grep `dataMode` 字段名未命中此 **schema 符号**，已纠正）。
2. **求解器分发**：`apps/datacore/src/solvers/service.ts:1552` `return { dataMode: extendedDataMode(c, solverKey, args), ...out }` —— 集中式分发，13(实为 **14**) extended 全族统一附诚实位。
3. **分类逻辑**：`extended.ts:417 extendedDataMode()` 据「显式 args / 真对象非空 / 魔数兜底」确定性判 LIVE/MOCK/PARTIAL；**14/14 EXTENDED_SOLVERS key 均有显式 case**（审核方交叉核对 record vs switch）——无一静默落 default MOCK。
4. **前端消费**：`components/DataModeBadge.tsx`（LIVE=实测 / MOCK=估算·无实测 / PARTIAL=部分估算·warn 配色·未知 mode 返 null）+ `PlanAuditView.tsx` import 并按 `dot.data?.dataMode` 喂入。

## 真跑全表（datacore memory·seed 42·demo admin）

```
audit_timeline      PARTIAL   yield_diagnosis     MOCK      quarterly_gap       MOCK
quote_margin        PARTIAL   credit_exposure     PARTIAL   maintenance_stagger PARTIAL
countermeasure_combo PARTIAL  kit_readiness       LIVE      lta_gap             LIVE
inventory_optimize  LIVE      changeover_sequence LIVE      carbon_footprint    LIVE
outsourcing_split   LIVE      mitigation_select   LIVE      cert_schedule       LIVE
```
**LIVE×8 · PARTIAL×5 · MOCK×2 —— 与 dev commit 声称 15 路逐一吻合（dev 真跑未注水）。**

## 门 / 回归（审核方亲跑）

- `pnpm -r build` 全 4 包绿（拓扑序·避免陈旧 contracts dist 陷阱）。
- `genuine-sim:check` 绿；对抗撤回 → 红 → 还原 → 绿（门真咬）。
- `pnpm --filter datacore test` → **786 passed** | 11 skipped；`pnpm --filter frontend-shell test` → **289 passed**。与 dev 声称数目一致（dataMode additive·不破既有）。

## 诚实边界（dev 已标·审核方确认未冒充，转下游 WO）

1. **诚实位是「在场判定」非「计算溯源」**：`dataMode=LIVE` 仅表示主输入用了真对象，**不保证** solver 内部无启发系数（如 quote_margin 已诚实降为 PARTIAL 承认 price/logistics 魔数；inventory_optimize=LIVE 但内部仍可能有系数）。够格"禁哈希冒充真算"，**不等于**"全链真实测"。
2. **门是保守源码哨兵**：守 dispatch 接线 + 符号在场，**不**强制新增 extended 必配 case（新求解器缺 case → default **MOCK**＝最不可信方向，安全降级，非冒充）。
3. **A2-A4 逐视图徽章属 P2 增量**：dataMode 已为全族**输出**，但目前仅 `PlanAuditView` **视觉消费**；其余 extended 视图标徽章为后续增量（dev 诚实标注）。
4. **底层魔数→真数据源属上游**：本单是**接诚实位**不是**补真数据**；紧张度哈希、价格/物流魔数的真源接入在 **WO-FORECAST-SIM**（推演接销售预测）等下游单。

## 本体引用与影响

- **不变量**：R13（溯源/诚实位）——本单把 R13 从 risk_timeline/capacity_forecast 局部推广到 audit_timeline + extended 全族，**信任命门**收口。R6（确定性）——分类逻辑零随机、同输入同 dataMode。
- **断点**：hollow-data 冰山 §A0（契约层不强制诚实位）——结构性根因 P1 闭；剩 A2-A4(P2 逐视图) / A★(真源·WO-FORECAST-SIM) 未闭，已诚实登记。
- **链路**：`sys.solver.invoke → 输出诚实位 → 前端徽章`（数据置信度链 Maven 对标 §3 命门环 B）。
- **§7 门禁**：`genuine-sim:check ⑦` 纳入诚实位回潮防线。

---
*审核方独立核发（design+review·本会话真跑为据·非 dev 实装）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入提交物*
