import type { SkillDefinition, SkillReference } from "@platform/contracts";
import { lintSkill, type SkillLintViolation } from "./skill-lint.js";
import { probeMissingRefs } from "./resources.js";
import type { DataCoreClient, ToolAuthCtx } from "./tools/clients.js";
import type { Repos } from "./persistence/repos.js";

/**
 * WO-REFGATE-ENT · F14 · **发布门的判据只允许存在一份**。
 *
 * 病（2026-08-09 复核坐实）：`apps/agentcore/src/main.ts` 启动时 `repos.skills.insert(sk)` 直插仓储，
 * 种子以 `status:"PUBLISHED"` 落库，**从未经过 `POST /b/v1/skills/:id/publish`**。
 * 于是「门装上了」被读成「库里的东西都过了门」—— 这是两个不同的命题：
 * 门只管**经过它的**那些请求，出厂技能走的是旁门，一次也没被问过。
 *
 * 修法**不是**让启动期去打 HTTP（启动期没有 HTTP，且那会把 seed 变成对自己发请求的怪物），
 * 而是把判据本身抽出来，让两条路**调用同一份实现**：
 *
 * ```
 *   POST /b/v1/skills/:id/publish ──┐
 *                                   ├─→ runSkillPublishGate()  ← 唯一判据
 *   main.ts 启动期种子审计 ──────────┘
 * ```
 *
 * ⚠️ 抄一份**就是装饰品**：改主逻辑时另一份拿旧的去测、照样绿（CLAUDE.md 铁律 0.6）。
 * 本文件的存在意义就是让「抄一份」这件事没有地方可做——两个调用点都只有一个入口可进。
 */

/** 违规出口：`code` 与发布路 `HttpError` 的 code **一字不差**（同一判据的两个出口：HTTP 422 与启动期日志）。 */
export interface SkillPublishGateViolation {
  code: "SKILL_LINT_FAILED" | "SKILL_REF_UNRESOLVED";
  message: string;
}

export interface SkillCrossSystemRefs {
  solverKeys: string[];
  ruleKeys: string[];
  objectTypes: string[];
  /** 三类合计；为 0 时**不打 DataCore**（没有引用就没有可查的东西，空注册表也不该误伤这类技能）。 */
  total: number;
}

/**
 * 纯函数 · 抽出需要跨系统校验的引用。
 *
 * `references` 与 `dependsOn` 是**两条数据通道**，都要抽（只接一条 = 半扇门）。
 * `required === false` 的引用是声明性的可选项，不参与事实门（与 lint 的 unresolved 口径一致）。
 */
export function crossSystemSkillRefs(skill: { references?: SkillReference[]; dependsOn?: SkillReference[] }): SkillCrossSystemRefs {
  const refs = [...(skill.references ?? []), ...(skill.dependsOn ?? [])].filter((r) => r.required !== false);
  const solverKeys = refs.filter((r) => r.kind === "solver").map((r) => r.key);
  const ruleKeys = refs.filter((r) => r.kind === "rule").map((r) => r.key);
  const objectTypes = refs.filter((r) => r.kind === "ontologyType").map((r) => r.key);
  return { solverKeys, ruleKeys, objectTypes, total: solverKeys.length + ruleKeys.length + objectTypes.length };
}

/** 探针解析结果（确凿**不可引用**的 key —— 未注册，或存在但未发布）。 */
export interface DeadRefs {
  solvers: string[];
  rules: string[];
  objectTypes: string[];
}

/**
 * 纯函数 · 发布门的**判断**部分（零 I/O）：结构 lint + 引用闭合。
 *
 * I/O（注册表探针）由调用方先解析好 `deadRefs` 传进来 —— 正因为把 I/O 挡在门外，
 * 这道门才能在**启动期**（没有 HTTP、DataCore 可能还没起来）对种子直接跑一遍。
 *
 * `deadRefs === undefined` 表示**该维度未检**（不是"检了没问题"）：调用方要么因为
 * `total === 0` 没什么可检，要么探针不可用 —— 后者必须由调用方如实记账，不许读成"干净"。
 */
