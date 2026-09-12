# WO-ONTO-P2-VERIFY · 决策推演台设计稿 10 条批注 —— **本单顶回来，不重测**

| 项 | 值 |
|---|---|
| **base commit** | `3db3d9cb`（= canonical `423edfb2` + 一个空 WIP 提交，**产品源码零改动**） |
| **canonical** | `423edfb2`（`origin/claude/inspiring-gates-aqczjg`） |
| **取证时刻** | 2026-09-10T15:43Z ～ 15:48Z |
| **树龄探针** | `wc -l apps/datacore/src/synthetic/battery.ts` = **7053**（对照：06-15 旧树 1249 · LOOP10 树 5357 · 兄弟单取证时 7043 ⇒ 本树最新） |
| **四包 build** | `contracts / llm-adapters / datacore / agentcore` **RC 全 0** |

---

## 〇、结论先行（一句话）

> **这 10 条批注已经被测过了，报告是 `docs/evidence/WO-SIMTAI-DESIGN-VERIFY.md`，已在 canonical 上。
> 本单若照派单开工，就是把一份 147 行的完整报告重做一遍。**
> **照 CLAUDE.md 铁律 0.6 第 5 条与派单模板第一段 —— 停手，改台账不改代码。**

**但派单里那批「疑似反证」的读数不是幻觉，也不是批注错了 —— 它们来自另一棵树。**
这才是本单真正的产出，见 §二。

---

## 一、为什么判「已经做了」（三层证据，不是 grep 一次就收工）

### 1.1 报告存在，且量的是同一批断言

`docs/evidence/WO-SIMTAI-DESIGN-VERIFY.md`（147 行），标题即
「决策推演台设计稿 **10 条**批注实测」，头部写明被测对象 =
「设计稿页面二『决策推演台 · 多扰动叠加』末尾 `<div class="ann">` 表 **10 行**」
—— 与本单派单里逐字列出的 10 条**同一份**。

其 base = `f6ed5b07`，取证时刻 2026-09-10T04:24Z～05:10Z。

### 1.2 它量的那棵树，与今天 canonical 的**运行行为逐字节相同**

这一步是关键：报告再完整，若树漂了，结论就可能过期（本仓治过多次）。
**判据落在「产品源码有没有实质改动」上，不是「提交数」也不是「文件存不存在」**。

```
git merge-base --is-ancestor f6ed5b07 origin/claude/inspiring-gates-aqczjg   → YES（不落后）
git diff --stat f6ed5b07 origin/claude/inspiring-gates-aqczjg -- apps packages
  apps/datacore/src/synthetic/battery.ts           |  12 ++-
  apps/datacore/test/seed-demo-propagation.test.ts | 113 +++++++++++++++++++++++
  2 files changed, 124 insertions(+), 1 deletion(-)
```

两个文件，一个是**新增测试**（不改运行行为），一个是 `battery.ts`。
`battery.ts` 那 12 行**全是注释**——不是眼看的，是剥注释后比对的：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 剥整行注释后比对 | `sed 's\|^[[:space:]]*//.*$\|\|'` 两版 → `diff -B` | **RC=0（完全相同）** |
| **金丝雀**（证明比对器有鉴别力） | 往新版第 826 行注入 `const CANARY_REAL_CHANGE = 1;` 再比 | **RC=1，且逐字打印出该行** |

⇒ 比对器抓得住真实代码改动，而它对这两版报「相同」⇒ **这 12 行确是纯注释**
（内容是 `coefficientRef` 那条戒律的定性订正：把「形同虚设」改写成「接了线没数据」）。

> **⇒ 兄弟单在 `f6ed5b07` 上量到的一切，在今天 canonical `423edfb2` 上依然成立。**
> 这不是「大概没变」，是「可执行代码逐字节未变」。

### 1.3 它的完成度已经压过本单的交付判据

本单 6 条交付判据，逐条对照兄弟单：

