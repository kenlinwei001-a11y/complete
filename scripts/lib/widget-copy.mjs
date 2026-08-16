/**
 * widget 文案对账原语 —— `mock-fidelity:check` 载体③ 与
 * `apps/frontend-shell/test/mock-widget-copy.seam.test.tsx` **共用同一份实现**
 * （铁律 0.6：门脚本里的金丝雀必须与主逻辑共用同一份实现，各抄一份就是装饰品）。
 *
 * ── 治什么 ────────────────────────────────────────────────────────────────────
 * WO-TITLE-DIVERGENCE 实测：同一 widget key（aop-base / oee-trend）在 mock 与真后端的
 * **title/unit 分叉**活了很久——单位差 4 个数量级（万 vs 亿）、趋势窗口文案与数据不符
 * （7日 vs 14 日，两侧数据其实都是 14 天）。而 `fixtures.ts` 的注释一直声称
 * 「与后端 DASH_LAYOUT 同步，门A 守不漂」——门A（`check-cockpit-widgets.mjs`）只查
 * widget **type 在不在**，一个字的文案都不比，所以这句声称从没被机器验过。
 * 形态（铁律 0.6 句式）：**「我用『widget type 三处齐』当作『两套 DASH_LAYOUT 不漂』的证据，
 * 而前者并不度量后者。」**
 *
 * ── 形状判据（什么是「widget」）───────────────────────────────────────────────
 * 对象字面量同时满足：顶层有 `key` / `title` / `type` 三个**字符串字面量**字段，
 * 且顶层有 `query` 字段（值是嵌套对象，不是字面量，所以只看键名不看值）。
 * 视图条目（`{ key, title, renderer, layout }`）没有 `type`/`query`，天然排除；
 * feature 条目（`{ key, name, level }`）没有 `title`，天然排除。
 *
 * ── 诚实边界 ──────────────────────────────────────────────────────────────────
 *  · 只比**同 key 交集**的 title/unit；一侧独有的 key 不在本载体管辖
 *   （集合差集的自动配对实测不可靠，见 check-mock-fidelity.mjs 顶注那条教训）。
 *  · `unit` 只收字符串字面量；一侧写成表达式（非常量）时读作「无」，
 *    与另一侧的字面量不等 ⇒ 报分叉。本仓两侧 widget 的 unit 全是字面量，实测无此噪声。
 */
import { lex, splitTopLevel, stripComments, lineOf, M_CODE } from "./source-lex.mjs";

/**
 * 源文件里所有 widget 条目：`{ key, title, type, unit?, query: {…}, … }`。
 * 嵌套扫描：每个代码位的 `{` 都尝试配平成完整对象，形状符合才收 ——
 * 不依赖「widget 必须写在名叫 DASH_LAYOUT 的变量里」这类命名约定。
 */
export function widgetEntries(src) {
  const { mask } = lex(src);
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "{" || mask[i] !== M_CODE) continue;
    const { parts, end } = splitTopLevel(src, i);
    // 判「配平」看收尾字符，不用 end >= length（完整对象的闭括号就是最后一个字符，
    // 那种写法会把每个完整对象都判成截断 —— check-mock-fidelity.mjs literalProps 实测踩过）。
    if (end === 0 || src[end - 1] !== "}") continue;
    const props = {};
    const names = new Set();
    for (const raw of parts) {
      const p = stripComments(raw).trim(); // 注释不抹掉 ⇒ 带注释的字段一律读作不存在
      if (!p || p.startsWith("...")) continue;
      const m = /^(?:["'])?([A-Za-z_$][\w$]*)(?:["'])?\s*:\s*([\s\S]*)$/.exec(p);
      if (!m) continue;
      names.add(m[1]);
      const sm = /^["'`]([^"'`]*)["'`]$/.exec(m[2].trim());
      if (sm) props[m[1]] = sm[1]; // 只收字符串字面量；数字/布尔/嵌套对象本载体用不上
    }
    if (typeof props.key !== "string" || typeof props.title !== "string" || typeof props.type !== "string") continue;
    if (!names.has("query")) continue;
    out.push({
      key: props.key,
      title: props.title,
      type: props.type,
      unit: typeof props.unit === "string" ? props.unit : undefined,
      line: lineOf(src, i),
    });
  }
  return out;
}

/**
 * 同 key 的两条 widget 条目逐字段比对 → 不一致字段列表。
 * unit 的不对称（一侧有一侧没有）**算分叉**：KPI 少印单位，屏上数字就没有量纲。
 */
export function compareWidget(mockEntry, beEntry) {
  const diffs = [];
  if (mockEntry.title !== beEntry.title) diffs.push({ field: "title", mock: mockEntry.title, backend: beEntry.title });
  if (mockEntry.unit !== beEntry.unit) diffs.push({ field: "unit", mock: mockEntry.unit, backend: beEntry.unit });
  return diffs;
}
