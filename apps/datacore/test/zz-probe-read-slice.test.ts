// ⚠ 临时探针（WO-SIM-READ-SLICE）——只打印实测，不做断言门。用完即删。
import { describe, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import { selectEffectiveBom, bomRowCost } from "../src/bom.js";
import { num, str } from "../src/solvers/types.js";

describe("PROBE · 两法对照", () => {
  it("属性平铺 vs 链路遍历", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const T = async (k: string) => (await t.repos.objects.listByType("demo", k)).filter((o) => !o.mergedInto);
    const [models, versions, headers, details, materials] = await Promise.all([
      T("Model"), T("ProductVersion"), T("BOMHeader"), T("BOMDetail"), T("Material"),
    ]);
    const links = await t.repos.links.list("demo");
    const byKey = (k: string) => links.filter((l) => l.type === k);
    console.log(`\n=== 计数 ===`);
    console.log(`Model ${models.length} · ProductVersion ${versions.length} · BOMHeader ${headers.length} · BOMDetail ${details.length} · Material ${materials.length}`);
    for (const k of ["version_belongs_to_model", "bom_belongs_to_version", "detail_belongs_to_bom", "detail_uses_material"]) {
      console.log(`link ${k}: ${byKey(k).length}`);
    }
    // 🐤 金丝雀：一个确定存在的 linkKey 必须有边
    console.log(`🐤 canary link order_has_line: ${byKey("order_has_line").length}`);

    const hdrProps = headers.map((o) => o.props);
    const dtlProps = details.map((o) => o.props);
    const priceByMatKey = new Map(materials.map((o) => [str(o.props.matId) || str(o.objectKey), num(o.props.unitPrice)]));

    // 链路索引
    const verToModel = new Map<string, string>();
    for (const l of byKey("version_belongs_to_model")) verToModel.set(l.fromId, l.toId);
    const hdrToVer = new Map<string, string>();
    for (const l of byKey("bom_belongs_to_version")) hdrToVer.set(l.fromId, l.toId);
    const dtlToHdr = new Map<string, string>();
    for (const l of byKey("detail_belongs_to_bom")) dtlToHdr.set(l.fromId, l.toId);
    const dtlToMat = new Map<string, string>();
    for (const l of byKey("detail_uses_material")) dtlToMat.set(l.fromId, l.toId);

    const hdrById = new Map(headers.map((o) => [o.id, o]));
    const matById = new Map(materials.map((o) => [o.id, o]));

    console.log(`\n=== 逐型号：属性法 vs 链路法 ===`);
    for (const m of models.sort((a, b) => a.id.localeCompare(b.id))) {
      const modelKey = str(m.props.modelId) || str(m.objectKey);
      // (a) 属性法
      const eff = selectEffectiveBom(hdrProps, dtlProps, modelKey);
      const effBomId = eff.header ? str(eff.header.bomId) : null;
      // (b) 链路法：Model ←version_belongs_to_model― PV ←bom_belongs_to_version― BOMHeader
      const myVers = [...verToModel.entries()].filter(([, mid]) => mid === m.id).map(([vid]) => vid);
      const myHdrs = [...hdrToVer.entries()].filter(([, vid]) => myVers.includes(vid)).map(([hid]) => hid);
      const chainBomIds = myHdrs.map((h) => str(hdrById.get(h)?.props.bomId)).sort();
      // 属性法说这个型号有几份头
      const attrBomIds = hdrProps.filter((h) => str(h.modelId) === modelKey).map((h) => str(h.bomId)).sort();
      console.log(
        `${modelKey.padEnd(12)} | 属性法选中 ${String(effBomId).padEnd(14)} (候选 ${attrBomIds.length}: ${attrBomIds.join(",")}) | 链路法可达 ${chainBomIds.length}: ${chainBomIds.join(",")}`,
      );
    }

    // 逐 BOMHeader 的 status / version 详情
    console.log(`\n=== BOMHeader 明细 ===`);
    for (const h of headers.sort((a, b) => str(a.props.bomId).localeCompare(str(b.props.bomId)))) {
      const vid = hdrToVer.get(h.id);
      const ver = versions.find((v) => v.id === vid);
      console.log(
        `${str(h.props.bomId).padEnd(14)} model=${str(h.props.modelId).padEnd(12)} status=${str(h.props.status).padEnd(6)} → PV ${ver ? str(ver.props.versionCode) : "（无链路）"} status=${ver ? str(ver.props.status) : "-"}`,
      );
    }

    // 逐 BOMDetail 的归属：属性 bomId vs 链路 detail_belongs_to_bom
    let dtlAgree = 0, dtlDisagree = 0, dtlNoLink = 0;
    for (const d of details) {
      const hid = dtlToHdr.get(d.id);
      if (!hid) { dtlNoLink += 1; continue; }
      const linkBomId = str(hdrById.get(hid)?.props.bomId);
      if (linkBomId === str(d.props.bomId)) dtlAgree += 1; else dtlDisagree += 1;
    }
    console.log(`\n=== BOMDetail 归属：属性 bomId vs 链路 detail_belongs_to_bom ===`);
    console.log(`一致 ${dtlAgree} · 不一致 ${dtlDisagree} · 无链路 ${dtlNoLink} （共 ${details.length}）`);

    // 逐 BOMDetail 的物料：属性 materialId vs 链路 detail_uses_material
    let matAgree = 0, matDisagree = 0, matNoLink = 0;
    for (const d of details) {
      const mid = dtlToMat.get(d.id);
      if (!mid) { matNoLink += 1; continue; }
      const linkMatKey = str(matById.get(mid)?.props.matId) || str(matById.get(mid)?.objectKey);
      if (linkMatKey === str(d.props.materialId)) matAgree += 1; else matDisagree += 1;
    }
    console.log(`=== BOMDetail→Material：属性 materialId vs 链路 detail_uses_material ===`);
    console.log(`一致 ${matAgree} · 不一致 ${matDisagree} · 无链路 ${matNoLink} （共 ${details.length}）`);

    // 方形-LFP 上两个样例物料的占比（判据 2 的基线）
    console.log(`\n=== 方形-LFP BOM 成本占比（判据 2 基线）===`);
    const eff = selectEffectiveBom(hdrProps, dtlProps, "方形-LFP");
    if (eff.header) {
      let total = 0;
      const rows: { mat: string; cost: number }[] = [];
      for (const r of eff.rows) {
        const c = bomRowCost(r, (mk) => priceByMatKey.get(mk) ?? 0);
        total += c;
        rows.push({ mat: str(r.materialId), cost: c });
      }
      console.log(`bomId=${str(eff.header.bomId)} total=${total}`);
      for (const r of rows.sort((a, b) => b.cost - a.cost)) {
        console.log(`  ${r.mat.padEnd(20)} cost=${r.cost} share=${(r.cost / total * 100).toFixed(6)}%`);
      }
    }

    // 传导规则声明：哪些边用了 weightRef
    const rules = await t.repos.sim.listPropagationRules("demo", false).catch(() => []);
    console.log(`\n=== 传导规则（本次未播 seedDemoPropagationRules，应为 0）: ${rules.length} ===`);
  }, 180_000);
});
