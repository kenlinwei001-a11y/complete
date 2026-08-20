# HANDOFF · WO-GATE-REACH-SWEEP（门射程对账 · 五族假绿断点）

分支 `claude/handoff-wo-gate-reach-sweep`（分叉自集成线 `claude/verify-reclaim-6` @ `9945e77c`，非 main）。
轻画像执行：只读源码 + 写门脚本/台账/基线/本体，未跑任何测试套件、未动 `apps/**` / `packages/**` 一行。

## ① 实测数

| 指标 | 分叉点（MB `9945e77c`） | 本单 HEAD |
|---|---|---|
| 门脚本总数 / `pnpm gates` 链 | 99 / 69 | **100 / 70**（新增 `check-gate-reach.mjs`） |
| 退出码纪律（顶层兜底 try→exit(2)） | 99/99 | **100/100** |
| 射程对账 | —（门不存在） | 100 门现算：双向零差 92 · 有差集 8 · 差集 12 条全定性（POINTER 11 · EXTRACTOR-SHAPE 1 · **REAL-GAP 0**）· 棘轮 12 ≤ 12 |
| 台账 guardedPaths 欠账 | 70 条未申报（25 门） | **0**（全部补登 + 反验 covered()）· 另删 2 条指向空气的幻影条目 |
| roster 门 | **RC=1**（2 条未定性候选，集成线预存红） | **RC=0**（候选 77 全定性：criteria 55 · computed 22 · roster 债 0 ≤ ratchetHigh 0） |
| 新文件判据普查 | 未做 | 36 个基线写者全普查：11 个 file/path 键控中 **10 个新文件安全 + 1 个半形态**（layout-legibility，每跑打印 diff + 债登记 ratchetHigh 0） |
| befe-seam | RC=1（2 个零调用端点） | RC=1 **逐字一致**（范围外预存红，见⑥） |
| ontology-writeback / s8-dedupe | RC=1 / RC=1 | RC=1 / RC=1（预存红，T2 证实非本单引入） |

金丝雀：`reachCanary` 三十七向全通过（向数现算自 `Object.keys(checks).length`，不手抄）；arg-drop-seam 断言⓪金丝雀用真源码变异（注入 `ceo_canary_fake` 必被咬）。

## ② 改法与论据

1. **新门 `scripts/check-gate-reach.mjs` + 纯函数库 `scripts/lib/reach-surface.mjs`**：对每道门现算「声称（台账 guardedPaths）vs 实际（源码 AST 扫描面）」双向差集。抽取走 TypeScript 编译器 API（`createRequire` 自 exit-discipline 同款路径取 `typescript`），不走正则；本地 import 追两层（深度感知 + 环安全缓存）。判据：未定性差集红 · 死账红 · 定性非法红 · 棘轮只降不升 · **没有 REAL-GAP 定性**（真缺口只能修门，落账买绿 = 把假绿制度化）。
2. **台账补登 70 条**：undeclared 的正确处置是修账不是压账 —— 补登后 `covered()` 反向成立，买不了绿。论据：M3 变异反证（见③）首跑假绿，暴露「undeclared 只认 dir/glob 不认 file」的门自身盲区，当场放宽 reconcile 过滤（`e.kind !== "file" || e.origin !== "self-read"`）并补金丝雀⑯，重跑即红 —— **变异反证先把门自己修了一遍**。
3. **两类金丝雀样例抽取污染按形状规则排除**（非白名单）：expect/assert/canary 调用栈内的样例路径（CANARY_WRAP_RE 调用栈排除 + 金丝雀⑯）、`*CANAR*` 顶层常量样例（CANARY_CONST_RE + 金丝雀⑰）。各配一条永久金丝雀防回潮。
4. **arg-drop-seam 断言⓪**：`ROUTER_EMITS` 键集不再手抄 —— `ceoIntentKeysFrom()` 从 `ceo-route.ts` 的 `CEO_INTENT_KEYS` 现算，`rosterDrift()` 双向求差；主判据与金丝雀共用同一实现（金丝雀 = 真源码 replace 注入假键）。实体清单（值）仍人工派生（ArgsFrom 条件赋值静态证不了），由断言①动态半兜底 —— 机器各管一半，谁也不假装全管。
5. **roster 定性 +3 条 criteria**（fact-usage:EXCLUDE_DIRS · file-truncation:PROTECTED_PATTERNS · gate-reach:VERDICTS）：三条都答了「凭什么不随仓库演进而变」（它们是门的判据本体，现算化 = 拿被测物定义判据的自证循环）。顺手把集成线预存的 roster 门红（MB 上 RC=1）修绿。
6. **基线 `scripts/gate-reach-baseline.json` 12 条定性**：11 条 POINTER 全部引门头/注释**原文**（如 capacity.ts 诚实边界「…本门**不覆盖**——那是 §5 建议的后续单」）；1 条 EXTRACTOR-SHAPE（migration-numbering 的 glob 同义）。全文与逐条证据在 `docs/AUDIT-gate-reach-sweep.md`。
7. **本体回写**：§7 新增 `gate-reach:check` 条目（机制/分工/金丝雀/变异反证/诚实边界）；§8 四条 ✅ 闭合注记（G-GATE-RC1-MASQUERADE · G-GATE-SCOPE-MISSES-SUBJECT · G-RATCHET-NEWFILE-BLIND · G-GATE-ROSTER-HANDCOPIED），每条带实测数。
8. **package.json**：先登台账后进链（顺序合规）：`gate-reach:check` 别名 + gates 串插在 roster 门后。改前 `grep -c '"gates"'` = 1，改后 `node -e` JSON 解析验证通过。

