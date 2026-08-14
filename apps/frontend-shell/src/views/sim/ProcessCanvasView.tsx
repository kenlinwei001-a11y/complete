import { useEffect, useMemo, useState } from "react";
import { fetchProcessDefinitions } from "@/api/endpoints";
import zh from "@/locales/zh";
import { InfoPopover } from "@/components/InfoPopover";
import { WAIT_KIND_ORDER, WAIT_KIND_STYLE, type ProcessDefinitionsResponse } from "@/views/process/processWait";
import { buildProcessCanvasModel, lanesCoverAll, type ProcessCanvasModel } from "./processCanvas";
import styles from "./SandboxConsole.module.css";

/**
 * WO-SANDBOX-PROCESS-MODE · 主画布**第五档「业务流程」**。
 *
 * ── 它回答哪一问 ──────────────────────────────────────────────────────────────
 * 前四档（线路图 / 物理拓扑 / 链路阶段 / 本体拓扑）回答的都是「时间与损失落在哪一段」；
 * 本档回答的是**「企业里到底有哪些业务活动，每一条挂在哪个本体承载物上」**。
 * 点任一条 → 右栏出 `ProcessInspectPanel`，把它的完整本体关系摊开
 * （承载类型 / 属性 / 派生 / 一跳关系 / 同承载物流程 / 打到它的杠杆 / 十六层三态）。
 *
 * ── ⛔ 两层不许混（本档的结构红线）────────────────────────────────────────────
 * 本组件**不 import** 任何节拍层的视图模型，**不产生也不消费 `nodeId`**，
 * 选中态是 `processKey` 而不是 `nodeId`。唯一一处碰到节拍层的地方是
 * `processCanvas.ts` 的 `chainLayerOverlap()` —— 它只做集合求交，
 * 用来在屏上**证明两层不相交**（`spc-disjoint`），而不是把它们接起来。
 *
 * ── 诚实位（本档自带的，一条都不许因为改档位控件而丢）──────────────────────
 *  ① **条数现算，不写死**：屏上同时印「端点下发 N 条」与「本档铺开 M 条」，
 *     N ≠ M 当场标红（`spc-count-mismatch`）。全档不出现 `65` 这个字面量。
 *  ② **标准工期 ≠ 实测滞留**：`stdDurationDays` 是模板值。这句话常驻，不折叠。
 *  ③ **域登记册查不到的域不静默并进"其它"**：单开泳道 + `data-registered="0"`。
 *  ④ **运行态本档答不了**：`ProcessInspectPanel` 的 `runtime.available` 缺席理由照原样显示
 *     （那是后端下发的口径，本档不写第二份会过期的说明）。
 *
 * R6 确定性：无时钟、无随机；排序全序在 `processCanvas.ts` 里定。
 */

type LoadState =
  | { status: "loading" }
  | { status: "ready"; model: ProcessCanvasModel }
  | { status: "error"; code: string; message: string; requestId: string | null };

interface EnvelopeError {
  code?: string;
  message?: string;
  requestId?: string;
}

/** 错误只陈述能从响应直接读出的事实，不内联病因猜测（与本页其余取数同一口径）。 */
function readError(e: unknown): { code: string; message: string; requestId: string | null } {
  const anyE = e as { code?: string; message?: string; requestId?: string; error?: EnvelopeError; status?: number };
  const code = anyE?.error?.code ?? anyE?.code ?? (anyE?.status ? `HTTP_${anyE.status}` : "UNKNOWN");
  const message = anyE?.error?.message ?? anyE?.message ?? String(e);
  return { code: String(code), message, requestId: anyE?.error?.requestId ?? anyE?.requestId ?? null };
}

export interface ProcessCanvasViewProps {
  /** 当前选中的流程 key（受控；`null` = 还没点）。**不是 nodeId** —— 两层的选中态各归各。 */
  selectedProcessKey: string | null;
  onPick: (processKey: string) => void;
  /** 诚实位总开关，与控制台其余档位共用同一个（关掉只影响本档自己的说明段）。 */
  honesty?: boolean;
}

