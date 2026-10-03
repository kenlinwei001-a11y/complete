import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import type { CrossValidateResponse } from "@platform/contracts";

/**
 * 推演验证痕迹 Layer 2：结论断言 vs 知识图谱已有事实交叉验证。
 * 真值一致→CONSISTENT；与事实冲突→CONFLICT（附 kgValue）；无对象/无属性→NO_EVIDENCE。
 */
async function firstBase(t: TestApp): Promise<{ id: string; props: Record<string, unknown> }> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Base&pageSize=1", headers: ADMIN });
  const body = res.json() as { items: { id: string; props: Record<string, unknown> }[] };
  return body.items[0]!;
}

async function crossValidate(t: TestApp, claims: unknown[]): Promise<CrossValidateResponse> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/ontology/cross-validate",
    headers: ADMIN,
    payload: { claims },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as CrossValidateResponse;
}

describe("交叉验证 · 结论断言 vs 知识图谱事实", () => {
  it("一致/冲突/无证据 三态 + 聚合判定", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = await firstBase(t);
    const baseId = base.props.baseId as string;
    const trueUtil = base.props.util;

    // ① 真值一致 → CONSISTENT
    const ok = await crossValidate(t, [
      { kind: "PROPERTY", subjectType: "Base", subjectId: baseId, property: "util", assertedValue: trueUtil },
    ]);
    expect(ok.verdict).toBe("ALL_CONSISTENT");
    expect(ok.claims[0]!.status).toBe("CONSISTENT");

    // ② 与事实冲突 → CONFLICT（附知识图谱真实值）
    const conflict = await crossValidate(t, [
      { kind: "PROPERTY", subjectType: "Base", subjectId: baseId, property: "util", assertedValue: -999 },
    ]);
    expect(conflict.verdict).toBe("CONFLICT");
    expect(conflict.claims[0]!.status).toBe("CONFLICT");
    expect(conflict.claims[0]!.kgValue).toBeDefined();

    // ③ 无此属性 / 无此对象 → NO_EVIDENCE
    const noEvidence = await crossValidate(t, [
      { kind: "PROPERTY", subjectType: "Base", subjectId: baseId, property: "iso9001_cert", assertedValue: "PASS" },
      { kind: "PROPERTY", subjectType: "Base", subjectId: "NOT_A_REAL_BASE", property: "util", assertedValue: 0.5 },
    ]);
    expect(noEvidence.claims.every((c) => c.status === "NO_EVIDENCE")).toBe(true);
    expect(noEvidence.verdict).toBe("PARTIAL");

    // ④ 空 claims → NO_CLAIMS
    const empty = await crossValidate(t, []);
    expect(empty.verdict).toBe("NO_CLAIMS");
  });

  it("跨租户隔离：别租户对象核对不到（NO_EVIDENCE）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = await firstBase(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/cross-validate",
      headers: { "x-debug-user": "other:u1:admin" },
      payload: { claims: [{ kind: "PROPERTY", subjectType: "Base", subjectId: base.props.baseId, property: "util", assertedValue: base.props.util }] },
    });
    const body = res.json() as CrossValidateResponse;
    expect(body.claims[0]!.status).toBe("NO_EVIDENCE");
  });
});
