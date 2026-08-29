# WO-FIELD-DEAD-6 · 两个求解器的「后端半做完、前端半没接」——两个病，别当一个修

<!-- wo-anchors: allow-missing: apps/frontend-shell/test/finance-provenance.seam.test.tsx -->

## 🚦 范围边界（本单身份）

**只碰**：
- `apps/frontend-shell/src/views/sim/SandboxImpactBand.tsx`（病①）
- `apps/frontend-shell/src/locales/zh.ts`（新增文案）
- `apps/frontend-shell/test/finance-provenance.seam.test.tsx`（新建）
- `scripts/solver-field-seam-baseline.json`（**仅**病② 那 3 条人手挂账，见 §3.2）
- `docs/SYSTEM-ONTOLOGY.md`

**不碰**（有别的 agent 正在里面）：
`SandboxConsole.tsx` / `SandboxPlaysPanel.tsx` / `ProcessCanvasView.tsx` / `ChainLineMapView.tsx`
（沙盘 v3/v4 · metro UX · 对比度三张单）· `views/sim/EdgeActivePanel.tsx` 与 `edgeActiveModel.ts`
（WO-ACTIVE-EDGE-UX 要新建的）· `OntologyGraphView.tsx` 与 `views/graph/**`（WO-BEFE-A）·
`apps/datacore/**` 与 `packages/contracts/**` 的**实现**（本单是前端单）。

## 0 · 环境前置（少一条就会得到与本单无关的假红）

```bash
CANON=origin/claude/inspiring-gates-aqczjg
git fetch origin
git checkout -B claude/handoff-wo-field-dead-6 origin/claude/verify-reclaim-6
git merge-base --is-ancestor HEAD $CANON && echo "落后 ⇒ 停手回报" || echo ok
pnpm install --prefer-offline
pnpm --filter @platform/contracts build
pnpm --filter @platform/llm-adapters build
```
基线是**集成分支** `origin/claude/verify-reclaim-6`，不是 canonical。
worktree 可能没有 `node_modules`；`@platform/contracts` 未 build 会报
`Failed to resolve entry for package "@platform/contracts"` 这种**与本单无关的假红**。

## 1 · 现场（我现算的，你仍要自己复核）

`node scripts/check-solver-field-seam.mjs` 报出 6 条新增死字段。
**它们是两个不同的病，修法不同，不许当一个修**：

### 病① `finance_world_projection` 3 条 = **「接了线，但没读这几个字段」**

| 字段 | 契约位置 | 前端命中 |
|---|---|---:|
| `worldStateSource` | `packages/contracts/src/finance-world.ts:145` | **0** |
| `worldObjectCount` | 同上 `:147` | **0** |
| `pressures` | 同上 `:157` | **0** |

（命中 = 全前端生产代码、已剔 `mocks/` 与测试。金丝雀：同法查 `impediments` 命中 5 文件 ⇒ 工具是好的。）

**它确实接了线**：`SandboxImpactBand.tsx:192` `const res = await runSolver("finance_world_projection", { worldId })`，
且用 `FinanceWorldProjectionOutputSchema.safeParse` 真校形（不是 `as` 硬转 —— 那一版栽过，白屏连坐 4 例）。
契约里这三个字段是**必填**（不带 `.optional()`）⇒ **后端算了、schema 逼着带上、前端全丢掉**。

**为什么这三个字段丢不得**（这决定了本单的验收判据）：它们是**诚实位那一层**。
`FinanceWorldPressureSchema`（`finance-world.ts:67-79`）每条带：
- `carriers` —— 世界态里**真带这个 stateVar** 的对象数（注释原文：不是"值非 0"，是"这个键存在"）
- `universe` —— 全域基数。注释原文：**「缺它 `carriers:0` 无法区分『台账空』与『查过了没中』」**
- `weighting` —— `VALUE`（按真金额加权，金额口径唯一正确的聚合法）/ `EQUAL`（拿不到金额权重时的**回落**）
- `weightingNote` —— 为什么回落，`EQUAL` 时必须写明是哪个字段拿不到

丢掉它们的后果，一句话：**屏上一个金额，看的人无从知道它是 500 个对象里 3 个撑起来的，
还是因为拿不到金额权重、退回等权硬算出来的。** 这正是本仓「诚实位」纪律要防的那件事。

⚠️ **这一条你要自己复核，别照信**：我判断该面板的现有文案（`locales/zh.ts` 里那段
"这是推演投影，不是实测值…产生这些压力的传导规则真 id 与真系数也一并回传"）
**承诺了比代码渲染得更多的东西**。你去把那段文案逐句读一遍，核对「文案承诺 vs 代码真渲染」，
**逐句给出对照**。若我判错了（文案并没承诺），照实说，本单不因此少做——
`pressures` 该上屏的理由不依赖文案承诺，而依赖上面那条「无法区分台账空与查过了没中」。

