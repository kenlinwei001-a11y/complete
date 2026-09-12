import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, lastToolCallId, ADMIN, PLANNER, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse, type ScriptedTurn } from "../src/llm/mock.js";
import { LlmEmptyResponseError, type LlmAgentRequest } from "../src/llm/types.js";
import { shouldUseFreeLLM } from "../src/router/ceo-route.js";
import { defaultOnKeys } from "../src/features/registry.js";

/**
 * WO-REAL-LLM-FREE-QUERY · SEAM（真 LLM 自由多跳 × 确定性单跳 × 指挥台跨服务·**mock 证接线非蒙**）。
 *
 * 头号判据（非"总是走 path-B"的假 mock）：
 *  ① CEO/块级开放式深问 + feature 开 → 真进 runAgentLoop·agent 循环调 **≥2 工具**（query_objects→invoke_solver→综合）；
 *  ② 同一"深问此块"带**不同 blockData** → 工具入参/答案不同（证 PageContext/BlockContext 真生效·非写死）；
 *  ③ 对比确定性分路（短问句/未开 feature）= 单跳 block-route（path A）→ 工具序列可区分（多跳 vs 单跳）；
 *  ④ 真 LLM 失败（LLM 空响应）→ 确定性兜底触发 + 诚实标降级（deterministic:*-fallback + routing.degraded）；
 *  ⑤ SEAM-指挥台：sim.commander 开 → NL「推进 N tick」（带沙盘 sessionId）→ mock agent 调 sim_tick（真打 datacore
 *     沙盘端点）→ curTick 真推进（跨服务真跑·非前端假动）。
 *
 * 暗发默认关（C6/C7）：feature 用**显式 Set**（含 ceo.free-llm / sim.commander+sim.sandbox）触发；"ALL"（mock 默认）
 * 一律不触发真 LLM 分路——既有确定性 CEO/block 测试逐字节不变。
 */

/** 供需双向块的真实渲染数据快照（不同 blockData 用于证上下文真生效）。 */
function supplyDemandBlock(demandPct: number): NonNullable<PageContext["block"]> {
  return {
    blockId: "dash-supply-demand",
    blockType: "supply-demand",
    blockTitle: "供需失衡双向归因",
    blockData: { metricKey: "seg_attain_ess", totalGap: 27.8, unit: "万套", demandPct, supplyPct: 63.2, reconciled: true },
    selection: [],
    provenanceRef: "supply_demand_gap_attribution",
  };
}
function mkBlockPC(block: NonNullable<PageContext["block"]>): PageContext {
  return { view: "dashboard", entities: [], selection: [], drillPath: [], actions: [], block };
}

/** 从 agent 请求里抽块数据字段（证工具入参真随 blockData 变·非写死）。 */
function num(req: LlmAgentRequest, key: string): number | undefined {
  const m = new RegExp(`${key}=([\\d.]+)`).exec(JSON.stringify(req.messages));
  return m ? Number(m[1]) : undefined;
}
function str(req: LlmAgentRequest, key: string): string | undefined {
  const m = new RegExp(`${key}=([a-z_]+)`).exec(JSON.stringify(req.messages));
  return m?.[1];
}

/**
 * routed 真 LLM 多跳脚本：turnA=query_objects（filter 带 blockData 派生的 demandPct）→ turnB=invoke_solver
 *（args.metricKey/demandPct 来自块）→ turnC=final_answer（引 solver tool_call 溯源）。入参**随 blockData 变**。
 */
function ceoMultiHopTurns(): ScriptedTurn[] {
  return [
    (req) => ({ content: [text("先查相关基地对象。"), toolUse("query_objects", { objectType: "Base", filter: { demandPct: num(req, "demandPct") } })] }),
    (req) => ({ content: [text("再做供需归因求解。"), toolUse("invoke_solver", { solverKey: "gap_attribution", args: { metricKey: str(req, "metricKey"), demandPct: num(req, "demandPct") } })] }),
    (req) => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: `综合供需归因：需求端贡献 ⟦ref:0⟧（据本块真实数据多跳取证）。` }],
          provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.args.metricKey" }],
        }),
      ],
    }),
  ];
}

