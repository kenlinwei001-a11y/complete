const A = "http://127.0.0.1:4001";
async function j(path, opts) { const r = await fetch(A + path, opts); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b }; }
const login = await j("/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const H = { authorization: "Bearer " + login.b.accessToken, "content-type": "application/json" };
const id = process.argv[2] || "draft_xdza9c6rqgwj90z4";
const g = await j("/a/v1/modeling/drafts/" + id, { headers: H });
console.log("status", g.status, "\ntop-level keys:", Object.keys(g.b));
console.log("\nfull JSON (4k):\n", JSON.stringify(g.b, null, 1).slice(0, 4000));
