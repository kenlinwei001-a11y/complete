/**
 * WO-3ROOT-P3 接缝门 —— **「越界由域夹住」从一句承诺变成一条入口不变量**。
 *
 * ══ 病灶（一句话）════════════════════════════════════════════════════════════════
 * 域只在**传导核之内**执行，而写世界态的路有三条（播种 / 核 / C2 合成），且 C2 合成**排在核之后**
 * 且对命中格**无条件覆写**（`bucket[sv] = round12(cur + λ·(base − rest))`）⇒ 核刚夹到 0 的值，
 * 下一行就被换成 `λ·base`。同一拍里回执报「已夹到 0」、落盘世界读 **−59.724650**，逐位矛盾。
 *
 * ══ 本门咬的是**链接缝**，不是某一个函数 ══════════════════════════════════════════
 *  · §1 咬「回执 ↔ 世界态」这条恒等式（E1）—— 只测 `projectWorldCells` 返回值不算数，
 *       必须断言**它改完的那份世界**与账**逐位**对得上，且**未点名格一个字节没动**；
 *  · §3 咬「C2 合成 → 入口」这条缝（E3）—— 合成层是**在核之外**的第二个写点，
 *       把入口接到核上而漏了它，本门的恒等式当场红（这正是 PRD §一 事实 7 的形态）；
 *  · §4 咬「播种 → 入口」（Y4/tick0）—— 走**真种子世界**，不是手搓夹具。
 *
 * ⛔ 断言一律**对照实验**式（CLAUDE.md 铁律 1.5 判据一）：每条"不动/不越界"都必须配一条
 *    「同一装置换个输入就动起来」的阳性对照，否则零违反读作"修好了"而实际是装置空转。
 * ⛔ 本文件不新增门 / 棘轮 / 基线 JSON（仓主禁令 3）：它是一份**测试**，不产基线文件。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import {
  seedDemoDerivationSpecs,
  recomputeDemoDerivationsAtSeed,
} from "../src/seed-derivation-specs.js";
import { deriveSeedBaseSnapshot } from "../src/sim/seed-world.js";
import { makeRestoreSpecBase } from "../src/sim/spec-base-synthesis.js";
import { mergeStateVarDisclosure, projectWorldCells } from "../src/sim/world-projection.js";
import { STATE_VAR_DOMAINS, stateVarDomains, stateVarValueRef } from "../src/synthetic/battery.js";
import type { PropagationRule, TickState } from "@platform/contracts";

/** 与生产同形的规则字面量（核只读其中几个字段；其余是契约里 `.default(null)` 推出来的必填位）。 */
const rule = (over: Partial<PropagationRule> = {}): PropagationRule => ({
  id: "r1", tenantId: "t", key: "k1",
  sourceTypeKey: "Material", sourceStateVar: "priceShock",
  viaLinkKey: "l", targetTypeKey: "Material", targetStateVar: "shortageRisk",
  coefficient: 1, delayTicks: 0, combine: "sum",
  decay: null, clamp: null, coefficientRef: null, cadenceNodeId: null, weightRef: null, description: null,
  status: "PUBLISHED", domainKey: null, domainName: null,
  sourceTypeName: null, targetTypeName: null,
  ...over,
});

/** 世界态深拷贝（判"未点名格一个字节没动"必须两份独立对象，⛔ 不许拿同引用自比）。 */
const copy = (s: TickState): TickState => JSON.parse(JSON.stringify(s)) as TickState;

async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  // ⚠ 与生产 `SEED_DEMO=1` **同源**（`server.ts` 那两步）：只铺 battery+rules 的夹具里
  // 规格格（WIPLot.feedPressure≈111 / Line.blockedPressure 27–183 / Material.shortageRisk −161…）
  // **根本不存在** ⇒ 「0 越域格」会是空世界的平凡真。基线（真链路）实测 360 格。
  await seedDemoDerivationSpecs(t.repos, t.services.ontologyCore, t.services.governance, t.adminCtx);
  await recomputeDemoDerivationsAtSeed(t.repos, t.services.ontologyCore, t.adminCtx);
  await t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });
  return t;
}

