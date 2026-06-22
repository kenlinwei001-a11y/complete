import { useState } from "react";
import type { TaskStreamState } from "@/sse/taskStreamReducer";
import zh from "@/locales/zh";
import styles from "./InferenceProcessDag.module.css";

/**
 * 推演过程编排 DAG（横切组件，inference-process-enhancement）：把 QOS 真实编排轨迹渲染为 HTML 同构的
 * 10 节点非线性编排图（②检索 ∥ ③装载 并行 → ④聚合 汇聚；⑩执行回采 跨周期反馈回 ②/④）。每节点可点开看
 * 输入/过程/输出 + 涉及对象/求解器/Agent；缺口节点红（取答案 gap 块/error，守"绿测试≠能用"）。
 *
 * R13/R14：拓扑=编排定义（结构 config，非业务常数，同 PmDag 层定义/NAV_GROUPS）；节点状态由**真实**
 * 任务轨迹（routing.path/step 事件/answer/gap/error）派生，前端零写死步骤结论、无运行则标"未跑"。
 */
type EdgeType = "par" | "conv" | "seq" | "aux" | "fb";
interface SkelNode { id: number; label: string; x: number; y: number; ipo: { in: string; proc: string; out: string }; kind: string }

// 编排骨架（10 节点，口径同 HTML STORY_SHORT/STORY_POS/STORY_EDGES）。结构 config，非业务数据。
const NODES: SkelNode[] = [
  { id: 1, label: "解析场景", x: 60, y: 110, kind: "Intent", ipo: { in: "用户问句 + 场景上下文", proc: "意图分类（确定性关键词打分）", out: "Intent / 路径 A|B" } },
  { id: 2, label: "检索切片", x: 220, y: 50, kind: "SliceSpec", ipo: { in: "Intent + 对象类型", proc: "resolve_slice 召回子图", out: "本体切片节点集" } },
  { id: 3, label: "装载因子", x: 220, y: 170, kind: "ObjectInstance", ipo: { in: "切片对象 + 派生属性", proc: "活数据/系数装载", out: "求解器入参" } },
  { id: 4, label: "聚合产能", x: 390, y: 110, kind: "Solver", ipo: { in: "②∥③ 汇聚入参", proc: "capacity_rollup/forecast 聚合", out: "产能/缺口/P50·P90" } },
  { id: 5, label: "识别瓶颈", x: 540, y: 110, kind: "Solver", ipo: { in: "产能矩阵", proc: "bottleneck_matrix", out: "瓶颈工序/设备" } },
  { id: 6, label: "情景推演", x: 690, y: 110, kind: "Solver", ipo: { in: "瓶颈 + 处置方案", proc: "counterfactual/risk_timeline", out: "双轨曲线/越线日" } },
  { id: 7, label: "方案比对", x: 840, y: 110, kind: "Solver", ipo: { in: "候选方案集", proc: "plan_generate 打分", out: "五维评分/推荐" } },
  { id: 8, label: "校验解释", x: 990, y: 110, kind: "Rule", ipo: { in: "结论 + 规则库", proc: "evaluate_rules C01–C33", out: "违规项/解释" } },
  { id: 9, label: "写回行动", x: 1130, y: 110, kind: "ActionDraft", ipo: { in: "拍板/调整", proc: "create_action_draft（R4）", out: "Action 草稿待审批" } },
  { id: 10, label: "执行回采", x: 1130, y: 220, kind: "Feedback", ipo: { in: "执行结果/实绩", proc: "回采校准（跨周期）", out: "回写记忆库/系数" } },
];
const EDGES: { from: number; to: number; t: EdgeType }[] = [
  { from: 1, to: 2, t: "par" }, { from: 1, to: 3, t: "par" },
  { from: 2, to: 4, t: "conv" }, { from: 3, to: 4, t: "conv" },
  { from: 4, to: 5, t: "seq" }, { from: 5, to: 6, t: "seq" }, { from: 6, to: 7, t: "seq" },
  { from: 7, to: 8, t: "seq" }, { from: 8, to: 9, t: "seq" }, { from: 9, to: 10, t: "seq" },
  { from: 6, to: 4, t: "aux" }, // 情景推演旁路校正聚合
  { from: 10, to: 2, t: "fb" }, { from: 10, to: 4, t: "fb" }, // 跨周期反馈
];
const EDGE_STYLE: Record<EdgeType, { color: string; dash?: string; label: string }> = {
  par: { color: "#54B5C4", label: "并行分叉" },
  conv: { color: "#7CC4A0", label: "汇聚" },
  seq: { color: "#6B7886", label: "序列" },
  aux: { color: "#E8B54A", dash: "4 3", label: "历史校正旁路" },
  fb: { color: "#C470B8", dash: "6 4", label: "跨周期反馈" },
};

/** 由真实任务流派生每节点状态（done/running/pending/gap）——非写死。 */
type NodeStatus = "done" | "running" | "pending" | "gap";
function deriveStatus(state: TaskStreamState): { reached: number; gapNode: number | null } {
  const hasGap = !!state.answer?.blocks.some((b) => b.type === "gap") || state.status === "failed";
  // 步进：connecting/routing→1，running(step 事件)→中段，answer→8，action_draft→9。
  let reached = 0;
  if (state.status !== "idle") reached = 1;
  if (state.routing) reached = 3; // 路径定了 → ②③ 可达
  const stepEvents = state.events.filter((e) => e.event === "step.started" || e.event === "step.completed").length;
  if (stepEvents > 0) reached = Math.min(8, 4 + Math.floor(stepEvents / 2));
  if (state.answer) reached = Math.max(reached, 8);
  if (state.actionDraft) reached = 9;
  // 缺口/失败 → 标在当前可达的下一节点（断在哪一步）。
  const gapNode = hasGap ? Math.min(10, reached + 1) : null;
  return { reached, gapNode };
}

