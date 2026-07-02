import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchSolverRegistry,
  fetchSolverBindings,
  activateSolverBinding,
  suggestSolverBindings,
  type SolverCatalogItem,
} from "@/api/endpoints";
import type { SolverBinding } from "@platform/contracts";

/**
 * C5 求解器目录页（/admin/solvers · 只读发现 + WO-SOLVER-BINDING-UI 绑定层可见/激活）。
 * workflow 步骤 invoke_solver 的 solverKey 下拉数据源（C6 闭合的"查看"目标）。
 * 数据来自注册表 `/a/v1/solvers/registry`（业务场景 22 + 通用 9 + 决策 8，feature 过滤；R5 零业务常数）。
 * 合法的"不可自助创建但可见"边界（addendum §4）：求解器由平台代码注册，非用户创建——显式声明而非留死路。
 *
 * WO-SOLVER-BINDING-UI（G-17 命门前端·G-VIS-1）：每行可展开显该求解器 SolverBinding 绑定层
 * （role→租户真实类型/字段·DRAFT/ACTIVE 徽章）。上传/合成自有类型经"建议绑定"产 DRAFT 草案 →
 * 人工"激活"→ ACTIVE 生效于 resolveSolverType → 该求解器读自有类型出真答案。此前只能 curl（G-VIS-1）。
 */
