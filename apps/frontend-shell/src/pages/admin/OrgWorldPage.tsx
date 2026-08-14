import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApprovalMatter, ApproverResolution, AuthorityScope, CustomerImportance, OrgPrincipal } from "@platform/contracts";
import { AUTHORITY_SCOPES, CUSTOMER_IMPORTANCE } from "@platform/contracts";
import {
  fetchOrgAuthorities,
  fetchOrgChart,
  fetchOrgDelegations,
  resolveApprovers,
  setOrgAvailability,
} from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { baseRoles } from "@/pages/adminRegistry";
import { toast, toastError } from "@/store/toastStore";

/**
 * WO-BEFE-D · **组织世界**（`/a/v1/org/*` 五条端点此前零前端调用方）。
 *
 * 仓主原话：「真实企业最重要的不是机器，而是人。」这一页回答的就是人侧那半 ——
 * **为什么这个流程现在卡住了**：没人有那么大的额度 / 有额度的那个人不在岗 / 跨基地谁都批不了。
 *
 * ── 五条端点各自落在屏上的哪里（每条都有用户点得到的入口）─────────────────────
 *  · `GET   /a/v1/org/chart`                        → 区①「组织架构」三层（部门/角色/人）
 *  · `GET   /a/v1/org/authorities`                  → 区②「职权与额度」表（authorities + limits）
 *  · `GET   /a/v1/org/delegations`                  → 区③「授权代理」表
 *  · `PATCH /a/v1/org/principals/:id/availability`  → 区① 每个人一枚「在岗/不在岗」开关
 *  · `POST  /a/v1/org/approvers/resolve`            → 区④「谁能批这一单」解析器
 *
 * ── ⛔ R4 红线（真值写入必须经 Action 审批，本页**不绕**）────────────────────────
 * 本页**一个字的业务真值都不写**：
 *  · `approvers/resolve` 是 **POST 但纯读** —— 后端 `org/service.ts:113 resolveApprovers()`
 *    只 `list` 四张表 + 纯函数 `evaluateLimit()`，零 `put`/`insert`（用 POST 只因待批事项
 *    是一个七字段的结构体，塞不进 query string）。它回答「**谁**有权批」，**不代替**任何人批。
 *  · 本页没有任何「批准 / 通过 / 采纳」按钮，也不调 `/a/v1/action-drafts/:id/approve` `…/:id/decision`。
 *    真值写入仍只有 `POST /a/v1/action-drafts` → S2 审批链这一条路（审批中心 `/admin/actions`）。
 *  · 唯一的写操作是 `availability`（在岗状态），它改的是**组织主数据**不是业务真值 ——
 *    而且后端 `org/routes.ts:86` 要 admin/tenant_admin，本页按**同一判据**禁用控件
 *    （不摆一个必然 403 的按钮；后端仍是唯一权威，前端禁用只是不骗人）。
 *
 * ── entitlement ────────────────────────────────────────────────────────────
 * `org.world` 是**真暗发**：`defaultOn:false` **且**列进 `WORLD_DARK_LAUNCH_FEATURES`
 * （battery 模板 = ALL_FEATURE_KEYS 减去暗发集合）⇒ 对 demo 租户**确实是关的**，
 * 五条端点默认 404 `FEATURE_NOT_FOUND`。路由侧 `AdminGuard featureKey="org.world"` 同步 ⇒ 404 页。
 * 开通 = 租户 override（`/admin/features`）。这不是故障，是 R3「功能关闭 = 不存在」。
 */

const SCOPE_LABEL: Record<AuthorityScope, string> = {
  order: "订单",
  investment: "资本投入",
  pricing: "定价",
  procurement: "采购",
  production: "生产",
};
const IMPORTANCE_LABEL: Record<CustomerImportance, string> = {
  normal: "普通",
  key: "重点",
  strategic: "战略",
};

/** 额度的一个维度取 `null` 时的显示：**不设限 ≠ 上限为 0**（混了会把「不看利润率」读成「只批 ≥0%」）。 */
const NO_LIMIT = "不设限";
const numOrDash = (v: number | null, suffix = ""): string => (v === null ? NO_LIMIT : `${v.toLocaleString("zh-CN")}${suffix}`);

