import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";
import { checkedTree, factHits, readRepo, stripComments } from "./factlock.js";
import type { AuthCtx, ObjectInstance } from "../src/domain.js";
import { refTypeDefFromRows, resolveBaseRef } from "../src/solvers/types.js";

/**
 * ★ WO-BASE-SLOT-UNIFY §E-2 · **A 的引擎半独立测**（`G-BASE-SLOT-TYPE-SPLIT` 引擎侧）。
 *
 * 治的病（真 Kimi 实测原文）：
 *   "error": "DataCore POST /a/v1/solvers/capacity_forecast/invoke -> 400
 *             {\"code\":\"VALIDATION_ERROR\",\"message\":\"unknown base: 常州工厂\"}"
 *   老 `risk.resolveBaseId` 只做 `props.baseId===key || props.name===key` **精确**比对，
 *   而 `BASE_REGISTRY` 里规范名是**裸「常州」** → 用户嘴里的「常州工厂/常州基地」一个都对不上。
 *
 * 为什么引擎半必须独立成门（不能只改 AgentCore 的槽类型）：
 *   **agent 工具直调（`sim_*` / DRIL / REST 直调）不经槽位层** —— 那条路上 DataCore 收到的就是用户原话。
 *   只改数据半，这条路照旧 400。
 *
 * 单一出处判据（本门也咬）：DataCore 侧**不许有第三套中文名匹配** ——
 *   `types.resolveBaseRef` 全部委托 contracts `matchObjectRefInType`，本仓零「中文名→id」词表（R14）。
 *
 * 变异反证（工单 §E-2·须真跑真转红）：
 *   把 `risk.ts resolveBaseId` 改回自己那套
 *     `const b = c.bases.find(x => x.props.baseId===key || x.props.name===key)`
 *   → 本文件「后缀写法」相关断言当场转红，裸「常州」/`changzhou` 仍绿
 *   （证明红的正是 partial 那一档，不是测试写歪了）。
 */

const CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type Cap = { p50: number; scope?: string; scopeBaseId?: string; scopeBaseName?: string; perBaseRows?: unknown[] };

/** 工单 §E 指定的四种写法（后两种是老代码必炸的「人话后缀」形态）。 */
const spellingsFor = (baseId: string, cnName: string): { label: string; ref: string }[] => [
  { label: "裸 baseId", ref: baseId },
  { label: "中文规范名", ref: cnName },
  { label: "中文名+基地", ref: `${cnName}基地` },
  { label: "中文名+工厂", ref: `${cnName}工厂` },
];

// 一份 app / 一次合成种子供全文件复用（seedBattery 很重，逐 it 重建会把 4 核机器拖垮）。
let t: TestApp;
let bases: ObjectInstance[];
let models: ObjectInstance[];
/** 认证 ≥2 基地的型号（全网 sum > 单基地 → "收窄真发生了"判得出来·不靠数据巧合）。 */
let modelId = "";
let netP50 = 0;
let targetBaseId = "";
let cnName = "";

beforeAll(async () => {
  t = await makeApp();
  await seedBattery(t);
  bases = await t.repos.objects.listByType("demo", "Base");
  models = await t.repos.objects.listByType("demo", "Model");
  for (const m of models) {
    const mid = String(m.props.modelId);
    const net = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId: mid, demandDelta: 0.2 })) as Cap;
    const rows = (net.perBaseRows ?? []) as { baseId: string }[];
    if (rows.length >= 2 && (net.p50 ?? 0) > 0) {
      modelId = mid;
      netP50 = net.p50;
      targetBaseId = rows[0]!.baseId;
      break;
    }
  }
  cnName = String(bases.find((b) => String(b.props.baseId) === targetBaseId)!.props.name);
}, 180_000);

