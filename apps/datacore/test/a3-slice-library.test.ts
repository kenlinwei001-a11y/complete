import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { deriveSliceLibrary, type LibType, type LibLink } from "../src/ontology/slice-library.js";

const TYPES: LibType[] = [
  { key: "Order", domain: "sales" },
  { key: "Customer", domain: "sales" },
  { key: "Model", domain: "product" },
  { key: "Base", domain: "factory" },
  { key: "Process", domain: "factory" },
];
const LINKS: LibLink[] = [
  { linkKey: "placed_by", fromTypeKey: "Order", toTypeKey: "Customer" }, // 域内 sales
  { linkKey: "has_model", fromTypeKey: "Order", toTypeKey: "Model" }, // 跨域 sales→product
  { linkKey: "made_at", fromTypeKey: "Model", toTypeKey: "Base" }, // 跨域 product→factory
  { linkKey: "runs", fromTypeKey: "Base", toTypeKey: "Process" }, // 域内 factory
];

describe("A3.2 · 域内/跨域两库派生（确定性 R6）", () => {
  it("域内库 biz.<域>.<root>：每域 root 的同域子图；无同域边的域跳过", () => {
    const { intra } = deriveSliceLibrary(TYPES, LINKS);
    const keys = intra.map((e) => e.sliceKey);
    // sales 有 Order-Customer 同域边；factory 有 Base-Process 同域边；product 仅 1 类型无同域边 → 跳过
    expect(keys).toContain("biz.sales.customer"); // root=Customer(字典序首)
    expect(keys).toContain("biz.factory.base");
    expect(keys.some((k) => k.startsWith("biz.product"))).toBe(false);
    const sales = intra.find((e) => e.sliceKey === "biz.sales.customer")!;
    expect(sales.scope).toBe("intra");
    expect(sales.spannedDomains).toEqual(["sales"]);
    expect(sales.spannedTypes).toEqual(["Customer", "Order"]);
  });

  it("跨域库 biz.x.<from>_to_<to>：每跨域接缝一张单跳切片", () => {
    const { cross } = deriveSliceLibrary(TYPES, LINKS);
    const keys = cross.map((e) => e.sliceKey);
    expect(keys).toEqual(["biz.x.model_to_base", "biz.x.order_to_model"]); // 排序，仅跨域边
    const seam = cross.find((e) => e.sliceKey === "biz.x.order_to_model")!;
    expect(seam.scope).toBe("cross");
    expect(seam.spannedDomains).toEqual(["product", "sales"]);
    expect(seam.paths).toEqual([[{ linkKey: "has_model", direction: "out" }]]);
  });

  it("R6 确定性：同图同结果字节一致", () => {
    expect(JSON.stringify(deriveSliceLibrary(TYPES, LINKS))).toBe(JSON.stringify(deriveSliceLibrary(TYPES, LINKS)));
  });
});

describe("A3.2 · 两库端点（真服务）", () => {
  it("GET /slices/library?scope=cross|intra|all + POST build 登记为一等切片（进索引）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const all = (await t.app.inject({ method: "GET", url: "/a/v1/slices/library", headers: ADMIN })).json() as { intra: unknown[]; cross: unknown[] };
    expect(Array.isArray(all.intra)).toBe(true);
    expect(Array.isArray(all.cross)).toBe(true);
    const crossOnly = (await t.app.inject({ method: "GET", url: "/a/v1/slices/library?scope=cross", headers: ADMIN })).json() as { cross: unknown[]; intra?: unknown };
    expect(crossOnly.cross).toBeDefined();
    expect(crossOnly.intra).toBeUndefined();
    // 登记两库 → 进 A3.4 索引
    const built = (await t.app.inject({ method: "POST", url: "/a/v1/slices/library/build", headers: ADMIN })).json() as { registered: { sliceKey: string }[]; cross: number; intra: number };
    const idx = (await t.app.inject({ method: "GET", url: "/a/v1/slices/index", headers: ADMIN })).json() as { entries: { sliceKey: string }[] };
    if (built.registered.length > 0) {
      expect(idx.entries.some((e) => e.sliceKey === built.registered[0]!.sliceKey)).toBe(true); // 登记的库切片进了索引
    }

    // WO-SLICE-CONSUMPTION-20260912（AC2/AC3）：重跑幂等 = version+1、不报错、不复制。
    // （2026-09-12 实测旧实现恒写 v1，与 AC2 不符；本断言钉住「版本随登记次数递增」。）
    const key0 = built.registered[0]!.sliceKey;
    const specAfter1 = (await t.app.inject({ method: "GET", url: `/a/v1/ontology/slices/${encodeURIComponent(key0)}`, headers: ADMIN })).json() as { version: number };
    expect(specAfter1.version).toBe(1); // 首登 v1
    const listAfter1 = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices", headers: ADMIN })).json() as { sliceKey: string }[];
    const rebuilt = await t.app.inject({ method: "POST", url: "/a/v1/slices/library/build", headers: ADMIN });
    expect(rebuilt.statusCode).toBe(201); // 不报错
    const rebuiltBody = rebuilt.json() as { registered: { sliceKey: string }[]; intra: number; cross: number };
    expect(rebuiltBody.registered.length).toBe(built.registered.length); // 计数口径不变
    const specAfter2 = (await t.app.inject({ method: "GET", url: `/a/v1/ontology/slices/${encodeURIComponent(key0)}`, headers: ADMIN })).json() as { version: number };
    expect(specAfter2.version).toBe(2); // version+1
    const listAfter2 = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices", headers: ADMIN })).json() as { sliceKey: string }[];
    expect(listAfter2.length).toBe(listAfter1.length); // 不复制
    expect(listAfter2.filter((s) => s.sliceKey === key0).length).toBe(1);
  });
});
