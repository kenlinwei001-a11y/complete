import { useQuery } from "@tanstack/react-query";
import type { ImpactAnalysisResponse, ImpactChange } from "@platform/contracts";
import { runImpactAnalysis } from "@/api/endpoints";
import styles from "./SandboxDetail.module.css";

/**
 * WO-SIM-FE-DETAIL · 「影响半径」扇区图（规格 `docs/ux-spec/sandbox/sandbox-detail.html` 的 `#cone` 段）。
 *
 * ── 版面 ────────────────────────────────────────────────────────────────────
 * viewBox `0 0 236 240`，逐个图元的坐标、半径、字号全部照抄规格里的那段 `E(...)` 调用，
 * 一个数都没重算。容器 `.dr` 的 `1fr 236px` 网格列宽同样来自规格（见 `.dt`）。
 *
 * ── 数据 ────────────────────────────────────────────────────────────────────
 * 真出处 = `POST /a/v1/simulation/impact-analysis`（**今天就有**：`apps/datacore/src/sim/impact-analysis.ts`，
 * 前端薄封装 `runImpactAnalysis`）。它按四维返回，每维是 `available` 上的判别联合。
 *
 * **逐格照实说接了多少**：
 *   · **三条冲击条目（`齐套冲击 P2` 这一列）** ← `affectedProcesses.items[].name`，真数据；
 *     该维 `available:false` ⇒ **不渲染成 0 条**，落回占位并标 `provenance="placeholder"`
 *     （契约注释原话：`available:false` 与 `count:0` 是两件不同的事）。
 *   · **半径读数 `18:12` / 张角 `39°` / 四个 `P421x` 标记** ← 端点**没有**这些量。
 *     不编：保留规格占位并标记，等 `WO-SIM-BE-DRILL` 的节点详情端点带出真口径再整套换。
 *
 * provenance 一律走 `data-*` 属性，不进屏上文字 —— 本页验收线是像素级 1:1。
 */

export interface ConeImpact {
  label: string;
  /** 规格里三条冲击的 y（84 / 100 / 116）。 */
  y: number;
}

export interface ImpactConeModel {
  /** `.rd` 半径读数。 */
  radiusLabel: string;
  /** 扇区张角读数（SVG 内 `39°`）。 */
  angleLabel: string;
  /** 纵轴刻度（左右各一列）。 */
  ticks: readonly string[];
  /** 传导链上的节点标记（第 2 个为热点）。 */
  markers: readonly { label: string; x: number; y: number }[];
  hotMarkerIndex: number;
  impacts: readonly ConeImpact[];
  provenance: { impacts: "impact-analysis" | "placeholder"; radius: "placeholder"; angle: "placeholder" };
}

/** 规格里的那一套（占位数集中在这一处，不散进 JSX）。 */
export const PLACEHOLDER_CONE: ImpactConeModel = {
  radiusLabel: "18:12",
  angleLabel: "39°",
  ticks: ["400", "300", "200", "100"],
  markers: [
    { label: "P4211", x: 38, y: 66 },
    { label: "P4212", x: 92, y: 58 },
    { label: "P4213", x: 150, y: 60 },
    { label: "P4214", x: 204, y: 72 },
  ],
  hotMarkerIndex: 1,
  impacts: [
    { label: "齐套冲击 P2", y: 84 },
    { label: "排产冲击 P1", y: 100 },
    { label: "老化冲击 Y1", y: 116 },
  ],
  provenance: { impacts: "placeholder", radius: "placeholder", angle: "placeholder" },
};

/** 响应 → 扇区图模型。只换端点真的答得出的那一格（三条冲击），其余保持占位并标记。 */
export function projectImpactCone(res: ImpactAnalysisResponse | undefined): ImpactConeModel {
  const dim = res?.affectedProcesses;
  if (dim === undefined || dim.available !== true) return PLACEHOLDER_CONE;
  const items = dim.items;
  if (items.length === 0) return PLACEHOLDER_CONE;
  // 槽位（三条冲击的 y）来自规格，条目文案来自端点：**位置照抄、内容换真**。
  return {
    ...PLACEHOLDER_CONE,
    impacts: PLACEHOLDER_CONE.impacts
      .slice(0, items.length)
      .map((slot, i) => ({ label: items[i]?.name ?? slot.label, y: slot.y })),
    provenance: { ...PLACEHOLDER_CONE.provenance, impacts: "impact-analysis" },
  };
}

