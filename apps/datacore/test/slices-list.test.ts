import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";

/** GET /a/v1/ontology/slices：切片清单（管理面列表源；本次新增端点）。 */
describe("本体切片清单端点", () => {
  it("PUT 注册切片 → GET 列出（rootType/hops/fixtures）+ tenant 隔离", async () => {
    const t = await makeApp();
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/ontology/slices/test_slice",
      headers: ADMIN,
      payload: {
        version: 1,
        spec: {
          root: { typeKey: "Base", selector: {} },
          paths: [[{ linkKey: "HAS_ORDER", direction: "out" }]],
          maxNodes: 50,
        },
      },
    });
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { sliceKey: string; rootType: string; hops: number }[];
    const mine = list.find((s) => s.sliceKey === "test_slice");
    expect(mine).toBeDefined();
    expect(mine!.rootType).toBe("Base");
    expect(mine!.hops).toBe(1);

    // 跨租户隔离：别租户看不到
    const other = await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices", headers: { "x-debug-user": "other:u1:admin" } });
    expect((other.json() as unknown[]).some((s) => (s as { sliceKey: string }).sliceKey === "test_slice")).toBe(false);
  });
});
