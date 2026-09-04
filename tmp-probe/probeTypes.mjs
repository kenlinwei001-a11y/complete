const H = "demo:admin:admin|planner|catalog_admin";
const BASE = "http://127.0.0.1:4711";
for (const t of ["LongTermAgreement", "ChangeoverMatrix", "ProductLineCapability", "Contract"]) {
  const r = await fetch(`${BASE}/a/v1/objects?type=${t}&page=1&pageSize=3`, { headers: { "X-Debug-User": H } });
  const j = await r.json();
  console.log(`\n=== ${t} total=${j.total ?? "?"} ${j.error ? JSON.stringify(j.error).slice(0, 120) : ""}`);
  if (j.items?.[0]) console.log(JSON.stringify(j.items[0].props));
}
