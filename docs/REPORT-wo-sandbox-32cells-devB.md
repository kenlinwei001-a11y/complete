# 交单报告 · WO-SANDBOX-32CELLS dev B 两单（WO-U6-ADOPT ＋ WO-U1-U8-SMALL）

> 分支 `claude/handoff-wo-sandbox-action` · rebase 后 tip `19471c9d`（基于集成线 `claude/verify-reclaim-6` @ `a2666b90`）
> 四提交：`e10025fa`（占位）→ `879e0ae7`（U6 五格）→ `5e930c8b`（U1 两格）→ `19471c9d`（U8 一格）
> 本报告写于 rebase 完成之后，所有数字以新基线为准，与门现算一致（门先说话，不是人手数）。

---

## 1 · 交付摘要（8 格 · 全部经门现算确认）

| WO | 格 | 改前 → 改后 | 一句话 |
|---|---|---|---|
| WO-U6-ADOPT | `project-sim` × U6 | 不符合 → **符合** | 补登记（WO-SIM-ACTION-REAL 早已接上，表没跟上代码） |
| WO-U6-ADOPT | `what-if` × U6 | 不符合 → **符合** | `wi-adopt-assumption` → 既有「对象数据变更」动作型 |
| WO-U6-ADOPT | `optimize-whatif` × U6 | 不符合 → **符合** | `ow-adopt-conclusion` → 新动作型「采纳推演结论」 |
| WO-U6-ADOPT | `cleanroom-attr` × U6 | 不符合 → **符合** | 三块诊断各一个采纳钮，同一动作型 `analysis` 判别 |
| WO-U6-ADOPT | `disruption-radius` × U6 | 不符合 → **符合** | 断供根 + 实际扇出链 + **关边清单随 payload 上送** |
| WO-U1-U8-SMALL | `optimize-whatif` × U1 | 不符合 → **符合** | 撤 `ow-solve` 提交闸（先测后裁：运行点 p95≈9.2ms / 演示规模 ≈1.6s） |
| WO-U1-U8-SMALL | `sop-balance` × U1 | 不符合 → **不适用** | 五个 `sop-run-N` = S&OP 流程节点提交，非提交闸（§4.3 专段） |
| WO-U1-U8-SMALL | `global-sim` × U8 | 不符合 → **符合** | 订单明细抽屉 `GlobalSimOrderDrawer`（看明细不换页） |

**门值轨迹（rebase 后新基线，门现算）**：集成线 tip 表体实测 符合 95 → ＋U6 五格 = 100 → ＋U1 撤闸 = 101 → ＋U8 = **102**。
`sop-balance` × U1 不计符合数（不符合 −1 · 不适用 +1）。终态：**符合 102 · 不符合 22 · 不适用 8 · 判不了 0**（132 格）。

⚠ 与派单预期的偏差说明：审核方补发时按「集成线 符合 84 · 28 · 8」估算我的落点是 91/20/9；
实测集成线 tip 表体是 95/30/7（其 §4 合计行自写 93/31/8，与表体脱节 —— 正是该节自己立誓要治的病，
本单以门现算为准落 102/22/8，合计行已随之改正）。**差额的全部来源是集成线自己的表体比其补发口径新，
我的 8 格翻动一格不少、方向全部 不符合→符合/不适用，无一格反向。**

## 2 · 复算证据（rebase 后全量重跑，RC 全部当场捕获）

| 项 | 命令 | 结果 |
|---|---|---|
| 分支基线门 | `node scripts/check-branch-base.mjs HEAD` | **RC=0**（分叉点落后集成线 0 提交） |
| 冲突标记门 | `node scripts/check-merge-conflict-markers.mjs` | **RC=0** |
| 判据棘轮门 | `node scripts/check-sim-ux-criteria.mjs` | **RC=0** ·「符合 102（基线 102）」棘轮无倒退无松弛 |
| contracts 构建 | `pnpm --filter @platform/contracts build` | **RC=0** |
| llm-adapters 构建 | `pnpm --filter @platform/llm-adapters build` | **RC=0** |
| 前端 typecheck | `pnpm --filter frontend-shell typecheck` | **RC=0** |
| 前端受影响测试 | `vitest run --maxWorkers=1` × 7 文件 | **RC=0 · 25/25**（u6-adopt / u8-globalsim / drill-seam / glass / sim-ux-u1-u5 / optimize-whatif / what-if） |
| datacore 受影响测试 | `vitest run --maxWorkers=1` × 3 文件 | **RC=0 · 23/23**（action-adopt-sim-conclusion.seam / action-plan-change-levers.seam / action-type-evolution） |

