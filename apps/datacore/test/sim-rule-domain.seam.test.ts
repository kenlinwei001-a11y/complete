import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { demoPropagationRulesWithDomain, resolveRuleDomain, seedDemoProcessLayer, seedDemoPropagationRules } from "../src/seed.js";

/**
 * ══ WO-DISRUPTION-CARDS · 传导边的**业务域归属**接缝门 ══════════════════════════════
 *
 * 屏上要把 35 条扰动因素切成按域分片的卡片。分组依据必须**从数据现算**，
 * 不许任何一侧手抄一份「哪条规则属于哪个域」的映射表 —— 本体 §8 `G-GATE-ROSTER-HANDCOPIED`：
 * 手抄名单里没有的对象**永远绿、永远漏**（新增一条规则忘了加进映射表，它就从分类里消失，
 * 而没有任何东西会报错）。
 *
 * ── 本门咬的是**接缝**，不是函数 ────────────────────────────────────────────────
 * 判据全部落在 `GET /a/v1/sim/propagation-rules` 的**真响应**上（种子 → 仓储 → 路由 → JSON），
 * 而**期望值取自另一条独立路径**：`GET /a/v1/process-definitions` 的真响应
 * （流程登记册 `domainKey` + `carrierTypeKey`，经 `processDomains`/`processDefinitions` 两个仓储）。
 * 两条路径在代码上只共用 `seed.ts` 里的那两个常量数组，中间的推导、存储、序列化各走各的 ——
 * 所以"两边对上了"不是同一份代码自证，而是真的对上了账。
 *
 * ⛔ 本文件**一个域 key、一个条数都不写死**。写死了就是把手抄名单从前端搬进测试：
 *    下次加规则时，写死的数字要么当场变红逼人改数（假红），要么根本不覆盖新规则（假绿）。
 */

const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

type SeededRule = {
  key: string;
  targetTypeKey: string;
  domainKey: string | null;
  domainName: string | null;
};

/** 起一套「本体 + 流程层 + 传导规则」都播好的 app（三者缺一，下面的对账就没有两条独立路径）。 */
async function bootstrap() {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoProcessLayer(t.repos);
  await seedDemoPropagationRules(t.repos);
  await enableSim(t);

  const rules = (
    await (await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN })).json()
  ).items as SeededRule[];

  const procs = (await (await t.app.inject({ method: "GET", url: "/a/v1/process-definitions", headers: ADMIN })).json()) as {
    domains: { key: string; name: string }[];
    definitions: { key: string; domainKey: string; carrierTypeKey: string }[];
  };
  return { t, rules, procs };
}

/**
 * 独立口径的 `承载物类型 → 域`：只用 `/a/v1/process-definitions` 的响应现算，
 * **不 import `seed.ts` 的 `resolveRuleDomain`** —— import 了就变成同一支实现自证，对账即失效。
 * 同一承载物挂多条流程时取域 key 字典序最小（与被测那侧同一条 R6 消歧规则）。
 */
function carrierDomainOracle(procs: { domains: { key: string; name: string }[]; definitions: { domainKey: string; carrierTypeKey: string }[] }) {
  const nameOf = new Map(procs.domains.map((d) => [d.key, d.name] as const));
  const m = new Map<string, { key: string; name: string }>();
  for (const p of procs.definitions) {
    const name = nameOf.get(p.domainKey);
    if (name === undefined) continue;
    const cur = m.get(p.carrierTypeKey);
    if (cur === undefined || p.domainKey < cur.key) m.set(p.carrierTypeKey, { key: p.domainKey, name });
  }
  return m;
}

