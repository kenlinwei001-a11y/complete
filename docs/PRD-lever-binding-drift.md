# PRD · WO-LEVER-BINDING-DRIFT —— 产能拨杆「设备层」反推不出候选 + 交叉校验函数零接线

> 状态：已交付（handoff 分支 `claude/handoff-wo-lever-binding`，基线 `640acb74`）
> 断点：新登记 `G-LEVER-BINDING-DRIFT`（§8 措辞见 §7，由审核方回写，本单**不**直接改 §8）
> 门：新增 `lever-binding-drift:check`（已并入 `pnpm gates`，本体 §7 已登记）

---

## §0 本体引用与影响

| 维度 | 触及项 |
|---|---|
| **对象类型**（§2.B/E） | `Equipment`（`oee_current` / `oeeA` / `oeeP` / `oeeQ`）· `Process` · `Line` · `Material` · `ChangeoverMatrix` |
| **链路**（§3） | `generic_inference(mode:levers, grain:'process-model', modelId, processKey) → discoverCapacityLevers`（本体 §3 行 464 已登记）；其上游 `capacity_forecast(granularity:'process-model') → byProcessModel`；前端起点 `RiskBoardView → DynamicLeverPanel → endpoints.discoverLevers` |
| **事件**（§4） | 无新增、无改动 |
| **不变量** | **R6 确定性**（±ε 探针在克隆 ctx 上跑，不 mutate、不落库——本单未改该性质）· **R13 溯源**（杠杆 `provenance.factorBinding` 现指向真实存在的落点）· **R14 单一来源**（落点定义只此一份，门 import 契约包真实现而非抄写） |
| **断点**（§8） | **新增 `G-LEVER-BINDING-DRIFT`**（措辞见 §7）；同族既有 `G-CAPACITY-FACTOR-SHALLOW`（20 因子宽而浅，本单是其"引擎半已闭"之后暴露出的接缝残留）· `G-WHATIF-HARDCODED-LEVERS`（杠杆自派生 DAG 反推，本单修的正是该机制在 capacity grain 下的落点表） |
| **门禁**（§7） | **新增 `lever-binding-drift:check`**；连带被咬：`ontology-writeback:check`（§7 登记）· `gate-ledger:check`（门账 binding/责任边界/provenRed 棘轮） |

---

## §1 缺陷：一次「两包各自都对、合起来错」的接缝断裂

产能拨杆的候选反推不是一张表，是**两张分居两包的表 join**：

| 表 | 位置 | 语义 |
|---|---|---|
| `LEVER_FACTOR_PROPS` | `apps/datacore/src/solvers/service.ts:355` | 瓶颈因子名 → `Type.prop` 集（mirror `risk.ts liveTightness`） |
| `CAPACITY_FACTOR_BINDINGS` | `packages/contracts/src/capacity-factors.ts:48` | 20 原子因子（marks ①–⑳）→ 落点 + 颗粒 + 可写标 |

生产分支 `discoverCapacityLevers`（`service.ts:851-854`）取二者**交集**作候选：

```ts
const wantProps = factorFilter ? new Set(factorFilter.flatMap((f) => LEVER_FACTOR_PROPS[f] ?? [])) : undefined;
const cands = CAPACITY_FACTOR_BINDINGS.filter(
  (b) => b.writable && matchesGrain(b.grain, grain) && (wantProps ? wantProps.has(`${b.objectType}.${b.prop}`) : true),
);
```

而 `LEVER_FACTOR_PROPS.设备OEE = ["Equipment.oee_current"]`，绑定表却把 OEE 建模成 `oeeA/oeeP/oeeQ` 三原子（marks ③④⑦）、**没有 `oee_current`** ⇒ 交集空 ⇒ 候选 0。

**为什么这个缺陷能长期存活**——它**不报错**：后端返回 200 + `levers: []`，前端 `DynamicLeverPanel` 拿到空数组就渲染一个空面板。
没有异常、没有日志、没有红测试。用户看到的现象是"设备 OEE 这层拨杆点开是空的"，无从判断是数据问题还是功能没做。

### 1.1 生产调用链（逐跳核实，非推测）

