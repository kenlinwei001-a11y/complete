/**
 * WO-SIM-PERF-SHADOW · **接缝门**：影子线（world drift）的按拍备忘录。
 *
 * ── 本单在治什么（实测数字，不是推测）────────────────────────────────────────────
 * `POST …/tick` 的服务端分段耗时（真后端 `SEED_DEMO=1`，会话 `curTick=16`）：
 * `graph 3464 · shadow 4549 · engine 1690 · persist 250 · total 10491 ms` —— 影子线一项 **43%**。
 * 而它每一跑都在做同一件事：`从 s.baseSnapshot 重放 curTick 拍`。一次控制台推演打 8 次这类请求。
 *
 * 形态（铁律 0.6 句式）：
 * > **「我用『每次请求都重算一遍』当作『这个计算必须每次做』的证据，
 * >   而前者并不度量后者 —— 它的输入根本没变。」**
 *
 * ── 这道门咬什么（为什么不是各半 unit）──────────────────────────────────────────
 * 备忘录的两半是「**键**（指纹算得对不对）」与「**值**（复用出来的影子态与重放是不是同一个）」。
 * 各自单测都能全绿而整体是坏的：指纹漏了规则 ⇒ 单测绿，而线上两条规则集互相读到对方的影子线。
 * 所以本文件一律走**真路由 inject**（真种子 → 真规则 → 真会话 → 真扰动 → 真 tick），
 * 只在 §4 才下到类型级（那里测的是容量/失效语义，接缝上观察不到）。
 *
 * ── 判据（对照实验，缺一条不算交付）──────────────────────────────────────────────
 *  §1 金丝雀   —— 计数器真的挂在影子线那条路上，且读数**有鉴别力**（不然下面全是废话）
 *  §2 头号判据 —— 同一拍上「命中备忘录」与「从 baseSnapshot 冷跑」的回包**逐字节相同**
 *  §3 反向金丝雀 —— 改了规则**必须失效**：不许吃到旧规则算出来的影子态，且读数必须跟着变
 *  §4 类型级   —— 容量有界 / 拍号与 baseSnapshot 的失效语义 / 指纹对入参敏感
 *
 * ⚠ §2 与 §3 各自带一条**反证**（本单交付要求：把失效逻辑注释掉，这两条必须当场红），
 *   两次红都贴进了报告。红过才算有牙 —— 没红过的断言不度量任何东西。
 *
 * ⚠ 本文件**一行都不改算法**，也不新增门/棘轮/基线 JSON（禁令 3）：它只是既有测试套件里的一个文件。
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { ShadowMemo, shadowFingerprint, shadowMemoStats } from "../src/sim/shadow-memo.js";
import type { PropagationRule, TickState } from "@platform/contracts";

// ══ 夹具 ═══════════════════════════════════════════════════════════════════

const md5 = (v: unknown): string => createHash("md5").update(JSON.stringify(v)).digest("hex");

/** 剥注释（行注释 + 块注释）。数「赋值」之前必须先做 —— 理由见铁律 0.6 第 6 条。 */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`])\/\/.*$/gm, "$1");

/**
 * 源码里**给 `baseSnapshot` 赋值**的那些行（`X.baseSnapshot = …`）。
 *
 * ⚠ 判据落在**赋值语法位置**上，不是「这个串出现过」：`{ baseSnapshot: … }` 是字面量键、
 *   `=== undefined` 是比较、注释里还能原样引用一整句 —— 那三类都**不是**写点。
 *   双向金丝雀见 §4 那条用例（正样例必须中、只出现在注释里的同形串必须不中）。
 */
const assignmentsToBaseSnapshot = (source: string): string[] =>
  stripComments(source)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /(^|[^=!<>])\.baseSnapshot\s*=(?!=)/.test(l));

/** `apps/datacore/<rel>` 下全部 `.ts` 的绝对路径。 */
const tsSourcesUnder = (rel: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) out.push(p);
    }
  };
  walk(fileURLToPath(new URL(`../${rel}`, import.meta.url)));
  return out;
};

const enableSim = async (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await enableSim(t);
  return t;
}

/** 常州基地 —— 与 `edge-active-counterfactual.seam.test.ts` 同一个（`line_belongs_to_base` 出边最全）。 */
const BASE_ID = "obj_base_changzhou";
/** 出厂种子里一条**真的在跑**的边（源端正是下面那笔扰动的落点）—— §3 关的就是它。 */
const RULE_KEY = "demo_base_load_to_line_util";
/**
 * tick 0 的世界态。**必须偏离静息点**（`loadIndex` 是压力族，静息点 0）。
 *
 * ⚠ 这条是实测逼出来的：第一版用 `loadIndex: 0`（静息点），影子线从静息点重放
 * `|drift@t − drift@0|` 恒为 **0** ⇒ `worldDrift = 0`，§2 的「逐字节相同」当场退化成 `0 === 0`
 * ——**什么都没证明还全绿**。世界必须自己在走，那个读数才有鉴别力。
 */
const BASE_STATE = { [BASE_ID]: { loadIndex: 30 } } as const;
/** 扰动的落点与幅度。两个会话要用**逐字节相同**的规格，双胞胎才成立。 */
const PERT = {
  kind: "capacity_loss", targetObjectId: BASE_ID, targetStateVar: "loadIndex",
  magnitude: 45, mode: "set", label: "基地负载置为 45",
} as const;

interface Noise {
  worldDrift: number;
  userContribution: number;
  ratio: number | null;
  ratioOnTouchedCells: number | null;
  worldDriftOnTouchedCells: number;
  changedCells: number;
  totalCells: number;
  basis: string;
}
interface TickResp {
  curTick: number;
  state: TickState;
  signalToNoise?: Noise;
  appliedPerturbations?: string[];
}

/** 建会话。`perturbed` 决定它走不走影子线（`wantDrift = 有扰动 && engineTick`）。 */
async function newSession(t: TestApp, perturbed = true): Promise<string> {
  const created = await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
    payload: { baseSnapshot: BASE_STATE },
  });
  expect(created.statusCode, "建会话失败").toBe(201);
  const sid = created.json().id as string;
  if (!perturbed) return sid;
  const p = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN, payload: PERT,
  });
  expect(p.statusCode, "建扰动失败（双胞胎要的是逐字节相同的规格）").toBe(201);
  return sid;
}

const tick = async (t: TestApp, sid: string, n: number): Promise<TickResp> => {
  const r = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n },
  });
  expect(r.statusCode, `tick 失败：${JSON.stringify(r.json()).slice(0, 300)}`).toBe(200);
  return r.json() as TickResp;
};

const counters = () => ({ hits: shadowMemoStats.hits, misses: shadowMemoStats.misses });

// ══ §1 金丝雀 ══════════════════════════════════════════════════════════════
describe("§1 金丝雀：计数器挂在影子线那条路上，且读数有鉴别力", () => {
  it("无扰动会话不碰影子线；有扰动会话首跑恰好冷跑一次；两个量都非零", async () => {
    const t = await seededApp();

    // (a) 反向：无扰动 ⇒ `wantDrift` 恒 false ⇒ 影子线一次都不跑 ⇒ 计数**一个都不许动**。
    //     这一条同时是「计数器不是被别的路径喂大的」的证据。
    const calm = await newSession(t, false);
    const b0 = counters();
    const r0 = await tick(t, calm, 1);
    expect(r0.signalToNoise, "无扰动会话不该有信噪比回执（没有『用户贡献』这个量可谈）").toBeUndefined();
    expect(counters().hits - b0.hits, "无扰动却记了命中 ⇒ 计数器挂错了地方").toBe(0);
    expect(counters().misses - b0.misses, "无扰动却记了未命中 ⇒ 计数器挂错了地方").toBe(0);

    // (b) 正向：有扰动会话首跑必然冷跑**恰好一次**（一次请求 = 一次 get）。
    const sid = await newSession(t);
    const b1 = counters();
    const r1 = await tick(t, sid, 3);
    expect(counters().misses - b1.misses, "首次请求没有冷跑 ⇒ 后面 §2 的『命中』无从谈起").toBe(1);
    expect(counters().hits - b1.hits, "首次请求不可能命中").toBe(0);

    // (c) 鉴别力：两个量都必须真非零。
    //     ⚠ 少了这一条，§2 的「逐字节相同」可能退化成 `0 === 0` —— 那就什么都没证明。
    const n1 = r1.signalToNoise;
    expect(n1, "有扰动会话必须下发信噪比回执").toBeDefined();
    expect(n1!.worldDrift, "世界自身漂移为 0 ⇒ 影子线这一跑没有区分度").toBeGreaterThan(0);
    expect(n1!.userContribution, "用户贡献为 0 ⇒ 扰动没进世界，本文件整篇失去前提").toBeGreaterThan(0);
  });
});

// ══ §2 头号判据 ════════════════════════════════════════════════════════════
describe("§2 头号判据：同一拍上，命中备忘录与冷跑重放的回包逐字节相同", () => {
  it("双胞胎 A/B 同拍同请求：A 命中、B 冷跑（被挤出容量），两个回包的 state 与 signalToNoise 必须逐字节相同", async () => {
    const t = await seededApp();

    // 双胞胎：同 baseSnapshot、同扰动规格、同样推进 3 拍。
    // ⚠ 先建 B 后建 A —— 备忘录是 LRU，容量 4；下面要用 3 个填充会话把**更老的 B** 挤出去。
    const B = await newSession(t);
    const rB3 = await tick(t, B, 3);
    const A = await newSession(t);
    const rA3 = await tick(t, A, 3);

    // 双胞胎自证：两条真实世界线此刻必须逐字节相同。**这一条不成立，下面的比较就没有意义**
    // （那我比的是两个不同的世界，而不是「命中」与「冷跑」两种取法）。
    expect(md5(rA3.state), "两个会话在 tick 3 的世界态不同 ⇒ 它们不是双胞胎，本用例前提不成立")
      .toBe(md5(rB3.state));
    expect(md5(rA3.signalToNoise)).toBe(md5(rB3.signalToNoise));

    // 3 个填充会话各占一格 ⇒ [B, A, F1, F2, F3] = 5 > 容量 4 ⇒ 挤掉最老的 B。
    for (let i = 0; i < 3; i++) await tick(t, await newSession(t), 1);

    const b = counters();
    const rA = await tick(t, A, 1);          // A 那一格还在 ⇒ 命中
    const afterA = counters();
    const rB = await tick(t, B, 1);          // B 那一格被挤掉 ⇒ 冷跑
    const afterB = counters();

    expect(afterA.hits - b.hits, "A 那一跑没有命中 ⇒ 本用例根本没验到『复用』").toBe(1);
    expect(afterB.misses - afterA.misses, "B 那一跑没有冷跑 ⇒ 本用例没有对照组").toBe(1);

    expect(rA.curTick, "两个回包不在同一拍上 ⇒ 比错了对象").toBe(rB.curTick);
    expect(md5(rA.state), "真实世界线分叉 ⇒ 双胞胎假设破了").toBe(md5(rB.state));

    // ★ 本单头号判据：**逐字节相同**，不许用「差不多」「误差很小」顶替。
    // 命中的那一路（影子态取自备忘录）与冷跑的那一路（从 baseSnapshot 重放 3 拍）
    // 喂给 `summarizeSignalNoise` 的 `start` 必须是同一个值。
    expect(md5(rA.signalToNoise), "命中与冷跑的信噪比回执不同 ⇒ 备忘录复用出来的影子态与重放不等价")
      .toBe(md5(rB.signalToNoise));
  });
});

// ══ §3 反向金丝雀 ══════════════════════════════════════════════════════════
describe("§3 反向金丝雀：规则变了，影子线必须重算", () => {
  it("关掉一条真在跑的边 ⇒ 同一会话同一拍的影子线必须失效（miss），且读数必须跟着变", async () => {
    const t = await seededApp();
    const B = await newSession(t);
    const B3 = await tick(t, B, 3);
    const A = await newSession(t);
    const A3 = await tick(t, A, 3);
    expect(md5(A3.state)).toBe(md5(B3.state)); // 双胞胎自证（同 §2）

    // 未改规则前：同拍同请求，两个会话的回包逐字节相同（各自命中各自的格）。
    const rA1 = await tick(t, A, 1);
    const rB1 = await tick(t, B, 1);
    expect(md5(rA1.state)).toBe(md5(rB1.state));
    expect(md5(rA1.signalToNoise)).toBe(md5(rB1.signalToNoise));

    // A 关掉那条边（经真路由，不是直写会话行）。
    const patch = await t.app.inject({
      method: "PATCH", url: `/a/v1/sim/sessions/${A}/disabled-rules`, headers: ADMIN,
      payload: { disabledRuleKeys: [RULE_KEY] },
    });
    expect(patch.statusCode, "关边失败").toBe(200);

    const b = counters();
    const rA2 = await tick(t, A, 1);
    const afterA = counters();
    expect(afterA.misses - b.misses,
      "规则集改了却命中了备忘录 ⇒ 影子线吃的是**旧规则集**算出来的态（这就是本条的病灶）").toBe(1);
    expect(afterA.hits - b.hits, "规则集改了不可能命中").toBe(0);

    const rB2 = await tick(t, B, 1); // 对照：B 的规则集没改，应当照旧命中
    expect(counters().misses - afterA.misses, "对照组 B 反而冷跑了 ⇒ 用例设计错了，不是实现错了").toBe(0);

    // 「改了规则」这件事必须**看得见**：先证世界线本身分叉了（下面那条比较才有意义），
    // 再证影子线的回执也跟着变 —— 两者都不许是「改了但读数不动」。
    expect(md5(rA2.state), "关掉一条真在跑的边之后世界态逐字节不变 ⇒ 这条边根本没在跑，§3 选错了边")
      .not.toBe(md5(rB2.state));
    expect(md5(rA2.signalToNoise), "世界变了而影子线的回执没变 ⇒ 影子线吃的是旧规则算出来的态")
      .not.toBe(md5(rB2.signalToNoise));
  });
});

// ══ §4 类型级：容量 / 失效语义 / 指纹 ════════════════════════════════════════
// 这几条在接缝上观察不到（要么需要构造 5 个会话，要么需要换 baseSnapshot 引用），
// 但它们正是备忘录自身的契约 —— 漏了任何一条，上面 §2/§3 的绿都不足以说明它安全。
describe("§4 ShadowMemo 与指纹的自身契约", () => {
  const mkRule = (over: Partial<PropagationRule> = {}): PropagationRule => ({
    id: "r1", tenantId: "t", key: "k1",
    sourceTypeKey: "A", sourceStateVar: "demandPressure",
    viaLinkKey: "l", targetTypeKey: "B", targetStateVar: "demandLoad",
    coefficient: 1, delayTicks: 0, combine: "sum",
    decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null, weightRef: null,
    description: null, status: "PUBLISHED", domainKey: null, domainName: null,
    sourceTypeName: null, targetTypeName: null,
    ...over,
  });
  const graph = {
    objects: [{ id: "a1", typeKey: "A" }, { id: "b1", typeKey: "B" }],
    links: [{ fromId: "a1", toId: "b1", linkKey: "l" }],
  };
  const fp = (over: Partial<Parameters<typeof shadowFingerprint>[0]> = {}) =>
    shadowFingerprint({
      tenantId: "t", sessionId: "s1", scopeKey: "null",
      graph, rules: [mkRule()], ruleParams: {}, cadenceGates: {}, pairWeights: {},
      ...over,
    });

  const snap = (v: number) => ({ state: { a1: { demandPressure: v } } as TickState, pending: [] });

  it("拍号不同 ⇒ 不命中（备忘录是按拍存的，不是「这个会话算过一次就永远算过」）", () => {
    const m = new ShadowMemo();
    m.put("k", 3, snap(1));
    expect(m.get("k", 3)).not.toBeNull();
    expect(m.get("k", 4), "换了拍号还命中 ⇒ 会把上一拍的影子态当这一拍的用").toBeNull();
  });

  it("容量有界：超限淘汰最老的一格，且命中的那一格会被提到最新", () => {
    const m = new ShadowMemo(3);
    for (const k of ["a", "b", "c"]) m.put(k, 0, snap(1));
    expect(m.size, "条目数没有被容量夹住 ⇒ 长会话会把进程内存吃穿").toBe(3);

    m.get("a", 0); // 命中 ⇒ 提到最新
    m.put("d", 0, snap(1)); // 超限 ⇒ 该淘汰的是**最老的 b**，不是刚被用过的 a
    expect(m.get("b", 0), "淘汰的不是最老的那一格 ⇒ LRU 坏了").toBeNull();
    expect(m.get("a", 0), "刚命中过的一格被淘汰了 ⇒ 淘汰序错了").not.toBeNull();
    expect(m.size).toBe(3);
  });

  it("返回的是值不是内部那一格：改返回的 pending 不许污染备忘录", () => {
    const m = new ShadowMemo();
    const queued = { arriveTick: 2, targetObjectId: "b1", targetStateVar: "demandLoad", amount: 5, ruleKey: "r" };
    m.put("k", 0, { state: { a1: { demandPressure: 1 } }, pending: [queued] });
    // ⚠ `!` 与 `.at(0)!` 不是装饰：本仓 tsconfig 开了 `noUncheckedIndexedAccess`，
    //   而 **vitest 不做类型检查** —— 少了这两处，测试照样绿，红的是 `pnpm -r typecheck`
    //   （TS2532，实测被它拦下）。这正是本仓那条「两个信号度量的不是同一件事」。
    const got = m.get("k", 0)!;
    got.pending.at(0)!.amount = 999;
    expect(m.get("k", 0)!.pending.at(0)!.amount,
      "改返回值的 pending 污染了备忘录里那一格 ⇒ 下一次命中会拿到被改过的延迟队列").toBe(5);
  });

  /**
   * ⚠ 这一条守的是**一条不变量**，不是一段代码：`ShadowMemo` 的运行期判据里**没有**
   * 「baseSnapshot 换过没有」这一项（第一版有，恒假、已删 —— 病历见该类的头注）。
   * 于是正确性依赖「一个会话的 baseSnapshot 建会话时写一次、此后终生不变」。
   *
   * ⚠ 判据必须是**赋值语法位置**，不能是「这个串出现过」（铁律 0.6 第 6 条）：
   *   本文件自己、`app.ts` 的对象字面量（`baseSnapshot:`）、`=== undefined` 比较里都有这个串。
   *   故先剥注释、再按 `\.baseSnapshot\s*=(?!=)` 匹配，并**双向金丝雀**。
   */
  it("不变量守卫：全仓没有第二处会给 baseSnapshot 赋值（有 ⇒ 必须先让备忘录失效）", () => {
    // ── 金丝雀（必须能分辨语法位置：正样例中、只出现在注释里的同形串**不许**中）──
    const canarySrc = `
      // s.baseSnapshot = next;   ← 只在注释里，不许被数到
      /* s.baseSnapshot = next; */
      const x = obj.baseSnapshot === undefined;   // 比较不是赋值
      const y = { baseSnapshot: 1 };              // 字面量键不是赋值
      s.baseSnapshot = replacement;               // ← 真赋值，必须中
    `;
    expect(assignmentsToBaseSnapshot(canarySrc), "金丝雀没中 ⇒ 扫描器坏了，下面的『零处』不可信")
      .toEqual(["s.baseSnapshot = replacement;"]);

    const files = tsSourcesUnder("src");
    expect(files.length, "一个源文件都没扫到 ⇒ 扫描器坏了，不是『零处』").toBeGreaterThan(50);
    const hits = files.flatMap((f) => assignmentsToBaseSnapshot(readFileSync(f, "utf8")).map((l) => `${f}: ${l}`));
    expect(hits, "有人加了会给 baseSnapshot 赋值的写点 ⇒ 影子线会读到上一版世界，且屏上看不出来")
      .toEqual([]);
  });

  it("指纹对入参敏感：规则/图/权重/会话 任一变化都必须换一个指纹", () => {
    const base = fp();
    // 正向金丝雀：同输入必须同指纹（不然「敏感」这件事没有意义 —— 什么都变，等于没有键）
    expect(fp()).toBe(base);
    expect(fp({ rules: [mkRule({ coefficient: 2 })] }), "系数变了指纹没变 ⇒ 改动后的规则会读到旧影子态").not.toBe(base);
    expect(fp({ rules: [mkRule({ status: "DRAFT" })] }), "状态变了指纹没变").not.toBe(base);
    expect(fp({ rules: [] }), "规则集空了指纹没变").not.toBe(base);
    expect(fp({ graph: { objects: graph.objects, links: [] } }), "边少了指纹没变").not.toBe(base);
    expect(fp({ sessionId: "s2" }), "会话不同指纹却相同 ⇒ 两个会话会互相读到对方的影子线").not.toBe(base);
    expect(fp({ tenantId: "t2" })).not.toBe(base);
    expect(fp({ ruleParams: { k1: { alpha: 1 } } })).not.toBe(base);
    expect(fp({ cadenceGates: { g1: { everyTicks: 2, offsetTicks: 0 } } })).not.toBe(base);
    expect(fp({ pairWeights: { k1: { "a1>b1": 0.5 } } })).not.toBe(base);
  });
});