| 本单判据 | 兄弟单是否已满足 |
|---|---|
| ① 报告头回显三样 | ✅ base / 取证时刻 / 树龄探针（用的是 `propagation.ts`=1025 而非 `battery.ts`，探针不同但作用相同） |
| ② 10 条逐条一行，带判定与证据 | ✅ §一 表格 10 行齐全 |
| ③ 否定结论必须配金丝雀 | ✅ 逐处配了（#2 先证「有金额的页签」存在；#7 用 `exportCsv` 真实命中反证搜得到；披露层用 `coefficient` 47/47 非空反证不是空对象） |
| ④ #3/#9/#10 对照实验四个数 | ✅ #3 给了 A–G **七臂** HTTP 序列（含两条金丝雀臂）；#9 给了 `set 30` vs `set 3000` **两臂各四数**且两臂基线逐字节相同 |
| ⑤ 自污染披露 | ✅ 有（含一条很难看的：早期 `kill` 命令行匹配过宽，误杀了另外 3 个 agent 的 datacore） |
| ⑥ 照 `WO-ONTO-DESIGN-VERIFY.md` 体例 | ✅ 同体例 |

**重做一遍不会得到新信息，只会多烧一次配额。**

---

## 二、本单真正的产出 —— **派单里那批「疑似反证」来自一棵没并进来的树**

派单给了我 5 条线索，说它们「疑似反证批注 1 / 2 / 5 / 6」，并提醒我：
> ⛔ `console0828` 与批注里说的「推演区 13 页签」**可能不是同一个页面** …… 先把「批注量的是哪一块屏」搞清楚。

**这个提醒方向对，但陷阱比它猜的深一层：不是同一棵树里的两块屏，是两棵树。**

### 2.1 两棵树的清单差

派单里的读数取自 `integ-sim-final@5dd10143`。它**不是 canonical 的祖先**：

```
git merge-base --is-ancestor origin/claude/handoff-integ-sim-final origin/claude/inspiring-gates-aqczjg
  → NOT ancestor（即：这条支线的内容没进 canonical）
canonical        423edfb2  2026-09-10 15:41
integ-sim-final  5dd10143  2026-09-10 14:38
```

`git ls-tree -r --name-only <rev> apps/frontend-shell/src/views/sim/unified/`：

| | canonical `423edfb2` | integ-sim-final `5dd10143` |
|---|---|---|
| 文件数 | **13** | **20** |
| `console0828/Console0828.tsx` (1492 行) | ❌ **ABSENT** | ✅ PRESENT |
| `console0828/console0828Model.ts` · `eventCatalog.ts` · `.module.css` | ❌ ABSENT | ✅ PRESENT |
| `objectFacts.ts` · `useObjectFacts.ts` · `rail/businessFaces.ts` | ❌ ABSENT | ✅ PRESENT |
| `rail/PerturbRail.tsx` | 存在（旧版） | **+457 行** |

> **金丝雀（否定结论的前提）**：同一条 `ls-tree` 在 canonical 上返回 **13 条非空**、
> 且含我确定存在的 `rail/PerturbRail.tsx` ⇒ **列举器是好的**，
> 故 `console0828/` 的缺席是**真缺席**，不是「工具坏了」。

`git diff --stat canonical integ-sim-final -- apps packages` = **21 文件 / +4107 行**。

### 2.2 它为什么恰好长得像「反证」

`UnifiedSimShell.tsx:780`（**仅 integ-sim-final**）：

```tsx
/** 默认视图（08-28 控制台）。*/
if (!expert) {
  return (
    <div className={styles.shell} data-testid="usim-shell" data-view="console0828">
      <Console0828 sessionId={sessionId} onExpert={() => setExpert(true)} />
```

⇒ 在那棵树上，`console0828` 是 `/v/sim-unified` 的**默认屏**，
而兄弟单量到的「8 档页签」那个壳被降级到 `expert` 后面（`data-view="expert"`）。

**两份读数各自都是对的，只是量的不是同一棵树**：
- 兄弟单量 canonical ⇒ 那棵树上**根本没有 console0828**，默认就是 8 档壳。
- 派单量 integ-sim-final ⇒ 默认是 console0828，屏上自然有钱、有客户表、能一次加多件事。

> **形态（照铁律 0.6 句式）**：
> **「我用『两份读数不一致』当作『其中一份量错了屏』的证据，而前者并不度量后者
> —— 它们量的是两棵树，两份都没量错。」**

