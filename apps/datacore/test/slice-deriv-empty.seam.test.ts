import { describe, expect, it } from "vitest";
import { RefKindSchema } from "@platform/contracts";
import { makeApp, seedBattery, ADMIN, debugUser, type TestApp } from "./helpers.js";
import { seedDemoDerivationSpecs } from "../src/seed-derivation-specs.js";

/**
 * WO-SLICE-DERIV-EMPTY · 接缝测试（头号判据）——切片反查与派生溯源两条恒空链路的端到端驱动。
 *
 * 每条链都锁**前后两态**：先断言「生产那一步没走」时反查/溯源为空（= 今天的病灶），
 * 再走完生产那一步断言取得到。变异反证因此天然成立 —— 拆掉生产那一步，红在
 * 「反查结果里没有它」/「溯源取不到 inputs」，不是红在「函数不存在」。
 *
 * ① G-SLICE-REF-PRODUCER-EMPTY：B→A 上报 kind:"slice" ⇒ sliceReferences 反查得到 + 十六层 ① 翻 present。
 * ② G-DERIVSPEC-EMPTY：编译派生 ⇒ recompute 写值 ⇒ value-runs 取得到 inputs 快照；
 *    种子路径 seedDemoDerivationSpecs 幂等入库 ⇒ ⑭证据层取到 ds: 条目。
 * ③ G-SLICE-ROOT-ARGS-UNDISCOVERABLE：列表摘要下发 requiredArgs。
 * ⑤ G-SLICE-EMPTYGRAPH-MISREAD：resolve 空子图带 empty 诊断（missing_args / no_root_objects 机器可分辨）。
 */

const SERVICE = { "x-service-token": "svc-secret", "x-tenant-id": "demo", "x-service-caller": "agentcore" };
const makeSvcApp = (): Promise<TestApp> => makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });

interface LayersResponse {
  layers: { id: string; status: string; count: number; items: { key: string }[] }[];
}

