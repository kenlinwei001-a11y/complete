import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, PLANNER, BASE_MANAGER } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { VIEW_FEATURE_MAP, ALL_FEATURE_KEYS } from "../src/features.js";
import { BUILTIN_VIEWS, SEEDED_VIEW_KEYS, assertViewManifestIntegrity } from "../src/synthetic/view-manifest.js";

/**
 * WO-MEMORY-VIEW-RESILIENCE · 验收（PRD §4.4）——"内存模式视图默认配置防丢"。
 *
 * 接缝守门（绿测试≠能用·断在接缝）：内置视图定义此前散落 4 处（FEATURE_REGISTRY / VIEW_FEATURE_MAP / VIEW_DEFS /
 * scenarioSeed.views）各自手维护 → global-sim 曾在前 3 处齐备但 scenarioSeed 漏接 → 内存态（DATABASE_URL 未设）每次
 * 重启后 /me/workspace 不含「全局推演」→ 页面隐身。本测在**默认内存态种子路径**上端到端断言：seeded 集全部现身 +
 * 单一来源闭包一致 + fail-fast 有牙不误伤 + cross_object 内存态可行（§4.5）。
 */

type WsView = { viewKey: string; renderer: string };
type WsNav = { key: string; group: string };
interface Workspace {
  views: WsView[];
  navigation: WsNav[];
  features: string[];
}

async function workspace(t: Awaited<ReturnType<typeof makeApp>>, headers: Record<string, string>): Promise<Workspace> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers });
  expect(res.statusCode).toBe(200);
  return res.json() as Workspace;
}

