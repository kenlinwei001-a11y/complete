import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { batteryObjectTypes } from "../src/synthetic/battery.js";
import { extendedObjectTypes } from "../src/synthetic/battery-extended.js";
import { applyPropReadability, catalogUnits, PROP_READABILITY, TYPE_BUSINESS_DEFINITIONS } from "../src/synthetic/ontology-readability.js";
import { UNIT_DICTIONARY } from "../src/ontology-governance.js";
import {
  BUSINESS_DEFINITION_FORBIDDEN_WORDS,
  SKILL_SUMMARY_FORBIDDEN_WORDS,
  VAGUE_WORDS_BASE,
  TypeSemanticsResponseSchema,
} from "@platform/contracts";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import type { PropertyDef } from "../src/domain.js";

/**
 * WO-63-SCHEMA-READABILITY · SEAM：可读性不是"字段存在"，是**四段接缝同时通**——
 *   ① 目录 → 出厂本体（口径真的注进了 PropertyDef，不是躺在常量表里）
 *   ② 出厂本体 → type-semantics 投影（B 侧 agent 与前端读的是同一份口径，不是第二份拷贝）
 *   ③ 出厂本体 → 治理单位字典（本体自己存得回自己：用了字典外单位则管理页改同一类型会被拒）
 *   ④ 空泛词表 → 两处 lint 同源（改一处必须两处同步）
 * 任一段断 = "绿测试≠能用"。本文件逐段咬。
 */

const ALL = [...batteryObjectTypes(), ...extendedObjectTypes()];
const CORE = JSON.parse(readFileSync("../../scripts/schema-readability-baseline.json", "utf8")).coreTypes as string[];

describe("WO-63 · ① 目录→出厂本体（口径真注入，非常量表自娱）", () => {
  it("每个 PropertyDef 都有非空 description 与 displayName（且 displayName ≠ propKey）", () => {
    const bad: string[] = [];
    for (const t of ALL) {
      for (const p of t.properties) {
        if (!p.description?.trim()) bad.push(`${t.key}.${p.propKey} 缺 description`);
        if (!p.displayName?.trim() || p.displayName === p.propKey) bad.push(`${t.key}.${p.propKey} 缺 displayName`);
      }
    }
    expect(bad, bad.slice(0, 10).join(" | ")).toEqual([]);
  });

  it("S5 无量纲属性不得被硬塞单位：unit 与 unitExempt 互斥，且数值属性二者必居其一", () => {
    const bad: string[] = [];
    for (const t of ALL) {
      for (const p of t.properties) {
        if (p.unit && p.unitExempt) bad.push(`${t.key}.${p.propKey} 既有 unit 又标豁免`);
        if (p.dataType === "number" && !p.unit && !p.unitExempt) bad.push(`${t.key}.${p.propKey} 数值属性既无单位也未诚实豁免`);
      }
    }
    expect(bad, bad.slice(0, 10).join(" | ")).toEqual([]);
  });

  it("S5 反证（注入器语义）：目录标 dimensionless 的属性即便原本带 unit，注入后 unit 被清除（不留矛盾态）", () => {
    const before: PropertyDef[] = [{ propKey: "util", dataType: "number", isPrimaryKey: false, unit: "%" }, { propKey: "lon", dataType: "number", isPrimaryKey: false, unit: "个" }];
    const after = applyPropReadability("Base", before);
    expect(after.find((p) => p.propKey === "util")!.unit).toBe("%"); // 有量纲：目录给单位
    const lon = after.find((p) => p.propKey === "lon")!;
    expect(lon.unitExempt).toBe("dimensionless");
    expect(lon.unit).toBeUndefined(); // 硬塞的"个"被清掉——诚实无量纲优于编造单位
  });

  it("口径写的是真值不是套话：同名字段在不同类型的量纲差异必须被写明（Base.util 0–100 vs Line.utilization 0–1）", () => {
    const util = ALL.find((t) => t.key === "Base")!.properties.find((p) => p.propKey === "util")!;
    const lineUtil = ALL.find((t) => t.key === "Line")!.properties.find((p) => p.propKey === "utilization")!;
    expect(util.unit).toBe("%");
    expect(util.description).toContain("0–100");
    expect(lineUtil.unitExempt).toBe("dimensionless");
    expect(lineUtil.description).toContain("0–1");
  });

  it("R6 确定性：两次装配字节级一致（目录注入无时钟/随机）", () => {
    expect(JSON.stringify([...batteryObjectTypes(), ...extendedObjectTypes()])).toBe(JSON.stringify(ALL));
  });
});

