import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeImpactPreview, OntologyInvariantOverride, PropagationRule } from "@platform/contracts";
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
  previewChangeImpact,
  retireOntologyElement,
  setPropagationRuleStatus,
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
    description: "",
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
        // 空串 → `null`：「没写说明」与「写了个空字符串」是两件事，落库要落成前者。
        description: pr.description.trim() === "" ? null : pr.description.trim(),
      }),
    onSuccess: (r) => {
      toast(`因果边 ${r.key} 已建（${r.status === "PUBLISHED" ? "启用" : "停用"}）`, "success");
      setPr((p) => ({ ...p, key: "", sourceStateVar: "", targetStateVar: "", description: "" }));
      void qc.invalidateQueries({ queryKey: ["a", "sim-propagation-rules"] });
      // 这一跳就是接缝：因果边一变，沙盘视图配置（stateVars / propagationCount）必须重取。
      void qc.invalidateQueries({ queryKey: ["a", "sim-view-config"] });
    },
    onError: toastError,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WO-ONTOLOGY-EDGE-EDIT · 因果边：改 / 启停 / 删（此前本页**只读**）
  //
  // **今天的行为是 X**（本单开工前实测）：这张表只有 5 个 `<td>` 纯文本，没有任何写回；
  //   页面底下挂着一条诚实位「⚠ 因果边今天只能新建」，理由是 `POST` 恒 mint 新 id。
  // **应该是 Y**：三列可改（来源 / 去向 / 关系）+ 影响说明可写 + 勾选框启停 + ✕ 删除，
  //   写回走后端新补的 `PUT /:id`、`PATCH /:id/status`、`DELETE /:id`。
  //
  // ── 改法为什么是「草稿 + 显式保存」，不是逐键自动保存 ──────────────────────
  // 这三列是**本体真值**（全租户可见、进推演）。逐键 PUT 意味着用户把 `Model` 改成 `Mode`
  // 的中途就落一次库，屏上还看不出发生过 —— 本仓对"静默写真值"一贯是拒绝的。
  // 故改动先进 `edits` 草稿，行尾出现「保存 / 放弃」，按下才写。
  //
  // ⛔ **下拉选项一律后端现取**，前端不自带任何枚举：
  //   来源/去向类型 ← `fetchObjectTypes`；关系 ← `fetchMappingRegistries().linkTypes`；
  //   状态变量 ← `fetchSimViewConfig().stateVars`（后端从传导规则 source/target 派生）。
  //   前端手抄一份的后果本页文件头已写过：新增一个类型忘了加进去，它就从选项里消失，
  //   而没有任何机器会报错 —— 永远绿、永远漏。
  // ══════════════════════════════════════════════════════════════════════════
  type RuleEdit = Partial<Pick<PropagationRule, "sourceTypeKey" | "sourceStateVar" | "viaLinkKey" | "targetTypeKey" | "targetStateVar" | "description">>;
  const [edits, setEdits] = useState<Record<string, RuleEdit>>({});
  /** 「按下去之前看波及面」的确认闸：`null` = 没有待确认的动作。 */
  const [pending, setPending] = useState<
    { rule: PropagationRule; act: "disable" | "delete"; preview: ChangeImpactPreview | null; loading: boolean } | null
  >(null);

  /** 状态变量选项 = 后端 view-config 派生的那一份（前端不另立清单）。 */
  const stateVarOptions = viewCfg.data?.stateVars ?? [];
  /** 裸键 → 人话名（后端单源表，查不到就显裸键，不编名字）。 */
  const stateVarNames = rules.data?.stateVarNames ?? {};
  const svLabel = (k: string) => (stateVarNames[k] ? `${stateVarNames[k]}（${k}）` : k);

  /** 草稿叠加在真值上 —— 屏上显示的永远是「这一行按下保存后会变成什么」。 */
  const merged = (r: PropagationRule): PropagationRule => ({ ...r, ...(edits[r.id] ?? {}) });
  const isDirty = (id: string) => Object.keys(edits[id] ?? {}).length > 0;
  const patchEdit = (id: string, p: RuleEdit) => setEdits((s) => ({ ...s, [id]: { ...(s[id] ?? {}), ...p } }));
  const dropEdit = (id: string) => setEdits((s) => { const n = { ...s }; delete n[id]; return n; });

  /** 因果边一变，沙盘视图配置（stateVars / propagationCount）必须重取 —— 这一跳就是接缝。 */
  const invalidateRules = () => {
    void qc.invalidateQueries({ queryKey: ["a", "sim-propagation-rules"] });
    void qc.invalidateQueries({ queryKey: ["a", "sim-view-config"] });
  };

  const saveRule = useMutation({
    mutationFn: (r: PropagationRule) => {
      const m = merged(r);
      return updatePropagationRule(r.id, {
        key: m.key,
        sourceTypeKey: m.sourceTypeKey,
        sourceStateVar: m.sourceStateVar,
        viaLinkKey: m.viaLinkKey,
        targetTypeKey: m.targetTypeKey,
        targetStateVar: m.targetStateVar,
        coefficient: m.coefficient,
        delayTicks: m.delayTicks,
        status: m.status,
        description: m.description,
      });
    },
    onSuccess: (r) => { dropEdit(r.id); toast(`因果边 ${r.key} 已改`, "success"); invalidateRules(); },
    onError: toastError,
  });

  const toggleRule = useMutation({
    mutationFn: (v: { id: string; status: "DRAFT" | "PUBLISHED" }) => setPropagationRuleStatus(v.id, v.status),
    onSuccess: (r) => {
      setPending(null);
      toast(`因果边 ${r.key} 已${r.status === "PUBLISHED" ? "启用（进推演）" : "停用（在册不生效）"}`, "success");
      invalidateRules();
    },
    onError: toastError,
  });

  const removeRule = useMutation({
    mutationFn: (r: PropagationRule) => deletePropagationRule(r.id),
    onSuccess: () => { setPending(null); toast("因果边已删除", "success"); invalidateRules(); },
    onError: toastError,
  });

  /**
   * 关一条边 / 删一条边**按下去之前**先问后端要波及面。
   * ⛔ **不重造**：走既有的 `POST /a/v1/sim/change-impact-preview`（四桶 + 逐跳 + unresolved 诚实位）。
   * 只读、且**只在用户点了才发** —— 挂在悬停上每划过一行就发一次，是把只读语义做成副作用节奏。
   */
  const askImpact = async (rule: PropagationRule, act: "disable" | "delete") => {
    setPending({ rule, act, preview: null, loading: true });
    try {
      const p = await previewChangeImpact({ kind: "propagationRule", ruleKey: rule.key });
      setPending((s) => (s && s.rule.id === rule.id ? { ...s, preview: p, loading: false } : s));
    } catch (e) {
      // 预览失败**不等于「没有波及」**：把闸留着、把原因说出来，让用户自己决定要不要硬来。
      setPending((s) => (s && s.rule.id === rule.id ? { ...s, preview: null, loading: false } : s));
      toastError(e);
    }
  };

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
        <input
          data-testid="orel-rule-desc"
          aria-label="新增因果边的影响说明"
          placeholder="影响说明（这条边在业务上是什么意思）"
          value={pr.description}
          onChange={(e) => setPr({ ...pr, description: e.target.value })}
          style={{ width: 260 }}
        />
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
          {/* 列宽写死成百分比：auto-layout 会把「影响说明」挤成一条缝（实测截图里只看得到 6 个字），
              而那一列正是本单要让人读的东西 —— 它必须比三个 key 下拉更宽。 */}
          <table className="cmp" style={{ width: "100%", tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ width: "19%" }}>来源</th>
                <th style={{ width: "19%" }}>去向</th>
                <th style={{ width: "16%" }}>关系</th>
                <th style={{ width: "34%" }}>影响说明</th>
                <th style={{ width: 44, textAlign: "center" }}>启</th>
                <th style={{ width: 96 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r0) => {
                const r = merged(r0);
                const dirty = isDirty(r0.id);
                const on = r.status === "PUBLISHED";
                return (
                  <tr key={r0.id} data-testid={`orel-rule-${r0.key}`} data-dirty={dirty ? "true" : "false"}>
                    {/* 来源 = 对象类型 + 状态变量，两个都是**后端现取**的下拉 */}
                    <td>
                      <select
                        data-testid={`orel-rule-srctype-${r0.key}`}
                        aria-label={`因果边 ${r0.key} 的来源对象类型`}
                        value={r.sourceTypeKey}
                        onChange={(e) => patchEdit(r0.id, { sourceTypeKey: e.target.value })}
                        style={{ width: "100%", marginBottom: 2 }}
                      >
                        {/* 现值若已不在本体里（类型被删/改名），仍列出来并标注 —— 悄悄换成别的值就是替用户改了本体 */}
                        {!typeOptions.includes(r.sourceTypeKey) && <option value={r.sourceTypeKey}>{r.sourceTypeKey}（本体中已不存在）</option>}
                        {typeOptions.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                      <select
                        data-testid={`orel-rule-srcvar-${r0.key}`}
                        aria-label={`因果边 ${r0.key} 的来源状态变量`}
                        value={r.sourceStateVar}
                        onChange={(e) => patchEdit(r0.id, { sourceStateVar: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        {!stateVarOptions.includes(r.sourceStateVar) && <option value={r.sourceStateVar}>{svLabel(r.sourceStateVar)}</option>}
                        {stateVarOptions.map((k) => <option key={k} value={k}>{svLabel(k)}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        data-testid={`orel-rule-tgttype-${r0.key}`}
                        aria-label={`因果边 ${r0.key} 的去向对象类型`}
                        value={r.targetTypeKey}
                        onChange={(e) => patchEdit(r0.id, { targetTypeKey: e.target.value })}
                        style={{ width: "100%", marginBottom: 2 }}
                      >
                        {!typeOptions.includes(r.targetTypeKey) && <option value={r.targetTypeKey}>{r.targetTypeKey}（本体中已不存在）</option>}
                        {typeOptions.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                      <select
                        data-testid={`orel-rule-tgtvar-${r0.key}`}
                        aria-label={`因果边 ${r0.key} 的去向状态变量`}
                        value={r.targetStateVar}
                        onChange={(e) => patchEdit(r0.id, { targetStateVar: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        {!stateVarOptions.includes(r.targetStateVar) && <option value={r.targetStateVar}>{svLabel(r.targetStateVar)}</option>}
                        {stateVarOptions.map((k) => <option key={k} value={k}>{svLabel(k)}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        data-testid={`orel-rule-link-${r0.key}`}
                        aria-label={`因果边 ${r0.key} 经由的结构边`}
                        value={r.viaLinkKey}
                        onChange={(e) => patchEdit(r0.id, { viaLinkKey: e.target.value })}
                        style={{ width: "100%" }}
                      >
                        {!linkRows.some((l) => l.key === r.viaLinkKey) && <option value={r.viaLinkKey}>{r.viaLinkKey}（不在结构边表里）</option>}
                        {linkRows.map((l) => <option key={l.key} value={l.key}>{l.key}</option>)}
                      </select>
                      <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
                        ×{r.coefficient}
                        {r.delayTicks > 0 ? ` · 延迟${r.delayTicks}` : ""}
                      </div>
                    </td>
                    <td>
                      <input
                        data-testid={`orel-rule-desc-${r0.key}`}
                        aria-label={`因果边 ${r0.key} 的影响说明`}
                        // `null` = 作者没写说明 ⇒ 空输入框 + 占位提示，**不拿 key 顶替**（顶替就是编一句他没写过的解释）
                        value={r.description ?? ""}
                        placeholder="这条边在业务上是什么意思"
                        onChange={(e) => patchEdit(r0.id, { description: e.target.value === "" ? null : e.target.value })}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td style={{ textAlign: "center" }} data-testid={`orel-rule-status-${r0.key}`} data-status={r.status}>
                      <input
                        type="checkbox"
                        data-testid={`orel-rule-toggle-${r0.key}`}
                        aria-label={`因果边 ${r0.key} 是否启用（进推演）`}
                        checked={on}
                        disabled={toggleRule.isPending}
                        onChange={() => {
                          // 关掉是**减少**能力：先给波及面再落。开回来只是恢复，直接落。
                          if (on) void askImpact(r0, "disable");
                          else toggleRule.mutate({ id: r0.id, status: "PUBLISHED" });
                        }}
                      />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {dirty ? (
                        <>
                          <button
                            className="btn primary sm"
                            data-testid={`orel-rule-save-${r0.key}`}
                            disabled={saveRule.isPending}
                            onClick={() => saveRule.mutate(r0)}
                          >
                            保存
                          </button>
                          <button className="btn sm" data-testid={`orel-rule-cancel-${r0.key}`} onClick={() => dropEdit(r0.id)} style={{ marginLeft: 4 }}>
                            放弃
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn sm"
                          data-testid={`orel-rule-delete-${r0.key}`}
                          aria-label={`删除因果边 ${r0.key}`}
                          onClick={() => void askImpact(r0, "delete")}
                          style={{ color: "var(--danger, #c62828)" }}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* ── WO-ONTOLOGY-EDGE-EDIT · 那条「只能新建」的诚实位**已撤**（撤得有据，不是删掉了事）──
       *  它原文写的是：「`POST …/propagation-rules` 把 `id: newId("simpr")` 写在请求体展开之后 ⇒
       *  传进去的 id 恒被覆盖 ⇒ 只能新建；真·启停需后端补 PUT/PATCH …/:id（后端单）。」
       *  **那张后端单已经做了**：`app.ts` 该路由组现有 `PUT /:id`、`PATCH /:id/status`、`DELETE /:id`，
       *  三条都先按 tenantId 读一次再写（跨租户实测 404）。诚实位的前提没了，留着它就成了谎话
       *  —— 本仓的纪律是诚实位随事实走，事实变了就撤，不是"留着更谨慎"。
       *  `test/ontology-relations.seam.test.tsx` §④ 那条断言同批反转（它本来就是为这一天写的）。
       */}
      <div className="muted" data-testid="orel-rule-honesty" style={{ fontSize: 12, marginBottom: 18, display: "flex", alignItems: "center", gap: 6 }}>
        <span data-testid="orel-rule-honesty-mark">
          关闭某条边会<b>切断该传播路径</b>
        </span>
        <InfoPopover topic="「启」这一列到底改了什么" testId="orel-rule-honesty-popover">
          <div style={{ lineHeight: 1.7 }}>
            取消勾选 = 把这条边置为<b>停用（在册不生效）</b>：它仍然留在这张表里、随时可以拨回来，
            但推演不再走它 —— 沿这条路径下游的那些量<b>不会再被这条边推动</b>。
            <br />
            ✕ 是<b>删除</b>，不可逆：删掉之后这条边不在册，拨不回来。要"先关掉看看"请用勾选框，不要用 ✕。
            <br />
            两者按下去之前都会先算一次<b>波及面</b>给你看 —— 那是后端现算的，不是这里编的清单。
          </div>
        </InfoPopover>
      </div>

      {/* ══ 波及面确认闸（改之前先看见「切断这条会影响什么」）══════════════════════════
          ⛔ 四桶 + 逐跳计数 + `unresolved` 诚实位**原样上屏**：契约原文写死了
          「空集不许冒充『没有波及』」—— items 空 **且** unresolved 空 = 焦点确为叶子；
          unresolved 非空 = 有算不出来的部分。两者屏上必须分开说，合成一句就是本仓最恨的那种谎。 */}
      {pending && (
        <div className="panel" data-testid="orel-impact-gate" style={{ marginBottom: 18, borderColor: "var(--danger, #c62828)" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {pending.act === "delete" ? "删除" : "停用"}因果边 <span className="mono">{pending.rule.key}</span>：先看波及面
          </div>
          <div className="muted mono" style={{ fontSize: 12, marginBottom: 8 }}>
            {pending.rule.sourceTypeKey}.{pending.rule.sourceStateVar} --{pending.rule.viaLinkKey}--&gt; {pending.rule.targetTypeKey}.{pending.rule.targetStateVar}
          </div>

          {pending.loading && <div className="muted" data-testid="orel-impact-loading" style={{ fontSize: 12 }}>{zh.common.loading}</div>}

          {!pending.loading && pending.preview === null && (
            <div data-testid="orel-impact-failed" style={{ fontSize: 12, color: "var(--danger-txt, #c62828)", lineHeight: 1.7 }}>
              <b>这次没算出波及面</b>（预览请求失败）。这与「没有波及」<b>不是一回事</b> ——
              下面的按钮仍然可用，但你是在没有波及面的情况下按的。
            </div>
          )}

          {!pending.loading && pending.preview && (() => {
            const p = pending.preview;
            const LABEL: Record<string, string> = {
              recompute: "传导重算", rederive: "派生重算", rejudge: "规则重判", rewire: "结构改写",
            };
            const buckets = ["recompute", "rederive", "rejudge", "rewire"] as const;
            return (
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div data-testid="orel-impact-buckets" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
                  {buckets.map((b) => {
                    const inB = p.items.filter((i) => i.bucket === b);
                    const hops = [...new Set(inB.map((i) => i.hops))].sort((x, y) => x - y);
                    return (
                      <span key={b} data-testid={`orel-impact-bucket-${b}`}>
                        {LABEL[b]} <b>{inB.length}</b>
                        {inB.length > 0 && <span className="muted">（{hops.map((h) => `${h}跳×${inB.filter((i) => i.hops === h).length}`).join(" ")}）</span>}
                      </span>
                    );
                  })}
                </div>

                {/* 「一条都没算到」与「算到了 0 条」在屏上必须长得不一样 */}
                {p.items.length === 0 && p.unresolved.length === 0 && (
                  <div data-testid="orel-impact-leaf" style={{ color: "var(--ok, #2e7d32)" }}>
                    {/*
                     * ⚠ 下面那句话里的「四类」赌的是一个**静态事实**：波及桶枚举恰好 4 个成员。
                     * 它头顶的运行时守卫 `p.items.length === 0 && p.unresolved.length === 0`
                     * 只覆盖「一条都没有」与「没有算不出来的部分」两句，**看不见「四类」这个数**——
                     * 枚举加到第 5 个时，这行绿字会照旧显示，而上面那排桶计数（`buckets`）也只画
                     * 4 格，第 5 类的波及在屏上**根本不出现**：用户会据此把一条并非叶子的边删掉。
                     * 这是屏上说谎，不是记账错误，故把赌注写成机器能跑的断言，上游一动门当场红。
                     *
                     * ⚠ **两条缺一不可**，理由是变异反证逼出来的，不是凑数：
                     * 第一条只赌「这四个名字各在一次」——**加第 5 个成员它照样绿**（实测：把枚举
                     * 改成五成员后现算仍是 4，门不出声）。第二条赌「成员恰好四个」才咬得住新增。
                     * 两条合起来才覆盖 改名/删除（第一条）与 新增（第二条）三种走法。
                     * @stale-fact packages/contracts/src/sim.ts /"(?:recompute|rederive|rejudge|rewire)"/ ==4
                     * @stale-fact packages/contracts/src/sim.ts /bucket: z\.enum\(\["[a-z]+", "[a-z]+", "[a-z]+", "[a-z]+"\]\)/ ==1
                     * 记号挂于 2026-08-29 · 复验：`node scripts/check-stale-claims.mjs`
                     * 上游真相源：`packages/contracts/src/sim.ts` 的 `bucket: z.enum([...])`
                     */}
                    这条边确为<b>叶子</b>：四类波及一条都没有，且没有算不出来的部分 —— 关掉它不会带动别的东西。
                  </div>
                )}
                {p.unresolved.length > 0 && (
                  <div data-testid="orel-impact-unresolved" style={{ color: "var(--warn, #b26a00)" }}>
                    <b>这次没算全</b>（{p.unresolved.length} 处追不到）——{p.items.length === 0 ? "所以上面那排 0 不等于「没有波及」，" : ""}
                    下面逐条写明什么追不到、缺什么：
                    <ul style={{ margin: "2px 0 0 16px" }}>
                      {p.unresolved.map((u, i) => (
                        <li key={i} className="mono" style={{ fontSize: 11 }}>{u.what} —— {u.missing}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.truncated && (
                  <div data-testid="orel-impact-truncated" style={{ color: "var(--warn, #b26a00)" }}>
                    已到 {p.maxHops} 跳保险丝，更远的没有继续追 —— 波及面<b>至少</b>这么大，不是恰好这么大。
                  </div>
                )}
                {p.items.length > 0 && (
                  <details data-testid="orel-impact-items" style={{ marginTop: 4 }}>
                    <summary style={{ cursor: "pointer" }}>逐条看被波及的目标（{p.items.length}）▸</summary>
                    <div className="mono" style={{ fontSize: 11, maxHeight: 180, overflowY: "auto", marginTop: 4 }}>
                      {p.items.slice(0, 200).map((i, n) => (
                        <div key={n}>{LABEL[i.bucket]} · {i.target} · {i.hops}跳 · 经 {i.via}</div>
                      ))}
                      {p.items.length > 200 && <div className="muted">…另有 {p.items.length - 200} 条未列出（只是没画，不是没有）</div>}
                    </div>
                  </details>
                )}
              </div>
            );
          })()}

          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              className="btn sm"
              data-testid="orel-impact-confirm"
              disabled={pending.loading || toggleRule.isPending || removeRule.isPending}
              style={{ color: "var(--danger, #c62828)" }}
              onClick={() =>
                pending.act === "delete"
                  ? removeRule.mutate(pending.rule)
                  : toggleRule.mutate({ id: pending.rule.id, status: "DRAFT" })
              }
            >
              {pending.act === "delete" ? "确认删除（不可逆）" : "确认停用"}
            </button>
            <button className="btn sm" data-testid="orel-impact-cancel" onClick={() => setPending(null)}>
              取消
            </button>
          </div>
        </div>
      )}

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
