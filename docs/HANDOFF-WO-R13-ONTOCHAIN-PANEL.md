# HANDOFF · WO-R13-ONTOCHAIN-PANEL（三面板本体链 · 2026-08-18 交单）

分支：`claude/handoff-wo-r13-ontochain-panel`（自集成线 `claude/verify-reclaim-6` @ 955b8ca7 开出，`node scripts/check-branch-base.mjs HEAD` RC=0，分叉点落后集成线 0）。
提交线：`334bf6af` 占位 → `2a930094` ① 共享组件 `OntologyChainView` → `5ec3397b` ② InspectorNodePanel → `2fe29ec4` ③ SandboxConsole（+ schema 补 `evidence` + §9① 翻转）→ `bc8d161d` ④ ProjectSimView → `907135d0` ⑤ 共享组件惰性化修复 → 本单最后一笔（判据表回写 + 棘轮 tighten + 本报告）。

## ① 实测数（不是估计）

- **3/3 面板全部落地**，每个结论可点开本体链面板，**对象 / 边 / 规则三段各自独立断言**；后端没下发的段一律诚实位（`data-present="0"` + 「后端未下发」+ `gaps[]` 写明缺哪段、为什么缺）。**前端一条链都没有编** —— 所有规则公式/求解器键/对象引用均取自后端响应或面板既有真状态。
- 门 B 判据⑤ 现算：**面板文件 5 · 有对位实现 3**（`InspectorNodePanel.tsx` / `SandboxConsole.tsx` / `ProjectSimView.tsx`）；`3 × 2 > 5` ⇒ B-2 账面理由「本仓多数页无对位实现」不成立 ⇒ 核销出表。
- 新增接缝测试 **16 条**（inspector 5 · sandbox 7 · projsim 4），全绿；既有回归面逐套件串行复跑全绿（清单见 ③）。
- 各面板结论覆盖：
  - **InspectorNodePanel**：④ 下钻证据逐行链按钮（对象=`drillType.drillId.drillField`+真值、边=`derivationEdge`（空串=锚点自身 ⇒ 诚实缺位）、规则=`conversion` 公式+`solverKey`）· ① 瀑布五桶逐桶链（桶级对象/边后端未下发 ⇒ 诚实位 + gaps 指向 ④）· ③ KPI 逐行链（KPI 级对象/边未下发 ⇒ 诚实位）。
  - **SandboxConsole**：每个 impediment 一条链腿（对象=locus+证据真值、边=`evidence.derivationEdge`、规则=ruleKey/ruleParamKey/solverKey，ruleKey 为 null 时规则段诚实缺位不冒充）· 顶栏总结论链（`sc-topchain-toggle`，对象=锚点订单、边=证据派生边去重后逐条列 gaps、规则=求解器键 + 「规则码与公式原文未下发」挂账）。
  - **ProjectSimView**：判定条「本体链」按钮 ⇒ Modal（对象=Model.modelId 或选中订单 Order.so、规则=后端 `provenance.*.formula` **真值串** + `capacity_forecast`、边=诚实缺位 + `granularity=process-model` 挂账、快照随行）· KPI P50/P90/需求浮层公式改取后端 provenance（内联编造串退场，`??` 兜底保留给「响应缺该键」路径）· DAG 节点抽屉底部链段（agg/fc 取 provenance 公式；bn 取 `evaluatedRules` C03 真评估；其余节点类型三段诚实缺位 + 静态映射口径标注）。

## ② 改法与论据

