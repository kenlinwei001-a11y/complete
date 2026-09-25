#!/usr/bin/env node
/**
 * 导航归组覆盖门 `nav-group-coverage:check`
 *   —— **每一条能打开的业务页面，都必须有一个用户找得到的入口**。
 *
 * ## 由来：同一个病的第四、第五层（本体 §8 `G-NAV-FALLBACK-BUCKET`）
 *
 * 「可达 ≠ 可发现」。前三层都补过门了：
 *   · 第一层 组件写了没注册 renderer      → #97 registry 接线
 *   · 第二层 注册了没人引用（孤儿模块）  → `check-view-reachable.mjs`（#119）
 *   · 第三层 前端全齐但后端不派单        → `BUILTIN_VIEWS` 入册 + `assertViewManifestIntegrity`
 *   · **第四层 后端派单了、前端没归组**  → 落进 `ShellLayout.tsx` 那个叫「其它」的兜底桶。
 *   · **第五层（WO-ROUTE-NAV-COVERAGE）专用 route 根本不经后端下发** → 谁也没管它有没有入口。
 *   · **第六层（WO-IMPEDIMENTS-REACHABLE）renderer 注册了，但零路径能渲染到它** → 判据⑦，见下。
 *
 * ## 第六层为什么两道门都抓不到（本门本次扩的那条）
 *
 * `chain-impediments` 实拍坐实（2026-08-08）：`views/registry.ts:87` 逐字写着
 * `registerRenderer("chain-impediments", () => import("./sim/ChainImpedimentView"))`，
 * 组件 442 行真实现、两条测试全绿 —— 而它**没有任何路径渲染得到**：
 *   · 后端 `BUILTIN_VIEWS` 无此 key ⇒ `workspace.views` 永远没有它 ⇒ `ViewPage` 双闸（feature/views）全关；
 *   · `App.tsx` 无专用静态 route ⇒ 手敲 `/v/chain-impediments` 也只落 `v/:viewKey` 通用守卫 → 404。
 * 它的狡猾之处是**同时躲开既有两道门**：
 *   · `view-reachable:check` 问的是「`src/views/**` 的模块有没有人 import」—— registry 那一行天然满足，绿；
 *   · 本门原有六条判据对账的是「后端 seeded 视图」与「App.tsx 专用 route」两个**集合的入口**，
 *     而它两个集合都不在 ⇒ 根本不在射程里，也绿。
 * 两道门各自都没写错，只是**没有任何一道去问「注册表里这 24 个键，每个都有路径能走到吗」**。
 * 判据⑦ 补的就是这一问。
 *
 * ⚠ 判据⑦ 与 `view-reachable:check` 的分工（别合并）：
 *   后者查**模块图**（文件有没有人 import），前者查**渲染路径**（字符串键有没有人派单/有没有 route）。
 *   一个模块可以「有人 import」而「没有路径渲染」——`chain-impediments` 正是这一形态。
 *
 * 第四层实拍坐实：沙盘四子视图（chain-line-map / transit-flow / physical-topology / node-inspector）
 * 全部落「其它」组，而那个组**不多不少正好只有它们四个** —— 一个专为「没人登记的东西」而生的桶，
 * 且默认折叠态（▸）。仓主连问三轮「四个新入口在哪」。
 *
 * 第五层实测坐实（2026-08-08）：`App.tsx` 有 7 条**专用静态 route**（`{ path: "v/<静态段>" }`，
 * 静态段先于 `:viewKey` 匹配，设计上**免 workspace 下发即可达**），后端 `BUILTIN_VIEWS` 一条都不派单
 * （`view-manifest.ts` 注释里明写"诚实排除"）。而本门的第一版**只对账后端 seeded 视图**，
 * 于是这 7 条整体在射程之外 —— 又一次「门名承诺 > 门实覆盖」：
 *   · `decision-play`  写成 `kind:"view"` → `UnifiedNav` 拿 `viewByKey.get()` 恒查不中 →
 *     `if (!it) return null` **静默消失**，不报错不留痕 = **幽灵条目**（表里写着、屏幕上永远没有）；
 *   · `cleanroom-attr` / `disruption-radius` / `optimize-whatif` / `what-if` **零导航提及** = 只能手敲 URL；
 *   · `sim-sandbox` / `sim-init` 走写死 `<NavLink>` —— 既不在任何分组里，也不在本门射程里。
 *
 * ## 为什么这道门必须是脚本，不能只是前端 vitest
 *
 * 真相源在 **datacore**（`apps/datacore/src/synthetic/view-manifest.ts` 的 `BUILTIN_VIEWS`），
 * 消费方在 **frontend-shell**。R1 contracts-only-shared 禁止前端跨 app import 源码，
 * 所以前端测试**永远看不见后端加了什么视图** —— 它只能在自己的 mock 上自说自话（那正是哑门的成因）。
 * 门脚本跨 app **读文件**是允许的（`scripts/**` 本来就这么干，见 check-view-reachable / check-boundary-singlesource），
 * 于是这道门是全仓唯一能把「后端加了视图」和「前端归了组」这两件事对上账的地方。
 * 第五层（App.tsx ↔ ShellLayout.tsx）虽同在前端，但**同一道门对账才不会各说各话**，故并在此处。
 *
 * ## 六条判据（同时成立才算过）
 *
 *   ① 归组无遗漏     后端 `BUILTIN_VIEWS` 里 seed:true 的每个 key，都在 `ShellLayout.NAV_GROUPS`
 *                    的 kind:"view" 键集合里 —— 漏一个 = 它在真实导航里落「其它」兜底桶。
 *   ② mock 不失真     同一批 key 都在 `apps/frontend-shell/src/mocks/fixtures.ts` 的 `allViews` 里 ——
 *                    mock 缺了它，前端所有 render 断言对它就是**恒真**的空转（哑门）。
 *   ③ 门自身没坏     四个解析结果各自非空、含各自金丝雀键、且过词法自检（见下）。
 *   ④ 专用 route 有入口  `App.tsx` 里每条 `{ path: "v/<静态段>" }`，要么在 `NAV_GROUPS` 有 `kind:"route"`
 *                    条目，要么列进 `INTENTIONALLY_NO_NAV` 并写明理由 —— 没有第三种状态。
 *   ⑤ route 条目不是幽灵（反向）  `NAV_GROUPS` 里每个 `kind:"route"` 键都必须真有对应的专用 route。
 *                    这条堵的是**删路由留条目**：链接还在、点进去落 `:viewKey` 兜底 404。
 *   ⑥ 专用 route 不得挂成 kind:"view"  那正是 `decision-play` 幽灵条目的**确切形态**：
 *                    该 key 不经后端下发 ⇒ `viewByKey` 永远查不中 ⇒ 条目永远不渲染，而且**没有任何报错**。
 *   ⑦ 渲染器可达（第六层）  `views/registry.ts` 里 `registerRenderer("<key>", …)` 的每个 key，
 *                    都必须至少有一条路径渲染得到 —— 二选一：
 *                      · 后端派单：某个 seed:true 的 `BUILTIN_VIEWS` 项 或 `service.ts` `VIEW_DEFS` 项
 *                        的 `renderer` 字段等于该 key（→ `workspace.views[].renderer` → `ViewPage` `getRenderer`）；
 *                      · 专用 route：`App.tsx` 有 `{ path: "v/<该 key>" }`（静态段先于 `:viewKey` 匹配）。
 *                    都没有 = 「实现有、测试绿、页面永远打不开」。豁免须进 `RENDERER_NO_PATH` 并写理由（≥10 字）。
 *   ⑧ 收编不是删除（WO-SANDBOX-IA-CONSOLIDATE）  `ShellLayout.CONSOLIDATED_INTO_SANDBOX` 里每一条
 *                    （= ①④ 放行的那批「已收编进沙盘、有意不单列」的键）反过来验四件事：
 *                      a. 不许两头占（`kind:"view"` 条目还在 = 重复入口，收编没发生）；
 *                      b/c. 不许变黑洞（`via` 指定的那条到达路径必须**真的**还在：后端仍 seed 派单 + 仍在
 *                           mock allViews；或 App.tsx 仍有专用 route）——「不单列」≠「页面没了」；
 *                      d. `where` 要写出「用户点哪里能到」（≥6 字）；
 *                      e. `via:"static-route"` 的必须**留着** `kind:"route"` 回退条目（带 `consolidatedWhen`）——
 *                         那四页本身不受控制台的 entitlement 门控，条目删了 = 控制台一关它们就从 IA 里蒸发。
 *                    没有这四条，收编表就是一张免死金牌，跟「其它」兜底桶是同一种东西、只是名字好听。
 *                    f. **两张表不许各写一半**：导航条目上的 `consolidatedWhen`（决定屏上何时隐藏）
 *                       与收编表（声明到达路径还在）是同一件事的两半，只写前者 = 「删入口了事」披了张皮。
 *   ⑨ 组的收编承诺不许被逐条豁免掏空（WO-SANDBOX-NAV-CONSOLIDATE）
 *                    凡有成员带 `consolidatedWhen: X` 的导航组，其余成员要么也带 `consolidatedWhen: X`，
 *                    要么在 `ShellLayout.GROUP_CONSOLIDATION_EXEMPT` 里逐条登记理由（≥10 字）。
 *                    **①–⑧ 全是逐键判据**（这个键有没有入口 / 这个键的路通不通），
 *                    没有一条问过「这一组合起来还成不成立」—— ⑨ 补的就是这一问。
 *
 * ### 判据⑨ 的由来（真事，写在这里免得下次又被"这次不一样"骗过去）
 *
 * 「归因与风险」组原本两项都带 `consolidatedWhen: "sim.sandbox"` ⇒ 沙盘一开整组消失（空组自动隐藏）。
 * 后来三张单**各往组里加了一项、每一项都不带**，理由都是「沙盘五模式里没有它，带了页面就不可达」——
 * **每条豁免单独看都成立**（当时沙盘里确实没有落点）。合起来的效果是：这个本该消失的组
 * 在沙盘开着时永远剩三项。仓主看到屏幕后问：**「为何导航栏还有这2个，我之前不是要求你调整吗？」**
 * 更难看的是，`ShellLayout` 里那两条历史订正**每次只更新了数字**（「剩一项」→「剩两项」），
 * 还各自写着「这是正确行为，不是漏配」—— 从没有人问过「这个数为什么不是零」。
 *
 * 形态（铁律 0.6 句式）：
 *   **「我用『每条豁免单独看都成立』当作『整组收编还在生效』的证据，而前者并不度量后者。」**
 * 同族 `G-GATE-ROSTER-HANDCOPIED`：每次加一项都合规，**累积效果无人度量**。
 *

 * ③ 是这道门的保命判据。①②④⑤⑥⑦ 的解析都是「从 TS 源码里正则捞字面量」，
 * 一旦某侧被重构成解析不了的写法：那侧集合会**变小**——
 *   · mock/NAV_GROUPS 侧变小 → 差集变大 → **红**（失败安全）；
 *   · **后端侧 / App.tsx 侧变小 → 差集变空 → 恒绿**（失败危险，= 又一个哑门）。
 * 故供给侧必须有下界 + 金丝雀 + 词法自检三重自证，否则这道门会在最需要它的那天悄悄失效。
 *
 * **词法自检（判据③ 的第三重·每次运行都跑）**：拿一段内嵌样本喂给三个提取器，断言
 * 「注释里的不算 / `:viewKey` 动态段不算 / 非 `v/` 路径不算 / route 项的 label·feature 不得被误读成视图键 /
 *  `.map` 形态的字符串列表提得出」。任一不符即判**「门自己瞎了」**并红 —— 与「被扫代码有问题」分开报，
 * 因为修法完全不同（修门 vs 修代码）。由来：这道门上一版的 `.map` 形态正则写作 `\[([^\]]*)\]`，
 * 在 items 数组里混入 route 对象后会从**外层** `items: [` 起匹配，把 `label`/`feature` 的中文文案
 * 一并当成视图键收进去 —— 集合只会**变大**，①⑥ 恰恰因此更容易恒绿。词法自检当场咬住这一形态。
 *
 * ## 诚实边界（本门抓不到什么·必须当面列出）
 *
 * · 只查 seed:true 的内置视图。非 seed 的（不进 scenarioSeed.views）本来就不下发，不该要求归组。
 * · 只查「有没有入口」，不查「归得对不对」（归到哪个组是产品判断，机器判不了）。
 * · 只查「入口指向的 route 存在」，不查「那个页面打开后有没有内容」——静态扫描看不见运行期渲染，
 *   那半由前端 vitest（`test/f61.admin-nav-groups.test.tsx` 真渲染断言）与门B `ui-smoke` 咬。
 * · 只认 `{ path: "v/<字面量>" }` 这一种写法。若将来有人把路由表改成循环/拼接生成，
 *   解析结果会**变小** → 判据③ 的下界与金丝雀会当场红（这正是下界存在的理由）。
 * · `INTENTIONALLY_NO_NAV` 是**显式豁免**，不是静默放行：每条必须写理由，且理由指向的 route
 *   必须真实存在（陈旧豁免 = 红），门在成功时也把豁免清单打出来，让它无法躺在暗处。
 * · 判据⑦ **不认视图键别名**（`registry.ts` 的 `VIEW_ALIAS`：`sop`→`sop-balance` 那张表）。
 *   别名只会**增加**可达路径，故不认它只可能误红、不可能漏放 —— 失败安全的那一侧。
 *   修法也正确：真要靠别名可达的键，把规范键补进 `BUILTIN_VIEWS`/route，而不是让门去认一层间接。
 * · 判据⑦ 只证「有路径走得到」，**不证「走到了有内容」**。页面打开是空壳、求解器 404，
 *   静态扫描一律看不见 —— 那半由前端 vitest 的可达测试（从注册表字符串键出发真渲染）与门B `ui-smoke` 咬。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-NAV-FALLBACK-BUCKET`（本门所闭断点的机械门那一半）。
 * 用法：node scripts/check-nav-group-coverage.mjs   ·   pnpm nav-group-coverage:check
 * 退出码非 0 即失败。
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-nav-group-coverage.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, existsSync } from "node:fs";

const MANIFEST = "apps/datacore/src/synthetic/view-manifest.ts";
const FIXTURES = "apps/frontend-shell/src/mocks/fixtures.ts";
const SHELL = "apps/frontend-shell/src/pages/ShellLayout.tsx";
const APP = "apps/frontend-shell/src/App.tsx";
const REGISTRY = "apps/frontend-shell/src/views/registry.ts"; // 判据⑦ 的被测集：渲染器注册表
const VIEWDEFS = "apps/datacore/src/synthetic/service.ts"; // 判据⑦ 的第二个供给侧：增量视图 VIEW_DEFS
const CANARY = "dash"; // 后端/mock/NAV_GROUPS 三侧都必然含有的视图键；解析器坏掉时它会缺席 → 判据③ 红
const ROUTE_CANARY = "sim-sandbox"; // App.tsx 与 NAV_GROUPS 两侧都必然含有的专用 route 键（同上）
const RENDERER_CANARY = "dashboard"; // registry.ts 必然含有的渲染器键（判据⑦ 的被测侧金丝雀）
const VIEWDEF_CANARY = "annual-scenario"; // service.ts VIEW_DEFS 必然含有的 renderer 值（判据⑦ 供给侧金丝雀）
const BACKEND_FLOOR = 10; // 后端内置视图下界（当前 14）；解析崩了会掉到 0
const ROUTE_FLOOR = 5; // 专用 route 下界（当前 6）；解析崩了会掉到 0 → ④ 差集恒空 → 恒绿
const RENDERER_FLOOR = 15; // 已注册渲染器下界（当前 24）；**被测侧**解析崩了会掉到 0 → ⑦ 差集恒空 → 恒绿
const VIEWDEF_FLOOR = 4; // VIEW_DEFS 增量 renderer 下界（当前 5）；**供给侧**解析崩了 → ⑦ 误红（失败安全，但仍要看得见）

/**
 * 判据④ 的**带理由豁免表**：刻意不给导航入口的专用 route。
 *
 * **单一出处在被测代码里**（同 CONSOLIDATED_INTO_SANDBOX 的理由：门里手抄一份 = 装饰品，
 * 前端改了门还拿旧表对账）：`ShellLayout.tsx` 的 `ROUTE_NO_NAV`（WO-IA-E2E5E6 立，
 * 首条 = `decision-play`，仓主裁决「决策推演不该占导航位，嵌进各决策点」）。
 * 本门只解析对账：键必须是 App.tsx 里真实存在的 route（陈旧豁免 = 红），
 * 且在成功时把豁免清单打出来，让它无处躺平。
 * 解析失败 → 豁免集为空 → 判据④ **误红**（失败安全那一侧），词法自检负责把「门瞎了」与「代码错了」分开报。
 */
