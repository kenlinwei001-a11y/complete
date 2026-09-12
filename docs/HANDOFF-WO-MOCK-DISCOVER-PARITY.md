# HANDOFF · WO-MOCK-DISCOVER-PARITY

**分支** `claude/handoff-wo-mock-discover-parity` · **画像 中**

## 收编说明（本次开工的第一件事，不是实现）

推占位时发现远端同名 handoff 分支**已存在前任 dev 的 3 个提交**
（占位 + ①②③ + ④，2026-08-17 22:46/22:57），但**基线落后**：
其 merge-base 是 `2a1a412b`（旧 merge-to-canonical 态），不含集成线 tip `955b8ca7`，
相对集成线的 diff 里会出现 65 个文件的反向删除（check-derived-recompute.mjs 等）——
即「六项证据全走完才发现基线差几千提交」那一型事故的前夜。

处置：**内容收编、基线重开**。从集成线 tip 重开分支，cherry-pick 前任的两个实现提交
（`eb69bc8e` → `39c61b89`，`350674f4` → `8483347f`；自动合并均干净，零冲突），
然后**逐条复核其内容是否满足本单判据**（见下），再跑完整 T1–T5。
cherry-pick 改变哈希，故本报告所有结论按**内容**不按哈希（仓规）。

## ① 实测数（自己跑的，非转述）

在 merge-base（`955b8ca7`）探针树上实测：

| 数 | 工单给的 | 我实测的 | 判 |
|---|---|---|---|
| 改造前 mock `discover("solvers")` 条数 | 5 | **5**（`clients.ts` 手抄字面量：capacity_forecast/affected_orders/risk_timeline/kit_readiness/yield_diagnosis） | 一致 |
| 真 A 侧论域 `SOLVER_CATALOG + COCKPIT_SOLVER_CATALOG` | 40（22+18） | **40**（22+18，python 剥注释逐条数 `key:`） | 一致 |
| `GENERIC_SOLVER_CATALOG` | 20 | **21** | ⚠ **顶回来**：工单写 20 已过期——`process_flow_time` 后补进 generic 档。该档本就不在论域内，不影响修法；以实测 21 为准 |
| A 侧三档全集 | — | **61**（22+18+21），与补齐后的 `MOCK_SOLVER_REGISTRY` 条数一致 | — |

A 侧口径原文复核（`apps/datacore/src/catalog.ts` `CatalogService.discover`）：
`items = withSolverCategory([...SOLVER_CATALOG, ...COCKPIT_SOLVER_CATALOG])`，
`return { items: query ? filtered.slice(0, 20) : filtered }` —— 论域排除 generic 档、
`slice(0,20)` 仅在带 query 时。mock 侧实现逐条对齐这两点。

## ② 改法与论据

前任 dev 的改法经复核**符合本单全部判据**，予以收编（非盲从，逐条核过）：

1. **`MockCatalogClient.discover("solvers")` 从 `MOCK_SOLVER_REGISTRY` 现算**
   （`pool !== "generic"` 过滤），弃手抄 5 条 —— 判据 ② 达成。
2. **注册表每条补 `pool` 字段**（scenario/cockpit/generic），标注 A 侧目录归属 ——
   这是「按真 A 侧口径排除 GENERIC 档」的落点。⚠ 不能用 `domain !== "generic"` 当判据：
   generic 档里混着 `domain:"decision"` 的 `process_flow_time`（注册表头注与测试 §3 均钉死这一点）。
3. **`slice(0,20)` 改为仅带 query 时**（无 query 全量）—— 照抄 A 侧「agent 上下文预算」语义，
   不自定义。
4. **parity 测试 `test/mock-discover-parity.test.ts`（5 例）**：
   - 两侧都**现算**：A 侧从 `catalog.ts` 文本用配平括号抽取器现算三档键集
     （跨 app import 源码违反 contracts-only-shared，故文本抽取；抽取失败抛错=工具坏了，
     绝不返空集冒充干净）；mock 侧真跑 `createMockDataCore().catalog.discover`；
   - 断言**集合相等**（missing/extra 差集逐个点名），不是数量相等，不写死 40；
   - 金丝雀与主判据**共用同一份抽取器**（§1 必中 capacity_forecast/cockpit_kpi/generic_inference；
     §4 反向金丝雀：assignment_optimize 在注册表全集但不得在 discover 论域）。

