import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { editRawDatasetRow, fetchConnectionSchema, fetchRawDatasetRows, fetchRawDatasets } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.connections;

const TYPE_BADGES: Record<string, string> = {
  string: "blue",
  number: "green",
  boolean: "amber",
  date: "amber",
  json: "",
};

/**
 * 数据源节点在线编辑（A7 增量）：行内修改上传数据并留痕。
 * 取该连接器的首个 RawDataset，单元格点击 → 编辑 → 保存（PATCH /raw-datasets/:id/rows/:idx）。
 */
function DataSourceRowsEditor({ connId }: { connId: string }) {
  const dsQ = useQuery({ queryKey: ["a", "raw-datasets", { connId }], queryFn: () => fetchRawDatasets(connId), enabled: connId !== "" });
  const datasetId = dsQ.data?.[0]?.id;
  const rowsQ = useQuery({
    queryKey: ["a", "raw-rows", datasetId],
    queryFn: () => fetchRawDatasetRows(datasetId!),
    enabled: !!datasetId,
  });
  const [edit, setEdit] = useState<{ idx: number; key: string; value: string } | null>(null);
  const saveM = useMutation({
    mutationFn: (p: { idx: number; key: string; value: string }) => editRawDatasetRow(datasetId!, p.idx, { [p.key]: p.value }),
    onSuccess: () => {
      toast("已保存", "success");
      setEdit(null);
      void rowsQ.refetch();
    },
    onError: (e) => toastError(e as Error),
  });

  if (!datasetId) return null;
  const rows = rowsQ.data?.rows ?? [];
  if (rows.length === 0) return null;
  const cols = Object.keys(rows[0]!).filter((k) => k !== "_editedAt");

  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="ds-rows-editor">
      <div className="section-title">数据源在线编辑（点击单元格修改）</div>
      <table className="cmp" data-testid="ds-rows-table">
        <thead>
          <tr>
            <th>#</th>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
            <th>编辑痕迹</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} data-testid={`ds-row-${idx}`}>
              <td>{idx}</td>
              {cols.map((c) => {
                const editing = edit && edit.idx === idx && edit.key === c;
                return (
                  <td key={c} data-testid={`ds-cell-${idx}-${c}`} style={{ cursor: "pointer" }} onClick={() => !editing && setEdit({ idx, key: c, value: String(row[c] ?? "") })}>
                    {editing ? (
                      <input
                        data-testid="ds-cell-input"
                        autoFocus
                        value={edit.value}
                        onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveM.mutate(edit);
                          if (e.key === "Escape") setEdit(null);
                        }}
                        onBlur={() => saveM.mutate(edit)}
                        style={{ width: 110 }}
                      />
                    ) : (
                      String(row[c] ?? "")
                    )}
                  </td>
                );
              })}
              <td style={{ color: "var(--muted2)", fontSize: 10 }}>{row._editedAt ? "✎ 已编辑" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 字段画像页（PRD §7.4）：数据集表 + FieldProfile 表（类型徽章/枚举候选 chips/空值率条） */
export default function FieldProfilePage() {
  const { connId = "" } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["a", "conn-schema", { connId }],
    queryFn: () => fetchConnectionSchema(connId),
    enabled: connId !== "",
  });

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to="/admin/connections">← {zh.common.back}</Link>
      </div>
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{t.fieldProfile}</h2>
      <DataSourceRowsEditor connId={connId} />

      {data.datasets.map((ds) => (
        <div className="panel" key={ds.name} style={{ marginBottom: 14 }} data-testid={`dataset-${ds.name}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <strong className="mono">{ds.name}</strong>
            {ds.kind === "TIMESERIES" && (
              <>
                <span className="badge amber">TIMESERIES</span>
                {ds.timeField && <span className="badge">time: {ds.timeField}</span>}
                {ds.entityRefField && <span className="badge">entity: {ds.entityRefField}</span>}
              </>
            )}
          </div>
          <table className="cmp">
            <thead>
              <tr>
                <th>字段</th>
                <th>类型</th>
                <th>{t.nullRate}</th>
                <th>{t.uniqueRate}</th>
                <th>{t.enumCandidates}</th>
                <th>样本</th>
              </tr>
            </thead>
            <tbody>
              {ds.fields.map((f) => (
                <tr key={f.name} data-testid={`field-${f.name}`}>
                  <td>{f.name}</td>
                  <td>
                    <span className={`badge ${TYPE_BADGES[f.inferredType] ?? ""}`}>{f.inferredType}</span>
                  </td>
                  <td style={{ minWidth: 120 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, height: 4, background: "var(--bg2)", borderRadius: 2 }}>
                        <div
                          style={{
                            width: `${Math.round(f.nullRate * 100)}%`,
                            height: "100%",
                            background: f.nullRate > 0.3 ? "var(--danger)" : "var(--c-capacity)",
                            borderRadius: 2,
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 10 }}>{(f.nullRate * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td>{(f.uniqueRate * 100).toFixed(0)}%</td>
                  <td className="zh">
                    {(f.enumCandidates ?? []).map((e) => (
                      <span key={e} className="badge" style={{ marginRight: 4 }}>
                        {e}
                      </span>
                    ))}
                  </td>
                  <td style={{ color: "var(--muted2)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.samples.slice(0, 3).map(String).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
