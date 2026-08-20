# HANDOFF · WO-AUDIT-TIMELINE-LIVESOURCE（断点 G-AUDIT-TIMELINE-HASH-PROJECTION 数据半）

- 分支：`claude/handoff-wo-audit-timeline-livesource`（一次性 SSH URL 推·remote 未改）
- 基线：`origin/claude/verify-reclaim-6` @ `e1694f00fdfab62e83f96e37ae9660be974e92a1`
- 范围：`solvers/risk.ts auditTimeline` · A8 时序源（tsPoints）· 契约 `AuditTimelineOutputSchema`（仅加性）
- 病灶：`auditTimeline` 的 series/peak/crossDay 曾 100% 由 `hashString(kind)` 形状投影——同一 kind 恒同一条线、改 kind 名线就变、与真实数据无关。

## 1 · 真源取证清单（基线代码实测）

A8 现有日序列（`apps/datacore/src/synthetic/battery.ts` tsGenerators + `simclock.ts`）：

| seriesKey | entityType | grain | 量纲 | 备注 |
|---|---|---|---|---|
| `oee:equip` | Equipment | day | 0-1 | 含检修/周末效应 |
| `yield:process` | Process | day | 0-1 | 含检修效应 |
| `output:line` | Line | day | 绝对量 | 含周末/检修/爬坡 |
| `attainment:line` | Line | day | 0-1 | 产线达成率 |
| `util:line` | Line | day | ~92 | 含检修效应 |
| `attainment:base` | **Base** | **day** | **0-1** | 基地日达成率=实际/目标（CL.5·含检修/周末/爬坡） |
| `forecast_dev:model` | Model | tick 才写 | — | 非日粒度历史，出局 |

9 个审计 kind 逐一对拍（语义 + 粒度 + 量纲三条件全过才收编）：

| kind | 真源判定 | 结论 |
|---|---|---|
| 产销 | `attainment:base`（基地日达成率·day grain·0-1）——语义直对产销达成率 | ✅ **接真源升 LIVE** |
| 爬坡 | 无独立爬坡序列（ramp_curve 只是 attainment/output 的生成期剧本效应，非独立口径） | MOCK 保持 |
| 毛利 | 无逐日毛利序列（Segment.gmRate 静态快照） | MOCK 保持 |
| 齐套 | 无逐日齐套序列（Shipment 静态快照 + hash 量化到货事件） | MOCK 保持 |
| 现金 | 无逐日现金序列（ARInvoice 静态） | MOCK 保持 |
| 份额 | 无逐日份额序列（market_share 诚实合成种子·无市场规模真源） | MOCK 保持 |
| 外协 | 无逐日外协序列 | MOCK 保持 |
| capex23 | 无逐日 capex 序列（CapexProject 静态） | MOCK 保持 |
| struct | 结构聚合口径·无对应日序列 | MOCK 保持 |

纪律遵守：没有把任何 MOCK 降级冒充 LIVE，也没有为了升 LIVE 硬造数据源——9 选 1 是取证结论，不是指标。

## 2 · 接线清单

- **LIVE 升档**：`产销` → `attainment:base` / measure `attainment`。
- **MOCK 保持**（诚实披露不动）：`毛利` `齐套` `现金` `份额` `爬坡` `外协` `capex23` `struct`。
- 映射单一出处：`packages/contracts/src/audit-timeline.ts` `AUDIT_KIND_LIVE_SOURCES`（R14·引擎零映射硬编码；文件头含本清单全文）。
- 加载按需：`service.ts` `AUDIT_TS_SOLVERS={"audit_timeline"}` + `withAuditTs` loadContext 选项——仅 audit_timeline 调 tsSeries/tsPoints 仓储，其余求解器零 ts 调用；`SolverContext.auditTsDaily` 为加性 optional（缺省 → MOCK 半向后兼容 R6）。

## 3 · LIVE 半派生语义（判据形态说明）

真源语义下 `series = f(真 tsPoints)`，**kind 名零参与**：

