# 并线对账单 · `claude/wave4-integration` → 正线（2026-08-06）

> **性质**：纯文档对账（本单不改任何生产代码、未跑 gate、未跑 vitest、未跑 pnpm build）。
> **口径**：正线 `claude/inspiring-gates-aqczjg` = `44a8c650` · 工作线 `claude/wave4-integration` = `7340fdec`。
> **祖先关系（实测）**：`git merge-base --is-ancestor 44a8c650 7340fdec` → **YES**（正线是 wave4 的真祖先，
> 所以这是一次 **fast-forward-able 的并线**，不是三方合并；下文所有「冲突」讲的是**并完之后**的语义冲突，不是 git 文本冲突）。
> **提交数（实测）**：`git rev-list --count 44a8c650..7340fdec` = **86**。
>
> **实测 / 推理 标注纪律**：本文每条结论都标 `[实测]`（亲手跑命令/读文件取到的字节）或 `[推理]`（据实测事实推出、未亲验）。
> 查不动的写 `[查不动]`，不编。

---

## 0. 一句话结论

并线本身是 fast-forward，**git 层面零冲突**；风险全部在**语义层**，集中在四处：
① 三条挂起分支各自占用 `apps/datacore/migrations/028_*`（并任意两条即撞号）；
② 本体 §8 有 **1 处悬空引用**（`G-RISK-NO-DECISION-INFO` 正文写「闭」、§8 表里没有这个编号）；
③ `apps/frontend-shell/src/views/sim/TransitFlowLayer.tsx`（WO-SANDBOX-F2）**零生产调用方**，
  与 F3/F4 被抓过的 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 同族，但这次没人补 registry 也没人补可达门；
④ 两个 **生成态产物**（`docs/ONTOLOGY-SLICE-GAPS.md`、`docs/prd-*-index.json`）里含日期戳与计数，
  并线后若在**别的机器上**重跑 gates 会产生无关 diff。

---

## ① 86 个提交的分组盘点

`[实测]` 全量文件面：`git diff --name-status 44a8c650 7340fdec` = **105 个文件**，
`105 files changed, 19718 insertions(+), 280 deletions(-)`。分包：

| 区域 | 文件 | +/− | 说明 |
|---|---|---|---|
| `apps/datacore` | 29 | +5262 / −70 | 新增 3 个求解器源文件 + 7 个测试文件 |
| `apps/agentcore` | 29 | +2743 / −171 | 槽位链路重做 + 终态看门狗 + 6 个新测试 |
| `apps/frontend-shell` | 16 | +8223 / −1 | F1/F2/F4 三张沙盘视图（纯加性，几乎不动存量） |
| `packages/*` | 16 | +2250 / −27 | contracts 5 个新文件 + llm-adapters 槽值归一 |
| `docs` | 8 | +871 / −7 | 本体回写 + 4 张新工单 + 2 个生成态索引 |
| `scripts` | 6 | +334 / −4 | 3 个新运维脚本 + 2 处门修复 + 锚点基线 |

### 组 A · 推演沙盘 D/E/F 系列（6 张 WO，功能主体）

| WO | 关键提交 | 包 | 改契约 | 改金值 | 回写本体 |
|---|---|---|---|---|---|
| SANDBOX-E3 阻滞点判定器 | `4c2a7a42` / merge `7bcd68c2` | datacore | 否（复用 S0 冻结契约） | **是**（`SOLVER_KEYS` 58→59） | 是 |
| SANDBOX-D4 求解器聚合层 | `89526445` / merge `59fd1931` | datacore + contracts | **是**（`solver-aggregates.ts` 新增） | **是**（R6 字节锚改剥离机制） | 是 |
| SANDBOX-F1 全链线路图 | `b2904d60` / merge `1e234dd7` | frontend | 否 | 否 | 是 |
| SANDBOX-F2 在途/在制层 | `8661f65e` / merge `fc7d59cf` | frontend | 否 | 否 | 是 |
| SANDBOX-F4 节点检视 | `d9ef400c` … `acd47109` | frontend | 否 | 否 | 是 |
| SANDBOX-D2 采购四段腿 | `a33fcf6c` … merge `faa92d9c` | datacore + contracts | **是**（`procurement.ts` 新增） | **是**（类型 92→94、对象 11095→11127、R6 锚） | 是（补登 `G-PROCUREMENT-OPAQUE`） |
| SANDBOX-E4 节拍闸门 | `253ecc2b`/`4528347d`/`ab2b87a5`/merge `e94557e2` | datacore + contracts | 是（`sim.ts`） | 否 | 是 |

### 组 B · 槽位/实体解析链（3 张 WO，AgentCore 主线）

| WO | 关键提交 | 包 | 改契约 | 改金值 | 回写本体 |
|---|---|---|---|---|---|
| WO-SLOT-ENTITY-RESOLVE | `afd4dd81` `4542acf0` `d6eaa9ea` `4a5fc124` | datacore + agentcore + contracts | **是**（`object-ref-resolve.ts` 新增） | 否 | 是（`G-SLOT-REF-ID-ONLY` + L16 事件） |
| WO-SLOT-HARVEST | `1cb7aad8` `c641fd83` `ab4bdba2` / merge `2a3afa4e` | llm-adapters + agentcore | 否 | 否 | 是（`G-SLOT-HARVEST-BLIND` / `G-SLOT-LLM-SINGLE-POINT`） |
| WO-BASE-SLOT-UNIFY | `d3c450dd` `243cd0a5` `b4304954` `5349f2fe` `1eb04a70` / merge `0b319979` | agentcore + datacore + llm-adapters | 是（`qos.ts`） | **是**（`base-slot-unify.seam.test.ts` §A 扫描面 8→10） | 是（`G-BASE-SLOT-TYPE-SPLIT` / `G-SLOT-VALUE-SHAPE`） |

### 组 C · 编排器可靠性（2 张 WO）

