# HANDOFF · WO-UI-FIRSTLAYER-BURNDOWN-2

> 断点：`G-UI-FIRSTLAYER-OVERLOAD` · 规范：`docs/CONVENTION-ui-information-layering.md`
> 交单分支：`claude/handoff-wo-ui-firstlayer-burndown-2` · 基线：`origin/claude/verify-reclaim-6`（`merge-base` = `9945e77c`，`check-branch-base` RC=0）

---

## ⚠ 先说最要紧的一条：**工单点名的五个文件里，有三个已经被另一条未并分支做完了**

> 这不是推测，是**祖先关系实测**（不是「文件在不在」——那个判据一天骗到过 4 个 dev）。

```
origin/claude/handoff-wo-ui-layering-burndown   tip f8af299f
git merge-base --is-ancestor f8af299f HEAD  ⇒  RC=1   （**不是**集成线祖先 ⇒ 未并）
git branch -a --contains f8af299f           ⇒  只有它自己那条 handoff 分支
```

拿门自己的 `--rev` 在**那条分支上**实测（`check-ui-first-layer.mjs --census --rev <该分支>`）：

| 文件 | 我的基线（集成线） | **那条未并分支上** |
|---|---|---|
| `GlobalSimView` | first 220 · formula 3 · prose 17 | first 211 · formula **0** · prose **0** |
| `SandboxConsole` | first 204 · formula 4 · prose 14 | first **174** · formula **0** · prose **0** |
| `ProjectSimView` | first 130 · formula 10 · prose 4 | first 127 · formula **0** · prose **0** |
| `DataBuilderPage` | first 159 · prose 4 · sizes 4 | **逐字节相同（没碰）** |
| `InspectorNodePanel` | first 111 · formula 4 · prose 12 · sizes 4 | **逐字节相同（没碰）** |

**⇒ 处置：去复验并入那条分支，不是让我再做一遍。** 本仓为这件事专门建过一道门
（`scripts/check-crossbranch-reinvent.mjs`，来历原话「**东西在未并分支上，主线 grep 必然 0 命中**」），
它的结论就是「这个符号在分支 X 上已经有了，别重造，去复验并入」。
我若照工单原样重做这三个，产出的是**与一条待复验分支逐行冲突的同功能代码**，
复验方必须扔掉一份 —— 纯浪费且制造冲突。

**所以本单实际做的是：那条分支没覆盖的全部余量**（两个文件 + 共享字号），
并且**刻意选了零重叠的文件边界**：本单只碰
`InspectorNodePanel.tsx` / `InspectorNodePanel.module.css` / `DataBuilderPage.tsx` / `SimViews.module.css`，
与那条分支碰的三个 `.tsx` **一个都不重合** ⇒ **两条分支可以直接先后并入，零冲突**。
更巧的是那条分支**没动字号**，其三个文件的 `sizes` 正好由本单的共享 CSS 一并结清。

---

## ① 实测数：五个文件的 first-layer 计数改前 / 改后

全部取自 `node scripts/check-ui-first-layer.mjs --explain <file>` 与 `--census` 差集，**不是转述**。

| 文件 | first | deferred | formula | prose | sizes | 本单处置 |
|---|---|---|---|---|---|---|
| `views/sim/InspectorNodePanel.tsx` | **111 → 101** | 3 → **15** | **4 → 0** | 12 → 7 | **4 → 3** | ✅ 本单全做 |
| `pages/admin/DataBuilderPage.tsx` | 159 → 159 | 74 → **76** | 0 | 4 → **3** | **4 → 3** | ✅ 本单全做 |
| `views/sim/ProjectSimView.tsx` | 130 | 37 | 10 | 4 | **4 → 3** | ◑ 字号本单结清；formula/prose 在未并分支上已 0 |
| `views/sim/GlobalSimView.tsx` | 220 | 32 | 3 | 17 | 3 | ⛔ 未碰（未并分支已做完，见上） |
| `views/sim/SandboxConsole.tsx` | 204 | 113 | 4 | 14 | 2 | ⛔ 未碰（同上） |

**顺带结清的三个（工单一个都没点到，被共享 CSS 连坐）**：

