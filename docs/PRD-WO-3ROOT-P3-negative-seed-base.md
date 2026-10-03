# PRD · WO-3ROOT-P3 —— 声明域与落盘读数的一致性（把「越界由域夹住」从信念变成行为）

**一句话**：播种基值越出声明域（`Material.shortageRisk` 基值 −161.417972 等 4+6 格），而「域」在全仓
**只有一个执行点、且落在传导核之内**（`propagation.ts:1145`）；核之后的 C2 合成层每拍把规格格的世界态
覆写为 `cur + λ·(base − rest)`（`spec-base-synthesis.ts:90`），把刚夹到 0 的值换成 `λ·base`
⇒ 同一拍回执 `saturations[]` 报「已夹到 0」、落盘世界态却读 **−59.724650**，**两者逐位矛盾**。
本单**不决定「该不该夹」**（那是仓主保留的口径裁决，见 D0），而是把「域」从**某个消费者的实现细节**
提升为**值进入世界态的入口不变量**：三条写路（播种 / 传导核 / 合成）收敛到**同一个投影函数**
（复用 `saturateToDomain`，不新写），且**记账发生在三条路全部写完之后** ⇒
「回执说的」与「落盘的」在定义上就是同一个数，回执不再可能骗人。

- 状态：待开发（第 4 阶段产出）
- 闸门读数（**既有门**，本单未新增任何门/棘轮/基线）：`node scripts/check-prd-ontology.mjs` **RC=0**
  （唯一提示 = 本 PRD 引用的两个**待新建**文件「已删/改名」，与 `PRD-WO-3ROOT-P2` 同类，非致命）·
  `node scripts/check-prd-coverage.mjs` **RC=0**。
- 活实例再复现：`docs/evidence/WO-3ROOT-P3-live-recheck.txt`（`.rc` = 0，金丝雀过）——见 §1.2（含一处数字漂移，照实并列）。
- 前置根因档：`docs/evidence/WO-DUE-CHANGE-rootcause.md` · `docs/evidence/WO-DUE-CHANGE-c2-intervention.md`
- 本单自己的实测档（全部 `.rc` = 0）：
  `docs/evidence/WO-NEGSEED-P3-receipt-vs-world.txt`（主实验：回执 vs 世界态，逐拍配对）·
  `docs/evidence/WO-NEGSEED-P3-census.txt`（51 格普查：谁越界）·
  `docs/evidence/WO-NEGSEED-P3-coverage.txt`（谁在看着这些格：唯一调用点 / test 零命中）·
  `docs/evidence/WO-NEGSEED-P3-falsify.txt`（F2：base === props 逐字节）·
  `docs/evidence/WO-NEGSEED-P3-verify.txt` / `-verify-control.txt` / `-verify-formula.txt`（三支复验）
- 上游分析/验证：`/tmp/wo-3root/P3-negative-seed-base-analysis.md`（8 层链 + 停链判据）·
  `/tmp/wo-3root/P3-negative-seed-base-verify.md`（否证判据 F1 被推翻 → 机制已订正，见 §1.1-③）

---

