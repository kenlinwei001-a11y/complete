import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { makeApp, type TestApp } from "./helpers.js";
import { seedA6ReferenceTemplate } from "../src/seed.js";

/**
 * A6-T2（审核方核发开口项·`REVIEW-A6-tails-verdict.md` §尾巴②）：A6 拟真值域 e2e 此前只有
 * `a6-value-domains.test.ts` 用 `app.inject`（进程内·非真 TCP socket）；真 HTTP socket 路径靠手跑 curl
 * 复现、**无自动回归** → HTTP 栈（路由/序列化/中间件/JSON 编解码）若回归 CI 抓不到。
 *
 * 本测试把那条真 socket 固化为回归：`app.listen(0)` 真起 TCP 监听 + `fetch` 真打（仿
 * `opt-real-sidecar.integration.test.ts` 真 socket 范式，但**自包含、无外部依赖、不 env-gate**），
 * 且**直接复用提交物里的 `seedA6ReferenceTemplate`**（= `SEED_A6_DEMO=1` 启动时所跑的同一函数）——
 * dogfood 真种子，不内联重复模板。断言：util 落业务区间 [0.62,0.95] + autoPlant 越线(>0.95) + R6 同 seed 字节一致。
 */
describe("A6-T2 · 拟真值域真 HTTP socket 端到端回归（app.listen + fetch·非 app.inject）", () => {
  let t: TestApp;
  let base: string;
  const headers = { "x-debug-user": "demo:admin:admin", "content-type": "application/json" };

  beforeAll(async () => {
    t = await makeApp({ seed: false }); // 隔离断言：非电池规则 scope 固定 Order
    await seedA6ReferenceTemplate(t.repos, "demo"); // 复用 SEED_A6_DEMO 同一提交函数（租户=demo 以对齐 debug 头）
    await t.app.listen({ port: 0, host: "127.0.0.1" }); // 真 TCP socket（port 0 = 随机空闲端口）
    const addr = t.app.server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await t.app.close();
  });

  async function generateUtils(seed: number): Promise<number[]> {
    const job = await fetch(`${base}/a/v1/synthetic/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ industry: "a6-reference", scale: "S", seed }),
    });
    expect(job.status).toBe(202); // 真 socket 202（非 inject）
    const objsRes = await fetch(`${base}/a/v1/objects?type=Order&pageSize=100`, { headers });
    expect(objsRes.status).toBe(200);
    const objs = (await objsRes.json()) as { data: { props: { util: number } }[] };
    return objs.data.map((o) => Number(o.props.util));
  }

  it("真 socket 合成 → util 落业务区间 + autoPlant 越线（HTTP 栈全链真跑）", async () => {
    const utils = await generateUtils(42);
    expect(utils.length).toBe(12);
    expect(utils.filter((u) => u > 0.95).length).toBeGreaterThanOrEqual(2); // autoPlant 从 BLOCK 规则反推越线样本
    expect(utils.filter((u) => u >= 0.62 && u <= 0.95).length).toBeGreaterThanOrEqual(8); // 拟真值域落业务区间
  });

  it("R6：同 (industry,scale,seed) 真 socket 重跑字节一致", async () => {
    const a = (await generateUtils(42)).slice().sort();
    const b = (await generateUtils(42)).slice().sort();
    expect(b).toEqual(a);
  });
});
