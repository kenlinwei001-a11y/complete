# 工作量重算表（2026-09-11 复核后）

> **缘起**：仓主问「**你 100% 确信这些都是目前系统无法满足的功能吗？**」
> 我答「不确信」，派两个 agent 逐条回代码复核。两份原始报告：
> `docs/evidence/goalmap-20260911/RECHECK-G2.md`（目标 2 · 13 条）
> `docs/evidence/goalmap-20260911/RECHECK-G3.md`（目标 3 · 16 条）
> 两个 agent 都从 `778cc589`（battery.ts 1249 行）旧树起步、自测后重钉到 `20b0a322`（7053 行）——
> **树龄探针又一次真的拦住了错误**。

---

## 0 · 一句话结论

**29 条「系统做不到」的判定，复核后只剩 2 条完全成立。**

| 判定 | 条数 | 编号 |
|---|---:|---|
| **完全成立**（我说对了） | **2** | 3.7 · 3.17 |
| **被推翻**（整条不成立，工作量 ≈ 0 或命题错） | **5** | 1.1-d · 2.1 · 2.10 · 3.19 · 3.21 |
| **部分推翻**（事实对，但「要从零造」错了） | **22** | 其余全部 |

**方向是一致的：22/29 条，真实缺的是「最后一步」，不是「整条链」。**
且这个方向**不是我先发现的** —— 是仓主连问两次「你真的检查过数据的现状吗」逼出来的。

**形态（照铁律 0.6 句式）**：
> **「我用『我 grep 不到屏上有这个』当作『系统里没有这个能力』的证据，而前者并不度量后者。」**
> 本仓最常见的三条隐形路径：**字符串键分发**（`navigation-slice.ts:497` 一行把全部注册求解器收进 QOS 候选）、
> **queryKey 驱动重算**（`useQuery` 键含实参 ⇒ 杠杆一动就重解，不需要任何事件）、
> **语义检索选中**（`catalog.answersQuestions` → `semanticCandidates`）。这三条 grep 一次都看不见。

---

## 1 · 逐条重算（29 条）

**尺子**：不再报「人天」——我上一版那些数是拍的，被抓过两次。
改报**修法类别**，类别本身就说明量级：

| 类 | 含义 | 典型 |
|---|---|---|
| **0** | 已经做了，改台账不改代码 | 3.21 |
| **XS** | 改一处声明 / 加一个控件 / 补一句文案 | 2.4 加复选框 |
| **S** | 接一条已有的线（两端都在，只差挂载点） | 2.6 补一次回写 |
| **M** | 复用已有机制但要参数化 / 补数据源 | 2.16 披露层复用 |
| **L** | 真的要新建（但仍不是整条链） | 2.13 物料进模型 |

### 目标 2（13 条）

