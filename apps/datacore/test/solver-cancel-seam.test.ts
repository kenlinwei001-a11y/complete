import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { HttpOptimizerClient } from "../src/solvers/optimizer-client.js";
import { runWithCancellation, SolverCancelledError } from "../src/solvers/cancellation.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-D1 · DataCore 侧「取消传到求解执行 / 优化器 sidecar 调用」（效果层断言）。
 *
 * 链路：客户端（AgentCore 超时后 abort 了 OBO fetch，或前端 AbortController）断链
 *   → `POST /a/v1/solvers/:key/invoke` 的 reply.raw "close"
 *   → 请求作用域取消令牌 abort（solvers/cancellation.ts）
 *   → ① optimizer sidecar 的 fetch 被 abort（连接真中断，sidecar 服务端观察得到）
 *      ② 求解执行的 await 检查点直接抛 SolverCancelledError（不再往下烧 CPU / 打仓储）
 *
 * ⚠ 诚实边界（本测试**不**冒充自己证明了它）：这里的桩 sidecar 是**行为良好**的——它监听连接关闭并
 * 主动停掉自己的作业，所以 `finished=0`。真正的 `services/optimizer/server.py`（ThreadingHTTPServer +
 * BaseHTTPRequestHandler）**没有取消接口、也不感知客户端断开**，那个线程会把当次 CP-SAT 求完。
 * 因此本测试的**核心判据是 `abortedByClient===1`**——我们这一层能保证的真效果是"连接真被中断、
 * sidecar 侧确实观察得到断开"；让 Python 侧据此停算需要给 services/optimizer 加取消能力（不在本 WO 边界）。
 */

const SLOW_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("WO-D1 · DataCore 求解取消（客户端断链 → sidecar 调用真中断）", () => {
  let sidecar: Server;
  let sidecarUrl: string;
  const led = { started: 0, finished: 0, abortedByClient: 0 };
  let t: TestApp;
  let baseUrl: string;

  beforeAll(async () => {
    sidecar = createServer((req, res) => {
      req.resume();
      led.started += 1;
      let done = false;
      const timer = setTimeout(() => {
        done = true;
        led.finished += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "OPTIMAL", optimal: true, selected: [], totalValue: 0, totalWeight: 0 }));
      }, SLOW_MS);
      res.on("close", () => {
        if (done) return;
        clearTimeout(timer);
        led.abortedByClient += 1; // sidecar 侧**真的**看见调用方断开了
      });
    });
    await new Promise<void>((r) => sidecar.listen(0, "127.0.0.1", r));
    sidecarUrl = `http://127.0.0.1:${(sidecar.address() as { port: number }).port}`;

    t = await makeApp();
    t.services.solvers.setOptimizer(new HttpOptimizerClient(sidecarUrl)); // 真 HTTP 优化器客户端（生产同一份代码）
    baseUrl = await t.app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await t.app.close();
    await new Promise<void>((r) => sidecar.close(() => r()));
  });

  const invokeSelection = (signal?: AbortSignal) =>
    fetch(`${baseUrl}/a/v1/solvers/selection_optimize/invoke`, {
      method: "POST",
      headers: { ...ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ args: { itemType: "Order", budget: 10 } }),
      ...(signal ? { signal } : {}),
    });

  it("① 对照组：不取消 → sidecar 调用正常跑完（证明记账是活的）", async () => {
    led.started = 0;
    led.finished = 0;
    led.abortedByClient = 0;
    const res = await invokeSelection();
    expect(res.status).toBe(200);
    expect(led.started).toBe(1);
    expect(led.finished).toBe(1);
    expect(led.abortedByClient).toBe(0);
  }, 20_000);

  it("② 客户端断链 → sidecar 侧观察到断开，底层作业不再 finish", async () => {
    led.started = 0;
    led.finished = 0;
    led.abortedByClient = 0;
    const ac = new AbortController();
    const pending = invokeSelection(ac.signal);
    await sleep(150); // 让请求真打到 sidecar（started=1）再断
    ac.abort();
    await expect(pending).rejects.toThrow();

    await sleep(SLOW_MS + 200); // 若没真取消，600ms 的桩作业早就 finish 了
    expect(led.started).toBe(1);
    expect(led.abortedByClient).toBe(1); // 核心判据：取消真达 sidecar 调用层（连接中断）
    expect(led.finished).toBe(0);
  }, 20_000);

  it("③ 已取消的作用域 → 求解入口检查点直接抛 SOLVER_CANCELLED（不再打仓储/烧 CPU）", async () => {
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    const ac = new AbortController();
    ac.abort();
    await expect(
      runWithCancellation(ac.signal, () => t.services.solvers.invoke(ctx, "selection_optimize", { itemType: "Order", budget: 10 })),
    ).rejects.toBeInstanceOf(SolverCancelledError);
    // 对照：无取消作用域 → 行为不变（照常走到 sidecar）
    const before = led.started;
    await t.services.solvers.invoke(ctx, "selection_optimize", { itemType: "Order", budget: 10 });
    expect(led.started).toBe(before + 1);
  }, 20_000);
});
