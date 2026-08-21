# WO-PLAN-CHANGE-LEVER-MAP 交单报告 —— order-chain 结论 + 协调加产 携带真域映射 levers 真落库（G-PLAN-CHANGE-NO-LEVER 部分收编）

> 分支 `claude/handoff-wo-plan-change-lever-map` · 基线 `claude/verify-reclaim-6` tip `776b7d33e`（含 WO-ADOPT-SCHEME-CARRIER 并入）· 重画像
> 断点原文（本体 §8）：同一个 `plan_change` key 下四条生产者载荷里没有任何可写的落点；其中沙盘两条诚实失败是正确行为，**order-chain 结论与协调加产属真域映射缺失**——本单只收编这两条。
> 判据落在 **payload 形状**（有没有 `{objectId,prop,value}`），不是 `source` 串。后端 `applyLeverWrites` 已是通用写入器（WO-ACTION-NOOP-EXEC 接的），本单**后端零逻辑改动**，补的是生产者侧的域映射。

## ① 实测数

| 项 | 改前 | 改后 | 证据 |
|---|---|---|---|
| order-chain 采纳结论的 payload | `{so, verdict}`（无落点 → 诚实失败） | 交期紧张 → `Order.outsourceRatio`；需提价 N% → `Order.unitPrice×(1+N/100)` | seam 主判据③（真写+逐字段回读+派生重算） |
| 协调加产确认的 payload | `{intent:"coordinate_capacity"}`（无落点 → 诚实失败） | `Order.outsourceRatio = 被挤量/整单量`（封顶 1） | seam 主判据④ |
| datacore seam 测试数 | 8 | **11**（+主判据③④ +变异反证） | ④节原文 |
| 前端 levers 断言 | 0 | order-fullchain +1 用例 · global-sim-suite +1 断言块 | ④节 |
| 三包编译 | — | contracts build RC=0 · llm-adapters build RC=0 · datacore tsc RC=0 · frontend tsc RC=0 | ④节 T1/T3 |
| 兜底线普查金值 | `["plan_change"]` | **不变**（plan_change 仍是条件成员：无杠杆载荷落兜底线） | 普查用例在 11/11 内绿 |

## ② 改法论据

**病灶定性（沿本体 §3 链路走）**：断在**生产者 → payload** 这一段，不是执行器。`applyLeverWrites`（app.ts）对任何带 `levers[{objectType,objectId,prop,value}]` 的 plan_change 已真写真值 + `runDerivations`；缺的是两条生产者发的载荷里根本没有杠杆行。修法 = 在生产者侧把业务结论**翻译成注册过的本体杠杆**（`solvers/lever-meta.ts` 登记 `Order.outsourceRatio` ratio 0–1，下游 C08 红线/vle 扫描真实消费），不是在后端再开一条写入路径。

**映射定案**（每条都答「为什么是这个数字、为什么是这个属性」）：
- **协调加产**（CustomerImpactBar.confirmCoordinate）：被挤量 ÷ 整单量 = 需要外协对冲的占比 → `Order.outsourceRatio`，round4、封顶 1（被挤量可大于整单量，ratio 语义不许 >1）。`objectId` 用真 Order 本体主键：GlobalSimView orderList 新增 `objId: o.id`（`id` 仍是业务键 so，`objId` 是本体 PK，两者不许混用）。
- **order-chain 采纳**（OrderChainView ofc-adopt）：交期紧张（`packsPerWeekP90 < demand`）→ `outsourceRatio = (demand − packsPerWeekP90)/demand`（产能缺口占比 = 需外协对冲占比）；「需提价 N% 接」（`!marginOk && priceUpPct>0`）→ `unitPrice × (1+N/100)`，N 来自服务端判定的 `priceUpPct`（后端 verdict 口径，前端不重算）。对象反查 `(orders.items).find(o.props.so === data.so)`，取真 `o.id`，**不硬编 `obj_order_*` 格式**；反查不到 → 发无杠杆载荷 → 诚实失败（正确行为，已有边界测试守）。

