# WO-IA-E2E5E6 · 导航信息架构三改 — 交单报告（build & review contract）

- 分支：`wo-ia-e2e5e6`（基线 `origin/claude/verify-reclaim-6`），已推 `claude/handoff-wo-ia-e2e5e6`
- 提交：`94df97a4`（E2）· `9a319106`（E6）· `b5a643d3`（E5），tip = `b5a643d3`
- 日期：2026-08-16

---

## 一、三改的独立复验（派单证据逐条亲手重验过，未照单全收）

| 派单证据 | 复验结果 |
|---|---|
| DecisionPlayView 已只剩壳（40 行）、route `/v/decision-play` 挂载在 App.tsx | ✅ 属实；DecisionPlayPanel 三处共用（订单链/链阻滞/壳布局） |
| E2 连坐面「只剩 1 处」 | ❌ **不属实，实为 2 处**：门判据④（专用 route 必须有导航入口）+ `f61.admin-nav-groups.test.tsx` 两条断言。两处共用单一来源 `ROUTE_NO_NAV` 登记表（仿 `CONSOLIDATED_INTO_SANDBOX` 模式：登记表写在受测代码里，门与测试同读一张表） |
| E5 两页不合、做双向入口 | ✅ 属实（`SYSTEM-ONTOLOGY` §7 第 6/7 条：`waitStateOrigin` 分层即两问） |
| E6 改名三处（view-manifest:115 一带 / feature-names:47） | ✅ 属实；另发现 **featureName 与 agentcore 受检副本互锁**（`assertSharedFeatureNames()` 模块加载即抛），改名只能落 title 命名空间，featureName 残留登记见 §六 |
| ProjectSimView.tsx:219 注释「全局主计划框架内的细排」提上屏 | ✅ 属实，已提为 `data-testid="proj-sub"` 副标题 |

## 二、E2 · 删导航项留 route（验收：一条测试同咬「导航无此项」⊕「深链契约不变」）

改动：`ShellLayout.tsx` 删条目 + 导出 `ROUTE_NO_NAV` 登记表；`check-nav-group-coverage.mjs` 判据④改读该表（词法自检金丝雀共用同一解析器）；`f61` 两条断言同读该表；新增 `nav-ia-decision-play.seam.test.tsx`。

测试输出原文（2026-08-16 复跑）：

```
 ✓ test/nav-ia-decision-play.seam.test.tsx (2 tests) 1814ms
   ✓ WO-IA-E2E5E6 · E2：导航无「决策推演」条目 ⊕ /v/decision-play 深链契约不变 > 效果层双断言：侧栏没有「决策推演」链接，且 imp* 深链直达页面壳、query 逐键生效  1805ms
 ✓ test/f61.admin-nav-groups.test.tsx (14 tests) 2728ms
 Test Files  2 passed (2)
      Tests  16 passed (16)
```

双断言内容：结构层（NAV_GROUPS 无 decision-play 条目 ∧ ROUTE_NO_NAV 已登记）＋ 效果层（侧栏无 `/v/decision-play` 链接、无「决策推演」文本，金丝雀 `/v/dash` 在；携 `fromImpediment/impKind/impStage/impRule/impLocusType/impLocusId/impLocusLabel/impMode/impJoin` 全族 query 直达，`dp-from-impediment`/`dp-from-locus` 逐键生效）。

变异反证（实测）：把条目加回 NAV_GROUPS ⇒ 两例当场红；门豁免表错配一个键 ⇒ 门 RC=1。

## 三、E5 · 双向入口（不合页）+ 计数一致接缝测试

改动：`ProcessWaitView.tsx`（每站行内计数格 `StuckCountCell` 三态：>0 链接 / 真的 0 静态文本 / 拿不到「该站计数暂不可得」+原因；`?focus=` 行定位 + 查无此站明说；`derivedStuckCount` 口径声明并入诚实位）；`ProcessStuckView.tsx`（卡片反向链接；`?proc=` **显示层**过滤 + 横幅 + 清空口；过滤态空 ≠ 全库空分开说）；`zh.ts crosslink` 文案块；两 module.css 五个类（全走 token 变量）。

**验收判据本体**（仓主原话：计数一致，非链接存在性）——从模板层链接 `data-count` **读出** N，点过去咬实例层实际渲染卡片数：

```
 ✓ test/process-wait-stuck-link.seam.test.tsx (4 tests) 1954ms
   ✓ 验收判据：模板层 P17 行内计数 N → 点过去，实例层过滤后**恰好** N 张卡（两页同一个数）  1034ms
   ✓ 反向：实例层卡片跳回模板层，对应站被定位（data-focus + 徽标）  404ms
   ✓ 诚实位：focus 的站不在模板层词表（P44）⇒ 明说查无此站，不静默空跳
   ✓ 诚实位：计数拿不到（404）⇒ 摆「暂不可得」+ 原因，绝不摆 0
      Tests  4 passed (4)
```

防哑门设计：`n >= 1` 下界金丝雀（0==0 是空集恒真）；P44 反向金丝雀（过滤失效时全量 2 张照样「相等」）；计数条 `byWaitState` 不被过滤改写。

变异反证（两枚，实测输出）：

```
① 模板层计数改假（data-count = n+1）：
   × 验收判据 … → expected '现在有 1 张单卡在这里 →' to be '现在有 2 张单卡在这里 →'
② 撤掉实例层过滤（visible = stuck）：
   × 验收判据 … → expected '2' to be '1'
```