### 病② `process_flow_time` 3 条 = **「压根没接线」，而且门在少报**

```
grep -rn 'runSolver(\s*["'"'"']process_flow_time' apps/frontend-shell/src  → 0 命中
金丝雀（同一条命令）：finance_world_projection → 1 命中（SandboxImpactBand.tsx:192）⇒ 工具是好的
```
⇒ **前端从没调过这个求解器**。所以它不是「13 个字段里死了 3 个」，是**整个求解器没有前端消费方**。

门只报得出 3 条（`timelines` / `timelinesShown` / `absencesShown`），因为另外 10 个字段名是**通名**、
在前端撞了车 —— 我现算的逐字段命中：

| 字段 | 命中 | | 字段 | 命中 |
|---|---:|---|---|---:|
| `summary` | 45 | | `stations` | 7 |
| `origin` | 18 | | `bottleneck` | 6 |
| `coverage` | 12 | | `asOf` | 5 |
| `totals` | 7 | | `stuck` | 5 |
| `asOfSource` | 2 | | `absences` | 1 |
| **`timelines`** | **0** | | **`timelinesShown`** | **0** |
| **`absencesShown`** | **0** | | | |

这些命中**不是**「这个求解器的输出被消费了」的证据 —— 是同名撞车。
门自己的诚实位就写着这一条（「通名（rows/summary/total）撞车会**漏报**」）。
**照 3 条去修就是治症状。**

## 2 · 要做什么

### 2.1 病① —— 把诚实位接上（本单的主要工作量）

在 `SandboxImpactBand.tsx` 里真消费这三个字段。要求：

1. **`pressures[]` 逐条上屏**，每条必须同时给出 `value` **与** `carriers/universe` **与** `weighting`。
   只显示 `value` 不算完成 —— 那正是今天的病（一个数，没有它的成色）。
2. **`weighting === "EQUAL"` 必须显式标注为回落**，并把 `weightingNote` 原文带出来。
   **不许**把 EQUAL 和 VALUE 显示成一样 —— 两者可信度不同，混显就是抹掉差别。
3. **`carriers === 0` 时的措辞必须能区分两种情况**（照契约注释那句话）：
   `universe === 0` ⇒ 「台账里就没有这类对象」；`universe > 0 && carriers === 0` ⇒ 「查过了，没有一个带这个态」。
   两句话不一样，**不许合并成一句「无数据」**。
4. `worldStateSource` / `worldObjectCount` 一并上屏（世界态从哪来、几个对象有态）。
   `worldObjectCount === 0` 时契约要求 `available:false` —— 核对前端此时的行为是否与契约一致，
   不一致则**照契约改前端**（不要反向改契约，那一半不在本单范围）。
5. **对比度硬约束**（仓主已就此截图点名过一次）：新增文字**正文最小 12px**，
   弱化色不低于 `#b6c3d4` 这一档（≈6.6:1）。CJK 小字在 4.52:1 下不可读——
   「过了 WCAG 数值」不等于「看得清」。

### 2.2 病② —— 定性 + 人手挂账，**不在本单接线**

`process_flow_time` 要接线得先决定「它放进哪个页、哪个导航组」——**属导航信息架构，是仓主的决策，
本单不得擅自决定**（照 `scripts/backend-frontend-seam-baseline.json` 里 WO-R6 已立的先例）。

本单对它做两件事：
1. **把 3 条人手加进 `scripts/solver-field-seam-baseline.json` 的 `entries`，`why` 里必须写清楚**：
   这不是「3 个字段没人看」，是**整个求解器零前端消费方**，门因通名撞车只报得出 3 条；
   附上你自己复核的逐字段命中表与金丝雀证据。同步 `maxEntries`。
   ⚠️ 加完**必须**核对 `note` 字段没被脚本吞掉（该 bug 已于 `0e19f2c4` 修好，但你要亲手验一遍：
   `--update` 后 `note` 长度不变）。
2. **不要**为了消红去接一个假消费方（加个客户端函数没人调 = 把死字段换成死函数）。

## 3 · SEAM-GATE（头号复验判据）

