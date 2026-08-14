import { useEffect, useState } from "react";
import {
  PROCESS_TASK_WAIT_STATES,
  PROCESS_TASK_WAIT_STATE_META,
  type ProcessStuckReason,
  type ProcessStuckResponse,
} from "@platform/contracts";
import { fetchStuckProcesses } from "@/api/endpoints";
import styles from "./ProcessStuckView.module.css";

/**
 * WO-PROCESS-INSTANCE · 流程卡点面板 —— 需求 §4.5 那句问话的**界面半边**。
 *
 * > 「为什么这个流程现在卡住了」——**这恰恰是 COO 最想问的问题**。
 *
 * 审计 `docs/AUDIT-decision-twin-gap-2026-08-09.md` §3 的原话是
 * 「**后端已经知道答案，界面上一个字都没有**」（五个等待态前端命中全 0）。本页是那零的对面。
 *
 * ══ 四问，逐个有落点 ══════════════════════════════════════════════════════
 *  ① 卡在哪一步 → `taskName`（+ 第几步 `taskSeq`）
 *  ② 为什么     → `waitState` 的人话 + `waitRef`（卡在**哪一个**具体对象上）
 *  ③ 等谁       → `ownerDisplayName ?? ownerFunctionKey`
 *  ④ 等多久了   → `waitedMs`（**服务端**用注入时钟算好的）
 *
 * ══ 🔴 两条纪律 ═══════════════════════════════════════════════════════════
 *
 * **① 契约类型只从 `@platform/contracts` 来，前端一个字段都不重定义。**
 * 等待态词表 `PROCESS_TASK_WAIT_STATES` 与人话 `PROCESS_TASK_WAIT_STATE_META` 都是 import 的 ——
 * 在这里手写一份 `{ WAITING_USER: "等人处理", ... }` 就是第二真相源：
 * 后端加一个等待态，这张页面会**静默地少显示一类卡点**，且没有任何测试会红。
 *
 * **② 数据缺失就不显示那一块，绝不填「未知 / - / N/A」。**
 * 本仓有多起「诚实位在说谎」事故。缺席只是**没说**，占位符是**说了一句假的**，
 * 而且看不出来是假的 —— 后者严重得多。故：
 *  · `waitedMs` 缺 ⇒ 整个「已等」块不渲染（不是显示 0，那会读成「刚刚才卡住」）；
 *  · `ownerDisplayName` 缺 ⇒ 退回显示 `ownerFunctionKey` 原值（那是**真的**，只是不好看）；
 *  · `definitionName` 缺 ⇒ 不渲染流程名（不拿 `definitionKey` 冒充名字）。
 *
 * ══ 零结果不等于一切正常 ══════════════════════════════════════════════════
 * `stuck: []` 时**明说**「本次查询没有正在等待的流程实例」，并点明它可能只是
 * **还没有实例数据**（平台自带的 65 条是模板，不是在跑的单子）——
 * 一个笑脸「一切顺利」会把「没数据」冒充成「没问题」，那正是本功能暗发的理由。
 *
 * ══ 🔴 收编增补（WO-R9-STUCKVIEW·2026-08-14）：`derivedStuckCount` 必须上屏 ══
 *
 * 本页写成时契约还没有这一格。`WO-R9-PROCESS-MERGE` 把两条流程实例线合并后，
 * `ProcessStuckResponse` 多了一个**必填**字段 `derivedStuckCount` ——
 * 「到此刻同样卡着、但产地是 `DERIVED_FROM_DOCUMENT`（从单据反推）的实例数」。
 * 契约原文（`process-runtime.ts` §5）逐字写着：
 *
 *   > 「但**不许因此静默消失**：不报这个数，调用方会把『本投影没算它们』读成『它们不存在』。」
 *
 * **前端是最后一公里**：后端如实报了、界面把它吞掉，这条诚实位等于没有 ——
 * 而且比没有更糟，因为它在契约里白纸黑字写着「已经报了」。故本页两处兑现它：
 *  ① 只要 `derivedStuckCount > 0` 就渲染一条**口径声明**（本投影答不出这一批 + 去哪看）；
 *  ② `stuck: []` 且 `derivedStuckCount > 0` 时，空态**不得**说「没有正在等待的流程实例」——
 *    那句话此刻是**假的**（真有，只是产地不同）。零结果的两种成因必须分开说。
 */

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: ProcessStuckResponse }
  | { status: "disabled" }
  | { status: "error"; code: string; message: string };

