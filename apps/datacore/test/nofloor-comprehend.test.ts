import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { AppError } from "../src/errors.js";

/**
 * WO-DB-LLM-REQUIRED-NO-FLOOR 齿（建域硬依赖 LLM·删无-LLM 静默地板降级·KILL-MOCK-RED·§6 验收）：
 *  ① FLOOR 诚实标注：DC_COMPREHEND_DETERMINISTIC=1（测试/离线）→ 建域走确定性地板·产物标 comprehendedBy:"FLOOR"；
 *  ② LLM 真理解标 LLM：绑 LLM(脚本化)真建 → comprehendedBy:"LLM"；
 *  ③ LLM 未理解出对象 → COMPREHEND_NOT_UNDERSTOOD（不落地板冒充理解·不产电池味垃圾域）；
 *  ④ LLM 调用失败（未绑/鉴权/超时）→ 诚实报错（LLM_PURPOSE_UNBOUND 等）·**不产任何 BuildPlan**（green→red 核心：
 *     旧地板路会把无 LLM 的冷链故事硬套成电池味 Order/Process/Base·现诚实拒不造错语义数据）。
 */
const COLD_CHAIN = "冷链仓储温区与货位分拣时效风险推演";

describe("WO-DB-LLM-REQUIRED-NO-FLOOR · 建域硬依赖 LLM（删地板静默降级）", () => {
  it("① DC_COMPREHEND_DETERMINISTIC=1 → 建域标 comprehendedBy:FLOOR（确定性地板·诚实非真理解）", async () => {
    const t: TestApp = await makeApp(); // helpers 默认置 "1"
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: COLD_CHAIN, seed: 42 } });
    const run = res.json() as { status: string; buildPlan?: { comprehendedBy?: string } };
    expect(run.buildPlan?.comprehendedBy).toBe("FLOOR");
  });

  it("② 绑 LLM(脚本化)真建 → comprehendedBy:LLM（真理解）", async () => {
    const t: TestApp = await makeApp({ env: { DC_COMPREHEND_DETERMINISTIC: "0" } });
    t.llm.enqueue({
      objectTypes: [
        { typeKey: "ColdZone", displayName: "温区", domain: "logistics", fields: [{ name: "zoneId", dataType: "string", isPrimaryKey: true }, { name: "tempC", dataType: "number" }] },
        { typeKey: "StorageSlot", displayName: "货位", domain: "logistics", fields: [{ name: "slotId", dataType: "string", isPrimaryKey: true }, { name: "zoneRef", dataType: "ref", refToTypeKey: "ColdZone" }] },
      ],
      rules: [],
      solverNeeds: [{ solverKey: "affected_orders", inputFields: [] }],
    } as never);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: COLD_CHAIN, seed: 42 } });
    const run = res.json() as { status: string; buildPlan?: { comprehendedBy?: string; objectTypes: { typeKey: string }[] } };
    expect(run.buildPlan?.comprehendedBy).toBe("LLM");
    // 真理解出冷链语义（温区/货位）·非电池味 Order/Process/Base（治 §1 危害）。
    const types = run.buildPlan!.objectTypes.map((x) => x.typeKey);
    expect(types).toContain("ColdZone");
    expect(types).toContain("StorageSlot");
  });

  it("③ LLM 未理解出对象（0 对象）→ COMPREHEND_NOT_UNDERSTOOD·不落地板", async () => {
    const t: TestApp = await makeApp({ env: { DC_COMPREHEND_DETERMINISTIC: "0" } });
    t.llm.enqueue({ objectTypes: [], rules: [], solverNeeds: [] } as never);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: "呃……随便写点什么", seed: 42 } });
    const run = res.json() as { status: string; error?: string; buildPlan?: unknown };
    // 诚实：不 SUCCEEDED·不产电池味地板域（error 含 COMPREHEND_NOT_UNDERSTOOD 语义）。
    expect(run.status).not.toBe("SUCCEEDED");
    expect(JSON.stringify(run)).toContain("COMPREHEND_NOT_UNDERSTOOD");
  });

  it("④ LLM 调用失败（模拟未绑/鉴权失败）→ 诚实报错·不产地板电池域（green→red 核心）", async () => {
    const t: TestApp = await makeApp({ env: { DC_COMPREHEND_DETERMINISTIC: "0" } });
    t.llm.onRequest(() => { throw new AppError("LLM_PURPOSE_UNBOUND", "用途 comprehend 未绑定 LLM provider", 400); });
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: COLD_CHAIN, seed: 42 } });
    const run = res.json() as { status: string; error?: string; buildPlan?: { objectTypes?: { typeKey: string }[] } };
    // 旧地板路：冷链故事无 LLM → 硬套电池味 Order/Process/Base（KILL-MOCK-RED 要杀的）。现：诚实拒·不产。
    expect(run.status).not.toBe("SUCCEEDED");
    expect(JSON.stringify(run)).toContain("LLM_PURPOSE_UNBOUND");
    // 绝不产电池味地板域（Process/Base 等硬套语义）。
    const types = run.buildPlan?.objectTypes?.map((x) => x.typeKey) ?? [];
    expect(types).not.toContain("Process");
    expect(types).not.toContain("Base");
  });
});
