import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tokenStore } from "@/api/tokenStore";
import { restoreSession } from "@/api/apiClient";
import { fetchHistoryWatermark, fetchResolvedFeatures } from "@/api/endpoints";
import { useWorkspace, workspaceQueryKey } from "@/workspace/useWorkspace";
import { useDomainEventStream } from "@/store/useDomainEventStream";
import { applyTheme } from "@/workspace/theme";
import { featureOn } from "@/workspace/featureGate";
import { logoutSession } from "@/store/authSession";
import { toast } from "@/store/toastStore";
import { visibleAdminPages } from "./adminRegistry";
import { QueryDock } from "@/components/QueryDock/QueryDock";
import { CommandPalette } from "@/components/ScenarioLauncher/CommandPalette";
import { HistoryPanel } from "@/components/History/HistoryPanel";
import { GlobalSearch } from "@/components/GlobalSearch/GlobalSearch";
import { HealthBadge } from "@/components/Health/HealthBadge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import type { Workspace } from "@/api/types";
import zh from "@/locales/zh";
import styles from "./ShellLayout.module.css";

const CONFIG_VERSION_TTL_MS = 5 * 60_000;

/**
 * 业务视图导航分级（21 项 → 5 个功能分组，可折叠）。按视图功能归类；
 * 未归类的视图（后端新增）落入「其他」组，确保不丢项。折叠态记 localStorage。
 */
// nav-ia-reorg N1：统一按业务域分组（替代"业务/管理"双堆 + admin flat）。配置驱动 R14——
// 每项 kind=view（查 workspace.navigation，/v/:key）或 admin（查 visibleAdminPages，/admin/:path）；
// 逐项可见性仍按角色 + entitlement 过滤；空组自动隐藏；折叠记忆复用 NavGroup。图谱(view)并入「建模与图谱」与本体/建模同组（闭"图谱与本体拆两区"）；meta 补回「平台与系统」。
//
// WO-ROUTE-NAV-COVERAGE：第三种 kind=**route**（App.tsx 专用静态路由 `{ path: "v/<静态段>" }`）。
// 为什么必须是第三种、不能复用 view：
//   · `kind:"view"` 的可见性绑在 `workspace.navigation` 下发上（`UnifiedNav` 拿 `viewByKey.get(ref.key)`，
//     查不中 `return null` —— **静默消失，不报错、不留痕**）；
//   · 而专用 route 的设计意图**恰恰是不依赖下发**（App.tsx 静态段先于 `:viewKey` 匹配，免 workspace.views 即可达）。
//   两件事对不上，于是 `decision-play` 挂成 `kind:"view"` 后成了**幽灵条目**：表里写着、屏幕上永远没有。
// 故 route 项**自带 label、无条件渲染**（不查任何下发集合）；`feature` 可选，仅用于本就"暗发"的入口
//   （sim-sandbox：entitlement 关 → 入口消失 + 进去 404，R3「功能关闭 = 不存在」不泄露存在性，语义一字未动）。
//   不带 feature 的路由页没有页面侧 Guard，本就人人可进，无可泄露。
type NavItemRef =
  | {
      kind: "view";
      key: string;
      /**
       * WO-SANDBOX-NAV-CONSOLIDATE · **收编开关**（语义与 route 变体那个**逐字相同**：开则隐藏）。
       *
       * 为什么 `kind:"view"` 也要有这一条（上一版只有 route 变体有）：
       * 收编表 `CONSOLIDATED_INTO_SANDBOX` 里原来那五个子视图的 entitlement 本就
       * `requires: ["sim.sandbox"]` —— 沙盘关 ⇒ 它们连 `workspace.views` 都不下发，
       * **不存在「沙盘关着但这五个还在」的状态**，故那五个是**无条件**收编（表里有即滤掉）。
       * 而本轮收编的三页（`process-wait` / `procurement-legs` / `process-stuck`）
       * **不受 `sim.sandbox` 门控**（沙盘关着它们照样下发、照样能打开）。若也按无条件滤掉，
       * 沙盘关着的租户就会「沙盘没有 + 导航也没有」= 三个页从 IA 里蒸发 ——
       * 那正是本单硬红线禁止的「删导航项了事」。
       *
       * ⇒ 判据：**带 `consolidatedWhen` = 条件收编**（那个开关开着才隐藏，关着照旧单列）；
       *   **不带 = 无条件收编**（只可能用于随同一个 entitlement 一起消失的键）。
       *   两者的对账在 `scripts/check-nav-group-coverage.mjs` 判据⑧a/⑧f。
       */
      consolidatedWhen?: string;
    }
  | { kind: "admin"; key: string }
  | {
      kind: "route";
      /** App.tsx 里 `{ path: "v/<key>" }` 的静态段（= 链接 `/v/<key>`·门按此对账）。 */
      key: string;
      /** 侧栏文案（route 项不走 workspace.navigation，故 label 在本表内联，同 adminRegistry.ADMIN_PAGES 的既有做法）。 */
      label: string;
      /** 暗发 entitlement 键（可选）：仅当页面侧本就有 Guard 时填，关 → 入口消失（R3 不泄露存在性）。 */
      feature?: string;
      /**
       * WO-SANDBOX-IA-CONSOLIDATE · **收编开关**（可选）：该 entitlement **开**时本条目隐藏
       * ——因为此时该页已被那个控制台收编（进得去，只是换了入口），单列就是重复入口。
       *
       * ⚠ 语义与 `feature` **正好相反**，不许混：
       *   · `feature`          关 → 隐藏（R3 暗发：功能不存在，连入口都不许泄露）；
       *   · `consolidatedWhen` **开** → 隐藏（收编：功能还在，入口搬进控制台里了）。
       *
       * 为什么要留这条回退而不是干脆删掉条目：这四个推演页**本身不受 `sim.sandbox` 门控**
       * （人人可进、无页面侧 Guard）。若无条件删条目，`sim.sandbox` 关着的租户就会
       * 「沙盘没有 + 导航也没有」= 四个页只剩手敲 URL 可达 —— 那是把 IA 整理做成了功能消失。
       * 有了这条：沙盘开 → 在沙盘的模式切换里；沙盘关 → 条目照旧单列。两种租户都不丢东西。
       */
      consolidatedWhen?: string;
    };
/**
 * WO-SANDBOX-IA-CONSOLIDATE · **已收编进推演沙盘的入口**（不在左导航单列，路由仍可达）。
 *
 * ── 这张表是「声明」，不是「遗漏」──────────────────────────────────────────────
 * 屏上的结果（不出现在导航里）与「忘了登记」一模一样，但两者性质相反、修法相反：
 *  · 忘了登记 → 落进「其它」折叠兜底桶（`G-NAV-FALLBACK-BUCKET`，可达但用户找不到）；
 *  · 进了本表 → **显式声明**「这个入口有意不单列，因为它在沙盘里已经有到达路径」，
 *    有表、有理由、有门对账（`scripts/check-nav-group-coverage.mjs` 判据①/④ 读这张表）。
 * 故 `UnifiedNav` 必须把本表的键从**分组表和 leftover 兜底桶两处**同时滤掉 ——
 * 只从 NAV_GROUPS 里删、不滤 leftover，它们会当场掉进「其它」桶，比单列还糟。
 *
 * ── 依据（仓库自己写下、当时没执行的定案）─────────────────────────────────────
 * 本文件上一版第 67-70 行原文：「四个子视图在此登记是**过渡态**……WO-SANDBOX-CONSOLE 落地后，
 * 这四行应当**删掉**」。控制台（`views/sim/SandboxConsole.tsx`）早已落地并在跑 ⇒ 前提已满足。
 * 逐条到达路径的**实测取证**在 `docs/AUDIT-sandbox-ia-consolidate.md`（2026-08-10 实测，5/5 绿）。
 * 复验方式：`cd apps/frontend-shell && npx vitest run test/sandbox-ia-consolidate.seam.test.tsx`
 * 的 §件一 五条 —— 每条从沙盘主屏出发、只用用户点得到的动作，断言子视图组件本体真渲染。
 * **取证不过的那一条不许进本表**（删了就是让功能消失）。
 *
 * ── `via` 字段：删的是"单列"，不是"可达"，而两种可达机制不同 ────────────────────
 *  · `workspace.views`：后端 `view-manifest.BUILTIN_VIEWS`(seed:true) 派单 → `App.tsx` 的
 *    `{ path: "v/:viewKey" }` 通用分发 → `ViewPage` 查 `workspace.views` 拿 renderer。
 *    ⇒ **后端不许停派**，停派 = `/v/<key>` 当场 404（件四结论，见 AUDIT §4）。
 *  · `view-defs`：后端 `synthetic/service.ts` 的 `VIEW_DEFS` **增量视图桶**（不进 `BUILTIN_VIEWS`、
 *    不进 `scenarioSeed.views`）。`process-stuck` 走这条：它的控制键是引擎级暗发键
 *    `process.runtime` 而不是 `view.<key>`，进 `BUILTIN_VIEWS` 会被 `builtInViewFeatureDefs()`
 *    照 featureKey 再注册一份 `defaultOn:true`，**把暗发当场顶掉**（见 service.ts 该行的长注释）。
 *  · `static-route`：`App.tsx` 的 `{ path: "v/<静态段>" }`，静态段先于 `:viewKey` 匹配，免下发即可达。
 * 门按 `via` 分别验：前两者验后端仍派单（一个查 `BUILTIN_VIEWS(seed:true)`、一个查 `VIEW_DEFS`），
 * 后者验 route 仍存在。写错 `via` 会被门当场咬住。
 */
