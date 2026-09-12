# WO-UI-LAYERING-BURNDOWN · 第一层过载存量 burn-down + 让存量自己冒出来

<!-- wo-anchors: allow-missing: apps/frontend-shell/test/ui-layering.seam.test.tsx -->

## 🚦 范围边界（本单身份）

**只碰**：
- `scripts/check-ui-first-layer.mjs` + `scripts/ui-first-layer-baseline.json`
- 前端视图（**逐页**，见 §3 清单）：`views/RiskBoardView.tsx` · `views/sim/GlobalSimView.tsx` ·
  `views/DecisionPlayView.tsx` · `views/sim/SopBalanceView.tsx` · `views/DashboardView.tsx` ·
  `views/sim/ProjectSimView.tsx` · `views/sim/InspectorNodePanel.tsx`
- `apps/frontend-shell/src/components/InfoPopover*`（若需增强）· `locales/zh.ts`
- `apps/frontend-shell/test/ui-layering.seam.test.tsx`（新建）
- `docs/SYSTEM-ONTOLOGY.md` · `docs/CONVENTION-ui-information-layering.md`

**⛔ 不碰**（有别的 agent 正在里面）：
- `apps/frontend-shell/src/pages/admin/DataBuilderPage.tsx` —— **WO-DBUI-FLOW 正在整页重排**，
  它在榜上第 4（189 块）但**本单不许碰**，等那单落地后另立。
- `views/sim/SandboxConsole.tsx` —— 榜上第 3（199 块 · 长说明 32），沙盘系列多张单刚落，先冻一轮。
- 后端一切（`apps/datacore/**` · `apps/agentcore/**` · `packages/contracts/**`）。

## 0 · 环境前置

```bash
CANON=origin/claude/inspiring-gates-aqczjg
git fetch origin
git checkout -B claude/handoff-wo-ui-layering origin/claude/verify-reclaim-6
git merge-base --is-ancestor HEAD $CANON && echo "落后 ⇒ 停手回报" || echo ok
pnpm install --prefer-offline
pnpm --filter @platform/contracts build
pnpm --filter @platform/llm-adapters build
```

## 1 · 需求来源

仓主看到 `DecisionPlayView` 的一整段说明后原话：

> 「这是干嘛用的，**不是说把这些解释性的都变成鼠标放在"？"的弹窗模式吗？**」

约定**早就存在**且有完整承载物：
- 断点 `G-UI-FIRSTLAYER-OVERLOAD`（本体 §1718），登记原文引的就是仓主 2026-08-10 的原话
  「太多信息在第一层，密密麻麻，无法看到重点指标信息」
- 规范 `docs/CONVENTION-ui-information-layering.md` §1/§2（R-UI-2 / R-UI-3）
- 组件 `@/components/InfoPopover`
- 门 `scripts/check-ui-first-layer.mjs`

**能力全在，只是没落地。**

## 2 · 现场（审核方现测，你仍要自己复核）

### 2.1 ⛔ 门是棘轮 ⇒ 只防变差，**存量不会自己冒出来**

审核方实测：`DecisionPlayView` 在门的输出里 **0 命中**，而它在基线里躺着
`{"first":79,"deferred":20,"formula":0,"prose":6,"sizes":7}`。
门没瞎 —— 它按设计只报「相对基线变差了的」。

**形态**（铁律 0.6 句式）：
**「我用『门没报这页』当作『这页没问题』的证据，而棘轮只度量有没有变差，不度量现在有多差。」**

⚠️ **审核方自己在取证时也踩了一次同族的坑，记在这里当反例**：第一次统计我读了
`v.second` / `v.popover` 两个字段并得出「全仓每一页第二层 0、浮层 0 ⇒ 零分层」——
**那两个字段根本不存在**，真实字段是 `deferred`。差一步就报出一个恰好相反的结论。
**你做任何基线统计前，先把单条真实形状打印出来。**

### 2.2 存量榜（审核方现算，你要自己重跑）

```
第一层  降层  口径/公式  长说明  字号级数   文件
  227    27        4      17       14   RiskBoardView.tsx
  209    29        3      17        8   GlobalSimView.tsx
  199    19        5      32        5   SandboxConsole.tsx     ← 本单不碰
  189    29        0      21        7   DataBuilderPage.tsx    ← 本单不碰
  144     1        7       8        8   SopBalanceView.tsx
  137     5        0       6       10   DashboardView.tsx
  126    36       10       4        8   ProjectSimView.tsx
  108     3        4      14        6   InspectorNodePanel.tsx
   79    20        0       6        7   DecisionPlayView.tsx   ← 仓主截图那页
```