## ③ T1–T5 原文

**T1 变异反证红在正确的位置**（全原文录于 `docs/AUDIT-gate-reach-sweep.md` §M，此处录判向）：

```
M1 抽掉基线一条定性        ⇒ RC=1 判据①点名「未定性差集」（方向：差集须定性）
M2 台账塞一条它不读的 path ⇒ RC=1 判据①点名 GAP（方向：声称⊄实际 = 射程缺口候选）
M3 源码加一个扫描常量      ⇒ RC=1 判据①点名 UNDECLARED（方向：实际⊄声称 = 台账欠账候选）
三笔各自复绿（git checkout 还原后 RC=0）。M3 首跑假绿 = 门自身盲区，修门+补金丝雀后重跑即红。
```

**T2 merge-base 逐字对比**（worktree `/tmp/base-probe2` @ `9945e77c`，`git rev-parse HEAD` 核验 +
`git status` 干净后开跑；pnpm install + 四包 build 完成后跑同一批门）：

```
check-ontology-writeback      base RC=1 · head RC=1   diff 仅「69→70 个 check 门」（我的新门进链，§7 漏登 1 = check-name-consistency 两侧不变）
check-ontology-s8-dedupe      base RC=1 · head RC=1   diff 仅行号 +1（§7 新条目把 §8 整体下移一行）；11 个重复编号与各自行数两侧完全一致
check-backend-frontend-seam   base RC=1 · head RC=1   【逐字一致】（2 个零调用端点，预存红铁证）
check-gate-ledger             base RC=0 · head RC=0   diff 仅普查 99→100 / 台账 99→100；NEVER 35=基线 35 两侧不变
check-arg-drop-seam           base RC=0 · head RC=0   diff 仅 dist 新鲜度时间戳（环境量）
check-gate-exit-discipline    base RC=0 · head RC=0   99/99 → 100/100（新门自带兜底，零豁免）
check-ontology-s8-status      base RC=0 · head RC=0   diff 仅区间提交 0→1（占位提交）；状态回退 0 两侧不变
check-gate-roster-handcopied  base RC=1 · head RC=0   base 报 2 条未定性候选（EXCLUDE_DIRS / PROTECTED_PATTERNS）= 集成线预存红；head 全定性转绿（本单交付④）
```

结论：三道红全部预存（befe-seam 逐字一致为铁证）；我未触碰的门无一绿转红；roster 门红转绿是本单修掉的集成线预存红，方向为改善。

**T3 金丝雀双侧**：reachCanary 三十七向（必咬 ≥1 + 必不咬 ≥1 每类抽取位），全部跑 `lib/reach-surface.mjs` 导出的 `extractSurface/covered/reconcile` 本体，不另抄正则；样例全部取自生产实物形状（file-truncation 的 PROTECTED const、dsh-dormancy 的 CANARIES 数组等）。arg-drop-seam 断言⓪金丝雀 = 真源码变异，与主判据共用 `ceoIntentKeysFrom/rosterDrift`。

