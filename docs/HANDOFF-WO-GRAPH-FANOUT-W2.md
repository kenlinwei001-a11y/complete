# HANDOFF · WO-GRAPH-FANOUT-W2（G-SERIAL-GRAPH-EXECUTION ⊕ G-SKILL-GRAPH-NO-RENDER-CLOSURE）

分支：`claude/handoff-wo-graph-fanout-w2`（基线 = 集成线尖 `9945e77c1`，一次性建单两断点）
落盘单元：① contracts R11/topoLayers `1ce0208ad` → ② render 节点/renderClosure/屏障 SEAM `adcad6958` → ③ executor 接线 + 两处登记 `71f3d0758` → ④ 新门+三处登记+变异 `57a0f179e` → ⑤ 本体回写 `15d68e3c5` → ⑥ 本文档（见本提交）。

## 1. GraphScheduler 定性（派单核题：真拓扑层还是空壳）

**真拓扑层，非空壳。** 证据（`apps/agentcore/src/skill-orchestrator.ts`）：
- 波前执行：`for (const layer of compiled.layers)` × `Promise.allSettled` 同层并发，`Math.max(1, graph.maxParallelNodes)` 有界分批（不许无上限，PRD §3.4）；
- 数据真沿边流：`scopeFor` 只装**祖先**输出（`ancestorsOf`），无边即 `TemplateResolutionError`——SEAM「无边即不可见」用例实测：上游已完成产物在手边，没边照样读不到；
- 失败传播：onError=FAIL（缺省）毒化全部后继（`poisonDescendants`），SKIPPED 带 `UPSTREAM_FAILED`；
- R6：`nodeResults` 按声明序归并（不是完成序）；
- 经 `POST /b/v1/skill-graphs/run`（server.ts）可达，SEAM 21 用例覆盖。

## 2. 串行 → 拓扑 行为差异清单（验收③）

executor.ts 线性循环改由 contracts `topoLayers` 给执行序（全 seq 链退化）。**逐场景核对**：

| 场景 | 旧（for…of 串行） | 新（topoLayers 全 seq 链） | 判定 |
|---|---|---|---|
| 正常 N 步执行顺序 | 声明序逐步 | 每层恰一个节点、层序=声明序 | **逐字节一致**（PRD §10 A1） |
| 每步语义（switch dispatch / emit / DENIED/BLOCK 早退 / 取消检查） | 循环体 | 循环体一字未改 | 一致 |
| **步骤 id 重复** | 后者**静默覆盖**前者的 stepOutputs/stepAudits（数据错而测试照绿） | 进循环前 `GRAPH_INVALID` **点名拒掉** | **真差异①·唯一条**——属「拒掉并点名」非退化 |
| 无 render_answer 的兜底文案 | 字面量「工作流执行完成。」 | 共享常量 `GRAPH_FALLBACK_ANSWER_MARKDOWN`（与链式合成 render 同一个家） | 文案逐字节一致，只是单一来源化 |
| 空 steps | 直接走到兜底 answer | topoLayers 空图 layers=[] → 同样走兜底 | 一致 |

图路（GraphScheduler）侧新增可见行为：`render` 节点可执行（R11 收口的执行侧）；`GraphRunResult.renderClosure` 披露 declared/synthesized；手写无 render 图从「能编译」变「422 RENDER_CLOSURE_MISSING 点名」（这是 R11 的**设计目的**，不是退化）。

邻域亲跑（本机负载高位，逐条 RC 带水位）：
- `qos-g-tools` 10/10 ✅ · `coordinator-child-degraded-bubble` + `agent-run-fanout` 10/10 ✅ · `workflow-mcp` + `platform` 10/10 ✅
- `runtime-workflow` 8/9：唯一红 = R10「3 个 READ 并行耗时 <250ms」墙钟断言（实测 484ms / 复跑 345ms，当时 **load 355→372**；同用例 `maxConcurrent≥2` 真并行判据绿；R10 路径 `agent/loop.ts` 本单**未触及**——记为**负载红**，非本单退化）

## 3. R11 可达性变异实录（验收①·强制动手）

1. 物理摘除 `compileGraph` 的 R11 收口门整段（python 切片删除，`/tmp/w2-skill-graph.ts.bak` 备份）；
2. `pnpm --filter @platform/contracts build` RC=0；
3. **门红**：`node scripts/check-graph-runtime.mjs` **RC=1**，点名「G1a：无 render 节点的手写图被放行——R11 收口门不在位（G-SKILL-GRAPH-NO-RENDER-CLOSURE 回潮）」；
4. **测试红**：contracts `skill-graph.test.ts` 同变异 **2 红**（R11 describe 的拒发点名用例 + execution.graph declared 用例）；
5. 恢复 + 重建：门 **RC=0**、契约测试 **25/25** 绿（红→恢复→绿闭环；未用 stash，/tmp 对换——多 agent 并行期 stash 共享陷阱）。

补充说明（诚实边界）：DAG 里每个节点从某个入度 0 入口恒可达，故 R11 在 DAG 上退化为「图含 ≥1 render 节点」；实现仍是诚实的自入口 BFS（不写「含 render 即过」的捷径），为将来 cond 边/多入口语义留牙。

## 4. 新门 graph-runtime:check（验收②）

