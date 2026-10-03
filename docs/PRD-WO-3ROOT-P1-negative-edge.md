# PRD · WO-3ROOT-P1 · 铸造层半轴缺失 ⇒「低估(−) ⇒ 需求压力上冲」在默认世界里不可达

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 DRAFT · 日期 2026-10-03 |
| 取代/扩展 | 新建（承接 `docs/evidence/WO-DUE-CHANGE-rootcause.md` 的副账 + `seed-derivation-specs.ts` 退役注自陈的「另单」） |
| 先读 | 根 `CLAUDE.md`（禁令 1/3/4 · 铁律 0/0.5/0.6/1.5）· `docs/SYSTEM-ONTOLOGY.md` · `docs/evidence/WO-DUE-CHANGE-rootcause.md` · `docs/evidence/WO-DUE-CHANGE-c2-intervention.md` |
| 画像 | **重 · 跨数据+引擎两半 ⇒ 必须一个 dev 整单做（违者按接缝返工）** |
| 前置事实源 | `docs/evidence/WO-3ROOT-P1-cast-recon.txt`（RC=0）· `WO-3ROOT-P1-model-partition.txt`（RC=0）· `WO-NEGEDGE-P3-signflip.txt`（RC=0） |

---

## 0. 本体引用与影响（强制 · 铁律 0）

### 0.1 触及对象类型 / 链路 / 事件

- **触及对象类型**（本体 §2）：`Model`（`forecastBias` 一格）· `Order`（`demandPressure` 一格）·
  以及三张**登记表**：`STATE_VAR_DOMAINS`（域的唯一来源）· `STATE_VAR_VALUE_REFS`（规格归属的唯一入口）·
  `STATE_VAR_DISPLAY_NAMES`。**不新增对象类型、不新增状态变量、不改任何对象 schema。**
- **触及链路**（本体 §3）：
  - `demo_forecast_bias_to_order_demand` —— `Model.forecastBias --×(k=−0.222)--> Order.demandPressure`，
    `status=PUBLISHED`、`delayTicks=0`、`combine=sum`（现场路由实测，见 `WO-3ROOT-P1-cast-recon.txt` 金丝雀⓪）。
    **本单不改这条边的任何字段**（系数、delay、状态一律不动），改的是它的**源能不能产出负值**。
  - 上游 `order_for_model`（`Order`→`Model`，**已物化**，`seed.ts` 里被方向可达门当金丝雀用）。
  - 播种链：`deriveSeedBaseSnapshot`（`sim/seed-world.ts:393`）→ 本单的改动点 `:483` → `app.ts:2101` 建会话缺省快照。
  - 合成链：`makeRestoreSpecBase`（`sim/spec-base-synthesis.ts`）→ 两个调用点（生产 `simAdvanceTicks` + 镜像回放环
    `metric-series.ts`）。**本单只加越域名点，不改它的合成代数。**
- **触及事件/数据流**（§4）：**不新增事件、不新增门、不新增棘轮、不新增基线 JSON**（仓主禁令 3）。
  只复用既有 tick 回执里既有的越域/饱和记账通道（`saturations`）来点名「补写后越出声明域」的格。
- **不触及**：`packages/contracts`（域表今天在 datacore 侧 `synthetic/battery.ts`，本单不移它）·
  `apps/frontend-shell` · `apps/agentcore`。

### 0.2 不变量（§5，R1–R12 逐项）

| # | 不变量 | 本单的关系 |
|---|---|---|
| R1 | contracts-only-shared | **触及**：铸造器落在 `apps/datacore/src/synthetic/battery.ts`（域表所在文件），⛔ 不许把域表搬进 contracts、不许跨包 import 源码 |
| R2 | tenant_id everywhere | 不触及（域表是平台级常量，非租户数据；铸造值是会话内派生量） |
| R3 | entitlement 先于 authz | 不触及（无新路由、无新能力） |
| R4 | 真值写入经 Action 审批 | **触及（边界，必须显式声明）**：铸造值是**播种期派生量**，不是经 `domainExecutor` 物化的治理真值；本单不改变这条边界，**也不得**借此把它升格成真值 |
| R5 | no-secrets-echo | 不触及 |
| R6 | **确定性** | **强相关**：改后同 `(industry, scale, seed)` 仍须逐字节一致；但**改前 ≠ 改后**（这是有意的种子语义变更，必须在交付报告里点名，不许当"没动"） |
| R7 | 错误信封统一 | 不触及 |
| R8 | 认证 | 不触及 |
| R9 | 仓储双实现 | 不触及 |
| R10 | D-29 数据流闭环 | 触及（边界）：无新事件、无新订阅 |
| R11 | 全链闭包（ScenarioCard 必 Intent+Plan+Solver+render 全接通） | 不触及：本单不在场景/求解器注册链上 |
| R12 | 双向闭包（数据构建） | **触及**：「字段必被消费」——`forecastBias` 今天**被消费了**，但只消费了它的半个值域（值恒 ≥ 0 ⇒ 边贡献恒 ≤ 0）；本单让"被消费"名副其实 |
| R13 | 透明可审计（补充） | **触及**：补写后越出声明域的格必须被**点名**，不许静默 |
| R14 | 零业务常数（补充） | **强相关**：铸造器的参数**只能**来自域表（`min`/`max`/`restPoint`）的形状，⛔ 不许内联任何业务常数、⛔ 不许按量纲名写死 |
| R15 | CLI 对等（补充） | 不适用：本单不新增对外能力（无新 API / 无新视图 / 无新操作目录项），改的是播种期内部铸造式 |