const ROUTE_NO_NAV_CANARY = null; // 无常驻金丝雀：豁免表合法状态可以是空表（只靠词法自证解析器没瞎）

/**
 * `ShellLayout.ROUTE_NO_NAV` 的 `"<route键>": "理由"` 条目。
 * 形态：`"decision-play": "仓主裁决…"`（理由可跨行 —— 故键与值各自匹配，不吃换行敏感）。
 * ⚠ 入参必须是**已去注释**的对象体。
 */
function parseRouteNoNav(body) {
  const out = {};
  for (const m of body.matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/**
 * 判据⑦ 的**带理由豁免清单**（棘轮：只降不升）—— 「这个 renderer 键注册了，但刻意没有任何渲染路径」。
 *
 * 空表是**当前的真实状态**（24 个注册键全部可达），不是"还没填"。
 * 往这里加一条 = 公开声明「这个组件写了、注册了，但用户永远打不开它，而且这是有意的」——
 * 这句话经不起问的时候，正确动作是**删掉那行 `registerRenderer`**（注册表是手工登记表，
 * 删一行的成本比留一个永远打不开的页面低得多），而不是来这里加一行。
 *
 * 三重约束，任一不满足即红：
 *   · 理由 ≥10 字（一个字的"待定"不算理由）；
 *   · 键必须真的在 `registry.ts` 注册过（写错键名的豁免会在下一次同名键出现时悄悄放过它）；
 *   · 键必须**真的不可达**（陈旧豁免 = 红：路已经通了还挂着豁免，等于给下一个真缺口留了后门）。
 * @type {Record<string, string>}
 */
const RENDERER_NO_PATH = {};
/** 棘轮上限（只降不升）：豁免条数不得超过此数。要加豁免就必须先在 diff 里把这个数字改大，藏不住。 */
const RENDERER_NO_PATH_CEILING = 0;

/**
 * 判据⑧ 的下界（WO-SANDBOX-IA-CONSOLIDATE）：收编表当前 9 条。
 * 解析器坏掉 → 读成 0 条 → ①④ 的豁免集为空 ⇒ 门**误红**（失败安全那一侧），
 * 但仍必须当场说清是"门瞎了"而不是"代码错了"，否则下一个人会去改被测代码。
 */
const CONSOLIDATED_FLOOR = 5;
/** 收编表里必然含有的键（判据③ 金丝雀）。 */
const CONSOLIDATED_CANARY = "chain-line-map";

/* ── 判据⑨ 的下界与金丝雀（WO-SANDBOX-NAV-CONSOLIDATE）───────────────────────── */
/** NAV_GROUPS 拆出的组数下界（当前 13）；拆组坏了会掉到 0 ⇒ 判据⑨ 一个组都不看、恒绿。 */
const NAV_GROUP_FLOOR = 8;
/** 判据⑨ 的金丝雀组：它必然存在、且必然是**带收编承诺**的那种（本单收编的就是它）。 */
const NAV_GROUP_CANARY = "归因与风险";
/** 金丝雀组的成员数下界（当前 5）；成员漏解析会让判据⑨ 把掏空读成完好。 */
const NAV_GROUP_CANARY_ITEM_FLOOR = 5;

const fail = [];
/** 门自身的故障（与"被扫代码有问题"分开报——修法完全不同）。 */
const gateBroken = [];

/**
 * **退出码判决的单一出处**（WO-SANDBOX-NAV-CONSOLIDATE 续跑·变异反证 M7 逼出来的）。
 *
 * 抽成函数不是为了好看，是为了**能被金丝雀咬住**：这条判决上一版写在文件末尾一个
 * 三目表达式里，写反了没有任何东西会说话 —— 而它恰恰是「门瞎了 vs 代码坏了」
 * 这两种**处置完全相反**的情形的唯一分岔口。写反的代价是人被指去改没错的代码。
 *
 * 判决（顺序即优先级，不许调换）：
 *   ① `gateBroken` 非空 ⇒ **2**：门自证瞎了，整次结论作废（连同 `fail` 一起）。
 *      此刻不存在「真违规」这个可信品类 —— 坏工具吐出的 fail 与真违规长得一模一样。
 *   ② 否则 `fail` 非空 ⇒ **1**：门是好的，它报的是被扫代码的真问题。
 *   ③ 都空 ⇒ **0**。
 * 判据来源：docs/SOP-reviewer-claim-discipline.md §3 的三分表
 * （2 = 工具坏了 ⇒ 只许说「我没查出来」，绝不许说「代码干净 / 它不存在」）。
 */
function verdictExitCode(gateBrokenCount, failCount) {
  if (gateBrokenCount > 0) return 2;
  if (failCount > 0) return 1;
  return 0;
}
/* 金丝雀（必中 + 必不咬两侧，且**喂的就是上面那个函数本体**，不另抄一份三目）。
 * 这四例里最要紧的是第三例「门瞎了 **且** 有 fail ⇒ 2」—— 上一版正是这一格写成了 1。 */
for (const [gb, fl, want, why] of [
  [0, 0, 0, "都干净 ⇒ 0"],
  [0, 3, 1, "门是好的、代码有问题 ⇒ 1（先修代码）"],
  [2, 3, 2, "门瞎了且吐了 fail ⇒ **2**（fail 是坏工具的产物，不是结论；先修门）"],
  [2, 0, 2, "门瞎了、无 fail ⇒ 2"],
]) {
  const got = verdictExitCode(gb, fl);
  if (got !== want) {
    gateBroken.push(
      `✗ 词法自检：退出码判决写反了 —— verdictExitCode(${gb}, ${fl}) 期望 ${want}，实得 ${got}。${why}\n` +
        `    这一格写反的后果不是「少报一条」，是**把人指去改没错的代码**（RC=1 照 SOP §3 读作「真有问题，先修再说」）。`,
    );
  }
}

function read(p) {
  if (!existsSync(p)) {
    fail.push(`✗ 输入文件不存在：${p}（本门的四个输入缺一即不可判，宁可红也不放行）`);
    return null;
  }
  return readFileSync(p, "utf8");
}

/**
 * 去注释 —— **这一步是命门**：四个文件的注释里都逐字写着视图键 / 路由段
 * （view-manifest 注释里有 `chain-line-map`，ShellLayout 注释里有 `sim-sandbox`，
 *  App.tsx 注释里有 `/v/decision-play`…）。
 * 不去注释，「注释里提了一嘴」会被读成「已登记」，门当场变哑。
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * 声明匹配正则：名字**整词**锚定 + 吃掉可选类型标注直到 `=`。
 *
 * 两个坑都踩过才写成这样（变异实测）：
 *   · 名字若用 `NAME[^=]*=` 松匹配，`BUILTIN_VIEWS_RENAMED: BuiltInView[] =` 也会命中 ——
 *     万一将来有个同前缀的**别的**数组排在前面，门会去读错的那个还照样绿。
 *   · 但名字若只锚到 `NAME\s*:` 就收尾，后面 `indexOf("[")` 会先撞上类型标注 `BuiltInView[]`
 *     里那对**空**方括号 → 解析出 0 项 → 判据③ 误红。
 * 故必须「整词锚定名字」且「一路吃到 `=`」两件事同时做到。
 */
const declOf = (name) => new RegExp(String.raw`export\s+const\s+${name}\s*(?::[^=]*)?=\s*`);
const localDeclOf = (name) => new RegExp(String.raw`const\s+${name}\s*(?::[^=]*)?=\s*`);

/**
 * 从 `<decl>` 之后的第一个 `open` 起做括号配对，返回字面量内容（不含首尾那对括号）。
 * `open` 默认 `[`（数组）；传 `{` 用于对象字面量（`VIEW_DEFS`）。
 */
function arrayBlock(src, declRe, label, open = "[") {
  const close = open === "[" ? "]" : "}";
  const m = declRe.exec(src);
  if (!m) {
    fail.push(`✗ 解析失败：${label} —— 找不到声明（写法变了就必须同步改本门，别让它悄悄读空）`);
    return null;
  }
  const start = src.indexOf(open, m.index + m[0].length - 1);
  if (start < 0) {
    fail.push(`✗ 解析失败：${label} —— 声明后找不到 '${open}'`);
    return null;
  }
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  fail.push(`✗ 解析失败：${label} —— ${open === "[" ? "数组" : "对象"}括号未配对`);
  return null;
}

/** 数组体里深度为 1 的 `key: "字面量"`（不下钻 layout/options 等嵌套对象，防把内层 key 当视图键）。 */
function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  const re = /[{}[\]]|key:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(body))) {
    const t = m[0];
    if (t === "{" || t === "[") depth++;
    else if (t === "}" || t === "]") depth--;
    else if (depth === 1 && m[1]) keys.push(m[1]);
  }
  return keys;
}

