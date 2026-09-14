import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StoryBuildRun } from "@platform/contracts";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { createMemoryRepos } from "../src/repo/memory.js";
import { PgStore } from "../src/repo/pg.js";
import type { Repos } from "../src/repo/repo.js";

/**
 * WO-DBUI-FLOW · 入库前冲突预检（第 ⑥ 步「人工确定入库」的输入）——**接缝驱动测试**。
 *
 * 仓主原话：「模拟的数据是否可以入库，**需要系统再次复验自检，因为人不清楚系统里面的数据现状，
 * 是否有冲突等等**」。
 *
 * 咬死四件事（每一件都对应一个曾经的静默行为）：
 *   ① 三类冲突**各自**被报出（合成一个数 = 让人无法裁决）；
 *   ② 每条给 `既有值` / `将写值` / `建议动作`；
 *   ③ 预检**一个字节都不写**（全表指纹逐字节相同；先跑金丝雀证明指纹函数会变，防恒空假绿）；
 *   ④ 会改写既有链路定义的冲突**无裁决不许写**（老行为是无条件覆盖 = 静默真值写入）。
 */
const SCRIPT = "常州基地产能紧张，影响订单交期与客户信用，请做风险推演";

/**
 * 全表指纹：遍历 `Repos` 上**每一个**带 `list(tenantId)` 的仓储，对给定租户逐条哈希。
 *
 * ⚠ 为什么是遍历而不是点名几张表：点名的表会随功能增长过期，
 *   而「预检只读」这条不变量必须对**所有**表成立。遍历 = 新增表自动进指纹。
 */
async function worldFingerprint(repos: Repos, tenants: string[]): Promise<{ hash: string; rows: number; tables: number }> {
  const parts: string[] = [];
  let rows = 0;
  let tables = 0;
  for (const [name, store] of Object.entries(repos as unknown as Record<string, unknown>).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const s = store as { list?: (t: string) => Promise<unknown> };
    if (!s || typeof s.list !== "function") continue;
    for (const tn of tenants) {
      let listed: unknown;
      try {
        listed = await s.list(tn);
      } catch {
        continue; // list 需要额外实参的仓储（如 rawRows(tenantId, datasetId)）跳过
      }
      if (!Array.isArray(listed)) continue;
      tables++;
      rows += listed.length;
      const body = listed
        .map((r) => JSON.stringify(r, Object.keys(r as object).sort()))
        .sort()
        .join("|");
      parts.push(`${name}@${tn}#${listed.length}:${body}`);
    }
  }
  return { hash: createHash("sha256").update(parts.join("\n")).digest("hex"), rows, tables };
}

type Precheck = {
  runId: string;
  counts: { typeSameKey: number; linkSameKeyDiffDef: number; linkSameKeySameDef: number };
  conflicts: {
    kind: string;
    target: string;
    key: string;
    existingValue: Record<string, string>;
    incomingValue: Record<string, string>;
    changedFields: string[];
    suggestedAction: string;
    availableActions: string[];
    requiresDecision: boolean;
  }[];
  clean: { objectTypes: number; linkTypes: number };
  drift: { changed: boolean; diffs: { dim: string; field: string; atBuild: string; atPrecheck: string }[] };
  pendingDecisions: number;
};

async function buildProvisionalDomain(t: TestApp): Promise<{ id: string; provNs: string }> {
  const prov = (await (
    await t.app.inject({
      method: "POST",
      url: "/a/v1/databuilder/runs",
      headers: ADMIN,
      payload: { script: SCRIPT, seed: 7, buildMode: "PROVISIONAL" },
    })
  ).json()) as { id: string; provisionalNamespace?: string };
  expect(prov.provisionalNamespace).toMatch(/::prov::/);
  return { id: prov.id, provNs: prov.provisionalNamespace! };
}