### 0.3 已知断点（§8，G-1…G-8 逐项）

| # | 本单的关系 |
|---|---|
| G-1 | 不触及（20 场景端到端已修，与推演铸造层无关） |
| G-2 | 不触及（`affected_orders` 字段别名已修） |
| G-3 | 不触及（场景启动器/presetContext 已大部修） |
| G-4 | 不触及（执行计划前端入口已修） |
| G-5 | **部分触及**：G-5 的形态是「业务数据由写死的式子/常量产出」；本条病灶（哈希占位式不读声明域）与它同族，但本单**只动铸造式这一处**，不碰 G-5 的基地册/应用细分范围 |
| G-6 | **触及（边界）**：G-6 收口了「合成并入连接器 / 统一 `schema-gen`」；本单改的是**合成值的铸造式**本身，不改 G-6 的管线结构 |
| G-7 | 不触及 |
| G-8 | **间接触及**：域↔真值的对账属于「数据构建闭包」；本单把对账从**区间**升到**语义**，但落点在**既有**接缝臂内扩两条断言，⛔ 不扩门、不建新门 |

### 0.4 回写承诺

落地后必须回写 `docs/SYSTEM-ONTOLOGY.md`：§3 追加「铸造层链路 · 声明域形状 → 铸造分布」一小节；
§5 在 R12/R14 行补锚点；§8 若本单新识别出断点则登记（⛔ 只登记本单自己识别的，不重排既有编号）。

---

### 0.5 数据承载核对（结论：**不适用** · 理由逐条）

本单**不新增、不改名、不改语义**任何**对象属性**（本体属性表零改动），只改**仿真状态变量**
（第二命名空间，非本体属性 —— 见 `check-prd-data-grounding.mjs` 判义③对 `simStateVar` 的定性）：

| 读/写的量 | 命名空间 | 今天有值吗 | 谁写的 | 覆盖率 |
|---|---|---|---|---|
| `Model.forecastBias` | **仿真状态变量**（非本体属性） | ✅ 有值 | `sim/seed-world.ts:483` 哈希占位（规格 `model_forecast_bias` 已于 2026-09-20 退役，`stateVarValueRef` 返回 `undefined`） | 6/6 型号（tick0 实测） |
| `Order.demandPressure` | **仿真状态变量**（非本体属性） | ✅ 有值 | 播种期派生规格（`demandDelta×100`）+ 本单不改的入边 | 150/150 单 |
| `STATE_VAR_DOMAINS["forecastBias"]` | 域登记表（平台常量） | ✅ 已声明 | `synthetic/battery.ts:3833` | 1/1 |

⇒ 因**无对象字段增删**，本 PRD 不填《数据承载核对》21 维表（`// 不涉数据闭环新增字段`），
与同工作流姊妹单 `PRD-WO-3ROOT-P2-runtime-rederive.md` 同口径。

> ⚠ **本仓库的 `prd-data-grounding:check` 在本机是坏的（RC=2，非本单引入）**，证据：
> 把本 PRD 移出 `docs/` 后重跑，仍报「规则命名空间真值源只读到 2 个（<5）⇒ 门自己瞎了 … 修门，别改结论」，RC 同为 2。
> ⇒ 本单的**数据承载核对状态 = NOT-MEASURED（工具坏，不许读成"干净"）**，须由门维护方修好后再复跑。

---

## 1. 目标 / 非目标

### 1.1 目标

让**默认播种世界自己讲得出「低估(−) ⇒ 需求压力上冲」这个故事**，并让「播种真值是否取到了声明域的两侧」
这件事实**有机器在说**，而不是靠人想起来。

