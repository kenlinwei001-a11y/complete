# GOALMAP-2A · 目标2「产能协同优化」7 条能力取证

**取证时刻**：2026-09-11 · **全程只读**，零源码改动、零 commit、零 push、未起服务。

---

## ⛔ 开工第一件事：PIN 与 worktree 不符（派单前提被实测推翻）

派单写「canonical = fbfa88f1，你的 worktree 已在此 commit」——**不成立**。

```
$ git rev-parse --short HEAD                          → 778cc589   (2026-06-15)
$ git merge-base --is-ancestor HEAD fbfa88f1; echo $? → 0
```

`HEAD` 是 `fbfa88f1` 的**祖先** ⇒ 按 CLAUDE.md 铁律 0.6 第 2 条的判据，这叫**落后**，
不是「已在此 commit」。且正是铁律 3 点名的那棵 LOOP10 旧树。

**树龄探针（两棵树同一文件）**：

| 树 | `apps/datacore/src/synthetic/battery.ts` |
|---|---|
| 我的 worktree `778cc589` | **1,249 行** |
| PIN `fbfa88f1` | **7,053 行**（**5.65×**） |

**处置**：⛔ 不 checkout（派单禁令），改用 `git grep <rev>` / `git show <rev>:<path>` **直接读 PIN 的树**，
worktree 一个字节未动。下表**每一个数都取自 `fbfa88f1`**。

> **金丝雀（证明这条取证路是活的）**：`git grep -l tenantId fbfa88f1 -- 'apps/datacore/src/*'` → **90 文件**命中。
> 顺带复验已知工具坑：`-- 'apps/*/src'` → **0**（陷阱），`-- 'apps/*/src/*'` → **151**（正确写法）。本报告一律用后者。

---

## 主表

