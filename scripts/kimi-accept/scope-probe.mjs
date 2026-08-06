import { writeFileSync } from "node:fs";
/**
 * 作用域探针：「COMPLETED 且零反问」**测不出**答非所问 —— 这脚本补的就是那一格。
 *
 * 来历（本轮取数实测）：10×5 矩阵 50/50 全绿、10/10 达标，但 #9「下周常州哪些订单缺料开不了工？」
 * 的答案与把「常州」换成「金华」**逐字节相同**。终态判据永远看不见这种病：任务确实 COMPLETED、
 * 确实零反问，只是用户点名的实体从没到达求解器。这正是本仓「绿测试≠能用·断在接缝」的形态。
 *
 * 判法：同一道题只换基地名，比对答案指纹（kpi 串 + 表行数 + 首行）。
 *   指纹不同 → 作用域真的流下去了；指纹相同 → 作用域被静默丢弃（SEAM-ARG-DROP）。
 *
 * 用法：node scope-probe.mjs <datacorePort> <agentcorePort> [outFile]
 */
const DC = `http://127.0.0.1:${process.argv[2] || 4601}`;
const AC = `http://127.0.0.1:${process.argv[3] || 4602}`;
const OUT = process.argv[4] || "/tmp/kimi-scope-probe.json";

/** 每组：同一句话只换基地名。两句答案指纹相同 = 基地作用域没流下去。 */
const PAIRS = [
  { intent: "kit_analysis", a: "下周常州哪些订单缺料开不了工？", b: "下周金华哪些订单缺料开不了工？" },
  { intent: "affected_orders", a: "常州基地影响哪些订单？", b: "金华基地影响哪些订单？" },
  { intent: "capacity_feasibility", a: "4680-NCM 加 20% 常州基地六周能不能交付？", b: "4680-NCM 加 20% 金华基地六周能不能交付？" },
  { intent: "risk_root_cause", a: "常州物料齐套 D+5 为什么越线？", b: "金华物料齐套 D+5 为什么越线？" },
];

const login = async () => {
  const r = await fetch(`${DC}/a/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
  });
  return (await r.json()).accessToken;
};

async function ask(tok, query) {
  const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
  const sub = await (await fetch(`${AC}/api/v1/queries`, {
    method: "POST", headers: H,
    body: JSON.stringify({ packageId: "pkg_battery_manufacturing", query, context: { view: "dash", selectedObjects: [], filters: {} } }),
  })).json();
  let t = null;
  for (let i = 0; i < 200; i++) {
    t = await (await fetch(`${AC}/api/v1/queries/${sub.taskId}`, { headers: H })).json();
    if (["COMPLETED", "FAILED", "CANCELLED", "AWAITING_CLARIFICATION"].includes(t.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const blocks = t?.answer?.blocks || [];
  const tbl = blocks.find((b) => b.type === "table");
  return {
    status: t?.status,
    baseSlot: t?.slots?.base ?? null,
    // 指纹：只取「随作用域应当变化」的量，不含时间戳/随机 id
    fingerprint: JSON.stringify({
      kpi: blocks.filter((b) => b.type === "kpi").map((b) => `${b.label}=${b.value}`),
      rows: tbl?.rows?.length ?? 0,
      first: tbl?.rows?.[0]?.[0] ?? null,
    }),
  };
}

const tok = await login();
const out = [];
for (const p of PAIRS) {
  const ra = await ask(tok, p.a);
  const rb = await ask(tok, p.b);
  const dropped = ra.fingerprint === rb.fingerprint;
  out.push({ ...p, a_result: ra, b_result: rb, scopeDropped: dropped });
  console.log(`${dropped ? "❌ 作用域被丢" : "✅ 作用域生效"} ${p.intent}`);
  console.log(`   A「${p.a}」 base槽=${JSON.stringify(ra.baseSlot)}`);
  console.log(`     ${ra.fingerprint.slice(0, 150)}`);
  console.log(`   B「${p.b}」 base槽=${JSON.stringify(rb.baseSlot)}`);
  console.log(`     ${rb.fingerprint.slice(0, 150)}`);
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
const bad = out.filter((x) => x.scopeDropped);
console.log(`\n═══ ${out.length - bad.length}/${out.length} 意图的基地作用域真流到求解器 ═══`);
if (bad.length) console.log(`作用域被静默丢弃：${bad.map((b) => b.intent).join(", ")}`);
console.log(`落盘：${OUT}`);