| 文件 | sizes |
|---|---|
| `views/sim/PlanAuditView.tsx` | **4 → 3** |
| `views/sim/SopReschedulePanel.tsx` | **4 → 3** |
| `views/sim/MultiObjWhatifPanel.tsx` | **4 → 3** |

**全仓口径**（`--census` 改前/改后逐字段差集，187 个文件全扫）：

```
字号 >3 级的文件数     12 → 6      ← 腰斩（R-UI-2 违规）
Σformula               51 → 47
Σfirst               6540 → 6530
Σdeferred            1245 → 1259
降层率（全扫描面）   15.99% → 16.16%
Σ(first+deferred)    7785 → 7789  ← **涨 4**，见 ⑥ 守恒证据
门 ui-first-layer:check   RC=1（6 条 D7 松弛）→ --tighten → **RC=0**
```

> **顶回工单三个数**（照交单格式「与工单给的数不一致时以你的为准并明确顶回来」）：
> 工单写 `GlobalSimView` first **209** / `SandboxConsole` **199** / `DataBuilderPage` **189** / `InspectorNodePanel` **108**。
> 实测分别是 **220 / 204 / 159 / 111**。
> 前两个是**基线登记值**（门自己的存量榜把它印成 `209 （现 220）`），不是现值；
> `DataBuilderPage` 的 189 更早已过期（基线 158、实测 159）。
> 拿登记值当现值，会把「已经变差 11 块」读成「没动过」。

---

## ② 改法与论据：为什么这么改，为什么不是别的改法

### 2.1 `InspectorNodePanel`：六段 `sectionSub` 整体降进 `InfoPopover`

改前每段标题都是 `<h4>① 五段耗时瀑布<small className={styles.sectionSub}>前置期 = 五段之和；…不另立口径</small></h4>` ——
**结论与口径同层并排**，正是 R-UI-3 点名的形态。
改后第一层只剩段名 + 一个 `?` 触发器，口径整段进浮层。

**为什么浮层写在调用处、而不是收进 `SectionTitle` 组件内部** —— 这一版是**改出来的**：
第一版把口径当 `caliber` prop 收进组件里渲染，屏上完全正确，但门**看不见**：
它判「第二层」靠的是**浮层组件名出现在 JSX 里**，`caliber={<>…</>}` 只是个普通属性，
于是六段口径被原样计回第一层 —— 实测 `first 111→110、deferred 3→4`，**几乎没动**。
规范 §6 早写着这条诚实边界：「经变量间接上屏的口径**门看不见** —— 那是门看不见，不是它同意」。
把 `<InfoPopover>` 摆回调用处后，**门看见的结构 ＝ 运行时真实的结构**，两边不再各说一套。

**② 流动效率那一处的分寸**：`= 增值 X ÷ 前置期 Y` 里，算式属浮层（R-UI-3），
但 §1 同时写着**浮层不许放结论性数字**。故只去掉 `=` 与 `÷` 两个运算符，改成「标签 · 值」，
**两个天数与 `data-*` 一个都没动**。改的是排版，不是数。

### 2.2 `DataBuilderPage`：先修真违规（字号），不硬压 first

门自己的优先级是 `formula > sizes>3 > prose > first 纯数量`。
本页 `formula` 已是 0，真违规是 `sizes=4`。实测 `grep -o "fontSize: *[0-9.]*" | uniq -c`：
**65×12 / 3×13 / 1×15 / 1×12.5** —— `12.5` **全页孤例**，与 12 在屏上分不出却占掉一整级配额，归 12 即达标。

另降两句：「逐产物 HITL」的机制说明、「推演当前不可达」括号里的
「守"绿测试≠能用"」（**本仓内部叫法**，R-UI-4 十三类形态之「内部机制名」）。

⚠ 两处降层都**刻意把关键词留成 `div` 的直接文本子节点**：
`f49.data-builder-console.test.tsx:114` 用 `getByText(/逐产物 HITL/)`、
`f50.data-builder-trust.test.tsx:64` 用 `findByText(/推演当前不可达：断在/)`，
而 testing-library 的 `getNodeText` **只看直接文本子节点** ——
把关键词一起搬进浮层会让这两条当场红（浮层关着时根本不渲染）。

### 2.3 共享 CSS：两条类，六个文件

