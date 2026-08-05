import { describe, expect, it } from "vitest";
import type { ObjectRef, QueryTask } from "@platform/contracts";
import { identifyingProps, matchObjectRefInType, normalizeObjectRefKey, pickObjectRefResolution } from "@platform/contracts";
import { createTestApp, ADMIN, PKG, TENANT, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { fillSlots } from "../src/router/slots.js";
import type { OntologyClient, ToolAuthCtx } from "../src/tools/clients.js";

/**
 * WO-SLOT-ENTITY-RESOLVE · 「实体文本 → 对象引用」跨接缝 SEAM-GATE
 * （数据半 = A 侧本体元数据/对象行 × 引擎半 = B 侧槽位填充/编排；任一半漏即红）。
 *
 * 治的病（真绑 Kimi 实测·35 题 10 题停在 AWAITING_CLARIFICATION）：
 *   task.extractedSlots = {"base":"常州","day":"D+5","factor":"物料齐套"}  ← **三个槽全抽到了**
 *   task.status         = AWAITING_CLARIFICATION                          ← **系统还在反问**
 * 病根不在抽取，在抽完之后：`slots.ts` objectRef 裸串分支逐个已发布类型调
 * `ontology.getObject(type, "常州")` —— 那是**按 objectId/主键**查。亲手复验（datacore 真种子）：
 *   getObject(Base,常州)→404 · getObject(Base,changzhou)→200 · getObject(Base,obj_base_changzhou)→200
 * 全类型试完必 404 ⇒ `{ok:false,outOfDomain:true}` ⇒ required 槽判 missing ⇒ 反问。
 *
 * ⚠ 断言落点（刻意）：**槽位填充结果 + 最终 status**，不是「路由到哪个意图」。
 * 本仓的措辞门 `scenario-phrasing-seam.test.ts:110` 只断言 `routedIntent`，
 * 这个病 **路由是对的**（risk_root_cause 分毫不差），所以从那道门底下整条溜过去了。
 *
 * 变异反证（复审可照做，两条都亲手验过会红）：
 *   ① `packages/contracts/src/object-ref-resolve.ts` 的 `identifyingProps` 去掉 name/alias 两层
 *      （= 退回「只按 id 查」）→ 本文件 ①②③ 全红（COMPLETED→AWAITING_CLARIFICATION）。
 *   ② `pickObjectRefResolution` 不再回 matchedBy/matchedProp，或 `matchObjectRefInType` 不再回 attempt
 *      → ④⑤ 红（matchedBy 断言 + 失败诊断断言）。
 */

const DEMO_PROD_FEATURES = [...defaultOnKeys(), "qos.dril-routing", "agent.critic", "agent.coordinator", "qos.compose-path"];

/** 仓主实测的真 LLM 抽取值（mock 喂同一份；本门不考核 LLM，只考核"抽到了之后系统干了什么"）。 */
interface Case {
  no: string;
  query: string;
  view: string;
  intentKey: string;
  extractedSlots: Record<string, unknown>;
  /** 期望被解析成对象引用的槽 → 期望 objectType。 */
  expectRefSlots: Record<string, string>;
}

const SEAM_CASES: Case[] = [
  {
    no: "1",
    query: "常州物料齐套 D+5 为什么越线？",
    view: "risk",
    intentKey: "risk_root_cause",
    extractedSlots: { base: "常州", day: "D+5", factor: "物料齐套" },
    expectRefSlots: { base: "Base" },
  },
  {
    no: "2",
    query: "常州基地影响哪些订单？",
    view: "risk",
    intentKey: "affected_orders",
    extractedSlots: { base: "常州" },
    expectRefSlots: { base: "Base" },
  },
  {
    no: "3",
    query: "4680-NCM 加 20% 常州基地六周能不能交付？",
    view: "dash",
    intentKey: "capacity_feasibility",
    // 多类型判据：model 是**非基地** objectRef 槽，与 base 同走一支代码（只修基地 = 打补丁）。
    extractedSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6, base: "常州" },
    expectRefSlots: { model: "Model" },
  },
  {
    no: "4",
    query: "常州工厂的齐套张力为啥突然冲高",
    view: "risk",
    intentKey: "risk_root_cause",
    extractedSlots: { base: "常州", factor: "物料齐套" },
    expectRefSlots: { base: "Base" },
  },
  {
    no: "5",
    query: "是什么把常州物料齐套顶过阈值的",
    view: "risk",
    intentKey: "risk_root_cause",
    extractedSlots: { base: "常州", factor: "物料齐套" },
    expectRefSlots: { base: "Base" },
  },
];

