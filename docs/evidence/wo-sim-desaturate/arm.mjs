#!/usr/bin/env node
/**
 * WO-SIM-DESATURATE · A/B 对照实验台（铁律 1.5 判据一）
 *
 * 一次调用 = **一个全新世界 + 一条臂**：起一个全新的 datacore（内存模式 SEED_DEMO=1 ⇒ 种子世界
 * 现播，绝不复用跑久了的实例），施加 N 件扰动，推 3 拍，算出屏上那四个数。
 *
 * ⚠ 端口：**真去 bind** 才算证据（本机没有 ss/netstat，它们的沉默不构成「端口空闲」）。
 * ⚠ 自证：起服务后用 `lsof -t -i:PORT -sTCP:LISTEN` 取监听 pid，**必须等于我 spawn 的那个**，
 *    否则就是连到了别的 agent 的遗留服务 —— 本仓真发生过「读别人的旧服务，然后对自己代码下结论」。
 *
 * 用法：node arm.mjs <zero|one|twelve|N> [outJsonPath]
 *
 * ══ 2026-09-16 实测结论（真服务 · 本目录六个脚本可逐条复跑）══════════════════════════
 *
 * ① 病象**复现了**（`arm.mjs zero|one|twelve`，各自全新服务、全新种子世界 @tick3）：
 *      件数 │ 敞口(元)        订单  客户  卡点 │ p90      max
 *      ──── ┼────────────────────────────────┼──────────────────
 *       0   │ 15,663,001,584  150   17    18  │ 11.274828  18.493871444307
 *       1   │ 15,663,001,584  150   17    18  │ 11.274828  18.493871444307
 *      12   │ 15,663,001,584  150   17    18  │ 13.286586  25
 *    ⇒ 四个数 1 件 vs 12 件**逐字节相同**；而 **0 件那一臂也一模一样** ——
 *      这四个数从头到尾没在度量用户输入。
 *
 * ② 病因**不是种子扰动**（`control.mjs` / `satcensus.mjs` / `seedcell.mjs`）：
 *    · 把整条种子扰动**删掉**（同一份 tick0、零种子扰动、同样推 3 拍）：
 *      t0→t3 漂移 4831 格 → **4831 格**；被压缩格 1721/4807 → **1721/4807**（35.80% 不变）；
 *      raw/max 中位数 1.347 → 1.346；灵敏度中位数 8.715e-2 → 8.722e-2。**差 0.07%。**
 *      「删掉」是降量级/改有限期/换选点这三条杠杆的**效果上界** ⇒ 三条都够不到验收判据。
 *    · 那条 +100（一个全距）的种子扰动，在它自己的落点格上**屏上只推动了 5.728e-6**
 *      （98.352927154825 vs 对照 98.352921426697）：raw 被逐拍压回域内 + λ=0.37 衰减，
 *      两拍内吃光。全世界只有 223/6363 格受它影响，唯一活下来的是**没登记取值域**的
 *      `queueDays`（9.75 @ obj_incominginspection_iqc_po_12）。
 *
 * ③ 饱和**在 tick0 就已经存在**，与扰动无关：出厂快照（还没跑一拍）4807 个已声明格里
 *    **573 格（11.92%）越界**，最大 raw/max = 6.75 ⇒ 来源是哈希占位基线（派单里的来源②，
 *    派单自己写明「不在本单」）。跑到稳态只会更重：tick48 时 **2697 格（56.11%）**被压缩。
 *
 * ④ 真正压住这四个数的是**世界自漂移**（`settle.mjs`）：λ=0.37/拍的衰减把 5913 格 ~50 的
 *    哈希占位往 0 拉，这段暂态零输入就把**全部 150 张未完成单**推过视图层 0.01 噪声地板
 *    （p90 11.27）⇒「被推动的单」恒等于它的**结构上限**（= 全部未完成单），加不上去。
 *    而用户那一条扰动在订单侧的因果贡献实测 **4.4e-6**（`causal.mjs`，两臂逐格相减，
 *    自漂移在两臂里逐字节相同故被完全消掉）—— 比地板低 2,300 倍。
 *    横轴推远也不解决：K=48 时 0 件 vs 1 件仍逐字节相同（40 单 / 17 家），
 *    12 件只多 1 单，且多出来那 1 单是**直接落在 Order 对象上**的那条扰动本身。
 *
 * 形态（铁律 0.6 句式）：
 *   **「我用『推演前后这一格的读数变了』当作『这次扰动影响了它』的证据，而前者并不度量后者
 *     —— 它度量的是世界自己每拍都在跑的衰减暂态。」**
 *   套在派单上是第二句：
 *   **「我用『种子扰动是一个全距、永久、落在可达面最大那一格』当作『它是饱和的来源』的证据，
 *     而前者并不度量后者 —— 删掉它，饱和一个百分点都不动。」**
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

// 仓根 = 本文件往上四级（docs/evidence/wo-sim-desaturate/x.mjs）——⛔ 不写死任何人的 worktree 路径
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };

/** 真去 bind —— 唯一可靠的「这个端口能用」判据。 */
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jget(base, path) {
  const r = await fetch(base + path, { headers: H });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function jpost(base, path, body) {
  const r = await fetch(base + path, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

/** 前端 `console0828Model.diffWorld` 的**逐行同义**移植（eps 同为 1e-9）。 */
function diffWorld(before, after, eps = 1e-9) {
  const out = [];
  for (const [oid, cells] of Object.entries(after)) {
    const prev = before[oid];
    if (prev === undefined) continue;
    for (const [sv, v] of Object.entries(cells)) {
      const p = prev[sv];
      if (typeof p !== "number" || typeof v !== "number") continue;
      const d = v - p;
      if (Math.abs(d) <= eps) continue;
      out.push({ objectId: oid, stateVar: sv, before: p, after: v, delta: d });
    }
  }
  return out;
}

/** `console0828Model.isSettledOrder` 的唯一判据（黑名单只有 COMPLETED 一项）。 */
const isSettled = (o) => o?.status === "COMPLETED";
const NOISE_FLOOR = 0.01;

/** 屏上「敞口 / 订单 / 客户」三个数（`buildMoneyView` + `buildCustomerView` 同口径）。 */
function fourNumbers(deltas, orders) {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const touched = new Set();
  const settled = new Set();
  const maxAbs = new Map();
  for (const d of deltas) {
    const o = byId.get(d.objectId);
    if (o === undefined) continue;
    if (isSettled(o)) { settled.add(d.objectId); continue; }
    touched.add(d.objectId);
    const m = Math.abs(d.delta);
    const prev = maxAbs.get(d.objectId);
    if (prev === undefined || m > prev) maxAbs.set(d.objectId, m);
  }
  const touchedRaw = new Set(touched); // 过 NOISE_FLOOR **之前**的那份（客户面用它）
  for (const [oid, m] of maxAbs) if (m <= NOISE_FLOOR) touched.delete(oid);
  let exposure = 0;
  for (const id of touched) {
    const v = byId.get(id)?.value;
    if (typeof v === "number" && Number.isFinite(v)) exposure += v;
  }
  // ⚠ 客户面走的是 `Console0828.touchedOrderIds`（**不过 NOISE_FLOOR**，只滤已完成单），
  //   与敞口/订单张数那两个数**不同口径** —— 照抄前端，不自己统一。
  const custs = new Set();
  for (const id of touchedRaw) custs.add(byId.get(id)?.cust ?? "（无客户名）");
  const mags = [...maxAbs.values()].sort((a, b) => a - b);
  return {
    exposure,
    exposedOrders: touched.size,
    touchedCustomers: custs.size,
    settledExcluded: settled.size,
    faintOnly: mags.filter((m) => m <= NOISE_FLOOR).length,
    magMax: mags.length === 0 ? null : mags[mags.length - 1],
    magP90: mags.length === 0 ? null : mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.9))],
  };
}

