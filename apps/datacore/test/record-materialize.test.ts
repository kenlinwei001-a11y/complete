import { describe, expect, it } from "vitest";
import { RecordMaterializeResultSchema } from "@platform/contracts";
import { makeApp, seedBattery, ADMIN, PLANNER, b64 } from "./helpers.js";
import { materializeRecords } from "../src/decision/record-materialize.js";
import type { PropertyDef } from "../src/domain.js";

/**
 * WO-CEO-DATA-supply · 真源记录**颗粒级**物化。
 * 验：① 1 行→1 真对象（无聚合·颗粒保留）；② R6 确定性；③ number 强转 + 非数值告警；④ 空主键跳过；
 * ⑤ 真链路 HTTP：upload 真财务 CSV → materialize FinancePlan → 对象真化(origin MATERIALIZED·真 datasetId) →
 *    finance_pnl 求解器读真值；⑥ KILL-MOCK-RED：合成源硬拒；⑦ 暗发门 404 / 非 admin 403 / dryRun 不落库。
 */

const FINANCE_PROPS: PropertyDef[] = [
  { propKey: "finId", dataType: "string", isPrimaryKey: true },
  { propKey: "line", dataType: "string", isPrimaryKey: false },
  { propKey: "budget", dataType: "number", isPrimaryKey: false },
  { propKey: "rolling", dataType: "number", isPrimaryKey: false },
];

const FINANCE_CSV = `finId,line,budget,rolling
FIN-REV,收入,50000,52000
FIN-COGS,销售成本,30000,31000
FIN-GM,毛利,20000,21000
`;

describe("record-materialize · 纯函数（颗粒不聚合·R6）", () => {
  const rows = [
    { finId: "FIN-REV", line: "收入", budget: "50000", rolling: "52000" },
    { finId: "FIN-COGS", line: "销售成本", budget: "30000", rolling: "31000" },
  ];
  const base = {
    targetType: "FinancePlan",
    props: FINANCE_PROPS,
    columnMapping: { finId: "finId", line: "line", budget: "budget", rolling: "rolling" },
    datasetId: "rds_real_fin",
    sourceConnId: "conn_upload_1",
  };

  it("① 1 行→1 对象（无聚合）·origin MATERIALIZED 真 datasetId·number 强转", () => {
    const { objects, primaryKey } = materializeRecords({ ...base, rows, primaryKeyColumn: "finId" });
    expect(primaryKey).toBe("finId");
    expect(objects).toHaveLength(2); // 2 行 → 2 对象（绝不聚合成 1）
    const rev = objects.find((o) => o.id === "obj_financeplan_FIN-REV")!;
    expect(rev.props.budget).toBe(50000); // "50000" → 50000（number 列强转·非字符串）
    expect(rev.props.rolling).toBe(52000);
    expect(rev.props.line).toBe("收入");
    expect(rev.origin).toEqual({ type: "MATERIALIZED", datasetId: "rds_real_fin", jobId: "record-materialize-rds_real_fin" });
  });

  it("② R6 确定性：同输入字节级同结果", () => {
    const a = JSON.stringify(materializeRecords({ ...base, rows, primaryKeyColumn: "finId" }));
    const b = JSON.stringify(materializeRecords({ ...base, rows, primaryKeyColumn: "finId" }));
    expect(a).toBe(b);
  });

  it("③ number 列含非数值 → 置 null + 诚实告警（不静默落脏）", () => {
    const dirty = [{ finId: "X", line: "收入", budget: "N/A", rolling: "1,200" }];
    const { objects, warnings } = materializeRecords({ ...base, rows: dirty, primaryKeyColumn: "finId" });
    expect(objects[0]!.props.budget).toBeNull();
    expect(objects[0]!.props.rolling).toBe(1200); // "1,200" → 1200（去千分位）
    expect(warnings.some((w) => w.includes("budget"))).toBe(true);
  });

  it("④ 主键空行跳过 + 告警（不落无主键对象）", () => {
    const withEmpty = [{ finId: "", line: "收入", budget: "1" }, { finId: "OK", line: "毛利", budget: "2" }];
    const { objects, warnings } = materializeRecords({ ...base, rows: withEmpty, primaryKeyColumn: "finId" });
    expect(objects).toHaveLength(1);
    expect(objects[0]!.id).toBe("obj_financeplan_OK");
    expect(warnings.some((w) => w.includes("主键"))).toBe(true);
  });

  it("⑤ 主键列缺省 → 自动取映射到主键属性的列", () => {
    const { primaryKey } = materializeRecords({ ...base, rows });
    expect(primaryKey).toBe("finId"); // columnMapping 里映射到 isPrimaryKey 属性的列
  });
});

