/**
 * 棘轮基线文档的**唯一**写入构造器 —— 治「`--update` 静默吞掉人手挂账」这一族病。
 *
 * ══ 来历（真实发生，不是假想）══════════════════════════════════════════════
 * `check-backend-frontend-seam.mjs` 的 `--update` 曾无条件写 `note: BASELINE_NOTE`，
 * 把 **978 字、两笔人手挂账**（WO-R2 +9 条 · WO-R6 metrics-authz 1 条，每笔都写着
 * 「为何这条不许走 ROUTE_EXEMPTIONS」）静默吞掉，已于 `0e19f2c4` 修好。
 *
 * **病的形态**：`note` 这个字段**有两个主人** —— 脚本里的常量说它归脚本，
 * 基线正文里的挂账说它归人手。**谁最后写谁赢，而 `--update` 永远最后写。**
 * 后果不是「少一句话」，是**复审下次只看到一份没有理由的名单** —— 挂账理由
 * 恰恰是棘轮唯一能被人审的部分，吞掉它等于把棘轮降级成白名单。
 *
 * ══ 2026-08-14 WO-GATE-LEDGER-FIX 普查结论 ══════════════════════════════════
 * 同病**不止那一处**：全仓 12 道带 baseline 的门里，11 道犯同一个错
 * （详见 `scripts/check-baseline-writer-honesty.mjs` 的门账与基线）。
 * 照铁律 0.6 的三级处置，第 3 次必须**建机制**而不是各自修各自的：
 *   · 本文件 = 唯一实现（不许再有第 12 份手写的 `{ note: 常量, ... }`）；
 *   · `baselineDocCanary()` = 与主逻辑**共用这同一份实现**的四向金丝雀
 *     （抄一份就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿）；
 *   · `scripts/check-baseline-writer-honesty.mjs` = 机器先说话那一层
 *     （谁绕开本文件手写基线，门当场点名）。
 *
 * ══ 四向判据（缺一不可）════════════════════════════════════════════════════
 *   ① 人手 note 逐字节留存        —— 吞了 ⇒ 复审只剩一份没有理由的名单
 *   ② 人手新增的**任意**顶层键留存 —— 白名单式保留漏一个就吞一个，故用 `...prev` 全摊开
 *   ③ `--seed`（首次建账）落常量   —— 反了 ⇒ 建出一份没说明的账
 *   ④ **算出的字段确实被更新**     —— 最隐蔽的一向：prev 若挡住算出的字段，
 *      棘轮从「只减不增」变成「**冻结**」，而门照样 RC=0（还在跑，只是不再度量任何东西）
 */

/**
 * @param {object}   o
 * @param {object|null} o.prev        已存在的基线（首次建账传 null）
 * @param {string}   [o.generatedBy]  写入命令原文（算出的，永远覆盖 prev）
 * @param {object}   [o.prose]        归**人手**的散文字段 -> 首次建账用的常量。
 *                                    prev 里已有同名键 ⇒ 逐字节沿用 prev 的（判据①③）
 * @param {object}   [o.computed]     本次**算出来**的字段，永远覆盖 prev（判据④）
 * @returns {object}
 */
export function buildBaselineDoc({ prev, generatedBy, prose = {}, computed = {} }) {
  // 先把 prev 整个摊开：人手加的任何顶层键（exempt / burndown / 待办…）都跟着活下来，
  // 不必等有人想起来在这里补一行 —— 「白名单式保留」漏一个就又吞一个（判据②）。
  const p = prev && typeof prev === "object" && !Array.isArray(prev) ? prev : null;
  const out = { ...(p ?? {}) };

  // 散文归人手：prev 里有就用 prev 的，只有首次建账才落常量（判据①③）。
  for (const [k, v] of Object.entries(prose)) out[k] = p && k in p ? p[k] : v;

  if (generatedBy !== undefined) out.generatedBy = generatedBy;

  // 算出的字段最后写，永远赢过 prev —— 否则棘轮会被冻结成一张永不变的表（判据④）。
  Object.assign(out, computed);
  return out;
}

/**
 * 四向金丝雀 —— **直接跑 `buildBaselineDoc` 本体，不另抄一份逻辑**。
 * 每道用本文件写基线的门都必须在开跑前调它；不过 ⇒ 报「⛔ 门自己坏了」并 **RC=2**
 * （不是 1：这不是「仓库有问题」，是「门自己有问题」，两者处置相反）。
 *
 * @returns {{ ok: boolean, got: string, want: string }}
 */
export function baselineDocCanary() {
  const HAND = "【人手挂账】__baseline_doc_canary_hand_written__";
  const CONST = "__首次建账才该出现的常量__";
  const prev = {
    version: 1,
    note: HAND,
    __handAdded: "keep-me",
    generatedBy: "旧命令",
    entries: { old: 1 },
    maxEntries: 1,
  };
  const upd = buildBaselineDoc({
    prev,
    generatedBy: "node <gate> --update",
    prose: { note: CONST },
    computed: { entries: { fresh: 2 }, maxEntries: 1 },
  });
  const seed = buildBaselineDoc({
    prev: null,
    generatedBy: "node <gate> --seed",
    prose: { note: CONST },
    computed: { entries: { fresh: 2 }, maxEntries: 1 },
  });

  const checks = {
    "①人手 note 逐字节留存": upd.note === HAND,
    "②人手新增顶层键留存": upd.__handAdded === "keep-me",
    "③--seed 首次建账落常量": seed.note === CONST,
    "④算出的字段确实被更新":
      JSON.stringify(upd.entries) === JSON.stringify({ fresh: 2 }) &&
      upd.generatedBy === "node <gate> --update",
  };
  const bad = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return {
    ok: bad.length === 0,
    got: bad.length ? `未通过：${bad.join(" · ")}` : "四向全通过",
    want: "四向全通过（人手 note 留存 · 人手新增键留存 · --seed 落常量 · 算出的字段确实被更新）",
  };
}