- `.okBar` 13px → 12px：`grep -rln "styles.okBar"` 实测消费方**只有 1 个**（`ProjectSimView`）。
  它的强调本来就由 `font-weight:700` ＋ 1.5px 描边 ＋ 语义色扛着，不靠字号。
- `.audHead` 12.5px → 12px：消费方实测 **3 个**，且三个的第四级**恰好都只是它**。

⚠ **字号硬底**：两条都停在 **12px**，全单一处都没压到 12px 以下（有测试守，见 §3）。

⚠ **一处 `<details>` 都没新增**（红线②）。`DataBuilderPage` 里既有的 `<details>` 是上一张单
（`WO-UI-DECLUTTER-TOP3`）留下的，本单未增未减。降层一律用 `InfoPopover` ——
它关着时是**真的不渲染**（`open === false` ⇒ 不进 DOM），而闭合 `<details>` 的子节点
`getBoundingClientRect()` 仍返回非零旧矩形，版面门照样把它们当第一屏控件在数。

---

## ③ 改动 file:line

| 文件 | 位置 | 改了什么 |
|---|---|---|
| `apps/frontend-shell/src/views/sim/InspectorNodePanel.tsx` | `:1` `:33-35` | `type ReactNode` + `import { InfoPopover }` |
| ″ | `:82-120` | 新增 `SectionTitle`（`children` 必填 ⇒ 想删说明又留标题，TS 不给过） |
| ″ | `:269-275` | ⑤ 跨节点冲突 → `insp-cf-caliber` |
| ″ | `:299-305` | ③ 节点级流指标 → `insp-kpi-caliber` |
| ″ | `:385-398` | ④ 下钻证据 → `insp-ev-caliber`；标题破折号后半句一并降层 |
| ″ | `:769-775` | ① 五段耗时瀑布 → `insp-wf-caliber` |
| ″ | `:785-789` | ② 流动效率 → `insp-fe-caliber` |
| ″ | `:800-809` | `.flowFormula` 去掉 `=` / `÷`，改「标签 · 值」 |
| ″ | `:835-840` | ⑥ 变量输入 → `insp-var-caliber` |
| `apps/frontend-shell/src/views/sim/InspectorNodePanel.module.css` | `.title` | 15px → 13px（与段标题并级 ⇒ 三级 26/13/12） |
| ″ | `.sectionTitle` / `.sectionHeading` / `.sectionSub` | column → row，`?` 记号贴标题右侧 |
| `apps/frontend-shell/src/pages/admin/DataBuilderPage.tsx` | `:12` | `import { InfoPopover }` |
| ″ | `:212-227` | 逐产物 HITL：状态留第一层，机制进浮层（`dbp-hitl-*`，`:223`） |
| ″ | `:443-455` | 推演不可达：结论 + 缺口码留第一层，内部叫法进浮层（`dbp-unreachable-*`，`:451`） |
| ″ | `:1325` | `fontSize: 12.5` → `12` |
| `apps/frontend-shell/src/views/sim/SimViews.module.css` | `.okBar` | 13px → 12px |
| ″ | `.audHead` | 12.5px → 12px |
| `apps/frontend-shell/test/ui-firstlayer-burndown-2.seam.test.tsx` | 新增 | 接缝测试 10 例 |
| `scripts/ui-first-layer-baseline.json` | — | `--tighten`（只收紧） |
| `docs/SYSTEM-ONTOLOGY.md` | `:2300` `:2301` | 回写第二批进度 + **更正事实错误**（见 §7） |

---

## ④ 每条降层的**两向断言**证据 + 测试实跑输出

红线①要求「浮层里含该原文 **且** 第一层不再含」—— **只咬一向都会被骗**：
只咬前者 ⇒ 两层都印一遍也绿；只咬后者 ⇒ **整段删掉也绿**（正是 §1 红线禁的那件事）。
故 `test/ui-firstlayer-burndown-2.seam.test.tsx` 每条口径同时咬三条：
① 不 hover 时第一层不含原文 ② `?` 记号可见且是真 `<button>` ③ hover 后浮层**逐字**含原文。

