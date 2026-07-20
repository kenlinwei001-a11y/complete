import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { datacoreResourceDescriptors, SOLVER_CATALOG, COCKPIT_SOLVER_CATALOG } from "../src/catalog.js";
import { findUndescribed, ResourceDescriptorSchema } from "@platform/contracts";

/**
 * WO-RESOURCE-DESCRIPTOR · SEAM 组合测（发现供给 × 描述纪律）：
 * discover(kind,query) 对黄金问句召回的每个资源条目都必须带非空 description（发布纪律推广到全池），
 * 且现有 keyword discover 基线不回归，且发现门对全池生效（造无描述资源 → findUndescribed 捕获·真闸）。
 */
describe("WO-RESOURCE-DESCRIPTOR · SEAM 发现门（discover 召回 × description 覆盖）", () => {
  // 黄金问句概念 → 命中关键词（substring keyword discover）。
  const golden: [string, string, string][] = [
    ["提前交付/换型", "换型", "changeover_sequence"],
    ["良率工序", "良率", "yield_diagnosis"],
    ["信用逾期", "信用", "credit_exposure"],
  ];

  it("黄金问句召回：每个 discover 命中的资源条目都带非空 description + keyword 基线不回归", async () => {
    const t = await makeApp();
    for (const [concept, kw, expectKey] of golden) {
      const res = await t.app.inject({ method: "GET", url: `/a/v1/catalog?kind=solvers&query=${encodeURIComponent(kw)}`, headers: ADMIN });
      expect(res.statusCode, concept).toBe(200);
      const { items } = res.json() as { items: { key: string; description: string }[] };
      // 基线：keyword 仍能召回预期求解器（不回归）。
      expect(items.map((i) => i.key), `${concept} 应召回 ${expectKey}`).toContain(expectKey);
      // SEAM 核心断言：每个召回条目都带非空 description。
      for (const it of items) {
        expect(it.description?.trim().length, `${concept} 召回的 ${it.key} 描述为空`).toBeGreaterThan(0);
      }
    }
  });

  it("发现门对全池生效：datacore 资源投影全绿；造无描述资源 → findUndescribed 捕获（真闸 green→red）", () => {
    const descriptors = datacoreResourceDescriptors();
    expect(descriptors.length).toBeGreaterThan(0);
    // 全池投影合法 + description 非空 → 无 violation（门绿）。
    for (const d of descriptors) expect(ResourceDescriptorSchema.safeParse(d).success, `${d.key} 投影非法`).toBe(true);
    expect(findUndescribed(descriptors)).toHaveLength(0);

    // 掺一个无描述求解器 → 门捕获（红）。
    const dirty = [...descriptors, { kind: "solver", key: "ghost", label: "幽灵" }];
    expect(findUndescribed(dirty)).toHaveLength(1);
  });

  it("无关键词 discover 全量基线不回归（求解器 37 · WO-B +base_capacity_outlook · 与 catalog.test 一致）", async () => {
    const t = await makeApp();
    const all = (await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=solvers", headers: ADMIN })).json() as { items: unknown[] };
    expect(all.items.length).toBe(SOLVER_CATALOG.length + COCKPIT_SOLVER_CATALOG.length);
  });
});
