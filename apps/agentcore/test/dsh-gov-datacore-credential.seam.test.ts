/**
 * WO-AGENT-DSH-DEFAULT · DSH 治理带外通道 → DataCore 的**凭据接缝**。
 *
 * ## 这条缝为什么以前没人测到
 *
 * `dsh-gov-production.seam.test.ts` 五臂全绿，但它们每一臂都
 * `vi.spyOn(t.dataCore.rules, "evaluate").mock…` —— **把 DataCore 这一跳整个换掉了**。
 * 于是那五臂证明的是「端点↔插件的裁决契约」，**不是**「端点真的能把裁决问到 DataCore」。
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   「我用『治理端点返回了 allow/deny』当作『治理链路通』的证据，而前者并不度量后者
 *     —— 被 mock 掉的那一跳恰好就是断的那一跳。」
 *
 * ## 今天的真相（本用例把它钉住）
 *
 * `server.ts` 的 `POST /b/v1/governance/adjudicate` 造的服务间 ctx 是
 *   `{ tenantId, userId: "svc:dsh-governance", roles: ["service"] }`
 * —— **既没有 `token` 也没有 `debugUser`**。而 `tools/datacore-http.ts` 的 `call()` 只认这两者：
 *   `ctx.token ? Bearer : ctx.debugUser ? x-debug-user : {}`（三元的第三支 = **一个头都不发**）。
 * ⇒ 生产装配（`main.ts` `createHttpDataCore(DATACORE_BASE_URL)`）下，
 *   `/a/v1/rules/evaluate` 收到的是**裸请求**，DataCore `ctx(req)` 判 401。
 *
 * 后果不是「少一条治理」，是**烧钱的无界循环**：插件对非 200 一律 fail-closed 转 deny
 * （`platform-governance.mjs` http 分支），模型拿到 deny 后重试；而 `final_answer` 在
 * `platform-watchdog.mjs` 的 `META_TOOLS` 里被**豁免**环检测，deny 又发生在 `tools/pre-execute`
 * （watchdog 挂的是 `tools/post-execute`）⇒ 计数器永不递增 ⇒ 谁都不喊停。
 * 本单真跑实测：单条问句烧掉 **305,532 + 111,780 tokens / ~4,963 轮**，答案为空。
 *
 * ## 本用例的立场
 *
 * 这是**表征测试（characterization test）**：它断言的是「今天确实断在这里」，
 * 不是「这样才对」。修好那一跳（给 ctx 带上服务凭据，或让 DataCore 认 `x-service-token`）
 * 之后本用例**应当变红**，那是正确的红 —— 届时把断言翻成正向（必须带凭据）即可。
 * 在此之前，它的作用是让**机器先说话**：谁要把 agent 默认翻到 EXTERNAL，先过这一关。
 */
import { describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpDataCore } from "../src/tools/datacore-http.js";
import { createTestApp } from "./helpers.js";

const SERVICE_TOKEN = "seam-service-token-0000";

interface SeenRequest {
  url: string;
  authorization: string | undefined;
  debugUser: string | undefined;
  serviceToken: string | undefined;
}

/**
 * 假 DataCore：语义对位真 DataCore `/a/v1/rules/evaluate` 的 `ctx(req)` ——
 * 无 `authorization` 且无 `x-debug-user` ⇒ 401 `authentication required`（真服务实测同文案）。
 */
async function startFakeDataCore(): Promise<{ url: string; seen: SeenRequest[]; close: () => Promise<void> }> {
  const seen: SeenRequest[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const authorization = req.headers.authorization as string | undefined;
      const debugUser = req.headers["x-debug-user"] as string | undefined;
      seen.push({
        url: req.url ?? "",
        authorization,
        debugUser,
        serviceToken: req.headers["x-service-token"] as string | undefined,
      });
      if (!authorization && !debugUser) {
        res
          .writeHead(401, { "content-type": "application/json" })
          .end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "authentication required" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify([]));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("WO-AGENT-DSH-DEFAULT · DSH 治理带外通道 → DataCore 凭据接缝", () => {
  it("① 裁决端点经**真 HTTP 客户端**问 DataCore 时，一个鉴权头都不发 ⇒ DataCore 401（= 生产装配下治理必 deny）", async () => {
    const dc = await startFakeDataCore();
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    try {
      // 关键：把 mock 换成**真** HTTP 客户端（生产 main.ts 用的就是 createHttpDataCore）。
      // 端点自己造的 ctx 因此原样流进 call() 的鉴权三元 —— 这正是五臂 mock 掉的那一跳。
      const httpDataCore = createHttpDataCore(dc.url);
      vi.spyOn(t.dataCore.rules, "evaluate").mockImplementation((ctx, ruleIds, payload) =>
        httpDataCore.rules.evaluate(ctx, ruleIds, payload),
      );

      const res = await t.app.inject({
        method: "POST",
        url: "/b/v1/governance/adjudicate",
        headers: { "x-service-token": SERVICE_TOKEN },
        payload: {
          tool: "final_answer",
          arguments: { blocks: [] },
          governance: { ruleBindings: { ruleKeys: "ALL_APPLICABLE" } },
        },
      });

      // 金丝雀：请求真的到达了假 DataCore（否则「没有鉴权头」与「压根没发请求」在屏上一模一样）。
      expect(dc.seen.length).toBeGreaterThan(0);
      expect(dc.seen[0]!.url).toContain("/a/v1/rules/evaluate");

      // 本用例的本体：三个鉴权载体一个都没有。
      expect(dc.seen[0]!.authorization).toBeUndefined();
      expect(dc.seen[0]!.debugUser).toBeUndefined();
      expect(dc.seen[0]!.serviceToken).toBeUndefined();

      // 端点因此拿不到裁决，向上抛 401（插件侧据此 fail-closed 转 deny —— 见文件头注释）。
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHORIZED");
    } finally {
      await dc.close();
    }
  });

  it("② 对照臂：同一条链路只要 ctx 带上 debugUser 就能通 ⇒ 断的是**凭据装配**，不是 HTTP 客户端本身", async () => {
    const dc = await startFakeDataCore();
    try {
      const httpDataCore = createHttpDataCore(dc.url);
      // 直调真客户端，ctx 只比端点那份多一个 debugUser。
      const verdicts = await httpDataCore.rules.evaluate(
        { tenantId: "demo", userId: "svc:dsh-governance", roles: ["service"], debugUser: "demo:svc:service" },
        "ALL_APPLICABLE",
        { queryText: "final_answer {}" },
      );
      expect(verdicts).toEqual([]);
      expect(dc.seen[0]!.debugUser).toBeDefined();
    } finally {
      await dc.close();
    }
  });

  it("③ 出厂 seed agent 一个都不带 kernel ⇒ 今天默认落 NATIVE（翻默认之前的基准线）", async () => {
    const t = await createTestApp();
    const agents = await t.repos.agents.list(undefined as never);
    // 金丝雀：种子 agent 真的被装进来了（0 条时「没有 EXTERNAL」是空真理）。
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.filter((a) => a.kernel !== undefined)).toEqual([]);
  });
});
