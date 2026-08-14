import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeSolver } from "@/api/endpoints";
import { BlockConversable } from "@/components/BlockConversable";
import { api } from "@/api/apiClient";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

/**
 * WO-ORDER-JOURNEY · **决策推演面板**（`DecisionPlayView` 页面壳与各宿主页的就地嵌入，用的是这一份）。
 *
 * ── 为什么把它从页里抽出来（仓主原话）────────────────────────────────────────
 * 「导航栏里面的『决策推演』**不应该在这个位置，而是嵌入到每个需要决策推演的位置，
 *   每个需要决策的点都需要这个页面**」。
 * 于是本文件是**唯一实现**：`DecisionPlayView.tsx` 退化成「读 URL 参数 → 渲染本面板」的壳，
 * 宿主页（订单进展与卡因 / 链路阻滞点 / 沙盘）直接 `<DecisionPlayEmbed .../>` 就地展开。
 * 「壳与嵌入是同一份实现」这句话不是承诺，是**可被门咬的结构**：
 * 改本文件一处文案 ⇒ 壳页与嵌入处**同时**变（接缝测试两处断言一起红）。
 *
 * ── 本面板**不依赖 router**（这是硬约束，不是风格偏好）──────────────────────
 * `useSearchParams()` / `useNavigate()` 在 `<Router>` 之外会抛（v6 invariant），
 * 而嵌入处的宿主页测试常不带 Router 直接挂载组件。故本面板吃**明确 props**，
 * URL 解析留在壳里（`DecisionPlayView.tsx`）。
 *
 * ── 原页注释保留如下（5 区语义未变）──────────────────────────────────────────
 * 把 `decision_play` 求解器（G-DECISION·CEO-3）天然的 5 区决策产物落地为一张页：
 *   ① 根因区   ② 方案卡区（点开看六维 + provenance 下钻·CEO 核心诉求「为何做/何用/为何有用」）
 *   ③ 比对矩阵 ④ 触发规则 ⑤ 推荐组合 + 差距收窄试算（可选：提交决策→ S2 审批链）
 *
 * KILL-MOCK 铁律：5 区全部从真 `invokeSolver('decision_play')` 输出渲染，零写死数字/叙事串——改后端根因颗粒
 * （LTA 实际交付 / BackupSupplierPool.certWeeks / MaterialBalance.gapTon）→ 方案 closesGap / 推荐组合 / narrowedPct
 * 随之变（引擎侧 decision-play.test C6 已锁；本页仅忠实投影）。
 * 诚实标注（三态之二·本页 solver 产物侧）：sourceKind=solver →「确定性求解」，agent →「策略推理·确定性生成」
 *（datacore 侧确定性策略生成·读真对象派生·非真 LLM 推理），**绝不**标成"数据库事实"。第三态「真 LLM 推理」在
 * 对话侧 AnswerCard（path-B 真 LLM 深问·据页/块上下文工具取证·WO-REAL-LLM-FREE-QUERY）。空根因/空因果→诚实空态，不编方案。
 */

interface DPProvenance {
  kind: string;
  basis: string;
  drillType: string;
  drillId: string;
  drillValue: number;
}
interface DPOption {
  optionId: string;
  factorId: string;
  label: string;
  sourceKind: "solver" | "agent";
  closesGap: number;
  cost: number;
  cycleDays: number;
  risk: number;
  exposure: number;
  reversibility: number;
  provenance: DPProvenance;
}
interface DPDims {
  closesGap: number;
  cost: number;
  cycleDays: number;
  risk: number;
  exposure: number;
  reversibility: number;
}
interface DPMatrixRow {
  optionId: string;
  label: string;
  dims: DPDims;
}
interface DPTrigger {
  triggerId: string;
  signalRef: string;
  signalValue: number;
  op: string;
  threshold: number;
  fired: boolean;
  action: string;
  thresholdSource: "rule.params" | "trigger.default";
}
interface DPStep {
  phase: string;
  action: string;
  optionRef: string;
}
interface DPPlan {
  planId: string;
  optionIds: string[];
  steps: DPStep[];
  totalClosesGap: number;
  totalCost: number;
}
interface DPNarrowing {
  beforeGap: number;
  afterGap: number;
  narrowedPct: number;
  ticks: number;
}
/**
 * WO-ORDER-JOURNEY · 引擎的**落点锚定块**（`solvers/service.ts decisionPlayLocus`）。
 * 只在请求带了 `locusType`+`locusId` 时下发 ⇒ 本类型全 optional，缺了就是「本次没锚落点」。
 */
interface DPLocusJoin {
  status: "JOINED" | "NO_FACTOR";
  /** `EXACT` 这一张单据自己的因子 · `TYPE` 只对上到类型（drillId 是 `*`/`DYNAMIC-*` 占位）· `NONE` 真没有。 */
  precision: "EXACT" | "TYPE" | "NONE";
  factorId: string | null;
  factorLabel: string | null;
  drillField: string | null;
  /** 凭什么这么对上/为什么对不上 —— 引擎原文，前端一个字不改写。 */
  basis: string;
  candidateFactorCount: number;
}
interface DPCandidateDim {
  key: string;
  label: string;
  value: number;
  baseline: number;
  unit: string;
  betterWhen: string;
  dataMode: string;
}
interface DPCandidate {
  candidateId: string;
  label: string;
  lever: { objectType: string; objectId: string; prop: string; unit: string; valueKind?: string; factorName?: string };
  fromValue: number;
  toValue: number;
  join: { kind: string; path: string };
  rungSource: string;
  effectKind: string;
  dims: DPCandidateDim[];
}
interface DPLocusImpediment {
  impedimentId: string;
  kind: string;
  stage: string;
  severity: number;
  dataMode: string;
  candidates: DPCandidate[];
  noCandidateReason?: string;
  noCandidateKind?: string;
}
interface DPLocusPlay {
  locus: { objectType: string; objectId: string };
  join: DPLocusJoin;
  impediments: DPLocusImpediment[];
  candidateTotal: number;
  scanId: string;
  ruleSetVersion?: string;
  optionsNote: string;
  summary: string;
}

