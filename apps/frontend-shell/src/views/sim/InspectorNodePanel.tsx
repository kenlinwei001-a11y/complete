import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHAIN_NODE_REGISTRY } from "@platform/contracts";
import { runSolver } from "@/api/endpoints";
import type { ViewRendererProps } from "../registry";
import {
  PROVENANCE_LABEL,
  VAR_CLASSES,
  VAR_CLASS_META,
  VAR_CONTROL_BY_CLASS,
  NodeSemanticPayloadSchema,
  buildNodeLiveView,
  buildPlaceholderInspectorInput,
  computeInspectorReadout,
  drillValueText,
  drivesReadout,
  effectiveNumber,
  effectiveOption,
  groupByClass,
  type ChainLossEvidenceRow,
  type InspectorInput,
  type InspectorVariable,
  type NodeLiveView,
  type NodeSemanticPayload,
  type VarClass,
  type VarValues,
  type WaterfallBucket,
} from "./inspectorModel";
// 求解器 key 取既有单源（`chainLineMap.ts` 已为前端登记过一次）——本文件不再写第二遍那个字符串。
import { CHAIN_LOSS_SOLVER_KEY } from "./chainLineMap";
import { SEMANTICS_ORIGIN_NOTE, chainNodeSemantics, chainNodeSemanticsCoverage } from "./chainNodeSemantics";
import styles from "./InspectorNodePanel.module.css";

/**
 * WO-SANDBOX-F4 · 节点检视面板 + 其**宿主视图**（`NodeInspectorView`，本文件默认导出）。
 *
 * ⚠ 接线纪律（收口时补·F3 同款教训）：面板本身是侧栏组件，但 `views/registry.ts` 是**手工登记**
 *    的字符串键表、无自动扫描 —— 只交付面板 = **零生产调用方** = 假绿第 9 形态
 *    `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`（实现有、38 例测试全绿、却没有任何路由渲染得到它）。
 *    故本文件同时给出宿主视图 `NodeInspectorView`（签名 = `Partial<ViewRendererProps>`，
 *    可赋给 `ComponentType<ViewRendererProps>`，注册即不打红构建），并由 `registry.ts`
 *    以键 `node-inspector` 登记。可达门见 `test/node-inspector-reachable.test.tsx`。
 *
 * 三块内容：① 五段耗时瀑布 ② 流动效率读数 ③ 七类变量分组输入。
 *
 * ── 本组件刻意**不做**的事（审核方 2026-08-05 补充约束）───────────────────────
 *  · 不持有任何节点清单 / 节点 ID：`input.node.nodeId` 是不透明键，**从不解析**（零 `split(".")`）。
 *  · 不自己给段分类：五桶按 `ChainStep.kind` 分（S0 冻结），增值判据走契约 `isValueAddKind`。
 *  · 不写第二份除法：前置期 / 增值 / 流动效率全部来自 `nodeLeadTimeDays` / `nodeValueAddDays` /
 *    `nodeFlowEfficiency`（均在 `inspectorModel.ts` 里调用，本文件只负责画）。
 *
 * ── 诚实红线 ─────────────────────────────────────────────────────────────────
 *  · 每个变量都带承载徽标（有/薄/缺）+ 取证；**缺的显示 EMPTY，没有默认值**。
 *  · 不驱动读数的变量（相位 / 零消费方 / 换算缺承载）挂 `data-drives="0"` 并**当面写清原因**——
 *    "拨了没反应"若不解释，就是静默错答；本仓刚坐实过一条死映射让 24 张单里 12 张被静默标错业务线。
 *  · 流动效率读数低（制造业典型 5–15%）是**正常的**，不因"看着难看"改口径；仍有缺席段时额外提示
 *    「分母不含 N 个缺席段 ⇒ 前置期被低估、本读数偏高」。
 *
 * ── 主题 ─────────────────────────────────────────────────────────────────────
 *  零硬编码颜色，全部走 `styles/tokens.css` 的 CSS 变量 ⇒ dark / light / warm 三套自动跟随。
 */

/** 提示条自动消隐（ms）。 */
const HINT_MS = 1500;

const fmtDays = (d: number): string => `${Math.round(d * 100) / 100} 天`;
const fmtPct = (p: number): string => `${Math.round(p * 10) / 10}%`;
const fmtProb = (v: number): string => `${Math.round(v * 1000) / 10}%`;

/** 数值型变量的显示串。`null` ⇒ EMPTY（**绝不显示 0**）。 */
function fmtVarValue(v: InspectorVariable, val: number | null): string {
  if (val === null) return "EMPTY";
  if (VAR_CONTROL_BY_CLASS[v.cls] === "probability") return fmtProb(val);
  const n = Number.isInteger(val) ? String(val) : String(Math.round(val * 100) / 100);
  return v.unit ? `${n} ${v.unit}` : n;
}

