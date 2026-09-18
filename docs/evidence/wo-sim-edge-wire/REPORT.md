# WO-SIM-EDGE-WIRE · 施工+复验裁决执行报告（2026-09-17）

分支 `claude/handoff-edge-wire`（base = real-cells@4bde203f + desat3@f072c8dc 合并树，
merge 树与 merge-tree 干跑逐字节一致）。本报告覆盖：复验方 RECHECK 裁决的 D1–D6 逐项 +
播种模式核查 + 基线自证。全部数字出自本目录五个可复跑脚本（金丝雀内嵌，否定结论均附命中证据）。

| 脚本 | 产出 | RC |
|---|---|---|
| `twin-arms.mjs` | `twin-arms-result.json`（量①两臂对照） | 0 |
| `fanin.mjs` / `edge-inventory.py` | `fanin-N.json` / `edge-inventory.json`（量②③） | 0 |
| `steady-state.mjs` | `steady-state-result.json`（D4 稳态） | 0 |
| `asource-census.mjs` | `asource-census.json`（D6①普查 + ② forecast_bias） | 0 |
| `d5-fingerprint.mjs` | `d5-fingerprint.json`（D6③ 四数） | 0 |

环境基线：`pnpm install` RC=0 · `pnpm -r build` RC=0 · `pnpm -r typecheck` RC=2（4 条**前置**红：
agentcore/test `capability-map-live-seam.test.ts:398` ×1 + `rule-discovery-seam.test.ts:274-275` ×3；
⚠ **2026-09-18 订正**：`pnpm -r` 在 agentcore **bail 即停**，datacore typecheck 当时**没真跑到**——
直跑 `pnpm --filter datacore typecheck` 实测另有 2 条前置 TS 错（同在 f5cfb931e 那份 WIP·未验 测试里，
exp2/exp3 索引窄化），已随本轮修复收口，**现 datacore typecheck RC=0**）·
datacore vitest 全量：**仓主叫停于 124/362，18 条 × 判 NOT-ADJUDICATED**（详见末节「vitest 基线叫停记录」）。

---

## D4 · blockedPressure / costPressure 稳态 ⇒ **不带飞，CONFIRMED（采信级证据）**

复验方指出的洞（「3 拍不顶饱和不度量稳态不顶饱和」）已按派件补上：`steady-state.mjs`，
种子会话推至世界龄 **256 拍**（96 预滚 + 160 实测增量；预滚取证见下「播种模式」）。

**Model.costPressure 全量分布（n=6，世界龄 0/120/144/192/224/256 拍）**：

| 拍 | min | p50 | p90 | max | mean | ≥90 | ≥99 | =100 |
|---|---|---|---|---|---|---|---|---|
| 0 | 2.4653 | 2.9263 | 3.8858 | 3.8858 | 3.1569 | 0 | 0 | 0 |
| 120 | 1.6292 | 2.8361 | 2.8722 | 2.8722 | 2.4994 | 0 | 0 | 0 |
| 256 | 1.6288 | 2.8355 | 2.8715 | 2.8715 | 2.4986 | 0 | 0 | 0 |

D5 落点格（`obj_model_方形-LFP`）轨迹：3.8819 → 2.398979（120）→ 2.397368（256），仍在向静息点 0 衰减。
**256 拍处 6 格零格 ≥90，max 2.87 —— 离 clamp 100 有 34 倍余量** ⇒ 「稳态≈100 压扁差分」的前提不成立，
带飞裁决**不 flip**。且该世界含一条永久全距种子扰动（见下），无扰动的实验臂只会更平。

两个如实记录：
- **全世界在合并树上并未收敛到不动点**：相邻检查窗（32 拍）恒有 3,553 格在动（desat3 时代档案
  「12→160 拍逐字节不动」对合并树不成立）——但动的是别的道，costPressure 道在 1e-4 量级衰减尾上。
  「在动 ≠ 饱和」：压扁差分的机制是 clamp@100，没有任何格靠近它。
