import {
  SubmitQueryBodySchema,
  buildCapability,
  type Capability,
  type CapabilitySpec,
  type GapReport,
  type QueryTask,
} from "@platform/contracts";
import type { RequestAuth } from "../auth.js";
import { Orchestrator } from "../router/orchestrator.js";
import { classifyGap } from "../growth/probe.js";
import type { Repos } from "../persistence/repos.js";

/**
 * 可信自我账 · WO-2（PRD-trustworthy-self-accounting §3.1）：Capability 代表问 **NL 路径** E2E harness。
 *
 * 核心红线（齿②·audit 逼出）："代表问 E2E 答出"必须走**用户真实 NL 路径**（QueryDock 打字→QOS
 * 分类→场景/求解器→答案）——本 harness 复用 `GrowthTicket.verify`（server.ts:437）**同一机制**：
 * `orchestrator.submitQuery(问句)` → 轮询终态任务 → `classifyGap` → `verdict==ANSWERABLE`（classifyGap
 * 的 ANSWERABLE 已内含 dataBearing 诚实门，见 probe.ts:98）。**绝不**手搓 args 直调 `/a/v1/solvers/{key}/invoke`
 * ——那正是现存 4 个假 E2E 绕开 NL 路由的接缝。
 *
 * verifiedStatus 恒经 `deriveVerifiedStatus`/`buildCapability` 派生（禁手写·齿①）；
 * 代表问答不出（无 LLM / 缺能力）→ 诚实 UNVERIFIED，绝不假 VERIFIED（齿③）。
 */

export interface CapabilityVerifyDeps {
  orchestrator: Pick<Orchestrator, "submitQuery">;
  repos: Pick<Repos, "tasks" | "packages">;
}

/** 代表问 NL 重跑结果（诚实留痕：真跑到的终态任务 + 缺口分类）。 */
export interface NlProbeResult {
  taskId: string;
  task: QueryTask | undefined;
  gap: GapReport;
  /** 是否跑到终态（acceptance 真被执行）。 */
  acceptanceRan: boolean;
  /** 代表问经 NL 路由答出 ANSWERABLE + dataBearing。 */
  answered: boolean;
}

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

/**
 * 把代表问经 **QOS orchestrator（NL 路径）** 真跑一遍 → classifyGap（复用 GrowthTicket.verify 同判据）。
 * **只调 orchestrator.submitQuery**——无任何 solver invoke 直调（齿②）。
 */
export async function probeRepresentativeNL(
  deps: CapabilityVerifyDeps,
  auth: RequestAuth,
  representativeQuery: string,
  opts?: { packageId?: string; context?: Record<string, unknown>; pollMs?: number; maxPolls?: number },
): Promise<NlProbeResult> {
  // 选包（同 GrowthTicket.verify：取该租户首个包作代表问执行上下文）。
  let packageId = opts?.packageId;
  if (!packageId) {
    const pkg = (await deps.repos.packages.listByTenant(auth.tenantId))[0];
    if (!pkg) throw new Error("CAPABILITY_VERIFY_NO_PACKAGE: 该租户无场景包，无法跑代表问");
    packageId = pkg.id;
  }
  const probeBody = SubmitQueryBodySchema.parse({
    packageId,
    query: representativeQuery,
    context: { view: "dash", selectedObjects: [], filters: {}, ...(opts?.context ?? {}) },
  });
  // ★ NL 路径：QueryDock 打字 == submitQuery（分类→路径A工作流/路径B Agent→答案）。非直调求解器。
  const { taskId } = await deps.orchestrator.submitQuery(auth, probeBody, undefined, { internal: true });

  const pollMs = opts?.pollMs ?? 50;
  const maxPolls = opts?.maxPolls ?? 100;
  let task = await deps.repos.tasks.get(taskId);
  for (let i = 0; i < maxPolls && (!task || !TERMINAL.has(task.status)); i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    task = await deps.repos.tasks.get(taskId);
  }
  const acceptanceRan = !!task && TERMINAL.has(task.status);
  // classifyGap 是纯函数（需终态任务）；未跑到终态则构造 OTHER 缺口（诚实：未答出）。
  const gap: GapReport = task
    ? classifyGap(task)
    : { question: representativeQuery, taskId, verdict: "BLOCKED", path: "NONE", findings: [{ gapCode: "OTHER", evidence: "代表问未跑到终态", suggestedFill: "重跑", blocking: true }], generatedAt: new Date().toISOString() };
  return { taskId, task, gap, acceptanceRan, answered: gap.verdict === "ANSWERABLE" };
}

export interface VerifyCapabilityOpts {
  /** 制品存在检查结果（kind 特定：求解器已注册 / 场景卡·意图·计划已发布 / 规则在 …）。 */
  artifactExists: boolean;
  /** 此前是否曾 VERIFIED（STALE 判定：曾在→现重跑失败=漂移曝光）。 */
  priorVerified?: boolean;
  packageId?: string;
  context?: Record<string, unknown>;
  pollMs?: number;
  maxPolls?: number;
}

/**
 * 验证一项 Capability：制品存在检查 + 代表问经 NL 路由真跑 → `deriveVerifiedStatus` 派生（唯一产出路径）。
 * 返回带派生态的 Capability（verifiedStatus **不可手打**）+ NL 探针留痕。
 */
export async function verifyCapability(
  deps: CapabilityVerifyDeps,
  auth: RequestAuth,
  spec: CapabilitySpec,
  opts: VerifyCapabilityOpts,
): Promise<{ capability: Capability; probe: NlProbeResult }> {
  const probe = await probeRepresentativeNL(deps, auth, spec.representativeQuery, opts);
  const detail = `NL 路径 verdict=${probe.gap.verdict} path=${probe.gap.path} taskId=${probe.taskId}` +
    (probe.gap.findings[0] ? ` · ${probe.gap.findings[0].gapCode}: ${probe.gap.findings[0].evidence}` : "");
  const capability = buildCapability(spec, {
    artifactExists: opts.artifactExists,
    acceptanceRan: probe.acceptanceRan,
    representativeAnswered: probe.answered,
    priorVerified: opts.priorVerified,
    detail,
  });
  return { capability, probe };
}