/** 12 件事（与前端 `eventCatalog.BUSINESS_EVENTS` 同序同参；本脚本只用落点/量级/kind/mode）。 */
const EVENTS = [
  { id: "material-price-up", types: ["Material"], vars: ["priceShock"], kind: "cost_shock", mag: 20, dur: null },
  { id: "batch-defect", types: ["QualityLot", "MaterialBatch", "DefectRecord"], vars: ["inspectBacklog", "defectPressure", "turnoverPressure"], kind: "quality_event", mag: 15, dur: null },
  { id: "rush-order", types: ["Order"], vars: ["demandPressure"], kind: "demand_shift", mag: 30, dur: null },
  { id: "due-change", types: ["OrderPromise", "Order"], vars: ["promiseRisk", "shortageRisk"], kind: "demand_shift", mag: 20, dur: null },
  { id: "order-cancel", types: ["Order"], vars: ["orderChurn"], kind: "demand_shift", mag: 25, dur: null },
  { id: "inbound-delay", types: ["Supplier", "PurchaseOrder", "MaterialBatch"], vars: ["deliveryDelay", "procurementDelay"], kind: "supply_disruption", mag: 7, dur: 7 },
  { id: "material-short", types: ["Material"], vars: ["shortageRisk"], kind: "supply_disruption", mag: 30, dur: 30 },
  { id: "equipment-down", types: ["Equipment"], vars: ["equipmentFailure", "loadPressure"], kind: "capacity_loss", mag: 2, dur: 2 },
  { id: "capacity-loss", types: ["Base", "Line"], vars: ["loadIndex", "utilPressure"], kind: "capacity_loss", mag: 20, dur: 20 },
  { id: "ship-to-change", types: ["CustomerLocation", "InterBaseTransfer"], vars: ["deliveryHoldRisk", "transferPressure"], kind: "demand_shift", mag: 20, dur: null },
  { id: "order-reprice", types: ["Order"], vars: ["costPressure"], kind: "cost_shock", mag: 15, dur: null },
  { id: "forecast-bias", types: ["Model", "DemandSegment"], vars: ["forecastBias", "demandLoad"], kind: "demand_shift", mag: 20, dur: 20 },
];

