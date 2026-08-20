#!/usr/bin/env node
/**
 * 门 `mock-backend-scale:check` · **S&OP mock↔真后端 倍数区间门**（WO-MOCK-SOP-SCALE）
 *
 * ══ 治什么 ═══════════════════════════════════════════════════════════════════
 * 台账 `docs/REQUIREMENTS-TRACE.md` ⛔ 未派 §6 原文：
 *   > **mock 与真后端 S&OP 量级差 4–12 倍**（改它=改值，只报不动）
 *
 * 「只报不动」是对的 —— mock 的量级给前端开发用、真后端的量级由种子与求解器决定，
 * 在这里对齐**任何一边**都等于改值，那是产品/数据决策。
 * **但「只写一句话」不是机制**：这个「4–12 倍」今天只活在台账的一行字里，
 * 它变成 40 倍，**没有任何东西会说话**。本门就是让机器先说话的那个东西。
 *
 * ══ 本门与既有件的分工（别重复造轮子）═══════════════════════════════════════
 *  · `apps/frontend-shell/test/mock-scale-truth.seam.test.ts`（WO-MOCK-SCALE-TRUTH 建）
 *    守的是「不许跨一个**数量级**」，真后端侧是**冻结实测值**（`REAL` 常量），
 *    且它是 vitest 接缝测试 —— 要起 MSW、要跑整包，**不是**能单独跑的门。
 *  · **本门两处不同**：
 *    ① **两侧都现算**：真后端侧不读任何冻结常量，而是**当场**把 datacore 起在内存里
 *       （`makeApp` + `seedBattery(seed=42, scale=S)`）真跑一遍 S&OP 五步与求解器；
 *       mock 侧**真派发 MSW handler**（不是读常量），拿的是屏上真会收到的那个回包。
 *       ⇒ 冻结基准过期这条路本门根本不存在。
 *    ② **守的是倍数区间，不是数量级**：数量级窗（10 倍）会放过 2 倍、4 倍的偏差，
 *       而 2 倍在经营盘面上照样是错的 —— 本门实测到的最大真差异就落在 2.3×/3.9× 这一档，
 *       数量级窗一条都咬不到（实测：seam 测试今天全绿，而下面 J1 的 6 行是红的）。
 *
 * ══ 三层判据（对应 WO §4.1 的三档定性 —— 混为一谈就会修错地方）═══════════════
 *   **J1 · 同口径对拍**（两边算的是同一个东西 ⇒ 比值该 ≈ 登记值）
 *        真差异登记在此。今天 21 行 ratio=1.0000（WO-MOCK-SCALE-TRUTH 已对齐），
 *        6 行是**真差异**（供需归因的侧/叶分摊），逐行登记实测比值。
 *   **J2 · 跨口径关系保真**（两边算的**不是**同一个东西 ⇒ 比值本来就不是 1）
 *        年 ÷ 月 = 13.72、年缺口 ÷ 月缺口 = 15.47、含/不含 certFactor = 1.1396 …
 *        **这批就是台账那句「12 倍」真正对应的东西** —— 它是**同屏并列的年/月口径差**，
 *        **两侧各自都是这个数**，不是 mock 与真后端之间的差。
 *        本层守的是「这个关系在两侧保持一致」：谁把年行「顺手」压成月量级，这层当场红。
 *   **J3 · 一边没有数**（占位 / 缺叶 ⇒ 那不叫「量级差」）
 *        逐叶做集合差：真后端有、mock 没有的叶（今天：`capacity_gap`）登记在案，
 *        新增缺失即红。**不许**把「一边没有数」算成一个倍数糊过去。
 *
 * ══ 裕度怎么定的（区间不许拍脑袋定宽 —— 定得够宽等于没门）═══════════════════
 * 统一 **±1%**，两侧都有实测证据：
 *   · **下界**（不能比噪声还窄）：两侧都是确定性的（seed=42 · R6 字节一致），
 *     唯一的合法抖动是浮点与 `round(x,4)` 末位 —— 实测最大一例
 *     `sop step2 total`：真后端 27.919999999999998 vs mock 27.92 ⇒ 相对差 **7.1e-16**。
 *     1% 比它高 13 个数量级 ⇒ 舍入永远不会误报。
 *   · **上界**（必须严格小于本表任一行能发生的最小结构性变化，否则等于没门）：
 *     实测最小的一次真实结构变化 = 真后端需求端**最小那一叶** `seg_bias:dseg-1`
 *     占该侧 0.3815 / 24.4501 = **1.560%**；量轴那族最小的一次 = 少一个基地
 *     （扬州 0.6846 / Σ22.6839 = **3.018%**）。1% < 1.560% < 3.018% ⇒ 两者都咬得到。
 * ⇒ 1% 不是「感觉差不多」，是夹在 7.1e-16 与 1.560% 之间**唯一还剩下的量级**。
 *
 * ══ 退出码三分（默认失败方向必须是「我没查出来」）═══════════════════════════
 *   0 = 各项倍数都在登记区间内
 *   1 = **真违规**：某项跑出区间（点名 + 现算值 + 区间），或 J3 出现新的缺叶
 *   2 = **工具坏了**：取不到 mock 或真后端的数 / 金丝雀不中 / 子进程崩了 / 登记项在回包里找不到
 * ⚠ 取不到数**必须** RC=2。报 RC=0 就是把「我没查出来」读成「一切正常」。
 *
 * ══ 金丝雀（与主逻辑共用同一份实现，不许另抄）═══════════════════════════════
 * 金丝雀喂的全是**生产实物**：历史真值（367.9 / 22.6839）、今天真回包里的路径、
 * 今天真缺的那一叶。它们跑的是 `ratioVerdict` / `pick` / `leafGap` / `PAYLOAD_RE`
 * ——**主判据用的就是这几个函数**，改坏主逻辑金丝雀当场不中。
 *
 * 用法：
 *   node scripts/check-mock-backend-scale.mjs            # 门
 *   node scripts/check-mock-backend-scale.mjs --table     # 现算对照表（markdown，供文档粘贴）
 *   node scripts/check-mock-backend-scale.mjs --json      # 两侧原始回包 + 逐行判定
 *   node scripts/check-mock-backend-scale.mjs --probe-mock / --probe-real   # 内部：子进程探针
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（`mock-scale-truth` 条目的续跑件）。
 * 门账：scripts/gate-ledger.json。对照表与三档定性：docs/MOCK-BACKEND-SCALE.md。
 */

