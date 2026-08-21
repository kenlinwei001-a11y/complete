/**
 * WO-SIM-FE-HOME · 中栏「端到端流程图」（24 站地铁图）。
 *
 * ── 几何逐条照抄规格 ────────────────────────────────────────────────────────
 * `docs/ux-spec/sandbox/sandbox-home.html` 第 354–426 行：
 * `viewBox 0 0 1060 470` · `X0=104 X1=884 Y0=54 LH=84` · 底纹 11×47 / 22×50 ·
 * 站圈 `r = 4.4 + √占比 × 2.2`（**面积法**：面积 ∝ 占比，否则就是「一个巨圈 + 十二个看不见的点」）·
 * 站名 >6 字断成两行（`slice(0,6)`）· 阻滞区间画成**同段相邻站的加粗区段**
 * （不是跨段斜线 —— 斜线会被读成一条错误的连线）。
 *
 * ── 站名 / 站序 / 分段的来源（**一个字都不许自己编**）─────────────────────
 * · **站名** 一律 `CHAIN_NODE_REGISTRY[].label`（契约 §2.5：前端不另维护中文映射表）；
 * · **分段** 一律 `CHAIN_NODE_REGISTRY[].stage`（契约枚举 `CHAIN_STAGES`，顺序即链路顺序）；
 * · **站序** 注册表给不了 —— 它是**登记序**（新增一律追加在末位以保下标语义稳定，见契约
 *   `chain-sim.ts` §2.5 的原文），不是流程序。故本文件用 `FLOW_LAYOUT` 声明「流程序 + 占比 + 阻滞」。
 *   该表**键类型锚在契约上**（`Record<RegisteredChainNodeId, …>`，非 `Partial`）：
 *   注册表增删一条 ⇒ `tsc` 当场 TS2739/TS2353，编译期就红，不会漂。
 *   这正是 `scripts/check-chain-node-singlesource.mjs` 判据 C 明文放行的写法
 *   （门原话：「把它声明成 `const T: Partial<Record<Rid, …>>`…键就绑在编译期了，本判据按机制放行」）。
 *   ⚠ 不许改成 `as` 断言、也不许把键类型掺成 `Rid | string` —— 那两条实测都会让 `tsc` 不再咬。
 *
 * ── 站圈占比的数据出身 ──────────────────────────────────────────────────────
 * 真源 = 求解器 `chain_loss_attribution`（`useChainNodeLoss()`）。载荷按 `stepId → nodeId` 归并
 * （求解器的归因行是**环节级**的，站是**节点级**的，一个站可能吃掉多个环节的损失）。
 * 求解器取不到数（未接后端 / 该视图 feature 关闭 / 载荷形状不合契约）时回落到 `FLOW_LAYOUT.lossPct`
 * —— 那是**规格里的占位数**，`source` 会如实报 `"placeholder"`，不许拿它冒充实测。
 */
import { useEffect, useState } from "react";
import {
  CHAIN_NODE_REGISTRY,
  CHAIN_STAGES,
  chainNodeDef,
  type ChainNodeDef,
  type ChainStage,
} from "@platform/contracts";
import { runSolver } from "@/api/endpoints";
import { CHAIN_LOSS_SOLVER_KEY, ChainLossPayloadSchema, STAGE_LABEL } from "../chainLineMap";

/** 在册节点 id 的**字面量联合**（派生自契约，不是本地起个同名别名白嫖）。 */
type RegisteredChainNodeId = ChainNodeDef["nodeId"];

interface StationLayout {
  /** 本段内的**流程序**（0 起）。注册表是登记序，给不了这个。 */
  seq: number;
  /** 站圈占比（%）—— 求解器取不到数时的**规格占位值**。 */
  lossPct: number;
  /** 该站是否处于受击态（红实心 + 外圈红环 + 站名加粗）。 */
  hit?: true;
  /** 阻滞区间：从本站沿**本段干线**加粗到本段第 `blockToSeq` 站。 */
  blockToSeq?: number;
}