- blockedPressure 侧（twin-arms 已报）：tick0 130 格 [27.72, 182.73]、49 格 ≥100（§4 病灶的当前形态，
  禁碰文件 `seed-derivation-specs.ts:80` 物化域外值）——引擎 clamp+衰减 3 拍内拉回 ≤57.90，
  两臂同受、差分可消。只点名，不修不绕行。

## D6③ / D5 判据 · 指纹四数 ⇒ **通**

同一格 `obj_model_方形-LFP.costPressure`，两源各 +15（`pos_lfp` 17.815% vs `al_foil` 0.920%），
第 1 拍 trace amount（= 系数×源值×权重，引擎逐实例吐出的真「贡献」）：

| | pos_lfp | al_foil | 比 | 判定 |
|---|---|---|---|---|
| 改前（基线臂） | 0.055764605586 | 0.002879545929 | 19.365763547784688 | 已拉开 |
| 改后（+15 臂） | 0.473999147484 | 0.024476140398 | 19.365763546720444 | 已拉开 |

- 预言比 = 17.815/0.920 = 19.3641；实测三条口径（改前/改后/因果格增量 0.952297885471/0.049174300987）
  互洽到小数点后 9 位（19.3657635…），对 naive 占比比高 0.0084%（损耗率/逐行成本入权重，
  WO 引的 17.815/0.920 本身是舍入数）。
- **两数均非逐字节相同 ⇒ 9.75/9.75 指纹在合并树上不复现 ⇒ 通。**
- 金丝雀：① 落点同吃两源（7 行/拍）✓；② 两条零扰动臂终态**全世界 0 格差**（自漂移逐字节可消）✓；
  ③ 扰动真落上（两源 2→17，源值轨迹逐字节相同 ⇒ amount 比 = 权重比）✓。
- 对照 WO-COEF-FROM-BOM 时代修后数 1.7370/0.0897（19.37×）：比值一致，绝对值不同属预期
  （系数 0.65→0.423 经 inflowCoefficient、tick×4、tick0 真值基线不同）。

## D6① · 死胡同普查 ⇒ **28 真值变量，死胡同恰 1 个**

值差法 4,154 格 = 绑定法 4,171 − 撞值 17（标定值）；origin 28 个 (类型.变量) 按名全覆盖；oid→type 零漏。
逐条 asSource（升序，全表见 `asource-census.json`）：

- **asSource=0：`MaterialBalance.gapPressure`（9 格 / 9 对象）—— 唯一死胡同。**
  - 它是什么：MRP 缺口压力 = `gapTon×100/netDemandTon`（`seed-derivation-specs.ts:101`，实测 0–9），
    域表已登记（`battery.ts:3516` 压力族）。
  - 入边有：`demo_material_shortage_to_balance_gap`（Material.shortageRisk → gapPressure，×0.7）。
  - **为何判「结构性终态」而不是「待接线」**：`MaterialBalance` 类型**零条物化出向链路**——
    `material_has_balance`（Material→MaterialBalance）与 `exc_sourced_from_balance`
    （ExceptionEvent→MaterialBalance，battery.ts `batteryLinkTypes`）两条都是**入向**；
    50 条已发布边全部沿物化链路正向走（仓纪律「不新造链路」多处明文）。要接出边必须先造
    新 linkType = 另一张单的决策，**本单不造**。
  - 业务旁证：缺口信号的业务内容已由并行路径传出（`Material.shortageRisk` asSource=5，
    含 po_expedite / model_supply_risk / balance_gap 本身）——gapPressure 是 MRP 看板读数，
    与 backlog 三量同形态（终态指标，不是待接力压力）。
  - 若仓主裁决「缺口该驱动催单」：诚实路径 = 新造 `MaterialBalance→PurchaseOrder` 链路 +
    挂边（强度型、N 待定 ⇒ 归一口径按 D6② 判据选）——**另立 WO，本单只点名**。