```
RiskBoardView.tsx:876-885   factors={[card.factor, ...bnFactors]}  grain="process-model"
   ↓
DynamicLeverPanel.tsx:136   discoverLevers({ factors, scopeObjectIds, targetType, targetProp, topK, grain, modelId })
   ↓
service.ts:703              if (args.grain) return this.discoverCapacityLevers(ctx, args);   ← 分流点
   ↓
service.ts:851-854          wantProps × CAPACITY_FACTOR_BINDINGS 取交集 → cands
   ↓
service.ts:924              if (!best || best.sensitivity === 0) continue;   ← 候选还要"撬得动"才留下
```

`card.factor` 的值域来自 BN 词表（`capacity.ts:214` `BN_BY_MARK = { "⑥":"良率波动", "③":"设备OEE", "⑬":"物料齐套" }`），
`设备OEE` 是其中之一 ⇒ 只要某基地的主瓶颈是设备 OEE，该基地的拨杆面板必然空白。

### 1.2 假绿形态：路径开关（铁律 0.5 判据⑥）

既有唯一相关测试 `apps/datacore/test/ontology-core.test.ts:587`：

```ts
invokeSolver(t, "generic_inference", { mode: "levers", targetType: "Factory", targetProp: "capacity", factors: ["设备OEE"] })
```

**不传 `grain`** ⇒ `service.ts:703` 的 `if (args.grain)` 不成立 ⇒ 走通用 `discoverLevers`（沿 ontology-core `derivationSpecs` 反向 walk），
叶子来自该测试自建的 `PYRAMID_SPECS` 本体，其中 `Equipment.oee_current` 确实是一个合法叶。
**这条测试从头到尾不碰 `CAPACITY_FACTOR_BINDINGS`**，故绑定表缺 `oee_current` 它一无所知，而且一直是绿的。

> 「这个函数有测试」证明不了「生产走的那个分支有测试」——生产实参与测试实参交集为空。

---

## §2 实测数字（纯函数重放，不起服务）

重放逐字复刻 `service.ts:849-854`；`CAPACITY_FACTOR_BINDINGS`/`matchesGrain` 直接 import 构建产物，
`LEVER_FACTOR_PROPS` 从 `service.ts` 源码现场解析（两者都不手抄，避免我自己引入漂移）。
金丝雀先自证工具可用：解析出 7 个因子键、绑定表 20 条——都非 0，故"报 0"是真结论而非工具坏了。

**改前 / 改后 · `grain='process-model'` 下的候选数**

| factors | 改前 | 改后 |
|---|---|---|
| `["设备OEE"]` | **0** ← 缺陷 | **1** `[Equipment.oee_current]` |
| `["瓶颈工序"]` | 1 | 1 |
| `["良率波动"]` | 1 | 1 |
| `["物料齐套"]` | 2 | 2 |
| `["人力工时"]` | 2 | 2 |
| `["换型损失"]` | 1 | 1 |
| `["物流时长"]` | 1 | 1 |
| 缺省（不传 factors） | 13 | 11 |
| **零候选层数** | **1 / 7** | **0 / 7** |

缺省从 13 降到 11 是**有意**的：剔除 `Equipment.oeeP` / `Equipment.oeeQ` 两个敏感度恒 0 的死候选
（见 §3），每次调用少两轮 ±ε 克隆重算。

**端到端（真跑求解器 + 真合成数据，`apps/datacore/test/lever-binding-drift.test.ts`）**

- 改前：`count = 0` → `AssertionError: 设备OEE 层在生产实参下反推出 0 个杠杆 —— 拨杆面板必然空白: expected 0 to be greater than 0`
- 改后：`count > 0`，含 `Equipment.oee_current`，`|sensitivity| > 0`，`mark === "③"`，`factor === "设备·OEE"`

---

## §3 选型：为什么是 (A) 登记 `oee_current`，而 (B) 改指三原子是个**陷阱**

工单给了两条路。**(B) 会产出一个看起来修好了、实际仍然空白的结果**，理由是产能链读 OEE 只有一个出入口：

```ts
// apps/datacore/src/solvers/capacity.ts:45-49
export function equipmentOee(props: Record<string, unknown>): number {
  const snap = props.oee_current;
  if (typeof snap === "number" && Number.isFinite(snap) && snap > 0) return snap;   // ← 快照优先
  return num(props.oeeA, 1) * num(props.oeeP, 1) * num(props.oeeQ, 1);             // ← 仅当快照缺失
}
```

