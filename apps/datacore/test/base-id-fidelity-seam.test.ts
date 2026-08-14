import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-BASE-ID-FIDELITY · base 标识符跨接缝保真 SEAM-GATE（数据半 synthetic 图 id/种子 × 引擎半 solver 规范化/作用域·非各半绿）。
 *
 * 两症（用户实测·先复现确认后修）——同一根：base 标识没穿到求解器 / 没对齐（G-ARG-DROP-SEAM·base 族）：
 *   ① base 静默丢（错答）：capacity_forecast 无 base 过滤 → 「常州基地 4680 加20%」与「4680 加20%（全网）」答案相同。
 *   ② base 格式不规范（硬 400）：affected_orders resolveBaseId 不识别 `obj_base_changzhou`（synthetic 图节点 id·service.ts toId）→ 400 unknown base。
 * （原疑「③ gap_attribution base×factor」经 canonical 亲验 G-GAP-SCOPE 早已闭〔base-only/base×factor 均返真根因树〕，用户所见「暂不可用」= 后端镜像陈旧未 rebuild → 作废·本单不碰 gap_attribution。）
 *
 * 本门驱动真接缝（真 generateBattery ctx·经 REST /solvers/invoke（z.record 透传）或 services.solvers.invoke 真建 SolverContext·非 mock）：
 *   规范化单一出处 = `types.normalizeBaseRef`（strip `obj_base_`）+ `risk.resolveBaseId`（唯一严格解析·capacity 复用）。
 */

const CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type Cap = { capWanP50: number; scope?: string; scopeBaseId?: string; scopeNote?: string; perBaseRows?: unknown[] };

