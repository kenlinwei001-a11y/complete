import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, PKG, PLANNER, waitForTask, type TestApp } from "./helpers.js";
import { problemClassForIntent } from "@platform/contracts";

/**
 * 返工 · UPG-L0-COVERAGE-FILL C1 + UPG-L0-CLASSIFY-FUSE C2 + UPG-L0-SOLVER-COVERAGE C3。
 *
 * 用**原痛点问句**「常州物料齐套为什么这天越线」跑 REAL 出厂本体（pkg_battery_manufacturing 的 risk_root_cause
 * 意图·S03 examples），不自匹配同义句、不手喂合成入参：
 *   · C1：risk_root_cause 现 WORKFLOW_FIRST + 重定向 causal_attribution 求解器 → 无 LLM 时 det example-match
 *     强命中（confidence 1·高置信）→ path=WORKFLOW 直答（非 Path B）。
 *   · C2：**弱 LLM**（stub 判域外·模型不完美·非同义句·QUERY 仍是原问句）+ QOS_CLASSIFY_FUSE=1 → 融合②
 *     det-rescue 补入 risk_root_cause（脱离 Path B）→ qos_classify_fuse_rescued_total 0→1；关闸(OFF)→ 落 Path B。
 *   · C3：Path B 兜底按问题类目打点 qos_pathb_by_problemclass{class} 真出数（single choke runPathB）。
 */

const ORIGINAL_Q = "常州物料齐套为什么这天越线"; // 原痛点问句（S03·NOT S27 同义句「为什么这项经营指标越线恶化」）

function submit(t: TestApp, query: string, view = "dash"): Promise<string> {
  return t.app
    .inject({
      method: "POST",
      url: "/api/v1/queries",
      headers: { ...debugHeaders(PLANNER) },
      payload: { packageId: PKG, query, context: { view, selectedObjects: [], filters: {} } },
    })
    .then((r) => (r.json() as { taskId: string }).taskId);
}

describe("返工 C1 · 原问句直答（risk_root_cause WORKFLOW_FIRST → causal_attribution·非 Path B）", () => {
  it("无 LLM·det example-match 强命中 → path=WORKFLOW（非 AGENT）", async () => {
    const t = await createTestApp(); // 无 LLM provider（classify 返 null → 纯确定性）
    const taskId = await submit(t, ORIGINAL_Q);
    const task = await waitForTask(t, taskId);
    expect(task.classification?.candidates?.[0]?.intentKey).toBe("risk_root_cause");
    expect(task.path).not.toBe("AGENT"); // 不落 Path B agent
    // WORKFLOW_FIRST + 高置信 → 走 path-A 工作流（COMPLETED/EXECUTING·非 AWAITING 反问·base 已改 optional）
    expect(["COMPLETED", "EXECUTING_WORKFLOW"]).toContain(task.status);
    expect(task.path).toBe("WORKFLOW");
  });
});

describe("返工 C2 · 弱 LLM + QOS_CLASSIFY_FUSE 融合救回（原问句·非同义句）", () => {
  it("ON：弱 LLM 判域外 + det 强命中 → 融合救回脱离 Path B·rescued 0→1", async () => {
    const t = await createTestApp({ env: { QOS_CLASSIFY_FUSE: "1" } });
    // stub 建模一个**不完美的弱 LLM**（judge 域外·会落 Path B）——诚实标注：非真 LLM，模拟弱模型。
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const before = t.metrics.classifyFuseRescued.get();
    const taskId = await submit(t, ORIGINAL_Q);
    const task = await waitForTask(t, taskId);
    expect(t.metrics.classifyFuseRescued.get()).toBe(before + 1); // 救回真出数
    expect(task.path).not.toBe("AGENT"); // 脱离 Path B（det 补入 risk_root_cause·top=τ_low ≥ τ_low）
    expect(task.classification?.candidates?.[0]?.intentKey).toBe("risk_root_cause");
    expect(task.classification?.outOfCatalog).toBe(false); // 补入后目录内已有候选
  });

  it("OFF（关闸）：同弱 LLM 判域外 → 落 Path B（改造前系统·救回指标不动）", async () => {
    const t = await createTestApp(); // QOS_CLASSIFY_FUSE 未设
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const before = t.metrics.classifyFuseRescued.get();
    const taskId = await submit(t, ORIGINAL_Q);
    const task = await waitForTask(t, taskId);
    expect(t.metrics.classifyFuseRescued.get()).toBe(before); // 零救回
    expect(task.path).toBe("AGENT"); // LLM 判域外·关闸不救 → Path B agent
  });
});

describe("返工 C3 · Path B 按问题类目打点 qos_pathb_by_problemclass（single choke runPathB）", () => {
  it("弱 LLM 判域外落 Path B → 计数器按 problemClass 出数（未匹配→unknown_intent）", async () => {
    const t = await createTestApp();
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    // 用一个 det 也不强命中的问句 → 落 Path B 且 classification 无候选 → unknown_intent
    const before = t.metrics.pathBByProblemClass.get({ class: "unknown_intent" });
    const taskId = await submit(t, "xzq 无任何意图的乱码问题 998");
    await waitForTask(t, taskId);
    expect(t.metrics.pathBByProblemClass.get({ class: "unknown_intent" })).toBe(before + 1);
  });

  it("/metrics 文本导出该计数器（Prometheus 形态·label class）", async () => {
    const t = await createTestApp();
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const taskId = await submit(t, "yyq 又一个乱码没有意图 777");
    await waitForTask(t, taskId);
    const res = await t.app.inject({ method: "GET", url: "/metrics" });
    expect(res.body).toContain("qos_pathb_by_problemclass");
    expect(res.body).toMatch(/qos_pathb_by_problemclass\{class="unknown_intent"\} \d+/);
  });

  it("problemClassForIntent 归口一致（risk_root_cause → general_causal_attribution）", () => {
    expect(problemClassForIntent("risk_root_cause")).toBe("general_causal_attribution");
    expect(problemClassForIntent(undefined)).toBe("unknown_intent");
  });
});