/* ── 顶层兜底必须**最先**注册（`gate-exit-discipline` 只认这形态）───────────────
 * node 对未捕获异常一律退 1，恰好撞上本门「真有违规」那个码 ⇒
 * 「门自己崩了」会被读成「mock 和真后端量级差了」——方向正好相反的结论。 */
process.on("uncaughtException", (e) => toolBroken(`未预期异常（${e?.message || e}）`, stackHint(e)));
process.on("unhandledRejection", (e) => toolBroken(`未预期 Promise 拒绝（${e?.message || e}）`, stackHint(e)));

function stackHint(e) {
  return String(e?.stack || "").split("\n").slice(1, 4).join("\n   ");
}
function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「mock 与真后端量级一致 / 一切正常」——");
  console.error("   本门这次根本没取到两侧的数，它什么都没证明。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2); // 2 = 门自己坏了（1 是「真有违规」，两者处置完全不同，不许合并）
}

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SELF = fileURLToPath(import.meta.url);
const argv = new Set(process.argv.slice(2));

/* ════════════════════════════════════════════════════════════════════════════
 * 0 · 共用原语（主逻辑 / 金丝雀 / 变异反证 **共用这一份**）
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 子进程回包的**唯一**抽取正则。主逻辑与金丝雀 C5 共用这一份 ——
 * 各抄一份就是装饰品：改主正则时金丝雀拿旧的去测、照样绿（铁律 0.6）。
 */
export const PAYLOAD_RE = /^<<<SCALE-JSON>>>(.+)$/m;

