import { describe, expect, it } from "vitest";
import { DRILL_EVENT_SPECS, type DrillEventSpec, type DrillFinding, type DrillReport } from "@platform/contracts";
import {
  collectHonesty,
  exposureTotals,
  impedimentSentence,
  nothingMovedText,
  orderedEvents,
  planCategoryOf,
  scrubSourceRefs,
  SOURCE_REF_MASK,
  sortMitigations,
  splitImpediments,
  subjectIdFormFor,
  subjectIsRead,
  subjectScopeFor,
  targetIdOf,
  topCustomers,
  type BaseCard,
  type Mitigation,
} from "@/views/sim/decisionConsoleModel";

/**
 * WO-DECISION-CONSOLE · 决策台纯函数层。
 *
 * ⚠ 这些用例**咬的是真回包的形状**，不是我自己编的样例：每个 fixture 都从
 * 起真 datacore（seed 42 · demo 租户）的实测回包里逐字段抄下来的，并在注释里点名出处。
 * 「测了函数」不等于「测了链路」—— 所以每条断言都写清它防的是屏上哪一句错话。
 */

// ── 实测 fixture（原文抄录）────────────────────────────────────────────────
/** `POST /a/v1/solvers/chain_impediments/invoke` 里的两条（一条带候选、一条不带）。 */
const IMPEDIMENTS_RAW = {
  impediments: [
    {
      impedimentId: "imp_BOTTLENECK.CAPACITY.cross-segment-contention_changzhou",
      kind: "BOTTLENECK",
      severity: 100,
      locus: { objectType: "Base", objectId: "changzhou", label: "常州" },
      evidence: { ruleKey: "C34", metricValue: 3693.683654, threshold: 1760, unit: "套/日" },
      dataMode: "SYNTHETIC",
      candidates: [],
      noCandidateReason: "枚举已跑完，有效候选 0 个（探了 10 个杠杆锚点 / 34 次试算），不足 2 个 ⇒ 构不成多方案对比，诚实不下发。",
    },
    {
      impedimentId: "imp_BOTTLENECK.CAPACITY.line-util_LINE-WS-zigong-grading",
      kind: "BOTTLENECK",
      severity: 0,
      locus: { objectType: "Line", objectId: "LINE-WS-zigong-grading", label: "自贡分容线" },
      evidence: { ruleKey: "C05", metricValue: 95.358, threshold: 95, unit: "%" },
      dataMode: "PARTIAL",
      candidates: [{ candidateId: "a" }, { candidateId: "b" }, { candidateId: "c" }, { candidateId: "d" }],
      noCandidateReason: null,
    },
  ],
};

/** `risk_timeline` 的两张卡（跨基地订单 `SO-3402` 在两张卡上各出现一次 —— 双计的成因）。 */
const CARDS: BaseCard[] = [
  {
    baseId: "changzhou",
    baseName: "常州",
    factor: "瓶颈工序",
    status: "OK",
    revenueYi: 3,
    orderCount: 2,
    customerCount: 2,
    orders: [
      { so: "SO-3402", cust: "长安汽车", model: "方形-LFP", qty: 14518, due: "2026-07-02", dueDay: 22, revenueYi: 2, seg: "乘用车" },
      { so: "SO-3391", cust: "广汽集团", model: "4680-NCM", qty: 7259, due: "2026-06-24", dueDay: 14, revenueYi: 1, seg: "乘用车" },
    ],
    doNothing: null,
  },
  {
    baseId: "jinhua",
    baseName: "金华",
    factor: "瓶颈工序",
    status: "OK",
    revenueYi: 2,
    orderCount: 1,
    customerCount: 1,
    orders: [
      { so: "SO-3402", cust: "长安汽车", model: "方形-LFP", qty: 14518, due: "2026-07-02", dueDay: 22, revenueYi: 2, seg: "乘用车" },
    ],
    doNothing: null,
  },
];

