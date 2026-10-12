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
 *       而 2 倍在经营盘面上照样是错的 —— 本门实测到的真差异恰好全落在那一档
 *       （2.33× / 3.89× / 3.06× / 4.28×），数量级窗一条都咬不到：
 *       **实测 2026-08-20：那道接缝测试今天全绿，而本门的 B 档 18 行是红的。**
 *
 * ══ 三层判据（对应 WO §4.1 的三档定性 —— 混为一谈就会修错地方）═══════════════
 *   **J0 · 同口径全量对拍**（两边算的是同一个东西 ⇒ 比值该 ≈ 登记值）
 *        ⚠ **受检对象集合是现算的，不是手抄的**：= 两侧回包**归一后数值叶路径的交集**
 *        （`numericLeaves(normalize(payload))`，2026-08-20 实测 **112 条**）。
 *        谁往任一侧加一个 S&OP 的量，它**自动**进受检面 —— 这正是 `gate-roster:check`
 *        守的那条命题（「门只能证明它**问过的那些**是对的，证明不了**该问的都问了**」）。
 *        不在 `EXPECTED` 例外表里的路径，期望比值一律 **1**（两侧该相等）。
 *        今天：A 档 91 行 ratio≈1（WO-MOCK-SCALE-TRUTH 已对齐）· **B 档 18 行是真差异**
 *        （供需归因的侧/叶分摊）· C 档 3 行是一边没有数。
 *   **J2 · 跨口径关系保真**（两边算的**不是**同一个东西 ⇒ 比值本来就不是 1）
 *        年 ÷ 月 = 13.72、年缺口 ÷ 月缺口 = 15.47、含/不含 certFactor = 1.1396 …
 *        **这批就是台账那句「12 倍」真正对应的东西** —— 它是**同屏并列的年/月口径差**，
 *        **两侧各自都是这个数**，不是 mock 与真后端之间的差。
 *        本层守的是「这个关系在两侧保持一致」：谁把年行「顺手」压成月量级，这层当场红。
 *   **J3 · 一侧独有**（占位 / 缺叶 ⇒ 那不叫「量级差」）
 *        归一后只在一侧出现的数值叶做集合差。真后端有、mock 没有 = **mock 这边没有数**
 *        （今天：`capacity_gap` 整叶 · 勾稽校验行 3 vs 1），逐条登记，新增即红。
 *        **不许**把「一边没有数」算成一个倍数糊过去。
 *
 * ══ ⚠ 比之前必须先归一身份（本门开发时当场栽过的那一脚）═══════════════════════
 * 按数组**下标**比两侧 = 「我用『它们在数组里的位置相同』当作『它们是同一个东西』的证据」。
 * 实测：两侧 `s2.rows` / `s3.perBase` / `drivers` 的**排序规则各不相同**，
 * 一次下标比凭空造出 **24 条假差异**（50 条越界里 24 条是假的），把真差异淹掉。
 * 归一规则见 `ARRAY_KEYS`，金丝雀 C7 拿生产实物钉住它是活的。
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
 *   1 = **真违规**：某项跑出区间（点名 + 现算值 + 区间），或 J3 出现未登记的一侧独有量
 *   2 = **工具坏了**：取不到 mock 或真后端的数 / 金丝雀不中 / 子进程崩了 / 判据项在回包里找不到
 * ⚠ 取不到数**必须** RC=2。报 RC=0 就是把「我没查出来」读成「一切正常」。
 *
 * ══ 金丝雀（8 条 · 与主逻辑共用同一份实现，不许另抄）═════════════════════════
 * 金丝雀喂的全是**生产实物**：历史真值（367.9 / 22.6839）、今天真回包里的路径、
 * 今天真缺的那一叶、两侧真实不同的排序。它们跑的是
 * `ratioVerdict` / `pick` / `leafGap` / `PAYLOAD_RE` / `normalize` / `numericLeaves`
 * ——**主判据用的就是这几个函数**，改坏主逻辑金丝雀当场不中（M3b/M5 变异反证逐条实证）。
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

/* ── 身份归一（J0 的前提 · 主逻辑与金丝雀 C7 共用）─────────────────────────────
 *
 * ⚠️ **按数组下标比两侧，本身就是本仓一再踩的那个坑**：
 * 「我用『它们在数组里的位置相同』当作『它们是同一个东西』的证据，而前者并不度量后者。」
 * 实测（2026-08-20，本门开发时当场抖出）：
 *   · `s2.rows`   —— 真后端按 key 字母序（com/ess/pas），mock 按业务序（pas/ess/com）
 *                    ⇒ 下标比会得出「乘用车 14.52 vs 4.47 = 3.25 倍」这种**完全是假的**结论；
 *   · `s3.perBase` —— 真后端按 baseId 字母序，mock 按月产能降序 ⇒ 13 个基地逐个错位；
 *   · `sdg.supplySide.drivers` —— 两侧头一条分别是 material_gap / oee_loss ⇒ 同上。
 * 一次下标比会凭空造出 **24 条假差异**（实测），把 6 条真差异淹掉。
 *
 * 故：先把数组按**自然身份**归一成对象，再逐路径比。归一键各族不同，逐族写明理由。
 */
