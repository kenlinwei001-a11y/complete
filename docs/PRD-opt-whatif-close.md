# PRD · 把 `optimize_whatif` 从「路由通但拿不到结论」推到「真出结论」

> WO-OPT-WHATIF-CLOSE · 2026-08-08 · 基线 `988db557`（正线 `claude/inspiring-gates-aqczjg`）
> 分支 `claude/handoff-wo-opt-whatif-close`（含 cherry-pick 过来的 WO-OPT-WHATIF-DATA 六个提交）
> 一句话：上一单把「`Base` 没有成本字段」补上了，断点随即**右移一格**——装配器选 client 类型时
> **不问这个类型有没有实例**，赢家恰恰是零实例的 `MaintenanceOrder`，于是链路照断、用户照样拿不到结论。

---

## 0. 本单结论速览

| 项 | 结论 |
|---|---|
| 病灶三分法（铁律 0.5） | **接了线接错地方**（装配器接线正确、但选候选的判据缺了两条）＋ **接了线没数据**（`MaintenanceOrder` 生成了没落库） |
| 采用修法 | **(A) 引擎半 + (B) 数据半 都做**，但 (A) 是**两条判据**不是一条（见 §3） |
| 头号证据 | 问句实参 → REST invoke → **orchestrator 降级判据（`orchestrator.ts:1047` 字面镜像）为假** → 最优设施 `handan → changzhou` 真切换，Δ目标 `-6589.42` |
| R6 | 同 seed 两跑 `JSON.stringify` 逐字节一致（新落库的 193 行与新排序判据都在里面） |
| 遗留（诚实边界） | NL 抽取器 `extractTargetId` 要求**问句里出现 objectId 原文**；demo 前端下发的是 `base-常州` 形态 → 中文问句仍抽不到决策对象。**属 AgentCore/前端半，超本单范围边界，未修**（§7） |

---

## 1. 复核三条（工单点名要我自己核的）

### 1.1 复核① `clientCands` 的排序判据

工单转述「fanOut 降序 → 字典序」——**核对属实**，原文（改动前 `solvers/service.ts:3734-3736`）：

```ts
const clientCands = types.filter((t) => t.key !== decisionType && lexiconHit(t.key, "leaf"))
  .sort((a, b) => fanOut(b) - fanOut(a) || a.key.localeCompare(b.key));
const clientType = clientCands[0]?.key;
```

`fanOut(t) = t.properties.filter(p => p.dataType === "ref" || p.refToTypeKey).length`；
`lexiconHit(key,"leaf")` 的词库是 `field-role-lexicon.ts:19` `/客户|customer|订单|order|买家|buyer|终端|leaf/i`。

**真跑 `seedBattery` 后 dump 的完整候选表（不是 grep，是把装配器那段排序原样跑一遍）：**

| 排名 | typeKey | fanOut | 实例数 | 有 ref 指向 `Base` |
|---|---|---|---|---|
| 1 | `MaintenanceOrder` | 3 | **0** | ✅ `baseId` |
| 2 | `WorkOrder` | 3 | 260 | ✅ `baseId` |
| 3 | `OrderLine` | 2 | 38 | — |
| 4 | `OrderPromise` | 2 | 24 | — |
| 5 | `CustomerLocation` | 1 | 12 | — |
| 6 | `Order` | 1 | 24 | — |
| 7 | `PurchaseOrder` | 1 | 30 | — |
| 8 | `Customer` | 0 | 8 | — |

`MaintenanceOrder` 与 `WorkOrder` fanOut 同为 3，字典序 `M < W` ⇒ 赢家 `MaintenanceOrder`，**零实例**。
另测得 demo 共 94 个 ACTIVE 类型，其中 **9 个零实例**：`AdoptedMitigation / ProductionSchedule / ShiftPlan /
WIPMove / WIPQualityCheckpoint / MaintenanceOrder / SparePartConsumption / OperatorAttendance / OperatorSkillCert`。

### 1.2 复核② `MaintenanceOrder` 是不是真的该被物化 —— **两问要分开答**

工单提示「也可能它本就不该出现在候选里」。核完的结论是：**这两件事都成立，且互相独立**。

**(a) 它该不该在库里？—— 该。** 判据逐条：