| 编号 | 能力项 | 判定 | 实测证据（file + 符号 + 亲手跑出来的数） | 金丝雀 |
|---|---|---|---|---|
| **2.1** | 集团产能模型 | **部分** | **有的一半（真逐层上算）**：`solvers/capacity.ts` `computeRollup` 四层真派生 —— 设备 `(3600/ctSeconds)×availFactor×OEE` → 工序 `Σ设备/h×班次时长×班次数×良率×出勤×利用率` → 产线 `min(串行段, formationCap, agingCap)` → 基地 `min(lineMean, sharedFormation×yieldFactor, sharedAging×yieldFactor)`。非常数。<br>**缺的一半（集团总量是常数和）**：「集团总共能产多少」这个抬头数走的**不是**上面那条链，而是 `Base.gwh` 求和 —— `synthetic/battery.ts` `totalGwh = BASE_REGISTRY.reduce((s,b)=>s+b.gwh,0)`，`synthetic/service.ts` 下发 `{kind:"objects-aggregate", objectType:"Base", agg:"sum", prop:"gwh"}`，label 原文「**全部基地铭牌产能合计**」。我亲手加总 `base-registry.ts`：**13 基地 / 758.2 GWh**，13 个数全是手写字面量（常州 99.4 / 厦门 79.5 / …）。<br>**且 rollup 侧没有与型号无关的集团总量**：`capacityForecast` 的 `capWanP50 += cumTotal` 只遍历 `cert.entries()`（该型号已认证基地），必填 `modelId`，无它即 `throw validationError("modelId required")`。 | `gwh` 求和法命中 9 处（含 `vle.ts` / `fixtures.ts`），工具活 |
| **2.2** | 多基地负荷实时监控 | **部分** | **几个基地：13**（`BASE_REGISTRY` 我亲手数 13 行，`grep -c "baseId:"` 报 14 = 13 行 + 接口字段 `baseId: string`）。<br>**一屏确有**：`views/plan/GeoMapView.tsx` 按 `utilColor(u, [92,85,78])` 三色档渲染，卡片 `data-testid="geo-card-util"` 打 `{selected.util}%`。<br>**负荷率怎么算出来的 —— 不算，是常数**：该视图读 `Number(o.props.util ?? 0)`；`Base.util` 全部来自 `BASE_REGISTRY` 手写整数，我亲手统计 **min 70 / max 88 / mean 78.3**。<br>**多久更新 —— 不更新**：无任何时序物化落到 `Base.util`（否定探针 **RC=1**）；`views/plan/GeoMapView.tsx` 内 `refetch/refresh/interval/timestamp/asOf` 全部 0 命中；全前端 `refetchInterval` 仅 **7 处且全在 admin 页**（ConnectionsPage / DataBuilder / ModelingPage / SimClockConsole / SyntheticPage / HealthBadge），基地负荷屏一处都没有。<br>⚠ **同名两个数别混**：`Line.utilization` **是**时序物化的（`battery.ts` `TS_SERIES` `util:line` mean 92 noise 1.2 → `line_util_daily` → `output:{objectType:"Line",property:"utilization"}`，实测取值区间 89.77~94.13），但基地屏和跨基地决策读的是 `Base.util` 那个常数，**不是**它。 | 否定探针 `objectType:"Base", property` → RC=1；**同形金丝雀** `output:{objectType:"Line",property:"utilization"}` → `battery.ts:4505` 命中 ⇒ 探针有鉴别力 |
| **2.3 ★** | 跨基地统筹调度 | **部分** | **有的一半 —— 决策变量与 Action 都真实存在且接通了**：<br>① **决策变量**：`solvers/portfolio.ts` 把订单指派到产能单元，输出行 `allocation[] = {item, kind, committed, base, baseName, window, windowStartDay, qty, model, dueDay, delayDays, onTime, provenance}` —— `base` 就是「这张单归哪个基地」的决策变量。<br>② **Action kind**：`actions.ts` `GlobalSimPlanExecutor.execute`，kind = **`plan_change`**（条件 `payload.source === "global-sim"`）。服务基地 ≠ 订单 home 基地时**真写一等对象** `InterBaseTransfer{transferId, fromBase, toBase, model, qty, transitDays, freightCost, status, dispatchDay, etaDay, reason}`（`contracts/src/interbase-transfer.ts`，状态机 PLANNED→IN_TRANSIT→DELIVERED→CANCELLED），并在 `BUILTIN_ACTION_EFFECTS.plan_change.writes` 第 3 条登记 `objectType:"InterBaseTransfer", op:"UPSERT"`。<br>③ `sop_reschedule` 端到端接通（`service.ts:6334` 分发 → `router/ceo-route.ts` `RE_SOP` 路由 → 前端 `views/sim/SopReschedulePanel.tsx` `useLiveSolver("sop_reschedule",…)`）。<br>**缺的一半（三处，都不是「没接线」而是算法退化）**：<br>(a) **无独立可触发的调拨动作** —— 否定探针 `transfer_between_bases\|cross_base_transfer\|interbase_transfer\|base_transfer` 作 **Action kind** 零命中（唯一命中是 `process/flow-rules.ts` 的 `flowKey:"interbase_transfer"`，那是流程图的流名不是 action kind）。调拨只能作为「采纳 global-sim 方案」的**副作用**产生。<br>(b) **`sop_reschedule` 阶段2 的「挪」是假的**（第四态·算错了）：`solvers/sop-reschedule.ts` 挤占腾出的产能恒落 `const bid = baseCaps[0]?.baseId`，而 `competitors` 的结构是 `{so,cust,qty,pri,dueDay}` —— **根本没有 base 字段**，被挤单原本在哪个基地**一次都没被读过**；`delayDays` 同样恒用 `baseCaps[0].freeDaily`。注释自陈「落腾产能到首个可产基地」。<br>(c) **处置推演的跨基地杠杆是个标量** ：`contracts/src/disposition.ts` `crossBase = min(remaining, remaining × crossBaseAbsorbPct)`，缺省 **0.6**，**不选目标基地、不查目标基地有没有空闲产能**。 | 否定探针配同形金丝雀：`"plan_change"\|"adopt_mitigation"` 在 `actions.ts` 命中 4 处 ⇒ 该 grep 形状能抓到 action kind |
| **2.4** | 供需智能匹配 | **部分** | **有的一半 —— 单→基地 真有指派**：`portfolio.ts` 多目标求解（`method: weighted \| epsilon \| lexicographic`，`multiObjective:true`，CP-SAT 可证最优否则启发式贪心），输出 `allocation[].base` + `window` + `windowStartDay`；采纳后 `actions.ts` 按 `served[] = {orderId, base, model, qty, window, windowStartDay}` 物化 `WorkOrder{baseId}` 并把 `Order.status` OPEN→IN_PRODUCTION。**即「哪张单排在哪个基地哪个时间窗」成立**。<br>**缺的一半 —— 单→线 是「接了线没数据」**：产线粒度**代码存在**（`portfolio.ts` `unitId = \`${bid}#${lineId}\``、`lineModelCompat` 型号-产线兼容过滤、换型小时 line 级优先），但：① 开关缺省关 —— `const lineGranularity = input.lineGranularity === true`；② **零调用方开启** —— 否定探针 `lineGranularity` 在 `apps/frontend-shell/src/*` + `apps/agentcore/src/*` 命中 **RC=1（0 处）**，唯二写它的是 `solvers/service.ts` 的 `asBool(args.lineGranularity)` 与契约 `global-sim.ts` 的可选字段；③ **即便打开，输出也带不出线** —— 两个 allocation 行类型（`portfolio.ts:508` 主行、`:511` scenarios 行）**都没有 lineId 字段**。⇒ 生产路径上 **单→线 的指派拿不到**。 | 同形金丝雀：`demandMultiplier\|advancePct` 在前端命中 `SopReschedulePanel.tsx`(4) + `simSolvers.ts`(2) ⇒「前端传求解器入参」这个 grep 形状是活的，`lineGranularity` 的 0 是真 0 |
| **2.5** | 最大化产能利用率（优化 ≠ 报告） | **部分** | **两件事必须分清，本仓只做了后一件。**<br>**目标函数侧：整条缺。** `portfolio.ts` 目标全集只有 5 个：`PortfolioObjectiveKey = "max_ontime" \| "min_delay" \| "min_changeover" \| "min_cost" \| "min_fg_inventory"`，`OBJ_SENSE` 逐条给 sense（ontime=max，其余 min）。**没有任何一项是利用率**。否定探针 `(max\|min)_(util\|utilization\|loading\|load)` 全仓 `apps/*/src/*`+`packages/*/src/*` → **RC=1（0 命中）**。连**报告**层也没有：`contracts/src/global-sim.ts` `GlobalSimKpiSchema` 共 **8 个字段**（ontime / cost / changeoverHours / freight / fgInv / transitInv / margin），**无 utilization**。<br>**读数侧：有，三处，但都只是给人看。** ① `capacity.ts` `CapacityLedgerPool.utilizationPct = round(consumed/capacity×100, 4)`；② `Base.util` 常数 → GeoMapView 色档；③ `Line.utilization`（时序物化）→ 规则 C05 `SUSTAIN(Line.utilization > 95, 3)` 红线。<br>⚠ 三处里最像「优化」的那个 **屏上根本看不到**：`capacity_ledger` 前端消费方 **0**（见右列金丝雀）。间接相关的只有 `unservedPenaltyPerUnit`（缺省 0.5，惩罚未排量）——它推的是「多接单」不是「提利用率」，两者在产能受限时才偶然同向。 | ①目标探针 RC=1，**同形金丝雀** `(max\|min)_(ontime\|cost\|delay)` 命中 **25 个文件** ⇒ 工具活。<br>②`capacity_ledger` 在 `apps/frontend-shell/src/*` → **RC=1（0）**；**同路径金丝雀** `capacity_forecast` → **17 个前端文件**命中 ⇒ 「零前端消费方」是真的（`battery.ts` 注释亦自陈，但此处是我亲手复验的） |
| **2.6** | 线上 S&OP 协同（三样分开答） | **部分** | **① 版本 ✅ 有。** `domain.ts` `interface SopVersion {id, tenantId, month, status, inputs, steps{s1..s5}, agenda, resolutions, supFinal, pendingApproval, createdBy, createdAt, updatedAt}`；仓储 `repos.sopVersions`；状态机 `DRAFT → IN_REVIEW(①–④) → EXEC_MEETING(⑤) → FINAL`；同月多版有序号 —— `sop.ts currentPlanVersion` 算 `versionLabel = \`${v.month} V${seq}\``（seq 由同月按 createdAt 排序取 index+1）。路由齐全（`app.ts`：PATCH `/a/v1/sop/versions/:id`、POST `…/advance`、POST `…/finalize`、GET `/a/v1/plan-versions/current`）。<br>**② 留痕 ◑ 一半。** 有的：`createdBy`（谁建的）+ `createdAt`/`updatedAt`（什么时候）+ 事件流 `outbox.emit("sop.changed", {versionId, draftId, patch})` 与 `"sop.finalized"`（**改了什么**在 `patch` 里，且挂着 `draftId` 可溯审批人）。缺的：**版本对象上没有逐步操作人字段** —— `steps.s1..s5` 是裸 `Record<string,unknown>`，`patch()` 只写 `v[k]=fields[k]` + `updatedAt`，**不记这一步是谁推的**；datacore 全域无专用审计表（否定探针 `auditLog\|AuditEntry\|audit_log` → RC=1，而同形金丝雀 `outbox` 命中 **35 个文件**）。<br>**③ 角色分工 ❌ 无。** 四条实测：(a) 路由只有**功能开关**没有角色 —— advance/finalize 全部只跑 `requireFeatureTag(req,"apiTags","sop")`，无 role 断言 ⇒ 任一持 sop 功能位的用户可推**任意一步**；(b) `sop.ts` 内 `ownerFunctionKey` **0 命中**（同形金丝雀：该符号在 datacore 其他 8 个文件命中 99 处，`seed.ts` 独占 67）⇒ 五步**没有**挂到 `PROCESS_OWNER_FUNCTIONS`（该册确有 `sales` 销售 / `production_planning` 生产计划 / `finance` 财务 / `demand_planning` 需求计划，共 15 个职能）；(c) 唯一跑满五步的编排是 `opsteam/replay.ts` 的 `sop_cycle`，**单个 persona `vp_sop_host` 连做 create→advance 1,2,3,4,5→finalize**，不是四个角色协作；(d) `opsteam/defaults.ts` 六个虚拟人的 roles 是 `planner/admin/tenant_admin/base_manager:常州/catalog_admin` —— **销售、生产、财务三个角色在这套 persona 里根本不存在**。 | `ownerFunctionKey` 金丝雀 8 文件 99 处；`outbox` 金丝雀 35 文件 |
| **2.7** | What-if 仿真（存得下 / 比得了） | **已有** | **存得下 ✅**：`repo/repo.ts` `interface SimRepo` —— `createSession/putSession/getSession/listSessions/listSessionSummaries`（`SimSession` 带 `baseSnapshot`）、`putTickState/getTickState/listTickStates`、`createCheckpoint/getCheckpoint/listCheckpoints`、`deleteTicksAfter`（回滚）。落库真实到**性能已成问题**：接口注释记录实测「35 条生产量级会话 **285 MB**」，并因此另开 `listSessionSummaries` 投影（pg 侧用 `jsonb_object_keys` 数键，`base_snapshot` 不过网线）——**这种为体积另开一条路的痕迹，本身就是「真的在存」的证据**。<br>**比得了 ✅**：`app.ts` `GET /a/v1/sim/compare?a=&b=` 是**真端点**（非 mock），实现 `seriesOf(id) = listTickStates(tenant,id).map(t=>({tick,state}))`，返回 `{a:[…], b:[…]}` 两条逐 tick 态序列；前端 `api/endpoints.ts` 拼该 URL，`views/sim/SimComparePanel.tsx` 消费并按「对象→状态变量→数值」聚合；`SandboxPlaysPanel.tsx` 注释标明「并排比对 = `GET /a/v1/sim/compare?a=&b=`（真端点）」。另有 `putProposal/getProposal` 冻结提案版本（「重跑读的是这一行，不是再调一次模型」）。<br>⚠ 口径限制（不影响判定但要说）：compare 比的是**推演会话的逐 tick 状态**，不是 2.1–2.5 那条产能求解器的输出；`capacity_forecast` 的 `whatIf{nightShifts, extraChannels, outsourceRatio}` 是**单次调用内**的即时对比（返回 `adjustedP50/adjustedP90/physicalCap/capped`），**它自己不落库**。 | `/a/v1/sim/compare` 在 app.ts / endpoints.ts / handlers.ts / SandboxPlaysPanel / SimComparePanel **5 处**命中，前后端两侧都在 ⇒ 非孤儿端点 |

