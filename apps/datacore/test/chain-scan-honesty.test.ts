import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import type { ChainImpediment } from "@platform/contracts";
import { CHAIN_IMPEDIMENT_SOLVER_KEY } from "../src/solvers/chain-impediment.js";
import { SOLVER_KEYS } from "../src/solvers/service.js";

/**
 * WO-SANDBOX-A2 · 全链扫描「零写死」**运行态**那一半（`docs/PRD-sandbox-redesign.md` §9 验收 A2）。
 *
 * ══ 为什么必须有这个文件（门做不到什么）═══════════════════════════════════════
 * `scripts/check-chain-scan-honesty.mjs` 是**静态**门：它证明"源码里没有写死的数"，
 * **不证明**"跑出来的那个数真能溯源"。A2 的原文是两句话：
 *   > `chain-scan-honesty:check` 绿；**随机抽 5 个数字，逐个溯源到求解器输出**
 * 后半句是运行态判据，静态扫描一个字都覆盖不了 —— 本文件咬的就是后半句。
 * 两半合起来才等于 A2；只做静态门就宣称 A2 过，是"绿测试 ≠ 能用"的又一形态。
 *
 * ══ 判据（口径来自审核方 2026-08-08 真服务实测，不是我拍的）═══════════════════
 * 实测 demo 租户回包：15 个阻滞点（BREAK 7 / CONGESTION 6 / BOTTLENECK 2），
 * `thresholds[]` 5 个生效阈值里 **3 个 source="literal"**。这直接否定了"回包里不许有 literal"
 * 这种写法 —— 那 3 个 literal 在**规则表达式**里，且**主动声明了自己是 literal**。
 * **「声明了的字面量」与「藏起来的字面量」是两种东西**：前者可审计、改规则即改判定。
 * 故本文件不查"有没有 literal"，查的是三件事：
 *
 *  · **A2-a 无未申报的数**：凡进入 `evidence.threshold` 的数，`thresholds[]` 里必须有对应条目
 *    且带合法 `source`；漏申报 ⇒ 红。这才是"零写死"真正想守的。
 *  · **A2-c 溯源可达**：申报的 `ruleKey` 必须在**运行期真发布的规则集**里真存在（走 `GET /a/v1/rules`
 *    读回，不看源码）；`source==="param"` 时 `ruleParamKey` 必须是那条规则 `params` 上的真键。
 *    **这一层才是有牙的** —— 它咬的是"声称的来源到底存不存在"。
 *  · **A2「抽 5 个数字逐个溯源」**：机械版 —— 抽 5 个 severity，每个都必须能由
 *    `metricValue`/`threshold` **重算出来**（而不是被拍上去的）。重算不出 ⇒ 红。
 *
 * ══ 刻意**没有**做的一条（否则是哑门）════════════════════════════════════════
 * §9 A1 写「`evidence.solverKey` 指向的求解器真被调用过」。实测 15 条阻滞点的 solverKey
 * **全部等于 `chain_impediments` 自己**（该扫描器直接读对象属性 + 比规则阈值，上游没有别的求解器）
 * ⇒ 那条断言**指向自己永远为真、无法失败**。故这里只做弱得多但真能失败的一层：
 * solverKey 必须在 `SOLVER_KEYS` 册上。**§9 A1 判据本身需要重写**（记在 `docs/PRD-sandbox-a2.md` §3.2）。
 *
 * 变异反证注入点：把 `judgeOne` 里的 `severity` 改成常数 → SCAN-3 必红；
 * 把 `thresholdRow` 的写入摘掉 → SCAN-1 必红；把某 binding 的 `ruleKey` 改成虚构码 → SCAN-2 必红。
 */

interface ThresholdRow {
  bindingId: string;
  ruleKey: string;
  source: string;
  ruleParamKey?: string;
  fieldPath?: string;
  value: number;
  unit: string;
  /** WO-DIM-LABEL-3 ②：量纲逐行时申报的承载属性路径（缺省 = 该判据量纲是常量）。 */
  unitPath?: string;
}
interface ScanOut {
  scanId: string;
  impediments: ChainImpediment[];
  counts: { total: number; BOTTLENECK: number; CONGESTION: number; BREAK: number };
  unresolved: { bindingId: string; status: string; reason: string }[];
  thresholds: ThresholdRow[];
}
interface LiveRule {
  key: string;
  expression: string;
  params?: Record<string, number>;
  status?: string;
}

const LEGAL_SOURCES = new Set(["param", "literal", "field"]);

