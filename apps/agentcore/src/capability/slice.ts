import {
  buildCapability,
  CapabilitySliceSchema,
  type CapabilityGap,
  type CapabilitySlice,
  type CapabilitySliceRow,
  type EvalRunReport,
  type EvalSuite,
} from "@platform/contracts";

/**
 * 可信自我账 · WO-5（PRD-trustworthy-self-accounting §3.6）：散落自我面 → 统一 Capability/Gap slice 投影器。
 *
 * 本文件把 agentcore 侧散落自我面的**真实运行时数据**投影到 WO-2 的 Capability/Gap 模型：
 *  - **Agent 评测（evals）**：每个套件的最新评测运行 → 一项 `Capability`（kind=feature）；
 *    verifiedStatus **恒经 `buildCapability`/`deriveVerifiedStatus` 派生**（禁手打·齿①）；
 *    关联 actionable Gap 三元由 parity 失因 + llmMode/passRate 现实信号派生。
 *  - **兜底统计（fallback）**：留后续增量（本增量先打穿 evals 证模式成立·诚实边界）。
 *
 * 反 fake-done 红线（本 PRD 根治的诈账）：evals 用例本身经 `orchestrator.submitQuery` 走**真实 NL 路径**
 * 跑（evals.run:runCase），故 passRate 是"代表问经 NL 路由答出"的真实信号——但 **MOCK 跑分仅证框架**
 * （契约 EvalRunReport.llmMode 注），故 `representativeAnswered` 要求 `llmMode==="REAL"`：
 * MOCK 一律**诚实 UNVERIFIED**（绝不假 VERIFIED），并挂"接真模型"的 actionable Gap 指明真值证在何处。
 */

/** 评测门禁：passRate ≥ 90% 方视作"代表问答出"（与 EvalsPage 通过率红绿同阈）。 */
export const EVAL_GATE = 0.9;

const SUITE_CLAIM: Record<EvalSuite, string> = {
  classifier: "把用户问句正确路由到意图/域外（分类器质量达标）",
  agent_quality: "Agent 多步推理与工具编排质量达标",
  regression: "已上线能力不回退（回归用例全过）",
  skill_quality: "Skill 执行质量达标",
};

const SUITE_LABEL: Record<EvalSuite, string> = {
  classifier: "分类器",
  agent_quality: "Agent 质量",
  regression: "回归",
  skill_quality: "Skill 质量",
};

/** parity 失因 → actionable Gap 语义（对齐 EvalsPage PARITY_LABEL + growth GapCode 口径）。 */
const PARITY_META: Record<"INTENT" | "TOOLSEQ" | "ANSWER" | "OTHER", { label: string; gapCode: string }> = {
  INTENT: { label: "意图错分", gapCode: "NO_INTENT" },
  TOOLSEQ: { label: "工具序列偏", gapCode: "SHAPE_MISMATCH" },
  ANSWER: { label: "答案未中", gapCode: "OTHER" },
  OTHER: { label: "其它", gapCode: "OTHER" },
};

const pct = (r: number): string => `${Math.round(r * 100)}%`;

