import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { boundaryVersion, BOUNDARY_SEMVER } from "@platform/contracts";

/**
 * DF.10 边界册版本化（GenerationBoundary · 改值留痕 + 缓存失效锚）：
 * semver + 各册内容指纹（djb2，R6 同内容同 digest）；改业务常数→digest 变，可审计/失效检测。
 */
describe("DF.10 · 边界册版本化（boundary version）", () => {
  it("boundaryVersion：semver + 三册指纹 + 全册合并 digest，确定性（R6）", () => {
    const v = boundaryVersion();
    expect(v.semver).toBe(BOUNDARY_SEMVER);
    expect(v.registries.map((r) => r.registry)).toEqual(["BASE_REGISTRY", "SEG_REGISTRY", "PLAN_GOAL_TARGETS"]);
    // 每册 digest 为 8 位十六进制
    for (const r of v.registries) {
      expect(r.digest).toMatch(/^[0-9a-f]{8}$/);
      expect(r.members).toBeGreaterThan(0);
    }
    expect(v.digest).toMatch(/^[0-9a-f]{8}$/);
    // 确定性：两次调用字节一致
    expect(boundaryVersion()).toEqual(v);
  });

  it("digest 反映内容：改值→指纹变（djb2 对不同输入不同）", () => {
    // 直接验证 hash 函数语义：不同字符串不同 digest（通过两个已知不同的册指纹对比）
    const v = boundaryVersion();
    const base = v.registries.find((r) => r.registry === "BASE_REGISTRY")!.digest;
    const seg = v.registries.find((r) => r.registry === "SEG_REGISTRY")!.digest;
    expect(base).not.toBe(seg); // 不同册内容 → 不同指纹
    // 全册合并 digest 不等于任一单册（合并语义）
    expect(v.digest).not.toBe(base);
  });

  it("GET /a/v1/boundary/version：返回 semver + registries + digest", async () => {
    const t: TestApp = await makeApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/boundary/version", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { semver: string; digest: string; registries: { registry: string }[] };
    expect(body.semver).toBe(BOUNDARY_SEMVER);
    expect(body.registries).toHaveLength(3);
    expect(body.digest).toMatch(/^[0-9a-f]{8}$/);
  });
});