async function scan(t: TestApp): Promise<ScanOut> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/solvers/chain_impediments/invoke",
    headers: ADMIN,
    payload: { args: {} },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as ScanOut;
}

/**
 * WO-DIM-LABEL-3 ② · 从**真对象**上读回某个属性（走公开 REST 读回，不 import 种子常量 ——
 * import 种子就变成"拿同一份数据自证自己"，恒真）。
 * 找不到对象或属性缺失 ⇒ 返回 undefined，让调用处的断言红在"读不回来"上，不静默放行。
 */
async function propOf(t: TestApp, typeKey: string, objectId: string, propKey: string): Promise<unknown> {
  const res = await t.app.inject({
    method: "GET",
    // ⚠ 这里原写 `&limit=200` —— 该端点不认识 `limit`，它被静默忽略、回落默认页长 50。
    // 于是本函数只在**前 50 行**里 find，目标对象排在 50 名之后时会红在「找不到 objectId」，
    // 把「没取回来」误报成「对象不存在」。正确参数名是 `pageSize`（现已对 limit 直接 400）。
    url: `/a/v1/objects?type=${encodeURIComponent(typeKey)}&pageSize=200`,
    headers: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(200);
  const items = res.json().items as { id: string; props: Record<string, unknown> }[];
  // 金丝雀：这一类一个对象都读不回来时，下面的 find 会恒 undefined 而断言红在"单位对不上"，
  // 把"读回失败"误报成"量纲错"。故先在这里点名真正的病因。
  expect(items.length, `对象类型 ${typeKey} 一个都读不回来 —— 是读回坏了，不是量纲错`).toBeGreaterThan(0);
  const hit = items.find((o) => o.id.endsWith(objectId) || o.props[`${typeKey[0]!.toLowerCase()}${typeKey.slice(1)}Id`] === objectId);
  expect(hit, `${typeKey} 里找不到 ${objectId}`).toBeTruthy();
  return hit!.props[propKey];
}

/** 运行期真发布的规则集（**读回**，不看源码 —— 源码那一层由静态门 H6/H7 守）。 */
async function liveRules(t: TestApp): Promise<Map<string, LiveRule>> {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/rules", headers: ADMIN });
  expect(res.statusCode, res.body).toBe(200);
  const rows = res.json() as LiveRule[];
  const m = new Map<string, LiveRule>();
  for (const r of rows) if (r.key && !m.has(r.key)) m.set(r.key, r);
  return m;
}

describe("WO-SANDBOX-A2 · 全链扫描零写死（运行态溯源 · PRD-sandbox-redesign §9 A2 后半句）", () => {
  it("SCAN-1 · A2-a 无未申报的数：每条阻滞点的 threshold 都能在 thresholds[] 里找到申报条目", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);

    // 先自证这次扫描真有内容 —— 空结果会让下面所有 for 循环恒真（0 条全绿 = 哑测试）。
    expect(s.impediments.length).toBeGreaterThan(0);
    expect(s.thresholds.length).toBeGreaterThan(0);
    expect(s.counts.total).toBe(s.impediments.length);

    const byBinding = new Map(s.thresholds.map((r) => [r.bindingId, r]));
    // WO-DIM-LABEL-3 ②：逐行量纲那一支跑过几次。**不计数就分不清**「per-row 机制是对的」
    // 与「压根没有 per-row 判据、那个 else 一次都没进」—— 两者在屏上都是绿。
    let perRowUnitChecks = 0;
    let sawNonFallbackUnit = false;
    for (const i of s.impediments) {
      // `impedimentId` 形如 `imp_<bindingId>_<objectId>` —— 由它反查申报条目。
      const row = s.thresholds.find((r) => i.impedimentId.startsWith(`imp_${r.bindingId}_`));
      expect(row, `阻滞点 ${i.impedimentId} 在 thresholds[] 里没有申报条目 —— 这个数从哪来的说不出`).toBeTruthy();
      expect(LEGAL_SOURCES.has(row!.source), `申报了但 source="${row!.source}" 非法`).toBe(true);
      // 量纲必须一致（R18 教训：两者不同单位 = 量纲错）。
      // WO-DIM-LABEL-3 ②：量纲**逐行**的判据（申报了 `unitPath`）不能用一条静态串去比 ——
      // C06 的 locus `MaterialBalance` 9 行里 3 行不是吨（隔膜 万㎡ / 电芯壳体 万个 / 包材 万套），
      // 一条静态申报无论填哪个单位都必然与另一部分行对不上。
      // 故这一支改为**更强**的判据：不比字符串，而是把 `unitPath` 指的那个属性
      // 从**真对象**上读回来，逐条核对 `evidence.unit` 就是那一行自己的单位。
      // （这比原来的静态相等更有牙：它同时证明了「per-row 那条线真的接上了」。）
      if (row!.unitPath === undefined) {
        expect(row!.unit).toBe(i.evidence.unit);
      } else {
        const [typeKey, propKey] = row!.unitPath.split(".");
        expect(typeKey, `unitPath "${row!.unitPath}" 不是 Type.prop 形状`).toBeTruthy();
        expect(propKey).toBeTruthy();
        expect(typeKey).toBe(i.locus.objectType); // 申报的类型必须就是该判据的 locus 类型
        const locusUnit = await propOf(t, typeKey!, i.locus.objectId, propKey!);
        expect(
          i.evidence.unit,
          `${i.impedimentId} 的量纲与 ${row!.unitPath} 在该对象上的真值对不上 —— per-row 量纲没接上`,
        ).toBe(locusUnit);
        perRowUnitChecks++;
        if (i.evidence.unit !== row!.unit) sawNonFallbackUnit = true;
      }

      // source 非 field 时阈值全局唯一 ⇒ 申报值必须与回包里那个数**逐位相等**。
      // （field 源的阈值逐对象不同，申报条目给的是首个被判对象的示例值，故不比等。）
      if (row!.source !== "field") {
        expect(row!.value, `${i.impedimentId} 的 evidence.threshold 与申报值对不上 —— 有第二个存阈值的地方`).toBe(
          i.evidence.threshold,
        );
      }
      // 溯源四件套缺一不可（少一环就没法机械核）。
      expect(i.evidence.solverKey).toBe(CHAIN_IMPEDIMENT_SOLVER_KEY);
      expect(i.evidence.ruleKey).toBeTruthy();
      expect(Number.isFinite(i.evidence.metricValue)).toBe(true);
      expect(Number.isFinite(i.evidence.threshold)).toBe(true);
    }
    // solverKey 在册（弱判据 —— 它只防 key 漂移，不证明"求解器被调用过"，见文件头）。
    expect((SOLVER_KEYS as readonly string[]).includes(CHAIN_IMPEDIMENT_SOLVER_KEY)).toBe(true);
    expect(byBinding.size).toBe(s.thresholds.length); // 一 binding 一条申报，不许重复申报

    // ── WO-DIM-LABEL-3 ② 金丝雀：上面那个 else 分支必须真的跑过 ──────────────────
    // 不加这两条，「per-row 量纲接对了」与「压根没进那个分支」在屏上一模一样（都绿）。
    expect(perRowUnitChecks, "逐行量纲分支一次都没进 —— 要么 unitPath 没申报，要么该判据没出条目；不是『量纲都对』").toBeGreaterThan(0);
    // 更狠一条：必须至少有一行的真实单位**不等于**静态回落值。否则「读了属性」与
    // 「照抄回落值」无法区分 —— 那正是本单要治的病（9 行里 3 行不是吨，电芯壳体就是其中之一）。
    expect(
      sawNonFallbackUnit,
      "没有任何一行的量纲不同于静态回落值 ⇒ 无法证明真的按行读了属性（照抄回落值也会全绿）",
    ).toBe(true);
  }, 180000);

  it("SCAN-2 · A2-c 溯源可达：申报的 ruleKey/ruleParamKey 在**运行期真发布的规则**里真存在", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);
    const rules = await liveRules(t);

    // 事实源自证：规则集读不回来的话，下面的 has() 会全 false 而不是全 true，方向是安全的；
    // 但仍要下界，否则"规则集为空"会被读成"每条都查过了"。
    expect(rules.size, "运行期规则集为空 —— 这不是『溯源都通过』，是读回失败").toBeGreaterThan(10);
    expect(s.thresholds.length).toBeGreaterThan(0);

    for (const row of s.thresholds) {
      const rule = rules.get(row.ruleKey);
      expect(rule, `申报条目 ${row.bindingId} 声称阈值出自规则 ${row.ruleKey}，但运行期规则集里没有这条规则`).toBeTruthy();
      if (row.source === "param") {
        expect(row.ruleParamKey, `source="param" 却没说是哪个旋钮`).toBeTruthy();
        expect(
          typeof rule!.params?.[row.ruleParamKey!],
          `${row.ruleKey}.params.${row.ruleParamKey} 在运行期规则上不存在 —— 申报的旋钮指向空气`,
        ).toBe("number");
        // 申报值必须就是那条规则当前的 param 值（不是引擎另存的一份）。
        expect(rule!.params![row.ruleParamKey!]).toBe(row.value);
      }
      if (row.source === "literal") {
        // literal 不是罪，但它必须**真出现在规则表达式里**，而不是引擎自己想出来的。
        expect(
          rule!.expression.includes(String(row.value)),
          `${row.ruleKey} 申报 literal 阈值 ${row.value}，但规则表达式 "${rule!.expression}" 里没有这个数`,
        ).toBe(true);
      }
      if (row.source === "field") {
        expect(row.fieldPath, `source="field" 却没说取自哪个属性`).toBeTruthy();
        const leaf = row.fieldPath!.split(".").slice(-1)[0]!;
        expect(
          rule!.expression.includes(leaf),
          `${row.ruleKey} 申报阈值取自 ${row.fieldPath}，但规则表达式里没有这个字段`,
        ).toBe(true);
      }
    }
    // 每条阻滞点引用的规则也必须真在册（不只是申报条目）。
    for (const i of s.impediments) {
      expect(rules.has(i.evidence.ruleKey!), `阻滞点引用了不存在的规则 ${i.evidence.ruleKey}`).toBe(true);
    }
  }, 180000);

  it("SCAN-3 · A2「抽 5 个数字逐个溯源」：抽样的 severity 必须能由 metricValue/threshold 重算出来", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);

    // 抽样确定性（R6）：按 impedimentId 全序取等距 5 条，不用随机数 —— 随机抽样的测试不可复现。
    const sorted = [...s.impediments].sort((a, b) => a.impedimentId.localeCompare(b.impedimentId));
    // 阈值为 0 的判据（C06 缺口 > 0）用的是 magnitudePath 做分母，回包里没有那个分母 ⇒ 重算不了，
    // 诚实排除而不是编一个分母凑过（那正是本单要治的病）。
    const recomputable = sorted.filter((i) => Math.abs(i.evidence.threshold) > 0);
    expect(recomputable.length, "没有可重算的样本 —— 本用例等于没跑").toBeGreaterThanOrEqual(5);

    const picks: ChainImpediment[] = [];
    const step = Math.max(1, Math.floor(recomputable.length / 5));
    for (let k = 0; picks.length < 5 && k * step < recomputable.length; k++) picks.push(recomputable[k * step]!);
    expect(picks.length).toBe(5);

    for (const i of picks) {
      const { metricValue, threshold } = i.evidence;
      // 违规方向由规则比较符决定；引擎两个方向都可能，故取「哪边为正」的那个作为超阈幅度。
      const breach = Math.max(Math.max(0, metricValue - threshold), Math.max(0, threshold - metricValue));
      const expected = Math.max(0, Math.min(100, Math.round((breach / Math.abs(threshold)) * 100)));
      expect(
        i.severity,
        `${i.impedimentId} 的 severity=${i.severity} 无法由 metricValue=${metricValue} / threshold=${threshold} 重算` +
          `（重算得 ${expected}）—— 这个数不是算出来的，是拍上去的`,
      ).toBe(expected);
      // 溯源终点必须落在真对象上（R13），不是一个漂着的标签。
      expect(i.locus.objectId.length).toBeGreaterThan(0);
      expect(i.locus.objectType.length).toBeGreaterThan(0);
    }
  }, 180000);

  it("SCAN-4 · 诚实缺席：判不出来的判据必须进 unresolved 并写清为什么，不许消失", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const s = await scan(t);

    // 判据总数守恒：每条 binding 要么产出申报条目，要么进 unresolved —— 不许既不判也不说。
    expect(s.unresolved.length).toBeGreaterThan(0);
    for (const u of s.unresolved) {
      expect(u.status).toBe("UNKNOWN");
      // 「为什么判不出来」必须写够，一句「暂不支持」是不合格的诚实缺席。
      expect(u.reason.length, `unresolved ${u.bindingId} 的理由太短，等于没说`).toBeGreaterThan(20);
    }
    const declared = new Set([...s.thresholds.map((r) => r.bindingId), ...s.unresolved.map((u) => u.bindingId)]);
    for (const i of s.impediments) {
      const hit = [...declared].some((b) => i.impedimentId.startsWith(`imp_${b}_`));
      expect(hit, `阻滞点 ${i.impedimentId} 的判据既没申报阈值也没进 unresolved —— 它是从哪冒出来的`).toBe(true);
    }
  }, 180000);
});
