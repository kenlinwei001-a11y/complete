import type { ConnectionTestReason, ConnectionTestResult } from "@platform/contracts";

/**
 * A1 连接器「测试连接」的**真探测**实现。
 *
 * ## 这个文件为什么存在
 * `POST /a/v1/connections/test` 原实现只做一件事：按 `configSchema.required` 查必填项，齐了就 `return { ok: true }`。
 * 实测（真后端 `SEED_DEMO=1`）：`sap_erp` 填 `host=nonexistent.invalid` 返 `{"ok":true}`，**耗时 6.0ms** ——
 * 这个耗时本身就是判据：一次 DNS 失败在本机实测要 85ms，6ms 说明它连 DNS 都没查过。
 * 金丝雀（证明观测手段有鉴别力）：同一请求删掉 `password` 就返 `{"ok":false,"message":"缺少必填配置：password"}`
 * ⇒ 回包**会**变，所以「ok:true」不是观测坏了，是它真的在说「连接成功」。
 *
 * ## 判据：不是「表单填全了没有」，是「真的连上了没有」
 * 且失败必须**分类**——四类失败对应四种完全不同的下一步动作：
 * 主机名拼错（改配置）· 端口没开（找运维）· 账号不对（换凭据）· 网络不通（查防火墙）。
 * 只回一个笼统「失败」，客户 IT 拿着它什么也做不了，等于没修。
 *
 * ## 错误形态是实测出来的，不是照着文档猜的
 * 本机 Node 22 + undici 实测（`fetch` + `AbortSignal.timeout`）：
 * | 场景 | 抛出形态 | 耗时 |
 * |---|---|---|
 * | `http://nonexistent.invalid/` | `TypeError: fetch failed` ← `cause.code = ENOTFOUND` | 85ms |
 * | `http://127.0.0.1:4099/`（闭口） | `TypeError: fetch failed` ← `cause.code = ECONNREFUSED` | 76ms |
 * | `http://10.255.255.1:81/`（不可路由） | `TimeoutError`（`name`，非 `code`） | 卡满超时才返 |
 * | `not-a-url` | `TypeError` ← `cause.code = ERR_INVALID_URL` | 0ms |
 *
 * ⚠ **两个反直觉的坑，都是实测撞出来的，别照直觉改**：
 * 1. **端口 9 不会给你 `ECONNREFUSED`** —— undici 把它当 *bad port* 直接拒，报的是 `Error: bad port`。
 *    拿 `:9` 当「端口拒绝」的样例会得出「分类没生效」这个恰好相反的结论。要用普通闭口端口（如 `:4099`）。
 * 2. **超时错误没有 `code`，只有 `name === "TimeoutError"`** —— 只看 `code` 的分类器会把超时落进兜底。
 *
 * ## 出站请求的信任边界（改动前这个端点零网络，改动后会真发请求——故此处记明）
 * 「测试连接」现在会按用户填的地址发一次 GET。这**不是新开的口子**：同一个调用方本来就能
 * `POST /a/v1/connections` 建一个 `rest_api` 连接再 `POST /:id/sync`，走 `RestApiAdapter` 发同样的请求，
 * 且实测两条路由的鉴权同级（都只过 `ctx(req)`，无额外角色校验）。本改动只是让这个既有能力
 * **早一步、且不必落库**即可触发。
 * ⚠ 刻意**不加**私网地址黑名单：本平台的连接对象本来就是内网 ERP/JDBC，
 * 拦掉私网等于把主要用法拦死。若日后要收紧，应在**连接器框架**统一做（同时覆盖 sync 路），
 * 只在 test 路加拦截会造出「测得通、同步不通」的新谎。
 *
 * ## no-secrets-echo
 * 回包里的 `target` **只取 origin**，刻意丢掉 path 与 query：`?apiKey=…` / `http://user:pass@host`
 * 这类写法会把凭据带进回包。失败说明一律用本文件的模板拼，**不回显 error 原文**
 * （undici 的 message 里带完整 URL）。
 */