**T4 基线方向 diff**（`git diff 9945e77c -- <基线>` 逐 hunk 过）：

- `gate-roster-baseline.json`（+14/−2）：−1 条 why 改写（ROUTER_EMITS —— 键集已现算化，分类理由随之改写，定性结论不变）；+3 条 criteria 各带「凭什么不随仓库演进」的理由；candidateCount 74→77 是现算普查计数（信息字段），roster 债棘轮 ratchetHigh 0 未动。
- `gate-ledger.json`（+184/−77）：删除行全部是 ① guardedPaths 数组重排（每行一条→多条）② 空 `"notes": ""` 被补登说明替换 ③ 2 条幻影条目（`docs/SYSTEM-ONTOLOGY.md.bak`、`apps/datacore/src/environment.ts`，文件不存在，金丝雀样例抽取污染）。棘轮数字字段零变动：diff 中唯一新增数字字段是新门的 `provenRed`（kind=MUTATION）；NEVER 35 = 基线 35。
- `gate-reach-baseline.json`：新建（12 条定性账 · ratchetHigh 12 = 出生即水位，非上调）。
- **零处棘轮上调；零处白名单。**

**T5 三清**：

```
git status --porcelain        ⇒ 提交后为空（见 git log）
check-branch-base             ⇒ RC=0「分叉点落后集成线 0 个提交，未超阈值 200」
check-merge-conflict-markers  ⇒ RC=0「2279 个被跟踪文本文件，零合并冲突标记 · 金丝雀 7/7」
```

## ④ 基线变化汇总

| 文件 | 变化 | 方向 |
|---|---|---|
| `scripts/gate-reach-baseline.json` | 新建 12 条（POINTER 11 · EXTRACTOR-SHAPE 1），ratchetHigh 12 | 新门出生账，无上调可言 |
| `scripts/gate-roster-baseline.json` | +3 criteria · 1 why 改写 · candidateCount 74→77 | roster 债 0 不变（ratchetHigh 0 未动） |
| `scripts/gate-ledger.json` | +70 guardedPaths 补登 · −2 幻影 · +1 新门条目 | NEVER 35 不变 · 无棘轮上调 |

## ⑤ 文件重叠（git log --oneline -5）

- `scripts/`：9945e77c（MB 本人）· 09e9e2c7 U2-STEPWISE-2 · 716a81ad/66d4948c/4d64523f U4B-U1-U8 —— 全部 ≤ MB，是我分叉点的祖先，无并行重叠。
- `docs/SYSTEM-ONTOLOGY.md`：914d0289 entitlement 闸 · 0f7e7be8/8a54df0f 状态归一 · e6a19e3f/f532e09f 收编 —— 同上，全部 ≤ MB。
- `package.json`：7c52b9b4 FACT-USAGE · 98020d3a/143032ef/2c392b23/c073fa23 ONTO 系收编 —— 同上。
- 结论：三个写入面自分叉点起零他人提交，无重叠风险。

## ⑥ 没做的部分 + 差什么才能做

1. **befe-seam 2 个零调用端点**（`POST /a/v1/sim/change-impact-preview` app.ts:2283 · `POST /b/v1/governance/adjudicate` server.ts:2161）：本单范围禁止动 `apps/**`，只能登记不能修。差：一张接线/豁免 WO（判定是「接前端调用」还是「登记豁免」需产品裁决）。
2. **check-name-consistency 未登记 §7**（ontology-writeback 预存红）：该门的 §7 条目属登记 WO 的范围，本单只动了 §7 新增自己那一行。差：登记方补 §7 条目（一行）。
3. **§8 十一个重复编号**（s8-dedupe 预存红，WO-ONTO-DEDUPE 队列）：含 G-GATE-ROSTER-HANDCOPIED 行 2332/2340 两条 —— 我的闭合注记加在 2332 行，2339/2340 重复行原样未动（dedupe 是另一张单的合并裁决，我不替它选留哪行）。差：WO-ONTO-DEDUPE 逐组合并。
4. **layout-legibility 新文件半形态**：diff 每跑打印 + 债登记 ratchetHigh 0 已就位（不算未做，但「全形态」要改它的基线写者结构，属该门自己的 WO）。