## 一、病灶（实测定稿，不重跑）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 世界态读到**负的缺料风险**：`obj_material_elyte.shortageRisk = −59.724650`，**连读 6 拍逐位不变** | `WO-NEGSEED-P3-receipt-vs-world.txt` t1–t6 |
| 2 | 该读数是 **λ·base 不动点**，不是基值本身：λ=0.37，base=−161.417972 ⇒ λ·base = **−59.724650**（逐位） | 同文件；`propagation.ts:892`（λ 的作用式） |
| 3 | 基值来自**播种期逐字节取对象 props**：`const real = o.props[v]; if (typeof real === "number" && Number.isFinite(real)) { row[v] = real; }` —— 播种路**只取值、零变换**，函数签名 `deriveSeedBaseSnapshot(repos, tenantId)` **没有 domain 形参** | `sim/seed-world.ts:473-476` · `:393-395`（我逐字读过）；F2 实测 base === props 逐字节 **5/5**（`WO-NEGSEED-P3-falsify.txt`） |
| 4 | base 为什么是负的：规格式子算的是**带符号净额**而非风险值 —— `material_shortage_risk = (日耗×提前期 − 在手 − 在途)×100/(日耗×提前期)`，式子自注「**负=超储**」 | `seed-derivation-specs.ts:126`；实测 `elyte` dailyUse=242.6 / leadTime=10 / onHand=5173 / inTransit=1169 ⇒ **−161.417972**（round6 命中 4/4） |
| 5 | 越界**没有任何执行点**：`saturateToDomain` 全 `apps/datacore/src` **唯一函数调用**是 `propagation.ts:1145`（核之内）；域表 3 处注释共同断言「越界由本表声明的取值域夹住 / 超界由引擎按域夹」 | `WO-NEGSEED-P3-coverage.txt` ①（grep 全量输出，其余 5 行全是注释）；`battery.ts:3744` · `seed-derivation-specs.ts:70,79` |
| 6 | 核里**本来能兜住**：`propagation.ts:1132-1134` 原文「② 例外：存量真的在硬边界之外（种子里就有超界真值 …）⇒ 必须收回域内，否则『声明了 [0,100]』就成了一句假话」，`:1151` 执行、`:1154` push 进 `saturations[]` | 我逐字读过；tick1 实测 **829 条** saturations 记账 |
| 7 | 但 C2 合成点**刻意在核之后**且对命中格**无条件覆写**：`bucket[sv] = round12(cur + lambda * (base - rest))`（判据 = `stateVarValueRef` 有登记 ∧ 非外生 ∧ 本拍衰减过）⇒ **夹值被丢弃** | `spec-base-synthesis.ts:90`（头注自陈「本模块刻意独立成文件、由调用方在核**之外**合成」）· 调用点 `app.ts:2642-2643`「必须在核**之后**、落盘**之前**」· 落盘 `app.ts:2678 putTickState` |
| 8 | 🔴 **回执与世界态逐位矛盾**：同一拍同一格，回执 `saturations[]` 写 `raw=−98.590 → value=0 bound=min`，`/world` 读 **−59.724650** ⇒ 偏移 `world − 夹后值 ≡ λ·base`（−161.417972×0.37） | `WO-NEGSEED-P3-receipt-vs-world.txt`（t1–t6 逐拍；回执 raw 逐拍在变 −98.590/−32.059/−32.355/−32.579/−32.718/−32.805 ⇒ 核活着，是夹值被合成抵消） |
| 9 | 主探针（新会话 8 拍配对，越界 base 对 = **360**，规格 360 / 非规格 0，共 2880 采样点）：① 饱和拍（分母 2468）`world ≠ 夹后值+λ·base` = **0**（恒等式成立）①′ **回执报「夹到 X」而世界态 ≠ X = 2468/2468** ③ **base 越界格 tick≥1 落回域内 = 0** ② 未饱和衰减拍（分母 412）`world − λ·base < 0` = **0** | 同文件末段汇总 |
| 10 | 对照臂（谁**不**带 λ·base 偏移）：C2 判据会跳过的两类格 —— 外生豁免（`:81`）与无 valueRef（`:84`）。实测 36 点位中 `world` 恰等于 λ·base 的 = **0**；外生 3 格 `procurementDelay` lam 恒 `-`（从不衰减）、world 恒 = base（−4/−6/−7）；非规格 3 格 `ArInvoice.overduePressure` lam=0.37、base 15 ⇒ t1 = **9.45 = 15×0.63**（纯衰减） | 同文件「对照臂」段 |
| 11 | 越域**不止**由越界基值造成：t1 越域 1033 格中 **674 格 base 域内**、t5 1213 格中 **857 格 base 域内**；5 拍累计 **4056** 个「C2 造出来的越域」（这些格 `kernelOut` 全在域内 ⇒ 夹值一次都没参与），其中 **122 个连回执都没点名** | 评审员缺口 (2) 实测；与 §7 的代数一致 |
| 12 | tick0 的 **360 格越域先于核与 C2 存在**（我复测 = 360，与 census 逐位同）⇒ **入口侧全程无投影**，本机制只覆盖 tick≥1 | 评审员缺口 (3) 复测 |
| 13 | **没人发现**这件事：唯一扫域的测试扫的是**对象库 `o.props`**（不是 tick≥1 的世界态），且把那 9 格逐条实测后列进 `EXCEPTIONS` **白名单归档为预期**；归档理由恰恰是那条已被架空的「域管引擎每拍夹」；同时 `makeRestoreSpecBase` 在 `apps/datacore/test/` **0 命中**（金丝雀：同 tree 的 `src` 命中 4 处）⇒ **核 + 合成的组合路径零测试** | `sim-real-cells.seam.test.ts:178-203`（EXCEPTIONS 9 键与我 census 的 9 格逐键完全一致）· `:202` 归档理由原文 · `:224` 断言对象是 `t.repos.objects.list("demo")` 的 `o.props`；`WO-NEGSEED-P3-coverage.txt` ③ |

### 1.1 必须同时订正的三条（不许照抄旧措辞）

1. **「越界由域夹住」不是行为，是信念。** 它由 `battery.ts:3744`、`seed-derivation-specs.ts:70`、`:79`
   三处**互不相干的注释共同断言**，而全仓唯一的域执行点在核之内、且被核之后的合成层每拍抹掉。
   ⇒ 任何以此句为前提的论证（含 `sim-real-cells.seam.test.ts:202` 的归档理由、
   `seed.ts:1974-1975` 那条「压力族下侧是硬地板 ⇒ 不会为负」的稳定性证明）**对 tick≥1 的规格格不成立**，
   必须逐条重写，不许留着继续骗下一个读者。
2. **「播种基值越界」不是越域主因。** 实测越域格里 base 域内的占多数（t5 = 857/1213 = 71%），
   C2 自己 5 拍造出 4056 个越域。⇒ 若只按「让夹值生效」去修，会把 857 个**本是 C2 设计输出**的格
   一起夹掉 —— 那是**改口径**，不是修 bug。修法必须能区分「声明被违反」与「动力学算出来的合法高值」。
3. **机制陈述必须比「播种基值越界」宽，且不是「永久不动点」。** 准确陈述是
   **`world(t) = 核输出(t) + λ·base` 恒成立**：核饱和 ⇒ `world = 0 + λ·base`（此时回执说「已夹到 0」，
   世界态却是 λ·base）；核不再饱和 ⇒ `world = 核输出 + λ·base`（仍背着偏置回升）。
   实测：`obj_model_2170-NCM.supplyRisk` t1/t2/t3 核饱和 ⇒ 恒 −10.893503；t4 起不饱和 ⇒
   −10.530771 / −8.341329 / −5.485890（**F1「永久不动点」判据被推翻，机制据此订正**）。

### 1.2 本轮在**活实例**上的再复现（及一处诚实订正）

`docs/evidence/WO-3ROOT-P3-live-recheck.txt`（同名 `.rc` = **0**，金丝雀过）：新会话 2 对象 × 6 拍配对——

