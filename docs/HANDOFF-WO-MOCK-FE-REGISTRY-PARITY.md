# HANDOFF-WO-MOCK-FE-REGISTRY-PARITY · 前端 mock 求解器词表与真 A 侧对齐

分支：`claude/handoff-wo-mock-fe-registry-parity`（长在 `origin/claude/verify-reclaim-6` = 1c29a532）
画像：中（frontend vitest）。范围：`apps/frontend-shell/**` 仅此一处；未碰 `apps/datacore/**`、`apps/agentcore/**`。

## 1. 修前后对照

**病灶**：`apps/frontend-shell/src/mocks/handlers.ts` 内联手抄 4 条 `MOCK_SOLVER_REGISTRY`
（capacity_forecast / bottleneck_matrix / selection_optimize / order_fullchain），一身二役：

| 消费方 | 修前 | 修后 |
|---|---|---|
| `GET /a/v1/solvers/registry`（发现页数据源） | 手抄 4 条（元数据漂移：outputShape 与真注册表不一致） | 从 61 条全集镜像按策展 key **派生**（`SOLVER_DISCOVERY_DISPLAY_KEYS` 只是展示选择；条目逐字段 = 全集镜像同 key 条目，pool 不下发） |
| `POST /b/v1/skills/:id/publish` 引用存在性探针 | 拿同一份 4 条判「哪些求解器真的注册了」 | `MOCK_KNOWN_SOLVER_KEYS` = 全集 `filter(pool !== "generic")` **现算 40 条**，与真后端 `probeMissingRefs`（`apps/agentcore/src/resources.ts`）走的 `discover("solvers")` 论域（`SOLVER_CATALOG` 22 + `COCKPIT_SOLVER_CATALOG` 18）同口径 |

行为接缝（`test/skill-publish-probe-parity.seam.test.ts`，真打 MSW HTTP）：

| 案例 | 修前 | 修后 | 真后端 |
|---|---|---|---|
| 引用 `kit_readiness`（真 40 条之一，旧 4 条没有） | **422 误判死路** `求解器「kit_readiness」在 DataCore 未注册`（红①） | 200 + 落库 PUBLISHED | 放行 |
| 引用 `selection_optimize`（GENERIC 档，不在 discover 论域） | **200 放行**（红②：本地绿线上红） | 422 + 未落库 | 拒 |
| 引用 `ghost_solver_本单探针` | 422 | 422 | 拒 |

修前红的原文证据（2026-08-18 11:34 跑，`--maxWorkers=1`）：

```
AssertionError: ... + "code": "SKILL_REF_UNRESOLVED",
+ "message": "技能引用存在死路（1 项，发布被拒且未落库）：求解器「kit_readiness」在 DataCore 未注册",
+ "status": 422,
② AssertionError: mock 不得比真后端松：...: expected 200 to be 422
Test Files  1 failed (1) · Tests  2 failed | 2 passed (4)
```

修后：`Test Files 2 passed (2) · Tests 9 passed (9)`（ parity 5 + 行为 4）。

**新文件** `apps/frontend-shell/src/mocks/solverRegistry.ts`（2003 行）：61 条全集镜像 +
`pool` 归属字段 + 两个派生出口。数据与 agentcore 侧 `mocks/solver-registry.ts`
（WO-MOCK-DISCOVER-PARITY 已验收形态）同源——真实注册表返回的逐字段镜像，脚本机械抽取
（`/tmp/extract-fe-registry.mjs` 金丝雀：61 条、三档 22/18/21、已知必中 key 全中），零手敲字段。
跨 app import 源码违反 contracts-only-shared，故前端持自己一份替身，防漂移靠 §2 的测试不靠纪律。

## 2. 判据形态

`test/solver-registry-parity.seam.test.ts`（两边都**现算**，断言**集合相等**不写死数字）：

- §1 金丝雀：抽取器自证没瞎（已知必中 key × 3 档 + 镜像侧自证 + 档间不相交）。
- §2 mock 全集键集 == A 侧三档并集（61）——发现页全量集与真 catalog 的集合关系是**相等**，
  不是 ⊆ 留白（无差集需要逐条说明）。