/** `battery.ts` 的 `risk.mitigations`，`risk_timeline` 原样下发。 */
const LIBRARY: Record<string, Mitigation[]> = {
  物料齐套: [
    { key: "early_stock", name: "提前备料", eff: 12, tn: 2, cost: "中", risk: "低" },
    { key: "alt_supplier", name: "备选供应商切换", eff: 9, tn: 5, cost: "高", risk: "中" },
    { key: "air_freight", name: "空运补料", eff: 15, tn: 1, cost: "极高", risk: "低" },
  ],
  瓶颈工序: [
    { key: "debottleneck", name: "瓶颈工序扩容", eff: 13, tn: 6, cost: "高", risk: "中" },
    { key: "reroute", name: "工艺路线调整", eff: 9, tn: 3, cost: "中", risk: "中" },
    { key: "outsource_step", name: "工序外协", eff: 10, tn: 4, cost: "高", risk: "高" },
  ],
};

const specOf = (kind: string): DrillEventSpec => {
  const s = DRILL_EVENT_SPECS.find((x) => x.kind === kind);
  if (!s) throw new Error(`fixture 坏了：契约里没有 ${kind}`);
  return s;
};

describe("① 事件主体：范围、id 形态、进不进算式", () => {
  it("金丝雀：契约今天登记了 11 类事件（这个数变了下面的用例才有意义）", () => {
    expect(DRILL_EVENT_SPECS.length).toBe(11);
  });

  it("500 张订单只能搜、不能铺（这是「筛选（共 11337 个落点）」那个病的对策）", () => {
    for (const k of ["ORDER_RESCHEDULE", "ORDER_CANCEL", "ORDER_RELOCATE", "ORDER_REPRICE"]) {
      const s = subjectScopeFor(k);
      expect(s?.typeKey, k).toBe("Order");
      expect(s?.mode, k).toBe("SEARCH");
    }
  });

  it("候选少的一律铺，且**没有一个是 Order**（铺 500 行就是复发）", () => {
    for (const k of ["ORDER_INSERT", "MATERIAL_DELAY", "MATERIAL_SHORTAGE", "MATERIAL_REPRICE", "EQUIPMENT_FAILURE", "CAPACITY_LOSS", "FORECAST_BIAS"]) {
      const s = subjectScopeFor(k);
      expect(s?.mode, k).toBe("LIST");
      expect(s?.typeKey, k).not.toBe("Order");
    }
  });

  it("设备故障是两级（基地 → 产线），两级各自 ≤20 行（13 / 每基地 10，实测）", () => {
    const s = subjectScopeFor("EQUIPMENT_FAILURE");
    expect(s?.typeKey).toBe("Base");
    expect(s?.child?.typeKey).toBe("Line");
    expect(s?.child?.filterParam).toBe("base");
  });

  it("带世界态落点的事件传**对象 id**，其余传**业务键**（实测：传反了后端回 not found）", () => {
    expect(subjectIdFormFor(specOf("MATERIAL_REPRICE"))).toBe("OBJECT_ID");
    expect(subjectIdFormFor(specOf("ORDER_RESCHEDULE"))).toBe("BUSINESS_KEY");
    const order = { id: "obj_order_SO-3391", props: { so: "SO-3391" } };
    expect(targetIdOf(specOf("ORDER_RESCHEDULE"), order, "so")).toBe("SO-3391");
    const material = { id: "obj_material_pos_lfp", props: { matId: "pos_lfp" } };
    expect(targetIdOf(specOf("MATERIAL_REPRICE"), material, "name")).toBe("obj_material_pos_lfp");
  });

  it("「你选的主体进不进算式」由 catalog 现算（进不了就必须在屏上说一句）", () => {
    // 有落点 ⇒ 进
    expect(subjectIsRead(specOf("MATERIAL_REPRICE"))).toBe(true);
    // 有 eventTarget 入参 ⇒ 进
    expect(subjectIsRead(specOf("ORDER_RESCHEDULE"))).toBe(true);
    // 路由入参全空、无落点 ⇒ 不进（实测：portfolio / bottleneck_matrix 都是 args: []）
    expect(subjectIsRead(specOf("ORDER_CANCEL"))).toBe(false);
    expect(subjectIsRead(specOf("CAPACITY_LOSS"))).toBe(false);
    expect(subjectIsRead(specOf("EQUIPMENT_FAILURE"))).toBe(false);
  });
});