/**
 * ⚠ **金丝雀（照 CLAUDE.md 铁律 0.5「接了线没数据」的先例，机器先说话）**
 *
 * 实测：故事建域路径**今天一条链路类型都不往隔离命名空间写** —— `promoteDomain` 的链路迁移循环
 * （`service.ts` 里那个 `for (const lt of provLinks)`）属「**接了线没数据**」：接线真实存在、
 * 逐层追过（`ontologyLinks` 的全部写方 = `modeling.ts:452` / `synthetic/service.ts:690` /
 * `pipeline/service.ts:143` / `app.ts:3088` / 版本快照恢复，**没有一个跑在 provNs 里**），
 * 但输入恒空 ⇒ 那条「无条件覆盖」的静默真值写入**今天打不响**。
 *
 * 所以下面的链路冲突用例**必须显式往 provNs 塞链路**才驱动得到 —— 这不是造假数据，
 * 是给「将来把链路接进建域 / 由别的路径产出的域」守的那道门。
 *
 * 本断言写死 0：哪天有人真把链路接进建域，这里**当场变红**，逼人回来重读这段而不是靠记性。
 */
async function assertLinkWiringCanary(t: TestApp, provNs: string): Promise<void> {
  expect((await t.repos.ontologyLinks.list(provNs)).length).toBe(0);
}

/** 把链路类型显式种进隔离命名空间（见上方金丝雀说明）。 */
async function seedProvLink(
  t: TestApp,
  provNs: string,
  l: { key: string; fromTypeKey: string; toTypeKey: string; cardinality: "1:1" | "1:N" | "N:1" | "N:N" },
): Promise<void> {
  await t.repos.ontologyLinks.put({ id: `ltype_prov_${l.key}`, tenantId: provNs, version: 1, ...l });
}

