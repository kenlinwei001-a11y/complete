import { afterEach, describe, expect, it } from "vitest";
import type { SkillDefinition } from "@platform/contracts";
import { createMockDataCore } from "../src/mocks/clients.js";
import { SEED_TENANT, seedRegistry } from "../src/mocks/seed.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import {
  auditSeededSkills,
  crossSystemSkillRefs,
  getSeedSkillGateReport,
  resetSeedSkillGateReport,
  runSkillPublishGate,
  type SeedSkillGateReport,
} from "../src/skill-publish-gate.js";
import { ADMIN, createTestApp } from "./helpers.js";

/**
 * WO-REFGATE-ENT · F14 · **出厂 Skill 走旁门，一次也没过发布门**（接缝驱动，SEAM-GATE）
 *
 * 病（2026-08-09 复核坐实）：`apps/agentcore/src/main.ts` 启动时 `repos.skills.insert(sk)` 直插仓储，
 * 种子以 `status:"PUBLISHED"` 落库，**从未经过 `POST /b/v1/skills/:id/publish`**。
 * 于是「门装上了」被读成「库里的东西都过了门」——两个不同的命题。
 *
 * 修法：把发布门的判据抽成单一实现（`skill-publish-gate.ts`），发布路由与启动期种子审计
 * **共用同一份**，启动时对已落库的 PUBLISHED 种子补问一遍。
 *
 * 本文件咬三件事，缺一件这道门就退化成装饰：
 *  ① **单源**：两条路真的是同一份实现（改判据 → 两条路一起变；见"单源"用例组）；
 *  ② **报得出来**：种子里塞一条死路引用 → 审计**必须**报出来（变异反证）；去掉 → 干净；
 *  ③ **诚实四态**：`NOT_RUN` / `GATE_UNAVAILABLE` 都**不是**"干净"（否则这道位白加）。
 */

const H = { "x-debug-user": ADMIN, "content-type": "application/json" };

interface CapturedLog {
  level: "info" | "warn" | "error";
  obj: unknown;
  msg?: string;
}

function captureLogger(sink: CapturedLog[]) {
  return {
    info: (obj: unknown, msg?: string) => sink.push({ level: "info", obj, msg }),
    warn: (obj: unknown, msg?: string) => sink.push({ level: "warn", obj, msg }),
    error: (obj: unknown, msg?: string) => sink.push({ level: "error", obj, msg }),
  };
}

/** 把出厂种子技能按 main.ts 的**旁门**原样落库（`repos.skills.insert`，不经 HTTP 发布）。 */
async function seedSkillsIntoRepos(extra: SkillDefinition[] = []) {
  const repos = createMemoryRepos();
  const { skills } = seedRegistry();
  for (const sk of [...skills, ...extra]) await repos.skills.insert(sk);
  return repos;
}

function deadRefSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  const { skills } = seedRegistry();
  const template = skills.find((s) => s.key === "capacity_analysis")!;
  return {
    ...template,
    id: "skl_seed_injected_dead",
    key: "injected_dead_ref",
    status: "PUBLISHED",
    references: [{ kind: "solver", key: "__no_such_solver_xyz__", role: "context", required: true }],
    ...overrides,
  } as SkillDefinition;
}

afterEach(() => resetSeedSkillGateReport());

