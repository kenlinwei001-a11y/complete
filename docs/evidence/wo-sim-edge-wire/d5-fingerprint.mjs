#!/usr/bin/env node
/**
 * WO-SIM-EDGE-WIRE · D6③ / 复验方 D5 判据：病的指纹四数（贡献按权重拉开）
 *
 * 判据（复验方原话）：「同一目标格上，两个不同源的贡献是否按其权重拉开：
 *   磷酸铁锂正极（BOM 17.815%）vs 铝箔（0.920%），各涨 15%
 *   → 同一格 Model.costPressure 的两个贡献必须按占比拉开
 *   → 四个数（改前两个、改后两个），缺一个不算交付
 *   ⚠ 两个数逐字节相同 = 这条线没通，报『没通』，不许报『差异很小』」
 *
 * 「贡献」取 trace 行 amount（= 系数 × 源值 × 权重，传播引擎逐实例吐出的真值），
 * 不是格值增量 —— 格值增量混着衰减/clamp/其它源，不度量「这条边的贡献」。
 *   改前两个 = 基线臂（零扰动）第 1 拍该格收到的 pos_lfp / al_foil 两条 amount
 *   改后两个 = 扰动臂（各自 +15 点）第 1 拍同格同两条 amount
 * 另附：第 1–4 拍逐拍轨迹 + 因果格增量（扰动臂 − 基线臂，自漂移逐字节相消）作旁证。
 *
 * 预言（可证伪）：两臂源值轨迹逐字节相同（tick0 都 = 2，都 +15）⇒ amount 之比
 * 必须 = 权重之比 = BOM 成本占比之比 = 17.815 / 0.920 = 19.3641×。
 * 若权重没生效（病回来）⇒ 两数逐字节相同（比 = 1）= 当年 9.75/9.75 的指纹。
 *
 * 🐤 金丝雀：
 *   ① 落点型号 obj_model_*（props.modelId=方形-LFP）必须同时收到 pos_lfp 与 al_foil
 *     的 bom 边 trace 行（识别法自证；字段名 fromObjectId/toObjectId 系实测）。
 *   ② 决定性：两条零扰动臂的第 4 拍终态**全世界**逐格差必须 = 0（自漂移逐字节可消的
 *      证据 —— desat3 causal.mjs 同款判据）。
 *   ③ 扰动真落上了：扰动臂源格 tick1 值必须 ≠ 基线臂同格（+15 真加上去了）。
 *
 * 自证：端口真去 bind；lsof 监听 pid = 我 spawn 的 pid。
 * 用法：node d5-fingerprint.mjs [outJsonPath]
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

const LFP = "obj_material_pos_lfp";   // 磷酸铁锂正极（方形-LFP BOM 成本占比 17.815%）
const FOIL = "obj_material_al_foil";  // 铝箔（0.920%）
const BOM_EDGE = "demo_material_price_to_model_cost";
const MODEL_KEY = "方形-LFP";
const SHARE_LFP = 17.815, SHARE_FOIL = 0.920;
const TICKS = 4;

function diffCount(a, b, eps = 1e-9) {
  let n = 0;
  for (const [oid, cells] of Object.entries(b)) {
    const pa = a[oid]; if (pa === undefined) continue;
    for (const [sv, v] of Object.entries(cells)) {
      const p = pa[sv]; if (typeof p !== "number" || typeof v !== "number") continue;
      if (Math.abs(v - p) > eps) n += 1;
    }
  }
  return n;
}

async function main() {
  const outPath = process.argv[2] ?? null;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [`${ROOT}/apps/datacore/dist/server.js`], {
    env: { ...process.env, PORT: String(port), JWT_SECRET: "dev", BLOB_DIR: "/tmp/blobs-edge-wire-d5", SEED_DEMO: "1", CREDENTIAL_KEY: "0".repeat(64), LOG_LEVEL: "error" },
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
    const measured = seedSess.scope?.baseSnapshotOrigin?.measuredCells ?? null;
    if (measured !== 4171) throw new Error(`measuredCells=${measured} ≠ 4171 ⇒ 连错服务`);

    // 落点型号：props.modelId === 方形-LFP
    const mRes = await jget(base, "/a/v1/objects?type=Model&pageSize=500");
    const target = (mRes.items ?? []).find((it) => it.props?.modelId === MODEL_KEY || it.props?.name === MODEL_KEY);
    if (!target) throw new Error(`找不到型号 ${MODEL_KEY}（Model 共 ${(mRes.items ?? []).length} 个）`);
    const M = target.id;
    console.log(`# 落点型号 ${MODEL_KEY} = ${M}（tick0 costPressure=${t0[M]?.costPressure}）`);

    // ── 一臂：可选扰动 → 4 拍 disclose → 每拍该格两条 bom amount + 终态 ──────
    async function runArm(name, perturb) {
      const s = await jpost(base, "/a/v1/sim/sessions", { baseSnapshot: t0, scope: {} });
      if (perturb) await jpost(base, `/a/v1/sim/sessions/${s.id}/perturbations`, { kind: "cost_shock", targetObjectId: perturb.id, targetStateVar: "priceShock", magnitude: 15, label: `${name} · +15`, mode: "delta", durationTicks: null });
      const perTick = [];
      for (let k = 0; k < TICKS; k++) {
        const r = await jpost(base, `/a/v1/sim/sessions/${s.id}/tick`, { n: 1, disclose: true });
        const rows = (r.trace ?? []).filter((t) => t.ruleKey === BOM_EDGE && t.toObjectId === M);
        const amt = (src) => rows.filter((t) => t.fromObjectId === src).reduce((a, t) => a + (typeof t.amount === "number" ? t.amount : 0), 0);
        perTick.push({ tick: r.curTick, lfp: amt(LFP), foil: amt(FOIL), rows: rows.length });
      }
      const w = await jget(base, `/a/v1/sim/sessions/${s.id}/world`);
      console.log(`# 臂[${name}] 逐拍 amount: ${perTick.map((p) => `t${p.tick}(lfp=${p.lfp},foil=${p.foil},行${p.rows})`).join(" ")} 终态格=${w.state[M]?.costPressure}`);
      return { name, perTick, after: w.state };
    }

    const armBase1 = await runArm("基线·1", null);
    const armBase2 = await runArm("基线·2", null);
    const armLfp = await runArm("磷酸铁锂正极+15", { id: LFP });
    const armFoil = await runArm("铝箔+15", { id: FOIL });

    // 🐤① 落点同吃两源（基线臂第 1 拍两行都在）
    const t1 = armBase1.perTick[0];
    const canary1 = t1.rows >= 2 && t1.lfp !== 0 && t1.foil !== 0;
    console.log(`# 🐤① 基线臂 tick${t1.tick} ${M} 收到 bom 行 ${t1.rows}（lfp=${t1.lfp} foil=${t1.foil}）: ${canary1 ? "✓" : "✗ ⇒ 落点识别失败，如实报不猜"}`);

    // 🐤② 决定性：两条基线臂终态全世界逐格差 = 0
    const driftDiff = diffCount(armBase1.after, armBase2.after);
    const canary2 = driftDiff === 0;
    console.log(`# 🐤② 基线臂1 vs 基线臂2 终态全世界差 ${driftDiff} 格（必须 0）: ${canary2 ? "✓ ⇒ 自漂移逐字节可消" : "✗ ⇒ 世界不可复现，因果差全部作废"}`);

    // 🐤③ 扰动真落上：扰动臂源格 ≠ 基线臂同格
    const lfpMoved = armLfp.after[LFP]?.priceShock !== armBase1.after[LFP]?.priceShock;
    const foilMoved = armFoil.after[FOIL]?.priceShock !== armBase1.after[FOIL]?.priceShock;
    const canary3 = lfpMoved && foilMoved;
    console.log(`# 🐤③ 扰动落点核查：pos_lfp ${armBase1.after[LFP]?.priceShock}→${armLfp.after[LFP]?.priceShock} · al_foil ${armBase1.after[FOIL]?.priceShock}→${armFoil.after[FOIL]?.priceShock}: ${canary3 ? "✓" : "✗ ⇒ 扰动没落上"}`);
    if (!canary1 || !canary2 || !canary3) throw new Error("金丝雀未全过，拒下结论");

    // ── 四个数（第 1 拍 amount）+ 比值 vs BOM 占比比 ─────────────────────────
    const four = {
      before_lfp: armBase1.perTick[0].lfp, before_foil: armBase1.perTick[0].foil,
      after_lfp: armLfp.perTick[0].lfp, after_foil: armFoil.perTick[0].foil,
    };
    const ratioBefore = four.before_foil !== 0 ? four.before_lfp / four.before_foil : null;
    const ratioAfter = four.after_foil !== 0 ? four.after_lfp / four.after_foil : null;
    const shareRatio = SHARE_LFP / SHARE_FOIL;
    const byteIdenticalBefore = four.before_lfp === four.before_foil;
    const byteIdenticalAfter = four.after_lfp === four.after_foil;
    // 因果格增量（旁证）：扰动臂终态 − 基线臂终态（同基快照相消，只剩该扰动的因果贡献）
    const causalLfp = (armLfp.after[M]?.costPressure ?? 0) - (armBase1.after[M]?.costPressure ?? 0);
    const causalFoil = (armFoil.after[M]?.costPressure ?? 0) - (armBase1.after[M]?.costPressure ?? 0);

    console.log("\n══ D5 四数（同一格 " + M + ".costPressure，第 1 拍 trace amount）══");
    console.log(`  改前（基线臂）  pos_lfp=${four.before_lfp}   al_foil=${four.before_foil}   比=${ratioBefore}  ${byteIdenticalBefore ? "⛔逐字节相同=没通" : "已拉开"}`);
    console.log(`  改后（+15 臂）  pos_lfp=${four.after_lfp}   al_foil=${four.after_foil}   比=${ratioAfter}  ${byteIdenticalAfter ? "⛔逐字节相同=没通" : "已拉开"}`);
    console.log(`  预言比 = 17.815/0.920 = ${shareRatio}`);
    console.log(`  旁证·因果格增量(t${TICKS})：pos_lfp ${causalLfp} · al_foil ${causalFoil} · 比=${causalFoil !== 0 ? causalLfp / causalFoil : null}`);

    const out = {
      port, model: { key: MODEL_KEY, id: M }, predictedRatio: shareRatio,
      four, ratioBefore, ratioAfter, byteIdenticalBefore, byteIdenticalAfter,
      causalCellDelta: { lfp: causalLfp, foil: causalFoil, ratio: causalFoil !== 0 ? causalLfp / causalFoil : null },
      arms: { base1: armBase1.perTick, base2: armBase2.perTick, lfp: armLfp.perTick, foil: armFoil.perTick },
      canary: { canary1, canary2, canary3, driftDiff },
    };
    const txt = JSON.stringify(out, null, 1);
    if (outPath) { fs.writeFileSync(outPath, txt); console.log(`# 已落 ${outPath}`); }
  } finally { try { process.kill(child.pid, "SIGKILL"); } catch { /* gone */ } }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
