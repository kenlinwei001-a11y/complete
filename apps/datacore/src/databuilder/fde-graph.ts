// A5 · FDE 编排工作流节点状态图（既有 7 步执行的可观测语义投影）。
// 设计纪律（PRD-A5 §1 非目标）：不重写建域逻辑——这是观测层。BuildWorkflowRun 的 7 个持久化步
// （dry_build/cross_scaffold/gap_analysis/publish_build/validation/inference/record）是「执行真相」；
// 本模块把它确定性投影成 8 个 FDE 语义节点（意图→倒推→查能力→比差→各模块生成→闭包→publish→进启动器）。
// 节点状态主要由「产物存在性」（context）判定，步状态仅作 RUNNING/计时叠加；同输入同输出（R6）。
import type { BuildWorkflowRun, BuildWorkflowStep, ClosureReport, FdeNode, FdeNodeKey, FdeNodeStatus } from "@platform/contracts";
import { FDE_NODE_KEYS } from "@platform/contracts";

/** 节点静态定义：标签 + 下钻产物引用 + 闸类型（供前端徽章 + DAG 渲染）。 */
export interface FdeNodeDef {
  key: FdeNodeKey;
  label: string;
  /** 下钻到哪个真实产物（StoryBuildRun/BuildWorkflowRun.context 上的字段名）。 */
  drilldownRef: string;
  /** 闸类型：HARD=阻断发布（闭包/全链）· SOFT=建议 · NONE=纯阶段。 */
  gateKind: "HARD" | "SOFT" | "NONE";
}

export const FDE_NODES: FdeNodeDef[] = [
  { key: "story", label: "意图/故事", drilldownRef: "script", gateKind: "NONE" },
  { key: "comprehend", label: "comprehend 倒推", drilldownRef: "buildPlan", gateKind: "NONE" },
  { key: "capability", label: "查能力", drilldownRef: "capabilityInventory", gateKind: "NONE" },
  { key: "gap", label: "比差", drilldownRef: "gapAnalysis", gateKind: "SOFT" },
  { key: "generate", label: "各模块生成", drilldownRef: "producedArtifacts", gateKind: "NONE" },
  { key: "closure", label: "闭包", drilldownRef: "closureReport", gateKind: "HARD" },
  { key: "publish", label: "publish（R4）", drilldownRef: "producedArtifacts", gateKind: "HARD" },
  // E15：launcher 从 NONE 升为**有产物+判据**——产物=注册进启动器的 DRAFT 场景 + 验证答案；
  // 判据(SOFT)=场景已注册且重跑主问句真出非空可溯源答案。跨系统未注册(PENDING_BSTACK)/验证不可答→诚实标缺口码。
  { key: "launcher", label: "进启动器", drilldownRef: "answer", gateKind: "SOFT" },
];

/**
 * E15 · 启动器就绪判据（确定性，纯 context）：scaffold 倒推的 DRAFT 场景算"注册进启动器的产物"。
 *  - registeredScenes：scaffoldManifest 中 module=scene 的项数（启动器可见的场景卡数）；
 *  - pendingBstack：是否仍有项待 B 对账（单机/未配 AGENTCORE → 场景定义可见但未真注册进 QOS 启动器）。
 * 用于 launcher 节点的 io.out（产物计数）与 gapCode（PENDING_BSTACK 时诚实标"待 B 注册"，不静默假绿）。
 */
function launcherReadiness(c: Ctx): { registeredScenes: number; pendingBstack: boolean } {
  const sm = c["scaffoldManifest"] as { items?: { module?: string; status?: string }[]; pendingBstack?: boolean } | undefined;
  const sceneItems = (sm?.items ?? []).filter((i) => i.module === "scene");
  return { registeredScenes: sceneItems.length, pendingBstack: !!sm?.pendingBstack };
}

const DEF_BY_KEY = new Map<FdeNodeKey, FdeNodeDef>(FDE_NODES.map((d) => [d.key, d]));

type Ctx = Record<string, unknown>;

function stepOf(steps: BuildWorkflowStep[] | undefined, key: string): BuildWorkflowStep | undefined {
  return steps?.find((s) => s.stepKey === key);
}

/** 闭包首个失败维 → 缺口码（CHAIN/SHAPE/OBJECT/DATA/FORWARD），供节点红标。 */
function closureGapCode(cr: ClosureReport): string | undefined {
  if (cr.gatePassed) return undefined;
  if (cr.chainBroken > 0) return "CHAIN_BROKEN";
  if (cr.shapeBroken > 0) return "SHAPE_MISMATCH";
  if (cr.forwardMissing > 0) return "FORWARD_MISSING";
  if (cr.dataOrphans > 0) return "DATA_ORPHAN";
  const failing = cr.findings.find((f) => f.status === "MISSING" || f.status === "FAILED" || f.status === "DROPPED");
  return failing ? `${failing.kind}_${failing.status}` : "CLOSURE_FAILED";
}

/** 把单步状态映射为节点状态（RUNNING/FAILED/SKIPPED 透传，其余按产物判定兜底）。 */
function fromStep(step: BuildWorkflowStep | undefined): FdeNodeStatus | undefined {
  if (!step) return undefined;
  if (step.status === "RUNNING") return "RUNNING";
  if (step.status === "FAILED") return "FAILED";
  if (step.status === "SKIPPED") return "SKIPPED";
  if (step.status === "SUCCEEDED") return "DONE";
  return "PENDING";
}

/**
 * 确定性投影：BuildWorkflowRun（steps + context）→ 8 个 FDE 节点。
 * - 状态主判：产物存在性（context 上的 planId/gapAnalysis/built/closureReport/answer 等）；
 * - RUNNING / FAILED / 计时：叠加对应执行步的状态与 durationMs。
 * 也可只传 { context }（record 步落历史快照时无 steps，则无 RUNNING/计时，仅终态语义）。
 */
