import { describe, expect, it } from "vitest";
import { ADMIN, createTestApp, debugHeaders, TENANT, type TestApp } from "./helpers.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { toolUse } from "../src/llm/mock.js";
import { BudgetTracker } from "../src/tools/budget.js";

/**
 * WO-CLOSE-NATIVE-GAPS · SEAM：**旧内核退役**在 agent 配置面 + 执行面上的三条判据。
 *
 * 仓主 2026-10-09：「把旧内核今天还剩四个入口都调整为 DSH，替代旧内核」+「都改掉，不考虑回退」。
 * 本文件守的命题（三条，任一条漏即旧内核仍有入口）：
 *   ① **新建 agent（`POST /b/v1/agents`）缺省落 DSH**：不传 `kernel` ⇒ 落库值 = `"EXTERNAL"`，
 *      执行面 `run.kernel === "EXTERNAL"`（装配位 = DSH）。这是「租户自建/脚手架产出的 agent
 *      不带 kernel 字段 ⇒ 回落旧内核」那一格的收口判据。
 *   ② **显式 `"NATIVE"` 被拒**：写侧 400 + 错误原文（读端不许静默接受一个已退役的取值）。
 *   ③ **反向金丝雀**：把落库 agent 的 `kernel` 字段**改坏/删掉**，读数**不变** ——
 *      证明缺省是 DSH，而不是「又回落了旧内核」（字段不再是判据）。
 *
 * 为什么落在 API + 真引擎：`kernel` 是**数据**驱动的（今天的病正是「数据里没有 ⇒ 谁都不管」），
 * 只测引擎函数会漏掉写侧；只测写侧会漏掉「写对了但执行面不读」。两半一起断言。
 * ⚠ 产品 composition root（`main.ts` → `wireDeps`）恒不传 `agentKernelRuntime`（= DSH）；
 * 本文件里出现的 `"inprocess"` 是**测试装配**，与 `createTestApp` 注剧本 LLM 同一性质
 * （见 helpers 的 `resolveTestKernelRuntime` 头注）。执行面两臂各验一次：
 * 缺省（进程内循环 ⇒ NATIVE）与装配位=DSH（⇒ EXTERNAL）。
 */

const agentPayload = (key: string, overrides: Record<string, unknown> = {}) => ({
  key,
  name: `agent ${key}`,
  description: "retire-seam",
  model: "claude-opus-4-8",
  systemPrompt: "你是内核退役接缝测试助手",
  tools: [{ kind: "BUILTIN", name: "query_objects" }],
  ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
  skills: [],
  mcpServers: [],
  scopeDeclaration: { objectTypes: ["Order"], toolNames: ["query_objects"] },
  budget: { maxIterations: 4 },
  ...overrides,
});

async function postAgent(t: TestApp, key: string, overrides: Record<string, unknown> = {}) {
  return t.app.inject({
    method: "POST",
    url: "/b/v1/agents",
    headers: debugHeaders(ADMIN),
    payload: agentPayload(key, overrides),
  });
}

describe("WO-CLOSE-NATIVE-GAPS · agent 内核字段退役（写侧 + 执行面）", () => {
  it("① 新建 agent 不传 kernel ⇒ 落库 EXTERNAL（缺省落 DSH，不再回落旧内核）", async () => {
    const t = await createTestApp();
    const res = await postAgent(t, "retire_default");
    expect(res.statusCode).toBe(201);
    const created = res.json() as { id: string; kernel?: string };
    expect(created.kernel, "缺省必须是 EXTERNAL（DSH），不是 undefined（旧形态：undefined ⇒ 回落 env）").toBe("EXTERNAL");

    // 读回（仓储）与响应一致：写侧收口不是只改了回包。
    const stored = await t.repos.agents.get(created.id);
    expect(stored?.kernel).toBe("EXTERNAL");
  });

  it("② 显式传 kernel:\"NATIVE\" ⇒ 400 + 错误原文（写侧拒已退役取值）", async () => {
    const t = await createTestApp();
    const res = await postAgent(t, "retire_native", { kernel: "NATIVE" });
    expect(res.statusCode, "旧回退开关的取值自本单起不许再被接受").toBe(400);
    const body = res.json() as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(body.error?.message ?? "").toContain('kernel:"NATIVE" 已被拒');
    expect(body.error?.message ?? "").toContain("回退方式已不提供");
    // 反向对照（不许是「见 kernel 就拒」的哑门）：显式 EXTERNAL 必须照常 201。
    const ok = await postAgent(t, "retire_external", { kernel: "EXTERNAL" });
    expect(ok.statusCode).toBe(201);
    // 也不许误伤 PUT 的其它字段更新。
    const id = (ok.json() as { id: string }).id;
    const putOther = await t.app.inject({ method: "PUT", url: `/b/v1/agents/${id}`, headers: debugHeaders(ADMIN), payload: { name: "改名" } });
    expect(putOther.statusCode).toBe(200);
  });

  it("③ 反向金丝雀：把落库 agent 的 kernel 改坏/删掉 ⇒ 执行面读数**不变**（字段不是判据）", async () => {
    const t = await createTestApp();
    const res = await postAgent(t, "retire_field_gone");
    const id = (res.json() as { id: string }).id;
    const stored = await t.repos.agents.get(id);
    expect(stored).toBeTruthy();

    // 三种「改坏」形态都试（删字段 / 塞旧回退值 / 塞垃圾值）——读数必须同一个。
    const variants: (Record<string, unknown> | undefined)[] = [
      (() => { const c = { ...stored! }; delete (c as { kernel?: unknown }).kernel; return c; })(),
      { ...stored!, kernel: "NATIVE" },
      { ...stored!, kernel: "GARBAGE" },
    ];
    const seen: string[] = [];
    for (const [i, v] of variants.entries()) {
      // 直接改仓储（绕过写侧校验 = 模拟存量脏数据 / 手工改库），再走真引擎跑一次。
      await t.repos.agents.update(v as never);
      // 最小剧本：一轮 final_answer 收尾（与 agent-run-attribution 的 runEngineOnce 同形）。
      t.llm.queueAgentTurn({
        content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: `variant-${i}` }], provenance: [] })],
      });
      const run = await t.deps.engine.runRegisteredAgent({
        taskId: `task_retire_v${i}`,
        agentId: id,
        version: "latest",
        prompt: "内核退役接缝",
        ctx: { tenantId: TENANT, userId: "u-retire", roles: ["planner"] },
        nesting: { callChain: [], budget: new BudgetTracker({ maxIterations: 2 }) },
        emit: async () => {},
      });
      seen.push(String(run.run?.kernel));
    }
    // 三种脏数据的读数必须**逐字节相同**，且都 = 测试装配位（进程内循环）的那个值。
    expect(new Set(seen).size, `三种脏字段读数不一致 ⇒ 字段还在被读：${JSON.stringify(seen)}`).toBe(1);
    expect(seen[0]).toBe("NATIVE"); // 装配位 = inprocess（helpers 缺省）⇒ 进程内循环
  });

  it("③附 出厂 12 个 agent 逐个带 kernel 且全 EXTERNAL（缺省不留 undefined）", () => {
    const agents = seedRegistry().agents;
    expect(agents.length).toBeGreaterThanOrEqual(12);
    for (const a of agents) {
      expect(a.kernel, `出厂 agent「${a.key}」缺省内核不是 EXTERNAL`).toBe("EXTERNAL");
    }
  });
});
