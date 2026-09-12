import { describe, expect, it } from "vitest";
import { TENANT } from "./helpers.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { BUILTIN_TOOLS } from "../src/tools/registry.js";

/**
 * CL.2 · Agent 合规数据生成工具（fill_data / run_synthetic / build_domain）。
 * 触发确定性、走管线、可溯源的合成（**触发合成 ≠ 伪造**）；回执只含元信息 + provisional 标记，
 * 业务数字由 agent 后续 query_* 读回真实物化值（铁律自洽）。
 */
const exec = () =>
  new GuardedToolExecutor(
    { dataCore: createMockDataCore(), repos: createMemoryRepos(), metrics: new Metrics() },
    { taskId: "t_datagen", ctx: { tenantId: TENANT, userId: "admin", roles: ["admin"] }, budget: new BudgetTracker() },
  );

describe("CL.2 · agent 合规数据生成工具", () => {
  it("三工具已注册进内置目录，且 sideEffect=COMPUTE（path-B whitelist∩{READ,COMPUTE} 可用）", () => {
    for (const name of ["fill_data", "run_synthetic", "build_domain"]) {
      const def = BUILTIN_TOOLS.find((t) => t.name === name);
      expect(def, name).toBeTruthy();
      expect(def!.sideEffect).toBe("COMPUTE");
    }
  });

  it("run_synthetic → 回执只含元信息（jobId/计数）+ provisional 标记，不含业务答案数字", async () => {
    const r = await exec().run("run_synthetic", { industry: "battery-manufacturing", scale: "M", seed: 42 });
    expect(r.ok).toBe(true);
    const p = r.payload as { jobId: string; provisional: boolean; objectCounts: Record<string, number>; _note: string };
    expect(p.jobId).toBeTruthy();
    expect(p.provisional).toBe(true);
    expect(p.objectCounts.PlanTarget).toBeGreaterThan(0);
    expect(p._note).toContain("未审核");
  });

  it("build_domain → runId + provisional；fill_data → connId/rowCount + provisional", async () => {
    const e = exec();
    const bd = await e.run("build_domain", { story: "本月计划未达成原因" });
    expect(bd.ok).toBe(true);
    const bp = bd.payload as { runId: string; provisional: boolean };
    expect(bp.runId).toBeTruthy();
    expect(bp.provisional).toBe(true);

    const fd = await e.run("fill_data", { typeKey: "PlanTarget", fields: ["period", "value"], rows: 12 });
    expect(fd.ok).toBe(true);
    const fp = fd.payload as { connId: string; rowCount: number; provisional: boolean };
    expect(fp.connId).toBeTruthy();
    expect(fp.provisional).toBe(true);
  });
});