---

## 《需起服务复核》

本单禁起服务（4001/4002/5173 可能被占，本机无 `ss`/`netstat`，探针沉默 ≠ 端口空闲）。以下 5 条只能靠真跑定论：

| # | 条目 | 要跑什么 | 期望看到的数（对上=我判对，对不上=我判错） |
|---|---|---|---|
| R1 | **2.3(b) 阶段2 恒落 base[0]** 的对照实验 | `SEED_DEMO=1` 起 datacore，对同一 `targetOrderId` 跑两次 `POST /a/v1/solvers/sop_reschedule/invoke`：第一次原样，第二次把被挤单**换成另一个基地的单**（或直接比对 `displaced[]` 里各单的真实 base） | `allocation[]` 中**除首基地外其余基地的 qty 逐字节不变**，全部增量落在排序首位那个 baseId ⇒ 证实「挪」与被挤单所在基地无关。若其余基地也变 ⇒ 我错 |
| R2 | **2.3 末叶余额分摊可能产负数** | 同上，取一个 `residualAfterFree > 0` 且基地数 ≥3 的单，看 `allocation[last].qty` | 阶段2 把 `take` 全加到 `baseCaps[0]`，而末叶 `last.qty = scheduledQty − rest` 可能被压成**负值**或 0。若真出负数，那是比 (b) 更硬的缺陷；我**没有**实测到，只是读出的风险 |
| R3 | **2.1 两个集团产能数差多少** | 起服务后同时取 `sum(Base.gwh)` 与 Σ_base `computeRollup().weeklyWan` 年化 | 我只能给出常数侧 **758.2 GWh**；rollup 侧需真跑（依赖 seed 后的 Line/Process/Equipment 实例）。两数差距**有多大**决定 2.1 该不该从「部分」降级 |
| R4 | **2.2 负荷屏是否真的不会变** | `SEED_DEMO=1` 起服务 → 推进模拟时钟（`simclock`）若干 tick → 重新拉基地列表 | `Base.util` 13 个值**逐字节不变**（我的静态判定），而 `Line.utilization` 应在 89.77~94.13 间动。两者都不动 ⇒ 时序没跑起来，我的对比失效 |
| R5 | **2.5 利用率能否作为目标** | `POST /a/v1/solvers/portfolio_optimize/invoke` 传 `objective:"max_utilization"` | 期望 **400 / 被 `isObjKey` 拒并回落 `max_ontime`**（`isObjKey` 只认 5 个 key）。若居然接受，说明有我没找到的旁路，2.5 判定要改 |

