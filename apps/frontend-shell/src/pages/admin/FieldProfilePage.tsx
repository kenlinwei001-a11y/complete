import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ValidationPolicy } from "@platform/contracts";
import { editRawDatasetRow, fetchConnectionSchema, fetchRawDatasetRows, fetchRawDatasets, fetchConnections, setConnectionValidationPolicy } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.connections;

/**
 * 约束执行层 stage4：连接器（数据源）级本体校验策略 + 字段映射编辑器。
 * 适配不同数据字段的导入——配"外部字段→本体属性"映射 + 各维度处置策略;按租户持久化。
 */
function ValidationPolicyEditor({ connId, sourceFields }: { connId: string; sourceFields: string[] }) {
  const qc = useQueryClient();
  const connsQ = useQuery({ queryKey: ["a", "connections", {}], queryFn: fetchConnections });
  const conn = connsQ.data?.find((c) => c.id === connId);
  const saved = conn?.validationPolicy;
  const [unknownFields, setUnknown] = useState(saved?.unknownFields ?? "PASS_AND_MARK");
  const [valueDomain, setValueDomain] = useState(saved?.valueDomain ?? "REJECT");
  const [typeMismatch, setTypeMismatch] = useState(saved?.typeMismatch ?? "REJECT");
  const [missingRequired, setMissingRequired] = useState(saved?.missingRequired ?? "REJECT");
  const [maps, setMaps] = useState<{ src: string; prop: string }[]>(
    Object.entries(saved?.fieldMappings ?? {}).map(([src, prop]) => ({ src, prop })),
  );
  const save = useMutation({
    mutationFn: () => {
      const fieldMappings = Object.fromEntries(maps.filter((m) => m.src && m.prop).map((m) => [m.src, m.prop]));
      const policy = { fieldMappings, unknownFields, valueDomain, typeMismatch, missingRequired, domainOverrides: saved?.domainOverrides ?? {} } as ValidationPolicy;
      return setConnectionValidationPolicy(connId, policy);
    },
    onSuccess: () => { toast("校验策略已保存", "success"); void qc.invalidateQueries({ queryKey: ["a", "connections"] }); },
    onError: toastError,
  });
  const Dim = ({ label, val, set, opts, tid }: { label: string; val: string; set: (v: string) => void; opts: string[]; tid: string }) => (
    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ minWidth: 96 }}>{label}</span>
      <select data-testid={tid} value={val} onChange={(e) => set(e.target.value)}>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="validation-policy-editor">
      <div className="section-title">本体校验策略 · 字段映射（适配本数据源导入）</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
        本源导入数据按本体对象类型 schema + 值域校验;字段映射把外部字段名归一到本体属性。按租户保存。
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <Dim label="野字段" val={unknownFields} set={(v) => setUnknown(v as typeof unknownFields)} opts={["PASS_AND_MARK", "REJECT", "QUARANTINE", "DROP"]} tid="vp-unknownFields" />
        <Dim label="值域违规" val={valueDomain} set={(v) => setValueDomain(v as typeof valueDomain)} opts={["REJECT", "QUARANTINE", "PASS_AND_MARK"]} tid="vp-valueDomain" />
        <Dim label="类型不符" val={typeMismatch} set={(v) => setTypeMismatch(v as typeof typeMismatch)} opts={["REJECT", "COERCE", "QUARANTINE"]} tid="vp-typeMismatch" />
        <Dim label="缺主键" val={missingRequired} set={(v) => setMissingRequired(v as typeof missingRequired)} opts={["REJECT", "QUARANTINE", "WARN"]} tid="vp-missingRequired" />
      </div>
      <div style={{ fontSize: 12, marginBottom: 6 }}>字段映射（外部字段 → 本体属性）</div>
      {maps.map((m, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <input data-testid={`vp-map-src-${i}`} placeholder="外部字段" list="vp-srcfields" value={m.src} onChange={(e) => setMaps((s) => s.map((x, j) => (j === i ? { ...x, src: e.target.value } : x)))} style={{ flex: 1 }} />
          <span style={{ alignSelf: "center" }}>→</span>
          <input data-testid={`vp-map-prop-${i}`} placeholder="本体属性键" value={m.prop} onChange={(e) => setMaps((s) => s.map((x, j) => (j === i ? { ...x, prop: e.target.value } : x)))} style={{ flex: 1 }} />
        </div>
      ))}
      <datalist id="vp-srcfields">{sourceFields.map((f) => <option key={f} value={f} />)}</datalist>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn sm" data-testid="vp-add-map" onClick={() => setMaps((s) => [...s, { src: "", prop: "" }])}>+ 映射</button>
        <button className="btn primary sm" data-testid="vp-save" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "保存中…" : "保存策略"}</button>
      </div>
    </div>
  );
}

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
              <td style={{ color: "var(--muted2)", fontSize: 12 }}>{row._editedAt ? "✎ 已编辑" : ""}</td>
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
      <ValidationPolicyEditor connId={connId} sourceFields={[...new Set(data.datasets.flatMap((ds) => ds.fields.map((f) => f.name)))]} />

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
                      <span style={{ fontSize: 12 }}>{(f.nullRate * 100).toFixed(0)}%</span>
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
