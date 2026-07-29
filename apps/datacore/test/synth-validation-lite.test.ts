import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { Repos } from "../src/repo/repo.js";

// WO-SYNTH-VALIDATION-LITE · SEAM 守门（头号判据·防假绿）。
// 地基：TS 历史（genPoint）是 (seed,entity,day) 纯函数、不消耗对象 RNG 游标；VLE 幂等指纹只覆盖对象。
// ⇒ VALIDATION_LITE（跳 TS）与 FULL 的对象字节完全一致——本套五条为该安全性地基的接缝驱动守护。

const ctxFor = (tenant: string): AuthCtx => ({ tenantId: tenant, userId: "vle", roles: ["admin"], attributes: {} });

/** 对象集合稳定指纹（与 vle.ts fingerprint 同算法：按 id 排序的 type+props 串 → 31 进制哈希）。 */
async function fingerprint(repos: Repos, tenant: string): Promise<string> {
  const objs = (await repos.objects.list(tenant)).sort((x, y) => (x.id < y.id ? -1 : 1));
  const canon = objs.map((o) => `${o.id}|${o.type}|${JSON.stringify(o.props, Object.keys(o.props).sort())}`).join("\n");
  let h = 0;
  for (let i = 0; i < canon.length; i++) h = (Math.imul(31, h) + canon.charCodeAt(i)) | 0;
  return `${objs.length}:${h >>> 0}`;
}

const battery = (extra: Record<string, unknown> = {}) => ({ industry: "battery-manufacturing" as const, scale: "S" as const, seed: 42, ...extra });

/**
 * FULL 与 LITE 之间**唯一**允许的差异面：TS 聚合物化目标属性（`tsAggSpecs[].output`）
 * 及其传递派生/溯源。这些属性在 FULL 由 90 天历史聚合覆盖，在 LITE 保留合成期基线值——
 * 这是"跳 TS"的确切代价面。生成图其余部分逐字节一致。
 * ⚠ geobase 声称的"LITE 对象指纹===FULL 对象指纹（全字节一致）"经 SEAM 门实测为**假**
 *   （A4 派生管线把 TS 聚合折叠进对象属性，1573/11082 对象在这 7 个键上不同）；
 *   已在本体 §A7 回写更正。校验效力零损在**套件级**成立：TS 派生属性的确定性仍由
 *   synthetic.test.ts SY1（FULL 逐字节重跑）覆盖，本单只把 VLE determinismCheck 移到 LITE。
 * 来源：battery.ts tsAggSpecs output 目标（oee_current/yield_baseline/actual_output_daily/
 *   schedule_attainment）+ Line.utilization（下游）+ Base.oeeIndex（AVG(oee_current)）+ __prov（溯源）。
 */
const TS_DERIVED_KEYS = new Set([
  "oee_current", "yield_baseline", "actual_output_daily",
  "schedule_attainment", "utilization", "oeeIndex", "__prov",
]);

/** 生成图指纹：剥离 TS 聚合物化目标属性后的对象字节指纹（LITE 与 FULL 在此面必须一致）。 */
async function genFingerprint(repos: Repos, tenant: string): Promise<string> {
  const objs = (await repos.objects.list(tenant)).sort((x, y) => (x.id < y.id ? -1 : 1));
  const canon = objs
    .map((o) => {
      const stripped: Record<string, unknown> = {};
      for (const k of Object.keys(o.props).sort()) if (!TS_DERIVED_KEYS.has(k)) stripped[k] = o.props[k];
      return `${o.id}|${o.type}|${JSON.stringify(stripped)}`;
    })
    .join("\n");
  let h = 0;
  for (let i = 0; i < canon.length; i++) h = (Math.imul(31, h) + canon.charCodeAt(i)) | 0;
  return `${objs.length}:${h >>> 0}`;
}

