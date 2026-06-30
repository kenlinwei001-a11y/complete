import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Decision } from "@platform/contracts";
import { createDecision, fetchDecisions, recordDecisionOutcome } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const STATUSES = ["", "RECORDED", "OUTCOME_RECORDED"] as const;
const statusLabel: Record<string, string> = {
  RECORDED: "已记录",
  OUTCOME_RECORDED: "已补录实现",
};

/**
 * WO-DECISION-RECORD（PRD §3.7 D8 · 一等 Decision 记录）：问责 + 组织学习。
 * 列表 + 详情（上下文/备选/否决理由/决策人/预测 vs 实现对比）+ 补录实现结果 + 速记新决策。
 */
export default function DecisionsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: decisions } = useQuery({
    queryKey: ["a", "decisions", { status }],
    queryFn: () => fetchDecisions(status || undefined),
  });
  const selected = useMemo(
    () => (decisions ?? []).find((d) => d.id === selectedId) ?? null,
    [decisions, selectedId],
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>决策记录</h2>
        <select value={status} aria-label="状态筛选" onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s || "ALL"} value={s}>
              {s ? statusLabel[s] : "全部"}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setShowCreate((v) => !v)} style={{ marginLeft: "auto" }}>
          {showCreate ? "收起" : "+ 记录决策"}
        </button>
      </div>

      {showCreate && <CreateDecisionForm onDone={() => { setShowCreate(false); void qc.invalidateQueries({ queryKey: ["a", "decisions"] }); }} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 14, alignItems: "start" }}>
        <div className="panel">
          <table className="cmp">
            <thead>
              <tr>
                <th>标题</th>
                <th>决策人</th>
                <th>状态</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {(decisions ?? []).map((d) => (
                <tr key={d.id} style={{ cursor: "pointer" }} onClick={() => setSelectedId(d.id)} data-testid={`decision-${d.id}`}>
                  <td className="zh">{d.title}</td>
                  <td>{d.decidedBy}</td>
                  <td>
                    <span className={`badge ${d.status === "OUTCOME_RECORDED" ? "green" : "amber"}`}>
                      {statusLabel[d.status] ?? d.status}
                    </span>
                  </td>
                  <td>{d.createdAt.slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {decisions && decisions.length === 0 && <div className="empty-state">{zh.common.none}</div>}
        </div>

        <div className="panel">
          {selected ? <DecisionDetail decision={selected} /> : <div className="empty-state">选择一条决策查看详情</div>}
        </div>
      </div>
    </div>
  );
}

function DecisionDetail({ decision }: { decision: Decision }) {
  const qc = useQueryClient();
  const chosenOpt = decision.options.find((o) => o.key === decision.chosen);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h3 style={{ fontSize: 15, margin: 0 }} className="zh">{decision.title}</h3>
        <div style={{ fontSize: 12, color: "var(--muted, #888)" }}>决策人 {decision.decidedBy} · {decision.createdAt.slice(0, 16)}</div>
      </div>

      <Section title="决策上下文 / 触发">
        <div className="zh" style={{ whiteSpace: "pre-wrap" }}>{decision.context}</div>
      </Section>

      <Section title="备选方案">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {decision.options.map((o) => {
            const isChosen = o.key === decision.chosen;
            const rej = decision.rejectedRationale.find((r) => r.optionKey === o.key);
            return (
              <li key={o.key} style={{ marginBottom: 6 }}>
                <span className={`badge ${isChosen ? "green" : ""}`}>{isChosen ? "✓ 所选" : "备选"}</span>{" "}
                <strong className="zh">{o.label}</strong>
                {o.detail && <div className="zh" style={{ fontSize: 12 }}>{o.detail}</div>}
                {o.expectedImpact && <div className="zh" style={{ fontSize: 12, color: "var(--muted, #888)" }}>预期影响：{o.expectedImpact}</div>}
                {rej && <div className="zh" style={{ fontSize: 12, color: "var(--red, #c0392b)" }}>否决理由：{rej.rationale}</div>}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="预测 vs 实现">
        <table className="cmp">
          <thead>
            <tr>
              <th></th>
              <th>预测</th>
              <th>实现</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>摘要</td>
              <td className="zh">{decision.predictedOutcome.summary}</td>
              <td className="zh">{decision.realizedOutcome?.summary ?? <em style={{ color: "var(--muted, #888)" }}>待补录</em>}</td>
            </tr>
            {metricRows(decision)}
          </tbody>
        </table>
        {decision.realizedOutcome && (
          <div style={{ fontSize: 12, color: "var(--muted, #888)", marginTop: 4 }}>
            实现录入：{decision.realizedOutcome.recordedBy} · {decision.realizedOutcome.recordedAt.slice(0, 16)}
          </div>
        )}
      </Section>

      {decision.links.length > 0 && (
        <Section title="关联制品">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {decision.links.map((l, i) => (
              <li key={i}>{l.kind} · {l.refId}</li>
            ))}
          </ul>
        </Section>
      )}

      {!decision.realizedOutcome && (
        <RecordOutcomeForm
          decisionId={decision.id}
          predictedMetricKeys={Object.keys(decision.predictedOutcome.metrics ?? {})}
          onDone={() => void qc.invalidateQueries({ queryKey: ["a", "decisions"] })}
        />
      )}
    </div>
  );
}

/** 预测 vs 实现 的逐指标对比行（按预测+实现键并集）。 */
function metricRows(decision: Decision) {
  const pm = decision.predictedOutcome.metrics ?? {};
  const rm = decision.realizedOutcome?.metrics ?? {};
  const keys = Array.from(new Set([...Object.keys(pm), ...Object.keys(rm)]));
  return keys.map((k) => {
    const p = pm[k];
    const r = rm[k];
    const delta = p != null && r != null ? r - p : undefined;
    return (
      <tr key={k}>
        <td className="zh">{k}</td>
        <td>{p ?? "—"}</td>
        <td>
          {r ?? "—"}
          {delta != null && (
            <span className={`badge ${delta === 0 ? "" : delta > 0 ? "green" : "red"}`} style={{ marginLeft: 6 }}>
              {delta > 0 ? "+" : ""}{Number(delta.toFixed(4))}
            </span>
          )}
        </td>
      </tr>
    );
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

function RecordOutcomeForm({ decisionId, predictedMetricKeys, onDone }: { decisionId: string; predictedMetricKeys: string[]; onDone: () => void }) {
  const [summary, setSummary] = useState("");
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const mut = useMutation({
    mutationFn: () => {
      const parsed: Record<string, number> = {};
      for (const [k, v] of Object.entries(metrics)) {
        if (v.trim() !== "" && !Number.isNaN(Number(v))) parsed[k] = Number(v);
      }
      return recordDecisionOutcome(decisionId, { summary, metrics: Object.keys(parsed).length ? parsed : undefined });
    },
    onSuccess: () => { toast("已补录实现结果"); onDone(); },
    onError: (e) => toastError(e),
  });
  return (
    <div className="panel" style={{ background: "var(--panel-2, #fafafa)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>补录实现结果（realizedOutcome）</div>
      <textarea
        placeholder="实现结果摘要"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={2}
        style={{ width: "100%", marginBottom: 6 }}
        aria-label="实现结果摘要"
      />
      {predictedMetricKeys.map((k) => (
        <div key={k} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
          <label className="zh" style={{ fontSize: 12, minWidth: 120 }}>{k}（实现值）</label>
          <input
            type="number"
            value={metrics[k] ?? ""}
            onChange={(e) => setMetrics((m) => ({ ...m, [k]: e.target.value }))}
            aria-label={`${k} 实现值`}
          />
        </div>
      ))}
      <button type="button" disabled={!summary.trim() || mut.isPending} onClick={() => mut.mutate()}>
        提交实现结果
      </button>
    </div>
  );
}

function CreateDecisionForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [chosen, setChosen] = useState("");
  const [rejected, setRejected] = useState("");
  const [predicted, setPredicted] = useState("");

  const options = useMemo(
    () => optionsText.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => ({ key: `opt${i + 1}`, label: l })),
    [optionsText],
  );

  const mut = useMutation({
    mutationFn: () => {
      const chosenKey = options.find((o) => o.label === chosen)?.key ?? options[0]?.key ?? "";
      const rejectedRationale = rejected
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [label, ...rest] = l.split("：");
          const opt = options.find((o) => o.label === label?.trim());
          return opt ? { optionKey: opt.key, rationale: rest.join("：").trim() || "（未填）" } : null;
        })
        .filter((x): x is { optionKey: string; rationale: string } => x != null);
      return createDecision({
        title,
        context,
        options,
        chosen: chosenKey,
        rejectedRationale,
        predictedOutcome: { summary: predicted },
      });
    },
    onSuccess: () => { toast("已记录决策"); onDone(); },
    onError: (e) => toastError(e),
  });

  const valid = title.trim() && context.trim() && options.length >= 1 && chosen.trim() && predicted.trim();

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>记录新决策</div>
      <div style={{ display: "grid", gap: 6 }}>
        <input placeholder="决策标题" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="决策标题" />
        <textarea placeholder="决策上下文 / 触发" value={context} onChange={(e) => setContext(e.target.value)} rows={2} aria-label="决策上下文" />
        <textarea placeholder="备选方案（每行一个）" value={optionsText} onChange={(e) => setOptionsText(e.target.value)} rows={3} aria-label="备选方案" />
        <input placeholder="所选方案（填某行的内容）" value={chosen} onChange={(e) => setChosen(e.target.value)} aria-label="所选方案" />
        <textarea placeholder="否决理由（每行：方案内容：理由）" value={rejected} onChange={(e) => setRejected(e.target.value)} rows={2} aria-label="否决理由" />
        <textarea placeholder="预测结果摘要" value={predicted} onChange={(e) => setPredicted(e.target.value)} rows={2} aria-label="预测结果" />
        <button type="button" disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>
          记录
        </button>
      </div>
    </div>
  );
}
