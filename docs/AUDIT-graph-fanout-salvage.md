# AUDIT · graph-fanout 收编抢救对账（WO-GRAPH-FANOUT-W2 × 线尖 verify-reclaim-6）

- 我方分支：`claude/handoff-wo-graph-fanout-w2` @ `9e2504e0bd20638e1af33db3f72cb9bf36c8e862`（下称 **OURS**）
- 线尖：`origin/claude/verify-reclaim-6` @ `e1694f00fdfab62e83f96e37ae9660be974e92a1`（下称 **TIP**）
- merge-base：`9945e77c1b364c64252a93a536622b120d66253a`（下称 **BASE**）
- 方法：全程 `git show`/`git diff`/`git grep` 读对象，未跑任何 vitest/build（轻画像铁规）。
- TIP 已含他队两张同靶 WO：**WO-SKILL-GRAPH-RENDER-CLOSURE**（render 节点 + R11 校验）与 **WO-GRAPH-EXEC-CONSOLIDATE**（扇出 3→1 收编进 `runLayeredGraph`）。

## 0. 否定结论的金丝雀（先证明工具没瞎）

| 否定结论 | 证据 | 金丝雀 |
|---|---|---|
| TIP 无 `topoLayers` | `git grep topoLayers e1694f00` ×0 | 同批 `git grep runLayeredGraph e1694f00` 命中 20 处（`skill-orchestrator.ts:183` 等） |
| TIP 无 `__auto_render` / `AUTO_RENDER_NODE_ID` / `GRAPH_FALLBACK_ANSWER_MARKDOWN` / `renderClosure` / `FANOUT-REG` | `git grep` TIP 全 ×0 | 同上批次内 runLayeredGraph 命中 |
| TIP 无 `scripts/check-graph-runtime.mjs` | `git ls-tree e1694f00 scripts/` 无此文件；grep 仅命中文档 | 同批 `git grep -c runLayeredGraph` 非零。且 TIP 自己的审计文档坐实「门不存在」：`docs/CHECK-RT-GOV.md:131-135`（RT-072~076 全 ❌「无该文件」）、`docs/AUDIT-prd-reality-batch5.md:665`（「0 命中」） |

## 1. 逐文件三分（OURS 14 文件 delta）

### 1A. 纯重复（弃）—— 8 文件