| 证据 | 锚点 | 说明 |
|---|---|---|
| 类型声明完整 | `battery.ts:1581 maintenanceOrderProps` → `battery.ts:2300 plain("MaintenanceOrder", …)` | 11 个属性、主键 `moId`、3 个 ref（equip/line/base） |
| 展示名齐 | `battery.ts:1973-1978` | 逐字段中文展示名 |
| 连接器映射齐 | `battery.ts:1699` | `conn-eam` / `eam_maint_orders` / 11 字段 fieldMappings |
| 数据类目在册 | `synthetic/data-categories.ts:53` | `equip` 域·`SYSTEM_INTEGRATION` 默认模式 |
| 链路类型在册 | `battery.ts:2402-2403` | `maint_for_equip`(→Equipment) · `spare_for_maint`(SparePartConsumption→) |
| 生成器确定性产出 | `battery.ts:4303` 起 | 193 行（S/M/L/XL 同值）·全部 `hashString` 派生·**零 rng 消耗** |
| 唯一缺的一环 | `synthetic/service.ts` 物化清单 | **没有它** ⇒ 上面全部接线是死的 |

排除「它属于故意不物化的那批」：物化清单原注释写明豁免的是
「高量低值执行类(ShiftPlan/ProductionSchedule/WIPMove/操作工考勤等)…避单次 seed 逾万对象拖垮」——
`MaintenanceOrder` **不在那份点名清单里**，且 193 行**比已物化的 `WorkOrder`(260) 还少**，
不构成体量理由。同批「生成器已产、物化清单漏」的 5 类（WorkOrder/WIPLot/QualityLot/InspectionResult/
EquipmentOEE）上一轮已补齐，本类是同一笔欠账的尾巴。⇒ **(B) 成立：补物化不是"引入不该有的数据"，是补一个本就该有的数据。**

**(b) 它该不该当 `facility_location` 的 client？—— 不该，而且 `WorkOrder` 也不该。**

`facility_location` 的 `client` 语义是**需求点**（被设施服务、可自由指派的对象）。
词库命中的是**英文子串 `order`**：`MaintenanceOrder`(设备维修工单) / `WorkOrder`(生产工单) /
`PurchaseOrder`(采购订单) 三个都是**假阳性**——中文里它们是「工单」不是「订单」。
更硬的结构判据：这两个类型都带 `baseId → Base` 的 ref，即**已经绑死在某个设施上**，
不是可自由指派的需求点，而是**该设施自己的从属记录**。

