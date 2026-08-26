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
 *
 * ────────────────────────────────────────────────────────────────────────
 * ## WO-DSH-GOV-CREDENTIAL（2026-08-25）· 断点已修，臂 ① 按上一段的自述**翻正**
 *
 * 上一段写的那一天到了。`server.ts` 的裁决 ctx 现在带 `serviceToken`，
 * `tools/datacore-http.ts` 的鉴权链补了第四支 `x-service-token` + `x-tenant-id`。
 * 于是臂 ① 原来的三条 `toBeUndefined()` **必然变红** —— 它断言的正是「凭据不在」，
 * 而修复的定义就是「凭据在」。**这两件事不可能同时为真**：
 * 「修好之后本用例应转绿」这个期待本身与本文件的设计相矛盾，
 * 唯一自洽的处置就是本段做的事 —— 按第 32 行的自述把断言翻成正向。
 *
 * 翻正后臂 ① 钉的是**正向不变量**（比原来更强）：治理裁决必须带着服务间凭据到达 DataCore。
 * 原来那条「没凭据会怎样」的表征价值**没有丢**，移进新增的臂 ①b（fail-closed）继续钉。
 *
 * ### 假 DataCore 同步对齐真服务（原版模型是错的）
 *
 * 原 `startFakeDataCore` 判 `!authorization && !debugUser ⇒ 401` —— 这**不是**真 DataCore 的
 * 鉴权语义：真 DataCore 的通用鉴权钩子（`apps/datacore/src/app.ts`）**第一支就是** `x-service-token`，
 * 排在 `x-debug-user` 与 `Bearer` **之前**。假件照原样留着，就会在「修好之后」继续吐 401，
 * 把一条已经修好的链路演成还断着 —— 假件比真件更严，等于测试在**造一个不存在的故障**。
 *
 * 三条语义均**对真服务实测**（NODE_ENV=production · 端口 4091 · SEED_DEMO=1）：
 *   - 裸请求                                  → 401 `UNAUTHORIZED` "authentication required"
 *   - `x-debug-user: demo:svc:service`        → **401**（生产态 `ALLOW_DEBUG_USER` 默认 "0"）
 *   - `x-service-token` + `x-tenant-id: demo` → **200**，29 条真 verdict（C01…C34）
 *   - `x-service-token` 但**漏** `x-tenant-id` → 400 `VALIDATION_ERROR`
 *                                               "X-Tenant-Id header required for service calls"
 *
 * 第二条就是**方案 A（走 debugUser）被否决的实测依据**：它在生产链路上照样 401，等于没修。
 */
import { describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpDataCore } from "../src/tools/datacore-http.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { createTestApp } from "./helpers.js";

const SERVICE_TOKEN = "seam-service-token-0000";

interface SeenRequest {
  url: string;
  authorization: string | undefined;
  debugUser: string | undefined;
  serviceToken: string | undefined;
  tenantId: string | undefined;
  serviceCaller: string | undefined;
}

/**
 * 假 DataCore：语义对位真 DataCore 的通用鉴权钩子（`apps/datacore/src/app.ts`），
 * **三支齐全且次序与真服务一致**（service-token → debug-user → Bearer）。
 * 四条分支的状态码/文案均对真服务实测过，见文件头「假 DataCore 同步对齐真服务」。
 */
