import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillDefinition } from "@platform/contracts";
import { createMockDataCore } from "../src/mocks/clients.js";
import { SEED_TENANT, seedRegistry } from "../src/mocks/seed.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import type { Repos } from "../src/persistence/repos.js";
import {
  auditSeededSkills,
  getFreshSeedSkillGateReport,
  getSeedSkillGateReport,
  resetSeedSkillGateReport,
  SEED_GATE_TTL_MS,
  type SeedSkillGateReport,
} from "../src/skill-publish-gate.js";
import { ADMIN, createTestApp } from "./helpers.js";

/**
 * WO-SEEDGATE-FRESHNESS · 种子门审计的两个独立缺陷（接缝驱动，SEAM-GATE）
 *
 * 实测现象（canonical 282b8239，真后端 datacore:4001 + agentcore:4002，SEED_DEMO=1）：
 *   ranAt  = 2026-08-10T16:33:03.003Z   ← 连续 3 次请求、间隔 3 分钟，一字未变
 *   当时钟 = 2026-08-10T16:36:11Z
 *   status = GATE_UNAVAILABLE
 *   reason = 「读取失败（DataCore is unreachable）」
 * 而同一时刻 `GET /a/v1/catalog?kind=solvers` 返 **HTTP 200 / 39 个 solver** —— DataCore 是健康的。
 *
 * ——— 缺陷 A · 快照永不刷新（假绿第 11 形态：诚实位被冻进常量）———
 * 审计是**进程启动时算一次**就冻住的，之后无论 DataCore 恢复与否都照旧播报。
 * DataCore 起得比 AgentCore 慢一拍 → 审计永久停在"不可用"，
 * 而用户看到的是一条**自称"刚刚测过"**的结论。
 *
 * ——— 缺陷 B · 病因与观测量不对齐 ———
 * `resources.ts` 自己写着「读不出来（**抛错**）或**读回空集**」——这条路径分不清两者；
 * 对外播报却二选一地断言「DataCore is unreachable」（`tools/clients.ts` 的默认 message，
 * **任何 fetch 拒绝都抛它**）。「我读不出来」和「它不可达」是两个不同的命题——
 * 现在把前者说成了后者，运维照这条结论去查网络，会查一整天查不到东西。
 *
 * ⚠️ 本文件的断言纪律：
 *  · 缺陷 A 咬的是 **`ranAt` 变没变**，**不是**「`ranAt` 存在」——后者不度量新鲜度；
 *  · 缺陷 B 咬的是 **两种成因产出不同的 status/文案**，不是「有 status 字段」。
 */

const H = { "x-debug-user": ADMIN, "content-type": "application/json" };

/** 把出厂种子技能按 main.ts 的**旁门**原样落库（`repos.skills.insert`，不经 HTTP 发布）。 */
async function seedSkillsIntoRepos(repos?: Repos): Promise<Repos> {
  const r = repos ?? createMemoryRepos();
  const { skills } = seedRegistry();
  for (const sk of skills) await r.skills.insert(sk);
  return r;
}

/**
 * 时钟锚点**照抄现场实测值**，不从 `SEED_GATE_TTL_MS` 推导。
 *
 * ⚠️ 这一点是刻意的（铁律 0.6：「我用 X 当作 Y 的证据，而 X 并不度量 Y」）：
 * 若把推进量写成 `T0 + SEED_GATE_TTL_MS + 1s`，那么谁把 TTL 改成 10 分钟，
 * 测试就跟着推 10 分钟、**照样绿** —— 它度量的变成「缓存按自己声明的 TTL 过期」，
 * 而不是「运维隔 3 分钟再看，看到的是新结论」。后者才是本单要修的那件事。
 */
const T0 = "2026-08-10T16:33:03.003Z";        // 现场实测的 ranAt（三次请求一字未变的那个值）
const T_PLUS_10S = "2026-08-10T16:33:13.003Z"; // TTL(30s) 内
const T_PLUS_3MIN = "2026-08-10T16:36:11.000Z"; // 现场实测的当时钟 —— 隔 3 分钟再问