describe("WO-REAL-LLM-FREE-QUERY · shouldUseFreeLLM 纯判定（②问句形态 + ③上下文丰富·默认关）", () => {
  const richPc = mkBlockPC(supplyDemandBlock(28.5));
  it("开放式/多跳问句 + 块上下文 → true", () => {
    expect(shouldUseFreeLLM("综合分析这块供需失衡的前因后果和连锁影响", richPc)).toBe(true);
  });
  it("长问句（≥24 字）+ 上下文 → true（长度信号）", () => {
    expect(shouldUseFreeLLM("请帮我把这块的供需缺口拆开逐层看看到底问题出在哪个环节上面", richPc)).toBe(true);
  });
  it("定式短问句（既有确定性问句）→ false（不劫持确定性默认路径）", () => {
    expect(shouldUseFreeLLM("这块什么情况", richPc)).toBe(false);
    expect(shouldUseFreeLLM("储能为什么没达标", richPc)).toBe(false);
    expect(shouldUseFreeLLM("这个根因怎么补", richPc)).toBe(false);
  });
  it("无上下文（③不满足）→ false（不冒进真 LLM）", () => {
    expect(shouldUseFreeLLM("综合分析前因后果连锁影响系统性推演", undefined)).toBe(false);
    expect(shouldUseFreeLLM("综合分析前因后果连锁影响", { view: "x", entities: [], selection: [], drillPath: [], actions: [] })).toBe(false);
  });
});

describe("WO-REAL-LLM-FREE-QUERY · SEAM ① 真 LLM 多跳 + ② 上下文真生效（routed mock·非蒙）", () => {
  async function runFreeLLM(t: TestApp, demandPct: number) {
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]); // 显式暗发开
    t.llm.queueAgentTurn(...ceoMultiHopTurns());
    const pc = mkBlockPC(supplyDemandBlock(demandPct));
    const { taskId } = await submitQuery(t, ADMIN, "综合分析这块供需失衡的前因后果和连锁影响", { view: "dashboard", pageContext: pc });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const calls = await t.repos.toolCalls.listByTask(taskId);
    return { task, calls };
  }

  it("①真进 runAgentLoop·agent 调 ≥2 工具（query_objects→invoke_solver·多跳）·path=AGENT·非确定性单跳", async () => {
    const t = await createTestApp();
    const { task, calls } = await runFreeLLM(t, 28.5);
    expect(task.path).toBe("AGENT"); // 真 LLM path-B（非 path A 单跳求解器）
    expect(task.classification?.model).toBe("agent:ceo-free-llm"); // 非 deterministic:block-route
    const seq = calls.map((c) => c.toolName);
    expect(seq).toContain("query_objects");
    expect(seq).toContain("invoke_solver");
    expect(seq.filter((n) => n === "query_objects" || n === "invoke_solver").length).toBeGreaterThanOrEqual(2); // 多跳
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    expect(task.answer?.trustLevel).toBe("AGENT_EXPLORATORY"); // 真 LLM 输出·**绝不**标"数据库事实"/VERIFIED
    await t.app.close();
  });

  it("②不同 blockData → 工具入参不同（demandPct 28.5 vs 51.4·证上下文真达工具·非写死）", async () => {
    const t1 = await createTestApp();
    const t2 = await createTestApp();
    const r1 = await runFreeLLM(t1, 28.5);
    const r2 = await runFreeLLM(t2, 51.4);
    const qo1 = r1.calls.find((c) => c.toolName === "query_objects")!.input as { filter: { demandPct: number } };
    const qo2 = r2.calls.find((c) => c.toolName === "query_objects")!.input as { filter: { demandPct: number } };
    expect(qo1.filter.demandPct).toBe(28.5);
    expect(qo2.filter.demandPct).toBe(51.4);
    expect(qo1.filter.demandPct).not.toBe(qo2.filter.demandPct); // blockData 变 → 入参变（有牙）
    const sv1 = r1.calls.find((c) => c.toolName === "invoke_solver")!.input as { args: { demandPct: number; metricKey: string } };
    expect(sv1.args.metricKey).toBe("seg_attain_ess"); // 块内 metricKey 真达 solver 入参
    expect(sv1.args.demandPct).toBe(28.5);
    await t1.app.close();
    await t2.app.close();
  });
});

