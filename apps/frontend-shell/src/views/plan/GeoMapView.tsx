import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { searchObjects } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import type { ViewRendererProps } from "../registry";
import outline from "@/assets/china-outline.json";
import zh from "@/locales/zh";
import simStyles from "../sim/SimViews.module.css";
import styles from "./PlanViews.module.css";

/** 定位 → 颜色（图例固定：动力蓝 / 储能绿 / 混合黄，§7.17） */
export const POSITION_COLORS: Record<string, string> = {
  动力: "#5E8FE8",
  储能: "#36BFA5",
  混合: "#E8B54A",
};

/** 国内基地经纬度兜底（静态资产）。R14：优先取 Base.props.lon/lat（按租户对象库下发）；
 *  此表仅当对象缺坐标时兜底。debattery-allow：地名→坐标纯地理映射，非业务逻辑常数。 */
const BASE_COORDS: Record<string, [number, number]> = {
  常州: [119.95, 31.78], // debattery-allow
  厦门: [118.10, 24.46], // debattery-allow
  成都: [104.07, 30.67], // debattery-allow
  眉山: [103.83, 30.05], // debattery-allow
  武汉: [114.30, 30.59], // debattery-allow
  江门: [113.08, 22.58], // debattery-allow
  合肥: [117.28, 31.86], // debattery-allow
  信阳: [114.09, 32.13], // debattery-allow
  枣庄: [117.32, 34.81], // debattery-allow
  邯郸: [114.49, 36.61], // debattery-allow
  自贡: [104.78, 29.34], // debattery-allow
  金华: [119.65, 29.08], // debattery-allow
  扬州: [119.42, 32.40], // debattery-allow
};

/** 利用率色档（阈值可由 ViewConfig.layout.utilThresholds 配置；去电池锁死 8a / R14） */
export function utilColor(u: number, thresholds: number[] = [92, 85, 78]): string {
  const [hi, mid, lo] = thresholds;
  return u >= (hi ?? 92) ? "#DD7E9E" : u >= (mid ?? 85) ? "#DD9551" : u >= (lo ?? 78) ? "#D2B04C" : "#62BE77";
}

const VIEW_W = 920;
const VIEW_H = 700;
/** 等距圆柱投影（lon 73–135.5 / lat 17.5–54.5 → viewBox） */
function project(lon: number, lat: number): { x: number; y: number } {
  const x = ((lon - 72) / (136 - 72)) * VIEW_W;
  const y = ((55 - lat) / (55 - 17)) * VIEW_H;
  return { x, y };
}

interface BaseProps {
  id: string;
  name: string;
  util: number;
  bottleneck: string;
  gwh: number;
  position: string;
  lines: number;
  prodYear: number;
  mainProduct: string;
  lon?: number;
  lat?: number;
}

/** 去电池锁死（R14）：坐标优先取自 Base 对象属性（按租户/连接器数据）；BASE_COORDS 仅作旧数据兜底。 */
function coordOf(b: BaseProps): [number, number] | undefined {
  if (Number.isFinite(b.lon) && Number.isFinite(b.lat)) return [b.lon!, b.lat!];
  return BASE_COORDS[b.name];
}

