import { describe, it, expect, beforeEach } from "vitest";
import type { OntologyClient } from "../src/tools/clients.js";
import {
  findUndescribed,
  findInvalidResources,
  type FieldResource,
  type IntelligenceResource,
  type ObjectTypeResource,
} from "@platform/contracts";
import { createTestApp, debugHeaders, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { projectFields, projectObjectTypes } from "../src/dril/resource-projector.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";

/**
 * WO-RESOURCE-CATALOG-ONTOLOGY · SEAM 红咬（①反虚构 ②活投影 ③field 量纲 ④描述门有牙 ⑤R6 字节一致）。
 * 头号判据①：投影出的 object_type 集 == 本体真值 ACTIVE 类型集，不多不少——虚构类型
 * （Capacity/Route/Bom/Forecast/Risk/Action）绝不出现，
 * 真实核心类型（Process/Equipment/WorkOrder/MaterialBalance/OrderLine）必须在。
 * （纠偏：WO §1.3 清单中的 Supplier/Customer/Certification 经 battery-extended.ts 实证为真实 ACTIVE 类型，
 *  亲手真跑 demo 本体 90 类含之——投影含之=忠实，非虚构。）
 */

async function listResources(t: TestApp, user: string, query = ""): Promise<IntelligenceResource[]> {
  const res = await t.app.inject({
    method: "GET",
    url: `/b/v1/resources${query}`,
    headers: debugHeaders(user),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: IntelligenceResource[] }).items;
}

const activeDefKeys = (t: TestApp): string[] =>
  t.dataCore.ontology.objectTypeDefs
    .filter((d) => d.status === undefined || d.status === "ACTIVE")
    .map((d) => d.key);

describe("WO-RESOURCE-CATALOG-ONTOLOGY · 本体对象类型/字段进资源目录", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });

  it("SEAM① 反虚构（头号）：投影类型集 == 本体真值 ACTIVE 集，虚构类型不出现、真实核心必须在", async () => {
    const projected = (await listResources(t, ADMIN, "?kind=object_type")) as ObjectTypeResource[];
    expect(new Set(projected.map((r) => r.key))).toEqual(new Set(activeDefKeys(t)));
    // 虚构类型（DB-SCHEMA 文档手写产物）不得出现。
    // 接地纠偏（亲手真跑实证）：WO §1.3 所列 9 个"虚构"中 Supplier/Customer/Certification 经
    // `battery-extended.ts` def() 证实为**真实 ACTIVE 类型**（demo 本体 = battery + extended），
    // 投影包含它们是忠实真值而非虚构——真正的虚构是下列 6 个；集合相等断言（上行）是反虚构主闸。
    for (const fake of ["Capacity", "Route", "Bom", "Forecast", "Risk", "Action"]) {
      expect(projected.some((r) => r.key === fake), `${fake} 不在真实本体中，不得出现`).toBe(false);
    }
    // 真实核心类型必须被投影。
    for (const real of ["Process", "Equipment", "WorkOrder", "MaterialBalance", "OrderLine"]) {
      expect(projected.some((r) => r.key === real), `${real} 是真实类型，必须被投影`).toBe(true);
    }
    // 每条都是合法 IntelligenceResource（union 含 object_type 成员）且描述非空。
    expect(findInvalidResources(projected)).toEqual([]);
    for (const r of projected) expect(r.description.trim().length).toBeGreaterThan(0);
  });

  it("SEAM② 活投影：新建 object_type → 下次 list 即可发现（R13 请求态重投影，证非写死）", async () => {
    const before = await listResources(t, ADMIN, "?kind=object_type");
    expect(before.some((r) => r.key === "__ProbeType")).toBe(false);
    // 镜像 A 侧"建类型→已发布"：mock 本体推入新 ACTIVE 类型（投影 per-request 重算 = 缓存失效后语义）。
    t.dataCore.ontology.objectTypeDefs.push({
      key: "__ProbeType",
      displayName: "探针类型",
      description: "SEAM 探针",
      status: "ACTIVE",
      properties: [{ propKey: "probeNum", dataType: "number", unit: "次", description: "探针数值" }],
    });
    const after = (await listResources(t, ADMIN, "?kind=object_type")) as ObjectTypeResource[];
    const probe = after.find((r) => r.key === "__ProbeType");
    expect(probe, "新建类型必须出现在资源目录").toBeDefined();
    expect(probe!.label).toBe("探针类型");
    expect(probe!.description).toBe("SEAM 探针");
    // 连带 field 也活投影（type-semantics 同源）。
    const fields = (await listResources(t, ADMIN, "?kind=field")) as FieldResource[];
    expect(fields.some((f) => f.key === "__ProbeType.probeNum")).toBe(true);
  });

  it("SEAM③ field 带量纲：unit 真透出 + key 口径 typeKey.propKey", async () => {
    const fields = (await listResources(t, ADMIN, "?kind=field")) as FieldResource[];
    expect(fields.length).toBeGreaterThan(0);
    const withUnit = fields.filter((f) => f.unit);
    expect(withUnit.length, "本体已登记 unit 的属性必须带量纲透出").toBeGreaterThan(0);
    expect(fields.every((f) => f.key.includes(".")), "field key 口径为 typeKey.propKey").toBe(true);
    // 具体量纲抽查（mock 本体 Order.qty 单位 套）。
    const qty = fields.find((f) => f.key === "Order.qty");
    expect(qty?.unit).toBe("套");
    expect(qty?.objectType).toBe("Order");
    expect(qty?.propKey).toBe("qty");
    expect(findInvalidResources(fields)).toEqual([]);
  });

  it("SEAM④ 描述门有牙（变异反证）：空描述 object_type 候选必被 findUndescribed 抓到", () => {
    expect(findUndescribed([{ kind: "object_type", key: "X", label: "X", description: "" }]).length).toBe(1);
    // 且合法 object_type 候选不被误伤（object_type 已入 ResourceKindSchema）。
    expect(findUndescribed([{ kind: "object_type", key: "X", label: "X", description: "d" }]).length).toBe(0);
    // field 同理。
    expect(findUndescribed([{ kind: "field", key: "T.p", label: "p", description: "" }]).length).toBe(1);
  });

  it("SEAM⑤ R6 确定性：同租户两次投影 JSON.stringify 字节一致", async () => {
    const first = JSON.stringify(await listResources(t, ADMIN));
    const second = JSON.stringify(await listResources(t, ADMIN));
    expect(second).toBe(first);
  });

  it("object_type 投影带 inputSpec.objectTypes + L4 对象标签（WO T1 映射）", async () => {
    const projected = (await listResources(t, ADMIN, "?kind=object_type")) as ObjectTypeResource[];
    const proc = projected.find((r) => r.key === "Process");
    expect(proc?.inputSpec?.objectTypes).toEqual(["Process"]);
    expect(proc?.tieredTags?.l4_object).toContain("Process");
    expect(proc?.label).toBe("工序");
  });

  it("WO §4 兜底：缺描述类型合成 description 并标 descriptionSynthesized（只拼已有名，不编业务含义）", async () => {
    const projected = (await listResources(t, ADMIN, "?kind=object_type")) as ObjectTypeResource[];
    const wip = projected.find((r) => r.key === "WIPLot");
    expect(wip, "mock 本体 WIPLot（无类型级 description）必须仍被投影").toBeDefined();
    expect(wip!.descriptionSynthesized).toBe(true);
    expect(wip!.description.trim().length).toBeGreaterThan(0); // 合成非空（displayName/key 拼成）
    // 有真描述的类型不标 synthesized。
    const proc = projected.find((r) => r.key === "Process");
    expect(proc!.description).toBe("制造工序定义");
    expect(proc!.descriptionSynthesized).toBeUndefined();
  });

  it("SEAM⑥ 守卫同源（F1 回归）：目录可见 object_type 照名 query_objects 不被 UNKNOWN_TYPE 拒收", async () => {
    // 断在接缝实证（复审 F1）：mock listObjectTypeKeys 曾硬编码旧 10 key，不含目录投影暴露的
    // WorkOrder/MaterialBalance/OrderLine/WIPLot——Agent discover 看到 → 照名查询被拒 UNKNOWN_TYPE。
    // 修复后守卫清单 = 出厂基线 ∪ 投影同源 ACTIVE 集；本测试逐一驱动真守卫（executor.ts listObjectTypeKeys 路径）。
    const projected = (await listResources(t, ADMIN, "?kind=object_type")) as ObjectTypeResource[];
    expect(projected.length).toBeGreaterThan(0);
    const exec = new GuardedToolExecutor(
      { dataCore: t.dataCore, repos: createMemoryRepos(), metrics: new Metrics() },
      { taskId: "t_seam6", ctx: { tenantId: TENANT, userId: "admin", roles: ["admin"] }, budget: new BudgetTracker() },
    );
    for (const r of projected) {
      const res = await exec.run("query_objects", { objectType: r.key, filter: {} });
      expect(
        (res.payload as { error?: string }).error,
        `${r.key} 目录可见却被 query_objects 守卫 UNKNOWN_TYPE 拒收（F1 接缝回归）`,
      ).not.toBe("UNKNOWN_TYPE");
    }
    // 出厂基线不倒退：seed 引用面类型（Material「已知但 0 实例」语义）仍在守卫清单。
    // 经接口调用：MockDataCore 的实现漏掉了接口声明的 ctx 形参（src/mocks/clients.ts:376），
    // 直接调具体类型会 TS2554「Expected 0 arguments」。上转到它实现的接口 = 按契约真实形状调。
    const onto: OntologyClient = t.dataCore.ontology;
    const guardKeys = await onto.listObjectTypeKeys({ tenantId: TENANT, userId: "admin", roles: ["admin"] });
    for (const legacy of ["Material", "Shipment", "Segment", "Customer", "Line"]) {
      expect(guardKeys).toContain(legacy);
    }
  });

  it("投影器单测：projectObjectTypes 只投 ACTIVE + projectFields 量纲/合成兜底", () => {
    const defs = [
      { key: "Live", displayName: "活类型", status: "ACTIVE", properties: [{ propKey: "a", unit: "小时" }] },
      { key: "Dead", displayName: "死类型", status: "RETIRED", properties: [{ propKey: "b" }] },
      { key: "NoName", status: "ACTIVE" },
    ];
    const ots = projectObjectTypes(defs);
    expect(ots.map((r) => r.key)).toEqual(["Live", "NoName"]); // RETIRED 不投影
    expect(ots[1]!.description).toBe("NoName"); // displayName 缺 → key 兜底
    expect(ots[1]!.descriptionSynthesized).toBe(true);

    const fields = projectFields([{ typeKey: "Live", props: [{ propKey: "a", unit: "小时" }, { propKey: "c", description: "有描述" }] }]);
    expect(fields.map((f) => f.key)).toEqual(["Live.a", "Live.c"]);
    expect(fields[0]!.unit).toBe("小时");
    expect(fields[0]!.descriptionSynthesized).toBe(true); // 属性缺描述 → 合成 typeKey.propKey
    expect(fields[0]!.description).toBe("Live.a");
    expect(fields[1]!.descriptionSynthesized).toBeUndefined();
  });
});