判据落在**铸造层**：`restPoint` 严格内点于 `(min, max)` 的声明域，其铸造分布必须跨 `restPoint` 两侧。

### 1.2 非目标（⛔ 明确不做，防越界）

1. **不修「超载侧的世界内生事件进不了这一格」。** 该格入度=1、其源入度=0 ⇒
   `Base.loadIndex` 超载、产能损失、需求突变**都到不了**这一格。那由**刻意的拓扑**（`G-ROOT-1` 的降级）决定，
   是**另一条根因**，本单不覆盖、也不许拿本单的绿去顶它的账。
2. **不修夹值次序**（核内先夹、C2 补写在核后）⇒ 见 §7 companion 单。
3. **不修"实测真值越域"那一类**（实测支 360 格越域被运行期夹值"修好"）——
   「越域的真值要不要夹」是**仓主裁决**（`sim-real-cells.seam.test.ts` 判例：「不许为它改种子」/
   「声明下界 0 会把数据 bug 夹成看起来正常，那不叫修，叫藏」），不在本单射程内。
4. **不改声明的下界幅度**（`−100` 的出处是「对称」约定，不是业务数值 ⇒ 「重声明域为 `[0,100]/rest 50` + 翻边符号」
   这条产品路线仍然开放，本单不裁决）。
5. **不做全域普查**「声明语义的某一半结构性不可达」这个**类**还有多少例 ——
   本单只落**判据**（域形状谓词），不为它建普查装置（禁令 1：那是 B 类记账）。

---

## 2. 现状与缺口（AS-IS，全部实测）

### 2.1 现象（本单亲自复现，非转抄）

| 观测 | 读数 | 出处 |
|---|---|---|
| `Order.demandPressure` 唯一入边 | **1 条**：`demo_forecast_bias_to_order_demand`，`src=Model.forecastBias`，`k=−0.222`，`delay=0`，`status=PUBLISHED` | `WO-3ROOT-P1-cast-recon.txt` 金丝雀⓪ |
| 6 个型号 `Model.forecastBias` @tick0 | `2170-NCM=1`、`4680-LFP=88`、`4680-NCM=50`、`圆柱-LFP=88`、`方形-LFP=8`、`方形-NCM=79` ⇒ **min=1 max=88 负数=0/6** | 同上 §①（哈希铸造格，**不在 `props` 里**，只能读世界态） |
| 零扰动 20 拍：读数上穿基值(+0.01) | **0/150** | 同上 §④ |
| 逐型号入流 `c` 反解（未触地板的单） | `fb=1→c=−0.222`(n=25)、`fb=8→c=−1.776`(n=25)、`fb=88→c=−19.536`(n=23)、`fb=50→c=−11.1`(n=16)、`fb=79→c=−17.538`(n=10) —— **与 `c = k×fb` 逐位吻合** | 同上 §② |
| 扰动落点下拉含 `forecastBias` | `cfg.stateVars` **n=47，含 forecastBias = true** | 同上 金丝雀① |
| 判决实验（上游）：把该边系数符号翻转 | **150/150 单当场越基值**，对照臂 0/150 | `WO-NEGEDGE-P3-signflip.txt`（.rc=0） |

### 2.2 七层根因链（3/3 一致，停在第 7 层）

1. 超载侧信息进不了 `Order.demandPressure` ⇒ 读数上界恒等于本单基值（20/12 拍收敛后无一单越过 `基值+0.01`）。
2. 为什么顶死在基值 ⇒ 该格**只有一条入边**，且净入流恒 ≤ 0（入度 1、`k=−0.222`、源 `Model.forecastBias`）。
3. 为什么净入流恒 ≤ 0 ⇒ 源**结构性非负**：tick0 实测 6/6 型号 ∈ [1,88]，负数 = 0 ⇒ `c ≡ k×fb ≤ 0` 恒成立。
4. 为什么源非负 ⇒ 该格运行时真值由**播种期哈希占位式**铸出：`row[v] = Math.round(seedHash01(\`${o.id}|${v}\`) * 100)`
   （`sim/seed-world.ts:483`，else 分支，出处章 `"derived"`）；`seedHash01` 返回 `((h>>>0)%1000)/1000` ∈ **[0,0.999]**
   ⇒ **铸造值域 [0,100]**。唯一带符号的生成器（规格 `model_forecast_bias`）已于 2026-09-20 退役，
   `stateVarValueRef("Model","forecastBias") === undefined`（`battery.ts:3975` 退役注）⇒ 既无实测 prop、
   也无规格式，**只剩占位式**。