/* =====================  三个提取器（纯函数·供门与词法自检共用）  ===================== */

/**
 * App.tsx 专用静态 route：`{ path: "v/<静态段>" }`。
 * 排除动态段（`v/:viewKey` —— 那是兜底，不是专用 route）与非 `v/` 前缀路径（admin/tasks/o/…）。
 * ⚠ 入参必须是**已去注释**的源码。
 */
function parseDedicatedRoutes(strippedSrc) {
  const out = [];
  for (const m of strippedSrc.matchAll(/path:\s*"v\/([^"/]+)"/g)) {
    if (!m[1].startsWith(":")) out.push(m[1]);
  }
  return out;
}

/**
 * NAV_GROUPS 的 `kind:"view"` 键。三种形态：
 *   A  `{ kind: "view", key: "dash" }`
 *   A' `{ kind: "view" as const, key: "process-wait", consolidatedWhen: "sim.sandbox" }`（WO-SANDBOX-NAV-CONSOLIDATE）
 *   B  `["a","b",…].map((key) => ({ kind: "view" as const, key }))`
 *
 * ⚠ **形态 A' 是 2026-08-17 实测踩到的一个真「门瞎了」**：本函数上一版形态 A 的正则写作
 *   `…key:\s*"([^"]+)"\s*\}` —— 锚到 `\}` 收尾。`kind:"view"` 条目此前恰好都只有 `kind`+`key`
 *   两个字段，于是这个锚点一直成立；本轮给三条 view 条目加上 `consolidatedWhen` 之后，
 *   `key` 后面还有字段 ⇒ **三个键当场从解析结果里消失**（25 → 22）。
 *   后果不是报错，是**集合变小**：判据①（归组无遗漏）与⑧a（不许两头占）的差集一起变小 ⇒
 *   更容易恒绿。route 项的正则早在 WO-ROUTE-NAV-COVERAGE 就因为同一个理由去掉了 `\}` 锚点
 *   （见 `parseNavRouteKeys` 的注释），view 项**当时没有同步改**，这次才暴露。
 *   ⇒ 订正：与 route 同款，key 之后不许再锚 `\}`；`[^{}]*?` 保证不跨对象边界（`.map` 形态的
 *     `{ kind: "view" as const, key }` 里没有 `key: "…"`，且 `[^{}]` 挡住它跨出自己那对花括号）。
 *   词法自检新增一条形态 A' 的样例，专防这一条再次退化。
 *
 * ⚠ 形态 B 的数组正则**必须**排掉 `{` `}` `[`（`[^[\]{}]*`）：items 数组里混入 route 对象后，
 *   宽松的 `[^\]]*` 会从**外层** `items: [` 起匹配到内层数组的 `]`，把 route 项的 label/feature 文案
 *   一并当成视图键收进来 —— 集合只会变大，判据 ①⑥ 因此更容易恒绿。词法自检咬这一条。
 */