### 2.3 逐条差集：这批未并入的工作**闭掉了哪几条、没闭掉哪几条**

⚠ **本节是静态取证**（读 `integ-sim-final` 的源码 + CSS），**不是真浏览器实测** ——
理由与止损：这批代码还没并进 canonical，为它起一整套服务属「开新战线」。
凡否定结论均配金丝雀；凡我没跑过的，下面明写「未取到」。

**grep 鉴别力金丝雀（先自证工具，再报数）**：对 `Console0828.tsx` 跑
`grep -c sessionId` = **7**、`grep -c 推演` = **8** ⇒ 搜得进这个文件。

| 批注 | canonical 上（兄弟单实测） | integ-sim-final 上（本单静态取证） | 差集判定 |
|---|---|---|---|
| **1** 多扰动并列、逐条可开关 | 部分闭合：后端并列成立；`PerturbationTimeline`（含 delete）只挂在推演沙盘，控制台没挂 | **暂存区逐条可删已闭**：`Console0828.tsx:527` `onClick={() => setStaged(p => p.filter(x => x.uid !== s.uid))}`，配 `data-testid="c0828-staged"` / `c0828-staged-count`。**但已生效扰动仍关不掉**：`deleteSimPerturbation` 在本文件**仅出现在第 34 行注释里，零调用** | **半闭**：闭的是「施加前逐条摘」，**没闭**「施加后逐条关」——兄弟单点名的 A 类（种子扰动掺在每个读数里无从剔除）**依旧** |
| **2** 推演区 0 个金额数 | 已闭合（经 `optimize-pareto` 三根 `unit:"元"` 轴） | **更强地闭合**：常驻金额块 `data-testid="c0828-exposure"`，`fmtMoney(money.exposure,"元")`，**不在任何 `<details>` 内**（740–800 行区间 `<details>` 开闭计数 = 0） | **已闭合（两棵树都闭，证据不同）** |
| **5** 推演层无客户名/金额/交期 | **仍成立**（500 张 `obj_order_*` 非数值格 0 个） | **闭合**：`objectFacts.ts` / `useObjectFacts.ts` 把对象层事实取进推演层；`:773` 订单成交额合计、`:869` 「订单簿 … · N 家 · N 张」客户维 | **这是差集里最值钱的一条**：canonical 上兄弟单判的 **A 类**，在这棵未并入的树上**已经被修好了** |
| **6** 运行日志常驻、含「没动什么」 | 部分闭合：`实测格 N/M` 在常驻状态条，详情折叠 | **未闭，且派单的线索读反了**：派单说「屏上常驻一块『这一下都做了什么』（不折叠）」——实测 `Console0828.tsx:718` 的 `这一下都做了什么` 是**按钮说明浮层**（讲「算一下」内部是五次调用），**不是运行日志**；派单引的「这次一共有 N 格读数变了；世界从第 X 拍推到第 Y 拍」在 **`:845`，位于 `<details data-testid="c0828-recon">` 内**。全文件 `<details>` **13 个，带 `open` 的 0 个**；CSS 侧 `.more[open] > summary::before{content:"▾ "}` 且**无任何强制展开规则** ⇒ 默认**折叠** | **仍成立**（且派单该条线索需订正） |
| **7** 控制台内 0 导出 | 仍成立 | **仍成立**：`grep -cE "导出\|download\|exportCsv\|Blob" Console0828.tsx` = **0**。**金丝雀**：同一条 pattern 打在同分支 `views/sim/shared.tsx` 上 = **13** 命中（含 `downloadProvenanceReport` / 「导出」按钮注释）⇒ pattern 是好的，0 是真 0 | **仍成立** |
| **3 / 4 / 8 / 9 / 10** | 见兄弟单（3 前端闭·后端静默 201 残留；4 已闭；8 已闭；9 部分闭·饱和分辨率残留；10 轴已闭·cash 诚实报缺） | **未取到** —— 这五条落在后端引擎与 `optimize-pareto`，而两棵树的 `apps/datacore/src/sim/` 差异仅 `agent-proposal.ts`(+38) 等三处，**不触及 `propagation.ts` / 求解器**；但我未跑运行时验证 | **按兄弟单结论；差集**未测 |

