import { describe, expect, it } from "vitest";
import { makeApp, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type {
  OptimizerClient,
  OptimizationRequest,
  OptimizationResult,
  JobShopScheduleRequest,
  JobShopScheduleResult,
} from "../src/solvers/optimizer-client.js";
import { HttpOptimizerClient } from "../src/solvers/optimizer-client.js";

/**
 * WO-JOBSHOP-SCHEDULE · A8 小时级工序排程 solver（CP-SAT IntervalVar 可证最优）· SEAM 接缝测试。
 *
 * 分工同既有 *_optimize：CP-SAT 的**可证最优 + R6 确定性**由真 OR-Tools sidecar（env-gated）证；
 * 默认 CI 用 JS Mock 引擎证 datacore 侧「读工序对象 → 组 payload（工艺顺序/机器/换型）→ 映射输出形状 →
 * 缺引擎显式报错」接线对（不静默兜底）。
 *
 * env-gated 真 CP-SAT 跑法：
 *   PORT=4003 python3 services/optimizer/server.py &
 *   OPTIMIZER_BASE_URL=http://127.0.0.1:4003 pnpm --filter datacore exec vitest run test/jobshop-schedule.test.ts
 */

const CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
const SIDECAR = process.env.OPTIMIZER_BASE_URL;

/** 捕获 datacore 组好的 payload 并回放已知最优（证 datacore 侧组装/映射对，非证 CP-SAT）。 */
class MockJobShop implements OptimizerClient {
  req?: JobShopScheduleRequest;
  async solve(_r: OptimizationRequest): Promise<OptimizationResult> {
    return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
  }
  async solveJobShop(r: JobShopScheduleRequest): Promise<JobShopScheduleResult> {
    this.req = r;
    // 回放一个确定性排程（形状正确即可，真解由 sidecar 证）。
    const schedule = r.jobs.flatMap((j) =>
      j.ops.map((o, i) => ({ jobId: j.jobId, opId: o.opId, machine: o.machine, start: i * 100, end: i * 100 + o.duration })),
    );
    const makespan = Math.max(0, ...schedule.map((s) => s.end));
    return { status: "OPTIMAL", optimal: true, schedule, makespan, objective: makespan };
  }
}

/** 自建确定性 job/op/machine 对象（WO-JOBSHOP 交底：WorkOrder demo 未物化 → SEAM 内自建）。
 * 3 job（J1/J2/J3·model A/A/B）× 3 op（涂布→卷绕→化成，共享 coater/winder/former 三机器）。 */
const JOBS = [
  { jobId: "J1", model: "A" },
  { jobId: "J2", model: "A" },
  { jobId: "J3", model: "B" },
];
const OPS = [
  { opName: "涂布", order: 1, machine: "coater", duration: 120 },
  { opName: "卷绕", order: 2, machine: "winder", duration: 90 },
  { opName: "化成", order: 3, machine: "former", duration: 60 },
];

async function seedSchedule(t: TestApp, opType = "SchedOp", durOverride?: Record<string, number>): Promise<void> {
  await t.repos.ontologyTypes.put({
    id: `ot_${opType}`,
    tenantId: "demo",
    key: opType,
    displayName: "排程工序",
    domain: "process",
    version: 1,
    status: "ACTIVE",
    derivedProperties: [],
    sourceBindings: [],
    properties: [
      { propKey: "opId", dataType: "string", isPrimaryKey: true },
      { propKey: "jobId", dataType: "string", isPrimaryKey: false },
      { propKey: "machine", dataType: "string", isPrimaryKey: false },
      { propKey: "duration", dataType: "number", isPrimaryKey: false },
      { propKey: "order", dataType: "number", isPrimaryKey: false },
      { propKey: "group", dataType: "string", isPrimaryKey: false },
    ],
  });
  for (const j of JOBS) {
    for (const op of OPS) {
      const opId = `${j.jobId}-${op.opName}`;
      const duration = durOverride?.[opId] ?? op.duration;
      await t.repos.objects.put({
        id: `obj_${opId}`,
        tenantId: "demo",
        type: opType,
        props: { opId, jobId: j.jobId, machine: op.machine, duration, order: op.order, group: j.model },
      });
    }
  }
}

describe("WO-JOBSHOP · job_shop_schedule 接线（默认 CI · Mock 引擎）", () => {
  // 无 sidecar 才成立：设了 OPTIMIZER_BASE_URL 时 makeApp 自动接真引擎（不再"未接入"）。
  it.skipIf(SIDECAR)("未接入引擎 → 显式抛『未接入』（不静默兜底）", async () => {
    const t = await makeApp();
    await seedSchedule(t);
    await expect(t.services.solvers.invoke(CTX, "job_shop_schedule", { opType: "SchedOp" })).rejects.toThrow(/未接入/);
  });

  it("读工序对象 → 组 jobs payload（分 job、按工艺顺序排 op、带机器/时长/换型分组）", async () => {
    const t = await makeApp();
    await seedSchedule(t);
    const mock = new MockJobShop();
    t.services.solvers.setOptimizer(mock);
    await t.services.solvers.invoke(CTX, "job_shop_schedule", { opType: "SchedOp", changeoverType: "SchedCo" });
    expect(mock.req!.model).toBe("job_shop_schedule");
    // 3 job 稳定序 J1/J2/J3
    expect(mock.req!.jobs.map((j) => j.jobId)).toEqual(["J1", "J2", "J3"]);
    // 每 job 内工艺顺序（涂布→卷绕→化成）
    expect(mock.req!.jobs[0]!.ops.map((o) => o.order)).toEqual([1, 2, 3]);
    expect(mock.req!.jobs[0]!.ops.map((o) => o.machine)).toEqual(["coater", "winder", "former"]);
    // 换型分组 = 各 job 的 model（A/A/B）
    expect(mock.req!.jobs[0]!.ops[0]!.group).toBe("A");
    expect(mock.req!.jobs[2]!.ops[0]!.group).toBe("B");
  });

  it("输出形状 = SOLVER_OUTPUT_SHAPES.job_shop_schedule（8 键 + jobType/jobCount/summary）", async () => {
    const t = await makeApp();
    await seedSchedule(t);
    t.services.solvers.setOptimizer(new MockJobShop());
    const out = await t.services.solvers.invoke(CTX, "job_shop_schedule", { opType: "SchedOp" });
    for (const k of ["status", "optimal", "schedule", "makespan", "objective", "jobType", "jobCount", "summary"]) {
      expect(out).toHaveProperty(k);
    }
    expect(out.jobType).toBe("WorkOrder");
    expect(out.jobCount).toBe(3);
    expect(String(out.summary)).toContain("makespan");
  });

  it("A6/R2：只读本租户工序对象（listByType 带 tenantId）", async () => {
    const t = await makeApp();
    await seedSchedule(t);
    // 别租户同类型对象不得混入
    await t.repos.objects.put({ id: "obj_X", tenantId: "other", type: "SchedOp", props: { opId: "X-涂布", jobId: "X", machine: "coater", duration: 999, order: 1, group: "Z" } });
    const mock = new MockJobShop();
    t.services.solvers.setOptimizer(mock);
    await t.services.solvers.invoke(CTX, "job_shop_schedule", { opType: "SchedOp" });
    expect(mock.req!.jobs.map((j) => j.jobId)).toEqual(["J1", "J2", "J3"]); // 无 X
  });
});

describe.skipIf(!SIDECAR)("WO-JOBSHOP · 真 CP-SAT sidecar 端到端（OPTIMIZER_BASE_URL 起真 OR-Tools）", () => {
  it("SEAM-1：3 job×3 op → 真 CP-SAT → OPTIMAL + 每 op start<end + 同机器不重叠 + 工艺顺序 end[涂布]≤start[卷绕]≤start[化成]", async () => {
    const t = await makeApp();
    await seedSchedule(t);
    t.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
    const out = await t.services.solvers.invoke(CTX, "job_shop_schedule", { opType: "SchedOp", changeoverType: "SchedCo" });
    expect(out.status).toBe("OPTIMAL");
    const schedule = out.schedule as { jobId: string; opId: string; machine: string; start: number; end: number }[];
    expect(schedule.length).toBe(9);
    // 每 op start<end
    for (const s of schedule) expect(s.start).toBeLessThan(s.end);
    // 同机器 interval 两两不重叠
    const byMachine = new Map<string, typeof schedule>();
    for (const s of schedule) {
      const rows = byMachine.get(s.machine) ?? [];
      rows.push(s);
      byMachine.set(s.machine, rows);
    }
    for (const rows of byMachine.values()) {
      const sorted = [...rows].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.start).toBeGreaterThanOrEqual(sorted[i - 1]!.end);
    }
    // 同 job 工艺顺序 end[涂布]≤start[卷绕]≤start[化成]
    for (const j of JOBS) {
      const coat = schedule.find((s) => s.opId === `${j.jobId}-涂布`)!;
      const wind = schedule.find((s) => s.opId === `${j.jobId}-卷绕`)!;
      const form = schedule.find((s) => s.opId === `${j.jobId}-化成`)!;
      expect(coat.end).toBeLessThanOrEqual(wind.start);
      expect(wind.end).toBeLessThanOrEqual(form.start);
    }
  });

  it("SEAM-2：改一 op duration（化成 60→600）→ 重解 → makespan 严格变大（证真 CP-SAT 重解非缓存/写死）", async () => {
    const base = await makeApp();
    await seedSchedule(base);
    base.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
    const before = await base.services.solvers.invoke(CTX, "job_shop_schedule", { opType: "SchedOp", changeoverType: "SchedCo" });

    const bumped = await makeApp();
    await seedSchedule(bumped, "SchedOp", { "J1-化成": 600 });
    bumped.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
    const after = await bumped.services.solvers.invoke(CTX, "job_shop_schedule", { opType: "SchedOp", changeoverType: "SchedCo" });

    expect(Number(after.makespan)).toBeGreaterThan(Number(before.makespan)); // 排程随工单真变
  });

  it("SEAM-换型：加 ChangeoverMatrix（A→B 200 分钟）→ 重解 → makespan 变大（改换型→排程真变）", async () => {
    const t = await makeApp();
    await seedSchedule(t);
    t.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
    const noCo = await t.services.solvers.invoke(CTX, "job_shop_schedule", { opType: "SchedOp", changeoverType: "SchedCo" });
    // 加换型矩阵对象（分组 A→B / B→A 各 200 分钟）
    await t.repos.ontologyTypes.put({
      id: "ot_SchedCo", tenantId: "demo", key: "SchedCo", displayName: "换型矩阵", domain: "process", version: 1, status: "ACTIVE",
      derivedProperties: [], sourceBindings: [],
      properties: [{ propKey: "pairId", dataType: "string", isPrimaryKey: true }, { propKey: "fromModel", dataType: "string", isPrimaryKey: false }, { propKey: "toModel", dataType: "string", isPrimaryKey: false }, { propKey: "minutes", dataType: "number", isPrimaryKey: false }],
    });
    await t.repos.objects.put({ id: "co_ab", tenantId: "demo", type: "SchedCo", props: { pairId: "AB", fromModel: "A", toModel: "B", minutes: 200 } });
    await t.repos.objects.put({ id: "co_ba", tenantId: "demo", type: "SchedCo", props: { pairId: "BA", fromModel: "B", toModel: "A", minutes: 200 } });
    const withCo = await t.services.solvers.invoke(CTX, "job_shop_schedule", { opType: "SchedOp", changeoverType: "SchedCo" });
    expect(Number(withCo.makespan)).toBeGreaterThan(Number(noCo.makespan));
  });

  it("R6：同 seed 两次 solve → schedule 字节一致（CP-SAT seed+单线程）", async () => {
    const t = await makeApp();
    await seedSchedule(t);
    t.services.solvers.setOptimizer(new HttpOptimizerClient(SIDECAR!));
    const a = await t.services.solvers.invoke(CTX, "job_shop_schedule", { opType: "SchedOp", changeoverType: "SchedCo", seed: 42 });
    const b = await t.services.solvers.invoke(CTX, "job_shop_schedule", { opType: "SchedOp", changeoverType: "SchedCo", seed: 42 });
    expect(JSON.stringify(a.schedule)).toBe(JSON.stringify(b.schedule));
    expect(a.makespan).toBe(b.makespan);
  });
});
