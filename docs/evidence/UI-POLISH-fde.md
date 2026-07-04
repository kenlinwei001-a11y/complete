# UI-POLISH · 布局小瑕疵批 · FDE 真浏览器取证

WO UI-POLISH（道 F·P2·布局小瑕疵批）。范围：**非沙盘项**（sim-init 挤右上属 SANDBOX-LAYOUT-REWORK 领域·本单缓做·非漏做）。

真浏览器：`VITE_MOCK=1` vite + Playwright chromium，planner 登录，SPA 应用内导航（内存态 session·不整页重载），逐屏截图。

## 修的项 + 取证

1. **dash 视觉层级（间距/分组/权重）** — 把「回采校准链 + 模块直达」两个次级面板归入一个**次级导航区** `dash-nav-zone`（分隔线 + 组标题「导航与回采校准」+ 降权底色），与监控主区（看板 + 待解决问题）拉开 主→次 层级，缓解 3.72 屏平铺等权。
   - 真浏览器 DOM 断言：`nav-zone=1 · fb-in-zone=1 · mod-in-zone=1`（回采链/模块直达确在次级区内）。
   - 截图 `UI-POLISH-01-dash-hierarchy.png`。齿检 `dash-modules.test.tsx`。

2. **geo-map 叠字避让** — 相邻基地（川渝 成都/眉山/自贡、洛阳/邯郸/枣庄、信阳/合肥/武汉）标签原在气泡下方同偏移互相碰撞。改：贪心择位（下→上→右→左，避开已放置标签框）+ 气泡 `<title>` 原生 hover tooltip 兜底全名。
   - 真浏览器：12 基地标签全渲染且视觉不叠字（Sichuan 群 眉山↑/自贡·/成都↓ 垂直错开）。截图 `UI-POLISH-02-geo-map-labels.png`。
   - 齿检 `f24.geo-map.test.tsx`：重建标签框断言**两两不重叠**（真不变量）+ 气泡 `<title>` 含全名。

3. **裸表头无空态** — 空数据表原只剩裸表头。改诚实空态：
   - `LlmProvidersPage` providers 表空 → 空态行「暂无 LLM Provider…」（`providers-empty`，colSpan）。
   - `DashboardView.TableWidget` 空 → 空态行（`widget-table-empty`）。
   - `OpsFallbackPage`（兜底统计）无聚类 → 隐藏裸表头，仅显既有富空态说明。
   - 真浏览器 llm-providers 有数据态渲染正常（截图 `UI-POLISH-04-llm-providers-table.png`）；**空态**由齿检 `f35.empty-state.test.tsx`（MSW handler 覆盖返 `[]`）断言诚实空态行出现、裸表头列头消失。

4. **P90 裸浮点** — order-chain 交期产能判 `P90 1.1615` 裸长浮点。改：`fmtQty` 定 1 位小数、整数不带尾零/千分位（仅格式化不改值）。
   - 真浏览器：`P90 1,260 vs 需求 800`（整数千分位·非裸浮点）。截图 `UI-POLISH-03-order-chain-p90.png`。
   - 齿检 `order-fullchain.test.tsx`：`fmtQty(87.34999)→"87.3"`（review 亲点例）· `1.1615→"1.2"` · `1260→"1,260"` · `NaN→"—"`。

5. **solver_summary 空数组文案 bug（LAUNCHER 复验移交·渲染条件修）** — `summarizeSolverOutput`（agentcore executor.ts）原逻辑：只要有空数组子字段 + 有标量即出『**结果为空（真无解）**…infeasible』整体判决，**误现于并存 6 行结果表的非空答案**（S11 换型序列疵）。改：『真无解/数据未接齐』整体级判决**仅当无结果表**（答案整体无数据块）时升格；已有结果表时空子字段降为轻量一行『子字段「X」：infeasible（无）…不影响上表结果』。
   - 齿检 `bp6-bp7-relative-time-empty-results.test.ts`：新增 S11 回归（6 行 sequence 结果表 + 空 `over` → **不含**「真无解」·含 infeasible 轻量行·结果表在）；更新 evaluatedRules 掩盖用例为降级语义。真无解/数据未接齐（无结果表）两档保持。

## 缓做（显式声明·非漏做）

- **sim-init 挤右上（SimInitWizard / sim 视图族）** — **缓做**。SANDBOX-LAYOUT-REWORK 正在重构沙盘页 + SimInit 族 + THEME palette，为避冲突本单不碰 `views/sim/*`、SimInit 家族与 theme 文件。留待该 WO 统一处理。

## 门禁

`pnpm --filter frontend-shell test`（424 绿）· agentcore（408 绿·1 skip）· `pnpm -r build` 绿 · `pnpm gates` exit 0。