---

## 《我可能错在哪》

**1. 2.3 判「部分」可能偏严 —— 最可能被推翻的一条。**
我把 `plan_change`+`global-sim` 写 `InterBaseTransfer` 认定为「有，但只是采纳方案的副作用」。
推翻它需要的证据：**任一处让用户直接发起跨基地调拨的入口** —— 前端一个按钮 POST 到 `/a/v1/action-drafts` 且 payload 能独立指定 `fromBase/toBase/qty`，或租户经 `POST /a/v1/action-types` 注册的 `effects` 里有调拨型（`actions.ts` 注释明写「租户注册的 effects 优先级高于本表」，**这条我没查租户态数据，只查了平台内置表**）。若存在，2.3 应升「已有」。

**2. 2.1 判「部分」的要害是「集团总量走常数」，但我没证明那个常数真的上了屏。**
我证明了 `sum(Base.gwh)` 有 `objects-aggregate` 下发且 label 是「全部基地铭牌产能合计」，也证明了 rollup 侧无与型号无关的总量。
但**「COO 屏上那个集团产能数到底取的哪一个」我没追到具体组件**。若实际屏上展示的是 Σ`capWanP50`（逐型号加总）而非 `sum(gwh)`，则 2.1 该升「已有」。推翻需要：前端某组件同时拿到全部型号的 `capacity_forecast` 并求和。

