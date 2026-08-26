import { describe, expect, it } from "vitest";
import type { IntentDefinition, QueryTask, SessionContext } from "@platform/contracts";
import { matchObjectRefInType, pickObjectRefResolution } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedIntentsAndPlans } from "../src/mocks/seed.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";
import { fillSlots } from "../src/router/slots.js";
import { resolveTemplate } from "../src/util/template.js";

/**
 * ★ WO-DERIVED-INTENT-SLOT-DEAF · `G-DERIVED-INTENT-SLOT-DEAF`（欠账 #112）的**接缝门**。
 *
 * 治的病：`SCENARIO_CATALOG` 派生的 16 个意图声明 `slots: []` ⇒ `fillSlots` 的循环体一次都不进
 * ⇒ `taskSlots={}` 整袋丢 ⇒ `invoke_solver(args = 写死的 slotPresets)`。真 Kimi 实测：
 * 「常州下周哪些订单缺料开不了工？」与「金华…」答案**逐字节相同**，而终态 `COMPLETED + rounds=0`。
 *
 * ⚠ **判据刻意不是状态门**（工单 §4.1）：`COMPLETED && rounds===0` 正是 #105 验收放过这道病的那把尺子——
 *    它能看见"答没答"，看不见"答的是不是这个问题"。本门一律断**同一问句只换实体 → 到达求解器的实参必须不同**。
 *
 * 断言落点（就近病灶·最不脆）= `dataCore.solver.invoke` 收到的 args（§C/§D），
 * 加一条**加性**门（§B）：用户不给实体时，16 个意图的求解器实参与改前**逐字节一致**。
 *
 * 变异反证（工单 §4.2·收口时手跑并把原文贴进工单 §6）：
 *   把 `mocks/seed.ts` 的 `solverArgs` 改回 preset 独占（`= declaredArgs`，即今天的行为）
 *   → §C/§D 当场转红（实参恒等于写死值、两个问句答案逐字节相同）。
 */

const FEATURES = [...defaultOnKeys()];

/** 16 个派生意图（4 个原生意图走 `seededKeys` 跳过，不在本单范围）。 */
const NATIVE_KEYS = new Set(["capacity_feasibility", "affected_orders", "risk_root_cause", "adopt_mitigation", "order_deep_360"]);
const DERIVED_CARDS = SCENARIO_CATALOG.filter((c) => !NATIVE_KEYS.has(c.intentKey));

/** 目录侧「已声明的求解器入参」——与 seed.ts 同一处来源（此表只在测里重述一次 ARG_OVERRIDE 的存在事实）。 */
function declaredArgsOf(intentKey: string): Record<string, unknown> {
  const { plans } = seedIntentsAndPlans();
  const plan = plans.find((p) => p.key === intentKey);
  const s1 = plan?.steps.find((s) => s.id === "s1") as { params?: { args?: Record<string, unknown> } } | undefined;
  return s1?.params?.args ?? {};
}

function seeded(): { intents: IntentDefinition[]; plans: ReturnType<typeof seedIntentsAndPlans>["plans"] } {
  return seedIntentsAndPlans();
}

// ---------------------------------------------------------------------------
// §A 槽位是**派生**的，不是手抄的第二份清单
// ---------------------------------------------------------------------------

