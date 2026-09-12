import { describe, expect, it } from "vitest";
import {
  solverArgsSchema,
  requiredArgKeys,
  argsSatisfiable,
  SopRescheduleArgs,
  AtpCheckArgs,
  SOLVER_ARGS_SCHEMAS,
} from "../src/solvers/args-schemas.js";

/**
 * WO-Phase2-C 地基 · solver args zod schema 注册表（组合器输入模式派生源）。
 * 头号判据：schema 的 required/字段**对齐 solver 真实 args 读取**（非 argHints 人读提示）——
 * 组合器据此从 args schema 派生输入模式（PRD §3.1.3·禁手写映射）。
 */
describe("WO-Phase2-C · solver args schema 注册表（组合器输入模式单一来源）", () => {
  it("已登记 solver 取到 schema·未登记取 undefined（未知→组合器回退 ReAct·不臆造映射）", () => {
    expect(solverArgsSchema("sop_reschedule")).toBeDefined();
    expect(solverArgsSchema("portfolio")).toBeDefined();
    expect(solverArgsSchema("不存在的solver")).toBeUndefined();
    // 未登记的真实 solver（本表增量覆盖·未登记者回退）→ undefined。
    expect(solverArgsSchema("yield_diagnosis")).toBeUndefined();
  });

  it("requiredArgKeys 对齐真实契约：sop_reschedule.targetOrderId 必填·capacity_forecast.modelId 必填·portfolio 全可选", () => {
    expect(requiredArgKeys("sop_reschedule")).toEqual(["targetOrderId"]); // service.ts:1989 str(args.targetOrderId) 无兜底
    expect(requiredArgKeys("capacity_forecast")).toEqual(["modelId"]); // service.ts:3299 str(args.modelId)
    expect(requiredArgKeys("portfolio")).toEqual([]); // scenarios 缺省 / 全上下文派生
    expect(requiredArgKeys("metric_rollup")).toEqual([]); // 全上下文派生
    expect(requiredArgKeys("未登记")).toEqual([]);
  });

  it("schema 真校验：sop_reschedule 缺 targetOrderId 拒·带则过（字段名对齐 args.xxx）", () => {
    expect(SopRescheduleArgs.safeParse({}).success).toBe(false);
    expect(SopRescheduleArgs.safeParse({ targetOrderId: "SO-3402" }).success).toBe(true);
    expect(SopRescheduleArgs.safeParse({ targetOrderId: "SO-3402", advancePct: 0.2, objective: "min_cost" }).success).toBe(true);
    // 越界 objective 值拒（enum 对齐 solver 的 min_delay|min_changeover|min_cost）。
    expect(SopRescheduleArgs.safeParse({ targetOrderId: "SO-1", objective: "max_ontime" }).success).toBe(false);
  });

  it("atp_check refine：orderRef 或 so 之一必给（str(args.orderRef ?? args.so)）", () => {
    expect(AtpCheckArgs.safeParse({}).success).toBe(false);
    expect(AtpCheckArgs.safeParse({ orderRef: "SO-1" }).success).toBe(true);
    expect(AtpCheckArgs.safeParse({ so: "SO-1" }).success).toBe(true);
  });

  it("argsSatisfiable：必填全满足才可组合（portfolio 空输入可满足·sop_reschedule 需 targetOrderId）", () => {
    expect(argsSatisfiable("portfolio", [])).toBe(true); // 无必填
    expect(argsSatisfiable("sop_reschedule", [])).toBe(false); // 缺 targetOrderId
    expect(argsSatisfiable("sop_reschedule", ["targetOrderId"])).toBe(true);
    expect(argsSatisfiable("capacity_forecast", ["modelId", "qty"])).toBe(true);
    expect(argsSatisfiable("未登记", ["任何"])).toBe(false); // 未登记 → 不可组合（回退）
  });

  it("注册表覆盖 path-B 组合高频 solver（增量地基·未覆盖者回退）", () => {
    for (const k of ["sop_reschedule", "capacity_forecast", "portfolio", "affected_orders", "metric_rollup", "gap_attribution", "atp_check", "credit_exposure"]) {
      expect(SOLVER_ARGS_SCHEMAS[k]).toBeDefined();
    }
  });
});
