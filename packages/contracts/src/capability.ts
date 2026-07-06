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