function parseNavViewKeys(body) {
  const out = [];
  for (const m of body.matchAll(/\{\s*kind:\s*"view"[^{}]*?key:\s*"([^"]+)"/g)) out.push(m[1]);
  for (const m of body.matchAll(/\[([^[\]{}]*)\]\s*\.map\(\s*\(\s*key\s*\)\s*=>\s*\(\s*\{\s*kind:\s*"view"/g)) {
    for (const s of m[1].matchAll(/"([^"]+)"/g)) out.push(s[1]);
  }
  return out;
}

/**
 * 判据⑨ 的被测集（WO-SANDBOX-NAV-CONSOLIDATE）：把 `NAV_GROUPS` 拆成
 * `[{ title, items: [{ kind, key, consolidatedWhen }] }]`。
 *
 * 为什么必须**按组**拆，而不能复用上面那两个平铺的键抽取器：判据⑨ 要回答的问题是
 * 「**这一组**里带 `consolidatedWhen` 的和不带的各有几个」——平铺之后组的边界就没了，
 * 而「组被掏空」这件事只有在组这一层看得见。
 * ⚠ 入参必须是**已去注释**的 `NAV_GROUPS` 数组体。
 */
function parseNavGroups(navBody) {
  /** 先按深度切出每个顶层 `{ … }`（= 一个组）。`[` 也计深度，故 `items: [ … ]` 不会提前收尾。 */
  const blocks = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < navBody.length; i++) {
    const ch = navBody[i];
    if (ch === "{" || ch === "[") {
      if (ch === "{" && depth === 0) start = i;
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (ch === "}" && depth === 0 && start >= 0) {
        blocks.push(navBody.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return blocks.map((blk) => {
    const tm = /title:\s*(?:"([^"]*)"|(null))/.exec(blk);
    const title = tm && tm[1] !== undefined ? tm[1] : null;
    const items = [];
    // 形态 A/A'/route：完整对象字面量（`.map` 形态的对象没有 `key: "字面量"`，在这里被跳过）
    for (const m of blk.matchAll(/\{\s*kind:\s*"(view|route|admin)"[^{}]*\}/g)) {
      const obj = m[0];
      const k = /key:\s*"([^"]+)"/.exec(obj);
      if (!k) continue;
      const cw = /consolidatedWhen:\s*"([^"]+)"/.exec(obj);
      items.push({ kind: m[1], key: k[1], consolidatedWhen: cw ? cw[1] : null });
    }
    // 形态 B：`[…].map((key) => ({ kind: "x" as const, key }))` —— 这一形态天然带不了 consolidatedWhen
    for (const m of blk.matchAll(/\[([^[\]{}]*)\]\s*\.map\(\s*\(\s*key\s*\)\s*=>\s*\(\s*\{\s*kind:\s*"(view|route|admin)"/g)) {
      for (const s of m[1].matchAll(/"([^"]+)"/g)) items.push({ kind: m[2], key: s[1], consolidatedWhen: null });
    }
    return { title, items };
  });
}

/**
 * 判据⑨ 的豁免表 `ShellLayout.GROUP_CONSOLIDATION_EXEMPT`：`"<组标题>::<项键>": "理由"`。
 * 与 `parseRouteNoNav` 同形（键值都是字符串，理由可跨行），但**刻意不复用它**：
 * 那张表的键是 route 键、这张表的键是 `组::项` 复合键，合成一个解析器会让两处的
 * 「键必须真实存在」校验搅在一起。⚠ 入参必须是**已去注释**的对象体。
 */
function parseGroupExempt(body) {
  const out = {};
  for (const m of body.matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** 判据⑨ 的豁免键形态（门与被测代码共用同一条拼法，两边各拼一次就会漂）。 */
function groupExemptKey(groupTitle, itemKey) {
  return `${groupTitle}::${itemKey}`;
}

/**
 * 判据⑨ 的**主逻辑本体**（词法自检与真扫描共用这一个函数 —— 抄第二份就是装饰品）。
 *
 * 一组里只要有**任何一个**成员带 `consolidatedWhen: X`，这一组就对 X 做出了收编承诺：
 * 「X 开着的时候，这一组该消失」。此时其余成员只有两种合法状态：
 *   ① 也带 `consolidatedWhen: X`（一起被收编）；
 *   ② 在 `GROUP_CONSOLIDATION_EXEMPT` 里逐条登记「为什么它不该被 X 收编」。
 * 两者都不是 ⇒ 它就是那种「单独看合理、合起来把承诺掏空」的豁免，本函数把它逐条返回。
 *
 * ⚠ 一组里出现**两个不同**的 `consolidatedWhen` 值时，按「每个值各自成一条承诺」处理：
 *   带 X 的成员对 Y 那条承诺同样算掏空（它在 Y 开着时不会消失）。今天仓里没有这种组，
 *   但规则要先说清楚 —— 不然第一个这么写的人会发现门对它一声不吭。
 *
 * @returns `[{ key, kind, why }]` —— `why` 说的是"它相对哪一条承诺是掏空的"
 */
function hollowedOutMembers(group, exempt) {
  const promises = [...new Set(group.items.map((it) => it.consolidatedWhen).filter((w) => w !== null))];
  if (promises.length === 0) return [];
  const out = [];
  for (const it of group.items) {
    const missing = promises.filter((p) => it.consolidatedWhen !== p);
    if (missing.length === 0) continue;
    if (exempt[groupExemptKey(group.title, it.key)] !== undefined) continue;
    out.push({ key: it.key, kind: it.kind, missing });
  }
  return out;
}

/** 判据⑨ 报文里的那个数：`X` 开着时这一组屏上还剩几项（0 = 空组自动隐藏 = 承诺兑现）。 */
function remainingWhenOn(group, when) {
  return group.items.filter((it) => it.consolidatedWhen !== when).length;
}

/**
 * 判据⑦/⑧b 供给侧：`service.ts` `VIEW_DEFS` 的**增量视图键**（不是 renderer 值）。
 * 深度 0 = 视图键那一层（`arrayBlock(…, "{")` 已经把外层花括号剥掉）。
 * 两种写法都要认：`"process-stuck": { … }` 与 `review: { … }`。
 */
function parseViewDefKeys(body) {
  const out = [];
  let depth = 0;
  const re = /[{}[\]]|"([^"]+)"\s*:|([A-Za-z_$][\w$]*)\s*:/g;
  let m;
  while ((m = re.exec(body))) {
    const t = m[0];
    if (t === "{" || t === "[") depth++;
    else if (t === "}" || t === "]") depth--;
    else if (depth === 0) {
      const k = m[1] ?? m[2];
      if (k) out.push(k);
    }
  }
  return out;
}

/**
 * NAV_GROUPS 的 `kind:"route"` 键（WO-ROUTE-NAV-COVERAGE）。
 * 形态：`{ kind: "route" as const, key: "sim-sandbox", label: "推演沙盘", feature: "sim.sandbox" }`
 * —— key 之后还有 label/feature，故**不能**像形态 A 那样锚到 `\}` 收尾。
 */
function parseNavRouteKeys(body) {
  const out = [];
  for (const m of body.matchAll(/\{\s*kind:\s*"route"[^}]*?key:\s*"([^"]+)"/g)) out.push(m[1]);
  return out;
}

/**
 * `ShellLayout.CONSOLIDATED_INTO_SANDBOX`（WO-SANDBOX-IA-CONSOLIDATE）——
 * 「已收编进沙盘、有意不在导航单列」的登记表。
 *
 * **为什么读它而不是在本门里手抄一份**：抄一份 = 装饰品。前端删一条收编、门这边还留着，
 * 门就会拿旧表放行一个真的漏登记（同 0.6 那条「金丝雀必须与主逻辑共用同一份实现」）。
 * 单一出处在被测代码里，门只负责对账。
 *
 * 形态：`"chain-line-map": { via: "workspace.views", where: "…" },`
 * ⚠ 入参必须是**已去注释**的对象体 —— 表头的长注释里逐字写着这些键名。
 */
function parseConsolidated(body) {
  const out = [];
  for (const m of body.matchAll(/"([^"]+)"\s*:\s*\{\s*via:\s*"([^"]+)"\s*,\s*where:\s*"([^"]*)"/g)) {
    out.push({ key: m[1], via: m[2], where: m[3] });
  }
  return out;
}

/**
 * 判据⑦ 被测侧：`registry.ts` 的 `registerRenderer("<key>", …)` 键集。
 * ⚠ 入参必须是**已去注释**的源码 —— 注册表里到处是「XXX 此前没接线」这类注释，逐字含键名；
 *   不去注释，「注释里提了一嘴」会被读成「已注册」，判据⑦ 当场变成一个**更大**的集合（更容易误红），
 *   而被注释掉的真登记则读成"还在"（漏放）。两个方向都错，所以这一步不是可选项。
 */
function parseRegisteredRenderers(strippedSrc) {
  return [...strippedSrc.matchAll(/registerRenderer\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * 判据⑦ 供给侧之一：一段对象字面量里深度为 1 的 `renderer: "字面量"`。
 * 不下钻嵌套（layout/options 里也可能出现 `renderer` 键 —— 例如 ViewConfig 的 `layout.renderer` 兜底，
 * 那不是"后端派了一个用该 renderer 的视图"）。
 */
function parseRendererValues(body) {
  const out = [];
  let depth = 0;
  const re = /[{}[\]]|renderer:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(body))) {
    const t = m[0];
    if (t === "{" || t === "[") depth++;
    else if (t === "}" || t === "]") depth--;
    else if (depth === 1 && m[1]) out.push(m[1]);
  }
  return out;
}

/* =====================  判据③ 第三重：词法自检（每次运行都跑）  ===================== */
{
  const SAMPLE_APP = `
    // { path: "v/commented-out" }        ← 注释里的不算
    /* { path: "v/block-commented" } */
    { path: "v/sim-sandbox", element: <SimSandboxGuard /> },
    { path: "v/what-if", element: lazyWrap(<WhatIfView />) },
    { path: "v/:viewKey", element: <ViewPage /> },
    { path: "tasks/:taskId", element: x },
    { path: "admin/foo", element: y },
  `;
  const gotRoutes = parseDedicatedRoutes(stripComments(SAMPLE_APP));
  const wantRoutes = ["sim-sandbox", "what-if"];
  if (JSON.stringify(gotRoutes) !== JSON.stringify(wantRoutes)) {
    gateBroken.push(
      `✗ 词法自检：parseDedicatedRoutes 提取结果不对 —— 期望 ${JSON.stringify(wantRoutes)}，` +
        `实得 ${JSON.stringify(gotRoutes)}（应做到：注释里的不算 / \`:viewKey\` 动态段不算 / 非 v/ 路径不算）`,
    );
  }

  const SAMPLE_NAV = `
    { title: null, items: [{ kind: "view", key: "canary-view" }] },
    { title: "组", items: [
        { kind: "route" as const, key: "canary-route", label: "标签文案", feature: "feat.x" },
        { kind: "view" as const, key: "canary-consolidated-view", consolidatedWhen: "feat.console" },
        ...["a1", "a2"].map((key) => ({ kind: "view" as const, key })),
        ...["p1"].map((key) => ({ kind: "admin" as const, key })),
    ] },
  `;
  const gotViews = parseNavViewKeys(SAMPLE_NAV);
  // ⚠ `canary-consolidated-view` 是形态 A' 的金丝雀：`key` 之后还有 `consolidatedWhen`。
  //   上一版正则锚 `\}` 收尾时它**提不出来** —— 那正是 2026-08-17 让真实解析结果 25→22 的那个坏法。
  const wantViews = ["canary-view", "canary-consolidated-view", "a1", "a2"];
  if (JSON.stringify(gotViews.slice().sort()) !== JSON.stringify(wantViews.slice().sort())) {
    gateBroken.push(
      `✗ 词法自检：parseNavViewKeys 提取结果不对 —— 期望 ${JSON.stringify(wantViews)}，实得 ${JSON.stringify(gotViews)}` +
        `（应做到：形态 A/B 都提得出 / admin 项不算 / **route 项的 key·label·feature 一个都不许混进视图键**）`,
    );
  }
  const gotNavRoutes = parseNavRouteKeys(SAMPLE_NAV);
  if (JSON.stringify(gotNavRoutes) !== JSON.stringify(["canary-route"])) {
    gateBroken.push(
      `✗ 词法自检：parseNavRouteKeys 提取结果不对 —— 期望 ["canary-route"]，实得 ${JSON.stringify(gotNavRoutes)}` +
        `（route 项 key 之后还有 label/feature，正则不能锚到 '}' 收尾）`,
    );
  }

  /* ── 判据⑦ 的词法自检 ────────────────────────────────────────────────────────
   * 这一段是判据⑦ 的**反向金丝雀**：拿一个内嵌样本，里面**故意**放一个注册了却无路径的键，
   * 断言差集算法真的把它抓出来。正向金丝雀（真代码里已知可达的键不得被误报）在判据③ 里。
   * 两个方向都跑，才排得掉「门恒绿」与「门恒红」这两种坏法。 */
  const SAMPLE_REG = `
    // registerRenderer("commented-out", () => import("./X"));   ← 注释里的不算
    /* registerRenderer("block-commented", () => import("./Y")); */
    registerRenderer("canary-reachable", () => import("./A"));
    registerRenderer( "spaced-key" , () => import("./B"));
    registerRenderer("canary-orphan", () => import("./C"));
  `;
  const gotReg = parseRegisteredRenderers(stripComments(SAMPLE_REG));
  const wantReg = ["canary-reachable", "spaced-key", "canary-orphan"];
  if (JSON.stringify(gotReg) !== JSON.stringify(wantReg)) {
    gateBroken.push(
      `✗ 词法自检：parseRegisteredRenderers 提取结果不对 —— 期望 ${JSON.stringify(wantReg)}，实得 ${JSON.stringify(gotReg)}` +
        `（应做到：注释里的不算 / 括号内空格不影响）`,
    );
  }

  const SAMPLE_DEFS = `
    "a": { title: "甲", renderer: "canary-reachable", layout: { renderer: "nested-must-not-count" } },
    "b": { title: "乙", renderer: "spaced-key", layout: {} },
  `;
  const gotDefs = parseRendererValues(SAMPLE_DEFS);
  const wantDefs = ["canary-reachable", "spaced-key"];
  if (JSON.stringify(gotDefs) !== JSON.stringify(wantDefs)) {
    gateBroken.push(
      `✗ 词法自检：parseRendererValues 提取结果不对 —— 期望 ${JSON.stringify(wantDefs)}，实得 ${JSON.stringify(gotDefs)}` +
        `（应做到：顶层 renderer 提得出 / **嵌套 layout.renderer 不许算作"后端派了单"**）`,
    );
  }

  // 反向金丝雀：注册 3 个，其中 2 个有供给、1 个只在 route，剩 canary-orphan 无路径 ⇒ 必须被抓出来。
  const sampleReachable = new Set([...gotDefs, "sim-sandbox"]);
  const sampleOrphans = gotReg.filter((k) => !sampleReachable.has(k));
  if (JSON.stringify(sampleOrphans) !== JSON.stringify(["canary-orphan"])) {
    gateBroken.push(
      `✗ 词法自检：判据⑦ 差集算法不对 —— 内嵌样本里 "canary-orphan" 注册了却无任何供给侧路径，` +
        `期望差集 ["canary-orphan"]，实得 ${JSON.stringify(sampleOrphans)}。` +
        `差集算错 = 本门对「注册了但打不开」这件事**恒绿**，正是它要治的那种东西。`,
    );
  }

  /* ── 判据⑧ 的词法自检（WO-SANDBOX-IA-CONSOLIDATE）──────────────────────────── */
  const SAMPLE_CONS = `
    // "commented-key": { via: "workspace.views", where: "注释里的不算" },
    "canary-view-key": { via: "workspace.views", where: "沙盘中栏默认模式" },
    "canary-route-key": { via: "static-route", where: "沙盘模式切换 →「归因」" },
  `;
  const gotCons = parseConsolidated(stripComments(SAMPLE_CONS));
  const wantCons = [
    { key: "canary-view-key", via: "workspace.views", where: "沙盘中栏默认模式" },
    { key: "canary-route-key", via: "static-route", where: "沙盘模式切换 →「归因」" },
  ];
  if (JSON.stringify(gotCons) !== JSON.stringify(wantCons)) {
    gateBroken.push(
      `✗ 词法自检：parseConsolidated 提取结果不对 —— 期望 ${JSON.stringify(wantCons)}，实得 ${JSON.stringify(gotCons)}` +
        `（应做到：注释里的不算 / via 与 where 两个字段都提得出 —— 少了 via 就分不清该验后端派单还是该验 route）`,
    );
  }

  /* ── 判据⑨ 的词法自检（WO-SANDBOX-NAV-CONSOLIDATE）·必中 + 两侧必不咬 ──────────────
   * 三个样例的**形状取自生产实物**（`ShellLayout.NAV_GROUPS` 真有的三种写法），
   * 且全部喂给**主逻辑本体** `parseNavGroups` / `hollowedOutMembers`，不另抄一份正则。 */
  const SAMPLE_GROUPS = `
    { title: "必中组", items: [
        { kind: "route" as const, key: "consolidated-a", label: "甲", consolidatedWhen: "feat.console" },
        { kind: "view" as const, key: "consolidated-b", consolidatedWhen: "feat.console" },
        { kind: "view" as const, key: "hollow-1" },
        { kind: "route" as const, key: "hollow-2", label: "丙" },
        ...["hollow-3"].map((key) => ({ kind: "view" as const, key })),
    ] },
    { title: "全带组", items: [
        { kind: "view" as const, key: "all-a", consolidatedWhen: "feat.console" },
        { kind: "route" as const, key: "all-b", label: "乙", consolidatedWhen: "feat.console" },
    ] },
    { title: "全不带组", items: [
        { kind: "view", key: "none-a" },
        ...["none-b", "none-c"].map((key) => ({ kind: "view" as const, key })),
    ] },
  `;
  const gotGroups = parseNavGroups(SAMPLE_GROUPS);
  const gotTitles = gotGroups.map((g) => g.title);
  if (JSON.stringify(gotTitles) !== JSON.stringify(["必中组", "全带组", "全不带组"])) {
    gateBroken.push(
      `✗ 词法自检：parseNavGroups 拆组不对 —— 期望 ["必中组","全带组","全不带组"]，实得 ${JSON.stringify(gotTitles)}` +
        `（拆组坏了 ⇒ 判据⑨ 看不见组边界，而「组被掏空」这件事只有在组这一层看得见）`,
    );
  }
  const gotMemberCounts = gotGroups.map((g) => g.items.length);
  if (JSON.stringify(gotMemberCounts) !== JSON.stringify([5, 2, 3])) {
    gateBroken.push(
      `✗ 词法自检：parseNavGroups 成员数不对 —— 期望 [5,2,3]，实得 ${JSON.stringify(gotMemberCounts)}` +
        `（三种写法：完整对象 / 带 consolidatedWhen 的对象 / .map 形态，缺哪一种都会让判据⑨ 少看几项）`,
    );
  }
  // 必中：五个成员里两个带 `feat.console`，另外三个既不带也没登记豁免 ⇒ 必须被逐条点名
  const canaryHollow = hollowedOutMembers(gotGroups[0] ?? { title: null, items: [] }, {});
  if (JSON.stringify(canaryHollow.map((h) => h.key)) !== JSON.stringify(["hollow-1", "hollow-2", "hollow-3"])) {
    gateBroken.push(
      `✗ 词法自检：判据⑨ **必中**样例没抓到 —— 期望 ["hollow-1","hollow-2","hollow-3"]，` +
        `实得 ${JSON.stringify(canaryHollow.map((h) => h.key))}。抓不到 = 本门对「组的收编承诺被逐条豁免掏空」恒绿，` +
        `正是它要治的那种东西。`,
    );
  }
  // 必不咬 ①：全组同一个 `consolidatedWhen` ⇒ 收编承诺完整，不许报
  if (hollowedOutMembers(gotGroups[1] ?? { title: null, items: [] }, {}).length !== 0) {
    gateBroken.push(`✗ 词法自检：判据⑨ 对「全组都带同一个 consolidatedWhen」误报 —— 那是收编完整，不是掏空。`);
  }
  // 必不咬 ②：全组都没有 `consolidatedWhen` ⇒ 这个组根本没有收编承诺，不许报
  if (hollowedOutMembers(gotGroups[2] ?? { title: null, items: [] }, {}).length !== 0) {
    gateBroken.push(
      `✗ 词法自检：判据⑨ 对「全组都没有 consolidatedWhen」误报 —— 没有承诺就谈不上掏空；` +
        `这一侧误报会把全仓十几个普通分组一起判红，门当场没人信。`,
    );
  }
  // 豁免登记之后必须闭嘴（否则「登记了理由」这件事等于没用）
  const exemptAll = { "必中组::hollow-1": "理由一二三四五六七八九十", "必中组::hollow-2": "理由一二三四五六七八九十", "必中组::hollow-3": "理由一二三四五六七八九十" };
  if (hollowedOutMembers(gotGroups[0] ?? { title: null, items: [] }, exemptAll).length !== 0) {
    gateBroken.push(`✗ 词法自检：判据⑨ 对**已逐条登记豁免**的成员仍然报警 —— 豁免表形同虚设。`);
  }

  const SAMPLE_GROUP_EXEMPT = `
    // "注释组::注释项": "注释里的不算",
    "推演::sim-sandbox": "它就是那个控制台本身（理由可跨行
        续写也不影响提取）",
  `;
  const gotGroupExempt = parseGroupExempt(stripComments(SAMPLE_GROUP_EXEMPT));
  if (Object.keys(gotGroupExempt).join("|") !== "推演::sim-sandbox") {
    gateBroken.push(
      `✗ 词法自检：parseGroupExempt 提取结果不对 —— 期望键 ["推演::sim-sandbox"]，` +
        `实得 ${JSON.stringify(Object.keys(gotGroupExempt))}（应做到：注释里的不算 / 复合键与跨行理由都提得出）`,
    );
  }

  const SAMPLE_VIEWDEF_KEYS = `
    "process-stuck": { title: "流程卡点", renderer: "process-stuck", layout: {} },
    review: { title: "运营复盘", renderer: "review", layout: { apiTag: "history", nested: "must-not-count" } },
    "graph-all": graphView("图谱·全景", { colorBy: "domain" }, { desc: "…" }),
  `;
  const gotViewDefKeys = parseViewDefKeys(SAMPLE_VIEWDEF_KEYS);
  if (JSON.stringify(gotViewDefKeys) !== JSON.stringify(["process-stuck", "review", "graph-all"])) {
    gateBroken.push(
      `✗ 词法自检：parseViewDefKeys 提取结果不对 —— 期望 ["process-stuck","review","graph-all"]，` +
        `实得 ${JSON.stringify(gotViewDefKeys)}（应做到：引号键与裸标识符键都提得出 / **嵌套 layout 里的键不许算作视图键** /` +
        ` 函数调用形态的值也不影响取键）`,
    );
  }

  /* ── 判据④ 豁免表（ROUTE_NO_NAV）的词法自检（WO-IA-E2E5E6）───────────────────── */
  const SAMPLE_NONAV = `
    // "commented-key": "注释里的不算",
    "canary-no-nav": "仓主裁决：这条 route 刻意不给导航入口（理由可跨行
        续写也不影响提取）",
  `;
  const gotNoNav = parseRouteNoNav(stripComments(SAMPLE_NONAV));
  if (JSON.stringify(gotNoNav) !== JSON.stringify({ "canary-no-nav": "仓主裁决：这条 route 刻意不给导航入口（理由可跨行\n        续写也不影响提取）" })) {
    gateBroken.push(
      `✗ 词法自检：parseRouteNoNav 提取结果不对 —— 期望 { canary-no-nav: "…" }，实得 ${JSON.stringify(gotNoNav)}` +
        `（应做到：注释里的不算 / 理由跨行也提得出 / 键与值两个字段都在）`,
    );
  }
}

/* ---------- 后端真相源：BUILTIN_VIEWS 里 seed:true 那批 ---------- */
const manifestSrc = read(MANIFEST);
let seeded = [];
/** 判据⑦ 供给侧之一：seed:true 内置视图的 `renderer` 值（**只取 seed:true** —— 非 seed 项不进
 *  `scenarioSeed.views`、永远不下发，把它的 renderer 算作"可达"就是又一次「接了线没数据」误判）。 */
let seededRenderers = [];
if (manifestSrc) {
  const body = arrayBlock(stripComments(manifestSrc), declOf("BUILTIN_VIEWS"), `${MANIFEST} BUILTIN_VIEWS`);
  if (body !== null) {
    // 逐个顶层 `{ … }` 拆开，只留 seed: true 的
    let depth = 0;
    let objStart = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "{") {
        if (depth === 0) objStart = i;
        depth++;
      } else if (body[i] === "}") {
        depth--;
        if (depth === 0 && objStart >= 0) {
          const obj = body.slice(objStart, i + 1);
          const k = /key:\s*"([^"]+)"/.exec(obj);
          if (k && /seed:\s*true/.test(obj)) {
            seeded.push(k[1]);
            const r = /renderer:\s*"([^"]+)"/.exec(obj);
            // renderer 缺省时 ViewConfig 落 `renderer: VIEW_DEFS[k]?.renderer ?? k`（key 兜底）
            if (r) seededRenderers.push(r[1]);
            else seededRenderers.push(k[1]);
          }
          objStart = -1;
        }
      }
    }
  }
}