1. 同日跨基地算术均值 → 取最近 `min(horizon, 可用天数)` 天真窗口（只有真数据的日子·不臆造补齐）；
2. 短差投影：`tension = clamp(round(40 + (target − v) × k), 40, 97)`——target=`GOAL_REGISTRY.demand_attain.target`(=1)·k=200（标定依据：日均 0.918→≈56 正常带 / 周末 ×0.88→≈78 关注带 / 检修窗 ×0.72→≈97 越线带；这是**显示带投影系数**，业务报警阈仍是 `Metric.floorVal`=95·另一个平面，不冒称）；
3. peakDay=argmax、stages/crossDay 由真序列派生；repBase = 窗口内真均值最差基地（同差 baseId 升序·R6），不再是 kind 哈希选基地；
4. `dataMode:"LIVE"` + `source:{seriesKey,measure,days}` 披露（R13）+ `provenanceSynthetic` 照 `tsSeries.origin` 如实标（demo 合成世界 SYNTHETIC→true·measurement/provenance 两维正交·不谎报实测）。

**改名判据的断言形态**（WO 要求按真源语义定）：同一真源数据换一个 kind 名 ⇒ 除 echo 的 `kind` 字段外**全量输出字节一致**（含 series/peak/crossDay/stages/events/affectedOrders/source/note）。旧病灶下 `hashString(新名)≠hashString(旧名)` ⇒ series 必变 → 红。见测试 A2。

## 4 · 契约 diff（additive 证据）

`packages/contracts/src/solvers.ts` `AuditTimelineOutputSchema` 仅加一个 optional 字段：

```ts
source: z.object({ seriesKey: z.string(), measure: z.string(), days: z.number().int() }).optional(),
```

既有字段（kind/series/stages/peak/crossDay/threshold/dataMode 枚举/provenanceSynthetic/note/events/affectedOrders）零改动零删除；`dataMode` 枚举本就含 `"LIVE"`，未扩枚举。新文件 `audit-timeline.ts` 为纯新增导出（`index.ts` 加一行 `export *`）。契约改后已 `pnpm --filter @platform/contracts build`（绿）再测。

## 5 · 提交序列

| commit | 单元 |
|---|---|
| `5a484b225` | 契约半：`audit-timeline.ts` 新文件 + `index.ts` 导出 + `solvers.ts` 加性 source 字段 |
| `67a25f73f` | 引擎半：risk.ts LIVE/MOCK 两半 + service.ts 按需加载 + types.ts 加性字段 |
| `31fdc2ae5` | 门⑤兼容：披露字段改分支字面量形态（行为不变·`dataMode:"MOCK"`/`provenanceSynthetic:true` 字面钉死在 MOCK 分支） |
| `703593e89` | 验收测试 4 条 + 本体 §8 行回写 |

## 6 · 测试证据（命令 + RC + 关键输出）

构建：`pnpm --filter datacore build` → **RC=0**（前置：`@platform/llm-adapters` dist 缺失先补建·与本单无关）。

门：`node scripts/check-genuine-sim.mjs` → **RC=0**（⑤ audit_timeline 哨兵过·全文 "✓ genuine-sim:check 通过"）。

相关套件（禁全量 `pnpm -r test`·只跑 5 个相关文件）：

```
npx vitest run test/audit-timeline.test.ts test/timeseries.test.ts test/simclock.test.ts \
  test/risk-perfactor-series.test.ts test/risk-tension-clamp.test.ts
```

首跑（2026-08-19 11:41 起·负载 600+）：**RC=1**——audit-timeline **9/9 绿**（5 既有 + 4 新增全过）、timeseries 5/5、risk-perfactor-series 2/2、risk-tension-clamp 3/3；simclock T6-T9 四例 **180s 测试超时被杀**（超时点在 `seedBattery` 阶段·非断言红·与本单改动路径无关——simclock 不消费 auditTimeline/auditTsDaily）。

新增断言原文（全绿）：