1. **共享组件先行**（`apps/frontend-shell/src/components/OntologyChain.tsx`）：`OntologyChainData {object?, edge?, rule?, snapshotVersion?, gaps?}` + `OntologyChainView`。三段各带 `data-present` 与「后端未下发」缺位渲染 —— **诚实位是组件层职责**，三个接入方才不可能各编一套。
2. **组件惰性化修复（提交⑤）**：JSX children 是急切求值的 —— `<Leg present={false}>{o!.type}</Leg>` 在元素创建时就炸。改为条件构造 children（`present && o ? … : null`），三个接入方各自打的哨兵补丁全部收回，「载荷未回」真 null 路径由 sandbox 新测试第 7 条咬住。
3. **schema 补 `evidence`**（`chainLineMap.ts` 的 `ChainLossPayloadSchema` +`evidence: z.array(ChainLossEvidenceRowSchema).optional()`）：zod strip 语义原本把下钻证据剥掉，Sandbox 顶栏链的边段 gaps 无真数据可取。补键是**让真数据流进来**，不是编数据。
4. **§9① 自文档断言翻转**（`sandbox-console.seam.test.tsx` 两条）：原断言「schema 补上即红」是tripwire，本单就是补 schema 的那一单 —— 按设计翻转为「`evidence` 在解析后存活且条数不少」「提示文案已是『已接通/原样带着它/同一份来源』」。
5. **判据表回写 B-2 核销**（`docs/PRD-harness-ux-adoption.md`，六处协同改，一处都不许漏否则门红）：
   - §4.2 主表删 B-2 行 + 表后写**核销去向**（判据⑥ 要求「写明去向」）；表头与 §2.1 引言、去向引言的「4 条明账」改 3 条（带 2026-08-18 订正注记，历史段落不动）。
   - §2.1 U3 行末列去掉「→ §4.2」（否则判据②正向「账凭空消失」红）——改指 R13 验收线 + 结案记录位置。
   - §4.2.1 加三次订正注记；逐条判定表 B-2 行改写为**结案记录**；判据⑤ 口径段改写为读数史（3/0 → 5/3）并标注旧句「刻意不含 LayeredDag.tsx」已过期（WO-U3-DAG-REST 把它写进了「符合」段）。
   - 自陈「内容面机检 1/4」→「**0/3**」（判据⑦ 取 `CONTENT_CHECKED` ∩ 在册账；脚本里 `CONTENT_CHECKED={"B-2"}` 留着不动，是历史登记不是现行判据）。
   - §5 P3 行按既有 ✅ 已闭格式核销（orphan 派单行对门无害，归属栏非空保留）。
6. **棘轮重记**：`node scripts/check-harness-ux-splitaccount.mjs --tighten` ⇒ 基线 `accounts {B-1,B-2,B-3,B-4}→{B-1,B-3,B-4}` · `chain {3,0}→{5,3}`。

**论据（为什么不许前端编链，本单怎么守的）**：WO 红线「不许在前端编一条链出来（那是造第二套真相源）」。守法的机械证据是变异反证（见 ③ T1）：把规则段数据源掐掉，测试红在**规则段那一条断言**上（`data-present` 1→0），面板本身仍在 —— 证明规则段显示的就是那条真数据，不是前端常量。

## ③ T1–T5 实测输出原文

**T1 变异反证（红对地方：「面板在、规则不在」，不是「面板不见了」）**——三面板各做一次，做完还原并复绿：

- Inspector（规则段 `{formula,solverKey}` 掐空）：
  `FAIL test/wo-r13-ontochain-inspector.seam.test.tsx:127 — ontologyChain-drill-*-rule data-present 期望 "1" 收到 "0"`；同文件其余 4 条全绿（对象/边段断言未受牵连）。
- Sandbox（`ruleKey` 置 null）：
  `FAIL test/wo-r13-ontochain-sandbox.seam.test.tsx:204 — 规则段 data-present "0"` + `:240 — 「规则段没透出参数键」`；顶栏链测试同跑全绿（无交叉开火）。
- Projsim（规则段置 null）：
  `FAIL test/wo-r13-ontochain-projsim.seam.test.tsx:83 — proj-verdict-chain-rule data-present 1→0`；①b/②/③ 全绿。
- 三处还原后 16/16 复绿，工作区干净。

