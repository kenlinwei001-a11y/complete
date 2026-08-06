import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ConfigBundle, ImportConflictPolicy, ImportJob, ImportJobState } from "@platform/contracts";
import { exportConfigBundle, importConfigBundle } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";

/**
 * C12 环境间配置迁移工作台（/admin/config-migration · OC3 跨系统 Saga）。
 * 导出本租户配置 bundle（功能开通 overrides + AgentCore 侧） → 另一环境导入：
 *  - 干跑（dryRun）：止于 DRY_RUN_OK，只产 diff（added/changed=冲突/same），零写。
 *  - 应用：跑完整 Saga（VALIDATING→APPLYING_A〔DataCore〕→APPLYING_B〔AgentCore〕→COMMITTED；
 *    B 段失败 → COMPENSATING→COMPENSATED 回滚 A）。冲突策略 SKIP/OVERWRITE/FAIL。
 * 前端 over 既有端点（/a/v1/config-bundles/{export,import}），无新契约/后端。admin only。
 */

/** Saga 状态机各阶段（顺序 + 终态标记），用于进度可视。 */
const SAGA_STAGES: { state: ImportJobState; label: string }[] = [
  { state: "VALIDATING", label: "校验（schema/feature 键）" },
  { state: "DRY_RUN_OK", label: "干跑通过（diff 就绪）" },
  { state: "APPLYING_A", label: "应用 A 段（DataCore 功能开通）" },
  { state: "APPLYING_B", label: "应用 B 段（AgentCore 跨系统）" },
  { state: "COMMITTED", label: "已提交（Saga 一致）" },
];
const TERMINAL: ImportJobState[] = ["COMMITTED", "COMPENSATED", "FAILED"];
const STATE_BADGE: Record<ImportJobState, string> = {
  VALIDATING: "", DRY_RUN_OK: "blue", APPLYING_A: "blue", APPLYING_B: "blue",
  COMMITTED: "green", COMPENSATING: "amber", COMPENSATED: "amber", FAILED: "red",
};