describe("WO-DBUI-FLOW · 入库前冲突预检（只读 · 三类分开 · 无裁决不许覆盖）", () => {
  it("真租户先造同 key 类型 + 定义不同的链路 → 预检三类冲突各自报出，带既有值/将写值/建议动作", async () => {
    const t: TestApp = await makeApp();
    const { id, provNs } = await buildProvisionalDomain(t);

    const provTypes = await t.repos.ontologyTypes.list(provNs);
    expect(provTypes.length).toBeGreaterThan(0);
    await assertLinkWiringCanary(t, provNs);
    await seedProvLink(t, provNs, { key: "order_of_customer", fromTypeKey: "Order", toTypeKey: "Customer", cardinality: "N:1" });
    await seedProvLink(t, provNs, { key: "line_of_base", fromTypeKey: "Line", toTypeKey: "Base", cardinality: "N:1" });
    const provLinks = await t.repos.ontologyLinks.list(provNs);
    expect(provLinks.length).toBe(2);

    // ---- 在真租户里先造冲突（这就是「人不清楚系统里面的数据现状」的那个现状）----------
    // ① 同 key 的对象类型（真租户已有 ⇒ 今天静默跳过、且不计入 migratedTypes）
    const clash = provTypes[0];
    await t.repos.ontologyTypes.put({
      id: "otype_clash",
      tenantId: "demo",
      key: clash!.key,
      displayName: "库里那个（与故事要的不一样）",
      domain: "legacy",
      properties: [],
      derivedProperties: [],
      sourceBindings: [],
      version: 1,
      status: "ACTIVE",
    });
    // ② 同 key 但定义不同的链路（今天无条件覆盖 = 静默的本体真值写入）
    const diffLink = provLinks[0];
    await t.repos.ontologyLinks.put({
      id: "ltype_diff",
      tenantId: "demo",
      key: diffLink!.key,
      fromTypeKey: "LegacyFrom",
      toTypeKey: "LegacyTo",
      cardinality: diffLink!.cardinality === "1:N" ? "N:N" : "1:N",
      version: 3,
    });
    // ③ 同 key 且定义完全相同的链路（覆盖但无语义变化）——第二条链路，没有就用同一条造不了，跳过断言
    const sameLink = provLinks[1];
    if (sameLink) {
      await t.repos.ontologyLinks.put({
        id: "ltype_same",
        tenantId: "demo",
        key: sameLink.key,
        fromTypeKey: sameLink.fromTypeKey,
        toTypeKey: sameLink.toTypeKey,
        cardinality: sameLink.cardinality,
        version: 2,
      });
    }

    const res = await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${id}/promote-precheck`, headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const pc = res.json() as Precheck;

    // ---- ① 三类**分开**报，不是一个合计数 ----------------------------------------
    expect(pc.counts.typeSameKey).toBeGreaterThanOrEqual(1);
    expect(pc.counts.linkSameKeyDiffDef).toBe(1);
    if (sameLink) expect(pc.counts.linkSameKeySameDef).toBe(1);

    const typeC = pc.conflicts.find((c) => c.kind === "TYPE_SAME_KEY" && c.key === clash!.key);
    expect(typeC).toBeTruthy();
    // ---- ② 每条给：既有值 / 将写值 / 建议动作 -------------------------------------
    expect(typeC!.existingValue["显示名"]).toBe("库里那个（与故事要的不一样）");
    expect(typeC!.incomingValue["显示名"]).toBe(clash!.displayName);
    expect(typeC!.suggestedAction).toBe("USE");
    expect(typeC!.changedFields).toContain("显示名");

    const diffC = pc.conflicts.find((c) => c.kind === "LINK_SAME_KEY_DIFF_DEF");
    expect(diffC!.key).toBe(diffLink!.key);
    expect(diffC!.existingValue["起点类型"]).toBe("LegacyFrom");
    expect(diffC!.incomingValue["起点类型"]).toBe(diffLink!.fromTypeKey);
    expect(diffC!.changedFields.length).toBeGreaterThan(0);
    // 「会改掉既有定义」这一类必须堵：无裁决不许写
    expect(diffC!.requiresDecision).toBe(true);
    expect(diffC!.availableActions).toEqual(["USE", "MERGE"]);
    expect(pc.pendingDecisions).toBe(1);

    if (sameLink) {
      const sameC = pc.conflicts.find((c) => c.kind === "LINK_SAME_KEY_SAME_DEF");
      expect(sameC!.key).toBe(sameLink.key);
      expect(sameC!.changedFields).toEqual([]); // 定义全同 ⇒ 无差异字段
      expect(sameC!.requiresDecision).toBe(false); // 写了个一样的 ⇒ 无害，不堵
      expect(sameC!.suggestedAction).toBe("MERGE");
    }

    // ---- ③ 「建域后世界变了」：T1 建域时那份 vs T2 预检时现算 ----------------------
    // 上面刚往真租户塞了个同 key 类型 ⇒ analyzeGap 的 existing/toCreate 必然移位。
    expect(pc.drift.changed).toBe(true);
    expect(pc.drift.diffs.some((d) => d.dim === "gap")).toBe(true);
  });

  it("预检是只读的：全表指纹逐字节相同（金丝雀先证明指纹函数会变，防恒空假绿）", async () => {
    const t: TestApp = await makeApp();
    const { id, provNs } = await buildProvisionalDomain(t);
    const provTypes = await t.repos.ontologyTypes.list(provNs);
    await t.repos.ontologyTypes.put({
      id: "otype_clash2",
      tenantId: "demo",
      key: provTypes[0]!.key!,
      displayName: "库里那个",
      properties: [],
      derivedProperties: [],
      sourceBindings: [],
      version: 1,
      status: "ACTIVE",
    });

    const scope = ["demo", provNs];
    const before = await worldFingerprint(t.repos, scope);

    // 金丝雀：先证明这个指纹函数**真的会变** —— 否则「跑前后相同」可能只是它恒返回同一个空值。
    await t.repos.ontologyLinks.put({
      id: "ltype_canary",
      tenantId: "demo",
      key: "__canary_link__",
      fromTypeKey: "A",
      toTypeKey: "B",
      cardinality: "1:N",
      version: 1,
    });
    const afterCanary = await worldFingerprint(t.repos, scope);
    expect(afterCanary.hash).not.toBe(before.hash); // ← 金丝雀命中：指纹会变
    expect(afterCanary.tables).toBeGreaterThan(20); // ← 且它真的扫到了表，不是空集
    expect(afterCanary.rows).toBeGreaterThan(0); // ← 且真的有行，不是恒空

    // 基线重取（含金丝雀那条），然后跑预检 —— 预检前后必须逐字节相同
    const base = await worldFingerprint(t.repos, scope);
    const res = await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${id}/promote-precheck`, headers: ADMIN });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Precheck).counts.typeSameKey).toBeGreaterThanOrEqual(1); // 确实算出了东西，不是空跑
    const after = await worldFingerprint(t.repos, scope);
    expect(after.hash).toBe(base.hash);
    expect(after.rows).toBe(base.rows);

    // 连跑两次也不写（幂等只读）
    await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${id}/promote-precheck`, headers: ADMIN });
    expect((await worldFingerprint(t.repos, scope)).hash).toBe(base.hash);
  });

  it("无裁决不许写：会改写既有链路定义时 promote 显式报错；带裁决 USE 则保住既有定义", async () => {
    const t: TestApp = await makeApp();
    const { id, provNs } = await buildProvisionalDomain(t);
    await assertLinkWiringCanary(t, provNs);
    await seedProvLink(t, provNs, { key: "order_of_customer", fromTypeKey: "Order", toTypeKey: "Customer", cardinality: "N:1" });
    const diffLink = (await t.repos.ontologyLinks.list(provNs))[0];
    await t.repos.ontologyLinks.put({
      id: "ltype_diff",
      tenantId: "demo",
      key: diffLink!.key,
      fromTypeKey: "LegacyFrom",
      toTypeKey: "LegacyTo",
      cardinality: "N:N",
      version: 9,
    });

    // 老调用方（不带 decisions）撞上「会改写既有定义」⇒ **显式报错**，绝不静默覆盖
    const blocked = await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${id}/promote`, headers: ADMIN });
    expect(blocked.statusCode).toBe(400);
    expect(JSON.stringify(blocked.json())).toContain(diffLink!.key);
    // 既有定义**没被动过**（被拦下 = 真值未写）
    const stillLegacy = (await t.repos.ontologyLinks.list("demo", (l) => l.key === diffLink!.key))[0];
    expect(stillLegacy!.fromTypeKey).toBe("LegacyFrom");

    // 人裁决 USE（沿用既有、不覆盖）⇒ 放行，且既有定义保住
    const ok = await t.app.inject({
      method: "POST",
      url: `/a/v1/databuilder/runs/${id}/promote`,
      headers: ADMIN,
      payload: { decisions: [{ target: "linkType", key: diffLink!.key, action: "USE" }] },
    });
    expect(ok.statusCode).toBe(200);
    const promoted = ok.json() as { domainTrustLevel: string; domainPromotion?: { keptLinkKeys?: string[]; overwrittenLinkKeys?: string[]; reusedTypeKeys?: string[] } };
    expect(promoted.domainTrustLevel).toBe("GOVERNED");
    expect(promoted.domainPromotion?.keptLinkKeys).toContain(diffLink!.key);
    expect(promoted.domainPromotion?.overwrittenLinkKeys ?? []).not.toContain(diffLink!.key);
    const kept = (await t.repos.ontologyLinks.list("demo", (l) => l.key === diffLink!.key))[0];
    expect(kept!.fromTypeKey).toBe("LegacyFrom"); // 既有真值一个字节没动
  });

  it("裁决 MERGE ⇒ 覆盖并留痕（R4：每条都是一次经审批的真值写入）", async () => {
    const t: TestApp = await makeApp();
    const { id, provNs } = await buildProvisionalDomain(t);
    await assertLinkWiringCanary(t, provNs);
    await seedProvLink(t, provNs, { key: "order_of_customer", fromTypeKey: "Order", toTypeKey: "Customer", cardinality: "N:1" });
    const diffLink = (await t.repos.ontologyLinks.list(provNs))[0];
    await t.repos.ontologyLinks.put({
      id: "ltype_diff",
      tenantId: "demo",
      key: diffLink!.key,
      fromTypeKey: "LegacyFrom",
      toTypeKey: "LegacyTo",
      cardinality: "N:N",
      version: 9,
    });

    const ok = await t.app.inject({
      method: "POST",
      url: `/a/v1/databuilder/runs/${id}/promote`,
      headers: ADMIN,
      payload: { decisions: [{ target: "linkType", key: diffLink!.key, action: "MERGE" }] },
    });
    expect(ok.statusCode).toBe(200);
    const promoted = ok.json() as { domainPromotion?: { overwrittenLinkKeys?: string[] } };
    expect(promoted.domainPromotion?.overwrittenLinkKeys).toContain(diffLink!.key);
    const now = (await t.repos.ontologyLinks.list("demo", (l) => l.key === diffLink!.key))[0];
    expect(now!.fromTypeKey).toBe(diffLink!.fromTypeKey); // 已覆盖为故事要的定义
  });

  it("同 key 沿用既有的类型不再静默：回执点名 reusedTypeKeys（此前既不进 migratedTypes 也不出现在任何回执）", async () => {
    const t: TestApp = await makeApp();
    const { id, provNs } = await buildProvisionalDomain(t);
    const provTypes = await t.repos.ontologyTypes.list(provNs);
    const clash = provTypes[0];
    await t.repos.ontologyTypes.put({
      id: "otype_clash3",
      tenantId: "demo",
      key: clash!.key,
      displayName: "库里那个",
      properties: [],
      derivedProperties: [],
      sourceBindings: [],
      version: 1,
      status: "ACTIVE",
    });

    const ok = await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${id}/promote`, headers: ADMIN });
    expect(ok.statusCode).toBe(200);
    const p = (ok.json() as { domainPromotion?: { reusedTypeKeys?: string[]; migratedTypes: number } }).domainPromotion!;
    expect(p.reusedTypeKeys).toContain(clash!.key); // 诚实位：屏上看得见"复用了既有的 X"
    expect(p.migratedTypes).toBe(provTypes.length - 1); // 老行为不变：沿用的那条不计入
  });

  /**
   * 仓储双实现对齐（R9）：新增的三份名单落在 `story_build_runs` 的 **JSONB `doc` 整体列**里
   * （`migrations/015_story_build_run.sql`），故**不需要**新列/新迁移 —— 但「不需要」这句话
   * 必须用**同一组断言在两个实现上各跑一遍**钉死，不能留作注释里的声称
   * （病史：漏改 pg 半边 = pg 模式下功能不存在而 memory 测试全绿）。
   */
  it("仓储双实现：新增的三份名单在 memory 与真 PgStore 上同一组断言都往返得回来", async () => {
    const run = {
      id: "sbr_dual",
      tenantId: "demo",
      script: SCRIPT,
      producedConnections: [],
      producedDatasets: [],
      producedArtifacts: [],
      storyCoverage: [],
      nodes: [],
      buildMode: "PROVISIONAL",
      status: "SUCCEEDED",
      createdAt: "2026-08-14T00:00:00.000Z",
      domainPromotion: {
        promotedAt: "2026-08-14T00:00:00.000Z",
        promotedBy: "usr_demo_admin",
        fromNamespace: "demo::prov::sbr_dual",
        migratedObjects: 1, migratedDatasets: 1, migratedConnections: 1, migratedTypes: 1,
        promotedSolvers: [],
        reusedTypeKeys: ["Order"],
        keptLinkKeys: ["order_of_customer"],
        overwrittenLinkKeys: ["line_of_base"],
      },
    } as unknown as StoryBuildRun;

    // 同一组断言，跑两遍（下面这个闭包就是"同一组"的字面保证）。
    const assertRoundTrip = (back: StoryBuildRun | undefined, where: string) => {
      expect(back, where).toBeTruthy();
      expect(back!.domainPromotion?.reusedTypeKeys, where).toEqual(["Order"]);
      expect(back!.domainPromotion?.keptLinkKeys, where).toEqual(["order_of_customer"]);
      expect(back!.domainPromotion?.overwrittenLinkKeys, where).toEqual(["line_of_base"]);
      expect(back, where).toEqual(run);
    };

    const mem = createMemoryRepos();
    await mem.storyBuildRuns.put(run);
    assertRoundTrip(await mem.storyBuildRuns.get("demo", "sbr_dual"), "memory");

    // 跑**真** PgStore 的 put/get SQL 与 JSONB doc 编解码，用 Map 背板替掉网络
    // （证明的是「PgStore 走整体 doc 列、不逐字段列举」，不是「连过一台真 postgres」）。
    const rows = new Map<string, { tenant_id: string; doc: unknown }>();
    const fakePool = {
      async query(sql: string, vals: unknown[]) {
        if (sql.trimStart().startsWith("SELECT")) {
          const [id, tenantId] = vals as [string, string];
          const r = rows.get(id);
          return { rows: r && r.tenant_id === tenantId ? [{ doc: r.doc }] : [] };
        }
        const [id, tenantId, docJson] = vals as [string, string, string];
        rows.set(id, { tenant_id: tenantId, doc: JSON.parse(docJson) });
        return { rows: [] };
      },
    };
    const pg = new PgStore<StoryBuildRun>(fakePool as never, "story_build_runs");
    await pg.put(run);
    assertRoundTrip(await pg.get("demo", "sbr_dual"), "pg");
    expect(await pg.get("other", "sbr_dual")).toBeUndefined(); // R2 租户隔离
  });
});