export const ARRAY_KEYS = [
  { path: "s2.rows", by: (row) => String(row.key), why: "细分 key（com/ess/pas）两侧同名，是它的自然身份" },
  { path: "sopVersionRows", by: (row) => String(row.ver), why: "版本号 V1/V3/V5/V7 两侧同名" },
  { path: "finance.pnl", by: (row) => String(row.subject), why: "科目名（收入/销售成本/毛利）两侧同名" },
  { path: "sdg.reconChecks", by: (row) => String(row.label), why: "勾稽校验行的 label 是它的自然身份（两侧不同名 ⇒ 归一后各自独有，正是要暴露的事实）" },
  /* 归因叶：**按族名归一并聚合**，不按单叶配对。
   * 理由（实测逼出来的，不是设计洁癖）：真后端的 `seg_bias` 族有 **3 条**（dseg-1/2/3，逐细分），
   * mock 只有 **1 条**（`seg_bias:ess`）。两侧的叶 id 里**没有共享身份**
   * （真后端带对象 id `dseg-2`，mock 带细分 key `ess`），硬配对只会配错 ——
   * 第一版按族名取「最后一条」，当场造出 `seg_bias.contribution 125.5570×` 这种假数。
   * 故：族内 `contribution` **求和**后再比（两侧都良定义），并把 `count` 一起比 ——
   * 族里少了几条，`count` 那一行会说话（那是「一边没有数」，不是量级差）。
   * `share` / `driverValue` / `provenance.drillValue` 只在**族内独苗**时才可比，
   * 多条时留空、不进交集（宁可不比，也不上一条会说谎的）。 */
  {
    path: "sdg.demandSide.drivers",
    fold: true,
    why: "族名聚合：两侧叶 id 无共享身份（真后端 seg_bias:dseg-2 / mock seg_bias:ess），硬配对必配错；族内求和后可比",
  },
  { path: "sdg.supplySide.drivers", fold: true, why: "同上" },
  {
    path: "s3.perBase",
    // 两侧的 `baseId` 字段**装的不是同一个东西**：真后端是拼音 id（changzhou），
    // mock 落的是册里的中文名（常州）—— `sopScale.ts` 的注释原文就写明了这处形状差异。
    // 故不能拿 baseId 当身份；改按**月产能降序的名次**归一（两侧是同一组 13 个值，排完序逐位对齐）。
    rank: (rows) => [...rows].sort((a, b) => Number(b.monthly) - Number(a.monthly)),
    why: "两侧 baseId 字段装的不是同一个东西（拼音 id vs 中文名），故按月产能降序名次归一",
  },
];

/** 把数组按自然身份归一成对象（数组下标从此不参与比对）。主逻辑与金丝雀 C7 共用这一份。 */
export function normalize(payload) {
  const out = JSON.parse(JSON.stringify(payload ?? {}));
  for (const spec of ARRAY_KEYS) {
    const segs = spec.path.split(".");
    const leaf = segs.pop();
    let cur = out;
    for (const s of segs) cur = cur?.[s];
    const arr = cur?.[leaf];
    if (!Array.isArray(arr)) continue;
    if (spec.rank) {
      cur[leaf] = Object.fromEntries(spec.rank(arr).map((row, i) => [`#${i + 1}`, row]));
    } else if (spec.fold) {
      const byFam = new Map();
      for (const row of arr) {
        const f = leafFamily(row.id);
        if (!byFam.has(f)) byFam.set(f, []);
        byFam.get(f).push(row);
      }
      cur[leaf] = Object.fromEntries(
        [...byFam.entries()].map(([f, rows]) => {
          const folded = {
            contribution: rows.reduce((a, r) => a + Number(r.contribution ?? 0), 0),
            count: rows.length,
          };
          // 族内独苗才带下钻证据 —— 多条时这些字段没有良定义的两侧对应物，留空不比。
          if (rows.length === 1) {
            if (typeof rows[0].driverValue === "number") folded.driverValue = rows[0].driverValue;
            if (typeof rows[0].share === "number") folded.share = rows[0].share;
          }
          return [f, folded];
        }),
      );
    } else {
      cur[leaf] = Object.fromEntries(arr.map((row) => [spec.by(row), row]));
    }
  }
  return out;
}

