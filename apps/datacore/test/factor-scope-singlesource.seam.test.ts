import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import { BN_FACTORS } from "../src/synthetic/battery.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-FACTOR-SCOPE-SINGLESOURCE · 因子作用域单源 SEAM 门（数据半 × 引擎半，任一半漏即红）。
 *
 * 病灶（`docs/AUDIT-factor-scope-vocab.md`）：产能页 7 个因子 chip 传 **BN 张力词表**中文名，
 * `gap_attribution scope.factorId` 认 **`CausalFactor.factorId`**，两表交集 **0**
 * ⇒ 7 个按钮返回逐字节相同的基地树，「按因子细分」一次都没生效过。
 *
 * 每条断言都是**效果层**（"树因此不同" / "屏幕上会多出本基地那几台设备的真 id"），
 * 不是运输层（"参数到达了"）—— 「请求带了 scope.factorId」证明不了任何事，那正是修前就已成立的事实。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

type Node = { id: string; factor: string; contribution: number; share?: number; path?: string[];
  provenance?: { drillType?: string; drillId?: string; drillField?: string; drillValue?: number } };
type Level = { depth: number; label: string; nodes: Node[] };
type Refinable = { factorId: string; label: string; drillType: string; drillField: string; objectCount: number };
type GaScope = { baseId?: string; factorId?: string; factorApplied?: boolean; factorLabel?: string; factorNote?: string;
  availableFactors?: Refinable[]; availableFactorsNote?: string };
type Ga = { scope?: GaScope; levels?: Level[]; reconChecks?: { ok: boolean }[]; reconciled?: boolean; causalEdges?: { from: string; to: string }[] };

const inv = async (t: TestApp, args: Record<string, unknown>): Promise<Ga> =>
  (await t.services.solvers.invoke(ADMIN, "gap_attribution", args)) as unknown as Ga;

const nodesAt = (ga: Ga, depth: number): Node[] => ga.levels?.find((L) => L.depth === depth)?.nodes ?? [];

