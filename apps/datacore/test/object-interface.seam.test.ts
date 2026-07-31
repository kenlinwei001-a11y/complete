import { describe, it, expect, beforeAll } from "vitest";
import { makeApp, seedBattery, ADMIN, PLANNER, type TestApp } from "./helpers.js";
import { SOLVER_KEYS } from "../src/solvers/service.js";
import { SOLVER_ONTOLOGY_SIGNATURES } from "../src/solvers/ontology-signature.js";
import { BATTERY_OBJECT_INTERFACES, BATTERY_TYPE_INTERFACE_BINDINGS } from "../src/synthetic/battery.js";
import {
  checkInterfaceConformance,
  jointSatisfiers,
  type ObjectInterface,
} from "@platform/contracts";

/**
 * WO-69 P3 · 对象接口（多态抽象）接缝测试。
 *
 * 头号判据 = **接缝驱动通**，不是各半绿：
 *  · S7 接口加第 4 条要求 → **所有** `latest` 实现者同时被拦（不用逐个类型改）；
 *  · S8 两个接口对同一 propKey 要求互不相容 → 发布期报错，**绝不静默取其一**；
 *  · S9 「谁实现了 X」查询返回**完整集合** + 影响面（类型/行动/函数+P2 签名/视图/迁移清单）；
 *  · §七 验收样例：Approvable(approver/approvedAt/amount) × 两个既有类型，端到端跑发布门。
 *
 * 零回归：不声明 `implements` 的类型逐字节沿用发布现状。
 */

const ifaceUrl = "/a/v1/ontology/interfaces";

async function publishOntology(t: TestApp) {
  return t.app.inject({ method: "POST", url: "/a/v1/ontology/publish", headers: ADMIN });
}

async function getType(t: TestApp, key: string) {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN });
  return (JSON.parse(res.body) as { key: string; properties: { propKey: string; dataType: string }[]; implements?: unknown[] }[]).find(
    (x) => x.key === key,
  );
}

