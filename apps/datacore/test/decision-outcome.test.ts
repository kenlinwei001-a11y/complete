import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { Decision, DecisionOutcomeStat } from "@platform/contracts";
import { aggregateOutcomeStats } from "../src/decision/outcome-stats.js";

/**
 * WO-LEARNING-LOOP-FEEDBACK · 决策成效反馈闭环（建议→实测效果%→权重·仿 calibration realizedMape 元闭环·绿测试≠能用）。
 *
 * SEAM = commit 决策 → 注入外部实测 → 系统学习权重真变（端到端·非各半绿·仿 tr-dataflow TR6：输入实测→系统状态可观测改变）。
 * C1 契约 outcome+REALIZED · C2 端点真达 REALIZED · C3 effectivenessPct=realized÷Σpredicted×100 真算 · C4 decision.realized 事件 ·
 * C5 权重归集反映 effectivenessPct 差异（高效方案权重高·学习真变命门）· C6 状态机守恒（非 COMMITTED→409·跨租户 404）· C7 R6 两跑一致。
 */
const M = "seg_attain_ess";
const SVC_CTX: AuthCtx = { tenantId: "demo", userId: "u-admin", roles: ["admin"], attributes: {} };
const AT = "2026-07-18T00:00:00.000Z";

async function decisionPlayOptions(t: TestApp): Promise<{ optionId: string; closesGap: number }[]> {
  const dp = (await t.services.solvers.invoke(SVC_CTX, "decision_play", { metricKey: M })) as unknown as {
    options: { optionId: string; closesGap: number }[];
  };
  return dp.options;
}

async function createCommit(t: TestApp, chosen: string[]): Promise<Decision> {
  const dec = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } })).json() as Decision;
  return (await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN })).json() as Decision;
}

