import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, PLANNER, BASE_MANAGER } from "./helpers.js";
import { BUILTIN_VIEWS, SEEDED_VIEW_KEYS } from "../src/synthetic/view-manifest.js";
import { VIEW_FEATURE_MAP, ALL_FEATURE_KEYS } from "../src/features.js";

/**
 * WO-R9-NAVREACH · 采购四段腿分解「该找谁」页 —— **派单侧接缝门**（SEAM-GATE 的后端那一半）。
 *
 * ══ 这道门为什么必须存在（三形态定性 · 铁律 0.5）══════════════════════════════
 *
 * 收编提交 `edeb3a10`（reclaim WO-R5 3/7）**只收了前端半**：`views/registry.ts:103` 注册了
 * renderer、组件真实现、`test/procurement-legs-reachable.test.tsx` 12 例全绿 ——
 * 而后端**从未派单**。三形态里这是 **「没接线」**（不是"接了线没数据"，也不是"接错地方"）：
 * 该 view 键在 `apps/datacore/src` 里**整个不存在**。
 *
 * 后果不是报错，是**页面根本不存在**：
 *   `workspace.views` 没有它 ⇒ `ViewPage` 双闸（feature ∧ views）全关 ⇒ `/v/procurement-legs`
 *   落 404/403；`App.tsx` 又无专用 route ⇒ 手敲 URL 也只落 `v/:viewKey` 通用守卫。
 *   **组件再全、那 12 例再绿，用户一次都打不开。**
 *
 * 那 12 例为什么拦不住：它们从 `getRenderer("procurement-legs")` **直接取组件**再渲染 ——
 * 证明的是「拿到 renderer 之后能画出来」，**不证明「有任何东西能让你拿到 renderer」**
 * （`G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 假绿第 9 形态：测试咬的是**函数**不是**链路**）。
 *
 * ══ 本文件咬**链路**：从真 HTTP 出发，不从数组出发 ═══════════════════════════════
 *
 * 断言一律走 `GET /a/v1/me/workspace`（= 前端启动序列真打的那个端点），
 * 而**不是**去 `expect(BUILTIN_VIEWS).toContainEqual(...)` —— 后者只证明"我往数组里写了一行"，
 * 证不了那一行真的流过 `SEEDED_VIEW_KEYS → scenarioSeed.views → seedViewConfigs → ViewConfig
 * → /me/workspace` 这条五跳链。**摘掉 `view-manifest.ts` 那一行，本文件当场红。**
 *
 * ⚠ 接缝的**另一半**（前端真渲染 + 侧栏找得到）在
 *   `apps/frontend-shell/test/procurement-legs-navreach.seam.test.tsx`；
 *   两半之间的**跨 app 对账**（后端派单集 ≡ mock allViews ≡ NAV_GROUPS）由
 *   `scripts/check-nav-group-coverage.mjs` 判据①②⑦ 机械守 —— R1 contracts-only-shared
 *   禁止前端跨 app import 源码，故那一段只能是门脚本，不能是任一侧的 vitest。
 */

type WsView = { viewKey: string; renderer: string; title?: string };
type WsNav = { key: string; group: string; viewKey?: string };
interface Workspace {
  views: WsView[];
  navigation: WsNav[];
  features: string[];
}

const VIEW_KEY = "procurement-legs";
const FEATURE_KEY = "view.procurement-legs";
/** 已知必中的同族视图（金丝雀）：与本页同批走 BUILTIN_VIEWS、同样不挂 requires。 */
const CANARY_VIEW_KEY = "process-wait";

async function workspace(
  t: Awaited<ReturnType<typeof makeApp>>,
  headers: Record<string, string>,
): Promise<Workspace> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers });
  expect(res.statusCode).toBe(200);
  return res.json() as Workspace;
}

describe("WO-R9-NAVREACH · §0 金丝雀（否定结论前先自证工具·铁律 0.6）", () => {
  /**
   * 下面几组里有**否定形**断言（「不挂 requires」「base_manager 不该少它」）。
   * 取数若本身是空的，这些断言会**恒真** —— 那是哑门，不是绿。故先证前提成立。
   */
  it("金丝雀：BUILTIN_VIEWS 非空、含已知必中的同族键，且解析得出 seed 集", () => {
    expect(BUILTIN_VIEWS.length, "BUILTIN_VIEWS 读空 ⇒ 下面所有断言恒真（哑门）").toBeGreaterThan(10);
    expect(
      SEEDED_VIEW_KEYS,
      `金丝雀键 ${CANARY_VIEW_KEY} 不在 seed 集里 —— 不是本页坏了，是本测试的取数路径坏了`,
    ).toContain(CANARY_VIEW_KEY);
    // 被测键本身（不是金丝雀，是断言对象）
    expect(SEEDED_VIEW_KEYS).toContain(VIEW_KEY);
  });
});

