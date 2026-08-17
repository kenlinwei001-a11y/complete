import { describe, expect, it } from "vitest";
import type { OntologyInvariantReport } from "@platform/contracts";
import { ADMIN, makeApp, type TestApp } from "./helpers.js";
import {
  ONTOLOGY_INVARIANT_ENFORCEMENT_MODE,
  assertFactsResolvable,
  assertOntologyInvariantsAllowPublish,
  decideOntologyInvariantEnforcement,
  evaluateOntologyInvariants,
  listOntologyInvariantKeys,
} from "../src/ontology/invariants.js";
import { parseExpression } from "../src/ruledsl.js";

/**
 * WO-ONTOLOGY-EDGE-TRICLASS · **本体第三类边（不变式守卫）的接缝门 —— 引擎侧**
 *
 * 前端那半（`apps/frontend-shell/test/ontology-invariants.seam.test.tsx`）证的是
 * 「改容差 ⇒ 屏上那一格的字真的变」；本文件证的是**它算得对**：
 *   ① 实测量取自**真种子本体**，且与另一条独立端点的读数对得上（不是自说自话）；
 *   ② 把容差挪到实测值以下 ⇒ 该守卫由成立翻成不成立，且违反者是真实存在的那几条边；
 *   ③ 「读不回来一律不许冒充通过」这条反 fail-open 守卫本身被直接咬住；
 *   ④ 阻断开关**两个取值都测** —— 只测生产那个值，就掉进本仓记过的
 *      「生产实参与测试实参交集为空」；只测另一个值，则生产走的那支从没人验过。
 */

const J = <T>(r: { json: () => unknown }) => r.json() as T;

async function invariantsOf(t: TestApp): Promise<OntologyInvariantReport> {
  const r = await t.app.inject({ method: "GET", url: "/a/v1/ontology/invariants", headers: ADMIN });
  expect(r.statusCode, `体检口返回 ${r.statusCode}：${r.body}`).toBe(200);
  return J<OntologyInvariantReport>(r);
}

async function evaluateWith(t: TestApp, overrides: Record<string, { tolerance?: number; enabled?: boolean }>) {
  const r = await t.app.inject({
    method: "POST",
    url: "/a/v1/ontology/invariants/evaluate",
    headers: ADMIN,
    payload: { overrides },
  });
  expect(r.statusCode, `试算口返回 ${r.statusCode}：${r.body}`).toBe(200);
  return J<OntologyInvariantReport>(r);
}

const item = (rep: OntologyInvariantReport, key: string) => {
  const it = rep.items.find((i) => i.key === key);
  expect(it, `目录里没有守卫 ${key}`).toBeDefined();
  return it!;
};

const COEF = "causal_coefficient_within_ceiling";

describe("① 实测量来自真种子本体，且与独立端点的读数对得上", () => {
  it("传导系数最大值 == 真传导规则表里算出来的最大值（跨端点交叉验证，非自洽）", async () => {
    const t = await makeApp();

    // 独立口径：另一条端点把真规则表逐条下发，本测试自己算最大值。
    // 若两边不等，说明体检读的不是同一份本体 —— 这正是"绿测试≠能用"最常断的那个接缝。
    const rulesRes = await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN });
    const rules = J<{ items: { key: string; coefficient: number; delayTicks: number }[] }>(rulesRes).items;
    expect(rules.length, "种子本体里一条因果边都没有 ⇒ 后面的比较全是空胜").toBeGreaterThan(10);
    const trueMax = Math.max(...rules.map((r) => Math.abs(r.coefficient)));

    const rep = await invariantsOf(t);
    expect(item(rep, COEF).measure.value).toBe(trueMax);
    expect(item(rep, "causal_delay_within_ceiling").measure.value).toBe(Math.max(...rules.map((r) => r.delayTicks)));
  });

  it("守卫清单非空，且每条都真求了值（没有一条挂着「读不出来」）", async () => {
    const t = await makeApp();
    const rep = await invariantsOf(t);
    expect(rep.items.map((i) => i.key).sort()).toEqual([...listOntologyInvariantKeys()].sort());
    // error 非空 = 那条守卫这次根本没算成 —— 一条都不许有，否则屏上是一片"读不出来"
    expect(rep.items.filter((i) => i.error !== null).map((i) => `${i.key}:${i.error}`)).toEqual([]);
    expect(rep.passed + rep.violated + rep.skipped).toBe(rep.items.length);
  });

  it("守卫条件是**业务话**，且由表达式渲染而来（屏上不出现机器表达式）", async () => {
    const t = await makeApp();
    const rep = await invariantsOf(t);
    const g = item(rep, COEF);
    // 渲染出来的那句话里必须同时含实测量与容差的业务话标签 —— 这就是"不会各说各话"的判据
    expect(g.guardText).toContain(g.measure.label);
    expect(g.guardText).toContain(g.tolerance.label);
    // 机器表达式的残迹一个都不许漏到下发文本里
    expect(g.guardText).not.toContain("params.");
    expect(g.guardText).not.toContain("OntologyGraph");
  });
});

