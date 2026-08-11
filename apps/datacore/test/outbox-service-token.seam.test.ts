import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";

/**
 * 接缝门：A 的 C-2 outbox 投递 × B 的 `/b/v1/internal/invalidate` 服务间鉴权。
 *
 * 病灶（本测存在的理由）：B 侧把该钩子收口成 SERVICE_TOKEN 之后，**若调用端不同步带上 token，
 * 缓存失效链会静默断掉** —— A 投递收到 401 → 走 5 档退避 → 最终进死信；而 B 侧缓存有 TTL 60s
 * 兜底，于是**业务面不红、测试面也不红**，只是「传播 SLO ≤60s」悄悄退化成 60s 恒定延迟。
 * 这正是本仓最怕的那种断法：两半各自都对，接缝没接，且没有任何信号。
 * 所以这条断言咬的是**调用端真的发出了那个头**，不是「代码里写了这一行」。
 *
 * ⚠ 同时咬死另一半 —— **凭证不得外泄给租户自助注册的地址**：
 * webhook URL 由 `POST /a/v1/webhooks` 收下租户填的任意值（`app.ts` 不做白名单）。
 * 若实现图省事对每次投递都附带 `X-Service-Token`，任何租户管理员注册一条指向自己服务器的
 * hook 就能把**两服务共享的服务间密钥**原样收走 —— 那比要修的「匿名清缓存」严重得多，
 * 等于用一个更大的洞补一个小洞。两条断言必须同时在，只留前一条会让这种实现照绿。
 */
const SVC = "test-only-fake-service-token";
const AGENT_BASE = "http://agentcore.internal:4002";

interface Sent {
  url: string;
  token: string | undefined;
  caller: string | undefined;
  body: string;
}

async function runDelivery(hookUrls: string[]): Promise<Sent[]> {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    sent.push({
      url: String(url),
      token: h["x-service-token"],
      caller: h["x-service-caller"],
      body: String(init?.body ?? ""),
    });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  const t = await makeApp({ env: { AGENTCORE_BASE_URL: AGENT_BASE, SERVICE_TOKEN: SVC }, fetchImpl });
  for (const url of hookUrls) {
    const reg = await t.app.inject({
      method: "POST",
      url: "/a/v1/webhooks",
      headers: ADMIN,
      payload: { url, events: ["rules.updated"] },
    });
    expect(reg.statusCode, `webhook 注册失败：${url}`).toBe(201);
  }
  // 真触发一条领域事件（rules.updated），走真实 outbox 投递路径
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/rules",
    headers: ADMIN,
    payload: { key: "SVCTOK1", name: "svc token probe", expression: "x > 1", severity: "WARN", status: "PUBLISHED" },
  });
  expect(created.statusCode).toBe(201);
  const res = await t.services.outbox.processOnce("demo");
  expect(res.delivered, "投递没成功，后面的头断言就没有鉴别力").toBe(1);
  return sent;
}

describe("SEAM · outbox 投递到 B 的内部钩子必须带 SERVICE_TOKEN（且只对受信对端带）", () => {
  it("投递到 AGENTCORE_BASE_URL 同源的 hook → 真的带上了 x-service-token", async () => {
    const sent = await runDelivery([`${AGENT_BASE}/b/v1/internal/invalidate`]);
    const hit = sent.find((s) => s.url.startsWith(AGENT_BASE));
    expect(hit, "根本没投递到内部对端").toBeTruthy();
    expect(hit!.body, "前提自证：投的确实是 rules.updated 这条事件").toContain("rules.updated");
    expect(
      hit!.token,
      "调用端没带 x-service-token —— B 侧会 401，缓存失效链静默断掉（业务面/测试面都不会红）",
    ).toBe(SVC);
    expect(hit!.caller).toBe("datacore-outbox");
  });

  it("投递到租户自助注册的**外部**地址 → 绝不可带 x-service-token（凭证外泄红线）", async () => {
    const sent = await runDelivery(["http://tenant-controlled.example/collect"]);
    const leak = sent.find((s) => s.url.startsWith("http://tenant-controlled.example"));
    expect(leak, "根本没投递到外部地址").toBeTruthy();
    expect(
      leak!.token,
      "服务间凭证被发给了租户自己填的 webhook 地址 —— 任何租户管理员都能收走两服务共享的密钥",
    ).toBeUndefined();
    expect(leak!.caller).toBeUndefined();
  });

  it("同一轮里两个 hook 并存：内部对端带、外部地址不带（判据是 origin 而非「这一轮要不要带」）", async () => {
    const sent = await runDelivery([
      `${AGENT_BASE}/b/v1/internal/invalidate`,
      "http://tenant-controlled.example/collect",
    ]);
    expect(sent.length).toBe(2);
    expect(sent.find((s) => s.url.startsWith(AGENT_BASE))!.token).toBe(SVC);
    expect(sent.find((s) => s.url.startsWith("http://tenant-controlled.example"))!.token).toBeUndefined();
  });

  it("前缀撞车不算受信：端口 40022 不得拿到凭证（origin 全等，非 startsWith）", async () => {
    // `http://agentcore.internal:40022` 以受信 baseUrl `http://agentcore.internal:4002` 为**字符串前缀**，
    // 但 origin 不同（端口 40022 ≠ 4002）。若实现写成 `url.startsWith(baseUrl)`，密钥就送出去了。
    const evil = "http://agentcore.internal:40022/collect";
    expect(evil.startsWith(AGENT_BASE), "前提自证：这个 URL 确实以受信 baseUrl 为前缀，否则本用例没在测前缀撞车").toBe(true);
    const sent = await runDelivery([evil]);
    expect(sent.length).toBe(1);
    expect(
      sent[0]!.token,
      "前缀匹配把一个不同端口的主机认成了受信对端 —— 判据必须是 origin 全等",
    ).toBeUndefined();
  });
});