/** 从子进程 stdout 里取出 JSON 负载。取不到返回 null（调用方必须归 RC=2，不许当空对象用）。 */
export function extractPayload(stdout) {
  const m = PAYLOAD_RE.exec(String(stdout ?? ""));
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * **唯一**的取值实现（点分路径）。主判据、金丝雀 C2/C3/C5 共用这一份。
 * 取不到返回 `undefined` —— 调用方必须把它读作「我没取到」（RC=2），
 * **绝不许**读作 0 或「这一项没问题」。
 */
export function pick(obj, path) {
  let cur = obj;
  for (const seg of String(path).split(".")) {
    if (cur == null) return undefined;
    const idx = /^\[(\d+)\]$/.exec(seg);
    cur = idx ? cur[Number(idx[1])] : cur[seg];
  }
  return cur;
}

/**
 * **唯一**的比值判据实现。`bandVerdict` 只是把不同的 [lo,hi] 喂给它。
 * 全文件（含金丝雀、含变异反证）共用这一份，不许各抄一份公式。
 */
export function ratioVerdict(label, value, ref, lo, hi, refName = "真后端") {
  const base = { label, mock: value, real: ref, lo, hi };
  if (typeof value !== "number" || typeof ref !== "number" || !Number.isFinite(value) || !Number.isFinite(ref)) {
    return { ...base, ratio: NaN, ok: false, missing: true, reason: `${label}：取不到有限数（mock=${value} / ${refName}=${ref}）` };
  }
  if (ref === 0 || value === 0) {
    const ok = value === ref;
    return { ...base, ratio: NaN, ok, missing: false, reason: ok ? `${label}：两侧同为 0` : `${label}：一侧为 0 另一侧不是（${value} / ${ref}）` };
  }
  const ratio = value / ref;
  const ok = ratio >= lo && ratio <= hi;
  return {
    ...base,
    ratio,
    ok,
    missing: false,
    reason: ok
      ? `${label}：mock ${value} vs ${refName} ${ref} ⇒ ${ratio.toFixed(4)}×（在登记区间 [${lo.toFixed(4)}, ${hi.toFixed(4)}] 内）`
      : `${label}：mock ${value} vs ${refName} ${ref} ⇒ **现算 ${ratio.toFixed(4)} 倍**，越出登记区间 [${lo.toFixed(4)}, ${hi.toFixed(4)}]`,
  };
}

/** 统一裕度（理由见文件头「裕度怎么定的」—— 夹在 7.1e-16 与 1.560% 之间）。 */
export const TOL = 0.01;
export const band = (r) => [r * (1 - TOL), r * (1 + TOL)];
export const bandVerdict = (label, value, ref, registeredRatio, refName) => {
  const [lo, hi] = band(registeredRatio);
  return ratioVerdict(label, value, ref, lo, hi, refName);
};

/**
 * **唯一**的叶集合差实现（J3 与金丝雀 C4 共用）。
 * `missingOnMock` = 真后端有、mock 没有 ⇒ **mock 这边没有数**（不是量级差）。
 * `orphanOnMock`  = mock 有、真后端没有 ⇒ mock 在编一个后端不产出的叶。
 */
export function leafGap(realIds, mockIds) {
  return {
    missingOnMock: realIds.filter((id) => !mockIds.includes(id)),
    orphanOnMock: mockIds.filter((id) => !realIds.includes(id)),
  };
}

/** 归因叶 id 归一：真后端 `seg_bias:dseg-2` 与 mock `seg_bias:ess` 是同一族，按族名比。 */
export const leafFamily = (id) => String(id).split(":")[0];

/* ════════════════════════════════════════════════════════════════════════════
 * 1 · 子进程探针（`--probe-mock` / `--probe-real`）
 *
 * 为什么要起子进程：两侧都是 TypeScript，父进程（门本体）是普通 .mjs、不带
 * `--experimental-transform-types`。把探针放进**本文件自己**（而不是另写两个脚本）
 * 是刻意的：两侧探针与主判据共处一文件 ⇒ 改坏共用原语时子进程也一起坏，
 * 不会出现「主逻辑改了、探针还拿旧的」那种装饰品。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** `.js` 说明符 → `.ts`、`@/` → 前端 src 的解析钩子（内联 data: URL，不落第二个文件）。 */
function registerTsHook(root) {
  const HOOK = `
import { existsSync } from "node:fs";
const FE = ${JSON.stringify(join(root, "apps/frontend-shell/src") + "/")};
const CAND = (p) => [p, p + ".ts", p + ".tsx", p + "/index.ts", p + "/index.tsx"];
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) {
    const base = FE + spec.slice(2);
    for (const c of CAND(base)) if (existsSync(c)) return next(c, ctx);
    return next(base, ctx);
  }
  if (spec.endsWith(".js") && (spec.startsWith(".") || spec.startsWith("/"))) {
    try { return await next(spec, ctx); }
    catch (e) { try { return await next(spec.slice(0, -3) + ".ts", ctx); } catch { throw e; } }
  }
  try { return await next(spec, ctx); }
  catch (e) {
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const parentDir = ctx.parentURL ? new URL(".", ctx.parentURL).pathname : "";
      const abs = spec.startsWith("/") ? spec : parentDir + spec.replace(/^\\.\\//, "");
      for (const c of CAND(abs)) if (existsSync(c)) return next(c, ctx);
    }
    throw e;
  }
}
`;
  return import("node:module").then(({ register }) => register(`data:text/javascript,${encodeURIComponent(HOOK)}`));
}

/**
 * mock 侧探针：**真派发 MSW handler**（不是读常量）——
 * 拿的是 `VITE_MOCK=1` 时屏上真会收到的那个回包。
 * 顺带把 `sopScale` / `simSolvers` 的派生量一起取出（同一份模块图，值必然自洽）。
 */
async function probeMock() {
  const root = process.env.SCALE_ROOT || ROOT;
  await registerTsHook(root);
  const FE = join(root, "apps/frontend-shell/src");
  const scale = await import(join(FE, "mocks/sopScale.ts"));
  const sim = await import(join(FE, "mocks/simSolvers.ts"));
  const { handlers } = await import(join(FE, "mocks/handlers.ts"));

  const dispatch = async (url, body) => {
    const req = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    for (const h of handlers) {
      try {
        const res = await h.run({ request: req.clone(), requestId: "mock-backend-scale" });
        if (res && res.response) return await res.response.clone().json();
      } catch {
        /* 不是这条 handler，继续 */
      }
    }
    return null;
  };

  const sdg = await dispatch("http://127.0.0.1/a/v1/solvers/supply_demand_gap_attribution/invoke", { args: {} });
  const seeded = sim.seedSopVersions()[0];
  const audit = sim.mockPlanAudit(sim.PLAN_VERSION_CURRENT.input);

  return {
    planVersion: sim.PLAN_VERSION_CURRENT.input,
    supplyBaseline: sim.SOP_SUPPLY_BASELINE,
    s2: seeded.steps.s2,
    s3: seeded.steps.s3,
    planTargetYear: scale.PLAN_TARGET_YEAR_WAN,
    planTargetMonth: scale.PLAN_TARGET_MONTH_WAN,
    demandYearTotal: scale.DEMAND_YEAR_TOTAL_WAN,
    demandYearRevenue: scale.DEMAND_YEAR_REVENUE_YI,
    sopVersionRows: scale.SOP_VERSION_ROWS,
    aopBaseRev: scale.AOP_BASE_REVENUE_YI,
    supplyV7: scale.SUPPLY_V7_WAN,
    finance: scale.FINANCE_PNL_YEAR,
    sdg: sdg?.data ?? null,
    audit: { score: audit.score, verdict: audit.verdict },
  };
}

/**
 * 真后端探针：把 datacore **起在内存里**（`makeApp` + `seedBattery(42, "S")`）真跑一遍。
 * 不读任何冻结常量 —— 这正是本门与既有接缝测试的分工所在。
 */
async function probeReal() {
  const root = process.env.SCALE_ROOT || ROOT;
  await registerTsHook(root);
  const H = await import(join(root, "apps/datacore/test/helpers.ts"));
  const t = await H.makeApp();
  await H.seedBattery(t);
  const hdr = { ...H.ADMIN, "content-type": "application/json" };
  const call = async (method, url, payload) => {
    const r = await t.app.inject({ method, url, headers: hdr, ...(payload ? { payload } : {}) });
    return { status: r.statusCode, body: r.statusCode < 400 ? JSON.parse(r.body) : r.body.slice(0, 400) };
  };
  const rowsOf = (b) => b.rows ?? b.data ?? b.items ?? [];

  const pt = rowsOf((await call("POST", "/a/v1/objects/query", { objectType: "PlanTarget", filter: {}, limit: 200 })).body);
  const svr = rowsOf((await call("POST", "/a/v1/objects/query", { objectType: "SopVersionRow", filter: {}, limit: 50 })).body);
  const ds = rowsOf((await call("POST", "/a/v1/objects/query", { objectType: "DemandSegment", filter: {}, limit: 50 })).body);
  const pv = (await call("GET", "/a/v1/plan-versions/current")).body;

  const created = await call("POST", "/a/v1/sop/versions", { month: "2026-06" });
  const sopId = created.body?.id ?? created.body?.data?.id;
  const stepOf = async (n) => {
    const r = await call("POST", `/a/v1/sop/versions/${sopId}/advance`, { step: n });
    return r.body?.steps?.[`s${n}`] ?? r.body?.data?.steps?.[`s${n}`] ?? null;
  };
  await stepOf(1);
  const s2 = await stepOf(2);
  const s3 = await stepOf(3);

  const solver = async (k) => (await call("POST", `/a/v1/solvers/${k}/invoke`, { args: {} })).body?.data ?? null;
  const kpi = await solver("cockpit_kpi");
  const pnl = await solver("finance_pnl");
  const sdg = await solver("supply_demand_gap_attribution");
  const audit = await solver("plan_audit");

  const out = {
    planVersion: pv?.input ?? null,
    s2,
    s3,
    planTargetYear: pt.find((r) => r.props.level === "year")?.props.value,
    planTargetMonth: pt.find((r) => r.props.period === "2026-06")?.props.value,
    demandYearTotal: ds.reduce((a, r) => a + Number(r.props.demandWanPerYearP50 ?? 0), 0),
    sopVersionRows: svr.map((r) => ({ ver: r.props.ver, demand: r.props.demand, supply: r.props.supply, gap: r.props.gap, isFinal: r.props.isFinal })),
    kpi,
    finance: pnl,
    sdg,
    audit: { score: audit?.score, verdict: audit?.verdict },
  };
  await t.app.close();
  return out;
}

if (argv.has("--probe-mock") || argv.has("--probe-real")) {
  const data = argv.has("--probe-mock") ? await probeMock() : await probeReal();
  console.log(`<<<SCALE-JSON>>>${JSON.stringify(data)}`);
  process.exit(0);
}

/* ════════════════════════════════════════════════════════════════════════════
 * 2 · 采集两侧（任一侧取不到 ⇒ RC=2）
 * ═══════════════════════════════════════════════════════════════════════════ */

function runProbe(flag, what) {
  const res = spawnSync(
    process.execPath,
    ["--experimental-transform-types", "--no-warnings", SELF, flag],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SCALE_ROOT: ROOT }, timeout: 300_000 },
  );
  if (res.error) toolBroken(`${what} 探针起不来（${res.error.message}）`, "多半是 node 不支持 --experimental-transform-types，或 worktree 没装依赖。");
  const payload = extractPayload(res.stdout);
  if (payload === null) {
    toolBroken(
      `${what} 探针没吐出可解析的回包（子进程 RC=${res.status}）`,
      `stderr 尾部：\n   ${String(res.stderr || "").trim().split("\n").slice(-6).join("\n   ")}`,
    );
  }
  return payload;
}

