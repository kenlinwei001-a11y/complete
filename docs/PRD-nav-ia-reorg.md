# PRD · 左侧导航信息架构整理 + 层级字号修正

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 前端（frontend-shell） |
| 取代/扩展 | 扩 `PRD-frontend.md`（§3 路由/壳层） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R2/R3/R14） · `apps/frontend-shell/src/pages/ShellLayout.tsx`（`:28` BUSINESS_NAV_GROUPS / `:42` BusinessNav / `:81` NavGroup / `:185+` admin flat 渲染）· `apps/frontend-shell/src/pages/adminRegistry.ts`（ADMIN_PAGES 32 项）· `ShellLayout.module.css`（`:111` navGroupHeader / `:129` navItem）· `styles/global.css`（`:148` section-title） |

> 一句话：左侧导航**管理区 32 项一把撸平**（业务区已分组），且**图谱与本体被拆在两区**；同时**层级字号倒挂**（父级 11px < 子级 13px）。本 PRD：① 把全导航改为**按业务域统一分组**（推演/数据/建模/… 立为一级，图谱并入建模组，meta 补回）；② 字号改为**父级 ≥ 子级**。**纯配置驱动、零业务常数（R14）。**

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.G）：`WorkspaceConfig.navigation`（角色化导航项）·`ViewConfig`·`AdminPageDef`(ADMIN_PAGES)·`FeatureConfig`（entitlement 门控导航项）。**不改后端真值，仅前端壳层 IA + 样式。**
- **触及链路**（§3）：`GET /a/v1/me/workspace → workspace.navigation + visibleAdminPages(角色过滤) → 壳层按 NAV_GROUPS 分组渲染`。
- **触及事件/数据流**（§4）：无新事件（纯壳层呈现）。
- **触及不变量**（§5）：
  - **R14 应用层无业务常数（核心）**：分组配置 `NAV_GROUPS` 是**导航 IA 结构**（非业务数据/租户专属），标签全来自 `zh.nav`（i18n）+ adminRegistry；不内联任何基地名/型号/业务文案。过 `debattery:check`。
  - **R2/R3 保留**：分组只改**展示顺序与归类**，**逐项可见性仍按角色（`visibleAdminPages`）+ entitlement（`<Feature>`）过滤**；空组自动隐藏，不泄露无权项。
  - **R15 CLI 对等**：导航是 **GUI chrome（纯呈现/信息架构）**，非可操作模块能力 → GUI-only（各页自身能力的 CLI 由 A15 覆盖，与导航布局无关）。
- **关闭/影响断点**（§8）：无；改善可用性（用户实测"导航乱 + 字号倒挂"）。
- **门禁**（§7）：`debattery:check`（无内联业务常数）· 前端回归（导航分组渲染 + 角色过滤 + 折叠记忆）· 视觉走查（字号层级）。
- **回写承诺**：纯前端 IA/样式，无需回写本体（不新增对象/链路/事件/不变量）。

## 1. 目标 / 非目标
### 目标
1. **统一按域分组**：业务视图 + 管理页**合并为一套按业务域的分组导航**（不再硬分"业务/管理"两堆），一级分组含 **推演 / 数据 / 建模** 等。
2. **图谱归位**：`图谱`（业务视图）并入**建模与图谱**组，与 半自动建模/本体切片/实体合并/域管理 同处。
3. **全覆盖无遗漏**：32 个 admin 页 + 全业务视图各归一组，**含此前漏掉的 `meta`（系统自我）**。
4. **字号符合层级**：分组标题 ≥ 叶子项（父 ≥ 子），层级靠 字重/大写/颜色 区分而非"越深越大"。
5. **保配置驱动 + 权限**：分组是配置表；逐项可见性仍按角色/entitlement 过滤；空组隐藏；折叠态记忆保留。

### 非目标
- 不改路由/页面本身、不改后端 workspace 契约。
- 不改各页内容；只动**左栏 IA + 字号**。
- 不引入业务常数（R14）。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| 业务导航 | `ShellLayout.tsx:28 BUSINESS_NAV_GROUPS` 已分 5 组（规划/推演/台账/图谱体系…） | 与管理区割裂；图谱单列 |
| 管理导航 | `:185+` `adminPages.map()` **扁平 32 项**（`adminRegistry.ts`） | **无分组 → 乱** |
| 图谱归类 | 在业务"图谱体系"组 | 与本体库/切片（admin）分家 |
| 字号 | section-title 10.5px(`global.css:148`) < navGroupHeader 11px(`:111`) < navItem 13px(`:129`) | **父 < 子，层级倒挂** |
| 遗漏 | — | `meta`(系统自我) 未归任何组 |