- `obj_material_elyte.shortageRisk`：**6/6 拍逐位复现** —— 回执报「已夹 −98.5901 → 0 bound=min」，
  `/world` 读 **−59.724660**，`offset ≡ λ·base` 逐位。
- `obj_model_2170-NCM.supplyRisk`：本轮 **t1–t6 核均未饱和**（world = −2.801033 / −0.662187 / 0.903176 / …）
  ⇒ 恒等式退化为 `world(t) = 核输出(t) + λ·base`（核输出 = world − λ·base = +8.092470 …，全在域内）。
- ⚠ **与 `WO-NEGSEED-P3-receipt-vs-world.txt`（今日 17:00 档）有一处数字漂移，照实并列、不择一**：
  base `−161.417972` → **`−161.418`**、world `−59.724650` → **`−59.724660`**；
  `supplyRisk` 的核饱和拍 t1–t3 → **本轮不再饱和**（活实例这一刻的对象库 props / 规则集与采样时不同，
  同一实例上另有工作流在跑）。
  ⇒ **判据必须写成结构性恒等式**（`world − 夹后值 ≡ λ·base` · `world = 核输出 + λ·base` ·
  回执点名格 `world ≠ 回执.value`），**⛔ 不许把具体位数当判据**
  （铁律 0.6：别拿一个没验证过在度量什么的数字当判据）。§七 A2/A7 已按此写。

---

## 二、要修的一条不变量（本单的定义域）

> **R-声明即行为（Domain-Declared-Means-Enforced）**：对每一个 (对象, 状态量) 格、每一拍，
> 二者**必须且只必须**成立其一 ——
> **(i) 该量在域表中有声明** ⇒ 落盘世界态的值 ∈ `[min, max]`（`max===null` 时只有下界一侧）；
> 且**若该拍对该格发生了任何压缩** ⇒ 该拍回执 `saturations[]` 中**有且仅有一条**该格的记录，
> 其 `value` **逐位等于**落盘世界态的那个数；
> **(ii) 该量不在域表** ⇒ 该拍 `undeclaredStateVars[]` 点名，且全仓**不许再有**任何断言它被夹的话。

今天的状态：`Material.shortageRisk` 有声明 `[0,100]`、落盘读 −59.724650、回执说「已夹到 0」
⇒ **三件事互相矛盾**（声明骗人 + 读数越域 + 回执造假），(i) 与 (ii) **都不成立**。
本单修的是这个矛盾，**不是**替仓主选「该夹还是该如实」。

两条支撑关系（本单的全部工作量）：
1. **写路收敛**：写世界态的路只有三条（播种 `seed-world.ts:475` / 传导核 `propagation.ts:1151` /
   合成 `spec-base-synthesis.ts:90`），域只在第二条上执行 ⇒ 收敛到**同一个投影入口**。
2. **记账后置**：`saturations[]` 的记账必须发生在三条路**全部写完之后**，且**只此一处**产出回执
   ⇒ 「回执说的」与「落盘的」在定义上是同一个数。

---

## 三、修法（一个 dev 整单做完）

### D0 · 前置裁决（**归仓主，不许 dev 自选**）

标题「基值该不该为负、改式子还是改域声明」是**业务口径裁决**，本 PRD 不做、也不许 dev 顺手做：

| 路 | 仓主裁定 | 本单落点 | 判据 |
|---|---|---|---|
| **A** | `shortageRisk` / `supplyRisk` 就是 **0–100 压力指数**（现域表口径为准） | 保持域声明，**入口投影生效**（越界值保序压回域内） | E1-Y2/路 A：读值 ∈ [0,100] |
| **B** | 应**如实带符号**（同 `procurementDelay` 的「如实」判例） | 改的是**域声明**（把它移出压力族、进 `undeclaredStateVars` 被点名），**不是**让「声明了 [0,100]」变成假话 | E1-Y2/路 B：`undeclaredStateVars` 逐拍点名，且没有越域 |

**两条路都经由同一个入口实现** —— 这正是「入口不变量」与「打补丁」的分界（见 §八-8）。
**D1–D3 与口径无关，可先行**；⛔ **没有 D0 裁决时不许改 `STATE_VAR_DOMAINS` 的任何一条内容**
（那是替仓主下结论）。

**附带前置项（仓主需一并定口径，否则下游继续因类型而异义）**：
`Supplier.procurementDelay` 的式子 `leadTime − transitDays`（自称「处理天数」）与 `seed.ts:1454` 登记的意图
（「这一家在手单的整体到货延迟、跨单聚合口径」）**不是同一个量**，却与 `PurchaseOrder.procurementDelay`
（`arriveDay − etaDay`，**正 = 晚**）**符号约定相反**。任何下游规则读它都会因类型而异义。
⇒ 这是 D0 的前置项，**本单只登记、不改式子**。

### D1 · 单一投影入口（写路收敛）

新增 `apps/datacore/src/sim/world-projection.ts`（名字可议，职责不可议）导出**唯一**投影入口：

- **复用** `saturateToDomain(raw, min, max, restPoint)`（`propagation.ts:434`，**逐字复用、不许复制几何**）；
- 入参取**与 `propagateTick` 第 10 位同一份** `stateVarDomains`（⛔ 不许各取一份、不许就地 new 一个）；
- 返回/记账形状 = 既有 `SaturationEvent`（`contracts/src/sim.ts:1142`，**不新增契约形状**）。

三条写路全部改为经它：

