#!/usr/bin/env node
/**
 * WO-SIM-EDGE-WIRE · D6① 死胡同普查表 + D6② forecast_bias 判定（运行时一半）
 *
 * ① 死胡同普查（WO 本单最重要交付物的今天形态）：
 *   tick0 实测格按 (对象类型, 状态变量) 分组 → 逐条 join 50 条 PUBLISHED 边的
 *   sourceTypeKey.sourceStateVar（edge-inventory.json，已金丝雀核验恰 50/恰 34 null）
 *   → asSource 计数表。asSource:0 = 读得出但传不出 = 死胡同。
 *   backlog 三量（backlogQtyTop/backlogPriceTop/backlogHorizonDays）单列归档区：
 *   它们是终态指标（450 时代唯一传出去的 18 格就是它们），不作为缺陷。
 *
 * ② forecast_bias 一条判定（复验方裁决 D6②）：
 *   a. 自核「源恒 0」：tick0 全体 Model.forecastBias 分布（不引别人结论）。
 *   b. 触发实测：对一个 Model 施加 forecastBias +20（事件目录 forecast-bias 同款
 *      kind=demand_shift），3 拍 disclose，trace 里 demo_forecast_bias_to_order_demand
 *      的逐条 amount 与**每目标入边数 N** —— N=1 ⇒ weightRef:null 数学上恒 1（无操作），
 *      判定「零信号态非死边，null 可留」；N>1 ⇒ 回报告改判。
 *
 * 🐤 金丝雀：
 *   1. 实测格总数必须 = origin.measuredCells（4171）—— 分组法与占位重算公式双双自证
 *      （该公式在 twin-arms 已被 2192 占位格全幂等咬过一口，这里再咬总账）。
 *   2. oid→type 映射必须覆盖全部实测格（0 格落到未知类型）。
 *   3. forecast_bias 触发后 trace 行 ≥1 且 |amount|>0（证明探针真触到了这条边）；
 *      不中 ⇒ 报「未触发」，不许编 N。
 *
 * 自证：端口真去 bind；lsof 监听 pid = 我 spawn 的 pid。
 * 用法：node asource-census.mjs [outJsonPath]
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const H = { "X-Debug-User": "demo:admin:admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function jget(b, p) { const r = await fetch(b + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status} ${await r.text()}`); return r.json(); }
async function jpost(b, p, body) { const r = await fetch(b + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) }); if (!r.ok) throw new Error(`POST ${p} ${r.status} ${(await r.text()).slice(0, 300)}`); return r.json(); }

/** 与 seed-world.ts seedHash01 逐字同式（twin-arms 金丝雀已证）。 */
function seedHash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}
const placeholderCell = (oid, sv) => Math.round(seedHash01(`${oid}|${sv}`) * 100);

const FB_EDGE = "demo_forecast_bias_to_order_demand";

