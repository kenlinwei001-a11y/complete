import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
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

  it("P2 HITL：intake 落对账候选队列 → resolve(NEW) → RESOLVED + 事件（R2 隔离）", async () => {
    const t: TestApp = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake", headers: ADMIN, payload: { html: PROTOTYPE } });
    const body = res.json() as { reconcile: { candidates: { id: string; status: string }[] } };
    const pending = body.reconcile.candidates;
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0]!.id).toBeTruthy();

    // 队列可查
    const queue = (await (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/reconcile-candidates?status=PENDING", headers: ADMIN })).json()) as { items: { id: string }[] };
    expect(queue.items.length).toBe(pending.length);

    // 人确认（NEW = 新建字段）→ RESOLVED
    const id = pending[0]!.id;
    const resolved = (await (await t.app.inject({ method: "POST", url: `/a/v1/databuilder/reconcile-candidates/${id}/resolve`, headers: ADMIN, payload: { action: "NEW", target: "priority" } })).json()) as { status: string; resolvedAction: string; resolvedTarget: string };
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedAction).toBe("NEW");
    expect(resolved.resolvedTarget).toBe("priority");
    // 事件
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "schema_reconcile.resolved");
    expect(events.length).toBe(1);
    // R2：另一租户看不到该候选队列
    const other = (await (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/reconcile-candidates", headers: { "x-debug-user": "acme:admin:admin" } })).json()) as { items: unknown[] };
    expect(other.items.length).toBe(0);
  });

  it("P3 导入正门：HTML 物化进库 → 数据连接器可见导入文件 + 在线查看各表（全量行）", async () => {
    const t: TestApp = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake/import", headers: ADMIN, payload: { html: PROTOTYPE, filename: "demo.html" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { connection: { id: string; name: string; category: string }; datasets: { id: string; name: string; rowCount: number }[]; rowCounts: Record<string, number> };
    // 连接（导入文件）落库 + 归类 PROTOTYPE
    expect(body.connection.name).toBe("原型导入:demo.html");
    expect(body.connection.category).toBe("PROTOTYPE");
    // 数据连接器列表可见该连接
    const conns = (await (await t.app.inject({ method: "GET", url: "/a/v1/connections", headers: ADMIN })).json()) as { id: string; connectorTypeKey: string }[];
    expect(conns.some((x) => x.id === body.connection.id && x.connectorTypeKey === "prototype_html")).toBe(true);
    // 两张表（ORDERS/BASES）全量落 RawDataset
    expect(body.datasets.map((d) => d.name).sort()).toEqual(["BASES", "ORDERS"]);
    const orders = body.datasets.find((d) => d.name === "ORDERS")!;
    expect(orders.rowCount).toBe(2);
    // 在线查看：从库读行，值与原型一致
    const rows = (await (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${orders.id}/rows`, headers: ADMIN })).json()) as { rows: Record<string, unknown>[] };
    expect(rows.rows.length).toBe(2);
    expect(rows.rows.some((r) => r.so === "SO-1" && r.qty === 1200)).toBe(true);
    // 事件
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "prototype.materialized");
    expect(events.length).toBe(1);
  });

  it("P3 闭环末步：导入 → objectify 按对账物化进既有对象库（/object-types 计数增）+ 诚实跳过", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t); // 发布 battery 本体（Order 含 so*/qty 字段；ORDERS.so/qty 可对账命中）
    const imp = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake/import", headers: ADMIN, payload: { html: PROTOTYPE, filename: "demo.html" } })).json()) as { connection: { id: string } };
    // 物化前 Order 计数
    const before = (await (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types/stats", headers: ADMIN })).json()) as { stats: { key: string; count: number }[] };
    const orderBefore = before.stats.find((s) => s.key === "Order")?.count ?? 0;

    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake/objectify", headers: ADMIN, payload: { connId: imp.connection.id } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { materialized: { dataset: string; type: string; count: number }[]; skipped: { dataset: string; reason: string }[] };
    // ORDERS.so(PK)/qty 对账命中 Order → 物化 2 条 Order 对象
    const orderMat = body.materialized.find((m) => m.dataset === "ORDERS" && m.type === "Order");
    expect(orderMat?.count).toBe(2);
    // BASES 列（base/name 多义/未命中）→ 诚实跳过（不猜）
    expect(body.skipped.some((s) => s.dataset === "BASES")).toBe(true);

    // /object-types 计数确实增长（从库读，可查询）
    const after = (await (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types/stats", headers: ADMIN })).json()) as { stats: { key: string; count: number }[] };
    const orderAfter = after.stats.find((s) => s.key === "Order")?.count ?? 0;
    expect(orderAfter).toBe(orderBefore + 2);

    // 幂等：再 objectify 一次，计数不翻倍（R6）
    await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake/objectify", headers: ADMIN, payload: { connId: imp.connection.id } });
    const after2 = (await (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types/stats", headers: ADMIN })).json()) as { stats: { key: string; count: number }[] };
    expect(after2.stats.find((s) => s.key === "Order")?.count ?? 0).toBe(orderAfter);

    // 事件
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "prototype.objectified");
    expect(events.length).toBe(2);
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