/**
 * ── WO-INTEG-BATCH-5 收编补：`host` 字段 —— 把「被**哪个**控制台收编」变成机器可读 ──────
 *
 * 病样（2026-09-04 实测）：`WO-SIM-NAV-UNIFIED` 给本表加的四条，收编宿主是**合并壳** `/v/sim-unified`，
 * 不是上面十二条的旧沙盘 `/v/sim-sandbox`。这件事当时**只写进了散文注释**（见下方
 * 「与上面所有条目的收编宿主不同」那段），于是：
 *   · `SandboxView.CONSOLIDATED_PAGES`（旧沙盘的屏上投影）只列 12 条 —— 它是**对的**；
 *   · 两条测试仍按「本表 = 旧沙盘一个宿主」遍历全表 ⇒ `sandbox-ui-integrate` ② 与
 *     `sandbox-ia-consolidate` 的「不许漂移」断言双双红，而红的原因**不是收编变成了黑洞**，
 *     是判据本身还停在一个宿主的年代。
 * **注释不是机制**：宿主写在散文里机器读不到，两侧就只能各按各的理解走。故升成字段。
 *
 * 判据：`host` = **用户在哪一页能到达它**的那一页的 view key（`where` 是同一件事的人读版）。
 * ⚠ 刻意**不给默认值**、类型上必填：给了默认值，下一条忘写 host 的条目就会**静默归到某个宿主** ——
 *   与本批刚修的 `service.ts` 那个 `?? ["Order"]` 完全同型。漏写即编译红，机器先说话。
 */
export const CONSOLIDATED_INTO_SANDBOX: Record<
  string,
  { via: "workspace.views" | "view-defs" | "static-route"; host: "sim-sandbox" | "sim-unified"; where: string }
> = {
  // ── 五个沙盘子视图（原「推演」组平级入口）──────────────────────────────────
  // 这五个的 entitlement 本就 `requires: ["sim.sandbox"]`（见 mocks/fixtures.ts 与后端 view-manifest.ts）：
  // 沙盘关 ⇒ 它们连 `workspace.views` 都不下发、`/v/<key>` 本来就 404 ⇒ **不需要回退入口**
  // （没有"沙盘关着但这五个还在"的租户状态）。故它们从 NAV_GROUPS 里**彻底删除**。
  "chain-line-map": { via: "workspace.views", host: "sim-sandbox", where: "沙盘中栏画布**默认**模式「线路图」（进沙盘即在屏上）" },
  "physical-topology": { via: "workspace.views", host: "sim-sandbox", where: "沙盘中栏画布模式条 →「物理拓扑」" },
  "node-inspector": { via: "workspace.views", host: "sim-sandbox", where: "沙盘右栏常驻检视面板 → 页签「变量输入」" },
  "transit-flow": { via: "workspace.views", host: "sim-sandbox", where: "沙盘线路图上的「在途批次图层」勾选框" },
  "chain-impediments": { via: "workspace.views", host: "sim-sandbox", where: "沙盘主屏阻滞点统计条 + 逐条清单（残差见 AUDIT §2）" },
  // ── 四个独立推演页（原「推演」/「归因与风险」组的专用 route 入口）──────────────
  // 收进沙盘顶部的**模式切换**（决策链序：现状 → 归因 → 试一手 → 求最优 → 影响半径）。
  // 与上面五个的关键差别：这四个页**不受 `sim.sandbox` 门控**（人人可进）。
  // 故它们在 NAV_GROUPS 里的条目**保留**，只是带 `consolidatedWhen: "sim.sandbox"` ——
  // 沙盘开 → 隐藏（已在沙盘里）；沙盘关 → 照旧单列（否则这四个页会随沙盘一起从 IA 里蒸发）。
  "cleanroom-attr": { via: "static-route", host: "sim-sandbox", where: "沙盘模式切换 →「归因」→ 档「净室归因」（沙盘关则回退为导航单列）" },
  "what-if": { via: "static-route", host: "sim-sandbox", where: "沙盘模式切换 →「试一手」（沙盘关则回退为导航单列）" },
  "optimize-whatif": { via: "static-route", host: "sim-sandbox", where: "沙盘模式切换 →「求最优」（沙盘关则回退为导航单列）" },
  "disruption-radius": { via: "static-route", host: "sim-sandbox", where: "沙盘模式切换 →「影响半径」（沙盘关则回退为导航单列）" },
  // ── 三个「归因与风险」组的后端下发页（WO-SANDBOX-NAV-CONSOLIDATE）────────────────
  // 收进沙盘「归因」模式的**档**（同一问、不同对象：链路损失 / 流程模板 / 流程实例 / 采购段），
  // 档表在 `views/sim/sandboxModes.ts` 的 `SANDBOX_ATTRIBUTE_TAB_SPEC`（那张表的 `originView`
  // 就是本表的键，两侧由测试对账，不许各写一半）。
  // 与上面四页的关键差别：它们经**后端下发**（kind:"view"），不是专用 route ——
  // 故回退条目也是 kind:"view" + `consolidatedWhen`，见 NAV_GROUPS「归因与风险」组。
  "process-wait": {
    via: "workspace.views", host: "sim-sandbox",
    where: "沙盘模式「归因」→ 档「流程等待态」（沙盘关则回退为导航单列）",
  },
  "procurement-legs": {
    via: "workspace.views", host: "sim-sandbox",
    where: "沙盘模式「归因」→ 档「采购四段腿」（沙盘关则回退为导航单列）",
  },
  // ⚠ `view-defs` 不是 `workspace.views` 的同义词，别顺手改：`process-stuck` 刻意**不进**
  //   `BUILTIN_VIEWS`（进了就把暗发键 `process.runtime` 顶成 defaultOn:true），见表头 `via` 说明。
  "process-stuck": {
    via: "view-defs", host: "sim-sandbox",
    where: "沙盘模式「归因」→ 档「流程卡点」（暗发键关着时该档整个不出现·沙盘关则回退为导航单列）",
  },
  // ── WO-SIM-NAV-UNIFIED · 指控台四页收编进**统一推演控制台**（`/v/sim-unified`）──────────
  // ⚠ 与上面所有条目的**收编宿主不同**：上面那批进的是旧沙盘 `SandboxConsole`（`/v/sim-sandbox`），
  //   这四条进的是合并壳 `views/sim/unified/UnifiedSimShell.tsx`。本表键名里的 "SANDBOX" 是历史名，
  //   语义是「已被某个控制台收编、故不在左导航单列」——两个宿主共用这一张声明表，`where` 里写明是哪一个。
  //
  // `via` 必须是 `"view-defs"`，两个方向都不许写错（各错各的死法）：
  //   · 写成 `"workspace.views"` ⇒ 判据⑧b 会去查 `BUILTIN_VIEWS`，而这四键**刻意不在**那张表里
  //     （进去就被 `builtInViewFeatureDefs()` 照 featureKey 注册成 defaultOn:true，把
  //     `sim.sandbox` 这把闸顶掉）；更阴的是 `sim-page-roster.mjs` 的**排除判据 X1** 只排
  //     `via === "workspace.views"` ⇒ 四页会被当成「沙盘内部构件」**踢出推演页名册**，
  //     UX 判据与挂载点门从此对它们恒绿（漏检永远绿）。
  //   · 写成 `"static-route"` ⇒ 判据⑧c 要求 `App.tsx` 里有 `{ path: "v/<key>" }`，这四页没有
  //     （只走 `v/:viewKey` 通用分发）；且 ⑧e 会反过来要求本组留 `kind:"route"` 回退条目。
  // 实测依据（2026-08-26）：四键在后端增量视图桶里俱在。复验（应为 4）：
  //   `grep -c '"sim-console"\|"sim-conduction"\|"sim-attribution"\|"sim-optimize"' apps/datacore/src/synthetic/service.ts`
  //   （刻意不写死行号 —— 行号会漂，写死行号的引用天生带保质期。）
  //
  // `where` 写的是**用户点哪里能到**，逐条与 `unifiedModes.ts` 的 `UNIFIED_MODE_SPEC` 对得上：
  "sim-conduction": {
    via: "view-defs", host: "sim-unified",
    where: "统一推演控制台顶部页签 →「传导识别」（`UNIFIED_MODE_SPEC.conduction.renderer = \"sim-conduction\"`，经 getRenderer 挂的就是本页组件）",
  },
  "sim-attribution": {
    via: "view-defs", host: "sim-unified",
    where: "统一推演控制台顶部页签 →「损失归因」（`UNIFIED_MODE_SPEC.attribution.renderer = \"sim-attribution\"`，经 getRenderer 挂的就是本页组件）",
  },
  "sim-optimize": {
    via: "view-defs", host: "sim-unified",
    where: "统一推演控制台顶部页签 →「方案寻优」（`UNIFIED_MODE_SPEC.optimize.renderer = \"sim-optimize\"`，经 getRenderer 挂的就是本页组件）",
  },
  // ⚠ `sim-console` 与上面三条**收编方式不同，必须分开说**（合成一句就是本仓最恨的
  //   「拿一个笼统说法盖住两个不同事实」）：上面三条是**同组件原样挂进页签**（点开还是那一页）；
  //   本条是**版面替代** —— 合并壳首档 `now` 用自带的 37 张指标卡墙（`MetricWall`）取代了本页首屏，
  //   `UNIFIED_MODE_SPEC.now.renderer === null`，即壳里**并没有挂 `sim-console` 这个组件**。
  //   这正是仓主那句「base 页面是一个大量的指标卡片」所裁决的合并方向，不是漏接线。
  //   旧版面本身一个字没动、`/v/sim-console` 深链照旧可达（判据⑧b 逐条验它还在 VIEW_DEFS 里）。
  "sim-console": {
    via: "view-defs", host: "sim-unified",
    where: "统一推演控制台首档「指标态势」（= 本页首屏的合并去向：37 张指标卡墙取代旧首屏；旧版面 /v/sim-console 深链仍可直达）",
  },
};

