# 评审复验 — WO-4 / WO-5 / WO-6（dev 提交 80e351a + d6ccb28）

> **角色**（铁律0.5）：审核方独立真跑复验（新构建 + 真启动 + curl 真 socket），非信 dev 单测/「✅」。
> **核发**：**WO-5 = 闭合 ✅ · WO-6 = 代码/单测正确但活体判据被 WO-4 阻断 ◐ · WO-4 = 打回 ❌（P0 回归：破坏 demo 启动）**。

---

## 🔴 WO-4 · 归域门收紧 14 域 enum（80e351a）= 打回 ❌（P0 回归）

**致命缺陷（审核方真跑发现·dev 单测漏掉）**：用**新构建** `SEED_DEMO=1` 真启动 datacore → **进程崩溃 Exit 1，demo 完全起不来**：
```
AppError: publish validation failed:
  Customer: 域 'commercial' 非法（须为 14 合法业务域之一：…sales…）
  ARInvoice: 域 'commercial' 非法
  Material / MaterialBatch / PurchaseOrder / CarbonFactor: 域 'supply' 非法
  at ModelingService.publishDraft (modeling.js:407)
  at SyntheticService.seedDemoOntologyViaChain → instantiateBattery → seedDemoSynthetic → main
```

**根因**：WO-4 把 `publishDraft` 归域门从「存在性」收紧为「∈ `BUSINESS_DOMAINS`(14)」，但**14 域枚举与合成电池种子实际使用的域名不一致**：
- 规范 14（`graphmeta.ts BUSINESS_DOMAINS`）：factory/product/process/equip/people/quality/capacity/forecast/**sales**/**material**/finance/plan/external/decision —— **无 `commercial`、无 `supply`**。
- 合成电池种子（`synthetic/battery.ts`）给 Customer/ARInvoice 归 **`commercial`**、给 Material/MaterialBatch/PurchaseOrder/CarbonFactor 归 **`supply`**。
- WO-4 前：门只判 `!domain||unassigned` → `commercial/supply` 放行、demo 正常播种。WO-4 后：`commercial/supply ∉ 14` → 种子 publishDraft 抛 VALIDATION_ERROR → **datacore main 崩、整站不可用**。

**为何 dev 单测没抓到**（绿测试≠能用典型）：`ontology-governance.test` 的 garbage 用例用最小 draft + 合法域 `product`，**从不跑真合成种子链**（`seedDemoOntologyViaChain`），故 commercial/supply 这条真实路径未被测试覆盖；`pnpm gates` 也不真起 `SEED_DEMO` 数据面。commit 称「真跑验」但**未含一次 `SEED_DEMO=1` 真启动**。

**连带阻断**：demo 起不来 → **WO-6 活体判据无法验**（需 demo 的常州/订单数据）。

**修复方向（dev 择优·审核方不实装）**：
1. **统一域分类法**：把合成电池种子的 `commercial→sales`、`supply→material`（核对 material 是否与既有 `material` 域语义冲突；若 supply≠material 则需在 14 里增 supply），使种子域 ⊆ 合法枚举；**或**
2. **枚举补全**：若 `commercial/supply` 是合法业务域 → 加进 `BUSINESS_DOMAINS`（成 15/16），与种子对齐；**或**
3. **种子路径宽限**：SYNTHETIC origin 的种子 publish 走 grandfather/告警而非硬 400（最不推荐，掩盖根因）。
- **必做回归门**：加一条「`SEED_DEMO=1` 真启动 + 合成种子 publish 全绿」的冒烟（CI 真起 datacore 而非仅单测），杜绝同类「种子域 vs 归域门」漂移复发。
- **FDE 真值判据（重验）**：① 新构建 `SEED_DEMO=1` 真启动 datacore **不崩、/healthz 200、对象浏览器 34 类型在**；② `setDomain('not_a_domain')→publish` 仍 400 VALIDATION_ERROR（垃圾域真被拒）；③ 无垃圾域。**①是新增硬门**。

## WO-5 · 连接器 test 反映真实可用性（d6ccb28）= 闭合 ✅

新构建真启动 + 真 curl（带合法 config 过必填校验 → 命中 `hasAdapter` 门）：
| 连接器类型 | 结果 |
|---|---|
| sap_erp / salesforce_crm / generic_jdbc / knowledge_base / external_feed | **ok=false · stub=true · 「该连接器类型尚无 adapter 实现，创建后无法同步」** ✓ |
| mock_erp（有 adapter） | **ok=true** ✓ |
判据全过——五类无 adapter 不再假绿、有 adapter 不误伤。单测 connectors `WO-5` 例绿。
> 过程注（FDE）：审核方初测**空 config** 得 ok=true（误判失败），实为**必填校验先于 hasAdapter 门** + 当时跑**旧 dist**（源已 d6ccb28、dist 未重建）双重假象；**重建 dist + 带合法 config** 后判据真过。教训：复验前必 `pnpm --filter datacore build`（源同步≠dist 同步）。

## WO-6 · growth/probe 轮询预算覆盖 LLM 时延（d6ccb28）= ◐ 代码/单测正确·活体被 WO-4 阻断

- **代码确认**：`server.ts` `PROBE_MAX_POLLS=180 × PROBE_POLL_INTERVAL_MS=500ms ≈ 90s`（覆盖 Kimi 时延上界，原 5s）；超预算仍非终态 → 诚实返「仍在推演」（`verdict:BOUNDARY`·非 blocking·非 gap），不再误判 BLOCKED。符合 spec。
- **单测**：`growth-probe.test` 9/9 绿（含「POST /growth/probe 路径B → GapReport BOUNDARY」）；agentcore 349 全绿。
- **❌ 活体 FDE 判据未验**：「`growth/probe` 可答问句『常州基地影响哪些订单？』→ 非 BLOCKED、与 scenarios/launch 一致」**需 demo 数据面**，而 **WO-4 回归致 demo 起不来 → 阻断**。**待 WO-4 修复后审核方一次性补验**。

---

## 核发结论
- **WO-5 ✅ 闭合**。
- **WO-6 ◐**：代码与单测正确，活体待 WO-4 修复后补验（非 WO-6 本身缺陷）。
- **WO-4 ❌ 打回**：P0 回归，新构建 `SEED_DEMO=1` 真启动崩溃、demo 整站不可用——必须先修（域分类法对齐 + 加 SEED_DEMO 启动冒烟门），再连同 WO-6 一并复验。
- 待 dev 清单新增 **WO-4-FIX（P0）**；原 WO-Q1/1C/A6-T2 不变。
