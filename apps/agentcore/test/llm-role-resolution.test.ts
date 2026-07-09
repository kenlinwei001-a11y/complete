import { describe, expect, it } from "vitest";
import { LlmSettings, type LlmRole } from "../src/llm/providers.js";

/**
 * LLM-ROLE-RESOLUTION-FIX 咬合测试：**绑定任一大类 = 完全覆盖全部用途**（用户亲定不变量）。
 * 根因：此前 roleModel 仅 compose→agent 有兜底；agent/classifier 未绑即落 env 默认（无 key）→ 鉴权失败
 * → 被误标"用途未绑定"（用户实测"已绑 classifier 仍报 agent 未绑"）。通用跨角色兜底根治。
 */

function settings(bound: Partial<Record<LlmRole, { providerKey: string; model: string }>>) {
  const repos = {
    llmBindings: {
      // eslint-disable-next-line @typescript-eslint/require-await
      get: async (_tid: string, role: LlmRole) => bound[role],
    },
  } as never;
  const config = { QOS_CLASSIFIER_MODEL: "env-classifier", QOS_AGENT_MODEL: "env-agent" } as never;
  return new LlmSettings(repos, config);
}

describe("LLM-ROLE-RESOLUTION-FIX · 跨角色通用兜底（绑任一大类即全覆盖）", () => {
  it("齿①：仅绑 classifier → agent/compose 解析到 classifier 绑定（非 env 默认·根治误报未绑定）", async () => {
    const s = settings({ classifier: { providerKey: "kimi", model: "k2" } });
    // revert 跨角色兜底 loop → agent 落 env-agent（无 key）→ 本断言塌（green→red 自证）
    expect(await s.roleModel("t1", "agent")).toBe("kimi:k2");
    expect(await s.roleModel("t1", "compose")).toBe("kimi:k2");
    expect(await s.roleModel("t1", "classifier")).toBe("kimi:k2"); // 自身绑定
  });

  it("齿②：仅绑 agent → classifier/compose 解析到 agent 绑定", async () => {
    const s = settings({ agent: { providerKey: "anthropic", model: "opus" } });
    expect(await s.roleModel("t1", "classifier")).toBe("anthropic:opus");
    expect(await s.roleModel("t1", "compose")).toBe("anthropic:opus");
  });

  it("齿③：绑定优先序 agent>classifier>compose（多绑时兜底取能力强者）", async () => {
    const s = settings({ classifier: { providerKey: "kimi", model: "k2" }, compose: { providerKey: "oai", model: "gpt" } });
    // 请求 agent（自身未绑）→ 兜底优先 classifier（在 compose 之前）
    expect(await s.roleModel("t1", "agent")).toBe("kimi:k2");
  });

  it("齿④：完全未绑任何用途 → env 默认（诚实降级·唯一真「未绑定」态）", async () => {
    const s = settings({});
    expect(await s.roleModel("t1", "classifier")).toBe("env-classifier");
    expect(await s.roleModel("t1", "agent")).toBe("env-agent");
  });

  it("齿⑤：explicit（场景包字段）恒胜过绑定与兜底", async () => {
    const s = settings({ agent: { providerKey: "anthropic", model: "opus" } });
    expect(await s.roleModel("t1", "agent", "dcp:p1:m1")).toBe("dcp:p1:m1");
  });
});