/**
 * WO-SANDBOX-NAV-CONSOLIDATE · **组收编承诺的显式豁免表**（判据⑨ 的唯一豁免源）。
 *
 * ── 它治什么病（本单的由来）──────────────────────────────────────────────────
 * 「归因与风险」组原本两项都带 `consolidatedWhen: "sim.sandbox"` ⇒ 沙盘一开整组消失。
 * 后来三张单**各往组里加了一项、每一项都不带** `consolidatedWhen`，理由都是
 * 「沙盘五模式里没有它，带了页面就不可达」——**每条豁免单独看都成立**，
 * 合起来却把整组的收编承诺掏空了：沙盘开着时这个本该消失的组永远剩三项。
 * 形态（铁律 0.6 句式）：
 *   **「我用『每条豁免单独看都成立』当作『整组收编还在生效』的证据，而前者并不度量后者。」**
 * 错不在任何一条豁免，错在**没有任何东西在看合起来的效果**。判据⑨ 就是那个"看合起来"的东西。
 *
 * ── 规则 ──────────────────────────────────────────────────────────────────────
 * 凡有成员带 `consolidatedWhen: X` 的导航组，其余成员**要么也带 `consolidatedWhen: X`，
 * 要么在本表里逐条登记「为什么它不该被 X 收编」**。新增未登记的豁免 ⇒ 门 RC=1。
 * 键的形态：`"<组标题>::<项键>"`；值 = 理由（≥10 字，"待定/TODO" 不算理由）。
 * 陈旧豁免（那一项已经带上 `consolidatedWhen`，或那一项已从组里删掉）同样 RC=1 ——
 * 留着等于给下一个真缺口预留后门（同 `ROUTE_NO_NAV` / `RENDERER_NO_PATH` 的既有纪律）。
 */
export const GROUP_CONSOLIDATION_EXEMPT: Record<string, string> = {
  // 沙盘自己不可能被自己收编 —— 它就是那个控制台。带上 consolidatedWhen 等于「沙盘开着时把沙盘入口藏掉」。
  "推演::sim-sandbox": "它就是被收编进去的那个控制台本身；收编自己在逻辑上不成立（沙盘开着反而必须看得见入口）",
  // 下面四条是**独立场景**（各自的求解器、各自的一整页），不是沙盘的模式或档。
  // 判据不是"能不能塞进去"，是"它回答的是不是沙盘那五问之一"——这四个都不是。
  "推演::project-sim": "独立场景：项目级推演有自己的求解器与整页流程，不是沙盘五问之一；收进去只会把沙盘撑爆",
  "推演::global-sim": "独立场景：全局推演有自己的求解器与整页流程，不是沙盘五问之一；收进去只会把沙盘撑爆",
  "推演::risk": "独立场景：风险看板有自己的数据面与整页流程，不是沙盘五问之一；收进去只会把沙盘撑爆",
  "推演::order-chain": "独立场景：订单全链有自己的求解器与整页流程，不是沙盘五问之一；收进去只会把沙盘撑爆",
  // ── WO-SIM-NAV-UNIFIED · 合并壳自己不可能被自己收编（同 sim-sandbox 那条的形态）──────────
  "推演::sim-unified":
    "它就是本组四个台被收编进去的那个控制台本身（/v/sim-unified）；收编自己在逻辑上不成立，合并壳开着反而必须看得见入口",
  //
  // ── WO-SIM-NAV-UNIFIED · **指控台四页的豁免已删**（不是漏了，是理由失效了）──────────────
  // 上一版这里有四条 `推演::sim-console|sim-conduction|sim-attribution|sim-optimize`，理由逐字是：
  //   「受控键就是 sim.sandbox 本身（VIEW_FEATURE_MAP）：沙盘关时后端不下发、条目自动消失；
  //     再带 consolidatedWhen 会让它开关两态都不出现 = **页面从导航里蒸发**」
  // 那条理由**挡的是「藏起来就等于删掉」**——当时这四页在任何控制台里都没有落点，
  // 藏掉 = 唯一入口消失。今天前提已变（落点见 NAV_GROUPS 那四条旁的长注与
  // `CONSOLIDATED_INTO_SANDBOX` 的四条 `where`），故理由本身已成假命题：
  // 四条现在**确实带着** `consolidatedWhen`，而豁免文案还写着「不能带」——留着就是自相矛盾的记号。
  //
  // ⚠ 这四条**不是被门逼着删的**（本轮实测的一处门盲区，照实记下，别当成「门会兜住」）：
  //   判据⑨ 的陈旧检测 `groupExemptUsed`（`check-nav-group-coverage.mjs:1225-1230`）
  //   只要该项**还在组里**就把豁免记作「已用」，**不看它是否已经带上 `consolidatedWhen`**。
  //   而本表头注写的陈旧判据是「那一项**已经带上 consolidatedWhen**，或那一项已从组里删掉 ⇒ RC=1」
  //   —— **文档说的这一半，实现里并没有**。所以一条已经自相矛盾的豁免可以在这里躺着不被发现。
  //   （门脚本属本单禁区，只记不改；这是留给后续单的一条真缺口。）
};

// WO-SWEEP-03-NAV-GROUP（导航分组防漂移）：export 供 f61 结构守卫——NAV_GROUPS 的 admin 键须覆盖全部 ADMIN_PAGES，
// 防管理页漏登记后再漂到「其它」兜底组（此前 boundary/prototype-intake 即因漏配落「其它」）。
/**
 * WO-IA-E2E5E6 · **刻意不给导航入口的专用 route**（route 保留、深链契约不动）。
 *
 * 与 `CONSOLIDATED_INTO_SANDBOX` 同形态的一张**声明表**：屏上结果（导航里没有这条）与
 * 「忘了登记」一模一样，但性质相反 —— 进本表 = 显式声明「这个入口被仓主从导航里拿掉是有意的」，
 * 有表、有理由、有门对账（`scripts/check-nav-group-coverage.mjs` 判据④ 读这张表；
 * `test/f61.admin-nav-groups.test.tsx` 的到达路径断言同样读这张表，不许另抄一份）。
 * 键必须是 `App.tsx` 里真实存在的专用 route（门会红出陈旧豁免）；route 一删，本表条目必须同删。
 */
