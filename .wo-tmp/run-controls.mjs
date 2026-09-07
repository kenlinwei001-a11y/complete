import { createLink, edgesVia } from "./probe.mjs";

const PORT = process.argv[2] ?? "4411";
const TAG = process.argv[3] ?? "HEAD";

// 六条桶④边的**声明式等价物**（用 zz_ce_ 前缀另建，绝不覆盖出厂那六条 key）。
const CASES = [
  {
    name: "plantarget_ownedby (A1·条件常量)",
    key: "zz_ce_pto",
    payload: { key: "zz_ce_pto", fromTypeKey: "PlanTarget", toTypeKey: "Principal", cardinality: "N:1", viaKeyExpr: 'IF(this.level == "month", "prin-plan", "prin-coo")' },
    root: "PlanTarget",
  },
  {
    name: "model_in_segment (A1·枚举映射)",
    key: "zz_ce_mis",
    payload: { key: "zz_ce_mis", fromTypeKey: "Model", toTypeKey: "Segment", cardinality: "N:N", viaKeyExpr: 'IF(this.pos == "储能", "ess", "pas")' },
    root: "Model",
  },
  {
    name: "line_belongs_to_workshop (A2·补列)",
    key: "zz_ce_lbw",
    payload: { key: "zz_ce_lbw", fromTypeKey: "Workshop", toTypeKey: "Line", cardinality: "1:N", viaProperty: "workshopId", viaSide: "to" },
    root: "Workshop",
  },
  {
    name: "order_to_plantarget (A2·补列 + anchor 谓词)",
    key: "zz_ce_otp",
    payload: { key: "zz_ce_otp", fromTypeKey: "Order", toTypeKey: "PlanTarget", cardinality: "N:N", viaProperty: "dueMonth", anchorProperty: "period", viaWhereTo: "PlanTarget.level == 'month'" },
    root: "Order",
  },
  {
    name: "base_data_health (B·叉积 13×9)",
    key: "zz_ce_bdh",
    payload: { key: "zz_ce_bdh", fromTypeKey: "Base", toTypeKey: "DataSourceHealth", cardinality: "N:N", viaCross: { maxEdges: 10000 } },
    root: "Base",
  },
  {
    name: "scenario_to_capex (B·叉积 2×3 + fromWhere)",
    key: "zz_ce_s2c",
    payload: { key: "zz_ce_s2c", fromTypeKey: "AnnualScenario", toTypeKey: "CapexProject", cardinality: "N:N", viaCross: { fromWhere: "AnnualScenario.key != 'conservative'", maxEdges: 10000 } },
    root: "AnnualScenario",
  },
];

console.log(`\n════ ${TAG} (port ${PORT}) ════`);
for (const c of CASES) {
  const r = await createLink(c.payload);
  let line = `\n■ ${c.name}\n  key=${c.key}  POST=${r.status}`;
  if (r.status >= 300) {
    line += `\n  ⇒ 拒绝：${(r.json?.error?.message ?? JSON.stringify(r.json)).slice(0, 260)}`;
    console.log(line);
    continue;
  }
  line += `  materialized=${JSON.stringify(r.json.materialized)}`;
  const g = await edgesVia(`zzsl-${c.key}`, c.root, c.key);
  if (g.err) line += `\n  检索失败：${g.err}`;
  else line += `\n  检索边数=${g.edges.length}   端点前3对: ${g.edges.slice(0, 3).join(" | ") || "(空)"}`;
  console.log(line);
}

// 金丝雀：一条我确定「五种声明够用」的边（line_belongs_to_base，viaProperty:"baseId", viaSide:"to"）
// 必须在同一把尺子下连得出来。它不中 ⇒ 报「我的工具坏了」，上面任何 0 都不许当结论。
const canary = await createLink({ key: "zz_ce_canary_lbb", fromTypeKey: "Base", toTypeKey: "Line", cardinality: "1:N", viaProperty: "baseId", viaSide: "to" });
const cg = await edgesVia("zzsl-canary", "Base", "zz_ce_canary_lbb");
console.log(`\n🐤 金丝雀 line_belongs_to_base 同形声明：POST=${canary.status} materialized=${JSON.stringify(canary.json?.materialized)} 检索边数=${cg.edges?.length ?? cg.err}`);