describe("WO-SLICE-DERIV-EMPTY ①③⑤ · 切片反查 + requiredArgs + 空图诚实位", () => {
  it("约定位：contracts RefKindSchema 含 slice（拆掉 ⇒ 红在这一行，不是「函数不存在」）", () => {
    expect(RefKindSchema.safeParse("slice").success).toBe(true);
    // 金丝雀（反侧）：既有 kind 不受影响，胡说八道的 kind 仍被拒。
    expect(RefKindSchema.safeParse("rule").success).toBe(true);
    expect(RefKindSchema.safeParse("not_a_kind").success).toBe(false);
  });

  it("接缝：上报 slice 引用 ⇒ 反查查得到 + 十六层①翻 present；requiredArgs 进列表摘要；空图带诊断", async () => {
    const t = await makeSvcApp();
    await seedBattery(t); // 真切片 order_fulfillment_360（root selector 声明 {{args.so}}）随合成注册

    // ── ③ requiredArgs：列表摘要就看得出「这条切片要参数」────────────────────
    const list = await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices", headers: ADMIN });
    expect(list.statusCode).toBe(200);
    const rows = list.json() as { sliceKey: string; requiredArgs?: string[] }[];
    const of360 = rows.find((r) => r.sliceKey === "order_fulfillment_360");
    expect(of360, "电池合成应注册 order_fulfillment_360").toBeDefined();
    expect(of360!.requiredArgs).toEqual(["so"]);
    // 反侧金丝雀：无参切片（enterprise_360 以外的 coverage_* 无占位符）⇒ 空数组而非缺字段。
    const noArg = rows.find((r) => (r.requiredArgs ?? []).length === 0);
    expect(noArg, "至少一条无参切片 ⇒ requiredArgs=[] 而非 undefined").toBeDefined();
    expect(noArg!.requiredArgs).toEqual([]);

    // ── ⑤ 空图诚实位：resolve 空子图机器可分辨 ─────────────────────────────
    const emptyRes = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/slices/order_fulfillment_360/resolve",
      headers: ADMIN,
      payload: { args: {} },
    });
    expect(emptyRes.statusCode).toBe(200);
    const emptyOut = emptyRes.json() as {
      nodes: unknown[];
      empty?: { reason: string; requiredArgs: string[]; missingArgs: string[]; argCandidates: { arg: string; values: string[] }[] };
    };
    expect(emptyOut.nodes).toEqual([]);
    expect(emptyOut.empty?.reason).toBe("missing_args");
    expect(emptyOut.empty?.requiredArgs).toEqual(["so"]);
    expect(emptyOut.empty?.missingArgs).toEqual(["so"]);
    // 候选值必须来自真对象（填进去真能解出子图），不许编示例值。
    const soCandidates = emptyOut.empty?.argCandidates.find((a) => a.arg === "so")?.values ?? [];
    expect(soCandidates.length).toBeGreaterThan(0);
    expect(soCandidates).toContain("SO-3391");

    // 给上候选值 ⇒ 解出真子图，empty 消失（「算出来是空」与「解出来了」分得开）。
    const filled = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/slices/order_fulfillment_360/resolve",
      headers: ADMIN,
      payload: { args: { so: "SO-3391" } },
    });
    const filledOut = filled.json() as { nodes: unknown[]; empty?: unknown };
    expect(filledOut.nodes.length).toBeGreaterThan(0);
    expect(filledOut.empty).toBeUndefined();

    // 另一因：root 类型本租户零对象 ⇒ reason=no_root_objects（与 missing_args 不是一句话）。
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/ontology/slices/seam_empty_root",
      headers: ADMIN,
      payload: { version: 1, spec: { root: { typeKey: "Arpu", selector: {} }, paths: [] } },
    });
    const noRoot = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/slices/seam_empty_root/resolve",
      headers: ADMIN,
      payload: { args: {} },
    });
    const noRootOut = noRoot.json() as { nodes: unknown[]; empty?: { reason: string; rootObjectTotal: number } };
    expect(noRootOut.nodes).toEqual([]);
    expect(noRootOut.empty?.reason).toBe("no_root_objects");
    expect(noRootOut.empty?.rootObjectTotal).toBe(0);

    // ── ① 反查：先锁「未上报 ⇒ 空」（今天的病灶），再走完上报断言查得到 ──────
    const before = await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices/order_fulfillment_360/references", headers: ADMIN });
    expect((before.json() as { total: number }).total).toBe(0); // 病灶前态：生产方没走 ⇒ 恒空

    const report = await t.app.inject({
      method: "POST",
      url: "/a/v1/references/report",
      headers: SERVICE,
      payload: {
        source: { kind: "workflow", key: "wf_order_tracking", name: "订单履约跟踪" },
        refs: [{ kind: "slice", key: "order_fulfillment_360", version: "latest" }],
      },
    });
    expect(report.statusCode).toBe(204);

    const after = await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices/order_fulfillment_360/references", headers: ADMIN });
    const afterBody = after.json() as { total: number; refs: { refKind: string; key: string }[] };
    expect(afterBody.total).toBe(1);
    expect(afterBody.refs[0]).toMatchObject({ refKind: "workflow", key: "wf_order_tracking" });

    // 十六层 ①业务场景随之翻 present（消费者最终看到的那一格）。
    const layers = await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices/order_fulfillment_360/layers", headers: ADMIN });
    const lbody = layers.json() as LayersResponse;
    const scenario = lbody.layers.find((l) => l.id === "business_scenario");
    expect(scenario?.status).toBe("present");
    expect(scenario?.items.some((i) => i.key === "wf_order_tracking")).toBe(true);
  });
});