export const ROUTE_NO_NAV: Record<string, string> = {
  // 仓主原话：「导航栏里面的『决策推演』不应该在这个位置，而是嵌入到每个需要决策的点」。
  // 已嵌入的决策点：`OrderChainView` 订单面板 · `ChainImpedimentView` 逐条阻滞点 · `ShellLayout` 对话坞上方
  // （三处与页面壳共用 `DecisionPlayPanel` 同一份实现）；沙盘阻滞点 → 方案对比那一跳（`SandboxConsole`）
  // 与驾驶舱入口（`DashboardView`）继续走 `/v/decision-play` 深链 —— route 保留，`imp*` query 契约一个键没动。
  "decision-play":
    "仓主裁决（WO-IA-E2E5E6）：决策推演不该占导航位，已嵌入各决策点（订单链/链阻滞/壳布局三处共用 DecisionPlayPanel）；route 保留 = 深链 query 契约（fromImpediment/imp* 一族）不变",
  // ⚠ WO-CONSOLE-BLOCKERS（本轮）：`decision-console` 的豁免条目**已删**，不是漏了。
  //   上一版这里写着「本单只拿到『这一页』的逐案批准，没拿到动导航的批准；…入口另议」——
  //   **那句话的前提今天已经不成立**：入口已获批，条目落在 `NAV_GROUPS` 顶层无标题组第 2 项
  //   （UX 定案 `docs/LOOP7-ux-review.md` §12.1，理由见那条旁的长注）。
  //   留着就是**陈旧豁免**：判据④ 会红出「这个 route 明明在导航里，却还挂着『刻意不占导航位』」。
  //   （与下面 `sim-unified` 那条同形态、同理由 —— 这已经是第二次执行同一条纪律。）
  // ⚠ WO-SIM-NAV-UNIFIED：`sim-unified` 的豁免条目**已删**，不是漏了。
  //   上一版这里写着「导航信息架构改动未获批 ⇒ route 先通、暂不单列，入口随后续两单一并裁决」——
  //   仓主已裁决（原话见 NAV_GROUPS「推演」组之首的长注），统一推演控制台就是本组的主入口。
  //   条目留着就是**陈旧豁免**：门判据④ 会红出「这个 route 明明在导航里，却还挂着『刻意不占导航位』」。
};
export const NAV_GROUPS: { title: string | null; collapsed?: boolean; items: NavItemRef[] }[] = [
  {
    title: null,
    items: [
      { kind: "view", key: "dash" },
      /**
       * WO-CONSOLE-BLOCKERS · 事件影响与对策（`/v/decision-console`）——**顶层常驻第 2 项**
       * （UX 定案 `docs/LOOP7-ux-review.md` §12.1／§12.6①；仓主已批准本页占导航位）。
       *
       * **X（改之前的屏上行为·真服务真浏览器实测 · 2026-08-29）**：这一页在**三处入口全无** ——
       *   左导航 `GET /a/v1/me/workspace` 下发的条目里 0 条、场景卡 20 张里 0 张、
       *   ⌘K 命令面板（索引即场景卡）自然也 0；而它登记在本文件 `ROUTE_NO_NAV` 里，
       *   理由写的是「没拿到动导航的批准」。⇒ **COO 只能手打 URL 才进得来自己的决策台。**
       *   金丝雀（证明这个查法是活的）：同一次请求里 `dash` 在导航中 4 处、
       *   在场景卡的 `view` 字段中 5 张 —— 尺子没坏，是这一页真的不在。
       * **Y**：顶层无标题组第 2 项，紧跟「经营驾驶舱」。
       *
       * **为什么不进「推演」组**（UX 在真浏览器里跑出来的，不是读代码推的）：
       *   分组折叠态按用户持久化在 `localStorage`（`nav.collapse.推演`）——
       *   实测点一下「▾推演」再刷新，可见链接 63 → **57**，统一推演控制台当场消失且**刷新不回来**。
       *   把「COO 打不开决策台」这个病修进一个**手滑一次就会复发**的位置，方向是反的。
       *   顶层组 `title: null` 不渲染 `NavGroup`、没有折叠钮 ⇒ 折不掉。
       *   `sim-unified` 一行不动（仓主已裁决它是「推演」组主入口）。
       *
       * ⚠ **必须 `kind:"route"` + 内联 label**：后端 `workspace.navigation` 不下发这个键
       *   （实测 51 条里 0 条，datacore/agentcore src 同样 0 命中）。`kind:"view"` 会查下发集合，
       *   查不到就成**幽灵条目**：表里写着、屏幕上永远没有 —— 那正是 `decision-play` 栽过的账。
       * ⚠ **不给 `feature`**：`feature` 的语义是「暗发页，页面侧本就有 Guard」。
       *   `DecisionConsoleView.tsx` 实测 `grep -c "feature\|Guard"` = **0**（金丝雀 `import|export` = 8）
       *   ⇒ 零 entitlement Guard，填上就成了「导航里藏起来、URL 照样进得去」= 把暗发做成假的。
       * ⚠ **不登记 `GROUP_CONSOLIDATION_EXEMPT`**：判据⑨ 只在组内**有** `consolidatedWhen` 成员时触发，
       *   本组零个 ⇒ 登记的键永远不会被记作「已用」，会按**陈旧豁免报红**。加了反而红。
       *
       * 名字取「事件影响与对策」而**不是**「决策台/决策推演」：`decision-play`（「决策推演」）
       *   今天还活着（三处嵌入 + 深链契约）—— 两条名字只差一个字却指两个不同页面，
       *   用户不知道点哪个，这是本仓已记过一次的账。
       */
      { kind: "route" as const, key: "decision-console", label: "事件影响与对策" },
    ],
  },
  { title: "规划与平衡", items: ["annual-scenario", "quarterly-rolling", "sop-balance", "plan-audit", "plan-generate", "review"].map((key) => ({ kind: "view" as const, key })) },
  // WO-NAV-SANDBOX-GROUP：沙盘一家五口此前**一个都没登记**——
  //   · `sim-sandbox` / `sim-init` 落「裸挂」（排在全部 13 个分组之后，屏幕最底）；
  //   · 四个子视图落「其它」兜底组，而那个组里**不多不少正好只有它们四个**
  //     ——一个专为「没人登记的东西」而生的桶，用户当然找不到。
  // 这是同族病的第四层：组件写了 ✅ → renderer 注册 ✅ → 后端派单 ✅ → **归组归进兜底桶 ❌**。
  //
  // WO-ROUTE-NAV-COVERAGE：`sim-sandbox` 从「本文件底部写死的 `<NavLink>`」收编成 `kind:"route"`
  //   —— 写死 NavLink 既不在任何分组里（永远游离于 IA 之外），也不在任何门的射程里
  //   （`nav-group-coverage:check` 只对账 NAV_GROUPS）。收编后与其余专用 route 同一种登记、同一道门；
  //   `feature: "sim.sandbox"` 保住暗发语义（关 → 入口消失）。
  //
  // ⚠ WO-SANDBOX-IA-CONSOLIDATE（本轮）：上一版此处还挂着**九个**推演类入口 ——
  //    五个沙盘子视图（`chain-line-map` / `transit-flow` / `physical-topology` / `node-inspector` /
  //    `chain-impediments`）+ 三个独立推演页（`what-if` / `optimize-whatif`）与隔壁「归因与风险」组的
  //    `cleanroom-attr` / `disruption-radius`。九个**全部已收编进沙盘**（子视图 = 画布模式/图层/常驻栏；
  //    四个推演页 = 沙盘顶部的模式切换），登记表见本文件 `CONSOLIDATED_INTO_SANDBOX`，
  //    逐条到达路径的实测取证见 `docs/AUDIT-sandbox-ia-consolidate.md`（2026-08-10 实测 5/5 绿；
  //    复验：`cd apps/frontend-shell && npx vitest run test/sandbox-ia-consolidate.seam.test.tsx` §件一）。
  //    上一版自己写着「WO-SANDBOX-CONSOLE 落地后这几行应当删掉」——控制台早已落地，这是在执行那条定案。
  //    **保留** `project-sim` / `global-sim` / `risk` / `order-chain`：
  //    它们是独立场景（各自的求解器、各自的一页），不是沙盘的画布模式，收进去只会把沙盘撑爆。
  //    （`decision-play` 原也在此列，WO-IA-E2E5E6 起导航条目删除、route 保留 —— 见 `ROUTE_NO_NAV`。）
  {
    title: "推演",
    items: [
      // ══ WO-SIM-NAV-UNIFIED · 统一推演控制台 = 本组主入口（仓主裁决）══════════════════
      //
      // 仓主原话：「把推演沙盘+4个页面结合在一个页面。base 页面是一个大量的指标卡片，
      //   扰动因素页面是多个子页面，下拉方式输入扰动因素（也可以向上收缩）。
      //   这样避免大规模的后端开发，而是前端的优化。」
      //
      // **X（本轮改之前的屏上行为·2026-08-26 实测）**：合并壳 `UnifiedSimShell` 早已建好、
      //   `App.tsx` 的专用 route `v/sim-unified` 也早已通，但它登记在 `ROUTE_NO_NAV`
      //   （原文：「导航信息架构改动未获批」）⇒ **左侧导航里一个入口都没有，只能手打 URL**。
      //   与此同时本组还并排挂着**四个台**（`sim-console`/`sim-conduction`/`sim-attribution`/
      //   `sim-optimize`），而那四页正是合并壳要收编的对象 ⇒ 屏上是「合并壳点不到 + 被合并的四页
      //   各占一行」，恰好是仓主要求的**反面**。
      // **Y**：合并壳置于本组之首做主入口；四个台带 `consolidatedWhen` 降为壳内页签，不再单列。
      //
      // ⚠ 为什么**不给** `feature: "sim.sandbox"`：`feature` 的语义是「暗发页，页面侧本就有 Guard」
      //   （见 NavItemRef 定义处）。`UnifiedSimShell` **没有任何 entitlement Guard**（实测：
      //   `grep -c "feature\|Guard" views/sim/unified/UnifiedSimShell.tsx` = 0，金丝雀 `import|export` = 20）。
      //   填上就成了「导航里藏起来、URL 照样进得去」——把暗发做成假的。故本条不带 `feature`，
      //   转而逐条登记在 `GROUP_CONSOLIDATION_EXEMPT`（判据⑨ 要求：组内有收编承诺时其余成员须登记）。
      { kind: "route" as const, key: "sim-unified", label: "统一推演控制台" },
      // 旧沙盘**保留单列**：它是 `CONSOLIDATED_INTO_SANDBOX` 里 12 个键的收编宿主
      //   （那张表每条 `where` 都写着「沙盘模式切换 →…」）。把它从导航拿掉 = 那 12 页的
      //   到达路径当场断掉 —— 那是「把 IA 整理做成了功能消失」，本单硬红线禁止。
      //   两者不同名、不同页：合并壳答「这次扰动之后看哪一面」，旧沙盘答「五问」。
      { kind: "route" as const, key: "sim-sandbox", label: "推演沙盘", feature: "sim.sandbox" },
      // ── WO-SIM-NAV-GROUP · 指控台四页归入本组（此前**一条都没登记**）────────────────
      //
      // **X（改之前的屏上行为·仓主真服务真浏览器实测）**：本表里 `sim-console` /
      //   `sim-conduction` / `sim-attribution` / `sim-optimize` 一条都没有，而后端
      //   `synthetic/service.ts` 的 `seedViewConfigs` 照样把这四个键连同 label 派进
      //   `workspace.navigation`（group=business）。`UnifiedNav` 归完组后，没被 `usedViews`
      //   认领的项**全部**落 `leftover` → 推进 `{ title: "其它" }` 兜底桶（本文件 :435）。
      //   于是屏上是：「推演」组里一个「推演沙盘」，「其它」组里另一个「推演沙盘」＋传导识别／
      //   损失归因／方案寻优 —— 两条同名条目指向两个不同页面，用户不知道点哪个。
      //   这正是 `G-NAV-FALLBACK-BUCKET` 那个断点的**第五次**复现（前四次：plan-builder /
      //   boundary / prototype-intake / 沙盘四子视图），形态一字未变：
      //   **「后端派了单 + 前端注册了渲染器 + 路由通」全部成立，唯独没人把它登记进分组表。**
      // **Y**：四页登记进「推演」组，与旧沙盘同组并列；同名歧义在**后端那一份标题**上消除
      //   （`sandbox-console.ts` 的 `SANDBOX_CONSOLE_VIEWS`：`sim-console` →「推演指控台」）。
      //
      // 为什么是 `kind:"view"` 而不是 `kind:"route"`：这四页**没有** `App.tsx` 专用静态 route
      // （只有 `v/:viewKey` 通用分发），走的是后端 `VIEW_DEFS` 增量视图桶下发。挂成 route 会被
      // `check-nav-group-coverage.mjs` 判据⑤（route 条目不是幽灵）当场咬住。
      //
      // ══ WO-SIM-NAV-UNIFIED · 上一版这段注释写的是「为什么**不带** consolidatedWhen」，
      //    本轮**结论反转**，理由照实回写（不是漏改，是前提变了）══════════════════════════
      //
      // 上一版原文：「两态都隐藏 = 这四页永远不出现在导航里，等于把本单要修的病换个方式再犯一次」。
      // 那句话在**当时**是对的 —— 当时这四页在任何控制台里都**没有落点**，藏起来就等于删掉。
      // 今天前提已变：`views/sim/unified/unifiedModes.ts` 的 `UNIFIED_MODE_SPEC` 把其中三页
      // 挂成了合并壳的页签（`conduction`→`sim-conduction` / `attribution`→`sim-attribution` /
      // `optimize`→`sim-optimize`，经 `getRenderer` 走与 `ViewPage` 逐字同构的分发路径），
      // 第四页 `sim-console` 的首屏则由合并壳自带的 `now` 档（37 张指标卡墙）取代 ——
      // 正是仓主那句「base 页面是一个大量的指标卡片」。**有了落点，收编才成立。**
      //
      // ⇒ 于是「两态都隐藏」从**病**变成了**正确行为**：
      //   · 沙盘**开** ⇒ `consolidatedWhen` 命中 ⇒ 不单列（已在合并壳里）；
      //   · 沙盘**关** ⇒ 后端根本不下发（`viewAllowed()` 为假）⇒ 本来就没有。
      //   两态都不占导航位，而**页面一个没删、`/v/<key>` 深链一条没断**（判据⑧b 逐条验这件事）。
      //
      // ⚠ **条目本身必须留着，不许改写成删除**（这一条最容易做反，代价是静默的）：
      //   `scripts/lib/sim-page-roster.mjs` 的判据 **R3 `nav-sim-group`** 读的是**本表的源码文本**，
      //   而这四页**只经 R3 一条路进推演页名册**（实测：`node` 现算 R3 含此四键，R1/R2/R4/R5 全不含）。
      //   删条目 ⇒ 名册 17 → 13 ⇒ `check-edge-active-mounts.mjs` 的**名册缩水棘轮**当场红
      //   （它的注释逐字写着「或**把一页移出「推演」导航组**…这就是『漏检永远绿』正在复发」），
      //   更糟的是这四页会**悄悄退出 UX 判据的受检面**。带 `consolidatedWhen` 则两全：
      //   屏上不单列（IA 干净），名册里还在（照旧受检）。
      //
      // ⚠ `consolidatedWhen` 的值必须**恰好是 `"sim.sandbox"`**，不许另起一个键：判据⑨ 规定
      //   「一组里出现两个不同的 `consolidatedWhen` 值时，带 X 的成员对 Y 那条承诺同样算掏空」，
      //   而本组既有的 `what-if`/`optimize-whatif` 用的就是 `"sim.sandbox"`。
      //
      // ⚠ **必须逐条写成对象字面量，不许缩回 `.map()` 形态**（本轮实测踩到，机器先说话）：
      //   上一版这四条是 `...[...].map((key) => ({ kind: "view" as const, key }))`。本轮先按
      //   `.map((key) => ({ …, consolidatedWhen: "sim.sandbox" }))` 改了一版，跑门当场发现
      //   判据⑨ 报「sim.sandbox 开时本组还剩 **10** 项」——若四条被认到，该数应是 6。
      //   即：`check-nav-group-coverage.mjs` 与 `sim-page-roster.mjs` 的 NAV_GROUPS 解析器
      //   从 `.map` 形态里只捞得到**键名数组**，捞不到回调里那个对象的 `consolidatedWhen`
      //   ⇒ 屏上真隐藏了，而**门以为它们还单列着**（判据⑧a/⑧f 也随之全部失准）。
      //   这正是本仓「拿一个看起来相关的数字当判据」的老形态，判据落在**写法**上而非意图上。
      //
      // 顺序 = 决策链序（与后端 `SANDBOX_CONSOLE_VIEWS` 的声明顺序逐字同序）：
      //   现状（指控台）→ 传导识别 → 损失归因 → 方案寻优。
      // label 一律**不在本表内联** —— `kind:"view"` 项的文案取 `workspace.navigation[].label`，
      // 单一出处在后端那份 view 定义里。本仓最恨双份真相源，这里不许开第二份。
      { kind: "view" as const, key: "sim-console", consolidatedWhen: "sim.sandbox" },
      { kind: "view" as const, key: "sim-conduction", consolidatedWhen: "sim.sandbox" },
      { kind: "view" as const, key: "sim-attribution", consolidatedWhen: "sim.sandbox" },
      { kind: "view" as const, key: "sim-optimize", consolidatedWhen: "sim.sandbox" },
      // ── 并线单 WO-SANDBOX-UI-INTEGRATE 的一处**方向性裁决**（两条分支在此真对立）─────
      // · WO-IMPEDIMENTS-REACHABLE 要把 `chain-line-map` / `transit-flow` / `physical-topology` /
      //   `node-inspector` / `chain-impediments` 五个键**加进本组**做导航入口 ——
      //   它的目标是「让 chain-impediments 有一条渲染得到的路」（此前后端不派单 + 无专用 route ⇒ 零路径）。
      // · WO-SANDBOX-IA-CONSOLIDATE 反过来把这五个键**从导航移走**，收编进沙盘（一屏五模式）。
      // 裁决取后者，因为**它把前者的目标办成了、且办得更严**：五个键逐条登记在
      // `CONSOLIDATED_INTO_SANDBOX`，每条写明沙盘内的到达路径；而门 `check-nav-group-coverage.mjs`
      // 判据⑧ 会反过来验「收编不是删除」——其中 ⑧a 明令**不许两头占**（导航里还留 kind:"view" 条目
      // = 重复入口 = 收编没发生）。故若照 impediments-reachable 一侧把五个键加回来，那道门当场变红。
      // 也就是说：这不是我在两个都行的方案里挑一个，是机器先说话（复验见提交说明）。
      ...["project-sim", "global-sim", "risk", "order-chain"].map((key) => ({ kind: "view" as const, key })),
      // 专用 route（App.tsx `{ path: "v/<静态段>" }`·免 workspace 下发即可达）。
      // `decision-play` 的导航条目**已删**（仓主裁决 WO-IA-E2E5E6，登记在本文件 `ROUTE_NO_NAV`）：
      // 「决策推演不应该在导航这个位置，而是嵌入到每个需要决策的点」——route 保留（深链契约不动）。
      // ── 已收编进沙盘模式切换的四页：`consolidatedWhen` 开 → 隐藏（详见类型定义处的语义说明）──
      // 沙盘关着的租户仍看得到它们（这四页本身不受 sim.sandbox 门控，人人可进）。
      { kind: "route" as const, key: "what-if", label: "假设推演", consolidatedWhen: "sim.sandbox" },
      { kind: "route" as const, key: "optimize-whatif", label: "优化推演", consolidatedWhen: "sim.sandbox" },
    ],
  },
  // WO-ROUTE-NAV-COVERAGE：归因/影响面两页此前**零导航提及**——只能手敲 URL 才进得去。
  // 不并进「推演」组：它们回答的不是"改一个假设会怎样"（推演），而是"现状为什么这样 / 波及多大"（归因）。
  // WO-SANDBOX-IA-CONSOLIDATE：归因/影响半径**二者**已收编进沙盘模式切换，故同带 `consolidatedWhen`。
  //
  // ⚠⚠ WO-SANDBOX-NAV-CONSOLIDATE（本轮）· **上面那两条订正记的是同一个病，而它们记的方向是错的**。
  //    历史原文（已删）逐条写着：「WO-MERGE-11 订正：沙盘开时本组剩『流程等待』一项，组不再自动隐藏，
  //    **这是正确行为，不是漏配**」→「WO-R9-NAVREACH 再订正一次同一句：本组现有四项…剩两项（不是一项）」。
  //    仓主看到屏幕后的原话是：**「为何导航栏还有这2个，我之前不是要求你调整吗？」**
  //    ⇒ 那两条订正每次都只更新了**数字**（一项 → 两项），从没问过「这个数为什么不是零」。
  //    形态（铁律 0.6 句式）：**「我用『每条豁免单独看都成立』当作『整组收编还在生效』的证据。」**
  //    三条豁免（process-wait / procurement-legs / process-stuck）**每一条的理由都是真的** ——
  //    当时沙盘里确实没有它们的落点，带上 `consolidatedWhen` 就是把唯一入口删掉、页面不可达。
  //    真正缺的不是第四条豁免，是**给它们在沙盘里造一个落点**。本轮做的就是这件事：
  //    三页收进沙盘「归因」模式的三个**档**（`views/sim/sandboxModes.ts` 的
  //    `SANDBOX_ATTRIBUTE_TAB_SPEC`），于是三条豁免的前提消失，`consolidatedWhen` 可以带上了。
  //    ⇒ **沙盘开时本组五项全隐藏 ⇒ 空组自动隐藏**（回到原设计）；沙盘关时五项全在（收编 ≠ 删除）。
  //    机器那一半：`scripts/check-nav-group-coverage.mjs` 判据⑨ —— 组里再出现未登记的豁免即 RC=1，
  //    报文点明「本组的收编承诺正在被掏空：X 开时本组还剩 N 项」。这条以后不靠人想起来。
  {
    title: "归因与风险",
    items: [
      // WO-WAITING-STATES-FE：流程等待态（需求 §20）——回答「为什么这个流程现在卡住了」。
      // 归此组不归「推演」：它答的是「现状为什么这样」（归因），不是「改一个假设会怎样」（推演）。
      // kind:"view" 而非 route —— 它经后端 BUILTIN_VIEWS 下发（租户本体数据 + R3 级联）。
      // WO-SANDBOX-NAV-CONSOLIDATE：已收编为沙盘「归因」模式的**模板层档**，故带 consolidatedWhen；
      // 条目**保留**（本页不受 sim.sandbox 门控）—— 沙盘关 ⇒ 照旧单列，不让页跟着沙盘蒸发。
      { kind: "view" as const, key: "process-wait", consolidatedWhen: "sim.sandbox" },
      // WO-R9-NAVREACH：采购四段腿分解（「该找谁」页）——回答「这批料晚在哪一段、今天该打哪通电话」。
      // kind:"view" 而非 route —— 它经后端 BUILTIN_VIEWS 下发
      // （租户本体数据 + R3 级联 + `view.options` 只有 ViewConfig 这条路送得到，见后端该行注释）。
      // WO-SANDBOX-NAV-CONSOLIDATE：已收编为沙盘「归因」模式的**责任方档**（同上，条目保留做回退）。
      { kind: "view" as const, key: "procurement-legs", consolidatedWhen: "sim.sandbox" },
      // WO-PROCESS-INSTANCE：流程卡点（**实例层**）——与 `process-wait` 是**两页**，不是重复入口：
      //   · `process-wait`（模板层）答「这**类**流程通常在等哪一类东西」（65 条定义的 waitKind，平均值）；
      //   · `process-stuck`（实例层）答「**这一张单**此刻卡在第几步、等谁、等了多久」（现场值）。
      // 合并单 WO-R9-PROCESS-MERGE 新立的 `waitStateOrigin` 诚实位分的正是这两者
      // （`DEFINITION_TEMPLATE` vs `TASK_GATE`），把它们并成一个入口就等于把那条诚实位在 IA 层抹掉。
      // ⇒ **收编后它们仍是两个入口**（沙盘里的两个档），这条裁决本轮一个字没动。
      //
      // kind:"view"（不是 route）：它经后端下发（`synthetic/service.ts` 增量视图桶），
      // 且必须有 R3 页面侧守卫 —— `process.runtime` 是暗发键（defaultOn:false +
      // INCOMPLETE_DATA_DARK_LAUNCH_FEATURES），挂成 route 会变成「关着也手敲得进去」。
      // ⚠ 收编后 R3 守卫**没有丢**：沙盘里那一档走的是与 `ViewPage` 逐字同构的双闸分发
      //   （features 有没有 `view.process-stuck` + `workspace.views` 有没有它），
      //   暗发键关着时**连档位按钮都不渲染**（不是禁用按钮 —— 禁用同样泄露存在性）。
      { kind: "view" as const, key: "process-stuck", consolidatedWhen: "sim.sandbox" },
      { kind: "route" as const, key: "cleanroom-attr", label: "净室归因", consolidatedWhen: "sim.sandbox" },
      { kind: "route" as const, key: "disruption-radius", label: "断供影响半径", consolidatedWhen: "sim.sandbox" },
    ],
  },
  { title: "台账与地图", items: ["order", "geo-map"].map((key) => ({ kind: "view" as const, key })) },
  { title: "数据接入", items: ["connections", "rule-docs", "synthetic", "external-signals", "quarantine"].map((key) => ({ kind: "admin" as const, key })) },
  {
    title: "建模与图谱",
    items: [
      { kind: "view", key: "graph" },
      // WO-SWEEP-03-NAV-GROUP：boundary（边界册治理）/ prototype-intake（原型 intake）归「建模与图谱」组，
      // 对齐 adminRegistry modeling 组（此前二者缺登记 → 真实导航里落「其它」兜底组）。
      // ⚠ WO-BEFE-A：`ontology-relations`（本体关系编辑器）必须同时登记在**这里**与
      //   `adminRegistry.ADMIN_NAV_GROUPS` —— 只改后者的话，左导航渲染读的是本表，
      //   该页会掉进「其它」兜底桶（plan-builder / boundary / prototype-intake 都是这么漏的）。
      ...["modeling", "object-types", "domains", "interfaces", "ontology-relations", "slices", "slice-library", "merge", "boundary", "prototype-intake"].map((key) => ({ kind: "admin" as const, key })),
    ],
  },
  // 图谱八视角子视图：折叠子组，保留既有 collapsed 行为（图谱页内亦可 tab）。
  {
    title: "图谱体系",
    collapsed: true,
    items: ["graph-all", "graph-backbone", "graph-flow", "graph-source", "graph-solver", "graph-mvp", "graph-agent", "graph-loop"].map((key) => ({ kind: "view" as const, key })),
  },
  { title: "规则与校准", items: ["rules", "calibration"].map((key) => ({ kind: "admin" as const, key })) },
  { title: "构建与成长", items: ["data-builder", "pipelines", "growth", "evals", "solvers", "solver-review"].map((key) => ({ kind: "admin" as const, key })) },
  // ⚠ 新增管理页必须同时登记进**这里**：`adminRegistry.groupAdminPages` 只有 f61 测试在读，
  //   左导航真正渲染用的是 NAV_GROUPS。只改前者 ⇒ 该页在真实导航里掉进「其它」兜底桶。
  //   plan-builder 就是这么漏的（与 boundary/prototype-intake 同一形态，f61 结构守卫当场咬住）。
  { title: "编排与场景", items: ["catalog", "agents", "workflows", "skills", "mcp", "scenes", "resources", "plan-builder", "ops/fallback", "views"].map((key) => ({ kind: "admin" as const, key })) },
  // WO-BEFE-B：scheduler / calendars 两个新页同时登记进 adminRegistry.ADMIN_NAV_GROUPS 与**这里**
  //（照上面那条警告：只改前者会掉进「其它」兜底桶）。
  // WO-BEFE-D：`org`（组织世界）与 `actions`（审批中心）相邻 —— 前者答「该谁批」，后者是「真去批」。
  // 两处分组源（本表 + adminRegistry.ADMIN_NAV_GROUPS）必须同改，f61 结构守卫按 ADMIN_PAGES 全覆盖对账。
  { title: "运营与审批", items: ["actions", "org", "ops-schedule", "scheduler", "calendars", "notifications", "validation"].map((key) => ({ kind: "admin" as const, key })) },
  // WO-SWEEP-03-NAV-GROUP · meta 归组定音：meta（系统自我 = 平台自我元模型 / dogfooding 本体查看器）是平台描述自身的
  // 治理/系统级构件（非租户业务建模），故 adminRegistry(建模) 与 ShellLayout(平台与系统) 的分歧在此按「平台与系统」定案；
  // 同步把 adminRegistry.ADMIN_NAV_GROUPS 的 meta 从 modeling 挪到 governance，两处分组源就此对齐、不再漂移。
  { title: "平台与系统", items: ["tenants", "users", "permissions", "features", "llm-providers", "config-migration", "meta"].map((key) => ({ kind: "admin" as const, key })) },
];

