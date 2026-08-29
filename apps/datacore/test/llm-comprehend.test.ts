import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { assemblePlanBody, LlmComprehendSchema, normalizeSolverKey, type LlmComprehendOutput } from "../src/databuilder/comprehend.js";
import { SOLVER_KEYS } from "../src/solvers/service.js";

/**
 * 真 LLM 措辞容错（实测必要）：Kimi/Moonshot 即便给 json_schema 仍常用别名（name↔typeKey、
 * type↔dataType、float→number、domain 放顶层）→ 旧严格 schema 校验失败 → 静默回落地板。
 * 归一层把别名映射回严格形状，使真 LLM comprehend 全 schema 可用（实测真 Kimi 已通过）。
 */
describe("§2 LLM comprehend · 真 LLM 措辞容错归一", () => {
  it("name→typeKey / type→dataType / float→number / 顶层 domain 下放 → 严格校验通过", () => {
    const aliased = {
      domain: "capacity", // 顶层 domain（Kimi 实测形态）
      objectTypes: [
        { name: "Order", fields: [{ name: "so", type: "string", isPrimaryKey: true }, { name: "qty", type: "float" }] },
        { name: "Process", domain: "process", properties: [{ name: "procId", type: "id", isPrimaryKey: true }, { name: "cap", type: "int" }] },
      ],
      rules: [{ name: "瓶颈", expression: "Process.cap < Order.qty", scope: ["Process"] }],
      solverNeeds: [{ solver: "shared_bottleneck", inputFields: [{ type: "Process", field: "cap" }] }],
    };
    const out = LlmComprehendSchema.parse(aliased) as LlmComprehendOutput;
    expect(out.objectTypes.map((t) => t.typeKey)).toEqual(["Order", "Process"]);
    expect(out.objectTypes[0]!.domain).toBe("capacity"); // 顶层 domain 下放
    expect(out.objectTypes[1]!.domain).toBe("process"); // 自带 domain 优先
    expect(out.objectTypes[0]!.fields.map((f) => f.dataType)).toEqual(["string", "number"]); // float→number
    expect(out.objectTypes[1]!.fields.map((f) => f.dataType)).toEqual(["string", "number"]); // id→string, int→number
    expect(out.objectTypes[1]!.fields.length).toBe(2); // properties↔fields
    expect(out.rules[0]!.severity).toBe("WARN"); // 缺 severity → 默认 WARN
    expect(out.solverNeeds[0]!.solverKey).toBe("shared_bottleneck"); // solver→solverKey
    expect(out.solverNeeds[0]!.inputFields[0]).toEqual({ typeKey: "Process", propKey: "cap" });
  });
});

/**
 * 真 LLM 自造求解器名收敛（实测 5万套订单故事必要）：思维型模型即便给了已注册目录，仍会按问句语义
 * 自造 capacity_feasibility / schedule_impact 等名 → 后续闭包 SOLVER_NOT_FOUND，链路 BLOCKED。
 * normalizeSolverKey 是硬兜底：把已知同义名确定性收敛到平台真实 key，使链路闭合不依赖 LLM 措辞（R6）。
 */
