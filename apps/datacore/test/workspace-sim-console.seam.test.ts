import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, PLANNER, BASE_MANAGER } from "./helpers.js";
import { VIEW_FEATURE_MAP } from "../src/features.js";
import { SANDBOX_CONSOLE_FEATURE_KEY, SANDBOX_CONSOLE_VIEWS } from "../src/synthetic/sandbox-console.js";

/**
 * WO-SIM-BE-VIEWKEY · 推演沙盘指控台四视图 —— **派单侧接缝门**（SEAM-GATE 的后端那一半）。
 *
 * ══ 今天的行为是 X，应该是 Y（开工前实测，不是读码推断）══════════════════════════
 *
 * **X**：前端 `views/registry.ts` 逐字注册了四个渲染器（`./sim/console/` 那四行），
 *       而 `grep -rn "sim-console\|sim-conduction\|sim-attribution\|sim-optimize"
 *       apps/datacore/src apps/agentcore/src packages/contracts/src` **零命中** ——
 *       三形态定性（铁律 0.5）＝ **「没接线」**。后果不是报错，是**页面根本不存在**：
 *       `workspace.views` 没有它 ⇒ `ViewPage` 第二道闸 403；`features` 没有 `view.<key>`
 *       ⇒ 第一道闸 404；`App.tsx` 无专用 route ⇒ 手敲 URL 也只落 `v/:viewKey` 通用守卫。
 *       机器早就在说这句话：`node scripts/check-nav-group-coverage.mjs` 判据⑦ 本单开工前
 *       就红着，报的正是这四个键「注册了但没有任何路径渲染得到」。
 * **Y**：`GET /a/v1/me/workspace` 按 `sim.sandbox` 这把**既有的**闸下发这四个视图
 *       （views + navigation + `view.<key>` 三者齐），前端拿到即能渲染。
 *
 * ══ 本文件咬**链路**，不咬数组 ═══════════════════════════════════════════════════
 *
 * 断言一律走 `GET /a/v1/me/workspace`（= 前端启动序列真打的那个端点），而不是
 * `expect(SANDBOX_CONSOLE_VIEWS).toContain(...)` —— 后者只证明"我往数组里写了一行"，
 * 证不了那一行真的流过 `DARK_LAUNCH_EXTRA_KEYS → seedViewConfigs → ViewConfig →
 * viewAllowed() → /me/workspace` 这条链。摘掉任何一环，本文件当场红。
 *
 * ⚠ **四个 renderer 键从前端那个文件读，不写死**（本单硬约束①）：派单里给的键是线索不是
 *   结论，唯一真值是 `apps/frontend-shell/src/views/registry.ts` 的 `registerRenderer()`
 *   第一个实参。读不到 ⇒ 报「**工具坏了**」（金丝雀不中即 fail），**不许**跳过。
 */

/* ══ §0 前端真值源：从 registry.ts 现抽四个键（不写死）══════════════════════════════ */

const REGISTRY_PATH = fileURLToPath(
  new URL("../../frontend-shell/src/views/registry.ts", import.meta.url),
);

/**
 * 抽 `registerRenderer("<key>", () => import("<模块路径>"))` 全表。
 *
 * 注释行不算数（`//` / 块注释续行 `*`）—— 本仓注释密度下「注释里提了一嘴某个键」
 * 会被读成「已注册」，集合平白变大。同 `scripts/lib/sim-page-roster.mjs` 的纪律。
 */
function parseRegisterRenderer(src: string): { key: string; module: string }[] {
  const out: { key: string; module: string }[] = [];
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    const m = t.match(/^registerRenderer\(\s*"([^"]+)"\s*,[^"]*"([^"]+)"/);
    if (m) out.push({ key: m[1]!, module: m[2]! });
  }
  return out;
}

const registrySrc = readFileSync(REGISTRY_PATH, "utf8");
const allRegistered = parseRegisterRenderer(registrySrc);
/** 指控台家族的判别式：组件住在 `./sim/console/` —— 比"键名以 sim- 开头"精确（后者会捞到别的页）。 */
const consoleKeysFromFrontend = allRegistered
  .filter((r) => r.module.startsWith("./sim/console/"))
  .map((r) => r.key);

type WsView = { viewKey: string; renderer: string; title?: string; options?: Record<string, unknown> };
type WsNav = { key: string; label: string; group: string; viewKey?: string };
interface Workspace {
  views: WsView[];
  navigation: WsNav[];
  features: string[];
}

async function workspace(
  t: Awaited<ReturnType<typeof makeApp>>,
  headers: Record<string, string>,
): Promise<Workspace> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers });
  expect(res.statusCode).toBe(200);
  return res.json() as Workspace;
}