async function main() {
  const outPath = process.argv[2] ?? null;
  const inv = JSON.parse(fs.readFileSync(`${ROOT}/docs/evidence/wo-sim-edge-wire/edge-inventory.json`, "utf8"));
  const canaryInv = inv.length === 50;
  console.log(`# 🐤⓪ 边清单 ${inv.length} 条（必须 50）: ${canaryInv ? "✓" : "✗ ⇒ 清单文件坏了"}`);
  if (!canaryInv) throw new Error("edge-inventory.json 不是 50 条");

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
    env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-edge-wire-census", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (b) => { log += b.toString(); });
  child.stderr.on("data", (b) => { log += b.toString(); });
  try {
    let up = false;
    for (let i = 0; i < 600; i++) { await sleep(500); try { await jget(base, "/readyz"); up = true; break; } catch { /* wait */ } if (child.exitCode !== null) break; }
    if (!up) throw new Error(`服务没起来（exitCode=${child.exitCode}）\n${log.slice(-3000)}`);
    const lp = execFileSync("lsof", ["-t", `-i:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
    if (!lp.split(/\s+/).includes(String(child.pid))) throw new Error(`端口 ${port} 监听 pid=${lp} ≠ spawn ${child.pid} ⇒ 连的是别人的服务，拒下结论`);
    console.log(`# 自证：端口 ${port} LISTEN pid=${lp} = spawn ${child.pid} ✓`);

    const seedSess = await jget(base, "/a/v1/sim/sessions/sims_demo_seed_world");
    const t0 = seedSess.baseSnapshot;
    const measuredCellsOrigin = seedSess.scope?.baseSnapshotOrigin?.measuredCells ?? null;

    // ── oid→type：从 origin 文案解析实测 (Type.sv) 清单拿类型名，逐类型拉对象 ──
    const formula = seedSess.scope?.baseSnapshotOrigin?.formula ?? "";
    const hitSec = formula.split("本次命中 ")[1]?.split("。")[0] ?? "";
    const typeSvPairs = hitSec.split("、").map((s) => s.trim()).filter((s) => /^[A-Z][A-Za-z]+\.[a-z]/.test(s));
    const types = [...new Set(typeSvPairs.map((p) => p.split(".")[0]))];
    console.log(`# origin 实测清单解析：${typeSvPairs.length} 个 (类型.变量) 对，${types.length} 个类型`);
    const typeOf = new Map();
    for (const t of types) {
      let page = 1;
      for (;;) {
        const r = await jget(base, `/a/v1/objects?type=${encodeURIComponent(t)}&pageSize=500&page=${page}`);
        for (const it of r.items ?? []) typeOf.set(it.id, t);
        if (!r.hasMore) break;
        page += 1;
      }
    }

    // ── 实测格分组（占位重算 ≠ 现值 ⇒ 实测格）───────────────────────────────
    const byVar = new Map(); // "Type.sv" -> {cells, objects:Set}
    let measuredTotal = 0, unknownType = 0;
    for (const [oid, row] of Object.entries(t0)) {
      const t = typeOf.get(oid);
      for (const [sv, v] of Object.entries(row)) {
        if (placeholderCell(oid, sv) === v) continue;
        measuredTotal += 1;
        if (t === undefined) { unknownType += 1; continue; }
        const k = `${t}.${sv}`;
        if (!byVar.has(k)) byVar.set(k, { cells: 0, objects: new Set() });
        const e = byVar.get(k); e.cells += 1; e.objects.add(oid);
      }
    }
    const canary1 = measuredTotal === measuredCellsOrigin;
    const canary2 = unknownType === 0;
    console.log(`# 🐤① 实测格 ${measuredTotal} vs origin.measuredCells ${measuredCellsOrigin}: ${canary1 ? "✓" : "✗ ⇒ 分组法或占位公式有一边是假的"}`);
    console.log(`# 🐤② 落到未知类型的实测格 ${unknownType}（必须 0）: ${canary2 ? "✓" : "✗ ⇒ oid→type 映射漏类型"}`);
    if (!canary1 || !canary2) throw new Error("金丝雀①②未过，拒下结论");

    // ── asSource join 50 条已发布边 ──────────────────────────────────────────
    const rulesBySrc = new Map();
    for (const r of inv) { if (!rulesBySrc.has(r.source)) rulesBySrc.set(r.source, []); rulesBySrc.get(r.source).push(r.key); }
    const census = [...byVar.entries()].map(([v, e]) => ({
      var: v, cells: e.cells, objects: e.objects.size,
      asSource: (rulesBySrc.get(v) ?? []).length, rules: rulesBySrc.get(v) ?? [],
    })).sort((a, b) => a.asSource - b.asSource || b.cells - a.cells);
    const deadEnds = census.filter((c) => c.asSource === 0);
    console.log("\n══ ① 死胡同普查（真值变量 asSource，升序）══");
    for (const c of census) console.log(`  asSource=${c.asSource}  ${c.var}  (${c.cells} 格 / ${c.objects} 对象)${c.asSource === 0 ? "  ⛔死胡同" : ""}  ${c.rules.join(",")}`);
    console.log(`══ 死胡同 ${deadEnds.length} 个：${deadEnds.map((d) => d.var).join("、") || "无"} ══`);

    // backlog 三量归档区（终态指标，不作缺陷）
    const backlog = inv.filter((r) => /backlog/i.test(r.source) || /backlog/i.test(r.target));
    console.log(`# 归档区：含 backlog 的边 ${backlog.length} 条（源/目标任一侧命中即列出，供三量归档核对）`);
    for (const b of backlog) console.log(`    ${b.key}: ${b.source} -> ${b.target} (weightRef=${b.weightRef})`);

    // ── ②a forecastBias 源恒 0 自核 ─────────────────────────────────────────
    const fbVals = [];
    for (const [oid, row] of Object.entries(t0)) if (typeOf.get(oid) === "Model" && typeof row.forecastBias === "number") fbVals.push(row.forecastBias);
    fbVals.sort((a, b) => a - b);
    const fbAllZero = fbVals.length > 0 && fbVals.every((v) => v === 0);
    console.log(`\n══ ②a tick0 Model.forecastBias：n=${fbVals.length} min=${fbVals[0]} max=${fbVals[fbVals.length - 1]} 全零=${fbAllZero} ══`);

    // ── ②b 触发实测：forecastBias +20 → 3 拍 → 该边 trace 的 N 与 amount ──────
    const modelOid = [...(byVar.get("Model.forecastBias")?.objects ?? [])].sort()[0] ?? null;
    if (!modelOid) throw new Error("实测格里没有 Model.forecastBias 的对象，无法选触发落点");
    const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
    await jpost(base, `/a/v1/sim/sessions/${s.id}/perturbations`, { kind: "demand_shift", targetObjectId: modelOid, targetStateVar: "forecastBias", magnitude: 20, label: `forecast-bias 探针 · ${modelOid}`, mode: "delta", durationTicks: 20 });
    const ticked = await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 3, disclose: true });
    const fbRows = (ticked.trace ?? []).filter((t) => t.ruleKey === FB_EDGE);
    const amounts = fbRows.map((r) => r.amount).filter((a) => typeof a === "number");
    const perTarget = new Map();
    for (const r of fbRows) { const t = r.targetObjectId ?? r.targetId; if (t) perTarget.set(t, (perTarget.get(t) ?? 0) + 1); }
    const nVals = [...perTarget.values()];
    const canary3 = fbRows.length >= 1 && amounts.some((a) => Math.abs(a) > 0);
    console.log(`══ ②b 触发 ${modelOid}.forecastBias+20：trace ${fbRows.length} 行 / 目标 ${perTarget.size} 个 / 每目标入边 N=${JSON.stringify([...new Set(nVals)].sort())} / |amount| max=${amounts.length ? Math.max(...amounts.map(Math.abs)) : null} ══`);
    console.log(`# 🐤③ trace≥1 行且有非零 amount: ${canary3 ? "✓" : "✗ ⇒ 探针没触到这条边，N 不许编"}`);

    const out = {
      port, canary: { canary1, canary2, canary3, measuredTotal, unknownType },
      census, deadEnds: deadEnds.map((d) => d.var),
      backlogEdges: backlog,
      forecastBias: { tick0: { n: fbVals.length, min: fbVals[0] ?? null, max: fbVals[fbVals.length - 1] ?? null, allZero: fbAllZero }, triggered: canary3 ? { probeModel: modelOid, traceRows: fbRows.length, targets: perTarget.size, perTargetN: [...new Set(nVals)].sort((a, b) => a - b), amountAbsMax: amounts.length ? Math.max(...amounts.map(Math.abs)) : null } : "未触发" },
    };
    const txt = JSON.stringify(out, null, 1);
    if (outPath) { fs.writeFileSync(outPath, txt); console.log(`# 已落 ${outPath}`); }
  } finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