type NavItemVM = { key: string; label: string; viewKey?: string; group?: string };
type AdminPage = { path: string; label: string };

/**
 * 统一域分组导航（N1）：视图项 + 管理页 + 专用路由页合一套域分组渲染。
 * · view  项查 workspace.navigation（命中且可见）——后端下发驱动；
 * · admin 项查 visibleAdminPages（角色命中）；
 * · route 项（WO-ROUTE-NAV-COVERAGE）**不查任何集合，无条件渲染**——这正是专用 route 的设计意图
 *   （静态段先于 `:viewKey` 匹配，免下发即可达）；仅当声明了 `feature`（暗发页）才按 entitlement 显隐。
 * 空组隐藏；NAV_GROUPS 未覆盖的项落「其它」组不丢；复用 NavGroup 折叠记忆。
 */
function UnifiedNav({
  views: allViews,
  adminPages,
  workspace,
}: {
  views: NavItemVM[];
  adminPages: AdminPage[];
  workspace: Workspace | undefined;
}) {
  /**
   * WO-SANDBOX-IA-CONSOLIDATE · **收编键必须在进 leftover 之前就滤掉**。
   *
   * 这一行是本单最容易漏掉、漏掉后果最直接的一行：后端仍然把这五个键派进 `workspace.navigation`
   * （**必须**仍派 —— 停派 = `/v/<key>` 深链接当场 404，见 AUDIT §4）。只把它们从 `NAV_GROUPS`
   * 里删掉的话，下面的 `leftover` 会照单全收，它们**原地掉进「其它」折叠兜底桶** ——
   * 那正是 `G-NAV-FALLBACK-BUCKET` 这个断点本身，比单列还糟（单列至少找得到）。
   * 故过滤放在最前面，一次盖住分组与兜底两条路。
   */
  /**
   * WO-SANDBOX-NAV-CONSOLIDATE · **条件收编**：`consolidatedWhen` 开着才算收编。
   *
   * 这张 Map 必须在 `views` 过滤**之前**算好，理由与上一段一模一样：条件收编的键若只从
   * 分组循环里 `return null`，`leftover` 会照单全收 ⇒ 原地掉进「其它」兜底桶。
   * 一次过滤盖住分组与兜底两条路 —— 这是本文件最容易漏、漏了后果最直接的一行。
   */
  const conditionalConsolidation = new Map(
    NAV_GROUPS.flatMap((g) => g.items)
      .filter((it): it is Extract<NavItemRef, { kind: "view" }> => it.kind === "view" && it.consolidatedWhen !== undefined)
      .map((it) => [it.key, it.consolidatedWhen!] as const),
  );
  const views = allViews.filter((it) => {
    const key = it.viewKey ?? it.key;
    const when = conditionalConsolidation.get(key);
    // 条件收编：开关**开**着 ⇒ 已在控制台里 ⇒ 不单列；关着 ⇒ 条目照旧（不让页跟着控制台蒸发）。
    if (when !== undefined) return !featureOn(workspace, when);
    // 无条件收编：只用于随同一个 entitlement 一起消失的键（那五个沙盘子视图）。
    return !CONSOLIDATED_INTO_SANDBOX[key];
  });
  const viewByKey = new Map(views.map((it) => [it.viewKey ?? it.key, it]));
  const adminByPath = new Map(adminPages.map((p) => [p.path, p]));
  const usedViews = new Set<string>();
  const usedAdmin = new Set<string>();

  const resolved = NAV_GROUPS.map((g) => {
    const links = g.items
      .map((ref) => {
        if (ref.kind === "route") {
          // 无条件渲染（无下发依赖）；`feature` 只服务于暗发页：关 → 入口消失（R3 不泄露存在性）。
          if (ref.feature && !featureOn(workspace, ref.feature)) return null;
          // WO-SANDBOX-IA-CONSOLIDATE · 收编开关（与上一行**方向相反**：这条是"开就隐藏"）。
          // 那个控制台在 ⇒ 本页已在它里面 ⇒ 单列 = 重复入口；控制台不在 ⇒ 条目照旧（不让页跟着蒸发）。
          if (ref.consolidatedWhen && featureOn(workspace, ref.consolidatedWhen)) return null;
          return <RouteItemLink key={`r:${ref.key}`} routeKey={ref.key} label={ref.label} />;
        }
        if (ref.kind === "view") {
          const it = viewByKey.get(ref.key);
          if (!it) return null;
          usedViews.add(ref.key);
          return <NavItemLink key={`v:${ref.key}`} item={it} />;
        }
        const p = adminByPath.get(ref.key);
        if (!p) return null;
        usedAdmin.add(ref.key);
        return <AdminItemLink key={`a:${ref.key}`} page={p} />;
      })
      .filter((x): x is JSX.Element => !!x);
    return { title: g.title, collapsed: g.collapsed, links };
  }).filter((g) => g.links.length > 0);

  // 未归组的项落「其它」（不丢，R3 仍过滤后才到这里）。
  const leftover = [
    ...views.filter((it) => !usedViews.has(it.viewKey ?? it.key)).map((it) => <NavItemLink key={`v:${it.viewKey ?? it.key}`} item={it} />),
    ...adminPages.filter((p) => !usedAdmin.has(p.path)).map((p) => <AdminItemLink key={`a:${p.path}`} page={p} />),
  ];
  if (leftover.length > 0) resolved.push({ title: "其它", collapsed: undefined, links: leftover });

  return (
    <>
      {resolved.map((g, i) =>
        g.title === null ? (
          g.links
        ) : (
          <NavGroup key={g.title} title={g.title} defaultCollapsed={g.collapsed} index={i}>
            {g.links}
          </NavGroup>
        ),
      )}
    </>
  );
}

