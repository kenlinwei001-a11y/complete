import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createTestApp, debugHeaders, PLANNER } from "./helpers.js";
import { createHttpDataCore } from "../src/tools/datacore-http.js";
import type { SolverTimeoutDiagnostics } from "@platform/contracts";

/**
 * WO-D2/D3 · 「超时之后用户什么都不知道、也什么都拿不到」的收口（效果层断言）。
 *
 * 病灶（审核方真跑坐实·承 WO-D1 取消已通到底层）：`POST /b/v1/solvers/{key}/run` 超时 15s → 504
 * `SOLVER_TIMEOUT`，载荷**只有一个错误码**：不说哪个求解器 / 跑了多久 / 数据多大 / 有没有可行解；
 * 而 CP-SAT 族在证最优前先有 **incumbent**（可行解），超时却**全丢** → 前端只剩泛化 toastError。
 *
 * 本文件全部断言在**效果层**（真起路由、真发请求、真读返回体），且每条都配**对照组/反证**，
 * 防「桩本来就那样」的假绿：
 *   ① 有 incumbent → 200 + **诚实标注非最优**（incumbent/optimal:false/proven:false/resultKind/notice 真在，
 *      且 data 内外双标；真解原样带回）——对照：不超时的同一桩走原样透传，**不带**任何 incumbent 标注。
 *   ② 无 incumbent → **仍 504，不许编**：三种「无解」形态（拒绝 / 空壳自述 / 一声不吭）各测一遍。
 *   ③ 诊断字段是**真值不是常数占位**：换超时阈值 → elapsedMs 真跟着变；换入参 → inputScale 真跟着变。
 *   ④ 加性向后兼容：504 的既有 `error` 信封逐字节不变（老前端只读 error.code 仍成立）。
 *   ⑤ B→A 真 HTTP 接缝：DataCore 用**自有预算**在调用方放弃前交卷 → 诚实标注一路穿到 B 的返回体
 *      （这是真链路上 incumbent 的**唯一**来路：取消 = 断链，断链之后 A 没有回程通道，见路由处诚实注记）。
 */

const SLOW_MS = 900; // 桩「跑到底」的时间：远大于各用例的超时阈值
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Payload = Record<string, unknown>;

/** 桩求解：SLOW_MS 才跑完；收到取消时按 `onCancel` 决定「交卷 / 拒绝 / 装死」。 */
function slowSolver(onCancel: () => Payload | "reject" | "silent") {
  return (_c: unknown, _k: string, _a: unknown, signal?: AbortSignal): Promise<Payload> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ data: { status: "OPTIMAL", optimal: true, occupancy: [{ item: "SO-1" }] }, snapshotVersion: 1 }), SLOW_MS);
      signal?.addEventListener(
        "abort",
        () => {
          const r = onCancel();
          if (r === "silent") return; // 装死：既不交卷也不拒绝（交卷窗口耗尽）
          clearTimeout(timer);
          if (r === "reject") return reject(new Error("SOLVER_CANCELLED: aborted by caller"));
          resolve(r); // 交卷：把已找到的可行解交回来
        },
        { once: true },
      );
    });
}

/** 「已找到可行解」的交卷载荷：底层自报 FEASIBLE/非最优 + **真带解**。 */
const incumbentPayload = (): Payload => ({
  data: {
    status: "FEASIBLE",
    optimal: false,
    occupancy: [
      { item: "SO-1", base: "CZ", window: 0, qty: 1200 },
      { item: "SO-2", base: "YC", window: 1, qty: 800 },
      { item: "SO-3", base: "CZ", window: 1, qty: 500 },
    ],
    allocation: [{ item: "SO-1", base: "CZ", window: 0, qty: 1200 }],
    capacityLedger: [
      { baseId: "CZ", window: 0, cap: 5000, allocated: 1200 },
      { baseId: "CZ", window: 1, cap: 5000, allocated: 500 },
      { baseId: "YC", window: 1, cap: 4000, allocated: 800 },
    ],
    summary: "已找到可行解",
  },
  snapshotVersion: 42,
});

const ARGS_SMALL = { objective: "max_ontime", scenarios: ["max_ontime", "min_cost"] };
const ARGS_BIG = {
  objective: "max_ontime",
  scenarios: ["max_ontime", "min_cost", "min_delay"],
  orderIds: Array.from({ length: 12 }, (_, i) => `SO-${i}`),
  frozenOrderIds: ["SO-9", "SO-10"],
};