/**
 * 流程序 / 占位占比 / 阻滞区间。**键 = 在册 nodeId（编译期绑死）**，值取自规格
 * `sandbox-home.html` 的 `LANES[].n[]`（`[站名, 占比, 受击]`）逐条对应。
 * 用**非 `Partial`** 的 `Record` 是刻意的：注册表若新增一条而这里没跟上，`tsc` 直接红，
 * 而不是屏上安静地少一站。
 */
const FLOW_LAYOUT: Record<RegisteredChainNodeId, StationLayout> = { // hardcoded-data-allow —— seq/blockToSeq 是**版面**（注册表是登记序，给不了流程序）；lossPct 是规格占位，真值一到即被 useChainNodeLoss 覆盖
  // 需求段（DEMAND）
  "demand.forecast": { seq: 0, lossPct: 1 },
  "demand.quote": { seq: 1, lossPct: 1 },
  "demand.consensus": { seq: 2, lossPct: 3 },
  // 订单段（ORDER）
  "order.review": { seq: 0, lossPct: 2 },
  "order.settlement": { seq: 1, lossPct: 1 },
  "order.cash": { seq: 2, lossPct: 1 },
  // 产能段（CAPACITY）
  "capacity.rccp": { seq: 0, lossPct: 4 },
  "capacity.schedule": { seq: 1, lossPct: 5, hit: true },
  "capacity.wo_release": { seq: 2, lossPct: 2 },
  "capacity.qc_batch": { seq: 3, lossPct: 13, hit: true, blockToSeq: 5 },
  "capacity.quality": { seq: 4, lossPct: 6 },
  "capacity.aging": { seq: 5, lossPct: 34, hit: true },
  "capacity.maint": { seq: 6, lossPct: 2 },
  // 物料段（MATERIAL）
  "material.mrp": { seq: 0, lossPct: 2 },
  "material.purchase_req": { seq: 1, lossPct: 1 },
  "material.purchase_order": { seq: 2, lossPct: 1 },
  "material.inbound_transit": { seq: 3, lossPct: 3 },
  "material.iqc": { seq: 4, lossPct: 2 },
  "material.replenish": { seq: 5, lossPct: 4, blockToSeq: 6 },
  "material.kitting": { seq: 6, lossPct: 21, hit: true },
  "material.shipping": { seq: 7, lossPct: 2 },
  // 交付段（DELIVERY）
  "delivery.fg_stock": { seq: 0, lossPct: 1 },
  "delivery.transit": { seq: 1, lossPct: 2 },
  "delivery.acceptance": { seq: 2, lossPct: 1 },
};

interface CalloutSpec {
  /** 卡头的时钟（规格占位）。 */
  clock: string;
  /** 站名后的批位代号（`老化静置 C3` 的 `C3`）。 */
  code: string;
  tone: "ok" | "danger";
  /** 卡片 x：默认锚在本站，`atSeq` 指定则锚在**本段第 N 站**（规格第 415 行就这么干的）。 */
  atSeq?: number;
  dx: number;
  dy: number;
  /**
   * 卡头站名的**显示简称**。规格为控宽用了简称（`过程质检` vs 在册 `过程质检攒批`）。
   * 这不是第二套站名 —— 站名单源仍是注册表，这里只记「这一格放不下全名」的显示口径。
   */
  short?: string;
  lines: readonly string[];
}

/** 呼出卡。键同样锚在契约上（判据 C 按机制放行的写法）。 */
const FLOW_CALLOUTS = { // hardcoded-data-allow —— 呼出卡的坐标/偏移是**版面**，卡内数字是规格占位（WO-SIM-BE-SERIES 之后随甘特一起换掉）
  "capacity.aging": {
    clock: "38:42",
    code: "C3",
    tone: "ok",
    dx: 30,
    dy: -72,
    lines: ["批号 P0001", "在制 4.2k 套", "库存 3.8k 套", "节拍 1.2/h"],
  },
  "capacity.qc_batch": {
    clock: "47:32",
    code: "Y2",
    tone: "danger",
    dx: -150,
    dy: -72,
    short: "过程质检",
    lines: ["批号 P0001", "在制 4.2k 套", "库存 3.8k 套", "节拍 1.2/h"],
  },
  "material.kitting": {
    clock: "32:42",
    code: "P2",
    tone: "danger",
    atSeq: 1,
    dx: -34,
    dy: 52,
    lines: ["批号 P0002", "节拍 1.2/h"],
  },
} satisfies Partial<Record<RegisteredChainNodeId, CalloutSpec>>;

