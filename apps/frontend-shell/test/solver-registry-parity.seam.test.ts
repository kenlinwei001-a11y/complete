import { describe, expect, it } from "vitest";
import { REPO_ROOT, stripComments } from "./factlock";
import { tokenFor } from "@/mocks/db";
import { ACCOUNTS } from "@/mocks/fixtures";
import {
  MOCK_KNOWN_SOLVER_KEYS,
  MOCK_SOLVER_REGISTRY,
  MOCK_SOLVER_REGISTRY_FULL,
  SOLVER_DISCOVERY_DISPLAY_KEYS,
} from "@/mocks/solverRegistry";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * WO-MOCK-FE-REGISTRY-PARITY · 前端 mock 求解器词表与真 A 侧 catalog 的**集合对拍**（本单的牙）。
 *
 * ── 病灶 ──────────────────────────────────────────────────────────────────────
 * `handlers.ts` 曾内联手抄 4 条 `MOCK_SOLVER_REGISTRY`，一身二役：
 *   · 发现页 `GET /a/v1/solvers/registry` 数据源（子集尚可辩称「代表性」）；
 *   · `POST /b/v1/skills/:id/publish` 引用存在性探针的「哪些求解器真的注册了」——
 *     真后端 `probeMissingRefs` 的论域 = A 侧 `discover("solvers")` =
 *     `SOLVER_CATALOG + COCKPIT_SOLVER_CATALOG`（本单实测 22+18=40），
 *     拿 4 条手抄清单判死路 ⇒ 真注册的 kit_readiness 误判 422、GENERIC 档
 *     selection_optimize 反被放行，双向皆错（行为证据见
 *     `skill-publish-probe-parity.seam.test.ts`，本文件不重复造那份行为探针）。
 *
 * ── 判据形态 ──────────────────────────────────────────────────────────────────
 * 两边都**现算**，断言**集合相等**（不是数量相等）：mock 侧读 `mocks/solverRegistry.ts`
 * 的 61 条全集镜像，A 侧读 `apps/datacore/src/catalog.ts` **文本**（跨 app import 源码
 * 违反 contracts-only-shared；文本对拍证明的是「mock 键集与 catalog.ts 声明逐字相等」，
 * 运行期 feature 过滤由 datacore 侧 catalog.test 守——同 agentcore `mock-discover-parity`
 * 的诚实边界）。变异反证：任一侧加/删一个 key ⇒ 红在「缺/多哪个 key」，不是数量不等。
 *
 * ── 反假绿设计 ────────────────────────────────────────────────────────────────
 *   §1 金丝雀：抽取器没瞎（已知必中 key / 各档非空 / 档间不相交）——金丝雀不中 =
 *      **工具坏了**，不许读作「集合干净」；金丝雀与主判据**共用同一份抽取器**。
 *   §2 mock 全集 == A 侧三档并集（61）。
 *   §3 每条 pool 归属 == A 侧目录归属（`process_flow_time` 在 GENERIC 档却
 *      domain:"decision" —— 这条实测例外判死了「拿 domain 当论域判据」的捷径）。
 *   §4 发布探针词表 == A 侧 discover 论域现算集（scenario+cockpit，**排除 generic 档**）。
 *   §5 发现页 seam：真打 `GET /a/v1/solvers/registry`，下发的恰是策展 4 条且逐字段
 *      等于全集镜像里的同 key 条目（派生，不是第二份手抄）；categories 端点论域同源。
 */

// ---------------------------------------------------------------------------
// 抽取器 · A 侧目录真相源（catalog.ts 文本 → 各档键集）
// ---------------------------------------------------------------------------

const CATALOG_SRC = "apps/datacore/src/catalog.ts";

/** 跳过字符串/模板串字面量（catalog.ts 的描述里含 `[`、`{`、`key` 字样，不跳会把配平算歪）。 */
function skipString(text: string, i: number): number {
  const q = text[i]!;
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === "\\") { j += 2; continue; }
    if (text[j] === q) return j + 1;
    j += 1;
  }
  return j;
}