interface DecisionPlayOutput {
  rootCause: { factorId: string; label: string; metricKey: string; gap: number; unit: string } | null;
  options: DPOption[];
  matrix: DPMatrixRow[];
  triggers: DPTrigger[];
  recommendedPlan: DPPlan;
  sandboxNarrowing: DPNarrowing;
  summary: string;
  /** 只在锚了落点时存在（引擎不传这个键 = 本次没锚落点，不是「锚了但空」）。 */
  locusPlay?: DPLocusPlay;
}

/** 六维（与 decision_play options/matrix.dims 一字不差）· better 指方向语义（用于比对矩阵「最优列」判定，非写死数值）。 */
const DIMS: { key: keyof DPDims; label: string; better: "high" | "low"; unit?: "gap" | "day" | "frac" | "cost" }[] = [
  { key: "closesGap", label: "补缺口", better: "high", unit: "gap" },
  { key: "cost", label: "代价", better: "low", unit: "cost" },
  { key: "cycleDays", label: "周期", better: "low", unit: "day" },
  { key: "risk", label: "风险", better: "low", unit: "frac" },
  { key: "exposure", label: "敞口", better: "low", unit: "frac" },
  { key: "reversibility", label: "可逆", better: "high", unit: "frac" },
];

const PHASES = ["即刻", "本季", "半年"] as const;

const fmt = (n: number): string => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "—");

function dimValueLabel(key: keyof DPDims, v: number, gapUnit: string): string {
  const meta = DIMS.find((d) => d.key === key)!;
  if (meta.unit === "gap") return `${fmt(v)}${gapUnit}`;
  if (meta.unit === "day") return `${fmt(v)} 天`;
  return fmt(v); // cost / frac：不臆造单位（诚实）
}

/**
 * WO-SANDBOX-IMP2PLAN · **「从阻滞点进来」的入参路径**（本页只加这一条，5 区渲染一行不动）。
 *
 * 沙盘 `SandboxConsole` 的逐条阻滞点点进来时带一串 `imp*` query（键的单一出处 =
 * `views/sim/sandboxConsoleModel.ts` 的 `IMP_PARAM`）。本页据此在顶上出一条**入口横幅**，
 * 说清三件事，缺一件都算骗人：
 *  ① 你是从哪条阻滞点点进来的（真对象 locus + 触发的规则 + 实测 vs 阈值那一维在沙盘上已给）；
 *  ② **这条阻滞点有没有对到具体因子**。今天对不上 —— 而且不许静默：
 *     `decision_play` 拿到对不上的 factorId 会**静默回落**到贡献最大的默认根因
 *     （`solvers/service.ts:2882`），所以沙盘那边**一个 factorId 都没传**，
 *     本页下面 5 区显示的是**引擎默认根因**，不是这条阻滞点的根因 —— 这句必须写在脸上。
 *  ③ 阻滞点自己的 `dataMode` 限定（PARTIAL/SYNTHETIC/EMPTY）随行带上，
 *     别让人以为跳过来看到的是确凿结论。
 */
interface ImpedimentEntry {
  impedimentId: string;
  kind: string;
  stage: string;
  ruleKey: string | null;
  locusType: string;
  locusId: string;
  locusLabel: string;
  mode: string;
  join: string;
  /** 沙盘真传了 factorId 才算对上（`join==="JOINED"` ⟺ 有 factorId）。 */
  factorId: string | null;
}

/** URL query → 入口横幅数据。**只有页面壳用**（面板本身不碰 router，见文件头）。 */
export function readImpedimentEntry(params: URLSearchParams): ImpedimentEntry | null {
  const impedimentId = params.get("fromImpediment");
  if (impedimentId === null || impedimentId === "") return null;
  const factorId = params.get("factorId");
  return {
    impedimentId,
    kind: params.get("impKind") ?? "",
    stage: params.get("impStage") ?? "",
    ruleKey: params.get("impRule"),
    locusType: params.get("impLocusType") ?? "",
    locusId: params.get("impLocusId") ?? "",
    locusLabel: params.get("impLocusLabel") ?? "",
    mode: params.get("impMode") ?? "",
    join: params.get("impJoin") ?? "NO_FACTOR_DIMENSION",
    factorId: factorId === null || factorId === "" ? null : factorId,
  };
}

/** 非 LIVE 的诚实位在跳转后**必须仍在**（③）。四态四句，与沙盘侧 `DATA_MODE_CLAIM` 同源语义。 */
const ENTRY_MODE_NOTE: Record<string, string> = {
  LIVE: "实测判定：整条规则表达式在对象快照上求值命中。",
  PARTIAL: "部分判定：这条阻滞点的结论被削弱过（引擎 caveats 原文见沙盘那一条），不可当全量判定用。",
  SYNTHETIC: "判定成立，但 locus 对象来自合成种子数据，不是生产实测值。",
  EMPTY: "算不出来：该环节读数不可信 —— 不是一个「0」，也不是「没问题」，是量不到。",
};

