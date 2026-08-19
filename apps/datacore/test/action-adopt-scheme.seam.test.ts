import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { checkedTree, factHits } from "./factlock.js";

/**
 * 「采纳经营方案」真落台账 · **效果层** SEAM（WO-ADOPT-SCHEME-CARRIER · G-ADOPT-SCHEME-NO-CARRIER 收口）。
 *
 * 病灶：该 ActionType 此前 NOT_IMPLEMENTED —— 点采纳→草稿→审批→EXECUTED 全链绿，
 * 但没有任何对象承载「方案被采纳」这件事（审批通过零写入）。
 *
 * 已接线的链路（本文件咬的接缝，一处断即红）：
 *  ① ActionDraft(采纳经营方案) → S2 审批 → domainExecutor 落 `repos.schemeAdoptions`
 *    （专用 doc-jsonb 表 scheme_adoptions · 037 迁移 · 非本体对象仓储）；
 *  ② AOP 细化读端（PlanService.aop 尾部）按 year 取本年度 ACTIVE 一条，additive optional
 *    `schemeAdoption` 下发（tenantId 不下发）；
 *  ③ 写时不变量：同 (tenantId, year) 至多一条 ACTIVE（旧 ACTIVE 先置 SUPERSEDED）；
 *  ④ 确定性 adoptionId（year|schemeNo|pathKey|outcome 全字段哈希）→ 同方案重复采纳幂等覆盖；
 *  ⑤ 业务裁定：采纳**不得**覆盖 PLAN_GOAL_TARGETS 基线（targets 只是拍板快照留痕对账）。
 *
 * 头号判据（同 action-adopt-forecast 模板的纪律）：审批后**回仓储另一条路读台账，
 * 字段必须逐个等于采纳的那份快照**。只断言 EXECUTED / targetRef 非空，正是
 * G-ACTION-NOOP-EXEC 全链绿而真值没动的形态——本文件每个用例都以读回断言收口。
 *
 * 量纲纪律（契约逐字段 @unit，抄错即金额事故）：
 *  outcome.rev=归一指数(base=100·非元) · outcome.gm=0-1小数 · outcome.share=百分数 ·
 *  outcome.turns=次/年 · outcome.cash/capex=亿元 · scores 全 0-100 ·
 *  targets.revGrowthPct=百分数 · targets.gmFloor=0-1小数（面板百分值÷100）·
 *  targets.sharePts=pct点 · targets.turnsFloor=次 · targets.capexCap/cashFloor=亿元。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** 种子确定性时间锚：BATTERY_SOLVER_PARAMS.forecastStart（battery.ts:431）—— year 2026 / adoptedAt 2026-06-10。 */
const SEED_YEAR = 2026;
const SEED_FORECAST_START = "2026-06-10";

/** 照生产者 PlanGenerateView.adoptScheme（PlanGenerateView.tsx:231-251）的真实形状构造；数值自造但量纲照契约。 */
const OUTCOME_A = { rev: 108.4, gm: 0.162, share: 18.5, turns: 6.3, cash: 62.5, capex: 8.4 };
const SCORES_A = { profit: 72.5, scale: 68, cash: 75, growth: 70, stability: 80, total: 73.2 };
const TARGETS = {
  revGrowthPct: 18, // 百分数
  gmFloor: 0.155, // 0-1 小数（面板 15.5% ÷100）
  sharePts: 2, // pct 点
  turnsFloor: 6, // 次/年
  capexCap: 10, // 亿元
  cashFloor: 50, // 亿元
  hard: { gm: true, cash: true, capex: false },
};

function schemePayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemeNo: "贰",
    pathKey: "balanced",
    scheme: { name: "均衡增长方案", outcome: OUTCOME_A, scores: SCORES_A, hardViol: [] },
    targets: TARGETS,
    year: SEED_YEAR, // 显式传，与 seed forecastStart 年份对齐（前端生产者缺省，由执行器派生同年）
    ...over,
  };
}

interface ExecOutcome {
  draftId: string;
  status: string;
  executionResult: { ok: boolean; targetRef?: string; error?: string };
}

/** 建草稿并立即提交 → 审批。返回草稿终态与执行结果（读端自证，不信 create 响应）。 */
async function createAndApprove(t: TestApp, payload: Record<string, unknown>): Promise<ExecOutcome> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: ADMIN,
    payload: { actionTypeKey: "采纳经营方案", payload, submit: true },
  });
  expect(created.statusCode, created.body).toBeLessThan(300);
  const draftId = (created.json() as { draftId: string }).draftId;
  const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
  const body = approved.json() as {
    status?: string;
    draft?: { status: string; executionResult: { ok: boolean; targetRef?: string; error?: string } };
    executionResult?: { ok: boolean; targetRef?: string; error?: string };
  };
  return {
    draftId,
    status: body.draft?.status ?? body.status ?? "",
    executionResult: body.draft?.executionResult ?? body.executionResult ?? { ok: false },
  };
}

