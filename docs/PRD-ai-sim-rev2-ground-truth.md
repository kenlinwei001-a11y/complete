# PRD 修订 2 · 真实结果回流面（WS-F）

> **本文是对 `docs/PRD-ai-sim-industrial-grade.md` 的修订，不是替代。** 原文 WS-A/B/C/D/E、
> G1–G8、§10 测试方案**全部保留**；本文只改动下列具名条目，并新增 WS-F。
>
> **来历**：一轮「五条改动」提案被 dev 逐条实测顶回来，六条中我全盘接受五条、自核推翻一条。
> 修订后只剩**一件 P0**，其余全部降级或改锚。

---

## §0 本修订的唯一结论

上一版提案（B7 代理模型 / C5 结构校准 / C6 经验库 / A10 搜索环 P0 / 改 doctrine）里，
**三条建在一个本系统没有的东西上：真实结果回流面**。

| 提案 | 被顶回的理由（dev 实测） | 裁决 |
|---|---|---|
| A10「推翻先验」当度量 | 确定性仿真按构造永远服从自己的规则，**仿真推翻不了仿真**；度量语义为空 | **改锚**（见 §3.4） |
| C5 结构校准 | 对已发射规则 = 把自己放进去的数再读回来（循环论证，零信息） | **降级 + 收窄**（§3.2） |
| C6 推演经验库 | 封闭世界里「实际」只能由仿真产生 ⇒ 记的是「仿真 vs 仿真」的自洽日志 | **移到 F 之后**（§3.3） |

**同根**：三条都假设了一个真实结果回流面。而实测——配对机制**在**
（`apps/datacore/src/solvers/service.ts:6764 recordCalibrationForecasts`，调用点 `:6417`），
**燃料为零**（原 PRD §C1 证据 S6：`paired:0`，仅有的提案是 `calp_demo_seed_*`）。

⇒ **本修订的全部内容：把那个面建起来，并把它的空显式量出来。**

### §0.1 原 PRD 没有说谎，是我越界了（修辞订正）

原 §0.1 把「企业真实数据接入」列为**外部依赖、明文不在 M1–M5**，同时把「世界模型保真度」
列为**不承诺**。**这两条互相一致。** 上一版提案说「天花板焊在 §0 那行分工铁律」是**半个稻草人**：
§0.1 是诚实的范围声明，我自己也把它列进「不许改」。
**真正缺的不是那行字，是 WS-F 这块肉。**

⚠ 但 **doctrine 那一条仍然成立且本修订保留**：架构图 ③ 环写「LLM 禁入」是对的，
写成「演化层 = 手写传导边」是一个**隐含的错误二分**——该禁的是**不可复现、不可审计的生成**，
不是**从数据拟合出的模型**。拟合模型同样满足 R6（同数据同参数同输出）、G2（系数有出处）、
T1（可对照实验证伪）。**禁生成，不禁拟合。**

---

## §1 一处事实订正（本修订自核，与 dev 反馈不同）

dev 反馈称：43 条 `weightRef=null` 的边「被 `NO_WEIGHTS` 诚实跳过、**从未发射**，
仿真数据里根本没有它们的信号，**数学上不可识别**」。

**实测不成立**（`apps/datacore/src/sim/propagation.ts:842-855`）：

```js
if (rule.weightRef) {            // ← 只有**声明了** weightRef 的才进这个分支
  const w = pairWeights[rule.key];
  if (w === undefined) { unresolvedWeights.push({ reason: "NO_WEIGHTS", … }); continue; }
  weights = w;
}
```

`NO_WEIGHTS` 跳过只作用于**声明了 `weightRef` 但算不出权重表**的规则。
`weightRef: null` 的边**根本不进这个分支**，照常传导，走不加权支路
（原 PRD §B6 自己写的也是「走**不加权支路**」）。

