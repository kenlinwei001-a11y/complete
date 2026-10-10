import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { BATTERY_RULE_SCOPES } from "../src/synthetic/battery.js";
import {
  findUnknownScopeTypes,
  RULE_SCOPE_UNRESOLVED_EVENT,
} from "../src/rule-scope.js";

/**
 * WO-RULE-SCOPE-TRIAD —— 规则作用域三条同族断点一次收口。
 *
 * 三条**定性完全不同**（混了必修错地方，审核方 2026-08-11 裁过）：
 *   ① NAMESPACE-CONFUSION：作用域抄了表达式注入命名空间（前单已修 C26/C27/C28 + 建机器判据）。
 *   ② NO-CARRIER-C31：C31 外协质量门的承载类型本体里**真的没有** ⇒ 本单**新建 `Outsource` 外协批次类型**。
 *   ③ CATEGORY-ERROR-C10：C10 管的是治理制品（Action），与「对象类型」平级的另一类要素 ⇒ **任何改名都错**。
 *
 * 本文件的头号判据（缺则退单）：断言咬的是**「C31 真参与了评估、在真外协批次上产出 BLOCK 判定」**，
 * 不是「Outsource 类型在库里」—— 后者是假绿第 9 形态（测函数不测链路）。
 * 变异反证：把 C31 的 scope 改回不存在的键 ⇒ 红在「C31 判定消失 + scope_unresolved 信号出现」，
 * 不是红在「函数不存在」。
 */

/** 金丝雀（与 rule-scope-drop.seam.test.ts 同一口径）：C03 必须真触发，否则下面的 0/1 都是「工具坏了」。 */
async function canaryRuleFires(t: TestApp): Promise<number> {
  const alerts = await t.services.ruleScan.scan("demo");
  return alerts.filter((a) => a.ruleKey === "C03").length;
}

describe("WO-RULE-SCOPE-TRIAD · ② C31 承载类型补建（NO_CARRIER → 真评估）", () => {
  it("TRIAD-1 · C31 在真外协批次上**真评估出 BLOCK 判定**（头号判据：不是断言类型存在）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ① 数据侧：承载类型真有实例（每物料 1 批 = 8 批），且恰有一批越线（sep_film 0.91 < 0.92 合同底线）。
    const lots = await t.repos.objects.listByType("demo", "Outsource");
    expect(lots.length).toBe(8);
    const violating = lots.filter((l) => Number(l.props.yieldRate) < Number(l.props.minYieldRate));
    expect(violating.length).toBe(1);
    expect(violating[0]!.props.outsourceId).toBe("os_sep_film");
    expect(violating[0]!.props.yieldRate).toBe(0.91); // 真值源 = Material.outsourceYield（单一来源）
    expect(violating[0]!.props.minYieldRate).toBe(0.92);

    // ② 金丝雀先说话：对照组规则必须有命中。
    expect(await canaryRuleFires(t)).toBeGreaterThan(0);

    // ③ 链路侧（头号判据）：规则扫描真产出 C31 判定，且判定**落在那一票越线批次上**。
    const alerts = await t.services.ruleScan.scan("demo");
    const c31 = alerts.filter((a) => a.ruleKey === "C31");
    expect(c31.length).toBe(1);
    expect(c31[0]!.entityId).toBe("os_sep_film");
    expect(c31[0]!.severity).toBe("BLOCK"); // 外协质量门是 BLOCK 级

    // ④ 判定真外溢成可观察事件（不是只留在内存数组里）。
    const evts = await t.repos.outboxEvents.list(
      "demo",
      (e) => e.event === "rule.alert" && (e.payload as { ruleKey?: string }).ruleKey === "C31",
    );
    expect(evts.length).toBeGreaterThan(0);
  });

  it("TRIAD-2 · C31 不再发 scope_unresolved；剩余信号恰好是 C10 的两条（且仍无 RENAME_CANDIDATE）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.services.ruleScan.scan("demo");

    const signals = await t.repos.outboxEvents.list("demo", (e) => e.event === RULE_SCOPE_UNRESOLVED_EVENT);
    const found = signals
      .map((e) => e.payload as { ruleKey: string; unknownTypeKey: string; reason: string; suggestion: string | null })
      .sort((a, b) => `${a.ruleKey}${a.unknownTypeKey}`.localeCompare(`${b.ruleKey}${b.unknownTypeKey}`));

    // C31 的 Outsource 已是真类型键 ⇒ 信号集收缩到 C10 的两条范畴错误（它们**故意保留**，见 TRIAD-4）。
    expect(found.map((f) => `${f.ruleKey}:${f.unknownTypeKey}`)).toEqual(["C10:Action", "C10:Scenario"]);

    // 回归锁：仍然**没有任何一条是 RENAME_CANDIDATE** —— 凡是"改个名就能接上"的，机制必须当场喊出来。
    expect(found.filter((f) => f.reason === "RENAME_CANDIDATE")).toEqual([]);
    expect(found.find((f) => f.unknownTypeKey === "Action")!.reason).toBe("NO_CARRIER");
    expect(found.find((f) => f.unknownTypeKey === "Scenario")!.reason).toBe("AMBIGUOUS");
  });

  it("TRIAD-3 · C31 挂上本体图谱 Outsource 节点，且 material_has_outsource 边真实落库", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 图谱侧：Outsource 类型节点上挂的是 C31（scopeObjectTypes 的图谱消费方真读到它）。
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/graph", headers: ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    const nodes = (res.json() as { nodes: { key: string; rules: { key: string }[] }[] }).nodes;
    const outsourceNode = nodes.find((n) => n.key === "Outsource");
    expect(outsourceNode).toBeTruthy();
    expect(outsourceNode!.rules.map((r) => r.key)).toContain("C31");

    // 链路侧：每票外协批次都经 material_has_outsource 连回它的物料（不进图 = 孤岛切片）。
    const links = await t.repos.links.list("demo", (l) => l.type === "material_has_outsource");
    expect(links.length).toBe(8);
    const lots = await t.repos.objects.listByType("demo", "Outsource");
    for (const lot of lots) {
      expect(links.some((l) => l.toId === lot.id)).toBe(true);
    }
  });
});