| WO | 关键提交 | 包 | 改契约 | 改金值 | 回写本体 |
|---|---|---|---|---|---|
| WO-COORD-YIELD-AND-TERMINAL | `64c5fd43` `800743ae` `ca1ffaaa` `7c251488` / merge `e4a81621` | agentcore | 否 | 否 | 是（`G-COORD-PHRASE-HIJACK` / `G-TASK-NO-TERMINAL` + **§5 新增 R19**） |
| WO-112 派生意图槽位失聪 | `a3609d04` `6a9675bd` `aaaba017` `8ddbd390` `01a0432c` `e20acb89` / merge `21baebe5` | agentcore | 否 | **是**（§A 扫描面再 +2 → 10） | 是（`G-DERIVED-INTENT-SLOT-DEAF`） |

### 组 D · 决策信息三块（1 张 WO，跨 contracts×datacore）

`a7fd2466`（契约半）→ `17afaa01`（派生半接线）→ `235f5c31`/`77a5ba9f`（SEAM 8+ 咬点）→ `26693a67`（回写 L-DEC-INFO）→ merge `68435be6`。
`[实测]` 改契约：`decision-info.ts` 新增 + `disposition.ts`/`solvers.ts` 加性字段；
改金值：R6 字节锚 26434→26882（登记 #2）；回写本体：§3 加 `L-DEC-INFO` 链（`SYSTEM-ONTOLOGY.md:466`）。

### 组 E · LLM 诚实性（1 张 WO）

`1acb542a` / merge `2fe9832e` —— 裸 catch 四分诊断，agentcore only，不改契约、不改金值，回写本体。

### 组 F · 运维/门/纪律（非功能，10 提交）

`b5b96396`（铁律 1 + `scripts/task-probe.sh`）· `728c6a6d`（`wo-autosave.sh`）· `582f3e9f`（`session-resume.sh`）·
`979fe446`/`4fc16ef0`（探针自身两处误报修复）· `25cf9a99`（脚本注释与实情不符）·
`914ed9b1`（**锚点门被 dev worktree 副本自造歧义** → `check-ontology-anchors.mjs` 排除 `worktrees`）。
`[实测]` `CLAUDE.md` +35 行 = **铁律 1 全文**（长任务主动探针 · 四态处置表 · 「杀进程别用会自匹的模式」）
**＋ 一条新约定「派 dev 必须 worktree 隔离」**（不传 `isolation:"worktree"` → dev 在主工作目录改文件，
而 gate 正在同一目录跑；实测 WO-112 的 dev 与 gate 的 TEST 阶段重叠 7 分钟，那次 gate 报的绿
**证明的是某个中间态通过了，不是要并线的那个 commit 通过了**）。
`[推理]` 这条新约定直接影响审核方**本次**怎么跑 gate —— 见 ⑥ R10。

### 组 G · 并线收口（3 提交，最后一天）

- `e24f20ec` —— ① 前端 `tsc --noEmit` 从 exit 2 转 0（`physical-topology-reachable.test.tsx:24` 裸 `<Lazy />` 报 TS2322）；
  ② `apps/datacore/src/sim/propagation.ts` 里的**裸 NUL 字节**改六字符转义（此前 git 把整文件判为 binary，改动不可评审）；③ 一句失实注释。
  **值得注意**：①「红的时候 `pnpm -r test` 是绿的」—— 这条缝只有 typecheck 那一格看得见。
- `7340fdec` —— D2 × DECISION-INFO 的 `SolverContext.suppliers` 双声明撞车（TS2451 + TS1117），
  git 文本无冲突、编译才炸。修法取并集并保住两单各自的按需加载条件。
- `b13cb04d` —— 补登 §8 `G-PROCUREMENT-OPAQUE`（原 dev 引用了这个编号但从没登记 = 悬空引用）。

### 组 H · autosave 噪声（**13 个提交，纯机器快照**）

`[实测]` 提交前缀 `autosave(claude/handoff-wo-sandbox-*)` 共 13 条（`7497ebea` `92376811` `dea3b632` `95df5b4b`
`000b3757` `1b89ff3d` `f9f89ce3` `9a7ae0ed` `0ddea2ca` `1faf6a77` 等），来自 `scripts/wo-autosave.sh` 守护。
其中 **两条被后续提交明确记为「快照到了中间态」并被清干净**：
- `33bc1ac6`「复原 procurement 契约（autosave 把『前端 typecheck 是否本单引入』的基线探针快照成了提交）」
- `727fdab7`「变异反证三轮完成 + 撤回全部变异（autosave 曾快照到 M3 中间态，此提交清干净）」

`[推理]` 这 13 条不携带独立语义，并线时**不需要单独审**，但它们让 `git log` 的可读性变差；
若审核方走 cherry-pick 而非 fast-forward，**必须整段带上**（中间态靠后续提交纠正，漏挑会把中间态留在树上）。

---

## ② 金值 / 注册表清单（逐个确认「现在这个数是怎么来的」）

> 判据纪律：下表每个「现值来源」栏都标注是**读源码点出来的**还是**只读了提交注释**。
> 本单不跑 vitest，所以凡「需要真跑种子才能确认」的数字，一律标 `[未跑·靠注释]`，不冒充实测。

