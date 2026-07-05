import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, b64, type TestApp } from "./helpers.js";

/**
 * PANORAMA-FIELD-INTAKE（G-6 邻域收口）齿检：
 *  ① 全景类型 × 字段覆盖矩阵断言——图谱全景每个对象节点（=ACTIVE 已发布类型全集）都有数据模版，
 *    且模版列 ⊇ 该类型全部非派生 props（含 FK/ref 列·PK 在列·违红）；
 *  ② 连接器侧诚实未映射——mapped ∪ unmapped == 非派生 props（字段级清单·非模糊·非隐藏）；
 *  ③ 上传往返齿——模版下载→填样→上传→objectify 物化→对象逐字段 == 上传值（不再静默丢列）；
 *  ④ 全景自动完备——新发布类型（A3 自助）立即有模版 + 覆盖行 + 诚实"未归类"标注（R14 零手焙）。
 */

type CoverageItem = {
  typeKey: string;
  displayName: string;
  intakeTotal: number;
  derivedCount: number;
  suppliable: number;
  template: { available: boolean; columns: string[]; primaryKey: string | null; refColumns: { column: string; refToType: string }[]; covered: number; missing: string[]; downloadPath: string };
  connector: { bindings: { connId: string; dataset: string; mapped: { propKey: string; sourceField: string }[]; unmapped: string[] }[]; mapped: string[]; unmapped: string[] };
  fields: { propKey: string; template: boolean; connector: boolean }[];
  gaps: string[];
  categoryKey: string | null;
};
type CoverageResponse = { items: CoverageItem[]; summary: { types: number; templateComplete: number; typesWithTemplateGap: string[]; typesWithConnectorUnmapped: string[]; uncategorized: string[] } };

const getCoverage = async (t: TestApp): Promise<CoverageResponse> =>
  (await (await t.app.inject({ method: "GET", url: "/a/v1/intake-coverage", headers: ADMIN })).json()) as CoverageResponse;

