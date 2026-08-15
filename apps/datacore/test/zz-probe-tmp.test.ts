import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";

const SCRIPT = "常州基地产能紧张，影响订单交期与客户信用，请做风险推演";

describe("PROBE 干跑回执实况", () => {
  it("dry-run 返回什么", async () => {
    const app = await makeApp();
    const res = await app.app.inject({
      method: "POST",
      url: "/a/v1/data-builders/run",
      headers: ADMIN,
      payload: { script: SCRIPT, seed: 42, dryRun: true, builderKey: "foundry-grade-data-builder" },
    });
    const job = res.json();
    console.log("STATUS", res.statusCode);
    console.log("GROUPS", job.needs.groups.length);
    for (const g of job.needs.groups) {
      console.log(
        `  ${g.kind}\tneeded=${g.needed}\tE=${g.existing} C=${g.toCreate} M=${g.missing} U=${g.unknown}\t${g.evidence}\t[${g.items.map((i: { key: string }) => i.key).join(",")}]`,
      );
    }
    console.log("TOTALS", JSON.stringify(job.needs.totals));
    console.log("UNPROBED", JSON.stringify(job.needs.unprobedKinds));
    expect(res.statusCode).toBeLessThan(500);
    await app.app.close();
  });
});
