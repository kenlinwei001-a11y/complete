import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, PLANNER, seedBattery, type TestApp } from "./helpers.js";

const J = <T>(r: { json: () => unknown }) => r.json() as T;

async function put(t: TestApp, sliceKey: string, spec: unknown, headers = ADMIN) {
  return t.app.inject({ method: "PUT", url: `/a/v1/ontology/slices/${sliceKey}`, headers, payload: { version: 1, spec } });
}
async function post(t: TestApp, url: string, headers = ADMIN) {
  return t.app.inject({ method: "POST", url, headers, payload: {} });
}
async function get(t: TestApp, url: string, headers = ADMIN) {
  return t.app.inject({ method: "GET", url, headers });
}

interface DeriveResult {
  sliceKey: string;
  promoted: boolean;
  reason?: string;
  fixture?: {
    name: string;
    args: Record<string, unknown>;
    expect: { rootType: string; minNodes: number; mustIncludeTypes: string[]; mustIncludeLinkKeys: string[] };
  };
}

/**
 * WO-SLICE-GOVERNANCE-FULL：无契约切片 → 确定性从真实 resolve 子图推进为契约（baseline fixture）。
 * SEAM：派生（数据种绑定）× 契约校验（引擎路由）自洽——派生出的 fixture 必须真跑 slice-contracts 通过。
 */