export default function OrgWorldPage() {
  const qc = useQueryClient();
  const { data: workspace } = useWorkspace();
  // 后端 `org/routes.ts:86` 的判据逐字同款：`c.roles.some(r => ["admin","tenant_admin"].includes(r.split(":")[0]))`。
  const canWriteAvailability = useMemo(
    () => baseRoles(workspace?.user?.roles ?? []).some((r) => r === "admin" || r === "tenant_admin"),
    [workspace],
  );

  const chartQ = useQuery({ queryKey: ["a", "org-chart"], queryFn: fetchOrgChart });
  const authQ = useQuery({ queryKey: ["a", "org-authorities"], queryFn: fetchOrgAuthorities });
  const delQ = useQuery({ queryKey: ["a", "org-delegations"], queryFn: fetchOrgDelegations });
  const ready = chartQ.isSuccess && authQ.isSuccess && delQ.isSuccess;

  // 解析结果留在本地态：它是「某一次按下按钮的答案」，不是一份可缓存的资源
  // （同一个 URL 不同 body 得到不同答案，塞进 react-query 缓存反而要自己造 key，多一层假真相源）。
  const [resolution, setResolution] = useState<ApproverResolution | null>(null);

  const availability = useMutation({
    mutationFn: ({ principalId, available }: { principalId: string; available: boolean }) =>
      setOrgAvailability(principalId, available),
    onSuccess: (p) => {
      toast(`${p.name} 已置为${p.available ? "在岗" : "不在岗"}`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "org-chart"] });
      // 在岗状态是**代理链的触发源** ⇒ 上一次解析出来的审批人清单当场过期。
      // 不清就是把旧答案留在屏上冒充新答案（本仓最爱栽的那种静默失败）。
      setResolution(null);
    },
    onError: toastError,
  });

  // ── 区④ 待批事项表单（`ApprovalMatter` 七字段，全部由用户填，不写死）──────────────
  const [scope, setScope] = useState<AuthorityScope>("order");
  const [amount, setAmount] = useState("6000000");
  const [marginPct, setMarginPct] = useState("");
  const [importance, setImportance] = useState<CustomerImportance | "">("");
  const [crossBase, setCrossBase] = useState(false);
  const [capex, setCapex] = useState(false);
  const [asOf, setAsOf] = useState("");

  const matter: ApprovalMatter = {
    scope,
    amount: Number(amount) || 0,
    marginPct: marginPct.trim() === "" ? null : Number(marginPct),
    customerImportance: importance === "" ? null : importance,
    crossBase,
    capitalExpenditure: capex,
    asOf: asOf.trim() === "" ? null : asOf.trim(),
  };

  const resolve = useMutation({
    mutationFn: () => resolveApprovers(matter),
    onSuccess: setResolution,
    onError: toastError,
  });

  const chart = chartQ.data;
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of [...(chart?.departments ?? []), ...(chart?.roles ?? []), ...(chart?.persons ?? [])]) {
      m.set(p.principalId, p.name);
    }
    return m;
  }, [chart]);
  const who = (id: string): string => nameById.get(id) ?? id;

  return (
    <div data-testid="org-world-page" data-ready={ready ? "1" : "0"}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>组织世界</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        人 / 角色 / 部门 · 职权与审批额度 · 授权代理。回答「这一单该谁批」与「为什么现在没人批得了」——
        真值写入仍走 Action 审批链（本页只读组织主数据，不代替审批）。
      </div>

      {/* ═══ 区① 组织架构（GET /a/v1/org/chart）+ 在岗开关（PATCH …/availability）═══ */}
      <div className="panel" style={{ marginBottom: 14 }} data-testid="org-chart-panel">
        <div className="section-title">组织架构</div>
        {chartQ.isLoading && <div className="empty-state">加载中…</div>}
        {chart && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <OrgColumn testid="org-departments" title="部门 / 委员会" rows={chart.departments} />
            <OrgColumn testid="org-roles" title="角色" rows={chart.roles} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>人 · {chart.persons.length} 位</div>
              <table className="cmp" style={{ width: "100%" }} data-testid="org-persons">
                <tbody>
                  {chart.persons.map((p) => (
                    <tr key={p.principalId} data-testid={`org-person-${p.orgKey}`}>
                      <td>
                        <b>{p.name}</b>
                        <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>{p.title}</span>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <span
                          className={`badge ${p.available ? "green" : "red"}`}
                          data-testid={`org-available-${p.orgKey}`}
                          data-available={p.available ? "1" : "0"}
                        >
                          {p.available ? "在岗" : "不在岗"}
                        </span>
                        {/* 规范 §2 R-UI-3：不拿原生 `title=` 承载口径（浏览器 tooltip 触屏读不到、读屏器时机不定，
                            且 `provenance-popover-legibility` 有棘轮咬着）。「为什么按不动」写在下面
                            `org-availability-readonly` 那行**可见文字**里。 */}
                        <button
                          className="btn sm"
                          style={{ marginLeft: 4 }}
                          data-testid={`org-availability-toggle-${p.orgKey}`}
                          disabled={!canWriteAvailability || availability.isPending}
                          onClick={() => availability.mutate({ principalId: p.principalId, available: !p.available })}
                        >
                          {p.available ? "置为不在岗" : "置为在岗"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!canWriteAvailability && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }} data-testid="org-availability-readonly">
                  只读：改他人在岗状态需 admin / tenant_admin。
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══ 区② 职权与额度（GET /a/v1/org/authorities）═══ */}
      <div className="panel" style={{ marginBottom: 14 }} data-testid="org-authorities-panel">
        <div className="section-title">职权与审批额度</div>
        <table className="cmp" style={{ width: "100%" }} data-testid="org-authorities">
          <thead>
            <tr>
              <th>职权</th>
              <th>域</th>
              <th>持有者</th>
              <th>升级序</th>
              <th>额度（金额 / 利润率 / 客户重要度 / 跨基地 / 资本投入）</th>
            </tr>
          </thead>
          <tbody>
            {(authQ.data?.authorities ?? []).map((a) => {
              const ls = (authQ.data?.limits ?? []).filter((l) => l.authorityRef === a.authorityKey);
              return (
                <tr key={a.authorityKey} data-testid={`org-authority-${a.authorityKey}`}>
                  <td>
                    <b>{a.name}</b> <span className="mono muted" style={{ fontSize: 12 }}>{a.authorityKey}</span>
                  </td>
                  <td>{SCOPE_LABEL[a.scope]}</td>
                  <td>{who(a.principalRef)}</td>
                  <td className="mono" data-testid={`org-rank-${a.authorityKey}`}>{a.escalationRank}</td>
                  <td style={{ fontSize: 12 }} data-testid={`org-limits-${a.authorityKey}`}>
                    {ls.length === 0 ? (
                      // 空额度 = 没授权（后端缺省收紧，不是「不设限」）——诚实标出来，别让人以为是漏配。
                      <span className="badge amber">未挂额度 ⇒ 判为无权</span>
                    ) : (
                      ls.map((l) => (
                        <div key={l.limitKey}>
                          {numOrDash(l.maxOrderValue, " 元")} / {l.minMarginPct === null ? NO_LIMIT : `≥ ${l.minMarginPct}%`} /{" "}
                          {l.maxCustomerImportance === null ? NO_LIMIT : `≤ ${IMPORTANCE_LABEL[l.maxCustomerImportance]}`} /{" "}
                          {l.allowCrossBase ? "可跨基地" : "不可跨基地"} /{" "}
                          {l.maxInvestmentValue === null ? "不可批" : `${l.maxInvestmentValue.toLocaleString("zh-CN")} 元`}
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ═══ 区③ 授权代理（GET /a/v1/org/delegations）═══ */}
      <div className="panel" style={{ marginBottom: 14 }} data-testid="org-delegations-panel">
        <div className="section-title">授权代理</div>
        <table className="cmp" style={{ width: "100%" }} data-testid="org-delegations">
          <thead>
            <tr><th>被代理人</th><th>代理人</th><th>限定域</th><th>生效窗口</th><th>事由</th></tr>
          </thead>
          <tbody>
            {(delQ.data?.delegations ?? []).map((d) => (
              <tr key={d.delegationKey} data-testid={`org-delegation-${d.delegationKey}`}>
                <td>{who(d.fromPrincipalRef)}</td>
                <td>{who(d.toPrincipalRef)}</td>
                <td>{d.scope === null ? "全部域" : SCOPE_LABEL[d.scope]}</td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {d.activeFrom === null && d.activeTo === null ? "长期有效" : `${d.activeFrom ?? "—"} ~ ${d.activeTo ?? "—"}`}
                </td>
                <td style={{ fontSize: 12 }}>{d.reason}</td>
              </tr>
            ))}
            {delQ.isSuccess && (delQ.data?.delegations ?? []).length === 0 && (
              <tr><td colSpan={5} className="muted">暂无代理关系</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ═══ 区④ 谁能批这一单（POST /a/v1/org/approvers/resolve · 纯读，不代替审批）═══ */}
      <div className="panel" data-testid="org-resolve-panel">
        <div className="section-title">谁能批这一单</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          只回答「谁有权批」+「谁为什么批不了」。**不写任何真值** —— 要真派单仍走审批中心的 Action 审批链。
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <label style={{ fontSize: 12 }}>
            域{" "}
            <select data-testid="org-matter-scope" value={scope} onChange={(e) => setScope(e.target.value as AuthorityScope)}>
              {AUTHORITY_SCOPES.map((s) => (
                <option key={s} value={s}>{SCOPE_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            金额(元) <input data-testid="org-matter-amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} />
          </label>
          <label style={{ fontSize: 12 }}>
            利润率(%) <input data-testid="org-matter-margin" value={marginPct} placeholder="留空=未知" onChange={(e) => setMarginPct(e.target.value)} style={{ width: 84 }} />
          </label>
          <label style={{ fontSize: 12 }}>
            客户重要度{" "}
            <select data-testid="org-matter-importance" value={importance} onChange={(e) => setImportance(e.target.value as CustomerImportance | "")}>
              <option value="">（普通）</option>
              {CUSTOMER_IMPORTANCE.map((c) => (
                <option key={c} value={c}>{IMPORTANCE_LABEL[c]}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            <input type="checkbox" data-testid="org-matter-crossbase" checked={crossBase} onChange={(e) => setCrossBase(e.target.checked)} /> 跨基地
          </label>
          <label style={{ fontSize: 12 }}>
            <input type="checkbox" data-testid="org-matter-capex" checked={capex} onChange={(e) => setCapex(e.target.checked)} /> 资本投入
          </label>
          <label style={{ fontSize: 12 }}>
            基准日 <input data-testid="org-matter-asof" value={asOf} placeholder="YYYY-MM-DD" onChange={(e) => setAsOf(e.target.value)} style={{ width: 100 }} />
          </label>
          <button className="btn sm primary" data-testid="org-resolve-run" disabled={resolve.isPending} onClick={() => resolve.mutate()}>
            {resolve.isPending ? "解析中…" : "解析审批人"}
          </button>
        </div>

        {resolution && (
          <div data-testid="org-resolution">
            <div style={{ marginBottom: 6 }}>
              <span className={`badge ${resolution.stuck ? "red" : "green"}`} data-testid="org-resolution-stuck">
                {resolution.stuck ? "卡住：无人有权批" : `可批 · ${resolution.eligible.length} 人`}
              </span>
              {resolution.diagnosis && (
                <span style={{ marginLeft: 8, fontSize: 12 }} data-testid="org-resolution-diagnosis">{resolution.diagnosis}</span>
              )}
            </div>
            <table className="cmp" style={{ width: "100%", marginBottom: 10 }} data-testid="org-eligible">
              <thead>
                <tr><th>可批人</th><th>职权</th><th>升级序</th><th>取得方式</th><th>在岗</th><th>在办负荷</th></tr>
              </thead>
              <tbody>
                {resolution.eligible.map((c) => (
                  <tr key={`${c.principalId}:${c.authorityKey}`} data-testid={`org-eligible-${c.orgKey}`}>
                    <td><b>{c.name}</b> <span className="muted" style={{ fontSize: 12 }}>{c.title}</span></td>
                    <td>{c.authorityName}</td>
                    <td className="mono">{c.escalationRank}</td>
                    <td data-testid={`org-eligible-via-${c.orgKey}`}>
                      {c.via === "delegated" ? (
                        <span className="badge blue">代理自 {who(c.delegatedFrom ?? "")}</span>
                      ) : (
                        <span className="badge">本人职权</span>
                      )}
                    </td>
                    <td>{c.available ? "是" : "否"}</td>
                    <td className="mono">{c.workload} 件</td>
                  </tr>
                ))}
                {resolution.eligible.length === 0 && (
                  <tr><td colSpan={6} className="muted">无人有权批 —— 逐条原因见下表</td></tr>
                )}
              </tbody>
            </table>
            <div className="section-title" style={{ fontSize: 12 }}>为什么批不了</div>
            <table className="cmp" style={{ width: "100%" }} data-testid="org-blockers">
              <thead><tr><th>职权</th><th>持有者</th><th>升级序</th><th>落选原因</th></tr></thead>
              <tbody>
                {resolution.blockers.map((b) => (
                  <tr key={b.authorityKey} data-testid={`org-blocker-${b.authorityKey}`}>
                    <td>{b.authorityName}</td>
                    <td>{b.name || who(b.principalId)}</td>
                    <td className="mono">{b.escalationRank}</td>
                    <td style={{ fontSize: 12 }}>{b.reasons.join("；")}</td>
                  </tr>
                ))}
                {resolution.blockers.length === 0 && <tr><td colSpan={4} className="muted">无落选职权</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function OrgColumn({ title, rows, testid }: { title: string; rows: OrgPrincipal[]; testid: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{title} · {rows.length} 项</div>
      <table className="cmp" style={{ width: "100%" }} data-testid={testid}>
        <tbody>
          {rows.map((p) => (
            <tr key={p.principalId} data-testid={`org-node-${p.orgKey}`}>
              <td>
                <b>{p.name}</b>
                <span className="mono muted" style={{ fontSize: 12, marginLeft: 4 }}>{p.orgKey}</span>
              </td>
              <td style={{ fontSize: 12 }} className="muted">
                {p.platformRoles.length > 0 ? p.platformRoles.join(" / ") : "—"}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="muted">暂无</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
