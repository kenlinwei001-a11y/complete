#!/usr/bin/env node
/**
 * 门 `oee-ssot:check` · **同屏 OEE 口径混用门**（WO-OEE-SSOT · 断点 `G-OEE-DUAL-TRUTH`）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * 「设备 OEE」这一个量，本仓有**三套**互不知情的真值源（实测见 `docs/DECISION-oee-ssot.md` §1）：
 *
 *   | 口径 | 落点 | demo(seed 42/scale S) 算出的「最差设备」 |
 *   |---|---|---|
 *   | ① 铭牌三原子 | `Equipment.oeeA × oeeP × oeeQ` | `LINE-WS-changzhou-formation-winding-E2` 0.769233 |
 *   | ② 时序快照   | `Equipment.oee_current`（`oee_daily_7d@v1` 7 日加权物化） | `LINE-WS-jinhua-slitting-winding-E1` 0.710781 |
 *   | ③ 日事实表   | `EquipmentOEE.oee`（5460 行 · 自带 a/p/q） | `LINE-WS-xinyang-formation-coating-E1` 0.776429 |
 *
 * 三套两两「最差 10 台」名单重叠 **0/10 · 0/10 · 1/10** —— 不是精度差异，是**指向不同的设备**。
 *
 * **本门不替仓主选哪一套当权威**（那是 `docs/DECISION-oee-ssot.md` 要的裁决）。
 * 本门只守一条**无论选哪套都成立**的命题：
 *
 *   > **同一个屏上出现了不止一套 OEE 口径，就必须让用户看得出哪个数是哪一套。**
 *
 * 拦的是「两个数打架而用户不知道」。裁决前它就有价值：裁决可能要几周，
 * 而屏上"OEE 71%"与"可用率 OEE-A"并排显示、彼此不相乘的状态**今天**就在误导人。
 *
 * ══ 守的命题（判据·两步）═══════════════════════════════════════════════════════
 *  ① **触及**：一个屏文件（`views/` `pages/` `components/`）的**非注释**文本里出现了某口径的锚
 *     （标识符 / 字符串字面量 / JSX 文本都算 —— 后两者本来就会上屏；**注释不算**：注释不上屏）。
 *  ② **披露**：若一个屏触及 ≥2 套口径，则**每一套**都必须在该屏的**可上屏文本**
 *     （字符串字面量或 JSX 文本，**不含注释**）里出现自己的口径标识串（`disclose`）。
 *     缺任何一套的披露 ⇒ **RC=1**，点名 file + 缺的是哪一套 + 触及证据行。
 *
 * 为什么披露必须落在"可上屏文本"而不是注释：本仓 2026-08-11 实测过
 * （`check-backend-frontend-seam.mjs` 散文遮蔽那次）——**写在注释里的纪律不是机制**。
 * 一句 `// 这里的 OEE 是时序口径` 对着屏幕前的人一个字都不显示。
 *
 * ══ 诚实边界（本门做不到什么 · 不许当成「口径已统一」）═══════════════════════════
 *  · 本门是**静态文本**判据，量的是「屏上标没标」，**不量「数对不对」**。
 *    三套口径本身仍然并存 —— 那要靠裁决 + 后续 WO 收敛，本门只保证它不再是隐形的。
 *  · 口径经**后端字段名**流到屏上时（如 `bottleneck_matrix.设备OEE` 背后是 `equipmentOee()`→
 *    `oee_current`），本门靠 `screenClaim` 串识别；后端换个字段名而前端照抄，本门看不见。
 *  · 只扫前端屏文件。后端把两套口径算进同一个响应（`capacity.ts:264` 的 `oeeAvg` 经
 *    `equipmentOee` 出，却无条件标 `prop:"oee_current"`）本门**不覆盖**——那是 §5 建议的后续单。
 *  · 「披露串存在」≠「披露串真的渲染在那个数旁边」。本门保证的是**结构上有**，
 *    像不像话要人看。（同 `check-gate-exit-discipline.mjs` 的诚实边界。）
 *  · **属性名由后端运行时下发的屏，本门一个字都看不见** —— 实测标本：
 *    `views/process/ProcessInspectPanel.tsx` 用 `displayName ?? propKey` 渲染属性表，
 *    而 `Equipment` 的四个 OEE 属性中文名（`battery.ts` `PROP_DISPLAY_NAMES`：
 *    `oeeA`→"OEE可用率" · `oeeP`→"OEE表现性" · `oeeQ`→"OEE质量率" · `oee_current`→"OEE"）
 *    经 `withPropDisplayNames` → `PropertyDef.displayName` → REST 下发，**前端文件里没有任何字面量**。
 *    于是「同一张属性表上四个 OEE 名并列、且 A×P×Q ≠ OEE」这个真实混用，
 *    本门判为「未触及」。这一半只能靠接缝测试或后端侧的门接住 —— 见 `docs/DECISION-oee-ssot.md` §5。
 *
 * ══ 金丝雀（保命判据 · 每次运行都先跑）════════════════════════════════════════
 * 开扫之前先拿样例过一遍 `analyzeScreen()` —— **与主逻辑同一份实现，不另抄正则**
 * （抄一份 = 装饰品：改主逻辑时金丝雀拿旧的去测、照样绿。本仓 2026-08-08 实测过）。
 * 五条金丝雀各钉一个真实踩过的坑：
 *   C1 **确知必中的真文件**：`views/sim/physicalTopology.ts` 必须被认出触及 ③（`EquipmentOEE`）。
 *      —— 报「0 命中 / 仓库很干净」之前先证明我这把尺子量得到东西（铁律 0.6）。
 *   C2 **确知违规的样例**：同屏 ②+① 且零披露 ⇒ 必判违规。
 *   C3 **确知合规的样例**：同屏 ②+① 但两套都有可上屏披露串 ⇒ 必判干净（**双向**，
 *      只验前者的门会把「披露」写坏成恒红，那是拿更糟的假红换假绿）。
 *   C4 **注释不算触及**：整段口径只出现在 `//` 与 `/* *\/` 里 ⇒ 必判未触及。
 *      （同门栽过的「注释里的散文被当成真引用」。）
 *   C5 **注释里的披露不算披露**：触及两套、披露串只写在注释里 ⇒ 必判违规。
 *      这条是 C3 的反向锁：没有它，「加个注释」就能洗白，门变装饰品。
 * 任一不中 ⇒ 打印「⛔ 门自己瞎了」并 **RC=2**，绝不报「全仓口径都标明了」。
 *
 * ══ 棘轮（存量豁免）════════════════════════════════════════════════════════════
 * 存量违规记在下方 `LEGACY`（每条必须写 `why` + 归属 WO）。**只许降不许升**：
 * 不在名单里的违规 ⇒ 红；已经修好却还挂在名单上 ⇒ **也红**（逼名单单调收缩）。
 *
 * 本体登记：`docs/SYSTEM-ONTOLOGY.md` §7（门）· §8 `G-OEE-DUAL-TRUTH`。
 * 门账：`scripts/gate-ledger.json`。裁决材料：`docs/DECISION-oee-ssot.md`。
 *
 * 用法：
 *   node scripts/check-oee-ssot.mjs                 # 门（0 干净 / 1 真违规 / 2 门自己坏了）
 *   node scripts/check-oee-ssot.mjs --census        # 全表：每个屏触及哪几套、披露了哪几套
 *   node scripts/check-oee-ssot.mjs --explain <f>   # 单文件逐条证据
 *   node scripts/check-oee-ssot.mjs --selftest      # 金丝雀 + RC=0/1/2 三条路径起子进程机验
 *   node scripts/check-oee-ssot.mjs --scan-root <d> # 只扫指定目录（selftest 用）
 */

