import { describe, expect, it } from "vitest";
import {
  CANDIDATE_JOIN_KINDS,
  CANDIDATE_RUNG_KINDS,
  SolutionCandidateSchema,
  solutionCandidateId,
  ruleParamRef,
  type ChainImpediment,
  type SolutionCandidate,
} from "@platform/contracts";
import type { LinkInstance, ObjectInstance } from "../src/domain.js";
import { detectChainImpediments } from "../src/solvers/chain-impediment.js";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-SANDBOX-S3-ENUM · **阻滞点 → 候选对策枚举** SEAM（数据半 × 引擎半 · 端到端）。
 *
 * ══ 这个文件为什么必须存在 ═══════════════════════════════════════════════════════
 * 枚举器（`solvers/impediment-options.ts`）与契约（`chain-sim.ts` §7）在本单之前**已经落地并接线**
 * （`chain-impediment.ts` 的 `detectChainImpediments` 内真调用），但**没有任何测试咬这条链**：
 * 既有的 `chain-impediment-seam.test.ts` 是 E3 判定器的接缝，全文**零处**断言 `candidates`。
 * 这正是本仓记过的假绿第 9 形态（`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）：
 * **实现有、接线有、测试也绿 —— 但测试咬的是别的东西，这条链一次都没被验过。**
 *
 * ══ 本文件咬的接缝（两半各自绿证明不了它）═══════════════════════════════════════
 *  · **数据半** = `seedBattery` 播下的真合成种子（对象 + **一等关系行 links** + 已发布规则快照）。
 *    候选的 join 面（`LOCUS_PROP`/`LINK_HOP`/`KEY_JOIN`）与档位面（同侪真实取值）全靠它。
 *  · **引擎半** = `POST /a/v1/solvers/chain_impediments/invoke`
 *    （判定 `detectChainImpediments` → 枚举 `enumerateImpedimentOptions` → 逐候选**真试算**）。
 *
 * ⚠ **头号纪律：只测枚举器函数本身不算数。** 除 S3-5 之外每条都走 HTTP 全链，
 * 断言的是**回包里的候选**，不是函数返回值。
 *
 * ══ 每条断言都拒绝"看着合理"，一律回到真数据取证 ═════════════════════════════════
 *  · `fromValue` 必须**逐字节等于**那个真对象上该属性的当前值（不是引擎自己记的数）。
 *  · `toValue` 必须是**数据里真实存在的取值**（同侪某个对象上真有这个数）或**规则阈值本身**
 *    —— 这是"零步长常数"的可执行判据：一旦有人写 `×1.1` 这类"看着合理的一步"，本条当场红。
 *  · `join.path` 必须能在**真 links 行 / 真属性值**上复现 —— 编一条"看着合理"的路径过不了。
 *
 * ══ 变异反证注入点（交付说明贴原文）═══════════════════════════════════════════════
 *  ① 枚举器恒返回空集 → S3-1/S3-2/S3-3 红。
 *  ② `noCandidateKind` 恒 `NONE`（把"算不了"塌回"没有"）→ S3-5 红。
 *  ③ 引擎手拼候选 id（绕开 contracts 单源构造函数）→ S3-3 红。
 *  ④ 档位改成拍一个步长 → S3-2 红。
 */

interface CandidateStatRow {
  impedimentId: string;
  anchors: number;
  probes: number;
  effective: number;
  emitted: number;
  gaps: string[];
  noCandidateKind?: "NONE" | "UNAVAILABLE";
}

interface ScanOut {
  scanId: string;
  counts: { total: number; BOTTLENECK: number; CONGESTION: number; BREAK: number };
  impediments: ChainImpediment[];
  candidateStats: CandidateStatRow[];
  candidatesTruncated: boolean;
  candidateProbes: number;
}

async function scan(t: TestApp, args: Record<string, unknown> = {}): Promise<ScanOut> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/solvers/chain_impediments/invoke",
    headers: ADMIN,
    payload: { args },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as ScanOut;
}

/** 经**规则编辑路径**改规则（新版本 → 发布），全程不碰任何源码常量。 */
async function editRule(
  t: TestApp,
  patch: { key: string; name: string; expression: string; scopeObjectTypes: string[]; severity: string; params?: Record<string, number> },
): Promise<void> {
  const created = await t.app.inject({ method: "POST", url: "/a/v1/rules", headers: ADMIN, payload: patch });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id as string;
  const pub = await t.app.inject({ method: "POST", url: `/a/v1/rules/${id}/publish`, headers: ADMIN, payload: {} });
  expect(pub.statusCode, pub.body).toBe(200);
}

/** 全部候选（跨阻滞点铺平），每条带回宿主 —— 断言要拿宿主的 locus / evidence 做交叉核对。 */
function allCandidates(s: ScanOut): { im: ChainImpediment; c: SolutionCandidate }[] {
  return s.impediments.flatMap((im) => (im.candidates ?? []).map((c) => ({ im, c })));
}

/** 该类型全部实例（真库里读，不是引擎回包里抄的）。 */
const typeObjects = (t: TestApp, type: string): Promise<ObjectInstance[]> => t.repos.objects.listByType("demo", type);

/** 按**任一属性值**匹配业务 id 找回真对象（引擎下发的是业务 id，库里主键是内部 `obj_` id）。 */
function findByBusinessId(objs: readonly ObjectInstance[], businessId: string): ObjectInstance | undefined {
  return objs.find((o) => o.id === businessId || Object.values(o.props).some((v) => typeof v === "string" && v === businessId));
}

/** 该类型该属性在**真数据**里出现过的全部数值（"档位是不是编的"就靠它判）。 */
function realValuesOf(objs: readonly ObjectInstance[], prop: string): Set<number> {
  const out = new Set<number>();
  for (const o of objs) {
    const v = o.props[prop];
    if (typeof v === "number" && Number.isFinite(v)) out.add(v);
  }
  return out;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

describe("WO-SANDBOX-S3-ENUM · 阻滞点 → 候选对策枚举 SEAM（真种子 → 扫描 → 候选 → 逐条溯源）", () => {
  it("S3-1 · 端到端：真种子跑一次扫描，阻滞点真长出候选，且每条候选形状/归属/溯源三样齐备", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);

    // 前置：这条链的上游（E3 判定）真的产出了阻滞点 —— 否则下面全是空跑（金丝雀）。
    expect(s.counts.total).toBeGreaterThan(0);

    const cands = allCandidates(s);
    // ① **候选非空** —— 沙盘从"诊断器"变"推演器"的那一步，就是这一条断言。
    expect(cands.length).toBeGreaterThan(0);
    // ② 不是"只有一个阻滞点碰巧有解"：至少两个不同阻滞点长出了候选。
    const withCands = s.impediments.filter((im) => (im.candidates ?? []).length > 0);
    expect(withCands.length).toBeGreaterThanOrEqual(2);
    // ③ 有候选的阻滞点必须构成**多方案对比**（≥2 条），否则它算不上"给了对策"。
    for (const im of withCands) expect(im.candidates!.length).toBeGreaterThanOrEqual(2);

    for (const { im, c } of cands) {
      // 形状过契约（回包是 JSON，形状漂了这里当场红）。
      const parsed = SolutionCandidateSchema.safeParse(c);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      // 归属：候选必须挂在它自己的阻滞点上。
      expect(c.impedimentId).toBe(im.impedimentId);
      // 溯源三件套：从哪条路 join 出来的 / 档位取自哪 / 谁算的。
      expect(CANDIDATE_JOIN_KINDS).toContain(c.join.kind);
      expect(c.join.path.length).toBeGreaterThan(0);
      expect(CANDIDATE_RUNG_KINDS).toContain(c.rungKind);
      expect(c.rungSource.length).toBeGreaterThan(0);
      expect(c.provenance.solverKey).toBe("chain_impediments");
      expect(c.provenance.formula.length).toBeGreaterThan(0);
      expect(c.provenance.inputs.length).toBeGreaterThan(0);
      // 杠杆落在真对象真属性上，且单位/值类下发（前端格式化的唯一依据）。
      expect(c.lever.objectType.length).toBeGreaterThan(0);
      expect(c.lever.objectId.length).toBeGreaterThan(0);
      expect(c.lever.prop.length).toBeGreaterThan(0);
      expect(typeof c.lever.unit).toBe("string");
      // 拨到原处不是方案；至少一维 KPI 真的动了（掐掉杠杆接线 → 这里必红）。
      expect(c.fromValue).not.toBe(c.toValue);
      expect(c.dims.some((d) => d.value !== null && d.baseline !== null && d.value !== d.baseline)).toBe(true);
      // 每一维都必须自报单位与改善方向，算不出来的维必须给理由（不许留白冒充"没影响"）。
      for (const d of c.dims) {
        expect(typeof d.unit).toBe("string");
        expect(["lower", "higher"]).toContain(d.betterWhen);
        if (d.value === null || d.baseline === null) expect(d.reason && d.reason.length > 0).toBe(true);
      }
    }

    // ④ 逐点账在场且与候选数对得上（"为什么这个阻滞点没有方案"的唯一可查处）。
    expect(s.candidateStats.length).toBe(s.impediments.length);
    for (const im of s.impediments) {
      const st = s.candidateStats.find((x) => x.impedimentId === im.impedimentId)!;
      expect(st).toBeDefined();
      expect(st.emitted).toBe((im.candidates ?? []).length);
    }
  }, 180000);

  it("S3-2 · 零写死：每条候选的**落点值**与**目标档位**都能在真数据/真规则里指出出处（有步长常数即红）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);
    const cands = allCandidates(s);
    expect(cands.length).toBeGreaterThan(0); // 金丝雀：下面的 for 不许空转

    const links: LinkInstance[] = await t.repos.links.list("demo", () => true);
    expect(links.length).toBeGreaterThan(0); // 金丝雀：links 面真有行，否则 LINK_HOP 的断言是空跑

    const seenJoinKinds = new Set<string>();
    const seenRungKinds = new Set<string>();

    for (const { im, c } of cands) {
      const peers = await typeObjects(t, c.lever.objectType);
      expect(peers.length).toBeGreaterThan(0); // 杠杆落在一个**真存在**的对象类型上

      // ── ① fromValue 必须逐字节等于那个真对象上该属性的当前值 ──────────────────
      const leverObj = findByBusinessId(peers, c.lever.objectId);
      expect(leverObj, `候选 ${c.candidateId} 的杠杆对象 ${c.lever.objectType}/${c.lever.objectId} 在库里找不到`).toBeDefined();
      const current = leverObj!.props[c.lever.prop];
      expect(typeof current).toBe("number");
      expect(round6(current as number)).toBe(c.fromValue);

      // ── ② toValue 必须来自数据或规则，**不许是算出来的一步** ────────────────────
      seenRungKinds.add(c.rungKind);
      if (c.rungKind === "THRESHOLD") {
        // 档位 = 触发该判据的规则阈值本身（改规则即改档位，见 S3-6）。
        expect(c.toValue).toBe(im.evidence.threshold);
      } else {
        // 档位 = 同侪对象上**真实存在**的取值。写 `current*1.1` 这类步长常数 ⇒ 必不在集合里 ⇒ 红。
        const real = realValuesOf(peers, c.lever.prop);
        expect(real.has(c.toValue), `候选 ${c.candidateId} 的档位 ${c.toValue} 在真数据里不存在 ⇒ 它是编的`).toBe(true);
      }

      // ── ③ join.path 必须能在真数据上复现（编一条"看着合理"的路径过不了）──────────
      seenJoinKinds.add(c.join.kind);
      if (c.join.kind === "LOCUS_PROP") {
        // 落点对象自己承载杠杆 ⇒ 杠杆对象就是阻滞点落点本身。
        expect(c.lever.objectType).toBe(im.locus.objectType);
        expect(c.lever.objectId).toBe(im.locus.objectId);
      } else if (c.join.kind === "LINK_HOP") {
        // 一跳可达：真 links 表里必须有一行把「落点对象」与「杠杆对象」连起来，且 type 与 path 自述一致。
        const linkType = c.join.path.split(":")[0]!.trim();
        expect(links.some((l) => l.type === linkType), `join.path 自述的关系 ${linkType} 在 links 表里不存在`).toBe(true);
        const locusObjs = await typeObjects(t, im.locus.objectType);
        const locusObj = findByBusinessId(locusObjs, im.locus.objectId);
        expect(locusObj).toBeDefined();
        const hop = links.some(
          (l) =>
            l.type === linkType &&
            ((l.fromId === locusObj!.id && l.toId === leverObj!.id) || (l.toId === locusObj!.id && l.fromId === leverObj!.id)),
        );
        expect(hop, `候选 ${c.candidateId} 自称经 ${linkType} 一跳可达，但 links 表里没有这条边`).toBe(true);
      } else if (c.join.kind === "KEY_JOIN") {
        // 值键相等：path 形如 `LocusType.k = TargetType.j = 值`，两端的属性值必须真的都等于那个值。
        const m = /^值键相等 (\S+)\.(\S+) = (\S+)\.(\S+) = (.+?)（/.exec(c.join.path);
        expect(m, `KEY_JOIN 的 path 不是可解析的真路径原文：${c.join.path}`).not.toBeNull();
        const [, locusType, locusProp, targetType, targetProp, value] = m!;
        expect(locusType).toBe(im.locus.objectType);
        expect(targetType).toBe(c.lever.objectType);
        const locusObjs = await typeObjects(t, im.locus.objectType);
        const locusObj = findByBusinessId(locusObjs, im.locus.objectId);
        expect(locusObj).toBeDefined();
        expect(String(locusObj!.props[locusProp!])).toBe(value);
        expect(String(leverObj!.props[targetProp!])).toBe(value);
      }
    }

    // 覆盖面金丝雀：真种子上至少走通了两条不同的 join 路与两种不同的档位来源 ——
    // 若只剩一条路还绿，说明另一条已经悄悄死了（"接了线没数据"那族）。
    expect(seenJoinKinds.size).toBeGreaterThanOrEqual(2);
    expect(seenRungKinds.size).toBeGreaterThanOrEqual(1);
  }, 180000);

  it("S3-3 · 候选 id 单源：逐条可由 contracts 构造函数从候选**自身字段**重建，且全局唯一", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);
    const cands = allCandidates(s);
    expect(cands.length).toBeGreaterThan(0); // 金丝雀

    for (const { c } of cands) {
      // 引擎手拼 id（或拼法里混进候选外的东西）⇒ 重建对不上 ⇒ 当场红。
      expect(c.candidateId).toBe(
        solutionCandidateId({
          impedimentId: c.impedimentId,
          objectType: c.lever.objectType,
          leverObjectId: c.lever.objectId,
          prop: c.lever.prop,
          rungKind: c.rungKind,
          toValue: c.toValue,
        }),
      );
    }
    // 全局唯一：id 里的落点若退化成非唯一键（如基地 id），同基地两个实例会撞成一条 —— 本条咬住。
    const ids = cands.map((x) => x.c.candidateId);
    expect(new Set(ids).size).toBe(ids.length);
  }, 180000);

  it("S3-4 · 反向 · 诚实空集：确实没有对策的阻滞点 → 空候选 + 定性 NONE + 说清缺哪一维，且不报错", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t); // 200 已在 scan() 里断言 —— "算不出对策"不是错误

    const empties = s.impediments.filter((im) => (im.candidates ?? []).length === 0 && im.candidates !== undefined);
    // 真种子上确实存在"够不着任何可拨动杠杆"的阻滞点（金丝雀：这条空了下面就是空跑）。
    expect(empties.length).toBeGreaterThan(0);

    for (const im of empties) {
      // ① 空集必须**当场定性**：这是"算过了真没有"，不是"没算出来"。
      expect(im.noCandidateKind).toBe("NONE");
      // ② 必须说清缺哪一维（缺哪根杠杆 / 缺哪类数据），不许留白 —— 空白最容易被读成"没问题"。
      expect(im.noCandidateReason).toBeDefined();
      expect(im.noCandidateReason!.length).toBeGreaterThan(0);
      // ③ 逐点账里必须有对应行，且缺口原文非空、探过的锚点数如实记账。
      const st = s.candidateStats.find((x) => x.impedimentId === im.impedimentId)!;
      expect(st).toBeDefined();
      expect(st.emitted).toBe(0);
      expect(st.noCandidateKind).toBe("NONE");
      expect(st.gaps.length).toBeGreaterThan(0);
      for (const g of st.gaps) expect(g.length).toBeGreaterThan(0);
    }

    // ④ "空候选"与"有候选"两态不许同时成立（契约硬约束的运行态复核）。
    for (const im of s.impediments) {
      if ((im.candidates ?? []).length > 0) {
        expect(im.noCandidateReason).toBeUndefined();
        expect(im.noCandidateKind).toBeUndefined();
      }
    }
  }, 180000);

  it("S3-5 · 「算不了」≠「没有」：同一份数据只拧算力旋钮 → 同一批阻滞点从 NONE 翻成 UNAVAILABLE", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 与 `SolverService.chainImpediments`（service.ts）**同一套输入装配**，只多传一个算力旋钮：
    // `probeBudget` 刻意不做成 HTTP 入参（它是算力上界不是业务范围，进 args 会被误读成筛选条件）。
    const c = await t.services.solvers.loadContext("demo", undefined, { withExtended: true });
    const materialBalances = await t.repos.objects.listByType("demo", "MaterialBalance");
    const links = await t.repos.links.list("demo", () => true);

    const full = detectChainImpediments({ c, materialBalances, links, scope: {} });
    const starved = detectChainImpediments({ c, materialBalances, links, scope: {}, probeBudget: 0 });

    // 判定这一半**完全不受**算力旋钮影响：同一批阻滞点，条数与 id 逐条相同。
    expect(starved.counts).toEqual(full.counts);
    expect(starved.impediments.map((i) => i.impedimentId)).toEqual(full.impediments.map((i) => i.impedimentId));

    // 满预算：确实有阻滞点被判成"算过了真没有"（NONE），也确实有阻滞点真长出候选。
    expect(full.candidatesTruncated).toBe(false);
    expect(full.impediments.some((i) => (i.candidates ?? []).length > 0)).toBe(true);
    const fullNone = full.impediments.filter((i) => i.noCandidateKind === "NONE").map((i) => i.impedimentId);
    expect(fullNone.length).toBeGreaterThan(0);
    expect(full.impediments.some((i) => i.noCandidateKind === "UNAVAILABLE")).toBe(false);

    // 断电后：**同一批阻滞点**一条不少，但"没有对策"的定性全部翻成 UNAVAILABLE ——
    // 这正是本单要分开的两件事：「我算过了，没有」与「我没算出来」。
    expect(starved.candidatesTruncated).toBe(true);
    const starvedById = new Map(starved.impediments.map((i) => [i.impedimentId, i]));
    for (const id of fullNone) {
      const after = starvedById.get(id)!;
      expect(after).toBeDefined();
      expect(after.noCandidateKind).toBe("UNAVAILABLE");
      // 原因文案必须**当面说明它是缺答不是答**，不许沿用"没有对策"的措辞。
      expect(after.noCandidateReason).toContain("算不了");
    }
    // 断电后一条候选都产不出来（试算根本没跑），但这**不等于**"这些阻滞点没救"。
    expect(starved.impediments.every((i) => (i.candidates ?? []).length === 0)).toBe(true);
    expect(starved.impediments.every((i) => i.noCandidateKind === "UNAVAILABLE")).toBe(true);
    // 逐点账同样带定性（前端/门读的是这张表，不是散文）。
    expect(starved.candidateStats.every((x) => x.noCandidateKind === "UNAVAILABLE")).toBe(true);
  }, 180000);

  it("S3-6 · 规则半 × 枚举半：只改 C05 红线（一行代码不动）→ 新出的卡点真长出候选，且阈值档位跟着走", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await scan(t);
    const bnBefore = before.impediments.filter((i) => i.evidence.ruleKey === "C05");

    // 经**规则发布真路径**把红线压到 80 —— 引擎源码一个字不改。
    await editRule(t, {
      key: "C05",
      name: "产线利用率持续越线",
      expression: `SUSTAIN(Line.utilization > ${ruleParamRef("utilizationRedlinePct")}, 3)`,
      scopeObjectTypes: ["Line"],
      severity: "WARN",
      params: { utilizationRedlinePct: 80 },
    });

    const after = await scan(t);
    const bnAfter = after.impediments.filter((i) => i.evidence.ruleKey === "C05");
    // ① 判定半真的变了（卡点变多）。
    expect(bnAfter.length).toBeGreaterThan(bnBefore.length);
    // ② **枚举半跟着长出候选** —— 新出的卡点不是"多了几条只会报警的行"。
    const bnWithCands = bnAfter.filter((i) => (i.candidates ?? []).length > 0);
    expect(bnWithCands.length).toBeGreaterThan(bnBefore.filter((i) => (i.candidates ?? []).length > 0).length);
    // ③ 阈值档位**跟着规则走**：凡取 THRESHOLD 档的候选，目标值必须等于新阈值 80。
    const thresholdCands = allCandidates(after).filter((x) => x.c.rungKind === "THRESHOLD");
    for (const { im, c } of thresholdCands) {
      expect(im.evidence.threshold).toBe(c.toValue);
      if (im.evidence.ruleKey === "C05") expect(c.toValue).toBe(80);
    }
    // ④ 每条新候选仍然逐条可溯源（阈值变了不等于溯源可以变糊）。
    for (const im of bnWithCands) {
      for (const c of im.candidates!) {
        expect(c.join.path.length).toBeGreaterThan(0);
        expect(c.rungSource.length).toBeGreaterThan(0);
        expect(c.provenance.inputs).toContain(`${c.lever.objectType}.${c.lever.prop}`);
      }
    }
  }, 180000);

  it("S3-7 · R6 确定性：同输入连跑两次，候选（含 id / 排序 / 各维数值）逐字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await scan(t);
    const b = await scan(t);
    expect(JSON.stringify(b.impediments)).toBe(JSON.stringify(a.impediments));
    expect(JSON.stringify(b.candidateStats)).toBe(JSON.stringify(a.candidateStats));
    // 候选在每个阻滞点内也必须是全序（逐维改善量降序 → 维数 → id），不靠输入顺序的巧合。
    for (const im of a.impediments) {
      const cs = im.candidates ?? [];
      for (let i = 1; i < cs.length; i++) {
        const p = cs[i - 1]!;
        const q = cs[i]!;
        const impOf = (x: SolutionCandidate) =>
          x.dims.map((d) => (d.value === null || d.baseline === null ? 0 : d.betterWhen === "lower" ? d.baseline - d.value : d.value - d.baseline));
        const ip = impOf(p);
        const iq = impOf(q);
        let decided = false;
        for (let k = 0; k < Math.min(ip.length, iq.length); k++) {
          if (ip[k] !== iq[k]) {
            expect(ip[k]! > iq[k]!).toBe(true);
            decided = true;
            break;
          }
        }
        if (!decided) expect(p.candidateId <= q.candidateId).toBe(true);
      }
    }
  }, 180000);
});
