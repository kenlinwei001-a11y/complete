// 量纲前置：每条 BOMDetail 的计量单位是否等于它所引物料自身声明的计量单位？
// 相等 ⇒ quantity × unitPrice 无歧义（本体自己断言了两者同 UOM），不需要我内联任何假设。
const BASE = "http://127.0.0.1:4071";
const H = { "X-Debug-User": "demo:admin:admin|planner|catalog_admin" };
const all = async (t) => {
  const o = []; let tot = Infinity;
  for (let p = 1; o.length < tot && p <= 100; p++) {
    const r = await fetch(`${BASE}/a/v1/objects?type=${t}&page=${p}&pageSize=200`, { headers: H });
    const j = await r.json(); tot = j.total; if (!j.items.length) break; o.push(...j.items);
  }
  return o;
};
const [bd, mat] = await Promise.all([all("BOMDetail"), all("Material")]);
const mu = new Map(mat.map((m) => [String(m.props.matId), String(m.props.unit)]));
let ok = 0; const bad = []; const missing = [];
for (const d of bd) {
  const m = mu.get(String(d.props.materialId));
  if (m === undefined) { missing.push(String(d.props.materialId)); continue; }
  if (m === String(d.props.unit)) ok++;
  else bad.push(`${d.props.bomDetailId}: BOMDetail.unit=${d.props.unit} vs Material(${d.props.materialId}).unit=${m}`);
}
console.log(`BOMDetail 共 ${bd.length} 条；单位一致 ${ok}；不一致 ${bad.length}；物料查不到 ${missing.length}`);
if (bad.length) console.log("不一致样例:\n  " + bad.slice(0, 10).join("\n  "));
if (missing.length) console.log("查不到的物料: " + [...new Set(missing)].join(","));
console.log(bad.length === 0 && missing.length === 0 ? ">>> 量纲前置成立：quantity × unitPrice 由本体自证同 UOM" : ">>> 量纲前置不成立");
