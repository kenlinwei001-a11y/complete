import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import type { AuthCtx, ObjectTypeDef } from "../src/domain.js";
import { PgStore } from "../src/repo/pg.js";
import { createMemoryRepos } from "../src/repo/memory.js";

/**
 * WO-D6 · `upsertType` 吞字段回归门（欠账 #69「本体七要素缺口」的根因）。
 *
 * **这条门咬的是链路不是函数**：写入侧（服务 `upsertType` / REST `POST /a/v1/ontology/object-types`）
 * 与读出侧（`getType` / `GET /a/v1/ontology/object-types`）逐字段对齐 —— 任何一层重新"逐字段列举"
 * 而漏抄契约新字段，本门即红。
 *
 * **两个吞点各自独立、必须各自有断言**（只修一个另一个照吞）：
 *   ① `ontology.ts upsertType` 手写 `def` 白名单 —— 漏 7 个类型级字段；
 *   ② `app.ts POST /a/v1/ontology/object-types` 的 zod body schema —— zod 默认 **strip** 未声明键，
 *      七个字段在**进 service 之前**就没了（property 级 displayName/description 同病）。
 *
 * **两个仓储实现都验**：memory（测试默认）与 pg（`DATABASE_URL` 触发）。两者都是 doc-blob 存储
 * （memory 结构化 clone；pg JSONB `doc` 列），不逐字段列举 —— 本门用真 `PgStore` 跑一遍
 * put→get 把这句话钉成断言，而不是留作注释里的声称。
 */

const ADMIN_CTX: AuthCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };

/** 服务端赋值的字段（调用方不传，不参与 round-trip 比对）。 */
const SERVER_ASSIGNED = ["id", "tenantId", "version", "status", "published", "deprecation"] as const;

/** 带**全部**调用方可传字段的类型输入。新增契约字段时这里必须同步加，否则本门会漏掉它。 */
function fullTypeInput(key = "D6Probe"): Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status"> {
  return {
    key,
    displayName: "D6 探针类型",
    domain: "product",
    properties: [
      {
        propKey: "probeId",
        dataType: "string",
        isPrimaryKey: true,
        required: true,
        searchable: true,
        displayName: "探针主键",
        description: "属性级中文名/描述也走同一条窄门",
      },
      {
        propKey: "secret",
        dataType: "string",
        isPrimaryKey: false,
        displayName: "机密字段",
        description: "供 security 脱敏规则指向",
      },
      { propKey: "risk", dataType: "number", isPrimaryKey: false },
    ],
    derivedProperties: [{ propKey: "risk", formula: "probeId" }],
    sourceBindings: [{ connId: "conn_probe", dataset: "ds_probe", fieldMappings: { probeId: "PROBE_ID" } }],
    // —— 以下 7 个即 WO-D6 的被吞字段（OntoFlow 扩展 / 本体七要素残片）——
    storageMode: "ONTOLOGY",
    stateVariables: [{ propKey: "risk", fromField: "event.risk", fn: "MAX", dataType: "number" }],
    functions: [{ name: "adjustCapacity", returns: "number", builtin: "scale", expr: "risk * 1.1" }],
    actions: [{ actionTypeKey: "AT_D6_ADJUST" }],
    security: [{ prop: "secret", strategy: "HASH", scopeRoles: ["admin"] }],
    entityCategory: "设备",
    description: "D6 探针：七字段落库验证",
  };
}

/** 逐字段 diff：返回 [字段名, 期望, 实得][]（只列不相等的）。 */
function fieldDiff(
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | undefined,
): { field: string; expected: unknown; actual: unknown }[] {
  const out: { field: string; expected: unknown; actual: unknown }[] = [];
  for (const field of Object.keys(expected)) {
    if ((SERVER_ASSIGNED as readonly string[]).includes(field)) continue;
    const e = JSON.stringify(expected[field]);
    const a = JSON.stringify(actual?.[field]);
    if (e !== a) out.push({ field, expected: expected[field], actual: actual?.[field] });
  }
  return out;
}

function reportDiff(label: string, diff: ReturnType<typeof fieldDiff>): void {
  if (diff.length === 0) {
    console.log(`[D6 diff] ${label}: 0 个字段被吞（逐字段相等）`);
    return;
  }
  console.log(`[D6 diff] ${label}: ${diff.length} 个字段被吞 →`);
  for (const d of diff) {
    console.log(`  - ${d.field}: 传入 ${JSON.stringify(d.expected)} / 读回 ${JSON.stringify(d.actual)}`);
  }
}