| # | 金值位置 | 旧值 → 新值 | 改动它的提交 | 理由 | 现值来源核验 |
|---|---|---|---|---|---|
| 1 | `apps/datacore/test/demo-chain-provenance.test.ts:44,89` 类型数 | 92 → **94** | `faa92d9c`（D2 并线） | D2 新增 `CustomsClearance`（清关）/`IncomingInspection`（到货检验）两类，**均有实例** | `[实测]` 文件里确为 `toBe(94)`（两处一致）。`[未跑·靠注释]` 「94」对不对需真跑 seed |
| 2 | 同上 `:93` 对象数 | 11095 → **11127** | `faa92d9c` | +32 = 进口供应商 SUP-015 宇部兴产 ×1 + CustomsClearance ×1（仅进口 PO）+ IncomingInspection ×30（每张 PO 必检） | `[实测]` 文件里确为 `toBe(11127)`；分解 1+1+30=32 与 11095+32=11127 **算术自洽** |
| 3 | `apps/datacore/test/action-adopt-mitigation.seam.test.ts:264` R6 长度 | 26434 → 26882 → **26898** | ①`f18d5a4a`（D4 引入 ADDITIVE_KEYS 剥离机制）②`c6590614`（DECISION-INFO rebase）③`7340fdec`（D2×DECISION-INFO 接缝） | 见下方专条 | `[实测]` 文件里确为 `toBe(26898)` |
| 4 | 同上 `:269` R6 sha256 | `9d8d4050…` → `84509cbe…` → **`f677f796…`** | 同上 | 同上 | `[实测]` 文件里确为 `f677f7965f7a58b376ed95cc87cc6c604e5686a1b61882da5340db3d7f8983fa` |
| 5 | `apps/agentcore/test/base-slot-unify.seam.test.ts:200-211` §A 扫描面 | 8 项 → **10 项** | ①`b4304954`/`1eb04a70`（base 槽口径统一，建门）②`8ddbd390`（WO-112 派生意图补槽） | WO-112 让 16 个派生意图从 `slots: []` 变成「从求解器已声明入参派生」，其中 `yield_diag.base`（S12·原写死"常州"）与 `carbon_q.baseName`（S20·原写死"成都"）进入本门扫描面 | `[实测]` 数组现为 10 项：`adopt_mitigation.base` / `affected_orders.base` / `capacity_feasibility.base` / **`carbon_q.baseName`** / `ceo_base_outlook.baseId` / `ceo_bottleneck.baseIds:json` / `ceo_whatif.scopeObjectIds:json` / `order_deep_360.base` / `risk_root_cause.base` / **`yield_diag.base`** |
| 6 | `apps/datacore/test/ontology-core.test.ts:497` `SOLVER_KEYS.length` | 58 → **59** | `7bcd68c2`（E3 并线） | E1 与 E3 **各自**把 57 提到 58，两条 handoff 一起并 → 59 | **`[实测·亲手数过]`** 静态解析 `apps/datacore/src/solvers/service.ts` 的 `SOLVER_KEYS` 数组：**59 个键、零重复**，末两个正是 `chain_loss_attribution`（E1）与 `chain_impediments`（E3）。金值与源码**一致** |
| 7 | `apps/datacore/src/catalog.ts` 求解器目录 | +1（`chain_impediments`） | `4c2a7a42` | E3 新求解器必须进目录否则 `catalog.test` parity 红 | **`[实测·亲手数过]`** `catalog.ts` 共 61 处 `key: "`，其中 `BUILTIN_SLICE_CATALOG` 占 2 → `ALL_SOLVER_CATALOG` = **59**，与 `SOLVER_KEYS` **相等**。`catalog.test.ts:63-65` 是 parity 断言（无魔数），故**不需要改金值** |
| 8 | `docs/ONTOLOGY-SLICE-GAPS.md:7-10` 门禁产物计数 | 类型 92→**94** · 链路 79→**82** · 切片库 41→**42**（跨域 34→35）· 连通边 370→**372**（bridge-link 255→257） | `7460317b`（"切片连通门重跑刷新 94/82/42/372"） | D2 新增 2 类型 + 新切片 `biz.x.purchaseorder_to_incominginspection` | `[实测]` 文件头四行确为 94/82/42/372；表体确新增两行 `…_to_purchaseorder_to_incominginspection`。**`[实测]` 该文件是生成态**：`scripts/check-slice-connectivity.mjs:109` `writeFileSync(…ONTOLOGY-SLICE-GAPS.md)`，文件里也写着「请勿手改——重跑门禁即刷新」。类型 94 与 #1 的 94 **交叉一致** |
| 9 | `scripts/ontology-anchor-baseline.json` `verified[]` | 8 条 → **40 条** | 主要由 `914ed9b1` 与各槽位单顺带补 | 锚点棘轮：`verified` 里的键**只许增不许消失**。本次新增 32 条带 symbol 的锚点（`sim-planner.ts::*`/`orchestrator.ts::armTerminalWatchdog` 等） | `[实测]` diff 仅动 `verified[]` 数组，`unverified{}` 计数**一个都没动**。`[实测]` 门的语义（`check-ontology-anchors.mjs:28-31` 注释）：`verified` 增无需改基线也不会红，**只有消失才红** → 此增量是安全方向 |
| 10 | `scripts/check-ontology-anchors.mjs` 扫描面 | +`worktrees` 排除项 | `914ed9b1` | 23 个 dev worktree 是**整仓副本**，不排除则裸文件名锚点全判 `PATH_AMBIGUOUS`，门红在自造歧义上 | `[实测]` 第 60 行确已加 `e.name === "worktrees"` |
| 11 | `scripts/check-scenario-slot-keys.mjs` 判据 | 别名无条件改写 → **精确命中优先** | `6a9675bd`/`8ddbd390`（WO-112） | 派生意图的槽名现在**等于求解器入参名**（`carbon_q` 的槽真叫 `modelId`/`baseName`），无条件改写会把精确命中改成不存在的槽名，门反过来误杀正确接线 | `[实测]` 新增 `resolveKey(rawKey, slotNames)`，`slotNames.has(rawKey) ? rawKey : ALIASES[…]`。判据**更严不是放宽** |
| 12 | `docs/prd-ontology-index.json` 不变量集 | +`R19` | `02fcac5f`（门重生成） | R19「任何非终态状态都必须有明确的终态责任人」 | `[实测]` json 里 R19 已在；`SYSTEM-ONTOLOGY.md:798` 有 **R19** 正文行 |
| 13 | `docs/prd-coverage-index.json` / `prd-ontology-index.json` `generatedAt` | `2026-08-05` → `2026-08-06` | `02fcac5f` | 门重生成的日期戳 | `[实测]` 两文件唯一的非 R19 改动就是这个日期 |

### 专条 · R6 字节锚（#3/#4）的三次改动，逐笔归属

