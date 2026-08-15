import { describe, expect, it } from "vitest";
import { server } from "./setup";
import { tokenFor } from "@/mocks/db";
import { ACCOUNTS } from "@/mocks/fixtures";
import { mockPlanAudit, PLAN_VERSION_CURRENT, SOP_SUPPLY_BASELINE, seedSopVersions } from "@/mocks/simSolvers";
import {
  DEMAND_YEAR,
  DEMAND_YEAR_REVENUE_YI,
  DEMAND_YEAR_TOTAL_WAN,
  PLAN_TARGET_MONTH_WAN,
  PLAN_TARGET_YEAR_WAN,
  SOP_PER_BASE_MONTHLY,
  SOP_SEG_MONTH_TARGET,
} from "@/mocks/sopScale";

/**
 * WO-MOCK-SCALE-TRUTH · 判据：**mock 与真后端在同一指标上的量级不许差一个数量级**。
 *
 * ── 为什么要这道门（不是"演示数据不准而已"）──────────────────────────────────
 * 修此单之前，mock 把年口径的数塞进月口径字段（`SOP_PER_BASE[].monthly` Σ367.9 vs 真后端
 * 实测 22.6839），于是同一份基线喂进 `plan_audit`：**mock 判「可定稿但有重要风险 58/100」，
 * 真后端判「站不住 43/100」**。mock 模式是看盘的主要通道之一，读数差一个数量级 =
 * 给人看一个假的经营盘面，且与真后端互相矛盾、谁也说不清哪个对（KILL-MOCK-RED）。
 *
 * ── 两层判据 ────────────────────────────────────────────────────────────────
 * **L1 量纲自洽层（自足·永不过期）**：任何"月"口径的量 × 12 必须与对应的"年"口径量同量级。
 *   把年数塞进月字段 ⇒ ×12 后差 ~12 倍 ⇒ 当场红。这一层**不依赖任何冻结基准**，
 *   所以真后端将来怎么演进它都不会失效 —— 它咬的是"分母对不对"，不是"数值等不等"。
 * **L2 真后端基准层（冻结实测值）**：与 `datacore` 实跑回包逐条对量级。
 *   基准怎么测的写在 `REAL_ANCHORS.measuredBy`，可原样复现。
 * **L3 结论一致层**：同一份基线喂进 `plan_audit`，mock 的 verdict/score/条目 id
 *   必须与真后端实测逐项一致 —— 这条最有牙，它咬的是"两边给出的结论一样"，不是"数字接近"。
 *
 * ── 金丝雀纪律（铁律 0.6）────────────────────────────────────────────────────
 * 每条否定结论（"没有任何一项跨数量级"）之前，先拿**已知必红**的样例跑**同一个** `magnitudeVerdict`。
 * 金丝雀与主逻辑共用同一份实现（不许各抄一份正则/公式 —— 抄了就是装饰品：
 * 改主逻辑时金丝雀拿旧的去测、照样绿）。金丝雀不中 ⇒ 报"判据坏了"，不许报"mock 干净"。
 */

// ---------------------------------------------------------------------------
// 唯一比较实现（主逻辑 + 金丝雀 + 变异反证 共用这一份）
// ---------------------------------------------------------------------------

interface Verdict {
  label: string;
  mock: number;
  real: number;
  ratio: number;
  decades: number;
  ok: boolean;
  reason: string;
}

/** 一个数量级 = 10 倍。`decades >= 1` 即判红。 */
const DECADE = 1;

function magnitudeVerdict(label: string, mock: number, real: number): Verdict {
  const base = { label, mock, real };
  if (!Number.isFinite(mock) || !Number.isFinite(real)) {
    return { ...base, ratio: NaN, decades: Infinity, ok: false, reason: `${label}：非有限数（mock=${mock} real=${real}）` };
  }
  if (real === 0 || mock === 0) {
    const ok = mock === real;
    return { ...base, ratio: NaN, decades: ok ? 0 : Infinity, ok, reason: ok ? `${label}：两侧同为 0` : `${label}：一侧为 0 另一侧不是（mock=${mock} real=${real}）` };
  }
  const ratio = mock / real;
  const decades = Math.abs(Math.log10(Math.abs(ratio)));
  const ok = decades < DECADE;
  return {
    ...base,
    ratio,
    decades,
    ok,
    reason: ok
      ? `${label}：mock ${mock} vs 真后端 ${real}（${ratio.toFixed(4)}×，未跨数量级）`
      : `${label}：mock ${mock} vs 真后端 ${real} ⇒ **${ratio.toFixed(2)} 倍**，跨了 ${decades.toFixed(2)} 个数量级`,
  };
}

