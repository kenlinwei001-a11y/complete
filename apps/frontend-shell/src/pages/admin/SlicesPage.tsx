import { useQuery } from "@tanstack/react-query";
import { fetchSlices } from "@/api/endpoints";

/**
 * 本体切片清单（治理：切片 = 可追溯子图 root→hops，A6 逐跳剪枝）。
 * 列出已注册切片（rootType / 跳数 / 链路 / 契约 fixtures）。后端 `GET /a/v1/ontology/slices` 本次新增。
 */
export default function SlicesPage() {
  const { data } = useQuery({ queryKey: ["a", "ontology-slices"], queryFn: fetchSlices });
  const slices = data ?? [];

  return (
    <div data-testid="slices-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>本体切片</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        切片是可追溯子图（root 对象 → 逐跳沿链路展开），求解器/推演按切片取数，A6 行级过滤逐跳生效。
      </div>
      <table className="cmp" data-testid="slices-table" style={{ width: "100%" }}>
        <thead>
          <tr><th>切片键</th><th>版本</th><th>根类型</th><th>跳数</th><th>链路</th><th>maxNodes</th><th>契约 fixtures</th></tr>
        </thead>
        <tbody>
          {slices.map((s) => (
            <tr key={s.sliceKey} data-testid={`slice-${s.sliceKey}`}>
              <td className="mono">{s.sliceKey}</td>
              <td className="mono">v{s.version}</td>
              <td><span className="badge">{s.rootType}</span></td>
              <td className="mono">{s.hops}</td>
              <td style={{ fontSize: 11, color: "var(--muted)" }}>{s.linkKeys.join(" · ") || "—"}</td>
              <td className="mono">{s.maxNodes ?? "—"}</td>
              <td>
                {s.fixtures > 0
                  ? <span className="badge green" data-testid={`slice-fixtures-${s.sliceKey}`}>{s.fixtures} ✓</span>
                  : <span className="badge amber">无契约</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {slices.length === 0 && <div className="empty-state">暂无注册切片</div>}
    </div>
  );
}
