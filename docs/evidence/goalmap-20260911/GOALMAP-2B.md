# GOALMAP-2B · 产能协同优化（后半 2.8–2.13）取证

**取证 commit**：`fbfa88f1`（树龄探针 `wc -l apps/datacore/src/synthetic/battery.ts` = **7053**）
**取证方式**：全程只读静态取证 + 逐条金丝雀。未起服务（4001/4002/5173 未触碰）。

> ## ⚠️ 开工第一件事：PIN 前提被实测推翻（必须先看这段）
>
> 派单写「canonical = fbfa88f1，你的 worktree 已在此 commit」——**实测为假**。
> worktree 实际停在 `778cc589`（2026-06-15），`battery.ts` = **1249 行**。
>
> | 量 | 派单假设 | 实测 |
> |---|---|---|
> | HEAD | fbfa88f1 | **778cc589** |
> | `merge-base --is-ancestor HEAD fbfa88f1` | — | **YES（落后）** |
> | 落后提交数 | — | **4665** |
> | `apps/datacore/src` 差异 | — | **175 文件 / +68,349 行** |
> | `battery.ts` | — | **1249 → 7053 行** |
>
> 这正是 CLAUDE.md 铁律 3 记载的 LOOP10 事故树（`778cc589` / 1249 行那一棵，当时导致「20 单 vs 500 单」差 25 倍）。
> 若在此树取证，6 条结论全部作废。依铁律 0.6 第 2 条的规定动作（判据是**祖先关系**不是文件存在性）
> `git checkout --detach fbfa88f1` 移到 PIN 本身后取证，`git status --porcelain` = 0，未建分支、未 commit、未 push。

---

## 判定表

