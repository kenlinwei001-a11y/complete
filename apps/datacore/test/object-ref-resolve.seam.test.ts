import { describe, expect, it } from "vitest";
import type { ObjectRefResolution } from "@platform/contracts";
import { makeApp, seedBattery, ADMIN, BASE_MANAGER, debugUser, type TestApp } from "./helpers.js";

/**
 * WO-SLOT-ENTITY-RESOLVE · A 侧「实体文本 → 对象引用」解析正门 SEAM（真种子数据 × 真 REST，非 mock）。
 *
 * 这是接缝的**数据半**：B 侧 `slots.ts` 把 objectRef 槽交给这条 REST 解析
 * （引擎半的门在 `apps/agentcore/test/slot-entity-resolve.seam.test.ts`）。
 *
 * 病根实测（改前，亲手复验过）：
 *   GET /a/v1/objects/Base/常州              → 404   ← 槽位填充走的就是这条，必然失败
 *   GET /a/v1/objects/Base/changzhou         → 200
 *   GET /a/v1/objects/Base/obj_base_changzhou→ 200
 * 「常州」是 `Base.name`、「整车厂A」是 `Customer.custName` —— 按 id/主键查当然查不到。
 *
 * 单一出处纪律：本端点与 `getObject` 共用 contracts `matchObjectRefInType` 一份实现，
 * 可识别属性完全从 ObjectTypeDef 元数据派生（**没有任何中文名→id 词表**，R14）。
 */

const resolve = async (t: TestApp, ref: unknown, opts: { types?: string[]; accept?: string[]; headers?: Record<string, string> } = {}): Promise<ObjectRefResolution> => {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/ontology/resolve-ref",
    headers: opts.headers ?? ADMIN,
    payload: { ref, ...(opts.types ? { types: opts.types } : {}), ...(opts.accept ? { accept: opts.accept } : {}) },
  });
  expect(res.statusCode, `resolve-ref 应 200（实得 ${res.statusCode} ${res.body.slice(0, 200)}）`).toBe(200);
  return JSON.parse(res.body) as ObjectRefResolution;
};

describe("WO-SLOT-ENTITY-RESOLVE · ① 头号：中文名/别名/主键/图节点 id 四形态归到同一对象（病根形态直测）", () => {
  it("Base「常州」四形态同一基地；`accept:[\"id\"]`（= 老 getObject 语义）中文名解析不到 —— 对照留成可复现的病根", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const forms = ["常州", "changzhou", "obj_base_changzhou", "obj_base_常州"];
    for (const ref of forms) {
      const r = await resolve(t, ref, { types: ["Base"] });
      expect(r.resolved, `「${ref}」应解析成功（这正是槽位填充要的能力）`).toBe(true);
      expect(r.objectType).toBe("Base");
      expect(r.objectId, `「${ref}」应归到 changzhou`).toBe("changzhou");
      expect(r.label).toBe("常州");
    }
    // matchedBy 可诊断：中文名走 name 层，拼音主键/图节点 id 走 id 层。
    expect((await resolve(t, "常州", { types: ["Base"] })).matchedBy).toBe("name");
    expect((await resolve(t, "changzhou", { types: ["Base"] })).matchedBy).toBe("id");
    expect((await resolve(t, "obj_base_changzhou", { types: ["Base"] })).matchedBy).toBe("id");

    // ★ 病根形态对照：只按 id/主键（老 getObject）→ 中文名解析不到；这正是 10/35 反问的来源。
    expect((await resolve(t, "常州", { types: ["Base"], accept: ["id"] })).resolved).toBe(false);
    expect((await resolve(t, "changzhou", { types: ["Base"], accept: ["id"] })).resolved).toBe(true);

    // 且老端点语义**不变**（本单不放宽 GET /objects/:type/:id）。
    const g1 = await t.app.inject({ method: "GET", url: `/a/v1/objects/Base/${encodeURIComponent("常州")}`, headers: ADMIN });
    const g2 = await t.app.inject({ method: "GET", url: `/a/v1/objects/Base/changzhou`, headers: ADMIN });
    const g3 = await t.app.inject({ method: "GET", url: `/a/v1/objects/Base/obj_base_changzhou`, headers: ADMIN });
    expect([g1.statusCode, g2.statusCode, g3.statusCode]).toEqual([404, 200, 200]);
  }, 180_000);
});