describe("WO-FACTOR-SCOPE-SINGLESOURCE · 因子作用域单源 SEAM", () => {
  it("① 单源：availableFactors 全是真 CausalFactor.factorId，且与 BN 张力词表**零交集**（chip 不再传中文因子名）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ga = await inv(t, { scope: { baseId: "常州" } });
    const avail = ga.scope?.availableFactors ?? [];
    expect(avail.length, "本基地一个可细分因子都没有（单源列表空 = chip 无从渲染）").toBeGreaterThan(0);

    // 金丝雀（铁律 0.6）：先证工具在读真表 —— 已知必中的 factorId 必须在种子里。
    const cfIds = new Set((await t.repos.objects.listByType("demo", "CausalFactor")).map((o) => String(o.props.factorId)));
    expect(cfIds.has("cf-capacity-short"), "金丝雀不中 ⇒ 工具坏了，下面的否定结论一律不作数").toBe(true);

    // 效果层：每个下发的 factorId 都是真 CausalFactor；且**没有一个**是 BN 中文因子名。
    for (const f of avail) {
      expect(cfIds.has(f.factorId), `下发了不存在的 factorId=${f.factorId}`).toBe(true);
      expect(BN_FACTORS as readonly string[]).not.toContain(f.factorId);
      expect(f.objectCount, `${f.factorId} 下发了却 0 承载对象（= 永远不生效的按钮）`).toBeGreaterThan(0);
    }
    // 显示名仍是用户认得的 BN 因子名（值绑 id·显示绑 label）。
    expect(avail.map((f) => f.label).some((l) => (BN_FACTORS as readonly string[]).includes(l))).toBe(true);
  });

  it("② 接缝驱动（头号判据）：真因子 id → 树**与 base-only 不同**，且多出的节点下钻到本基地真对象真字段", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const baseOnly = await inv(t, { scope: { baseId: "常州" } });
    const avail = baseOnly.scope?.availableFactors ?? [];
    const pick = avail.find((f) => f.label === "设备OEE") ?? avail[0]!;

    const scoped = await inv(t, { scope: { baseId: "常州", factorId: pick.factorId } });
    expect(scoped.scope?.factorApplied, "传真因子却没细分").toBe(true);
    expect(scoped.scope?.factorLabel).toBe(pick.label);

    // 效果层 A：树真的不同（不是"参数到达了"）。
    expect(JSON.stringify(scoped.levels)).not.toBe(JSON.stringify(baseOnly.levels));
    const refine = nodesAt(scoped, 3);
    expect(refine.length, "选了因子却没有因子细分层").toBeGreaterThan(1);
    expect(nodesAt(baseOnly, 3).length, "没选因子却出现了因子细分层").toBe(0);

    // 效果层 B：L1/L2 逐字节不变（细分是**加**出来的占比层，不篡改结构分摊 → 既有断言零回归·R6）。
    expect(JSON.stringify(nodesAt(scoped, 1))).toBe(JSON.stringify(nodesAt(baseOnly, 1)));
    expect(JSON.stringify(nodesAt(scoped, 2))).toBe(JSON.stringify(nodesAt(baseOnly, 2)));
    expect(scoped.reconciled).toBe(baseOnly.reconciled);

    // 效果层 C：每个细分对象节点的 drillId 都能在**本基地**查到，且 drillField 真有值（R13·非占位）。
    const objNodes = refine.filter((n) => n.id.startsWith("capobj:"));
    expect(objNodes.length).toBeGreaterThan(0);
    const rows = (await t.repos.objects.listByType("demo", pick.drillType)).map((o) => o.props);
    for (const n of objNodes) {
      const pv = n.provenance!;
      const row = rows.find((r) => Object.values(r).some((v) => String(v) === pv.drillId));
      expect(row, `细分节点 drillId=${pv.drillId} 在 ${pick.drillType} 里查不到（占位/伪造）`).toBeTruthy();
      expect(String(row!.baseId), `细分节点落到了别的基地：${String(row!.baseId)}`).toBe("changzhou");
      expect(row![pv.drillField!], `drillField=${pv.drillField} 在真对象上不存在`).not.toBeUndefined();
      expect(pv.drillValue).toBe(row![pv.drillField!]);
    }
  });

  it("②b 换一个因子 → 树又不同（7 个按钮不再逐字节相同 —— 仓主实测的那个症状）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const avail = (await inv(t, { scope: { baseId: "常州" } })).scope?.availableFactors ?? [];
    expect(avail.length).toBeGreaterThan(1);
    const seen = new Map<string, string>();
    for (const f of avail) {
      const ga = await inv(t, { scope: { baseId: "常州", factorId: f.factorId } });
      const sig = JSON.stringify(nodesAt(ga, 3));
      const dup = [...seen.entries()].find(([, s]) => s === sig);
      expect(dup, `因子 ${f.factorId} 与 ${dup?.[0]} 返回**逐字节相同**的细分树（病灶复发）`).toBeUndefined();
      seen.set(f.factorId, sig);
    }
  });

  it("③ per-base：同一因子在不同基地 → 下钻到**不同**对象（R1「8/8 卡全同」老病不复发）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const avail = (await inv(t, { scope: { baseId: "常州" } })).scope?.availableFactors ?? [];
    const pick = avail.find((f) => f.label === "瓶颈工序") ?? avail[0]!;
    const cz = await inv(t, { scope: { baseId: "常州", factorId: pick.factorId } });
    const xy = await inv(t, { scope: { baseId: "信阳", factorId: pick.factorId } });
    const ids = (ga: Ga) => nodesAt(ga, 3).filter((n) => n.id.startsWith("capobj:")).map((n) => n.provenance?.drillId ?? "");
    expect(ids(cz).length).toBeGreaterThan(0);
    expect(ids(xy).length).toBeGreaterThan(0);
    expect(ids(cz).some((i) => ids(xy).includes(i)), "两个基地下钻到同一批对象（作用域没生效）").toBe(false);
  });

  it("④ 反向：传 BN 中文因子名（不在册）→ factorApplied=false + 基地树保住 + note 说得出是哪个词", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ga = await inv(t, { scope: { baseId: "信阳", factorId: "瓶颈工序" } });
    expect(ga.scope?.factorApplied).toBe(false);
    expect(String(ga.scope?.factorNote ?? "")).toContain("瓶颈工序");
    expect(nodesAt(ga, 1).some((n) => n.factor.includes("信阳")), "传未知因子后基地树消失了").toBe(true);
    expect(nodesAt(ga, 3).length, "未命中却出了细分层").toBe(0);
  });

  it("④b 反向：产能因子不给 baseId → 据实说「需 scope.baseId」，不假装细分", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ga = await inv(t, { scope: { factorId: "cf-cap-equipment-oee" } });
    expect(ga.scope?.factorApplied).toBe(false);
    expect(String(ga.scope?.factorNote ?? "")).toContain("scope.baseId");
  });

  it("⑤ 数据缺席据实不下发：眉山无「换型损失」承载对象（EquipmentDowntime reason=换型 实测 0 条）→ 不出现在 chip 候选里", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const dt = (await t.repos.objects.listByType("demo", "EquipmentDowntime")).map((o) => o.props);
    // 前置事实校对（数据变了这条要一起改，而不是让断言悄悄失去意义）
    expect(dt.filter((d) => String(d.baseId) === "meishan" && String(d.reason) === "换型").length).toBe(0);
    expect(dt.filter((d) => String(d.baseId) === "changzhou" && String(d.reason) === "换型").length).toBeGreaterThan(0);

    const ms = (await inv(t, { scope: { baseId: "眉山" } })).scope?.availableFactors ?? [];
    const cz = (await inv(t, { scope: { baseId: "常州" } })).scope?.availableFactors ?? [];
    expect(ms.some((f) => f.label === "换型损失"), "眉山无数据却下发了换型损失 chip（= 永远不生效的按钮）").toBe(false);
    expect(cz.some((f) => f.label === "换型损失"), "常州有数据却没下发").toBe(true);

    // 且点了也诚实：明说本基地没有承载对象，不是静默给一棵一样的树。
    const msScoped = await inv(t, { scope: { baseId: "眉山", factorId: "cf-cap-changeover-loss" } });
    expect(msScoped.scope?.factorApplied).toBe(false);
    expect(String(msScoped.scope?.factorNote ?? "")).toContain("眉山");
  });

  it("⑥ caused_by：物料齐套 → 正极粉短缺 → …（真边真节点·非编造）；其余产能因子诚实无边", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const kit = await inv(t, { scope: { baseId: "常州", factorId: "cf-cap-material-kitting" } });
    expect(kit.scope?.factorApplied).toBe(true);
    expect((kit.causalEdges ?? []).some((e) => e.from === "cf-cap-material-kitting" && e.to === "cf-cathode-shortage")).toBe(true);
    expect(nodesAt(kit, 3).some((n) => n.id === "cf:cf-decision-gap"), "5 跳链没走到终点根因").toBe(true);

    const oee = await inv(t, { scope: { baseId: "常州", factorId: "cf-cap-equipment-oee" } });
    expect(oee.causalEdges ?? []).toEqual([]); // 不编「设备OEE caused_by 上游减供」这种因果断言
  });

  /**
   * ⚠ 本例是**亲手跑真服务**（`POST /a/v1/solvers/gap_attribution/invoke`·datacore :4051·seed 42）抓出来的，
   * 上面那 8 条断言**全绿也照样漏**——它们咬的是「树不同 / 能下钻到真对象」，没有一条咬**数值是否退化**。
   * 病灶：归一底原取「本基地内最大值」，而 `Shipment` 每基地恰好 1 条 ⇒
   *   `popMin`（物料齐套）恒 `1 − v/v = 0` → 整层 contribution 全 0，界面读作"没影响"；
   *   `popMax`（物流时长）恒 `v/v = 1` → 把**整个基地缺口**都算到一条在途单上。
   * 形态（铁律 0.6 句式）：**「我用『树变了且能下钻』当作『数值算对了』的证据，而前者不度量后者。」**
   * 现在归一底改取**全网同字段最大**，本例逐因子咬"不许整层恒 0、也不许恰好等于父 gap"。
   */
  it("⑧ 数值不退化：每个因子的细分层既不整层恒 0，也不把整个基地缺口独吞（单对象归一退化门）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const baseOnly = await inv(t, { scope: { baseId: "常州" } });
    const pg = nodesAt(baseOnly, 1)[0]!.contribution;
    expect(pg).toBeGreaterThan(0);
    for (const f of baseOnly.scope?.availableFactors ?? []) {
      const ga = await inv(t, { scope: { baseId: "常州", factorId: f.factorId } });
      const head = nodesAt(ga, 3).find((n) => n.id.startsWith("capfactor:"));
      expect(head, `${f.factorId} 无因子头节点`).toBeTruthy();
      // ① 不许整层恒 0（"没影响"和"没算"在界面上分不开）。
      expect(head!.contribution, `${f.label}（${f.drillType}.${f.drillField}）细分层 contribution 恒 0 —— 单对象组内归一退化`).toBeGreaterThan(0);
      // ② 不许恰好等于父 gap（单对象 popMax 退化会把整个基地缺口算给一条记录）。
      expect(head!.contribution, `${f.label} 的因子头独吞了整个基地缺口（紧张度恒 1 = 组内归一退化）`).toBeLessThan(pg);
      // ③ 子节点份额之和 ≈ 1（份额是真分摊，不是各写各的）。
      const kids = nodesAt(ga, 3).filter((n) => n.id.startsWith("capobj:"));
      const shareSum = kids.reduce((a, n) => a + (n.share ?? 0), 0);
      expect(Math.abs(shareSum - 1), `${f.label} 子节点份额和=${shareSum}`).toBeLessThan(1e-3);
    }
  });

  it("⑦ R6 确定性：同 seed 两次调用逐字节一致", async () => {
    const t1 = await makeApp();
    await seedBattery(t1);
    const t2 = await makeApp();
    await seedBattery(t2);
    const a = await inv(t1, { scope: { baseId: "常州", factorId: "cf-cap-yield-variance" } });
    const b = await inv(t2, { scope: { baseId: "常州", factorId: "cf-cap-yield-variance" } });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
