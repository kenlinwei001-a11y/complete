# WO-GATE-B-BROWSER-HARNESS 交单报告 —— 行为面门 harness-ux-behavior:check（B-1 对账 + B-4·U8 遮挡对账）

分支：`claude/handoff-wo-gate-b-browser-harness`（本地分支 `wo-gate-b-browser-harness`，基于集成线 `origin/claude/verify-reclaim-6` 分叉点 `c4e2df8d`）
复验入口：`node scripts/check-harness-ux-behavior.mjs --selftest`（金丝雀八向 RC=0）· 全量真跑 `node scripts/check-harness-ux-behavior.mjs`（12 页 RC=0）

> **接手收尾声明（如实）**：本单初版（`dae516ff` probe 两能力 + `b60fa599` 门初版）与第二轮迭代
> （6 文件 +2401/-1888：回显三态归因 · 多候选逐个试+试间还原 · 每候选各自稳定化 · SVG path 签名 ·
> §4.2.3 遮挡欠账对账 · 同名触发器 #N 消歧 · vite `--host 127.0.0.1` 修复 · 金丝雀扩到八向）
> 均为前任 dev 所留。接手后逐文件核过：6 个未提交文件全是**完成的改进**（非半成品），本报告署名接手 dev 做的事只有四件：
> ① 亲手重做变异反证（见 ④）；② 真浏览器全量亲跑（见 ③）；③ 补 `check-harness-ux-behavior.mjs:LOGIN`
> 的 roster 定性条目（criteria，`scripts/gate-roster-baseline.json`）；④ 构建三包 dist 使 gate-ledger 可核。

---

## ① 修前后对照

| 能力 | 修前（WO 派单时） | 修后（本单） |
|---|---|---|
| B-1（U1 时延面） | probe 只量单时刻几何，「改输入不点按钮结果 DOM 变没变」无机检 | `probeInputReaction`：两时刻 DOM 快照比对（签名 = 可见文本 + SVG `<path>` d 哈希 + 计数），多候选逐个试、试间还原、每候选各自稳定化；`classifyReaction` 三态归因（changed / echo / unchanged —— **输入回显 ≠ 结果重演**） |
| B-4·U8（遮挡面） | probe 只量元素自身矩形，没有「A 盖住 B 哪一部分」 | `measureOcclusionInPage`：`elementsFromPoint` 真实绘制序 3×3 采样判浮层被压 + 矩形相交量覆盖百分比；判法 = 对 PRD §4.2.3 登记表**对账**（未登记遮挡判红 / 登记脱节判红 / 登记键 = 页+触发器 aria 全等 + 同名 `#N` 序号） |
| 验收文档 | §4.2 写「门 B 未建，四条无验收方式」 | §4.2 订正 + 新增 §4.2.2（门已建事实）与 §4.2.3（9 笔遮挡欠账登记，首跑实测）；**§4 表体一格未动**（check-sim-ux-criteria RC=0） |
| 门接线 | — | `harness-ux-behavior:check` 进 `pnpm gates` 链尾；`playwright-core@1.61.0` 收进根 devDependencies（pnpm-lock 同步），集成方容器走 `PLAYWRIGHT_CHROMIUM`/`/opt/pw-browsers` 预置 Chromium，与 `layout-legibility:check` 同款接法 |
| 门账 | — | `scripts/gate-ledger.json` 登记本门（guardedPaths / provenRed / notes 全填），gate-ledger:check RC=0 |

**范围边界**：`apps/**` 一行未动（首跑量出的 9 笔真遮挡是前端 InfoPopover 堆叠单，见 ⑤）。

## ② 判据形态（对照 WO 判据逐条）

- **B-1 = 同一页面两个时刻 DOM 快照比对** ✅：改一个输入、**不点任何按钮**（checkbox 的 toggle 手势 = 改输入自身的值，原生 setter + 冒泡事件，无按钮点击），断言结果 DOM 在 5000ms 内变了。判法不是「一律要求符合」，是与 §4 表 U1 列**逐格对账**：表说符合而试过输入全不变 ⇒ 红；表说不符合而仍有输入改了不变（陈旧窗口仍在）⇒ 绿（诚实欠账不染红）；表说不符合而全变 ⇒ 红（修好没回写）。
- **B-4·U8 = 「A 盖住了 B 的哪一部分」z-order × 矩形相交** ✅：`elementsFromPoint` 真实绘制序 3×3 采样判「浮层被谁压住」+ 覆盖百分比量「浮层盖住了哪些文本元素、各百分之几」，两边都照实打印。判法 = 对 §4.2.3 登记表对账（语义同上）。
- **金丝雀与主逻辑同一实现** ✅：`runCanary` 全部调 lib 里的 `probeInputReaction` / `measureOcclusionInPage` 与门内的 `judgeReaction` / `judgeOcclusion` / `parseU8DebtRegistry`，零另抄。
- **独立口径防假绿** ✅：12 页一页都判不了 / 一个触发器都找不到 / 一个浮层都开不出 ⇒ RC=2（探针坏了，不许报页面干净）。
- **诚实边界**：B-3（跨屏同一事实，缺事实注册表前置）与 B-4·U7（编排答得对不对，缺评测集）**本门不判**，PRD §4.2 表内照实挂着；本体 §8 `G-SPLITACCOUNT-PROMISE-ONLY` **未标 ✅**；`<canvas>` 位图结果签名够不着（lib 注释已自陈）；mock 模式判的是前端接线与重算链，真后端时延不在射程。

## ③ 金丝雀证据 + 真浏览器全量亲跑（接手 dev 本机，2026-08-18）

`--selftest`（金丝雀八向，RC=0）：

