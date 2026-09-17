# WO-SIM-READ-SLICE · 让传导沿本体切片走，系数不再靠填

**状态**：待派（等一个 dev 席位释放；本单**重**画像，跑 datacore vitest）
**来历**：仓主 2026-09-17 —— 「**本体切片不就是解决『传导』的推演吗**」「**你只需要建立完成的本体切片，自然就解决了**」

---

## §1 病是什么（全部实测，非推测）

### ① 传导引擎今天不读切片

`apps/datacore/src/sim/` **全目录 `sliceKey` 只有 1 处命中**，在 `disclosure.ts:293`（**披露层** —— 报告「走过哪个切片」），**遍历层零命中**。
**金丝雀**：同目录 `coefficient` 命中 **29** ⇒ 查法有效，是它真的不在。

⇒ 今天的「传导」读的是一张**独立的规则表**，与本体切片是两套东西。

### ② 而切片里那条路径是现成的

`apps/datacore/src/synthetic/battery.ts:4234` 的 `order_to_material_bom`：

```
Order → OrderLine → Model → ProductVersion → BOMHeader → BOMDetail → Material → Supplier
                                              project: quantity, lossRate   project: unitPrice
```

**成本式 `quantity × unitPrice × (1 + lossRate)` 的每一项，这条切片都已经投影出来了。**

### ③ 已经有一条边证明这条路能跑

`seed.ts` 的 `weightRef: { basis: "bom_cost_share" }` → `sim/pair-weights.ts:254`：真的去算 BOM 占比。
**铝箔 0.920% / 磷酸铁锂正极 17.815% —— 这两个数不是谁判的，是图算出来的。**

现状：`weightRef` **49 条 / 43 条 null**（非 null 6 条，4 种 basis）；`coefficientRef` **47 条全 null**。
**机制已存在、已验证、只铺了 6/49。**

### ④ 但它不走切片那条链 —— 这是本单的核心分歧

`pair-weights.ts` 用的 `selectEffectiveBom`（`apps/datacore/src/bom.ts:48`）是**按属性平铺匹配**：

```ts
const mine = headers.filter((h) => str(h.modelId) === modelId);
const header = mine.filter((h) => str(h.status) === "量产").sort(byBomId)[0] ?? ...
```

而切片走的是**链路** `version_belongs_to_model(in) → bom_belongs_to_version(in)`，**过 ProductVersion**。
切片自己的注释写着：

> 「`BOMHeader.modelId` 是**属性**不是链路，照属性猜着连就是造一条悬空边」

**⚠ 这是真分歧，已被独立实测证实**（WO-SALES-RING dev，2026-09-17）：
**6/6 型号都有 >1 份 BOM 头**（4680-NCM 2 · 4680-LFP 2 · 2170-NCM 2 · 方形-LFP 3 · 方形-NCM 3 · 圆柱-LFP 3；共 15 头 / 105 行）。
`selectEffectiveBom` 取「量产 + bomId 最小」⇒ **恒选 V1.0**，**V1.1（量产）与 V2.0（试产）永不入选**。
金丝雀：已知型号 →2 ✓、假键 `__no_such_model__` →0 ✓。

⇒ **「这个型号的 BOM 是哪一份」今天有两个答案。** 两套真相源。

### ⑤ 还有一台现成的推理机没接上

`apps/datacore/src/ontology/query-engine.ts:117 runOntologyQuery`（306 行）四段齐全：
① `planSlice` 确定性 BFS 求最短路（maxHops 8）· ② R12 闭包校验，断了抛 `NoQueryPlanError` **不编造** ·
③ **`overrides` → `recompute(dryRun)` → before/after deltas**（注释原文 `generic_inference fallback / what-if`）· ④ 逐行 `linkPath` 溯源 + 聚合。

**src 调用方只有 1 处**（`solvers/service.ts:1572`，求解器 `ontology_query`）。`sim/` 遍历层**零调用**。

---

## §2 要做什么

**把 `pair-weights.ts` 的 basis 计算，从「手写 `byType` + 属性 join」改成「声明一条 slice path，引擎照走」。**

不是新造一层，是让两条已经存在的线接上：**切片声明路径 → 引擎照走 → 比例现算**。

