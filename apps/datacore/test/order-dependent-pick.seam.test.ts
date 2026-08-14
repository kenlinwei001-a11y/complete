import { beforeEach, describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx, ObjectInstance } from "../src/domain.js";

/**
 * WO-ORDER-DEPENDENT-PICK · **接缝门**：凡「屏上那个对象是谁」的选择，判据必须是**语义**，不是**数组下标**。
 *
 * ══ 病的形态（同族已修一例：WO-LTA-EVIDENCE-CONFLICT）══════════════════════════════
 * `xs.find(pred)` / `xs.filter(pred).sort(按 id 字典序)[0]` / `xs.sort(按极值)[0]`（无并列裁决键）
 * ——这三种写法都在说「取排在前面的那一条」。它们**看起来**像在选，实际选的是**存储顺序**：
 *   · 多进一条数据、换一次插入批次、换一个仓储实现（memory ↔ pg），屏上的结论就悄悄换人；
 *   · 而**没有任何一条测试会红** —— 因为今天的数据形态恰好让它只有一个候选。
 * 「今天恰好只有一个候选」不是正确性，是**运气**。本门把运气换成判据。
 *
 * ══ 这道门怎么咬（不写死 id·不测函数·测链路）════════════════════════════════════
 * 全部经 `services.solvers.invoke(...)` 这条**生产入口**驱动。每条断言的期望值都从**同一次调用的产物**
 * 现算，或用「**扰动不变量**」表述——后者更狠，因为它连期望值都不需要：
 *   > **把候选集的存储顺序打乱重放，结论必须逐字节不变。**
 * 老代码按顺序取 ⇒ 打乱即变 ⇒ 当场红；新代码按判据取 ⇒ 纹丝不动。
 * 这句话里没有任何一个写死的 id，所以它证明的是「按判据选」，不是「今天这个数没变」。
 *
 * ══ 金丝雀（铁律 0.6：报肯定/否定结论前先自证工具没坏）════════════════════════════
 * 每组用例前先断言「本次产物里**确实有**要咬的那个东西」（域树非空 / 有备份池落点 / 注入的同分候选
 * 真落库且真同分）。少了这些，下面的断言在「零候选」时也会绿 —— 那是空真，不是通过。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
const T = "demo";

interface GaNode { id: string; factor: string; contribution: number; provenance?: { drillType?: string; drillId?: string; drillField?: string; drillValue?: number } }
interface GA { levels: { depth: number; nodes: GaNode[] }[]; atomicLeaves?: GaNode[]; noGap?: boolean }
interface DPOption { optionId: string; provenance: { drillType?: string; drillId?: string; drillValue?: number; basis?: string } }
interface DP { options: DPOption[] }
interface OFC { judges: { kit: { material: string; gapTon: number; eta: string } } }

const ga = async (t: TestApp, metricKey: string): Promise<GA> =>
  (await t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey })) as unknown as GA;
const play = async (t: TestApp): Promise<DP> => (await t.services.solvers.invoke(ADMIN, "decision_play", {})) as unknown as DP;
const fullchain = async (t: TestApp): Promise<OFC> => (await t.services.solvers.invoke(ADMIN, "order_fullchain", {})) as unknown as OFC;

/** 本域入口节点（`gapAttributionMetricDomain` 的 L1 单节点·id 恒为 `metricgap:<key>`）。 */
const entryNode = (g: GA, key: string): GaNode | undefined =>
  g.levels.find((L) => L.depth === 1)?.nodes.find((n) => n.id === `metricgap:${key}`);

/** 把一批对象**原地重排存储顺序**（memory 仓储按插入序返回 ⇒ 这是最贴近真实风险的扰动：
 *  多进一条数据 / 换一次同步批次 / 换 pg 实现，`listByType` 的顺序本来就不保证）。 */