/** 枚举一棵对象里所有**有限数**叶子的点分路径。主逻辑与金丝雀 C8 共用这一份。 */
export function numericLeaves(obj, prefix = "", acc = new Map()) {
  if (obj === null || obj === undefined) return acc;
  if (typeof obj === "number") {
    if (Number.isFinite(obj) && prefix) acc.set(prefix, obj);
    return acc;
  }
  if (typeof obj !== "object") return acc;
  for (const [k, v] of Object.entries(obj)) numericLeaves(v, prefix ? `${prefix}.${k}` : k, acc);
  return acc;
}

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
    // 形状与真后端 `cockpit_kpi` 回包对齐（同名同层），否则 J0 的交集会因**嵌套层级不同**
    // 而把两侧本来对得上的量判成「只有一侧有」—— 那是拿形状差冒充数据差。
    kpi: { supplyV7: scale.SUPPLY_V7_WAN, aopBaseRev: scale.AOP_BASE_REVENUE_YI },
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
 * 3 · 登记表
 *
 * ⚠ **受检对象集合是现算的，不是手抄的**（`gate-roster:check` 守的正是这条：
 *   「一道门只能证明它**问过的那些**是对的，证明不了**该问的都问了**」）。
 *   J0 的对象集合 = 两侧回包归一后**数值叶路径的交集** —— 谁往任一侧加一个 S&OP 的量，
 *   它**自动**进入受检面；不在下面任何一张表里 ⇒ 默认按「两侧该相等」判，不达标即红。
 *   下面这三张表登记的都是**判据本体**（期望比值 / 豁免规则 / 已知缺叶），不是对象名册。
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * **期望比值例外表**（比值 ≠ 1 的那些）。不在表里的路径，期望比值一律 **1**。
 * 每条 = 一处**已知的真差异**，值取自 2026-08-20 两侧现算实测，必须写 `why`。
 * ⚠ 这张表是「已知欠账」，**不是**「这样就对了」——见文件头「诚实边界」。
 */
const EXPECTED = {
  // ── 供需失衡归因：总缺口两侧都是 81（对上了），**但怎么分下去两侧相反** ──────
  //    mock 的侧分摊是写死的比例（handlers.ts 的 G×0.704 / G×0.141），真后端是真算的。
  //    后果：mock 判「需求端主导 70%」，真后端判「供给端主导 64.5%」——**相反的根因**。
  "sdg.demandSide.contribution": { ratio: 2.3313, why: "mock 写死 G×0.704 vs 真后端从 DemandSegment 偏差+在手订单真算" },
  "sdg.demandSide.share": { ratio: 1.9817, why: "同上，share 是 contribution ÷ G 的派生" },
  "sdg.demandSide.pct": { ratio: 2.3179, why: "同上，pct 是 share 取整（取整让它与 share 的比值略不同）" },
  "sdg.supplySide.contribution": { ratio: 0.2568, why: "mock 写死 G×0.141 vs 真后端从 OEE+物料+产能真算 ⇒ 真后端是 mock 的 3.89 倍" },
  "sdg.supplySide.share": { ratio: 0.2182, why: "同上派生" },
  "sdg.supplySide.pct": { ratio: 0.2555, why: "同上派生" },
  "sdg.residual": { ratio: 1.037, why: "残差 = G − 两侧贡献；两侧贡献都错而残差恰好接近，是巧合不是对上了" },
  "sdg.residualPct": { ratio: 1.0667, why: "同上派生（取整）" },
  // ── 归因叶（族聚合后）──────────────────────────────────────────────────────
  "sdg.demandSide.drivers.seg_bias.contribution": { ratio: 3.0565, why: "mock 只对储能一条细分算偏差；真后端逐细分三条（dseg-1/2/3）求和 15.6714" },
  "sdg.demandSide.drivers.seg_bias.count": { ratio: 0.3333, why: "**一边没有数**：mock 1 条叶 vs 真后端 3 条（缺乘用车/商用车的预测偏差叶）。补它=改值，本单只报不动" },
  "sdg.demandSide.drivers.order_backlog.contribution": { ratio: 1.0366, why: "两侧同族同量级，差异随上层侧分摊一起漂" },
  "sdg.demandSide.drivers.order_backlog.driverValue": { ratio: 4.2812, why: "在手订单**存量**下钻值：mock 108.4 万套 vs 真后端 25.32 万套（同名同单位，真差异）" },
  "sdg.demandSide.drivers.order_backlog.share": { ratio: 0.4446, why: "族内占比，随 contribution 与侧合计一起漂" },
  "sdg.supplySide.drivers.material_gap.contribution": { ratio: 0.5014, why: "mock 由写死侧合计取余得 8 vs 真后端真算 15.9557" },
  "sdg.supplySide.drivers.material_gap.share": { ratio: 1.9527, why: "族内占比派生" },
  "sdg.supplySide.drivers.oee_loss.contribution": { ratio: 0.1536, why: "mock 由写死侧合计 ×0.3 得 3.4 vs 真后端真算 22.1341" },
  "sdg.supplySide.drivers.oee_loss.share": { ratio: 0.6018, why: "族内占比派生" },
  "sdg.supplySide.drivers.oee_loss.driverValue": {
    ratio: 0.0132,
    why:
      "⚠ **这一条不是量级差，是量纲放错了栏**：两侧 `unit` 都写「万套」，" +
      "而 mock 那一栏放的是 **OEE 比值 0.84（0–1）**、真后端放的是 **63.84 万套**。" +
      "说成「差 76 倍」就会去改值，正确的修法是改那一栏放什么。登记比值只为把它钉住不再漂。",
  },
  // ── S&OP ② 三线对照的「上期实绩」──────────────────────────────────────────
  "s2.rows.pas.lastActual": { ratio: 0, zero: "real", why: "**一边没有数**：真后端新建版本没有上期实绩（恒 0），mock 用年实绩按月权重折算填了值" },
  "s2.rows.ess.lastActual": { ratio: 0, zero: "real", why: "同上" },
  "s2.rows.com.lastActual": { ratio: 0, zero: "real", why: "同上" },
};

