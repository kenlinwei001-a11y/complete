import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { BATTERY_RULE_SCOPES } from "../src/synthetic/battery.js";
import {
  suggestTypeKey,
  typeKeyCandidates,
  findUnknownScopeTypes,
  RULE_SCOPE_UNRESOLVED_EVENT,
  RULE_SCOPE_UNRESOLVED_CODE,
} from "../src/rule-scope.js";
import { assemblePlanBody, type LlmComprehendOutput } from "../src/databuilder/comprehend.js";
import { validateClosure } from "../src/databuilder/closure.js";
import { DEFAULT_BUILDER_CONFIG } from "../src/databuilder/preset.js";

/**
 * WO-RULE-SCOPE-DROP —— 规则作用域命名漂移 · 静默丢弃 → 诚实拒绝。
 *
 * 病：`BATTERY_RULE_SCOPES` 四条规则的 `scopeObjectTypes` 写的是**表达式注入命名空间**
 * （`Batch`/`Cert`/`Lta`/`Outsource`），不是本体对象类型键。而 `scopeObjectTypes` 的所有消费方
 * （`scheduler.ts` 扫描 / `app.ts` 图谱 / `ontology.ts` / `mapping.ts` / `slice-layers.ts`）
 * 都拿它去**查对象类型**。类型不存在 ⇒ `listByType` 恒空 ⇒ 规则永不参与评估，**且无任何信号**。
 *
 * 本文件的头号判据（缺则退单）：断言咬的是**「规则真参与了评估、产出了判定」**，
 * 不是「scope 字符串等于 MaterialBatch」—— 后者是假绿第 9 形态（测函数不测链路）。
 */

/**
 * 金丝雀（铁律 0.6）：报「0 命中 / 不存在」之前，先证明取数工具本身是对的。
 *
 * ⚠️ 本函数第一版拿 **C29**（`Order.daysToStart < 3`）当对照组，实测**恒 0** ——
 * 不是扫描器坏了，是种子里 `Order.daysToStart` **一个值都没有**（24 条订单该属性全 undefined）。
 * 拿一个自己就不触发的规则当"确定会命中"的对照组，等于给自己造了个假金丝雀：
 * 它报 0 时我分不出「工具坏了」还是「规则本来就不该响」。
 * 改用 **C03**（`Order.demandDelta > …`）—— `synthetic.test.ts:128` 已经在依赖它真触发。
 */
async function canaryRuleFires(t: TestApp): Promise<number> {
  const alerts = await t.services.ruleScan.scan("demo");
  return alerts.filter((a) => a.ruleKey === "C03").length;
}

