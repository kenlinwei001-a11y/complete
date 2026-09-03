import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OntologyInvariantOverride } from "@platform/contracts";
import {
  createLinkType,
  createPropagationRule,
  createPublishRequest,
  deletePropagationRule,
  deprecateOntologyElement,
  evaluateOntologyInvariants,
  fetchDomains,
  fetchElementReferences,
  fetchMappingRegistries,
  fetchObjectTypes,
  fetchOntologyInvariants,
  fetchOntologyVersions,
  fetchPropagationRules,
  fetchPublishRequests,
  fetchSimViewConfig,
  retireOntologyElement,
  signoffPublishRequest,
  updatePropagationRule,
  type DeprecationMetaVM,
  type ElementReferenceVM,
} from "@/api/endpoints";
import { InfoPopover } from "@/components/InfoPopover";
import zh from "@/locales/zh";
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
 *  ① ~~因果边**改不了**~~ **✅ 2026-09-03 已闭（WO-CAUSAL-EDGE-CRUD）**。原文：
 *     「`POST …/propagation-rules` 把 `id` 写在 body 展开之后恒覆盖 ⇒ 只能新建。
 *     停用一条**已存在**的规则需要后端补 PUT/PATCH，今天做不到。」
 *     —— 保留原文是为了留住病史（诚实位撤掉要留痕，不许静默删）。
 *     它当时是准的：真后端复现过同 key POST 两次得**两行**（系数 0.5 与 0.9 并存、都 PUBLISHED），
 *     而 `propagateTick` 逐规则累加 ⇒ **两条都算**，用户以为的「改系数」实为两条相加。
 *     现在 `POST` 按 key upsert（恒 1 行 · `version` 递增），并有 `PATCH /:id` 与 `DELETE /:id`，
 *     因果边表行内三个控件（改系数 · 启停 · 删）都真接了线。
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
      // `version > 1` ⇒ 后端按 key 认出了既有边并覆盖了它（不是又追加一条）。
      // 这句话必须上屏：用户填了一个已存在的 key 却以为自己在新建，是本单要根治的那类误解。
      toast(
        (r.version ?? 1) > 1
          ? `因果边 ${r.key} 已覆盖既有那条（第 ${r.version ?? 1} 版，仍是 1 条）`
          : `因果边 ${r.key} 已建（${r.status === "PUBLISHED" ? "启用" : "停用"}）`,
        "success",
      );
      setPr((p) => ({ ...p, key: "", sourceStateVar: "", targetStateVar: "" }));
      void qc.invalidateQueries({ queryKey: ["a", "sim-propagation-rules"] });
      // 这一跳就是接缝：因果边一变，沙盘视图配置（stateVars / propagationCount）必须重取。
      void qc.invalidateQueries({ queryKey: ["a", "sim-view-config"] });
    },
    onError: toastError,
  });

  // ── 因果边：改既有那一条（WO-CAUSAL-EDGE-CRUD）───────────────────────────
  //
  // 三个动作共用**同一个** invalidate 组合（规则列表 + 沙盘视图配置）——
  // 因果边一变，`propagationCount` / `stateVars` 就跟着变，这一跳就是接缝。
  // 漏掉第二个 invalidate 的话，屏上「生效因果边 N」会停在旧数字上，
  // 而推演结果已经变了：两个数各自都对，合起来对不上（本仓「断在接缝」的老形态）。
  const afterRuleWrite = () => {
    void qc.invalidateQueries({ queryKey: ["a", "sim-propagation-rules"] });
    void qc.invalidateQueries({ queryKey: ["a", "sim-view-config"] });
  };

  /** 改系数（行内直接改那一格；身份格后端不收，故这里只递 coefficient）。 */
  const patchCoef = useMutation({
    mutationFn: (v: { id: string; coefficient: number }) => updatePropagationRule(v.id, { coefficient: v.coefficient }),
    onSuccess: (r) => {
      toast(`因果边 ${r.key} 系数已改为 ${r.coefficient}（第 ${r.version ?? 1} 版）`, "success");
      afterRuleWrite();
    },
    onError: toastError,
  });

  /**
   * 启停 —— **一个按钮来回拨**，不是「停用」「启用」两个只进不出的动作。
   * 结构边那三个按钮（停用/下线）点了回不来，是本仓已知的坑；因果边刻意不复制它。
   */
  const toggleRule = useMutation({
    mutationFn: (v: { id: string; next: "DRAFT" | "PUBLISHED" }) => updatePropagationRule(v.id, { status: v.next }),
    onSuccess: (r) => {
      toast(`因果边 ${r.key} 已${r.status === "PUBLISHED" ? "启用（进推演）" : "停用（在册不生效）"}`, "success");
      afterRuleWrite();
    },
    onError: toastError,
  });

  /**
   * 删 —— 后端两道闸都回 409，原文直接抛给用户看（是**设计**不是故障）：
   * ① 还启用着 ⇒ 先停用（可逆、读数变化当场可见）；② 被某些会话按 key 点名引用 ⇒ 点名是哪几个。
   * 故界面上不拦、不预判，让后端说清楚为什么不能删 —— 前端自己编一套判据就是第二套真相源。
   */
  const removeRule = useMutation({
    mutationFn: (id: string) => deletePropagationRule(id),
    onSuccess: () => {
      toast("因果边已删除", "success");
      afterRuleWrite();
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

  // ── 不变式（第三类边）：试算覆盖 ────────────────────────────────────────────
  //
  // 覆盖只活在这个 state 里，**不落库**（这是推演开关不是治理动作，见下方那一段的注释）。
  // 无覆盖走只读体检口、有覆盖走试算口：两条路各有各的用处，不合并成"永远 POST"——
  // 那样只读口就成了没有生产调用方的死端点。
  const [invOverrides, setInvOverrides] = useState<Record<string, OntologyInvariantOverride>>({});
  const invDirty = Object.keys(invOverrides).length > 0;
  const invariants = useQuery({
    queryKey: ["a", "ontology-invariants", invOverrides],
    queryFn: () => (invDirty ? evaluateOntologyInvariants(invOverrides) : fetchOntologyInvariants()),
  });
  const inv = invariants.data;
  const setInvOverride = (key: string, patch: OntologyInvariantOverride) =>
    setInvOverrides((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  /** 守卫键 → 业务话名（翻转清单里显示名字而不是键；取不到就显裸键，不编一个）。 */
  const invName = (key: string) => inv?.items.find((i) => i.key === key)?.name ?? key;

  const typeOptions = (types.data ?? []).map((t) => t.key);
  const cfg = viewCfg.data;

  return (
    <div data-testid="ontology-relations-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>本体关系</h2>
      {/* 分层规范 §1：第一层只放「数值 / 状态 / 名字」，成段口径说明降浮层。
          ⚠ 降层不是删除 —— 两段原文一字未改，只是从常驻第一层挪进 `?` 浮层，
          点开即见（诚实位允许降到浮层，绝不允许删除）。 */}
      <div className="muted" style={{ fontSize: 12, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <span>两种边分开管：</span>
        <b>结构边</b>
        <span>·</span>
        <b>因果边</b>
        <InfoPopover topic="两种边有什么不同" testId="orel-edge-kinds">
          <div style={{ lineHeight: 1.7 }}>
            两种边分开管：<b>结构边</b>（A 与 B 有没有关系、几对几）是图谱骨架；<b>因果边</b>（A 的某个量变了 B 跟着变多少）是推演的边。
            <br />
            关掉一条<b>因果边</b>，沙盘推演结果真的会变；关掉一条<b>结构边</b>不会 —— 两者的「启停」不是一回事，不合成一个开关。
          </div>
        </InfoPopover>
      </div>

      {/* 接缝读数：这三个数由本页的写操作真实驱动，用户点完就能看见它变 */}
      <div className="panel" data-testid="orel-viewcfg" style={{ marginBottom: 14, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12 }}>
        {/* 出处（工程师层，不上屏）：这三个数读自 GET /a/v1/sim/view-config。 */}
        <span>推演沙盘当前生效的配置：</span>
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
          <div className="muted" style={{ fontSize: 12, margin: "6px 0 3px" }}>
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
            <div className="muted" style={{ fontSize: 12 }}>无引用 —— 可以下线</div>
          ) : (
            <ul style={{ fontSize: 12, margin: 0, paddingLeft: 18 }}>
              {refPanel.refs.map((r, i) => (
                <li key={`${r.refKind}-${r.key}-${i}`} className="mono">
                  {r.refKind}:{r.key}@{r.where}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/*
        WO-BEFE-CLEANUP · 信息分层（规范 §2 R-UI-3「公式与口径不在第一层」）。
        原文一整段是**口径推导式**（`最新已发布快照 ⊕ 本次会话写回包`）+ 机制解释，整段占着第一层。
        现在拆成两半，**一个字都没删**：
          · 第一层留**状态**一句（「刷新后会退回」这件事本身，用户要在不点击的前提下知道）；
          · `?` 浮层放**凭什么**（口径推导式 · 后端 9 处投影掉 deprecation 的机制 · 「不是 bug」的判断依据）。
        `?` 触发器常驻可见 = 规范 §1 要求的降层记号（静默降层等于删除）。
      */}
      {/* 分层规范 §1 + §3：诚实位**记号**留在第一层（降层不等于删除），成段口径进浮层。
          ⚠ 同时修一个真缺陷：原先 `orel-link-honesty` 这个 testId 同时挂在外层 div 与
          InfoPopover 上 —— 重复 testId 会让 getByTestId 抛「found multiple elements」，
          且两者语义不同（一个是记号、一个是浮层）。现拆成 -mark / -popover 两个。 */}
      <div className="muted" data-testid="orel-link-honesty" style={{ fontSize: 12, marginBottom: 18, display: "flex", alignItems: "center", gap: 6 }}>
        <span data-testid="orel-link-honesty-mark">⚠ 状态列含未发布改动</span>
        <InfoPopover topic={zh.admin.layer.relStatusTopic} testId="orel-link-honesty-popover">
          <p>状态列含本次会话尚未发布的改动，刷新页面后会退回已发布快照 —— 这是如实标注，不是显示 bug。</p>
          <p>{zh.admin.layer.relStatusBody}</p>
          <p className="mono" style={{ fontSize: 12 }}>
            snapshot.linkTypes[].deprecation ⊕ session write-back
          </p>
          <p>
            工作集里的弃用态今天<b>没有只读下发口</b>：后端 9 处 <code>ontologyLinks.list</code> 读取方
            全部把 <code>deprecation</code> 投影掉了。
          </p>
        </InfoPopover>
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
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
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
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
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
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
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
          <div className="muted" style={{ fontSize: 12, margin: "6px 0 3px" }}>
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
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`orel-rule-${r.key}`}>
                  <td className="mono">{r.key}</td>
                  <td className="mono">
                    {r.sourceTypeKey}.{r.sourceStateVar} --{r.viaLinkKey}--&gt; {r.targetTypeKey}.{r.targetStateVar}
                  </td>
                  {/*
                    系数**就地可改**（WO-CAUSAL-EDGE-CRUD）。改前这一格是死文本，
                    要调一个系数只能去建边表单把 13 个字段全重述一遍 —— 而那时重述还会
                    **多出一条同 key 的边**、两条一起算。现在就地改那一格，写的是同一条边。

                    落点选 `onBlur` 而不是 `onChange`：每敲一个字符发一次 PATCH 会把
                    「0.85」拆成 0 / 0. / 0.8 / 0.85 四次写入，中间三次都是**真的在改推演**。
                    ⚠ `<input type=number>` 的 `onBlur` 在受控值未变时也会触发，故先比一次再发。
                  */}
                  <td>
                    <input
                      data-testid={`orel-rule-coef-${r.key}`}
                      type="number"
                      step="0.05"
                      defaultValue={r.coefficient}
                      disabled={patchCoef.isPending}
                      onBlur={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next) || next === r.coefficient) return; // 没变就不发（不制造无意义的新版本）
                        patchCoef.mutate({ id: r.id, coefficient: next });
                      }}
                      style={{ width: 72 }}
                    />
                  </td>
                  <td>{r.delayTicks}</td>
                  <td data-testid={`orel-rule-status-${r.key}`}>{r.status === "PUBLISHED" ? "启用" : r.status === "DRAFT" ? "停用" : "已下线"}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {/*
                      启停：**一个按钮来回拨**。文案说的是「按下去会发生什么」，不是当前态
                      （当前态在左边那一列，重复一遍只会让两处措辞漂移）。
                      ⚠ 与结构边那三个按钮的关键差别：那边「停用/下线」只进不出，
                        这边 PUBLISHED ⇄ DRAFT 同一条路径，来回都走得通。
                    */}
                    <button
                      className="btn sm"
                      data-testid={`orel-rule-toggle-${r.key}`}
                      disabled={toggleRule.isPending || r.status === "RETIRED"}
                      onClick={() => toggleRule.mutate({ id: r.id, next: r.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED" })}
                    >
                      {r.status === "PUBLISHED" ? "停用" : "启用"}
                    </button>
                    {/*
                      删：**不在前端预判能不能删**。后端两道闸（还启用着 / 被会话点名引用）
                      各自回 409 并说清理由，`toastError` 原样上屏。
                      前端自己先判一遍 = 第二套真相源，且必然与后端漂移。
                    */}
                    <button
                      className="btn sm"
                      data-testid={`orel-rule-delete-${r.key}`}
                      disabled={removeRule.isPending}
                      onClick={() => removeRule.mutate(r.id)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* ── 出处（工程师层，不上屏；屏上只留业务结论）────────────────────────────────
       *  WO-CAUSAL-EDGE-CRUD（2026-09-03）之前，这里挂的是一条诚实位：
       *  「因果边只能新建，改不了、也停不掉」。**那句话当时是准的**，机制是
       *  `POST …/propagation-rules` 把 `id: newId("simpr")` 写在请求体展开之后 ⇒ 恒覆盖 ⇒ 每次都新建。
       *  真后端复现过：同 key POST 两次得两行（系数 0.5 与 0.9 并存、都 PUBLISHED），
       *  而 `propagateTick` 逐规则累加 ⇒ 两条都算，「改系数」的真实效果是两条相加。
       *
       *  现已闭：`POST` 改成按 key upsert（复用 id、version 递增、恒 1 行），
       *  并补了 `PATCH /:id`（系数/启停，**启停可来回**）与 `DELETE /:id`（两道闸后硬删）。
       *  故这条诚实位**撤掉**，换成下面这条讲「删为什么要先停用」的说明。
       *  复验探针：`grep -n 'app.patch("/a/v1/sim/propagation-rules' apps/datacore/src/app.ts`
       */}
      {/* 分层规范 §1 + §3：结论留第一层，整段「为什么」进浮层（降层不是删除）。 */}
      <div className="muted" data-testid="orel-rule-honesty" style={{ fontSize: 12, marginBottom: 18, display: "flex", alignItems: "center", gap: 6 }}>
        <span data-testid="orel-rule-honesty-mark">
          ⚠ 删一条因果边前，要先<b>停用</b>
        </span>
        <InfoPopover topic="为什么删之前必须先停用" testId="orel-rule-honesty-popover">
          <div style={{ lineHeight: 1.7 }}>
            一条<b>启用中</b>的因果边，按定义就在推演集合里。直接删掉，所有在跑的推演下一拍读数都会变，
            而屏上不会有任何东西说明为什么变 —— 这正是要避免的「结论静默偏离」。
            <br />
            所以删是<b>两步</b>：先「停用」——这一步<b>可逆</b>，读数怎么变当场就能看见，觉得不对再点「启用」拨回来；
            确认无碍之后再删。多这一次点击买的是「不可逆的动作挡在可逆的动作后面」。
            <br />
            另外，若这条边正被某些推演会话按名字点名引用，系统会<b>拒绝删除并列出是哪几个会话</b>，
            而不是删掉后在那些会话里留下一个查无对证的名字。
            <br />
            <b>同名即改</b>：建边表单里填一个<b>已存在</b>的规则名保存，是<b>覆盖</b>那一条（版本号 +1），
            不会多出第二条同名的边。
          </div>
        </InfoPopover>
      </div>

      {/* ═══════════ 不变式（第三类边）═══════════
        WO-ONTOLOGY-EDGE-TRICLASS · 前两类边**一个字都没动**（见文件头「两种边，别混」）。

        ── 为什么是第三类，而不是把前两类重排 ──────────────────────────────────
        结构边答「有没有关系」、因果边答「变了多少」，两者都在描述**有什么**。
        这一类描述的是**必须成立什么**：一条跨若干元素的守卫条件，为真即体检不通过，
        并能指出是**谁**违反了它。三者语义互不覆盖，故并列三类而非合并。

        ── 这一屏的数据从哪来（不许前端自带清单）────────────────────────────────
        守卫清单、守卫条件的业务话渲染、实测量、容差原值，**全部后端下发**
        （`fetchOntologyInvariants` / `evaluateOntologyInvariants`）。
        前端自带一份的后果是：后端目录一改它就静默过期，而没有任何机器会说话。

        ── 「改容差 / 停用」在这里是**试算**，不是治理动作 ───────────────────────
        上面结构边与对象类型那两处的「停用/下线」是治理动作：有宽限期、有「仍被 N 处
        引用就拒绝」的 409 闸、要会签发布。这一段的开关是**推演开关**：本地、即时、可逆、
        一个字节都不落库，刷新即还原。两套刻意分开写、分开措辞 ——
        合并会把「我想试试把这条守卫关掉看看谁会红」变成「我把这条守卫下线了」。
      */}
      <h3 style={{ fontSize: 13.5, margin: "16px 0 6px" }}>不变式 · 体检守卫</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.7 }}>
        第三类边：前两类说「有什么」，这一类说「<b>必须成立什么</b>」—— 条件为真即体检通过，不成立时逐条点名是谁违反的。
        <br />
        这里改容差、停开关都只是<b>试算</b>：立刻重算给你看，但不落库、不进会签，刷新页面即还原。
        与上面结构边的「停用/下线」不是一回事，那一套是要走会签的治理动作。
      </div>

      <div className="panel" data-testid="orel-inv-summary" style={{ marginBottom: 10, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, alignItems: "center" }}>
        <span data-testid="orel-inv-passed">成立 {inv ? inv.passed : "—"}</span>
        <span data-testid="orel-inv-violated" style={{ color: inv && inv.violated > 0 ? "var(--danger)" : undefined }}>
          不成立 {inv ? inv.violated : "—"}
        </span>
        <span data-testid="orel-inv-skipped" className="muted">
          未参与体检 {inv ? inv.skipped : "—"}
        </span>
        {/* 阻断裁决未下 ⇒ 如实说「只标注」，并把「真拦会拦掉几条」先算给人看。 */}
        <span data-testid="orel-inv-enforcement">
          {inv?.enforcement.blocking
            ? `不成立会拦住发布（${inv.enforcement.wouldBlock.length} 条）`
            : `不成立只标注、不拦任何动作${inv ? `；若改为拦住发布，会拦下 ${inv.enforcement.wouldBlock.length} 条` : ""}`}
        </span>
        {invDirty && (
          <button className="btn sm" data-testid="orel-inv-reset" onClick={() => setInvOverrides({})}>
            全部还原
          </button>
        )}
      </div>

      {/* 「改了容差，谁翻了」的直答 —— 不让用户自己在表里前后比对。 */}
      {inv && (inv.flippedToViolate.length > 0 || inv.flippedToHold.length > 0) && (
        <div className="panel" data-testid="orel-inv-flips" style={{ marginBottom: 10, fontSize: 12, lineHeight: 1.7 }}>
          {inv.flippedToViolate.length > 0 && (
            <div data-testid="orel-inv-flip-violate">
              因你这次的改动，<b>由成立转为不成立</b>：{inv.flippedToViolate.map((k) => invName(k)).join("、")}
            </div>
          )}
          {inv.flippedToHold.length > 0 && (
            <div data-testid="orel-inv-flip-hold">
              因你这次的改动，<b>由不成立转为成立</b>：{inv.flippedToHold.map((k) => invName(k)).join("、")}
            </div>
          )}
        </div>
      )}

      {inv && inv.items.length === 0 && <div className="empty-state">暂无不变式</div>}
      {inv && inv.items.length > 0 && (
        <table className="cmp" data-testid="orel-inv-table" style={{ width: "100%", marginBottom: 8 }}>
          <thead>
            <tr>
              <th>守卫</th>
              <th>守卫条件</th>
              <th style={{ width: 110 }}>实测</th>
              <th style={{ width: 150 }}>容差</th>
              <th style={{ width: 90 }}>当前</th>
              <th style={{ width: 110 }}>参与体检</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it) => {
              const tone = !it.enabled ? "var(--muted)" : it.holds ? "var(--ok)" : "var(--danger)";
              return (
                <Fragment key={it.key}>
                  <tr data-testid={`orel-inv-${it.key}`}>
                    <td>
                      {it.name}
                      {it.overridden && (
                        <span className="muted" data-testid={`orel-inv-overridden-${it.key}`} style={{ marginLeft: 6 }}>
                          （试算中）
                        </span>
                      )}
                    </td>
                    <td data-testid={`orel-inv-guard-${it.key}`}>{it.guardText}</td>
                    <td data-testid={`orel-inv-measure-${it.key}`}>
                      {it.measure.value}
                      {it.measure.unit ?? ""}
                    </td>
                    <td>
                      <input
                        data-testid={`orel-inv-tolerance-${it.key}`}
                        type="number"
                        step="any"
                        aria-label={`${it.name}的${it.tolerance.label}`}
                        value={it.tolerance.value}
                        onChange={(e) => setInvOverride(it.key, { tolerance: Number(e.target.value) })}
                        style={{ width: 74 }}
                      />
                      <span className="muted" style={{ marginLeft: 4 }}>
                        {it.tolerance.unit ?? ""}
                      </span>
                    </td>
                    <td data-testid={`orel-inv-status-${it.key}`} style={{ color: tone }}>
                      {it.error ? "读不出来" : it.holds ? "成立" : "不成立"}
                    </td>
                    <td>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                        <input
                          data-testid={`orel-inv-enabled-${it.key}`}
                          type="checkbox"
                          aria-label={`${it.name}参与体检`}
                          checked={it.enabled}
                          onChange={(e) => setInvOverride(it.key, { enabled: e.target.checked })}
                        />
                        <span className="muted">{it.enabled ? "参与" : "已停"}</span>
                      </label>
                    </td>
                  </tr>
                  {/* 违反者逐条点名 —— 只说「有 3 条不合规」而不说是哪三条，用户下一步就断了。 */}
                  {it.enabled && !it.holds && it.participants.length > 0 && (
                    <tr data-testid={`orel-inv-offenders-${it.key}`}>
                      <td colSpan={6} className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
                        违反的是：
                        {it.participants.map((p) => (
                          <span key={`${p.kind}-${p.key}`} style={{ marginRight: 10 }}>
                            <b className="mono">{p.key}</b>（{p.reason}）
                          </span>
                        ))}
                      </td>
                    </tr>
                  )}
                  {it.error && (
                    <tr data-testid={`orel-inv-error-${it.key}`}>
                      <td colSpan={6} className="muted" style={{ fontSize: 12 }}>
                        这条守卫这次没能算出来：{it.error}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="muted" data-testid="orel-inv-honesty" style={{ fontSize: 12, marginBottom: 18, lineHeight: 1.7 }}>
        ⚠ 停用一条守卫<b>不会让问题消失</b>，只是这一轮不体检它 —— 实测值照算、照显示。
        <br />
        ⚠ 违反时目前<b>只标红，不拦任何动作</b>（发布、采纳都照常）。「该拦什么」还没定；定下来之前，
        这里先把「真要拦会拦下哪几条」如实算给你看。
      </div>

      {/* ═══════════ 关系两端的对象类型 · 弃用流程 ═══════════ */}
      <h3 style={{ fontSize: 13.5, margin: "16px 0 6px" }}>对象类型 · 弃用流程</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.7 }}>
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
        <span className="muted" style={{ fontSize: 12 }}>
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
      <div className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.7 }}>
        上面的建/停/下线写的是<b>工作集</b>，不是已发布真值。真值是 <code>OntologyVersion</code> 快照 ——
        经<b>各域 owner 会签</b>后由后端自动固化（全域 APPROVE → <code>publishVersion</code>）。
        本页<b>不提供</b>「直接发布」按钮：那条路会绕开会签。
      </div>
      <div className="panel" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <button className="btn primary sm" data-testid="orel-publish-open" disabled={openPublish.isPending} onClick={() => openPublish.mutate()}>
          发起发布会签
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
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
