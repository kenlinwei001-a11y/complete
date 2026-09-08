import { describe, expect, it } from "vitest";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { chainNonValueDays, ChainLossMatrixResultSchema, LOSS_CONSERVATION_TOLERANCE_PCT, type ChainLossMatrixResult } from "@platform/contracts";
import type { ChainLossResult } from "../src/solvers/chain-loss.js";

/**
 * WO-SIM-BE-MATRIX · 环节 × 基地 损失矩阵 `POST /a/v1/sim/chain-loss-matrix` 的接缝门。
 *
 * ── 这个文件咬的是**接缝**，不是各半 unit ────────────────────────────────────
 * 数据半 = 种子里的 `Base` / `Order.bases` / 各基地的 `Process(kind="aging")`；
 * 引擎半 = 一维 `chain_loss_attribution` + S0 契约的 `computeLossAttribution`/`chainNonValueDays`。
 * 任一半漏（Base 没物化 / 基地这一维没生效 / 归因换了分母）本文件当场红。
 * **全部经真 HTTP 端点驱动**（`app.inject`），不是直调纯函数——纯函数绿证明不了路由接上了。
 *
 * ── 四条判据 ────────────────────────────────────────────────────────────────
 *  ① **列守恒**：逐列 Σ 格子天数 == 该列 `chainNonValueDays(全链 steps)`，且逐列 Σpct == 100 ±容差。
 *     后半句是变异反证 ④ 的注入点：分母一旦含进增值段，Σpct 立刻不再是 100。
 *  ② **空列不许返 0**：本体里有、但没有任何 Order 排到的基地 ⇒ 该列 `days`/`sumPct`/`residual`
 *     全 `null` + `reason`，且**断言它不是 0**（`toBeNull` 单独不够：0 也过不了 `toBeNull`，
 *     但把断言写成 `not.toBe(0)` 才说明白「我们要区分的正是这两者」）。
 *  ③ **对拍**：矩阵在一维求解器**同一锚点基地**那一列，逐环节天数/占比与一维输出逐位相等。
 *     ⚠ 只比「两边相等」是不够的 —— 两边同时错也会相等（本仓「假绿」的经典形态）。
 *     故对拍**同时**要求一维那侧自己守恒（`conservation.ok`）：这才让口径错误无处可藏。
 *  ④ **基地这一维是真的**：同一张订单在两个基地上的两列，`anchorAgingProcessId` **必须不同**
 *     （老化工序是按 `Process.baseId` 过滤出来的）。少了这条，把一列复制 13 份、
 *     只改 `baseId` 标签的实现能让上面三条全绿 —— 信号是真的，只是不指向要断言的那个对象。
 *
 * ── 变异反证（本单亲手跑过，红的原文见交单报告）────────────────────────────
 * 把 `packages/contracts/src/chain-sim.ts` 的 `computeLossAttribution` 分母
 * 从 `chainNonValueDays(steps)`（排除增值段）改成 `steps.reduce((s, x) => s + x.days, 0)`（含增值段）
 * → 判据 ①（Σpct 98.60 ≠ 100）与判据 ③（一维侧 `conservation.ok === false`）**当场红**。还原 → 全绿。
 */

const ADMIN_CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
const URL = "/a/v1/sim/chain-loss-matrix";

/** WO 判据写死 ±0.1；契约自带的 `LOSS_CONSERVATION_TOLERANCE_PCT`（0.001）更严，两条都断。 */
const WO_TOLERANCE_PCT = 0.1;

/** 天数比较容差：浮点求和的量级噪声（实测残差 ~1e-14），不是口径松紧。 */
const DAYS_EPS = 1e-9;

async function postMatrix(t: TestApp, payload: Record<string, unknown> = {}, headers: Record<string, string> = ADMIN) {
  return t.app.inject({ method: "POST", url: URL, headers, payload });
}

