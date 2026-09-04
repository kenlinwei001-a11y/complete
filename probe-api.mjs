import fs from "node:fs";
const H = { "X-Debug-User": "demo:u1:admin" };
const RE = /(apps|packages|scripts|deploy|docs)\/[A-Za-z0-9@._\-\/]*\.(ts|tsx|mjs|js|json|sql|sh|md)(:\d+(-\d+)?)?|[A-Za-z0-9._-]+\.(ts|tsx|mjs)\:\d+/g;
const j = JSON.parse(fs.readFileSync("/tmp/rui4/pd.json", "utf8"));
const procs = (j.definitions || []).map((p) => p.key || p.processKey).filter(Boolean);
console.log("PROCS", procs.length, procs.slice(0, 60).join(" "));
let total = 0;
for (const k of procs) {
  const r = await fetch(`http://127.0.0.1:4401/a/v1/process-definitions/${k}/step-template`, { headers: H });
  const t = await r.text();
  const m = t.match(RE) || [];
  if (m.length) { total += m.length; console.log(k, m.length, [...new Set(m)].slice(0, 6).join(" | ")); }
}
console.log("API_TOTAL", total);
