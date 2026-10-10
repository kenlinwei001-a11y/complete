import { useEffect, useState } from "react";
import type { ProcessInspectResponse } from "@platform/contracts";
import { fetchProcessInspect } from "@/api/endpoints";
import { zh } from "@/locales/zh";
import styles from "./ProcessInspectPanel.module.css";

/**
 * WO-V4-INSPECT · **流程节点检视面板**（PRD-sandbox-v4-backward-derivation §4.1 + §4.2）。
 *
 * 「点开一条业务流程，看它的完整本体关系」—— 承载类型 / 属性 / 派生 / 一跳关系 /
 * 同承载物流程 / 打到它的杠杆 / 十六层三态，全部来自
 * `GET /a/v1/process-definitions/{key}/inspect` 一次调用。
 *
 * ── 本组件刻意**不做**的事（每一条都是本仓踩过的坑）─────────────────────────
 *
 * · **零写死词表（R14）**：流程名 / 域名 / 职能名 / 对象类型中文名 / 属性中文名 / 单位
 *   一个都不在本文件里。响应给 `null` 就显裸键（`displayName ?? propKey`），
 *   **绝不臆造中文名** —— 编错比不编危险，业务专家会照着错的理解。
 *   界面骨架文案（表头、区块标题）走 `locales/zh.ts`，与业务词表严格分开。
 *
 * · **不拿标准工期冒充实测卡顿**：`runtime.available` 恒 `false`
 *   （**2026-08-14 实测**；复验：`curl -s -H 'X-Debug-User: demo:admin:admin' \
 *   'http://127.0.0.1:4001/a/v1/process-definitions/P32/inspect' | jq .runtime`
 *   —— 65/65 条流程全量扫过，`runtime.available` 无一为 true）。
 *   ⚠️ **这条原本挂着的保质期已到期，本次照它自己的指示「改口径而不是加豁免」**：
 *   原注释写「`ProcessInstance` 承载物一旦接上……此处即过期」——
 *   承载物**已于 2026-08-14 接上**（WO-R9-PROCESS-MERGE 合并 WO-FLOWTIME ⊕ WO-PROCESS-INSTANCE，
 *   见本体 §2.K 与 `apps/datacore/migrations/033_process_instances.sql`）。
 *   但 `available` **仍然是 `false`，且这不是过期未改**：本面板是**定义层**投影，
 *   运行态本就不由它下发 —— 缺席理由已同步改成「本投影不答，去
 *   `GET /a/v1/process-definitions/{key}/instances` 或求解器 `process_flow_time` 答」
 *   （落点 `apps/datacore/src/process/inspect.ts` 的 `runtime.reason`）。
 *   ⚠️ 新的保质期：哪天本面板自己开始下发运行态，这段必须再改一次。
 *   页面把 `runtime.reason` 与 `runtime.unanswerable` **当面列出来**，
 *   工期数字旁边贴 `runtime.stdDurationCaption`（口径也是后端下发的，
 *   免得前端写一句将来会过期的说明 —— `G-FRONTEND-HARDCODED-ABSENCE` 记的就是这个病）。
 *
 * · **承载物解析不到不画占位**：`carrier.status === "absent"` 时显示
 *   `carrier.absentReason`（说明缺在哪一环），而不是一个空表格或「暂无数据」。
 *   十六层同理：`carrierLayers === null` ⇒ 显示 `carrierLayersAbsentReason`，
 *   **不画 16 个空格子假装算过**。
 *
 * · **空集合要说话**：一跳关系 0 条 / 同承载物流程 0 条 / 杠杆 0 条都各有一句
 *   明确文案，而不是渲染成一片空白 —— 「租户没有」与「前端漏画」在屏幕上必须分得开。
 *
 * · **零硬编码颜色**：全部走 `styles/tokens.css` 的 CSS 变量（三套皮自动跟随）。
 */

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: ProcessInspectResponse }
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

/** 中文名缺省即"业务含义未确证" ⇒ 诚实显裸键，不臆造（WO-SCHEMA-ZH 留白纪律）。 */
const label = (displayName: string | null, key: string): string => displayName ?? key;