type LedgerRow = {
  id: string;
  tenantId: string;
  adoptionId: string;
  year: number;
  schemeNo: string;
  pathKey: string;
  schemeName: string;
  outcome: Record<string, number>;
  scores: Record<string, number>;
  hardViol: string[];
  targets: Record<string, unknown>;
  adoptedAt: string;
  actionDraftId: string;
  status: "ACTIVE" | "SUPERSEDED";
};

/** 回仓储读方案采纳台账（读端走 repos 另一条路，不是执行结果自证）。 */
async function readLedger(t: TestApp): Promise<LedgerRow[]> {
  return (await t.repos.schemeAdoptions.list("demo")) as unknown as LedgerRow[];
}

async function readAop(t: TestApp, year: number): Promise<Record<string, unknown>> {
  const res = await t.app.inject({ method: "GET", url: `/a/v1/plan/aop?year=${year}`, headers: ADMIN });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Record<string, unknown>;
}

describe("采纳经营方案 · 审批后真落 scheme_adoptions 台账 + AOP 读端（非假 MO 号）", () => {
  it("头号效果断言：EXECUTED 后回仓储另一条路读，台账字段逐个 = 采纳的那份快照（targetRef 非 MO 形态）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect(await readLedger(t), "种子不应自带方案采纳台账（否则「写了/没写」不可分辨）").toHaveLength(0);

    const done = await createAndApprove(t, schemePayload());
    expect(done.status, `执行未成功：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    expect(String(done.executionResult.targetRef), "targetRef 必须是确定性采纳台账引用（刻意非 MO 形态）").toMatch(
      /^SCHEME-ADOPT:sa_[0-9a-f]+$/,
    );
    expect(String(done.executionResult.targetRef)).not.toMatch(/^MO-\d{4}/);

    // ★ 效果层：台账回了仓储，字段**逐个**等于采纳的那份快照（这条红 = 又回到全链绿而真值没动）。
    const ledger = await readLedger(t);
    expect(ledger, "审批通过但 scheme_adoptions 台账不存在 —— 空执行回潮").toHaveLength(1);
    const rec = ledger[0]!;
    const adoptionId = String(done.executionResult.targetRef).replace("SCHEME-ADOPT:", "");
    expect(rec.adoptionId).toBe(adoptionId);
    expect(rec.id).toBe(adoptionId);
    expect(rec.tenantId).toBe("demo");
    expect(rec.year).toBe(SEED_YEAR);
    expect(rec.schemeNo).toBe("贰");
    expect(rec.pathKey).toBe("balanced");
    expect(rec.schemeName).toBe("均衡增长方案");
    // outcome 六字段逐字段对拍（量纲即契约标注：rev 归一指数 / gm 0-1 / share 百分数 / turns 次 / cash、capex 亿）
    expect(rec.outcome.rev).toBe(OUTCOME_A.rev);
    expect(rec.outcome.gm).toBe(OUTCOME_A.gm);
    expect(rec.outcome.share).toBe(OUTCOME_A.share);
    expect(rec.outcome.turns).toBe(OUTCOME_A.turns);
    expect(rec.outcome.cash).toBe(OUTCOME_A.cash);
    expect(rec.outcome.capex).toBe(OUTCOME_A.capex);
    // scores 六字段逐字段对拍（全 0-100 无量纲）
    expect(rec.scores.profit).toBe(SCORES_A.profit);
    expect(rec.scores.scale).toBe(SCORES_A.scale);
    expect(rec.scores.cash).toBe(SCORES_A.cash);
    expect(rec.scores.growth).toBe(SCORES_A.growth);
    expect(rec.scores.stability).toBe(SCORES_A.stability);
    expect(rec.scores.total).toBe(SCORES_A.total);
    expect(rec.hardViol).toEqual([]);
    // targets 七字段含 hard 三布尔（拍板那一刻的目标面板快照·只供对账）
    expect(rec.targets.revGrowthPct).toBe(TARGETS.revGrowthPct);
    expect(rec.targets.gmFloor).toBe(TARGETS.gmFloor);
    expect(rec.targets.sharePts).toBe(TARGETS.sharePts);
    expect(rec.targets.turnsFloor).toBe(TARGETS.turnsFloor);
    expect(rec.targets.capexCap).toBe(TARGETS.capexCap);
    expect(rec.targets.cashFloor).toBe(TARGETS.cashFloor);
    expect(rec.targets.hard).toEqual({ gm: true, cash: true, capex: false });
    expect(rec.status).toBe("ACTIVE");
    expect(rec.actionDraftId).toBe(done.draftId);
    expect(rec.adoptedAt, "adoptedAt 必须取确定性时间锚 forecastStart 前10位（禁 Date.now·R6）").toBe(SEED_FORECAST_START);
  }, 120000);

  it("AOP 读端：采纳后 GET /plan/aop?year=2026 带 schemeAdoption（无 tenantId）；未采纳年份（1999）字段缺省", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await readAop(t, SEED_YEAR);
    expect("schemeAdoption" in before, "采纳前 AOP 响应不应带 schemeAdoption 键").toBe(false);

    const done = await createAndApprove(t, schemePayload());
    expect(done.status, `执行未成功：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    const rec = (await readLedger(t))[0]!;

    const after = await readAop(t, SEED_YEAR);
    const view = after.schemeAdoption as Record<string, unknown> | undefined;
    expect(view, "采纳后本年度 AOP 响应必须带 schemeAdoption（additive optional 读端）").toBeTruthy();
    expect(view!.adoptionId).toBe(rec.adoptionId);
    expect(view!.schemeName).toBe(rec.schemeName);
    expect(view!.outcome).toEqual(rec.outcome);
    expect(view!.year).toBe(SEED_YEAR);
    expect(view!.status).toBe("ACTIVE");
    expect("tenantId" in view!, "tenantId 不得下发（读端显式剥离）").toBe(false);

    const other = await readAop(t, 1999);
    expect("schemeAdoption" in other, "未采纳年份的 AOP 响应必须缺省 schemeAdoption 键（不是 null）").toBe(false);
  }, 120000);

  it("SUPERSEDED 轮换：同年采纳方案乙 → 方案甲置 SUPERSEDED、乙 ACTIVE，台账恰 2 条；AOP 只给乙", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const outcomeB = { rev: 96.2, gm: 0.171, share: 17.8, turns: 6.8, cash: 71.3, capex: 6.2 };
    const first = await createAndApprove(
      t,
      schemePayload({
        schemeNo: "壹",
        pathKey: "steady",
        scheme: { name: "稳健守成方案", outcome: outcomeB, scores: { ...SCORES_A, total: 70.1 }, hardViol: [] },
      }),
    );
    expect(first.status, `执行未成功：${first.executionResult?.error ?? ""}`).toBe("EXECUTED");

    const second = await createAndApprove(t, schemePayload());
    expect(second.status, `执行未成功：${second.executionResult?.error ?? ""}`).toBe("EXECUTED");

    const ledger = await readLedger(t);
    expect(ledger, "同年两次采纳不同方案 → 台账恰 2 条（一 SUPERSEDED 一 ACTIVE）").toHaveLength(2);
    const adoptionIdA = String(first.executionResult.targetRef).replace("SCHEME-ADOPT:", "");
    const adoptionIdB = String(second.executionResult.targetRef).replace("SCHEME-ADOPT:", "");
    expect(adoptionIdA, "两方案 outcome 不同 ⇒ 确定性 adoptionId 必须不同").not.toBe(adoptionIdB);
    const recA = ledger.find((r) => r.adoptionId === adoptionIdA)!;
    const recB = ledger.find((r) => r.adoptionId === adoptionIdB)!;
    expect(recA, "先采纳的方案甲必须被后一次采纳置为 SUPERSEDED（写时不变量）").toBeTruthy();
    expect(recA.status).toBe("SUPERSEDED");
    expect(recA.schemeName).toBe("稳健守成方案");
    expect(recB.status).toBe("ACTIVE");
    expect(recB.schemeName).toBe("均衡增长方案");

    // AOP 读端只给现役那条（读侧无需在多条里挑 —— 写时不变量保证至多一条 ACTIVE）。
    const view = (await readAop(t, SEED_YEAR)).schemeAdoption as Record<string, unknown> | undefined;
    expect(view?.adoptionId).toBe(adoptionIdB);
    expect(view?.schemeName).toBe("均衡增长方案");
  }, 120000);

  it("幂等：同一 payload 走两次完整审批链（两张草稿）→ 台账仍 1 条同 adoptionId 覆盖，actionDraftId 更新为第二张", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const first = await createAndApprove(t, schemePayload());
    expect(first.status, `执行未成功：${first.executionResult?.error ?? ""}`).toBe("EXECUTED");
    const second = await createAndApprove(t, schemePayload());
    expect(second.status, `执行未成功：${second.executionResult?.error ?? ""}`).toBe("EXECUTED");
    expect(second.executionResult.targetRef, "同方案重复采纳 ⇒ 确定性 adoptionId 相同（幂等覆盖）").toBe(
      first.executionResult.targetRef,
    );

    const ledger = await readLedger(t);
    expect(ledger, "同方案重复采纳不得产出重复台账（确定性 id 幂等）").toHaveLength(1);
    const rec = ledger[0]!;
    expect(rec.status, "同 adoptionId 覆盖 ⇒ 自己不得把自己置 SUPERSEDED").toBe("ACTIVE");
    expect(rec.actionDraftId, "覆盖后溯源必须指向第二张（最新那张）草稿").toBe(second.draftId);
    expect(rec.schemeName).toBe("均衡增长方案");
    expect(rec.outcome).toEqual(OUTCOME_A);
  }, 120000);

  it("诚实失败：targets 空壳过不了契约 → EXECUTION_FAILED 含「payload 不合契约」，台账零条（宁可不写不许猜）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // paramsSchema 层 targets 只要求是 object → 能过 submit；契约层（zod strict）缺字段 → 执行期诚实失败。
    const done = await createAndApprove(t, schemePayload({ targets: {} }));
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("payload 不合契约");
    expect(await readLedger(t), "失败必须原子——一字节不写").toHaveLength(0);
  }, 120000);

  it("诚实失败（类型变异）：outcome.gm 传字符串 \"0.16\"（0-1 小数被换成字符串）→ EXECUTION_FAILED，台账零条", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const bad = schemePayload({
      scheme: { name: "均衡增长方案", outcome: { ...OUTCOME_A, gm: "0.16" }, scores: SCORES_A, hardViol: [] },
    });
    const done = await createAndApprove(t, bad);
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult.error).toContain("payload 不合契约");
    expect(done.executionResult.error).toContain("scheme.outcome.gm");
    expect(await readLedger(t), "类型违反契约必须诚实失败——不许把字符串当数写下去").toHaveLength(0);
  }, 120000);

  it("基线未动：采纳后 PLAN_GOAL_TARGETS 相关读端（AOP scenarios/triggers/decomposition + PlanTarget 对象）与采纳前逐字段一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await readAop(t, SEED_YEAR);
    const targetsBefore = (await t.repos.objects.listByType("demo", "PlanTarget")).map((o) => ({ id: o.id, props: o.props }));
    expect(targetsBefore.length, "种子应带 PlanTarget（否则「没碰基线」无从分辨）").toBeGreaterThan(0);

    const done = await createAndApprove(t, schemePayload());
    expect(done.status, `执行未成功：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    expect(await readLedger(t)).toHaveLength(1);

    const after = await readAop(t, SEED_YEAR);
    // 剥掉 additive 的 schemeAdoption 段后，AOP 响应的其余部分必须与采纳前逐字节一致——
    // 证明采纳没碰 PLAN_GOAL_TARGETS 基线（业务裁定：targets 只是拍板快照，无写回路径）。
    const { schemeAdoption: _drop, ...afterRest } = after as Record<string, unknown> & { schemeAdoption?: unknown };
    expect(JSON.stringify(afterRest)).toBe(JSON.stringify(before));
    const targetsAfter = (await t.repos.objects.listByType("demo", "PlanTarget")).map((o) => ({ id: o.id, props: o.props }));
    expect(JSON.stringify(targetsAfter)).toBe(JSON.stringify(targetsBefore));
  }, 120000);

  it("R9 双实现不漂：pg.ts 的表名与 037 migration 的 CREATE TABLE 逐字相同（memory 单测证明不了这一行）", () => {
    const sql = readFileSync(join(HERE, "../migrations/037_scheme_adoptions.sql"), "utf8");
    const m = sql.match(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)\s*\(/);
    expect(m, "037 migration 里找不到 CREATE TABLE —— 那是抽取正则坏了，不是「migration 没建表」").toBeTruthy();
    const table = m?.[1] as string;
    expect(table).toBe("scheme_adoptions"); // 金丝雀：抽出来的确实是我们要的那张表（与主断言共用同一份抽取实现）

    // 事实锚（同 enterprise-state 模板）：登记行**住在哪个文件**不是事实 —— 全树定位（搬家不红；漏登记才红）。
    const dc = checkedTree("apps/datacore/src", "PgStore", 150);
    const pgHomes = factHits(dc, `schemeAdoptions: new PgStore(pool, "${table}")`);
    expect(pgHomes, `pg 仓库没登记 schemeAdoptions: new PgStore(pool, "${table}") ⇒ 双实现漂了`).toHaveLength(1);
    // memory 侧也必须登记（漏一处即漂：接口有、pg 有、memory 无 ⇒ 测试全绿而默认实现根本没这张表）
    const memHomes = factHits(dc, /schemeAdoptions:\s*new MemStore\(\)/);
    expect(memHomes, "memory 仓库没登记 schemeAdoptions ⇒ 接口有、pg 有、memory 无 ⇒ 测试全绿而默认实现根本没这张表").toHaveLength(1);
    const ifaceHomes = factHits(dc, /schemeAdoptions:\s*Store</);
    expect(ifaceHomes, "Repos 接口没声明 schemeAdoptions ⇒ 双实现登记了也没人调得到").toHaveLength(1);
  });
});