export function projectFdeNodes(input: { steps?: BuildWorkflowStep[]; context: Ctx }): FdeNode[] {
  const { steps, context: c } = input;
  const has = (k: string): boolean => c[k] !== undefined && c[k] !== null;
  const closure = c["closureReport"] as ClosureReport | undefined;
  const built = c["built"] === true;
  const planReady = has("planId");
  // dry_build 跑完即 aOk 落定（无论真假）→ 据此区分「未到」(PENDING) 与「闭包未过被跳过」(SKIPPED)。
  const aOkPresent = has("aOk");
  const chainClosed = c["aOk"] === true && c["bOk"] === true;

  const status: Record<FdeNodeKey, FdeNodeStatus> = {
    story: "DONE", // 故事是输入燃料：run 存在即已受理
    comprehend: planReady ? "DONE" : fromStep(stepOf(steps, "dry_build")) ?? "PENDING",
    capability: planReady ? "DONE" : fromStep(stepOf(steps, "dry_build")) ?? "PENDING",
    gap: has("gapAnalysis") ? "DONE" : fromStep(stepOf(steps, "gap_analysis")) ?? "PENDING",
    generate: built
      ? "DONE"
      : aOkPresent && !chainClosed
        ? "SKIPPED"
        : fromStep(stepOf(steps, "publish_build")) ?? "PENDING",
    closure: closure
      ? closure.gatePassed
        ? "DONE"
        : "FAILED"
      : fromStep(stepOf(steps, "dry_build")) ?? "PENDING",
    publish: built
      ? "DONE"
      : aOkPresent && !chainClosed
        ? "SKIPPED"
        : fromStep(stepOf(steps, "publish_build")) ?? "PENDING",
    launcher: has("answer")
      ? "DONE"
      : built
        ? fromStep(stepOf(steps, "inference")) ?? "PENDING"
        : aOkPresent
          ? "SKIPPED"
          : "PENDING",
  };

  // IO 计数（best-effort，确定性来自 context）。
  const producedConns = (c["producedConnections"] as string[] | undefined)?.length ?? 0;
  const producedDs = (c["producedDatasets"] as string[] | undefined)?.length ?? 0;
  const gap = c["gapAnalysis"] as { summary?: { need?: number; missing?: number } } | undefined;
  // E15：launcher 产物 = 注册进启动器的 DRAFT 场景数（有答案时取场景卡数，至少 1）。
  const launch = launcherReadiness(c);
  const io: Partial<Record<FdeNodeKey, { in?: number; out?: number }>> = {
    story: { in: 1 },
    comprehend: planReady ? { out: 1 } : undefined,
    gap: gap?.summary ? { out: gap.summary.need ?? undefined } : undefined,
    generate: built ? { out: producedConns + producedDs } : undefined,
    launcher: has("answer") ? { out: Math.max(1, launch.registeredScenes) } : undefined,
  };

  // 计时/缺口码叠加。
  const stepForNode: Partial<Record<FdeNodeKey, string>> = {
    comprehend: "dry_build", capability: "dry_build", gap: "gap_analysis",
    generate: "publish_build", closure: "dry_build", publish: "publish_build", launcher: "inference",
  };

  return FDE_NODE_KEYS.map((key): FdeNode => {
    const def = DEF_BY_KEY.get(key)!;
    const st = status[key];
    const step = stepForNode[key] ? stepOf(steps, stepForNode[key]!) : undefined;
    let gapCode: string | undefined;
    if (st === "FAILED") {
      gapCode = key === "closure" && closure ? closureGapCode(closure) : step?.error?.code;
    }
    // E15：launcher 节点诚实标"待 B 注册"——有答案但场景仍 PENDING_BSTACK（单机/未配 AGENTCORE）
    // → 启动器卡定义可见、DataCore 本地可答，但未真注册进 QOS 启动器 → SOFT 缺口码（不静默假装已全注册）。
    let detail = step?.detail;
    if (key === "launcher" && st === "DONE" && launch.pendingBstack) {
      gapCode = "LAUNCHER_PENDING_BSTACK";
      detail = `${launch.registeredScenes} 个场景卡待 B 对账注册进 QOS 启动器（单机本地可答）`;
    }
    return {
      key,
      label: def.label,
      status: st,
      startedAt: step?.startedAt,
      endedAt: st === "DONE" || st === "FAILED" || st === "SKIPPED" ? step?.finishedAt : undefined,
      durationMs: step?.durationMs,
      io: io[key],
      drilldownRef: def.drilldownRef,
      gapCode,
      detail,
    };
  });
}

/** 工作流运行 → FDE 节点图（前端 <FdeGraph> + 实时事件用）。 */
export function fdeGraphForRun(run: BuildWorkflowRun): FdeNode[] {
  return projectFdeNodes({ steps: run.steps, context: run.context });
}

/** 节点状态汇总（一眼看建域走到哪/断在哪）。 */
export function summarizeFdeNodes(nodes: FdeNode[]): { total: number; done: number; failed: number; running: number; skipped: number; pending: number; failedAt?: FdeNodeKey } {
  const failed = nodes.find((n) => n.status === "FAILED");
  return {
    total: nodes.length,
    done: nodes.filter((n) => n.status === "DONE").length,
    failed: nodes.filter((n) => n.status === "FAILED").length,
    running: nodes.filter((n) => n.status === "RUNNING").length,
    skipped: nodes.filter((n) => n.status === "SKIPPED").length,
    pending: nodes.filter((n) => n.status === "PENDING").length,
    failedAt: failed?.key as FdeNodeKey | undefined,
  };
}