interface Outcome {
  c: Case;
  status: string;
  rounds: number;
  slots: Record<string, unknown>;
  resolutions: QueryTask["slotResolutions"];
  pending: QueryTask["pendingClarification"];
}

async function runOne(c: Case): Promise<Outcome> {
  const t: TestApp = await createTestApp();
  t.deps.features.mock.set(TENANT, DEMO_PROD_FEATURES);
  t.llm.queueClassification({
    candidates: [{ intentKey: c.intentKey, confidence: 0.95 }],
    outOfCatalog: false,
    extractedSlots: c.extractedSlots,
  });
  for (let i = 0; i < 8; i++) {
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结论。" }], provenance: [] })] });
  }
  const r = await submitQuery(t, ADMIN, c.query, { view: c.view });
  let task: QueryTask | undefined;
  try {
    task = await waitForTask(t, r.taskId, (x) => ["COMPLETED", "FAILED", "AWAITING_CLARIFICATION", "CANCELLED"].includes(x.status), 25000);
  } catch {
    /* timeout → status 留空，下面断言会红并打出来 */
  }
  await t.app.close();
  return {
    c,
    status: task?.status ?? "TIMEOUT",
    rounds: task?.clarificationRounds ?? -1,
    slots: task?.slots ?? {},
    resolutions: task?.slotResolutions,
    pending: task?.pendingClarification,
  };
}

describe("WO-SLOT-ENTITY-RESOLVE · ① SEAM 头号：中文名实体填得进 objectRef 槽 → 5 题全 COMPLETED 且零反问", () => {
  it("5 题 status=COMPLETED · clarificationRounds=0 · objectRef 槽真解析成对象引用（不是原样裸串）", async () => {
    const results: Outcome[] = [];
    for (const c of SEAM_CASES) results.push(await runOne(c));

    const bad = results.filter((r) => r.status !== "COMPLETED" || r.rounds !== 0);
    console.log(
      "\n  ── 槽位实体解析基线（断在填充结果+status，不在 routedIntent）──\n" +
        results
          .map(
            (r) =>
              `  ${r.c.no} ${r.status.padEnd(22)} rounds=${r.rounds} ` +
              `slots=${JSON.stringify(Object.fromEntries(Object.keys(r.c.expectRefSlots).map((k) => [k, r.slots[k]])))} ` +
              `matchedBy=${JSON.stringify((r.resolutions ?? []).map((x) => `${x.slotName}:${x.matchedBy}(${x.matchedProp})`))}` +
              (r.pending ? ` pending=${JSON.stringify(r.pending.slots?.map((s) => s.name))}` : ""),
          )
          .join("\n"),
    );

    expect(bad.map((r) => `${r.c.no}「${r.c.query}」→ ${r.status} rounds=${r.rounds} pending=${JSON.stringify(r.pending)}`)).toEqual([]);

    // ★ 命门：槽位里躺的必须是**解析后的对象引用**（objectType+objectId），不是原样裸串「常州」。
    for (const r of results) {
      for (const [slotName, expectType] of Object.entries(r.c.expectRefSlots)) {
        const v = r.slots[slotName] as ObjectRef | undefined;
        expect(typeof v, `#${r.c.no} 槽 ${slotName} 应是对象引用而非裸串（实得 ${JSON.stringify(v)}）`).toBe("object");
        expect(v?.objectType, `#${r.c.no} 槽 ${slotName} 的 objectType`).toBe(expectType);
        expect(String(v?.objectId ?? ""), `#${r.c.no} 槽 ${slotName} 的 objectId 不得为空`).not.toBe("");
      }
    }
  }, 300_000);
});

