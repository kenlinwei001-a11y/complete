# VIS-SIGNALS-2 · FDE 证据（IPO 第2波·P2 透出批·G-VIS-1）

WO：审计第2波 5 簇合并的 P2「后端有真值/有下游·前端透出或导航缺一角」。reviewer 簇 7 信号逐条接后端已有真端点出 UI（诚实空态·零新后端能力·复用组件不重定义契约）。

## 真浏览器（VITE_MOCK build + vite preview :4188 + Playwright chromium · mock 登录 planner/demo · in-app SPA 导航保内存 token · 逐值对后端）

脚本按信号顺序 in-app 导航、逐值断言、截图。SUMMARY 全 ✓：

| # | 信号 | 后端真值端点 | 前端所见（逐值对后端） | 截图 |
|---|------|------------|----------------------|------|
| ① | ReviewView 空态深链 | `GET /a/v1/history/bundle`（无历史→空） | 诚实空态 `review-empty` + 深链 `/admin/synthetic`·`/admin/data-builder` | s1-review-empty.png |
| ② | 季度需求溯源 + 看年度分解 | `GET /a/v1/plan/quarterly`（rows[].dem） | 需求条 `需 382` + Provenance 六要素 + 「看年度分解 →」跳 annual-scenario | s2-quarterly-dem.png |
| ③ | 年度缺口/过剩窗口下钻 | `capex_scenario.windows` | surplus 窗口 badge 点击 → `/v/quarterly-rolling?focus=2027-Q1` + DrillBack 显现 | s3-annual-window.png · s3b-annual-drill-quarterly.png |
| ④ | 订单财务判 credit/price 并列 | `order_fullchain.judges.fin`（creditUsedRatio 0.8·priceUpPct 3） | `信用占用 80% · 需提价 3%（C15）`（==后端·超限时红标 C13） | s4-orderchain-fin.png |
| ⑤ | Solver 晋升后跳目录 | GOVERNED 制品 key | GOVERNED `material_coverage` 行「查看目录中此求解器→」`/admin/solvers?solver=material_coverage`→目录自动展开 | s5-solver-catalog-link.png · s5b-solvers-catalog.png |
| ⑥ | 规则展开显 params | `RuleEntry.params` | C09 展开 params 表 `staleHours=2·normalFactor=0.93·degradedFactor=0.9`（==后端·无阈值诚实空态） | s6-rules-params.png |
| ⑦ | SimClock tick 告警/变更深链 | tick 报告 `newAlerts.ruleKey`·`changedProps.object` | 告警 `C05`→`/admin/rules?ruleKey=C05`·变更 `设备-CZ-07`→`/o/设备/CZ-07`（tick #8 真报告流） | s7-simclock-links.png |

SUMMARY（脚本输出）：
```
✓ login · landed /
✓ ①review空态 · 深链 /admin/synthetic · /admin/data-builder
✓ ②季度dem溯源 · 看年度分解 btn 可见 · 需求条溯源 6 项 (需 382)
✓ ③年度窗口导航 · 窗口 badge 可见=true
✓ ③下钻到达 · → /v/quarterly-rolling?focus=2027-Q1 · DrillBack=true
✓ ④订单财务值 · 信用占用 80% · 需提价 3%（C15）
✓ ⑤solver晋升 · GOVERNED material_coverage 目录链接 href=/admin/solvers?solver=material_coverage
✓ ⑥规则params · C09 params 表: staleHours 2 normalFactor 0.93
✓ ⑦simclock告警 · 告警 C05 深链 href=/admin/rules?ruleKey=C05 · 变更对象 href=/o/设备/CZ-07
```

## 齿检（jsdom + MSW·真断言非 expect(true)）

`apps/frontend-shell/test/vis-signals-2.test.tsx` 12 用例全绿——逐值对后端（需 137==rows[0].dem·信用 80%==0.8·params 逐项==fixture）·override mock→changes（信用 1.2→显 120%+超限 C13·非写死）·honest-empty 渲染·导航到达真目标（url+DrillBack+RulesPage 按 key 展开）。`solver-binding-ui.test.tsx` 补 MemoryRouter（SolversPage 现用 useSearchParams）。

## 门/构建

`pnpm -r build` exit 0 · `pnpm gates` exit 0（ontology-slices 与母体一致）· frontend 全套 `npx vitest run` 通过（本单 +12 用例）。

## 移交/边界（诚实）

- ⑧ ExternalSignals source 连接器深链：不在本单 reviewer 簇 7 信号内（ExternalSignalsPage 独立·未触）→ 显式移交后续单，不硬塞。
- `__REVIEW_EMPTY__` 为 mock-only window 标志（生产从不置位·仅供真浏览器演示 ReviewView 诚实空态）——空即空、非伪造数据。