被咬的六条（`DEMOTED` + `CF_DEMOTED`）：
`insp-wf-caliber` · `insp-fe-caliber` · `insp-kpi-caliber` · `insp-ev-caliber` · `insp-var-caliber` · `insp-cf-caliber`
（⑤ 跨节点冲突整块只在节点写了语义时才渲染，故单独用在册节点 `capacity.schedule` 验。）

**实跑（真 RC）**

```
$ pnpm --filter frontend-shell exec vitest run test/ui-firstlayer-burndown-2.seam.test.tsx
 Test Files  1 passed (1)
      Tests  10 passed (10)

$ pnpm --filter frontend-shell typecheck
TYPECHECK_RC=0

既有用例零回归（分三批实跑，全部 RC=0）：
  inspector-node-panel / node-semantics / wo-r13-ontochain-inspector / node-inspector-reachable
      → 4 文件 75 例全绿
  f38 / f46 / f49 / f50×2 / f58 / f60 / db-coverage-gate / dbui-13-needs / dbui-flow /
  domain-promote / build-pipeline-approval
      → 12 文件 45 例全绿
  debattery.plan-audit / project-sim-dag / project-sim / f14 / f15 / f18 / f19 /
  multiobj-whatif / sop-reschedule / wo-r13-ontochain-projsim / wo-sim-action-real
      → 11 文件 29 例全绿

$ node scripts/check-ui-first-layer.mjs   （--tighten 之后）
GATE_RC=0
```

> ⚠ **RC 一律 `cmd > log; echo $?` 单独取，不走管道。** 本单第一次跑门时用了 `| head -12`，
> 打出 `GATE_RC=0` 而**真码是 1** —— 管道里 `$?` 取的是 `head` 的码。
> 这正是本仓「把编译失败判成 BUILD 通过」那次事故的同一个坑，当场撞到、当场改。

---

## ⑤ 变异反证原文（三次，红都红在**该红的那句话**上）

判据不是「红了就行」，是**红在要证明的那件事上**（红在「组件不见了」只证明代码被删）。

### 变异 1 · 清空 ② 流动效率的浮层正文（只留 `InfoPopover` 外壳）

```
× §1 ③ hover 之后浮层里逐字含该原文
AssertionError: 浮层「insp-fe-caliber」里没有那段原文 ⇒ 这是删除，不是降层:
  expected '② 流动效率' to contain '流动效率 = 增值 ÷ 前置期（制造业典型 5–15%，读数低是正常的）'
Expected: "流动效率 = 增值 ÷ 前置期（制造业典型 5–15%，读数低是正常的）"
Received: "② 流动效率"
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

⚠ **同一次变异下 §1① 照样绿** —— 这就是「只咬一向不够」的**实证**，不是推想。

### 变异 2 · 静默降层（整块 `InfoPopover` 删掉，只留标题）

```
× §1 ② 第一层留着可见的 `?` 记号
TestingLibraryElementError: Unable to find an element by: [data-testid="info-insp-var-caliber"]
× §1 ③ / × §2 守恒        （同一根因，共 3 条红）
      Tests  3 failed | 6 passed (9)
```

红在「第一层没留记号」，正是规范 §1「静默降层等于删除」那一句。

### 变异 3 · `.audHead` 改回 12.5px ＋ 塞一条 11px

```
× §3 本单改过的两个 CSS module：一处都没有低于 12px 的字号
AssertionError: apps/frontend-shell/src/views/sim/SimViews.module.css 有低于 12px 的字号：11:
  expected [ 11 ] to deeply equal []