5. 为什么能铸掉半轴而无人察觉 ⇒ **占位式完全不读声明域**：
   `grep -c STATE_VAR_DOMAINS sim/seed-world.ts` = **0**（金丝雀：同查法在 `synthetic/battery.ts` = **14**、
   `seedHash01` 在同文件 = **2** ⇒ 量法活着）。而本格声明的恰恰是 `[−100, 100] / restPoint 0`
   （`battery.ts:3833-3841`，全 `src` 里 `min: -` **仅此 1 条**）⇒ 铸造值域 `[0,100]` 是它的**真子集**，
   **负半轴整段不可达**。
6. 为什么这是缺陷而不是「域只是标签」⇒ 被违反的是**声明语义**，不是区间：域注原文写着
   「唯一带方向的量纲，单列（静息点 0 ≠ 下界）」「静息点取 0 而非下界，下界取 −max 以保持两侧对称」；
   边注释逐字写着两支（`seed.ts:1580-1581`：`forecastBias > 0` = 高估 ⇒ 需求压力**低于**计划；
   `forecastBias < 0` = 低估 ⇒ 需求压力**上冲**）；运行期每拍拿 `restPoint` 当衰减参照（`propagation.ts:889`）。
7. 为什么没被任何机制抓住 ⇒ 平台对「生成真值 vs 声明域」唯一的对账是运行期**区间夹值**（`saturateToDomain`）＋回执点名；
   区间检查对「值**在域内**、却永远取不到声明的另一半语义」**结构性地看不见**（本例恰在域内 ⇒ 无夹值、无 saturations、无告警）。
   守卫还高度错位：`prop-clamp-decay.seam.test.ts` 只对夹子函数本身测了 `(−100,100,0)` 双侧保序，
   **无一条断言铸造值分布能取到两侧**；而 `sim-real-cells.seam.test.ts` 的域扫描臂扫的是 `o.props`，
   **对哈希铸造层结构性失明**（铸造值只进 `state` bucket，不进 `props` —— `seed-world.ts:472-485` 原文）。

**停链理由（第 8 层是明文不做，不是没人做）**：再往下一层的裁决权（「种子真值要不要服从声明域/静息点口径」）
在测试账与缺陷表里都被**明文保留给仓主**（`sim-real-cells.seam.test.ts` 判例原文
「⛔ 不许为它改种子 = 动 hash。种子收口交仓主」；`battery.ts:3760-3762`「交仓主……那不叫修，叫藏」）。
**保留针对的是「越域的真值要不要夹」，不是「铸造式是否必须参数化于声明域」** ⇒ 第 4~6 层
（铸造值域与声明域的语义冲突）**没有落在任何一条治理保留的射程内**，是可交付的缺陷。

### 2.3 严重度与措辞订正（评审① 已采纳，措辞按此写）

**⛔ 不许写成「那一支死了 / 结构性不可达」。** 可达性**不是结构性的**：实测 `cfg.stateVars` 47 项里
`forecastBias` 在列（`WO-3ROOT-P1-cast-recon.txt` 金丝雀①），用户在扰动面板把它拨成负值即可打开那一支
（评审实测 24/150 越基值）。

**准确定性**：
> **默认播种世界缺了该量纲的负半轴，且没有任何机制把这件事说出来。**

⇒ 严重度不是「分支死了」，而是**「平台承诺了『方向性』这个业务语义（域注、边注释、显示名三处都写了），
默认世界却永远只讲一半；而唯一的对账是区间夹值，域内违反语义者静默通过」**。
⇒ 验收判据必须照这个改：**主判据是「默认世界在 X′ 下自己讲出低估故事」+「这件事从静默变成被点名」**，
不是「分支从不可达变可达」。

---

## 3. 修法（形状 · 不是补丁）

### 3.1 落点

**落点在铸造层（第 4~5 层），不在夹值层（第 7 层）。**

1. **铸造器参数化于「声明域的形状」**，而不是参数化于量纲的名字：

   ```
   // ⛔ 判据是域的形状，不是量纲名 —— 不许出现 if (stateVar === "forecastBias")
   span = max(restPoint − min, max − restPoint)          // 两侧可达范围取大者
   若 restPoint 严格落在 (min, max) 内部：
       cast(u) = round12(restPoint + (2u − 1) × span)    // u = seedHash01(id|v) ∈ [0, 0.999]
   否则（restPoint 就是某一侧的端点，如压力族 restPoint = min = 0）：
       cast(u) = round(restPoint + u × (max − restPoint)) // ← 与今天**逐字节相同**，不动
   ```

   - `forecastBias`：`restPoint=0, span=100` ⇒ `round((2u−1)×100) ∈ [−100, 100]` —— 负半轴回来了。
   - 压力族（`restPoint = min = 0`）：**走旧式不变** ⇒ 本单对 31 个压力族量纲零影响。
   - **这不是给 `forecastBias` 打特例**：判据是**域的形状谓词**（`restPoint` 是否严格内点），
     任何将来新增的带符号量纲自动被同一条规则覆盖。
   - **参数只能来自域表**（R14）：`min`/`max`/`restPoint` 三个数，⛔ 不许内联任何新常数。

