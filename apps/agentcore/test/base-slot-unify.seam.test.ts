import { describe, expect, it } from "vitest";
import { normalizeObjectRefKey } from "@platform/contracts";
import type { ObjectRef, QueryTask } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, debugHeaders, ADMIN, PLANNER, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedIntentsAndPlans } from "../src/mocks/seed.js";
import { deterministicSlotFloor } from "../src/router/l2-decompose.js";

/**
 * ★ WO-BASE-SLOT-UNIFY §E-1 / §E-4 / §D · **A 的接缝测**（数据半槽声明 × 引擎半解析·merge 态）。
 *
 * 治的病（`G-BASE-SLOT-TYPE-SPLIT`）：同一个「基地」概念在不同意图里被声明成两种槽类型 ——
 *   `risk_root_cause.base` / `adopt_mitigation.base` = `objectRef`（解析器覆盖）
 *   `capacity_feasibility.base` = `string`（**谁都不解析**·原文直甩 DataCore）
 * 于是真 Kimi 抽出 `base:"常州工厂"` 时 → `unknown base: 常州工厂` → 任务 FAILED；
 * 抽出 `base:"常州"` 时 → COMPLETED。**同一道题连跑 5 次 4 种结果**，靠的是骰子。
 *
 * ⚠ 断言落点（刻意·工单 §E-4）：**终态 `COMPLETED` + `clarificationRounds===0` + 到达 solver 的 base**，
 *    **不是 routedIntent** —— 上一轮 7 个失败**全部 routed 正确**，断言落路由就是假绿。
 *
 * 变异反证（工单 §E-1·须真跑真转红）：
 *   把 `seed.ts` 的 `capacity_feasibility.base` 改回 `{ type:"string" }`（去掉 refType）
 *   → 本文件「四写法」与「槽类型口径」两组当场转红：
 *     · 后缀/中文名写法到达 solver 的是**裸串**而非解析后的对象引用（口径没统一）；
 *     · 确定性底座（`FLOOR_RULES` 基地档只对 `objectRef` 生效）当场失效。
 */

const DEMO_FEATURES = [...defaultOnKeys(), "qos.dril-routing", "agent.critic", "agent.coordinator", "qos.compose-path"];

/** 工单 §E-1 指定的四种写法。前两种老代码也能过，后两种是真 Kimi 实测炸掉的「人话后缀」形态。 */
const SPELLINGS = ["常州", "changzhou", "常州基地", "常州工厂"] as const;

function queueAnswers(t: TestApp, n = 8): void {
  for (let i = 0; i < n; i++) {
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结论。" }], provenance: [] })] });
  }
}

/** 记录真正到达 DataCore 求解器的入参（接缝观测点：不看路由、看**谁真的收到了什么**）。 */
function spySolver(t: TestApp): { key: string; args: Record<string, unknown> }[] {
  const invoked: { key: string; args: Record<string, unknown> }[] = [];
  const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
  t.dataCore.solver.invoke = async (ctx, key, args) => {
    invoked.push({ key, args });
    return orig(ctx, key, args);
  };
  return invoked;
}

interface Outcome {
  status: string;
  rounds: number;
  slots: Record<string, unknown>;
  cfArgs?: Record<string, unknown>;
  pending: QueryTask["pendingClarification"];
  error?: unknown;
}

/**
 * 跑一条 `capacity_feasibility` 自由问句：LLM **原样交出用户写法**（真 Kimi 的行为），
 * 走 classify → harvest → floor → fillSlots → plan → solver 全链，返回**终态**与到达 solver 的入参。
 */
async function runSpelling(spelling: string): Promise<Outcome> {
  const t = await createTestApp();
  t.deps.features.mock.set(TENANT, DEMO_FEATURES);
  t.llm.queueClassification({
    candidates: [{ intentKey: "capacity_feasibility", confidence: 0.93 }],
    outOfCatalog: false,
    // ★ 真 Kimi 就是把用户原话原样交出来的（这正是 `unknown base: 常州工厂` 的来路）。
    extractedSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6, base: spelling },
  });
  queueAnswers(t);
  const { taskId } = await submitQuery(t, ADMIN, `${spelling} 4680-NCM 加 20% 六周能不能接？`, { view: "project", selectedObjects: [] });
  const invoked = spySolver(t);
  let task: QueryTask | undefined;
  try {
    task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED", "AWAITING_CLARIFICATION", "CANCELLED"].includes(x.status), 25000);
  } catch {
    /* 超时 → status 留 TIMEOUT，断言会红并打出来 */
  }
  await t.app.close();
  return {
    status: task?.status ?? "TIMEOUT",
    rounds: task?.clarificationRounds ?? -1,
    slots: task?.slots ?? {},
    cfArgs: invoked.find((i) => i.key === "capacity_forecast")?.args,
    pending: task?.pendingClarification,
    error: task?.error,
  };
}

