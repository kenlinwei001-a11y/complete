import { describe, expect, it } from "vitest";
import { seedRegistry } from "../src/mocks/seed.js";

/**
 * WO-HARNESS-PROMPT（per-agent 层）· 每个 seed agent 提示词升级到七要素结构 SEAM。
 *
 * 头号判据（用户原意「重新调整**每个** agent 的提示词结构」）：不是只有共享核 AGENT_SYSTEM_CORE 有结构
 * （harness-elements.test 已测共享核），**每个 seed agent 自身 systemPrompt** 也按【角色/目标/对象域/对口能力/交卷】
 * 五要素重构。断在接缝：只测共享核不算——per-agent 漏改此门抓。
 */

const MARKERS = ["【角色】", "【目标】", "【对象域】", "【对口能力】", "【交卷】"] as const;
const promptText = (sp: unknown): string => (Array.isArray(sp) ? sp.join("\n") : String(sp ?? ""));

describe("WO-HARNESS-PROMPT · 每个 seed agent 七要素结构（per-agent·非仅共享核）", () => {
  const { agents } = seedRegistry();
  const withPrompt = agents.filter((a) => promptText(a.systemPrompt).trim().length > 0);

  it("有 systemPrompt 的 seed agent **均**含五要素标志块（每个 agent 的结构真被重构）", () => {
    expect(withPrompt.length).toBeGreaterThanOrEqual(8);
    for (const a of withPrompt) {
      const text = promptText(a.systemPrompt);
      for (const m of MARKERS) {
        expect(text, `seed agent「${a.key}」缺七要素标志「${m}」`).toContain(m);
      }
    }
  });

  it("核心业务 agent（analyst/risk_advisor/capacity_planner）五要素齐 + 求解纪律（禁自算·走 solver）", () => {
    for (const key of ["analyst", "risk_advisor", "capacity_planner"]) {
      const a = agents.find((x) => x.key === key);
      expect(a, `找不到 seed agent「${key}」`).toBeTruthy();
      const text = promptText(a!.systemPrompt);
      for (const m of MARKERS) expect(text, `「${key}」缺「${m}」`).toContain(m);
      expect(text, `「${key}」应含求解纪律（solver）`).toMatch(/solver|求解/);
    }
  });
});