describe("WO-REAL-LLM-FREE-QUERY · SEAM ③ 确定性对比可区分（多跳真 LLM vs 单跳 block-route）", () => {
  it("同一块·短定式问句（shouldUseFreeLLM=false）→ 确定性 block-route（path A 单跳·非 path B agent 循环）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]); // 即便 feature 开，短问句也不走真 LLM（gating 有牙·非"总走 path-B"）
    const pc = mkBlockPC(supplyDemandBlock(28.5));
    const { taskId } = await submitQuery(t, ADMIN, "这块什么情况", { view: "dashboard", pageContext: pc });
    const task = await waitForTask(t, taskId);
    expect(task.classification?.model).toBe("deterministic:block-route"); // 确定性单跳骨架（非 agent:ceo-free-llm）
    expect(task.path).toBe("WORKFLOW"); // path A·非 AGENT
    await t.app.close();
  });

  it("feature 关（默认 ALL）+ 开放式问句 → 仍不触发真 LLM（暗发默认关·C6 字节兼容）", async () => {
    const t = await createTestApp(); // 默认 ALL（freeLlmEnabled=false）
    const pc = mkBlockPC(supplyDemandBlock(28.5));
    const { taskId } = await submitQuery(t, ADMIN, "综合分析这块供需失衡的前因后果和连锁影响", { view: "dashboard", pageContext: pc });
    const task = await waitForTask(t, taskId);
    expect(task.classification?.model).not.toBe("agent:ceo-free-llm"); // 未开 → 落既有确定性 block-route
    expect(task.classification?.model).toBe("deterministic:block-route");
    await t.app.close();
  });
});

describe("WO-REAL-LLM-FREE-QUERY · SEAM ④ 真 LLM 失败 → 确定性兜底 + 诚实标降级", () => {
  it("LLM 空响应 → runCeoFreeLLM 捕获 → 确定性 block-route-fallback + routing.degraded 事件", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
    // 真 LLM 不可用（无 provider / 空响应）：mock agent 调用即抛。
    t.llm.queueAgentTurn(() => {
      throw new LlmEmptyResponseError("agent 用途 LLM 返回空响应（mock 模拟无 provider）");
    });
    const pc = mkBlockPC(supplyDemandBlock(28.5));
    const { taskId } = await submitQuery(t, ADMIN, "综合分析这块供需失衡的前因后果和连锁影响", { view: "dashboard", pageContext: pc });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    // 兜底真触发：确定性 block-route（诚实标 -fallback·非把兜底伪装成真 LLM）。
    expect(task.classification?.model).toBe("deterministic:block-route-fallback");
    expect(task.path).toBe("WORKFLOW"); // 落 path A 确定性求解
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    // 诚实标降级事件透出（前端据此标"确定性兜底·真 LLM 不可用"）。
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(events.some((e) => e.event === "routing.degraded")).toBe(true);
    await t.app.close();
  });
});

describe("WO-REAL-LLM-FREE-QUERY · SEAM ⑤ 指挥台 NL→sim_tick→curTick 真推进（跨服务真跑）", () => {
  it("sim.commander 开 + NL「推进两个 tick」（带沙盘 sessionId）→ agent 调 sim_tick 真打 datacore → curTick 2", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "sim.commander", "sim.sandbox"]);
    // 先建一个真沙盘会话（datacore mock sim store·与 agent 执行器同一实例）。
    const ctx = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
    const session = await t.dataCore.sim.init(ctx, { baseSnapshot: { base_cz: { util: 0.7 } }, scope: { base: "常州" } });
    const sid = session.id as string;

    // 监视 sim_tick OBO 真打到 datacore。
    let tickHit: { id: string; n: number } | undefined;
    const origTick = t.dataCore.sim.tick.bind(t.dataCore.sim);
    t.dataCore.sim.tick = async (c, id, n) => { tickHit = { id, n: n as number }; return origTick(c, id, n); };

    // routed agent：读到沙盘 sessionId → 调 sim_tick(sid, 2) → final_answer。
    t.llm.queueAgentTurn(
      (req) => {
        const m = /sessionId=(sims_[A-Za-z0-9]+)/.exec(JSON.stringify(req.messages));
        const parsedSid = m?.[1] ?? sid;
        return { content: [text("推进沙盘两个 tick。"), toolUse("sim_tick", { sessionId: parsedSid, n: 2 })] };
      },
      (req) => ({
        content: [
          toolUse("final_answer", {
            blocks: [{ type: "text", markdown: `已推进两个 tick，当前世界态见推演结果（模拟态）⟦ref:0⟧。` }],
            provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.curTick" }],
          }),
        ],
      }),
    );

    const { taskId } = await submitQuery(t, PLANNER, "把常州产能推进两个 tick 看负载", {
      view: "sim-sandbox",
      filters: { simSessionId: sid, simCurTick: "0" },
    });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT"); // 指挥台 NL 走 path-B agent（非 classifier 兜底偶然）
    expect(task.classification?.model).toBe("agent:sim-commander-nl");
    // 跨服务真跑：sim_tick 真打到 datacore·n=2。
    expect(tickHit).toEqual({ id: sid, n: 2 });
    // curTick 真推进（datacore sim store 真态变·非前端假动）。
    const world = await t.dataCore.sim.world(ctx, sid);
    expect((world as { tick: number }).tick).toBe(2);
    await t.app.close();
  });

  it("sim.commander 关 → 沙盘 NL 不走指挥台分路（暗发·R3）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, defaultOnKeys().filter((k) => k !== "sim.commander" && k !== "sim.sandbox"));
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} }); // 落 classifier → path B 普通
    t.llm.queueAgentTurn((req) => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: `无沙盘能力。` }], provenance: [] })],
      _req: req,
    }) as never);
    const { taskId } = await submitQuery(t, PLANNER, "把常州产能推进两个 tick 看负载", {
      view: "sim-sandbox",
      filters: { simSessionId: "sims_whatever" },
    });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).not.toBe("agent:sim-commander-nl"); // 关 → 不走指挥台分路
    await t.app.close();
  });
});