interface EnvelopeLike {
  code?: string;
  status?: number;
  message?: string;
}

/** 只陈述能从响应直接读出的事实；不内联因果猜测（前端看不见病因，只看得见响应）。 */
function readError(e: unknown): { code: string; message: string; status?: number } {
  const err = e as EnvelopeLike;
  return {
    code: typeof err?.code === "string" ? err.code : "UNKNOWN",
    message: typeof err?.message === "string" ? err.message : String(e),
    ...(typeof err?.status === "number" ? { status: err.status } : {}),
  };
}

/**
 * 毫秒 → 人话时长。**只在有值时调用**（无值的分支根本不渲染，不会走到这里）。
 * 取最大的两级单位，够回答「等很久了吗」，不假装精确到秒。
 */
export function formatWaited(ms: number): string {
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return h > 0 ? `${d} 天 ${h} 小时` : `${d} 天`;
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
  if (m > 0) return `${m} 分钟`;
  return "不到 1 分钟";
}

function StuckCard({ r }: { r: ProcessStuckReason }) {
  const meta = PROCESS_TASK_WAIT_STATE_META[r.waitState];
  return (
    <li className={styles.card} data-testid="stuck-card" data-wait-state={r.waitState}>
      <div className={styles.cardHead}>
        {/* ① 卡在哪一步 */}
        <span className={styles.stepName} data-testid="stuck-step">
          第 {r.taskSeq} 步 · {r.taskName}
        </span>
        {/* 流程名：查不到定义就**不渲染**，不拿 definitionKey 冒充名字 */}
        {r.definitionName ? (
          <span className={styles.defName} data-testid="stuck-defname">
            {r.definitionName}
          </span>
        ) : null}
        <span className={styles.badge} data-testid="stuck-badge">
          {meta.displayName}
        </span>
      </div>

      <dl className={styles.facts}>
        {/* ② 为什么 */}
        <div className={styles.fact}>
          <dt className={styles.factLabel}>为什么卡住</dt>
          <dd className={styles.factValue} data-testid="stuck-why">
            {meta.blocker}
            {/* 卡在哪一个具体对象上；没有就不显示这半句 */}
            {r.waitRef ? (
              <>
                {" · "}
                <code data-testid="stuck-waitref">{r.waitRef}</code>
              </>
            ) : null}
          </dd>
        </div>

        {/* ③ 等谁 —— 中文名查不到就退回 key 原值（那是真的，不是占位符） */}
        <div className={styles.fact}>
          <dt className={styles.factLabel}>在等谁</dt>
          <dd className={styles.factValue} data-testid="stuck-owner">
            {r.ownerDisplayName ?? r.ownerFunctionKey}
          </dd>
        </div>

        {/* ④ 等多久了 —— 服务端算好的。**缺就整块不渲染**，不显示 0（0 会读成「刚卡住」） */}
        {r.waitedMs !== undefined ? (
          <div className={styles.fact}>
            <dt className={styles.factLabel}>已等</dt>
            <dd className={`${styles.factValue} ${styles.waited}`} data-testid="stuck-waited">
              {formatWaited(r.waitedMs)}
            </dd>
          </div>
        ) : null}

        {/* 作用在哪个对象上（承载物实例）——「这条流程在处理什么」 */}
        <div className={styles.fact}>
          <dt className={styles.factLabel}>处理对象</dt>
          <dd className={styles.factValue} data-testid="stuck-subject">
            <code>
              {r.subjectRef.typeKey}/{r.subjectRef.objectId}
            </code>
          </dd>
        </div>
      </dl>
    </li>
  );
}

