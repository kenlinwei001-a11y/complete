import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { ObjectInstance } from "../src/domain.js";
import { baseHardCapacity } from "../src/solvers/risk.js";
import { HARD_CAPACITY_UNIT_SPECS, readProcessHardCapacity } from "@platform/contracts";

/**
 * WO-SANDBOX-D3 · 工序容量对象 SEAM-GATE（数据半 `Process.capacityUnitKind`/`requiredThroughput`
 * × 引擎半 `bottleneck_matrix` —— 在合并态断言端到端行为，非各半 unit 绿）。
 *
 * ── 治的病（三分法定性 = **接了线接错地方**）──
 * 「有多少个化成柜位」**有**承载物：`Process.channels` 在 `synthetic/battery.ts` 工序段真种、
 * `solvers/capacity.ts:75` capacity_rollup 真读。但**瓶颈判定这条路读不到它**——
 * `risk.ts liveTightness` 只有 Equipment.oee_current / Line.utilization / Process.yield_baseline 三分支；
 * capacity_rollup 虽 `min(serialMin, formationCap, agingCap)` 用了柜位产能，却只取 min，
 * **不记录谁夹定、也不记录差多少** → 「化成夹定与否」在全链任何一处都取不到（物理拓扑视图只能标"数据薄"）。
 * 修法 = 补挂载点 + 补比较基准（`requiredThroughput`），**不是**造新对象类型。
 *
 * ── 本门驱动的接缝（真 generateBattery ctx → services.solvers.invoke → 真 SolverContext，非 mock HTTP）──
 *   ① 运输层：种子把柜位数升成**可被引擎通用发现**的硬容量单元（capacityUnitKind + requiredThroughput）；
 *   ② **效果层（本门命门）**：改柜位数 → `bottleneck_matrix` 的**判定结果**跟着变
 *      —— `binding` false→true、`shortfallPerDay` 0→真缺口、`tightness` 0→真值，
 *      且柜位砍到判定张力超过既有软代理时，**既有因子「瓶颈工序」的张力本身也真的变**（91→95）；
 *   ③ **诚实缺不兜底**：删 `requiredThroughput` → EMPTY + reason，**不是**某个"看着合理"的默认柜位数/默认要求量；
 *   ④ R6 确定性：同 (industry, scale, seed=42) 两跑字节一致。
 */

const CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

type HardCap =
  | {
      status: "OK";
      processId: string;
      processName: string;
      unitKind: string;
      units: number;
      unitDailyThroughput: number;
      capacityPerDay: number;
      requiredPerDay: number;
      shortfallPerDay: number;
      binding: boolean;
      tightness: number;
    }
  | { status: "EMPTY"; reason: string };
type BnOut = {
  dataMode: "LIVE" | "MOCK";
  factors: string[];
  rows: { base: string; tightness: Record<string, number>; primary: string; hardCapacity?: HardCap }[];
};

const BASE = "changzhou";
const BASE_CN = "常州";

const invokeBn = (t: TestApp, ref: string): Promise<BnOut> =>
  t.services.solvers.invoke(CTX, "bottleneck_matrix", { baseIds: [ref], dataMode: "LIVE" }) as Promise<BnOut>;

const rowOf = async (t: TestApp): Promise<BnOut["rows"][number]> => {
  const r = await invokeBn(t, BASE_CN);
  const row = r.rows.find((x) => x.base === BASE_CN);
  expect(row, "bottleneck_matrix 缺常州行").toBeTruthy();
  return row!;
};

const processesAt = async (t: TestApp, baseId: string): Promise<ObjectInstance[]> =>
  (await t.repos.objects.listByType("demo", "Process")).filter((p) => String(p.props.baseId) === baseId);

/** 按倍率缩放该基地全部化成工序的柜位数（= 拨真对象属性，走真仓储，非 mock）。 */
async function scaleFormationUnits(t: TestApp, baseId: string, div: number): Promise<number> {
  const procs = await processesAt(t, baseId);
  const forms = procs.filter((p) => p.props.capacityUnitKind === "化成柜位");
  expect(forms.length, "该基地无化成工序（数据半未落地）").toBeGreaterThan(0);
  for (const p of forms) {
    await t.repos.objects.put({ ...p, props: { ...p.props, channels: Math.floor(Number(p.props.channels) / div) } });
  }
  return forms.length;
}

