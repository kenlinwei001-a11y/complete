const A = "http://127.0.0.1:4003";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(p, o) { const r = await fetch(A + p, o); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b }; }
const lg = await j("/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const H = { authorization: "Bearer " + lg.b.accessToken, "content-type": "application/json" };
const bind = await j("/a/v1/llm-bindings", { headers: H });
const ps = (bind.b.bindings || []).map((b) => b.purpose).sort();
console.log("绑定用途:", ps.join(","));
console.log("含 extraction+template_gen:", ps.includes("extraction") && ps.includes("template_gen") ? "✓" : "✗");
// A2: 上传规则文档 → Kimi 抽取
const doc = "产能预警规则：若某生产基地的产能利用率连续3天超过95%，则触发产能预警，并通知该基地经理。\n订单优先级规则：订单交付延迟超过2天的，其优先级自动提升为高。\n库存规则：原材料库存低于安全库存线时，自动生成补货建议。";
const up = await j("/a/v1/rule-docs", { method: "POST", headers: H, body: JSON.stringify({ filename: "test-rules.txt", contentBase64: Buffer.from(doc, "utf8").toString("base64") }) });
console.log("\n上传规则文档:", up.status, "docId=" + (up.b.id || up.b.docId || "?"), "status=" + (up.b.status ?? "?"), "candidateCount=" + (up.b.candidateCount ?? "?"));
const docId = up.b.id || up.b.docId;
// 看分段抽取是否走 Kimi(非 SDK 鉴权串)
let segs;
for (let i = 0; i < 24; i++) { await sleep(3000); const s = await j("/a/v1/rule-docs/" + docId + "/segments", { headers: H }); segs = Array.isArray(s.b) ? s.b : (s.b.segments || s.b.items || []); if (segs.length && segs.every((x) => x.status !== "PROCESSING" && x.status !== "PENDING")) break; }
console.log("\n分段抽取结果 (" + (segs?.length || 0) + " 段):");
let sdkErr = 0, ok = 0;
for (const sg of (segs || [])) {
  const err = String(sg.error || "");
  const isSdk = /Could not resolve authentication|apiKey, authToken/.test(err);
  if (isSdk) sdkErr++; else if (sg.status === "DONE" || sg.status === "COMPLETED" || (sg.candidates && sg.candidates.length)) ok++;
  console.log(`  段[${sg.heading || sg.id}] status=${sg.status} ${sg.candidates ? "候选" + sg.candidates.length : ""} ${isSdk ? "⚠️SDK鉴权串(P0未修)" : err ? "err:" + err.slice(0, 50) : ""}`);
}
console.log("\n结论: SDK 鉴权串段数=" + sdkErr, "| 成功抽取段数=" + ok, sdkErr === 0 && ok > 0 ? "→ ✓ A2 经 Kimi 真抽取(P0 binding 已修)" : sdkErr > 0 ? "→ ✗ 仍裸 SDK 串" : "→ ? 需查");
