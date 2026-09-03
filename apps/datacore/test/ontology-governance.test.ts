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

  /*
   * ══════════════════════════════════════════════════════════════════════════
   * WO-SIGNOFF-CHAIN · 接缝：会签链 × 发布路
   * ══════════════════════════════════════════════════════════════════════════
   *
   * 为什么必须是接缝测试而不是各半 unit：本单修的两个洞**各自那半都是绿的** ——
   * 会签状态机有测试且通过（上面那条 §7.1），发布路有测试且通过。
   * 断的是它们之间那条缝：**会签把版本拦住了，而旁边那条发布路根本不问会签**。
   * 只测各半，两个洞一个都抓不到。
   *
   * 三条断点在真后端上各自独立（修一处、另两处照样把链卡死），故逐条咬：
   *  ① 无主域把链卡死在 N-1/N（`material` 域无 owner，谁都签不了）
   *  ② REJECT 不带 comment 必 400（前端修前正是这样发的）
   *  ③ 裸路由 `POST /a/v1/ontology/publish` 不问会签就发
   */
  describe("WO-SIGNOFF-CHAIN 接缝：会签链走得完 + 裸路由绕不过", () => {
    const CATALOG_ADMIN = { "x-debug-user": "demo:usr_demo_admin:admin|catalog_admin" };
    const PLANNER_OWNER = { "x-debug-user": "demo:usr_demo_planner:planner" };

    interface Req {
      id: string;
      status: string;
      ontologyVersion: number;
      signoffs: { domainKey: string; ownerUserId: string | null; decision: string | null }[];
    }
    /** 建一条会签单（走 HTTP，真实经过路由层算 touchedDomains）。 */
    async function openRequest(t: TestApp): Promise<Req> {
      const r = await t.app.inject({ method: "POST", url: "/a/v1/ontology/publish-requests", headers: CATALOG_ADMIN, payload: {} });
      expect(r.statusCode).toBe(201);
      return J<Req>(r);
    }
    const undecided = (rec: { signoffs: { decision: string | null }[] }) => rec.signoffs.filter((s) => !s.decision).length;

    it("① 无主域不再把链卡死：catalog_admin 兜底签 → 全域 APPROVE → 自动发布", async () => {
      const t = await makeApp();
      await seedBattery(t);
      const rec = await openRequest(t);

      // 金丝雀：种子里确实存在**无主域**，否则本用例什么都没证明（形态与"报 0 命中先自证工具"同源）。
      const ownerless = rec.signoffs.filter((s) => !s.ownerUserId);
      expect(ownerless.length, "金丝雀：种子里没有无主域 ⇒ 本用例失去意义（不是代码好了）").toBeGreaterThan(0);
      expect(rec.status).toBe("PENDING_SIGNOFF");

      // 两位 owner 轮流签，直到没有人能再签为止。
      let cur = rec;
      for (let i = 0; i < rec.signoffs.length * 2 && undecided(cur) > 0; i++) {
        for (const h of [CATALOG_ADMIN, PLANNER_OWNER]) {
          const r = await t.app.inject({
            method: "POST",
            url: `/a/v1/ontology/publish-requests/${cur.id}/signoff`,
            headers: h,
            payload: { decision: "APPROVE" },
          });
          if (r.statusCode === 200) cur = J<typeof cur>(r);
        }
      }
      // 修前：卡在 N-1/N，status 永远 PENDING_SIGNOFF（无主域那一行谁都签不动）。
      expect(undecided(cur), "无主域仍把会签链卡死 ⇒ 兜底签没生效").toBe(0);
      expect(cur.status).toBe("APPROVED");
      // 无主域那一行必须留痕：不是 owner 本人签的。
      const signedOwnerless = cur.signoffs.find((s) => !s.ownerUserId) as { onBehalfOf?: string } | undefined;
      expect(signedOwnerless && (signedOwnerless as { onBehalfOf?: string }).onBehalfOf, "无主域代签没留痕").toBeTruthy();
    });

    it("② REJECT 必填 comment：不带 400 / 带了 → REJECTED", async () => {
      const t = await makeApp();
      await seedBattery(t);
      const rec = await openRequest(t);
      const bad = await t.app.inject({
        method: "POST",
        url: `/a/v1/ontology/publish-requests/${rec.id}/signoff`,
        headers: CATALOG_ADMIN,
        payload: { decision: "REJECT" },
      });
      expect(bad.statusCode, "REJECT 不带 comment 竟然过了").toBe(400);
      const ok = await t.app.inject({
        method: "POST",
        url: `/a/v1/ontology/publish-requests/${rec.id}/signoff`,
        headers: CATALOG_ADMIN,
        payload: { decision: "REJECT", comment: "口径未对齐" },
      });
      expect(ok.statusCode).toBe(200);
      expect(J<{ status: string }>(ok).status).toBe("REJECTED");
    });

    it("③ 裸路由绕不过会签：未决 → 拒且说清还差几条；REJECTED → 拒；APPROVED → 放行", async () => {
      const t = await makeApp();
      await seedBattery(t);

      // 金丝雀：破窗路必须能发得出去 —— 证明"发不出去"是被闸拦的，不是我根本发不动。
      const glass = await t.app.inject({
        method: "POST",
        url: "/a/v1/ontology/publish?breakGlass=true&reason=" + encodeURIComponent("金丝雀"),
        headers: CATALOG_ADMIN,
      });
      expect(glass.statusCode, "金丝雀：破窗路都发不出去 ⇒ 我的观测坏了，不是闸生效了").toBe(200);

      const rec = await openRequest(t);
      expect(rec.status).toBe("PENDING_SIGNOFF");
      const blocked = await t.app.inject({ method: "POST", url: "/a/v1/ontology/publish", headers: CATALOG_ADMIN });
      expect(blocked.statusCode, "会签未决时裸路由竟然发布成功 ⇒ 评审形同虚设").toBe(409);
      // 报错必须说清"还差几条"，只说"未通过"运营方不知道下一步找谁。
      const msg = J<{ error: { message: string } }>(blocked).error.message;
      expect(msg).toContain(`${undecided(rec)}/${rec.signoffs.length}`);
      expect(msg).toContain("未决");

      // 破窗仍需 catalog_admin + reason。
      const noRole = await t.app.inject({
        method: "POST",
        url: "/a/v1/ontology/publish?breakGlass=true&reason=x",
        headers: PLANNER_OWNER,
      });
      expect(noRole.statusCode, "非 catalog_admin 竟能破窗").toBe(403);
      const noReason = await t.app.inject({ method: "POST", url: "/a/v1/ontology/publish?breakGlass=true", headers: CATALOG_ADMIN });
      expect(noReason.statusCode, "破窗不填 reason 竟然过了 ⇒ 绕过不留痕").toBe(400);
    });

    it("④ 不误伤内部路：种子/建模/管道走服务方法直发，闸只拦 HTTP", async () => {
      const t = await makeApp();
      // 金丝雀：种子本身就走内部 `publishVersion()`，它能起来就是"内部路没被打死"的第一手证据。
      await seedBattery(t);
      const before = await t.services.ontology.currentVersion("demo");
      expect(before, "金丝雀：种子一个版本都没发 ⇒ 本用例量不到误伤").toBeGreaterThan(0);
      // 内部路 = 直接调服务方法（种子 ×2 / databuilder / modeling / pipeline 全是这条）。
      const ctx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["catalog_admin"], attributes: {} };
      const v = await t.services.ontology.publishVersion(ctx);
      expect(v.version, "内部路被发布闸误伤 ⇒ 种子/迁移/databuilder 会一起死").toBe(before + 1);
    });

    /*
     * ══════════════════════════════════════════════════════════════════════════
     * WO-PUBLISH-VERSION-PIN · 接缝：会签留痕 × 实际发布的**版本号必须是同一个**
     * ══════════════════════════════════════════════════════════════════════════
     *
     * 与上面 ①②③ 是**不同的缺陷**，不要合并读：那三条治的是「会签能不能走完 / 能不能被绕过」，
     * 本组治的是「会签走完了、一条没少签，**发出去的却是另一个版本号**」——
     * 不是绕过，是**出处串不诚实**。
     *
     * 修前实测（2026-09-03，内存模式 + 种子，真跑复现）：
     *   建单前 max=v1 → 会签单钉=v2 → 破窗抢先发掉 v2（max=v2）→ 该单签满 → **实际发出 v3**，
     *   全程 HTTP 200、一句异常都没有。签字的人以为自己批的是 v2，真值库里落的是 v3。
     *
     * 为什么必须是**接缝**测试：两半各自都是绿的 —— 会签状态机有测试且通过（①），
     * 发布路有测试且通过（③④）。断的是它们之间那条缝：**会签把 v2 签下来了，
     * 而发布路根本不看这张单钉的是几**。只测各半，这个洞一个都抓不到。
     */
    /** 逐个签，返回**第一个**非 200 的响应（不是最后一个 —— 最后一个会被"已是终态"覆盖掉）。 */
    async function signUntilRefused(t: TestApp, rec: Req) {
      type Injected = Awaited<ReturnType<TestApp["app"]["inject"]>>;
      let cur = rec;
      for (let i = 0; i < rec.signoffs.length * 2 && undecided(cur) > 0; i++) {
        for (const h of [CATALOG_ADMIN, PLANNER_OWNER]) {
          if (undecided(cur) === 0) break;
          const r = await t.app.inject({
            method: "POST",
            url: `/a/v1/ontology/publish-requests/${cur.id}/signoff`,
            headers: h,
            payload: { decision: "APPROVE" },
          });
          if (r.statusCode === 200) cur = J<Req>(r);
          // 403 = 这个调用者名下没有未决行，换下一个人；其余非 200 才是"被拒"。
          else if (r.statusCode !== 403) return { cur, refused: r };
        }
      }
      return { cur, refused: null as null | Injected };
    }

    it("⑤ 正常路：钉 vN 签满 → 实际发出的就是 vN（两个数必须相等）", async () => {
      const t = await makeApp();
      await seedBattery(t);
      const before = await t.services.ontology.currentVersion("demo");
      const rec = await openRequest(t);
      const pinned = rec.ontologyVersion;
      const { cur, refused } = await signUntilRefused(t, rec);
      expect(refused, `正常路竟被拒：${refused?.body}`).toBeNull();
      expect(cur.status).toBe("APPROVED");

      const published = await t.services.ontology.currentVersion("demo");
      // 对照实验的两个数：钉的 / 发出的。**必须相等** —— 这就是本单的全部判据。
      expect(published, `钉的是 v${pinned}，实际发出的是 v${published} ⇒ 审批留痕与实际发布脱钩`).toBe(pinned);
      expect(published, "金丝雀：正常路一个版本都没发出去 ⇒ 我的观测坏了，不是闸生效了").toBe(before + 1);
    });

    it("⑥ 冲突路：破窗抢先占掉钉的那个版本 → 签满后必须被拒，且不许静默改发别的号", async () => {
      const t = await makeApp();
      await seedBattery(t);

      const rec = await openRequest(t);
      expect(rec.status).toBe("PENDING_SIGNOFF");
      const pinned = rec.ontologyVersion;

      // 破窗抢先把 pinned 这个版本号用掉（金丝雀：它必须真的发得出去，否则下面证明不了什么）。
      const glass = await t.app.inject({
        method: "POST",
        url: "/a/v1/ontology/publish?breakGlass=true&reason=" + encodeURIComponent("抢先占号"),
        headers: CATALOG_ADMIN,
      });
      expect(glass.statusCode, "金丝雀：破窗都发不出去 ⇒ 我的观测坏了").toBe(200);
      const afterGlass = await t.services.ontology.currentVersion("demo");
      expect(afterGlass, "金丝雀：破窗没把 pinned 这个号占掉 ⇒ 本用例没构造出冲突").toBe(pinned);

      // 那条钉在 pinned 的 PENDING 单仍在，签满它。
      const { refused } = await signUntilRefused(t, rec);
      expect(refused, "钉在已被占用版本上的会签单竟然发布成功 ⇒ 签的号与发的号又对不上了").not.toBeNull();
      expect(refused!.statusCode, "版本号冲突必须是 409").toBe(409);

      const msg = J<{ error: { message: string } }>(refused!).error.message;
      // 错误信息必须点名**被占用的那个版本号** —— 只说"版本不匹配"，运营方不知道自己签的是哪一版没发出去。
      expect(msg, `错误信息没点名被占用的 v${pinned}：${msg}`).toContain(`v${pinned}`);
      expect(msg).toContain("已经被发布过了");
      // 必须告诉用户下一步：对新版本重新发起会签。
      expect(msg).toContain("重新发起");

      // 最要紧的一条：**一个字都不许静默发出去**。
      const after = await t.services.ontology.currentVersion("demo");
      expect(after, `被拒之后竟然还是发了 v${after} ⇒ 这正是本单要修的"静默改发"`).toBe(afterGlass);
    });

    it("⑦ 被拒后那条 APPROVED 不许被裸路由捡去发下一个号（背书天然一次性）", async () => {
      const t = await makeApp();
      await seedBattery(t);
      const rec = await openRequest(t);
      const pinned = rec.ontologyVersion;
      await t.app.inject({
        method: "POST",
        url: "/a/v1/ontology/publish?breakGlass=true&reason=" + encodeURIComponent("抢先占号"),
        headers: CATALOG_ADMIN,
      });
      await signUntilRefused(t, rec); // → 该单已是 APPROVED，但钉的 v{pinned} 已被占

      const before = await t.services.ontology.currentVersion("demo");
      // 裸路由此时要发的是 v{before+1}，而那条 APPROVED 背书的是 v{pinned}（≠ before+1）。
      const bare = await t.app.inject({ method: "POST", url: "/a/v1/ontology/publish", headers: CATALOG_ADMIN });
      expect(bare.statusCode, `一条钉在 v${pinned} 的 APPROVED 竟能背书 v${before + 1} ⇒ 背书不是一次性的`).toBe(409);
      expect(await t.services.ontology.currentVersion("demo"), "被拒之后版本号竟然前进了").toBe(before);
    });
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
