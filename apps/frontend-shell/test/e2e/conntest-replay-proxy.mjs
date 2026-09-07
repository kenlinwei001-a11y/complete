/* eslint-disable */
/**
 * WO-CONNTEST-HONEST · 「修前 / 修后」同屏对照用的透明代理。
 *
 * ## 为什么需要它
 * 验收要的是**用户在屏上看到的前后两个值**。「修后」直接跑就有；
 * 「修前」需要让同一个前端收到**修复前那个回包**。
 * 重建一棵 canonical 的树再 build 一遍 datacore 代价太大，且没有必要 ——
 * 修复前后前端拿到的差别**只在这一个端点的回包**上。
 *
 * ## 它做什么
 * 端口 `PROXY_PORT`(默认 4051) 全量转发到 `UPSTREAM`(默认 127.0.0.1:4041) 的真 datacore。
 * 唯一的例外：`BEFORE=1` 时拦下 `POST /a/v1/connections/test`，
 * **原样重放修复前的实现**（只查 configSchema 必填项，齐了就 `{ok:true}`）——
 * 那段逻辑抄自 canonical 的 `app.ts`，见下方 `beforeFix()`。
 *
 * ## 诚实边界（必须写清楚，否则这份证据就是在骗人）
 * - 「修前」这一格是**回包重放**，不是把 canonical 的 datacore 真跑起来。
 * - 前端用的是**同一份**（修后）构建。这一点对结论无影响，因为修复前的前端对 `{ok:true}`
 *   渲染的是 `t.testOk` = 「连接成功」，修后的前端对**同样的 `{ok:true}`** 渲染的也是「连接成功」
 *   （新分支只在 `ok:false` 时才去读 `reason`）。两版在这个输入上渲染同一句话，
 *   所以重放出来的屏正是修复前用户会看到的那一屏。
 * - 真后端那一侧「修前返 ok:true」另有 curl 直证（报告实验 1 修前那格）。
 */
import { createServer, request as httpRequest } from "node:http";

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 4051);
const UP_HOST = process.env.UPSTREAM_HOST ?? "127.0.0.1";
const UP_PORT = Number(process.env.UPSTREAM_PORT ?? 4041);
const BEFORE = process.env.BEFORE === "1";

/** 修复前的实现，抄自 canonical `apps/datacore/src/app.ts` 的 `/a/v1/connections/test`。 */
function beforeFix(types, body) {
  const ct = types.find((t) => t.key === body.connectorTypeKey);
  if (!ct) return { ok: false, message: `未知连接器类型：${body.connectorTypeKey}` };
  const required = Array.isArray(ct.configSchema?.required) ? ct.configSchema.required : [];
  const missing = required.filter((k) => {
    const v = (body.config ?? {})[k];
    return v == null || v === "";
  });
  if (missing.length > 0) return { ok: false, message: `缺少必填配置：${missing.join("、")}` };
  return { ok: true };
}

function fetchTypes(headers) {
  return new Promise((resolve, reject) => {
    const r = httpRequest(
      { host: UP_HOST, port: UP_PORT, path: "/a/v1/connector-types", method: "GET", headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks);
    const isTestEndpoint = req.method === "POST" && (req.url ?? "").startsWith("/a/v1/connections/test");

    if (BEFORE && isTestEndpoint) {
      try {
        const headers = { ...req.headers };
        delete headers.host; delete headers["content-length"];
        const types = await fetchTypes(headers);
        const body = JSON.parse(raw.toString("utf8") || "{}");
        const out = Buffer.from(JSON.stringify(beforeFix(types, body)), "utf8");
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": out.length,
          "access-control-allow-origin": req.headers.origin ?? "*",
          "access-control-allow-credentials": "true",
        });
        return res.end(out);
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: String(e) }));
      }
    }

    // 其余一律透明转发（含 OPTIONS 预检、登录、workspace…）。
    const headers = { ...req.headers, host: `${UP_HOST}:${UP_PORT}` };
    if (raw.length) headers["content-length"] = String(raw.length);
    const up = httpRequest(
      { host: UP_HOST, port: UP_PORT, path: req.url, method: req.method, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    up.on("error", (e) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "PROXY_UPSTREAM", message: String(e.message) } }));
    });
    if (raw.length) up.write(raw);
    up.end();
  });
}).listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(`conntest-replay-proxy :${PROXY_PORT} → ${UP_HOST}:${UP_PORT} · mode=${BEFORE ? "BEFORE(重放修复前回包)" : "AFTER(全透传)"}`);
});
