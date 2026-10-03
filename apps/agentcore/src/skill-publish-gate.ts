import type { SkillDefinition, SkillReference } from "@platform/contracts";
import { lintSkill, type SkillLintViolation } from "./skill-lint.js";
import { probeMissingRefs, RefProbeUnavailableError } from "./resources.js";
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
 * 可查询的**诚实位**。六态，缺一不可：
 *
 * | status | 含义 | 绝不可读成 |
 * |---|---|---|
 * | `NOT_RUN` | 还没审计过（默认值） | 干净 |
 * | `CLEAN` | 审计跑完，零违规 | — |
 * | `VIOLATIONS` | 审计跑完，有违规（出厂技能带着违规落了库） | — |
 * | `REGISTRY_UNREACHABLE` | 探针读注册表时**抛错** | 干净 / 「网络不可达」 |
 * | `REGISTRY_EMPTY` | 注册表**答了**，答的是 0 条已知 key | 干净 / 「都合法」 |
 * | `GATE_UNAVAILABLE` | 读不出，且**未能区分**是上面哪一种 | 干净 |
 *
 * `NOT_RUN` 是默认值而不是 `CLEAN`，是**刻意的**：这道位存在的全部理由就是
 * 「我没找到」和「它不存在」是两个不同的命题——默认值若是 `CLEAN`，
 * 一个根本没跑审计的部署与一个审计通过的部署在可观测面上一模一样，那这道位就白加了。
 *
 * **WO-SEEDGATE-FRESHNESS · 缺陷 B**：`REGISTRY_UNREACHABLE` / `REGISTRY_EMPTY` 是本单拆出来的。
 * 原先两者合并成一个 `GATE_UNAVAILABLE`，而对外播报的文案却二选一地断言「DataCore is unreachable」
 * ——那句话是 `DataCoreUnavailableError` 的**默认报文**（任何 fetch 拒绝都抛它），是证据不是结论。
 * ⚠️ 命名注意：`REGISTRY_UNREACHABLE` 度量的是「**读取这一步抛错了**」，**不**保证是网络层不可达
 * （鉴权失败 / 上游 5xx / 解析失败同样落这一支）——真正的成因以 `unavailableReason` 里的上游原文为准。
 * `GATE_UNAVAILABLE` 现在只留给**真的分不出**的情形（非探针异常），按 WO 判据「宁可含糊，不许二选一地编一个」。
 */
export type SeedSkillGateStatus =
  | "NOT_RUN"
  | "CLEAN"
  | "VIOLATIONS"
  | "REGISTRY_UNREACHABLE"
  | "REGISTRY_EMPTY"
  | "GATE_UNAVAILABLE";

export interface SeedSkillGateReport {
  status: SeedSkillGateStatus;
  /**
   * **这份数据真正被计算的时刻**（不是响应组装时刻，也不是进程启动时刻）。
   *
   * WO-SEEDGATE-FRESHNESS · 缺陷 A 的本体：本字段原先只在进程启动时写一次就冻住，
   * 于是一份「开机那一瞬的快照」被一条自称"刚刚测过"的时间戳一直播报下去。
   * 实测现象：连续 3 次请求间隔 3 分钟，`ranAt` 一字未变，而 DataCore 早已健康。
   */
  ranAt?: string;
  tenantId?: string;
  /** 被审计的技能数（只审 PUBLISHED 种子——DRAFT 种子本来就没自称过门）。 */
  checked: number;
  findings: SeedSkillGateFinding[];
  /** 门不可用时的原因原文（探针的 503 报文），供运维直接定位是哪个注册表读不出来。 */
  unavailableReason?: string;
  /** 这份快照最多被复用多少秒（超过即按请求重算）。让"它有多新"这件事本身可观测。 */
  ttlSeconds?: number;
}

/**
 * 快照最长复用时长。**审计不是免费的**（要遍历 PUBLISHED 种子并打 DataCore 注册表），
 * 所以允许缓存；但缓存必须**带 TTL + 有显式手动刷新入口**，否则就退化成本单要修的那个冻结常量。
 */
export const SEED_GATE_TTL_MS = 30_000;

const NOT_RUN: SeedSkillGateReport = { status: "NOT_RUN", checked: 0, findings: [] };

interface CachedSeedGate {
  report: SeedSkillGateReport;
  /** 计算时刻（毫秒）。与 `report.ranAt` 同源同一瞬，TTL 判据只认它。 */
  computedAtMs: number;
}

/**
 * 按租户分桶（`tenant_id everywhere`）。原实现是**单个**进程级变量：
 * 一个租户算出来的结论会被另一个租户读到（技能 key / 违规原文跨租户外泄），
 * 而"按请求现算"本来就必须以请求者的 tenantId 为准，于是顺手把这个洞一起关上。
 */
const cacheByTenant = new Map<string, CachedSeedGate>();
/** 最近一次写入的报告（`getSeedSkillGateReport()` 不带租户时的返回值，保持既有调用点语义）。 */
let lastSeedGateReport: SeedSkillGateReport = NOT_RUN;

