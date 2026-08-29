import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-DC-ERRORENVELOPE-11 · 统一错误信封的**入参校验**这一半。
 *
 * 病灶（改前实测，15/15 全中）：`app.ts` 里一批路由用**裸** `Schema.parse(req.body)`。
 * ZodError 身上没有 `statusCode` ⇒ 被兜底错误处理器判成 **500 `INTERNAL_ERROR`**，
 * 并把 zod 的内部结构（`"expected"` / `"code":"invalid_type"` / `"path"`）**原样回显给调用方**：
 *
 *   POST /a/v1/sim/change-impact-preview  body={}  →  http=500
 *   {"error":{"code":"INTERNAL_ERROR","message":"[\n  {\n    \"code\": \"invalid_type\",
 *     \n    \"expected\": \"object\",\n    \"path\": [\n      \"focus\"\n    ], …"}}
 *
 * 应该的口径 = 与同文件 99+ 处 `parseBody(...)` 逐字一致：**400 `VALIDATION_ERROR`**
 * + 统一信封 `{ error: { code, message, requestId } }`，message 是 `"<path>: <message>"`
 * 的人读串，**不含任何 zod 内部结构**。
 *
 * ⚠ 断言口径的关键分寸：修好之后的 message 里**仍然会出现 `expected` 这个词**
 * （zod 的人读句「Invalid input: expected string, received undefined」），
 * 所以不能拿裸词 `expected` 当泄漏判据 —— 那会把正确答案也判红。
 * 判据落在**「被引号包起来、后面跟冒号」的 JSON 键**上：`"expected":` / `"path":` /
 * `"code": "invalid_type"`。人读句里这三个形态一个都不会出现。
 */

/**
 * zod 内部结构泄漏探测器 —— 主逻辑与金丝雀**共用这一份**（不许各抄一份正则）。
 *
 * ⚠ 先反转义再探测。第一版漏了这一步，金丝雀当场报红并救回一次假绿：
 * 原始响应体里 `message` 是 JSON 的**字符串值**，内层引号被转义成 `\"expected\":`，
 * 而正则要的是 `"expected":` —— 于是探测器对着改前那坨真·500 原文**零命中**，
 * 15 条路由的断言全部"绿"得毫无意义。先把 `\"` 折回 `"`，两种形态才收敛到同一个判据。
 */