| # | 我原来说 | 复核结论 | 真实修法 | 类 |
|---|---|---|---|---|
| 1.1-d | 11 个求解器未接入，默认部署即抛 | **被推翻（说反了）** | `docker-compose.yml:52` 有 `optimizer` 服务、`:91` 默认 `OPTIMIZER_BASE_URL=http://optimizer:4003`、sidecar `MODELS` 13 个全在；抛的只是**内存模式**。11 个里 6 个有真屏，5 个走 QOS 活目录。修法＝给 DEPLOY.md 补一句 + 给那 5 个配屏上入口 | **XS**＋5×**S** |
| 2.1 | rollup 侧要新建与型号无关的集团总量 | **被推翻** | 数已经在（`Σ bases[].weeklyWan`），错的是**抬头口径名** | **XS** |
| 2.2 | 视图不刷新，要新建时序回写链 | 部分推翻 | 给 `Base.util` 加一条 `derivedProperties`（照 `oeeIndex` 的 `AVG(… BY baseId)` 写法），聚合口径已算过 | **S** |
| 2.3 | 跨基地调度恒定，要重做目标基地选择 | 部分推翻 | 把 `crossBaseAbsorbPct` 这条 RuleEntry 真种下（今天零写方）＋ `actions.ts:365` 的 `sort()[0]` 换成读已有逐基地结果 | **S** |
| 2.4 | 输出行类型要加产线字段 | 部分推翻 | 字段早有（`portfolio.ts:965/1049` 写 `line:`，契约 `global-sim.ts:194` 已定义）。**加一个复选框** | **XS** |
| 2.5 | 利用率这条链没建 | 部分推翻 | 链是通的（问答路答得出），屏上没人画。给 `capacity_ledger` 配屏，或把 `utilizationPct` 挂成第 6 个目标 | **S** |
| 2.6 | 产销两个模型互不相连 | 部分推翻 | **是连的**（`sop.ts:197 step3()` 第一件事就是 `computeRollup`）。缺的只是 `sopVersions.put(v)` 旁边补一次 `SopVersionRow` 回写 | **S** |
| 2.7 | 五步没挂职能册，要新建角色层 | 部分推翻 | 角色机制存在（`resolveForUser(ctx)`），且步①③已有 A6 列权限闸。修法＝换一条已有的调用 + 扩到②④⑤ | **S** |
| 2.10 | 求解从不自动重算 | **被推翻（两半都错）** | ① `sim.tick_completed → "sim-world" → sim-pareto-assemble` 真事件驱动重解；② `RiskBoardView` 8 处 `invokeSolver` **全包在 `useQuery` 里**，杠杆一动就重解。修法＝给 portfolio/risk_timeline 补一个事件标签 | **XS** |
| 2.13 | 运费根本没路进目标函数 | 部分推翻 | 运费**有**路（`min_cost_flow` autoBind 把 `InterBaseTransfer.freightCost` 绑成 `arc_cost`）。物料确是解后扣减 ⇒ 要进 CP-SAT 模型 | 运费 **S** / 物料 **L** |
| 2.14 | 7 条目标无 period，不能按期间设 | 部分推翻 | `PlanTarget` 有 `period`+`level`，真播 1年+4季+12月＝17 行，连了 Order/AnnualScenario/Principal 三条边。缺的只是 `baseId` | **S** |
| 2.15 | 成本不含物料，模型要重建 | 部分推翻 | `quote_margin` 走**真 BOM**（`selectEffectiveBom` × `Material.unitPrice`），`carbon_footprint` 走真 `EnergyMeter`。缺的是接进 portfolio 格成本 | **M** |
| 2.16 | 披露层全无，要从零设计 | 部分推翻 | `capacity_ledger` 回包**已带** `disclosure{…agentInvolved:false…}`；沙盘 `buildSimRunDisclosure` 六项齐全；`disclosedCoefficients()` 在跑。缺的是**复用 + 参数化**（今天写死 `RULE_KEY="base_outlook_coeffs"`） | **M** |

### 目标 3（16 条）

