# HANDOFF · WO-OEE-SSOT-C · 三套 OEE 口径归一（接手收尾轮）

- 分支：`claude/handoff-wo-oee-ssot-c`（rebase 前 `52324588`，接手后 rebase 到集成线 tip `7c52b9b4` 并 `--force-with-lease` 推回）
- 画像：重 ｜ 断点：`G-OEE-DUAL-TRUTH`（已闭）+ 新登 `G-OBJECTS-QUERY-1000-CAP`（🔴 残账）
- 接手时状态：前一 dev 留了 3 提交 / 2 文件 / +53 行（占位 + battery.ts 注释订正 + DECISION §8 复核记录），核心执行已由 WO-OEE-UNIFY 落地并入集成线（`8d70bcdb`，且是旧分叉点 `2a1a412b` 的祖先）。分支基线落后 204 提交（check-branch-base RC=1）⇒ 按处置原样 rebase，**相对基线的结论全部在本轮重量**。

---

## ① 实测数（自己跑的，不转述）

**接手复核（2026-08-19 · rebase 后基线 `7c52b9b4` · esbuild bundle 直接 import 生产源码 `generateBattery(42,"S")`，金丝雀先行）**：

| 断言 | 实测 | 判 |
|---|---|---|
| 金丝雀 A：`entityRefFieldOf("Equipment")==="equipId"` | 中 | ✓ 工具没瞎 |
| 规模金丝雀：设备 780 台 · EquipmentOEE 5460 行 | 780 / 5460 | ✓ |
| 单一出处：780/780 台 oeeA/oeeP/oeeQ/oee_current === 事实行 7 日均值 | mism=0 | ✅ |
| 事实行自洽：oee=a×p×q 例外 | 0/5460（容差 1e-3） | ✅ |
| 三套口径最差设备 | ①②③ 同为 `LINE-WS-xinyang-formation-coating-E1` | ✅ 归一成立 |
| 最差10台重叠 | ①∩②=9/10 · ①∩③=9/10 · **②∩③=10/10** | ⚠ 与前一 dev 对不上，见下 |
| ①②残差（协方差级） | mean=0.000555 · max=0.002790 | ≤0.003 成立 |
| `oee_daily_7d` 规格 | 不在 `BATTERY_TS_AGG_SPECS`（5 规格键逐一点名） | ✅ 单一写入方 |

**顶回前一 dev 的一处数**：§8.2(b) 记「①∩③=10/10 · ②∩③=9/10」，我实测为「①∩③=9/10 · ②∩③=10/10」。
且 ②∩③=10/10 是**必然**（mism=0 ⇒ ②③两表逐台相等，top10 必全同），前一 dev 的 ②∩③=9/10 自相矛盾——
边界并列（#10 处等值）下排序稳定性的伪差异，以我的为准。

裁决前三个数（0.769233 / 0.710781 / 0.776429 · 0/0/1 · 0.0814 · 731/780）：前一 dev 已在 `092c6635` 树上
逐条复现对账（DECISION §8.2(a)），该测量自足、不依赖基线新旧，本轮未重做（check-branch-base 的处置原话：
「自足的结论不受影响，重做是浪费」）。

## ② 改法与论据

本单是**收尾轮**，不是重做轮。执行半（WO-OEE-UNIFY）已在集成线：单一出处 `equipmentOeeAtomsDaily` ·
`oee_daily_7d` 规格已撤 · 播种期回填已删 · `PROP_DISPLAY_NAMES` 四属性标「事实表7日均值」。
本分支的增量只有三件事：

1. **`battery.ts:1088` 注释订正**（前一 dev 留，rebase 后仍必要：集成线该行仍是「时序 7d 加权物化」，
   与同文件 2988 行撤除记账自相矛盾）。
2. **DECISION §8「裁决已执行，执行到什么程度」**（前一 dev 的复核记录，本轮逐条复核后保留 + 两处订正：
   残账指针给出断点键、定性从「属 views/sim 边界」订正为「伤口在 app.ts/ontology.ts 查询层」）。
3. **补登 `G-OBJECTS-QUERY-1000-CAP`**（本体 §8 新行）：前一 dev 称「分页残账已挂本体 §8」，grep 无登记，
   **声明不实**。债本身实测为真（`GET /a/v1/objects` 写死 1000 · `objects/query` limit≤1000 · 5460 行只拿 18%），
   但物理拓扑屏已绕走 `/objects/aggregate`（服务端全量读）⇒ 屏上数不假，伤口留在「逐行消费大表」通道层。

为什么不是别的改法：①②从③派生**不许本单重做**——重做等于在集成线已闭合的断点上开第二条路；
本单的职责是复核 + 收口 + 如实挂账，与工单「你是唯一的重画像单」定位一致。

## ③ T1–T5 实测输出原文

**T1 变异反证（红对地方）**：把原 `oee_daily_7d` 规格（取自 `092c6635^` 原文）临时加回 `BATTERY_TS_AGG_SPECS`（= 恢复第二写入方），单文件复跑 **MUTANT_RC=1，S1–S4 当场红、S5 不受影响**（它只验标注）：