const run = async (t: Awaited<ReturnType<typeof createTestApp>>, args: Record<string, unknown>, key = "portfolio") =>
  t.app.inject({ method: "POST", url: `/b/v1/solvers/${key}/run`, headers: debugHeaders(PLANNER), payload: { args } });

describe("WO-D2 · 超时前先回可行解（incumbent·诚实标注非最优）", () => {
  it("① 有 incumbent → 200 + 诚实标注（标注字段真在·真解带回）；对照：不超时则无任何 incumbent 标注", async () => {
    const t = await createTestApp();
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 150;
    (t.deps.dataCore.solver as { invoke: unknown }).invoke = slowSolver(() => incumbentPayload());

    const t0 = Date.now();
    const r = await run(t, ARGS_BIG);
    const elapsed = Date.now() - t0;
    expect(r.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(SLOW_MS); // 确实是超时早返，不是等它跑完

    const b = r.json() as Payload & { data: Payload; diagnostics: SolverTimeoutDiagnostics };
    // ── 诚实标注：顶层 ──
    expect(b.incumbent).toBe(true);
    expect(b.optimal).toBe(false);
    expect(b.proven).toBe(false);
    expect(b.resultKind).toBe("incumbent");
    expect(b.degraded).toBe(true);
    expect(String(b.notice)).toContain("非最优");
    expect(String(b.notice)).toContain("incumbent");
    // ── 诚实标注：data 内（防调用方只读 res.data 而误以为拿到最优解）──
    expect(b.data.incumbent).toBe(true);
    expect(b.data.optimal).toBe(false);
    expect(b.data.resultKind).toBe("incumbent");
    // ── 真解原样带回（不是只给一句"有解"）──
    expect((b.data.occupancy as unknown[]).length).toBe(3);
    expect(b.snapshotVersion).toBe(42);
    // ── 诊断同挂 ──
    expect(b.diagnostics.hasIncumbent).toBe(true);
    expect(b.diagnostics.phase).toBe("incumbent_returned");
    expect(b.diagnostics.solverKey).toBe("portfolio");

    // 对照组（防假绿）：阈值放宽 → 同一个桩跑到底 → 原样透传，**不带**任何 incumbent 标注/诊断
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 5_000;
    const ok = await run(t, ARGS_BIG);
    expect(ok.statusCode).toBe(200);
    const okBody = ok.json() as Payload & { data: Payload };
    expect(okBody.incumbent).toBeUndefined();
    expect(okBody.resultKind).toBeUndefined();
    expect(okBody.diagnostics).toBeUndefined();
    expect(okBody.data.optimal).toBe(true); // 最优解就是最优解，没被改标成 incumbent
  }, 20_000);

  it("② 无 incumbent 的三种形态 → 一律仍 504，绝不编造", async () => {
    // (a) 底层拒绝（真 HTTP 断链的同款形状）
    const ta = await createTestApp();
    ta.deps.config.SOLVER_RUN_TIMEOUT_MS = 120;
    (ta.deps.dataCore.solver as { invoke: unknown }).invoke = slowSolver(() => "reject");
    const ra = await run(ta, ARGS_SMALL);
    expect(ra.statusCode).toBe(504);
    const ba = ra.json() as { error: { code: string }; incumbent?: unknown; data?: unknown; diagnostics: SolverTimeoutDiagnostics };
    expect(ba.error.code).toBe("SOLVER_TIMEOUT");
    expect(ba.incumbent).toBeUndefined(); // 没有就是没有
    expect(ba.data).toBeUndefined();
    expect(ba.diagnostics.hasIncumbent).toBe(false);
    expect(ba.diagnostics.phase).toBe("aborted_no_result");
    expect(String(ba.diagnostics.underlyingError)).toContain("SOLVER_CANCELLED");

    // (b) **空壳**：自报 FEASIBLE/非最优，但一个解字段都没有 → 不许当 incumbent 蒙混过关
    const tb = await createTestApp();
    tb.deps.config.SOLVER_RUN_TIMEOUT_MS = 120;
    (tb.deps.dataCore.solver as { invoke: unknown }).invoke = slowSolver(() => ({
      data: { status: "FEASIBLE", optimal: false, occupancy: [], allocation: [], summary: "什么都没求到" },
    }));
    const rb = await run(tb, ARGS_SMALL);
    expect(rb.statusCode).toBe(504);
    const bb = rb.json() as { error: { code: string }; incumbent?: unknown; diagnostics: SolverTimeoutDiagnostics };
    expect(bb.error.code).toBe("SOLVER_TIMEOUT");
    expect(bb.incumbent).toBeUndefined();
    expect(bb.diagnostics.hasIncumbent).toBe(false);
    expect(bb.diagnostics.phase).toBe("incumbent_handback"); // 回来了，但没带可用的解

    // (c) 装死：交卷窗口内一声不吭
    const tc = await createTestApp();
    tc.deps.config.SOLVER_RUN_TIMEOUT_MS = 120;
    (tc.deps.dataCore.solver as { invoke: unknown }).invoke = slowSolver(() => "silent");
    const rc = await run(tc, ARGS_SMALL);
    expect(rc.statusCode).toBe(504);
    const bc = rc.json() as { error: { code: string }; diagnostics: SolverTimeoutDiagnostics };
    expect(bc.error.code).toBe("SOLVER_TIMEOUT");
    expect(bc.diagnostics.hasIncumbent).toBe(false);
    expect(bc.diagnostics.phase).toBe("dispatched");
  }, 30_000);

  it("③ 最优解绝不被改标成 incumbent（即便它在交卷窗口内才回来）", async () => {
    const t = await createTestApp();
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 120;
    // 收到取消就交回一个**自称最优**的解 → 不满足 incumbent 判据（optimal:true 一票否决）→ 照旧 504
    (t.deps.dataCore.solver as { invoke: unknown }).invoke = slowSolver(() => ({
      data: { status: "OPTIMAL", optimal: true, occupancy: [{ item: "SO-1" }] },
    }));
    const r = await run(t, ARGS_SMALL);
    expect(r.statusCode).toBe(504);
    expect((r.json() as { diagnostics: SolverTimeoutDiagnostics }).diagnostics.hasIncumbent).toBe(false);
  }, 20_000);
});

describe("WO-D3 · 超时诊断带真值（不是常数占位）", () => {
  it("④ 耗时是真耗时（换阈值 → 真跟着变）· 规模是真规模（换入参 → 真跟着变）", async () => {
    const t = await createTestApp();
    (t.deps.dataCore.solver as { invoke: unknown }).invoke = slowSolver(() => "reject");

    // —— 小入参 + 短阈值 ——
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 120;
    const r1 = await run(t, ARGS_SMALL, "capacity_forecast");
    expect(r1.statusCode).toBe(504);
    const d1 = (r1.json() as { diagnostics: SolverTimeoutDiagnostics }).diagnostics;

    // —— 大入参 + 长阈值 ——
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 420;
    const r2 = await run(t, ARGS_BIG, "portfolio");
    expect(r2.statusCode).toBe(504);
    const d2 = (r2.json() as { diagnostics: SolverTimeoutDiagnostics }).diagnostics;

    // solverKey：真的是被调那个（两次不同）
    expect(d1.solverKey).toBe("capacity_forecast");
    expect(d2.solverKey).toBe("portfolio");
    // timeoutMs：真的是生效阈值
    expect(d1.timeoutMs).toBe(120);
    expect(d2.timeoutMs).toBe(420);
    // elapsedMs：**真耗时**——≥ 各自阈值，且随阈值真变大（常数占位过不了这关）
    expect(d1.elapsedMs).toBeGreaterThanOrEqual(120);
    expect(d1.elapsedMs).toBeLessThan(420);
    expect(d2.elapsedMs).toBeGreaterThanOrEqual(420);
    expect(d2.elapsedMs - d1.elapsedMs).toBeGreaterThan(200); // 差值 ≈ 阈值差，证明是真测的
    // inputScale：**真规模**——逐键真计数，随入参真变
    expect(d1.inputScale?.source).toBe("args");
    expect(d1.inputScale?.counts).toEqual({ scenarios: 2 });
    expect(d1.inputScale?.totalElements).toBe(2);
    expect(d1.inputScale?.argKeys).toEqual(["objective", "scenarios"]);
    expect(d2.inputScale?.counts).toEqual({ scenarios: 3, orderIds: 12, frozenOrderIds: 2 });
    expect(d2.inputScale?.totalElements).toBe(17);
    expect(d2.inputScale?.argKeys).toEqual(["frozenOrderIds", "objective", "orderIds", "scenarios"]);
    // 取消真的发起过（D1 语义未被本 WO 改坏）
    expect(d1.cancelRequested).toBe(true);
    expect(typeof d1.honestNote).toBe("string");
  }, 30_000);

  it("⑤ 有 incumbent 时规模并入**实测**解规模（source 升级 mixed·非入参猜的）", async () => {
    const t = await createTestApp();
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 130;
    (t.deps.dataCore.solver as { invoke: unknown }).invoke = slowSolver(() => incumbentPayload());
    const r = await run(t, ARGS_BIG);
    expect(r.statusCode).toBe(200);
    const d = (r.json() as { diagnostics: SolverTimeoutDiagnostics }).diagnostics;
    expect(d.inputScale?.source).toBe("mixed");
    // 入参侧真计数仍在
    expect(d.inputScale?.counts.orderIds).toBe(12);
    // 解侧**实测**计数（桩里 occupancy 3 条 / allocation 1 条 / 台账 3 格 / 去重基地 2 个）
    expect(d.inputScale?.counts["solution.occupancy"]).toBe(3);
    expect(d.inputScale?.counts["solution.allocation"]).toBe(1);
    expect(d.inputScale?.counts["solution.capacityCells"]).toBe(3);
    expect(d.inputScale?.counts["solution.bases"]).toBe(2);
  }, 20_000);

  it("⑥ 加性向后兼容：504 的既有 error 信封逐字节不变（老前端只读 error.code/message/requestId 仍成立）", async () => {
    const t = await createTestApp();
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 100;
    (t.deps.dataCore.solver as { invoke: unknown }).invoke = slowSolver(() => "reject");
    const r = await run(t, ARGS_SMALL, "capacity_forecast");
    expect(r.statusCode).toBe(504);
    const b = r.json() as { error: { code: string; message: string; requestId: string } };
    expect(Object.keys(b.error).sort()).toEqual(["code", "message", "requestId"]);
    expect(b.error.code).toBe("SOLVER_TIMEOUT");
    expect(b.error.message).toContain("capacity_forecast");
    expect(b.error.message).toContain("100ms");
    expect(typeof b.error.requestId).toBe("string");
    expect(b.error.requestId.length).toBeGreaterThan(0);
  }, 20_000);
});

// ── ⑤ B→A 真 HTTP 接缝：真链路上 incumbent 的唯一来路 = DataCore 用**自有预算**赶在调用方放弃前交卷 ──
describe("WO-D2 · B→A 真 HTTP 接缝（DataCore 自有预算交卷 → 诚实标注穿到 B 返回体）", () => {
  let stub: Server;
  let stubUrl: string;
  /** 桩 DataCore：模拟 SOLVER_INCUMBENT_BUDGET_MS 到点收手 —— 在调用方超时**之前**回 incumbent。 */
  const dcBudgetMs = 120;

  beforeAll(async () => {
    stub = createServer((req, res) => {
      req.resume();
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: {
              status: "FEASIBLE",
              optimal: false,
              incumbent: true,
              incumbentReason: "求解时间预算耗尽：已求出主方案可行解，剩余方案未求解",
              occupancy: [{ item: "SO-1", base: "CZ", window: 0, qty: 1200 }],
              solvedScenarios: ["max_ontime"],
              plannedScenarios: ["max_ontime", "min_cost"],
            },
            snapshotVersion: 7,
          }),
        );
      }, dcBudgetMs);
    });
    await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
    stubUrl = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => stub.close(() => r()));
  });

  it("⑦ A 侧预算 < B 侧超时 → 可行解真跨过网线，且一路带着「非最优」自述（不被 B 抹平成最优）", async () => {
    const t = await createTestApp();
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 600; // 必须 > A 侧预算，解才来得及回
    (t.deps.dataCore as { solver: unknown }).solver = createHttpDataCore(stubUrl).solver;

    const r = await run(t, ARGS_SMALL);
    expect(r.statusCode).toBe(200);
    const b = r.json() as { data: Payload };
    // A 侧的诚实自述原样穿到 B 的返回体（B 没有把它抹平/升格成最优）
    expect(b.data.incumbent).toBe(true);
    expect(b.data.optimal).toBe(false);
    expect(b.data.status).toBe("FEASIBLE");
    expect(String(b.data.incumbentReason)).toContain("预算耗尽");
    expect((b.data.occupancy as unknown[]).length).toBe(1);

    // 反证（诚实边界）：把 B 的超时压到 A 的预算之下 → 取消即断链，A 再想交卷也没有回程通道 → 504、无解。
    // 这正是路由处诚实注记说的「真 HTTP 上本层拿不到 incumbent」——不假装能拿。
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 40;
    const late = await run(t, ARGS_SMALL);
    expect(late.statusCode).toBe(504);
    const lb = late.json() as { error: { code: string }; diagnostics: SolverTimeoutDiagnostics };
    expect(lb.error.code).toBe("SOLVER_TIMEOUT");
    expect(lb.diagnostics.hasIncumbent).toBe(false);
    await sleep(dcBudgetMs + 50); // 让桩把那次响应写完再收尾（避免测试间串扰）
  }, 20_000);
});