async function reorderStorage(t: TestApp, type: string, order: (rows: ObjectInstance[]) => ObjectInstance[]): Promise<string[]> {
  const rows = await t.repos.objects.listByType(T, type);
  const next = order(rows);
  await t.repos.objects.removeWhere(T, (o) => o.type === type);
  for (const r of next) await t.repos.objects.put(r);
  return (await t.repos.objects.listByType(T, type)).map((o) => o.id);
}

/** 造一个 CausalFactor 探针对象（**测试局部**·不动种子：三份正极长协那种真实业务形态一条都不删）。 */
const decoyFactor = (factorId: string, metricKey: string): ObjectInstance => ({
  id: `obj_causalfactor_${factorId}`,
  tenantId: T,
  type: "CausalFactor",
  objectKey: factorId,
  props: { factorId, label: `探针因子 ${factorId}`, drillType: "MaterialBalance", drillId: "mbal-1", drillField: "gapTon", kind: "派生", isRoot: false, provenanceSynthetic: false, metricKey },
  origin: { type: "MANUAL" },
});

const causedBy = (from: string, to: string) => ({
  id: `lnk_cby_${from}_${to}`,
  tenantId: T,
  type: "caused_by",
  fromId: `obj_causalfactor_${from}`,
  toId: `obj_causalfactor_${to}`,
  origin: { type: "MANUAL" as const },
});

