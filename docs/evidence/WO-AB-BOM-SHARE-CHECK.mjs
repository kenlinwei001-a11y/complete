const B = "http://127.0.0.1:4052", DU = "demo:admin:admin|planner|catalog_admin";
const get = async (p) => (await (await fetch(B + p, { headers: { "x-debug-user": DU } })).json());
const heads = (await get("/a/v1/objects?type=BOMHeader&pageSize=600")).items || [];
const dets  = (await get("/a/v1/objects?type=BOMDetail&pageSize=2000")).items || [];
const mats  = (await get("/a/v1/objects?type=Material&pageSize=600")).items || [];
const price = {}; for (const m of mats) price[m.props.matId] = Number(m.props.unitPrice ?? 0);
const h = heads.find((x) => String(x.props.modelId) === "4680-NCM");
const rows = dets.filter((d) => String(d.props.bomId) === h.props.bomId);
console.log("明细行（物料 / quantity / lossRate / 单价）:");
for (const d of rows) console.log(`  ${String(d.props.materialId).padEnd(14)} q=${d.props.quantity} lr=${d.props.lossRate} up=${price[d.props.materialId]}`);

for (const [tag, f] of [["含损耗 q(1+lr)up", (d)=>Number(d.props.quantity)*(1+Number(d.props.lossRate||0))*price[d.props.materialId]],
                        ["不含损耗 q·up",  (d)=>Number(d.props.quantity)*price[d.props.materialId]],
                        ["只有损耗部分 q·lr·up",(d)=>Number(d.props.quantity)*Number(d.props.lossRate||0)*price[d.props.materialId]]]) {
  const tot = rows.reduce((s,d)=>s+f(d),0);
  const p = f(rows.find(d=>d.props.materialId==="pos_ncm"))/tot;
  console.log(`${tag.padEnd(24)} Σ=${tot.toFixed(2).padStart(10)}  pos_ncm 占比 = ${p.toFixed(6)}  ${Math.abs(p-0.295455)<1e-4?"✅ 命中":"（差 "+(p-0.295455).toFixed(6)+"）"}`);
}
console.log("\n承诺增益 = 0.295455");
