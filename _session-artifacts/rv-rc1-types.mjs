import fs from "node:fs";
const TOKEN = fs.readFileSync("/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/token.txt","utf8").trim();
const BASE = "http://127.0.0.1:4025";
const H = { "Authorization": `Bearer ${TOKEN}` };
const get = async (p) => { const r = await fetch(BASE+p,{headers:H}); const t=await r.text(); try{return JSON.parse(t)}catch{return t} };

// object types
const types = await get("/a/v1/ontology/types");
const typeList = Array.isArray(types) ? types : (types.items ?? types.types ?? []);
const typeKeys = new Set(typeList.map(t=>t.key));
console.log("=== total object types:", typeKeys.size);
console.log("Quote defined? ", typeKeys.has("Quote"));
console.log("Action defined?", typeKeys.has("Action"));
console.log("DemandSegment? ", typeKeys.has("DemandSegment"), " ScenarioTrigger?", typeKeys.has("ScenarioTrigger"), " DataSourceHealth?", typeKeys.has("DataSourceHealth"));

// slices -> covered root type keys
const slices = await get("/a/v1/slices");
const sliceList = Array.isArray(slices) ? slices : (slices.items ?? []);
const covered = new Set();
for (const s of sliceList) {
  const root = s.spec?.root?.typeKey ?? s.root?.typeKey ?? s.rootTypeKey;
  if (root) covered.add(root);
}
console.log("\n=== slices count:", sliceList.length, " distinct covered root types:", covered.size);
const uncovered = [...typeKeys].filter(k=>!covered.has(k)).sort();
console.log("=== UNCOVERED object types (no slice root):", uncovered.length);
console.log(JSON.stringify(uncovered));
