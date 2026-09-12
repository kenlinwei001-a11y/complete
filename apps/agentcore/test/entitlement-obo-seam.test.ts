import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, type TestApp } from "./helpers.js";
import { FeatureGate } from "../src/features/gate.js";

/**
 * #89 SEAM · entitlement 拉取的 OBO 透传 —— 「开发链路恒 fail-open」不是降级，是稳态。
 *
 * 病历：`FeatureGate.enabledSet` 历史签名只收 `token?: string`，只会带 `Authorization: Bearer`。
 * 而 `X-Debug-User` 链路（出货 compose `ALLOW_DEBUG_USER` 默认 1）**恒无 token** → 每次拉
 * `/a/v1/tenants/:id/features` 都是无凭据请求 → A 侧 401 → 落 fail-open 分支返 `"ALL"`。
 * 于是 R3「功能关闭 = 不存在 → 404」在该链路上**整层失效**，且**完全静默**：
 * 一个 entitlement 恒定失效的部署与一个健康部署，在可观测面上一模一样。
 *
 * 真跑实证（本仓 dist·真 DataCore 内存模式）：关掉 demo 的 `shell.query-dock` 后，
 * 同进程同租户同 body，Bearer 链路 404 FEATURE_NOT_FOUND，X-Debug-User 链路 **202 建了任务**；
 * 只把「转发 x-debug-user」那一路砍掉再跑，404 立刻退回 202、`qos_entitlement_fail_open_total{reason="http_401"}` 从 0 涨到 2。
 *
 * 为什么全套既有测试都没咬住：测试里 `DATACORE_BASE_URL` 不设 → FeatureGate 走 mock 模式（全开），
 * **真拉取链路一次都没被驱动过**。故本测显式注入带 baseUrl + 假 fetch 的真 FeatureGate。
 */

const TENANT = "demo";
const FEATURES_URL = /\/a\/v1\/tenants\/[^/]+\/features$/;