describe("WO-BASE-SLOT-UNIFY §E-1 · capacity_feasibility 四种基地写法 → 全部 COMPLETED 且 DataCore 收到同一个 base", () => {
  it("★ 命门：常州 / changzhou / 常州基地 / 常州工厂 —— 终态全 COMPLETED·零反问·base 归一后全等", async () => {
    const rows: string[] = [];
    const bad: string[] = [];
    const canonical: string[] = [];
    // 逐条**先全跑完再断言**：变异反证时要能一眼看见哪几条一起红，而不是在第一条就中断。
    for (const s of SPELLINGS) {
      const o = await runSpelling(s);
      const base = o.slots.base as ObjectRef | undefined;
      const argBase = o.cfArgs?.base;
      const norm = normalizeObjectRefKey(argBase, "Base");
      canonical.push(norm);
      rows.push(
        `  写法「${s}」 status=${o.status} rounds=${o.rounds} slots.base=${JSON.stringify(base)} ` +
          `→ solver args.base=${JSON.stringify(argBase)} 归一=${norm}` +
          (o.status !== "COMPLETED" ? ` error=${JSON.stringify(o.error)} pending=${JSON.stringify(o.pending?.slots?.map((x) => x.name))}` : ""),
      );
      if (`${o.status}/rounds=${o.rounds}` !== "COMPLETED/rounds=0") bad.push(`「${s}」终态=${o.status}/rounds=${o.rounds}`);
      if (typeof base !== "object" || base === null) bad.push(`「${s}」slots.base 不是解析后的对象引用：${JSON.stringify(base)}`);
      if (base?.objectType !== "Base") bad.push(`「${s}」slots.base.objectType=${base?.objectType}`);
      if (norm !== "changzhou") bad.push(`「${s}」到达 solver 的 base 归一后=${norm}（应为 changzhou）`);
    }
    console.log("\n  ── §E-1 四写法端到端（断言落终态·非 routedIntent）──\n" + rows.join("\n"));
    expect(bad).toEqual([]);
    // DataCore 侧收到的是**同一个** base（四条归一后完全一致）。
    expect(new Set(canonical).size, `四写法应收敛到同一 base，实得 ${JSON.stringify(canonical)}`).toBe(1);
  }, 180_000);

  it("不指定基地的全网问句仍 COMPLETED（别把「治后缀」治成「必须给基地」·守 {{slots.base}} 的 null 直通语义）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, DEMO_FEATURES);
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.93 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6 },
    });
    queueAnswers(t);
    const { taskId } = await submitQuery(t, ADMIN, "4680-NCM 加 20% 六周能不能接？", { view: "project", selectedObjects: [] });
    const invoked = spySolver(t);
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED", "AWAITING_CLARIFICATION"].includes(x.status), 25000);
    const cf = invoked.find((i) => i.key === "capacity_forecast");
    await t.app.close();
    console.log(`\n  ── §E-1 无基地（全网）──\n  status=${task.status} rounds=${task.clarificationRounds} slots.base=${JSON.stringify(task.slots?.base)} args.base=${JSON.stringify(cf?.args.base)} error=${JSON.stringify(task.error)}`);
    // ★ 这条守的是一个**很容易被引入的新失败**：若计划模板写成 `{{slots.base.objectId}}`，
    //   可选槽落空时 slots.base=null → jsonpath 返 undefined → TemplateResolutionError → 任务 FAILED。
    expect(`${task.status}/rounds=${task.clarificationRounds}`).toBe("COMPLETED/rounds=0");
    expect(task.slots?.base).toBe(null);
    expect(cf?.args.base == null, `无基地时 solver 应收到 null（全网 scope:ALL），实得 ${JSON.stringify(cf?.args.base)}`).toBe(true);
  }, 120_000);

  it("语义真达成（非「参数到达了就算通」）：带基地 vs 全网 P50 必须不同", async () => {
    const withBase = await runSpelling("常州工厂");
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, DEMO_FEATURES);
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.93 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6 },
    });
    queueAnswers(t);
    const { taskId } = await submitQuery(t, ADMIN, "4680-NCM 加 20% 六周能不能接？", { view: "project", selectedObjects: [] });
    const invoked = spySolver(t);
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 25000);
    const netArgs = invoked.find((i) => i.key === "capacity_forecast")?.args;
    const net = await t.dataCore.solver.invoke({ tenantId: TENANT, userId: "u", roles: ["admin"] } as never, "capacity_forecast", netArgs!);
    const scoped = await t.dataCore.solver.invoke({ tenantId: TENANT, userId: "u", roles: ["admin"] } as never, "capacity_forecast", withBase.cfArgs!);
    await t.app.close();
    const netP50 = (net.data as { p50: number }).p50;
    const scopedP50 = (scoped.data as { p50: number }).p50;
    console.log(`\n  ── §E-1 语义真达成 ──\n  「常州工厂」p50=${scopedP50}  vs  全网 p50=${netP50}`);
    // 相同 = base 到了但没起作用（假绿温床·mock 无视 object ref 时就是这样）。
    expect(scopedP50).not.toBe(netP50);
    expect(scopedP50).toBeLessThan(netP50);
    // ★ 且必须是**真基地的真产能**，不是「解析不到 → 一个基地都没匹上 → 0」的幽灵零：
    //   槽口径退回 string 时这里实测就是 p50=0（不同 ≠ 对，"不同"能被一个错答蒙混过去）。
    expect(scopedP50, "常州应有真实产能（0 = 谁都没匹上的幽灵零，不是收窄）").toBeGreaterThan(0);
  }, 180_000);
});