export function evaluateSkillPublishGate(input: {
  skill: SkillDefinition;
  allSkills: SkillDefinition[];
  deadRefs?: DeadRefs;
}): { ok: boolean; lint: { ok: boolean; violations: SkillLintViolation[] }; violations: SkillPublishGateViolation[] } {
  const violations: SkillPublishGateViolation[] = [];

  // ——— 门禁一 · 结构 lint ———
  // ⚠️ 必须传 ctx.allSkills：跨资源规则（dependsOn 可解析 / 依赖图无环）在缺省时直接 `return []`
  //    —— 只调 `lintSkill(skill)` 等于把这两条规则「接了没通」（lint 恒过，真环照样发布出去）。
  const lint = lintSkill(input.skill, {}, { allSkills: input.allSkills, requirePublishedDeps: true });
  if (!lint.ok) {
    violations.push({
      code: "SKILL_LINT_FAILED",
      message: `技能结构 lint 未通过（${lint.violations.length} 项）：${lint.violations.map((x) => x.rule).join(", ")}`,
    });
  }

  // ——— 门禁一·补 · B→A 引用闭合（「无死路」）———
  if (input.deadRefs) {
    const dead = [
      ...input.deadRefs.solvers.map((k) => `求解器「${k}」在 DataCore 未注册`),
      // WO-REFGATE-ENT · N-01：探针问的是**已发布**规则集，所以"不在其中"有两种成因，
      // 报文必须两种都说 —— 只说"不存在"会把「引用了一条 DRAFT 规则」误导成「key 打错了」。
      ...input.deadRefs.rules.map((k) => `规则「${k}」不在 DataCore 已发布规则库中（未注册，或仍是 DRAFT 未发布）`),
      ...input.deadRefs.objectTypes.map((k) => `对象类型「${k}」在 DataCore 本体不存在`),
    ];
    if (dead.length > 0) {
      violations.push({
        code: "SKILL_REF_UNRESOLVED",
        message: `技能引用存在死路（${dead.length} 项，发布被拒且未落库）：${dead.join("；")}`,
      });
    }
  }

  return { ok: violations.length === 0, lint, violations };
}

export interface SkillPublishGateOptions {
  /**
   * `force=true`：豁免**质量门**（lint 写得不够好 / 用例还没补齐），**不豁免事实门**（引用死路）——
   * 审计签字不能让一个不存在的求解器变成存在，也不能让一条 DRAFT 规则变成已发布。
   */
  force?: boolean;
  /**
   * 短路（发布路语义·默认 true）：lint 未过即返回，**不再打 DataCore**（保持既有 I/O 顺序字节不变）。
   * 启动期审计传 `false` —— 要一次看全所有违规，而不是修一条重启一次再看下一条。
   */
  shortCircuit?: boolean;
}

/**
 * **两条路的唯一入口**（发布路由 + 启动期种子审计）。
 *
 * `probe` 由调用方注入（发布路走 OBO 用户身份；启动期走服务自身身份）——
 * 门不关心身份怎么来的，只关心"这些 key 到底可不可以被引用"。
 * `probe` 抛错（注册表读不出/空集 → `REF_PROBE_UNAVAILABLE`）时**不吞**：
 * 向上抛给调用方决定（HTTP 路 → 503；启动期 → 记「门不可用」的诚实位，绝不记「干净」）。
 */
export async function runSkillPublishGate(input: {
  skill: SkillDefinition;
  allSkills: SkillDefinition[];
  probe: (want: { solverKeys: string[]; ruleKeys: string[]; objectTypes: string[] }) => Promise<DeadRefs>;
  options?: SkillPublishGateOptions;
}): Promise<{ violations: SkillPublishGateViolation[]; lint: { ok: boolean; violations: SkillLintViolation[] } }> {
  const force = input.options?.force === true;
  const shortCircuit = input.options?.shortCircuit !== false;

  const lintOnly = evaluateSkillPublishGate({ skill: input.skill, allSkills: input.allSkills });
  const lintViolations = force ? [] : lintOnly.violations;
  if (shortCircuit && lintViolations.length > 0) {
    return { violations: lintViolations, lint: lintOnly.lint };
  }

  const want = crossSystemSkillRefs(input.skill);
  const deadRefs = want.total > 0 ? await input.probe(want) : undefined;
  const full = evaluateSkillPublishGate({ skill: input.skill, allSkills: input.allSkills, deadRefs });
  // force 只吃掉 lint 这一条；事实门原样留下。
  const violations = full.violations.filter((v) => !(force && v.code === "SKILL_LINT_FAILED"));
  return { violations, lint: full.lint };
}

// ---------------------------------------------------------------------------
// 启动期种子审计 —— F14 的正题：让出厂技能也被同一道门问一遍
// ---------------------------------------------------------------------------

export interface SeedSkillGateFinding {
  skillId: string;
  skillKey: string;
  violations: SkillPublishGateViolation[];
}

/**
 * 可查询的**诚实位**。四态，缺一不可：
 *
 * | status | 含义 | 绝不可读成 |
 * |---|---|---|
 * | `NOT_RUN` | 还没审计过（默认值） | 干净 |
 * | `CLEAN` | 审计跑完，零违规 | — |
 * | `VIOLATIONS` | 审计跑完，有违规（出厂技能带着违规落了库） | — |
 * | `GATE_UNAVAILABLE` | 注册表读不出/空集，门无法判定 | 干净 |
 *
 * `NOT_RUN` 是默认值而不是 `CLEAN`，是**刻意的**：这道位存在的全部理由就是
 * 「我没找到」和「它不存在」是两个不同的命题——默认值若是 `CLEAN`，
 * 一个根本没跑审计的部署与一个审计通过的部署在可观测面上一模一样，那这道位就白加了。
 */
