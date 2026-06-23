/**
 * 通用 CSV 导出工具（PRD-cockpit §8 P5 收尾「导出」）。
 * 纯函数 toCsv（可单测、确定性）+ 浏览器下载 downloadCsv（Blob → <a download>）。
 * CSV 注入防护：字段以 =/+/-/@ 起头时前置单引号（防 Excel 公式注入）。
 */

/** 单元格转义：含 引号/逗号/换行 → 包双引号并转义内部引号；公式注入前缀加 '（数字豁免，负数/小数不误伤）。 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // 合法数字（含负/正/小数，如 -1.8）是安全数值，不视为 Excel 公式注入。
  const numeric = typeof v === "number" || (s !== "" && Number.isFinite(Number(s)));
  if (!numeric && /^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 行数组 → CSV 文本（确定性；行间 \r\n，Excel/中文友好）。 */
export function toCsv(rows: (readonly unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** 浏览器下载 CSV（带 UTF-8 BOM，Excel 正确识别中文）。无 DOM/URL 时静默返回（SSR/测试 guard）。 */
export function downloadCsv(filename: string, rows: (readonly unknown[])[]): void {
  const csv = "﻿" + toCsv(rows);
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