describe("WO-BASE-ID-FIDELITY · 症② affected_orders 跨 synthetic 图 id × solver 规范化（obj_base_/中文名/baseId 三形态同基地·不再 400）", () => {
  it("SEAM 头号：affected_orders 传 base:'obj_base_<id>'（图节点 id）→ 不再 400 · 真过滤到该基地 · 三形态命中同一基地同订单集", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const bases = await t.repos.objects.listByType("demo", "Base");
    const b0 = bases[0]!;
    const baseId = String(b0.props.baseId); // e.g. changzhou
    const cnName = String(b0.props.name); // e.g. 常州
    const objId = `obj_base_${baseId}`; // synthetic 图节点 id 形态（症② 硬 400 的祸首）

    const results: Record<string, { status: number; count: number; so: string[] }> = {};
    for (const form of [baseId, cnName, objId]) {
      const res = await invokeSolver(t, "affected_orders", { baseId: form }, ADMIN);
      // ★ 命门：obj_base_<id> 此前 400 unknown base；现规范化 strip 前缀 → 200 真过滤。
      expect(res.statusCode, `affected_orders baseId=${form} 应 200（症②：obj_base_ 不再硬 400）`).toBe(200);
      const data = JSON.parse(res.body).data as { count: number; rows: unknown[][]; baseId: string };
      results[form] = { status: res.statusCode, count: data.count, so: (data.rows ?? []).map((r) => String(r[0])).sort() };
      // 规范化回真 baseId（非原样 obj_base_）。
      expect(data.baseId).toBe(baseId);
    }
    // 三形态命中同一基地 → 订单集字节一致（跨 synthetic 图 id × solver 规范化接缝驱动·非各半 unit）。
    expect(results[objId]!.count).toBe(results[baseId]!.count);
    expect(results[cnName]!.so).toEqual(results[baseId]!.so);
    expect(results[objId]!.so).toEqual(results[baseId]!.so);
    // 真过滤（非空·非全网）：该基地确有受影响订单。
    expect(results[baseId]!.count).toBeGreaterThan(0);

    // 反证：真未知基地仍诚实 400（规范化不吞未知·不静默兜底）。
    const bad = await invokeSolver(t, "affected_orders", { baseId: "obj_base_不存在的基地" }, ADMIN);
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("WO-BASE-ID-FIDELITY · 症① capacity_forecast 带基地 vs 全网真区分（数据种 certByModel × 引擎 base 作用域·相同即红）", () => {
  it("SEAM 头号：base=常州 只算常州产能（scope:BASE·perBaseRows=1）·与全网（scope:ALL·多基地）数值不同；三形态同 capWanP50；无 base 诚实标全网", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const models = await t.repos.objects.listByType("demo", "Model");
    const bases = await t.repos.objects.listByType("demo", "Base");

    // 选一个认证 ≥2 基地的型号（全网 sum > 单基地·真区分才有意义）。
    let modelId = "";
    let netRows: { baseId: string; base: string }[] = [];
    let netP50 = 0;
    for (const m of models) {
      const mid = String(m.props.modelId);
      const net = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId: mid, demandDelta: 0.2 })) as Cap;
      const rows = (net.perBaseRows ?? []) as { baseId: string; base: string }[];
      if (rows.length >= 2 && (net.capWanP50 ?? 0) > 0) { modelId = mid; netRows = rows; netP50 = net.capWanP50; break; }
    }
    expect(modelId, "需一个认证≥2基地的型号做全网 vs 单基地对比").not.toBe("");

    // 全网（无 base）→ scope:ALL 诚实标（不冒充某基地）。
    const net = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2 })) as Cap;
    expect(net.scope).toBe("ALL");
    expect(String(net.scopeNote)).toContain("全网");
    expect((net.perBaseRows ?? []).length).toBeGreaterThanOrEqual(2);

    // 单基地（取全网认证基地之一）→ scope:BASE·perBaseRows=1·capWanP50 只含该基地。
    const targetBaseId = netRows[0]!.baseId;
    const targetBase = bases.find((b) => String(b.props.baseId) === targetBaseId)!;
    const cnName = String(targetBase.props.name);
    const scoped = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2, base: cnName })) as Cap;
    expect(scoped.scope).toBe("BASE");
    expect(scoped.scopeBaseId).toBe(targetBaseId);
    expect((scoped.perBaseRows ?? []).length).toBe(1);
    // ★ 命门：带基地 ≠ 全网（此前静默丢 base → 恒相等 → 用户被冒充）。单基地 < 全网合计（多基地 sum）。
    expect(scoped.capWanP50).not.toBe(netP50);
    expect(scoped.capWanP50).toBeLessThan(netP50);

    // 三形态（中文名 / baseId / obj_base_<id>）→ 同一基地同 capWanP50（规范化单一出处）。
    const byId = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2, base: targetBaseId })) as Cap;
    const byObj = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2, base: `obj_base_${targetBaseId}` })) as Cap;
    expect(byId.capWanP50).toBe(scoped.capWanP50);
    expect(byObj.capWanP50).toBe(scoped.capWanP50);
    expect(byObj.scopeBaseId).toBe(targetBaseId);

    // 未认证该基地的型号+基地组合 → 诚实报错（非静默空/冒充）。
    const nonCertBase = bases.find((b) => !netRows.some((r) => r.baseId === String(b.props.baseId)));
    if (nonCertBase) {
      await expect(
        t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2, base: String(nonCertBase.props.baseId) }),
      ).rejects.toThrow(/not certified at base|unknown base/);
    }
  });
});

/**
 * WO-BASE-ID-FIDELITY · 症② 续（base_capacity_outlook）——base 族最后一个**没走归一单一出处**的求解器。
 *
 * 用户可感知症状（同页同选中对象·相邻两能力一通一炸）：地图页点中某基地（前端写入的是真实对象 id
 * `obj_base_<id>`）→ 对话坞问「这个基地未来 90 天产能够不够」→ `base_capacity_outlook` 硬 404 `Base obj_base_changzhou`；
 * 紧接着问「瓶颈卡在哪道工序」（走已归一的 `bottleneck_matrix`）却正常。
 * 根：service.baseCapacityOutlook 曾用 `str(args.baseId)` 裸比 `Base.baseId|name`，注释自称"归一"却没调
 * `types.normalizeBaseRef`（strip `obj_base_` 的**单一出处**·risk.resolveBaseId / capacity 均已复用）。
 */