/** 地理视图（renderer=geo-map，§7.17）：打包中国轮廓 + 基地气泡 + 侧滑档案卡 */
export default function GeoMapView({ view }: ViewRendererProps) {
  // 去电池锁死 8a（R14）：利用率色档阈值由 ViewConfig.layout.utilThresholds 声明（后端 VIEW_DEFS 已下发）
  const utilThresholds = (view.layout?.utilThresholds as number[] | undefined) ?? [92, 85, 78];
  // R14：基地定位→配色映射（图例分类标签）由 ViewConfig.layout.positionColors 声明，POSITION_COLORS 仅兜底。
  const positionColors = (view.layout?.positionColors as Record<string, string> | undefined) ?? POSITION_COLORS;
  const { data, isLoading } = useQuery({
    queryKey: ["a", "objects", { type: "Base", view: "geo-map" }],
    queryFn: () => searchObjects("Base", ""),
  });
  const [selected, setSelected] = useState<BaseProps | null>(null);
  const navigate = useNavigate();

  const bases = useMemo(
    () =>
      (data?.items ?? []).map((o) => ({
        id: o.id,
        name: String(o.props.name ?? ""),
        util: Number(o.props.util ?? 0),
        bottleneck: String(o.props.bottleneck ?? "—"),
        gwh: Number(o.props.gwh ?? 0),
        position: String(o.props.position ?? "混合"),
        lines: Number(o.props.lines ?? 0),
        prodYear: Number(o.props.prodYear ?? 0),
        mainProduct: String(o.props.mainProduct ?? "—"),
        lon: o.props.lon != null ? Number(o.props.lon) : undefined,
        lat: o.props.lat != null ? Number(o.props.lat) : undefined,
      })),
    [data],
  );

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  const domestic = bases.filter((b) => coordOf(b));
  const overseas = bases.filter((b) => !coordOf(b));
  const gwhs = domestic.map((b) => b.gwh);
  const minG = Math.min(...gwhs, Infinity);
  const maxG = Math.max(...gwhs, -Infinity);
  // 大小 = GWh 线性映射 8–28px
  const radius = (gwh: number): number => (maxG === minG ? 18 : 8 + ((gwh - minG) / (maxG - minG)) * 20);

  const pick = (b: BaseProps) => {
    setSelected(b);
    useSessionStore.getState().toggleSelectedObject({ objectType: "Base", objectId: b.id, label: b.name });
  };

  return (
    <div data-testid="geo-map-view">
      <div className={simStyles.head}>
        <div>
          <h3>{zh.geo.title}</h3>
          <div className={simStyles.sub}>静态打包轮廓（离线/私有化可用，不依赖外部瓦片服务）· 气泡大小 = GWh（8–28px 线性）· 颜色 = 定位。</div>
        </div>
      </div>
      <div className={styles.geoLayout}>
        <div className={styles.geoCanvas}>
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className={styles.geoSvg} data-testid="geo-svg">
            {(outline.polygons as [number, number][][]).map((poly, i) => (
              <path
                key={i}
                className={styles.geoOutline}
                data-testid={`geo-outline-${i}`}
                d={`M${poly.map(([lon, lat]) => {
                  const p = project(lon, lat);
                  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                }).join(" L")} Z`}
              />
            ))}
            {domestic.map((b) => {
              const [lon, lat] = coordOf(b)!;
              const p = project(lon, lat);
              const r = radius(b.gwh);
              const color = positionColors[b.position] ?? "#E8B54A";
              return (
                <g key={b.id} transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`}>
                  <circle
                    r={r}
                    fill={color}
                    stroke={color}
                    className={styles.geoBubble}
                    data-testid={`geo-bubble-${b.name}`}
                    data-r={r.toFixed(1)}
                    data-position={b.position}
                    role="button"
                    tabIndex={0}
                    onClick={() => pick(b)}
                    onKeyDown={(e) => e.key === "Enter" && pick(b)}
                  />
                  <text y={r + 13} className={styles.geoLabel}>
                    {b.name}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className={styles.geoLegend} data-testid="geo-legend">
            <div className="section-title" style={{ marginBottom: 2 }}>
              {zh.geo.legendTitle}
            </div>
            {Object.entries(positionColors).map(([k, c]) => (
              <span key={k}>
                <i style={{ background: c }} />
                {k}
              </span>
            ))}
          </div>
          {overseas.length > 0 && (
            <div className={styles.overseasStrip} data-testid="geo-overseas">
              <b>{zh.geo.overseas}：</b>
              {overseas.map((b) => (
                <button key={b.id} className={styles.chip} style={{ cursor: "pointer", color: positionColors[b.position], borderColor: "currentcolor" }} onClick={() => pick(b)}>
                  {b.name} · {b.gwh}GWh
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <aside className={styles.baseDrawer} data-testid="geo-base-card">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <strong style={{ fontSize: 15 }}>{selected.name}</strong>
              <span className="badge" style={{ color: positionColors[selected.position], borderColor: "currentcolor" }}>
                {selected.position}
              </span>
              <button className="btn sm" style={{ marginLeft: "auto" }} aria-label={zh.common.close} onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            <div className={styles.drawerRow}>
              <span>{zh.geo.cardLines}</span>
              <b>{selected.lines}</b>
            </div>
            <div className={styles.drawerRow}>
              <span>{zh.geo.cardGwh}</span>
              <b>{selected.gwh}</b>
            </div>
            <div className={styles.drawerRow}>
              <span>{zh.geo.cardYear}</span>
              <b>{selected.prodYear}</b>
            </div>
            <div className={styles.drawerRow}>
              <span>{zh.geo.cardProduct}</span>
              <b>{selected.mainProduct}</b>
            </div>
            <div className={styles.drawerRow}>
              <span>{zh.geo.cardUtil}</span>
              <b style={{ color: utilColor(selected.util, utilThresholds) }} data-testid="geo-card-util">
                {selected.util}%
              </b>
            </div>
            <div className={styles.drawerRow}>
              <span>{zh.geo.cardBottleneck}</span>
              <b className="zh">{selected.bottleneck}</b>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn sm" data-testid="geo-goto-risk" onClick={() => navigate(`/v/risk?focus=${encodeURIComponent(selected.name)}`)}>
                {zh.geo.gotoRisk}
              </button>
              <button className="btn sm" data-testid="geo-goto-graph" onClick={() => navigate(`/v/graph?focus=n-base`)}>
                {zh.geo.gotoGraph}
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