/** 从 `startIdx`（必须正好是 `open`）取到配平的 `close`，含两端；不配平返 null。 */
function balanced(text: string, startIdx: number, open: string, close: string): string | null {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") { i = skipString(text, i) - 1; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

/** 按**顶层**逗号切分数组体（跳字符串）。 */
function splitTopLevel(arrBody: string): string[] {
  const inner = arrBody.slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(inner, i);
      cur += inner.slice(i, end);
      i = end - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

interface CatalogPools {
  scenario: string[];
  cockpit: string[];
  generic: string[];
}

/**
 * 从 catalog.ts 文本现算三档键集。
 * 抽不出来时抛错（**工具坏了**），绝不返回空集冒充「目录为空」。
 */
function extractCatalogPools(): CatalogPools {
  const text = stripComments(readFileSync(join(REPO_ROOT, CATALOG_SRC), "utf8"));
  const one = (decl: string): string[] => {
    const m = new RegExp(`export const ${decl}[^=]*=`).exec(text);
    if (!m) throw new Error(`抽取器坏了：catalog.ts 里找不到 export const ${decl}`);
    const openIdx = text.indexOf("[", m.index + m[0].length);
    if (openIdx < 0) throw new Error(`抽取器坏了：${decl} 声明后找不到数组开括号`);
    const body = balanced(text, openIdx, "[", "]");
    if (!body) throw new Error(`抽取器坏了：${decl} 数组体配平失败`);
    const entries = splitTopLevel(body);
    const keys = entries.map((e) => {
      const km = /key:\s*"([^"]+)"/.exec(e);
      if (!km) throw new Error(`抽取器坏了：${decl} 有条目抽不出 key（条目头 80 字符：${e.slice(0, 80)}）`);
      return km[1]!;
    });
    if (keys.length === 0) throw new Error(`抽取器坏了：${decl} 抽出 0 条`);
    return keys;
  };
  return { scenario: one("SOLVER_CATALOG"), cockpit: one("COCKPIT_SOLVER_CATALOG"), generic: one("GENERIC_SOLVER_CATALOG") };
}

const diff = (want: Set<string>, got: Set<string>) => ({
  missing: [...want].filter((k) => !got.has(k)).sort(),
  extra: [...got].filter((k) => !want.has(k)).sort(),
});

