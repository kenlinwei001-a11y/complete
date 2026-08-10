import { describe, expect, it } from "vitest";
import { PLAN_GOAL_TARGETS } from "@platform/contracts";
import { makeApp, seedBattery, ADMIN, PLANNER, type TestApp } from "./helpers.js";
import { resolveDecisionPlayLever } from "../src/actions.js";
import type { AuthCtx } from "../src/domain.js";
import type { Decision } from "@platform/contracts";

/**
 * WO-ADOPT-DECISION-PLAY · 「采纳公司级战略方案」真把杠杆落到状态上 · **效果层** SEAM
 * （G-ACTION-NOOP-EXEC 最后一块拼图 · 欠账 #81/#71）。
 *
 * 缺口：`decision_play` 产出的是**公司级多杠杆战略**（缩短备份认证周期 / 长协加价格联动 / 上游自采矿），
 * 而 `params.risk.mitigations` 是**基地级战术处置**（空运补料 / 增开夜班…）。两域无真实映射，
 * 所以决策内核 commit 至今**诚实不派**——那个行为是对的。缺的是一个**语义正确**的动作类型，
 * 不是把战略方案塞进 `adopt_mitigation`（塞过去 = 台账写着"上游自采矿"、真值改的却是"空运补料"，
 * 界面上分辨不出，正是本仓刚清掉的假 MO 号换件衣服）。
 *
 * ⚠ 本测的头号判据是**杠杆真的落到了状态上、且引擎真的读到了新值**——
 *   不是 `status==="EXECUTED"`，也不是 `targetRef` 非空。后两者正是让空执行病灶活到今天的那类运输层断言。
 *
 * 三条判据（缺一即本单未完成）：
 *   ① 正向：采纳 → 指名道姓的那根杠杆从 X 变到 Y（对象真值 + 台账 + **求解器重推读到新值**）；
 *   ② 🔒 红线：同一次采纳之后 `PLAN_GOAL_TARGETS` 及其运行期派生承载**逐字节未变**（「目标不能改」）；
 *   ③ 兜底：未映射的方案（`opt-insource`·杠杆库已签留白理由）仍**诚实拒绝**，且决策内核对
 *      `adopt_mitigation` 的诚实不派**依然在**——不许静默降级到"最接近"的那条。
 */

const M = "seg_attain_ess";
const SVC_CTX: AuthCtx = { tenantId: "demo", userId: "u-admin", roles: ["admin"], attributes: {} };
const POOL_ID = "obj_backupsupplierpool_pool-cathode";

interface Option {
  optionId: string;
  label: string;
  closesGap: number;
  cost: number;
  cycleDays: number;
  provenance: { drillType?: string; drillId?: string; drillValue?: number };
}
interface DP {
  options: Option[];
  rootCause: { factorId: string };
}

const play = async (t: TestApp): Promise<DP> =>
  (await t.services.solvers.invoke(SVC_CTX, "decision_play", { metricKey: M })) as unknown as DP;

const HEADER_BY_ROLE: Record<string, Record<string, string>> = { planner: PLANNER, admin: ADMIN };

interface DraftView {
  id: string;
  status: string;
  approvalSteps: { seq: number; role: string; decision?: string }[];
  executionResult?: { ok?: boolean; targetRef?: string; error?: string };
}

