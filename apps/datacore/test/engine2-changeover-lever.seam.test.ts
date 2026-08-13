import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";
import { CAPACITY_FACTOR_BINDINGS } from "@platform/contracts";
import { computeByProcessModel, patchCapacityContext } from "../src/solvers/capacity.js";
import type { SolverContext } from "../src/solvers/types.js";

/**
 * WO-ENGINE-2 件一 · 因子⑤「换型损失」为何拨不出来 —— 逐重死的**实测**记账（不是读代码下的结论）。
 *
 * 派单人给的账是「三处键名写错 + `patchCapacityContext` 不认 ChangeoverMatrix」两重死，修完即活。
 * 本文件的四条断言是**亲手跑出来的反例**：改名与 patch 白名单都是真错、也都已修，但 ⑤ **仍然拨不出来**，
 * 因为还有第三重——`capacity.ts` 的 p50 公式**根本不含换型项**，故 ∂Σp50/∂minutes 恒 0，
 * 候选会在 `discoverCapacityLevers` 的「无下游影响 → 非有效杠杆」处被丢弃。
 *
 * 每条断言都能单独变异反证（见各条注释里的「改坏它会红」）。
 */

const MODEL = "2170-NCM";
const PROD_ARGS = { grain: "process-model", targetType: "Base", targetProp: "weeklyCap", modelId: MODEL } as const;

interface Lever { objectType: string; prop: string; sensitivity: number; mark?: string }

async function levers(t: TestApp, args: Record<string, unknown>): Promise<{ levers: Lever[]; count: number }> {
  const res = await invokeSolver(t, "generic_inference", { mode: "levers", ...args });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: { levers: Lever[]; count: number } }).data;
}

const sumP50 = (ctx: SolverContext): number =>
  computeByProcessModel(ctx, MODEL).reduce((a, r) => a + r.p50, 0);

describe("WO-ENGINE-2 件一 · 换型损失⑤ 的三重死（逐重实测）", () => {
  it("第一重（已修）· 数据半：ChangeoverMatrix 的真属性是 minutes，changeoverMin 在对象上恒不存在", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rows = await t.repos.objects.listByType("demo", "ChangeoverMatrix");

    expect(rows.length, "ChangeoverMatrix 一条都没种 → 后面三条无从谈起").toBeGreaterThan(0);
    // 真名 minutes 且是 number —— 这正是 `discoverCapacityLevers` 的 `typeof o.props[b.prop] === "number"` 要的形状。
    expect(rows.every((r) => typeof r.props.minutes === "number")).toBe(true);
    // 旧键名在对象上一条都没有 ⇒ 旧绑定下候选集恒空（失效机制是**过滤剔除**，不是 `?? 0` 兜底算 0）。
    expect(rows.filter((r) => r.props.changeoverMin !== undefined).length).toBe(0);

    // 绑定表已改名到真属性（改坏它：把 prop 改回 "changeoverMin" ⇒ 本条红）。
    const f5 = CAPACITY_FACTOR_BINDINGS.find((b) => b.mark === "⑤");
    expect(f5?.objectType).toBe("ChangeoverMatrix");
    expect(f5?.prop, "因子⑤ 的落点属性必须是对象上真实存在的名字").toBe("minutes");
  });

  it("第二重（已修）· patchCapacityContext 现在真的 patch 得动 ChangeoverMatrix（修前落 default ⇒ 克隆世界逐字节相同）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const c = (await t.services.solvers.loadContext("demo", undefined, { withExtended: true })) as SolverContext;

    const cm = (c.changeoverMatrix ?? [])[0];
    expect(cm, "ctx 里没有 changeoverMatrix → withExtended 没生效").toBeTruthy();
    const before = Number(cm!.props.minutes);

    const patched = patchCapacityContext(c, "ChangeoverMatrix", cm!.id, "minutes", before + 999);
    const after = Number((patched.changeoverMatrix ?? []).find((o) => o.id === cm!.id)?.props.minutes);

    // 改坏它：摘掉 capacity.ts 里新增的 `case "ChangeoverMatrix"` ⇒ 落回 default ⇒ after === before ⇒ 本条红。
    expect(after, "override 未落进克隆 ctx ⇒ patchCapacityContext 的 switch 又把它丢了").toBe(before + 999);
    expect(Number(cm!.props.minutes), "patch 不得 mutate 原 ctx（R6 纯函数）").toBe(before);
  });

  it("第三重（未修·本单顶回来的那条）· 产能链不消费换型 ⇒ ∂Σp50/∂minutes 恒 0", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const c = (await t.services.solvers.loadContext("demo", undefined, { withExtended: true })) as SolverContext;

    const baseline = sumP50(c);
    expect(baseline, "Σp50 基线为 0 → 型号/认证没种起来，本条无意义").toBeGreaterThan(0);

    // 把**每一条** ChangeoverMatrix 的 minutes 都放大 100 倍（换型损失暴增 100×）。
    let mutated = c;
    for (const o of c.changeoverMatrix ?? []) {
      mutated = patchCapacityContext(mutated, "ChangeoverMatrix", o.id, "minutes", Number(o.props.minutes) * 100);
    }
    // 前一条已证 override 真落进了 ctx；所以这里若 Σp50 不动，只能是**公式不含换型项**。
    expect(sumP50(mutated), "换型放大 100× 后 Σp50 竟然变了 —— 若真变了说明产能链已消费换型，本条记账该改").toBe(baseline);
  });

  it("端到端后果 · 因子⑤ 在生产实参下仍拨不出杠杆（改名+patch 都修完也一样）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = await levers(t, { ...PROD_ARGS, factors: ["换型损失"], topK: 8 });

    // 这是**当前真相**，不是期望值：候选已能进循环（第一重修好），override 已能落地（第二重修好），
    // 但 sensitivity 恒 0 ⇒ `if (!best || best.sensitivity === 0) continue` ⇒ 仍返回空。
    // 哪天有人让产能链真消费了换型，本条会红 —— 那正是要的：逼人回来把记账改成「已复活」。
    expect(out.count, "⑤ 竟然拨出杠杆了 → 第三重死已被修好，请更新本文件与 lever-binding-drift 的具名记账").toBe(0);
  });
});
