import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ENTERPRISE_STATE_REAL_WORLD_ID, type EnterpriseState } from "@platform/contracts";
import {
  fetchEnterpriseStateDiff,
  fetchEnterpriseStates,
  fetchSimSessions,
  forkEnterpriseStateToWorld,
  type EnterpriseStateChange,
} from "@/api/endpoints";
import { InfoPopover } from "@/components/InfoPopover";
import zh from "@/locales/zh";
import styles from "./ImpactAnalysisPanel.module.css";

/**
 * WO-BEFE-WIRE-3 · **企业状态快照 · 分叉与比对**
 * （`POST /a/v1/twin/enterprise-states/:id/fork` 与 `GET /a/v1/twin/enterprise-states/:id/diff`
 *   的前端消费方 —— 这两条后端注册了却一直零调用方：**2026-08-10 实测**，复验命令
 *   `node scripts/check-backend-frontend-seam.mjs --verbose`，两条当天都在门 `befe-seam:check`
 *   载体② 的「当前零调用端点明细」里；接完同一条命令报「已修复」）。
 *
 * ── 为什么是一个**新**面板，而不是往 `EnterpriseStatePanel` 里塞 ──────────────
 * 那个面板刻意是**只读**的：它答「这个世界现在什么状态」，一个动作按钮都没有。
 * 分叉是**写**（产生新行），比对是**下钻**（第二层）——按
 * `docs/CONVENTION-ui-information-layering.md` §1，动作与下钻属于第二层，不该挤进
 * 那面板的第一层把「重点指标」淹掉。故本面板独立成沙盘右栏的另一个可折叠区（默认收起）。
 * `SandboxView.tsx` 里那句「仿真世界的快照走 `POST …/fork`（另一张单的 UI）」说的就是这里。
 *
 * ── 两世界物理隔离（PRD-enterprise-decision-twin §4.1）─────────────────────────
 * fork **必须产生新行**：真实世界那一行一个字节都不动。新行每条指标的 `source.kind` 被后端
 * 翻成 `FORKED`（诚实：这些数是复制来的、没有重算）—— 屏上必须把这件事说出来，
 * 否则用户会以为仿真世界那份数字是现场数出来的。
 *
 * ── 诚实纪律 ─────────────────────────────────────────────────────────────────
 *  · fork 的目标 `worldId` 必须是**已存在的推演会话 id**。没有会话就诚实说没有，
 *    **不提供一个点了必 404 的按钮**（那是把错误留给用户去撞）。
 *  · diff 的 `changes` 只含真的变了的项 ⇒ 空数组 = 两份快照逐项一致，
 *    屏上说「0 项差异」并写明口径，**不许**说成「没查到」。
 *  · `from`/`to` 可能是 `null`（该项在那份快照里数不出来）⇒ 显「—」，**绝不写 0**。
 */

/** 快照展示名：世界 + 逻辑时刻（**不显示 wall-clock** —— 快照锚的是模拟时钟）。 */
function stateLabel(s: EnterpriseState): string {
  return `${s.worldId} · tick ${s.capturedAt.tick} · ${s.capturedAt.simulatedDate}${s.isSimulated ? "（仿真）" : "（真实）"}`;
}

/** 数值：`null` = 诚实空 → 「—」。0 是真的 0，两者必须分得开。 */
const fmtNum = (n: number | null): string => (n === null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(2));

/*
 * ⚠ 这两段说明**刻意不抽成组件**（2026-08-14 · WO-UI-BURNDOWN-21）。
 * 抽成 `function ForkNote()` 时它们的正文**看着**在浮层里，实际是定义在浮层之外的一段 JSX ——
 * 读者点开才看得到、可门与人复审时都读作「第一层还摆着一段口径」
 * （`scripts/check-ui-first-layer.mjs` 的记账原话：「定义在外、只在浮层里用的组件，会被算进第一层」）。
 * 这正是本仓 §0.6 那句形态：**我用「它被浮层引用了」当作「它在浮层里」的证据，而前者并不度量后者。**
 * 故就地内联进 `<InfoPopover>` 的 children —— 文案一个字没改，只是真的挪进了浮层。
 * 复验：`node scripts/check-ui-first-layer.mjs --explain <本文件>` 的 formula 应为 0。
 */