`[实测]` 从 `action-adopt-mitigation.seam.test.ts` 正文读出，三次登记都写清了归属：

1. **登记 #1（D4，`f18d5a4a`）** 26434 → 30213（+3779），归属 `otdBatch`（顶层）+ 逐卡 `otd`。
   **口径改了**：此前锁死整个 payload，任何加性字段都打红 → 逼人改数字（= 橡皮图章）。
   改为**剥掉已登记加性键再锁金值**，`ADDITIVE_KEYS` 从此是一张需要人工登记的表。
2. **登记 #2（DECISION-INFO rebase，`c6590614`）** 剥离后 26434 → 26882（+448）。
   **`[实测·注释自陈]` 本单不是纯加性**：③.2「去魔数」有意改了推演数值口径（`trigDay+7/+14` 两个字面量
   改为由 `InterBaseTransfer.transitDays` / `Supplier.leadTime` 真对象派生），所以老哈希 `9d8d4050…` 不再成立。
   dev 记录的取证：diff 全部变化行按键名归类 = `day`×16 · `date`×16 · `rationale`×16，**没有第四个键**。
3. **登记 #3（`7340fdec`，审核方合并态）** 26882 → 26898（**+16**）。
   **没有新加性键，变的是老字段的值** —— D2 的数据半撞上 DECISION-INFO 的引擎半：
   `outsourceLeadOf`（`solvers/decision-info.ts:400`）取「全部合格供应商里 leadTime 最大的那家」，
   D2 新增的进口供应商 SUP-015 `leadTime=12` 顶掉了原最大值 7 → 一位数变两位数 × 16 行 = +16 字节。

`[实测]` 剥离器还带**反向门**：`expect(Object.keys(numeric)).toContain("otdBatch")` /
`toContain("exposureOrder")` —— 防止 `ADDITIVE_KEYS` 过期后退化成「剥了个不存在的键」白白放行真回归。
这一条做得对，**并线不需要动它**。

### 遗留欠账（注释里自陈，非本次修）

`[实测·注释自陈]` `outsourceLeadOf` 的外协前置期是**全局最大**，不区分要外协的是什么物料
——「一家电解液进口商的 12 天，会被用作电芯外协的前置期」。已在测试注释里记为欠账。

---

## ③ 迁移号冲突排查

### 3.1 wave4 自身：**零新增冲突**

`[实测]` `apps/datacore/migrations/`：正线 28 个文件、wave4 **28 个文件，逐名相同、零改动**。
`[实测]` `apps/agentcore/migrations/`：正线 `001…010`（10 个），wave4 **多一个 `011_pending_clarification.sql`**。
这是本次并线**唯一**的新迁移。

**编号跳空**：`[实测]` datacore `001…027` 无跳空；agentcore `001…011` 无跳空。

**同号不同内容（存量·非本次引入）**：`[实测]` `apps/datacore/migrations/` 有**两个 013**
—— `013_data_builder.sql` 与 `013_pipeline.sql`。**正线与 wave4 都有**，是历史存量，不是这次撞的。

**新迁移的双实现纪律**：`[实测]` `011_pending_clarification.sql` 只做 `ALTER TABLE query_tasks ADD COLUMN IF NOT EXISTS`
（`pending_clarification` / `slot_resolutions` 两个 JSONB，幂等），且
`persistence/pg.ts:167,710` · `persistence/memory.ts:116-118` · `persistence/repos.ts:144` **三处都已接线**，
符合 CLAUDE.md「新增表需同时改 migrations + pg + memory + repo 接口」。

### 3.2 迁移执行器的行为（决定同号会不会炸）

`[实测]` `apps/datacore/src/repo/pg.ts:558-570`：
```
const files = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql")).sort();
… SELECT 1 FROM schema_migrations WHERE name = $1 …
```
→ **按完整文件名排序、按完整文件名去重**。所以两个同号文件**都会跑**，顺序由完整文件名字典序决定。
`[推理]` 结论：同号**不会让迁移器报错**，风险是 ① 两个同号文件之间的**执行顺序是字典序而非意图序**；
② 编号作为「先后」的语义失效。**真正的硬冲突只发生在两条分支起了同一个文件名**。

### 3.3 挂起分支上的 028 撞号（**并线时最容易踩的一格**）

`[实测]` 逐分支比对「该分支新增、而 wave4 没有的文件」，命中三条各占一个 `028`：

| 分支 | 新增迁移 | 与 wave4 关系 |
|---|---|---|
| `claude/handoff-wo-66-rules-p1p2` | `apps/datacore/migrations/**028**_solver_rule_bindings.sql` | wave4 没有 |
| `claude/handoff-wo-69-p3-interface` | `apps/datacore/migrations/**028**_object_interfaces.sql` | wave4 没有 |
| `claude/handoff-sandbox-action-propagation` | `apps/datacore/migrations/**028**_sim_action_propagation_rule.sql` | wave4 没有 |
| `claude/handoff-wo-aip-cap0` | `apps/agentcore/migrations/**010**_plan_builder_canvases.sql` | wave4 的 010 是 `010_multi_intent_plan.sql`（**同号不同名不同内容**） |

`[推理]` 三条 028 文件**名字互不相同** → git 合并不会文本冲突，会安静地产生三个 028。
按 3.2 的执行器语义它们都会跑，顺序 = `object_interfaces` → `sim_action_propagation_rule` → `solver_rule_bindings`（字典序），
与任何人的意图无关。**建议**：谁先并谁拿 028，后到的改 029/030；
`apps/agentcore` 那条 010 更要改（wave4 的 010 已占号且内容完全不同）。

---

## ④ 本体回写完整性

### 4.1 §8 断点登记：新引入 14 个编号，**13 个登记齐、1 个悬空**

`[实测]` 从 86 个提交的**新增行**里抽出全部 `G-XXX` 编号（14 个），逐个对 §8（`SYSTEM-ONTOLOGY.md` 911–1024 行）核验：