describe("WO-REFGATE-ENT · F14 · 出厂技能被同一道发布门补问一遍", () => {
  // ——— 金丝雀：先自证审计器真的看得见出厂种子，否则下面"干净"全是空跑出来的 ———
  it("金丝雀：审计真的审到了出厂 PUBLISHED 种子（checked>0），不是空转出来的『干净』", async () => {
    const repos = await seedSkillsIntoRepos();
    const all = await repos.skills.listByTenant(SEED_TENANT);
    const published = all.filter((s) => s.status === "PUBLISHED");
    expect(published.length).toBeGreaterThan(0);

    const report = await auditSeededSkills({ repos, dataCore: createMockDataCore(), tenantId: SEED_TENANT });
    expect(report.checked).toBe(published.length); // 审计范围 = 全部 PUBLISHED 种子
    expect(report.checked).toBeGreaterThan(0);
  });

  it("② 出厂种子现状：审计干净（CLEAN）——「门装上了」现在有证据支撑，不再只是说法", async () => {
    const repos = await seedSkillsIntoRepos();
    const logs: CapturedLog[] = [];
    const report = await auditSeededSkills({
      repos,
      dataCore: createMockDataCore(),
      tenantId: SEED_TENANT,
      logger: captureLogger(logs),
    });
    expect(report.status).toBe<SeedSkillGateReport["status"]>("CLEAN");
    expect(report.findings).toEqual([]);
    expect(logs.some((l) => l.level === "error")).toBe(false);
  });

  /**
   * **变异反证**（WO 判据原文：「在种子里临时塞一条死路引用 → 启动期必须报出来；去掉 → 干净」）。
   * 上一条用例证「去掉 → 干净」，本条证「塞进去 → 报出来」。两条合起来才说明这道门在**判**，
   * 而不是恒绿或恒红。
   */
  it("① 变异反证：种子里塞一条死路引用 → 审计报 VIOLATIONS + error 日志 + 诚实位可查（不静默通过）", async () => {
    const repos = await seedSkillsIntoRepos([deadRefSkill()]);
    const logs: CapturedLog[] = [];
    const report = await auditSeededSkills({
      repos,
      dataCore: createMockDataCore(),
      tenantId: SEED_TENANT,
      logger: captureLogger(logs),
    });

    expect(report.status).toBe<SeedSkillGateReport["status"]>("VIOLATIONS");
    expect(report.findings.map((f) => f.skillKey)).toContain("injected_dead_ref");
    const finding = report.findings.find((f) => f.skillKey === "injected_dead_ref")!;
    expect(finding.violations[0]!.code).toBe("SKILL_REF_UNRESOLVED");
    expect(finding.violations[0]!.message).toContain("__no_such_solver_xyz__");
    // 「报出来」= 真有信号，不是只把结构体填上就算
    expect(logs.filter((l) => l.level === "error").length).toBeGreaterThan(0);
    // 诚实位（进程级单例）跟着更新，供 GET /b/v1/ops/skill-seed-gate 读
    expect(getSeedSkillGateReport().status).toBe("VIOLATIONS");
  });

  it("① 违规种子**仍然在库里**（审计是如实报账，不是偷偷回滚出厂数据）", async () => {
    const repos = await seedSkillsIntoRepos([deadRefSkill()]);
    await auditSeededSkills({ repos, dataCore: createMockDataCore(), tenantId: SEED_TENANT });
    // 出厂数据有问题是**运维要看见的事实**，不是让审计代为篡改的理由。
    expect((await repos.skills.get("skl_seed_injected_dead"))?.status).toBe("PUBLISHED");
  });

  it("③ DRAFT 种子不算违规（它从没自称过门；审计只问 PUBLISHED 的那些）", async () => {
    const repos = await seedSkillsIntoRepos([deadRefSkill({ id: "skl_seed_injected_draft", key: "injected_draft", status: "DRAFT" })]);
    const report = await auditSeededSkills({ repos, dataCore: createMockDataCore(), tenantId: SEED_TENANT });
    expect(report.status).toBe<SeedSkillGateReport["status"]>("CLEAN");
    expect(report.findings.map((f) => f.skillKey)).not.toContain("injected_draft");
  });

  // ——————————— ③ 诚实四态：没判定 ≠ 判定为好 ———————————
  it("③ 未审计时诚实位是 NOT_RUN 而不是 CLEAN（默认值若是干净，这道位就白加了）", () => {
    expect(getSeedSkillGateReport()).toEqual({ status: "NOT_RUN", checked: 0, findings: [] });
  });

  /**
   * ⚠️ WO-SEEDGATE-FRESHNESS 起，这两条的期望值**从合并的 `GATE_UNAVAILABLE` 拆成两个**：
   * 「读不出来（抛错）」与「读回空集」是两个不同的观测，成因不同、运维处置不同，
   * 合成一句就会把「我读不出来」播报成「它不可达」。区分度本身由
   * `skill-seed-gate-freshness.seam.test.ts` 的「两者 status 必须不同」那条咬死。
   */
  it("③ 注册表读不出来（抛错）→ REGISTRY_UNREACHABLE + 原因原文，**绝不**记 CLEAN（「我没找到」≠「它不存在」）", async () => {
    const repos = await seedSkillsIntoRepos();
    const dc = createMockDataCore();
    // WO-PUBLISH-REFPROBE 论域订正：探针的 solver 切面读 `solverRegistry`（求解器全集注册表），
    // 不再读 `discover`（给模型看的候选清单）。桩必须打在探针**真读**的那张表上，
    // 否则模拟不出"注册表不可用"，测试却因为"注册表健康 ⇒ CLEAN"而绿 —— 假绿。
    dc.catalog.solverRegistry = async () => { throw new Error("ECONNREFUSED datacore:4001"); };
    const logs: CapturedLog[] = [];

    const report = await auditSeededSkills({ repos, dataCore: dc, tenantId: SEED_TENANT, logger: captureLogger(logs) });

    expect(report.status).toBe<SeedSkillGateReport["status"]>("REGISTRY_UNREACHABLE");
    expect(report.unavailableReason).toContain("ECONNREFUSED");
    expect(logs.some((l) => l.level === "warn")).toBe(true);
    expect(getSeedSkillGateReport().status).toBe("REGISTRY_UNREACHABLE");
  });

  it("③ 注册表返回空集 → REGISTRY_EMPTY，同样不是干净（第二层 fail-open：空集 ≠ 都合法）", async () => {
    const repos = await seedSkillsIntoRepos();
    const dc = createMockDataCore();
    dc.catalog.solverRegistry = async () => ({ items: [] }); // 同上：桩挪到探针真读的那张表
    const report = await auditSeededSkills({ repos, dataCore: dc, tenantId: SEED_TENANT });
    expect(report.status).toBe<SeedSkillGateReport["status"]>("REGISTRY_EMPTY");
    expect(report.unavailableReason).toContain("空集");
  });

  it("③ 诚实位经 HTTP 可查（GET /b/v1/ops/skill-seed-gate，经 rewriteUrl 折到 /api/v1）", async () => {
    const t = await createTestApp();
    const repos = await seedSkillsIntoRepos([deadRefSkill()]);
    await auditSeededSkills({ repos, dataCore: createMockDataCore(), tenantId: SEED_TENANT });

    for (const url of ["/b/v1/ops/skill-seed-gate", "/api/v1/ops/skill-seed-gate"]) {
      const res = await t.app.inject({ method: "GET", url, headers: H });
      expect(res.statusCode).toBe(200);
      const body = res.json() as SeedSkillGateReport;
      expect(body.status).toBe("VIOLATIONS");
      expect(body.findings.map((f) => f.skillKey)).toContain("injected_dead_ref");
    }
  });
});