| 写路 | 今天 | 改成 |
|---|---|---|
| 播种 | `seed-world.ts:475` `row[v] = real`（**拿不到域**） | `deriveSeedBaseSnapshot` **加 domain 形参**（签名要改，调用点见 §六），tick0 逐格过入口；tick0 的记账随会话首次读面下发 |
| 传导核 | `propagation.ts` 第 4 步「量纲边界」**整段在核内** | **整段移出核**（核只做动力学）；投影由核外唯一入口执行 |
| 合成 | `spec-base-synthesis.ts:90` 覆写后**没人管** | **代数一行不改**；由调用方在**同一位置、合成之后**过入口 |

**投影必须「每拍每格最多一次」且沿用核里那条既有的防暗流护栏**（`propagation.ts:1101` 自述
`saturateToDomain` 在合法域内**不是恒等、且不幂等**，实测 SET 150 与 SET 200 投影 12 拍后只差 0.0222
＝一次性压缩本该差 2.0833 的 1/94）：**带内且与 tick 起点逐位相同 ⇒ 一字节不动**
（判据 ① 原文 `propagation.ts:1144` 的 `unchanged && !outsideHardBound ⇒ continue`，
移出核时**必须原样带走**）。⛔ 见 §八-1。

### D2 · 记账后置（回执单源）

- `saturations[]` / `undeclaredStateVars[]` **只由唯一入口产出**；核**不再自报**（否则又变成两处记账互相打架）。
- 记账时点 = **三条路全部写完、落盘之前**（`app.ts:2678 putTickState` 之前）。
- 回包三处读面（`/world` · `/tick` 回执 · `metric-series`）**同一份**（G-2 同族风险：不许各手抄一份）。

### D3 · 声明—行为对账（本单的**可见交付**）

- **tick0 也进对账**：今天 tick0 的 360 格越域**没有任何记账**（第 12 条事实）⇒ 会话创建后首拍
  `/world` / `/tick` 必须能看到 tick0 这一批的 `saturations`（或按 D0 路 B 的 `undeclaredStateVars` 点名）。
- **归档理由重写**：`sim-real-cells.seam.test.ts:202` 的「域管引擎每拍夹」已被证伪 ⇒ 本单**必须**把该理由
  改写成真话（它的断言对象是 `o.props`，本单**不动 props**，故断言仍绿 —— **改的是理由，不是断言**）。
- **回写本体**：`docs/SYSTEM-ONTOLOGY.md` §3（三条写路 → 单入口）· §8（新增断点，见 §五）。

---

## 四、对照实验（铁律 1.5 判据一 · **本单的验收核心**）

### E1（主判据）· 入口在场 / 不在场 ⇒ 对账恒等式必须恒成立

- **X′（干预）**：D1+D2 落地（三条写路经唯一入口 + 记账后置）。
- **X（基线）**：今天的形态（域只在核内执行、记账在核内）。
- **Y（可预言，逐位可测）**：

| 观测 | 基线读数（实测） | 干预后**必须** | 违反即 |
|---|---|---|---|
| **Y1 对账**：任取 (会话, 拍, 对象, 量)：回执点名 ⇒ `world === 回执.value`（逐位）；未点名 ⇒ `world === 该拍入口前原值` | **2468/2468 违反**（母数 = 饱和拍采样点） | **0 违反** | 修法没落地 / 记账有两处 |
| **Y2 值域**：域表中有声明的量，tick≥1 落盘值恒 ∈ `[min,max]` | 越界格 9 格全违反（`Material.shortageRisk` 4 对象 / `Model.supplyRisk` 6 对象 / `PurchaseOrder.expeditePressure` 7 对象…） | **0 违反**（路 A）；或 **0 越域格 ∧ 逐拍 `undeclaredStateVars` 点名**（路 B） | 声明仍在骗人 |
| **Y3 破不动点**：`elyte.shortageRisk` 的 `world(t)` | 6/6 拍恒 **−59.724650**（= λ·base 逐位） | `world(t) ≠ λ·base` **且** ∈ 域内（路 A）/ 被 undeclared 点名（路 B） | 夹值又被合成抵消 |
| **Y4 tick0**：tick0 越域格（实测 **360** 格） | 0 条记账（入口侧全程无投影） | 360 格全部落回域内**或**逐条点名；`saturations`(tick0) ≥ 1 | 只修 tick≥1 = 半份 |

### E2（反向护栏）· 不该动的格**逐位不许动**

- **X** = 修复；**X′** = 未修复。
- **Y**：C2 判据**会跳过**的两类格 —— 外生豁免（`spec-base-synthesis.ts:81`）与无 valueRef（`:84`）——
  读数**逐位不变**。基线实测（对照臂 36 点位）：`world` 恰等于 λ·base 的 = **0**；
  外生 3 格 `procurementDelay` lam 恒 `-`、world 恒 = base（−4/−6/−7）；
  非规格 3 格 `ArInvoice.overduePressure` lam=0.37、base 15 ⇒ t1 = **9.45 = 15×0.63**（纯衰减）。
- **这条是判「修法有没有变成全世界重写」的耳朵**：若干预后这 36 点位有任何一个变了
  （除非该格自己越出声明域 —— 变了就必须点名列出并给出理由），**修法越界了，返工**。

### E3（归因硬测试）· 偏置项必须随 X 消失

- **X** = 该格是否命中 C2 判据；**X′** = 命中 ⊃ 全体规格格（今天 25 格）。
- **Y**：基线中，对**每一个**命中格都有恒等式 `world(t) − 核输出(t) = λ·base`（饱和拍 = λ·base）。
  实测 `elyte.shortageRisk` 6/6 逐位、`supplyRisk` t1–t3 逐位。干预后该恒等式**必须不复存在**
  —— 不是「数字变了」，是**结构性消失**：`world` 必须逐位等于入口的输出，且入口输出恒在域内
  （或按路 B 被点名）。