/**
 * 侧栏导航图标（Feather 风·线性·stroke=currentColor·18px）。
 * 结构层（全主题共享）：图标随 navItem 的 color 走 —— 活跃项 pill 上转白（--nav-active-txt），
 * 非活跃取 --muted。按 nav key 映射业务语义；未知 key 落通用「圆点」图标（不丢项、看齐旧行为）。
 */
const NAV_ICON_PATHS: Record<string, string> = {
  // 经营驾驶舱 —— grid
  dash: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  // 规划与平衡 —— calendar（年度/季度/月度/生成）
  "annual-scenario": "M3 4h18v18H3zM3 10h18M8 2v4M16 2v4",
  "quarterly-rolling": "M3 4h18v18H3zM3 10h18M8 2v4M16 2v4",
  "sop-balance": "M3 4h18v18H3zM3 10h18M8 2v4M16 2v4",
  "plan-generate": "M3 4h18v18H3zM3 10h18M8 2v4M16 2v4",
  // 体检 / 复审 —— check-circle
  "plan-audit": "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
  review: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
  calibration: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
  // 推演 —— 项目推演(activity) / 全局(globe) / 产能(bar) / 订单全链(layers) / 决策(zap)
  "project-sim": "M22 12h-4l-3 9L9 3l-3 9H2",
  "global-sim": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
  risk: "M12 20V10M18 20V4M6 20v-4",
  "order-chain": "M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  "decision-play": "M13 2 3 14h9l-1 8 10-12h-9z",
  "sim-sandbox": "M13 2 3 14h9l-1 8 10-12h-9z",
  // WO-SIM-NAV-GROUP 指控台四页 —— 指控台(monitor) / 传导(share) / 归因(trending-down) / 寻优(crosshair)。
  // 刻意**不与** `sim-sandbox` 用同一个 zap：两条曾经同名的条目若再共用图标，改了标题也还是一眼分不开。
  "sim-console": "M2 3h20v14H2zM8 21h8M12 17v4",
  "sim-conduction": "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6M8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  "sim-attribution": "M3 3v18h18M7 9l4 5 3-3 5 6",
  "sim-optimize": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M22 12h-4M6 12H2M12 6V2M12 22v-4",
  // WO-ROUTE-NAV-COVERAGE 专用 route 页 —— 假设推演(sliders) / 优化推演(target) / 净室归因(pie) / 断供半径(alert)
  "what-if": "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  "optimize-whatif": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2",
  "cleanroom-attr": "M21.2 15.9A10 10 0 1 1 8.1 2.8M22 12A10 10 0 0 0 12 2v10z",
  "disruption-radius": "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  // 台账与地图 —— list / map-pin
  order: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  "geo-map": "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  // 建模与图谱 —— share
  graph: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 3.9M15.4 6.5 8.6 10.5",
  // 数据接入 —— link / file / database / radio / shield
  connections: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  "rule-docs": "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  synthetic: "M12 2C7 2 4 4 4 6s3 4 8 4 8-2 8-4-3-4-8-4zM4 6v6c0 2 3 4 8 4s8-2 8-4V6M4 12v6c0 2 3 4 8 4s8-2 8-4v-6",
  "external-signals": "M4.9 19.1a10 10 0 0 1 0-14.2M8.5 15.5a5 5 0 0 1 0-7M12 12h.01M15.5 8.5a5 5 0 0 1 0 7M19.1 4.9a10 10 0 0 1 0 14.2",
  quarantine: "M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z",
};
const NAV_ICON_DEFAULT = "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"; // 通用圆点（未知业务 key 兜底·不丢项）