| # | 复核结论 | 真实修法 | 类 |
|---|---|---|---|
| 3.1 | 部分推翻 | 把 `livedIn` 那 4 个 widget 从 `SEED_LIVED_IN=1` 挪成常驻；决策台已有应收/逾期三列提到驾驶舱 | **S** |
| 3.2 | 部分推翻 | 给 `supplyDemandGapAttribution` 加 `worldId` 入参（`buildWorldReadView` 已存在、签名逐字兼容） | **S** |
| 3.3 | 部分推翻 | 6 张需求侧场景卡 + `demand_shift` 扰动都能跑，只是不在同一个面板里 ⇒ 接进杠杆册 UI | **S** |
| 3.4 | 部分推翻 | 给 `MaintPlan.week` 开 `writable` + 把 `capacity_forecast.whatIf` 3 根杠杆端上屏 | **S** |
| **3.7** | **成立** | ⚠ **反向订正**：我原以为「声明两处单位就回来」——错。`PROPERTY_UNITS` 明令禁用「套」作金额分母，且 `denomCoherent` 要求两侧分母相等 ⇒ **比我说的大** | **M** |
| 3.8 | 部分推翻 | `decision_play` 改用枚举器**已经做了且刻意没合并**。缺的是给 `SolutionCandidate` 补 cost/cycleDays/risk/exposure/reversibility 五维真值源 | **M** |
| 3.9 | 部分推翻 | 把 `finance_world_projection` 接到年度情景页 | **S** |
| 3.11 | 部分推翻 | 订单**两跳**就能追到产线（`order_for_model → model_certified_on`，100% 覆盖），不用补 `fulfills`；我那个 52% 还是偏乐观的上界 | **XS** |
| 3.12 | 部分推翻 | 两处量纲错只剩一处（`formationCapDaily` 基地级电芯当单线级尺度锚），另一处与 100× 显示错已闭 | **S** |
| 3.14 | 部分推翻 | 后端 `SchedulerService` 30s 真轮询、4 个作业在跑；前端 20s 双源轮询。**只有世界时钟成立**（`CLOCK_TICK` 命中 0，金丝雀 `RULE_SCAN` 命中 1） | **S** |
| 3.15a | 部分推翻 | 给 `SEG_DEMAND_ANCHOR` 的 `tgt` 一个独立于 P50 的来源（PlanTarget/AnnualScenario/Metric.target 已各有一套） | **S** |
| **3.17** | **成立** | （原判成立，无订正） | — |
| 3.18 | 部分推翻 | **根因不是技术故障，是一次有意的拒绝**：`decision_play.options` 是公司级战略，`params.risk.mitigations` 是基地级处置，两个域无映射，硬挑一条会让台账与 Action 说两件事。修法＝新立语义正确的动作类型，或让 `decision_play` 产出基地粒度方案；另补一条 `GET /a/v1/decisions` 列表路由 | **M** |
| 3.19 | **被推翻（命题要重写）** | `OutboxService.start()` 在 `server.ts:135` 真起，**每 5 秒**向租户自注册 webhook 真投递，带指数退避+死信+手动重投。准确命题＝「缺**平台自带的人向通道**与默认订阅者」；`NotificationService.notify` 生产调用方**恰 2 处**（不是我说的 5 处） | **M** |
| 3.21 | **被推翻（工作量 0）** | 归因 DAG 挂在 `RiskBoardView.tsx:1337/1771`，下钻到**对象主键** `capobj:${factorId}:${o.objId}`；`allFactors`/`factorSeries` 后端真产前端真读；连未解释残差都画了 | **0** |

---

## 2 · 这次复核本身的证据纪律

两个 agent 都做到了、也都在报告里写了《我可能错在哪》。**未验的部分照原样列出，不当成结论**：

| 存疑项 | 为什么没验 | 要坐实需要什么 |
|---|---|---|
| QOS 问答路那 5 个求解器是否真被调用 | 本单禁起服务；`navigation-slice.ts:517` 还有一道 `canInvokeSolvers` 工具白名单闸 | 起服务发一个问句，看回包里 `invoke_solver` 调了谁 |
| 驾驶舱 KPI 卡走后端 `DASH_LAYOUT` 还是 mock fixtures | 两份 widget 的 `featureKey` 不同名 | 真浏览器看一次网络请求 |
| `min_cost_flow` autoBind 选中的 arc 是不是 `InterBaseTransfer` | 按代码路径推的 | 真跑一次 `optimize_whatif` 看回包 `arc_cost` 绑到了谁 |
| `fulfills` 的真实 distinct 订单数 | 禁起服务，按 `hashString % n` 碰撞推的 | 起 `SEED_DEMO=1` 数一次 |

另外顺带挖出**两条不在 29 条里的真账**：
- `base_outlook_coeffs` / `portfolio_optimize_coeffs` 两条 RuleEntry **全仓只有读方、零写方** ⇒ 所有 `coeff(k, dflt)` 恒走代码兜底。
  金丝雀：`C21` 同法查得到定义点（`battery.ts:802`），这两条查不到 ⇒ 属「接了线没数据」，不是量法坏了。
- 驾驶舱 util 卡的 provenance 文案写「**12** 基地利用率算术平均」，而 `BASE_REGISTRY` 是 **13** 条。

---

## 3 · 对排期的影响

**先前那份估算的问题不是数字大小，是分类错了。**
22 条被归进「要新建」的，实际是「接一条线」或「加一个控件」。
按上表重新分档：

| 类 | 条数 |
|---|---:|
| **0**（已做） | 1 |
| **XS** | 5 |
| **S** | 15 |
| **M** | 7 |
| **L** | 1 |

**唯一一条 L 是「物料从解后扣减改成解内约束」**（给 CP-SAT 加一组物料容量行）——
它也是唯一一条真正会改动求解模型结构的。

⚠ **本表不构成派单**。按仓主 2026-09-11 的指令，UX 之外的单**一张不派，等点名**。
