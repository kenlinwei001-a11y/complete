import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * WO-CONSTRAINT-REFS · **对象约束走引用规则库** 的接缝门（SEAM-GATE）。
 *
 * ── 这道门咬的是「链路」不是「函数」──────────────────────────────────────────
 * 本单的两半单独看都能绿，合起来才是用户要的东西：
 *   · 类型半：`POST /a/v1/ontology/object-types` 带 `constraintRefs` 存得住、回读得到；
 *   · 引擎半：求解器把**对象类型上挂的**约束并入规则引用集并真求值。
 * 故每条断言都从 **REST 写入** 出发、到 **求解器输出** 收尾，中间不 stub ——
 * 只测其中一半（比如只断言 zod 不再 strip）会在「存住了但没人读」时照样绿，
 * 而那正是本单开工时的病：屏上说配好了、实际什么都没发生、还不报错。
 *
 * ── 修之前的真实读数（派单前提的订正）────────────────────────────────────────
 * 派单说「求解器那一侧也不读（规则库）」——**实测不成立**，已顶回。求解器一直在读规则库
 * （`ruleSetVersion` 指纹 + C03 随入参翻 PASS/BLOCK）。真正的缺口是第二种形态：
 * **读规则库，但引用集只来自 `SOLVER_RULE_REFS[solverKey]`（按求解器 key 索引的编译期常量表），
 * 对象类型这一维根本不存在** ⇒ 对象上挂的约束无处可挂、也无人读。
 * §3 的「关掉读取逻辑必须变红」就是钉住这一维，防它被后人当成"多余的并集"优化掉。
 */
