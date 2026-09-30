/**
 * WO-SIM-PERF-ASSEMBLY · **接缝门**：传导相装配结果的按世界修订号复用。
 *
 * ── 本单在治什么（实测数字，不是推测）────────────────────────────────────────────
 * 真后端 `SEED_DEMO=1`、会话 `curTick=17`，服务端自报分段：
 * `graph 1374 · shadow 65 · engine 461 · persist 32 · total 2058 ms` —— `graph`（= 一次
 * `buildPropagationInputs` 的全部内容）占 **67%**，四段进一步拆开是
 * `objects 581~773ms (12499 个) · links 139~212ms (13593 条) · pairWeights 422~578ms`。
 * 一次控制台推演打 8 次这类请求，**每一次都从零重装整张图**。
 * 对照实验（把仓储的深拷关掉、其余一行不动）：`graph 1374 → 284ms`、`total 2058 → 421ms`
 * —— 成本的大头是「读」，不是「算」。
 *
 * 形态（铁律 0.6 句式）：
 * > **「我用『这一步每次都得算』当作『它的输入每次都变了』的证据，
 * >   而前者并不度量后者 —— 输入压根没变，是我每次重读了一遍。」**
 *
 * ── 这道门咬什么（为什么不是各半 unit）──────────────────────────────────────────
 * 备忘录的两半是「**判据**（世界变了没有）」与「**值**（复用出来的装配与重装是不是同一个）」。
 * 各自单测都能全绿而整体是坏的：判据漏了一个仓 ⇒ 单测绿，线上引擎吃着一张**旧图**算数，
 * 而屏上一切正常 —— 这正是本仓反复栽的静默错答。所以下面一律走**真路由 inject**
 * （真种子 → 真规则 → 真会话 → 真 tick），只在 §4 才下到源码级（那里测的是全量性，接缝上观察不到）。
 *
 * ── 判据（对照实验，缺一条不算交付）──────────────────────────────────────────────
 *  §1 金丝雀   —— 计数器真的挂在装配那条路上，且读数**有鉴别力**（不然下面全是废话）
 *  §2 头号判据 —— 世界没动时第二跑**必须命中**，且产物与重装**逐字节相同**
 *  §3 反向金丝雀（两向）—— 世界写 / 规则写之后**必须不命中**，且读数**真的跟着变**
 *  §4 机制     —— 「每处写入都 bump」与「不许有字面 NUL」两条，用**共用实现**的扫描咬死
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { assemblyMemoStats, AssemblyMemo, deepFreeze, stableStringify } from "../src/sim/assembly-memo.js";
import { rulesFingerprint } from "../src/sim/rules-fingerprint.js";
import { PROPAGATION_COEF_RULE_KEY } from "../src/synthetic/battery.js";
import { resolveSimScope } from "@platform/contracts";
import { buildPropagationInputs } from "../src/sim/propagation-inputs.js";

// ══ 夹具 ═══════════════════════════════════════════════════════════════════

const md5 = (v: unknown): string => createHash("md5").update(JSON.stringify(v)).digest("hex");

/** 剥注释（行注释 + 块注释）。数「某段源码里有什么」之前必须先做 —— 铁律 0.6 第 6 条。 */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`])\/\/.*$/gm, "$1");

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
/** 一条**真的在跑**的边，§3 规则侧反向金丝雀关的就是它。 */
const RULE_KEY = "demo_base_load_to_line_util";
/** tick 0 世界态**必须偏离静息点**（`loadIndex` 是压力族，静息点 0）—— 与影子线那单同一条实测教训。 */
const BASE_STATE = { [BASE_ID]: { loadIndex: 30 } } as const;
const PERT = {
  kind: "capacity_loss", targetObjectId: BASE_ID, targetStateVar: "loadIndex",
  magnitude: 45, mode: "set", label: "基地负载置为 45",
} as const;

interface ScopeReportLike {
  kind: string; target: string | null; hops: number;
  objects: number; links: number; droppedObjects: number; droppedLinks: number;
  unresolved: string | null;
}
/** 这一拍推出来的边。§6 咬的就是这里的 `amount`（用户看得见的那个数）。 */
interface TraceEntry { ruleKey: string; fromObjectId: string; toObjectId: string; amount: number; viaLinkKey: string }
interface TickResp {
  curTick: number;
  scope?: ScopeReportLike;
  trace?: TraceEntry[];
  /** 披露层：`?disclose=1` 才下发（默认回包形状逐字节同旧 · RL9），`trace` 在这里面。 */
  disclosure?: { trace?: TraceEntry[]; timings?: { phase: string; ms: number }[] };
}

async function newSession(t: TestApp): Promise<string> {
  const created = await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
    payload: { baseSnapshot: BASE_STATE },
  });
  expect(created.statusCode, "建会话失败").toBe(201);
  const sid = created.json().id as string;
  const p = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN, payload: PERT,
  });
  expect(p.statusCode, "建扰动失败").toBe(201);
  return sid;
}

const tick = async (t: TestApp, sid: string, n = 1): Promise<TickResp> => {
  const r = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n },
  });
  expect(r.statusCode, `tick 失败：${JSON.stringify(r.json()).slice(0, 300)}`).toBe(200);
  return r.json() as TickResp;
};

const counters = () => ({
  hits: assemblyMemoStats.hits, misses: assemblyMemoStats.misses, skipped: assemblyMemoStats.skipped,
});

// ══ §1 金丝雀 ══════════════════════════════════════════════════════════════
describe("§1 金丝雀：计数器挂在装配那条路上，且读数有鉴别力", () => {
  it("第一跑冷装一次；世界没动的第二跑命中一次；内存模式下 skipped 不动", async () => {
    const t = await seededApp();
    const sid = await newSession(t);

    // (a) 反向：**建会话 + 建扰动**都还没打过 tick ⇒ 装配一次都没跑过。计数必须纹丝不动。
    //     这一条排除「计数器挂在了别的路上、tick 之外也在动」。
    const before = counters();
    expect(before.hits + before.misses, "建会话/建扰动就跑了装配 ⇒ 计数器挂错了路").toBe(0);

    const t1 = await tick(t, sid);
    const afterFirst = counters();
    expect(afterFirst.misses - before.misses, "首跑没有冷装 ⇒ 装配根本没经过本备忘录").toBeGreaterThan(0);
    expect(afterFirst.skipped - before.skipped, "内存模式不该出现「给不出判据」").toBe(0);

    // (b) 正向：世界一行都没写过 ⇒ 第二跑**必须命中**。
    //     ⚠ 这一条是本节的重点。判据恒假时备忘录「看上去一切正常」——
    //     计数在动、代码在跑、产物也对，只是**一次都没复用**（影子线第一版就是这么骗过自己的）。
    const t2 = await tick(t, sid);
    const afterSecond = counters();
    expect(afterSecond.hits - afterFirst.hits, "世界没动却没命中 ⇒ 判据恒假，备忘录只是把成本加了一遍")
      .toBeGreaterThan(0);
    expect(t2.curTick, "第二跑要真的推进了世界（否则下面比的是同一拍）").toBe(t1.curTick + 1);
  });
});

// ══ §2 头号判据：复用出来的装配与重装是同一个 ═════════════════════════════════
describe("§2 头号判据：命中那一跑的产物，与冷装那一跑逐字节相同", () => {
  it("世界没动时，两拍的 scopeReport 逐字节相同；且命中的是同一个冻结实例", async () => {
    const t = await seededApp();
    const sid = await newSession(t);

    const t1 = await tick(t, sid);
    const t2 = await tick(t, sid);

    expect(t1.scope, "tick 回包没带范围回执 ⇒ 本门没有可比的读数").toBeDefined();
    expect(
      md5(t2.scope),
      `复用出来的装配与重装不同 —— 备忘录给错了世界：\n冷装 ${JSON.stringify(t1.scope)}\n命中 ${JSON.stringify(t2.scope)}`,
    ).toBe(md5(t1.scope));
    // 范围回执还得是**有内容**的（全 0 的话上面那条 md5 相等什么都没证明）。
    expect(t1.scope!.objects, "范围回执是空的 ⇒ 上面那条相等没有鉴别力").toBeGreaterThan(0);

    // 冻结：命中时多个请求共用同一个实例，就地改它必须**当场抛**（而不是静默污染后面的请求）。
    const frozen = await (async () => {
      // 直接问备忘录要一次：拿回的就是那条被复用/被缓存的实例。
      const memo = new AssemblyMemo<{ a: { b: number }[] }>(4);
      const v = deepFreeze({ a: [{ b: 1 }] });
      memo.put("k", "r", v);
      const got = memo.get("k", "r");
      expect(got, "刚放进去就取不到 ⇒ 备忘录自身坏了").not.toBeNull();
      try {
        (got as { a: { b: number }[] }).a[0]!.b = 2;
        return false;
      } catch {
        return true;
      }
    })();
    expect(frozen, "冻过的装配结果还能被就地改 ⇒ 命中路径会把污染带到后面每一个请求").toBe(true);
  });
});

// ══ §3 反向金丝雀（两向）：世界变了 / 规则变了，都必须失效 ═════════════════════
describe("§3 反向金丝雀：判据必须真的看着世界与规则", () => {
  it("对象写之后不命中，且图**真的跟着变**（不是只动了个计数器）", async () => {
    const t = await seededApp();
    const sid = await newSession(t);

    const before = await tick(t, sid);
    const n0 = before.scope!.objects;

    // 世界写：把一个对象并走 ⇒ 它**退出推演世界成员集合**（`entersSimWorld` 判 `mergedInto`）。
    // ⚠ 走 `repos.objects.put` 就是走**真写入漏斗**（20+ 个生产调用点全部经过它）。
    const victim = await t.repos.objects.get("demo", BASE_ID);
    expect(victim, "夹具对象不在 ⇒ 本用例没验到东西").toBeDefined();
    await t.repos.objects.put({ ...victim!, mergedInto: "obj_merged_away_by_test" });

    const b = counters();
    const after = await tick(t, sid);
    const a = counters();

    expect(a.misses - b.misses, "世界写过却仍然命中 ⇒ 引擎吃的是旧图，而屏上看不出来").toBeGreaterThan(0);
    expect(
      after.scope!.objects,
      `世界写过但图没变（${n0} → ${after.scope!.objects}）⇒ 要么判据没看着这个仓，要么成员判据没生效`,
    ).not.toBe(n0);
    expect(after.scope!.objects, "并走一个对象之后成员数应当**变少**").toBeLessThan(n0);
  });

  it("规则集变了之后不命中（规则不是对象 ⇒ 必须靠规则指纹那一半判据）", async () => {
    const t = await seededApp();
    const sid = await newSession(t);
    await tick(t, sid);

    const patch = await t.app.inject({
      method: "PATCH", url: `/a/v1/sim/sessions/${sid}/disabled-rules`, headers: ADMIN,
      payload: { disabledRuleKeys: [RULE_KEY] },
    });
    expect(patch.statusCode, "关边失败").toBe(200);

    const b = counters();
    await tick(t, sid);
    const a = counters();
    expect(
      a.misses - b.misses,
      "规则集改了却仍然命中 ⇒ 引擎吃的是按**旧规则集**装配出来的图",
    ).toBeGreaterThan(0);
  });
});

// ══ §4 机制 ════════════════════════════════════════════════════════════════
describe("§4 机制：全量性由源码扫描咬着，不靠注释", () => {
  it("内存仓储里每一处改 items 的地方，都有一次 bump（带双向金丝雀）", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/repo/memory.ts", import.meta.url)), "utf8");
    // 判据落在**语法位置**上：剥注释后逐行找 `this.items.set/delete/clear(` 这种改写。
    const mutations = stripComments(src).split("\n").filter((l) => /this\.items\.(set|delete|clear)\(/.test(l));
    const bumps = stripComments(src).split("\n").filter((l) => /this\.bump\(/.test(l));

    // 金丝雀（与主逻辑**共用同一份实现**）：人造一段「改了 items 却没 bump」的源码，必须被判不平衡。
    const canary = (s: string): boolean => {
      const m = stripComments(s).split("\n").filter((l) => /this\.items\.(set|delete|clear)\(/.test(l)).length;
      const b = stripComments(s).split("\n").filter((l) => /this\.bump\(/.test(l)).length;
      return m <= b;
    };
    expect(canary("class X { f(){ this.items.set(1,2); this.bump('t'); } }"), "金丝雀①（平衡的那个）没认出来").toBe(true);
    expect(canary("class X { f(){ this.items.set(1,2); } }"), "金丝雀②（漏 bump 的那个）没认出来 ⇒ 本扫描没有鉴别力").toBe(false);

    expect(mutations.length, "一个改 items 的地方都没扫到 ⇒ 扫描坏了，不是代码干净").toBeGreaterThan(0);
    expect(
      mutations.length,
      `改了 items 的地方有 ${mutations.length} 处，bump 只有 ${bumps.length} 处 —— ` +
        `漏 bump 的那条路不会让装配备忘录失效（引擎会吃旧世界，而屏上看不出来）：\n` +
        `${mutations.map((l) => l.trim()).join("\n")}`,
    ).toBeLessThanOrEqual(bumps.length);
  });

  it("sim/ 下不许有字面 NUL 字节（它会让 git 把源文件判成 binary，改动没人看得见）", () => {
    const hasNul = (b: Buffer): boolean => b.includes(0);
    // 金丝雀：含 NUL 的必须中、不含的必须不中 —— 缺任一条都说明本判据没在度量「有没有 NUL」。
    expect(hasNul(Buffer.from([0x61, 0x00, 0x62])), "金丝雀①（含 NUL）没认出来").toBe(true);
    expect(hasNul(Buffer.from("const SEP = \"\\u0000\";")), "金丝雀②（写成转义的）被误判成含 NUL").toBe(false);

    const files = tsSourcesUnder("src/sim");
    expect(files.length, "一个源文件都没扫到 ⇒ 扫描坏了，不是代码干净").toBeGreaterThan(0);
    const bad = files.filter((f) => hasNul(readFileSync(f)));
    expect(
      bad.length,
      `这些文件含**字面 NUL**，git 会把它们判成 binary（\`git diff\` 只剩「Binary files differ」）：\n${bad.join("\n")}`,
    ).toBe(0);
  });
});

