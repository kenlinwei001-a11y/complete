# 复验 WO-SALES-RING（分支 claude/handoff-sales-ring @ceb6c9ff）

复验分支：`claude/verify-sales-ring`　复验时刻：2026-09-17　base（dev 自报）：`b7e3c44b`

## 裁决：**退回**（产品修复本身是对的，但打破了一道既有门，且 dev 未报）

---

## 判据 0 · 越界普查器「此前恒量 0 格」—— 属实，但定性要订正

base 两文件换回 `b7e3c44b` 后跑 §6，实测原文：

```
× 🔴 联立接缝：播完种的世界 0 格反算越界 ... 22828ms
  → 末拍一个已声明量纲的格都没数到 ⇒ 取数坏了: expected +0 to be 4937
  ❯ test/seed-demo-propagation.test.ts:847:54
```

⇒ `atEnd.declared = 0`、`atT0.declared = 4937`，**「恒量 0 格」属实**，修复正确。

⚠ **但「在空集上恒真」这个措辞不准**：base 上紧挨着的
`expect(atEnd.declared).toBe(atT0.declared)` 是守门员，**它当场红了**（上面原文即证）。
⇒ 这台量具不是「静默假绿」，而是**一条既有红**。不影响修复，影响定性。

## 判据 1 · 四个数 —— 全部复现（真 datacore · SEED_DEMO=1 · 内存模式）

端口自证（⛔ 不用 `ss`/`netstat` 的沉默当证据，本机也没有这两个命令）：
`lsof -i :4771 -sTCP:LISTEN` → 修后 `node 15026`、修前 `node 16481`，
两次 ppid 都是我 `nohup` 起的那个 shell ⇒ 读的是我自己这一版，不是别的 agent 遗留的陈旧服务。
（同刻确有另两个 agent 的 datacore 在跑：`:4051` pid 15970 属 `agent-ae8db5…`，**没杀**。）

取数金丝雀（证明读全了、读的是对的租户）：`Order` **500** 条、
`Σ Order.value` = **45,464,327,004**（与 CLAUDE.md 的 454.64 亿逐位吻合）。

判别性旁证（不是巧合）：圆柱-LFP / 方形-NCM 的「全量 max」与「在手 max」**不同**
（7624 vs 7463、12924 vs 12098），而世界态两次都取**在手**那个 ⇒ 我的口径与引擎一致。
在手单 = **150** 张，与 `seed.ts` 注释「实测 150/150」吻合。

| 型号 | max(Order.qty) | 修前 | 比值 | 修后 | 比值 |
|---|---|---|---|---|---|
| 4680-NCM | 16,131 | 5,968.47 | 0.370000 | 16,131 | 1.000000 |
| 方形-LFP | 21,777 | 8,057.49 | 0.370000 | 21,777 | 1.000000 |

**六个型号全部同形**（2170-NCM 10727 / 4680-LFP 14318 / 圆柱-LFP 7463 / 方形-NCM 12098），
且 `backlogPriceTop`、`backlogHorizonDays` 两族同样是 ×0.370000 → ×1.000000。
⇒ dev 报的四个数**全部复现**，病因诊断成立。

## 判据 2 · 四包门：**RC=1**

`bash scripts/gate.sh` → `GATE_RC=1`，两段判负：
`pnpm gates`（71 门中 12 判负）+ `TEST (六包·串行)`（datacore `vitest run` 退出 1）。

## 判据 3 · 接缝驱动：**7/7 绿，RC=0**（`sim-order-real-fields.seam.test.ts`）

## 判据 4 · 变异反证：**有牙**

把 `seed.ts` 换回 base（三条恢复 `inflowCoefficient(1)`）、**测试留在 HEAD** ⇒ 3 红：

| 断言 | 实测 | 比值 |
|---|---|---|
| ② 改真值 ⇒ 下游跟着变 | `expected 8376.06 to be 22638` | 0.370000 |
| ③ 两张差量级的单要拉开 | `expected 5430.4900000000125 to be 14677` | 0.370000 |
| ⑤ 真值出现在传导结果里 | `expected 40.7 to be 110` | 0.370000 |

三个比值**都恰是 λ**。改回去当场变红 ⇒ 测试不是装饰。

---

## 🔴 退回理由：本单打破了一道既有门，dev 未报

`apps/datacore/test/edge-money-weight.seam.test.ts:291–296`
「**全部 50 条边都经 `inflowCoefficient`，且 λ 取自 C35 规则参数（禁内联 0.37）**」