| 编号 | §8 有行？ | 备注 |
|---|---|---|
| `G-SLOT-REF-ID-ONLY` | ✅ `:981` | WO-SLOT-ENTITY-RESOLVE |
| `G-SLOT-HARVEST-BLIND` | ✅ `:982` | |
| `G-SLOT-LLM-SINGLE-POINT` | ✅ `:983` | |
| `G-BASE-SLOT-TYPE-SPLIT` | ✅ `:984` | |
| `G-SLOT-VALUE-SHAPE` | ✅ `:985` | |
| `G-COORD-PHRASE-HIJACK` | ✅ `:1006` | |
| `G-TASK-NO-TERMINAL` | ✅ `:1007` | |
| `G-PROCUREMENT-OPAQUE` | ✅ `:1008` | **`b13cb04d` 专门补登的**（原 dev 引用未登记） |
| `G-DERIVED-INTENT-SLOT-DEAF` | ✅ `:1009` | WO-112 |
| `G-ARG-DROP-SEAM` / `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` / `G-ROUTE-REGEX-PREEMPTS-RETRIEVAL` / `G-3` | ✅ 存量已登记 | 本次只是被引用 |
| **`G-RISK-NO-DECISION-INFO`** | ❌ **§8 里 grep 不到** | 见下 |

**`[实测]` 悬空引用一处**：`docs/SYSTEM-ONTOLOGY.md:466` 写
`**决策信息三块链（WO-DECISION-INFO·L-DEC-INFO·加性·闭 G-RISK-NO-DECISION-INFO）**`，
但全仓 grep `G-RISK-NO-DECISION-INFO` **只有这一处命中**，§8 表里没有该编号的行。
这与 `b13cb04d` 刚修掉的 `G-PROCUREMENT-OPAQUE` 是**同一个病**，本仓刚因此退过一张单。
`[推理]` 修法二选一：① 在 §8 补一行（若确有这个断点，写清 AS-IS 与已闭证据）；
② 若这个编号是即兴起的、并无对应断点，把 `:466` 的「闭 G-RISK-NO-DECISION-INFO」改掉。
**这条不该拖到并线之后**——它就是「本体不回写即过期失效」。

### 4.2 §3 链路 / §5 不变量 / L 事件

- `[实测]` **新增链路** `L-DEC-INFO`（`:466`，`26693a67` 写入）—— 已回写。
- `[实测]` **新增不变量 R19**（`:798`，`ca1ffaaa` 写入）「任何非终态状态都必须有明确的终态责任人」，
  并已被 `02fcac5f` 同步进生成态索引 `docs/prd-ontology-index.json`。**回写链完整**。
- `[实测]` **事件增补 L16** `entity.out_of_domain`（`:761`，`4a5fc124` 写入）—— 已回写。
- `[实测]` §3 链路节点：`ab4bdba2` 提交信息声明「§3 链路补两个节点 + §7 槽位通路接缝门」，
  `SYSTEM-ONTOLOGY.md` 的 diff 确含 §3/§7 段新增行。

### 4.3 §8 的存量悬空引用（**非本次引入，但会被门看见**）

`[实测]` 全仓扫描发现 **45 个** `G-XXX` 编号在某处被引用、却不在 §8 任何位置出现。
绝大多数是 PRD/审计文档里的自造编号（`G-DRIL-1..4`、`G-SKILL-*`、`G-DATAGAP*` 等），**与本次并线无关**。
但有 4 个在 §8 段落**正文里**出现却**没有自己的表行**，形态介于「已登记」与「悬空」之间：
`G-LOOP-FEEDBACK` / `G-SEG-ATTR-BASE-BASES0` / `G-SEG-ATTR-BASE-SCOPE` / `G-WHATIF-NL-UNREACHABLE`。
`[推理]` 这几个是「作为旁支写在别人行里」的写法，不算断链，但 grep 不到独立行，
下一个人按编号找会扑空。**列在这里只作备案，不建议在并线这一刀里动它们。**

---

## ⑤ 挂起分支定性

`[实测]` `git ls-remote --heads origin` 共 **247** 条（`claude/*` **230** 条 + 17 条非 claude：
`main` / `integ-wave-10` / `verify-skill3` / 14 条 `worktree-agent-*`）。
本地 remote-tracking ref 与远端**逐条相同**（`comm -23` 差集为空，无陈旧引用），故下述定性全部是**本地实测**。
下表统计**排除本单自己的分支** `claude/handoff-wo-mainline-reconcile`，基数 = 230。

### 5.1 定性方法（三层判据，不靠分支名）

1. **祖先判据**：`git merge-base --is-ancestor <branch> 7340fdec` → 真祖先即「已并入 wave4」。
2. **主题等价判据**：对不是祖先的分支，取 `git log --format=%s 7340fdec..<branch>` 的每条 subject，
   在 `git log --format=%s 7340fdec` 全量 subject 集合里找**逐字相同**的行（squash/rebase/cherry-pick 后 sha 变、subject 通常不变）。
3. **文件存在判据**（最硬的一层）：取分支相对 merge-base **新增的文件路径**，逐个问 wave4「你有没有这个路径」
   （`git rev-parse --verify -q 7340fdec:<path>`）。
   ⚠ **踩过的坑**：第一版用了 `git rev-parse <rev>:<path>`（不带 `--verify -q`）——它在路径不存在时
   **把输入串原样打到 stdout** 并同时报错，于是「不存在」被误判成「存在但内容不同」，全表 `ABSENT=0`。
   带上 `--verify -q` 后结果完全改写。**这一条是本单自己的铁律 0.5 现场**。

### 5.2 定性结果

`[实测]` 四类**互斥**（判据按 A → C → D → B 顺序落桶），逐条实跑得出：

