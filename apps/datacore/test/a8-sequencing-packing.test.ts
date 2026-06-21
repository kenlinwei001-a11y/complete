import { describe, expect, it } from "vitest";
import { makeApp, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { OptimizerClient, OptimizationRequest, OptimizationResult, SequencingRequest, SequencingResult, PackingRequest, PackingResult } from "../src/solvers/optimizer-client.js";

const CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

class MockOpt implements OptimizerClient {
  seqReq?: SequencingRequest; packReq?: PackingRequest;
  constructor(private seq?: SequencingResult, private pack?: PackingResult) {}
  async solve(_r: OptimizationRequest): Promise<OptimizationResult> { throw new Error("nu"); }
  async solveSequencing(r: SequencingRequest): Promise<SequencingResult> { this.seqReq = r; return this.seq!; }
  async solvePacking(r: PackingRequest): Promise<PackingResult> { this.packReq = r; return this.pack!; }
}

async function seedJobs(t: TestApp) {
  await t.repos.ontologyTypes.put({ id: "ot_j", tenantId: "demo", key: "Job", displayName: "工单", domain: "plan", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "jid", dataType: "string", isPrimaryKey: true }, { propKey: "model", dataType: "string", isPrimaryKey: false }, { propKey: "size", dataType: "number", isPrimaryKey: false }] });
  await t.repos.objects.put({ id: "j_1", tenantId: "demo", type: "Job", props: { jid: "J1", model: "A", size: 6 } });
  await t.repos.objects.put({ id: "j_2", tenantId: "demo", type: "Job", props: { jid: "J2", model: "B", size: 4 } });
}

describe("A8.2/8.3 · sequencing/packing CP-SAT 代理接线", () => {
  it("sequencing_optimize：取 jobType→组 jobs(id,group)→映射 sequence/changeovers", async () => {
    const t = await makeApp(); await seedJobs(t);
    const mock = new MockOpt({ status: "OPTIMAL", optimal: true, sequence: ["J1", "J2"], changeovers: 1, objective: 1 });
    t.services.solvers.setOptimizer(mock);
    const out = await t.services.solvers.invoke(CTX, "sequencing_optimize", { jobType: "Job", groupField: "model" });
    expect(mock.seqReq!.model).toBe("sequencing");
    expect(mock.seqReq!.jobs).toEqual([{ id: "J1", group: "A" }, { id: "J2", group: "B" }]);
    expect(out.sequence).toEqual(["J1", "J2"]);
    expect(out.changeovers).toBe(1);
    expect(String(out.summary)).toContain("换型 1 次");
  });

  it("packing_optimize：取 itemType(size)→bin装箱→映射 bins/binCount", async () => {
    const t = await makeApp(); await seedJobs(t);
    const mock = new MockOpt(undefined, { status: "OPTIMAL", optimal: true, bins: [{ items: ["J1", "J2"], load: 10 }], binCount: 1, objective: 1 });
    t.services.solvers.setOptimizer(mock);
    const out = await t.services.solvers.invoke(CTX, "packing_optimize", { itemType: "Job", sizeField: "size", binCapacity: 10 });
    expect(mock.packReq!.binCapacity).toBe(10);
    expect(mock.packReq!.items).toEqual([{ id: "J1", size: 6 }, { id: "J2", size: 4 }]);
    expect(out.binCount).toBe(1);
    expect(String(out.summary)).toContain("装入 1 个箱");
  });

  it("未接入引擎 → 显式报错（两者）", async () => {
    const t = await makeApp(); await seedJobs(t);
    await expect(t.services.solvers.invoke(CTX, "sequencing_optimize", { jobType: "Job" })).rejects.toThrow(/未接入/);
    await expect(t.services.solvers.invoke(CTX, "packing_optimize", { itemType: "Job", binCapacity: 10 })).rejects.toThrow(/未接入/);
  });
});
