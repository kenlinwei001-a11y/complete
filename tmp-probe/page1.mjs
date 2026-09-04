const H = "demo:admin:admin|planner|catalog_admin";
const r = await fetch("http://127.0.0.1:4711/a/v1/objects?type=Order&q=", { headers: { "X-Debug-User": H } });
const j = await r.json();
console.log("items", j.items?.length, "total", j.total, "hasMore", j.hasMore, "page", j.page, "pageSize", j.pageSize);
const rev = (j.items ?? []).reduce((a, o) => a + Number(o.props.qty || 0) * Number(o.props.unitPrice || 0), 0);
console.log("page-1 pool 亿", (rev / 1e8).toFixed(2));
