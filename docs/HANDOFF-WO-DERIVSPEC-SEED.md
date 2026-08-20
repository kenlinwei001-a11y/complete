# HANDOFF · WO-DERIVSPEC-SEED（补 DerivationSpec 种子 · 闭 G-DERIVSPEC-EMPTY ⊕ G-DERIVED-FORMULA-UNVERIFIED 残口②）

分支：`claude/handoff-wo-derivspec-seed`（自 `origin/claude/verify-reclaim-6` 开出）
基线 tip 实测：**`e1694f00fdfab62e83f96e37ae9660be974e92a1`**（2026-08-20 fetch 实测，与工单预期一致）

## ① 取证清单（先取证后动手 · 全部实测非推断）

**取证① 基线上 `derivationSpecs.list(ACTIVE)` 实测返回什么**
- 静态：`compileSpecs`（`derivation_specs` 表唯一编译写入方）全 src 唯一调用方 = REST 端点
  `POST /a/v1/ontology/derivation-specs`（app.ts compileSpecs 路由），**无任何种子路径调它**。
- 实测：`/tmp/derivspec-feasibility.mjs` 把出厂本体 + 出厂种子（generateBattery(42,"S") ∪ extended）
  种进内存仓、真跑 `OntologyService.runDerivations()`（SUCCEEDED / updated=126）后读表：
  **`derivationSpecs ACTIVE = 0（全量 = 0）`** —— 「接了线没数据」坐实。
- 三处消费点行号现核（工单给的 2416/3888/5955 已漂，以符号搜为准）：
  `app.ts:2459`（assembleCertification 认证装配）· `app.ts:3931`（process-inspect ⑭ 即席切片）·
  `app.ts:6004`（`GET /a/v1/ontology/slices/:sliceKey/layers` ⑭证据层）。三处同一读法
  `repos.derivationSpecs.list(c.tenantId, (s) => s.status === "ACTIVE")`。

**取证② runDerivations 读端与物化值的对账现状**
- demo 世界 14 条 `derivedProperties`（battery.ts：Base×3 / Model×2 / Order / DemandSegment×2 /
  MaterialBalance / Metric×2 / SopVersionRow / InterBaseTransfer / FinishedGoodsInventory），
  由 legacy `OntologyService.runDerivations()`（`parseAggregate` / `evalArithmetic`，末端 `round(v,6)`）
  物化到 `obj.props`；`derived-recompute:check` 门守 legacy 管线自身一致性，但 **`DerivationSpec`
  机制（ontology-core recompute / §2 DSL）零种子、零对账**（该门头注自己写明这条边界）。

**取证③ 种子可造性自证（`/tmp/derivspec-feasibility.mjs` 逐条实测）**
- 同一台**生产 §2 DSL 求值器** `evaluate()`（ontology-core recompute 本尊用的它）逐实例求值
  vs legacy 物化值，容差 1e-9：

  | legacy 公式 | §2 DSL 译本 | 结果 |
  |---|---|---|
  | Order.value = qty * unitPrice | `this.qty * this.unitPrice` | ✓ n=24 全对 |
  | DemandSegment.revenueWan / marginWan | `this.demandWanPerYearP50 * this.priceWan [ * this.marginPct / 100]` | ✓ n=3 全对 |
  | Metric.delta | `this.actual - this.target` | ✓ n=10 全对 |
  | SopVersionRow.gap | `this.demand - this.supply` | ✓ n=4 全对 |
  | InterBaseTransfer.etaDay | `this.dispatchDay + this.transitDays` | ✓ n=17 全对 |
  | FinishedGoodsInventory.qtyAvailable | `this.qtyOnHand - this.qtyReserved` | ✓ n=57 全对 |
  | Model.totalDemand = SUM(Order.qty BY model) | `SUM(out(model_demanded_by_order).qty)` | ✓ n=6 全对（真链路与 BY 字段同集） |
  | Model.orderCount = COUNT(Order.so BY model) | `COUNT(out(model_demanded_by_order))` | ✓ n=6 全对 |
  | MaterialBalance.coverage（除法） | — | ✗ 6/9 不符：DSL 每运算 4 位定点 vs legacy 末端 6 位，第 5 位分叉（差 ~2e-5） |
  | Metric.gapPct（除法） | — | ✗ 3/10 不符（差 ~3e-3） |
  | Base.orderCount / committedQty / oeeIndex | — | ✗ 不可译：BY-field 聚合（`BY bases`/`BY baseId` 按源对象字段匹配），DSL 聚合只能沿链路实例单跳导航，Base↔Order / Base↔Equipment 无直接链路类型 |

## ② 选路与 why

**选「补种子」路。** 可造性已自证：14 条 legacy 公式中 9 条可无损译成 §2 DSL 且与物化值
逐实例对账 ≤1e-9 精确一致（上表）。退役摘除会把 ⑭证据层唯一的派生溯源输入、
impact-analysis 的传播闭包输入、认证装配的 `derivationNodes` 一起拆掉，而补种成本只是
一个幂等种子函数 —— 两条路成本/收益悬殊，不存在真互斥。

**诚实边界（不种的 5 条，一条都不许被读成「漏」）**：除法 2 条因两套求值器取整口径不同
会**对不上账**（对不上账的种子比没有更糟 ⇒ 不种）；Base 3 条结构上不可译。这 5 条仍由
`derived-recompute:check` 门覆盖（legacy 管线自身一致性）。

## ③ 改动清单

