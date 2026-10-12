import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createTestApp, debugHeaders, PLANNER } from "./helpers.js";
import { createHttpDataCore } from "../src/tools/datacore-http.js";

/**
 * WO-D1 · 同步求解超时/断开 → **真取消**底层求解（效果层断言，非"传了 signal"的运输层断言）。
 *
 * 病灶（审核方真跑坐实）：`POST /b/v1/solvers/{key}/run` 用 `Promise.race([invoke, timeout])` 做 15s 超时
 * → 504 SOLVER_TIMEOUT。**`Promise.race` 只是不再等它，不是取消它**：
 *     HTTP 504 @169ms   started=1  finished=0
 *     504 之后再等 700ms：started=1 finished=1  → 底层求解跑到底了
 * 全局推演页 portfolio（最重求解器·滑杆 debounce 300ms 连发）于是不断叠加求解，用户见「超时」再调参重试，
 * 服务端旧求解仍在烧。前端 AbortController 只断 HTTP 连接，传不到 DataCore。
 *
 * 本文件三条断言全部在**效果层**（"底层作业还 finish 不 finish"），且每条都配对照组（不取消 → finished=1），
 * 防"stub 本来就不会 finish"的假绿：
 *   ① 超时 → 求解客户端收到取消信号且底层作业不再 finish（审核方探针同款形状）
 *   ② 真 HTTP 接缝（B→A over the wire）：DataCore 侧**服务端**观察到客户端断链 → 底层作业不再 finish
 *   ③ 客户端主动断开（前端 AbortController 同款）→ 走同一条取消路径（此时超时阈值远未到）
 */

const SLOW_MS = 600;
const WAIT_AFTER_MS = 700; // 504 之后再等这么久：若没真取消，底层作业早就 finish 了

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── ① 求解客户端桩（审核方探针同款：记账 started/finished，并按取消信号真停） ───────────────────
interface Ledger {
  started: number;
  finished: number;
  /** 是否真的收到了取消信号参数（探针原话：「取消信号透传：(未收到任何取消信号参数)」）。 */
  sawSignal: boolean;
}

function slowSolverStub(ledger: Ledger) {
  return (_ctx: unknown, _key: string, _args: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> => {
    ledger.started += 1;
    ledger.sawSignal = signal instanceof AbortSignal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ledger.finished += 1; // 只有"跑到底"才计 finished —— 效果层的唯一判据
        resolve({ data: { ok: true } });
      }, SLOW_MS);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer); // 真停：作业被取消，不会再 finish
          reject(new Error("SOLVER_CANCELLED: aborted by caller"));
        },
        { once: true },
      );
    });
  };
}

