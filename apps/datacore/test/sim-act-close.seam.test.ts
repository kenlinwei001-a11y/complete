import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-SIM-ACT-CLOSE · **扰动闭环接缝门**（欠账 #150 / #151 / #152）。
 *
 * ══ 这条测试为什么不是"各半 unit" ══
 *
 * 沙盘的病从来不在某一半：引擎能传导（`sim-propagation.test.ts` 全绿）、路由能收扰动
 * （`sim-perturbation.test.ts` 全绿）、前端能画沙盘（`sandbox-*.test.tsx` 全绿）——
 * 三份绿测试摞在一起，用户仍然**在界面上做不出任何一个让世界改变的动作**。
 * 断的是接缝：`POST …/act` 零 src 调用方、`POST …/perturbations` 有 API 封装但零 UI 调用方。
 *
 * 所以本门的驱动方式是：**从前端源码里把它真正构造的那个请求抽出来，用抽出来的东西去打真后端**。
 *  · 前端把端点/字段名改了、或把那个按钮删了 ⇒ 抽取失败或 payload 变形 ⇒ 红；
 *  · 后端引擎不传导了、或扰动没进 `propagateTick` ⇒ 下游 KPI 不变 ⇒ 红。
 * 任何一半退化都红 —— 这正是 SEAM-GATE 要的「接缝驱动通」而非「各半绿」。
 *
 * ⚠ 每一处"抽取"都先跑金丝雀（铁律 0.6）：读到的源码非空 + 一个**已知必中**的锚点先命中，
 *   不中就报「工具坏了」，绝不报「前端没接线」。
 */

// ── 源码抽取（带金丝雀）─────────────────────────────────────────────────────────
const readRepoFile = (relFromTestDir: string): string =>
  readFileSync(fileURLToPath(new URL(relFromTestDir, import.meta.url)), "utf8");

const SANDBOX_VIEW = "../../frontend-shell/src/views/sim/SandboxView.tsx";
const ENDPOINTS = "../../frontend-shell/src/api/endpoints.ts";

/**
 * 从 `SandboxView.tsx` 里抽出「施加扰动」那次调用真正传的 body 字段名。
 * 抽的是 `createSimPerturbation(sessionId, { … })` 花括号里的一级键。
 *
 * ⚠ **这个抽取器第一版就骗了我一次，原样记在这里**（铁律 0.6 第 1 次 = 修 + 记账）：
 * 初版正则只认 `^ {8}key:`，而 `magnitude,` / `durationTicks,` 在源码里是 **ES 简写属性**（无冒号）
 * ⇒ 抽出 5 个键、漏掉 2 个，而且那 5 个看着完全合理。若不是下面写死了期望全集，
 * 这个"看起来相关的数字"会被当成结论用下去 —— 形态即「我用 `key:` 的命中数当作
 * 『body 有哪些字段』的证据，而前者并不度量后者」。
 * 现在两种写法都认；⑤ 的双向反证（真源码必中 / 假源码必空）就是这条的常驻门。
 */
function frontendPerturbationBodyKeys(src: string): string[] {
  const at = src.indexOf("createSimPerturbation(sessionId, {");
  if (at < 0) return [];
  const open = src.indexOf("{", at);
  // 一级键 = 缩进为 8 空格的 `key:`（普通属性）或 `key,`（ES 简写属性）。
  const body = src.slice(open, src.indexOf("\n      });", open));
  return [...body.matchAll(/^ {8}([a-zA-Z][a-zA-Z0-9]*)\s*[:,]/gm)].map((m) => m[1]!);
}

// ── 世界种子：TypeA --FEEDS--> TypeB，一条已发布传导规则（coefficient 2·零延迟）────────
// 行业无关（TypeA/TypeB/FEEDS 是结构名不是业务名），KPI 取**下游** TypeB 的 load ——
// 取上游就成了"我写进去多少就读出多少"，那证明不了传导。
const ORG = { type: "SYNTHETIC" as const, jobId: "wo-sim-act-close" };
const TENANT = "demo";

const enableSim = (t: TestApp, tenant = TENANT) =>
  t.app.inject({
    method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.certification": true } },
  });