describe("WO-BASE-SLOT-UNIFY §A · 全意图 base 槽口径统一（数据半·纯函数直测·零数据依赖）", () => {
  it("★ 单值 base 语义槽一律 objectRef+refType:Base；数组维（baseIds/scopeObjectIds）保持 json", () => {
    const { intents } = seedIntentsAndPlans("demo");
    const found: string[] = [];
    const bad: string[] = [];
    for (const i of intents) {
      for (const s of i.slots ?? []) {
        if (!/base|基地/i.test(s.name) && !/基地/.test(s.description ?? "")) continue;
        found.push(`${i.key}.${s.name}:${s.type}${s.refType ? `(${s.refType})` : ""}`);
        const plural = s.name.endsWith("s") || s.name === "scopeObjectIds"; // 数组维（objectRef 是单值·塞不下）
        if (plural) {
          if (s.type !== "json") bad.push(`${i.key}.${s.name} 是数组维，应为 json，实得 ${s.type}`);
          continue;
        }
        if (s.type !== "objectRef") bad.push(`${i.key}.${s.name} 语义是基地却不是 objectRef（实得 ${s.type}）—— G-BASE-SLOT-TYPE-SPLIT 回潮`);
        if (s.refType !== "Base") bad.push(`${i.key}.${s.name} 缺 refType:"Base"（实得 ${s.refType}）`);
      }
    }
    console.log("\n  ── §A 全意图 base 槽扫描 ──\n  " + found.join("\n  "));
    expect(bad).toEqual([]);
    // 扫描面锁死：少了任何一个都说明种子被改瘦了（或槽名换了形态没被这条规则罩住）。
    //
    // ★ 金值更新（WO-DERIVED-INTENT-SLOT-DEAF·`G-DERIVED-INTENT-SLOT-DEAF`）：`SCENARIO_CATALOG`
    //   派生的 16 个意图此前一律 `slots: []`（= 用户实体无处可落·静默错答），本单从卡已声明的求解器
    //   入参派生槽位后，其中两个基地语义键进入本门扫描面 —— 且**按本门的规则**声明成 objectRef+Base：
    //     · `yield_diag.base`（S12·原写死 `"常州"`）
    //     · `carbon_q.baseName`（S20·原写死 `"成都"`）
    //   新增而非放宽：本门的判据一字未改，只是被罩住的槽多了两个（漏更金值即退，见 CLAUDE.md「金值即更」）。
    expect(found.sort()).toEqual([
      "adopt_mitigation.base:objectRef(Base)",
      "affected_orders.base:objectRef(Base)",
      "capacity_feasibility.base:objectRef(Base)",
      "carbon_q.baseName:objectRef(Base)",
      "ceo_base_outlook.baseId:objectRef(Base)",
      "ceo_bottleneck.baseIds:json",
      "ceo_whatif.scopeObjectIds:json",
      "order_deep_360.base:objectRef(Base)",
      "risk_root_cause.base:objectRef(Base)",
      "yield_diag.base:objectRef(Base)",
    ]);
  });

  it("口径统一的连带收益：确定性底座（FLOOR_RULES 基地档只对 objectRef 生效）开始兜 capacity_feasibility.base", () => {
    const { intents } = seedIntentsAndPlans("demo");
    const cf = intents.find((i) => i.key === "capacity_feasibility")!;
    // ★ 槽是 string 时这条恒为 {} —— 底座压根不看它（第二张网从来没张开过）。
    expect(deterministicSlotFloor("常州工厂 4680-NCM 加 20% 六周能不能接？", cf)).toEqual({
      base: "changzhou",
      model: "4680-NCM",
      demandDelta: 0.2,
      weeks: 6,
    });
    // 诚实：问句里没有基地就不抽（不推断·不默认）。
    expect(deterministicSlotFloor("4680-NCM 加 20% 六周能不能接？", cf).base).toBeUndefined();
  });

  it("计划模板保持 whole-slot {{slots.base}}（可选槽 null 直通·不是 {{slots.base.objectId}}）", () => {
    const { intents, plans } = seedIntentsAndPlans("demo");
    const cf = intents.find((i) => i.key === "capacity_feasibility")!;
    const plan = plans.find((p) => p.id === cf.planId)!;
    const args = JSON.stringify(plan.steps.find((s) => s.type === "invoke_solver")?.params?.args ?? {});
    expect(args).toContain("{{slots.base}}");
    // 多段路径在 base=null 时会抛 TemplateResolutionError（jsonpath.ts:12 → template.ts:46）→ 任务 FAILED。
    expect(args).not.toContain("{{slots.base.objectId}}");
  });
});