export default function ConfigMigrationPage() {
  const [bundleText, setBundleText] = useState("");
  const [policy, setPolicy] = useState<ImportConflictPolicy>("OVERWRITE");
  const [job, setJob] = useState<ImportJob | null>(null);

  const exportMut = useMutation({
    mutationFn: exportConfigBundle,
    onSuccess: (b) => {
      setBundleText(JSON.stringify(b, null, 2));
      toast("已导出本租户配置 bundle", "success");
    },
    onError: toastError,
  });

  const parsedBundle = useMemo<ConfigBundle | null>(() => {
    try {
      const b = JSON.parse(bundleText) as ConfigBundle;
      if (typeof b !== "object" || b === null || typeof b.platformSchemaVersion !== "string") return null;
      return b;
    } catch {
      return null;
    }
  }, [bundleText]);

  const importMut = useMutation({
    mutationFn: ({ dryRun }: { dryRun: boolean }) => importConfigBundle(parsedBundle!, dryRun, policy),
    onSuccess: (j) => {
      setJob(j);
      if (j.state === "FAILED") toast(`导入失败：${j.error ?? j.state}`, "error");
      else if (j.state === "COMPENSATED") toast("B 段失败 → A 段已补偿回滚（Saga 一致）", "error");
      else if (j.state === "COMMITTED") toast("配置已提交到目标环境", "success");
      else toast(`干跑完成：${j.state}`, "success");
    },
    onError: toastError,
  });

  const downloadBundle = () => {
    if (!bundleText) return;
    const blob = new Blob([bundleText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `config-bundle-${parsedBundle?.sourceTenantId ?? "export"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setBundleText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const diff = job?.diff;

  return (
    <div data-testid="config-migration-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>配置迁移工作台</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        导出本租户配置 bundle → 另一环境导入：先干跑看 diff/冲突，再应用跑跨系统 Saga（A 段 DataCore 功能开通 → B 段 AgentCore；B 失败自动补偿回滚 A）。
      </div>

      {/* 导出 */}
      <div className="section-title">① 导出（本环境 → bundle）</div>
      <div className="panel" style={{ marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn primary sm" data-testid="cfg-export" disabled={exportMut.isPending} onClick={() => exportMut.mutate()}>
          {exportMut.isPending ? "导出中…" : "导出本租户配置"}
        </button>
        <button className="btn sm" data-testid="cfg-download" disabled={!bundleText} onClick={downloadBundle}>
          下载 bundle.json
        </button>
        <span className="muted" style={{ fontSize: 11 }}>
          {parsedBundle ? `schema ${parsedBundle.platformSchemaVersion} · 源租户 ${parsedBundle.sourceTenantId} · ${Object.keys(parsedBundle.featureOverrides ?? {}).length} 项功能开通` : "（先导出或粘贴 bundle）"}
        </span>
      </div>

      {/* 导入 */}
      <div className="section-title">② 导入（bundle → 目标环境，先干跑）</div>
      <div className="panel" style={{ marginBottom: 14, display: "grid", gap: 8 }}>
        <textarea
          data-testid="cfg-bundle-text"
          value={bundleText}
          onChange={(e) => setBundleText(e.target.value)}
          placeholder="粘贴配置 bundle JSON，或上方导出 / 下方上传文件"
          style={{ width: "100%", minHeight: 140, fontFamily: "monospace", fontSize: 11 }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label className="btn sm" style={{ cursor: "pointer" }}>
            上传 bundle 文件
            <input type="file" accept="application/json,.json" data-testid="cfg-upload" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          <label style={{ fontSize: 12 }}>
            冲突策略{" "}
            <select data-testid="cfg-policy" value={policy} onChange={(e) => setPolicy(e.target.value as ImportConflictPolicy)}>
              <option value="OVERWRITE">OVERWRITE（覆盖）</option>
              <option value="SKIP">SKIP（跳过冲突键）</option>
              <option value="FAIL">FAIL（有冲突即拒）</option>
            </select>
          </label>
          {!parsedBundle && bundleText && <span className="badge red" data-testid="cfg-parse-err">bundle JSON 无效</span>}
          <button className="btn sm" data-testid="cfg-dry-run" disabled={importMut.isPending || !parsedBundle} onClick={() => importMut.mutate({ dryRun: true })}>
            干跑（dry-run diff）
          </button>
          <button className="btn primary sm" data-testid="cfg-apply" disabled={importMut.isPending || !parsedBundle} onClick={() => importMut.mutate({ dryRun: false })}>
            应用（跑 Saga）
          </button>
        </div>
      </div>

      {/* Saga 状态 + diff */}
      {job && (
        <div className="panel" data-testid="cfg-job-result" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span className={`badge ${STATE_BADGE[job.state]}`} data-testid="cfg-job-state">{job.state}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted2)" }}>{job.id} · {job.dryRun ? "干跑" : "应用"} · {job.conflictPolicy}</span>
          </div>

          {/* Saga 阶段进度（应用模式才显完整链；干跑止于 DRY_RUN_OK） */}
          {!job.dryRun && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }} data-testid="cfg-saga-stages">
              {SAGA_STAGES.map((s) => {
                const idx = SAGA_STAGES.findIndex((x) => x.state === s.state);
                const cur = SAGA_STAGES.findIndex((x) => x.state === job.state);
                const reached = TERMINAL.includes(job.state) ? job.state === "COMMITTED" || idx <= 1 : idx <= cur;
                const done = job.state === "COMMITTED" || (cur > idx && cur >= 0);
                return (
                  <span key={s.state} className={`badge ${done ? "green" : reached ? "blue" : ""}`} style={{ fontSize: 10 }}>
                    {done ? "✓ " : ""}{s.label}
                  </span>
                );
              })}
              {(job.state === "COMPENSATING" || job.state === "COMPENSATED") && (
                <span className="badge amber" style={{ fontSize: 10 }} data-testid="cfg-compensated">↩ 补偿回滚 A 段</span>
              )}
            </div>
          )}

          {job.error && <div className="badge red" style={{ marginBottom: 8 }} data-testid="cfg-job-error">{job.error}</div>}

          {diff && (
            <div data-testid="cfg-diff">
              <div className="section-title">配置 diff（vs 目标环境当前）</div>
              {/* WO-UNIT-MEANING：三个 diff 数此前裸奔——数的是 **featureOverrides 的功能开关条目数**（同页上方
                  「N 项功能开通」同口径）。契约 config-bundle.ts 的 added/changed/same 是 key 数组（无 unit），故就近点明"项功能开关"。 */}
              <div style={{ display: "flex", gap: 16, fontSize: 12, marginBottom: 6 }}>
                <span>新增功能开关 <b data-testid="cfg-diff-added">{diff.featureOverrides.added.length}</b> 项</span>
                <span>变更/冲突 <b data-testid="cfg-diff-changed" style={{ color: diff.conflicts.length > 0 ? "var(--amber)" : undefined }}>{diff.featureOverrides.changed.length}</b> 项</span>
                <span>不变 <b>{diff.featureOverrides.same.length}</b> 项</span>
              </div>
              {diff.featureOverrides.added.length > 0 && (
                <div style={{ fontSize: 11, marginBottom: 4 }}>
                  <span className="badge green">新增</span> {diff.featureOverrides.added.map((k) => <span key={k} className="mono" style={{ marginRight: 6 }}>{k}</span>)}
                </div>
              )}
              {diff.featureOverrides.changed.length > 0 && (
                <div style={{ fontSize: 11 }}>
                  <span className="badge amber">冲突</span>{" "}
                  {diff.featureOverrides.changed.map((c) => (
                    <span key={c.key} className="mono" style={{ marginRight: 8 }}>{c.key}：{String(c.from)}→{String(c.to)}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