// ══ §5 备忘录用例（接缝上观察不到的那部分）═════════════════════════════════════
describe("§4b 规则指纹必须覆盖引擎真读的每一个规则字段", () => {
  it("只改 weightRef ⇒ 指纹必须变（它是 PropagationRule 上的字段，不是 params 里的）", async () => {
    const base = {
      id: "r1", tenantId: "demo", key: "k", sourceTypeKey: "A", targetTypeKey: "B",
      sourceStateVar: "x", targetStateVar: "y", coefficient: 1, delayTicks: 0,
      combine: "ADD" as const, decay: null, clamp: null, coefficientRef: null,
      cadenceNodeId: null, status: "PUBLISHED" as const, reaction: null,
      weightRef: null,
    };
    const fp = (r: unknown): string => rulesFingerprint([r as never]);

    // 金丝雀①：同一个规则 ⇒ 同一个指纹（不然下面那条「变了」没有鉴别力）。
    expect(fp(base), "同一条规则两次算出不同指纹 ⇒ 指纹本身不稳").toBe(fp(base));
    // 金丝雀②：换一个**别的**字段（系数）必须变 —— 证明它真的在看规则内容。
    expect(fp({ ...base, coefficient: 2 }), "系数变了指纹却没变").not.toBe(fp(base));
    // ★ 主判据：`weightRef` 从 null 变成一份口径 —— 引擎按它分摊逐实例权重，图/系数一个都没动。
    //   指纹若漏了它 ⇒ 命中，而权重表是**按旧口径**算的（屏上看不出来的错数）。
    expect(
      fp({ ...base, weightRef: { basis: "bom_cost_share" } }),
      "只改了 weightRef 却算出同一个指纹 ⇒ 引擎会吃到按旧分摊口径算出来的权重表",
    ).not.toBe(fp(base));
    // 口径内换字段名同样要变（`weightRef.field` 决定量取值取自哪一列）。
    expect(fp({ ...base, weightRef: { basis: "bom_cost_share", field: "quantity" } }))
      .not.toBe(fp({ ...base, weightRef: { basis: "bom_cost_share", field: "amount" } }));
  });
});