describe("WO-DERIVED-INTENT-SLOT-DEAF §A · 派生意图的槽位从「卡已声明的求解器入参」派生", () => {
  it("16 个派生意图不再有 slots:[]（有入参声明的卡必须有同名槽位·键集不多不少）", () => {
    const { intents, plans } = seeded();
    const report: string[] = [];
    for (const card of DERIVED_CARDS) {
      const intent = intents.find((i) => i.key === card.intentKey);
      const plan = plans.find((p) => p.key === card.intentKey);
      expect(intent, `派生意图缺失：${card.intentKey}`).toBeTruthy();
      const argKeys = Object.keys(
        ((plan?.steps.find((s) => s.id === "s1") as { params?: { args?: Record<string, unknown> } })?.params?.args ?? {}),
      ).sort();
      const slotNames = (intent?.slots ?? []).map((s) => s.name).sort();
      // **不多**：不在 agentcore 侧凭空发明求解器不认的入参维（那是造第二套语义）。
      // **不少**：卡声明了入参就必须有对应槽位，否则用户说了也落不进去（= 本病）。
      expect(slotNames, `${card.sNo}/${card.intentKey} 槽位键集 ≠ 已声明入参键集`).toEqual(argKeys);
      report.push(`${card.sNo} ${card.intentKey}: ${slotNames.length} 槽`);
    }
    // 至少有一半的卡真的有入参（否则本门等于没测东西）
    expect(report.filter((r) => !r.endsWith("0 槽")).length).toBeGreaterThanOrEqual(10);
  });

  it("每个派生槽位都带字面默认值（const:<JSON>），且 args 逐键改成 {{slots.x}}（merge 语义的两半）", () => {
    const { intents, plans } = seeded();
    for (const card of DERIVED_CARDS) {
      const intent = intents.find((i) => i.key === card.intentKey)!;
      const plan = plans.find((p) => p.key === card.intentKey)!;
      const args = ((plan.steps.find((s) => s.id === "s1") as { params?: { args?: Record<string, unknown> } }).params?.args ?? {});
      for (const slot of intent.slots) {
        expect(slot.defaultFrom, `${card.intentKey}.${slot.name} 无字面默认值`).toMatch(/^const:/);
        expect(slot.required, `${card.intentKey}.${slot.name} 不该必填（有默认值·零反问门不能退）`).toBe(false);
        expect(args[slot.name], `${card.intentKey}.${slot.name} 的 args 仍是写死值`).toBe(`{{slots.${slot.name}}}`);
      }
    }
  });

  it("4 个原生意图的既有槽位一字不动（工单范围边界：不碰已并线的原生槽位）", () => {
    const { intents } = seeded();
    const capBase = intents.find((i) => i.key === "capacity_feasibility")!.slots.find((s) => s.name === "base");
    expect(capBase).toMatchObject({ type: "objectRef", required: false, refType: "Base" });
    expect(capBase?.defaultFrom).toBeUndefined();
    const rrc = intents.find((i) => i.key === "risk_root_cause")!.slots.find((s) => s.name === "base");
    expect(rrc).toMatchObject({ type: "objectRef", required: true, defaultFrom: "$.selectedObjects[0]" });
  });
});

// ---------------------------------------------------------------------------
// §B 加性（工单 §4.3）：用户不给实体 → 求解器实参与改前逐字节一致
// ---------------------------------------------------------------------------

/** fillSlots 的最小桩（本组只有 string/number/json 槽，不触 objectRef 解析）。 */
const STUB_BASE_TYPE = { key: "Base", properties: [{ propKey: "baseId", isPrimaryKey: true }, { propKey: "name" }] };
const STUB_BASE_ROWS = [{ id: "obj_base_changzhou", props: { baseId: "changzhou", name: "常州" } }];
const stubOntology = {
  getObject: async () => ({ data: {} }),
  listObjectTypeKeys: async () => ["Base"],
  queryObjects: async () => ({ data: { rows: [] } }),
  resolveObjectRef: async (_c: unknown, req: { ref: unknown }) => {
    const { hits, attempt } = matchObjectRefInType({ ref: req.ref, objectType: "Base", typeDef: STUB_BASE_TYPE, rows: STUB_BASE_ROWS });
    return pickObjectRefResolution(req.ref, hits, [attempt]);
  },
} as unknown as Parameters<typeof fillSlots>[3];
const stubCtx = { tenantId: TENANT, userId: "u", roles: [], token: "t" } as unknown as Parameters<typeof fillSlots>[4];
const emptySession = { view: "risk", selectedObjects: [], filters: {} } as SessionContext;

/** 走**真** fillSlots + **真** resolveTemplate，重放运行期得到的求解器实参。 */
async function resolvedArgs(intent: IntentDefinition, plan: { steps: unknown[] }, extracted: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { slots } = await fillSlots(intent, extracted, emptySession, stubOntology, stubCtx);
  const s1 = plan.steps.find((s) => (s as { id: string }).id === "s1") as { params: { args: Record<string, unknown> } };
  return resolveTemplate(s1.params.args, { slots, context: emptySession, steps: {} }) as Record<string, unknown>;
}