× §3 半档字号已归并
AssertionError: .audHead 的字号不是 12px，实际声明：display: flex; align-items: center; gap: 8px; font-size: 12.5px;
```

> ⚠ **这次变异当场抓出我自己测试里的一个假绿，已修并加金丝雀钉死。**
> 第一版 `block()` 用**固定 260 字窗口**取 CSS 规则体，越过闭合花括号扫进**隔壁** `.audWhy` 的
> `font-size: 12px` 并当成命中 ⇒ 把 12.5px 判成绿（第一轮跑这条**没红**，是我看见 `.audHead`
> 那条居然通过才追下去的）。改成按闭合花括号切（`ruleBody`），并新增一条金丝雀专咬「串到隔壁」。
> 形态照铁律 0.6：**「我用『这段文本里出现了 12px』当作『这条类是 12px』的证据，而前者并不度量后者。」**
> 与本仓 2026-08-08 记的「120 字窗口把 `G-NO-FREIGHT-COST` 截成 `-CO`」是同一个病。

**三次变异后均以 `git checkout -- <file>` 还原，并用 `git diff` 验证逐字节还原（输出全空）。
全程零 `git stash`**（仓库级跨 worktree 共享，今日已炸两次）。

---

## ⑥ `textEls` 守恒证据（防「删内容冒充变好」）

「first 变小」有两条成因，一好一坏，**光看 first 分不出来**：
真降层 ⇒ 内容搬到浮层，**总量不变或上涨**；假降层 ⇒ 内容被删，**总量下跌**。
故守恒证据取**两个互相独立的口径**：

**口径 A · 静态（门自己的 D5 全局守恒，含未登记文件）**

```
Σ(first + deferred)  全扫描面 187 文件：  7785 → 7789   （**涨 4**）
```

分数变好的同时内容总量在**涨**，故不可能是删出来的。
`conserve.total` 也随之 7718 → **7789**（只升不降 ＝ 更严）。

**口径 B · 运行时（`§2 · 内容守恒` 那条测试，真渲染真 hover）**

把面板整棵树上**带直接文本子节点**的元素数一遍：关着时 `> 40`；
再逐个打开六个浮层，每打开一个**总数必须涨** —— 浮层是空壳就红（变异 1 里它确实红了）。

两个口径一个查静态模板、一个查真实 DOM，**错法不同**，对得上才算数。

---

## ⑦ 基线变化：只降不升（跑的是 `--tighten`，不是 `--update`）

`--update` 在本仓是**认账动作**（会连放宽一起写下来，要理由与同码双测证据），**不是消红用的**。
本单方向是变好，故只跑 `--tighten` —— 口径已读源码复核（`pickMin` 取 `Math.min(旧, 实测)`，
`deferred` 刻意不动，`conserve.total` 走 `Math.max` 只升不降）。

逐条核 diff 方向，**判据字段无一放宽**：

```
DataBuilderPage      prose 4→3 · sizes 4→3
InspectorNodePanel   first 111→101 · formula 4→0 · prose 12→7 · sizes 4→3 · 新增 totalFloor 114
MultiObjWhatifPanel / PlanAuditView / ProjectSimView / SopReschedulePanel   sizes 4→3
conserve.total       7718 → 7789      （升 ＝ 更严）
```

⚠ `totals.first` 6485→6530 看着像「first 涨了」，**不是放宽**：
`grep -n "base.totals\|\.totals\." scripts/check-ui-first-layer.mjs` 实测**零命中** ——
该字段只被写、从不被读，纯展示量，不进任何判据。它涨是因为旧值 6485 早已过期
（写基线之后有别的单往第一层加过东西，靠 D1 的 §3 结构化豁免放行）；
按**实测**算是 6540 → 6530，方向是降的。

**本体回写**（`docs/SYSTEM-ONTOLOGY.md:2300` / `:2301`，两行是既有重复行，**同步改以免分叉**）：
补第二批进度，并**更正一处事实错误** —— 原文「后三者字号超标源自共享 `SimViews.module.css`，须整批动」**不成立**：
实测只有 `ProjectSimView` 引它；`InspectorNodePanel` 引自己的 module；`DataBuilderPage` **一个 CSS module 都不引**。
真正被该共享 CSS 连坐的是**另外三个**文件，本体此前一个都没点到。

---

## ⑧ 与其他 dev 的文件重叠情况

```
$ git log --oneline -5 -- apps/frontend-shell/src/views/sim/
37736eb7 WO-UI-FIRSTLAYER-BURNDOWN-2 ③ 共享 SimViews.module.css 字号（本单）
04941de3 WO-UI-FIRSTLAYER-BURNDOWN-2 ① InspectorNodePanel 分层（本单）
bec02d53 WO-U2-STEPWISE-2 · rebase 收尾：去掉与 WO-U4B-U1-U8-SIM 撞车的重复 InfoPopover 导入
16936d86 WO-U2-STEPWISE-2 · sim-sandbox：四步契约 + 分段闸
c593203b WO-U2-STEPWISE-2 · sop-balance
```

⚠ `bec02d53` 是个前车之鉴：上一批两张单**各自加了一次 `InfoPopover` 导入**而撞车，
typecheck 报真红后靠 rebase 收尾才拆开。本单加导入前先 `grep -n "InfoPopover"` 确认过
两个目标文件都**尚未导入**（`InspectorNodePanel` 与 `DataBuilderPage` 改前均 0 处），
且与那条未并分支的三个 `.tsx` 零重叠 ⇒ 不会重演。

| 我碰的文件 | 别人在动吗 |
|---|---|
| `views/sim/InspectorNodePanel.tsx` / `.module.css` | **无**（那条未并分支逐字节没碰） |
| `pages/admin/DataBuilderPage.tsx` | **无**（同上） |
| `views/sim/SimViews.module.css` | **无**（那条未并分支只碰 3 个 `.tsx`） |
| `views/sim/SandboxView.tsx` | ⛔ **本单一个字都没碰**（工单明令，多单同时在改） |

⇒ 与 `claude/handoff-wo-ui-layering-burndown` **零文件重叠，可先后并入不冲突**。

---

## ⑨ 没做的部分 ＋ 差什么才能做（不写「未做」二字了事）

| # | 没做的 | 为什么 | **可派的下一步** |
|---|---|---|---|
| 1 | `GlobalSimView` / `SandboxConsole` / `ProjectSimView` 的 formula·prose | 已在 `origin/claude/handoff-wo-ui-layering-burndown` 上做完（祖先关系实测未并） | **不是派单，是复验并入那条分支。** 并入后其 3 个文件 `sizes` 已被本单结清，两边零冲突 |
| 2 | `DataBuilderPage` 的 `first`（159 未降） | 159 块绝大多数是模块同步矩阵 / 比对现状 / scaffold 清单 / 最近构建这几张**状态表的表头与单元格**，属规范 §4「明细表页」豁免；硬压只能靠藏表格列 ＝ 拿可用性换分数 | 若仍要降：需**产品裁决**先定「这一页要回答的那个数是哪一个」，再按 §3 把四张平铺表改成「一个结论 + 点开下钻」。属重构不属 burn-down，建议独立单 |
| 3 | `InspectorNodePanel` 剩余 prose 7 | 其中 4 条是**诚实位**（EMPTY 无承载 / 不驱动读数 / 本拓扑不适用 / 跑批中禁用调参），按 §4.2「若为真会让人重新解读第一层结论 ⇒ 属第一层」**不该降**；2 条在宿主 header 且被 `sandbox-console.seam` 与 `node-semantics.seam` 用 `.textContent` 正向断言，降层会红 | 那 2 条（`node-inspector-live-cost` / `node-inspector-semantics-coverage`）文案本身是 R-UI-4 开发话（`chain_loss_attribution` / `lossPayload`）。**要动必须连那两条断言一起改**，属 `dev-jargon:check` 的地盘，建议并进那条线 |
| 4 | `PlanGenerateView` sizes 仍 4（`.genTitle b` 13px） | 不在本单五个文件里，且 `.genTitle` 消费方与本单无关 | 一行 CSS 即可（`.genTitle b` 13→12），可并进下一批 |
| 5 | 全仓仍有 6 个文件 sizes>3 | 本单已从 12 腰斩到 6 | 逐个查 `--census` 的 `sizeValues`，多数同为「半档/孤例」形态，一行 CSS 一个 |

---

## ⑩ 交单前三条

```
$ git status --porcelain                          → 空
$ node scripts/check-branch-base.mjs HEAD         → RC=0
$ node scripts/check-merge-conflict-markers.mjs   → RC=0
```

⚠ **`check-prd-ontology.mjs` 偷写了 `docs/prd-ontology-index.json`**（41 增 / 9 删，含把
`generatedAt` 从 `2026-08-17` 改成 `2026-08-20`）—— 派单前置 §6.4 点名的那个坑，**当场撞到**。
已 `git checkout -- docs/prd-ontology-index.json` 还原，并用
`git diff <merge-base> HEAD -- docs/prd-ontology-index.json`（输出全空）证明该文件本单**逐字节未碰**。
**没有无脑 `git add -A`**：全程按路径 add，每次提交前先 `git status --porcelain` 看一眼。