- `apps/datacore/src/seed.ts`：`DEMO_DERIVATION_SPECS`（9 条 · 逐条头注来历与边界）+
  `seedDemoDerivationSpecs(repos)` —— 经**真编译链** `OntologyCoreService.compileSpecs`
  （parse → deps 缓存 → 环检查 → put），不直注记录；id 确定性（`dspec_<specKey>`）、无时钟、
  重播幂等；只写 `derivation_specs` 表不碰对象（SY1 字节一致基线不受影响）。
- `apps/datacore/src/server.ts` / `apps/datacore/src/seed-cli.ts`：两条播种路径**同步**接线，
  紧随 `seedDemoSynthetic`（extractDeps 要解析随合成注册的 `model_demanded_by_order` 链路类型）。
- `apps/datacore/test/derivspec-seed.seam.test.ts`：对账接缝测试（6 例，见④⑤）。
- `docs/SYSTEM-ONTOLOGY.md` §8：`G-DERIVSPEC-EMPTY` → ✅已闭；
  `G-DERIVED-FORMULA-UNVERIFIED` 残口(a) DerivationSpec 维 → 已闭（残留 (b) metric_rollup
  第二口径与「公式本身对不对」两维照原标注）。
- **金丝雀计数断言同批改**：全仓 grep 核实 —— 基线上**没有任何**测试断言 demo 租户
  derivationSpecs 计数（仅 impact-propagation 自建租户的 3/0 与 change-impact 的 fixture 内世界），
  故无既有金丝雀需要改写；本单新测试自立「恰 9 条」金丝雀（现算值，非手抄预期）。
- 避让确认：`synthetic/battery.ts` 零改动（只读遵守）；`process-tick-coverage.seam.test.ts` 零改动。

## ④ 对账断言证据（测试 = 判据本体）

`test/derivspec-seed.seam.test.ts`（fixture 走 `POST /a/v1/synthetic/jobs` **生产种子管线本尊**）：
1. ① 共享读端非空：恰 9 条 ACTIVE · specKey 集合逐字对 · deps 缓存非空 · id 确定性 · 重播幂等不翻倍；
2. ② 逐实例对账：每条规格 × 全部目标实例（先证每类 >0 实例、合计 >100 防空气转），
   生产 `evaluate()` == 物化值（1e-9），不符清单必须为空；
3. ③ 消费点③端点级：`GET /a/v1/ontology/slices/order_fulfillment_360/layers` ⑭证据层
   真长出 `ds:order_value` / `ds:model_total_demand` / `ds:model_order_count`；
4. ④ 消费点②端点级：`GET /a/v1/process-definitions/P22/inspect`（承载 Model）⑭证据层
   真长出 `ds:model_total_demand` / `ds:model_order_count`；
   （消费点①认证装配与②③共享同一读端 `derivationSpecs.list(ACTIVE)`，
   其既有契约测试 sim-cert-contract-reconcile ③ 已证「读端有几条 ⇒ derivationNodes 就是几」。）

## ⑤ 变异实录（测试内真跑，非另开脚本）

- **M1 改坏一处**：`order_value` 公式覆写为 `this.qty * this.unitPrice + 1` ⇒
  对账扫描（与判据②同一 `reconcile()` 函数）必须非空且**全部**指认 `order_value @` —— 绿（咬住了）。
- **M2 清空**：9 条全部置 RETIRED ⇒ 共享读端回到 0 —— 绿（证明①的非空度量的是种子本身）。

## ⑥ 测试证据（命令 + RC + 关键输出）

```
cd apps/datacore && npx vitest run test/derivspec-seed.seam.test.ts --maxWorkers=1
RC=0 · Test Files 1 passed (1) · Tests 6 passed (6) · Duration 154.96s
```

相关回归批（12 文件 · 命令与 RC 见下「补记」）：
```
npx vitest run test/demo-lightup-seam.test.ts test/readyz-seeding-gate.test.ts \
  test/seed-demo-propagation.test.ts test/synthetic.test.ts test/synthetic-field-alignment.test.ts \
  test/process-inspect.seam.test.ts test/impact-propagation.seam.test.ts \
  test/change-impact-preview.seam.test.ts test/lever-binding-drift.test.ts \
  test/sim-cert-contract-reconcile.seam.test.ts test/slices-list.test.ts \
  test/slice-governance-full.test.ts --maxWorkers=1
```

## ⑦ 避让水位声明

- 跑 vitest 前探水位：`ps -eo args | grep -F "node (vitest" | grep -v grep | wc -l` = **10–11**（>3），
  `uptime` load averages **574–660**（机器被多 agent 打满）。按工单避让条款直接使用
  `--maxWorkers=1`，未等水位（等待 3 轮也不会改变他队并行事实）。证据：
  `12:48 up 4 days, 12:55, load averages: 574.45 572.62 638.75`（vitest=11）；
  `12:52 load averages: 660.58 629.41 646.37`（vitest=10）。
- 仅跑相关测试文件，未跑全量 `pnpm -r test`。

## ⑧ merge-tree 自测

见下方补记（命令 + 重定向文件 + `$?`）。

## ⑨ 补记（回归批与 merge-tree 结果）

**相关回归批**（④ 列出的 12 文件命令）：
```
RC=0 · Test Files 12 passed (12) · Tests 94 passed (94) · Duration 568.42s
```

**merge-tree 自测**（本分支直推集成线 tip 之后、无分叉，预期干净）：
```
git merge-tree $(git merge-base HEAD origin/claude/verify-reclaim-6) HEAD origin/claude/verify-reclaim-6 > /tmp/derivspec-mergetree.out 2>&1
$? = 0 · 输出 0 行（无冲突标记）
```
