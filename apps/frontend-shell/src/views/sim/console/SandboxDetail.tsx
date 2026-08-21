import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { CHAIN_NODE_REGISTRY, type ImpactChange } from "@platform/contracts";
import { api } from "@/api/apiClient";
import { ImpactCone, useImpactCone } from "./ImpactCone";
import { StrategyCards, useMitigationCards, type MitigationArgs } from "./StrategyCards";
import styles from "./SandboxDetail.module.css";

/**
 * WO-SIM-FE-DETAIL · 推演沙盘「传导识别 + 应对策略」页。
 *
 * ══ 规格 ═══════════════════════════════════════════════════════════════════
 * `docs/ux-spec/sandbox/sandbox-detail.html` + 基准 `pg2.png`（1440×897 · dsf=2）。
 * README 原话：「**这些是要移植的，不是要重新解释的。**」所以这份 TSX 的 DOM 结构与规格里
 * 那段 HTML **逐节点同构**（同样的层级、同样的顺序、同样的类名），版面数字全在
 * `SandboxDetail.module.css` 里、与规格逐条对账。`test/sandbox-detail-pixel.test.tsx`
 * 拿规格 HTML **现读**来断言，改一个数而不同步改规格 ⇒ 当场红。
 *
 * ══ 数据接线现状（照实说，不许拿"接了线"盖住"只接了一半"）═════════════════
 * | 屏上的东西 | 真出处 | 今天 |
 * |---|---|---|
 * | 传导识别表 / 节点详情 / 流转明细 | `GET /a/v1/sim/sessions/:id/node-detail` | **端点还在做**（`WO-SIM-BE-DRILL`）⇒ `useNodeDetail()` 里的规格占位 |
 * | 应对策略三档 | 求解器 `mitigation_select` | **已接**（名字/推荐/排序真数据；残差比求解器没有，见 `StrategyCards.tsx`） |
 * | 影响半径扇区 | `POST /a/v1/simulation/impact-analysis` | **已接**（三条冲击真数据；半径/张角端点没有，见 `ImpactCone.tsx`） |
 * | 左侧地铁图站名 | `CHAIN_NODE_REGISTRY`（contracts 冻结表） | **已接**：站名逐个由 `nodeId` 查表得到，一个字都不是手写的 |
 *
 * 占位与真数据的分界一律走 `data-source` / `data-prov-*` 属性 —— 本页验收线是像素级 1:1，
 * 往版面里塞一行「占位」字样会当场破坏它；属性对测试可见、对像素不可见。
 *
 * ⚠ README「已知的取舍」第 2 条：**左侧地铁图被面板边界裁切是效果不是缺陷**（地图延续出画面）。
 *   段名看不见是照参考图来的，别去"修"。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 占位数据（**集中在这一处**，不许散进 JSX）
// ══════════════════════════════════════════════════════════════════════════

export interface ConductionRow {
  /** 批号 */ batch: string;
  /** 环节 */ node: string;
  /** 型号 */ model: string;
  /** 在制 */ wip: string;
  /** 影响级（1..4 → 绿/蓝/黄/红） */ level: 1 | 2 | 3 | 4;
  /** 耗时 */ elapsed: string;
  selected?: boolean;
}

export interface FlowRow {
  time: string;
  station: string;
  batch: string;
  wip: string;
  takt: string;
  yieldRate: string;
  selected?: boolean;
}

export interface NodeCard {
  title: string;
  sub: string;
  /** 左右两列共 8 格，逐格 [标签, 值, 是否高亮]。 */
  kv: readonly (readonly [string, string, boolean?])[];
  miniLabel: string;
  route: { from: string; to: string; tag: string };
}

export interface StripModel {
  kms: readonly { label: string; left: string }[];
  self: string;
  ticks: readonly { label: string; left: string }[];
  events: readonly { label: string; left: string }[];
  chips: readonly { label: string; left: string }[];
}

/** `GET /a/v1/sim/sessions/:id/node-detail` 的响应形状（端点还在做，形状先定在这里）。 */
export interface NodeDetailPayload {
  /** 模拟时钟（系统条上那一行）。 */
  clock: string;
  /** 传导方向下拉的选项。 */
  directions: readonly string[];
  /** 四个影响维过滤器。 */
  filters: readonly { label: string; on: boolean }[];
  /** 传导识别表。 */
  conduction: readonly ConductionRow[];
  /** 时间条（阻滞事件 + 冲击徽标）。 */
  strip: StripModel;
  /** 节点详情卡。 */
  card: NodeCard;
  /** 流转明细表。 */
  flow: readonly FlowRow[];
  /** 地铁图上被选中节点的呼出四行。 */
  callout: readonly string[];
}