describe("WO-DERIVED-INTENT-SLOT-DEAF §B · 加性（用户不给实体 → 实参与改前逐字节一致）", () => {
  /**
   * 改前的实参 = 目录声明的那份对象本身（旧代码 `args: solverArgs` 直接把它当 args）。
   * 本门重放 fillSlots(extracted={}) → resolveTemplate，逐卡与它做 **JSON 逐字节比对**。
   */
  it("16 张卡：extracted={} 时 resolveTemplate(args) === 目录声明的入参（JSON 逐字节）", async () => {
    const { intents, plans } = seeded();
    const diffs: string[] = [];
    for (const card of DERIVED_CARDS) {
      const intent = intents.find((i) => i.key === card.intentKey)!;
      const plan = plans.find((p) => p.key === card.intentKey)!;
      const before = declaredArgsOfSlots(intent);
      const after = await resolvedArgs(intent, plan, {});
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        diffs.push(`${card.sNo} ${card.intentKey}\n  改前: ${JSON.stringify(before)}\n  改后: ${JSON.stringify(after)}`);
      }
    }
    expect(diffs.join("\n"), "加性被破坏（用户没说话时实参变了）").toBe("");
  });

  /** 「改前的实参」= 槽上字面默认值还原出来的对象（= 目录声明值，seed 只搬了个家没改值）。 */
  function declaredArgsOfSlots(intent: IntentDefinition): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const s of intent.slots) out[s.name] = JSON.parse(String(s.defaultFrom).slice("const:".length));
    return out;
  }

  it("字面默认值就是目录/ARG_OVERRIDE 里那份值（不是测试自己编的）", () => {
    const { intents } = seeded();
    const yieldDiag = intents.find((i) => i.key === "yield_diag")!;
    expect(yieldDiag.slots.find((s) => s.name === "processKey")?.defaultFrom).toBe('const:"涂布"');
    // ARG_OVERRIDE 路（quote_margin 的入参不是卡的 slotPresets）也照样派生
    const quote = intents.find((i) => i.key === "quote_margin_q")!;
    expect(quote.slots.map((s) => s.name).sort()).toEqual(["custName", "modelId", "qty"]);
    expect(declaredArgsOf("quote_margin_q")).toEqual({
      custName: "{{slots.custName}}", modelId: "{{slots.modelId}}", qty: "{{slots.qty}}",
    });
  });
});

// ---------------------------------------------------------------------------
// §C 差分门（工单 §4.1）· 实参层：同一问句只换实体 → 到达求解器的实参必须不同
// ---------------------------------------------------------------------------

function queueAnswers(t: TestApp, n = 6): void {
  for (let i = 0; i < n; i++) {
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结论。" }], provenance: [] })] });
  }
}

/** 观测点：真正到达 DataCore 求解器的入参（不看路由、看**谁真的收到了什么**）。 */
function spySolver(t: TestApp): { key: string; args: Record<string, unknown> }[] {
  const invoked: { key: string; args: Record<string, unknown> }[] = [];
  const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
  t.dataCore.solver.invoke = async (ctx, key, args) => {
    invoked.push({ key, args });
    return orig(ctx, key, args);
  };
  return invoked;
}

interface RunOut {
  status: string;
  rounds: number;
  args?: Record<string, unknown>;
  answerText: string;
  routed?: string;
}

/**
 * 跑一条派生意图的自由问句：LLM 原样交出用户说的实体（真 Kimi 的行为），
 * 走 classify → floor → fillSlots → plan → solver 全链，返回**到达求解器的实参**与答案文本。
 */
async function runQuery(opts: {
  intentKey: string; solverKey: string; view: string; query: string; extractedSlots: Record<string, unknown>;
}): Promise<RunOut> {
  const t = await createTestApp();
  t.deps.features.mock.set(TENANT, FEATURES);
  t.llm.queueClassification({
    candidates: [{ intentKey: opts.intentKey, confidence: 0.94 }],
    outOfCatalog: false,
    extractedSlots: opts.extractedSlots,
  });
  queueAnswers(t);
  const { taskId } = await submitQuery(t, ADMIN, opts.query, { view: opts.view, selectedObjects: [] });
  const invoked = spySolver(t);
  let task: QueryTask | undefined;
  try {
    task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED", "AWAITING_CLARIFICATION", "CANCELLED"].includes(x.status), 20000);
  } catch {
    /* 超时 → status 留 TIMEOUT，断言会红并打出来 */
  }
  await t.app.close();
  return {
    status: task?.status ?? "TIMEOUT",
    rounds: task?.clarificationRounds ?? -1,
    args: invoked.find((i) => i.key === opts.solverKey)?.args,
    answerText: JSON.stringify(task?.answer ?? {}),
    routed: task?.matchedIntent?.intentKey,
  };
}