/** 默认探测超时。可用 env `CONNECTOR_TEST_TIMEOUT_MS` 覆盖（有界是硬要求：不许把请求线程挂死）。 */
export const DEFAULT_PROBE_TIMEOUT_MS = 5000;

export function probeTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.CONNECTOR_TEST_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PROBE_TIMEOUT_MS;
}

/**
 * 已注册但**本版本没有适配器实现**的连接器类型。
 *
 * 判据（实测·真后端）：这三类建连后 `GET /a/v1/connections/:id/schema` 返
 * `connector type '<key>' is registered but has no adapter implementation yet`，
 * `POST /a/v1/connections/:id/sync` 直接 `FAILED`。金丝雀：`mock_erp` 同样两步返真 schema。
 * ⇒ 对它们报「连接成功」是**比 DNS 那个更坏的谎**：客户会存下连接、排期接入，
 * 直到同步那天才发现一行数据也过不来。故一律 `ok:false / UNSUPPORTED_TYPE`，且 `probed:false`
 * （诚实标注「没试」——不是网络问题，是平台没这个能力）。
 *
 * ⚠ 单一出处：这份名单必须与 `registry.ts` 的 `createAdapter` switch 保持一致。
 * 接缝测试拿 `createAdapter` **真跑**每个注册类型来反推该名单，改一边不改另一边当场红。
 */
export const TYPES_WITHOUT_ADAPTER = new Set(["sap_erp", "salesforce_crm", "generic_jdbc"]);

interface ErrLink {
  name: string;
  code?: string;
  message: string;
}

/** 展开 `cause` 链——undici 把真病因埋在 `TypeError: fetch failed` 的 cause 里，只看顶层必然分类错。 */
function errorChain(err: unknown, max = 6): ErrLink[] {
  const out: ErrLink[] = [];
  let cur: unknown = err;
  for (let i = 0; i < max && cur; i++) {
    const e = cur as { name?: string; code?: unknown; message?: unknown; cause?: unknown };
    out.push({
      name: typeof e.name === "string" ? e.name : "Error",
      code: typeof e.code === "string" ? e.code : undefined,
      message: typeof e.message === "string" ? e.message : String(e.message ?? ""),
    });
    cur = e.cause;
  }
  return out;
}