describe("② 卡点：必须分栏，且不许把「刚越线」写成「没越线」", () => {
  it("18 条里带候选的进「能动」，其余进「只能盯着」——并排摆等于骗人说 N 个问题 N 套对策", () => {
    const r = splitImpediments(IMPEDIMENTS_RAW);
    expect(r.total).toBe(2);
    expect(r.actionable.map((x) => x.label)).toEqual(["自贡分容线"]);
    expect(r.watchOnly.map((x) => x.label)).toEqual(["常州"]);
    // 引擎自陈的原文必须留着（点开要给）
    expect(r.watchOnly[0]?.noCandidateReason).toContain("枚举已跑完");
  });

  it("95.358 vs 95 不许写成「95%，红线 95%（超红线 0%）」—— 那读起来像没问题", () => {
    const s = impedimentSentence({
      impedimentId: "x",
      kind: "BOTTLENECK",
      severity: 0,
      locus: { objectType: "Line", objectId: "l", label: "自贡分容线" },
      evidence: { metricValue: 95.358, threshold: 95, unit: "%" },
      dataMode: "PARTIAL",
    } as never);
    expect(s).toContain("95.36%");
    expect(s).toContain("红线 95.00%");
    expect(s).not.toContain("超红线 0%");
    expect(s).toContain("超红线 0.4%");
  });

  it("规则码 / 字段名不许进第一层那句话（R-UI-4）", () => {
    const r = splitImpediments(IMPEDIMENTS_RAW);
    for (const row of [...r.actionable, ...r.watchOnly]) {
      expect(row.sentence).not.toContain("C34");
      expect(row.sentence).not.toContain("C05");
      expect(row.sentence).not.toContain("capacityDailyPacks");
    }
    // 但规则码本身要留在数据里（第二层要用）
    expect(r.watchOnly[0]?.ruleKey).toBe("C34");
  });

  it("有本体类型中文名时挂上去（`pos_lfp_b2` 这种机器键单独上屏读不出是什么）", () => {
    const r = splitImpediments(IMPEDIMENTS_RAW, new Map([["Base", "生产基地"], ["Line", "产线"]]));
    expect(r.watchOnly[0]?.sentence.startsWith("生产基地 常州")).toBe(true);
    expect(r.actionable[0]?.sentence.startsWith("产线 自贡分容线")).toBe(true);
  });
});

describe("③ 敞口合计：按订单去重，绝不把各基地相加", () => {
  it("跨基地订单只算一次（相加 5 亿 vs 去重 3 亿，差的就是被双计的那张）", () => {
    const t = exposureTotals(CARDS);
    expect(t.naiveSumYi).toBe(5);
    expect(t.dedupedYi).toBe(3);
    expect(t.orderCount).toBe(2);
    expect(t.customerCount).toBe(2);
  });
});

describe("④ 客户：订单聚合与客户档案按名字对齐，信用越线要标出来", () => {
  it("合创汽车应收 7,916 > 额度 6,303 ⇒ overCredit（实测真值）", () => {
    const rows = topCustomers(
      [
        { group: { cust: "合创汽车" }, metrics: { count_so: 3, sum_value: 1_000_000_000 } },
        { group: { cust: "广汽埃安" }, metrics: { count_so: 223, sum_value: 22_334_317_368 } },
      ],
      [
        { props: { custId: "cust_16", custName: "合创汽车", receivables: 7916, creditLimit: 6303, maxOverdueDays: 23 } },
        { props: { custId: "cust_0", custName: "广汽埃安", receivables: 7530, creditLimit: 17539, maxOverdueDays: 24 } },
      ],
      50_725_911_442,
      6,
    );
    // 金额降序
    expect(rows[0]?.custName).toBe("广汽埃安");
    expect(rows[0]?.sharePct).toBeCloseTo(44.0, 0);
    const hc = rows.find((r) => r.custName === "合创汽车");
    expect(hc?.overCredit).toBe(true);
    expect(rows[0]?.overCredit).toBe(false);
  });
});