/** 人读标签（只影响报告可读性，不参与判定）。 */
const LABELS = {
  "planVersion.dem": "计划版本 需求合计（万套/月）",
  "planVersion.sup": "计划版本 供给（万套/月·不含认证折算）",
  "s2.total.target": "S&OP ② 需求评审 目标合计（万套/月）",
  "s3.sup": "S&OP ③ 供应评审 供给合计（万套/月·含认证折算）",
  "s3.gap": "S&OP ③ 产销缺口（万套/月）",
  planTargetYear: "计划目标（年 2026·万套/年·供给侧）",
  planTargetMonth: "计划目标（月 2026-06·万套/月）",
  demandYearTotal: "Σ 细分年需求 P50（万套/年·需求侧）",
  "sdg.totalGap": "供需归因 总缺口（万套/年）",
  "kpi.supplyV7": "驾驶舱 supplyV7（万套/年）",
  "kpi.aopBaseRev": "驾驶舱 基准情景年营收（亿元/年）",
  "finance.pnl.收入.rolling": "财务 收入 rolling（亿元/年）",
  "audit.score": "计划体检 得分",
};

/**
 * **一侧独有**的路径：不进交集，故不参与倍数判定。
 * 但「真后端有、mock 没有」是**一边没有数**（修法与量级差完全不同），必须登记，只减不增。
 */
const ONLY_REAL_KNOWN = [
  { re: /^sdg\.supplySide\.drivers\.capacity_gap\./, why: "mock 整叶不存在。handlers.ts 注释写的理由「Line.capacityDaily 未落」**今天已过期** —— 同 seed 下真后端算得出该叶（6.3101 万套/年）。补它=改值，本单只报不动" },
  { re: /^kpi\.(revAttainPct|utilPeak|cashCushion)$/, why: "驾驶舱另外三个 KPI 不在本门 S&OP 射程内（本门只取 supplyV7 / aopBaseRev 两个 S&OP 量）" },
  {
    re: /^sdg\.reconChecks\.(需求端内|供给端内|总（需求端\+供给端\+residual）)\./,
    why:
      "**勾稽校验行两侧不同构**：真后端 3 条（需求端内 / 供给端内 / 总），mock 只有 1 条且叫「Σ子=父」" +
      "⇒ 两侧无共享身份，本门不硬配对（配错比不配更糟）。屏上的后果：mock 只能说「总数配平了」，" +
      "说不了「需求端内部配平了没有」。属**一边没有数**，补它=改 mock，本单只报不动。",
  },
];
/** mock 独有：本门探针多取的派生量 + 族内独苗才有的下钻证据，不构成缺口。 */
const ONLY_MOCK_KNOWN = [
  { re: /^(supplyBaseline|demandYearRevenue)$/, why: "mock 侧的派生量（Σ perBase / 需求侧年营收锚），真后端不以同名字段下发；其对应量已分别由 s3.sup 与 finance 覆盖" },
  { re: /^sdg\.reconChecks\.Σ子=父\./, why: "见 ONLY_REAL_KNOWN 里同族条目：两侧勾稽校验行不同构、不同名，本门不硬配对" },
  {
    re: /^sdg\.demandSide\.drivers\.seg_bias\.(driverValue|share)$/,
    why:
      "族聚合规则的产物，不是缺口：`seg_bias` 族在 mock 侧是**独苗**（只算储能）故带下钻证据，" +
      "真后端有 3 条（逐细分）故按规则不带族级下钻证据（多条时它没有良定义的两侧对应物）。" +
      "族本身的差异已由 `seg_bias.contribution`（3.0565×）与 `seg_bias.count`（1 vs 3）两行守着。",
  },
];