describe("WO-SLICE-DERIV-EMPTY ② · 派生溯源：编译 ⇒ 重算 ⇒ inputs 快照取得到", () => {
  it("接缝：编译派生 ⇒ recompute 写 dvrun ⇒ value-runs 返回 inputs 快照；空结果诚实分态", async () => {
    const t = await makeSvcApp();
    await seedBattery(t);
    // byKey 口径同源（ontology-core.ts executeSlice：`objectKey ?? props[pk] ?? id`）——
    // 合成 Order 的 objectKey 是内部 id（obj_order_*），业务主键在 props.so，按 props.so 找。
    const order = (await t.repos.objects.listByType("demo", "Order")).find((o) => String(o.props.so) === "SO-3391");
    expect(order, "电池合成应有订单 SO-3391").toBeDefined();

    // 前态：规格不存在 ⇒ specStatus=NOT_FOUND + emptyReason（「没有这规格」≠「算出来是空」）。
    const pre = await t.app.inject({ method: "GET", url: "/a/v1/ontology/derivation-specs/seam_order_value/value-runs", headers: ADMIN });
    const preBody = pre.json() as { specStatus: string; total: number; emptyReason?: string };
    expect(preBody.specStatus).toBe("NOT_FOUND");
    expect(preBody.total).toBe(0);
    expect(preBody.emptyReason).toContain("不存在");

    // 编译（生产那一步）⇒ 规格 ACTIVE。
    const compile = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/derivation-specs/compile",
      headers: ADMIN,
      payload: { specs: [{ specKey: "seam_order_value", targetType: "Order", targetProp: "value", formula: "this.qty * this.unitPrice" }] },
    });
    expect(compile.statusCode).toBe(201);

    // 还没重算过 ⇒ 空但诚实（「规格在、没算过」与「没这规格」两句话不同）。
    const noRun = await t.app.inject({ method: "GET", url: "/a/v1/ontology/derivation-specs/seam_order_value/value-runs", headers: ADMIN });
    const noRunBody = noRun.json() as { specStatus: string; total: number; emptyReason?: string };
    expect(noRunBody.specStatus).toBe("ACTIVE");
    expect(noRunBody.total).toBe(0);
    expect(noRunBody.emptyReason).toContain("尚未触发过重算");

    // 触发重算 ⇒ dvrun 落 inputs 快照。
    const rec = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/recompute",
      headers: ADMIN,
      payload: { changes: [{ typeKey: "Order", prop: "qty", objectIds: [order!.id] }] },
    });
    expect(rec.statusCode).toBe(200);
    expect((rec.json() as { updatedObjects: number }).updatedObjects).toBeGreaterThan(0);

    // 溯源取得到 inputs 快照（本单的核心断言：拆 compile 或拆路由都红在这里）。
    const runs = await t.app.inject({ method: "GET", url: "/a/v1/ontology/derivation-specs/seam_order_value/value-runs", headers: ADMIN });
    const runsBody = runs.json() as {
      total: number;
      emptyReason?: string;
      items: { objectId: string; targetProp: string; value: unknown; inputs: { objectId: string; prop: string; value: unknown }[] }[];
    };
    expect(runsBody.total).toBeGreaterThan(0);
    expect(runsBody.emptyReason).toBeUndefined();
    const run = runsBody.items.find((r) => r.objectId === order!.id);
    expect(run, "SO-3391 的重算留痕").toBeDefined();
    expect(run!.targetProp).toBe("value");
    const inputProps = run!.inputs.map((i) => i.prop).sort();
    expect(inputProps).toEqual(["qty", "unitPrice"]);
    const qty = Number(order!.props.qty);
    const unitPrice = Number(order!.props.unitPrice);
    expect(run!.value).toBe(Math.round((qty * unitPrice + Number.EPSILON) * 1e4) / 1e4);

    // objectId 过滤 + 跨租户隔离（R2）。
    const filtered = await t.app.inject({
      method: "GET",
      url: `/a/v1/ontology/derivation-specs/seam_order_value/value-runs?objectId=${encodeURIComponent(order!.id)}`,
      headers: ADMIN,
    });
    expect((filtered.json() as { total: number }).total).toBe(1);
    const other = await t.app.inject({
      method: "GET",
      url: "/a/v1/ontology/derivation-specs/seam_order_value/value-runs",
      headers: debugUser("other", "u1", "admin"),
    });
    expect((other.json() as { total: number }).total).toBe(0);
  });

  it("种子路径：seedDemoDerivationSpecs 入库 3 条 ACTIVE、幂等重播、⑭证据层取到 ds: 条目", async () => {
    const t = await makeSvcApp();
    await seedBattery(t);

    // 前态：种子没走 ⇒ ACTIVE 0（今天的病灶现算）。
    const before = await t.repos.derivationSpecs.list("demo", (s) => s.status === "ACTIVE");
    expect(before.length).toBe(0);

    const n = await seedDemoDerivationSpecs(t.repos, t.services.ontologyCore, t.services.governance, t.adminCtx);
    expect(n).toBe(3);
    const active = await t.repos.derivationSpecs.list("demo", (s) => s.status === "ACTIVE");
    expect(active.map((s) => s.specKey).sort()).toEqual(["fgi_qty_available", "ibt_eta_day", "order_value"]);

    // 幂等（R6）：重播不增生。
    await seedDemoDerivationSpecs(t.repos, t.services.ontologyCore, t.services.governance, t.adminCtx);
    expect((await t.repos.derivationSpecs.list("demo", (s) => s.status === "ACTIVE")).length).toBe(3);

    // §7.4 引用索引同步入库（与 REST 编译路由同动作）。
    const eref = await t.repos.elementRefs.list("demo", (r) => r.refKind === "derivation" && r.refKey === "order_value");
    expect(eref.length).toBeGreaterThan(0);

    // ⑭证据层：typeKeySet 来自**解出来的子图**（graph.nodes），空图 ⇒ 任何 ds: 都被滤掉。
    // 必须带 args 试切（与 POST …/resolve 同口径的 ?args=JSON），让 Order 进图。
    const layers = await t.app.inject({
      method: "GET",
      url: `/a/v1/ontology/slices/order_fulfillment_360/layers?args=${encodeURIComponent(JSON.stringify({ so: "SO-3391" }))}`,
      headers: ADMIN,
    });
    const evidence = (layers.json() as LayersResponse).layers.find((l) => l.id === "evidence");
    expect(evidence?.items.some((i) => i.key === "ds:order_value")).toBe(true);
  });
});
