const H = { "X-Debug-User": "demo:usr_demo_admin:admin", "Content-Type": "application/json" };
const B = "http://127.0.0.1:4001/a/v1";
const j = async (p) => { const r = await fetch(B+p,{headers:H}); if(!r.ok) throw new Error(p+" "+r.status); return r.json(); };
const types = await j("/ontology/object-types");
let withBindings=0, withDerived=0, withDomain=0;
const sample=[];
for(const t of types){
  const sb=(t.sourceBindings??[]); if(sb.length) withBindings++;
  if((t.derivedProperties??[]).length) withDerived++;
  if(t.domain && t.domain!=="unassigned") withDomain++;
  if(["Base","Order","Model","Metric"].includes(t.key)) sample.push({key:t.key, displayName:t.displayName, domain:t.domain, sourceBindings:sb, derived:(t.derivedProperties??[]).map(d=>d.propKey)});
}
console.log("types="+types.length+" withSourceBindings="+withBindings+" withDerivedProps="+withDerived+" withRealDomain="+withDomain);
for(const s of sample) console.log("\n"+s.key+" ['"+s.displayName+"' domain="+s.domain+"]\n  sourceBindings="+JSON.stringify(s.sourceBindings)+"\n  derived="+JSON.stringify(s.derived));
// raw-datasets coverage: how many show as modeled
const rds = await j("/raw-datasets");
const dsList = Array.isArray(rds)?rds:(rds.items??[]);
console.log("\nrawDatasets="+dsList.length);