describe("⑤ 方案：类别 join 在基地卡上，排序不推荐", () => {
  it("卡片的 factor 必须命中方案库的键，命不中就诚实返回 null（不硬凑）", () => {
    expect(planCategoryOf(CARDS[0]!, LIBRARY)).toBe("瓶颈工序");
    expect(planCategoryOf({ ...CARDS[0]!, factor: "查无此类" }, LIBRARY)).toBeNull();
    expect(planCategoryOf(null, LIBRARY)).toBeNull();
  });

  it("按见效天 / 代价 / 风险换序，三种序互不相同（否则「可点换序」是装饰）", () => {
    const byTn = sortMitigations(LIBRARY.物料齐套!, "tn").map((m) => m.key);
    const byCost = sortMitigations(LIBRARY.物料齐套!, "cost").map((m) => m.key);
    const byRisk = sortMitigations(LIBRARY.物料齐套!, "risk").map((m) => m.key);
    expect(byTn).toEqual(["air_freight", "early_stock", "alt_supplier"]);
    expect(byCost).toEqual(["early_stock", "alt_supplier", "air_freight"]);
    expect(byRisk[byRisk.length - 1]).toBe("alt_supplier"); // 唯一的「中」风险排最后
    expect(byTn).not.toEqual(byCost);
  });

  it("不认识的档位排最后，**不许**当成「低」（那就是「绝不许填低」的另一种犯法）", () => {
    const withUnknown: Mitigation[] = [
      { key: "unknown", name: "未登记档位", eff: 1, tn: 9, cost: "未知", risk: "未知" },
      ...LIBRARY.物料齐套!,
    ];
    expect(sortMitigations(withUnknown, "cost").at(-1)?.key).toBe("unknown");
    expect(sortMitigations(withUnknown, "risk").at(-1)?.key).toBe("unknown");
  });
});

describe("⑥ 事件顺序线：去重、限窗、标估", () => {
  const finding = (when: number | null, label: string, dataMode: string): DrillFinding =>
    ({
      key: `k-${label}-${when}`,
      kind: "卡点",
      severity: 90,
      where: { objectType: "Base", objectId: "b", label },
      when,
      why: "越过阈值 85",
      source: { solverKey: "risk_timeline", dataMode, provenance: {} },
      reconciled: null,
    }) as DrillFinding;

  it("同一条被两个事件各路由一次 ⇒ 只出现一次（实测 risk_timeline 会回两遍）", () => {
    const rows = orderedEvents([finding(1, "常州·瓶颈工序", "LIVE"), finding(1, "常州·瓶颈工序", "LIVE")], [], 30);
    expect(rows.length).toBe(1);
  });

  it("窗外的不进线；订单晚到的按到期日排，且一律标估（引擎自陈是 hash 派生）", () => {
    const rows = orderedEvents(
      [finding(1, "常州·瓶颈工序", "LIVE"), finding(99, "窗外的", "LIVE")],
      [
        { so: "SO-3391", dueDay: 14, delayDays: 4, onTime: false },
        { so: "SO-OK", dueDay: 5, delayDays: 0, onTime: true },
        { so: "SO-OUT", dueDay: 90, delayDays: 3, onTime: false },
      ],
      30,
    );
    expect(rows.map((r) => r.day)).toEqual([1, 14]);
    expect(rows.find((r) => r.kind === "ORDER")?.estimated).toBe(true);
    // LIVE 的结论不标估
    expect(rows.find((r) => r.kind === "RISK")?.estimated).toBe(false);
  });
});