| 编号 | 能力项 | 判定 | 实测证据（file + 符号 + 亲手跑出来的数） | 金丝雀 |
|---|---|---|---|---|
| **2.8** | 业务变动实时响应 | **部分**<br>有=跨会话事件通道会让**读数**自动刷新；缺=**求解本身从不自动重算** | 事件侧真实存在：`datacore` 全仓 `outbox.emit` **72 处**；`agentcore/src/event-subscriptions.ts` 的 `EVENT_SUBSCRIPTIONS` **61 条** `invalidates` 登记，经 `GET /b/v1/event-subscriptions` 下发。<br>传输 = **20 秒轮询**，不是推送：`frontend-shell/src/store/useDomainEventStream.ts` 的 `DEFAULT_POLL_MS = 20_000`，游标 `for (const s of sources) cursorsRef.current[s.id] = now` ⇒ **挂载前的事件不重放**。已真挂：`pages/ShellLayout.tsx` 的 `useDomainEventStream(!!workspace)`。<br>但它的动作是 `invalidateForEvent(e.event)` → 失效 TanStack 缓存 → **重取（re-read）**，不是重解（re-solve）。<br>⚠ 决定性证据：`views/sim/GlobalSimView.tsx` 用 `useLiveSolver("portfolio", …)`；改任一入参 → `res.isStale` → `staleStyle = {opacity:0.42, filter:"grayscale(1)"}` 置灰 + 出 `global-sim-stale-banner`，**必须人点 `global-sim-stale-recompute`（`onClick={res.recompute}`）才重算**。<br>且 61 条登记里 `invalidates` **没有任何一条**指向 portfolio 求解结果（`sim.*` 六条指向 `sim-world`/`sim-sessions`/`sim-scenarios`，是沙盘世界态不是联合求解）。 | `invalidateForEvent` 在自身文件外**真有 10 个调用点**（`RulesPage`/`ScenesPage`/`useDomainEventStream` 等）⇒ 不是死代码，工具有鉴别力；`GlobalSimView` 内 `useQuery\|useMutation` **命中 4**（证明 grep 活）而 `refetchInterval\|invalidateQueries\|EventSource` **命中 0** ⇒ 该页零自动重取 |
| **2.9 ★** | 多目标优化 · 跨基地多工厂 | **已有**（目标 5 项 · 三法 · 域真跨基地）<br>**但**：预置方案权重是**内联常数**；内存态只出可行解不出最优解 | **目标函数表达式**（`solvers/inproc-optimizer.ts` · `InProcOptimizerClient.solvePortfolio` → `comboSort` 的 `score`，weighted 法）：<br>`norm_k(c) = (objVal(c,k) − lo_k) / (hi_k − lo_k)`（lo/hi 取**该需求项候选格集**的 min/max）<br>`score(c) = Σ_{k∈objKeys} w_k · ( k=="ontime" ? 1 − norm_k(c) : norm_k(c) )` → **取 min**<br>装入序 `loadOrder` = 量大先 · id 字典序 tie-break（确定性 R6）。<br>**① 目标有几项**：**5** 项 —— `ontime`(max) / `delay` / `changeover` / `cost` / `fgInventory`(min)，见 `portfolio.ts` 的 `OBJ_SENSE`。三种组合法全部实现：`weighted` / `epsilon`（`withinEps` 先滤越界格，全越界则退回全集）/ `lexicographic`（按 `priorityKeys` 逐层）。<br>**② 权重从哪来**：**两条路，定性相反**——<br>· 组合法（`buildComboRequest`，`multiObjective:true`）：权重来自 `input.methodWeights`，**真来自用户**：`GlobalSimView` 滑杆 `min={0} max={10} step={0.5}`，5 键初值全 1，`weightsChanged` 判非 1 才下发 ⇒ **配置（运行时用户输入）**。<br>· 预置 5 方案（`scenarioObjectives`）：权重**写死在代码里** —— `min_delay`/`min_changeover`/`min_fg_inventory` 恒 `[{cost,1},{X,10}]`，`max_ontime`/`min_cost` 恒 `[{X,1}]`。**内联常数，不可校准**。<br>**③ 定义域跨不跨基地**：**跨**。`cells` 建于 `for (const b of it.eligibleBases)` × 窗口，决策变量 ≈ `x[item, base, window]`。`eligibleBases` 回落 `MODEL_BASE_MAP`，实测 6 型号各映 **4/2/3/4/3/2** 个基地，覆盖 `BASE_REGISTRY` 全 **13** 个基地 ⇒ 同一张单真的在多基地间择优。<br>⚠ 诚实边界（非缺陷但必须写进报告）：内存态是**贪心**，恒返 `status:"FEASIBLE", optimal:false`，**不能证明最优**；可证最优需配 `OPTIMIZER_BASE_URL` 起 CP-SAT sidecar。独立的 `multi_objective` 求解器（`solvers/service.ts` 的 `multiObjective`）在内存态**未实现**：`InProcOptimizerClient` 只有 `solve`/`solvePortfolio`/`solveCrossObjectOccupancy`，无 `solveMultiObjective` ⇒ 显式抛「未接入」，不编造解。 | `multiObjective` 全仓 **9 处命中**（契约 1 + 引擎 3 + 装配 1 + 服务 2 + 注释 2），其中 `portfolio.ts` 的 `buildComboRequest` **真的设 `multiObjective: true`** 且被 `portfolioOptimize` 调用 ⇒ 「接了线**且有数据**」，非排练；`solveMultiObjective` 反向命中仅 `optimizer-client.ts`（Http 客户端）+ `service.ts` 守卫 ⇒ 内存态确无实现 |
| **2.10** | 产能约束进目标函数 | **部分**<br>产能=**硬约束（进模型）**；物料/运费=**事后检查** | **产能：硬约束，两道闸都在求解过程内**——<br>① 建变量时剪枝：`portfolio.ts` 建 cells 处 `if (it.qty > (capMap.get(k) ?? 0)) continue;`（注释原文「单项超单格容量 → 该格不可行（**不建变量**）」）<br>② 装入时守恒：`inproc-optimizer.ts` 的 `packWith` 中 `if ((rem.get(k) ?? 0) >= need) { rem.set(k, rem - need); … }`，装不下即落 `displaced`。⇒ `Σ qty·x ≤ cap` **恒成立，不可突破**。<br>另有**事后审计层**（不是执行层）：`capacityLedger` + `reconChecks`（`ok: allocated <= netCap + 1e-6`）+ `reconciled`。<br>**物料/BOM：只做事后检查，不进模型** —— `portfolio.ts` 注释原文「① 物料联合约束（BOM·mrp_netting **后处理**归因 Material+Supplier）」。代码对 `primaryAlloc`（**已经排好的**分配）逐行扫 BOM，`if (have + 1e-9 < need)` 则记 `materialBlocked` 并 `blockedIds.add`，**不回头重解**、不把腾出的产能让给别的单。<br>**运费：不在目标函数里** —— `freightCost` 在两阶段后处理算出，最后 `baseCost = round(num(objectiveValues.cost) + freight, 2)` **加在解之外**。⇒ 择格（选哪个基地）时**完全看不见运费**，跨基地调拨的运输代价不参与权衡。 | 反向金丝雀：`materialOn` 的三重闸 `input.materialConstraint === true && materials.length > 0 && bom != null` 确实存在且带诚实回退（`materialConstraint 请求为真但无 Material/BOM 数据 → 诚实回退`）⇒ 该分支非死代码，确为「已实现但置于解后」 |
| **2.11** | 经营目标 | **部分**<br>是**对象**（有类型/责任人/权重），但**无基地维、期间只有两档** | 是对象不是散落常数：`packages/contracts/src/base-registry.ts` 的 `GOAL_REGISTRY: Record<string, GoalTarget>`，**7 条**，每条带 `target` / `floorVal` / `weight` / `ownerRef`(责任人) / `ksfRef`(关键成功要素) / `category` / `direction`。实测值：`revenue` 700亿(floor 686) · `gross_profit` 112亿(108.5) · `market_share` 23%(20) · `cash` 60亿(floor 引 `PLAN_GOAL_TARGETS.cashFloor`) · `gm_rate` 16%(15.5) · `demand_attain` 100%(95) · `material_cov` 100%(95)。权重和：year 四条 0.35+0.25+0.2+0.2 = **1.00**。<br>另有 `PLAN_GOAL_TARGETS` **6 个全局标量**（revGrowthPct 18 / gmFloorPct 15.5 / sharePts 12 / capexCap 20 / cashFloor 50 / turns 6.0），且 `GOAL_REGISTRY` 的两条 floor **引用**它 ⇒ 单一来源纪律在此处**真守住了**（不是两份数）。<br>⚠ **缺的那一半**：`GoalTarget` 字段表里**没有 baseId / period / month** 任何一个；`level` 只有 `"op" | "year"` 两档。⇒ **不能按基地设不同目标，也不能按任意期间（月/季）设目标**。13 个基地共用同一套企业级目标值。 | 正向：`grep "targetByBase\|baseTarget\|goalsByBase"` 在 contracts+datacore **0 命中**；反向金丝雀 `perBase` 概念**确实存在**（`capacity.ts` 的 `perBaseRows`、`synthetic/service.ts` 的 `outputFields:[…,"perBaseRows",…]`）⇒ 工具能看见「逐基地」这种写法，它在**产能**上有、在**目标**上没有，是真缺不是查不到 |
| **2.12** | 运营成本 | **部分 → 实为「接了线没数据」**<br>成本项**只有 4+1 项调度罚金**，且**今天 100% 走内联兜底** | **目标函数里的成本全貌**（`portfolio.ts` 建 cells 处，逐字抄出）：<br>`cost = delayPenaltyPerUnitDay × delayUnits + changeoverCostPerHour × changeUnits + fgHoldingCostPerUnitDay × fgHoldUnits + splitFixedPerUnit × qty`<br>再加项级未排罚：`unservedPenalty = unservedPenaltyPerUnit × qty`（`buildRequest`/`buildComboRequest`），求解后并入 `cost += unservedPen`。<br>**逐项列出 + 来源**：<br>① 延期罚 `delayPenaltyPerUnitDay` 兜底 **0.05** — 规则/兜底<br>② 换型 `changeoverCostPerHour` 兜底 **72** — 规则/兜底<br>③ 成品持有 `fgHoldingCostPerUnitDay` 兜底 **0.5** — 规则/兜底<br>④ 拆批固定 `splitFixedCostPerUnit` 兜底 **0.02** — 规则/兜底<br>⑤ 未排罚 `unservedPenaltyPerUnit` 兜底 **0.5** — 规则/兜底<br>（同族还有 `windowDays` 14 · `lateWindows` 2 · `maxWindows` 10 · `splitBatch` 3000 · `avgUnitPrice` 1.8 · `mockFreightPerUnit` 0.15 · `mockTransitDays` 3 · `leverLineCapDaily` 30000 等，`portfolio.ts` 内 `coeff("…", N)` 共 **24 个调用点**）<br>**⚠ 「配置还是内联常数」的实测答案：今天全部内联。** 机制是 `coeff = (k, dflt) => num(coeffRule?.params?.[k] ?? dflt)`，`coeffRule` = 已发布规则 `portfolio_optimize_coeffs`。实测该规则**全仓只有读方、没有写方**：种子规则表 `BATTERY_RULES` 的 key 全集实测为 `C01–C06,C08–C13,C15,C16,C18,C21–C35,Cxx` 共 **31 条**，**没有任何一条**是 `*_coeffs`。⇒ `coeffRule` 恒 undefined ⇒ **24 个系数 100% 走 `dflt` 内联兜底**。R14/RL5「应用层无业务常数」在这条路上**今天没守住**。<br>**⚠ 更要紧的缺项（第 ④ 态）**：成本里**没有物料/BOM、没有工时、没有能耗、没有折旧**。实测 `portfolio.ts` 内 `bomUnit`/`BOMDetail`/`materialCost`/`laborCost`/`energyCost`/`depreciation`/`能耗`/`折旧`/`工时` **各 0 命中**。运费虽算但在解之外（见 2.10）。⇒ **成本只取决于「何时、在哪」，完全不取决于「造的是什么」**：两张同 qty、同交期、同基地但物料成本天差地别的单，目标函数给出**完全相同的 cost**。这与 CLAUDE.md 记载的 `propagation.ts`「碳酸锂与铝箔各涨 15% 得到同一个 9.75」是**同一形态**。 | 正向金丝雀（证明 grep 活）：同文件同一条命令下，确在公式里的 4 项分别命中 `delayPenaltyPerUnitDay`=4 · `changeoverCostPerHour`=4 · `fgHoldingCostPerUnitDay`=2 · `splitFixedPerUnit`=2；而 9 个物料/工时/能耗/折旧词**全 0** ⇒ 0 命中是真缺，不是工具坏 |
| **2.13** | 「最优」站得住吗 | **部分**<br>**不撒谎**、**有对照**；但**关键披露项在主力页缺席** | **① 优的是什么 —— 可得**：`objectiveValues` 五项随解下发（ontime/delay/changeover/fgInventory/cost），`method` 回显走的哪条组合法。<br>**② 约束是什么 —— 部分可得**：`capacityLedger`（逐格 cap/allocated）+ `reconChecks`（带中文 label「共享产能守恒（基地·窗口N·allocated ≤ 净cap）」）+ `reconciled` 布尔。物料约束以 `materialBlocked[]` 带 `reason:"material"` + 物料号 + 供应商下发。<br>**③ 有没有对照 —— 有，两层**：<br>· 方案横比：`scenarios[]` 每条带 `key` + `objectiveValues` + `servedCount`/`displacedCount`/`servedQty`，缺省至少 `["max_ontime","min_cost"]` 两套解；summary 真的拼出 `方案 max_ontime(按期X/代价Y) vs min_cost(…)`。<br>· **真帕累托前沿**：`solvers/opt-pareto.ts` 的 `runOptimizePareto` 做逐对支配剔除，回 `frontier[]` + `dominated[]`；经 `app.ts` 的 `/optimize-pareto` 路由下发；前端 `views/sim/MultiObjWhatifPanel.tsx` 真消费 `[...r.frontier, ...r.dominated]` 并标 `recommendedId`。⇒「次优差多少」**答得出**。<br>**④ 不撒谎 —— 守住了**：内存贪心恒 `status:"FEASIBLE", optimal:false`；`GlobalSimView` 徽标跟 `d.optimal` 走，未证到就只显示 FEASIBLE。`mockNotes` 把每处 mock 值（运费/在途天数）显式标注。<br>**⚠ 缺的那一半（照铁律 1.5 判据二逐项核）**：portfolio 回包里 **规则 key = 无**（`grep "ruleKey\|coefficients\|coeffSource" portfolio.ts` = **0**）、**系数值 = 无**、**服务端耗时 = 无**（`elapsedMs` 只在前端自测）、**`agentInvolved` = 无**（该字段在 `capacity.ts`/`world-read.ts`/`agent-proposal.ts` 有，portfolio 路**没有**）。**数据条数**有（`servedCount`/`displacedCount`）。<br>⇒ 一个看不到代码的人，在**全局推演页**读不到「这个数用了哪条规则、系数是多少、是不是代码兜底默认」。<br>**⚠ 反差证据（说明这件事本仓做得到、只是没做到这一页）**：风险处置路已经做对了——`solvers/decision-info.ts` 的 `disclosedCoefficients` 给每个系数打 `basis: "RULE_PARAMS" | "DEFAULT_FALLBACK"`，`DEFAULT_FALLBACK` 时 note 原文写「**本值是代码兜底默认，不是被治理过的口径**」，前端 `views/risk/DispositionOptionsPanel.tsx` 真把它渲染出来（`data-testid="disposition-coefficients"`）。同理 `capacity.ts` 的 `computeCapacityLedger` 有完整 `disclosure{formula, edgeAmountSource, units, agentInvolved, counts, totals}`。**这两处的范式没有搬到 portfolio。** | `optimize_pareto` 在 `solvers/service.ts` **0 命中**（而 `"portfolio"` 在同文件命中、且有 `solverKey === "portfolio"` 分发 ⇒ 工具活）——**依铁律 0.5 再追一层**后推翻了「没接线」的初判：它不走求解器注册表，走 `app.ts` 的 `runOptimizePareto` REST 路由，**真可达**。此条即本单最接近误报的一次 |

