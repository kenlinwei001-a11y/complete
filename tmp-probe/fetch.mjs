const H = "demo:admin:admin|planner|catalog_admin";
const BASE = "http://127.0.0.1:4711";
export async function all(type) {
  let page = 1, out = [];
  for (;;) {
    const r = await fetch(`${BASE}/a/v1/objects?type=${type}&page=${page}&pageSize=500`, { headers: { "X-Debug-User": H } });
    const j = await r.json();
    if (j.error) { console.log("ERR", type, JSON.stringify(j.error)); return out; }
    out = out.concat(j.items ?? []);
    if (!j.hasMore) break;
    page++;
  }
  return out;
}
export { H, BASE };

if (process.argv[2] === "run") {
  for (const t of ["Order", "OrderLine", "Base", "Model"]) {
    const xs = await all(t);
    console.log(`\n=== ${t}  n=${xs.length}`);
    if (xs[0]) console.log("sample:", JSON.stringify(xs[0].props));
    const rev = xs.reduce((a, o) => a + Number(o.props.qty || 0) * Number(o.props.unitPrice || 0), 0);
    const qty = xs.reduce((a, o) => a + Number(o.props.qty || 0), 0);
    if (rev) console.log(`Σ qty×unitPrice = ${rev.toFixed(0)} 元 = ${(rev / 1e8).toFixed(2)} 亿`);
    if (qty) console.log(`Σ qty = ${qty}`);
  }
}
