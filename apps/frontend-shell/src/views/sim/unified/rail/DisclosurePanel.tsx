/**
 * ══ WO-SIM-DISCLOSURE · 推演过程披露面板（铁律 1.5 判据二的屏上落点）══════════════
 *
 * 判据原文（一字不改）：
 * > 凡对外宣称「推演」的结果，必须能逐项列出：**引用的数据**（对象类型 + 条数 + 快照版本）·
 * > **走过的本体切片**（sliceKey + 跳数 + 节点/边数）· **命中的规则**（规则 key + 系数 +
 * > 内联常数还是配置来源）· **约束**（阈值来自哪条规则表达式）· **agent 是否参与** ·
 * > **各环节耗时**。
 * > **判据：一个看不到代码的人，读完这一层应当能自己判断「这是真推演还是查表」。**
 *
 * 六项在本文件里就是六个 `<section>`，顺序与判据原文逐字对齐（① … ⑥）。
 *
 * ── 三条文体硬约束（仓主明令·违反即返工）────────────────────────────────────
 *  ① **屏上不许出现描述性句子**，只给「标签 + 值 + 状态」。
 *     合格：`切片 GLOBAL · 跳数 1 · 节点 12,745 · 边 12,192`
 *     不合格：「本次推演沿全局切片走了一跳，共涉及…」
 *     ⇒ 本文件里**没有一个渲染出去的完整句子**；所有文案都是 `<span 标签><span 值>` 对。
 *  ② **屏上不许出现 Markdown 字面量**（`**粗体**` / 反引号）。
 *  ③ **不许打源码文件名 / 行号到用户屏上**（R-UI-4）。
 *
 * ── ⚠ 为什么 `constraints.stateVarBounds[].source` **不上屏**（这是个判断，不是遗漏）──
 * 后端那一栏是**散文出处**，实测（2026-09-03 · demo 租户 seed 世界一拍，32 条取值域）：
 *   · 每条含 **6 个反引号**、**0 个** `**` —— 反引号直出就是上面第 ② 条禁止的 Markdown 字面量，
 *     而全仓今天唯一被批准的原文渲染出口 `decisionConsoleModel.parseEmphasis` **只认 `**`**，
 *     不认反引号 ⇒ 拿它渲染，反引号照样打在屏上。为这一栏另造一个 markdown 渲染器 =
 *     给同一件事造第二个出处，本单不做。
 *   · 且它本身就是**成句的散文**（「压力族 0–100：① … 段头「状态变量的量纲各不相同…」；② …」），
 *     直接撞第 ① 条。
 * 而**铁律 1.5 对 ④ 的原文要求是「阈值来自哪条规则表达式」** —— 那一问的答案是
 * `decayRef`（`C35.pressureDecayPerTick`）与 `decayRuleExpression`
 * （`SimStateVar.decayPerTick == params.pressureDecayPerTick`），两者都干净、都上屏了。
 * 散文 `source` 不是那一问的答案，**只是额外的颜色**；它仍在回包里，一个字节没删。
 *
 * ── ⚠ 「没取到」与「取到了但是零」必须分开讲 ─────────────────────────────────
 * `disclosure === undefined`（没要 / 后端没给）⇒ 屏上写「本次未取到披露层」，
 * **不许**渲染成一片 0 —— 那会让「引擎没跑」与「披露没要」在屏上长成同一个样子，
 * 正是本仓「静默错答」要根治的形态。
 */
import type { SimRunDisclosure } from "@platform/contracts";
import styles from "./DisclosurePanel.module.css";

/** 千分位。读数是给人看的，`12745` 与 `12,745` 在一列数字里差别很大。 */
const n = (v: number): string => v.toLocaleString("zh-CN");

/**
 * 环节键 → 屏上的名字。
 *
 * 后端的键是 `graph` / `shadow` / `engine` / `persist` / `total` —— 那是**开发的话**，
 * R-UI-4 明令不上屏。语义取自契约 `SimDisclosureTimingSchema.phase` 的原文注释，
 * 不是本文件发明的说法。表里没有的键**原样显示**（宁可露出一个机器键，
 * 也不静默丢掉一个环节的耗时 —— 丢掉的那一段正是最该被看见的）。
 */