describe("record-materialize · HTTP 真链路（灌真颗粒→驾驶舱读真值）", () => {
  // 上传真财务 CSV → file_upload 连接 → RawDataset。返回其 rawDatasetId。
  async function uploadRealFinance(t: Awaited<ReturnType<typeof makeApp>>, csv = FINANCE_CSV): Promise<string> {
    const up = await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "ceo_finance.csv", contentBase64: b64(csv) } });
    expect(up.statusCode).toBe(201);
    const connId = (up.json() as { connection: { id: string } }).connection.id;
    const list = await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN });
    return (list.json() as { id: string }[])[0]!.id;
  }
  // materialize FinancePlan(replace) → finance_pnl 输出。
  async function materializeAndPnl(t: Awaited<ReturnType<typeof makeApp>>, csv: string): Promise<{ pnl: { subject: string; budget: number }[]; gmRow: { budgetPct: number } }> {
    const rdsId = await uploadRealFinance(t, csv);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/records/materialize", headers: ADMIN, payload: { rawDatasetId: rdsId, targetType: "FinancePlan", columnMapping: { finId: "finId", line: "line", budget: "budget", rolling: "rolling" }, primaryKeyColumn: "finId", replaceExisting: true } });
    expect(res.statusCode).toBe(200);
    const pnl = await t.app.inject({ method: "POST", url: "/a/v1/solvers/finance_pnl/invoke", headers: ADMIN, payload: { args: {} } });
    expect(pnl.statusCode).toBe(200);
    return (pnl.json() as { data: { pnl: { subject: string; budget: number }[]; gmRow: { budgetPct: number } } }).data;
  }

  it("⑤ 真链路：upload 真财务 CSV → materialize FinancePlan(replace) → 对象真化 + finance_pnl 读真值", async () => {
    const t = await makeApp();
    await seedBattery(t); // 发布 FinancePlan 类型 + 合成种子对象（基线）

    // finance_pnl 合成基线（真化前）——收入行预算取自合成种子。
    const rdsId = await uploadRealFinance(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/records/materialize",
      headers: ADMIN,
      payload: { rawDatasetId: rdsId, targetType: "FinancePlan", columnMapping: { finId: "finId", line: "line", budget: "budget", rolling: "rolling" }, primaryKeyColumn: "finId", replaceExisting: true },
    });
    expect(res.statusCode).toBe(200);
    const out = RecordMaterializeResultSchema.parse(res.json());
    expect(out.materializedCount).toBe(3); // 3 真行 → 3 真对象（颗粒不聚合）
    expect(out.worldSource).toBe("imported");
    expect(out.provenanceReal).toBe(true);
    expect(out.replacedCount).toBeGreaterThan(0); // 清掉了合成种子

    // 对象真化：origin MATERIALIZED·datasetId = 真上传集（非合成源）·props 是真 CSV 值。
    const objs = await t.repos.objects.listByType("demo", "FinancePlan");
    expect(objs).toHaveLength(3);
    const rev = objs.find((o) => o.props.finId === "FIN-REV")!;
    expect(rev.props.budget).toBe(50000); // 真值（逐值·非合成 hash）
    expect(rev.origin).toMatchObject({ type: "MATERIALIZED", datasetId: rdsId });

    // 求解器读真值：finance_pnl 逐值反映真 CSV（收入预算 50000）+ **聚合值求解器算出**（毛利率 = 毛利÷收入 = 20000/50000 = 40.0）。
    const pnl = await t.app.inject({ method: "POST", url: "/a/v1/solvers/finance_pnl/invoke", headers: ADMIN, payload: { args: {} } });
    expect(pnl.statusCode).toBe(200);
    const pnlOut = (pnl.json() as { data: { pnl: { subject: string; budget: number }[]; gmRow: { budgetPct: number } } }).data;
    expect(pnlOut.pnl.find((r) => r.subject === "收入")!.budget).toBe(50000); // 逐值真
    expect(pnlOut.gmRow.budgetPct).toBe(40); // 聚合值 = 求解器从真颗粒 Σ/ratio 算出（非入库预聚合）
  });

  it("⑧ 铁律 · 改颗粒→聚合必变：换一条真源毛利行 → finance_pnl 毛利率随之变（只生成颗粒·聚合求解器算）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 颗粒 A：毛利 budget 20000 / 收入 50000 → 毛利率 40.0
    const a = await materializeAndPnl(t, FINANCE_CSV);
    expect(a.gmRow.budgetPct).toBe(40);
    // 颗粒 B：只改一条真源颗粒（毛利 budget 20000→10000·收入不变）→ 聚合毛利率必变 40→20（改颗粒→聚合必变）。
    const csvB = `finId,line,budget,rolling
FIN-REV,收入,50000,52000
FIN-COGS,销售成本,30000,31000
FIN-GM,毛利,10000,21000
`;
    const b = await materializeAndPnl(t, csvB);
    expect(b.gmRow.budgetPct).toBe(20); // 20000/50000=40 → 10000/50000=20
    expect(b.gmRow.budgetPct).not.toBe(a.gmRow.budgetPct); // 聚合确随颗粒变（非写死/非入库预聚合）
  });

  it("⑥ KILL-MOCK-RED：合成源数据集 → materialize 硬拒（合成不冒充真值）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 合成 FinancePlan 种子来自合成源连接的数据集——取其 rawDatasetId。
    const synthFin = (await t.repos.objects.listByType("demo", "FinancePlan"))[0]!;
    const synthDsId = (synthFin.origin as { datasetId?: string; rawDatasetId?: string }).datasetId ?? (synthFin.origin as { rawDatasetId?: string }).rawDatasetId;
    expect(synthDsId).toBeTruthy();
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/records/materialize",
      headers: ADMIN,
      payload: { rawDatasetId: synthDsId, targetType: "FinancePlan", columnMapping: { finId: "finId" }, primaryKeyColumn: "finId" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("合成");
  });

  it("⑦ dryRun 不落库 + 非 admin 403", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rdsId = await uploadRealFinance(t);
    const before = (await t.repos.objects.listByType("demo", "FinancePlan")).length;
    const dry = await t.app.inject({
      method: "POST",
      url: "/a/v1/records/materialize",
      headers: ADMIN,
      payload: { rawDatasetId: rdsId, targetType: "FinancePlan", columnMapping: { finId: "finId", budget: "budget" }, primaryKeyColumn: "finId", replaceExisting: true, dryRun: true },
    });
    expect(dry.statusCode).toBe(200);
    expect((dry.json() as { dryRun: boolean; materializedCount: number }).materializedCount).toBe(3);
    expect((await t.repos.objects.listByType("demo", "FinancePlan")).length).toBe(before); // 未动库

    const forbidden = await t.app.inject({
      method: "POST",
      url: "/a/v1/records/materialize",
      headers: PLANNER,
      payload: { rawDatasetId: rdsId, targetType: "FinancePlan", columnMapping: { finId: "finId" }, primaryKeyColumn: "finId" },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