⚠ 金丝雀辨析：`pair-weights.ts:31` 那句「没有规则声明 `weightRef` ⇒ **一次对象读都不发**」
讲的是**性能**（不去读对象算权重），**不是不传导**。反馈把这两件事合并了。

**⇒ 结论改写（差别是实质的）**：那 43 条边**发射、在仿真轨迹里有信号**。
所以不是「数学上不可识别」，而是——

> **从仿真数据学不到**（信号由等权假设自己造出，循环）；
> **有了真实观测就可识别**。

后者留了路径，前者堵死了路径。**C5 因此是「降级+收窄」而不是「删除」。**

---

## §2 WS-F · 把已有的摄取面接成回流面（P0，其余学习类需求的前置）

### §2.0 ⚠ 本节的第一版前提是错的，实测推翻后范围缩了一个数量级

**错的原文**：「本系统没有真实数据回流面，WS-F 要建一条管道」。
**实测（`apps/datacore/src/connectors/registry.ts:315-325` + `service.ts:283-308`）**：

| | 实测 |
|---|---|
| `createAdapter` 支持的类型 | **6 个**：`file_upload` · `rest_api` · `prototype_html`（真实）+ `mock_erp/crm/external` |
| 摄取实现 | **完整**：`listDatasets()` → `fetchBatch(name, cursor)` 游标分页 → RawDataset → materialize，`fetchImpl` 真发请求 |
| 注册了但**无适配器** | `sap_erp` · `salesforce_crm` · `generic_jdbc` · `knowledge_base` · `external_feed`（`service.ts:187` 兜住「未实现」抛错，避免 500） |
| 连接测试 | `connectors/probe.ts` 真发 `fetch` + 细分错误类（曾有事故：`host=nonexistent.invalid` 返 `{ok:true}` 6ms） |

⇒ **`rest_api` 与 `file_upload` 两条真实摄取路径今天就是通的**，而这两条恰好就是回流面需要的。
**原提案是在重造已有的东西。**

### §2.0.1 ⚠ 仓主定义（2026-09-19，本 PRD 全文以此为准，覆盖此前一切表述）

> **只要是数据库里的数据就是真实数据（合成的也算）；只存储在前端的数据就是 mock 数据（假数据）。**

**这条定义把两个被我混在一起的轴分开了，必须分开谈：**

| 轴 | 判据 | 本 PRD 的用词 |
|---|---|---|
| **数据真伪** | **落不落库**（仓主定义） | 真实数据 / 假数据 |
| **校准有效性** | 结果是不是由**被校准的那套规则自己**生成的 | 可校准 / 循环 |

⚠ **两轴正交，不许互相冒充**：一份合成但落库的结果**是真实数据**，
但拿它去校准**生成它的那套规则**仍然循环（零信息）——
**那是「循环」，不是「假数据」。此前本文把后者说成前者，是错的。**

**按此定义，本仓当前划线（实测）**：

| | 实测 | 判定 |
|---|---|---|
| 后端世界快照（含 45 格占位） | 落库 `repos.sim.putTickState`（`app.ts:2092/2526/2806/2957`） | ✅ 真实数据 |
| `synthetic/service.ts:663-668` 那 6 条 `rest_api` 连接记录 | 落库 | ✅ 真实数据（此前本文判它「很像真实其实不是」，**判错了**） |
| **前端 `deriveBaseSnapshot`**（`views/sim/edgeActiveModel.ts` → `EdgeActivePanel.tsx:213`） | **只在浏览器算，不落库** | ⛔ **假数据，且今天仍在生产路径上** |

⇒ **新增 F0（P0）：清掉仍在生产路径上的前端自造数据。**
沙盘那单曾做掉后端半（服务端现派生 + 逐格出处，已并入 `27d44823`），
但**前端半按指令回退了**（为避与 `resolveTick0World` 撞车）⇒ 假数据仍在。
**验收**：`grep deriveBaseSnapshot apps/frontend-shell/src` 在生产路径零命中；
🐤 金丝雀：同法查 `resolveTick0World` 必须有命中（证明查法有效、且替代路径真的在）。