---

## 《需起服务复核》

本单全程静态取证，以下 4 条**必须真跑才能定死**，各写清「跑什么 · 期望看到什么数」：

1. **2.12 系数兜底率（本单最重的一条）**
   跑：`SEED_DEMO=1` 起 datacore 内存态 → `GET /a/v1/rules?status=PUBLISHED` 取全部已发布规则 key。
   期望：结果里**不含** `portfolio_optimize_coeffs`（以及 `base_outlook_coeffs` / `sop_reschedule_coeffs` / `gap_attribution_coeffs` / `supply_demand_gap_coeffs`）。
   若真不含 ⇒ 本报告「24 个系数 100% 内联兜底」坐实。**若含**（说明有我没找到的播种路径）⇒ 2.12 判定需改写。

2. **2.9 权重是不是真的会改变解（对照实验，铁律 1.5 判据一）**
   跑：同一批订单调 `portfolio`，`method:"weighted"`，两次分别传
   `methodWeights:{delay:10, ontime:1,cost:1,changeover:1,fgInventory:1}` 与 `{delay:0, …其余同}`。
   期望：两次 `allocation` / `objectiveValues.delay` **必须不同**。
   若逐字节相同 ⇒ 滑杆是装饰品，2.9 要从「已有」降级。
   （引擎自带 `discriminating` 探针会把失效维置灰，正好可交叉验证：屏上 `data-inert="1"` 的维就该是改了没反应的那些。）

