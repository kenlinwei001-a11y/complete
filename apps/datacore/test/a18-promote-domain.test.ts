import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

/**
 * A18.4 整域晋升编排（用户裁决 ⑤：晋升整域 + 逐制品）：人工审核通过 PROVISIONAL 未审核域 →
 * 隔离命名空间数据整体迁入真租户（governed 可查）+ 翻转 domainTrustLevel + domain.promoted（幂等）。
 */
const SCRIPT = "常州基地产能紧张，影响订单交期与客户信用，请做风险推演";

describe("A18.4 · 整域晋升编排（L1）", () => {
  it("PROVISIONAL 域隔离物化 → promote → 数据迁入真租户(governed 可查) + 域翻转 GOVERNED + domain.promoted + 幂等", async () => {
    const t: TestApp = await makeApp();
    t.services.databuilder.setInferenceProbe(async () => ({ answer: "可答", answerable: true }));

    // 建一个 PROVISIONAL 未审核域（隔离物化到伪租户）
    const prov = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 7, buildMode: "PROVISIONAL", inference: true } })).json()) as {
      id: string; domainTrustLevel: string; provisionalNamespace?: string; buildPlan?: { objectTypes: { typeKey: string }[] };
    };
    expect(prov.domainTrustLevel).toBe("UNVERIFIED");
    const provNs = prov.provisionalNamespace!;
    expect(provNs).toMatch(/::prov::/);
    const t0 = prov.buildPlan?.objectTypes?.[0]?.typeKey;
    expect(t0).toBeTruthy();
    // 晋升前：隔离域有对象，governed 真租户 demo 看不到
    const provCount = (await t.repos.objects.listByType(provNs, t0!)).length;
    expect(provCount).toBeGreaterThan(0);
    expect((await t.repos.objects.listByType("demo", t0!)).length).toBe(0);

    // 整域晋升
    const promoted = (await (await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${prov.id}/promote`, headers: ADMIN })).json()) as {
      domainTrustLevel: string; domainPromotion?: { promotedBy: string; fromNamespace: string; migratedObjects: number; migratedDatasets: number; migratedTypes: number; promotedSolvers: string[] };
    };
    expect(promoted.domainTrustLevel).toBe("GOVERNED");
    expect(promoted.domainPromotion?.fromNamespace).toBe(provNs);
    expect(promoted.domainPromotion?.migratedObjects).toBeGreaterThan(0);
    expect(promoted.domainPromotion?.migratedDatasets).toBeGreaterThan(0);

    // 晋升后：对象迁入真租户 demo（governed 可查），计数与隔离域一致
    expect((await t.repos.objects.listByType("demo", t0!)).length).toBe(provCount);
    // 真租户能经 objects/query 查到（governed 真值库）
    const q = await t.app.inject({ method: "POST", url: "/a/v1/objects/query", headers: ADMIN, payload: { objectType: t0, filter: {}, limit: 5 } });
    const rows = q.json() as { rows?: unknown[]; data?: unknown[] };
    expect((rows.rows ?? rows.data ?? []).length).toBeGreaterThan(0);

    // 事件
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "domain.promoted");
    expect(events.some((e) => (e.payload as { runId?: string }).runId === prov.id)).toBe(true);

    // 幂等：再 promote → 仍 GOVERNED（不报错、不重复迁移）
    const again = await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${prov.id}/promote`, headers: ADMIN });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { domainTrustLevel: string }).domainTrustLevel).toBe("GOVERNED");
  });

  it("STRICT 域不可整域晋升（400）", async () => {
    const t: TestApp = await makeApp();
    const strict = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 8 } })).json()) as { id: string; buildMode: string };
    expect(strict.buildMode).toBe("STRICT");
    const res = await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${strict.id}/promote`, headers: ADMIN });
    expect(res.statusCode).toBe(400);
  });
});