describe("§2 LLM comprehend · 自造求解器名 → 已注册 key 确定性收敛", () => {
  it("capacity_feasibility→capacity_forecast / schedule_impact→affected_orders（命中且目标已注册）", () => {
    expect(normalizeSolverKey("capacity_feasibility", SOLVER_KEYS)).toBe("capacity_forecast");
    expect(normalizeSolverKey("schedule_impact", SOLVER_KEYS)).toBe("affected_orders");
    expect(normalizeSolverKey("displacement", SOLVER_KEYS)).toBe("shared_bottleneck");
    expect(normalizeSolverKey("profit_loss", SOLVER_KEYS)).toBe("margin_attribution");
  });

  it("收敛目标必须是真实注册的 solverKey（别名表不引入幽灵 key）", () => {
    for (const target of new Set(Object.values({ capacity_feasibility: "capacity_forecast", schedule_impact: "affected_orders" }))) {
      expect(SOLVER_KEYS).toContain(target);
    }
  });

  it("未命中别名 → 原样保留（仍作为自成长工单浮现，不静默吞）", () => {
    expect(normalizeSolverKey("phantom_solver", SOLVER_KEYS)).toBe("phantom_solver");
  });

  it("贯通 assemblePlanBody：自造 solverKey 在装配阶段即收敛 → 后续闭包不再 SOLVER_NOT_FOUND", () => {
    const story: LlmComprehendOutput = {
      objectTypes: [
        { typeKey: "SalesOrder", displayName: "订单", domain: "sales", fields: [{ name: "so", dataType: "string", isPrimaryKey: true }, { name: "qty", dataType: "number" }] },
        { typeKey: "ProductionLine", displayName: "产线", domain: "capacity", fields: [{ name: "lineId", dataType: "string", isPrimaryKey: true }, { name: "util", dataType: "number" }] },
      ],
      rules: [],
      solverNeeds: [
        { solverKey: "capacity_feasibility", inputFields: [{ typeKey: "ProductionLine", propKey: "util" }] },
        { solverKey: "schedule_impact", inputFields: [{ typeKey: "SalesOrder", propKey: "so" }] },
      ],
    };
    const body = assemblePlanBody(story, "5万套电芯订单提前15天能否满足、挤占哪些项目、影响哪些客户、利润损失", 42, SOLVER_KEYS);
    expect(body.solverNeeds.map((s) => s.solverKey)).toEqual(["capacity_forecast", "affected_orders"]);
    // B 栈倒推随之收敛到真实 key
    expect(body.planNeeds.map((p) => p.solverKey)).toEqual(["capacity_forecast", "affected_orders"]);
  });
});

/**
 * §2 LLM comprehend（接 Kimi）：让发动机听懂任意业务故事。LLM 只产出"听懂"的难点(对象/规则/求解器)，
 * 机械 B 栈倒推仍确定性；缺绑定/失败 → 关键词地板兜底(R6)。诚实：LLM 倒推出的求解器若系统未注册，
 * 闭包/自检照常暴露缺口(不静默假装能答)。
 *
 * 故事脚本（~100 字）：客户问"哪些工序/设备会成为共享瓶颈、哪张单会被降级、后果是什么"。绑定 Kimi 后，
 * comprehend 解析出 Process/Equipment 对象 + phantom_solver 求解器 + 降级规则 + B 栈倒推；而该求解器
 * 系统没注册 → 自检诚实报 SOLVER_NOT_FOUND（= 自成长工单），不再像确定性地板那样空心+谎报 ANSWERABLE。
 */
const NOVEL = "下季度同时吃下 C、D 两个客户的扩产订单，哪些工序/设备会成为共享瓶颈、谁会挤占谁、按当前排产规则哪张单会被降级、后果是什么？";

const KIMI_OUTPUT: LlmComprehendOutput = {
  objectTypes: [
    { typeKey: "Order", displayName: "订单", domain: "sales", fields: [{ name: "so", dataType: "string", isPrimaryKey: true }, { name: "priority", dataType: "number" }] },
    { typeKey: "Process", displayName: "工序", domain: "process", fields: [{ name: "procId", dataType: "string", isPrimaryKey: true }, { name: "name", dataType: "string" }] },
    { typeKey: "Equipment", displayName: "设备", domain: "equip", fields: [{ name: "equipId", dataType: "string", isPrimaryKey: true }, { name: "procId", dataType: "ref", refToTypeKey: "Process" }] },
  ],
  rules: [{ key: "R_DOWNGRADE", name: "排产降级红线", expression: "Order.priority < 1", scopeObjectTypes: ["Order"], severity: "WARN" }],
  solverNeeds: [{ solverKey: "phantom_solver", inputFields: [{ typeKey: "Process", propKey: "procId" }, { typeKey: "Equipment", propKey: "equipId" }] }],
};

