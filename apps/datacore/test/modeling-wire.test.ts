import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, b64, type TestApp } from "./helpers.js";

/**
 * WO-DB-MODELING-WIRE 齿（故事发动机接 A3 deriveModelingSuggestion·数据先行·green→red）：
 *  上传真实数据（含 FK）→ 建域给 fromDatasetIds → objectTypes/链路从**真实列/FK**派生（非 LLM/地板凭空造）：
 *   ① 类型来自数据集列（Orders/Procs 的真实字段·主键 uniqueRate 判）；
 *   ② FK 真检测（Procs.order_id → Orders）落 refToTypeKey；
 *   ③ 对照（现状红）：不给 fromDatasetIds → objectTypes 是脚本地板倒推（非上传列）→ 证接线真生效。
 */
const ORDERS = "order_id,cust\nO1,星辰\nO2,蓝海\nO3,极光\n";
const PROCS = "proc_id,order_id,step\nP1,O1,涂布\nP2,O2,卷绕\nP3,O3,注液\n";

async function upload(t: TestApp, filename: string, csv: string): Promise<string> {
  const up = (await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename, contentBase64: b64(csv) } })).json() as { connection: { id: string } };
  const ds = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${up.connection.id}`, headers: ADMIN })).json() as { id: string }[];
  return ds[0]!.id;
}

describe("WO-DB-MODELING-WIRE · 故事发动机接 A3（数据先行·真列/FK 派生类型）", () => {
  it("①② fromDatasetIds → objectTypes/refToTypeKey 从真实列/FK 派生（A3 deriveModelingSuggestion）", async () => {
    const t = await makeApp();
    const ordId = await upload(t, "orders.csv", ORDERS);
    const procId = await upload(t, "procs.csv", PROCS);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: "订单与工序风险推演", seed: 42, fromDatasetIds: [ordId, procId] } });
    const plan = (res.json() as { buildPlan?: { objectTypes: { typeKey: string; properties: { propKey: string; isPrimaryKey: boolean; refToTypeKey: string | null }[] }[] } }).buildPlan!;
    const types = plan.objectTypes.map((o) => o.typeKey).sort();
    // ① 类型来自数据集名（toPascal）·真实列（order_id/cust · proc_id/order_id/step）。
    expect(types).toEqual(["Orders", "Procs"]);
    const procs = plan.objectTypes.find((o) => o.typeKey === "Procs")!;
    expect(procs.properties.map((p) => p.propKey).sort()).toEqual(["order_id", "proc_id", "step"]);
    expect(procs.properties.find((p) => p.propKey === "proc_id")!.isPrimaryKey).toBe(true); // uniqueRate 判主键
    // ② FK 真检测：Procs.order_id → Orders（refToTypeKey 落·非 LLM 编造）。
    expect(procs.properties.find((p) => p.propKey === "order_id")!.refToTypeKey).toBe("Orders");
  });

  it("③ 不给 fromDatasetIds → 走脚本地板倒推（非上传列）·证数据先行接线真生效（green→red 对照）", async () => {
    const t = await makeApp();
    await upload(t, "orders.csv", ORDERS);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: "订单与工序风险推演", seed: 42 } });
    const plan = (res.json() as { buildPlan?: { objectTypes: { typeKey: string }[] } }).buildPlan!;
    // 脚本地板不会产 "Orders"/"Procs"（那是数据集派生的·大写复数名）——证 ① 的类型确来自 fromDatasetIds 派生。
    expect(plan.objectTypes.map((o) => o.typeKey)).not.toContain("Procs");
  });
});
