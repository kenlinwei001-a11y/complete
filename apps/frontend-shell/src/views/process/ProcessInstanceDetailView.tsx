import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PROCESS_TASK_WAIT_STATE_META,
  type AdvanceProcessInstanceRequest,
  type ProcessInstance,
  type ProcessInstanceDetail,
  type ProcessTask,
  type ProcessTaskGate,
} from "@platform/contracts";
import { advanceProcessInstance, fetchProcessInstance } from "@/api/endpoints";
import { ConfirmModal } from "@/components/ui/Modal";
import { formatWaited } from "@/views/ProcessStuckView";
import styles from "./ProcessInstanceDetailView.module.css";

/**
 * WO-PROCESS-INSTANCE-UI · 流程实例详情页 —— 「建出来的实例去哪了」的答案。
 *
 * 工单病灶原话：「流程实例能建出来，但建完就消失」——
 * `GET /a/v1/process-instances/{id}` 与 `POST …/advance` 两条端点前端消费方各 0 处
 * （本单复核实测，金丝雀与逐层追调用记录见交单报告）。本页是这两条端点的**唯一生产消费方**。
 *
 * ══ 这页答什么 ═══════════════════════════════════════════════════════════════
 *  ① 这条实例此刻**在哪一站**（当前步 / 整体状态 / 入出站时刻）；
 *  ② 各步**状态时间线**（`ProcessTask` 八字段：seq/name/owner/status/start/end/duration/input/output/decision）；
 *  ③ 卡住了的话**为什么、等谁、等多久**（复用 `PROCESS_TASK_WAIT_STATE_META` 单一来源，前端不重写）；
 *  ④ 运行时实例（origin=MANAGED）可以**推进** —— 必须过确认弹窗，不许一点就推（工单原文）。
 *
 * ══ 深链纪律（本单核心交付）══════════════════════════════════════════════════
 * 本页地址 **URL 带实例 id**（`/process-instances/:instanceId`），刷新、收藏、转发后仍能打开
 * 同一条实例 —— 「建完就找不回」的反面。入口有两处（都不在本文件）：
 *  · `ProcessStuckView` 卡点卡片 → 看这条实例（覆盖「正卡着的」）；
 *  · `ProcessWaitView` 实例下钻面板每行 → 详情（覆盖「反推出来的」）。
 *
 * ══ 🔴 诚实纪律（每条都对着本仓一次真事故）════════════════════════════════════
 *  ① **契约类型只从 `@platform/contracts` 来**。五等待态人话一律走
 *    `PROCESS_TASK_WAIT_STATE_META`；在这里手抄一份就是第二真相源。
 *    ⚠ 四个**推进态**（PENDING/RUNNING/DONE/CANCELLED）与实例四态契约**没有**人话表 ——
 *    下方 `LIVE_STATE_LABEL` / `INSTANCE_STATUS_LABEL` 是本视图层文案，契约哪天立了词表就换 import。
 *  ② **缺就不渲染那一块**，绝不填「未知 / - / N/A」（`waitRef`/`waitingSince`/`output`/`decision`/溯源同此）。
 *  ③ **「等了多久」只用服务端算好的 `stuck.waitedMs`**，不拿前端时钟减 `waitingSince` ——
 *    前后端时钟不同步时会算出负数（契约 §5 注释原话）。时间线里 `waitingSince` 只作时刻展示。
 *  ④ **反推实例（DERIVED_FROM_DOCUMENT）不出推进按钮**：它没有步骤状态机（`tasks` 为空，
 *    后端 advance 会 400「没有任何步骤」）。给它一个必失败的按钮 = 骗用户点。
 *    原地明说它为什么没有按钮、要改状态该去哪改。
 *  ⑤ **「功能没开」与「请求失败」分两态**：`process.runtime` 暗发（defaultOn:false）关闭时
 *    后端 404 `FEATURE_NOT_FOUND` —— 那是预期态不是故障，与真正的加载失败不共用一块 UI。
 */

// 视图层文案（契约未给这四态人话表；五等待态人话在契约 PROCESS_TASK_WAIT_STATE_META，本文件不重写）。
const LIVE_STATE_LABEL: Record<string, string> = {
  PENDING: "待开工",
  RUNNING: "进行中",
  DONE: "已完成",
  CANCELLED: "已取消",
};