- **阳性对照（三条实验共用，防探针空转）**：① 每拍世界态必须**在动**（实测 ~3800 格/拍变化）；
  ② 必然命中的金丝雀：`Object.keys(STATE_VAR_DOMAINS).length ≥ 38`；
  `stateVarValueRef("Material","shortageRisk") !== undefined`。
  ⛔ 探针若这三条有一条不成立 ⇒ 读数作废，不许读成「零违反」。

---

## 五、《本体引用与影响》（铁律 0 · 必含）

**触及的对象类型**：`Material`（`shortageRisk`）· `Model`（`supplyRisk` / `demandLoad`）·
`PurchaseOrder`（`procurementDelay` / `expeditePressure`）· `Supplier`（`procurementDelay`）·
`Order`（`leadDays` / `costPressure`）· `Line`（`blockedPressure`）· `Base`（`loadIndex`）·
`Customer`（`receivablePressure`）· `WIPLot`（`feedPressure`）· `ARInvoice`（`overduePressure`）·
`SimSession` / `SimTickState`（落盘世界态）· `StateVarDomain`（`STATE_VAR_DOMAINS` 域表，**只读**）·
`PropagationRule`（**只读，不改**）。共 10 类业务类型 + 3 类推演承载物。

**触及的链路**：
1. **规格 → 世界（tick0）**：`DerivationSpec` →〔`runDerivations` 物化〕→ `ObjectInstance.props` →
   〔`seed-world.ts:473` 逐格取同名 prop〕→ `SimSession.baseSnapshot` → **落盘世界态 tick0**。
   ⛔ 本单**不动** props（对象库那半仍在射程外，见 §九）。
2. **世界 → 世界（tick≥1，本单主角）**：`TickState(t−1)` →〔传导核：扰动 + 传导 + 衰减 + 量纲边界〕→
   〔**C2 合成** `cur + λ·(base − rest)`〕→〔**唯一投影入口（本单新增，取代核内第 4 步）**〕→
   `saturations[]` / `undeclaredStateVars[]`（回执）⊕ `putTickState`（落盘）。**回执与落盘同源**是本单的全部。
3. **回放环（第二个调用点）**：`metric-series.ts:150/157` 是 `simAdvanceTicks` 的**手工镜像副本**
   ⇒ 入口必须**一处实现、五处调用**（`app.ts:2632` 主路 · `:2605` 影子线 · `:2649` 漂移线 ·
   `:4549` 单拍路 · `metric-series.ts:157`）。**只改一处 = 分叉**（C2 头注「坑 2」已咬过第二次，是设计意图）。

**触及的事件**：**不发新事件**（本单无新产出操作；R10 不触发）。域表口径若走 D0 路 B ⇒ 回写
`docs/SYSTEM-ONTOLOGY.md` §4/§5 的**域表说明文字**，那是文档回写不是事件。

**触及的不变量 R1–R12**：
- **R1 contracts-only-shared**：`saturations` 形状**沿用** `SaturationEventSchema`（`contracts/src/sim.ts:1142`），
  前端/后端都不许手抄第二份；新入口不引入新契约形状。
- **R2 tenant_id everywhere**：入口按会话 tenant 装配，`/world`·`/tick`·`metric-series` 沿用既有
  `getSimOr404`；跨租户 404 不破。
- **R3 entitlement 先于 authz**：本单不改路由门；`sim.*` 功能门一律不动。
- **R4 真值写入经 Action**：本单只改**仿真世界自己那一行**（`putTickState`），落 **R4-sim 豁免**内；
  ⛔ **不**回写对象真值、⛔ **不**改本体；⛔ 不许拿投影当「把仿真结论写回真值」的出口。
- **R5 no-secrets-echo**：不涉及。
- **R6 确定性**：**头号约束** —— 入口是纯函数（`saturateToDomain` 无 `Date.now()` / 随机）；对象遍历序
  与 `bucket` 键序必须全序（沿用核内 `localeCompare` 排序）；同 (industry, scale, seed) 重复跑
  **逐字节一致**必须复验（E-验收 A8）。
- **R7 错误信封**：不涉及（不改错误路径）。
- **R8 认证**：不涉及。
- **R9 仓储双实现**：若 tick0 记账随会话落库（D3），memory/pg 两实现都要能存
  （四处同改：migrations + pg + memory + repo 接口）；**不许只改 memory 让测试变绿**。
- **R10 D-29 数据流闭环**：无新产出操作 ⇒ 无新事件（若最终决定发事件，须回写 §4；本 PRD 不含）。
- **R11 全链闭包**：`saturations` 今天已有读面（前端状态条 / 探针 / 测试）⇒ 本单只要求 tick0 也可见，
  **不许出现「字段在、没人读」**。
- **R12 双向闭包（数据构建）**：**本单的核心闭包正是它** —— 域表声明 → 入口执行 → 回执点名，
  三处必须一一对应；新增的每个 `undeclaredStateVars` 键都要有出处（不许「扫不到就算数」）。

**触及的断点 G-1..G-8（§8 逐条判定）**：