/**
 * 读**当前缓存**的诚实位（不触发计算）。
 *
 * ⚠️ 它返回的可能是一份陈旧快照——要"现在的结论"请用 `getFreshSeedSkillGateReport`。
 * 这正是缺陷 A 的形态：一个只读缓存的函数被挂在 HTTP 路由上，读者以为读到的是实时结论。
 */
export function getSeedSkillGateReport(tenantId?: string): SeedSkillGateReport {
  if (tenantId === undefined) return lastSeedGateReport;
  return cacheByTenant.get(tenantId)?.report ?? NOT_RUN;
}

/** 测试用：把诚实位复位（进程级单例，用例之间必须互不污染）。 */
export function resetSeedSkillGateReport(): void {
  cacheByTenant.clear();
  lastSeedGateReport = NOT_RUN;
}

function writeSeedGateReport(tenantId: string, report: SeedSkillGateReport, computedAtMs: number): void {
  cacheByTenant.set(tenantId, { report, computedAtMs });
  lastSeedGateReport = report;
}

/**
 * 三档"门不可用"各自的**人话**，一字都不许合并——合并了就是本单要修的那个病。
 * 界面与日志共用这一份，避免"前端一种说法、日志另一种说法"。
 */
export const SEED_GATE_UNAVAILABLE_NOTE: Record<"REGISTRY_UNREACHABLE" | "REGISTRY_EMPTY" | "GATE_UNAVAILABLE", string> = {
  REGISTRY_UNREACHABLE: "注册表读取抛错——不可达 / 鉴权失败 / 上游报错都会落这一支，以原始错误原文为准",
  REGISTRY_EMPTY: "注册表答了，答的是 0 条已知 key——空集 ≠ 都合法",
  GATE_UNAVAILABLE: "读不出（不可达或空集，未能区分）",
};

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
  // ranAt 与 computedAtMs 取自**同一瞬**：TTL 判的和界面显示的必须是同一个时刻，
  // 否则"它有多新"这件事又会变成两个数各说各话。
  const computedAtMs = Date.now();
  const ranAt = new Date(computedAtMs).toISOString();
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
      // ——— 缺陷 B · 病因与观测量对齐 ———
      // 观测到「抛错」就报「抛错」，观测到「空集」就报「空集」；**分不出来的才报笼统那一档**。
      // 绝不再拿探针 detail 里那句 "DataCore is unreachable"（任何 fetch 拒绝都抛它）当结论播报。
      const status: SeedSkillGateStatus = !(e instanceof RefProbeUnavailableError)
        ? "GATE_UNAVAILABLE"
        : e.reason === "REGISTRY_EMPTY"
          ? "REGISTRY_EMPTY"
          : "REGISTRY_UNREACHABLE";
      const report: SeedSkillGateReport = {
        status,
        ranAt,
        tenantId: input.tenantId,
        checked: published.length,
        findings,
        unavailableReason: reason,
        ttlSeconds: SEED_GATE_TTL_MS / 1000,
      };
      writeSeedGateReport(input.tenantId, report, computedAtMs);
      input.logger?.warn(
        { tenantId: input.tenantId, checked: published.length, status, reason },
        `出厂技能发布门审计：**门不可用**（${SEED_GATE_UNAVAILABLE_NOTE[status]}）——本轮未判定，不得读作『出厂技能干净』`,
      );
      return report;
    }
    if (result.violations.length > 0) {
      findings.push({ skillId: skill.id, skillKey: skill.key, violations: result.violations });
    }
  }

  const report: SeedSkillGateReport = {
    status: findings.length > 0 ? "VIOLATIONS" : "CLEAN",
    ranAt,
    tenantId: input.tenantId,
    checked: published.length,
    findings,
    ttlSeconds: SEED_GATE_TTL_MS / 1000,
  };
  writeSeedGateReport(input.tenantId, report, computedAtMs);
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
  return report;
}

/**
 * **按请求现算**（缺陷 A 的修法）。TTL 内复用上一份快照，超时即重跑一遍真审计。
 *
 * 为什么允许缓存而不是每次都算：审计要遍历 PUBLISHED 种子并打 DataCore 三个注册表，
 * 挂在一个页面级 GET 上每次真算会把 A 打疼。为什么必须带 TTL 而不是算一次冻住：
 * **DataCore 起得比 AgentCore 慢一拍**是常态——冻住就意味着审计永久停在"不可用"，
 * 而用户看到的是一条自称"刚刚测过"的结论。
 *
 * `force`（手动刷新入口，`?refresh=1`）无视 TTL 直接重算：运维刚修好上游，
 * 不该被迫等 30 秒才能验证——**"能手动催一下"是这道位可信的前提**。
 */
export async function getFreshSeedSkillGateReport(input: {
  repos: Repos;
  dataCore: DataCoreClient;
  tenantId: string;
  ctx?: ToolAuthCtx;
  logger?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };
  /** 显式手动刷新：跳过 TTL，强制重算。 */
  force?: boolean;
}): Promise<SeedSkillGateReport> {
  const cached = cacheByTenant.get(input.tenantId);
  if (!input.force && cached !== undefined && Date.now() - cached.computedAtMs < SEED_GATE_TTL_MS) {
    return cached.report;
  }
  return auditSeededSkills(input);
}
