# Q30-P1-Q01VERT · Live FDE 证据（接单挤占推演 + 多方案五维比较）——**re-scope 对齐·诚实无挤占是真答案 + 真紧约束基地证挤占机器**

> re-scope by review 2026-07-09·**用户批准(a)**·commit `54316bd`。返工#2（把 S26 默认 `qty` 抬到 520000 强逼挤占）已按 rescope **撤销**：
> 强求挤占 = 逼 dev 造假 = acceptance 错。本证据按 rescope 的 C1–C7 重跑，全部真起服务真跑真种子（scale=S·seed=42）、无手喂大数。
> 真起：
> `PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=<svc> node apps/datacore/dist/server.js`
> `PORT=4102 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=<svc> node apps/agentcore/dist/main.js`
> 日期 2026-07-10。dataMode=`SYNTHETIC`（SEED_DEMO 合成种子世界的诚实标注·求解值为确定性真计算·非兜底魔数）。

---

## re-scope 核心（用户批准）

前两次 BLOCK 根 = **数据场景量纲**使 changzhou Q01 结构性零挤占（自由日产能 4555 »» 出厂默认急单 dailyDemand≈120），
而「**自由产能足量承接·无需挤占**」本就是**真实答案**（displacedCount=0 是真答案·诚实空态·非失败非编造）。据实改：
- **C3/C4** 诚实接受无挤占（changzhou 默认路径）。
- **C7** 在**真种子里真有紧约束的真基地**证挤占机器真工作（非死代码）·**全用真参数·⛔不手喂大数**。

S26 场景卡默认已回退为诚实**出厂值 `qty=5000`**（`scenarios-catalog.ts` slotPresets）。

---

## 0️⃣ 场景默认量来源自证（qty 来自 S26 卡·非手打）

`GET http://127.0.0.1:4102/b/v1/scenarios` → S26.presetContext.slotPresets：

```json
{ "model": "4680-NCM", "qty": 5000, "advancePct": 0.2, "weeks": 6, "baseId": "changzhou" }
```

`qty=5000` 为**出厂场景默认值**（4680-NCM 一批常规接单问询量），非 invoke 时手打大数。

---

## C1 · Q01 NL→QOS 命中接单全链 workflow（非 fallback）· 真跑

从启动器（S26 presetContext）经 `POST /api/v1/queries` 提原问句
「4680-NCM 加 20% 六周插进来能不能接·会挤占哪些单·有哪些方案？」：

```
path = WORKFLOW    status = COMPLETED    intent = what_if_displacement_q
```

路径 A 全链（`what_if_displacement → multi_plan_compare`）真跑，非 generic 兜底。

## C2 · multi_plan_compare ∈ SOLVER_REGISTRY · 五维矩阵每方案非空

答案含五维比较矩阵 `comparison`：6 列 × 4 行（delay/outsource/split/downgrade）。schemeCount=3（delay/outsource/downgrade feasible；split 因认证线不足 2 条 不可行·诚实标注）。

## C3 · 真 Q01 · 真 seed · changzhou 自由产能足 → **诚实无需挤占**（displacedCount=0 是真答案）

changzhou `freeDaily=4555.14`、出厂急单 `qty=5000`（dailyDemand=120）→ `shortfallDaily=0`：

```
急单 4680-NCM ×5000（6 周）自由产能足量承接、无需挤占；3 个可行方案，推荐「延期在手单」。
高优先级最长位移 = 0 天
comparison（每行 displacedCount=0）：
  delay      免挤占直接承接    marginPct=13.5  cashOccupiedWan=275
  outsource  外协 0 单腾容      marginPct=11.5
  split      认证线不足 2 条(否) marginPct=13
  downgrade  自由产能足量承接   marginPct=13.5
Displaced Orders：无——该项在当前结果下无内容，不影响上表结果。
```

- **毛利 delta 真**：advancePct=0.2 侵蚀 → marginPct 由基准 15 → **13.5**（=15×0.9），与 rescope C3 预期一字不差。
- **诚实空态**：displacedOrders 明确「无」，非失败非编造。

## C4 · 逐单再方案仅当真有被挤单时出

changzhou Q01 无被挤单 → 逐单再方案诚实无（非结构缺陷·不算红）。真被挤场景见 C7。

## C7 · 真紧约束基地 hefei · realistic 急单即产挤占（⛔无手喂大数）· 证挤占机器真工作

真种子遍历 12 基地自由日产能（真 invoke `what_if_displacement`）：仅 **hefei** `freeDaily=0`（真紧约束）。
hefei + 4680-NCM + **默认 qty=5000（出厂量·非手喂）**：

```
feasibleWithoutDisplacement = false   freeDaily = 0   shortfallDaily = 120   totalDisplaced = 1   schemeCount = 3   recommended = downgrade
displacedOrders:
  SO-3415  pri=中  displaceDays=42  reSchemes=[
    "延期 42 天（违约金 924 万）",
    "拆单并行（半量转副线·缓 21 天·违约金 462 万）",
    "降级协商（缩量交付·免违约）"]
```

- **真单被挤**：SO-3415（真种子在手单）·中优先级·位移 42 天。
- **逐单再方案 ≥2**（C4）：3 个互异真实再方案（延期/拆单/降级）·确定性派生自本单真值·非填充。
- **挤占机器非死代码**：真种子上 realistic 急单即触发·全真参数·零手喂。
- S26 卡 baseId 槽切到 hefei 即在 UI 复现此真挤占（无需改任何默认）。

## C5 · R6 确定性 · 同输入同 seed 字节一致

changzhou 与 hefei 两条 invoke 均**重跑字节一致**（禁 random/时钟）。

## C6 · 4 包 build + test 绿

- datacore `query30-orch` **12/12**（含 ③挤占级联 feasibleWithoutDisplacement=false·highPriDisplaceDays=21、④C34 BLOCK、⑤免挤占直接承接、⑥认证线诚实回落）——挤占机器单测证明（CONTEND 受控 fixture·与 hefei 真种子证据互补）。
- agentcore `query30`+`scenarios` **14/14**（S26 默认 qty=5000 → grow 测 rings.data=true 非空非兜底）。
- 4 包 `pnpm -r build` 绿。

---

## 结论

- **打穿**（C1–C4·诚实）：Q01 NL→QOS 路径 A 全链真跑，changzhou 出厂默认 = 诚实「无需挤占·直接承接」（displacedCount=0 是真答案），毛利 15→13.5 真，五维矩阵/多方案齐。
- **挤占机器真实性**（C7）：hefei 真紧约束基地 + 出厂默认 qty=5000 → 真挤占 SO-3415 + 3 个真再方案，⛔零手喂大数，机器非死代码。
- **返工#2 撤销**：520000 强逼挤占的默认已回退为 5000·证据同步重写。