describe("WO-BASE-SLOT-UNIFY §E-2 · capacity_forecast 直调：四种写法 → 同一个 base（引擎半·不经槽位层）", () => {
  it("★ 命门：<名>/<baseId>/<名>基地/<名>工厂 四写法 scopeBaseId 与 p50 全等；且都不是全网", async () => {
    expect(modelId, "需一个认证≥2基地的型号做全网 vs 单基地对比").not.toBe("");
    const got: Record<string, Cap> = {};
    const lines: string[] = [];
    for (const s of spellingsFor(targetBaseId, cnName)) {
      const out = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2, base: s.ref })) as Cap;
      got[s.ref] = out;
      lines.push(`  ${s.label.padEnd(12)} base="${s.ref}" → scope=${out.scope} scopeBaseId=${out.scopeBaseId} p50=${out.p50}`);
    }
    console.log(`\n  ── §E-2 引擎半四写法（modelId=${modelId} 全网 p50=${netP50}）──\n${lines.join("\n")}`);

    const ref0 = got[targetBaseId]!;
    for (const s of spellingsFor(targetBaseId, cnName)) {
      const out = got[s.ref]!;
      // ★ 命门：后缀写法此前 400 unknown base；现四写法全部收敛到同一个 base。
      expect(out.scope, `${s.label}「${s.ref}」应 scope=BASE`).toBe("BASE");
      expect(out.scopeBaseId, `${s.label}「${s.ref}」应解析到同一 baseId`).toBe(targetBaseId);
      expect(out.p50, `${s.label}「${s.ref}」p50 应与裸 baseId 写法字节一致`).toBe(ref0.p50);
      expect((out.perBaseRows ?? []).length).toBe(1);
    }
    // 收窄真发生了（否则四写法"全等"可能只是因为四条都退回了全网 = 假绿）。
    expect(ref0.p50).toBeLessThan(netP50);
  }, 120_000);

  it("REST 直调（/a/v1/solvers/capacity_forecast/invoke）四写法同 200 同 scopeBaseId —— agent 工具直调走的就是这条", async () => {
    const seen: string[] = [];
    const codes: number[] = [];
    for (const s of spellingsFor(targetBaseId, cnName)) {
      const res = await invokeSolver(t, "capacity_forecast", { modelId, demandDelta: 0.2, base: s.ref }, ADMIN);
      codes.push(res.statusCode);
      expect(res.statusCode, `REST base="${s.ref}" 应 200（此前后缀写法 400 unknown base），实得 ${res.body.slice(0, 200)}`).toBe(200);
      seen.push(String((JSON.parse(res.body).data as Cap).scopeBaseId));
    }
    console.log(`\n  ── §E-2 REST 直调 ──\n  statusCodes=${JSON.stringify(codes)} scopeBaseIds=${JSON.stringify(seen)}`);
    expect(new Set(seen).size, `四写法应收敛到同一 base，实得 ${JSON.stringify(seen)}`).toBe(1);
    expect(seen[0]).toBe(targetBaseId);
  }, 120_000);

  it("AgentCore 计划整槽透传的 **object ref** 形态 `{objectType,objectId,label}` 也认（两半闭合的接缝点）", async () => {
    const byStr = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2, base: targetBaseId })) as Cap;
    // ★ 命门（`capacity.ts hasBase`）：旧判据 `str(args.base)!==""` 对**对象**返 ""，
    //    → hasBase=false → base 被静默丢、悄悄退回全网（比 400 更坏：不报错、答案却是错的）。
    const byRef = (await t.services.solvers.invoke(CTX, "capacity_forecast", {
      modelId, demandDelta: 0.2, base: { objectType: "Base", objectId: targetBaseId, label: "无所谓的展示名" },
    })) as Cap;
    console.log(`\n  ── §E-2 object ref 形态 ──\n  字符串: scope=${byStr.scope} p50=${byStr.p50}\n  对象ref: scope=${byRef.scope} p50=${byRef.p50}`);
    expect(byRef.scope).toBe("BASE");
    expect(byRef.scopeBaseId).toBe(targetBaseId);
    expect(byRef.p50).toBe(byStr.p50);
  }, 120_000);

  it("诚实边界：真未知基地仍 400（partial 不许把不认识的东西猜成认识的）", async () => {
    for (const bad of ["火星基地", "不存在", "obj_base_不存在的基地"]) {
      const res = await invokeSolver(t, "capacity_forecast", { modelId, demandDelta: 0.2, base: bad }, ADMIN);
      expect(res.statusCode, `base="${bad}" 应 400（不许猜）`).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe("VALIDATION_ERROR");
    }
    // 残余过长的不算近指（`<名>` + 4 字 > MAX_PARTIAL_REMAINDER=3）——边界是结构判据，不是中文后缀词表。
    const far = await invokeSolver(t, "capacity_forecast", { modelId, demandDelta: 0.2, base: `${cnName}第一工厂区` }, ADMIN);
    expect(far.statusCode, `base="${cnName}第一工厂区" 残余 5 字应超近指上限 → 400`).toBe(400);
  }, 120_000);

  it("无 base（可选槽落空的那条路）仍是全网 scope:ALL —— 别把「治后缀」治成「必须给基地」", async () => {
    const net = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2 })) as Cap;
    const nul = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2, base: null })) as Cap;
    expect(net.scope).toBe("ALL");
    expect(nul.scope).toBe("ALL"); // 计划模板 {{slots.base}} 在无基地时给的就是 null
    expect(nul.p50).toBe(net.p50);
  }, 120_000);
});

