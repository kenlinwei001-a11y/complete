# HANDOFF-WO-FACT-USAGE-REGISTRY — 交单报告（收尾单 · 画像 轻）

分支：`claude/handoff-wo-fact-usage-registry`（自 `origin/claude/verify-reclaim-6` 开出，
含上一轮中途态 `ba7b16d78` rebase 后的 `23631a34a`，本轮回合 1 个提交）。

---

## ① 实测数（2026-08-18 现算，集成线 tip 上；与工单给的数不一致，以本数为准）

工单转述的是建门轮（08-17）的数：454 / 64 / 546 / 6。**集成线前进后实测已变**：

```
页 80 · 事实 462 条（solver 151 · object 49 · rest 262）
跨 ≥2 屏的事实 72 条 ⇒ B-3 该比的跨屏对 824 组（同口径应相等 818 · 口径分家 6）
金丝雀 18/18 · 独立词面口径 solver 39→AST 47 · object 18→AST 62（逐族均不少于词面）
```

- 事实 454→**462** · 跨屏事实 64→**72** · 跨屏对 546→**824**（增长全部来自集成线新并的页面与读取位）；
- 口径分家对数仍为 **6**（4 条事实：`affected_orders#rows` 三屏组合出 3 对 +
  `affected_orders#rows[].risks[].base` · `bottleneck_matrix#factors[]` · `bottleneck_matrix#rows[].base` 各 1 对），
  明细逐组落账 `docs/AUDIT-fact-usage-registry.md` §4；
- 抽不出来的读取位 **16 条**如实留白（审计文档 §7），不冒充「覆盖全了」。

## ② 改法与论据

工单差的三件收口，全部落地，另修一道被机器当场咬出的自伤：

1. **登账（先做）**：`scripts/gate-ledger.json` 新增 `check-fact-usage.mjs` 条目
   （`binding=GATES_CHAIN` · guardedPaths 7 条全部真实可解析 · provenRed=MUTATION 带证据链）。
2. **接进 `pnpm gates`**：`package.json` gates 串尾追加 `node scripts/check-fact-usage.mjs`，
   并补别名 `fact-usage:check`（改前 `grep -c '"gates"' = 1`，改后 `node -e require` 解析通过再提交）。
   `scripts/gate.sh` 一个字没改（它自陈从 package.json 现算门数）。
3. **审计文档**：`docs/AUDIT-fact-usage-registry.md` —— 全量数据 `--census` 一条命令现算落账：
   粒度裁决 · 80 页名册 · 72 条跨屏事实全量表 · 6 组口径分家明细 · 16 条静态留白 · 守门机制 ·
   本体引用与影响 · 可派的下一步。
4. **本体回写（铁律 0）**：§7 补登 `fact-usage:check` 门条目 · §8 新增 `G-FACT-USAGE-UNREGISTERED`（✅ 已闭）。
5. **顺手修的自伤（被 `baseline-writer-honesty:check` 当场判 HAND_ROLLED）**：
   `check-fact-usage.mjs` 的 `writeBaseline` 原绕开共享写入器手搓 JSON —— 已改走
   `scripts/lib/baseline-doc.mjs` 的 `buildBaselineDoc()`（调用内联在写入点实参里，判据②认这形态），
   并加 `baselineDocCanary()` 开跑自检（不过 ⇒ RC=2）。该门对我的文件从红名单移除
   （走共享写入器 17→18；该门剩余 1 条红是既存的 `check-unit-value-provenance.mjs`，范围外未碰）。
6. **基线 `--tighten` 正当收紧**：454/64/546 → **462/72/824**（divergent 6 不变）。
   收紧前门已 RC=0，方向是「只许涨不许跌」的涨，把集成线真实增长固化为下限。

## ③ T1–T5 实测输出原文

**T1 变异反证（四发，全部红/守在正确的地方）**：

- **M1 · 拆登账**（脚本在、台账无条目）：
  ```
  ✗ gate-ledger:check 未通过（1 条）：
    - ① 无遗漏：门脚本 scripts/check-fact-usage.mjs 未登账（新加门必须同批登账，否则它天然免疫本门治理）
  RC=1
  ```
- **M2 · 账写 GATES_CHAIN 但未接链**：
  ```
  - ③ 绑定属实：check-fact-usage.mjs 账里写 binding="GATES_CHAIN"，现算是 "NONE"（调用方：无）——账与现实脱节
  RC=1
  ```
  补齐接链后：`✓ gate-ledger:check 通过（账无遗漏/无幽灵 · binding 与现算一致 · 责任边界均可解析）。RC=0`，
  普查计数 GATES_CHAIN 65→66。
- **M3 · 基线上调模拟棘轮回退**（`min.facts` 改 9999）：
  ```
  ❌ fact-usage:check 判负：
     · D2/D4 规模棘轮回退：`facts` 9999 → 462（少了 9537）—— 有读取位从受检面掉出去了。
  RC=1；还原后 RC=0。
  ```
- **M4 · 共享写入器改造的活体验证**：往基线埋人手探针键 `__handProbe` + 改 `_doc[0]`，
  跑 `--tighten` ⇒ 探针键与人手 doc **逐字节留存**、`min`/`lastSeen` 确实被更新（判据①②④ 活体全过）。