而合成数据给**每台**设备都回填了快照：

```ts
// apps/datacore/src/synthetic/battery.ts:3620-3624
for (const eq of equipment) {
  if (eq.oee_current === undefined) eq.oee_current = round(Number(eq.oeeA) * Number(eq.oeeP) * Number(eq.oeeQ), 3);
}
```

（另有时序 `oee_daily_7d` 持续把它物化，`battery.ts:2628`；schema 注册在 `battery.ts:954`。）

⇒ **乘积分支在生产数据下恒不进入，三原子被完全掩蔽**。于是走 (B) 会得到：
候选 3 个 → `patchCapacityContext` 改 `oeeA` → `equipmentOee` 返回值不变 → Σp50 不变 → 敏感度 0
→ `service.ts:924` 的 `if (!best || best.sensitivity === 0) continue` 把它们整批丢弃 → **用户所见仍是空面板**。
即 (B) 只是把「0 个候选」换成「3 个永远拨不动的候选」。

这条已钉成可执行断言（测试用例三），不是 PRD 里的一句话：
拨 `oeeA/oeeP/oeeQ` 各 +0.05 → Σp50 **逐字节不变**；拨 `oee_current` +0.05 → Σp50 真变。

### 3.1 采用 (A)，且以「重指 ③ 落点」而非「新增第 21 条」实现

**为什么不新增一行**：`apps/datacore/test/capacity-atom-factor.test.ts:163-164` 钉死金值
`CAPACITY_FACTOR_BINDINGS.length === 20` 且 `20 个唯一 mark`；而本单的范围边界只允许**新建**测试文件、
不允许改既有测试。重指 ③ 的落点既满足验收，又保住金值，且**改动量更小**。

**为什么重指 ③ 在语义上是对的**（不是为了迁就金值而将就）：`capacity.ts:282` 的逐格瓶颈候选里，
③ 的 provenance 本来就写着 `{ objectType: "Equipment", prop: "oee_current" }`——**硬编码，不读绑定表**
（对比 ⑥/⑬ 用的是 `yb?.objectType` / `matb?.objectType`）。
也就是说**引擎早已认定 ③ 的落点是 `oee_current`，只有绑定表还写着 `oeeA`**。
本单是把绑定表对齐到引擎，而不是引入新语义——修前二者相左，正是同一处漂移的另一半。

`factorName` 由「可用率 OEE-A」收敛为「设备OEE」：这不是造新词，而是收敛到**已在三处使用的既有术语**
（`capacity.ts:214` `BN_BY_MARK["③"]` · `LEVER_FACTOR_PROPS` 的键 · `risk.ts:156` liveTightness 分支）。
用户可见的显示名仍由 `LEVER_PROP_META["Equipment.oee_current"].label = "设备·OEE"` 单源下发（`service.ts:929` 优先取它）。

### 3.2 不造「两条互相打架的可写路径」

工单特别提醒了这一点。处理方式：`oeeP`/`oeeQ`（marks ④⑦）标 `writable: false`。
判据是本表自己的定义——"writable = 是否为**可拨动的杠杆落点**"；它们被快照掩蔽、拨了没有任何效果，
标 `true` 就是登记两个死杠杆。**可解释性不丢**：可用率 OEE-A 可由 `oee_current /(oeeP × oeeQ)` 反解，
三原子仍作为分解量留在表内（本体属性真实存在、连接器有字段映射 `battery.ts:1627`）。

若将来去掉快照回填、让 `equipmentOee` 真走乘积分支，应把 ④⑦ 连同 OEE-A 一并改回 `writable:true` 并拆开 ③
——但那是**改产能链语义**，属另一张 WO；`lever-binding-drift:check` 会一直盯着这条不变量。

### 3.3 未改动 / 零回归

- `computeByProcessModel` **输出零改**：它只按 mark 查 ⑥ 和 ⑬，③ 的 `prop` 从不被它读取。
- 行锚未漂：`capacity-factors.ts` 的 51 / 57 / 70 行原地不动（前端 `inspectorModel.ts:750/783/893` 以行号引用它们）。
- 回归实测：`capacity-atom-factor` + `capacity-page-100pct` + `caplive-truechain` 三文件 **21/21 绿**
  （其中 `capacity-page-100pct.test.ts:117` 要求 Equipment 杠杆的 `objectId.includes(baseId)`——
  新出现的 `Equipment.oee_current` 杠杆满足，因 `equipId = LINE-WS-<baseId>-…-E<n>` 天然含 baseId）。

