import { describe, expect, it } from "vitest";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-DYNAMIC-DRILL-RESOLVE · `DYNAMIC-*` 占位**查询期解析** SEAM（数据半 × 引擎半 · 端到端走 HTTP）。
 *
 * ══ 咬的接缝 ═══════════════════════════════════════════════════════════════════
 *  · **数据半** = `synthetic/battery-extended.ts`：`cf-material-short` / `cf-capacity-short` 的
 *    `drillId` 必须**仍是占位**（`DYNAMIC-MBAL` / `DYNAMIC-EQUIP`）且自带 `drillPick` ——
 *    播种期一旦把它解析掉，通配性当场丢失（本单前实测：7 张 `MaterialBalance` 落点只有 1 张对得上因子）。
 *  · **引擎半** = `solvers/dynamic-drill.ts` + `solvers/service.ts`：占位在**查询期**、
 *    按**当时的上下文**解析成实例（落点期 = 这一张阻滞点自己；归因期 = 全量世界态按 `drillPick` 挑）。
 *  任一半漏 ⇒ 本文件红。两半各自绿证明不了它。
 *
 * ══ 头号断言（本单验收线）═════════════════════════════════════════════════════
 * 不是「对上率涨了」，而是 **「对上的那条因子，解析出的实例就是这条阻滞点的那一张」** ——
 * 而且那一张上的读数必须与库里真对象**逐位相等**（DR-2）。只咬对上率的话，
 * 把 `resolvedDrillId` 恒设成 `mbal-1` 也能全绿。
 *
 * ══ 变异反证注入点（交付说明贴 RC 原文）═════════════════════════════════════════
 *  ㈠ 把播种期解析加回去（`causalFactors = CAUSAL_FACTORS.map(...)`）→ DR-0 / DR-1 / DR-2 全红；
 *  ㈡ `resolvedDrillId` 恒返回候选池首条 → DR-2 红（读数与本落点对不上）；
 *  ㈢ 把 `precision` 在解析成功时升成 `EXACT` → DR-3 红（三档塌成两档 = 换马甲的静默回落）；
 *  ㈣ 归因期改用「候选池首条」而不是 `drillPick` → DR-4 红。
 */

interface LocusJoin {
  status: "JOINED" | "NO_FACTOR";
  precision: "EXACT" | "TYPE" | "NONE";
  factorId: string | null;
  drillField: string | null;
  drillIdDeclared: string | null;
  resolvedDrillId: string | null;
  resolvedDrillValue: number | null;
  resolveBasis: string | null;
  basis: string;
  candidateFactorCount: number;
}
interface DecisionPlayOut {
  rootCause: { factorId: string } | null;
  options: { optionId: string }[];
  locusPlay?: { locus: { objectType: string; objectId: string }; join: LocusJoin };
}

