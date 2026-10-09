import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { STATE_VAR_DOMAINS } from "../src/synthetic/battery.js";
import type { TickState } from "@platform/contracts";

/**
 * WO-RESTPOINT-SOURCE-B 第二件 · **两条线必须喂同一份源侧静息点**（SEAM：路由 × 核 × 影子线）。
 *
 * ══ 本单引入的新不变量，以及它为什么必须有物守着 ═══════════════════════════════════
 *
 * `WO-RESTPOINT-SOURCE-B` 把驱动量改成 `drive = 源读数 − 源侧静息点`，静息点取
 * `s.baseSnapshot`（这个世界 tick0 的基值）。于是 `propagateTick(` 的第 11 位实参
 * **同一次 tick 推进里出现三处**（主线 / 影子线重放段 / 影子线逐拍段），
 * 而 `app.ts` 自己写着这条不变量：
 *
 *   > 「两条线只许差「有没有扰动」这一个变量，任何别的差异都会直接污染信噪比那个读数。」（原注释）
 *
 * **全仓无物守着它。** 而本战役的根因恰恰是「同一个量被两个口径同时读，而全仓无物守着二者一致」
 * —— 这条**新引入**的不变量若无物守，就是同一个病换个地方复发（铁律 0.6 / SEAM-GATE）。
 *
 * ══ 两个半边（缺一半就是装饰品）═══════════════════════════════════════════════════
 *
 *  · §1 **结构臂**：剥注释后解析 `app.ts` 全部 `propagateTick(` 调用的实参，
 *    **带第 11 位的那些，第 11 位表达式必须全仓唯一**（"同源"的可判据形态）。
 *    为什么判「唯一」而不是写死 `s.baseSnapshot`：不变量是**同源**，不是某个变量名 ——
 *    将来把基值提成局部变量（`const baseline = s.baseSnapshot`）三处都传 `baseline`，
 *    本臂照样绿；只有**某处偷偷换了口径**（`{}` / 另一份拷贝 / 另一个来源）才红。
 *  · §2 **行为臂**：走真路由。**零效果扰动**（delta 0：值一格不动，但会话确实"有扰动" ⇒
 *    影子线真的在跑）⇒ 两条线必须**逐字节相同**：`userContribution === 0`、`changedCells === 0`、
 *    `ratio === 0`（是**恒等式**，不是阈值）。配一条**反向金丝雀**先跑：真扰动（+15）时
 *    同一探针必须读出 `userContribution > 0` —— 否则那个 0 可能只是探针坏了（本仓铁律：
 *    报否定结论前先跑必然命中的对照）。
 *    ⚠ 2026-10-09 订正（WO-SEMANTICS-DECLARED 收尾）：原「`worldDrift === 0`」判据已换 ——
 *    它拿「零扰动 ⇒ 世界逐拍恒定」当「两条线同源」的**代理**，而归位后偏离静息的起点按
 *    **声明衰减**回落（C2 对 `DEVIATION` 格跳过，不再锚回 base）⇒ 该代理对这类起点恒假。
 *    新判据 = 影子线漂移与**按声明衰减率现算**的轨迹对账（λ 取回执自报）；理由与逐位复算
 *    见 §2 内注释。
 *
 * ⚠ 为什么零效果扰动这一臂能同时咬住两处调用点：
 *    主线偷换口径（第 11 位变 `{}`）⇒ 主线按**水平**驱动、影子线仍按偏离 ⇒ 两条线分叉；
 *    影子线偷换口径 ⇒ 影子线按水平驱动、主线按偏离 ⇒ 同样分叉。两种都落在同一个恒等式上。
 *
 * ⚠ 已知边界（诚实写明，免得被读成"守住了全部"）：把某处换成 `simState(s.baseSnapshot)`
 *    这种**值相同**的拷贝时，行为臂**不会**红（值确实逐字节相同）—— 但结构臂会红，
 *    因为那已经不是"同一份"了（本臂有意收紧：副本是未来被就地改写的入口）。
 */