function NavIcon({ nav }: { nav: string }) {
  const d = NAV_ICON_PATHS[nav] ?? NAV_ICON_DEFAULT;
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function NavItemLink({ item }: { item: NavItemVM }) {
  return (
    <NavLink
      to={`/v/${item.viewKey ?? item.key}`}
      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}
    >
      <NavIcon nav={item.viewKey ?? item.key} />
      {item.label}
    </NavLink>
  );
}

/**
 * 专用路由页链接（WO-ROUTE-NAV-COVERAGE）：`to` 与 App.tsx 的 `{ path: "v/<key>" }` 同一个静态段，
 * `data-testid` 便于测试/门按 key 定位（写死 `<NavLink>` 时代 sim-sandbox 就是靠这个 testid 被测到的，保留同款口径）。
 */
function RouteItemLink({ routeKey, label }: { routeKey: string; label: string }) {
  return (
    <NavLink
      to={`/v/${routeKey}`}
      data-testid={`nav-${routeKey}`}
      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}
    >
      <NavIcon nav={routeKey} />
      {label}
    </NavLink>
  );
}

function AdminItemLink({ page }: { page: AdminPage }) {
  return (
    <NavLink to={`/admin/${page.path}`} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}>
      <NavIcon nav={page.path} />
      {page.label}
    </NavLink>
  );
}