/**
 * J2 · 跨口径关系保真：两边算的**不是**同一个东西，比值本来就不是 1。
 * 每行在**两侧各算一遍**，再比这两个比值 —— 守的是「这个关系在两侧一致」。
 * ⚠ 这批就是台账那句「12 倍」真正对应的东西：它是**同屏并列的年/月口径差**，
 *    **两侧各自都有**，不是 mock 与真后端之间的差。
 */
const J2 = [
  { id: "year_over_month.demand", label: "版本演进 V7 需求(年) ÷ ② 需求合计(月)", num: "sopVersionRows.V7.demand", den: "s2.total.target", ratio: 13.7178 },
  { id: "year_over_month.gap", label: "供需归因 总缺口(年) ÷ ③ 产销缺口(月)", num: "sdg.totalGap", den: "s3.gap", ratio: 15.4696 },
  { id: "certfactor.sup", label: "计划版本 供给(不含认证折算) ÷ ③ 供给(含认证折算)", num: "planVersion.sup", den: "s3.sup", ratio: 1.1396 },
  { id: "demand_over_supply.year", label: "需求侧年口径 ÷ 供给侧年口径", num: "demandYearTotal", den: "planTargetYear", ratio: 1.1639 },
  { id: "year_over_month.target", label: "计划目标(年) ÷ 计划目标(月 2026-06)", num: "planTargetYear", den: "planTargetMonth", ratio: 11.5401 },
];

/* ════════════════════════════════════════════════════════════════════════════
 * 4 · 归一 + 现算受检面
 * ═══════════════════════════════════════════════════════════════════════════ */

const NM = normalize(MOCK);
const NR = normalize(REAL);
const mLeaves = numericLeaves(NM);
const rLeaves = numericLeaves(NR);
const both = [...rLeaves.keys()].filter((p) => mLeaves.has(p)).sort();
const onlyReal = [...rLeaves.keys()].filter((p) => !mLeaves.has(p)).sort();
const onlyMock = [...mLeaves.keys()].filter((p) => !rLeaves.has(p)).sort();

/* ════════════════════════════════════════════════════════════════════════════
 * 5 · 金丝雀（与主逻辑共用同一批函数 · 不中即「门自己坏了」exit 2）
 * ═══════════════════════════════════════════════════════════════════════════ */