| # | 文件 | 定性 | 符号级证据（OURS vs TIP） |
|---|---|---|---|
| 1 | `apps/agentcore/src/server.ts` | **弃** | 双方同改一处：`GraphScheduler` deps 加 `metrics`。OURS `server.ts:1564`；TIP 同位置同改动且带理由注释（TIP diff: `renderAnswer` 打点需要）。效果逐字节等价，留 TIP 版。 |
| 2 | `apps/agentcore/src/router/multi-route.ts` | **弃** | OURS 只加 `FANOUT-REG: multi-route-parallel-solvers` 注释（分工登记不收编，理由：provenance 需 GuardedToolExecutor 真 toolCallId）。TIP 把循环**真的删了**收编进 `runLayeredGraph`（TIP `multi-route.ts:4` import、`:222` 调用），`runNode` 体内仍调 `ctx.executor.run("invoke_solver",…)`——toolCallId  provenance 原样保住，我方「收编会扯断 provenance」的前提被其实测证伪（TIP `graph-exec-consolidate.seam.test.ts` T2「multi-route continue」用例，answer.provenance.length===3 断言）。 |
| 3 | `apps/agentcore/src/router/orchestrator.ts` | **弃** | OURS 加 `FANOUT-REG: coordinator-role-fanout` 登记（三处扇出之③）。TIP 本体订正了花名册：**Coordinator 根本不是独立扇出**——`runCoordinator` 只 `buildDispatchSteps` 后交 `engine.runWorkflowSteps → runWorkflow`，跑的就是 executor.ts 串行循环（TIP `docs/SYSTEM-ONTOLOGY.md` §8 G-SERIAL-GRAPH-EXECUTION 2026-08-20 订正段，实测 (a)(b) 两条）。登记一个非扇出 = 登记表建在错的名册上。我方「角色归因赖串行步指针」的观察本身仍成立（TIP 同样未并行化 Coordinator），但它不构成一个待登记的扇出点位。 |
| 4 | `apps/agentcore/src/skill-orchestrator.ts` | **弃（主体）** | ① render 节点执行：OURS `runRenderNode`（`:361`，自建投影：`summarizeSolverOutput` + `prov_<nodeId>_<i>` + `toolCallId:"graph-node:<fromNode>"`）；TIP `runRenderNode`（`:525`）**复用 executor 同一个 `renderAnswer`**（`executor.ts` 导出化，TIP diff 头注引 PRD §3.1「复用今天 executor 的同一 switch 体」），并配 `StepAudit`/`visibleAudits` 溯源链（`runSolverNode` 返回 `{output, audit}`）。TIP 版与线性路渲染实现是同一份代码，我方是「同语义第二份」——正是两边各自头注都写的禁物。② `renderClosure` 透传（OURS `:76/:224`）依附于抢救件②，见 1B。③ `FANOUT-REG: graph-scheduler-wave` 注释随登记制一并弃（见 1B-③）。 |
| 5 | `apps/agentcore/test/skill-orchestrator.seam.test.ts` | **弃（主体），挖出 1B-④** | OURS +181 行中：R11 HTTP 422 点名用例 ≈ TIP `skill-graph-render-closure.seam.test.ts:142`（同码同 HTTP 落点）；render 执行断言 ≈ TIP 同文件 T4 `:165`（「求解器真值流进 render 并带 provenance」，比我方更强：走真 renderAnswer）；fromNode 可见性用例 ≈ TIP `:265`（「render 只看得见祖先」）。唯一 TIP 没有的：菱形屏障真并发用例（见 1B-④）与 synthesized 披露断言（依附抢救件②）。 |
| 6 | `packages/contracts/test/skill-graph.test.ts` | **弃（主体）** | OURS +149 行 R11 用例集（无 render 拒/可达放行/门序）与 TIP +188 行用例集同靶；TIP 更严：`:83` T3「有 render 但链汇不进去 → 拒」（咬可达性不咬存在性）、`:103` T3' 加一条边由拒转通（可达性是唯一变量）、「两个 render → 拒」。OURS 独有的合成/披露/`__auto_render` 撞名用例依附抢救件②。 |
| 7 | `docs/SYSTEM-ONTOLOGY.md` | **弃（以 TIP 为基回写）** | 双方同段改 R11/扇出条目（真冲突源）。TIP 版信息更新更全：§8 G-SKILL-GRAPH-NO-RENDER-CLOSURE 已闭（含 38 次编译/16 张全废实测、生产侧存量图=0 的结构性证明）、G-SERIAL-GRAPH-EXECUTION 部分闭（4→2 + 花名册订正）。抢救件落地后按 TIP 版回写对应行。 |
| 8 | `docs/HANDOFF-WO-GRAPH-FANOUT-W2.md` | **弃（现状文档），分析已吸入本文** | OURS 独有（TIP 无此文件），但其核心决策「三处扇出分工登记不收编」已被 TIP 的实测收编（multi-route/execute-plan）与花名册订正（Coordinator 非扇出）推翻；保留原文 = 在 docs 里留假账。其仍成立的独有分析（角色归因串行指针、菱形屏障法）已吸收进本文 §1C/§2。 |

### 1B. 真增量（抢救）—— 4 文件 + 2 个混合文件内的抢救件

#### ③ 新门 `scripts/check-graph-runtime.mjs`（213 行）+ 三处登记 —— **抢救（条件改写）**

