import { describe, expect, it } from "vitest";
import type { SkillDefinition } from "@platform/contracts";
import { createTestApp, PLANNER, TENANT, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { defaultOnKeys, FEATURE_REGISTRY } from "../src/features/registry.js";
import {
  skillOnFreeQaEnabled,
  l2DecomposeEnabled,
  multiIntentEnabled,
  optWhatifRouteEnabled,
  llmBudgetEnforceEnabled,
} from "../src/router/orchestrator.js";

/**
 * WO-DEMO-LIGHTUP-2 SEAM · **点亮 ≠ 能用**。
 *
 * datacore 侧 `demo-lightup-seam.test.ts` 证的是「seed → resolve 里有这个键」——那只是**登记**。
 * 本门证的是另一半：**拿生产 demo 那一份真实功能集去跑真编排器时，链路真的换了一条走**。
 * 两半缺一不可，而断点历来在这条接缝上（键点亮了、编排器没挂点 / 挂错路径 → 键在集合里躺着不干活）。
 *
 * ⚠ 为什么这里必须用**镜像**而不是 import 真值：`DEMO_LIGHTUP` 在 `apps/datacore/src/seed.ts`，
 * 跨 app 引源码违反 contracts-only-shared。故此处维护一份镜像，并由 ① 的 parity 断言 +
 * datacore 侧金值共同守住它不漂。
 *
 * ⚠ `dc.lazy-solver-context` 是 **DataCore 侧性能门**（AgentCore registry 不注册它，`featureEnabled`
 * 对未注册键恒真=不治理），故不在本镜像内——它的等价性由
 * `apps/datacore/test/solver-context-lazy-loading.seam.test.ts` 的 SEAM-EQ 守。
 */

/** 生产 demo 租户真实功能集（QOS 侧 13 条显式点亮 + 模板默认开）。 */
const DEMO_PROD_LIGHTUP = [
  "qos.dril-routing",
  "agent.critic",
  "ceo.free-llm",
  "agent.coordinator",
  "qos.compose-path",
  "qos.reasoning-trace",
  "agent.escalation",
  "qos.deterministic-multi-domain",
  "qos.multi-intent-l3-coupled",
  // WO-DEMO-LIGHTUP-2
  "agent.skill-on-free-qa",
  "qos.multi-intent-l2-decompose",
  "qos.multi-intent-orchestration",
  "qos.opt-whatif-route",
] as const;

/** 刻意**不**点的暗发键——硬线拒新任务，demo 上点亮 = 用户用着用着撞墙。 */
const DELIBERATELY_NOT_LIT = ["qos.llm-budget-enforce"] as const;

const DEMO_PROD_FEATURES = [...defaultOnKeys(), ...DEMO_PROD_LIGHTUP];

const skill = (over: Partial<SkillDefinition> & { id: string; key: string; version: number }): SkillDefinition => ({
  tenantId: TENANT,
  name: `技能 ${over.key}`,
  summary: `摘要 ${over.key} v${over.version}`,
  body: `正文 ${over.key} v${over.version}`,
  resources: [],
  status: "PUBLISHED",
  ...over,
});

describe("WO-DEMO-LIGHTUP-2 · 生产 demo 功能集 → 真编排器（点亮≠能用）", () => {
  it("① parity：镜像里每个键都在 AgentCore registry 且 defaultOn:false（暗发·只经显式 override 开）", () => {
    for (const key of [...DEMO_PROD_LIGHTUP, ...DELIBERATELY_NOT_LIT]) {
      const def = FEATURE_REGISTRY.find((f) => f.key === key);
      expect(def, `${key} 必须在 AgentCore registry（双注册 parity）`).toBeDefined();
      expect(def!.defaultOn, `${key} 必须 defaultOn:false（暗发）`).toBe(false);
      expect(defaultOnKeys(), `${key} 不得随 defaultOn 顺带开`).not.toContain(key);
    }
  });

  it("② 生产集下四道新门全开、预算硬线门仍关（拿真实参跑真判据·非「有测试」）", () => {
    const set = new Set(DEMO_PROD_FEATURES);
    expect(skillOnFreeQaEnabled(set), "agent.skill-on-free-qa 应在生产集下为开").toBe(true);
    expect(l2DecomposeEnabled(set), "qos.multi-intent-l2-decompose 应在生产集下为开").toBe(true);
    expect(multiIntentEnabled(set), "qos.multi-intent-orchestration 应在生产集下为开").toBe(true);
    expect(optWhatifRouteEnabled(set), "qos.opt-whatif-route 应在生产集下为开").toBe(true);
    expect(llmBudgetEnforceEnabled(set), "qos.llm-budget-enforce 刻意不点 → 必须关").toBe(false);
  });

  it("③ 效果层（头号）：生产集下自由问答真挂上租户技能，load_skill 真取到全文进对话", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, DEMO_PROD_FEATURES);
    await t.repos.skills.insert(skill({ id: "skl_prod", key: "prod_sop", version: 1, body: "正文含暗号 LIGHTUP2-9527" }));

    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [toolUse("load_skill", { skillId: "skl_prod" })] }, (req) => {
      // 第二轮：技能全文已进对话 —— 这才是「真被用上」，不是「工具挂上了」。
      expect(JSON.stringify(req.messages)).toContain("LIGHTUP2-9527");
      return { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "已按技能作答。" }], provenance: [] })] };
    });

    const { taskId } = await submitQuery(t, PLANNER, "随便聊聊，你能怎么帮我", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.path).toBe("AGENT");

    const req0 = t.llm.agentRequests[0]!;
    expect(req0.system, "生产集下 system 必须含技能段").toContain("可用技能");
    expect(req0.system).toContain("摘要 prod_sop");
    expect(req0.system, "全文不常驻 system（渐进披露）").not.toContain("LIGHTUP2-9527");
    expect(req0.tools.map((x) => x.name), "生产集下 load_skill 必须挂上").toContain("load_skill");

    const calls = await t.repos.toolCalls.listByTask(taskId);
    expect(calls.some((c) => c.toolName === "load_skill" && c.outcome === "OK"), "load_skill 必须真被调且成功").toBe(true);
    await t.app.close();
  });

  it("④ 对照（关态）：把 agent.skill-on-free-qa 从生产集里拿掉 → 同问句不挂 load_skill、system 无技能段", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, DEMO_PROD_FEATURES.filter((k) => k !== "agent.skill-on-free-qa"));
    await t.repos.skills.insert(skill({ id: "skl_prod", key: "prod_sop", version: 1 }));
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "答。" }], provenance: [] })] });

    const { taskId } = await submitQuery(t, PLANNER, "随便聊聊，你能怎么帮我", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);

    const req0 = t.llm.agentRequests[0]!;
    expect(req0.tools.map((x) => x.name)).not.toContain("load_skill");
    expect(req0.system).not.toContain("可用技能");
    await t.app.close();
  });
});