/** 假 A 侧：**只认凭据**（Bearer 或 X-Debug-User），无凭据一律 401——与真 DataCore `ctx(req)` 同语义。 */
function fakeDataCore(enabled: string[]) {
  const seen: { authorization?: string; debugUser?: string }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (!FEATURES_URL.test(u)) throw new Error(`unexpected fetch ${u}`);
    const h = new Headers(init?.headers ?? {});
    const authorization = h.get("authorization") ?? undefined;
    const debugUser = h.get("x-debug-user") ?? undefined;
    seen.push({ ...(authorization ? { authorization } : {}), ...(debugUser ? { debugUser } : {}) });
    if (!authorization && !debugUser) {
      return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
    }
    return new Response(JSON.stringify({ tenantId: TENANT, features: enabled, configVersion: 7 }), {
      status: 200,
      headers: { "content-type": "application/json", etag: 'W/"fv-7"' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

/** 出厂 all-on 减去指定键——用于造「这个功能对本租户是关的」。 */
const ALL_BUT = (...off: string[]) =>
  ["shell.query-dock", "qos.agent-fallback", "view.dash", "view.risk"].filter((k) => !off.includes(k));

describe("#89 SEAM · entitlement OBO 透传（X-Debug-User 链路不得恒 fail-open）", () => {
  it("① 效果层：功能对本租户关掉后，X-Debug-User 链路必须 404 FEATURE_NOT_FOUND（而非 202 建任务）", async () => {
    const { fetchImpl, seen } = fakeDataCore(ALL_BUT("shell.query-dock"));
    const features = new FeatureGate({ baseUrl: "http://datacore.test", fetchImpl });
    const t: TestApp = await createTestApp({ features });

    const r = await submitQuery(t, `${TENANT}:user-planner:planner`, "随便问一句", { view: "dash" });
    expect(r.statusCode).toBe(404);
    expect((r.body as { error?: { code?: string } }).error?.code).toBe("FEATURE_NOT_FOUND");

    // 运输层佐证：那次拉取真的带上了 debug 身份（不是碰巧 404）。
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.debugUser).toBeDefined();
    expect(decodeURIComponent(seen[0]!.debugUser!)).toContain(`${TENANT}:`);
    // 且**没有** fail-open：entitlement 是真被执行的，不是被绕过后碰巧拦下。
    expect(features.stats.failOpen).toBe(0);
  });

  it("② 归属取证：同一份代码，只把 debug 身份抹掉（模拟修前）→ 立刻 fail-open 放行 + 计数非零", async () => {
    const { fetchImpl } = fakeDataCore(ALL_BUT("shell.query-dock"));
    const failOpens: { tenantId: string; reason: string }[] = [];
    const features = new FeatureGate({
      baseUrl: "http://datacore.test",
      fetchImpl,
      onFailOpen: (i) => failOpens.push(i),
    });
    // 直调：模拟「调用方只给了 token（此处为 undefined），拿不到 debugUser」的修前形态。
    const set = await features.enabledSet(TENANT, undefined);
    expect(set).toBe("ALL"); // ← 功能明明是关的，却全开
    expect(features.stats.failOpen).toBe(1);
    expect(failOpens).toEqual([{ tenantId: TENANT, reason: "http_401" }]);
  });

  it("③ 功能开着时 X-Debug-User 链路照常放行（证 ① 不是把整条路堵死）", async () => {
    const { fetchImpl } = fakeDataCore(ALL_BUT()); // 全开
    const features = new FeatureGate({ baseUrl: "http://datacore.test", fetchImpl });
    const t: TestApp = await createTestApp({ features });
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [{ type: "text", text: "好的" }] });

    const r = await submitQuery(t, PLANNER, "随便问一句", { view: "dash" });
    expect(r.statusCode).toBe(202);
    expect(features.stats.failOpen).toBe(0);
  });

  it("④ 向后兼容：既有调用点传裸 token 字符串仍成立（不因签名放宽而回归）", async () => {
    const { fetchImpl, seen } = fakeDataCore(ALL_BUT("qos.agent-fallback"));
    const features = new FeatureGate({ baseUrl: "http://datacore.test", fetchImpl });
    expect(await features.isEnabled(TENANT, "qos.agent-fallback", "jwt-abc")).toBe(false);
    expect(await features.isEnabled(TENANT, "shell.query-dock", "jwt-abc")).toBe(true);
    expect(seen[0]?.authorization).toBe("Bearer jwt-abc");
    expect(features.stats.failOpen).toBe(0);
  });

  it("⑤ 真降级（A 侧不可达）仍 fail-open，但必须被记账——不阻断产品，也不再静默", async () => {
    const boom = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const seen: { tenantId: string; reason: string }[] = [];
    const features = new FeatureGate({ baseUrl: "http://datacore.test", fetchImpl: boom, onFailOpen: (i) => seen.push(i) });
    expect(await features.enabledSet(TENANT, { debugUser: `${TENANT}:u:planner` })).toBe("ALL");
    expect(features.stats.failOpen).toBe(1);
    expect(seen[0]?.reason).toBe("unreachable:TypeError");
  });

  it("⑥ 有陈缓存时不算 fail-open（用陈值 ≠ 放开全部功能·计数不得虚高）", async () => {
    let ok = true;
    const fetchImpl = (async () => {
      if (ok) {
        return new Response(JSON.stringify({ tenantId: TENANT, features: ALL_BUT("shell.query-dock"), configVersion: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;
    const features = new FeatureGate({ baseUrl: "http://datacore.test", fetchImpl, ttlMs: 0 });
    const first = await features.enabledSet(TENANT, { debugUser: `${TENANT}:u:planner` });
    expect(first).not.toBe("ALL");
    ok = false; // A 侧开始 500
    const second = await features.enabledSet(TENANT, { debugUser: `${TENANT}:u:planner` });
    expect(second).toEqual(first); // 陈缓存
    expect(features.stats.failOpen).toBe(0); // ← 没放开任何东西 → 不记 fail-open
  });

  it("⑦ 防回潮哨兵：src 里不得再有 `enabledSet(…, x.token)` / `isEnabled(…, x.token)` 的传法", () => {
    // 病根是**调用约定**：只传 token 就等于在 debug 链路上丢掉身份。新增调用点若照抄旧写法，
    // 前六条断言一条都不会红（它们咬的是 FeatureGate 内部），故此处直接扫调用侧。
    const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
      });
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((line, i) => {
        if (/\b(enabledSet|isEnabled)\([^)]*\.token\s*[,)]/.test(line)) {
          offenders.push(`${f.slice(SRC.length + 1)}:${i + 1} · ${line.trim()}`);
        }
      });
    }
    expect(offenders, "entitlement 拉取应传整个 auth 对象（含 debugUser），不要只传 .token").toEqual([]);
  });
});