/* ---------- 判据⑦ 供给侧之二：service.ts VIEW_DEFS 的增量视图 renderer ---------- */
const viewDefsSrc = read(VIEWDEFS);
let viewDefRenderers = [];
/** 判据⑧b（`via:"view-defs"` 那一支）的供给侧：增量视图桶的**键**（不是 renderer 值）。 */
let viewDefKeys = [];
if (viewDefsSrc) {
  const body = arrayBlock(stripComments(viewDefsSrc), localDeclOf("VIEW_DEFS"), `${VIEWDEFS} VIEW_DEFS`, "{");
  if (body !== null) {
    viewDefRenderers = parseRendererValues(body);
    viewDefKeys = parseViewDefKeys(body);
  }
}

/* ---------- 判据⑦ 被测侧：registry.ts 的 registerRenderer 键 ---------- */
const registrySrc = read(REGISTRY);
let registeredRenderers = [];
if (registrySrc) registeredRenderers = parseRegisteredRenderers(stripComments(registrySrc));

/* ---------- 前端 mock：allViews ---------- */
const fixturesSrc = read(FIXTURES);
let mockKeys = [];
if (fixturesSrc) {
  const body = arrayBlock(stripComments(fixturesSrc), localDeclOf("allViews"), `${FIXTURES} allViews`);
  if (body !== null) mockKeys = topLevelKeys(body);
}

/* ---------- 前端归组表：NAV_GROUPS 的 kind:"view" / kind:"route" 键 ---------- */
const shellSrc = read(SHELL);
let navViewKeys = [];
let navRouteKeys = [];
/** WO-SANDBOX-IA-CONSOLIDATE · 收编表（判据①④ 的豁免源 + 判据⑧ 的被测集）。 */
let consolidated = [];
/** WO-IA-E2E5E6 · 判据④ 豁免表（单一出处在 ShellLayout.ROUTE_NO_NAV，本门只解析对账）。 */
let INTENTIONALLY_NO_NAV = {};
/** WO-SANDBOX-NAV-CONSOLIDATE · 判据⑨ 的被测集（按组拆开的 NAV_GROUPS）与它的豁免表。 */
let navGroups = [];
let GROUP_EXEMPT = {};
if (shellSrc) {
  const stripped = stripComments(shellSrc);
  const body = arrayBlock(stripped, declOf("NAV_GROUPS"), `${SHELL} NAV_GROUPS`);
  if (body !== null) {
    navViewKeys = parseNavViewKeys(body);
    navRouteKeys = parseNavRouteKeys(body);
    navGroups = parseNavGroups(body);
  }
  const consBody = arrayBlock(stripped, declOf("CONSOLIDATED_INTO_SANDBOX"), `${SHELL} CONSOLIDATED_INTO_SANDBOX`, "{");
  if (consBody !== null) consolidated = parseConsolidated(consBody);
  const noNavBody = arrayBlock(stripped, declOf("ROUTE_NO_NAV"), `${SHELL} ROUTE_NO_NAV`, "{");
  if (noNavBody !== null) INTENTIONALLY_NO_NAV = parseRouteNoNav(noNavBody);
  const grpExBody = arrayBlock(stripped, declOf("GROUP_CONSOLIDATION_EXEMPT"), `${SHELL} GROUP_CONSOLIDATION_EXEMPT`, "{");
  if (grpExBody !== null) GROUP_EXEMPT = parseGroupExempt(grpExBody);
}
/** NAV_GROUPS 里带 `consolidatedWhen` 的 `kind:"view"` 条目 → 该开关（判据⑧a/⑧f 用）。 */
const navViewConsolidatedWhen = new Map(
  navGroups
    .flatMap((g) => g.items)
    .filter((it) => it.kind === "view" && it.consolidatedWhen !== null)
    .map((it) => [it.key, it.consolidatedWhen]),
);
const consolidatedKeys = consolidated.map((c) => c.key);
const consolidatedSet = new Set(consolidatedKeys);
/** 判据⑧b 的 `via:"view-defs"` 那一支：增量视图桶的键集。 */
const viewDefKeySet = new Set(viewDefKeys);

/* ---------- 前端路由表：App.tsx 的专用静态 route ---------- */
const appSrc = read(APP);
let dedicatedRoutes = [];
if (appSrc) dedicatedRoutes = parseDedicatedRoutes(stripComments(appSrc));

