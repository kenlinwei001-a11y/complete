# GOALMAP-SUP-C · 供应链风险预警与溯源定位（3.17–3.20）取证

**取证对象**：客户补充需求「实现供应链风险预警与溯源定位，自动识别风险根因，驱动业务主动处置」
**范围**：只答供应链侧（风险从哪来）。偏差侧 3.14 根因分析由另一位取证员量，本报告**不拿任一条去顶另一条**。

---

## ⚠️ 开工第一件事：PIN 与 worktree 不一致（必须先说，否则整份数作废）

派单写「canonical = fbfa88f1，你的 worktree 已在此 commit」—— **这句话不成立**，实测：

```
git rev-parse HEAD                          → 778cc589 (2026-06-15)
git merge-base --is-ancestor HEAD fbfa88f1  → RC=0   ⇒ HEAD 是 PIN 的祖先 ⇒ 落后
git show fbfa88f1:.../synthetic/battery.ts | wc -l   → 7053
wc -l .../synthetic/battery.ts   (worktree) → 1249
```

**树龄探针差 5.6×**。`778cc589` 正是 CLAUDE.md 铁律 3 点名的那棵 LOOP10 陈旧树（「06-15 的树，battery.ts 1249 行」）。
在它上面取证会得到与事实相反的结论（那次的代价是「20 单 vs 500 单」差 25 倍）。

**处置**：我在**开工第一步**就自己测出了这个错位（不是被提醒后才发现），因此**没有一个数取自过期树**。
派单当时禁止 checkout，故先用 `git archive fbfa88f1` 把 PIN 树导出到 scratchpad 取证；
后经协调方明确准许，再 `git checkout --detach fbfa88f1` 在真树上**逐条复跑**。

**两次取证的一致性（亲手复跑，非推断）**：
`git rev-parse --short HEAD` → `fbfa88f1`；`wc -l battery.ts` → **7053**（与导出树逐字一致）。
**下表 9 条否定结论 + 关键肯定坐标已在真 PIN 树上全部重跑，结果与导出树逐数相同，无一条改判。**

| 复跑项 | 报的数 | PIN 真树复跑 | 金丝雀（对照） |
|---|---|---|---|
| `notify/notifyRole` 调用方 | 5（4 在 `actions.ts` + 1 内部扇出） | **同** | `NotificationService` 命中 3 文件 |
| `risk.ts` / `rules.ts` 的 `notif` | 0 / 0 | **同** | `actions.ts` 命中 **5** |
| `contracts/solvers.ts` `supplierId\|materialId\|matId` | 0 | **同** | 同文件 `baseId` 命中 **7** |
| 前端 `supplyVulnerability` | 0 文件 | **同** | 前端 `chain_impediments` 命中 **19 文件** |
| `event-subscriptions.ts` 三个告警事件 | 0 | **同** | 同文件 `{ event:` 共 **60** 条 |
| 前端 `fromObjectId` | 仅 `mocks/handlers.ts` | **同** | —— |
| scheduler/simclock 调 `risk_timeline` | 0 | **同** | datacore 内 `risk_timeline` 命中 **20 文件** |
| `ACTION_WIRING` | 11 WIRED / 0 NOT_IMPLEMENTED | **同** | —— |
| `MockActionExecutor` 在 `app.ts` | 仅注释（176/612），无 import | **同** | —— |
| `RiskBoardView` 一键派单行 | `:2220 adopt.mutate(...)` | **同**（行号与内容均未变） | —— |

**工具金丝雀（先自证再取证）**：`outbox.emit` 在 PIN 树 10 文件命中；已知 pathspec 坑复现
（`apps/*/src` → 0 文件，`apps/*/src/*` → 46 文件）⇒ 观测有鉴别力，且我没踩那个坑。

⚠ **一处金丝雀当场失败、已按铁律 0.6 处置、未写成结论**：核「`supplyVulnerability` 是否被 zod 吞掉」时，
我先去 `contracts/chain-sim.ts` 找输出 schema，对照金丝雀 `impediments` 在该文件命中 **0** ⇒
**判「工具指错了文件」而非「未声明」**。复查后确认该文件只有 `CHAIN_IMPEDIMENT_KINDS`，
全 contracts 里 `impediments` 只在 `feature-names.ts` 出现 ⇒ **根本没有那道 zod 输出闸**，
故「前端看不到」的机制是**前端零引用**，不是契约 strip。**这条差一点被写成一个错误病因。**

