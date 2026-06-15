import { describe, expect, it } from "vitest";
import type { ExecutionPlan, IntentDefinition, ScenarioPackage } from "@platform/contracts";
import { createTestApp, PLANNER, TENANT, debugHeaders, waitForTask, type TestApp } from "./helpers.js";

// 独立场景包：仅 1 个视图作用域意图（避免 seed 的 enabledViews:"*" 污染单候选判定）。
const SOLO_PKG = "pkg_solo_sc";

/**
 * #5 单候选短路：候选收窄后仅 1 个意图且其必填槽位可仅从上下文满足 → 跳过 LLM 分类直接路径 A。
 * 安全门：必填槽位需 NL 抽取（上下文不满足）时不短路、照常分类（保留槽位填充语义）。
 */

async function seedSolo(t: TestApp, opts: { view: string; key: string; requiredObjRef: boolean }) {
  if (!(await t.repos.packages.get(SOLO_PKG))) {
    await t.repos.packages.insert({ id: SOLO_PKG, tenantId: TENANT, name: "solo", views: ["solo", "solo2"], toolWhitelist: ["invoke_solver"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as ScenarioPackage);
  }
  const plan: ExecutionPlan = {
    id: `plan_${opts.key}`,
    packageId: SOLO_PKG,
    key: `${opts.key}_plan`,
    version: 1,
    status: "PUBLISHED",
    steps: [{ id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "solo done" }] } }],
  } as ExecutionPlan;
  await t.repos.plans.insert(plan);
  const intent: IntentDefinition = {
    id: `intent_${opts.key}`,
    packageId: SOLO_PKG,
    key: opts.key,
    version: 1,
    status: "PUBLISHED",
    name: opts.key,
    description: "solo intent",
    examples: ["随便问问"],
    enabledViews: [opts.view],
    slots: opts.requiredObjRef
      ? [{ name: "base", type: "objectRef", required: true, refType: "Base", description: "基地", defaultFrom: "$.selectedObjects[0]" } as IntentDefinition["slots"][number]]
      : [],
    planRef: { planKey: `${opts.key}_plan`, version: "latest" },
  } as IntentDefinition;
  await t.repos.intents.insert(intent);
}

function submitSolo(t: TestApp, view: string): Promise<string> {
  return t.app
    .inject({
      method: "POST",
      url: "/api/v1/queries",
      headers: { ...debugHeaders(PLANNER) },
      payload: { packageId: SOLO_PKG, query: "随便问问", context: { view, selectedObjects: [], filters: {} } },
    })
    .then((r) => (r.json() as { taskId: string }).taskId);
}

describe("#5 单候选分类短路", () => {
  it("单候选 + 无必填槽位 → 跳过 LLM 分类，直接路径 A 完成", async () => {
    const t = await createTestApp();
    await seedSolo(t, { view: "solo", key: "solo_noslot", requiredObjRef: false });
    const before = t.llm.classifyRequests.length;
    const taskId = await submitSolo(t, "solo");
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("WORKFLOW");
    expect(t.llm.classifyRequests.length).toBe(before); // 零 LLM 分类调用
    expect(task.classification?.model).toBe("short-circuit:single-candidate");
  });

  it("安全门：单候选但必填 objectRef 槽位无选中对象（需抽取）→ 不短路，分类照常调用", async () => {
    const t = await createTestApp();
    await seedSolo(t, { view: "solo2", key: "solo_req", requiredObjRef: true });
    t.llm.queueClassification({ candidates: [{ intentKey: "solo_req", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
    const before = t.llm.classifyRequests.length;
    const taskId = await submitSolo(t, "solo2");
    await waitForTask(t, taskId);
    expect(t.llm.classifyRequests.length).toBe(before + 1); // 分类被调用（未短路）
  });
});
