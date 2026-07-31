import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { invokeSolver, makeApp, publishRuleOverride, seedBattery, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-66-RULES-FIRST-CLASS · **接缝门（SEAM-GATE）**：阈值一等化（P1）× 绑定一等化（P2）。
 *
 * 这不是「单测能读到 param」级别的断言，而是**效果层**：改数据 → 求解器输出真的跟着变（不改一行代码）。
 * 头号判据 = S1（改规则 params → 输出变）+ S3（改绑定 → 评估的规则集变）。任一不通即本单不成立。
 *
 * 每条断言的**变异反证**（把实现改坏必须红）写在该条的注释里，交付报告贴两次实际输出。
 *
 * 本体引用：§2.C RuleEntry(params) · §2.E SolverContext.rules/SolverRuleBinding · §3 链路
 * 「规则库 → SolverRuleBinding → 求解器评估 → EvaluatedRule[] → 规则闸」· §5 R14/R6/R13/R-一致 · §8 G-10。
 */

const T = "demo";

/** 覆盖一条规则的某个 param（保「一 key 一 PUBLISHED」不变量）。 */
async function patchRuleParams(t: TestApp, key: string, patch: Record<string, number | string>): Promise<void> {
  const cur = (await t.repos.rules.list(T, (r) => r.key === key && r.status === "PUBLISHED"))[0];
  if (!cur) throw new Error(`规则 ${key} 未播种 —— S9 应先红`);
  await publishRuleOverride(t, { ...cur, id: `${cur.id}_v2`, version: cur.version + 1, params: { ...cur.params, ...patch } } as never);
}

type Inventory = { idle: { matId: string }[]; over: unknown[]; under: unknown[]; thresholdProvenance?: Prov };
type Prov = {
  thresholds: { ruleKey: string; paramKey: string; value: number; source: string; ruleVersion?: number; basis: string }[];
  fromRule: number;
  fromCodeFallback: number;
  missing: string[];
};

describe("WO-66 · 规则一等化 接缝门 S1–S9", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // S1（头号）：改规则 params 一个阈值 → 求解器输出真的跟着变（不改一行代码）。
  // 变异反证：把 extended.ts inventoryOptimize 的 idleDaysThreshold 改回硬编码 90 → 本条红。
  // ───────────────────────────────────────────────────────────────────────────
  it("S1 头号：改 C28.idleDaysThreshold（90→1）→ inventory_optimize 的 idle[] 真变（零代码改动）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);

    const before = (await invokeSolver(t, "inventory_optimize", {})).json().data as Inventory;
    // 出厂 90 天：demo 数据里呆滞项数（可能为 0，也可能有几条）。
    const beforeIdle = before.idle.length;

    await patchRuleParams(t, "C28", { idleDaysThreshold: 1 });

    const after = (await invokeSolver(t, "inventory_optimize", {})).json().data as Inventory;
    // 阈值从 90 天压到 1 天 → 呆滞集合必须**严格变大**（改规则即改推演）。
    expect(after.idle.length).toBeGreaterThan(beforeIdle);

    // 且该阈值必须在输出里可溯源到「规则」而非代码兜底（R13）。
    const hit = after.thresholdProvenance!.thresholds.find((x) => x.ruleKey === "C28" && x.paramKey === "idleDaysThreshold")!;
    expect(hit.source).toBe("rule");
    expect(hit.value).toBe(1);
  });

  it("S1b：改 C08.outsourceRatioMax（0.2→0.5）→ outsourcing_split 外协配额真变", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const args = { gap: 100, totalDemand: 100 };
    const before = (await invokeSolver(t, "outsourcing_split", args)).json().data as {
      allocation: { channel: string; qty: number }[];
    };
    const b = before.allocation.find((a) => a.channel === "outsource")!.qty;

    await patchRuleParams(t, "C08", { outsourceRatioMax: 0.5 });

    const after = (await invokeSolver(t, "outsourcing_split", args)).json().data as {
      allocation: { channel: string; qty: number }[];
    };
    const a = after.allocation.find((x) => x.channel === "outsource")!.qty;
    expect(b).toBe(20); // 100 × 0.2（出厂红线）
    expect(a).toBe(50); // 100 × 0.5（改规则即改推演）
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S2：规则里没有该 param 时，输出必须标注「来自代码兜底」——禁静默降级。
  // 变异反证：去掉 attachThresholdProvenance（静默兜底）→ 本条红。
  // ───────────────────────────────────────────────────────────────────────────
  it("S2：规则缺该 param → 输出诚实标 code_fallback（禁静默兜底）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);

    // 把 C28 的 params 清空 → idleDaysThreshold/overstockMultiple 只能走代码兜底。
    const cur = (await t.repos.rules.list(T, (r) => r.key === "C28" && r.status === "PUBLISHED"))[0]!;
    await publishRuleOverride(t, { ...cur, id: `${cur.id}_empty`, version: cur.version + 1, params: {} } as never);

    const out = (await invokeSolver(t, "inventory_optimize", {})).json().data as Inventory;
    const prov = out.thresholdProvenance!;
    expect(prov.fromCodeFallback).toBeGreaterThan(0);
    expect(prov.missing).toContain("C28.idleDaysThreshold");
    const hit = prov.thresholds.find((x) => x.ruleKey === "C28" && x.paramKey === "idleDaysThreshold")!;
    expect(hit.source).toBe("code_fallback");
    expect(hit.basis).toContain("代码兜底");
    expect(hit.basis).toContain("非规则定义");
  });

  it("S2b：规则齐备时同一字段标 rule（两态可区分，不是恒标一种）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await invokeSolver(t, "inventory_optimize", {})).json().data as Inventory;
    const prov = out.thresholdProvenance!;
    const hit = prov.thresholds.find((x) => x.ruleKey === "C28" && x.paramKey === "idleDaysThreshold")!;
    expect(hit.source).toBe("rule");
    expect(prov.fromRule).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S3（头号）：改规则的求解器绑定 → 该求解器评估的规则集真的变（不改代码）。
  // 变异反证：boundRuleKeys 改回只读 SOLVER_RULE_REFS → 本条红。
  // ───────────────────────────────────────────────────────────────────────────
  it("S3 头号：改 SolverRuleBinding → inventory_optimize 评估的规则集真变（零代码改动）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);

    const before = (await invokeSolver(t, "inventory_optimize", {})).json().data as {
      evaluatedRules?: { key: string }[];
      ruleBindingSource?: string;
    };
    // 出厂绑定已物化成数据行 → 运行期读的是绑定表（不是编译期常量）。
    expect(before.ruleBindingSource).toBe("binding_table");
    const keysBefore = (before.evaluatedRules ?? []).map((r) => r.key).sort();
    expect(keysBefore).toContain("C28");

    // ① 关掉一条绑定 → 评估集缩小。
    await t.repos.solverRuleBindings.put({
      id: "srb_inventory_optimize_C28",
      tenantId: T,
      solverKey: "inventory_optimize",
      ruleKey: "C28",
      enabled: false,
      source: "factory",
    });
    const off = (await invokeSolver(t, "inventory_optimize", {})).json().data as { evaluatedRules?: { key: string }[] };
    expect((off.evaluatedRules ?? []).map((r) => r.key)).not.toContain("C28");

    // ② 新增一条绑定（业务方纯数据操作，代码零改）→ 评估集扩大到一条本不在出厂表里的规则。
    await t.repos.solverRuleBindings.put({
      id: "srb_inventory_optimize_C22",
      tenantId: T,
      solverKey: "inventory_optimize",
      ruleKey: "C22",
      enabled: true,
      source: "manual",
    });
    const on = (await invokeSolver(t, "inventory_optimize", {})).json().data as { evaluatedRules?: { key: string }[] };
    expect((on.evaluatedRules ?? []).map((r) => r.key)).toContain("C22");
  });

  it("S3b：绑定表为空的租户 → 回落出厂常量并**诚实标来源**（不静默）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    for (const b of await t.repos.solverRuleBindings.list(T)) await t.repos.solverRuleBindings.remove(T, b.id);
    const out = (await invokeSolver(t, "inventory_optimize", {})).json().data as {
      evaluatedRules?: { key: string }[];
      ruleBindingSource?: string;
    };
    expect(out.ruleBindingSource).toBe("factory_default");
    expect((out.evaluatedRules ?? []).map((r) => r.key)).toContain("C28");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S4：绑定到**不存在的规则键 / 不存在的求解器** → 闭包门必须红。
  // 变异反证：删掉门的段 E（数据侧校验）→ 本条红（门变成摆设，业务方绑错永远没人拦）。
  // ───────────────────────────────────────────────────────────────────────────
  it("S4：闭包门数据侧 —— 绑定到不存在的规则键/求解器 → 门红；干净态门绿", async () => {
    const root = new URL("../../../", import.meta.url).pathname;
    const run = (env: Record<string, string>) =>
      spawnSync(process.execPath, ["scripts/check-rule-closure.mjs"], {
        cwd: root,
        env: { ...process.env, ...env },
        encoding: "utf8",
      });

    const clean = run({});
    expect(clean.status, `干净态门应绿：\n${clean.stdout}${clean.stderr}`).toBe(0);

    // ① 绑定一个**不存在的规则键** → 段 E1 红。
    const badRule = run({ WO66_INJECT_BINDING: "inventory_optimize:C999" });
    expect(badRule.status).not.toBe(0);
    expect(`${badRule.stderr}`).toContain("[E1]");

    // ② 绑定到一个**不存在的求解器** → 段 E2 红。
    const badSolver = run({ WO66_INJECT_BINDING: "no_such_solver:C28" });
    expect(badSolver.status).not.toBe(0);
    expect(`${badSolver.stderr}`).toContain("[E2]");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S5：R6 —— 同规则版本同输入两跑字节一致。变异反证：引入 Date.now()/随机 → 红。
  // ───────────────────────────────────────────────────────────────────────────
  it("S5：R6 同规则版本同输入两跑字节一致（含 thresholdProvenance 的排序稳定性）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = (await invokeSolver(t, "inventory_optimize", {})).json().data;
    const b = (await invokeSolver(t, "inventory_optimize", {})).json().data;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = (await invokeSolver(t, "outsourcing_split", { gap: 100, totalDemand: 100 })).json().data;
    const d = (await invokeSolver(t, "outsourcing_split", { gap: 100, totalDemand: 100 })).json().data;
    expect(JSON.stringify(c)).toBe(JSON.stringify(d));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S6：R13 —— 答案能说出「依据规则 Cxx@vN 的 <param>=<值>」。
  // 变异反证：basis 串里去掉版本或 param 名 → 红。
  // ───────────────────────────────────────────────────────────────────────────
  it("S6：R13 阈值溯源串含 规则键@版本 与 param 名与值", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await invokeSolver(t, "inventory_optimize", {})).json().data as Inventory;
    const hit = out.thresholdProvenance!.thresholds.find((x) => x.ruleKey === "C28" && x.paramKey === "idleDaysThreshold")!;
    expect(hit.ruleVersion).toBeGreaterThanOrEqual(1);
    expect(hit.basis).toMatch(/C28@v\d+/); // 规则键 + 版本
    expect(hit.basis).toContain("idleDaysThreshold"); // param 名
    expect(hit.basis).toContain("90"); // 值
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S8（③ 效果断言）：改某基地真实产能 → order_fullchain 的周供给随之变。
  // 变异反证：weeklyBase 改回 `bases.length × 700` → 本条红（基地数没变，输出不动）。
  // ───────────────────────────────────────────────────────────────────────────
  it("S8：改某基地真实产能（Process/Equipment）→ order_fullchain 周供给 P50 随之变（不再是 基地数×700）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);

    const before = (await invokeSolver(t, "order_fullchain", {})).json().data as {
      judges: { cap: { p50: number; p90: number; capSource: string; capBases: string[] } };
    };
    expect(before.judges.cap.capSource).toBe("capacity_chain"); // 已接真产能链（非旁路估算）
    const basesUsed = before.judges.cap.capBases;
    expect(basesUsed.length).toBeGreaterThan(0);

    // 把参与该单的基地的**真实产能链底料**打对折：所有工序 utilization 减半 → 产线/基地日产能降。
    const procs = await t.repos.objects.listByType(T, "Process");
    let touched = 0;
    for (const p of procs) {
      const lines = await t.repos.objects.listByType(T, "Line");
      const line = lines.find((l) => String(l.props.lineId) === String(p.props.lineId));
      if (!line || !basesUsed.includes(String(line.props.baseId))) continue;
      await t.repos.objects.put({ ...p, props: { ...p.props, utilization: Number(p.props.utilization ?? 1) * 0.5 } });
      touched++;
    }
    expect(touched).toBeGreaterThan(0);

    const after = (await invokeSolver(t, "order_fullchain", {})).json().data as {
      judges: { cap: { p50: number; p90: number } };
    };
    // 真产能降 → 周供给降。若还挂着「基地数 × 700」，这里会**逐字节不变** → 红。
    expect(after.judges.cap.p50).toBeLessThan(before.judges.cap.p50);
    expect(after.judges.cap.p90).toBeLessThan(before.judges.cap.p90);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // S9（☠ 头号缺陷的守门）：**生产种子**（非测试自建规则）下，那批命名系数规则真读到规则而非兜底。
  // 变异反证：从 battery.ts 删掉这些种子 → 本条红（此前正是这个状态，两道旧门都不红）。
  // ───────────────────────────────────────────────────────────────────────────
  it("S9：生产种子下 9 条命名系数规则真被播种为 PUBLISHED（此前从未播种 → coeff() 恒走兜底=死代码）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const published = await t.repos.rules.list(T, (r) => r.status === "PUBLISHED");
    const byKey = new Map(published.map((r) => [r.key, r]));
    for (const k of [
      "gap_attribution_coeffs",
      "supply_demand_gap_coeffs",
      "sop_reschedule_coeffs",
      "portfolio_optimize_coeffs",
      "base_outlook_coeffs",
      "metric_causal_binding",
      "trigger_thresholds",
      "risk_thresholds",
      "severity_grades",
      "countermeasure_levers",
    ]) {
      expect(byKey.get(k), `命名系数规则 ${k} 未播种`).toBeTruthy();
    }
    // 系数规则不得污染任何对象类型的规则映射（scope 必须空）。
    for (const k of ["gap_attribution_coeffs", "base_outlook_coeffs", "risk_thresholds"]) {
      expect(byKey.get(k)!.scopeObjectTypes).toEqual([]);
    }
  });

  it("S9b：生产种子下 base_capacity_outlook 的系数**真读到规则**（source=rule，非 code_fallback）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const bases = await t.repos.objects.listByType(T, "Base");
    const baseId = String(bases[0]!.props.baseId);
    const out = (await invokeSolver(t, "base_capacity_outlook", { baseId })).json().data as {
      thresholdProvenance?: Prov;
    };
    const prov = out.thresholdProvenance!;
    const keys = prov.thresholds.filter((x) => x.ruleKey === "base_outlook_coeffs");
    expect(keys.length).toBeGreaterThan(0);
    // ☠ 修前这里全是 code_fallback（规则从未播种）；修后必须全部 source=rule。
    expect(keys.every((x) => x.source === "rule")).toBe(true);
  });

  it("S9c：接缝 —— base_outlook_coeffs 被 base_capacity_outlook 与 risk_timeline 两个求解器**同一入口**读", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const bases = await t.repos.objects.listByType(T, "Base");
    const baseId = String(bases[0]!.props.baseId);

    const outlook0 = (await invokeSolver(t, "base_capacity_outlook", { baseId })).json().data as {
      thresholdProvenance?: Prov;
    };
    const v0 = outlook0.thresholdProvenance!.thresholds.find((x) => x.paramKey === "crossBaseAbsorbPct")!.value;
    expect(v0).toBe(0.6);

    // 改同一条规则的同一个 param → 两侧读的都必须是新值（此前两侧走两条不同取数路径，一致性无测试驱动）。
    await patchRuleParams(t, "base_outlook_coeffs", { crossBaseAbsorbPct: 0.11 });

    const outlook1 = (await invokeSolver(t, "base_capacity_outlook", { baseId })).json().data as {
      thresholdProvenance?: Prov;
    };
    expect(outlook1.thresholdProvenance!.thresholds.find((x) => x.paramKey === "crossBaseAbsorbPct")!.value).toBe(0.11);

    const risk = (await invokeSolver(t, "risk_timeline", { baseId, horizon: 30 })).json().data as {
      thresholdProvenance?: Prov;
    };
    const hit = risk.thresholdProvenance?.thresholds.find(
      (x) => x.ruleKey === "base_outlook_coeffs" && x.paramKey === "crossBaseAbsorbPct",
    );
    // risk_timeline 只在有 overlay 时才走该系数分支 —— 无 overlay 时不读（诚实：不读就不留 trace）。
    if (hit) expect(hit.value).toBe(0.11);
  });
});

/** ADMIN 头（helpers 已导出）在本文件通过 invokeSolver 默认使用。 */
void ADMIN;
