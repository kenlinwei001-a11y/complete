const B = process.env.DC ?? "http://127.0.0.1:4801";
const H = { "X-Debug-User": "demo:admin:admin", "content-type": "application/json" };
const truth = async (t) => {
  const r = await fetch(`${B}/a/v1/objects/aggregate`, { method: "POST", headers: H, body: JSON.stringify({ typeKey: t, groupBy: [], metrics: [{ prop: "id", fn: "count" }] }) });
  const j = await r.json(); return Object.values(j.rows?.[0]?.metrics ?? { x: 0 })[0];
};
// 修前形态
const before = async (t, ps) => {
  const u = ps ? `&page=1&pageSize=${ps}` : "";
  const j = await (await fetch(`${B}/a/v1/objects?type=${t}&q=${u}`, { headers: H })).json();
  return j.items.length;
};
// 修后形态 = fetchAllObjects 的算法（按回显 hasMore 逐页翻）
const after = async (t) => {
  let n = 0, page = 1;
  for (; page <= 500; page++) {
    const j = await (await fetch(`${B}/a/v1/objects?type=${t}&q=&page=${page}&pageSize=500`, { headers: H })).json();
    n += j.items.length; if (!j.hasMore) break;
  }
  return n;
};
const cases = JSON.parse(process.argv[2]);
const rows = [];
for (const [site, t, ps] of cases) rows.push({ 调用点: site, 对象类型: t, 真实条数: await truth(t), 修前: await before(t, ps), 修后: await after(t) });
console.table(rows);
console.log("全部一致:", rows.every((r) => r.修后 === r.真实条数));