describe("PANORAMA-FIELD-INTAKE · 全景类型×字段覆盖矩阵（矩阵齿·违红）", () => {
  it("①：全景每个对象节点都有模版，且模版列 ⊇ 非派生 props（PK 在列·ref 列标注 FK 父类型）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);

    // 全景基准 = /a/v1/ontology/graph 的对象节点全集（与 listTypes 同源，独立取证）。
    const graph = (await (await t.app.inject({ method: "GET", url: "/a/v1/ontology/graph", headers: ADMIN })).json()) as {
      nodes: { key: string; kind: string; properties: { propKey: string; isPrimaryKey: boolean }[] }[];
    };
    const panoramaTypes = graph.nodes.filter((n) => n.kind === "object");
    expect(panoramaTypes.length).toBeGreaterThan(20); // battery 全景 30+ 类型

    // 独立 oracle：已发布类型全 props/派生（不经 coverage 端点）。
    const types = (await (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })).json()) as {
      key: string; properties: { propKey: string; dataType: string; isPrimaryKey: boolean; refToTypeKey?: string | null }[]; derivedProperties?: { propKey: string }[];
    }[];
    const typeByKey = new Map(types.map((x) => [x.key, x]));

    const cov = await getCoverage(t);
    const covByKey = new Map(cov.items.map((i) => [i.typeKey, i]));

    for (const node of panoramaTypes) {
      const item = covByKey.get(node.key);
      // 全景每类型必有覆盖行。
      expect(item, `全景类型 ${node.key} 缺覆盖行`).toBeTruthy();
      // 模版必须存在（每个全景类型可下载数据模版·G-6）。
      expect(item!.template.available, `全景类型 ${node.key} 无数据模版`).toBe(true);
      expect(item!.template.downloadPath).toBe(`/a/v1/data-templates/${node.key}`);

      const def = typeByKey.get(node.key)!;
      const derived = new Set((def.derivedProperties ?? []).map((d) => d.propKey));
      const nonDerived = def.properties.filter((p) => !derived.has(p.propKey));
      const cols = new Set(item!.template.columns);
      // 矩阵齿核心：模版列 ⊇ 全部非派生 props（少一列即红·字段级非模糊）。
      for (const p of nonDerived) {
        expect(cols.has(p.propKey), `类型 ${node.key} 模版缺列 '${p.propKey}'`).toBe(true);
      }
      expect(item!.template.missing, `类型 ${node.key} template.missing 应为空`).toEqual([]);
      // PK 在列（上传可定位业务主键）。
      const pk = nonDerived.find((p) => p.isPrimaryKey);
      if (pk) expect(item!.template.primaryKey).toBe(pk.propKey);
      // FK 驱动：每个 ref 属性在 refColumns 标注父类型（G-6）。
      for (const p of nonDerived.filter((x) => x.dataType === "ref" && x.refToTypeKey)) {
        const rc = item!.template.refColumns.find((r) => r.column === p.propKey);
        expect(rc, `类型 ${node.key} ref 列 '${p.propKey}' 未标注 FK`).toBeTruthy();
        expect(rc!.refToType).toBe(p.refToTypeKey);
      }
      // 上传路径兜底 → 任一路径缺口应为空（gaps 非空即真断供）。
      expect(item!.gaps, `类型 ${node.key} 存在字段级供给缺口`).toEqual([]);
    }
    // summary 与逐项一致。
    expect(cov.summary.typesWithTemplateGap).toEqual([]);
    expect(cov.summary.templateComplete).toBe(cov.items.length);
    expect(cov.summary.types).toBe(cov.items.length);
  });

  it("②：连接器侧字段级诚实——mapped ∪ unmapped == 非派生 props（缺源字段列出·非隐藏）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const cov = await getCoverage(t);
    const order = cov.items.find((i) => i.typeKey === "Order")!;
    expect(order).toBeTruthy();
    // Order 出厂绑定（conn-erp/erp_sales_orders）只映射了部分字段。
    expect(order.connector.bindings.length).toBeGreaterThan(0);
    const b = order.connector.bindings[0]!;
    expect(b.dataset).toBe("erp_sales_orders");
    const mappedKeys = b.mapped.map((m) => m.propKey);
    expect(mappedKeys).toContain("so");
    expect(mappedKeys).toContain("qty");
    for (const m of b.mapped) expect(m.sourceField.length).toBeGreaterThan(0);
    // 诚实未映射：绑定未覆盖的字段逐个列出（非隐藏·非模糊）。
    expect(b.unmapped).toContain("unitPrice");
    expect(b.unmapped).toContain("pri");
    // 分区完整：mapped ∪ unmapped == 全部非派生 props（无字段被吞）。
    const union = new Set([...mappedKeys, ...b.unmapped]);
    expect(union.size).toBe(order.intakeTotal);
    expect([...order.connector.mapped, ...order.connector.unmapped].length).toBe(order.intakeTotal);
    // summary 登记该类型有连接器未映射字段。
    expect(cov.summary.typesWithConnectorUnmapped).toContain("Order");
    // 覆盖度分子：模版兜底 → suppliable == intakeTotal（上传路径全字段可供给）。
    expect(order.suppliable).toBe(order.intakeTotal);
  });

  it("④：新发布类型（A3 自助）自动进全景覆盖——立即有模版 + 覆盖行 + 诚实未归类（零手焙 R14）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "PanoProbe",
        displayName: "全景探针",
        properties: [
          { propKey: "probeId", dataType: "string", isPrimaryKey: true },
          { propKey: "baseId", dataType: "ref", refToTypeKey: "Base", isPrimaryKey: false },
          { propKey: "score", dataType: "number", isPrimaryKey: false },
        ],
        derivedProperties: [],
        sourceBindings: [],
      },
    });
    expect(res.statusCode).toBe(201);
    const cov = await getCoverage(t);
    const probe = cov.items.find((i) => i.typeKey === "PanoProbe")!;
    expect(probe).toBeTruthy();
    expect(probe.template.available).toBe(true);
    expect(probe.template.columns).toEqual(["probeId", "baseId", "score"]);
    expect(probe.template.refColumns).toEqual([{ column: "baseId", refToType: "Base" }]);
    expect(probe.template.missing).toEqual([]);
    // 诚实：新类型未归任何数据分类 → categoryKey null + summary.uncategorized 登记（非隐藏）。
    expect(probe.categoryKey).toBeNull();
    expect(cov.summary.uncategorized).toContain("PanoProbe");
    // 模版端点真可下载（text/csv·表头即列）。
    const dl = await t.app.inject({ method: "GET", url: "/a/v1/data-templates/PanoProbe", headers: ADMIN });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toContain("text/csv");
    expect(dl.body.trim()).toBe("probeId,baseId,score");
  });
});