describe("WO-REFGATE-ENT · F14 · 单源：发布路由与种子审计**调的是同一份实现**", () => {
  /**
   * 「共用同一份实现」不是靠注释保证的，是靠**同一个输入两条路给出同一个判决**证明的。
   * 这条用例把同一个技能分别喂给 ① HTTP 发布端点 ② 纯函数门，断言两边给出同样的 code。
   * 若哪天有人在 seed 侧抄一份校验（装饰品形态），这条会当场红。
   */
  it("同一个死路技能：HTTP 发布 422 SKILL_REF_UNRESOLVED ⟺ 纯函数门给出同一个 code", async () => {
    const t = await createTestApp();
    const skill = deadRefSkill();

    // ——— 路 A：真 HTTP 发布端点 ———
    await t.repos.skills.insert({ ...skill, id: "skl_http_path", status: "DRAFT" });
    const pub = await t.app.inject({ method: "POST", url: "/b/v1/skills/skl_http_path/publish?force=true", headers: H });
    expect(pub.statusCode).toBe(422);
    const httpCode = (pub.json() as { error: { code: string } }).error.code;

    // ——— 路 B：启动期种子审计走的那份纯函数门 ———
    const gate = await runSkillPublishGate({
      skill,
      allSkills: [skill],
      probe: (want) => import("../src/resources.js").then((m) => m.probeMissingRefs(t.dataCore, { tenantId: SEED_TENANT, userId: "u", roles: [] } as never, want)),
      options: { force: true, shortCircuit: false },
    });

    expect(gate.violations[0]!.code).toBe(httpCode);
    expect(httpCode).toBe("SKILL_REF_UNRESOLVED");
  });

  it("crossSystemSkillRefs 同时抽 references 与 dependsOn（两条数据通道，只接一条 = 半扇门）", () => {
    const want = crossSystemSkillRefs({
      // role 是 SkillReferenceSchema 的必填项（`.default("context")` ⇒ 解析后必有），
      // 这里显式写默认值，语义与省略时一致。
      references: [
        { kind: "solver", key: "s1", required: true, role: "context" },
        { kind: "rule", key: "r1", required: true, role: "context" },
        { kind: "solver", key: "s_optional", required: false, role: "context" }, // 可选引用不进事实门
      ],
      dependsOn: [{ kind: "ontologyType", key: "Base", required: true, role: "context" }],
    });
    expect(want.solverKeys).toEqual(["s1"]);
    expect(want.ruleKeys).toEqual(["r1"]);
    expect(want.objectTypes).toEqual(["Base"]);
    expect(want.total).toBe(3);
  });

  it("force 只豁免质量门（lint），不豁免事实门（引用死路）——两条路同口径", async () => {
    const bad = deadRefSkill({ summary: "太短", body: "没有骨架" }); // lint 必挂 + 引用必死
    const probe = async () => ({ solvers: ["__no_such_solver_xyz__"], rules: [], objectTypes: [] });

    const forced = await runSkillPublishGate({ skill: bad, allSkills: [bad], probe, options: { force: true, shortCircuit: false } });
    expect(forced.violations.map((v) => v.code)).toEqual(["SKILL_REF_UNRESOLVED"]); // lint 被豁免，事实门留下

    const unforced = await runSkillPublishGate({ skill: bad, allSkills: [bad], probe, options: { force: false, shortCircuit: false } });
    expect(unforced.violations.map((v) => v.code)).toEqual(["SKILL_LINT_FAILED", "SKILL_REF_UNRESOLVED"]);
  });

  it("短路语义保持：lint 未过且未 force → **不打 DataCore**（发布路 I/O 顺序不变）", async () => {
    const bad = deadRefSkill({ summary: "太短", body: "没有骨架" });
    let probed = 0;
    const probe = async () => { probed++; return { solvers: [], rules: [], objectTypes: [] }; };

    const short = await runSkillPublishGate({ skill: bad, allSkills: [bad], probe, options: { force: false, shortCircuit: true } });
    expect(short.violations.map((v) => v.code)).toEqual(["SKILL_LINT_FAILED"]);
    expect(probed).toBe(0);

    // 启动期审计不短路：要一次看全（修一条重启一次太贵）
    await runSkillPublishGate({ skill: bad, allSkills: [bad], probe, options: { force: false, shortCircuit: false } });
    expect(probed).toBe(1);
  });
});
