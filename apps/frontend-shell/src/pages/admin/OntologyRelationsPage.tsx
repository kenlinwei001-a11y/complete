import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createLinkType,
  createPropagationRule,
  createPublishRequest,
  deprecateOntologyElement,
  fetchDomains,
  fetchElementReferences,
  fetchMappingRegistries,
  fetchObjectTypes,
  fetchOntologyVersions,
  fetchPropagationRules,
  fetchPublishRequests,
  fetchSimViewConfig,
  retireOntologyElement,
  signoffPublishRequest,
  type DeprecationMetaVM,
  type ElementReferenceVM,
} from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";

/**
 * **本体关系编辑器**（`/admin/ontology-relations`）· WO-BEFE-A 主交付。
 *
 * ── 这一页在补什么洞 ────────────────────────────────────────────────────────
 * 仓主的原话：**「为何目前系统里没有这个功能？没有这个功能，人工如何创建每个域的本体关系？」**
 * 追下来的答案是：**后端有，前端没有。**
 *   · `POST /a/v1/ontology/link-types`（`apps/datacore/src/app.ts:2918`）建结构边
 *   · `POST /a/v1/ontology/links/:key/{deprecate,retire}`（`:2797` `:2802`）结构边启停/下线
 *   · `POST /a/v1/sim/propagation-rules`（`:1865`）建因果边
 * 三个写端一个前端调用方都没有 ⇒ 那 13 条传导规则只能写死在 `apps/datacore/src/seed.ts` 里，
 * 不是谁配出来的。而 `GET /a/v1/sim/view-config` 的注释白纸黑字承诺
 * 「换行业 = 换本体内容不改代码」—— **缺了编辑界面，这句承诺兑现不了**。
 *
 * ── 两种边，别混（这是本页的信息架构主轴）──────────────────────────────────
 *  · **结构边 `LinkType`**：`A --key--> B`，回答「这两类东西之间有没有关系、几对几」。
 *    它是本体图谱的骨架，`GET /a/v1/sim/view-config` 的 `linkTypes` 就是它。
 *  · **因果边 `PropagationRule`**：`A.x --系数/延迟--> B.y`，回答「A 的这个量变了，B 的那个量跟着变多少」。
 *    它是**推演**的边，`view-config` 的 `stateVars` / `propagationCount` 由它派生。
 *  关掉一条因果边，沙盘推演结果**真的会变**；关掉一条结构边**不会**（`view-config` 的
 *  `linkTypes` 取 `links.map(l => l.key)`，不看 `deprecation`）——两者的「启停」语义不是一回事，
 *  屏上必须分开写，合成一个「active 开关」就是把两个不同事实盖成一个数字。
 *
 * ── R4（真值写入经审批）在本页怎么落 ────────────────────────────────────────
 * 结构边的建/停/下线写的是**工作集**（`repos.ontologyLinks.put`），**不是**已发布真值 ——
 * 真值是 `OntologyVersion` 快照，由 `publishVersion` 固化（`ontology.ts:331`）。
 * 故本页**不给**「直接发布」按钮（那条 `POST /a/v1/ontology/publish` 会绕开会签），
 * 只给**会签链**：发起 `publish-requests` → 各域 owner `signoff` → 全域 APPROVE 后后端自动发布
 * （`app.ts:2891`）。这就是本页对 R4 的兑现方式。
 *
 * 🚦 诚实位（三条，全部 2026-08-14 实测得来，不许拿界面糊过去；复验命令见每条末尾，
 *    并由 `apps/frontend-shell/test/ontology-relations.seam.test.tsx` §④ 钉成事实锁）：
 *  ① 因果边**改不了**：`POST …/propagation-rules` 把 `id` 写在 body 展开之后恒覆盖
 *     ⇒ 只能新建。停用一条**已存在**的规则需要后端补 PUT/PATCH，今天做不到。
 *  ② 结构边的**工作集弃用态**没有只读下发口，状态列的口径是「已发布快照 ⊕ 本次会话写回包」。
 *  ③ 域归属取**对象类型的本体域**（`ObjectTypeDef.domain` ← `GET /a/v1/ontology/domains` 注册表），
 *     **不是** `ProcessDomain`（D01…D13）。后者是业务流程层的域词表，契约
 *     `packages/contracts/src/process.ts:139-158` 专门警告过「别造第二套域词表」。
 */