2. **单一实现、单一来源**：铸造器放在 `synthetic/battery.ts`（`STATE_VAR_DOMAINS` 的**同一文件**，
   紧邻域表），`sim/seed-world.ts` 的 else 分支**调用它**。
   ⛔ 不许在 `seed-world.ts` 再抄一份（那是第二套真相源 —— 本仓已因同族错误炸过两次，见
   `spec-base-synthesis.ts` 头注「坑 2」）。

3. **对账从「区间」升到「语义」**（落点在**既有**接缝臂内，⛔ 不新增门/棘轮/基线 JSON）：
   `apps/datacore/test/sim-real-cells.seam.test.ts` 的**既有**域扫描臂（今天扫 `o.props` 的越域性）
   加两条断言：
   - **(a) 语义可达性**：凡 `restPoint` 严格内点于 `(min,max)` 的域，**铸造分布**必须同侧同时取到
     `< restPoint` 与 `> restPoint`。⛔ 它必须扫**铸造层**（`deriveSeedBaseSnapshot` 的产物），
     不许继续只扫 `o.props` —— 那层结构性失明，是第 7 层能活到今天的原因。
   - **(b) 补写不静默**：C2 补写（`λ·(base − rest)`）之后若观测量越出该格声明域，
     必须**被点名**（复用既有回执通道），⛔ 不许就地夹掉（夹掉 = 本仓判例骂的「夹成看起来正常」）。

### 3.2 为什么这不是打补丁

| 打补丁的形态 | 本单为什么不 |
|---|---|
| 改个系数 | 判决实验已做（符号一翻 150/150 越基值），但那是**诊断**不是修法：翻了符号「高估⇒下修」那一支会全反，边注释的两支会同时错 |
| 补一条边 | 退役注 ⛔ 明令「在此之前不许再往 `Order.demandPressure` 补负边」；且补边只救这一格，负半轴缺口原样存在 |
| 加个特判 | 判据是**域的形状**（`restPoint` 严格内点），不是 `if (stateVar === "forecastBias")` |
| 把 C2 合成挪到夹值之前 | **在本条实测下不解决本 WO 的问题**：`c ≡ −0.222×fb ≤ 0` 恒成立时上穿数仍是 0/150，它只把「饱和区退化成 `λ·base`」修成「诚实的 0」。它修的是**读数保真度**，本单修的是**入源能不能产出正 `c`** —— 两条**正交**、都要做，但只有本单是「超载侧信息进得来」的**成因层** |

---

## 4. ★ 对照实验（铁律 1.5 判据一 · 本单的验收骨架）

> **判据一**：不是「跑得起来吗」，而是「**当我把 X 改成 X′，Y 必须按某个可预言的方式变化**」。
> 写不出这条 = 这个单没法验收。

### 4.1 变量定义

- **X（今天）**：`deriveSeedBaseSnapshot` 对**每一格**都用 `round(seedHash01(id|v) × 100)`（从 0 起算的半轴）。
- **X′（修后）**：`restPoint` 严格内点于 `(min,max)` 的域，铸造式以 `restPoint` 为中心、按域对称展开
  （§3.1 的 `cast(u)`）；其余域**逐字节不变**。
- **Y（观测量）**：`y(o) = 读数(Order:o.demandPressure @tick20) − base(o)`，其中
  `base(o) = baseSnapshot[o].demandPressure`，**零扰动**会话（不推任何扰动、不拨任何杠杆）。

### 4.2 可预言形式（两个自由度都没有，全部由实测锚定）

入流式在 §2.1 已**逐位实测**：`c = k × fb`，`k = −0.222`（现场路由读，非文档抄）。
C2 递推 `x' = (1−λ)x + λ·base + c` ⇒ 不动点 `x* = base + c/λ`。
`k/λ = −0.222 / 0.37 = −0.6`（**精确**：`−0.222 = −0.6 × 0.37` 是 2026-09-19 仓主裁决的 λ 预乘，
见 `seed.ts:2062-2066`）⇒

> ### **`y*(o) = −0.6 × fb′(m(o))`**  （`m(o)` = 该单的型号，经 `order_for_model` 取得）

**符号分区（逐单、集合等式，不是计数）**：