async function seedWorld(t: TestApp, opts: { delayTicks?: number } = {}): Promise<void> {
  for (const k of ["TypeA", "TypeB"]) {
    await t.repos.ontologyTypes.put({
      id: `otype_${k}`, tenantId: TENANT, key: k, displayName: k,
      properties: [], derivedProperties: [], sourceBindings: [], version: 1, status: "ACTIVE",
    });
  }
  await t.repos.objects.put({ id: "o_up", tenantId: TENANT, type: "TypeA", props: {}, origin: ORG });
  await t.repos.objects.put({ id: "o_down", tenantId: TENANT, type: "TypeB", props: {}, origin: ORG });
  await t.repos.links.put({ id: "lnk", tenantId: TENANT, type: "FEEDS", fromId: "o_up", toId: "o_down", origin: ORG });
  const r = await t.app.inject({
    method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN,
    payload: {
      key: "r_feeds", sourceTypeKey: "TypeA", sourceStateVar: "load", viaLinkKey: "FEEDS",
      targetTypeKey: "TypeB", targetStateVar: "load", coefficient: 2, delayTicks: opts.delayTicks ?? 0,
      status: "PUBLISHED",
    },
  });
  expect(r.statusCode, "种传导规则失败——后面的断言全部无意义").toBe(201);
}

const BASE = { o_up: { load: 10 }, o_down: { load: 0 } };
const newSession = async (t: TestApp, baseSnapshot: unknown = BASE): Promise<string> =>
  (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } })).json().id as string;

/** 下游 KPI（= 用户在屏上看的那个数的来源）。 */
const downstream = (state: Record<string, Record<string, number>>): number => state.o_down?.load ?? 0;

