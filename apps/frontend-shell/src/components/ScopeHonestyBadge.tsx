import { readScopeHonesty, type ScopeHonesty } from "@/lib/solverScopeHonesty";
import { InfoPopover } from "@/components/InfoPopover";
import zh from "@/locales/zh";
import styles from "./ScopeHonestyBadge.module.css";

/**
 * 求解器**作用域诚实位**上屏（欠账 #178 · 后→前这一跳）。
 *
 * ── 它解决什么 ────────────────────────────────────────────────────────────────
 * 引擎侧已经把「这个数到底算的是谁」写进了响应（`scope`/`scopeNote`/`lineScope`/`quarterScope`），
 * 但前端一个字段都没读 ⇒ 屏上是个**看起来像局部答案的全域数字**。本组件让那句话上屏。
 *
 * ── 分层（`docs/CONVENTION-ui-information-layering.md`）──────────────────────
 * 规范 §1 明写：**诚实位允许降到浮层，绝不允许删除；降层后第一层必须留一个可见的记号**
 * ——「静默降层等于删除」。所以这里是**两层**：
 *  · **第一层**：一枚**永远可见**的徽标，短标签直说结论（「全域口径 · 非所选范围」）。
 *    按规范表，第一层只许放「数值 / 状态 / 名字」——这枚徽标是**状态**，合规；
 *    而口径、缺什么、为什么（R-UI-3 点名的那类文字）一律不在第一层。
 *  · **浮层**：后端下发的说明**原文**（`InfoPopover` = 规范 §2 那套浮层规格的唯一实现；
 *    **不是** `title=` 属性 —— 规范明令禁止，欠账 #175/#104 已把它定性为病）。
 *
 * ── 措辞纪律 ──────────────────────────────────────────────────────────────────
 * 浮层正文**逐字取后端原文**，前端不改写、不摘要：措辞是引擎侧的单一来源，
 * 前端另写一句必然与引擎口径漂移 —— 那正是本欠账要治的病。前端只写**短标签**（走 `locales/`·R14）。
 * 短标签说的是「没按这个实参重算」，**不是**「没有数据」：三态混了用户会去修错地方。
 */
export function ScopeHonestyBadge({
  /** 求解器成功载荷原文（不要先 pick 字段——诚实位是加性键，pick 一次就丢一次）。 */
  payload,
  /** DOM 锚点：徽标 `scope-honesty-{testId}`，浮层触发器 `info-scope-honesty-{testId}`。 */
  testId,
  align,
}: {
  payload: unknown;
  testId: string;
  align?: "left" | "right";
}) {
  const honesty = readScopeHonesty(payload);
  // 载荷不带诚实位 → 什么都不画。**不许**替后端编一句「未指定范围」：
  // 「没说」和「说了没限定」是两个命题，编一句就是拿前端的猜测冒充引擎的结论。
  if (!honesty) return null;
  return <ScopeHonestyChip honesty={honesty} testId={testId} align={align} />;
}

const LABEL: Record<ScopeHonesty["level"], (scopedTo?: string) => string> = {
  SCOPED: (to) => zh.scopeHonesty.scoped(to ?? ""),
  GLOBAL: () => zh.scopeHonesty.global,
  UNAPPLIED: () => zh.scopeHonesty.unapplied,
};
/** 档位 → 配色类。`noUncheckedIndexedAccess` 下 CSS module 成员是 `string | undefined`，
 *  故在用处 `?? ""` 兜底（同 `components/ui/Toasts.tsx:12` 的既有写法，不另起一套）。 */
const TONE: Record<ScopeHonesty["level"], string | undefined> = {
  SCOPED: styles.scoped,
  GLOBAL: styles.global,
  UNAPPLIED: styles.unapplied,
};

function ScopeHonestyChip({ honesty, testId, align }: { honesty: ScopeHonesty; testId: string; align?: "left" | "right" }) {
  const label = LABEL[honesty.level](honesty.scopedTo);
  return (
    <span
      className={`${styles.badge} ${TONE[honesty.level] ?? ""}`}
      data-testid={`scope-honesty-${testId}`}
      data-level={honesty.level}
    >
      {label}
      {/* 浮层只在后端真给了说明时才挂 `?` —— 没有原文就不摆一个点不开的记号。
          `SCOPED` 档后端常不带 note（没什么要坦白的），此时第一层的「算的是谁」已经说完了。 */}
      {honesty.note && (
        <InfoPopover topic={zh.scopeHonesty.popoverTopic} testId={`scope-honesty-${testId}`} align={align}>
          <span className={styles.note} data-testid={`scope-honesty-note-${testId}`}>
            {honesty.note}
          </span>
          <span className={styles.field}>{zh.scopeHonesty.fieldHint(honesty.field)}</span>
        </InfoPopover>
      )}
    </span>
  );
}

export default ScopeHonestyBadge;
