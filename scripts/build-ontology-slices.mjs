#!/usr/bin/env node
// 本体切片生成器（母体→克隆·层层索引·自动同步）。
// 母体 docs/SYSTEM-ONTOLOGY.md = 唯一真相源；本脚本派生 docs/ontology/ 下逐节切片 + INDEX.md。
// 切片是"可追溯克隆"（R-一致：不新增事实·勿手改·改母体后重跑本脚本同步）。
// 用法：node scripts/build-ontology-slices.mjs [--check]
//   默认：写切片；--check：只校验切片与母体一致（漂移则 exit 1，供 gate 用）。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOTHER = join(ROOT, "docs/SYSTEM-ONTOLOGY.md");
const OUT = join(ROOT, "docs/ontology");
const CHECK = process.argv.includes("--check");

// 节号 → 切片文件名 slug（层 2）。§0.5 折进 INDEX（层 1）。
const SLUG = {
  "0": "00-howto", "1": "01-topmap", "2": "02-object-types", "3": "03-relations",
  "4": "04-dataflow", "5": "05-invariants", "6": "06-actions", "7": "07-gates",
  "8": "08-breakpoints", "9": "09-evolution", "10": "10-self-domains",
};
// 任务 → 该读哪些切片（层 1 路由·人/agent 检索用）。
const TASK_ROUTES = [
  ["改前端视觉/换肤/布局/新页", "05-invariants(R-QUANT/R-PRD/R14/R17) · 07-gates · PRD-frontend-visual-redesign.md"],
  ["改链路/接线/跨模块改动", "03-relations · 04-dataflow · 08-breakpoints · 10-self-domains(跨域节点)"],
  ["修 bug/为什么这里断了", "08-breakpoints · 03-relations(接缝) · 10-self-domains §10.4"],
  ["写/改 PRD/架构文档", "05-invariants(全铁律) · 01-topmap · 对应域 02-object-types · 必含《本体引用与影响》"],
  ["数据怎么进系统(连接器/合成/构建)", "02-object-types §A · 03-relations · 08-breakpoints(G-8)"],
  ["对象/派生/切片/建模", "02-object-types §B · 05-invariants(R6/R11/R12) · 10-self-domains(类型血缘)"],
  ["求解器/校准/仿真/S&OP", "02-object-types §E · 03-relations(求解器↔计划) · 05(R6/R13/G-DM-1)"],
  ["推演沙盘", "02-object-types §I · 05(R17/十红线) · PRD-frontend-visual-redesign.md §5"],
  ["租户隔离/权限/Entitlement/审计", "02-object-types §G · 05(R2/R3/R-AUDIT/R-DR)"],
  ["QOS/Agent/Skill/意图/工作流", "02-object-types §H · 03(中枢链) · 08(G-1/G-3/G-4)"],
  ["事件/失效/订阅刷新", "04-dataflow · 05(R10/D-29)"],
  ["下发任务/写 WO(量化+PRD 纪律)", "05-invariants(R-QUANT 色号·R-PRD 整页) 必读"],
];

const raw = readFileSync(MOTHER, "utf8");
const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);

