import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSolverCategories, fetchSolverRegistry, type SolverCatalogItem } from "@/api/endpoints";

/**
 * C5 求解器目录页（/admin/solvers · 只读发现）。
 * workflow 步骤 invoke_solver 的 solverKey 下拉数据源（C6 闭合的"查看"目标）。
 * 数据来自注册表 `/a/v1/solvers/registry`（业务场景 22 + 通用 9 + 决策 8，feature 过滤；R5 零业务常数）。
 * 合法的"不可自助创建但可见"边界（addendum §4）：求解器由平台代码注册，非用户创建——显式声明而非留死路。
 */
/** 求解器分类（domain 真元数据）显示名：业务场景/通用/决策/产品。 */
const domainLabel = (d: string) =>
  d === "plan" ? "规划/场景" : d === "generic" ? "通用（净室/CP-SAT）" : d === "decision" ? "决策驾驶舱" : d === "product" ? "产品/型号" : d;

export default function SolversPage() {
  const [q, setQ] = useState("");
  // WO-RULES-CLASSIFY：求解器按类别（domain）可筛选。chip 列表由注册表返回数据去重生成（非写死），选中即过滤。
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const { data } = useQuery({ queryKey: ["a", "solver-registry"], queryFn: () => fetchSolverRegistry() });
  const solvers = data?.solvers ?? [];

  /**
   * WO-UNBLOCK-SKILL-FE · 决策问题类目登记表（`GET /a/v1/solvers/categories`）。
   *
   * ⚠️ 与上面的 `domain` 是**两个不同的维**，故并排两块、各自成块，**不合并**：
   *  · `domain`（4 值）回答「这个求解器归哪块业务」——registry 每条自带，用于分组铺表；
   *  · `category`（10 类）回答「我在做什么决策」——本端点独有，带着**决策问句**。
   * 合成一维就是本仓治过的「同一概念两套词表」：两边都能跑，交集为空，谁也不报错。
   *
   * `retry: false`：类目维取不到就整块不渲染（下方 `categories &&`），
   * 不画一个空的类目区让人以为"平台没有分类"。
   */
  const { data: categoryReg } = useQuery({ queryKey: ["a", "solver-categories"], queryFn: fetchSolverCategories, retry: false });
  // 空类目不铺（后端 10 类是全集，本租户 feature 过滤后可能有类目一条求解器都没有）
  const nonEmptyCategories = (categoryReg?.categories ?? []).filter((c) => c.count > 0);

  const domainOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of solvers) m.set(s.domain ?? "其它", (m.get(s.domain ?? "其它") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [solvers]);

  const toggleDomain = (d: string) =>
    setSelectedDomains((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return solvers.filter((s) => {
      if (selectedDomains.length > 0 && !selectedDomains.includes(s.domain ?? "其它")) return false;
      if (!k) return true;
      return s.key.toLowerCase().includes(k) || s.name.toLowerCase().includes(k) || s.description.toLowerCase().includes(k);
    });
  }, [solvers, q, selectedDomains]);

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
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
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
        {/* WO-UNIT-MEANING：「命中 3」此前是裸数——命中几个求解器？几条参数？看不出。计数无 unit 契约可消费，就近点明"个求解器"。 */}
        <span style={{ fontSize: 12, color: "var(--muted)" }} data-testid="solver-count-meta">
          共 {solvers.length} 个求解器 · 当前筛选命中 {filtered.length} 个
        </span>
      </div>

      {/* WO-RULES-CLASSIFY：求解器分类筛选 chip（domain 真元数据去重，多选，选中即过滤）。 */}
      {domainOptions.length > 0 && (
        <div className="panel" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} data-testid="solver-domain-filter">
          <span style={{ fontSize: 12, color: "var(--muted)" }}>按类别筛选：</span>
          {domainOptions.map(([d, n]) => (
            <button
              key={d}
              type="button"
              className={`badge ${selectedDomains.includes(d) ? "blue" : ""}`}
              style={{ cursor: "pointer", border: `1px solid ${selectedDomains.includes(d) ? "var(--accent, #2563eb)" : "var(--border, #ccc)"}` }}
              onClick={() => toggleDomain(d)}
              data-testid={`solver-domain-chip-${d}`}
              aria-pressed={selectedDomains.includes(d)}
            >
              {domainLabel(d)}（{n}）
            </button>
          ))}
          {selectedDomains.length > 0 && (
            <button type="button" className="btn sm" onClick={() => setSelectedDomains([])} data-testid="solver-domain-clear">
              清除
            </button>
          )}
        </div>
      )}

      {/* 决策问题类目（10 类）：按「我在做什么决策」找求解器。与上面的 domain 筛选是两个维，不合并。 */}
      {categoryReg && nonEmptyCategories.length > 0 && (
        <div className="panel" style={{ marginBottom: 12 }} data-testid="solver-category-registry">
          <div className="section-title">按决策问题找求解器（{nonEmptyCategories.length} 类 · 共 {categoryReg.total} 个求解器）</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            归类判据是「它回答的是不是这句问话」，不是「它用了哪种算法」——故同一句问话下可能既有 CP-SAT 也有启发式。
          </div>
          <table className="cmp" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: "18%" }}>类目</th>
                <th style={{ textAlign: "left" }}>这一类回答的决策问题</th>
                <th style={{ textAlign: "left", width: "34%" }}>成员求解器</th>
              </tr>
            </thead>
            <tbody>
              {nonEmptyCategories.map((c) => (
                <tr key={c.category} data-testid="solver-category-row" data-category={c.category}>
                  <td>
                    <span className="badge blue">{c.label}</span>
                    {/* count 点明所数何物（本仓 WO-UNIT-MEANING：裸数看不出数的是什么） */}
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{c.count} 个求解器</div>
                  </td>
                  <td style={{ fontSize: 12, lineHeight: 1.6 }} data-testid="solver-category-question">{c.decisionQuestion}</td>
                  <td>
                    {c.solverKeys.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className="badge mono"
                        style={{ marginRight: 4, marginBottom: 3, cursor: "pointer" }}
                        // 点类目成员即把下方目录搜索框填成该 key —— 类目维与检索维在此接上，不是两张互不相干的表。
                        onClick={() => setQ(k)}
                        data-testid={`solver-category-key-${k}`}
                      >
                        {k}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 未归类：**空数组 = 无漏网**，后端诚实亮出，前端照样亮出，不藏 */}
          {categoryReg.uncategorized.length > 0 && (
            <div style={{ fontSize: 12, marginTop: 8 }} data-testid="solver-category-uncategorized">
              <span className="badge amber">未归类 {categoryReg.uncategorized.length} 个</span>
              <span className="mono muted" style={{ marginLeft: 6 }}>{categoryReg.uncategorized.join("、")}</span>
            </div>
          )}
        </div>
      )}

      {byDomain.map(([domain, items]) => (
        <div key={domain} style={{ marginBottom: 14 }}>
          <div className="section-title">
            {/* WO-UNIT-MEANING：域分组标题括号内此前是裸数，补"个求解器"点明所数何物。 */}
            {domainLabel(domain)}（{items.length} 个求解器）
          </div>
          <table className="cmp" style={{ width: "100%" }}>
            <thead>
              <tr><th style={{ width: 180 }}>key</th><th style={{ width: 130 }}>名称</th><th>描述</th><th style={{ width: 200 }}>参数提示</th><th style={{ width: 160 }}>输出形状</th></tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.key} data-testid={`solver-row-${s.key}`}>
                  <td className="mono" style={{ fontSize: 12 }}>{s.key}</td>
                  <td>{s.name}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{s.description}</td>
                  <td style={{ fontSize: 12 }}>
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