const PHASE_LABEL: Readonly<Record<string, string>> = {
  graph: "入参装配",
  shadow: "影子线重放",
  engine: "传导",
  persist: "落盘",
  total: "合计",
};

/** 一对「标签 值」。**没有句子**，标点只有分隔用的 `·`。 */
function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }): JSX.Element {
  return (
    <>
      <span className={styles.k}>{k} </span>
      <span className={`${styles.v} ${mono === true ? styles.mono : ""}`}>{v}</span>
    </>
  );
}

const SEP = <span className={styles.k}> · </span>;

export interface DisclosurePanelProps {
  /** 本次推进的披露层。`undefined` = 没取到（与「取到了但是零」是两件事）。 */
  readonly disclosure?: SimRunDisclosure;
}

export default function DisclosurePanel({ disclosure: d }: DisclosurePanelProps): JSX.Element | null {
  if (d === undefined) return null;

  const { data, slice, rules, constraints, agent, timings } = d;

  return (
    <details className={styles.wrap} data-testid="sim-disclosure">
      <summary data-testid="sim-disclosure-summary">
        推演过程 · 第 {n(d.fromTick)} → {n(d.toTick)} 拍
      </summary>
      <div className={styles.body}>
        {/* ── ① 引用的数据 ───────────────────────────────────────────────── */}
        <section className={styles.sec} data-testid="sim-disclosure-data">
          <p className={styles.secHead}>引用的数据</p>
          <p className={styles.kv}>
            <KV k="对象" v={n(data.objects)} />
            {SEP}
            <KV k="关系" v={n(data.links)} />
            {SEP}
            <KV k="对象类型" v={n(data.types.length)} />
            {SEP}
            <KV k="关系类型" v={n(data.linkTypes.length)} />
          </p>
          <p className={styles.kv}>
            <KV k="快照版本" v={data.snapshotVersion} mono />
          </p>
          {data.types.length === 0 ? null : (
            <details className={styles.more}>
              <summary data-testid="sim-disclosure-types-toggle">逐对象类型条数</summary>
              <ul className={styles.rows} data-testid="sim-disclosure-types">
                {data.types.map((t) => (
                  <li key={t.typeKey} className={styles.row}>
                    <span className={styles.mono}>{t.typeKey}</span>
                    <span className={styles.v}>{n(t.count)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {data.linkTypes.length === 0 ? null : (
            <details className={styles.more}>
              <summary data-testid="sim-disclosure-linktypes-toggle">逐关系类型条数</summary>
              <ul className={styles.rows} data-testid="sim-disclosure-linktypes">
                {data.linkTypes.map((t) => (
                  <li key={t.linkKey} className={styles.row}>
                    <span className={styles.mono}>{t.linkKey}</span>
                    <span className={styles.v}>{n(t.count)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* ── ② 走过的本体切片 ───────────────────────────────────────────── */}
        <section className={styles.sec} data-testid="sim-disclosure-slice">
          <p className={styles.secHead}>走过的本体切片</p>
          <p className={styles.kv}>
            <KV k="切片" v={slice.sliceKey} mono />
            {SEP}
            <KV k="跳数" v={n(slice.hops)} />
            {SEP}
            <KV k="节点" v={n(slice.nodes)} />
            {SEP}
            <KV k="边" v={n(slice.edges)} />
          </p>
          <p className={styles.kv}>
            <KV k="裁掉节点" v={n(slice.droppedNodes)} />
            {SEP}
            <KV k="裁掉边" v={n(slice.droppedEdges)} />
            {slice.target === null ? null : (
              <>
                {SEP}
                <KV k="落点类型" v={slice.target} mono />
              </>
            )}
          </p>
          {/* 范围拿不到 ⇒ 本次传导图为空。**不许**被读成「局部等于全局」。 */}
          {slice.unresolved === null ? null : (
            <p className={styles.warn} data-testid="sim-disclosure-slice-unresolved">
              <KV k="范围未解析" v={slice.unresolved} />
            </p>
          )}
        </section>

        {/* ── ③ 命中的规则 ───────────────────────────────────────────────── */}
        <section className={styles.sec} data-testid="sim-disclosure-rules">
          <p className={styles.secHead}>命中的规则</p>
          <p className={styles.kv}>
            <KV k="喂入" v={n(rules.declared)} />
            {SEP}
            <KV k="命中" v={n(rules.fired)} />
            {SEP}
            {/* 「这一拍真的沿几条边传了值」——随扰动变的那个量，与 `slice.edges` 不是一回事。 */}
            <KV k="本拍传导" v={`${n(rules.contributions)} 条`} />
            {SEP}
            <KV k="扰动写入" v={`${n(rules.perturbationWrites)} 条`} />
          </p>
          <p className={styles.kv}>
            <KV k="系数来自配置" v={n(rules.withCoefficientRef)} />
            {SEP}
            <KV k="系数内联" v={n(rules.declared - rules.withCoefficientRef)} />
            {SEP}
            <KV k="引用失效回落" v={n(rules.refUnresolved)} />
            {SEP}
            <KV k="逐实例分摊" v={n(rules.withWeightRef)} />
          </p>
          {/* 声明了分摊口径却整张权重表都拿不到 ⇒ 那条规则本拍**不传导**。必须点名。 */}
          {rules.unresolvedWeights.length === 0 ? null : (
            <details className={styles.more}>
              <summary className={styles.warn} data-testid="sim-disclosure-unresolved-weights-toggle">
                分摊表算不出 · {n(rules.unresolvedWeights.length)} 条
              </summary>
              <ul className={styles.rows} data-testid="sim-disclosure-unresolved-weights">
                {rules.unresolvedWeights.map((u) => (
                  <li key={`${u.ruleKey}/${u.basis}`} className={styles.row}>
                    <span className={styles.mono}>{u.ruleKey}</span>
                    <span className={styles.mono}>{u.basis}</span>
                    <span>{u.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {rules.items.length === 0 ? null : (
            <details className={styles.more}>
              <summary data-testid="sim-disclosure-rule-items-toggle">逐规则系数与口径</summary>
              <ul className={styles.rows} data-testid="sim-disclosure-rule-items">
                {rules.items.map((r) => (
                  <li key={r.ruleKey} className={styles.row} data-fired={r.fired ? "1" : "0"}>
                    <span className={styles.tag}>{r.fired ? "命中" : "未命中"}</span>
                    <span className={styles.mono}>{r.ruleKey}</span>
                    <KV k="系数" v={String(r.coefficient)} />
                    {/* 「声明了引用」≠「系数来自配置」：引用取不到时引擎回落内联，这里按**解析结果**说。 */}
                    <span className={styles.tag}>
                      {r.coefficientSource === "CONFIG_REF" ? "来自配置" : "内联常数"}
                    </span>
                    {r.coefficientRef === null ? null : <KV k="引用" v={r.coefficientRef} mono />}
                    {r.refUnresolved ? <span className={styles.tag}>引用失效已回落</span> : null}
                    {r.weightBasis === null ? null : <KV k="权重口径" v={r.weightBasis} mono />}
                    {r.weightNormalize === null ? null : <KV k="归一" v={r.weightNormalize} mono />}
                    {r.weightPairs === null ? null : <KV k="铺对" v={n(r.weightPairs)} />}
                    {r.weightZeroPairs === null ? null : <KV k="零权重对" v={n(r.weightZeroPairs)} />}
                    {r.weightElapsedMs === null ? null : <KV k="分摊耗时" v={`${r.weightElapsedMs} 毫秒`} />}
                    <KV k="延迟" v={`${n(r.delayTicks)} 拍`} />
                    <KV k="合并" v={r.combine} mono />
                    <span className={styles.mono}>{r.via}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* ── ④ 约束 ─────────────────────────────────────────────────────── */}
        <section className={styles.sec} data-testid="sim-disclosure-constraints">
          <p className={styles.secHead}>约束</p>
          <p className={styles.kv}>
            <KV k="取值域" v={n(constraints.stateVarBounds.length)} />
            {SEP}
            <KV k="未声明取值域" v={n(constraints.undeclaredStateVars.length)} />
            {SEP}
            <KV k="本拍饱和" v={`${n(constraints.saturations)} 次`} />
          </p>
          <p className={styles.kv}>
            <KV k="规则夹值" v={n(constraints.ruleClamps.length)} />
            {SEP}
            <KV k="节拍闸门" v={n(constraints.cadence.length)} />
            {SEP}
            <KV k="闸门跳过" v={n(constraints.cadenceSkipped.length)} />
          </p>
          {constraints.decayUnresolved.length === 0 ? null : (
            <p className={styles.warn} data-testid="sim-disclosure-decay-unresolved">
              <KV k="衰减引用取不到" v={`${n(constraints.decayUnresolved.length)} 个量纲`} />
            </p>
          )}
          {constraints.stateVarBounds.length === 0 ? null : (
            <details className={styles.more}>
              <summary data-testid="sim-disclosure-bounds-toggle">逐量纲边界与阈值出处</summary>
              <ul className={styles.rows} data-testid="sim-disclosure-bounds">
                {constraints.stateVarBounds.map((b) => (
                  <li key={b.stateVar} className={styles.row}>
                    <span className={styles.mono}>{b.stateVar}</span>
                    <KV k="下界" v={String(b.min)} />
                    <KV k="上界" v={String(b.max)} />
                    <KV k="静息" v={String(b.restPoint)} />
                    <KV k="量纲" v={b.unit} />
                    {b.decayLambda === null ? null : <KV k="衰减" v={String(b.decayLambda)} />}
                    {/* 「阈值来自哪条规则表达式」那一问的落点 —— 引用 + 表达式原文。 */}
                    {b.decayRef === null ? null : <KV k="衰减出处" v={b.decayRef} mono />}
                    {b.decayRuleExpression === null ? null : (
                      <KV k="规则表达式" v={b.decayRuleExpression} mono />
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {constraints.cadenceSkipped.length === 0 ? null : (
            <details className={styles.more}>
              <summary data-testid="sim-disclosure-cadence-skipped-toggle">
                闸门跳过 · {n(constraints.cadenceSkipped.length)} 个节点
              </summary>
              <ul className={styles.rows} data-testid="sim-disclosure-cadence-skipped">
                {constraints.cadenceSkipped.map((s) => (
                  <li key={s.nodeId} className={styles.row}>
                    <span className={styles.mono}>{s.nodeId}</span>
                    <span>{s.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* ── ⑤ agent 是否参与 ──────────────────────────────────────────────
            🔴 **恒写一句，不许留白** —— 铁律 1.5 原文：「今天推演路零 LLM ⇒ 必须明写
            『本次未调用 agent』，不许留白让人以为调了」。所以这一节**没有** `null` 分支。 */}
        <section className={styles.sec} data-testid="sim-disclosure-agent">
          <p className={styles.secHead}>agent 是否参与</p>
          <p className={styles.kv} data-invoked={agent.invoked ? "1" : "0"}>
            <KV k="本次" v={agent.invoked ? "调用了 agent" : "未调用 agent"} />
            {SEP}
            <KV k="调用" v={`${n(agent.calls)} 次`} />
            {agent.provider === null ? null : (
              <>
                {SEP}
                <KV k="供应商" v={agent.provider} mono />
              </>
            )}
            {agent.model === null ? null : (
              <>
                {SEP}
                <KV k="模型" v={agent.model} mono />
              </>
            )}
          </p>
        </section>

        {/* ── ⑥ 各环节耗时 ───────────────────────────────────────────────── */}
        <section className={styles.sec} data-testid="sim-disclosure-timings">
          <p className={styles.secHead}>各环节耗时</p>
          {timings.length === 0 ? (
            <p className={styles.kv} data-testid="sim-disclosure-timings-absent">
              <KV k="本次" v="未计时" />
            </p>
          ) : (
            <p className={styles.kv}>
              {timings.map((t, i) => (
                <span key={t.phase}>
                  {i === 0 ? null : SEP}
                  <KV k={PHASE_LABEL[t.phase] ?? t.phase} v={`${n(t.ms)} 毫秒`} />
                </span>
              ))}
            </p>
          )}
        </section>
      </div>
    </details>
  );
}
