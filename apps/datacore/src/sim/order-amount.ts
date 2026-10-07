/**
 * 订单金额口径 · **唯一出处**（WO-SLOT-MODEL · 数据槽位）。
 *
 * 🔴 为什么需要这个文件（2026-10-07 实测定稿）：
 *   同一条金额口径曾写在**三处**、靠注释粘着，且**两处的优先链不同**：
 *     · `solvers/finance-world.ts`  `num(qty) × num(unitPrice)`        —— 只有回落那一半
 *     · `sim/pair-weights.ts`       `valueOf()` 优先 `props.value`，拿不到才回落
 *     · `solvers/service.ts`        `orderValueYuan`                   —— 按同式取活值
 *   而 `pair-weights.ts` 的注释写着「与 finance-world 的 orderValue **同一个式子**」——
 *   **那句话只对了回落那一半。**
 *
 * ⚠ 为什么一直没人发现：当前数据下三者**数值相等**
 *   （`Order.value = 161135282 = qty 7259 × unitPrice 22198`，500/500 都是）
 *   ⇒ 一旦 `value` 与乘积分家，三处金额口径就分家，**而没有任何东西会报**。
 *   **这是本单那条「两个动态量之比」的同族形态**：几处各自取值、都"讲得通"、
 *   差值不是常量 ⇒ 读起来像口径差异，不像 bug。
 *
 * ── 口径裁定：取【活值】`qty × unitPrice`，⛔ 不优先读物化属性 `value` ──────────────
 *
 * 依据是 `solvers/service.ts` 那条**有理由的**设计（原文）：
 *   「取活值而非直接读 `o.value`，是因为求解器归因用的就是当前 `qty`/`unitPrice`——
 *     派生尚未重跑时读陈值会让『溯源数』与『它算出来的份额』对不上，那是换一种失真。」
 * ⇒ **物化值可能陈旧，活值永远与对象当前状态一致。** 三处里两处已按此办，
 *   本次把第三处（`pair-weights`）也收到这一支。
 *
 * 附带纪律（沿用既有判定，不新立）：
 *   · **负金额不是权重**，按 0 计（不翻转方向）—— 原 `pair-weights` 的判据
 *   · **缺 `unitPrice` → 0**：与 `orderVal` 同一「诚实缺席·禁止静默兜底」判定（WO-UNITPRICE-SCALE 已结案），
 *     ⛔ 绝不兜一个业务常数
 *   · 精度 `round(…, 6)`：与 `runDerivations`（`ontology.ts:709`）同精度
 */

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const round = (v: number, d: number): number => Number(v.toFixed(d));

/**
 * 一个订单实例的金额（元）= `qty × unitPrice`。
 *
 * 兼容两种对象形状：世界态包装的 `{ props: {...} }` 与求解器用的扁平 `{ qty, unitPrice }`
 * —— 兼容是刻意的：**一个口径、两种取数形状，也好过两个口径各取一种形状。**
 */
export function orderAmountOf(o: unknown): number {
  const r = (o ?? {}) as Record<string, unknown>;
  const p = (r.props ?? {}) as Record<string, unknown>;
  const q = num(p.qty ?? r.qty);
  const up = num(p.unitPrice ?? r.unitPrice);
  return Math.max(0, round(q * up, 6));
}
