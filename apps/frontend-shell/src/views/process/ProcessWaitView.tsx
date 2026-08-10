import { useEffect, useState } from "react";
import { fetchProcessDefinitions } from "@/api/endpoints";
import { zh } from "@/locales/zh";
import {
  buildProcessWaitModel,
  WAIT_KIND_COPY,
  WAIT_KIND_STYLE,
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
 *  · **诚实缺席**：只给标准工期，明写「不是已卡 N 天」；运行态 `ProcessTask` 未实现。
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
// 单个等待态分组
// ══════════════════════════════════════════════════════════════════════════════

function WaitKindGroup({ g }: { g: WaitKindGroupVM }) {
  const copy = WAIT_KIND_COPY[g.kind];
  const style = WAIT_KIND_STYLE[g.kind];
  const t = zh.processWait;
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
          <h4 data-testid={`pw-label-${g.kind}`}>
            {copy.label}
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
                {o.name} <small>×{o.count}</small>
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
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.key} data-testid={`pw-row-${r.key}`} data-kind={r.waitKind}>
                    <td>
                      <code>{r.key}</code>
                    </td>
                    <td>{r.name}</td>
                    <td>{r.domainName}</td>
                    <td>{r.ownerName}</td>
                    {/* data-std-days 刻意不四舍五入：门要断言精确工期，格式化只作用于人眼 */}
                    <td className={styles.num} data-std-days={r.stdDurationDays}>
                      {r.stdDurationDays}
                    </td>
                    <td>
                      <code>{r.carrierTypeKey}</code>
                    </td>
                  </tr>
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
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={styles.root} data-testid="pw-root">
      <header className={styles.head}>
        <h3>{t.title}</h3>
        <p className={styles.sub}>{t.subtitle}</p>
        <p className={styles.sub}>{t.vsImpediments}</p>
        <p className={styles.source}>{t.sourceNote}</p>
      </header>

      {/* 诚实位：先说清楚这一页答不了什么，再给数（不是把免责声明藏在页脚） */}
      <section className={styles.honesty} data-testid="pw-honesty">
        <b>{t.honesty.title}</b>
        <p>{t.honesty.canAnswer}</p>
        <p data-testid="pw-honesty-cannot">{t.honesty.cannotAnswer}</p>
        <p className={styles.notMeasured} data-testid="pw-not-measured">
          {t.honesty.notMeasured}
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

          {state.model.groups.map((g) => (
            <WaitKindGroup key={g.kind} g={g} />
          ))}
        </>
      )}
    </div>
  );
}
