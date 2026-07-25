import { describe, expect, it } from "vitest";
import { createMemoryRepos } from "../src/repo/memory.js";
import { seedDemo, seedDemoEntitlements, DEMO_TENANT } from "../src/seed.js";
import { FeatureService } from "../src/features.js";

/**
 * WO-LIGHTUP · demo 租户点亮 5 个 QOS 暗发功能 SEAM（seed → resolve 端到端·「用户真能体验到」的接缝）。
 *
 * 接缝：seed.ts 写 tenant override（数据半）× features.ts layeredSet/cascade 解析（引擎半）——任一半漏即红。
 * 头号判据：resolve(demo) 真含这 5 个；且**新 battery 租户仍默认关**（QOS_DARK_LAUNCH 诚实锁死·不随模板 all-on 顺带开）。
 */

const LIT = ["qos.dril-routing", "agent.critic", "ceo.free-llm", "agent.coordinator", "qos.compose-path"] as const;

describe("WO-LIGHTUP · demo 点亮 5 暗发功能（seed→resolve 真驱动）", () => {
  it("seedDemo + seedDemoEntitlements 后 resolve(demo) 含全部 5 个（生产点亮路径·battery 模板排除→显式 override 开）", async () => {
    const repos = createMemoryRepos();
    await seedDemo(repos);
    await seedDemoEntitlements(repos); // 生产 SEED_DEMO 路径才调（基座 seedDemo 保持干净·见函数注释）
    const feats = new Set((await new FeatureService(repos).resolve(DEMO_TENANT)).features);
    for (const k of LIT) expect(feats.has(k), `demo 应点亮 ${k}`).toBe(true);
  });

  it("基座隔离 SEAM：只 seedDemo（未点亮）→ resolve(demo) 这 5 个仍关（单测 makeApp 基线干净·防污染 features/dark-feature 门）", async () => {
    const repos = createMemoryRepos();
    await seedDemo(repos);
    const feats = new Set((await new FeatureService(repos).resolve(DEMO_TENANT)).features);
    for (const k of LIT) expect(feats.has(k), `未点亮时 ${k} 应关`).toBe(false);
  });

  it("对照 SEAM：新 battery 租户无 override → 这 5 个默认关（不随 all-on 模板顺带开·断在接缝会露）", async () => {
    const repos = createMemoryRepos();
    await repos.tenants.put({ id: "t2", tenantId: "t2", name: "t2", industry: "battery-manufacturing" });
    const feats = new Set((await new FeatureService(repos).resolve("t2")).features);
    for (const k of LIT) expect(feats.has(k), `新租户 ${k} 应默认关`).toBe(false);
  });

  it("幂等 R6：重复 seedDemoEntitlements → override 不重写（configVersion 稳定·固定 updatedAt）", async () => {
    const repos = createMemoryRepos();
    await seedDemo(repos);
    await seedDemoEntitlements(repos);
    const v1 = (await new FeatureService(repos).resolve(DEMO_TENANT)).configVersion;
    await seedDemoEntitlements(repos);
    const v2 = (await new FeatureService(repos).resolve(DEMO_TENANT)).configVersion;
    expect(v2).toBe(v1);
  });
});
