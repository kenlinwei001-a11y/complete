# 施工单 · item 1/2/3 设计落地（审核方→开发 agent·可直接照做）

> 把审核方三项设计/定位**落成 dev 可 100% 照做的施工单**（含改哪些文件:行、具体改动、契约形状、FDE 真值判据、边界）。架构思路见各自母单：item1 `REVIEW-hollow-data-iceberg-and-requeue.md` · item3 `HANDOFF-scene-entry-agent-config.md`。
> **红线（全项）**：禁 mock 冒充 / 解析失败诚实报不静默 / 只推 `claude/vigilant-knuth-b1nmxn` / 密钥仅 env（R5）/ 改链路·事件·断点回写 `docs/SYSTEM-ONTOLOGY.md`。
> **交付底线**：每单 `pnpm -r build`（全 4 包·非本地半门）+ `pnpm -r test` 全绿 + 该单 FDE 判据真跑过（绿测试≠能用）。

---

## ▌ item 1 · hollow-data 冰山

### WO-DM（P1·keystone）— dataMode 诚实位推广到全求解器 + 门

- **目标**：让 mock/哈希/魔数在**契约层**无法冒充真算（根问题解）。这是 A1-A4/B-MED 的地基——做完它们只剩"逐个标"的机械活。
- **改哪些**：
  1. **契约 `packages/contracts/src/solvers.ts`**：给 `PlanAuditOutputSchema`(audit_timeline)、`PlanGenerateOutputSchema` 各补 `dataMode: z.enum(["LIVE","MOCK","PARTIAL"]).optional()`（与 `RiskTimelineOutputSchema:119` 同款）。
  2. **extended 13 求解器输出契约（当前无 zod·此为根）**：为 `extended.ts` 的 13 求解器各建最小输出 schema（至少 `dataMode` + 关键字段），并入 `SOLVER_OUTPUT_SHAPES`。
  3. **求解器置位**：`apps/datacore/src/solvers/extended.ts`、`risk.ts`——凡走兜底魔数（`num(x, 魔数)` 命中默认）或哈希派生（`auditTimeline` `hashString`）→ 置 `dataMode:"MOCK"|"PARTIAL"`；走真对象数据 → `"LIVE"`。
  4. **UI 徽章**：消费 `dataMode` 显「估算·无实测」徽章——**复用 `RiskBoardView.tsx:79-90` 既有徽章范式**，铺到 audit/generate/extended 落点视图。
  5. **门 `no-silent-mock:check`**（新 `scripts/check-no-silent-mock.mjs` 并入 `pnpm gates`）：静态断言**每个 `SOLVER_KEYS` 的输出 schema 含 `dataMode` 字段**；漏一个即红。
- **FDE 真值判据**：① audit 视图每审计项时序卡带 dataMode 徽章；② `credit_exposure`/`yield_diagnosis`/`maintenance_stagger` 走兜底时输出 `dataMode:"PARTIAL"`、UI 标「部分估算」；③ 故意加一个无 dataMode 的求解器 schema → 门红。
- **边界**：本单只立**诚实位 + 标注**；A1-A4 各求解器**接真数据源**是后续单（接不上就诚实标 MOCK/示例，不本单强求）。
- **本体回写**：§2.E 求解器输出补 dataMode 语义；§7 加 `no-silent-mock` 门；§8 关联 hollow-data。

### WO-SHARE17（P1·小·可证伪 bug）— 方案份额/收入魔数错算

- **目标**：消除 `PlanGenerateView` 显示值与求解器自己 ✓/✗ 闸门**自相矛盾**（份额差 1pct）。
- **改哪些**：
  1. **求解器 `apps/datacore/src/solvers/plan.ts`**：`outcome` 直接下发 `shareDelta = round(outcome.share - base.share, 4)`（`:297` 闸门已算此值）+ `revGrowthPct = round((outcome.rev/base.rev - 1)*100, 4)`（`:295` 已算）。契约 `PlanGenerateOutputSchema` 补这两字段。
  2. **前端 `apps/frontend-shell/src/views/sim/PlanGenerateView.tsx`**：`:240` `meetShare` 改 `\`+${o.shareDelta.toFixed(0)}pct\``；`:238`/`:275` `meetRevenue`/收入增改渲染 `o.revGrowthPct`；**删掉 `- 17` / `- 100` 魔数**（含 `:275` Provenance formula 文案里的「基线 100」）。
- **FDE 真值判据**：方案 C 显示「份额 +22pct」**逐位等于**求解器闸门所用值（`outcome.share-18`）；改 `battery.ts:297 base.share` 后前端跟随、不再写死；收入增同理（改 base.rev 不再静默错）。

---

## ▌ item 2 · 深色字对比度

### WO-CSS（P2）— DAG 字色 typo + css-vars 门 + 全站审计

- **目标**：修用户实测的 DAG 深字深底 + 立门防同类 typo 复发（"界面词深色的都调浅色"）。
- **改哪些**：
  1. **`apps/frontend-shell/src/components/InferenceProcessDag.module.css:60`**：`fill: var(--text)` → `var(--txt)`（`--text` 全仓零定义·真 token `tokens.css:8 --txt`）。
  2. **门 `css-vars:check`**（新 `scripts/check-css-vars.mjs` 并入 `pnpm gates`）：扫所有 `**/*.css`/`*.module.css` 的 `var(--X)`，X 必须 ∈ `tokens.css` 定义集（+ 已知全局变量白名单）；引用未定义变量即红。**这一条一次性挡住所有同类 typo**。
  3. **全站对比度审计**：扫硬编码深色十六进制（`#0/1/2/3...`）作 `color`/`fill`/SVG text 的处所；逐个对照背景判对比，低于 WCAG AA 的改用 token。产出审计清单（可人工 + 工具）。