async function okMatrix(t: TestApp, payload: Record<string, unknown> = {}): Promise<ChainLossMatrixResult> {
  const res = await postMatrix(t, payload);
  expect(res.statusCode, `矩阵端点应 200，实际 ${res.statusCode}：${res.body.slice(0, 400)}`).toBe(200);
  // 端点已 parse 过一次；这里再 parse 一次是**测试自证**：契约若被改松，这里跟着红。
  return ChainLossMatrixResultSchema.parse(res.json());
}

const cellsOf = (m: ChainLossMatrixResult, baseId: string) => m.cells.filter((c) => c.baseId === baseId);
const colOf = (m: ChainLossMatrixResult, baseId: string) => m.colTotals.find((c) => c.baseId === baseId);

describe("WO-SIM-BE-MATRIX · 环节 × 基地 损失矩阵（POST /a/v1/sim/chain-loss-matrix）", () => {
  it("① 端点真调：逐基地列和 == 该基地全链非增值天数，且逐列 Σpct == 100", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const m = await okMatrix(t);

    // 金丝雀：矩阵不是空的，否则下面的「逐列全过」是在空集上假绿（本仓 7/7 那族病）。
    expect(m.bases.length, "租户内应有 Base 对象——0 个说明数据半没播种，不是引擎对").toBeGreaterThan(1);
    expect(m.nodes.length).toBeGreaterThan(1);
    const filled = m.colTotals.filter((c) => c.days !== null);
    expect(filled.length, "至少要有一列真有数据，否则本用例什么都没验").toBeGreaterThan(1);

    for (const col of filled) {
      const cells = cellsOf(m, col.baseId);
      expect(cells.length, `${col.baseId} 列有 days 却没有格子`).toBeGreaterThan(0);

      // 守恒（天）：Σ 格子 == 列合计。两条路径独立（逐环节聚合 vs 全链一次 reduce）。
      const sumDays = cells.reduce((s, c) => s + c.days, 0);
      expect(Math.abs(sumDays - (col.days as number)), `${col.baseId}: Σ格子=${sumDays} 列合计=${col.days}`).toBeLessThan(DAYS_EPS);

      // 守恒（%）：Σpct == 100。变异反证 ④ 的注入点就在这一行。
      const sumPct = cells.reduce((s, c) => s + c.pct, 0);
      expect(Math.abs(sumPct - 100), `${col.baseId}: Σpct=${sumPct}（分母若含进增值段这里必偏）`).toBeLessThan(WO_TOLERANCE_PCT);
      expect(Math.abs((col.sumPct as number) - 100)).toBeLessThan(WO_TOLERANCE_PCT);

      // 残差走契约的 `lossConservationResidual`，显式返回、显式判。
      const r = m.residual.byBase.find((x) => x.baseId === col.baseId);
      expect(r?.residualPct, `${col.baseId} 残差不该是 null（该列有数据）`).not.toBeNull();
      expect(Math.abs(r!.residualPct as number)).toBeLessThanOrEqual(LOSS_CONSERVATION_TOLERANCE_PCT);
      expect(r!.ok).toBe(true);
    }

    // 行合计口径同样守恒（Σ pctOfGrandLoss == 100），且天数与格子对得上。
    expect(m.residual.rowsOk).toBe(true);
    for (const row of m.rowTotals) {
      const sum = m.cells.filter((c) => c.nodeId === row.nodeId).reduce((s, c) => s + c.days, 0);
      expect(Math.abs(sum - row.days), `行 ${row.nodeId}: Σ格子=${sum} 行合计=${row.days}`).toBeLessThan(DAYS_EPS);
    }
    expect(Math.abs(m.rowTotals.reduce((s, r) => s + r.pctOfGrandLoss, 0) - 100)).toBeLessThan(WO_TOLERANCE_PCT);
  });

  it("② 无 Order 的基地：该列 null + reason，**不是 0**", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 本体里多一个基地、但没有任何 Order 把它写进 `bases` —— 这正是「有基地没数据」那一格。
    await t.repos.objects.put({
      id: "obj_Base_ghost",
      tenantId: ADMIN_CTX.tenantId,
      type: "Base",
      props: { baseId: "ghostbase", name: "空基地（无订单）" },
      origin: { type: "MANUAL" },
    });
    const orders = await t.repos.objects.listByType(ADMIN_CTX.tenantId, "Order");
    // 金丝雀：先自证「这个基地真的没有任何 Order」，否则下面断言的 null 可能来自别的原因。
    const referenced = orders.some((o) => (Array.isArray(o.props.bases) ? (o.props.bases as unknown[]).map(String) : []).includes("ghostbase"));
    expect(referenced, "ghostbase 不该被任何 Order.bases 引用（这是本用例的前提）").toBe(false);

    const m = await okMatrix(t);
    expect(m.bases.map((b) => b.baseId)).toContain("ghostbase");

    const ghost = colOf(m, "ghostbase");
    expect(ghost, "空基地也必须出现在 colTotals 里——整列消失 = 用户根本不知道有这么个基地").toBeDefined();
    // ⛔ 关键：不是 0。`toBeNull` 与 `not.toBe(0)` 两条都写，是因为要区分的正是这两者。
    expect(ghost!.days).toBeNull();
    expect(ghost!.days).not.toBe(0);
    expect(ghost!.sumPct).toBeNull();
    expect(ghost!.sumPct).not.toBe(0);
    expect(ghost!.anchorSo).toBeNull();
    expect(ghost!.cellCount).toBe(0);
    expect(cellsOf(m, "ghostbase")).toHaveLength(0);
    expect(ghost!.reason, "空列必须说明为什么空").toBeTruthy();
    expect(ghost!.reason).toContain("ghostbase");
    expect(ghost!.probe, "空列必须给复验探针").toBeTruthy();
    // 缺席的环节逐个点名，不是留一片看不出所以然的空白。
    expect(ghost!.missingNodeIds.sort()).toEqual(m.nodes.map((n) => n.nodeId).sort());

    const gr = m.residual.byBase.find((x) => x.baseId === "ghostbase");
    expect(gr?.residualPct).toBeNull();
    expect(gr?.residualPct).not.toBe(0);
    expect(gr?.ok).toBe(false);

    // 有数据的列一个都没被这次新增影响（空列不参与任何分母）。
    const filled = m.colTotals.filter((c) => c.days !== null);
    expect(filled.length).toBeGreaterThan(1);
    for (const col of filled) expect(Math.abs((col.sumPct as number) - 100)).toBeLessThan(WO_TOLERANCE_PCT);
  });

  it("③ 对拍：矩阵在一维求解器同一锚点基地那一列，与一维输出逐环节相等（且两侧都守恒）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const one = (await t.services.solvers.invoke(ADMIN_CTX, "chain_loss_attribution", {})) as unknown as ChainLossResult;
    const anchorBase = one.anchor.baseId;
    expect(anchorBase, "一维求解器必须锚到某个基地，否则本用例没有可对拍的列").toBeTruthy();

    // ⚠ 只比相等会让「两边同时错」全绿。先要求一维那侧自己守恒，再谈相等。
    expect(one.conservation.ok, `一维侧守恒破了（Σpct=${one.conservation.sumPct}），对拍在这种状态下没有意义`).toBe(true);
    expect(Math.abs(one.conservation.sumPct - 100)).toBeLessThan(WO_TOLERANCE_PCT);

    // 用同一张锚点订单铺矩阵 ⇒ 该列与一维是同一条链，可逐位对拍。
    const m = await okMatrix(t, { so: one.anchor.so });
    const col = colOf(m, anchorBase as string);
    expect(col, `矩阵里应有 ${anchorBase} 这一列`).toBeDefined();
    expect(col!.anchorSo).toBe(one.anchor.so);
    expect(col!.anchorBaseId).toBe(anchorBase);

    // 列合计 == 一维的全链非增值天数（一维那侧的数由它自己的 totals 给，不是我这边再算一遍）。
    expect(Math.abs((col!.days as number) - one.totals.nonValueDays)).toBeLessThan(DAYS_EPS);
    // 再用契约的唯一实现从一维的 steps 直接算一次，三方对齐（列合计 / 一维 totals / 契约函数）。
    const oneSteps = one.nodes.flatMap((n) => n.steps);
    expect(Math.abs((col!.days as number) - chainNonValueDays(oneSteps))).toBeLessThan(DAYS_EPS);

    // 逐环节：天数与占比都要对上。
    const pctByStep = new Map(one.attribution.map((a) => [a.stepId, a.pctOfChainLoss] as const));
    expect(pctByStep.size, "一维归因表不该是空的").toBeGreaterThan(0);
    for (const n of one.nodes) {
      const cell = m.cells.find((c) => c.baseId === anchorBase && c.nodeId === n.nodeId);
      expect(cell, `矩阵缺了一维有的环节 ${n.nodeId}`).toBeDefined();
      expect(Math.abs(cell!.days - chainNonValueDays(n.steps)), `${n.nodeId} 天数对不上`).toBeLessThan(DAYS_EPS);
      const pct = n.steps.reduce((s, st) => s + (pctByStep.get(st.stepId) ?? 0), 0);
      expect(Math.abs(cell!.pct - pct), `${n.nodeId} 占比对不上`).toBeLessThan(WO_TOLERANCE_PCT);
    }
    // 反向：该列没有一维之外的环节（多出来的格子同样是编数）。
    expect(cellsOf(m, anchorBase as string).map((c) => c.nodeId).sort()).toEqual(one.nodes.map((n) => n.nodeId).sort());
  });

  it("④ 基地这一维是真的：同一张订单的两列，锚到的老化工序必须不同", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const one = (await t.services.solvers.invoke(ADMIN_CTX, "chain_loss_attribution", {})) as unknown as ChainLossResult;
    const m = await okMatrix(t, { so: one.anchor.so });
    const filled = m.colTotals.filter((c) => c.days !== null);
    // 该锚点订单是多基地可产的（seed 42 实测 ≥2），否则这条判据无从谈起。
    expect(filled.length, `锚点订单 ${one.anchor.so} 应可在 ≥2 个基地生产，本用例才有意义`).toBeGreaterThan(1);

    for (const col of filled) {
      expect(col.anchorSo).toBe(one.anchor.so);
      // 每一列真的锚在自己那个基地上（不是拿 orderBases[0] 那个基地跑了 N 遍）。
      expect(col.anchorBaseId, `${col.baseId} 列锚到了 ${col.anchorBaseId}`).toBe(col.baseId);
      expect(col.anchorAgingProcessId, `${col.baseId} 列没锚到老化工序`).toBeTruthy();
    }
    const agingIds = filled.map((c) => c.anchorAgingProcessId);
    expect(new Set(agingIds).size, `同一张单的 ${filled.length} 列共用了同一个老化工序 ${agingIds[0]} ⇒ 基地这一维没生效`).toBe(filled.length);

    // 指定了锚点单 ⇒ 该单产不了的基地一律空列 + 原因（同样不是 0）。
    const blank = m.colTotals.filter((c) => c.days === null);
    expect(blank.length).toBeGreaterThan(0);
    for (const col of blank) {
      expect(col.days).not.toBe(0);
      expect(col.reason).toBeTruthy();
      expect(col.reason).toContain(one.anchor.so);
    }
  });

  it("④b 租户隔离：别的租户拿不到本租户的矩阵（404/403，且不回本租户任何数据）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const mine = await okMatrix(t);
    expect(mine.bases.length).toBeGreaterThan(0);

    const res = await postMatrix(t, {}, { "x-debug-user": "other-tenant:u:admin" });
    expect([403, 404], `跨租户应被挡，实际 ${res.statusCode}`).toContain(res.statusCode);
    for (const b of mine.bases) expect(res.body).not.toContain(b.baseId);
    expect(res.body).not.toContain(mine.colTotals[0]?.anchorSo ?? "SO-");
  });

  it("④c 不存在的锚点订单 → 404（不静默返回一张空矩阵）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await postMatrix(t, { so: "SO-NOT-A-REAL-ORDER" });
    expect(res.statusCode).toBe(404);
  });
});