describe("WO-RULE-SCOPE-TRIAD · ③ C10 范畴错误裁决（改名一律是错的）", () => {
  it("TRIAD-4 · C10 引用的字段**本身无承载**（金丝雀守否定结论）+ 信号继续保持可观察", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 核心新证据（比 WO 定性更深一层）：C10 不光作用域跨要素，它引用的 `audited` 字段
    // **在全本体任何类型上都不存在** —— 即使给它另立作用域维度，expression 也无处取值。
    const types = await t.repos.ontologyTypes.list("demo");
    const allProps = new Set(types.flatMap((ty) => ty.properties.map((p) => p.propKey)));
    // 金丝雀（铁律 0.6）：先证明「扫字段名」这件工具没瞎 —— approver 真实存在（OverdueRecord·Approvable 接口）。
    expect(allProps.has("approver")).toBe(true);
    // 否定结论：audited 零承载（全仓唯一出现处就是 C10 的 expression 字符串本身）。
    expect(allProps.has("audited")).toBe(false);

    // 且 Action/Scenario 不是对象类型（它们是本体七要素里的行动/场景，不在 scopeObjectTypes 值域）。
    expect(types.some((ty) => ty.key === "Action")).toBe(false);
    expect(types.some((ty) => ty.key === "Scenario")).toBe(false);

    // 裁决的另一半：规则**不许删也不许改名**——保留在库里，每轮扫描发声当诚实缺口标记。
    await t.services.ruleScan.scan("demo");
    const c10Signals = await t.repos.outboxEvents.list(
      "demo",
      (e) => e.event === RULE_SCOPE_UNRESOLVED_EVENT && (e.payload as { ruleKey?: string }).ruleKey === "C10",
    );
    expect(c10Signals.length).toBe(2); // Action + Scenario 各一条，缺口从「没人知道」变「机器每轮在喊」
  });

  it("TRIAD-5 · 种子表回归锁：C31 键不变但已是真类型键；C10 保持原样（另立维度或退役是产品裁决）", () => {
    expect(BATTERY_RULE_SCOPES.C31).toEqual(["Outsource"]);
    expect(BATTERY_RULE_SCOPES.C10).toEqual(["Action", "Scenario"]);
  });
});

describe("WO-RULE-SCOPE-TRIAD · 机制抗复发（金丝雀与主逻辑共用同一份实现）", () => {
  it("TRIAD-6 · 机器判据对**活本体**：Outsource 不再咬、写错的键照样咬", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const knownTypeKeys = (await t.repos.ontologyTypes.list("demo")).map((ty) => ty.key);
    // 金丝雀：Outsource 真在已知类型集里（否则下面的「没咬 C31」是工具坏了）。
    expect(knownTypeKeys).toContain("Outsource");

    const findings = findUnknownScopeTypes(
      [
        { key: "C31", scopeObjectTypes: BATTERY_RULE_SCOPES.C31 }, // 现在的真值：必须零命中
        { key: "ZZ_RELAPSE", scopeObjectTypes: ["Outsourc"] }, // 复发样例（敲掉一个字母）：必须咬
      ],
      knownTypeKeys,
    );
    expect(findings.filter((f) => f.ruleKey === "C31")).toEqual([]);
    const relapse = findings.find((f) => f.ruleKey === "ZZ_RELAPSE");
    expect(relapse).toBeTruthy();
    expect(relapse!.unknownTypeKey).toBe("Outsourc");
    // "Outsourc" 是 "Outsource" 的子串、且包含档唯一候选 ⇒ RENAME_CANDIDATE（机器当场给出真类型键）。
    expect(relapse!.reason).toBe("RENAME_CANDIDATE");
    expect(relapse!.suggestion).toBe("Outsource");
  });
});
