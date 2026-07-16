const A = "http://127.0.0.1:4001";
async function j(path, opts) { const r = await fetch(A + path, opts); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b }; }
const login = await j("/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const TOK = login.b.accessToken;
const H = { authorization: "Bearer " + TOK, "content-type": "application/json" };

// 1) 确定性 derive 一个新草案(Base)
const der = await j("/a/v1/modeling/derive", { method: "POST", headers: H, body: JSON.stringify({ rawDatasetIds: ["rds_gn5a23r3ahk32p59"] }) });
console.log("derive HTTP", der.status, "→ draftId", der.b.draftId, "status", der.b.status);
const draftId = der.b.draftId;

// 2) GET 该草案看真内容
let draft;
const single = await j("/a/v1/modeling/drafts/" + draftId, { headers: H });
if (single.status === 200) draft = single.b;
else { const list = await j("/a/v1/modeling/drafts", { headers: H }); const arr = Array.isArray(list.b) ? list.b : (list.b.items || list.b.drafts || []); draft = arr.find((x) => x.id === draftId) || arr[0]; console.log("(list fallback, drafts:", arr.length, ")"); }

const ots = draft?.suggestion?.objectTypes || draft?.objectTypes || [];
console.log("\n草案", draft?.id, "status", draft?.status, "| 对象类型数:", ots.length);
for (const t of ots.slice(0, 3)) {
  const props = t.properties || [];
  console.log(`  类型 ${t.typeKey || t.displayName} · 属性${props.length} · 派生${(t.derivedProperties || []).length} · 域 ${t.domain || "未归域"} · PK ${t.primaryKey || "?"}`);
  console.log(`    属性样例: ${props.slice(0, 6).map((p) => `${p.propKey || p.key}:${p.dataType || p.type || "?"}`).join(", ")}`);
}

// 3) 试发布该草案(端到端最后一步)
const pub = await j("/a/v1/modeling/drafts/" + draftId + "/publish", { method: "POST", headers: H, body: "{}" });
console.log("\n发布 publish HTTP", pub.status, pub.status >= 400 ? JSON.stringify(pub.b).slice(0, 200) : "→ " + JSON.stringify(pub.b).slice(0, 150));