/** 段色（`ChainStage` 是契约枚举 ⇒ 少一段 `tsc` 当场红）。逐值 = 规格 `LANES[].c` 的 token 名。 */
const STAGE_COLOR: Record<ChainStage, string> = {
  DEMAND: "var(--c-forecast)",
  ORDER: "var(--c-product)",
  CAPACITY: "var(--c-capacity)",
  MATERIAL: "var(--c-process)",
  DELIVERY: "var(--c-factory)",
};

// ── 规格几何常量（第 363 行）────────────────────────────────────────────────
const X0 = 104;
const X1 = 884;
const Y0 = 54;
const LH = 84;
const VIEW_W = 1060;
const VIEW_H = 470;
/** 站名断行阈值（规格：`w.length>6 ? [w.slice(0,6), w.slice(6)] : [w]`）。 */
const LABEL_WRAP_AT = 6;
/** 站圈上方标百分比的门槛（规格：`loss>=10`）。 */
const PCT_LABEL_MIN = 10;

interface Station {
  nodeId: string;
  label: string;
  stage: ChainStage;
  seq: number;
  x: number;
  y: number;
  lossPct: number;
  hit: boolean;
  blockToSeq: number | undefined;
}

/** 每段的站，按流程序排好（站名 / 分段来自注册表，序来自 `FLOW_LAYOUT`）。 */
function stationsByStage(lossPctByNodeId: Readonly<Record<string, number>>): Station[][] {
  return CHAIN_STAGES.map((stage) => {
    const rows = CHAIN_NODE_REGISTRY.filter((n) => n.stage === stage)
      .map((n) => ({ n, lay: FLOW_LAYOUT[n.nodeId] }))
      .sort((a, b) => a.lay.seq - b.lay.seq);
    const n = rows.length;
    const laneIdx = CHAIN_STAGES.indexOf(stage);
    return rows.map(({ n: node, lay }, i) => ({
      nodeId: node.nodeId,
      label: node.label,
      stage,
      seq: i,
      x: X0 + i * (n > 1 ? (X1 - X0) / (n - 1) : 0),
      y: Y0 + laneIdx * LH,
      lossPct: lossPctByNodeId[node.nodeId] ?? lay.lossPct,
      hit: lay.hit === true,
      blockToSeq: lay.blockToSeq,
    }));
  });
}

/** 站圈半径（面积 ∝ 占比）。规格第 396 行。 */
export function stationRadius(lossPct: number): number {
  return 4.4 + Math.sqrt(Math.max(0, lossPct)) * 2.2;
}

/**
 * 求解器载荷 → **节点级**占比。
 * 归因行是环节级（`stepId`），站是节点级 ⇒ 按 `nodes[].steps[].stepId` 反查归属并求和。
 * 这一层是纯函数，`useChainNodeLoss` 与测试共用同一份，不各写一遍。
 */
export function nodeLossFromPayload(payload: {
  nodes: readonly { nodeId: string; steps: readonly { stepId: string }[] }[];
  attribution: readonly { stepId: string; pctOfChainLoss: number }[];
}): Record<string, number> {
  const nodeOfStep = new Map<string, string>();
  for (const n of payload.nodes) for (const s of n.steps) nodeOfStep.set(s.stepId, n.nodeId);
  const out: Record<string, number> = {};
  for (const a of payload.attribution) {
    const nodeId = nodeOfStep.get(a.stepId);
    if (nodeId === undefined) continue; // 归因到一个载荷里没有的环节 ⇒ 丢弃，不去猜它属于谁
    out[nodeId] = (out[nodeId] ?? 0) + a.pctOfChainLoss;
  }
  return out;
}

export interface ChainNodeLoss {
  /** 站圈占比（%），按 nodeId。**空表 = 求解器没给数**，视图回落到规格占位。 */
  byNodeId: Readonly<Record<string, number>>;
  source: "solver" | "placeholder";
}