> **上穿基值的单集合 ≡ 型号 `fb′ < 0` 的单集合**

### 4.3 预言值（离线复算，**上世界之前就已写出**）

铸造式已**逐值复现**（6/6 命中，证明复算的式子就是生产式子）：`round(seedHash01(id|"forecastBias")×100)`
⇒ `1, 88, 50, 88, 8, 79` 与 tick0 世界态实测**逐值相同**。
把同一 `u = seedHash01(...)` 代进 X′ 的 `cast(u)`：

| 型号 | 带单数 | X 的 `fb` | **X′ 的 `fb′`** | **预言 `y* = −0.6·fb′`** | 上穿? |
|---|---|---|---|---|---|
| `方形-LFP` | 28 | 8 | **−85** | **+51.0** | **是** |
| `2170-NCM` | 25 | 1 | **−98** | **+58.8** | **是** |
| `4680-LFP` | 37 | 88 | 77 | −46.2 | 否 |
| `4680-NCM` | 24 | 50 | 1 | −0.6 | 否 |
| `方形-NCM` | 21 | 79 | 58 | −34.8 | 否 |
| `圆柱-LFP` | 15 | 88 | 75 | −45.0 | 否 |

⇒ **X：上穿 0/150（已实测）· X′：上穿 53/150（= 28 + 25）**
⇒ 附带读数：`x*` 越出声明域 `[0,100]` 的单 **70/150**（companion 单的输入，见 §7）

### 4.4 对照臂与零扰动对照（缺一不算）

| 臂 | 形态 | 期望 |
|---|---|---|
| **A 基准臂（X）** | 现网（不修）同探针 | 负数型号 0/6、上穿 0/150 |
| **B 修后臂（X′）** | 同探针、同 seed、同起点 | 负数型号 2/6、`fb′` 逐值 = 上表、上穿 **53/150** 且**集合相等** |
| **C 回退臂** | 把铸造式改回 X 再跑 | 与 A **逐字节相同**（自证"是 X′ 引起的"） |
| **零扰动对照** | 全程不推扰动、不拨杠杆 | 排除「数变了」被天然衰减/扰动耦合冒充扰动生效 |
| **反向金丝雀** | 只把铸造式改回 `round(seedHash01×100)`、断言留着 | §3.1(a)(b) 两条断言**必须红** |

---

## 5. 🚦 范围边界（只碰这些文件）

> 跨**数据+引擎两半** ⇒ **一个 dev 整单做**，⛔ 不许拆两半给不同机制（本仓 metric-aware 反复炸的根）。

**改（5 个文件，全部在 `apps/datacore`）**

| 文件 | 改什么 | 不许碰什么 |
|---|---|---|
| `src/synthetic/battery.ts` | 新增导出铸造器（紧邻 `STATE_VAR_DOMAINS`），参数只取域表三数 | ⛔ 不动 `STATE_VAR_DOMAINS` 的任何取值、⛔ 不动 `STATE_VAR_VALUE_REFS`、⛔ 不搬去 contracts |
| `src/sim/seed-world.ts` | `deriveSeedBaseSnapshot` 的 else 分支（`:483`）改为**调用**新铸造器 | ⛔ 不动 `measuredRefVarKeys` 判据、⛔ 不动出处章口径（仍是 `"derived"`） |
| `src/sim/spec-base-synthesis.ts` | 补写后就地判定是否越出该格声明域，越域则**点名**（复用既有回执通道） | ⛔ 不改合成代数（`λ·(base−rest)` 一个数都不动）、⛔ 不许就地夹值 |
| `src/app.ts` | 仅当点名需要接进 tick 回执时，最小接线 | ⛔ 不动 `simAdvanceTicks` 的相序、⛔ 不动 `metric-series.ts` 的镜像环（一份实现两个调用点的既有约定不许破） |
| `test/sim-real-cells.seam.test.ts` | 既有域扫描臂 +§3.1(a)(b) 两条断言 | ⛔ 不新增门文件、⛔ 不新增基线 JSON、⛔ 不改既有 `EXCEPTIONS` 表 |

**改（1 个文档）**：`docs/SYSTEM-ONTOLOGY.md`（§0.4 回写承诺）。

**⛔ 不碰**：`packages/contracts`（含 `src/sim.ts`）· `apps/frontend-shell` · `apps/agentcore` ·
`/Users/apple/deploy/complete` · 任何门脚本 / 棘轮 / 基线 JSON。

