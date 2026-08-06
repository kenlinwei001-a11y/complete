/** 临时探针（本单结束前删除）：普查 provenance 三元组的可解析性分类，量化「哑门」洞口。 */
import { describe, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

type Prov = { kind?: string; drillType?: string; drillId?: string; drillField?: string; drillValue?: unknown };

/** 深走任意输出，收集所有 provenance 对象。 */
function collectProv(root: unknown, out: { path: string; pv: Prov }[] = [], path = "$"): { path: string; pv: Prov }[] {
  if (root === null || typeof root !== "object") return out;
  if (Array.isArray(root)) {
    root.forEach((v, i) => collectProv(v, out, `${path}[${i}]`));
    return out;
  }
  const rec = root as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    if (k === "provenance" && v && typeof v === "object" && !Array.isArray(v)) {
      out.push({ path: `${path}.${k}`, pv: v as Prov });
    }
    collectProv(v, out, `${path}.${k}`);
  }
  return out;
}

describe("PROV CENSUS PROBE", () => {
  it("census", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);

    const types = await t.services.ontology.listTypes(ADMIN);
    const typeByKey = new Map(types.map((x) => [x.key, x]));
    const objCache = new Map<string, Record<string, unknown>[]>();
    const rowsOf = async (tk: string) => {
      if (!objCache.has(tk)) objCache.set(tk, (await t.repos.objects.listByType(ADMIN.tenantId, tk)).map((o) => o.props));
      return objCache.get(tk)!;
    };

    const runs: { tag: string; out: unknown }[] = [];
    const tryRun = async (tag: string, key: string, args: Record<string, unknown>) => {
      try {
        runs.push({ tag, out: await t.services.solvers.invoke(ADMIN, key, args) });
      } catch (e) {
        runs.push({ tag: `${tag} [THREW ${(e as Error).message}]`, out: null });
      }
    };
    await tryRun("gap_attribution/global", "gap_attribution", { metricKey: "seg_attain_ess" });
    await tryRun("gap_attribution/hefei", "gap_attribution", { metricKey: "seg_attain_ess", scope: { baseId: "hefei" } });
    await tryRun("gap_attribution/xiamen", "gap_attribution", { metricKey: "seg_attain_ess", scope: { baseId: "xiamen" } });
    await tryRun("gap_attribution/market_share", "gap_attribution", { metricKey: "market_share" });
    await tryRun("gap_attribution/cash", "gap_attribution", { metricKey: "cash" });
    await tryRun("gap_attribution/revenue", "gap_attribution", { metricKey: "revenue" });
    await tryRun("gap_attribution/gross_profit", "gap_attribution", { metricKey: "gross_profit" });
    await tryRun("gap_attribution/demand_attain", "gap_attribution", { metricKey: "demand_attain" });

    const tally: Record<string, number> = {};
    const samples: Record<string, string[]> = {};
    const byKey: Record<string, true> = {};
    let cur = "?";
    const note = (cls: string, msg: string) => {
      tally[cls] = (tally[cls] ?? 0) + 1;
      byKey[`${cls.padEnd(24)} ${cur}`] = true;
      (samples[cls] ??= []).length < 8 && samples[cls].push(msg);
    };

    for (const r of runs) {
      const found = collectProv(r.out);
      console.log(`\n### ${r.tag}: ${found.length} provenance 节点`);
      for (const { pv } of found) {
        const { drillType: dt, drillId: di, drillField: df } = pv;
        const label = `${r.tag} ${dt}.${di}.${df}=${JSON.stringify(pv.drillValue)}`;
        cur = `${dt}.${df}`;
        if (!dt) { note("A_NO_TYPE", label); continue; }
        const ty = typeByKey.get(dt);
        if (!ty) { note("B_PHANTOM_TYPE", label); continue; }
        const declared = new Set([
          ...ty.properties.map((p) => p.propKey),
          ...((ty as { derivedProperties?: { propKey: string }[] }).derivedProperties ?? []).map((p) => p.propKey),
        ]);
        if (df && !declared.has(df)) { note("C_PHANTOM_FIELD", `${label}  [类型 ${dt} 声明字段: ${[...declared].slice(0, 14).join(",")}]`); continue; }
        const pk = ty.properties.find((p) => p.isPrimaryKey)?.propKey;
        if (!pk) { note("D_NO_PK", label); continue; }
        if (di === "*") { note("E_AGGREGATE_STAR", label); continue; }
        const rows = await rowsOf(dt);
        const row = rows.find((x) => String(x[pk]) === String(di));
        if (!row) { note("F_DANGLING_ID", `${label}  [pk=${pk} 现有 id 样例: ${rows.slice(0, 4).map((x) => String(x[pk])).join(",")}]`); continue; }
        const truth = row[df!];
        if (typeof truth !== "number") { note("G_NON_NUMERIC_TRUTH", `${label} truth=${JSON.stringify(truth)}`); continue; }
        if (typeof pv.drillValue !== "number") { note("H_NON_NUMERIC_DRILLVALUE", `${label} truth=${truth}`); continue; }
        if (pv.drillValue !== truth) { note("I_MISMATCH", `${label} truth=${truth}`); continue; }
        note("Z_OK", label);
      }
    }
    for (const r of runs) if (/revenue|gross_profit/.test(r.tag)) console.log(`\n@@@ ${r.tag} =>`, JSON.stringify(r.out).slice(0, 1200));
    console.log("\n===== 聚合包络（min / max / Σ）=====");
    for (const [tk, fk] of [["Order", "value"], ["Equipment", "oee_current"], ["MaterialBalance", "gapTon"]] as const) {
      const vals = (await rowsOf(tk)).map((r) => r[fk]).filter((v): v is number => typeof v === "number");
      if (!vals.length) { console.log(`${tk}.${fk}: 无数值`); continue; }
      const sum = vals.reduce((a, b) => a + b, 0);
      console.log(`${tk}.${fk}: n=${vals.length} min=${Math.min(...vals)} max=${Math.max(...vals)} Σ=${sum}  [Σ/1e4=${sum / 1e4}]`);
    }
    console.log("\n===== 分类统计 =====");
    for (const k of Object.keys(tally).sort()) console.log(`${k}: ${tally[k]}`);
    console.log("\n===== 按 类型.字段 × 分类 =====");
    for (const k of Object.keys(byKey).sort()) console.log(`${k}`);
    console.log("\n===== 样例 =====");
    for (const k of Object.keys(samples).sort()) {
      if (k === "Z_OK") continue;
      console.log(`\n-- ${k} --`);
      for (const s of samples[k]) console.log(`   ${s}`);
    }
  }, 600_000);
});