- backlog 三量归档：`Order.qty/unitPrice/leadDays → Model.backlogQtyTop/PriceTop/HorizonDays`
  三条（weightRef null）——`combine:"max"` 直取某一张真单，加权即失真（seed.ts:1752–1835 注释链），
  刻意不进 STATE_VAR_DOMAINS（带单位的业务量，引擎不夹不衰减 + 回执点名）。**归档为终态量，不作缺陷。**
- 其余 25 个真值变量 asSource 1–5（最高 `Material.shortageRisk`=5）。

## D6② · forecast_bias 一条判定 + 4 口径出处 + N=1 判据

**forecast_bias（`demo_forecast_bias_to_order_demand`，weightRef null）⇒ 判：零信号态非死边，null 可留。**
- 源恒 0 **自核**：tick0 全体 6 个 Model.forecastBias = 0（spec `(totalDemand−Σ订单qty)×100/totalDemand`，
  种子订单恰好覆盖预测 ⇒ 平衡世界，非引擎病）。
- 触发实测（`obj_model_2170-NCM.forecastBias +20`，3 拍）：trace 25 行 / 25 目标 / **每目标入边 N=[1]** /
  |amount| max 4.44 ⇒ 源非零即发，且 N=1 ⇒ null 数学上恒权重 1（无操作）。金丝雀③ 咬到非零 amount 才算数。
- N=1 由结构保证：每单 `model_demanded_by_order` 恰好 1 条（25 目标 N 全部 = 1）。

**N=1 判据（答复验方②(b)）——同意「归档 + 防腐断言」，并给断言的落法：**
> 今天 N=1 ⇒ null 与 equal_share 行为逐字节相同，挂 11 条恒 1 权重是装饰。
> 病不是「null 丑」，是「link 实例涨到 N>1 时 null 从权重 1 静默变成权重 N，没有东西会红」。
> 防腐断言该钉在**静态链路表**上而不是 tick trace 上：
> **「每条 weightRef:null 的已发布边，在种子链路实例上逐目标入边数必须 = 1
> （目标为强度型 = 已登记 STATE_VAR_DOMAINS 者）」**——
> 落 datacore 既有套件的一条测试（直接建种子图数 link 实例，不起服务不推拍）。
> 静态的三大理由：① trace 量法有「未触发」洞（forecast_bias / customer_reaction 两条今天
> 就量不出 N，正好是本仓 §8 点名的陷阱）；② 种子图确定性 ⇒ 测试零flaky；③ 断言对象
> 正是病的滋生点（link 增长），不是病的症状（trace N）。
> 广延目标（backlog 三量等刻意无域者）按契约排除在断言外。
> ⛔ 写这条测试 = 动测试代码，按纪律**等派单方点头再写**（本报告只给判据与落法）。

**4 条非等份口径的业务出处（逐条三处对读：契约注册 / pair-weights 实现 / 挂边注释）——全部有出处：**

| 口径 | 挂边（fan-in N） | 出处（WO） | 计量值（契约 sim.ts / pair-weights.ts） |
|---|---|---|---|
| `bom_cost_share` | demo_material_price_to_model_cost（7.00） | WO-COEF-FROM-BOM | BOMDetail.quantity × Material.unitPrice × (1+lossRate) ÷ **整份 BOM** 成本；BOM 选取与 quote_margin 同支（`bom.ts` selectEffectiveBom/bomRowCost） |
| `source_qty_relative` ×2 | demo_order_demand_pressure（24.67）· demo_order_churn_to_model_demand_load（24.83） | （广延保总量） | 源 Order.qty ÷ 同组均值（均值=1、Σ=N）；广延型 demandLoad 专用，Σ=1 会把 83 单塌成均值 |
| `source_value_relative` | demo_order_cost_to_customer_receivable（8.82） | WO-EDGE-MONEY-WEIGHT | 源 Order.value（物化派生，与 finance-world `orderValue` 同式）÷ **全域**均值；修前病指纹：四家客户逐字节相同 15.137334 |
| `actor_exposure_relative` | demo_customer_reaction_cut_order（未触发，对抗边默认关） | WO-ADVERSARY-REACTION | Σ(名下订单 qty×unitPrice) ÷ **源池**均值（SOURCE_POOL_MEAN 为 1:N 扇出专设，组内归一在 1:N 上恒 1） |