**环境前置（开工第一件事）**
```bash
cd /Users/apple/deploy/wo-edge-wire
git fetch origin && git merge-base --is-ancestor HEAD origin/claude/inspiring-gates-aqczjg \
  && { echo "落后，必须重开"; git checkout -B claude/handoff-wo-3root-p1 origin/claude/inspiring-gates-aqczjg; } \
  || echo "不落后，可原地开工"
git checkout -B claude/handoff-wo-3root-p1 && git commit --allow-empty -m "WIP·未验" && git push -u origin HEAD:refs/heads/claude/handoff-wo-3root-p1
pnpm install --prefer-offline
pnpm --filter @platform/contracts build && pnpm --filter @platform/llm-adapters build
```
⛔ 不 push 到 canonical、不用 `-f`。⛔ 不重启任何后台服务（4019 是本工作流专用 dev 实例，
4001/4002 是别人的；需要重载本单改动时只动 4019）。

---

## 6. 验收判据（逐条可执行 · 命令 + 期望读数）

> 判据口径：**只有跑完后的红绿集合能用，时长不可作判据**（本机 4 核、load 常年 40~130）。
> 每条证据落盘 `docs/evidence/` 下 `.txt` + 同名 `.rc`，`CAPTURED_RC` 必须一致。

### A0 · 金丝雀先行（工具自证，缺此条后面全部作废）
```bash
node docs/evidence/WO-3ROOT-P1-cast-recon.mjs
```
期望：`金丝雀⓪ 必然命中: Order.demandPressure 入边 1 条 ✅` / `必然不命中: 0 条 ✅` /
`金丝雀① cfg.stateVars n=47 含forecastBias=true`。

### A1 · 铸造器参数化于**域的形状**（函数级 · 决定性 · 不依赖抽签）
对 `restPoint` 严格内点的域，把铸造器跑过一个**足够大的确定性 id 样本**（≥1000 个 id）：
期望：**两侧非空**（存在 `< restPoint` 且存在 `> restPoint`）。
对压力族（`restPoint = min`）：期望：**与 X 逐字节相同**。
⛔ 反向金丝雀：把铸造式改回 `round(seedHash01×100)` ⇒ 本条**必须红**。

### A2 · 世界级：铸造值真的跨了 restPoint（默认世界，零扰动）
```bash
node docs/evidence/WO-3ROOT-P1-model-partition.mjs
```
期望：`Model.forecastBias` 6 值 **逐值 = `−98, 77, 1, 75, −85, 58`**（按 §4.3 对应型号），**负数个数 = 2**。
⚠ 若抽签全正（概率 ~1.6%）⇒ **本条红 = 机器先说话**：改 seed 重抽（离线先算，不许上世界试）。

### A3 · 主判据：上穿集合 ≡ 型号 `fb′ < 0` 的单集合（逐单集合等式）
```bash
TICK=20 node docs/evidence/WO-3ROOT-P1-model-partition.mjs
```
期望：`上穿基值(+0.01) 单数 = 53/150`，且逐单集合等式成立：
`{上穿的单} == {方形-LFP(28 单) ∪ 2170-NCM(25 单)}`。**集合相等，不是计数相等。**

### A4 · 量级：`y*` 可预言（限定在域内，避开 companion 单的干扰）
对预言 `x* = base − 0.6·fb′ ∈ (0,100)` 的 **80 单**：
期望：`|实测读数 − (base − 0.6·fb′)| ≤ 0.01`。

### A5 · 对照臂与回退臂（铁律 1.5 的"零扰动对照"）
- **A 基准臂**：修前同探针 ⇒ `负数 0/6`、`上穿 0/150`（**已实测**，见 `WO-3ROOT-P1-cast-recon.txt` §④）。
- **C 回退臂**：改回 X 再跑 ⇒ 与 A **逐字节相同**。
- **零扰动对照**：全程不推扰动 ⇒ 排除"数变了"被天然衰减冒充。

### A6 · 反向金丝雀（判据必须能红）
把铸造式改回 `round(seedHash01×100)`、**断言留着** ⇒ A1/A2/A3 **必须红**。
（⛔ 不许用 `git checkout` 还原未提交实现，用 `cp` 备份 + `diff` 验净 —— 本仓已踩过。）

### A7 · 补写不静默（§3.1(b)）
期望：`x*` 越出 `[0,100]` 的单（预言 **70/150**）在回执里**被点名**；
⛔ 若被就地夹成 100 而无声 ⇒ **本条红**（夹掉 = 「把数据 bug 夹成看起来正常」）。
⚠ 若既有回执通道结构上装不下补写后半段 ⇒ **如实登记为 companion 单的输入**，
⛔ 不许为了塞进去而新造通道/新字段（禁令 3）。