### §2.1 真正的缺口（缩到两件）

| 环节 | 现状 | 缺口 |
|---|---|---|
| 把外部数据拉进来 | ✅ 适配器已通 | — |
| 落成对象 | ✅ RawDataset → materialize | — |
| **标成「某次预测的实际结果」** | ⛔ 无 | **F1 配对键** |
| **量「还差多少对」** | ⛔ `paired:0` 没有期望值 | **F2 欠账计** |

**⛔ 不许用种子/合成数据冒充实料**——那正是本仓反复炸的那个病。

### F1（P0）配对键：把摄取行认成某次预测的 actual

**证据**：配对机制已在（`solvers/service.ts:6764 recordCalibrationForecasts`，调用点 `:6417`），
缺的是 actual 那一侧的**认领规则**，不是摄取能力。

**需求**：
- 契约新增 `RealizedOutcome{ tenantId, subjectRef{typeKey,objectId,prop}, asOf,
  value, unit, source: INGESTED|WORK_ORDER_CLOSURE|MANUAL_ENTRY,
  provenance{ connId?, syncJobId?, datasetKey?, rowRef?, importedBy, importedAt } }`
- **主入口 = 已有摄取面**：`file_upload` / `rest_api` 同步落的行，按**数据集级映射**
  （`datasetKey → subjectRef 字段映射 + asOf 字段`）自动登记为 `RealizedOutcome`，
  `source:"INGESTED"` 且 `provenance` 带 `connId/syncJobId/rowRef` ⇒ **每条实料可追回哪次 sync 的哪一行**
- 次入口两条：工单结案回写（接原 PRD C3）· 人工录入（审计留痕）
- ⛔ 连接记录的 `connectorTypeKey` 是 `mock_*`，或该连接**从未跑过 sync**（无 `syncJobId`）⇒
  **拒绝登记为实料**，并在回执点名（这一条直接防 §2.0 那个「记录真实、数据合成」的形态）

**对照实验验收（T4）**：
① 用 `file_upload` 真传一份 CSV ⇒ 落 `RealizedOutcome` 且 `provenance.syncJobId` 可追回那次 sync；
② 拿 `synthetic/service.ts` 造的那 6 条 `rest_api` 连接之一去登记 ⇒ **拒绝并点名「无 syncJobId」**；
③ 🐤 金丝雀：登记前 `paired` = N、登记并配对后 = N+K，**两个数都打出来**（为 0 可能是取数坏了）。

### F2（P0）配对与欠账计 `CalibrationDebt`

**证据**：`paired:0` 亮在屏上/回包里，**没有期望值** ⇒ 读的人无从判断 0 对不对。
（本仓同族前科：`实测格 0/7295` 在用户屏与启动日志里亮了几个月，无人动，因为它没有目标。）

**需求**：
- `recordCalibrationForecasts` 的每条预测，按 `subjectRef + asOf` 与 `RealizedOutcome` 配对
- 新增只读端点 `GET /a/v1/calibration/debt` ⇒
  `{ forecasts:N, paired:P, unpaired:U, coveragePct, expected:{ minPaired, rationale },
     byMetric:[{metricKey, forecasts, paired}], oldestUnpairedAgeDays }`
- **`expected` 必填**——⛔ 没有期望值的指标是装饰不是监控
- 该读数**必须上屏**且**必须进 build 输出**（欠账报给能修的人，不只报给用户）

**对照实验验收（T1+T3）**：
① 无实料时 ⇒ `paired:0 · expected.minPaired:N · coveragePct:0`，屏上与回包一致；
② 录入 M 条实料并配对 ⇒ 三个数同步变，且 `oldestUnpairedAgeDays` 单调；
③ 🐤 金丝雀：`forecasts` 必须 >0（为 0 说明取数坏了，不是「没有欠账」）。

