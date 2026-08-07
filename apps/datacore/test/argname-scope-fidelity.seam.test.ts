import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";
import type { AuthCtx, ObjectInstance } from "../src/domain.js";
import { BASE_SCOPE_ARG_KEYS, pickBaseScopeArg } from "../src/solvers/types.js";
import { ALL_SOLVER_CATALOG } from "../src/catalog.js";
import { CapacityForecastArgs } from "@platform/contracts";

/**
 * ★ WO-ARGNAME-SCOPE（欠账 #103）· 作用域**键名**保真门（差分门·SEAM）。
 *
 * 治的病（2026-08-07 亲手实测复现·非登记转述）：
 *   `capacity_forecast` 只读 `args.base` 一个键 ⇒ seed 42 / modelId=4680-NCM / 13 基地：
 *     base    ="changzhou" → scope=BASE p50=5.5176
 *     baseId  ="changzhou" → scope=ALL  p50=12.3016   ← 静默答全网
 *     baseId  ="chengdu"   → scope=ALL  p50=12.3016   ← 与上一行**逐字节相同**
 *     baseName="常州"      → scope=ALL  p50=12.3016   ← 静默答全网
 *     baseId  ="火星基地"   → scope=ALL  p50=12.3016   ← 连不存在的基地都不报错
 *   用户以为问的是某个基地，拿到的是全网 —— **静默错答**，比 400 坏得多。
 *
 * 为什么必须是**差分**门（而不是「有 scope 字段就算过」）：
 *   静默丢键的表征恰恰是「两个不同基地答案完全一样」。只断言「返回了 scope 字段」抓不到它
 *   （修前 scope 字段一直都在，值是 "ALL" 而已）。本门头号判据 = **A 基地 ≠ B 基地**。
 *
 * 为什么必须跨「引擎读取 × 入参声明」两半（SEAM-GATE）：
 *   引擎认了键、但 argHints / contracts 不登记 → agent 照样猜不到该传什么（#103 病根的另一半）；
 *   反之只改声明不改引擎 → 传了也白传。任一半漏，本文件即红。
 *
 * 变异反证（须真跑真转红·见 WO 报告贴的原文）：
 *   把 `capacity.ts` 的 `pickBaseScopeArg("capacity_forecast", args)` 改回
 *   `args.base !== undefined && normalizeBaseRef(args.base) !== "" ? { raw: args.base } : undefined`
 *   → 「四别名同解」与「A≠B」当场转红，`base` 那一路仍绿（证明红的正是键名那一档）。
 */

const CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type Cap = { p50: number; scope?: string; scopeBaseId?: string; scopeBaseName?: string; perBaseRows?: { baseId: string }[] };

let t: TestApp;
let bases: ObjectInstance[];
/** 认证 ≥2 基地的型号（全网 sum > 单基地 → 「收窄真发生了」判得出来·不靠数据巧合）。 */
let modelId = "";
let netP50 = 0;
let baseA = "";
let baseB = "";
let nameA = "";

const nameOf = (id: string) => String(bases.find((b) => String(b.props.baseId) === id)!.props.name);

beforeAll(async () => {
  t = await makeApp();
  await seedBattery(t);
  bases = await t.repos.objects.listByType("demo", "Base");
  for (const m of await t.repos.objects.listByType("demo", "Model")) {
    const mid = String(m.props.modelId);
    const net = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId: mid })) as Cap;
    const rows = net.perBaseRows ?? [];
    if (rows.length >= 2 && (net.p50 ?? 0) > 0) {
      modelId = mid;
      netP50 = net.p50;
      baseA = rows[0]!.baseId;
      baseB = rows[1]!.baseId;
      break;
    }
  }
  nameA = nameOf(baseA);
}, 180_000);