- **线尖真的没有吗**：没有（§0 金丝雀）。且这不是「他队用别的方式做了」——TIP 自己的审计文档把这门记成**欠账**：`docs/CHECK-RT-GOV.md:131-135` RT-072~076 五条全 ❌「门不存在」，`docs/AUDIT-prd-reality-batch5.md:665`「0 命中」；PRD `docs/PRD-skill-runtime-orchestrator.md:700` W2 范围本就列着 `scripts/check-graph-runtime.mjs（新建）`。**这是 PRD 计划内、线尖确认缺失的工件，我方是唯一交付者。**
- **抢救后挂到哪**：门本体可挂，但四条判据对我方设计有耦合，须按裁决结果改写：
  - **G1a**（无 render 拒发点名，动态·contracts dist）：与 TIP `assertRenderClosure`（`skill-graph.ts:217`）完全兼容，**直接可留**（断言码 `RENDER_CLOSURE_MISSING` 两边同字）。
  - **G1b**（线性合成收口 + `renderClosure:"synthesized"` 披露）：依附抢救件②；②弃则删。
  - **G1c**（菱形图分层真拓扑 + R6 字节等价）：纯 contracts 动态判据，与实现归属无关，**直接可留**。
  - **G2**（executor 接 `topoLayers` + 兜底文案共享常量）：依附裁决点①；裁「agentcore 内化」则删，裁「contracts 下沉」则原样成立。
  - **G3**（FANOUT-REG 三键登记制）：**与 TIP 世界观正面冲突**——TIP 的看护是 `graph-exec-consolidate.seam.test.ts` T3（`:199`，现算 agentcore src 全部并发派发站点并逐文件具名对账，vitest 层），且其三键中的两键（multi-route/coordinator）在 TIP 里一个已收编、一个被订正为非扇出。改写方向：G3 删掉或改成「门层复核 T3 站点计数表仍与现实一致」；不复写登记制。
  - **G4**（`runRenderNode` + dispatch 分支锚点）：TIP `skill-orchestrator.ts:525` 在位，**直接可留**（锚点正则两边都中）。
- 随行登记物：`scripts/gate-ledger.json` 第 100 条（OURS 新增 `check-graph-runtime.mjs` 条目，provenRed 变异实录引的是我方 R11 门——TIP 世界同样可复现该变异，但 evidence 文字须按改写后判据重录）；`scripts/gate-roster-baseline.json` 两条 criteria（`TERRITORY_FILES`/`FANOUT_REGISTRY`，须随 G3 改写重定性；注意 TIP 已重写整个 roster +323/-303，须以其为基）；`package.json` 别名 `graph-runtime:check` + gates 链尾追加（TIP 未动 package.json，此改动零冲突，随门存废）。

#### ④ SEAM 菱形屏障真并发测试 —— **抢救（近乎可直接移植）**

- **线尖真的没有吗**：GraphScheduler 级的真并发证明没有。TIP 的并发证明在 `runLayeredGraph`/路由层（`graph-exec-consolidate.seam.test.ts` T1 `:326`，`peakInFlight` 探针：multi-route 峰值 3、execute-plan 峰值 2、concurrency=1 退化峰值 1）；TIP 的 orchestrator seam 菱形用例只断言**分层分组**（`solveA/solveB` 同层），不断言同层真的同时在飞。OURS 的屏障用例（seam test 尾部 +~110 行）钉的是 `GraphScheduler.run` 整链：mock dataCore 里两个 `barrier_probe` 必须**会合**才放行，串行化变异 ⇒ `BARRIER_TIMEOUT` 红——与负载无关的判据，变异反证天然成立。
- **抢救后挂到哪**：TIP 的 `GraphScheduler.run` 已改走 `runLayeredGraph`（capture 分支），屏障判据不变（同层分批并发仍经 `Promise.allSettled`）；移植只需挂到 TIP 的 seam 文件、`GraphScheduler` deps 补 `metrics`（TIP 已必填）。这是 T1 探针法覆盖不到的一层：**调度器对外契约级**的真并发（T1 钉的是核心函数与两个路由消费方）。

#### ② `__auto_render` 合成 + `renderClosure:"synthesized"` 披露 —— **条件抢救（政策分叉，须仓主点头）**

