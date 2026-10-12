# PRD · 规划建议 / 方案生成（plan-generate）参考原型 1:1 复刻

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 前端+后端 |
| 取代/扩展 | 子 PRD（隶属 `PRD-reference-views-1to1-roadmap.md`，1:1=100%、色调/字体可调）· **复用 `PRD-plan-audit-1to1.md` 的 `audit_timeline` + `KsfGraph`**（HTML 注释：规划体检/规划建议共用时序引擎+KSF） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R6/R13/R14） · `docs/reference-prototype-decision-platform.html`（registry L1385 · `GEN_PATHS` L4300 · `gen3Plans`/scoring L4588 · `radarSVG` L4594 · 共享时序 L4451 · KSF L4406 · 采纳→AOP L4729 · gen AI 对话 L3497）· `apps/frontend-shell/src/views/sim/PlanGenerateView.tsx` · `apps/datacore/src/solvers/plan.ts`（:188 planGenerate · :320 paths）· `packages/contracts/src/solvers.ts:158`（PlanGenerateOutput 3 schemes） |

> 一句话：方案生成的**核心已对齐**——系统 `plan_generate` 已是「5 路径骨架 → 3 方案（稳健/均衡/进取）+ 五目标 + 硬约束 + 逐路径含⛔违规项」（契约 `PlanGenerateOutputSchema` 3 schemes）。1:1 缺口集中在：**① 共享的"问题风险传播时序（逐日圆点轴）+ 财务 KSF 图"（直接复用 audit 子 PRD 的 `audit_timeline`/`KsfGraph`）② 五维取舍矩阵/雷达图 ③ 外部信号敏感性 ④ 问题传播链 ⑤ 采纳本方案 → 下发年度情景规划台细化 ⑥ 页面级 AI 对话**。100% 1:1（色调/字体可调），数据走管线。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.E）：`Solver(plan_generate)`（已对齐，扩输出：五维取舍/外部敏感性/问题链）·`audit_timeline`/`KsfGraph`（复用 audit）·`ExternalSignal`（敏感性输入，已在）·`ActionType(采纳经营方案→下发AOP)`·`Scenario(plan_recommend)`。
- **触及链路**（§3）：`五目标(硬/软) → plan_generate(5路径代入求解器+规则 → 3方案 + 五维矩阵 + 外部敏感性 + 问题链) → 渲染(方案卡+雷达+取舍矩阵 + 共享时序圆点轴 + KSF图) → 采纳 → ActionDraft(下发年度情景规划台细化)`。
- **触及事件/数据流**（§4）：复用 useLiveSolver 即时重算；采纳走 `action.executed`（下发 AOP）。
- **触及不变量**（§5）：R14（路径/目标/敏感性/KSF 文案配置化，前端零写死）· R6（方案评分/敏感性确定）· R13（每方案数字可溯 + 问题链 因素→对象→指标/规则）· R-一致（时序引擎与产能推演/体检同源）。
- **关闭/影响断点**（§8）：同 audit——复用其"后端 series 已产、前端消费"修复，闭合时序接缝。
- **门禁**（§7）：`debattery:check`·`chain:check`（plan_generate 注册）·`ontology:check`·前端回归·FDE 亲手跑。
- **回写承诺**：plan_generate 输出扩展（五维/敏感性/问题链）→ 回写本体 §2.E。

## 1. 目标 / 非目标（1:1=100%，色调/字体可调）
### 目标
1. **核心保持对齐**：5 路径（GEN_PATHS：保毛利/保规模/扩产/外协/混合★）→ 3 方案（稳健/均衡/进取）+ 五目标（营收增速/毛利底线/份额/CAPEX上限/现金底线，硬约束 chip）+ 逐路径含⛔违规项。
2. **五维取舍矩阵 / 雷达图**：每方案 `盈利/规模/现金/增长/稳健` 五维 + `radarSVG`（HTML L4594）+ 评分（90−capex×2.2 等口径，硬违规 −15）。
3. **外部信号敏感性**：每路径对外部信号（锂价/政策/汇率…）的弹性（`GEN_EXT_SENS`），与 `ExternalSignal` 敏感性端点联动。
4. **共享时序 + KSF（复用 audit）**：每方案/问题展开「**逐日圆点轴 + 日期刻度 + 悬停日点详情 + 三档图例**」（`audit_timeline`）+ **财务 KSF 图**（问题→KSF→财务指标，问题节点点击联动时序）。
5. **问题传播链**：每方案 `GEN_FOCUS` 的"执行关键点 + 必须解决的问题（why=推演分析，chain=因素→对象→传导→指标/规则）"。
6. **采纳 → 下发 AOP**：采纳方案 → ActionDraft「下发年度情景规划台细化」（HTML "采纳本方案 → 下发年度情景规划台细化展开三情景"）。
7. **页面级 AI 对话**：gen 预设 QA（推荐哪个/三案差异/进取为何受限/看重现金选哪个）。

### 非目标
- 不改 plan_generate 评分/路径数学（已对齐，仅补五维/敏感性/问题链输出 + 共享时序/KSF 渲染）。
- 不前端写死方案/数值（取求解器）。

