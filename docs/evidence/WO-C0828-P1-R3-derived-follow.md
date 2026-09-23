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

让 `runDerivations` 消费规格层 ACTIVE specs（ontology.ts 一处），规格层成为「播种物化 + 证据溯源 + 屏上出处 + **运行期重算**」四处共享的单源。一次覆盖全部规格层自属性式子（25 条），聚合类（`out(/in(`，4 条）诚实跳过并计数。

**为什么不走实例修法**：实例修法是第 2 条证据里那个权宜的重复——每来一条新杠杆 prop，都要靠人记得「去 derivedProperties 再抄一份」，而「下一个杠杆 prop 出现时谁先说话」的答案是**没有任何机制先说话**（本单正是这样产生的）。根因修法后答案变成：**规格层**。新派生口径只写进规格层一次，运行期自动跟随；规格层缺席则播种期已抛错变红（机制 1①），轮不到屏上发现。

### 根因修法的五条行为约束（保既有口径不破）

1. **方言翻译**：`this.` 前缀机械剥离；顶层 `COALESCE(inner, 0)` ⇒ `inner` 求值非有限（除零/NaN）取 0；含 `out(`/`in(` 聚合 ⇒ 跳过并计 `skippedAggregate`。
2. **缺格不补写**：对象已有该 prop 格才原位更新；没有则计 `skippedMissingCell`——**总格数 6381 / 实测格 4183 不许变**（§2.4）。
3. **冲突优先级**：同一 (type,prop) 两层都有 ⇒ 以规格层 ACTIVE 式子为准（屏上出处指它）；`utilPressure` 两条同语义（`utilization` ≡ `this.utilization`），幂等无差。
4. **容错**：单条式子求值抛错 ⇒ 跳过该条计 `evalFailures`，不炸整批（`domain.ts` 已警告 compileSpecs 不校验 deps，ACTIVE 规格可能带坏式子）。
5. **derivedProperties 既有行为逐字节不变**（兜底面保留：规格层未覆盖的 (type,prop) 仍走它）。

（修前/修后四数表、E3 系列、E6、四包结果随做随补在本文件下文。）