---

## 一、四条判定

| 编号 | 能力项 | 判定 | 实测证据（file + 符号 + 亲手跑出来的数） | 金丝雀 |
|---|---|---|---|---|
| **3.17** | **风险预警（事前）**<br>阈值/触发/送达三样分开答 | **部分**<br>有阈值+触发，**缺送达**；且「事前」与「自动」是**错开的两批** | **① 阈值 ✅**：`synthetic/battery.ts` `BATTERY_RULES` 共 **30 条**，供应/物料侧 **6 条**（C06/C08/C16/C27/C28/C31），阈值在 `expression`+`params`：C27 `Lta.deviationPct > 0.05`、C28 `Batch.idleDays > 90`、C06/C16 `MaterialBalance.gapTon > 0`、C31 `Outsource.yieldRate < Outsource.minYieldRate`。另 `battery.ts:946` `params.risk.threshold = 85`（张力越线阈值）。<br>⚠ **一处内联常数**：`planviews.ts` `scanSupplyRisk` 判据写死 `Math.abs(row.deviationPct) <= 5`，与 C27 的 `0.05` 是两份口径、非同源。<br>**② 触发 ✅**：见 3.18。<br>**③ 送达 ❌ = 缺的那一半**：`rule.alert` / `supply_risk` / `scenario.trigger_fired` 三个事件**只落 outbox**。`NotificationService` 全仓 **5 个**调用方**全部在 `actions.ts`（797/874/889/931）= 审批流**；`risk.ts`/`rules.ts` 对 `notif` 命中 **0**。前端 `store/eventInvalidation.ts` 事件表 **不含**这三个。`notifiedTo` 唯一消费方 `AnnualScenarioView.tsx:251` 只把它 `join("、")` 渲染成一行字。<br>**④ 事前性**：真·事前的是 `solvers/risk.ts` `tensionSeries`+`crossDayOf`（预测未来 H 天的**越线日**）与 `supply_vulnerability`（未断但脆弱）——**但这两个没有任何定时调用方**；自动跑的那 6 条规则判据**全是当下快照**（偏差已发生／已呆滞 90 天／缺口已存在）。 | 报「送达缺」用：`grep -c notif` 在 `planviews.ts`=2（均为 `notifiedTo` 数据字段）、`risk.ts`=**0**、`rules.ts`=**0**；而 `NotificationService` 在 6 文件命中 ⇒ 工具好用。<br>报「前端不接这三事件」用：`event-subscriptions.ts` 共 **60** 条 `{ event:` 条目，`rule.alert\|supply_risk\|trigger_fired` 命中 **0**。 |
| **3.18** | **自动识别**<br>系统自己冒出来 vs 人点按钮 | **已有**（检测侧）<br>非用户触发的检测**真实存在**，触发点与条件已抄出 | **触发点（三段链，逐段实测）**：<br>① 注册：`synthetic/service.ts:326` `await this.scheduler.register(ctx.tenantId, "RULE_SCAN", "tenant", "0 * * * *")` —— **每小时**，在场景包合成时注册（同处还注册 DERIVATION_FULL `0 2 * * *`、TS_AGGREGATE `30 * * * *`、CALIBRATION_RUN `0 3 * * 1`）。<br>② 起跑：`server.ts:133` `services.scheduler.start()`；`scheduler.ts` `SchedulerService` 默认 `intervalMs = 30_000`（30s tick 扫 `scheduled_jobs`，pg 侧 `claimDue` 用 `FOR UPDATE SKIP LOCKED`）。<br>③ handler：`app.ts:1231` `.on("RULE_SCAN", …)` → `ruleScan.scan(tenantId)` + `plan.scanTriggers(tenantId)` + `plan.scanSupplyRisk(tenantId)`。<br>**触发条件原文**：<br>· `scheduler.ts` `RuleScanService.scan` → 对 `status==="PUBLISHED"` 规则逐条 `parseExpression` → 按 `rule.scopeObjectTypes` 取 `objects.listByType` 逐对象 `evaluateAst` → 命中即 `outbox.emit(tenantId, "rule.alert", {ruleKey, entityId, message})`（`ruleKey==="C12"` 改发 `calibration.required`）。<br>· `planviews.ts` `scanSupplyRisk`：`if (Math.abs(row.deviationPct) <= 5) continue;` → `outbox.emit(tenantId, "supply_risk", {material, planned, actual, deviationPct, baseId, note})`。<br>· `planviews.ts` `scanTriggers`：`evaluateExpression(t.props.expr, {payload: metrics})` → 置 `status="TRIGGERED"` + emit `scenario.trigger_fired`。种子 **4 条**触发器（`battery.ts` TRG-1..TRG-4），供应侧是 **TRG-3** `ltaDevMaxAbs > 12`「长协到货偏差率\|绝对值\|>12%」。<br>**⚠ 作用域已修、不是死规则**：`BATTERY_RULE_SCOPES` 把 C27 → `["LongTermAgreement"]`（原 `Lta`）、C28 → `["MaterialBatch"]`（原 `Batch`）—— 这两条曾因作用域键不是本体类型键而「永不参与评估且零信号」，PIN 树上**已订正**。 | 报「确有事件订阅机制」用（派单要求先证明能找到真实订阅点）：`outbox.emit` 在 datacore **10 文件**命中，`actions.ts` 单文件 7 处；已按提示避开「事件名是第二个实参」的坑（按第一实参 grep 会报 0）。<br>`BATTERY_RULE_SCOPES` 共登记 **29 条显式 + C35 显式空**，非空表。 |
| **3.19** | **溯源定位**<br>能否从风险点追到源头对象 | **部分**<br>**对象级溯源的三条路都存在，但没有一条挂在生产风险看板上**；看板这条路终点是**一句文案** | **缺的那半（最要紧）**：生产风险看板追不到对象。`contracts/solvers.ts` `RiskCardSchema` 只有 `baseId: z.string()` + `factor: z.string()`，`factor` 取 `battery.ts` `BN_FACTORS` **7 个固定枚举**之一（瓶颈工序/设备OEE/人力工时/**物料齐套**/**物流时长**/换型损失/良率波动）。⇒ 终点是「物料齐套」这**一句文案**，不是某个 supplier id / material id。**追 0 跳到对象**。<br>**有的那半（三条，均达对象 id，但都不在这条路上）**：<br>① `solvers/supply-vulnerability.ts` `supplyVulnerabilitySection` 出 `suppliers[].supplierId` 与 `ranking[].matId` **真对象 id** + `recoveryPath` 三态（`NONE`/`QUALIFIED_BACKUP`/`UNQUALIFIED_BACKUP_ONLY`）+ TTR（无备份**报 null 不报 0**）。文件注释记着实测样例 `SUP-011`（铝箔唯一来源·`NONE`·敞口 0.85%·排第 11 位）。**但前端零消费方**。<br>② `supplier_disruption_radius`（`solvers/service.ts:6348` 分发）到对象 id，但**方向是正向**：`catalog.ts:190` argHints 里 `rootId` 标【必填】，即**必须先指定是哪个供应商**。它答「X 断了波及谁」，**不答**「这个风险是谁造成的」——`supply-vulnerability.ts` 文件头自己写明这一点。<br>③ sim 推演 `sim/propagation.ts:909` `trace.push({ruleKey, fromObjectId, toObjectId, amount, viaLinkKey})` —— **逐边带对象 id，真能反查**；`contracts/sim.ts` 已声明 `PropagationTraceSchema{fromObjectId,toObjectId}` 且 `trace` 进 `SimTickState`。**但前端 `fromObjectId` 只在 `mocks/handlers.ts` 命中**，零真实视图消费。<br>**且这条链的源头没有真数据**：`seed.ts` 有 PUBLISHED 传导规则 `Supplier.deliveryDelay → Material.shortageRisk → Model.supplyRisk → Order.shortageRisk`（`sourceTypeKey:"Supplier"`, `sourceStateVar:"deliveryDelay"`, 系数 0.7 / 0.8），但 `seed.ts` 原文写明三个纯源量纲「入度 0 = 没有上游 = **只能被外部扰动打进来**」「全仓没有任何规则写它」⇒ 对真实供应商数据而言是**接了线没数据**（铁律 0.5 态②），今天只由沙盘手工扰动驱动。 | 报「风险卡无供应商/物料粒度」用**同文件对照**：`contracts/solvers.ts` 里 `baseId` 命中 **7** 次，而 `supplierId\|materialId\|matId` 命中 **0** 次 ⇒ 工具对该文件有鉴别力，0 是真 0。<br>报「supply_vulnerability 前端零消费」用：同一 `apps/frontend-shell/src` 目录下 `chain_impediments` 命中 **19 文件**，`supplyVulnerability\|supply_vulnerability` 命中 **0 文件**。<br>`seed.ts` `sourceTypeKey:` 共 **47** 条 ⇒ 传导规则表非空。 |
| **3.20** | **驱动主动处置**<br>一键生成 Action 提案走正门 vs 只给红点 | **已有**<br>四条里最完整的一条：边存在、走正门、执行器真接、**且效果可验** | **① 预警 → Action 这条边存在，两条生产者**：<br>· **人点（一键）**：`RiskBoardView.tsx:2220` `onClick={() => adopt.mutate({ actionTypeKey: "adopt_mitigation", payload: { base, factor, planKey: p.key } })}` —— 从风险卡直接开 Action 草稿。<br>· **自动（非用户触发）**：`opsteam/replay.ts:202` `case "adopt_mitigation"` 在 tick 回放里跑（`app.ts` `opsReplay.runTick`），链路是 `decision/mitigation-dispatch.ts` `selectMitigationForBase`：`risk_timeline({})` 取**该基地自己那张卡**的 `card.factor` + `card.currentTightness.value` → `mitigation_select` 按平台自有打分 `score = eff × urgency ÷ (costRank × tn)`（`urgency = max(0,(tightness−70)/30)`）→ `dryRunMitigation` **拿真消费者 `risk_timeline` 干跑复核**，要求 `peakAfter <= peakBefore`（「不接受算出来了但没降」）→ 才派单。选不到 ⇒ **诚实跳过**，不派注定失败的草稿。<br>**② kind**：`adopt_mitigation`；审批链 **planner 一审 → admin 终审**两步（`BATTERY_ACTION_TYPES`），走 `actions.approve` 正门。<br>**③ 执行器真接了（按分支验，不信名字）**：`actions.ts` `ACTION_WIRING` 标 `adopt_mitigation: "WIRED"`；全表 **11 个 WIRED / 0 个 NOT_IMPLEMENTED**。真分支在 `app.ts:826` `if (draft.actionTypeKey === "adopt_mitigation")`，审批通过后写 `AdoptedMitigation` 对象，带 `origin: {type:"ACTION", actionId: draft.id, source:"adopt_mitigation"}`；解不出 base/factor/planKey 一律**显式拒绝**（`app.ts:841/851/860`「拒绝臆造 eff/tn」）。兜底是 `UnwiredActionExecutor`（`app.ts:621`），`MockActionExecutor` 在 `app.ts:176` **刻意不 import**。<br>**④ 效果真闭环**：`AdoptedMitigation` → `risk_timeline` 的 `tensionSeries({eff,tn})` 自第 tn 天起扣 eff，且 `risk.ts` 分三态 `RESOLVED` / `STILL_CROSSING` / `NO_CROSS_EITHER_WAY`（「不许拿『不越线』冒充『我消解的』」）。<br>**⑤ 缺口（粒度）**：payload 是 `{base, factor, planKey}` —— 处置落到「常州 × 物料齐套 × 备选供应商切换」，**不指明切哪一家供应商、哪一种物料**。方案库 `battery.ts:958 params.risk.mitigations` 是**类目级**：`early_stock`(提前备料 eff 12/tn 2)、`alt_supplier`(备选供应商切换 eff 9/tn 5)、`air_freight`(空运补料 eff 15/tn 1)。 | 报「执行器真接」不靠名字：`ACTION_WIRING` 里 `": \"WIRED\""` 命中 **11**、`NOT_IMPLEMENTED",` 命中 **0**，且逐条核到 `app.ts` 真分支行；反面证据同时在场（`MockActionExecutor` 在 `actions.ts` 仍有定义但 `app.ts` 不 import）⇒ 不是「全表都标 WIRED 所以看不出差别」。 |

