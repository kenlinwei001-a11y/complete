import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";
import { selectEffectiveBom } from "../src/bom.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";

// 临时探针（本单收尾前删除）：只量不断言。
describe("PROBE · BOM 生效期基线", () => {
  it("六型选中的 bomId + 生效期画像 + 指纹去重 + quote_margin 四数", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const hdrs = (await t.repos.objects.listByType("demo", "BOMHeader")).map((o) => o.props);
    const dtls = (await t.repos.objects.listByType("demo", "BOMDetail")).map((o) => o.props);
    const models = [...new Set(hdrs.map((h) => String(h.modelId)))].sort();

    const asOf = String(BATTERY_SOLVER_PARAMS.forecastStart);
    console.log(`\n=== forecastStart(基准日) = ${asOf} ===`);
    console.log(`=== BOMHeader ${hdrs.length} 行 / BOMDetail ${dtls.length} 行 / 型号 ${models.length} 个 ===\n`);

    console.log("--- ① 修前：每型号 selectEffectiveBom 选中的 bomId ---");
    for (const m of models) {
      const eff = selectEffectiveBom(hdrs, dtls, m);
      console.log(`  ${m.padEnd(14)} → ${String(eff.header?.bomId)}  (headerCount=${eff.headerCount}, rows=${eff.rows.length})`);
    }

    console.log("\n--- ② 每型号全部候选 BOM 的生效期画像 ---");
    for (const m of models) {
      const mine = hdrs.filter((h) => String(h.modelId) === m).sort((a, b) => (String(a.bomId) < String(b.bomId) ? -1 : 1));
      for (const h of mine) {
        const eff = String(h.effectiveDate ?? "");
        const exp = String(h.expireDate ?? "");
        const inEffect = eff <= asOf && (exp === "" || asOf <= exp);
        console.log(
          `  ${String(h.bomId).padEnd(24)} eff=${eff.padEnd(10)} exp=${(exp || "(空)").padEnd(10)} status=${String(h.status).padEnd(3)} 基准日生效=${inEffect ? "✅" : "❌"}`,
        );
      }
    }

    console.log("\n--- ③ 明细指纹去重（判据：三版是否逐行相同）---");
    const fp = new Map<string, string[]>();
    for (const h of hdrs) {
      const bid = String(h.bomId);
      const sig = dtls
        .filter((d) => String(d.bomId) === bid)
        .sort((a, b) => Number(a.sequence) - Number(b.sequence))
        .map((d) => `${String(d.materialId)}:${Number(d.quantity)}:${Number(d.lossRate)}`)
        .join("|");
      const arr = fp.get(sig) ?? [];
      arr.push(bid);
      fp.set(sig, arr);
    }
    console.log(`  去重指纹数 = ${fp.size}（15 份 BOM）`);
    let i = 0;
    for (const [sig, bids] of fp) {
      console.log(`  [指纹${++i}] ${bids.length} 份: ${bids.sort().join(", ")}`);
      console.log(`           ${sig}`);
    }

    console.log("\n--- ④ quote_margin 金值（修前）---");
    for (const cust of ["国家电网", "宁德博世"]) {
      const r = await invokeSolver(t, "quote_margin", { custName: cust });
      if (r.statusCode !== 200) {
        console.log(`  ${cust}: HTTP ${r.statusCode}`);
        continue;
      }
      const d = r.json() as { data: { scope: { bomId: string; modelId: string }; breakdown: { bomCost: number } } };
      console.log(`  ${cust.padEnd(8)} model=${d.data.scope.modelId.padEnd(12)} bomId=${d.data.scope.bomId.padEnd(24)} bomCost=${d.data.breakdown.bomCost}`);
    }
    // 点名两个金值型号
    for (const mid of ["4680-NCM", "方形-LFP"]) {
      const r = await invokeSolver(t, "quote_margin", { custName: "国家电网", modelId: mid });
      const d = r.json() as { data: { scope: { bomId: string; modelId: string }; breakdown: { bomCost: number } } };
      console.log(`  [点名] ${mid.padEnd(12)} bomId=${String(d.data.scope.bomId).padEnd(24)} bomCost=${d.data.breakdown.bomCost}`);
    }
    expect(true).toBe(true);
  });
});
