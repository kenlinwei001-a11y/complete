# HANDOFF · WO-SPLITACCOUNT-B2-BASELINE（判据⑤ 扫描面正修 + 基线重记）

> 单源：`scripts/check-harness-ux-splitaccount.mjs` 判据⑤「B-2 基线漂移（面板文件 3→5）」治理。
> 原始派单只允许 `--tighten` 认账；取证结论「一真一混」上报后，**team-lead 裁定走正修**：
> 可动判据⑤扫描面（仅此一处）+ 基线重记 + 门头注释同步 + 本 HANDOFF。
> 分支：`claude/handoff-wo-splitaccount-b2-baseline`（基线 `origin/claude/verify-reclaim-6` tip `776b7d33e`）。

## 1 · 修前 / 修后对照

| 态 | 判据⑤ 现算 | 门 RC | 证据 |
|---|---|---|---|
| 裸基线（pristine @ 776b7d33，一字未动） | 面板文件 **5** · 对位实现 0，基线记 3 ⇒ 红「3→5」 | **1** | 复跑实录：`✅ 金丝雀 8/8 … 🔴 ⑤ [B-2] B-2 现算读数变了：面板文件 3→5 · 有对位实现 0→0` |
| 收窄后、未 tighten | 面板文件 **4** · 对位实现 0，基线仍记 3 ⇒ 红「3→4」 | **1** | 同上形态，读数随判据变为 4 |
| 收窄后 + `--tighten` 重记 | 面板文件 **4** · 对位实现 0，基线改记 4 ⇒ 绿 | **0** | `🟢 harness-ux-splitaccount:check 通过（… B-2 账面理由现算属实 …）`；基线 diff 仅 `generatedBy` + `panels 3→4` 两处，`accounts` 四条零变化 |

归因（漂移 3→5 的两个新增文件，逐文件取证见 §5）：
- `DagNodeInspector.tsx` —— **真实增长**（U3 那半边的真面板，`views/sim/` 下，WO-U3-DAG-SPLIT 起落地），该数。
- `LayeredDag.tsx` —— **共享渲染件混入**（`components/Dag/` 下）：建门时它只出现在 U3「不符合」段，被「只取符合段」天然排除；U3 闭格后叙事把它带进了「符合」段（`docs/PRD-harness-ux-adoption.md` 闭格叙事里以 `@/components/Dag/LayeredDag.tsx:104` 的病灶坐标形态被引用，是叙述性引用不是面板）。PRD 自己的旧注（同文件「刻意不含『不符合』段的 `LayeredDag.tsx` —— 那是共享组件不是面板，收进来就成了代理指标」）自陈了意图，「只取符合段」只是该意图的代理；代理被击穿后按原义机械化。

## 2 · 判据形态（改了什么）

改动**只有一处判据代码** + 注释同步 + 金丝雀加向，全部在 `scripts/check-harness-ux-splitaccount.mjs`：

1. `computeChain`（判据本体，主流程/金丝雀/变异共用）：新增角色收窄
   `counted = path !== null && /[\\/]views[\\/]/.test(path)` —— 面板 = 解析路径落在 `src/views/` 下的页面级组件；共享渲染件（`components/` 下）与解析不到（改名/删除/移出 views/）一律不入数。
2. 门头注释判据⑤段、`parseSplitAccounts` 面板抽取段注释同步：写明「两道收窄叠加：①符合段限定 ②computeChain 按角色再剔」，并记录原代理被击穿的事实。
3. 金丝雀新增第 ⑨ 向「判据⑤扫描面角色收窄」：造假树 `views/FakePanel.tsx` + `components/FakeShared.tsx`，**与主流程共用同一个 `computeChain`**，断言 1 counted / 1 excluded。金丝雀打印 8/8 → **9/9**。
4. `scripts/harness-ux-splitaccount-baseline.json`：`chain.panels 3→4`（`--tighten` 机器写，非手改）。

没动的：判据①②③④⑥一字未动；`accounts` 四条零变化；`docs/PRD-harness-ux-adoption.md` 表体未碰；`scripts/lib/` 未碰；**`scripts/gate-ledger.json` 一个字节未动**（约束⑤：`build-gate-ledger.mjs --check/--update` 全程未跑）。

## 3 · 金丝雀证据

```
✅ 金丝雀 9/9（必中账 · 必不中账六处逐条对位 · 共享组件不许混进面板文件 · 受理方存在性 · 自指接线 · 判据⑤方向 · 剥注释双向 · 基线写入器 · 判据⑤扫描面角色收窄）
```

- `--selftest` RC=0。第 ⑨ 向与主流程共用 `computeChain`（同一 import，非另抄正则）——改主收窄规则时金丝雀拿同一份去测，规则若被改坏（如误剔 views/）金丝雀当场红。
- 否定结论附证：本单报「`components/` 下共享件不再入数」，金丝雀⑨ 的 `FakeShared.tsx`（造假在 components/ 下）被同一实现判 excluded，即该否定结论的金丝雀命中证据。

## 4 · 变异反证实录（两条，均亲手做）

