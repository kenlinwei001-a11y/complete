# HANDOFF · WO-YIELD-SERIES-TS-SOURCE（断点 G-YIELD-SERIES-SOURCE-MISMATCH）

- 基线：`origin/claude/verify-reclaim-6` @ `e1694f00fdfab62e83f96e37ae9660be974e92a1`
- 分支：`claude/handoff-wo-yield-series-ts-source`
- worktree：`.claude/worktrees/agent-a57db15fe08022f38`（含 agentId 核验 ✓）

## 1. 取证清单（基线实测，非照抄工单）

| 项 | 实测 | 证据 |
|---|---|---|
| `yieldDiagnosis` 的 series 从哪来 | **无源**：`deriveExtendedArgs case "yield_diagnosis"`（`apps/datacore/src/solvers/extended.ts`）在无 `series` 入参时只回 `{processKey, baseName, provenanceSynthetic:true, ...args}`，**不产 series** ⇒ `yieldDiagnosis` 走 `series.length===0` 分支返 `dataMode:"EMPTY"` + note | extended.ts `yieldDiagnosis` EMPTY 分支 + derive case |
| 与工单声称的 A8 `yield:process` 时序源同源/错位 | **错位（没接线）**：A8 时序链真实存在且数据充足（见下行），但 SolverContext 无时序通道、`deriveExtendedArgs` 是同步纯函数摸不到 tsPoints ⇒ 序列永远到不了求解器 | 本体 §8 该行原裁决与实测一致 |
| tsGenerators→generateHistory→tsPoints 实际落多少天 | `HISTORY_DAYS = 90`（`synthetic/service.ts:55`）；`generateHistory`（同文件 525 行起）对 `battery.ts` tsGenerators 每条 series × 每实体写 90 个日点；`yield:process` = Process 实体 · grain=day · mean 0.952/noise 0.008 · `maint_window_dip`（检修窗内 ×0.72） | `synthetic/service.ts:525-571`、`synthetic/battery.ts:2963` tsGenerators、`tsgen.ts:73` dip |
| 哪些基地 ≥37 天 | 全 13 基地 × 每基地 10 线 × 串行工序：每个 Process 实体 90 天 ⇒ 按 (基地, 工序名) 聚合后**每个基地每个工序都是 90 天**（≥37）。种子数据里不存在 <37 天的基地；「序列不足保持 EMPTY」由注入闸的 37 天下限守住（变异 B 验） | seed 结构（`battery.ts:4065-4082` 每线每工序一个 Process）+ simclock.test.ts:44 实测 `yield:process` 58500 点 |
| 突变检测循环进入条件 | `for (let i = 30; i + 7 <= sorted.length; i++)` ⇒ **len ≥ 37 才进循环**；`sd > 0` 另一条件（实测常数序列靠 FP 残差 sd≈1e-17>0 也能触发，见 HANDOFF §5 注） | extended.ts yieldDiagnosis 循环 + node 复算实录 |
| 对象层备选源（取证单原方案）为何不行 | `QualityLot.inspectDate` 全库仅 20 个不同日期、逐基地 8–14 天（本体 §8 该行复核结论），接它 = 把诚实 EMPTY 降级成 `LIVE+breakpoint:undefined` 的假"查过没异常" | 本体 §8 G-YIELD-SERIES-SOURCE-MISMATCH 行（与本次实测一致，未推翻） |
| S12 场景卡实参 | `{ processKey:"涂布", base:"" }`（`apps/agentcore/src/scenarios-catalog.ts:94`）——base 是空串死键；本单注入认 `baseName`（derive 侧既有键名），空 base 不影响 | scenarios-catalog.ts:90-94 注释段 |

## 2. 根因一句话

`yield_diagnosis` 的逐日良率序列从未接线：真源（A8 时序 `yield:process`，90 天/工序实体）在 tsPoints 子系统里，而求解器上下文是同步纯函数、没有时序通道——属「没接线」，且唯一够长的源只有这一条。

## 3. 修法（按本体 §8 该行原裁决的两条路之一）

- `apps/datacore/src/solvers/service.ts` 新增 `injectYieldDiagnosisSeries(tenantId, args)`，在 **async 入口** `invoke()` 与 `runWithParams()` 按 `solverKey === "yield_diagnosis"` 预注入 `args.series`：
  - 调用方直传 `series` ⇒ 不注入（加性 R6）；
  - 过滤维：`processKey → Process.name`（缺省 "涂布"），`baseName → Base.name/baseId → Process.baseId`；基地给了但解析不到 ⇒ 不注入（不拿全域冒充该基地）；
  - 同 (基地,工序) 多实体同日取均值（确定性：ISO 日期字典序 = 时序）；
  - **序列 <37 天不注入**（突变检测循环进入下限），序列不足基地保持 `dataMode:EMPTY`；
  - series origin === "SYNTHETIC" ⇒ 注入 `provenanceSynthetic:true`（合成不冒充实测，两维正交）。
