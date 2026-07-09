import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tokenStore } from "@/api/tokenStore";
import {
  createSimSession,
  deriveModeling,
  fetchBusinessDomains,
  fetchLlmBindings,
  fetchModelingCoverage,
  fetchModelingDrafts,
  fetchObjectTypes,
  fetchObjectTypeStats,
  fetchRawDatasets,
  fetchSimCertification,
  fetchSyncJob,
  materializeDraft,
  patchModelingDraft,
  publishModelingDraft,
  suggestModeling,
  type FieldCoverageVM,
  type ModelingDraftVM,
} from "@/api/endpoints";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { DataSourcePanel } from "@/components/DataSourcePanel";
import { SimReadinessPanel } from "@/views/sim/SimReadinessPanel";
import { PlatformConsole } from "@/components/PlatformConsole/PlatformConsole";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "./ModelingPage.module.css";

const t = zh.admin.modeling;

/**
 * 反应式 token 就绪（评审复核修）：access token 仅存内存（tokenStore），pushState/直挂载等场景组件可能
 * **早于 token 就绪挂载** → 查询 retry:false 时一次 401 error 不重试 → 卡片永久"暂无"。用 useSyncExternalStore
 * 订阅 tokenStore，token 到位即反应式重渲染 → enabled 打开 → 查询自动发起（根因修，零重试浪费）。
 */
function useHasToken(): boolean {
  return useSyncExternalStore(tokenStore.subscribe, () => tokenStore.get() != null, () => false);
}

/**
 * 轨P 增量2/3 共享：建/复用一个极简 SimSession（空 baseSnapshot）——仅为驱动 deriveCertification
 * （全局就绪 + 逐对象就绪）。整页一个 session，全局面板与对象抽屉共用（不各建一个，省往返）。
 * entOff：sim.certification entitlement 关 → 诚实降级（不画假认证）。
 */
function useCertSession() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [entOff, setEntOff] = useState(false);
  const hasToken = useHasToken();
  useEffect(() => {
    // 评审复核修：token 未就绪不建会话（否则一次 401 → entOff 永久真 → 认证面板永久"功能未开"）。
    if (!hasToken) return;
    let alive = true;
    (async () => {
      try { const s = await createSimSession({ baseSnapshot: {}, scope: {} }); if (alive) setSessionId(s.id); }
      catch { if (alive) setEntOff(true); }
    })();
    return () => { alive = false; };
  }, [hasToken]);
  return { sessionId, entOff };
}

