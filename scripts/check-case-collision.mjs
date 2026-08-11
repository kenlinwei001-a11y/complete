#!/usr/bin/env node
/**
 * case-collision:check —— 大小写不敏感文件系统上的模块解析冲突门。
 *
 * **来历（2026-08-10 真实事故）**：canonical 上同目录并存
 *   `apps/frontend-shell/src/views/sim/SandboxConsole.tsx`（React 组件）
 *   `apps/frontend-shell/src/views/sim/sandboxConsole.ts`（逻辑模块）
 * 在 **Linux（大小写敏感）上永远是绿的**，CI 一次都没红过；
 * 但在 macOS APFS / Windows NTFS（默认大小写不敏感）上，
 * `import { SandboxConsole } from "./SandboxConsole"` 会被解析到 `sandboxConsole.ts`，
 * 报 `TS2305 Module has no exported member` + `TS1261 differs only in casing`，
 * **整个前端构建不了**。仓主在本机部署时才发现 —— 也就是说：
 * **说话的是一台 mac，不是机器人**。本门把这句话交还给机器。
 *
 * ⚠️ **判据不是「路径小写化后相同」** —— 那个判据是错的，我第一次就是这么写的，
 * 金丝雀当场不中：`sandboxconsole.tsx` ≠ `sandboxconsole.ts`（扩展名不同），
 * 于是它报「0 冲突」，而冲突就在眼前。
 * 真正的冲突发生在**模块说明符**层：`import "./X"` 会依次去试
 * `X.ts` / `X.tsx` / `X.d.ts` / `X.js` …，所以判据必须是
 * **「去掉可解析扩展名之后的 stem，小写化后相同，但原始大小写不同」**。
 *
 * 同时查**目录**的大小写冲突（`src/Views/` vs `src/views/`），同一类病、同样只在 Linux 上隐形。
 */

import { execFileSync } from "node:child_process";

const RESOLVABLE = /\.(ts|tsx|js|jsx|mjs|cjs|d\.ts)$/;

/**
 * 唯一实现 —— 主逻辑与金丝雀共用这一个函数。
 * （不许各抄一份：抄了就是装饰品，改主判据时金丝雀拿旧的去测、照样绿。）
 */
function collisions(paths) {
  const byStem = new Map();
  const byDir = new Map();
  for (const p of paths) {
    if (RESOLVABLE.test(p)) {
      const stem = p.replace(RESOLVABLE, "");
      const k = `f:${stem.toLowerCase()}`;
      if (!byStem.has(k)) byStem.set(k, new Set());
      byStem.get(k).add(stem);
    }
    const dir = p.slice(0, p.lastIndexOf("/"));
    if (dir) {
      const k = `d:${dir.toLowerCase()}`;
      if (!byDir.has(k)) byDir.set(k, new Set());
      byDir.get(k).add(dir);
    }
  }
  const out = [];
  for (const [k, set] of [...byStem, ...byDir]) {
    if (set.size > 1) out.push({ kind: k.startsWith("f:") ? "MODULE_STEM" : "DIRECTORY", variants: [...set].sort() });
  }
  return out;
}

function tracked() {
  const raw = execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return raw.split("\n").filter(Boolean);
}

// ── 金丝雀：报「0 冲突」之前，先自证这个检测器认得出一对已知冲突 ──
// 用**同一个** collisions()，喂进两条合成路径。不中 ⇒ 报「门自己瞎了」，不许报「仓库干净」。
const CANARY = ["zz/__canary__/Probe.tsx", "zz/__canary__/probe.ts"];
const canaryHit = collisions(CANARY).some(
  (c) => c.kind === "MODULE_STEM" && c.variants.length === 2 && c.variants.every((v) => /__canary__\/[Pp]robe$/.test(v)),
);
if (!canaryHit) {
  console.error("⛔ case-collision:check 金丝雀未命中 —— 检测器坏了，本次结论作废。");
  console.error("   （不是「仓库没有冲突」。修检测器再谈结论。）");
  process.exit(2);
}

const files = tracked();
if (files.length < 100) {
  console.error(`⛔ 只枚举到 ${files.length} 个受版本控制的文件 —— 枚举坏了，本次结论作废。`);
  process.exit(2);
}

const found = collisions(files);

if (found.length === 0) {
  console.log(`✓ case-collision:check 通过 —— ${files.length} 个受控文件，无大小写冲突。`);
  console.log(`  金丝雀：合成对 ${CANARY.join(" / ")} 被正确识别（证明检测器有牙）。`);
  process.exit(0);
}

console.error(`❌ case-collision:check：发现 ${found.length} 组大小写冲突 —— 在 macOS / Windows 上会构建失败`);
for (const c of found) {
  console.error(`  [${c.kind}] ${c.variants.join("  <=>  ")}`);
}
console.error("");
console.error("修法：把其中一个改名成大小写以外也不同的名字（例如逻辑模块加 `Model` 后缀，");
console.error("      与同目录既有的 `inspectorModel.ts` 一致），并同步更新：");
console.error("      · 全部 import 说明符（含 test）");
console.error("      · scripts/*-baseline.json 里带该路径的条目（漏改会让别的门变红）");
console.error("      · docs/SYSTEM-ONTOLOGY.md 里的 file:line 锚点");
console.error("禁止用「在 .gitignore 里躲开」或「只在 CI 上跳过」绕过 —— 那是把 mac 开发者永久挡在门外。");
process.exit(1);