describe("§5 备忘录自身的语义：修订号一变即作废、容量有界", () => {
  it("同一个键、修订号不同 ⇒ 不命中；键不同 ⇒ 不命中", () => {
    const m = new AssemblyMemo<string>(4);
    m.put("k", "1", "v1");
    expect(m.get("k", "1"), "刚放进去就取不到").toBe("v1");
    expect(m.get("k", "2"), "世界写过（修订号变了）却仍然命中 ⇒ 会给出旧世界").toBeNull();
    expect(m.get("other", "1"), "换了个键却命中了 ⇒ 键没有真的参与判据").toBeNull();
  });

  it("容量有界，且淘汰的是最久没用过的那个", () => {
    const m = new AssemblyMemo<string>(2);
    m.put("a", "1", "A");
    m.put("b", "1", "B");
    expect(m.get("a", "1"), "取一次 a（它成为最新）").toBe("A");
    m.put("c", "1", "C"); // 容量 2 ⇒ 挤掉最久未用的 b
    expect(m.size, "容量没有界住").toBe(2);
    expect(m.get("b", "1"), "挤掉的应当是最久未用的 b，不是刚用过的 a").toBeNull();
    expect(m.get("a", "1"), "刚用过的 a 被挤掉了").toBe("A");
  });

  it("稳定序列化：键序不同的同一份范围，必须算出同一个串（否则永远不命中）", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ a: [1, { d: 4, c: 3 }] })).toBe(stableStringify({ a: [1, { c: 3, d: 4 }] }));
    // 反向金丝雀：内容真的不同就不许相等（否则上面那两条只证明了「它回常量」）。
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

