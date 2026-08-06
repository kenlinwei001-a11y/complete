import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { makeApp, seedBattery, invokeSolver, ADMIN, PLANNER, type TestApp } from "./helpers.js";

/**
 * 「采纳处置方案」(`adopt_mitigation`) 真让**风险曲线下降** · 效果层 SEAM（G-ACTION-NOOP-EXEC 收口）。
 *
 * 病灶：审批通过后一个字节不写（此前落假 MO 号兜底，后改为诚实失败 EXECUTOR_NOT_IMPLEMENTED）。
 * 用户在风险看板点「采纳」→ 审批链走完 → **风险曲线纹丝不动**。
 *
 * 引擎半其实一直是齐的：
 *   · `risk.ts tensionSeries(..., mitigation?: {eff,tn}, ...)` 第 tn 天起扣 eff；
 *   · `params.risk.mitigations[factor]` 每个方案自带量化 {eff,tn}；
 *   · `riskTimeline` 甚至一直在算 `card.mitigated`——但那是「**如果**采纳会怎样」的**对照曲线**，
 *     真曲线用的仍是 `tensionSeries(..., undefined, ...)`。
 * 缺的只有一样：**没有地方记录"哪个方案被真采纳了"**。本单补上 `AdoptedMitigation` 台账把两半接起来。
 *
 * ⚠ 本测的头号判据是**曲线真的变了**——不是"写了一条记录"，也不是 `ok:true`/`targetRef` 非空。
 *   后两者正是让空执行病灶活到今天的那类运输层断言。
 */

const H = 30;

interface Card {
  baseId: string;
  factor: string;
  series: number[];
  peak: number;
  crossDay: number | null;
  factorSeries: Record<string, number[]>;
  adoptedMitigation?: { planKey: string; eff: number; tn: number };
}
interface RiskOut {
  cards: Card[];
  mitigationLibrary: Record<string, { key: string; name: string; eff: number; tn: number }[]>;
}

/** 强制卡（传 base+factor → 该 pair 必出一张卡，不受"未越线则丢弃"影响）。 */
async function forcedCard(t: TestApp, base: string, factor: string): Promise<Card> {
  const res = await invokeSolver(t, "risk_timeline", { base, factor, horizon: H });
  expect(res.statusCode, res.body).toBe(200);
  const out = (res.json() as { data: RiskOut }).data;
  const card = out.cards.find((c) => c.baseId === base && c.factor === factor);
  expect(card, `risk_timeline(${base},${factor}) 未出卡：${JSON.stringify(out.cards.map((c) => [c.baseId, c.factor]))}`).toBeTruthy();
  return card!;
}

async function library(t: TestApp): Promise<RiskOut["mitigationLibrary"]> {
  const res = await invokeSolver(t, "risk_timeline", { horizon: H });
  return (res.json() as { data: RiskOut }).data.mitigationLibrary;
}

/**
 * 走**完整 S2 审批链**（建草稿 submit → 逐步审批到执行）。
 * `adopt_mitigation` 的链是 [planner, admin] 两步（battery.ts BATTERY_ACTION_TYPES），
 * 故按每步待批角色换审批人——写死"approve 一次"会在链长变化时假红/假绿。
 */
const HEADER_BY_ROLE: Record<string, Record<string, string>> = {
  planner: PLANNER,
  admin: ADMIN,
};

interface DraftView {
  id: string;
  status: string;
  approvalSteps: { seq: number; role: string; decision?: string }[];
  executionResult?: { ok?: boolean; targetRef?: string; error?: string };
}