// 实例整体四态（同上：契约只有词表 PROCESS_INSTANCE_STATUSES，没有人话表）。
const INSTANCE_STATUS_LABEL: Record<ProcessInstance["status"], string> = {
  RUNNING: "进行中",
  WAITING: "等待中",
  DONE: "已完成",
  CANCELLED: "已取消",
};

// 产地三档的人话（契约 PROCESS_INSTANCE_ORIGINS 只有词表）。这一格是诚实位，不是装饰：
// 「这条实例的时刻是怎么来的」决定读者该给它多少信任。
const ORIGIN_LABEL: Record<ProcessInstance["origin"], string> = {
  MANAGED: "平台运行时实例（由人逐步推进）",
  DERIVED_FROM_DOCUMENT: "从既有单据反推（溯源见下方）",
  MEASURED: "外部系统直采",
};

type ReadErr = { code: string; message: string; status?: number };

/** 只陈述能从响应直接读出的事实；不内联因果猜测（前端看不见病因，只看得见响应）。 */
function readError(e: unknown): ReadErr {
  const err = e as { code?: unknown; status?: unknown; message?: unknown };
  return {
    code: typeof err?.code === "string" ? err.code : "UNKNOWN",
    message: typeof err?.message === "string" ? err.message : String(e),
    ...(typeof err?.status === "number" ? { status: err.status } : {}),
  };
}

/** 一步的状态展示：等待态走契约人话表，推进态走本视图层文案（见文件头纪律①）。 */
function taskStatusLabel(t: ProcessTask): string {
  const meta = (PROCESS_TASK_WAIT_STATE_META as Record<string, { displayName: string } | undefined>)[t.status];
  return meta?.displayName ?? LIVE_STATE_LABEL[t.status] ?? t.status;
}