// ══ §6 准确不降级：装配体内读过的每一样东西，都必须进得来判据 ═══════════════════
/**
 * ── 这一节是怎么来的（病历，别删）──────────────────────────────────────────────
 * §1~§5 全绿之后才发现的一处**真缺陷**：`buildPropagationInputs` 的体内还读了
 * **第四个仓** `repos.rules`（拿来建 `ruleParams` —— 即「改规则即改推演」那张
 * `coefficientRef` 解析表），而备忘录的键上**只有 `rulesFingerprint(rules 实参)`**，
 * 那个指纹**明确不含 `params`**（见 `rules-fingerprint.ts` 头注）。
 *
 * ⇒ 只改一条规则的 `params`（**系数值**），实参一字不动 ⇒ 指纹不变 ⇒ **命中** ⇒
 *   引擎拿到的是**上一跑的旧系数表**。而 `effectiveCoefficient` 就吃这张表
 *   （`propagation.ts`：`ruleParams[ref.ruleKey][ref.paramKey]`）——
 *   **推出来的数是错的，屏上一切正常**。这正是本仓反复栽的静默错答。
 *
 * 形态（照铁律 0.6 句式）：
 * > **「我用『键上盖了三样』当作『装配读到的东西都盖全了』的证据，
 * >   而前者并不度量后者 —— 它体内还读了第四样。」**
 *
 * 所以本节不测「备忘录语义」（那是 §5），测的是**判据的完备性**，且判据落在
 * **用户看得见的那个数**上：系数 ×3 ⇒ 推出来的 amount 必须 ×3。
 */