function CarrierTag({ carrier }: { carrier: InspectorVariable["carrier"] }) {
  return (
    <em className={styles.carrierTag} data-carrier={carrier} title="契约承载状态：有 = contracts 有承载且有真消费方；薄 = 承载物在但线接得不全；缺 = 今天没有承载物">
      承载 {carrier}
    </em>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ① 五段耗时瀑布
// ══════════════════════════════════════════════════════════════════════════════
function WaterfallRow({ b, leadDays }: { b: WaterfallBucket; leadDays: number }) {
  const width = b.days !== null && leadDays > 0 ? Math.max((b.days / leadDays) * 100, 0.6) : 0;
  // `data-days` 刻意**不四舍五入**：门要断言「Δ等待 == Δ(everyDays)/2」这种精确机理，
  // 预先舍掉的那点误差会把判据松成"大概对"，而"大概对"正是本仓要根治的验收姿势。
  return (
    <li
      className={styles.wfRow}
      data-testid={`insp-wf-${b.kind}`}
      data-kind={b.kind}
      data-value-add={b.valueAdd ? "1" : "0"}
      data-provenance={b.provenance}
      data-days={b.days === null ? "" : String(b.days)}
    >
      <span className={styles.wfLabel}>
        {b.label}
        {b.valueAdd ? <b className={styles.vaBadge}>增值</b> : null}
      </span>
      <span className={styles.wfTrack}>
        {b.days === null ? (
          <i className={styles.wfEmptyTrack} />
        ) : (
          <i className={styles.wfBar} data-testid={`insp-wf-bar-${b.kind}`} data-kind={b.kind} style={{ width: `${width}%` }} />
        )}
      </span>
      <span className={styles.wfNum}>
        {b.days === null ? <b className={styles.emptyValue}>EMPTY</b> : <b className={styles.wfDays}>{fmtDays(b.days)}</b>}
        {b.pctOfLead !== null ? <small className={styles.wfPct}>占前置期 {fmtPct(b.pctOfLead)}</small> : null}
        {b.pctOfChainLoss !== null ? (
          <small className={styles.wfLoss} data-testid={`insp-wf-loss-${b.kind}`}>
            占损失 {fmtPct(b.pctOfChainLoss)}
          </small>
        ) : null}
      </span>
      <em className={styles.provTag} data-prov={b.provenance}>
        {PROVENANCE_LABEL[b.provenance]}
      </em>
      {b.absenceReason ? (
        <small className={styles.wfReason} data-testid={`insp-wf-reason-${b.kind}`}>
          {b.absenceReason}
        </small>
      ) : null}
    </li>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// WO-NODE-SEMANTICS · ③ 节点级流指标 / ④ R13 下钻证据 / ⑤ 跨节点冲突 / ⓪ 节点定位
// ══════════════════════════════════════════════════════════════════════════════

/** 取数状态（宿主给）。**用来当面回答"为什么这里是空的"**，不是拿来兜底填数的。 */
export type LiveLoadState =
  /** 宿主没打算接引擎载荷（独立页默认态）。 */
  | { readonly status: "off" }
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "error"; readonly message: string };

/**
 * ⓪ 节点定位（`pos`）。
 *
 * ⚠ **本节点没写语义 ⇒ `return null`**，不渲染标题、不渲染"暂无"占位。
 *   （注册表正在从 12 扩到 24，扩表后新节点没有语义是常态；渲染一排空壳会让人以为"系统认为它没有冲突"，
 *    而真相是"还没人写"。两件事必须分得开 —— 变异反证 ② 咬的就是这一条。）
 */
function NodePosNote({ nodeId }: { nodeId: string }) {
  const sem = chainNodeSemantics(nodeId);
  if (sem === undefined) return null;
  return (
    <p className={styles.posNote} data-testid="insp-pos" data-origin="editorial">
      <b className={styles.posTag}>节点定位</b>
      {sem.pos}
      <small className={styles.posOrigin}>{SEMANTICS_ORIGIN_NOTE}</small>
    </p>
  );
}

/** ⑤ 跨节点冲突（`cf`）。没写语义 / 写了语义但没有能指出依据的冲突 ⇒ 整块不出现（同上，不留空壳）。 */
function NodeConflictSection({ nodeId }: { nodeId: string }) {
  const sem = chainNodeSemantics(nodeId);
  const cf = sem?.cf ?? [];
  if (cf.length === 0) return null;
  return (
    <section className={styles.section} data-testid="insp-cf" aria-labelledby="insp-cf-h" data-cf-count={String(cf.length)}>
      <h4 className={styles.sectionTitle} id="insp-cf-h">
        ⑤ 跨节点冲突 · 改这里会连累谁
        <small className={styles.sectionSub}>
          编辑口径（人写的，非引擎下发）；**每条逐项附代码依据 file:line**，指不出依据的一条都没写
        </small>
      </h4>
      <ul className={styles.cfList}>
        {cf.map((c) => (
          <li key={c.conflictId} className={styles.cfRow} data-testid={`insp-cf-${c.conflictId}`} data-basis-count={String(c.basis.length)}>
            <span className={styles.cfText}>{c.text}</span>
            <ul className={styles.cfBasis} data-testid={`insp-cf-basis-${c.conflictId}`}>
              {c.basis.map((b) => (
                <li key={b}>
                  <code className={styles.cfBasisCode}>{b}</code>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** ③ 节点级流指标 —— 只出引擎接得到的行；接不到就**不显示**（绝不填设计稿里那些编的数）。 */
function NodeKpiSection({ live, state }: { live: NodeLiveView; state: LiveLoadState }) {
  return (
    <section className={styles.section} data-testid="insp-kpi" aria-labelledby="insp-kpi-h" data-kpi-count={String(live.kpis.length)}>
      <h4 className={styles.sectionTitle} id="insp-kpi-h">
        ③ 节点级流指标 · 引擎真值
        <small className={styles.sectionSub}>
          全部来自 <code>chain_loss_attribution</code> 载荷 + S0 契约函数；接不到的指标**这一行根本不出现**，不填占位数字
        </small>
      </h4>
      {live.kpis.length === 0 ? (
        <p className={styles.emptyNote} data-testid="insp-kpi-empty">
          <b>接不到真值 ⇒ 不显示</b>：{liveGapReason(live, state)}
        </p>
      ) : (
        <ul className={styles.kpiList}>
          {live.kpis.map((k) => (
            <li key={k.kpiId} className={styles.kpiRow} data-testid={`insp-kpi-${k.kpiId}`} data-value={k.value}>
              <span className={styles.kpiLabel}>{k.label}</span>
              <b className={styles.kpiValue}>{k.value}</b>
              <small className={styles.kpiSource}>{k.source}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "为什么这里是空的"——四种成因分开说，混成一句「暂无数据」正是本仓要根治的东西。 */
function liveGapReason(live: NodeLiveView, state: LiveLoadState): string {
  if (state.status === "off") {
    return "宿主没有接引擎载荷（本视图当前只渲染占位输入）。接上 chain_loss_attribution 后本区块自动有值。";
  }
  if (state.status === "loading") return "正在取 chain_loss_attribution 载荷…";
  if (state.status === "error") return `取 chain_loss_attribution 失败：${state.message}`;
  if (!live.present) {
    return "载荷取回来了，但**本节点不在这一次的载荷里**（锚点订单那条链没有经过它）—— 这不是 0，是没有这个节点。";
  }
  return "本节点在载荷里只有诚实缺席行、没有可算的环节 ⇒ 节点级流指标无从谈起（不补 0）。";
}

/**
 * ④ R13 下钻证据 —— **本单最值钱的一块**。
 *
 * 逐条显示 `drillType.drillId.drillField` + `drillValue`（原单位真值）+ 单位 + 换算式。
 * `drillValue` 与 `conversion` **逐字符透传引擎原文**：前端零加法、零换算、零改写。
 * 没有证据的环节显示引擎给的缺载原因原文（`empty[].reason` / `probe`），不空着。
 */
function DrillEvidenceSection({ live, state }: { live: NodeLiveView; state: LiveLoadState }) {
  const rows: readonly ChainLossEvidenceRow[] = live.evidence;
  return (
    <section
      className={styles.section}
      data-testid="insp-drill-evidence"
      aria-labelledby="insp-ev-h"
      data-evidence-count={String(rows.length)}
      data-empty-count={String(live.empty.length)}
    >
      <h4 className={styles.sectionTitle} id="insp-ev-h">
        ④ R13 下钻证据 · 每个天数指回一个真对象的真字段
        <small className={styles.sectionSub}>
          `drillValue` 是**该字段在仓储里的真值本身**（原单位·未换算）；换算成天数由引擎下发的换算式说清，
          前端**原样透出、一个字不改**（改一个字这道门当场红）
          {live.anchorSo === null ? null : <> · 本次锚点单 <code>{live.anchorSo}</code></>}
        </small>
      </h4>

      {rows.length === 0 && live.empty.length === 0 ? (
        <p className={styles.emptyNote} data-testid="insp-drill-none">
          <b>本节点没有下钻证据</b>：{liveGapReason(live, state)}
        </p>
      ) : null}

      {rows.length === 0 ? null : (
        <ul className={styles.evList}>
          {rows.map((e) => (
            <li
              key={e.stepId}
              className={styles.evRow}
              data-testid={`insp-drill-${e.stepId}`}
              data-drill-value={drillValueText(e)}
              data-drill-unit={e.drillUnit}
              data-days={String(e.days)}
              data-value-add={e.valueAdd ? "1" : "0"}
            >
              <span className={styles.evHead}>
                <b className={styles.evLabel}>{e.label}</b>
                <em className={styles.evKind}>{e.kind}</em>
                {e.valueAdd ? <b className={styles.vaBadge}>增值</b> : null}
                <span className={styles.evDays}>{fmtDays(e.days)}</span>
              </span>
              <code className={styles.evTriple} data-testid={`insp-drill-triple-${e.stepId}`}>
                {e.drillType}.{e.drillId}.{e.drillField}
              </code>
              <span className={styles.evValueRow}>
                <span className={styles.evValueLabel}>字段真值</span>
                <b className={styles.evValue} data-testid={`insp-drill-value-${e.stepId}`}>
                  {drillValueText(e)}
                </b>
                <em className={styles.evUnit} data-testid={`insp-drill-unit-${e.stepId}`} title="引擎侧的单位枚举，原样透出（前端不复写词表、不据它换算）">
                  {e.drillUnit}
                </em>
              </span>
              <code className={styles.evConversion} data-testid={`insp-drill-conversion-${e.stepId}`}>
                {e.conversion}
              </code>
              {e.derivationEdge === "" ? null : (
                <small className={styles.evEdge} data-testid={`insp-drill-edge-${e.stepId}`}>
                  派生边：{e.derivationEdge}
                </small>
              )}
              <small className={styles.evSolver}>算出它的求解器：{e.solverKey}</small>
            </li>
          ))}
        </ul>
      )}

      {live.empty.length === 0 ? null : (
        <ul className={styles.evList} data-testid="insp-drill-empty-list">
          {live.empty.map((e) => (
            <li key={e.stepId} className={styles.evEmptyRow} data-testid={`insp-drill-empty-${e.stepId}`} data-empty-kind={e.emptyKind}>
              <span className={styles.evHead}>
                <b className={styles.evLabel}>{e.label}</b>
                <em className={styles.evKind}>{e.kind}</em>
                <b className={styles.emptyValue}>EMPTY</b>
                <em className={styles.evEmptyKind}>{e.emptyKind}</em>
              </span>
              <small className={styles.evReason}>{e.reason}</small>
              {e.probe === undefined ? null : <small className={styles.evProbe}>取证：{e.probe}</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ 七类变量输入 —— 每类一种控件（S 类**绝不**渲染 input[type=range]）
// ══════════════════════════════════════════════════════════════════════════════
interface VarRowProps {
  v: InspectorVariable;
  values: VarValues;
  disabled: boolean;
  inapplicable: boolean;
  onNumber: (varId: string, next: number | null) => void;
  onOption: (varId: string, next: string) => void;
}

function VarRow({ v, values, disabled, inapplicable, onNumber, onOption }: VarRowProps) {
  const control = VAR_CONTROL_BY_CLASS[v.cls];
  const drives = drivesReadout(v) && !inapplicable; // ← 判据在模型里只有一份
  const numVal = control === "discrete" ? null : effectiveNumber(v, values);
  const optVal = control === "discrete" ? effectiveOption(v, values) : null;
  const locked = disabled || inapplicable;

  return (
    <li
      className={styles.varRow}
      data-testid={`insp-var-${v.varId}`}
      data-cls={v.cls}
      data-control={control}
      data-carrier={v.carrier}
      data-drives={drives ? "1" : "0"}
      data-inapplicable={inapplicable ? "1" : "0"}
      data-disabled={locked ? "1" : "0"}
    >
      <div className={styles.varHead}>
        <span className={styles.varLabel}>{v.label}</span>
        <CarrierTag carrier={v.carrier} />
        {control === "discrete" ? null : (
          <b className={numVal === null ? styles.emptyValue : styles.varValue} data-testid={`insp-val-${v.varId}`}>
            {fmtVarValue(v, numVal)}
          </b>
        )}
      </div>

      {/* R 类：必须引规则码——面板上要看得见改的是哪条规则的哪个 param。 */}
      {control === "rule-param" && v.ruleRef ? (
        <div className={styles.ruleRef} data-testid={`insp-rule-${v.varId}`} data-rule-key={v.ruleRef.ruleKey} data-rule-param={v.ruleRef.param}>
          <b className={styles.ruleKey}>{v.ruleRef.ruleKey}</b>
          <span className={styles.ruleParam}>
            params.<b>{v.ruleRef.param}</b>
          </span>
          <code className={styles.rulePath}>{v.ruleRef.path}</code>
          <small className={styles.ruleNote}>{v.ruleRef.note}</small>
        </div>
      ) : null}

      {/* 控件本体 */}
      {control === "discrete" ? (
        <div className={styles.optionSet} role="radiogroup" aria-label={v.label} data-testid={`insp-options-${v.varId}`}>
          {(v.options ?? []).map((o) => {
            const on = optVal === o.optionId;
            return (
              <button
                key={o.optionId}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked}
                className={styles.optionBtn}
                data-testid={`insp-opt-${v.varId}-${o.optionId}`}
                data-selected={on ? "1" : "0"}
                onClick={() => onOption(v.varId, o.optionId)}
                title={o.note}
              >
                <span className={styles.optionLabel}>{o.label}</span>
                <small className={styles.optionNote}>{o.note}</small>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={styles.sliderRow}>
          {/* 无值（EMPTY）时滑块只能停在 min 上，视觉上像"值就是最小值"。
              `aria-valuetext` 把真相说出来：**没有值**，不是最小值。 */}
          <input
            type="range"
            className={styles.slider}
            data-testid={`insp-input-${v.varId}`}
            aria-label={v.label}
            aria-valuetext={numVal === null ? "EMPTY（无契约承载，尚未取值）" : fmtVarValue(v, numVal)}
            disabled={locked}
            min={v.domain?.min ?? 0}
            max={v.domain?.max ?? 1}
            step={v.domain?.step ?? 0.01}
            value={numVal ?? v.domain?.min ?? 0}
            onChange={(e) => onNumber(v.varId, Number(e.target.value))}
          />
          <span className={styles.sliderScale}>
            <small>{v.domain?.min ?? 0}</small>
            <small>{v.domain?.max ?? 1}</small>
          </span>
        </div>
      )}

      {/* 诚实位：缺承载 / 不驱动读数 / 本拓扑下不适用 —— 三种都必须当面说清 */}
      {v.carrier === "缺" && numVal === null && control !== "discrete" ? (
        <p className={styles.emptyNote} data-testid={`insp-empty-${v.varId}`}>
          <b>EMPTY</b>：今天无契约承载，<b>不给默认值</b>。滑杆仍可拨，拨出来的一律标 what-if 试算，不冒充实测。
        </p>
      ) : null}
      {v.carrier === "缺" && control === "discrete" && optVal === null ? (
        <p className={styles.emptyNote} data-testid={`insp-empty-${v.varId}`}>
          <b>EMPTY</b>：今天无契约承载，<b>初始不选任何分支</b>。选中即视为 what-if 试算。
        </p>
      ) : null}
      {!drivesReadout(v) && v.inertReason ? (
        <p className={styles.inertNote} data-testid={`insp-inert-${v.varId}`}>
          <b>不驱动读数</b>：{v.inertReason}
        </p>
      ) : null}
      {inapplicable ? (
        <p className={styles.inertNote} data-testid={`insp-inapplicable-${v.varId}`}>
          <b>本拓扑下不适用</b>：它作用的那一段在当前 S 类分支里不存在（换个结构分支即恢复）。
        </p>
      ) : null}
      <p className={styles.evidence} data-testid={`insp-evidence-${v.varId}`}>
        {v.evidence}
      </p>
    </li>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 面板
// ══════════════════════════════════════════════════════════════════════════════
export interface InspectorNodePanelProps {
  input: InspectorInput;
  /** 推演进行中 ⇒ **所有调参控件置灰**（仓主明确要求：在跑的时候，调参为灰色）。 */
  running?: boolean;
  /** 值变化回调（面板自持状态；此回调只用于把值透出去给主视图/引擎）。 */
  onValuesChange?: (values: VarValues) => void;
  /**
   * WO-NODE-SEMANTICS：引擎载荷在本节点上的投影（R13 证据 / 诚实缺席 / 节点级流指标）。
   * 缺省 = 宿主没接载荷 ⇒ 这两块显式说明"为什么是空的"，**不填占位数字**。
   */
  live?: NodeLiveView | null;
  /** 载荷取数状态（用来当面回答"为什么这里是空的"）。 */
  liveState?: LiveLoadState;
}

const LIVE_OFF: LiveLoadState = { status: "off" };

export function InspectorNodePanel({ input, running = false, onValuesChange, live, liveState = LIVE_OFF }: InspectorNodePanelProps) {
  const [values, setValues] = useState<VarValues>({});
  const [hint, setHint] = useState<string | null>(null);

  /**
   * 定时器纪律（本仓刚修过 4 处「覆盖 ref 漏清 → 孤儿定时器 → 整包随机红」）：
   * 这个 ref 只存得下一个 handle，**覆盖前必须先 clear**；卸载时也清。
   */
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHintTimer = useCallback(() => {
    if (hintTimerRef.current !== null) {
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
  }, []);
  const flashHint = useCallback(
    (text: string) => {
      clearHintTimer(); // ← 覆盖 ref 前先清，绝不让上一个 handle 变孤儿
      setHint(text);
      hintTimerRef.current = setTimeout(() => {
        hintTimerRef.current = null;
        setHint(null);
      }, HINT_MS);
    },
    [clearHintTimer],
  );
  useEffect(() => clearHintTimer, [clearHintTimer]); // 卸载清

  const commit = useCallback(
    (next: VarValues) => {
      setValues(next);
      onValuesChange?.(next);
    },
    [onValuesChange],
  );

  /**
   * 推演进行中的**双保险**：控件已经 `disabled`（视觉+可达性），这里再挡一道逻辑闸。
   * 只靠 `disabled` 属性是不够的——程序化派发的 change/click 照样能打进 React 的合成事件，
   * 于是"看着是灰的、其实改得动"。跑的过程中改参数会让「这一版读数对应哪一版入参」说不清，
   * 所以宁可在数据入口处拒绝。
   */
  const onNumber = useCallback(
    (varId: string, next: number | null) => {
      if (running) return;
      commit({ ...values, [varId]: next });
    },
    [commit, running, values],
  );
  const onOption = useCallback(
    (varId: string, next: string) => {
      if (running) return;
      commit({ ...values, [varId]: next });
      flashHint("结构分支已切换 —— 段集变了，不是某个数变大了");
    },
    [commit, flashHint, running, values],
  );
  const onReset = useCallback(() => {
    if (running) return;
    commit({});
    flashHint("已复位到基线（缺承载的变量回到 EMPTY，不回到 0）");
  }, [commit, flashHint, running]);

  const readout = useMemo(() => computeInspectorReadout(input, values), [input, values]);
  const groups = useMemo(() => groupByClass(input.variables), [input.variables]);
  const inapplicable = useMemo(() => new Set(readout.inapplicableVarIds), [readout.inapplicableVarIds]);
  // 宿主没给投影 ⇒ 造一份"全空"的（`present:false`），让下游一律走同一条渲染路径，不再各处 if。
  const liveView = useMemo(() => live ?? buildNodeLiveView(input.node.nodeId, null), [live, input.node.nodeId]);

  const flowPct = readout.flowEfficiency === null ? null : readout.flowEfficiency * 100;

  return (
    <aside className={styles.panel} data-testid="insp-panel" data-running={running ? "1" : "0"} aria-label="节点检视">
      <header className={styles.head}>
        <div className={styles.headMain}>
          <h3 className={styles.title} data-testid="insp-title">
            {input.node.label}
          </h3>
          {/* nodeId 是不透明键：原样显示，**不解析、不拆段** */}
          <code className={styles.nodeId} data-testid="insp-node-id">
            {input.node.nodeId}
          </code>
          <em className={styles.stage} data-testid="insp-stage">
            {input.node.stage}
          </em>
        </div>
        <button type="button" className={styles.resetBtn} data-testid="insp-reset" disabled={running} onClick={onReset}>
          复位基线
        </button>
      </header>

      {running ? (
        <p className={styles.runningBanner} data-testid="insp-running-banner" role="status">
          <b>推演进行中</b>：调参控件已全部置灰。跑的过程中改参数会让「这一版读数对应哪一版入参」说不清，
          所以宁可禁用——等本轮跑完再调。
        </p>
      ) : null}

      {input.dataMode === "PLACEHOLDER" ? (
        <p className={styles.placeholderBanner} data-testid="insp-placeholder-banner" role="note">
          <b>段耗时为占位值（未接真实数据）</b>：{input.placeholderNote}
        </p>
      ) : null}

      {hint ? (
        <p className={styles.hint} data-testid="insp-hint" role="status">
          {hint}
        </p>
      ) : null}

      {/* ── ⓪ 节点定位（pos）· 编辑口径，非引擎下发；没写语义的节点整块不出现 ─── */}
      <NodePosNote nodeId={input.node.nodeId} />

      {/* ── ① 五段耗时瀑布 ───────────────────────────────────────────────── */}
      <section className={styles.section} data-testid="insp-waterfall" aria-labelledby="insp-wf-h">
        <h4 className={styles.sectionTitle} id="insp-wf-h">
          ① 五段耗时瀑布
          <small className={styles.sectionSub}>本节点前置期 = 五段之和；五段与"哪种算增值"均由 S0 契约冻结，前端不另立口径（全链口径分交付前置期 / 现金周转期两个，见控制台顶栏）</small>
        </h4>
        <ul className={styles.wfList}>
          {readout.buckets.map((b) => (
            <WaterfallRow key={b.kind} b={b} leadDays={readout.leadTimeDays} />
          ))}
        </ul>
      </section>

      {/* ── ② 流动效率读数 ───────────────────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="insp-fe-h">
        <h4 className={styles.sectionTitle} id="insp-fe-h">
          ② 流动效率
          <small className={styles.sectionSub}>流动效率 = 增值 ÷ 本节点前置期（制造业典型 5–15%，读数低是正常的）</small>
        </h4>
        <div
          className={styles.flowBox}
          data-testid="insp-flow-eff"
          data-flow-efficiency={flowPct === null ? "" : String(flowPct)}
          data-lead-days={String(readout.leadTimeDays)}
          data-value-days={String(readout.valueAddDays)}
          data-absent={String(readout.absentCount)}
          data-whatif={String(readout.whatIfCount)}
        >
          <b className={flowPct === null ? styles.emptyValue : styles.flowValue}>{flowPct === null ? "EMPTY" : fmtPct(flowPct)}</b>
          <span className={styles.flowFormula}>
            = 增值 <b>{fmtDays(readout.valueAddDays)}</b> ÷ 本节点前置期 <b>{fmtDays(readout.leadTimeDays)}</b>
          </span>
        </div>
        {readout.absentCount > 0 ? (
          <p className={styles.warnNote} data-testid="insp-flow-absent">
            <b>本读数偏高</b>：仍有 <b>{readout.absentCount}</b> 段诚实缺席未计入分母 ⇒ 本节点前置期被低估、流动效率被高估。
            补上承载物之前，<b>不要拿这个数对外报</b>。
          </p>
        ) : null}
        {readout.whatIfCount > 0 ? (
          <p className={styles.warnNote} data-testid="insp-flow-whatif">
            <b>含 what-if</b>：{readout.whatIfCount} 段的天数来自试算而非实测。
          </p>
        ) : null}
      </section>

      {/* ── ③ 节点级流指标（引擎真值；接不到就不显示）───────────────────── */}
      <NodeKpiSection live={liveView} state={liveState} />

      {/* ── ④ R13 下钻证据（drillValue / conversion 逐字符透传）─────────── */}
      <DrillEvidenceSection live={liveView} state={liveState} />

      {/* ── ⑤ 跨节点冲突（编辑口径 + file:line 依据；没依据的不写）───────── */}
      <NodeConflictSection nodeId={input.node.nodeId} />

      {/* ── ⑥ 七类变量分组输入 ───────────────────────────────────────────── */}
      <section className={styles.section} data-testid="insp-variables" aria-labelledby="insp-var-h">
        <h4 className={styles.sectionTitle} id="insp-var-h">
          ⑥ 变量输入 · 七类
          <small className={styles.sectionSub}>七类推演机理不同 ⇒ 控件不同。S 类是离散分支换拓扑，不是滑杆</small>
        </h4>
        {groups.map(({ cls, vars }) => (
          <div key={cls} className={styles.group} data-testid={`insp-group-${cls}`} data-cls={cls} data-control={VAR_CONTROL_BY_CLASS[cls]}>
            <div className={styles.groupHead}>
              <b className={styles.groupTitle}>{VAR_CLASS_META[cls].label}</b>
              <small className={styles.groupMech}>{VAR_CLASS_META[cls].mechanism}</small>
            </div>
            {vars.length === 0 ? (
              <p className={styles.emptyNote} data-testid={`insp-group-empty-${cls}`}>
                本节点没有这一类变量（不是隐藏了，是真没有）。
              </p>
            ) : (
              <ul className={styles.varList}>
                {vars.map((v) => (
                  <VarRow
                    key={v.varId}
                    v={v}
                    values={values}
                    disabled={running}
                    inapplicable={inapplicable.has(v.varId)}
                    onNumber={onNumber}
                    onOption={onOption}
                  />
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>
    </aside>
  );
}

/** 供主视图判定"这一类该画什么控件"，避免消费方各写一份 switch。 */
export const inspectorControlOf = (cls: VarClass): string => VAR_CONTROL_BY_CLASS[cls];
export { VAR_CLASSES };

// ══════════════════════════════════════════════════════════════════════════════
// 宿主视图 —— 这是本面板**唯一的生产调用方**（经 registry.ts 的 `node-inspector` 键）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 节点检视视图：选一个全链节点 → 渲染它的五段瀑布 / 流动效率 / 七类变量。
 *
 * **节点清单派生自 `CHAIN_NODE_REGISTRY`（contracts 单源），不内联**——这是本视图的 SEAM 咬点：
 * 改注册表 → 下拉选项跟着变（证明是派生不是手抄）。
 *
 * ⚠ 该注册表是 **S0 之后补的**：F4 施工时它还不存在（`inspectorModel.ts` 顶注当时写的
 *    "无 ID 单源注册表" 是那一刻的实情），合并 `wave4-integration` 后已由
 *    `packages/contracts/src/chain-sim.ts:135` 提供。面板本身仍**不持有**任何节点清单
 *    （`InspectorInput` 由调用方给），持有清单的是本宿主视图 —— 这正是当初的设计意图。
 *
 * ⚠ 诚实边界：段耗时今天是 `buildPlaceholderInspectorInput` 的 seed 派生**占位值**（可复现·非实测），
 *    面板已挂常驻 `PLACEHOLDER` 横幅。接引擎真值是 W4·G1 的活，本视图**不冒充 LIVE**。
 */
/**
 * WO-SANDBOX-CONSOLE 追加的**可选** prop（默认值 = 今天的行为，独立页 `/v/node-inspector` 零回归）：
 *  · `selectedNodeId` —— 受控节点（控制台点画布卡片 / 点 Pareto 柱 → 右栏跟着切）。
 *    传了就以它为准；**不在册的 id 一律忽略**（保持"不在前端编一个自由串"这条）。
 *  · `onNodeIdChange` —— 下拉切换时回抛，宿主可与画布选中态同步。
 *  · `chrome="embedded"` —— 300px 侧栏里渲染时折掉那句长来源说明（下拉与面板本体不动）。
 */
/**
 * WO-NODE-SEMANTICS 追加：
 *  · `lossPayload` —— 宿主**已经取回**的 `chain_loss_attribution` 载荷。
 *    传了就直接用，本视图**不再自取**（"同一个问题不问两遍"）。
 *  · 没传时本视图自取一次（`{}` 无参 = 引擎按 `so` 字典序选锚点，R6 确定性）。
 *    这条自取路径是为了让 R13 下钻证据在**今天**就能上屏 —— 控制台右栏这一格今天拿不到宿主的载荷
 *    （`SandboxConsole` 把载荷留在自己 state 里，本单不碰那个文件）。代价明写在屏上，
 *    宿主一旦接上 `lossPayload`，这一次请求当场消失。
 */
export interface NodeInspectorExtraProps {
  selectedNodeId?: string;
  onNodeIdChange?: (nodeId: string) => void;
  chrome?: "full" | "embedded";
  lossPayload?: unknown;
}

/** 载荷取数（宿主没给才自取）。**无 debounce、无定时器**——一次性拉，卸载即 abort。 */
function useChainLossPayload(injected: unknown): { payload: NodeSemanticPayload | null; state: LiveLoadState } {
  const hasInjected = injected !== undefined && injected !== null;
  const [state, setState] = useState<LiveLoadState>(hasInjected ? { status: "ready" } : { status: "loading" });
  const [fetched, setFetched] = useState<NodeSemanticPayload | null>(null);

  useEffect(() => {
    if (hasInjected) return;
    let cancelled = false;
    const ac = new AbortController();
    setState({ status: "loading" });
    runSolver(CHAIN_LOSS_SOLVER_KEY, {}, ac.signal).then(
      (raw) => {
        if (cancelled) return;
        const parsed = NodeSemanticPayloadSchema.safeParse((raw as { data?: unknown })?.data ?? raw);
        if (!parsed.success) {
          // 形状不合契约 ⇒ 报出来，**不猜、不补字段**（S0 冻结的意义就在这）。
          setState({ status: "error", message: `载荷形状不合契约：${parsed.error.issues.map((i) => i.message).join(" · ")}` });
          return;
        }
        setFetched(parsed.data);
        setState({ status: "ready" });
      },
      (e: unknown) => {
        if (cancelled) return;
        // 刻意**不弹 toast**：本区块只是右栏的一格，取不到就当面把原因写在这一格里，
        // 不去打扰整页（也避免在测试里制造全局 toast 状态污染）。
        const msg = e instanceof Error ? e.message : JSON.stringify(e);
        setState({ status: "error", message: msg });
      },
    );
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [hasInjected]);

  const injectedParsed = useMemo(() => {
    if (!hasInjected) return null;
    const parsed = NodeSemanticPayloadSchema.safeParse(injected);
    return parsed.success ? parsed.data : null;
  }, [hasInjected, injected]);

  return { payload: hasInjected ? injectedParsed : fetched, state };
}

export function NodeInspectorView({
  view,
  selectedNodeId,
  onNodeIdChange,
  chrome = "full",
  lossPayload,
}: Partial<ViewRendererProps> & NodeInspectorExtraProps) {
  const nodes = CHAIN_NODE_REGISTRY;
  const { payload, state: liveState } = useChainLossPayload(lossPayload);
  // 初始节点：`view.options.nodeId` 指定即用它（且必须在册），否则取册首。**不在前端编一个自由串。**
  const requested = (view?.options as { nodeId?: unknown } | undefined)?.nodeId;
  const initial = typeof requested === "string" && nodes.some((n) => n.nodeId === requested) ? requested : (nodes[0]?.nodeId ?? "");
  const [uncontrolled, setUncontrolled] = useState(initial);
  // 受控优先，但**必须在册**：宿主传了个不在册的 id ⇒ 忽略并退回内部态（不造占位节点）。
  const controlled = typeof selectedNodeId === "string" && nodes.some((n) => n.nodeId === selectedNodeId) ? selectedNodeId : null;
  const nodeId = controlled ?? uncontrolled;
  const setNodeId = (next: string) => {
    setUncontrolled(next);
    onNodeIdChange?.(next);
  };

  const def = useMemo(() => nodes.find((n) => n.nodeId === nodeId) ?? nodes[0], [nodes, nodeId]);
  const input = useMemo(
    () => (def === undefined ? null : buildPlaceholderInspectorInput({ nodeId: def.nodeId, label: def.label, stage: def.stage })),
    [def],
  );
  // 引擎载荷在**当前这个节点**上的投影（R13 证据 / 诚实缺席 / 节点级流指标）。
  const live = useMemo(() => (def === undefined ? null : buildNodeLiveView(def.nodeId, payload)), [def, payload]);
  const coverage = useMemo(() => chainNodeSemanticsCoverage(), []);

  if (input === null) {
    // 注册表空 ⇒ 没有节点可检视。**不造一个占位节点**（那正是"看着合理的默认值"式静默兜底）。
    return (
      <div className={styles.hostRoot} data-testid="node-inspector-root">
        <p className={styles.emptyNote} data-testid="node-inspector-empty">
          <b>EMPTY</b>：`CHAIN_NODE_REGISTRY` 为空 —— 今天没有任何在册全链节点可检视，<b>不造占位节点</b>。
        </p>
      </div>
    );
  }

  return (
    <div className={styles.hostRoot} data-testid="node-inspector-root" data-chrome={chrome}>
      <header className={styles.hostBar}>
        <label className={styles.hostPick} htmlFor="node-inspector-pick">
          检视节点
        </label>
        <select
          id="node-inspector-pick"
          className={styles.hostSelect}
          data-testid="node-inspector-select"
          value={def!.nodeId}
          onChange={(e) => setNodeId(e.target.value)}
        >
          {nodes.map((n) => (
            <option key={n.nodeId} value={n.nodeId} data-testid={`node-inspector-opt-${n.nodeId}`}>
              {n.label}
            </option>
          ))}
        </select>
        <small className={styles.hostNote} data-testid="node-inspector-source">
          {chrome === "embedded" ? (
            <>清单源 <code>CHAIN_NODE_REGISTRY</code> · {nodes.length} 节点</>
          ) : (
            <>节点清单派生自 <code>CHAIN_NODE_REGISTRY</code>（contracts 单源 · 共 {nodes.length} 个在册节点），前端不另维护一份</>
          )}
        </small>
        <small
          className={styles.hostNote}
          data-testid="node-inspector-semantics-coverage"
          data-with-semantics={String(coverage.withSemantics)}
          data-registered={String(coverage.registered)}
        >
          节点语义（定位 / 跨节点冲突）覆盖 {coverage.withSemantics}/{coverage.registered} 个在册节点；
          {coverage.missing.length === 0
            ? "已全覆盖"
            : `尚未写语义的 ${coverage.missing.length} 个（${coverage.missing.join(" / ")}）在屏上**整块不出现**，不留空壳`}
        </small>
        <small className={styles.hostNote} data-testid="node-inspector-live-cost">
          {lossPayload === undefined
            ? "本区块的 R13 证据由本视图自取一次 chain_loss_attribution（宿主接上 lossPayload 后这次请求即消失）"
            : "R13 证据复用宿主已取回的那一份 chain_loss_attribution —— 未发第二次请求"}
        </small>
      </header>
      <InspectorNodePanel input={input} live={live} liveState={liveState} />
    </div>
  );
}

export default NodeInspectorView;
