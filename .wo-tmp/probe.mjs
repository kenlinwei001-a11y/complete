/**
 * WO-COMPUTED-EDGE · 对照实验探针（真起服务，`SEED_DEMO=1`，禁 VITE_MOCK）。
 * 用法：node probe.mjs <port>
 *
 * 每条边给四个数：边 key · 声明后物化 created · **检索**读到的边条数 · 端点前 3 对 id。
 * 「物化 created」与「检索 edges」必须分开报 —— 本仓踩过「边写进去了但检索读不到（{nodes:9,edges:0}）」。
 */
const PORT = process.argv[2] ?? "4411";
const BASE = `http://127.0.0.1:${PORT}`;
const H = { "content-type": "application/json", "X-Debug-User": "demo:admin:admin|planner|catalog_admin" };

async function req(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  return { status: r.status, json };
}

/** 建（或 upsert）一条结构边，回 {status, materialized|error}。 */
const createLink = (payload) => req("POST", "/a/v1/ontology/link-types", payload);

/** 注册一条一跳切片并解析，回该 linkKey 的边（`from->to` 串，排序）。 */
async function edgesVia(sliceKey, rootType, linkKey, direction = "out") {
  const put = await req("PUT", `/a/v1/ontology/slices/${sliceKey}`, {
    version: 1,
    spec: { root: { typeKey: rootType, selector: {} }, paths: [[{ linkKey, direction }]], maxNodes: 20000 },
  });
  if (put.status >= 300) return { err: `slice put ${put.status} ${JSON.stringify(put.json).slice(0, 200)}` };
  const res = await req("POST", `/a/v1/ontology/slices/${sliceKey}/resolve`, { args: {} });
  if (res.status >= 300) return { err: `slice resolve ${res.status} ${JSON.stringify(res.json).slice(0, 200)}` };
  const edges = (res.json.edges ?? []).filter((e) => e.linkKey === linkKey).map((e) => `${e.from}->${e.to}`).sort();
  return { edges, nodes: (res.json.nodes ?? []).length };
}

/** 直接改一个对象的 props（反向对照用）。走 REST 对象更新端点。 */
async function objectsOfType(type) {
  const r = await req("GET", `/a/v1/objects?type=${encodeURIComponent(type)}&page=1&pageSize=500`);
  return r.json.items ?? r.json.data ?? [];
}

export { req, createLink, edgesVia, objectsOfType, PORT };
