/**
 * WO-SIM-BE-VIEWKEY · **推演沙盘指控台四视图**的声明（增量视图桶·非内置视图）。
 *
 * ── 病灶（实测坐实，非推测）─────────────────────────────────────────────────────
 * 前端 `views/registry.ts` 逐字注册了四个渲染器（`sim-console` / `sim-conduction` /
 * `sim-attribution` / `sim-optimize`，组件全在 `views/sim/console/`），而**后端整个 src
 * 零命中** —— 三形态定性（铁律 0.5）＝ **「没接线」**，不是"接了线没数据"、也不是"接错地方"。
 * 金丝雀：同一条 grep 在同族已上屏的 `chain-line-map` 上在 `view-manifest.ts` 命中多行
 * ⇒ 工具是好的，是真没下发。
 * 后果不是报错，是**页面根本不存在**：`workspace.views` 没有它 ⇒ `ViewPage` 第二道闸 403；
 * `features` 没有 `view.<key>` ⇒ 第一道闸 404；`App.tsx` 也无专用 route ⇒ 手敲 URL 也进不去。
 * 机器早就在说这句话：`node scripts/check-nav-group-coverage.mjs` 判据⑦ 在本单开工前就红着，
 * 报的正是这四个键「注册了但没有任何路径渲染得到」。
 *
 * ── 为什么**不进** `BUILTIN_VIEWS`（判据是机制后果，不是偏好）───────────────────
 * 进 `BUILTIN_VIEWS(seed:true)` 会连带三件必须改前端或改金值的事：
 *   ① `builtInViewFeatureDefs()` 会照 featureKey **再注册四条 VIEW 级 FeatureDef** ——
 *      而这四页的受控键**就是 `sim.sandbox` 本身**（它们是同一个控制台的四种模式，
 *      不是四个可独立售卖的功能）。凭空造四个开关 = 另起一套 entitlement；
 *      更实的后果：新 VIEW 功能的 `name` 若含「推演|沙盘」，`scripts/lib/sim-page-roster.mjs`
 *      的判据 R2 会把它们收进「推演页名册」，`edge-active-mounts` / `sim-ux-criteria` 两道门
 *      随即要求它们各自挂反事实开关、各自进 UX 判据基线 —— 全是本单射程外的连坐。
 *   ② `seed:true` ⇒ 进 `SEEDED_VIEW_KEYS` → `scenarioSeed.views` → `report.views` 验收金值
 *      （`test/synthetic.test.ts` 那条 16 项 `toEqual`）。
 *   ③ `check-nav-group-coverage.mjs` 判据①② 只对账 **seed:true 的 BUILTIN_VIEWS**：
 *      进了就必须同批改 `ShellLayout.NAV_GROUPS` 与前端 mock `fixtures.ts` allViews —— 前端文件。
 * 走**增量视图桶**（`service.ts` 的 `VIEW_DEFS` + `DARK_LAUNCH_EXTRA_KEYS`）三件全避开，
 * 而判据⑦ 照样闭合：它的供给侧之二**明写**着「或 `service.ts` `VIEW_DEFS` 项的 renderer
 * 字段等于该 key」。这不是绕道，是仓里既有的第二条正路 —— `process-stuck` 走的就是它
 * （`ShellLayout.CONSOLIDATED_INTO_SANDBOX` 里那条 `via:"view-defs"`）。
 *
 * ── ⚠ 为什么本表**必须住在自己的文件里**，不许挪回 `view-manifest.ts`（实测撞出来的）──
 * 第一版把本表写在 `view-manifest.ts` 末尾，`sim-ux-criteria:check` 与 `edge-active-mounts:check`
 * **两道门同时红**，报的是 `C1 sim-console —— BUILTIN_VIEWS「推演沙盘/」词面含「推演|沙盘」
 * 却没标 sim:true`。追下去：`scripts/lib/sim-page-roster.mjs` 的 `parseBuiltinViews()`
 * **逐行扫整个文件**找 `{ key: "…", title: "…"`，**没有锚在 `BUILTIN_VIEWS` 的声明块上**
 * ⇒ 它把本表的行读成了内置视图行。
 * 形态（铁律 0.6 句式）：**「门用『这一行长得像内置视图』当作『它是内置视图』的证据。」**
 * 修法不是给本表补 `sim: true`（那会真把控制台塞进推演页名册，招来上面 ①
 * 那一整串连坐，而且语义错 —— 控制台是沙盘本身，属 X1『沙盘内部构件』那一类，不是独立推演页），
 * 而是**让这张表不再住在那个文件里** —— 它本来就不是「内置视图清单」的一部分。
 * 同文件 `declBody()` 的注释早就写过这条教训：「判据必须锚在 `export const <NAME>` 上」，
 * 只是 `parseBuiltinViews` 当时没跟着改。**那是门侧的欠账，已在交单报告里点名**，
 * 本文件只负责不去踩它。
 *
 * ── 为什么控制键直接取 `sim.sandbox`（照抄既有口径，不自定）────────────────────
 * 沙盘主屏今天的判法是 `NAV_GROUPS` 里 `{ kind:"route", key:"sim-sandbox", feature:"sim.sandbox" }`
 * ＋ `App.tsx` 的 `SimSandboxGuard`；五个沙盘子视图的判法是 `requires:["sim.sandbox"]` 级联。
 * 两者的**实际判据是同一个键**。故本模块不新增功能键，直接把四个 viewKey 映到 `sim.sandbox`
 * （`features.ts` `VIEW_FEATURE_MAP`）：关 ⇒ `viewAllowed()` 为假 ⇒ `views` 与 `navigation`
 * 两处同时被滤掉，且 `withRouteFeatureAliases` 不下发 `view.<key>` ⇒ 前端页面侧守卫也 404。
 * 三道闸全在**请求期**（R3「功能关闭 = 不存在」一点没松），比种子期那一道更严。
 *
 * ── 为什么进「不过种子期过滤」的那个桶 ────────────────────────────────────────
 * `sim.sandbox` 在 `features.ts` 是 `defaultOn:false`（暗发）。种子期过滤会把这四个键
 * 从 ViewConfig 里整个滤掉 ⇒ 租户日后开通了功能也无从下发（`/me/workspace` 只能从
 * ViewConfig 里挑，挑不出没写进去的）。这正是 `DARK_LAUNCH_EXTRA_KEYS` 头注写下的那个死结。
 * ⇒ **目录无条件收录，闸在请求期判**。
 *
 * 本文件是**叶子模块**（零 import），故 `features.ts` / `synthetic/service.ts` / `app.ts`
 * 三处均可安全引用，无环。
 */

