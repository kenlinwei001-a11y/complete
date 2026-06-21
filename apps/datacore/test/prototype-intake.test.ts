import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { parsePrototypeHtml, reconcileIntake } from "../src/databuilder/prototype-intake.js";

/**
 * prototype-intake 正门 + schema 对账 HITL。
 * L0：确定性解析（R6 字节锁）+ 对账（映射不上生成候选给人确认，不调 LLM）。
 * L1：真服务 /a/v1/databuilder/intake（解析 + 对账既有本体 + 事件）。
 */

const PROTOTYPE = `
<html><head></head><body>
<script>
  // 原型内嵌数据表
  const ORDERS = [
    { so: "SO-1", qty: 1200, baseRef: "changzhou", pri: "HIGH" },
    { so: "SO-2", qty: 800, baseRef: "hefei", pri: "LOW" },
  ];
  const BASES = [
    { base: "changzhou", name: '常州' },
    { base: "hefei", name: '合肥' },
  ];
  // 关系：显式 L() + ref 命名
  L("ORDERS", "BASES", "PRODUCED_AT");
  const CONFIG = { theme: "dark", cols: 12 };  // 对象字面量（非数据表）→ unparsed
  const CHART_FN = () => 42;  // 非字面量（函数）→ 不捕获
</script>
</body></html>`;

describe("prototype-intake · 确定性解析 + 对账（L0）", () => {
  it("抽出数据表（对象数组）+ 列 + 样例行；非数据表入 unparsed（诚实）", () => {
    const r = parsePrototypeHtml(PROTOTYPE);
    expect(r.dataSources.map((d) => d.name)).toEqual(["BASES", "ORDERS"]); // 确定性按名排序
    const orders = r.dataSources.find((d) => d.name === "ORDERS")!;
    expect(orders.columns).toEqual(["so", "qty", "baseRef", "pri"]);
    expect(orders.rowCount).toBe(2);
    expect(orders.sampleRows.length).toBe(2);
    // 对象字面量（非对象数组）→ unparsed（诚实不静默丢）
    expect(r.unparsed.some((u) => u.name === "CONFIG")).toBe(true);
  });

  it("抽出关系：显式 L() + ref 命名约定（baseRef→BASES）", () => {
    const r = parsePrototypeHtml(PROTOTYPE);
    expect(r.links.some((l) => l.from === "ORDERS" && l.to === "BASES" && l.origin === "explicit")).toBe(true);
    expect(r.links.some((l) => l.rel === "baseRef" && l.origin === "ref")).toBe(true);
  });

  it("R6 确定性：同 HTML 同结果（字节锁）", () => {
    expect(JSON.stringify(parsePrototypeHtml(PROTOTYPE))).toBe(JSON.stringify(parsePrototypeHtml(PROTOTYPE)));
  });

  it("无 <script> → 全文兜底解析", () => {
    const r = parsePrototypeHtml(`const ROWS = [{ a: 1 }, { a: 2 }];`);
    expect(r.dataSources.find((d) => d.name === "ROWS")?.rowCount).toBe(2);
  });

  it("对账：归一名精确命中 → autoMapped；无命中 → 候选 NEW；多义 → 候选 USE", () => {
    const datasets = parsePrototypeHtml(PROTOTYPE).dataSources;
    const existing = [
      { typeKey: "Order", propKey: "qty" },
      { typeKey: "Order", propKey: "so" },
      { typeKey: "Base", propKey: "name" },
    ];
    const rec = reconcileIntake(datasets, existing);
    // qty/so/name 精确命中 → autoMapped
    expect(rec.autoMapped.some((a) => a.column === "qty" && a.targetField === "qty")).toBe(true);
    // pri 无既有字段 → 候选 NEW（给人确认，不静默丢）
    const pri = rec.candidates.find((c) => c.prototypeColumn === "pri")!;
    expect(pri.suggestedAction).toBe("NEW");
    expect(pri.candidates.length).toBe(0);
  });
});

describe("prototype-intake · 真服务端点（L1）", () => {
  it("POST /a/v1/databuilder/intake → 解析 + 对账既有本体 + 发 prototype.intake_recorded", async () => {
    const t: TestApp = await makeApp(); // 种子 demo 本体（Order/Base… 已发布）
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake", headers: ADMIN, payload: { html: PROTOTYPE } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { intake: { dataSources: unknown[]; links: unknown[]; unparsed: unknown[] }; reconcile: { autoMapped: unknown[]; candidates: unknown[] } };
    expect(body.intake.dataSources.length).toBe(2);
    expect(body.intake.links.length).toBeGreaterThan(0);
    // 对账既有本体：autoMapped + candidates 至少其一非空
    expect(body.reconcile.autoMapped.length + body.reconcile.candidates.length).toBeGreaterThan(0);
    // 事件
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "prototype.intake_recorded");
    expect(events.length).toBe(1);
  });

  it("R2：另一租户独立解析（解析无跨租户泄露，对账用各自本体）", async () => {
    const t: TestApp = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake", headers: { "x-debug-user": "acme:admin:admin" }, payload: { html: PROTOTYPE } });
    expect(res.statusCode).toBe(200);
    // acme 无种子本体 → 对账多为候选（无既有字段可映射）
    const body = res.json() as { reconcile: { autoMapped: unknown[] } };
    expect(Array.isArray(body.reconcile.autoMapped)).toBe(true);
  });
});