/**
 * 站圈占比的取数口。走既有求解器通路（`POST /b/v1/solvers/chain_loss_attribution/run`，
 * 与 `ChainLineMapView` 同一个 key、同一份契约 schema —— 不另开第二条取数路）。
 * 取不到数不是错误态：本图仍要出得来，只是 `source` 如实报 `placeholder`。
 */
export function useChainNodeLoss(): ChainNodeLoss {
  const [loss, setLoss] = useState<ChainNodeLoss>({ byNodeId: {}, source: "placeholder" });
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    runSolver(CHAIN_LOSS_SOLVER_KEY, {}, ac.signal)
      .then((raw) => {
        if (cancelled) return;
        const parsed = ChainLossPayloadSchema.safeParse((raw as { data?: unknown })?.data ?? raw);
        // 形状不合契约 ⇒ 保持占位并如实标注，**不猜也不补字段**（S0 冻结的意义）。
        if (!parsed.success) return;
        const byNodeId = nodeLossFromPayload(parsed.data);
        if (Object.keys(byNodeId).length === 0) return;
        setLoss({ byNodeId, source: "solver" });
      })
      .catch(() => {
        /* 取不到数就用占位；错误细节由 `ChainLineMapView` 那条专门的诊断路负责呈现 */
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);
  return loss;
}

const MONO = { fontFamily: "var(--font-mono)" } as const;

export function FlowMap(): JSX.Element {
  const loss = useChainNodeLoss();
  const lanes = stationsByStage(loss.byNodeId);
  const bufferLane = lanes[CHAIN_STAGES.indexOf("MATERIAL")] ?? [];
  const bufferA = bufferLane[5];
  const bufferB = bufferLane[6];

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid slice"
      data-testid="sandbox-home-flowmap"
      data-loss-source={loss.source}
    >
      {/* 底纹 */}
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`h${i}`} x1={0} y1={i * 47} x2={VIEW_W} y2={i * 47} style={{ stroke: "var(--sh-hair04)" }} />
      ))}
      {Array.from({ length: 22 }, (_, j) => (
        <line key={`v${j}`} x1={j * 50} y1={0} x2={j * 50} y2={VIEW_H} style={{ stroke: "var(--sh-hair04)" }} />
      ))}

      {/* 缓冲区（画在站之前，不压站名） */}
      {bufferA !== undefined && bufferB !== undefined && (
        <ellipse
          cx={(bufferA.x + bufferB.x) / 2}
          cy={bufferA.y}
          rx={78}
          ry={22}
          strokeWidth={1.1}
          style={{ fill: "var(--sh-buffer-fill)", stroke: "var(--ok)" }}
        />
      )}

      {/* 段：段名 + 干线 + 段间折返虚线 */}
      {lanes.map((lane, li) => {
        const stage = CHAIN_STAGES[li] as ChainStage;
        const y = Y0 + li * LH;
        const color = STAGE_COLOR[stage];
        const right = lane.length > 1 ? X1 : X0;
        return (
          <g key={stage} data-testid={`sandbox-home-lane-${stage}`}>
            <text
              x={X0 - 18}
              y={y + 4}
              textAnchor="end"
              fontSize={12}
              fontWeight={700}
              style={{ fill: color }}
              data-testid={`sandbox-home-lane-label-${stage}`}
            >
              {STAGE_LABEL[stage]}
            </text>
            <line
              x1={X0}
              y1={y}
              x2={right}
              y2={y}
              strokeWidth={3.4}
              strokeLinecap="round"
              opacity={0.62}
              style={{ stroke: color }}
            />
            {li < lanes.length - 1 && (
              <path
                d={`M${X1} ${y} L${X1 + 22} ${y} L${X1 + 22} ${y + LH / 2} L${X0 - 22} ${y + LH / 2} L${X0 - 22} ${y + LH} L${X0} ${y + LH}`}
                fill="none"
                strokeWidth={1.4}
                strokeDasharray="4 4"
                style={{ stroke: "var(--sh-hair12)" }}
              />
            )}
          </g>
        );
      })}

      {/* 阻滞区间：干线上的加粗区段（**同段相邻站之间**，不是跨段斜线） */}
      {lanes.flatMap((lane) =>
        lane
          .filter((s) => s.blockToSeq !== undefined)
          .map((s) => {
            const to = lane[s.blockToSeq as number];
            if (to === undefined) return null;
            return (
              <line
                key={`blk-${s.nodeId}`}
                x1={s.x}
                y1={s.y}
                x2={to.x}
                y2={to.y}
                strokeWidth={5}
                strokeLinecap="round"
                opacity={0.95}
                style={{ stroke: "var(--danger)" }}
                data-testid={`sandbox-home-block-${s.nodeId}`}
              />
            );
          }),
      )}

      {/* 站 */}
      {lanes.flatMap((lane, li) =>
        lane.map((s) => {
          const r = stationRadius(s.lossPct);
          const parts =
            s.label.length > LABEL_WRAP_AT ? [s.label.slice(0, LABEL_WRAP_AT), s.label.slice(LABEL_WRAP_AT)] : [s.label];
          return (
            <g key={s.nodeId} data-testid={`sandbox-home-station-${s.nodeId}`} data-hit={s.hit ? "1" : "0"}>
              {s.hit && (
                <circle cx={s.x} cy={s.y} r={r + 6} fill="none" strokeWidth={1.1} opacity={0.5} style={{ stroke: "var(--danger)" }} />
              )}
              <circle
                cx={s.x}
                cy={s.y}
                r={r}
                strokeWidth={2.2}
                style={{ fill: s.hit ? "var(--danger)" : STAGE_COLOR[CHAIN_STAGES[li] as ChainStage], stroke: "var(--panel)" }}
              />
              {s.lossPct >= PCT_LABEL_MIN && (
                <text x={s.x} y={s.y - r - 7} textAnchor="middle" fontSize={10} style={{ ...MONO, fill: "var(--warn-txt)" }}>
                  {s.lossPct}%
                </text>
              )}
              {parts.map((t, pi) => (
                <text
                  key={pi}
                  x={s.x}
                  y={s.y + r + 13 + pi * 11}
                  textAnchor="middle"
                  fontSize={9.5}
                  fontWeight={s.hit ? 600 : 400}
                  style={{ fill: s.hit ? "var(--danger-txt)" : "var(--sh-station-label)" }}
                  data-testid={`sandbox-home-station-label-${s.nodeId}-${pi}`}
                >
                  {t}
                </text>
              ))}
            </g>
          );
        }),
      )}

      {/* 呼出卡：一律落在**段间空隙**，横坐标避开站位 */}
      {Object.entries(FLOW_CALLOUTS).map(([nodeId, c]) => {
        const li = CHAIN_STAGES.indexOf(chainNodeDef(nodeId)?.stage ?? "DEMAND");
        const lane = lanes[li] ?? [];
        const anchor = lane.find((s) => s.nodeId === nodeId);
        if (anchor === undefined) return null;
        const spec = c as CalloutSpec;
        const baseX = spec.atSeq === undefined ? anchor.x : (lane[spec.atSeq]?.x ?? anchor.x);
        const cx = baseX + spec.dx;
        const cy = anchor.y + spec.dy;
        const tone = spec.tone === "ok" ? "var(--ok)" : "var(--danger)";
        const head = `${spec.short ?? anchor.label} ${spec.code}`;
        return (
          <g key={nodeId} data-testid={`sandbox-home-callout-${nodeId}`}>
            <line
              x1={anchor.x}
              y1={anchor.y}
              x2={cx + (cx < anchor.x ? 110 : 4)}
              y2={cy + 6}
              strokeWidth={1}
              style={{ stroke: "var(--sh-callout-lead)" }}
            />
            <text x={cx} y={cy} fontSize={15} fontWeight={700} style={{ ...MONO, fill: tone }}>
              {spec.clock}
            </text>
            {[head, ...spec.lines].map((l, k) => (
              <text key={k} x={cx} y={cy + 14 + k * 11} fontSize={9} style={{ fill: "var(--sh-callout-txt)" }}>
                {l}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
