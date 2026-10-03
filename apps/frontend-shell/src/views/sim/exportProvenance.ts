/**
 * ══ 推演页导出物 · 自带出处与生成时间（判据 U9 的唯一实现）══
 *
 * 判据出处（`docs/PRD-harness-ux-adoption.md` §2 判据 U9，逐字抄自参考件
 * `docs/reference-prototype-decision-platform.html` 第 3582 行）：
 *   > `全域数字化智能决策支撑系统 · 导出时间 ${now} · 所有数字派生自同一本体（一个事实一个出处）`
 * 参考件把它做成一个**跨页共享件**（第 3587 行 `aiBar()` 把「导出」与「同屏问答」并成一条），
 * 五个挂载点共用同一个 `exportPage()` —— 所以本文件也必须是**一份实现、多页挂载**，
 * 不许各页各写一遍（各写一遍 = 出处措辞迟早分家，而这条判据要的恰恰是「第三方能复算」）。
 *
 * ── 为什么是 `.ts` 而不是 `.tsx`（这不是随手放的）──────────────────────────────
 * 本文件零 JSX：它只把「屏上已经有的那些数」拼成一份可离线阅读的文档。
 * 把纯函数与渲染分开的直接好处是**可被单测逐字断言**（导出物里到底有没有那行时间戳，
 * 不必渲染整页去猜）。渲染那一半在 `./shared.tsx` 的 `ExportReportButton`。
 *
 * ── 主题（本仓踩过的坑）───────────────────────────────────────────────────────
 * 应用内的 UI 一律走 CSS 变量，写死十六进制在另一套主题下会瞎。
 * **但导出物是一份离开应用的独立文档**：它在浏览器/打印/邮件附件里打开，
 * 那里根本不存在本应用的 `:root` 变量表 —— 此处若写 `var(--txt)` 会解析成空值、字变透明。
 * 故导出物**刻意**自带一套固定的浅色排版（与 `RiskBoardView` 的「导出最终规划」同一处理），
 * 这是「文档不在主题里」而不是「偷懒写死颜色」。应用内的按钮见 `shared.tsx`，那里零字面色值。
 *
 * ── 这个门是硬的：没有口径或没有时间戳，本函数直接抛 ────────────────────────────
 * U9 的失败模式是「导出了一份没人能复算的表」，而那种失败**在屏上看不出来**——
 * 表格照样漂亮。所以判据不写在测试里，写在**生产代码的入口**：缺 `basis` 或缺 `exportedAt`
 * 一律抛错，让它在开发期当场炸，而不是在别人拿着附件问「这数哪来的」时才发现。
 */

/** 一段表：小标题 + 表头 + 行。行里放**屏上已有的值**，本模块不做任何算术。 */
export interface ProvenanceSection {
  heading: string;
  head: string[];
  rows: (string | number)[][];
}

export interface ProvenanceReport {
  /** 文档名（= 用户看到的那个页名，如「优化推演」）。 */
  docName: string;
  /**
   * 出处行：**每条回答「这一屏的数是谁算的、算在哪一版数据上」**。
   * 至少一条，否则抛 —— 这是 U9 与「随便导出个 CSV」的全部区别。
   * 写法举例：`求解器 optimize_whatif（seed 42·同输入同输出）`、`本体快照 ov-3f2a`。
   */
  basis: string[];
  sections: ProvenanceSection[];
}

/** 平台名 —— 导出物抬头，与参考件抬头同一句。 */
export const PLATFORM_NAME = "全域数字化智能决策支撑系统";

/**
 * 生成时间戳 `YYYY-MM-DD HH:mm`（本地时区）。
 * 传 `d` 进来是为了**测试可确定**（R6：同输入同输出）——生产调用不传，取当下。
 */
export function exportStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 导出物里那行口径的固定前缀 —— 测试与门都咬这个串，故只此一处定义。 */
export const BASIS_LABEL = "口径与出处";
/** 导出物里那行时间戳的固定前缀。 */
export const STAMP_LABEL = "导出时间";

/**
 * 拼出自包含 HTML 文档。**缺口径或缺时间戳 ⇒ 抛**（见文件头注释）。
 * @param report  屏上已有的值 + 它们的出处
 * @param exportedAt `exportStamp()` 的结果
 */
export function buildProvenanceHtml(report: ProvenanceReport, exportedAt: string): string {
  if (!report.docName.trim()) throw new Error("导出物必须有文档名");
  const basis = report.basis.map((b) => b.trim()).filter(Boolean);
  if (basis.length === 0) {
    throw new Error("导出物必须自带口径与出处（basis 至少一条）——没有它，第三方无法复算这份导出");
  }
  if (!exportedAt.trim()) throw new Error("导出物必须自带生成时间（exportedAt）");

  const tables = report.sections
    .map(
      (s) =>
        `<h2>${esc(s.heading)}</h2>` +
        `<table><thead><tr>${s.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` +
        `<tbody>${
          s.rows.length === 0
            ? `<tr><td colspan="${Math.max(1, s.head.length)}">（本次无数据——诚实空态，不补编）</td></tr>`
            : s.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")
        }</tbody></table>`,
    )
    .join("");

  return (
    `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">` +
    `<title>${esc(report.docName)} · 导出报告</title><style>` +
    `body{font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;max-width:1000px;margin:30px auto;padding:0 20px;color:#1c2733;background:#fff}` +
    `h1{font-size:20px;margin:0 0 6px}h2{font-size:14px;margin:22px 0 8px;border-left:3px solid #54b5c4;padding-left:8px}` +
    `table{width:100%;border-collapse:collapse;font-size:11px;margin:6px 0}` +
    `th,td{border:1px solid #d8dee6;padding:5px 8px;text-align:left}th{background:#f3f6f9}` +
    `.meta{font-size:11px;color:#8a98a8;line-height:1.8}.meta b{color:#1c2733}` +
    `</style></head><body>` +
    `<h1>${esc(report.docName)} · 导出报告</h1>` +
    `<div class="meta">${esc(PLATFORM_NAME)} · ${STAMP_LABEL} ${esc(exportedAt)}<br>` +
    `<b>${BASIS_LABEL}：</b>${basis.map(esc).join("；")}<br>` +
    `所有数字派生自同一本体（一个事实一个出处），可按上述出处复算。</div>` +
    tables +
    `</body></html>`
  );
}

/** 文件名：`<页名>_<日期>.html`（空格与分隔点收敛成下划线，避免各系统下载器改名）。 */
export function reportFileName(docName: string, exportedAt: string): string {
  return `${docName.replace(/[ ·/\\]+/g, "_")}_${exportedAt.slice(0, 10)}.html`;
}

/**
 * 触发下载。**无 `URL.createObjectURL` 时静默返回**（jsdom / SSR 守卫，与本仓既有导出同一写法）。
 * 返回拼好的文档正文，便于调用方或测试直接检查——「点了按钮到底导出了什么」不必去翻 Blob。
 */
export function downloadProvenanceReport(report: ProvenanceReport, exportedAt: string = exportStamp()): string {
  const html = buildProvenanceHtml(report, exportedAt);
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return html;
  }
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFileName(report.docName, exportedAt);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return html;
}