describe("WO-DISRUPTION-CARDS · 传导边的业务域归属（分片卡片的唯一分组依据）", () => {
  // ── 金丝雀：先自证工具没瞎 ────────────────────────────────────────────────────
  // 下面几条要报「某某为 0 / 某某全部对上」这类结论；报之前必须证明抽取路径本身是通的，
  // 否则「全对上」可能只是**两边都空**（铁律 0.6：金丝雀不中 ⇒ 报工具坏了，不许报代码干净）。
  it("金丝雀：两条独立路径都真的出东西（规则非空 · 流程登记册非空 · 已知必中样例命中）", async () => {
    const { rules, procs } = await bootstrap();
    expect(rules.length).toBeGreaterThan(0);
    expect(procs.definitions.length).toBeGreaterThan(0);
    expect(procs.domains.length).toBeGreaterThan(0);

    // 已知必中：种子注释逐字写着「承载物 MaintPlan 即 P50」——
    // 这个样例的形状取自**生产实物**（真跑出来的响应），不是手写的单行样例。
    const oracle = carrierDomainOracle(procs);
    expect(oracle.get("MaintPlan")).toBeDefined();
    // 反面样例：`Equipment` 种子注释自己写着「不是任何流程的承载物」⇒ oracle 必须查不到它。
    // 一正一反都对，才说明这个 oracle 在区分，而不是恒真/恒假。
    expect(oracle.get("Equipment")).toBeUndefined();
  });

  // ── ① 主判据：屏上每条边的域 == 独立口径现算的域（逐条，零写死）──────────────────
  it("🔴 接缝：每条传导边下发的 domainKey/domainName 与流程登记册现算的完全一致（逐条对账·两边都不写死）", async () => {
    const { rules, procs } = await bootstrap();
    const oracle = carrierDomainOracle(procs);

    // 逐条比对成两个可读数组再整体断言 ⇒ 失败时一眼看得出是哪条边错、错成什么，
    // 不是只报一句 "expected false to be true"。
    const actual = rules.map((r) => `${r.key} → ${r.domainKey ?? "null"}/${r.domainName ?? "null"}`).sort();
    const expected = rules
      .map((r) => {
        const hit = oracle.get(r.targetTypeKey);
        return `${r.key} → ${hit?.key ?? "null"}/${hit?.name ?? "null"}`;
      })
      .sort();
    expect(actual).toEqual(expected);
  });

  // ── ② 「未归域」必须是**数据的实情**，不是漏填 ────────────────────────────────
  it("🔴 诚实缺席：domainKey 为 null 的边，恰好是那些 target 不被任何流程承载的边（集合相等，不是数量相等）", async () => {
    const { rules, procs } = await bootstrap();
    const oracle = carrierDomainOracle(procs);

    const nullByResponse = rules.filter((r) => r.domainKey === null).map((r) => r.key).sort();
    const nullByOracle = rules.filter((r) => !oracle.has(r.targetTypeKey)).map((r) => r.key).sort();
    // 用**集合相等**而不是**数量相等**：数量相等能被"一条错标 + 另一条漏标"互相抵消掉。
    expect(nullByResponse).toEqual(nullByOracle);

    // domainKey 与 domainName 必须同生同死 —— 一个有一个没有 = 屏上会出现"有域但没名字"的空 chip。
    expect(rules.filter((r) => (r.domainKey === null) !== (r.domainName === null)).map((r) => r.key)).toEqual([]);

    // 未归域的每一条，其 target 类型确实一个承载流程都没有（把上面那句集合相等再落到"为什么"上）。
    for (const r of rules.filter((x) => x.domainKey === null)) {
      expect(`${r.key}:${procs.definitions.filter((p) => p.carrierTypeKey === r.targetTypeKey).length}`).toBe(`${r.key}:0`);
    }
  });

  // ── ③ 分片可用性：分组结果得真能当卡片用（否则"分了组"只是纸面成立）──────────────
  it("🔴 分片可用：分出的组数 ≥3、最大一组不超过总数一半（35 条一次全倒 → 可浏览的几片）", async () => {
    const { rules } = await bootstrap();
    const sizes = new Map<string, number>();
    for (const r of rules) sizes.set(r.domainKey ?? "(未归域)", (sizes.get(r.domainKey ?? "(未归域)") ?? 0) + 1);

    // 判据是**相对**总数的，不是写死的绝对数：换租户/加规则都不会把这条门变成假红。
    expect(sizes.size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...sizes.values())).toBeLessThanOrEqual(Math.ceil(rules.length / 2));
    // 每一片的条数加起来必须等于总数 —— 少了就是有边**从分类里消失了**（本单最怕的那个形态）。
    expect([...sizes.values()].reduce((a, b) => a + b, 0)).toBe(rules.length);
  });

  // ── ④ 变异反证：把域字段拆掉，上面那些门必须红在「对不上」而不是「组件不见了」──────
  it("变异反证：抹掉 domainKey 后，对账当场不成立（证明 ① 咬的是归属本身，不是「字段存在」）", async () => {
    const { rules, procs } = await bootstrap();
    const oracle = carrierDomainOracle(procs);

    // 变异：模拟"新增/改了规则但没归域"——把所有 domainKey 抹成 null。
    const mutated = rules.map((r) => ({ ...r, domainKey: null, domainName: null }));
    const actual = mutated.map((r) => `${r.key} → ${r.domainKey ?? "null"}`).sort();
    const expected = mutated.map((r) => `${r.key} → ${oracle.get(r.targetTypeKey)?.key ?? "null"}`).sort();
    expect(actual).not.toEqual(expected); // 必须对不上 —— 对得上就说明 ① 是个恒真断言

    // 反向变异：只改**一条**边的域（最小变异）。整表比对照样要红，
    // 证明 ① 不是"大面积错才看得见"的粗判据。
    const one = rules.map((r, i) => (i === 0 ? { ...r, domainKey: `${r.domainKey ?? "X"}_WRONG` } : r));
    const oneActual = one.map((r) => `${r.key} → ${r.domainKey ?? "null"}`).sort();
    const oneExpected = one.map((r) => `${r.key} → ${oracle.get(r.targetTypeKey)?.key ?? "null"}`).sort();
    expect(oneActual).not.toEqual(oneExpected);
  });

  // ── ⑤ 纯函数层：`resolveRuleDomain` 不许给查不到的类型编一个域出来 ─────────────────
  it("resolveRuleDomain：查不到的 target 类型返回 {null,null}，不回落到「最近的那个域」", async () => {
    // 先跑一次种子路径，确保惰性索引已建（也顺带证明这个函数在生产路径上真被调用过）。
    const seeded = demoPropagationRulesWithDomain();
    expect(seeded.length).toBeGreaterThan(0);

    expect(resolveRuleDomain("__no_such_carrier_type__")).toEqual({ domainKey: null, domainName: null });
    // 金丝雀：同一个函数对一个已知承载物必须给得出域 —— 否则上面那个 null 只是"函数恒返 null"。
    const known = resolveRuleDomain("MaintPlan");
    expect(known.domainKey).not.toBeNull();
    expect(known.domainName).not.toBeNull();

    // `demoPropagationRulesWithDomain` 与 `resolveRuleDomain` 必须是同一支（不许各算一遍）。
    for (const r of seeded) expect(r.domainKey).toBe(resolveRuleDomain(r.targetTypeKey).domainKey);
  });
});