export default function ProcessStuckView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await fetchStuckProcesses();
        if (alive) setState({ status: "ready", data });
      } catch (e) {
        const { code, message, status } = readError(e);
        // 「功能没开」与「请求失败」是两件事，不许合并成一句「加载失败」：
        // 前者是**预期**的暗发态（defaultOn:false），后者才是故障。
        if (code === "FEATURE_NOT_FOUND" || status === 404) {
          if (alive) setState({ status: "disabled" });
          return;
        }
        if (alive) setState({ status: "error", code, message });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className={styles.root}>
        <p className={styles.stateLine}>正在读取流程卡点…</p>
      </div>
    );
  }

  if (state.status === "disabled") {
    return (
      <div className={styles.root}>
        <div className={styles.empty} data-testid="stuck-disabled">
          流程运行时（<code>process.runtime</code>）未开通。这不是故障：该功能默认关闭，
          需由租户显式开通后才有数据面。
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={styles.root}>
        <div className={styles.error} data-testid="stuck-error">
          读取流程卡点失败：<code>{state.code}</code> {state.message}
        </div>
      </div>
    );
  }

  const { stuck, byWaitState, evaluatedAt, derivedStuckCount } = state.data;

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <h3>流程卡点 · 为什么现在卡住了</h3>
        <p className={styles.sub}>
          每条 = 一个**正在跑**的流程实例此刻停在哪一步、为什么停、在等谁、等了多久。
          等待是流程的常态，不是故障；这里回答的是「卡在哪、找谁」。
        </p>
      </div>

      {/* 各等待态计数。五个 key 恒在、值可为 0 —— 这里的 0 是**统计事实**（真的没有），
          与「数据缺失不显示」不冲突：那条针对的是「不知道」。 */}
      <div className={styles.tally}>
        {PROCESS_TASK_WAIT_STATES.map((s) => {
          const n = byWaitState[s] ?? 0;
          return (
            <span
              key={s}
              className={`${styles.tallyItem} ${n === 0 ? styles.tallyZero : ""}`}
              data-testid={`tally-${s}`}
            >
              {PROCESS_TASK_WAIT_STATE_META[s].displayName}
              <span className={styles.tallyCount}>{n}</span>
            </span>
          );
        })}
      </div>

      {/* 🔴 本投影**答不出**的那一批（契约 §5 的诚实位）。> 0 才渲染 ——
          等于 0 时这一句没有信息量，挂着反而像在暗示"另有一批"。
          注意它与上面计数条的分工：计数条数的是**本投影算出来的**（产地 MANAGED），
          这一条数的是**本投影没算的**（产地 DERIVED_FROM_DOCUMENT）。两者不许相加。 */}
      {derivedStuckCount > 0 ? (
        <div className={styles.empty} data-testid="stuck-derived-note">
          另有 <strong data-testid="stuck-derived-count">{derivedStuckCount}</strong> 条实例此刻同样卡着，
          但**本页答不出它们卡在第几步** —— 它们是从既有单据<strong>反推</strong>出来的
          （<code>origin=DERIVED_FROM_DOCUMENT</code>），单据上没有「第几步」这个事实，编一个步名就是造假。
          <br />
          要看这一批，走 <code>process_flow_time</code> 求解器或
          <code>GET /a/v1/process-definitions/:key/instances</code>。
        </div>
      ) : null}

      {stuck.length === 0 ? (
        <div className={styles.empty} data-testid="stuck-empty">
          {derivedStuckCount > 0 ? (
            /* ⚠ 这一支的文案**刻意不出现**「没有正在等待的流程实例」这半句。
               此刻它是假的：真有 derivedStuckCount 条卡着，只是产地不同、本投影算不了。
               先说真相（确有 N 条卡着）、再说本页的口径（这一类为 0），顺序反过来就会被读反。 */
            <>
              ⚠ 此刻**确有 {derivedStuckCount} 条流程卡着**（见上方那条口径声明）。
              <br />
              本页只统计运行时实例（<code>origin=MANAGED</code>），而这一类此刻为 0 条 ——
              把本页的 0 读成「流程都没卡」会直接读反。
            </>
          ) : (
            <>
              本次查询没有正在等待的流程实例。
              <br />
              ⚠ 这**不等于**一切顺利：也可能是还没有流程实例数据 —— 平台自带的 65 条业务流程是
              <strong>模板</strong>（<code>ProcessDefinition</code>），不是正在跑的单子。
            </>
          )}
        </div>
      ) : (
        <ul className={styles.list}>
          {stuck.map((r) => (
            <StuckCard key={r.instanceId} r={r} />
          ))}
        </ul>
      )}

      <p className={styles.stateLine}>
        判定时刻 <code data-testid="stuck-evaluated-at">{evaluatedAt}</code>（服务端时钟）
      </p>
    </div>
  );
}