const MOCK = runProbe("--probe-mock", "mock 侧");
const REAL = runProbe("--probe-real", "真后端侧");

/* ════════════════════════════════════════════════════════════════════════════
 * 3 · 登记表（比值取自 2026-08-20 两侧现算实测；裕度统一 ±1%，理由见文件头）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** J1 · 同口径对拍：两边算的是同一个东西 ⇒ 比值该等于登记值。 */
const J1 = [
  // ── 量轴 · 月（万套/月）· WO-MOCK-SCALE-TRUTH 已对齐，登记 1.0000 ──
  { id: "planVersion.dem", label: "计划版本 需求合计（万套/月）", m: "planVersion.dem", r: "planVersion.dem", ratio: 1, tier: "A" },
  { id: "planVersion.seg_pas", label: "计划版本 乘用车（万套/月）", m: "planVersion.seg_pas", r: "planVersion.seg_pas", ratio: 1, tier: "A" },
  { id: "planVersion.seg_ess", label: "计划版本 储能（万套/月）", m: "planVersion.seg_ess", r: "planVersion.seg_ess", ratio: 1, tier: "A" },
  { id: "planVersion.seg_com", label: "计划版本 商用车（万套/月）", m: "planVersion.seg_com", r: "planVersion.seg_com", ratio: 1, tier: "A" },
  { id: "planVersion.sup", label: "计划版本 供给（万套/月·不含认证折算）", m: "planVersion.sup", r: "planVersion.sup", ratio: 1, tier: "A" },
  { id: "s2.total.target", label: "S&OP ② 需求评审 目标合计（万套/月）", m: "s2.total.target", r: "s2.total.target", ratio: 1, tier: "A" },
  { id: "s2.total.rolling", label: "S&OP ② 需求评审 滚动合计（万套/月）", m: "s2.total.rolling", r: "s2.total.rolling", ratio: 1, tier: "A" },
  { id: "s3.sup", label: "S&OP ③ 供应评审 供给合计（万套/月·含认证折算）", m: "s3.sup", r: "s3.sup", ratio: 1, tier: "A" },
  { id: "s3.gap", label: "S&OP ③ 产销缺口（万套/月）", m: "s3.gap", r: "s3.gap", ratio: 1, tier: "A" },
  { id: "s3.dem", label: "S&OP ③ 需求（万套/月）", m: "s3.dem", r: "s3.dem", ratio: 1, tier: "A" },
  { id: "planTargetMonth", label: "计划目标（月 2026-06·万套/月）", m: "planTargetMonth", r: "planTargetMonth", ratio: 1, tier: "A" },
  // ── 量轴 · 年（万套/年）──
  { id: "planTargetYear", label: "计划目标（年 2026·万套/年·供给侧）", m: "planTargetYear", r: "planTargetYear", ratio: 1, tier: "A" },
  { id: "demandYearTotal", label: "Σ 细分年需求 P50（万套/年·需求侧）", m: "demandYearTotal", r: "demandYearTotal", ratio: 1, tier: "A" },
  { id: "sopRow.V7.demand", label: "S&OP 版本演进 V7 需求（万套/年）", m: "sopVersionRows.[3].demand", r: "sopVersionRows.[3].demand", ratio: 1, tier: "A" },
  { id: "sopRow.V7.supply", label: "S&OP 版本演进 V7 供给（万套/年）", m: "sopVersionRows.[3].supply", r: "sopVersionRows.[3].supply", ratio: 1, tier: "A" },
  { id: "supplyV7", label: "驾驶舱 supplyV7（万套/年）", m: "supplyV7", r: "kpi.supplyV7", ratio: 1, tier: "A" },
  { id: "sdg.totalGap", label: "供需归因 总缺口（万套/年）", m: "sdg.totalGap", r: "sdg.totalGap", ratio: 1, tier: "A" },
  // ── 钱轴 · 年（亿元/年）· 刻意**不**跟着量轴缩 ──
  { id: "finance.rev.rolling", label: "财务 收入 rolling（亿元/年）", m: "finance.pnl.[0].rolling", r: "finance.pnl.[0].rolling", ratio: 1, tier: "A" },
  { id: "finance.rev.budget", label: "财务 收入 budget（亿元/年）", m: "finance.pnl.[0].budget", r: "finance.pnl.[0].budget", ratio: 1, tier: "A" },
  { id: "finance.gm.rolling", label: "财务 毛利 rolling（亿元/年）", m: "finance.pnl.[2].rolling", r: "finance.pnl.[2].rolling", ratio: 1, tier: "A" },
  { id: "aopBaseRev", label: "驾驶舱 基准情景年营收（亿元/年）", m: "aopBaseRev", r: "kpi.aopBaseRev", ratio: 1, tier: "A" },

  /* ── B 档 · **真差异**（口径相同、量级不同）——供需归因的侧/叶分摊 ──────────
   * 总缺口两侧都是 81（A 档已对上），**但它怎么分下去两侧完全不同**：
   * mock 的侧分摊是**写死的比例**（`handlers.ts` 的 `G*0.704` / `G*0.141`），
   * 真后端是**从 DemandSegment 偏差 / OEE / 物料 / 产能真算**出来的。
   * 后果不是「数不好看」而是**两边给出相反的根因**：
   *   mock 判「需求端主导 70%」，真后端判「供给端主导 65%」。
   * 既有接缝测试只比 `totalGap` ⇒ 这一族它一条都咬不到（今天全绿）。
   * 本门把每一行的**现算比值**登记下来：它再漂，机器先说话。 */
  { id: "sdg.demandSide", label: "供需归因 需求端贡献（万套/年）", m: "sdg.demandSide.contribution", r: "sdg.demandSide.contribution", ratio: 2.3313, tier: "B" },
  { id: "sdg.supplySide", label: "供需归因 供给端贡献（万套/年）", m: "sdg.supplySide.contribution", r: "sdg.supplySide.contribution", ratio: 0.2568, tier: "B" },
  { id: "sdg.residual", label: "供需归因 残差（万套/年）", m: "sdg.residual", r: "sdg.residual", ratio: 1.037, tier: "B" },
  { id: "sdg.leaf.segbias", label: "供需归因 需求端头号叶 预测偏差（万套/年）", m: "sdg.demandSide.drivers.[0].contribution", r: "sdg.demandSide.drivers.[0].contribution", ratio: 3.5699, tier: "B" },
  { id: "sdg.leaf.backlog", label: "供需归因 在手订单叶 贡献（万套/年）", m: "sdg.demandSide.drivers.[1].contribution", r: "sdg.demandSide.drivers.[1].contribution", ratio: 1.0366, tier: "B" },
  { id: "sdg.leaf.backlog.driver", label: "供需归因 在手订单叶 下钻值（万套/年）", m: "sdg.demandSide.drivers.[1].driverValue", r: "sdg.demandSide.drivers.[1].driverValue", ratio: 4.2812, tier: "B" },
];