export interface SeedSkillGateReport {
  status: "NOT_RUN" | "CLEAN" | "VIOLATIONS" | "GATE_UNAVAILABLE";
  ranAt?: string;
  tenantId?: string;
  /** 被审计的技能数（只审 PUBLISHED 种子——DRAFT 种子本来就没自称过门）。 */
  checked: number;
  findings: SeedSkillGateFinding[];
  /** 门不可用时的原因原文（探针的 503 报文），供运维直接定位是哪个注册表读不出来。 */
  unavailableReason?: string;
}

const NOT_RUN: SeedSkillGateReport = { status: "NOT_RUN", checked: 0, findings: [] };
let seedGateReport: SeedSkillGateReport = NOT_RUN;

export function getSeedSkillGateReport(): SeedSkillGateReport {
  return seedGateReport;
}

/** 测试用：把诚实位复位（进程级单例，用例之间必须互不污染）。 */
export function resetSeedSkillGateReport(): void {
  seedGateReport = NOT_RUN;
}

/**
 * 启动期：对**已落库的 PUBLISHED 种子技能**跑一遍与发布路完全相同的门。
 *
 * 诚实口径（三条，缺一条这道审计就退化成装饰）：
 *  ① 有违规 → 记 `VIOLATIONS` + `logger.error` 逐条打出来，**不静默通过**；
 *  ② 探针不可用 → 记 `GATE_UNAVAILABLE` + 原因，**不记 CLEAN**（没判定 ≠ 判定为好）；
 *  ③ 只审 `status === "PUBLISHED"` 的种子 —— DRAFT 种子没自称过门，不该被算作违规。
 *
 * **不阻断启动**：出厂数据有问题是运维要看见的事实，不是让整个服务起不来的理由；
 * 事实经日志 + `GET /b/v1/ops/skill-seed-gate` 两处外透，谁都能查。
 */
export async function auditSeededSkills(input: {
  repos: Repos;
  dataCore: DataCoreClient;
  tenantId: string;
  /** 探针身份：启动期没有请求上下文，用平台自身身份读 A 的公开注册表。 */
  ctx?: ToolAuthCtx;
  logger?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };
}): Promise<SeedSkillGateReport> {
  const ranAt = new Date().toISOString();
  const all = await input.repos.skills.listByTenant(input.tenantId);
  const published = all.filter((s) => s.status === "PUBLISHED");
  const ctx: ToolAuthCtx = input.ctx ?? { tenantId: input.tenantId, userId: "system", roles: ["platform_admin"], debugUser: `${input.tenantId}:system:platform_admin` };

  const findings: SeedSkillGateFinding[] = [];
  for (const skill of published) {
    let result;
    try {
      result = await runSkillPublishGate({
        skill,
        allSkills: all,
        probe: (want) => probeMissingRefs(input.dataCore, ctx, want),
        // 启动期不短路：一次看全（修一条重启一次太贵），也不 force（出厂数据没有"审计豁免"这回事）。
        options: { force: false, shortCircuit: false },
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      seedGateReport = { status: "GATE_UNAVAILABLE", ranAt, tenantId: input.tenantId, checked: published.length, findings, unavailableReason: reason };
      input.logger?.warn(
        { tenantId: input.tenantId, checked: published.length, reason },
        "出厂技能发布门审计：**门不可用**（注册表读不出或空集）——本轮未判定，不得读作『出厂技能干净』",
      );
      return seedGateReport;
    }
    if (result.violations.length > 0) {
      findings.push({ skillId: skill.id, skillKey: skill.key, violations: result.violations });
    }
  }

  seedGateReport = {
    status: findings.length > 0 ? "VIOLATIONS" : "CLEAN",
    ranAt,
    tenantId: input.tenantId,
    checked: published.length,
    findings,
  };
  if (findings.length > 0) {
    for (const f of findings) {
      for (const v of f.violations) {
        input.logger?.error(
          { skillId: f.skillId, skillKey: f.skillKey, code: v.code, detail: v.message },
          "出厂技能未过发布门（种子经 repos.insert 旁路落库，从未走过 POST /b/v1/skills/:id/publish）",
        );
      }
    }
    input.logger?.error(
      { tenantId: input.tenantId, checked: published.length, violating: findings.length },
      "出厂技能发布门审计：有违规——详见 GET /b/v1/ops/skill-seed-gate",
    );
  } else {
    input.logger?.info(
      { tenantId: input.tenantId, checked: published.length },
      "出厂技能发布门审计：全部通过（与 POST /b/v1/skills/:id/publish 同一份判据）",
    );
  }
  return seedGateReport;
}
