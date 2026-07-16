const A = "http://127.0.0.1:4001";
async function j(path, opts) { const r = await fetch(A + path, opts); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b }; }
const login = await j("/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const H = { authorization: "Bearer " + login.b.accessToken, "content-type": "application/json" };
for (const [label, id] of [["AI/Kimi suggest", "draft_n7vchhs3cbp513ed"], ["确定性 derive", "draft_xdza9c6rqgwj90z4"]]) {
  const g = await j("/a/v1/modeling/drafts/" + id, { headers: H });
  const types = g.b.suggestion?.objectTypes || [];
  const fk = g.b.fkCandidates || [];
  const totalProps = types.reduce((s, t) => s + (t.properties || []).length, 0);
  const refs = types.reduce((s, t) => s + (t.properties || []).filter((p) => p.dataType === "ref" || p.refToTypeKey).length, 0);
  const domained = types.filter((t) => t.domain && t.domain !== "unassigned").length;
  console.log(`\n=== ${label} (${id}) ===`);
  console.log(`  对象类型: ${types.length} | 总属性: ${totalProps} | ref关系属性: ${refs} | FK候选: ${fk.length} | 已归域: ${domained}/${types.length}`);
  for (const t of types) {
    const pk = (t.properties || []).find((p) => p.isPrimaryKey);
    console.log(`   · ${t.typeKey} "${t.displayName}" 域=${t.domain} — ${(t.properties || []).length}属性 PK=${pk?.propKey || "?"} conf=${t.confidence ?? "?"}`);
  }
}