describe("WO-ARGNAME-SCOPE #103 · capacity_forecast 作用域键名（差分门·绝不静默答全网）", () => {
  it("★ 命门 A：四别名（base/baseId/baseName/baseRef）全部收敛到同一基地 —— 修前只有 base 认，其余三个静默退全网", async () => {
    expect(modelId, "需一个认证≥2基地的型号做全网 vs 单基地对比").not.toBe("");
    const lines: string[] = [];
    const seen: Cap[] = [];
    for (const key of BASE_SCOPE_ARG_KEYS) {
      const out = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, [key]: baseA })) as Cap;
      seen.push(out);
      lines.push(`  ${String(key).padEnd(9)}="${baseA}" → scope=${out.scope} scopeBaseId=${out.scopeBaseId} p50=${out.p50}`);
    }
    console.log(`\n  ── #103 四别名（modelId=${modelId}·全网 p50=${netP50}）──\n${lines.join("\n")}`);
    for (const [i, out] of seen.entries()) {
      const key = BASE_SCOPE_ARG_KEYS[i];
      expect(out.scope, `键「${key}」应收窄到 BASE（修前除 base 外全是 ALL=静默答全网）`).toBe("BASE");
      expect(out.scopeBaseId, `键「${key}」应指向 ${baseA}`).toBe(baseA);
      expect(out.p50, `键「${key}」的 p50 应与其余别名一致（键名不该改变答案）`).toBe(seen[0]!.p50);
      // 与「全网」真区分：静默丢键的表征就是这里恒相等。
      expect(out.p50, `键「${key}」不该等于全网合计 ${netP50}（等于即静默丢键）`).not.toBe(netP50);
    }
  }, 180_000);

  it("★ 命门 B（差分）：同一个键、两个不同基地 → 答案必须不同（修前 baseId 传 A/B 返回逐字节相同的全网值）", async () => {
    const rows: string[] = [];
    for (const key of BASE_SCOPE_ARG_KEYS) {
      const a = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, [key]: baseA })) as Cap;
      const b = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, [key]: baseB })) as Cap;
      rows.push(`  ${String(key).padEnd(9)}: ${baseA} p50=${a.p50}  vs  ${baseB} p50=${b.p50}  ${a.p50 === b.p50 ? "← 相同（静默丢键！）" : "✓ 真区分"}`);
      expect(a.scopeBaseId, `键「${key}」传 ${baseA}`).toBe(baseA);
      expect(b.scopeBaseId, `键「${key}」传 ${baseB}`).toBe(baseB);
      expect(
        a.p50,
        `键「${key}」：两个不同基地返回了相同的 p50=${a.p50} —— 这正是「静默答全网」的表征（#103）`,
      ).not.toBe(b.p50);
      // 且两者都不是全网合计（否则「不同」可能只是巧合地一个收窄一个没收窄）。
      expect(a.p50).not.toBe(netP50);
      expect(b.p50).not.toBe(netP50);
    }
    console.log(`\n  ── #103 差分：同键两基地（全网 p50=${netP50}）──\n${rows.join("\n")}`);
  }, 180_000);

  it("★ 命门 C：中文名走任一别名都认（agent 最可能的猜法 baseName:「常州」修前静默答全网）", async () => {
    const byName = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, baseName: nameA })) as Cap;
    const byId = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, base: baseA })) as Cap;
    console.log(`\n  ── #103 中文名 ──\n  baseName="${nameA}" → scope=${byName.scope} p50=${byName.p50}\n  base="${baseA}" → scope=${byId.scope} p50=${byId.p50}`);
    expect(byName.scope).toBe("BASE");
    expect(byName.scopeBaseId).toBe(baseA);
    expect(byName.p50).toBe(byId.p50);
  }, 180_000);

  it("诚实缺席：任一别名给不存在的基地 → 400（修前 baseId/baseName 走这条路时连错都不报，直接答全网）", async () => {
    for (const key of BASE_SCOPE_ARG_KEYS) {
      const res = await invokeSolver(t, "capacity_forecast", { modelId, [key]: "火星基地" }, ADMIN);
      expect(res.statusCode, `键「${key}」给未知基地应 400，实得 ${res.statusCode} ${res.body.slice(0, 160)}`).toBe(400);
    }
  }, 180_000);

  it("★ 不认识的作用域键 → AMBIGUOUS_SCOPE 400（要么认要么报错·不许静默忽略后照答全网）", async () => {
    // `baseIds` 是 bottleneck_matrix 的真键（复数数组）——传给 capacity_forecast 就是「我不消费的作用域键」。
    for (const stray of [{ baseIds: [baseA] }, { base_id: baseA }, { basename: nameA }]) {
      const res = await invokeSolver(t, "capacity_forecast", { modelId, ...stray }, ADMIN);
      const body = JSON.parse(res.body) as { error?: { code?: string; message?: string } };
      console.log(`  args+${JSON.stringify(stray)} → ${res.statusCode} ${body.error?.code} ${String(body.error?.message).slice(0, 120)}`);
      expect(res.statusCode, `不受认作用域键 ${JSON.stringify(stray)} 应 400（修前静默忽略→答全网）`).toBe(400);
      expect(body.error?.code).toBe("AMBIGUOUS_SCOPE");
    }
  }, 180_000);

  it("★ 两个别名互相冲突 → AMBIGUOUS_SCOPE 400（绝不在多个基地里挑一个冒充答案）", async () => {
    const res = await invokeSolver(t, "capacity_forecast", { modelId, base: baseA, baseId: baseB }, ADMIN);
    const body = JSON.parse(res.body) as { error?: { code?: string; message?: string } };
    console.log(`  base=${baseA} + baseId=${baseB} → ${res.statusCode} ${body.error?.code} ${String(body.error?.message).slice(0, 140)}`);
    expect(res.statusCode).toBe(400);
    expect(body.error?.code).toBe("AMBIGUOUS_SCOPE");
    // 同一基地的两种写法**不算冲突**（归一后相等 → 照常收窄·别把治冲突治成禁止冗余）。
    const ok = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, base: baseA, baseId: `obj_base_${baseA}` })) as Cap;
    expect(ok.scopeBaseId).toBe(baseA);
  }, 180_000);

  it("加性不破：不给任何作用域键仍是全网 scope:ALL（别把「治键名」治成「必须给基地」）", async () => {
    const net = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId })) as Cap;
    // 计划模板 {{slots.base}} 在无基地时给的就是 null；空串同理（S20 卡片 baseName:""）。
    const nul = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, base: null, baseName: "" })) as Cap;
    expect(net.scope).toBe("ALL");
    expect(nul.scope).toBe("ALL");
    expect(nul.p50).toBe(net.p50);
    expect(net.p50).toBe(netP50);
  }, 180_000);
});