/**
 * J2 · 跨口径关系保真：两边算的**不是**同一个东西，比值本来就不是 1。
 * 每行在**两侧各算一遍**，再比这两个比值 —— 守的是「这个关系在两侧一致」。
 * ⚠ 这批就是台账那句「12 倍」真正对应的东西：它是**同屏并列的年/月口径差**，
 *    **两侧各自都有**，不是 mock 与真后端之间的差。
 */
const J2 = [
  { id: "year_over_month.demand", label: "版本演进 V7 需求(年) ÷ ② 需求合计(月)", num: ["sopVersionRows.[3].demand", "sopVersionRows.[3].demand"], den: ["s2.total.target", "s2.total.target"], ratio: 13.7178 },
  { id: "year_over_month.gap", label: "供需归因 总缺口(年) ÷ ③ 产销缺口(月)", num: ["sdg.totalGap", "sdg.totalGap"], den: ["s3.gap", "s3.gap"], ratio: 15.4696 },
  { id: "certfactor.sup", label: "计划版本 供给(不含认证折算) ÷ ③ 供给(含认证折算)", num: ["planVersion.sup", "planVersion.sup"], den: ["s3.sup", "s3.sup"], ratio: 1.1396 },
  { id: "demand_over_supply.year", label: "需求侧年口径 ÷ 供给侧年口径", num: ["demandYearTotal", "demandYearTotal"], den: ["planTargetYear", "planTargetYear"], ratio: 1.1639 },
  { id: "year_over_month.target", label: "计划目标(年) ÷ 计划目标(月 2026-06)", num: ["planTargetYear", "planTargetYear"], den: ["planTargetMonth", "planTargetMonth"], ratio: 11.5401 },
];