describe("WO-ORDER-DEPENDENT-PICK · 「取数组第一条」一律换成「按判据选」", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
    await seedBattery(t);
  }, 240000);

  // ══════════════════════════════════════════════════════════════════════════
  // B1 · 归因域**入口因子**（这一条决定整棵归因树长成什么样）
  // ══════════════════════════════════════════════════════════════════════════

  it("B1·L0 金丝雀：demand_attain 确实走域路由、树上确实有入口节点与因果层（否则下面全是空真）", async () => {
    const g = await ga(t, "demand_attain");
    expect(g.noGap, "本用例要的就是'有缺口'这个前提").not.toBe(true);
    const entry = entryNode(g, "demand_attain");
    expect(entry, "没有 metricgap:demand_attain 入口节点 ⇒ 是求解器/种子坏了，不是'判据对了'").toBeTruthy();
    expect(g.levels.find((L) => L.depth === 2)?.nodes.length ?? 0, "因果层为空 ⇒ 入口没走出去，下面断不出任何东西").toBeGreaterThan(0);
    // 金丝雀②：域里确实**只有一条**非根因子 —— 这正是「字母序今天恰好不出错」的原因，也是探针必须造的理由。
    const cfs = (await t.repos.objects.listByType(T, "CausalFactor")).map((o) => o.props);
    const nonRoot = cfs.filter((c) => c.metricKey === "demand_attain" && !c.isRoot).map((c) => String(c.factorId));
    expect(nonRoot, "域内非根因子不止一条/一条没有 ⇒ 本文件后面的探针前提失效，先改探针再改断言").toEqual(["cf-demand-attain-gap"]);
  }, 240000);

  it("B1·L1 孤点探针：塞一个**字母序更靠前**、但因果图上一步也走不出去的非根因子 ⇒ 归因逐字节不变", async () => {
    const before = await ga(t, "demand_attain");
    // 探针 id 以 `cf-aaa-` 开头 ⇒ 修前的 `.sort(factorId 字典序)[0]` 必选它。
    // 它**没有任何 caused_by 出边** ⇒ 从它出发 BFS 一个节点都到不了 ⇒ 修前整棵树退化成 L1 单节点。
    await t.repos.objects.put(decoyFactor("cf-aaa-orphan-decoy", "demand_attain"));
    const cfs = (await t.repos.objects.listByType(T, "CausalFactor")).map((o) => String(o.props.factorId));
    expect(cfs, "金丝雀：探针得真落库").toContain("cf-aaa-orphan-decoy");
    expect([...cfs].sort()[0] === "cf-aaa-orphan-decoy" || "cf-aaa-orphan-decoy" < "cf-demand-attain-gap",
      "金丝雀：探针必须在字典序上真的排在真入口前面，否则这条用例证明不了任何事").toBe(true);

    const after = await ga(t, "demand_attain");
    // 扰动不变量：一个走不出去的因子不可能是入口 ⇒ 它的存在改变不了任何一个数。
    expect(JSON.stringify(after), "塞一个孤点因子就把整棵归因树换掉了 ⇒ 入口仍在按字母序取，不是按判据取").toBe(JSON.stringify(before));
    // 并且入口确实还是那条**在因果图上真有出边**的非根因子（期望从库里现算·不写死 id）。
    const links = await t.repos.links.list(T);
    const hasOutEdge = new Set(links.filter((l) => l.type === "caused_by").map((l) => l.fromId.replace(/^obj_causalfactor_/, "")));
    const expected = (await t.repos.objects.listByType(T, "CausalFactor"))
      .map((o) => o.props)
      .filter((c) => c.metricKey === "demand_attain" && !c.isRoot && hasOutEdge.has(String(c.factorId)));
    expect(expected, "金丝雀：本域应当**恰好**有一条既非根、又在因果图上有出边的因子").toHaveLength(1);
    expect(entryNode(after, "demand_attain")!.factor).toBe(String(expected[0]!.label));
  }, 240000);

  it("B1·L2 中段探针：塞一个字母序更靠前、但**被入口指着**（域内入度>0）的因子 ⇒ 它是果不是因，当不了入口", async () => {
    // `caused_by` 方向是「果 → 因」：被域内某因子指到的那个，是链条中段，不是域入口。
    await t.repos.objects.put(decoyFactor("cf-aaa-mid-decoy", "demand_attain"));
    await t.repos.links.put(causedBy("cf-demand-attain-gap", "cf-aaa-mid-decoy"));
    const g = await ga(t, "demand_attain");

    const entry = entryNode(g, "demand_attain");
    expect(entry, "入口节点没了 ⇒ 路由都没走进域路径，谈不上选对了谁").toBeTruthy();
    // 期望现算：域内**入度为 0** 的那条非根因子（判据本身来自 links 表，不是抄一个 id 过来）。
    const links = await t.repos.links.list(T);
    const cfs = (await t.repos.objects.listByType(T, "CausalFactor")).map((o) => o.props);
    const domain = cfs.filter((c) => c.metricKey === "demand_attain");
    const domainIds = new Set(domain.map((c) => String(c.factorId)));
    const pointedAt = new Set(
      links.filter((l) => l.type === "caused_by" && domainIds.has(l.fromId.replace(/^obj_causalfactor_/, "")))
        .map((l) => l.toId.replace(/^obj_causalfactor_/, "")),
    );
    const sources = domain.filter((c) => !c.isRoot && !pointedAt.has(String(c.factorId)));
    expect(sources, "金丝雀：域内应当恰好剩一条入度为 0 的非根因子").toHaveLength(1);
    expect(entry!.factor, "入口被字母序更靠前的**中段**因子顶掉了 ⇒ 屏上会把「果」当成「因」").toBe(String(sources[0]!.label));
    // 探针确实进了树（作为被归到的一环），证明它不是被无关条件挡在外面才没当上入口。
    const reached = (g.levels.find((L) => L.depth === 2)?.nodes ?? []).map((n) => n.id);
    expect(reached, "探针根本没进树 ⇒ 上一条断言是被别的条件挡出来的，不算证明").toContain("cf:cf-aaa-mid-decoy");
  }, 240000);

  it("B1·L3 真并列 ⇒ fail-loud：两个平行入口时报错并点名，绝不替数据掷骰子挑一个", async () => {
    // 造一条与真入口**完全平行**的因子：同样非根、同样域内入度 0、同样指向那三个根。
    await t.repos.objects.put(decoyFactor("cf-zzz-twin-entry", "demand_attain"));
    const roots = (await t.repos.objects.listByType(T, "CausalFactor"))
      .map((o) => o.props)
      .filter((c) => c.metricKey === "demand_attain" && c.isRoot)
      .map((c) => String(c.factorId));
    expect(roots.length, "金丝雀：域里得真有根因，否则'平行'无从谈起").toBeGreaterThan(0);
    for (const r of roots) await t.repos.links.put(causedBy("cf-zzz-twin-entry", r));

    await expect(ga(t, "demand_attain"), "真并列时静默挑一个 = 屏上出现一个掷骰子来的根因，用户分辨不出").rejects.toThrow(
      /并列入口因子/,
    );
    // 错误信息必须**点名**两个并列候选（不点名 = 报了错也修不了数据）。
    const err = await ga(t, "demand_attain").catch((e: unknown) => String((e as Error).message));
    expect(err).toContain("cf-demand-attain-gap");
    expect(err).toContain("cf-zzz-twin-entry");
  }, 240000);

  // ══════════════════════════════════════════════════════════════════════════
  // C1 · `decision_play` 的**备份池证据**（与已修的长协证据同函数同写法）
  // ══════════════════════════════════════════════════════════════════════════

  it("C1·L0 金丝雀：本次推演树上确实有 BackupSupplierPool 落点，且确实有引用它的方案", async () => {
    const g = (await t.services.solvers.invoke(ADMIN, "gap_attribution", {})) as unknown as GA;
    const nodes = [...g.levels.flatMap((L) => L.nodes), ...(g.atomicLeaves ?? [])];
    expect(nodes.filter((n) => n.provenance?.drillType === "BackupSupplierPool").length,
      "树上一个备份池落点都没有 ⇒ 下面的'锚到树上'是空真").toBeGreaterThan(0);
    const dp = await play(t);
    expect(dp.options.filter((o) => o.provenance.drillType === "BackupSupplierPool").length).toBeGreaterThan(0);
  }, 240000);

  it("C1·L1 存储顺序扰动：多一个正极备份池并把它排到最前 ⇒ 方案证据仍锚在树上那一个（现算·不写死 id）", async () => {
    const seeded = (await t.repos.objects.listByType(T, "BackupSupplierPool")).map((o) => o.props);
    const cathodes = seeded.filter((p) => p.materialType === "正极");
    expect(cathodes, "金丝雀：种子里正极池只有一个 —— 这正是 C1 今天不出错的**唯一**原因").toHaveLength(1);

    // 探针：第二个正极备份池（完全正常的业务形态：一家企业本来就可能对同一物料备两套池），
    // certWeeks 与真证据池**不同** ⇒ 一旦选错，成本/周期/closesGap 会整条换掉。
    const decoyPool: ObjectInstance = {
      id: "obj_backupsupplierpool_pool-cathode-alt",
      tenantId: T,
      type: "BackupSupplierPool",
      objectKey: "pool-cathode-alt",
      props: { poolId: "pool-cathode-alt", materialType: "正极", memberCount: 9, certWeeks: 3, procureFreqPerYear: 6 },
      origin: { type: "MANUAL" },
    };
    await t.repos.objects.put(decoyPool);
    // 把它排到 `listByType` 的**第一位** —— 修前的 `pools.find(materialType==="正极")` 必然选中它。
    const idsNow = await reorderStorage(t, "BackupSupplierPool", (rows) => [
      ...rows.filter((r) => r.id === decoyPool.id),
      ...rows.filter((r) => r.id !== decoyPool.id),
    ]);
    expect(idsNow[0], "金丝雀：探针没被排到第一位 ⇒ 这条用例分辨不出新旧实现").toBe(decoyPool.id);

    // 期望现算：本次归因树上**贡献最大**的备份池落点（并列再比 nodeId）—— 与引擎侧同一条判据。
    const g = (await t.services.solvers.invoke(ADMIN, "gap_attribution", {})) as unknown as GA;
    const poolAnchors = [...g.levels.flatMap((L) => L.nodes), ...(g.atomicLeaves ?? [])]
      .filter((n) => n.provenance?.drillType === "BackupSupplierPool");
    expect(poolAnchors.length, "金丝雀：树上得有备份池落点").toBeGreaterThan(0);
    const winner = [...poolAnchors].sort((a, b) => b.contribution - a.contribution || a.id.localeCompare(b.id))[0]!;
    const expectedPoolId = String(winner.provenance!.drillId);
    expect(expectedPoolId, "树锚不该是探针 —— 探针没有任何因子指向它").not.toBe("pool-cathode-alt");

    const dp = await play(t);
    const backup = dp.options.find((o) => o.provenance.drillType === "BackupSupplierPool");
    expect(backup, "备份池方案被整条剔除了 ⇒ 断不出证据对象是谁").toBeTruthy();
    expect(
      backup!.provenance.drillId,
      `方案的证据备份池 ${backup!.provenance.drillId} ≠ 归因树锚定的 ${expectedPoolId}（节点 ${winner.id}·${winner.factor}）` +
        ` —— 说明它取的是"数组里第一条正极池"，不是树上那一个`,
    ).toBe(expectedPoolId);
    // 读数与对象同源：drillValue 必须是**那一个**池自己的 certWeeks（探针是 3，真证据池是别的数）。
    const truth = (await t.repos.objects.listByType(T, "BackupSupplierPool")).map((o) => o.props)
      .find((p) => String(p.poolId) === expectedPoolId)!;
    expect(backup!.provenance.drillValue, "证据对象与证据读数不是同一个池 ⇒ 又一次张冠李戴").toBe(Number(truth.certWeeks));
    expect(String(backup!.provenance.basis), "basis 没写证据池是怎么选出来的 ⇒ 无从核对").toContain("归因树节点");
  }, 240000);

  // ══════════════════════════════════════════════════════════════════════════
  // A 类 · 「有语义的极值」并列时的稳定裁决键
  // ══════════════════════════════════════════════════════════════════════════

  it("A·L1 order_fullchain 齐套判：注入同分候选后**打乱存储顺序重放**，结论逐字节不变", async () => {
    const mbals = (await t.repos.objects.listByType(T, "MaterialBalance")).map((o) => o.props);
    const maxGap = Math.max(...mbals.map((m) => Number(m.gapTon ?? 0)));
    expect(maxGap, "金丝雀：种子里得真有缺口，否则'最大 gapTon'无从并列").toBeGreaterThan(0);
    // 探针：与当前最大缺口**同分**、但主键字典序更靠前的一张物料平衡表。
    const twin: ObjectInstance = {
      id: "obj_materialbalance_mbal-0-twin",
      tenantId: T,
      type: "MaterialBalance",
      objectKey: "mbal-0-twin",
      props: { matBalId: "mbal-0-twin", material: "探针物料", gapTon: maxGap, netDemandTon: 1000, etaDate: "2026-09-30" },
      origin: { type: "MANUAL" },
    };
    await t.repos.objects.put(twin);
    const tied = (await t.repos.objects.listByType(T, "MaterialBalance")).map((o) => o.props)
      .filter((m) => Number(m.gapTon ?? 0) === maxGap).map((m) => String(m.matBalId));
    expect(tied.length, "金丝雀：探针没造出并列 ⇒ 这条用例分辨不出新旧实现").toBeGreaterThanOrEqual(2);

    const asc = await fullchain(t);
    // 扰动：把 MaterialBalance 的存储顺序**整个倒过来**再跑一次。
    const idsRev = await reorderStorage(t, "MaterialBalance", (rows) => [...rows].reverse());
    expect(idsRev[0], "金丝雀：顺序没真被倒过来").toBe(twin.id);
    const desc = await fullchain(t);

    expect(JSON.stringify(desc.judges.kit), "并列时齐套判随存储顺序换人 ⇒ 仍在按数组下标取，R6 当场破").toBe(
      JSON.stringify(asc.judges.kit),
    );
    // 并且选的就是并列候选里**主键字典序最小**的那张（判据现算·不写死 id）。
    const expectedId = [...tied].sort()[0]!;
    const expectedMaterial = (await t.repos.objects.listByType(T, "MaterialBalance")).map((o) => o.props)
      .find((m) => String(m.matBalId) === expectedId)!.material;
    expect(desc.judges.kit.material).toBe(String(expectedMaterial));
    expect(desc.judges.kit.gapTon).toBe(maxGap);
  }, 240000);

  it("A·L2 种子侧动态绑定（cf-capacity-short / cf-material-short）：下钻对象符合判据，并列按主键字典序", async () => {
    const cfs = (await t.repos.objects.listByType(T, "CausalFactor")).map((o) => o.props);
    const capShort = cfs.find((c) => c.factorId === "cf-capacity-short")!;
    const matShort = cfs.find((c) => c.factorId === "cf-material-short")!;
    expect(String(capShort.drillId), "金丝雀：动态绑定没解析成真对象（还挂着占位）").not.toMatch(/^DYNAMIC/);
    expect(String(matShort.drillId)).not.toMatch(/^DYNAMIC/);

    // 期望现算：OEE 最低的设备（并列取 equipId 字典序最小）／缺口最大的物料（并列取 matBalId 字典序最小）。
    //
    // ⚠ **口径注记（本单实测发现·未修·见报告⑦）**：这条绑定发生在**合成期**，那时 `Equipment.oee_current`
    //   **还不存在**（它是后续由 TS 聚合物化上去的派生属性，实测 `__prov.oee_current.source = "TS_AGGREGATE"`），
    //   所以 `worstEquip` 实际按**铭牌** `oeeA×oeeP×oeeQ` 排。落库之后两套口径给出**不同**的"最差设备"：
    //     铭牌积最小 `LINE-WS-changzhou-formation-winding-E2`(0.769233) ≠ oee_current 最小
    //     `LINE-WS-jinhua-slitting-winding-E1`(0.710781)。
    //   这是**口径分歧**，不是本单要治的顺序依赖；改它要动"哪个 OEE 才算数"这条产品口径且会挪金值，
    //   故本门按**代码真正使用的那条基准**（铭牌积）断言，把分歧写在这里而不是藏起来。
    const equip = (await t.repos.objects.listByType(T, "Equipment")).map((o) => o.props);
    const nameplateOee = (e: Record<string, unknown>) => Number(e.oeeA ?? 1) * Number(e.oeeP ?? 1) * Number(e.oeeQ ?? 1);
    const minOee = Math.min(...equip.map(nameplateOee));
    const expectEquip = equip.filter((e) => nameplateOee(e) === minOee).map((e) => String(e.equipId)).sort()[0];
    expect(String(capShort.drillId), "动态绑定的最差设备与'铭牌 OEE 最低·并列取 equipId 字典序最小'对不上").toBe(expectEquip);

    const mbals = (await t.repos.objects.listByType(T, "MaterialBalance")).map((o) => o.props);
    const maxGap = Math.max(...mbals.map((m) => Number(m.gapTon ?? 0)));
    const expectMbal = mbals.filter((m) => Number(m.gapTon ?? 0) === maxGap).map((m) => String(m.matBalId)).sort()[0];
    expect(String(matShort.drillId)).toBe(expectMbal);

    // 这两条落点真被归因树读到（否则上面断的是一个没人看的字段）。
    const g = await ga(t, "demand_attain");
    const drilled = (g.levels.find((L) => L.depth === 2)?.nodes ?? []).map((n) => n.provenance?.drillId);
    expect(drilled).toContain(String(matShort.drillId));
  }, 240000);

  it("R6 确定性：以上全部扰动之后，同输入两跑仍逐字节一致", async () => {
    await t.repos.objects.put(decoyFactor("cf-aaa-orphan-decoy", "demand_attain"));
    await reorderStorage(t, "BackupSupplierPool", (rows) => [...rows].reverse());
    await reorderStorage(t, "MaterialBalance", (rows) => [...rows].reverse());
    const a = JSON.stringify([await ga(t, "demand_attain"), await play(t), await fullchain(t)]);
    const b = JSON.stringify([await ga(t, "demand_attain"), await play(t), await fullchain(t)]);
    expect(a).toBe(b);
  }, 240000);
});