/** 只 fake `Date`：`setTimeout` 等仍走真实实现，避免把 fastify/promise 调度一起冻住。 */
function atClock(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  atClock(T0);
});
afterEach(() => {
  vi.useRealTimers();
  resetSeedSkillGateReport();
});

describe("WO-SEEDGATE-FRESHNESS · 缺陷 A · 审计必须按请求现算，不是开机快照", () => {
  // ——— 金丝雀：先自证这套时钟夹具真的能让 ranAt 动，否则下面"没变"全是夹具坏了 ———
  it("金丝雀：夹具能推动时钟，且 auditSeededSkills 的 ranAt 真的跟着走（否则下面的断言全是空跑）", async () => {
    const repos = await seedSkillsIntoRepos();
    const dc = createMockDataCore();

    const a = await auditSeededSkills({ repos, dataCore: dc, tenantId: SEED_TENANT });
    expect(a.ranAt).toBe(T0);

    atClock(T_PLUS_3MIN);
    const b = await auditSeededSkills({ repos, dataCore: dc, tenantId: SEED_TENANT });
    expect(b.ranAt).toBe(T_PLUS_3MIN);
    // 金丝雀命中 ⇒ 时钟夹具可信，下面「ranAt 变了 / 没变」的断言才有意义
    expect(b.ranAt).not.toBe(a.ranAt);
  });

  it("A · TTL 内（+10s）复用同一份快照（ranAt 不变）—— 允许缓存，但只允许缓存这么久", async () => {
    const repos = await seedSkillsIntoRepos();
    const dc = createMockDataCore();

    const first = await getFreshSeedSkillGateReport({ repos, dataCore: dc, tenantId: SEED_TENANT });
    atClock(T_PLUS_10S);
    const cached = await getFreshSeedSkillGateReport({ repos, dataCore: dc, tenantId: SEED_TENANT });

    expect(cached.ranAt).toBe(first.ranAt);
  });

  /**
   * **本单的头号断言**。原实现在这里必红：ranAt 是进程启动那一瞬的常量，推多久都不会变。
   * 断言写成 `not.toBe(first.ranAt)` 而不是 `toBeDefined()` —— 后者在坏实现上照样绿。
   */
  it("A · 现场那 3 分钟：隔 3 分钟再问，ranAt **变了**（不是『ranAt 存在』——后者在坏实现上照样绿）", async () => {
    const repos = await seedSkillsIntoRepos();
    const dc = createMockDataCore();

    const first = await getFreshSeedSkillGateReport({ repos, dataCore: dc, tenantId: SEED_TENANT });
    expect(first.ranAt).toBe(T0);
    atClock(T_PLUS_3MIN);
    const fresh = await getFreshSeedSkillGateReport({ repos, dataCore: dc, tenantId: SEED_TENANT });

    expect(fresh.ranAt).not.toBe(first.ranAt);
    expect(fresh.ranAt).toBe(T_PLUS_3MIN); // ranAt = **这份数据真正被计算的时刻**，不是响应组装时刻
  });

  /**
   * 判据 #6：生产走的那个值必须被覆盖。上面几条用的是**固定 3 分钟**，
   * 只有当生产 TTL 真的 ≤ 3 分钟时它们才在度量新鲜度 —— 这条把那个前提钉死。
   */
  it("A · 生产 TTL 值本身被断言：30s ≤ 上面用的 3 分钟（别让测试验一条生产没走的路）", () => {
    expect(SEED_GATE_TTL_MS).toBe(30_000);
    expect(SEED_GATE_TTL_MS).toBeLessThan(Date.parse(T_PLUS_3MIN) - Date.parse(T0));
  });

  it("A · 手动刷新入口（force）无视 TTL 立刻重算 —— 运维刚修好上游不该被迫等 30 秒", async () => {
    const repos = await seedSkillsIntoRepos();
    const dc = createMockDataCore();

    const first = await getFreshSeedSkillGateReport({ repos, dataCore: dc, tenantId: SEED_TENANT });
    atClock("2026-08-10T16:33:05.000Z"); // 才过 2 秒，远在 TTL 内
    const forced = await getFreshSeedSkillGateReport({ repos, dataCore: dc, tenantId: SEED_TENANT, force: true });

    expect(forced.ranAt).not.toBe(first.ranAt);
    expect(forced.ranAt).toBe("2026-08-10T16:33:05.000Z");
  });

  /**
   * ——— 病的原样复现（接缝：启动顺序 × 探针可用性 × 新鲜度）———
   * 「DataCore 起得比 AgentCore 慢一拍」是常态。原实现在这里会**永久**播报不可用。
   */
  it("A · 启动时 DataCore 没起来 → 恢复后越过 TTL 再问，必须给出 CLEAN（不再永久播报不可用）", async () => {
    const repos = await seedSkillsIntoRepos();
    const dc = createMockDataCore();
    // WO-PUBLISH-REFPROBE 论域订正后，探针的 solver 切面读的是 `solverRegistry`（求解器**全集**注册表）
    // 而不再是 `discover`（给模型看的候选清单，论域缺 GENERIC 那 20 条、带 query 还 ≤20 截断）。
    // 打桩必须跟着挪到探针真读的那张表上——桩打在探针不读的方法上，等于什么都没模拟，
    // 而测试还会因为"注册表健康"而绿：这正是本仓一直在猎的假绿形态。
    const healthy = dc.catalog.solverRegistry;
    dc.catalog.solverRegistry = async () => { throw new Error("ECONNREFUSED datacore:4001"); };

    // 启动那一瞬：DataCore 还没起来
    const boot = await auditSeededSkills({ repos, dataCore: dc, tenantId: SEED_TENANT });
    expect(boot.status).not.toBe<SeedSkillGateReport["status"]>("CLEAN");

    // DataCore 起来了，运维隔 3 分钟回来看
    dc.catalog.solverRegistry = healthy;
    atClock(T_PLUS_3MIN);
    const after = await getFreshSeedSkillGateReport({ repos, dataCore: dc, tenantId: SEED_TENANT });

    expect(after.status).toBe<SeedSkillGateReport["status"]>("CLEAN");
    expect(after.ranAt).not.toBe(boot.ranAt);
  });

  /**
   * **现场那一幕的原样复现**：连续 3 次请求（0s / +10s / +3min）读同一个真 HTTP 端点。
   * 实测的坏行为是三次 `ranAt` 完全相同；修好后第三次必须是新值。
   */
  it("A · 真 HTTP 路由驱动：连续三次 GET（0s / +10s / +3min）→ 第三次的 ranAt 变了（咬的是链路不是函数）", async () => {
    const t = await createTestApp();
    await seedSkillsIntoRepos(t.repos);

    const r1 = await t.app.inject({ method: "GET", url: "/b/v1/ops/skill-seed-gate", headers: H });
    expect(r1.statusCode).toBe(200);
    const b1 = r1.json() as SeedSkillGateReport;
    expect(b1.ranAt).toBe(T0);
    expect(b1.checked).toBeGreaterThan(0); // 金丝雀：真审到东西了，不是空转出来的结论

    // TTL 内再问：同一份快照（缓存生效，不打爆 DataCore）
    atClock(T_PLUS_10S);
    const b2 = (await t.app.inject({ method: "GET", url: "/b/v1/ops/skill-seed-gate", headers: H })).json() as SeedSkillGateReport;
    expect(b2.ranAt).toBe(b1.ranAt);

    // 隔 3 分钟：必须是新算的
    atClock(T_PLUS_3MIN);
    const b3 = (await t.app.inject({ method: "GET", url: "/b/v1/ops/skill-seed-gate", headers: H })).json() as SeedSkillGateReport;
    expect(b3.ranAt).not.toBe(b1.ranAt);
    expect(b3.ranAt).toBe(T_PLUS_3MIN);
  });

  it("A · 真 HTTP 路由驱动：?refresh=1 是显式手动刷新入口，TTL 内也重算", async () => {
    const t = await createTestApp();
    await seedSkillsIntoRepos(t.repos);

    const b1 = (await t.app.inject({ method: "GET", url: "/b/v1/ops/skill-seed-gate", headers: H })).json() as SeedSkillGateReport;
    atClock("2026-08-10T16:33:04.000Z"); // 1 秒后，TTL 内
    const b2 = (await t.app.inject({ method: "GET", url: "/b/v1/ops/skill-seed-gate?refresh=1", headers: H })).json() as SeedSkillGateReport;

    expect(b2.ranAt).not.toBe(b1.ranAt);
    expect(b2.ranAt).toBe("2026-08-10T16:33:04.000Z");
  });

  it("A · 响应自报缓存时长（ttlSeconds）—— 「它有多新」本身也要可观测", async () => {
    const repos = await seedSkillsIntoRepos();
    const r = await getFreshSeedSkillGateReport({ repos, dataCore: createMockDataCore(), tenantId: SEED_TENANT });
    expect(r.ttlSeconds).toBe(SEED_GATE_TTL_MS / 1000);
  });

  it("A · 缓存按租户分桶：别的租户的结论不会串到我这来（tenant_id everywhere）", async () => {
    const repos = await seedSkillsIntoRepos();
    await getFreshSeedSkillGateReport({ repos, dataCore: createMockDataCore(), tenantId: SEED_TENANT });
    // 另一个租户库里没有技能 ⇒ checked 必须是 0，而不是读到 demo 租户那份
    const other = await getFreshSeedSkillGateReport({ repos, dataCore: createMockDataCore(), tenantId: "tenant_other" });
    expect(other.checked).toBe(0);
    expect(getSeedSkillGateReport(SEED_TENANT).checked).toBeGreaterThan(0);
  });
});