### F3（P1）实料闸：学习类能力的统一准入

**需求**：`B7 / C5 / C6 / A10` 四项**运行时读同一个闸** `calibrationDebt.paired >= minPaired`；
未达标时该能力**拒绝启用并披露原因**（⛔ 不许降级成「用仿真数据凑合跑」）。

**对照实验验收（T2）**：`paired` 人为置 0 ⇒ 四项全部拒绝启用且各自披露；
置到阈值以上 ⇒ 全部放行。**变异反证**：把闸关掉 ⇒ 该门必须红。

---

## §3 原提案的修订（逐条替换）

### §3.1 B7 代理模型（P2，保留，但价值重新定义）

**改**：B7 的价值**不是「变准」**（那需要实料，见 F），而是**提供一个可分叉的对照面**——
手写传导边与拟合响应面**双臂并存**，两臂差异超阈即报警。
在实料到位前，B7 只能用**留出的仿真轨迹**训练，此时它度量的是「拟合器能否复现规则」，
**必须如实标注 `trainedOn:"SIMULATION"`，⛔ 不许当作保真度证据**。

**验收（T1）**：同扰动两臂各跑 ⇒ 差分逐格可比；`trainedOn` 标注缺失 ⇒ 门红；
实料到位后 `trainedOn:"REALIZED"` 的臂在留出集上 MAPE 优于手写臂 ⇒ 才允许成为默认，且一键可退。

### §3.2 C5 结构校准（P2，收窄到「有实料覆盖的边」）

**改**（依 §1 的事实订正）：
- 只对 **`CalibrationDebt.byMetric` 中 `paired>0`** 的那些边开放权重/系数回归；
- 其余边（含 43 条 `weightRef=null`）**如实标注 `calibration:"NO_REALIZED_DATA"`**，
  ⛔ 不许用仿真轨迹回归它们（循环论证，零信息）；
- ⚠ **因果等价类必须显式**：观测数据分不清等价结构，人审同样分不清。
  终态不是「学出来、人只审异常」，而是：
  **回归提议 → 干预实验破等价 → 人审定植 → 剩余等价类诚实标注**。
  `EquivalenceClass` 进 disclosure，⛔ 不许把一个等价类里的某个解报成唯一解。

**验收（T2）**：对一条 `paired=0` 的边发起回归 ⇒ **拒绝并点名**；
对 `paired>0` 的边回归 ⇒ 产出提议 + 其等价类成员清单。

### §3.3 C6 推演经验库（P3，移到 F 之后）

**改**：三元组 `(扰动, 预测, 实际)` 的第三腿**只能来自 F1**。
在 F 未通闸前 **⛔ 不建此模块**——封闭世界里它记的是「仿真 vs 仿真」的自洽日志，
R6 平凡成立，学不到任何关于世界的东西。
**验收**：`paired=0` 时调用经验库 ⇒ 拒绝并披露（走 F3 同一个闸）。

### §3.4 A10 假设搜索环（P1，降级 + 度量改锚）

**改一（优先级）**：原提案定 P0 是**依赖倒置**——让 agent 自主搜索一台
还不会预言、也没有真实数据的封闭世界，预算烧在噪声上。
**降 P1，准入闸 = F3**。

**改二（度量改锚，这是关键）**：

| 原提案度量 | 问题 | 改为 |
|---|---|---|
| 「单位预算内**推翻的先验**条数」 | 确定性仿真按构造服从自己的规则，**仿真推翻不了仿真**，语义为空 | 拆成两个 |

- **仿真内可交付的**：`意外场景命中数`（规则产出出乎人意料）+ `规则冲突检出数`
  （clamp / 饱和 / 节拍闸互相打架）。两者都可度量、都有用，**但都不叫推翻**。