describe("WO-SYNTH-VALIDATION-LITE · SEAM 五条", { timeout: 180000 }, () => {
  it("#1 核心：FULL 与 LITE 生成图逐字节一致，差异**仅限** TS 聚合物化属性；LITE 无 TS、FULL 有 TS（真跳）", async () => {
    const t = await makeApp({ seed: false });
    await t.services.synthetic.runJob(ctxFor("t_full"), battery());
    await t.services.synthetic.runJob(ctxFor("t_lite"), battery({ profile: "VALIDATION_LITE" }));

    const F = (await t.repos.objects.list("t_full")).sort((a, b) => (a.id < b.id ? -1 : 1));
    const L = (await t.repos.objects.list("t_lite")).sort((a, b) => (a.id < b.id ? -1 : 1));

    // (a) 对象计数 + (id,type) 序列逐条一致（生成骨架零位移）。
    expect(L).toHaveLength(F.length);
    for (let i = 0; i < F.length; i++) {
      expect(`${L[i]!.id}|${L[i]!.type}`).toBe(`${F[i]!.id}|${F[i]!.type}`);
    }

    // (b) 剥离 TS 聚合物化属性后，生成图指纹逐字节一致（"跳 TS"不扰动生成路径）。
    expect(await genFingerprint(t.repos, "t_lite")).toBe(await genFingerprint(t.repos, "t_full"));

    // (c) 任何对象的差异键**必须**是 TS 派生集的子集——若未来有属性变得 TS 依赖，此断言即红（防面漂移）。
    for (let i = 0; i < F.length; i++) {
      const keys = new Set([...Object.keys(F[i]!.props), ...Object.keys(L[i]!.props)]);
      for (const k of keys) {
        if (JSON.stringify(F[i]!.props[k]) !== JSON.stringify(L[i]!.props[k])) {
          expect(TS_DERIVED_KEYS.has(k), `unexpected non-TS divergence on ${F[i]!.type}.${k}`).toBe(true);
        }
      }
    }

    // (d) 真跳非假跳：LITE 无任何 TS 点；FULL 有 TS 点（大头确实被省掉）。
    expect(await t.repos.tsPoints.count("t_lite")).toBe(0);
    expect(await t.repos.tsPoints.count("t_full")).toBeGreaterThan(0);
  });

  it("#2 LITE 明显更快（宽松阈值·证真省大头非空跑）", async () => {
    const t = await makeApp({ seed: false });
    const f0 = Date.now();
    await t.services.synthetic.runJob(ctxFor("t_full2"), battery());
    const fullMs = Date.now() - f0;
    const l0 = Date.now();
    await t.services.synthetic.runJob(ctxFor("t_lite2"), battery({ profile: "VALIDATION_LITE" }));
    const liteMs = Date.now() - l0;
     
    console.log(`[SEAM#2] FULL=${fullMs}ms LITE=${liteMs}ms ratio=${(liteMs / fullMs).toFixed(3)}`);
    expect(liteMs).toBeLessThan(fullMs); // 严格更快（LITE 做严格更少的工作）
    expect(liteMs).toBeLessThan(fullMs * 0.7); // 宽松半阈：省下 TS 历史+聚合大头
  });

  it("#3 反陷阱：determinismCheck 仍两次独立真跑（探针计 LITE runJob==2 且两个不同 tenantId）", async () => {
    const t = await makeApp();
    const orig = t.services.synthetic.runJob.bind(t.services.synthetic);
    const liteCalls: string[] = [];
    // 探针：拦截 runJob，记录 VALIDATION_LITE 调用的 tenantId（不改行为，透传原实现）。
    (t.services.synthetic as unknown as { runJob: typeof orig }).runJob = async (ctx, input) => {
      if (input.profile === "VALIDATION_LITE") liteCalls.push(ctx.tenantId);
      return orig(ctx, input);
    };
    await t.services.vle.run(t.adminCtx, "SMOKE", 42);
    // determinismCheck 必须产生恰好 2 次 LITE runJob，且落在两个不同租户（独立真跑，非"1 次+克隆自比"）。
    expect(liteCalls.length).toBe(2);
    expect(new Set(liteCalls).size).toBe(2);
  });

  it("#4 cloneTenant 字节一致：fingerprint(clone(x)) === fingerprint(x)", async () => {
    const t = await makeApp({ seed: false });
    await t.services.synthetic.runJob(ctxFor("t_src"), battery());
    const fpSrc = await fingerprint(t.repos, "t_src");
    await t.services.synthetic.cloneTenant("t_src", "t_dst");
    const fpDst = await fingerprint(t.repos, "t_dst");
    expect(fpDst).toBe(fpSrc);
    // TS 也随克隆搬运（非指纹范畴，但 demo 重置/CI baseline 需要）。
    const srcTs = await t.repos.tsPoints.count("t_src");
    const dstTs = await t.repos.tsPoints.count("t_dst");
    expect(dstTs).toBe(srcTs);
  });

  it("#5 R6 不破：LITE 同 seed 两跑对象指纹一致（确定性不受跳 TS 影响）", async () => {
    const t = await makeApp({ seed: false });
    await t.services.synthetic.runJob(ctxFor("t_r6a"), battery({ profile: "VALIDATION_LITE" }));
    await t.services.synthetic.runJob(ctxFor("t_r6b"), battery({ profile: "VALIDATION_LITE" }));
    expect(await fingerprint(t.repos, "t_r6b")).toBe(await fingerprint(t.repos, "t_r6a"));
  });
});
