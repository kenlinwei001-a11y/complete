import { describe, expect, it } from "vitest";
import { createMemoryRepos } from "../src/repo/memory.js";
import { seedDemo, seedDemoEntitlements, DEMO_TENANT } from "../src/seed.js";
import { FeatureService } from "../src/features.js";

/**
 * WO-LIGHTUP · demo 租户点亮 QOS 暗发功能 SEAM（seed → resolve 端到端·「用户真能体验到」的接缝）。
 *
 * 接缝：seed.ts 写 tenant override（数据半）× features.ts layeredSet/cascade 解析（引擎半）——任一半漏即红。
 * 头号判据：resolve(demo) 真含这些门；且**新 battery 租户仍默认关**（QOS_DARK_LAUNCH 诚实锁死·不随模板 all-on 顺带开）。
 * WO-DEMO-L3-LIGHTUP：追加 det-multi + l3-coupled（demo 开箱体验 L3 耦合联合求解·两门缺一不升格）。
 * WO-DEMO-LIGHTUP-2：LIT 增至 **14** 条 + 新增「刻意不点」金值（`qos.llm-budget-enforce`）。
 *
 * ⚠ 本门只证**登记**（seed → resolve 里有这个键）。「点亮≠能用」的另一半在
 * `apps/agentcore/test/demo-lightup-2-prod-set.seam.test.ts`：拿生产集去跑真编排器，
 * 断言自由问答真挂上技能且 `load_skill` 真取到全文。两半缺一不可。
 */

const LIT = [
  "qos.dril-routing", "agent.critic", "ceo.free-llm", "agent.coordinator", "qos.compose-path",
  "qos.reasoning-trace", "agent.escalation",
  // WO-DEMO-L3-LIGHTUP：L3 体验双门（det-multi 产耦合路由 × l3-coupled 升格一次 portfolio）。
  "qos.deterministic-multi-domain", "qos.multi-intent-l3-coupled",
  // WO-DEMO-LIGHTUP-2：本轮追加 5 条（逐条理由见 seed.ts DEMO_LIGHTUP 注释）。
  "agent.skill-on-free-qa",
  "qos.multi-intent-l2-decompose",
  "qos.multi-intent-orchestration",
  "qos.opt-whatif-route",
  "dc.lazy-solver-context",
] as const;

/**
 * WO-DEMO-LIGHTUP-2 · **刻意不点**的暗发键（金值·防"下一个人以为是漏了就顺手加上"）。
 *
 * `qos.llm-budget-enforce` 是**硬线**：配额耗尽 → 新任务 429 `LLM_BUDGET_EXCEEDED` 直接拒。
 * demo 是给人随便点随便问的环境，点亮 = 用着用着撞墙。记账侧不受此门控（账本照记），
 * 关掉的只是"拿账本拦人"这一个动作。要演示配额请运维显式 PUT override（合并语义会尊重它）。
 *
 * 这条断言的作用不是"锁死永不点亮"，而是**逼人先读一遍理由**：真要改，连同 seed.ts 的注释一起改。
 */
const DELIBERATELY_NOT_LIT = ["qos.llm-budget-enforce"] as const;

describe("WO-LIGHTUP · demo 点亮暗发功能（seed→resolve 真驱动·含 L3 体验双门）", () => {
  it("seedDemo + seedDemoEntitlements 后 resolve(demo) 含全部（生产点亮路径·battery 模板排除→显式 override 开）", async () => {
    const repos = createMemoryRepos();
    await seedDemo(repos);
    await seedDemoEntitlements(repos); // 生产 SEED_DEMO 路径才调（基座 seedDemo 保持干净·见函数注释）
    const feats = new Set((await new FeatureService(repos).resolve(DEMO_TENANT)).features);
    for (const k of LIT) expect(feats.has(k), `demo 应点亮 ${k}`).toBe(true);
  });

  it("刻意不点 SEAM：qos.llm-budget-enforce 点亮后**仍必须关**（硬线拒新任务·不该出现在 demo 上）", async () => {
    const repos = createMemoryRepos();
    await seedDemo(repos);
    await seedDemoEntitlements(repos);
    const feats = new Set((await new FeatureService(repos).resolve(DEMO_TENANT)).features);
    for (const k of DELIBERATELY_NOT_LIT) {
      expect(feats.has(k), `${k} 是刻意不点的（见 seed.ts DEMO_LIGHTUP 旁注），不该被种子打开`).toBe(false);
    }
  });

  it("基座隔离 SEAM：只 seedDemo（未点亮）→ resolve(demo) 这 14 个仍关（单测 makeApp 基线干净·防污染 features/dark-feature 门）", async () => {
    const repos = createMemoryRepos();
    await seedDemo(repos);
    const feats = new Set((await new FeatureService(repos).resolve(DEMO_TENANT)).features);
    for (const k of LIT) expect(feats.has(k), `未点亮时 ${k} 应关`).toBe(false);
  });

  it("对照 SEAM：新 battery 租户无 override → 这 14 个默认关（不随 all-on 模板顺带开·断在接缝会露）", async () => {
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

  // ── 存量环境补键（原实现「已有配置 → 直接 return」的隐蔽后果）────────────────
  //
  // 病灶：老实现第一行是 `if (已有 fcfg_demo) return;`。**凡是数据卷没删的 redeploy**
  // （docker compose 默认保留 volume）库里都已有这一行 ⇒ 此后往 DEMO_LIGHTUP 加的任何键
  // **永远落不了地**，且完全无声。等于"点亮机制对所有存量环境整体失效"。
  //
  // 这两条测试咬的是**行为**不是函数：第一条模拟"部署过的老库缺一个新键"，
  // 第二条守住"运维显式关掉的不许被种子重新打开"——两者方向相反，缺任一条修法就会走偏
  // （只要前者会退化成无脑覆盖，只要后者就是今天这个 bug）。
  it("存量环境 SEAM：老库已有 override 但缺新点亮键 → 应补上（防「早退 return 让新键永不落地」回归）", async () => {
    const repos = createMemoryRepos();
    await seedDemo(repos);
    // 模拟"上一版部署留下的配置"：只有一部分点亮键，缺了其余的
    await repos.featureConfigs.put({
      id: `fcfg_${DEMO_TENANT}`,
      tenantId: DEMO_TENANT,
      overrides: { "qos.dril-routing": true },
      configVersion: 1,
      updatedBy: "system:seed-lightup",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await seedDemoEntitlements(repos);
    const feats = new Set((await new FeatureService(repos).resolve(DEMO_TENANT)).features);
    for (const k of LIT) expect(feats.has(k), `存量库应补上 ${k}`).toBe(true);
  });

  it("尊重人的决定 SEAM：运维把某键显式设为 false → 种子不得翻回 true（缺席≠被关掉）", async () => {
    const repos = createMemoryRepos();
    await seedDemo(repos);
    await repos.featureConfigs.put({
      id: `fcfg_${DEMO_TENANT}`,
      tenantId: DEMO_TENANT,
      overrides: { "ceo.free-llm": false }, // 运维显式关（例如没绑真 provider，不想空转）
      configVersion: 3,
      updatedBy: "ops",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await seedDemoEntitlements(repos);
    const feats = new Set((await new FeatureService(repos).resolve(DEMO_TENANT)).features);
    expect(feats.has("ceo.free-llm"), "显式关掉的键不许被种子重新打开").toBe(false);
    // 其余缺席的键仍应补上——「不覆盖已有」不等于「什么都不做」
    expect(feats.has("agent.critic"), "缺席的键仍应补上").toBe(true);
  });
});