/** 影响级 → 令牌（规格 `C=["#62be77","#4c90f0","#e8b54a","#e0626c"]`）。 */
const LEVEL_TOKEN = ["var(--ok)", "var(--accent)", "var(--warn)", "var(--danger)"] as const;

/**
 * 规格里那一套占位数（`sandbox-detail.html` 逐值抄下来）。
 *
 * README 最后一条告诫：**四页的数字是内部自洽的一套**（产能 −18% → 稼动率 −18.0pp →
 * Q3 缺口 6 万套 → 外协 ¥1,840 万）。接真数据时整套换掉，别只换一半。
 */
const PLACEHOLDER_NODE_DETAIL: NodeDetailPayload = {
  clock: "2027年3月14日　12:28:39",
  directions: ["传导方向 - 常州→盐城", "传导方向 - 常州→合肥"],
  filters: [
    { label: "产能影响", on: true },
    { label: "物料影响", on: true },
    { label: "时间偏差", on: false },
    { label: "成本偏差", on: false },
  ],
  // 规格里的 D[] / N[] / M[] 三张表展开后的样子（`环节` 一列是端点未接通前的占位文案）。
  conduction: [
    { batch: "P2161", node: "老化静置", model: "LFP-314", wip: "4.2k", level: 1, elapsed: "21'12" },
    { batch: "P2162", node: "齐套发料", model: "NCM-300", wip: "3.8k", level: 3, elapsed: "32'42", selected: true },
    { batch: "P2161", node: "过程质检", model: "NCM-050", wip: "2.6k", level: 2, elapsed: "12'12" },
    { batch: "P2161", node: "老化静置", model: "LFP-250", wip: "4.0k", level: 2, elapsed: "17'29" },
    { batch: "P2161", node: "排产计划", model: "LFP-314", wip: "1.9k", level: 1, elapsed: "8'32" },
    { batch: "P2161", node: "齐套发料", model: "NCM-300", wip: "3.1k", level: 2, elapsed: "12'09" },
    { batch: "P2161", node: "干线在途", model: "NCM-050", wip: "2.2k", level: 2, elapsed: "14'18" },
    { batch: "P2161", node: "老化静置", model: "LFP-314", wip: "4.4k", level: 2, elapsed: "3'12" },
    { batch: "P2161", node: "过程质检", model: "LFP-250", wip: "3.6k", level: 2, elapsed: "12'12" },
    { batch: "P2161", node: "齐套发料", model: "LFP-314", wip: "2.8k", level: 1, elapsed: "8'32" },
    { batch: "P2161", node: "排产计划", model: "NCM-300", wip: "3.3k", level: 2, elapsed: "14'18" },
    { batch: "P2161", node: "老化静置", model: "NCM-050", wip: "4.1k", level: 2, elapsed: "3'12" },
    { batch: "P2161", node: "干线在途", model: "LFP-250", wip: "2.4k", level: 2, elapsed: "12'12" },
    { batch: "P2161", node: "过程质检", model: "LFP-314", wip: "3.9k", level: 1, elapsed: "9'44" },
  ],
  strip: {
    kms: [
      { label: "76.86KM", left: "18%" },
      { label: "59.64KM", left: "50%" },
      { label: "45.23KM", left: "82%" },
    ],
    self: "P4212",
    ticks: ["01:20", "01:30", "01:40", "01:50", "02:00", "02:10", "02:20", "02:30", "02:40"].map((label, i) => ({
      label,
      left: `${9 + i * 10.2}%`,
    })),
    events: [
      { label: "阻滞时间 24:42", left: "30%" },
      { label: "阻滞时间 38:24", left: "58%" },
      { label: "阻滞时间", left: "86%" },
    ],
    chips: [
      { label: "齐套冲击 P2", left: "28%" },
      { label: "排产冲击 P1", left: "52%" },
      { label: "老化冲击 Y1", left: "80%" },
    ],
  },
  card: {
    title: "LFP-314 X2",
    sub: "Cell · Pack",
    kv: [
      ["节点编号", "P4212"],
      ["口径校准", "关闭"],
      ["环节类型", "老化静置"],
      ["上游工位", "160#"],
      ["传导能力", "是", true],
      ["在制批量", "3000"],
      ["日产能力", "3.0k 套"],
      ["下游距离", "98 工时"],
    ],
    miniLabel: "LFP-9　1k套",
    route: { from: "W-3140", to: "S-0420", tag: "SOP" },
  },
  flow: [
    { time: "01:32:10", station: "W-3634", batch: "B-4430", wip: "12k", takt: "1.2/h", yieldRate: "98%" },
    {
      time: "01:46:38",
      station: "W-3634",
      batch: "B-4430",
      wip: "12k",
      takt: "1.2/h",
      yieldRate: "98%",
      selected: true,
    },
    { time: "01:32:10", station: "W-3634", batch: "B-4430", wip: "12k", takt: "1.2/h", yieldRate: "98%" },
    { time: "01:32:10", station: "W-3634", batch: "B-4430", wip: "12k", takt: "1.2/h", yieldRate: "98%" },
  ],
  callout: ["批号 P4212", "在制 6.8k 套", "库存 3.8k 套", "节拍 1.2/h"],
};

