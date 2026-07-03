import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import { SOLVER_DATADEP } from "@platform/contracts";
import {
  CONTEXT_ROLES,
  CONTEXT_ROLE_KEYS,
  contextRolesToLoad,
  manifestRoleUnion,
  uncoveredContextRoles,
} from "../src/solvers/datadep-context.js";

/**
 * DATADEP-MANIFEST-READINESS 站②③ 牙齿测试.
 *
 * 核心自证：loadContext **读声明式清单并集**（治本·非写死 22 类）+ checkReadiness 通用就绪探测
 * present-vs-needed。R6 确定性（同租户重跑字节一致）。
 */
describe("DATADEP 站② loadContext 读清单并集（治本·非写死）", () => {
  it("每个上下文角色被某求解器清单覆盖（uncoveredContextRoles==[]）—— loadContext 并集==全角色 → 字节一致", () => {
    expect(uncoveredContextRoles()).toEqual([]);
  });

  it("清单角色并集 ⊇ 全部上下文角色键（删掉某角色唯一覆盖 → 此断言红 = 治本牙齿）", () => {
    const union = manifestRoleUnion();
    for (const role of CONTEXT_ROLE_KEYS) {
      expect(union.has(role), `上下文角色「${role}」未被任何 SOLVER_DATADEP 清单覆盖 → loadContext 会漏加载`).toBe(true);
    }
  });

  it("contextRolesToLoad(withExtended=true) 覆盖全部 22 个 SolverContext 对象字段（loadContext 加载集=清单驱动·非硬编码 22）", () => {
    const loadedFields = new Set(contextRolesToLoad(true).map((c) => c.field));
    const allFields = CONTEXT_ROLES.map((c) => c.field);
    expect(allFields.length).toBe(22);
    for (const f of allFields) expect(loadedFields.has(f), `字段 ${f} 未被清单驱动加载`).toBe(true);
  });

  it("withExtended=false 只加载非扩展角色（扩展数据默认省全表扫描·行为不变）", () => {
    const coreFields = contextRolesToLoad(false).map((c) => c.field);
    expect(coreFields).not.toContain("materials"); // extended 角色
    expect(coreFields).toContain("bases"); // 核心角色
  });

  it("loadContext 对已播种 demo 租户按清单加载真对象 + R6 重跑字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const c1 = await t.services.solvers.loadContext("demo", undefined, { withExtended: true });
    const c2 = await t.services.solvers.loadContext("demo", undefined, { withExtended: true });
    // 清单驱动的加载确有真对象（非空）——治本后行为不退化。
    expect(c1.bases.length).toBeGreaterThan(0);
    expect(c1.orders.length).toBeGreaterThan(0);
    // R6：同租户同参数重跑逐值一致。
    expect(JSON.stringify(c2.bases)).toBe(JSON.stringify(c1.bases));
    expect(JSON.stringify(c2.orders)).toBe(JSON.stringify(c1.orders));
  });
});

describe("DATADEP 站③ checkReadiness 通用就绪探测（present-vs-needed）", () => {
  it("空租户：required 角色全缺 → not ready + 每角色 EMPTY_DATA gap（诚实空态·非假就绪）", async () => {
    const t = await makeApp();
    const dep = SOLVER_DATADEP.capacity_rollup!;
    const r = await t.services.solvers.checkReadiness("empty-tenant-xyz", "solver:capacity_rollup", dep);
    expect(r.ready).toBe(false);
    expect(r.roles.length).toBe(dep.requires.length);
    expect(r.roles.every((x) => x.present === 0 && !x.ok)).toBe(true);
    expect(r.gaps.length).toBe(dep.requires.length);
    expect(r.gaps.every((g) => g.gapCode === "EMPTY_DATA" && g.blocking)).toBe(true);
  });

  it("已播种 demo 租户：capacity_rollup 就绪（present≥needed·空 gaps）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await t.services.solvers.checkSolverReadiness("demo", "capacity_rollup");
    expect(r.entryRef).toBe("solver:capacity_rollup");
    expect(r.ready).toBe(true);
    expect(r.gaps).toEqual([]);
    expect(r.roles.every((x) => x.ok && x.present >= x.needed)).toBe(true);
  });

  it("未声明清单的入口 → 视为无前置（ready·空 roles·不误报缺口）", async () => {
    const t = await makeApp();
    const r = await t.services.solvers.checkSolverReadiness("demo", "facility_location");
    expect(r.ready).toBe(true);
    expect(r.roles).toEqual([]);
  });

  it("R6：同租户重跑就绪探测逐值一致（generatedAt 除外）", async () => {
    const t = await makeApp();
    const a = await t.services.solvers.checkSolverReadiness("demo", "risk_timeline");
    const b = await t.services.solvers.checkSolverReadiness("demo", "risk_timeline");
    expect(JSON.stringify({ ...a, generatedAt: "" })).toBe(JSON.stringify({ ...b, generatedAt: "" }));
  });
});