### A8 · 确定性（R6）
同 `(industry, scale, seed)` 连建两次会话 ⇒ `baseSnapshot` **逐字节相同**。

### A9 · 既有边界不许被碰
- C2 边界：8 个入度 0 的规格格**仍逐字节恒定**（`WO-DUE-CHANGE-c2-intervention.md` §三 的两条控制仍成立）。
- 压力族 31 个量纲的铸造值**逐字节不变**（A1 已含，此处端到端复核）。
- 扰动 UI 拨负路径**不回归**（评审实测 24/150 越基值 ⇒ 改后仍可复现，读数按 `y* = −0.6·fb′` 走）。

### A10 · 回归半径（按 diff 半径取，⛔ 不假装全量）
```bash
pnpm --filter @platform/contracts build
pnpm --filter datacore test -- test/sim-real-cells.seam.test.ts test/sim-seed-world.seam.test.ts \
  test/process-tick-coverage.seam.test.ts test/seed-demo-propagation.test.ts test/sim-root-triad.seam.test.ts
pnpm -r build
```
**NOT-MEASURED 必须明写**：`apps/datacore/test/` 其余族 + `agentcore` + `frontend-shell` 本轮未跑
（本机四包全量门跑不动）。⛔ 不许把 A10 读成「四包全绿」。

---

## 7. ⛔ 不许做的事（违反即返工）

1. ⛔ **不许改这条边的任何字段**（系数 `−0.222`、`delayTicks`、`status`、`coefficientRef`）——
   符号翻转是**判决实验**，不是修法；翻了符号「高估 ⇒ 下修」那一支会全反。
2. ⛔ **不许往 `Order.demandPressure` 补新边** —— 退役注明令（`seed-derivation-specs.ts:166-172`）。
3. ⛔ **不许给 `forecastBias` 写名字特判** —— 判据必须是域的形状谓词。
4. ⛔ **不许在夹值层 CLAMP 消症状**（「那不叫修，叫藏」）。
5. ⛔ **不许新增门 / 棘轮 / 基线 JSON**（禁令 3）。
6. ⛔ **不许拆两半派人**（数据半 + 引擎半必须一个 dev 整单）。
7. ⛔ **不许 `git checkout` 还原未提交实现做 mutation**（用 `cp` 备份 + `diff` 验净）。
8. ⛔ **不许把本单的绿拿去顶 companion 单的账。**

### Companion 单（本单只测量并交办，⛔ 不在本单射程）

- **C-1 · 夹值次序**：核内先夹到 `[0,100]`、C2 补写 `λ·(base−rest)` 在**核之后** ⇒ 补写值不经夹值。
  本单修好入口后，预言 **70/150** 单的 `x*` 越出声明域 —— 这 70 是给 C-1 的**输入**。
  另：「核内先夹到 0 ⇒ 读数恒 `0.37×base`」二阶效应也归 C-1（实测形态：`观测量 = max(λ·base, x12)`）。
- **C-2 · 世界内生超载侧信息**：该格入度=1 且源入度=0 ⇒ 世界内生事件到不了这一格。
  由**刻意拓扑**（`G-ROOT-1` 降级）决定，**本单不覆盖**。
- **C-3 · 实测真值越域类**（360 格）：「越域的真值要不要夹」是**仓主裁决**，不在本单。
- **C-4 · 域下界幅度**：`−100` 的出处是「对称」约定 ⇒ 「重声明域为 `[0,100]/rest 50` + 翻边符号」
  这条产品路线仍然**开放**，本单不排除、不裁决。

---

## 8. 复现

```bash
# 环境：4019（本工作流专用 dev 实例，已在跑）· SEED_DEMO=1 · 真后端 · 无 mock
# ⛔ 不用 localhost（SameSite=Lax 丢 cookie）——一律 127.0.0.1
# 认证：-H 'X-Debug-User: demo:admin:admin'

# ① 铸造层证据核（入边/6 型号 fb/负数个数/零扰动 20 拍上穿数）
node /Users/apple/deploy/wo-edge-wire/docs/evidence/WO-3ROOT-P1-cast-recon.mjs

# ② 型号带单数 + X′ 逐单预言（order_for_model 实物化链路）
node /Users/apple/deploy/wo-edge-wire/docs/evidence/WO-3ROOT-P1-model-partition.mjs

# ③ 离线复算铸造式（6/6 命中自证；并给出 X′ 的 6 个 fb′）
node /tmp/wo-3root/p1-cast-predict.mjs
```

**证据落盘**：`docs/evidence/WO-3ROOT-P1-cast-recon.txt`（.rc=0）·
`docs/evidence/WO-3ROOT-P1-model-partition.txt`（.rc=0）。