```
× §3 描述里的系数 = 真系数 > 全部 50 条边都经 inflowCoefficient… 11ms
  → 有边绕过 inflowCoefficient 直接写裸系数 ⇒ 它的稳态会比描述承诺的大 1/λ 倍:
    expected [ …(3) ] to deeply equal []
```

**恰好 3 条 = 本单改的那 3 条。** 紧邻的金丝雀
「🐤 把一条相符的边变异成不符，扫描器必须当场抓到」**同一次运行里是绿的**
⇒ 扫描器是好的，不是量法坏了。

拿该门**逐字同一条正则**（`/^[ \t]*coefficient:[ \t]*([^\n]*)/gm`）直接量两个版本的 `seed.ts`：

| 版本 | `coefficient:` 行数（门要求 ≥50） | 绕过 `inflowCoefficient` 的 |
|---|---|---|
| base `b7e3c44b` | 50 | **0** ⇒ 绿 |
| HEAD `ceb6c9ff` | 50 | **3** ⇒ 红 |

三条原文：`1, // 原样透传（同量纲直取 套→套）`／`元→元`／`天→天`。
行数金丝雀两侧都是 50 ⇒ 抽取器在两个版本上都有效，「0 vs 3」是真差异不是量法差异。

**为什么 dev 没看见**：这道门是**源码文本扫描**（`/^[ \t]*coefficient:/gm` 读 `seed.ts` 原文），
`pnpm -r build`、`pnpm -r typecheck`、以及本单自己的接缝门**全都绿**。
形态（铁律 0.6 第 4 条同构）：
> **「我用『build/typecheck/我这张单的接缝门全绿』当作『我没碰坏别的门』的证据，而前者并不度量后者
> —— 以源码文本为判据的门，类型系统一个都看不见。」**

### 最小修路径（⛔ 不许直接删这道门）

这道门今天的口径已经**过期**：它假设「每条边都会衰减，所以都得预乘 λ」。
本单恰恰证明了存在**不衰减的目标**（不在 `STATE_VAR_DOMAINS` 里），对它们乘 λ 才是错的。
故正确的修法是**把口径收窄成两支**，而不是放宽或删除：

`apps/datacore/test/edge-money-weight.seam.test.ts:291–296` 改为按**目标是否已声明取值域**分支：
- 目标 ∈ `STATE_VAR_DOMAINS`（会衰减）⇒ **必须**走 `inflowCoefficient(`；
- 目标 ∉ `STATE_VAR_DOMAINS`（不衰减，如三条 backlog 边）⇒ **必须不**走，且必须是裸数值。

⚠ 该门现在只读**源码文本**，拿不到 `targetStateVar`。两条路，任选其一：
① 同一个正则块里连 `targetStateVar:` 一起抽（相邻行，同一 `matchAll` 块内可取），按抽到的键查 `STATE_VAR_DOMAINS`；
② 改从 `DEMO_PROPAGATION_RULES` 真值读（与 `seed-demo-propagation.test.ts:944` 的增益预算门同源口径），
   文本扫描只留「λ 不许内联 0.37」那半条。
**②更强**：它与既有增益预算门共用同一条判据线，不再各抄一份正则。

并补一条**变异反证**：把任一条 backlog 边改回 `inflowCoefficient(1)` ⇒ 新门必须当场红
（否则新门对「回退」不敏感，等于没守）。

---

## 判据 5 · dev 顶回来的三条，逐条定性

### (a)「base 本身是红的」—— **属实，逐字吻合**
`pnpm --filter datacore typecheck`：base **RC=2**，两条
`test/seed-demo-propagation.test.ts(350,29)` / `(359,29)` `error TS2532`
—— 与 dev 报的行号**一字不差**。HEAD **RC=0**。这半条 dev 是对的，且修得干净。

### (b)「剩 2 红是 base 既有」—— **半对：那 2 条确是既有，但总数是 3 条，第 3 条本单造成**

HEAD 全量 datacore 跑完：`Test Files 3 failed | 357 passed | 2 skipped (362)`、
`Tests 3 failed | 2544 passed | 16 skipped (2563)`、RC=1、2234s。

**归属用实测定，不用推理**（把 `seed.ts` 换回 base、测试留 HEAD，重跑这 3 个文件）：

| 红 | HEAD 实测 | base 实测 | 归属 |
|---|---|---|---|
| `sim-seed-world` ⑤ | `expected 2445 to be 3861` | **同一句、同两个数** | base 既有 ✅ |
| `sim-real-cells` 臂2 | `Line\|blockedPressure=106.6596` | **同一句、同一个数** | base 既有 ✅ |
| **`edge-money-weight` §3b** | `绕过 inflowCoefficient …(3)` | **绿** | **本单造成** 🔴 |