落地后：**新增一条加权边只需要写路径，不需要写代码，也不需要任何人判系数。**

### 分三步，每步独立可验

| 步 | 做什么 | 判据 |
|---|---|---|
| **1** | 把 `bom_cost_share` 这一支改成走切片/`runOntologyQuery` 拿投影 | **两法同值**（见 §3 判据 1） |
| **2** | 若两法**不同值** ⇒ 那就是 ④ 那条分歧的落点。**停手报出来**，由仓主裁「以链路为准还是以属性为准」 | 报告给出差异清单 |
| **3** | 其余 3 种 basis（`source_qty_relative` / `source_value_relative` / `actor_exposure_relative`）同法迁移 | 逐 basis 重复判据 1 |

---

## §3 验收判据（⛔ 写不出对照实验 = 本单没法验收）

**判据 1（头号·同值对照）**：同一条边，**一条走 `runOntologyQuery` 声明的路径、一条走今天的手写 join**，两法必须给出**同一个数**。
- 给不出同一个数的那几条，**就是今天两套真相源已经分叉的地方** —— 逐条列出来，**别自己挑一个**
- 已知必然分叉的样本：多版 BOM 的 6 个型号（见 §1 ④）

⚠ **这条判据不需要读一行代码就能设计** —— 它来自「同一个问题不该有两个答案」这个常识。

**判据 2（业务量·四数）**：`磷酸铁锂正极 +15%` 与 `铝箔 +15%`，各取修前修后。
今天的基线（2026-09-03 修复后）：**1.736965383896 / 0.089692584529**（拉开 19.37×）。
迁移后这四个数**必须逐位不变** —— 变了就是迁移改变了行为，不是重构。

**判据 3（变异反证）**：把切片路径里**去掉一跳**（如 `bom_belongs_to_version`），确认判据 1 **当场红**。
不红 ⇒ 说明引擎没真走那条路径，退。

**判据 4（诚实边界）**：`runOntologyQuery` 的 `NoQueryPlanError` 必须**原样冒上来**，⛔ 不许 catch 成静默回落到手写 join。
**「算不出来」要红，不许悄悄换一条路算出一个数。**

---

## §4 🚦范围边界

**只碰**：`apps/datacore/src/sim/pair-weights.ts` · `apps/datacore/src/sim/propagation-inputs.ts` · `apps/datacore/test/`
**不碰**：`propagation.ts` 的公式 · `contracts` · `battery.ts` 的切片定义（本单只**读**它）· `seed.ts` · 前端
**⛔ 不新增门 / 不新增棘轮 / 不新增基线 JSON**（2026-08-20 冻结令）

---

## §5 本体引用与影响

- **对象类型**：`Material` · `Model` · `ProductVersion` · `BOMHeader` · `BOMDetail` · `Supplier` · `Order` · `OrderLine`
- **链路**：`order_has_line` · `orderline_for_model` · `version_belongs_to_model` · `bom_belongs_to_version` · `detail_belongs_to_bom` · `detail_uses_material` · `material_supplied_by`
- **切片**：`order_to_material_bom`（本单的路径来源）
- **不变量**：**R6 确定性**（同输入同参数版本同输出 —— 迁移后判据 2 四数必须逐位不变）· **R12 双向闭包**（`runOntologyQuery` 已强制）· **R14 引擎零业务常数**（本单是在**加强**它：把常数换成图算）
- **断点**：本单收的是「传导与本体各走各的」这条缝；若落地，需回写 `docs/SYSTEM-ONTOLOGY.md` §3 链路段与 §8

---

## §6 派单时必须附的纪律

- **开工第一条命令 = 建分支 + 空提交 + push**，之后每改完一个文件就 commit+push。⛔ 绝不推 canonical
- **环境前置**：`pnpm install --prefer-offline` && `pnpm --filter @platform/contracts build`
- **CPU 避让**：数「父进程不是 vitest 的 vitest 进程」（每棵树只算根）。空闲报 0 / 单 run 报 1，报 ≥2 是量法坏了
- **前提是线索不是结论**：本文件的 file:line 与数字**都可能已漂**（`seed.ts` 近日被多个 dev 改过）。开工第一件事是重测；实测发现已做，**停手顶回来，改台账不改代码**
