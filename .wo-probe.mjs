const H = { "X-Debug-User": "demo:admin:admin|planner|catalog_admin" };
const B = "http://127.0.0.1:4801";
const get = async (u) => JSON.parse(await (await fetch(B + u, { headers: H })).text());
const listAll = async (type) => {
  const out = [];
  let page = 1;
  for (;;) {
    const j = await get(`/a/v1/objects?type=${type}&page=${page}&pageSize=200`);
    out.push(...j.data);
    if (!j.hasMore) break;
    page++;
  }
  return out;
};
const tally = {};
const samples = {};
const scan = async (type) => {
  const rows = await listAll(type);
  console.log(`  [scan] ${type} n=${rows.length}`);
  for (const o of rows) {
    const n = await get(`/a/v1/objects/${encodeURIComponent(o.id)}/neighbors`);
    for (const g of n.groups ?? []) {
      if (g.direction !== "out") continue;
      tally[g.linkKey] = (tally[g.linkKey] ?? 0) + g.total;
      (samples[g.linkKey] ??= []).push(`${o.id} -> ${g.items[0]?.id}`);
    }
  }
};
for (const t of ["Base", "Warehouse", "CustomerLocation", "Operation"]) await scan(t);
console.log("=== 出边按 linkKey 汇总 ===");
for (const k of Object.keys(tally).sort()) console.log(`  ${k} = ${tally[k]}`);
console.log("=== 本单四条边的端点前 3 对 ===");
for (const k of ["base_located_in", "warehouse_located_in", "custloc_located_in", "operation_depends_on"]) {
  console.log(`  ${k}:`);
  for (const s of (samples[k] ?? ["(零条)"]).slice(0, 3)) console.log(`    ${s}`);
}