- **线尖真的没有吗**：没有（§0 金丝雀）。且方向相反：TIP 对「线性来源没有 render」的选择是**拒**——`assertRenderClosure` 报 `RENDER_CLOSURE_MISSING` 并给出可操作的修复指引（`skill-graph.ts:228-236`「请补一个 kind="render" 的节点…」）；OURS 的选择是**合成兜底收尾 + 披露**（`skill-graph.ts:489` `AUTO_RENDER_NODE_ID`、`:496` `GRAPH_FALLBACK_ANSWER_MARKDOWN`、`:544-562` 合成 + 撞名拒、`:580` `CompileExecutionResult.renderClosure` 字段；executor 兜底文案收编为共享常量 `executor.ts:354`；调度器透传 `skill-orchestrator.ts:76/:224`；seam 断言 `source=legacy.plan.steps → synthesized`）。
- **抢救后挂到哪**：挂点明确——TIP 的 `chainGraphFromPlanSteps` 同名同位置，尾部加合成段；`CompileExecutionResult` 加字段；`GraphRunResult` 加字段；server 透传；executor 字面量换常量。但要诚实指出**必要性被两面削弱**：(a) 线性主路上 `validate.ts:99-100` 本就强制「计划必须包含 render_answer 且为最后一步」（BASE 既有，双方均未改），会走到合成的只剩绕过 `validatePlanSteps` 的调用形态（我方 seam 证明 `legacy.plan.steps` 直连路由确实会走到）；(b) TIP 的拒绝报文不是死路，修复指引具体。这是一对**互斥政策**（拒 vs 合成+披露），不是可叠加的两份功能——故列为「条件抢救」：仓主若选拒，本件连 G1b、contracts 合成用例 3 条、seam 披露断言一并弃。

### 1C. 裁决点（上仓主）—— 2 文件承载

`packages/contracts/src/skill-graph.ts`（OURS `topoLayers:187` + compileGraph 委托）× `apps/agentcore/src/workflow/executor.ts`（OURS `:112` 消费 topoLayers） vs TIP `runLayeredGraph`（`skill-orchestrator.ts:183`）。

## 2. 裁决点分析：`topoLayers` vs `runLayeredGraph`

### 2.1 先纠一个框架偏差：两者不在同一层

读两边实现后确认，这不是「同目标双机制」的纯二选一：

- **`topoLayers`（OURS，contracts）= 拓扑计算层**：无 kind 最小输入 → id 查重/悬空边/三色 DFS 环检测（可读环路径）/Kahn 波前分层/前驱表。**纯函数，不执行任何东西。**它是把 BASE 里 `compileGraph` 内联的那段拓扑代码**原样抽出**（逐行同源），再让 `compileGraph` 委托它，并开放给 executor 消费。
- **`runLayeredGraph`（TIP，agentcore）= 派发骨架层**：吃**现成的** layers（自己不计算拓扑），管层内分批有界并发、`onNodeThrow`（propagate/capture）、`settle`/`isSkipped` 策略钩子。**它不替任何一方算层。**

两者**可以分层共存**：`compileGraph`（内部走 topoLayers）出 layers → `runLayeredGraph` 派发。真正的重叠点只有两处：

**(a) Kahn 实现份数。** TIP 世界：Kahn 只有一份，内联在 `compileGraph` 里（BASE 原件未动）。OURS 世界：Kahn 也只有一份，抽成 `topoLayers`，`compileGraph` 委托。**两边各自都守住了「唯一拓扑实现」**；合并时只要不既抽又留（双份 Kahn），两种摆法都成立。语义等价性：同源同算法——层序=声明序（R6）、环=三色 DFS 可读路径、重边去重、悬空边点名，逐行来自同一段 BASE 代码，无行为差。

**(b) executor 线性执行序怎么来。** OURS：`executor.ts:112` 把 steps 编成全 seq 链喂 `topoLayers`，按展开序跑旧循环——换来的**唯一真行为差异**是「步骤 id 重复」从循环内静默互相覆盖（后者盖前者的 `stepOutputs/stepAudits`）变成进循环前 `GRAPH_INVALID` 点名拒掉。TIP：`executor.ts` 一字未动这条循环（他队收编的是 multi-route/execute-plan 两处**并发**循环，线性执行器**刻意未收**，三条机器可核阻碍写进本体：早退带值三处/步间共享可变作用域/步类型 8:2 不重合——注意这三条阻碍针对的是「收编进分层调度器」，我方改动**不是**那种收编，只是执行序改由拓扑派生，串行循环体原样）。

### 2.2 测试覆盖对比

- topoLayers 路径（OURS）：contracts 测试 25 例绿（含菱形分层/R6 字节等价/合成披露）；门 G1c 动态判据钉菱形分层真值；executor 行为等价由 PRD §10 A1 宣称 + 全 seq 链退化的构造性论证（每层恰一个节点 ⇒ 展开序=声明序）。
- runLayeredGraph 路径（TIP）：`graph-exec-consolidate.seam.test.ts` T1（峰值并发 3/2/1 探针）+ T2（poison/continue/propagate/capture 四策略逐条与收编前一致）+ T3（站点计数对账）；contracts 侧 R11 8 例 + HTTP 2 例 + T4 端到端 3 例 + T5 存量 2 例。
- 合并后若两套共存：双方测试互不咬（一个测计算层，一个测派发层）。

