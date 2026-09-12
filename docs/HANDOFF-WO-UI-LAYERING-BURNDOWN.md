# HANDOFF · WO-UI-LAYERING-BURNDOWN（G-UI-FIRSTLAYER-OVERLOAD 存量 burn-down · sim 侧 3 页）

- 分支：`claude/handoff-wo-ui-layering-burndown`（基线 9945e77c1 = 集成分支 `claude/verify-reclaim-6` tip）
- 范围边界遵守：只碰 `apps/frontend-shell/src/views/sim/**` 三页 + `scripts/ui-first-layer-baseline.json` 逐条改写 + 两个受影响的测试断言文件（f18 / metro-semantics，改断言是分层改动的法定随动）。
- 头号避让零触碰：`RiskBoardView`（caplive 分支 ba623ad51 正在摘它的 QaPanel）—— `git diff 9945e77c1..HEAD --stat -- apps/frontend-shell/src/views/RiskBoardView.tsx apps/frontend-shell/src/views/RiskBoardView.module.css` = **0 行**。`DataBuilderPage`（189 块，普查第 4）属 `pages/admin`，在范围边界外，未碰。

## 一、批内页面与实测前后值（全部现算，非手抄）

| 页 | first | deferred | formula | prose | sizes |
|---|---|---|---|---|---|
| ProjectSimView | 130 → **127** | 37 → **45** | 10 → **0** | 4 → **0** | 4 → 4 |
| GlobalSimView | 220 → **211** | 32 → **41** | 3 → **0** | 17 → **0** | 3 → 3 |
| SandboxConsole | 204 → **174** | 113 → **144** | 4 → **0** | 14 → **0** | 2 → 2 |

（before 值为开工时对本分支实测；基线 json 旧值 209/29、199/19、126/36 为更早登基值，why 里已交代来历。）

全仓合计（门输出最后一行）：第一层 **4175 → 4152** · 降层 **627 → 764** ⇒ 降层率 **13.1% → 15.5%**。

## 二、逐块对账（零信息丢失声明的根据：每块的旧位置 → 新位置）

凡未注明「改写」者，文案**逐字保留**在 `?` 浮层里（InfoPopover，全仓唯一浮层实现）。

### ProjectSimView（12 块）
1. 约束横幅解释句「——本页仅在既定框架内…」→ 浮层 `pm-constraint-info`；第一层留「⚠ 当前排程受全局主计划约束」。
2. 副标题六步流水+重算机制 → 浮层 `pm-sub-info`；第一层留「全局主计划框架内的细排」（`nav-ia-rename-e6` 断言前缀，未动）。「debounce 300ms · 竞态最后发出者胜」是开发话（R-UI-4），浮层内改说人话「稍作停顿后触发，以最后一次改动为准」。
3. DAG 操作提示「点击任一节点 → 看…」→ 浮层 `pm-dag-info`。
4. 瓶颈矩阵 Modal 标题「· 基地×7因素」→「· 各基地 · 7 类因素」（同义改写去公式形）。
5. 批次表页脚「净生产窗口 = 交付日 − 地址物流时长…」→ 浮层 `pm-batch-caliber`。
6. 认证徽标「认证中 ×N」→「认证中 · 系数 N」（数值留第一层，只去「×」写法）。
7. 收敛行「（按化学体系 × 基地业态推演）」→ 浮层 `pm-converge-info`；第一层留「仅在 3/13 个基地可产」（f18 断言 3/13 仍咬得到）。
8. step3 检修窗「（×0.72）」/认证「×N（认证中）」「×1.0」→「系数 0.72 / 系数 N（认证中）/ 系数 1.0」。
9. step4 合计「P90 = P50 × 0.93 = …」→ 第一层留 P50 / P90 两个结论数；公式+系数真值降浮层 `pm-step4-p90`（f18 断言随之改 hover 模式，仍咬「P90 = P50 ×」与「0.93」）。
10. 对策表列头「效果（场景求解器口径）」→「效果」+ 浮层 `pm-acts-caliber`。
11. kpi-p90 标签「P90（× 健康度 N）」→「P90 累计产能(万套)」（与 kpi-p50 对称；推导在同卡 Provenance 浮层 formula 里单源携带）。