/* ── 兜底必须**最先**注册：它要覆盖的正是「后面任何一行崩了」。
 *    实测（node v22.22.2）：顶层同步 throw 走 uncaughtException，
 *    顶层 await 之后的 throw 走 unhandledRejection —— 两个都要挂，只挂一个有洞。 */
process.on("uncaughtException", (e) => bail(e));
process.on("unhandledRejection", (e) => bail(e));
function bail(e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { lex, walk } from "./lib/source-lex.mjs";

const ROOT = process.cwd();
const ARGV = process.argv.slice(2);
const MUTATE = process.env.OEE_SSOT_MUTATE || ""; // 门自变异（只给 --selftest 用，证明金丝雀有牙）

/* ══ RC=2 单一出口 ═════════════════════════════════════════════════════════════ */
function toolBroken(reason, detail) {
  console.error(`⛔ oee-ssot:check —— 门自己坏了：${reason}`);
  if (detail) console.error(`   ${detail}`);
  console.error("   RC=2 的含义只有一个：**我没查出来**。不许据此说「仓库口径已标明 / 无同屏混用」。");
  process.exit(2);
}

/* ══ 口径注册表（单一来源 · 数值不入表，本表只声明「哪些串代表哪一套口径」）════════ */
const CALIPERS = {
  NAMEPLATE: {
    zh: "① 设备三原子（Equipment.oeeA/oeeP/oeeQ）",
    // 触及锚：代码里读这三个原子，或屏上印出它们的业务名
    anchors: ["oeeA", "oeeP", "oeeQ", "OEE-A", "OEE-P", "OEE-Q", "OEE可用率", "OEE表现性", "OEE质量率"],
    // 披露串：屏上出现它，用户才分得出「这个数是哪套口径」
    disclose: ["oeeA", "oeeP", "oeeQ", "铭牌"],
  },
  TS_SNAPSHOT: {
    zh: "② 设备综合 OEE（Equipment.oee_current）",
    // `设备OEE` 是后端 bottleneck_matrix 的 BN 因子名，其值经 capacity.ts equipmentOee() 出 = oee_current
    // （WO-OEE-UNIFY 裁决 C 后：oee_current = EquipmentOEE 事实表 7 日均值；原 oee_daily_7d@v1 物化已撤）
    anchors: ["oee_current", "设备OEE"],
    disclose: ["oee_current", "时序"],
  },
  FACT_TABLE: {
    zh: "③ IoT 日粒度事实表（EquipmentOEE.oee）",
    anchors: ["EquipmentOEE"],
    disclose: ["EquipmentOEE"],
  },
};
const CALIPER_KEYS = Object.keys(CALIPERS);

/* ══ 存量豁免（只许降不许升 · 每条必须写 why）════════════════════════════════════ */
// 2026-08-16 WO-OEE-UNIFY：建门当天挂账的唯一一条（factorOntology.ts 圈号 ③ 名不副实）
// 已随仓主裁决 C 落地修好（③ 改名标明「综合·oee_current·EquipmentOEE 事实表7日均值」，
// ④⑦ 标「③分解·oeeP/oeeQ·事实表7日均值」），按棘轮同批删除——豁免清空，判据未放软。
const LEGACY = {};
const LEGACY_KEYS = new Set(Object.keys(LEGACY));

/* ══ 扫描面 ════════════════════════════════════════════════════════════════════ */
// 「屏」= 用户看得见的前端产物。mocks/test 不是屏（只有 mock 引用 = 已排练不是已实现）。
const SCREEN_ROOTS = ["apps/frontend-shell/src/views", "apps/frontend-shell/src/pages", "apps/frontend-shell/src/components"];
function screenFiles(root) {
  const acc = [];
  for (const r of SCREEN_ROOTS) walk(join(root, r), acc);
  return acc.filter((p) => !/[/\\](mocks|__tests__)[/\\]/.test(p) && !/\.(test|spec)\.tsx?$/.test(p)).sort();
}

/* ══ 主逻辑（金丝雀与扫描共用这一份 · 不许各抄一份）════════════════════════════ */
/**
 * 把源码切成三种区域，再判「触及」与「披露」。
 *  - 注释区（M_COMMENT）：**既不算触及、也不算披露** —— 注释不上屏。
 *  - 字符串/模板字面量（M_STRING）：算触及，且是**合法披露载体**。
 *  - 其余非注释文本（代码标识符 + JSX 文本）：算触及；JSX 文本同样是合法披露载体。
 *
 * JSX 文本在 `lex()` 里落在 M_CODE 区（它不是字符串字面量）。屏上它照样显示，
 * 故披露载体 = **非注释文本**，而不是「仅字符串字面量」——只认字符串会把
 * `<code>EquipmentOEE</code>` 这种真披露读成没披露。
 */
function analyzeScreen(src) {
  const anchorsOf = (k) => (MUTATE === "empty-anchors" ? [] : CALIPERS[k].anchors);
  const { mask, strings } = lex(src);
  // ① 触及面 = **非注释**文本（注释抹成空格，保留下标与行号，故行号仍准）
  const visible = Array.from(src, (ch, i) => (mask[i] === 1 ? (ch === "\n" ? "\n" : " ") : ch)).join("");
  // ② 披露面 = **字符串/模板字面量**。
  //    为什么不能把裸标识符也算披露：`const oee = row.oee_current` 里的 `oee_current`
  //    是接线名，屏幕上一个字都不显示。若把它算披露，「用了就算标明了」——判据自我循环，
  //    门恒绿。（这一条是本门第一版写错、被 C2 当场抖出来的，原样留在这里当路标。）
  //    保守取舍：JSX 文本（`<code>EquipmentOEE</code>`）落在 M_CODE 区，本门**不当披露**，
  //    宁可多报也不少报（同 check-gate-exit-discipline 判据②(b) 的取舍）。
  const disclosureText =
    MUTATE === "comment-counts-as-disclosure"
      ? src // 门自变异：把注释也当披露载体 ⇒ C4/C5 必须当场不中
      : strings.map((s) => s.value).join("\n");
  const scanText = MUTATE === "comment-counts-as-disclosure" ? src : visible;

  const hasAnchor = (text, a) => {
    let from = 0, idx;
    const out = [];
    while ((idx = text.indexOf(a, from)) !== -1) {
      // 词边界：纯 ASCII 锚要求两侧非 [A-Za-z0-9_]（避免 oeeA 命中 oeeAvg）；含 CJK 的锚不设边界
      const okL = !/[A-Za-z0-9_]/.test(text[idx - 1] ?? "");
      const okR = !/[A-Za-z0-9_]/.test(text[idx + a.length] ?? "");
      if (!/^[\x20-\x7e]+$/.test(a) || (okL && okR)) out.push(idx);
      from = idx + a.length;
    }
    return out;
  };

  const touched = {}, disclosed = new Set();
  for (const k of CALIPER_KEYS) {
    const hits = [];
    for (const a of anchorsOf(k)) {
      for (const idx of hasAnchor(scanText, a)) hits.push({ anchor: a, line: scanText.slice(0, idx).split("\n").length });
    }
    if (hits.length > 0) touched[k] = hits;
    for (const d of CALIPERS[k].disclose) if (hasAnchor(disclosureText, d).length > 0) { disclosed.add(k); break; }
  }
  const touchedKeys = Object.keys(touched);
  const missing = touchedKeys.length >= 2 ? touchedKeys.filter((k) => !disclosed.has(k)) : [];
  return { touched, touchedKeys, disclosed: [...disclosed], missing, mixed: touchedKeys.length >= 2 };
}

/* ══ 金丝雀（与主逻辑同一份实现）══════════════════════════════════════════════ */
const FIX_VIOLATION = `
export function Panel() {
  const oee = row.oee_current;        // 口径②
  const a = equip.oeeA, p = equip.oeeP;
  return <div>{oee} / {a} / {p}</div>;
}
`;
const FIX_CLEAN = `
export function Panel() {
  const oee = row.oee_current;
  const a = equip.oeeA;
  const src1 = "时序 7 日加权物化（oee_current）";
  const src2 = "铭牌 oeeA（设备台账静态值）";
  return <div><span>{src1}：{oee}</span><span>{src2}：{a}</span></div>;
}
`;
const FIX_COMMENT_ONLY = `
// 这里本来要读 oee_current，也考虑过 oeeA×oeeP×oeeQ 和 EquipmentOEE
/* 口径②/③ 的说明：设备OEE 与 EquipmentOEE 都不在这段代码里用 */
export function Panel() { return <div>hello</div>; }
`;
const FIX_COMMENT_DISCLOSURE = `
// 披露：下面第一个数是 oee_current（时序），第二个是 oeeA（铭牌）
export function Panel() {
  const oee = row.oee_current;
  const a = equip.oeeA;
  return <div>{oee} / {a}</div>;
}
`;

function runCanaries(root) {
  const fails = [];
  // C1 确知必中的真文件
  const real = join(root, "apps/frontend-shell/src/views/sim/physicalTopology.ts");
  if (!existsSync(real)) {
    fails.push(`C1 金丝雀样本文件不存在：${relative(root, real)} —— 扫描面挪了位，本门量的可能已不是屏`);
  } else {
    const r = analyzeScreen(readFileSync(real, "utf8"));
    if (!r.touchedKeys.includes("FACT_TABLE")) fails.push("C1 确知必中的真文件里没认出 ③ EquipmentOEE ⇒ 这把尺子量不到东西");
  }
  // C2 确知违规
  const c2 = analyzeScreen(FIX_VIOLATION);
  if (!(c2.mixed && c2.missing.length > 0)) fails.push("C2 同屏两套且零披露的样例没被判违规");
  // C3 确知合规（双向）
  const c3 = analyzeScreen(FIX_CLEAN);
  if (!(c3.mixed && c3.missing.length === 0)) fails.push("C3 同屏两套但都已披露的样例被误判违规（门写坏成恒红 = 更糟的假红）");
  // C4 注释不算触及
  const c4 = analyzeScreen(FIX_COMMENT_ONLY);
  if (c4.touchedKeys.length !== 0) fails.push(`C4 只在注释里提到口径的样例被判为触及（${c4.touchedKeys.join("/")}）⇒ 散文被当成使用`);
  // C5 注释里的披露不算披露
  const c5 = analyzeScreen(FIX_COMMENT_DISCLOSURE);
  if (!(c5.mixed && c5.missing.length === 2)) fails.push("C5 披露只写在注释里的样例被判合规 ⇒ 加个注释就能洗白，门是装饰品");
  return fails;
}

/* ══ 报告 ══════════════════════════════════════════════════════════════════════ */
function scan(root) {
  const files = screenFiles(root);
  if (files.length === 0) return { files, rows: [] };
  const rows = [];
  for (const f of files) {
    const rel = relative(root, f).replace(/\\/g, "/");
    const r = analyzeScreen(readFileSync(f, "utf8"));
    if (r.touchedKeys.length > 0) rows.push({ rel, ...r });
  }
  return { files, rows };
}

/* ══ selftest：RC=0/1/2 三条路径起子进程真跑 ═══════════════════════════════════ */
function selftest() {
  const canary = runCanaries(ROOT);
  if (canary.length > 0) { console.error("⛔ 金丝雀不中：\n  " + canary.join("\n  ")); process.exit(2); }
  console.log("✓ 金丝雀 C1–C5 全中（与主逻辑同一份 analyzeScreen）");

  const box = join(tmpdir(), `oee-ssot-selftest-${process.pid}`);
  const mk = (sub, name, body) => {
    const d = join(box, sub, "apps/frontend-shell/src/views");
    mkdirSync(d, { recursive: true });
    // C1 需要真文件在位，否则子进程会正确地报 RC=2；给每个盒子放一份最小替身
    const sim = join(box, sub, "apps/frontend-shell/src/views/sim");
    mkdirSync(sim, { recursive: true });
    writeFileSync(join(sim, "physicalTopology.ts"), 'export const S = { source: "EquipmentOEE" };\n');
    // LEGACY 名单里的真文件必须**原样搬进盒子**：不搬，悬空豁免棘轮会把「这个盒子里没有它」
    // 读成「它没了」而报红 —— 那不是本门要守的命题，是沙盒失真。搬进来还顺带端到端验了豁免机制本身。
    for (const k of LEGACY_KEYS) {
      const srcF = join(ROOT, k);
      if (!existsSync(srcF)) toolBroken(`LEGACY 里的 ${k} 在仓里不存在 —— 豁免指向空气，selftest 无法构造如实沙盒`);
      const dst = join(box, sub, k);
      mkdirSync(join(dst, ".."), { recursive: true });
      writeFileSync(dst, readFileSync(srcF, "utf8"));
    }
    writeFileSync(join(d, name), body);
    return join(box, sub);
  };
  const self = new URL(import.meta.url).pathname;
  const run = (cwd, env = {}) => spawnSync(process.execPath, [self], { cwd, encoding: "utf8", env: { ...process.env, ...env } });

  const results = [];
  // RC=0：干净盒（同屏两套但都披露）
  results.push(["RC=0 干净", 0, run(mk("clean", "Panel.tsx", FIX_CLEAN))]);
  // RC=1：变异反证 —— 故意同屏混用两套且不标明
  results.push(["RC=1 真违规（变异反证）", 1, run(mk("dirty", "Panel.tsx", FIX_VIOLATION))]);
  // RC=2：门自变异 —— 抽干锚表，金丝雀必须当场不中
  results.push(["RC=2 门自己坏了（门自变异 empty-anchors）", 2, run(mk("clean2", "Panel.tsx", FIX_CLEAN), { OEE_SSOT_MUTATE: "empty-anchors" })]);
  // RC=2 第二发：让注释也算数 ⇒ C4/C5 必须不中（证明"注释不上屏"这条判据不是摆设）
  results.push(["RC=2 门自己坏了（门自变异 comment-counts-as-disclosure）", 2, run(mk("clean3", "Panel.tsx", FIX_CLEAN), { OEE_SSOT_MUTATE: "comment-counts-as-disclosure" })]);

  let bad = 0;
  for (const [name, want, r] of results) {
    const got = r.status;
    console.log(`\n── ${name} ── 期望 RC=${want}，实得 RC=${got} ${got === want ? "✓" : "✗"}`);
    console.log((r.stdout || "").trim().split("\n").slice(0, 6).join("\n"));
    if ((r.stderr || "").trim()) console.log((r.stderr || "").trim().split("\n").slice(0, 6).join("\n"));
    if (got !== want) bad++;
  }
  rmSync(box, { recursive: true, force: true });
  if (bad > 0) { console.error(`\n✗ selftest：${bad} 条退出码路径不符 —— 本门的 RC 语义不可信`); process.exit(2); }
  console.log("\n✓ selftest 全通过：RC=0/1/2 三条路径均已起子进程实测。");
  process.exit(0);
}

/* ══ 入口（顶层 try 是 Program 的直接子语句）═══════════════════════════════════ */
try {
  if (ARGV.includes("--selftest")) selftest();

  const rootIdx = ARGV.indexOf("--scan-root");
  const scanRoot = rootIdx >= 0 ? resolve(ARGV[rootIdx + 1] ?? ".") : ROOT;

  // 金丝雀先跑：不中就报「工具坏了」，绝不报「仓库很干净」
  const canary = runCanaries(scanRoot);
  if (canary.length > 0) toolBroken("金丝雀不中", canary.join("\n   "));

  const explainIdx = ARGV.indexOf("--explain");
  if (explainIdx >= 0) {
    const f = resolve(ARGV[explainIdx + 1] ?? "");
    if (!existsSync(f)) toolBroken(`--explain 的文件不存在：${ARGV[explainIdx + 1]}`);
    const r = analyzeScreen(readFileSync(f, "utf8"));
    console.log(`【${relative(scanRoot, f)}】`);
    for (const k of r.touchedKeys) {
      console.log(`  触及 ${CALIPERS[k].zh}`);
      for (const h of r.touched[k].slice(0, 8)) console.log(`     行 ${h.line}  锚「${h.anchor}」`);
      console.log(`     披露：${r.disclosed.includes(k) ? "有" : "**无**"}`);
    }
    if (r.touchedKeys.length === 0) console.log("  未触及任何 OEE 口径");
    process.exit(0);
  }

  const { files, rows } = scan(scanRoot);
  if (files.length === 0) toolBroken(`扫描面为空：${SCREEN_ROOTS.join(" / ")} 下一个屏文件都没有（扫错根目录？）`);

  if (ARGV.includes("--census")) {
    console.log(`扫描面 ${files.length} 个屏文件，其中 ${rows.length} 个触及 OEE 口径：\n`);
    for (const r of rows) {
      console.log(`  ${r.mixed ? (r.missing.length ? "✗" : "✓") : "·"} ${r.rel}`);
      console.log(`      触及 ${r.touchedKeys.length} 套：${r.touchedKeys.join(" + ")}   披露：${r.disclosed.join(" + ") || "无"}`);
    }
    process.exit(0);
  }

  const violations = rows.filter((r) => r.missing.length > 0 && !LEGACY_KEYS.has(r.rel));
  // 棘轮：豁免只许降不许升。三种情形分开判 —— 混为一谈会让 --scan-root 沙盒把
  // 「这个盒子里本来就没有那个文件」误读成「它已经修好了」（本门 selftest 第一版就是这么红的）。
  const staleLegacy = [];
  const danglingLegacy = [];
  for (const k of LEGACY_KEYS) {
    if (rows.some((r) => r.rel === k && r.missing.length > 0)) continue; // 仍在违规 → 豁免仍属实
    if (existsSync(join(scanRoot, k))) staleLegacy.push(k);              // 文件在、已不违规 → 过期豁免
    else if (scanRoot === ROOT) danglingLegacy.push(k);                  // 全仓扫时文件不在 → 悬空豁免
    // scanRoot !== ROOT 且文件不在：本次根本没扫到它，**不下结论**（不许把"我没扫"读成"它没事"）
  }

  if (violations.length === 0 && staleLegacy.length === 0 && danglingLegacy.length === 0) {
    const mixed = rows.filter((r) => r.mixed);
    const exempt = mixed.filter((r) => r.missing.length > 0 && LEGACY_KEYS.has(r.rel));
    console.log(
      `✓ oee-ssot:check 通过：扫了 ${files.length} 个屏文件，${rows.length} 个触及 OEE 口径，其中 ${mixed.length} 个同屏出现 ≥2 套。\n` +
        `  · 无名单外的未标明混用（${mixed.length - exempt.length} 个混用屏已在可上屏文本里标明各自口径）\n` +
        (exempt.length > 0
          ? `  ⚠ **但仍有 ${exempt.length} 个屏是挂在 LEGACY 豁免上过的，不是修好的**（绿 ≠ 干净）：\n` +
            exempt.map((r) => `      · ${r.rel} —— 缺 ${r.missing.map((k) => CALIPERS[k].zh).join(" / ")} 的披露；归属：${LEGACY[r.rel].owner}`).join("\n") +
            `\n    豁免只许降不许升：修好一条就同批从脚本内 LEGACY 删一条，否则棘轮判据会把过期豁免报红。\n`
          : "") +
        `  （金丝雀 C1–C5 已全中：真文件 physicalTopology.ts 认出 ③ · 违规样例判红 · 合规样例判绿 · 注释不算触及 · 注释里的披露不算披露）\n` +
        `  ⚠ 诚实边界：本门量的是「屏上标没标」，**不量「三套口径本身该不该并存」**——那是 docs/DECISION-oee-ssot.md 的裁决。`,
    );
    process.exit(0);
  }

  console.error("✗ oee-ssot:check 未通过 —— 同一个屏上有 ≥2 套 OEE 口径，而用户看不出哪个数是哪一套：\n");
  for (const v of violations) {
    console.error(`  ${v.rel}`);
    console.error(`     同屏触及 ${v.touchedKeys.length} 套口径：`);
    for (const k of v.touchedKeys) {
      const h = v.touched[k][0];
      console.error(`       · ${CALIPERS[k].zh}`);
      console.error(`         证据：行 ${h.line} 出现锚「${h.anchor}」（共 ${v.touched[k].length} 处）  披露：${v.disclosed.includes(k) ? "有" : "**无**"}`);
    }
    console.error(`     缺披露：${v.missing.map((k) => CALIPERS[k].zh).join(" · ")}`);
    console.error(
      `     最小修路径：在该屏**可上屏的文本**（字符串字面量或 JSX 文本，注释不算）里写出这个数用的是哪一套，` +
        `例如 ${v.missing.map((k) => `「${CALIPERS[k].disclose[0]}」`).join(" / ")}。` +
        `\n     —— 本门不要求你现在就统一口径（那要等 docs/DECISION-oee-ssot.md 的裁决），只要求别让两个数打架而用户不知道。\n`,
    );
  }
  for (const k of staleLegacy) {
    console.error(`  棘轮：${k} 已不再违规，却仍挂在脚本内 LEGACY 名单上 —— 豁免只许降不许升，请同批删掉该条。`);
  }
  for (const k of danglingLegacy) {
    console.error(`  棘轮：LEGACY 里的 ${k} 在仓里已不存在 —— 文件删了账没删，豁免指向空气，请同批删掉该条。`);
  }
  console.error(`共 ${violations.length} 处未标明的同屏混用 + ${staleLegacy.length} 条过期豁免 + ${danglingLegacy.length} 条悬空豁免。`);
  console.error(`背景与裁决材料：docs/DECISION-oee-ssot.md · 断点 G-OEE-DUAL-TRUTH（docs/SYSTEM-ONTOLOGY.md §8）`);
  process.exit(1);
} catch (e) {
  bail(e);
}