---

## 二、整体判读（一句话）

**四条里，「自动识别」与「驱动处置」是通的，「事前预警」断在送达，「溯源定位」断在粒度。**

更要紧的是这两条**错位**，它们不是两个独立缺口，是同一个错位的两面：

1. **「事前」的能力有，但不自动；「自动」的那半是当下快照。**
   会预测的（`risk_timeline` 越线日 / `supply_vulnerability` 未断但脆弱）**零定时调用方**，
   必须有人点开页面才算；自动每小时跑的那 6 条供应规则，判据全是「已经发生」。
2. **对象级溯源的三条路都造好了，但一条都没挂到生产风险看板上。**
   `supply_vulnerability` 出 `supplierId`/`matId` 却前端零消费；sim `trace` 有逐边对象 id 却只有 mock 引用；
   `supplier_disruption_radius` 要先指定供应商。而看板这条**唯一有人看**的路，粒度止于 7 个固定 factor 文案。

⇒ 结果是：**处置的粒度被溯源的粒度锁死。** 3.20 的 Action 只能下到「基地 × 因素 × 类目方案」，
不是因为执行器不行（它 WIRED 且效果可验），而是因为上游给不出「哪一家供应商 / 哪一种物料」。

---

## 三、需起服务复核

本单禁起服务（4001/4002/5173 可能被占，本机无 `ss`/`netstat`，探针沉默≠端口空闲），以下**只能靠真跑判**，我**没有**据此下结论：

