import { afterEach, describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { createAdapter, CONNECTOR_TYPES } from "../src/connectors/registry.js";
import {
  classifyHttpStatus,
  classifyNetworkError,
  hasEmbeddedCredentials,
  isHttpScheme,
  safeTarget,
  TYPES_SERVED_BY_OTHER_PATH,
  TYPES_WITHOUT_ADAPTER,
} from "../src/connectors/probe.js";
import type { ConnectionTestResult } from "@platform/contracts";

/**
 * WO-CONNTEST-HONEST · 「测试连接」必须真的去连，连不上要说得出**哪一类**连不上。
 *
 * ## 这组测试咬的是什么
 * 修复前 `POST /a/v1/connections/test` 只查 `configSchema.required`，齐了就 `return { ok: true }`：
 * 真后端实测 `host=nonexistent.invalid` 返 `{"ok":true}`（**6.0ms** —— 一次真 DNS 失败在同机要 85ms，
 * 这个耗时本身就是「压根没连」的物证）。客户 IT 在验收会上第一个点的就是这个按钮。
 *
 * ⚠ **这些断言咬的是链路不是函数**：全部经 `app.inject` 打真路由，
 * 而不是直接 call `probeHttp`——「只有 test 引用 = 已排练，不是已实现」。
 * 分类器的纯函数另有一组单测（§4），两组一起才既证明「分得对」又证明「真接上了」。
 */

const ORIGINAL_TIMEOUT = process.env.CONNECTOR_TEST_TIMEOUT_MS;
afterEach(() => {
  if (ORIGINAL_TIMEOUT === undefined) delete process.env.CONNECTOR_TEST_TIMEOUT_MS;
  else process.env.CONNECTOR_TEST_TIMEOUT_MS = ORIGINAL_TIMEOUT;
});

/** 造一个按 code 抛 undici 同形态错误的 fetch（真形态实测自 Node 22 + undici，见 probe.ts 头注表）。 */
function failingFetch(code: string): typeof fetch {
  return (async () => {
    const cause = Object.assign(new Error(`connect ${code} 10.0.0.1:443`), { code });
    throw Object.assign(new TypeError("fetch failed"), { cause });
  }) as unknown as typeof fetch;
}

function statusFetch(status: number): typeof fetch {
  return (async () => new Response("", { status })) as unknown as typeof fetch;
}

async function testConn(
  app: Awaited<ReturnType<typeof makeApp>>["app"],
  connectorTypeKey: string,
  config: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const res = await app.inject({
    method: "POST",
    url: "/a/v1/connections/test",
    headers: ADMIN,
    payload: { connectorTypeKey, config },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as ConnectionTestResult;
}

describe("WO-CONNTEST-HONEST §1 · 连不上就说连不上（修复前对任何主机都返 ok:true）", () => {
  it("主机名解析不到 ⇒ ok:false + DNS_NOT_RESOLVED（而不是「连接成功」）", async () => {
    const t = await makeApp({ fetchImpl: failingFetch("ENOTFOUND") });
    const r = await testConn(t.app, "rest_api", { url: "http://nonexistent.invalid/data" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DNS_NOT_RESOLVED");
    expect(r.probed).toBe(true); // 真发起了连接尝试
    expect(r.message).toMatch(/主机名/);
  });

  it("端口拒绝 ⇒ CONNECTION_REFUSED（与 DNS 失败是**两条不同的下一步动作**）", async () => {
    const t = await makeApp({ fetchImpl: failingFetch("ECONNREFUSED") });
    const r = await testConn(t.app, "rest_api", { url: "http://127.0.0.1:4099/data" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("CONNECTION_REFUSED");
  });

  it("认证被拒（401/403）⇒ AUTH_FAILED：连上了但凭据不对，不能与「连不上」混为一谈", async () => {
    const t = await makeApp({ fetchImpl: statusFetch(401) });
    const r = await testConn(t.app, "rest_api", { url: "http://example.test/api" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("AUTH_FAILED");
  });

  it("对端 500 ⇒ HTTP_ERROR（地址可达，服务不正常）", async () => {
    const t = await makeApp({ fetchImpl: statusFetch(500) });
    const r = await testConn(t.app, "rest_api", { url: "http://example.test/api" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("HTTP_ERROR");
  });

  it("四类失败的 reason 两两不同 —— 只回一个笼统「失败」等于没修", async () => {
    const reasons = new Set<string>();
    for (const [code, fetchImpl] of [
      ["ENOTFOUND", failingFetch("ENOTFOUND")],
      ["ECONNREFUSED", failingFetch("ECONNREFUSED")],
      ["auth", statusFetch(403)],
      ["http", statusFetch(502)],
    ] as [string, typeof fetch][]) {
      const t = await makeApp({ fetchImpl });
      const r = await testConn(t.app, "rest_api", { url: "http://example.test/api" });
      reasons.add(r.reason);
      expect(code).toBeTruthy();
    }
    expect(reasons.size).toBe(4); // 分类真的分开了
  });
});

describe("WO-CONNTEST-HONEST §2 · 反向对照：真能连上的必须仍然 ok:true", () => {
  it("HTTP 200 ⇒ ok:true（没把按钮做成永远失败）", async () => {
    const t = await makeApp({ fetchImpl: statusFetch(200) });
    const r = await testConn(t.app, "rest_api", { url: "http://example.test/api" });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("OK");
    expect(r.probed).toBe(true);
  });

  it("内置样例型（mock_erp/mock_crm/mock_external）真枚举数据集 ⇒ ok:true 且报得出表数", async () => {
    const t = await makeApp();
    for (const key of ["mock_erp", "mock_crm", "mock_external"]) {
      const r = await testConn(t.app, key, {});
      expect(r.ok, `${key} 必须仍可连`).toBe(true);
      expect(r.reason).toBe("OK");
      expect(r.probed).toBe(true);
      expect(r.message).toMatch(/\d+ 张数据表/); // 真跑了 listDatasets，不是写死的 true
    }
  });

  it("文件型：blob 存在 ⇒ ok:true；blob 不存在 ⇒ NOT_FOUND（不是笼统失败）", async () => {
    const t = await makeApp();
    const up = await t.app.inject({
      method: "POST",
      url: "/a/v1/uploads",
      headers: ADMIN,
      payload: { filename: "probe.csv", contentBase64: Buffer.from("a,b\n1,2\n", "utf8").toString("base64") },
    });
    expect(up.statusCode).toBeLessThan(300);
    const connId = (up.json() as { connId?: string; connection?: { id: string } }).connId
      ?? (up.json() as { connection: { id: string } }).connection.id;
    const conn = (await t.app.inject({ method: "GET", url: "/a/v1/connections", headers: ADMIN })).json() as {
      id: string; connectorTypeKey: string; config: Record<string, unknown>;
    }[];
    const blobKey = conn.find((c) => c.id === connId)?.config.blobKey as string;
    expect(typeof blobKey).toBe("string");

    const good = await testConn(t.app, "file_upload", { blobKey, format: "csv", datasetName: "probe" });
    expect(good.ok).toBe(true);
    expect(good.probed).toBe(true);

    const bad = await testConn(t.app, "file_upload", { blobKey: "uploads/demo/does-not-exist.csv", format: "csv", datasetName: "x" });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("NOT_FOUND");
  });
});

describe("WO-CONNTEST-HONEST §3 · 金丝雀与「没试」的可区分性", () => {
  it("金丝雀：缺必填 ⇒ 回包必须变（证明观测手段有鉴别力，不是恒 true）", async () => {
    const t = await makeApp({ fetchImpl: statusFetch(200) });
    const ok = await testConn(t.app, "rest_api", { url: "http://example.test/api" });
    const missing = await testConn(t.app, "rest_api", {});
    expect(ok.ok).toBe(true);
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe("MISSING_CONFIG");
    // 若这两个回包一模一样，说明量法坏了，而不是「代码没问题」。
    expect(JSON.stringify(ok)).not.toBe(JSON.stringify(missing));
  });

  it("probed 位把「试过了连不上」与「压根没试」分开 —— 这正是修复前 bug 的本体", async () => {
    const t = await makeApp({ fetchImpl: failingFetch("ENOTFOUND") });
    expect((await testConn(t.app, "rest_api", { url: "http://x.invalid/a" })).probed).toBe(true);
    expect((await testConn(t.app, "rest_api", {})).probed).toBe(false); // 必填缺失，没碰网络
    expect((await testConn(t.app, "sap_erp", { host: "h", client: "1", username: "u", password: "p" })).probed).toBe(false);
  });

  it("未知连接器类型 ⇒ UNKNOWN_TYPE", async () => {
    const t = await makeApp();
    const r = await testConn(t.app, "mock_erp", {});
    expect(r.ok).toBe(true);
    const res = await t.app.inject({
      method: "POST", url: "/a/v1/connections/test", headers: ADMIN,
      payload: { connectorTypeKey: "no_such_connector", config: {} },
    });
    expect((res.json() as ConnectionTestResult).reason).toBe("UNKNOWN_TYPE");
  });
});

describe("WO-CONNTEST-HONEST §4 · 无适配器的三类：不许报「连接成功」", () => {
  /**
   * 🔒 接缝金丝雀（单一出处）：`createAdapter` 真跑起来会抛「no adapter implementation」的那批类型，
   * 必须**恰好等于** `TYPES_WITHOUT_ADAPTER ∪ TYPES_SERVED_BY_OTHER_PATH`。
   *
   * 为什么要拆成两个集合而不是一个：本单实测撞到过 ——
   * `knowledge_base` 的 createAdapter **也抛**，但它由 `KbService` 真实服务（灌文档/检索/重嵌全通）。
   * 照「抛了就是不支持」一刀切，会对一个**好用的**连接器说「暂未支持」，
   * 与本单要修的那个谎同形态、方向相反。
   *
   * 为什么用真跑反推而不是照抄名单：哪天有人实现了 sap 适配器却忘了改名单，
   * 「测试连接」会继续对一个已经能用的连接器说「暂未支持」。这条断言让机器先说话。
   */
  it("createAdapter 抛错的集合 = 无适配器 ∪ 走其他链路（改一边不改另一边即红）", async () => {
    // 只需要一个占位 BlobStore：未实现的类型在**构造期**就抛，压根走不到读 blob。
    const stubBlob = {
      put: async () => {}, get: async () => Buffer.alloc(0),
      exists: async () => true, delete: async () => {},
    };
    const actuallyUnsupported = new Set<string>();
    for (const ct of CONNECTOR_TYPES) {
      try {
        createAdapter(ct.key, { blobKey: "k", format: "csv", datasetName: "d", url: "http://x.test" }, stubBlob);
      } catch (err) {
        if (err instanceof Error && /no adapter implementation/.test(err.message)) actuallyUnsupported.add(ct.key);
      }
    }
    // 金丝雀：这个反推手段本身得抓得到东西，否则「集合相等」会因为两边都空而假绿。
    expect(actuallyUnsupported.size).toBeGreaterThan(0);
    const declared = [...TYPES_WITHOUT_ADAPTER, ...TYPES_SERVED_BY_OTHER_PATH].sort();
    expect([...actuallyUnsupported].sort()).toEqual(declared);
    // 两个集合不许重叠——同一个类型不能既「不支持」又「走别的链路」。
    for (const k of TYPES_SERVED_BY_OTHER_PATH) expect(TYPES_WITHOUT_ADAPTER.has(k)).toBe(false);
  });

  it("sap_erp / salesforce_crm / generic_jdbc / external_feed ⇒ ok:false + UNSUPPORTED_TYPE，且说得出后果", async () => {
    const t = await makeApp({ fetchImpl: statusFetch(200) }); // 就算网络全通也不许报成功
    const cases: [string, Record<string, unknown>][] = [
      ["sap_erp", { host: "sap.example.test", client: "100", username: "u", password: "p" }],
      ["salesforce_crm", { instanceUrl: "https://x.my.salesforce.com", clientId: "c", clientSecret: "s" }],
      ["generic_jdbc", { jdbcUrl: "jdbc:postgresql://db.test:5432/x", username: "u", password: "p" }],
      ["external_feed", { feedUrl: "http://feed.example.test/rss" }],
    ];
    for (const [key, config] of cases) {
      const r = await testConn(t.app, key, config);
      expect(r.ok, `${key} 不许报连接成功`).toBe(false);
      expect(r.reason).toBe("UNSUPPORTED_TYPE");
      expect(r.message).toMatch(/适配器/); // 讲清「为什么」而不是笼统失败
    }
  });

  /**
   * ⛔ 反向的谎，与本单要修的那个同样严重：对**能用**的连接器说「连不上 / 不支持」。
   * 这条咬的是本单中途真犯过的一个错：把 `knowledge_base` 也当成「createAdapter 抛错 ⇒ 不支持」，
   * 并拿 HTTP 去探它的 `endpoint`；而真后端实测该类型灌文档/检索/重嵌全通，
   * 且 databuilder 建的连接 endpoint 是 `internal://databuilder`（连 HTTP 方案都不是）⇒ 必然假阴性。
   */
  it("knowledge_base 由 KbService 服务 ⇒ 必须 ok:true，且不许拿 HTTP 去探 internal:// 的 endpoint", async () => {
    // 网络层全部失败：若实现去探了 endpoint，这条当场红。
    const t = await makeApp({ fetchImpl: failingFetch("ENOTFOUND") });
    const r = await testConn(t.app, "knowledge_base", { endpoint: "internal://databuilder" });
    expect(r.ok, "知识库连接器能用，不许报失败").toBe(true);
    expect(r.reason).toBe("OK");
    expect(r.probed).toBe(true);
    expect(r.message).toMatch(/知识库/);
  });

  it("知识库探针真读了后备存储：灌一篇文档后回包里的篇数会变（不是写死的 true）", async () => {
    const t = await makeApp();
    const conn = (await t.app.inject({
      method: "POST", url: "/a/v1/connections", headers: ADMIN,
      payload: { connectorTypeKey: "knowledge_base", name: "kb1", config: { endpoint: "internal://databuilder" } },
    })).json() as { id: string };
    const before = await testConn(t.app, "knowledge_base", { endpoint: "internal://databuilder" });
    await t.app.inject({
      method: "POST", url: `/a/v1/kb/${conn.id}/docs`, headers: ADMIN,
      payload: { filename: "n.txt", contentBase64: Buffer.from("换型停机处置流程", "utf8").toString("base64") },
    });
    const after = await testConn(t.app, "knowledge_base", { endpoint: "internal://databuilder" });
    // 对照实验：改变输入（多一篇文档），回包必须按可预言的方式变化。
    expect(before.message).not.toBe(after.message);
    expect(before.message).toMatch(/现有 0 篇文档/);
    expect(after.message).toMatch(/现有 1 篇文档/);
  });
});

describe("WO-CONNTEST-HONEST §5 · 有界超时：不许把请求线程挂死", () => {
  it("对端永不响应 ⇒ 在超时上界内返回 TIMEOUT（实测耗时随回包一起给）", async () => {
    process.env.CONNECTOR_TEST_TIMEOUT_MS = "300";
    // 尊重 AbortSignal 的挂死型 fetch —— 若实现没传 signal，这个 promise 永不落定，测试会超时暴露。
    const hangingFetch = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
        });
      })) as unknown as typeof fetch;
    const t = await makeApp({ fetchImpl: hangingFetch });
    const startedAt = Date.now();
    const r = await testConn(t.app, "rest_api", { url: "http://10.255.255.1:81/data" });
    const elapsed = Date.now() - startedAt;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("TIMEOUT");
    expect(r.latencyMs).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(5000); // 有界：没挂死
  });
});

describe("WO-CONNTEST-HONEST §6 · no-secrets-echo：失败原因不许带出凭据", () => {
  it("query 里的密钥与地址里的 userinfo 都不进回包（target 只留 origin）", async () => {
    const t = await makeApp({ fetchImpl: failingFetch("ENOTFOUND") });
    const r = await testConn(t.app, "rest_api", {
      url: "http://nonexistent.invalid/data?apiKey=SUPERSECRET123",
      apiKey: "MYSECRETKEY999",
    });
    const blob = JSON.stringify(r);
    expect(blob).not.toContain("SUPERSECRET123");
    expect(blob).not.toContain("MYSECRETKEY999");
    // 金丝雀：证明这个 grep 抓得到东西 —— 否则「没找到密钥」与「回包是空的」在断言上一模一样。
    expect(blob).toContain("nonexistent.invalid");
    expect(r.target).toBe("http://nonexistent.invalid"); // 无 path 无 query
  });

  it("凭据内嵌在地址里 ⇒ 明确提示挪到凭据字段，且不回显密码", async () => {
    const t = await makeApp({ fetchImpl: statusFetch(200) });
    const r = await testConn(t.app, "rest_api", { url: "http://alice:HUNTER2PASS@host.test/data" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("INVALID_URL");
    expect(JSON.stringify(r)).not.toContain("HUNTER2PASS");
    expect(r.message).toMatch(/凭据字段/);
  });

  it("sap_erp 的 password 不出现在回包里", async () => {
    const t = await makeApp();
    const r = await testConn(t.app, "sap_erp", { host: "h.test", client: "100", username: "u", password: "PWLEAKTEST42" });
    expect(JSON.stringify(r)).not.toContain("PWLEAKTEST42");
  });
});

describe("WO-CONNTEST-HONEST §7 · 分类器纯函数（形态实测自 Node 22 + undici）", () => {
  it("超时判据落在 name 上而不是 code —— TimeoutError 实测没有 code", () => {
    expect(classifyNetworkError(Object.assign(new Error("aborted"), { name: "TimeoutError" })).reason).toBe("TIMEOUT");
  });

  it("undici 把真病因埋在 cause 里，只看顶层必然分类错", () => {
    const wrapped = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND h"), { code: "ENOTFOUND" }),
    });
    expect(classifyNetworkError(wrapped).reason).toBe("DNS_NOT_RESOLVED");
    // 金丝雀：顶层那层自己不带 code，若实现只读顶层就会掉进兜底。
    expect(classifyNetworkError(new TypeError("fetch failed")).reason).toBe("UNREACHABLE");
  });

  it("状态码分档：2xx/3xx 通过，401/403 认证，其余非 2xx 报 HTTP_ERROR", () => {
    expect(classifyHttpStatus(200).ok).toBe(true);
    expect(classifyHttpStatus(302).ok).toBe(true);
    expect(classifyHttpStatus(401).reason).toBe("AUTH_FAILED");
    expect(classifyHttpStatus(403).reason).toBe("AUTH_FAILED");
    expect(classifyHttpStatus(404).reason).toBe("HTTP_ERROR");
    expect(classifyHttpStatus(503).reason).toBe("HTTP_ERROR");
  });

  it("safeTarget 只留 origin；解析不了返回 undefined（绝不原样回显）", () => {
    expect(safeTarget("http://u:p@h:8080/path?apiKey=x")).toBe("http://h:8080");
    expect(safeTarget("not-a-url")).toBeUndefined();
    expect(safeTarget("")).toBeUndefined();
    expect(safeTarget(undefined)).toBeUndefined();
    // 非「//host」型方案：解析得动但 host 为空 —— 不许回一个无意义的 `jdbc://`。
    expect(safeTarget("jdbc:postgresql://db.test:5432/x")).toBeUndefined();
  });

  it("hasEmbeddedCredentials 认得 user:pass@", () => {
    expect(hasEmbeddedCredentials("http://a:b@h.test/")).toBe(true);
    expect(hasEmbeddedCredentials("http://a@h.test/")).toBe(true);
    expect(hasEmbeddedCredentials("http://h.test/")).toBe(false);
  });

  it("只放行 http/https —— 其余方案在 undici 里的报错会把人误导向网络问题", () => {
    expect(isHttpScheme("http://h.test/")).toBe(true);
    expect(isHttpScheme("https://h.test/")).toBe(true);
    for (const u of ["ftp://h.test/x", "file:///etc/passwd", "ws://h.test/x", "jdbc:postgresql://d/x", "not-a-url"]) {
      expect(isHttpScheme(u), `${u} 不该放行`).toBe(false);
    }
  });
});
