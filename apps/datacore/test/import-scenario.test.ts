import { describe, it, expect } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-IMPORT-SCENARIO (G3) · 场景导入（Stage 3.15 场景 JSON → 平台场景卡·PRD-enterprise-dataset-import §3.3）。
 *
 * ⛔ R14：平台不含 Stage 3.15 业务语义（type→求解器不写死）——answer 声明式 query 由调用方给·缺省 objects 直列。
 * 诚实边界（KILL-MOCK-RED）：objectRefs 对真对象库解析·对不上 → MISSING_OBJECT（不造幽灵引用）；
 * 既无 answer 又无 objectRefs → MISSING_ANSWER（该场景不落库）。落库经 /a/v1/scenarios/pack seam 供 AgentCore 启动器消费。
 *
 * demo/battery 租户模板 features=[...ALL_FEATURE_KEYS]（全开）→ 暗发门须用**新非电池租户**验（无模板 → defaultOn:false）。
 */

const FRESH_OFF = { "x-debug-user": "scoff:u:admin|catalog_admin" };

/** demo 种子里一个真实 Equipment 对象的业务 id（objectRef 解析用·需先 seedBattery 物化）。 */
async function realEquipId(t: TestApp): Promise<string> {
  const objs = (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Equipment&limit=1", headers: ADMIN })).json() as { items: { id: string; props: Record<string, unknown> }[] };
  const o = objs.items[0]!;
  return String(o.props.equipId ?? o.id.replace(/^obj_equipment_/, ""));
}

const importScenarios = (t: TestApp, scenarios: unknown[], headers = ADMIN) => t.app.inject({ method: "POST", url: "/a/v1/scenarios/import", headers, payload: { scenarios } });

describe("WO-IMPORT-SCENARIO (G3) · 场景导入", () => {
  it("暗发门（R3）：新租户 feature 关 → /scenarios/import & /scenarios/imported 返回 404", async () => {
    const t = await makeApp();
    const imp = await importScenarios(t, [{ title: "x", answer: { kind: "objects", objectType: "Order" } }], FRESH_OFF);
    expect(imp.statusCode).toBe(404);
    expect((imp.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
    const list = await t.app.inject({ method: "GET", url: "/a/v1/scenarios/imported", headers: FRESH_OFF });
    expect(list.statusCode).toBe(404);
  });

  it("导入声明式 answer 场景 → 落库·/imported 可查·经 /scenarios/pack seam 合入场景包", async () => {
    const t = await makeApp();
    const res = await importScenarios(t, [{ type: "ORDER_ACCEPTANCE", title: "接单可行性", question: "这批订单能否按期接?", answer: { kind: "objects", objectType: "Order", limit: 10 } }]);
    expect(res.statusCode).toBe(201);
    const d = res.json() as { imported: { key: string; answerKind: string; answerDeclared: boolean }[]; gaps: unknown[] };
    expect(d.gaps).toEqual([]);
    expect(d.imported).toHaveLength(1);
    expect(d.imported[0]!.answerDeclared).toBe(true);
    const list = (await t.app.inject({ method: "GET", url: "/a/v1/scenarios/imported", headers: ADMIN })).json() as { items: { scenarioKey: string }[] };
    expect(list.items.map((x) => x.scenarioKey)).toContain("接单可行性");
    // /scenarios/pack seam：导入场景出现在场景包（AgentCore 启动器据此消费）。
    const pack = (await t.app.inject({ method: "GET", url: "/a/v1/scenarios/pack", headers: ADMIN })).json() as { scenarios: { key: string; question: string; answer: { kind: string } }[] };
    const sc = pack.scenarios.find((s) => s.key === "接单可行性")!;
    expect(sc).toBeDefined();
    expect(sc.question).toBe("这批订单能否按期接?");
    expect(sc.answer.kind).toBe("objects");
  });

  it("诚实边界 green→red：objectRefs 对真对象库解析·真对象入 selectedObjects·幽灵对象 → MISSING_OBJECT", async () => {
    const t = await makeApp();
    await seedBattery(t); // 物化 demo 电池对象（Equipment 可解析）。
    const equipId = await realEquipId(t);
    const res = await importScenarios(t, [{ type: "EQUIPMENT_FAILURE", title: "设备故障", objectRefs: [{ objectType: "Equipment", objectId: equipId }, { objectType: "Equipment", objectId: "GHOST-999" }] }]);
    const d = res.json() as { imported: { resolvedObjects: { objectId: string }[]; answerKind: string; answerDeclared: boolean }[]; gaps: { kind: string; detail: string }[] };
    expect(d.imported[0]!.resolvedObjects.map((o) => o.objectId)).toEqual([equipId]);
    expect(d.gaps.some((g) => g.kind === "MISSING_OBJECT" && g.detail.includes("GHOST-999"))).toBe(true);
    // 未声明 answer + 有 objectRef → 缺省退化 objects 直列（诚实位 answerDeclared=false）。
    expect(d.imported[0]!.answerKind).toBe("objects");
    expect(d.imported[0]!.answerDeclared).toBe(false);
  });

  it("诚实边界：既无 answer 又无 objectRefs → MISSING_ANSWER·该场景不落库（不造答案）", async () => {
    const t = await makeApp();
    const res = await importScenarios(t, [{ type: "BROKEN", title: "无答案无引用" }]);
    const d = res.json() as { imported: unknown[]; gaps: { kind: string; scenarioKey: string }[] };
    expect(d.imported).toEqual([]);
    expect(d.gaps.some((g) => g.kind === "MISSING_ANSWER")).toBe(true);
    const list = (await t.app.inject({ method: "GET", url: "/a/v1/scenarios/imported", headers: ADMIN })).json() as { items: unknown[] };
    expect(list.items).toHaveLength(0);
  });

  it("R6 幂等：同 key 两次导入 → 覆盖不翻倍", async () => {
    const t = await makeApp();
    const s = [{ type: "ORDER_ACCEPTANCE", title: "接单", answer: { kind: "objects" as const, objectType: "Order" } }];
    await importScenarios(t, s);
    await importScenarios(t, s);
    const list = (await t.app.inject({ method: "GET", url: "/a/v1/scenarios/imported", headers: ADMIN })).json() as { items: { scenarioKey: string }[] };
    expect(list.items.filter((x) => x.scenarioKey === "接单")).toHaveLength(1);
  });
});