**T2 没碰的东西有没有被弄红**（merge-base `c4e2df8d` 探针树 vs HEAD，同批命令逐字对比）：

| 门 | base | HEAD | 对比 |
|---|---|---|---|
| check-gate-ledger | RC=0 | RC=0 | ✓ |
| check-system-ontology / meta-sync / no-raw-nul / ontogenesis / outsource-redline / prd-ontology / merge-conflict-markers / gate-exit-discipline | RC=0 | RC=0 | ✓ |
| check-ontology-anchors | RC=1 | RC=1 | 剔除本体行号位移后**逐字相同**（既存 LINE_DRIFT，沙盘线文件漂移，范围外） |
| check-wo-anchors | RC=1 | RC=1 | **逐字相同**（既存 5/13） |
| check-ontology-writeback | RC=1 | RC=1 | 唯一差异「gates 含 65→66 个 check 门」；漏登仍 1 条 = 既存 `check-name-consistency`（我的门已登记，范围外不补） |
| check-baseline-writer-honesty | RC=1 | RC=1 | 同一条既存红（`check-unit-value-provenance.mjs`）；我的门从红名单**移除**（17→18 走共享写入器） |
| check-redline-wired | RC=1 | RC=1 | 剔除行号后**逐字相同**（既存 W2 14>13） |
| check-harness-ux-splitaccount | RC=1 | RC=1 | **逐字相同**（判据⑤ B-2 面板文件 3→5 棘轮待记账，归 harness 线，范围外） |

**T3 金丝雀正反两侧**：门 18 条金丝雀每次运行全中（与主逻辑共用 `factUsageCanary()` 同一份实现，
样例形状取自生产实物）；反向侧由 M3（棘轮必咬）+ 建门轮 A/B（类型导入/动态 import 重新入图 ⇒ RC=2）覆盖；
基线写入器金丝雀 4 向共用 `buildBaselineDoc` 本体，M4 活体验证。

**T4 基线有没有被抬**：`scripts/fact-usage-baseline.json` **升了**（454/64/546 → 462/72/824，
divergent 6 不变）—— `--tighten` 方向的正当记账：① 收紧前门已 RC=0，不是消红；
② 增量全部来自集成线新并页面（merge-base 上同门跑出同样的 462/72/824，证明是树的增长不是门的放水）；
③ 方向是「下限抬高」= 更严，符合「基线只许降不升」的棘轮本义。
`scripts/gate-ledger-baseline.json` 未动（provenRed NEVER 35 = 基线 35）。

**T5 交单前三条**：`git status --porcelain` 空 · `check-branch-base.mjs HEAD` RC=0 ·
`check-merge-conflict-markers.mjs` RC=0（最终复跑见下）。

## ④ 基线变化

升了，逐条说明：facts 454→462 · multiScreenFacts 64→72 · pairs 546→824 —— 三条同为
「集成线 08-17→08-18 新并的页面/读取位带来的真实增长」，经 `--tighten` 固化（该命令结构上也
只许涨不许跌， shrink 会被拒）。caliberDivergent 6 未动。其余基线文件零改动。

## ⑤ 与其他 dev 的文件重叠情况

`git log --oneline -5 -- package.json scripts/gate-ledger.json docs/SYSTEM-ONTOLOGY.md scripts/check-fact-usage.mjs scripts/lib/fact-usage.mjs scripts/fact-usage-baseline.json docs/AUDIT-fact-usage-registry.md`：
除本单两个提交外，均为集成线既有提交；本轮回合期间 `origin/claude/verify-reclaim-6` 未前进
（交单前 check-branch-base 仍 RC=0、分叉点落后 0）。范围边界严格遵守：`apps/**` 零改动，
沙盘线文件零改动。

## ⑥ 没做的部分 + 差什么才能做

- **B-3 本身没做**（本单只交付它的输入清单）：两屏值相不相等要真渲染读 DOM。
  **现在可派** `WO-GATE-B-BROWSER-HARNESS` 的 B-3 部分：输入 = 审计文档 §5 的 72 条 × 屏集合
  或 `node scripts/check-fact-usage.mjs --json` 的 `pairs`（824 组逐组带 file:line 依据链）；
  其中 §4 的 6 组口径分家对**不该断言相等**，该断言「屏上各自标明口径」（horizon/baseIds 字样可见）。
- **16 条静态留白**（审计文档 §7）：数据源键经变量/常量表间接下发，静态分析定不了名 ——
  由真浏览器 harness 运行期补认，不是静态门的债。
- **范围外既存红（逐字确认既存，未碰）**：`check-ontology-anchors`（沙盘线锚点漂移）·
  `check-wo-anchors`（5/13）· `check-name-consistency` 的 §7 漏登 ·
  `check-unit-value-provenance.mjs` 的手搓基线 · `check-redline-wired` W2 14>13 ·
  `check-harness-ux-splitaccount` 判据⑤（面板文件 3→5 待 `--tighten` 记账，归 harness 线）。
