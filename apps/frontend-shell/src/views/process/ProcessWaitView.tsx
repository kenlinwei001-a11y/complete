import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ProcessStuckResponse } from "@platform/contracts";
import { fetchProcessDefinitions, fetchProcessInstances, fetchStuckProcesses } from "@/api/endpoints";
import { InfoPopover } from "@/components/InfoPopover";
// WO-V4-INSPECT · 节点检视面板（点开一行 → 看这条流程的完整本体关系·PRD-sandbox-v4 §4.2）
import { ProcessInspectPanel } from "./ProcessInspectPanel";
import { zh } from "@/locales/zh";
import {
  buildProcessInstancesModel,
  buildProcessWaitModel,
  WAIT_KIND_COPY,
  WAIT_KIND_STYLE,
  type ProcessInstancesModel,
  type ProcessWaitModel,
  type WaitKindGroupVM,
} from "./processWait";
import styles from "./ProcessWaitView.module.css";

/**
 * WO-WAITING-STATES-FE · 流程等待态（需求 §20「『等待』是一等状态」）。
 *
 * 回答 COO 最想问的那一问：**「为什么这个流程现在卡住了」**。
 * 后端 65 条 `ProcessDefinition` 每条都带 `waitKind`，此前**界面上一个字都没有**。
 *
 * 设计判据（逐条对应需求，不是装饰）：
 *  · **四态四相**：色 / 记号 / 标签 / 「等谁」四句话全部不同。把四态画成同一个
 *    「等待中」= 需求没做（需求原文：「5 个态混成一个字就等于没做」）。
 *  · **恒画四组**：某态 0 条也保留该组并写明「暂无此类等待」——否则「租户没有」
 *    与「前端漏画」在屏幕上长得一样，针对它的断言还会恒真（哑门）。
 *  · **诚实缺席**：只给标准工期，明写「不是已卡 N 天」。运行态 `ProcessTask` 尚未实现
 *    （2026-08-10 实测：`grep -rn 'ProcessTask\|ProcessInstance' apps packages --include=*.ts`
 *     零命中；PRD-enterprise-decision-twin.md §5 的 E2 一行从未落地）。复验照此命令重跑即可。
 *  · **零硬编码颜色**：全部走 `styles/tokens.css` 的 `--c-*` 语义域色（三套皮自动跟随）。
 *  · **零硬编码文案**：全部走 `locales/zh.ts`。
 *
 * 本组件的生产调用方是 `views/registry.ts` 的 `registerRenderer("process-wait", …)`
 * ＋ 后端 `BUILTIN_VIEWS` 派单 ＋ `ShellLayout.NAV_GROUPS` 归组 —— 三者缺一，
 * 这一页就是 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`（实现有、测试绿、零路径渲染得到）。
 */

type LoadState =
  | { status: "loading" }
  | { status: "ready"; model: ProcessWaitModel }
  | { status: "error"; code: string; message: string; requestId: string | null };

interface EnvelopeError {
  code?: string;
  message?: string;
  requestId?: string;
}

/** 错误只陈述能从响应直接读出的事实（错误码 / message / requestId），不内联因果猜测。 */
function readError(e: unknown): { code: string; message: string; requestId: string | null } {
  const anyE = e as { code?: string; message?: string; requestId?: string; error?: EnvelopeError; status?: number };
  const code = anyE?.error?.code ?? anyE?.code ?? (anyE?.status ? `HTTP_${anyE.status}` : "UNKNOWN");
  const message = anyE?.error?.message ?? anyE?.message ?? String(e);
  return { code: String(code), message, requestId: anyE?.error?.requestId ?? anyE?.requestId ?? null };
}

// ══════════════════════════════════════════════════════════════════════════════
// WO-IA-E2E5E6 · E5 双向入口（模板层 → 实例层 /v/process-stuck）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 各站卡单计数的**三态**（与页面 LoadState 同源纪律：loading 独立成态，不与不可用混）：
 *  · ready       → 计数来自 `/a/v1/process-instances/stuck` 投影（运行时实例口径），按 processKey 分桶；
 *  · unavailable → **明说「暂不可得」+ 原因，绝不摆 0**（0 会被读成「这站很顺」，而真相是算不出）；
 *  · loading     → 行内什么数都不摆（不是 0，也不是骨架 —— 数还没回来，摆任何东西都是抢先下结论）。
 */