- §3 每条 `pool` 归属 == A 侧目录归属（`process_flow_time` 在 GENERIC 档却 `domain:"decision"`
  ——domain 不能当论域判据的实测例外，按 pool 判）。
- §4 探针词表 == A 侧 discover 论域现算集（scenario+cockpit，排除 generic 档；含反向金丝雀
  「selection_optimize 在全集但不在探针词表」证明过滤真的在滤）。
- §5 发现页 seam：真打 `GET /a/v1/solvers/registry`，下发的恰是策展 4 条且逐字段等于全集镜像
  同 key 条目（剥 pool 后 deep-equal——证明「派生」不是「第二份手抄」）；`GET /a/v1/solvers/categories`
  论域同源（total=4、uncategorized=[]、成员并集恰好覆盖展示子集）。

A 侧词表获取方式：catalog.ts **文本抽取器**（剥注释→配平数组→顶层逗号切分→逐条抽 key；
抽不出来抛错「工具坏了」，绝不返回空集冒充）。与 agentcore 侧 parity 测试同算法，
用前端自己的 `test/factlock.ts` 的 `stripComments`（字符串感知版）。

## 3. 金丝雀证据

- 金丝雀与主判据**共用同一份 `extractCatalogPools()`**（§1 抽一遍，§2–§4 用同一结果），不各抄一份正则。
- §1 全绿（修后跑）：`pools.scenario` 含 capacity_forecast、`pools.cockpit` 含 cockpit_kpi、
  `pools.generic` 含 generic_inference、mock 全集含 capacity_forecast 与 process_flow_time、
  scenario∩cockpit = ∅。
- 行为文件自带夹具金丝雀（`seedSkillReferencing` 自证只引一个 solver）。
- 否定结论「既有消费方无回归」的佐证：受影响套件（rules-classify /
  admin-closure-solvers / befe-e-solver-governance / skill-studio / skill-compile-seam /
  solver-scope-honesty / references-family）全绿——见 §6 附跑。

## 4. 变异反证（两遍，亲手做）

**变异① · 往真 A 侧注入 mutant key**（`catalog.ts` 的 `SOLVER_CATALOG` 首条注入
`mutant_solver_z9`，跑 `solver-registry-parity`，随后 `git checkout` 还原）：

```
× §2 → expected { …(2) } to deeply equal { missing: [], extra: [] }
       + "missing": [ "mutant_solver_z9" ]
× §3 pool="scenario" → + "missing": [ "mutant_solver_z9" ]
× §4 探针词表 → + "missing": [ "mutant_solver_z9" ]
✓ §1 金丝雀仍绿（工具没坏，红的是真漂移）
Tests 3 failed | 2 passed (5)
```

**变异② · 从 mock 全集删一个 key**（`solverRegistry.ts` 删 `kit_readiness` 条目，61→60，
跑同一文件，随后 `git checkout` 还原）：

```
× §2 → expected { missing: [ 'kit_readiness' ], …(1) } to deeply equal { missing: [], extra: [] }
× §3 pool="scenario" → 同点名 kit_readiness
× §4 探针词表 → 同点名 kit_readiness
✓ §1 金丝雀仍绿
Tests 3 failed | 2 passed (5)
```

**还原后转绿**：两文件 `git checkout` 还原（`grep -c '"key"' solverRegistry.ts` 回到 61，
`git status --porcelain` 干净），重跑两新文件：`Test Files 2 passed (2) · Tests 9 passed (9)`。
两次变异的红都**精确点名缺/多的 key**，不是数量不等；金丝雀两次都绿 ⇒ 红不是工具坏。

## 5. 界外发现

1. **真后端 `probeMissingRefs` 的 solver 论域 = `discover("solvers")`（scenario+cockpit 40），
   不含 GENERIC 档 21 条**——即技能引用 `selection_optimize` 这类通用求解器在**真后端**也会被
   422 拒掉。generic 档经 `mcp__solvers__{key}` 对 Agent 公开、能真跑，却不算「已注册」，
   这可能是真后端自己的病灶（论域选错出口：或许该走 `solverRegistry` 全 61）。本单按
   「mock 镜像真后端现状」处理并在行为测试里钉死该口径；是否改真后端论域超出本单范围
   （`apps/agentcore/**` 归 WO-MOCK-DISCOVER-PARITY 线），建议立项核查。
