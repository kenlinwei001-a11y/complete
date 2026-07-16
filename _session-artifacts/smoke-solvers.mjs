const A = "http://127.0.0.1:4001";
const lg = await fetch(A + "/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const TOK = (await lg.json()).accessToken;
const H = { authorization: "Bearer " + TOK, "content-type": "application/json" };
async function j(path, opts) { try { const r = await fetch(A + path, opts); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b }; } catch (e) { return { status: 0, b: String(e).slice(0, 60) }; } }

const reg = await j("/a/v1/solvers/registry", { headers: H });
const keys = (Array.isArray(reg.b) ? reg.b : (reg.b.items || reg.b.solvers || reg.b.registry || [])).map((s) => s.key || s.solverKey || s).filter(Boolean);
console.log("求解器注册表数:", keys.length);

const bug = [], argerr = [], ok = [];
for (const k of keys) {
  const r = await j(`/a/v1/solvers/${k}/invoke`, { method: "POST", headers: H, body: JSON.stringify({ args: {} }) });
  if (r.status >= 500 || r.status === 0) bug.push(`${k} → ${r.status} ${JSON.stringify(r.b).slice(0, 120)}`);
  else if (r.status >= 400) argerr.push(`${k}(${r.status}: ${(r.b?.error?.message || JSON.stringify(r.b)).slice(0, 50)})`);
  else ok.push(k);
}
console.log(`\n✅ invoke OK(2xx): ${ok.length} | 🟡 4xx(需特定args·非崩): ${argerr.length} | 🔴 5xx(真BUG): ${bug.length}`);
console.log("\n🔴 5xx 求解器(真 BUG):");
bug.length ? bug.forEach(b => console.log("  " + b)) : console.log("  (无)");
console.log("\n🟡 4xx 求解器(需特定 args·多为预期):");
console.log("  " + argerr.join(" · "));
console.log("\n✅ 空args直接能跑的:", ok.join(", "));