describe("WO-BASE-SLOT-UNIFY §E-2 · 单一出处纪律（规则来自 contracts·DataCore 侧零中文名词表）", () => {
  it("resolveBaseRef 交回可诊断结果：matchedBy 说明「怎么匹上的」（partial vs name vs id）", () => {
    const b0 = bases.find((b) => String(b.props.baseId) === targetBaseId)!;
    const baseId = String(b0.props.baseId);
    const name = String(b0.props.name);

    const rows: string[] = [];
    for (const [ref, wantBy] of [
      [baseId, "id"],
      [`obj_base_${baseId}`, "id"],
      [name, "name"],
      [`${name}基地`, "partial"],
      [`${name}工厂`, "partial"],
      [{ objectType: "Base", objectId: baseId }, "id"],
    ] as const) {
      const r = resolveBaseRef(bases, ref);
      rows.push(`  ref=${JSON.stringify(ref)} → resolved=${r.resolved} objectId=${r.objectId} matchedBy=${r.matchedBy} matchedProp=${r.matchedProp}`);
      expect(r.resolved, `${JSON.stringify(ref)} 应解析成功`).toBe(true);
      expect(r.objectId).toBe(baseId);
      expect(r.matchedBy, `${JSON.stringify(ref)} 的匹配层级`).toBe(wantBy);
    }
    console.log("\n  ── §E-2 matchedBy 可诊断 ──\n" + rows.join("\n"));

    // 解析不到时带回 attempts（试了什么键、扫了几行、为什么不匹）→ 不必从 400 一路追回来。
    const miss = resolveBaseRef(bases, "火星基地");
    expect(miss.resolved).toBe(false);
    expect(miss.attempts?.[0]?.rowsScanned).toBe(bases.length);
    expect(miss.attempts?.[0]?.propsTried.some((p) => p.endsWith(":partial"))).toBe(true);
  });

  it("refTypeDefFromRows：主键按命名约定 `<typeKey>Id` 结构派生（零业务常数 R14·换类型无需改代码）", () => {
    const def = refTypeDefFromRows("Base", bases);
    expect(def.key).toBe("Base");
    expect(def.properties?.find((p) => p.propKey === "baseId")?.isPrimaryKey).toBe(true);
    expect(def.properties?.find((p) => p.propKey === "name")?.isPrimaryKey).toBeUndefined();
    // R6：同输入同输出（属性名字典序·不依赖行序）
    expect(JSON.stringify(refTypeDefFromRows("Base", bases))).toBe(JSON.stringify(def));
    // 同一份规则换个类型照用（Model → modelId 为主键）——不是给 Base 写死的
    expect(refTypeDefFromRows("Model", models).properties?.find((p) => p.propKey === "modelId")?.isPrimaryKey).toBe(true);
  });

  it("DataCore 求解器层没有第三套中文名匹配（源码判据：resolveBaseId 不再自己 find·委托共享解析器）", async () => {
    // 事实锚（WO-C 修法）：函数**住在哪个文件**不是事实 —— 全树定位（搬家不红；真改回自写匹配才红）。
    const dc = checkedTree("apps/datacore/src", "resolveBaseId", 80);
    const homes = factHits(dc, /export function resolveBaseId(?![\w])/);
    expect(homes, "resolveBaseId 的定义全树找不到（或不唯一）⇒ 求解器入口形状变了").toHaveLength(1);
    const src = readRepo(homes[0]!);
    const at = src.indexOf("export function resolveBaseId");
    const end = src.indexOf("\nexport ", at + 10);
    const body = stripComments(src.slice(at, end === -1 ? src.length : end));
    expect(body.length, "resolveBaseId 函数体抽空了 ⇒ 抽取器坏了，不许读作「委托没了」").toBeGreaterThan(100);
    expect(body, "resolveBaseId 不再委托共享解析器 resolveBaseRef").toContain("resolveBaseRef");
    expect(body, "resolveBaseId 又写回自有的第三套匹配").not.toMatch(/props\.baseId\s*===\s*key/);
    expect(factHits(dc, /(?<!export function\s)\bresolveBaseRef\s*\(/), "resolveBaseRef 全树零调用 ⇒ 委托链断了").not.toEqual([]);
  });
});