describe("WO-R9-NAVREACH · §A 派单链路（从真 HTTP 出发·摘掉 manifest 那行即红）", () => {
  it("A1 · 出厂种子后 GET /a/v1/me/workspace 真下发 procurement-legs（views + navigation + features 三者齐）", async () => {
    const t = await makeApp();
    await seedBattery(t); // 默认内存仓储 —— 正是"重启即隐身"那个真实态

    for (const headers of [ADMIN, PLANNER]) {
      const ws = await workspace(t, headers);

      // ① ViewPage 第二道闸：workspace.views 里必须有它，否则 /v/<key> → 403 ForbiddenPage
      const view = ws.views.find((v) => v.viewKey === VIEW_KEY);
      expect(view, `workspace.views 没有 ${VIEW_KEY} ⇒ ViewPage 第二道闸关死 ⇒ 页面 403`).toBeDefined();

      // renderer 必须**逐字**等于前端 registry 的注册键。写错一个字符不会报错，
      // 只会让 ViewPage 落「该视图类型暂不支持」兜底卡 —— 那种坏法最难查（页面开得出来，是空的）。
      expect(view!.renderer, "renderer 与 views/registry.ts 的注册键漂移 ⇒ 落「暂不支持」兜底卡").toBe(VIEW_KEY);

      // ② ViewPage 第一道闸：entitlement。关 ⇒ 404 FEATURE_NOT_FOUND（不是 403，不泄露存在性·R3）
      expect(ws.features, `${FEATURE_KEY} 未下发 ⇒ ViewPage 第一道闸关死 ⇒ 页面 404`).toContain(FEATURE_KEY);

      // ③ 可发现性的后端那一半：它得真出现在 business 导航里，前端才有东西可归组
      const viewKeys = new Set(ws.views.map((v) => v.viewKey));
      const nav = ws.navigation.filter((n) => n.group === "business").map((n) => n.viewKey ?? n.key);
      expect(nav.length).toBeGreaterThan(1);
      expect(nav, `${VIEW_KEY} 不在 business 导航里 ⇒ 前端 NAV_GROUPS 查不中 ⇒ 条目静默消失`).toContain(VIEW_KEY);
      /**
       * ∀ 而非 ∃：**一条**导航都不许指向 `workspace.views` 之外的键 —— 那是孤儿入口，
       * 侧栏点得着、点进去 403/404。只咬被测那一个键时，「N 条导航里只有它对得上」
       * 与「N 条全对得上」测试同色（假绿第 12 形态）。
       * 这与 §B 的 R3 是同一条不变量的两面：那边验"关了就不许留在导航里"，
       * 这边验"留在导航里的必须真发得出视图"。
       */
      const orphans = nav.filter((k) => !viewKeys.has(k));
      expect(orphans, `business 导航里有 workspace.views 之外的孤儿入口：${orphans.join("、")}`).toEqual([]);
    }
  });

  it("A2 · 单一来源闭包：featureKey 已注册 + VIEW_FEATURE_MAP 有一致映射（漂移即前端双闸打架）", () => {
    const bv = BUILTIN_VIEWS.find((v) => v.key === VIEW_KEY);
    expect(bv, `BUILTIN_VIEWS 里没有 ${VIEW_KEY} —— 派单侧那一半又没了`).toBeDefined();
    expect(bv!.seed, "seed:false ⇒ 不进 scenarioSeed.views ⇒ 永远不下发（等于没接线）").toBe(true);
    expect(ALL_FEATURE_KEYS).toContain(FEATURE_KEY);
    expect(VIEW_FEATURE_MAP[VIEW_KEY]).toBe(FEATURE_KEY);
  });

  /**
   * 语义归属的**承重断言**（不是风格偏好，改了会真出问题）：
   * 挂上 `requires: ["sim.sandbox"]` ⇒ 沙盘 entitlement 一关，本页连 `workspace.views` 都没有
   * ⇒「关了推演沙盘就看不到该找谁」。采购/齐套是业务主数据域，与沙盘无从属关系，那是**假依赖**。
   */
  it("A3 · 不挂 requires:[sim.sandbox]（挂上去 = 造一条「关沙盘就看不到采购分解」的假依赖）", () => {
    const bv = BUILTIN_VIEWS.find((v) => v.key === VIEW_KEY)!;
    expect(bv.requires ?? [], "采购分解被挂到沙盘门下 —— 假依赖").not.toContain("sim.sandbox");
    // 金丝雀：同表里**确实存在**挂了 requires 的项 ⇒ 上面那条否定断言不是在空集合上恒真
    const withRequires = BUILTIN_VIEWS.filter((v) => (v.requires ?? []).includes("sim.sandbox"));
    expect(withRequires.length, "全表没有任何 requires:sim.sandbox 项 ⇒ 上一条否定断言恒真（哑门）").toBeGreaterThan(0);
  });

  /**
   * `kit_readiness` 是**多路共用**求解器（QOS 问答 / 场景解读 / 前端 mock 均在调）。
   * 把它绑到本页这个 VIEW 级功能上 ⇒ 关掉这一页会连带 404 掉所有别的调用方
   * （`features.ts requireByBinding` 按 solverKeys 反查）。绑定表达的是「该功能独占该求解器」，此处不成立。
   */
  it("A4 · 不把共用求解器 kit_readiness 绑成本页专属（绑了 = 关一页连坐所有调用方）", () => {
    const bv = BUILTIN_VIEWS.find((v) => v.key === VIEW_KEY)!;
    expect(bv.bindings?.solverKeys ?? []).not.toContain("kit_readiness");
    // 金丝雀：同表里确实有项带 solverKeys 绑定 ⇒ 否定断言前提成立
    const withSolverBinding = BUILTIN_VIEWS.filter((v) => (v.bindings?.solverKeys ?? []).length > 0);
    expect(withSolverBinding.length, "全表零 solverKeys 绑定 ⇒ 上一条恒真（哑门）").toBeGreaterThan(0);
  });

  it("A5 · base_manager 也拿得到（采购分解正是基地经理该看的页 —— 不因升核心而漏角色）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ws = await workspace(t, BASE_MANAGER);
    // 金丝雀：base_manager 的视图集非空（空集合会让下面 toContain 之外的一切判断失去意义）
    expect(ws.views.length, "base_manager 视图集为空 ⇒ 本条无意义").toBeGreaterThan(0);
    expect(ws.views.map((v) => v.viewKey)).toContain(VIEW_KEY);
    // 对照：global-sim 是显式排除的那一个（证明"排除"这件事在本用例里真的有效，不是所有键都恒在）
    expect(ws.views.map((v) => v.viewKey)).not.toContain("global-sim");
  });
});