describe("② 接缝：把容差挪到实测值以下 ⇒ 该守卫由成立翻成不成立", () => {
  it("系数上限从目录原值降到实测值之下 ⇒ holds 翻转 + 翻转清单点名 + 违反者是真边", async () => {
    const t = await makeApp();
    const before = await invariantsOf(t);
    const measured = item(before, COEF).measure.value;
    expect(item(before, COEF).holds, `前提：目录原值下这条本应成立（实测 ${measured}）`).toBe(true);

    // 把线挪到实测值之下（用真实测值算，不写死数字 —— 种子一改这条测试自己跟着走）
    const tighter = measured - 0.05;
    const after = await evaluateWith(t, { [COEF]: { tolerance: tighter } });
    const g = item(after, COEF);

    expect(g.holds, "容差压到实测值以下之后，这条必须变成不成立").toBe(false);
    expect(g.holdsAtDefault, "目录原值下它仍是成立的 —— 翻转确实由本次试算造成").toBe(true);
    expect(after.flippedToViolate).toContain(COEF);
    expect(g.overridden).toBe(true);
    expect(g.tolerance.value).toBe(tighter);
    expect(g.tolerance.defaultValue).toBe(item(before, COEF).tolerance.defaultValue);

    // 实测量**不因改容差而变**（变的是线，不是事实）
    expect(g.measure.value).toBe(measured);

    // 违反者必须是真实存在的因果边，且它的系数确实越线
    expect(g.participants.length).toBeGreaterThan(0);
    const rulesRes = await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN });
    const rules = J<{ items: { key: string; coefficient: number }[] }>(rulesRes).items;
    for (const p of g.participants) {
      const real = rules.find((r) => r.key === p.key);
      expect(real, `点名了一条本体里不存在的边 ${p.key}`).toBeDefined();
      expect(Math.abs(real!.coefficient)).toBeGreaterThan(tighter);
    }
  });

  it("试算**不落库**：改完容差再读只读体检口，仍是目录原值那一版", async () => {
    const t = await makeApp();
    const measured = item(await invariantsOf(t), COEF).measure.value;
    const after = await evaluateWith(t, { [COEF]: { tolerance: measured - 0.05 } });
    expect(item(after, COEF).holds).toBe(false);

    const reread = await invariantsOf(t);
    expect(item(reread, COEF).holds, "试算污染了只读体检口 ⇒ 推演开关被做成了治理动作").toBe(true);
    expect(item(reread, COEF).overridden).toBe(false);
  });

  it("停用一条 ⇒ 退出成立/不成立计数，但实测量照算（停用不让问题消失）", async () => {
    const t = await makeApp();
    const base = await invariantsOf(t);
    const off = await evaluateWith(t, { [COEF]: { enabled: false } });
    const g = item(off, COEF);

    expect(g.enabled).toBe(false);
    expect(off.skipped).toBe(base.skipped + 1);
    expect(g.measure.value, "停用后实测量必须照旧算出来").toBe(item(base, COEF).measure.value);
    // 停用的那条不许被算进"通过" —— 那等于用停用买绿
    expect(off.passed).toBe(base.passed - 1);
  });

  it("同一份本体连算两次，结果逐字节一致（R6 确定性）", async () => {
    const t = await makeApp();
    expect(JSON.stringify(await invariantsOf(t))).toBe(JSON.stringify(await invariantsOf(t)));
  });
});

