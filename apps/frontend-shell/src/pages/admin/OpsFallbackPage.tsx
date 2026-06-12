import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchFallbackStats, promoteFallback } from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.fallback;

/** 兜底统计与意图孵化（QOS §8.5）：聚类列表 + 一键 promote → DRAFT 意图编辑页 */
export default function OpsFallbackPage() {
  const { data: workspace } = useWorkspace();
  const packageId = workspace?.scenarioPackages[0] ?? "";
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["b", "fallback-stats", { packageId }],
    queryFn: () => fetchFallbackStats(packageId),
    enabled: packageId !== "",
  });

  const promoteMut = useMutation({
    mutationFn: (traceId: string) => promoteFallback(traceId),
    onSuccess: (r) => {
      toast("已生成 DRAFT 意图", "success");
      navigate(`/admin/catalog?intentId=${r.intentId}`);
    },
    onError: toastError,
  });

  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{t.title}</h2>
      <div className="panel">
        <table className="cmp">
          <thead>
            <tr>
              <th>querySample</th>
              <th>count</th>
              <th>趋势</th>
              <th>outcome</th>
              <th>topToolSketch</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((c) => (
              <tr key={c.traceId} data-testid={`cluster-${c.traceId}`}>
                <td className="zh">{c.querySample}</td>
                <td>{c.count}</td>
                <td>
                  <Trend values={c.trend} />
                </td>
                <td className="zh" style={{ fontSize: 11 }}>
                  {Object.entries(c.outcomeBreakdown)
                    .map(([k, v]) => `${k}:${v}`)
                    .join(" ")}
                </td>
                <td style={{ fontSize: 10.5, color: "var(--muted2)" }}>{c.topToolSketch.join(" → ")}</td>
                <td>
                  <button className="btn sm primary" disabled={promoteMut.isPending} onClick={() => promoteMut.mutate(c.traceId)}>
                    {t.promote}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Trend({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <span style={{ display: "inline-flex", gap: 1, alignItems: "flex-end", height: 16 }}>
      {values.map((v, i) => (
        <span key={i} style={{ width: 4, height: Math.max(2, (v / max) * 16), background: "var(--c-capacity)", borderRadius: 1 }} />
      ))}
    </span>
  );
}