**为什么不是别的改法**：手抄 40 条名单 = 断点 `G-GATE-ROSTER-HANDCOPIED` 的旧病
（名单里没有的永远绿、永远漏）；写死 `toBe(40)` = A 侧加一个求解器照样绿。
现算 + 集合相等是唯一让「A 侧加求解器而 mock 不动」必红的结构。

## ③ T1–T5 实测输出

### T1 变异反证（两个方向都做了，均红对地方）

**方向一（工单指定）：A 侧加一个求解器而 mock 不动。**
向 `SOLVER_CATALOG` 头部插入 `{ key: "zz_mutation_probe", ... }`，mock 不动，跑测试：

```
× §2 mock 注册表全集 == A 侧三档并集
  AssertionError: ... expected { …(2) } to deeply equal { missing: [], extra: [] }
+   "missing": [
+     "zz_mutation_probe",
+   ],
× §3 每条 pool 归属 == A 侧目录归属  （pool="scenario"，missing: ["zz_mutation_probe"]）
× §4 接缝：discover("solvers") 候选键集 == A 侧论域现算集
✓ §5 带 query 时 slice(0,20)（不受影响，正确）
RC=1
```

红在「集合对不上，缺 `zz_mutation_probe`」——**不是**「数量不等」、不是「门崩了」。红对地方 ✓
（变异后即回滚，复跑 5/5 绿。）

**方向二（补做）：mock 侧漏接。** 把注册表 `sop_reschedule` 的 pool 从 cockpit 改成 generic：

```
× §3 pool="cockpit" 归属与 A 侧目录对不上
+   "missing": [ "sop_reschedule" ],
× §4 接缝 ... expected { missing: [ 'sop_reschedule' ], …(3) } to deeply equal { … }
  （mockCount: 39 vs aSideCount: 40 只是附带信息，主断言是 missing 集合）
RC=1
```

mock 侧掉一条同样红在「缺哪个 key」✓（变异后即 `git checkout` 回滚。）

### T2 未碰的东西有没有被弄红（merge-base 逐字对照）

本单改动会让 mock `discover("solvers")` 的返回从 5 条变 40 条，故消费方必须复核。
全仓 grep `discover(` 的测试消费方仅两家（金丝雀先行：`grep -c "discover" test/discover.test.ts` ≥1 命中，工具没瞎）：

- `test/discover.test.ts` —— 断言 `items.length > 0`、每条有 key/description、query「产能」必含 capacity_forecast（均不被候选变多打破）；
- `test/skill-ref-closure.seam.test.ts` —— 金丝雀断言含 capacity_forecast、不含假 key（同上）。

merge-base 探针树（`/tmp/base-probe-parity`，955b8ca7 + install + 两包 build）与
HEAD 树（`/tmp/wo-mock-discover-parity`）跑同一批文件，结果逐字对照：

```
BASE 侧：Test Files 2 passed (2) · Tests 16 passed (16) · BASE_T2_RC=0
         （discover.test.ts 3/3 + skill-ref-closure.seam.test.ts 13/13）
HEAD 侧：Test Files 2 passed (2) · Tests 16 passed (16) · HEAD_T2_RC=0
         （同两文件，同名同数通过）
HEAD 侧 parity：test/mock-discover-parity.test.ts 5 passed (5) · HEAD_PARITY_RC=0
```

两侧通过集合逐字相同（差异只有耗时）——本单没把任何未碰的东西弄红 ✓
（候选从 5 → 40 后，`discover.test.ts` 的「items.length > 0」「query 产能必含
capacity_forecast」与 seam 测试的金丝雀「含真 key、不含假 key」全部照旧成立。）

### T3 金丝雀正反两侧