/** 本体建模工作台（PRD §7.6）：AI 建议草案（A3 suggest）+ 三栏 = 源字段 | 映射画布 | 操作面板；PATCH 乐观更新+回滚 */
export default function ModelingPage() {
  const queryClient = useQueryClient();
  const hasToken = useHasToken();
  // C1 断点（OPTIONA-B1B2-UX）：无 LLM 用途绑定时进建模页 → 诚实降级 UX（非白屏非假成功）。
  // 判据 = bindings.length===0（LLM-ROLE-RESOLUTION-FIX 不变量：绑定任一大类即覆盖全部用途，
  // 故任一绑定在场即 AI 建议可经跨角色兜底解析——无需 modeling 用途单独绑定）。
  // token 未就绪 / 查询报错 → bindings 保持 undefined → 不判定"无绑定"（避免假阳降级），诚实等待。
  const { data: llmBindingsData } = useQuery({
    queryKey: ["a", "llm-bindings"],
    queryFn: fetchLlmBindings,
    enabled: hasToken,
    retry: false,
  });
  const noLlmBound = llmBindingsData !== undefined && (llmBindingsData.bindings?.length ?? 0) === 0;
  const { data: drafts } = useQuery({ queryKey: ["a", "modeling-drafts", {}], queryFn: fetchModelingDrafts });
  // 轨L 增量3：已发布本体（中心真值闭合权威源）——本体已存在则中心绝不显"暂无本体"（非只看草案）。
  const { data: publishedTypes } = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const [draftId, setDraftId] = useState<string | null>(null);
  // 原型 intake「建模为新类型」深链：?datasets=id1,id2 → 自动开新建草案弹窗并预选这些数据集。
  const [params, setParams] = useSearchParams();
  const preselect = (params.get("datasets") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [suggestOpen, setSuggestOpen] = useState(preselect.length > 0);
  const draft = drafts?.find((d) => d.id === draftId) ?? drafts?.[0];
  // 轨P 增量3/4：共享 cert session + 选中对象。选中(selectedType)与抽屉开合(drawerOpen)解耦——
  // 关抽屉不清选中，中栏「执行节点」胶囊 + Agent 指挥台仍反映当前选中对象（image2 形态）。
  const { sessionId: certSessionId, entOff: certEntOff } = useCertSession();
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selectedTypeObj = publishedTypes?.find((ty) => ty.key === selectedType) ?? null;
  const openObject = (key: string) => { setSelectedType(key); setDrawerOpen(true); };

  // 任务#2 创建过程管道：活动草案（与下方下拉同源 = draft），状态全取真草案态（R14）。
  const activeDraft = draft ?? null;
  const hasActiveDraft = !!activeDraft;
  // ③ 字段全建模门 coverage（真值·驱动阶段③/⑤ %）；仅活动草案时拉。
  const { data: pipelineCoverage } = useQuery({
    queryKey: ["a", "modeling-coverage", activeDraft?.id ?? "", activeDraft?.suggestion.objectTypes.length ?? 0],
    queryFn: () => fetchModelingCoverage(activeDraft!.id),
    enabled: !!activeDraft,
    retry: false,
  });
  // ⑥ 物化信号（真值）：本草案的类型键里，已物化(materialized=true)的计数。
  const { data: typeStats } = useQuery({ queryKey: ["a", "object-type-stats"], queryFn: fetchObjectTypeStats });
  const draftTypeKeys = new Set((activeDraft?.suggestion.objectTypes ?? []).map((o) => o.existingTypeKey ?? o.typeKey));
  const materializedCount = (typeStats?.stats ?? []).filter((s) => draftTypeKeys.has(s.key) && s.materialized).length;
  // 草案态数据流 DAG：受控展开（点阶段③→展开）；用真草案 suggestion 适配为 DAG 形状。
  const [draftDagOpen, setDraftDagOpen] = useState(true);
  const draftDagTypes = activeDraft ? draftTypesForDag(activeDraft) : [];
  const showDraftDag = hasActiveDraft && draftDagTypes.length > 0;
  // 阶段点击锚点（客户端滚动，不掉登录）：①数据源 ②建议/操作 ④操作面板 ⑥已发布本体。
  const dataSourceRef = useRef<HTMLDivElement>(null);
  const draftDagRef = useRef<HTMLDivElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const publishedRef = useRef<HTMLDivElement>(null);
  const onPipelineStage = (stage: number) => {
    const scroll = (el: HTMLElement | null) => el?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (stage === 1) scroll(dataSourceRef.current);
    else if (stage === 2 || stage === 4) {
      if (activeDraft) scroll(workbenchRef.current);
      else setSuggestOpen(true);
    } else if (stage === 3) {
      setDraftDagOpen(true);
      scroll(draftDagRef.current);
    } else if (stage === 5) scroll(workbenchRef.current);
    else if (stage === 6) scroll(publishedRef.current ?? workbenchRef.current);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <select value={draft?.id ?? ""} onChange={(e) => setDraftId(e.target.value)} aria-label="选择草案">
          {(drafts ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.id} · {d.status}
            </option>
          ))}
        </select>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} data-testid="modeling-new-draft" onClick={() => setSuggestOpen(true)}>
          {t.newDraft}
        </button>
      </div>
      {/* C1 断点 · 无 LLM 绑定诚实降级横幅（非白屏非假成功）：明确"AI 建议不可用" + 两条可行动路径
          （① 去配置 LLM 用途绑定 · ② 走确定性建模无需 LLM）。文案对齐 LLM-ROLE-RESOLUTION-FIX。 */}
      {noLlmBound && (
        <div
          data-testid="modeling-llm-degraded"
          style={{
            marginBottom: 12, padding: "10px 12px", borderRadius: 8, fontSize: 12.5, lineHeight: 1.7,
            border: "1px solid var(--amber,#DD9551)", background: "rgba(221,149,81,.12)", color: "var(--txt)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            ⚠ 未绑定任何 LLM 用途 — AI 建模建议当前不可用（诚实降级，不空白、不假成功）
          </div>
          <div style={{ color: "var(--muted2)" }}>
            两条可行动路径：
            <b> ① 去配置 LLM 用途绑定</b>（
            <Link to="/admin/llm-providers" data-testid="modeling-llm-config-link" style={{ color: "var(--accent,#7E8BEE)" }}>设置 → LLM 用途绑定</Link>
            ）——<b>绑定任一大类即覆盖全部用途，无需逐意图单独绑定</b>；
            或 <b>② 走确定性建模路径</b>（无需 LLM）：点上方「{t.newDraft}」选数据集 →「确定性建模（全字段）」，每个字段全建模 100% 覆盖后即可发布物化。
          </div>
        </div>
      )}
      {/* 任务#2 · 核心交付：本体模型「创建过程」低代码 Pipeline（6 阶段节点+连线·默认展开·状态驱动自真草案态）。
          放在草案选择器下方、就绪认证/成品 DAG 上方；有活动草案即显（不依赖已发布类型）。 */}
      {activeDraft && (
        <ModelingCreationPipeline
          draft={activeDraft}
          coverage={pipelineCoverage}
          materializedCount={materializedCount}
          onStage={onPipelineStage}
        />
      )}
      {/* 任务#2 · 次要：草案态数据流 DAG（在建草案管道）——复用既有 DataPipelineDag，喂 draft.suggestion 适配真字段映射，
          active draft 默认展开。点阶段③即展开此处看 dataset.sourceField→type.propKey 真映射。 */}
      {showDraftDag && (
        <div ref={draftDagRef}>
          <DataPipelineDag
            types={draftDagTypes}
            onSelectType={openObject}
            open={draftDagOpen}
            onToggle={setDraftDagOpen}
            draftMode
          />
        </div>
      )}
      {/* 轨P 增量1（数据流 DAG·竞品 image2 横向 ETL·R13 真字段映射）。点实体节点 → 开对象配置抽屉（增量3）。
          已发布成品本体的静态架构图（维持折叠默认·与上方草案管道互补）。 */}
      {publishedTypes && publishedTypes.length > 0 && (
        <div ref={publishedRef}>
          <DataPipelineDag types={publishedTypes} onSelectType={openObject} />
        </div>
      )}
      {/* 轨P 增量4 / 轨Q 回迁：中栏 6 子 tab + Agent 指挥台接 QOS——复用**共享 PlatformConsole**（消除与沙盘页重复·单一来源）。
          基本信息=增量2 就绪认证面板（slot）；Skills/MCP/日志=接现成真后端；图查询=③类§10.1 RESERVED；
          执行节点胶囊+Agent 逐对象注入经 execNode/agentSelectedObject 透传（建模页专属·image2 形态）。 */}
      {publishedTypes && publishedTypes.length > 0 && (
        <PlatformConsole
          testId="modeling-console"
          basicInfo={<GlobalReadinessPanel sessionId={certSessionId} entOff={certEntOff} embedded />}
          guide={
            <div style={{ fontSize: 13, color: "var(--txt)", lineHeight: 1.7 }} data-testid="modeling-guide">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>建模工作流指南</div>
              <ol style={{ paddingLeft: 18, color: "var(--muted2)" }}>
                <li>数据源 → 新建草案（A3 半自动/确定性建模）：选原始数据集，字段全建模（R12 门）。</li>
                <li>映射画布逐对象配置属性/派生/归域，发布 → 本体（当前 {publishedTypes.length} 类已发布·可溯 sourceDataset）。</li>
                <li>数据流 DAG 看真字段映射链；就绪认证看 L0-L4 真级 + 世界完整度。</li>
                <li>点对象看逐对象就绪 gauge（scope=LOCAL）；改属性走真草案 PATCH（持久化）。</li>
                <li>Agent 指挥台对选中对象提问 → QOS 推演（注入对象 presetContext）。</li>
              </ol>
            </div>
          }
          execNode={{
            label: selectedTypeObj?.displayName ?? null,
            onReopen: () => { if (selectedType) setDrawerOpen(true); },
            onClear: () => { setSelectedType(null); setDrawerOpen(false); },
          }}
          agentSelectedObject={selectedTypeObj ? {
            objectType: selectedTypeObj.key, objectId: selectedTypeObj.key, label: selectedTypeObj.displayName,
            summary: <>📌 node_obj_{selectedTypeObj.key} · {selectedTypeObj.displayName}：属性 {selectedTypeObj.properties.length} · 派生 {selectedTypeObj.derivedProperties?.length ?? 0} · 域 {selectedTypeObj.domain ?? "—"}</>,
          } : undefined}
        />
      )}
      {/* additive（RL9 可回退）：左侧数据源面板 + 右侧既有工作台/空态，原有区块零删改 */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ width: 248, flexShrink: 0 }} ref={dataSourceRef}>
          <DataSourcePanel drafts={drafts} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }} ref={workbenchRef}>
          {draft ? (
            <DraftWorkbench draft={draft} />
          ) : publishedTypes && publishedTypes.length > 0 ? (
            // 轨L 增量3：有已发布本体但无活动草案 → 显已发布本体（绝不"暂无本体"），可溯各自 sourceDataset。
            // 轨P 增量3：行可点 → 开对象配置抽屉（逐对象就绪 gauge·真 deriveCertification LOCAL）。
            <PublishedOntologyView types={publishedTypes} onSelectType={openObject} />
          ) : (
            // 管理平台增量 §6：真无本体（无草案且无已发布类型）→ 「从数据建模」或「一键合成」
            <EmptyState message={zh.admin.empty.ontology}>
              <button className="btn primary sm" onClick={() => setSuggestOpen(true)} data-testid="cta-modeling">
                {zh.admin.empty.modelingCta}
              </button>
              <Link className="btn sm" to="/admin/synthetic" data-testid="cta-synthetic">
                {zh.admin.empty.syntheticCta}
              </Link>
            </EmptyState>
          )}
        </div>
      </div>
      {/* 轨P 增量3：对象配置详情抽屉（复刻竞品 image5）——逐对象就绪 gauge=真 deriveCertification(LOCAL,target)，
          不同对象数字各不相同（禁全局值冒充）；改属性走真 patchModelingDraft（编辑草案）真持久化。 */}
      {drawerOpen && selectedTypeObj && (
        <ObjectConfigDrawer
          type={selectedTypeObj}
          sessionId={certSessionId}
          entOff={certEntOff}
          drafts={drafts ?? []}
          onClose={() => setDrawerOpen(false)}
        />
      )}
      {suggestOpen && (
        <SuggestModal
          noLlmBound={noLlmBound}
          initialSelected={preselect}
          onClose={() => { setSuggestOpen(false); if (params.has("datasets")) { params.delete("datasets"); setParams(params, { replace: true }); } }}
          onCreated={async (newDraftId) => {
            setSuggestOpen(false);
            if (params.has("datasets")) { params.delete("datasets"); setParams(params, { replace: true }); }
            await queryClient.invalidateQueries({ queryKey: ["a", "modeling-drafts"] });
            setDraftId(newDraftId);
          }}
        />
      )}
    </div>
  );
}

/**
 * 轨P 增量2（L0-L4 认证面板·复刻竞品 image6「全局仿真准备度（发布就绪）」）：
 * 接 `deriveCertification` 真级（demo 真态 L1_CONFIGURED·三维 structure/knowledge/behavior·世界完整度真 pct·
 * L4 四✓·entering 清单），**复用既有 `SimReadinessPanel`（不新建并行）**。建一个极简 SimSession（空 baseSnapshot·
 * 仅为算全局本体就绪）→ fetchSimCertification(GLOBAL)。**禁写死 100**：绿环/级别/三维全来自真后端 closure。
 * ③类不接：6 维健康雷达 / 4 维信任雷达（后端未建·§10③）→ 不传 radar（不画假壳）。
 */
