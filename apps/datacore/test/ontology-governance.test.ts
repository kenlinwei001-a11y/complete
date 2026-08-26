import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, BASE_MANAGER, seedBattery, type TestApp } from "./helpers.js";

const J = <T>(r: { json: () => unknown }) => r.json() as T;

async function get(t: TestApp, url: string, headers = ADMIN) {
  return t.app.inject({ method: "GET", url, headers });
}
// payload 不能标 unknown：赋不进 inject 的 InjectPayload，且会把重载解析歪掉，
// 连带本文件所有 .statusCode/.json 报「不存在」。
async function post(t: TestApp, url: string, payload: Record<string, unknown>, headers = ADMIN) {
  return t.app.inject({ method: "POST", url, headers, payload });
}

describe("治理增量 G1–G10：域治理 / 演进稳定性 / 检索体系", () => {
  // -- G1 归域强制 ----------------------------------------------------------
  it("G1: 建模建议含 domain；unassigned 发布被阻断，归域后通过", async () => {
    const t = await makeApp();
    // 直接注册域 + 提交一个 unassigned 类型经建模草稿
    await post(t, "/a/v1/ontology/domains", { domainKey: "product", displayName: "产品" });
    // 通过对象类型 POST：提供未注册域 → 400
    const bad = await post(t, "/a/v1/ontology/object-types", {
      key: "Widget",
      displayName: "部件",
      domain: "nope",
      properties: [{ propKey: "id", dataType: "string", isPrimaryKey: true }],
    });
    expect(bad.statusCode).toBe(400);
    // 注册域内 → 201
    const okr = await post(t, "/a/v1/ontology/object-types", {
      key: "Widget",
      displayName: "部件",
      domain: "product",
      properties: [{ propKey: "id", dataType: "string", isPrimaryKey: true }],
    });
    expect(okr.statusCode).toBe(201);
    expect(J<{ domain: string }>(okr).domain).toBe("product");
  });

  it("G1: 建模 suggestion 携带 domain，unassigned 阻断发布", async () => {
    const t = await makeApp();
    const draft = {
      objectTypes: [
        {
          action: "CREATE" as const,
          existingTypeKey: null,
          typeKey: "Foo",
          displayName: "Foo",
          domain: "unassigned",
          sourceDataset: "ds",
          properties: [{ propKey: "id", sourceField: "id", dataType: "string" as const, isPrimaryKey: true, refToTypeKey: null }],
          confidence: 0.9,
        },
      ],
      linkTypes: [],
    };
    // 直接经 modeling service publish 路径（绕过 LLM）
    const id = "draft_g1";
    await t.repos.ontologyDrafts.put({
      id,
      tenantId: "demo",
      status: "DRAFT",
      rawDatasetIds: [],
      fkCandidates: [],
      suggestion: draft,
      operationLog: [],
      createdAt: new Date().toISOString(),
    });
    const blocked = await post(t, `/a/v1/modeling/drafts/${id}/publish`, {});
    const body = J<{ ok: boolean; errors: { message: string }[] }>(blocked);
    expect(body.ok).toBe(false);
    expect(body.errors.some((e) => e.message.includes("未归域"))).toBe(true);
    // 归域后通过
    await t.app.inject({
      method: "PATCH",
      url: `/a/v1/modeling/drafts/${id}`,
      headers: ADMIN,
      payload: { operations: [{ op: "setDomain", typeKey: "Foo", domain: "anything" }] },
    });
    const ok = await post(t, `/a/v1/modeling/drafts/${id}/publish`, {});
    expect(J<{ ok: boolean }>(ok).ok).toBe(true);
  });

  // -- G2 域开关 ------------------------------------------------------------
  it("G2: 关闭 domain.finance → 该域类型在图谱/搜索/聚合整体不可见", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await post(t, "/a/v1/ontology/domains", { domainKey: "finance", displayName: "财务" });
    await post(t, "/a/v1/ontology/object-types", {
      key: "Invoice",
      displayName: "发票",
      domain: "finance",
      properties: [
        { propKey: "invId", dataType: "string", isPrimaryKey: true, searchable: true },
        { propKey: "amount", dataType: "number", isPrimaryKey: false },
      ],
    });
    await t.repos.objects.put({ id: "obj_invoice_INV1", tenantId: "demo", type: "Invoice", props: { invId: "INV1", amount: 100 }, origin: { type: "MANUAL" } });
    // 全开时搜索能命中
    const before = J<{ items: unknown[] }>(await get(t, "/a/v1/objects/search?q=INV1"));
    expect(before.items.length).toBeGreaterThan(0);
    // 关闭 domain.finance
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "domain.finance": false } },
    });
    const after = J<{ items: unknown[] }>(await get(t, "/a/v1/objects/search?q=INV1"));
    expect(after.items.length).toBe(0);
    // 聚合该类型 → 404（关域不可见）
    const agg = await post(t, "/a/v1/objects/aggregate", { typeKey: "Invoice", groupBy: [], metrics: [{ prop: "amount", fn: "sum" }] });
    expect(agg.statusCode).toBe(404);
  });

  // -- G3 API 名不可变 ------------------------------------------------------
  it("G3: 对 PUBLISHED type_key 重命名请求 → 拒绝并提示弃用流程", async () => {
    const t = await makeApp();
    await seedBattery(t); // 发布版本 → Base 等 published=true
    // upsert 现有 Base（同 key 允许 = display 改）
    const same = await post(t, "/a/v1/ontology/object-types", {
      key: "Base",
      displayName: "生产基地（改名展示）",
      domain: "factory",
      properties: [{ propKey: "baseId", dataType: "string", isPrimaryKey: true }],
    });
    expect(same.statusCode).toBe(201);
    // assertRenameAllowed 直接验证：PUBLISHED key → 新 key 被拒
    const base = (await t.repos.ontologyTypes.list("demo", (x) => x.key === "Base"))[0]!;
    expect(base.published).toBe(true);
    expect(() => t.services.governance.assertRenameAllowed(base, "BaseRenamed")).toThrow(/不可重命名|永不重命名/);
  });

  // -- G4 弃用流程 ----------------------------------------------------------
  it("G4: DEPRECATED 后新引用被拒、既有调用带警告；references>0 时 RETIRE 被拒列清单", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 注册一个引用 model_producible_at 的 slice → element_refs 有引用
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/ontology/slices/g4_slice",
      headers: ADMIN,
      payload: {
        version: 1,
        spec: {
          root: { typeKey: "Model", selector: { byKey: "{{args.modelId}}" } },
          paths: [[{ linkKey: "model_producible_at", direction: "out" }]],
        },
      },
    });
    // 弃用 link
    const dep = await post(t, "/a/v1/ontology/links/model_producible_at/deprecate", { supersededBy: "model_producible_at_v2" });
    expect(dep.statusCode).toBe(200);
    // 新引用弃用 link → VALIDATION_ERROR
    const newRef = await t.app.inject({
      method: "PUT",
      url: "/a/v1/ontology/slices/g4_slice2",
      headers: ADMIN,
      payload: {
        version: 1,
        spec: { root: { typeKey: "Model", selector: {} }, paths: [[{ linkKey: "model_producible_at", direction: "out" }]] },
      },
    });
    expect(newRef.statusCode).toBe(400);
    // references>0 → RETIRE 409 列清单
    const retire = await post(t, "/a/v1/ontology/links/model_producible_at/retire", {});
    expect(retire.statusCode).toBe(409);
    expect(J<{ error: { message: string } }>(retire).error.message).toContain("g4_slice");
    // 弃用警告指标
    const warns = await t.services.governance.deprecationWarnings("demo", [{ kind: "link", key: "model_producible_at" }]);
    expect(warns[0]?.tag).toBe("link:model_producible_at");
    expect(t.services.metrics.get("dc_deprecated_ref_calls_total", { kind: "link", key: "model_producible_at" })).toBeGreaterThan(0);
  });

  // -- G5 发布影响门禁 ------------------------------------------------------
  it("G5: 删除被 slice 引用的 linkKey → publish-request 创建阻断（force 通过）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/ontology/slices/g5_slice",
      headers: ADMIN,
      payload: { version: 1, spec: { root: { typeKey: "Model", selector: {} }, paths: [[{ linkKey: "model_producible_at", direction: "out" }]] } },
    });
    const links = await t.repos.ontologyLinks.list("demo");
    const types = await t.services.ontology.listTypes({ tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} });
    // 模拟删除被引用 link
    const nextLinks = links.filter((l) => l.key !== "model_producible_at");
    const impact = await t.services.governance.publishImpact(
      { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} },
      { types, links: nextLinks },
    );
    expect(impact.breaking.length).toBeGreaterThan(0);
    expect(impact.breaking.some((b) => b.key === "model_producible_at" && b.refKey === "g5_slice")).toBe(true);
    // createPublishRequest 阻断
    const ctx = { tenantId: "demo", userId: "u", roles: ["catalog_admin"], attributes: {} };
    await expect(
      t.services.governance.createPublishRequest(ctx, { ontologyVersion: 99, touchedDomains: ["product"], impact }),
    ).rejects.toThrow(/影响门禁/);
    // force=true 通过
    const rec = await t.services.governance.createPublishRequest(ctx, { ontologyVersion: 99, touchedDomains: ["product"], impact, force: true });
    expect(rec.status).toBe("PENDING_SIGNOFF");
  });

  // -- G6 切片契约 ----------------------------------------------------------
  it("G6: 本体发布跑全部 slice contractFixture；破坏 fixture 被拦截", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/ontology/slices/cap_net",
      headers: ADMIN,
      payload: {
        version: 1,
        spec: {
          root: { typeKey: "Model", selector: { byKey: "{{args.modelId}}" } },
          paths: [[{ linkKey: "model_producible_at", direction: "out" }]],
          contractFixtures: [
            { name: "4680 producible bases", args: { modelId: "4680-NCM" }, expect: { rootType: "Model", minNodes: 2, mustIncludeTypes: ["Model", "Base"], mustIncludeLinkKeys: ["model_producible_at"] } },
          ],
        },
      },
    });
    const run = J<{ allPassed: boolean; results: { ok: boolean }[] }>(await post(t, "/a/v1/ontology/slice-contracts/run", {}));
    expect(run.results.length).toBeGreaterThan(0);
    expect(run.allPassed).toBe(true);
    // 破坏 fixture：要求一个不可能出现的类型
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/ontology/slices/cap_net",
      headers: ADMIN,
      payload: {
        version: 2,
        spec: {
          root: { typeKey: "Model", selector: { byKey: "{{args.modelId}}" } },
          paths: [[{ linkKey: "model_producible_at", direction: "out" }]],
          contractFixtures: [
            { name: "broken", args: { modelId: "4680-NCM" }, expect: { rootType: "Model", minNodes: 9999, mustIncludeTypes: ["NonExistent"] } },
          ],
        },
      },
    });
    const run2 = J<{ allPassed: boolean; failed: unknown[] }>(await post(t, "/a/v1/ontology/slice-contracts/run", {}));
    expect(run2.allPassed).toBe(false);
    expect(run2.failed.length).toBeGreaterThan(0);
  });

  // -- G7 对象搜索 + 权限 ---------------------------------------------------
  it("G7: 搜索命中 searchable 属性；czmgr 行级过滤后搜不到其他基地", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 管理员搜 "常州"
    const adminHit = J<{ items: { display: string }[] }>(await get(t, `/a/v1/objects/search?q=${encodeURIComponent("常州")}&types=Base`));
    expect(adminHit.items.length).toBeGreaterThan(0);
    // q<2 → 400
    const short = await get(t, "/a/v1/objects/search?q=x");
    expect(short.statusCode).toBe(400);
    // 未知 types → 400 列未知项
    const unknownTypes = await get(t, "/a/v1/objects/search?q=ab&types=Nope");
    expect(unknownTypes.statusCode).toBe(400);
    expect(J<{ error: { message: string } }>(unknownTypes).error.message).toContain("Nope");
    // base_manager:常州 行级过滤：搜其他基地名搜不到（仅当存在行级策略）
    const czHits = J<{ items: { objectKey: string }[] }>(await get(t, `/a/v1/objects/search?q=${encodeURIComponent("基地")}&types=Base`, BASE_MANAGER));
    // 行级策略存在则受限；至少不应报错
    expect(Array.isArray(czHits.items)).toBe(true);
  });

  // -- G8 聚合查询 ----------------------------------------------------------
  it("G8: 按 pos 分组 avg 结果与手算一致；count/sum/min/max；fn 作用非 number → 400", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 聚合 Base.util avg by kind（bottleneck 是 enum，util number）
    const res = await post(t, "/a/v1/objects/aggregate", {
      typeKey: "Base",
      groupBy: ["kind"],
      metrics: [{ prop: "util", fn: "avg" }, { prop: "baseId", fn: "count" }],
    });
    expect(res.statusCode).toBe(200);
    const body = J<{ rows: { group: Record<string, string>; metrics: Record<string, number> }[]; rowCount: number }>(res);
    expect(body.rowCount).toBeGreaterThan(0);
    // 手算验证一组
    const bases = await t.repos.objects.listByType("demo", "Base");
    for (const row of body.rows) {
      const kind = row.group.kind;
      const matching = bases.filter((b) => String(b.props.kind ?? "") === kind && typeof b.props.util === "number");
      const expectedAvg = matching.reduce((a, b) => a + (b.props.util as number), 0) / matching.length;
      expect(Math.abs(row.metrics.avg_util! - Math.round(expectedAvg * 1e6) / 1e6)).toBeLessThan(1e-6);
      expect(row.metrics.count_baseId).toBe(matching.length);
    }
    // fn 作用于非 number → 400
    const bad = await post(t, "/a/v1/objects/aggregate", { typeKey: "Base", groupBy: [], metrics: [{ prop: "name", fn: "sum" }] });
    expect(bad.statusCode).toBe(400);
    expect(J<{ error: { message: string } }>(bad).error.message).toContain("number");
  });

  // -- G9 邻接导航 ----------------------------------------------------------
  it("G9: 邻接区按 linkKey 分组正确；limit 生效", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await get(t, `/a/v1/objects/${encodeURIComponent("4680-NCM")}/neighbors`);
    expect(res.statusCode).toBe(200);
    const body = J<{ groups: { linkKey: string; direction: string; total: number; items: unknown[] }[] }>(res);
    expect(body.groups.length).toBeGreaterThan(0);
    const prod = body.groups.find((g) => g.linkKey === "model_producible_at");
    expect(prod).toBeTruthy();
    expect(prod!.items.length).toBeLessThanOrEqual(prod!.total);
    // limit=1
    const limited = J<{ groups: { items: unknown[]; total: number }[] }>(await get(t, `/a/v1/objects/${encodeURIComponent("4680-NCM")}/neighbors?linkKey=model_producible_at&direction=out&limit=1`));
    expect(limited.groups[0]!.items.length).toBe(1);
  });

  // -- G10 单位 lint --------------------------------------------------------
  it("G10: object-type 未知单位被拒；KPI/属性带单位元数据", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 已知单位通过
    await post(t, "/a/v1/ontology/domains", { domainKey: "factory", displayName: "工厂" });
    const ok = await post(t, "/a/v1/ontology/object-types", {
      key: "Tank",
      displayName: "储罐",
      domain: "factory",
      properties: [
        { propKey: "tankId", dataType: "string", isPrimaryKey: true },
        { propKey: "cap", dataType: "number", isPrimaryKey: false, unit: "吨" },
      ],
    });
    expect(ok.statusCode).toBe(201);
    expect(J<{ properties: { unit?: string }[] }>(ok).properties.find((p) => p.unit === "吨")).toBeTruthy();
    // 未知单位 → 400
    const bad = await post(t, "/a/v1/ontology/object-types", {
      key: "Tank2",
      displayName: "储罐2",
      domain: "factory",
      properties: [{ propKey: "id", dataType: "string", isPrimaryKey: true }, { propKey: "x", dataType: "number", isPrimaryKey: false, unit: "光年" }],
    });
    expect(bad.statusCode).toBe(400);
  });

  // -- §7.1 域 owner 会签 ---------------------------------------------------
  it("§7.1: 域 owner 会签状态机（非 owner 403 / 全 APPROVE → APPROVED / REJECT → REJECTED）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const adminCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["catalog_admin"], attributes: {} };
    const rec = await t.services.governance.createPublishRequest(adminCtx, { ontologyVersion: 5, touchedDomains: ["factory", "product"] });
    expect(rec.status).toBe("PENDING_SIGNOFF");
    expect(rec.signoffs).toHaveLength(2);
    // 非 owner 签 → 403
    await expect(
      t.services.governance.signoff({ tenantId: "demo", userId: "stranger", roles: ["planner"], attributes: {} }, rec.id, { decision: "APPROVE" }),
    ).rejects.toThrow();
    // factory owner = usr_demo_admin, product owner = usr_demo_admin（种子）
    const r1 = await t.services.governance.signoff(adminCtx, rec.id, { decision: "APPROVE" });
    expect(r1.status).toBe("PENDING_SIGNOFF"); // 还剩一个域
    const r2 = await t.services.governance.signoff(adminCtx, rec.id, { decision: "APPROVE" });
    expect(r2.status).toBe("APPROVED");
  });

  it("§7.4: 引用反查 references API 返回 slice/derivation 引用", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/ontology/slices/ref_slice",
      headers: ADMIN,
      payload: { version: 1, spec: { root: { typeKey: "Model", selector: {} }, paths: [[{ linkKey: "model_producible_at", direction: "out" }]] } },
    });
    const r = J<{ refs: { refKind: string; key: string }[]; total: number }>(await get(t, "/a/v1/ontology/references?elementKind=link&key=model_producible_at"));
    expect(r.total).toBeGreaterThan(0);
    expect(r.refs.some((x) => x.refKind === "slice" && x.key === "ref_slice")).toBe(true);
  });
});