async function main() {
  const arm = process.argv[2] ?? "one";
  const outPath = process.argv[3] ?? null;
  const n = arm === "twelve" ? 12 : arm === "zero" ? 0 : Number.isFinite(Number(arm)) ? Number(arm) : 1;

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
    env: {
      ...process.env,
      PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-desat", SEED_DEMO: "1",
      CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (b) => { log += b.toString(); });
  child.stderr.on("data", (b) => { log += b.toString(); });

  try {
    let up = false;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      try { await jget(base, "/readyz"); up = true; break; } catch { /* keep waiting */ }
      if (child.exitCode !== null) break;
    }
    if (!up) throw new Error(`服务没起来（exitCode=${child.exitCode}）\n${log.slice(-3000)}`);

    // ── 自证：监听这个端口的进程必须就是我 spawn 的那个 ────────────────────────
    let listenPid = "";
    try { listenPid = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim(); } catch { /* lsof may be absent */ }
    const ownPid = String(child.pid);
    const owns = listenPid.split(/\s+/).includes(ownPid);
    if (!owns) throw new Error(`端口 ${port} 的监听 pid=${listenPid}，不是我 spawn 的 ${ownPid} ⇒ 连的是别人的服务，拒绝据此下结论`);

    const sessions = await jget(base, "/a/v1/sim/sessions");
    const seed = (sessions.items ?? []).find((s) => s.id === "sims_demo_seed_world");
    if (!seed) throw new Error(`没有种子世界；sessions=${JSON.stringify((sessions.items ?? []).map((s) => s.id))}`);

    // 世界龄探针：全新世界必须是 curTick=3（不是跑久了的实例）
    const before = await jget(base, `/a/v1/sim/sessions/${seed.id}/world`);

    // 订单全量（金丝雀：必须 500 且 hasMore=false）
    const ordRes = await jget(base, "/a/v1/objects?type=Order&pageSize=500");
    const orders = (ordRes.items ?? []).map((it) => {
      const p = it.props ?? {};
      return {
        id: it.id,
        cust: typeof p.cust === "string" ? p.cust : null,
        value: typeof p.value === "number" ? p.value : null,
        status: typeof p.status === "string" ? p.status : null,
      };
    });

    // ── 落点选取：确定性（每个事件取"在世界态里存在该状态变量"的字典序最小对象）──
    const typeOfObj = new Map();
    const typesWanted = new Set(EVENTS.flatMap((e) => e.types));
    for (const t of typesWanted) {
      const r = await jget(base, `/a/v1/objects?type=${encodeURIComponent(t)}&pageSize=500`);
      for (const it of r.items ?? []) typeOfObj.set(it.id, t);
    }
    const idsByType = new Map();
    for (const [id, t] of typeOfObj) { if (!idsByType.has(t)) idsByType.set(t, []); idsByType.get(t).push(id); }
    for (const v of idsByType.values()) v.sort((a, b) => a.localeCompare(b));

    const staged = [];
    for (const e of EVENTS) {
      let hit = null;
      outer: for (const t of e.types) {
        for (const id of idsByType.get(t) ?? []) {
          const row = before.state[id];
          if (!row) continue;
          for (const sv of e.vars) if (typeof row[sv] === "number") { hit = { id, sv, t }; break outer; }
        }
      }
      staged.push({ ev: e, hit });
    }
    const usable = staged.filter((s) => s.hit !== null);
    const chosen = usable.slice(0, n);

    const receipts = [];
    for (const s of chosen) {
      const body = {
        kind: s.ev.kind, targetObjectId: s.hit.id, targetStateVar: s.hit.sv,
        magnitude: s.ev.mag, label: `${s.ev.id} · ${s.hit.id}`, mode: "delta",
        durationTicks: s.ev.dur,
      };
      const r = await jpost(base, `/a/v1/sim/sessions/${seed.id}/perturbations`, body);
      receipts.push({ ev: s.ev.id, target: s.hit.id, stateVar: s.hit.sv, mag: s.ev.mag, startTick: r.perturbation.startTick });
    }

    const ticked = await jpost(base, `/a/v1/sim/sessions/${seed.id}/tick`, { n: 3, disclose: true });
    const after = await jget(base, `/a/v1/sim/sessions/${seed.id}/world`);
    const deltas = diffWorld(before.state, after.state);
    const four = fourNumbers(deltas, orders);

    // 卡点（已知只收范围不收世界态；照样记，别凭注释断言）
    let impediments = null;
    try {
      const r = await jpost(base, "/a/v1/solvers/chain_impediments/invoke", { scope: {} });
      impediments = (r.data?.impediments ?? []).length;
    } catch (e) { impediments = `ERR:${String(e).slice(0, 120)}`; }

    // ── 判据 2：余量（改前改后四个均值）───────────────────────────────────────
    const meanOf = (state, sv) => {
      let s = 0, k = 0;
      for (const row of Object.values(state)) { const v = row[sv]; if (typeof v === "number") { s += v; k += 1; } }
      return k === 0 ? null : { n: k, mean: s / k };
    };
    /* ── 判据 3：种子世界自身的动静（tick0 → tick3 有多少格读数变了）──────────────
     * ⚠ `GET …/:id/world` **不收 `?tick=`**（app.ts 该路由只回 `s.curTick` 那一格）——
     *   传了也返当前态，会把「取到了 tick0」这件事伪造出来。tick0 态的真出处是会话自己的
     *   `baseSnapshot`（`GET /a/v1/sim/sessions/:id`）。
     * 🐤 金丝雀：baseSnapshot 的格数必须 = 世界格数（6363），否则是取错了东西。 */
    const sess = await jget(base, `/a/v1/sim/sessions/${seed.id}`);
    const t0state = sess.baseSnapshot ?? {};
    const t0cells = Object.values(t0state).reduce((a, r) => a + Object.keys(r).length, 0);
    const seedMotionCells = diffWorld(t0state, before.state).length;

    const out = {
      arm, n, port, ownPid, listenPid,
      beforeTick: before.tick, afterTick: ticked.curTick,
      seedChoice: seed.scope?.seedPerturbation ?? null,
      seedPerturbationLabel: (await jget(base, `/a/v1/sim/sessions/${seed.id}/perturbations`)).items
        .filter((p) => p.id.endsWith("_p0")).map((p) => ({ mag: p.magnitude, dur: p.durationTicks, startTick: p.startTick, target: p.targetObjectId, sv: p.targetStateVar })),
      ordersTotal: orders.length, ordersHasMore: ordRes.hasMore ?? null,
      usableEvents: usable.length, stagedMisses: staged.filter((s) => s.hit === null).map((s) => s.ev.id),
      receipts,
      four: { ...four, impediments },
      cells: Object.values(before.state).reduce((a, r) => a + Object.keys(r).length, 0),
      means_before: { supplyRisk: meanOf(before.state, "supplyRisk"), costPressure: meanOf(before.state, "costPressure"), expeditePressure: meanOf(before.state, "expeditePressure"), queueDays: meanOf(before.state, "queueDays") },
      t0cells, seedMotionCells,
      orderStatusDist: orders.reduce((a, o) => { const k = o.status ?? "(null)"; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      deltaCount: deltas.length,
      topDeltas: deltas.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5),
    };
    const txt = JSON.stringify(out, null, 2);
    if (outPath) fs.writeFileSync(outPath, txt);
    console.log(txt);
  } finally {
    try { process.kill(child.pid, "SIGKILL"); } catch { /* already gone */ }
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