```
✓ A1 接缝：产销 → dataMode LIVE + source 披露 attainment:base + series 为真逐日数据
✓ A2 验收判据：同一真源数据换 kind 名 ⇒ series 逐字节相同（不再由 hashString(kind) 派生）
✓ A3 独立 oracle：series 逐日 = clamp(round(40+(target−当日跨基地均值)×k),40,97)（映射表实参·非引擎自证）
✓ A4 MOCK 半不回退：无真源 kind（毛利）仍 dataMode MOCK + 哈希投影披露 + 无 source 字段
```

simclock 单跑复验（`--maxWorkers=1 --testTimeout=600000`·排除纯环境超时）：**RC=0 · 4/4 全绿**（Duration 745s·T8 单例 306s——首跑 4 红确认为纯负载超时，非断言失败）。至此 5 个相关文件全绿：audit-timeline 9/9 · timeseries 5/5 · risk-perfactor-series 2/2 · risk-tension-clamp 3/3 · simclock 4/4。

## 7 · merge-tree 自测（重定向文件再取 `$?`）

```
git merge-tree --write-tree origin/claude/verify-reclaim-6 HEAD > /tmp/atl-mergetree.out 2>&1
MERGETREE_RC=0
```

输出仅 tree OID（`7a74464c…`）·零冲突段 → 对基线干净可并。

## 8 · 负载避让水位申报

- 跑 vitest 前探针 `ps -eo args | grep -F "node (vitest" | grep -v grep | wc -l`：首轮 **10**（>3）→ 等 3min×3 轮：10→7→4→**2**（≤3 放行）。
- 首跑期间 `uptime`：`up 4 days, 11:48, load averages: 558.38 618.81 633.37`（机器长期红区）。
- simclock 复跑前水位仍高（6>3·load 681/705/683）→ 按 WO 降级 `--maxWorkers=1` 单跑。
- 复跑结果：`npx vitest run test/simclock.test.ts --maxWorkers=1 --testTimeout=600000` → **VITEST_RC=0**（`Test Files 1 passed (1)` · `Tests 4 passed (4)` · Duration 745.00s）。

## 9 · 边界与遗留

- LIVE 半窗口 ≤90 天受种子历史长度约束（`historyDays=90`）；真世界 CONNECTOR 源天数任意，窗口取 `min(horizon, n)`。
- 其余 8 kind 的 MOCK 哈希投影**一行未动**（门⑤ 字面量仍在 MOCK 分支）；将来任一种类补到真日序列，只需在 `AUDIT_KIND_LIVE_SOURCES` 加一行（target/k 须在该表注释里写标定依据）。
- `forecast_dev:model` 为 tick 粒度未收编；若未来补日粒度物化，可按同一映射表机制评估收编。

## 10 · 复验退修记录（2026-08-20）

- **退**：A3 oracle 数据通路独立（直读仓储重算 ✅），但投影参数 `src.target`/`src.k` 从被测实现消费的**同一映射表**读取——复验方亲手变异 contracts `k:200→201` + 重建 dist ⇒ A3 仍绿，咬不住映射表常数本身（oracle 与被测实现一起漂）。
- **修**（`apps/datacore/test/audit-timeline.test.ts` A3·行级）：重算前钉住映射表常数字面量 `expect(src).toMatchObject({ seriesKey:"attainment:base", measure:"attainment", target:1, k:200 })`，oracle 公式常数同步内联字面量（target=1·k=200·显示带 [40,97]）——契约取值本身入断言，oracle 与被测实现零共享取值路径。
- **自验**：① 变异 `k:200→201` + `pnpm --filter @platform/contracts build` ⇒ A3 **红**（RC=1·失败点正是 toMatchObject 钉）② 恢复 k=200 重建 ⇒ `npx vitest run test/audit-timeline.test.ts` **9/9 绿**（FINAL_RC=0·Duration 51.76s·跑前水位探针 vitest=2·load 37.71/87.02/265.57，水位回落故未降级 maxWorkers）③ commit+push 同分支。