describe("WO-SLOT-ENTITY-RESOLVE · ② 多类型判据：不是只修基地（Model/Customer/Supplier/Order 同一支代码）", () => {
  it("四种非基地类型各自按主键/名称解析，且 matchedProp 指出真实命中属性（Customer 命中的是 custName，不是 name）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // Model：主键 modelId = 4680-NCM（id 层）；名称 name = 4680 三元圆柱（name 层）。
    const m1 = await resolve(t, "4680-NCM", { types: ["Model"] });
    expect([m1.resolved, m1.objectType, m1.objectId, m1.matchedBy]).toEqual([true, "Model", "4680-NCM", "id"]);
    const m2 = await resolve(t, "4680 三元圆柱", { types: ["Model"] });
    expect([m2.resolved, m2.objectId, m2.matchedBy, m2.matchedProp]).toEqual([true, "4680-NCM", "name", "name"]);

    // Customer：**没有 `name` 属性**，名称在 `custName` —— 只认 name/displayName 的实现在这里必挂。
    const c = await resolve(t, "整车厂A", { types: ["Customer"] });
    expect([c.resolved, c.objectType, c.matchedBy, c.matchedProp]).toEqual([true, "Customer", "name", "custName"]);
    expect(c.objectId).toBe("cust_0");

    // Supplier：名称 name = 容百科技（name 层）；主键 supplierId = SUP-001（id 层）。
    const s1 = await resolve(t, "容百科技", { types: ["Supplier"] });
    expect([s1.resolved, s1.objectId, s1.matchedBy]).toEqual([true, "SUP-001", "name"]);
    const s2 = await resolve(t, "SUP-001", { types: ["Supplier"] });
    expect([s2.resolved, s2.objectId, s2.matchedBy]).toEqual([true, "SUP-001", "id"]);

    // Order：主键 so。
    const o = await resolve(t, "SO-3391", { types: ["Order"] });
    expect([o.resolved, o.objectType, o.objectId, o.matchedBy]).toEqual([true, "Order", "SO-3391", "id"]);
  }, 180_000);
});

describe("WO-SLOT-ENTITY-RESOLVE · ③ 不给 types 也能解析（槽位未声明 refType 的路）", () => {
  it("全类型解析：常州→Base · 4680-NCM→Model · 容百科技→Supplier · 整车厂A→Customer（ARInvoice 同名 3 行不夺胜出）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const cases: [string, string, string][] = [
      ["常州", "Base", "changzhou"],
      ["4680-NCM", "Model", "4680-NCM"],
      ["容百科技", "Supplier", "SUP-001"],
      // 可辨析性筛：`ARInvoice.custName="整车厂A"` 有 3 行（该值在该类型里不标识对象）→ 不参与胜出；
      // `Customer.custName="整车厂A"` 恰 1 行 → 胜出。**结构性判据，不是"取第一个"**。
      ["整车厂A", "Customer", "cust_0"],
    ];
    for (const [ref, ty, id] of cases) {
      const r = await resolve(t, ref);
      expect(r.resolved, `「${ref}」全类型解析应成功`).toBe(true);
      expect([r.objectType, r.objectId], `「${ref}」`).toEqual([ty, id]);
    }
  }, 180_000);
});

describe("WO-SLOT-ENTITY-RESOLVE · ④ 诚实：解析不到 / 歧义 都不许静默兜底，且诊断齐全", () => {
  it("域外实体 → resolved:false + attempts（试了哪些类型/什么键/比对哪些属性/扫了几行/为什么不匹）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await resolve(t, "火星基地", { types: ["Base", "Model"] });
    expect(r.resolved).toBe(false);
    expect(r.ambiguous).toBeUndefined();
    const byType = Object.fromEntries((r.attempts ?? []).map((a) => [a.objectType, a]));
    expect(Object.keys(byType).sort()).toEqual(["Base", "Model"]);
    expect(byType.Base!.keysTried).toEqual(["火星基地"]);
    expect(byType.Base!.propsTried).toContain("name:name");
    expect(byType.Base!.propsTried).toContain("baseId:id");
    expect(byType.Base!.rowsScanned).toBeGreaterThan(0);
    expect(byType.Base!.reason).toBe("NO_MATCH");
    // 归一后的键也留痕（"我拿什么去查的"）。
    expect(r.normalizedRef).toBe("火星基地");
  }, 180_000);

  it("同层级多命中 → ambiguous + 候选（`Base.factory_code=CH01` 常州/成都各一 → 谁也不标识，诚实报）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await resolve(t, "CH01", { types: ["Base"] });
    expect(r.resolved).toBe(false);
    expect(r.ambiguous).toBe(true);
    expect((r.candidates ?? []).length).toBeGreaterThan(1);
    expect((r.candidates ?? []).every((c) => c.objectType === "Base" && c.matchedProp === "factory_code")).toBe(true);
  }, 180_000);
});

describe("WO-SLOT-ENTITY-RESOLVE · ⑤ 解析不绕过 A6 行级过滤（R2/R6：解析器不是越权后门）", () => {
  it("base_manager:常州 解析「厦门」→ 解析不到（行级过滤先于匹配）；解析「常州」→ 正常", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const mine = await resolve(t, "常州", { types: ["Base"], headers: BASE_MANAGER });
    expect(mine.resolved).toBe(true);
    expect(mine.objectId).toBe("changzhou");

    const other = await resolve(t, "厦门", { types: ["Base"], headers: BASE_MANAGER });
    expect(other.resolved, "越权基地不得被解析出来（否则解析器成了行级过滤的后门）").toBe(false);
    // admin 同一个键能解析出来 → 证明差异真的来自权限，不是数据本身没有。
    expect((await resolve(t, "厦门", { types: ["Base"] })).resolved).toBe(true);
  }, 180_000);

  it("跨租户不串（R2）：另一租户解析 demo 的基地 → 解析不到", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const other = await resolve(t, "常州", { types: ["Base"], headers: debugUser("other", "u", "admin") });
    expect(other.resolved).toBe(false);
  }, 180_000);
});