/** 接 `impact-analysis`。世界或变更缺一 ⇒ 不发请求（发了也只会 400/404），用规格占位。 */
export function useImpactCone(input?: { worldId: string; change: ImpactChange }): {
  model: ImpactConeModel;
  source: "impact-analysis" | "placeholder";
} {
  const worldId = input?.worldId ?? "";
  const change = input?.change;
  const enabled = worldId !== "" && change !== undefined;
  const key = change === undefined ? "" : `${change.objectType}|${change.objectId}|${change.prop}`;
  const q = useQuery({
    queryKey: ["a", "sim-impact-cone", worldId, key],
    enabled,
    retry: false,
    queryFn: () =>
      change === undefined
        ? Promise.reject(new Error("no change"))
        : runImpactAnalysis({ worldId, change, limit: 200 }),
  });
  const model = projectImpactCone(enabled ? q.data : undefined);
  return { model, source: model.provenance.impacts === "impact-analysis" ? "impact-analysis" : "placeholder" };
}

const HAIR = "color-mix(in srgb, var(--line) 62.5%, transparent)";
const HAIR2 = "var(--line2)";
const STAR = "M0 -6 L2 -1 L8 0 L2 1 L0 6 L-2 1 L-8 0 L-2 -1 Z";

/**
 * 扇区图本体。SVG 的着色一律走 `style`（而非 `fill=` 属性）——
 * 两者在 Chromium 里都吃 `var()`，但 `style` 是**所有**浏览器都保证支持的那一条，
 * 而本页的色值必须跟着主题令牌走，赌浏览器差异不值当。
 */
export function ImpactCone({ model, source }: { model: ImpactConeModel; source: "impact-analysis" | "placeholder" }) {
  return (
    <div className={styles.dr} data-testid="sandbox-detail-cone" data-source={source}>
      <svg viewBox="0 0 236 240" data-testid="sandbox-detail-cone-svg">
        {[1, 2, 3, 4].map((i) => (
          <line key={`g${i}`} x1={14} y1={i * 48} x2={222} y2={i * 48} style={{ stroke: HAIR }} />
        ))}
        {model.ticks.map((v, i) => (
          <g key={`t${i}`}>
            <text x={4} y={i * 48 + 52} fontSize={7} fontFamily="var(--font-mono)" style={{ fill: "var(--muted2)" }}>
              {v}
            </text>
            <text x={212} y={i * 48 + 52} fontSize={7} fontFamily="var(--font-mono)" style={{ fill: "var(--muted2)" }}>
              {v}
            </text>
          </g>
        ))}
        <path d="M118 208 L64 96 A 60 60 0 0 1 172 96 Z" style={{ fill: HAIR, stroke: HAIR2 }} />
        <ellipse cx={118} cy={196} rx={44} ry={16} style={{ fill: "none", stroke: HAIR2 }} />
        <path
          d="M40 108 C 90 66, 150 62, 208 92"
          strokeWidth={1.5}
          style={{ fill: "none", stroke: "var(--c-capacity)" }}
        />
        <path
          d="M44 128 C 96 92, 152 88, 206 112"
          strokeDasharray="5 4"
          style={{ fill: "none", stroke: "color-mix(in srgb, var(--accent) 60%, transparent)" }}
        />
        {model.markers.map((m, i) => {
          const hot = i === model.hotMarkerIndex;
          return (
            <g key={m.label} transform={`translate(${m.x},${m.y})`}>
              <path d={STAR} style={{ fill: hot ? "var(--warn-txt)" : "var(--accent-txt)" }} />
              <text
                x={-14}
                y={-9}
                fontSize={7}
                fontFamily="var(--font-mono)"
                style={{ fill: hot ? "var(--warn-txt)" : "var(--muted)" }}
              >
                {m.label}
              </text>
            </g>
          );
        })}
        <rect x={78} y={44} width={56} height={14} style={{ fill: "none", stroke: "var(--warn)" }} />
        {model.impacts.map((c) => (
          <g key={c.label}>
            <rect x={112} y={c.y - 8} width={7} height={7} style={{ fill: "var(--danger)" }} />
            <text x={123} y={c.y} fontSize={7} style={{ fill: "var(--danger-txt)" }}>
              {c.label}
            </text>
          </g>
        ))}
        <path d="M118 208 L104 186 L132 186 Z" style={{ fill: "var(--danger)" }} />
        <text x={150} y={200} fontSize={7} fontFamily="var(--font-mono)" style={{ fill: "var(--muted2)" }}>
          {model.angleLabel}
        </text>
      </svg>
      <span className={styles.rd} data-prov={model.provenance.radius}>
        {model.radiusLabel}
      </span>
      <span className={styles.cp}>
        <b>↑</b>下游
      </span>
    </div>
  );
}