- **真正的「推翻」只计两种**：① 与 **`RealizedOutcome` 对照**产生的分叉；
  ② 与 **B7 代理模型**产生的分叉。⛔ 仿真内的分歧不计入推翻。

**验收（T1）**：构造一个已知的规则冲突场景 ⇒ `规则冲突检出数` ≥1；
`paired=0` 时读「推翻数」⇒ 必须返回 `null` 并标 `NO_GROUND_TRUTH`，⛔ 不许返回 0
（0 会被读成「查过了没有」，而真相是「没法查」）。

### §3.5 A12 `propose_model_change` 工具（P2，保留原样）

agent 可提出「这里应该有一条边 / 这个系数不对」，**走 Action 审批 + 必须附对照实验证据**，人裁决。
**这是「AI 参与推演」与「AI 操作推演器」的分界线。**
⚠ 在 F 通闸前，该工具的提案**必须标 `evidence:"SIMULATION_ONLY"`**。

---

## §4 A11 解释切片 ≤20 节点（P0，⑤⑤⑥两环的前置）

**证据（实测）**：原 PRD §1.1 把「本体切片 **GLOBAL 12,499 节点 / 13,533 边 0 丢弃**」
列为**已验证资产**。实测：**那不是切片，是整个世界没被裁剪**——
裁剪机制 `apps/datacore/src/sim/propagation-inputs.ts:108 scopePropagationGraph` 存在且工作
（旁注明写分摊权重必须吃已裁剪的图，否则「范围裁剪白做了」），
**是控制台那次没传 scope**，走了退化的 `GLOBAL`。

**⇒ §1.1 该行订正为「计算范围（未裁剪）」，不是「切片」。**

**为什么它是 P0**：12,499 个节点**喂不进任何模型**，也没人读得懂 ⇒
⑤解读、⑥新假设两环在架构上被卡住。

**需求**：从已完成的 trace 反向收敛出目标格的因果子图，**只读投影、不参与计算**。
- ⛔ **计算范围不许卡 20**：铝箔涨价传到 5 个型号的 `costPressure`，这条真实链本身就超 20 节点，
  卡死会切断传导，得到的不是「小切片」而是**错的推演**；
- 骨架已在 canonical（`apps/datacore/src/sim/explain-slice.ts`，提交 `7ed06ee4`，**WIP·未验**），
  `PropagationTrace{ruleKey,fromObjectId,toObjectId,amount,viaLinkKey}` 本身就是带权有向边表。

**⛔ 硬判据**：`coverage` 必填——一张 20 节点的图解释一条 6,770 边的链**必然残缺**，
必须报出 `{truncated, droppedNodes, droppedEdges, amountCoveredPct}`。
不报 = 拿残图冒充全图。

**验收（T1+T3）**：
① 取一次真推演的 trace，对某目标格建切片 ⇒ 节点 ≤20 且 `amountCoveredPct` 与手算一致；
② 🐤 反向：把 `maxNodes` 设为超过全链节点数 ⇒ `truncated:false · amountCoveredPct:100`；
③ 🐤 存在性：trace 行数必须 >0（为 0 说明取数坏了，不是「没有因果链」）。

---

## §5 修订后的里程碑（替换原 §8 相应行）

| 程 | 内容 | 出口判据 |
|---|---|---|
| **M0（新）实料地基** | **F0 F1 F2 F3 · A11** | 前端自造数据在生产路径零命中（F0）；摄取行可登记为 `RealizedOutcome` 且 provenance 可追回 syncJobId（F1）；`GET /calibration/debt` 带 `expected` 且**同时上屏与进 build 输出**（F2）；四项学习能力统一闸生效且变异反证过（F3）；解释切片 ≤20 且 `coverage` 必填（A11） |
| M1 审计地基 | A1 A2 A3 B5 D1 | *（原文不变）* |
| M2 编排闭环 | A4 A5 A6 A7 A8 A9 **A12** | *（原文不变）* + A12 提案标 `evidence` 档 |
| M3 推演科学 | B1 B2 B3 B6 **B7** D2 D3 | *（原文不变）* + B7 双臂并存且 `trainedOn` 必标 |
| M4 V&V 闭环 | C1 C2 C3 **C5** C4 | *（原文不变）* + C5 只对 `paired>0` 的边开，等价类进 disclosure |
| M5 工业化 | N1–N9 D4–D7 **C6 A10** | *（原文不变）* + C6/A10 过 F3 闸 |