环境注记：跑测试时机器 load avg 一度 116（1min）/ 23（15min），另有 2 个 vitest 在跑；
故全部 `--maxWorkers=1` 串行。U5-C1 的 `global-sim-readout` findBy 超时此前已在 `sim-ux-u1-u5.test.tsx`
就地放宽到 20s（与全局 testTimeout 对齐，注释带复现条件），本次串行下 3.3s 通过，非掩饰性放宽。

## 3 · U6 逐字段量纲核对表（`SimConclusionAdoptionPayloadSchema` 判别联合 · `packages/contracts/src/actions.ts`）

契约头注自立军令状（G-LEVER-SNAPSHOT-UNIT-LIE 前科）：每个数值字段必须标它装的量，三页不许共用糊名 snapshot。逐字段核对如下——**「契约标注」列是源码注释原文的缩写，「实现核对」列逐字对过前端 payload 构造点**。

### 3.1 `optimize-whatif`（`OptWhatifAdoptionPayloadSchema`）

| 字段 | 契约标注的量纲 | 实现核对（`OptimizeWhatifView.tsx` 采纳面板） |
|---|---|---|
| `family` | 模板族 key（计数/标识，无量纲） | ✅ 屏上当前族原样 |
| `seed` | int · 复算坐标 | ✅ 42，与 queryFn 求解同一个 seed（注释就地写明） |
| `perturbations[].target/value` | value = 该字段**原生量纲**（随族：成本/权重/需求量…） | ✅ 屏上扰动清单逐项 map，未换算 |
| `snapshot.baselineObjective` | 量纲随族目标函数；null=未解出 | ✅ `?? null`，不伪造 0 |
| `snapshot.perturbedObjective` | 同基线量纲；null=未解出 | ✅ 同上 |
| `snapshot.deltaObjective` | Δ = 扰动后 − 基线，同量纲 | ✅ 求解器输出直传，前端不重算 |
| `snapshot.feasible` | 扰动后是否可行 | ✅ 直传 |
| `snapshot.optimal` | 仅 CP-SAT 证到 OPTIMAL 才 true（InProc 恒 false，**不许写死**） | ✅ `out.optimal === true`，跟字段走 |
| `snapshot.status` / `explanation` | 求解器原文不改写 | ✅ 直传 |
| `snapshot.baselineSolution/perturbedSolution` | 方案结构透传，字段随族 | ✅ 条件展开（有才带），不改键名 |

### 3.2 `cleanroom-attr`（`CleanroomAttrAdoptionPayloadSchema`）

| 字段 | 契约标注的量纲 | 实现核对 |
|---|---|---|
| `analysis` | 三求解器键枚举（判别字段） | ✅ 三钮各自带自己的键 |
| `primaryType` / `args` | 倒推参数快照（复算坐标，由真对象类型结构倒推） | ✅ 屏上该块实际入参原样 |
| `snapshot.summary` | 求解器 summary 原文 | ✅ 直传 |
| `snapshot.findingCount` | **条**（int · 计数） | ✅ findings 长度，非手填 |
| `snapshot.findings[]` | 求解器行**原样**——逐行字段名即求解器原名，量纲随字段名（demand/capacity 为资源原生单位） | ✅ 原样数组，前端不改名不换算（量纲责任留在求解器字段名上，契约注释已声明这一交接） |

### 3.3 `disruption-radius`（`DisruptionRadiusAdoptionPayloadSchema`）

| 字段 | 契约标注的量纲 | 实现核对 |
|---|---|---|
| `rootType/rootId` | 断供来源标识 | ✅ 屏上选中根原样 |
| `layers[]` | 反向扇出链（边开关作用后的**实际链**·复算坐标） | ✅ 关边后的派生链，非全开链 |
| `disabledEdges[]` | 本次关闭的关系边（反事实条件；空=全开） | ✅ **随 payload 上送，不藏**——这是本格的关键纪律：台账必须能复算出「当时关了什么」 |
| `snapshot.radius` | **层**（命中数>0 的层数·int 计数） | ✅ 直传 |
| `snapshot.totalAffected` | **个**（int） | ✅ 直传 |
| `snapshot.leafType/leafCount` | 叶层类型 / **个** | ✅ 直传 |
| `snapshot.layersDetail[].count` | **个**；`ids` 为对象标识 | ✅ 直传 |
| `snapshot.summary` | 求解器原文 | ✅ 直传 |