| 类别 | 条数 | 判据 | 处置 |
|---|---|---|---|
| **A · 已并入 wave4（真祖先）** | **36** | `--is-ancestor` = true | 可删 |
| **B · 已被等价并入（可弃）** | **113** | 非祖先，`ABSENT=0` 且 `wave4..branch` 的**每条 subject** 都能在 wave4 全量历史里逐字找到 | 可删 |
| **C · 带 wave4 没有的文件路径** | **40** | `ABSENT>0` | 逐条看，见 5.3 |
| **D · 只有内容差异，无新路径** | **41** | `ABSENT=0` 但有未匹配 subject | 多为旧基线上的小改；见 5.4 |

> `[实测]` 36 + 113 + 40 + 41 = **230**，与 `claude/*` 总数（排除本单分支）**完全相等**，无重复无遗漏。
> A 桶里包含 `claude/wave4-integration` 与 `claude/inspiring-gates-aqczjg` 自身（自洽性检查通过）。

### 5.3 类别 C 逐条（40 条，**只有这里可能藏着真价值**）

**C-1 · 现役 / 可能正在跑（2026-08-06，最高优先）**

| 分支 | sha | wave4 缺什么 | 定性 |
|---|---|---|---|
| `claude/handoff-wo-engine-scope-forensics` | `def58937` (12:51) | `docs/WO-ENGINE-SCOPE-FORENSICS.md`（602 行） | **未并且仍有价值**。`[实测]` merge-base = `e20acb89`（wave4 倒数第 4 个提交）→ 它是**从 wave4 当前头附近切出去的活分支**，纯取证文档、不改实现。`[推理]` 极可能就是「另一个正在跑的 dev」。并线时**不要动它**，等它自己收口 |
| `claude/kimi-accept-run` | `e2c7f7c8` (11:33) | `scripts/kimi-accept/` 7 个文件（含 2388 行真 Kimi 10×5 矩阵原始结果） | **未并且仍有价值**（验收取证资产）。`[实测]` 全部落在新目录 `scripts/kimi-accept/`，与 wave4 零路径重叠 → **并线零冲突**，可随时收编 |

**C-2 · 08-06 05:43 那次容器重启的 autosave 遗留（9 条）**

`[实测]` 这 9 条的 tip 都是**同一分钟**（05:43:43）的 `autosave(claude/handoff-*)` 快照
—— 就是 `scripts/wo-autosave.sh` 在那次重启时抢救下来的东西。其中 2 条落 C 桶、7 条落 D 桶。

为了让审核方能直接排队，我另外实测了**每条分支改的文件与 wave4 那 86 个提交改的 105 个文件的交集**
（交集 = 并的时候真会冲突的地方）：

| 分支 | 改文件数 | 与 wave4 撞车 | 撞在哪 | 定性 |
|---|---|---|---|---|
| `claude/handoff-wo-nl-robust` | 2 | **1** | `docs/SYSTEM-ONTOLOGY.md` | **C 桶·未并且仍有价值**：`apps/agentcore/test/qos-nl-robust.test.ts` wave4 **确实没有**（实测 ABSENT）；本体 11 行回写也没并 |
| `claude/handoff-wo-modeling-interactive` | 6 | **2** | `datacore/src/ontology.ts` · `synthetic/service.ts` | **C 桶·未并且仍有价值**：`apps/datacore/test/modeling-provenance.test.ts` wave4 **确实没有** |
| `claude/handoff-fix-frontend-fabricate` | 7 | **0** | — | **D 桶·可低成本收编**：7 个文件 wave4 一个都没碰，纯前端「不许编数据」修复，撞车概率 0 |
| `claude/handoff-wo-gslive-live` | 1 | **0** | — | **D 桶·可低成本收编**：只改 `packages/contracts/src/global-sim.ts`（wave4 未碰） |
| `claude/handoff-wo-live-endpoints` | 5 | 1 | `datacore/src/app.ts` | **D 桶·价值待判**：4/5 干净 |
| `claude/handoff-wo-slice-governance` | 2 | 1 | `datacore/src/app.ts` | **D 桶·价值待判** |
| `claude/handoff-wo-slice-governance-full` | 9 | 1 | `datacore/src/app.ts` | **D 桶·价值待判**（是上一条的超集，二选一即可） |
| `claude/handoff-wo-caplive-truechain` | 7 | 3 | `solvers/capacity.ts` · `solvers/service.ts` · `SYSTEM-ONTOLOGY.md` | **D 桶·冲突面中等**：撞在 wave4 改得最狠的 `solvers/service.ts` 上 |
| `claude/handoff-fix-datacore-fake` | 6 | **5** | `solvers/extended.ts` · `solvers/risk.ts` · `solvers/service.ts` · `SYSTEM-ONTOLOGY.md` · `contracts/src/solvers.ts` | **D 桶·冲突面最大**：6 个文件里 5 个和 wave4 撞。**并线后最后再碰这条** |

> **`[实测]` 纠正一处我自己差点写错的判断**：`apps/datacore/test/caplive-truechain.test.ts` /
> `apps/agentcore/src/router/live-endpoints.ts` / `apps/datacore/src/ontology-governance.ts` /
> `apps/frontend-shell/src/pages/admin/SliceInspector.tsx` / `packages/contracts/src/global-sim.ts`
> —— 这几个看着像「分支新造的文件」，实际 **wave4 里全都已经有了**（`git rev-parse --verify -q 7340fdec:<path>` 全部命中）。
> 分支带的是对它们的**后续修改**，不是新文件。**没追这一层就会把「改了一版」误报成「wave4 缺一个模块」。**
>
> **`[查不动]`**：这 9 条各自「那点改动到底还值不值」，必须真读 diff 并与 wave4 对拍才能定死，
> 超出「纯文档对账」的范围，本单不做；上表给的是**冲突面**（可机器算），不是**价值判断**。

**C-3 · 7-30/7-31 一批（`wo-66-*` / `wo-69-*` / `wo-63-schema-readability`）**

`[实测]` 这几条各自带 wave4 缺失的实现文件（见 ③.3 表 + `synthetic/ontology-readability.ts` /
`solvers/ontology-signature.ts` / `solvers/rule-params.ts` / `check-schema-readability.mjs` …）。
`[推理]` 定性 **「未并且仍有价值」**，但**都占着 028 迁移号**，是并线后最先要排队的一批。