```
× S1 单一出处  AssertionError: expected 0.738563 to be 0.855   ← 红在 test:50「oee_current 被时序覆写、与事实行均值脱钩」
× S2 端到端    AssertionError: expected 'LINE-WS-jinhua-slitting-winding-E1' to be
               'LINE-WS-xinyang-formation-coating-E1'            ← 红在 test:77，且复活的就是裁决前②的那台设备（因果证据）
× S3 单一写入方 AssertionError: expected true to be false        ← 红在 test:90「specKeys.has('oee_daily_7d')」
× S4 唯一出入口 AssertionError: expected 0.738563 to be 0.855    ← 红在 test:112「equipmentOee() 与事实表脱钩」
✓ S5 屏上标注（不受影响，它只验 displayName 标注）
Tests 4 failed | 1 passed (5)   MUTANT_RC=1
```

没有一处红在「函数不存在/组件不见」——四条全红在「oee_current 与事实表脱钩」这条被证命题上。

**还原后复跑 + 邻接金值套件**（6 文件一轮 + 3 文件最小范围重跑）：

```
第一轮（6 文件同跑，机器 6+ vitest 并发）：
  ✓ oee-ssot.seam.test.ts 5/5（还原后归一态恢复，MUTANT 的四条红全部回绿）
  ✓ derive-fields.test.ts 5/5 · ✓ demo-chain-provenance.test.ts 2/2
  × gap-attribution / order-dependent-pick / timeseries 各红 1 例 —— 全部是
    「Test/Hook timed out in 180000/240000ms」（指针落 it()/beforeEach 行，
    seedBattery 在并发下超预算），无一条 AssertionError
第二轮（最小范围只重跑这 3 文件）：3 文件 31/31 全绿 RERUN_RC=0
合计：6 文件 74 例全绿（分两轮），三轮红全部为负载超时且同代码复跑回绿
```

**T2 基线**：本分支 diff（vs 集成线 tip `7c52b9b4`）= battery.ts **注释** 1 行 + DECISION §8 +52 行 + 本体 §8 新行 2 行
（55 insertions / 1 deletion，deletion 即那行过期注释）⇒ **零行为改动**，基线不可能漂移。
邻接金值套件实测见 T1 末段（6 文件 74 例全绿）。typecheck `tsc --noEmit` RC=0。

**T3 金丝雀**：复算脚本金丝雀 A/B（引用字段名 · 规模 780/5460）先行全中，见 ① 表前两行。

**T4 基线 diff 方向**：不动任何 `scripts/*-baseline.json`；唯一 src 文件改动是注释替换（1 删 1 增，同义订正），
无判据升降。

**T5 交单三条**：

```
git status --porcelain                                          → 空（本提交后）
node scripts/check-branch-base.mjs HEAD --onto=origin/claude/verify-reclaim-6 → RC=0（分叉点=集成线 tip，0 落后）
node scripts/check-merge-conflict-markers.mjs                   → RC=0（金丝雀 7/7）
```

**环境留痕（诚实登记）**：首跑 seam 5 例中 S1 红一次——失败指针落在 `it(` 行（非 expect 行）、
该跑 transform+collect 耗时 1032s（机器 12 个 vitest 并发），**同代码复跑 5/5 绿（472s）** ⇒
判负载抖动超时，非真红。vitest 探针连续 12 轮 >3（36 分钟），按六铁规「最小范围重跑」只跑单文件。

## ④ 基线变化

无。不动任何 `scripts/*-baseline.json`、不加门、不改判据表。

## ⑤ 与其他 dev 文件重叠

`git log --oneline -5 -- battery.ts DECISION-oee-ssot.md SYSTEM-ONTOLOGY.md`：除本分支提交外均为集成线
merge，无并行冲突面。`views/sim/physicalTopology.ts` 只读未碰（4 个 dev 在动）。

## ⑥ 没做的部分 + 差什么 + 可派的具体单

1. **`G-OBJECTS-QUERY-1000-CAP`（🔴 已挂账）**：`GET /a/v1/objects` 写死 1000 / `objects/query` limit≤1000
   vs 大行数事实表 ⇒ 逐行消费路 18% 封顶。修法 = 查询层分页通道（app.ts/ontology.ts），与
   `G-YIELD-SERIES-SOURCE-MISMATCH` 的「SolverContext 无时序通道」同类（缺数据通道，非改两行）。
   可派 **WO-OBJECTS-QUERY-PAGING**（datacore 侧，契约 limit 夹与路由写死值两半一起）。
2. **TRACE 第 2 条指针过期**：`docs/REQUIREMENTS-TRACE.md:238` 仍写「G-OEE-DUAL-TRUTH（§8·🔴 未修）」，
   本体早已 ✅——归 TRACE 维护方，本单边界外（未碰），如实登记。
3. **裁决前三数的复现未重做**：自足测量不依赖基线（前一 dev §8.2(a) 已留全表），如需三手可派轻画像复测单。
