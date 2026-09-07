import { describe, expect, it } from "vitest";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { ChainLossMatrixResultSchema, type ChainLossMatrixResult } from "@platform/contracts";
import { SIM_DAY_STATE_VAR_BY_CARRIER, type ChainLossResult } from "../src/solvers/chain-loss.js";
import { SOLVER_OUTPUT_SHAPES } from "../src/solvers/service.js";

/**
 * WO-DRILL-VERDICT-BACKEND · 根因链 × 推演会话的**接缝门**。
 *
 * ── 这个文件咬的是接缝，不是各半 unit ────────────────────────────────────────
 * 数据半 = 推演会话的世界态（`sim_tick_state`，按 `sessionId|tick` 存，扰动落在这里）；
 * 引擎半 = `chain_loss_attribution` / `chain_loss_matrix`（读 `repos.objects` 的真实对象）。
 * **修前这两半根本没有接缝** —— 两条端点不收 `sessionId`，真后端实测：给
 * `obj_supplier_SUP-001.deliveryDelay` 施 +30 天扰动再 tick×3，世界态里该值 9→39，
 * 而 `chain-loss-matrix` 回包 **md5 逐字节相同**（`00005c6ac8853747042bc1100b35d6b0` / 30440B）。
 * 于是「演习结论」答的永远是真实世界那条链。本文件咬住这条接缝不许再断。
 *
 * 全部经**真 HTTP 端点**驱动（`app.inject`）：纯函数绿证明不了路由接上了
 * （本仓「只有 test 引用 = 已排练，不是已实现」那条纪律）。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────────
 *  ① **金丝雀先行**：先证明本文件的读数取法有鉴别力（换一个 `so`，回包必须变）。
 *     不中 ⇒ 报「量法坏了」，而不是报「代码没问题」。
 *  ② **反向对照**：不传 `sessionId` 连跑两次 **逐字节相同**，且与「本参数引入前」同形状
 *     —— 即 `simContext` 整块缺席。确定性（R6）与向后兼容一起咬。
 *  ③ **正向对照（本单的命门）**：传 `sessionId` 后，那一段的天数必须**按可预言的量**变化 ——
 *     `days === daysFromDrill(drillValue) + deltaDays`，不是"变了就算过"。
 *     只断"md5 变了"是不够的：任何一处无关改动都能让 md5 变。
 *  ④ **量纲纪律**：0–100 压力族**一天都不许**加进以天计的链；且必须被 `excluded` 点名。
 *     少了这条，把 `reviewPressure: 87.3` 当成 87 天加进去，判据 ③ 照样"变了"。
 *  ⑤ **排除理由不许说谎**：天数族但挂错承载物的（`Supplier.procurementDelay`）
 *     必须标 `OTHER_CARRIER`，不是 `NOT_DAY_UNIT`。两种理由修法不同，合成一句就是标签说谎
 *     （本仓 `drillField:"value"` 差 1e4 那次的同形态）。
 *  ⑥ **R13 不被污染**：`drillValue` 恒是仓储字段真值，叠加另立一格。
 *  ⑦ **R2**：别租户/不存在的会话 404，**不许**静默退化成「不叠加」——
 *     静默退化会让用户以为看的是自己那次推演，其实看的是真实世界。
 */

const MATRIX_URL = "/a/v1/sim/chain-loss-matrix";
const DRILL_URL = "/a/v1/sim/chain-loss-drill";
const ATTR_URL = "/a/v1/solvers/chain_loss_attribution/invoke";

/** 浮点求和噪声容差（不是口径松紧）。 */
const EPS = 1e-9;

async function matrix(t: TestApp, payload: Record<string, unknown> = {}): Promise<ChainLossMatrixResult> {
  const res = await t.app.inject({ method: "POST", url: MATRIX_URL, headers: ADMIN, payload });
  expect(res.statusCode, `矩阵端点应 200，实际 ${res.statusCode}：${res.body.slice(0, 400)}`).toBe(200);
  // 端点已 parse 过一次；这里再 parse 是**测试自证**：契约被改松则此处跟着红。
  return ChainLossMatrixResultSchema.parse(res.json());
}