describe("WO-3ROOT-P3 · 声明域是世界态写出的入口不变量", () => {
  // ══════════════════════════════════════════════════════════════════════════
  // §0 装置自证（阳性对照，三条实验共用）
  // ══════════════════════════════════════════════════════════════════════════
  it("§0 🐤 金丝雀 · 域表与登记表非空（不中 ⇒ 下面所有「零违反」都是装置空转）", () => {
    expect(Object.keys(STATE_VAR_DOMAINS).length).toBeGreaterThanOrEqual(38);
    expect(stateVarValueRef("Material", "shortageRisk")).toBeDefined();
    const d = stateVarDomains();
    expect(d.shortageRisk!.min).toBe(0);
    expect(d.shortageRisk!.max).toBe(100);
    // 无域声明的反例（对照臂要用）：`procurementDelay` 不在表里 ⇒ 入口**碰不到**它。
    expect(d.procurementDelay).toBeUndefined();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // §1 E1 主判据 · 回执 ↔ 世界态的对账恒等式（入口在场 / 不在场 A/B）
  // ══════════════════════════════════════════════════════════════════════════
  it("§1 E1 · 点名格 world === 回执.value 逐位；未点名格 world === 入口前原值 逐位", () => {
    const domains = stateVarDomains();
    /** 入口**前**的那一份（生产里由调用方在 `state = out.next` 之前抓住，见 `app.ts` 主线）。 */
    const tickStart: TickState = {
      m1: { shortageRisk: -161.417972 }, // 存量就在硬下界之外（判据 ②）
      m2: { shortageRisk: 40 },          // 带内、本拍没变（判据 ①）
      m3: { shortageRisk: 10 },          // 带内、本拍**有**新读数（60 → 上方膝点外）
      m4: { procurementDelay: -4 },      // 无域声明
      m5: { forecastBias: 150 },         // 有界 −100..100，存量越上界
    };
    const world = copy(tickStart);
    world.m3!.shortageRisk = 80; // 本拍新读数：合法（≤100）但落在压缩带里

    // ── 对照臂（入场前的世界）：越界格必须**真的存在**，否则本条的"零违反"是恒真 ──
    const untreatedOutOfDomain: string[] = [];
    for (const [objId, bucket] of Object.entries(world)) {
      for (const [sv, raw] of Object.entries(bucket)) {
        const d = domains[sv];
        if (d === undefined || typeof raw !== "number") continue;
        if (raw < d.min || (d.max !== null && raw > d.max)) untreatedOutOfDomain.push(`${objId}.${sv}`);
      }
    }
    expect(untreatedOutOfDomain).toEqual(["m1.shortageRisk", "m5.forecastBias"]);

    // ── 干预臂：过唯一投影入口 ────────────────────────────────────────────────
    const ledger = projectWorldCells(world, tickStart, domains);

    // 账：三格被投影（两格越界 + 一格是"本拍新读数"），按 (objectId, stateVar) 稳定排序。
    expect(ledger.saturations.map((s) => `${s.objectId}.${s.stateVar}`))
      .toEqual(["m1.shortageRisk", "m3.shortageRisk", "m5.forecastBias"]);
    // 未声明量纲被**点名**（不夹不衰减，但必须让"它是纯积分器"看得见）。
    expect(ledger.undeclaredStateVars).toEqual(["procurementDelay"]);
    expect(ledger.declaredStateVars).toEqual(["forecastBias", "shortageRisk"]);

    // ── 恒等式（逐位，`toBe` 不是 `toBeCloseTo`）───────────────────────────────
    for (const ev of ledger.saturations) {
      expect(world[ev.objectId]![ev.stateVar]).toBe(ev.value); // 点名格：回执说的 === 世界存的
    }
    expect(world.m1!.shortageRisk).toBe(0);                       // 压力族 rest===min ⇒ 硬地板
    expect(world.m5!.forecastBias).toBeGreaterThan(-100);
    expect(world.m5!.forecastBias).toBeLessThan(100);
    // 未点名格：一个字节都不许动（m2 带内未变；m4 压根没声明域 ⇒ 入口碰不到它）
    expect(world.m2!.shortageRisk).toBe(40);
    expect(world.m4!.procurementDelay).toBe(-4);
    // 且新读数那一格被**压缩但不夹死**（保序：80 > 75 拐点 ⇒ 严格减小、仍 > 拐点）
    expect(world.m3!.shortageRisk).toBeLessThan(80);
    expect(world.m3!.shortageRisk).toBeGreaterThan(75);

    // 回包那一份（核账 + 入口账）三样齐全 —— 回执就是它，不是核自报的承诺。
    const disclosure = mergeStateVarDisclosure({ decayUnresolved: [], decayApplied: {} }, ledger);
    expect(disclosure.saturations).toEqual(ledger.saturations);
    expect(disclosure.declaredStateVars).toEqual(ledger.declaredStateVars);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // §2 E2 反向护栏 · 不该动的格逐位不许动（判「修法有没有变成全世界重写」的耳朵）
  // ══════════════════════════════════════════════════════════════════════════
  it("§2 E2 · 全体带内 ⇒ 一个字节不动、账为空；同一装置换个输入就动（阳性对照）", () => {
    const domains = stateVarDomains();
    // 全体落在域内、且没有本拍新读数 ⇒ 投影器应当**完全不碰**
    const quiet: TickState = { m1: { shortageRisk: 40 }, m2: { forecastBias: -20 }, m3: { procurementDelay: -7 } };
    const quietStart = copy(quiet);
    const quietLedger = projectWorldCells(quiet, quietStart, domains);
    expect(quietLedger.saturations).toEqual([]);
    expect(JSON.stringify(quiet)).toBe(JSON.stringify(quietStart)); // 逐字节，含键序

    // 🐤 阳性对照：同一装置，只把一格推过硬上界 ⇒ 账非空且那一格变了。
    //    （没有这一臂，"上面什么都没动"可能只是投影器坏了 —— 本仓假绿第 9 形态。）
    const hot: TickState = { m1: { shortageRisk: 40 }, m2: { forecastBias: 250 }, m3: { procurementDelay: -7 } };
    const hotStart = copy(hot);
    const hotLedger = projectWorldCells(hot, hotStart, domains);
    expect(hotLedger.saturations.map((s) => `${s.objectId}.${s.stateVar}`)).toEqual(["m2.forecastBias"]);
    expect(hot.m2!.forecastBias).not.toBe(hotStart.m2!.forecastBias);
    expect(hot.m1!.shortageRisk).toBe(40);        // 同一次投影里，带内格依旧不动
    expect(hot.m3!.procurementDelay).toBe(-7);    // 无声明域那格依旧不动
  });

  // ══════════════════════════════════════════════════════════════════════════
  // §3 E3 归因硬测试 · C2 合成的偏置项 `λ·base` 必须**结构性消失**
  //
  // 病灶实测（真链路，证据 `docs/evidence/WO-NEGSEED-P3-receipt-vs-world.txt`）：
  //   `obj_material_elyte.shortageRisk` base = −161.417972、λ = 0.37
  //   ⇒ 核输出 0（回执明说已夹到 0）经 C2 合成 ⇒ 落盘 **−59.724650**（= 0.37×base 逐位）。
  // ══════════════════════════════════════════════════════════════════════════
  it("§3 E3 · 合成层写在核之后 ⇒ 入口必须排在合成之后，否则偏置项原样复活", () => {
    const domains = stateVarDomains();
    const BASE = -161.417972;  // 实测播种基值
    const LAMBDA = 0.37;       // 实测 λ（C35 衰减率）
    const graph = { objects: [{ id: "m1", typeKey: "Material" }], links: [] };
    // 目标是 `Material.shortageRisk` ⇒ 该格 inDegree ≥ 1 ⇒ **非外生** ⇒ C2 合成会写它。
    const restoreSpecBase = makeRestoreSpecBase({
      baseSnapshot: { m1: { shortageRisk: BASE } },
      graph, rules: [rule()], stateVarDomains: domains,
    });

    // 臂①：C2 合成**之后**碰一次（= 今天之前的形态）—— 不动点必须复现，且越下界。
    const blind: TickState = { m1: { shortageRisk: 0 } };
    restoreSpecBase(blind, { shortageRisk: LAMBDA });
    expect(blind.m1!.shortageRisk).toBe(Math.round(0 + LAMBDA * (BASE - 0) * 1e12) / 1e12);
    expect(blind.m1!.shortageRisk).toBeLessThan(0); // 声明了 [0,100] 却存着负数 —— 病灶原样

    // 臂②：同一输入，合成之后**过入口**（= 本单的次序：核 → 合成 → 入口）。
    const fixed: TickState = { m1: { shortageRisk: 0 } };
    const tickStart = copy(fixed); // 入口前那一份（合成之前）
    restoreSpecBase(fixed, { shortageRisk: LAMBDA });
    const ledger = projectWorldCells(fixed, tickStart, domains);

    // 结构判据：`world − 核输出 = λ·base` 这条恒等式**不复存在**（不是"数字变小了"）。
    expect(fixed.m1!.shortageRisk).not.toBe(blind.m1!.shortageRisk);
    expect(fixed.m1!.shortageRisk).toBe(0);                     // 硬地板：∈ [0,100]
    expect(fixed.m1!.shortageRisk).toBeGreaterThanOrEqual(0);
    expect(fixed.m1!.shortageRisk).toBeLessThanOrEqual(100);
    // 且这次收回**有账**（raw 原样留在回执里，一个字节不丢）。
    const ev = ledger.saturations.find((s) => s.stateVar === "shortageRisk")!;
    expect(ev.raw).toBe(blind.m1!.shortageRisk);
    expect(ev.value).toBe(0);
    expect(ev.bound).toBe("min");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // §4 Y4/tick0 覆盖 · **真种子世界**（走 `deriveSeedBaseSnapshot`，不手搓夹具）
  //
  // ⛔ 只修 tick≥1 = 半份（PRD §八·9）：tick0 的越域格与 tick≥1 是**同一条不变量**。
  // ══════════════════════════════════════════════════════════════════════════
  let shared: TestApp;
  let derived: Awaited<ReturnType<typeof deriveSeedBaseSnapshot>>;
  beforeAll(async () => {
    shared = await seededApp();
    derived = await deriveSeedBaseSnapshot(shared.repos, "demo");
  }, 180_000);

  it("§4 tick0 · 播种世界逐格过入口：声明域内 0 越界格、账非空且与落盘逐位一致", () => {
    const domains = stateVarDomains();

    // 🐤 阳性对照：世界是**真的**（否则"零越界"是空世界的平凡真）。
    const objCount = Object.keys(derived.state).length;
    expect(objCount).toBeGreaterThan(4000); // 实测 4425

    // 声明域声明的格：逐格必须落在 [min,max] 内（路 A：0 越界格）
    let declaredCells = 0;
    const outOfDomain: string[] = [];
    for (const [objId, bucket] of Object.entries(derived.state)) {
      for (const [sv, raw] of Object.entries(bucket)) {
        const d = domains[sv];
        if (d === undefined || typeof raw !== "number") continue;
        declaredCells += 1;
        if (raw < d.min || (d.max !== null && raw > d.max)) outOfDomain.push(`${objId}.${sv}=${raw}`);
      }
    }
    expect(declaredCells).toBeGreaterThan(0);
    expect(outOfDomain).toEqual([]); // 基线（入口不在场）：360 格越界

    // tick0 的账**非空**（基线 = 0 条）—— 且每一条的 value 逐位等于落盘的那一格
    const sat = derived.stateVarReport.saturations;
    expect(sat.length).toBeGreaterThanOrEqual(1);
    // 阳性对照：真链路基线的越域对是 **360**（8 拍探针逐位核对过），不是个位数。
    // ⛔ 不许写死 360（写死不度量今天真的铺了谁）—— 只钉「与量级相符」，避免夹具退化成空世界。
    expect(sat.length).toBeGreaterThanOrEqual(100);
    for (const ev of sat) {
      expect(derived.state[ev.objectId]![ev.stateVar]).toBe(ev.value);
      const d = domains[ev.stateVar]!;
      expect(ev.value).toBeGreaterThanOrEqual(d.min);
      if (d.max !== null) expect(ev.value).toBeLessThanOrEqual(d.max);
      expect(ev.raw).not.toBe(ev.value); // 记的是**真发生过的**收回，不是走过场
      // 收回的**方向**必须与「越出哪一侧」一致（记错边界 = 账是编的）
      expect(ev.bound).toBe(ev.raw < d.min ? "min" : "max");
    }
    // 未声明域的量纲被点名（它们是纯积分器，靠点名保持诚实）
    expect(derived.stateVarReport.undeclaredStateVars.length).toBeGreaterThan(0);
  });

  it("§5 R6 · 同输入两跑：世界态与 tick0 账**逐字节**一致", async () => {
    const b = await deriveSeedBaseSnapshot(shared.repos, "demo");
    expect(JSON.stringify(derived.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(derived.stateVarReport)).toBe(JSON.stringify(b.stateVarReport));
    expect(b.stateVarReport.saturations.length).toBeGreaterThanOrEqual(1); // 金丝雀：不是两个空账
  });
});