base 侧回执：`Test Files 2 failed | 1 passed (3)` —— 绿的那一个正是 `edge-money-weight`。

旁证（与实测同向，非替代）：臂2 扫 `repos.objects.list()` 的目录对象属性，
`Line.blockedPressure` 由派生规格 `line_blocked_pressure`（`seed-derivation-specs.ts:86`）算出，
134ms 就红、根本没跑到传导；⑤e 比的 `reachCells` 是**结构 BFS**，与数值无关，
且三条 backlog 边的源 `Order.qty` 不是任何规则的目标 ⇒ BFS 走不到，两侧都不受本单影响。

### 附 · 静态门 12 红：**base 与 HEAD 逐条相同，全部既有**
`pnpm gates` 两侧同为 12 判负，名单逐条一致。
⚠ 中途差点误判一次：base 那轮 `check-dark-launch-integrity` 报的是
**RC=2「门自己没准备好，本次未度量任何代码，结论作废」**（我先前做变异实验时 dist 停在 base，没重 build），
差点被读成「它在 base 上是绿的」⇒ 差点错报成本单造成。
两侧各自 `pnpm --filter datacore build` 后重测：**双方都是 RC=1、同样 3 条**
（`sim.propagation.adversary` / `process.runtime` / `org.world` 未声明投放意图），与本单无关。
> **形态**：「我用『门没报 FAIL』当作『门通过了』的证据，而前者并不度量后者 —— 它说的是『我没查』。」

### (c)「两台量具不同意」—— **两台都没错，它们扫的不是同一个集合**
- A7 越界普查器 `overDomain` 扫**推演世界态**（`SimTickState.state`），引擎对已声明域做 `saturateToDomain` 夹取 ⇒ 0/4937。
- `sim-real-cells` 臂2 扫**目录对象属性**（`o.props`），派生层算完**原样留着、无人夹**（该臂自己的注释就写着「越域由引擎按域夹，对象上留原始值」）⇒ 106.6596。

> **形态**：「我用『A7 报 0 格越界』当作『全世界没有 blockedPressure 越界』的证据，而前者并不度量后者。」

**真正该修的是第三处**：`sim-real-cells.seam.test.ts:189` 注释 ④ 白纸黑字写
「blockedPressure —— **刻意不进域**」，而 WO-SIM-DESAT-3 已把它登记为域表**第 32 键**
（`battery.ts:3510`；三向金丝雀：`demandPressure` 在=真 / `backlogQtyTop` 不在=假 / `blockedPressure` 在=真）。
注释过期 ⇒ 它落进 `if (dom)` 分支、而 `EXCEPTIONS` 表里**没有** `"Line|blockedPressure"` ⇒ 判红。
**这是 DESAT-3 与 REAL-CELLS 臂2 的合并撞车，与本单无关。**
最小修：给 `EXCEPTIONS` 补 `"Line|blockedPressure"`（该臂注释自己记的实测区间 **27.72–182.73**），
并把注释 ④ 从「刻意不进域」改成「已登记为第 32 键」。

---

## 本单没有破坏的东西（逐条查过，供收编方参考）

- **增益预算门**（`seed-demo-propagation.test.ts:944`）filter 是
  `STATE_VAR_DOMAINS[r.targetStateVar] !== undefined` ⇒ 三条 backlog 边**按构造被排除**，不受影响。
- **契约**：`coefficientRef` 是 `.nullable().default(null)`，校验（`sim.ts:620`）只要求
  `coefficient` 或 `coefficientRef` **二者有其一** ⇒ `coefficient: 1` 合法。
- **③ `coefficientRef` 全留 null**：同意这是**结论不是没做完**。CLAUDE.md 铁律 1.5 判据四已记
  「实测 42 条边走 `coefficientRef` 的是 0 条」—— 既有普遍状态，本单未使之变差。
- 全仓再无第二处消费这三条规则/`backlogQtyTop` 的金值或前端引用（已扫 `apps/frontend-shell/src`、`apps/datacore/test`）。

## 收编建议

产品修复（`seed.ts` 那 22 行）与两台量具的修复**都是对的，值得收**；
卡住的只有一件：**`edge-money-weight.seam.test.ts:291–296` 那道门必须同单改口径**，
否则并进 canonical 就是拿一条新的红换一条旧的红。