| # | 变异 | 预期 | 实测 | 还原 |
|---|---|---|---|---|
| (a) | 把真面板 `apps/frontend-shell/src/views/sim/DagNodeInspector.tsx` 移出扫描面（mv 到 /tmp） | 现算读数变 ⇒ 红 | **RC=1**：`判据⑤ 现算：面板文件 3 · 有对位实现 0（1 个文件名找不到，未计入）` + `⑤ [B-2] B-2 现算读数变了：面板文件 4→3 · 有对位实现 0→0` | mv 回后 **RC=0** 绿 |
| (b) | 手改基线 `chain.panels` 4→5（模拟错账/假认账） | 现算 4 ≠ 基线 5 ⇒ 红 | **RC=1**：`判据⑤ 现算：面板文件 4 · 有对位实现 0` + `⑤ [B-2] B-2 现算读数变了：面板文件 5→4 · 有对位实现 0→0` | 还原基线后 **RC=0** 绿 |

两条各做一次、当场红当场还原转绿；红文均**指名**变了哪个读数。(a) 证「移出扫描面必咬」（收窄不是开口子），(b) 证「基线与现算不符必咬」（认账不买绿）。

## 5 · 收窄规则取证（5 文件路径表 + 规则选择理由）

用门的同一实现（`computeChain` + 同规则抽取的 `panelFiles`）现算，2026-08-18 实测：

| # | 文件名（§4.1 U3「符合」段抽取） | 解析路径 | 角色 | counted |
|---|---|---|---|---|
| 1 | `DagNodeInspector.tsx` | `apps/frontend-shell/src/views/sim/DagNodeInspector.tsx` | 页面级面板 | ✅ |
| 2 | `InspectorNodePanel.tsx` | `apps/frontend-shell/src/views/sim/InspectorNodePanel.tsx` | 页面级面板 | ✅ |
| 3 | `ProjectSimView.tsx` | `apps/frontend-shell/src/views/sim/ProjectSimView.tsx` | 页面级面板 | ✅ |
| 4 | `SandboxConsole.tsx` | `apps/frontend-shell/src/views/sim/SandboxConsole.tsx` | 页面级面板 | ✅ |
| 5 | `LayeredDag.tsx` | `apps/frontend-shell/src/components/Dag/LayeredDag.tsx` | **共享渲染件** | ❌（剔） |

各名在 U3 块内的出现次数（符合段 / 不符合段）：5 个名全部「符合段 1 次 · 不符合段 0 次」——即「只取符合段」这第一道收窄此刻**完全没有区分度**，混入发生在符合段内部，必须靠第二道角色收窄。

**规则选择理由**（为什么选「只数 `views/`」而不是别的）：
- 被实际路径证成：4 个真面板恰好全落在 `views/sim/`，唯一共享件恰好落在 `components/Dag/` —— 该规则**恰好保 4 剔 1，零误伤**（上表逐行可核）。
- 与仓内既有分层同构：`views/` = 页面级组件目录、`components/` = 共享件目录，是仓库自己的角色边界，不是本门新发明的分类。
- 与 PRD 自陈意图一致：「那是共享组件不是面板」—— 规则是该意图的机械化。
- 方向安全：规则只**减**不**增**扫描面；误剔真面板的风险由变异 (a) 兜住（移出 views/ 当场红）。

**不符合段防护未退化**（约束④）：第一道收窄（`conform = u3Block.split(/-\s*\*\*不符合/)[0]`）一字未动，「不符合」段的组件名仍不进抽取；LayeredDag 在符合段（叙事引用）被第二道剔、在不符合段本就不入数 —— 两段都不再入数，防护只增不减。

## 6 · 界外发现

1. **roster 门 ambient 红（与本单无关， pristine 可复现）**：`node scripts/check-gate-roster-handcopied.mjs` 在本单 pristine 基线（776b7d33e 一字未动）上即 RC=1，两条「未定性的写死集合」：`check-fact-usage.mjs:EXCLUDE_DIRS`（["mocks","locales","styles","assets"]）、`check-file-truncation.mjs:PROTECTED_PATTERNS`（["docs/SYSTEM-ONTOLOGY.md","docs/PRD-*.md","scripts/*-baseline.json"]）。本单改动前后红文逐字相同（约束⑥ 涟漪检查：对照组 pristine 同样 RC=1 同样两条）⇒ **非本单涟漪**，归该门所有人（疑似 fact-usage 门接 gates 串后进入扫描面所致，未深查）。本单收窄后的 `check-harness-ux-splitaccount.mjs` **没有**被该门点名（金丝雀造假字面量不进顶层常量集合）。
2. 判据⑤ 的 `withChain` 读数修前修后均为 0 —— B-2 账面理由（「本体链在本仓多数页无对位实现」）现算仍属实，本次只是分母去污，不改变 B-2 的账态。

## 7 · 前置门 RC 表

| 检查 | RC | 备注 |
|---|---|---|
| `node scripts/check-harness-ux-splitaccount.mjs`（交单态） | **0** | 绿文见 §1 第三行 |
| `node scripts/check-harness-ux-splitaccount.mjs --selftest` | **0** | 金丝雀 9/9 |
| `node scripts/check-gate-roster-handcopied.mjs`（约束⑥） | 1 | ambient 红，pristine 对照同样 RC=1 同样两条，无本单涟漪（见 §6.1） |
| `node scripts/check-branch-base.mjs claude/handoff-wo-splitaccount-b2-baseline` | 0 | 基线 = 集成线 verify-reclaim-6 |
| `node scripts/check-merge-conflict-markers.mjs` | 0 | |
| `git status --porcelain`（commit 前） | 空 | |
| 变异 (a) / (b) 及还原 | 1 / 1 / 0 / 0 | 实录见 §4 |

未跑：`build-gate-ledger.mjs` 任何模式（约束⑤）；vitest（本单零 TS/测试改动，纯门脚本+基线数据）。