function ImpedimentEntryBanner({ entry }: { entry: ImpedimentEntry }) {
  const joined = entry.join === "JOINED" && entry.factorId !== null;
  return (
    <div
      className="panel"
      data-testid="dp-from-impediment"
      data-join={joined ? "JOINED" : "NO_FACTOR_DIMENSION"}
      data-impediment-id={entry.impedimentId}
      data-mode={entry.mode}
      style={{ borderLeft: `3px solid ${joined ? "var(--ok)" : "var(--amber, #d89b28)"}` }}
    >
      <div className="section-title">从阻滞点进来 · {entry.kind}</div>
      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
        沙盘那条阻滞点落在真对象{" "}
        <b className="mono" data-testid="dp-from-locus">
          {entry.locusType}／{entry.locusId}
        </b>
        「{entry.locusLabel}」· 段 <span className="mono">{entry.stage}</span>
        {entry.ruleKey === null ? null : (
          <>
            {" "}· 触发规则 <span className="mono">{entry.ruleKey}</span>
          </>
        )}
        。
      </div>

      {joined ? (
        <div data-testid="dp-from-join-ok" style={{ fontSize: 12, color: "var(--ok-txt)", marginTop: 6 }}>
          已对到因果因子 <b className="mono">{entry.factorId}</b> —— 下面 5 区就是这条阻滞点的根因推演。
        </div>
      ) : (
        <div
          data-testid="dp-from-join-gap"
          style={{ fontSize: 12, color: "var(--amber-txt, #d89b28)", marginTop: 6, lineHeight: 1.8 }}
        >
          <b>本次未能把这个阻滞点对到具体因子。</b>
          原因：阻滞点锚在真对象 <span className="mono">locus{"{objectType,objectId}"}</span> 上，决策推演锚在{" "}
          <span className="mono">CausalFactor</span> 上，今天引擎回包里<b>没有任何承载因果因子的字段</b>
          （contracts <span className="mono">ChainImpedimentSchema</span> 是 strictObject，逐键核过，无
          factorId / factorRef，locus 里也没有）。唯一可能的对法是拿{" "}
          <span className="mono">locus{"{objectType,objectId}"}</span> 去撞{" "}
          <span className="mono">CausalFactor{"{drillType,drillId}"}</span> —— 实测撞不上：demo 的 locus 只有
          MaterialBalance / MaterialBatch / Line 三类，而合成种子里带 drillType=MaterialBatch 或 Line 的因子
          <b>一条都没有</b>。
          <div style={{ marginTop: 5 }}>
            所以<b>没有猜一个 factorId 传过来</b>（猜了会被 <span className="mono">decision_play</span>{" "}
            静默回落到贡献最大的默认根因，屏上就会出现一个看着确凿、实则与这条阻滞点无关的根因）。
            <b data-testid="dp-from-default-root">
              ⇒ 下面 5 区显示的是引擎按贡献选出的<u>默认根因</u>，不是这条阻滞点对应的根因。
            </b>
            今天真带过来的只有 <span className="mono">stage={entry.stage}</span>（段级粗筛，不是因子级）。
          </div>
        </div>
      )}

      {entry.mode !== "LIVE" && entry.mode !== "" ? (
        <div
          data-testid="dp-from-caveat"
          data-mode={entry.mode}
          style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.7 }}
        >
          <b>这条阻滞点的诚实位随行：</b>
          {ENTRY_MODE_NOTE[entry.mode] ?? `引擎标了 ${entry.mode}，本页不替它编一个解释。`}
        </div>
      ) : null}
    </div>
  );
}

/** 落点锚（阻滞点 `locus{objectType,objectId}` / 订单站点的真对象）。传了才向引擎要 `locusPlay` 块。 */
export interface DecisionLocus {
  objectType: string;
  objectId: string;
  /** 人读名（屏上显示用；引擎不认这一维，只是给人看的）。 */
  label?: string;
}

export interface DecisionPlayPanelProps {
  metricKey: string;
  factorId?: string;
  locus?: DecisionLocus | null;
  /** 从阻滞点进来的入口横幅数据（页面壳从 URL 读；宿主页就地传）。 */
  entry?: ImpedimentEntry | null;
  /** 嵌入态：宿主页已有自己的标题层，本面板不再占页级空间。 */
  embedded?: boolean;
  /** 门用来分辨「这是哪一处渲染的同一份面板」（壳 vs 各嵌入处）。 */
  testId?: string;
}

/**
 * **决策推演面板本尊** —— 页面壳与所有就地嵌入共用这一份（不依赖 router）。
 */