## D1/D2/D3 · 复验方已采信（免重跑），留档链接

- ① 死胡同已大部分愈：终态差 5,287 = measured 4,151 + 传导 1,136（25 变量），450 时代 = 466（18）；
  五读数差 −202/0/0/−3.27/−12.02；占位臂 4,832 逐字节复现 450 时代 = 工具自证（`twin-arms-result.json`）。
- ② 43→34 null = 30×N=1 + 3 backlog 广延 + 1 forecast_bias（本报告 D6② 判毕）。
- ③ 未归一扇入已修：「需挂等份」= 0；N=43.33 的 wo_release_to_model_cost 已挂 equal_share（Σ=1）。

## 播种模式核查（仓主问「目前的播种模式是否正确」）

**正确**，但核出一个必须订正的标签：
- 内存模式 `SEED_DEMO=1` 是 CLAUDE.md 与铁律 1.5 判据三指定台；每脚本自起独立服务（seed 42 确定性），
  端口真 bind + lsof 咬 pid 自证，不连任何遗留服务。
- **种子会话播种时有意预滚 96 拍**：`DEMO_SIM_WORLD_TICKS = 96`（`seed-world.ts:129`），
  走 `POST …/tick` 同一生产闭包（:975），完成标记最后写（:982）；预滚期间施加一条永久全距种子扰动。
  desat3 档案「全新世界 curTick=3」已过期。
- `baseSnapshot` = **预滚前** tick0 原态（:834 派生 → :877 存入 → :975 才滚）⇒
  - twin-arms / census / D5：自建会话从 tick0 起，**不受影响**；
  - steady-state：检查点世界龄 = 0 / 120 / 144 / 192 / 224 / **256**（不是我中途口头说的「偏移 3–160」）——
    ≥96 拍要求满足且超一倍，裁决不变，本表已按真实拍数登记。

## 过程中的两个自曝（金丝雀咬出，均已修并重跑）

1. steady-state 首跑：trace 字段名猜错（实测 `fromObjectId/toObjectId`），金丝雀③当场咬住
  （42 行在、识别 0）；同病预防性修了 census。另补记初始 curTick 取证行。
2. census 首跑：金丝雀①把「值差法 4,154」与「绑定法 4,171」断言相等，死在已标定撞值 17 格上；
   拆成「容差 0–50」+「28 变量按名全覆盖」两半后全绿。

## vitest 基线 · 全量叫停记录（判 NOT-ADJUDICATED）

- 时间线：15:12–15:20 三次探针确认窗口干净（vitest 树根 2→1→0，量法过双向金丝雀）→
  15:21:28 起跑 datacore 全量（362 文件）→ 仓主叫停。**无 RC、终态汇总未打印 ⇒
  18 条 × 的断言原文不可恢复**（vitest 只在收尾汇总打印失败详情）。
- 收成：124 文件全 ✓；10 文件 ❯ 共 18 用例 ×：
  `seed-demo-propagation`(2) · `sim-seed-world.seam`(4/4) · `sim-order-real-fields.seam`(3) ·
  `sim-sessions-projection.seam`(3) · `dynamic-drill-resolve.seam`(1) · `engine-scope-fidelity.seam`(1) ·
  `factor-scope-singlesource.seam`(1) · `object-constraint-refs.seam`(1) · `m11-calibration`(1) ·
  `column-security`(1)。
- **为什么这 18 条 × 不可归因到合并树**（防泥潭纪律：污染窗口产物，不降 PASS 也不记 FAIL）：
  ① 单用例耗时 17s–**58min**、单文件最高 **75min**（`sim-seed-world.seam` 4 用例烧 4,527,806ms）——
  清洁环境应为秒–分钟级，这是 CPU 饥荒指纹，不是断言指纹；
  ② 17:41 起另一 agent（worktree `complete/.claude/worktrees/agent-a64bc25e38e6d3478`）并发
  datacore vitest，且**同跑 `seed-demo-propagation.test.ts`**（与 × 名单重叠）；
  ③ 起跑时窗口探针为 0 ⇒ 污染是中途侵入，不是起步误判。