`scripts/check-graph-runtime.mjs`，别名 `graph-runtime:check`，已并入 `pnpm gates` 链尾（binding=GATES_CHAIN，gate-ledger 第 100 条，provenRed=MUTATION 实录见 §3）。

- **G1（动态·contracts dist，`assertDistFresh` 前置）**：a) 无 render 手写图 ⇒ `RENDER_CLOSURE_MISSING` 且点名入口+悬空终点（「无 render 节点被拒/被披露」判据）；b) 线性来源无 render 收尾 ⇒ 合成 `__auto_render` + `renderClosure:"synthesized"` 披露 + 兜底文案与常量逐字节一致；c) **菱形依赖图**分层必须真拓扑 `[[entry],[b1,b2],[out]]` + 重复编译逐字节一致（R6）——「扇出执行序真拓扑」判据的编译期半。
- **G2（静态）**：executor 接 `topoLayers`（且从 `@platform/contracts` 引入）+ 兜底用共享常量（剥注释后不许有第二份字面量）。
- **G3（静态）**：三处扇出登记制——FANOUT-REG 集合恰为 `{graph-scheduler-wave, multi-route-parallel-solvers, coordinator-role-fanout}`，territory 四文件内每个 `Promise.all/allSettled` 前 12 行内须有标记；未登记 id 出现即红、登记缺实现即红（双向锁）。
- **G4（静态）**：render 执行侧锚点（`runRenderNode` + `kind === "render"` dispatch）。
- **金丝雀与主判据共用同一 dist 实现**（不复制）：合法图必须放行 / 抽 `entry→b2` 边分层必须变 / 两个新导出必须在位；金丝雀红退 **2**（「门没量到」≠「代码干净」）。
- 「并行真并发」判据的运行时半在 SEAM：**菱形屏障用例**（`skill-orchestrator.seam.test.ts`）——两个并行 solver 都到达屏障才放行；串行化变异 ⇒ 屏障永不会合 ⇒ BARRIER_TIMEOUT 红。**与墙钟无关**（高负载机不假性红），mutation 靶子 = 波前 `Promise.allSettled` 改逐个 await。
- roster 定性：`TERRITORY_FILES` / `FANOUT_REGISTRY` 均 criteria（判据本体/裁决结果本身），`candidateCount` 74→76 同步。

## 5. 收编 vs 分工登记（三处扇出·PRD §3.4 裁决）

**选：executor 收编（拓扑层）+ 另两处分工登记。** 不是懒，是有不可逆耦合：

- **executor.ts 线性** → **接 `topoLayers`**（全仓唯一拓扑实现，contracts 层抽出；Design T「模板推导边自动并行」被 PRD 原文否决：「任何自动分组都是猜」+ A1 逐字节不变钉死；ExtraToolStep 三类无节点 kind 映射也注定 executor 不能走 `chainGraphFromPlanSteps`）。
- **multi-route.ts 多域 `Promise.all`** → **登记**（`FANOUT-REG: multi-route-parallel-solvers`）：每路产物的 provenance 需要 GuardedToolExecutor 的**真 toolCallId**（⟦ref:N⟧ 对齐落 Answer）；GraphScheduler 图节点不经 GuardedToolExecutor，给不出真 toolCallId（render 节点诚实标 `graph-node:<id>` 正是这条差异的体现）；coupled-pair「诚实标·未链式传导」叙事与本扇出耦合。收编会同时扯断这两样。
- **Coordinator 角色扇出** → **登记**（`FANOUT-REG: coordinator-role-fanout`）：角色旁白归因靠 `current` 指针由 `step.started` **串行**推导（源码注释自述「R6 确定·无并发歧义」）；并行化即把「供应链在查什么」贴到生产头上。真并行等 W3 role-by-node（PRD §3.5-b：节点自带身份）落地后随 GraphScheduler 一并收编——§8 行尾已记为残项。

## 6. 既有红如实记账（全部经基线对换实测，非本单引入）

- `gate-roster` RC=1：剩 2 条**基线既有**未定性（`check-fact-usage:EXCLUDE_DIRS` / `check-file-truncation:PROTECTED_PATTERNS`）；基线 `9945e77c1` 对换实测同门红 4 条（含我本单两个常量未定性的瞬时态），本单收窄到 2。两条债属其他 WO，不在本单边界。
- `onto-s8-dedupe` RC=1（11 编号多行，210 行/184 唯一）与 `ontology-anchors` RC=1（3 条 LINE_DRIFT：SandboxView.tsx 两处 + server.ts solver.invoke）：基线对换实测**同红同数**，集成线既有债。
- `agentcore typecheck` 13 错全部在 `test/dsh-e2e-dualrun50.test.ts`（WO-DSH-E2E `a324ae7b4` 带入，本单未触及该文件；`pnpm --filter agentcore build` RC=0）。
- `gate-ledger` 首跑 RC=2：本 worktree `apps/datacore` dist 未构建（环境态）；`pnpm --filter datacore build` 后 RC=0。

## 7. merge-tree vs 线尖 + porcelain

- `git fetch <SSH 一次性 URL> refs/heads/claude/verify-reclaim-6` → FETCH_HEAD = `9945e77c1`（**线尖未动**=我的基线）；
- `git merge-tree --write-tree HEAD FETCH_HEAD` **RC=0**（无冲突，tree `61bb6f06c…`）；
- 提交本文档前 `git status --porcelain` 仅剩本文档新增；提交后净。