| 断点 | 是否命中 | 说明 |
|---|---|---|
| G-1（场景 20/20 端到端） | 否 | 本单不碰场景/意图/计划/渲染 |
| **G-2（跨服务字段名漂移 / Plan 读错字段 → FAIL）** | **✅ 命中（同族）** | 「两个面各说各话」的又一形态：**回执 `saturations` 说的数与落盘 `/world` 说的数逐位不一致**，且两者都在同一进程同一拍产出 |
| G-3（场景启动器 / presetContext） | 否 | 不碰 |
| G-4（意图绑定执行计划入口） | 否 | 不碰 |
| **G-5（应用层电池锁死 · 业务数据进生产）** | **✅ 命中（轻）** | 域表 `STATE_VAR_DOMAINS` 住在 `synthetic/battery.ts`；本单**不动它的角色**（不搬家），只让它**声明的东西变成行为** |
| G-6（connector/parser 三路统一） | 否 | 不碰 |
| G-7（LLM 用途枚举） | 否 | 不碰 |
| **G-8（数据构建闭包仅 DataCore 栈）** | **✅ 命中（轻）** | tick0 记账今天**无消费面**（0 条）⇒ 必须进闭包读面，不许「记了没人看」 |

**本单新增一条 §8 断点（须回写 `docs/SYSTEM-ONTOLOGY.md` §8）**：

> **`G-STATEVAR-DOMAIN-DECLARED-NOT-ENFORCED`** —— 「域表声明了 `[min,max]`，但世界态的写出边界
> **没有任何单点执行**，且**回执点名可以与落盘读数逐位矛盾**」。
> 形态（铁律 0.6 句式）：**「我用『域表里有这一条声明』当作『这个量被夹住了』的证据，而前者并不度量后者。」**
> 取证：`WO-NEGSEED-P3-receipt-vs-world.txt`（2468/2468 采样点回执与世界态不符）·
> `WO-NEGSEED-P3-coverage.txt`（`saturateToDomain` 全 src 唯一调用点在核内）。
> **闭合判据 = 本单 E1**（Y1 对账 0 违反 ∧ Y2 值域 0 违反 ∧ Y4 tick0 覆盖）。

**回写义务**：D1–D3 落地后**必须**回写 `docs/SYSTEM-ONTOLOGY.md` §3（三条写路 → 单入口）·
§8（新断点）· §5（若走 D0 路 B，域表说明）。本 PRD 即该回写的输入。

---

## 六、🚦 范围边界（**一个 dev 整单做完，不许拆两半**）

> 本单是**跨「数据层 + 引擎侧」**的特性（播种数据模型 + 五处 tick 环 + 落盘 + 回执读面），
> 拆开做必然重演 C2「坑 2」（生产环改了、镜像环没跟上 ⇒ 曲线与落盘世界对不上）。

| 文件 | 改什么 | ⛔ 不许碰什么 |
|---|---|---|
| `apps/datacore/src/sim/world-projection.ts`（**新增**） | 唯一投影入口；内部调 `saturateToDomain`；产出 `saturations` / `undeclaredStateVars` | ⛔ 不许复制 `saturateToDomain` 的几何（那是第二真相源）；⛔ 不许在这里读对象库 |
| `apps/datacore/src/sim/propagation.ts` | 第 4 步「量纲边界」**整段移出核**（含判据 ① 的防暗流护栏，逐字带走） | ⛔ 不许留着核内那一份（两处投影 = 双写路）；⛔ 不许让核认识规格语义（`sim.ts:13`「纯数值，无业务语义」） |
| `apps/datacore/src/sim/seed-world.ts` | `deriveSeedBaseSnapshot` **加 domain 形参**；tick0 逐格过入口并记账 | ⛔ 不许改播种取值优先级（同名 prop → 哈希占位）；⛔ 不许动 `seedHash01`；⛔ 不许动 `baseSnapshot` 冻结语义 |
| `apps/datacore/src/sim/spec-base-synthesis.ts` | 函数**不改代数**；其调用方在合成后过入口 | ⛔ **代数一行不改**（`cur + λ·(base − rest)`）；⛔ 不许认识业务语义 |
| `apps/datacore/src/app.ts` | 五处调用点装配（`:2632` 主路 / `:2605` 影子 / `:2649` 漂移 / `:4549` 单拍）+ 记账后置到 `putTickState`(`:2678`) 之前 + 回包 | ⛔ 不许只在主路接（影子/漂移两条线必须同一入口、同一记账）；⛔ 不许在 `simAdvanceTicks` 体内新增对象库访问 |
| `apps/datacore/src/sim/metric-series.ts` | 镜像环**同源**接入口 | ⛔ 不许与生产环各写一份 |
| `packages/contracts/src/sim.ts` | 回包形状（`saturations` / `undeclaredStateVars` 单源；tick0 记账可见） | ⛔ `SaturationEventSchema` / `CellOriginSchema` **形状不动** |
| `apps/datacore/src/synthetic/battery.ts` | **仅当 D0 = 路 B**：域表声明改动（移出压力族 + `undeclaredStateVars` 点名） | ⛔ 无 D0 裁决**一个字都不许改**；⛔ 不许改压力族其它条目 |
| `apps/datacore/src/seed-derivation-specs.ts` | **仅当 D0 = 路 B 且裁定改式子**：口径修正（**另单**，见 §九） | ⛔ 本单不许顺手改式子 |
| `apps/datacore/test/sim-domain-entry.seam.test.ts`（**新增 1 份**） | E1/E2/E3 + tick0 覆盖 + R6 两跑一致 | ⛔ 不许为了让新判据变绿而改既有断言 |
| `apps/datacore/test/sim-real-cells.seam.test.ts` | **归档理由重写成真话**（断言不动） | ⛔ 不许改断言、⛔ 不许删 EXCEPTIONS 键 |
| `apps/datacore/test/prop-clamp-decay.seam.test.ts` | 若核内第 4 步迁出 ⇒ 同步迁移其判据到入口 | ⛔ 不许删护栏用例（防暗流那三条 SET 74/80/200 是**判据本身**） |
| `docs/SYSTEM-ONTOLOGY.md` | §3 / §8（+ 路 B 时 §5）回写（**义务**） | ⛔ 不许只写不核 |

