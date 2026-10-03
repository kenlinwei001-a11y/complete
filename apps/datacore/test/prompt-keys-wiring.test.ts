import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, b64, debugUser, MODELS_CSV, ORDERS_CSV, type TestApp } from "./helpers.js";
import type { ModelingSuggestion } from "@platform/contracts";

const ACME = debugUser("acme", "admin", "admin");

/**
 * WO-PROMPT-KEYS-WIRE（闭 G-PROMPT-KEYS-CONFIG-ONLY · A 侧两键）· 接缝测：
 * 断言落在「这个键真的到达了 LLM 请求体」——admin PUT /a/v1/prompt-templates/:key 后，
 * extraction / modeling 真实调用路径的 parseStructured 请求体 system 逐字节等于 override 模板；
 * 无 override → 硬编码默认（R6 字节兼容·既有行为逐字节不变）。
 *
 * 变异反证口径：把 ruledocs.ts / modeling.ts 里的 promptTemplateOverride 取值拆掉 →
 * 本文件红在「请求体里的 system 没变成 override」（不是「配置读不到」——
 * 配置表读写通路本身由 prompt-template.test.ts 守）。
 *
 * ⚠️ 勿与 LlmPurposeSchema 的 purpose:"extraction"/"modeling" 混：那是用途绑定（选哪个模型），
 * 本文件守的是提示词模板（用哪段指令进请求体）。
 */

/** extraction 租户 override（含独特标记·断言「确实流入了请求体」）。 */
const EXTRACTION_OVERRIDE = "【接管·租户自定义】本租户专属规则抽取指令——EXTRACTION-OVERRIDE-标记-7。";
/** modeling 租户 override。 */
const MODELING_OVERRIDE = "【接管·租户自定义】本租户专属建模建议指令——MODELING-OVERRIDE-标记-9。";
/** 硬编码默认的特征串（兜底在场的证据）。 */
const EXTRACTION_DEFAULT_MARK = "你是企业规则抽取器";
const MODELING_DEFAULT_MARK = "你是本体建模助手";

const FIXTURE_MD = `# 产能管理制度

第一条 需求增量超过 50% 时必须阻断排产并上报计划委员会审批。
`;

async function putOverride(t: TestApp, key: string, template: string): Promise<void> {
  const res = await t.app.inject({
    method: "PUT",
    url: `/a/v1/prompt-templates/${key}`,
    headers: ADMIN,
    payload: { template },
  });
  expect(res.statusCode).toBe(200);
}

async function uploadCsv(t: TestApp, filename: string, csv: string, headers: Record<string, string> = ADMIN): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/uploads",
    headers,
    payload: { filename, contentBase64: b64(csv) },
  });
  expect(res.statusCode).toBe(201);
  const connId = (res.json() as { connection: { id: string } }).connection.id;
  const ds = (
    await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers })
  ).json() as { id: string }[];
  return ds[0]!.id;
}

const SUGGESTION: ModelingSuggestion = {
  objectTypes: [
    {
      action: "CREATE",
      existingTypeKey: null,
      typeKey: "Order",
      displayName: "订单",
      domain: "product",
      sourceDataset: "orders",
      properties: [
        { propKey: "so", sourceField: "so", dataType: "string", isPrimaryKey: true, refToTypeKey: null },
      ],
      confidence: 0.9,
    },
  ],
  linkTypes: [],
};

