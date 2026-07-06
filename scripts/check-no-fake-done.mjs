#!/usr/bin/env node
/**
 * 门 `no-fake-done:check`（PRD-trustworthy-self-accounting WO-1 · 不变量 R-NO-FAKE-DONE · 断点 G-16）。
 *
 * 病根（PRD §1/§2）：平台对外卖"真实数据→本体→规则→求解器→答案，缺了诚实报缺口"，
 * 对自己却用一套**手打状态字**的账本（`docs/work-queue.json` 的 `status:"DONE"`，`collab-queue.mjs`
 * 的 done 命令只 `set(status)`、从不跑 acceptance、从不查制品）——所以能诈：一张 DONE 可以把
 * "十个算法完成"记成完成，而实际引用的求解器**根本不存在**（幽灵制品）。
 *
 * 本门让"完成"构造即真：遍历每张自我账目（work-queue DONE），执行它自带的 `acceptance`——
 * 但 assert 是**自然语言散文**（非可执行代码），所以门**不直接 curl 跑**，而是从 assert/run 里
 * **抽取被引用的制品锚点**（当前实现：求解器 key，正则 `/a/v1/solvers/<key>/invoke`），再对
 * **真实制品集**（DataCore `SOLVER_REGISTRY` 单一来源）做**存在性静态校验**：
 *   - 引用了不存在的求解器 key（幽灵）→ 该 DONE = **FAKE**（诈账）；
 *   - DONE 但 `acceptance` 缺失 / `criteria` 空 → 无从校验 → **UNVERIFIABLE**（同 FAKE 处置）。
 *
 * 教科书级铁证（PRD §6.1）：`MULTISRC-FUSION`(DONE) 的 6 条 curl 验收全打
 * `/a/v1/solvers/source_conflict/invoke`，但 `source_conflict` **全仓零命中**（真求解器 key 是
 * `multisource_fusion`）——验收一执行即 404。本门把它照出为 FAKE。
 *
 * 棘轮（ratchet · 关键 · 仿 `check-debattery.mjs`）：当前存量本就有诈账/无验证 DONE，
 * `scripts/no-fake-done.baseline.json` **诚实记录**这批已知洞（非洗白·每条注明待 WO-6 回炉重置为
 * 开放缺口）。门只在**出现基线外的新 FAKE / 新 UNVERIFIABLE**（或基线该缩未缩）时红。
 * 新 DONE 引用幽灵制品即红（不得进基线）。
 *
 * 确定性（R6）：纯静态读文件 + 正则 + 集合运算，无网络/时钟/随机——无需起服务。
 * 事件语义（PRD §0 L15）：查出 FAKE → 报 `selfaccount.fake_detected`（NOTIFY·门为静态只报清单，
 * 真事件入 outbox 属运行时 WO-2）。
 *
 * 诚实边界：本门只静态守"求解器 key 存在性"这一类制品锚（work-queue DONE 的 acceptance 里最可靠、
 * 最确定的引用）。更广的端点/契约/文件引用校验，以及"代表问经 QOS NL 真跑答出"的运行时 E2E 判据，
 * 属 WO-2（Capability 一等对象 + verifiedStatus 派生）——不在本静态门内。
 *
 * 用法：node scripts/check-no-fake-done.mjs [--update]   （package.json: "no-fake-done:check"）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const QUEUE = join(ROOT, "docs", "work-queue.json");
const REGISTRY = join(ROOT, "apps", "datacore", "src", "solvers", "solver-registry.ts");
const BASELINE = join(ROOT, "scripts", "no-fake-done.baseline.json");

const UNVERIFIABLE_REASON =
  "DONE 但无 acceptance.criteria，无从静态校验制品；诚实记录·待 WO-6 回炉重置为开放缺口。";

/** 真实制品集：DataCore SOLVER_REGISTRY 单一来源（静态读源码，不依赖 dist/起服务）。 */
function realSolverKeys() {
  if (!existsSync(REGISTRY)) {
    console.error(`✗ no-fake-done:check：找不到求解器单一来源 ${REGISTRY}`);
    process.exit(1);
  }
  const src = readFileSync(REGISTRY, "utf8");
  const keys = new Set();
  const re = /\{\s*key:\s*"([a-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(src))) keys.add(m[1]);
  if (keys.size < 10) {
    console.error(`✗ no-fake-done:check：SOLVER_REGISTRY 解析异常（仅 ${keys.size} key）——拒绝据此裁决（fail-closed）`);
    process.exit(1);
  }
  return keys;
}

/** 从一条 acceptance criterion（含 method.run）抽取被引用的求解器 key。 */
const SOLVER_REF_RE = /\/a\/v1\/solvers\/([a-z0-9_]+)\/invoke/g;
function extractSolverRefs(acc) {
  const refs = new Set();
  const scan = (s) => {
    if (typeof s !== "string") return;
    SOLVER_REF_RE.lastIndex = 0;
    let m;
    while ((m = SOLVER_REF_RE.exec(s))) refs.add(m[1]);
  };
  for (const c of acc.criteria ?? []) { scan(c.assert); scan(c.run); }
  for (const mm of acc.method ?? []) scan(mm.run);
  return refs;
}

/** 分类一张 DONE：null(干净) | {id,kind:"FAKE",ghosts} | {id,kind:"UNVERIFIABLE"}。 */
function classify(item, realKeys) {
  const acc = item.acceptance;
  if (!acc || !Array.isArray(acc.criteria) || acc.criteria.length === 0) {
    return { id: item.id, kind: "UNVERIFIABLE" };
  }
  const refs = extractSolverRefs(acc);
  const ghosts = [...refs].filter((k) => !realKeys.has(k)).sort();
  if (ghosts.length) return { id: item.id, kind: "FAKE", ghosts };
  return null;
}

// ── 主流程 ────────────────────────────────────────────────────────────────
const realKeys = realSolverKeys();
const wq = JSON.parse(readFileSync(QUEUE, "utf8"));
const done = (wq.items ?? []).filter((i) => i.status === "DONE").sort((a, b) => a.id.localeCompare(b.id));

const fakes = [];        // {id, ghosts}
const unverifiable = []; // {id}
for (const it of done) {
  const c = classify(it, realKeys);
  if (!c) continue;
  if (c.kind === "FAKE") fakes.push({ id: c.id, ghosts: c.ghosts });
  else unverifiable.push({ id: c.id });
}

// ── --update：诚实重写基线（当前已知诈账/无验证 DONE 快照） ──────────────────
if (process.argv.includes("--update")) {
  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  const out = {
    _comment:
      "no-fake-done 棘轮基线（诚实记录当前已知诈账 / 无验证 DONE·非洗白）。每条待 PRD-trustworthy-self-accounting WO-6 回炉重置为开放缺口。门只在出现基线外的新 FAKE/UNVERIFIABLE 时红。",
    fake: {},
    unverifiable: {},
  };
  for (const f of fakes) {
    out.fake[f.id] =
      (prev.fake && prev.fake[f.id]) ||
      `acceptance 引用幽灵求解器 ${f.ghosts.join("/")}（SOLVER_REGISTRY 零命中）→ 制品缺失=诈。待 WO-6 回炉重置为开放缺口。`;
  }
  for (const u of unverifiable) {
    out.unverifiable[u.id] = (prev.unverifiable && prev.unverifiable[u.id]) || UNVERIFIABLE_REASON;
  }
  writeFileSync(BASELINE, JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ no-fake-done 基线已更新：${fakes.length} FAKE + ${unverifiable.length} UNVERIFIABLE（诚实记录·待 WO-6 回炉）。`);
  process.exit(0);
}

// ── 校验：基线外的新 FAKE/UNVERIFIABLE → 红 ────────────────────────────────
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { fake: {}, unverifiable: {} };
const baseFake = baseline.fake ?? {};
const baseUnv = baseline.unverifiable ?? {};

const newFakes = fakes.filter((f) => !(f.id in baseFake));
const newUnv = unverifiable.filter((u) => !(u.id in baseUnv));

// 基线该缩未缩：基线登记但当前已不再命中（已修）→ 提示收紧。
const curFakeIds = new Set(fakes.map((f) => f.id));
const curUnvIds = new Set(unverifiable.map((u) => u.id));
const shrunkFake = Object.keys(baseFake).filter((id) => !curFakeIds.has(id));
const shrunkUnv = Object.keys(baseUnv).filter((id) => !curUnvIds.has(id));

console.log(`· no-fake-done：扫 ${done.length} 张 DONE 自我账目（求解器 key 存在性静态校验，单一来源 SOLVER_REGISTRY=${realKeys.size} key）`);
console.log(`· FAKE(引用幽灵求解器) ${fakes.length}（基线 ${Object.keys(baseFake).length}）· UNVERIFIABLE(空验收) ${unverifiable.length}（基线 ${Object.keys(baseUnv).length}）`);

// selfaccount.fake_detected 事件语义（NOTIFY·静态门只报清单）。
for (const f of fakes) {
  console.log(`  selfaccount.fake_detected: ${f.id} → 引用幽灵求解器 ${f.ghosts.join("/")}（真求解器集无此 key）`);
}
for (const u of unverifiable) {
  console.log(`  selfaccount.fake_detected: ${u.id} → UNVERIFIABLE（DONE 无 acceptance.criteria·无从校验）`);
}

if (shrunkFake.length || shrunkUnv.length) {
  console.log(`· 已收窄：FAKE -${shrunkFake.length}${shrunkFake.length ? "("+shrunkFake.join(",")+")" : ""} · UNVERIFIABLE -${shrunkUnv.length}${shrunkUnv.length ? "("+shrunkUnv.join(",")+")" : ""}（已修→可 \`pnpm no-fake-done:check --update\` 收紧基线，或 WO-6 回炉重置为开放缺口）`);
}

if (newFakes.length || newUnv.length) {
  console.error("\n✗ no-fake-done:check 未通过（出现基线外的新诈账 / 无验证 DONE → 违反 R-NO-FAKE-DONE）：");
  for (const f of newFakes) {
    console.error(`  - FAKE ${f.id}：acceptance 引用幽灵求解器 ${f.ghosts.join("/")}（SOLVER_REGISTRY 零命中）→ 制品缺失=诈`);
  }
  for (const u of newUnv) {
    console.error(`  - UNVERIFIABLE ${u.id}：DONE 但无 acceptance.criteria → 无从校验（同 FAKE 处置）`);
  }
  console.error("\n  修法：① 若确未完成 → 别标 DONE（打回开放缺口·R-NO-FAKE-DONE）；② 若已完成 → 让 acceptance 引用真存在的制品（求解器 key ∈ SOLVER_REGISTRY）并补齐 criteria；③ 存量诈账（回炉在办）经审核后经 `--update` 记入基线（诚实记录·非洗白）。");
  process.exit(1);
}

console.log("\n✓ no-fake-done:check 通过（无基线外的新 FAKE/UNVERIFIABLE；存量见基线，待 WO-6 回炉重置为开放缺口）。");