- 与本单的关系：× 名单里的 `seed-demo-propagation`（铁律 1.5「9.75 不许再出现」守门文件）与
  `sim-seed-world.seam`（播种模式守门）正是 D5/播种核查的接缝 —— 但 D5 四数、普查、稳态全部是
  本目录脚本在**独立会话的当场实测**（RC=0、金丝雀在案），其结论不靠该污染窗口追认，也不被它推翻。
- 叫停后处置（19:09）：该 agent 两个孤儿 worker（ppid=1，父进程已死，合计 ~56% CPU 白烧）
  已按确切 pid 清掉；随后同一 worktree 起了新的单文件跑（`enterprise-state.seam.test.ts`，
  `--maxWorkers=1`）⇒ **datacore vitest 窗口此刻仍被占**，本机 ≤1 并发纪律下本单不抢。
- 重跑（仓主令「那 8 次测试需要重跑」）：`seam-recheck-run.sh` 编排 4 文件 × 各 2 次，
  窗口双零等待 + watcher 旁证。**8/8 已全部跑完（2026-09-18 14:52 收官）**，终表：

  | 文件 | p1 | p2 | 裁决 |
  |---|---|---|---|
  | ① seed-demo-propagation（修后验证） | **RC=0 · 19/19** | **RC=0 · 19/19** | ✅ 修复成立（§5 铁律门绿 + §6 主判据 0 格越界绿，65.8s 真跑） |
  | ② object-constraint-refs.seam | RC=1（⑤b :284） | RC=1（同病同断言） | 真红×2，根因见下「②③④ 根因」 |
  | ③ sim-order-real-fields.seam | RC=1（②③⑤） | RC=1（同病同断言） | 真红×2，根因见下 |
  | ④ sim-seed-world.seam | RC=1（⑤ :459，609.6s 真跑） | RC=1（同病同断言） | 真红×2，根因见下；①③④⑥ 四用例全绿 |

  **④ 的窗口污染排除**：p1（14:14–14:29）与 p2（14:29–14:52）断言逐字节同病（:459 expected 3861
  received 2445，确定性差异非时长病）；p2 尾段与 E2E 驱动的 Chrome 有 ~3 分钟重叠，但失败断言
  与 p1（无重叠）完全相同 ⇒ 环境只影响时长不影响结果。
  ②③ 的进度与首跑断言已在早前记录；下为全部三份的根因。

  **②③④ 根因（仓主令「找到根源去修复它」第二批）——三份全是同一家族：desat3 系数/权重改革
  改动了世界行为，而校准于改革前时代的测试期望没跟上；其中 ③ 查明是产品侧真账：**

  - **③ sim-order-real-fields ②③⑤（backlog 三量）⇒ 产品侧真账，点名交回 desat3，不修。**
    三条失败全部是**精确的 ×0.37 指纹**：:166 期望 22638 实测 8376.06（22638×0.37=8376.06）、
    :228 期望差 14677 实测 5430.49（×0.37 逐位吻合）、:262 期望 110 实测 40.7（×0.37 逐位吻合）。
    `git log -L` 实证：desat3 `81bd772e2`（WIP·未验 ②「50 条全经 inflowCoefficient」）把
    `demo_order_qty/unitPrice/leadDays → Model.backlog*` 三条边从系数 1 改成
    `inflowCoefficient(1)=1×λ=0.37`（λ=PRESSURE_DECAY_PER_TICK，battery.ts:735）。
    λ 因子只对每拍衰减的压力累加器是稳态中性的；这三条边 `combine:"max"` + `decay:null`
    （不衰减、max 直取某张真单），×0.37 就是**永久把看板读数砍到 37%**。
    且同一份 seed.ts 里这三条边的 description 至今写着「原样取最大值，不打折不加权」——
    **产品代码自相矛盾**（desat3 改革一刀切，未识别透传边对累加器逻辑豁免）。
    测试期望（ba30aa5d9 原契约：读数==真单真值）与 description 一致 ⇒ 账在产品侧。
    ⛔ 不修的理由：seed.ts 是产品代码（只量不修区）；把这三条改回系数 1 会改动世界态读数，
    D4/D5 基线全部要重钉 —— 这是产品决策，连同「description 与系数矛盾」一起点名交回。
    ⚠ 本报告 D6①「backlog 三量归档」措辞随之订正：weightRef null 判「刻意」仍成立；
    系数被静默改革成 0.37 这一点当时归档漏看，特此补记。
  - **④ sim-seed-world ⑤（:459 结构可达面 2445 vs 期望 3861）⇒ 同家族陈旧期望。**
    合并树 50 边（equal_share ÷N + 全系数 ×0.37）下，种子扰动的深跳尾 amount 经
    ×0.37^n 快速衰减、round12 截断后提前归零 ⇒ 真跑搬动格数 2445 < 改革前校准的 3861。
    两跑逐字节同病（确定性），与「去饱和」改革方向一致（深传导尾收缩正是设计意图）。
    判定：测试的 3861 是改革前校准常数；是否把期望改钉 2445 属派单方裁决（同 ① 的 3-hop 案）。
  - **② object-constraint-refs ⑤b（:284 实例选择）⇒ 唯一不属于系数家族的。**
    非数字属性（Line.name）上按值比选实例：测试期望选 name 最大 `zigong-pack`，
    引擎实际选 `jinhua-calendering`（既非 name 最大也非 id 最小 `changzhou-assembly`）。
    选择逻辑根因追查中（本报告后续补记）；两跑同病 ⇒ 确定性真红。