连坐修齐（本单引发，均已闭环）：`process-stuck.seam.test.tsx` 隔离渲染补 `MemoryRouter`（组件新增 Link/useSearchParams，12 例曾红）；ui-first-layer 棘轮三条（见 §五）。

回归：`process-wait` 33/33 · `process-stuck.seam` 23/23 · `process-inspect`/`sandbox-process-mode`/`procurement-legs-navreach` 39/39 · `tsc --noEmit` RC=0。

## 四、E6 · 三处改名 + 四类盲区扫描

改动：title 命名空间三处全换（datacore `view-manifest.ts`、mock `fixtures.ts allViews`、`zh.ts proj.title`、GlobalSimView/ProjectSimView/DashboardView 屏上文案）；`ProjectSimView.tsx:219` 注释提为屏上副标题（`proj-sub`）。测试：`nav-ia-rename-e6.test.tsx`（2 例绿）+ `global-sim-drill-seam.test.tsx` 期望串同步（3 例绿）。

四类类型盲区扫描（改前发现 → 已修 / 当前态复扫 2026-08-16）：

| 类 | 改前发现 | 当前态 |
|---|---|---|
| ① 测试对象字面量 / `props[...]` 数据键 | 0 | 0（复扫 `props["…推演"/["方案生成"]` 全仓 0 命中） |
| ② `toContain`/`toMatch` 期望串 | **1 处**（global-sim-drill-seam「项目推演仅细排销售订单」） | 已修为「接单可行性仅细排销售订单」；现存旧名命中仅 `nav-ia-rename-e6.test.tsx:28` 我写的**反向断言**本身 |
| ③ mock/fixtures 数据键 | **3 处**（fixtures allViews 三标题） | 已修；现存 `fixtures.ts:178-179` 两处是 **feature 注册表副本**（featureName 命名空间，与 agentcore 互锁，刻意留旧名，见 §六）；其余命中均为注释 |
| ④ LLM 属性名清单 | — | 0。本仓**不存在** `navigation-slice.ts`/`OBJECT_KEY_PROPS`（0 命中；金丝雀：`keyProps` 在 planFixtures 有命中，工具正常，且其内容不含视图名） |

测试输出原文：

```
 ✓ test/nav-ia-rename-e6.test.tsx (2 tests) 7130ms
 ✓ test/global-sim-drill-seam.test.tsx (3 tests) 8420ms
      Tests  5 passed (5)
```

## 五、门禁 RC（全部实测，非「应该过了」）

| 门 | RC | 备注 |
|---|---|---|
| `check-nav-group-coverage` | **0** | E2 豁免经 `ROUTE_NO_NAV` 单源；词法金丝雀与主逻辑共用解析器；豁免错配变异 ⇒ RC=1 实测 |
| `check-ui-first-layer` | **0** | 本单曾触发三条并全部闭环：D7 松弛（ProcessStuckView 基线 35>34/prose 8>6）⇒ `--tighten` 收紧（只降不升）；D1（ProcessWaitView 80→87 纯往第一层堆）⇒ `vsImpediments`/`sourceNote` 两段口径降 `InfoPopover`（真分层 first↓deferred↑）+ E5 新内容并入既有信息块（净 +0）；D2b（GlobalSimView prose 17→18：改名把组标签顶过 24 字阈值）⇒ 标签减一字 |
| `check-dev-jargon-onscreen` | **0** | 新增屏上文案零 PRD 区号/开发黑话 |

## 六、未做部分与差什么（残留登记）

1. **featureName 两键留旧名**（`项目推演`/`全局项目推演`）：`SHARED_FEATURE_NAMES` 与 `apps/agentcore/src/features/registry.ts` 受检副本互锁（`assertSharedFeatureNames()` 模块加载即抛），agentcore 超本单范围。**差**：一张放开 agentcore 范围的 WO——改 `contracts/feature-names.ts` 两键 + agentcore registry 字面量 + `fixtures.ts:178-179` 副本，三处同一提交。影响面：功能名册页（FeaturesPage）两个功能名仍显示旧名。
2. **求解器目录名 `全局项目推演`**：datacore `catalog.ts:148` 与 `actions.ts` 相关串在「不碰 solvers」边界内，未动。**差**：范围裁决（求解器目录是否跟随视图改名）。
3. **GlobalSimView 存量「最优」措辞**（h2 括注「全局最优在先」、L406「一次算出全局最优」等 4 处）：与「优选非最优」裁决存在张力，但属存量文案、超出 E6 改名授权，未动。**差**：仓主裁决是否软化为「更划算/统筹」类措辞（note：求解器 `status:"OPTIMAL"` 时另有一处「可证最优」是按运行结果说话的，与名称的常设承诺性质不同）。
4. **P44 反向链接落「查无此站」**：mock 里 P44 只有运行实例、不在定义词表（fixture 是 seed 逐字子集），反向跳回落诚实提示。生产 65 条定义齐全时不触发；这是 mock 演示态的固有形态，已按「不许静默空跳」处理。

## 七、纪律执行记录

- 探让：除 E6 测试一次在 8 个 vitest 并发下抢跑（已记录）外，所有测试运行前 `ps -eo args | grep -c "[v]itest"` 探并发（本批均为 0 起跑）。
- 每命名单元立即 commit + push（E2/E6/E5 三提交分别落盘）。
- 负面结论均带金丝雀（grep 类扫描先证工具命中新名/已知串，再报旧名 0 命中）。
- 范围：未碰 `apps/agentcore/**`、solvers、`mocks/sopScale.ts`、`mocks/simSolvers.ts`；baseline 改动仅 `--tighten`（只降不升）。