describe("WO-SLOT-ENTITY-RESOLVE · ② 多类型判据：非基地 objectRef 槽同样修好（证明不是只修基地）", () => {
  it("Model 槽（capacity_feasibility.model）用型号名解析成 Model 引用，与 base 走同一支代码", async () => {
    const r = await runOne(SEAM_CASES[2]!);
    expect(r.status).toBe("COMPLETED");
    expect(r.rounds).toBe(0);
    const model = r.slots.model as ObjectRef;
    expect(model.objectType).toBe("Model");
    // 解析留痕存在 = 走的是新正门（老路 getObject 循环不产生 matchedBy）。
    expect((r.resolutions ?? []).map((x) => x.slotName)).toContain("model");
  }, 120_000);
});

describe("WO-SLOT-ENTITY-RESOLVE · ③ matchedBy 可诊断：能看出「常州」是怎么匹上 Base 的", () => {
  it("base 槽解析留痕 matchedBy=name · matchedProp=name（不是 id —— 中文名本来就不是主键）", async () => {
    const r = await runOne(SEAM_CASES[0]!);
    const base = (r.resolutions ?? []).find((x) => x.slotName === "base");
    expect(base, "base 槽必须有解析留痕（matchedBy 缺失 = 不可诊断 = 退单）").toBeDefined();
    expect(base?.ref).toBe("常州");
    expect(base?.objectType).toBe("Base");
    expect(base?.matchedBy).toBe("name");
    expect(base?.matchedProp).toBe("name");
  }, 120_000);
});

/**
 * ④ 解析失败时的**诚实 + 可诊断**：真域外实体不许被静默兜底成"解析到了"，
 * 且必须带上「试了哪些类型、归一后用什么键、比对了哪些属性、为什么不匹」。
 */
describe("WO-SLOT-ENTITY-RESOLVE · ④ 域外实体：诚实反问 + 失败诊断齐全（不静默兜底）", () => {
  it("「火星基地」解析不到 → 仍反问，且 fillSlots 回的 outOfDomain 带 attempts（试过的类型/键/属性/原因）", async () => {
    const t = await createTestApp();
    const intent = (await t.repos.intents.listByPackage(PKG)).find((i) => i.key === "risk_root_cause")!;
    const ctx: ToolAuthCtx = { tenantId: TENANT, userId: "admin", roles: ["admin"] };
    const res = await fillSlots(
      intent,
      { base: "火星基地" },
      { view: "risk", selectedObjects: [], filters: {} },
      t.deps.dataCore.ontology as unknown as OntologyClient,
      ctx,
    );
    await t.app.close();

    expect(res.missing.map((m) => m.name)).toContain("base"); // 诚实：解析不到就是解析不到
    const ood = res.outOfDomain.find((o) => o.slotName === "base");
    expect(ood, "域外信号必须发出").toBeDefined();
    // ★ 命门：诊断信息齐全 —— 没有它，下一个人还得像这次一样从一个 404 一路反推回槽位填充。
    const attempts = ood?.resolution?.attempts ?? [];
    expect(attempts.length, "attempts 不得为空（试了哪些类型）").toBeGreaterThan(0);
    expect(attempts[0]!.keysTried.length, "keysTried 不得为空（归一后用什么键去查）").toBeGreaterThan(0);
    expect(attempts[0]!.propsTried.length, "propsTried 不得为空（比对了哪些属性）").toBeGreaterThan(0);
    expect(attempts.every((a) => typeof a.reason === "string" && a.reason.length > 0), "每条 attempt 必须说明为什么不匹").toBe(true);
    expect(ood?.resolution?.resolved).toBe(false);
  }, 60_000);
});