/** model 收敛子模式：型号→已认证产线→基地 收敛网络（项目/产能推演 driven by 型号；同 pmDagSVG 收敛形态）。 */
const MODEL_NET = {
  cols: [
    { title: "型号", nodes: [{ label: "目标型号", sub: "Model" }] },
    { title: "已认证产线", nodes: [{ label: "认证产线集", sub: "Line · cert✓" }] },
    { title: "可产基地", nodes: [{ label: "收敛基地网络", sub: "Base · producible_at" }] },
  ],
};

export function InferenceProcessDag({
  state,
  solved,
  gapNode: gapNodeProp,
  mode = "orchestration",
  testId = "inference-dag",
}: {
  /** QueryDock 实时任务流（轨迹由 SSE 派生）。 */
  state?: TaskStreamState;
  /** 求解器视图（risk/project/order/audit/generate）：该次推演已出结论 → 全节点 done。 */
  solved?: boolean;
  /** 求解器视图缺口节点（如结论含缺口/不可达），可选。 */
  gapNode?: number | null;
  /** orchestration=10 节点编排图（默认）；model-network=型号收敛子模式。 */
  mode?: "orchestration" | "model-network";
  testId?: string;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const derived = state ? deriveStatus(state) : { reached: solved ? 10 : 0, gapNode: gapNodeProp ?? null };
  const { reached, gapNode } = derived;

  // model 收敛子模式：型号→认证产线→基地 收敛网络（复用 ProjectSim 的 PmDag 形态，组件内简版）。
  if (mode === "model-network") {
    return (
      <div className={styles.box} data-testid={testId} data-mode="model-network">
        <div className={styles.legend} data-testid="inference-model-net">型号 → 已认证产线 → 可产基地（收敛网络）</div>
        <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
          {MODEL_NET.cols.map((c, ci) => (
            <span key={c.title} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
              {ci > 0 && <span style={{ color: "var(--muted2)" }}>⇢</span>}
              <div className={`${styles.node} ${styles.done}`} style={{ flex: 1, padding: "8px 10px" }} data-testid={`model-net-col-${ci}`}>
                <div style={{ fontSize: 10, color: "var(--muted2)" }}>{c.title}</div>
                {c.nodes.map((n) => (<div key={n.label} style={{ fontSize: 11.5 }}><b>{n.label}</b> <i style={{ fontStyle: "normal", color: "var(--muted2)", fontSize: 10 }}>{n.sub}</i></div>))}
              </div>
            </span>
          ))}
        </div>
      </div>
    );
  }
  const statusOf = (id: number): NodeStatus =>
    gapNode === id ? "gap" : id <= reached ? "done" : id === reached + 1 ? "running" : "pending";
  const byId = (id: number) => NODES.find((n) => n.id === id)!;
  const selNode = sel != null ? byId(sel) : null;
  const W = 1240, H = 280;

  return (
    <div className={styles.box} data-testid={testId}>
      <div className={styles.legend} data-testid="inference-legend">
        {(Object.keys(EDGE_STYLE) as EdgeType[]).map((t) => (
          <span key={t} className={styles.legendItem}>
            <i style={{ background: EDGE_STYLE[t].color }} />
            {EDGE_STYLE[t].label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label="推演过程编排 DAG">
        <defs>
          <marker id="ip-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#6B7886" />
          </marker>
        </defs>
        {EDGES.map((e, i) => {
          const a = byId(e.from), b = byId(e.to);
          const st = EDGE_STYLE[e.t];
          const x1 = a.x + 56, y1 = a.y + 18, x2 = b.x, y2 = b.y + 18;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={st.color}
              strokeWidth={1.6}
              strokeDasharray={st.dash}
              markerEnd="url(#ip-arrow)"
              opacity={0.8}
              data-testid={`inference-edge-${e.from}-${e.to}-${e.t}`}
            />
          );
        })}
        {NODES.map((n) => {
          const s = statusOf(n.id);
          return (
            <g key={n.id} transform={`translate(${n.x},${n.y})`} onClick={() => setSel(sel === n.id ? null : n.id)} style={{ cursor: "pointer" }} data-testid={`inference-node-${n.id}`} data-status={s}>
              <rect width={112} height={36} rx={7} className={`${styles.node} ${styles[s]} ${sel === n.id ? styles.sel : ""}`} />
              <text x={56} y={16} textAnchor="middle" className={styles.nodeLabel}>{n.id}. {n.label}</text>
              <text x={56} y={28} textAnchor="middle" className={styles.nodeKind}>{n.kind}</text>
            </g>
          );
        })}
      </svg>

      {selNode && (
        <div className={styles.ipo} data-testid={`inference-ipo-${selNode.id}`}>
          <b>{selNode.id}. {selNode.label}</b>
          {statusOf(selNode.id) === "gap" && <span className="badge red" style={{ marginLeft: 8 }} data-testid="inference-ipo-gap">{zh.sim.inference.gap}</span>}
          {statusOf(selNode.id) === "pending" && <span className="badge" style={{ marginLeft: 8 }}>{zh.sim.inference.notRun}</span>}
          <div className={styles.ipoRow}><span>{zh.sim.inference.in}</span>{selNode.ipo.in}</div>
          <div className={styles.ipoRow}><span>{zh.sim.inference.proc}</span>{selNode.ipo.proc}</div>
          <div className={styles.ipoRow}><span>{zh.sim.inference.out}</span>{selNode.ipo.out}</div>
        </div>
      )}
    </div>
  );
}