describe("WO-R9-NAVREACH · §B R3「功能关闭 = 不存在」（404 不是 403）", () => {
  /**
   * Entitlement 先于 authz：功能关 ⇒ 该视图**不下发**（连存在性都不泄露）。
   * 这条同时证明本页的 entitlement 真的接在 workspace 过滤链上 —— 而不是"加了个 feature 键没人读"。
   */
  it("B1 · view.procurement-legs 关 → workspace 既不下发视图也不下发导航（前端据此 404）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 先取一次基线：关之前它确实在（否则下面的 not.toContain 是恒真的空转）
    const before = await workspace(t, PLANNER);
    expect(before.views.map((v) => v.viewKey), "关之前它就不在 ⇒ 本条恒真（哑门）").toContain(VIEW_KEY);

    const put = await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { [FEATURE_KEY]: false } },
    });
    expect(put.statusCode, "override 端点没生效 ⇒ 下面全是空转").toBe(200);

    const after = await workspace(t, PLANNER);
    expect(after.features).not.toContain(FEATURE_KEY);
    expect(after.views.map((v) => v.viewKey), "功能关着仍下发视图 ⇒ 孤儿态（R3）").not.toContain(VIEW_KEY);
    expect(
      after.navigation.filter((n) => n.group === "business").map((n) => n.viewKey ?? n.key),
      "功能关着入口仍在导航里 —— 泄露了功能存在性（R3）",
    ).not.toContain(VIEW_KEY);
    // 金丝雀：只关这一个，别的视图不受牵连（连坐 = 绑错了 requires/bindings）
    expect(after.views.map((v) => v.viewKey), "关一页把金丝雀页也连坐关了 ⇒ 绑定挂错").toContain(CANARY_VIEW_KEY);
  });
});