/** 左下甘特（规格 `R[]`）：每行四段 [left%, width%, 类型, 文案]。 */
const GANTT_ROWS: readonly (readonly (readonly [number, number, "o" | "b" | "g", string])[])[] = [
  [
    [2, 20, "o", "请购"],
    [30, 26, "b", "齐套发料"],
    [62, 20, "g", "缓冲释放"],
    [86, 12, "o", "结转"],
  ],
  [
    [6, 18, "o", "采购下单"],
    [28, 28, "b", "老化静置"],
    [60, 22, "g", "缓冲释放"],
    [86, 12, "o", "结转"],
  ],
  [
    [3, 22, "o", "入厂在途"],
    [30, 24, "b", "齐套发料"],
    [58, 24, "g", "缓冲释放"],
    [85, 13, "o", "结转"],
  ],
  [
    [5, 19, "o", "到货检验"],
    [27, 27, "b", "老化静置"],
    [59, 23, "g", "缓冲释放"],
    [85, 13, "o", "结转"],
  ],
  [
    [2, 21, "o", "请购"],
    [26, 29, "b", "齐套发料"],
    [60, 21, "g", "缓冲释放"],
    [84, 14, "o", "结转"],
  ],
  [
    [4, 20, "o", "采购下单"],
    [29, 25, "b", "老化静置"],
    [57, 25, "g", "缓冲释放"],
    [85, 13, "o", "结转"],
  ],
  [
    [3, 19, "o", "到货检验"],
    [25, 30, "b", "齐套发料"],
    [58, 23, "g", "缓冲释放"],
    [84, 14, "o", "结转"],
  ],
  [
    [6, 17, "o", "入厂在途"],
    [27, 26, "b", "老化静置"],
    [56, 26, "g", "缓冲释放"],
    [85, 13, "o", "结转"],
  ],
  [
    [2, 22, "o", "请购"],
    [28, 27, "b", "齐套发料"],
    [59, 22, "g", "缓冲释放"],
    [84, 14, "o", "结转"],
  ],
];

/** 补货路径（规格 `#supp`）。 */
const REPLENISH_SEGS: readonly (readonly [number, number, "o" | "b" | "g", string])[] = [
  [2, 16, "o", "请购"],
  [20, 18, "o", "采购下单"],
  [40, 30, "b", "齐套发料 3/16"],
  [72, 14, "o", "结转"],
];

/** 原计划处置（规格 `#ot`）。 */
const PLAN_ROWS: readonly {
  name: string;
  line: string;
  material: string;
  team: string;
  target: string;
  level: 1 | 2 | 3 | 4;
  action: string;
  danger?: boolean;
}[] = [
  { name: "齐套计划 P1", line: "L-16", material: "LFP-9 x3…", team: "xxx 队", target: "3/22", level: 1, action: "正常执行" },
  {
    name: "齐套计划 P2",
    line: "L-22",
    material: "LFP-9 x3…",
    team: "xxx 团",
    target: "3/22",
    level: 3,
    action: "取消方案",
    danger: true,
  },
  { name: "老化计划 Y1", line: "L-25", material: "LFP-22 x3…", team: "xxx 队", target: "3/22", level: 1, action: "正常执行" },
  { name: "老化计划 Y2", line: "L-25", material: "LFP-21 x3…", team: "xxx 团", target: "3/22", level: 1, action: "正常执行" },
];

/** 方案设置表单（规格 `.form`）。 */
const FORM_PLACEHOLDER = {
  planName: "缓冲方案 K1",
  bases: ["盐城基地", "合肥基地"],
  materials: [
    { options: ["LFP-99"], qty: "X4" },
    { options: ["LFP-88"], qty: "X4" },
  ],
  lines: [
    { at: "36%", cap: "2/5" },
    { at: "18%", cap: "1/5" },
    { at: "52%", cap: "3/5" },
  ],
} as const;

