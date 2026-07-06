import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

/**
 * CORE-E2-PROPAGATE（P1·"解决核"）真传导·真源·teeth。
 *
 * 治本前病灶（真机实测「点了没变」）：沙盘 4 状态变量（demandPressure/utilPressure…）没接真对象态 →
 * view-config nodeObjectState 空 → 起跑态全 0 → 推进 tick 传导记 0；就绪认证 Trial Tick 也把传导写死 0。
 *
 * 治本（本文件守）：
 *  C1 — 就绪认证 Trial Tick **真跑 propagateTick**（与真沙盘 /tick 同一逻辑），trial.rulesFired 含真实触发的传导规则数 >0。
 *  C3 — 传导规则 sourceStateVar 接**真对象已物化数值属性**（Order.demandDelta/Model.totalDemand/Line.utilization），
 *       view-config nodeObjectState 与 Trial Tick 起跑态命中真值 → 推进 tick 真有反应；11 派生规则真物化（世界完整度升）。
 *  C4 teeth — **清空真源 → 起跑态归 0、Trial Tick 传导触发归 0、真 tick 无传导写出**（诚实空态）。revert 真源接线 → 本文件红。
 */

const enableSim = (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.certification": true } },
  });

type Cfg = { stateVars: string[]; nodeObjectState: Record<string, Record<string, number>> };
type Cert = {
  level: string;
  trialTick: { passed: boolean; rulesFired: number };
  worldCompleteness: { pct: number; stateVars: { present: number; needed: number }; derivationRules: { present: number; needed: number } };
};

const getCfg = async (t: Awaited<ReturnType<typeof makeApp>>): Promise<Cfg> =>
  (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/view-config", headers: ADMIN })).json()) as Cfg;

const getCert = async (t: Awaited<ReturnType<typeof makeApp>>): Promise<Cert> => {
  const sid = (await (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: {} } })).json()).id as string;
  return (await (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification?scope=GLOBAL`, headers: ADMIN })).json()) as Cert;
};

/** 从**真对象态**跑一遍真 /tick，回传写出了 demandLoad/loadIndex（传导态）的节点数。 */
const tickWriteCount = async (t: Awaited<ReturnType<typeof makeApp>>, snapshot: Record<string, Record<string, number>>): Promise<number> => {
  const sid = (await (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: snapshot } })).json()).id as string;
  const tick = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
  const st = tick.json().state as Record<string, Record<string, number>>;
  return Object.values(st).filter((v) => typeof v.demandLoad === "number" || typeof v.loadIndex === "number").length;
};

/** teeth：从所有对象上抹掉给定真源属性（re-put），模拟"真源被清空/未接线"。 */
const stripProps = async (t: Awaited<ReturnType<typeof makeApp>>, propKeys: string[]): Promise<void> => {
  for (const ty of await t.repos.ontologyTypes.list("demo")) {
    for (const o of await t.repos.objects.listByType("demo", ty.key)) {
      const props = { ...(o.props as Record<string, unknown>) };
      let changed = false;
      for (const k of propKeys) if (k in props) { delete props[k]; changed = true; }
      if (changed) await t.repos.objects.put({ ...o, props });
    }
  }
};

describe("CORE-E2-PROPAGATE · 真源真传导（C1/C3）", () => {
  it("C3：真源接线后 view-config nodeObjectState 非空（obj.props 命中 stateVar 名的真值）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const cfg = await getCfg(t);
    expect(cfg.stateVars).toEqual(["demandDelta", "demandLoad", "loadIndex", "totalDemand", "utilization"]);
    // 真源命中：起跑态非空，且含真派生值（Model.totalDemand 真物化）。
    const entries = Object.values(cfg.nodeObjectState);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((row) => typeof row.totalDemand === "number" && row.totalDemand > 0)).toBe(true);
  });

  it("C1：就绪认证 Trial Tick 真跑 propagateTick → rulesFired 含真实触发的传导规则数 >0（非记 0）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const cert = await getCert(t);
    expect(cert.trialTick.passed).toBe(true);
    // 3 条种子传导规则全在真图上触发（2 即时 + 1 延迟落 pending）→ rulesFired ≥ 3（真值驱动，非记 0）。
    expect(cert.trialTick.rulesFired).toBeGreaterThanOrEqual(3);
  });

  it("C3：11 派生规则真物化 → 世界完整度 stateVars/derivationRules present=needed（35%→升）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const cert = await getCert(t);
    expect(cert.worldCompleteness.stateVars.needed).toBe(11);
    expect(cert.worldCompleteness.stateVars.present).toBe(11); // 全 11 派生属性真物化在对象上
    expect(cert.worldCompleteness.derivationRules.present).toBe(11);
    expect(cert.worldCompleteness.pct).toBeGreaterThan(41); // 治本前基线 41%
  });

  it("C1/C3：从真快照真 /tick → 真跨对象传导写出 demandLoad/loadIndex（推进 tick 真有反应）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const cfg = await getCfg(t);
    const written = await tickWriteCount(t, cfg.nodeObjectState);
    expect(written).toBeGreaterThan(0); // 真源驱动，真写出传导态
  });
});

describe("CORE-E2-PROPAGATE · teeth（C4 · revert→red）", () => {
  it("清空真源属性 → 起跑态归空 + Trial Tick 传导触发归 0 + 真 tick 无传导写出（诚实空态）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    // 基线（真源在）：非空 + 触发 >0 + 真写出 >0。
    const before = await getCfg(t);
    expect(Object.keys(before.nodeObjectState).length).toBeGreaterThan(0);
    expect((await getCert(t)).trialTick.rulesFired).toBeGreaterThanOrEqual(3);
    expect(await tickWriteCount(t, before.nodeObjectState)).toBeGreaterThan(0);

    // teeth：抹掉 3 个真源属性（模拟真源被清空/未接线）。
    await stripProps(t, ["demandDelta", "totalDemand", "utilization"]);

    // 起跑态命中不到真源 → nodeObjectState 空（诚实空态，绝不哈希造伪）。
    const after = await getCfg(t);
    expect(Object.keys(after.nodeObjectState).length).toBe(0);
    // Trial Tick 无真源可传导 → 触发归 0（无 DSL 派生规格 + 传导 snapshot 空）。
    expect((await getCert(t)).trialTick.rulesFired).toBe(0);
    // 真 /tick 从空快照跑 → 无传导态写出。
    expect(await tickWriteCount(t, after.nodeObjectState)).toBe(0);
  });

  it("清空派生真值（Model.totalDemand）→ 世界完整度 derivations present 掉（非声明即算）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const beforePresent = (await getCert(t)).worldCompleteness.derivationRules.present;
    await stripProps(t, ["totalDemand"]); // Model.totalDemand 派生真值清空
    const afterPresent = (await getCert(t)).worldCompleteness.derivationRules.present;
    expect(afterPresent).toBeLessThan(beforePresent); // 真物化掉 → present 掉（真值驱动·teeth）
  });
});