describe("WO-D1 · 求解取消（超时/断开 → 底层作业真停，非仅不再等待）", () => {
  it("① 超时 504 后底层作业不再 finish（对照：不超时则 finish=1）", async () => {
    const t = await createTestApp();
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 150;
    const ledger: Ledger = { started: 0, finished: 0, sawSignal: false };
    (t.deps.dataCore.solver as { invoke: unknown }).invoke = slowSolverStub(ledger);

    const t0 = Date.now();
    const r = await t.app.inject({
      method: "POST",
      url: "/b/v1/solvers/portfolio/run",
      headers: debugHeaders(PLANNER),
      payload: { args: { objective: "max_ontime" } },
    });
    const elapsed = Date.now() - t0;
    expect(r.statusCode).toBe(504);
    expect((r.json() as { error: { code: string } }).error.code).toBe("SOLVER_TIMEOUT");
    expect(elapsed).toBeLessThan(SLOW_MS); // 确实是超时早返，不是等它跑完
    expect(ledger.started).toBe(1);
    expect(ledger.sawSignal).toBe(true); // 契约：invoke 真收到 AbortSignal（此前"未收到任何取消信号参数"）

    await sleep(WAIT_AFTER_MS);
    // 头号判据：504 之后再等 700ms，底层作业**不再 finish**（修前此处 finished=1）
    expect(ledger.finished).toBe(0);

    // 对照组（防假绿）：阈值放宽 → 同一个桩会正常 finish，证明 finished 计数本身是活的
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 5_000;
    const ok = await t.app.inject({
      method: "POST",
      url: "/b/v1/solvers/portfolio/run",
      headers: debugHeaders(PLANNER),
      payload: { args: { objective: "max_ontime" } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ledger.finished).toBe(1);
  }, 15_000);
});

// ── ②③ 真 HTTP 接缝：AgentCore(真路由 + 真 HttpSolverClient) → 桩 DataCore（服务端观察断链） ──────
describe("WO-D1 · B→A 真 HTTP 接缝（取消跨进程传到 DataCore 侧，非只在 B 内部打转）", () => {
  let stub: Server;
  let stubUrl: string;
  const dc = { started: 0, finished: 0, abortedByClient: 0 };

  beforeAll(async () => {
    stub = createServer((req, res) => {
      req.resume(); // 丢掉请求体（不读会卡住连接）
      if (!req.url?.startsWith("/a/v1/solvers/")) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "no", requestId: "r" } }));
      }
      // 充当 DataCore 的慢求解：600ms 才出结果；期间若客户端断链（AgentCore abort 了 fetch），
      // 服务端 res "close" 先到 → 取消底层作业（这正是真 DataCore 侧 reply.raw "close" 的同款语义）。
      dc.started += 1;
      let done = false;
      const timer = setTimeout(() => {
        done = true;
        dc.finished += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { ok: true }, snapshotVersion: 1 }));
      }, SLOW_MS);
      res.on("close", () => {
        if (done) return;
        clearTimeout(timer);
        dc.abortedByClient += 1; // 服务端**真的**看见客户端走了
      });
    });
    await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
    const addr = stub.address() as { port: number };
    stubUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => stub.close(() => r()));
  });

  it("② 超时 → 真 fetch 被 abort → DataCore 侧观察到断链且底层作业不再 finish", async () => {
    dc.started = 0;
    dc.finished = 0;
    dc.abortedByClient = 0;
    const t = await createTestApp();
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 150;
    // 真 HTTP 客户端（生产同一份代码路径·非 mock）指向桩 DataCore
    (t.deps.dataCore as { solver: unknown }).solver = createHttpDataCore(stubUrl).solver;

    const r = await t.app.inject({
      method: "POST",
      url: "/b/v1/solvers/portfolio/run",
      headers: debugHeaders(PLANNER),
      payload: { args: { objective: "max_ontime" } },
    });
    expect(r.statusCode).toBe(504);
    expect(dc.started).toBe(1);

    await sleep(WAIT_AFTER_MS);
    expect(dc.abortedByClient).toBe(1); // 取消真过了网线（修前：DataCore 侧毫不知情）
    expect(dc.finished).toBe(0); // 底层作业没跑到底

    // 对照组：不超时 → 同一条真 HTTP 路径正常 finish（证明桩会 finish）
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 5_000;
    const ok = await t.app.inject({
      method: "POST",
      url: "/b/v1/solvers/portfolio/run",
      headers: debugHeaders(PLANNER),
      payload: { args: { objective: "max_ontime" } },
    });
    expect(ok.statusCode).toBe(200);
    expect(dc.finished).toBe(1);
  }, 20_000);

  it("③ 客户端主动断开（前端 AbortController 同款）→ 同一条取消路径（超时阈值远未到）", async () => {
    dc.started = 0;
    dc.finished = 0;
    dc.abortedByClient = 0;
    const t = await createTestApp();
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 30_000; // 取消绝不可能来自超时
    (t.deps.dataCore as { solver: unknown }).solver = createHttpDataCore(stubUrl).solver;
    const baseUrl = await t.app.listen({ port: 0, host: "127.0.0.1" });

    try {
      const ac = new AbortController();
      const pending = fetch(`${baseUrl}/b/v1/solvers/portfolio/run`, {
        method: "POST",
        headers: debugHeaders(PLANNER),
        body: JSON.stringify({ args: { objective: "max_ontime" } }),
        signal: ac.signal,
      });
      await sleep(150);
      ac.abort(); // 前端用户改了滑杆 / 关了页面
      await expect(pending).rejects.toThrow();

      await sleep(WAIT_AFTER_MS);
      expect(dc.started).toBe(1);
      expect(dc.abortedByClient).toBe(1); // 断开顺着 B→A 传到底
      expect(dc.finished).toBe(0);

      // 对照组：不断开 → 正常 200 且 finish
      const okRes = await fetch(`${baseUrl}/b/v1/solvers/portfolio/run`, {
        method: "POST",
        headers: debugHeaders(PLANNER),
        body: JSON.stringify({ args: { objective: "max_ontime" } }),
      });
      expect(okRes.status).toBe(200);
      expect(dc.finished).toBe(1);
    } finally {
      await t.app.close();
    }
  }, 20_000);
});
