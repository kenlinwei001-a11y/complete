import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchSolverCategories,
  fetchSolverFieldRoles,
  fetchSolverRegistry,
  type SolverCatalogItem,
} from "@/api/endpoints";
import ReferencesPanel from "@/components/ReferencesPanel";
import { InfoPopover } from "@/components/InfoPopover";
import zh from "@/locales/zh";

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
  /** WO-BEFE-E：展开哪一条求解器的「牵连与接地」（一次只开一条 —— 两条端点各一次请求，不做全表预取）。 */
  const [openKey, setOpenKey] = useState<string | null>(null);
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
      {/*
        WO-BEFE-CLEANUP · 信息分层（规范 §1 / §2 R-UI-3）。
        「这一页的数据从哪来 / 谁引用它 / 怎么新增」是**数据来源与口径**，规范归浮层；
        第一层留页名与下方的**计数、名字、状态**。`?` 常驻可见即降层记号，内容一字未删。
      */}
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>
        求解器目录
        <InfoPopover topic={zh.admin.layer.solversSourceTopic} testId="solvers-source">
          <p>{zh.admin.layer.solversSourceBody}</p>
          <p>
            工作流步骤 invoke_solver 的 solverKey 引用此目录。<b>如需新增求解器，请联系实施。</b>
          </p>
        </InfoPopover>
      </h2>

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
          {/* 计数留第一层（规范 §1：结论性数字不许只藏在浮层里）；**归类判据**是口径，降 `?`。 */}
          <div className="section-title">
            按决策问题找求解器（{nonEmptyCategories.length} 类 · 共 {categoryReg.total} 个求解器）
            <InfoPopover topic={zh.admin.layer.solversTaxonomyTopic} testId="solvers-taxonomy">
              <p>{zh.admin.layer.solversTaxonomyBody}</p>
              <p>所以同一句问话下可能既有 CP-SAT 也有启发式。</p>
            </InfoPopover>
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
              <tr><th style={{ width: 180 }}>key</th><th style={{ width: 130 }}>名称</th><th>描述</th><th style={{ width: 200 }}>参数提示</th><th style={{ width: 160 }}>输出形状</th><th style={{ width: 96 }}></th></tr>
            </thead>
            <tbody>
              {items.map((s) => (
                // Fragment 必须带 key（裸 `<>` 在 map 里会掉 key → React 警告 + 重排时行状态错位）
                <Fragment key={s.key}>
                  <tr data-testid={`solver-row-${s.key}`}>
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
                    <td>
                      {/* WO-BEFE-E：第二层（点一次才出）——牵连与接地各一次请求，不做全表预取。 */}
                      <button
                        type="button"
                        className="btn sm ghost"
                        data-testid={`solver-detail-toggle-${s.key}`}
                        onClick={() => setOpenKey((k) => (k === s.key ? null : s.key))}
                      >
                        {openKey === s.key ? "收起" : "牵连与接地"}
                      </button>
                    </td>
                  </tr>
                  {openKey === s.key && (
                    <tr>
                      <td colSpan={6} style={{ background: "var(--panel2, rgba(0,0,0,.12))" }}>
                        <SolverImpactPanel solverKey={s.key} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {solvers.length === 0 && (
        <div className="empty-state" data-testid="solvers-empty">
          {/* 空是**真值**不是故障 ⇒ 状态词留第一层；「为什么空 / 怎么才有」降 `?`。 */}
          暂无可见求解器
          <InfoPopover topic={zh.admin.layer.solversEmptyTopic} testId="solvers-empty-why">
            <p>{zh.admin.layer.solversEmptyBody}</p>
          </InfoPopover>
        </div>
      )}
    </div>
  );
}

/**
 * WO-BEFE-E · 某个求解器的「牵连与接地」（两条端点此前前端零调用）：
 *
 *   `GET /b/v1/solvers/:key/references`   agentcore `server.ts:1270` —— **改它会波及谁**
 *   `GET /a/v1/solvers/:key/field-roles`  datacore  `app.ts:3609`    —— **它在本租户本体里绑到哪**
 *
 * ── 为什么这两条摆在一起 ────────────────────────────────────────────────────
 * 求解器目录页此前只回答「有哪些求解器、吃什么参数、吐什么形状」——全是**静态注册表**信息。
 * 一个真要动它的人还缺两件事：**动了谁会疼**（引用反查）、**它在我这套本体上落到哪个类型/字段**
 * （A13 地板语义）。两条端点后端都写好了，前端一条都没接。
 * 同族的 `/a/v1/rules/:id/references` 早有前端调用方，求解器这条曾被落下（WO-BEFE-E 补上）。
 *
 * ── WO-REFERENCES-FAMILY 改造 ───────────────────────────────────────────────
 * 「改它会波及谁」这半块**原本是本页自己写的一份**。实测这一族后端共 13 条 `/references` 端点、
 * B 侧 7 条由同一个 `computeReferences` 支撑 —— 每页各写一份，必然长出 N 套形态不同的引用面板。
 * 故此处换成共享件 `<ReferencesPanel>`：**本页不再持有引用反查的任何实现**。
 * 剩下的「绑到哪」（field-roles）是求解器独有的，与引用族无关，仍留在本页。
 *
 * ── 诚实边界 ────────────────────────────────────────────────────────────────
 * · 只有 4 个通用图求解器在后端 `SOLVER_FIELD_ROLES` 里声明了角色；其余返回**空 roles**。
 *   那不是错，是「这个求解器不吃角色」—— 屏上明写这一句，**不画一块空面板**假装有内容。
 * · `count:0` 与「查不出来」必须分得开：前者是真的没人引用（可以放心改），
 *   后者是这次没查到（不能据此说"随便改"）。塌成一个 0 就是把风险藏起来。
 *   这条诚实位现在由 `<ReferencesPanel>` 统一守，全族一处实现。
 */
function SolverImpactPanel({ solverKey }: { solverKey: string }) {
  const roles = useQuery({
    queryKey: ["a", "solver-field-roles", solverKey],
    queryFn: () => fetchSolverFieldRoles(solverKey),
    retry: false,
  });
  const roleKeys = Object.keys(roles.data?.roles ?? {});

  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }} data-testid={`solver-impact-${solverKey}`}>
      <ReferencesPanel kind="solver" id={solverKey} />

      <div>
        {/* 区块名留第一层；解析口径（A13 地板语义 · 确定性无 LLM）降 `?`。 */}
        <b style={{ fontSize: 12 }}>
          字段角色绑定
          <InfoPopover topic={zh.admin.layer.solversRolesTopic} testId={`solver-roles-info-${solverKey}`}>
            <p>{zh.admin.layer.solversRolesBody}</p>
          </InfoPopover>
        </b>
        {roles.isError ? (
          <div className="muted" style={{ fontSize: 12 }} data-testid={`solver-roles-error-${solverKey}`}>
            这次没查出来（后端不可达）——不是「没有绑定」。
          </div>
        ) : roles.isLoading ? (
          <div className="muted" style={{ fontSize: 12 }}>解析中…</div>
        ) : roleKeys.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }} data-testid={`solver-roles-none-${solverKey}`}>
            这个求解器不吃角色（后端 SOLVER_FIELD_ROLES 未为它声明）——不是解析失败。
          </div>
        ) : (
          <div style={{ fontSize: 12 }} data-testid={`solver-roles-${solverKey}`}>
            {roleKeys.map((role) => (
              <div key={role}>
                <span className="mono">{role}</span> → <b className="mono" data-testid={`solver-role-${solverKey}-${role}`}>{roles.data!.roles[role]}</b>
                <span className="muted" style={{ marginLeft: 6 }}>
                  候选 {(roles.data!.candidates[role] ?? []).map((c) => `${c.value}(${c.score})`).join("、") || "—"}
                </span>
              </div>
            ))}
            {/*
              真歧义**必须亮在第一层** —— 这条不许降：徽标变琥珀 +「真歧义」三个字都是状态，
              规范 §1 允许留在第一层。降下去的只有「为什么叫真歧义」那句口径。
            */}
            <div style={{ marginTop: 3 }}>
              <span className={`badge ${roles.data!.ambiguous ? "amber" : ""}`} data-testid={`solver-roles-confidence-${solverKey}`}>
                置信度 {roles.data!.confidence.toFixed(2)}{roles.data!.ambiguous ? " · 真歧义" : ""}
              </span>
              {roles.data!.ambiguous && (
                <InfoPopover topic={zh.admin.layer.solversAmbiguousTopic} testId={`solver-roles-ambiguous-${solverKey}`}>
                  <p>{zh.admin.layer.solversAmbiguousBody}</p>
                </InfoPopover>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