describe("WO-LEARNING-LOOP-FEEDBACK · 决策成效反馈闭环（Decision.outcome·学习权重）", () => {
  it("C1+C2+C3+C4 端到端：commit → POST /outcome(实测注入) → REALIZED·effectivenessPct 真算·decision.realized 事件", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const opts = await decisionPlayOptions(t);
    const chosen = [opts[0]!.optionId];
    const committed = await createCommit(t, chosen);
    expect(committed.status).toBe("COMMITTED");
    expect(committed.outcome).toBeNull(); // COMMITTED 前 outcome=null

    const predicted = committed.optionsRef.options.find((o) => o.optionId === chosen[0])!.closesGap;
    const realizedGapClose = Math.round(predicted * 0.8 * 100) / 100; // 外部实测：达预言的 80%（运营回填·非系统自造）

    const res = await t.app.inject({ method: "POST", url: `/a/v1/decisions/${committed.id}/outcome`, headers: ADMIN, payload: { realizedGapClose, note: "运营回填 T+30 实测" } });
    expect(res.statusCode).toBe(200);
    const realized = res.json() as Decision;
    expect(realized.status).toBe("REALIZED"); // C1+C2 状态推进
    expect(realized.outcome).not.toBeNull();
    // C3 effectivenessPct = realized ÷ Σpredicted × 100 真算（对照预言·非写死）。
    const expectedPct = Math.round((realizedGapClose / predicted) * 1000) / 10;
    expect(realized.outcome!.effectivenessPct).toBe(expectedPct);
    expect(realized.outcome!.predictedGapClose).toBe(predicted);
    expect(realized.outcome!.realizedGapClose).toBe(realizedGapClose);
    expect(realized.outcome!.note).toBe("运营回填 T+30 实测");

    // GET 得 REALIZED（一等可查·持久）。
    const got = (await t.app.inject({ method: "GET", url: `/a/v1/decisions/${committed.id}`, headers: ADMIN })).json() as Decision;
    expect(got.status).toBe("REALIZED");
    expect(got.outcome!.effectivenessPct).toBe(expectedPct);

    // C4 decision.realized 事件发出（带 effectivenessPct/realized/predicted）。
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "decision.realized");
    expect(events.length).toBe(1);
    expect(events[0]!.payload.effectivenessPct).toBe(expectedPct);
    expect(events[0]!.payload.decisionId).toBe(committed.id);
    await t.app.close();
  });

  it("C5 学习真变（命门）：两方案不同实测效果 → 权重归集反映差异（高效方案权重高）+ GET /decision-outcome-stats", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const opts = await decisionPlayOptions(t);
    const hi = opts[0]!; // 高效方案
    const lo = opts[1]!; // 低效方案

    // 方案 hi：实测达预言 100%（eff=100）；方案 lo：实测仅达 40%（eff=40）——不同 chosenOptionIds → 不同 Decision。
    const decHi = await createCommit(t, [hi.optionId]);
    await t.app.inject({ method: "POST", url: `/a/v1/decisions/${decHi.id}/outcome`, headers: ADMIN, payload: { realizedGapClose: hi.closesGap } });
    const decLo = await createCommit(t, [lo.optionId]);
    await t.app.inject({ method: "POST", url: `/a/v1/decisions/${decLo.id}/outcome`, headers: ADMIN, payload: { realizedGapClose: Math.round(lo.closesGap * 0.4 * 100) / 100 } });

    const stats = (await t.app.inject({ method: "GET", url: "/a/v1/decision-outcome-stats", headers: ADMIN })).json() as DecisionOutcomeStat[];
    const statHi = stats.find((s) => s.optionId === hi.optionId)!;
    const statLo = stats.find((s) => s.optionId === lo.optionId)!;
    expect(statHi).toBeTruthy();
    expect(statLo).toBeTruthy();
    expect(statHi.samples).toBe(1);
    expect(statLo.samples).toBe(1);
    expect(statHi.avgEffectivenessPct).toBe(100); // 实测=预言 → 100（精确锚）
    expect(statHi.weight).toBe(1);
    // 学习信号（命门）：高实测效果 → 高权重（decision_play 排序可读·非静态·反映 effectivenessPct 差异）。
    expect(statHi.avgEffectivenessPct).toBeGreaterThan(statLo.avgEffectivenessPct);
    expect(statHi.weight).toBeGreaterThan(statLo.weight);
    await t.app.close();
  });

  it("C6 状态机：非 COMMITTED 记 outcome → 409（PROPOSED 未定）+ 重复 outcome → 409（已 REALIZED）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const opts = await decisionPlayOptions(t);
    const chosen = [opts[0]!.optionId];

    // PROPOSED（未 commit）记 outcome → 409。
    const dec = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } })).json() as Decision;
    const early = await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/outcome`, headers: ADMIN, payload: { realizedGapClose: 5 } });
    expect(early.statusCode).toBe(409);

    // commit → outcome(200) → 重复 outcome → 409（已 REALIZED·非法转移）。
    await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN });
    const first = await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/outcome`, headers: ADMIN, payload: { realizedGapClose: 5 } });
    expect(first.statusCode).toBe(200);
    const dup = await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/outcome`, headers: ADMIN, payload: { realizedGapClose: 9 } });
    expect(dup.statusCode).toBe(409);
    await t.app.close();
  });

  it("C6 R2 跨租户 404：他租户记 outcome 查不到本租户 Decision", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const opts = await decisionPlayOptions(t);
    const committed = await createCommit(t, [opts[0]!.optionId]);
    const other = await t.app.inject({ method: "POST", url: `/a/v1/decisions/${committed.id}/outcome`, headers: { "x-debug-user": "acme:u:admin" }, payload: { realizedGapClose: 5 } });
    expect(other.statusCode).toBe(404);
    await t.app.close();
  });

  it("C7 R6：同输入+同 realizedAt 两跑 outcome deep-equal + aggregateOutcomeStats 纯函数确定性", async () => {
    // 全程经 service 注入 AT（createdAt/updatedAt/realizedAt 同源·无 HTTP 端点的 new Date() 墙钟）→ R6 两跑字节一致。
    const run = async (): Promise<Decision> => {
      const t = await makeApp();
      await seedBattery(t);
      const opts = await decisionPlayOptions(t);
      const chosen = [opts[0]!.optionId];
      const dec = await t.services.decisionKernel.create(SVC_CTX, { metricKey: M, chosenOptionIds: chosen }, AT);
      await t.services.decisionKernel.commit(SVC_CTX, dec.id, AT);
      const realized = await t.services.decisionKernel.recordOutcome(SVC_CTX, dec.id, { realizedGapClose: 0.45 }, AT);
      await t.app.close();
      return realized;
    };
    const a = await run();
    const b = await run();
    // R6：WO-2 新增的 outcome（realizedGapClose/predicted/effectivenessPct/realizedAt）两跑字节一致（realizedAt 注入·无内部时钟）。
    // 注：actionDraftIds 由 commit 的 newId 随机派生（既有内核属性·非本 WO 范围·故不纳入 R6 断言）。
    expect(JSON.stringify(b.outcome)).toBe(JSON.stringify(a.outcome));
    expect(a.outcome).not.toBeNull();
    expect(a.status).toBe("REALIZED");

    // 纯函数确定性（同输入两跑字节一致）。
    const s1 = aggregateOutcomeStats([a]);
    const s2 = aggregateOutcomeStats([a]);
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    expect(aggregateOutcomeStats([])).toEqual([]); // 空诚实
  });
});