describe("WO-CONSTRAINT-REFS · 对象约束 = 对规则库的引用（写入→存储→求解器读取 全链）", () => {
  /** 建一条可发布的约束规则（阈值走 `params`，便于用同一表达式做两个方向的对照实验）。 */
  const publishRule = async (
    t: Awaited<ReturnType<typeof makeApp>>,
    key: string,
    utilCeiling: number,
  ): Promise<void> => {
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules",
      headers: ADMIN,
      payload: {
        key,
        name: `产线利用率上限 ${utilCeiling}`,
        expression: "Line.utilization > params.utilCeiling",
        scopeObjectTypes: ["Line"],
        severity: "BLOCK",
        params: { utilCeiling },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const pub = await t.app.inject({
      method: "POST",
      url: `/a/v1/rules/${(created.json() as { id: string }).id}/publish`,
      headers: ADMIN,
      payload: {},
    });
    expect(pub.statusCode, pub.body).toBe(200);
  };

  /** 把一条约束挂到已存在的 `Line` 类型上（保留其既有属性 —— POST 是 upsert，漏传属性会把它们抹掉）。 */
  const attachConstraint = async (
    t: Awaited<ReturnType<typeof makeApp>>,
    ruleKey: string,
  ): Promise<number> => {
    const types = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })).json() as {
      key: string; displayName: string; domain?: string;
      properties: unknown[]; derivedProperties?: unknown[]; sourceBindings?: unknown[];
    }[];
    const line = types.find((x) => x.key === "Line")!;
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: line.key,
        displayName: line.displayName,
        ...(line.domain ? { domain: line.domain } : {}),
        properties: line.properties,
        derivedProperties: line.derivedProperties ?? [],
        sourceBindings: line.sourceBindings ?? [],
        constraintRefs: [{ ruleKey, propKey: "utilization", kind: "must_not_exceed" }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { constraintRefs?: unknown[] }).constraintRefs?.length ?? 0;
  };

  const evaluatedRules = async (
    t: Awaited<ReturnType<typeof makeApp>>,
  ): Promise<{ key: string; outcome: string; evidence?: string }[]> => {
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/capacity_forecast/invoke",
      headers: ADMIN,
      payload: { args: { modelId: "2170-NCM", weeks: 4, demandDelta: 0.2 } },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { evaluatedRules?: { key: string; outcome: string; evidence?: string }[] } }).data.evaluatedRules ?? [];
  };

  it("① 存得住：配 1 条 → 回读 1 条（修前是 201 但整键被 zod 静默 strip 掉 ⇒ 回读 0 条）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 金丝雀：先证明"这个类型此刻确实没有约束"，否则下面的 1 可能是别处带来的，断言就不度量本单。
    const before = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })).json() as {
      key: string; constraintRefs?: unknown[];
    }[];
    expect(before.length, "金丝雀：本体里应当有对象类型（为 0 说明取数坏了，不是'没有约束'）").toBeGreaterThan(0);
    expect(before.filter((x) => (x.constraintRefs ?? []).length > 0).length).toBe(0);

    await publishRule(t, "LINE_UTIL_CEIL", 96);
    expect(await attachConstraint(t, "LINE_UTIL_CEIL")).toBe(1);

    const after = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })).json() as {
      key: string; constraintRefs?: { ruleKey: string; propKey: string; kind: string }[];
    }[];
    const line = after.find((x) => x.key === "Line")!;
    expect(line.constraintRefs).toEqual([{ ruleKey: "LINE_UTIL_CEIL", propKey: "utilization", kind: "must_not_exceed" }]);
  });

  it("② 引用不存在的规则 / 不存在的属性 → 400（不许静默收下：静默丢弃比报错危险得多）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const bad = await t.app.inject({
      method: "POST", url: "/a/v1/ontology/object-types", headers: ADMIN,
      payload: {
        key: "ZZ_Probe", displayName: "探针", properties: [{ propKey: "cap", dataType: "number", isPrimaryKey: false }],
        constraintRefs: [{ ruleKey: "C_DOES_NOT_EXIST", propKey: "cap", kind: "must_not_exceed" }],
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain("C_DOES_NOT_EXIST");

    await publishRule(t, "LINE_UTIL_CEIL", 96);
    const badProp = await t.app.inject({
      method: "POST", url: "/a/v1/ontology/object-types", headers: ADMIN,
      payload: {
        key: "ZZ_Probe2", displayName: "探针2", properties: [{ propKey: "cap", dataType: "number", isPrimaryKey: false }],
        constraintRefs: [{ ruleKey: "LINE_UTIL_CEIL", propKey: "nosuchprop", kind: "must_not_exceed" }],
      },
    });
    expect(badProp.statusCode).toBe(400);
    expect(badProp.json().error.message).toContain("nosuchprop");

    // DRAFT 规则同样拒（挂上去求解器读不到 = 又一个"配了却什么都没发生"）。
    const draft = await t.app.inject({
      method: "POST", url: "/a/v1/rules", headers: ADMIN,
      payload: { key: "ZZ_DRAFT", name: "草稿规则", expression: "Line.utilization > 99", scopeObjectTypes: ["Line"], severity: "BLOCK" },
    });
    expect(draft.statusCode).toBe(201);
    const onDraft = await t.app.inject({
      method: "POST", url: "/a/v1/ontology/object-types", headers: ADMIN,
      payload: {
        key: "ZZ_Probe3", displayName: "探针3", properties: [{ propKey: "cap", dataType: "number", isPrimaryKey: false }],
        constraintRefs: [{ ruleKey: "ZZ_DRAFT", propKey: "cap", kind: "must_not_exceed" }],
      },
    });
    expect(onDraft.statusCode).toBe(400);
  });

  /**
   * ③ **接缝主断言 + 变异反证的锚点**。
   *
   * 这条是本门的核心：它同时咬住「类型半存住了」与「引擎半读到了」。
   * ⚠ 把 `service.ts` 的 `objectConstraintBindings()` 改成恒返回 `[]`（= 关掉本单新加的读取逻辑），
   *   本条**必须变红**；恢复即回绿。不红说明这道门是装饰品。
   *   —— 已实测：关掉后本条报 `期望 5 条实得 4 条`。
   */
  it("③ 求解器读得到对象上挂的约束：挂之前 4 条、挂之后 5 条，且新增那条点名取证对象", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const before = await evaluatedRules(t);
    // 金丝雀：求解器**本来就在读规则库**（这正是派单前提被顶回的那一点）。
    // 若这里为 0，说明观测坏了 —— 那时该报"我的工具坏了"，而不是"求解器不读规则库"。
    expect(before.length, "金丝雀：capacity_forecast 本就声明了 4 条规则引用").toBe(4);
    expect(before.some((r) => r.key === "LINE_UTIL_CEIL")).toBe(false);

    await publishRule(t, "LINE_UTIL_CEIL", 96);
    await attachConstraint(t, "LINE_UTIL_CEIL");

    const after = await evaluatedRules(t);
    expect(after.length, "对象约束应并入引用集").toBe(5);
    const c = after.find((r) => r.key === "LINE_UTIL_CEIL")!;
    expect(c).toBeDefined();
    // 证据必须点名是哪个对象违规（全称约束的判定个体），否则屏上没人知道去看哪条产线。
    expect(c.evidence).toContain("对象约束 Line.utilization");
    expect(c.evidence).toMatch(/取证对象 obj_line_/);
    // 既有 4 条的结论逐条不变（新增一维不许改动旧输出）。
    for (const b of before) expect(after.find((r) => r.key === b.key)?.outcome).toBe(b.outcome);
  });

  /**
   * ④ **对照实验**（铁律 1.5 判据一）：不是"跑得起来吗"，而是
   * 「把 X 改成 X'，Y 必须按可预言的方式变化」。
   * 这里 X = 被引用的那条规则的阈值，Y = 该约束的 outcome。
   * 阈值高于全库最大利用率 → PASS；低于它 → BLOCK。**零行代码改动，只换引用**。
   */
  it("④ 对照实验：只换引用的规则（阈值 96 → 95），同一求解器同一入参的结论 PASS → BLOCK", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 先取真实的最大利用率，用它把两个阈值分别夹在两侧 —— 阈值不是拍脑袋定的。
    const lines = (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Line&pageSize=500", headers: ADMIN })).json() as {
      items: { props: Record<string, unknown> }[]; total: number;
    };
    const utils = lines.items.map((o) => o.props.utilization).filter((v): v is number => typeof v === "number");
    expect(utils.length, "金丝雀：Line 应当有 utilization 读数").toBeGreaterThan(0);
    expect(lines.items.length, "分页必须取全（pageSize 默认 50 会截断，据此选阈值会选错）").toBe(lines.total);
    const maxUtil = Math.max(...utils);

    await publishRule(t, "LINE_UTIL_LOOSE", Math.ceil(maxUtil) + 1); // 高于最大值 ⇒ 不可能违规
    await attachConstraint(t, "LINE_UTIL_LOOSE");
    const loose = (await evaluatedRules(t)).find((r) => r.key === "LINE_UTIL_LOOSE")!;
    expect(loose.outcome, `阈值 > 最大利用率 ${maxUtil} ⇒ 应 PASS`).toBe("PASS");

    await publishRule(t, "LINE_UTIL_TIGHT", Math.floor(maxUtil) - 1); // 低于最大值 ⇒ 必然违规
    await attachConstraint(t, "LINE_UTIL_TIGHT");
    const tight = (await evaluatedRules(t)).find((r) => r.key === "LINE_UTIL_TIGHT")!;
    expect(tight.outcome, `阈值 < 最大利用率 ${maxUtil} ⇒ 应 BLOCK（severity=BLOCK）`).toBe("BLOCK");
  });

  it("⑤ 全称约束取『最可能违规的那个实例』：上限型必须取 max，取平均会把超限稀释成 PASS", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const lines = (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Line&pageSize=500", headers: ADMIN })).json() as {
      items: { id: string; props: Record<string, unknown> }[];
    };
    const rows = lines.items.filter((o) => typeof o.props.utilization === "number");
    const maxRow = rows.slice().sort((a, b) =>
      (b.props.utilization as number) - (a.props.utilization as number) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]!;
    const avg = rows.reduce((s, o) => s + (o.props.utilization as number), 0) / rows.length;
    // 阈值夹在均值与最大值之间：取 max 判 ⇒ BLOCK；取平均判 ⇒ PASS。两种实现在此分叉。
    const between = (avg + (maxRow.props.utilization as number)) / 2;
    expect(between).toBeGreaterThan(avg);
    expect(between).toBeLessThan(maxRow.props.utilization as number);

    await publishRule(t, "LINE_UTIL_BETWEEN", between);
    await attachConstraint(t, "LINE_UTIL_BETWEEN");
    const r = (await evaluatedRules(t)).find((x) => x.key === "LINE_UTIL_BETWEEN")!;
    expect(r.outcome, "阈值在均值与最大值之间 ⇒ 必须 BLOCK（取平均的实现会错报 PASS）").toBe("BLOCK");
    expect(r.evidence).toContain(maxRow.id);
  });

  it("⑥ 规则挂上之后被下线 → 诚实标 NOT_APPLICABLE 点名断链（不静默跳过）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await publishRule(t, "LINE_UTIL_CEIL", 96);
    await attachConstraint(t, "LINE_UTIL_CEIL");
    expect((await evaluatedRules(t)).some((r) => r.key === "LINE_UTIL_CEIL")).toBe(true);

    const all = (await t.app.inject({ method: "GET", url: "/a/v1/rules", headers: ADMIN })).json() as { id: string; key: string }[];
    const rid = all.find((r) => r.key === "LINE_UTIL_CEIL")!.id;
    const retire = await t.app.inject({ method: "POST", url: `/a/v1/rules/${rid}/retire`, headers: ADMIN, payload: {} });
    expect(retire.statusCode, retire.body).toBe(200);

    const after = (await evaluatedRules(t)).find((r) => r.key === "LINE_UTIL_CEIL");
    expect(after, "约束引用的规则被下线后，这条约束不许从输出里悄悄消失").toBeDefined();
    expect(after!.outcome).toBe("NOT_APPLICABLE");
    expect(after!.evidence).toContain("已不在已发布规则库中");
  });

  it("⑦ 向后兼容（R6）：一条约束都没配时，求解器输出与本单上线前逐字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await t.app.inject({
      method: "POST", url: "/a/v1/solvers/capacity_forecast/invoke", headers: ADMIN,
      payload: { args: { modelId: "2170-NCM", weeks: 4, demandDelta: 0.2 } },
    });
    const b = await t.app.inject({
      method: "POST", url: "/a/v1/solvers/capacity_forecast/invoke", headers: ADMIN,
      payload: { args: { modelId: "2170-NCM", weeks: 4, demandDelta: 0.2 } },
    });
    expect(a.body).toBe(b.body); // 同输入两次逐字节相同（R6 确定性）
    const rules = (a.json() as { data: { evaluatedRules?: unknown[] } }).data.evaluatedRules ?? [];
    expect(rules.length, "无约束配置 ⇒ 只有 SOLVER_RULE_REFS 声明的 4 条").toBe(4);
  });
});