describe("WO-MEMORY-VIEW-RESILIENCE · 内存模式视图默认配置防丢", () => {
  it("A · 出厂种子后 /me/workspace（planner/admin）导航与视图**必含 global-sim**（治重启隐身）", async () => {
    const t = await makeApp();
    await seedBattery(t); // 默认内存仓储（无 DATABASE_URL）——正是复现"重启即隐身"的真实态
    for (const headers of [PLANNER, ADMIN]) {
      const ws = await workspace(t, headers);
      expect(ws.views.map((v) => v.viewKey)).toContain("global-sim");
      expect(ws.navigation.filter((n) => n.group === "business").map((n) => n.key)).toContain("global-sim");
      // entitlement 门也须齐（前端 ViewPage 双门 workspace.views ∧ features）
      expect(ws.features).toContain("view.global-sim");
      // global-sim 视图 renderer 来自单一来源（非 key 兜底）——证 VIEW_DEFS 真产出该视图
      expect(ws.views.find((v) => v.viewKey === "global-sim")?.renderer).toBe("global-sim");
    }
  });

  it("A2 · base_manager 沿用原样不纳入 global-sim（保行为不变·不因升核心而扩权）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ws = await workspace(t, BASE_MANAGER);
    expect(ws.views.map((v) => v.viewKey)).not.toContain("global-sim");
  });

  it("B · BUILTIN_VIEWS seeded 集 ⊆ (VIEW_FEATURE_MAP ∩ VIEW_DEFS) 闭包（单一来源·防漂移）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // admin 视图配置 = 从 VIEW_DEFS 种出的 ViewConfig.views（renderer 由 VIEW_DEFS 决定）。
    const adminWs = await workspace(t, ADMIN);
    const rendererByKey = new Map(adminWs.views.map((v) => [v.viewKey, v.renderer]));
    const seeded = BUILTIN_VIEWS.filter((v) => v.seed);
    expect(seeded.map((v) => v.key)).toEqual(SEEDED_VIEW_KEYS); // filter(seed) 与导出常量一致
    for (const bv of seeded) {
      // ∩ VIEW_FEATURE_MAP：viewKey → featureKey 映射存在且一致
      expect(VIEW_FEATURE_MAP[bv.key], `VIEW_FEATURE_MAP 缺 ${bv.key}`).toBe(bv.featureKey);
      // featureKey 已在功能注册表（否则 filterByFeatures 会静默滤掉 → 视图隐身）
      expect(ALL_FEATURE_KEYS, `功能未注册 ${bv.featureKey}`).toContain(bv.featureKey);
      // ∩ VIEW_DEFS：种出的 ViewConfig 里该视图 renderer 来自 VIEW_DEFS（= 单一来源 renderer·非 key 兜底）
      expect(rendererByKey.get(bv.key), `VIEW_DEFS 未产出 ${bv.key}`).toBe(bv.renderer);
    }
  });

  it("C · assertViewManifestIntegrity 有牙不误伤：真接线通过·断链即抛（fail-fast §4.3）", () => {
    // 不误伤：真实 VIEW_FEATURE_MAP + 齐备 viewDefs + 已注册功能 → 不抛
    expect(() =>
      assertViewManifestIntegrity({
        viewFeatureMap: VIEW_FEATURE_MAP,
        viewDefs: Object.fromEntries(BUILTIN_VIEWS.map((v) => [v.key, {}])),
        registeredFeatureKeys: new Set(ALL_FEATURE_KEYS),
      }),
    ).not.toThrow();
    // 有牙：VIEW_DEFS 漏一个 seeded 视图 → 抛
    const missingOneDef = Object.fromEntries(BUILTIN_VIEWS.filter((v) => v.key !== "global-sim").map((v) => [v.key, {}]));
    expect(() =>
      assertViewManifestIntegrity({ viewFeatureMap: VIEW_FEATURE_MAP, viewDefs: missingOneDef, registeredFeatureKeys: new Set(ALL_FEATURE_KEYS) }),
    ).toThrow(/global-sim/);
    // 有牙：featureKey 未注册 → 抛
    expect(() =>
      assertViewManifestIntegrity({ viewFeatureMap: VIEW_FEATURE_MAP, viewDefs: Object.fromEntries(BUILTIN_VIEWS.map((v) => [v.key, {}])), registeredFeatureKeys: new Set() }),
    ).toThrow(/未注册/);
  });

  it("D · cross_object_occupancy 内存态默认 InProc 兜底 → FEASIBLE/optimal:false（§4.5·诚实不冒充最优）", async () => {
    const t = await makeApp(); // makeApp 默认装 InProcOptimizerClient（app.ts·未配 OPTIMIZER_BASE_URL）
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    const out = await t.services.solvers.invoke(ctx, "cross_object_occupancy", {
      orders: [
        { id: "O_hi", revenue: 100, penalty: 5, qty: 6, contractId: "K1" },
        { id: "O_pen", revenue: 60, penalty: 80, qty: 6, contractId: "K1" },
      ],
      lines: [{ id: "L1", capacity: 6 }],
      contracts: [{ id: "K1", cap: 100 }],
      eligibility: [{ order: "O_hi", line: "L1", cost: 1 }, { order: "O_pen", line: "L1", cost: 1 }],
    });
    expect(out.status).toBe("FEASIBLE");
    expect(out.optimal).toBe(false);
    // 单线容量 6·两单各 qty6 → 仅一单获排、一单被挤（共享容量守恒·不重复占用）
    expect(out.servedCount).toBe(1);
    expect((out.displaced as string[]).length).toBe(1);
    // 确定性 R6：同输入双跑字节一致
    const again = await t.services.solvers.invoke(ctx, "cross_object_occupancy", {
      orders: [
        { id: "O_hi", revenue: 100, penalty: 5, qty: 6, contractId: "K1" },
        { id: "O_pen", revenue: 60, penalty: 80, qty: 6, contractId: "K1" },
      ],
      lines: [{ id: "L1", capacity: 6 }],
      contracts: [{ id: "K1", cap: 100 }],
      eligibility: [{ order: "O_hi", line: "L1", cost: 1 }, { order: "O_pen", line: "L1", cost: 1 }],
    });
    expect(again).toEqual(out);
  });
});