describe("WO-SIM-ACT-CLOSE · 扰动闭环接缝（前端入口 → 传导 → KPI 真的变）", () => {
  // ══ ① 接缝驱动主用例 ═══════════════════════════════════════════════════════════
  it("① 用**前端源码里真实的那个请求**打后端 → 下游 KPI 真的变；不施加扰动的对照组不变", async () => {
    // ── 抽取 + 金丝雀 ───────────────────────────────────────────────────────────
    const view = readRepoFile(SANDBOX_VIEW);
    const endpoints = readRepoFile(ENDPOINTS);
    expect(view.length, "SandboxView.tsx 读到空内容——路径漂了，先修工具再看结论").toBeGreaterThan(1000);
    expect(endpoints.length, "endpoints.ts 读到空内容——路径漂了").toBeGreaterThan(1000);
    // 金丝雀：一个**已知必中**的锚点（这两行是本页一直都有的，与本单无关）。
    expect(view, "金丝雀不中 ⇒ 抽取工具坏了，不许据此报「前端没接线」").toContain(`data-testid="sandbox-tick-btn"`);
    expect(endpoints, "金丝雀不中 ⇒ 抽取工具坏了").toContain("export const simTick");

    // 前端真的有那个按钮，且它真的调施加口（不是只 import 不调 —— 那是"排练"不是"实现"）。
    expect(view, "沙盘没有「施加扰动」按钮 ⇒ 用户仍然做不出任何动作（#150 复发）")
      .toContain(`data-testid="sandbox-perturbation-apply-btn"`);
    expect(view, "按钮在、但没接到施加口上（假接线）").toContain("createSimPerturbation(sessionId, {");
    // 落点必须来自**真物化对象 id**：写到 `Type#0` 这种占位键上，屏上会变而下游一动不动。
    expect(view, "扰动落点候选不是从 nodeObjectIds（真物化 id）来的 ⇒ 传导取不到源态").toContain("cfg?.nodeObjectIds?.[t]");

    // 前端封装映射到哪个后端端点（端点改了这里就抽不到 ⇒ 红）。
    const epMatch = endpoints.match(/createSimPerturbation[\s\S]{0,900}?`(\/a\/v1\/sim\/sessions\/\$\{[^`]*?\}\/perturbations)`/);
    expect(epMatch, "抽不到 createSimPerturbation 的 URL 模板——前端改了端点或封装被删").not.toBeNull();

    // 前端真传的 body 字段名（改名/漏传 ⇒ 下面构造的 payload 跟着变形 ⇒ 后端行为变 ⇒ 红）。
    const keys = frontendPerturbationBodyKeys(view);
    expect(keys.length, "抽不到前端 body 字段——抽取器坏了或调用形状变了").toBeGreaterThan(0);
    expect([...keys].sort()).toEqual(
      ["durationTicks", "kind", "label", "magnitude", "mode", "targetObjectId", "targetStateVar"].sort(),
    );

    // ── 真跑：对照组（不施加扰动）───────────────────────────────────────────────
    const tc = await makeApp();
    await enableSim(tc);
    await seedWorld(tc);
    const sidControl = await newSession(tc);
    const controlTick = await tc.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sidControl}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(controlTick.statusCode).toBe(200);
    const kpiControl = downstream(controlTick.json().state);
    // 前置事实：这个世界本来就会传导（coefficient 2 × 上游 10）。否则下面"变了"证明不了任何事。
    expect(kpiControl, "对照组本身就不传导 ⇒ 主用例测了个寂寞").toBe(20);

    // ── 真跑：实验组（走前端那条路施加扰动，再推一格）─────────────────────────────
    const t = await makeApp();
    await enableSim(t);
    await seedWorld(t);
    const sid = await newSession(t);

    // ⚠ payload 的**键**逐个来自上面从前端源码抽出来的 `keys`，不是这里手抄一份。
    const fixture: Record<string, unknown> = {
      kind: "capacity_loss",
      targetObjectId: "o_up",
      targetStateVar: "load",
      magnitude: 10,
      mode: "delta",
      durationTicks: null,
      label: "SEAM · 上游 load +10",
    };
    for (const k of keys) expect(fixture, `前端新增了 body 字段 ${k}，本门未覆盖——补 fixture 再跑`).toHaveProperty(k);
    const payload = Object.fromEntries(keys.map((k) => [k, fixture[k]]));

    const applied = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN, payload,
    });
    expect(applied.statusCode, `施加口拒收前端真传的 payload：${applied.body}`).toBe(201);
    // ③ 回包的 state 就是前端就地落屏的那份 ⇒ **KPI 当场变**（不等 tick）。上游 10 → 20。
    expect(applied.json().state.o_up.load, "扰动没落到当前 tick 的世界态上 ⇒ 屏上不会变").toBe(20);

    // ④ 再推一格：扰动沿本体链路扩散到下游 ⇒ 下游 KPI 与对照组**不同**。
    const tick = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    const kpiPerturbed = downstream(tick.json().state);
    expect(kpiPerturbed, "扰动没进传导 ⇒ 下游 KPI 与不施加时一样 = 闭环没闭合").not.toBe(kpiControl);
    expect(kpiPerturbed, "coefficient 2 × 被扰动到 20 的上游 = 40").toBe(40);
    // 溯源（R13）：这一格是哪几次扰动造成的，回包里说得出来。
    expect(tick.json().appliedPerturbations).toEqual([applied.json().perturbation.id]);
  });

  // ══ ② 限时扰动到期真回退（"停机 72h" 不许悄悄变成永久停机）══════════════════════
  it("② durationTicks 到期 → 上游自动回退，下游 KPI 跟着回到对照值（不是永久生效）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedWorld(t);
    const sid = await newSession(t);
    await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: {
        kind: "capacity_loss", targetObjectId: "o_up", targetStateVar: "load",
        magnitude: 10, mode: "delta", durationTicks: 1, label: "SEAM · 只持续 1 tick",
      },
    });
    // tick#1：扰动仍在生效期（producedTick=1 时已到期，引擎当格回退）——逐格断言，不含糊。
    const tick1 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(tick1.json().state.o_up.load, "到期未回退 ⇒ 限时扰动悄悄变成永久").toBe(10);
    expect(downstream(tick1.json().state), "回退后下游应回到对照值 2×10").toBe(20);
    expect(tick1.json().appliedPerturbations, "已到期的扰动不该再算作「仍在起作用」").toEqual([]);
  });

  // ══ ③ #151 回归 —— 施加扰动不许清空在途延迟队列 ════════════════════════════════
  // （`sim-perturbation.test.ts` 断言② 已咬 `/act` 那条路；这里咬**前端真走的那条路**，
  //   两条路各有各的门 —— 修好的东西必须两处都不许退化。）
  it("③（#151）前端走的 /perturbations 路同样不清空 pending：tick → 施加 → tick，在途贡献如期到达", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedWorld(t, { delayTicks: 1 }); // 与生产种子 demo_line_util_to_base_load 同形
    const sid = await newSession(t);

    const tick1 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(downstream(tick1.json().state), "delayTicks=1 ⇒ 本格还没到").toBe(0);
    const st1 = await t.repos.sim.getTickState(TENANT, sid, 1);
    expect(st1?.pending, "前置事实：pending 真的非空，否则本断言测了个寂寞").toHaveLength(1);

    await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: {
        kind: "supply_disruption", targetObjectId: "o_up", targetStateVar: "load",
        magnitude: 0, mode: "set", durationTicks: null, label: "SEAM · 掐掉来料",
      },
    });
    const st1After = await t.repos.sim.getTickState(TENANT, sid, 1);
    expect(st1After?.pending, "🔴 #151：施加扰动把在途队列抹了 ⇒ 已发出的量凭空蒸发").toHaveLength(1);

    // 在途那份如期到达（20），而被掐掉的来料不再产生新贡献。
    const tick2 = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(downstream(tick2.json().state), "在途贡献没到 ⇒ pending 在施加时被吞了").toBe(20);
  });

  // ══ ④ #152 —— Trial Tick 必须真的跑传导 ═════════════════════════════════════════
  it("④（#152）就绪认证的 Trial Tick 真跑传导相：驱动得动的世界 fired>0，且 rulesFired = 两相之和", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedWorld(t);
    const sid = await newSession(t);

    const cert = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification`, headers: ADMIN });
    expect(cert.statusCode).toBe(200);
    const trial = cert.json().trialTick as {
      passed: boolean; rulesFired: number;
      derivationRulesFired?: number; propagationRulesFired?: number; propagationRulesDeclared?: number;
    };
    expect(trial.passed).toBe(true);
    // 修前：这三个字段根本不存在，`rulesFired` 恒 = 派生 topo 长度，传导一条都没跑过。
    expect(trial.propagationRulesDeclared, "本租户已发布 1 条传导规则").toBe(1);
    expect(
      trial.propagationRulesFired,
      "🔴 #152：Trial Tick 只跑了 recompute（派生），传导相恒记 0 —— 认证在拿派生的成绩单冒充推演的",
    ).toBe(1);
    expect(trial.rulesFired, "rulesFired 必须是两相之和（拆账字段与总数对得上）")
      .toBe((trial.derivationRulesFired ?? 0) + (trial.propagationRulesFired ?? 0));
  });

  it("④补（诚实位）：世界态驱动不动传导时 declared>0 而 fired===0 —— 不许拿「声明了几条」冒充「跑通了几条」", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedWorld(t);
    // 上游态为 0 ⇒ 无源即无贡献 ⇒ 规则一条都不 fire（引擎 `sourceVal === 0` 直接 continue）。
    const sid = await newSession(t, { o_up: { load: 0 }, o_down: { load: 0 } });

    const trial = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification`, headers: ADMIN }))
      .json().trialTick as { propagationRulesFired?: number; propagationRulesDeclared?: number };
    expect(trial.propagationRulesDeclared, "规则确实声明了").toBe(1);
    expect(trial.propagationRulesFired, "空世界里传导跑不动，认证必须照实说 0").toBe(0);
  });

  // ══ ⑤ 反证：拿掉前端那次调用，本门必须红（证明它咬的是链路不是自己）═══════════════
  // 变异反证只能靠"改源码再跑"来做，这里退而求其次：断言抽取器**确实依赖前端源码**
  // —— 喂一段不含该调用的假源码，抽取结果必须为空（而不是靠某个恒真的兜底混过去）。
  it("⑤ 反证：抽取器喂假源码 → 抽不到任何字段（证明①的绿来自前端真源码，不是恒真兜底）", () => {
    expect(frontendPerturbationBodyKeys("export default function X(){ return null }")).toEqual([]);
    // 而喂真源码时必须抽得到（同一函数，两个方向都验过才叫工具是对的）。
    expect(frontendPerturbationBodyKeys(readRepoFile(SANDBOX_VIEW)).length).toBeGreaterThan(0);
  });
});
