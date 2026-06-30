#!/usr/bin/env node
/**
 * 门禁 `repo-pg-notnull:check`（WO-P0-LOCK 根因解·防同类漏配复发）。
 *
 * 根除一整类 P0：建表加了 NOT-NULL-无默认列，却让通用仓储（PgStore 写 id/tenant_id/doc[+extraColumns]，
 * PgDataColStore 写 id/tenant_id/data）去写它 → PG 在 INSERT 时 NOT NULL 违例直抛（内存仓储无约束故漏测）。
 * 正是 execution_locks（漏 extraColumns）与 merge_candidates/object_merges（用错列）翻车的根因。
 *
 * 做法（纯静态）：扫 migrations 取每表 NOT-NULL-无默认列；扫 pg.ts 取「经 PgStore/PgDataColStore 通用写入」
 * 的表及其覆盖列集（{id,tenant_id,doc}∪extraColumns 或 {id,tenant_id,data}）；凡 required ⊄ covered → 红。
 * 自定义 store（自带 INSERT SQL，不继承通用 put）不在此门范围（它们各自显式写列）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIG_DIR = join(ROOT, "apps/datacore/migrations");
const PG_FILE = join(ROOT, "apps/datacore/src/repo/pg.ts");

// 1) 解析 migrations：table -> { requiredCols:Set, hasDoc, hasData }
const tables = new Map();
for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql"))) {
  const sql = readFileSync(join(MIG_DIR, f), "utf8");
  const re = /CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/gi;
  let m;
  while ((m = re.exec(sql))) {
    const tbl = m[1];
    // 去注释行 + 反复剥离括号内内容（使 `NUMERIC(10,2)`/`DEFAULT now()` 内的逗号不干扰按列拆分）
    let body = m[2]
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    let prev;
    do {
      prev = body;
      body = body.replace(/\([^()]*\)/g, " ");
    } while (body !== prev);
    const required = new Set();
    let hasDoc = false;
    let hasData = false;
    // 一行可含多列（`id …, tenant_id …, doc …`）——按逗号拆分每个列定义/表约束
    for (const frag of body.split(",")) {
      const def = frag.trim();
      if (!def) continue;
      const u = def.toUpperCase();
      if (/^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|CHECK)\b/.test(u)) continue;
      const col = def.split(/\s+/)[0];
      if (!/^[a-z_]+$/i.test(col)) continue; // 非合法列名（括号剥离残片）→ 跳过
      if (col === "doc") hasDoc = true;
      if (col === "data") hasData = true;
      if (u.includes("NOT NULL") && !u.includes("DEFAULT") && !u.includes("PRIMARY KEY")) {
        required.add(col);
      }
    }
    // 同名表多 migration（CREATE IF NOT EXISTS / ALTER）——以首次定义为准，后续 merge required
    if (tables.has(tbl)) {
      const prev = tables.get(tbl);
      for (const c of required) prev.requiredCols.add(c);
      prev.hasDoc ||= hasDoc;
      prev.hasData ||= hasData;
    } else {
      tables.set(tbl, { requiredCols: required, hasDoc, hasData });
    }
  }
}

// 2) 解析 pg.ts：经通用 put 写入的表 + 其覆盖列
const pg = readFileSync(PG_FILE, "utf8");
const generic = new Map(); // table -> { mode:"doc"|"data", extra:Set }

/** 从 `(x) => ({ a: ..., b: ... })` 抽 extraColumns 键。 */
function parseExtraKeys(snippet) {
  const keys = new Set();
  if (!snippet) return keys;
  const objMatch = snippet.match(/=>\s*\(\{([\s\S]*?)\}\)/);
  if (!objMatch) return keys;
  for (const km of objMatch[1].matchAll(/(\w+)\s*:/g)) keys.add(km[1]);
  return keys;
}

// 2a) `new PgStore(pool, "T" [, (x)=>({...})])`
for (const m of pg.matchAll(/new PgStore\(\s*pool,\s*"(\w+)"\s*(,\s*\([\s\S]*?\}\)\s*)?\)/g)) {
  generic.set(m[1], { mode: "doc", extra: parseExtraKeys(m[2] || "") });
}
// 2b) `new PgDataColStore(pool, "T")`
for (const m of pg.matchAll(/new PgDataColStore\(\s*pool,\s*"(\w+)"\s*\)/g)) {
  generic.set(m[1], { mode: "data", extra: new Set() });
}
// 2c) 子类构造里 `super(pool, "T" [, (x)=>({...})])`（继承通用 put）
//     —— 若该子类 override 了 put（自带 SQL）则不算通用，靠 OVERRIDE_PUT 标注排除。
const OVERRIDE_PUT = new Set(); // 子类自带 put 的 → 排除（当前无）
for (const m of pg.matchAll(/super\(\s*pool,\s*"(\w+)"\s*(,\s*\([\s\S]*?\}\)\s*)?\)/g)) {
  if (OVERRIDE_PUT.has(m[1])) continue;
  generic.set(m[1], { mode: "doc", extra: parseExtraKeys(m[2] || "") });
}

// 3) 校验：每个通用写入表，required ⊆ covered
let red = false;
const ALWAYS = new Set(["id", "tenant_id"]); // 通用 put 必写
for (const [tbl, { mode, extra }] of generic) {
  const meta = tables.get(tbl);
  if (!meta) continue; // 表未在 migration（或动态建）——跳过
  const covered = new Set([...ALWAYS, mode === "data" ? "data" : "doc", ...extra]);
  // mode=doc 但表无 doc 列 → 通用 put 写 doc 必崩
  if (mode === "doc" && !meta.hasDoc) {
    console.error(
      `✗ ${tbl}: 经 PgStore 通用写入（写 doc 列）但建表无 doc 列 → PG INSERT 崩。改用 PgDataColStore 或建 doc 列。`,
    );
    red = true;
    continue;
  }
  if (mode === "data" && !meta.hasData) {
    console.error(`✗ ${tbl}: 经 PgDataColStore 写入（写 data 列）但建表无 data 列。`);
    red = true;
    continue;
  }
  const missing = [...meta.requiredCols].filter((c) => !covered.has(c));
  if (missing.length) {
    console.error(
      `✗ ${tbl}: NOT-NULL-无默认列 [${missing.join(", ")}] 未被仓储写入列集覆盖` +
        `（covered=[${[...covered].join(", ")}]）→ PG INSERT NOT NULL 违例。把它们补进 extraColumns。`,
    );
    red = true;
  }
}

if (red) {
  console.error("\nrepo-pg-notnull:check 红 —— 见上。根因解：让仓储写入列集覆盖所有 NOT-NULL-无默认列。");
  process.exit(1);
}
console.log(`repo-pg-notnull:check 绿（校验 ${generic.size} 个通用写入表 · ${tables.size} 表已扫）`);
