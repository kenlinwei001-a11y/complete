#!/usr/bin/env node
/**
 * 门 `ontology-writeback:check`（治理 · 反向回写完整性）：
 * 守"代码改了接线（新增门禁）却漏回写本体"——`check-prd-ontology` 只查正向（PRD 引用的 R/G 必须存在），
 * 本门查**反向**：**每个并入 `pnpm gates` 的 `scripts/check-*.mjs` 门，都必须在本体 §7 检测/门禁章节登记**
 * （脚本名出现在 §7）。由来：规则 P2 新增 `no-hardcoded-rules:check` 却漏登 §7，无门可抓 → 立此门。
 *
 * 诚实边界（部分覆盖，非全量）：本门只机械守"门禁(§7)"这一类回写。事件(§4)/契约对象(§2)/链路(§3)
 * 的回写仍需 fde-delivery/铁律0 纪律——机械全量校验它们需更强的代码↔本体双向索引（列为后续）。
 */
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

// 1) 从 package.json 的 gates 脚本提取所有 check-*.mjs 门 + 它们的 pnpm 别名（§7 多按别名登记）。
const pkg = JSON.parse(read("package.json"));
const scripts = pkg.scripts ?? {};
const gatesCmd = scripts.gates ?? "";
const gateScripts = [...new Set([...gatesCmd.matchAll(/scripts\/(check-[a-z0-9-]+)\.mjs/g)].map((m) => m[1]))];
// script → 所有指向它的 pnpm 别名（如 check-prd-ontology → prd:check）。
const aliasOf = (script) =>
  Object.entries(scripts)
    .filter(([k, v]) => k !== "gates" && typeof v === "string" && v.includes(`scripts/${script}.mjs`))
    .map(([k]) => k);
const uniqueGates = gateScripts;

// 2) 取本体 §7 检测/门禁章节正文（## 7. … 到下一个 ## ）。
const onto = read("docs/SYSTEM-ONTOLOGY.md");
const s7 = onto.match(/\n## 7\.[^\n]*\n([\s\S]*?)\n## 8\./);
const s7Body = s7 ? s7[1] : "";
if (!s7Body) { console.error("✗ ontology-writeback:check：未能定位本体 §7 检测/门禁章节"); process.exit(1); }

// 3) 每个 gates 门脚本必须在 §7 出现（脚本名 或 其任一 pnpm 别名）。
const missing = uniqueGates.filter((g) => {
  if (s7Body.includes(`${g}.mjs`) || s7Body.includes(g)) return false;
  return !aliasOf(g).some((a) => s7Body.includes(a));
});
console.log(`· ontology-writeback：pnpm gates 含 ${uniqueGates.length} 个 check 门 · §7 漏登 ${missing.length}`);

if (missing.length > 0) {
  console.error(`✗ ontology-writeback:check：下列门在 pnpm gates 但本体 §7 未登记（改接线漏回写本体）：${missing.join(", ")}`);
  console.error(`  → 在 docs/SYSTEM-ONTOLOGY.md §7 检测/门禁章节补登该门（名/脚本 + 守什么不变量/断点）。`);
  process.exit(1);
}
console.log("✓ ontology-writeback:check：pnpm gates 所有门均在本体 §7 登记（门禁维回写无遗漏）。");