function NavGroup({ title, defaultCollapsed, children }: { title: string; defaultCollapsed?: boolean; index: number; children: ReactNode }) {
  const storeKey = `nav.collapse.${title}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(storeKey) : null;
    return v === null ? !!defaultCollapsed : v === "1";
  });
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(storeKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  return (
    <div className={styles.navGroupBlock} data-testid={`nav-group-${title}`}>
      <button
        type="button"
        className={styles.navGroupHeader}
        data-testid={`nav-group-toggle-${title}`}
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <span style={{ display: "inline-block", width: 10, transition: "transform .15s", transform: collapsed ? "rotate(-90deg)" : "none" }}>▾</span>
        {title}
      </button>
      {/* 折叠时保留 DOM（仅 CSS 隐藏）：可访问性 + 不丢失活动路由项 */}
      <div style={{ display: collapsed ? "none" : "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

/** Workspace Shell（PRD §6.1）：左导航 + 顶栏 + 内容区 + 查询 Dock */
export default function ShellLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  /** 冷启动会话恢复是否已完成 —— 唯一作用是**触发一次重渲染**，让 `useWorkspace` 的
   *  `enabled: tokenStore.get() != null` 重新求值（`tokenStore` 不是响应式的）。 */
  const [, setRestored] = useState(false);
  const { data: workspace, isLoading, isError } = useWorkspace();
  const [historyOpen, setHistoryOpen] = useState(false);

  // D-29 实时环 F1：登录后常驻轮询领域事件，把上游变更反映到被动页面（跨会话传播）。
  useDomainEventStream(!!workspace);

  /**
   * 挂载守卫。**改前是一条真 bug**（仓主 2026-08-26 逐环诊断，四环相扣）：
   *   ① access token 只存内存（`tokenStore`，PRD §4.1 设计：不进 localStorage）
   *      ⇒ 地址栏敲 URL 回车 / F5 = 整页重载 = token 没了；
   *   ② 本守卫**在任何 API 发出去之前**就 `navigate("/login")` ——
   *      而 `apiClient` 的静默刷新只在**挨了 401** 才触发 ⇒ 冷启动永远轮不到它，
   *      哪怕 refresh cookie 还好好地在那儿；
   *   ③ 登录成功写死回首页，不回跳原地址。
   * 净效果：**深链接与刷新恒等于掉线**，而且掉得毫无道理 —— 会话其实还活着。
   *
   * 改后：先 `restoreSession()`（拿 httpOnly refresh cookie 换 access token），
   * 换不出来才跳登录，且**把原地址带上**供登录后回跳。
   *
   * ⚠️ `cancelled` 这道闸不是装饰：`restoreSession()` 是异步的，组件可能在它落地前
   *    就卸载了（用户手快点了别处）。不拦就会对着已卸载的组件 `navigate`，
   *    在 React 18 严格模式下还会因双次挂载**打两次 refresh** —— 而 refresh token
   *    是轮换的，第二次拿着已作废的那个去换，等于把好端端的会话亲手弄死。
   */
  useEffect(() => {
    let cancelled = false;
    if (tokenStore.get()) return;
    void restoreSession().then((ok) => {
      if (cancelled) return;
      if (!ok) {
        // 带上原地址（含 search/hash）：登录后回到用户本来要去的地方，而不是一律甩回首页。
        navigate("/login", { replace: true, state: { from: location.pathname + location.search + location.hash } });
        return;
      }
      // ⚠️ 换到 token **还不够**，必须再踢一脚让依赖它的查询重跑。
      //    `useWorkspace.ts:12` 写的是 `enabled: tokenStore.get() != null` —— 这是**渲染期求值**，
      //    而 `tokenStore` 是个普通模块变量、不是响应式 store ⇒ 恢复成功后没有任何东西触发重渲染，
      //    `enabled` 永远停在挂载那一刻算出来的 `false`，屏上就永远停在「加载中…」。
      //    2026-08-26 实测形态：`/a/v1/auth/refresh` **回了 200**，而 `/a/v1/me/workspace` 一次都没发出去 ——
      //    「会话恢复失败」与「恢复成功但没人去取数」在屏上一模一样，都是转圈。
      //    `setRestored` 触发重渲染让 `enabled` 重算，`resetQueries` 把挂载期那些
      //    disabled 状态的查询清掉重来（只 invalidate 不够：disabled 的查询不会因失效而重跑）。
      setRestored(true);
      void qc.resetQueries();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 主题由 workspace.theme 覆盖 token（不同账号不同前端的视觉部分）
  useEffect(() => {
    applyTheme(workspace?.theme as Record<string, unknown> | undefined);
  }, [workspace?.theme]);

  useConfigVersionWatcher();

  if (isLoading || !workspace) {
    return <div className="empty-state">{isError ? zh.errors.pageError : zh.common.loading}</div>;
  }

  const roles = workspace.user?.roles ?? [];
  const adminPages = visibleAdminPages(roles);
  const onViewPage = location.pathname.startsWith("/v/");
  const dockOn = featureOn(workspace, "shell.query-dock");

  return (
    <div className={styles.shell}>
      {/* WO-CONSOLE-BLOCKERS · 壳级 skip-link：**必须是文档第 1 个可聚焦元素**，
          所以它写在 `<header>` 之前而不是里面（DOM 顺序就是 Tab 顺序）。
          落点 `<main id="main-content" tabIndex={-1}>` —— `tabIndex={-1}` 不进 Tab 序列，
          只是让 `<main>` 能**被程序性聚焦**；少了它，跳转后焦点会退回 body，
          下一次 Tab 又从顶栏第一站开始，等于没跳。样式见 `.skipToMain`。 */}
      <a className={styles.skipToMain} href="#main-content" data-testid="skip-to-main">
        跳到主内容
      </a>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.logo} />
          <div>
            <h1>{zh.common.appName}</h1>
            <span className={styles.tenant} data-testid="tenant-name">
              {workspace.tenant.name ?? workspace.tenant.id}
            </span>
          </div>
        </div>
        <GlobalSearch />
        {/* 历史记录入口（时钟图标）：侧滑面板看本租户推演历史（所有登录用户可见自己的） */}
        <button
          className="btn sm"
          aria-label="推演历史"
          title="推演历史"
          data-testid="history-clock"
          style={{ fontSize: 15, lineHeight: 1 }}
          onClick={() => setHistoryOpen(true)}
        >
          🕐
        </button>
        {/* 运营态增量 §4.5：全局合成水印徽章（hover 显示 generatedFrom 与 seed；随 LIVE 占比消退） */}
        <SyntheticWatermark />
        {/* §7.22 数据健康度小徽章（任一源延迟 → 黄点） */}
        <HealthBadge />
        {/* WO-THEME-SWITCH-U8：明暗主题开关（轨O）——暗色默认，切浅色落 localStorage */}
        <ThemeToggle />
        <UserMenu username={workspace.user?.username ?? "—"} />
      </header>

      <aside className={styles.nav} data-testid="left-nav">
        {/* 场景启动器入口（PRD-scenario-launcher §3.5）：目录墙 + ⌘K 快搜 */}
        {/* 场景启动器（顶层特殊入口·保留 ⚡ 前缀：既作图标、又使链接文案 ≠ 启动器页标题「场景启动器」，避免 getByText 撞车 f53b） */}
        <NavLink to="/scenarios" data-testid="nav-scenario-launcher" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ""}`}>
          ⚡ 场景启动器
        </NavLink>
        {/* N1 统一域分组：视图 + 管理页合一套域分组（配置驱动 R14）；逐项按角色/entitlement 过滤；空组隐藏；折叠记忆。 */}
        <nav className={styles.group} data-testid="nav-business">
          {/* WO-ROUTE-NAV-COVERAGE：此处此前写死两个 `<NavLink>`（sim-sandbox / sim-init）。
              上一版把它们从 `<UnifiedNav>` 之后挪到之前，治的是"排在 13 个分组 60+ 条叶项的最底部"；
              但**两套机制**这个根因没治：写死 NavLink 游离于 NAV_GROUPS 之外 ⇒ ① 永远进不了 IA 分组，
              ② 永远在 `nav-group-coverage:check` 的射程之外（那道门只对账 NAV_GROUPS）。
              现已收编为 `kind:"route"` 条目（见 NAV_GROUPS「推演」组之首），
              entitlement 语义一字未动：`feature: "sim.sandbox"` 关 → 入口照样消失（R3 暗发）。
              （「推演初始化向导」已退役，其「进沙盘前先选范围」并入控制台，不再有第二个入口。） */}
          <UnifiedNav
            views={workspace.navigation.filter((item) => item.group !== "admin")}
            adminPages={adminPages}
            workspace={workspace}
          />
        </nav>
      </aside>

      {/* `id`/`tabIndex` 是壳级 skip-link 的落点（键盘绕过导航直达正文）；
          与下面的崩溃边界互不相干，两者都要保留。 */}
      <main className={styles.content} id="main-content" tabIndex={-1}>
        {/* WO-ONTO-CRASH · 崩溃必须有**边界**：`resetKey` 传当前路由 ⇒ 换页即清错误态。
            不传的话，`Outlet` 换孩子而边界组件自己不卸载 —— 一页崩了会把**整个后台钉死**，
            只有 F5 能救（2026-08-30 真浏览器实测：隔离区崩后导航去 /v/quarterly-rolling 也是崩溃页）。 */}
        <ErrorBoundary resetKey={location.pathname} onRecover={() => navigate(-1)}>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Dock 在所有 /v/:viewKey 页面常驻；admin 页面不显示；受 shell.query-dock BLOCK 控制 */}
      {onViewPage && dockOn && <QueryDock />}
      {/* ⌘K 场景命令面板：全局快捷键唤起（场景启动器 §3.5-A） */}
      <CommandPalette />
      {/* 历史记录侧滑面板（顶栏时钟触发，所有登录用户可见） */}
      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

/**
 * 全局合成运营态水印（运营态增量 §4.5）：租户数据为 livedIn 合成时常驻顶栏；
 * hover（title）显示 generatedFrom（industry/scale/回放窗口）与 seed；
 * §6 替换路径接入 LIVE 后按占比淡出（opacity 随 liveRatio 下降）。
 */
function SyntheticWatermark() {
  const { data } = useQuery({
    queryKey: ["a", "history-watermark"],
    queryFn: fetchHistoryWatermark,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!data?.synthetic) return null;
  const liveRatio = data.liveRatio ?? 0;
  const hover = [
    `合成运营态 · generatedFrom: ${data.industry ?? "—"} / ${data.scale ?? "—"} · seed ${data.seed ?? "—"}`,
    `回放窗口 ${data.replayFrom ?? "—"} ~ ${data.replayTo ?? "—"}`,
    liveRatio > 0 ? `LIVE 已回填 ${(data.liveMonths ?? []).join("、")}（占比 ${(liveRatio * 100).toFixed(0)}%）` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className="badge amber"
      data-testid="synthetic-watermark"
      title={hover}
      style={{ opacity: Math.max(0.3, 1 - liveRatio), cursor: "help" }}
    >
      合成数据
    </span>
  );
}

function UserMenu({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  // 头像位（圆形·取用户名首字·大写）：视觉锚点，保留原 testid/菜单行为不变。
  const initial = (username.trim()[0] ?? "?").toUpperCase();
  return (
    <div className={styles.userMenu}>
      <button className={styles.userBtn} onClick={() => setOpen(!open)} data-testid="user-menu-btn" title={username} aria-label={username}>
        <span className={styles.avatar} aria-hidden>{initial}</span>
        <span className={styles.userName}>{username}</span>
        {/* WO-R9-CONTRAST：原带 opacity:0.6 —— 透明度是**看不见的降对比**（静态 CSS 判据里量不到，
            真浏览器一量就现形：该记号从 6.09 掉到 5.02）。层级改由文字令牌表达，不用透明度。 */}
        <span aria-hidden style={{ fontSize: 12, color: "var(--muted2)" }}>▾</span>
      </button>
      {open && (
        <div className={styles.menuPop}>
          <button
            data-testid="logout-btn"
            onClick={() => {
              logoutSession();
              navigate("/login");
            }}
          >
            {zh.nav.switchAccount}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Entitlement §6：SPA 在路由切换时比对 configVersion（TTL 5min），
 * 失配 → 静默重拉 workspace；正在浏览的视图被关闭 → 跳首页 + toast。
 */
function useConfigVersionWatcher() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: workspace } = useWorkspace();
  const lastCheck = useRef(0);

  useEffect(() => {
    if (!workspace || workspace.configVersion == null) return;
    const now = Date.now();
    if (now - lastCheck.current < CONFIG_VERSION_TTL_MS) return;
    lastCheck.current = now;
    void (async () => {
      try {
        const resolved = await fetchResolvedFeatures(workspace.tenant.id);
        if (resolved.configVersion !== workspace.configVersion) {
          await queryClient.invalidateQueries({ queryKey: workspaceQueryKey });
          const m = /^\/v\/([^/]+)/.exec(location.pathname);
          if (m && !resolved.features.includes(`view.${m[1]}`)) {
            toast(zh.errors.featureClosed, "warn");
            navigate("/");
          }
        }
      } catch {
        /* 轻量检查失败忽略 */
      }
    })();
  }, [location.pathname]);
}