**全仓：第一层 4261 块 · 降层 544 块 ⇒ 降层率 11.3% · 95 个文件里 36 个 `deferred=0`。**
另：规范 R-UI-2 要求**字号 ≤3 级**，RiskBoard 实测 **14 级**、Dashboard **10 级**。

### 2.3 仓主截图那段的三分（照它做，别一刀切）

`DecisionPlayView.tsx:182-220` 那一整段混了**三种**东西，处置完全不同：

| 内容 | 去哪 | 为什么 |
|---|---|---|
| 「下面 5 区显示的是引擎按贡献选出的**默认根因**，不是这条阻滞点对应的根因」 | **留第一层** | 这是**结论**不是解释。删了它，用户会把 5 区当成对自己问题的回答 —— 那是**读错**，不是「少看点说明」 |
| 为什么对不上（`locus{objectType,objectId}` 撞不上 `CausalFactor{drillType,drillId}`、种子里没有对应因子）· 「没有猜一个 factorId」的理由 | **进 `?` 浮层** | 口径/机制，规范 §2 明说属浮层 |
| `contracts ChainImpedimentSchema 是 strictObject，逐键核过，无 factorId / factorRef` | **进代码注释，屏上删掉** | **给开发看的**。用户不需要知道契约是不是 strictObject |

第三类最刺眼 —— **契约类型名上了屏**。这与 `DataBuilderPage` 的「三页归一（自成长收编）」
「厂商中立施工」是同一个病：**开发的话进了用户的屏**。

## 3 · 要做什么

### 3.1 给门补「存量榜」输出（判据一个字不改）

门每次运行时，除现有的「相对基线变差」告警外，**再打印基线里第一层最重的 Top-N**
（含 `first` / `deferred` / `formula` / `prose` / `sizes` 与降层率）。

**硬要求**：
- **不改判据、不改 RC 语义**。这是**可见性**改造，不是收紧门。
- 榜单**从基线现算**，不许写死（写死的榜会过期，而过期的榜比没有更糟）。
- 顺带打印**全仓降层率**（`deferred / (first + deferred)`）与 `deferred=0` 的文件数 ——
  一个总数答不了「有多少页从没降过层」。

### 3.2 逐页 burn-down（本单清单 7 页）

对 §2.2 榜上**本单范围内**的 7 页，按 §2.3 的三分逐条降层：

| 页 | 现 first | 目标 |
|---|---:|---|
| RiskBoardView | 227 | 你定，但**必须同时把字号从 14 级降到 ≤3 级**（R-UI-2） |
| GlobalSimView | 209 | 同上 |
| SopBalanceView | 144 | 它 `deferred` 只有 **1** —— 几乎从没降过层，优先 |
| DashboardView | 137 | 字号 10 级 → ≤3 |
| ProjectSimView | 126 | 它 `formula` **10** 处最多（口径/公式在第一层，R-UI-3 直接违规） |
| InspectorNodePanel | 108 | — |
| DecisionPlayView | 79 | 仓主截图那页，§2.3 已给逐句三分 |

**不许为了让数字好看而删内容**：规范 §1 原文「三层准入 · **不许删除**」，
门的修法也写着「**第一层必须留可见记号** —— 静默降层等于删除」。
每一处降层都必须在第一层留一个 `?` 或等价记号。

**优先级判据（若时间不够，按这个顺序）**：
`formula`（口径/公式在第一层，直接违规 R-UI-3）> `sizes`（字号级数 > 3，违规 R-UI-2）>
`prose`（长说明串）> `first` 纯数量。**先修违规的，再修拥挤的。**

### 3.3 「开发的话不许上屏」

逐页扫一遍，把这类词从屏上清掉（进代码注释）：契约类型名（`XxxSchema`）· `strictObject` ·
WO 编号 · PRD 区号（`区2`/`区4`…）· 内部机制名（「三页归一」「自成长收编」「厂商中立施工」）。
**判据**：这句话**用户读了能做什么决定**？答不出 ⇒ 它不该在屏上。