**C-4 · 大件历史恢复分支（7 条·可弃·且绝不能合）**

`[实测]` `claude/complete-repo-recovery`(ABSENT=1102) · `claude/vigilant-knuth-july-recovery`(1119) ·
`claude/sandbox-reconstruction-dev3-duun6o`(955) · `claude/complete-app-recovery`(825) ·
`claude/session-artifacts`(343) · `claude/july-pipeline-backup-ac1c37af`(72) · `claude/wizardly-gauss-7enbzy`(40) ·
`claude/parallel-agent-tasks-d3xmzn`(20)。
`[实测]` 它们「缺失」的文件里含 `apps/agentcore/migrations/009_growth_worklist.sql` /
`010_materialized_intents.sql` / `011_handoffs.sql` / `012_scenario_ontogenesis_runs.sql` /
`013_pre_analyses.sql` —— 与 wave4 现役 009/010/011 **同号完全不同内容**，属于**另一条已废弃的历史线**。
`[推理]` 定性 **「已被更进化的实现取代（可弃）」**，且**绝不能合**（合了直接撞 agentcore 三个迁移号）。

**C-5 · 其余零散（7-17 ~ 7-26，21 条）**

`[实测]` 多为单个缺失文件：`geo-real-signal.test.ts` / `causal-deepchain.test.ts` /
`metric-aware-composition.test.ts` / `e2e-dialogue-acceptance.test.ts` / `gray-node-autofill-seam.test.tsx` /
`router/multi-intent.ts` / `agent/ceo.ts` / `docs/DIAG-100Q-RESULTS.md` / `docs/acceptance-log-qos-live-10q.md` 等。
`[推理]` 定性偏 **「已被更进化的实现取代」**：同名能力在 wave4 里普遍以别的文件名存在
（如多意图编排已进 `router/l2-decompose.ts` + `execute-plan.ts`）。
但**逐条确认需要读 diff，本单未做**，明确标 `[查不动·未逐条验]`。

### 5.4 类别 B / D 的证据样例（说明这 154 条不是拍脑袋）

- **B 桶样例** `[实测]`：`claude/fix-llm-honesty`（`f8c26ec6`，非祖先，ahead=1）——那条 subject
  `fix(agentcore): LLM 失败诊断说真话 —— 裸 catch 四病一诊 + 失败路径报没调用过的模型名`
  在 wave4 里能**逐字**找到（`1acb542a`，来自 `claude/fix-llm-honesty-rebased`，而该 sha 是 wave4 真祖先）。
  → 「rebase 后 sha 变、内容已并」的标准形态。定性 **可弃**。
- **B 桶样例** `[实测]`：沙盘 `handoff-wo-sandbox-{s0,d1,d3,e1,e2,f3}` 六条 —— `ABSENT=0`
  且 `subjUnmatched=0`（每条的 subject 都在 wave4 里逐字命中）。它们各自的实现文件
  （`contracts/src/chain-sim.ts` · `synthetic/cadence.ts` · `contracts/src/process-capacity.ts` ·
  `solvers/chain-loss.ts` · `solvers/scope.ts` · `views/sim/PhysicalTopologyView.tsx`）
  **wave4 全部已有**。定性 **可弃**（wave4 更早批次已并过，分支只是没删）。
- **D 桶**的 41 条不新增任何 wave4 缺失路径，差异只在已存在文件的内容上；
  上面 C-2 表里那 7 条 D 桶分支是其中最新的一批，其余多为 7 月旧基线残留。

---

## ⑥ 并线风险提示（按风险排序）

### R1 · 三条挂起分支各占一个 `datacore/migrations/028`（**最高**）
并 wave4 本身安全（它一个迁移都没加到 datacore）。但**并完之后**排队的
`wo-66-rules-p1p2` / `wo-69-p3-interface` / `sandbox-action-propagation` 三条各带一个 028，
名字不同 → **git 不会报冲突，会安静产生三个 028**，执行顺序变成字典序。
**处置**：并线时就把号定死（谁先并谁拿 028，其余改 029/030），并在工单里写明。
另 `handoff-wo-aip-cap0` 的 `agentcore/migrations/010_plan_builder_canvases.sql` 与现役
`010_multi_intent_plan.sql` 同号 —— 那条必须改号才谈得上并。

### R2 · 本体 §8 悬空引用 `G-RISK-NO-DECISION-INFO`（**高**）
`SYSTEM-ONTOLOGY.md:466` 写「闭 G-RISK-NO-DECISION-INFO」，§8 表里无此编号。
`[实测]` 全仓仅此一处命中。与 `b13cb04d` 刚补掉的 `G-PROCUREMENT-OPAQUE` 同族，
**本仓刚因此退过一张单**。建议并线前一并补掉（要么补行，要么改掉这句「闭」）。

### R3 · `TransitFlowLayer`（WO-SANDBOX-F2）零生产调用方（**高**）
`[实测·追了两层]`
- `apps/frontend-shell/src/views/registry.ts` 本次只新增了 `chain-line-map`（F1）与 `node-inspector`（F4）两行，
  **没有 transit 相关的 `registerRenderer`**（grep `transit|Transit` 于 registry.ts → 0 命中）。
- 全 `src/` 里除 `TransitFlowLayer.tsx` 自己外，**没有任何文件 import 它**。
- 只有 `apps/frontend-shell/test/transit-flow.seam.test.tsx` 直接 import 纯函数模块 `transitFlow.ts`。
- 也不存在字符串键分发（全仓 grep `transit-flow` 只命中它自己的 `queryKey` / `data-testid` / 注释）。