**诚实不映射的三类（写进源码注释，勿当成"忘了做"去补）**：干净「可接」无附加条件 = 无值可写；信用拦截（不建议接）——回款是事件不是杠杆；齐套缺口——`MaterialBalance` 吨数对 Order 属性无数值映射。硬造映射 = 假 MO 号换件衣服。

**后端只动注释**（app.ts 分支③清单 / actions.ts ACTION_WIRING 与 BUILTIN_ACTION_EFFECTS 注释的三生产方名单），**未 undo** adopt-scheme-carrier 刚并的 domainExecutor 改法（diff 零触碰其分支）。

## ③ 量纲核对表（生产者 → payload → 落库 三者同轴）

| 生产者 | 屏上语义 | lever 行 | 落库属性 | 量纲 |
|---|---|---|---|---|
| 协调加产 | 被挤 qty 套 ÷ 整单 totalQty 套 | `{objectType:"Order", objectId, prop:"outsourceRatio", value:min(1, round4(qty/totalQty))}` | `Order.outsourceRatio` | **无量纲 ratio 0–1**（与 lever-meta 注册口径一致） |
| order-chain 交期紧张 | 周需求 demand 套 − P90 产能 套 | `value: round4((demand−P90)/demand)` | `Order.outsourceRatio` | 无量纲 ratio 0–1 |
| order-chain 需提价 | 「提价 N% 接」（N = priceUpPct 百分数） | `value: round4(unitPrice×(1+N/100))` | `Order.unitPrice` | **元/套**（与 props.unitPrice 同轴，mock 实证 22000×1.03=22660） |
| 派生重算 | — | — | `Order.value = qty×unitPrice` | 元（`runDerivations` 的 round 口径，seam 主判据③逐字段对拍） |

`objectId` 量纲核对：datacore 真值 = `obj_order_${so}`（本体 PK），mock = `ord-001`；前端一律用 fetch 到的 `o.id`，断言按各环境锚点写死（datacore seam 用 SO-3391 反查，前端用 mock ord-001）。

## ④ 测试实测原文（全部亲手跑、显式取码）

**接缝测试（头号判据）** `apps/datacore/test/action-plan-change-levers.seam.test.ts` ——
`pnpm --filter datacore exec vitest run test/action-plan-change-levers.seam.test.ts` → **RC=0 · 11/11 全绿**（首轮 84s / 复原确认轮 72s）。新增三条逐条 ✓：
- `★ 主判据③：order-chain 结论带真域映射 levers → Order 属性逐字段真落库 + 派生重算`（outsourceRatio/unitPrice 精确等值 + `Order.value` 派生重算 + targetRef 含 `PLAN-CHANGE-LEVER` 且非 `/^MO-\d{4}/`）
- `★ 主判据④：协调加产 intent:coordinate_capacity 带 levers → Order.outsourceRatio 真落库`
- `变异反证（摘掉 lever 映射 ⇒ 回到诚实失败）：同一协调加产载荷摘掉 levers → EXECUTION_FAILED 且点名 levers`（错误含 `EXECUTOR_NOT_IMPLEMENTED`/levers/intent，outsourceRatio 未动）

存量 8 条全绿（含诚实边界①沙盘、②无杠杆形态、原子性、兜底线普查金值 `["plan_change"]` 不变、金丝雀）。

**手工变异反证（「不许只断言 EXECUTED」的硬判据·审核方亲手做）**：临时注释 `applyLeverWrites` 主写入 `repos.objects.put`（app.ts:570，审批仍 EXECUTED + targetRef——正是「全链绿而真值没动」形态）→ `-t 主判据` 复跑 **RC=1 · 3 failed | 8 skipped**，全红在仓储读回断言，原文：
- `AssertionError: 审批通过但 Equipment.oee_current 未变 —— 空执行回潮（G-ACTION-NOOP-EXEC）: expected 0.814 to be close to 0.894`
- `AssertionError: order-chain 采纳后 Order.outsourceRatio 未落库 —— 杠杆映射空转: expected 0.35 to be 0.6528`（收到的是种子原值 0.35 ⇒ 写入确未发生）
- `AssertionError: 协调加产采纳后 Order.outsourceRatio 未落库 —— 杠杆映射空转: expected 0.35 to be 0.3332`