/**
 * §D · 已裁定的豁免题：「采纳常州的三班制方案」用户**没说**针对哪个风险因子，
 * 系统问一句本来就是对的（`adopt_mitigation.factor` 是 `required:true`·#109 已裁定）。
 * 达标判据 = **一次澄清 + 用户回答后能完成**，断言落在**回答之后的终态**。
 */
describe("WO-BASE-SLOT-UNIFY §D · 豁免题：澄清 → 用户回答 → COMPLETED（断言落回答后的终态）", () => {
  it("★ 「采纳常州工厂的三班制方案」→ 问 factor → 答「物料齐套」→ COMPLETED（base 用后缀写法也不许多问一句）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, DEMO_FEATURES);
    t.llm.queueClassification({
      candidates: [{ intentKey: "adopt_mitigation", confidence: 0.95 }],
      outOfCatalog: false,
      // base 给**后缀写法**（真 Kimi 行为）；solutionName 给全；factor 用户确实没说 → 系统该问的就这一个。
      extractedSlots: { base: "常州工厂", solutionName: "三班制" },
    });
    queueAnswers(t);

    const { taskId } = await submitQuery(t, PLANNER, "采纳常州工厂的三班制方案", { view: "risk", selectedObjects: [] });
    const t1 = await waitForTask(t, taskId, (x) => ["AWAITING_CLARIFICATION", "COMPLETED", "FAILED"].includes(x.status), 25000);
    console.log(
      `\n  ── §D 澄清轮 ──\n  status=${t1.status} rounds=${t1.clarificationRounds} ` +
        `问的槽=${JSON.stringify(t1.pendingClarification?.slots?.map((s) => s.name))} slots.base=${JSON.stringify(t1.slots?.base)}`,
    );
    expect(t1.status).toBe("AWAITING_CLARIFICATION");
    // ★ 只该问 factor 一个：base 用后缀写法也必须已经解析好了（否则就是"多问一句"= 本单没治好）。
    expect(t1.pendingClarification?.slots?.map((s) => s.name)).toEqual(["factor"]);

    const reply = await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/clarification`,
      headers: debugHeaders(PLANNER),
      payload: { kind: "SLOT_FILLING", slotValues: { factor: "物料齐套" } },
    });
    expect(reply.statusCode).toBe(202);

    const t2 = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status), 25000);
    const base = t2.slots?.base as ObjectRef | undefined;
    console.log(`  ── §D 回答之后 ──\n  status=${t2.status} rounds=${t2.clarificationRounds} slots.base=${JSON.stringify(base)} slots.factor=${JSON.stringify(t2.slots?.factor)} error=${JSON.stringify(t2.error)}`);
    await t.app.close();

    // ★ 断言落**回答之后的终态**（工单 §D 明文），不是落"问出来了"。
    expect(t2.status).toBe("COMPLETED");
    expect(t2.slots?.factor).toBe("物料齐套");
    expect(base?.objectType).toBe("Base");
    expect(normalizeObjectRefKey(base, "Base")).toBe("changzhou");
  }, 180_000);
});