测试内建：§1 三档必中金丝雀（capacity_forecast/cockpit_kpi/generic_inference 必中，
缺一则报「工具坏了」）；§4 反向金丝雀（assignment_optimize 必在注册表、必不在 discover 论域）。
金丝雀与主判据共用 `extractCatalogPools()` 同一份实现，不各抄正则。
另：本报告 ① 节的独立计数（python 剥注释数 `key:`）与抽取器结果一致（22/18/21），
构成第二口径对总数。

### T4 基线有没有被抬

```
git diff --name-only origin/claude/verify-reclaim-6...HEAD
→ apps/agentcore/src/mocks/clients.ts
  apps/agentcore/src/mocks/solver-registry.ts
  apps/agentcore/test/mock-discover-parity.test.ts
git diff ... -- scripts/ '*baseline*' '*ledger*' → 0 行
```

没动任何 baseline/ledger/门脚本，基线未升未降 ✓

### T5 交单前三条

（见文末「交单时刻」一节，推送前现场重跑。）

## ④ 基线变化

无。不改任何基线文件。

## ⑤ 与其他 dev 的文件重叠情况

```
git log --oneline -5 -- apps/agentcore/src/mocks/
939086cb WO-MOCKDC-SIGNATURE ② 9 处形参漂移全数补齐 + ctx/asOfEpoch/signal 真正承重
b8f5a6b7 WO-MOCKDC-SIGNATURE ① 形参对齐守卫（类型层）+ 复现 9 处漂移
2ff16e3b merge: 收编 agentcore-rename-tail（featureName 解锁·保 sim:true）
2dabe790 WO-AGENTCORE-RENAME-TAIL: featureName 两键解锁（四方原子同翻）+ 场景卡占位符改名
090e8dcf fix(agentcore): OBJECT_KEY_PROPS 40 个假属性名归位（喂给 LLM 的属性名清单 × 本体对账）
```

该目录最近 5 笔全部已在集成线历史里（本地与 `origin/claude/verify-reclaim-6`
两口径输出逐字相同）——无在飞的其他 dev 分支与本单文件重叠。

范围边界核对：本单只碰 `apps/agentcore/src/mocks/{clients,solver-registry}.ts` +
新增 `apps/agentcore/test/mock-discover-parity.test.ts`；
未碰真 A 侧 discover 行为、未碰 `apps/frontend-shell/**`、`docs/PRD-harness-ux-adoption.md`、
`apps/datacore/src/features.ts` ✓

## ⑥ 没做的部分 + 差什么

- **运行期 feature 过滤的 parity 不在本单**：A 侧 discover 会按 tenant feature 开关过滤
  （如 `plan_audit` 的 `view.plan-audit`），mock 世界 feature 全开。该半由 datacore 侧
  `catalog.test` 守，与本单互补（测试头注已声明此诚实边界）。
- **mock 注册表条目除 key/pool 外的字段**（name/description/argHints…）取自 WO-CAPMAP-LIVE
  年代的真服务返回快照，本单只钉**键集与归属**，不逐字段对拍内容漂移——若要对拍内容，
  需要一条真起 datacore 的对拍门（重画像，超出本单中画像），可派后续单。
- 主工作目录 `/Users/apple/complete` 在本次开工期间被另一 dev（WO-QUANTILE-UNIT-TWO-REDS）
  checkout 走（实测：我的测试文件在主目录「消失」，branch 被换）。本单全程在
  `/tmp/wo-mock-discover-parity` worktree 完成，不受影响。**派单方注意**：主目录共用在
  多 dev 并行时是事故源，派单模板已有 worktree 隔离要求，建议对「直接用主目录的 dev」加一道提醒。

## 交单时刻（T5 现场记录）

交单前集成线前进了 59 个提交（955b8ca7 → 10a026a4），已 rebase 到新 tip
（新增提交不碰 catalog.ts / mocks/，rebase 零冲突）；rebase 后 parity 复跑 **5/5 绿**。

```
git status --porcelain                     → 空（仅本报告入库前的 ??，提交后为空）
node scripts/check-branch-base.mjs HEAD    → RC=0（分叉点 = 集成线 tip，落后 0）
node scripts/check-merge-conflict-markers.mjs → RC=0
```