function GlobalReadinessPanel({ sessionId, entOff, embedded = false }: { sessionId: string | null; entOff: boolean; embedded?: boolean }) {
  const [scope, setScope] = useState<"GLOBAL" | "LOCAL">("GLOBAL");
  const { data: cert, isLoading } = useQuery({
    queryKey: ["a", "modeling-readiness-cert", sessionId, scope],
    queryFn: () => fetchSimCertification(sessionId!, scope),
    enabled: !!sessionId, retry: false,
  });
  return (
    <div className={embedded ? "" : "panel"} data-testid="modeling-readiness" style={embedded ? {} : { padding: 12, marginBottom: 12 }}>
      <div className="section-title" style={{ marginBottom: 8 }}>全局仿真准备度（发布就绪）</div>
      {entOff ? (
        <div style={{ color: "var(--muted2)", fontSize: 12 }} data-testid="modeling-readiness-entoff">就绪认证功能未开（sim.certification entitlement off）——诚实降级，不画假认证。</div>
      ) : !cert ? (
        <div style={{ color: "var(--muted2)", fontSize: 12 }}>{isLoading ? "加载就绪认证…" : "建认证会话中…"}</div>
      ) : (
        // radar 不传：6维健康/4维信任雷达后端未建（§10③），不画假壳。
        <>
          <SimReadinessPanel cert={cert} scope={scope} onScopeChange={setScope} />
          {/* 诚实可见：L4 子项 Schema lint / 已持久化 后端无对应（§10③）→ 显式 RESERVED，不画假勾（继承轨M 真推演红线）。 */}
          <div data-testid="modeling-l4-reserved" style={{ marginTop: 8, fontSize: 11, color: "var(--muted2)", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>L4 子项（竞品 image6 有·本平台后端未建）：</span>
            <span data-testid="l4-reserved-schemalint">◌ Schema lint · RESERVED</span>
            <span data-testid="l4-reserved-persisted">◌ 已持久化 · RESERVED</span>
            <span style={{ opacity: 0.7 }}>（后端 backlog §10.1·建成后点亮，现不画假勾）</span>
          </div>
        </>
      )}
    </div>
  );
}


/**
 * 轨P 增量3（对象配置详情抽屉·复刻竞品 image5「选中实体」）：
 *  · 中：基础图谱表单（对象标签/类型键/主键/归域）+ 本体构建表（属性/派生 = 真 ObjectType 数据）。
 *  · 右：**局部准备度**——逐对象 `deriveCertification(scope=LOCAL,target=该类型)`，**不同对象数字各不相同**
 *        （禁把全局那组值复用到每个对象冒充逐对象）。GLOBAL 切换作对照（看全局≠局部）。
 *  · 改属性走**真 `patchModelingDraft`**（编辑草案·真持久化，刷新仍在）；仅当存在可编辑草案（status≠PUBLISHED
 *    且含该类型）时开放编辑，否则诚实只读（已发布本体已锁定，不提供假编辑）。
 *  · ③类不画假壳（§10③）：本体构建的 类型/函数/行动/安全 tab + 存储模式/对象描述 后端无 → 显式 RESERVED。
 */
function ObjectConfigDrawer({
  type, sessionId, entOff, drafts, onClose,
}: {
  type: Awaited<ReturnType<typeof fetchObjectTypes>>[number];
  sessionId: string | null;
  entOff: boolean;
  drafts: ModelingDraftVM[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"GLOBAL" | "LOCAL">("LOCAL");
  const [tab, setTab] = useState<"属性" | "派生">("属性");
  const [renaming, setRenaming] = useState<{ prop: string; value: string } | null>(null);
  // 逐对象 cert：LOCAL 带 target=该类型 → 真·逐对象真值（不同对象不同）；GLOBAL 不带 target 作对照。
  const { data: cert, isLoading: certLoading } = useQuery({
    queryKey: ["a", "modeling-objcert", sessionId, scope, type.key],
    queryFn: () => fetchSimCertification(sessionId!, scope, scope === "LOCAL" ? type.key : undefined),
    enabled: !!sessionId, retry: false,
  });
  // 可编辑草案绑定（改属性真持久化的落点）：含该 typeKey 且未发布。
  const editableDraft = drafts.find((d) => d.status !== "PUBLISHED" && (d.suggestion?.objectTypes ?? []).some((t) => t.typeKey === type.key));
  const editableType = editableDraft?.suggestion.objectTypes.find((t) => t.typeKey === type.key);
  const { data: domainsData } = useQuery({ queryKey: ["a", "business-domains"], queryFn: fetchBusinessDomains });
  const domains = domainsData?.domains ?? [];
  // 真 PATCH（编辑草案的该类型）→ 失效 drafts（刷新仍在=真持久化，非乐观）。
  const patchMut = useMutation({
    mutationFn: (operation: Record<string, unknown>) => patchModelingDraft(editableDraft!.id, operation),
    onSuccess: async () => {
      toast("已保存（真持久化到草案，刷新仍在）", "success");
      setRenaming(null);
      await queryClient.invalidateQueries({ queryKey: ["a", "modeling-drafts"] });
    },
    onError: (e) => { toast("保存失败", "error"); toastError(e); },
  });
  // 属性/主键/归域：存在可编辑草案时显**草案**值（改动即时反映 + 真持久化），否则显已发布类型（只读）。
  const displayProps = editableType?.properties ?? type.properties;
  const pk = displayProps.find((p) => p.isPrimaryKey)?.propKey ?? null;
  const liveDomain = editableType?.domain ?? type.domain ?? "unassigned";
  const derived = type.derivedProperties ?? [];

  const Field = ({ label, children }: { label: string; children: ReactNode }) => (
    <label style={{ display: "block", marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 3 }}>{label}</div>
      {children}
    </label>
  );

  return (
    <Modal title={`对象配置 · ${type.displayName}`} onClose={onClose} width={980}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }} data-testid={`obj-config-${type.key}`}>
        {/* 中：基础图谱表单 + 本体构建表 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>基础图谱</div>
          <Field label="对象标签">
            <input value={type.displayName} readOnly style={{ width: "100%" }} data-testid="objcfg-label" />
          </Field>
          <Field label="类型键（对象类型）">
            <input value={type.key} readOnly className="mono" style={{ width: "100%" }} data-testid="objcfg-key" />
          </Field>
          <Field label="主键字段（实体字段）">
            <input value={pk ?? "（无主键）"} readOnly className="mono" style={{ width: "100%" }} data-testid="objcfg-pk" />
          </Field>
          <Field label="归域（域）">
            {editableDraft ? (
              // 真 PATCH：setDomain（编辑草案）→ 真持久化。
              <select
                value={liveDomain}
                data-testid="objcfg-domain-edit"
                onChange={(e) => patchMut.mutate({ op: "setDomain", typeKey: type.key, domain: e.target.value })}
                disabled={patchMut.isPending}
                style={{ width: "100%" }}
              >
                <option value="unassigned">unassigned（未归域）</option>
                {domains.map((d) => (<option key={d.key} value={d.key}>{d.displayName ?? d.key}（{d.key}）</option>))}
              </select>
            ) : (
              <input value={liveDomain} readOnly className="mono" style={{ width: "100%" }} data-testid="objcfg-domain-ro" />
            )}
          </Field>
          {/* ③类诚实 RESERVED（后端无）：存储模式（静态/本体图谱）、对象描述。 */}
          <div data-testid="objcfg-reserved-fields" style={{ fontSize: 11, color: "var(--muted2)", margin: "2px 0 12px" }}>
            ◌ 存储模式（静态图谱/本体图谱）· RESERVED · ◌ 对象描述 · RESERVED（后端无对应字段·§10③，不画假输入）
          </div>

          {/* 本体构建：属性/派生 真数据 tab + RESERVED tab */}
          <div className="section-title" style={{ marginBottom: 6 }}>本体构建</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }} data-testid="objcfg-tabs">
            {(["属性", "派生"] as const).map((tb) => (
              <button key={tb} className={`btn sm ${tab === tb ? "" : "ghost"}`} data-testid={`objcfg-tab-${tb}`} data-active={tab === tb ? "1" : "0"} onClick={() => setTab(tb)}>
                {tb}（{tb === "属性" ? displayProps.length : derived.length}）
              </button>
            ))}
            {/* ③类 RESERVED tab：后端无 类型/函数/行动/安全 → 禁用不画假表。 */}
            {["类型", "函数", "行动", "安全"].map((tb) => (
              <button key={tb} className="btn sm ghost" disabled data-testid={`objcfg-tab-reserved-${tb}`} title="后端未建（§10③）·不画假壳" style={{ opacity: 0.5 }}>
                {tb} · RESERVED
              </button>
            ))}
          </div>

          {tab === "属性" ? (
            <table className="cmp" data-testid="objcfg-prop-table" style={{ width: "100%", fontSize: 12 }}>
              <thead><tr><th>名称</th><th>类型</th><th>主键</th>{editableDraft && <th>改名（真 PATCH）</th>}</tr></thead>
              <tbody>
                {displayProps.map((p) => (
                  <tr key={p.propKey} data-testid={`objcfg-prop-${p.propKey}`}>
                    <td className="mono">{p.propKey}</td>
                    <td>{p.dataType}</td>
                    <td>{p.isPrimaryKey ? "✓" : ""}</td>
                    {editableDraft && (
                      <td>
                        {renaming?.prop === p.propKey ? (
                          <span style={{ display: "inline-flex", gap: 4 }}>
                            <input value={renaming.value} className="mono" style={{ width: 110 }} data-testid={`objcfg-rename-input-${p.propKey}`}
                              onChange={(e) => setRenaming({ prop: p.propKey, value: e.target.value })} />
                            <button className="btn sm" disabled={patchMut.isPending || !renaming.value.trim() || renaming.value === p.propKey} data-testid={`objcfg-rename-save-${p.propKey}`}
                              onClick={() => patchMut.mutate({ op: "renameProperty", typeKey: type.key, propKey: p.propKey, newPropKey: renaming.value.trim() })}>保存</button>
                            <button className="btn sm ghost" onClick={() => setRenaming(null)}>取消</button>
                          </span>
                        ) : (
                          <button className="btn sm ghost" data-testid={`objcfg-rename-${p.propKey}`} onClick={() => setRenaming({ prop: p.propKey, value: p.propKey })}>改名</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="cmp" data-testid="objcfg-derived-table" style={{ width: "100%", fontSize: 12 }}>
              <thead><tr><th>派生属性</th><th>公式（真 formula）</th></tr></thead>
              <tbody>
                {derived.length > 0 ? derived.map((d) => (
                  <tr key={d.propKey} data-testid={`objcfg-derived-${d.propKey}`}><td className="mono">{d.propKey}</td><td className="mono" style={{ fontSize: 11 }}>{d.formula}</td></tr>
                )) : (<tr><td colSpan={2} style={{ color: "var(--muted2)" }}>该对象无派生属性。</td></tr>)}
              </tbody>
            </table>
          )}

          {/* 编辑能力诚实说明 */}
          <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 8 }} data-testid="objcfg-edit-note">
            {editableDraft
              ? <>编辑落点：可编辑草案 <span className="mono">{editableDraft.id}</span>（status {editableDraft.status}）——改归域/属性名走真 <span className="mono">patchModelingDraft</span>，真持久化（刷新仍在）。</>
              : <>本对象来自<b>已发布本体</b>（草案已锁定，不可改）。编辑归域/属性需先<b>新建可编辑草案</b>（上方「{t.newDraft}」）——不提供假编辑（继承真推演红线）。</>}
          </div>
        </div>

        {/* 右：局部准备度（逐对象 gauge·真 deriveCertification LOCAL·target=该类型） */}
        <div style={{ width: 430, flexShrink: 0 }} data-testid="objcfg-readiness">
          <div className="section-title" style={{ marginBottom: 6 }}>
            局部准备度 · 逐对象就绪
            <span style={{ fontSize: 11, color: "var(--muted2)", fontWeight: 400, marginLeft: 6 }}>
              deriveCertification(LOCAL·target=<span className="mono">{type.key}</span>)
            </span>
          </div>
          {entOff ? (
            <div style={{ color: "var(--muted2)", fontSize: 12 }} data-testid="objcfg-readiness-entoff">就绪认证功能未开（entitlement off）——诚实降级，不画假就绪。</div>
          ) : !cert ? (
            <div style={{ color: "var(--muted2)", fontSize: 12 }}>{certLoading ? "加载逐对象就绪…" : "建认证会话中…"}</div>
          ) : (
            // 复用 SimReadinessPanel（不新建并行）：scope=LOCAL 时 cert.targetRef=该类型 → gauge/三维/L4=逐对象真值。
            // radar 不传（6维/4维雷达后端未建·§10③）。
            <SimReadinessPanel cert={cert} scope={scope} onScopeChange={setScope} />
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * 任务#2：草案 → DataPipelineDag「已发布类型」形状适配器（**真数据·R13，非编造**）。
 * 草案 objectType 携 `sourceDataset`(string) + `properties[].sourceField`；已发布类型 DAG 消费
 * `sourceBindings:[{dataset, fieldMappings:{propKey→sourceField}}]`。此处仅**重排同一批真字段**为 DAG 形状——
 * fieldMappings 的每个 propKey→sourceField 都取自草案真 property（缺 sourceDataset 则不造 binding → DAG 标橙）。
 * 不复用全局值、不写死 transform；连接器 id 草案态无（connId 置空，DAG 不依赖它显示）。
 */
function draftTypesForDag(
  draft: ModelingDraftVM,
): Awaited<ReturnType<typeof fetchObjectTypes>> {
  return (draft.suggestion.objectTypes ?? []).map((ot) => ({
    key: ot.typeKey,
    displayName: ot.displayName || ot.typeKey,
    domain: ot.domain,
    properties: ot.properties.map((p) => ({ propKey: p.propKey, dataType: p.dataType, isPrimaryKey: p.isPrimaryKey })),
    derivedProperties: ot.derivedProperties ?? [],
    sourceBindings: ot.sourceDataset
      ? [{
          connId: "",
          dataset: ot.sourceDataset,
          // 真字段映射：propKey ← sourceField（取自草案 property，非凭空造）。DataPipelineDag 读 fieldMappings。
          fieldMappings: Object.fromEntries(ot.properties.map((p) => [p.propKey, p.sourceField])),
        } as { connId: string; dataset: string }]
      : [],
  }));
}

/**
 * 任务#2 · 核心交付：本体模型「创建过程」低代码 Pipeline（顶部贯通进度流）。
 * 6 阶段节点 + 连线箭头，**状态全取真草案态**（R14 零业务常量·零写死步数）：
 *   ① 选数据源   = draft.rawDatasetIds.length
 *   ② 派生/AI建议 = draft.suggestion.objectTypes.length（只显新建/复用类型数·payload 无引擎来源字段→不臆造）
 *   ③ 字段映射审核 = 含 sourceDataset 的类型数 + 字段全建模门 coverage%（fetchModelingCoverage 真值）
 *   ④ 改名/归域   = draft.operationLog.length（renameType/setDomain 等留痕）
 *   ⑤ 发布(R12门) = draft.status==='PUBLISHED'（否则看 coverage 是否 100% → 就绪/未就绪）
 *   ⑥ 物化       = 本草案已发布类型的 materialized 计数（fetchObjectTypeStats 真值）
 * 每节点三态 done✓ / active◉(最靠前未完成) / pending○；连线随完成高亮。
 * 点击 → onStage(n)：跳/展开对应区（③→展开 DataPipelineDag 看真字段映射）。
 * 与既有 DataPipelineDag 关系：本 Pipeline=纵向「流程进度」，DAG=横向「数据架构」，互补复用不并行。
 */
type StageState = "done" | "active" | "pending";
function ModelingCreationPipeline({
  draft,
  coverage,
  materializedCount,
  onStage,
}: {
  draft: ModelingDraftVM;
  coverage?: FieldCoverageVM;
  materializedCount: number;
  onStage: (stage: number) => void;
}) {
  const rawCount = draft.rawDatasetIds?.length ?? 0;
  const otCount = draft.suggestion.objectTypes?.length ?? 0;
  const mappedTypes = (draft.suggestion.objectTypes ?? []).filter((ot) => !!ot.sourceDataset).length;
  const opCount = draft.operationLog?.length ?? 0;
  const isPublished = draft.status === "PUBLISHED";
  const coveragePct = coverage ? Math.round(coverage.coverage * 100) : null;
  const coverageReady = coverage?.fullyCovered ?? false;
  // 阶段②诚实标注：草案 payload **无 derive/suggest 来源字段**（两路 confidence 多为 1，不可凭此断言引擎）。
  // 只显真草案可知事实：新建(CREATE) vs 复用既有(MAP_TO_EXISTING) 的类型数；不写死/不臆造引擎名（继承真推演红线）。
  const ots = draft.suggestion.objectTypes ?? [];
  const createCount = ots.filter((ot) => ot.action === "CREATE").length;
  const mapCount = ots.filter((ot) => ot.action === "MAP_TO_EXISTING").length;
  const linkCount = draft.suggestion.linkTypes?.length ?? draft.fkCandidates?.length ?? 0;

  // done 判定全取真草案态（R14）：每阶段 done 即"该阶段产物已存在于真草案"。
  const done: boolean[] = [
    rawCount > 0, // ①
    otCount > 0, // ②
    otCount > 0 && mappedTypes === otCount, // ③ 全类型有数据源映射（coverage% 另显）
    opCount > 0, // ④ 有策展操作
    isPublished, // ⑤
    materializedCount > 0, // ⑥
  ];
  // active = 最靠前的未完成阶段；全完成则无 active。
  const activeIdx = done.findIndex((d) => !d);
  const stateOf = (i: number): StageState => (done[i] ? "done" : i === activeIdx ? "active" : "pending");

  const stages: { n: number; label: string; sub: string; testid: string }[] = [
    { n: 1, label: "选数据源", sub: `${rawCount} 个原始数据集`, testid: "mcp-stage-1" },
    {
      n: 2,
      label: "派生 / AI 建议",
      // 诚实：只显真草案可知（新建/复用类型数），不臆造 derive/suggest 引擎名（payload 无来源字段）。
      sub: otCount > 0 ? `${otCount} 类型${createCount > 0 ? ` · 新建 ${createCount}` : ""}${mapCount > 0 ? ` · 复用 ${mapCount}` : ""}` : "未生成",
      testid: "mcp-stage-2",
    },
    {
      n: 3,
      label: "字段映射审核",
      sub: otCount > 0 ? `${mappedTypes}/${otCount} 映射${coveragePct != null ? ` · 全建模 ${coveragePct}%` : ""}` : "—",
      testid: "mcp-stage-3",
    },
    { n: 4, label: "改名 / 归域", sub: opCount > 0 ? `${opCount} 条策展操作` : (linkCount > 0 ? `${linkCount} 链接候选` : "未策展"), testid: "mcp-stage-4" },
    { n: 5, label: "发布 (R12 门)", sub: isPublished ? "已发布 ✓" : coverageReady ? "就绪可发布" : coveragePct != null ? `待补全 ${coveragePct}%` : "未就绪", testid: "mcp-stage-5" },
    { n: 6, label: "物化", sub: materializedCount > 0 ? `${materializedCount} 类型已物化` : "未物化", testid: "mcp-stage-6" },
  ];

  const palette: Record<StageState, { bg: string; bd: string; fg: string; mark: string }> = {
    done: { bg: "rgba(98,190,119,.16)", bd: "#62BE77", fg: "#62BE77", mark: "✓" },
    active: { bg: "rgba(126,139,238,.18)", bd: "#7E8BEE", fg: "#7E8BEE", mark: "◉" },
    pending: { bg: "rgba(255,255,255,.04)", bd: "var(--line2,#3a3a3a)", fg: "var(--muted2)", mark: "○" },
  };
  const doneCount = done.filter(Boolean).length;

  return (
    <div
      data-testid="modeling-creation-pipeline"
      style={{ marginBottom: 12, background: "var(--panel,rgba(255,255,255,.03))", borderRadius: 8, padding: "10px 12px" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>创建过程 · 低代码建模管道</strong>
        <span style={{ fontSize: 11, color: "var(--muted2)" }} data-testid="mcp-progress">
          草案 <span className="mono">{draft.id}</span> · {draft.status} · 进度 {doneCount}/6（状态实时取真草案态 · R14 零写死）
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 0, overflowX: "auto", paddingBottom: 4 }}>
        {stages.map((s, i) => {
          const st = stateOf(i);
          const pal = palette[st];
          return (
            <div key={s.n} style={{ display: "flex", alignItems: "center", flex: "0 0 auto" }}>
              <button
                type="button"
                data-testid={s.testid}
                data-state={st}
                onClick={() => onStage(s.n)}
                title={`阶段${s.n} ${s.label}（${st}）— 点击跳转/展开对应区`}
                style={{
                  width: 138,
                  minHeight: 60,
                  textAlign: "left",
                  cursor: "pointer",
                  background: pal.bg,
                  border: `1.4px solid ${pal.bd}`,
                  borderRadius: 8,
                  padding: "7px 9px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--txt)" }}>
                  <span data-testid={`${s.testid}-mark`} style={{ color: pal.fg, fontWeight: 700 }}>{pal.mark}</span>
                  <span style={{ color: pal.fg, fontSize: 10 }}>{s.n}</span>
                  {s.label}
                </span>
                <span style={{ fontSize: 10, color: "var(--muted2)", lineHeight: 1.4 }}>{s.sub}</span>
              </button>
              {i < stages.length - 1 && (
                // 连线随进度高亮：本阶段 done → 连线高亮（绿），否则灰。
                <span
                  data-testid={`mcp-link-${s.n}`}
                  style={{
                    width: 22,
                    height: 0,
                    borderTop: `2px solid ${done[i] ? "#62BE77" : "var(--line2,#3a3a3a)"}`,
                    margin: "0 -1px",
                    position: "relative",
                    flex: "0 0 auto",
                  }}
                >
                  <span style={{ position: "absolute", right: -1, top: -4, color: done[i] ? "#62BE77" : "var(--muted2)", fontSize: 11, lineHeight: 1 }}>›</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--muted2)", marginTop: 8 }}>
        每阶段状态溯真草案端点：① rawDatasetIds · ② suggestion.objectTypes · ③ sourceDataset+coverage · ④ operationLog · ⑤ status · ⑥ object-types/stats.materialized。点①→数据源 · ②→建议区 · ③→展开数据流 DAG · ④→操作面板 · ⑤→发布 · ⑥→已发布本体。
      </div>
    </div>
  );
}

/**
 * 轨P 增量1（数据流 DAG·复刻竞品 image2「架构本体设计」横向分层 ETL·承轨A P1 #37 升级）：
 * 每条实体链 数据集(事件表) → 数据处理_XX(**真字段映射** dataset.field→type.prop) → 实体/关系 → 本体库。
 * 本体专用 SVG（正交折线箭头 + 左右连接桩 + 箭头 + 最右汇本体库）。
 * **数据处理节点内容 = 真 sourceBindings.fieldMappings（点开看真映射，非凭空造 transform）**——
 * 零写死（R14）、确定性（取 5 代表链按真类型，R6）、缺 sourceBindings 标橙（诚实，非裸渲染）。
 */
function DataPipelineDag({
  types,
  onSelectType,
  open: openProp,
  onToggle,
  draftMode = false,
}: {
  types: Awaited<ReturnType<typeof fetchObjectTypes>>;
  onSelectType?: (key: string) => void;
  /** 受控展开态（任务#2：顶部创建管道点③→展开本 DAG 看在建草案）；不传则内部自管（已发布成品图维持折叠默认）。 */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  /** 草案态：标题改「在建草案」、最右汇点改「草案对象库」，与已发布成品图区分（数据来自 draft.suggestion 适配）。 */
  draftMode?: boolean;
}) {
  const [openInner, setOpenInner] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openInner;
  const setOpen = (v: boolean) => { if (!controlled) setOpenInner(v); onToggle?.(v); };
  const [detail, setDetail] = useState<{ dataset: string; typeLabel: string; mappings: [string, string][] } | null>(null);
  // 5 代表链（真 demo 类型名·竞品 5 条 ETL 链对位），不足按 key 序补。
  const pref = ["Order", "Base", "Model", "Line", "Material"];
  const byKey = new Map(types.map((t) => [t.key, t]));
  const ordered = [...pref.map((k) => byKey.get(k)).filter(Boolean), ...[...types].sort((a, b) => a.key.localeCompare(b.key)).filter((t) => !pref.includes(t.key))] as typeof types;
  const chains = ordered.slice(0, 5).map((t) => {
    const sb = (t.sourceBindings ?? [])[0] as { dataset?: string; fieldMappings?: Record<string, string> } | undefined;
    return { key: t.key, label: t.displayName || t.key, dataset: sb?.dataset, mappings: Object.entries(sb?.fieldMappings ?? {}) as [string, string][], derived: (t.derivedProperties ?? []).length };
  });
  // 布局（横向 4 列：数据集 | 数据处理 | 实体/关系 | 本体库）
  const colW = 188, nodeW = 152, nodeH = 42, vGap = 24, padX = 14, padY = 30;
  const rows = chains.length;
  const col0 = padX, col1 = padX + colW, col2 = padX + 2 * colW;
  const colX = (i: number) => (i === 0 ? col0 : i === 1 ? col1 : col2);
  const obX = padX + 3 * colW + 8;
  const W = obX + nodeW + padX;
  const H = padY + rows * (nodeH + vGap) + 18;
  const rowY = (i: number) => padY + i * (nodeH + vGap);
  const obY = padY + (rows * (nodeH + vGap) - vGap) / 2 - nodeH / 2;
  const ortho = (x1: number, y1: number, x2: number, y2: number) => { const mx = Math.round((x1 + x2) / 2); return `M${x1},${y1} L${mx},${y1} L${mx},${y2} L${x2},${y2}`; };
  const titles = ["数据集（事件表）", "数据处理（字段映射）", "实体 / 关系", draftMode ? "草案对象库" : "本体库"];
  const PortNode = ({ x, y, fill, stroke, title, sub, badges, onClick, tid }: { x: number; y: number; fill: string; stroke: string; title: string; sub?: string; badges?: string[]; onClick?: () => void; tid?: string }) => (
    <g transform={`translate(${x},${y})`} data-testid={tid} role={onClick ? "button" : undefined} style={onClick ? { cursor: "pointer" } : undefined} onClick={onClick}>
      <rect width={nodeW} height={nodeH} rx={8} fill={fill} stroke={stroke} strokeWidth={1.4} />
      <circle cx={0} cy={nodeH / 2} r={3} fill={stroke} /><circle cx={nodeW} cy={nodeH / 2} r={3} fill={stroke} />
      <text x={10} y={sub ? 17 : 25} fontSize={12} fill="var(--txt)">{title.length > 13 ? title.slice(0, 12) + "…" : title}</text>
      {sub && <text x={10} y={32} fontSize={10} fill="var(--muted2)">{sub}</text>}
      {badges?.map((b, bi) => <text key={bi} x={nodeW - 14 - bi * 16} y={15} fontSize={9} fill={stroke}>{b}</text>)}
    </g>
  );
  return (
    <details data-testid={draftMode ? "modeling-pipeline-dag-draft" : "modeling-pipeline-dag"} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} style={{ marginBottom: 12, background: "var(--panel,rgba(255,255,255,.03))", borderRadius: 8, padding: "8px 10px" }}>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>
        {draftMode
          ? `数据流 DAG · 在建草案管道（数据集→数据处理→实体→草案对象库 · R13 真字段映射 draft.suggestion · 共 ${types.length} 类型）`
          : `数据流 DAG · 架构本体设计（数据集→数据处理→实体→本体库 · R13 真字段映射 · 共 ${types.length} 类型）`}
      </summary>
      <div style={{ marginTop: 8, overflowX: "auto" }}>
        <svg width={W} height={H} role="img" style={{ display: "block" }}>
          <defs><marker id="pp-arrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--muted2)" /></marker></defs>
          {titles.map((t, i) => <text key={i} x={(i < 3 ? colX(i) : obX) + nodeW / 2} y={14} fontSize={11} textAnchor="middle" fill="var(--muted2)">{t}</text>)}
          {/* 实体类型 → 本体库 汇聚边（正交折线 + 箭头） */}
          {chains.map((c, i) => <path key={`ob-${c.key}`} d={ortho(colX(2) + nodeW, rowY(i) + nodeH / 2, obX, obY + nodeH / 2)} fill="none" stroke="var(--muted2)" strokeWidth={1.2} markerEnd="url(#pp-arrow)" opacity={0.7} />)}
          {/* 每链：数据集 →处理→实体 正交边 */}
          {chains.map((c, i) => { const y = rowY(i); return (
            <g key={c.key}>
              <path d={ortho(colX(0) + nodeW, y + nodeH / 2, colX(1), y + nodeH / 2)} fill="none" stroke="var(--muted2)" strokeWidth={1.2} markerEnd="url(#pp-arrow)" />
              <path d={ortho(colX(1) + nodeW, y + nodeH / 2, colX(2), y + nodeH / 2)} fill="none" stroke="var(--muted2)" strokeWidth={1.2} markerEnd="url(#pp-arrow)" />
            </g>
          ); })}
          {chains.map((c, i) => { const y = rowY(i); const hasFm = c.mappings.length > 0; return (
            <g key={`n-${c.key}`}>
              <PortNode tid={`pp-ds-${c.key}`} x={colX(0)} y={y} fill="rgba(67,183,215,.14)" stroke="#43B7D7" title={c.dataset ?? "（无数据集）"} sub="RawDataset" />
              <PortNode tid={`pp-proc-${c.key}`} x={colX(1)} y={y} fill={hasFm ? "rgba(98,190,119,.16)" : "rgba(210,162,76,.16)"} stroke={hasFm ? "#62BE77" : "#caa23a"} title={`数据处理_${c.key}`} sub={hasFm ? `${c.mappings.length} 字段映射` : "缺 sourceBindings"} onClick={hasFm ? () => setDetail({ dataset: c.dataset ?? "", typeLabel: c.label, mappings: c.mappings }) : undefined} />
              <PortNode tid={`pp-ty-${c.key}`} x={colX(2)} y={y} fill="rgba(126,139,238,.16)" stroke="#7E8BEE" title={c.label} sub={c.key} badges={["模", ...(c.derived > 0 ? ["动"] : [])]} onClick={onSelectType ? () => onSelectType(c.key) : undefined} />
            </g>
          ); })}
          <PortNode tid="pp-ontolib" x={obX} y={obY} fill="rgba(196,112,184,.18)" stroke="#C470B8" title={draftMode ? "草案对象库" : "本体库"} sub={draftMode ? `${types.length} 类型在建` : `${types.length} 类型已发布`} />
        </svg>
        <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 6 }}>
          {draftMode
            ? <>5 条代表实体链（共 {types.length} 类型 · 在建草案）；<b>数据处理节点 = 真 draft.suggestion 字段映射</b>（dataset.sourceField→type.propKey，非编造 transform）；缺 sourceDataset 标橙。</>
            : <>5 条代表实体链（共 {types.length} 类型 · 横向 ETL）；<b>数据处理节点 = 真 sourceBindings.fieldMappings</b>（点开看 dataset.field→type.prop 真映射，非编造 transform）；缺 sourceBindings 标橙。</>}
        </div>
      </div>
      {detail && (
        <Modal title={`数据处理：${detail.dataset} → ${detail.typeLabel}（真字段映射 · ${detail.mappings.length} 条）`} onClose={() => setDetail(null)} width={520}>
          <table className="cmp" data-testid="pp-mapping-table" style={{ width: "100%", fontSize: 12 }}>
            <thead><tr><th>源字段（{detail.dataset}.field）</th><th>→</th><th>对象属性（type.prop）</th></tr></thead>
            <tbody>{detail.mappings.map(([prop, src]) => (<tr key={prop}><td className="mono">{detail.dataset}.{src}</td><td>→</td><td className="mono">{prop}</td></tr>))}</tbody>
          </table>
          <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 8 }}>来源：类型 sourceBindings.fieldMappings（轨L 真建模链 publish 产出·R13）；非前端编造转换逻辑。</div>
        </Modal>
      )}
    </details>
  );
}

/**
 * 轨L 增量3：已发布本体视图（中心真值闭合）。无活动草案但本体已存在时显此——逐类型显
 * 名称/域/属性数/派生属性数 + **可溯到各自 sourceDataset**（provenance 真实，R13），绝不"暂无本体"。
 */
function PublishedOntologyView({ types, onSelectType }: { types: Awaited<ReturnType<typeof fetchObjectTypes>>; onSelectType?: (key: string) => void }) {
  const sorted = [...types].sort((a, b) => a.key.localeCompare(b.key));
  return (
    <div data-testid="published-ontology">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>已发布本体</strong>
        <span style={{ color: "var(--muted, #888)", fontSize: 12 }} data-testid="published-ontology-count">
          {sorted.length} 个对象类型（经建模链发布 · 可溯数据源 · 点行看逐对象配置/就绪）
        </span>
      </div>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted, #888)" }}>
            <th style={{ padding: "4px 8px" }}>类型</th>
            <th style={{ padding: "4px 8px" }}>域</th>
            <th style={{ padding: "4px 8px" }}>属性</th>
            <th style={{ padding: "4px 8px" }}>派生</th>
            <th style={{ padding: "4px 8px" }}>来源数据集（provenance）</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ty) => (
            <tr
              key={ty.key}
              style={{ borderTop: "1px solid var(--border, #2a2a2a)", cursor: onSelectType ? "pointer" : undefined }}
              data-testid={`pub-type-${ty.key}`}
              role={onSelectType ? "button" : undefined}
              tabIndex={onSelectType ? 0 : undefined}
              onClick={onSelectType ? () => onSelectType(ty.key) : undefined}
              onKeyDown={onSelectType ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectType(ty.key); } } : undefined}
            >
              <td style={{ padding: "4px 8px" }}>
                <span style={{ fontWeight: 600, color: onSelectType ? "var(--accent, #7E8BEE)" : undefined }}>{ty.displayName}</span>{" "}
                <span style={{ color: "var(--muted, #888)" }}>{ty.key}</span>
              </td>
              <td style={{ padding: "4px 8px" }}>{ty.domain ?? "—"}</td>
              <td style={{ padding: "4px 8px" }}>{ty.properties.length}</td>
              <td style={{ padding: "4px 8px" }}>{ty.derivedProperties?.length ?? 0}</td>
              <td style={{ padding: "4px 8px" }} data-testid={`pub-type-src-${ty.key}`}>
                {(ty.sourceBindings ?? []).map((b) => b.dataset).join(", ") || <span style={{ color: "var(--danger, #e55)" }}>无来源</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 新建草案：选原始数据集 → POST /a/v1/modeling/suggest（A3 半自动建模入口） */
function SuggestModal({ onClose, onCreated, initialSelected = [], noLlmBound = false }: { onClose: () => void; onCreated: (draftId: string) => void; initialSelected?: string[]; noLlmBound?: boolean }) {
  const { data: rawDatasets } = useQuery({ queryKey: ["a", "raw-datasets", {}], queryFn: () => fetchRawDatasets() });
  const [selected, setSelected] = useState<string[]>(initialSelected);

  const suggestMut = useMutation({
    mutationFn: () => suggestModeling(selected),
    onSuccess: (r) => {
      toast(t.suggestDone, "success");
      onCreated(r.draftId);
    },
    onError: toastError,
  });
  // 确定性建模（无 LLM·字段全建模 100% 覆盖；nano-ontoprompt 融入）
  const deriveMut = useMutation({
    mutationFn: () => deriveModeling(selected),
    onSuccess: (r) => {
      toast("确定性建模完成：每个字段已建模（100% 覆盖）", "success");
      onCreated(r.draftId);
    },
    onError: toastError,
  });

  return (
    <Modal title={t.newDraft} onClose={onClose} width={460}>
      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{t.newDraftHint}</p>
      {/* C1 断点 · 弹窗内诚实降级提示：无 LLM 绑定 → AI 建议禁用，引导走确定性路径或去配置。 */}
      {noLlmBound && (
        <div data-testid="suggest-llm-degraded" style={{ fontSize: 11.5, lineHeight: 1.6, color: "var(--txt)", background: "rgba(221,149,81,.12)", border: "1px solid var(--amber,#DD9551)", borderRadius: 6, padding: "6px 8px", marginBottom: 10 }}>
          未绑定 LLM 用途 → <b>AI 建议不可用</b>。请走下方<b>「确定性建模（全字段）」</b>（无需 LLM），或先
          <Link to="/admin/llm-providers" data-testid="suggest-llm-config-link" style={{ color: "var(--accent,#7E8BEE)", margin: "0 3px" }}>去配置绑定</Link>
          （绑定任一大类即覆盖全部用途）。
        </div>
      )}
      {(rawDatasets ?? []).length === 0 && <div className="empty-state">{t.newDraftEmpty}</div>}
      {(rawDatasets ?? []).map((ds) => (
        <label key={ds.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={selected.includes(ds.id)}
            onChange={(e) => setSelected((s) => (e.target.checked ? [...s, ds.id] : s.filter((x) => x !== ds.id)))}
          />
          <span className="mono">{ds.name}</span>
          <span style={{ color: "var(--muted2)", fontSize: 10.5 }}>{ds.id}</span>
        </label>
      ))}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button className="btn" onClick={onClose}>
          {zh.common.back}
        </button>
        {/* 确定性建模：无 LLM、每个字段必建模（R12 字段全建模门保底基线） */}
        <button
          className="btn"
          disabled={selected.length === 0 || deriveMut.isPending}
          data-testid="modeling-derive-run"
          title="基于数据的确定性映射：dataset→对象·column→属性·FK→链接，构造上 100% 字段覆盖"
          onClick={() => deriveMut.mutate()}
        >
          确定性建模（全字段）
        </button>
        <button
          className="btn primary"
          disabled={selected.length === 0 || suggestMut.isPending || noLlmBound}
          data-testid="modeling-suggest-run"
          title={noLlmBound ? "未绑定 LLM 用途 —— AI 建议不可用，请走确定性建模或先去配置绑定" : undefined}
          onClick={() => suggestMut.mutate()}
        >
          {t.suggestRun}
        </button>
      </div>
    </Modal>
  );
}

function DraftWorkbench({ draft }: { draft: ModelingDraftVM }) {
  const queryClient = useQueryClient();
  const key = ["a", "modeling-drafts", {}];
  const [publishErrors, setPublishErrors] = useState<{ typeKey: string; message: string }[]>(draft.publishErrors ?? []);
  const [materializeJobId, setMaterializeJobId] = useState<string | null>(null);
  // 字段全建模门（R12）：默认 HARD（升级默认 = 每个导入字段都必须建模），可取消勾选放宽。
  const [requireFullCoverage, setRequireFullCoverage] = useState(true);
  const { data: coverage } = useQuery({
    queryKey: ["a", "modeling-coverage", draft.id, draft.suggestion.objectTypes.length],
    queryFn: () => fetchModelingCoverage(draft.id),
  });
  // 新类型发布前必须人工归域（A4 治理门）；下拉来源 = 业务域注册表（R14 非内联）。
  const { data: domainsData } = useQuery({ queryKey: ["a", "business-domains"], queryFn: fetchBusinessDomains });
  const domains = domainsData?.domains ?? [];

  // PATCH 操作：即时调端点，乐观更新 + 失败回滚（PRD §7.6）
  const patchMut = useMutation({
    mutationFn: (operation: Record<string, unknown>) => patchModelingDraft(draft.id, operation),
    onMutate: async (operation) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ModelingDraftVM[]>(key);
      queryClient.setQueryData<ModelingDraftVM[]>(key, (old) =>
        (old ?? []).map((d) => (d.id === draft.id ? applyOperationLocally(d, operation) : d)),
      );
      return { prev };
    },
    onError: (e, _op, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      toast(t.patchFailed, "error");
      toastError(e);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  const publishMut = useMutation({
    mutationFn: () => publishModelingDraft(draft.id, requireFullCoverage),
    onSuccess: (res) => {
      if (res.ok) {
        setPublishErrors([]);
        toast("发布成功，可触发对象化", "success");
      } else {
        setPublishErrors(res.errors ?? []);
      }
    },
    onError: toastError,
  });

  const materializeMut = useMutation({
    mutationFn: () => materializeDraft(draft.id),
    onSuccess: (r) => setMaterializeJobId(r.jobId),
    onError: toastError,
  });

  const { data: matJob } = useQuery({
    queryKey: ["a", "sync-job", { id: materializeJobId }],
    queryFn: () => fetchSyncJob(materializeJobId!),
    enabled: materializeJobId != null,
    refetchInterval: (q) => (q.state.data?.status === "SUCCEEDED" || q.state.data?.status === "FAILED" ? false : 800),
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn primary sm" disabled={publishMut.isPending} onClick={() => publishMut.mutate()} data-testid="publish-draft">
          {zh.common.publish}
        </button>
        {/* 字段全建模门（R12）：默认 HARD（勾选）；取消勾选放宽，未建模字段不阻断 */}
        <label style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }} title="R12 字段全建模：默认要求每个导入字段都被建模，取消勾选可放宽">
          <input type="checkbox" data-testid="require-full-coverage" checked={requireFullCoverage} onChange={(e) => setRequireFullCoverage(e.target.checked)} />
          字段全建模门（R12 默认）
        </label>
        <button className="btn sm" disabled={materializeMut.isPending} onClick={() => materializeMut.mutate()}>
          {t.materialize}
        </button>
        {matJob && (
          <span className={`badge ${matJob.status === "SUCCEEDED" ? "green" : "blue"}`} data-testid="materialize-status">
            {t.materializeProgress}: {matJob.status}
          </span>
        )}
        {/* 字段全建模覆盖徽章（R12）：每个导入字段是否被建模 */}
        {coverage && (
          <span
            className={`badge ${coverage.fullyCovered ? "green" : "amber"}`}
            data-testid="modeling-coverage-badge"
            style={{ marginLeft: "auto" }}
            title={coverage.fullyCovered ? "全部导入字段已建模" : `未建模：${coverage.datasets.flatMap((d) => d.unmodeled.map((u) => `${d.name}.${u}`)).join("、")}`}
          >
            字段全建模 {coverage.modeledFields}/{coverage.totalFields}（{Math.round(coverage.coverage * 100)}%）{coverage.fullyCovered ? " ✓" : ""}
          </span>
        )}
      </div>
      <div className={styles.threeCol}>
        {/* 栏1：源字段（按数据集分组） */}
        <div className={`panel ${styles.col}`}>
          <div className="section-title">{t.sourceFields}</div>
          {draft.datasets.map((ds) => (
            <div key={ds.name} style={{ marginBottom: 12 }}>
              <div className="mono" style={{ fontSize: 11.5, marginBottom: 4 }}>
                {ds.name}
              </div>
              {ds.fields.map((f) => (
                <div key={f.name} className={styles.fieldRow}>
                  <span>{f.name}</span>
                  <span className="badge">{f.inferredType}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* 栏2：映射画布 */}
        <div className={`${styles.col} ${styles.canvas}`}>
          <div className="section-title">{t.canvas}</div>
          {draft.suggestion.objectTypes.map((ot) => {
            const errors = publishErrors.filter((e) => e.typeKey === ot.typeKey);
            return (
              <div key={ot.typeKey} className={`panel ${styles.typeCard} ${errors.length > 0 ? styles.typeCardError : ""}`} data-testid={`type-card-${ot.typeKey}`}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                  <strong>{ot.displayName}</strong>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>{ot.typeKey}</span>
                  {ot.action === "MAP_TO_EXISTING" && <span className="badge green" data-testid="map-existing-badge">{t.mapToExisting} → {ot.existingTypeKey}</span>}
                  {/* 新类型归域（发布门）：映射既有类型沿用既有域、无需此控件 */}
                  {ot.action !== "MAP_TO_EXISTING" && (
                    <select
                      data-testid={`type-domain-${ot.typeKey}`}
                      value={ot.domain && ot.domain !== "unassigned" ? ot.domain : ""}
                      onChange={(e) => patchMut.mutate({ op: "setDomain", typeKey: ot.typeKey, domain: e.target.value })}
                      style={{ fontSize: 11, padding: "1px 4px" }}
                      title="发布前必须人工归域（A4 治理门）"
                    >
                      <option value="">{t.assignDomain}</option>
                      {domains.map((d) => <option key={d.key} value={d.key}>{d.displayName}</option>)}
                    </select>
                  )}
                  <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted2)" }}>conf {(ot.confidence * 100).toFixed(0)}%</span>
                </div>
                {ot.properties.map((p) => (
                  <div key={p.propKey} className={styles.propRow} data-testid={`prop-${ot.typeKey}-${p.propKey}`}>
                    <span>
                      {p.isPrimaryKey && <span title="主键" style={{ color: "var(--c-forecast)" }}>★ </span>}
                      {p.propKey}
                    </span>
                    <span className={styles.arrow}>←</span>
                    <span className="mono" style={{ color: "var(--muted)" }}>{ot.sourceDataset}.{p.sourceField}</span>
                    <span className="badge">{p.dataType}</span>
                    {p.refToTypeKey && <span className="badge blue">ref → {p.refToTypeKey}</span>}
                  </div>
                ))}
                {errors.map((e, i) => (
                  <div key={i} className="badge red" style={{ marginTop: 6 }} data-testid={`publish-error-${ot.typeKey}`}>
                    {e.message}
                  </div>
                ))}
              </div>
            );
          })}
          {draft.suggestion.linkTypes.length > 0 && (
            <div className="panel" style={{ marginTop: 4 }}>
              <div className="section-title">关系建议</div>
              {draft.suggestion.linkTypes.map((lt, i) => (
                <div key={i} className="mono" style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 3 }}>
                  {lt.fromTypeKey} —{lt.cardinality}→ {lt.toTypeKey}
                  <span style={{ color: "var(--muted2)" }}> via {lt.viaFields.fromField}={lt.viaFields.toField}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 栏3：操作面板 */}
        <div className={`panel ${styles.col}`}>
          <div className="section-title">{t.operations}</div>
          <OperationPanel draft={draft} onApply={(op) => patchMut.mutate(op)} pending={patchMut.isPending} />
        </div>
      </div>
    </div>
  );
}

function OperationPanel({
  draft,
  onApply,
  pending,
}: {
  draft: ModelingDraftVM;
  onApply: (op: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const typeKeys = draft.suggestion.objectTypes.map((o) => o.typeKey);
  const [typeKey, setTypeKey] = useState(typeKeys[0] ?? "");
  const selected = draft.suggestion.objectTypes.find((o) => o.typeKey === typeKey);
  const [renameTo, setRenameTo] = useState("");
  const [propKey, setPropKey] = useState("");
  const [newProp, setNewProp] = useState({ propKey: "", sourceField: "", dataType: "string" });
  const [refTo, setRefTo] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 12 }}>
      <label>
        对象类型
        <select style={{ width: "100%" }} value={typeKey} onChange={(e) => setTypeKey(e.target.value)} aria-label="操作对象类型">
          {typeKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.opGroup}>
        <div className="section-title">改名</div>
        <input placeholder="新 typeKey" value={renameTo} aria-label="新 typeKey" onChange={(e) => setRenameTo(e.target.value)} />
        <button className="btn sm" disabled={!renameTo || pending} data-testid="op-rename" onClick={() => onApply({ op: "renameType", typeKey, newTypeKey: renameTo })}>
          应用
        </button>
      </div>

      <div className={styles.opGroup}>
        <div className="section-title">加属性</div>
        <input placeholder="propKey" value={newProp.propKey} aria-label="新属性 propKey" onChange={(e) => setNewProp({ ...newProp, propKey: e.target.value })} />
        <input placeholder="sourceField" value={newProp.sourceField} aria-label="新属性 sourceField" onChange={(e) => setNewProp({ ...newProp, sourceField: e.target.value })} />
        <select value={newProp.dataType} aria-label="新属性类型" onChange={(e) => setNewProp({ ...newProp, dataType: e.target.value })}>
          {["string", "number", "boolean", "date", "enum", "ref"].map((dt) => (
            <option key={dt}>{dt}</option>
          ))}
        </select>
        <button
          className="btn sm"
          disabled={!newProp.propKey || pending}
          data-testid="op-add-prop"
          onClick={() =>
            onApply({
              op: "addProperty",
              typeKey,
              property: { ...newProp, isPrimaryKey: false, refToTypeKey: null },
            })
          }
        >
          应用
        </button>
      </div>

      <div className={styles.opGroup}>
        <div className="section-title">删属性 / 改类型 / 设引用</div>
        <select value={propKey} aria-label="属性" onChange={(e) => setPropKey(e.target.value)}>
          <option value="">选择属性</option>
          {(selected?.properties ?? []).map((p) => (
            <option key={p.propKey}>{p.propKey}</option>
          ))}
        </select>
        <button className="btn sm danger" disabled={!propKey || pending} data-testid="op-remove-prop" onClick={() => onApply({ op: "removeProperty", typeKey, propKey })}>
          删除属性
        </button>
        <input placeholder="ref → typeKey" value={refTo} aria-label="引用类型" onChange={(e) => setRefTo(e.target.value)} />
        <button className="btn sm" disabled={!propKey || !refTo || pending} data-testid="op-set-ref" onClick={() => onApply({ op: "setRef", typeKey, propKey, refToTypeKey: refTo })}>
          设引用
        </button>
      </div>
    </div>
  );
}

/** 本地应用 PATCH 操作（乐观更新视图） */
export function applyOperationLocally(draft: ModelingDraftVM, op: Record<string, unknown>): ModelingDraftVM {
  const next: ModelingDraftVM = JSON.parse(JSON.stringify(draft)) as ModelingDraftVM;
  const ot = next.suggestion.objectTypes.find((o) => o.typeKey === op.typeKey);
  switch (op.op) {
    case "renameType":
      if (ot) ot.typeKey = String(op.newTypeKey);
      break;
    case "addProperty":
      ot?.properties.push(op.property as (typeof ot.properties)[number]);
      break;
    case "removeProperty":
      if (ot) ot.properties = ot.properties.filter((p) => p.propKey !== op.propKey);
      break;
    case "setRef": {
      const p = ot?.properties.find((x) => x.propKey === op.propKey);
      if (p) {
        p.refToTypeKey = String(op.refToTypeKey);
        p.dataType = "ref";
      }
      break;
    }
    case "setDomain":
      if (ot) ot.domain = String(op.domain);
      break;
    default:
      break;
  }
  return next;
}
