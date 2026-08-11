import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";

const MODEL = "2170-NCM";
const PROD_ARGS = { grain: "process-model", targetType: "Base", targetProp: "weeklyCap", modelId: MODEL } as const;

async function levers(t: TestApp, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await invokeSolver(t, "generic_inference", { mode: "levers", ...args });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: Record<string, unknown> }).data;
}

describe("PROBE", () => {
  it("dump changeover lever state", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 1) ChangeoverMatrix 对象实际 props
    const q = await t.app.inject({
      method: "GET",
      url: "/a/v1/objects?type=ChangeoverMatrix&limit=3",
      headers: ADMIN,
    });
    console.log("[PROBE] ChangeoverMatrix query rc=", q.statusCode);
    console.log("[PROBE] ChangeoverMatrix rows=", JSON.stringify(q.json()).slice(0, 900));

    // 2) 换型损失 层杠杆
    const co = await levers(t, { ...PROD_ARGS, factors: ["换型损失"], topK: 8 });
    console.log("[PROBE] 换型损失 levers=", JSON.stringify(co));

    // 3) 不过滤：全部杠杆
    const all = await levers(t, { ...PROD_ARGS, topK: 30 });
    console.log("[PROBE] ALL levers props=", JSON.stringify((all.levers as { objectType: string; prop: string; sensitivity: number }[]).map((l) => `${l.objectType}.${l.prop}=${l.sensitivity}`)));
  }, 120000);
});