describe("WO-69 P3 · 对象接口（多态抽象）", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
  }, 120_000);

  // ── §七 验收样例 ─────────────────────────────────────────────────────────
  it("验收(i)：Approvable 已种下，两个既有类型实现它，且都真长出 approver/approvedAt/amount", async () => {
    const res = await t.app.inject({ method: "GET", url: `${ifaceUrl}/Approvable`, headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const iface = JSON.parse(res.body) as ObjectInterface;
    expect(iface.status).toBe("PUBLISHED");
    expect(iface.properties.map((p) => p.propKey).sort()).toEqual(["amount", "approvedAt", "approver"]);

    const implementerKeys = Object.keys(BATTERY_TYPE_INTERFACE_BINDINGS).sort();
    expect(implementerKeys.length).toBeGreaterThanOrEqual(2); // "至少两个既有类型"
    for (const key of implementerKeys) {
      const ty = await getType(t, key);
      expect(ty, `类型 ${key} 应存在`).toBeTruthy();
      const props = new Map(ty!.properties.map((p) => [p.propKey, p.dataType]));
      expect(props.get("approver")).toBe("string");
      expect(props.get("approvedAt")).toBe("date");
      expect(props.get("amount")).toBe("number");
      expect(ty!.implements).toEqual([{ interfaceKey: "Approvable", version: "latest" }]);
    }

    // 发布门此刻应放行（契约已兑现）
    const pub = await publishOntology(t);
    expect(pub.statusCode).toBe(200);
  }, 60_000);

  it("functions 不是字段拷贝器：接口声明的 solverKey 落在真求解器注册表，且透出 P2 本体签名", async () => {
    const iface = BATTERY_OBJECT_INTERFACES.find((i) => i.key === "Approvable")!;
    const solverKey = iface.functions[0]!.solverKey;
    // ① 真求解器（SOLVER_KEYS 单一来源）
    expect((SOLVER_KEYS as readonly string[]).includes(solverKey)).toBe(true);
    // ② 有 P2 签名（读取面已知；未知 ≠ 安全）
    expect(SOLVER_ONTOLOGY_SIGNATURES[solverKey]).toBeTruthy();
    // ③ 查询面把签名当场亮出（实现者据此知道要喂饱什么，而不是靠猜）
    const res = await t.app.inject({ method: "GET", url: `${ifaceUrl}/Approvable/implementers`, headers: ADMIN });
    const body = JSON.parse(res.body) as {
      impact: { functions: { solverKey: string; registered: boolean; ontologySignature?: { reads?: { typeKey: string; propKeys?: string[] }[] } }[] };
    };
    const fn = body.impact.functions.find((f) => f.solverKey === solverKey)!;
    expect(fn.registered).toBe(true);
    const arInvoiceRead = fn.ontologySignature?.reads?.find((r) => r.typeKey === "ARInvoice");
    expect(arInvoiceRead?.propKeys).toContain("amount");
    expect(arInvoiceRead?.propKeys).toContain("custName");
  }, 60_000);

  it("接口 functions 引用不存在的求解器 → 创建即 RED（不许种一个自说自话的行为）", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: ifaceUrl,
      headers: ADMIN,
      payload: {
        key: "__Bogus",
        name: "假接口",
        properties: [],
        functions: [{ solverKey: "no_such_solver_at_all" }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("INTERFACE_FUNCTION_UNKNOWN");
    expect(res.body).toContain("no_such_solver_at_all");
  });

  it("接口 actions 引用未注册 ActionType → 创建即 RED", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: ifaceUrl,
      headers: ADMIN,
      payload: { key: "__Bogus2", name: "假接口2", properties: [], actions: [{ actionTypeKey: "根本没有这个行动" }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("INTERFACE_ACTION_UNKNOWN");
  });

  // ── S7 ──────────────────────────────────────────────────────────────────
  it("S7 接缝：接口加第 4 条属性 → **全部**实现者同时被发布门拦下（不用逐个类型改）", async () => {
    const iface = BATTERY_OBJECT_INTERFACES.find((i) => i.key === "Approvable")!;
    // 演进接口：v2 增加第 4 条要求 currency
    const up = await t.app.inject({
      method: "POST",
      url: ifaceUrl,
      headers: ADMIN,
      payload: {
        key: "Approvable",
        name: iface.name,
        properties: [...iface.properties, { propKey: "currency", dataType: "string", required: true }],
        actions: iface.actions,
        functions: iface.functions,
      },
    });
    expect(up.statusCode).toBe(201);
    const v2 = JSON.parse(up.body) as ObjectInterface;
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("DRAFT");

    // 仅 DRAFT 时：latest 解析仍为 v1 → 实现者不受影响（开闭：草稿不惊动已发布实现者）
    expect((await publishOntology(t)).statusCode).toBe(200);

    await t.app.inject({ method: "POST", url: `${ifaceUrl}/Approvable/publish`, headers: ADMIN, payload: {} });

    // v2 一发布：跟 latest 的**每一个**实现者同时被要求补齐
    const blocked = await publishOntology(t);
    expect(blocked.statusCode).toBe(400);
    const implementerKeys = Object.keys(BATTERY_TYPE_INTERFACE_BINDINGS).sort();
    for (const key of implementerKeys) {
      expect(blocked.body, `${key} 应被点名`).toContain(key);
    }
    expect(blocked.body).toContain("currency");
    expect(blocked.body).toContain("INTERFACE_PROPERTY_MISSING");

    // 迁移清单：只读报告把"谁得补什么"列全（升级路径显式，不静默失效）
    const rep = await t.app.inject({ method: "GET", url: `${ifaceUrl}/Approvable/implementers`, headers: ADMIN });
    const body = JSON.parse(rep.body) as { impact: { migrationRequired: { typeKey: string; missing: string[] }[] } };
    expect(body.impact.migrationRequired.map((m) => m.typeKey).sort()).toEqual(implementerKeys);
    for (const m of body.impact.migrationRequired) expect(m.missing).toContain("currency");

    // 复位：退役 v2 → latest 回到 v1 → 发布恢复
    await t.app.inject({ method: "POST", url: `${ifaceUrl}/Approvable/retire`, headers: ADMIN, payload: { version: 2 } });
    expect((await publishOntology(t)).statusCode).toBe(200);
  }, 60_000);

  it("S7 变异反证：只校验一个实现者（把另一个从 types 里摘掉）→ 漏报，接缝失效", () => {
    const ifaceV2: ObjectInterface = {
      id: "oif_x",
      tenantId: "demo",
      key: "Approvable",
      version: 2,
      name: "可审批物",
      properties: [
        { propKey: "approver", dataType: "string", required: true },
        { propKey: "approvedAt", dataType: "date", required: true },
        { propKey: "amount", dataType: "number", required: true },
        { propKey: "currency", dataType: "string", required: true },
      ],
      status: "PUBLISHED",
    };
    const mkType = (key: string) => ({
      key,
      properties: [
        { propKey: "approver", dataType: "string" as const },
        { propKey: "approvedAt", dataType: "date" as const },
        { propKey: "amount", dataType: "number" as const },
      ],
      implements: [{ interfaceKey: "Approvable", version: "latest" as const }],
    });
    const both = checkInterfaceConformance({ types: [mkType("ARInvoice"), mkType("OverdueRecord")], interfaces: [ifaceV2] });
    expect(both.map((v) => v.typeKey).sort()).toEqual(["ARInvoice", "OverdueRecord"]);
    // 变异：只喂一个实现者 → 另一个的缺口消失（这正是 S7 要防的"逐类型手抄漏一个无人知道"）
    const onlyOne = checkInterfaceConformance({ types: [mkType("ARInvoice")], interfaces: [ifaceV2] });
    expect(onlyOne.map((v) => v.typeKey)).toEqual(["ARInvoice"]);
    expect(onlyOne.some((v) => v.typeKey === "OverdueRecord")).toBe(false);
  });

  // ── S8 ──────────────────────────────────────────────────────────────────
  it("S8 接缝：两个接口对同一 propKey 要求互不相容的 dataType → 发布期报错，绝不静默取其一", async () => {
    // 新接口 Priced 要求 amount 为 string（与 Approvable 的 number 互不相容）
    const mk = await t.app.inject({
      method: "POST",
      url: ifaceUrl,
      headers: ADMIN,
      payload: {
        key: "__Priced",
        name: "计价物",
        properties: [{ propKey: "amount", dataType: "string", required: true }],
      },
    });
    expect(mk.statusCode).toBe(201);
    await t.app.inject({ method: "POST", url: `${ifaceUrl}/__Priced/publish`, headers: ADMIN, payload: {} });

    // 让 ARInvoice 同时实现两个接口
    const ar = await getType(t, "ARInvoice");
    const patch = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "ARInvoice",
        displayName: "应收发票",
        domain: "commercial",
        properties: ar!.properties.map((p) => ({ ...p, isPrimaryKey: p.propKey === "invoiceId" })),
        implements: [
          { interfaceKey: "Approvable", version: "latest" },
          { interfaceKey: "__Priced", version: "latest" },
        ],
        actions: [{ actionTypeKey: "对象数据变更" }],
      },
    });
    expect(patch.statusCode).toBe(201);

    const blocked = await publishOntology(t);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.body).toContain("INTERFACE_PROPERTY_CONFLICT");
    expect(blocked.body).toContain("amount");
    expect(blocked.body).toContain("__Priced");
    // 冲突必须**报错**而不是"挑一个"：不许同时出现"已按 number 处理"式的静默收敛
    expect(blocked.body).not.toContain("INTERFACE_PROPERTY_TYPE_MISMATCH");

    // 复位
    await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "ARInvoice",
        displayName: "应收发票",
        domain: "commercial",
        properties: ar!.properties.map((p) => ({ ...p, isPrimaryKey: p.propKey === "invoiceId" })),
        implements: [{ interfaceKey: "Approvable", version: "latest" }],
        actions: [{ actionTypeKey: "对象数据变更" }],
      },
    });
    expect((await publishOntology(t)).statusCode).toBe(200);
  }, 60_000);

  it("S8 变异反证：把 number/string 判为「兼容」（静默取其一）→ 冲突消失，接缝失效", () => {
    // 真实矩阵：number 与 string 无共同满足者 → 冲突
    expect(jointSatisfiers("number", "string")).toEqual([]);
    // 变异版：假装"都当 string 处理"（= 静默取其一）
    const mutated = (a: string, b: string) => (a === "number" && b === "string" ? ["string"] : jointSatisfiers(a as never, b as never));
    expect(mutated("number", "string")).toEqual(["string"]); // → 冲突被吞，发布放行，实现者拿着 "12" 当 12 算
    // 兼容方向（enum 满足 string 要求）本就该放行，不是冲突
    expect(jointSatisfiers("string", "enum")).toEqual(["enum"]);
  });

  // ── S9 ──────────────────────────────────────────────────────────────────
  it("S9 接缝：查询「谁实现了 Approvable」返回完整集合 + 影响面", async () => {
    const res = await t.app.inject({ method: "GET", url: `${ifaceUrl}/Approvable/implementers`, headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      implementers: { typeKey: string; conformant: boolean; pinnedVersion: unknown; resolvedVersion?: number }[];
      versions: { version: number; status: string }[];
      impact: { objectTypes: string[]; actions: string[]; functions: { solverKey: string }[]; views: unknown[] };
    };
    const expected = Object.keys(BATTERY_TYPE_INTERFACE_BINDINGS).sort();
    expect(body.implementers.map((i) => i.typeKey).sort()).toEqual(expected);
    expect(body.impact.objectTypes.sort()).toEqual(expected);
    expect(body.implementers.every((i) => i.conformant)).toBe(true);
    expect(body.implementers.every((i) => i.resolvedVersion === 1)).toBe(true);
    expect(body.impact.actions).toContain("对象数据变更");
    expect(body.impact.functions.map((f) => f.solverKey)).toContain("credit_exposure");
  }, 60_000);

  it("S9 变异反证：结果里漏掉一个实现者 → 影响面判断就是错的", async () => {
    const res = await t.app.inject({ method: "GET", url: `${ifaceUrl}/Approvable/implementers`, headers: ADMIN });
    const body = JSON.parse(res.body) as { implementers: { typeKey: string }[] };
    const full = body.implementers.map((i) => i.typeKey).sort();
    const dropped = full.slice(1); // 变异：丢掉第一个
    expect(dropped).not.toEqual(full);
    expect(dropped.length).toBe(full.length - 1);
    // 真实结果必须是全集（这条断言在变异版下即红）
    expect(full).toEqual(Object.keys(BATTERY_TYPE_INTERFACE_BINDINGS).sort());
  }, 60_000);

  // ── §七 验收 (iii) ───────────────────────────────────────────────────────
  it("验收(iii)：从**一个**实现者删掉必需属性 → 发布门 RED 并精确点名那条属性", async () => {
    const ar = await getType(t, "ARInvoice");
    const without = ar!.properties.filter((p) => p.propKey !== "approvedAt");
    const patch = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "ARInvoice",
        displayName: "应收发票",
        domain: "commercial",
        properties: without.map((p) => ({ ...p, isPrimaryKey: p.propKey === "invoiceId" })),
      },
    });
    expect(patch.statusCode).toBe(201);

    const blocked = await publishOntology(t);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.body).toContain("INTERFACE_PROPERTY_MISSING");
    expect(blocked.body).toContain("approvedAt");
    expect(blocked.body).toContain("ARInvoice");
    // 只点名出问题的那个，另一个实现者不受牵连（点名要准）
    expect(blocked.body).not.toContain("OverdueRecord");

    // 复位
    await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "ARInvoice",
        displayName: "应收发票",
        domain: "commercial",
        properties: ar!.properties.map((p) => ({ ...p, isPrimaryKey: p.propKey === "invoiceId" })),
      },
    });
    expect((await publishOntology(t)).statusCode).toBe(200);
  }, 60_000);

  it("P2 兑现：删掉签名读取面里的属性（非接口属性）→ 函数不可兑现 RED（证明 functions 不是字段拷贝器）", async () => {
    const ar = await getType(t, "ARInvoice");
    // custName 不在 Approvable 的三条属性里，但在 credit_exposure 的 P2 签名读取面里
    const without = ar!.properties.filter((p) => p.propKey !== "custName");
    await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "ARInvoice",
        displayName: "应收发票",
        domain: "commercial",
        properties: without.map((p) => ({ ...p, isPrimaryKey: p.propKey === "invoiceId" })),
      },
    });
    const blocked = await publishOntology(t);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.body).toContain("INTERFACE_FUNCTION_UNSATISFIED");
    expect(blocked.body).toContain("credit_exposure");
    expect(blocked.body).toContain("custName");
    // 变异反证：若把 functions 当成"只抄字段"（忽略签名读取面）→ 这个缺口完全不会被发现
    const silent = checkInterfaceConformance({
      types: [
        {
          key: "ARInvoice",
          properties: without.map((p) => ({ propKey: p.propKey, dataType: p.dataType as never })),
          implements: [{ interfaceKey: "Approvable", version: "latest" }],
        },
      ],
      interfaces: [
        {
          id: "oif_x",
          tenantId: "demo",
          key: "Approvable",
          version: 1,
          name: "可审批物",
          properties: [
            { propKey: "approver", dataType: "string", required: true },
            { propKey: "approvedAt", dataType: "date", required: true },
            { propKey: "amount", dataType: "number", required: true },
          ],
          functions: [{ solverKey: "credit_exposure", required: true }],
          status: "PUBLISHED",
        },
      ],
      // 不传 solverSignatures = 字段拷贝器模式
    });
    expect(silent).toEqual([]); // 缺口被吞

    await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: {
        key: "ARInvoice",
        displayName: "应收发票",
        domain: "commercial",
        properties: ar!.properties.map((p) => ({ ...p, isPrimaryKey: p.propKey === "invoiceId" })),
      },
    });
    expect((await publishOntology(t)).statusCode).toBe(200);
  }, 60_000);

  // ── 开闭 / 演进 ─────────────────────────────────────────────────────────
  it("开闭：pin 在旧版本的实现者不会被接口演进悄悄弄失效（版本共存）", async () => {
    // Approvable v3（加要求）→ 发布
    const iface = BATTERY_OBJECT_INTERFACES.find((i) => i.key === "Approvable")!;
    await t.app.inject({
      method: "POST",
      url: ifaceUrl,
      headers: ADMIN,
      payload: {
        key: "Approvable",
        name: iface.name,
        properties: [...iface.properties, { propKey: "approvalNote", dataType: "string", required: true }],
        actions: iface.actions,
        functions: iface.functions,
      },
    });
    await t.app.inject({ method: "POST", url: `${ifaceUrl}/Approvable/publish`, headers: ADMIN, payload: {} });

    // 把两个实现者 pin 到 v1 → 演进不影响它们
    for (const key of Object.keys(BATTERY_TYPE_INTERFACE_BINDINGS)) {
      const ty = await getType(t, key);
      await t.app.inject({
        method: "POST",
        url: "/a/v1/ontology/object-types",
        headers: ADMIN,
        payload: {
          key,
          displayName: ty!.key,
          properties: ty!.properties.map((p, i) => ({ ...p, isPrimaryKey: i === 0 })),
          implements: [{ interfaceKey: "Approvable", version: 1 }],
        },
      });
    }
    const ok = await publishOntology(t);
    expect(ok.statusCode).toBe(200); // pin 住 → 不被悄悄弄失效

    // 改回 latest → 立刻被要求补齐（升级路径显式）
    for (const key of Object.keys(BATTERY_TYPE_INTERFACE_BINDINGS)) {
      const ty = await getType(t, key);
      await t.app.inject({
        method: "POST",
        url: "/a/v1/ontology/object-types",
        headers: ADMIN,
        payload: {
          key,
          displayName: ty!.key,
          properties: ty!.properties.map((p, i) => ({ ...p, isPrimaryKey: i === 0 })),
          implements: [{ interfaceKey: "Approvable", version: "latest" }],
        },
      });
    }
    const blocked = await publishOntology(t);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.body).toContain("approvalNote");

    // 复位：退役 v3
    await t.app.inject({ method: "POST", url: `${ifaceUrl}/Approvable/retire`, headers: ADMIN, payload: { version: 3 } });
    expect((await publishOntology(t)).statusCode).toBe(200);
  }, 60_000);

  // ── 零回归 / 隔离 ────────────────────────────────────────────────────────
  it("零回归：不声明 implements 的类型完全不走接口门（纯函数空转 + 真发布通过）", async () => {
    const noImpl = checkInterfaceConformance({
      types: [
        { key: "Base", properties: [{ propKey: "baseId", dataType: "string" }] },
        { key: "Model", properties: [], implements: [] },
      ],
      interfaces: [],
      solverSignatures: SOLVER_ONTOLOGY_SIGNATURES,
    });
    expect(noImpl).toEqual([]);
    expect((await publishOntology(t)).statusCode).toBe(200);
  }, 60_000);

  it("平台没有类型继承：接口只声明要求、不注入属性（组合优于继承）", async () => {
    // 实现者的属性表里不会因为"实现了接口"而凭空多出接口定义的字段——
    // 属性必须由类型自己真声明（发布门校验的正是这件事）。
    const res = await t.app.inject({ method: "GET", url: `${ifaceUrl}/Approvable`, headers: ADMIN });
    const iface = JSON.parse(res.body) as ObjectInterface;
    expect(Object.keys(iface)).not.toContain("extends"); // 契约里根本没有 extends
    const base = await getType(t, "Base"); // 未实现 Approvable 的类型不会被注入
    expect(base!.properties.some((p) => p.propKey === "approver")).toBe(false);
  }, 60_000);

  it("R2 租户隔离 + 权限：非 admin 不能定义接口；跨租户查不到", async () => {
    const denied = await t.app.inject({
      method: "POST",
      url: ifaceUrl,
      headers: PLANNER,
      payload: { key: "__X", name: "x", properties: [] },
    });
    expect(denied.statusCode).toBe(403);
    const other = await t.app.inject({
      method: "GET",
      url: `${ifaceUrl}/Approvable`,
      headers: { "x-debug-user": "other:admin:admin" },
    });
    expect(other.statusCode).toBe(404);
  });
});