async function startFakeDataCore(): Promise<{ url: string; seen: SeenRequest[]; close: () => Promise<void> }> {
  const seen: SeenRequest[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const authorization = req.headers.authorization as string | undefined;
      const debugUser = req.headers["x-debug-user"] as string | undefined;
      const serviceToken = req.headers["x-service-token"] as string | undefined;
      const tenantId = req.headers["x-tenant-id"] as string | undefined;
      seen.push({
        url: req.url ?? "",
        authorization,
        debugUser,
        serviceToken,
        tenantId,
        serviceCaller: req.headers["x-service-caller"] as string | undefined,
      });
      const json = (code: number, body: unknown) =>
        res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
      // ① 服务令牌支最先判（真服务同次序）；令牌对但缺租户头 ⇒ 400 而非 401。
      if (serviceToken !== undefined) {
        if (serviceToken !== SERVICE_TOKEN) {
          return json(401, { error: { code: "UNAUTHORIZED", message: "authentication required" } });
        }
        if (!tenantId) {
          return json(400, {
            error: { code: "VALIDATION_ERROR", message: "X-Tenant-Id header required for service calls" },
          });
        }
        return json(200, []);
      }
      // ② / ③ 用户支。④ 三者皆无 ⇒ 401（= 修前的生产行为，由臂 ①b 继续钉）。
      if (!authorization && !debugUser) {
        return json(401, { error: { code: "UNAUTHORIZED", message: "authentication required" } });
      }
      return json(200, []);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("WO-AGENT-DSH-DEFAULT · DSH 治理带外通道 → DataCore 凭据接缝", () => {
  it("① 裁决端点经**真 HTTP 客户端**问 DataCore 时，带着服务间凭据到达 ⇒ 拿得到裁决（断点已修·正向不变量）", async () => {
    const dc = await startFakeDataCore();
    const t = await createTestApp({ env: { SERVICE_TOKEN } });
    try {
      // 关键：把 mock 换成**真** HTTP 客户端（生产 main.ts 用的就是 createHttpDataCore）。
      // 端点自己造的 ctx 因此原样流进 call() 的鉴权链 —— 这正是五臂 mock 掉的那一跳。
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

      // 金丝雀：请求真的到达了假 DataCore（否则「凭据对了」与「压根没发请求」在屏上一模一样）。
      expect(dc.seen.length).toBeGreaterThan(0);
      expect(dc.seen[0]!.url).toContain("/a/v1/rules/evaluate");

      // 本用例的本体（翻正后）：服务间凭据**在**，且租户头**在**（真 DataCore 缺它 400）。
      expect(dc.seen[0]!.serviceToken).toBe(SERVICE_TOKEN);
      expect(dc.seen[0]!.tenantId).toBe("platform");
      // 主体名跨系统对得上：B 侧端点自述 `svc:dsh-governance`，A 侧由本头拼出同一个串。
      expect(dc.seen[0]!.serviceCaller).toBe("dsh-governance");
      // 不提权：服务令牌支不得顺带伪造用户身份。
      expect(dc.seen[0]!.authorization).toBeUndefined();
      expect(dc.seen[0]!.debugUser).toBeUndefined();

      // 端点因此**拿得到**裁决：无 BLOCK 违规 ⇒ allow（修前这里是 401 → 插件 fail-closed → deny → 无界重试）。
      expect(res.statusCode).toBe(200);
      expect(res.json().decision).toBe("allow");
    } finally {
      await dc.close();
    }
  });

  it("①b fail-closed 对照臂：`SERVICE_TOKEN` 未配置 ⇒ 仍旧裸请求 ⇒ 401 ⇒ 治理拒（不许退化成放行）", async () => {
    const dc = await startFakeDataCore();
    // 刻意不配 SERVICE_TOKEN —— 这是原臂 ① 表征的那个世界，价值移到此处继续钉。
    const t = await createTestApp({ env: {} });
    try {
      const httpDataCore = createHttpDataCore(dc.url);
      vi.spyOn(t.dataCore.rules, "evaluate").mockImplementation((ctx, ruleIds, payload) =>
        httpDataCore.rules.evaluate(ctx, ruleIds, payload),
      );

      const res = await t.app.inject({
        method: "POST",
        url: "/b/v1/governance/adjudicate",
        // 端点自守也要过：未配 SERVICE_TOKEN 时 requireServiceToken 恒不通过，
        // 故本臂只能断言「治理拿不到 allow」，这正是 fail-closed 的定义。
        headers: { "x-service-token": SERVICE_TOKEN },
        payload: {
          tool: "final_answer",
          arguments: { blocks: [] },
          governance: { ruleBindings: { ruleKeys: "ALL_APPLICABLE" } },
        },
      });

      // 本体：绝不 200/allow。没有凭据的世界里，治理必须拒。
      expect(res.statusCode).not.toBe(200);
      expect(res.json().decision).toBeUndefined();
      // 若请求真的走到了 DataCore，那它必定是裸的（凭据无从取得）。
      for (const s of dc.seen) expect(s.serviceToken).toBeUndefined();
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

  it("③ 出厂 seed agent 一个都不带 kernel ⇒ 今天默认落 NATIVE（翻默认之前的基准线）", () => {
    const { agents } = seedRegistry();
    // 金丝雀：种子 agent 真的抽出来了（0 条时「没有 EXTERNAL」是空真理，不是结论）。
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.map((a) => a.key).includes("analyst")).toBe(true);
    // 本体：零个显式 kernel ⇒ 分叉守卫必落 `agent.kernel === undefined` 那一支，
    // 再回落 `process.env.DSH_HARNESS`（出货 compose 显式 `${DSH_HARNESS:-0}`）⇒ 全 NATIVE。
    expect(agents.filter((a) => a.kernel !== undefined)).toEqual([]);
  });

  it("④ `cfg.DSH_HARNESS` 在 src 侧零消费方 ⇒ 改 config.ts 的 zod 缺省**翻不动**分叉（方案 A 是空操作）", () => {
    const engineSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/engine.ts"), "utf8");
    // 金丝雀：确实读到了 engine.ts 且抓得到分叉守卫本身（读空文件时下面的否定断言会是空真理）。
    expect(engineSrc).toContain('agent.kernel === "EXTERNAL"');
    // 本体：守卫直读 process.env，从不经 cfg —— 故 config.ts 的 default("0")→("1") 不改变任何分叉行为。
    expect(engineSrc).toContain('process.env.DSH_HARNESS === "1"');
    expect(/\bcfg\.DSH_HARNESS(?![_A-Za-z0-9])/.test(engineSrc)).toBe(false);
  });
});
