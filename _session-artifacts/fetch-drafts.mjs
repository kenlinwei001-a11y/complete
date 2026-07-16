const A = "http://127.0.0.1:4001";
async function j(path, opts) { const r = await fetch(A + path, opts); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b }; }
const login = await j("/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const H = { authorization: "Bearer " + login.b.accessToken, "content-type": "application/json" };
for (const [label, id] of [["AI/Kimi suggest", "draft_n7vchhs3cbp513ed"], ["确定性 derive", "draft_xdza9c6rqgwj90z4"]]) {
  const g = await j("/a/v1/modeling/drafts/" + id, { headers: H });
  const d = g.b;
  const types = d.objectTypes || d.types || [];
  console.log(`\n=== ${label} (${id}) status=${g.status} ===`);
  console.log("  draft.status:", d.status, "| 对象类型数:", types.length, "| 关系/边数:", (d.links || d.relationships || d.edges || []).length);
  for (const t of types.slice(0, 12)) {
    console.log(`   · ${t.typeKey || t.key} "${t.displayName || ""}" — ${(t.properties || []).length}属性 [${(t.properties || []).slice(0, 8).map((p) => p.propKey || p.key).join(",")}]${t.domain ? " 域=" + t.domain : ""}`);
  }
}
