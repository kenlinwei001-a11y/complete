import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import type { SyntheticJob } from "../src/domain.js";

async function runJob(t: Awaited<ReturnType<typeof makeApp>>, seed = 42): Promise<SyntheticJob> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/synthetic/jobs",
    headers: ADMIN,
    payload: { industry: "battery-manufacturing", scale: "S", seed },
  });
  expect(res.statusCode).toBe(202);
  return res.json() as SyntheticJob;
}

describe("A7 synthetic data", () => {
  it("SY1: seed 42 deterministic — validation report passes, rerun is deep-equal", async () => {
    const t = await makeApp();
    const job1 = await runJob(t);
    expect(job1.status).toBe("SUCCEEDED");
    const report = job1.report!;
    expect(report.rowCounts).toMatchObject({ Base: 12, Model: 6, Order: 24 });
    for (const check of report.fkChecks) expect(check, check.check).toMatchObject({ passed: true });
    for (const spot of report.derivationSpotChecks) expect(spot.ok, `${spot.typeKey}.${spot.propKey}`).toBe(true);
    expect(report.views).toEqual([
      "dash", "graph", "risk", "order", "plan-audit", "plan-generate", "project-sim", "sop-balance",
    ]);
    expect(report.accounts).toEqual(["admin", "planner", "base_manager"]);

    const snapshot1 = (await t.repos.objects.list("demo")).sort((a, b) => (a.id < b.id ? -1 : 1));
    const totalFromReport = Object.values(report.rowCounts).reduce((a, b) => a + b, 0);
    expect(snapshot1).toHaveLength(totalFromReport);
    expect(snapshot1.length).toBeGreaterThanOrEqual(12 + 6 + 20);
    // a 常州 base exists
    expect(snapshot1.some((o) => o.type === "Base" && o.props.name === "常州")).toBe(true);

    // idempotent re-run with the same seed: byte-identical objects + report
    const job2 = await runJob(t);
    const snapshot2 = (await t.repos.objects.list("demo")).sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(snapshot2).toEqual(snapshot1);
    expect(job2.report).toEqual(job1.report);

    // different seed → different data
    await runJob(t, 7);
    const snapshot3 = (await t.repos.objects.list("demo")).sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(snapshot3).not.toEqual(snapshot1);
  });

  it("EXT_SIG（#11）：外部信号一等对象化 + EXTERNAL 连接器（mock_external）", async () => {
    const t = await makeApp();
    await runJob(t); // 合成出厂期落 ExternalSignal 对象（domain=external）
    // 一等对象：GET /a/v1/external-signals 返回环境信号（带来源/单位/新鲜度，R13 可溯）
    const res = await t.app.inject({ method: "GET", url: "/a/v1/external-signals", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const { signals } = res.json() as { signals: Record<string, unknown>[] };
    expect(signals.length).toBeGreaterThanOrEqual(6);
    expect(signals.find((s) => s.signalKey === "li_carbonate_price")).toMatchObject({ unit: "元/吨", source: "上海有色网", category: "原料价格", impact: "毛利" });
    // EXTERNAL 连接器：mock_external sync → external_signals 原始表
    const conn = await t.app.inject({ method: "POST", url: "/a/v1/connections", headers: ADMIN, payload: { connectorTypeKey: "mock_external", name: "ext-feed", config: {} } });
    const connId = (conn.json() as { id: string }).id;
    const sync = await t.app.inject({ method: "POST", url: `/a/v1/connections/${connId}/sync`, headers: ADMIN });
    expect(sync.statusCode).toBeLessThan(300);
    const raws = (await (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })).json()) as { name: string; rowCount: number }[];
    const ds = raws.find((d) => d.name === "external_signals");
    expect(ds?.rowCount).toBeGreaterThanOrEqual(6);

    // P2 敏感性：信号冲击 → 规划指标（确定性弹性）。锂价 +10%（elasticity -0.08）→ 毛利 -0.8pp。
    const sens = await t.app.inject({
      method: "POST", url: "/a/v1/external-signals/sensitivity", headers: ADMIN,
      payload: { shocks: [{ signalKey: "li_carbonate_price", deltaPct: 10 }, { signalKey: "ev_demand_index", deltaPct: 5 }, { signalKey: "ghost", deltaPct: 1 }] },
    });
    expect(sens.statusCode).toBe(200);
    const { impacts, unknownSignals } = sens.json() as { impacts: { metric: string; deltaPct: number }[]; unknownSignals: string[] };
    expect(impacts.find((i) => i.metric === "毛利")?.deltaPct).toBe(-0.8);
    expect(impacts.find((i) => i.metric === "需求")?.deltaPct).toBe(3); // 5 × 0.6
    expect(unknownSignals).toContain("ghost");

    // 信号时序：近 12 月历史（确定性，末点≈当前值）
    const ser = await t.app.inject({ method: "GET", url: "/a/v1/external-signals/li_carbonate_price/series", headers: ADMIN });
    expect(ser.statusCode).toBe(200);
    const { points } = ser.json() as { points: { month: string; value: number }[] };
    expect(points).toHaveLength(12);
    expect(Math.abs(points[11]!.value - 96000)).toBeLessThan(700); // 末点≈当前值（含小波动）
  });

  it("seeds rules C03/C08/C13 with origin SYNTHETIC; C03 blocks at demandDelta > 0.5", async () => {
    const t = await makeApp();
    await runJob(t);
    const rules = (
      await t.app.inject({ method: "GET", url: "/a/v1/rules?status=PUBLISHED", headers: ADMIN })
    ).json() as { key: string; origin: { type: string }; severity: string }[];
    const keys = rules.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["C03", "C08", "C13"]));
    expect(rules.find((r) => r.key === "C03")!.origin.type).toBe("SYNTHETIC");

    const verdicts = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/rules/evaluate",
        headers: ADMIN,
        payload: { ruleIds: ["C03"], payload: { demandDelta: 0.6 } },
      })
    ).json() as { ruleId: string; passed: boolean; severity: string }[];
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ ruleId: "C03", passed: false, severity: "BLOCK" });

    const pass = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/rules/evaluate",
        headers: ADMIN,
        payload: { ruleIds: "ALL_APPLICABLE", payload: { demandDelta: 0.2, outsourceRatio: 0.5 } },
      })
    ).json() as { ruleId: string; passed: boolean; severity: string }[];
    expect(pass.find((v) => v.ruleId === "C03")!.passed).toBe(true);
    expect(pass.find((v) => v.ruleId === "C08")).toMatchObject({ passed: false, severity: "WARN" });
  });

  it("SY-rules-live: 约束在真实合成数据上真触发（C03/C08/C13 ruleScan violations>0）—— Phase3 修复哑弹规则", async () => {
    const t = await makeApp();
    const job = await runJob(t);
    const scan = job.report!.ruleScan;
    for (const key of ["C03", "C08", "C13"]) {
      const r = scan.find((s) => s.ruleKey === key);
      expect(r, `${key} 进入扫描`).toBeTruthy();
      expect(r!.evaluated, `${key} 扫描了订单`).toBeGreaterThan(0);
      expect(r!.violations, `${key} 命中越线行(规则真触发，非哑弹)`).toBeGreaterThan(0);
    }
    // 新增约束字段已落到对象上（C29/C33/C16/C27/C31 的承载属性）
    const order = (await t.repos.objects.listByType("demo", "Order"))[0]!;
    for (const p of ["demandDelta", "outsourceRatio", "creditUsedRatio", "leadDays"]) {
      expect(order.props[p], `Order.${p} 存在`).not.toBeUndefined();
    }
    const model = (await t.repos.objects.listByType("demo", "Model"))[0]!;
    expect(model.props.carbonFootprint, "Model.carbonFootprint 存在").not.toBeUndefined();
    const material = (await t.repos.objects.listByType("demo", "Material"))[0]!;
    for (const p of ["devPct", "outsourceYield"]) expect(material.props[p], `Material.${p} 存在`).not.toBeUndefined();
    const ship = (await t.repos.objects.listByType("demo", "Shipment"))[0]!;
    expect(ship.props.coverageDays, "Shipment.coverageDays 存在").not.toBeUndefined();
  });

  it("SY2: cross-module consistency — same numbers come from the same object instance", async () => {
    const t = await makeApp();
    await runJob(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const models = await t.repos.objects.listByType("demo", "Model");
    const bases = await t.repos.objects.listByType("demo", "Base");

    const order = orders[0]!;
    const model = models.find((m) => m.props.modelId === order.props.model)!;
    // ledger detail (Order.qty) aggregates exactly into the dashboard KPI (Model.totalDemand)
    const ledgerSum = orders
      .filter((o) => o.props.model === model.props.modelId)
      .reduce((a, o) => a + (o.props.qty as number), 0);
    expect(model.props.totalDemand).toBe(ledgerSum);

    // base-level commitment derived from the same order instances
    const base = bases.find((b) => b.props.baseId === "changzhou")!;
    const baseSum = orders
      .filter((o) => (o.props.bases as string[]).includes("changzhou"))
      .reduce((a, o) => a + (o.props.qty as number), 0);
    expect(base.props.committedQty).toBe(baseSum);
    expect(base.props.orderCount).toBe(
      orders.filter((o) => (o.props.bases as string[]).includes("changzhou")).length,
    );

    // derived order value comes from the same instance (qty × unitPrice)
    expect(order.props.value).toBe((order.props.qty as number) * (order.props.unitPrice as number));

    // solver input consistency: affected_orders draws from the same Order objects
    const solver = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/solvers/affected_orders/invoke",
        headers: ADMIN,
        payload: { args: { baseId: "changzhou", fromDay: 0, toDay: 7 } },
      })
    ).json() as { data: { affected: { so: string; qty: number }[] } };
    const soSet = new Map(orders.map((o) => [o.props.so as string, o.props.qty as number]));
    for (const a of solver.data.affected) {
      expect(soSet.get(a.so)).toBe(a.qty);
    }
  });

  it("LIVE-DATA: 合成对象经'合成源→RawDataset→物化'落地，数据源可见原始行 + 对象 origin 可溯回（PRD-live-traceable-data §3.1）", async () => {
    const t = await makeApp();
    await runJob(t);

    // ① 数据源页可见：存在"合成数据源"连接
    const conns = (await t.app.inject({ method: "GET", url: "/a/v1/connections", headers: ADMIN })).json() as { id: string; name: string }[];
    const synth = conns.find((c) => c.name.includes("合成数据源"));
    expect(synth, "存在合成数据源连接（不再凭空对象）").toBeTruthy();

    // ② 每核心对象类型一张 RawDataset，可见原始行
    const datasets = (await t.app.inject({ method: "GET", url: "/a/v1/raw-datasets", headers: ADMIN })).json() as { id: string; name: string; sourceConnId: string; rowCount: number }[];
    const byName = new Map(datasets.map((d) => [d.name, d]));
    for (const type of ["Base", "Model", "Order"]) expect(byName.get(type), `RawDataset ${type} 存在`).toBeTruthy();
    const orderDs = byName.get("Order")!;
    expect(orderDs.rowCount).toBe(24);
    expect(orderDs.sourceConnId).toBe(synth!.id);

    const rowsRes = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${orderDs.id}/rows`, headers: ADMIN })).json() as { rows: Record<string, unknown>[] };
    expect(rowsRes.rows.length).toBe(24); // 原始行可在数据源页查看

    // ③ 对象 origin 可溯回原始表：rawDatasetId 指真实数据集 + 行序 + 合成连接
    const orders = await t.repos.objects.listByType("demo", "Order");
    const dsIds = new Set(datasets.map((d) => d.id));
    for (const o of orders) {
      expect(o.origin.type).toBe("SYNTHETIC");
      const org = o.origin as { rawDatasetId?: string; rawRowIdx?: number; sourceConnId?: string };
      expect(org.rawDatasetId && dsIds.has(org.rawDatasetId), `Order ${o.id} origin 溯回真实 RawDataset`).toBe(true);
      expect(org.rawDatasetId).toBe(orderDs.id);
      expect(typeof org.rawRowIdx).toBe("number");
      expect(org.sourceConnId).toBe(synth!.id);
    }
  });

  it("LINEAGE: 对象 → 原始行 → RawDataset → 连接器 反查（PRD-live-traceable-data §3.2）", async () => {
    const t = await makeApp();
    await runJob(t);
    const orders = await t.repos.objects.listByType("demo", "Order");
    const so = orders[0]!.props.so as string;

    const lin = (
      await t.app.inject({ method: "GET", url: `/a/v1/lineage/object/Order/${encodeURIComponent(so)}`, headers: ADMIN })
    ).json() as {
      object: { id: string; type: string; origin: { rawDatasetId?: string } };
      source: { connection: { name: string } | null; rawDataset: { name: string } | null; rawRowIdx: number | null; rawRow: Record<string, unknown> | null };
      derivations: { prop: string; formula: string }[];
    };
    expect(lin.object.type).toBe("Order");
    expect(lin.source.connection!.name).toContain("合成数据源"); // 溯到合成连接器
    expect(lin.source.rawDataset!.name).toBe("Order"); // 溯到 Order 原始表
    expect(typeof lin.source.rawRowIdx).toBe("number");
    expect(lin.source.rawRow!.so).toBe(so); // 溯回的原始行正是这条订单（不再"无源头"）
    expect(Array.isArray(lin.derivations)).toBe(true); // 计算口径（派生属性）一并给出

    // 未知对象 → 404（鉴权/存在性，复用 getObject 语义）
    const miss = await t.app.inject({ method: "GET", url: "/a/v1/lineage/object/Order/NOPE", headers: ADMIN });
    expect(miss.statusCode).toBe(404);
  });

  it("SY3: unknown industry → LLM-generated template, stored for reuse, full flow runs", async () => {
    const t = await makeApp();
    t.llm.enqueue({
      industryKey: "vertical-farming",
      ontology: {
        objectTypes: [
          {
            key: "Farm",
            displayName: "农场",
            properties: [{ propKey: "farmId", dataType: "string", isPrimaryKey: true }],
            derivedProperties: [{ propKey: "batchCount", formula: "COUNT(Batch.batchId BY farm)" }],
          },
          {
            key: "Batch",
            displayName: "批次",
            properties: [
              { propKey: "batchId", dataType: "string", isPrimaryKey: true },
              { propKey: "farm", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Farm" },
              { propKey: "yieldKg", dataType: "number", isPrimaryKey: false },
            ],
            derivedProperties: [],
          },
        ],
        linkTypes: [],
      },
      generation: [
        {
          typeKey: "Farm",
          count: { S: 3, M: 5, L: 10 },
          propGenerators: { farmId: { kind: "pattern", pattern: "FARM-{seq:3}" } },
        },
        {
          typeKey: "Batch",
          count: { S: 9, M: 30, L: 100 },
          propGenerators: {
            batchId: { kind: "pattern", pattern: "B-{seq:4}" },
            farm: { kind: "fkSample", refTypeKey: "Farm" },
            yieldKg: { kind: "number", min: 50, max: 500, precision: 1 },
          },
        },
      ],
      rules: [{ key: "F01", name: "产量下限", expression: "Batch.yieldKg < 50", severity: "WARN" }],
      scenarioSeed: { views: ["dash"], intents: [] },
    });
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/synthetic/jobs",
      headers: ADMIN,
      payload: { industry: "vertical-farming", scale: "S", seed: 1 },
    });
    expect(res.statusCode).toBe(202);
    const job = res.json() as SyntheticJob;
    expect(job.status).toBe("SUCCEEDED");
    expect(job.report!.rowCounts).toMatchObject({ Farm: 3, Batch: 9 });

    // template stored for reuse → rerun must NOT need another LLM call
    expect(t.llm.calls).toHaveLength(1);
    const rerun = await t.app.inject({
      method: "POST",
      url: "/a/v1/synthetic/jobs",
      headers: ADMIN,
      payload: { industry: "vertical-farming", scale: "S", seed: 1 },
    });
    expect(rerun.statusCode).toBe(202);
    expect(t.llm.calls).toHaveLength(1);

    // referential integrity by construction + derivation ran
    const batches = await t.repos.objects.listByType("demo", "Batch");
    const farms = await t.repos.objects.listByType("demo", "Farm");
    const farmIds = new Set(farms.map((f) => f.props.farmId));
    for (const b of batches) expect(farmIds.has(b.props.farm)).toBe(true);
    const totalBatchCount = farms.reduce((a, f) => a + (f.props.batchCount as number), 0);
    expect(totalBatchCount).toBe(9);
  });
});