async function invoke(t: TestApp, key: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await t.app.inject({ method: "POST", url: `/a/v1/solvers/${key}/invoke`, headers: ADMIN, payload: { args } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as Record<string, unknown>;
}

/** 本次扫描的全部落点（**现取**，不抄常量）。 */
async function lociOf(t: TestApp): Promise<{ objectType: string; objectId: string }[]> {
  const s = await invoke(t, "chain_impediments", {});
  const imps = s.impediments as { locus: { objectType: string; objectId: string } }[];
  const seen = new Set<string>();
  return imps.map((i) => i.locus).filter((l) => {
    const k = `${l.objectType}/${l.objectId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const joinOf = async (t: TestApp, l: { objectType: string; objectId: string }): Promise<LocusJoin> => {
  const out = (await invoke(t, "decision_play", { locusType: l.objectType, locusId: l.objectId })) as unknown as DecisionPlayOut;
  return out.locusPlay!.join;
};

describe("WO-DYNAMIC-DRILL-RESOLVE · DYNAMIC-* 占位查询期解析 SEAM", () => {
  it("DR-0 金丝雀 · 数据半：种子里 DYNAMIC-* 仍是占位且自带挑选口径（播种期解析即红）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const factors = (await t.repos.objects.listByType("demo", "CausalFactor")).map((o) => o.props);
    // 金丝雀先自证读取器是好的：一个我确定存在、且 drillId 本来就是具体值的因子必须读得到。
    const anchor = factors.find((f) => f.factorId === "cf-demand-attain-gap");
    expect(anchor, "连 cf-demand-attain-gap 都读不到 ⇒ 读取器坏了，不是种子空了").toBeDefined();
    expect(anchor!.drillId, "金丝雀因子本来就该是具体 id").toBe("mbal-2");

    const mat = factors.find((f) => f.factorId === "cf-material-short");
    expect(mat, "种子里没有 cf-material-short ⇒ 数据半没落地").toBeDefined();
    expect(mat!.drillId, "播种期把 DYNAMIC-MBAL 解析掉了 ⇒ 通配性丢失，5 张 mbal 落点又会对不上").toBe("DYNAMIC-MBAL");
    expect(mat!.drillPick, "占位必须自带挑选口径（否则引擎只能靠 if 链猜，就是第二套词表）").toBe("max");

    const cap = factors.find((f) => f.factorId === "cf-capacity-short");
    expect(cap!.drillId).toBe("DYNAMIC-EQUIP");
    expect(cap!.drillPick).toBe("min");
  });

  it("DR-1 · **对上率**：本次全部落点都能对上因子，且 MaterialBalance 那一族一条不落", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const loci = await lociOf(t);
    expect(loci.length, "一条阻滞点都没有 ⇒ 数据源坏了，不是 join 坏了").toBeGreaterThan(0);
    const mbals = loci.filter((l) => l.objectType === "MaterialBalance");
    // 金丝雀：本次真的有多张 MaterialBalance 落点，否则「一条不落」是恒真。
    expect(mbals.length, "本次 MaterialBalance 落点少于 2 张 ⇒ 本用例空跑").toBeGreaterThanOrEqual(2);

    const joins = await Promise.all(loci.map((l) => joinOf(t, l)));
    const noFactor = loci.filter((_, i) => joins[i]!.status === "NO_FACTOR");
    expect(noFactor.map((l) => `${l.objectType}/${l.objectId}`), "仍有落点对不上因子").toEqual([]);

    // MaterialBalance 一族：每一张都必须由 cf-material-short（那个占位因子）以 TYPE 精度接住，
    // 或由某条**指名了这一张**的因子以 EXACT 精度接住 —— 不许出现「无因子」。
    for (const l of mbals) {
      const j = joins[loci.indexOf(l)]!;
      expect(j.status, `${l.objectId} 无因子`).toBe("JOINED");
      if (j.precision === "TYPE") expect(j.factorId).toBe("cf-material-short");
    }
  }, 180000);

  it("DR-2 · **头号判据**：TYPE 档解析出的实例 == 这条落点自己的那一张，且读数与库里真对象逐位相等", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const loci = await lociOf(t);
    const typeJoined: { locus: { objectType: string; objectId: string }; join: LocusJoin }[] = [];
    for (const l of loci) {
      const j = await joinOf(t, l);
      if (j.precision === "TYPE") typeJoined.push({ locus: l, join: j });
    }
    expect(typeJoined.length, "本次没有任何 TYPE 档 join ⇒ 本用例空跑").toBeGreaterThanOrEqual(5);

    // 真库现读（期望值不写死，随种子演进自动跟着变）。
    const pk: Record<string, string> = { MaterialBalance: "matBalId", MaterialBatch: "batchId", Base: "baseId", Line: "lineId", Equipment: "equipId" };
    for (const { locus, join } of typeJoined) {
      // ① 声明的是占位（这才叫 TYPE）。
      expect(join.drillIdDeclared === "*" || String(join.drillIdDeclared).startsWith("DYNAMIC"), `${locus.objectId}: drillIdDeclared 不是占位`).toBe(true);
      // ② 解析出来的**就是这条阻滞点的那一张**（不是"缺口最大的那张"，也不是候选池首条）。
      expect(join.resolvedDrillId, `${locus.objectType}/${locus.objectId} 的占位没解析出实例`).toBe(locus.objectId);
      // ③ 读数与库里那一张**逐位相等** —— 只咬 id 相等的话，回带 `locusId` 也能全绿。
      const rows = (await t.repos.objects.listByType("demo", locus.objectType)).map((o) => o.props);
      const row = rows.find((r) => String(r[pk[locus.objectType] ?? "id"]) === locus.objectId);
      expect(row, `${locus.objectType}/${locus.objectId} 在库里不存在`).toBeDefined();
      expect(join.resolvedDrillValue).toBe(row![String(join.drillField)]);
      // ④ 解析口径原文必须在，读者据此知道这一张是**怎么**被挑出来的。
      expect(join.resolveBasis).toContain(locus.objectId);
    }
  }, 300000);

  it("DR-3 · **三档禁塌**：EXACT / TYPE / NONE 三态在同一次种子上同时可复现，且 TYPE 不冒充 EXACT", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const loci = await lociOf(t);

    // EXACT：某条因子**指名**了这一张（cf-cathode-shortage / cf-demand-attain-gap 都指 mbal-2）。
    const exactLocus = loci.find((l) => l.objectType === "MaterialBalance" && l.objectId === "mbal-2");
    expect(exactLocus, "本次没有 mbal-2 落点 ⇒ EXACT 档无从复现").toBeDefined();
    const jExact = await joinOf(t, exactLocus!);
    expect(jExact.precision).toBe("EXACT");
    expect(jExact.drillIdDeclared).toBe("mbal-2");
    // EXACT 档不需要解析，三个解析键必须是 null（不许拿解析结果去伪装"更精确"）。
    expect(jExact.resolvedDrillId).toBeNull();
    expect(jExact.resolvedDrillValue).toBeNull();

    // TYPE：占位接住的那一张（本次取 mbal-1 —— 它修前是 EXACT，修后诚实降为 TYPE：
    // 因子讲的是"物料短缺这一类"，它只是恰好被播种期选中，那不叫"这一张自己的因子"）。
    const typeLocus = loci.find((l) => l.objectType === "MaterialBalance" && l.objectId !== "mbal-2");
    expect(typeLocus, "本次没有非 mbal-2 的 MaterialBalance 落点 ⇒ TYPE 档无从复现").toBeDefined();
    const jType = await joinOf(t, typeLocus!);
    expect(jType.precision, "解析出了实例就升成 EXACT = 换个马甲的静默回落").toBe("TYPE");
    expect(jType.basis).toContain("按类型聚合");
    expect(jType.basis).toContain("不是这一张");

    // NONE：库里没有这个 drillType ⇒ 诚实空，绝不回落默认根因。
    const jNone = await joinOf(t, { objectType: "NoSuchObjectType", objectId: "nope" });
    expect(jNone.status).toBe("NO_FACTOR");
    expect(jNone.precision).toBe("NONE");
    expect(jNone.resolvedDrillId).toBeNull();
    expect(jNone.basis).toContain("不回落");
  }, 180000);

  it("DR-4 · 归因期解析走的是**因子自己声明的 drillPick**（不是候选池首条），且 R6 两跑字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g1 = await invoke(t, "gap_attribution", { metricKey: "demand_attain" });
    const g2 = await invoke(t, "gap_attribution", { metricKey: "demand_attain" });
    expect(JSON.stringify(g1), "同输入两跑不字节一致 ⇒ 解析引入了非确定性").toBe(JSON.stringify(g2));

    const leaves = g1.atomicLeaves as { id: string; provenance: Record<string, unknown> }[];
    const capLeaf = leaves.find((l) => l.id === "cf:cf-capacity-short");
    const matLeaf = leaves.find((l) => l.id === "cf:cf-material-short");
    expect(capLeaf, "demand_attain 树里没有 cf-capacity-short ⇒ 本用例空跑").toBeDefined();
    expect(matLeaf, "demand_attain 树里没有 cf-material-short ⇒ 本用例空跑").toBeDefined();

    // 声明原文必须留着（读者要能分辨"指名的"与"现挑的"）。
    expect(capLeaf!.provenance.drillIdDeclared).toBe("DYNAMIC-EQUIP");
    expect(matLeaf!.provenance.drillIdDeclared).toBe("DYNAMIC-MBAL");

    // 期望值**现算**：drillPick=min → oee_current 真最低那台；drillPick=max → gapTon 真最大那张。
    const equipment = (await t.repos.objects.listByType("demo", "Equipment")).map((o) => o.props);
    const worstEq = equipment
      .filter((o) => typeof o.oee_current === "number")
      .sort((a, b) => (a.oee_current as number) - (b.oee_current as number) || String(a.equipId).localeCompare(String(b.equipId)))[0]!;
    expect(equipment.length, "设备为 0 ⇒ 断言退化成恒真").toBeGreaterThan(1);
    expect(capLeaf!.provenance.drillId).toBe(String(worstEq.equipId));
    expect(capLeaf!.provenance.drillValue).toBe(worstEq.oee_current);
    expect(capLeaf!.provenance.drillCandidateCount).toBe(equipment.filter((o) => typeof o.oee_current === "number").length);

    const mbals = (await t.repos.objects.listByType("demo", "MaterialBalance")).map((o) => o.props);
    const worstMb = mbals
      .filter((o) => typeof o.gapTon === "number")
      .sort((a, b) => (b.gapTon as number) - (a.gapTon as number) || String(a.matBalId).localeCompare(String(b.matBalId)))[0]!;
    expect(mbals.length, "平衡表为 0 ⇒ 断言退化成恒真").toBeGreaterThan(1);
    expect(matLeaf!.provenance.drillId).toBe(String(worstMb.matBalId));
    expect(matLeaf!.provenance.drillValue).toBe(worstMb.gapTon);

    // 反证「不是候选池首条」：min 挑出来的那台，必须**不是** listByType 的首条（否则本断言恒真）。
    expect(String(worstEq.equipId), "真最差的恰是首条 ⇒ 本反证退化，需换承载物").not.toBe(String(equipment[0]!.equipId));
  }, 180000);

  it("DR-5 · 归因期占位解析**只连坐 demand_attain 一个域**（其余指标域产物逐字节不变的结构理由）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 结构理由不是"我看了觉得没变"，而是：动态因子只有两条，且两条都只被 cf-demand-attain-gap 的
    // caused_by 边指到 ⇒ 其他域的遍历集里根本到不了它们。这里把这个前提**咬死**。
    const factors = (await t.repos.objects.listByType("demo", "CausalFactor")).map((o) => o.props);
    const dynamic = factors.filter((f) => {
      const d = String(f.drillId);
      return d === "*" || d.startsWith("DYNAMIC");
    });
    expect(dynamic.length, "一条占位因子都没有 ⇒ 金丝雀不中，扫描器坏了").toBeGreaterThan(0);
    const dynInAttrTree = dynamic.filter((f) => String(f.drillId).startsWith("DYNAMIC"));
    expect(dynInAttrTree.map((f) => String(f.factorId)).sort()).toEqual(["cf-capacity-short", "cf-material-short"]);
    expect(new Set(dynInAttrTree.map((f) => String(f.metricKey)))).toEqual(new Set(["demand_attain"]));

    // 其余带 `*` 的占位因子一律不带 baseScopeField 之外的归因入口：它们的 metricKey 要么是
    // capacity（产能域·走 resolveCapacityFactorObjects 另一条路），要么是 chain_flow（无 Metric·不进任何树）。
    for (const f of dynamic.filter((x) => String(x.drillId) === "*")) {
      expect(["capacity", "chain_flow"], `占位因子 ${f.factorId} 的 metricKey 越界了`).toContain(String(f.metricKey));
    }

    // 效果层：另一个域的归因产物里，一条动态解析标记都不该出现。
    const other = await invoke(t, "gap_attribution", { metricKey: "cash" });
    expect(JSON.stringify(other)).not.toContain("drillIdDeclared");
  }, 120000);
});
