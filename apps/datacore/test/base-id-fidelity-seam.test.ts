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
type Cap = { p50: number; scope?: string; scopeBaseId?: string; scopeNote?: string; perBaseRows?: unknown[] };

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
  it("SEAM 头号：base=常州 只算常州产能（scope:BASE·perBaseRows=1）·与全网（scope:ALL·多基地）数值不同；三形态同 p50；无 base 诚实标全网", async () => {
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
      if (rows.length >= 2 && (net.p50 ?? 0) > 0) { modelId = mid; netRows = rows; netP50 = net.p50; break; }
    }
    expect(modelId, "需一个认证≥2基地的型号做全网 vs 单基地对比").not.toBe("");

    // 全网（无 base）→ scope:ALL 诚实标（不冒充某基地）。
    const net = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2 })) as Cap;
    expect(net.scope).toBe("ALL");
    expect(String(net.scopeNote)).toContain("全网");
    expect((net.perBaseRows ?? []).length).toBeGreaterThanOrEqual(2);

    // 单基地（取全网认证基地之一）→ scope:BASE·perBaseRows=1·p50 只含该基地。
    const targetBaseId = netRows[0]!.baseId;
    const targetBase = bases.find((b) => String(b.props.baseId) === targetBaseId)!;
    const cnName = String(targetBase.props.name);
    const scoped = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2, base: cnName })) as Cap;
    expect(scoped.scope).toBe("BASE");
    expect(scoped.scopeBaseId).toBe(targetBaseId);
    expect((scoped.perBaseRows ?? []).length).toBe(1);
    // ★ 命门：带基地 ≠ 全网（此前静默丢 base → 恒相等 → 用户被冒充）。单基地 < 全网合计（多基地 sum）。
    expect(scoped.p50).not.toBe(netP50);
    expect(scoped.p50).toBeLessThan(netP50);

    // 三形态（中文名 / baseId / obj_base_<id>）→ 同一基地同 p50（规范化单一出处）。
    const byId = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2, base: targetBaseId })) as Cap;
    const byObj = (await t.services.solvers.invoke(CTX, "capacity_forecast", { modelId, demandDelta: 0.2, base: `obj_base_${targetBaseId}` })) as Cap;
    expect(byId.p50).toBe(scoped.p50);
    expect(byObj.p50).toBe(scoped.p50);
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