async function attribution(t: TestApp, payload: Record<string, unknown> = {}): Promise<ChainLossResult> {
  const res = await t.app.inject({ method: "POST", url: ATTR_URL, headers: ADMIN, payload });
  expect(res.statusCode, `归因端点应 200，实际 ${res.statusCode}：${res.body.slice(0, 400)}`).toBe(200);
  const body = res.json() as { data?: ChainLossResult } & ChainLossResult;
  return (body.data ?? body) as ChainLossResult;
}

/** 建一个带指定世界态的会话（`baseSnapshot` 即 tick0 世界态）。 */
async function makeSession(t: TestApp, baseSnapshot: Record<string, Record<string, number>>): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } });
  expect(res.statusCode, `建会话应 201/200，实际 ${res.statusCode}：${res.body.slice(0, 300)}`).toBeLessThan(300);
  return res.json().id as string;
}

/**
 * 从**求解器自己的证据**里取出锚点链上那几个承载物的对象 id ——
 * 不写死 `obj_supplier_SUP-001`：写死会在种子换锚点时静默失配，
 * 于是"没叠加"被读成"叠加坏了"（本仓最爱犯的「探针恒真/恒假」形态）。
 */
function carrierOf(run: ChainLossResult, drillType: string): { stepId: string; objectId: string; drillValue: number } | null {
  const ev = run.evidence.find((e) => e.drillType === drillType);
    if (!ev) return null;
  // 证据里给的是业务键（如 supplierId），对象 id 是 `obj_<小写类型>_<业务键>`（本仓落库约定）。
  return { stepId: ev.stepId, objectId: `obj_${drillType.toLowerCase()}_${ev.drillId}`, drillValue: ev.drillValue };
}

