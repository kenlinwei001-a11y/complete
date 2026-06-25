import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSolverRegistry, type SolverCatalogItem } from "@/api/endpoints";

/**
 * C5 求解器目录页（/admin/solvers · 只读发现）。
 * workflow 步骤 invoke_solver 的 solverKey 下拉数据源（C6 闭合的"查看"目标）。
 * 数据来自注册表 `/a/v1/solvers/registry`（业务场景 22 + 通用 9 + 决策 8，feature 过滤；R5 零业务常数）。
 * 合法的"不可自助创建但可见"边界（addendum §4）：求解器由平台代码注册，非用户创建——显式声明而非留死路。
 */
export default function SolversPage() {
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["a", "solver-registry"], queryFn: () => fetchSolverRegistry() });
  const solvers = data?.solvers ?? [];

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
        工作流步骤 invoke_solver 的 solverKey 引用此目录。<b>如需新增求解器，请联系实施。</b>
      </div>

      <div className="panel" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <input
          data-testid="solver-search"
          placeholder="搜索求解器（key/名称/描述）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>共 {solvers.length} 个 · 命中 {filtered.length}</span>
      </div>

      {byDomain.map(([domain, items]) => (
        <div key={domain} style={{ marginBottom: 14 }}>
          <div className="section-title">
            {domain === "plan" ? "规划/场景" : domain === "generic" ? "通用（净室/CP-SAT）" : domain === "decision" ? "决策驾驶舱" : domain}（{items.length}）
          </div>
          <table className="cmp" style={{ width: "100%" }}>
            <thead>
              <tr><th style={{ width: 180 }}>key</th><th style={{ width: 130 }}>名称</th><th>描述</th><th style={{ width: 200 }}>参数提示</th><th style={{ width: 160 }}>输出形状</th></tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.key} data-testid={`solver-row-${s.key}`}>
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
              ))}
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