**T2 基线对照**：本单三张新测试在基线（955b8ca7）不存在（新文件），不适用「基线红」口径；T2 的实质证据是判据⑤ 现算差（基线 `chain {3,0}` vs 现算 `{5,3}`），方向=朝实现落地，见 ④。U5-C1 近失事件已记录：单样本跨 worktree 比对 + 负载未控 ≠ 证据，负载回落后同分支 2/2 绿。

**T3 无新增门/抽取器**：共享组件不是门；判据⑤ 的扫描面（§4.1 U3「符合」段 .tsx 抽取）零改动。

**T4 基线变化方向**：`{panels:3,withChain:0} → {5,3}`——panels 增大是 WO-U3-DAG-REST/U10 并入带进的扫描面扩大（非本单），withChain 0→3 是本单交付。方向朝实现，已 `--tighten` 显式记账（棘轮红 → 人眼过 → 重记，正是设计流程）。

**T5**：
```
out=$(node scripts/check-branch-base.mjs HEAD 2>&1); rc=$?   → RC=0（分叉点落后集成线 0）
out=$(node scripts/check-conflict-markers.mjs 2>&1); rc=$?   → RC=0
git status --porcelain                                        → 干净（本报告提交前）
```

**门（回写前负对照 → 回写后）**：
```
回写前：  RC=1 · 2 条设计内红 —— ⑤ B-2 账面理由不成立（3/5 有链）+ ⑤ 现算读数变了（跑 --tighten）
回写后：  RC=1 · 恰 1 条设计内红 —— ⑥销账：基线里有 B-2，现在 §4.2 里没有了（跑 --tighten 并在 §4.2 写明去向）
tighten：RC=0 · 基线已写（明账 3 条 · 面板文件 5 · 有对位实现 3）
复跑：    RC=0 🟢 harness-ux-splitaccount:check 通过（金丝雀 8/8）
兄弟门：  RC=0 🟢 sim-ux-criteria:check 通过（132 格 · 符合 102 · 判不了 0 · 棘轮无倒退）
```

**回归面（全部串行复跑，全绿；4 核机负载 300+ 时并发批会出现假红，单套件串行必绿——已逐套件取证）**：
`wo-r13-ontochain-{inspector,sandbox,projsim}` 16/16 · `sandbox-console.seam` 37/37 · inspector 三件套 70/70 · three-zone+config-ux 34/34 · declutter/density/view/p0 29/29 · candidates 11/11 · imp2plan+ia-consolidate 27/27 · ui-integrate 11/11 · f18+f19 13/13 · debattery/dag/adopt 4/4 · sim-ux-u1-u5 2/2 · process-live/process-mode/chain-line-map/chain-impediment 145/145 · finance-worldstate/kpi-layer/world-origin 14/14 · perturbation×2+plays 25/25 · befe×3+metro-semantics+sim-event-consumers 逐套件绿（befe-wire-d 单跑 19/19）· `tsc` TSC_RC=0。
`git diff origin/claude/verify-reclaim-6 -- packages/ apps/datacore apps/agentcore` 为空（纯前端单）。

## ④ 基线变化

`scripts/harness-ux-splitaccount-baseline.json`：`accounts` 4→3 条（B-2 出表）· `chain {3,0}→{5,3}`。经 `--tighten` 显式重记，非静默。PRD 侧变化见 ②-5（六处协同 + 去向 + 结案记录 + 自陈 0/3）。

## ⑤ 与其他 dev 的文件重叠

本单触碰：`apps/frontend-shell/src/components/OntologyChain.tsx`（新）· `views/sim/{InspectorNodePanel,SandboxConsole,ProjectSimView,chainLineMap.ts}` · `test/wo-r13-ontochain-*.seam.test.tsx`（新 ×3）· `test/sandbox-console.seam.test.tsx`（既有，§9① 两条翻转——WO 点名要求的同批动作）· `docs/PRD-harness-ux-adoption.md` · `scripts/harness-ux-splitaccount-baseline.json`。
前后各跑一次 `git log --oneline -3` 于争议路径：窗口内无其他 dev 提交落在这些文件上；`scripts/check-harness-ux-splitaccount.mjs` **只读未动**（其头部注释里 B-2 的描述自此成为历史陈述，留给门主 WO-GATE-B-SPLITACCOUNT 线处置，不越界改别人的门）。

