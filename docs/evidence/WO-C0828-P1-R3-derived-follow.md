# WO-C0828-P1 R3′ · 派生跟随根因修法 · 报告

| 项 | 值 |
|---|---|
| base commit | 72c376cbe（= origin/claude/handoff-wo-c0828-p1 WIP 锚） |
| 分支 | wo-sim-options-p1 → push refs/heads/claude/handoff-wo-c0828-p1 |
| 取证环境 | 本树真起 datacore PORT=4011 BLOB_DIR=/tmp/blobs-p1 SEED_DEMO=1（避让 4001 真身 pid 93331，未动） |

## §2.3 必答：两层为什么分开？——**有意的设计分层 + 历史遗留的断链**

先给结论：**分开是有意的设计（两层职责与治理级别不同），但「runDerivations 只认 derivedProperties、不消费规格层」不是设计意图，是规格层数据落地那单只补了证据层、没回接运行期重算链而留下的断链。**

### 证据（五条，全部实测/实读，非推断）

1. **两层职责不同，且各自消费方齐全**（铁律 0.5 追一层）：
   - 规格层（`DerivationSpec`，原子规格 §2 DSL：`this.x` + `out(L)/in(L)` + `COALESCE`，AST 编译 + topoSort + ACTIVE 状态机）：消费方 = ① 播种期物化 `deriveSeedBaseSnapshot`（登记 valueRef 解不到 ACTIVE 规格 ⇒ **抛错变红**，不许静默回落哈希）② 证据层溯源（slice-layers ⑭ / change-impact / impact-analysis / discoverLevers）③ `GET /a/v1/sim/view-config` 的 `stateVarValueRefs` 出处投影（屏上能说「这一格的值来自哪条公式」）。
   - `ObjectType.derivedProperties`（裸标识符 + `COUNT(X.y BY z)` 聚合法言）：唯一消费方 = `runDerivations`（动作执行后 / 时钟推进后的运行期重算，`app.ts` 采纳落库路径在案）。
2. **规格层数据落地单自己声明了「明知两层方言不互通，选择人工镜像」**：`seed-derivation-specs.ts` 头注原文——「电池模板的 `derivedProperties` 用的是**另一种方言**（裸标识符 + `COUNT(Order.so BY bases)` 聚合），与原子规格 §2 DSL（`this.x` + `out(L)`/`in(L)` 单跳导航）**不互通**……因此本种子只镜像**自属性公式**（语义 1:1，可机械翻译）」。该单的病灶定义 = 「规格层 ACTIVE 0 条 ⇒ **证据层**取不到数」（接了线没数据），修法 = 补数据。**它的范围里从来没有 runDerivations。**
3. **进仓时序**：规格层引擎（`compileSpecs`）与 `runDerivations` 同批进仓（2cf8a1e2a）；规格层**数据**（`DEMO_DERIVATION_SPECS`）晚至 2dc9febe6（WO-SLICE-DERIV-EMPTY）才播——引擎等数据等了整条线，而播数据那单只对准证据层，运行期重算链始终没接上规格层。
4. **规格层已被屏上出处章指认为单源**：`battery.ts` 的 `STATE_VAR_VALUE_REFS` 注释原文——「同一真值源，单源 > 并存」「specKey 断 ⇒ 播种抛错变红」「本行与那条规格必须同生共死」。**屏上讲的是规格层的式子，运行期重算算的却是另一层的式子**——不一致不是设计，是断链。
5. **实例修法 = 人工镜像权宜的延续，且镜像对象恰好在规格层全有**：杠杆下游三条 `Material.shortageRisk` / `Process.queuePressure` / `Line.utilPressure` 在规格层 29 条里**全有**（`material_shortage_risk` / `process_queue_pressure` / `line_util_pressure`），且都是自属性式子（1:1 可机械翻译那一类）。`battery.ts` 自己在 workshopId 那条注释里写过：「两处各算一次就是第二份真相，迟早分叉」。

### 裁决：走根因修法
（本文件在 dev 侧 b9611e1ef 被误删，此恢复版 = c5f63f4e0 原文。完整机制报告与收编附记见下。）

---

## 收编附记（2026-09-25 · 审核方 · merge 351e22f80）

- **树同一**：合并树与 dev 实测 tip `9ebae7e33` 逐字节同（`git diff --exit-code` 空）⇒ 本分支 R5 全量证据（回归线 5 文件 56 绿 / E3-b′ 三路跟随 / E3-c / E3-d 幂等 / E6 1.0000 / resolveObjectId 对照 5/5）随树直接转移，不重跑。
- **app.ts 取 dev 版**：R4 的 `FOLLOW_PROPS` 级联停gap被 R5 根因修法吸收——E3-b′ 已在无该级联的 dev 树上实证 `Line.utilPressure` 跟随（复验 02 明令禁止停在「只抄一条」）。
- **门直跑（本机 gate.sh 假绿，逐段直跑）**：5 静态门 3 绿 + 2 基线同红（stale-claims 67/31·新增 22+1 全同；chain-scan RC=2 同因 C36 门自瞎）；`pnpm gates` 12 FAIL + ~20 RC=2 自瞎，逐门 A/B 基线对照**零 R5 增量**。ontology-anchors 有 5 条锚点漂移增量（4×app.ts 系 P1 自身 +11 接线推过容差 · 1×ontology.ts runDerivations 系 R5 编辑）——按禁令 1（B 类停工）不修，该门本已基线红。
- **四包结果**：（电池收口后回填）
