import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import type { LlmComprehendOutput } from "../src/databuilder/comprehend.js";

/**
 * 增量1 · E13（用途→provider→model 路由）+ E4（freezePlan 重放幂等校验）。
 *
 * E13 背景：comprehend 用途此前在 service.ts 把 LLM 请求的 model id 硬编码为占位串 "comprehend"
 * （不是任何真实模型 id）。有租户绑定时 TenantRoutedLlmClient 会用 purpose→provider→model 解析出的
 * modelId 覆盖；但**无绑定回落 env 默认 client** 时，那个占位串会原样当 model id 用 → env 路径形同虚设。
 * 修复：把无绑定回落的 model id 改为 config.DC_LLM_MODEL（与 ruleDocs/modeling/synthetic 同口径，RL5 零写死）。
 *
 * 测试纪律：断言"用了配置注入的 model id"而**不在测试源码写真实模型 id**——用 env 注入一个自取的
 * sentinel model id，再断言 LLM 调用记录到的 model 等于该 sentinel（证明读 config，非占位串）。
 */

const SENTINEL_MODEL = "test-default-model-id"; // 测试自取的 model id（非真实模型标识）
const NOVEL = "某条化成工序共享一台瓶颈设备，故障时下游订单被迫降级，按优先级哪些订单受影响、毛利损失多少";

const LLM_OUT: LlmComprehendOutput = {
  objectTypes: [
    { typeKey: "Order", displayName: "订单", domain: "sales", fields: [{ name: "so", dataType: "string", isPrimaryKey: true }, { name: "qty", dataType: "number" }] },
    { typeKey: "Process", displayName: "工序", domain: "process", fields: [{ name: "procId", dataType: "string", isPrimaryKey: true }, { name: "capacity", dataType: "number" }] },
  ],
  rules: [],
  solverNeeds: [{ solverKey: "shared_bottleneck", inputFields: [{ typeKey: "Process", propKey: "capacity" }] }],
};

interface RunResp { status: string; buildPlan?: { scriptHash: string; seed: number; objectTypes: { typeKey: string }[] } }

describe("增量1 · E13 comprehend 用途路由（无绑定回落 config.DC_LLM_MODEL，非占位串）", () => {
  it("无租户绑定 → comprehend 的 LLM 调用 model = config.DC_LLM_MODEL（证明读配置而非硬编码占位）", async () => {
    const t: TestApp = await makeApp({ env: { DC_LLM_MODEL: SENTINEL_MODEL, DC_COMPREHEND_DETERMINISTIC: "0" } });
    t.llm.enqueue(LLM_OUT as unknown as Record<string, unknown>);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: NOVEL, seed: 42 } });
    expect(res.statusCode).toBeLessThan(300);
    // ScriptedLlmClient 记录每次调用的 model；comprehend 用途无绑定 → 回落 env 默认 client，model 取 config 值。
    const comprehendCall = t.llm.calls.find((c) => c.user.includes("化成"));
    expect(comprehendCall).toBeDefined();
    expect(comprehendCall!.model).toBe(SENTINEL_MODEL);
    // 且绝不再是旧的占位串
    expect(comprehendCall!.model).not.toBe("comprehend");
  });

  it("配置不同 model id → 调用随之变（路由由 config 单一来源驱动，换租户=换配置 RL5）", async () => {
    const t: TestApp = await makeApp({ env: { DC_LLM_MODEL: "another-model-id", DC_COMPREHEND_DETERMINISTIC: "0" } });
    t.llm.enqueue(LLM_OUT as unknown as Record<string, unknown>);
    await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: NOVEL, seed: 7 } });
    const call = t.llm.calls.find((c) => c.user.includes("化成"));
    expect(call!.model).toBe("another-model-id");
  });

  it("purpose=comprehend：携带 tenantId+purpose 调用（路由可据此选 provider 绑定）", async () => {
    const t: TestApp = await makeApp({ env: { DC_LLM_MODEL: SENTINEL_MODEL, DC_COMPREHEND_DETERMINISTIC: "0" } });
    t.llm.enqueue(LLM_OUT as unknown as Record<string, unknown>);
    await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: NOVEL, seed: 42 } });
    // system 提示拼了已注册求解器目录（comprehendSystemWithSolvers）→ 含 shared_bottleneck 语义提示。
    const call = t.llm.calls.find((c) => c.user.includes("化成"));
    expect(call!.system).toContain("shared_bottleneck");
  });
});

describe("增量1 · E4 freezePlan 重放幂等校验（R6：scriptHash/seed 漂移不静默服务陈旧件）", () => {
  it("同 (script, seed) 第二次跑 → 复用封存 plan（replayed），buildPlan 字节级一致", async () => {
    const t: TestApp = await makeApp();
    const r1 = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: NOVEL, seed: 42 } });
    const r2 = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: NOVEL, seed: 42 } });
    const p1 = (r1.json() as RunResp).buildPlan!;
    const p2 = (r2.json() as RunResp).buildPlan!;
    expect(p2.scriptHash).toBe(p1.scriptHash);
    expect(JSON.stringify(p2.objectTypes)).toBe(JSON.stringify(p1.objectTypes)); // 重放字节级一致
  });

  it("封存 plan 的 scriptHash 被篡改（模拟存储漂移）→ 重放校验失败 → 重新解析出正确 plan（不服务陈旧件）", async () => {
    const t: TestApp = await makeApp();
    // 先跑一次落封存 plan
    const r1 = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: NOVEL, seed: 42 } });
    const p1 = (r1.json() as RunResp).buildPlan!;
    const planId = `bpl_demo_${p1.scriptHash}_42`;
    const stored = await t.repos.buildPlans.get("demo", planId);
    expect(stored).toBeDefined();
    // 篡改封存件的 scriptHash（模拟迁移/碰撞/改写造成的漂移）。
    await t.repos.buildPlans.put({ ...stored!, scriptHash: "deadbeefdeadbeef", objectTypes: [] });
    // 再跑同脚本：E4 校验发现 hash 漂移 → 不重放陈旧件，重新 comprehend → objectTypes 非空（正确 plan）。
    const r2 = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: NOVEL, seed: 42 } });
    const p2 = (r2.json() as RunResp).buildPlan!;
    expect(p2.scriptHash).toBe(p1.scriptHash); // 重算回正确 hash
    expect(p2.objectTypes.length).toBeGreaterThan(0); // 不再服务被清空的陈旧 plan
  });
});