---

## §4 门：`lever-binding-drift:check`（`factorPropKeys` 的第一个真消费方）

`factorPropKeys()`（`capacity-factors.ts`）注释写明"`LEVER_FACTOR_PROPS` 派生/校验用"，
但**零调用方**——全仓（`apps/*/src`、`packages/*/src`、`scripts/`、所有 `test/`）除定义自身外无一处引用。
这是假绿第 9 形态的变体：**实现有、连测试都没有、零生产消费方**。本门是它的第一个真消费方。

**两条判据**（刻意分开，因修法完全不同·铁律 0.5 判据①）：

| 判据 | 内容 | 红了意味着 | 修法 |
|---|---|---|---|
| **A1 层可反推**（硬·无豁免） | 每个 `LEVER_FACTOR_PROPS` 因子键**至少**有一个落点在绑定表里且 `writable` + grain 兼容 `'process-model'`（逐字复刻生产谓词） | 整层断了，该层拨杆面板恒空 | 补落点登记，或把该因子改指已登记的可拨动落点 |
| **A2 落点无孤儿**（棘轮） | 每个 `Type.prop` 都能在 `factorPropKeys()` 里找到 | 多写了一个够不着的落点（笔误 / 跨包改名残留） | 删掉，或补登记 |

**存量豁免 5 条**（A2·按 `因子||Type.prop` 精确匹配，**只降不升**，豁免过期也红）：
`物料齐套→MaterialBalance.coverage` · `物料齐套→Order.outsourceRatio` · `人力工时→Process.shiftHours` ·
`换型损失→Order.outsourceRatio` · `物流时长→Shipment.etaDay`。
这 5 个都是**真实存在的本体属性**，只是不在 20 原子因子表内；它们各自所属的层都另有 ≥1 个真落点，故不触发 A1。

**防哑设计**：
- **金丝雀**：先拿「良率波动 → `Process.yield_baseline`」（绑定 ⑥·确定存在）自证解析式与查表都通；
  任一环报 0 立刻判「**门坏了不是代码坏了**」并退出——而不是把工具故障读成"全是死代码"（铁律 0.5 判据⑤）。
- **不抄定义**：门 import 契约包**构建产物**复用 `factorPropKeys()` / `matchesGrain()` 真实现。
  门与被守对象各存一份定义，正是它要治的那种漂移。
- **解析失配即红**：`LEVER_FACTOR_PROPS` 声明一旦改名/改形（挪文件、换成 Map），门直接退 1 并说明必须同步改解析式
  ——不允许"解析不到就当没有"这种 fail-open。

**诚实边界（每次运行都打印，不藏在文档里）**：本门是**静态**的，只证「落点在表里且标可拨动」，
**不证「拨了真有用」**。落点齐全但敏感度恒 0 照样拨不出杠杆，本门看不见（见 §6）。

---

## §5 变异反证（三处，逐条 `out=$(cmd 2>&1); rc=$?` 显式捕获退出码）

| # | 变异 | 命令 | RC | 失败原文（节选） |
|---|---|---|---|---|
| **M1** | 撤掉 ① 的修复（`git checkout 640acb74 -- capacity-factors.ts`） | `pnpm --filter datacore exec vitest run test/lever-binding-drift.test.ts` | **1** | `AssertionError: 设备OEE 层在生产实参下反推出 0 个杠杆 —— 拨杆面板必然空白: expected 0 to be greater than 0`（3/4 用例红） |
| **M1′** | 同上状态下跑**新门** | `node scripts/check-lever-binding-drift.mjs` | **1** | `A1 层可反推：瓶颈因子「设备OEE」的落点 [Equipment.oee_current] 在 CAPACITY_FACTOR_BINDINGS 里一个都不满足「writable 且 grain 兼容 'process-model'」` |
| **M2** | `LEVER_FACTOR_PROPS.瓶颈工序` 加 `"Line.__ghost_prop__"` | `node scripts/check-lever-binding-drift.mjs` | **1** | `A2 落点无孤儿：LEVER_FACTOR_PROPS['瓶颈工序'] 里的 Line.__ghost_prop__ 在 CAPACITY_FACTOR_BINDINGS 找不到落点（未豁免）` |
| **M3** | 把本门从 `package.json` 的 `gates` 串摘掉 | `node scripts/check-ontology-writeback.mjs` | **1** | `G3-a 未签处置：check-lever-binding-drift.mjs 未接线（binding=MANUAL）且 disposition="" 非法——被制度指定的死门` |
| **M3′** | 同上状态下跑门账门 | `node scripts/check-gate-ledger.mjs` | **1** | `③ 绑定属实：check-lever-binding-drift.mjs 账里写 binding="GATES_CHAIN"，现算是 "MANUAL"`＋`④ 责任边界：…非 GATES_CHAIN 却无合法 disposition` |

