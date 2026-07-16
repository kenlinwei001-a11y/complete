const A = "http://127.0.0.1:4001";
async function j(path, opts) { const r = await fetch(A + path, opts); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b }; }
const login = await j("/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const H = { authorization: "Bearer " + login.b.accessToken, "content-type": "application/json" };
const NEW = "BaseFdeTest";

// 1) derive
const der = await j("/a/v1/modeling/derive", { method: "POST", headers: H, body: JSON.stringify({ rawDatasetIds: ["rds_gn5a23r3ahk32p59"] }) });
const id = der.b.draftId;
console.log("1) derive:", der.status, "draft", id);

// 2) patch: renameType Base→BaseFdeTest, setDomain factory, setPrimaryKey baseId
async function patch(op) { const r = await j("/a/v1/modeling/drafts/" + id, { method: "PATCH", headers: H, body: JSON.stringify({ operations: [op] }) }); return r.status + (r.status >= 400 ? " " + JSON.stringify(r.b).slice(0, 120) : ""); }
console.log("2a) renameType Base→" + NEW + ":", await patch({ op: "renameType", typeKey: "Base", newTypeKey: NEW, newDisplayName: "基地FDE测试" }));
console.log("2b) setDomain factory:", await patch({ op: "setDomain", typeKey: NEW, domain: "factory" }));
console.log("2c) setPrimaryKey baseId:", await patch({ op: "setPrimaryKey", typeKey: NEW, propKey: "baseId" }));

// 3) publish
const pub = await j("/a/v1/modeling/drafts/" + id + "/publish", { method: "POST", headers: H, body: JSON.stringify({ requireFullCoverage: false }) });
console.log("3) publish:", pub.status, "ok=" + (pub.b.ok ?? "?"), pub.b.errors ? "errors:" + JSON.stringify(pub.b.errors).slice(0, 200) : "");

// 4) materialize
const mat = await j("/a/v1/modeling/drafts/" + id + "/materialize", { method: "POST", headers: H, body: "{}" });
console.log("4) materialize:", mat.status, JSON.stringify(mat.b).slice(0, 160));

// 5) verify: 新类型在对象类型库 + 物化数
const stats = await j("/a/v1/ontology/object-types/stats", { headers: H });
const arr = Array.isArray(stats.b) ? stats.b : (stats.b.items || stats.b.types || stats.b.objectTypes || []);
const mine = arr.find((t) => (t.key || t.typeKey) === NEW || (t.displayName || "").includes("FDE"));
console.log("5) 验证新类型在对象库:", mine ? `✓ ${mine.key || mine.typeKey} · 物化数 ${mine.count ?? mine.materialized ?? "?"} · 域 ${mine.domain}` : "✗ 未找到（共" + arr.length + "类型）");