type StuckSummary =
  | { status: "loading" }
  | { status: "ready"; byProcess: ReadonlyMap<string, number>; derivedStuckCount: number }
  | { status: "unavailable"; reason: string };

/** 拉卡点投影并分桶。404/FEATURE_NOT_FOUND 与真失败**分开说**（前者是暗发预期态，后者是故障）。 */
async function loadStuckSummary(t: typeof zh.processWait.crosslink): Promise<StuckSummary> {
  try {
    const res: ProcessStuckResponse = await fetchStuckProcesses();
    const byProcess = new Map<string, number>();
    for (const r of res.stuck) byProcess.set(r.processKey, (byProcess.get(r.processKey) ?? 0) + 1);
    return { status: "ready", byProcess, derivedStuckCount: res.derivedStuckCount };
  } catch (e) {
    const { code, message } = readError(e);
    const anyE = e as { status?: number };
    if (code === "FEATURE_NOT_FOUND" || anyE?.status === 404) {
      return { status: "unavailable", reason: t.stuckUnavailableDark };
    }
    return { status: "unavailable", reason: t.stuckUnavailableError(`${code}: ${message}`) };
  }
}

/** 行内那一格：「现在有 N 张单卡在这里 →」/ 「暂不可得」/ 「没有单卡在这里」/ 什么都没有（loading）。
 *  两种**不可点**态（拿不到 / 真的 0）共用一个 <span> 槽位（文案·testid·样式仍各自分开）——
 *  ui-first-layer 门按静态模板数信息块，三态各起一个元素就是 +3 块纯往第一层堆。 */
