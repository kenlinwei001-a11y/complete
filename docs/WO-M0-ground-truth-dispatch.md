# 派单书 · M0 实料地基（F0 F1 F2 F3 · A11）

> **给 dev 的完整提示词。** 规格见 `docs/PRD-ai-sim-rev2-ground-truth.md`（必读，本书不复制它）。
> 本书只写：开工纪律 · 五件的边界与验收 · 交回格式。

---

## 0 · 开工第一条命令（不许跳过，本仓因此丢过三次一整天的产出）

```bash
git fetch origin
git checkout -B wo-m0-ground-truth origin/claude/inspiring-gates-aqczjg
git commit --allow-empty -m "WIP·未验 M0 起点" \
  && git push -u origin HEAD:refs/heads/claude/handoff-m0-ground-truth
pnpm install --prefer-offline \
  && pnpm --filter @platform/contracts build \
  && pnpm --filter @platform/llm-adapters build
```

⚠ **三条环境前置缺一不可**，每一条都被 dev 实测踩过：
- worktree 可能没有 `node_modules`
- `@platform/contracts` 可能未 build
- **`@platform/llm-adapters` 同样可能未 build** —— 不 build 会让**每一个** import 到
  `apps/datacore/src/llm.ts` 的 datacore 测试文件**全部假红**（两个 dev 各排查过一轮）

> **假红的第一反应是核前置，不是核代码。**

之后**每改完一个文件就 commit + push 一次**，提交信息写 `WIP·未验` 都行。
⛔ 不是「写完一个功能」，更不是「测试跑绿了再推」。

---

## 1 · 五件的边界与验收

### F0（P0）清掉仍在生产路径上的前端自造数据

**仓主定义（本单判据之源）**：
> 只要是数据库里的数据就是真实数据（合成的也算）；**只存储在前端的数据就是 mock 数据（假数据）**。

**今天的行为 X**：`apps/frontend-shell/src/views/sim/edgeActiveModel.ts` 的 `deriveBaseSnapshot(cfg)`
在**浏览器里**算 `Math.round(hash01(objectId|变量名) × 100)`，一次 `props` 都不读，
产物经 `createSimSession({baseSnapshot})` 送进会话。调用点实测仍在：`EdgeActivePanel.tsx:213`。
**应该是 Y**：世界态由服务端派生（已落地，`27d44823`：不传 `baseSnapshot` 时服务端用
`deriveSeedBaseSnapshot` 从真实对象派生，并给每格盖 `measured`/`derived` 出处章）。

⚠ **为什么现在还在**：沙盘那单**按指令回退了前端半**，以免与 `origin/claude/handoff-real-cells`
上的 `resolveTick0World` 撞车。**本单的第一件事是裁决这两条路，不是各写一版。**

**必做的前置核查（写不出结论别动手）**：
`git show origin/claude/handoff-real-cells:apps/frontend-shell/src/views/sim/edgeActiveModel.ts`
读 `resolveTick0World`（约 `:530`）——它「先问后端播种的那一份要，要不到才本地派生」。
实测数据：**同一时刻真值 `equipmentFailure=75`，路 A（复制冻结快照）读到 17，路 B（服务端现派生）读到 75。**
⇒ **照路 A 做，验收第一行会直接失败。**

**验收**：
- `grep -rn "deriveBaseSnapshot" apps/frontend-shell/src` 在**生产路径**零命中
- 🐤 金丝雀：同法查 `resolveTick0World` 或服务端派生路径**必须有命中**
  （证明查法有效 **且** 替代路径真的在；零命中就是「工具坏了」不是「清干净了」）
- ⛔ 那支 hash 函数若还被别处引用，**连同调用方一起清**，不许留成死代码

### F1（P0）配对键：把摄取行认成某次预测的 actual

**⚠ 先读 PRD §2.0**：摄取面**已经存在且能用**（`connectors/registry.ts:315-325`
`createAdapter` 支持 `file_upload` / `rest_api` / `prototype_html`；
`connectors/service.ts:283-308` 是完整的 `listDatasets → fetchBatch 游标分页 → RawDataset`）。
**本单不许重造摄取管道**，只补「这一行是那次预测的 actual」这层语义。