describe("WO-SEEDGATE-FRESHNESS · 缺陷 B · 病因与观测量必须对齐（抛错 ≠ 空集）", () => {
  async function auditWith(mutate: (dc: ReturnType<typeof createMockDataCore>) => void): Promise<SeedSkillGateReport> {
    const repos = await seedSkillsIntoRepos();
    const dc = createMockDataCore();
    mutate(dc);
    return auditSeededSkills({ repos, dataCore: dc, tenantId: SEED_TENANT });
  }

  // WO-PUBLISH-REFPROBE 论域订正：探针的 solver 切面读 `solverRegistry`，桩随之挪（理由见上一处注释）。
  const THROWS = (dc: ReturnType<typeof createMockDataCore>): void => {
    dc.catalog.solverRegistry = async () => { throw new Error("ECONNREFUSED datacore:4001"); };
  };
  const EMPTY = (dc: ReturnType<typeof createMockDataCore>): void => {
    dc.catalog.solverRegistry = async () => ({ items: [] });
  };

  it("B · 注册表**抛错** → REGISTRY_UNREACHABLE + 上游原始错误原文（不吞、不改写）", async () => {
    const r = await auditWith(THROWS);
    expect(r.status).toBe<SeedSkillGateReport["status"]>("REGISTRY_UNREACHABLE");
    expect(r.unavailableReason).toContain("ECONNREFUSED");
    expect(r.unavailableReason).toContain("读取抛错");
    // 观测到的是"读取抛错"，**不许**替它下"不可达"这个结论
    expect(r.unavailableReason).not.toContain("返回空集");
  });

  it("B · 注册表**读回空集** → REGISTRY_EMPTY（空集 ≠ 都合法；它答了，只是答了 0 条）", async () => {
    const r = await auditWith(EMPTY);
    expect(r.status).toBe<SeedSkillGateReport["status"]>("REGISTRY_EMPTY");
    expect(r.unavailableReason).toContain("空集");
    expect(r.unavailableReason).not.toContain("读取抛错");
  });

  /**
   * **本单缺陷 B 的头号断言**：两种成因必须产出**不同的** status **和**不同的文案。
   * 原实现两者都给 `GATE_UNAVAILABLE`，这条必红。
   */
  it("B · 两种成因产出**不同的** status 与文案 —— 不许合成一句（原实现两者都是 GATE_UNAVAILABLE）", async () => {
    const thrown = await auditWith(THROWS);
    const empty = await auditWith(EMPTY);

    expect(thrown.status).not.toBe(empty.status);
    expect(thrown.unavailableReason).not.toBe(empty.unavailableReason);
    // 且两者都**不是**"干净"——没判定 ≠ 判定为好
    for (const r of [thrown, empty]) {
      expect(r.status).not.toBe<SeedSkillGateReport["status"]>("CLEAN");
    }
  });

  it("B · 日志同步分档：两种成因的 warn 报文不同（前端一种说法、日志另一种说法 = 又一个不对齐）", async () => {
    const logs: { level: string; msg?: string }[] = [];
    const logger = {
      info: (_o: unknown, msg?: string) => logs.push({ level: "info", msg }),
      warn: (_o: unknown, msg?: string) => logs.push({ level: "warn", msg }),
      error: (_o: unknown, msg?: string) => logs.push({ level: "error", msg }),
    };

    const reposA = await seedSkillsIntoRepos();
    const dcA = createMockDataCore();
    THROWS(dcA);
    await auditSeededSkills({ repos: reposA, dataCore: dcA, tenantId: SEED_TENANT, logger });
    const thrownMsg = logs.filter((l) => l.level === "warn").at(-1)?.msg;

    const reposB = await seedSkillsIntoRepos();
    const dcB = createMockDataCore();
    EMPTY(dcB);
    await auditSeededSkills({ repos: reposB, dataCore: dcB, tenantId: SEED_TENANT, logger });
    const emptyMsg = logs.filter((l) => l.level === "warn").at(-1)?.msg;

    expect(thrownMsg).toBeDefined();
    expect(emptyMsg).toBeDefined();
    expect(thrownMsg).not.toBe(emptyMsg);
  });

  /**
   * 笼统档必须**还在**，且只留给真的分不出的情形。WO 判据原文：
   * 「做不到区分的地方，就诚实地说"读不出（不可达或空集，未能区分）"——宁可含糊，不许二选一地编一个。」
   * 这里制造一个**非探针**异常（门自身炸了），此时我们确实不知道注册表是抛错还是空集。
   */
  it("B · 非探针异常 → 笼统档 GATE_UNAVAILABLE（分不出来就说分不出来，不许编一个）", async () => {
    const repos = await seedSkillsIntoRepos();
    const template = (await repos.skills.listByTenant(SEED_TENANT)).find((s) => s.status === "PUBLISHED")!;
    // 取 references 就炸 ⇒ 异常来自门自身，不是探针，故 `instanceof RefProbeUnavailableError` 为假
    const hostile = {
      ...template,
      get references(): never { throw new Error("boom: 非探针异常（门自身炸了）"); },
    } as unknown as SkillDefinition;
    const reposStub = {
      ...repos,
      skills: { ...repos.skills, listByTenant: async () => [hostile] },
    } as unknown as Repos;

    const r = await auditSeededSkills({ repos: reposStub, dataCore: createMockDataCore(), tenantId: SEED_TENANT });

    expect(r.status).toBe<SeedSkillGateReport["status"]>("GATE_UNAVAILABLE");
    expect(r.unavailableReason).toContain("非探针异常");
    expect(r.status).not.toBe<SeedSkillGateReport["status"]>("CLEAN");
  });
});