describe("WO-SIM-BE-VIEWKEY · §0 金丝雀（否定结论前先自证工具·铁律 0.6）", () => {
  it("§0.1 抽取器没瞎：registry.ts 读得到、且含已知必中的键 dashboard", () => {
    expect(registrySrc.length, `读不到 ${REGISTRY_PATH} ⇒ 工具坏了，不是代码干净`).toBeGreaterThan(500);
    expect(
      allRegistered.length,
      "registerRenderer 一条都没抽出来 ⇒ **工具坏了**（正则/路径失效），不许读成「前端没注册」",
    ).toBeGreaterThan(20);
    expect(
      allRegistered.map((r) => r.key),
      "金丝雀键 dashboard 没抽到 ⇒ 抽取器坏了，下面所有断言都不可信",
    ).toContain("dashboard");
  });

  it("§0.2 判别式没瞎：`./sim/console/` 恰好四条，且与后端声明表逐字一致", () => {
    expect(
      consoleKeysFromFrontend,
      "前端 `./sim/console/` 下抽出的渲染器键数不是 4 —— 前端改了而后端没跟，本文件的被测对象已失真",
    ).toHaveLength(4);
    // 后端声明表（sandbox-console.ts 的 SANDBOX_CONSOLE_VIEWS）必须与前端真值**逐字**一致。
    // 写错一个字母不会报错，只会让 ViewPage 落「该视图类型暂不支持」兜底卡 ——
    // 页面开得出来、是空的，本仓最难查的那种坏法。
    expect([...SANDBOX_CONSOLE_VIEWS.map((v) => v.key)].sort()).toEqual([...consoleKeysFromFrontend].sort());
    expect([...SANDBOX_CONSOLE_VIEWS.map((v) => v.renderer)].sort()).toEqual(
      [...consoleKeysFromFrontend].sort(),
    );
  });
});

describe("WO-SIM-BE-VIEWKEY · §A 派单链路（从真 HTTP 出发·摘掉任一环即红）", () => {
  it("A1 · admin 拉 workspace ⇒ 四个 renderer 全在，且键值与 registry.ts 逐字一致", async () => {
    const t = await makeApp();
    await seedBattery(t); // 默认内存仓储 —— 正是"重启即隐身"那个真实态

    const ws = await workspace(t, ADMIN);
    const byKey = new Map(ws.views.map((v) => [v.viewKey, v]));

    for (const key of consoleKeysFromFrontend) {
      // ① ViewPage 第二道闸：workspace.views 里必须有它，否则 /v/<key> → 403 ForbiddenPage
      const view = byKey.get(key);
      expect(view, `workspace.views 没有 ${key} ⇒ ViewPage 第二道闸关死 ⇒ 页面 403`).toBeDefined();

      // renderer **逐字**等于前端注册键（漂移 ⇒ 落「该视图类型暂不支持」兜底卡：页面是空的）
      expect(
        view!.renderer,
        `renderer 与 views/registry.ts 的注册键漂移（后端下发「${view!.renderer}」/ 前端注册「${key}」）⇒ 落「暂不支持」兜底卡`,
      ).toBe(key);

      // ② ViewPage 第一道闸：entitlement 别名。缺它 ⇒ 导航里点得到、点进去 404（最难查的那一种）
      expect(
        ws.features,
        `view.${key} 未下发 ⇒ ViewPage 第一道闸关死 ⇒ 页面 404（而 workspace.views 里明明有它）`,
      ).toContain(`view.${key}`);

      // ③ 可发现性的后端那一半：真出现在 business 导航里，前端才有东西可归组
      const nav = ws.navigation.filter((n) => n.group === "business").map((n) => n.viewKey ?? n.key);
      expect(nav.length).toBeGreaterThan(1);
      expect(nav, `${key} 不在 business 导航里 ⇒ 用户在导航里点不到`).toContain(key);
    }

    // 标题真下发（导航 label / 页标题读的就是它，空标题会让侧栏出现一条无字条目）
    for (const v of SANDBOX_CONSOLE_VIEWS) {
      expect(byKey.get(v.key)!.title, `${v.key} 标题没下发`).toBe(v.title);
    }

    /**
     * ∀ 而非 ∃：一条导航都不许指向 `workspace.views` 之外的键 —— 那是孤儿入口，
     * 侧栏点得着、点进去 403/404（同 procurement-legs-navreach 的那条不变量）。
     */
    const viewKeys = new Set(ws.views.map((v) => v.viewKey));
    const orphans = ws.navigation
      .filter((n) => n.group === "business")
      .map((n) => n.viewKey ?? n.key)
      .filter((k) => !viewKeys.has(k));
    expect(orphans, `business 导航里有 workspace.views 之外的孤儿入口：${orphans.join("、")}`).toEqual([]);
  });

  it("A2 · options 里不许硬编 sessionId（会话是运行期的，写进配置就成死值）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ws = await workspace(t, ADMIN);
    for (const key of consoleKeysFromFrontend) {
      const opts = ws.views.find((v) => v.viewKey === key)!.options ?? {};
      expect(
        Object.keys(opts),
        `${key}.options 带了 sessionId —— 前端 useConsoleSession() 自己查最近一条 RUNNING，后端只管下发视图`,
      ).not.toContain("sessionId");
    }
  });

  it("A3 · 走的是既有那把闸：四个 viewKey 全映到 sim.sandbox，没有另起一套 entitlement", () => {
    for (const key of consoleKeysFromFrontend) {
      expect(
        VIEW_FEATURE_MAP[key],
        `${key} 的受控键不是 ${SANDBOX_CONSOLE_FEATURE_KEY} —— 另起了一套闸（本单明令禁止）`,
      ).toBe(SANDBOX_CONSOLE_FEATURE_KEY);
    }
    // 金丝雀：这张表里**确实存在**别的受控键（否则上面 4 条 toBe 是在一张恒同的表上空转）
    expect(new Set(Object.values(VIEW_FEATURE_MAP)).size).toBeGreaterThan(3);
  });
});