export function DecisionPlayPanel({ metricKey, factorId = "", locus = null, entry = null, embedded = false, testId }: DecisionPlayPanelProps) {
  const impEntry = entry;
  const locusType = locus?.objectType ?? "";
  const locusId = locus?.objectId ?? "";

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["a", "decision_play", metricKey, factorId, locusType, locusId],
    queryFn: async () => {
      const args: Record<string, unknown> = {};
      if (metricKey) args.metricKey = metricKey;
      if (factorId) args.factorId = factorId;
      // 落点锚：两个键必须同时给（引擎缺一即视为「没锚」，见 decisionPlayLocus 头两行）。
      if (locusType && locusId) { args.locusType = locusType; args.locusId = locusId; }
      const res = await invokeSolver("decision_play", args);
      return res.data as DecisionPlayOutput;
    },
    retry: false,
  });

  if (isLoading) return <div className="empty-state" data-testid={testId ? `${testId}-loading` : undefined}>{zh.common.loading}</div>;

  // 诚实空态：无根因 / 空因果（引擎无 gap_attribution 根 → 抛 validationError；或功能未开 → 404）。绝不编方案。
  // 从阻滞点进来时**空态也要带横幅**：用户点了一条真阻滞点，屏上必须说清"你点的那条在这儿，只是推不出方案"。
  if (isError || !data || !data.rootCause) {
    const reason = (error as { message?: string } | undefined)?.message;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid={testId}>
        {impEntry === null ? null : <ImpedimentEntryBanner entry={impEntry} />}
        <div className="empty-state" data-testid="dp-empty">
        <div className="code">💡</div>
        <div style={{ fontWeight: 600, color: "var(--txt)" }}>暂无可推演的根因</div>
        <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 460, textAlign: "center", lineHeight: 1.7 }}>
          决策推演需先有 gap_attribution 根因（越线 Metric + 因果链）。当前无可行动根因或该指标未越线——诚实空态，不编造方案。
          {reason ? <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 12 }}>{reason}</div> : null}
        </div>
        </div>
      </div>
    );
  }

  return <DecisionPlay out={data} metricKey={metricKey} impEntry={impEntry} embedded={embedded} testId={testId} />;
}

/**
 * **就地嵌入壳**（宿主页用这个，不直接用 `DecisionPlayPanel`）。
 *
 * 为什么默认折叠：`OrderChainView` / `ChainImpedimentView` 都在 `check-ui-first-layer` 的棘轮基线里，
 * 把整块方案对比摊在第一层会让 `first` 当场涨 —— 而规范 §1 说得很清楚：
 * **第一层只放「数值 / 状态 / 名字」，明细降第二层**。故第一层只留**一个可见记号**
 * （`summary` 那一行），点开才请求引擎（`<details>` 未展开时子树不挂载 ⇒ 也不多打一次求解器）。
 * ⚠ 「静默降层等于删除」——所以记号必须**可见且写清点开能拿到什么**，不是一个光秃秃的三角。
 */
export function DecisionPlayEmbed({
  metricKey,
  factorId,
  locus,
  entry,
  testId,
  summaryLabel,
}: DecisionPlayPanelProps & { summaryLabel?: string }) {
  const [open, setOpen] = useState(false);
  const label = summaryLabel ?? zh.decisionPlay.embedSummary;
  return (
    <details
      data-testid={testId ? `${testId}-details` : undefined}
      data-locus-type={locus?.objectType}
      data-locus-id={locus?.objectId}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary data-testid={testId ? `${testId}-summary` : undefined} style={{ fontSize: 12, cursor: "pointer" }}>
        {label}
        {locus ? <span className="mono" style={{ marginLeft: 6, color: "var(--muted)" }}>{locus.objectType}／{locus.objectId}</span> : null}
      </summary>
      <div style={{ marginTop: 10 }}>
        {open ? (
          <DecisionPlayPanel
            metricKey={metricKey}
            {...(factorId === undefined ? {} : { factorId })}
            {...(locus === undefined ? {} : { locus })}
            {...(entry === undefined ? {} : { entry })}
            embedded
            {...(testId === undefined ? {} : { testId })}
          />
        ) : null}
      </div>
    </details>
  );
}

/**
 * WO-ORDER-JOURNEY · 落点块上屏：**这个卡点自己的可执行解法**。
 *
 * 它与上面 ② 方案卡区**不是一回事**，这句话必须写在脸上（引擎 `optionsNote` 原文照抄，前端不概括）：
 * 上面是公司级战略（恒 3 条·任何 metricKey 都一样），这里是「把哪个真对象的哪个真属性从多少拨到多少」。
 * 「没有候选」三态（NONE / UNAVAILABLE / 无 candidates 字段）**禁塌成一句「暂无方案」** ——
 * 与沙盘 `CandidateAbsenceBlock` 同一条纪律：空白比错答更容易被读成「这里没问题」。
 */