describe("WO-RULE-SCOPE-DROP · 规则作用域命名漂移（静默丢弃 → 诚实拒绝）", () => {
  it("SEAM-1 · C28 在 MaterialBatch 的真实例上**真评估出判定**（不是断言 scope 字符串）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ① 数据侧：承载类型真有实例，且真有越线行（种子 battery-extended.ts:544 植入 6 批 >90 日呆滞）。
    const batches = await t.repos.objects.listByType("demo", "MaterialBatch");
    expect(batches.length).toBeGreaterThan(0);
    const dormant = batches.filter((b) => Number(b.props.idleDays) > 90);
    expect(dormant.length).toBe(6);

    // ② 金丝雀先说话：对照组规则必须有命中，否则下面的 0 是「工具坏了」不是「规则没接线」。
    expect(await canaryRuleFires(t)).toBeGreaterThan(0);

    // ③ 链路侧（头号判据）：规则扫描真产出 C28 判定，且判定落在**那 6 条越线批次**上。
    const alerts = await t.services.ruleScan.scan("demo");
    const c28 = alerts.filter((a) => a.ruleKey === "C28");
    expect(c28.length).toBe(dormant.length);
    expect(c28.map((a) => a.entityId).sort()).toEqual(dormant.map((b) => String(b.props.batchId)).sort());
    expect(c28[0]!.severity).toBe("WARN");

    // ④ 判定真外溢成可观察事件（不是只留在内存数组里）。
    const evts = await t.repos.outboxEvents.list(
      "demo",
      (e) => e.event === "rule.alert" && (e.payload as { ruleKey?: string }).ruleKey === "C28",
    );
    expect(evts.length).toBeGreaterThan(0);
  });

  it("SEAM-2 · scope 写了不存在的类型键 ⇒ **必须产生可观察信号**（不是静默通过）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 经**公开 API** 建一条 scope 写错的规则并发布（走真路径，不直接塞仓储）。
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules",
      headers: ADMIN,
      payload: {
        key: "ZZ_TYPO",
        name: "作用域写错的规则",
        expression: "MaterialBatch.idleDays > 90",
        scopeObjectTypes: ["Batch"], // ← 本体里没有这个类型键
        severity: "WARN",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const pub = await t.app.inject({ method: "POST", url: `/a/v1/rules/${id}/publish`, headers: ADMIN, payload: {} });
    expect(pub.statusCode, pub.body).toBe(200);

    await t.services.ruleScan.scan("demo");

    // 诚实位必须落到 outbox（= 前端 /a/v1/outbox 与 webhook 都看得见的地方）。
    const signals = await t.repos.outboxEvents.list(
      "demo",
      (e) => e.event === RULE_SCOPE_UNRESOLVED_EVENT && (e.payload as { ruleKey?: string }).ruleKey === "ZZ_TYPO",
    );
    expect(signals.length).toBe(1);
    const p = signals[0]!.payload as Record<string, unknown>;
    expect(p.code).toBe(RULE_SCOPE_UNRESOLVED_CODE);
    expect(p.unknownTypeKey).toBe("Batch");
    expect(p.suggestion).toBe("MaterialBatch"); // 建议的近似名
    expect(String(p.message)).toContain("Batch");

    // 信号必须**同时**出现在只读观测端点上（诚实位不是只写进日志没人看）。
    const feed = await t.app.inject({ method: "GET", url: "/a/v1/outbox", headers: ADMIN });
    expect(feed.statusCode).toBe(200);
    expect((feed.json() as { event: string }[]).some((e) => e.event === RULE_SCOPE_UNRESOLVED_EVENT)).toBe(true);
  });

  it("SEAM-3 · 修完之后：种子里剩下的未解析作用域**全部是真缺口**，无一条是「打错名」", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.services.ruleScan.scan("demo");

    const signals = await t.repos.outboxEvents.list("demo", (e) => e.event === RULE_SCOPE_UNRESOLVED_EVENT);
    const found = signals
      .map((e) => e.payload as { ruleKey: string; unknownTypeKey: string; reason: string; suggestion: string | null })
      .sort((a, b) => `${a.ruleKey}${a.unknownTypeKey}`.localeCompare(`${b.ruleKey}${b.unknownTypeKey}`));

    // 实测口径（真跑 28 条 PUBLISHED 规则 × 94 个对象类型）。C10 是本机制**自己抖出来的**：
    // 我原以为只剩 C31，机制说还有 C10 的 Action/Scenario —— 机器先说话，不是人想起来。
    expect(found.map((f) => `${f.ruleKey}:${f.unknownTypeKey}`)).toEqual([
      "C10:Action",
      "C10:Scenario",
      "C31:Outsource",
    ]);

    // 头号判据：**没有任何一条是 RENAME_CANDIDATE** —— 凡是"改个名就能接上"的，本单已经全改完了。
    // 若这条变红，说明又混进了一个命名漂移（正是本机制要拦的复发）。
    expect(found.filter((f) => f.reason === "RENAME_CANDIDATE")).toEqual([]);

    // C31 外协质量门：零候选 ⇒ 真缺承载对象类型（**不许硬塞近似类型**）。
    const c31 = found.find((f) => f.ruleKey === "C31")!;
    expect(c31.reason).toBe("NO_CARRIER");
    expect(c31.suggestion).toBeNull();

    // C10 场景必填+行动审批留痕：Action 零候选；Scenario 有 2 个候选（AnnualScenario / ScenarioTrigger）
    // ⇒ AMBIGUOUS，机器**拒绝替人挑一个**。这正是"判不准就明说判不准"。
    expect(found.find((f) => f.unknownTypeKey === "Action")!.reason).toBe("NO_CARRIER");
    const scen = found.find((f) => f.unknownTypeKey === "Scenario")!;
    expect(scen.reason).toBe("AMBIGUOUS");
    expect(scen.suggestion).toBeNull();
  });

  it("SEAM-4 · 三条改名后真挂上本体图谱（C26→Certification / C27→LongTermAgreement / C28→MaterialBatch）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/graph", headers: ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    const nodes = (res.json() as { nodes: { key: string; rules: { key: string }[] }[] }).nodes;
    const rulesOf = (k: string) => (nodes.find((n) => n.key === k)?.rules ?? []).map((r) => r.key);
    expect(rulesOf("MaterialBatch")).toContain("C28");
    expect(rulesOf("Certification")).toContain("C26");
    expect(rulesOf("LongTermAgreement")).toContain("C27");
  });

  it("SEAM-5 · comprehend 不再静默丢：未知 scope 的规则被**带到闭包门前**，门真的关上", () => {
    const core: LlmComprehendOutput = {
      objectTypes: [
        {
          typeKey: "Order",
          displayName: "订单",
          domain: "sales",
          fields: [
            { name: "orderId", dataType: "string", isPrimaryKey: true },
            { name: "qty", dataType: "number" },
          ],
        },
      ],
      rules: [
        { key: "R_OK", name: "好规则", expression: "Order.qty > 0", scopeObjectTypes: ["Order"], severity: "WARN" },
        { key: "R_BAD", name: "坏规则", expression: "Ghost.qty > 0", scopeObjectTypes: ["Ghost"], severity: "WARN" },
      ],
      solverNeeds: [],
    } as unknown as LlmComprehendOutput;

    const body = assemblePlanBody(core, "订单量校验", 42);
    // ① 不再静默丢：坏规则仍在 body 里（丢掉它 = 下游那道 HARD 门看不见它 = 门被卸了）。
    expect(body.rules.map((r) => r.key).sort()).toEqual(["R_BAD", "R_OK"]);
    // ② 诚实位随身：assemble 期就标出未知 scope + 候选。
    expect(body.unresolvedRuleScopes).toEqual([
      { ruleKey: "R_BAD", unknownTypeKey: "Ghost", suggestion: null, candidates: [], reason: "NO_CARRIER" },
    ]);
    // ③ 头号判据：既有的 FORWARD/HARD 闭包门**因此真的关上了**（此前被静默丢弃卸了武装）。
    const report = validateClosure(body as never, DEFAULT_BUILDER_CONFIG.closure);
    expect(report.gatePassed).toBe(false);
    expect(report.forwardMissing).toBeGreaterThan(0);
    expect(
      report.findings.some((f) => f.kind === "FORWARD" && f.ref === "rule:R_BAD->Ghost" && f.status === "MISSING"),
    ).toBe(true);
  });

  it("SEAM-6 · 建议器：唯一候选才建议；多候选一律说「判不准」，绝不替人挑一个", () => {
    // ⚠️ 这份 known 是**真本体的真子集**（含 OperatorSkillCert / ScenarioTrigger / AnnualScenario）。
    // 早期版本用的是一份"干净的"小清单，于是 Cert / Scenario 看起来都唯一 —— 那是拿一个
    // 精心挑过的样本证明算法没问题，正是本仓最恨的自证。真清单里它们各有 2 个候选。
    const known = [
      "MaterialBatch", "Certification", "OperatorSkillCert", "LongTermAgreement",
      "AnnualScenario", "ScenarioTrigger", "Order", "Line", "Material",
    ];
    // 金丝雀（与主逻辑共用同一份实现）：一个确定必中的样例先跑通，否则下面的 null 是「工具坏了」。
    expect(suggestTypeKey("Order", known)).toBe("Order");

    expect(suggestTypeKey("Batch", known)).toBe("MaterialBatch"); // 唯一子串候选
    expect(suggestTypeKey("Lta", known)).toBe("LongTermAgreement"); // 唯一驼峰缩写候选
    expect(typeKeyCandidates("Cert", known)).toEqual(["Certification", "OperatorSkillCert"]);
    expect(suggestTypeKey("Cert", known)).toBeNull(); // 2 个候选 ⇒ 判不准，不挑
    expect(typeKeyCandidates("Scenario", known)).toEqual(["AnnualScenario", "ScenarioTrigger"]);
    expect(suggestTypeKey("Scenario", known)).toBeNull(); // 2 个候选 ⇒ 判不准，不挑
    expect(suggestTypeKey("Outsource", known)).toBeNull(); // 0 候选 ⇒ 真缺口
    expect(suggestTypeKey("Action", known)).toBeNull();

    const findings = findUnknownScopeTypes(
      [
        { key: "C28", scopeObjectTypes: ["Batch"] },
        { key: "C31", scopeObjectTypes: ["Outsource"] },
        { key: "C10", scopeObjectTypes: ["Action", "Scenario"] },
        { key: "C29", scopeObjectTypes: ["Order"] },
      ],
      known,
    );
    expect(findings).toEqual([
      { ruleKey: "C10", unknownTypeKey: "Action", suggestion: null, candidates: [], reason: "NO_CARRIER" },
      {
        ruleKey: "C10", unknownTypeKey: "Scenario", suggestion: null,
        candidates: ["AnnualScenario", "ScenarioTrigger"], reason: "AMBIGUOUS",
      },
      {
        ruleKey: "C28", unknownTypeKey: "Batch", suggestion: "MaterialBatch",
        candidates: ["MaterialBatch"], reason: "RENAME_CANDIDATE",
      },
      { ruleKey: "C31", unknownTypeKey: "Outsource", suggestion: null, candidates: [], reason: "NO_CARRIER" },
    ]);

    // 「本体还没建」不该被读成「所有规则都错」（否则种子期满屏假红）。
    expect(findUnknownScopeTypes([{ key: "C28", scopeObjectTypes: ["Batch"] }], [])).toEqual([]);
  });

  it("SEAM-7 · 种子表回归锁：三条已归真类型键，C31 保持原样（缺口不许靠塞近似类型糊掉）", () => {
    expect(BATTERY_RULE_SCOPES.C28).toEqual(["MaterialBatch"]);
    expect(BATTERY_RULE_SCOPES.C26).toEqual(["Certification"]);
    expect(BATTERY_RULE_SCOPES.C27).toEqual(["LongTermAgreement"]);
    expect(BATTERY_RULE_SCOPES.C31).toEqual(["Outsource"]);
  });
});