交回必须含**驱动接缝**的组合测试 `apps/frontend-shell/test/finance-provenance.seam.test.tsx`：
从**真实求解器回包**出发（MSW 拦真实 URL，不 `vi.mock` 组件），断言：
- `pressures[]` 的 `carriers/universe/weighting` **真出现在屏上**（`getByText` 级，不是快照）；
- `weighting: "EQUAL"` 的那条**显示为回落**且带 `weightingNote` 原文；
- `carriers:0 · universe:0` 与 `carriers:0 · universe:500` **屏上措辞不同**（这条最容易被一句「无数据」糊掉）；
- 回包缺字段时**退回诚实缺口记号**，且**不把整棵 React 树卸掉**
  （`SandboxImpactBand.tsx:194-210` 的注释记着这条真事故：第一版 `as` 硬转导致沙盘白屏、连坐 4 例）。

**变异反证**（逐条贴 RC，改完先 `git diff` 自证「变异体 ≠ 原文」）：
- 把 `weighting` 的 EQUAL/VALUE 区分抹掉（两者显示成一样）⇒ **必须红**；还原 ⇒ 绿。
- 把 `carriers:0` 的两种措辞合并成一句 ⇒ **必须红**；还原 ⇒ 绿。
- ⚠️ 本仓真实踩过两次：`sed` 是 BRE、python `s.replace()` 静默 no-op —— 变异根本没生效，
  却被读成「变异后仍绿 ⇒ 判据是哑的」，然后去修一个没坏的判据。

**门前后对照**：`node scripts/check-solver-field-seam.mjs` 修前/修后 RC 与「新增 N 条」逐条贴出。
目标：病① 3 条从"新增"变成"已修复"（不是进基线），病② 3 条人手进基线。

## 4 · 铁律（逐条适用）

- **铁律 0.5**：grep 不是结论，再追一层。**通名命中 ≠ 被消费**（本单 §1 病② 就是这个形态的标本）。
  **只有 test 引用 = 已排练，不是已实现。**
- **铁律 0.6**：报「零命中/不存在」这类否定结论前先跑金丝雀，报告里附命中证据。
  金丝雀**必须与主判据共用同一份实现**。
- **门必须显式捕获退出码**：`out=$(cmd 2>&1); rc=$?`，禁止 `cmd | tail; echo $?`。
- **D4 守恒**：现有诚实位（缺席理由 / 未接线声明）一条都不许删；某条过期了就**改口径，不是加豁免**。
- **基线只减不增**：病② 那 3 条是**人手编辑**加的（可评审的显式动作），
  **不许**跑 `--update` 让脚本收编 —— 那是橡皮图章。
- **每完成一个可命名单元立刻 commit + push**
  （`git push -u origin claude/handoff-wo-field-dead-6`，失败按 2s/4s/8s/16s 退避重试 4 次）。
  容器会重启，**推了的全活，没推的全丢**。

## 5 · ⛔ 资源纪律

跑 vitest 前先 `bash scripts/dispatch-deficit.sh`；「其中 datacore=M」**M>0 就等**，
隔 120s 再探，最多 30 分钟。该计数**会瞬时抖动**（实测同一分钟 2→0），**连续两次**读到 0 才开跑。
本单是前端单，用 `pnpm --filter frontend-shell exec vitest run <单文件>`，**不要**跑全量。

**禁止**：`bash scripts/gate.sh` · `pnpm -r test` · `pnpm -r build` · datacore/agentcore 全量 vitest。
**允许**：`pnpm --filter <pkg> exec tsc --noEmit` · 单文件 vitest · `node scripts/check-*.mjs` 单门 · git。

**基线用例数金丝雀（必做）**：跑变异反证前先跑一次**未变异**基线，确认输出里有真实用例数
而不是 `Tests no tests`。拿不到用例数 ⇒ 报「工具坏了」，**不许**继续做变异反证。

**已知存量红**（不是你引入的，别去修）：`pnpm --filter frontend-shell lint` 在基线上 RC=1；
前端全量有 4 条存量失败。

## 6 · 交回报告必须含

1. 病① 三个字段的接线 diff + **文案承诺 vs 代码真渲染**的逐句对照（含「我判错了没有」的结论）；
2. `finance-provenance.seam` 完整输出 + RC（含基线用例数金丝雀）；
3. **变异反证逐条 RC** + 「变异体 ≠ 原文」的 diff 证据；
4. 病② 的逐字段命中复核表（你自己跑的，不许照抄我 §1 的数）+ 金丝雀证据；
5. `solver-field-seam` 修前/修后 RC 与逐条明细；**并亲手验 `note` 字段长度未变**；
6. 对比度实测（新增文字的字号与前景/背景对比度比值）；
7. **你认为我这张单写错/漏说了什么**（不许空着）；
8. 分支名 + 最终 sha（`git ls-remote` 确认已推）。

不要创建 PR。