const token = tokenFor(ACCOUNTS.find((a) => a.username === "planner")!);
async function getJson(path: string): Promise<Record<string, any>> {
  const res = await fetch(`http://127.0.0.1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, any>;
}

// ---------------------------------------------------------------------------

describe("WO-MOCK-FE-REGISTRY-PARITY · 前端 mock 求解器词表与真 A 侧集合对拍", () => {
  const pools = extractCatalogPools();
  const aSideUniverse = new Set([...pools.scenario, ...pools.cockpit]); // discover 论域（现算，不写死 40）
  const aSideFull = new Set([...pools.scenario, ...pools.cockpit, ...pools.generic]); // 全集（现算，不写死 61）

  it("§1 金丝雀：抽取器没瞎（已知必中 key + 各档非空 + 档间不相交）", () => {
    expect(pools.scenario, "工具坏了：SOLVER_CATALOG 必含 capacity_forecast").toContain("capacity_forecast");
    expect(pools.cockpit, "工具坏了：COCKPIT_SOLVER_CATALOG 必含 cockpit_kpi").toContain("cockpit_kpi");
    expect(pools.generic, "工具坏了：GENERIC_SOLVER_CATALOG 必含 generic_inference").toContain("generic_inference");
    // 镜像侧金丝雀：mock 全集自身也不能是空集/缺腿（否则 §2 的「相等」可能是两个空集相认）
    const mockKeys = new Set(MOCK_SOLVER_REGISTRY_FULL.map((it) => it.key));
    expect(mockKeys.has("capacity_forecast"), "工具坏了：mock 全集缺 capacity_forecast").toBe(true);
    expect(mockKeys.has("process_flow_time"), "工具坏了：mock 全集缺 process_flow_time").toBe(true);
    // 三档键集互不相交（否则论域定义本身被改歪了，先报工具/口径问题再谈集合）
    const s = new Set(pools.scenario);
    const overlap = pools.cockpit.filter((k) => s.has(k));
    expect(overlap, "scenario 与 cockpit 出现同 key——A 侧目录结构变了，先复核口径").toEqual([]);
  });

  it("§2 mock 注册表全集 == A 侧三档并集（61 漂移那一半也钉死）", () => {
    const got = new Set(MOCK_SOLVER_REGISTRY_FULL.map((it) => it.key));
    const { missing, extra } = diff(aSideFull, got);
    expect(
      { missing, extra },
      "mock 全集与 A 侧全集对不上（missing=A 侧有而 mock 缺；extra=mock 有而 A 侧无）",
    ).toEqual({ missing: [], extra: [] });
  });

  it("§3 每条 pool 归属 == A 侧目录归属（domain 不能当论域判据：process_flow_time 是实测例外）", () => {
    const byPool = { scenario: [] as string[], cockpit: [] as string[], generic: [] as string[] };
    for (const it of MOCK_SOLVER_REGISTRY_FULL) byPool[it.pool].push(it.key);
    for (const pool of ["scenario", "cockpit", "generic"] as const) {
      const { missing, extra } = diff(new Set(pools[pool]), new Set(byPool[pool]));
      expect(
        { pool, missing, extra },
        `pool="${pool}" 归属与 A 侧目录对不上`,
      ).toEqual({ pool, missing: [], extra: [] });
    }
  });

  it("§4 发布探针词表 == A 侧 discover 论域现算集（scenario+cockpit，排除 generic 档）", () => {
    const { missing, extra } = diff(aSideUniverse, new Set(MOCK_KNOWN_SOLVER_KEYS));
    expect(
      { missing, extra, mockCount: MOCK_KNOWN_SOLVER_KEYS.size, aSideCount: aSideUniverse.size },
      "探针词表与真后端 probeMissingRefs 的 discover 论域对不上——缺/多哪个 key 见 missing/extra",
    ).toEqual({ missing: [], extra: [], mockCount: aSideUniverse.size, aSideCount: aSideUniverse.size });
    // 反向金丝雀：过滤真的在滤（把「滤了什么」显式命名，免得报错只剩一堆差集）
    expect(MOCK_KNOWN_SOLVER_KEYS.has("kit_readiness"), "scenario 档 kit_readiness 必须在探针词表里").toBe(true);
    expect(MOCK_KNOWN_SOLVER_KEYS.has("selection_optimize"), "generic 档不该进探针词域").toBe(false);
    expect(
      MOCK_SOLVER_REGISTRY_FULL.some((it) => it.key === "selection_optimize"),
      "金丝雀：selection_optimize 必须在全集里（不在 ⇒ 是全集缺，不是探针滤对了）",
    ).toBe(true);
  });

  it("§5 发现页 seam：下发的恰是策展 4 条，且逐字段等于全集镜像同 key 条目（派生非手抄）", async () => {
    // 策展 key 自证 ⊆ 全集（少一条 = 策展漂出全集，这里先报名字）
    const fullKeys = new Set(MOCK_SOLVER_REGISTRY_FULL.map((it) => it.key));
    const orphan = SOLVER_DISCOVERY_DISPLAY_KEYS.filter((k) => !fullKeys.has(k));
    expect(orphan, "策展 key 漂出全集镜像").toEqual([]);

    const body = await getJson("/a/v1/solvers/registry");
    const served = body.solvers as Record<string, any>[];
    expect(
      served.map((s) => s.key),
      "发现页下发的必须是策展 4 条（派生子集），不多不少",
    ).toEqual([...SOLVER_DISCOVERY_DISPLAY_KEYS]);
    // 逐字段等于全集镜像（剥掉 mock 内部 pool）——是「同一份条目的投影」，不是第二份手抄
    for (const s of served) {
      const src = MOCK_SOLVER_REGISTRY_FULL.find((it) => it.key === s.key)!;
      const want: Record<string, unknown> = { ...src };
      delete want.pool; // pool 是 mock 内部归属字段，不下发（真后端响应里没有它）
      expect(s, `发现页条目 ${s.key} 与全集镜像不一致 ⇒ 有人在响应路上另抄了一份`).toEqual(want);
    }
    // mock 模块内派生件与 HTTP 下发同源（防「模块一套、handler 一套」）
    expect(MOCK_SOLVER_REGISTRY.map((s) => s.key)).toEqual([...SOLVER_DISCOVERY_DISPLAY_KEYS]);

    // categories 端点论域 = 同一个派生子集（total/uncategorized 口径诚实）
    const cats = await getJson("/a/v1/solvers/categories");
    expect(cats.total).toBe(SOLVER_DISCOVERY_DISPLAY_KEYS.length);
    expect(cats.uncategorized, "展示位有未归类成员 ⇒ MOCK_CATEGORY_OF 与策展 key 漂移").toEqual([]);
    expect(
      (cats.categories as { solverKeys: string[] }[]).flatMap((c) => c.solverKeys).sort(),
      "categories 成员并集必须恰好覆盖展示子集",
    ).toEqual([...SOLVER_DISCOVERY_DISPLAY_KEYS].sort());
  });
});