describe("WO-SLICE-GOVERNANCE-FULL · 无契约推进为契约（deriveSliceFixture）", () => {
  it("单：无契约切片 → derive-fixture 从真实子图派生 baseline，写回 spec 且真跑契约自洽通过", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 无 contractFixtures 的切片：root=Model（全量）→ model_producible_at → Base。
    await put(t, "gov_full_promote", {
      root: { typeKey: "Model", selector: {} },
      paths: [[{ linkKey: "model_producible_at", direction: "out" }]],
      maxNodes: 200,
    });
    // 起点：清单显示 0 契约
    const before = J<{ sliceKey: string; fixtures: number }[]>(await get(t, "/a/v1/ontology/slices"));
    expect(before.find((s) => s.sliceKey === "gov_full_promote")!.fixtures).toBe(0);

    // 推进为契约（单）
    const res = await post(t, "/a/v1/ontology/slices/gov_full_promote/derive-fixture");
    expect(res.statusCode).toBe(201);
    const body = J<DeriveResult>(res);
    expect(body.promoted).toBe(true);
    expect(body.fixture!.name).toBe("auto_baseline_v1");
    // 类型/链路取真实子图（非声明）：Base/Model + model_producible_at 必现
    expect(body.fixture!.expect.rootType).toBe("Model");
    expect(body.fixture!.expect.mustIncludeTypes).toContain("Model");
    expect(body.fixture!.expect.mustIncludeTypes).toContain("Base");
    expect(body.fixture!.expect.mustIncludeLinkKeys).toContain("model_producible_at");
    expect(body.fixture!.expect.minNodes).toBeGreaterThan(1);

    // 再 GET 完整 spec：contractFixtures 已写回（供编辑器预填）
    const spec = J<{ version: number; spec: { contractFixtures?: { name: string }[]; root: { typeKey: string } } }>(
      await get(t, "/a/v1/ontology/slices/gov_full_promote"),
    );
    expect(spec.spec.root.typeKey).toBe("Model");
    expect(spec.spec.contractFixtures?.some((f) => f.name === "auto_baseline_v1")).toBe(true);

    // 清单徽标翻转：0 → 1
    const after = J<{ sliceKey: string; fixtures: number }[]>(await get(t, "/a/v1/ontology/slices"));
    expect(after.find((s) => s.sliceKey === "gov_full_promote")!.fixtures).toBe(1);

    // SEAM 自驱：派生出的契约真跑 slice-contracts 必过（同视角同数据自洽，非假绿）
    const run = J<{ results: { sliceKey: string; fixture: string; ok: boolean }[] }>(
      await post(t, "/a/v1/ontology/slice-contracts/run"),
    );
    const mine = run.results.find((r) => r.sliceKey === "gov_full_promote" && r.fixture === "auto_baseline_v1");
    expect(mine).toBeDefined();
    expect(mine!.ok).toBe(true);
  });

  it("R6 确定性：同切片重复 derive 字节级一致（同名替换，不累积）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await put(t, "gov_full_det", {
      root: { typeKey: "Model", selector: {} },
      paths: [[{ linkKey: "model_producible_at", direction: "out" }]],
    });
    const a = J<DeriveResult>(await post(t, "/a/v1/ontology/slices/gov_full_det/derive-fixture"));
    const b = J<DeriveResult>(await post(t, "/a/v1/ontology/slices/gov_full_det/derive-fixture"));
    expect(JSON.stringify(a.fixture)).toBe(JSON.stringify(b.fixture));
    // 不累积：始终仅 1 条 auto_baseline_v1
    const spec = J<{ spec: { contractFixtures?: { name: string }[] } }>(await get(t, "/a/v1/ontology/slices/gov_full_det"));
    expect(spec.spec.contractFixtures!.filter((f) => f.name === "auto_baseline_v1").length).toBe(1);
  });

  it("空 resolve（0 节点）→ 诚实 skip 不伪造（KILL-MOCK）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // byKey 绑定不存在的参数 → args {} 下 resolve 0 节点
    await put(t, "gov_full_empty", {
      root: { typeKey: "Model", selector: { byKey: "{{args.doesNotExist}}" } },
      paths: [[{ linkKey: "model_producible_at", direction: "out" }]],
    });
    const res = await post(t, "/a/v1/ontology/slices/gov_full_empty/derive-fixture");
    expect(res.statusCode).toBe(200); // 未推进 → 200 非 201
    const body = J<DeriveResult>(res);
    expect(body.promoted).toBe(false);
    expect(body.reason).toBe("empty_resolve");
    // spec 未被写入伪造 fixture
    const spec = J<{ spec: { contractFixtures?: unknown[] } }>(await get(t, "/a/v1/ontology/slices/gov_full_empty"));
    expect(spec.spec.contractFixtures ?? []).toHaveLength(0);
  });

  it("批：derive-fixtures 只补无契约切片，空 resolve 进 skipped、非空进 promoted", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await put(t, "gov_batch_ok", {
      root: { typeKey: "Model", selector: {} },
      paths: [[{ linkKey: "model_producible_at", direction: "out" }]],
    });
    await put(t, "gov_batch_empty", {
      root: { typeKey: "Model", selector: { byKey: "{{args.nope}}" } },
      paths: [[{ linkKey: "model_producible_at", direction: "out" }]],
    });
    const res = await post(t, "/a/v1/ontology/slices/derive-fixtures");
    expect(res.statusCode).toBe(201);
    const body = J<{ promoted: { sliceKey: string }[]; skipped: { sliceKey: string; reason: string }[] }>(res);
    expect(body.promoted.some((p) => p.sliceKey === "gov_batch_ok")).toBe(true);
    expect(body.skipped.some((s) => s.sliceKey === "gov_batch_empty" && s.reason === "empty_resolve")).toBe(true);
    // 已有契约的切片不被批处理重复推进：再次 batch 不含 gov_batch_ok
    const again = J<{ promoted: { sliceKey: string }[] }>(await post(t, "/a/v1/ontology/slices/derive-fixtures"));
    expect(again.promoted.some((p) => p.sliceKey === "gov_batch_ok")).toBe(false);
  });

  it("非 admin（planner）推进被拒 403；R2：切片不存在 → 404，跨租户不可见", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await put(t, "gov_authz", {
      root: { typeKey: "Model", selector: {} },
      paths: [[{ linkKey: "model_producible_at", direction: "out" }]],
    });
    // planner 非 admin/catalog_admin → 403
    const forbidden = await post(t, "/a/v1/ontology/slices/gov_authz/derive-fixture", PLANNER);
    expect(forbidden.statusCode).toBe(403);
    // 不存在切片 → 404
    const missing = await post(t, "/a/v1/ontology/slices/no_such_slice/derive-fixture");
    expect(missing.statusCode).toBe(404);
    // 跨租户：other admin 看不到 demo 的切片 → 404
    const cross = await post(t, "/a/v1/ontology/slices/gov_authz/derive-fixture", { "x-debug-user": "other:u1:admin" });
    expect(cross.statusCode).toBe(404);
  });
});
