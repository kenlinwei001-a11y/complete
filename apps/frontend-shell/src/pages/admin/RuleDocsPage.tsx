import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchRuleCandidates,
  fetchRuleDocs,
  reviewCandidate,
  uploadRuleDoc,
  type RuleCandidateVM,
  type RuleDocVM,
} from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "./RuleDocsPage.module.css";

const t = zh.admin.ruleDocs;

/** 规则文档审核台（PRD §7.5）：上传（A2 抽取）+ 左=文档段落（sourceQuote 高亮）右=候选卡；diff 模式三组 */
export default function RuleDocsPage() {
  const queryClient = useQueryClient();
  const { data: docs } = useQuery({ queryKey: ["a", "rule-docs", {}], queryFn: fetchRuleDocs });
  const [docId, setDocId] = useState<string | null>(null);
  const doc = docs?.find((d) => d.id === docId) ?? docs?.[0];
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadRuleDoc(file),
    onSuccess: async (r) => {
      toast(t.uploadDone(r.candidateCount), "success");
      await queryClient.invalidateQueries({ queryKey: ["a", "rule-docs"] });
      await queryClient.invalidateQueries({ queryKey: ["a", "rule-candidates"] });
      setDocId(r.docId);
    },
    onError: toastError,
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <select value={doc?.id ?? ""} onChange={(e) => setDocId(e.target.value)} aria-label="选择文档">
          {(docs ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.filename} · {d.status}
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.md,.txt"
          hidden
          aria-label={t.upload}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadMut.mutate(f);
            e.target.value = "";
          }}
        />
        <button
          className="btn primary sm"
          style={{ marginLeft: "auto" }}
          disabled={uploadMut.isPending}
          data-testid="rule-doc-upload"
          onClick={() => fileRef.current?.click()}
        >
          {uploadMut.isPending ? t.uploading : t.upload}
        </button>
      </div>
      {doc ? <DocReview doc={doc} /> : <div className="empty-state">{zh.common.none}</div>}
    </div>
  );
}