export function EnterpriseStateTwinPanel() {
  const qc = useQueryClient();
  const [sourceId, setSourceId] = useState("");
  const [targetWorld, setTargetWorld] = useState("");
  const [baseId, setBaseId] = useState("");
  const [againstId, setAgainstId] = useState("");
  const [forked, setForked] = useState<EnterpriseState | null>(null);
  const [diff, setDiff] = useState<{ before: string; after: string; changes: EnterpriseStateChange[] } | null>(null);
  const [busy, setBusy] = useState<"fork" | "diff" | null>(null);
  const [err, setErr] = useState<{ code?: string; message?: string; requestId?: string } | null>(null);

  // 全部世界的快照时间线（不传 worldId = 全部）——比对的两端都从这里选。
  const statesQ = useQuery({
    // 与 store/eventInvalidation.ts 的 `enterprise-states` 语义标签同前缀 ⇒
    // `enterprise_state.forked` 事件到达时本面板真的会重取（否则事件就是发给空气的）。
    queryKey: ["a", "enterprise-states", "__all__"],
    queryFn: () => fetchEnterpriseStates(),
    staleTime: 30_000,
  });
  const worldsQ = useQuery({
    queryKey: ["a", "sim-sessions", "enterprise-fork"],
    queryFn: fetchSimSessions,
    retry: false,
    staleTime: 30_000,
  });

  const states = useMemo(() => statesQ.data?.items ?? [], [statesQ.data]);
  const worlds = useMemo(() => worldsQ.data?.items ?? [], [worldsQ.data]);
  /** 可被分叉的源 = **真实世界**那些快照（仿真世界的再分叉没有语义，后端也不禁止，但入口不该引导）。 */
  const forkSources = useMemo(() => states.filter((s) => s.worldId === ENTERPRISE_STATE_REAL_WORLD_ID), [states]);

  const effSource = sourceId !== "" && forkSources.some((s) => s.id === sourceId) ? sourceId : (forkSources[0]?.id ?? "");
  const effTarget = targetWorld !== "" && worlds.some((w) => w.id === targetWorld) ? targetWorld : (worlds[0]?.id ?? "");
  const effBase = baseId !== "" && states.some((s) => s.id === baseId) ? baseId : (states[0]?.id ?? "");
  const effAgainst =
    againstId !== "" && states.some((s) => s.id === againstId) ? againstId : (states[1]?.id ?? states[0]?.id ?? "");

  // 快照集合一变，上一次的比对结论作废（留着会让人以为那是新数据算出来的）。
  useEffect(() => {
    setDiff(null);
  }, [effBase, effAgainst]);

  const onFork = async (): Promise<void> => {
    if (effSource === "" || effTarget === "" || busy !== null) return;
    setBusy("fork");
    setErr(null);
    try {
      const res = await forkEnterpriseStateToWorld(effSource, effTarget);
      setForked(res);
      // 新行真的进了时间线 —— 重取而不是本地拼一条（本地拼 = 屏上有、库里没有）。
      await qc.invalidateQueries({ queryKey: ["a", "enterprise-states"] });
    } catch (e) {
      const x = e as { code?: string; message?: string; requestId?: string };
      setForked(null);
      setErr({ code: x?.code, message: x?.message, requestId: x?.requestId });
    } finally {
      setBusy(null);
    }
  };

  const onDiff = async (): Promise<void> => {
    if (effBase === "" || effAgainst === "" || busy !== null) return;
    setBusy("diff");
    setErr(null);
    try {
      // 语义：`after` = 路径上那份（对比方），`before` = `?against=` 那份（基准）。
      setDiff(await fetchEnterpriseStateDiff(effBase, effAgainst));
    } catch (e) {
      const x = e as { code?: string; message?: string; requestId?: string };
      setDiff(null);
      setErr({ code: x?.code, message: x?.message, requestId: x?.requestId });
    } finally {
      setBusy(null);
    }
  };

  if (statesQ.isLoading) {
    return (
      <div className={styles.meta} data-testid="twin-loading">
        读取快照时间线…
      </div>
    );
  }
  if (statesQ.isError) {
    const e = statesQ.error as { code?: string; message?: string };
    return (
      <div className={styles.meta} data-testid="twin-list-error" style={{ color: "var(--warn-txt)" }}>
        快照时间线不可用（{e?.code ?? "ERROR"}）：{e?.message ?? "请求失败"}
      </div>
    );
  }

  return (
    <div className={styles.wrap} data-testid="enterprise-state-twin">
      {/* ── 第一层：这个租户手上有几份快照、分布在几个世界（数值 + 名字，不放口径）── */}
      <div className={styles.head} data-testid="twin-head">
        <b className={styles.headNum} data-testid="twin-state-count">
          {states.length}
        </b>
        <span className={styles.headLabel}>
          份快照
          <span className={styles.meta} data-testid="twin-world-count">
            / 分布在 {new Set(states.map((s) => s.worldId)).size} 个世界
          </span>
        </span>
      </div>

      {states.length === 0 ? (
        // 诚实空：一份快照都没有，分叉/比对都无从谈起。不给会 404 的按钮。
        <div className={styles.meta} data-testid="twin-empty">
          还没有任何企业状态快照 —— 分叉与比对都需要至少一份已存在的快照作输入。
          先在「企业状态快照」里捕获一份（或由上游流程捕获），再回来。
        </div>
      ) : null}

      {err ? (
        <div className={styles.meta} data-testid="twin-error" style={{ color: "var(--warn-txt)" }}>
          操作失败（{err.code ?? "ERROR"}）：{err.message ?? "请求失败"}
          {err.requestId ? ` · requestId ${err.requestId}` : ""}
        </div>
      ) : null}

      {/* ── 动作一：分叉进仿真世界 ─────────────────────────────────────── */}
      {forkSources.length > 0 ? (
        <div className={styles.wrap} data-testid="twin-fork">
          <div className={styles.form}>
            <span className={styles.meta}>
              分叉源
              <InfoPopover topic={zh.sim.sandbox.info.twinFork} testId="twin-fork">
                <span data-testid="twin-fork-note">
                  分叉<b>产生一条新行</b>，真实世界那一行一个字节都不动（两世界物理隔离）。
                  新行的逻辑时刻与各项数值<b>原样继承</b>，每条指标的来源被后端翻成 <code>FORKED</code> ——
                  因为这些数是复制来的，<b>没有重算</b>。目标世界只能是一个已存在的推演会话 id，不能是真实世界。
                </span>
              </InfoPopover>
            </span>
            <select
              data-testid="twin-fork-source"
              aria-label="分叉源快照"
              value={effSource}
              onChange={(e) => setSourceId(e.target.value)}
            >
              {forkSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {stateLabel(s)}
                </option>
              ))}
            </select>

            <span className={styles.meta}>目标世界</span>
            {worlds.length === 0 ? (
              <span className={styles.meta} data-testid="twin-no-world">
                本租户还没有推演世界（`SimSession`）—— 分叉的目标只能是一个已存在的推演会话，
                先去沙盘建一个。
              </span>
            ) : (
              <select
                data-testid="twin-fork-target"
                aria-label="分叉目标推演世界"
                value={effTarget}
                onChange={(e) => setTargetWorld(e.target.value)}
              >
                {worlds.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.id} · tick {w.curTick} · {w.status}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button
            className="btn sm primary"
            data-testid="twin-fork-run"
            disabled={effSource === "" || effTarget === "" || busy !== null}
            onClick={() => void onFork()}
          >
            {busy === "fork" ? "分叉中…" : "分叉进仿真世界"}
          </button>

          {forked ? (
            <div className={styles.head} data-testid="twin-forked">
              <b className={styles.cardNum} data-testid="twin-forked-id">
                {forked.id}
              </b>
              <span className={styles.headLabel}>
                新行已产生 · 世界{" "}
                <span className="mono" data-testid="twin-forked-world">
                  {forked.worldId}
                </span>{" "}
                · 源{" "}
                <span className="mono" data-testid="twin-forked-from">
                  {forked.forkedFromStateId ?? "—"}
                </span>
                {/* 诚实位：这些数是复制来的。降层到浮层，但第一层留可见记号。 */}
                <span className={styles.flag} data-testid="twin-forked-provenance">
                  {forked.provenance.mode} · 未重算
                </span>
                <span className={styles.meta} data-testid="twin-forked-metrics">
                  {forked.metrics.length} 项指标
                </span>
              </span>
            </div>
          ) : null}
        </div>
      ) : states.length > 0 ? (
        <div className={styles.meta} data-testid="twin-no-fork-source">
          现有快照里没有真实世界（{ENTERPRISE_STATE_REAL_WORLD_ID}）的那一份 —— 分叉的语义是
          「把真实世界的此刻搬进仿真世界」，没有真实快照就没有可分叉的源。
        </div>
      ) : null}

      {/* ── 动作二：两份快照比对（第二层下钻）───────────────────────────── */}
      {states.length >= 2 ? (
        <div className={styles.wrap} data-testid="twin-diff">
          <div className={styles.form}>
            <span className={styles.meta}>
              基准
              <InfoPopover topic={zh.sim.sandbox.info.twinDiff} testId="twin-diff">
                <span data-testid="twin-diff-note">
                  差分口径 = 契约里那一份纯函数（<code>diffEnterpriseStates</code>），A/B 两侧同一份实现，
                  按指标 <code>key</code> 对齐后<b>只留值不相等的项</b>。所以「0 项差异」= 两份快照逐项一致，
                  不是「没查到」。<code>from</code> / <code>to</code> 为「—」表示该项在那份快照里<b>数不出来</b>
                  （诚实空），与 0 是两件事。
                </span>
              </InfoPopover>
            </span>
            <select
              data-testid="twin-diff-against"
              aria-label="比对基准快照"
              value={effAgainst}
              onChange={(e) => setAgainstId(e.target.value)}
            >
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {stateLabel(s)}
                </option>
              ))}
            </select>
            <span className={styles.meta}>对比</span>
            <select
              data-testid="twin-diff-base"
              aria-label="被比对的快照"
              value={effBase}
              onChange={(e) => setBaseId(e.target.value)}
            >
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {stateLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn sm"
            data-testid="twin-diff-run"
            disabled={effBase === "" || effAgainst === "" || busy !== null}
            onClick={() => void onDiff()}
          >
            {busy === "diff" ? "比对中…" : "比对这两份快照"}
          </button>

          {diff ? (
            <>
              <div className={styles.card} data-testid="twin-diff-head">
                <span className={styles.cardMain}>
                  <b className={styles.cardNum} data-testid="twin-diff-count">
                    {diff.changes.length}
                  </b>
                  <span className={styles.cardLabel}>项指标有差异</span>
                </span>
                <span className={styles.meta} data-testid="twin-diff-pair">
                  {diff.before} → {diff.after}
                </span>
              </div>
              {diff.changes.length === 0 ? (
                <div className={styles.meta} data-testid="twin-diff-identical">
                  这两份快照逐项指标<b>完全一致</b>（0 项差异）—— 这是「比过了，没有变化」，不是「没查到」。
                  刚分叉出来的那份必然如此：fork 原样继承数值、不重算。
                </div>
              ) : (
                <div className={styles.scroll}>
                  <table className={styles.table} data-testid="twin-diff-table">
                    <thead>
                      <tr>
                        <th>指标</th>
                        <th>分组</th>
                        <th>基准</th>
                        <th>对比</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.changes.map((c) => (
                        <tr key={c.key} data-testid={`twin-diff-row-${c.key}`}>
                          {/* 标签/分组一律直显后端给的字段，前端不做中文映射白名单（那是第二套真相源）。 */}
                          <td>{c.label}</td>
                          <td className="mono">{c.group}</td>
                          <td className="mono" data-testid={`twin-diff-from-${c.key}`}>
                            {fmtNum(c.from)}
                          </td>
                          <td className="mono" data-testid={`twin-diff-to-${c.key}`}>
                            {fmtNum(c.to)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </div>
      ) : states.length > 0 ? (
        <div className={styles.meta} data-testid="twin-diff-need-two">
          比对需要两份快照，现在只有 {states.length} 份。先分叉一份（或在另一个逻辑时刻再捕获一份）。
        </div>
      ) : null}
    </div>
  );
}

export default EnterpriseStateTwinPanel;