⚠ **M0 是新增的第一程**，且**不依赖外部商务**——这一条在 §2.0 实测后改写过：
原以为要等企业数据接入，实测 **`file_upload` 适配器今天就能把实料录进来**
⇒ **`paired > 0` 是今天可达的目标，不是外部依赖。**

⇒ 因此原 PRD §0.1 里「企业真实数据接入 = 外部依赖、不在 M1–M5」这条**需要分成两半**：
**「拿到企业的数据」仍是商务/部署**（不承诺）；
**「系统能不能消费实料」不是**——今天就能，缺的只是 F1 那层配对语义。
**⛔ 不许再用前者当后者做不了的理由。**

---

## §6 不改的（避免误伤）

- G1–G8 毕业判据 · A1/A2/A3 审计地基 · A7 引用绑定 —— 做得扎实，原样保留
- 「LLM 禁入演化层」—— 对的；只是别把它等同于「禁止拟合」（§0.1 doctrine 订正）
- §10 测试方案 T1–T6 —— 今天的实测反复证明这套纪律是本仓最值钱的资产
- 原 §0.1 四层「明文不承诺」—— 诚实边界写得好。**M0 通关后，「世界模型保真度」一层从
  「不承诺」改为「有收敛机制、待实料」**，其余三层维持

## §7 证据索引（本修订新增部分）

- `apps/datacore/src/sim/propagation.ts:842-855`（`NO_WEIGHTS` 真实语义，§1 订正的出处）
- `apps/datacore/src/sim/pair-weights.ts:31`（性能判据，易被误读成「不传导」）
- `apps/datacore/src/solvers/service.ts:6764 / :6417`（配对机制在、燃料为零）
- `apps/datacore/src/sim/propagation-inputs.ts:108`（裁剪机制存在，§4 订正的出处）
- `apps/datacore/src/sim/explain-slice.ts`（A11 骨架，`7ed06ee4`，WIP·未验）
- 原 PRD §C1 证据 S6（`paired:0` 与 `calp_demo_seed_*`）
- **§2.0 那次推翻的出处**：`connectors/registry.ts:315-325`（`createAdapter` 六个 case）·
  `connectors/service.ts:283-308`（摄取真实现）· `:187`（未实现类型的兜底）·
  `connectors/probe.ts`（连接测试真发 fetch）· `synthetic/service.ts:663-668`
  （合成播种器造的 6 条 `rest_api` 连接记录 —— 「记录真实、数据合成」的样本）

---

## §8 本修订自身的两次被推翻（留档，因为它们是同一个形态）

| 次 | 我断言的 | 实测 | 形态 |
|---|---|---|---|
| 1 | 43 条 `weightRef=null` 的边「从未发射、数学上不可识别」（照录 dev 反馈） | **发射的**，走不加权支路；`NO_WEIGHTS` 只作用于**声明了** `weightRef` 却算不出权重表的规则 | 「我用『反馈里这么说』当作『代码这么做』的证据」 |
| 2 | 「本系统没有真实数据回流面，要建管道」 | `file_upload`/`rest_api` 适配器**已通**，缺的只是配对语义 | 「我用『校准管线 paired:0』当作『摄取能力不存在』的证据」 |

两次都是**把一个相关的读数当成了另一个命题的证据**。
⇒ 本 PRD 每条「现状」断言都标了 file:line，**收编方请照着复算，别照抄。**