/* ---------- 判据③ 门自身没坏（先跑，坏了后面几条的"绿"没有意义） ---------- */
const canaries = [
  [`${MANIFEST} BUILTIN_VIEWS(seed:true)`, seeded, CANARY],
  [`${FIXTURES} allViews`, mockKeys, CANARY],
  [`${SHELL} NAV_GROUPS(kind:"view")`, navViewKeys, CANARY],
  [`${SHELL} NAV_GROUPS(kind:"route")`, navRouteKeys, ROUTE_CANARY],
  [`${APP} 专用 route`, dedicatedRoutes, ROUTE_CANARY],
  [`${REGISTRY} registerRenderer 键`, registeredRenderers, RENDERER_CANARY],
  [`${MANIFEST} seed:true 的 renderer 值`, seededRenderers, RENDERER_CANARY],
  [`${VIEWDEFS} VIEW_DEFS renderer 值`, viewDefRenderers, VIEWDEF_CANARY],
  [`${SHELL} CONSOLIDATED_INTO_SANDBOX`, consolidatedKeys, CONSOLIDATED_CANARY],
];
for (const [label, set, canary] of canaries) {
  if (!set.includes(canary)) {
    gateBroken.push(
      `✗ 判据③ 门自身没坏：${label} 解析结果不含金丝雀键 "${canary}"（解析到 ${set.length} 项）——` +
        ` 这不是代码死了，是本门的解析器坏了。修门，别改被测代码。`,
    );
  }
}
if (seeded.length < BACKEND_FLOOR) {
  gateBroken.push(
    `✗ 判据③ 门自身没坏：后端 seeded 内置视图只解析出 ${seeded.length} 项（下界 ${BACKEND_FLOOR}）——` +
      ` 后端侧解析变空会让 ①② 的差集恒空、门恒绿，这正是本门最怕的失效方式。`,
  );
}
if (dedicatedRoutes.length < ROUTE_FLOOR) {
  gateBroken.push(
    `✗ 判据③ 门自身没坏：${APP} 专用 route 只解析出 ${dedicatedRoutes.length} 条（下界 ${ROUTE_FLOOR}）——` +
      ` 路由侧解析变空会让 ④ 的差集恒空、门恒绿（"代码很干净"其实是"门瞎了"）。`,
  );
}
if (registeredRenderers.length < RENDERER_FLOOR) {
  gateBroken.push(
    `✗ 判据③ 门自身没坏：${REGISTRY} 只解析出 ${registeredRenderers.length} 个 registerRenderer 键（下界 ${RENDERER_FLOOR}）——` +
      ` **被测侧**解析变空会让 ⑦ 的差集恒空、门恒绿。这是判据⑦ 最怕的失效方式：` +
      ` 屏幕上写着"全部可达"，其实是"一个都没看"。`,
  );
}
if (consolidatedKeys.length < CONSOLIDATED_FLOOR) {
  gateBroken.push(
    `✗ 判据③ 门自身没坏：${SHELL} 的 CONSOLIDATED_INTO_SANDBOX 只解析出 ${consolidatedKeys.length} 条（下界 ${CONSOLIDATED_FLOOR}）——` +
      ` 收编表读空只会让 ①④ **误红**（失败安全），但方向必须说对：是本门的解析器坏了，不是前端漏登记。` +
      ` 修门（parseConsolidated / 表的写法变了就同步改），别去给 NAV_GROUPS 加回九个重复入口。`,
  );
}
/* ── 判据⑨ 的门自证（WO-SANDBOX-NAV-CONSOLIDATE）──────────────────────────────
 * 三重：拆组下界 + 金丝雀组 + 「本仓此刻真有一条收编承诺」。
 * 第三条最要紧：全仓一条 `consolidatedWhen` 都解析不到时，判据⑨ 会**恒绿** ——
 * 屏幕上写着「组的收编承诺都完好」，其实是「一条承诺都没看见」。 */
if (navGroups.length < NAV_GROUP_FLOOR) {
  gateBroken.push(
    `✗ 判据③ 门自身没坏：${SHELL} 的 NAV_GROUPS 只拆出 ${navGroups.length} 个组（下界 ${NAV_GROUP_FLOOR}）——` +
      ` 拆组变空会让判据⑨ 一个组都不看、恒绿。修 parseNavGroups，别改被测代码。`,
  );
}
{
  const canaryGroup = navGroups.find((g) => g.title === NAV_GROUP_CANARY);
  if (!canaryGroup) {
    gateBroken.push(
      `✗ 判据③ 门自身没坏：拆组结果里没有金丝雀组「${NAV_GROUP_CANARY}」` +
        `（拆出 ${navGroups.length} 组：${navGroups.map((g) => g.title ?? "(无标题)").join(" / ")}）—— 解析器坏了。`,
    );
  } else if (canaryGroup.items.length < NAV_GROUP_CANARY_ITEM_FLOOR) {
    gateBroken.push(
      `✗ 判据③ 门自身没坏：金丝雀组「${NAV_GROUP_CANARY}」只解析出 ${canaryGroup.items.length} 项` +
        `（下界 ${NAV_GROUP_CANARY_ITEM_FLOOR}）—— 成员漏解析会让判据⑨ 少看几项、把掏空读成完好。`,
    );
  }
  const promiseCount = navGroups.filter((g) => g.items.some((it) => it.consolidatedWhen !== null)).length;
  if (promiseCount === 0) {
    gateBroken.push(
      `✗ 判据③ 门自身没坏：全仓 NAV_GROUPS 里**一条 consolidatedWhen 都没解析到** ⇒ 判据⑨ 恒绿。` +
        ` 这不是「没有组做过收编承诺」，是本门的 parseNavGroups 没读到它 —— 修门。`,
    );
  }
}
if (viewDefKeys.length < VIEWDEF_FLOOR) {
  gateBroken.push(
    `✗ 判据③ 门自身没坏：${VIEWDEFS} VIEW_DEFS 只解析出 ${viewDefKeys.length} 个视图键（下界 ${VIEWDEF_FLOOR}）——` +
      ` 增量视图桶读空会让 ⑧b 的 \`via:"view-defs"\` 那一支**误红**（失败安全），但方向要说对：修门。`,
  );
}
if (viewDefRenderers.length < VIEWDEF_FLOOR) {
  gateBroken.push(
    `✗ 判据③ 门自身没坏：${VIEWDEFS} VIEW_DEFS 只解析出 ${viewDefRenderers.length} 个 renderer 值（下界 ${VIEWDEF_FLOOR}）——` +
      ` 供给侧解析变空只会让 ⑦ 误红（失败安全），但仍要当场说清是"门瞎了"而不是"代码断了"：` +
      ` 修法完全不同（修门 vs 接线）。`,
  );
}

/* ---------- 判据① 归组无遗漏（收编键除外·WO-SANDBOX-IA-CONSOLIDATE）---------- */
const navSet = new Set(navViewKeys);
const ungrouped = seeded.filter((k) => !navSet.has(k) && !consolidatedSet.has(k));
if (ungrouped.length > 0) {
  fail.push(
    `✗ 判据① 归组无遗漏：后端下发的内置视图未登记进 ${SHELL} 的 NAV_GROUPS —— [${ungrouped.join(", ")}]\n` +
      `    后果不是"报错"，是**静悄悄落进侧栏那个叫「其它」的折叠兜底桶**：可达、但用户找不到。\n` +
      `    修法二选一：\n` +
      `      ① 把这些 key 加进对应业务分组的 items（{ kind: "view", key: "…" }），不是改 leftover 机制；\n` +
      `      ② 若它已被收编进某个控制台（不该再有平级入口）→ 进 CONSOLIDATED_INTO_SANDBOX 写明 via 与到达路径，\n` +
      `         **并同时**在 UnifiedNav 里把它从 leftover 滤掉（只删登记不滤 leftover = 原地掉进「其它」桶，比单列还糟）。`,
  );
}

/* ---------- 判据② mock 不失真 ---------- */
const mockSet = new Set(mockKeys);
const missingInMock = seeded.filter((k) => !mockSet.has(k));
if (missingInMock.length > 0) {
  fail.push(
    `✗ 判据② mock 不失真：后端下发的内置视图不在 ${FIXTURES} 的 allViews 里 —— [${missingInMock.join(", ")}]\n` +
      `    后果：所有跑在 mock 上的前端断言对这些视图**恒真**（它们根本没进 workspace.navigation），\n` +
      `    于是"业务视图不得落『其它』"这类测试全是空转的哑门。mock 必须反映后端真实下发的视图集。`,
  );
}

/* ---------- 判据④ 专用 route 有入口 ---------- */
const routeSet = new Set(dedicatedRoutes);
const navRouteSet = new Set(navRouteKeys);
// ⚠ 收编键**不在**本条的豁免之列（与判据① 不同，这是刻意的）：
//   `via:"static-route"` 的四页本身不受 `sim.sandbox` 门控，收编时保留了带 `consolidatedWhen` 的
//   回退条目（沙盘关 → 照旧单列）。所以它们**仍应**在 NAV_GROUPS 里有 kind:"route" 条目 ——
//   条目没了 = 沙盘关着的租户那四页只剩手敲 URL 可达，正是本条要抓的东西。
const noEntry = dedicatedRoutes.filter((k) => !navRouteSet.has(k) && !(k in INTENTIONALLY_NO_NAV));
if (noEntry.length > 0) {
  fail.push(
    `✗ 判据④ 专用 route 有入口：${APP} 的专用静态 route 在 ${SHELL} 的 NAV_GROUPS 里没有 kind:"route" 条目 ——\n` +
      `    [${noEntry.join(", ")}]\n` +
      `    后果：页面写了、路由通了、点不到 —— 只有知道 URL 的人（= 写它的那个 dev）进得去。\n` +
      `    修法三选一：① 加 { kind: "route", key: "…", label: "…" } 到对应分组；\n` +
      `              ② 若已收编进某控制台但该页本身不受那个 entitlement 门控 →\n` +
      `                 条目**照留**并加 consolidatedWhen: "<那个 entitlement>"（控制台在则隐藏，不在则单列）；\n` +
      `              ③ 若确属刻意不给任何入口，写进 ${SHELL} 的 ROUTE_NO_NAV 并注明理由（本门从这里对账，会被打印出来，无处躺平）。`,
  );
}
const staleExempt = Object.keys(INTENTIONALLY_NO_NAV).filter((k) => !routeSet.has(k));
if (staleExempt.length > 0) {
  fail.push(
    `✗ 判据④ 豁免不许陈旧：INTENTIONALLY_NO_NAV 里的 [${staleExempt.join(", ")}] 在 ${APP} 已无对应专用 route。\n` +
      `    陈旧豁免会在下一次同名 route 出现时**悄悄放过它**。删掉即可。`,
  );
}

/* ---------- 判据⑤ route 条目不是幽灵（反向） ---------- */
const danglingNavRoutes = navRouteKeys.filter((k) => !routeSet.has(k));
if (danglingNavRoutes.length > 0) {
  fail.push(
    `✗ 判据⑤ route 条目不是幽灵：${SHELL} 的 NAV_GROUPS 有 kind:"route" 条目，但 ${APP} 没有对应的专用 route ——\n` +
      `    [${danglingNavRoutes.join(", ")}]\n` +
      `    后果：侧栏链接还在，点进去落 \`v/:viewKey\` 兜底 → FEATURE_NOT_FOUND / 404。\n` +
      `    这条专防**跨分支删路由**：谁删了 route 而没删条目，在这里当场红，而不是留一条死链上线。`,
  );
}

/* ---------- 判据⑥ 专用 route 不得挂成 kind:"view"（幽灵条目的确切形态） ---------- */
const seededSet = new Set(seeded);
const ghostViewEntries = navViewKeys.filter((k) => routeSet.has(k) && !seededSet.has(k));
if (ghostViewEntries.length > 0) {
  fail.push(
    `✗ 判据⑥ 专用 route 不得挂成 kind:"view"：[${ghostViewEntries.join(", ")}]\n` +
      `    这些 key 是 ${APP} 的专用静态 route，且**后端 BUILTIN_VIEWS 不派单**（不进 workspace.navigation），\n` +
      `    于是 ShellLayout \`UnifiedNav\` 里 \`viewByKey.get(key)\` 恒查不中 → \`if (!it) return null\` ——\n` +
      `    条目**永远不渲染，且不报错、不留痕**（幽灵条目）。decision-play 就这么隐身了整整一个版本。\n` +
      `    修法：改成 { kind: "route", key: "…", label: "…" }（无条件渲染，不依赖后端下发）。`,
  );
}

