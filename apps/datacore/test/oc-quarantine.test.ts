import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, PLANNER, b64, type TestApp } from "./helpers.js";
import type { ModelingSuggestion } from "@platform/contracts";

const HOSTILE_CSV = `so,cust,qty
SO-1,星辰,10
,蓝海,20
SO-1,极光,30
SO-2,云岭,40
`;

const SUGGESTION: ModelingSuggestion = {
  objectTypes: [
    {
      action: "CREATE",
      existingTypeKey: null,
      typeKey: "SalesOrder",
      displayName: "销售订单",
      domain: "product",
      sourceDataset: "orders",
      properties: [
        { propKey: "so", sourceField: "so", dataType: "string", isPrimaryKey: true, refToTypeKey: null },
        { propKey: "cust", sourceField: "cust", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
        { propKey: "qty", sourceField: "qty", dataType: "number", isPrimaryKey: false, refToTypeKey: null },
      ],
      confidence: 0.9,
    },
  ],
  linkTypes: [],
};

async function publishAndMaterialize(t: TestApp): Promise<{ created: number; quarantined: number }> {
  const up = await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "orders.csv", contentBase64: b64(HOSTILE_CSV) } });
  const connId = (up.json() as { connection: { id: string } }).connection.id;
  const dsList = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })).json() as { id: string }[];
  const ds = dsList[0]!.id;
  t.llm.enqueue(SUGGESTION);
  const s = await t.app.inject({ method: "POST", url: "/a/v1/modeling/suggest", headers: ADMIN, payload: { rawDatasetIds: [ds] } });
  const draftId = (s.json() as { draftId: string }).draftId;
  await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draftId}/publish`, headers: ADMIN });
  const mat = await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draftId}/materialize`, headers: ADMIN });
  return mat.json() as { created: number; quarantined: number };
}

describe("运营完备性 §4 — 数据隔离区（OC4）", () => {
  it("注入 hostile 数据 → 批次成功 + 异常行入隔离区（原因正确），不使批次失败", async () => {
    const t = await makeApp();
    const { created, quarantined } = await publishAndMaterialize(t);
    expect(created).toBe(2); // SO-1, SO-2
    expect(quarantined).toBe(2); // missing PK + duplicate PK

    const q = (await t.app.inject({ method: "GET", url: "/a/v1/quarantine", headers: ADMIN })).json() as {
      items: { id: string; reason: string }[];
      byReason: Record<string, number>;
      total: number;
    };
    expect(q.total).toBe(2);
    expect(q.byReason.SCHEMA_MISMATCH).toBe(1);
    expect(q.byReason.DUP_KEY).toBe(1);
  });

  it("修复并重处理：行内编辑补主键 → 进入正常管线（对象可查），状态 REPROCESSED", async () => {
    const t = await makeApp();
    await publishAndMaterialize(t);
    const q = (await t.app.inject({ method: "GET", url: "/a/v1/quarantine", headers: ADMIN })).json() as { items: { id: string; reason: string }[] };
    const missing = q.items.find((x) => x.reason === "SCHEMA_MISMATCH")!;

    const rp = await t.app.inject({
      method: "POST",
      url: `/a/v1/quarantine/${missing.id}/reprocess`,
      headers: ADMIN,
      payload: { edits: { so: "SO-3" } },
    });
    expect(rp.statusCode).toBe(200);
    expect((rp.json() as { status: string }).status).toBe("REPROCESSED");

    // object now present in the normal pipeline
    const objs = (
      await t.app.inject({ method: "POST", url: "/a/v1/objects/query", headers: ADMIN, payload: { objectType: "SalesOrder", filter: { so: "SO-3" }, limit: 10 } })
    ).json() as { data: unknown[] };
    expect(objs.data).toHaveLength(1);

    // remaining PENDING shrank to 1 (the dup)
    const left = (await t.app.inject({ method: "GET", url: "/a/v1/quarantine", headers: ADMIN })).json() as { total: number };
    expect(left.total).toBe(1);
  });

  it("reprocess 仍缺主键 → 422；批量丢弃需意见", async () => {
    const t = await makeApp();
    await publishAndMaterialize(t);
    const q = (await t.app.inject({ method: "GET", url: "/a/v1/quarantine", headers: ADMIN })).json() as { items: { id: string; reason: string }[] };
    const missing = q.items.find((x) => x.reason === "SCHEMA_MISMATCH")!;
    const dup = q.items.find((x) => x.reason === "DUP_KEY")!;

    const bad = await t.app.inject({ method: "POST", url: `/a/v1/quarantine/${missing.id}/reprocess`, headers: ADMIN, payload: { edits: { so: "" } } });
    expect(bad.statusCode).toBe(400);

    const noComment = await t.app.inject({ method: "POST", url: "/a/v1/quarantine/discard", headers: ADMIN, payload: { ids: [dup.id], comment: "" } });
    expect(noComment.statusCode).toBe(400);
    const ok = await t.app.inject({ method: "POST", url: "/a/v1/quarantine/discard", headers: ADMIN, payload: { ids: [dup.id], comment: "源系统重复录入，确认丢弃" } });
    expect((ok.json() as { discarded: number }).discarded).toBe(1);
  });

  it("非管理员不可访问隔离区", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/quarantine", headers: PLANNER });
    expect(res.statusCode).toBe(403);
  });
});