describe("PANORAMA-FIELD-INTAKE · 上传往返齿（模版下载→填样→上传→物化→逐字段）", () => {
  it("③：Order 模版全列填样上传 → objectify → 对象每个字段值严格 == 上传值（不再静默丢列）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);

    // 1) 真下载模版（表头 = 全部非派生 props 含 FK 列）。
    const dl = await t.app.inject({ method: "GET", url: "/a/v1/data-templates/Order", headers: ADMIN });
    expect(dl.statusCode).toBe(200);
    const header = dl.body.trim().split("\n")[0]!;
    const cols = header.split(",");
    expect(cols).toContain("so");
    expect(cols).toContain("unitPrice"); // 全列（含出厂绑定未映射的字段）

    // 2) 逐列填样（每列一个可区分值·避免逗号以走 CSV 正门）。
    const fill: Record<string, string | number> = {
      so: "SO-RT-1", cust: "往返客户A", model: "4680-NCM", qty: 1234, due: "2026-08-08",
      pri: "高", bases: "常州", status: "OPEN", demandDelta: 7, outsourceRatio: 0.12,
      creditUsedRatio: 0.55, leadDays: 21, unitPrice: 2.5,
    };
    for (const c of cols) expect(fill[c], `齿检需为模版列 '${c}' 提供样值（模版列变更需同步填样）`).toBeDefined();
    const row = cols.map((c) => String(fill[c]!)).join(",");
    const csv = `${header}\n${row}\n`;

    // 3) 上传（真正门）→ objectify（确定性对账物化）。
    const up = (await (await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "order_roundtrip.csv", contentBase64: b64(csv) } })).json()) as { connId: string };
    const obj = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake/objectify", headers: ADMIN, payload: { connId: up.connId } })).json()) as {
      materialized: { dataset: string; type: string; count: number }[];
    };
    expect(obj.materialized.some((m) => m.type === "Order" && m.count >= 1)).toBe(true);

    // 4) 对象逐字段对照上传值（一列不落·一值不差）。
    const objs = (await (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Order&pageSize=500", headers: ADMIN })).json()) as {
      items: { id: string; props: Record<string, unknown> }[];
    };
    const inst = objs.items.find((o) => String(o.props.so ?? "") === "SO-RT-1");
    expect(inst, "往返对象未物化（SO-RT-1）").toBeTruthy();
    for (const c of cols) {
      expect(String(inst!.props[c]), `字段 '${c}' 往返值不一致`).toBe(String(fill[c]!));
    }
  });

  it("③b：FK 一致样例往返（Base 模版 withSamples）——样例 CSV 原样上传物化·逐字段一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const dl = await t.app.inject({ method: "GET", url: "/a/v1/data-templates/Base?withSamples=2", headers: ADMIN });
    expect(dl.statusCode).toBe(200);
    const lines = dl.body.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3); // 表头 + 2 样例行
    const cols = lines[0]!.split(",");
    const sample = Object.fromEntries(cols.map((c, i) => [c, lines[1]!.split(",")[i]!]));
    const pkCol = cols[0]!;

    const up = (await (await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "base_samples.csv", contentBase64: b64(dl.body) } })).json()) as { connId: string };
    const obj = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake/objectify", headers: ADMIN, payload: { connId: up.connId } })).json()) as {
      materialized: { type: string; count: number }[];
    };
    expect(obj.materialized.some((m) => m.type === "Base" && m.count >= 2)).toBe(true);

    const objs = (await (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Base&pageSize=500", headers: ADMIN })).json()) as {
      items: { props: Record<string, unknown> }[];
    };
    const inst = objs.items.find((o) => String(o.props[pkCol] ?? "") === sample[pkCol]);
    expect(inst, `样例行（${pkCol}=${sample[pkCol]}）未物化`).toBeTruthy();
    for (const c of cols) {
      expect(String(inst!.props[c]), `字段 '${c}' 样例往返值不一致`).toBe(String(sample[c]));
    }
  });
});