/**
 * J3 · 一边没有数（占位 / 缺叶）。**不是量级差，修法完全不同**，故单列。
 * 今天的存量：真后端供给端有 `capacity_gap` 叶（6.3101 万套 · 占该侧 14.2%），
 * mock 侧**整叶不存在** —— `handlers.ts` 注释写的理由是「Line.capacityDaily 未落·忠于 demo 种子」，
 * 而**同一颗 seed 下真后端算得出这一叶** ⇒ 那个理由今天已经不成立（属实测订正，见对照表文档）。
 * 本门只守「不许再多缺一叶」，不替产品决定要不要补 —— 补它=改值，本单不动。
 */
const J3_KNOWN_MISSING = ["capacity_gap"];

/* ════════════════════════════════════════════════════════════════════════════
 * 4 · 金丝雀（与主逻辑共用同一批函数 · 不中即「门自己坏了」exit 2）
 * ═══════════════════════════════════════════════════════════════════════════ */

function canaries() {
  const list = [];
  const add = (name, why, fn) => list.push({ name, why, fn });

  // C1 判据双向：历史真值必须判红，同量级一对必须判绿
  add("ratio/判据双向（生产实物：改前 367.9 vs 真后端 22.6839）", "恒绿的判据把所有偏差藏起来、恒红的把干净读成脏 —— 单向金丝雀两种坏法都测不出", () => {
    const red = bandVerdict("金丝雀·改前 Σ perBase", 367.9, 22.6839, 1);
    const green = bandVerdict("金丝雀·今天 Σ perBase", pick(MOCK, "s3.sup"), pick(REAL, "s3.sup"), 1);
    return { ok: red.ok === false && /16\.2\d+ 倍/.test(red.reason) && green.ok === true, got: `红=${!red.ok}（${red.reason}） · 绿=${green.ok}`, want: "红且点名 16.2x / 绿" };
  });

  // C2 真后端抽取：已知必中的路径必须取到有限数
  add("pick/真后端回包（已知必中 s3.sup + sdg.totalGap）", "抽空了 ⇒ 每一行都读作「取不到」或恒 0 ⇒ 门要么恒 2 要么恒绿，两种都不能报「量级一致」", () => {
    const a = pick(REAL, "s3.sup");
    const b = pick(REAL, "sdg.totalGap");
    return { ok: Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0, got: `s3.sup=${a} · sdg.totalGap=${b}`, want: "两者都是正有限数" };
  });

  // C3 mock 抽取：MSW 真派发的回包里，已知必中的路径必须取到
  add("pick/mock 回包（已知必中 s3.sup + sdg.demandSide）", "mock 侧抽空 ⇒ 门会把「我没派发到 handler」读成「mock 和后端一致」", () => {
    const a = pick(MOCK, "s3.sup");
    const b = pick(MOCK, "sdg.demandSide.contribution");
    return { ok: Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0, got: `s3.sup=${a} · sdg.demandSide=${b}`, want: "两者都是正有限数" };
  });

  // C4 叶集合差：今天已知真后端有、mock 没有的那一叶必须被差集抓到
  add("leafGap/差集（已知：真后端有 capacity_gap、mock 没有）", "差集坏了 ⇒ 「一边没有数」被静默吞掉，而它的修法与「量级差」完全不同", () => {
    const realIds = (pick(REAL, "sdg.supplySide.drivers") ?? []).map((d) => leafFamily(d.id));
    const mockIds = (pick(MOCK, "sdg.supplySide.drivers") ?? []).map((d) => leafFamily(d.id));
    const g = leafGap(realIds, mockIds);
    return { ok: g.missingOnMock.includes("capacity_gap"), got: `真后端叶=[${realIds}] · mock 叶=[${mockIds}] · 缺=[${g.missingOnMock}]`, want: "缺集合含 capacity_gap" };
  });

  // C5 「取不到」必须归 missing，不许被读成「这一项没问题」
  add("pick+ratio/取不到即 missing（不许静默判绿）", "取不到读成 0 或 undefined 再判绿 = 把「我没查出来」写成「一切正常」，本仓最贵的那种假绿", () => {
    const v = pick(REAL, "s3.__no_such_field_canary__");
    const verdict = bandVerdict("金丝雀·不存在的路径", v, 1, 1);
    return { ok: v === undefined && verdict.missing === true && verdict.ok === false, got: `pick=${v} · missing=${verdict.missing} · ok=${verdict.ok}`, want: "undefined / missing=true / ok=false" };
  });

  // C6 回包抽取正则：与子进程约定的那一份（主逻辑用的就是它）
  add("PAYLOAD_RE/回包抽取正则双向", "正则坏了 ⇒ 两侧都取不到数；若此时还敢报 RC=0，就是把「我没查出来」读成「一切正常」", () => {
    const hit = extractPayload('noise\n<<<SCALE-JSON>>>{"a":1}\nmore');
    const miss = extractPayload("完全没有负载的一段输出");
    return { ok: hit && hit.a === 1 && miss === null, got: `命中=${JSON.stringify(hit)} · 不该命中=${JSON.stringify(miss)}`, want: '{"a":1} / null' };
  });

  return list;
}

