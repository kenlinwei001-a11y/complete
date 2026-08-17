import { Modal } from "@/components/ui/Modal";
import styles from "./DagNodeInspector.module.css";

/**
 * ══ 判据 U3 的那一半：**图上点一个节点，看得到它凭什么** ══
 *
 * 判据原文（`docs/PRD-harness-ux-adoption.md` §2 U3）：
 *   「页内有推演过程图，**且**节点点击真接到一个面板，面板里同时有 **来源** 与 **规则**」。
 * 用户读了能做的决定：**数字不对时定位到是哪一环坏了** —— 把「结论错了」变成「第 3 步的规则用错了」。
 *
 * ⚠ 这一条此前在 10 个页面上不符合，而其中三页的病**不是「没有图」**：
 * `order-chain`（`ofc-dag` / `problem-dag`）与 `disruption-radius`（`dr-fanout`）**图都有**，
 * 只是挂 `LayeredDag` 时**没传 `onNodeClick`** —— 该 prop 在 `components/Dag/LayeredDag.tsx` 里是**可选**的，
 * 不传就 `onClick={() => onNodeClick?.(n)}` 静默什么都不做，点上去毫无反应且**屏上看不出来**。
 * 这正是铁律 0.5 说的第三形态「**接了线接错地方**」：组件支持、页面没挂。修法是补挂载点，不是造组件。
 *
 * ── 为什么 `src` / `rule` 是**必填**且空值**直接抛** ────────────────────────────
 * U3 的失败模式是「面板点得开，但里面只有一句标题」—— 那种失败**在屏上看不出来**
 * （抽屉照样弹、照样好看），只有真去核对数字的人才会发现无从下手。
 * 所以判据写在**生产代码入口**（与 `views/sim/exportProvenance.ts` 同一处理）：
 * 缺来源或缺规则 ⇒ `assertDagNodeFacts` 抛，开发期当场炸，不给「悄悄退化成空面板」留路。
 *
 * ── `ruleKind` 为什么要分两档（诚实位，不许省）────────────────────────────────
 * 本仓两类页给得出的「规则」性质**不同**，混成一个字会把用户带偏：
 *  · `ruleKey`     —— 真业务规则键（`order_fullchain` 的 `judges.*.ruleRefs` = C02/C06/C15…），
 *                     规则库里查得到、改得动、有版本。
 *  · `projection`  —— **确定性投影规则**（净室页无业务规则库时的真实判定逻辑，
 *                     如影响半径的「沿『谁 ref 我』逐层下探 · 多候选按 type→viaField 字典序取首」）。
 *                     它同样是代码里逐字实现的判定逻辑、同样能定位坏在哪一环，但**它不是业务规则**，
 *                     屏上必须分得出来 —— 否则用户会去规则库里找一个根本不存在的键。
 */

/** 输入项：一条真实入参（值取自求解器输出/本体字段，前端不臆造）。 */
export interface DagNodeInput {
  label: string;
  value: string;
}

/** 一个节点「凭什么」的全部事实。`src` / `rule` 必填 —— 少一个 U3 就不成立。 */
export interface DagNodeFacts {
  /** 面板标题 = 这个节点是什么。 */
  title: string;
  /** 该节点的结论（有则显示在最前，无则省略——不编）。 */
  verdict?: string;
  /** **来源**：这一环的数字从哪来（求解器键 / 本体字段 / 数据域）。必填。 */
  src: string;
  /** **规则**：判定这一环用的规则键或确定性投影规则原文。必填。 */
  rule: string;
  /** 规则性质。缺省按业务规则键处理。 */
  ruleKind?: "ruleKey" | "projection";
  /** 推导公式（有则给）。 */
  formula?: string;
  /** 该环真实读到的输入。 */
  inputs?: DagNodeInput[];
  /** 诚实位 / 限定条件。 */
  note?: string;
}

/** U3 的生产期断言：缺来源或缺规则即抛（失败模式在屏上看不出来，所以不能只写在测试里）。 */
export function assertDagNodeFacts(facts: DagNodeFacts): DagNodeFacts {
  const miss: string[] = [];
  if (!facts.src.trim()) miss.push("src(来源)");
  if (!facts.rule.trim()) miss.push("rule(规则)");
  if (miss.length > 0) {
    throw new Error(
      `DagNodeInspector：节点「${facts.title}」缺 ${miss.join(" / ")}——` +
        `点开一个只有标题的面板，用户无法定位是哪一环坏了（判据 U3）。`,
    );
  }
  return facts;
}

const RULE_KIND_LABEL: Record<"ruleKey" | "projection", string> = {
  ruleKey: "规则键",
  projection: "确定性投影规则",
};

/**
 * 节点详情面板（受控浮层 —— 不导航离开，同时满足判据 U8「看明细不换页」）。
 * `facts` 为 null 即不渲染；调用方管选中态。
 */
export function DagNodeInspector({
  facts,
  onClose,
  testId = "dag-node-inspector",
}: {
  facts: DagNodeFacts | null;
  onClose: () => void;
  testId?: string;
}) {
  if (!facts) return null;
  const f = assertDagNodeFacts(facts);
  const kind = f.ruleKind ?? "ruleKey";
  return (
    <Modal title={`🔍 ${f.title}`} onClose={onClose} width={560}>
      <div data-testid={testId} className={styles.body}>
        {f.verdict && (
          <div className={styles.verdict} data-testid={`${testId}-verdict`}>
            {f.verdict}
          </div>
        )}

        {/* 来源 —— U3 要的第一样。 */}
        <div className={styles.row} data-testid={`${testId}-src`}>
          <span className={styles.key}>来源</span>
          <span className={styles.val}>{f.src}</span>
        </div>

        {/* 规则 —— U3 要的第二样。性质徽章分「规则键 / 确定性投影规则」，不许混。 */}
        <div className={styles.row} data-testid={`${testId}-rule`} data-rule-kind={kind}>
          <span className={styles.key}>规则</span>
          <span className={styles.val}>
            <span className="mono" data-testid={`${testId}-rule-text`}>
              {f.rule}
            </span>
            <span className={styles.kindTag} data-testid={`${testId}-rule-kind`}>
              {RULE_KIND_LABEL[kind]}
            </span>
          </span>
        </div>

        {f.formula && (
          <div className={styles.row} data-testid={`${testId}-formula`}>
            <span className={styles.key}>推导</span>
            <span className={`${styles.val} mono`}>{f.formula}</span>
          </div>
        )}

        {f.inputs && f.inputs.length > 0 && (
          <div className={styles.row} data-testid={`${testId}-inputs`}>
            <span className={styles.key}>输入数据</span>
            <span className={styles.val}>
              <span className={styles.chips}>
                {f.inputs.map((it) => (
                  <span key={it.label} className={styles.chip}>
                    {it.label}
                    <b className="mono">{it.value}</b>
                  </span>
                ))}
              </span>
            </span>
          </div>
        )}

        {f.note && (
          <div className={styles.note} data-testid={`${testId}-note`}>
            {f.note}
          </div>
        )}
      </div>
    </Modal>
  );
}