interface RunResp { status: string; buildPlan?: { objectTypes: { typeKey: string }[]; solverNeeds: { solverKey: string; args?: Record<string, unknown> }[]; agentNeeds: { agentKey: string }[]; sliceNeeds: { sliceKey: string }[] }; gapReport?: { verdict: string; findings: { gapCode: string }[] } }

describe("§2 LLM comprehend（接 Kimi 解析任意故事）", () => {
  it("assemblePlanBody（纯函数）：LLM 三件 → 完整 plan（对象/规则/求解器 + B 栈倒推）", () => {
    const body = assemblePlanBody(KIMI_OUTPUT, NOVEL, 42);
    expect(body.objectTypes.map((t) => t.typeKey)).toEqual(["Order", "Process", "Equipment"]);
    expect(body.solverNeeds.map((s) => s.solverKey)).toEqual(["phantom_solver"]);
    // B 栈确定性倒推：每对象→切片；求解器→意图/计划/场景/agent
    expect(body.sliceNeeds.map((s) => s.sliceKey)).toContain("slice_process");
    expect(body.agentNeeds.map((a) => a.agentKey)).toContain("agt_phantom_solver");
    expect(body.intentNeeds[0]!.planRef).toBe("plan_phantom_solver");
    // 规则 scope 必须在已建对象内才保留
    expect(body.rules.map((r) => r.key)).toEqual(["R_DOWNGRADE"]);
  });

  it("绑定 Kimi（脚本化）→ 新颖故事经 LLM 倒推出 Process/Equipment + phantom_solver", async () => {
    const t: TestApp = await makeApp();
    t.llm.enqueue(KIMI_OUTPUT as unknown as Record<string, unknown>); // 模拟 Kimi 的 comprehend 结构化输出
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: NOVEL, seed: 42 } });
    const run = res.json() as RunResp;
    const bp = run.buildPlan!;
    expect(bp.objectTypes.map((x) => x.typeKey)).toContain("Process");
    expect(bp.objectTypes.map((x) => x.typeKey)).toContain("Equipment");
    expect(bp.solverNeeds.map((x) => x.solverKey)).toContain("phantom_solver");
    // 诚实：phantom_solver 系统未注册 → 自检暴露缺口（不空心、不谎报 ANSWERABLE）
    expect(run.gapReport!.verdict).toBe("BLOCKED");
    expect(run.gapReport!.findings.some((f) => f.gapCode === "SOLVER_NOT_FOUND" || f.gapCode === "NO_SLICE")).toBe(true);
  });

  it("未绑定/未脚本化 → 关键词地板兜底（A2：已认工序/设备/瓶颈，选中 shared_bottleneck 并自动倒推参数，R6）", async () => {
    const t: TestApp = await makeApp(); // 不 enqueue → routed LLM 无输出 → 抛错 → 落地板
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: NOVEL, seed: 42 } });
    const bp = (res.json() as RunResp).buildPlan!;
    // A2：地板现在听懂"工序/设备/排产"——倒推出 Process/Equipment（不再只 Order/Line/Customer）。
    const types = bp.objectTypes.map((x) => x.typeKey);
    expect(types).toContain("Process");
    expect(types).toContain("Equipment");
    // 地板选中 shared_bottleneck（瓶颈/共享/挤占/降级关键词命中）。
    expect(bp.solverNeeds.map((s) => s.solverKey)).toContain("shared_bottleneck");
    // 参数自动倒推：资源=工序、共享者=订单经 procRef、产能/需求/优先级字段对齐（无需 Kimi）。
    const sb = bp.solverNeeds.find((s) => s.solverKey === "shared_bottleneck")!;
    expect(sb.args).toMatchObject({ resourceType: "Process", sharedByType: "Order", viaField: "procRef", capacityField: "capacity", demandField: "qty", priorityField: "prio" });
  });
});