export interface SandboxConsoleView {
  /**
   * ViewConfig 键 = 前端 `views/registry.ts` `registerRenderer()` 的**第一个实参，逐字**。
   * 写错一个字母不会报错，只会让 `ViewPage` 落「该视图类型暂不支持」兜底卡 ——
   * 页面开得出来、是空的，本仓最难查的那种坏法。故接缝测试
   * `test/workspace-sim-console.seam.test.ts` 从前端那个文件**读**这四个键，不写死。
   */
  key: string;
  /** 导航 label / 页标题（`VIEW_DEFS[k].title` → ViewConfig.title/navigation.label）。 */
  title: string;
  /** 前端 renderer 注册键（本族与 key 同名；显式写出，不让"默认相等"变成隐含假设）。 */
  renderer: string;
}

/**
 * 四视图声明（顺序 = 决策链序：现状 → 传导 → 归因 → 寻优）。
 *
 * ⚠ `service.ts` 的 `VIEW_DEFS` 里**另有一份同值的字面量**，那是故意的：
 *   `check-nav-group-coverage.mjs` 判据⑦ 的供给侧抽取器是正则捞字面量，派生写法它看不见
 *   （第一版写成 `...Object.fromEntries(...)`，那道门原样再红一次）。
 *   两侧一致性由 `test/workspace-sim-console.seam.test.ts` 机械对账，不靠人记得。
 *
 * ── WO-SIM-NAV-GROUP · `sim-console` 的标题为什么从「推演沙盘」改成「推演指控台」──────
 * **X（改之前的屏上行为，仓主真浏览器实测）**：本表 `sim-console` 的 title 与
 * `ShellLayout.NAV_GROUPS`「推演」组里那条 `{ kind:"route", key:"sim-sandbox",
 * label:"推演沙盘" }` **逐字相同** ⇒ 左侧导航同时出现**两条「推演沙盘」**，
 * 点进去是两个不同的页面（旧 `/v/sim-sandbox` = `SandboxView`；
 * 新 `/v/sim-console` = `views/sim/console/SandboxHomeRoute`）。这是屏上直接可见的缺陷。
 * **Y**：新的那个改名，旧 `/v/sim-sandbox` 一个字不动（它是既有产品行为）。
 *
 * 名字取「推演指控台」，判据是「用户扫一眼就知道点哪个」：
 *  ① **不是新造词**：仓里对这一屏的既有称呼就是「指控台」——本文件头「推演沙盘指控台四视图」、
 *     `service.ts` VIEW_DEFS 那段的同名注释、前端 `SandboxHome.tsx` 文件头「沙盘首页『指控台』」
 *     与页面副标题 `simulation console`。改名是把**已经在用的词**提到导航面上，不是另起一套叫法。
 *  ② **核心名词与旧页不同**（指控台 ≠ 沙盘）：两条并排在同一组里时区分点落在名词本身，
 *     而不是靠后缀/编号（「推演沙盘 2」这类才是真歧义）。
 *  ③ **与三个同族页连读成一条决策链**：推演指控台（现状）→ 传导识别 → 损失归因 → 方案寻优。
 *  ④ 平台自有术语，**不含任何外部产品名**（铁律 0 的命名约束）。
 *
 * ⚠ 单一出处就是本表（+ `service.ts` 那份被门逼出来的同值镜像）。**前端不许再写一份 label 映射** ——
 *   `workspace.navigation[].label` 就是从这里流过去的（`service.ts` 的 `label: VIEW_DEFS[k]?.title`）。
 * ⚠ 页面**内部**顶栏那行 `<b>推演沙盘</b>`（`SandboxHome.tsx`）**不动**：那批是像素级 1:1 移植的
 *   版面，验收线在像素上，本单的范围边界明令不碰。导航面上的歧义由本表这一行消除。
 */
export const SANDBOX_CONSOLE_VIEWS: SandboxConsoleView[] = [
  { key: "sim-console", title: "推演指控台", renderer: "sim-console" },
  { key: "sim-conduction", title: "传导识别", renderer: "sim-conduction" },
  { key: "sim-attribution", title: "损失归因", renderer: "sim-attribution" },
  { key: "sim-optimize", title: "方案寻优", renderer: "sim-optimize" },
];

/** 四视图的受控功能键 —— **与沙盘主屏同一把闸**，不另起一个（见上文长注）。 */
export const SANDBOX_CONSOLE_FEATURE_KEY = "sim.sandbox";

/** 派生：四个 viewKey（`service.ts` 增量视图桶 / `features.ts` VIEW_FEATURE_MAP / `app.ts` 路由别名共用）。 */
export const SANDBOX_CONSOLE_VIEW_KEYS: string[] = SANDBOX_CONSOLE_VIEWS.map((v) => v.key);
