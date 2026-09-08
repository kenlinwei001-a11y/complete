import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { HttpOptimizerClient } from "../src/solvers/optimizer-client.js";

/**
 * WO-PORTFOLIO-OPTIMAL · 真 CP-SAT sidecar 端到端集成测试（env-gated·SEAM 层2·审核头号判据）。
 *
 * 「共享产能无重复占用」是真 CP-SAT 约束 Σ_i qty·x[i,b,t] ≤ cap[b,t] 的产物——mock 冒充即「绿测试≠能用」。
 * 本测试注入真 HttpOptimizerClient 指向真起的 OR-Tools sidecar（services/optimizer/server.py），让 portfolio
 * 联合解经真 CP-SAT，亲证：① 全订单每格 Σ≤cap ② 单/联对拍（两 sop 分开都挤 SO-3415 → 合并 Σ>其量 vs
 * portfolio 只指派一次 Σ≤cap·证「联≠分开」）③ 冻结真排除锁产能 ④ ≥2 方案真差异 ⑤ R6 双跑字节一致。
 *
 * 跑法（默认 CI 跳过·避免依赖外部进程）：
 *   PORT=4003 python3 services/optimizer/server.py &
 *   OPTIMIZER_BASE_URL=http://127.0.0.1:4003 pnpm --filter datacore exec vitest run test/portfolio-sidecar.integration.test.ts
 */
const SIDECAR = process.env.OPTIMIZER_BASE_URL;
const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

type Port = {
  status: string; optimal: boolean; feasible: boolean;
  allocation: { item: string; committed: boolean; base: string; window: number; qty: number; provenance: { drillType: string; drillField: string } }[];
  occupancy: { item: string; base: string; window: number; qty: number }[];
  displaced: { orderId: string; kind: string; qty: number; provenance: { drillType: string } }[];
  scenarios: { key: string; objectiveValues: Record<string, number>; servedCount: number; servedQty: number }[];
  objectiveValues: Record<string, number>;
  capacityLedger: { baseId: string; window: number; cap: number; allocated: number }[];
  reconChecks: { ok: boolean; cap: number; allocated: number }[];
  reconciled: boolean;
  frozen: { orderId: string; base: string; window: number; qty: number; frozen: boolean }[];
  summary: string;
};
type Sop = { displaced: { orderId: string; qty: number }[]; targetOrder: { qty: number } };

async function app() {
  const t = await makeApp();
  await seedBattery(t);
  t.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
  return t;
}
const port = (t: Awaited<ReturnType<typeof app>>, args: Record<string, unknown>): Promise<Port> =>
  t.services.solvers.invoke(ctx, "portfolio", args) as Promise<Port>;
const sop = (t: Awaited<ReturnType<typeof app>>, args: Record<string, unknown>): Promise<Sop> =>
  t.services.solvers.invoke(ctx, "sop_reschedule", args) as Promise<Sop>;

