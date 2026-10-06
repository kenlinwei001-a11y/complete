# 修法清单 v2 · 按 LOOP 收敛后的根因重写（v1 的「规格退场」方向对、落点错）

> 2026-10-06 · 分支 `claude/semantics-declared` · **未改任何源码**
> v1 = `WO-AB-PLAN-three-layers.md`；本件是 LOOP 三方一致后的**修正版**。

## 一、根因回顾（C 的登记为准）

```
四步次序（app.ts:2696-2711）：
 ① 核   x ← 0.63x + Σamount                       λ=0.37
 ② C2   cur + 0.37·(base − rest)                  base=90.384615(投影后的 tick0) rest=0 ⇒ +33.4423/拍
 ③ 投影 saturateToDomain，knee=75                 raw>75 ⇒ 100 − 25/(1+(raw−75)/25)
 ④ 落盘
不动点 82.2915；零臂恒 90.384615 的唯一理由 = 核的 −0.37x 与 C2 的 +0.37·base 精确抵消
```

## 二、为什么不能只改 C2（我推过，代数当场否掉）

**若只让 C2 对 `Order.costPressure` 跳过**：零臂不再有抵消项 ⇒ `x ← 0.63x` ⇒ **从 90.3846 指数衰减到 0**，
C 登记的验收判据「`ZERO=1` 臂恒 90.384615384615 且 saturations 恒空」**当场破**。

**⇒ 根子不在 C2，在【播种值】：该格被播成 90.384615（= props 115 经 tick0 投影后的值），
而它的语义若是 `DEVIATION`，播种值就该是 `restPoint` = 0。**

## 三、修法（三处连带，缺一不可）

| # | 位置 | 改什么 | 依据 |
|---|---|---|---|
| **1** | `synthetic/battery.ts`（`STATE_VAR_VALUE_REFS` 旁） | 新增 `STATE_VAR_SEMANTICS` 声明表 + `stateVarSemantics()`；**缺省 `LEVEL` = 保持现状**，最小改动面。先只登记 `"Order\|costPressure": "DEVIATION"` | 扩既有绑定，不另立登记表（守住 `spec-base-synthesis.ts` 头注自立的规矩） |
| **2** | 播种路径（`castSeedBaseValue` / `seed-world.ts`） | 该格播种值 = `restPoint`（0），而非 `creditUsedRatio×100`（115 → 投影 90.3846） | 偏离量的静息态必须是 0 |
| **3** | `sim/spec-base-synthesis.ts` 守卫（:86-98） | 守卫从「有没有 valueRef 登记」升级为「语义是不是 `LEVEL`」；`DEVIATION` 格跳过（其锚就是 `restPoint`，C2 对它是恒等变换） | 该模块的作用是「把核的 rest 锚换成 base 锚」；语义定死后锚已唯一，C2 无活可干 |

**⇒ 改完的预期（就是判据）**：`zero` 臂 = 0（偏离 0，静息态）；`mag` 臂 = Σamount ≈ +0.073；
三臂 `db/da` 近似线性（≈3 / ≈20）。**屏上那个数会从 8.09 变成 0.073 —— 这是"修对了"的签名，
不是"改坏了"**：现在屏上那 8.09 的 99% 来自投影与基值恢复互相打架，与成本传导无关。

## 四、风险与不做的事

- ⚠ **屏上数会大幅变化**（8.09 → 0.073）。`03c4c8391` 就是因为「用户会看到坏东西」而回退的 ——
  **但那时没有 C 的登记判据。现在有。** 回退前必须先跑 §五 判据。
- ⚠ **`base` 是投影后的值不是 115**（C 的提醒③）：改 C2 若把 base 改成 115，零臂被点着
  （`0.63×90.38+0.37×115=99.5≠90.38`）。**本单不碰这条。**
- ⛔ **不做**：不动 14 格里其余 13 格（语义未逐格裁，缺省 `LEVEL` 保现状）；不新增门/棘轮/基线 JSON（禁令 3）；
  不改传导边系数 `0.2775`（C 判据①：改它应**无效应**，改了反而掩盖问题）。

## 五、验收判据（C 登记，可复跑）

1. 三臂 `MAG=-1|-3|-20`，`TICKS=12`：末拍偏离须**近似线性**（比值 ≈3 / ≈20）
2. `ZERO=1` 臂恒 `90.384615384615` ⇒ **改后应变为恒 0**（偏离语义的静息态）且 `saturations` 恒空
3. 跨格普查：`base∈(75,90]` 不得再出现与入流无关的台阶（−0.0749 / −1.5094 / −8.09）
4. **反证（防修错地方）**：只改传导边系数 `0.2775` 应当**无效应**（读数仍落 82.291509，只许动 ≈6e-3）；
   若读数随系数线性而变 ⇒ **本机制判定错误，回头重审**

