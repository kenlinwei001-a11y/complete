import { useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PromoteConflict, PromoteDecision, PromotePrecheck, ReconcileAction, StoryBuildRun } from "@platform/contracts";
import { PROMOTE_CONFLICT_REGISTRY } from "@platform/contracts";
import { promoteStoryDomain, promotePrecheck } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";

/**
 * 第 ⑥ 步 · 入库前复验 → 人工裁决：入库 / 下载（WO-DBUI-FLOW §3.3）
 *
 * **仓主原话**：「模拟的数据是否可以入库，**需要系统再次复验自检，因为人不清楚系统里面的数据现状，
 * 是否有冲突等等**」。
 *
 * ⚠ **R4**：**预检不是审批的替代，是审批的输入** —— 晋升本身仍是人工审批动作（后端 requireAdmin）。
 *    预检只把「真写会发生什么」提前算出来给人看，一个字节都不写（后端 `promote-precheck.test.ts`
 *    用全表指纹咬死）。
 *
 * 三类冲突**分开显示**，绝不合成一个「N 条冲突」——「会改掉既有定义」与「写了个一样的」
 * 危险度差一个量级，合成即让人无法裁决。
 */

const LABEL: CSSProperties = { fontSize: 12, color: "var(--muted)" };
const CARD: CSSProperties = { border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px", marginBottom: 6 };

/** 动作词表**复用** `ReconcileAction`（不另发明一套）；屏上给人话。 */
const ACTION_TEXT: Partial<Record<ReconcileAction, string>> = {
  USE: "沿用库里既有的（不动它）",
  MERGE: "用这次的定义覆盖它",
  RENAME: "改名新建",
  NEW: "另建一个",
  DISCARD: "丢弃本次的",
};

function ConflictCard({ c, decision, onDecide }: { c: PromoteConflict; decision?: ReconcileAction; onDecide: (a: ReconcileAction) => void }) {
  const reg = PROMOTE_CONFLICT_REGISTRY.find((r) => r.kind === c.kind);
  const fields = [...new Set([...Object.keys(c.existingValue), ...Object.keys(c.incomingValue)])];
  return (
    <div data-testid={`dbf-conflict-${c.key}`} data-kind={c.kind} style={CARD}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
        <b className="mono">{c.key}</b>
        <span className="badge" style={{ fontSize: 12 }}>{reg?.label ?? c.kind}</span>
        {c.requiresDecision && (
          <span className="badge" data-testid={`dbf-conflict-blocking-${c.key}`} style={{ fontSize: 12, color: "var(--danger-txt, #b4232a)" }}>
            必须你来定，否则不给入库
          </span>
        )}
      </div>
      {reg && <div style={{ ...LABEL, marginTop: 2 }}>你不选的话会发生：{reg.defaultBehavior}</div>}
      <table className="cmp" style={{ fontSize: 12, marginTop: 6 }}>
        <thead><tr><th></th><th>库里现在是</th><th>这次要写成</th></tr></thead>
        <tbody>
          {fields.map((f) => {
            const changed = c.changedFields.includes(f);
            return (
              <tr key={f} data-testid={`dbf-conflict-row-${c.key}-${f}`}>
                <td>{f}</td>
                <td style={{ color: changed ? "var(--danger-txt, #b4232a)" : "inherit" }}>{c.existingValue[f] ?? "—"}</td>
                <td style={{ color: changed ? "var(--c-capacity-txt, #1d7a68)" : "inherit" }}>
                  {c.incomingValue[f] ?? "—"}{changed ? "（不一样）" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        <span style={LABEL}>建议：{ACTION_TEXT[c.suggestedAction] ?? c.suggestedAction}</span>
        {c.availableActions.map((a) => (
          <button
            key={a}
            className={`btn sm${decision === a ? " primary" : ""}`}
            data-testid={`dbf-decide-${c.key}-${a}`}
            onClick={() => onDecide(a)}
          >
            {ACTION_TEXT[a] ?? a}
          </button>
        ))}
        {decision && <span style={{ fontSize: 12, color: "var(--c-capacity-txt, #1d7a68)" }}>已选：{ACTION_TEXT[decision] ?? decision}</span>}
      </div>
    </div>
  );
}

export function PromotePrecheckPanel({ run, onDownload }: { run: StoryBuildRun; onDownload: () => void }) {
  const qc = useQueryClient();
  const [pc, setPc] = useState<PromotePrecheck | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ReconcileAction>>({});

  const checkM = useMutation({
    mutationFn: () => promotePrecheck(run.id),
    onSuccess: (r) => setPc(r),
    onError: (e) => toastError(e as Error),
  });
  const promoteM = useMutation({
    mutationFn: (ds: PromoteDecision[]) => promoteStoryDomain(run.id, ds),
    onSuccess: (r) => {
      const p = r.domainPromotion;
      toast(
        `已入库：迁入 ${p?.migratedObjects ?? 0} 个对象 / ${p?.migratedDatasets ?? 0} 张原始表` +
          (p?.reusedTypeKeys?.length ? ` · 复用既有类型 ${p.reusedTypeKeys.length} 个` : "") +
          (p?.keptLinkKeys?.length ? ` · 保留既有关系 ${p.keptLinkKeys.length} 条` : ""),
        "success",
      );
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
      void qc.invalidateQueries({ queryKey: ["a", "story-run", run.id] });
      void qc.invalidateQueries({ queryKey: ["a", "object-types"] });
    },
    onError: (e) => toastError(e as Error),
  });

  const governed = run.domainTrustLevel === "GOVERNED";
  const pending = pc ? pc.conflicts.filter((c) => c.requiresDecision && !decisions[`${c.target}:${c.key}`]).length : 0;
  const submit = () =>
    promoteM.mutate(
      Object.entries(decisions).map(([k, action]) => {
        const [target, ...rest] = k.split(":");
        return { target: target as PromoteDecision["target"], key: rest.join(":"), action };
      }),
    );

  if (governed) {
    return (
      <div data-testid="dbf-promoted" style={{ marginTop: 6, fontSize: 13 }}>
        <span className="badge green">已入库</span>{" "}
        迁入 {run.domainPromotion?.migratedObjects ?? 0} 个对象 / {run.domainPromotion?.migratedDatasets ?? 0} 张原始表
        {run.domainPromotion?.reusedTypeKeys?.length ? ` · 复用了库里既有的 ${run.domainPromotion.reusedTypeKeys.join("、")}` : ""}
        {run.domainPromotion?.keptLinkKeys?.length ? ` · 按你的裁决保留了既有关系 ${run.domainPromotion.keptLinkKeys.join("、")}` : ""}
        {run.domainPromotion?.overwrittenLinkKeys?.length ? ` · 经你批准覆盖了关系 ${run.domainPromotion.overwrittenLinkKeys.join("、")}` : ""}
        <div style={{ marginTop: 6 }}>
          <button className="btn sm" data-testid="dbf-download" onClick={onDownload} disabled={!run.buildPlan}>下载构建计划</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6 }} data-testid="dbf-commit">
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" data-testid="dbf-precheck" disabled={checkM.isPending} onClick={() => checkM.mutate()}>
          {checkM.isPending ? "复验中…" : "复验一下再说"}
        </button>
        <span style={LABEL}>
          拿库里<b>当下</b>的状态现算一遍，看这次入库会和什么撞上。只看不写。
        </span>
      </div>

      {pc && (
        <div data-testid="dbf-precheck-result" style={{ marginTop: 8 }}>
          {/* 三类**分开**计数，绝不给一个合计数 */}
          <div style={{ fontSize: 13, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span data-testid="dbf-count-type">对象类型同名：<b>{pc.counts.typeSameKey}</b></span>
            <span data-testid="dbf-count-linkdiff">关系同名但定义不同：<b style={{ color: pc.counts.linkSameKeyDiffDef ? "var(--danger-txt, #b4232a)" : "inherit" }}>{pc.counts.linkSameKeyDiffDef}</b></span>
            <span data-testid="dbf-count-linksame">关系同名且定义一样：<b>{pc.counts.linkSameKeySameDef}</b></span>
            <span style={LABEL}>其余干净可迁：{pc.clean.objectTypes} 个类型 / {pc.clean.linkTypes} 条关系</span>
          </div>

          {/* 建域后世界变了没有：T1（建的时候）vs T2（现在） */}
          {pc.drift.changed && (
            <div data-testid="dbf-drift" style={{ marginTop: 8, fontSize: 13, color: "var(--amber-txt, #8a5a1e)" }}>
              ⚠ 建完之后库里变过了。变在这些地方：
              <ul style={{ margin: "2px 0 0", fontSize: 12 }}>
                {pc.drift.diffs.map((d, i) => (
                  <li key={i}>{d.dim === "gap" ? "比对现状" : "闭包判定"} · {d.field}：建的时候 {d.atBuild} → 现在 {d.atPrecheck}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            {pc.conflicts.length === 0 ? (
              <div style={{ fontSize: 13 }} data-testid="dbf-no-conflict">没有撞上任何既有数据，可以直接入库。</div>
            ) : (
              pc.conflicts.map((c) => (
                <ConflictCard
                  key={`${c.target}:${c.key}`}
                  c={c}
                  decision={decisions[`${c.target}:${c.key}`]}
                  onDecide={(a) => setDecisions((d) => ({ ...d, [`${c.target}:${c.key}`]: a }))}
                />
              ))
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn primary" data-testid="dbf-promote" disabled={promoteM.isPending || pending > 0} onClick={submit}>
          {promoteM.isPending ? "入库中…" : "确认入库"}
        </button>
        <button className="btn" data-testid="dbf-download" onClick={onDownload} disabled={!run.buildPlan}>
          下载构建计划
        </button>
        {pending > 0 && (
          <span data-testid="dbf-pending-decisions" style={{ fontSize: 12, color: "var(--danger-txt, #b4232a)" }}>
            还有 {pending} 处要你先定怎么处理，才能入库。
          </span>
        )}
        {!pc && <span style={LABEL}>建议先复验一遍再入库。</span>}
      </div>
    </div>
  );
}
