import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IntakeTypeCoverage } from "@platform/contracts";
import { fetchDataCategories, fetchIntakeCoverage, fetchObjectTypeStats, fetchRawDatasets, fetchRawDatasetRows, objectifyIntake, setDataCategoryMode, setDataCategoryTemplate, uploadFile, type DataCategoryView } from "@/api/endpoints";
import { downloadBlob } from "@/views/graph/mappingExport";
import { toast, toastError } from "@/store/toastStore";

const MODE_LABEL: Record<string, string> = { SYSTEM_INTEGRATION: "系统对接", FILE_UPLOAD: "文件上传" };

/** 该分类的上传模版 CSV（自定义列优先；否则每类型一段表头）——客户端据已取列构建,可下载。 */
function categoryTemplateCsv(cat: DataCategoryView): string {
  if (cat.customColumns && cat.customColumns.length > 0) return cat.customColumns.join(",");
  return cat.types.map((t) => `# ${t.displayName} (${t.typeKey})\n${t.columns.join(",")}`).join("\n\n");
}

/** 读文本（用 FileReader，兼容 jsdom；File.text 在测试环境可能缺失）。 */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("读取文件失败"));
    r.readAsText(file);
  });
}

/** 读 CSV 文件首行作为模版列头（去空白、去空列）。 */
async function readCsvHeader(file: File): Promise<string[]> {
  const text = await readFileText(file);
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  return firstLine.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * 数据接入分类面板（数据接入控制台）：把"目前的数据"按业务域归类展示；每类可切换 系统对接/文件上传；
 * 文件上传类可查看字段模版并下载 CSV。分类名/字段全部来自后端（应用层无业务常数，R14）。
 */
export function DataCategoriesPanel() {
  const qc = useQueryClient();
  // WO-INTAKE-VISIBILITY（G-VIS-1·C1）：上传后不再无条件跳走 /schema——就地展开导入行预览（用户看到导入的数据）。
  const [uploadedConnId, setUploadedConnId] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["a", "data-categories", {}], queryFn: fetchDataCategories });
  // G-VIS-1 · 每类型已物化实例数（后端 `GET /a/v1/ontology/object-types/stats` 的 count 真值）：
  // 分类面板此前只显 schema（类/字段），不显该类型实际物化了多少 ObjectInstance——此处按 typeKey 关联真实计数。
  const { data: statsData } = useQuery({ queryKey: ["a", "object-type-stats"], queryFn: fetchObjectTypeStats, staleTime: 60_000 });
  const countByType = new Map((statsData?.stats ?? []).map((s) => [s.key, s.count]));
  // PANORAMA-FIELD-INTAKE：全景类型×字段供给覆盖度（后端真值：模版列∪连接器映射·字段级缺口·诚实未映射/未归类）。
  const { data: coverage } = useQuery({ queryKey: ["a", "intake-coverage"], queryFn: fetchIntakeCoverage, staleTime: 60_000 });
  const covByType = new Map((coverage?.items ?? []).map((i) => [i.typeKey, i]));
  const uncategorized = (coverage?.items ?? []).filter((i) => i.categoryKey === null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const uploadInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const tplInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const invalidate = () => qc.invalidateQueries({ queryKey: ["a", "data-categories", {}] });
  const setMode = useMutation({
    mutationFn: ({ key, mode }: { key: string; mode: "SYSTEM_INTEGRATION" | "FILE_UPLOAD" }) => setDataCategoryMode(key, mode),
    onSuccess: () => { void invalidate(); toast("已更新接入方式"); },
    onError: (e) => toastError(e),
  });
  const replaceTemplate = useMutation({
    mutationFn: ({ key, columns }: { key: string; columns: string[] }) => setDataCategoryTemplate(key, columns),
    onSuccess: () => { void invalidate(); toast("已替换模版"); },
    onError: (e) => toastError(e),
  });
  // 上传数据文件（走与连接器页同一上传门）→ 就地展开该连接导入行（不弹走·C1），并失效 raw-datasets 缓存。
  const uploadData = useMutation({
    mutationFn: (file: File) => uploadFile(file),
    onSuccess: (res) => {
      toast("已上传，下方查看导入的行");
      void qc.invalidateQueries({ queryKey: ["a", "raw-datasets"] });
      setUploadedConnId(res.connId);
    },
    onError: (e) => toastError(e),
  });
  const cats = data?.items ?? [];
  if (cats.length === 0) return null;

  return (
    <section style={{ marginBottom: 18 }} data-testid="data-categories-panel">
      <div className="section-title" style={{ marginBottom: 8 }}>数据分类（{cats.length}）</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
        {cats.map((cat) => {
          const expanded = openKey === cat.key;
          const fieldCount = cat.types.reduce((s, t) => s + t.columns.length, 0);
          // G-VIS-1 · 该分类下各类型已物化实例合计（真值 count 求和）——卡头就可见"有没有数据落地"。
          const matTotal = cat.types.reduce((s, t) => s + (countByType.get(t.typeKey) ?? 0), 0);
          return (
            <div key={cat.key} data-testid={`dc-${cat.key}`} className="card" style={{ padding: 12, border: "1px solid var(--border, #2a2a2a)", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{cat.displayName}</strong>
                {statsData && (
                  <span className={`badge ${matTotal > 0 ? "green" : "amber"}`} data-testid={`dc-mat-total-${cat.key}`} style={{ marginLeft: "auto", fontSize: 10 }} title="该分类已物化对象实例合计（真值）">
                    {matTotal > 0 ? `已物化 ${matTotal}` : "未物化"}
                  </span>
                )}
                <span className="chip" style={{ marginLeft: statsData ? undefined : "auto", fontSize: 11 }}>{cat.types.length} 类 · {fieldCount} 字段</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted, #999)", margin: "4px 0 8px" }}>{cat.description}</div>

              {/* 接入方式：系统对接 / 文件上传（按类支持的 modes 渲染可选项） */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 12 }}>接入方式</span>
                <select
                  className="input sm"
                  value={cat.mode}
                  disabled={setMode.isPending}
                  onChange={(e) => setMode.mutate({ key: cat.key, mode: e.target.value as "SYSTEM_INTEGRATION" | "FILE_UPLOAD" })}
                  aria-label={`${cat.displayName} 接入方式`}
                >
                  {cat.modes.map((m) => (
                    <option key={m} value={m}>{MODE_LABEL[m] ?? m}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn sm" onClick={() => setOpenKey(expanded ? null : cat.key)} aria-expanded={expanded}>
                  {expanded ? "收起字段" : "查看字段"}
                </button>
                {cat.mode === "FILE_UPLOAD" && (
                  <>
                    {/* 上传实际数据文件 */}
                    <button className="btn sm primary" onClick={() => uploadInputs.current[cat.key]?.click()} disabled={uploadData.isPending}>上传文件</button>
                    <input ref={(el) => { uploadInputs.current[cat.key] = el; }} type="file" accept=".csv,.xlsx,.json" hidden aria-label={`${cat.displayName} 上传文件`}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadData.mutate(f); e.target.value = ""; }} />
                    {/* 下载模版 */}
                    <button className="btn sm" onClick={() => { downloadBlob(categoryTemplateCsv(cat), "text/csv;charset=utf-8", `${cat.key}.template.csv`); toast("已下载模版"); }}>下载模版</button>
                    {/* 上传 CSV 替换模版（可调整，非写死） */}
                    <button className="btn sm" onClick={() => tplInputs.current[cat.key]?.click()} disabled={replaceTemplate.isPending}>替换模版</button>
                    <input ref={(el) => { tplInputs.current[cat.key] = el; }} type="file" accept=".csv" hidden aria-label={`${cat.displayName} 替换模版`}
                      onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const cols = await readCsvHeader(f); if (cols.length === 0) { toastError(new Error("CSV 首行无有效列头")); } else { replaceTemplate.mutate({ key: cat.key, columns: cols }); } } e.target.value = ""; }} />
                    {cat.customColumns && cat.customColumns.length > 0 && (
                      <button className="btn sm" onClick={() => replaceTemplate.mutate({ key: cat.key, columns: [] })}>复位模版</button>
                    )}
                  </>
                )}
              </div>
              {cat.customColumns && cat.customColumns.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--accent, #4C90F0)" }}>已用自定义模版（{cat.customColumns.length} 列）</div>
              )}

              {expanded && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {cat.customColumns && cat.customColumns.length > 0 ? (
                    <div>
                      <div style={{ fontWeight: 600 }}>自定义模版</div>
                      <div style={{ color: "var(--muted, #999)", wordBreak: "break-all" }}>{cat.customColumns.join(", ")}</div>
                    </div>
                  ) : (
                    cat.types.map((tp) => {
                      // G-VIS-1 · 该类型已物化实例数（真值 count；未建模/无实例 → 诚实标，非造假）。
                      const mat = countByType.get(tp.typeKey);
                      return (
                      <div key={tp.typeKey} style={{ marginBottom: 6 }}>
                        <div style={{ fontWeight: 600 }}>
                          {tp.displayName} <span style={{ color: "var(--muted,#999)" }}>({tp.typeKey})</span>
                          {!tp.present && <span style={{ color: "#c66" }}> · 未建模</span>}
                          {tp.present && (mat !== undefined && mat > 0
                            ? <span className="badge green" data-testid={`dc-mat-${tp.typeKey}`} style={{ marginLeft: 6, fontSize: 10 }}>已物化 {mat}</span>
                            : <span className="badge amber" data-testid={`dc-mat-${tp.typeKey}`} style={{ marginLeft: 6, fontSize: 10 }} title="已建模但尚无物化实例">未物化</span>)}
                        </div>
                        {/* PANORAMA-FIELD-INTAKE：逐类型字段供给覆盖度（后端真值·缺口徽章深链 reconcile/模板下载）。 */}
                        <TypeCoverageBadges cov={covByType.get(tp.typeKey)} />
                        <div style={{ color: "var(--muted, #999)", wordBreak: "break-all" }}>{tp.columns.join(", ") || "（无可上传字段）"}</div>
                      </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* PANORAMA-FIELD-INTAKE：未归类全景类型——以图谱全景为完备性基准，未归入任何分类的类型诚实透出
          （非隐藏），仍可逐类型下载数据模版（列=全 props+FK·本体派生）。 */}
      {uncategorized.length > 0 && (
        <div className="panel" style={{ marginTop: 12 }} data-testid="dc-uncategorized">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>未归类全景类型（{uncategorized.length}）</strong>
            <span style={{ fontSize: 11, color: "var(--muted2)" }}>图谱全景中存在但未归入任何数据分类——仍可下载模版上传（诚实透出·非隐藏）</span>
          </div>
          {uncategorized.map((i) => (
            <div key={i.typeKey} style={{ fontSize: 12, marginBottom: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} data-testid={`dc-uncat-${i.typeKey}`}>
              <span style={{ fontWeight: 600 }}>{i.displayName} <span style={{ color: "var(--muted,#999)" }}>({i.typeKey})</span></span>
              <TypeCoverageBadges cov={i} />
            </div>
          ))}
        </div>
      )}
      {uploadedConnId && <UploadedPreview connId={uploadedConnId} />}
    </section>
  );
}

/**
 * PANORAMA-FIELD-INTAKE：逐类型字段供给覆盖徽章——已可供给 N/M（模版列∪连接器映射·后端真值）；
 * 连接器未映射字段诚实列出（title 逐字段·非隐藏）→ 深链字段对账；任一路径缺口红标；一键下载该类型模版
 * （列 = 全非派生 props + FK 列·本体派生 R14）。
 */
function TypeCoverageBadges({ cov }: { cov?: IntakeTypeCoverage }) {
  if (!cov) return null;
  const full = cov.suppliable >= cov.intakeTotal;
  const hasBindings = cov.connector.bindings.length > 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap", margin: "2px 0" }}>
      <span className={`badge ${full ? "green" : "amber"}`} data-testid={`dc-cov-${cov.typeKey}`} style={{ fontSize: 10 }}
        title={`可供给字段（上传模版列 ∪ 连接器已映射）/需供给字段（非派生 props）${cov.derivedCount > 0 ? `；另 ${cov.derivedCount} 个派生字段由系统算出` : ""}`}>
        可供给 {cov.suppliable}/{cov.intakeTotal}
      </span>
      {hasBindings && cov.connector.unmapped.length > 0 && (
        <Link to="/admin/schema-reconcile" data-testid={`dc-unmapped-${cov.typeKey}`}
          className="badge amber" style={{ fontSize: 10, textDecoration: "none" }}
          title={`连接器未映射字段（诚实标·非隐藏）：${cov.connector.unmapped.join(", ")} —— 点击去字段对账`}>
          连接器未映射 {cov.connector.unmapped.length}
        </Link>
      )}
      {cov.gaps.length > 0 && (
        <span className="badge red" data-testid={`dc-gap-${cov.typeKey}`} style={{ fontSize: 10 }}
          title={`任一路径都不可供给：${cov.gaps.join(", ")}`}>
          缺口 {cov.gaps.length}
        </span>
      )}
      {cov.template.available && (
        <button className="btn sm" data-testid={`dc-tpl-${cov.typeKey}`} style={{ fontSize: 10, padding: "0 6px" }}
          title={`下载 ${cov.typeKey} 数据模版（列=${cov.template.columns.length} 全字段${cov.template.refColumns.length > 0 ? `·含 FK 列 ${cov.template.refColumns.map((r) => `${r.column}→${r.refToType}`).join("、")}` : ""}）`}
          onClick={() => { downloadBlob(cov.template.columns.join(","), "text/csv;charset=utf-8", `${cov.typeKey}.template.csv`); toast(`已下载 ${cov.typeKey} 模版`); }}>
          模版⤓
        </button>
      )}
    </span>
  );
}

/**
 * WO-INTAKE-VISIBILITY（C1）：上传后就地预览导入的行（不弹走 /schema）——用户当页就看到导入的数据，
 * 前端所见 = 后端 raw-datasets/rows 真值。附「去字段核对/建模 →」软链（非强制跳转）。
 */
function UploadedPreview({ connId }: { connId: string }) {
  const qc = useQueryClient();
  const { data: datasets } = useQuery({ queryKey: ["a", "raw-datasets", { connId }], queryFn: () => fetchRawDatasets(connId) });
  const first = datasets?.[0];
  const { data: rowsData } = useQuery({
    queryKey: ["a", "raw-dataset-rows", first?.id],
    queryFn: () => fetchRawDatasetRows(first!.id),
    enabled: !!first,
  });
  // PANORAMA-FIELD-INTAKE：上传后当页可直接 objectify（上传→objectify→reconcile 一条龙·复用 INTAKE-VISIBILITY 机件）——
  // 未精确命中列落对账队列（诚实不静默丢），物化数/待确认数如实回显。
  const [objectified, setObjectified] = useState<{ n: number; candidates: number } | null>(null);
  const objectify = useMutation({
    mutationFn: () => objectifyIntake(connId),
    onSuccess: (r) => {
      const n = r.materialized.reduce((a, m) => a + m.count, 0);
      setObjectified({ n, candidates: r.candidates ?? 0 });
      toast(`已物化 ${n} 个对象实例${(r.candidates ?? 0) > 0 ? `·${r.candidates} 列待字段对账` : ""}`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "object-type-stats"] });
      void qc.invalidateQueries({ queryKey: ["a", "reconcile-candidates"] });
    },
    onError: toastError,
  });
  const rows = rowsData?.rows ?? [];
  const cols = rows.length > 0 ? Object.keys(rows[0]!) : (first?.fields?.map((f) => f.name) ?? []);
  return (
    <div className="panel" style={{ marginTop: 12 }} data-testid="dc-upload-preview">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>已导入：{first?.name ?? "（加载中）"}</strong>
        <span className="chip" style={{ fontSize: 11 }}>{rows.length} 行 · {cols.length} 列</span>
        <button className="btn sm primary" style={{ marginLeft: "auto" }} data-testid="dc-upload-objectify" disabled={objectify.isPending}
          onClick={() => objectify.mutate()}>
          {objectify.isPending ? "物化中…" : "物化为对象(objectify)"}
        </button>
        <Link to={`/admin/connections/${connId}/schema`} style={{ fontSize: 12 }} data-testid="dc-upload-goto-schema">去字段核对/建模 →</Link>
      </div>
      {objectified && (
        <div style={{ fontSize: 12, marginBottom: 6 }} data-testid="dc-upload-objectify-result">
          已物化 <b>{objectified.n}</b> 个对象实例（<Link to="/admin/object-types">对象浏览器查看 →</Link>）
          {objectified.candidates > 0 && (
            <>
              ；<b>{objectified.candidates}</b> 列未精确命中已入对账队列（不静默丢）——
              <Link to={`/admin/schema-reconcile?connId=${connId}`} data-testid="dc-upload-goto-reconcile">去逐列确认 →</Link>
            </>
          )}
        </div>
      )}
      {rows.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table className="cmp" data-testid="dc-upload-preview-table">
            <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.slice(0, 10).map((r, i) => (
                <tr key={i} data-testid={`dc-upload-row-${i}`}>{cols.map((c) => <td key={c}>{String(r[c] ?? "")}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--muted2)" }} data-testid="dc-upload-preview-empty">导入完成——加载行中或该表无行。</div>
      )}
    </div>
  );
}