### 2.3 合并成本方向

- **contracts 下沉（留 topoLayers）**：改动小——TIP `compileGraph` 内联拓扑段换成委托（~40 行挪动，错误码/文案全同源），executor 接 topoLayers（我方 diff 原样可移）。收益：executor 获得「重复步骤 id 点名拒」这条真改进；拓扑实现有 contracts 级导出名，未来 W3/W4（cond 边/dependsOn 内联）有公共挂点。代价：contracts 公共 API 面 +1，审核口径要加一条。
- **agentcore 内化（弃 topoLayers）**：executor 回退 `for…of`（BASE 原样），contracts 留 TIP 内联 Kahn。收益：公共 API 面不扩，executor 零改动零风险。代价：放弃重复 id 拒覆盖（静默覆盖继续）；「拓扑只许一份」无门钉（我方 G2 随弃）。

### 2.4 裁决问句（一句）

> **executor 线性执行序要不要拓扑派生？**——留 `runLayeredGraph` 为唯一派发骨架（此点无争议）之余，`topoLayers` 是下沉 contracts 作唯一拓扑计算并顺手拒掉「重复步骤 id 静默覆盖」，还是连它带 G2 一起弃、executor 维持 `for…of` 现状？

## 3. 抢救清单

### 若仓主裁「留 runLayeredGraph + 弃 topoLayers」（agentcore 内化）

1. `scripts/check-graph-runtime.mjs`：删 G2、删 G1b（若②同弃）；G3 改写为「复核 graph-exec-consolidate T3 站点表与现实一致」或整段删（T3 已在 vitest 层守同一件事）；G1a/G1c/G4 保留，锚点重指 TIP 符号（`assertRenderClosure`/`runRenderNode` `skill-orchestrator.ts:525`）。
2. `scripts/gate-ledger.json` 第 100 条：以 TIP 版 ledger 为基重插，provenRed evidence 按改写后判据重录变异实录。
3. `scripts/gate-roster-baseline.json` 两条 criteria：以 TIP 重写后的 roster 为基，`FANOUT_REGISTRY` 条目随 G3 改写重定性或删，`candidateCount` 相应改。
4. `package.json`：别名 + gates 链尾追加可原样移植（TIP 未动此文件）。
5. 菱形屏障用例：移植进 TIP `skill-orchestrator.seam.test.ts`（deps 加 `metrics`），或在 `graph-exec-consolidate.seam.test.ts` 加 T4 调度器契约级并发。
6. 若②获留：`chainGraphFromPlanSteps` 尾部合成段 + `CompileExecutionResult.renderClosure` + `GraphRunResult.renderClosure` + server 透传 + contracts 合成用例 3 条 + seam 披露断言 2 条 + executor 字面量换 `GRAPH_FALLBACK_ANSWER_MARKDOWN`；并恢复门 G1b。
7. 弃件不移植：我方 `runRenderNode` 自建投影、FANOUT-REG 三处标记、HANDOFF 文档、ontology 我方版、contracts/seam 测试中重复部分。

### 若仓主裁「留 topoLayers」（contracts 下沉，与 runLayeredGraph 分层共存）

1. 他队代码要改的仅一处：TIP `compileGraph` 内联拓扑段（`skill-graph.ts` Kahn/DFS/前驱表）改为委托 `topoLayers`——**防双份 Kahn**；其 R11 `assertRenderClosure` 段原样保留。
2. executor 接 topoLayers（OURS diff 原样）：重复步骤 id 由静默覆盖变 `GRAPH_INVALID` 点名——需向他队确认无存量工作流依赖重复 id（结构性判据：依赖重复 id = 依赖静默覆盖，本身即是 bug 形态）。
3. `runLayeredGraph` 及其 T1/T2/T3 测试**一行不动**（不同层）。
4. 门 G2 原样成立；其余同上行清单 2-6。

---

对账人：轻画像对账 agent（worktree agent-a227970a3fc4175d1）· 2026-08-20 · 全部结论可经 `git show/grep` 复核，未跑测试。