describe("§6 准确不降级：改规则 params（指纹看不见它）⇒ 必须不命中，且推出来的数跟着变", () => {
  /** 取披露层里的 trace（`?disclose=1` 才下发；默认回包不含它，RL9 形状不变）。 */
  const traceOf = (r: TickResp): TraceEntry[] => r.disclosure?.trace ?? r.trace ?? [];
  /** 带披露地推一拍 —— §6 咬的是披露层里的那个数，所以必须走 disclose=1。 */
  const tickD = async (t: TestApp, sid: string, n = 1): Promise<TickResp> => {
    const r = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?disclose=1`, headers: ADMIN, payload: { n },
    });
    expect(r.statusCode, `tick(disclose) 失败：${JSON.stringify(r.json()).slice(0, 300)}`).toBe(200);
    return r.json() as TickResp;
  };

  it("只改 C36.params ⇒ 装配产物里的 ruleParams 必须是**新的那一份**（命中则给旧系数 = 红）", async () => {
    const t = await seededApp();
    // 直接咬装配契约本身：它的职责就是「按**当前**的世界与规则产出输入」。
    // 这里不需要让某条边真的响 —— `ruleParams` 是引擎 `effectiveCoefficient` 唯一吃的表，
    // 它给了旧值，推出来的数就是错的，与哪条边响不响无关。
    // ⚠ `rules` 实参刻意传 `[]`：`ruleParams` 是从**存储**里现读建的（与实参无关），
    //   传常量数组 ⇒ 规则指纹那一半恒定 ⇒ 这一条只测「存储里的规则改了有没有进判据」。
    const scope = resolveSimScope(null);

    const a1 = await buildPropagationInputs(t.repos, t.adminCtx, scope, []);
    const readCoef = (x: typeof a1): number | undefined =>
      (x.ruleParams[PROPAGATION_COEF_RULE_KEY] as Record<string, unknown> | undefined)?.[RULE_KEY] as number | undefined;
    const before = readCoef(a1);
    expect(before, `装配产物里没有 ${PROPAGATION_COEF_RULE_KEY}.${RULE_KEY} ⇒ 夹具过期`).toBeTypeOf("number");

    // 走真写入漏斗改存储里那条系数规则（与运营方改规则同一条路）。
    const row = (await t.repos.rules.list("demo", (r) => r.key === PROPAGATION_COEF_RULE_KEY))[0]!;
    await t.repos.rules.put({
      ...row,
      params: { ...(row.params as Record<string, number>), [RULE_KEY]: before! * 3 },
    });

    const a2 = await buildPropagationInputs(t.repos, t.adminCtx, scope, []);
    expect(
      readCoef(a2),
      `只改了存储里 ${PROPAGATION_COEF_RULE_KEY}.params["${RULE_KEY}"]（${before} → ${before! * 3}），` +
        `装配产物却还是旧值 ⇒ **命中了旧世界**：引擎按旧系数算，屏上数字看着正常。`,
    ).toBe(before! * 3);
    // 反向金丝雀：上面那条如果不是「取到了新值」而是「恒等于 before×3」也要能看出来。
    expect(a2, "产物仍是同一个实例 ⇒ 根本没重装，上面那条只是碰巧对上了").not.toBe(a1);
  });

  it("机制：装配路径上读过的每一个仓，都必须出现在备忘录的修订号列表里", async () => {
    // 判据是**源码**级的（接缝上观察不到「少盖了一个仓」——它只在恰好改那一个仓时才发作），
    // 所以这里扫源码。⚠ 扫之前先剥注释（铁律 0.6 第 6 条：注释里的串不度量赋值）。
    const src = stripComments(readFileSync(fileURLToPath(new URL("../src/sim/propagation-inputs.ts", import.meta.url)), "utf8"));
    const pwSrc = stripComments(readFileSync(fileURLToPath(new URL("../src/sim/pair-weights.ts", import.meta.url)), "utf8"));

    // 装配路径 = 本函数体 + 它调用的权重装配器（后者也读仓）。
    const body = src.slice(src.indexOf("export async function buildPropagationInputs"));
    const readStores = (s: string): Set<string> =>
      new Set([...s.matchAll(/\brepos\.(\w+)\.(?:list|listByType|get|revision)\s*\(/g)].map((m) => m[1]!));
    const read = new Set([...readStores(body), ...readStores(pwSrc)]);
    // 金丝雀：上面这个正则必须真的抓得到东西（抓不到 ⇒ 是量法坏了，不是「读的仓少」）。
    expect(read.size, "一个仓都没扫到 ⇒ 量法坏了（正则没匹配上），不是「没有漏」").toBeGreaterThan(0);
    expect(read.has("rules"), "扫不到 repos.rules ⇒ 量法坏了（它确实是装配读的第四个仓）").toBe(true);

    // 键上盖了哪些：`Promise.all` 里那几条 revision + 规则指纹（实参那一半）。
    const keyed = new Set([...body.matchAll(/repos\.(\w+)\.revision\s*\(/g)].map((m) => m[1]!));
    expect(keyed.size, "一个 revision 都没扫到 ⇒ 量法坏了").toBeGreaterThan(0);

    // ⛔ 这里**不许开例外**（上一版给 `rules` 开了个口子，理由是「它走指纹那一半」——
    //    而指纹那一半**不含 `params`**，那个口子正好放过本次的真缺陷）。
    //    规则那一半的指纹不是替代品：它盖的是**实参**，而 `repos.rules` 是**体内另读的存储**。
    const missing = [...read].filter((s) => !keyed.has(s));
    expect(
      missing,
      `这些仓装配时读了、却没进备忘录的键 ⇒ 改它们会让引擎吃到旧值（静默错答）：${missing.join(", ")}\n` +
        `修法：把 \`repos.<仓>.revision(tenantId)\` 加进上面的 \`Promise.all\`（那是唯一判据，别改成 epochs）。`,
    ).toEqual([]);
  });
});