- `apps/datacore/src/solvers/extended.ts` `yieldDiagnosis` LIVE 分支加性透传 `provenanceSynthetic`（仅 args 带该键时出现）；**EMPTY 分支与行内警告一字未动**。
- 未碰 `solvers/risk.ts`、`seed.ts`（避让同行 dev）。

## 4. 测试 + 变异证据

环境：机器红灯（uptime: `load averages: 544.86 518.73 384.38`，用户侧高负载）；vitest 水位探测 `ps -eo args | grep -F "node (vitest" | grep -v grep | wc -l` = **0**（≤3 可跑），主动 `--maxWorkers=1` 推进。前置：`pnpm install --prefer-offline` ✓、`@platform/contracts` + `@platform/llm-adapters` build ✓（后者缺 dist 曾报 `Failed to resolve entry for package "@platform/llm-adapters"`，与本单无关的环境前置）。

- 接缝门 `apps/datacore/test/yield-series-source.seam.test.ts`（5 例，全绿）：
  - 命令：`cd apps/datacore && npx vitest run test/yield-series-source.seam.test.ts --maxWorkers=1`
  - **RC=0**；`Test Files 1 passed (1) / Tests 5 passed (5)`
  - ① 主判据：seedBattery 后把常州全部「涂布」工序实体的 90 天序列覆写为「前 60 天 0.95±0.001 / 之后 0.80±0.001」（`repos.tsPoints.upsert` 直写，绕过 7 天迟到容差）⇒ HTTP invoke `{processKey:"涂布", baseName:"常州"}` 返 `dataMode:"LIVE"`、`breakpoint.day ∈ [53,60]`（实测 54：post7 窗含首个跌落日即触发）、`drop>0.01`、`provenanceSynthetic:true`。
  - ②a/b/c 诚实位：无此工序 / 基地解析不到 / 未播种租户 ⇒ 全保持 `dataMode:"EMPTY"` + `breakpoint` 缺席；note 逐字断言 `无逐日良率时序输入（series 空）·无法诊断突变——不以写死序列冒充真算`。
  - ③ 加性：直传 50 天 series（35 天起跌）⇒ 注入让位，`breakpoint.day ∈ [30,35]`（实测循环下限 i=30 触发），根因候选「换料」命中。
- 变异反证（均实录真红→恢复绿）：
  - **变异 A（接回错源）**：注入改读 `seriesKey:"output:line"` ⇒ `npx vitest run test/yield-series-source.seam.test.ts --maxWorkers=1 -t "接缝主判据"` **RC=1**，`AssertionError: expected 'EMPTY' to be 'LIVE'`。恢复后绿。
  - **变异 B（截断序列 <37 天）**：注入阈值 37→91（90 天也被判不足）⇒ 同命令 **RC=1**，同断言红。恢复后绿（恢复态全量 5 例绿见下）。
- 相关回归（恢复变异后一次跑）：`npx vitest run test/yield-series-source.seam.test.ts test/solvers-extended.test.ts test/rules-p3-payload-11solvers.test.ts test/timeseries.test.ts --maxWorkers=1` ⇒ **RC=0**，`Test Files 4 passed (4) / Tests 34 passed (34)`（日志 /tmp/yield-regression.log；含恢复变异后的接缝门 5 例复绿）。
- 既有单测行为注：`solvers-extended.test.ts:67` 的常数序列（0.95 恒值）能检出断点，靠的是 FP 残差使 `sd≈1e-17>0`（node 复算实录：i=30 即触发，breakpoint day=31）——本单新测试不依赖该巧合，一律种 ±0.001 显式噪声。

## 5. 本体回写

`docs/SYSTEM-ONTOLOGY.md` §8 `G-YIELD-SERIES-SOURCE-MISMATCH` 行句尾已追加 ✅ 已闭状态（修法路径 / 闸门 / 变异证据摘要）。

## 6. merge-tree 自测 / porcelain

- 重fetch 集成分支后：`git merge-tree --write-tree HEAD origin/claude/verify-reclaim-6 > /tmp/yield-mergetree.out 2>&1; echo $?` ⇒ **RC=0**（干净；集成线 tip 仍为基线 e1694f00，本分支直线领先）。
- `git status --porcelain` 收尾净（见最终汇报）。
