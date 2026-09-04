// 项7 前置：走真实管线造出隔离行（上传含重复主键的 CSV → derive → publish → materialize）
// 这不是塞假数据：走的正是产品自己的 A1→A3 路径，坏行由产品自己判定并隔离。
import fs from "node:fs";
const DC = process.env.DC ?? "http://127.0.0.1:4051";
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300), _status: r.status }; } };
const login = await j(await fetch(`${DC}/a/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) }));
const TOK = login.accessToken ?? login.token;
const H = { Authorization: `Bearer ${TOK}`, "content-type": "application/json" };

// 主键 sku 重复 + 一行缺主键 ⇒ 触发 DUP_KEY / SCHEMA_MISMATCH
const csv = [
  "sku,name,qty",
  "A-1,甲,10",
  "A-2,乙,20",
  "A-1,丙,30",     // 重复主键
  "A-1,丁,40",     // 再重复
  ",戊,50",        // 缺主键
  "A-2,己,60",     // 重复主键
].join("\n");

const up = await j(await fetch(`${DC}/a/v1/uploads`, { method: "POST", headers: H, body: JSON.stringify({ filename: "e2e_probe.csv", contentBase64: Buffer.from(csv).toString("base64") }) }));
console.log("upload:", JSON.stringify(up).slice(0, 300));
const ds = await j(await fetch(`${DC}/a/v1/raw-datasets?connId=${up.connId}`, { headers: H }));
const dsList = ds.items ?? ds.data ?? ds;
const dsId = (Array.isArray(dsList) ? dsList[0] : null)?.id;
console.log("dataset:", dsId, JSON.stringify(dsList).slice(0, 200));

const drv = await j(await fetch(`${DC}/a/v1/modeling/derive`, { method: "POST", headers: H, body: JSON.stringify({ rawDatasetIds: [dsId] }) }));
console.log("derive:", JSON.stringify(drv).slice(0, 300));
const draftId = drv.draftId;

const pub = await j(await fetch(`${DC}/a/v1/modeling/drafts/${draftId}/publish`, { method: "POST", headers: H, body: JSON.stringify({}) }));
console.log("publish:", JSON.stringify(pub).slice(0, 300));

const mat = await j(await fetch(`${DC}/a/v1/modeling/drafts/${draftId}/materialize`, { method: "POST", headers: H, body: JSON.stringify({}) }));
console.log("materialize:", JSON.stringify(mat).slice(0, 300));

const q = await j(await fetch(`${DC}/a/v1/quarantine`, { headers: H }));
console.log("quarantine total:", q.total, "byReason:", JSON.stringify(q.byReason));
console.log("first item:", JSON.stringify(q.items?.[0] ?? null).slice(0, 300));
fs.writeFileSync("docs/evidence/e2e-accept/item7-seed.json", JSON.stringify({ upload: up, dsId, derive: drv, publish: pub, materialize: mat, quarantine: { total: q.total, byReason: q.byReason, sample: q.items?.slice(0, 3) } }, null, 2));

// ── 续：publish 被「未归域」挡住 ⇒ 按产品自己的要求先归域，再 publish / materialize
if (!pub.ok) {
  const doms = await j(await fetch(`${DC}/a/v1/ontology/domains`, { headers: H }));
  const domList = doms.items ?? doms.domains ?? doms;
  const first = Array.isArray(domList) ? domList[0] : null;
  const domKey = first?.key ?? first?.id ?? "product";
  console.log("domains:", JSON.stringify(domList).slice(0, 250), "→ 选", domKey);
  const patch = await j(await fetch(`${DC}/a/v1/modeling/drafts/${draftId}`, {
    method: "PATCH", headers: H,
    body: JSON.stringify({ operations: [{ op: "setDomain", typeKey: "E2eProbe", domain: domKey }, { op: "setPrimaryKey", typeKey: "E2eProbe", propKey: "sku" }] }),
  }));
  console.log("patch:", JSON.stringify(patch).slice(0, 200));
  const pub2 = await j(await fetch(`${DC}/a/v1/modeling/drafts/${draftId}/publish`, { method: "POST", headers: H, body: JSON.stringify({}) }));
  console.log("publish2:", JSON.stringify(pub2).slice(0, 300));
  const mat2 = await j(await fetch(`${DC}/a/v1/modeling/drafts/${draftId}/materialize`, { method: "POST", headers: H, body: JSON.stringify({}) }));
  console.log("materialize2:", JSON.stringify(mat2).slice(0, 300));
  const q2 = await j(await fetch(`${DC}/a/v1/quarantine`, { headers: H }));
  console.log("quarantine2 total:", q2.total, "byReason:", JSON.stringify(q2.byReason));
  console.log("sample:", JSON.stringify(q2.items?.[0] ?? null).slice(0, 400));
  fs.writeFileSync("docs/evidence/e2e-accept/item7-seed2.json", JSON.stringify({ domKey, patch, pub2, mat2, quarantine: { total: q2.total, byReason: q2.byReason, sample: q2.items?.slice(0, 3) } }, null, 2));
}