探针已复原（`git diff apps/datacore/src/app.ts` **零输出**、porcelain 干净），复原后整文件复跑 **RC=0 · 11/11**。

**前端接缝**：
- `pnpm --filter frontend-shell exec vitest run test/order-fullchain.test.tsx` → **RC=0 · 2/2**：新增用例点 ofc-adopt → 捕获 POST /a/v1/action-drafts 体，断言 `versionId="order-chain:SO-10001"` 且 `levers` toEqual `[{objectType:"Order", objectId:"ord-001", prop:"unitPrice", value:22660}]`（22000×1.03；mock 交期可达故无外协杠杆）。
- `pnpm --filter frontend-shell exec vitest run test/global-sim-suite-seam.test.tsx` → **RC=0 · 7/7**：协调加产确认草稿断言 `levers` toEqual `[{objectType:"Order", objectId:"ord-001", prop:"outsourceRatio", value:1}]`（被挤 1500 ÷ 整单 1420 = 1.0563 → 封顶 1）。

**连带测试（action 接线邻域·datacore 逐文件显式取码）**：`action-noop-exec.seam` + `action-capacity-adopt.seam` + `action-adopt-scheme.seam` → **RC=0 · 3 文件 16/16 全绿**（63s）。

**T 系自测闭环**（禁全量 `pnpm -r test`，全量验收归集成态）：

| 门 | 命令 | 结果 |
|---|---|---|
| T1 构建 | `pnpm --filter @platform/contracts build` · `pnpm --filter @platform/llm-adapters build` | RC=0 / RC=0（datacore tsc 前置缺后者 dist，补建后过） |
| T2 测试 | 上列 6 个文件（datacore×4 · frontend×2） | 每文件 RC=0 |
| T3 类型 | datacore `tsc --noEmit` · frontend `tsc --noEmit` | RC=0 / RC=0 |
| 避让纪律 | 每次 datacore vitest 前 `ps -eo args \| grep -F "node (vitest"` 计数 | 实测 2（≤3 放行） |

## ⑤ 基线变化

- **merge-base = 集成线 tip** `776b7d33e`（WO-ADOPT-SCHEME-CARRIER 并入后的最新集成线）：`git rev-list --count HEAD..776b7d33e` = **behind 0**，ahead 1（本报告提交后 2）。
- **merge-tree 干跑**：`git merge-tree --write-tree HEAD 776b7d33e` → **RC=0 干净**（无冲突标记）。
- **测试基线方向（只降不升 ✓）**：兜底线普查金值 `EXPECTED_FALLBACK=["plan_change"]` 未动；plan_change 仍是 (型×载荷形态) 的条件成员——带 levers 真写、无 levers 诚实失败，两条都在同一文件内有测试守。
- **金值/注册即更核对**：本单未新增 ActionType / 对象类型 / 求解器，无 golden 计数需同步。

## ⑥ 没做的部分（据实交代 + 差什么）

1. **`GlobalSimScenarioBar`（`source:"global-sim-scenario"` + KPI 快照）仍未映射**——工单范围明令只修两条（order-chain / 协调加产），KPI 快照对本体属性无数值落点，仍诚实失败。差什么：若要闭，需先立「情景 KPI → 具体本体杠杆」的域映射（一张独立 WO）。
2. **沙盘两条（`patch.simulated:true`）未碰**——诚实失败是正确行为（PRD §4.1 禁仿真回流真实），工单明令不许碰。
3. **三类诚实不映射**（干净可接 / 信用拦截 / 齐套缺口）保持无杠杆载荷 → 诚实失败，理由写进 OrderChainView 注释；这是裁决不是欠账。
4. **anchors 门 `--update` 未跑**——本单 app.ts/actions.ts 只动注释行，行号漂移属集成态校准范围，照前例留集成方。
5. **全量四包 gate 未跑**——工单纪律禁全量，全量验收归集成态。