1. **RULE_SCAN 真跑一轮，那 6 条供应规则各产出几条 `rule.alert`。**
   我只证到「作用域键已订正为真本体类型键」（C27→`LongTermAgreement`、C28→`MaterialBatch`），
   **没证到这三类对象在 demo 租户真有实例、且真有越线行**。
   ⛔ 「规则已发布 + 作用域已订正」**不度量**「真会响」——`battery.ts` 注释声称 C28「MaterialBatch.idleDays 满覆盖，改名后立刻真评估出判定」，
   而注释不算数（铁律 1.5 判据四），需 `SEED_DEMO=1` 起 datacore 后 `POST` 一轮扫描现读条数。
2. **`supply_vulnerability` 在 demo 种子上真出几行、单点供应商几家。**
   文件注释记的 `SUP-011` / 14 行 / 0.85% 是**别人留下的实测记录**，不是我跑出来的数。
3. **前端是否真有入口能看到这三个事件。**
   我证到「`eventInvalidation` 60 条目录里没有这三个」「`supplyVulnerability` 前端 0 文件」，
   但**通用求解器调用面板 / QOS 自然语言路**是否能把它们召出来，须真浏览器走一遍才算数。

---

## 四、我可能错在哪（≤3 条）

1. **「送达缺」可能被我判重了。**
   我的判据是「`NotificationService` 5 个调用方全在 `actions.ts`，风险路径零调用」。
   但 outbox 是**租户自助注册 webhook**（`app.ts` `POST /a/v1/webhooks` 收任意 `url`，不做白名单），
   且 `GET /a/v1/outbox` 被前端 `useDomainEventStream` 全局轮询。
   ⇒ 若某租户自己注册了一条 hook，或前端有我没找到的通用事件面板，**送达就不是 0**。
   我证到的准确命题是「**平台不主动送**」，不是「**没有任何办法看到**」。

