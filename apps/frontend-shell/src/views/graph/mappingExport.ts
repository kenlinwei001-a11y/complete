import type { MappingRow } from "@platform/contracts";
import zh from "@/locales/zh";

/** §7.20 导出（CSV + 自包含 HTML）：纯函数便于内容抽查测试 */

const CSV_HEADER = [
  zh.mapping.colObject,
  zh.mapping.colKind,
  "数据域",
  zh.mapping.colSource,
  zh.mapping.colProps,
  zh.mapping.colRules,
  zh.mapping.colDerivations,
  zh.mapping.colLineage,
];

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function lineageSummary(row: MappingRow): string {
  if (!row.lineage.connName && !row.lineage.dataset) return "—";
  return zh.mapping.lineageText(row.lineage.connName ?? "—", row.lineage.dataset ?? "—", row.lineage.fieldCount);
}

export function buildMappingCsv(rows: MappingRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        `${r.displayName}(${r.objectKey})`,
        r.kind,
        r.domain,
        r.sourceSystem,
        r.keyProps.join(" / "),
        r.rules.join(" / "),
        r.derivations.join(" / "),
        lineageSummary(r),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\n")}`; // BOM：Excel 中文兼容
}

/** 自包含 HTML（复用原型导出报告样式：标题 + 导出时间 + 同源脚注） */
export function buildMappingHtml(rows: MappingRow[], exportedAt: string): string {
  const domains = [...new Set(rows.map((r) => r.domain))];
  const body = domains
    .map((d) => {
      const rs = rows.filter((r) => r.domain === d);
      return `<tr class="grp"><td colspan="7">${d}</td></tr>${rs
        .map(
          (r) =>
            `<tr><td><b>${r.displayName}</b> <code>${r.objectKey}</code></td><td>${r.kind}</td><td>${r.sourceSystem}</td><td>${r.keyProps.join("、") || "—"}</td><td>${r.rules.join("、") || "—"}</td><td>${r.derivations.join("；") || "—"}</td><td>${lineageSummary(r)}</td></tr>`,
        )
        .join("")}`;
    })
    .join("");
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${zh.mapping.title}</title>
<style>
body{background:#0d1117;color:#e9eef5;font-family:"Segoe UI",system-ui,"PingFang SC",sans-serif;padding:32px;font-size:13px}
h1{font-size:18px;margin-bottom:4px}
.meta{color:#9aa8b6;font-size:11px;margin-bottom:18px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{ text-align:left;color:#9aa8b6;font-weight:500;padding:6px 8px;border-bottom:1px solid rgba(226,235,245,.13)}
td{padding:6px 8px;border-bottom:1px solid rgba(226,235,245,.07)}
tr.grp td{background:rgba(76,144,240,.08);font-weight:700;letter-spacing:1px}
code{color:#43b7d7;font-family:ui-monospace,monospace}
.foot{margin-top:20px;color:#9aa8b6;font-size:11px;border-top:1px dashed rgba(226,235,245,.13);padding-top:10px}
</style>
</head>
<body>
<h1>${zh.mapping.title}</h1>
<div class="meta">${zh.mapping.exportedAt(exportedAt)}</div>
<table>
<thead><tr><th>${zh.mapping.colObject}</th><th>${zh.mapping.colKind}</th><th>${zh.mapping.colSource}</th><th>${zh.mapping.colProps}</th><th>${zh.mapping.colRules}</th><th>${zh.mapping.colDerivations}</th><th>${zh.mapping.colLineage}</th></tr></thead>
<tbody>${body}</tbody>
</table>
<div class="foot">${zh.mapping.footnote}</div>
</body>
</html>`;
}

/** 客户端 Blob 下载（jsdom 无 createObjectURL 时静默跳过） */
export function downloadBlob(content: string, mime: string, filename: string): void {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