describe("WO-BASE-ID-FIDELITY · 症②续 base_capacity_outlook 三形态归一（obj_base_<id>/<id>/中文名 → 同一结果·非各半绿）", () => {
  it("SEAM 头号：三形态走 base_capacity_outlook 得到**同一个结果**（字节级）· obj_base_<id> 不再 404 · 归一回真 baseId", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const bases = await t.repos.objects.listByType("demo", "Base");
    const b0 = bases.find((b) => String(b.props.baseId) === "changzhou") ?? bases[0]!;
    const baseId = String(b0.props.baseId); // changzhou
    const cnName = String(b0.props.name); // 常州
    const objId = `obj_base_${baseId}`; // synthetic 图节点 id 形态 = 前端地图选中基地写入的真实对象 id

    type Outlook = {
      baseId: string; baseName: string;
      horizons: { horizon: number; available: number; demand: number; gap: number; lines: { key: string; value: number }[] }[];
    };
    const run = (form: string) => t.services.solvers.invoke(CTX, "base_capacity_outlook", { baseId: form }) as Promise<unknown>;

    // ★ 命门：obj_base_<id> 此前抛 404 `Base obj_base_changzhou`（str() 裸比·未 strip 前缀）。
    const byObj = (await run(objId)) as Outlook;
    const byId = (await run(baseId)) as Outlook;
    const byName = (await run(cnName)) as Outlook;

    // ① 三形态收敛到同一 Base（归一回真 baseId·非原样 obj_base_）。
    for (const [form, g] of [[objId, byObj], [baseId, byId], [cnName, byName]] as const) {
      expect(g.baseId, `base_capacity_outlook(baseId=${form}) 应归一到真 baseId`).toBe(baseId);
      expect(g.baseName).toBe(cnName);
    }
    // ② 非空壳（有真前瞻·否则"三者相等"是两个空对象相等的假绿）。
    expect(byObj.horizons.map((h) => h.horizon)).toEqual([30, 60, 90]);
    expect(byObj.horizons[0]!.available).toBeGreaterThan(0);
    expect(byObj.horizons[0]!.lines.length).toBeGreaterThan(0);
    // ③ 效果断言：三形态字节级同一结果（四线/缺口/dayPlan/byModel 全同·非只比 baseId 这个"运输"字段）。
    expect(JSON.stringify(byObj)).toBe(JSON.stringify(byId));
    expect(JSON.stringify(byName)).toBe(JSON.stringify(byId));
  });

  it("SEAM 用户路径：经 REST /a/v1/solvers/base_capacity_outlook/invoke 传 obj_base_<id> → 200（地图选中→对话坞不再硬 404）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const bases = await t.repos.objects.listByType("demo", "Base");
    const b0 = bases.find((b) => String(b.props.baseId) === "changzhou") ?? bases[0]!;
    const baseId = String(b0.props.baseId);

    const res = await invokeSolver(t, "base_capacity_outlook", { baseId: `obj_base_${baseId}` }, ADMIN);
    expect(res.statusCode, `obj_base_${baseId} 应 200（症②：地图选中对象 id 不再硬 404）`).toBe(200);
    const data = JSON.parse(res.body).data as { baseId: string; horizons: unknown[] };
    expect(data.baseId).toBe(baseId);
    expect(data.horizons.length).toBeGreaterThan(0);

    // 与已归一的兄弟求解器同页一致：同一 obj_base_<id> 走 bottleneck_matrix 也通（同选中对象·两能力齐通·非一通一炸）。
    const bn = await invokeSolver(t, "bottleneck_matrix", { baseIds: [`obj_base_${baseId}`] }, ADMIN);
    expect(bn.statusCode).toBe(200);

    // 反证：真未知基地仍诚实 404（归一不吞未知·不静默兜首基地）；缺 baseId 仍 400 VALIDATION_ERROR。
    const bad = await invokeSolver(t, "base_capacity_outlook", { baseId: "obj_base_不存在的基地" }, ADMIN);
    expect(bad.statusCode).toBe(404);
    expect(JSON.parse(bad.body).error.code).toBe("NOT_FOUND");
    const missing = await invokeSolver(t, "base_capacity_outlook", {}, ADMIN);
    expect(missing.statusCode).toBe(400);
    expect(JSON.parse(missing.body).error.code).toBe("VALIDATION_ERROR");
  });
});