/* ---------- 判据⑦ 渲染器可达（第六层：注册了但零路径渲染得到）---------- */
const rendererReachable = new Set([...seededRenderers, ...viewDefRenderers, ...dedicatedRoutes]);
const unreachableRenderers = registeredRenderers.filter(
  (k) => !rendererReachable.has(k) && !(k in RENDERER_NO_PATH),
);
if (unreachableRenderers.length > 0) {
  fail.push(
    `✗ 判据⑦ 渲染器可达：${REGISTRY} 注册了这些 renderer 键，但**没有任何路径渲染得到它们** ——\n` +
      `    [${unreachableRenderers.join(", ")}]\n` +
      `    后果不是"报错"，是**页面根本不存在**：后端不派单 ⇒ workspace.views 没有它 ⇒ ViewPage 双闸全关；\n` +
      `    没有专用 route ⇒ 手敲 URL 也只落 \`v/:viewKey\` 通用守卫 → 404。组件再全、测试再绿，用户一次都打不开。\n` +
      `    ⚠ 这一层**既有两道门都抓不到**：\`view-reachable:check\` 看"模块有没有人 import"（registry 那一行满足了），\n` +
      `      本门原有判据看的是"后端 seeded 视图"与"专用 route"两个集合的入口——不在集合里的键根本不在射程。\n` +
      `    修法二选一（判据是**语义归属**，不是哪个好写）：\n` +
      `      ① 该视图应按租户/行业配置下发（可被行业模板裁剪、需要 requires 级联、需要 view.options 参数）\n` +
      `         → 进 ${MANIFEST} 的 BUILTIN_VIEWS（seed:true），并同步 NAV_GROUPS + mock allViews + report.views 金值；\n` +
      `      ② 该视图是平台自带、与租户配置无关的固定分析页（净室通用页那一类）\n` +
      `         → 在 ${APP} 加 { path: "v/<key>" } 专用 route，并在 NAV_GROUPS 加 kind:"route" 条目（判据④ 会验）。\n` +
      `      ③ 若它**根本不该是一个可打开的视图**（纯图层/子组件/已废弃）→ **删掉那行 registerRenderer**，\n` +
      `         而不是来 RENDERER_NO_PATH 加豁免：豁免名单会把将来的真缺口一起放过，那正是这道门存在的原因。`,
  );
}
// 豁免自身的三重约束（棘轮 + 理由 + 不许陈旧）
if (Object.keys(RENDERER_NO_PATH).length > RENDERER_NO_PATH_CEILING) {
  fail.push(
    `✗ 判据⑦ 豁免棘轮：RENDERER_NO_PATH 有 ${Object.keys(RENDERER_NO_PATH).length} 条，超过上限 ${RENDERER_NO_PATH_CEILING}。\n` +
      `    棘轮只降不升：要加豁免必须在同一个 diff 里把 RENDERER_NO_PATH_CEILING 改大 —— 那一行改动藏不住，必被复审看见。`,
  );
}
for (const [k, why] of Object.entries(RENDERER_NO_PATH)) {
  if (typeof why !== "string" || why.trim().length < 10) {
    fail.push(`✗ 判据⑦ 豁免须有理由：RENDERER_NO_PATH["${k}"] 的理由不足 10 字（"待定"/"TODO" 不是理由）。`);
  }
  if (!registeredRenderers.includes(k)) {
    fail.push(
      `✗ 判据⑦ 豁免不许写错键：RENDERER_NO_PATH["${k}"] 在 ${REGISTRY} 里根本没注册过。\n` +
        `    写错键名的豁免今天什么也不放行，却会在下一次真出现同名键时**悄悄放过它**。`,
    );
  } else if (rendererReachable.has(k)) {
    fail.push(
      `✗ 判据⑦ 豁免不许陈旧：RENDERER_NO_PATH["${k}"] 声明"刻意不可达"，但它现在**已经可达**了。\n` +
        `    删掉这条豁免即可 —— 留着等于给下一个真缺口预留了一个后门。`,
    );
  }
}

/* ---------- 判据⑧ 收编不是删除（WO-SANDBOX-IA-CONSOLIDATE·反向四条）---------- *
 * ①④ 因为收编表而**放行**了九个键。放行必须有代价 —— 否则这张表就成了「往里一填就没人管」
 * 的免死金牌，跟当年那个「其它」兜底桶是同一种东西（换了个好听的名字而已）。
 * 故对表里每一条反过来验四件事，任一不成立即红：
 *   a. **不许两头占**：既进收编表又在 NAV_GROUPS 里 = 重复入口还在，收编根本没发生；
 *   b. **不许收编成黑洞**：`via:"workspace.views"` 的键必须**仍被后端 seed 派单**且**仍在 mock allViews 里** ——
 *      后端一停派，`/v/<key>` 当场 404，而收编表会让 ① 闭嘴，于是"入口没了 + 页面也没了"一声不响；
 *   c. 同理 `via:"static-route"` 的键必须在 `App.tsx` 仍有专用 route（删了 route = 深链接死）；
 *   d. **到达路径要写出来**（`where` ≥ 6 字）：写不出"点哪里"的收编，多半是没真收编。 */
for (const { key, via, where } of consolidated) {
  if (navSet.has(key) && !navViewConsolidatedWhen.has(key)) {
    fail.push(
      `✗ 判据⑧a 收编不许两头占：CONSOLIDATED_INTO_SANDBOX["${key}"] 声明已收编，但它仍是 ${SHELL} 的\n` +
        `    NAV_GROUPS 里一个**不带 consolidatedWhen** 的 kind:"view" 条目。\n` +
        `    屏上结果 = 重复入口（控制台里一处 + 导航里一行，且导航那行永远不会消失）。\n` +
        `    修法二选一：\n` +
        `      ① 该页随控制台的 entitlement 一起消失（如沙盘五子视图 requires:["sim.sandbox"]）⇒ **删掉这个条目**；\n` +
        `      ② 该页**不受**那个 entitlement 门控（关着也能打开）⇒ 条目照留，加\n` +
        `         consolidatedWhen: "<控制台的 entitlement>"（开则隐藏、关则单列）——\n` +
        `         这与 kind:"route" 的 ⑧e 是同一条规则，只是承载方式不同。\n` +
        `    ⚠ 不许走第三条路（把条目留着不带 consolidatedWhen）：那正是「收编表里写着已收编、\n` +
        `      屏上却永远还有一行」的确切形态。`,
    );
  }
  // ⑧e：`static-route` 的收编项必须**留着**回退条目 —— 删了，控制台一关那页就只剩手敲 URL。
  if (via === "static-route" && !navRouteSet.has(key)) {
    fail.push(
      `✗ 判据⑧e 收编须留回退入口：CONSOLIDATED_INTO_SANDBOX["${key}"] 是专用 route 页（本身不受控制台的\n` +
        `    entitlement 门控），但 ${SHELL} 的 NAV_GROUPS 里已无它的 kind:"route" 条目。\n` +
        `    后果：控制台 entitlement 关着的租户 —— 控制台没有 + 导航也没有 = 这一页从 IA 里蒸发。\n` +
        `    修法：条目照留，加 consolidatedWhen: "<控制台的 entitlement>"（开则隐藏、关则单列）。`,
    );
  }
  if (typeof where !== "string" || where.trim().length < 6) {
    fail.push(
      `✗ 判据⑧d 收编须写到达路径：CONSOLIDATED_INTO_SANDBOX["${key}"].where 不足 6 字。\n` +
        `    这一栏要回答的是「用户在沙盘里点哪里能到」——答不出来就说明还没收编，只是把入口删了。`,
    );
  }
  if (via === "workspace.views") {
    if (!seededSet.has(key)) {
      fail.push(
        `✗ 判据⑧b 收编不许变黑洞：CONSOLIDATED_INTO_SANDBOX["${key}"] 声明经 workspace.views 仍可达，\n` +
          `    但 ${MANIFEST} 的 BUILTIN_VIEWS(seed:true) 里已经没有它 —— \`/v/${key}\` 现在是 404。\n` +
          `    「不在导航单列」和「页面没了」是两件事：前者是 IA 决策，后者是回归。`,
      );
    }
    if (!mockSet.has(key)) {
      fail.push(
        `✗ 判据⑧b 收编不许变黑洞：CONSOLIDATED_INTO_SANDBOX["${key}"] 不在 ${FIXTURES} 的 allViews 里 ——\n` +
          `    前端所有跑 mock 的「路由仍可达」断言对它恒真（哑门），深链接真断了也没人报。`,
      );
    }
  } else if (via === "view-defs") {
    // WO-SANDBOX-NAV-CONSOLIDATE · 增量视图桶那一支（`process-stuck` 走这条：它刻意不进
    // BUILTIN_VIEWS，否则 builtInViewFeatureDefs() 会照 featureKey 再注册一份 defaultOn:true
    // 把暗发键 `process.runtime` 顶掉）。故这里验的是 VIEW_DEFS 而不是 BUILTIN_VIEWS。
    if (!viewDefKeySet.has(key)) {
      fail.push(
        `✗ 判据⑧b 收编不许变黑洞：CONSOLIDATED_INTO_SANDBOX["${key}"] 声明经增量视图桶仍可达，\n` +
          `    但 ${VIEWDEFS} 的 VIEW_DEFS 里已经没有它 —— \`/v/${key}\` 现在是 403/404。\n` +
          `    ⚠ 别顺手把 via 改成 "workspace.views" 了事：那会让本门去查 BUILTIN_VIEWS，\n` +
          `      而这个键**刻意不在**那张表里（进去就把它的暗发键顶成 defaultOn:true）。`,
      );
    }
    if (!mockSet.has(key)) {
      fail.push(
        `✗ 判据⑧b 收编不许变黑洞：CONSOLIDATED_INTO_SANDBOX["${key}"] 不在 ${FIXTURES} 的 allViews 里 ——\n` +
          `    前端所有跑 mock 的「路由仍可达」断言对它恒真（哑门），深链接真断了也没人报。`,
      );
    }
  } else if (via === "static-route") {
    if (!routeSet.has(key)) {
      fail.push(
        `✗ 判据⑧c 收编不许变黑洞：CONSOLIDATED_INTO_SANDBOX["${key}"] 声明经专用 route 仍可达，\n` +
          `    但 ${APP} 里已无 { path: "v/${key}" } —— 落 \`v/:viewKey\` 兜底 → 404。`,
      );
    }
  } else {
    fail.push(
      `✗ 判据⑧ via 取值非法：CONSOLIDATED_INTO_SANDBOX["${key}"].via = "${via}"，\n` +
        `    只允许 "workspace.views"（BUILTIN_VIEWS seed:true）/ "view-defs"（service.ts 增量视图桶）/ "static-route"。\n` +
        `    这三个值决定本门去验哪一侧；写错 = 三侧都不验，收编表当场变成免死金牌。`,
    );
  }
}

/* ---------- 判据⑧f 两张表不许各写一半（WO-SANDBOX-NAV-CONSOLIDATE）---------- *
 * `consolidatedWhen`（写在导航条目上，决定**屏上何时隐藏**）与 `CONSOLIDATED_INTO_SANDBOX`
 * （写在收编表里，声明**到达路径还在**）是同一件事的两半。只写一半各有一种死法：
 *   · 只写 consolidatedWhen、不进收编表 ⇒ 条目会隐藏，但**没有任何人声明过它在控制台里到得了**，
 *     也没有 ⑧b/⑧c 去验那条路还通不通 —— 这就是「删入口了事」披了张皮；
 *   · 只进收编表、条目不带 consolidatedWhen ⇒ ⑧a 已经咬（重复入口）。
 * 故这里补正向那一半。 */
for (const [key, when] of navViewConsolidatedWhen) {
  if (!consolidatedSet.has(key)) {
    fail.push(
      `✗ 判据⑧f 收编须两半齐：${SHELL} 的 NAV_GROUPS 里 kind:"view" 条目 "${key}" 带了\n` +
        `    consolidatedWhen: "${when}"（= 声明「${when} 开着时我不该单列，因为我已在那个控制台里」），\n` +
        `    但 CONSOLIDATED_INTO_SANDBOX 里**没有这个键**。\n` +
        `    后果：${when} 开着的租户在导航里看不到它，而**没有任何一处声明过它在控制台里点哪能到**，\n` +
        `    也没有 ⑧b/⑧c 去验那条到达路径还通不通 —— 「收编」和「把入口删了」在屏上一模一样。\n` +
        `    修法：进 CONSOLIDATED_INTO_SANDBOX，写明 via（哪条机制仍可达）与 where（用户点哪里能到）。`,
    );
  }
}