/**
 * ⑤ 纯函数直测（**不许靠数据巧合变绿**）：解析规则是纯的、单一出处的，
 * 这里不经任何 mock 数据、直接把行喂给 contracts 核心。本仓刚发生过「变异没红，
 * 因为 demo 数据恰好让次序键把它压到底」——所以规则本身必须有不依赖种子的直测。
 */
describe("WO-SLOT-ENTITY-RESOLVE · ⑤ 解析规则纯函数直测（零数据依赖）", () => {
  const baseType = {
    key: "Base",
    properties: [
      { propKey: "baseId", isPrimaryKey: true },
      { propKey: "name" },
      { propKey: "factory_code", searchable: true },
      { propKey: "province" }, // 非标识属性：不参与匹配（否则「江苏」会匹到基地）
    ],
  };
  const rows = [
    { id: "obj_base_changzhou", props: { baseId: "changzhou", name: "常州", factory_code: "CH01", province: "江苏" } },
    { id: "obj_base_chengdu", props: { baseId: "chengdu", name: "成都", factory_code: "CH01", province: "四川" } },
  ];
  const resolve = (ref: unknown, accept?: ("id" | "name" | "alias")[]) => {
    const { hits, attempt } = matchObjectRefInType({ ref, objectType: "Base", typeDef: baseType, rows, ...(accept ? { accept } : {}) });
    return pickObjectRefResolution(ref, hits, [attempt]);
  };

  it("可识别属性完全由 ObjectTypeDef 元数据派生（零业务常数 R14：没有任何中文名→id 词表）", () => {
    expect(identifyingProps(baseType)).toEqual([
      { propKey: "baseId", matchedBy: "id" },
      { propKey: "name", matchedBy: "name" },
      { propKey: "factory_code", matchedBy: "alias" },
    ]);
    // province 未被声明为 searchable、也不是名称类 → 不参与匹配（「江苏」不该解析成基地）。
    expect(resolve("江苏").resolved).toBe(false);
  });

  it("四形态同一基地：中文名 / 拼音主键 / obj_base_<id> / obj_base_<中文名>（归一单一出处，非映射表）", () => {
    expect(normalizeObjectRefKey("obj_base_changzhou", "Base")).toBe("changzhou");
    expect(normalizeObjectRefKey("base_changzhou", "Base")).toBe("changzhou");
    for (const ref of ["常州", "changzhou", "obj_base_changzhou", "obj_base_常州"]) {
      const r = resolve(ref);
      expect(r.resolved, `${ref} 应解析成功`).toBe(true);
      expect(r.objectId, `${ref} 应归到同一基地`).toBe("changzhou");
    }
    expect(resolve("常州").matchedBy).toBe("name");
    expect(resolve("changzhou").matchedBy).toBe("id");
  });

  it("`accept:[\"id\"]` = 老 getObject 语义：中文名解析不到（这正是病根形态，故意留成可复现的对照）", () => {
    expect(resolve("常州", ["id"]).resolved).toBe(false);
    expect(resolve("changzhou", ["id"]).resolved).toBe(true);
  });

  it("同层级命中多个不同对象 → ambiguous 诚实上报，绝不静默取第一个", () => {
    const r = resolve("CH01"); // 常州/成都 factory_code 都是 CH01
    expect(r.resolved).toBe(false);
    expect(r.ambiguous).toBe(true);
    expect((r.candidates ?? []).map((c) => c.objectId).sort()).toEqual(["changzhou", "chengdu"]);
  });

  it("解析失败必带诊断：keysTried / propsTried / rowsScanned / reason", () => {
    const r = resolve("火星");
    expect(r.resolved).toBe(false);
    const a = (r.attempts ?? [])[0]!;
    expect(a.objectType).toBe("Base");
    expect(a.keysTried).toEqual(["火星"]);
    expect(a.propsTried).toEqual(["__id:id", "baseId:id", "name:name", "factory_code:alias"]);
    expect(a.rowsScanned).toBe(2);
    expect(a.reason).toBe("NO_MATCH");
  });
});
