import { describe, expect, it } from "vitest";
import { QuarterlyResponseSchema } from "@platform/contracts";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";

async function quarterly(t: TestApp, q = "?n=8") {
  const res = await t.app.inject({ method: "GET", url: `/a/v1/plan/quarterly${q}`, headers: ADMIN });
  expect(res.statusCode).toBe(200);
  return QuarterlyResponseSchema.parse(res.json());
}

describe("C2 · 季度滚动供给口径（三来源合并 + 长协 supply_risk）", () => {
  it("supply 含已批准产能项目增量×ramp（与 C1 同源）—— 投产季出现「产能增量…已批准项目爬坡投产」事件", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const body = await quarterly(t);
    // 已拍板情景=baseline（枣庄储能线 ZZ，q0=3 相对 forecastStart=2026-Q3 → 2027-Q2 起爬坡）
    const allEvents = body.rows.flatMap((r) => r.events.map((e) => e.label));
    expect(allEvents.some((l) => l.includes("产能增量") && l.includes("已批准项目爬坡投产"))).toBe(true);
    expect(allEvents.some((l) => l.includes("枣庄储能线"))).toBe(true); // 命名以 HTML 为准
    for (const r of body.rows) expect(Math.round((r.dem - r.sup) * 100) / 100).toBe(r.gap);
  });

  it("supply 含 S&OP 决议增量：定稿一个 FINAL 版本后，其月份所属季出现「S&OP 决议增量」事件且供给增加", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await quarterly(t);
    // 直接造一个 FINAL S&OP 版本（2026-08 → 2026-Q3）带 resolutions
    await t.repos.sopVersions.put({
      id: "sop_demo_c2",
      tenantId: "demo",
      month: "2026-08",
      status: "FINAL",
      inputs: {},
      steps: {},
      agenda: [],
      resolutions: [{ name: "夜班增量", delta: 1.5 }, { name: "外协", delta: 0.5 }],
      supFinal: 0,
      createdBy: "u",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
    const after = await quarterly(t);
    const q3Before = before.rows.find((r) => r.q === "2026-Q3")!;
    const q3After = after.rows.find((r) => r.q === "2026-Q3")!;
    expect(q3After.events.some((e) => e.label.includes("S&OP 决议增量"))).toBe(true);
    // 供给增加 2.0（1.5+0.5）
    expect(Math.round((q3After.sup - q3Before.sup) * 10) / 10).toBe(2.0);
  });

  it("长协偏差 |dev|>5% → scanSupplyRisk 发 supply_risk 事件（关联到货间隙/baseId）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await t.services.plan.scanSupplyRisk("demo");
    expect(r.fired.length).toBeGreaterThanOrEqual(1); // 首行强制 −8% 越线
    const events = await t.repos.outboxEvents.list("demo");
    const sr = events.filter((e) => e.event === "supply_risk");
    expect(sr.length).toBeGreaterThanOrEqual(1);
    const payload = sr[0]!.payload as { deviationPct: number; baseId: string };
    expect(Math.abs(payload.deviationPct)).toBeGreaterThan(5);
    expect(payload.baseId).toBeTruthy();
  });
});

describe("C3 · S&OP 第④步财务整合口径", () => {
  async function step123(t: TestApp): Promise<string> {
    const created = await t.app.inject({ method: "POST", url: "/a/v1/sop/versions", headers: ADMIN, payload: { month: "2026-07", inputs: { demTotal: 120 } } });
    const id = (created.json() as { id: string }).id;
    const adv = (step: number, payload: Record<string, unknown> = {}) =>
      t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/advance`, headers: ADMIN, payload: { step, payload } });
    await adv(1);
    await adv(2, { segments: [{ key: "pas", name: "乘用车", target: 60, rolling: 60, lastActual: 60 }] });
    await adv(3, {});
    return id;
  }

  it("毛利率_roll 细分加权口径：Σ(量×价×毛利率)÷Σ(量×价)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const id = await step123(t);
    // 两细分：量×价 = 100×2 + 100×1 = 300；加权毛利 = 200×0.2 + 100×0.1 = 50 → roll = 50/300 = 16.6667%
    const s4 = (
      await t.app.inject({
        method: "POST",
        url: `/a/v1/sop/versions/${id}/advance`,
        headers: ADMIN,
        payload: {
          step: 4,
          payload: {
            gmBudget: 15,
            segments: [
              { key: "A", qty: 100, price: 2, gmRate: 0.2 },
              { key: "B", qty: 100, price: 1, gmRate: 0.1 },
            ],
            cashCushion: 9999,
          },
        },
      })
    ).json() as { steps: { s4: { gmRoll: number; gmOk: boolean; segBreakdown: unknown[] } } };
    expect(s4.steps.s4.gmRoll).toBeCloseTo(16.6667, 3);
    expect(s4.steps.s4.gmOk).toBe(true); // 16.67% ≥ 15 − 0.5
    expect(s4.steps.s4.segBreakdown).toHaveLength(2);
  });

  it("现金垫 = 13 周滚动 min（期初 + Σ回款 − Σ付款 − ΣCAPEX）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const id = await step123(t);
    // 期初 60；w1 付款 20（→40），w2 回款 5（→45），…全程最低 = 40（w1）
    const s4 = (
      await t.app.inject({
        method: "POST",
        url: `/a/v1/sop/versions/${id}/advance`,
        headers: ADMIN,
        payload: {
          step: 4,
          payload: {
            revSum: 100, gmSum: 20, gmBudget: 15,
            cashflow: {
              openingCash: 60,
              payments: [20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
              receipts: [0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
              capex: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            },
          },
        },
      })
    ).json() as { steps: { s4: { cashCushion: number; cashRolling: number[]; cashOk: boolean } } };
    expect(s4.steps.s4.cashCushion).toBe(40); // 13 周最低点
    expect(s4.steps.s4.cashRolling).toHaveLength(13);
    expect(s4.steps.s4.cashOk).toBe(false); // 40 < C18 底线 50
  });

  it("④门禁两分支：毛利<预算−0.5pct 警示进⑤议程；现金垫<C18 底线阻断进入⑤", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const id = await step123(t);
    const adv = (step: number, payload: Record<string, unknown> = {}) =>
      t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/advance`, headers: ADMIN, payload: { step, payload } });
    // 毛利警示 + 现金阻断同时发生
    const s4 = (await adv(4, { revSum: 100, gmSum: 10, gmBudget: 15, cashCushion: 40 })).json() as {
      agenda: { source: string; title: string }[];
      steps: { s4: { gmOk: boolean; cashOk: boolean; pass: boolean; violations: string[] } };
    };
    expect(s4.steps.s4.gmOk).toBe(false);
    expect(s4.steps.s4.cashOk).toBe(false);
    expect(s4.steps.s4.pass).toBe(false);
    expect(s4.agenda.some((a) => a.source === "C18/财务" && a.title.includes("毛利率_roll"))).toBe(true);
    expect(s4.agenda.some((a) => a.source === "C18/财务" && a.title.includes("现金垫"))).toBe(true);
    // 现金阻断 → ⑤ 409
    expect((await adv(5, { resolutions: [] })).statusCode).toBe(409);
    // 修复财务（毛利达标 + 现金达标）→ ⑤ 通过
    await adv(4, { revSum: 100, gmSum: 16, gmBudget: 15, cashCushion: 56 });
    const s5 = await adv(5, { resolutions: [{ name: "夜班", delta: 1 }] });
    expect(s5.statusCode).toBe(200);
    expect((s5.json() as { status: string }).status).toBe("EXEC_MEETING");
  });
});