**修复（仓主令「找到根源去修复它」，2026-09-18；commit 508a81e5c + 窄化补丁）——
根源不是引擎，是 desat3 两个 `WIP·未验` 提交（f5cfb931e 测试 / e18e1eed9 实现）从未真跑过：**

- ① 3-hop 用例：注释算术（`10×0.08917×0.5=0.44585`）与引擎产出**逐位吻合**，唯一错的是取乘数的
  `weightSumOf`——把「全目标权重和」（equal_share 恒 Σ=1）当成「单源触发那一对的权重」，
  期望凭空大 N 倍。修为 `pairWeightOf`：按 (ruleKey, 开火源, 目标) 取**那一对**的 weight；
  挂了 weightRef 而 explain 缺行 ⇒ 报「取数坏了」**⛔ 不许静默回落 1**（空集上「和=1」恒真，
  正是本仓点名的陷阱）；`weightRef:null` ⇒ 单源乘数恒 1。顺带收口两条**前置** TS 错
  （exp2/exp3 在 `Record` 索引值上做算术，noUncheckedIndexedAccess 下是 `number|undefined`；
  基线没看见它们是 `pnpm -r` bail 截断所致）——`?.` + 存在性金丝雀，
  「格读不到」与「数值不对」分开报。
- ② §6 用例：`getTickState` 返回整行 `SimTickState`（app.ts 全部 6 个调用点都取 `.state`），
  用例把整行当世界态喂 `overDomain` ⇒ 包装层数格、`declared` 恒 0。修为解包 `last.state`
  （主判据与 blockedPressure 检查两处）。
- 修后复验：编排器重跑 4 文件 × 各 2 次（文件① = 修后验证，文件②③④ = 原范围剩余），
  跑完补全表。若 §6 主判据（末拍 0 格反算越界）不过，那是 desat3 ①②③ 的**产品侧**真账，
  本单只点名不修（`seed-derivation-specs.ts` 仍禁碰）。

## 剩余

- datacore vitest 基线：见上节 —— 全量已被叫停，剩 10 个 ❯ 文件的归因重跑，等点头。
- N=1 防腐断言的实现：判据与落法已给（D6②），**等派单方点头**再写测试代码。
- MaterialBalance.gapPressure 若要接出边 = 新造链路，另立 WO（D6① 已点名）。