function LocusPlayBlock({ lp }: { lp: DPLocusPlay }) {
  const joined = lp.join.status === "JOINED";
  return (
    <div className="panel" data-testid="dp-locus-play" data-join={lp.join.status} data-precision={lp.join.precision} data-candidate-total={lp.candidateTotal}>
      <div className="section-title">
        ⑥ 这个落点自己的解法 · <span className="mono" data-testid="dp-locus-ref">{lp.locus.objectType}／{lp.locus.objectId}</span>
        {" · "}<b data-testid="dp-locus-cand-total">{lp.candidateTotal}</b> 条
      </div>

      {/* 根因那一维：对上了没有、以什么精度对上的（EXACT / TYPE / NONE 三态禁塌） */}
      <div
        data-testid="dp-locus-join"
        style={{ fontSize: 12, lineHeight: 1.8, color: joined ? "var(--ok-txt)" : "var(--amber-txt, var(--muted))", marginBottom: 8 }}
      >
        {joined ? (
          <>
            <b>根因对上了：</b>
            <span className="mono" data-testid="dp-locus-factor">{lp.join.factorId}</span>「{lp.join.factorLabel}」
            {" · 精度 "}<span className="mono" data-testid="dp-locus-precision">{lp.join.precision}</span>
            {lp.join.precision === "TYPE" ? <b>（按类型对上，不是这一张单据自己的因子）</b> : null}
          </>
        ) : (
          <>
            <b data-testid="dp-locus-nofactor">这个落点没有对上任何因果因子</b>（诚实空 —— 没有回落到贡献最大的默认因子）。
          </>
        )}
        <div style={{ color: "var(--muted)", marginTop: 4 }} data-testid="dp-locus-basis">{lp.join.basis}</div>
      </div>

      {lp.impediments.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }} data-testid="dp-locus-no-impediment">
          本次全域扫描（scanId <span className="mono">{lp.scanId}</span>）在这个落点上没有判出任何阻滞点 ——
          这是「查过了没有」，不是「没查」。
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {lp.impediments.map((im) => (
            <div key={im.impedimentId} data-testid={`dp-locus-imp-${im.impedimentId}`} style={{ borderLeft: "3px solid var(--line2)", paddingLeft: 10 }}>
              <div style={{ fontSize: 12 }}>
                <span className="badge">{im.kind}</span>
                <span className="mono" style={{ marginLeft: 6, color: "var(--muted)" }}>{im.stage}</span>
                <span style={{ marginLeft: 6 }}>严重度 <b className="mono">{fmt(im.severity)}</b></span>
                <span className="badge" style={{ marginLeft: 6 }}>{im.dataMode}</span>
              </div>
              {im.candidates.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 5, lineHeight: 1.7 }} data-testid={`dp-locus-absence-${im.impedimentId}`} data-kind={im.noCandidateKind ?? "NOT_RUN"}>
                  <b>{im.noCandidateKind === "UNAVAILABLE" ? "算不出来（缺答不是答）" : im.noCandidateKind === "NONE" ? "枚举跑完了，真没有有效解法" : "本次没跑枚举（回包无 candidates 字段）"}</b>
                  {im.noCandidateReason ? <div style={{ marginTop: 3 }}>{im.noCandidateReason}</div> : null}
                </div>
              ) : (
                <ul style={{ margin: "6px 0 0", paddingLeft: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                  {im.candidates.map((c) => (
                    <li key={c.candidateId} data-testid={`dp-cand-${c.candidateId}`} style={{ fontSize: 12, lineHeight: 1.7 }}>
                      <b>{c.label}</b>
                      <div className="mono" style={{ color: "var(--muted)" }} data-from={c.fromValue} data-to={c.toValue}>
                        {c.lever.objectType}.{c.lever.prop}（{c.lever.objectId}）{fmt(c.fromValue)} → {fmt(c.toValue)} {c.lever.unit}
                      </div>
                      <div style={{ color: "var(--muted)" }}>档位来源：{c.rungSource}</div>
                      <div style={{ color: "var(--muted)" }}>怎么 join 出来的：{c.join.kind} · {c.join.path}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.7 }} data-testid="dp-locus-options-note">
        {lp.optionsNote}
      </div>
    </div>
  );
}

function DecisionPlay({
  out,
  metricKey,
  impEntry,
  embedded,
  testId,
}: {
  out: DecisionPlayOutput;
  metricKey: string;
  impEntry: ImpedimentEntry | null;
  embedded?: boolean;
  testId?: string;
}) {
  const { rootCause, options, matrix, triggers, recommendedPlan, sandboxNarrowing, summary } = out;
  const rc = rootCause!;
  const recSet = useMemo(() => new Set(recommendedPlan.optionIds), [recommendedPlan.optionIds]);

  // 比对矩阵「最优列」：逐维在真值中取最优（high→max / low→min），非写死。空矩阵安全。
  const bestByDim = useMemo(() => {
    const m: Partial<Record<keyof DPDims, string>> = {};
    for (const d of DIMS) {
      let best: DPMatrixRow | undefined;
      for (const row of matrix) {
        if (!best) { best = row; continue; }
        const v = row.dims[d.key];
        const bv = best.dims[d.key];
        if (d.better === "high" ? v > bv : v < bv) best = row;
      }
      if (best) m[d.key] = best.optionId;
    }
    return m;
  }, [matrix]);

  // WO-BLOCK-DIALOGUE：块级 getData 各返该块**真实渲染数据**（根因/方案/矩阵真值·非写死·改根因颗粒→随之变 C4）。
  const rootBlockData = (): Record<string, unknown> => ({
    metricKey: rc.metricKey,
    factorId: rc.factorId,
    label: rc.label,
    gap: rc.gap,
    unit: rc.unit,
    summary,
  });
  const optionsBlockData = (): Record<string, unknown> => ({
    metricKey: rc.metricKey,
    factorId: rc.factorId,
    count: options.length,
    options: options.map((o) => ({ optionId: o.optionId, label: o.label, sourceKind: o.sourceKind, closesGap: o.closesGap, cost: o.cost, cycleDays: o.cycleDays, risk: o.risk, exposure: o.exposure, reversibility: o.reversibility })),
    recommendedOptionIds: [...recSet],
  });
  const matrixBlockData = (): Record<string, unknown> => ({
    metricKey: rc.metricKey,
    factorId: rc.factorId,
    dims: DIMS.map((d) => ({ key: d.key, label: d.label, better: d.better })),
    rows: matrix.map((row) => ({ optionId: row.optionId, label: row.label, dims: row.dims })),
    bestByDim,
    recommendedOptionIds: [...recSet],
  });

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      data-testid={testId ?? "decision-play"}
      data-decision-play="1"
      data-embedded={embedded ? "1" : "0"}
    >
      {/* WO-ORDER-JOURNEY：壳与嵌入是同一份实现的**可断言记号** —— 两处都渲染这一行，
          改这里一处文案 ⇒ 壳页与嵌入处同时变（接缝测试两处断言一起红）。 */}
      <div data-testid="dp-impl-stamp" style={{ fontSize: 12, color: "var(--muted2)" }}>
        {zh.decisionPlay.implStamp}
      </div>

      {/* ── 从阻滞点进来的入口横幅（WO-SANDBOX-IMP2PLAN；不改下面 5 区）── */}
      {impEntry === null ? null : <ImpedimentEntryBanner entry={impEntry} />}

      {/* ── ⑥ 落点自己的解法（只在锚了落点时出现·WO-ORDER-JOURNEY）── */}
      {out.locusPlay === undefined ? null : <LocusPlayBlock lp={out.locusPlay} />}

      {/* ── ① 根因区 ── */}
      <BlockConversable blockId="dp-root-cause" blockType="decision-root-cause" blockTitle={`决策根因「${rc.label}」`} getData={rootBlockData} getSelection={() => [rc.factorId]} provenanceRef="gap_attribution">
      <div className="panel" data-testid="dp-root-cause" style={{ borderLeft: "3px solid var(--danger)" }}>
        <div className="section-title">① 根因</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--txt)" }}>
          根因「<span style={{ color: "var(--danger-txt)" }}>{rc.label}</span>」· 越线{" "}
          <span className="mono">{rc.metricKey}</span> 缺口{" "}
          <b className="mono" data-testid="dp-root-gap" style={{ color: "var(--danger-txt)" }}>{fmt(rc.gap)}{rc.unit}</b>
        </div>
        <div data-testid="dp-summary" style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.7 }}>{summary}</div>
      </div>
      </BlockConversable>

      {/* ── ② 方案卡区（点开看六维 + provenance 下钻）── */}
      <BlockConversable blockId="dp-options" blockType="decision-options" blockTitle="对症方案区" getData={optionsBlockData} getSelection={() => [rc.factorId]} provenanceRef="decision_play">
      <div className="panel" data-testid="dp-options">
        <div className="section-title">② 对症方案（{options.length}）· 点开看六维 + 为何做 / 何用 / 为何有用</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
          {options.map((o) => (
            <OptionCard key={o.optionId} o={o} gap={rc.gap} unit={rc.unit} recommended={recSet.has(o.optionId)} />
          ))}
        </div>
      </div>
      </BlockConversable>

      {/* ── ③ 比对矩阵（行=方案·列=六维·最优列高亮）── */}
      <BlockConversable blockId="dp-matrix" blockType="decision-matrix" blockTitle="方案比对矩阵" getData={matrixBlockData} getSelection={() => [rc.factorId]} provenanceRef="decision_play">
      <div className="panel" data-testid="dp-matrix">
        <div className="section-title">③ 比对矩阵 · 每列最优高亮</div>
        <div style={{ overflowX: "auto" }}>
          <table className="cmp" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>方案</th>
                {DIMS.map((d) => (
                  <th key={d.key}>{d.label}<small style={{ color: "var(--muted2)", fontWeight: 400 }}> {d.better === "high" ? "↑优" : "↓优"}</small></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.optionId} data-testid={`dp-matrix-row-${row.optionId}`} style={recSet.has(row.optionId) ? { background: "rgba(76,144,240,.08)" } : undefined}>
                  <td className="zh">
                    <b>{row.label}</b>
                    {recSet.has(row.optionId) && <span className="badge blue" style={{ marginLeft: 6, fontSize: 12 }}>推荐</span>}
                  </td>
                  {DIMS.map((d) => {
                    const isBest = bestByDim[d.key] === row.optionId;
                    return (
                      <td
                        key={d.key}
                        data-testid={`dp-matrix-${row.optionId}-${d.key}`}
                        data-best={isBest ? "1" : undefined}
                        style={isBest ? { background: "rgba(98,190,119,.16)", color: "var(--ok-txt)", fontWeight: 600 } : undefined}
                      >
                        {dimValueLabel(d.key, row.dims[d.key], rc.unit)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </BlockConversable>

      {/* ── ④ 触发规则（信号真值 op 阈值 → fired?；thresholdSource 标注）── */}
      <div className="panel" data-testid="dp-triggers">
        <div className="section-title">④ 触发规则 · {triggers.filter((t) => t.fired).length}/{triggers.length} 已触发</div>
        {triggers.length === 0 ? (
          <div className="empty-state" style={{ padding: 20, fontSize: 12 }}>{zh.common.none}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {triggers.map((t) => (
              <div
                key={t.triggerId}
                data-testid={`dp-trigger-${t.triggerId}`}
                data-fired={t.fired ? "1" : "0"}
                className="panel"
                style={{ padding: "8px 10px", borderLeft: `3px solid ${t.fired ? "var(--danger)" : "var(--line2)"}`, background: t.fired ? "rgba(224,98,108,.07)" : undefined }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                  <span className="mono">{t.signalRef}</span>
                  <span>当前值 <b className="mono">{fmt(t.signalValue)}</b></span>
                  <span className="mono" style={{ color: "var(--muted)" }}>{t.op}</span>
                  <span>阈值 <b className="mono">{fmt(t.threshold)}</b></span>
                  <span style={{ color: "var(--muted2)" }}>→</span>
                  <span className={`badge ${t.fired ? "red" : "green"}`} data-testid={`dp-trigger-fired-${t.triggerId}`}>
                    {t.fired ? "已触发" : "未触发"}
                  </span>
                  <span
                    className="badge"
                    data-testid={`dp-trigger-src-${t.triggerId}`}
                    title="触发阈值来源"
                    style={t.thresholdSource === "rule.params" ? { color: "var(--accent-txt)", borderColor: "rgba(76,144,240,.45)" } : undefined}
                  >
                    {t.thresholdSource === "rule.params" ? "已被规则覆盖" : "默认阈值"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>触发动作：{t.action}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── ⑤ 推荐组合 + 差距收窄试算 ── */}
      <div className="panel" data-testid="dp-plan">
        <div className="section-title">⑤ 推荐组合（{recommendedPlan.optionIds.length} 项）+ 差距收窄试算</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
          {PHASES.map((phase) => {
            const steps = recommendedPlan.steps.filter((s) => s.phase === phase);
            return (
              <div key={phase} data-testid={`dp-phase-${phase}`} className="panel" style={{ padding: 10, background: "var(--panel2)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, fontFamily: "var(--font-mono)" }}>{phase}</div>
                {steps.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--muted2)" }}>—</div>
                ) : (
                  steps.map((s) => (
                    <div key={s.optionRef} data-testid={`dp-step-${s.optionRef}`} style={{ fontSize: 12, marginBottom: 5, display: "flex", gap: 6, alignItems: "baseline" }}>
                      <span style={{ color: "var(--accent-txt)" }}>▸</span>
                      <span>{s.action}</span>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          组合补缺口 <b className="mono" style={{ color: "var(--ok-txt)" }}>{fmt(recommendedPlan.totalClosesGap)}{rc.unit}</b>
          {" · "}总代价 <b className="mono">{fmt(recommendedPlan.totalCost)}</b>
        </div>

        {/* 差距收窄试算：缺口 before→after · 收窄% 进度条 */}
        <div data-testid="dp-narrowing">
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            缺口 <b className="mono" style={{ color: "var(--danger-txt)" }}>{fmt(sandboxNarrowing.beforeGap)}{rc.unit}</b>
            <span style={{ color: "var(--muted2)" }}> → </span>
            <b className="mono" style={{ color: "var(--ok-txt)" }}>{fmt(sandboxNarrowing.afterGap)}{rc.unit}</b>
            {" · 收窄 "}
            <b className="mono" data-testid="dp-narrowed-pct" style={{ color: "var(--accent-txt)" }}>{fmt(sandboxNarrowing.narrowedPct)}%</b>
          </div>
          <div style={{ height: 10, borderRadius: 6, background: "var(--line2)", overflow: "hidden" }}>
            <div
              data-testid="dp-narrowed-bar"
              style={{
                height: "100%",
                width: `${Math.max(0, Math.min(100, sandboxNarrowing.narrowedPct))}%`,
                background: "linear-gradient(90deg, var(--accent), var(--ok))",
              }}
            />
          </div>
        </div>

        <CommitBar
          metricKey={rc.metricKey || metricKey}
          factorId={rc.factorId}
          optionIds={recommendedPlan.optionIds}
        />
      </div>
    </div>
  );
}

/** 方案卡：默认显 label + sourceKind 徽标 + 补缺口；点击展开 → 六维 + 「为何做 / 何用 / 为何有用」+ provenance 下钻。 */
function OptionCard({ o, gap, unit, recommended }: { o: DPOption; gap: number; unit: string; recommended: boolean }) {
  const [open, setOpen] = useState(false);
  const [drillOpen, setDrillOpen] = useState(false);
  const isSolver = o.sourceKind === "solver";
  const gapPct = gap > 0 ? Math.round((o.closesGap / gap) * 1000) / 10 : 0;

  return (
    <div
      className="panel"
      data-testid={`dp-option-${o.optionId}`}
      style={{ padding: 12, borderLeft: `3px solid ${recommended ? "var(--accent)" : "var(--line2)"}` }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid={`dp-option-toggle-${o.optionId}`}
        aria-expanded={open}
        style={{ display: "flex", width: "100%", textAlign: "left", flexDirection: "column", gap: 6, background: "transparent", border: "none", padding: 0 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <b style={{ fontSize: 13 }}>{o.label}</b>
          {recommended && <span className="badge blue" style={{ fontSize: 12 }}>推荐</span>}
          <span style={{ marginLeft: "auto", color: "var(--muted2)", fontSize: 12 }}>{open ? "收起 ▲" : "展开 ▼"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* 诚实徽标（三态之二）：solver=确定性求解（绿）/ agent=策略推理·确定性生成（灰·datacore 确定性策略·非真 LLM）——绝不标"数据库事实"。 */}
          <span
            className={`badge ${isSolver ? "green" : ""}`}
            data-testid={`dp-src-${o.optionId}`}
            style={isSolver ? undefined : { color: "var(--muted)", borderColor: "var(--line2)" }}
          >
            {isSolver ? "确定性求解" : "策略推理·确定性生成"}
          </span>
          <span style={{ fontSize: 12 }}>
            补缺口 <b className="mono" data-testid={`dp-option-cg-${o.optionId}`} style={{ color: "var(--ok-txt)" }}>{fmt(o.closesGap)}{unit}</b>
          </span>
        </div>
      </button>

      {open && (
        <div data-testid={`dp-option-detail-${o.optionId}`} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* 为何做 */}
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
            <b style={{ color: "var(--accent-txt)" }}>为何做：</b>
            针对根因 —— 预计补缺口 <b className="mono" style={{ color: "var(--ok-txt)" }}>{fmt(o.closesGap)}{unit}</b>
            （占总缺口 {fmt(gap)}{unit} 的 <b className="mono">{gapPct}%</b>）。
          </div>

          {/* 何用：六维条 */}
          <div>
            <b style={{ color: "var(--accent-txt)", fontSize: 12 }}>做了何用（六维）：</b>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
              {DIMS.map((d) => (
                <DimBar key={d.key} optionId={o.optionId} dimKey={d.key} label={d.label} value={o[d.key]} unit={unit} better={d.better} />
              ))}
            </div>
          </div>

          {/* 为何有用：provenance 下钻真对象 */}
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
            <b style={{ color: "var(--accent-txt)" }}>为何有用：</b>
            依据 <span className="badge" style={{ fontSize: 12 }}>{o.provenance.kind}</span> · {o.provenance.basis}
            <div style={{ marginTop: 5 }}>
              <button
                className="btn sm"
                data-testid={`dp-drill-${o.optionId}`}
                onClick={() => setDrillOpen((v) => !v)}
              >
                下钻真对象：{o.provenance.drillType}「{o.provenance.drillId}」= <b className="mono" style={{ marginLeft: 4 }}>{fmt(o.provenance.drillValue)}</b>
              </button>
              {drillOpen && (
                <div
                  data-testid={`dp-drill-detail-${o.optionId}`}
                  role="tooltip"
                  /* WO-HOVER-LAYER：表面收口到全局 .popover-surface（不透明·三套主题各自定义·已验过
                     遮蔽性与 AA 对比度），不再自写 background —— 自写一份就是给那张验过的表面开分身。 */
                  className="popover-surface"
                  style={{ marginTop: 6, padding: "8px 10px", fontSize: 12, lineHeight: 1.6 }}
                >
                  来自 <b>{o.provenance.drillType}</b>.<b>{o.provenance.drillId}</b> · {o.provenance.basis} = <b className="mono">{fmt(o.provenance.drillValue)}</b>
                  <div style={{ color: "var(--muted2)", marginTop: 4 }}>
                    {isSolver ? "确定性求解器输出（读真对象派生）" : "策略推理·确定性生成（读真对象派生·datacore 确定性策略·非真 LLM 推理）"}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 单维条：值 + 归一化条（宽度=值/本维在诸方案中的极值·纯投影非写死）。方向色仅示意语义，不改数值。 */
function DimBar({ optionId, dimKey, label, value, unit, better }: { optionId: string; dimKey: keyof DPDims; label: string; value: number; unit: string; better: "high" | "low" }) {
  // 归一化仅取当前值绝对量做视觉宽度（frac 天然 0..1；gap/cost/day 用自身量级封顶 1 → 至少可见）。
  const norm = dimKey === "risk" || dimKey === "exposure" || dimKey === "reversibility"
    ? Math.max(0, Math.min(1, value))
    : Math.max(0, Math.min(1, Math.abs(value) / Math.max(Math.abs(value), 1)));
  const color = better === "high" ? "var(--ok)" : "var(--amber)";
  return (
    <div data-testid={`dp-dim-${optionId}-${dimKey}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ width: 52, color: "var(--muted)", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 7, borderRadius: 4, background: "var(--line2)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round(norm * 100)}%`, background: color, opacity: 0.7 }} />
      </div>
      <span className="mono" style={{ width: 64, textAlign: "right", flexShrink: 0 }}>{dimValueLabel(dimKey, value, unit)}</span>
    </div>
  );
}

/** 可选：提交决策 → 真 create Decision（选定=推荐组合）→ commit（派 ActionDraft·走 S2 审批链·门不绕）。 */
function CommitBar({ metricKey, factorId, optionIds }: { metricKey: string; factorId: string; optionIds: string[] }) {
  const [busy, setBusy] = useState(false);
  const [committedId, setCommittedId] = useState<string | null>(null);

  const commit = async () => {
    if (busy || committedId) return;
    setBusy(true);
    try {
      const dec = await api.a<{ id: string }>("/a/v1/decisions", {
        body: { metricKey, ...(factorId ? { factorId } : {}), chosenOptionIds: optionIds },
      });
      const done = await api.a<{ id: string; status?: string }>(`/a/v1/decisions/${encodeURIComponent(dec.id)}/commit`, { body: {} });
      setCommittedId(done.id ?? dec.id);
      toast("已提交决策 → 派发 ActionDraft，进入 S2 审批链", "success");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        className="btn primary"
        data-testid="dp-commit"
        disabled={busy || committedId != null || optionIds.length === 0}
        onClick={commit}
      >
        {committedId ? "已提交决策" : busy ? "提交中…" : "提交决策 → 审批链"}
      </button>
      {committedId && (
        <span data-testid="dp-commit-result" style={{ fontSize: 12, color: "var(--ok-txt)" }}>
          已提交 <span className="mono">{committedId}</span> → 派 ActionDraft，走 S2 审批链（门不绕·前端不直改计划）。
        </span>
      )}
    </div>
  );
}