3. **2.10 物料事后检查的代价（量化它到底错多少）**
   跑：构造一张会被物料卡死的单，`materialConstraint:true` 跑一次。
   期望看到：该单出现在 `materialBlocked[]`，**同时**它在 `capacityLedger` 里**仍然占着产能**、且 `displaced[]` 里**没有**因它腾出产能而被救回的单。
   这能把「事后检查」的业务代价从定性变成一个数：**被白占的产能格数**。

4. **2.8 端到端时延（把「20 秒」坐实成一个实测数）**
   跑：两个浏览器会话 A/B 登同一租户；A 发一个会 emit 的领域事件（如发布规则），B 不操作。
   期望：B 的相关读数在 **≤20s + 一个 refetch 往返**内自动变化；而 B 的**全局推演结果区**应当**纹丝不动**（仍是旧解、不置灰、也不重算）——后者正是本报告 2.8 判「部分」的那一半。

---

## 《我可能错在哪》（≤3 条）

1. **最可能被推翻：2.12 的「100% 内联兜底」。**
   我的证据链是「`BATTERY_RULES` 31 条 key 里没有 `*_coeffs`」+「6 个 `*_coeffs` 全仓只有读方」。
   但规则可以**运行期**被写入（A2 规则文档抽取 / 校准闭环 `calibration.applied` / 用户手工发布），
   这类写入不经代码字面量，**静态 grep 一定看不见**。
   推翻它需要：上面《需起服务复核》第 1 条的真实 `GET /a/v1/rules` 输出里出现 `portfolio_optimize_coeffs`；
   或找到 `calibration` 路径把 `solver-params` 回写成已发布规则的证据。
   （注：我已看到 `EVENT_SUBSCRIPTIONS` 里 `calibration.applied → invalidates:["solver-params"]`，
   说明**存在**一条校准写回路，我未追到底它写的是 `solverParams` 表还是 `rules` 表 —— 这是本报告最薄的一环。）

