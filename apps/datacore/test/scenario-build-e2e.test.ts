import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import type { LlmComprehendOutput } from "../src/databuilder/comprehend.js";

/**
 * PRD-fde §3.4 端到端：建域真用 FK 一致 + 场景拓扑 → 物化出的对象里"瓶颈真实存在"。
 *
 * 故事脚本（~100 字）：客户问"C、D 两单的共享瓶颈"。绑 Kimi 后 comprehend 产出 Process/Order + 场景拓扑
 * (订单共享 1 道工序、产能植成 10)。建域走 rawin(generateRelatedDatasets+applyScenarioTopology)→ 物化。
 * 验证:**建好的 Order 对象的 procRef 真的全指向同一个真实 Process**(瓶颈在对象图里真实存在,求解器找得出),
 * 且 Process.capacity=10(产能瓶颈值)。不是纯函数级,是端到端 POST 建域后查物化对象。
 */
const KIMI: LlmComprehendOutput = {
  objectTypes: [
    { typeKey: "Proc", displayName: "工序", domain: "process", fields: [{ name: "procId", dataType: "string", isPrimaryKey: true }, { name: "capacity", dataType: "number" }] },
    { typeKey: "Ord", displayName: "订单", domain: "sales", fields: [{ name: "so", dataType: "string", isPrimaryKey: true }, { name: "procRef", dataType: "ref", refToTypeKey: "Proc" }, { name: "qty", dataType: "number" }] },
  ],
  rules: [],
  solverNeeds: [],
  scenarioTopology: {
    sharedResources: [{ resourceType: "Proc", sharedByType: "Ord", viaField: "procRef", count: 1 }],
    plantedValues: [{ typeKey: "Proc", field: "capacity", value: 10, everyN: 1 }],
  },
};

describe("PRD-fde §3.4 · 场景拓扑端到端（物化对象里瓶颈真实存在）", () => {
  it("绑 Kimi(脚本化)+场景拓扑 → 建域后 Order 对象全共享同一 Process,产能=10", async () => {
    const t: TestApp = await makeApp({ env: { DC_COMPREHEND_DETERMINISTIC: "0" } }); // 测真 LLM comprehend 路（Kimi 脚本化）
    t.llm.enqueue(KIMI as unknown as Record<string, unknown>);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: "C、D 两客户扩产订单的共享工序瓶颈与降级", seed: 42 } });
    expect((res.json() as { status: string }).status).toBe("SUCCEEDED");

    // 查物化对象:Order 全部共享同一 Process(瓶颈真实存在)
    const orders = await t.repos.objects.listByType("demo", "Ord");
    const procs = await t.repos.objects.listByType("demo", "Proc");
    expect(orders.length).toBeGreaterThan(1);
    expect(procs.length).toBeGreaterThan(0);
    const refs = new Set(orders.map((o) => o.props.procRef));
    expect(refs.size).toBe(1); // 所有订单挤同一道工序
    const sharedProc = [...refs][0];
    expect(procs.some((p) => p.props.procId === sharedProc)).toBe(true); // 且是真实存在的 Process(FK 闭合)
    // 产能被植成瓶颈值
    expect(procs.every((p) => Number(p.props.capacity) === 10)).toBe(true);
    // 需求和 > 产能 → 瓶颈真实(求解器能判)
    const demand = orders.reduce((s, o) => s + Number(o.props.qty), 0);
    expect(demand).toBeGreaterThan(10);
  });
});
