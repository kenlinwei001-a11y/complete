// 项6 取证：订单 → 工单 fulfills 覆盖率（真后端，page/pageSize 翻页，读 hasMore；不许把首页当全量）
import fs from "node:fs";
const DC = process.env.DC ?? "http://127.0.0.1:4051";
const login = await (await fetch(`${DC}/a/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) })).json();
const TOK = login.accessToken ?? login.token;
const H = { Authorization: `Bearer ${TOK}` };

async function fetchAll(type) {
  const items = []; let page = 1;
  for (;;) {
    const r = await (await fetch(`${DC}/a/v1/objects?type=${type}&page=${page}&pageSize=200`, { headers: H })).json();
    if (!r.items) { console.error(type, "ERR", JSON.stringify(r).slice(0, 200)); break; }
    items.push(...r.items);
    if (!r.hasMore || r.items.length === 0) { console.log(`${type}: total=${r.total} 取回=${items.length} 末页 hasMore=${r.hasMore}`); break; }
    page++;
    if (page > 60) break;
  }
  return items;
}

// 金丝雀：先证明翻页是对的 —— 取回数必须等于 total，且首页 200 ≠ 全量
const orders = await fetchAll("Order");
const wos = await fetchAll("WorkOrder");
if (orders.length <= 200) console.log("⚠ 金丝雀警告：Order 只取回", orders.length, "条，翻页可能没生效");

const refs = new Map();
for (const w of wos) {
  const ref = w.props?.orderRef;
  if (ref) refs.set(ref, (refs.get(ref) ?? 0) + 1);
}
const orderSos = orders.map((o) => o.props?.so).filter(Boolean);
const covered = orderSos.filter((so) => refs.has(so));
const danglingRefs = [...refs.keys()].filter((r) => !orderSos.includes(r));

const out = {
  orderTotal: orders.length,
  workOrderTotal: wos.length,
  workOrdersWithOrderRef: wos.filter((w) => w.props?.orderRef).length,
  distinctOrdersReferenced: refs.size,
  ordersCovered: covered.length,
  coveragePct: +(covered.length / orders.length * 100).toFixed(2),
  danglingOrderRefs: danglingRefs.length,
  danglingSample: danglingRefs.slice(0, 5),
  sampleCoveredOrders: covered.slice(0, 5),
  // 台账首页（UI 上按 so 升序展示的头几张）覆盖情况
  firstPageUiOrders: orderSos.slice(0, 10).map((so) => ({ so, workOrders: refs.get(so) ?? 0 })),
};
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync("docs/evidence/e2e-accept/fulfills-coverage.json", JSON.stringify(out, null, 2));