/**
 * WO-FIX-REASONING-CONTENT · SEAM ⑥（推理型模型 kimi-k2.6 在 agent 循环里"漏调 final_answer 收尾"的死角闭合）。
 *
 * 10 问真跑坐实：kimi-k2.6 把结论写进 reasoning_content、content 空、且不以 final_answer 收尾 → 旧行为整轮回答
 * 被丢成占位「探索模式未能产出回答」。修复接缝（适配器抢救 salvagedReasoning × 循环补一次强制 final_answer 轮）：
 *  ① 抢救轮（salvagedReasoning）→ 循环不直接降级，而是回述结论 + **强制 tool_choice=final_answer** 再逼一轮；
 *  ② 最终答案取自 final_answer 结构化收尾（可溯源），既非"把 reasoning 当散文答复"降级、更非空占位；
 *  ③ 强制**只补一次**——控制轮（普通文本终结·无 salvagedReasoning）逐字节走既有降级路径（refs/validation-trace 不回归）。
 */
describe("WO-FIX-REASONING-CONTENT · SEAM ⑥ 推理模型漏调 final_answer → 抢救+强制收尾（非空回答·非占位）", () => {
  it("reasoning 终结轮（salvagedReasoning）→ 循环补一次强制 final_answer 轮 → 答案取自 final_answer（非降级散文/占位）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
    const reasoningText = "综合分析：常州储能缺口约 12 万套，根因正极到货延迟。"; // 模型只写进 reasoning_content 的结论（漏调 final_answer）
    const groundedMd = "常州储能缺口 12 万套，建议空运正极并加开夜班 ⟦ref:0⟧。"; // 被强制轮逼出的 final_answer 结构化答案
    t.llm.queueAgentTurn(
      { content: [text(reasoningText)], salvagedReasoning: true }, // ① kimi-k2.6 在推理通道给结论、未收尾
      { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: groundedMd }], provenance: [] })] }, // ② 被强制轮逼出 final_answer
    );
    const pc = mkBlockPC(supplyDemandBlock(28.5));
    const { taskId } = await submitQuery(t, ADMIN, "综合分析这块供需失衡的前因后果和连锁影响", { view: "dashboard", pageContext: pc });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(task.path).toBe("AGENT");
    // 头号判据：答案取自 final_answer（groundedMd），而非降级散文（reasoningText）或占位。
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("建议空运正极"); // = groundedMd 特征串（final_answer 结构化收尾生效）
    expect(md).not.toContain("综合分析：常州储能缺口约"); // 非"把 reasoning 当散文答复"的降级
    expect(md).not.toContain("探索模式未能产出回答"); // 非空回答占位

    // 接缝证据：补救轮请求真带 toolChoice 强制 final_answer（真强制·非蒙）；首轮不强制。
    expect(t.llm.agentRequests[0]?.toolChoice).toBeUndefined();
    expect(t.llm.agentRequests.some((r) => r.toolChoice?.type === "tool" && r.toolChoice.name === "final_answer")).toBe(true);
    await t.app.close();
  });

  it("控制轮：普通文本终结（无 salvagedReasoning）→ 既有降级路径不变（不补强制轮·不劫持）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
    t.llm.queueAgentTurn({ content: [text("这是普通文本终结答复。")] }); // 无 salvagedReasoning → 不触发补救
    const pc = mkBlockPC(supplyDemandBlock(28.5));
    const { taskId } = await submitQuery(t, ADMIN, "综合分析这块供需失衡的前因后果和连锁影响", { view: "dashboard", pageContext: pc });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    // 仅 1 轮（无补救轮）；答案即该文本终结（既有降级路径逐字节不变）。
    expect(t.llm.agentRequests.length).toBe(1);
    expect(t.llm.agentRequests.every((r) => r.toolChoice === undefined)).toBe(true);
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("这是普通文本终结答复。");
    await t.app.close();
  });
});