/** 取每套件最新一次运行（按 startedAt 降序），并留一个更早的 REAL VERIFIED 用于 STALE 判定。 */
function latestBySuite(runs: EvalRunReport[]): Map<EvalSuite, { latest: EvalRunReport; priorVerified: boolean }> {
  const bySuite = new Map<EvalSuite, EvalRunReport[]>();
  for (const r of runs) {
    const list = bySuite.get(r.suite) ?? [];
    list.push(r);
    bySuite.set(r.suite, list);
  }
  const out = new Map<EvalSuite, { latest: EvalRunReport; priorVerified: boolean }>();
  for (const [suite, list] of bySuite) {
    const sorted = [...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const latest = sorted[0]!;
    // 曾被验证：更早（非最新）某次以 REAL 达门禁 → 若最新跌破即漂移曝光(STALE)。
    const priorVerified = sorted.slice(1).some((r) => r.llmMode === "REAL" && r.passRate >= EVAL_GATE && !!r.finishedAt);
    out.set(suite, { latest, priorVerified });
  }
  return out;
}

/** 由一次运行的现实信号派生该能力的 actionable Gap 列（空=无缺口/已验证）。 */
function gapsForRun(run: EvalRunReport, verified: boolean): CapabilityGap[] {
  const label = SUITE_LABEL[run.suite];
  const gaps: CapabilityGap[] = [];
  // ① LLM 未接真 → 跑分仅证框架，不能算真验证（可行动·指明真值证在何处）。
  if (run.llmMode !== "REAL") {
    gaps.push({
      what: `真实 LLM 未接入（llmMode=${run.llmMode}）——跑分仅证评测框架，非真实质量`,
      where: "LLM Provider 绑定（/admin/llm-providers）后以 REAL 模式重跑评测",
      acceptance: `接真模型后「${label}」passRate≥${pct(EVAL_GATE)} 且 llmMode=REAL`,
      gapCode: "LLM_PURPOSE_UNBOUND",
      blocking: true,
    });
  } else if (run.passRate < EVAL_GATE) {
    // ② REAL 但通过率不足门禁。
    gaps.push({
      what: `通过率 ${pct(run.passRate)}（${run.passed}/${run.total}）低于门禁 ${pct(EVAL_GATE)}`,
      where: `评测套件「${label}」失败用例（parity byCase 可下钻）`,
      acceptance: `修复失败用例后重跑「${label}」passRate≥${pct(EVAL_GATE)}`,
      gapCode: "OTHER",
      blocking: true,
    });
  }
  // ③ parity 失因逐类（与 PRD 期望不符）——即便已 VERIFIED 也列为非阻塞改进项。
  const p = run.parity?.byFailKind;
  if (p) {
    for (const k of ["INTENT", "TOOLSEQ", "ANSWER", "OTHER"] as const) {
      const n = p[k];
      if (n > 0) {
        const meta = PARITY_META[k];
        gaps.push({
          what: `${meta.label} ${n} 例与 PRD 期望不符`,
          where: `评测套件「${label}」用例（parity byCase 下钻定位）`,
          acceptance: `修复后重跑「${label}」，${meta.label}归零`,
          gapCode: meta.gapCode,
          blocking: !verified,
        });
      }
    }
  }
  return gaps;
}

/**
 * **Agent 评测面 → Capability/Gap slice**（本增量真接入的面）。
 * 每套件最新运行投影为一项 Capability：verifiedStatus 恒经派生器产出（禁手打）。
 * 无任何运行 → 诚实空 slice（wired=true·rows=[]），note 指明"跑一次评测即出"。
 */
export function buildEvalCapabilitySlice(runs: EvalRunReport[], at?: string): CapabilitySlice {
  const now = at ?? new Date().toISOString();
  const rows: CapabilitySliceRow[] = [];
  for (const [suite, { latest, priorVerified }] of latestBySuite(runs)) {
    const acceptanceRan = !!latest.finishedAt && latest.total > 0;
    const representativeAnswered = latest.llmMode === "REAL" && latest.passRate >= EVAL_GATE;
    const capability = buildCapability(
      {
        key: `eval:${suite}`,
        kind: "feature",
        claim: SUITE_CLAIM[suite],
        representativeQuery: `跑「${SUITE_LABEL[suite]}」评测套件（用例经 QOS NL 路径逐条真跑）`,
        acceptance: `passRate≥${pct(EVAL_GATE)} 且 llmMode=REAL`,
      },
      {
        artifactExists: latest.total > 0, // 套件有用例=制品在
        acceptanceRan,
        representativeAnswered,
        priorVerified,
        at: now,
        detail:
          `最新运行 ${latest.id}: llmMode=${latest.llmMode} passRate=${pct(latest.passRate)} ` +
          `(${latest.passed}/${latest.total})` +
          (latest.llmMode !== "REAL" ? " · MOCK 跑分仅证框架非真实质量" : ""),
      },
    );
    const verified = capability.verifiedStatus === "VERIFIED";
    rows.push({ capability, gaps: gapsForRun(latest, verified) });
  }
  // 稳定序：按 key 排（确定性·R6）。
  rows.sort((a, b) => a.capability.key.localeCompare(b.capability.key));
  const mocked = rows.length > 0 && runs.every((r) => r.llmMode !== "REAL");
  return CapabilitySliceSchema.parse({
    surface: "evals",
    wired: true,
    generatedAt: now,
    rows,
    note:
      rows.length === 0
        ? "尚无评测运行——跑一次评测套件后即在此以 Capability/verifiedStatus + actionable Gap 呈现。"
        : mocked
          ? "全部为 MOCK 跑分（仅证评测框架，非真实质量）——绑定真实 LLM 以 REAL 重跑后方可 VERIFIED。"
          : "",
  });
}

/** 已接入的自我面清单（其余散落面为后续增量·诚实边界）。 */
export const WIRED_SURFACES = ["evals"] as const;

/** 未接入面的诚实占位 slice（wired=false·rows=[]）——不假装已归一（正是本 PRD 根治的 claim>实）。 */
export function unwiredSlice(surface: string, at?: string): CapabilitySlice {
  return CapabilitySliceSchema.parse({
    surface,
    wired: false,
    generatedAt: at ?? new Date().toISOString(),
    rows: [],
    note: `「${surface}」面尚未接入统一 Capability/Gap 模型——后续增量（本增量先打穿 evals 证模式成立）。`,
  });
}