→ 形态 = **没接线**（调用方集合里只有 test）。这正是本仓登记的
`G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 第 9 形态：实现有、38 例 SEAM 全绿、零路由渲染得到。
**F3 和 F4 都被抓过并补了 registry 行 + `*-reachable` 可达门（`node-inspector-reachable.test.tsx`
写得很清楚：「SEAM 测试咬的是组件，不是链路」），F2 两样都没有。**
四包 gate 会**全绿放过这一条**——因为没有任何测试咬这条链路。
**处置**：并线不必因此卡住（纯加性、不破坏别的东西），但要**立刻开单**补 registry 行 + 同族可达门，
否则就是又一个「测试绿、页面永远打不开」。

### R4 · 生成态产物的日期戳与机器相关性（**中**）
`docs/ONTOLOGY-SLICE-GAPS.md`（`check-slice-connectivity.mjs:109` 写盘）与
`docs/prd-{coverage,ontology}-index.json`（`generatedAt: "2026-08-06"`）都是**门跑出来的产物**。
`[推理]` 并线后审核方在自己机器上跑 `pnpm gates` 会重写这几个文件；
若日期跨天或本体再有增删，`git status` 会出现「没人改却脏了」的 diff。
**处置**：并线后第一次跑门，把重生成结果一并提交，不要当成异常。

### R5 · 锚点门与 dev worktree 的耦合（**中**）
`914ed9b1` 已把 `.claude/worktrees` 排除出锚点索引。
`[推理]` 但排除逻辑是「目录名等于 `worktrees` 就跳过」（`check-ontology-anchors.mjs:60`），
若将来 worktree 换了挂载位置或改名，这道门会**再次红在自造歧义上**。备案，不建议现在改。

### R6 · `ADDITIVE_KEYS` 剥离机制的长期滑坡（**中**）
R6 字节锚现在靠一张人工登记的 `ADDITIVE_KEYS` 表（7 个键）。
`[实测]` 它已经带了反向门（`toContain("otdBatch")` / `toContain("exposureOrder")`），设计是对的。
`[推理]` 但每加一个加性字段就要往表里加一行 + 写清归属，**这是有摩擦的**；
一旦有人图省事直接改数字，这条锚就退回橡皮图章。备案。

### R7 · autosave 提交必须整段带（**中低**）
`[实测]` 13 条 autosave 里至少 2 条快照到了中间态，靠后续提交（`33bc1ac6` / `727fdab7`）纠正。
`[推理]` 若审核方走 cherry-pick 而非 fast-forward，**漏挑纠正提交会把中间态留在树上**。
既然 `44a8c650` 是 `7340fdec` 的真祖先，**建议直接 fast-forward / merge --ff-only，不要挑**。

### R8 · 「各半绿 ≠ 合并态绿」在本批已真实发生两次（**已修·仅作复发提醒**）
`[实测]` ① `7340fdec`：D2 与 DECISION-INFO 各自往 `SolverContext` 加 `suppliers` → git 无文本冲突、TS2451 才炸；
② `ontology-core.test.ts`：E1 与 E3 各自把 `SOLVER_KEYS` 金值 57→58，合并即须 59。
`[推理]` 这两笔都已在 wave4 内修好。提醒：**并线后若再排队并入 C-4 那批（wo-66/wo-69），
同一形态大概率复发**（它们也动 `solvers/` 与迁移）。SEAM-GATE 的头号判据仍是「合并态跑」，不是「各半绿」。

### R9 · 前端 typecheck 曾长期红而测试全绿（**已修·仅作纪律提醒**）
`[实测]` `e24f20ec` 记录：`physical-topology-reachable.test.tsx:24` 让 `tsc --noEmit` 长期 exit 2，
而 `pnpm -r test` 一直是绿的（vitest 不做类型检查）。
`[推理]` 并线复验时 **`typecheck` 必须单列一格显式捕获退出码**，不能被 `pnpm -r test` 的绿覆盖过去。

---

## 附录 A · 本单未做 / 查不动的事（诚实边界）

- **未跑任何测试、未跑 gate、未跑 build**（工单硬约束）。所以：
  - 金值 #1/#2（类型 94 / 对象 11127）**只核了「文件里写的是这个数」和「分解算术自洽」**，
    没核「真跑 seed 出来是不是这个数」。标 `[未跑·靠注释]`。
  - `ONTOLOGY-SLICE-GAPS.md` 的 42/372 同理。
  - 金值 #6/#7（`SOLVER_KEYS`=59、`ALL_SOLVER_CATALOG`=59）**是亲手静态解析源码数出来的**，属实测。
- **类别 C-2 那 9 条 autosave 分支的「真价值」未逐条定死**——需读 diff 与 wave4 对拍，超出纯文档范围。
- **类别 C-6 约 16 条零散分支未逐条验**，只给了倾向性判断，明确标注。
- **§8 存量 45 个跨文档悬空编号未逐条追**（绝大多数在 PRD/审计文档里，与本次并线无关）。

## 附录 B · 复现本单结论的命令

```bash
# ① 提交面
git rev-list --count 44a8c650..7340fdec              # 86
git diff --name-status 44a8c650 7340fdec             # 105 files
git merge-base --is-ancestor 44a8c650 7340fdec; echo "FF_OK=$?"   # 0 = 可 fast-forward

# ③ 迁移
git ls-tree --name-only 44a8c650 apps/datacore/migrations/
ls -1 apps/datacore/migrations/ apps/agentcore/migrations/

# ④ 悬空引用（§8 = SYSTEM-ONTOLOGY.md 911..1024 行）
grep -n "G-RISK-NO-DECISION-INFO" docs/SYSTEM-ONTOLOGY.md   # 只有 :466，§8 无行

# ⑤ 分支定性三层判据（注意 --verify -q，见 §5.1 的坑）
git merge-base --is-ancestor "$B" 7340fdec
git rev-parse --verify -q "7340fdec:$PATH_"          # 空 = wave4 真的没有

# R3 零生产调用方（追两层，不止 grep 一次）
grep -n "transit\|Transit" apps/frontend-shell/src/views/registry.ts   # 0 命中
grep -rn "TransitFlowLayer" apps/frontend-shell/src                    # 只有它自己
grep -rn "transit-flow" apps packages                                  # 无字符串键分发
```
