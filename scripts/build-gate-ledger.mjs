#!/usr/bin/env node
/**
 * build-gate-ledger.mjs · 门账初稿生成器（一次性辅助，非门；账落盘后由人逐条复核定性）
 *
 * 纪律：guardedPaths 与 provenRed 一律**从仓里抽**，不手填、不编造——
 *  · guardedPaths ← 门脚本自身引用的仓内路径（存在性当场校验，目录转 glob）
 *  · provenRed    ← 本体 §7 该门条目里已记录的「变异反证 / green→red / 亲测退 1」等证据
 * 抽不到就如实落 NEVER（PRD §4.3：允许填，但会被统计并告警——藏起来比留着更糟）。
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { census } from "./gate-census.mjs";

const ROOT = process.cwd();
const rd = (p) => readFileSync(join(ROOT, p), "utf8");

/* ---------- guardedPaths：从脚本源码抽仓内路径，逐条校验存在 ---------- */
const RE_PATH = /['"`]((?:apps|packages|services|scripts|docs)\/[A-Za-z0-9_@./*-]+|[A-Z][A-Z0-9-]+\.(?:md|json|yml|yaml))['"`]/g;

function guardedPathsFor(file) {
  const src = rd(`scripts/${file}`);
  const raw = [...new Set([...src.matchAll(RE_PATH)].map((m) => m[1]))]
    .filter((p) => !p.endsWith(`/${file}`));           // 排除它引用自己
  const out = new Set();
  for (const p of raw) {
    const abs = join(ROOT, p);
    if (!existsSync(abs)) {
      // 路径不存在：可能是被删/改名的锚点，或含通配。收敛到最近的真实祖先目录。
      const parts = p.split("/");
      while (parts.length > 1) {
        parts.pop();
        const anc = parts.join("/");
        if (existsSync(join(ROOT, anc)) && statSync(join(ROOT, anc)).isDirectory()) { out.add(`${anc}/**`); break; }
      }
      continue;
    }
    out.add(statSync(abs).isDirectory() ? `${p.replace(/\/$/, "")}/**` : p);
  }
  // 收敛：若已含某目录 glob，去掉它覆盖的具体文件，避免账里几十条噪声
  const globs = [...out].filter((p) => p.endsWith("/**"));
  const kept = [...out].filter((p) => !globs.some((g) => p !== g && p.startsWith(g.slice(0, -2))));
  return kept.sort().slice(0, 5);
}

/* ---------- provenRed：从本体 §7 该门条目抽已记录的红过证据 ---------- */
const ONTO = rd("docs/SYSTEM-ONTOLOGY.md").split("\n");
// 只认**明确记载已执行**的反证。刻意不认 `真红`/`green→red`/`tooth test` 这类词——
// 它们常出现在假设句里（如「改坏求解器 → pnpm gates 真红」描述的是应然，不是做过），
// 把假设当证据正是本单要治的病。宁可多记 NEVER（PRD §4.3 允许且要求可见）。
const RE_MUT = /变异反证\s*\d+\s*\/\s*\d+|变异反证[^。；]{0,40}(已跑|逐条注入)|亲测退\s*1|逐条注入均?\s*RC=1/;

function provenRedFor(file, aliases, ontologyLine) {
  if (!ontologyLine) return { kind: "NEVER", evidence: null, note: "本体 §7 无该门条目" };
  const l = ONTO[ontologyLine - 1] || "";
  const m = l.match(RE_MUT);
  if (m) {
    const s = Math.max(0, m.index - 70);
    return {
      kind: "MUTATION",
      evidence: `本体 §7 行${ontologyLine}`,
      note: l.slice(s, m.index + m[0].length + 40).replace(/\s+/g, " ").trim(),
    };
  }
  return { kind: "NEVER", evidence: null, note: `本体 §7 行${ontologyLine} 未记录已执行的反证` };
}

/* ---------- 组账 ---------- */
const r = census();
const gates = {};
for (const [file, v] of Object.entries(r.scripts)) {
  const claim = r.claims[file] || {};
  const entry = {
    alias: v.alias,
    binding: v.binding,
    guardedPaths: guardedPathsFor(file),
    escalation: "审核方",
    ontologyRef: claim.ontologyLine ? `§7:${claim.ontologyLine}` : null,
    provenRed: provenRedFor(file, v.aliases || [], claim.ontologyLine),
    notes: "",
  };
  if (v.binding !== "GATES_CHAIN") {
    // ⚠ 判据必须与「本体文案是否已被修正」无关。初版写成 `verdict===LIE_DEAD ? WIRE : MANUAL`，
    // 而本单随后把 §7 的失实文案改成了真话 → LIE_DEAD 归零 → 全部退化成 MANUAL，
    // G3-c 棘轮 pendingWireCount 随之变 0，门绿了却绿得没有意义。顺序依赖的判据本身就是坑。
    // 稳定判据只看**现算 binding**：
    //   NONE（零调用方）      → WIRE：门存在且 §7 宣称受治理，要么真接线要么删，默认 WIRE 并入棘轮 burn-down
    //   GATE_SH / CI_ONLY    → WIRE：已在自动路径内（只是不走 npm gates 串），非"手动"
    //   MANUAL（仅 npm 别名） → MANUAL：无自动路径但可手动跑，须签理由与触发时机
    entry.disposition = v.binding === "MANUAL" ? "MANUAL" : "WIRE";
    if (entry.disposition === "MANUAL") {
      entry.notes = "MANUAL 签字：本门为 WO 专项静态门，已有 npm 别名可手动跑；本体 §7 未宣称它已自动化，"
        + "故保留手动不推翻任何已归档评审结论。触发时机：改动其 guardedPaths 覆盖的文件时，由该 WO 的 dev 手动跑。"
        + "是否值得并入 gates 需评估 gate 时长成本（CI 约 28 分钟），该评估属 PRD §2.2 非目标，另立单。";
    } else if (v.binding !== "NONE") {
      entry.notes = `已在自动路径内（${v.binding}，由 ${(v.callers || []).join(" / ")} 调用），非手动门。`;
    }
  }
  if (claim.verdict && claim.verdict !== "OK") {
    entry.notes = (entry.notes ? entry.notes + " " : "") + `本体宣称与现实不符（${claim.verdict}）：§7 行${claim.ontologyLine} 称「${claim.claimed}」，现算 binding=${claim.actual}。`;
  }
  gates[file] = entry;
}

writeFileSync(
  join(ROOT, "scripts/gate-ledger.json"),
  JSON.stringify({ version: 1, gates }, null, 2) + "\n",
  "utf8",
);
const never = Object.values(gates).filter((g) => g.provenRed.kind === "NEVER").length;
const noPath = Object.entries(gates).filter(([, g]) => !g.guardedPaths.length);
console.log(`账已生成：${Object.keys(gates).length} 条 · provenRed NEVER ${never} 条 · 无 guardedPaths ${noPath.length} 条`);
for (const [f] of noPath) console.log(`  ⚠ 抽不到 guardedPaths，需人工补：${f}`);
