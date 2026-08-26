const H = { "X-Debug-User": "demo:usr_demo_admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4001/a/v1";
const j = async (p, opt) => { const r = await fetch(B+p, opt); if(!r.ok) throw new Error(p+" "+r.status+" "+await r.text()); return r.json(); };

const types = await j("/ontology/object-types", { headers: H });
const typeByKey = new Map(types.map(t => [t.key, t]));
const ds = await j("/raw-datasets", { headers: H });
const dsList = Array.isArray(ds) ? ds : (ds.items ?? ds.datasets ?? []);
const ids = dsList.map(d => d.id);
const dr = await j("/modeling/derive", { method:"POST", headers:H, body: JSON.stringify({ rawDatasetIds: ids }) });
const draft = await j("/modeling/drafts/"+dr.draftId, { headers: H });
const sug = draft.suggestion;
console.log("types:",types.length,"rawDatasets:",dsList.length,"derived objectTypes:",sug.objectTypes.length);

let diffs = [];
for (const ot of sug.objectTypes) {
  const cur = typeByKey.get(ot.typeKey);
  if (!cur) { diffs.push(`${ot.typeKey}: NO curated type (key mismatch)`); continue; }
  const d = [];
  if (ot.displayName !== cur.displayName) d.push(`name:'${ot.displayName}'vs'${cur.displayName}'`);
  if ((ot.domain||"unassigned") !== (cur.domain||"unassigned")) d.push(`domain:'${ot.domain}'vs'${cur.domain}'`);
  const curDeriv = (cur.derivedProperties||[]).map(p=>p.propKey).sort();
  if (curDeriv.length) d.push(`MISSING derivedProps:[${curDeriv.join(",")}]`);
  const curProps = new Map((cur.properties||[]).map(p=>[p.propKey,p]));
  const derProps = new Map(ot.properties.map(p=>[p.propKey,p]));
  const curPk = [...curProps.values()].filter(p=>p.isPrimaryKey).map(p=>p.propKey).sort();
  const derPk = [...derProps.values()].filter(p=>p.isPrimaryKey).map(p=>p.propKey).sort();
  if (JSON.stringify(curPk)!==JSON.stringify(derPk)) d.push(`PK:${JSON.stringify(derPk)}vs${JSON.stringify(curPk)}`);
  const onlyCur = [...curProps.keys()].filter(k=>!derProps.has(k));
  const onlyDer = [...derProps.keys()].filter(k=>!curProps.has(k));
  if (onlyCur.length) d.push(`onlyCurated:[${onlyCur.join(",")}]`);
  if (onlyDer.length) d.push(`onlyDerived:[${onlyDer.join(",")}]`);
  const dtMis=[]; for(const[k,cp]of curProps){const dp=derProps.get(k);if(dp&&dp.dataType!==cp.dataType)dtMis.push(`${k}:${dp.dataType}/${cp.dataType}`);}
  if(dtMis.length) d.push(`dtype:${dtMis.join(" ")}`);
  const rfMis=[]; for(const[k,cp]of curProps){const dp=derProps.get(k);const cr=cp.refToTypeKey||null,drr=dp?.refToTypeKey||null;if(dp&&cr!==drr)rfMis.push(`${k}:${drr}/${cr}`);}
  if(rfMis.length) d.push(`ref:${rfMis.join(" ")}`);
  if (d.length) diffs.push(`${ot.typeKey}: ${d.join(" | ")}`);
}
// summary of divergence categories
const catCount = { name:0, domain:0, derivedProps:0, PK:0, onlyCurated:0, onlyDerived:0, dtype:0, ref:0 };
for(const x of diffs){ for(const k of Object.keys(catCount)){ if(x.includes(k+":")||x.includes(k.replace("derivedProps","MISSING derivedProps"))||(k==="derivedProps"&&x.includes("MISSING derivedProps"))||(k==="onlyCurated"&&x.includes("onlyCurated:"))||(k==="onlyDerived"&&x.includes("onlyDerived:"))) catCount[k]++; } }
console.log("\n=== "+diffs.length+"/34 types differ ===");
for (const x of diffs) console.log(" •", x);
