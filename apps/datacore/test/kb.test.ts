import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, b64, type TestApp } from "./helpers.js";
import { newId } from "../src/ids.js";

async function kbConn(t: TestApp, name: string): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/connections",
    headers: ADMIN,
    payload: { connectorTypeKey: "knowledge_base", name, config: { endpoint: `https://kb.local/${name}` } },
  });
  return (res.json() as { id: string }).id;
}

async function addDoc(t: TestApp, connId: string, filename: string, text: string) {
  const res = await t.app.inject({
    method: "POST",
    url: `/a/v1/kb/${connId}/docs`,
    headers: ADMIN,
    payload: { filename, contentBase64: b64(text) },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { docId: string; chunkCount: number };
}

describe("S4 knowledge base (V11) + rule near-duplicates (V12)", () => {
  it("V11: search after uploading 3 docs — topK hits with span+score; unauthorized connector content excluded", async () => {
    const t = await makeApp();
    const connA = await kbConn(t, "kb-a");
    const connB = await kbConn(t, "kb-b");
    await addDoc(t, connA, "safety.md", "# 电池安全规范\n热失控防护要求：电芯温度超过 60 摄氏度必须触发告警并停线检查。");
    await addDoc(t, connA, "logistics.md", "# 物流时效\n华东区域陆运时效 3 天，海外航运时效 14 天，旺季需提前备料。");
    await addDoc(t, connA, "quality.md", "# 质量管理\n良率波动超过 2 个百分点需要启动 SPC 专项分析，黄金批次参数回滚。");
    const secret = await addDoc(t, connB, "secret.md", "# 机密定价\n电池安全 大客户折扣价目表，毛利率底线 13%。");

    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/kb/search",
      headers: ADMIN,
      payload: { query: "电芯温度 热失控 安全 告警", topK: 3 },
    });
    expect(res.statusCode).toBe(200);
    const { hits } = res.json() as { hits: { text: string; score: number; docId: string; span: { start: number; end: number }; source: string }[] };
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits[0]!.text).toContain("热失控");
    for (const h of hits) {
      expect(h.source).toBe("KB_CHUNK");
      expect(h.span.end).toBeGreaterThan(h.span.start);
      expect(h.score).toBeGreaterThan(0);
    }
    // scores sorted desc
    for (let i = 1; i < hits.length; i++) expect(hits[i]!.score).toBeLessThanOrEqual(hits[i - 1]!.score);

    // topK cap ≤ 10 enforced by the API schema
    const tooMany = await t.app.inject({
      method: "POST",
      url: "/a/v1/kb/search",
      headers: ADMIN,
      payload: { query: "x", topK: 50 },
    });
    expect(tooMany.statusCode).toBe(400);

    // permission policy on the CONNECTION resource: admin loses READ on connB
    await t.repos.policies.put({
      id: newId("pol"),
      tenantId: "demo",
      resource: { kind: "CONNECTION", key: connB },
      grants: [{ role: "planner", ops: ["READ"] }],
    });
    const filtered = await t.app.inject({
      method: "POST",
      url: "/a/v1/kb/search",
      headers: ADMIN,
      payload: { query: "电池安全 折扣 价目表 毛利率", topK: 10 },
    });
    const fHits = (filtered.json() as { hits: { docId: string }[] }).hits;
    expect(fHits.some((h) => h.docId === secret.docId)).toBe(false);
  });

  it("V12: candidate semantically identical to a published rule is flagged 疑似重复 with the rule id", async () => {
    const t = await makeApp();
    await seedBattery(t); // publishes C08 外协比例红线 Order.outsourceRatio > 0.3
    t.llm.enqueue({
      candidates: [
        {
          name: "外协比例红线",
          description: "外协比例不得超过 30%",
          expression: "Order.outsourceRatio > 0.3",
          expressionConfidence: 0.95,
          scopeObjectTypes: ["Order"],
          severity: "WARN",
          sourceQuote: "外协比例不得超过 30%",
        },
        {
          name: "新供应商准入评分",
          description: "新供应商准入需评分达到 80 分",
          expression: "Supplier.score < 80",
          expressionConfidence: 0.9,
          scopeObjectTypes: ["Supplier"],
          severity: "INFO",
          sourceQuote: "新供应商准入需评分达到 80 分",
        },
      ],
    });
    const up = await t.app.inject({
      method: "POST",
      url: "/a/v1/rule-docs",
      headers: ADMIN,
      payload: { filename: "outsourcing.md", contentBase64: b64("外协比例不得超过 30%，新供应商准入需评分达到 80 分") },
    });
    expect(up.statusCode).toBe(202);
    const docId = (up.json() as { docId: string }).docId;
    await t.services.ruleDocs.flushExtractions(); // T1：异步——等后台抽取收敛后再读候选
    const cands = (
      await t.app.inject({ method: "GET", url: `/a/v1/rule-docs/${docId}/candidates`, headers: ADMIN })
    ).json() as { candidate: { name: string }; suspectedDuplicateOf?: { ruleId: string; ruleKey: string; similarity: number } }[];
    const dup = cands.find((c) => c.candidate.name === "外协比例红线")!;
    expect(dup.suspectedDuplicateOf).toBeDefined();
    expect(dup.suspectedDuplicateOf!.ruleKey).toBe("C08");
    expect(dup.suspectedDuplicateOf!.similarity).toBeGreaterThan(0.92);
    const c08 = (await t.repos.rules.list("demo", (r) => r.key === "C08" && r.status === "PUBLISHED"))[0]!;
    expect(dup.suspectedDuplicateOf!.ruleId).toBe(c08.id);
    const fresh = cands.find((c) => c.candidate.name === "新供应商准入评分")!;
    expect(fresh.suspectedDuplicateOf).toBeUndefined();
  });

  // WO-KB-UI（G-VIS-1）：补 GET /a/v1/kb/:connId/docs 列表路由（此前仅 ingest/sync/search·文档前端看不到）。
  it("KB-UI · GET /kb/:connId/docs 列已灌文档（docId/filename/chunkCount·按 connId 隔离）", async () => {
    const t = await makeApp();
    const connA = await kbConn(t, "kb-list-a");
    const connB = await kbConn(t, "kb-list-b");
    const d1 = await addDoc(t, connA, "涂布换型.txt", "涂布工序换型损失分析：换型时间约 45 分钟。");
    const d2 = await addDoc(t, connA, "OEE提升.txt", "常州基地设备 OEE 提升：稼动率从 78 提升至 85。");
    await addDoc(t, connB, "别的库.txt", "不属于 A 库的文档。");

    const res = await t.app.inject({ method: "GET", url: `/a/v1/kb/${connA}/docs`, headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const docs = res.json() as { docId: string; connId: string; filename: string; chunkCount: number; createdAt: string }[];
    // 只回 connA 的 2 篇（connB 隔离）；每项 docId/filename/chunkCount 齐。
    expect(docs.length).toBe(2);
    expect(new Set(docs.map((x) => x.docId))).toEqual(new Set([d1.docId, d2.docId]));
    expect(docs.every((x) => x.connId === connA && typeof x.filename === "string" && x.chunkCount >= 1)).toBe(true);
    // 搜索命中的 docId ∈ 列表集合（C2↔C1 勾稽）。
    const s = await t.app.inject({ method: "POST", url: "/a/v1/kb/search", headers: ADMIN, payload: { connId: connA, query: "换型损失" } });
    const hits = (s.json() as { hits: { docId: string }[] }).hits;
    expect(hits.length).toBeGreaterThan(0);
    expect(docs.map((x) => x.docId)).toContain(hits[0]!.docId);
  });
});
