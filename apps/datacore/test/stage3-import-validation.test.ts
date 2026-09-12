import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, b64 } from "./helpers.js";
import type { ModelingSuggestion } from "@platform/contracts";

/**
 * stage3① 导入路径自动校验：连接器配了 validationPolicy 后,materialize（导入→对象）时
 * 按本体值域/类型自动校验,不符的行自动进隔离区（OC4）——非显式调用,自动强制。
 */
const CSV = `so,cust,qty
SO-1,星辰,10
SO-2,蓝海,-5
SO-3,云岭,20
`;

const SUGGESTION: ModelingSuggestion = {
  objectTypes: [{
    action: "CREATE", existingTypeKey: null, typeKey: "SalesOrder", displayName: "销售订单", domain: "product", sourceDataset: "orders",
    properties: [
      { propKey: "so", sourceField: "so", dataType: "string", isPrimaryKey: true, refToTypeKey: null },
      { propKey: "cust", sourceField: "cust", dataType: "string", isPrimaryKey: false, refToTypeKey: null },
      { propKey: "qty", sourceField: "qty", dataType: "number", isPrimaryKey: false, refToTypeKey: null },
    ],
    confidence: 0.9,
  }],
  linkTypes: [],
};

describe("stage3① · 导入路径自动本体校验（连接器 policy → materialize 自动隔离）", () => {
  it("配 qty 值域 min=0 + QUARANTINE → 导入时 qty=-5 行自动进隔离区,干净行成对象", async () => {
    const t = await makeApp();
    const up = await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "orders.csv", contentBase64: b64(CSV) } });
    const connId = (up.json() as { connection: { id: string } }).connection.id;
    // 给来源连接器配本体校验策略：qty 不可为负,违规进隔离
    await t.app.inject({ method: "PUT", url: `/a/v1/connections/${connId}/validation-policy`, headers: ADMIN, payload: { policy: { valueDomain: "QUARANTINE", domainOverrides: { qty: { min: 0 } } } } });

    const ds = ((await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })).json() as { id: string }[])[0]!.id;
    t.llm.enqueue(SUGGESTION);
    const draftId = ((await t.app.inject({ method: "POST", url: "/a/v1/modeling/suggest", headers: ADMIN, payload: { rawDatasetIds: [ds] } })).json() as { draftId: string }).draftId;
    await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draftId}/publish`, headers: ADMIN });
    const mat = (await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draftId}/materialize`, headers: ADMIN })).json() as { created: number; quarantined: number };

    // qty=-5 那行自动进隔离;另两行成对象
    expect(mat.quarantined).toBe(1);
    expect(mat.created).toBe(2);
    const q = (await t.app.inject({ method: "GET", url: "/a/v1/quarantine", headers: ADMIN })).json() as { items: { raw: Record<string, unknown>; detail?: string }[] };
    const bad = q.items.find((x) => x.detail?.includes("qty"));
    expect(bad).toBeTruthy();
    expect(String(bad!.raw.qty)).toBe("-5");
  });

  it("连接器无 policy → 导入不额外校验（向后兼容,仅既有 PK/dup 隔离）", async () => {
    const t = await makeApp();
    const up = await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "orders.csv", contentBase64: b64(CSV) } });
    const connId = (up.json() as { connection: { id: string } }).connection.id;
    const ds = ((await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })).json() as { id: string }[])[0]!.id;
    t.llm.enqueue(SUGGESTION);
    const draftId = ((await t.app.inject({ method: "POST", url: "/a/v1/modeling/suggest", headers: ADMIN, payload: { rawDatasetIds: [ds] } })).json() as { draftId: string }).draftId;
    await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draftId}/publish`, headers: ADMIN });
    const mat = (await t.app.inject({ method: "POST", url: `/a/v1/modeling/drafts/${draftId}/materialize`, headers: ADMIN })).json() as { created: number; quarantined: number };
    // 无 policy → qty=-5 不被隔离 → 3 行全成对象
    expect(mat.quarantined).toBe(0);
    expect(mat.created).toBe(3);
  });
});
