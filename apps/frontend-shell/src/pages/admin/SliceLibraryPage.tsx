import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchSliceLibrary, planSlice } from "@/api/endpoints";
import type { PlanSliceResponse, SliceLibraryEntry } from "@platform/contracts";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.sliceLibrary;

/**
 * G-VIS-1 admin「切片库」可视页（PRD-A3-multihop-slice-completion §3 item 3）。
 * - 「切片库」tab：GET /a/v1/slices/library → 域内/跨域两库列表（sliceKey/root/域/类型数）。
 * - 「规划」tab：输入 root/目标 → POST /a/v1/slices/plan → 渲染路径 hops 或 NO_PATH。
 * 只接真端点，零假数据；空态诚实。
 */
export default function SliceLibraryPage() {
  const [tab, setTab] = useState<"library" | "plan">("library");

  return (
    <div data-testid="slice-library-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t.title}</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>{t.sub}</div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button
          className={`btn sm ${tab === "library" ? "primary" : ""}`}
          data-testid="tab-library"
          onClick={() => setTab("library")}
        >
          {t.tabLibrary}
        </button>
        <button
          className={`btn sm ${tab === "plan" ? "primary" : ""}`}
          data-testid="tab-plan"
          onClick={() => setTab("plan")}
        >
          {t.tabPlan}
        </button>
      </div>

      {tab === "library" ? <LibraryTab /> : <PlanTab />}
    </div>
  );
}

function LibraryTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["a", "slices-library"],
    queryFn: fetchSliceLibrary,
  });
  const all = useMemo<SliceLibraryEntry[]>(() => {
    if (!data) return [];
    return [...data.intra, ...data.cross].sort((a, b) => a.sliceKey.localeCompare(b.sliceKey));
  }, [data]);

  if (isLoading) return <div className="empty-state">{zh.common.loading}</div>;
  if (error) return <div className="badge red">{zh.errors.pageError}</div>;

  return (
    <>
      <table className="cmp" data-testid="slice-library-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>{t.colSliceKey}</th>
            <th>{t.colScope}</th>
            <th>{t.colRoot}</th>
            <th>{t.colDomains}</th>
            <th>{t.colTypeCount}</th>
          </tr>
        </thead>
        <tbody>
          {all.map((entry) => (
            <tr key={entry.sliceKey} data-testid={`slice-library-${entry.sliceKey}`}>
              <td className="mono">{entry.sliceKey}</td>
              <td>
                <span className={`badge ${entry.scope === "intra" ? "blue" : "amber"}`}>
                  {entry.scope === "intra" ? t.scopeIntra : t.scopeCross}
                </span>
              </td>
              <td className="mono">{entry.rootType}</td>
              <td>{entry.spannedDomains.join(" / ") || "—"}</td>
              <td className="mono">{entry.spannedTypes.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {all.length === 0 && <div className="empty-state" data-testid="slice-library-empty">{t.emptyLibrary}</div>}
    </>
  );
}

function PlanTab() {
  const [rootType, setRootType] = useState("");
  const [targetsRaw, setTargetsRaw] = useState("");
  const [maxHops, setMaxHops] = useState(6);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<PlanSliceResponse | null>(null);

  const targets = useMemo(
    () => targetsRaw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
    [targetsRaw],
  );

  const planMut = useMutation({
    mutationFn: () => planSlice(rootType.trim(), targets, { maxHops, question: question.trim() || undefined }),
    onSuccess: (r) => setResult(r),
    onError: toastError,
  });

  return (
    <div className="panel" data-testid="slice-plan-form" style={{ display: "grid", gap: 12 }}>
      <div className="muted" style={{ fontSize: 11.5 }}>{t.planSub}</div>

      <label style={{ fontSize: 12 }}>
        {t.rootType}
        <input
          data-testid="plan-root-type"
          value={rootType}
          onChange={(e) => setRootType(e.target.value)}
          style={{ marginLeft: 8, width: 220 }}
        />
      </label>

      <label style={{ fontSize: 12 }}>
        <div style={{ marginBottom: 4 }}>{t.targets}</div>
        <textarea
          data-testid="plan-targets"
          value={targetsRaw}
          onChange={(e) => setTargetsRaw(e.target.value)}
          rows={4}
          style={{ width: "100%", maxWidth: 480 }}
        />
      </label>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>
          {t.maxHops}
          <input
            type="number"
            data-testid="plan-max-hops"
            min={1}
            max={12}
            value={maxHops}
            onChange={(e) => setMaxHops(Number(e.target.value) || 6)}
            style={{ marginLeft: 8, width: 80 }}
          />
        </label>
        <label style={{ fontSize: 12 }}>
          {t.question}
          <input
            data-testid="plan-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            style={{ marginLeft: 8, width: 320 }}
          />
        </label>
      </div>

      <div>
        <button
          className="btn primary sm"
          data-testid="plan-submit"
          disabled={planMut.isPending || rootType.trim() === "" || targets.length === 0}
          onClick={() => planMut.mutate()}
        >
          {planMut.isPending ? t.planning : t.submitPlan}
        </button>
      </div>

      {result && result.ok && result.plan && (
        <div className="panel" data-testid="plan-result" style={{ padding: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span className="section-title">{t.resultTitle}</span>
            {result.plan.reused && <span className="badge green">{t.reused}</span>}
            <span className="badge blue">{result.plan.sliceKey}</span>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
            root = <span className="mono">{result.plan.rootType}</span>
            {" · "}
            {t.spannedDomains}：{result.plan.spannedDomains.join(" / ") || "—"}
          </div>

          <table className="cmp" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>{t.pathTarget}</th>
                <th>{t.pathHops}</th>
              </tr>
            </thead>
            <tbody>
              {result.plan.paths.map((p) => (
                <tr key={p.target} data-testid={`plan-path-${p.target}`}>
                  <td className="mono">{p.target}</td>
                  <td style={{ fontSize: 11 }}>
                    {p.hops.length === 0
                      ? "—"
                      : p.hops.map((h, i) => (
                        <span key={i} className="mono" style={{ marginRight: 8 }}>
                          {h.linkKey} / {h.direction} / {h.toType}
                        </span>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.plan.pathEvidence.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>pathEvidence</div>
              <ul style={{ fontSize: 11, paddingLeft: 18, margin: "4px 0 0" }}>
                {result.plan.pathEvidence.map((e, i) => <li key={i} className="mono">{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {result && !result.ok && result.reason && (
        <div className="badge red" data-testid="plan-no-path">
          {t.noPath}：{t.unreachable(result.reason.unreachable.join("、"))}
          {result.reason.rootType ? `（root=${result.reason.rootType}）` : ""}
        </div>
      )}
    </div>
  );
}