**⛔ 本单一律不碰**：`/Users/apple/deploy/complete`（别人的目录，只可观察）·
任何**门 / 棘轮 / 基线 JSON**（仓主禁令 3）· 前端（本单不接屏，见 §九诚实缺席）·
`ontology.ts` 的 `runDerivations`（不在 tick 里调它）· 对象库 props 的越界本身。

---

## 七、验收判据（逐条可执行：命令 + 期望读数）

> 环境：本机 dev 实例 `http://127.0.0.1:4019`（⛔ 不用 `localhost`，SameSite=Lax 丢 cookie），
> 认证头 `-H 'X-Debug-User: demo:admin:admin'`。**每条证据落 `docs/evidence/` 下的 `.txt` + 同名 `.rc`，
> `CAPTURED_RC` 必须一致**；日志必须跑完（半份日志不许读成零红）。
> ⛔ 探针必须自带阳性对照（§四末），否则读数作废。

| # | 判据 | 命令 | 期望读数 |
|---|---|---|---|
| **A0** | 实例与金丝雀 | `curl -s -H 'X-Debug-User: demo:admin:admin' -X POST http://127.0.0.1:4019/a/v1/sim/sessions -d '{}'` | HTTP 200 且回包含 `id` / `baseSnapshot`；否则一切读数作废 |
| **A1** | **单入口存在性**：三条写路的写点全部经同一函数 | `grep -rn 'world-projection' apps/datacore/src` + 逐条核对 `seed-world.ts` / `propagation.ts`（第 4 步已不在）/ `spec-base-synthesis.ts` 调用方 | 三个写点**全部**命中；`grep -rn 'saturateToDomain' apps/datacore/src` 的函数**调用点**收敛到 1 处（唯一入口） |
| **A2** | **对账恒等式（主判据）** | 跑 8 拍配对探针（脚本见 `WO-NEGSEED-P3-receipt-vs-world.mjs`，逐拍 `/tick` n:1 + `/world` 配对） | **回执点名格 `world ≠ 回执.value` = 0**（基线 **2468/2468**）；未点名格 `world ≠ 入口前原值` = 0 |
| **A3** | **越界格落回域内** | 跑 51 格普查（脚本见 `WO-NEGSEED-P3-census.mjs`） | 「含越界基值的格」= **0**（路 A）；或「越域格 = 0 ∧ `undeclaredStateVars` 逐拍点名」= 真（路 B） |
| **A4** | **tick0 覆盖** | 新会话**不推拍**，直接读 `/world` + 首个回包 | tick0 越域格（实测 **360**）逐条落回域内或被点名；tick0 `saturations` ≥ 1（基线 = **0 条**） |
| **A5** | **差异清单（防静默改动）** | 修复前后同会话同拍逐格 diff（4425 格 × 8 拍） | 每个变化格都**同时**有一条 `saturations` 台账且 `value` 逐位等于新读数 ⇒ **台账外变化 = 0**；台账数须点名列出（不设阈值，但必须可读） |
| **A6** | **对照臂不动** | 跑对照臂探针（外生豁免 3 格 + 无 valueRef 3 格，36 点位） | 逐位不变（除越域格须点名）；基线 `world == λ·base` 的 = 0 必须仍为 **0** |
| **A7** | **破不动点** | `elyte.shortageRisk` 8 拍 | `world(t) ≠ λ·base`（基线 6/6 拍恒 −59.724650）且 ∈ [0,100]（路 A） |
| **A8** | **R6 确定性** | 同参数建两会话，各推 5 拍，逐格 diff | **0 差**（4425 格 × 5 拍）；两会话 `saturations` 序列逐字节一致 |
| **A9** | **回放环一致（坑 2 的接缝）** | `metric-series` 同会话同拍 vs 落盘 `/world` | 逐格 0 差；五处调用点（`app.ts` 四 + `metric-series`）**全部**接同一入口 |
| **A10** | **回归（只跑 diff 半径内的）** | `pnpm --filter @platform/contracts build && pnpm --filter @platform/datacore test -- sim-real-cells.seam sim-domain-entry.seam prop-clamp-decay.seam sim-seed-world.seam` | 全绿；`sim-real-cells` 的 EXCEPTIONS 断言**仍绿**（它断言 props，本单不动 props）—— ⛔ 若它变红，先查是不是**改错了写路**（不是改判据） |

**⛔ 不许新增门 / 棘轮 / 基线 JSON**：以上全部是**测试与探针**，不进 `scripts/*check*`，不产生基线文件。

---

## 八、⛔ 明令不许（反补丁清单 · 违反即返工）

1. ⛔ **不许在合成层之后「再夹一次全世界」当补丁** —— `saturateToDomain` 在合法域内**不是恒等、且不幂等**
   （`propagation.ts:1101` 自述 + 实测 SET 150 与 SET 200 投影 12 拍后只差 0.0222 = 一次性压缩的 1/94），
   那样造出的是一条**与动力学无关的暗流**。入口必须带走判据 ①（带内且与 tick 起点逐位相同 ⇒ 一字节不动）。