function zodInternalsLeaked(text: string): string[] {
  const unescaped = text.replace(/\\"/g, '"');
  const probes: { name: string; re: RegExp }[] = [
    { name: '"expected" 作 JSON 键', re: /"expected"\s*:/ },
    { name: '"path" 作 JSON 键', re: /"path"\s*:/ },
    { name: '"code" 作 JSON 键', re: /"code"\s*:\s*"(invalid_type|invalid_value|invalid_format|too_small|too_big|unrecognized_keys)"/ },
    { name: "message 整体是序列化的 zod issue 数组", re: /"message"\s*:\s*"\s*\[\s*\{|^\s*\[\s*\{/ },
  ];
  return probes.filter((p) => p.re.test(unescaped)).map((p) => p.name);
}

/** 改前真实抓到的 500 响应体（原文，用作探测器金丝雀）。 */
const REAL_BROKEN_BODY_BEFORE_FIX =
  '{"error":{"code":"INTERNAL_ERROR","message":"[\\n  {\\n    \\"code\\": \\"invalid_type\\",\\n    \\"expected\\": \\"object\\",\\n    \\"path\\": [\\n      \\"focus\\"\\n    ],\\n    \\"message\\": \\"Invalid input: expected object, received undefined\\"\\n  }\\n]","requestId":"req_pc27z8pkj5w4166p"}}';

/** 改后真实抓到的 400 响应体（已修邻居 optimize-pareto 的原文，用作反向金丝雀）。 */
const REAL_GOOD_BODY_AFTER_FIX =
  '{"error":{"code":"VALIDATION_ERROR","message":"family: Invalid input: expected string, received undefined; objectives: Invalid input: expected array, received undefined","requestId":"req_jbvf31v5wqc3a9jv"}}';

interface Case {
  /** 报错时人一眼认得出是哪条 —— 变异反证要靠它精确点名。 */
  label: string;
  method: "POST" | "PUT";
  url: string;
  /** 一个**必然不合法**的入参。 */
  payload: unknown;
  /** 为什么它必然不合法（= 这条路由的 schema 卡在哪）。 */
  why: string;
}

/**
 * A 组 · 派单 grep（`.parse(req.body|.parse(req.query`）直接命中的 11 处。
 * B 组 · 同病同灶但那条 grep 漏掉的 4 处（实参写成了 `req.body` 的成员 / 展开）。
 */
const CASES: Case[] = [
  // ── A 组 ────────────────────────────────────────────────────────────────
  { label: "A1  POST /a/v1/config-bundles/import", method: "POST", url: "/a/v1/config-bundles/import", payload: {}, why: "bundle 必填" },
  { label: "A2  PUT  /a/v1/prompt-templates/:key", method: "PUT", url: "/a/v1/prompt-templates/classifier", payload: {}, why: "template 必填" },
  { label: "A3  PUT  /a/v1/llm-budgets", method: "PUT", url: "/a/v1/llm-budgets", payload: {}, why: "hardLimitTokens 必填" },
  { label: "A4  POST /a/v1/llm-budgets/record", method: "POST", url: "/a/v1/llm-budgets/record", payload: {}, why: "tokens 必填" },
  { label: "A5  PUT  /a/v1/calendars/:key", method: "PUT", url: "/a/v1/calendars/default", payload: { weekendMode: "BOGUS" }, why: "weekendMode 非枚举值" },
  { label: "A6  POST /a/v1/writeback-echoes/reconcile", method: "POST", url: "/a/v1/writeback-echoes/reconcile", payload: {}, why: "ref 必填" },
  { label: "A7  POST /a/v1/sim/change-impact-preview", method: "POST", url: "/a/v1/sim/change-impact-preview", payload: {}, why: "focus 必填" },
  { label: "A8  POST /a/v1/sim/chain-loss-matrix", method: "POST", url: "/a/v1/sim/chain-loss-matrix", payload: { so: 123 }, why: "so 须为 string" },
  { label: "A9  POST /a/v1/ontology/interfaces", method: "POST", url: "/a/v1/ontology/interfaces", payload: {}, why: "key/name 必填" },
  { label: "A10 POST /a/v1/ontology/cross-validate", method: "POST", url: "/a/v1/ontology/cross-validate", payload: {}, why: "claims 必填" },
  // ⚠ DataBuilderConfigSchema 全字段带 default ⇒ `{}` 是**合法**的（实测改前回 200）。
  //    拿 `{}` 当"必然不合法"会把这条测成假绿 —— 必须给一个真会炸的值。
  { label: "A11 POST /a/v1/data-builders/validate-config", method: "POST", url: "/a/v1/data-builders/validate-config", payload: { determinism: { seed: "not-a-number" } }, why: "determinism.seed 须为 int" },
  // ── B 组 ────────────────────────────────────────────────────────────────
  { label: "B1  POST /a/v1/sim/propagation-rules", method: "POST", url: "/a/v1/sim/propagation-rules", payload: {}, why: "key/sourceTypeKey/sourceStateVar… 必填" },
  { label: "B2  PUT  /a/v1/data-categories/:key/mode", method: "PUT", url: "/a/v1/data-categories/sales_orders/mode", payload: {}, why: "mode 非枚举值（缺失）" },
  { label: "B3  PUT  /a/v1/data-categories/:key/template", method: "PUT", url: "/a/v1/data-categories/sales_orders/template", payload: {}, why: "columns 须为 array" },
  { label: "B4  PUT  /a/v1/connections/:id/validation-policy", method: "PUT", url: "/a/v1/connections/nosuch/validation-policy", payload: { policy: { unknownFields: "NOPE" } }, why: "unknownFields 非枚举值" },
];

describe("统一错误信封 · 入参不合法一律 400 VALIDATION_ERROR（不回显 zod 内部结构）", () => {
  it("金丝雀：泄漏探测器对『改前真实 500 原文』必须报警，对『改后真实 400 原文』必须放行", () => {
    // 正向：改前那坨真的会被抓到（探测器没坏）。抓不到 ⇒ 报"探测器坏了"，不许报"代码干净"。
    const leaked = zodInternalsLeaked(REAL_BROKEN_BODY_BEFORE_FIX);
    expect(leaked.length, "探测器对改前真实 500 原文零命中 ⇒ 探测器坏了，本文件全部绿都不作数").toBeGreaterThan(0);
    // 反向：改好之后的人读串里虽含 "expected" 这个词，但不该被误判成泄漏。
    expect(zodInternalsLeaked(REAL_GOOD_BODY_AFTER_FIX)).toEqual([]);
  });

  it("15 条路由逐条：http=400 · code=VALIDATION_ERROR · 信封完整 · 无 zod 内部结构", async () => {
    const t: TestApp = await makeApp();
    const failures: string[] = [];

    for (const c of CASES) {
      const res = await t.app.inject({ method: c.method, url: c.url, headers: ADMIN, payload: c.payload as object });
      const raw = res.body;
      let parsed: { error?: { code?: unknown; message?: unknown; requestId?: unknown } } = {};
      try {
        parsed = res.json() as typeof parsed;
      } catch {
        failures.push(`${c.label} · 响应体不是 JSON：${raw.slice(0, 200)}`);
        continue;
      }
      const err = parsed.error;

      if (res.statusCode !== 400) {
        failures.push(`${c.label} · http 应为 400（${c.why}），实为 ${res.statusCode}；body=${raw.slice(0, 300)}`);
      }
      if (err?.code !== "VALIDATION_ERROR") {
        failures.push(`${c.label} · error.code 应为 VALIDATION_ERROR，实为 ${String(err?.code)}`);
      }
      if (typeof err?.message !== "string" || err.message.length === 0) {
        failures.push(`${c.label} · error.message 缺失或空`);
      }
      if (typeof err?.requestId !== "string" || err.requestId.length === 0) {
        failures.push(`${c.label} · error.requestId 缺失（信封三件套不完整）`);
      }
      // 泄漏判据同时扫**原始响应文本**与**解开一层的 message**：
      // 前者管 JSON 转义后的形态，后者管 message 本身就是一坨序列化 issue 数组的形态。
      const leaked = [...new Set([...zodInternalsLeaked(raw), ...zodInternalsLeaked(String(err?.message ?? ""))])];
      if (leaked.length > 0) {
        failures.push(`${c.label} · 回显了 zod 内部结构 [${leaked.join(" / ")}]；body=${raw.slice(0, 400)}`);
      }
    }

    expect(failures.join("\n"), `共 ${failures.length} 条断言未过：\n${failures.join("\n")}`).toBe("");
  });

  it("对照 · 已修好的邻居 optimize-pareto 口径不变（本单不许动它）", async () => {
    const t: TestApp = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/sim/optimize-pareto", headers: ADMIN, payload: {} });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    expect(zodInternalsLeaked(res.body)).toEqual([]);
  });

  it("合法入参照常放行 —— 本单只改『校验失败怎么回』，没有收紧任何 schema", async () => {
    const t: TestApp = await makeApp();
    // DataBuilderConfigSchema 全字段带 default ⇒ `{}` 改前改后都该是 200（这条守住"没顺手收紧"）。
    const ok = await t.app.inject({ method: "POST", url: "/a/v1/data-builders/validate-config", headers: ADMIN, payload: {} });
    expect(ok.statusCode, ok.body.slice(0, 300)).toBe(200);
    expect((ok.json() as { ok: boolean }).ok).toBe(true);

    // PutCalendarBodySchema 是 .partial() ⇒ `{}` 合法，且 weekendMode 走默认值。
    const cal = await t.app.inject({ method: "PUT", url: "/a/v1/calendars/default", headers: ADMIN, payload: {} });
    expect(cal.statusCode, cal.body.slice(0, 300)).toBe(200);

    // 真正合法的 llm-budget 写入照常成功。
    const bud = await t.app.inject({ method: "PUT", url: "/a/v1/llm-budgets", headers: ADMIN, payload: { hardLimitTokens: 1000 } });
    expect(bud.statusCode, bud.body.slice(0, 300)).toBe(200);
  });
});
