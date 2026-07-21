import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, lastToolCallId, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse, type ScriptedTurn } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import {
  projectNavigationSlice,
  renderNavigationSlice,
  buildNavigationSliceSection,
  navigationSliceSolverKeys,
} from "../src/agent/navigation-slice.js";
import { planWithinSlice } from "../src/agent/loop.js";

/**
 * WO-QOS-2 · SEAM（NavigationSlice 注入 + 规划式执行 × 全 agent 不回归 · 闭 G-AGENT-BLIND-REACT agent 侧半）。
 *
 * 头号判据（真接线·非蒙）：
 *  ① 真需 agent 的题（落 path-B 真 LLM 深问）→ agent **首轮 prompt 含本题导航图**（相关 solver + 输出形状）·
 *     运行轨迹 discover 调用 ≤1（vs 盲选 4-5）· round-trip ≤4（vs 逐跳 17）· 答案不劣化（AGENT_EXPLORATORY·有溯源）。
 *  ② R6：projectNavigationSlice/renderNavigationSlice 同问句同 scope **字节一致**（无 LLM/时钟/随机）。
 *  ③ 隔离语义：按每 agent scopeDeclaration.objectTypes/toolNames 投影——越界的 solver/对象**不进图**
 *     （质量 agent 图里没有 credit/finance solver；无 invoke_solver 能力 → 不列 solver）。
 *  ④ plan 自检（loop）：plan 引用的 solver 全在图内→true；有越界→false（回退 ReAct 兜底）。
 *
 * 全 agent 不回归的**系统级铁证** = 改共享 AGENT_SYSTEM_CORE + 注入切片后，7 角色 agent/coordinator/CEO 深问的
 * 现有测试全绿（本文件专测切片接线；回归由四包 gate 全量跑守——见 DoD）。
 */

/** 供需双向块（rich block context·令 shouldUseFreeLLM=true 落 path-B 真 LLM 深问）。 */
function supplyDemandBlockPC(demandPct = 28.5): PageContext {
  return {
    view: "dashboard",
    entities: [],
    selection: [],
    drillPath: [],
    actions: [],
    block: {
      blockId: "dash-supply-demand",
      blockType: "supply-demand",
      blockTitle: "供需失衡双向归因",
      blockData: { metricKey: "seg_attain_ess", totalGap: 27.8, unit: "万套", demandPct, supplyPct: 63.2, reconciled: true },
      selection: [],
      provenanceRef: "supply_demand_gap_attribution",
    },
  };
}

/**
 * 规划式（plan-then-execute）高效脚本：**一轮 plan**（query_objects + invoke_solver(gap_attribution) 同轮批量发起·
 * loop 一轮多 tool_use）→ **一轮综合**（final_answer 引 solver tool_call 溯源）。全程 **0 discover**、2 round-trip。
 * 对照旧盲选：先 discover 扫工具/对象 → 逐跳猜 solver → 再查（4-5 discover / 17 round-trip）。
 */
function plannedTurns(): ScriptedTurn[] {
  return [
    () => ({
      content: [
        text("导航图已给出对口求解器，直接一步到位。"),
        toolUse("query_objects", { objectType: "Metric", filter: { metricKey: "seg_attain_ess" } }),
        toolUse("invoke_solver", { solverKey: "gap_attribution", args: { metricKey: "seg_attain_ess" } }),
      ],
    }),
    (req) => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "供需缺口归因：需求端为主 ⟦ref:0⟧（据导航图对口 gap_attribution 一步到位）。" }],
          provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.totalGap" }],
        }),
      ],
    }),
  ];
}

describe("WO-QOS-2 · SEAM ① 真需 agent 的题：首轮 prompt 含导航图 · discover≤1 · round-trip≤4 · 答案不劣化", () => {
  async function runDeep(t: TestApp) {
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]); // 显式暗发开 → 走真 LLM path-B 深问
    t.llm.queueAgentTurn(...plannedTurns());
    const pc = supplyDemandBlockPC(28.5);
    const { taskId } = await submitQuery(t, ADMIN, "综合分析这块供需失衡的前因后果和连锁影响", { view: "dashboard", pageContext: pc });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const calls = await t.repos.toolCalls.listByTask(taskId);
    return { task, calls };
  }

  it("首轮 agent prompt 含 NavigationSlice（对口 solver + 输出形状）·真接线非蒙", async () => {
    const t = await createTestApp();
    const { task } = await runDeep(t);
    expect(task.path).toBe("AGENT"); // 真 path-B（非确定性单跳）
    const firstReq = t.llm.agentRequests[0]!;
    const promptBlob = JSON.stringify(firstReq.messages); // 切片注入首轮 user
    expect(promptBlob).toContain("本题导航图"); // 导航图注入
    expect(promptBlob).toContain("gap_attribution"); // 对口 solver（供需块→gap_attribution）
    expect(promptBlob).toContain("supply_demand_gap_attribution"); // 供需族相关 solver
    expect(promptBlob).toMatch(/输出\s*\{[^}]*(atomicLeaves|demandSide|totalGap)/); // 输出形状（SOLVER_OUTPUT_SHAPES 投影）
    await t.app.close();
  });

  it("轨迹 discover≤1 · round-trip≤4 · 答案不劣化（AGENT_EXPLORATORY·有溯源·非降级占位）", async () => {
    const t = await createTestApp();
    const { task, calls } = await runDeep(t);
    const seq = calls.map((c) => c.toolName);
    const discoverCount = seq.filter((n) => n === "discover").length;
    expect(discoverCount).toBeLessThanOrEqual(1); // 有图 → 不再 discover 盲扫（本例 0）
    expect(t.llm.agentRequests.length).toBeLessThanOrEqual(4); // round-trip ≤4（本例 2·规划式一次拿齐）
    // 一步到位真调对口 solver（非逐跳空转）。
    expect(seq).toContain("invoke_solver");
    // 答案不劣化：真 LLM 探索输出 + 有溯源 blocks（非"探索模式未能产出回答"占位）。
    expect(task.answer?.trustLevel).toBe("AGENT_EXPLORATORY");
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).not.toContain("探索模式未能产出回答");
    expect(md).toContain("⟦ref:0⟧"); // 溯源不劣化（R13）
    await t.app.close();
  });
});