若你判断该建一道门咬这个（例：屏上不许出现 `Schema` 结尾的标识符 / `区[0-9]`），**建**，
参考 `scripts/check-edge-active-mounts.mjs` 的做法（金丝雀与主判据共用同一份 `analyze`）。

## 4 · SEAM-GATE

接缝测试 `apps/frontend-shell/test/ui-layering.seam.test.tsx`：从**真实 workspace** 出发渲染
至少 3 页，断言：
1. 降到浮层的内容**默认不可见**（`not.toBeVisible()`），**触发后可见**（真 hover/click，不是查 DOM 存在）；
2. §2.3 那句**结论**（「下面 5 区是默认根因，不是这条阻滞点的根因」）**默认就可见**
   —— 这条防的是「一刀切全降层，把结论也埋了」；
3. 第一层**留有可见记号**（`?` 或等价），即「降了层但没静默消失」。

**变异反证**（逐条贴 RC，改完先 `git diff` 自证「变异体 ≠ 原文」）：
- 把那句结论也降进浮层 ⇒ **必须红**；还原 ⇒ 绿。
- 把 `?` 记号删掉（内容直接消失）⇒ **必须红**；还原 ⇒ 绿。
- ⚠️ 本仓真实踩过两次：`sed` 是 BRE、python `s.replace()` 静默 no-op —— 变异根本没生效，
  却被读成「变异后仍绿 ⇒ 判据是哑的」。

## 5 · 铁律

- **铁律 0**：改动涉及既有断点 `G-UI-FIRSTLAYER-OVERLOAD` ⇒ **必须回写本体** §8 该行的状态。
- **铁律 0.5**：grep 不是结论，再追一层。**「门没报」≠「没问题」**（本单 §2.1 就是标本）。
- **铁律 0.6**：任何基线统计**先把单条真实形状打印出来**再算（审核方在 §2.1 差点栽的那次）。
  报否定结论前跑金丝雀，报告附命中证据。
- **D4 守恒**：诚实位**允许降层，绝不允许删除**；第一层必须留可见记号。
- **对比度**：新增文字正文最小 12px；语义色作文字用走 `-txt` 变体（`--danger-txt`/`--warn-txt`/
  `--amber-txt`/`--txt`），**不许硬编码 hex**（双皮肤仓，`#b6c3d4` 浅色皮实测仅 1.79:1）。
  跑 `node scripts/check-text-legibility.mjs` 自查。
- **门必须显式捕获退出码**：`out=$(cmd 2>&1); rc=$?`。
- **每完成一个可命名单元立刻 commit + push**（`git push -u origin claude/handoff-wo-ui-layering`，
  失败 2/4/8/16s 退避 4 次）。容器会重启，推了的全活没推的全丢。
- 不要创建 PR。

## 6 · 资源纪律

本单是**前端单**。跑测试用 `pnpm --filter frontend-shell exec vitest run <单文件>`，**不要**跑全量。
**禁止**：`bash scripts/gate.sh` · `pnpm -r test` · `pnpm -r build` · datacore/agentcore vitest。
跑变异反证前先跑未变异基线，确认有**真实用例数**而不是 `Tests no tests`。

**已知存量红**（不是你引入的）：`pnpm --filter frontend-shell lint` RC=1；前端全量有数条存量失败。

## 7 · 交回报告必须含

1. 存量榜的**你自己重跑**的输出（不许照抄 §2.2），含全仓降层率与 `deferred=0` 文件数；
2. 逐页 burn-down 前后对照（`first`/`deferred`/`formula`/`prose`/`sizes` 五个数各自变化）；
3. §2.3 三分在 `DecisionPlayView` 上的**逐句**落点（哪句留一层、哪句进浮层、哪句进注释）；
4. 接缝测试完整输出 + RC（含基线用例数金丝雀）；
5. **变异反证逐条 RC** + 「变异体 ≠ 原文」的 diff 证据；
6. `check-ui-first-layer` 与 `check-text-legibility` 修前/修后 RC；
7. 「开发的话上屏」清理清单（清了哪些词、各在哪页）；若建了门，给金丝雀证据；
8. 本体回写章节号；
9. **你认为我这张单写错/漏说了什么**（不许空着）；
10. 分支名 + 最终 sha（`git ls-remote` 确认已推）。

不要创建 PR。