2. `handlers.ts` 的 `GET /a/v1/solvers/categories` 里 `MOCK_CATEGORY_OF` 仍是 4 条手抄归类
   （key→category）。真后端的归类表 `SOLVER_CATEGORY_MAP` 在 datacore 侧不可 import；
   现机制靠 `uncategorized` 诚实亮出 + 本单 §5 断言「并集恰好覆盖展示子集」兜底，
   展示位新增 key 未归类会当场红。未顺手改（不在本单边界）。
3. 发现页 mock 响应与真后端形状差：真后端每条带 `category` + `ontologySignature`，mock 没有
   （既有偏差，本单未扩大也未修）；mock 内部 `pool` 字段不下发（本单新增的自控）。

## 6. 前置门 RC

| 门 | 结果 |
|---|---|
| `pnpm install --prefer-offline` + `pnpm --filter @platform/contracts build`（worktree 前置） | RC=0 |
| 修后两新文件（parity 5 + 行为 4） | 9/9 绿（`--maxWorkers=1`） |
| 受影响既有套件 7 文件（rules-classify / admin-closure-solvers / befe-e-solver-governance / skill-studio / skill-compile-seam / solver-scope-honesty / references-family） | 56/57 绿；唯一红 = solver-scope-honesty 方向①，**基线同红**（见下） |
| `node scripts/check-branch-base.mjs origin/claude/handoff-wo-mock-fe-registry-parity --onto=origin/claude/verify-reclaim-6` | RC=0（分叉点 1c29a532，落后 53 < 200） |
| `node scripts/check-merge-conflict-markers.mjs` | RC=0（2216 文件零标记，金丝雀 7/7） |
| `git status --porcelain`（交单前） | 空 |
| `pnpm --filter frontend-shell typecheck` | RC=0（前置坑：首跑红在 `@platform/llm-adapters` 缺 dist——前端既有测试直引 datacore/src（certification/features/portfolio 等先例）连带解析到 llm.ts；`pnpm --filter @platform/llm-adapters build` 后全绿，与 contracts dist 同族环境假红） |
| 定向 eslint（4 个改动文件） | RC=0 |

门 2 口径说明：派单字面命令 `check-branch-base.mjs wo-mock-fe-registry-parity` 解不开引用
（脚本 RC=2「工具坏了」自报，不许读作基线没问题）；按脚本提示改用可解引用
`origin/claude/handoff-wo-mock-fe-registry-parity` 重跑得 RC=0。

**方向① 基线红的 A/B 证据**（非本单引入，未顺手修）：同一 worktree、同一命令单跑
`solver-scope-honesty.seam.test.tsx`——基线版 handlers.ts（`git show 1c29a532:...` 换入）
`1 failed | 9 passed`，本单修复版还原后同样 `1 failed | 9 passed`，失败签名一致
（`Unable to find element [data-testid="scope-honesty-risk-timeline"]`，~17s 超时；
同文件方向①变体 10.4s 通过）。判读：方向①是文件内第一个冷加载 `/v/risk` 视图的用例，
当前机器高负载（实测 14 个 vitest 进程并存）把冷加载顶过 15s `asyncUtilTimeout`；
负载敏感型基线红/抖，与本单 diff 无关。既有套件里另一次「2 failed」为重试噪声
（方向② 13.6s 贴线，更卡时翻红），单跑跑全同样仅方向①红。

**动手前后 `git log --oneline -3 -- apps/frontend-shell/src/mocks/handlers.ts` 对照**：

- 动手前（集成线 1c29a532）：`6160f33c` 扰动因素切片卡片化 / `bf7727e1` 收编 title-divergence /
  `d47b867e` 收编 step-template-layer。
- 动手后（本分支）：`b8198d73` 本单提交 / `11dcab9b` / `4c14e115`（后两条为集成线既有提交）。
- 冲突面实测：`git diff 1c29a532..origin/claude/verify-reclaim-6 --stat -- handlers.ts mocks/ catalog.ts`
  **空**——集成线新推进的 53 个提交未碰本单同片区（沙盘单未落 handlers.ts）。