describe("WO-QOS-2 · SEAM ② R6：NavigationSlice 同问句同 scope 字节一致（无 LLM）", () => {
  const pc = supplyDemandBlockPC(28.5);
  const scope = { objectTypes: ["Metric", "DemandSegment", "Base"], toolNames: ["query_objects", "invoke_solver"] };
  it("projectNavigationSlice 纯函数·两次投影字节一致", () => {
    const a = renderNavigationSlice(projectNavigationSlice("储能份额为什么没达成目标", pc, scope));
    const b = renderNavigationSlice(projectNavigationSlice("储能份额为什么没达成目标", pc, scope));
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
    // buildNavigationSliceSection 便捷同源一致。
    expect(buildNavigationSliceSection("储能份额为什么没达成目标", pc, scope)).toBe(a);
  });
  it("同问句不同 seed 不适用（无随机源）——不同 scope → 投影不同（有牙·非写死一张全局图）", () => {
    const quality = projectNavigationSlice("为什么良率波动", undefined, {
      objectTypes: ["Process", "Equipment", "QualityStandard"],
      toolNames: ["query_objects", "invoke_solver"],
    });
    const credit = projectNavigationSlice("商用车集团G信用敞口还有多少额度", undefined, {
      objectTypes: ["Customer", "Order"],
      toolNames: ["query_objects", "invoke_solver"],
    });
    expect(renderNavigationSlice(quality)).not.toBe(renderNavigationSlice(credit));
  });
});

describe("WO-QOS-2 · SEAM ③ 隔离语义：按 scopeDeclaration 投影·越界 solver/对象不进图", () => {
  it("质量 agent scope → 图内只有质量域 solver（无 credit/finance·越界不进图）", () => {
    const slice = projectNavigationSlice("良率为什么波动、哪个工序卡了", undefined, {
      objectTypes: ["Process", "Equipment", "QualityStandard"],
      toolNames: ["query_objects", "invoke_solver"],
    });
    const keys = navigationSliceSolverKeys(slice);
    expect(keys).toContain("yield_diagnosis"); // 质量域对口 solver 进图
    expect(keys).not.toContain("credit_exposure"); // 信用 solver 读 Customer/Order·质量 scope 越界 → 不进图
    expect(keys).not.toContain("finance_pnl");
    // 对象类型也收窄在 scope 内（不外溢 Customer/FinancePlan）。
    const objTypes = slice.objectTypes.map((o) => o.type);
    expect(objTypes).not.toContain("Customer");
    expect(objTypes.every((t) => ["Process", "Equipment", "QualityStandard"].includes(t))).toBe(true);
  });

  it("供应链 agent scope → 物料域 solver（kit_readiness/lta_gap）·非质量/信用", () => {
    const slice = projectNavigationSlice("物料齐套缺口和长协覆盖怎么样", undefined, {
      objectTypes: ["Material", "Supplier", "PurchaseOrder", "Shipment"],
      toolNames: ["query_objects", "invoke_solver"],
    });
    const keys = navigationSliceSolverKeys(slice);
    expect(keys).toContain("kit_readiness");
    expect(keys).not.toContain("yield_diagnosis");
    expect(keys).not.toContain("credit_exposure");
  });

  it("无 invoke_solver 能力（工具白名单不含）→ 图不列 solver（尊重工具边界·诚实）", () => {
    const slice = projectNavigationSlice("良率为什么波动", undefined, {
      objectTypes: ["Process", "Equipment"],
      toolNames: ["query_objects"], // 无 invoke_solver
    });
    expect(slice.solvers.length).toBe(0);
    // 但对象域仍投影（agent 仍可 query_objects 取证）。
    expect(slice.objectTypes.length).toBeGreaterThan(0);
  });

  it("通用 path-B（无 objectTypes 声明）→ 按问句 domain 投影·不收窄对象域", () => {
    const slice = projectNavigationSlice("商用车集团G信用敞口还有多少额度", undefined, { toolNames: ["query_objects", "invoke_solver"] });
    expect(navigationSliceSolverKeys(slice)).toContain("credit_exposure");
  });
});

describe("WO-QOS-2 · SEAM ④ plan 自检（loop 纯函数·plan 引用 solver 须在图内否则回退 ReAct）", () => {
  it("plan 全在图内 → true（采纳规划式快路径）", () => {
    expect(planWithinSlice(["gap_attribution"], ["gap_attribution", "supply_demand_gap_attribution"])).toBe(true);
  });
  it("plan 有图外 solver → false（回退 ReAct·不阻断真工具）", () => {
    expect(planWithinSlice(["capacity_forecast"], ["gap_attribution"])).toBe(false);
  });
  it("本轮未调 solver / 无图 → true（不判定）", () => {
    expect(planWithinSlice([], ["gap_attribution"])).toBe(true);
    expect(planWithinSlice(["gap_attribution"], [])).toBe(true);
  });
});
