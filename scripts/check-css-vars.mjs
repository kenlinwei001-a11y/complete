#!/usr/bin/env node
/**
 * 门 `css-vars:check`（WO-CSS·防"引用未定义 CSS 变量 → 静默回落空值/黑字"同类复发）。
 *
 * 由来：`InferenceProcessDag.module.css` 写 `fill: var(--text)`（全仓零定义·正确是 `--txt`）→ 解析为空 →
 * fill 回落浏览器默认黑色 → 深底上 DAG 标签黑字不可读（深字深底）。typo 在编译期/测试期都不报，只肉眼可见。
 *
 * 规则：扫所有 .css 的 `var(--X)` —— **无 fallback** 的 `var(--X)` 其 X 必须 ∈ 全仓 CSS 定义的自定义属性集
 * （tokens.css + 各组件局部定义的并集）；带 fallback 的 `var(--X, …)` 允许（运行期用 fallback·语义明确）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../apps/frontend-shell/src", import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".css")) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const defined = new Set();
// 1) 收集所有自定义属性定义（LHS `--X:`）。
for (const f of files) {
  const css = readFileSync(f, "utf8");
  for (const m of css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) defined.add(m[1]);
}

let red = false;
// 2) 校验每个 var(--X)：无 fallback（紧跟 `)`）则 X 必须已定义。
for (const f of files) {
  const css = readFileSync(f, "utf8");
  const lines = css.split("\n");
  lines.forEach((line, i) => {
    // 捕获 var( --X <next>，next=`,`→有 fallback；`)`→裸引用。
    for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*([,)])/g)) {
      const [, name, next] = m;
      if (next === ")" && !defined.has(name)) {
        const rel = f.slice(f.indexOf("apps/"));
        console.error(`✗ ${rel}:${i + 1} 引用未定义 CSS 变量 var(${name})（无 fallback）→ 解析空值/默认色（如黑字深底）。定义于 tokens.css 或加 fallback。`);
        red = true;
      }
    }
  });
}

if (red) {
  console.error(`\n✗ css-vars:check 未过：上述 var(--X) 未定义且无 fallback。修法：用 tokens.css 已定义变量（如 --txt/--muted），或 var(--X, <兜底色>)。`);
  process.exit(1);
}
console.log(`✓ css-vars:check 通过（扫 ${files.length} 个 .css · ${defined.size} 个已定义变量；裸 var() 均有定义）。`);