/** 右侧标尺与图例（规格 `.rul` / `.lgd`）。 */
const RULER = ["12000", "13000", "14000", "15000", "16000"] as const;
const LEGEND: readonly { label: string; color?: string; kind: "line" | "dash" | "dot" | "ellipse" | "num" }[] = [
  { label: "阻滞区间", color: "var(--danger)", kind: "line" },
  { label: "缓冲区", kind: "ellipse" },
  { label: "传导关系", color: "var(--muted2)", kind: "dot" },
  { label: "阻滞发生", color: "var(--danger)", kind: "num" },
  { label: "缓冲到达", color: "var(--ok)", kind: "num" },
  { label: "计划路径", color: "var(--accent)", kind: "line" },
  { label: "预测路径", color: "var(--accent)", kind: "dash" },
  { label: "实际路径", color: "var(--c-process-txt)", kind: "dash" },
  { label: "补货路径", color: "var(--c-process-txt)", kind: "dot" },
];

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 地铁图片段 —— 站名单源 `CHAIN_NODE_REGISTRY`
// ══════════════════════════════════════════════════════════════════════════

/**
 * 五段 × 21 个在册节点。**站名不是手写的**：这里只写 `nodeId` 与规格里那张图用的**短名**，
 * 短名必须是注册表 `label` 的**子序列**（即：不许出现注册表里没有的字）——
 * 这条规则由 `sandbox-detail-pixel.test.tsx` 机器校验，写歪一个字当场红。
 *
 * 为什么要短名：注册表 label 是**契约名**（"产能与瓶颈复核" / "干线运输在途"），
 * 而 470px 宽的图上一站只放得下 4–5 个字，规格 `pg2.png` 用的就是短名。
 * 缩写规则登记在册（子序列）好过两套自由文案各写各的。
 *
 * `loss` = 该站的损失百分比（占位；≥13 时图上标数字），`hit` = 命中阻滞。
 */
interface LaneNode {
  nodeId: string;
  short?: string;
  loss: number;
  hit?: boolean;
}
interface Lane {
  key: string;
  color: string;
  nodes: readonly LaneNode[];
}

export const CHAIN_MAP_LANES: readonly Lane[] = [
  {
    key: "需求",
    color: "var(--c-forecast)",
    nodes: [
      { nodeId: "demand.forecast", loss: 1 },
      { nodeId: "demand.quote", loss: 1 },
      { nodeId: "demand.consensus", loss: 3 },
    ],
  },
  {
    key: "订单",
    color: "var(--c-product)",
    nodes: [
      { nodeId: "order.review", loss: 2 },
      { nodeId: "order.settlement", short: "开票对账", loss: 1 },
      { nodeId: "order.cash", loss: 1 },
    ],
  },
  {
    key: "产能",
    color: "var(--c-capacity)",
    nodes: [
      { nodeId: "capacity.rccp", short: "产能复核", loss: 4 },
      { nodeId: "capacity.schedule", loss: 5, hit: true },
      { nodeId: "capacity.wo_release", loss: 2 },
      { nodeId: "capacity.qc_batch", short: "过程质检", loss: 13, hit: true },
      { nodeId: "capacity.quality", short: "质量返工", loss: 6 },
      { nodeId: "capacity.aging", loss: 34, hit: true },
    ],
  },
  {
    key: "物料",
    color: "var(--c-process)",
    nodes: [
      { nodeId: "material.mrp", loss: 2 },
      { nodeId: "material.purchase_req", loss: 1 },
      { nodeId: "material.purchase_order", loss: 1 },
      { nodeId: "material.inbound_transit", short: "入厂在途", loss: 3 },
      { nodeId: "material.iqc", loss: 2 },
      { nodeId: "material.kitting", loss: 21, hit: true },
    ],
  },
  {
    key: "交付",
    color: "var(--c-factory)",
    nodes: [
      { nodeId: "delivery.fg_stock", loss: 1 },
      { nodeId: "delivery.transit", short: "干线在途", loss: 2 },
      { nodeId: "delivery.acceptance", loss: 1 },
    ],
  },
];

const REGISTRY_LABEL = new Map(CHAIN_NODE_REGISTRY.map((n) => [n.nodeId as string, n.label as string]));

/** 站名：短名优先，缺则用注册表 label。**两条路都通向注册表，没有第三条**。 */
export function laneNodeLabel(n: LaneNode): string {
  const registered = REGISTRY_LABEL.get(n.nodeId);
  if (registered === undefined) throw new Error(`不在 CHAIN_NODE_REGISTRY 里的站：${n.nodeId}`);
  return n.short ?? registered;
}

const MAP_X0 = 64;
const MAP_X1 = 396;
const MAP_Y0 = 48;
const MAP_LH = 84;
const laneX = (li: number, i: number): number => {
  const n = CHAIN_MAP_LANES[li]?.nodes.length ?? 0;
  return MAP_X0 + i * (n > 1 ? (MAP_X1 - MAP_X0) / (n - 1) : 0);
};
const laneY = (li: number): number => MAP_Y0 + li * MAP_LH;
/** 规格 `rgba(226,235,245,0.04)` = `--line`(α.08) 的一半。 */
const GRID = "color-mix(in srgb, var(--line) 50%, transparent)";
/** 规格 `rgba(226,235,245,0.12)` —— 比 `--line`(α.08) 重、比 `--line2`(α.14) 轻，故从 `--line2` 反解。 */
const CONNECT = "color-mix(in srgb, var(--line2) 85.714%, transparent)";

