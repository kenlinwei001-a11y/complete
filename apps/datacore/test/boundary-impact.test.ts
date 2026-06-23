import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { BOUNDARY_IMPACT, BASE_REGISTRY, SEG_REGISTRY } from "@platform/contracts";

/**
 * DF.7 边界影响图（PRD 生成接地层 · 单一来源+影响图）：把"改某条边界册波及谁"显式登记，
 * 回答铁律0「改 X 影响什么」。本测试是**防漂哨兵**——逐条复核 BOUNDARY_IMPACT.consumers
 * 在源文件里确实从册派生（与 boundary-singlesource 门同口径），且 members 派生自册长。
 * 跑在 build 后（有 TS/contracts），与门互补：门扫文件、影响图登记爆炸半径、本测试保证二者不脱节。
 */
const repoFile = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");

describe("DF.7 · 边界影响图（boundary impact）", () => {
  it("members 派生自册长（改册自动同步，非写死）", () => {
    const base = BOUNDARY_IMPACT.find((b) => b.registry === "BASE_REGISTRY")!;
    const seg = BOUNDARY_IMPACT.find((b) => b.registry === "SEG_REGISTRY")!;
    expect(base.members).toBe(BASE_REGISTRY.length);
    expect(seg.members).toBe(SEG_REGISTRY.length);
  });

  it("每条 consumer 在源文件里确实从册派生（与 boundary-singlesource 门同口径，防影响图漂移）", () => {
    for (const b of BOUNDARY_IMPACT) {
      for (const c of b.consumers) {
        const src = repoFile(c.file);
        // 派生方式 token 出现（如 BASE_REGISTRY.map / SEG_REGISTRY）
        expect(src.includes(c.derivesVia), `${c.file} 应含派生 token ${c.derivesVia}`).toBe(true);
        // 确实引用该册 + 从 contracts 来
        expect(src.includes(b.registry), `${c.file} 应引用 ${b.registry}`).toBe(true);
        expect(/from "@platform\/contracts"/.test(src), `${c.file} 应从 @platform/contracts 导入`).toBe(true);
      }
    }
  });

  it("GET /a/v1/boundary/impact：返回两册影响 + ?registry 过滤", async () => {
    const t: TestApp = await makeApp();
    const all = await t.app.inject({ method: "GET", url: "/a/v1/boundary/impact", headers: ADMIN });
    expect(all.statusCode).toBe(200);
    const body = all.json() as { impact: { registry: string; members: number; consumers: unknown[] }[]; registries: string[] };
    expect(body.registries).toEqual(["BASE_REGISTRY", "SEG_REGISTRY"]);
    expect(body.impact.find((b) => b.registry === "BASE_REGISTRY")?.members).toBe(BASE_REGISTRY.length);

    const one = await t.app.inject({ method: "GET", url: "/a/v1/boundary/impact?registry=SEG_REGISTRY", headers: ADMIN });
    const ob = one.json() as { impact: { registry: string }[] };
    expect(ob.impact.length).toBe(1);
    expect(ob.impact[0]!.registry).toBe("SEG_REGISTRY");
  });
});