## 3. 设计
### 3.1 统一分组配置 `NAV_GROUPS`（替代 业务/管理 双堆 + admin flat）
- `ShellLayout.tsx` 新增 `NAV_GROUPS: { title: string; collapsed?: boolean; items: { kind: "view" | "admin"; key: string }[] }[]`（配置驱动，R14）。
- 渲染：每组逐项解析——`view` 项查 `workspace.navigation`（命中且可见才渲染 `/v/:key`）、`admin` 项查 `visibleAdminPages`（角色命中才渲染 `/admin/:path`）；**空组隐藏**；复用既有 `NavGroup`（可折叠 + `nav.collapse.*` 折叠记忆）。
- 完整分组（32 admin 全覆盖 + 业务视图）：

| 一级分组 | 二级项（kind:key） |
|---|---|
| 驾驶舱 | view:dash |
| 规划与平衡 | view:annual-scenario/quarterly-rolling/sop-balance/plan-audit/plan-generate/review |
| **推演** | view:project-sim/risk/order-chain |
| 台账与地图 | view:order/geo-map |
| **数据** | admin:connections/synthetic/data-builder/rule-docs/external-signals/quarantine |
| **建模与图谱** | view:graph + admin:modeling/slices/merge/domains〔+object-types=A4 未来〕 |
| 规则与行动 | admin:rules/actions/permissions |
| 编排与场景 | admin:catalog/agents/workflows/skills/mcp/scenes/evals |
| 校准·验证·自成长 | admin:calibration/validation/growth |
| 运营 | admin:ops-schedule/ops·fallback/notifications |
| 平台与系统 | admin:features/llm-providers/views/tenants/users/**meta** |

> 顶部"场景启动器"链接保留在分组之上（全局入口）。
### 3.2 图谱并入建模组
- 从 `BUSINESS_NAV_GROUPS` 的"图谱体系"移除 `graph*`，改由 `NAV_GROUPS` 的「建模与图谱」组以 `view:graph` 承载（图谱子视图 graph-all/backbone/… 仍可作该组内二级或图谱页内 tab，按既有 collapsed 折叠）。
### 3.3 字号修正（方案 B：父 ≥ 子）
- `global.css:148` `.section-title` **10.5 → 12px**（若保留顶层 section-title；统一分组后可由 NavGroup 标题取代）。
- `ShellLayout.module.css:111` `.navGroupHeader` **11 → 13px**（与叶子持平或略大），保留 600 + 大写 + 字距 + muted2 作层级信号。
- `.navItem` 维持 **13px**（必要时 12.5px 让分组标题略大）。
- 结果：分组标题 ≥ 叶子项，层级靠 字重/大写/颜色，不靠"越深越大"。

## 4. 契约 / 端点 / 数据模型
- 无后端改动；无新端点/契约。仅 `ShellLayout.tsx` 新增 `NAV_GROUPS` 配置 + 渲染、CSS 3 处字号、`zh.nav` 补任何缺失标签（如 meta 已有"系统自我"）。

## 5. 关键流程
登录 → `GET /a/v1/me/workspace` → `workspace.navigation` + `visibleAdminPages(roles)` → 壳层按 `NAV_GROUPS` 分组渲染（逐项按角色/entitlement 过滤、空组隐藏、折叠记忆）→ 字号 父≥子。

## 6. 非功能（§5）
R14（IA 配置化、零业务常数）· R2/R3（逐项角色+entitlement 过滤不变）· 折叠态 localStorage 记忆保留 · 无障碍：分组标题语义 button/heading。

## 7. 验收（DoD）
- 全导航按域分组；**推演/数据/建模** 为一级；**图谱在「建模与图谱」组**；**32 admin 全覆盖含 meta**；空组隐藏；不同角色看到的项正确（admin/planner/base_manager 各跑一遍）。
- 字号：分组标题 ≥ 叶子项（视觉走查 + 快照）。
- `pnpm -r build && pnpm -r test` 全绿（前端导航分组/角色过滤/折叠记忆回归）；`debattery:check` 不超基线。
- FDE：真跑前端（mock + 真后端）亲手点一遍各组、各角色，截图留证。

## 8. 分期
- **N1** `NAV_GROUPS` 统一分组配置 + 渲染（业务+admin 合一、空组隐藏、复用 NavGroup 折叠）+ meta 补回。
- **N2** 图谱并入建模组（从业务图谱体系迁移）。
- **N3** 字号方案 B（3 处 CSS）+ 视觉走查 + 前端回归。

## 9. 需你确认（1 点）
- **顶层"业务/管理"两个 section-title 是否保留**？默认**取消**，全部用域分组（更统一）；若你要保留"管理"作大分隔，可在平台与系统/运营等组上方加一条 section-title。默认取消。