describe.skipIf(!SIDECAR)("WO-PORTFOLIO-OPTIMAL · 真 CP-SAT 联合最优组合（OPTIMIZER_BASE_URL 起真 OR-Tools）", () => {
  it("① 全订单×全基地×窗口联合解 → 每 (基地,窗口) Σ 分配 ≤ 净产能（无重复占用·status OPTIMAL）", async () => {
    const t = await app();
    const g = await port(t, { scenarios: ["max_ontime", "min_cost"] });
    expect(g.status).toBe("OPTIMAL");
    expect(g.optimal).toBe(true);
    expect(g.capacityLedger.length).toBeGreaterThan(0);
    // 逐格共享产能守恒（真 CP-SAT 约束产物·非各单独立超发）。
    for (const c of g.capacityLedger) expect(c.allocated).toBeLessThanOrEqual(c.cap);
    expect(g.reconChecks.every((r) => r.ok)).toBe(true);
    expect(g.reconciled).toBe(true);
    // 真排产（至少若干订单获排·非空壳），每分配格带 Line 溯源。
    const orderAlloc = g.allocation.filter((a) => !a.committed && a.item.startsWith("SO-"));
    expect(orderAlloc.length).toBeGreaterThan(0);
    for (const a of orderAlloc) expect(a.provenance.drillType).toBe("Line");
  });

  it("② 单/联对拍（接缝头号）：两 sop 分开都挤 SO-3415 → 合并双占（Σ>其量）；portfolio 只指派一次（Σ≤cap·联≠分开）", async () => {
    const t = await app();
    // 分开逐单求解：SO-3402 与 SO-3420（均 4680-NCM）各自提前 → 各自挤占 SO-3415 腾产能（sop-reschedule 已证单单都排它让位）。
    const a = await sop(t, { targetOrderId: "SO-3402", advancePct: 0.2 });
    const b = await sop(t, { targetOrderId: "SO-3420", advancePct: 0.2 });
    const aHits = a.displaced.filter((d) => d.orderId === "SO-3415");
    const bHits = b.displaced.filter((d) => d.orderId === "SO-3415");
    expect(aHits.length).toBe(1); // SO-3402 分开求解假设 SO-3415 产能可借
    expect(bHits.length).toBe(1); // SO-3420 分开求解**也**假设 SO-3415 产能可借（同一产能被两解各借一次）
    const q3415 = aHits[0]!.qty;
    // 分开模式：SO-3415 的产能被两个独立解各挪用一次 → 合并占用 = 2×其量 > 其量（重复占用·局部最优的病根）。
    const naiveFreed = aHits[0]!.qty + bHits[0]!.qty;
    expect(naiveFreed).toBeGreaterThan(q3415); // 8066 > 4033：分开求解重复占用 SO-3415 产能

    // 联合求解：SO-3415 是联合决策项，Σ_{b,t} x[SO-3415,b,t] == served ≤ 1 → 只被指派一次（守恒·不重复）。
    const g = await port(t, {});
    const occ3415 = g.occupancy.filter((o) => o.item === "SO-3415");
    const disp3415 = g.displaced.filter((d) => d.orderId === "SO-3415");
    expect(occ3415.length + disp3415.length).toBe(1); // 恰现身一次（获排或被挤·二选一）
    const jointQty3415 = occ3415.reduce((s, o) => s + o.qty, 0);
    expect(jointQty3415).toBeLessThanOrEqual(q3415); // 联合模式 SO-3415 只计一次（≤ 其量·非 2×）
    // 且 SO-3415 所在格联合 Σ ≤ cap（真守恒）。
    for (const o of occ3415) {
      const cell = g.capacityLedger.find((c) => c.baseId === o.base && c.window === o.window)!;
      expect(cell.allocated).toBeLessThanOrEqual(cell.cap);
    }
    expect(g.reconciled).toBe(true);
  });

  it("③ 冻结真排除 + 锁产能：frozenOrderIds:[SO-3415] → 标 frozen、不入 served/displaced、其净产能被预扣（解随之变）", async () => {
    const t = await app();
    const base = await port(t, {});
    const g = await port(t, { frozenOrderIds: ["SO-3415"] });
    // SO-3415 冻结 → 出现在 frozen、既不获排也不被挤。
    expect(g.frozen.some((f) => f.orderId === "SO-3415")).toBe(true);
    expect(g.occupancy.some((o) => o.item === "SO-3415")).toBe(false);
    expect(g.displaced.some((d) => d.orderId === "SO-3415")).toBe(false);
    const froz = g.frozen.find((f) => f.orderId === "SO-3415")!;
    // 其承接 (基地,窗口) 净产能被预扣（reserve）→ 该格 cap 较未冻结时小 froz.qty。
    const cellFrozen = g.capacityLedger.find((c) => c.baseId === froz.base && c.window === froz.window)!;
    const cellBase = base.capacityLedger.find((c) => c.baseId === froz.base && c.window === froz.window)!;
    expect(cellFrozen.cap).toBe(cellBase.cap - froz.qty);
    expect(g.reconciled).toBe(true);
  });

  it("④ ≥2 方案量化利弊真差异：max_ontime vs min_cost 经真 CP-SAT → objectiveValues 实测不同（按期≥、代价≤）", async () => {
    const t = await app();
    const g = await port(t, { scenarios: ["max_ontime", "min_cost", "min_changeover"] });
    expect(g.scenarios.length).toBeGreaterThanOrEqual(2);
    const mo = g.scenarios.find((s) => s.key === "max_ontime")!;
    const mc = g.scenarios.find((s) => s.key === "min_cost")!;
    // 各目标值真算（非贴标签）。
    expect(mo.objectiveValues.ontime).toBeGreaterThanOrEqual(mc.objectiveValues.ontime!); // max_ontime 按期数 ≥
    expect(mc.objectiveValues.cost).toBeLessThanOrEqual(mo.objectiveValues.cost!);        // min_cost 代价 ≤
    // 方案 objectiveValues 至少一对不字节相同（改目标→真漂移）。
    const sigs = g.scenarios.map((s) => JSON.stringify(s.objectiveValues));
    expect(new Set(sigs).size).toBeGreaterThan(1);
  });

  it("⑤ R6 确定性：同 seed 双跑 allocation/objectiveValues/scenarios 逐字段字节一致", async () => {
    const t = await app();
    const a = await port(t, { scenarios: ["max_ontime", "min_cost"] });
    const b = await port(t, { scenarios: ["max_ontime", "min_cost"] });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
