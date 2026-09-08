# PRD · 月度 S&OP 平衡台（sop）参考原型 1:1 复刻

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 前端+后端+生成器 |
| 取代/扩展 | 子 PRD（隶属 `PRD-reference-views-1to1-roadmap.md`，1:1=100%、色调/字体可调）· 复用 cockpit PRD 的 `MaterialBalance`/`SopVersionRow` 对象类型 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R6/R13/R14，§2.E 对象类型）· `docs/reference-prototype-decision-platform.html`（`SOP_*` 种子 L4992-5019 · `buildSOP` L5026 · 五步 `sopStep1..5` L5051-5118）· `apps/frontend-shell/src/views/sim/SopBalanceView.tsx`（737 行，五步状态机已成熟）· `apps/datacore/src/solvers/`（S1.2 月聚合 / MRP / 财务测算） |

> 一句话：系统 `SopBalanceView` 的**骨架已是 HTML 的超集**——它把 HTML 的"静态五步演示"升级为「**版本状态机 DRAFT→IN_REVIEW→EXEC_MEETING→(定稿 Action 审批)→FINAL + C22 锁定 + 逐步走求解器 + 六卡溯源**」。1:1 缺口是**四张 HTML 有、系统缺的明细表**：**① ② 需求评审缺"滚动 P90"列 ② ③ 供应评审缺"物料线 MRP 净需求表" ③ ④ 财务整合缺"量·价·本·利 科目表"（收入/销售成本/毛利 预算 vs 滚动 vs 差异）④ ⑤ 高管会缺"版本演进对比表"（V1/V3/V5/V7 dem/sup/gap/note）**。补这四表 + 把 HTML 精确种子值注入生成器（R14/R6），即 100% 1:1（色调/字体可调）。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.E）：`SopVersion`（已在，扩 step3.materials/step4.pnl/step5.versionCompare）·`MaterialBalance`（**复用 cockpit PRD 新增对象类型**：物料净需求=需求×BOM单耗−库存−在途）·`SopVersionRow`（复用 cockpit PRD：三线/科目行）·`Solver(mrp_netting/finance_pnl/capacity_rollup)`·`Rule(C06 齐套/C16 安全库存/C15 毛利线/C18 现金垫/C21 差异提报/C22 锁定)`·`ActionType(定稿月度计划版本/计划版本变更)`（已在）。
- **触及链路**（§3）：`①产品评审(PLM认证边diff→可产矩阵) → ②需求评审(三线P50/P90/实际→C21) → ③供应评审(产能线 S1.2月聚合 ∥ 物料线 MRP净需求 mrp_netting) → ④财务整合(finance_pnl 量价本利→C15/C18) → ⑤高管会(议程汇集+决议增量+版本演进对比→定稿 Action→C22锁定)`。
- **触及事件/数据流**（§4）：逐步 `advanceSopVersion` 落库；决议编辑 display 侧即时重算；定稿走 `action.executed`（写真相 R4）。
- **触及不变量**（§5）：R14（三线/物料/科目/版本明细文案与阈值配置化，前端零写死，HTML 精确值仅作生成器种子）· R6（求解器同输入字节一致）· R13（六卡 + 每表数字可溯：MRP 净需求= 需求×BOM−库存−在途 口径）· R4（定稿才写真相）· R-一致（产能口径与产能推演/驾驶舱同源 C02）。
- **关闭/影响断点**（§8）：G-5（应用层电池锁死）——本视图把 HTML 写死的 `SOP_MAT`/`SOP_FIN`/`SOP_VERS` 改为生成器派生，消一处写死。
- **门禁**（§7）：`debattery:check`·`chain:check`（mrp_netting/finance_pnl 注册）·`ontology:check`（MaterialBalance/SopVersionRow 登记）·前端回归（sop-view testid）·FDE 亲手跑五步定稿。
- **回写承诺**：MaterialBalance/SopVersionRow/mrp_netting/finance_pnl 落地 → 回写本体 §2.E + §3 链路 + §7 chain。

