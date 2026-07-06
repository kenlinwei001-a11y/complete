import { z } from "zod";
import { IsoTime } from "./common.js";

/**
 * 可信自我账 · WO-2（PRD-trustworthy-self-accounting §3.1）：`Capability` 一等对象。
 *
 * 平台把每项"能力/缺口"投影为统一对象（元租户 `__platform__`，复用 objects/links 仓储 R9 · 不新建表）。
 * 核心红线：`verifiedStatus` **由现实派生·禁手写路径**——只 `deriveVerifiedStatus` 能产出，
 * 无任何 setter。判据 = 制品存在 + acceptance 真跑过 + **代表问经 QOS 自然语言路由真跑答出
 * ANSWERABLE + dataBearing**（复用 GrowthTicket.verify / classifyGap 同口径，天然对齐"NL 路径非直调求解器"）。
 *
 * 关键（audit 逼出）："代表问 E2E 答出"必须走**用户真实 NL 路径**（QueryDock 打字→QOS 分类→场景/求解器→答案），
 * **不是**手搓 args 直调 `/a/v1/solvers/{key}/invoke`——那正是现存 4 个假 E2E 绕开的接缝。
 */

/** 能力种类（统一收编 solver / 场景答案 / 数据源 / 规则 / 功能 / 工作流）。 */
export const CapabilityKindSchema = z.enum([
  "solver",
  "scenario_answer",
  "data_source",
  "rule",
  "feature",
  "workflow",
]);
export type CapabilityKind = z.infer<typeof CapabilityKindSchema>;

/**
 * 派生态（**不可手打**）：
 *  - UNVERIFIED：未产出活证据（无制品 / acceptance 未跑 / 代表问答不出——含无 LLM、缺能力的诚实空态）。
 *  - VERIFIED：制品在 + acceptance 真跑 + 代表问经 NL 路由答出 ANSWERABLE + dataBearing。
 *  - STALE：曾验证过（制品曾在）但重跑失败——本体谎言/漂移曝光（对齐 meta DRIFT 语义）。
 */
export const VerifiedStatusSchema = z.enum(["UNVERIFIED", "VERIFIED", "STALE"]);
export type VerifiedStatus = z.infer<typeof VerifiedStatusSchema>;