describe("WO-SIM-BE-VIEWKEY · §B R3「功能关闭 = 不存在」（不出现，不是出现但点不开）", () => {
  it("B1 · sim.sandbox 关 → 四个视图一个都不出现（views / navigation / features 三处同时消失）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 先取基线：关之前四个确实都在（否则下面的 not.toContain 全是恒真的空转 = 哑门）
    const before = await workspace(t, PLANNER);
    for (const key of consoleKeysFromFrontend) {
      expect(before.views.map((v) => v.viewKey), `关之前 ${key} 就不在 ⇒ 本条恒真（哑门）`).toContain(key);
    }

    const put = await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { [SANDBOX_CONSOLE_FEATURE_KEY]: false } },
    });
    expect(put.statusCode, "override 端点没生效 ⇒ 下面全是空转").toBe(200);

    const after = await workspace(t, PLANNER);
    const afterViewKeys = after.views.map((v) => v.viewKey);
    const afterBizNav = after.navigation.filter((n) => n.group === "business").map((n) => n.viewKey ?? n.key);
    for (const key of consoleKeysFromFrontend) {
      expect(afterViewKeys, `沙盘关着仍下发视图 ${key} ⇒ 孤儿态（R3）`).not.toContain(key);
      expect(afterBizNav, `沙盘关着入口仍在导航里 ${key} —— 泄露了功能存在性（R3）`).not.toContain(key);
      expect(
        after.features,
        `沙盘关着仍下发 view.${key} ⇒ 前端页面侧守卫被绕过（R3）`,
      ).not.toContain(`view.${key}`);
    }
    // 金丝雀：只关沙盘这一族，别的视图不受牵连（连坐 = 映射挂错了地方）
    expect(afterViewKeys, "关沙盘把驾驶舱也连坐关了 ⇒ 映射挂错").toContain("dash");
    expect(afterViewKeys, "关沙盘把流程等待态也连坐关了 ⇒ 映射挂错").toContain("process-wait");
  });
});

describe("WO-SIM-BE-VIEWKEY · §C 角色口径（照抄沙盘家族既有那条，不自定）", () => {
  /**
   * 抄的是哪一条：**沙盘一家只按 `sim.sandbox` 判、不按角色判**。两个出处：
   *  · 沙盘主屏 `sim-sandbox` 在 `ShellLayout.NAV_GROUPS` 是
   *    `{ kind:"route", key:"sim-sandbox", label:"推演沙盘", feature:"sim.sandbox" }`
   *    —— 只有功能闸，零角色条件；
   *  · 五个沙盘子视图走核心 `views`，而 `synthetic/service.ts` 里 base_manager 的排除名单是
   *    `["dash","graph","plan-audit","plan-generate","global-sim"]` —— 一个沙盘键都不在。
   */
  it("C1 · admin / planner / base_manager 三个角色都拿得到四个视图", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const [name, headers] of [
      ["admin", ADMIN],
      ["planner", PLANNER],
      ["base_manager", BASE_MANAGER],
    ] as const) {
      const ws = await workspace(t, headers);
      expect(ws.views.length, `${name} 视图集为空 ⇒ 本条无意义`).toBeGreaterThan(0);
      const keys = ws.views.map((v) => v.viewKey);
      for (const key of consoleKeysFromFrontend) {
        expect(keys, `${name} 拿不到 ${key} —— 与沙盘家族既有角色口径不一致`).toContain(key);
      }
      // 同族对照：五个沙盘子视图之一，base_manager 今天本来就拿得到（这就是被抄的那条口径本身）
      expect(keys, `${name} 拿不到沙盘子视图 chain-line-map —— 被抄的那条口径已变，本组断言失去依据`).toContain(
        "chain-line-map",
      );
    }
  });

  it("C2 · 对照：base_manager 仍拿不到显式排除的 global-sim（证明「排除」这件事真的在生效）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ws = await workspace(t, BASE_MANAGER);
    expect(ws.views.map((v) => v.viewKey), "排除名单整体失效 ⇒ C1 的「都拿得到」不构成证据").not.toContain(
      "global-sim",
    );
  });
});