const CARDINALITIES = ["1:1", "1:N", "N:1", "N:N"] as const;
type Cardinality = (typeof CARDINALITIES)[number];

/** 未归域的对象类型落这个桶（与后端 `object-types/stats` 的 `unassigned` 同名，不另造词）。 */
const UNASSIGNED = "unassigned";

function statusLabel(dep: DeprecationMetaVM | undefined): { text: string; tone: string } {
  if (!dep) return { text: "启用", tone: "var(--ok, #2e7d32)" };
  if (dep.status === "RETIRED") return { text: "已下线", tone: "var(--muted, #888)" };
  return { text: "已停用", tone: "var(--warn, #b26a00)" };
}

export default function OntologyRelationsPage() {
  const qc = useQueryClient();

  // ── 取数（全部真 REST，无本地写死）────────────────────────────────────────
  const registries = useQuery({ queryKey: ["a", "ontology-mapping-registries"], queryFn: fetchMappingRegistries });
  const types = useQuery({ queryKey: ["a", "ontology-object-types"], queryFn: fetchObjectTypes });
  const domains = useQuery({ queryKey: ["a", "ontology-domains"], queryFn: fetchDomains });
  const versions = useQuery({ queryKey: ["a", "ontology-versions"], queryFn: fetchOntologyVersions });
  const rules = useQuery({ queryKey: ["a", "sim-propagation-rules"], queryFn: () => fetchPropagationRules(false) });
  const viewCfg = useQuery({ queryKey: ["a", "sim-view-config"], queryFn: fetchSimViewConfig });
  const pubReqs = useQuery({ queryKey: ["a", "ontology-publish-requests"], queryFn: () => fetchPublishRequests() });

  /** 本次会话的写回包（结构边工作集态的唯一可得来源，见文件头诚实位 ②）。 */
  const [sessionDeprecation, setSessionDeprecation] = useState<Record<string, DeprecationMetaVM>>({});
  const [refPanel, setRefPanel] = useState<{ key: string; refs: ElementReferenceVM[]; total: number } | null>(null);

  const typeDomain = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of types.data ?? []) m.set(t.key, t.domain ?? UNASSIGNED);
    return m;
  }, [types.data]);

  const domainName = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of domains.data ?? []) m.set(d.domainKey, d.displayName);
    return m;
  }, [domains.data]);

  /** 最新已发布快照里的弃用态（`GET /a/v1/ontology/versions` 是唯一带 `deprecation` 的读）。 */
  const snapshotDeprecation = useMemo(() => {
    const list = versions.data ?? [];
    const latest = list.length > 0 ? list.reduce((a, b) => (b.version > a.version ? b : a)) : null;
    const m = new Map<string, DeprecationMetaVM>();
    for (const l of latest?.snapshot?.linkTypes ?? []) if (l.deprecation) m.set(l.key, l.deprecation);
    return m;
  }, [versions.data]);

  const linkRows = registries.data?.linkTypes ?? [];

  /** 结构边按 **from 类型的本体域** 分组（诚实位 ③）。域名缺省即显裸 key，不编中文名。 */
  const linksByDomain = useMemo(() => {
    const g = new Map<string, typeof linkRows>();
    for (const l of linkRows) {
      const d = typeDomain.get(l.fromType) ?? UNASSIGNED;
      g.set(d, [...(g.get(d) ?? []), l]);
    }
    return [...g.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [linkRows, typeDomain]);

  const ruleRows = rules.data?.items ?? [];
  const rulesByDomain = useMemo(() => {
    const g = new Map<string, typeof ruleRows>();
    for (const r of ruleRows) {
      const d = typeDomain.get(r.sourceTypeKey) ?? UNASSIGNED;
      g.set(d, [...(g.get(d) ?? []), r]);
    }
    return [...g.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [ruleRows, typeDomain]);

  // ── 结构边：新建 ─────────────────────────────────────────────────────────
  const [lk, setLk] = useState({ key: "", fromTypeKey: "", toTypeKey: "", cardinality: "1:N" as Cardinality });
  const createLink = useMutation({
    mutationFn: () => createLinkType({ ...lk, key: lk.key.trim() }),
    onSuccess: (r) => {
      toast(`结构边 ${r.key} 已建（v${r.version}）`, "success");
      setLk({ key: "", fromTypeKey: "", toTypeKey: "", cardinality: "1:N" });
      void qc.invalidateQueries({ queryKey: ["a", "ontology-mapping-registries"] });
      void qc.invalidateQueries({ queryKey: ["a", "sim-view-config"] });
    },
    onError: toastError,
  });

  const deprecateLink = useMutation({
    mutationFn: (key: string) => deprecateOntologyElement("link", key),
    onSuccess: (r) => {
      setSessionDeprecation((s) => ({ ...s, [r.key]: r.deprecation }));
      toast(`结构边 ${r.key} 已停用（宽限至 ${r.deprecation.graceUntil?.slice(0, 10) ?? "—"}）`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "sim-view-config"] });
    },
    onError: toastError,
  });

  const retireLink = useMutation({
    mutationFn: (key: string) => retireOntologyElement("link", key),
    onSuccess: (r) => {
      setSessionDeprecation((s) => ({ ...s, [r.key]: { status: "RETIRED" } }));
      toast(`结构边 ${r.key} 已下线`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "ontology-mapping-registries"] });
      void qc.invalidateQueries({ queryKey: ["a", "sim-view-config"] });
    },
    // 409「仍被 N 处引用」是**设计**不是故障 —— 原文直接抛给用户看。
    onError: toastError,
  });

  const showRefs = useMutation({
    mutationFn: (key: string) => fetchElementReferences("link", key).then((r) => ({ key, ...r })),
    onSuccess: (r) => setRefPanel(r),
    onError: toastError,
  });

  // ── 关系两端的**对象类型**的弃用流程（同一个 `governance.deprecate/retire`，只是 kind 不同）──
  //
  // 为什么放在本页而不是对象类型浏览页：弃用一个类型会把**它两端的所有关系**一起作废，
  // 用户是在看关系图谱时才会问「这个类型还要不要」。而且后端是同一个函数、同一道
  // 「还有人引用就不许下线」的闸 —— 分到两页会变成两套 UI 讲同一件事。
  //
  // ⚠ 这一段不是为了消 `befe-seam` 的红而加的空壳：没有真正的调用方，
  //   只在 `endpoints.ts` 里放两个函数就是「把死端点换成死客户端函数」，
  //   基线注释里点名批过这种做法。故此处给它真界面、真按钮、真列表。
  const [typeKeyToDeprecate, setTypeKeyToDeprecate] = useState("");
  const [typeDeprecation, setTypeDeprecation] = useState<Record<string, DeprecationMetaVM>>({});
  const deprecateType = useMutation({
    mutationFn: (key: string) => deprecateOntologyElement("type", key),
    onSuccess: (r) => {
      setTypeDeprecation((s) => ({ ...s, [r.key]: r.deprecation }));
      toast(`对象类型 ${r.key} 已停用`, "success");
    },
    onError: toastError,
  });
  const retireType = useMutation({
    mutationFn: (key: string) => retireOntologyElement("type", key),
    onSuccess: (r) => {
      setTypeDeprecation((s) => ({ ...s, [r.key]: { status: "RETIRED" } }));
      toast(`对象类型 ${r.key} 已下线`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "ontology-object-types"] });
    },
    onError: toastError,
  });

  // ── 因果边：新建（含启停）────────────────────────────────────────────────
  const [pr, setPr] = useState({
    key: "",
    sourceTypeKey: "",
    sourceStateVar: "",
    viaLinkKey: "",
    targetTypeKey: "",
    targetStateVar: "",
    coefficient: "0.8",
    delayTicks: "0",
    status: "PUBLISHED" as "DRAFT" | "PUBLISHED",
  });
  const createRule = useMutation({
    mutationFn: () =>
      createPropagationRule({
        key: pr.key.trim(),
        sourceTypeKey: pr.sourceTypeKey,
        sourceStateVar: pr.sourceStateVar.trim(),
        viaLinkKey: pr.viaLinkKey,
        targetTypeKey: pr.targetTypeKey,
        targetStateVar: pr.targetStateVar.trim(),
        coefficient: Number(pr.coefficient),
        delayTicks: Number(pr.delayTicks),
        status: pr.status,
      }),
    onSuccess: (r) => {
      toast(`因果边 ${r.key} 已建（${r.status === "PUBLISHED" ? "启用" : "停用"}）`, "success");
      setPr((p) => ({ ...p, key: "", sourceStateVar: "", targetStateVar: "" }));
      void qc.invalidateQueries({ queryKey: ["a", "sim-propagation-rules"] });
      // 这一跳就是接缝：因果边一变，沙盘视图配置（stateVars / propagationCount）必须重取。
      void qc.invalidateQueries({ queryKey: ["a", "sim-view-config"] });
    },
    onError: toastError,
  });

  // ── 发布会签（R4）────────────────────────────────────────────────────────
  const openPublish = useMutation({
    mutationFn: () => createPublishRequest({}),
    onSuccess: (r) => {
      toast(`已发起 v${r.ontologyVersion} 发布会签（触及 ${r.touchedDomains.length} 个域）`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "ontology-publish-requests"] });
    },
    onError: toastError,
  });
  const signoff = useMutation({
    mutationFn: (v: { id: string; decision: "APPROVE" | "REJECT" }) => signoffPublishRequest(v.id, v.decision),
    onSuccess: (r) => {
      toast(`会签已记录：${r.status}`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "ontology-publish-requests"] });
      void qc.invalidateQueries({ queryKey: ["a", "ontology-versions"] });
      void qc.invalidateQueries({ queryKey: ["a", "sim-view-config"] });
    },
    onError: toastError,
  });

  const typeOptions = (types.data ?? []).map((t) => t.key);
  const cfg = viewCfg.data;

  return (
    <div data-testid="ontology-relations-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>本体关系</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12, lineHeight: 1.7 }}>
        两种边分开管：<b>结构边</b>（A 与 B 有没有关系、几对几）是图谱骨架；<b>因果边</b>（A 的某个量变了 B 跟着变多少）是推演的边。
        <br />
        关掉一条<b>因果边</b>，沙盘推演结果真的会变；关掉一条<b>结构边</b>不会 —— 两者的「启停」不是一回事，不合成一个开关。
      </div>

      {/* 接缝读数：这三个数由本页的写操作真实驱动，用户点完就能看见它变 */}
      <div className="panel" data-testid="orel-viewcfg" style={{ marginBottom: 14, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12 }}>
        <span>
          沙盘视图配置（<code>GET /a/v1/sim/view-config</code>）：
        </span>
        <span data-testid="orel-vc-linktypes">结构边 {cfg ? cfg.linkTypes.length : "—"}</span>
        <span data-testid="orel-vc-statevars">状态变量 {cfg ? cfg.stateVars.length : "—"}</span>
        <span data-testid="orel-vc-propcount">生效因果边 {cfg ? cfg.propagationCount : "—"}</span>
        <span className="muted">（生效 = 已启用；停用的边在册但不进推演）</span>
      </div>

      {/* ═══════════ 结构边 ═══════════ */}
      <h3 style={{ fontSize: 13.5, margin: "16px 0 6px" }}>结构边 · 关系类型</h3>
      <div className="panel" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input
          data-testid="orel-link-key"
          placeholder="关系 key（如 supplies_to）"
          value={lk.key}
          onChange={(e) => setLk({ ...lk, key: e.target.value })}
          style={{ width: 190 }}
        />
        <select data-testid="orel-link-from" value={lk.fromTypeKey} onChange={(e) => setLk({ ...lk, fromTypeKey: e.target.value })}>
          <option value="">来源类型…</option>
          {typeOptions.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <span aria-hidden>→</span>
        <select data-testid="orel-link-to" value={lk.toTypeKey} onChange={(e) => setLk({ ...lk, toTypeKey: e.target.value })}>
          <option value="">去向类型…</option>
          {typeOptions.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select data-testid="orel-link-card" value={lk.cardinality} onChange={(e) => setLk({ ...lk, cardinality: e.target.value as Cardinality })}>
          {CARDINALITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          className="btn primary sm"
          data-testid="orel-link-create"
          disabled={createLink.isPending || !lk.key.trim() || !lk.fromTypeKey || !lk.toTypeKey}
          onClick={() => createLink.mutate()}
        >
          建结构边
        </button>
      </div>

      {linksByDomain.length === 0 && <div className="empty-state">暂无结构边</div>}
      {linksByDomain.map(([dk, rows]) => (
        <div key={dk} data-testid={`orel-link-domain-${dk}`} style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: 11.5, margin: "6px 0 3px" }}>
            域：{domainName.get(dk) ?? dk}（{rows.length}）
          </div>
          <table className="cmp" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>关系</th>
                <th>来源 → 去向</th>
                <th>基数</th>
                <th>状态</th>
                <th style={{ width: 210 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const dep = sessionDeprecation[l.key] ?? snapshotDeprecation.get(l.key);
                const s = statusLabel(dep);
                return (
                  <tr key={l.key} data-testid={`orel-link-${l.key}`}>
                    <td className="mono">{l.key}</td>
                    <td className="mono">
                      {l.fromType} → {l.toType}
                    </td>
                    <td>{l.cardinality}</td>
                    <td data-testid={`orel-link-status-${l.key}`} style={{ color: s.tone }}>
                      {s.text}
                    </td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="btn sm" data-testid={`orel-link-refs-${l.key}`} onClick={() => showRefs.mutate(l.key)}>
                        查引用
                      </button>
                      <button
                        className="btn sm"
                        data-testid={`orel-link-deprecate-${l.key}`}
                        disabled={deprecateLink.isPending}
                        onClick={() => deprecateLink.mutate(l.key)}
                      >
                        停用
                      </button>
                      <button
                        className="btn sm"
                        data-testid={`orel-link-retire-${l.key}`}
                        disabled={retireLink.isPending}
                        onClick={() => retireLink.mutate(l.key)}
                      >
                        下线
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {refPanel && (
        <div className="panel" data-testid="orel-refs-panel" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            <b className="mono">{refPanel.key}</b> 的引用方：{refPanel.total} 处
            {refPanel.total > 0 && <span className="muted">（&gt;0 时后端拒绝下线，409 逐条列出）</span>}
          </div>
          {refPanel.total === 0 ? (
            <div className="muted" style={{ fontSize: 11.5 }}>无引用 —— 可以下线</div>
          ) : (
            <ul style={{ fontSize: 11.5, margin: 0, paddingLeft: 18 }}>
              {refPanel.refs.map((r, i) => (
                <li key={`${r.refKind}-${r.key}-${i}`} className="mono">
                  {r.refKind}:{r.key}@{r.where}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="muted" data-testid="orel-link-honesty" style={{ fontSize: 11, marginBottom: 18, lineHeight: 1.7 }}>
        ⚠ 状态列口径 = <b>最新已发布快照</b>（<code>GET /a/v1/ontology/versions</code> 的{" "}
        <code>snapshot.linkTypes[].deprecation</code>）⊕ <b>本次会话的写回包</b>。
        工作集里的弃用态今天<b>没有只读下发口</b>（后端 9 处 <code>ontologyLinks.list</code> 读取方全部把{" "}
        <code>deprecation</code> 投影掉了），所以刷新页面会退回快照口径 —— 这是如实标注，不是显示 bug。
      </div>

      {/* ═══════════ 因果边 ═══════════ */}
      <h3 style={{ fontSize: 13.5, margin: "16px 0 6px" }}>因果边 · 传导规则</h3>
      <div className="panel" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input
          data-testid="orel-rule-key"
          placeholder="规则 key"
          value={pr.key}
          onChange={(e) => setPr({ ...pr, key: e.target.value })}
          style={{ width: 150 }}
        />
        <select data-testid="orel-rule-srctype" value={pr.sourceTypeKey} onChange={(e) => setPr({ ...pr, sourceTypeKey: e.target.value })}>
          <option value="">来源类型…</option>
          {typeOptions.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          data-testid="orel-rule-srcvar"
          placeholder="来源状态变量"
          value={pr.sourceStateVar}
          onChange={(e) => setPr({ ...pr, sourceStateVar: e.target.value })}
          style={{ width: 140 }}
        />
        <select data-testid="orel-rule-link" value={pr.viaLinkKey} onChange={(e) => setPr({ ...pr, viaLinkKey: e.target.value })}>
          <option value="">经由结构边…</option>
          {linkRows.map((l) => (
            <option key={l.key} value={l.key}>
              {l.key}
            </option>
          ))}
        </select>
        <select data-testid="orel-rule-tgttype" value={pr.targetTypeKey} onChange={(e) => setPr({ ...pr, targetTypeKey: e.target.value })}>
          <option value="">去向类型…</option>
          {typeOptions.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          data-testid="orel-rule-tgtvar"
          placeholder="去向状态变量"
          value={pr.targetStateVar}
          onChange={(e) => setPr({ ...pr, targetStateVar: e.target.value })}
          style={{ width: 140 }}
        />
        {/* 同上：字段口径一律用**可见 label**，不用原生 title（UI 规范 §2 R-UI-3）。 */}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5 }}>
          <span className="muted">系数</span>
          <input
            data-testid="orel-rule-coef"
            type="number"
            step="0.05"
            value={pr.coefficient}
            onChange={(e) => setPr({ ...pr, coefficient: e.target.value })}
            style={{ width: 76 }}
          />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5 }}>
          <span className="muted">延迟(tick)</span>
          <input
            data-testid="orel-rule-delay"
            type="number"
            min="0"
            value={pr.delayTicks}
            onChange={(e) => setPr({ ...pr, delayTicks: e.target.value })}
            style={{ width: 66 }}
          />
        </label>
        {/*
          启停语义**写在可见文案里**，不挂 `title=` ——
          UI 规范 §2 R-UI-3 禁止用原生 title 承载需要阅读的口径
          （`test/provenance-popover-legibility.test.tsx:1120` 是只减不增的棘轮，
          我第一版写了一句带冒号的长 title，当场被它咬住）。
        */}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5 }}>
          <span className="muted">启停</span>
          <select
            data-testid="orel-rule-status"
            value={pr.status}
            onChange={(e) => setPr({ ...pr, status: e.target.value as "DRAFT" | "PUBLISHED" })}
          >
            <option value="PUBLISHED">启用（进推演）</option>
            <option value="DRAFT">停用（在册不生效）</option>
          </select>
        </label>
        <button
          className="btn primary sm"
          data-testid="orel-rule-create"
          disabled={
            createRule.isPending ||
            !pr.key.trim() ||
            !pr.sourceTypeKey ||
            !pr.sourceStateVar.trim() ||
            !pr.viaLinkKey ||
            !pr.targetTypeKey ||
            !pr.targetStateVar.trim()
          }
          onClick={() => createRule.mutate()}
        >
          建因果边
        </button>
      </div>

      {rulesByDomain.length === 0 && <div className="empty-state">暂无因果边</div>}
      {rulesByDomain.map(([dk, rows]) => (
        <div key={dk} data-testid={`orel-rule-domain-${dk}`} style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: 11.5, margin: "6px 0 3px" }}>
            域：{domainName.get(dk) ?? dk}（{rows.length}）
          </div>
          <table className="cmp" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>规则</th>
                <th>影响（来源量 → 去向量）</th>
                <th>系数</th>
                <th>延迟</th>
                <th>启停</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`orel-rule-${r.key}`}>
                  <td className="mono">{r.key}</td>
                  <td className="mono">
                    {r.sourceTypeKey}.{r.sourceStateVar} --{r.viaLinkKey}--&gt; {r.targetTypeKey}.{r.targetStateVar}
                  </td>
                  <td>{r.coefficient}</td>
                  <td>{r.delayTicks}</td>
                  <td data-testid={`orel-rule-status-${r.key}`}>{r.status === "PUBLISHED" ? "启用" : r.status === "DRAFT" ? "停用" : "已下线"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="muted" data-testid="orel-rule-honesty" style={{ fontSize: 11, marginBottom: 18, lineHeight: 1.7 }}>
        ⚠ 因果边今天<b>只能新建，改不了</b>：<code>POST /a/v1/sim/propagation-rules</code> 把{" "}
        <code>id: newId(&quot;simpr&quot;)</code> 写在请求体展开之后（<code>apps/datacore/src/app.ts:1867</code>），
        传进去的 id 恒被覆盖 ⇒ 每次 POST 都是一条新规则。所以这里<b>不提供</b>「停用已有边」的开关 ——
        提供了只会 POST 出一条同 key 的重复规则，把生效条数数成两条。
        真·启停需要后端补 <code>PUT/PATCH /a/v1/sim/propagation-rules/:id</code>，属后端单，本单范围外。
        <br />
        复验探针：<code>grep -n &apos;id: newId(&quot;simpr&quot;)&apos; apps/datacore/src/app.ts</code>
      </div>

      {/* ═══════════ 关系两端的对象类型 · 弃用流程 ═══════════ */}
      <h3 style={{ fontSize: 13.5, margin: "16px 0 6px" }}>对象类型 · 弃用流程</h3>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8, lineHeight: 1.7 }}>
        停用/下线一个<b>类型</b>会连带作废它两端的全部关系，所以它和上面两张表是同一件事的两端。
        后端是同一个治理函数、同一道「还有人引用就不许下线」的闸。
      </div>
      <div className="panel" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <select data-testid="orel-type-select" value={typeKeyToDeprecate} onChange={(e) => setTypeKeyToDeprecate(e.target.value)}>
          <option value="">选一个对象类型…</option>
          {typeOptions.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button
          className="btn sm"
          data-testid="orel-type-deprecate"
          disabled={!typeKeyToDeprecate || deprecateType.isPending}
          onClick={() => deprecateType.mutate(typeKeyToDeprecate)}
        >
          停用类型
        </button>
        <button
          className="btn sm"
          data-testid="orel-type-retire"
          disabled={!typeKeyToDeprecate || retireType.isPending}
          onClick={() => retireType.mutate(typeKeyToDeprecate)}
        >
          下线类型
        </button>
        <span className="muted" style={{ fontSize: 11 }}>
          下线前后端会先查引用；有引用则 409 并逐条列出，界面原样显示。
        </span>
      </div>
      {Object.keys(typeDeprecation).length > 0 && (
        <table className="cmp" data-testid="orel-type-table" style={{ width: "100%", marginBottom: 12 }}>
          <thead>
            <tr>
              <th>对象类型</th>
              <th>状态（本次会话写回包）</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(typeDeprecation).map(([k, dep]) => (
              <tr key={k} data-testid={`orel-type-row-${k}`}>
                <td className="mono">{k}</td>
                <td data-testid={`orel-type-status-${k}`}>{statusLabel(dep).text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ═══════════ 发布会签（R4）═══════════ */}
      <h3 style={{ fontSize: 13.5, margin: "16px 0 6px" }}>发布会签（R4）</h3>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8, lineHeight: 1.7 }}>
        上面的建/停/下线写的是<b>工作集</b>，不是已发布真值。真值是 <code>OntologyVersion</code> 快照 ——
        经<b>各域 owner 会签</b>后由后端自动固化（全域 APPROVE → <code>publishVersion</code>）。
        本页<b>不提供</b>「直接发布」按钮：那条路会绕开会签。
      </div>
      <div className="panel" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <button className="btn primary sm" data-testid="orel-publish-open" disabled={openPublish.isPending} onClick={() => openPublish.mutate()}>
          发起发布会签
        </button>
        <span className="muted" style={{ fontSize: 11.5 }}>
          已发布版本：{versions.data && versions.data.length > 0 ? `v${Math.max(...versions.data.map((v) => v.version))}` : "尚无"}
        </span>
      </div>
      <table className="cmp" data-testid="orel-publish-table" style={{ width: "100%", marginBottom: 8 }}>
        <thead>
          <tr>
            <th>请求</th>
            <th>目标版本</th>
            <th>触及域</th>
            <th>状态</th>
            <th style={{ width: 160 }}>会签</th>
          </tr>
        </thead>
        <tbody>
          {(pubReqs.data ?? []).map((p) => (
            <tr key={p.id} data-testid={`orel-pubreq-${p.id}`}>
              <td className="mono">{p.id}</td>
              <td>v{p.ontologyVersion}</td>
              <td className="mono">{p.touchedDomains.join(" · ") || "—"}</td>
              <td data-testid={`orel-pubreq-status-${p.id}`}>{p.status}</td>
              <td style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn sm"
                  data-testid={`orel-pubreq-approve-${p.id}`}
                  disabled={signoff.isPending || p.status !== "PENDING"}
                  onClick={() => signoff.mutate({ id: p.id, decision: "APPROVE" })}
                >
                  同意
                </button>
                <button
                  className="btn sm"
                  data-testid={`orel-pubreq-reject-${p.id}`}
                  disabled={signoff.isPending || p.status !== "PENDING"}
                  onClick={() => signoff.mutate({ id: p.id, decision: "REJECT" })}
                >
                  驳回
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(pubReqs.data ?? []).length === 0 && <div className="empty-state">暂无发布会签请求</div>}
    </div>
  );
}
