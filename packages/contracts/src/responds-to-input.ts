/**
 * ══ 对照实验断言 · 铁律 1.5 判据一的**机器化** ═══════════════════════════════════
 *
 * ── 为什么有这个文件（来历，两次都是真事故）────────────────────────────────────
 *
 * **第 1 次**（2026-08-28）：`Material.priceShock --×0.65--> Model.costPressure` 这条边，
 * 碳酸锂与铝箔各涨 15%，产生**完全相同**的成本压力 `15×0.65=9.75` —— 公式里没有用量项。
 * 链路完整、规则已发布、屏上有数、四包全绿。三分法（没接线/没数据/接错地方）**全部通过**。
 *
 * **第 2 次**（2026-09-14）：统一推演控制台「被推动的单」。两个完全不同的扰动
 * （原材料涨价 vs 设备故障）给出**逐字节相同**的 `150 张 / 350 张 / 17-20 家 / 156.6 亿元`。
 * 病因：判据是 `diffWorld(eps=1e-9)`——只问「这格动没动」不问「动了多少」，
 * 而传导必然推到全网 ⇒ 那个数恒等于全集，与扰动内容无关。
 *
 * 两次同构：
 *   **「我用『它跑通了、屏上有数』当作『它算对了』的证据，而前者并不度量后者。」**
 *
 * ── 为什么现有测试拦不住 ────────────────────────────────────────────────────
 * `docs/AUDIT-test-assertion-shape.md` 实测：**881 个测试文件里只有 67 个（7.6%）**
 * 有两次调用对比形态，**514 个只断言存在性 / 形状**。典型写法：
 *     expect(money.exposedOrders).toBeGreaterThan(0);   // 跑通即绿，恒定值照过
 * 这类断言对「第四态：接对了、跑通了、但算错了」**完全免疫**。
 *
 * ── 这个封装要解决的，是「纪律写了但没执行」──────────────────────────────────
 * 铁律 1.5 白纸黑字要求对照实验，我在派单里反复写，**验收自己产出时却只跑了一个输入**。
 * 形态：「我用『我知道该做对照实验』当作『我做了对照实验』的证据。」
 * ⇒ 文档拦不住，只有**断言**拦得住。本仓原话：
 *   「写在注释里的纪律不是机制，写在文档里的也不是。机制的判据是**机器先说话**。」
 *
 * ⚠ 本文件是**唯一出处**。⛔ 不许在各包的 test 里各抄一份同样的逻辑 ——
 *   抄了就是装饰品：改主逻辑时那份旧的照样绿（本仓 `quantile-field-naming` 记过这笔账）。
 */

/** 一次对照实验的结果。`ok=false` 即「这个输出不响应输入」。 */
export interface RespondsToInputResult {
  readonly ok: boolean;
  /** 人读的失败说明 —— 直接可以当 assert 的 message。 */
  readonly message: string;
  /** 两次实测到的值，便于排错。 */
  readonly observed: readonly [unknown, unknown];
}

/**
 * 判定「把输入从 A 换成 B，某个输出是否真的变了」。
 *
 * @param label   这个输出叫什么（进失败信息）
 * @param outA    输入 A 下的输出
 * @param outB    输入 B 下的输出
 * @param pick    从输出里取出要比较的那个量；不传则整体比较
 *
 * 用法：
 * ```ts
 * const r = respondsToInput("被推动的单", viewA, viewB, (v) => v.exposedOrders);
 * expect(r.ok, r.message).toBe(true);
 * ```
 *
 * ⚠ **判据是「必须不同」，不是「必须等于某个值」**。写死期望值的断言在被测逻辑
 *   改成另一个恒定值时照样能改绿；而「两个不同输入必须给不同输出」改不绿。
 */
export function respondsToInput<T>(
  label: string,
  outA: T,
  outB: T,
  pick?: (v: T) => unknown,
): RespondsToInputResult {
  const a = pick ? pick(outA) : outA;
  const b = pick ? pick(outB) : outB;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    return { ok: true, message: `「${label}」随输入变化：${sa} → ${sb}`, observed: [a, b] };
  }
  return {
    ok: false,
    message:
      `⛔ 「${label}」对两个不同的输入给出**完全相同**的结果（${sa}）。\n` +
      `   这不是「恰好相等」，这是**它根本不响应输入** —— 铁律 1.5 的第四态：\n` +
      `   接对了、跑通了、屏上有数，但算的不是它声称在算的东西。\n` +
      `   ⚠ 先别改断言。先回答：这个量的判据是什么？它是不是在度量「全集」而不是「这次的影响」？`,
    observed: [a, b],
  };
}

/**
 * 反向金丝雀：**同一个输入两次，输出必须相同**（确定性 R6）。
 *
 * ⚠ 必须与 `respondsToInput` 成对使用。只验「不同输入给不同输出」是不够的：
 *   一个每次都吐随机数的函数也能通过那一条，而它同样是坏的。
 *   两条合起来才等于「它确实在按输入算，而且只按输入算」。
 */
export function stableForSameInput<T>(
  label: string,
  out1: T,
  out2: T,
  pick?: (v: T) => unknown,
): RespondsToInputResult {
  const a = pick ? pick(out1) : out1;
  const b = pick ? pick(out2) : out2;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa === sb) {
    return { ok: true, message: `「${label}」同输入同输出（R6）：${sa}`, observed: [a, b] };
  }
  return {
    ok: false,
    message:
      `⛔ 「${label}」同一个输入跑两次给出不同结果（${sa} vs ${sb}）——违反确定性 R6。\n` +
      `   常见成因：Date.now() / Math.random() / 依赖遍历顺序 / 未排序的 Map 迭代。`,
    observed: [a, b],
  };
}
