/** G1 临时取证探针（跑完即删）：把真种子上的真实输出打出来，供 PRD §9 A5「亲手真跑」逐条核。 */
import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

const P = (label: string, v: unknown) => console.log(`\n===== ${label} =====\n${JSON.stringify(v, null, 1)}`);

describe("G1 probe", () => {
  it("dump", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);

    const scan = (await invokeSolver(t, "chain_impediments", {})).json().data as Record<string, unknown>;
    P("chain_impediments · counts", scan.counts);
    P("chain_impediments · thresholds", scan.thresholds);
    P("chain_impediments · unresolved", scan.unresolved);
    P("chain_impediments · caveats", scan.caveats);
    P("chain_impediments · top8", (scan.impediments as unknown[]).slice(0, 8));
    P("chain_impediments · scopeUnscoped", scan.scopeUnscoped);

    const loss = (await invokeSolver(t, "chain_loss_attribution", {})).json().data as Record<string, unknown>;
    P("chain_loss · totals", loss.totals);
    P("chain_loss · conservation", loss.conservation);
    P("chain_loss · attribution", loss.attribution);
    P("chain_loss · empty", loss.empty);
    P("chain_loss · nodeIds", (loss.nodes as { nodeId: string; steps: { stepId: string; kind: string; days: number }[] }[]).map((n) => ({ n: n.nodeId, s: n.steps.map((s) => `${s.stepId}:${s.kind}:${s.days}`) })));

    const ao = (await invokeSolver(t, "affected_orders", {})).json().data as Record<string, unknown>;
    P("affected_orders · keys", Object.keys(ao));
    P("affected_orders · count/total/fallback", { count: ao.count, total: ao.total, fallback: ao.fallback, baseId: ao.baseId, scope: ao.scope });
    P("affected_orders · first3", (ao.affected as unknown[])?.slice(0, 3));

    const cad = await t.repos.objects.listByType("demo", "Cadence");
    P("Cadence rows", cad.map((c) => c.props));

    const bases = await t.repos.objects.listByType("demo", "Base");
    P("Base ids", bases.slice(0, 3).map((b) => ({ id: b.id, baseId: b.props.baseId, name: b.props.name })));

    const scoped = (await invokeSolver(t, "chain_impediments", { scope: { baseIds: [String(bases[0]!.props.baseId ?? bases[0]!.props.name)] } })).json().data as Record<string, unknown>;
    P("chain_impediments scoped(base0) counts", { counts: scoped.counts, scope: scoped.scope, scopeUnscoped: scoped.scopeUnscoped });

    const c05 = (await t.repos.rules.list("demo", (r) => r.key === "C05"))[0];
    P("rule C05", c05);
    expect(true).toBe(true);
  }, 300_000);
});
