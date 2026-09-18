// ⚠ 临时探针（WO-SIM-READ-SLICE）——只打印实测，不做断言门。用完即删。
import { describe, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import { selectEffectiveBom, bomRowCost } from "../src/bom.js";
import { num, str } from "../src/solvers/types.js";

describe("PROBE · 两法对照", () => {
  it("判据1 分叉清单：属性 join vs 链路遍历", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const T = async (k: string) => (await t.repos.objects.listByType("demo", k)).filter((o) => !o.mergedInto);
    const [models, headers, details, materials] = await Promise.all([
      T("Model"), T("BOMHeader"), T("BOMDetail"), T("Material"),
    ]);
    const links = await t.repos.links.list("demo");
    const byKey = (k: string) => links.filter((l) => l.type === k);
    // 🐤 金丝雀：确定存在的 linkKey 必须有边；全 0 ⇒ 量法坏了而不是"图上没有"
    console.log(`🐤 canary order_has_line=${byKey("order_has_line").length} material_used_by_model=${byKey("material_used_by_model").length}`);

    const hdrProps = headers.map((o) => o.props);
    const dtlProps = details.map((o) => o.props);
    const priceByMatKey = new Map(materials.map((o) => [str(o.props.matId) || str(o.objectKey), num(o.props.unitPrice)]));
    const priceByObjId = new Map(materials.map((o) => [o.id, num(o.props.unitPrice)]));
    const matKeyOf = new Map(materials.map((o) => [o.id, str(o.props.matId) || str(o.objectKey)]));
    const modelKeyOf = new Map(models.map((o) => [o.id, str(o.props.modelId) || str(o.objectKey)]));

    // 链路索引（全部按 **对象 id**，零字符串 join）
    const verToModel = new Map<string, string>();
    for (const l of byKey("version_belongs_to_model")) verToModel.set(l.fromId, l.toId);
    const hdrToVer = new Map<string, string>();
    for (const l of byKey("bom_belongs_to_version")) hdrToVer.set(l.fromId, l.toId);
    const dtlToHdr = new Map<string, string>();
    for (const l of byKey("detail_belongs_to_bom")) dtlToHdr.set(l.fromId, l.toId);
    const dtlToMat = new Map<string, string>();
    for (const l of byKey("detail_uses_material")) dtlToMat.set(l.fromId, l.toId);
    const hdrById = new Map(headers.map((o) => [o.id, o]));
    const dtlByHdr = new Map<string, typeof details>();
    for (const d of details) {
      const h = dtlToHdr.get(d.id);
      if (!h) continue;
      (dtlByHdr.get(h) ?? dtlByHdr.set(h, []).get(h)!).push(d);
    }

    /** 链路法：从 Model 对象 id 出发走 4 跳，返回 (Material objId → cost) + total + bomId。 */
    const chainBom = (modelObjId: string) => {
      const vers = [...verToModel.entries()].filter(([, m]) => m === modelObjId).map(([v]) => v);
      const hdrs = [...hdrToVer.entries()].filter(([, v]) => vers.includes(v)).map(([h]) => h);
      // 生效选取：复用 bom.ts 那一支（唯一判据），但**候选集来自图**而非属性匹配
      const reachableProps = hdrs.map((h) => hdrById.get(h)!.props);
      const eff = selectEffectiveBom(reachableProps, dtlProps, modelKeyOf.get(modelObjId) ?? "");
      const effHdrObj = hdrs.find((h) => str(hdrById.get(h)!.props.bomId) === str(eff.header?.bomId));
      const row = new Map<string, number>();
      let total = 0;
      for (const d of effHdrObj ? (dtlByHdr.get(effHdrObj) ?? []) : []) {
        const matObj = dtlToMat.get(d.id);
        const price = matObj ? priceByObjId.get(matObj) ?? 0 : 0;
        const c = bomRowCost(d.props, () => price);
        total += c;
        if (matObj) row.set(matObj, (row.get(matObj) ?? 0) + c);
      }
      return { row, total, bomId: eff.header ? str(eff.header.bomId) : null, reachableHdrs: hdrs.length };
    };

    /** 属性法：今天 pair-weights.ts 走的那一支（逐字搬过来）。 */
    const attrBom = (modelObjId: string) => {
      const { header, rows } = selectEffectiveBom(hdrProps, dtlProps, modelKeyOf.get(modelObjId) ?? "");
      const row = new Map<string, number>();
      let total = 0;
      for (const r of rows) {
        const c = bomRowCost(r, (mk) => priceByMatKey.get(mk) ?? 0);
        const k = str(r.materialId);
        row.set(k, (row.get(k) ?? 0) + c);
        total += c;
      }
      return { row, total, bomId: header ? str(header.bomId) : null };
    };

    console.log(`\n=== 判据 1：逐 (Material, Model) 对，两法权重对照 ===`);
    let same = 0, diff = 0;
    const diffs: string[] = [];
    for (const e of byKey("material_used_by_model").sort((a, b) => a.fromId.localeCompare(b.fromId) || a.toId.localeCompare(b.toId))) {
      const a = attrBom(e.toId), c = chainBom(e.toId);
      const mk = matKeyOf.get(e.fromId) ?? "";
      const wA = a.total > 0 ? (a.row.get(mk) ?? 0) / a.total : 0;
      const wC = c.total > 0 ? (c.row.get(e.fromId) ?? 0) / c.total : 0;
      if (wA === wC) same += 1;
      else { diff += 1; diffs.push(`${mk} → ${modelKeyOf.get(e.toId)}  属性=${wA}  链路=${wC}  Δ=${wC - wA}`); }
    }
    console.log(`逐位相同 ${same} 对 · 不同 ${diff} 对（共 ${byKey("material_used_by_model").length} 对）`);
    for (const d of diffs) console.log(`  ⚠ ${d}`);

    console.log(`\n=== 逐型号 total / bomId 对照 ===`);
    for (const m of models.sort((a, b) => str(a.props.modelId).localeCompare(str(b.props.modelId)))) {
      const a = attrBom(m.id), c = chainBom(m.id);
      console.log(
        `${str(m.props.modelId).padEnd(12)} 属性 bom=${String(a.bomId).padEnd(16)} total=${a.total}` +
        ` | 链路 bom=${String(c.bomId).padEnd(16)} total=${c.total} 可达头数=${c.reachableHdrs} | ${a.total === c.total && a.bomId === c.bomId ? "✅同" : "⚠️异"}`,
      );
    }

    // ── 若**去掉生效选取**、把可达的 2–3 份 BOM 全池化，会差多少（说明选取规则不可省）──
    console.log(`\n=== 反证：去掉「生效选取」改为池化全部可达 BOM 的后果 ===`);
    for (const m of models.sort((a, b) => str(a.props.modelId).localeCompare(str(b.props.modelId)))) {
      const vers = [...verToModel.entries()].filter(([, mm]) => mm === m.id).map(([v]) => v);
      const hdrs = [...hdrToVer.entries()].filter(([, v]) => vers.includes(v)).map(([h]) => h);
      let total = 0; const row = new Map<string, number>();
      for (const h of hdrs) for (const d of dtlByHdr.get(h) ?? []) {
        const mo = dtlToMat.get(d.id); const price = mo ? priceByObjId.get(mo) ?? 0 : 0;
        const c = bomRowCost(d.props, () => price); total += c; if (mo) row.set(mo, (row.get(mo) ?? 0) + c);
      }
      const eff = chainBom(m.id);
      const pos = [...row.keys()].find((k) => matKeyOf.get(k) === "pos_lfp" || matKeyOf.get(k) === "pos_ncm");
      const wPool = pos && total > 0 ? (row.get(pos) ?? 0) / total : 0;
      const wEff = pos && eff.total > 0 ? (eff.row.get(pos) ?? 0) / eff.total : 0;
      console.log(`${str(m.props.modelId).padEnd(12)} 正极占比 生效BOM=${wEff.toFixed(9)} 池化全部=${wPool.toFixed(9)} 差=${((wPool - wEff) / (wEff || 1) * 100).toFixed(2)}%`);
    }

    // ── material_used_by_model 边 vs BOM 实际用料（配对是否一致）──
    console.log(`\n=== material_used_by_model 边 vs BOM 明细实际用料 ===`);
    for (const m of models.sort((a, b) => str(a.props.modelId).localeCompare(str(b.props.modelId)))) {
      const edgeMats = new Set(byKey("material_used_by_model").filter((l) => l.toId === m.id).map((l) => l.fromId));
      const bomMats = new Set(chainBom(m.id).row.keys());
      const onlyEdge = [...edgeMats].filter((x) => !bomMats.has(x)).map((x) => matKeyOf.get(x));
      const onlyBom = [...bomMats].filter((x) => !edgeMats.has(x)).map((x) => matKeyOf.get(x));
      console.log(`${str(m.props.modelId).padEnd(12)} 边=${edgeMats.size} BOM=${bomMats.size} 仅边有=[${onlyEdge.join(",")}] 仅BOM有=[${onlyBom.join(",")}]`);
    }
  }, 180_000);
});