/** 把一个 fetch/网络异常归到可行动的类别上。**纯函数**，故可被测试直接喂各种形态。 */
export function classifyNetworkError(err: unknown): { reason: ConnectionTestReason; message: string } {
  const chain = errorChain(err);
  const codes = new Set(chain.map((c) => c.code).filter((c): c is string => !!c));
  const names = new Set(chain.map((c) => c.name));
  const text = chain.map((c) => c.message).join(" | ");

  // ⚠ 超时必须排在最前，且判据是 name 不是 code（实测：TimeoutError 没有 code）。
  if (names.has("TimeoutError") || codes.has("UND_ERR_CONNECT_TIMEOUT") || codes.has("ETIMEDOUT")) {
    return { reason: "TIMEOUT", message: "连接超时：在限定时间内没有收到响应。请确认地址可达、端口未被防火墙丢弃。" };
  }
  if (codes.has("ERR_INVALID_URL")) {
    return { reason: "INVALID_URL", message: "地址格式不正确：请填写完整地址（含 http:// 或 https://）。" };
  }
  if (codes.has("ENOTFOUND") || codes.has("EAI_AGAIN")) {
    return { reason: "DNS_NOT_RESOLVED", message: "主机名解析不到：请检查主机名拼写，或确认本服务所在网络能解析该域名。" };
  }
  if (codes.has("ECONNREFUSED")) {
    return { reason: "CONNECTION_REFUSED", message: "端口拒绝连接：主机可达，但该端口没有服务在监听。请确认端口号与对端服务已启动。" };
  }
  if (codes.has("ECONNRESET") || codes.has("EPIPE")) {
    return { reason: "UNREACHABLE", message: "连接被对端中断：可能是协议不匹配（如对 HTTPS 端口发了 HTTP）或对端拒绝了本次会话。" };
  }
  if (codes.has("EHOSTUNREACH") || codes.has("ENETUNREACH")) {
    return { reason: "UNREACHABLE", message: "网络不可达：本服务所在网络到该主机没有路由。请确认内网互通或代理配置。" };
  }
  if ([...codes].some((c) => c.startsWith("ERR_TLS") || c.startsWith("CERT_") || c === "DEPTH_ZERO_SELF_SIGNED_CERT" || c === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") || /self.signed|certificate/i.test(text)) {
    return { reason: "TLS_ERROR", message: "TLS 证书校验失败：对端证书不被信任（自签名或已过期）。请更换受信证书或改用可信地址。" };
  }
  // 兜底：不猜。⚠ 不回显 error 原文（undici 的 message 带完整 URL，会漏 query 里的密钥）。
  return { reason: "UNREACHABLE", message: "无法建立连接：请检查地址、端口与网络连通性。" };
}

/** HTTP 状态码 → 类别。连上了但对端说不，与压根连不上是两回事，动作也不同。 */
export function classifyHttpStatus(status: number): { ok: boolean; reason: ConnectionTestReason; message?: string } {
  if (status >= 200 && status < 400) return { ok: true, reason: "OK" };
  if (status === 401 || status === 403) {
    return { ok: false, reason: "AUTH_FAILED", message: `认证被拒（HTTP ${status}）：地址可达，但凭据无效或权限不足。请检查账号/密钥。` };
  }
  if (status === 404) {
    return { ok: false, reason: "HTTP_ERROR", message: "地址可达，但该路径不存在（HTTP 404）。请确认接口路径填写正确。" };
  }
  return { ok: false, reason: "HTTP_ERROR", message: `对端返回 HTTP ${status}：地址可达，但服务未正常响应。` };
}

/**
 * 只保留 origin 的目标串（no-secrets-echo）。
 * `http://u:p@h:8080/path?apiKey=x` → `http://h:8080`。解析不了就返回 undefined（**绝不原样回显**）。
 */
export function safeTarget(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  try {
    const u = new URL(raw.trim());
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

/**
 * 地址里内嵌了 `user:pass@`（实测：undici 直接抛
 * `TypeError: Request cannot be constructed from a URL that includes credentials`，且**这条 message 本身带用户名**
 * —— 又一个「不许回显 error 原文」的理由）。
 * 前置识别它，好过让它掉进兜底的「无法建立连接」：那句话会让人去查网络，而真正该做的是把凭据挪到凭据字段。
 */
export function hasEmbeddedCredentials(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.trim() === "") return false;
  try {
    const u = new URL(raw.trim());
    return u.username !== "" || u.password !== "";
  } catch {
    return false;
  }
}

/** 发一次有界 HTTP 探测并归类。任何异常都被吃掉转成 result —— 「测试连接」自身不许抛。 */
export async function probeHttp(
  rawUrl: unknown,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ConnectionTestResult> {
  const target = safeTarget(rawUrl);
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return { ok: false, reason: "INVALID_URL", message: "地址为空：请填写完整地址（含 http:// 或 https://）。", probed: false };
  }
  if (!target) {
    return { ok: false, reason: "INVALID_URL", message: "地址格式不正确：请填写完整地址（含 http:// 或 https://）。", probed: false, target: undefined };
  }
  if (hasEmbeddedCredentials(rawUrl)) {
    return {
      ok: false,
      reason: "INVALID_URL",
      message: "地址中不支持内嵌用户名密码：请去掉地址里的「用户名:密码@」部分，改用下方的凭据字段填写。",
      probed: false,
      target,
    };
  }
  const startedAt = Date.now();
  try {
    const res = await fetchImpl(rawUrl.trim(), {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    const latencyMs = Date.now() - startedAt;
    const cls = classifyHttpStatus(res.status);
    return { ok: cls.ok, reason: cls.reason, message: cls.message, target, latencyMs, probed: true };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const cls = classifyNetworkError(err);
    return { ok: false, reason: cls.reason, message: cls.message, target, latencyMs, probed: true };
  }
}