- **FDE 真值判据**：真浏览器 DAG 节点标签浅色清晰（与深底对比 ≥AA）；`css-vars:check` 故意引一个 `var(--nope)` → 门红。

---

## ▌ item 3 · 人机对话入口=配置完整的场景入口（母单 `HANDOFF-scene-entry-agent-config.md`）

### WO-SCENE-A（P1·小）— mode 收口（先让规划体检不再拒答）

- **目标**：把"开放式为常态"的对话入口从 `WORKFLOW_ONLY`（拒答）改 `WORKFLOW_FIRST`（命中预设走 Path A·命不中回落场景 agent）。
- **改哪些**：
  1. **`apps/agentcore/src/mocks/seed.ts:512`**：`scn_plan_audit` `mode: "WORKFLOW_ONLY"` → `"WORKFLOW_FIRST"`（**铁证根因**：全表仅此一处 WORKFLOW_ONLY；dash/risk/order/plan-generate/sop-balance 皆 WORKFLOW_FIRST）。
  2. **审计其余入口**：核 `SCENARIO_CATALOG`(`scenarios-catalog.ts`)+ 真部署 SceneEntry 种子，凡"开放式为常态"页不应 WORKFLOW_ONLY；确认每个回落 agent 有 `defaultAgentId`（当前 seed 的 SceneEntry **均无 defaultAgentId** → 回落到通用 agent，由 WO-SCENE-B 补场景 agent）。
- **FDE 真值判据**：真浏览器规划体检入口问开放式管理问句 → **不再「请换个问法」**，进入回落 agent（先验"不拒答"，富答案由 WO-SCENE-B 保证）。
- **边界**：只解"拒答"；"答得接地"是 WO-SCENE-B。

### WO-SCENE-B（P1·核心·先试点一个场景做模板）— 规划体检 SceneAgentSpec

- **目标**：把"规划体检"配成**配置完整的场景 agent**（本页数据作上下文 + 规则/意图/skill/MCP/求解器/本体切片），跑通后做模板批量铺到 20+ 入口。
- **改哪些**（定义 `SceneAgentSpec` + 出厂幂等播种；新增/改 `apps/agentcore/src` 的 Agent 定义 + Scenario.defaultAgentId）：
  - **场景级 Agent `agent_plan_audit`**（出厂幂等 upsert）：
    - `systemPrompt`：「你是规划体检助手。基于**本页规划体检数据**（最近定稿 S&OP 版本基线、财务三线、物料齐套）回答。优先调用求解器取真值，给结论+管理事项+依据；无实测数字诚实标注。」
    - `tools`（限定子集·非全集 32）：`mcp__solvers__plan_audit`、`plan_generate`、`mrp_netting`、`query_objects`、`get_object`、`discover`。
    - `ruleBindings`：`["C15","C16","C18","C21","C23"]`（= S04 卡 rules·G-10 真评估透出 PASS/WARN/BLOCK）。
    - `skills`：解读规划体检的能力 skill（绑既有/新建）。
  - **Scenario `scn_plan_audit` / SceneEntry(plan-audit)**：`defaultAgentId="agent_plan_audit"`；`presetContext={ view:"plan-audit", planVersion:"<最近定稿>", … }`；`sliceTargets`=plan 域切片（经 `planSlice` 取 S&OP/财务/物料子图）；`intentCatalogFilter`=plan 域意图子集。
  - **接地**：agent `query_*` 在 `sliceTargets` 切片内取数（CL.3 真类型名）；答案带 `⚠️ 部分数字未能溯源` + `[n]` 溯源标（沿用 hollow-data 诚实位）。
- **FDE 真值判据**（真 Kimi·真浏览器）：规划体检问「目前达到这个规划的目标，需要做哪些管理事项才能完成？」→ **接地结构化答复**：引本页规划/财务/物料真值 + 真调 plan_audit/plan_generate + 透出 C15/C18 规则裁决 + 三条管理事项；**非「请换个问法」、非通用泛答、非预算耗尽兜底**。实拍。
- **边界**：先**只做规划体检一个**做模板；真 LLM 富答案需 Kimi env-gated（mock 环境只验路由/接地/配置 plumbing）。
- **本体回写**：§2.H `Scenario` 补"场景 agent 配置完整性"；§3 场景/入口链补"场景 agent 接地"；§8 G-3 细化判据（配置完整性而非仅 presetContext 注入）。

### WO-SCENE-C/D（P2/P3·铺开 + 立门）

- **C·铺开**：以 B 为模板，给 dash/risk/order/sop-balance… 各配 SceneAgentSpec（各自数据上下文/规则/求解器子集）。
- **D·门 `scene-agent-config:check`**：每个 PUBLISHED 视图对话入口须 {mode≠WORKFLOW_ONLY 或显式只读声明 + defaultAgentId 已发布 + rules⊆已发布 + solverMcpAllow⊆注册表 + sliceTargets 可达}，否则红；纳入场景 `maturity=GOVERNED`（G-9）。**FDE**：故意留半截配置入口→门红。

---

## 建议施工顺序

1. **WO-SCENE-A**（1 行·立竿见影解拒答）+ **WO-SHARE17**（小·可证伪 bug）+ **WO-CSS**（typo+门）——低风险速胜。
2. **WO-DM**（keystone·hollow-data 地基）。
3. **WO-SCENE-B**（规划体检场景 agent 试点·item3 核心价值）。
4. **WO-SCENE-C/D + WO-DM 后续 A1-A4 接真源**（铺开+立门）。

> 每单 dev 实装 + 自验贴证后，审核方按其 FDE 判据**独立真跑复验**核发闭合（含真浏览器/真 PG 实拍·绿测试≠能用）。

---
*审核方设计落地施工单（design+review·非 dev 实装）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