describe("WO-PROMPT-KEYS-WIRE · extraction 键真进 LLM 请求体（A2 规则抽取真路径）", () => {
  it("admin PUT extraction override → 抽取请求体 system 逐字节 = override（键到达请求体）", async () => {
    const t = await makeApp();
    t.llm.onRequest(() => ({ candidates: [] }));
    await putOverride(t, "extraction", EXTRACTION_OVERRIDE);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/rule-docs",
      headers: ADMIN,
      payload: { filename: "capacity-policy.md", contentBase64: b64(FIXTURE_MD) },
    });
    expect(res.statusCode).toBe(202);
    // ★ 断言点 = 请求体：真路径真发了 LLM 调用，且 system 逐字节等于租户 override。
    expect(t.llm.calls.length).toBeGreaterThan(0);
    for (const call of t.llm.calls) {
      expect(call.system).toBe(EXTRACTION_OVERRIDE);
      expect(call.system).not.toContain(EXTRACTION_DEFAULT_MARK);
    }
  });

  it("无 override → 抽取请求体 system = 硬编码默认（R6 字节兼容·零回归）", async () => {
    const t = await makeApp();
    t.llm.onRequest(() => ({ candidates: [] }));
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/rule-docs",
      headers: ADMIN,
      payload: { filename: "capacity-policy.md", contentBase64: b64(FIXTURE_MD) },
    });
    expect(res.statusCode).toBe(202);
    expect(t.llm.calls.length).toBeGreaterThan(0);
    for (const call of t.llm.calls) {
      expect(call.system).toContain(EXTRACTION_DEFAULT_MARK);
      expect(call.system).not.toContain("EXTRACTION-OVERRIDE-标记-7");
    }
  });
});

describe("WO-PROMPT-KEYS-WIRE · modeling 键真进 LLM 请求体（A3 建模建议真路径）", () => {
  it("admin PUT modeling override → suggest 请求体 system 逐字节 = override（键到达请求体）", async () => {
    const t = await makeApp();
    const ordersDs = await uploadCsv(t, "orders.csv", ORDERS_CSV);
    const modelsDs = await uploadCsv(t, "models.csv", MODELS_CSV);
    await putOverride(t, "modeling", MODELING_OVERRIDE);
    t.llm.enqueue(SUGGESTION);
    const suggest = await t.app.inject({
      method: "POST",
      url: "/a/v1/modeling/suggest",
      headers: ADMIN,
      payload: { rawDatasetIds: [ordersDs, modelsDs] },
    });
    expect(suggest.statusCode).toBe(202);
    // ★ 断言点 = 请求体：suggest 真调了 LLM，且 system 逐字节等于租户 override。
    expect(t.llm.calls.length).toBe(1);
    expect(t.llm.calls[0]!.system).toBe(MODELING_OVERRIDE);
    expect(t.llm.calls[0]!.system).not.toContain(MODELING_DEFAULT_MARK);
  });

  it("无 override → suggest 请求体 system = 硬编码默认（R6 字节兼容·零回归）", async () => {
    const t = await makeApp();
    const ordersDs = await uploadCsv(t, "orders.csv", ORDERS_CSV);
    const modelsDs = await uploadCsv(t, "models.csv", MODELS_CSV);
    t.llm.enqueue(SUGGESTION);
    const suggest = await t.app.inject({
      method: "POST",
      url: "/a/v1/modeling/suggest",
      headers: ADMIN,
      payload: { rawDatasetIds: [ordersDs, modelsDs] },
    });
    expect(suggest.statusCode).toBe(202);
    expect(t.llm.calls.length).toBe(1);
    expect(t.llm.calls[0]!.system).toContain(MODELING_DEFAULT_MARK);
    expect(t.llm.calls[0]!.system).not.toContain("MODELING-OVERRIDE-标记-9");
  });

  it("租户隔离：demo 租户 override 不漏进 acme 租户的 modeling 请求体", async () => {
    const t = await makeApp();
    const ordersDs = await uploadCsv(t, "orders.csv", ORDERS_CSV, ACME);
    const modelsDs = await uploadCsv(t, "models.csv", MODELS_CSV, ACME);
    // 给 demo 租户配 override，acme 租户不配 → acme 的请求体必须仍是硬编码默认。
    await t.repos.promptTemplates.put({
      id: "pt_demo_modeling",
      tenantId: "demo",
      key: "modeling",
      template: MODELING_OVERRIDE,
      version: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: "u1",
    });
    t.llm.enqueue(SUGGESTION);
    const suggest = await t.app.inject({
      method: "POST",
      url: "/a/v1/modeling/suggest",
      headers: ACME,
      payload: { rawDatasetIds: [ordersDs, modelsDs] },
    });
    expect(suggest.statusCode).toBe(202);
    expect(t.llm.calls.length).toBe(1);
    expect(t.llm.calls[0]!.system).toContain(MODELING_DEFAULT_MARK);
    expect(t.llm.calls[0]!.system).not.toContain("MODELING-OVERRIDE-标记-9");
  });
});