// 解析：按行首 "## "（恰两个#）切分顶层节；preamble = §0 前的标题块。
const lines = raw.split("\n");
const blocks = []; // {num,title,body}
let pre = [], cur = null;
for (const ln of lines) {
  const m = ln.match(/^## (?!#)\s*([0-9]+(?:\.[0-9]+)?)\.?\s*(.*)$/);
  if (m) { if (cur) blocks.push(cur); cur = { num: m[1], title: m[2].trim(), body: [] }; }
  else if (cur) cur.body.push(ln);
  else pre.push(ln);
}
if (cur) blocks.push(cur);

const preamble = pre.join("\n").trim();
const banner = (num, title) =>
  `<!-- 自动生成·勿手改 -->\n> ⚠ **本文件由 \`scripts/build-ontology-slices.mjs\` 从母体 \`docs/SYSTEM-ONTOLOGY.md §${num}\` 派生**（本体克隆切片·层 2）。\n> **改接线改母体 §${num}，再跑 \`node scripts/build-ontology-slices.mjs\` 同步**（勿直接改本文·门 \`ontology-slices:check\` 守漂移）。母体 hash \`${hash}\`。\n\n---\n`;

// 生成切片内容（内存），供写或校验。
const files = {};
const manifest = [];
for (const b of blocks) {
  if (b.num === "0.5") continue; // §0.5 折进 INDEX
  const slug = SLUG[b.num];
  if (!slug) continue;
  const body = b.body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  files[`${slug}.md`] = `# 本体切片 §${b.num} · ${b.title}\n\n${banner(b.num, b.title)}\n## ${b.num}. ${b.title}\n\n${body}\n`;
  manifest.push({ num: b.num, slug, title: b.title });
}

// §0.5 母体内容（作 INDEX 的"我要找X→去哪"层，节号 repoint 到切片）。
const s05 = blocks.find((b) => b.num === "0.5");
let s05body = s05 ? s05.body.join("\n").trim() : "";
// repoint §N → 切片文件（§2 §2.A 等 → 02-object-types.md）。
s05body = s05body.replace(/§(\d+)(?:\.[0-9A-Za-z]+)?/g, (mm, n) => (SLUG[n] ? `${mm}〔→${SLUG[n]}.md〕` : mm));

const index =
`# 本体索引（母体克隆·层层索引入口 · 层 1）\n\n` +
`<!-- 自动生成·勿手改 -->\n<!-- ontology-hash: ${hash} -->\n` +
`> ⚠ **由 \`scripts/build-ontology-slices.mjs\` 从母体 \`docs/SYSTEM-ONTOLOGY.md\` 派生。** 母体=唯一真相源；本目录=可追溯克隆切片（R-一致·不新增事实）。\n` +
`> **协议**：先按下方"任务→切片"检索该读哪片 → 只读对应切片（简洁）→ 改接线改母体后 \`node scripts/build-ontology-slices.mjs\` 同步（门 \`ontology-slices:check\` 守漂移）。\n\n` +
preamble.replace(/^# .*/m, "").trim() + `\n\n---\n\n` +
`## 任务 → 切片 快速路由（层 1·先查这里）\n\n| 我要做… | 读哪些切片/文档 |\n|---|---|\n` +
TASK_ROUTES.map(([t, s]) => `| ${t} | ${s} |`).join("\n") + `\n\n---\n\n` +
`## 切片清单（层 2·逐节克隆）\n\n| 切片 | 母体节 | 主题 |\n|---|---|---|\n` +
manifest.map((m) => `| [\`${m.slug}.md\`](./${m.slug}.md) | §${m.num} | ${m.title} |`).join("\n") + `\n\n---\n\n` +
`## §0.5 快查索引（母体导航层·节号已 repoint 到切片）\n\n${s05body}\n`;
files["INDEX.md"] = index;

// 写 or 校验
if (CHECK) {
  let drift = [];
  const existing = existsSync(OUT) ? new Set(readdirSync(OUT)) : new Set();
  for (const [name, content] of Object.entries(files)) {
    const p = join(OUT, name);
    if (!existsSync(p) || readFileSync(p, "utf8") !== content) drift.push(name);
  }
  for (const name of existing) if (!files[name]) drift.push(`(多余)${name}`);
  if (drift.length) {
    console.error(`✗ ontology-slices 漂移（母体已改但切片未同步）：\n  ${drift.join("\n  ")}\n  修复：node scripts/build-ontology-slices.mjs`);
    process.exit(1);
  }
  console.log(`✓ ontology-slices 与母体一致（${manifest.length} 切片 + INDEX · hash ${hash}）`);
} else {
  mkdirSync(OUT, { recursive: true });
  for (const name of existsSync(OUT) ? readdirSync(OUT) : []) if (!files[name]) rmSync(join(OUT, name));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content);
  console.log(`✓ 生成 ${manifest.length} 切片 + INDEX.md → docs/ontology/（母体 hash ${hash}）`);
}