describe("WO-ARGNAME-SCOPE #103 · 入参声明与引擎真实读取**不许漂移**（SEAM 另一半：agent 读得到才猜得中）", () => {
  it("★ catalog.ts argHints 登记了 base —— 这是 agent 唯一读得到的入参说明（→ MCP tool 定义 / DRIL 检索 / 目录列举）", () => {
    const item = ALL_SOLVER_CATALOG.find((s) => s.key === "capacity_forecast");
    expect(item, "capacity_forecast 应在内置求解器目录中").toBeTruthy();
    const hintKeys = Object.keys(item!.argHints);
    console.log(`\n  argHints(capacity_forecast) = ${JSON.stringify(hintKeys)}`);
    expect(
      hintKeys.some((k) => (BASE_SCOPE_ARG_KEYS as readonly string[]).includes(k)),
      `argHints=${JSON.stringify(hintKeys)} 未登记任何基地作用域键 —— agent 照它永远猜不到该传哪个键（#103 病根）`,
    ).toBe(true);
  });

  it("★ contracts CapacityForecastArgs 登记了 base —— 组合器据本表派生输入模式，表里没有 = 组合出的 args 恒不带基地", () => {
    const shape = Object.keys((CapacityForecastArgs as unknown as { shape: Record<string, unknown> }).shape);
    console.log(`  CapacityForecastArgs.shape = ${JSON.stringify(shape)}`);
    expect(
      shape.some((k) => (BASE_SCOPE_ARG_KEYS as readonly string[]).includes(k)),
      `contracts CapacityForecastArgs=${JSON.stringify(shape)} 未登记基地作用域键（#103 病根之二）`,
    ).toBe(true);
    // 且登记的键必须真被引擎消费（声明与读取一致 —— 声明一个引擎不读的键是另一种漂移）。
    for (const k of shape.filter((x) => (BASE_SCOPE_ARG_KEYS as readonly string[]).includes(x)))
      expect(pickBaseScopeArg("capacity_forecast", { [k]: "changzhou" })?.argKey, `契约登记的键「${k}」应被引擎侧受认`).toBe(k);
  });

  it("键名单一出处是纯函数：不认识就抛、冲突就抛、没给就 undefined（R6·可直接单测·不靠种子）", () => {
    expect(pickBaseScopeArg("x", { modelId: "m" })).toBeUndefined();
    expect(pickBaseScopeArg("x", { base: null, baseName: "" })).toBeUndefined();
    expect(pickBaseScopeArg("x", { baseId: "changzhou" })).toEqual({ argKey: "baseId", raw: "changzhou" });
    // objectRef 形态（AgentCore 计划整槽透传的那种）也走同一条归一。
    expect(pickBaseScopeArg("x", { baseRef: { objectType: "Base", objectId: "changzhou" } })?.argKey).toBe("baseRef");
    expect(() => pickBaseScopeArg("x", { baseIds: ["changzhou"] })).toThrow(/AMBIGUOUS|无法消费/);
    expect(() => pickBaseScopeArg("x", { base: "changzhou", baseId: "chengdu" })).toThrow(/AMBIGUOUS|冲突/);
  });
});