function canaries() {
  const list = [];
  const add = (name, why, fn) => list.push({ name, why, fn });

  // C1 判据双向：历史真值必须判红，同量级一对必须判绿
  add("ratio/判据双向（生产实物：改前 367.9 vs 真后端 22.6839）", "恒绿的判据把所有偏差藏起来、恒红的把干净读成脏 —— 单向金丝雀两种坏法都测不出", () => {
    const red = bandVerdict("金丝雀·改前 Σ perBase", 367.9, 22.6839, 1);
    const green = bandVerdict("金丝雀·今天 s3.sup", pick(NM, "s3.sup"), pick(NR, "s3.sup"), 1);
    return { ok: red.ok === false && /16\.2\d+ 倍/.test(red.reason) && green.ok === true, got: `红=${!red.ok}（${red.reason}） · 绿=${green.ok}`, want: "红且点名 16.2x / 绿" };
  });

  // C2 真后端抽取：已知必中的路径必须取到有限数
  add("pick/真后端回包（已知必中 s3.sup + sdg.totalGap）", "抽空了 ⇒ 每一行都读作「取不到」或恒 0 ⇒ 门要么恒 2 要么恒绿，两种都不能报「量级一致」", () => {
    const a = pick(NR, "s3.sup");
    const b = pick(NR, "sdg.totalGap");
    return { ok: Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0, got: `s3.sup=${a} · sdg.totalGap=${b}`, want: "两者都是正有限数" };
  });

  // C3 mock 抽取：MSW 真派发的回包里，已知必中的路径必须取到
  add("pick/mock 回包（已知必中 s3.sup + sdg.demandSide）", "mock 侧抽空 ⇒ 门会把「我没派发到 handler」读成「mock 和后端一致」", () => {
    const a = pick(NM, "s3.sup");
    const b = pick(NM, "sdg.demandSide.contribution");
    return { ok: Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0, got: `s3.sup=${a} · sdg.demandSide=${b}`, want: "两者都是正有限数" };
  });

  // C4 叶集合差：今天已知真后端有、mock 没有的那一叶必须被差集抓到
  add("leafGap/差集（已知：真后端有 capacity_gap、mock 没有）", "差集坏了 ⇒ 「一边没有数」被静默吞掉，而它的修法与「量级差」完全不同", () => {
    const realIds = Object.keys(pick(NR, "sdg.supplySide.drivers") ?? {});
    const mockIds = Object.keys(pick(NM, "sdg.supplySide.drivers") ?? {});
    const g = leafGap(realIds, mockIds);
    return { ok: g.missingOnMock.includes("capacity_gap"), got: `真后端叶=[${realIds}] · mock 叶=[${mockIds}] · 缺=[${g.missingOnMock}]`, want: "缺集合含 capacity_gap" };
  });

  // C5 「取不到」必须归 missing，不许被读成「这一项没问题」
  add("pick+ratio/取不到即 missing（不许静默判绿）", "取不到读成 0 或 undefined 再判绿 = 把「我没查出来」写成「一切正常」，本仓最贵的那种假绿", () => {
    const v = pick(NR, "s3.__no_such_field_canary__");
    const verdict = bandVerdict("金丝雀·不存在的路径", v, 1, 1);
    return { ok: v === undefined && verdict.missing === true && verdict.ok === false, got: `pick=${v} · missing=${verdict.missing} · ok=${verdict.ok}`, want: "undefined / missing=true / ok=false" };
  });

  // C6 回包抽取正则：与子进程约定的那一份（主逻辑用的就是它）
  add("PAYLOAD_RE/回包抽取正则双向", "正则坏了 ⇒ 两侧都取不到数；若此时还敢报 RC=0，就是把「我没查出来」读成「一切正常」", () => {
    const hit = extractPayload('noise\n<<<SCALE-JSON>>>{"a":1}\nmore');
    const miss = extractPayload("完全没有负载的一段输出");
    return { ok: hit && hit.a === 1 && miss === null, got: `命中=${JSON.stringify(hit)} · 不该命中=${JSON.stringify(miss)}`, want: '{"a":1} / null' };
  });

  /* C7 身份归一：**这条是本门最贵的一条金丝雀**。
   * 按下标比会凭空造出 24 条假差异（实测），把 6 条真差异淹掉。
   * 判据取自**生产实物**：真后端 s2.rows 首行是 com(4.47)、mock 首行是 pas(14.52)；
   * 归一后 `s2.rows.pas` 两侧必须都是 14.52 —— 归一坏了这条当场不中。 */
  add("normalize/身份归一（生产实物：两侧 s2.rows 排序不同）", "按下标比 = 「我用『它们在数组里的位置相同』当作『它们是同一个东西』的证据」，实测凭空造出 24 条假差异", () => {
    const rawMockFirst = pick(MOCK, "s2.rows.[0].key");
    const rawRealFirst = pick(REAL, "s2.rows.[0].key");
    const mPas = pick(NM, "s2.rows.pas.target");
    const rPas = pick(NR, "s2.rows.pas.target");
    return {
      ok: rawMockFirst !== rawRealFirst && Number.isFinite(mPas) && Number.isFinite(rPas) && Math.abs(mPas / rPas - 1) < 0.01,
      got: `原始首行 mock=${rawMockFirst} / 真后端=${rawRealFirst}（不同即证明下标不可信）· 归一后 s2.rows.pas.target ${mPas} vs ${rPas}`,
      want: "两侧原始首行不同，且归一后同名细分对得上",
    };
  });

  // C8 受检面下界：枚举器一坏集合就变空 ⇒ 交集恒空 ⇒ 门恒绿且一声不吭
  add("numericLeaves/受检面下界（现算，不写死名册）", "枚举器坏了 ⇒ 受检面变空 ⇒ 门恒报「全部在区间内」，而它一个量都没比", () => {
    const ok = both.length >= 80 && mLeaves.size >= 80 && rLeaves.size >= 80;
    return { ok, got: `mock 叶 ${mLeaves.size} · 真后端叶 ${rLeaves.size} · 交集 ${both.length}`, want: "三者都 ≥ 80（今天实测 112 交集）" };
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
 * 6 · 判定
 * ═══════════════════════════════════════════════════════════════════════════ */

/** J0 · 全量同口径对拍（对象集合现算）。 */
const j0 = both.map((path) => {
  const exp = EXPECTED[path];
  const m = mLeaves.get(path);
  const r = rLeaves.get(path);
  if (exp && exp.zero === "real") {
    // 「真后端恒 0、mock 有值」不是倍数问题，是一边没有数 —— 登记后按「真后端仍为 0」判。
    return { path, m, r, exp, v: { label: path, mock: m, real: r, ratio: NaN, ok: r === 0, missing: false, lo: 0, hi: 0, reason: r === 0 ? `${path}：真后端仍为 0（一边没有数·已登记）` : `${path}：真后端不再是 0（现算 ${r}）⇒ 登记的「一边没有数」已过期，请改判据` } };
  }
  return { path, m, r, exp, v: bandVerdict(LABELS[path] ?? path, m, r, exp ? exp.ratio : 1) };
});

const j2 = J2.map((row) => {
  const mNum = pick(NM, row.num);
  const mDen = pick(NM, row.den);
  const rNum = pick(NR, row.num);
  const rDen = pick(NR, row.den);
  const mSide = typeof mNum === "number" && typeof mDen === "number" && mDen !== 0 ? mNum / mDen : undefined;
  const rSide = typeof rNum === "number" && typeof rDen === "number" && rDen !== 0 ? rNum / rDen : undefined;
  const vMock = bandVerdict(`${row.label} · mock 侧`, mSide, 1, row.ratio, "登记比值");
  const vReal = bandVerdict(`${row.label} · 真后端侧`, rSide, 1, row.ratio, "登记比值");
  const vCross = bandVerdict(`${row.label} · 两侧一致`, mSide, rSide, 1);
  return { row, mSide, rSide, vs: [vMock, vReal, vCross] };
});

/** J3 · 一侧独有的路径：真后端有 mock 没有 = 一边没有数（未登记即红）。 */
const j3NewReal = onlyReal.filter((p) => !ONLY_REAL_KNOWN.some((k) => k.re.test(p)));
const j3NewMock = onlyMock.filter((p) => !ONLY_MOCK_KNOWN.some((k) => k.re.test(p)));

/* ── 取不到数 ⇒ RC=2（必须在判红之前，否则「我没查出来」会被写成「你违规了」）── */
const missing = [...j0.map((x) => x.v), ...j2.flatMap((x) => x.vs)].filter((v) => v.missing);
if (missing.length) {
  console.error("⛔ 有判据项在两侧回包里取不到数 —— 本次结论作废（**不许**读作「量级一致」）：");
  for (const v of missing) console.error(`  · ${v.reason}`);
  console.error("   多半是两侧的回包形状改了（字段改名 / 接口换路），先修取值路径再下结论。");
  process.exit(2);
}

/* ── 报告 ── */
const fmt = (n) => (typeof n === "number" ? (Number.isInteger(n) ? String(n) : n.toFixed(4)) : String(n));
const tier = (x) => (x.exp ? (x.exp.zero ? "C" : "B") : "A");

if (argv.has("--json")) {
  console.log(JSON.stringify({ mock: MOCK, real: REAL, j0: j0.map((x) => ({ path: x.path, tier: tier(x), ...x.v })), j2: j2.map((x) => ({ id: x.row.id, mSide: x.mSide, rSide: x.rSide, vs: x.vs })), onlyReal, onlyMock }, null, 1));
  process.exit(0);
}

if (argv.has("--table")) {
  console.log("| # | 指标（现算路径） | mock 值 | 真后端值 | 倍数（现算） | 登记区间 | 定性 |");
  console.log("|---|---|---|---|---|---|---|");
  let i = 0;
  const TIER_TEXT = { A: "量级同·口径同（已对齐）", B: "**量级不同但口径相同 ⇒ 真差异**", C: "**一边没有数**（不是量级差）" };
  for (const x of j0) {
    if (tier(x) === "A" && !LABELS[x.path]) continue; // A 档只列有标签的代表行，其余进汇总数
    const label = LABELS[x.path] ? `${LABELS[x.path]}<br>\`${x.path}\`` : `\`${x.path}\``;
    console.log(`| ${++i} | ${label} | ${fmt(x.m)} | ${fmt(x.r)} | ${Number.isFinite(x.v.ratio) ? `${fmt(x.v.ratio)}×` : "—"} | ${Number.isFinite(x.v.lo) && x.v.hi ? `[${fmt(x.v.lo)}, ${fmt(x.v.hi)}]` : "—"} | ${TIER_TEXT[tier(x)]} |`);
  }
  for (const { row, mSide, rSide } of j2) {
    console.log(`| ${++i} | ${row.label} | ${fmt(mSide)}× | ${fmt(rSide)}× | ${fmt(mSide / rSide)}×（两侧之比） | [${fmt(band(row.ratio)[0])}, ${fmt(band(row.ratio)[1])}] | **口径不同**（两侧各自都是这个数，不是 mock↔后端的差） |`);
  }
  for (const p of onlyReal) {
    const k = ONLY_REAL_KNOWN.find((x) => x.re.test(p));
    console.log(`| ${++i} | \`${p}\` | **不存在** | ${fmt(rLeaves.get(p))} | — | — | **一边没有数**${k ? "（已登记）" : "（**未登记**）"} |`);
  }
  process.exit(0);
}

const nA = j0.filter((x) => tier(x) === "A").length;
const nB = j0.filter((x) => tier(x) === "B").length;
const nC = j0.filter((x) => tier(x) === "C").length;
console.log(`· 金丝雀 ${canaryResults.length}/${canaryResults.length} 全中（判据双向 1 · 两侧抽取 2 · 叶差集 1 · 取不到即 missing 1 · 回包正则 1 · **身份归一 1** · 受检面下界 1）——两侧的数都真取到了，下面的结论才有资格被相信。`);
console.log(`· 两侧均**现算**：mock = 真派发 MSW handler + 模块图求值 · 真后端 = datacore 内存起服 + seedBattery(seed=42, scale=S) 真跑五步与求解器。`);
console.log(`· **受检面现算，不是手抄名册**：mock 数值叶 ${mLeaves.size} · 真后端 ${rLeaves.size} · **交集 ${both.length} 全部逐条比过**（A 档 ${nA} · B 档真差异 ${nB} · C 档一边没有数 ${nC}）。`);

const j0Bad = j0.filter((x) => !x.v.ok);
const j2Bad = j2.flatMap((x) => x.vs).filter((v) => !v.ok);
console.log(`· J0 同口径对拍：${both.length} 行 · **越界 ${j0Bad.length} 行**`);
console.log(`· J2 跨口径关系保真：${J2.length} 组 × 3 判据 · **越界 ${j2Bad.length} 条**`);
console.log(`· J3 一侧独有：真后端独有 ${onlyReal.length} 条（未登记 ${j3NewReal.length}）· mock 独有 ${onlyMock.length} 条（未登记 ${j3NewMock.length}）`);

if (argv.has("--verbose")) {
  for (const x of j0) console.log(`    ${x.v.ok ? "✓" : "✗"} [${tier(x)}] ${x.v.reason}`);
  for (const { row, mSide, rSide } of j2) console.log(`    · ${row.label}：mock ${fmt(mSide)}× vs 真后端 ${fmt(rSide)}×（登记 ${fmt(row.ratio)}×）`);
  for (const p of onlyReal) console.log(`    · 仅真后端有：${p} = ${fmt(rLeaves.get(p))}`);
  for (const p of onlyMock) console.log(`    · 仅 mock 有：${p} = ${fmt(mLeaves.get(p))}`);
}

if (j0Bad.length || j2Bad.length || j3NewReal.length || j3NewMock.length) {
  console.error(`\n✗ mock-backend-scale:check 未通过：`);
  for (const x of j0Bad) {
    console.error(`  - [J0 ${tier(x)}] ${x.v.reason}`);
    console.error(
      `      → 两侧算的是**同一个东西**，比值该是 ${x.exp ? `登记的 ${fmt(x.exp.ratio)}×（${x.exp.why}）` : "1×（默认：两侧该相等）"}。` +
        `\n        修：先判是哪一侧动的（真后端动 ⇒ 真的口径演进，更新 EXPECTED 并写明 why；` +
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
  for (const p of j3NewReal) {
    console.error(`  - [J3] 真后端有、mock 没有的**未登记**量：\`${p}\` = ${fmt(rLeaves.get(p))}`);
    console.error(`      → **一边没有数 ≠ 量级差**，修法不同：要么补上，要么进 ONLY_REAL_KNOWN 并写明 why。`);
  }
  for (const p of j3NewMock) {
    console.error(`  - [J3] mock 有、真后端没有的**未登记**量：\`${p}\` = ${fmt(mLeaves.get(p))}`);
    console.error(`      → mock 在提供一个真后端不产出的量（G-MOCK-OVERCLAIM 同族）。要么删，要么进 ONLY_MOCK_KNOWN 并写明 why。`);
  }
  process.exit(1);
}

console.log(`\n✓ mock-backend-scale:check 通过：J0 ${both.length} 行、J2 ${J2.length} 组、J3 一侧独有 ${onlyReal.length + onlyMock.length} 条，全部在登记区间/名单内。`);
console.log(`  （诚实边界：本门守的是「登记的比值不许漂」，**不判定这些比值本身对不对** —— 对不对是产品/数据决策，见 docs/MOCK-BACKEND-SCALE.md。）`);