function DocReview({ doc }: { doc: RuleDocVM }) {
  const queryClient = useQueryClient();
  const { data: candidates } = useQuery({
    queryKey: ["a", "rule-candidates", { docId: doc.id }],
    queryFn: () => fetchRuleCandidates(doc.id),
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState(false);

  const list = candidates ?? [];
  const active = list.find((c) => c.id === activeId) ?? null;
  const reviewed = list.filter((c) => c.status !== "PENDING").length;

  const groups = useMemo(() => {
    if (!diffMode) return null;
    return {
      新增: list.filter((c) => c.diff === "新增"),
      变更: list.filter((c) => c.diff === "变更"),
      疑似删除: list.filter((c) => c.diff === "疑似删除"),
    };
  }, [diffMode, list]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span className="badge blue" data-testid="review-progress">
          {t.progress(reviewed, list.length)}
        </span>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--muted)" }}>
          <input type="checkbox" checked={diffMode} onChange={(e) => setDiffMode(e.target.checked)} />
          diff 模式
        </label>
      </div>
      <div className={styles.split}>
        <div className={`panel ${styles.docPane}`} data-testid="doc-segments">
          {doc.segments.map((seg) => (
            <DocSegment key={seg.idx} seg={seg} highlight={active && active.segmentIdx === seg.idx ? active : null} />
          ))}
        </div>
        <div className={styles.cards}>
          {groups
            ? Object.entries(groups).map(([label, items]) => (
                <div key={label}>
                  <div className="section-title">
                    {label} ({items.length})
                  </div>
                  {items.map((c) => (
                    <CandidateCard key={c.id} cand={c} active={activeId === c.id} onActivate={() => setActiveId(c.id)} onDone={() => void queryClient.invalidateQueries({ queryKey: ["a", "rule-candidates"] })} />
                  ))}
                </div>
              ))
            : list.map((c) => (
                <CandidateCard key={c.id} cand={c} active={activeId === c.id} onActivate={() => setActiveId(c.id)} onDone={() => void queryClient.invalidateQueries({ queryKey: ["a", "rule-candidates"] })} />
              ))}
        </div>
      </div>
    </div>
  );
}

function DocSegment({
  seg,
  highlight,
}: {
  seg: RuleDocVM["segments"][number];
  highlight: RuleCandidateVM | null;
}) {
  let content: React.ReactNode = seg.text;
  if (highlight) {
    const quote = highlight.candidate.sourceQuote;
    const idx = seg.text.indexOf(quote);
    if (idx >= 0) {
      content = (
        <>
          {seg.text.slice(0, idx)}
          <mark className={styles.quote} data-testid="source-quote-highlight">
            {quote}
          </mark>
          {seg.text.slice(idx + quote.length)}
        </>
      );
    }
  }
  return (
    <div className={styles.segment} data-active={highlight != null || undefined}>
      {seg.heading && <h4>{seg.heading}</h4>}
      <p>{content}</p>
    </div>
  );
}

function CandidateCard({
  cand,
  active,
  onActivate,
  onDone,
}: {
  cand: RuleCandidateVM;
  active: boolean;
  onActivate: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(cand.candidate.name);
  const [expression, setExpression] = useState(cand.candidate.expression);
  const [severity, setSeverity] = useState(cand.candidate.severity);
  const [scope, setScope] = useState(cand.candidate.scopeObjectTypes.join(","));
  const edited =
    name !== cand.candidate.name ||
    expression !== cand.candidate.expression ||
    severity !== cand.candidate.severity ||
    scope !== cand.candidate.scopeObjectTypes.join(",");

  const reviewMut = useMutation({
    mutationFn: (action: "APPROVE" | "EDIT_APPROVE" | "REJECT") =>
      reviewCandidate(
        cand.id,
        action,
        action === "EDIT_APPROVE"
          ? { name, expression, severity, scopeObjectTypes: scope.split(",").map((s) => s.trim()).filter(Boolean) }
          : undefined,
      ),
    onSuccess: () => {
      toast("已提交审核", "success");
      onDone();
    },
    onError: toastError,
  });

  const conf = cand.candidate.expressionConfidence;

  return (
    <div
      className={`${styles.card} ${active ? styles.cardActive : ""}`}
      data-testid={`candidate-${cand.id}`}
      onClick={onActivate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onActivate()}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input className={styles.nameInput} value={name} aria-label="规则名" onChange={(e) => setName(e.target.value)} />
        {cand.diff && <span className={`badge ${cand.diff === "疑似删除" ? "red" : cand.diff === "变更" ? "amber" : "green"}`}>{cand.diff}</span>}
        {cand.duplicateOf && <span className="badge amber" data-testid="dup-badge">{t.dupBadge}</span>}
        <span className={`badge ${cand.status === "APPROVED" ? "green" : cand.status === "REJECTED" ? "red" : ""}`}>{cand.status}</span>
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0" }}>{cand.candidate.description}</p>
      <textarea
        className="mono"
        style={{ width: "100%", fontSize: 11.5, minHeight: 44 }}
        value={expression}
        aria-label="expression"
        onChange={(e) => setExpression(e.target.value)}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}>
        <select value={severity} aria-label="severity" onChange={(e) => setSeverity(e.target.value as typeof severity)}>
          <option value="BLOCK">BLOCK</option>
          <option value="WARN">WARN</option>
          <option value="INFO">INFO</option>
        </select>
        <input style={{ flex: 1 }} value={scope} aria-label="scope" placeholder="作用对象类型（逗号分隔）" onChange={(e) => setScope(e.target.value)} />
      </div>
      {/* 置信度条 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>{t.confidence}</span>
        <div style={{ flex: 1, height: 4, background: "var(--bg2)", borderRadius: 2 }}>
          <div style={{ width: `${conf * 100}%`, height: "100%", borderRadius: 2, background: conf > 0.7 ? "var(--ok)" : "var(--amber)" }} />
        </div>
        <span className="mono" style={{ fontSize: 10.5 }}>{(conf * 100).toFixed(0)}%</span>
      </div>
      {cand.status === "PENDING" && (
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn sm primary" disabled={reviewMut.isPending} onClick={(e) => { e.stopPropagation(); reviewMut.mutate(edited ? "EDIT_APPROVE" : "APPROVE"); }}>
            {edited ? t.editApprove : t.approve}
          </button>
          <button className="btn sm danger" disabled={reviewMut.isPending} onClick={(e) => { e.stopPropagation(); reviewMut.mutate("REJECT"); }}>
            {t.reject}
          </button>
        </div>
      )}
    </div>
  );
}