## 2. 现状与缺口（HTML vs 系统）
| HTML 元素 | 系统 | 缺口 |
|---|---|---|
| 五目标面板（硬约束/软偏好 chip） | ✅ | `PlanGenerateView` `TARGET_FIELDS` 对齐 |
| 5 路径 → 3 方案（稳健/均衡/进取）+ 逐路径含⛔ | ✅ | `plan_generate`/`PlanGenerateOutput` 3 schemes + paths evals 对齐 |
| 五维取舍矩阵 + 雷达图（盈利/规模/现金/增长/稳健）`radarSVG` | ◐ 需核对 | 系统有方案卡（色块），雷达/五维矩阵渲染待核对补齐 |
| 外部信号敏感性（每路径弹性 `GEN_EXT_SENS`） | ◐/❌ | plan_generate 输出/前端是否含敏感性待补（接 `ExternalSignal` 敏感性端点） |
| 问题风险传播时序（逐日圆点轴）L4451 | ❌ | 同 audit——复用 `audit_timeline` + 逐日组件 |
| 财务 KSF 图 L4406 | ❌ | 复用 audit `KsfGraph` |
| 问题传播链 因素→对象→指标/规则（`GEN_FOCUS`） | ◐ | 复用 audit 问题级 chain |
| 采纳本方案 → 下发年度情景规划台细化 | ◐/❌ | 采纳 Action「下发 AOP 细化」待接（cross-link 到 aop） |
| 页面级 AI 对话（gen 预设 QA） | ◐ | 对话坞通用，gen 预设问需对齐 |

## 3. 设计（核心保留 + 复用 audit 时序/KSF + 补 gen 专属）
### 3.1 复用 audit 子 PRD 组件（零重复造）
- 时序：每方案/问题 `runSolver("audit_timeline",{kind})` → **逐日圆点轴 + 日期刻度 + 三档图例 + 悬停日点详情**（与体检/产能推演**同一组件**，R-一致）。
- KSF：复用 `<KsfGraph>`（问题→KSF→财务指标，问题节点点击联动该方案时序）。
### 3.2 五维取舍矩阵 + 雷达图
- `plan_generate` 输出每方案 `radar:{盈利,规模,现金,增长,稳健}` + `score`（口径同 HTML scoring/`radarSVG`）；前端 `<Radar>` + 五维矩阵表（方案×维度，硬违规标⛔）。
### 3.3 外部信号敏感性
- plan_generate 输出每路径 `extSensitivity:[{signalKey,elasticity,impactPp}]`（接 `POST /a/v1/external-signals/sensitivity`）；前端"外部信号→指标"敏感性条。
### 3.4 问题传播链 + 采纳→AOP
- 每方案 `focus:{执行关键点[], 问题:[{why,chain:因素→对象→传导→指标/规则}]}`（GEN_FOCUS 口径）。
- 采纳按钮 → `POST /a/v1/action-drafts`（ActionType「下发年度情景规划台细化」）→ 跳/联动 aop 视图（cross-link）。
### 3.5 AI 对话
- gen 预设 QA（推荐哪个/三案差异/进取受限/重现金）接对话坞，答案取实时 plan_generate 数据。

## 4. 契约 / 端点
- `contracts/solvers.ts`：`PlanGenerateOutput` 扩 `schemes[].radar/score/focus`、`paths[].extSensitivity`。复用 `AuditTimelineOutput`/`KsfGraphOutput`（audit 子 PRD）。
- 端点：复用 `POST /a/v1/solvers/{plan_generate,audit_timeline}/invoke` · `POST /a/v1/external-signals/sensitivity` · `POST /a/v1/action-drafts`。

## 5. 关键流程
设五目标(硬/软) → plan_generate 出 3 方案(雷达/五维/敏感性/问题链/⛔) → 方案卡 + 雷达 + 取舍矩阵；展开问题 → 逐日圆点轴时序 + KSF 图联动 → 采纳 → 下发 AOP 细化。

## 6. 非功能（§5）
R14/R6/R13/R-一致（同 audit）；外部敏感性确定（弹性×Δ信号）。

## 7. 验收（DoD = 100% 1:1，色字可调）
- 五目标/3 方案/逐路径⛔ 保持；雷达+五维矩阵+外部敏感性 到位。
- **共享时序（逐日圆点轴+悬停+图例）与 KSF 图与体检/产能推演一致**（复用同组件）。
- 采纳 → 下发 AOP 细化 cross-link 通；gen AI 预设 QA 对齐。
- 数据走管线、前端零写死（`debattery:check`）；同输入字节一致（R6）。
- `pnpm -r build && pnpm -r test` 全绿（plan_generate 扩展 + 复用时序/KSF 回归）；`chain:check`/`ontology:check` 过。FDE 亲手跑。
- 回写本体 §2.E。

## 8. 分期
- **GEN.1** 五维取舍矩阵 + 雷达图（plan_generate 扩 radar/score + `<Radar>`）。
- **GEN.2** 复用 audit `audit_timeline`/`KsfGraph` 接入方案/问题展开。
- **GEN.3** 外部信号敏感性 + 问题传播链 + 采纳→AOP cross-link + gen AI 对话。

> 依赖 audit 子 PRD（时序/KSF 组件先行）。基线分支：前端 + plan_generate 输出扩展，冲突小。
