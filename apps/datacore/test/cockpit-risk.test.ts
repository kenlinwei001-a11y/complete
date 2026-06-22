import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { BN_FACTORS } from "../src/synthetic/battery.js";

/**
 * cockpit P3 · 风险看板补全：对症方案 → 工单闭环（mitigation_select 求解器对全部 7 个风险因子可用）。
 * 修复接缝 G：风险卡 factor 用全因子名（物流时长/换型损失/良率波动），方案库 canonical 取自
 * params.risk.mitigations（经 deriveExtendedArgs 注入）→ 不再有 3 个因子 unknown factor。
 */
describe("cockpit P3 · 对症方案→工单（L1）", () => {
  it("mitigation_select 对全部 7 个风险因子（BN_FACTORS）都返回方案 + 推荐 + adopt 草稿 payload", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    for (const factor of BN_FACTORS) {
      const res = await invokeSolver(t, "mitigation_select", { baseName: "常州", factor, tightness: 90 });
      expect(res.statusCode).toBe(200);
      const out = (res.json() as { data: { plans?: { key: string }[]; recommended?: string; draftPayload?: { base: string; factor: string; planKey: string }; error?: string } }).data;
      expect(out.error, `因子 ${factor} 应有方案（不再 unknown factor）`).toBeUndefined();
      expect(out.plans?.length, `因子 ${factor} 方案非空`).toBeGreaterThan(0);
      expect(out.recommended).toBeTruthy();
      // 采纳 payload 形状 = adopt_mitigation ActionType 必填 {base,factor,planKey}（工单闭环）
      expect(out.draftPayload).toMatchObject({ base: "常州", factor, planKey: out.recommended });
    }
  });

  it("采纳推荐方案 → adopt_mitigation Action 草稿（R4：真值经审批，不直改）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const sel = (await (await invokeSolver(t, "mitigation_select", { baseName: "常州", factor: "物料齐套", tightness: 95 })).json() as { data: { draftPayload: Record<string, unknown> } }).data;
    const res = await t.app.inject({
      method: "POST", url: "/a/v1/action-drafts", headers: ADMIN,
      payload: { actionTypeKey: "adopt_mitigation", payload: sel.draftPayload, origin: { userId: "usr_demo_admin" }, submit: true },
    });
    expect([200, 201]).toContain(res.statusCode);
    const draft = res.json() as { draftId: string; status: string };
    expect(draft.draftId).toBeTruthy();
    expect(["PENDING_APPROVAL", "PENDING", "SUBMITTED"]).toContain(draft.status);
  });
});