const canaryResults = canaries().map((c) => ({ ...c, ...c.fn() }));
const brokenCanaries = canaryResults.filter((c) => !c.ok);
if (brokenCanaries.length) {
  console.error("⛔ 门自己坏了 —— mock-backend-scale:check 的金丝雀未命中，本次**不产出任何结论**。");
  console.error("   （铁律 0.6：金丝雀不中只许报「工具坏了」，绝不许报「mock 与真后端量级一致」。）\n");
  for (const c of brokenCanaries) {
    console.error(`  ✗ 金丝雀「${c.name}」未中`);
    console.error(`      为什么它重要：${c.why}`);
    console.error(`      期望：${JSON.stringify(c.want)}`);
    console.error(`      实际：${JSON.stringify(c.got)}`);
  }
  process.exit(2);
}

/* ════════════════════════════════════════════════════════════════════════════
 * 5 · 判定
 * ═══════════════════════════════════════════════════════════════════════════ */

const j1 = J1.map((row) => ({ row, v: bandVerdict(row.label, pick(MOCK, row.m), pick(REAL, row.r), row.ratio) }));

const j2 = J2.map((row) => {
  const mNum = pick(MOCK, row.num[0]);
  const mDen = pick(MOCK, row.den[0]);
  const rNum = pick(REAL, row.num[1]);
  const rDen = pick(REAL, row.den[1]);
  const mSide = typeof mNum === "number" && typeof mDen === "number" && mDen !== 0 ? mNum / mDen : undefined;
  const rSide = typeof rNum === "number" && typeof rDen === "number" && rDen !== 0 ? rNum / rDen : undefined;
  // 两侧各自的跨口径比值，都必须落在登记区间；再比两侧是否一致。
  const vMock = bandVerdict(`${row.label} · mock 侧`, mSide, 1, row.ratio, "登记比值");
  const vReal = bandVerdict(`${row.label} · 真后端侧`, rSide, 1, row.ratio, "登记比值");
  const vCross = bandVerdict(`${row.label} · 两侧一致`, mSide, rSide, 1);
  return { row, mSide, rSide, vs: [vMock, vReal, vCross] };
});

const realLeafIds = (pick(REAL, "sdg.supplySide.drivers") ?? []).map((d) => leafFamily(d.id));
const mockLeafIds = (pick(MOCK, "sdg.supplySide.drivers") ?? []).map((d) => leafFamily(d.id));
const gap = leafGap(realLeafIds, mockLeafIds);
const j3New = gap.missingOnMock.filter((id) => !J3_KNOWN_MISSING.includes(id));
const j3Fixed = J3_KNOWN_MISSING.filter((id) => !gap.missingOnMock.includes(id));

/* ── 取不到数 ⇒ RC=2（这一条必须在判红之前，否则「我没查出来」会被写成「你违规了」）── */
const missing = [...j1.map((x) => x.v), ...j2.flatMap((x) => x.vs)].filter((v) => v.missing);
if (missing.length) {
  console.error("⛔ 有登记项在两侧回包里取不到数 —— 本次结论作废（**不许**读作「量级一致」）：");
  for (const v of missing) console.error(`  · ${v.reason}`);
  console.error("   多半是两侧的回包形状改了（字段改名 / 接口换路），先修登记表的取值路径再下结论。");
  process.exit(2);
}

/* ── 报告 ── */
const fmt = (n) => (typeof n === "number" ? (Number.isInteger(n) ? String(n) : n.toFixed(4)) : String(n));

if (argv.has("--json")) {
  console.log(JSON.stringify({ mock: MOCK, real: REAL, j1: j1.map((x) => ({ id: x.row.id, tier: x.row.tier, ...x.v })), j2: j2.map((x) => ({ id: x.row.id, mSide: x.mSide, rSide: x.rSide, vs: x.vs })), j3: { ...gap, known: J3_KNOWN_MISSING } }, null, 1));
  process.exit(0);
}