**3. 2.4 的「单→线 拿不到」建立在「输出类型无 lineId 字段」上，而我没读优化器回包的原始形状。**
我读的是 `portfolio.ts` 声明的两个 allocation 行类型（`:508` / `:511`），都无 lineId。
但 `optimizer-client.ts` / `inproc-optimizer.ts` 的**原始 `occupancy` 回包**可能带 `unitId`（即 `baseId#lineId`），只是在组装成 allocation 时被丢弃。若某个消费方直接读了那个原始结构，「单→线」就是拿得到的。推翻需要：`inproc-optimizer.ts` 的 occupancy 字段表 + 任一读它的生产调用方。

---

## 附：本报告用到的否定探针一览（每条都配了同形金丝雀）

| 结论 | 探针 | RC | 同形金丝雀 | 金丝雀结果 |
|---|---|---|---|---|
| 无利用率目标函数 | `(max\|min)_(util\|utilization\|loading\|load)` | **1** | `(max\|min)_(ontime\|cost\|delay)` | 25 文件 |
| `capacity_ledger` 零前端消费 | 该词 in `apps/frontend-shell/src/*` | **1** | `capacity_forecast` 同路径 | 17 文件 |
| `Base.util` 无时序刷新 | `objectType:"Base", property` | **1** | `objectType:"Line",property:"utilization"` | `battery.ts:4505` |
| 前端从不开产线粒度 | `lineGranularity` in 前端+agentcore | **1** | `demandMultiplier\|advancePct` 同路径 | 6 处 |
| S&OP 五步无职能归属 | `ownerFunctionKey` in `sop.ts` | **1** | 同符号 in datacore 其余 | 8 文件 99 处 |
| datacore 无专用审计表 | `auditLog\|AuditEntry\|audit_log` | **1** | `outbox` | 35 文件 |
| 无独立跨基地调拨 action kind | `transfer_between_bases\|cross_base_transfer\|…` | 仅命中流程图 `flowKey` | `"plan_change"\|"adopt_mitigation"` in actions.ts | 4 处 |