const failures = (vs: Verdict[]): Verdict[] => vs.filter((v) => !v.ok);
const explain = (vs: Verdict[]): string => vs.map((v) => v.reason).join("\n");

// ---------------------------------------------------------------------------
// L2 基准：真后端实跑实测值
// ---------------------------------------------------------------------------

/**
 * 全部取自 `datacore` 内存态实跑（不是抄注释）：
 *   `seedDemo(repos)` + `POST /a/v1/synthetic/jobs {industry:"battery-manufacturing", scale:"S", seed:42}`，
 * 然后分别读对象仓（`PlanTarget` / `Segment` / `DemandSegment` / `SopVersionRow`）与
 *   `GET  /a/v1/plan-versions/current`
 *   `POST /a/v1/sop/versions/:id/advance {step:2|3}`
 *   `POST /a/v1/solvers/{cockpit_kpi|finance_pnl|supply_demand_gap_attribution|plan_audit}/invoke`
 * 复现方式见本单报告的「真口径逐条现算」。改了真后端却没同步这里 ⇒ 本门红，正是要的效果。
 */
const REAL = {
  measuredBy: "datacore memory app · seedDemo + synthetic(battery-manufacturing, S, seed=42)",
  // —— 量轴·月（万套/月）——
  planVersionDem: 27.92,
  planVersionSegPas: 14.52,
  planVersionSegEss: 8.93,
  planVersionSegCom: 4.47,
  planVersionSup: 25.8523,
  sopStep2TotalTarget: 27.92,
  sopStep3Sup: 22.6839,
  sopStep3Gap: 5.2361,
  planTargetMonth: 27.92,
  // —— 量轴·年（万套/年）——
  planTargetYear: 322.2,
  demandYearTotal: 375,
  sopVersionV7Demand: 383,
  sopVersionV7Supply: 379,
  cockpitSupplyV7: 379,
  gapAttributionTotal: 81,
  // —— 钱轴·年（亿元/年）——
  demandYearRevenue: 700,
  cockpitAopBaseRev: 601.5,
  financeRevenueRolling: 700,
  financeRevenueBudget: 686,
  financeMarginRolling: 118.9,
  // —— plan_audit 结论（同一份基线喂进去，两边必须给同一个结论）——
  auditScore: 43,
  auditVerdict: "站不住",
  auditHardIds: ["X02"],
  auditMediumIds: ["X03", "X04", "R01", "E01", "E03"],
  auditSuggestionIds: ["S-X02", "S-X03", "S-X04"],
} as const;