describe("WO-DERIVED-INTENT-SLOT-DEAF §C · 差分门（实参层）：换实体 → 求解器实参必须跟着换", () => {
  /**
   * 逐条 = 「同一问句只换那个实体」。断言三件事：
   *   ① 用户说的实体**真的**到了求解器（不是写死值）；
   *   ② 两跑的实参**不同**（这正是改前恒相同的那一格）；
   *   ③ 终态仍是 COMPLETED + 零反问（加性没把好路径打坏）。
   */
  /** 实参里那一格的可读形态：objectRef 槽解析后是 `{objectType,objectId,label}`，取 label 比对。 */
  const seen = (v: unknown): string =>
    v !== null && typeof v === "object" ? String((v as { label?: string; objectId?: string }).label ?? (v as { objectId?: string }).objectId) : String(v);

  const CASES: { name: string; intentKey: string; solverKey: string; view: string; slot: string; a: { q: string; v: string }; b: { q: string; v: string } }[] = [
    {
      name: "S16 credit_check · 客户维（本仓唯一一个求解器真按它过滤的实体维）",
      intentKey: "credit_check", solverKey: "credit_exposure", view: "dash", slot: "custName",
      a: { q: "电网公司F 还能接新单吗？", v: "电网公司F" },
      b: { q: "商用车集团G 还能接新单吗？", v: "商用车集团G" },
    },
    {
      name: "S12 yield_diag · 基地维（写死的「常州」不该再顶掉用户说的另一个基地）",
      intentKey: "yield_diag", solverKey: "yield_diagnosis", view: "risk", slot: "base",
      a: { q: "常州涂布良率为什么掉了？", v: "常州" },
      b: { q: "合肥涂布良率为什么掉了？", v: "合肥" },
    },
    {
      name: "S11 changeover_opt · 产线维（写死的「常州·动力线-A」）",
      intentKey: "changeover_opt", solverKey: "changeover_sequence", view: "project", slot: "lineId",
      a: { q: "常州·动力线-A 下周订单怎么排能少换型？", v: "常州·动力线-A" },
      b: { q: "金华·储能线-B 下周订单怎么排能少换型？", v: "金华·储能线-B" },
    },
    {
      name: "S20 carbon_q · 基地维（写死的「成都」）",
      intentKey: "carbon_q", solverKey: "carbon_footprint", view: "dash", slot: "baseName",
      a: { q: "成都产的 4680-NCM 出口欧盟碳足迹达标吗？", v: "成都" },
      b: { q: "宜宾产的 4680-NCM 出口欧盟碳足迹达标吗？", v: "宜宾" },
    },
    {
      name: "S09 lta_gap_q · 物料维",
      intentKey: "lta_gap_q", solverKey: "lta_gap", view: "dash", slot: "material",
      a: { q: "7 月三元正极长协覆盖够吗？", v: "三元正极" },
      b: { q: "7 月磷酸铁锂长协覆盖够吗？", v: "磷酸铁锂" },
    },
    {
      name: "S08 kit_analysis · 时间窗维（⚠ 引擎半没有基地维——见工单 §6 遗留缺口）",
      intentKey: "kit_analysis", solverKey: "kit_readiness", view: "risk", slot: "toDay",
      a: { q: "未来 14 天哪些订单缺料开不了工？", v: "14" },
      b: { q: "未来 30 天哪些订单缺料开不了工？", v: "30" },
    },
  ];

  for (const c of CASES) {
    it(`${c.name}`, async () => {
      const A = await runQuery({ intentKey: c.intentKey, solverKey: c.solverKey, view: c.view, query: c.a.q, extractedSlots: { [c.slot]: c.a.v } });
      const B = await runQuery({ intentKey: c.intentKey, solverKey: c.solverKey, view: c.view, query: c.b.q, extractedSlots: { [c.slot]: c.b.v } });

      expect(A.args, `A 跑没到达 ${c.solverKey}（routed=${A.routed} status=${A.status}）`).toBeTruthy();
      expect(B.args, `B 跑没到达 ${c.solverKey}（routed=${B.routed} status=${B.status}）`).toBeTruthy();

      // ① 用户说的实体真的到了求解器（改前这里永远是写死值）
      expect(seen(A.args?.[c.slot]), `A 跑实参: ${JSON.stringify(A.args)}`).toBe(c.a.v);
      expect(seen(B.args?.[c.slot]), `B 跑实参: ${JSON.stringify(B.args)}`).toBe(c.b.v);
      // ② 差分：换实体 → 实参必须不同（这就是「答案逐字节相同」的病根那一格）
      expect(JSON.stringify(A.args)).not.toBe(JSON.stringify(B.args));
      // ③ 好路径没被打坏
      expect([A.status, B.status]).toEqual(["COMPLETED", "COMPLETED"]);
      expect([A.rounds, B.rounds]).toEqual([0, 0]);
    }, 40000);
  }
});