**要做**：契约新增 `RealizedOutcome`（形状见 PRD §2.1 F1）+ 数据集级映射
（`datasetKey → subjectRef 字段 + asOf 字段`）+ 与 `recordCalibrationForecasts`
（`apps/datacore/src/solvers/service.ts:6764`，调用点 `:6417`）的配对。

⛔ **按仓主定义，不许以「数据是合成的」为由拒绝登记**——落库即真实数据。
唯一的硬拒条件是 **provenance 不全**（追不回是哪次 sync 的哪一行）。

**验收（T4 故障注入）**：
① `file_upload` 真传一份 CSV ⇒ 落 `RealizedOutcome`，`provenance.syncJobId` 可追回那次 sync；
② 造一条 provenance 残缺的 ⇒ **400 并点名缺哪个字段**（⛔ 不许静默丢弃）；
③ 🐤 金丝雀：登记前后 `paired` 两个数**都打出来**（只打一个数看不出它有没有动）。

### F2（P0）欠账计：`GET /a/v1/calibration/debt`

**要做**：`{ forecasts, paired, unpaired, coveragePct, expected:{minPaired, rationale},
byMetric:[…], oldestUnpairedAgeDays }`，**`expected` 必填**。
该读数**必须同时上屏与进 build 输出**。

**为什么 `expected` 是硬要求**（本仓前科，照抄不得）：
`实测格 0/7295` 曾在**用户屏**（`UnifiedSimShell.tsx:746`）**和启动日志**里亮了几个月，
无人动 —— 不是看不见，是**没有期望值**（读的人无从判断 0 对不对），
且**报给了改不了它的人**（开发侧 `scripts/` 与门里当时一条断言都没有）。

> **没有期望值的指标不是监控，是装饰。**
> `paired:0` ⇒ 装饰；`paired:0（期望 ≥N · 欠 N 对）` ⇒ 欠条。

**验收（T1+T3）**：
① 无实料 ⇒ `paired:0 · expected.minPaired:N · coveragePct:0`，屏上与回包逐字一致；
② 录 M 条并配对 ⇒ 三个数同步变，`oldestUnpairedAgeDays` 单调；
③ 🐤 存在性金丝雀：`forecasts` 必须 >0 —— **为 0 说明取数坏了，不是「没有欠账」**。

### F3（P1）实料闸：学习类能力的统一准入

`B7 / C5 / C6 / A10` 四项**运行时读同一个闸** `calibrationDebt.paired >= expected.minPaired`；
未达标 ⇒ **拒绝启用并披露原因**，⛔ 不许降级成「用仿真数据凑合跑」。

**验收（T2 变异反证）**：`paired` 人为置 0 ⇒ 四项全部拒绝且各自披露；
置到阈值以上 ⇒ 全部放行；**把闸关掉 ⇒ 该门必须红**（不红 = 门是装饰品）。

### A11（P0）解释切片 ≤20 节点

**骨架已在 canonical**：`apps/datacore/src/sim/explain-slice.ts`（提交 `7ed06ee4`，**WIP·未验**）。
⚠ **先读它再动手**——它是纯函数、从 `PropagationTrace` 反向收敛、自带 `coverage` 截断账本。

**⛔ 不许把计算范围卡到 20**：铝箔涨价传到 5 个型号的 `costPressure`，
这条真实链本身就超 20 节点，卡死会切断传导 ⇒ 得到的不是「小切片」而是**错的推演**。
本件只动**事后只读投影**。

**验收（T1+T3）**：
① 取一次真推演的 trace 建切片 ⇒ 节点 ≤20 且 `amountCoveredPct` 与手算一致；
② 🐤 反向：`maxNodes` 设成超过全链节点数 ⇒ `truncated:false · amountCoveredPct:100`；
③ 🐤 存在性：trace 行数必须 >0（为 0 是取数坏了，不是「没有因果链」）。

---

## 2 · 全单通用纪律（每一条都对应本仓一次真实事故）

**测量**
- 任何 `grep`/计数在报结论前先跑**金丝雀**（一个已知必中的样例）。不中 ⇒ 报「**工具坏了**」，
  ⛔ 不许报「干净 / 没有命中 / 不存在」。