const token = tokenFor(ACCOUNTS.find((a) => a.username === "planner")!);
async function invokeSolver(key: string): Promise<Record<string, any>> {
  const res = await fetch(`http://127.0.0.1/a/v1/solvers/${key}/invoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ args: {} }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).data as Record<string, any>;
}
/** 部分求解器桩挂在 B 侧 `POST /b/v1/solvers/:key/run`（如 finance_pnl），与 A 侧 invoke 不是同一条路。 */
async function runSolverB(key: string): Promise<Record<string, any>> {
  const res = await fetch(`http://127.0.0.1/b/v1/solvers/${key}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ args: {} }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).data as Record<string, any>;
}
async function listObjects(type: string): Promise<{ props: Record<string, any> }[]> {
  const res = await fetch(`http://127.0.0.1/a/v1/objects?type=${encodeURIComponent(type)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items?: { props: Record<string, any> }[] } | { props: Record<string, any> }[];
  return Array.isArray(body) ? body : (body.items ?? []);
}

describe("WO-MOCK-SCALE-TRUTH · mock 与真后端量级判据", () => {
  // -------------------------------------------------------------------------
  // 金丝雀：先证判据本身会红（否则下面所有"全部通过"都不算数）
  // -------------------------------------------------------------------------
  it("金丝雀 · 判据本身能抓出跨数量级（用本单修掉的旧值跑同一个 magnitudeVerdict）", () => {
    // 改前 mock 的真实旧值，逐条喂进**同一个**比较函数。
    const canaries = [
      magnitudeVerdict("旧 PLAN_VERSION_CURRENT.input.dem", 375.0, REAL.planVersionDem),
      magnitudeVerdict("旧 Σ SOP_PER_BASE.monthly", 367.9, REAL.sopStep3Sup),
      magnitudeVerdict("旧 PLAN_VERSION_CURRENT.input.sup", 374.2, REAL.planVersionSup),
      magnitudeVerdict("旧 supply_demand_gap_attribution.totalGap", 7.1, REAL.gapAttributionTotal),
    ];
    // 全部必须判红 —— 一条判绿就说明判据坏了（阈值被调松/公式写反）。
    expect(canaries.every((c) => !c.ok), `金丝雀应全红，实际：\n${explain(canaries)}`).toBe(true);
    // 且必须**点名**是哪一处、差多少倍（只说"有问题"没法定位 = 门是装饰品）。
    expect(canaries[0]!.reason).toContain("13.43 倍");
    expect(canaries[1]!.reason).toContain("16.22 倍");
    expect(canaries[3]!.reason).toContain("旧 supply_demand_gap_attribution.totalGap");

    // 反向金丝雀：同量级的一对必须判绿（否则是"恒红门"，同样没用）。
    const green = magnitudeVerdict("同量级对照", REAL.sopStep3Sup, REAL.sopStep3Sup * 1.05);
    expect(green.ok, green.reason).toBe(true);
  });

  // -------------------------------------------------------------------------
  // L1 量纲自洽层：不依赖任何冻结基准，专治「年数塞进月字段」
  // -------------------------------------------------------------------------
  it("L1 量纲自洽 · 凡月口径的量 ×12 必须与对应年口径同量级（年数塞进月字段即红）", () => {
    // 判据：月值年化后与年值的比落在 [1/3, 3]。真实季节性/爬坡缺口最多带来 ~1.6 倍，
    // 而"年数当月数"的签名是 ~12 倍 —— 两者之间隔着一整个数量级，不会误伤。
    const ANNUALIZE_LO = 1 / 3;
    const ANNUALIZE_HI = 3;
    const annualized = (monthly: number, annual: number) => (monthly * 12) / annual;
    const rows: { label: string; monthly: number; annual: number }[] = [
      { label: "S&OP 月目标总量 vs PlanTarget(year)", monthly: PLAN_TARGET_MONTH_WAN, annual: PLAN_TARGET_YEAR_WAN },
      { label: "Σ perBase.monthly vs PlanTarget(year)", monthly: SOP_SUPPLY_BASELINE, annual: PLAN_TARGET_YEAR_WAN },
      { label: "plan-versions.dem vs PlanTarget(year)", monthly: PLAN_VERSION_CURRENT.input.dem, annual: PLAN_TARGET_YEAR_WAN },
      { label: "plan-versions.sup vs PlanTarget(year)", monthly: PLAN_VERSION_CURRENT.input.sup, annual: PLAN_TARGET_YEAR_WAN },
      // 逐细分：月目标 ×12 对该细分的年 P50。新增/改细分自动被覆盖（不是逐条写死）。
      ...SOP_SEG_MONTH_TARGET.map((s) => ({
        label: `细分 ${s.key} 月目标 vs demandWanPerYearP50`,
        monthly: s.target,
        annual: DEMAND_YEAR.find((d) => d.key === s.key)!.demandWanPerYearP50,
      })),
    ];
    const bad = rows.filter((r) => {
      const k = annualized(r.monthly, r.annual);
      return !(k >= ANNUALIZE_LO && k <= ANNUALIZE_HI);
    });
    expect(
      bad,
      `以下"月"口径的量年化后与年口径量级对不上（年数塞进月字段的典型签名是 ~12 倍）：\n` +
        bad.map((r) => `  ${r.label}：月 ${r.monthly} ×12 = ${(r.monthly * 12).toFixed(2)} vs 年 ${r.annual} ⇒ ${annualized(r.monthly, r.annual).toFixed(2)}×`).join("\n"),
    ).toEqual([]);

    // 逐基地普扫（新增基地自动进）。这里**不能**用上面那个 [1/3,3] 窗口对"年目标均摊"比 ——
    // 各基地产能天然相差 5.5 倍（常州 3.7666 vs 扬州 0.6846），拿均摊当判据就是
    // 「我用 X 当作 Y 的证据，而 X 并不度量 Y」：会把正常的小基地报成红。
    // 改用数量级判据（共用同一个 magnitudeVerdict），它照样能抓住"某个基地填了年数"——
    // 年量级填进单基地的签名是 ~12 倍以上，稳稳越过一个数量级。
    const perBaseAvgAnnual = PLAN_TARGET_YEAR_WAN / SOP_PER_BASE_MONTHLY.length;
    const perBase = SOP_PER_BASE_MONTHLY.map((b) => magnitudeVerdict(`基地 ${b.baseId} 月产能年化`, b.monthly * 12, perBaseAvgAnnual));
    expect(failures(perBase), `以下基地的月产能年化后跨了数量级：\n${explain(failures(perBase))}`).toEqual([]);
    // 金丝雀（同一条 magnitudeVerdict）：把旧的年量级单基地值（常州 88.0）喂进去必须红。
    expect(magnitudeVerdict("金丝雀·旧常州年量级", 88.0 * 12, perBaseAvgAnnual).ok).toBe(false);

    // 金丝雀（同一条 annualized 公式）：把旧的年量级值当月值喂进去，必须落在窗口外。
    expect(annualized(375.0, PLAN_TARGET_YEAR_WAN)).toBeGreaterThan(ANNUALIZE_HI);
    expect(annualized(367.9, PLAN_TARGET_YEAR_WAN)).toBeGreaterThan(ANNUALIZE_HI);
  });

  // -------------------------------------------------------------------------
  // L2 基准层：与真后端实测逐条对量级（含 MSW 实际下发的回包，不只是常量）
  // -------------------------------------------------------------------------
  it("L2 量轴 · 月口径（plan-versions/current + sop step2/step3）与真后端同量级", () => {
    const seeded = seedSopVersions()[0]!;
    const s2 = seeded.steps.s2 as { total: { target: number } };
    const s3 = seeded.steps.s3 as { sup: number; gap: number };
    const vs = [
      magnitudeVerdict("plan-versions.dem", PLAN_VERSION_CURRENT.input.dem, REAL.planVersionDem),
      magnitudeVerdict("plan-versions.seg_pas", PLAN_VERSION_CURRENT.input.seg_pas, REAL.planVersionSegPas),
      magnitudeVerdict("plan-versions.seg_ess", PLAN_VERSION_CURRENT.input.seg_ess, REAL.planVersionSegEss),
      magnitudeVerdict("plan-versions.seg_com", PLAN_VERSION_CURRENT.input.seg_com, REAL.planVersionSegCom),
      magnitudeVerdict("plan-versions.sup", PLAN_VERSION_CURRENT.input.sup, REAL.planVersionSup),
      magnitudeVerdict("sop step2 total.target", s2.total.target, REAL.sopStep2TotalTarget),
      magnitudeVerdict("sop step3 sup", s3.sup, REAL.sopStep3Sup),
      magnitudeVerdict("sop step3 gap", s3.gap, REAL.sopStep3Gap),
      magnitudeVerdict("Σ perBase.monthly", SOP_SUPPLY_BASELINE, REAL.sopStep3Sup),
    ];
    expect(failures(vs), `跨数量级项：\n${explain(failures(vs))}`).toEqual([]);
    // 这一族本就该**字节可比**（同式同源），所以在量级之外再加紧容差 ——
    // 只判数量级会让 2 倍的偏差蒙混过关，而 2 倍在经营盘面上照样是错的。
    for (const v of vs) expect(Math.abs(v.ratio - 1), `${v.label} 偏差 > 1%：${v.reason}`).toBeLessThan(0.01);
  });

  it("L2 量轴 · 年口径（DemandSegment / SopVersionRow / 供需归因）与真后端同量级", async () => {
    server.use(); // 不 override，直打 base 桩 —— 断言的是**实际下发**的回包
    const sopRows = await listObjects("SopVersionRow");
    const v7 = sopRows.find((r) => r.props.isFinal === true)!;
    const kpi = await invokeSolver("cockpit_kpi");
    const sdg = await invokeSolver("supply_demand_gap_attribution");
    const vs = [
      magnitudeVerdict("Σ demandWanPerYearP50", DEMAND_YEAR_TOTAL_WAN, REAL.demandYearTotal),
      magnitudeVerdict("PlanTarget(year)", PLAN_TARGET_YEAR_WAN, REAL.planTargetYear),
      magnitudeVerdict("SopVersionRow V7.demand", v7.props.demand, REAL.sopVersionV7Demand),
      magnitudeVerdict("SopVersionRow V7.supply", v7.props.supply, REAL.sopVersionV7Supply),
      magnitudeVerdict("cockpit_kpi.supplyV7", kpi.supplyV7, REAL.cockpitSupplyV7),
      magnitudeVerdict("supply_demand_gap_attribution.totalGap", sdg.totalGap, REAL.gapAttributionTotal),
    ];
    expect(failures(vs), `跨数量级项：\n${explain(failures(vs))}`).toEqual([]);
    for (const v of vs) expect(Math.abs(v.ratio - 1), `${v.label} 偏差 > 1%：${v.reason}`).toBeLessThan(0.01);

    // `SopVersionRow` 的本体属性定义写死 `unit: "万套/年"` 且 description 明说「非 S&OP 月度台账口径」——
    // 所以它**不许**跟着月度台账缩。这一条盯的就是"第三份真相源"再冒出来。
    expect(Number(v7.props.demand)).toBeGreaterThan(PLAN_TARGET_MONTH_WAN * 6);
  });

  it("L2 钱轴 · 年口径（finance_pnl / AOP 营收）与真后端同量级，且**不随**量轴改月", async () => {
    server.use();
    const kpi = await invokeSolver("cockpit_kpi");
    const pnl = (await runSolverB("finance_pnl")) as { pnl: { subject: string; budget: number; rolling: number }[] };
    const rev = pnl.pnl.find((p) => p.subject === "收入")!;
    const gm = pnl.pnl.find((p) => p.subject === "毛利")!;
    const vs = [
      magnitudeVerdict("需求侧年营收锚 Σ(P50×price)", DEMAND_YEAR_REVENUE_YI, REAL.demandYearRevenue),
      magnitudeVerdict("cockpit_kpi.aopBaseRev", kpi.aopBaseRev, REAL.cockpitAopBaseRev),
      magnitudeVerdict("finance_pnl 收入.rolling", rev.rolling, REAL.financeRevenueRolling),
      magnitudeVerdict("finance_pnl 收入.budget", rev.budget, REAL.financeRevenueBudget),
      magnitudeVerdict("finance_pnl 毛利.rolling", gm.rolling, REAL.financeMarginRolling),
    ];
    expect(failures(vs), `跨数量级项：\n${explain(failures(vs))}`).toEqual([]);
    for (const v of vs) expect(Math.abs(v.ratio - 1), `${v.label} 偏差 > 1%：${v.reason}`).toBeLessThan(0.01);

    // 钱轴是**年**：收入 rolling 若被"顺手"缩成月量级（≈52 亿），这条立刻红。
    expect(rev.rolling).toBeGreaterThan(REAL.demandYearRevenue / 2);
  });

  // -------------------------------------------------------------------------
  // L3 结论一致层：同一份基线，两边必须给同一个结论
  // -------------------------------------------------------------------------
  it("L3 结论一致 · mockPlanAudit(基线) 的 verdict/score/条目 id 与真后端 plan_audit 实测逐项一致", () => {
    const out = mockPlanAudit(PLAN_VERSION_CURRENT.input) as {
      H: { id: string }[]; M: { id: string }[]; S: { id: string }[]; score: number; verdict: string;
    };
    // 这一条就是本单的靶心：改前 mock 判 58/「可定稿但有重要风险」而真后端判 43/「站不住」——
    // 数字差一个数量级的直接后果是**结论相反**，而不只是"数不好看"。
    expect(out.verdict).toBe(REAL.auditVerdict);
    expect(out.score).toBe(REAL.auditScore);
    expect(out.H.map((x) => x.id)).toEqual([...REAL.auditHardIds]);
    expect(out.M.map((x) => x.id).sort()).toEqual([...REAL.auditMediumIds].sort());
    expect(out.S.map((x) => x.id).sort()).toEqual([...REAL.auditSuggestionIds].sort());

    // 金丝雀（同一个 mockPlanAudit）：把基线换回旧的年量级，结论必须**不同** ——
    // 证明这条断言真的对量级敏感，不是恰好恒真。
    const legacy = mockPlanAudit({ ...PLAN_VERSION_CURRENT.input, dem: 375.0, seg_pas: 201.7, seg_ess: 139.2, seg_com: 34.1, sup: 374.2 }) as { score: number; verdict: string };
    expect(legacy.verdict).not.toBe(REAL.auditVerdict);
    expect(legacy.score).not.toBe(REAL.auditScore);
  });
});
