import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { invokeSolver, makeApp, seedBattery } from "./helpers.js";

/**
 * 临时取证探针（**不进正线**）：按 `action-adopt-mitigation.seam.test.ts` 的
 * 「归属取证」协议落盘 stripped payload，供在 canonical / 本分支 两侧各跑一次再 diff。
 * 出参路径由 env `DUMP_OUT` 给。
 */
const ADDITIVE_KEYS = [
  "otdBatch", "otd", "exposure", "doNothing", "exposureOrder", "options", "leadTime",
  "scope", "scopeBaseId", "scopeBaseName", "scopeNote",
];
const stripAdditive = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(stripAdditive);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (ADDITIVE_KEYS.includes(k)) continue;
    out[k] = stripAdditive(v);
  }
  return out;
};

describe("DUMP", () => {
  it("dump stripped risk_timeline payload", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "risk_timeline", {});
    const data = (res.json() as { data: unknown }).data;
    const { ruleSetVersion: _rsv, ...numeric } = data as Record<string, unknown>;
    const stripped = stripAdditive(JSON.parse(JSON.stringify(numeric)));
    const json = JSON.stringify(stripped);
    const out = process.env.DUMP_OUT ?? "/tmp/dump.json";
    writeFileSync(out, JSON.stringify(stripped, null, 1));
    // eslint-disable-next-line no-console
    console.log("[DUMP] out=%s len=%d sha=%s", out, json.length,
      createHash("sha256").update(json).digest("hex"));
    expect(json.length).toBeGreaterThan(0);
  }, 300000);
});