export default function SolversPage() {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "solver-registry"], queryFn: () => fetchSolverRegistry() });
  const solvers = data?.solvers ?? [];

  const suggest = useMutation({
    mutationFn: () => suggestSolverBindings(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["a", "solver-bindings"] }),
  });

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return solvers;
    return solvers.filter(
      (s) => s.key.toLowerCase().includes(k) || s.name.toLowerCase().includes(k) || s.description.toLowerCase().includes(k),
    );
  }, [solvers, q]);

  const byDomain = useMemo(() => {
    const m = new Map<string, SolverCatalogItem[]>();
    for (const s of filtered) {
      const d = s.domain ?? "其它";
      (m.get(d) ?? m.set(d, []).get(d)!).push(s);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [filtered]);

  return (
    <div data-testid="solvers-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>求解器目录</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
        求解器由平台代码注册（非用户创建），此页只读发现：key / 名称 / 描述 / 参数提示 / 输出形状。
        点行展开可见该求解器的<b>本体绑定层</b>（role→租户真实类型/字段·G-17）。工作流步骤 invoke_solver 的 solverKey 引用此目录。<b>如需新增求解器，请联系实施。</b>
      </div>

      <div className="panel" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <input
          data-testid="solver-search"
          placeholder="搜索求解器（key/名称/描述）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        {/* WO-SOLVER-BINDING-UI：一键在本租户已发布本体上产 DRAFT 绑定草案（确定性词表·RL4 不自动生效）。 */}
        <button className="btn sm" data-testid="solver-binding-suggest" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
          {suggest.isPending ? "建议中…" : "建议绑定（生成草案）"}
        </button>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>共 {solvers.length} 个 · 命中 {filtered.length}</span>
      </div>
      {suggest.isSuccess && (
        <div className="badge blue" data-testid="solver-binding-suggest-result" style={{ marginBottom: 10 }}>
          已生成 {suggest.data.suggested} 条 DRAFT 草案 · 展开对应求解器点「激活」使其生效
        </div>
      )}
      {suggest.isError && (
        <div className="badge red" data-testid="solver-binding-suggest-error" style={{ marginBottom: 10 }}>
          建议失败：{String((suggest.error as Error)?.message ?? "未知错误")}
        </div>
      )}

      {byDomain.map(([domain, items]) => (
        <div key={domain} style={{ marginBottom: 14 }}>
          <div className="section-title">
            {domain === "plan" ? "规划/场景" : domain === "generic" ? "通用（净室/CP-SAT）" : domain === "decision" ? "决策驾驶舱" : domain}（{items.length}）
          </div>
          <table className="cmp" style={{ width: "100%" }}>
            <thead>
              <tr><th style={{ width: 28 }}></th><th style={{ width: 170 }}>key</th><th style={{ width: 130 }}>名称</th><th>描述</th><th style={{ width: 190 }}>参数提示</th><th style={{ width: 150 }}>输出形状</th></tr>
            </thead>
            <tbody>
              {items.map((s) => {
                const open = expanded === s.key;
                return (
                  <Fragment key={s.key}>
                    <tr data-testid={`solver-row-${s.key}`} style={{ cursor: "pointer" }} onClick={() => setExpanded(open ? null : s.key)}>
                      <td data-testid={`solver-expand-${s.key}`} style={{ textAlign: "center", color: "var(--muted)" }}>{open ? "▾" : "▸"}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{s.key}</td>
                      <td>{s.name}</td>
                      <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{s.description}</td>
                      <td style={{ fontSize: 11 }}>
                        {Object.keys(s.argHints).length === 0
                          ? <span className="muted">（无参数）</span>
                          : Object.entries(s.argHints).map(([k, v]) => (
                              <div key={k}><span className="mono">{k}</span>：{v}</div>
                            ))}
                      </td>
                      <td>
                        {s.outputShape.length > 0
                          ? s.outputShape.map((f) => <span key={f} className="badge" style={{ marginRight: 4 }}>{f}</span>)
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                    {open && (
                      <tr data-testid={`solver-bindings-row-${s.key}`}>
                        <td></td>
                        <td colSpan={5} style={{ background: "var(--panel2,rgba(255,255,255,.02))", padding: "8px 10px" }}>
                          <SolverBindingPanel solverKey={s.key} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {solvers.length === 0 && (
        <div className="empty-state" data-testid="solvers-empty">
          暂无可见求解器（求解器由平台提供，按 feature 开通显隐；如需新增请联系实施）。
        </div>
      )}
    </div>
  );
}

/**
 * 展开区：某求解器的 SolverBinding 绑定层（role→typeKey/fieldMap·DRAFT/ACTIVE）+ 激活草案按钮。
 * 无绑定 → 诚实空态（求解器回退 canonical 默认类型·向后兼容）。
 */
function SolverBindingPanel({ solverKey }: { solverKey: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["a", "solver-bindings", solverKey],
    queryFn: () => fetchSolverBindings(solverKey),
  });
  const activate = useMutation({
    mutationFn: (id: string) => activateSolverBinding(solverKey, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["a", "solver-bindings", solverKey] }),
  });
  const bindings = data?.items ?? [];

  if (isLoading) return <div className="muted" style={{ fontSize: 11.5 }}>加载绑定…</div>;
  if (isError) return <div className="badge red" style={{ fontSize: 11 }}>绑定读取失败</div>;
  if (bindings.length === 0) {
    return (
      <div className="muted" data-testid={`solver-bindings-empty-${solverKey}`} style={{ fontSize: 11.5 }}>
        无本体绑定 —— 该求解器回退 canonical 默认类型（向后兼容·demo 零绑定零回归）。
        上传/合成自有类型后点上方「建议绑定」生成 DRAFT 草案，再于此激活。
      </div>
    );
  }
  return (
    <div data-testid={`solver-bindings-${solverKey}`}>
      {bindings.map((b: SolverBinding) => (
        <div key={b.id} data-testid={`solver-binding-${b.id}`} style={{ borderTop: "1px solid var(--line2,#2a2a2a)", padding: "6px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span
              className={`badge ${b.status === "ACTIVE" ? "green" : "amber"}`}
              data-testid={`solver-binding-status-${b.id}`}
            >
              {b.status}
            </span>
            <span className="muted" style={{ fontSize: 10.5 }}>{b.origin === "auto-suggest" ? "自动草案" : "人工"}</span>
            {b.status === "DRAFT" && (
              <button
                className="btn sm primary"
                data-testid={`solver-binding-activate-${b.id}`}
                disabled={activate.isPending}
                onClick={() => activate.mutate(b.id)}
              >
                {activate.isPending ? "激活中…" : "激活草案"}
              </button>
            )}
          </div>
          <table className="cmp" style={{ width: "auto" }} data-testid={`solver-binding-roles-${b.id}`}>
            <thead>
              <tr><th style={{ width: 110 }}>role</th><th style={{ width: 150 }}>→ 真实类型</th><th>字段映射</th></tr>
            </thead>
            <tbody>
              {b.roleBindings.map((r) => (
                <tr key={r.role} data-testid={`solver-binding-role-${b.id}-${r.role}`}>
                  <td className="mono" style={{ fontSize: 11 }}>{r.role}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{r.typeKey}</td>
                  <td style={{ fontSize: 11 }}>
                    {r.fieldMap && Object.keys(r.fieldMap).length > 0
                      ? Object.entries(r.fieldMap).map(([cf, tf]) => (
                          <span key={cf} className="badge" style={{ marginRight: 4 }}>
                            <span className="mono">{cf}</span>→<span className="mono">{tf}</span>
                          </span>
                        ))
                      : <span className="muted">（字段名一致）</span>}
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