**核对结论**：判别联合三个分支全部数值字段带量纲标注；前端三个构造点逐字段直传/不换算/不伪造，
无一处把计数（层/个/条）与资源原生单位混装。`what-if` 一格走既有「对象数据变更」动作型（patch 语义，
不在本契约内），其量纲纪律由该动作型既有字段承担。

## 4 · PRD 冲突处置说明（rebase 逐节解法 · 对应审核方补发第 ③ 条）

**前提变化**：集成方 `d6fe8054` 已解掉 PRD 里的冲突标记，且 `merge-markers:check` 门已建在门链首位
——我此前「§4.3 登记行必须放 parser 可见区」的 workaround 前提（`section()` 遇同级标题即停、
冲突区内容对门不可见）**已不存在**。且集成线共享 §4.3 表已被集成方收进了我的 `sop-balance` × U1 行
（取自我 push 的旧分支内容），但标题仍写「8 格」而表有 9 行、失效段漏 U1 一格。故本次处置：

1. **删除**我旧分支上的 §4.3 重复标题块（第二个 `### 4.3` + HTML 注释 + 单行小表）——陷阱已消，留着就是
   下一个「同一概念两套词表」。
2. **归位**：sop-balance × U1 行留在共享表正常位置（集成方已放对），标题 8 格 → **9 格**；
   「这 N 格全部随页面结构变化而失效」段补 U1 那一格的失效条件（长出步内试算块即失效）。
3. **U1 语义裁决专段**（`#### U1 那一格为什么是不适用`，含三判据区分表）并入共享 §4.3 正文，
   排在集成方 WO-DISRUPTION-CARDS 块之后——表格里的「详见下方」指针因此有真实落点。
4. **主表三处冲突**一律取「集成线 12 列版 + 我的格子翻动」（U6 五格 / U1 两格 / U8 一格），
   U2/U3 列一个字未碰；每解完一节当场跑门（100 → 101 → 102 三步全绿才继续下一个 commit）。
5. **§5.2 挂账表取并集**：集成线更新的 U3×risk / U3×6页 / U2×11页 三行保留，
   我的三行（U1×optimize-whatif / U1×sop-balance / U8×global-sim）以「✅ 闭」版替换其挂账旧文。

## 5 · 界外红登记（归因完毕 · 不在本两单范围 · 未动）

| 红 | 归因 | 证据 |
|---|---|---|
| `quantile-unit-onscreen.seam` §2：`capWanP50/P90` 缺 `@unit`（contracts/actions.ts 两处） | 集成线 merge `9dd86bad` 带入，**非我的提交** | `git log -S 'capWanP50'` 首中 `9dd86bad` |
| 同文件 §2b：`keyprops-ontology-parity.seam.test.ts` 仍咬旧 p50 数据键 | 同上（改名接缝的另一半） | 同上 |

两条均属「契约字段改名、旧名以数据键形态残留」一族（铁律 0.6 第 4 条已立门 `quantile-field-naming:check`），
修权在集成方/该门主。本单不碰。

## 6 · 边界与诚实声明

- **U8 抽屉的设计裁决**（写在 `GlobalSimOrderDrawer.tsx` 头注 + PRD §4 登记行）：抽屉放「该单在本版联合解里的
  明细」，不放全量细排。三条理由：① U8 要的是看明细不丢现场，数已在屏上、零新取数、与台账/排产表同源勾稽；
  ② 全量细排 = project-sim 整页试算台 = 判据明示的「做别的事」，出口收进抽屉（`gs-drawer-goto-project`）；
  ③ 抽屉内另跑单排试算会与全局联合解同屏打架。wip/forecast 两类项仍不可下钻只标注（drill-seam 原有纪律不动）。
- **U1 撤闸的护栏**：800ms 防抖（比 what-if 的 300ms 宽，因每次重演 = 真 CP-SAT 两解）+ react-query key 竞态
  （旧结果冒充新结果结构上不存在）。55s 尾部只在手造 2000 对基线 JSON 出现，非运行点，未因此保留闸。
- **没做的**：U6 其余 7 页本就符合（见 PRD §4 表）；§5.2 剩余挂账（U2×9页 / U3×6页 / U4b×5页）归集成线
  排队中的其他 WO，不在本两单。
- 本机 LaunchAgents 部署未重启（内存模式与本次改动无关且未获通知）；canonical 回流 = 本分支已 push，
  收编归集成方。
