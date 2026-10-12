import { describe, expect, it } from "vitest";
import { AgentDefinitionSchema } from "../src/agentcore.js";

/**
 * WO-AGENT-KERNEL-SELECT · 契约层：AgentDefinition 增 per-agent 内核选择字段。
 *
 * 词表决策：直接复用 `AgentRunKernelSchema`（"NATIVE" | "EXTERNAL"）——与 run 归因
 * （agent-run-attribution A7/A10 断言的 run.kernel）同词，不造第三套词表
 * （"DSH" 是实现名，归因面既有词是 "EXTERNAL"；UI 标签层再译成「原生内核 / DSH」）。
 *
 * 语义：optional，缺省/缺失 ≡ 未配置（运行时回落进程 env 分叉，与现行行为逐字节一致）。
 * 红先：本测试先于 schema 改动落盘 —— 未加字段时 zod 剥未知键 ⇒ kernel 断言全红。
 */
describe("WO-AGENT-KERNEL-SELECT · AgentDefinition.kernel 契约", () => {
  const base = {
    id: "agt_kernel_contract",
    tenantId: "demo",
    key: "kernel_contract",
    version: 1,
    name: "内核契约测试",
    description: "",
    model: "",
    systemPrompt: "",
    tools: [],
    ruleBindings: { ruleKeys: "ALL_APPLICABLE" as const, mode: "POST_CHECK" as const },
    skills: [],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: [] },
    status: "PUBLISHED" as const,
  };

  it("kernel: \"EXTERNAL\" 接受并保留（选 DSH 外部运行时）", () => {
    const parsed = AgentDefinitionSchema.parse({ ...base, kernel: "EXTERNAL" });
    expect(parsed.kernel).toBe("EXTERNAL");
  });

  it("kernel: \"NATIVE\" 接受并保留（显式钉原生）", () => {
    const parsed = AgentDefinitionSchema.parse({ ...base, kernel: "NATIVE" });
    expect(parsed.kernel).toBe("NATIVE");
  });

  it("kernel 缺失 ⇒ 通过且为 undefined（缺省 ≡ 未配置，回落 env 分叉）", () => {
    const parsed = AgentDefinitionSchema.parse(base);
    expect(parsed.kernel).toBeUndefined();
  });

  it("kernel: \"DSH\"（实现名，非归因词表）⇒ 拒绝", () => {
    expect(() => AgentDefinitionSchema.parse({ ...base, kernel: "DSH" })).toThrow();
  });
});
