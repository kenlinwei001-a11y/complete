import { describe, it, expect } from "vitest";
import { OpenAICompatAdapter } from "@platform/llm-adapters";
import { buildClassifierSystem, buildClassifierUser } from "../src/agent/prompts.js";
import { seedIntentsAndPlans } from "../src/mocks/seed.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";

/**
 * A14 真 LLM 分类回归（CI 安全：仅当配了真 provider key 才跑，否则跳过——不依赖网络/凭据）。
 * 把 20 场景目录(=PRD 验收)的触发问句经**真模型**分类，断言命中期望意图，固化"真分"结果，
 * 避免只靠一次性手跑。本地/CI 跑法：
 *   KIMI_API_KEY=sk-xxx [KIMI_BASE_URL=https://api.moonshot.cn/v1] [KIMI_MODEL=kimi-k2.5] \
 *   pnpm --filter agentcore test a14-real-kimi
 * 实测（kimi-k2.5）：20/20（含 classify 剥围栏/strict:false/有界重试三处修复后稳定）。
 */
const KEY = process.env.KIMI_API_KEY;
const BASE = process.env.KIMI_BASE_URL ?? "https://api.moonshot.cn/v1";
const MODEL = process.env.KIMI_MODEL ?? "kimi-k2.5";

function buildCatalog(): string {
  const { intents } = seedIntentsAndPlans();
  return intents
    .map((i) => {
      const slotDesc = i.slots.map((s) => `${s.name}(${s.type}${s.required ? ",必填" : ""}): ${s.description}`).join("; ");
      return `- ${i.key}: ${i.description}\n  示例: ${i.examples.slice(0, 3).join(" / ")}\n  槽位: ${slotDesc || "无"}`;
    })
    .join("\n");
}

describe.skipIf(!KEY)("A14 · 真 LLM 分类比对 PRD（env-gated）", () => {
  it(
    "20 场景触发问句经真模型分类 → 命中期望意图（≥95%）",
    async () => {
      const adapter = new OpenAICompatAdapter({ apiKey: KEY, baseUrl: BASE });
      const system = buildClassifierSystem(buildCatalog());
      let correct = 0;
      const fails: string[] = [];
      for (const sc of SCENARIO_CATALOG) {
        const contextSummary = `view=${sc.view}; selected=${sc.presetContext.selectedObjects.map((o) => `${o.objectType}:${o.label ?? o.objectId}`).join(",")}`;
        const user = buildClassifierUser({ query: sc.triggerQuestion, historySummary: "（无历史）", contextSummary });
        try {
          const r = await adapter.classify({ model: MODEL, system, user });
          const top = r.candidates?.[0]?.intentKey ?? (r.outOfCatalog ? "OUT_OF_CATALOG" : "none");
          if (top === sc.intentKey) correct++;
          else fails.push(`${sc.sNo}: 期望 ${sc.intentKey} 得 ${top}`);
        } catch (e) {
          fails.push(`${sc.sNo}: THREW ${String((e as Error)?.message ?? e).slice(0, 50)}`);
        }
      }
      // eslint-disable-next-line no-console
      console.log(`[A14-REAL] 真分 ${correct}/${SCENARIO_CATALOG.length}` + (fails.length ? "  ✗ " + fails.join(" | ") : ""));
      expect(correct).toBeGreaterThanOrEqual(Math.ceil(SCENARIO_CATALOG.length * 0.95)); // ≥19/20；实测 20/20
    },
    600_000,
  );
});