/** 走**完整 S2 审批链**（建草稿 submit → 逐步审批到执行）——不绕门、不直调执行器。 */
async function adopt(t: TestApp, payload: Record<string, unknown>): Promise<DraftView> {
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: ADMIN,
    payload: { actionTypeKey: "adopt_decision_play", payload, submit: true },
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

/** 目标基线的**运行期派生承载**（红线要守的不只是那个常量，还有它落到租户参数上的那一份）。 */
async function goalCarriers(t: TestApp): Promise<string> {
  const p = (await t.services.solvers.getParams("demo")) as unknown as {
    planGenerate?: { targets?: Record<string, unknown> };
  };
  return JSON.stringify({ constant: PLAN_GOAL_TARGETS, params: p.planGenerate?.targets ?? null });
}

describe("adopt_decision_play · 采纳战略方案后杠杆**真的**落到状态上（效果层）", () => {
  it("① 正向：采纳「缩短备份供应商认证周期」→ BackupSupplierPool.certWeeks 16→8，且 decision_play 重推真读到新值", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 采纳前：从**真推演输出**里取方案与它自己指名的杠杆对象（不写死方案 id 之外的任何数字）。
    const before = await play(t);
    const opt = before.options.find((o) => o.optionId === "opt-backup-cert");
    expect(opt, `本次推演没有 opt-backup-cert：${before.options.map((o) => o.optionId).join("、")}`).toBeTruthy();
    expect(opt!.provenance.drillType).toBe("BackupSupplierPool");

    const poolBefore = await t.repos.objects.get("demo", POOL_ID);
    expect(poolBefore, "前提：备份供应池对象在库").toBeTruthy();
    const certBefore = Number(poolBefore!.props.certWeeks);
    expect(certBefore, "前提：认证周期是个真数").toBeGreaterThan(8); // 目标 8 周，起点必须高于它否则"降下来"是空断言

    const goalsBefore = await goalCarriers(t);

    const done = await adopt(t, { metricKey: M, optionIds: ["opt-backup-cert"] });
    expect(done.status, `采纳执行失败：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    // targetRef 自证「改了哪根杠杆、从多少到多少」，且**绝不是 MO 形态**（假单号与真单号不可分辨 = G-ACTION-NOOP-EXEC 病灶）。
    expect(done.executionResult?.targetRef).toContain("DP-ADOPT:");
    expect(done.executionResult?.targetRef).toContain(`certWeeks:${certBefore}→8`);
    expect(String(done.executionResult?.targetRef)).not.toMatch(/^MO-/);

    // ★★ 效果层核心 A：对象真值真的变了（这一段红 = 「点了采纳，什么都没变」回潮）。
    const poolAfter = await t.repos.objects.get("demo", POOL_ID);
    expect(Number(poolAfter!.props.certWeeks), `认证周期没落到状态上：${certBefore} → ${poolAfter!.props.certWeeks}`).toBe(8);

    // ★★ 效果层核心 B：**引擎真的读到了新值**（只改库不被消费 = 另一种空转）。
    // decision_play 的 cycleDays = certWeeks×7、cost = 120+certWeeks×8，两者都必须随之改。
    const after = await play(t);
    const optAfter = after.options.find((o) => o.optionId === "opt-backup-cert")!;
    expect(optAfter.provenance.drillValue, "求解器下钻值仍读到旧的认证周期").toBe(8);
    expect(optAfter.cycleDays, `见效周期未随杠杆变：${opt!.cycleDays} → ${optAfter.cycleDays}`).toBeLessThan(opt!.cycleDays);
    expect(optAfter.cost, `代价未随杠杆变：${opt!.cost} → ${optAfter.cost}`).toBeLessThan(opt!.cost);
    expect(optAfter.closesGap, `补缺口未随杠杆变（方案有效性 effBackup=1−certWeeks/26 派生）`).toBeGreaterThan(opt!.closesGap);

    // 台账：R13「谁在什么时候按哪条方案把它从 X 改成了 Y」——属性真值变了却查不出出处，等于没法审计。
    const ledger = await t.repos.objects.listByType("demo", "AdoptedDecisionPlay");
    expect(ledger.length, "台账没写：属性真值变了却查不出出处").toBe(1);
    expect(ledger[0]!.props).toMatchObject({
      optionId: "opt-backup-cert",
      leverObjectType: "BackupSupplierPool",
      leverObjectId: POOL_ID,
      leverProp: "certWeeks",
      leverFrom: String(certBefore),
      leverTo: "8",
      status: "ACTIVE",
    });
    expect(ledger[0]!.props.actionDraftId, "台账未溯回 Action 草稿（R13 断链）").toBe(done.id);

    // 🔒 红线（与本条同一次采纳之后立刻验·见判据②的专测再验一次不同方案）。
    expect(await goalCarriers(t), "采纳战略方案覆写了经营目标基线——「目标不能改」被破").toBe(goalsBefore);
  });

  it("① 正向（第二根杠杆·证不是只对一条方案硬编码）：采纳「长协加价格联动条款」→ priceLinked false→true", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const before = await play(t);
    const opt = before.options.find((o) => o.optionId === "opt-lta-clause")!;
    expect(opt.provenance.drillType).toBe("LongTermAgreement");
    const ltaId = String(opt.provenance.drillId);
    const ltaBefore = (await t.repos.objects.listByType("demo", "LongTermAgreement")).find((o) => String(o.props.ltaId) === ltaId);
    expect(ltaBefore, `方案指名的长协 ${ltaId} 不在库里`).toBeTruthy();
    expect(ltaBefore!.props.priceLinked, "前提：该长协尚无价格联动条款，否则「加条款」是空断言").toBe(false);
    expect(opt.label, "前提：无联动时方案名应是「加价格联动条款」").toContain("加价格联动条款");

    const done = await adopt(t, { metricKey: M, optionIds: ["opt-lta-clause"] });
    expect(done.status, `采纳执行失败：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    expect(done.executionResult?.targetRef).toContain("priceLinked:false→true");

    const ltaAfter = (await t.repos.objects.listByType("demo", "LongTermAgreement")).find((o) => String(o.props.ltaId) === ltaId);
    expect(ltaAfter!.props.priceLinked, "条款没落到状态上").toBe(true);

    // 引擎读到新值：无联动 → 已联动，方案名与有效性都变（effClause 0.7 → 0.3）。
    const after = await play(t);
    const optAfter = after.options.find((o) => o.optionId === "opt-lta-clause")!;
    expect(optAfter.label, `方案名未随真值变：${opt.label} → ${optAfter.label}`).not.toBe(opt.label);
    expect(optAfter.closesGap, "补缺口未随真值变").not.toBe(opt.closesGap);
  });

  it("② 🔒 红线：采纳战略方案之后 PLAN_GOAL_TARGETS 与其运行期派生承载**逐字节未变**（「目标不能改」）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 逐字节基线（常量本身 + 落到 solver_params 上的那一份 planGenerate.targets）。
    const goalsBefore = await goalCarriers(t);
    // 空断言防护：这份基线必须真的含六个目标值，否则"未变"是在比两个空对象。
    for (const k of ["revGrowthPct", "gmFloorPct", "sharePts", "capexCap", "cashFloor", "turns"] as const) {
      expect(goalsBefore, `基线里缺目标项 ${k} —— 「逐字节未变」会退化成空断言`).toContain(k);
    }
    expect(goalsBefore).toContain(String(PLAN_GOAL_TARGETS.revGrowthPct));

    const done = await adopt(t, { metricKey: M, optionIds: ["opt-backup-cert", "opt-lta-clause"] });
    expect(done.status, `采纳执行失败：${done.executionResult?.error ?? ""}`).toBe("EXECUTED");
    // 前提校验：这一次采纳确实写了东西（否则"目标没变"是因为整单没跑，红线断言等于空转）。
    expect((await t.repos.objects.listByType("demo", "AdoptedDecisionPlay")).length, "本次采纳一条台账都没写——红线断言会空转").toBe(2);

    expect(await goalCarriers(t), "采纳战略方案覆写了经营目标基线——「目标不能改」被破（业务裁定·已定）").toBe(goalsBefore);
    // 六个目标值逐项再点一次名（整串相等已覆盖，此处让失败信息指得出是哪一项）。
    // ⚠ 承载侧的键名与常量侧不同名（battery.ts planGenerate.targets：gmFloor = gmFloorPct/100、turnsFloor = turns），
    //   照承载的真键名断言 —— 拿常量的键名去查承载会恒 undefined，那种"绿"是假的。
    const p = (await t.services.solvers.getParams("demo")) as unknown as { planGenerate?: { targets?: Record<string, number> } };
    expect(p.planGenerate?.targets).toMatchObject({
      revGrowthPct: PLAN_GOAL_TARGETS.revGrowthPct,
      gmFloor: PLAN_GOAL_TARGETS.gmFloorPct / 100,
      sharePts: PLAN_GOAL_TARGETS.sharePts,
      capexCap: PLAN_GOAL_TARGETS.capexCap,
      cashFloor: PLAN_GOAL_TARGETS.cashFloor,
      turnsFloor: PLAN_GOAL_TARGETS.turns,
    });
  });

  it("③ 兜底：未映射的战略方案（opt-insource）仍诚实拒绝——不静默成功、不降级到「最接近」的一条", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const before = await play(t);
    expect(before.options.some((o) => o.optionId === "opt-insource"), "前提：本次推演真有这条未映射方案").toBe(true);
    const poolBefore = JSON.stringify((await t.repos.objects.get("demo", POOL_ID))!.props);

    const done = await adopt(t, { metricKey: M, optionIds: ["opt-insource"] });

    // 诚实失败：不是 EXECUTED，且错误说得出**为什么**（前端/审计据此显示原因，而非一句看不懂的失败）。
    expect(done.status, "未映射的战略方案被静默采纳成功了——正是本单要堵的病灶").toBe("EXECUTION_FAILED");
    expect(done.executionResult?.error).toContain("opt-insource");
    expect(done.executionResult?.error).toContain("没有登记");
    expect(String(done.executionResult?.targetRef ?? "")).not.toMatch(/^MO-/);

    // 零回写：既没落台账，也没顺手改别人的杠杆（"降级到最接近的一条"就是从这里漏出去的）。
    expect(await t.repos.objects.listByType("demo", "AdoptedDecisionPlay")).toEqual([]);
    expect(JSON.stringify((await t.repos.objects.get("demo", POOL_ID))!.props), "拒绝执行却动了别的杠杆——静默降级").toBe(poolBefore);
  });

  it("③ 兜底：幽灵方案（不是本次推演产出的）拒绝采纳——payload 说了不算，真推演说了算", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const done = await adopt(t, { metricKey: M, optionIds: ["opt-not-a-real-plan"] });
    expect(done.status).toBe("EXECUTION_FAILED");
    expect(done.executionResult?.error).toContain("幽灵方案");
    expect(await t.repos.objects.listByType("demo", "AdoptedDecisionPlay")).toEqual([]);
  });

  it("③ 兜底仍在：决策内核对 decision_play 方案**依然诚实不派** adopt_mitigation（补了新类型不等于放开旧的错映射）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const dp = await play(t);
    const chosen = [dp.options[0]!.optionId];

    const dec = (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: M, chosenOptionIds: chosen } })).json() as Decision;
    const committed = (await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN })).json() as Decision;

    // 这条断言的**本意**：本单补了 adopt_decision_play 之后，内核**不得**顺手把战略方案改派成
    // adopt_mitigation（两域仍无映射）。诚实不派 + trace 记明理由，仍是正确行为。
    expect(committed.actionDraftIds, "内核把公司级战略方案派成了基地处置单——静默错答回潮").toEqual([]);
    expect(await t.repos.actionDrafts.list("demo", (x) => x.actionTypeKey === "adopt_mitigation")).toEqual([]);
    const actionSteps = committed.trace.filter((s) => s.step === "action");
    expect(actionSteps.map((s) => s.refId), "不派 ≠ 悄悄吞掉：每个选定方案都必须有交代").toEqual(chosen);
    expect(actionSteps[0]!.label).toContain("诚实不派");
  });

  it("纯函数层（解析器单一出处）：真方案+有登记→解出；未登记→带留白理由拒；幽灵→拒；provenance 缺失→拒", () => {
    const options = [
      { optionId: "opt-a", label: "甲", factorId: "cf-x", provenance: { drillType: "T", drillId: "t1" } },
      { optionId: "opt-none", label: "乙", factorId: "cf-x", provenance: { drillType: "T", drillId: "t2" } },
      { optionId: "opt-noprov", label: "丙", factorId: "cf-x" },
    ];
    const lib = {
      levers: { "opt-a": { prop: "p", to: 8, rationale: "对标某真实数据点" } },
      noLeverRationale: { "opt-none": "今天没有可落的本体属性" },
    };

    const ok = resolveDecisionPlayLever("opt-a", options, lib);
    expect(ok).toMatchObject({ ok: true, objectType: "T", objectRef: "t1", prop: "p", to: 8 });

    const none = resolveDecisionPlayLever("opt-none", options, lib);
    expect(none.ok).toBe(false);
    // 拒绝时必须把**留白理由**带出来——否则"没登记"和"忘了登记"在错误里分辨不出。
    expect((none as { reason: string }).reason).toContain("今天没有可落的本体属性");
    expect((none as { reason: string }).reason).not.toContain("opt-a"); // 绝不提示"要不要改用最接近的那条"

    expect(resolveDecisionPlayLever("ghost", options, lib).ok).toBe(false);
    expect((resolveDecisionPlayLever("ghost", options, lib) as { reason: string }).reason).toContain("幽灵方案");
    expect(resolveDecisionPlayLever("opt-noprov", options, lib).ok).toBe(false);
    // 杠杆库整个缺失（老租户参数没这一段）→ 也必须拒，不许回落到某个默认杠杆。
    expect(resolveDecisionPlayLever("opt-a", options, undefined).ok).toBe(false);
  });
});
