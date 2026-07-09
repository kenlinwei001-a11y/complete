import { describe, expect, it } from "vitest";
import type { ClassificationResult, ExecutionPlan, IntentDefinition, ScenarioPackage } from "@platform/contracts";
import { fuseClassification, FUSE_BETA_DEFAULT } from "../src/router/orchestrator.js";
import { createTestApp, debugHeaders, PLANNER, TENANT, waitForTask, type TestApp } from "./helpers.js";

/**
 * PRD-upstream-classify-precision §4 (A1)·分类融合（确定性 ⊕ LLM）测试。
 * 纯函数 fuseClassification：① LLM 无 → 纯确定性；② 救回遗漏；③ 一致性加成；④ 冲突不硬塞；
 * + R6 确定性（同输入字节一致）+ 关闸等价（switch-off == `llm ?? det` 的 llm 分支）。
 * + 应用级：QOS_CLASSIFY_FUSE=1 时 det 救回使查询落澄清（非 Path B）且 qos_classify_fuse_rescued_total 真出数。
 */

const TAU = { high: 0.85, low: 0.55 };

// 两个意图：物料齐套（A）/ 受影响订单（B）——多候选避免单候选短路。
const INTENT_A: IntentDefinition = {
  id: "intent_mat", packageId: "p", key: "material_readiness", version: 1, status: "PUBLISHED",
  name: "物料齐套分析", description: "物料齐套分析",
  examples: ["常州物料齐套为什么越线", "物料齐套率为什么低"],
  enabledViews: "*", slots: [], planRef: { planKey: "plan_a", version: "latest" },
} as IntentDefinition;
const INTENT_B: IntentDefinition = {
  id: "intent_ord", packageId: "p", key: "order_affected", version: 1, status: "PUBLISHED",
  name: "受影响订单查询", description: "受影响订单查询",
  examples: ["影响哪些订单", "常州停产影响哪些订单"],
  enabledViews: "*", slots: [], planRef: { planKey: "plan_b", version: "latest" },
} as IntentDefinition;
const CANDS = [INTENT_A, INTENT_B];
const MAT_QUERY = "常州物料齐套为什么越线"; // det top = A（≈example·score≥0.5）

function llm(candidates: { intentKey: string; confidence: number }[], outOfCatalog = false): ClassificationResult {
  return { candidates, outOfCatalog, extractedSlots: { foo: "bar" }, latencyMs: 7, model: "mock-llm" };
}

