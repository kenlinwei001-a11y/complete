import { describe, expect, it } from "vitest";
import type { LlmParseRequest } from "../src/llm.js";
import { makeApp, ADMIN, b64 } from "./helpers.js";
import { segmentText, nameSimilarity } from "../src/ruledocs.js";

const FIXTURE_MD = `# 产能管理制度

第一条 需求增量超过 50% 时必须阻断排产并上报计划委员会审批。

第二条 外协比例不得超过 30%，超出时系统应发出警告并记录原因。

第三条 客户信用使用率超过 100% 时禁止接收新订单。
`;

function scriptedExtraction(req: LlmParseRequest<unknown>): unknown {
  const text = req.messages[0]!.content;
  if (text.includes("需求增量")) {
    return {
      candidates: [
        {
          name: "需求增量阻断",
          description: "需求增量超过50%阻断排产",
          expression: "Order.demandDelta > 0.5",
          expressionConfidence: 0.95,
          scopeObjectTypes: ["Order"],
          severity: "BLOCK",
          sourceQuote: "需求增量超过 50% 时必须阻断排产",
        },
      ],
    };
  }
  if (text.includes("外协比例")) {
    return {
      candidates: [
        {
          name: "外协比例上限",
          description: "外协比例不得超过30%",
          expression: "Order.outsourceRatio > 0.3",
          expressionConfidence: 0.9,
          scopeObjectTypes: ["Order"],
          severity: "WARN",
          sourceQuote: "外协比例不得超过 30%",
        },
      ],
    };
  }
  if (text.includes("信用使用率")) {
    return {
      candidates: [
        {
          name: "信用额度约束",
          description: "信用使用率超过100%禁止接单",
          expression: "Order.creditUsedRatio > 1",
          expressionConfidence: 0.92,
          scopeObjectTypes: ["Order"],
          severity: "BLOCK",
          sourceQuote: "客户信用使用率超过 100% 时禁止接收新订单",
        },
      ],
    };
  }
  return { candidates: [] };
}