这条复核直接改写了修法：**只做「跳过零实例类型」是不够的**——它只把赢家从
`MaintenanceOrder`(0 实例) 推到 `WorkOrder`(260·生产工单)，用户拿到的结论会是
「开 1 个设施服务 **260 个生产工单**，每张工单一份干线履约成本」——
`Base.serveCost` 的口径是「万元/**需求点**·年」，把生产工单当需求点算，是
**plausible-but-WRONG 的自信错答**（R-ARG-FIDELITY：静默错答比崩溃更危险）。

### 1.3 复核③ 补物化会不会破 R6 确定性 —— 不会

- `generateBattery` 的 193 行全部由 `hashString(...)` 派生（`battery.ts:4303-4324`），**不调 `rng()`**
  ⇒ rng 消耗序列一字不动 ⇒ 下游合成值零位移。
- 物化本身是 `putAll` **纯投影**（无 `Date.now`、无随机、id 由主键确定性派生）。
- 门：`test/opt-whatif-close.seam.test.ts ⑥` 同 seed 两跑 `JSON.stringify` 逐字节一致；
  `test/opt-whatif-base-cost.seam.test.ts ③` 同款断言（上一单留下的）继续绿。
- 全量 datacore 套件复跑核对金值（§6）。

---

## 2. 病根：断点在哪一格（沿链路走）

```
用户问句
  └─ AgentCore resolveOptWhatifRoute (opt-whatif-route.ts:107·R6 纯正则)
       → {family:"facility_location", selection:[Base×13], perturbations:[facilities.changzhou.openCost=150]}
  └─ orchestrator.runOptWhatifRoute (orchestrator.ts:1037)
       → invoke_solver("optimize_whatif", {family, selection, autoBind:true, perturbations})  ← OBO 打 DataCore
  └─ DataCore POST /a/v1/solvers/optimize_whatif/invoke → optimizeWhatif → assembleBaselineFromSelection
       ├─ open_cost 绑定 …………………………… ✅ 上一单已闭（Base.openCost/serveCost）
       ├─ client 类型选取 ……………………… ❌ **本单病灶**：clientCands[0] 不问有无实例 ⇒ MaintenanceOrder(0)
       └─ bindToSolverArgs → clients=[] ⇒ facilityLocation 抛「需 facilities[] + clients[] + assignCosts[]」
  └─ orchestrator.ts:1047  `if (!run.ok || !data || data.applicable === false)`
       → emit("routing.degraded", {reason:"optimize_whatif 未接入/被门(...)", fallback:"path-B"})
       → runPathB  ⇒ **用户拿到的是泛答，不是优化结论**
```

**注意降级判据有两半**：`data.applicable === false`（装配报缺）**与** `!run.ok`（invoke 抛错）。
上一单闭的是第一半，本单的病走的是**第二半**——所以只断言 `applicable !== false` 的测试**看不见这个病**。
本单的头号断言因此写成 `orchestratorWouldDegrade()` 整条谓词的字面镜像。

---

## 3. 修法与理由（工单要求我自己裁并写明）

### 3.1 裁决：**(A) 与 (B) 都做**，且 (A) 拆成两条判据

| 判据 | 位置 | 类型 | 作用 |
|---|---|---|---|
| **A1 有实例** | `assembleBaselineFromSelection` → `rankRoleCandidates` | **硬过滤** | 零实例候选绑上去必产空数组 ⇒ 装配"成功"而链路照断。过滤掉它们；全空则 `applicable:false` 并**点名**空候选 |
| **A2 非从属** | 同上 | **软降权**（排序首键） | 候选若带 ref 指向决策承载类型，它已绑死在某设施上，不是自由需求点 ⇒ 排最后，有别的就不选它 |
| **A3 承载类型自身非空** | `facility` / `node` 分支入口 | 硬检查 | 选中范围收窄后一行都没有 ⇒ 早报缺，别让求解器抛与病因无关的错误 |
| **B 物化** | `synthetic/service.ts` 物化清单 | 数据 | `MaintenanceOrder` 193 行落库（理由见 §1.2(a)） |

排序全式（`rankRoleCandidates`）：

```
过滤：实例数 > 0                                   ← A1（硬）
排序：从属(0/1) 升序 → fanOut 降序 → key 字典序      ← A2 + 原有两键
```

**为什么 A2 是软降权而不是硬过滤**：真实业务里需求点**可以**带「当前服务设施」的 ref
（那是现状而非约束），硬过滤会造成假阴性。降权保证「有更合适的就不选它、没有别的仍可用」，
严格优于现状且不会让任何原本能跑的租户跑不动。

**为什么不改词库/不改 `fanOut` 启发**：`field-role-lexicon.ts` 是 `solver-args` 与 `field-roles`
的**共用单一来源**，动它波及面远超本单；且本单的两条判据是**结构判据**，与命名启发正交——
命名启发负责"名字像"，结构判据负责"担得起"，各司其职。（词库对「工单/订单」的英文子串假阳性
已在 §7 登记为遗留。）

**R14/R6 守则**：两条判据都是纯结构信号（实例计数 + ref 指向），**零类型名硬编**，换租户不改代码；
排序键全确定性，同输入同输出。

### 3.2 同族一起修：`min_cost_flow` 的弧候选

原 `types.find((t) => …)` 取的是**本体列表顺序的第一个** —— 既不检查实例（零实例 ⇒ `arcs=[]` ⇒
抛「需 nodes[] + arcs[]」，与 client 半同一个病），顺序也不稳定（违 R6）。改走同一个
`rankRoleCandidates`（A2 在此恒等——弧按定义必 ref node，故全部同权，退化为 fanOut/字典序稳定序）。

### 3.3 实测结果（真 demo 数据 · seed 42 · scale S）

| 量 | 改动前 | 改动后 |
|---|---|---|
| client 类型 | `MaintenanceOrder`（0 实例） | **`OrderLine`（38 行客户订单行）** |
| invoke 结果 | 抛 `需 facilities[] + clients[] + assignCosts[]` | 2xx·`applicable` 未报缺 |
| orchestrator 降级判据 | **true**（`!run.ok`）⇒ `routing.degraded` | **false** |
| 基线最优设施 | —（拿不到） | `handan`（openCost 6432 = 34.1GWh×120 + 9线×260） |
| 扰动后最优设施 | — | `changzhou`（openCost 被扰动为 150） |
| 基线目标值 | — | `8189.12`（= 6432 + 38 × serveCost(handan) 46.24） |
| 扰动后目标值 | — | `1599.70`（= 150 + 38 × serveCost(changzhou) 38.15） |
| Δ目标 | — | **`-6589.42`** |
| `MaintenanceOrder` 实例 | 0 | **193** |

---

## 4. 接缝证据（SEAM-GATE）

`apps/datacore/test/opt-whatif-close.seam.test.ts`（8 例）。判据不是"候选非空"：

| # | 咬什么 | 撤掉哪条会红 |
|---|---|---|
| ① | **问句实参 → REST invoke → `orchestratorWouldDegrade()` 为假 → 最优设施 handan→changzhou 切换 + client 是非从属真需求点** | A1 / A2 / B 任一（见 §5） |
| ② | A1 隔离：排位更高的候选零实例 → 让位给有实例的 | A1 |
| ③ | A1 诚实报缺：候选全空 → `missingRoles` **点名**空候选，而非抛无关错误 | A1 |
| ④ | A2 隔离：从属候选 fanOut 更高且有实例 → 仍让位给非从属 | A2 |
| ⑤ | 数据半：`MaintenanceOrder` 193 行真落库、主键与 props 与生成器同源 | B |
| ⑥ | R6 同 seed 两跑字节一致 | — |
| ⑦ | 同族 `min_cost_flow`：弧候选零实例 → 诚实报缺点名 | A1（min_cost_flow 分支） |
| ⑧ | 承载类型自身零实例 → 诚实报缺 `facility` | A3 |

**降级判据镜像（① 的核心）**：

```ts
function orchestratorWouldDegrade(statusCode, payload) {   // ← orchestrator.ts:1047 字面镜像
  const runOk = statusCode >= 200 && statusCode < 300;      //   run.ok（OBO 通道 ⟺ 2xx）
  const data = "data" in payload ? payload.data : payload;  //   extractOptWhatifData
  return !runOk || !data || data.applicable === false;
}
```

**上一单 tripwire 的处置**：`opt-whatif-base-cost.seam.test.ts ⑤` 按其自身设计转红
（原文见 §5 变异 M0），已按其注释要求**转正为闭合断言**（断言 client 类型有真实例），
并删除测试侧补位函数 `materializeGeneratedMaintenanceOrders`（生产路径已闭，留着即死代码）。

---

## 5. 变异反证（先 commit 于 `e6063737`，再逐条撤销实测）

见 §5.1–§5.4 的失败原文。四条变异，每条只撤一处、其余不动。

---

## 6. 金值与门

见 §6.1。

---

## 7. 诚实边界 · 本单没做到的

1. **NL 问句里的中文基地名仍抽不到决策对象**（AgentCore 半·超范围边界）。
   `extractTargetId`（`opt-whatif-route.ts:69`）的两条路径是：① 选中对象的 `objectId` **原文出现在问句里**；
   ② 问句里有含数字的英文 token。而前端 `QuarterlyRollingView.tsx:40` 下发的是
   `{objectType:"Base", objectId:"base-常州"}`，DataCore 侧 Base 对象 id 是 `obj_base_changzhou`、主键是 `changzhou` ——
   三种形态互不相等。⇒ 「如果常州基地的开设成本涨到 150…」这句**中文问句**今天仍抽不到 targetId，
   落 `applicable:false`（诚实落回 path-B，不是错答）。本单的 SEAM 用能被抽到的形态
   （`如果 changzhou 基地的…`）驱动，并把抽取规则逐条写在测试常量上方作为漂移基准。
   **修它要动 `apps/agentcore/` 与 `apps/frontend-shell/`，均在本单禁改清单内。**
2. **词库对「工单 vs 订单」的英文子串假阳性未从根上修**（`ROLE_LEXICON.leaf` 的 `order` 会命中
   `WorkOrder`/`PurchaseOrder`/`MaintenanceOrder`）。本单用**结构判据**（A2）把它们降权绕过，
   没有改词库——词库是跨模块共用单一来源，改它属另一单。
3. **`SparePartConsumption`（193 行）仍未物化**，`spare_for_maint` 链路仍是死的。它不在本单
   工单点名范围（工单只提 `MaintenanceOrder`），且与 optimize_whatif 无关，未顺手带。
   连同 §1.1 表里其余 7 个零实例类型，一并留作后续欠账。
4. **`docs/SYSTEM-ONTOLOGY.md` §8 未回写**（工单明令禁改 §8）。本单闭合的断点应登记为
   `G-OPT-WHATIF-EMPTY-CANDIDATE`，待并线方补；建议行文见 §8。
5. **未跑四包 gate**（工单禁 `scripts/gate.sh` 与 `pnpm -r test`，因并发跑前端的 agent）。
   本单只跑了 datacore 全套 + contracts。

---

## 8. 本体引用与影响

### 8.1 触及的对象类型（§2 目录）

| 对象类型 | 域 | 本单影响 |
|---|---|---|
| `Base`（设施/决策承载） | B 本体/对象域 | 无 schema 变更（`openCost`/`serveCost` 由上一单引入，本单沿用） |
| `MaintenanceOrder`（设备维修工单） | F 时序/运营域·`equip` 类目 | **从"声明存在、零实例"变为"193 个真实例"**（类型定义一字未改，只补物化） |
| `OrderLine`（订单行） | B 本体/对象域 | 无变更；成为 `facility_location` 的 client 角色实际承载 |
| `OptPerturbation` / `OptWhatifResult` / `OntologyBinding` | J 优化融合域 | 无契约变更 |

### 8.2 触及的链路（§3）

- `optimize_whatif NL 会话入口`（§3 L576-583）：
  `用户问句 → resolveOptWhatifRoute → domainResolve(route=optimize_whatif) → orchestrator 暗发门 →
   path-A invoke_solver(optimize_whatif,{family,selection,autoBind,perturbations}) →
   DataCore assembleBaselineFromSelection → bindToSolverArgs → facilityLocation(sidecar) → OptWhatifResult`
  —— 本单修的是**倒数第三跳**（装配器选角色承载类型）与其**数据前提**（该类型有没有实例）。
  链路拓扑**未变**，无需改 §3 的链路图。
- `合成数据物化链`：`generateBattery → synthetic/service.ts putAll → repos.objects` ——
  新增一类落库（`MaintenanceOrder`），链路形态未变。

### 8.3 事件（§4）

无新增/变更事件。`routing.degraded` 的**触发频次**会下降（这是本单目的），事件名与载荷不变。

### 8.4 不变量

| 不变量 | 本单如何守 |
|---|---|
| **R2** tenant_id everywhere | 候选实例计数走 `view.listByType(ctx.tenantId, …)`，不跨租户 |
| **R6** 确定性 | 排序键全确定性、无时钟/随机；物化为纯投影零 rng；SEAM ⑥ 双跑字节一致 |
| **R12** 双向闭包 | 未新增对象类型/字段，仅补实例；求解器入参仍全部来自已发布本体（DF.8 接地不变） |
| **R13** 结论可溯源 | 报缺原文改为**点名到底哪些候选类型无实例**，把"为什么没结论"变成可当场亮出的诊断 |
| **R14** 应用层无业务常数 | 两条判据均为结构信号，零类型名硬编；费率仍在 `BATTERY_SOLVER_PARAMS.facilityCost` 一处 |
| **R-ARG-FIDELITY** | A2 正是为守它：拒绝把"名字像"的从属记录静默当成需求点算出一个 plausible-but-WRONG 的最优解 |

### 8.5 断点（§8 · 待并线方回写，本单禁改 §8）

建议新增一行（沿用 §8 表格四列格式）：

> `| G-OPT-WHATIF-EMPTY-CANDIDATE | **角色候选只按"名字像"选，不问"担不担得起" ⇒ 装配"成功"而链路照断**（WO-OPT-WHATIF-CLOSE·承 G-WHATIF-NL-UNREACHABLE / G-OPT-WHATIF-NO-COST-DATA 之后的第三格）。`assembleBaselineFromSelection` 取 `clientCands[0]` 时不检查该类型有无实例，demo 赢家 `MaintenanceOrder`（leaf 词库命中 ∧ fanOut=3 ∧ 字典序先于 `WorkOrder`）恰恰零实例 ⇒ `clients=[]` ⇒ `facilityLocation` 抛「需 facilities[] + clients[]」⇒ `orchestrator.ts:1047` 的 **`!run.ok` 那一半**发 `routing.degraded`。**注意这与上一格不是同一半**：上一格是 `applicable===false`，本格是 `!run.ok`，只断言 `applicable` 的测试看不见它。**再追一层还发现第二条判据缺失**：只补"跳过零实例"会把赢家推到 `WorkOrder`(260·生产工单)——仍是错的（`serveCost` 口径是"万元/需求点·年"，把生产工单当需求点是自信错答），因为这两个类型都带 `baseId→Base` 的 ref，是**设施自己的从属记录**而非可自由指派的需求点。→ **✅ 已闭**：装配器加 A1(零实例硬过滤·全空则点名报缺) + A2(从属软降权) + A3(承载类型自身非空)，同族 `min_cost_flow` 弧候选同修（原 `types.find` 还不稳定序）；数据半 `MaintenanceOrder` 补进物化清单（声明/连接器/链路/193 行确定性行俱在、唯独没落库）。赢家落到 `OrderLine`(38·客户订单行)。 | 用户问句 → `resolveOptWhatifRoute` → `orchestrator.runOptWhatifRoute` → `assembleBaselineFromSelection`（角色候选）→ `bindToSolverArgs` → `facilityLocation` | ✅ 已闭（SEAM `opt-whatif-close.seam.test.ts` 8 绿 + 四轮变异反证真红 + datacore 全套复跑） |`
