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

---

## 实施与验收（R3′ 修后，2026-09-23）

### 改动清单（五处，全在派单边界内）

1. **ontology.ts · 根因修法本体**：`runDerivations` 在既有 derivedProperties 循环之后，追加消费
   规格层 ACTIVE specs（按 targetType 索引）。五条行为约束逐条落地：方言翻译（新增导出
   `translateSpecFormula`）· 缺格不补写（`!(s.targetProp in obj.props)` 跳过）· 聚合跳过
   （含 `out(/in(` 一律拒译）· 坏式子 try-catch 不炸批 · derivedProperties 既有逻辑逐字节不动。
   另加一条实施期收紧：**任何「标识符紧跟 (」的函数调用形状一律拒译**（evalArithmetic 只识
   数字/标识符/四则/括号；首轮测试用 `COUNT(Order.so BY bases)` 探出旧版只拦 out(/in( 会漏，
   译出去就是编造口径——由测试咬出后补上，非事后粉饰）。
2. **battery.ts · 撤掉 R3 的 lineDerived 实例声明**（`derivedProperties` 声明属派单边界）。
   理由（实施期实测发现，非预先计划）：R3 给 Line 挂 `derivedProperties:[utilPressure]` 后，
   播种期 synthetic/service.ts 播完对象即跑一次 `runDerivations` ⇒ utilPressure **无规格也被
   物化** ⇒ sim-real-cells ⓐ 引擎归属臂（「清规格 ⇒ 25 个 targetProp 全消失」）对
   `line_util_pressure` 永久失效：实测红「清规格后仍有 130 对象带值」。
   ⚠ 该红在 R3 tip 即存在（机制唯一来源是 lineDerived 的播种期物化；本单改动在规格库为空时
   没有任何写路径，不可能产生那 130 格——未单独回 R3 tip 复跑，此处按机制归因如实标注）。
   撤掉后 utilPressure 由规格层 `line_util_pressure` 单源承担，ⓐ 臂复绿，
   且消掉「同一格两层各算一次」的第二真相源。
3. **action-plan-change-levers.seam.test.ts · 扩断言（不新建门）**：E3-b′ 新增两臂
   （Material.leadTime→shortageRisk 按规格式跟随 + `not.toBeCloseTo(before)` 咬「真的动了」；
   Process.utilization→queuePressure 同理）+ 聚合跳过臂（Model.supplyRisk 逐字节不变）+
   translateSpecFormula 纯用例 8 条。三条运行期臂均先走**生产同链**
   （seedDemoDerivationSpecs + recomputeDemoDerivationsAtSeed，即 server.ts SEED_DEMO=1 boot
   那两步）——少了它测试租户规格库为空、派生格根本不存在，首轮 NaN 红就是这么来的。
4. **useOptionAdopt.ts + 新 resolveObjectId.ts（§3 主键匹配）**：主键已声明 ⇒ 主键匹配权威，
   撞不上跳过宽松直落命名约定；主键取不到才回落旧宽松（保未声明主键类型既有行为）。
   纯函数拆进独立文件只为测试不拖 React/CSS 链。pkByType 复用 = 与 Console0828 同一条
   queryKey `["a","object-types"]`（TanStack 缓存去重，零额外请求），未改 Console0828.tsx
   （范围边界外）。
5. **test/use-option-adopt-resolve.test.ts · §3 对照用例（派单验收：不写不算修）**：
   同一页同一业务键，宽松匹配选中排前面的错误对象（非主键撞名）、主键匹配选对——
   两条断言并排，外加「主键查无不回落宽松」「约定 id 兜底」「无主键兼容」「数字主键不误中」。

### E3-b′ 主判据 · 四数表（真起 4011 实例，修前修后同 seed 同对象）

| 候选 | 下游派生量 | 修前（旧 dist） | 修后（新 dist） |
|---|---|---|---|
| Material.leadTime 26→10 | shortageRisk | 42.8563 → **42.8563（不动=病指纹）** | 42.8563 → **−48.5737**（= 规格式 `(617×10−6116−3051)×100/(617×10)` 精确值 −48.573744） |
| Line.utilization 95.8912→89.9153 | utilPressure | 跟到 89.9153 ✅ | 跟到 89.9153 ✅ |

修前证据：`/tmp/wo-dsh-migration-evidence/e3b-pre-baseline.txt(.rc=0)`；
修后证据：`e3-post-fix.txt(.rc=0)`（修后实例采纳前读数逐字节复现修前基线：leadTime=26、
shortageRisk=42.8563、utilization=95.8912——四数的「修前」列双侧一致）。

### 其余出口判据

- **E3-b 落库回读**：两次采纳均 approve step 1 即 EXECUTED，GET /a/v1/objects 回读
  leadTime.after=10 / utilization.after=89.9153（`e3-post-fix.txt` ⑤）。
- **E3-c 驳回反向**：Line.utilization→80 草稿 reject ⇒ REJECTED，utilization 95.8912→95.8912 不动（同文件 ②）。
- **E3-d 幂等**：同 candidateId+指纹去重查询恰好命中 1 条 EXECUTED——前端连点第二次复用它不新建（同文件 ⑥）。
- **E6 一屏**：真浏览器（系统 Chrome 裸 CDP·本机 playwright 已随 /tmp 蒸发，磁盘纪律不重装）
  1680 宽实测 `c0828-root` scrollHeight/clientHeight = 541/541 = **1.0000 ≤ 1.15** PASS
  （`e6-r3p.txt(.rc=0)` + shots/e6-r3p-console0828-1680x900.png）。
  如实注记两条：① 视口高实为 757（headless 预留），比 900 **更苛刻**仍 1.0；
  ② 数据面走 env.ts 默认链路（4001 真身，同 seed 42 数据集）——E6 是布局判据，
  DOM 由本分支前端代码（5174 供）决定，与数据实例无关。
- **sim-real-cells（§2.4）**：20/20 绿，totalCells=6381 / measuredCells=4183 未变
  （`sim-real-cells-r3p` 首轮 ⓐ 红=lineDerived 病灶，撤除后 `seam-both-r3p.txt(.rc=0)` 37/37 含本 seam 17/17）。
- **四包**：见文末「四包结果」（本段随 gate 跑完回填）。

### 覆盖率变化（派单 §2.2 口径）

运行期派生跟随覆盖：canonical 3/28 → R3 实例修法 4/28 → **R3′ 根因修法 = 规格层全部
自属性式子（28 条里除 4 条聚合外的 24 条 + derivedProperties 兜底面）**；
4 条聚合（`out(/in(`）运行期诚实跳过不编造，代价 = 该 4 格在动作后仍是播种期初算值
（测试钉死：Model.supplyRisk 逐字节不变），屏上出处章指的规格层式子不受影响。
下一个杠杆 prop 出现时谁先说话：**规格层**——新派生口径写进规格层一次，
播种物化/证据溯源/屏上出处/运行期重算四处自动共享；规格层缺席则播种期 valueRef 断
即抛错变红，轮不到屏上发现。

### 四包结果

（待回填）