2. ⛔ **不许在核里把 `λ·base` 再夹一次** —— 那是掩盖「回执说了夹、世界态没夹」的对账账：
   数会变好看，回执与世界态仍然各说各话。
3. ⛔ **不许改系数 / 补一条边 / 加特判** —— 只改一条写路，另外两条照旧分叉；
   而「三条路、一套域、零个共同入口」**正是本病的形态本身**。
4. ⛔ **不许新增门 / 棘轮 / 基线 JSON**（仓主禁令 3）；⛔ 不许为了让新判据变绿而改既有断言。
5. ⛔ **不许把记账留在两处**（核 + 入口）—— 回执必须**单源**，否则矛盾从「回执 vs 世界态」
   变成「回执 vs 回执」。
6. ⛔ **不许复制 `saturateToDomain` 几何**到新入口（复制 = 第二真相源，两次投影的分歧只是时间问题）。
7. ⛔ **不许改播种取值优先级 / `seedHash01` / `baseSnapshot` 冻结语义**。
8. ⛔ **不许替仓主决定口径**（D0）：没有裁决时**一个字都不许改** `STATE_VAR_DOMAINS` 的内容，
   也不许把 `shortageRisk` 悄悄排除在投影之外。
9. ⛔ **不许只修 tick≥1**：tick0 的 360 格越域与 tick≥1 是**同一条不变量**（§二），只修一半 = 返工。
10. ⛔ **不许顺手改 `Supplier.procurementDelay` 的式子** —— 它是 D0 的前置项，口径未定前动它 = 替仓主裁定。

---

## 九、诚实缺席 / NOT-MEASURED（不许当成已做）

1. **口径未定**：本 PRD **不解**标题里的「基值该不该为负、改式子还是改域声明」——
   那是第 8 层的业务裁决（`sim-real-cells.seam.test.ts:198`「要不要换口径归仓主裁」原文在案）。
   本单只保证：**无论哪条口径，声明与行为、回执与落盘必须一致**。
2. **干预 A/B 尚未真跑**：本阶段禁改产品代码 ⇒ 机制目前靠**观测 + 字面加法**成立，
   不是「干预上已闭合」。**§四 E1 就是那条缺失的干预 A/B**，必须在开发阶段**真跑**（A2/A3/A4 即其判据）。
3. **屏上可见性未测**：本 PRD 只读 `/world` API，**未开浏览器**确认沙盘屏上是否原样渲染这些负数
   ⇒ 「用户可见性」是**未测**，不是「已修」。前端接线不在本单范围。
4. **对象库 props 仍越界**：本单不动 `Material.shortageRisk = −161.417972` 这类**对象属性**
   （那是规格式子的产物），也不动式子本身 ⇒ `sim-real-cells.seam.test.ts` 的 EXCEPTIONS 断言**依然绿**，
   变的只是「归档理由」从假话改成真话。
5. **无域声明的格完全在射程外**：天数族负值（`Order.leadDays` −14 · `clearanceQueueDays` −8.9 ·
   `Supplier.procurementDelay` −6 · `PurchaseOrder.procurementDelay` −7）**没有域可执行** ⇒
   本单的任何入口对它们**零作用**（它们只会出现在 `undeclaredStateVars` 点名里）。
6. **不覆盖同 WO 的另一条根因**：规格格退化成纯积分器 / `demandPressure` 归零，是**独立链条**。
7. **`kernelOut` 全在域内的 4056 个 C2 越域**：本单的入口会把它们夹住（那是它们本来的归宿），
   但**「C2 造出的越域该不该夹」本身**仍是口径问题（第 11 条事实）⇒ 本单**只保证夹了就说**。

---

## 十、与既有决策的一致性（为什么这个形态不是自选动作）

| 既有决策 | 出处 | 本单如何对齐 |
|---|---|---|
| 「要不要换口径**归仓主裁**」 | `sim-real-cells.seam.test.ts:198` | D0 把它**前置**成开发的前置裁决，dev 不自选 |
| 「此刻声明下界 0 会把数据 bug 夹成看起来正常，**那不叫修，叫藏**」 | `battery.ts:3760-3761` | 本单的修法**不是**把病夹没：改的是「声明与行为一致」；路 B 下**根本不夹** |
| 「传导态 §1.2 **纯数值，无业务语义**」 | `contracts/src/sim.ts:13` | 本单把投影**移出核** ⇒ 核**更纯了**，方向与该契约一致 |
| C2 三条不许（不许 tick 里调 `runDerivations` / 不许让核认识规格格 / 不许在衰减相 `continue`） | `spec-base-synthesis.ts:12-18` | 本单不动代数、不动判据、不动播种优先级 |
| 「**不许静默夹住**：每一次压缩都进 `saturations[]` 随回执下发」 | `propagation.ts:1098-1099` | 本单把这句话从核内扩展到**全部三条写路 + tick0**，并把记账变成**单源** |
| 「只压缩这一拍真的产生了的新读数」（防暗流的唯一护栏） | `propagation.ts:1101-1115`（实测 SET 74/80/200） | **原样带走**（§八-1 把「丢掉它」列为返工） |
| 「域表声明为 `[0,100]`，其余由 tick0 生成式天然落在 0–100」 | `battery.ts:3744` | 该句的**前半**（真读数档越界由域夹住）被证伪 ⇒ 本单让行为追上这句话；后半不动 |

---

*（本文件为交付物 `docs/PRD-WO-3ROOT-P3-negative-seed-base.md` 的落盘副本；写作过程中的增量发现见 §一/§1.1。）*