/* ---------- 判据⑨ 组的收编承诺不许被逐条豁免掏空（WO-SANDBOX-NAV-CONSOLIDATE）---------- *
 * ── 由来（真事·仓主原话）────────────────────────────────────────────────────────
 * 「归因与风险」组原本两项都带 `consolidatedWhen: "sim.sandbox"` ⇒ 沙盘一开整组消失。
 * 后来三张单**各往组里加了一项、每一项都不带**，理由都是「沙盘五模式里没有它，
 * 带了页面就不可达」——**每条豁免单独看都成立**。合起来的效果是：这个本该消失的组
 * 在沙盘开着时永远剩三项。仓主看到屏幕后问：**「为何导航栏还有这2个，我之前不是要求你调整吗？」**
 *
 * 形态（铁律 0.6 句式）：
 *   **「我用『每条豁免单独看都成立』当作『整组收编还在生效』的证据，而前者并不度量后者。」**
 * 同族病 `G-GATE-ROSTER-HANDCOPIED`：每次加一项都合规，**累积效果无人度量**。
 * 既有判据①–⑧ 全是**逐键**判据（这个键有没有入口 / 这个键的路通不通），
 * 没有任何一条问过「这一组合起来还成不成立」—— 判据⑨ 补的就是这一问。
 *
 * 豁免不是禁止，是**必须登记且带理由**：`ShellLayout.GROUP_CONSOLIDATION_EXEMPT`
 * （单一出处在被测代码里，同 ROUTE_NO_NAV 的既有做法；门只解析对账）。 */
const groupExemptUsed = new Set();
for (const g of navGroups) {
  const hollow = hollowedOutMembers(g, GROUP_EXEMPT);
  for (const it of g.items) {
    const k = groupExemptKey(g.title, it.key);
    if (GROUP_EXEMPT[k] !== undefined) groupExemptUsed.add(k);
  }
  if (hollow.length === 0) continue;
  const promises = [...new Set(g.items.map((it) => it.consolidatedWhen).filter((w) => w !== null))];
  const remainText = promises.map((p) => `${p} 开时本组还剩 ${remainingWhenOn(g, p)} 项`).join(" · ");
  fail.push(
    `✗ 判据⑨ 本组的收编承诺正在被掏空：「${g.title}」组 —— ${remainText}（承诺兑现时该是 0 项 ⇒ 空组自动隐藏）。\n` +
      `    这一组已经对 [${promises.join(", ")}] 做出收编承诺（有成员带 consolidatedWhen），\n` +
      `    但下列成员既不带同一个 consolidatedWhen、也没有登记豁免：\n` +
      hollow.map((h) => `      · ${h.kind}:${h.key}（相对承诺 ${h.missing.join("/")} 是掏空的）`).join("\n") +
      `\n` +
      `    ⚠ 单看每一条，"它不该被收编"多半是**对的**（沙盘里确实还没有它的落点）。\n` +
      `      本判据要抓的正是这个：**每条都对，合起来把承诺掏空了**，而在此之前没有任何东西在看合起来的效果。\n` +
      `    修法三选一（**不许**用第四种：删导航项了事 —— 删了而无替代入口 = 页面彻底不可达）：\n` +
      `      ① 真收编：在那个控制台里给它一个用户点得到的落点，然后给条目加 consolidatedWhen；\n` +
      `      ② 挪组：它与本组其余成员回答的不是同一类问题 ⇒ 归到别的组去（组是按"回答什么"分的）；\n` +
      `      ③ 显式豁免：进 ${SHELL} 的 GROUP_CONSOLIDATION_EXEMPT，键 "${groupExemptKey(g.title, hollow[0].key)}"，\n` +
      `         值写清「为什么它不该被这个开关收编」（≥10 字）。豁免会被本门打印出来，无处躺平。`,
  );
}
// 豁免自身的两重约束（理由 + 不许陈旧）—— 与 ROUTE_NO_NAV / RENDERER_NO_PATH 同款纪律
for (const [k, why] of Object.entries(GROUP_EXEMPT)) {
  if (typeof why !== "string" || why.trim().length < 10) {
    fail.push(`✗ 判据⑨ 豁免须有理由：GROUP_CONSOLIDATION_EXEMPT["${k}"] 的理由不足 10 字（"待定"/"TODO" 不是理由）。`);
  }
  if (!groupExemptUsed.has(k)) {
    fail.push(
      `✗ 判据⑨ 豁免不许陈旧：GROUP_CONSOLIDATION_EXEMPT["${k}"] 在 ${SHELL} 的 NAV_GROUPS 里找不到对应的「组::项」。\n` +
        `    要么那一项已经删了/改了组，要么键写错了。陈旧豁免今天什么也不放行，\n` +
        `    却会在下一次同名组合出现时**悄悄放过它** —— 删掉即可。`,
    );
  }
}

/* ---------- 判决 ---------- */
if (gateBroken.length > 0 || fail.length > 0) {
  console.error("✗ nav-group-coverage:check 失败（本体 §8 G-NAV-FALLBACK-BUCKET）\n");
  if (gateBroken.length > 0) {
    console.error("── 门自己瞎了（先修门，别改被测代码）──\n");
    for (const f of gateBroken) console.error(f + "\n");
  }
  if (fail.length > 0) {
    if (gateBroken.length > 0) {
      /* 门瞎了时这一段**不是结论**，是坏工具的产物 —— 必须当场说清，否则读者会照着它去改代码。
       * 实测（WO-SANDBOX-NAV-CONSOLIDATE 续跑·变异反证 M7）：把 parseNavGroups 的成员正则去掉
       * `route` 一支 ⇒ 词法自检 3 条全红（门确实瞎了），而下面这段同时冒出一条
       * 「判据⑨ 豁免不许陈旧：GROUP_CONSOLIDATION_EXEMPT["推演::sim-sandbox"] 找不到对应的组::项」——
       * 那条是**纯假阳性**：豁免登记一个字没错，只是 route 项没被解析出来。 */
      console.error("── 以下是**本次扫描的产出，不是结论**（门已瞎，逐条都可能是假阳性；先修门再看）──\n");
    }
    for (const f of fail) console.error(f + "\n");
  }
  console.error(
    `参考：后端 seeded=${seeded.length} · mock allViews=${mockKeys.length} · NAV_GROUPS view 键=${navSet.size}` +
      ` · NAV_GROUPS route 键=${navRouteSet.size} · App.tsx 专用 route=${routeSet.size}` +
      ` · NAV_GROUPS 组数=${navGroups.length} · 已注册 renderer=${registeredRenderers.length}` +
      ` · 可达 renderer 并集=${rendererReachable.size}`,
  );
  /* ── 退出码三分（WO-SANDBOX-NAV-CONSOLIDATE 补齐）──────────────────────────────
   * 本文件顶部的兜底注释早就写着「2 = 工具自己坏了（1 留给主判据明确判负那一条路径，
   * 两者处置相反，不许合并）」，而这一行**一直把两者合并成 1** —— 门自己瞎了会被读成
   * 「你的代码有问题」，方向正好相反（去改被测代码，而该改的是门）。
   * 形态与顶部兜底那条同源：「我用『进程非 0 退出』当作『代码有问题』的证据。」
   *
   * ⚠ **2026-08-17 续跑订正（变异反证 M7 当场抖出）**：上一版写的是
   * `fail.length > 0 ? 1 : 2` —— 判负优先级给了 `fail`，理由是「真违规存在 ⇒ 先修代码」。
   * **这个优先级是反的**，且它自己就是本文件顶部那句话警告的病：
   * 门瞎了的时候，`fail` 里那几条**不是「真违规」，是坏工具的产物**。实测把
   * `parseNavGroups` 的成员正则去掉 `route` 一支：词法自检 3 条全红（门确实瞎了），
   * 同时 `fail` 冒出一条「豁免陈旧，删掉即可」的**纯假阳性** ⇒ 旧版 RC=1 ⇒ 照 SOP
   * §3 的表（1 = 真有问题、先修再说）读，人会去删一条完全正确的豁免登记。
   * 形态（0.6 句式）：**「我用『fail 非空』当作『被扫代码真有问题』的证据，
   * 而门瞎了时 fail 度量的是门，不是代码。」**
   * ⇒ 判负优先级改为 **门坏了优先**：`gateBroken` 非空 ⇒ 一律 2（整次结论作废，
   * 包括上面那段 fail）。真违规不会因此丢 —— 门修好后它们原样再报一次，那时才是 RC=1。
   * 这不违反顶部兜底那句「不动既有 exit(1)」：那句护的是**别把真违规吞成 2**，
   * 而这里的前提恰恰是「门已自证瞎了，此刻没有『真违规』这个可信品类」。
   * 判决本体在 `verdictExitCode`（文件上方），那里带四例金丝雀 —— 再写反一次会被自己咬住。 */
  process.exit(verdictExitCode(gateBroken.length, fail.length));
}
const exemptNote =
  Object.keys(INTENTIONALLY_NO_NAV).length === 0
    ? "无刻意豁免"
    : `刻意不给导航 ${Object.entries(INTENTIONALLY_NO_NAV).map(([k, why]) => `${k}（${why}）`).join(" · ")}`;
const rendererExemptNote =
  Object.keys(RENDERER_NO_PATH).length === 0
    ? "无豁免"
    : `刻意不可达 ${Object.entries(RENDERER_NO_PATH).map(([k, why]) => `${k}（${why}）`).join(" · ")}`;
// 收编表也必须打出来（同 INTENTIONALLY_NO_NAV 的做法：放行必须留痕，无处躺平）。
const consolidatedNote =
  consolidated.length === 0
    ? "无收编"
    : `已收编进沙盘 ${consolidated.map((c) => `${c.key}（${c.via}·${c.where}）`).join(" · ")}`;
console.log(
  `✓ nav-group-coverage:check：后端 ${seeded.length} 个 seeded 内置视图全部有 NAV_GROUPS 归属（或已收编）且全在 mock allViews 里；` +
    `${routeSet.size} 条专用 route 全部有 kind:"route" 入口（或已收编）且无悬空条目 —— ${exemptNote}` +
    `（mock allViews=${mockKeys.length} · NAV_GROUPS view 键=${navSet.size} · route 键=${navRouteSet.size}）\n` +
    `  ${consolidatedNote}`,
);
/* 判据⑨ 也必须留痕：哪些组做了收编承诺、承诺是否兑现、豁免了谁 —— 放行必须看得见（同 ROUTE_NO_NAV）。 */
{
  const promiseGroups = navGroups.filter((g) => g.items.some((it) => it.consolidatedWhen !== null));
  const note = promiseGroups
    .map((g) => {
      const promises = [...new Set(g.items.map((it) => it.consolidatedWhen).filter((w) => w !== null))];
      return promises.map((p) => `「${g.title}」→ ${p} 开时剩 ${remainingWhenOn(g, p)} 项`).join(" · ");
    })
    .join(" · ");
  const ex =
    Object.keys(GROUP_EXEMPT).length === 0
      ? "无组豁免"
      : `组豁免 ${Object.entries(GROUP_EXEMPT).map(([k, why]) => `${k}（${why}）`).join(" · ")}`;
  console.log(
    `✓ 判据⑨ 组收编承诺未被掏空：${promiseGroups.length} 个组做了收编承诺 —— ${note || "（无）"}\n` +
      `  （剩 0 项 = 空组自动隐藏 = 承诺兑现；剩 N>0 项且那 N 项在下面的豁免表里逐条有理由，也算兑现）\n` +
      `  ${ex}`,
  );
}
console.log(
  `✓ 判据⑦ 渲染器可达：${REGISTRY} 的 ${registeredRenderers.length} 个 registerRenderer 键，` +
    `每个都至少有一条路径渲染得到（后端派单 ${new Set([...seededRenderers, ...viewDefRenderers]).size} 个 renderer` +
    ` · 专用 route ${routeSet.size} 条 ⇒ 可达并集 ${rendererReachable.size}）—— 豁免棘轮 ` +
    `${Object.keys(RENDERER_NO_PATH).length}/${RENDERER_NO_PATH_CEILING}，${rendererExemptNote}`,
);