### GlobalSimView（14 块）
1. 页头整段 intro `<p>` → 浮层 `gs-intro`。
2. 范围条「全 N 个基地 × M 个时间窗」→「N 基地 · M 时间窗」（同义改写）。
3. 旧参数横幅括号解释句 → 浮层 `gs-stale-info`；第一层留断言前缀「⚠ 参数已改 · 当前结果对应旧参数」（d5d4 断言原样绿）。
4. 三类画像 summary → 浮层 `gs-bt-info`（挂在 grpLabel 旁）。
5. L3 联动：grpLabel 的 title 长文 + 底部 summary 合并 → 浮层 `gs-l3-info`（「committedBatches」「portfolio」契约字段名/开发话在浮层内改说人话）；标签缩短为「[ L3 耦合联动推演 · 转拨联动 ]」。
6. 矩阵：grpLabel title + 颜色图例 summary 合并 → 浮层 `gs-matrix-info`；标签「[ 产能占用矩阵 · 每基地每时间窗 ]」。
7. 方法旋钮 hint → 浮层 `gs-method-info`（「methodScenario」改说人话「联合方案读数」）。
8. ε 上界 hint → 浮层 `gs-epsilon-info`。
9. 目标 vs 可达交期列口径 summary → 浮层 `gs-duecompare-info`。
10. 权衡尾句口径段 → 浮层 `gs-tradeoff-info`；结论「多按期以更高代价换取」留第一层。
11. 诚实标注「（真距离 / 供芯派生尚未接真）」口径段 → 浮层 `gs-mocknotes-info`；**诚实位主体留第一层**（规范 §4.2：它改变用户对整页读数的信任度）。
12. 分配台账标签口径段「（基地 × 时间窗 · 悬停查看数据来源）」→ 浮层 `gs-alloc-info`。
13. 守恒台账 title + 标签口径段 → 浮层 `gs-ledger-info`。
14. 「（opt.multiobj）」租户开关键名下屏（R-UI-4 开发的话不上屏）。

### SandboxConsole（13 块）
1. 画布工具条 hint 缩放段 → 浮层 `sc-canvas-ops`；第一层留「点节点 → 右栏检视」。
2. 等载荷括号句 → 浮层 `sc-chain-waiting-why`。
3. 段空态「（不是 0 天，是没有节点）」→ 浮层 `sc-lane-{stage}-empty-why`；第一层留缺席事实。
4. 扫描 0 条辨析 → 浮层 `sc-imp-jump-empty-why`；第一层留「是『扫到了，没有』」结论。
5. `ImpedimentJoinNote`（单用途组件）**内联**进既有浮层 `imp-join-gap` —— 零文案变更；它本就只在该浮层渲染，独立定义让静态门把浮层内容误数在第一层（偏保守侧修正，seam ⑤ hover 断言原样绿）。
6. `TimeWindowNote` 同理内联进既有浮层 `window`（seam `sc-window-note` 断言原样绿）。
7. 证据接通 brief 缩短为「下钻证据已接通 —— 随宿主载荷传给右栏。」（≥24 字部分的来龙去脉原就在 `inspect-evidence` 浮层，seam 断言「已接通」仍咬得到）。
8. OverlayNote：核心结论（含 seam 断言位「同一个屏上矩形」）留第一层；「不再是上下两张图/不重算几何/不假装已对齐」→ 浮层 `transit-overlay-detail`；「宽×高」→「宽 · 高」。
9. 时序分级：sec 标题括号段 + intro → 浮层 `transit-tier-why`（文案逐字保留；metro-semantics 断言改 hover 后咬同一句「被明确拒绝的画法」）。
10. ④档（节拍）：glyph 缩短「⇒ 不画节拍假象」；可见句保「由下方图层现算并自陈」（metro 断言 /图层/）；辨析 → 浮层 `transit-cadence-why`。
11. ⑤档（采购）：「口径取自契约那份唯一定义」→ 浮层 `transit-proc-why`；可见句同样保「图层」。
12. step-detail 空态完整句 → 短指引「点画布节点/Pareto柱 → 出逐环节表」+ 浮层 `sc-step-detail-empty-why`。
13. 「本表口径」字样并入既有 `step-detail` 浮层（topic「逐环节表的口径」已携带「口径」二字）。