async function adopt(t: TestApp, payload: Record<string, unknown>): Promise<DraftView> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: ADMIN,
    payload: { actionTypeKey: "adopt_mitigation", payload, submit: true },
  });
  expect(created.statusCode, created.body).toBeLessThan(300);
  const draftId = (created.json() as { draftId: string }).draftId;

  for (let guard = 0; guard < 6; guard++) {
    const cur = (await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}`, headers: ADMIN })).json() as DraftView;
    if (cur.status !== "PENDING_APPROVAL") return cur;
    const pending = cur.approvalSteps.find((s) => !s.decision);
    expect(pending, `PENDING_APPROVAL 但无待批步骤：${JSON.stringify(cur.approvalSteps)}`).toBeTruthy();
    const headers = HEADER_BY_ROLE[pending!.role];
    expect(headers, `审批链出现未覆盖角色「${pending!.role}」——补 HEADER_BY_ROLE`).toBeTruthy();
    const res = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers, payload: {} });
    expect(res.statusCode, `approve(step ${pending!.seq}/${pending!.role}) 失败：${res.body}`).toBeLessThan(300);
  }
  throw new Error("审批链未在 6 步内收敛");
}

describe("adopt_mitigation · 采纳后风险曲线**真的**下降（效果层）", () => {
  it("头号效果断言：采纳后第 tn 天及之后逐日降约 eff，第 tn 天之前逐字节不变", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 目标 pair 与方案：从**真方案库**里取（非写死数字）——tn 最大者，好让"第 tn 天之前不变"是条硬断言。
    const base = "jiangmen";
    const factor = "瓶颈工序";
    const plans = (await library(t))[factor]!;
    const plan = [...plans].sort((a, b) => b.tn - a.tn || (a.key < b.key ? -1 : 1))[0]!;
    expect(plan.tn, "选中的方案 tn 必须 >1，否则「第 tn 天之前不变」退化成空断言").toBeGreaterThan(1);
    expect(plan.eff, "选中的方案 eff 必须 >0，否则「下降」退化成空断言").toBeGreaterThan(0);

    const before = (await forcedCard(t, base, factor)).series;
    expect(before.length).toBe(H);

    const done = await adopt(t, { base, factor, planKey: plan.key });
    expect(done.status, `采纳执行失败：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    // targetRef 自证采纳了什么，且**绝不是 MO 形态**（假单号与真单号不可分辨正是 G-ACTION-NOOP-EXEC 的病灶）。
    expect(done.executionResult?.targetRef).toContain("MIT-ADOPT:");
    expect(String(done.executionResult?.targetRef)).not.toMatch(/^MO-/);

    const after = (await forcedCard(t, base, factor)).series;

    // ★★ 效果层核心：这一段红 = 「点了采纳，曲线纹丝不动」回潮。
    for (let i = 0; i < H; i++) {
      const day = i + 1;
      if (day < plan.tn) {
        expect(after[i], `第 ${day} 天（< tn=${plan.tn}）不该变：${before[i]} → ${after[i]}`).toBe(before[i]);
      } else {
        const want = Math.max(0, Math.round((before[i]! - plan.eff) * 1e4) / 1e4);
        expect(after[i], `第 ${day} 天（≥ tn=${plan.tn}）该降 ${plan.eff}：${before[i]} → ${after[i]}（期望 ${want}）`).toBeCloseTo(want, 6);
      }
    }
    // 至少有一天真的降了（防止 before 全 0 之类让上面的循环空转）。
    expect(after.some((v, i) => v < before[i]!), "整条曲线一天都没降——采纳没有任何效果").toBe(true);

    // 加性披露（R13）：卡上自证吃了哪条采纳，用户不用对着一条悄悄降下去的曲线猜原因。
    const card = await forcedCard(t, base, factor);
    expect(card.adoptedMitigation).toEqual({ planKey: plan.key, eff: plan.eff, tn: plan.tn });
    // 逐因素序列（详情面板「其余因素」）必须与卡面同口径——否则同一屏自相矛盾。
    expect(card.factorSeries[factor]).toEqual(after);
  }, 300000);

  it("未采纳的 (base,factor) 逐字节不变：同基地另一因素的曲线不动，另一基地整张卡不动", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = "jiangmen";
    const factor = "瓶颈工序";
    const otherFactorSameBase = "物料齐套";
    const otherBase = "changzhou";

    const b1 = await forcedCard(t, base, otherFactorSameBase);
    const b2 = await forcedCard(t, otherBase, factor);

    const done = await adopt(t, { base, factor, planKey: "debottleneck" });
    expect(done.status, done.executionResult?.error ?? "").toBe("EXECUTED");

    const a1 = await forcedCard(t, base, otherFactorSameBase);
    // 同基地、未采纳的那个因素：自己的曲线/峰值/越线日逐字节不变、且不挂 adoptedMitigation。
    expect(a1.series).toEqual(b1.series);
    expect(a1.peak).toBe(b1.peak);
    expect(a1.crossDay).toBe(b1.crossDay);
    expect(a1.adoptedMitigation).toBeUndefined();
    // 但它的 factorSeries[被采纳因素] **应该**跟着变（同一屏不许自相矛盾：卡面已消解、面板还是老曲线）。
    expect(a1.factorSeries[factor]).not.toEqual(b1.factorSeries[factor]);

    // 另一基地同因素：整张卡逐字节不变（采纳是 per-base 的，不许外溢）。
    const a2 = await forcedCard(t, otherBase, factor);
    expect(JSON.stringify(a2)).toBe(JSON.stringify(b2));
  }, 300000);

  it("R6 向后兼容硬锚：无任何采纳记录时 risk_timeline 输出与**采纳功能上线前**逐字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect((await t.repos.objects.listByType("demo", "AdoptedMitigation")).length, "本用例前提：零采纳记录").toBe(0);

    const res = await invokeSolver(t, "risk_timeline", {});
    const data = (res.json() as { data: unknown }).data;
    const json = JSON.stringify(data);

    // 金值来源（可复现）：在 `git stash` 掉本单全部 src 改动的**上线前代码**上，
    // 对同一路径（makeApp + seedBattery(seed=42,S) + POST /a/v1/solvers/risk_timeline/invoke {args:{}}）
    // 取 sha256(JSON.stringify(data))。改动求解器/种子数据导致本值变时，须**先确认那是有意的推演口径变更**再更新金值。
    expect(json.length, "输出长度已变 —— 无采纳时不该有任何形状变化").toBe(26466);
    expect(
      createHash("sha256").update(json).digest("hex"),
      "无采纳记录时 risk_timeline 输出与上线前不再逐字节一致（R6 向后兼容被破）",
    ).toBe("d74000467701ee4ed5023689ccd47e3f90b8dc0e3eb33bbb124a4adf00cfd935");
    // 新字段绝不在无采纳时露头（避免"多了个 key"这种静默形状漂移）。
    expect(json).not.toContain("adoptedMitigation");
  }, 300000);

  it("诚实拒绝：planKey 解不出方案 → EXECUTION_FAILED 且**没有写入任何 AdoptedMitigation**", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const done = await adopt(t, { base: "jiangmen", factor: "瓶颈工序", planKey: "不存在的方案" });
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult?.error).toContain("解不出方案");
    expect(done.executionResult?.error, "错误必须列出可选方案，否则用户无从修").toContain("debottleneck");
    // ★ 关键：宁可不写，也绝不写一个猜的 eff/tn（假数落库比不落库危险得多）。
    expect(await t.repos.objects.listByType("demo", "AdoptedMitigation")).toEqual([]);

    // 曲线也必须纹丝不动（失败是原子的）。
    const card = await forcedCard(t, "jiangmen", "瓶颈工序");
    expect(card.adoptedMitigation).toBeUndefined();
  }, 300000);

  it("诚实拒绝：factor 不在方案库 / base 解析不出 → 失败且不落库", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const badFactor = await adopt(t, { base: "jiangmen", factor: "查无此因素", planKey: "debottleneck" });
    expect(badFactor.status).toBe("EXECUTION_FAILED");
    expect(badFactor.executionResult?.error).toContain("不在处置方案库");

    // 决策内核在无头部基地时会传 "全域"——它不是一个基地，绝不能被当成某个基地写下去。
    const badBase = await adopt(t, { base: "全域", factor: "瓶颈工序", planKey: "debottleneck" });
    expect(badBase.status).toBe("EXECUTION_FAILED");
    expect(badBase.executionResult?.error).toContain("解析不出具体基地");

    expect(await t.repos.objects.listByType("demo", "AdoptedMitigation")).toEqual([]);
  }, 300000);

  it("单源不并存：改采同因素的另一方案 → 旧条 REVOKED、至多一条 ACTIVE，曲线按新方案走", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = "jiangmen";
    const factor = "瓶颈工序";
    const plans = (await library(t))[factor]!;
    const p1 = plans.find((p) => p.key === "debottleneck")!; // eff 13 tn 6
    const p2 = plans.find((p) => p.key === "reroute")!; // eff 9  tn 3
    const before = (await forcedCard(t, base, factor)).series;

    expect((await adopt(t, { base, factor, planKey: p1.key })).status).toBe("EXECUTED");
    expect((await adopt(t, { base, factor, planKey: p2.key })).status).toBe("EXECUTED");

    const objs = await t.repos.objects.listByType("demo", "AdoptedMitigation");
    const active = objs.filter((o) => o.props.status === "ACTIVE");
    expect(objs.length, "两次采纳应留两条台账（旧条保留但 REVOKED，R13 可审计）").toBe(2);
    expect(active.length, "同一 (base,factor) 至多一条 ACTIVE —— 并存会让读侧要在多条里挑，挑错即错数").toBe(1);
    expect(active[0]!.props.planKey).toBe(p2.key);
    expect(objs.find((o) => o.props.planKey === p1.key)!.props.status).toBe("REVOKED");

    // 曲线按**新**方案（p2）走，不是旧的、也不是两者叠加。
    const after = (await forcedCard(t, base, factor)).series;
    for (let i = 0; i < H; i++) {
      const day = i + 1;
      const want = day < p2.tn ? before[i]! : Math.max(0, Math.round((before[i]! - p2.eff) * 1e4) / 1e4);
      expect(after[i], `第 ${day} 天应按 ${p2.key}(eff=${p2.eff},tn=${p2.tn}) 走`).toBeCloseTo(want, 6);
    }
  }, 300000);

  it("ACTIVE 记录残缺（eff/tn 被改坏）→ 报错，不按缺省值静默消解（③ 拒绝 > 静默错数）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.repos.objects.put({
      id: "obj_adoptedmitigation_broken",
      tenantId: "demo",
      type: "AdoptedMitigation",
      props: { adoptionId: "broken", baseId: "jiangmen", factor: "瓶颈工序", planKey: "debottleneck", status: "ACTIVE" },
      origin: { type: "MANUAL" },
    });
    const res = await invokeSolver(t, "risk_timeline", { base: "jiangmen", factor: "瓶颈工序", horizon: H });
    expect(res.statusCode, "残缺采纳记录被静默跳过 → 用户以为采纳了而曲线不动（正是本单要治的病）").toBeGreaterThanOrEqual(400);
    expect(res.body).toContain("残缺");
  }, 300000);
});
