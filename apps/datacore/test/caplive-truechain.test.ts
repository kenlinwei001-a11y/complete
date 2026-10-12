import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";

// WO-CAPLIVE-TRUECHAIN · SEAM-GATE（数据+引擎接缝·治 G-CAPACITY-YIELD-DERIVATION 前端半）：
// 产能活台拨杆（前端 DynamicLeverPanel grain='process-model' → generic_inference{grain,apply}）走**真产能链**
// （capacity_forecast.byProcessModel Σp50·克隆 ctx 扰动重算），拖低 Process.yield_baseline → 产能真降（capGain≠0·LIVE），
// 不再是 ontology-core recompute 空壳。头号判据：路由半（grain 分支）× 数据半（byProcessModel 逐工序×型号真派生）
// 闭合于代码链（派生图半仍缺·但已不阻塞前端活台）。
//   ① 真链活：grain + apply → deltas 非空 + 某格 before≠after + capGain≠0（<0·拖低良率产能真降）+ dataMode:LIVE。
//   ② 对照·无 grain 仍诚实空：同 apply 去 grain → dataMode:EMPTY（yield_baseline 死叶·hollow 诚实化不回归·非路由半）。
//   ③ 非重言：override 设回当前真值 → deltas 空·EMPTY（改真才变·不臆造·非恒 LIVE）。
//   ④ 落点真判别：改一个不在产能链的属性 → EMPTY（证 apply 落点真判别·capacityInferenceApply 不恒 LIVE）。

interface InferOut {
  deltas: { objId: string; type: string; prop: string; before: number; after: number }[];
  rows: { objectId: string; type: string; prop: string; before: number; after: number }[];
  affectedObjects: number;
  count: number;
  rootTypes: string[];
  dataMode?: string;
  capGain?: number;
  baselineTotal?: number;
  appliedTotal?: number;
  note?: string;
}

async function infer(t: TestApp, args: Record<string, unknown>): Promise<InferOut> {
  const res = await invokeSolver(t, "generic_inference", args);
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: InferOut }).data;
}

/** 取一个真在产能链里的常州化成工序 objectId（obj_process_LINE-WS-changzhou-*-formation）+ 当前良率基线。 */
async function changzhouFormation(t: TestApp): Promise<{ pid: string; oldYb: number }> {
  const procs = await t.repos.objects.listByType("demo", "Process");
  const proc = procs.find((p) => String(p.props.baseId) === "changzhou" && String(p.props.kind) === "formation");
  expect(proc, "seed 应有 changzhou 化成工序").toBeTruthy();
  return { pid: proc!.id, oldYb: Number(proc!.props.yield_baseline) };
}

describe("WO-CAPLIVE-TRUECHAIN · 产能活台拨杆走真产能链（generic_inference grain+apply → byProcessModel·SEAM）", () => {
  it("① 真链活：grain='process-model' + 拖低 Process.yield_baseline → byProcessModel 真降（deltas 非空·capGain<0·dataMode LIVE）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { pid, oldYb } = await changzhouFormation(t);
    expect(Number.isFinite(oldYb), "changzhou 化成 yield_baseline 应已物化为真值").toBe(true);
    expect(oldYb, "拖到 0.80 须是'拖低'（当前基线 > 0.80）").toBeGreaterThan(0.8);

    const out = await infer(t, {
      grain: "process-model",
      apply: [{ objectType: "Process", objectId: pid, prop: "yield_baseline", value: 0.8 }],
    });
    // 真链活：非空 deltas + LIVE
    expect(out.dataMode).toBe("LIVE");
    expect(out.deltas.length).toBeGreaterThan(0);
    // 某格 before≠after（真派生·非静默 0）
    expect(out.deltas.some((d) => d.before !== d.after)).toBe(true);
    // 拖低良率 → 产能真降（capGain 非重言 0·且为负）
    expect(out.capGain).not.toBe(0);
    expect(out.capGain!).toBeLessThan(0);
    expect(out.appliedTotal!).toBeLessThan(out.baselineTotal!);
    // delta 形状 = 前端 DynamicLeverPanel 现有渲染读的键（rows/objectId/type/prop/before/after）
    expect(out.rows.length).toBe(out.deltas.length);
    expect(out.affectedObjects).toBe(out.deltas.length);
    expect(out.deltas[0]!.type).toBe("ProcessModel");
    expect(out.deltas[0]!.prop).toBe("cellsPerDayP50");
    expect(out.rootTypes).toContain("Process");
    // 该常州工序在多型号聚合（4680-NCM/4680-LFP/方形-NCM 认证于常州·无 modelId→全型号）→ 受影响格皆在常州基地
    expect(out.deltas.every((d) => d.objId.startsWith("changzhou|"))).toBe(true);
  });

  it("② 对照·无 grain 仍诚实空：同 apply 去掉 grain → dataMode:EMPTY（yield_baseline 死叶·hollow 诚实化不回归·非路由半）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { pid } = await changzhouFormation(t);
    const out = await infer(t, {
      apply: [{ objectType: "Process", objectId: pid, prop: "yield_baseline", value: 0.8 }],
    });
    expect(out.dataMode).toBe("EMPTY");
    expect(out.deltas.length).toBe(0);
    expect(String(out.note)).toContain("无下游派生边");
  });

  it("③ 非重言：override 设回当前真值 → deltas 空·dataMode:EMPTY（改真才变·不臆造）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { pid, oldYb } = await changzhouFormation(t);
    const out = await infer(t, {
      grain: "process-model",
      apply: [{ objectType: "Process", objectId: pid, prop: "yield_baseline", value: oldYb }],
    });
    expect(out.dataMode).toBe("EMPTY");
    expect(out.deltas.length).toBe(0);
    expect(out.capGain).toBe(0);
  });

  it("④ 落点真判别：改一个不在产能链的属性 → dataMode:EMPTY（证 apply 落点真判别·非恒 LIVE·KILL-MOCK-RED）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { pid } = await changzhouFormation(t);
    const out = await infer(t, {
      grain: "process-model",
      apply: [{ objectType: "Process", objectId: pid, prop: "__not_a_capacity_prop", value: 0.5 }],
    });
    expect(out.dataMode).toBe("EMPTY");
    expect(out.deltas.length).toBe(0);
  });

  it("R6 确定性：真链同输入两跑字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { pid } = await changzhouFormation(t);
    const apply = [{ objectType: "Process", objectId: pid, prop: "yield_baseline", value: 0.8 }];
    const a = await infer(t, { grain: "process-model", apply });
    const b = await infer(t, { grain: "process-model", apply });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