/** 证据种类（R-NO-FAKE-DONE：任何"已验证"必挂 reality-derived 证据）。 */
export const EvidenceKindSchema = z.enum([
  "RUNTIME_PROBE", // 真过 QOS orchestrator（NL 路由）= 活证据（vs BUILD_STATIC）
  "ACCEPTANCE_PASS", // acceptance.criteria 真跑通
  "NONE", // 无活证据（诚实空态）
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const CapabilityEvidenceSchema = z.object({
  kind: EvidenceKindSchema,
  /** 证据产生时刻（真跑时钟）。 */
  at: IsoTime.optional(),
  /** 证据明细（QOS verdict / 断在哪 / 为何 UNVERIFIED——诚实指明真值证在何处）。 */
  detail: z.string().default(""),
});
export type CapabilityEvidence = z.infer<typeof CapabilityEvidenceSchema>;

export const CapabilitySchema = z.object({
  /** 稳定键（如 solver key / scenarioKey / 能力名）。 */
  key: z.string(),
  kind: CapabilityKindSchema,
  /** 声称能做什么（如"回答基地瓶颈"）。 */
  claim: z.string(),
  /** 代表问（验收锚点·必走 NL 路径重跑）。 */
  representativeQuery: z.string(),
  /** 验收判据（curl / E2E 断言线索）。 */
  acceptance: z.string().default(""),
  /** ← 派生·不可手打（只 deriveVerifiedStatus 产出）。 */
  verifiedStatus: VerifiedStatusSchema,
  evidence: CapabilityEvidenceSchema,
});
export type Capability = z.infer<typeof CapabilitySchema>;

/**
 * 派生器输入（现实信号·非声称）：
 *  - artifactExists：制品运行时真存在（求解器已注册 / 场景卡·意图·计划已发布 / 规则在 …）。
 *  - acceptanceRan：acceptance 真被执行（代表问经 QOS 跑到终态任务）。
 *  - representativeAnswered：代表问经 **NL 路由**答出 ANSWERABLE + dataBearing（classifyGap 同口径）。
 *  - priorVerified：此前曾 VERIFIED（用于 STALE 判定——曾在→现重跑失败=漂移曝光）。
 */
export interface DeriveVerifiedInput {
  artifactExists: boolean;
  acceptanceRan: boolean;
  representativeAnswered: boolean;
  priorVerified?: boolean;
  /** 派生时刻（缺省 = 现在）。 */
  at?: string;
  /** 现实明细（QOS verdict / 断因），落 evidence.detail。 */
  detail?: string;
}

/**
 * **verifiedStatus 的唯一产出路径**（禁手写 · 齿①）。纯函数、确定性（R6）：同现实信号 → 同派生态。
 *
 * VERIFIED ⟺ 制品在 ∧ acceptance 真跑 ∧ 代表问 NL 答出（ANSWERABLE+dataBearing）。
 * STALE    ⟺ 曾 VERIFIED 但现重跑不再答出（漂移曝光）。
 * UNVERIFIED ⟺ 其余（含无 LLM / 缺能力的诚实空态——**绝不假 VERIFIED**）。
 */
export function deriveVerifiedStatus(
  input: DeriveVerifiedInput,
): { verifiedStatus: VerifiedStatus; evidence: CapabilityEvidence } {
  const at = input.at ?? new Date().toISOString();
  const answered = input.artifactExists && input.acceptanceRan && input.representativeAnswered;
  if (answered) {
    return {
      verifiedStatus: "VERIFIED",
      evidence: { kind: "RUNTIME_PROBE", at, detail: input.detail ?? "代表问经 QOS NL 路由答出 ANSWERABLE + dataBearing" },
    };
  }
  if (input.priorVerified) {
    return {
      verifiedStatus: "STALE",
      evidence: { kind: "RUNTIME_PROBE", at, detail: input.detail ?? "曾验证过，代表问重跑不再答出（漂移）" },
    };
  }
  return {
    verifiedStatus: "UNVERIFIED",
    // acceptance 跑过但答不出 = 活证据（RUNTIME_PROBE，诚实缺口）；未跑 = NONE。
    evidence: {
      kind: input.acceptanceRan ? "RUNTIME_PROBE" : "NONE",
      at: input.acceptanceRan ? at : undefined,
      detail: input.detail ?? (input.acceptanceRan ? "代表问经 NL 路由未答出（无 LLM / 缺能力，诚实 UNVERIFIED）" : "acceptance 未跑（无活证据）"),
    },
  };
}

/** 能力规格（除派生态外的声明面）——建对象的输入，**不含 verifiedStatus**（杜绝手打）。 */
export type CapabilitySpec = Pick<Capability, "key" | "kind" | "claim" | "representativeQuery"> &
  Partial<Pick<Capability, "acceptance">>;

/**
 * 建 Capability（**唯一构造路径**）：verifiedStatus/evidence 恒经 `deriveVerifiedStatus` 产出——
 * spec 里给不进 verifiedStatus（类型上 CapabilitySpec 无此字段），杜绝手打（齿①）。
 */
export function buildCapability(spec: CapabilitySpec, derive: DeriveVerifiedInput): Capability {
  const { verifiedStatus, evidence } = deriveVerifiedStatus(derive);
  return CapabilitySchema.parse({
    key: spec.key,
    kind: spec.kind,
    claim: spec.claim,
    representativeQuery: spec.representativeQuery,
    acceptance: spec.acceptance ?? "",
    verifiedStatus,
    evidence,
  });
}

/* ─────────────────────────────────────────────────────────────────────────
 * WO-5 · SELF-SURFACES-SLICE（PRD-trustworthy-self-accounting §3.6）
 *
 * 散落自我面（兜底统计 / Agent 评测 / 校准 / VLE / 规划体检 / 工单中心）逐步收敛为
 * **同一 Capability/Gap 自我模型上的 slice 视图**——不再各搭各页。一个 slice = 某散落面
 * 的真实运行时数据**投影**到统一模型：每行 = 一项 Capability（复用 WO-2 派生态 verifiedStatus·
 * 禁手打）+ 其**关联 actionable Gap 三元**（what/where/acceptance·复用 GAP-ACTIONABLE 口径）。
 *
 * 契约只放**共享形状**（schema/type）；各面的投影器（如 evals→slice）留在其宿主服务
 * （agentcore），因需读该面私有运行时数据——契约不跨包 import app 源（contracts-only-shared）。
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * actionable Gap 三元（复用 growth `GapFinding` 的 what/where/acceptance 语义·永不"人工核实内部错误/dash"）。
 * `gapCode` 为可行动错因（自由串·与 GapCode 码表对齐但不强绑），`blocking` 标是否阻塞该能力被验证。
 */
export const CapabilityGapSchema = z.object({
  /** 缺什么（可行动·非"内部错误"）。 */
  what: z.string(),
  /** 补在哪（落点·真实位置）。 */
  where: z.string(),
  /** 验收（该能力经何判据即算被验证）。 */
  acceptance: z.string(),
  /** 可行动错因码（对齐 growth GapCode 语义·自由串免跨包强耦）。 */
  gapCode: z.string().default("OTHER"),
  /** 是否阻塞该 Capability 被验证（true=verifiedStatus 达不到 VERIFIED 的根因）。 */
  blocking: z.boolean().default(true),
});
export type CapabilityGap = z.infer<typeof CapabilityGapSchema>;

/** slice 一行：一项 Capability（含派生 verifiedStatus）+ 其关联 actionable Gap 列。 */
export const CapabilitySliceRowSchema = z.object({
  capability: CapabilitySchema,
  gaps: z.array(CapabilityGapSchema),
});
export type CapabilitySliceRow = z.infer<typeof CapabilitySliceRowSchema>;

/**
 * 自我面 slice 视图响应：某散落面（surface）投影到统一 Capability/Gap 模型的行集。
 * `surface` = 面标识（如 `evals` / `fallback`）；`wired` 标该面是否已真接入（false=后续增量·诚实空态）。
 */
export const CapabilitySliceSchema = z.object({
  surface: z.string(),
  /** 该面是否已真接入统一模型（false → 诚实占位·非本增量·rows 为空）。 */
  wired: z.boolean(),
  /** 生成时刻（真跑时钟）。 */
  generatedAt: IsoTime,
  rows: z.array(CapabilitySliceRowSchema),
  /** 诚实注（如"MOCK 跑分仅证框架" / "本面后续增量接入"）——指明真值证在何处。 */
  note: z.string().default(""),
});
export type CapabilitySlice = z.infer<typeof CapabilitySliceSchema>;