## ⑥ 没做的部分 + 差什么（挂账 WO 草案）

**实现面余额（1 张前端单）**：
- **WO-FE-SHARED-DAG-CHAIN**：`DagNodeInspector.tsx`（四页共用面板）与 `LayeredDag.tsx`（共享组件）未链化 —— 它们今天在判据⑤ 扫描面里但无对位实现（5 面板中的另外 2 个）。差：这两处的「结论」定义要先对齐（DagNodeInspector 的事实档是 `assertDagNodeFacts` 契约，链三段往哪挂需要一次结构裁决）。**余额不影响 B-2 核销的成立**（判据⑤ 断言的是账面理由不成立，不是全仓链化率 100%）。

**后端数据缺口（8 张挂账草案，全部已在面板 gaps 里写明缺因，屏上可查处）**：
1. **WO-BE-CHAINLOSS-SUBEDGE**：`chain_loss_attribution` 响应补**桶级**（瀑布 kind）与 **KPI 级**的对象+派生边 ⇒ 闭 Inspector ①③ 两类行的对象/边段（今天：五段聚合口径不下发子段）。
2. **WO-BE-CHAINLOSS-RULE-FORMULA**：同载荷补**规则码与公式原文**字段 ⇒ 闭 Sandbox 顶栏链规则段（今天只有求解器键，gaps 原话「规则码与公式原文未下发」）。
3. **WO-BE-IMPEDIMENT-RULEKEY**：sandbox impediment 证据的 `ruleKey` 补全（今天可 null，null 时规则段诚实缺位）——不许拿「谁算的依据」冒充「哪条规则判的」。
4. **WO-BE-CAPACITY-EDGE-PROVENANCE**：`capacity_forecast` 的 `byProcessModel[].provenance` 需 `granularity=process-model` 才下发；要么默认粒度也带，要么产品裁决面板传该参 ⇒ 闭 Projsim 判定链与 DAG agg/fc 节点的边段。
5. **WO-BE-BOTTLENECK-PROVENANCE**：`bottleneck_matrix` 响应无 provenance 公式段 ⇒ DAG bn 节点规则段今天借 `capacity_forecast` 响应的 `evaluatedRules` C03 真评估顶着，gaps 已注明。
6. **WO-BE-DERIVATION-RUNS-READ**：`derivation_value_runs` 写多读少 —— 派生边真值落了库但没有读接口/不进任何面板响应 ⇒ 所有「边段」的真数据源。这张是 1/2/4 的共同前置候选。
7. **WO-BE-PROPAGATIONRULE-FORMULA**：`PropagationRule` 缺人类可读公式字段 ⇒ 规则段「公式原文」的真来源（今天能透的只有 ruleKey/paramKey/solverKey 与求解器内嵌 formula 串）。
8. **WO-BE-PERBASEROWS-BASEID**：`perBaseRows` 的 baseId 在响应路径被剥 ⇒ 基地粒度对象段（`Base.<id>` 引用）拼不出真值。

**顶回 WO 原文两处错（已按实情执行，特此登记）**：
1. WO 把 B-2 写成「U5 拆出的面」—— 实为 **U3** 的本体链面（§2.1 U3 行 + §4.2 B-2 认领 U3， census 实测 `B-2 认领 U3`）。本单回写的是 U3 行与 B-2 账，未动 U5/B-3。
2. WO 写的 tighten 目标是 `scripts/check-sim-ux-criteria.mjs` —— 实为 **`scripts/check-harness-ux-splitaccount.mjs --tighten`**（前者没有 `--tighten`，后者才是棘轮主）。已按后者执行并验证（tighten RC=0 → 复跑 RC=0 → 兄弟门 RC=0）。