> ✓ 必咬①改输入即变探到 changed（354ms）· 必咬②提交闸探到 unchanged 且对「符合」格判红、对「不符合」格放行 · 必咬②b 纯回显归因为 echo 并按「没重演」判 · 判据单元四向（混合/全变×符合/不符合）· 必咬③被压浮层报出 4/9 被压采样点并判红 · 必不咬置顶浮层 0 误报且盖住 1 个文本元素 · 对账⑤三向 · 解析⑥§4.2.3 登记表

**全量真跑（VITE_MOCK=1 dev server + 本机 Chrome，12 页，RC=0）**：

> ══ 合计：B-1 判了 11 页 · 未判（无可编辑输入）1 页（cleanroom-attr，如实报未判）· U8 触发器 67 个 · 开出浮层 52 个 · §4.2.3 欠账 9/9 笔照单属实 ══
> ✓ harness-ux-behavior 通过（B-1 对账 11 页逐格一致 · U8 浮层 52 个无未登记遮挡 · 时窗 5000ms）

- optimize-whatif（表=不符合）：试 4 输入 `100→101 ⇒ echo(208ms)` + 3×unchanged ⇒ 陈旧窗口仍在，欠账属实放行（echo 归因没把它误判成「修好没回写」）。
- sop-balance（表=不符合）：「计划月份」改了不变 + 传导边 checkbox 325ms 即变 ⇒ 主流程闸仍在、另有实时区，欠账属实放行（混合证据没逼改表）。
- sim-sandbox（表=符合）：「指标」select 改了不变（展示型）+ 传导边 checkbox 229ms 即变 ⇒ 一致 ✓。

## ④ 变异反证（接手 dev 亲手重做，fixtures 自造非门内 CANARY 原样照跑，脚本 /tmp/gate-b-mutation.mjs）

| 变异 | 期望 | 实测 |
|---|---|---|
| ① 改输入即变页（oninput 重算合计，无按钮） | 必报 changed | `status=changed latency=108ms`（两个输入各报 108/139ms）✓ |
| ①b 同页带提交闸（不点按钮结果不变） | 必报 unchanged | `status=unchanged` ✓（区分能力在，不是见动就报变） |
| ② 构造遮挡（文档序靠后 `div.cover` z-2 压住浮层 z-1） | 必报出谁盖谁 | 被压 6/9 点，逐点报「51,78 被 `<div.cover>`「下游面板（堆叠在上）」压…」✓ |
| ②b 浮层置顶（z-5 对 z-2） | 0 误报 | 被压 0/9 · 盖住别人 1 个文本元素 ✓ |

四向全中，RC=0。

## ⑤ 界外发现（均非本单引入，照实记账）

1. **9 笔真遮挡欠账（本门首跑量出，已登记 PRD §4.2.3）**：`InfoPopover` 浮层 `z-index:40; position:absolute` 挂在触发器所在 `.panel` 内，被文档序靠后的同级 `.panel`（及其表单控件）裁断/压住。同一根因族，修法 = 前端组件级（浮层挂顶层/提堆叠上下文），一处修多半全部愈 ⇒ 派**前端 InfoPopover 堆叠单**（本单边界外）。
2. **cleanroom-attr 页内无可编辑输入** ⇒ B-1 未判（门如实报「未判」，不计红不计绿；若该页本该有输入，是页面的事不是门的事）。
3. **roster 门（gate-roster-handcopied）在集成线 tip 上即红**（RC=1，2 条：`check-fact-usage.mjs:EXCLUDE_DIRS`、`check-file-truncation.mjs:PROTECTED_PATTERNS` 未定性，均为后于我分叉点并入的新门所留）。本单新增的 `LOGIN` 常量**已定性收口**（criteria + why，candidateCount 71→72），不给集成线添新债。
4. **splitaccount 门 RC=1（B-2 判据⑤ 基线漂移：面板文件 3→5）**：集成线 tip 上同样红（同一读数），分叉点漂移，非本单改动（本单未碰 §4.1 与任何面板文件）。处置 = 该门 `--tighten` 重记基线 + 复核 B-2 账面理由，属 splitaccount 门的账。
5. **claim-strength 门 RC=1（3 条：OptimizeWhatifView.tsx:566/:698 「最优」无登记 + zh.ts 一条死账）**：本单未碰 `apps/**` 与 locales，分叉点后漂移，界外。

## ⑥ 前置门 RC（接手 dev 本机亲跑）

| 门 | RC | 备注 |
|---|---|---|
| `check-harness-ux-behavior.mjs --selftest` | 0 | 金丝雀八向（见 ③） |
| `check-harness-ux-behavior.mjs`（真浏览器 12 页全量） | 0 | **亲跑过**（见 ③；本机高负载下未遇 Chrome 握手 180s 超时，全程一轮通过） |
| 变异反证四向（/tmp/gate-b-mutation.mjs） | 0 | 见 ④ |
| `check-branch-base.mjs wo-gate-b-browser-harness --onto=<集成线tip 10a026a4>` | 0 | 分叉点落后 104 提交 < 阈值 200 |
| `check-merge-conflict-markers.mjs` | 0 | |
| `check-gate-ledger.mjs` | 0 | 首次 RC=2 是环境性（agentcore/datacore dist 未构建，门自陈「我没查」）；`pnpm --filter @platform/llm-adapters --filter datacore --filter agentcore build` 后重跑 RC=0 |
| `check-sim-ux-criteria.mjs` | 0 | §4 表体未动的机器证据 |
| `check-gate-roster-handcopied.mjs` | 1 | 余 12 条全为分叉点继承（tip 上 2 条亦红，见 ⑤.3）；本单新增项已收口 |
| `check-harness-ux-splitaccount.mjs` / `check-claim-strength.mjs` | 1 | 界外（见 ⑤.4/⑤.5） |