describe("WO-DRILL-VERDICT-BACKEND · 根因链 × 推演会话接缝", () => {
  it("① 金丝雀：换一个 so，矩阵回包必须变（证本文件的读数取法有鉴别力）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const all = await matrix(t);
    const sos = [...new Set(all.colTotals.map((c) => c.anchorSo).filter((s): s is string => !!s))].sort();
    expect(sos.length, "种子里应有至少 2 张可锚订单，否则金丝雀无从对照").toBeGreaterThanOrEqual(2);
    const a = await matrix(t, { so: sos[0] });
    const b = await matrix(t, { so: sos[1] });
    expect(
      JSON.stringify(a),
      `金丝雀不中 ⇒ **量法坏了**（两个不同锚点单回包相同），此时本文件后面所有"没变"的断言都无意义`,
    ).not.toBe(JSON.stringify(b));
  });

  it("② 反向对照：不传 sessionId 连跑两次逐字节相同，且 simContext 整块缺席（R6 + 向后兼容）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r1 = await matrix(t);
    const r2 = await matrix(t);
    expect(JSON.stringify(r1), "不传 sessionId 两跑必须逐字节一致（R6 确定性）").toBe(JSON.stringify(r2));
    // 「没有会话」这一档必须是**整块缺席**，不是一个空壳 —— 空壳会与「有会话但零影响」混成一档。
    expect(r1.simContext, "不在会话上下文里时 simContext 必须整块缺席").toBeUndefined();
    const run = await attribution(t);
    expect(run.simContext, "一维归因同理").toBeUndefined();
    for (const e of run.evidence) expect(e.sim, `无会话时证据不该带 sim（${e.stepId}）`).toBeUndefined();
  });

  it("②b 形状契约：无会话时顶层 key 恒 == SOLVER_OUTPUT_SHAPES；simContext 是**条件字段**故意不登记", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const shape = SOLVER_OUTPUT_SHAPES["chain_loss_attribution"]!;
    const noSession = await attribution(t);
    // 这条与 `chain-loss-attribution.test.ts` 的精确相等断言同源：本单加了一个**条件**顶层 key，
    // 必须证明它在无会话路径上**一个字节都没多** —— 否则那条断言会红，而红的原因会被误读成"形状漂了"。
    expect(Object.keys(noSession).sort(), "无会话路径的顶层 key 不许因本单变化").toEqual([...shape].sort());
    expect(shape, "simContext 是条件字段，刻意不进形状表（理由见 service.ts 该行注释）").not.toContain("simContext");

    // 有会话时**恰好多这一个**键，不许顺手多带别的。
    const run = await attribution(t);
    const sup = carrierOf(run, "Supplier");
    expect(sup).not.toBeNull();
    const sid = await makeSession(t, { [sup!.objectId]: { deliveryDelay: 3 } });
    const withSession = await attribution(t, { sessionId: sid });
    expect(Object.keys(withSession).sort()).toEqual([...shape, "simContext"].sort());
  });

  it("③ 正向对照：天数族叠加后，该段天数 == 字段真值换算 + 状态量（按可预言的量变，不是"变了就算过"）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await attribution(t);
    const sup = carrierOf(before, "Supplier");
    expect(sup, "锚点链上应有 Supplier 段（否则本判据无从验）").not.toBeNull();

    const DELAY = 30;
    const sid = await makeSession(t, { [sup!.objectId]: { deliveryDelay: DELAY } });
    const after = await attribution(t, { sessionId: sid });

    const evBefore = before.evidence.find((e) => e.stepId === sup!.stepId)!;
    const evAfter = after.evidence.find((e) => e.stepId === sup!.stepId)!;

    // 命门：按可预言的量变化。只断"变了"任何无关改动都能骗过去。
    expect(evAfter.days - evBefore.days, `供应商段应恰好多 ${DELAY} 天`).toBeCloseTo(DELAY, 9);
    // R13（判据⑥）：`drillValue` 是仓储字段真值，**不许**被叠加污染。
    expect(evAfter.drillValue, "drillValue 必须仍是仓储字段真值，叠加另立一格").toBe(evBefore.drillValue);
    expect(evAfter.sim, "叠加必须在证据里显式披露").toEqual({
      sessionId: sid, tick: 0, stateVar: "deliveryDelay", stateValue: DELAY, deltaDays: DELAY,
    });
    // 三者的关系可机器校验：days == 换算(drillValue) + deltaDays
    expect(evAfter.days).toBeCloseTo(evBefore.days + evAfter.sim!.deltaDays, 9);

    // 披露块：有会话 ⇒ 块必在（哪怕零影响也在，与"没有会话"分档）。
    expect(after.simContext, "有会话时 simContext 必须在").toBeDefined();
    expect(after.simContext!.sessionId).toBe(sid);
    expect(after.simContext!.appliedDays).toBeCloseTo(DELAY, 9);
    expect(after.simContext!.appliedSteps.map((s) => s.stepId)).toContain(sup!.stepId);
    // 登记表随包下发，审计可当场核对本次用的是不是这四个。
    expect(after.simContext!.dayStateVarRegistry).toEqual({ ...SIM_DAY_STATE_VAR_BY_CARRIER });
  });

  it("④ 量纲纪律：0–100 压力族一天都不叠，且必须被 excluded 点名为 NOT_DAY_UNIT", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await attribution(t);
    const sup = carrierOf(before, "Supplier");
    expect(sup).not.toBeNull();

    // 只放一个**压力族**读数（0–100 指数）。若引擎把它当天数加进去，`days` 会多 87.3 天。
    const sid = await makeSession(t, { [sup!.objectId]: { reviewPressure: 87.3 } });
    const after = await attribution(t, { sessionId: sid });

    const evBefore = before.evidence.find((e) => e.stepId === sup!.stepId)!;
    const evAfter = after.evidence.find((e) => e.stepId === sup!.stepId)!;
    expect(evAfter.days, "压力指数不是天数，一天都不许加（R18 量纲）").toBeCloseTo(evBefore.days, 9);
    expect(evAfter.sim, "没叠加就不该有 sim 格（不补 0，见 simDeltaDaysFor）").toBeUndefined();
    expect(after.simContext!.appliedDays, "本拍零天数族影响 ⇒ 0 天").toBeCloseTo(0, 9);
    // 缺口留在屏上，不留在注释里：必须被点名。
    expect(after.simContext!.excluded.map((e) => e.key)).toContain("Supplier.reviewPressure");
    expect(after.simContext!.excluded.find((e) => e.key === "Supplier.reviewPressure")!.reason).toBe("NOT_DAY_UNIT");
  });

  it("⑤ 排除理由不许说谎：天数族挂错承载物 ⇒ OTHER_CARRIER，不是 NOT_DAY_UNIT", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await attribution(t);
    const sup = carrierOf(before, "Supplier");
    expect(sup).not.toBeNull();

    // `procurementDelay` **是**天数族（`STATE_VAR_DISPLAY_NAMES` 原文「它度量的是天数」），
    // 但它挂**单据**（PurchaseOrder），不挂供应商画像 —— 在 Supplier 上再算一次就是同一段重复计。
    const sid = await makeSession(t, { [sup!.objectId]: { procurementDelay: 40 } });
    const after = await attribution(t, { sessionId: sid });

    const evBefore = before.evidence.find((e) => e.stepId === sup!.stepId)!;
    const evAfter = after.evidence.find((e) => e.stepId === sup!.stepId)!;
    expect(evAfter.days, "挂错承载物的天数族不该被这一段计入").toBeCloseTo(evBefore.days, 9);
    const hit = after.simContext!.excluded.find((e) => e.key === "Supplier.procurementDelay");
    expect(hit, "必须被点名").toBeDefined();
    expect(
      hit!.reason,
      "它是天数族、只是承载物不对 ⇒ OTHER_CARRIER。标成 NOT_DAY_UNIT 就是标签说谎（1e4 那次的形态）",
    ).toBe("OTHER_CARRIER");
  });

  it("⑥ 矩阵端点同样进会话上下文：列天数按可预言的量变，且 simContext 逐条披露", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const run = await attribution(t);
    const sup = carrierOf(run, "Supplier");
    expect(sup).not.toBeNull();

    const DELAY = 12;
    const sid = await makeSession(t, { [sup!.objectId]: { deliveryDelay: DELAY } });
    const m0 = await matrix(t);
    const m1 = await matrix(t, { sessionId: sid });

    expect(m1.simContext, "矩阵也要披露推演上下文").toBeDefined();
    expect(m1.simContext!.sessionId).toBe(sid);
    expect(m1.simContext!.appliedDays, "跨列并集：同一承载物只计一次，不许按基地数重复计").toBeCloseTo(DELAY, 9);

    // 至少有一列的非增值天数真的多了 DELAY（供应商段在哪些列上出现由锚点决定，不写死列名）。
    const grew = m1.colTotals.filter((c1) => {
      const c0 = m0.colTotals.find((x) => x.baseId === c1.baseId);
      return c0?.days != null && c1.days != null && c1.days - c0.days > DELAY - EPS;
    });
    expect(grew.length, "至少一列的非增值天数应恰好多出叠加的天数").toBeGreaterThan(0);
    // 同一会话两跑仍需逐字节一致（会话态下确定性同样成立）。
    expect(JSON.stringify(await matrix(t, { sessionId: sid }))).toBe(JSON.stringify(m1));
  });

  it("⑦ R2：不存在的会话 404，绝不静默退化成「不叠加」", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const [url, payload] of [
      [MATRIX_URL, { sessionId: "sims_nope" }],
      [DRILL_URL, { nodeId: "material.replenish", sessionId: "sims_nope" }],
      [ATTR_URL, { sessionId: "sims_nope" }],
    ] as const) {
      const res = await t.app.inject({ method: "POST", url, headers: ADMIN, payload });
      expect(
        res.statusCode,
        `${url} 传不存在的会话必须 404（静默退化=让用户以为看的是自己那次推演，实则是真实世界）`,
      ).toBe(404);
    }
  });

  it("⑧ 下钻端点：传 sessionId 后子因天数按可预言的量变", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const run = await attribution(t);
    const sup = carrierOf(run, "Supplier");
    expect(sup).not.toBeNull();
    const nodeId = run.evidence.find((e) => e.stepId === sup!.stepId)!.nodeId;

    const DELAY = 7;
    const sid = await makeSession(t, { [sup!.objectId]: { deliveryDelay: DELAY } });
    const d0 = await t.app.inject({ method: "POST", url: DRILL_URL, headers: ADMIN, payload: { nodeId } });
    const d1 = await t.app.inject({ method: "POST", url: DRILL_URL, headers: ADMIN, payload: { nodeId, sessionId: sid } });
    expect(d0.statusCode).toBe(200);
    expect(d1.statusCode).toBe(200);
    const n0 = d0.json() as { nodeDays: number };
    const n1 = d1.json() as { nodeDays: number };
    expect(n1.nodeDays - n0.nodeDays, `下钻节点天数应恰好多 ${DELAY} 天`).toBeCloseTo(DELAY, 9);
  });
});
