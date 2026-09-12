import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";

/**
 * OC1 实体解析与黄金记录：扫描产候选 → 人审合并（golden 存活、被并不可见）→ unmerge 还原。
 */
async function countBases(t: TestApp): Promise<number> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Base&pageSize=500", headers: ADMIN });
  return (res.json() as { total: number }).total;
}
async function makeDupBase(t: TestApp, name: string): Promise<void> {
  // 直接经仓储造一个重名 Base（模拟双源同实体；对象真值写入无公开 create 端点，走 R4）
  await t.repos.objects.put({
    id: `obj_dup_${name}`, tenantId: "demo", type: "Base",
    props: { baseId: `dup_${name}`, name }, origin: { type: "MANUAL" },
  });
}

describe("OC1 · 实体解析与黄金记录", () => {
  it("重名对象 → 扫描产候选 → 合并(只见 golden) → unmerge 还原", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 取一个现有 Base 的名称，造一个同名重复对象
    const first = (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Base&pageSize=1", headers: ADMIN }).then((r) => r.json())) as { items: { props: Record<string, unknown> }[] };
    const dupName = String(first.items[0]!.props.name);
    const before = await countBases(t);
    await makeDupBase(t, dupName);
    expect(await countBases(t)).toBe(before + 1);

    // 扫描 → 候选（含该重名组）
    const scan = await t.app.inject({ method: "POST", url: "/a/v1/objects/merge-scan", headers: ADMIN, payload: { typeKey: "Base" } });
    expect(scan.statusCode).toBe(200);
    const cands = (await t.app.inject({ method: "GET", url: "/a/v1/objects/merge-candidates", headers: ADMIN }).then((r) => r.json())) as { id: string; objectIds: string[]; objects: unknown[] }[];
    const cand = cands.find((c) => c.objects.length >= 2);
    expect(cand).toBeDefined();

    // 合并 → 被并对象不再出现（只见 golden）
    const merge = await t.app.inject({ method: "POST", url: `/a/v1/objects/merge-candidates/${cand!.id}/merge`, headers: ADMIN, payload: {} });
    expect(merge.statusCode).toBe(200);
    const mergeRec = merge.json() as { id: string; goldenId: string; mergedIds: string[] };
    expect(await countBases(t)).toBe(before); // 回到合并前（重复被并入）

    // unmerge → 还原
    const un = await t.app.inject({ method: "POST", url: `/a/v1/objects/merges/${mergeRec.id}/unmerge`, headers: ADMIN, payload: {} });
    expect(un.statusCode).toBe(200);
    expect(await countBases(t)).toBe(before + 1); // 还原
  });

  it("跨租户隔离：别租户看不到本租户候选", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/objects/merge-candidates", headers: { "x-debug-user": "other:u1:admin" } });
    expect(res.json()).toEqual([]);
  });
});