2. **`opsteam/replay.ts` 的自动派单，我可能把它的「自动」说大了。**
   它确实非用户触发（tick 回放），但它是照 **playbook 剧本**在走（`action.persona` + `d.date`），
   **不是被 `supply_risk` / `rule.alert` 事件触发的**。
   ⇒ 严格说它是「按剧本到点就去看风险看板」，不是「风险冒出来所以去处置」。
   我在表里按「非用户触发」记它，这个口径对 3.18 成立，但**若客户要的是「事件驱动」，这条应判更弱**。

3. **7 个 `BN_FACTORS` 我可能读窄了。**
   我判「终点是一句文案」，依据是 `RiskCardSchema` 只有 `baseId`+`factor`。
   但 `RiskCardSchema` 另有 `allFactors` / `factorSeries` 等 optional 字段，且 `RiskBoardView` 还引了
   `ProvenanceDag` / `gapAttributionToBaseRootCause` / `matchRiskFactorToRootCause`。
   ⇒ 其中 `gapAttribution` 一支**属偏差侧（3.14）**，按派单边界我**刻意没有**拿它去顶供应侧溯源
   （拿它顶会盖住 3.19 这个缺口）。但若该 DAG 在供应侧也能下钻到对象 id，3.19 应从「部分」上调。
   **这一条我没追到底，是本报告最可能翻案的地方。**