/** gate 声明的人话列表（只读展示：这一步开工前要等什么）。缺哪项就不列哪项。 */
function gateFacts(gate: ProcessTaskGate): string[] {
  const out: string[] = [];
  if (gate.notBeforeAt) out.push(`窗口 ${gate.notBeforeAt} 开闸`);
  if (gate.requiresDataKeys?.length) out.push(`数据到齐：${gate.requiresDataKeys.join("、")}`);
  if (gate.requiresExternalAck) out.push(`外部回执：${gate.requiresExternalAck.system}:${gate.requiresExternalAck.ref}`);
  if (gate.requiresApprovalOf) out.push(`审批单批复：${gate.requiresApprovalOf}`);
  if (gate.requiresUserAction) out.push(`人工完成：${gate.requiresUserAction}`);
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// 推进区（仅 origin=MANAGED 且未完结时出现）
// ══════════════════════════════════════════════════════════════════════════════

/** 用户填报的外部事实（对照契约 AdvanceProcessInstanceRequest：body 只带事实，不带状态）。 */
interface Facts {
  dataKeys: string[];
  extAck: boolean;
  approval: "APPROVED" | "REJECTED" | "PENDING" | null;
  userAction: boolean;
}

const EMPTY_FACTS: Facts = { dataKeys: [], extAck: false, approval: null, userAction: false };

/** 把填报的事实折成请求体（只放非空字段 —— 空数组会把「没报」变成「报了空的」）。 */
function buildAdvanceBody(gate: ProcessTaskGate | undefined, facts: Facts): AdvanceProcessInstanceRequest {
  const body: AdvanceProcessInstanceRequest = {};
  if (!gate) return body;
  if (gate.requiresDataKeys?.length && facts.dataKeys.length > 0) body.availableDataKeys = facts.dataKeys;
  if (gate.requiresExternalAck && facts.extAck) {
    body.externalAcks = [`${gate.requiresExternalAck.system}:${gate.requiresExternalAck.ref}`];
  }
  if (gate.requiresApprovalOf && facts.approval !== null) body.approvals = { [gate.requiresApprovalOf]: facts.approval };
  if (gate.requiresUserAction && facts.userAction) body.userActionsDone = [gate.requiresUserAction];
  return body;
}

function AdvancePanel({ instance, tasks, onAdvanced }: { instance: ProcessInstance; tasks: ProcessTask[]; onAdvanced: () => void }) {
  const [facts, setFacts] = useState<Facts>(EMPTY_FACTS);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ReadErr | null>(null);

  // 与引擎同一套光标回退（runtime.ts advance：先 currentTaskId，再第一个未完结步）。
  const current =
    tasks.find((t) => t.id === instance.currentTaskId) ??
    tasks.find((t) => t.status !== "DONE" && t.status !== "CANCELLED");
  if (!current) return null;

  // 当前步在 RUNNING ⇒ 这次推进 = 办结它；此时填报的事实是给**下一步**的 gate 用的（收工后下一步随即入场判定）。
  const finishing = current.status === "RUNNING";
  const currentIdx = tasks.findIndex((t) => t.id === current.id);
  const factTask = finishing ? tasks[currentIdx + 1] : current;
  const gate = factTask?.gate;
  const items = gate ? gateFacts(gate) : [];

  const body = buildAdvanceBody(gate, facts);
  const factSummary: string[] = [];
  if (body.availableDataKeys) factSummary.push(`数据已到齐：${body.availableDataKeys.join("、")}`);
  if (body.externalAcks) factSummary.push(`已收到外部回执：${body.externalAcks.join("、")}`);
  if (body.approvals && gate?.requiresApprovalOf) {
    const v = body.approvals[gate.requiresApprovalOf];
    factSummary.push(`审批单 ${gate.requiresApprovalOf}：${v === "APPROVED" ? "已批准" : v === "REJECTED" ? "已驳回" : "仍在审批"}`);
  }
  if (body.userActionsDone) factSummary.push(`人工已完成：${body.userActionsDone.join("、")}`);

  const doAdvance = async () => {
    setBusy(true);
    try {
      await advanceProcessInstance(instance.id, body);
      setConfirmOpen(false);
      setFacts(EMPTY_FACTS);
      setErr(null);
      onAdvanced();
    } catch (e) {
      // 推进被引擎拒绝（如 400 VALIDATION_ERROR）：如实摆出来，不假装成功。
      setErr(readError(e));
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.advance} data-testid="pi-advance">
      <h4 className={styles.advanceTitle}>{finishing ? `办结当前步「${current.name}」并推进` : "推进这条实例"}</h4>
      <p className={styles.sub}>
        {finishing
          ? factTask
            ? `确认后当前步记为完成，下一步「${factTask.name}」随即按下面填报的事实判定能否开工。`
            : "确认后当前步记为完成 —— 这是最后一步，整条实例随即完结。"
          : "确认后引擎按你填报的外部事实重判当前步的前置条件；事实不够它就继续等，不会被硬推过去。"}
      </p>

      {/* 事实填报表：只列当前判定真正用得到的项（gate 声明了什么才问什么） */}
      {gate?.requiresDataKeys?.length ? (
        <fieldset className={styles.factGroup} data-testid="pi-fact-data">
          <legend>哪些数据已经到齐</legend>
          {gate.requiresDataKeys.map((k) => (
            <label key={k} className={styles.factLine}>
              <input
                type="checkbox"
                data-testid={`pi-fact-data-${k}`}
                checked={facts.dataKeys.includes(k)}
                onChange={(e) =>
                  setFacts((f) => ({
                    ...f,
                    dataKeys: e.target.checked ? [...f.dataKeys, k] : f.dataKeys.filter((x) => x !== k),
                  }))
                }
              />
              <code>{k}</code>
            </label>
          ))}
        </fieldset>
      ) : null}
      {gate?.requiresExternalAck ? (
        <fieldset className={styles.factGroup} data-testid="pi-fact-ext">
          <legend>外部回执</legend>
          <label className={styles.factLine}>
            <input
              type="checkbox"
              data-testid="pi-fact-ext-check"
              checked={facts.extAck}
              onChange={(e) => setFacts((f) => ({ ...f, extAck: e.target.checked }))}
            />
            已收到 <code>{gate.requiresExternalAck.system}:{gate.requiresExternalAck.ref}</code>
          </label>
        </fieldset>
      ) : null}
      {gate?.requiresApprovalOf ? (
        <fieldset className={styles.factGroup} data-testid="pi-fact-approval">
          <legend>
            审批单 <code>{gate.requiresApprovalOf}</code> 的结论
          </legend>
          {(
            [
              ["APPROVED", "已批准"],
              ["REJECTED", "已驳回"],
              ["PENDING", "仍在审批"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className={styles.factLine}>
              <input
                type="radio"
                name="pi-approval"
                data-testid={`pi-fact-approval-${v}`}
                checked={facts.approval === v}
                onChange={() => setFacts((f) => ({ ...f, approval: v }))}
              />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {gate?.requiresUserAction ? (
        <fieldset className={styles.factGroup} data-testid="pi-fact-user">
          <legend>人工动作</legend>
          <label className={styles.factLine}>
            <input
              type="checkbox"
              data-testid="pi-fact-user-check"
              checked={facts.userAction}
              onChange={(e) => setFacts((f) => ({ ...f, userAction: e.target.checked }))}
            />
            责任岗位已完成：<code>{gate.requiresUserAction}</code>
          </label>
        </fieldset>
      ) : null}
      {items.length === 0 ? <p className={styles.sub}>当前步没有声明前置条件，确认即可推进。</p> : null}

      {err ? (
        <div className={styles.error} data-testid="pi-advance-error">
          推进被引擎拒绝：<code>{err.code}</code> {err.message}
        </div>
      ) : null}

      <button
        type="button"
        className="btn primary"
        data-testid="pi-advance-open"
        disabled={busy}
        onClick={() => setConfirmOpen(true)}
      >
        {finishing ? "办结并推进…" : "推进…"}
      </button>

      {/* 工单红线：推进必须走确认，不许一点就推。弹窗里把即将上报的事实逐条列清。 */}
      {confirmOpen ? (
        <ConfirmModal
          title="确认推进这条流程实例"
          message="引擎将按下列外部事实重判前置条件并改写步骤状态。填报与事实不符会让「为什么卡住」从此说谎。"
          confirmLabel="确认推进"
          onConfirm={() => void doAdvance()}
          onCancel={() => setConfirmOpen(false)}
        >
          <ul className={styles.confirmFacts} data-testid="pi-advance-confirm-facts">
            {factSummary.length > 0 ? (
              factSummary.map((s) => <li key={s}>{s}</li>)
            ) : (
              <li>（未填报新事实 —— 按现状重判一次）</li>
            )}
          </ul>
        </ConfirmModal>
      ) : null}
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 页面
// ══════════════════════════════════════════════════════════════════════════════

export default function ProcessInstanceDetailView() {
  const { instanceId = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["a", "process-instance", instanceId],
    queryFn: () => fetchProcessInstance(instanceId),
    // 404（实例不存在 / 功能没开）是确定答案，重试不会改变它；重试只会把错误态拖慢。
    retry: (_count, e) => {
      const { code } = readError(e);
      return code !== "NOT_FOUND" && code !== "FEATURE_NOT_FOUND";
    },
    enabled: instanceId.length > 0,
  });

  if (q.isPending) {
    return (
      <div className={styles.root}>
        <p className={styles.stateLine} data-testid="pi-loading">
          正在读取流程实例…
        </p>
      </div>
    );
  }

  if (q.isError) {
    const e = readError(q.error);
    // 「功能没开」是预期的暗发态（defaultOn:false），不是故障 —— 与「请求失败」分块说。
    if (e.code === "FEATURE_NOT_FOUND") {
      return (
        <div className={styles.root}>
          <div className={styles.empty} data-testid="pi-disabled">
            流程运行时（<code>process.runtime</code>）未开通。这不是故障：该功能默认关闭，
            需由租户显式开通后才有数据面。
          </div>
        </div>
      );
    }
    // 「实例不存在」与「请求失败」也是两件事：前者多半是链接抄错或实例已清，后者才是故障。
    if (e.code === "NOT_FOUND") {
      return (
        <div className={styles.root}>
          <div className={styles.empty} data-testid="pi-notfound">
            找不到流程实例 <code>{instanceId}</code>。请核对链接里的实例 id 是否抄全
            （它也可能属于另一个租户 —— 跨租户一律按不存在回答，不泄露存在性）。
          </div>
        </div>
      );
    }
    return (
      <div className={styles.root}>
        <div className={styles.error} data-testid="pi-error">
          读取流程实例失败：<code>{e.code}</code> {e.message}
        </div>
      </div>
    );
  }

  const detail: ProcessInstanceDetail = q.data;
  const { instance, tasks, stuck } = detail;
  const waitMeta = instance.waitState ? PROCESS_TASK_WAIT_STATE_META[instance.waitState] : null;
  const canAdvance = instance.origin === "MANAGED" && (instance.status === "RUNNING" || instance.status === "WAITING");

  return (
    <div className={styles.root} data-testid="pi-root">
      <div className={styles.head}>
        <h3>
          流程实例 · <code data-testid="pi-process-key">{instance.processKey}</code> 作用于{" "}
          <Link
            to={`/o/${encodeURIComponent(instance.carrierTypeKey)}/${encodeURIComponent(instance.carrierObjectId)}`}
            data-testid="pi-carrier-link"
          >
            <code>{instance.carrierObjectId}</code>
          </Link>
        </h3>
        <p className={styles.sub} data-testid="pi-deeplink-note">
          本页地址带实例 id，可收藏或转发 —— 刷新后打开的仍是这条实例。
        </p>
      </div>

      {/* 头部事实栅格：状态 / 产地 / 入出站 / 在等什么 / 等谁。缺哪格就不渲染哪格。 */}
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>整体状态</dt>
          <dd className={styles.factValue} data-testid="pi-status">
            {INSTANCE_STATUS_LABEL[instance.status]}
            {waitMeta ? <span className={styles.badge}>{waitMeta.displayName}</span> : null}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>这条实例怎么来的</dt>
          <dd className={styles.factValue} data-testid="pi-origin">
            {ORIGIN_LABEL[instance.origin]}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>入站时刻</dt>
          <dd className={styles.factValue} data-testid="pi-entered">
            {instance.enteredAt}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>出站时刻</dt>
          <dd className={styles.factValue} data-testid="pi-exited">
            {/* null 是「仍未出站」这个业务事实，不是缺数据 —— 照实说，不填占位符 */}
            {instance.exitedAt ?? "未出站（仍在这一站）"}
          </dd>
        </div>
        {waitMeta ? (
          <div className={styles.fact}>
            <dt className={styles.factLabel}>在等什么</dt>
            <dd className={styles.factValue} data-testid="pi-wait">
              {waitMeta.blocker}
              {/* 这一格怎么来的（模板抄的平均值 vs 这一单现场判的）必须跟在数值旁边，
                  拆开两处显示就等于把诚实位藏起来 */}
              {instance.waitStateOrigin ? (
                <small className={styles.originTag} data-testid="pi-wait-origin">
                  {instance.waitStateOrigin === "TASK_GATE"
                    ? "现场判定（这条单自己的前置条件）"
                    : "抄自流程模板（这类流程的平均值，不是这一单的现场）"}
                </small>
              ) : null}
              {instance.waitRef ? (
                <>
                  {" · "}
                  <code data-testid="pi-waitref">{instance.waitRef}</code>
                </>
              ) : null}
            </dd>
          </div>
        ) : null}
        <div className={styles.fact}>
          <dt className={styles.factLabel}>责任方</dt>
          <dd className={styles.factValue} data-testid="pi-owner">
            {instance.ownerRef.functionKey}
            {instance.ownerRef.partyField ? (
              <small>
                {" "}
                · {instance.ownerRef.partyField}={instance.ownerRef.partyValue}
              </small>
            ) : null}
          </dd>
        </div>
      </dl>

      {/* 当前卡点（服务端已按注入时钟算好「等了多久」—— 前端只转述，不自己减时钟） */}
      {stuck ? (
        <div className={styles.stuck} data-testid="pi-stuck">
          <b>
            当前卡点：第 {stuck.taskSeq} 步「{stuck.taskName}」 ·{" "}
            {PROCESS_TASK_WAIT_STATE_META[stuck.waitState].displayName}
          </b>
          <p className={styles.sub}>
            {PROCESS_TASK_WAIT_STATE_META[stuck.waitState].blocker}
            {stuck.waitRef ? (
              <>
                {" · "}
                <code>{stuck.waitRef}</code>
              </>
            ) : null}
            {" · 在等 "}
            {stuck.ownerDisplayName ?? stuck.ownerFunctionKey}
            {stuck.waitedMs !== undefined ? <> · 已等 {formatWaited(stuck.waitedMs)}</> : null}
          </p>
        </div>
      ) : null}

      {/* 步骤时间线。反推实例没有步骤（单据上没有「第几步」这个事实）—— 明说，不画空表。 */}
      {tasks.length > 0 ? (
        <ol className={styles.timeline} data-testid="pi-timeline">
          {tasks.map((t) => (
            <li key={t.id} className={styles.step} data-testid={`pi-task-${t.seq}`} data-status={t.status}>
              <div className={styles.stepHead}>
                <span className={styles.stepName} data-testid={`pi-task-name-${t.seq}`}>
                  第 {t.seq} 步 · {t.name}
                </span>
                <span className={styles.badge} data-testid={`pi-task-status-${t.seq}`}>
                  {taskStatusLabel(t)}
                </span>
                <span className={styles.defName}>{t.ownerFunctionKey}</span>
              </div>
              <div className={styles.stepFacts}>
                {t.startedAt ? <span data-testid={`pi-task-started-${t.seq}`}>进场 {t.startedAt}</span> : null}
                {t.endedAt ? <span>出场 {t.endedAt}</span> : null}
                {/* 等待起点只作时刻展示；「等了多久」由服务端算（见文件头纪律③） */}
                {t.waitingSince ? <span data-testid={`pi-task-waiting-${t.seq}`}>从 {t.waitingSince} 起等待</span> : null}
                {t.waitRef ? (
                  <span>
                    卡在 <code>{t.waitRef}</code>
                  </span>
                ) : null}
              </div>
              {t.gate ? (
                <ul className={styles.gateList} data-testid={`pi-task-gate-${t.seq}`}>
                  {gateFacts(t.gate).map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              ) : null}
              {t.decision ? (
                <p className={styles.sub} data-testid={`pi-task-decision-${t.seq}`}>
                  决策：{t.decision.choice}（{t.decision.decidedBy} · {t.decision.decidedAt}）
                </p>
              ) : null}
              {t.output ? (
                <p className={styles.sub} data-testid={`pi-task-output-${t.seq}`}>
                  产出：<code>{JSON.stringify(t.output)}</code>
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className={styles.empty} data-testid="pi-no-tasks">
          这条实例没有步骤时间线：它是从既有单据<strong>反推</strong>出来的
          （<code>origin=DERIVED_FROM_DOCUMENT</code>），单据上没有「第几步」这个事实，编一个就是造假。
          它的状态由来源单据的时间戳决定 —— 要改它的状态，去改下方溯源里点名的单据。
        </div>
      )}

      {/* 溯源（R13：每个时刻来自哪张单据的哪个字段、原值多少）。反推实例必有；运行时实例没有这一块。 */}
      {instance.sourceDocuments.length > 0 ? (
        <div className={styles.sources} data-testid="pi-sources">
          <b>时刻溯源</b>
          <ul>
            {instance.sourceDocuments.map((s, i) => (
              <li key={`${s.field}-${i}`}>
                {s.role === "ENTERED" ? "入站" : "出站"}来自{" "}
                <Link to={`/o/${encodeURIComponent(s.typeKey)}/${encodeURIComponent(s.objectId)}`}>
                  <code>{s.objectId}</code>
                </Link>{" "}
                的 <code>{s.field}</code>（原值 <code>{String(s.rawValue)}</code> → {s.resolvedAt}）
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canAdvance ? (
        <AdvancePanel
          instance={instance}
          tasks={tasks}
          onAdvanced={() => {
            // 前缀失效同时覆盖详情键与本流程的实例列表面板键（["a","process-instance*"]）。
            void qc.invalidateQueries({ queryKey: ["a", "process-instance"] });
          }}
        />
      ) : null}
    </div>
  );
}