describe("WO-SANDBOX-D3 · 工序硬容量（化成柜位）→ bottleneck_matrix 判定接缝", () => {
  it("SEAM 命门：改柜位数 → bottleneck_matrix 判定真的变（binding/缺口/张力，且既有因子「瓶颈工序」跟着动）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ── ① 运输层：数据半真落地（种子产出了引擎期待的形状） ────────────────────────────
    const procs = await processesAt(t, BASE);
    const formation = procs.find((p) => p.props.capacityUnitKind === "化成柜位");
    expect(formation, "Process 上无「化成柜位」硬容量单元标签（数据半未落地）").toBeTruthy();
    // 数值单源守护：柜位数**不另存副本**，仍读 Process.channels（否则拨 ② 杠杆会与副本漂移）。
    const spec = HARD_CAPACITY_UNIT_SPECS.find((s) => s.unitKind === "化成柜位")!;
    expect(spec.unitsProp).toBe("channels");
    const reading = readProcessHardCapacity(formation!.props);
    expect(reading.status).toBe("OK");
    expect(reading.status === "OK" && reading.units).toBe(Number(formation!.props.channels));
    // 串行工序**不带**硬容量属性（诚实缺，不是塞 0 冒充"有 0 个柜位"）。
    const serial = procs.find((p) => p.props.kind === "serial")!;
    expect(serial.props.capacityUnitKind).toBeUndefined();
    expect(serial.props.requiredThroughput).toBeUndefined();
    expect(readProcessHardCapacity(serial.props).status).toBe("EMPTY");

    // ── ② 效果层：基线 —— 硬容量读得到，且未夹定（不虚报紧张） ──────────────────────
    const base0 = await rowOf(t);
    const hc0 = base0.hardCapacity!;
    expect(hc0.status, "引擎半没把柜位当约束读到").toBe("OK");
    if (hc0.status !== "OK") throw new Error("unreachable");
    expect(hc0.binding).toBe(false);
    expect(hc0.shortfallPerDay).toBe(0);
    expect(hc0.tightness).toBe(0);
    expect(hc0.capacityPerDay).toBeGreaterThan(hc0.requiredPerDay);
    const bnTight0 = base0.tightness["瓶颈工序"]!;

    // ── ② 效果层命门 A：柜位砍半 → **判定结果**真的变（不是只有种子字段变） ──────────
    await scaleFormationUnits(t, BASE, 2);
    const base1 = await rowOf(t);
    const hc1 = base1.hardCapacity!;
    expect(hc1.status).toBe("OK");
    if (hc1.status !== "OK") throw new Error("unreachable");
    expect(hc1.unitKind, "夹定约束应换成化成柜位").toBe("化成柜位");
    // 数值单源实证：报出来的柜位数 === 该 processId 在仓储里的 `Process.channels` 真值
    //（若引擎读的是某个副本字段，拨真属性后这里必然对不上）。
    const bound1 = (await processesAt(t, BASE)).find((p) => p.props.processId === hc1.processId)!;
    expect(hc1.units, "柜位数与 Process.channels 真值不一致（引擎读的不是单源）").toBe(Number(bound1.props.channels));
    expect(hc1.units).toBeLessThan(hc0.units);
    // ★判定翻转：未夹定 → 夹定；缺口 0 → 真缺口；张力 0 → 真张力。
    expect(hc1.binding, "砍半柜位后仍判「未夹定」= 柜位没被当约束用").toBe(true);
    expect(hc1.shortfallPerDay).toBeGreaterThan(0);
    expect(hc1.tightness).toBeGreaterThan(hc0.tightness);
    expect(hc1.capacityPerDay).toBeLessThan(hc0.capacityPerDay);

    // ── ② 效果层命门 B：柜位砍到 1/20 → 连**既有因子「瓶颈工序」的张力**都真的变 ──────
    // （砍半时硬容量张力 50 仍低于产线利用率软代理 91，取最紧者故 91 不动 —— 这本身是正确行为；
    //   砍到 1/20 时硬约束成为最紧者，既有因子必须让位。此断言证明柜位真的进了瓶颈判定，
    //   而不是只多了一个旁挂字段。）
    await scaleFormationUnits(t, BASE, 10); // 累计 1/20
    const base2 = await rowOf(t);
    const hc2 = base2.hardCapacity!;
    expect(hc2.status).toBe("OK");
    if (hc2.status !== "OK") throw new Error("unreachable");
    expect(hc2.tightness).toBeGreaterThan(bnTight0);
    expect(base2.tightness["瓶颈工序"], "「瓶颈工序」张力没被硬容量抬起来 = 柜位仍未进判定").toBeGreaterThan(bnTight0);
    expect(base2.tightness["瓶颈工序"]).toBe(hc2.tightness);
    // 其他因子不受影响（改的是工序硬容量，不该污染物料/物流/换型）。
    for (const f of ["物料齐套", "物流时长", "换型损失", "人力工时"]) {
      expect(base2.tightness[f], `${f} 不应随柜位数变`).toBe(base0.tightness[f]);
    }

    // ── 未被改动的基地不受影响（改常州柜位不该动江门判定） ──────────────────────────
    const other = (await invokeBn(t, "jiangmen")).rows[0]!;
    expect(other.hardCapacity!.status).toBe("OK");
    if (other.hardCapacity!.status !== "OK") throw new Error("unreachable");
    expect(other.hardCapacity!.binding).toBe(false);
  }, 180000);

  it("诚实缺不兜底：删 requiredThroughput / 删柜位数 / 缺参 → EMPTY + 原因（绝不给默认柜位数）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ① 删掉比较基准 → 判不了「够不够」，诚实 EMPTY（不拿产能自比、不拿别的量顶上）。
    for (const p of await processesAt(t, BASE)) {
      const props = { ...p.props };
      delete props.requiredThroughput;
      await t.repos.objects.put({ ...p, props });
    }
    const r1 = (await rowOf(t)).hardCapacity!;
    expect(r1.status).toBe("EMPTY");
    if (r1.status !== "EMPTY") throw new Error("unreachable");
    expect(r1.reason).toContain("requiredThroughput");

    // ② 柜位数缺失 → EMPTY（不臆造柜位数）。
    const t2 = await makeApp();
    await seedBattery(t2);
    for (const p of await processesAt(t2, BASE)) {
      if (typeof p.props.capacityUnitKind !== "string") continue;
      await t2.repos.objects.put({ ...p, props: { ...p.props, channels: 0, agingSlots: 0 } });
    }
    const r2 = (await rowOf(t2)).hardCapacity!;
    expect(r2.status).toBe("EMPTY");
    if (r2.status !== "EMPTY") throw new Error("unreachable");
    expect(r2.reason).toMatch(/缺失或非正/);
    // 诚实缺时既有因子回到原口径，**不因缺数据就给个假张力**。
    expect((await rowOf(t2)).tightness["瓶颈工序"]).toBe(91);

    // ③ solver_params 缺 hardCapShortfallK → EMPTY（不按默认系数臆算张力）。
    const ctx = await t2.services.solvers.loadContext("demo");
    const live = { ...ctx.params.bottleneck.live } as Record<string, unknown>;
    delete live.hardCapShortfallK;
    const patched = { ...ctx, params: { ...ctx.params, bottleneck: { ...ctx.params.bottleneck, live: live as typeof ctx.params.bottleneck.live } } };
    const r3 = baseHardCapacity(patched, BASE);
    expect(r3.status).toBe("EMPTY");
    if (r3.status !== "EMPTY") throw new Error("unreachable");
    expect(r3.reason).toContain("hardCapShortfallK");
  }, 180000);

  it("R6 确定性：同 (industry=battery, scale, seed=42) 两跑 —— 工序硬容量字段与判定逐字节一致", async () => {
    const run = async (): Promise<string> => {
      const t = await makeApp();
      await seedBattery(t, 42);
      const procs = (await t.repos.objects.listByType("demo", "Process"))
        .filter((p) => typeof p.props.capacityUnitKind === "string")
        .map((p) => [p.props.processId, p.props.capacityUnitKind, p.props.channels, p.props.channelOutputDaily, p.props.agingSlots, p.props.agingDays, p.props.requiredThroughput])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const bn = (await t.services.solvers.invoke(CTX, "bottleneck_matrix", { dataMode: "LIVE" })) as BnOut;
      return JSON.stringify({ procs, hard: bn.rows.map((r) => [r.base, r.hardCapacity, r.tightness["瓶颈工序"]]) });
    };
    const a = await run();
    const b = await run();
    expect(b).toBe(a);
    // 且确实种到了每条产线（13 基地 × 10 产线 × {化成, 老化}）——不是空集合让确定性空转。
    expect(JSON.parse(a).procs.length).toBe(13 * 10 * 2);
  }, 180000);
});