describe("WO-63 · S2/S6 概念级业务定义（统一语言 + R13 可溯源）", () => {
  it("S2 八个核心类型都有 statement（≥10 字）与 excludes（「谁不算」）", () => {
    for (const key of CORE) {
      const t = ALL.find((x) => x.key === key);
      expect(t, `${key} 不在出厂本体`).toBeDefined();
      const bd = t!.businessDefinition;
      expect(bd?.statement?.length ?? 0, `${key}.statement`).toBeGreaterThanOrEqual(10);
      expect(bd?.excludes, `${key}.excludes`).toBeTruthy();
    }
  });

  it("S3 statement 不含空泛词（词表取自契约单源，不在本测另抄一份）", () => {
    for (const [key, bd] of Object.entries(TYPE_BUSINESS_DEFINITIONS)) {
      for (const w of BUSINESS_DEFINITION_FORBIDDEN_WORDS) {
        expect(bd.statement.includes(w), `${key} 含空泛词「${w}」`).toBe(false);
      }
    }
  });

  it("S6 R13：每条业务定义都可溯源（decidedBy + decidedAt 齐）", () => {
    const unsourced = Object.entries(TYPE_BUSINESS_DEFINITIONS)
      .filter(([, bd]) => !bd.decidedBy || !bd.decidedAt)
      .map(([k]) => k);
    expect(unsourced, `未溯源：${unsourced.join(",")}`).toEqual([]);
  });

  it("Customer 的定义必须回答「四种客户取哪一种」——这正是本体读不懂的典型根因", () => {
    const bd = TYPE_BUSINESS_DEFINITIONS.Customer!;
    expect(bd.statement).toContain("付款");
    expect(bd.excludes).toContain("不包括");
    expect(bd.rationale).toContain("四"); // 取舍理由必须留下（做完就丢 = 只剩字段名）
  });
});

describe("WO-63 · ④ 空泛词表同源守恒（改一处必须两处同步）", () => {
  it("两张词表都由 VAGUE_WORDS_BASE 派生（基集单源）", () => {
    for (const w of VAGUE_WORDS_BASE) {
      expect(SKILL_SUMMARY_FORBIDDEN_WORDS).toContain(w);
      expect(BUSINESS_DEFINITION_FORBIDDEN_WORDS).toContain(w);
    }
  });

  it("agentcore skill-lint 的字面量与契约常量逐字一致（漂移即红——真单源 import 受 🚦 边界所限，以此守恒门等价堵漏）", () => {
    const src = readFileSync("../agentcore/src/skill-lint.ts", "utf8");
    const m = src.match(/const FORBIDDEN_WORDS\s*=\s*\[([^\]]*)\]/);
    expect(m, "skill-lint.ts 找不到 FORBIDDEN_WORDS 字面量").toBeTruthy();
    const words = m![1]!.split(",").map((s) => s.trim().replace(/^["'`]|["'`]$/g, "")).filter(Boolean);
    expect(words).toEqual([...SKILL_SUMMARY_FORBIDDEN_WORDS]);
  });
});

describe("WO-63 · ③ 数据 × 治理接缝：本体自己存得回自己", () => {
  it("目录用到的每个单位都在治理单位字典内（否则 POST /a/v1/ontology/types 会以「未知单位」拒绝同一类型）", () => {
    const outside = catalogUnits().filter((u) => !UNIT_DICTIONARY.includes(u));
    expect(outside, `字典外单位：${outside.join(", ")}`).toEqual([]);
  });

  it("SEAM 真跑：把出厂本体的 Base 原样 POST 回去 → 201（单位字典不拒绝自家口径）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = ALL.find((x) => x.key === "Base")!;
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: { key: base.key, displayName: base.displayName, domain: base.domain, properties: base.properties, derivedProperties: base.derivedProperties },
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  it("反证：塞一个字典外单位 → 400 未知单位（证明上一条不是因为校验被绕过）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "Base",
        displayName: "生产基地",
        domain: "factory",
        properties: [{ propKey: "baseId", dataType: "string", isPrimaryKey: true, unit: "喵" }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("未知单位");
  });
});

describe("WO-63 · ② 出厂本体 → type-semantics 投影（前端与 B 侧读同一份口径）", () => {
  it("GET /a/v1/ontology/type-semantics 带出 displayName / unitExempt / businessDefinition（契约可解析）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/type-semantics?types=Base,Customer", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const parsed = TypeSemanticsResponseSchema.parse(res.json());

    const base = parsed.types.find((x) => x.typeKey === "Base")!;
    expect(base.businessDefinition?.statement).toBe(TYPE_BUSINESS_DEFINITIONS.Base!.statement);
    const util = base.props.find((p) => p.propKey === "util")!;
    expect(util.displayName).toBe(PROP_READABILITY.Base!.util!.displayName);
    expect(util.unit).toBe("%");
    expect(util.description).toContain("0–100");
    const lon = base.props.find((p) => p.propKey === "lon")!;
    expect(lon.unitExempt).toBe("dimensionless");
    expect(lon.unit).toBeUndefined();

    // 跨源类型（battery-extended）同样注入，证明两张出厂表走的是同一收口点
    const cust = parsed.types.find((x) => x.typeKey === "Customer")!;
    expect(cust.businessDefinition?.excludes).toBeTruthy();
    expect(cust.props.find((p) => p.propKey === "creditLimit")!.unit).toBe("万元");
  });

  it("upsertType 不得抹掉已填业务定义（patch 式改属性后定义仍在）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: { key: "Base", displayName: "生产基地", domain: "factory", properties: [{ propKey: "baseId", dataType: "string", isPrimaryKey: true }] },
    });
    expect(res.statusCode).toBe(201);
    const sem = await t.app.inject({ method: "GET", url: "/a/v1/ontology/type-semantics?types=Base", headers: ADMIN });
    expect(sem.json().types[0].businessDefinition?.statement).toBe(TYPE_BUSINESS_DEFINITIONS.Base!.statement);
  });
});