**M1′ 是本单最有价值的一条**：它证明这道门**放到缺陷发生的那个 commit 上会当场变红**——
不是"造了一道以后可能有用的门"，而是"这道门本可以阻止这次事故"。

三处变异逐条还原后复跑：新测试 4/4 绿、`lever-binding-drift:check` RC=0、`gate-ledger:check` RC=0、
`ontology-writeback:check` RC=0。

---

## §6 遗留（**本单未修**，已具名记账，建议另立 WO）

逐层普查（测试用例二）实测：除设备OEE 外，另有**两层**同样拨不出杠杆，但**病因完全不同**——
不是"没接线"（落点登记齐全），而是"接了线但敏感度恒 0"，故本门（静态）看不见：

| 层 | 落点 | 根因（已核到 file:line） |
|---|---|---|
| ⑩ 瓶颈工序 | `Line.utilization` | **产能链从不读它**。`capacity.ts:112` 读的是 `proc.props.utilization`（= `Process.utilization`，绑定 ⑧）。落点挂在了错误的对象类型上——"接了线接错地方"。 |
| ⑤ 换型损失 | `ChangeoverMatrix.changeoverMin` | **双重死**：① `capacity.ts` 全文不出现 `ChangeoverMatrix`；② `patchCapacityContext`（`capacity.ts:328-339`）的 switch 只认 `Process/Equipment/Line/Material`，`default: return {...c}` ⇒ 该 override **被静默丢弃**，克隆世界与基线逐字节相同。 |

修它们要动产能链数学或 `patchCapacityContext` 的类型白名单，**超出本单范围边界**（工单限定设备层 + 门）。
已按「具名清单 + 只降不升」棘轮钉进 `lever-binding-drift.test.ts` 的 `KNOWN_EMPTY`：
清单外任一层变空即红，清单也不许变长，修好后断言会逼调用方把条目删掉。

**这同时也是对本门能力边界的诚实交代**：静态门必要但不充分——
「落点在表里」≠「拨了真有用」，两个维度得两种机制分别咬。

---

## §7 建议的 §8 断点措辞（**本单不直接改 §8**，请审核方回写）