describe("⑦ 诚实位：三态分得开", () => {
  const baseReport = (over: Partial<DrillReport>): DrillReport =>
    ({
      worldId: "w",
      forkedFromStateId: null,
      horizonDays: 30,
      tickDays: 1,
      ticks: 30,
      events: [],
      findings: [],
      totalByKind: {},
      truncated: false,
      appliedLimitPerKind: 50,
      degraded: [],
      appliedStateEffects: [],
      solverRuns: [],
      summary: { allFailed: false, trustworthy: false, dataMode: "PARTIAL", text: "" },
      ...over,
    }) as DrillReport;

  it("「算完了一项都没动」与「没算」是两句话（引擎那句克制要原样传到屏上）", () => {
    expect(nothingMovedText(baseReport({ totalByKind: {} }))).toContain("比过了，一项都没动");
    expect(nothingMovedText(baseReport({ totalByKind: { 卡点: 3 } }))).toBeNull();
    expect(nothingMovedText(baseReport({ summary: { allFailed: true, trustworthy: false, dataMode: "EMPTY", text: "" } }))).toBeNull();
    expect(nothingMovedText(null)).toBeNull();
  });

  it("截断、没打上的冲击、跑不通的算、不读主体的事件，四类都要进页脚（缺一条就是静默降层）", () => {
    const notes = collectHonesty({
      report: baseReport({
        truncated: true,
        totalByKind: { 卡点: 383, 堵点: 24, 脆弱点: 368 },
        summary: { allFailed: false, trustworthy: false, dataMode: "PARTIAL", text: "本次演习扫出 775 条结论" },
        appliedStateEffects: [
          { eventKind: "MATERIAL_REPRICE", targetObjectId: "obj_base_changzhou", targetStateVar: "priceShock", mode: "delta", magnitude: 15, startTick: 4, applied: false },
        ],
        solverRuns: [{ solverKey: "order_fullchain", eventKind: "MATERIAL_DELAY", ok: false, dataMode: "UNDECLARED", error: "order obj_material_pos_lfp not found", findingCount: 1 }],
        events: [{ kind: "CAPACITY_LOSS", targetObjectId: "obj_base_changzhou", payload: {}, effectiveDay: 0 }],
      }),
      specsByKind: new Map(DRILL_EVENT_SPECS.map((s) => [s.kind as string, s])),
      impedimentsRaw: null,
      financeNotes: ["收入行**故意不动**：…这是诚实缺席，不是「收入不受影响」。"],
      riskDataMode: "PARTIAL",
    });
    const joined = notes.map((n) => `${n.text}||${n.raw}`).join("\n");
    expect(joined).toContain("775");
    expect(joined).toContain("没能打到世界上");
    expect(joined).toContain("order obj_material_pos_lfp not found");
    expect(joined).toContain("不读你选的那个主体");
    expect(joined).toContain("诚实缺席");
    expect(joined).toContain("模拟数据");
  });

  it("引擎原文里的源码文件名/行号要隐去，其余一字不改（R-UI-4 × 诚实位不许删，两条都得守）", () => {
    // 实测原文（`finance_world_projection.notes[0]`）里就带着 `seed.ts`
    const raw =
      "收入行**故意不动**：世界态的需求侧变量与 FinancePlan 收入行之间今天**没有任何传导规则**（`seed.ts` 13 条里六方向全查过）。凭空折算一个收入弹性就是引擎自己发明一个系数。";
    const out = scrubSourceRefs(raw);
    expect(out).not.toContain("seed.ts");
    expect(out).toContain(SOURCE_REF_MASK);
    // 其余一字不改
    expect(out).toContain("凭空折算一个收入弹性就是引擎自己发明一个系数");
    expect(out).toContain("13 条里六方向全查过");
    // 带行号的形态也要吃掉
    expect(scrubSourceRefs("契约 gap-attribution.ts:30「\"*\" 表示按类型聚合」")).not.toMatch(/\.ts:\d+/);
    // 金丝雀：不含源码坐标的原文**一个字节都不动**
    const clean = "枚举已跑完，有效候选 0 个（探了 10 个杠杆锚点 / 34 次试算），不足 2 个 ⇒ 构不成多方案对比，诚实不下发。";
    expect(scrubSourceRefs(clean)).toBe(clean);
  });

  it("金丝雀：全绿的一次演习只留必要的几条，不会凭空长出「没打上」这种条目", () => {
    const notes = collectHonesty({
      report: baseReport({
        appliedStateEffects: [
          { eventKind: "MATERIAL_REPRICE", targetObjectId: "obj_material_pos_lfp", targetStateVar: "priceShock", mode: "delta", magnitude: 15, startTick: 4, applied: true },
        ],
        events: [{ kind: "MATERIAL_REPRICE", targetObjectId: "obj_material_pos_lfp", payload: { pctChange: 15 }, effectiveDay: 0 }],
      }),
      specsByKind: new Map(DRILL_EVENT_SPECS.map((s) => [s.kind as string, s])),
      impedimentsRaw: null,
      financeNotes: [],
      riskDataMode: "LIVE",
    });
    expect(notes.length).toBe(0);
  });
});