export function ProcessInspectPanel({ processKey, onClose }: { processKey: string; onClose: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const t = zh.processWait.inspect;

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    fetchProcessInspect(processKey)
      .then((data) => {
        if (alive) setState({ status: "ready", data });
      })
      .catch((e: unknown) => {
        if (alive) setState({ status: "error", ...readError(e) });
      });
    return () => {
      alive = false;
    };
  }, [processKey]);

  return (
    <aside className={styles.panel} data-testid="pi-panel" data-process={processKey} aria-label={t.title}>
      <header className={styles.head}>
        <h4 data-testid="pi-title">
          {t.title} <code>{processKey}</code>
        </h4>
        <button type="button" className={styles.close} onClick={onClose} data-testid="pi-close">
          {t.close}
        </button>
      </header>

      {state.status === "loading" && <p className={styles.stateLine}>{t.loading}</p>}

      {state.status === "error" && (
        <div className={styles.error} data-testid="pi-error">
          <b>{t.errorTitle}</b>
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

      {state.status === "ready" && <InspectBody d={state.data} />}
    </aside>
  );
}

function InspectBody({ d }: { d: ProcessInspectResponse }) {
  const t = zh.processWait.inspect;
  return (
    <div className={styles.body}>
      {/* ── ① 流程静态属性（第一层只放结论）───────────────────────────────── */}
      <section className={styles.block} data-testid="pi-process">
        <h5>{t.section.process}</h5>
        <dl className={styles.kv}>
          <dt>{t.field.name}</dt>
          <dd data-testid="pi-name">{d.process.name}</dd>
          <dt>{t.field.domain}</dt>
          <dd data-testid="pi-domain">
            {label(d.process.domainName, d.process.domainKey)} <code>{d.process.domainKey}</code>
          </dd>
          <dt>{t.field.owner}</dt>
          <dd data-testid="pi-owner">
            {label(d.process.ownerFunctionName, d.process.ownerFunctionKey)} <code>{d.process.ownerFunctionKey}</code>
          </dd>
          <dt>{t.field.waitKind}</dt>
          <dd data-testid="pi-waitkind">
            {zh.processWait.waitKind[d.process.waitKind].label} <code>{d.process.waitKind}</code>
          </dd>
          <dt>{t.field.stdDays}</dt>
          {/* 口径文案由后端下发（stdDurationCaption），前端不写第二份可能过期的说明 */}
          <dd data-testid="pi-stddays" data-std-days={d.runtime.stdDurationDays}>
            {d.runtime.stdDurationDays}
            <small className={styles.caption} data-testid="pi-stddays-caption">
              {d.runtime.stdDurationCaption}
            </small>
          </dd>
          <dt>{t.field.carrier}</dt>
          <dd data-testid="pi-carrierkey">
            <code>{d.carrier.typeKey}</code>
          </dd>
        </dl>
      </section>

      {/* ── ② 运行态诚实位：本页答不了什么，当面说 ────────────────────────── */}
      <section className={styles.honesty} data-testid="pi-runtime" data-runtime-available={d.runtime.available ? "1" : "0"}>
        <b>{t.section.runtime}</b>
        <p data-testid="pi-runtime-reason">{d.runtime.reason}</p>
        <ul className={styles.unanswerable} data-testid="pi-unanswerable">
          {d.runtime.unanswerable.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </section>

      {/* ── ③ 承载类型：present 才画表；absent 显示缺在哪一环 ───────────────── */}
      <section className={styles.block} data-testid="pi-carrier" data-carrier-status={d.carrier.status}>
        <h5>
          {t.section.carrier}
          {d.carrier.status === "present" && (
            <small className={styles.count} data-testid="pi-carrier-count">
              {t.carrier.objectCount(d.carrier.objectCount ?? 0)}
            </small>
          )}
        </h5>
        {d.carrier.status === "absent" ? (
          <p className={styles.absent} data-testid="pi-carrier-absent">
            {d.carrier.absentReason}
          </p>
        ) : (
          <>
            <p className={styles.typeLine}>
              <b>{label(d.carrier.displayName, d.carrier.typeKey)}</b> <code>{d.carrier.typeKey}</code>
              {d.carrier.domain !== null && <span className={styles.chip}>{d.carrier.domain}</span>}
            </p>
            {d.carrier.description !== null && <p className={styles.desc}>{d.carrier.description}</p>}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t.propTable.propKey}</th>
                    <th>{t.propTable.displayName}</th>
                    <th>{t.propTable.dataType}</th>
                    <th>{t.propTable.unit}</th>
                    <th>{t.propTable.flags}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.carrier.properties.map((p) => (
                    <tr key={p.propKey} data-testid={`pi-prop-${p.propKey}`} data-derived={p.derived ? "1" : "0"}>
                      <td>
                        <code>{p.propKey}</code>
                      </td>
                      {/* 中文名缺省 ⇒ 显裸键并标出来，不留空白也不编一个 */}
                      <td>{p.displayName ?? <em className={styles.fallback}>{t.propTable.noZhName}</em>}</td>
                      <td>{p.dataType}</td>
                      <td>{p.unit ?? "—"}</td>
                      <td>
                        {p.isPrimaryKey && <b className={styles.badge}>{t.propTable.pk}</b>}
                        {p.derived && (
                          <b className={styles.badgeDerived} data-testid={`pi-derived-${p.propKey}`}>
                            {t.propTable.derived}
                          </b>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 派生属性把公式直接摆出来：公式就是口径，藏起来等于让人猜这个数是怎么来的 */}
            {d.carrier.derivedProperties.length > 0 && (
              <ul className={styles.formulas} data-testid="pi-formulas">
                {d.carrier.derivedProperties.map((x) => (
                  <li key={x.propKey} data-testid={`pi-formula-${x.propKey}`}>
                    <code>{x.propKey}</code> {label(x.displayName, x.propKey)}
                    {x.unit !== null && <span className={styles.chip}>{x.unit}</span>}
                    <span className={styles.formula}>= {x.formula}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* ── ④ 一跳关系 ─────────────────────────────────────────────────────── */}
      <section className={styles.block} data-testid="pi-relations">
        <h5>{t.section.relations}</h5>
        {d.relations.length === 0 ? (
          <p className={styles.empty} data-testid="pi-relations-empty">
            {t.relations.empty}
          </p>
        ) : (
          <ul className={styles.rels}>
            {d.relations.map((r) => (
              <li key={r.linkKey} data-testid={`pi-rel-${r.linkKey}`} data-direction={r.direction}>
                <code>{r.linkKey}</code>
                <span className={styles.arrow}>{r.direction === "out" ? "→" : "←"}</span>
                <b>{label(r.neighborDisplayName, r.neighborTypeKey)}</b>
                <code>{r.neighborTypeKey}</code>
                <span className={styles.chip}>{r.cardinality}</span>
                {/* null ≠ 0：类型不存在 vs 类型在但没数据，两句话不同 */}
                <small className={styles.count}>
                  {r.neighborObjectCount === null ? t.relations.typeMissing : t.relations.objectCount(r.neighborObjectCount)}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── ⑤ 同承载物的其它流程 ───────────────────────────────────────────── */}
      <section className={styles.block} data-testid="pi-shared">
        <h5>{t.section.shared}</h5>
        {d.sharedCarrierProcesses.length === 0 ? (
          <p className={styles.empty} data-testid="pi-shared-empty">
            {t.shared.empty}
          </p>
        ) : (
          <ul className={styles.siblings}>
            {d.sharedCarrierProcesses.map((s) => (
              <li key={s.key} data-testid={`pi-sibling-${s.key}`}>
                <code>{s.key}</code> <b>{s.name}</b>
                <span className={styles.chip}>{label(s.domainName, s.domainKey)}</span>
                <span className={styles.chip}>{label(s.ownerFunctionName, s.ownerFunctionKey)}</span>
                <small className={styles.count}>{zh.processWait.waitKind[s.waitKind].label}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── ⑥ 打到这个承载物的杠杆（PRD §4.1：域映射由后端一跳查表算出）──────── */}
      <section className={styles.block} data-testid="pi-levers">
        <h5>{t.section.levers}</h5>
        {d.levers.length === 0 ? (
          <p className={styles.empty} data-testid="pi-levers-empty">
            {t.levers.empty}
          </p>
        ) : (
          <ul className={styles.levers}>
            {d.levers.map((l) => (
              <li key={l.leverKey} data-testid={`pi-lever-${l.leverKey}`} data-resolved={l.landingResolved ? "1" : "0"}>
                {/* 标签/单位全部来自 LEVER_PROP_META 单源，前端只排版 */}
                <b>{l.label}</b>
                <code>{l.leverKey}</code>
                {l.unit !== "" && <span className={styles.chip}>{l.unit}</span>}
                <span className={styles.chip}>{l.valueKind}</span>
                {l.landingResolved ? (
                  <small className={styles.count}>{t.levers.landing(l.landingWhere ?? "")}</small>
                ) : (
                  <b className={styles.badgeWarn} data-testid={`pi-lever-dead-${l.leverKey}`}>
                    {t.levers.dead}
                  </b>
                )}
                <small className={styles.count} data-testid={`pi-lever-domains-${l.leverKey}`}>
                  {t.levers.reach(l.domains.map((x) => label(x.name, x.key)).join("、"), l.processKeys.length)}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── ⑦ 十六层三态（复用后端 slice-layers 投影）─────────────────────────── */}
      <section className={styles.block} data-testid="pi-layers">
        <h5>
          {t.section.layers}
          {d.carrierLayers !== null && (
            <small className={styles.count} data-testid="pi-layers-summary">
              {t.layers.summary(d.carrierLayers.summary.present, d.carrierLayers.summary.notInSlice, d.carrierLayers.summary.absent)}
            </small>
          )}
        </h5>
        {d.carrierLayers === null ? (
          <p className={styles.absent} data-testid="pi-layers-absent">
            {d.carrierLayersAbsentReason}
          </p>
        ) : (
          <>
            {/* 子图为空时先说「子图没解出来」，再谈层 —— 否则每层的 absent 都是误导 */}
            {d.carrierLayers.graph.empty !== undefined && (
              <p className={styles.absent} data-testid="pi-layers-emptygraph">
                {d.carrierLayers.graph.empty.message}
              </p>
            )}
            <ul className={styles.layers}>
              {d.carrierLayers.layers.map((l) => (
                <li key={l.id} data-testid={`pi-layer-${l.id}`} data-status={l.status}>
                  <span className={styles.ordinal}>{l.ordinal}</span>
                  <b>{t.layerName[l.id] ?? l.id}</b>
                  <span className={styles.chip} data-testid={`pi-layer-status-${l.id}`}>
                    {t.layerStatus[l.status]}
                  </span>
                  <small className={styles.count}>
                    {l.count} {l.unit}
                  </small>
                  {l.absentReason !== undefined && <small className={styles.reason}>{l.absentReason}</small>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

export default ProcessInspectPanel;