function StuckCountCell({ processKey, stuck }: { processKey: string; stuck: StuckSummary }) {
  const t = zh.processWait.crosslink;
  if (stuck.status === "loading") return null;
  const n = stuck.status === "ready" ? (stuck.byProcess.get(processKey) ?? 0) : 0;
  if (stuck.status !== "ready" || n === 0) {
    const na = stuck.status !== "ready";
    return (
      <span
        className={na ? styles.stuckNa : styles.stuckZero}
        data-testid={na ? `pw-stuck-na-${processKey}` : `pw-stuck-zero-${processKey}`}
      >
        {na ? `${t.stuckUnavailable}：${stuck.status === "unavailable" ? stuck.reason : ""}` : t.stuckHereZero}
      </span>
    );
  }
  return (
    <Link
      to={`/v/process-stuck?proc=${encodeURIComponent(processKey)}`}
      className={styles.stuckLink}
      data-testid={`pw-stuck-link-${processKey}`}
      data-count={n}
      onClick={(e) => {
        // 🔴 不 stopPropagation ⇒ 冒泡到 <tr onClick> ⇒ 侧栏检视面板被顺带打开（同下方实例按钮的病）。
        e.stopPropagation();
      }}
    >
      {t.stuckHere(n)}
    </Link>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// WO-FLOWTIME · 实例下钻面板（「哪一条卡着 / 卡在谁那里 / 卡了多久 / 站间多久」）
// ══════════════════════════════════════════════════════════════════════════════

type InstState =
  | { status: "loading" }
  | { status: "ready"; model: ProcessInstancesModel }
  | { status: "error"; code: string; message: string; requestId: string | null };

/**
 * 一条流程的实例明细。
 *
 * 三条渲染纪律（每条都对着本仓一次真事故）：
 *  ① **loading 独立成态**，不与 error/空数据挤在同一个「暂不可用」块里 ——
 *    请求还在飞就宣告失败，是 `RootCausePanel` 犯过的病（R13 收口 ⑦）。
 *  ② **反推不出 ≠ 没有卡顿**：`available:false` 时渲染 `absence.reason` + `probe`，
 *    **不渲染空表**。空表会被读成「这条流程很顺畅」，而真相是「这一维没数据可算」。
 *  ③ **推导值必须被标出来**：面板顶部固定一行 `originNote`，说明这些天数是**反推**来的，
 *    不是流程引擎直采，也不是标准工期；标准工期以 `stdCompare` 单独一行做对照。
 */
function InstancePanel({ processKey }: { processKey: string }) {
  const t = zh.processWait.instances;
  /**
   * ⚠ 这里刻意用 TanStack `useQuery` 而不是 `useEffect + fetch`（页面顶层那个仍是后者）：
   * **本查询是 `process.instance_entered` / `process.instance_stuck` 两个事件的消费方**。
   * 没有 queryKey 就没有可失效的缓存 ⇒ 那两个事件在 `event-subscriptions.ts` 里的登记
   * 就会是**假接线**（有事件没人听）—— `eventInvalidation.ts` 的 `SIM_EVENT_GAPS` 记着
   * 本仓正是因为「读端零调用方」才把几个 sim 事件一直挂着不登记。
   * queryKey 与 `LABEL_TO_KEYS["process-instances"]` 必须对上，改一处要改两处。
   */
  const q = useQuery({
    queryKey: ["a", "process-instances", processKey],
    queryFn: () => fetchProcessInstances(processKey),
  });
  const st: InstState = q.isPending
    ? { status: "loading" }
    : q.isError
      ? { status: "error", ...readError(q.error) }
      : { status: "ready", model: buildProcessInstancesModel(q.data) };

  // 判据①：loading 是独立分支，绝不落进下面任何一个"不可用"块
  if (st.status === "loading") {
    return (
      <p className={styles.stateLine} data-testid={`pw-inst-loading-${processKey}`}>
        {t.loading}
      </p>
    );
  }
  if (st.status === "error") {
    // 只陈述能从响应直接读出的事实（错误码 / message / requestId），不内联因果猜测
    return (
      <div className={styles.error} data-testid={`pw-inst-error-${processKey}`}>
        <b>{st.code}</b>
        <p>{st.message}</p>
        {st.requestId && <small>requestId: {st.requestId}</small>}
      </div>
    );
  }

  const m = st.model;
  return (
    <div className={styles.instPanel} data-testid={`pw-inst-${processKey}`}>
      <header className={styles.instHead}>
        <b>{t.titleFor(processKey)}</b>
        <span data-testid={`pw-inst-asof-${processKey}`}>{t.asOf(m.asOf, m.asOfSource)}</span>
        <small>{t.asOfHint}</small>
      </header>
      {/* 判据③：推导值的诚实位固定在最上面，不是藏在页脚 */}
      <p className={styles.notMeasured} data-testid={`pw-inst-origin-${processKey}`}>
        {t.originNote}
      </p>
      <p className={styles.stdCompare} data-testid={`pw-inst-std-${processKey}`}>
        {t.stdCompare(m.stdDurationDays)}
      </p>

      {/* 判据②：反推不出就说缺什么 + 怎么复验，不渲染空表冒充「没有卡顿」 */}
      {!m.available ? (
        <div className={styles.absent} data-testid={`pw-inst-absent-${processKey}`}>
          <b>{t.absentTitle}</b>
          {m.absence && (
            <>
              <p data-testid={`pw-inst-absent-kind-${processKey}`}>{t.absentKind(m.absence.kind)}</p>
              <p data-testid={`pw-inst-absent-reason-${processKey}`}>{m.absence.reason}</p>
              <small data-testid={`pw-inst-absent-probe-${processKey}`}>{t.absentProbe(m.absence.probe)}</small>
            </>
          )}
        </div>
      ) : (
        <>
          <p className={styles.owners} data-testid={`pw-inst-counts-${processKey}`}>
            {t.counts(m.instanceCount, m.stuckCount)}
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t.table.instance}</th>
                  <th>{t.table.entered}</th>
                  <th>{t.table.exited}</th>
                  <th className={styles.num}>{t.table.dwell}</th>
                  <th className={styles.num}>{t.table.gap}</th>
                  <th>{t.table.owner}</th>
                  <th>{t.table.source}</th>
                </tr>
              </thead>
              <tbody>
                {m.rows.slice(0, 20).map((r) => (
                  <tr key={r.instanceKey} data-testid={`pw-inst-row-${r.instanceKey}`} data-still-in={r.stillIn}>
                    <td>
                      {/* WO-PROCESS-INSTANCE-UI · 深链入口②：反推实例行 → 实例详情页。
                          详情端点不按产地过滤（反推实例也能查），故这批实例同样「建出来就能找回」。 */}
                      <Link
                        to={`/process-instances/${encodeURIComponent(r.instanceId)}`}
                        data-testid={`pw-inst-detail-${r.instanceKey}`}
                      >
                        <code>{r.carrierObjectId}</code>
                      </Link>
                    </td>
                    <td>{r.enteredAt}</td>
                    <td data-testid={`pw-inst-exit-${r.instanceKey}`}>{r.exitedAt ?? t.stillIn}</td>
                    {/* data-dwell-days 刻意不格式化：门要断言精确天数，格式化只作用于人眼 */}
                    <td className={styles.num} data-dwell-days={r.dwellDays}>
                      {r.dwellDays}
                    </td>
                    {/* 算不出就显式空（`—`），不是 0 —— 0 是结论，空是「本站未出站或已是末站」 */}
                    <td className={styles.num} data-gap-days={r.gapDaysToNext ?? ""}>
                      {r.gapDaysToNext ?? t.noGap}
                    </td>
                    <td data-testid={`pw-inst-owner-${r.instanceKey}`}>
                      {r.ownerFunctionKey}
                      {r.partyField && (
                        <small>
                          {" "}
                          · {r.partyField}={r.partyValue}
                        </small>
                      )}
                    </td>
                    {/* R13：溯源到具体单据字段 + **原值**（原单位、不换算） */}
                    <td className={styles.src} data-testid={`pw-inst-src-${r.instanceKey}`}>
                      {r.sources.map((s) => `${s.field}=${String(s.rawValue)}→${s.resolvedAt}`).join(" / ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 单个等待态分组
// ══════════════════════════════════════════════════════════════════════════════

function WaitKindGroup({ g, selectedKey, onSelect, stuck, focusKey }: { g: WaitKindGroupVM; selectedKey: string | null; onSelect: (key: string) => void; stuck: StuckSummary; focusKey: string | null }) {
  const copy = WAIT_KIND_COPY[g.kind];
  const style = WAIT_KIND_STYLE[g.kind];
  const t = zh.processWait;
  // WO-FLOWTIME：展开哪一条流程的实例明细（null = 都没展开）。一次只开一条 ——
  // 每条都自动拉一次实例会把 65 条流程变成 65 次反推，而**每次反推都要扫规则表点名的全部承载类型**
  // （2026-08-14 实测：`reconstructAndPersist` 一次产出 >500 条实例，见
  //  `apps/datacore/test/process-flow-time.seam.test.ts` ① 的基数断言；
  //  复验：`pnpm --filter datacore exec vitest run test/process-flow-time.seam.test.ts`，
  //  或读落点 `apps/datacore/src/process/reconstruct.ts` 的 `neededTypes` 循环）。
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <section
      className={styles.group}
      data-testid={`pw-group-${g.kind}`}
      data-kind={g.kind}
      // 每态一个色变量 —— 四组四色，视觉上一眼分得开（需求判据③）。
      style={{ ["--kind-color" as string]: `var(${style.colorVar})` }}
    >
      <header className={styles.groupHead}>
        <span className={styles.mark} data-testid={`pw-mark-${g.kind}`} aria-hidden="true">
          {style.mark}
        </span>
        <div className={styles.groupTitle}>
          {/* ⚠ 标签文本单独挂 testid：若把它与下面的枚举名放在同一个节点上，
              「四态标签两两不同」这条断言会被枚举名撑成恒真（四个态即使都叫「等待中」，
              textContent 仍因 `WAITING_*` 后缀而互不相同）——变异反证当场抖出过这个哑门。 */}
          <h4>
            <span data-testid={`pw-label-${g.kind}`}>{copy.label}</span>
            <span className={styles.enum}>{g.kind}</span>
          </h4>
          {/* 「等谁」——本页的核心 answer，四态四句，绝不合并 */}
          <p className={styles.who} data-testid={`pw-who-${g.kind}`}>
            {copy.who}
          </p>
          <p className={styles.hint} data-testid={`pw-hint-${g.kind}`}>
            {copy.hint}
          </p>
        </div>
        <div className={styles.groupStats}>
          <b data-testid={`pw-count-${g.kind}`}>{t.group.countLabel(g.count)}</b>
          <small data-testid={`pw-stddays-${g.kind}`}>{t.group.stdDaysLabel(g.totalStdDays, g.pctOfTotalStdDays)}</small>
        </div>
      </header>

      {g.count === 0 ? (
        // 空态显式说话：真实读数 ≠ 漏渲染
        <p className={styles.emptyGroup} data-testid={`pw-empty-${g.kind}`}>
          {t.group.empty}
        </p>
      ) : (
        <>
          <p className={styles.owners} data-testid={`pw-owners-${g.kind}`}>
            <span className={styles.ownersLabel}>{t.group.owners}</span>
            {g.owners.map((o) => (
              <span key={o.key} className={styles.ownerChip}>
                {o.name} <small>{t.group.ownerCount(o.count)}</small>
              </span>
            ))}
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t.table.key}</th>
                  <th>{t.table.name}</th>
                  <th>{t.table.domain}</th>
                  <th>{t.table.owner}</th>
                  <th className={styles.num}>{t.table.stdDays}</th>
                  <th>{t.table.carrier}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  /**
                   * ⚠ **合并点（WO-R9-PROCESS-MERGE）：两条互不冲突的下钻同时保留。**
                   * 两张工单各给这一行加了一种"点开看更多"，方向不同、答的问题也不同：
                   *  · ① 整行可点 → 侧栏 `/inspect`：这条流程的**本体关系**（定义层：承载物/链路/杠杆）；
                   *  · ② 末列按钮 → 行内展开 `InstancePanel`：这条流程的**实例**（现场层：哪一条卡着/卡多久）。
                   * 合并前二选一是假选择——「这类流程长什么样」与「这一张单现在怎么了」本就是两问。
                   * 唯一要小心的是事件冒泡：末列按钮必须 `stopPropagation`，
                   * 否则点"看实例"会**顺带**把侧栏也打开（两个面板同时弹出，用户不知道自己点了什么）。
                   */
                  // Fragment 必须带 key（两行一组：主行 + 展开的实例面板行）
                  <Fragment key={r.key}>
                    <tr
                      data-testid={`pw-row-${r.key}`}
                      data-kind={r.waitKind}
                      data-selected={selectedKey === r.key ? "1" : "0"}
                      data-focus={focusKey === r.key ? "1" : "0"}
                      className={styles.rowClickable}
                      onClick={() => onSelect(r.key)}
                    >
                      <td>
                        <button
                          type="button"
                          className={styles.rowBtn}
                          data-testid={`pw-inspect-${r.key}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(r.key);
                          }}
                        >
                          <code>{r.key}</code>
                        </button>
                      </td>
                      <td>
                        {/* E5 反向定位：徽标文本直接缀在站名后（td 本就是一个信息块，
                            不再为它单起 <small> —— 第一层块数受门棘轮约束）。
                            机器断言走行上的 data-focus 属性，不依赖这段文本的节点结构。 */}
                        {r.name}
                        {focusKey === r.key ? ` ${t.crosslink.focusBadge}` : ""}
                      </td>
                      <td>{r.domainName}</td>
                      <td>{r.ownerName}</td>
                      {/* data-std-days 刻意不四舍五入：门要断言精确工期，格式化只作用于人眼 */}
                      <td className={styles.num} data-std-days={r.stdDurationDays}>
                        {r.stdDurationDays}
                      </td>
                      <td>
                        <code>{r.carrierTypeKey}</code>
                      </td>
                      {/* WO-FLOWTIME：下钻到实例粒度（哪一条卡着 / 卡在谁那里 / 卡了多久） */}
                      <td>
                        <button
                          type="button"
                          className={styles.drillBtn}
                          data-testid={`pw-drill-${r.key}`}
                          onClick={(e) => {
                            // 🔴 不 stopPropagation ⇒ 冒泡到 <tr onClick> ⇒ 侧栏被顺带打开。
                            e.stopPropagation();
                            setOpenKey(openKey === r.key ? null : r.key);
                          }}
                        >
                          {openKey === r.key ? t.instances.close : t.instances.open}
                        </button>
                        {/* WO-IA-E2E5E6 · E5：模板层 → 实例层（过滤到该站的流程卡点页）。
                            计数与那边渲染的卡片数被接缝测试钉成相等 —— 数对不上的链接比没有更坏。 */}
                        <StuckCountCell processKey={r.key} stuck={stuck} />
                      </td>
                    </tr>
                    {openKey === r.key && (
                      <tr>
                        <td colSpan={7}>
                          <InstancePanel processKey={r.key} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 页面
// ══════════════════════════════════════════════════════════════════════════════

export default function ProcessWaitView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // WO-IA-E2E5E6 · E5：各站卡单计数（流程卡点投影）。与定义表**各拉各的**——
  // 定义表失败不该拖死计数，计数暗发（process.runtime 关）也不该拖死定义表。
  const [stuck, setStuck] = useState<StuckSummary>({ status: "loading" });
  // E5 反向入口：/v/process-stuck 的卡「这类流程通常在这站等什么 →」带 ?focus=<processKey> 跳回。
  const [params] = useSearchParams();
  const focusKey = params.get("focus");
  // WO-V4-INSPECT：点开哪一条流程（null = 没点开）。面板自己拉 `/inspect`，本页不预取 ——
  // 65 条流程各预取一次 = 65 次请求，而用户一次只看一条。
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const t = zh.processWait;

  useEffect(() => {
    let alive = true;
    fetchProcessDefinitions()
      .then((res) => {
        if (alive) setState({ status: "ready", model: buildProcessWaitModel(res) });
      })
      .catch((e: unknown) => {
        if (alive) setState({ status: "error", ...readError(e) });
      });
    loadStuckSummary(t.crosslink).then((s) => {
      if (alive) setStuck(s);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // focus 定位：数据 ready 后把那一行滚进视口（高亮靠 data-focus 属性，见 WaitKindGroup）。
  // jsdom 没有 scrollIntoView（undefined）——照 TaskDetailPage.tsx:36 的既有守卫，别裸调。
  useEffect(() => {
    if (state.status !== "ready" || focusKey === null || focusKey === "") return;
    const row = document.querySelector(`[data-testid="pw-row-${CSS.escape(focusKey)}"]`);
    if (row && typeof (row as HTMLElement).scrollIntoView === "function") {
      (row as HTMLElement).scrollIntoView({ block: "center" });
    }
  }, [state.status, focusKey]);

  return (
    <div className={styles.root} data-testid="pw-root">
      <header className={styles.head}>
        <h3>
          {t.title}
          {/* 口径类说明（这页**不是什么** + 数据来源）属 R-UI-3 的浮层层级 ——
              留在第一层正是 ui-first-layer 门 D1 咬的「纯往第一层堆」。 */}
          <InfoPopover topic={t.title} testId="pw-head">
            <p>{t.vsImpediments}</p>
            <p>{t.sourceNote}</p>
          </InfoPopover>
        </h3>
        <p className={styles.sub}>{t.subtitle}</p>
      </header>

      {/* 诚实位：先说清楚这一页答不了什么，再给数（不是把免责声明藏在页脚） */}
      <section className={styles.honesty} data-testid="pw-honesty">
        <b>{t.honesty.title}</b>
        <p>{t.honesty.canAnswer}</p>
        {/* E5：focus 的站查无此行 ⇒ 并进「答不了」段明说（同属"这一页答不出什么"），
            不另起信息块 —— 第一层块数受 ui-first-layer 门棘轮约束。 */}
        <p data-testid="pw-honesty-cannot">
          {t.honesty.cannotAnswer}
          {state.status === "ready" &&
          focusKey !== null &&
          focusKey !== "" &&
          !state.model.groups.some((g) => g.rows.some((r) => r.key === focusKey))
            ? ` ${t.crosslink.focusMissing(focusKey)}`
            : ""}
        </p>
        <p className={styles.notMeasured} data-testid="pw-not-measured">
          {t.honesty.notMeasured}
          {/* E5 口径声明：反推实例归属不到站（单据上没有「第几步」），各站计数不含它们 ——
              与上一句同属"别把这个数读反"，并进同一段，不另起块。 */}
          {stuck.status === "ready" && stuck.derivedStuckCount > 0
            ? ` ${t.crosslink.derivedNote(stuck.derivedStuckCount)}`
            : ""}
        </p>
      </section>

      {state.status === "loading" && <p className={styles.stateLine}>{t.state.loading}</p>}

      {state.status === "error" && (
        <div className={styles.error} data-testid="pw-error">
          <b>{t.state.errorTitle}</b>
          <p>
            <code>{state.code}</code> {state.message}
          </p>
          {state.requestId !== null && (
            <p>
              {zh.common.requestId}: <code>{state.requestId}</code>
            </p>
          )}
        </div>
      )}

      {state.status === "ready" && (
        <>
          {/* 词表漂移：后端下发词表 ≠ 契约词表 ⇒ 接缝断了，显式报，不默默少画一组 */}
          {(state.model.vocabDrift.missingInResponse.length > 0 ||
            state.model.vocabDrift.unknownInResponse.length > 0) && (
            <div className={styles.drift} data-testid="pw-drift">
              <b>{t.drift.title}</b>
              {state.model.vocabDrift.missingInResponse.length > 0 && (
                <p>{t.drift.missing(state.model.vocabDrift.missingInResponse.join("、"))}</p>
              )}
              {state.model.vocabDrift.unknownInResponse.length > 0 && (
                <p>{t.drift.unknown(state.model.vocabDrift.unknownInResponse.join("、"))}</p>
              )}
            </div>
          )}

          <section className={styles.summary} data-testid="pw-summary">
            <div className={styles.kpi}>
              <small>{t.summary.totalProcesses}</small>
              <b data-testid="pw-total-processes">
                {state.model.totalProcesses}
                <span className={styles.unit}>{t.summary.unit.process}</span>
              </b>
            </div>
            <div className={styles.kpi}>
              <small>{t.summary.totalStdDays}</small>
              <b data-testid="pw-total-stddays">
                {state.model.totalStdDays}
                <span className={styles.unit}>{t.summary.unit.day}</span>
              </b>
            </div>
            {/* 四态分布条：宽度 ∝ 条数，颜色 = 该态色 —— 一眼看出「哪一类等待占大头」 */}
            <div className={styles.dist} data-testid="pw-dist">
              <small>{t.summary.byKind}</small>
              <div className={styles.distBar}>
                {state.model.groups.map((g) => (
                  <span
                    key={g.kind}
                    className={styles.distSeg}
                    data-testid={`pw-dist-${g.kind}`}
                    data-count={g.count}
                    title={`${WAIT_KIND_COPY[g.kind].label} · ${t.group.countLabel(g.count)}`}
                    style={{
                      ["--kind-color" as string]: `var(${WAIT_KIND_STYLE[g.kind].colorVar})`,
                      flexGrow: g.count,
                    }}
                  >
                    {g.count > 0 ? WAIT_KIND_COPY[g.kind].short : ""}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {state.model.totalProcesses === 0 && (
            <p className={styles.stateLine} data-testid="pw-empty-all">
              {t.state.empty}
            </p>
          )}

          {/* 检视面板：选中才渲染 —— 没选中时**不占位**，也不画一个空面板假装有内容 */}
          {selectedKey !== null ? (
            <ProcessInspectPanel processKey={selectedKey} onClose={() => setSelectedKey(null)} />
          ) : (
            <p className={styles.stateLine} data-testid="pw-inspect-hint">
              {t.inspect.openHint}
            </p>
          )}

          {state.model.groups.map((g) => (
            <WaitKindGroup key={g.kind} g={g} selectedKey={selectedKey} onSelect={setSelectedKey} stuck={stuck} focusKey={focusKey} />
          ))}
        </>
      )}
    </div>
  );
}