---

## 三、给下一步的三条建议（不是请示，是判断，事后可否决）

1. **本单关闭，不产出第二份 10 条报告。** 台账里若挂着「页面二 10 条待测」，划掉，指向 `WO-SIMTAI-DESIGN-VERIFY.md`。
2. **`integ-sim-final@5dd10143` 是笔没收编的账，且它闭掉了一条 A 类（#5）。**
   兄弟单 §五 把 #5 判为 A 类（「COO 在推演层看不到金额与客户 ⇒ 会把 1.61 亿的单和小单同等对待」），
   而这条支线上**已经修好了**。这 4107 行卡在分支上不并，等于**A 类修复躺在盘上不上线**。
   建议按收编纪律核一遍并入（含铁律 0.6 第 5 条那条：确认它回写了对应 §8 行或台账行）。
3. **设计稿页面二那 10 行批注需回写**（与兄弟单 §六 同一诉求）：至少 #2 / #4 / #8 / #10 前提已过期，
   #5 在未并入支线上也已闭。不回写，下一轮还会照稿派出重复的单——**本单就是这么被派出来的**。

---

## 四、自污染披露

**本单零运行时探针**：没起 datacore / agentcore / vite，没开浏览器，**没有向租户 `demo` 写入任何东西**。
全部读数来自 `git` 只读命令与源码静态取证。
唯一的写动作：新建分支 `claude/handoff-wo-onto-p2`，其上一个空提交 + 本文件。
**`apps/` `packages/` `scripts/` 零改动**（符合 🚦范围边界与仓主 2026-08-20 冻结令）。

## 五、可复跑命令

```bash
CANON=origin/claude/inspiring-gates-aqczjg
INTEG=origin/claude/handoff-integ-sim-final

# §1.2 树漂：只剩两个文件，且 battery.ts 是纯注释
git diff --stat f6ed5b07 $CANON -- apps packages
git show f6ed5b07:apps/datacore/src/synthetic/battery.ts > /tmp/o.ts
git show $CANON:apps/datacore/src/synthetic/battery.ts   > /tmp/n.ts
diff -B <(sed 's|^[[:space:]]*//.*$||' /tmp/o.ts) <(sed 's|^[[:space:]]*//.*$||' /tmp/n.ts); echo "RC=$?  # 0 = 纯注释"
# 金丝雀：注入真改动必须被抓到
sed '826s|.*|const CANARY_REAL_CHANGE = 1;|' /tmp/n.ts > /tmp/c.ts
diff -B <(sed 's|^[[:space:]]*//.*$||' /tmp/o.ts) <(sed 's|^[[:space:]]*//.*$||' /tmp/c.ts); echo "RC=$?  # 1 = 有鉴别力"

# §2.1 两棵树的清单差（金丝雀：canonical 侧必须返回 13 条且含 PerturbRail.tsx）
git ls-tree -r --name-only $CANON apps/frontend-shell/src/views/sim/unified/ | sort
git ls-tree -r --name-only $INTEG apps/frontend-shell/src/views/sim/unified/ | sort
git merge-base --is-ancestor $INTEG $CANON; echo "RC=$?  # 非 0 = 没并进来"

# §2.3 逐条差集
git grep -n "Console0828" $INTEG -- apps/frontend-shell/src | grep -v console0828/   # 挂载点
git show $INTEG:apps/frontend-shell/src/views/sim/unified/console0828/Console0828.tsx > /tmp/c0828.tsx
grep -c "sessionId" /tmp/c0828.tsx            # 金丝雀 = 7
grep -cE "导出|download|exportCsv|Blob" /tmp/c0828.tsx    # = 0
git show $INTEG:apps/frontend-shell/src/views/sim/shared.tsx | grep -cE "导出|download|exportCsv|Blob"  # 金丝雀 = 13
grep -c "<details" /tmp/c0828.tsx             # 13
grep -c "<details[^>]*open" /tmp/c0828.tsx    # 0 ⇒ 全折叠
```