describe("A2 rule-doc parsing", () => {
  it("segments by headings/paragraphs with span offsets", () => {
    const segs = segmentText(FIXTURE_MD);
    expect(segs.length).toBe(3);
    expect(segs[0]!.heading).toBe("产能管理制度");
    for (const s of segs) {
      expect(FIXTURE_MD.slice(s.spanStart, s.spanEnd)).toBe(s.text);
    }
  });

  it("RD1: 3 explicit constraints → ≥3 candidates, quote validation passes, EDIT_APPROVE publishes with origin backlink", async () => {
    const t = await makeApp();
    t.llm.onRequest(scriptedExtraction);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/rule-docs",
      headers: ADMIN,
      payload: { filename: "capacity-policy.md", contentBase64: b64(FIXTURE_MD) },
    });
    expect(res.statusCode).toBe(202);
    const { docId, jobId, status } = res.json() as { docId: string; jobId: string; status: string };
    expect(docId).toMatch(/^doc_/);
    expect(status).toBe("EXTRACTING"); // T1：异步——202 立返，候选随后台抽取产出
    // 等后台抽取收敛（生产为前端轮询；测试 mock LLM 即时，flush 即收敛）
    await t.services.ruleDocs.flushExtractions();
    const doc = (await t.app.inject({ method: "GET", url: `/a/v1/rule-docs/${docId}`, headers: ADMIN })).json() as { status: string; droppedCandidates: number };
    expect(doc.status).toBe("IN_REVIEW");
    expect(doc.droppedCandidates).toBe(0);

    const cands = (
      await t.app.inject({ method: "GET", url: `/a/v1/rule-docs/${docId}/candidates?status=PENDING`, headers: ADMIN })
    ).json() as { id: string; candidate: { name: string; sourceQuote: string }; span: { start: number; end: number } }[];
    expect(cands.length).toBeGreaterThanOrEqual(3);
    // span points at the verbatim quote inside the document text
    for (const c of cands) {
      expect(FIXTURE_MD.slice(c.span.start, c.span.end)).toBe(c.candidate.sourceQuote);
    }

    const first = cands.find((c) => c.candidate.name === "需求增量阻断")!;
    const review = await t.app.inject({
      method: "POST",
      url: `/a/v1/rule-candidates/${first.id}/review`,
      headers: ADMIN,
      payload: { action: "EDIT_APPROVE", patch: { expression: "Order.demandDelta > 0.45", severity: "BLOCK" } },
    });
    expect(review.statusCode).toBe(200);
    const reviewed = review.json() as { status: string; publishedRuleId: string };
    expect(reviewed.status).toBe("APPROVED");

    const rules = (
      await t.app.inject({ method: "GET", url: "/a/v1/rules?status=PUBLISHED", headers: ADMIN })
    ).json() as { id: string; expression: string; origin: { type: string; docId?: string; extractJobId?: string; span?: { start: number } } }[];
    const published = rules.find((r) => r.id === reviewed.publishedRuleId)!;
    expect(published.expression).toBe("Order.demandDelta > 0.45");
    expect(published.origin.type).toBe("DOCUMENT");
    expect(published.origin.docId).toBe(docId);
    expect(published.origin.extractJobId).toBe(jobId);
    expect(published.origin.span).toEqual(first.span);
  });

  it("RD2: non-substring sourceQuote (mock-injected) is dropped and counted", async () => {
    const t = await makeApp();
    t.llm.onRequest(() => ({
      candidates: [
        {
          name: "幻觉规则",
          description: "不存在的约束",
          expression: "",
          expressionConfidence: 0.5,
          scopeObjectTypes: [],
          severity: "INFO",
          sourceQuote: "这句话并不在原文之中",
        },
        {
          name: "真实规则",
          description: "存在的约束",
          expression: "Order.demandDelta > 0.5",
          expressionConfidence: 0.9,
          scopeObjectTypes: ["Order"],
          severity: "BLOCK",
          sourceQuote: "需求增量超过 50%",
        },
      ],
    }));
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/rule-docs",
      headers: ADMIN,
      payload: { filename: "one.md", contentBase64: b64("需求增量超过 50% 时必须阻断排产。\n") },
    });
    expect(res.statusCode).toBe(202);
    const { docId } = res.json() as { docId: string };
    await t.services.ruleDocs.flushExtractions();
    const cands = (await t.app.inject({ method: "GET", url: `/a/v1/rule-docs/${docId}/candidates`, headers: ADMIN })).json() as unknown[];
    const doc = (await t.app.inject({ method: "GET", url: `/a/v1/rule-docs/${docId}`, headers: ADMIN })).json() as { droppedCandidates: number };
    expect(cands.length).toBe(1); // 真实规则保留
    expect(doc.droppedCandidates).toBe(1); // 幻觉规则（非子串）被丢弃并计数
    expect(t.services.metrics.get("dc_rule_extract_candidates_total", { disposition: "dropped" })).toBe(1);
    expect(t.services.metrics.get("dc_rule_extract_candidates_total", { disposition: "accepted" })).toBe(1);
  });

  it("re-upload diffs by name similarity (新增/变更)", async () => {
    const t = await makeApp();
    t.llm.onRequest(scriptedExtraction);
    const r1 = await t.app.inject({
      method: "POST",
      url: "/a/v1/rule-docs",
      headers: ADMIN,
      payload: { filename: "policy.md", contentBase64: b64(FIXTURE_MD) },
    });
    expect(r1.statusCode).toBe(202);
    // second upload of same filename: same content → candidates matched by name, no diff marks of 新增 for matched
    const v2 = FIXTURE_MD.replace("超过 50%", "超过 40%") + "\n第四条 新增的库存约束：库存周转天数不得超过 60 天。\n";
    t.llm.onRequest((req) => {
      const base = scriptedExtraction(req) as { candidates: Record<string, unknown>[] };
      const text = req.messages[0]!.content;
      if (text.includes("需求增量")) {
        const c = base.candidates[0] as { sourceQuote: string; expression: string };
        c.sourceQuote = "需求增量超过 40% 时必须阻断排产";
        c.expression = "Order.demandDelta > 0.4";
      }
      if (text.includes("库存周转")) {
        return {
          candidates: [
            {
              name: "库存周转约束",
              description: "库存周转天数上限",
              expression: "Inventory.turnoverDays > 60",
              expressionConfidence: 0.8,
              scopeObjectTypes: ["Inventory"],
              severity: "WARN",
              sourceQuote: "库存周转天数不得超过 60 天",
            },
          ],
        };
      }
      return base;
    });
    // 首传也要等抽取收敛（diff 基线需已有前一版候选）
    await t.services.ruleDocs.flushExtractions();
    const r2 = await t.app.inject({
      method: "POST",
      url: "/a/v1/rule-docs",
      headers: ADMIN,
      payload: { filename: "policy.md", contentBase64: b64(v2) },
    });
    const doc2 = r2.json() as { docId: string };
    await t.services.ruleDocs.flushExtractions();
    const cands = (
      await t.app.inject({ method: "GET", url: `/a/v1/rule-docs/${doc2.docId}/candidates`, headers: ADMIN })
    ).json() as { candidate: { name: string }; diff?: string }[];
    expect(cands.find((c) => c.candidate.name === "需求增量阻断")!.diff).toBe("变更");
    expect(cands.find((c) => c.candidate.name === "库存周转约束")!.diff).toBe("新增");
  });

  it("nameSimilarity behaves sensibly", () => {
    expect(nameSimilarity("外协比例上限", "外协比例上限")).toBe(1);
    expect(nameSimilarity("外协比例上限", "外协比例红线")).toBeGreaterThan(0.5);
    expect(nameSimilarity("外协比例上限", "库存周转约束")).toBeLessThan(0.3);
  });
});