// ---------------------------------------------------------------------------
// §D 差分门 · 输出层（工单 §4.1「至少有一条断到输出真的不同」）
// ---------------------------------------------------------------------------

describe("WO-DERIVED-INTENT-SLOT-DEAF §D · 差分门（输出层）：答案本身必须跟着换", () => {
  /**
   * ⚠ **诚实边界**（工单 §4.2 的"哪条不可咬要写清"）：agentcore 测里的 DataCore 是 mock
   * （`mocks/clients.ts MockSolverClient`），对未特化的求解器返回 `{data:{solverKey,ok,args}}` —— 即**回显实参**。
   * 所以本门证明的是「实参差异**真的传导**到了渲染出的答案」（运输层 + 投影层），
   * **不能**证明 DataCore 真实求解器按该实参重算了业务结果（那是引擎半，跨 app 不可测·见工单 §6 遗留缺口清单）。
   * 选 `credit_check` 是因为它是 16 张里**唯一**一个真实求解器确按该实参过滤并会诚实报 `AMBIGUOUS_SCOPE` 的（
   * `apps/datacore/src/solvers/extended.ts:498-527`），故两半口径最接近。
   */
  it("S16 credit_check：换客户 → 渲染出的答案文本不同（改前两问答案逐字节相同）", async () => {
    const A = await runQuery({ intentKey: "credit_check", solverKey: "credit_exposure", view: "dash", query: "电网公司F 还能接新单吗？", extractedSlots: { custName: "电网公司F" } });
    const B = await runQuery({ intentKey: "credit_check", solverKey: "credit_exposure", view: "dash", query: "商用车集团G 还能接新单吗？", extractedSlots: { custName: "商用车集团G" } });
    expect(A.status).toBe("COMPLETED");
    expect(B.status).toBe("COMPLETED");
    expect(A.answerText).not.toBe(B.answerText);
    expect(A.answerText).toContain("电网公司F");
    expect(B.answerText).toContain("商用车集团G");
  }, 40000);
});

// ---------------------------------------------------------------------------
// §E 工单 §3.3 · 取不到就诚实缺，不许回落到写死的实体
// ---------------------------------------------------------------------------

describe("WO-DERIVED-INTENT-SLOT-DEAF §E · 用户给了但用不了 → 诚实缺席（不静默落回写死值）", () => {
  it("number 槽收到不可解析的值 → 落 null，**不是**目录里那个写死的数字", async () => {
    const { intents, plans } = seeded();
    const intent = intents.find((i) => i.key === "outsourcing_q")!; // gap:80000 / weeks:6
    const plan = plans.find((p) => p.key === "outsourcing_q")!;
    // 用户说了 weeks，但那个值不是数字 → 回落写死的 6 就是「我没听懂你说的，但我照旧答 6 周」
    const args = await resolvedArgs(intent, plan, { weeks: "很多" });
    expect(args.weeks).toBeNull();
    expect(args.gap).toBe(80000); // 用户没提 gap → 字面默认值照旧生效（加性）
  });

  /**
   * 工单 §3.3 的**原文情形**：「若某槽位用户给了、但解析不出对应对象（如基地名不认识），
   * 走已有的澄清/诚实缺席路径，不得静默回落到 preset 那个写死的实体 —— 回落就是把
   * 「我没听懂你说的枣庄」渲染成「枣庄的答案就是常州这份」。」
   */
  it("objectRef 槽：用户说了本租户不认识的基地 → 落 null（诚实缺席），**不是**回落到目录默认值", async () => {
    const { intents, plans } = seeded();
    const intent = intents.find((i) => i.key === "yield_diag")!;
    const plan = plans.find((p) => p.key === "yield_diag")!;
    // 桩里只有「常州」一个 Base；「火星基地」必然解析不到。
    const args = await resolvedArgs(intent, plan, { base: "火星基地" });
    expect(args.base, "解析不到却拿写死默认值冒充 = 本单要治的病换个地方犯").toBeNull();
  });

  it("用户没提这个槽 → 字面默认值生效（守卫只针对「给了但用不了」，不误伤零反问门）", async () => {
    const { intents, plans } = seeded();
    const intent = intents.find((i) => i.key === "yield_diag")!;
    const plan = plans.find((p) => p.key === "yield_diag")!;
    const args = await resolvedArgs(intent, plan, {});
    // §3.4 裁决后 base 已改中性默认（""=未指定）；字面默认值仍原样生效 —— 这条测的是**机制**，不是那个值。
    expect(args).toEqual({ processKey: "涂布", base: "" });
  });
});
