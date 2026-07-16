const A = "http://127.0.0.1:4001", B = "http://127.0.0.1:4002";
async function j(path, opts) { const r = await fetch(A + path, opts); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, b, raw: t }; }
const login = await j("/a/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) });
const H = { authorization: "Bearer " + login.b.accessToken, "content-type": "application/json" };

// 找 Kimi provider
const list = await j("/a/v1/llm-providers", { headers: H });
const kimi = (Array.isArray(list.b) ? list.b : []).find((p) => /kimi|月之暗面/i.test(p.name));
console.log("Kimi provider:", kimi?.id, "模型:", kimi?.models.map((m) => m.modelId).join(","));

// 1) 追加绑定 modeling 用途 → Kimi（suggest 走 purpose=modeling）
const bind = await j("/a/v1/llm-bindings", { method: "PUT", headers: H, body: JSON.stringify({ bindings: [
  { purpose: "classifier", providerId: kimi.id, modelId: "kimi-k2.6" },
  { purpose: "agent", providerId: kimi.id, modelId: "kimi-k2.6" },
  { purpose: "comprehend", providerId: kimi.id, modelId: "kimi-k2.6" },
  { purpose: "modeling", providerId: kimi.id, modelId: "kimi-k2.6" },
] }) });
console.log("1) 绑定(+modeling):", bind.status, bind.status >= 400 ? JSON.stringify(bind.b).slice(0, 160) : "✓");

// 2) 取 raw-datasets
const rds = await j("/a/v1/raw-datasets", { headers: H });
const arr = Array.isArray(rds.b) ? rds.b : (rds.b.items || []);
const ids = arr.slice(0, 6).map((d) => d.id);
console.log("2) raw-datasets:", arr.length, "条，取前", ids.length, "个 →", arr.slice(0, 6).map((d) => d.name).join(", "));

// 3) AI 路径：/modeling/suggest（调 Kimi·purpose=modeling）
console.log("\n3) === AI 建议路径 /modeling/suggest（调 Kimi）===");
const t0 = Date.now();
const sug = await j("/a/v1/modeling/suggest", { method: "POST", headers: H, body: JSON.stringify({ rawDatasetIds: ids }) });
const sugMs = Date.now() - t0;
if (sug.status === 200) {
  const types = sug.b.objectTypes || sug.b.types || [];
  console.log("   ✓ 状态 200 | 耗时:", sugMs + "ms (真打 Kimi) | draftId:", sug.b.id, "| 建议对象类型数:", types.length);
  console.log("   类型样例:", types.slice(0, 6).map((t) => `${t.typeKey || t.key}(${(t.properties || []).length}属性)`).join(", "));
} else {
  console.log("   ✗ 状态", sug.status, "| 耗时:", sugMs + "ms |", JSON.stringify(sug.b).slice(0, 300));
}

// 4) 确定性路径：/modeling/derive（不调 LLM）
console.log("\n4) === 确定性路径 /modeling/derive（不调 LLM·全字段）===");
const t1 = Date.now();
const der = await j("/a/v1/modeling/derive", { method: "POST", headers: H, body: JSON.stringify({ rawDatasetIds: ids }) });
const derMs = Date.now() - t1;
if (der.status === 200) {
  const types = der.b.objectTypes || der.b.types || [];
  const totalProps = types.reduce((s, t) => s + (t.properties || []).length, 0);
  console.log("   ✓ 状态 200 | 耗时:", derMs + "ms (无 LLM·应极快) | draftId:", der.b.id, "| 对象类型数:", types.length, "| 总属性数:", totalProps);
  console.log("   类型样例:", types.slice(0, 6).map((t) => `${t.typeKey || t.key}(${(t.properties || []).length})`).join(", "));
} else {
  console.log("   ✗ 状态", der.status, "|", JSON.stringify(der.b).slice(0, 300));
}
console.log("\n=== 结论 ===");
console.log("AI 路径(Kimi):", sug.status === 200 ? `✓ 通 (${sugMs}ms)` : `✗ ${sug.status}`, "| 确定性路径:", der.status === 200 ? `✓ 通 (${derMs}ms)` : `✗ ${der.status}`);