## 1. 目标 / 非目标（1:1=100%，色调/字体可调）
### 目标（逐表对齐 HTML）
1. **六卡 KPI 条**：需求 P50 / 可供给 / 产销缺口(>2红) / 收入预算达成% / 毛利率(vs预算) / 现金安全垫 C18 —— 系统已有，仅核对**收入预算口径**（HTML `SOP_FIN[0].bud=240`，系统默认 `revBudget=248`；统一取生成器派生预算，勿双值）。
2. **① 产品评审 · 可产矩阵变化**：3 行（转量产 4680-NCM×合肥·动力线-B +1.8；爬坡中 4680-NCM×常州·动力线-B 计认证系数；退役评审 2170-NCM×眉山·产线2 Q4 −0.9 不影响本月）+ 列「变化/型号×产线/状态/对本月供给影响/来源」+ 边界条件 hint。
3. **② 需求评审 · 三线对照**：**补"滚动 P90"列**（系统现 6 列缺 P90）→ 7 列（应用细分/目标/滚动P50/**滚动P90**/上月实际/滚动vs目标/规则）；商用车 −11.8% ⚑→C21 chip 跳⑤议程（已在）；合计行 + hint（商用车触发 C21、储能上修来自电网公司F追量、合计未过线不强制提报）。
4. **③ 供应评审 · 产能 ∥ 物料 两条线（关键缺口）**：左"产能线 基地供给"（系统已有 perBase）；**右"物料线 MRP 净需求表"（系统全缺）**——`mrp_netting` 求解器 + `MaterialBalance` 对象：列「物料/净需求/长协覆盖%/缺口/最早齐套」，3 行（三元正极 8180吨 lta92 缺654 eta06-28；隔膜 2376万㎡ lta100 无缺口；电解液 5544吨 lta96 缺222 eta06-25）+ 现货/加急 hint + "两瓶颈与决策推演大屏同源"hint（C06 口径）。
5. **④ 财务整合 · 量·价·本·利（关键缺口）**：**补"科目表"**（收入/销售成本/毛利 预算 vs 滚动 vs 差异 + 毛利率行 16.4%→16.0% −0.4pct）+ 毛利率归因 hint（储能占比 37% vs 预算 33% 拉低；单价/成本未恶化）+ C15/C18 校验（系统已有 gmRoll/cash 结果，并入表）。
6. **⑤ 高管决策会**：议程（②C21+③缺口+④越线 自动汇集，系统已有）+ 决议增量编辑器（已有，即时重算）+ **补"版本演进对比表"**（V1/V3/V5/V7：日期/需求/供给/缺口/变化备注，V7 高亮+待定稿态）+ 定稿走 Action（C10/C22，已有）。
7. **数据走管线**：HTML 全部 `SOP_*` 精确值 → 电池域生成器种子（`generatePlanDomain`），逐步求解器实算，前端零写死。

### 非目标
- 不退化系统超集（版本状态机/Action 审批/C22 锁定/六卡溯源**保留**）——HTML 静态演示是其特例。
- 不前端写死物料/科目/版本明细（取求解器/对象）。

## 2. 现状与缺口（HTML vs 系统，带 file:line）
| HTML 元素 | 系统 | 缺口 |
|---|---|---|
| 六卡 KPI 条 | ✅ `SopKpiBar` `SopBalanceView.tsx:268` | 仅核对收入预算口径（240 vs 248）统一为派生值 |
| 五步法 chips + 状态机 | ✅ 超集（HTML 无状态机/锁定） | — |
| ① 可产矩阵 3 行（含退役 EOL） | ◐ `Step1`:363 通用 changes | 注入 3 精确行 + 退役评审 EOL 语义（Q4 −0.9 不影响本月） |
| ② 三线对照 **滚动 P90 列** | ❌ `Step2`:417 仅 6 列 | **补 P90 列**（s2.rows 加 p90 字段 + 合计 P90） |
| ② C21 ⚑ → 跳⑤议程 | ✅ `onJumpAgenda` | — |
| ③ 产能线 基地供给 | ✅ `Step3`:538 perBase | — |
| ③ **物料线 MRP 净需求表** | ❌ 全缺 | **新 `mrp_netting` 求解器 + `MaterialBalance` 对象 + 右栏表** |
| ④ **量·价·本·利 科目表** | ❌ 仅 form+结果 | **新 `finance_pnl` 出科目表（收入/成本/毛利 bud/roll/diff）+ 归因 hint** |
| ④ C15/C18 校验 | ✅ `Step4`:594 | 并入科目表呈现 |
| ⑤ 议程汇集 + 决议编辑 | ✅ `Step5`:652 | — |
| ⑤ **版本演进对比表** | ❌（仅左栏版本列表） | **补 step5 内 V1/V3/V5/V7 对比表（dem/sup/gap/note）** |
| ⑤ 定稿走 Action + C22 锁定 | ✅ 超集 | — |