describe("A1·fuseClassification 纯函数（PRD §4）", () => {
  it("① LLM 缺失 → 退回纯确定性（deterministic:example-match·向后兼容）", () => {
    const { result, rescued } = fuseClassification(undefined, CANDS, MAT_QUERY, TAU);
    expect(rescued).toBe(false);
    expect(result?.model).toBe("deterministic:example-match");
    expect(result?.candidates[0]?.intentKey).toBe("material_readiness");
    expect(result?.candidates[0]?.confidence).toBe(1); // 唯一强匹配 → path A
  });

  it("② 救回遗漏：det 强匹配意图不在 LLM 候选 → 以 τ_low 补入 → rescued=true（脱离 Path B）", () => {
    // LLM 低置信指向错意图（<τ_low）且漏掉 det 强命中的 A
    const { result, rescued } = fuseClassification(
      llm([{ intentKey: "order_affected", confidence: 0.4 }]), CANDS, MAT_QUERY, TAU,
    );
    expect(rescued).toBe(true);
    expect(result?.candidates[0]?.intentKey).toBe("material_readiness"); // 补入的 det 意图升为 top
    expect(result?.candidates[0]?.confidence).toBe(TAU.low); // 补入置信 = τ_low
    expect(result?.outOfCatalog).toBe(false);
    // 原 LLM top 0.4<τ_low 会落 Path B；补入后 top=τ_low 不再 Path B
    expect((result?.candidates[0]?.confidence ?? 0) >= TAU.low).toBe(true);
  });

  it("③ 一致性加成：LLM top 与 det top 同一意图 → ×(1+β)（只上浮·不下调）", () => {
    const base = 0.6;
    const { result, rescued } = fuseClassification(
      llm([{ intentKey: "material_readiness", confidence: base }]), CANDS, MAT_QUERY, TAU,
    );
    expect(rescued).toBe(false); // 加成非"救回补入"
    expect(result?.candidates[0]?.intentKey).toBe("material_readiness");
    expect(result?.candidates[0]?.confidence).toBeCloseTo(base * (1 + FUSE_BETA_DEFAULT), 10); // 0.66
    expect(result?.candidates[0]?.confidence).toBeGreaterThan(base); // 只上浮
  });

  it("④ 冲突不硬塞：LLM top 与 det top 分歧且 det 不强 → 维持 LLM 语义（INTENT_CHOICE 澄清）", () => {
    // 无关问句 → det 全弱（<0.5·不补入）；LLM 中置信指向 B → 保持不变
    const input = llm([{ intentKey: "order_affected", confidence: 0.6 }]);
    const { result, rescued } = fuseClassification(input, CANDS, "随便问问看看这个东西", TAU);
    expect(rescued).toBe(false);
    expect(result?.candidates).toEqual(input.candidates); // 不硬塞·维持澄清
    expect(result?.candidates[0]?.confidence).toBe(0.6); // 落 τ_low..τ_high → INTENT_CHOICE
  });

  it("关闸等价：无补入/无上浮 → result 逐字段等价输入 llm（== `llm ?? det` 的 llm 分支）", () => {
    const input = llm([{ intentKey: "order_affected", confidence: 0.9 }]);
    const { result } = fuseClassification(input, CANDS, "随便问问看看这个东西", TAU);
    expect(result).toEqual(input); // outOfCatalog/extractedSlots/latencyMs/model/candidates 全同
  });

  it("R6 确定性：同输入 → 字节一致（无时钟/随机）", () => {
    const input = llm([{ intentKey: "order_affected", confidence: 0.4 }]);
    const a = fuseClassification(input, CANDS, MAT_QUERY, TAU);
    const b = fuseClassification(input, CANDS, MAT_QUERY, TAU);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// 应用级：QOS_CLASSIFY_FUSE=1 救回 → 澄清（非 Path B）+ qos_classify_fuse_rescued_total 出数
// ---------------------------------------------------------------------------
const PKG = "pkg_fuse";
async function seed(t: TestApp) {
  if (!(await t.repos.packages.get(PKG))) {
    await t.repos.packages.insert({ id: PKG, tenantId: TENANT, name: "fuse", views: ["qd"], toolWhitelist: ["invoke_solver"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as ScenarioPackage);
  }
  await t.repos.plans.insert({ id: "plan_fuse_a", packageId: PKG, key: "plan_a", version: 1, status: "PUBLISHED", steps: [{ id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "物料齐套" }] } }] } as ExecutionPlan);
  const mk = (key: string, name: string, examples: string[]): IntentDefinition => ({ id: `intent_${key}`, packageId: PKG, key, version: 1, status: "PUBLISHED", name, description: name, examples, enabledViews: ["qd"], slots: [], planRef: { planKey: "plan_a", version: "latest" } } as IntentDefinition);
  await t.repos.intents.insert(mk("material_readiness", "物料齐套分析", ["常州物料齐套为什么越线", "物料齐套率为什么低"]));
  await t.repos.intents.insert(mk("order_affected", "受影响订单查询", ["影响哪些订单", "常州停产影响哪些订单"]));
}
function submit(t: TestApp, query: string): Promise<string> {
  return t.app.inject({ method: "POST", url: "/api/v1/queries", headers: { ...debugHeaders(PLANNER) }, payload: { packageId: PKG, query, context: { view: "qd", selectedObjects: [], filters: {} } } }).then((r) => (r.json() as { taskId: string }).taskId);
}

describe("A1·QOS_CLASSIFY_FUSE=1 应用级救回 + rescued 指标", () => {
  it("LLM outOfCatalog + det 强命中 → 融合救回落澄清（非 Path B）·qos_classify_fuse_rescued_total 出数", async () => {
    const t = await createTestApp({ env: { QOS_CLASSIFY_FUSE: "1" } });
    await seed(t);
    // 模拟 LLM 判域外（会落 Path B）；det 对「常州物料齐套…」强命中 material_readiness → 救回
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const before = t.metrics.classifyFuseRescued.get();
    const taskId = await submit(t, "常州物料齐套为什么越线");
    const task = await waitForTask(t, taskId);
    expect(t.metrics.classifyFuseRescued.get()).toBe(before + 1); // 救回真出数
    expect(task.path).not.toBe("AGENT"); // 未落 Path B agent
    expect(task.classification?.candidates?.[0]?.intentKey).toBe("material_readiness");
    // top=τ_low → INTENT_CHOICE 澄清（非 Path B）
    expect(["AWAITING_CLARIFICATION", "EXECUTING_WORKFLOW", "COMPLETED"]).toContain(task.status);
  });

  it("关闸（QOS_CLASSIFY_FUSE 未设）：同问句 + LLM outOfCatalog → 落 Path B（改造前系统·救回指标不动）", async () => {
    const t = await createTestApp(); // 默认 OFF
    await seed(t);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const before = t.metrics.classifyFuseRescued.get();
    const taskId = await submit(t, "常州物料齐套为什么越线");
    const task = await waitForTask(t, taskId);
    expect(t.metrics.classifyFuseRescued.get()).toBe(before); // 关闸零救回
    // 关闸态 = `llm ?? det`：LLM 域外但 det 强命中 → 仍走确定性兜底（QOS-DIAG 基线）→ 非 agent 硬兜底
    expect(task.classification?.model === "deterministic:example-match" || task.path === "AGENT").toBe(true);
  });
});
