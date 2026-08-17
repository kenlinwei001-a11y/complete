import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import type { ObjectTypeDef, ObjectInstance } from "../src/domain.js";

/**
 * DF.11 A5 自动抽接地词表（自成长）：接地词表在静态册（基地/细分）基底上，
 * 自动抽取已发布本体 searchable 字段的实例名 → 新建业务域实体自动纳入接地，不必手改册。
 * 验证：发布带 searchable name 的类型 + 实例「星海工厂」→ 生成引用它过接地（在动态词表）；
 * 编造「火星工厂」（不在本体）→ 越界拒绝（UNREGISTERED）。
 */
const factoryType: ObjectTypeDef = {
  id: "otype_demo_Factory",
  tenantId: "demo",
  key: "Factory",
  displayName: "工厂",
  domain: "ops",
  properties: [
    { propKey: "fid", dataType: "string", isPrimaryKey: true },
    { propKey: "name", dataType: "string", isPrimaryKey: false, searchable: true }, // A3 名称类字段
  ],
  derivedProperties: [],
  sourceBindings: [],
  version: 1,
  status: "ACTIVE",
  published: true,
};
const factoryObj: ObjectInstance = {
  id: "obj_demo_f1",
  tenantId: "demo",
  type: "Factory",
  props: { fid: "F1", name: "星海工厂" },
  // 原写 `"MANUAL" as ObjectInstance["origin"]` —— ObjectOrigin 是**判别联合对象**
  // （domain.ts:375），不是字符串。那个 `as` 把类型错误整个盖住了，正是不该用 as 的样板。
  origin: { type: "MANUAL" },
};

describe("DF.11 · 接地词表自本体自成长（deriveGroundingVocab）", () => {
  it("deriveGroundingVocab：静态册 + 已发布 searchable 实例名（含「星海工厂」），确定性排序", async () => {
    const t: TestApp = await makeApp();
    await t.repos.ontologyTypes.put(factoryType);
    await t.repos.objects.put(factoryObj);
    const vocab = await t.services.solvers.deriveGroundingVocab(t.adminCtx);
    expect(vocab).toContain("常州"); // 静态册基底（基地名）
    expect(vocab).toContain("星海工厂"); // 动态抽：本体 searchable 实例名
    expect(vocab).not.toContain("F1"); // 非 searchable 字段（PK）不入
    expect([...vocab]).toEqual([...vocab].sort()); // 确定性排序
  });

  it("生成路径：引用本体内「星海工厂」→ 过接地 → PROVISIONAL（自成长词表纳入）", async () => {
    const t: TestApp = await makeApp();
    await t.repos.ontologyTypes.put(factoryType);
    await t.repos.objects.put(factoryObj);
    t.llm.enqueue({ computeSource: `(ctx, args) => ({ pick: "星海工厂" })`, outputShape: ["pick"], argHints: {}, rationale: "引用本体内真实工厂" });
    const art = (await (await t.app.inject({ method: "POST", url: "/a/v1/solvers/generate", headers: ADMIN, payload: { key: "pick_factory", intent: "挑星海" } })).json()) as { status: string };
    expect(art.status).toBe("PROVISIONAL");
  });

  it("生成路径：编造本体外「火星工厂」→ 越界 → UNREGISTERED（不在静态册也不在本体）", async () => {
    const t: TestApp = await makeApp();
    await t.repos.ontologyTypes.put(factoryType);
    await t.repos.objects.put(factoryObj);
    t.llm.enqueue({ computeSource: `(ctx, args) => ({ pick: "火星工厂" })`, outputShape: ["pick"], argHints: {}, rationale: "编造不存在的工厂" });
    const art = (await (await t.app.inject({ method: "POST", url: "/a/v1/solvers/generate", headers: ADMIN, payload: { key: "bad_factory", intent: "挑火星" } })).json()) as { status: string; rejectReason?: string };
    expect(art.status).toBe("UNREGISTERED");
    expect(art.rejectReason).toContain("接地校验失败");
  });
});