## 3. 设计
### 3.1 ② 补滚动 P90 列
- `advanceSopVersion(step2)` 输出 `s2.rows[].p90` + `s2.total.p90`（需求预测求解器 P90 分位，口径同 HTML `SOP_SEG[].p90`）；前端 `Step2` 表头插「滚动 P90」列、合计行加 P90。
### 3.2 ③ 物料线 MRP 净需求（最大缺口）
- 新对象类型 `MaterialBalance`（**与 cockpit PRD 同一定义，勿重复登记**）：`{material, unit, netDemand, ltaCoverPct, gap, earliestComplete}`；净需求 = Σ(需求×BOM单耗) − 库存 − 在途（C06 齐套口径、C16 安全库存）。
- 新求解器 `mrp_netting`：输入需求三线 + BOM + 库存/在途（生成器派生）→ 输出 `MaterialBalance[]`。注册进 `SOLVER_KEYS` + chain。
- 前端 `Step3` 改为左右两栏（grid 1fr 1.2fr）：左产能线（现有），右物料线表（material/netDemand/ltaCover/gap/eta）+ 缺口 hint。
### 3.3 ④ 量价本利科目表
- 新求解器 `finance_pnl`（或扩现 Step4 后端）：输出 `pnl:[{subject,budget,rolling,diff}]`（收入/销售成本/毛利）+ `gmRow:{budgetPct,rollPct,diffPp}` + `attribution`（结构归因文案：储能占比 37% vs 预算 33%）。收入=Σ(量×细分单价)，成本=BOM+制造费用（C15）。
- 前端 `Step4` 在现有 C15/C18 校验上方加科目表 + 归因 hint。
### 3.4 ⑤ 版本演进对比表
- `Step5` 拉取同月全部版本（已有 `fetchSopVersions`），渲染对比表：版本/日期/需求/供给/缺口/变化备注，当前/V7 高亮，未定稿标"（待定稿）"。`note` 取版本 `inputs.note`（生成器种子）或决议摘要。
### 3.5 数据管线（R14）
- `generatePlanDomain` 增 `sopSeed`：三线（含 P90）、5 基地供给+紧张度、3 物料 MRP、科目预算/滚动、4 版本演进——全部确定性派生（seed^hash），HTML 精确值作为电池行业默认种子配置。

## 4. 契约 / 端点
- `contracts/`：`SopVersion.steps.s2.rows[].p90`、`s3.materials:MaterialBalance[]`、`s4.pnl[]/gmRow/attribution`、`step5 versionCompare`（或前端聚合 versions）。新 `MaterialBalanceSchema`（复用 cockpit）、`MrpNettingOutput`、`FinancePnlOutput`。
- 端点：复用 `POST /a/v1/sop-versions/{id}/advance`（step3 带 materials、step4 带 pnl）· `GET /a/v1/sop-versions`（⑤对比）。

## 5. 关键流程
①PLM边diff→②三线(P50/P90/实际)C21→③产能线∥物料线MRP→④量价本利C15/C18→⑤议程+决议+版本对比→定稿Action→C22锁定。

## 6. 非功能（§5）
R14/R6/R13/R4/R-一致；MRP/财务确定（同输入字节一致）。

## 7. 验收（DoD = 100% 1:1，色字可调）
- 六卡口径统一（收入预算单一派生值）；① 3 行含退役 EOL。
- **② 滚动 P90 列到位**；③ **物料线 MRP 表到位**（3 物料口径=需求×BOM−库存−在途）。
- **④ 量价本利科目表 + 毛利率 −0.4pct 归因到位**；⑤ **版本演进对比表（V1/V3/V5/V7）到位**。
- 版本状态机/定稿 Action/C22 锁定 保留；C21→⑤议程跳转保留。
- 数据走管线、前端零写死（`debattery:check`）；同 (industry,seed) 字节一致（R6）。
- `pnpm -r build && pnpm -r test` 全绿（mrp_netting/finance_pnl + sop-view 回归）；`chain:check`/`ontology:check` 过。FDE 亲手跑五步至定稿。
- 回写本体 §2.E/§3/§7。

## 8. 分期
- **SOP.1** ② 滚动 P90 列 + ① 三行精确化（前端+生成器，小）。
- **SOP.2** ③ 物料线 MRP（`MaterialBalance` + `mrp_netting` + 右栏表）——最大块，依赖 cockpit PRD 对象类型。
- **SOP.3** ④ 量价本利科目表 + 归因（`finance_pnl`）。
- **SOP.4** ⑤ 版本演进对比表 + 全链回归。

> 依赖：`MaterialBalance`/`SopVersionRow` 对象类型与 cockpit PRD 共享（择一先落，另一引用）。基线分支：前端 + 求解器 + 生成器，冲突中等（集中在 sop + plan domain）。