// ══ §1 用的解析器（剥注释 → 按括号配对切顶层实参；不看行号，行号会漂）══════════════
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`])\/\/.*$/gm, "$1");

/** 抽出源码里全部 `propagateTick(` 调用的**顶层实参**（跳字符串字面量，按深度 1 的逗号切）。 */
export function propagateCallArgs(source: string): string[][] {
  const src = stripComments(source);
  const out: string[][] = [];
  const needle = "propagateTick(";
  for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
    const args: string[] = [];
    let cur = "";
    let depth = 1;
    let quote: string | null = null;
    for (let j = i + needle.length; j < src.length; j++) {
      const ch = src[j]!;
      if (quote !== null) {
        cur += ch;
        if (ch === "\\") { cur += src[j + 1] ?? ""; j++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; cur += ch; continue; }
      if (ch === "(") depth += 1;
      else if (ch === ")") { depth -= 1; if (depth === 0) break; }
      else if (ch === "," && depth === 1) { args.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    args.push(cur.trim());
    out.push(args);
  }
  return out;
}

/** 带第 11 位的调用（= 参与「两条线同一个静息点」这个不变量的那些）。 */
const withRestPointArg = (source: string): string[][] =>
  propagateCallArgs(source).filter((a) => a.length >= 11);

const appSource = (): string =>
  readFileSync(fileURLToPath(new URL("../src/app.ts", import.meta.url)), "utf8");

describe("§1 结构臂：`app.ts` 里带第 11 位的调用，必须喂同一份静息点", () => {
  it("🐤 双向金丝雀：解析器数得对（正样例中、注释里的同形串不中、改了口径必须一眼看出）", () => {
    const good =
      "const a = propagateTick(g, s, r, p, t, rp, cg, [], pw, dom, s.baseSnapshot);\n" +
      "const b = propagateTick(g, s2, r, p2, t, rp, cg, [], pw, dom, s.baseSnapshot);";
    expect(withRestPointArg(good).map((a) => a[10])).toEqual(["s.baseSnapshot", "s.baseSnapshot"]);

    // 反向：把某一处口径偷换掉 ⇒ 解析器必须**看得出来**（否则它不是有牙的工具）。
    const bad = good.replace("const b = propagateTick(g, s2, r, p2, t, rp, cg, [], pw, dom, s.baseSnapshot);",
                             "const b = propagateTick(g, s2, r, p2, t, rp, cg, [], pw, dom, {});");
    expect(bad, "反证字符串没换上 ⇒ 下面那条断言恒真").not.toBe(good);
    expect(withRestPointArg(bad).map((a) => a[10]), "偷换了口径却读不出来 ⇒ 工具坏了").toEqual(["s.baseSnapshot", "{}"]);

    // 反向 2：把实参**删掉**（尾随逗号留在原处）⇒ 必须读成空串（"这一处没喂"），不是读不到。
    // ⚠ 尾随逗号是这个反证的全部要害：没有它，那只是"十个实参的调用"，压根不该被本臂数进来
    //   （第一版反证就漏了它，当场被这条金丝雀顶回来 —— 反证本身也要与真变异的形状一致）。
    const dropped = good.replace(
      "const b = propagateTick(g, s2, r, p2, t, rp, cg, [], pw, dom, s.baseSnapshot);",
      "const b = propagateTick(g, s2, r, p2, t, rp, cg, [], pw, dom,\n);",
    );
    expect(dropped, "反证字符串没换上 ⇒ 下面那条断言恒真").not.toBe(good);
    expect(withRestPointArg(dropped).map((a) => a[10]), "删了实参却读不出来 ⇒ 工具坏了").toEqual(["s.baseSnapshot", ""]);

    // 剥注释：只在注释里出现的同形串**不算**命中（本仓栽过：门 `toContain` 匹到注释里的同一串）。
    const commented =
      "// 曾写：propagateTick(g, s, r, p, t, rp, cg, [], pw, dom, s.baseSnapshot)\n" +
      "const a = propagateTick(g, s, r, p, t, rp, cg, [], pw, dom, s.baseSnapshot);";
    const parsed = propagateCallArgs(commented);
    expect(parsed.length, "注释里那处不该被数进来").toBe(1);
    expect(parsed[0]!.length).toBe(11);

    // 字符串里的逗号/括号不许把实参切乱（工具修了才敢信它的"唯一"结论）。
    const quoted = 'const a = propagateTick(g, s, r, p, t, rp, cg, [], pw, dom, pick("a,b(c)"));';
    const qArgs = propagateCallArgs(quoted)[0]!;
    expect(qArgs.length, "字符串里的逗号把实参切多了").toBe(11);
    expect(qArgs[10], "字符串里的括号把实参切歪了").toBe('pick("a,b(c)")');
  });

  it("头号判据：带第 11 位的调用全部同源（表达式唯一，且真的是 baseSnapshot）", () => {
    const sites = withRestPointArg(appSource());
    // 🐤 金丝雀：解析器必须真的看得到那几处（看不到 ⇒ 工具坏了，**不许**读成"不变量守住了"）。
    //    实测：主线 1 + 影子线重放段 1 + 影子线逐拍段 1 = 3 处（试算探针 9 参，刻意不在此列）。
    expect(sites.length, "🐤 金丝雀：一处带第 11 位的调用都没解析到 ⇒ 解析器坏了").toBeGreaterThanOrEqual(3);
    // 尾随逗号后面没有实参 ⇒ 上面那条 `length >= 11` 会把它**读成一个空串**（不是读不到）。
    // 单列一条，免得「把实参删了」被报成「喂了别的表达式」——两者都红，但修法不是一回事。
    const emptied = sites.filter((a) => a[10]!.trim() === "");
    expect(
      emptied.length,
      "有调用把第 11 位实参**删了**（尾随逗号后为空）⇒ 这一处根本没喂源侧静息点",
    ).toBe(0);
    const distinct = [...new Set(sites.map((a) => a[10]!))];
    expect(distinct, `两条线喂了不同的静息点：${JSON.stringify(distinct)}`).toHaveLength(1);
    expect(distinct[0], "第 11 位不是会话的 tick0 基值 ⇒ 影子线/主线有一边换口径了").toMatch(/\.baseSnapshot$/);
  });
});

// ══ §2 行为臂（真路由）════════════════════════════════════════════════════════════
async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });
  return t;
}

/** 常州基地 —— 与 `shadow-memo.seam.test.ts` 同一个（`line_belongs_to_base` 出边最全）。 */
const BASE_ID = "obj_base_changzhou";
/**
 * tick0 世界态。**必须偏离静息点**（`loadIndex` 是压力族，`restPoint = 0`）——
 * 影子线从"世界自己在走"的状态出发，`worldDrift > 0` 才有鉴别力（否则恒等式退化成 `0 === 0`）。
 * ⚠ WO-SEMANTICS-DECLARED 收尾（2026-10-09）：`Base|loadIndex` 归位成 `DEVIATION` 之后，
 *   「世界自己在走」的形态**就是声明衰减**（C2 对 DEVIATION 格跳过，不再把它锚回 base）⇒
 *   下面 `worldDrift` 的判据从「恒 0」改成「与按声明衰减率现算的轨迹对账」，理由见 §2 内注释。
 */
const BASE_STATE: TickState = { [BASE_ID]: { loadIndex: 30 } };

/** `arm()` 的拍结构：先 tick(1)（影子线的重放环只在 curTick>0 时才被真跑到），再 tick(3)。 */
const K_AFTER_WARMUP = 1;
const K_END = K_AFTER_WARMUP + 3;
/**
 * 影子线（= 零扰动世界自己走的那条线）在**本次推进窗口**里的期望漂移 —— **现算**，
 * ⛔ 不写死 `14.1741117`（那是今天这一组声明的得数，不是判据本身）。
 *
 * 影子线从 `baseSnapshot` 零扰动重放 ⇒ 每一格只按**声明衰减率**回落静息点：
 *   `x_k = rest + (x0 − rest) · (1 − λ)^k`（`propagation.ts` 衰减相逐字就是这个式子）
 * 本世界唯一在起点就偏离静息的格 = `BASE_STATE` 的 `loadIndex`（其余格起点即在静息/占位）
 * ⇒ `worldDrift` 的和就是这一格的 `|x_K_END − x_K_AFTER_WARMUP|`。
 * λ 取**本拍回执自报**的 `stateVarReport.decayApplied`、rest 取声明域 —— 两样都不是测试抄的常数。
 */
function expectedShadowDrift(lambda: number): number {
  const rest = STATE_VAR_DOMAINS.loadIndex!.restPoint;
  const x0 = BASE_STATE[BASE_ID]!.loadIndex as number;
  const at = (k: number) => rest + (x0 - rest) * (1 - lambda) ** k;
  return Math.abs(at(K_END) - at(K_AFTER_WARMUP));
}

interface Noise {
  worldDrift: number;
  userContribution: number;
  ratio: number | null;
  changedCells: number;
  totalCells: number;
}

/** 建会话（`pert` 三态：null = 不建扰动；否则按给定 payload 建在**建单后**）。 */
async function newSession(t: TestApp, pert: Record<string, unknown> | null): Promise<string> {
  const created = await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: BASE_STATE },
  });
  expect(created.statusCode, "建会话失败").toBe(201);
  const sid = created.json().id as string;
  if (pert === null) return sid;
  await addPert(t, sid, pert);
  return sid;
}

async function addPert(t: TestApp, sid: string, pert: Record<string, unknown>): Promise<void> {
  const p = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN, payload: pert,
  });
  expect(p.statusCode, `建扰动失败：${JSON.stringify(p.json()).slice(0, 200)}`).toBe(201);
}

/**
 * 一条完整的臂：建会话 → **先零扰动走 1 拍** → 再上扰动 → 再推 3 拍。
 *
 * ⚠ 那个「先走 1 拍」不是凑数：影子线的**重放环** `for (t = 0; t < s.curTick; t++)` 在
 * `curTick === 0` 时一次都不执行 —— 首跑的影子态是靠**逐拍调用点**推出来的。
 * 若无扰动也先走一拍，再上扰动，这一跑就是**冷重放**（备忘录里那一格还没建），
 * 重放环与逐拍环**两个调用点都被真跑到**（实测：变异 M3「重放段换 `{}`」曾被漏掉，加这一拍后咬住）。
 */
/** 一条臂的产物：信噪比回执 + 本拍自报的衰减账（后者的用途见 §2 的 `worldDrift` 新判据）。 */
interface ArmResult {
  noise: Noise;
  /** `stateVarReport.decayApplied`：本拍真的按多少在散 —— 声明衰减率的**回执**（⛔ 测试不另抄常数）。 */
  decayApplied: Record<string, number>;
}

async function arm(t: TestApp, pert: Record<string, unknown>): Promise<ArmResult> {
  const sid = await newSession(t, null);
  await tick(t, sid, 1);
  await addPert(t, sid, pert);
  const r = await tick(t, sid, 3);
  expect(r.signalToNoise, "有扰动的会话必须下发信噪比回执（影子线在跑）").toBeDefined();
  return { noise: r.signalToNoise!, decayApplied: r.stateVarReport?.decayApplied ?? {} };
}

async function tick(
  t: TestApp,
  sid: string,
  n: number,
): Promise<{ state: TickState; signalToNoise?: Noise; stateVarReport?: { decayApplied?: Record<string, number> } }> {
  const r = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n },
  });
  expect(r.statusCode, `tick 失败：${JSON.stringify(r.json()).slice(0, 300)}`).toBe(200);
  return r.json() as { state: TickState; signalToNoise?: Noise; stateVarReport?: { decayApplied?: Record<string, number> } };
}

/** 真扰动（值真的动）+ 零效果扰动（值一格不动）—— 两条臂只差"扰动有没有效果"这一个变量。 */
const PERT_COMMON = {
  kind: "capacity_loss", targetObjectId: BASE_ID, targetStateVar: "loadIndex", mode: "delta",
} as const;

describe("§2 行为臂：零效果扰动 ⇒ 两条线必须逐字节相同（信噪比恒等式）", () => {
  it("真扰动先证探针有鉴别力（userContribution > 0），再用零效果扰动咬「两条线同源」", async () => {
    const t = await seededApp();

    // ── 金丝雀（必然命中的对照）──────────────────────────────────────────────────
    // 真 +15：影子线（零扰动）与主线（含这笔）必须分叉 ⇒ 探针读到非 0。
    // ⇒ 下面那个 `=== 0` 才有资格被读成"两条线相同"，而不是"探针恒读 0"。
    const nReal = await arm(t, { ...PERT_COMMON, magnitude: 15, label: "真扰动 +15" });
    expect(nReal.noise.userContribution, "🐤 金丝雀落空：真扰动下两条线竟然读不出差 ⇒ 探针坏了").toBeGreaterThan(0);
    expect(nReal.noise.changedCells).toBeGreaterThan(0);

    /**
     * ── `worldDrift` 判据：原判据为什么作废、换成什么（WO-SEMANTICS-DECLARED 收尾 · 2026-10-09）──
     *
     * **原判据** `nReal.worldDrift === 0` 在度量什么：它是个**代理** —— 用「零扰动的影子线逐拍恒定」
     * 来咬「主线/影子线喂**同一份**源侧静息点」。恒定曾是 **C2 合成层**的产物：`x' = 0.63x + 0.37·base`
     * 恰以 `base` 为不动点、把核的 `−λx` 掉头抵消；而 C2 对 `DEVIATION` 格**必须跳过**
     * （`spec-base-synthesis.ts`：其锚本来就是 `restPoint`，C2 对它是恒等变换）。
     * 本会话把 `Base|loadIndex` 归位成 `DEVIATION` ⇒ C2 不再把它锚回 base ⇒ 起点偏离静息的格
     * 按**声明衰减**回落静息点：本用例快照把 loadIndex 设成 30（≠ restPoint 0）⇒ 影子线逐拍
     * `30→18.9→…→4.7258883`（λ=0.37 由回执自报）⇒ `worldDrift = |30·0.63¹ − 30·0.63⁴| = 14.1741117`。
     * **这不是"某处偷换了静息点"**：那一跑引擎零流量（扰动为空），动的就是声明衰减 ——
     * 原判据对**偏离静息的起点**恒假了，与"同源"这件事无关（起点恰在静息上时它才与同源等价）。
     * ⚠ 附带记录（不在本单半径内，交仓主）：自定义快照下「**驱动静息点** = baseSnapshot(30)」与
     *   「**衰减静息点** = restPoint(0)」**不一致**；种子世界两者同值故无感。要不要统一是语义裁决。
     *
     * **新判据**：把影子线的漂移与**按声明衰减率现算**的期望轨迹对账（λ 取本拍回执自报、rest 取
     * 域声明，见 `expectedShadowDrift`）。它仍咬「两条线同源」：影子线若被偷喂另一份静息点
     * （或主线被换口径，见下 noop 臂），两条线就会多出/丢掉一层流量 ⇒ 漂移偏离纯衰减轨迹 ⇒ 当场红。
     * ⛔ 不写死 14.1741117，也不降级成"不设断言"。
     */
    const lambdaReal = nReal.decayApplied.loadIndex;
    expect(lambdaReal, "🐤 回执没自报 loadIndex 的声明衰减率 ⇒ 期望漂移无从现算（别退回写死常数）").toBeGreaterThan(0);
    expect(
      nReal.noise.worldDrift,
      `影子线漂移 ${nReal.noise.worldDrift} ≠ 按声明衰减率现算的期望 ${expectedShadowDrift(lambdaReal)}` +
        `（λ=${lambdaReal}，x0=${BASE_STATE[BASE_ID]!.loadIndex}，k=${K_AFTER_WARMUP}→${K_END}）` +
        ` ⇒ 影子线不是"只按声明衰减在走"（多出来的差异只可能来自被偷换的静息点/多走的流量）。`,
    ).toBeCloseTo(expectedShadowDrift(lambdaReal), 6);

    // ── 头号判据 ────────────────────────────────────────────────────────────────
    // delta 0：**值一个字节都不动**（扰动确实建了、影子线确实在跑），
    // 于是"两条线只许差有没有扰动"这句话的可判据形态就是：两条线逐字节相同。
    const nNoop = await arm(t, { ...PERT_COMMON, magnitude: 0, label: "零效果扰动" });
    expect(
      nNoop.noise.userContribution,
      `主线与影子线分叉了：userContribution=${nNoop.noise.userContribution}（两条线喂了不同的静息点）`,
    ).toBe(0);
    expect(nNoop.noise.changedCells, "有格子被「两条线口径不同」改动了").toBe(0);
    /**
     * 同一个盘子、两个臂都要对得上（影子线对两臂是**同一条**线 —— 它压根不收扰动）。
     * ⛔ 原判据 `nNoop.worldDrift === 0` / `ratio === null` 同根作废（理由见上，不重复）。
     */
    expect(
      nNoop.noise.worldDrift,
      `零效果扰动臂：影子线漂移 ${nNoop.noise.worldDrift} ≠ 现算衰减轨迹 ${expectedShadowDrift(lambdaReal)}`,
    ).toBeCloseTo(expectedShadowDrift(lambdaReal), 6);
    /**
     * 世界自己在漂（≠0）而用户贡献为 0 ⇒ `ratio` 必须**精确 = 0**（"这次的漂移里没有一分来自用户"）。
     * ⛔ 不再是 `null` —— `null` 专属于 `worldDrift === 0` 的无定义态（`summarizeSignalNoise` 原文：
     * 零漂移下这个比值无定义）；今天世界确实在漂，给 `null` 就是把"比值无定义"当成"漂移为零"。
     */
    expect(
      nNoop.noise.ratio,
      "用户贡献 0 ÷ 世界漂移 ⇒ ratio 必须精确 0（⛔ 不是 null：null 是 worldDrift===0 的专属）",
    ).toBe(0);
    // 两条臂确实不同（否则"零效果"与"真扰动"没被区分开）。
    expect(nNoop.noise.userContribution).not.toBe(nReal.noise.userContribution);
    // 值级证据（数量绿不等于值对：这条把两侧的**数**都打在证据里，供复算）。
    console.log(
      `§2 影子线漂移对账：nReal.worldDrift=${nReal.noise.worldDrift} · 现算期望=${expectedShadowDrift(lambdaReal)}` +
        `（λ=${lambdaReal} 由回执自报 · x0=${BASE_STATE[BASE_ID]!.loadIndex} · k=${K_AFTER_WARMUP}→${K_END}）` +
        ` · nNoop.worldDrift=${nNoop.noise.worldDrift} · nNoop.userContribution=${nNoop.noise.userContribution}` +
        ` · nNoop.changedCells=${nNoop.noise.changedCells} · nNoop.ratio=${nNoop.noise.ratio}`,
    );
  });
});