/** 地铁图片段（规格 `#m2`）。被 `.mapbox` 的 470×648 框以 `slice` 裁切 —— 这是效果不是缺陷。 */
function ChainMapFragment({ callout }: { callout: readonly string[] }) {
  const selX = laneX(2, 5);
  const selY = laneY(2);
  return (
    <svg viewBox="0 0 470 470" preserveAspectRatio="xMidYMid slice" data-testid="sandbox-detail-map">
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`h${i}`} x1={0} y1={i * 47} x2={470} y2={i * 47} style={{ stroke: GRID }} />
      ))}
      {Array.from({ length: 11 }, (_, j) => (
        <line key={`v${j}`} x1={j * 47} y1={0} x2={j * 47} y2={470} style={{ stroke: GRID }} />
      ))}
      <ellipse
        cx={laneX(3, 4)}
        cy={laneY(3)}
        rx={56}
        ry={20}
        strokeWidth={1.1}
        style={{ fill: "color-mix(in srgb, var(--ok) 15%, transparent)", stroke: "var(--ok)" }}
      />
      {CHAIN_MAP_LANES.map((L, li) => {
        const y = laneY(li);
        return (
          <g key={L.key}>
            <text
              x={MAP_X0 - 14}
              y={y + 4}
              textAnchor="end"
              fontSize={10.5}
              fontWeight={700}
              style={{ fill: L.color }}
            >
              {L.key}
            </text>
            <line
              x1={MAP_X0}
              y1={y}
              x2={MAP_X1}
              y2={y}
              strokeWidth={3}
              strokeLinecap="round"
              opacity={0.62}
              style={{ stroke: L.color }}
            />
            {li < CHAIN_MAP_LANES.length - 1 ? (
              <path
                d={`M${MAP_X1} ${y} L${MAP_X1 + 16} ${y} L${MAP_X1 + 16} ${y + MAP_LH / 2} L${MAP_X0 - 16} ${
                  y + MAP_LH / 2
                } L${MAP_X0 - 16} ${y + MAP_LH} L${MAP_X0} ${y + MAP_LH}`}
                strokeWidth={1.2}
                strokeDasharray="4 4"
                style={{ fill: "none", stroke: CONNECT }}
              />
            ) : null}
          </g>
        );
      })}
      {([
        [2, 3, 5],
        [3, 4, 5],
      ] as const).map((g) => (
        <line
          key={`blk${g[0]}`}
          x1={laneX(g[0], g[1])}
          y1={laneY(g[0])}
          x2={laneX(g[0], g[2])}
          y2={laneY(g[0])}
          strokeWidth={4.4}
          strokeLinecap="round"
          opacity={0.95}
          style={{ stroke: "var(--danger)" }}
        />
      ))}
      {CHAIN_MAP_LANES.map((L, li) => {
        const y = laneY(li);
        return L.nodes.map((nd, i) => {
          const x = laneX(li, i);
          const r = 3.8 + Math.sqrt(nd.loss) * 1.9;
          const label = laneNodeLabel(nd);
          const parts = label.length > 5 ? [label.slice(0, 5), label.slice(5)] : [label];
          return (
            <g key={nd.nodeId} data-node-id={nd.nodeId}>
              {nd.hit === true ? (
                <circle
                  cx={x}
                  cy={y}
                  r={r + 5}
                  strokeWidth={1}
                  opacity={0.5}
                  style={{ fill: "none", stroke: "var(--danger)" }}
                />
              ) : null}
              <circle
                cx={x}
                cy={y}
                r={r}
                strokeWidth={2}
                style={{ fill: nd.hit === true ? "var(--danger)" : L.color, stroke: "var(--panel)" }}
              />
              {nd.loss >= 13 ? (
                <text
                  x={x}
                  y={y - r - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily="var(--font-mono)"
                  style={{ fill: "var(--warn-txt)" }}
                >
                  {nd.loss}%
                </text>
              ) : null}
              {parts.map((t, pi) => (
                <text
                  key={pi}
                  x={x}
                  y={y + r + 11 + pi * 10}
                  textAnchor="middle"
                  fontSize={8.5}
                  fontWeight={nd.hit === true ? 600 : 400}
                  style={{
                    fill:
                      nd.hit === true ? "var(--danger-txt)" : "color-mix(in srgb, var(--txt) 70%, transparent)",
                  }}
                >
                  {t}
                </text>
              ))}
            </g>
          );
        });
      })}
      <circle
        cx={selX}
        cy={selY}
        r={20}
        strokeWidth={1.2}
        opacity={0.85}
        style={{ fill: "none", stroke: "var(--warn)" }}
      />
      {callout.map((l, k) => (
        <text
          key={l}
          x={selX - 108}
          y={selY - 40 + k * 11}
          fontSize={8.5}
          style={{ fill: "color-mix(in srgb, var(--txt) 88%, transparent)" }}
        >
          {l}
        </text>
      ))}
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// § 3 · `useNodeDetail()` —— 节点详情端点的唯一入口
// ══════════════════════════════════════════════════════════════════════════

/** 端点路径模板（`WO-SIM-BE-DRILL` 在做）。写成常量是为了让"还没接通"这件事可被 grep 到。 */
export const NODE_DETAIL_ENDPOINT = "/a/v1/sim/sessions/:sessionId/node-detail" as const;

export const nodeDetailPath = (sessionId: string, nodeId?: string): string =>
  `/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/node-detail${
    nodeId === undefined ? "" : `?nodeId=${encodeURIComponent(nodeId)}`
  }`;

export interface UseNodeDetailResult {
  data: NodeDetailPayload;
  /** `"endpoint"` = 真数据；`"placeholder"` = 规格占位（端点还没做完 / 没给会话 id / 请求失败）。 */
  source: "endpoint" | "placeholder";
  endpoint: typeof NODE_DETAIL_ENDPOINT;
  isLoading: boolean;
}

/**
 * 传导识别表 + 节点详情 + 流转明细的**唯一**取数口。
 *
 * `sessionId` 缺省 ⇒ 不发请求（端点还在做，发了只会 404），直接给规格占位。
 * 给了 ⇒ 真发；失败也**不**把屏渲染成空，落回占位并把 `source` 报成 `"placeholder"` ——
 * 「请求失败」与「没有数据」是两件事，调用方/测试读得出区别。
 */
export function useNodeDetail(sessionId?: string, nodeId?: string): UseNodeDetailResult {
  const sid = sessionId ?? "";
  const enabled = sid !== "";
  const q = useQuery({
    queryKey: ["a", "sim-node-detail", sid, nodeId ?? ""],
    enabled,
    retry: false,
    queryFn: () => api.a<NodeDetailPayload>(nodeDetailPath(sid, nodeId)),
  });
  const live = enabled ? q.data : undefined;
  return {
    data: live ?? PLACEHOLDER_NODE_DETAIL,
    source: live === undefined ? "placeholder" : "endpoint",
    endpoint: NODE_DETAIL_ENDPOINT,
    isLoading: enabled && q.isLoading,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 页面
// ══════════════════════════════════════════════════════════════════════════

export interface SandboxDetailProps {
  /** 推演会话（栈 A 的世界）。给了才发节点详情 / 影响传播两个请求。 */
  sessionId?: string;
  /** 被选中的链路节点。 */
  nodeId?: string;
  /** 影响传播的变更（世界 + 变更缺一不发）。 */
  impactChange?: ImpactChange;
  /** 应对策略求解器的实参（基地 + 风险因素）。 */
  mitigation?: MitigationArgs;
}

export function SandboxDetail({ sessionId, nodeId, impactChange, mitigation }: SandboxDetailProps) {
  const detail = useNodeDetail(sessionId, nodeId);
  const d = detail.data;
  const cone = useImpactCone(
    sessionId !== undefined && sessionId !== "" && impactChange !== undefined
      ? { worldId: sessionId, change: impactChange }
      : undefined,
  );
  const strategies = useMitigationCards(mitigation);

  return (
    <div className={styles.app} data-testid="sandbox-detail" data-source={detail.source}>
      {/* ── 系统条 ── */}
      <div className={styles.sysbar}>
        <span className={styles.hole} />
        <span className={styles.sp} />
        <time>{d.clock}</time>
        <u>─</u>
        <u>□</u>
        <u>✕</u>
      </div>

      <div className={styles.body}>
        {/* ══ 左：地图与甘特延续 ══ */}
        <div className={styles.lcol}>
          <div className={styles.mapbox} data-testid="sandbox-detail-mapbox">
            <ChainMapFragment callout={d.callout} />
            <div className={styles.rul}>
              {RULER.map((v) => (
                <u key={v}>{v}</u>
              ))}
            </div>
            <div className={styles.lgd}>
              {LEGEND.map((l) => (
                <div key={l.label} style={l.color === undefined ? undefined : { color: l.color }}>
                  <span>{l.label}</span>
                  {l.kind === "ellipse" ? <span className={styles.el} /> : null}
                  {l.kind === "num" ? <span className={styles.num}>00:00</span> : null}
                  {l.kind === "line" ? <s /> : null}
                  {l.kind === "dash" ? <s style={{ borderTopStyle: "dashed" }} /> : null}
                  {l.kind === "dot" ? <s style={{ borderTopStyle: "dotted" }} /> : null}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.gminis} data-testid="sandbox-detail-gminis">
            <div className={styles.gmhead}>
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} style={{ left: `${(i / 8) * 100}%` }}>
                  {`${String(i * 3).padStart(2, "0")}:00`}
                </span>
              ))}
            </div>
            {GANTT_ROWS.map((row, ri) => (
              <div key={ri} className={styles.gm}>
                {row.map(([left, width, kind, label]) => (
                  <div
                    key={label}
                    className={`${styles.sg} ${styles[kind]}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    ▤ {label}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ══ 右 ══ */}
        <div className={styles.rcol}>
          {/* ── 传导识别 ── */}
          <section className={`${styles.pan} ${styles.top}`}>
            <div className={styles.ph}>
              <i>▤</i>
              <b>传导识别</b>
              <span className={styles.rt}>▤ ⤢</span>
            </div>
            <div className={styles.tb2}>
              <div className={styles.lft}>
                <div className={styles.sel}>
                  <select defaultValue={d.directions[0]}>
                    {d.directions.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.cks}>
                  {d.filters.map((f) => (
                    <label key={f.label}>
                      <i className={f.on ? styles.on : undefined} />
                      {f.label}
                    </label>
                  ))}
                </div>
                <div className={styles.tbl} data-testid="sandbox-detail-conduction">
                  <div className={`${styles.tr} ${styles.hd}`}>
                    <span />
                    <span>批号</span>
                    <span>环节</span>
                    <span>型号</span>
                    <span>在制</span>
                    <span>影响</span>
                    <span>耗时</span>
                  </div>
                  {d.conduction.map((row, i) => (
                    <div key={i} className={row.selected === true ? `${styles.tr} ${styles.on}` : styles.tr}>
                      <s style={{ background: LEVEL_TOKEN[row.level - 1] }} />
                      <span>{row.batch}</span>
                      <span>{row.node}</span>
                      <span>{row.model}</span>
                      <span>{row.wip}</span>
                      <span className={styles.bd} style={{ color: LEVEL_TOKEN[row.level - 1] }}>
                        {row.level}级
                      </span>
                      <span>{row.elapsed}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.rgt}>
                <div className={styles.strip} data-testid="sandbox-detail-strip">
                  {d.strip.kms.map((k) => (
                    <span key={k.label} className={styles.km} style={{ left: k.left }}>
                      {k.label}
                    </span>
                  ))}
                  <span className={styles.self}>{d.strip.self}</span>
                  <div className={styles.ax} />
                  {d.strip.ticks.map((t) => (
                    <span key={t.label} className={styles.tk} style={{ left: t.left }}>
                      {t.label}
                    </span>
                  ))}
                  {d.strip.events.map((e) => (
                    <span key={e.left} className={styles.ev} style={{ left: e.left }}>
                      {e.label}
                    </span>
                  ))}
                  {d.strip.chips.map((c) => (
                    <span key={c.label} className={styles.chip} style={{ left: c.left }}>
                      {c.label}
                    </span>
                  ))}
                </div>
                <div className={styles.dt}>
                  <div className={styles.dl}>
                    <div className={styles.dcard}>
                      <div className={styles.glyph}>
                        <svg viewBox="0 0 40 30" width="52" height="38">
                          <path
                            d="M20 3 L23 12 L37 15 L23 18 L20 27 L17 18 L3 15 L17 12 Z"
                            style={{ fill: "var(--accent-txt)" }}
                          />
                        </svg>
                        <b>{d.card.title}</b>
                        <u>{d.card.sub}</u>
                      </div>
                      <div className={styles.kv}>
                        {/* `.kv` 是 4 列 grid，`<em>/<b>` 必须是它的**直接**子元素 ⇒ 用 Fragment（不产生 DOM 节点）。 */}
                        {d.card.kv.map(([k, v, hot]) => (
                          <Fragment key={k}>
                            <em>{k}</em>
                            <b className={hot === true ? styles.hot : undefined}>{v}</b>
                          </Fragment>
                        ))}
                      </div>
                      <div className={styles.mini}>
                        <svg viewBox="0 0 60 16" width="60" height="16">
                          <line x1="4" y1="8" x2="56" y2="8" strokeWidth="2" style={{ stroke: "var(--accent-txt)" }} />
                          <circle cx="12" cy="8" r="3" style={{ fill: "var(--accent-txt)" }} />
                        </svg>
                        <u>{d.card.miniLabel}</u>
                        <svg viewBox="0 0 60 16" width="60" height="16">
                          <path
                            d="M4 8 H40 L52 4 V12 L40 8"
                            strokeWidth="1.4"
                            style={{ fill: "none", stroke: "var(--accent-txt)" }}
                          />
                        </svg>
                      </div>
                    </div>
                    <div className={styles.route}>
                      <span>
                        ⇲ 起始工位 <b>{d.card.route.from}</b>
                      </span>
                      <span className={styles.ar}>➜</span>
                      <span>
                        ⇱ 终止库位 <b>{d.card.route.to}</b>
                      </span>
                      <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", color: "var(--muted2)" }}>
                        {d.card.route.tag}
                      </span>
                    </div>
                    <div className={styles.rt2} data-testid="sandbox-detail-flow">
                      <div className={`${styles.r} ${styles.hd}`}>
                        <span>时间</span>
                        <span>工位</span>
                        <span>批次</span>
                        <span>在制</span>
                        <span>节拍</span>
                        <span>良率</span>
                      </div>
                      {d.flow.map((f, i) => (
                        <div key={i} className={f.selected === true ? `${styles.r} ${styles.on}` : styles.r}>
                          <span>{f.time}</span>
                          <span>{f.station}</span>
                          <span>{f.batch}</span>
                          <span>{f.wip}</span>
                          <span>{f.takt}</span>
                          <span>{f.yieldRate}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <ImpactCone model={cone.model} source={cone.source} />
                </div>
              </div>
            </div>
          </section>

          {/* ── 应对策略 ── */}
          <section className={`${styles.pan} ${styles.bot}`}>
            <div className={styles.ph}>
              <i>▤</i>
              <b>应对策略</b>
              <span className={styles.rt}>▤ ⤢</span>
            </div>
            <div className={styles.bb}>
              <StrategyCards cards={strategies.cards} source={strategies.source} />

              <div className={styles.form}>
                <div className={styles.fl}>方案设置</div>
                <div className={styles.fi}>
                  <span>方案名称</span>
                  <input defaultValue={FORM_PLACEHOLDER.planName} />
                </div>
                <div className={styles.fi}>
                  <span>承接基地</span>
                  <select defaultValue={FORM_PLACEHOLDER.bases[0]}>
                    {FORM_PLACEHOLDER.bases.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </div>
                {FORM_PLACEHOLDER.materials.map((m, i) => (
                  <div key={m.options[0]} className={styles.fi}>
                    <span>{i === 0 ? "调拨物料" : ""}</span>
                    <div className={styles.duo}>
                      <select defaultValue={m.options[0]}>
                        {m.options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                      <span className={styles.stp}>
                        <b>{m.qty}</b>
                        <u>
                          <span>▲</span>
                          <span>▼</span>
                        </u>
                      </span>
                    </div>
                  </div>
                ))}
                <div className={styles.fl} style={{ marginTop: 2 }}>
                  可用产线
                </div>
                {FORM_PLACEHOLDER.lines.map((l) => (
                  <div key={l.cap} className={styles.plat}>
                    <i>▤</i>
                    <span className={styles.tr2}>
                      <i style={{ left: l.at }} />
                    </span>
                    <span>{l.cap}</span>
                  </div>
                ))}
              </div>

              <div className={styles.rr}>
                <div className={styles.sub}>补货路径</div>
                <div className={styles.supp} data-testid="sandbox-detail-replenish">
                  {["01:20", "01:30", "01:40", "01:50", "02:00", "02:10", "02:20", "02:30"].map((t, i) => (
                    <span key={t} className={styles.tk} style={{ left: `${i * 12.4}%` }}>
                      {t}
                    </span>
                  ))}
                  {REPLENISH_SEGS.map(([left, width, kind, label]) => (
                    <div
                      key={label}
                      className={`${styles.sg} ${styles[kind]}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      ▤ {label}
                    </div>
                  ))}
                </div>
                <div className={styles.sub}>原计划处置</div>
                <div className={styles.ot} data-testid="sandbox-detail-plans">
                  <div className={`${styles.r} ${styles.hd}`}>
                    <span>计划名称</span>
                    <span>线别</span>
                    <span>物料</span>
                    <span>班组</span>
                    <span>计划目标</span>
                    <span>剩余缺口</span>
                    <span>操作</span>
                  </div>
                  {PLAN_ROWS.map((p) => (
                    <div key={p.name} className={styles.r}>
                      <span>{p.name}</span>
                      <span>{p.line}</span>
                      <span>{p.material}</span>
                      <span>{p.team}</span>
                      <span>{p.target}</span>
                      <span className={styles.bd} style={{ color: LEVEL_TOKEN[p.level - 1] }}>
                        {p.level}级
                      </span>
                      <span className={p.danger === true ? `${styles.act} ${styles.x}` : styles.act}>
                        {p.action} ⌄
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default SandboxDetail;