## 三、变异反证（D4 守不守「删内容冒充分层」）

- 操作：从 `GlobalSimView` **删除**（不是移动）`gs-intro` 浮层整块。
- 结果：`node scripts/check-ui-first-layer.mjs` **RC=1**，输出点名「【D4 守恒·浮层被拆】apps/frontend-shell/src/views/sim/GlobalSimView.tsx 第二层/浮层 41 → 40（少了 1），而第一层 211 → 211 没降」（日志 `/tmp/uil-mutation.log`）。
- 恢复：`git checkout --` 后重跑 **RC=0**（日志 `/tmp/uil-gate-final.log`）。
- 结论：D4 守恒门对「删一块」当场红，且点名到文件 —— 「删内容冒充分层」此路不通，本批全部走「移」。

## 四、门与测试实测（全部亲手跑；负载声明：运行时 load 6–18 中水位；每批前 vitest 并发数实测 0）

| 步骤 | 命令 | RC |
|---|---|---|
| 全量门（PSV 收工） | `node scripts/check-ui-first-layer.mjs` | 0（/tmp/uil-gate-psv2.log） |
| 全量门（GSV 收工） | 同上 | 0（/tmp/uil-gate-gsv.log） |
| 全量门（SC 收工） | 同上 | 0（/tmp/uil-gate-sc.log） |
| 全量门（变异后恢复） | 同上 | 0（/tmp/uil-gate-final.log） |
| PSV 邻域 | `f18` 7/7 · `nav-ia-rename-e6`+`wo-r13-ontochain-projsim`+`sim-ux-u4b-u1-u8`+`f29.data-health` 20/20 | 0 / 0 |
| GSV 邻域 | glass/suite-seam/u2-stepwise-2/cockpit 29/29 · drill-seam/portfolio/l3-transfer/business-type 11/11 · multiobj/d5d4 7/7 | 0 / 0 / 0 |
| SC 邻域 | console.seam/metro-semantics/candidates 65/65 · declutter/density/kpi-layer/wo-r13-sandbox 全过 · config-collapse/config-ux/finance-worldstate/ia-consolidate 50/50 · imp2plan/nav-consolidate/process-live/process-mode/ui-integrate/sim-route-guards 80/80 | 0 |

**如实记一笔**：`sandbox-three-zone.seam.test.tsx` 2 红（扰动区 `toBeVisible` 两条）—— **线头既有**：把工作区回滚到 pristine（本单改动摘除）重跑同文件，同样 2 红（/tmp/uil-tz-pristine.log），与本单无关，归扰动/配置区在途单。
**环境记一笔**：`tsc --noEmit` 报 2 条 `datacore/src/llm*.ts` 缺 `@platform/llm-adapters` dist —— worktree 环境产物（该包未 build），本单触及的文件零 TS 错误。

## 五、基线改写纪律

三条目逐条现算重写（`scripts/ui-first-layer-baseline.json`，1 空格缩进原样保留、无整文件重排），每条 why 写明：治理动作、first/deferred 差值来源（InfoPopover topic 各计一次 · D1 结构化改造豁免：first↑ 仅伴 deferred↑）、R-UI-4 下屏清单。未跑 `--update` 全量（会把他单在途回退洗成新基线）。

## 六、并线信息

- merge-tree vs 线 tip：线 tip 仍是 9945e77c1（fetch 实测未动），是 HEAD 的祖先 ⇒ fast-forward，**零冲突**。
- porcelain：交付时 `git status --porcelain` 为空。
- 本体回写：`docs/SYSTEM-ONTOLOGY.md` §8 G-UI-FIRSTLAYER-OVERLOAD 行尾追加本批进度（门语义未变，§7 不动）。
