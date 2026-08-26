import { describe, expect, it } from "vitest";
import { StoryBuildRunSchema, type StoryBuildRun } from "@platform/contracts";
import { createMemoryRepos } from "../src/repo/memory.js";

/**
 * g8 故事驱动全栈倒推 · P1：StoryBuildRun 持久层（R9 仓储双实现的 memory 侧）。
 * 验证 契约 round-trip + 仓储 put/get/list + R2 租户隔离 + forward-compatible 可选字段。
 */
describe("g8 P1 · StoryBuildRun 持久层", () => {
  const mk = (id: string, tenantId: string, script: string): StoryBuildRun =>
    StoryBuildRunSchema.parse({
      id,
      tenantId,
      script,
      producedConnections: [],
      producedDatasets: [],
      status: "SUCCEEDED",
      createdAt: new Date("2026-06-18T00:00:00.000Z").toISOString(),
    });

  it("契约 round-trip：P2/P3 字段（inputManifest/buildPlan/scaffoldReceipt/gapReport）可选缺省", () => {
    const run = mk("sbr_1", "demo", "电池厂扩 4680 产线，六周能否接 20% 增量？");
    expect(run.inputManifest).toBeUndefined();
    expect(run.scaffoldReceipt).toBeUndefined();
    expect(run.producedConnections).toEqual([]);
    expect(run.status).toBe("SUCCEEDED");
  });

  it("仓储 put/get/list + R2 租户隔离（跨租户读不到）", async () => {
    const repos = createMemoryRepos();
    await repos.storyBuildRuns.put(mk("sbr_a", "demo", "故事A"));
    await repos.storyBuildRuns.put(mk("sbr_b", "demo", "故事B"));
    await repos.storyBuildRuns.put(mk("sbr_x", "other", "他租户"));

    expect((await repos.storyBuildRuns.get("demo", "sbr_a"))?.script).toBe("故事A");
    // R2：跨租户读不到（tenant 过滤在 Store 层强制）
    expect(await repos.storyBuildRuns.get("other", "sbr_a")).toBeUndefined();

    const demoRuns = await repos.storyBuildRuns.list("demo");
    expect(demoRuns.map((r) => r.id).sort()).toEqual(["sbr_a", "sbr_b"]);
    expect(await repos.storyBuildRuns.list("other")).toHaveLength(1);
  });
});