- 报**否定结论**（0 处 / 不存在 / 无消费方）必须**同时给出金丝雀的命中证据**。
- ⛔ **grep 永远不构成「X 是不是某对象的属性」的证据** —— 只能真起数据、真读 `o.props[X]`。
  （本仓前科：grep 报「41/41 都是真实属性」，真起数据实测 **45 格里 0 格**读得到，结论完全相反。）

**执行**
- RC 一律 `$?` **直接捕获**；输出**落文件不落管道**。
  ⛔ `cmd | tail -n; echo $?` 取的是 `tail` 的 RC（恒 0）——本仓据此把一个**编译失败**的 commit
  判成「BUILD 通过」并入正线。
- 跑 vitest 前先避让：数**「父进程不是 vitest 的 vitest 进程」**（每棵进程树只算根）。
  **双向金丝雀**：空闲必须报 0 · 只跑一个 run 必须报 1。任一不成立 ⇒ 报「量法坏了」，
  ⛔ 不许拿它做避让决策。⛔ 别用会自匹的模式（命令行含关键字会把探针自己算进去）。
- 起服务：端口 4001/4002/5173 可能被占，**本机没有 `ss`/`netstat`**
  ⇒ **唯一可靠判法是真去 bind**；起完必须**自证连的是自己那一个**
  （回显端口 + 一个只有你这次数据才有的值）。
  ⛔ 不许拿探针的沉默当「端口空闲」——本仓有过「读了别人的旧服务，然后对自己的代码下结论」。

**验收**
- 每件都要一条**对照实验**：「把 X 改成 X′，Y 必须按某个可预言的方式变」，
  **外加一条反向的**（某个**不该变**的必须**不变**）。
  ⚠ 只有正向判据 = 没有判据 —— 本仓真发生过**空绿**：没喂 `pairWeights`，34 条边一条没触发，
  「目标边没动」差点被读成通过。
- 交付验证必须**真起服务**（datacore 内存模式 `SEED_DEMO=1`）。
  ⛔ `VITE_MOCK=1` 与各类桩只能在单测里当替身，**不构成交付证据**。

**禁令（优先级高于以上全部）**
- ⛔ **禁令 3**：不许新增门 / 棘轮 / **基线 JSON**。接缝覆盖**扩已有测试文件**。
- ⛔ **禁令 2**：`apps/frontend-shell/src/views/sim/` 的改动**仅限 F0 那一处**（已获批），
  其余一律不碰。
- ⛔ **禁令 4**：不做杂事、不写文档。**做完的先并，再开下一件。**
- 铁律 0：改了链路/不变量 ⇒ **回写 `docs/SYSTEM-ONTOLOGY.md`**。
  ⚠ 该文件 3844 行读不动，用 `node scripts/ontology-index.mjs --grep <词>` → `--path <路径>`
  定位再读那一段。

**前提纪律（本仓五张单的前提被 dev 实测推翻过）**
> 我给的 file:line 与状态是**线索不是结论**。开工第一件事是把原文读出来，
> 各写成一句「**今天的行为是 X，应该是 Y**」。**写不出来别动手。**
> 若实测发现**已经做了 / 病因不同** —— **停手，把证据（file:line + 读数）顶回来，别硬做。**

---

## 3 · 交回格式（缺项即退回）

1. **分支 tip**（真实 tip，⛔ 别写成 `HEAD~1`——本仓出过报告头的 tip 已过期）
2. **五件逐件**：三句「今天是 X / 应该是 Y / 现在是 Z」
3. **每件的对照实验读数**：正向 + **反向金丝雀**，两组数并排
4. **RC 三件套**：`typecheck` / `build` / 本单相关测试，全部 `$?` 直捕
5. **本体回写了哪几行**
6. **没做到的，如实列** —— 这一条与第 3 条同等重要。
   ⛔ 不许为了好看硬凑；**「诚实说做不到」比「做出一个看起来对的」有价值得多**，
   但⚠ 它也**不等于解决** —— 该说清缺口在哪、下一步是什么。