describe("WO-D6 · 对象类型写入 round-trip（写进去的字段必须读得回来）", () => {
  it("① 服务层：upsertType → getType 逐字段相等", async () => {
    const t = await makeApp();
    const input = fullTypeInput("D6ProbeSvc");
    await t.services.ontology.upsertType(ADMIN_CTX, input);
    const back = await t.services.ontology.getType(ADMIN_CTX, "D6ProbeSvc");

    const diff = fieldDiff(input as unknown as Record<string, unknown>, back as unknown as Record<string, unknown>);
    reportDiff("服务层 upsertType→getType", diff);
    expect(diff.map((d) => d.field)).toEqual([]);
  });

  it("② REST 链路：POST /a/v1/ontology/object-types → GET 列表 逐字段相等", async () => {
    const t = await makeApp();
    // 域 FK 校验：先注册 domain，否则 400（与本门无关的红）。
    await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/domains",
      headers: ADMIN,
      payload: { domainKey: "product", displayName: "产品" },
    });
    const input = fullTypeInput("D6ProbeRest");
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/object-types",
      headers: ADMIN,
      payload: input,
    });
    expect(created.statusCode).toBe(201);

    const listed = (
      await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })
    ).json() as ObjectTypeDef[];
    const back = listed.find((x) => x.key === "D6ProbeRest");
    expect(back, "类型必须在 GET 列表里").toBeTruthy();

    const diff = fieldDiff(input as unknown as Record<string, unknown>, back as unknown as Record<string, unknown>);
    reportDiff("REST POST→GET", diff);
    expect(diff.map((d) => d.field)).toEqual([]);
  });

  it("③ 二次 upsert（update 路径）不得丢字段，且不得把新值退回旧值", async () => {
    const t = await makeApp();
    await t.services.ontology.upsertType(ADMIN_CTX, fullTypeInput("D6ProbeUpd"));
    const next = { ...fullTypeInput("D6ProbeUpd"), entityCategory: "传感器", description: "第二版描述" };
    const returned = await t.services.ontology.upsertType(ADMIN_CTX, next);
    const back = await t.services.ontology.getType(ADMIN_CTX, "D6ProbeUpd");

    const diff = fieldDiff(next as unknown as Record<string, unknown>, back as unknown as Record<string, unknown>);
    reportDiff("二次 upsert→getType", diff);
    expect(diff.map((d) => d.field)).toEqual([]);
    // upsertType 的**返回值**也必须与落库一致（调用方常直接用返回值，不再读一次）。
    const retDiff = fieldDiff(next as unknown as Record<string, unknown>, returned as unknown as Record<string, unknown>);
    reportDiff("二次 upsert 返回值", retDiff);
    expect(retDiff.map((d) => d.field)).toEqual([]);
    expect(back?.version).toBe(2);
  });

  it("④ 仓储双实现（memory + 真 PgStore）都是 doc-blob，不吞字段", async () => {
    const def: ObjectTypeDef = {
      ...fullTypeInput("D6ProbeRepo"),
      id: "otype_d6",
      tenantId: "demo",
      version: 1,
      status: "ACTIVE",
    };

    // memory（测试默认实现）
    const mem = createMemoryRepos();
    await mem.ontologyTypes.put(def);
    const memBack = await mem.ontologyTypes.get("demo", "otype_d6");
    reportDiff("memory 仓储 put→get", fieldDiff(def as unknown as Record<string, unknown>, memBack as unknown as Record<string, unknown>));
    expect(memBack).toEqual(def);

    // pg：跑**真** PgStore 的 put/get SQL 与 JSONB doc 编解码，用 Map 背板替掉网络。
    // 它证明的是「PgStore 不逐字段列举、doc 列全量往返」，不是「连过一台真 postgres」。
    const rows = new Map<string, { id: string; tenant_id: string; doc: unknown }>();
    const fakePool = {
      async query(sql: string, vals: unknown[]) {
        if (sql.trimStart().startsWith("SELECT")) {
          const [id, tenantId] = vals as [string, string];
          const r = rows.get(id);
          return { rows: r && r.tenant_id === tenantId ? [{ doc: r.doc }] : [] };
        }
        const [id, tenantId, docJson] = vals as [string, string, string];
        // pg 的 JSONB 列：写入是 JSON 文本，读出是已解析的 JS 值 —— 这里如实复现。
        rows.set(id, { id, tenant_id: tenantId, doc: JSON.parse(docJson) });
        return { rows: [] };
      },
    };
    const pgStore = new PgStore<ObjectTypeDef>(fakePool as never, "ontology_types");
    await pgStore.put(def);
    const pgBack = await pgStore.get("demo", "otype_d6");
    reportDiff("pg 仓储 put→get", fieldDiff(def as unknown as Record<string, unknown>, pgBack as unknown as Record<string, unknown>));
    expect(pgBack).toEqual(def);
    // R2 租户隔离：别的租户读不到。
    expect(await pgStore.get("other", "otype_d6")).toBeUndefined();
  });
});
