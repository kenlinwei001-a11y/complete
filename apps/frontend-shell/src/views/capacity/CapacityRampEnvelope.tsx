import { useLiveSolver } from "../sim/useLiveSolver";
import styles from "../RiskBoardView.module.css";
import { Provenance } from "@/components/Provenance";
import { RAMP_SUBCURVES, tightnessToCeiling, rampShape, factorByMark, layerOf } from "./factorOntology";

/**
 * WO-CAPACITY-DEEPEN-ADDITIVE 块B · 产能爬坡 min 包络（插在 ③BaseOutlookPanel 之内/后）。
 *
 * 6 条子爬坡取 min 的实际爬坡曲线（投产⑳/良率⑨/OEE③④/熟练⑰/换型⑤/物料齐套⑬）——一眼看出"爬坡被哪条拖住"。
 * 数据源：base_capacity_outlook（available/crossDay·锚定窗口与越线）+ bottleneck_matrix（各因素张力→子曲线天花板·R14 来自数据）；
 * 爬坡形状来自 factorOntology.RAMP_PROFILE（配置单源·非伪造）。crossDay 竖线复用现有阈值口径（var(--danger)）。
 * 纯增量·只用现有 CSS 变量·禁新色值。R6 确定性（纯函数·无 Date.now/随机）。
 */

interface Horizon { horizon: number; available: number; crossDay: number | null }
interface Outlook { baseName: string; horizons: Horizon[] }
interface BnRow { base: string; tightness: Record<string, number>; primary: string }
interface Bn { rows: BnRow[] }

const N = 30; // 采样点
const W = 320, HGT = 96, PAD = 4;