脚本已在册：`WO-AB-SATPROJ-probe.mjs` / `-DISABLE-probe.mjs` / `-closure.mjs`、`B-cliff.mjs`、`C-cliff.mjs`。

## 六、执行顺序（增量，每步可停）

1. **第 1 步（行为中立）**：只加 `STATE_VAR_SEMANTICS` + `stateVarSemantics()`，**不接任何调用点**
   ⇒ 跑测试确认**零行为变化**。这一步失败面最小，先证"引入声明本身不炸"。
2. **第 2 步**：接第 3 处的守卫（C2 跳过 `DEVIATION`）
3. **第 3 步**：接第 2 处的播种值
4. 每步后跑 §五 判据；任一步判据不达 ⇒ 停，不叠加

---

## 七、执行决策（自决，附理由）

**4051 保持原样不动，另起 4052 装改后代码。** 理由：
1. 4051 进程内存里是**改前**旧代码（rebuild 不影响已加载进程）⇒ 天然是「改前臂」，零成本
2. 已入册 435 件证据全部以 4051 行为为准（82.291509 / 90.384615 / 拐点悬崖表）；
   **重启它会毁掉这些证据的可复现性基础** —— 而 C 判据①的反证（"只改系数应无效应"）
   恰恰需要「改前行为」还在场
3. 重启 4051 **不可逆**；起 4052 **可逆**
⇒ 天然 A/B：**4051 = 改前臂，4052 = 改后臂**，同一探针脚本打两边。
  这比"改前跑一遍记下、改后再跑一遍"强：后者靠记忆，前者靠同时在场。

**⚠ 第 2 步与第 3 步必须同批：** 只做第 2 步（C2 跳过 DEVIATION 格）会让零臂的
`−λx` 与 `+λ·base` 失去抵消 ⇒ 88.38 指数衰减到 0 ⇒ 中间态是坏的。
⇒ 两步同一提交、同一批验证。判据不达 ⇒ 整批回退，不叠加。

---

## 八、第 2+3 步的精确改法（落盘，待接续）

### 改点 A · 播种值（`seed-world.ts:492-497`）

```js
:492  const real = o.props[v];                      // props.costPressure = 115
:493  if (typeof real === "number" && Number.isFinite(real)) {
:494    row[v] = real;                               // ← 改点：DEVIATION 格这里该写 restPoint
:495    originRow[v] = "measured";                  // ← ⚠ 未决（见下）
:497    measuredCells += 1; measuredVarKeys.add(…); measuredRefVarKeys.add(…)
:544  const tick0Ledger = projectWorldCells(state, tick0Start, domains);   // 115 → 90.3846
```

拟改：`:494` 前插入分支 —— `stateVarSemantics(typeKey, v) === "DEVIATION"` 时
`row[v] = domains[v].restPoint`（**⚠ 取不到 restPoint 不许退回 0**，须点名）。

**⛔ 未决（动手前必须先读，不许猜）：**
1. **`originRow[v]` 该标什么？** 现在标 `"measured"` = "值来自对象实测属性"。
   改成 `restPoint` 后值不再来自实测 ⇒ **继续标 `measured` 就是在出处上写假话**，
   而"出处说假话"正是本单在治的病。须先读 `CellOrigin` 的档位定义与出处章的消费侧。
2. **`measuredCells` / `measuredVarKeys` / `measuredRefVarKeys` 三个计数** 在该格上是否仍该计？
   它们喂给 `stateVarReport`（`mergeStateVarDisclosure`）与 `GET /sim/view-config` 的出处展示。
3. **`Order.costPressure` 的 `props` 值 115 是否仍有别的消费者**（屏？本体面？）。
   若有，改播种值是否会让"本体面 115 / 世界态 0"两处不一致 —— 那是新的一种名实分家。

### 改点 B · C2 守卫（`spec-base-synthesis.ts:86-98`）

拟改：把「`stateVarValueRef(tk, sv) !== undefined`」这一道守卫**升级**为
「`stateVarSemantics(tk, sv) === "LEVEL"`」⇒ `DEVIATION` 格跳过 C2（其锚已是 `restPoint`，
C2 对它是恒等变换）。

**⚠ 与改点 A 必须同批**（见 §七）：只做 B 会让零臂失去 `−λx` 与 `+λ·base` 的抵消。

### 动手前置（⛔ 顺序不可颠倒）

1. 读 `CellOrigin` 定义 → 定 `originRow` 该标什么（**这是本单"不许出处说假话"纪律的直接要求**）
2. 查 `props.costPressure` 的非世界态消费者 → 定改播种值会不会造出新的名实分家
3. 两步同一提交 → build（rc 必落盘）→ 起 4052 → 跑 §五 四条判据（4051 作改前对照臂同时在场）
