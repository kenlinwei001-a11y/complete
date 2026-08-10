import { describe, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN } from "./helpers.js";

describe("PROBE ③ kit_readiness base 维", () => {
  it("常州 vs 金华 vs 全网", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const pick = (r: { statusCode: number; body: string }) => {
      const j = JSON.parse(r.body);
      const d = j.data ?? j;
      return {
        st: r.statusCode,
        n: (d.rows ?? []).length,
        short: d.shortageCount,
        first: (d.rows ?? [])[0]?.orderId,
        ids: (d.rows ?? []).map((x: { orderId: string }) => x.orderId),
        scope: d.scope,
      };
    };
    const rAll = await invokeSolver(t, "kit_readiness", {}, ADMIN);
    const rCz = await invokeSolver(t, "kit_readiness", { base: "changzhou" }, ADMIN);
    const rJh = await invokeSolver(t, "kit_readiness", { base: "jinhua" }, ADMIN);
    const rCzId = await invokeSolver(t, "kit_readiness", { baseId: "常州" }, ADMIN);
    const rBad = await invokeSolver(t, "kit_readiness", { base: "火星基地" }, ADMIN);
    console.log("ALL          ", JSON.stringify(pick(rAll)));
    console.log("base=常州     ", JSON.stringify(pick(rCz)));
    console.log("base=金华     ", JSON.stringify(pick(rJh)));
    console.log("baseId=常州   ", JSON.stringify(pick(rCzId)));
    console.log("BYTE-EQ(cz,jh)=", rCz.body === rJh.body, "BYTE-EQ(cz,all)=", rCz.body === rAll.body, "BYTE-EQ(cz,czId)=", rCz.body === rCzId.body);
    console.log("bad base st=", rBad.statusCode, rBad.body.slice(0, 220));
  });
});