export function ProcessCanvasView({ selectedProcessKey, onPick, honesty = true }: ProcessCanvasViewProps) {
  const t = zh.sim.sandbox.processCanvas;
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    fetchProcessDefinitions()
      .then((res: ProcessDefinitionsResponse) => {
        if (!alive) return;
        setState({ status: "ready", model: buildProcessCanvasModel(res, WAIT_KIND_ORDER) });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({ status: "error", ...readError(e) });
      });
    return () => {
      alive = false;
    };
  }, []);

  const model = state.status === "ready" ? state.model : null;
  const covered = useMemo(() => (model === null ? true : lanesCoverAll(model)), [model]);

  return (
    <div className={styles.processCanvas} data-testid="spc-root">
      {honesty && model !== null ? (
        <p className={styles.noteWarn} data-testid="spc-honesty">
          {/* ① 条数现算：两个数都印出来，等号自己成立或不成立 —— 不写死任何金值 */}
          <b data-testid="spc-counts" data-total={model.total} data-laid={model.laid}>
            {t.counts(model.total, model.laid, model.lanes.length)}
          </b>
          {!covered ? (
            <b className={styles.processMismatch} data-testid="spc-count-mismatch">
              {t.mismatch}
            </b>
          ) : null}
          {/* ③ 两层不混：交集现算，屏上就是那个数 */}
          <span data-testid="spc-disjoint" data-overlap={model.chainLayerOverlap.length}>
            {model.chainLayerOverlap.length === 0
              ? t.disjointOk
              : t.disjointBroken(model.chainLayerOverlap.join("、"))}
          </span>
          <InfoPopover topic={zh.sim.sandbox.info.processLayers} testId="process-layers">
            <span data-testid="spc-layers-note">{t.layersNote}</span>
          </InfoPopover>
          {/* ② 标准工期 ≠ 实测滞留（常驻，不折叠） */}
          <span data-testid="spc-stddays-caveat">{t.stdDaysCaveat}</span>
          {model.unregisteredDomainKeys.length > 0 ? (
            <span data-testid="spc-unregistered-domains">{t.unregisteredDomains(model.unregisteredDomainKeys.join("、"))}</span>
          ) : null}
        </p>
      ) : null}

      {state.status === "loading" ? (
        <p className={styles.stateLine} data-testid="spc-loading">
          {t.loading}
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className={styles.errBox} data-testid="spc-error" role="alert">
          <b>{t.errorTitle}</b> <code data-testid="spc-error-code">{state.code}</code> {state.message}
          {state.requestId !== null ? (
            <>
              {" · "}
              {zh.common.requestId}: <code>{state.requestId}</code>
            </>
          ) : null}
        </p>
      ) : null}

      {model !== null ? (
        <>
          {/* 四态计数条：等待类型词表来自契约（`WAIT_KIND_ORDER`），本档不另抄一份 */}
          <div className={styles.processKindBar} data-testid="spc-kindbar">
            {model.byWaitKind.map((g) => (
              <span key={g.kind} className={styles.processKindChip} data-testid={`spc-kind-${g.kind}`} data-count={g.count}>
                <i aria-hidden="true" style={{ background: `var(${WAIT_KIND_STYLE[g.kind].colorVar})` }} />
                {zh.processWait.waitKind[g.kind].label}
                <b>{g.count}</b>
              </span>
            ))}
          </div>

          {model.lanes.length === 0 ? (
            <p className={styles.stateLine} data-testid="spc-empty">
              {t.empty}
            </p>
          ) : (
            <div className={styles.stageBoard} data-testid="spc-board">
              {model.lanes.map((lane) => (
                <section
                  key={lane.domainKey}
                  className={styles.lane}
                  data-testid={`spc-lane-${lane.domainKey}`}
                  data-registered={lane.registered ? "1" : "0"}
                >
                  <div className={styles.laneHead}>
                    <span className={styles.laneName}>
                      {lane.domainName} <code>{lane.domainKey}</code>
                      {!lane.registered ? <b data-testid={`spc-lane-unreg-${lane.domainKey}`}>{t.laneUnregistered}</b> : null}
                    </span>
                    <span className={styles.laneStat}>{t.laneStat(lane.cards.length, lane.totalStdDays)}</span>
                  </div>
                  <div className={styles.laneGrid}>
                    {lane.cards.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        className={styles.nodeCard}
                        /* 形状标识与节拍层的卡片刻意同款（同一块画布上读法一致），
                           但 `data-layer` 把两层分开标出来 —— 同屏 ≠ 同模型。 */
                        data-card-shape="solid-block"
                        data-layer="process"
                        data-process-key={c.key}
                        data-wait-kind={c.waitKind}
                        aria-pressed={selectedProcessKey === c.key}
                        data-testid={`spc-card-${c.key}`}
                        /* ⚠ **没有 `title=`**：`docs/CONVENTION-ui-information-layering.md` §2 R-UI-3
                           明令禁止用原生 tooltip 充当浮层（不受控 · 永远画在最上层 · 移开滞留；
                           本仓 2026-08-10 真出过遮挡事故），且 `sandbox-ui-integrate.seam` 有一条
                           **全屏棘轮**盯着 `[title]` 的总数。卡上要说的三件事（名字 / 流程键 /
                           等待类型）本来就都画在卡上了，再挂一个 tooltip 只是把同一句话说两遍。 */
                        aria-label={`${c.name}（${c.key}）· ${zh.processWait.waitKind[c.waitKind].label}`}
                        onClick={() => onPick(c.key)}
                      >
                        <span className={styles.nodeCardTop}>
                          <span className={styles.nodeCardName}>{c.name}</span>
                          <span className={styles.processKeyChip}>{c.key}</span>
                        </span>
                        <span className={styles.nodeCardTopStep}>
                          <i className={styles.processWaitMark} aria-hidden="true" style={{ background: `var(${WAIT_KIND_STYLE[c.waitKind].colorVar})` }}>
                            {WAIT_KIND_STYLE[c.waitKind].mark}
                          </i>
                          {zh.processWait.waitKind[c.waitKind].label}
                        </span>
                        <span className={styles.nodeCardFoot}>
                          <span>{t.stdDays(c.stdDurationDays)}</span>
                          {/* 承载物类型键：卡上直接写出来（同上，不挂原生 tooltip） */}
                          <span>
                            <code>{c.carrierTypeKey}</code>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export default ProcessCanvasView;