if (argv.has("--table")) {
  console.log("| # | 指标 | mock 值 | 真后端值 | 倍数（现算） | 登记区间 | 定性 |");
  console.log("|---|---|---|---|---|---|---|");
  let i = 0;
  for (const { row, v } of j1) {
    const tier = row.tier === "A" ? "量级同·口径同（已对齐）" : "**量级不同但口径相同 ⇒ 真差异**";
    console.log(`| ${++i} | ${row.label} | ${fmt(v.mock)} | ${fmt(v.real)} | ${fmt(v.ratio)}× | [${fmt(v.lo)}, ${fmt(v.hi)}] | ${tier} |`);
  }
  for (const { row, mSide, rSide } of j2) {
    console.log(`| ${++i} | ${row.label} | ${fmt(mSide)}× | ${fmt(rSide)}× | ${fmt(mSide / rSide)}×（两侧之比） | [${fmt(band(row.ratio)[0])}, ${fmt(band(row.ratio)[1])}] | **口径不同**（两侧各自都是这个数，不是 mock↔后端的差） |`);
  }
  for (const id of gap.missingOnMock) {
    const d = (pick(REAL, "sdg.supplySide.drivers") ?? []).find((x) => leafFamily(x.id) === id);
    console.log(`| ${++i} | 供需归因 供给端叶 \`${id}\` | **整叶不存在** | ${fmt(d?.contribution)}（万套/年） | — | **一边没有数**（不是量级差） |`);
  }
  process.exit(0);
}

console.log(`· 金丝雀 ${canaryResults.length}/${canaryResults.length} 全中（判据双向 1 · 两侧抽取 2 · 叶差集 1 · 取不到即 missing 1 · 回包正则 1）——两侧的数都真取到了，下面的结论才有资格被相信。`);
console.log(`· 两侧均**现算**：mock = 真派发 MSW handler + 模块图求值 · 真后端 = datacore 内存起服 + seedBattery(seed=42, scale=S) 真跑五步与求解器。`);

const j1Bad = j1.filter((x) => !x.v.ok);
const j2Bad = j2.flatMap((x) => x.vs).filter((v) => !v.ok);
console.log(`· J1 同口径对拍：${J1.length} 行（A 档已对齐 ${J1.filter((r) => r.tier === "A").length} 行 · B 档真差异 ${J1.filter((r) => r.tier === "B").length} 行）· **越界 ${j1Bad.length} 行**`);
console.log(`· J2 跨口径关系保真：${J2.length} 组 × 3 判据 · **越界 ${j2Bad.length} 条**`);
console.log(`· J3 一边没有数：真后端供给端叶 [${realLeafIds}] · mock 侧 [${mockLeafIds}] · 缺 [${gap.missingOnMock}]（已登记 [${J3_KNOWN_MISSING}]）· **新增缺失 ${j3New.length} 条**`);
if (j3Fixed.length) {
  console.log(`· ✅ 有人把缺的那一叶补上了：${j3Fixed.join(" , ")} → 请把它从 J3_KNOWN_MISSING 摘掉（只减不增）。`);
}

if (argv.has("--verbose")) {
  for (const { row, v } of j1) console.log(`    ${v.ok ? "✓" : "✗"} [${row.tier}] ${v.reason}`);
  for (const { row, mSide, rSide } of j2) console.log(`    · ${row.label}：mock ${fmt(mSide)}× vs 真后端 ${fmt(rSide)}×（登记 ${fmt(row.ratio)}×）`);
}

if (j1Bad.length || j2Bad.length || j3New.length) {
  console.error(`\n✗ mock-backend-scale:check 未通过：`);
  for (const { row, v } of j1.filter((x) => !x.v.ok)) {
    console.error(`  - [J1 ${row.tier}] ${v.reason}`);
    console.error(
      `      → 两侧算的是**同一个东西**，比值该是登记的 ${fmt(row.ratio)}×。现在不是了 ⇒ 有一侧动过。` +
        `\n        修：先判是哪一侧动的（真后端动 ⇒ 这是真的口径演进，更新登记比值并写明理由；` +
        `\n            mock 动 ⇒ 多半是把值改回了旧量级）。**不许**为了买绿把区间放宽。`,
    );
  }
  for (const v of j2Bad) {
    console.error(`  - [J2] ${v.reason}`);
    console.error(
      `      → 这是**跨口径**的关系（年÷月 / 含不含认证折算），两侧本来就各自是这个数。` +
        `\n        它变了说明有人把年行压成了月量级（或反过来）—— 那是把对的改错。`,
    );
  }
  for (const id of j3New) {
    console.error(`  - [J3] 真后端有、mock 没有的新缺叶：\`${id}\``);
    console.error(`      → **一边没有数 ≠ 量级差**，修法不同：要么补这一叶，要么在 J3_KNOWN_MISSING 里登记并写明理由。`);
  }
  process.exit(1);
}

console.log(`\n✓ mock-backend-scale:check 通过：J1 ${J1.length} 行、J2 ${J2.length} 组、J3 缺叶 ${gap.missingOnMock.length} 条，全部在登记区间/名单内。`);
console.log(`  （诚实边界：本门守的是「登记的比值不许漂」，**不判定这些比值本身对不对** —— 对不对是产品/数据决策，见 docs/MOCK-BACKEND-SCALE.md。）`);