2. **次可能被推翻：2.9 判「已有」可能偏宽。**
   我读的是 `InProcOptimizerClient`（内存态贪心）。生产若真起 CP-SAT sidecar，
   目标函数是 **sidecar 里的 Python 模型**，不在本仓 TS 里 —— 我**没有**读到那份模型，
   `sandbox-runner.mjs` / `optimizer-client.ts` 只是请求契约。
   ⇒ 我抄出来的表达式**只对内存态成立**。若 COO 现场跑的是 docker 全套，真实目标函数可能与我抄的不同（也可能更强）。
   推翻它需要：sidecar 侧模型源码，或一次真跑对比 `optimal:true` 路径的 `objectiveValues`。

3. **2.8 可能偏严。**
   我判「求解不自动重算」，依据是 `GlobalSimView` 的置灰 + 手点 recompute。
   但我只逐行核了**这一个**页面（全局推演）。`SandboxView` / `DecisionConsoleView` / `RiskBoardView`
   等其它推演入口我只看到它们的 queryKey 登记在 `LABEL_TO_KEYS` 里，**没有**逐个确认它们是否也靠手点。
   若其中某个页面的求解挂在 `useQuery`（而非 `useLiveSolver` 的手动 mutation）上，
   那它会随缓存失效**真的自动重解** ⇒ 2.8 该升为「部分（且更偏已有）」。
   推翻它需要：核 `SandboxView`/`DecisionConsoleView` 的求解触发是 `useQuery` 还是手动触发。