export function CapacityRampEnvelope({ baseId }: { baseId: string }) {
  const outlook = useLiveSolver<Outlook>("base_capacity_outlook", { baseId, horizon: 90 }, (r) => r as Outlook);
  const bn = useLiveSolver<Bn>("bottleneck_matrix", { baseIds: [baseId] }, (r) => r as Bn);
  const hz = outlook.data?.horizons?.[0];
  const bnRow = bn.data?.rows?.find((r) => r.base === baseId) ?? bn.data?.rows?.[0];

  if (!hz || !bnRow) {
    return (
      <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`cap-ramp-${baseId}`}>
        <div className={styles.rkDetH}><b>📉 产能爬坡 min 包络（6 条子爬坡）</b></div>
        <div className="empty-state" data-testid="cap-ramp-loading" style={{ fontSize: 12 }}>
          {outlook.error || bn.error ? "爬坡求解器不可用（诚实空·未伪造）" : "爬坡序列加载中…"}
        </div>
      </div>
    );
  }

  const H = hz.horizon || 90;
  // 每条子曲线：天花板取自真数据（bottleneck_matrix 张力）或配置（投产爬坡=RAMP_PROFILE 满产 1）。
  const curves = RAMP_SUBCURVES.map((s) => {
    const f = factorByMark(s.mark);
    const color = f ? layerOf(f.layer).colorVar : "var(--muted)";
    const tight = s.bnFactor != null ? bnRow.tightness[s.bnFactor] ?? null : null;
    const ceiling = s.bnFactor == null ? 1 : tightnessToCeiling(tight ?? 0);
    return { ...s, color, tight, ceiling };
  });
  // 被谁拖住 = 天花板最低的子曲线（min 包络的绑定因素）。
  const binding = curves.reduce((a, b) => (b.ceiling < a.ceiling ? b : a), curves[0]!);

  const xAt = (i: number) => PAD + (i / (N - 1)) * (W - 2 * PAD);
  const yAt = (frac: number) => HGT - PAD - Math.max(0, Math.min(1, frac)) * (HGT - 2 * PAD);
  const pathOf = (fn: (i: number) => number): string =>
    Array.from({ length: N }, (_, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(fn(i)).toFixed(1)}`).join(" ");
  const sub = (ceiling: number) => (i: number) => ceiling * rampShape(i / (N - 1));
  const envelope = (i: number) => Math.min(...curves.map((c) => c.ceiling * rampShape(i / (N - 1))));
  const crossX = hz.crossDay != null ? xAt(Math.max(0, Math.min(N - 1, (hz.crossDay / Math.max(1, H)) * (N - 1)))) : null;

  return (
    <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`cap-ramp-${baseId}`}>
      <div className={styles.rkDetH}>
        <b>📉 产能爬坡 min 包络（6 条子爬坡）</b>
        <span>{outlook.data?.baseName ?? baseId} · 窗口 {H} 天 · 实际爬坡 = 6 条子爬坡取 min · 被拖住 = 最低天花板那条</span>
      </div>
      <svg viewBox={`0 0 ${W} ${HGT}`} width="100%" style={{ display: "block" }} data-testid="cap-ramp-chart" role="img" aria-label="产能爬坡 min 包络">
        <rect x={0} y={0} width={W} height={HGT} fill="var(--panel2)" rx={4} />
        {/* 6 条子爬坡（各因素层色·细线）。 */}
        {curves.map((c) => (
          <path key={c.mark} data-testid={`cap-ramp-curve-${c.mark}`} d={pathOf(sub(c.ceiling))}
            fill="none" stroke={c.color} strokeWidth={1} opacity={c.mark === binding.mark ? 0.9 : 0.4} />
        ))}
        {/* min 包络（实际爬坡·加粗 --c-capacity）。 */}
        <path data-testid="cap-ramp-envelope" d={pathOf(envelope)} fill="none" stroke="var(--c-capacity)" strokeWidth={2.4} />
        {/* crossDay 竖线（复用现有阈值口径·var(--danger)）。 */}
        {crossX != null && (
          <line data-testid="cap-ramp-crossday" x1={crossX} y1={PAD} x2={crossX} y2={HGT - PAD} stroke="var(--danger)" strokeWidth={1} strokeDasharray="3 2" />
        )}
      </svg>
      {/* 图例 + 绑定因素。 */}
      <div data-testid="cap-ramp-legend" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, fontSize: 12 }}>
        {curves.map((c) => (
          <span key={c.mark} data-testid={`cap-ramp-leg-${c.mark}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, color: c.mark === binding.mark ? "var(--danger-txt)" : "var(--muted)" }}>
            <i style={{ width: 10, height: 2, background: c.color, display: "inline-block" }} aria-hidden />
            {c.mark} {c.name}
            {c.tight != null ? (
              <>
                （张力{" "}
                <Provenance
                  testId={`cap-ramp-tight-${c.mark}`}
                  src="bottleneck_matrix 求解器"
                  formula={`子曲线天花板 = tightnessToCeiling(张力)；张力溯 bottleneck_matrix.${c.bnFactor}`}
                  inputs={[`${c.bnFactor} 张力波动 = ${Math.round(c.tight)}`]}
                  note={`天花板 ${Math.round(c.ceiling * 100)}%（张力越高天花板越低·拖住爬坡）`}
                >
                  {Math.round(c.tight)}
                </Provenance>
                ）
              </>
            ) : "（配置爬坡）"}
          </span>
        ))}
      </div>
      <div data-testid="cap-ramp-binding" style={{ fontSize: 12, color: "var(--danger-txt)", marginTop: 6 }}>
        ⛔ 爬坡被 <b>{binding.mark} {binding.name}</b> 拖住（天花板最低{binding.tight != null ? ` · 溯 bottleneck_matrix.${binding.bnFactor}=${Math.round(binding.tight)}` : ""}）
      </div>
      <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.5, marginTop: 6 }}>
        {/* 出处（工程师层，不上屏）：形状取自 RAMP_PROFILE 配置；min 包络 = 实际爬坡（R6 确定性·非写死）。 */}
        子曲线的天花板取自真实数据（各瓶颈因素的张力·R14），爬坡的快慢形状取自本基地的爬坡配置；
        下包络线 = 实际能爬到的产能（取各条子曲线里最低的那条，同输入必得同结果，不是写死的曲线）。跨日竖线沿用现有阈值口径。
      </div>
    </div>
  );
}
