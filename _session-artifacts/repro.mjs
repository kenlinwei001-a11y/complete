// Simulate the exact ValidationPage runtime path against the REAL backend response.
const loginRes = await fetch("http://127.0.0.1:4001/a/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
});
const { accessToken } = await loginRes.json();

// This is exactly what fetchValidationRuns() does: api.a<ValidationRunView[]>(...) → res.json() as T (no unwrap).
const res = await fetch("http://127.0.0.1:4001/a/v1/validation/runs", {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const data = await res.json(); // raw body, TS cast is erased at runtime
console.log("typeof data:", typeof data, "| Array.isArray(data):", Array.isArray(data));
console.log("data keys:", Object.keys(data));

// ValidationPage.tsx line 67 + 110:
const runs = data ?? [];
console.log("runs === data (?? did not substitute):", runs === data);
try {
  runs.map((r) => r.id); // line 110
  console.log("runs.map SUCCEEDED (no crash)");
} catch (e) {
  console.log("CRASH at runs.map:", e.constructor.name + ":", e.message);
}