> | `G-LEVER-BINDING-DRIFT` | **产能拨杆候选由两包各自维护的两张表 join 得出，交集空则该瓶颈层永远拨不出候选、且全程无报错**：`service.ts:855 LEVER_FACTOR_PROPS`（瓶颈因子 → `Type.prop`）× `contracts/capacity-factors.ts CAPACITY_FACTOR_BINDINGS`（20 原子因子 → 落点），生产分支 `discoverCapacityLevers`（`grain='process-model'`）取二者交集作候选（`service.ts:851-854`）；交集空 ⇒ 后端 **200 + `levers: []`**，前端 `DynamicLeverPanel` 渲染空面板 —— 无异常、无日志、无红测试，用户只看到"这层拨杆点开是空的"。**实测**：`设备OEE` 指向 `Equipment.oee_current`，绑定表却把 OEE 建模成 `oeeA/oeeP/oeeQ` 三原子、无 `oee_current` ⇒ 候选恒 0（其余 6 层均 ≥1），设备层拨杆自上线起从未出过候选。**为什么长期无人察觉**：唯一相关测试 `ontology-core.test.ts:587` **不传 `grain`**，走的是 ontology-core `derivationSpecs` 反向 walk（叶来自测试自建 `PYRAMID_SPECS`），与生产分支交集为空 —— 假绿"路径开关"形态（铁律 0.5 判据⑥）：「这个函数有测试」证明不了「生产走的那个分支有测试」。**→ ✅ 已闭**（WO-LEVER-BINDING-DRIFT）：① 绑定 ③ 落点由 `Equipment.oeeA` 重指 `Equipment.oee_current`，与 `capacity.ts:282` 逐格瓶颈 ③ 早已硬编码的 provenance `{Equipment, oee_current}` 对齐（修前二者相左 = 同一漂移的另一半）；`oeeP/oeeQ`（④⑦）标 `writable:false` —— 产能链读 OEE 只经 `equipmentOee`（`capacity.ts:45`）且**快照优先**，而 `battery.ts:3623` 给每台设备都回填 `oee_current` ⇒ 三原子被完全掩蔽、拨动它们 Σp50 逐字节不变 ⇒ **改指三原子（另一种修法）只会把「0 个候选」换成「3 个永远拨不动的候选」**，该反证已钉成可执行断言。保金值 20 条/20 marks、`capacity-factors.ts:51/57/70` 行锚不漂、`byProcessModel` 输出零改。② 新门 `lever-binding-drift:check`（§7）：A1 层可反推（硬）+ A2 落点无孤儿（棘轮·5 条具名豁免只降不升），**是 `factorPropKeys()` 的第一个真消费方**（该交叉校验函数此前零调用方 = 假绿第 9 形态）。③ 新测试 `apps/datacore/test/lever-binding-drift.test.ts` 补生产实参那一格（原测试不动）。**变异反证**：撤 ① → 测试红且新门在**缺陷原始 commit 上当场变红**（证明这门本可阻止该事故）· 塞 ghost prop → A2 红 · 摘出 gates → `ontology-writeback` G3-a + `gate-ledger` ③④ 红。**残留（未闭·另立 WO）**：同法普查出另两层亦恒空，但病因是**敏感度恒 0** 而非缺落点，静态门看不见 —— ⑩ 瓶颈工序 → `Line.utilization`（产能链读的是 `Process.utilization`，`capacity.ts:112`，落点挂错对象类型）· ⑤ 换型损失 → `ChangeoverMatrix.changeoverMin`（`capacity.ts` 无该类型 + `patchCapacityContext` switch 不认 ⇒ override 被静默丢弃）；已按具名清单棘轮钉进测试。 | `RiskBoardView → DynamicLeverPanel → discoverLevers(grain:'process-model', factors) → service.ts:703 分流 → discoverCapacityLevers → LEVER_FACTOR_PROPS × CAPACITY_FACTOR_BINDINGS 交集 → ±ε recompute → levers[]` | ◐ 主症已闭（设备层通·门已接线·§7 已登记）；**残留两层敏感度恒 0 未修** |

---

## §8 交付物清单

| 文件 | 动作 |
|---|---|
| `packages/contracts/src/capacity-factors.ts` | 改（③ 落点 + ④⑦ writable + OEE 三原子关系说明；原地改，无行锚漂移） |
| `apps/datacore/test/lever-binding-drift.test.ts` | 新建（4 用例：生产实参 / 逐层普查棘轮 / (B) 陷阱反证 / 交叉校验不变量） |
| `scripts/check-lever-binding-drift.mjs` | 新建（A1 + A2 + 金丝雀 + 诚实边界） |
| `package.json` | 改（`gates` 链 + `lever-binding-drift:check` 别名） |
| `scripts/gate-ledger.json` | 改（登账：binding=GATES_CHAIN · guardedPaths · escalation · provenRed=MUTATION） |
| `docs/SYSTEM-ONTOLOGY.md` **§7** | 改（登记本门；**§8 未动**，由审核方按 §7 措辞回写） |
| `docs/PRD-lever-binding-drift.md` | 新建（本文） |

**未触碰**（范围边界）：`apps/frontend-shell/**` · `apps/datacore/src/synthetic/**` ·
`apps/datacore/src/solvers/service.ts`（`LEVER_FACTOR_PROPS` 亦**未改** —— 它本来就是对的，错的是绑定表）·
`docs/SYSTEM-ONTOLOGY.md §8` · 任何既有测试文件。