describe("③ 反 fail-open：读不回来不许冒充通过", () => {
  it("表达式引用的量取不到数 ⇒ 抛错（而不是静悄悄判成「没违反」）", () => {
    const ast = parseExpression("OntologyGraph.maxAbsCoefficient > params.x");
    // 正例：解析得到数 ⇒ 不抛
    expect(() => assertFactsResolvable(ast, { OntologyGraph: { maxAbsCoefficient: 0.9 } })).not.toThrow();
    // 反例：字段缺失 / 类型不对 —— 这正是 `ruledsl.compare` 会返回 false 的那两种输入
    expect(() => assertFactsResolvable(ast, { OntologyGraph: {} })).toThrow(/取不到数值/);
    expect(() => assertFactsResolvable(ast, { OntologyGraph: { maxAbsCoefficient: "0.9" } })).toThrow(/取不到数值/);
  });

  it("守卫算不出来时 holds 一律按 false 下发（纯函数直咬）", () => {
    // 传一个空图谱：所有量都算得出（0），故这里正面验的是"空图也能算"，
    // 不是"空图报错"——把两者混为一谈会让空租户的屏上一片红。
    const rep = evaluateOntologyInvariants({ objectTypes: [], structuralEdges: [], causalEdges: [] });
    expect(rep.items.every((i) => i.error === null)).toBe(true);
    expect(rep.violated, "空本体不该违反任何一条守卫").toBe(0);
  });
});

describe("④ 阻断开关：两个取值都测（只测一个必留暗坑）", () => {
  const violatedItems = [
    { key: "a", enabled: true, holds: false },
    { key: "b", enabled: true, holds: true },
    { key: "c", enabled: false, holds: false },
  ] as unknown as Parameters<typeof decideOntologyInvariantEnforcement>[0];

  it("生产实参就是「只标注」—— 这条是金丝雀：产品裁决落地改常量时它会红，逼人同步文档", () => {
    expect(ONTOLOGY_INVARIANT_ENFORCEMENT_MODE).toBe("ANNOTATE_ONLY");
  });

  it("只标注：blocking=false，但「真要拦会拦下哪几条」照样算出来", () => {
    const d = decideOntologyInvariantEnforcement(violatedItems);
    expect(d.mode).toBe("ANNOTATE_ONLY");
    expect(d.blocking).toBe(false);
    expect(d.wouldBlock).toEqual(["a"]); // 停用的 c 不算 —— 停用是"不体检"，不是"不通过"
  });

  it("改成拦住发布：blocking=true，且发布闸真的拦得住", () => {
    const d = decideOntologyInvariantEnforcement(violatedItems, "BLOCK_PUBLISH");
    expect(d.blocking).toBe(true);
    const report = { items: [], passed: 0, violated: 1, skipped: 0, flippedToViolate: [], flippedToHold: [], enforcement: d } as unknown as OntologyInvariantReport;
    expect(() => assertOntologyInvariantsAllowPublish(report)).toThrow(/暂不能提交发布/);
  });

  it("同一道闸在「只标注」下必须放行（生产今天走的就是这一支）", () => {
    const d = decideOntologyInvariantEnforcement(violatedItems);
    const report = { items: [], passed: 0, violated: 1, skipped: 0, flippedToViolate: [], flippedToHold: [], enforcement: d } as unknown as OntologyInvariantReport;
    expect(() => assertOntologyInvariantsAllowPublish(report)).not.toThrow();
  });

  it("端到端：本体里确有不成立的守卫时，发起发布会签仍然 201（今天一条都不拦）", async () => {
    const t = await makeApp();
    const rep = await invariantsOf(t);
    expect(rep.enforcement.mode).toBe("ANNOTATE_ONLY");
    expect(rep.enforcement.blocking).toBe(false);

    const r = await t.app.inject({ method: "POST", url: "/a/v1/ontology/publish-requests", headers: ADMIN, payload: {} });
    expect(r.statusCode, `发布会签被拦了（${r.body}）—— 与「今天只标注」的承诺不符`).toBe(201);
  });
});
