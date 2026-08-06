import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";

/** 对抗性复验：独立复算 R6 金值（与被验方断言值比对）。 */
describe("ADVERSARY · R6 golden probe", () => {
  it("prints sha256 of risk_timeline({}) on this tree", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "risk_timeline", {});
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: unknown }).data;
    const json = JSON.stringify(data);
    // eslint-disable-next-line no-console
    console.log(`ADVERSARY_GOLDEN len=${json.length} sha256=${createHash("sha256").update(json).digest("hex")}`);
    expect(true).toBe(true);
  }, 300000);
});
