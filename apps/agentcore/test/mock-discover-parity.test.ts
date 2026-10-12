/**
 * WO-MOCK-DISCOVER-PARITY · mock `discover("solvers")` 与真 A 侧**同口径候选集合相等**（本单的牙）。
 *
 * 病灶（派单实测，本单复核成立）：
 *   · mock 侧 `MockCatalogClient.discover("solvers")` 手抄 **5 条**，真 A 侧论域
 *     `SOLVER_CATALOG + COCKPIT_SOLVER_CATALOG` 本单实测 **22+18 = 40 条** —— 内存模式下
 *     模型看到的候选少 8 倍，且测试完全看不出来（mock 返回什么，测试就以为世界是什么样）。
 *   · 形态：「我用『mock 返回了东西』当作『mock 返回的是对的东西』的证据。」
 *   · 同族旧账：`solver-registry.ts` 头注曾点名一个 `mock-solver-registry-parity` 用例，
 *     **该用例从未存在**（写在注释里的纪律不是机制）——注册表因此悄悄漂成 59/61。
 *
 * 口径（照抄真 A 侧 `apps/datacore/src/catalog.ts` CatalogService.discover，不自定义）：
 *   · 论域 = SOLVER_CATALOG + COCKPIT_SOLVER_CATALOG，**整张 GENERIC_SOLVER_CATALOG 不在内**
 *     （A 侧 docstring 自陈该档是「agent 上下文预算」候选清单，不进 QOS 场景 discover）；
 *   · 两边都**现算**，不写死 40；断言**集合相等**不是数量相等；
 *   · 变异反证：A 侧加一个求解器而 mock 不动 ⇒ 红在「集合对不上，缺哪个 key」。
 *
 * ⚠ 诚实边界（同 keyprops-ontology-parity 的房规）：本测试把 A 侧目录**当文本读**
 *   （跨 app import 源码违反 contracts-only-shared），证明的是「mock 候选键集与 catalog.ts
 *   **声明**逐字相等」；运行期 feature 过滤（如 plan_audit 的 view.plan-audit 关 tenant 时消失）
 *   由 datacore 侧 catalog.test 守，两半合起来才是全链。mock 世界 feature 全开，
 *   故基准 = 全目录键集。
 *
 * 反假绿设计：
 *   §1 抽取器金丝雀（已知必中 key / 每条目恰好一个 key / 三段非空）——金丝雀不中 = **工具坏了**，
 *      不许读作「集合干净」；金丝雀与主判据**共用同一份抽取器**，不各抄一份正则。
 *   §2 注册表全集 == A 侧三档并集（59/61 漂移那一半也钉死）。
 *   §3 pool 归属逐条 == A 侧目录归属（`process_flow_time` 在 GENERIC 档却 domain:"decision" ——
 *      这条实测例外判死了「拿 domain 当论域判据」的捷径）。
 *   §4 接缝：真跑 `createMockDataCore().catalog.discover("solvers")`，断言键集 == A 侧论域现算集。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, stripComments } from "./factlock.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { MOCK_SOLVER_REGISTRY } from "../src/mocks/solver-registry.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";

const CTX: ToolAuthCtx = { tenantId: "demo", userId: "u1", roles: ["planner"] } as ToolAuthCtx;

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

export interface CatalogPools {
  scenario: string[];
  cockpit: string[];
  generic: string[];
}

/**
 * 从 catalog.ts 文本现算三档键集。
 * 抽不出来时抛错（**工具坏了**），绝不返回空集冒充「目录为空」。
 */
export function extractCatalogPools(): CatalogPools {
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

// ---------------------------------------------------------------------------

describe("WO-MOCK-DISCOVER-PARITY · mock discover(solvers) 与真 A 侧同口径候选集合相等", () => {
  const pools = extractCatalogPools();
  const universe = new Set([...pools.scenario, ...pools.cockpit]); // A 侧 discover 论域（现算，不写死 40）

  it("§1 金丝雀：抽取器没瞎（已知必中 key + 各档非空）", () => {
    expect(pools.scenario, "工具坏了：SOLVER_CATALOG 必含 capacity_forecast").toContain("capacity_forecast");
    expect(pools.cockpit, "工具坏了：COCKPIT_SOLVER_CATALOG 必含 cockpit_kpi").toContain("cockpit_kpi");
    expect(pools.generic, "工具坏了：GENERIC_SOLVER_CATALOG 必含 generic_inference").toContain("generic_inference");
    // 三档键集互不相交（否则论域定义本身被改歪了，先报工具/口径问题再谈集合）
    const s = new Set(pools.scenario);
    const overlap = pools.cockpit.filter((k) => s.has(k));
    expect(overlap, "scenario 与 cockpit 出现同 key——A 侧目录结构变了，先复核口径").toEqual([]);
  });

  it("§2 mock 注册表全集 == A 侧三档并集（注册表漂移那一半也钉死）", () => {
    const got = new Set(MOCK_SOLVER_REGISTRY.map((it) => it.key));
    const want = new Set([...pools.scenario, ...pools.cockpit, ...pools.generic]);
    const { missing, extra } = diff(want, got);
    expect(
      { missing, extra },
      "mock 注册表与 A 侧全集对不上（missing=A 侧有而 mock 缺；extra=mock 有而 A 侧无）",
    ).toEqual({ missing: [], extra: [] });
  });

  it("§3 每条 pool 归属 == A 侧目录归属（domain 不能当论域判据：process_flow_time 是实测例外）", () => {
    const byPool = { scenario: [] as string[], cockpit: [] as string[], generic: [] as string[] };
    for (const it of MOCK_SOLVER_REGISTRY) byPool[it.pool].push(it.key);
    for (const pool of ["scenario", "cockpit", "generic"] as const) {
      const { missing, extra } = diff(new Set(pools[pool]), new Set(byPool[pool]));
      expect(
        { pool, missing, extra },
        `pool="${pool}" 归属与 A 侧目录对不上`,
      ).toEqual({ pool, missing: [], extra: [] });
    }
  });

  it("§4 接缝：discover(\"solvers\") 候选键集 == A 侧论域现算集（集合相等，不是数量相等）", async () => {
    const dc = createMockDataCore();
    const { items } = await dc.catalog.discover(CTX, "solvers");
    const got = new Set(items.map((it) => it.key));
    const { missing, extra } = diff(universe, got);
    expect(
      { missing, extra, mockCount: got.size, aSideCount: universe.size },
      "mock discover 候选集与真 A 侧论域对不上——缺哪个/多哪个 key 见 missing/extra",
    ).toEqual({ missing: [], extra: [], mockCount: universe.size, aSideCount: universe.size });
    // 反向金丝雀：过滤真的在滤（若 pool 过滤失效把 generic 档全放进来，§4 主断言会红；
    // 这条把「滤了什么」显式命名，免得报错只剩一堆差集）
    expect(got.has("assignment_optimize"), "generic 档求解器不该出现在 discover 论域").toBe(false);
    expect(
      MOCK_SOLVER_REGISTRY.some((it) => it.key === "assignment_optimize"),
      "金丝雀：assignment_optimize 必须在注册表全集里（不在 ⇒ 是注册表缺，不是 discover 滤对了）",
    ).toBe(true);
  });

  it("§5 带 query 时 slice(0,20)（照抄 A 侧 agent 上下文预算截断）且过滤仍在", async () => {
    const dc = createMockDataCore();
    const { items } = await dc.catalog.discover(CTX, "solvers", "产能");
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(20);
    expect(items.every((it) => universe.has(it.key)), "query 结果必须仍落在 A 侧论域内").toBe(true);
    expect(items.map((it) => it.key), "金丝雀：『产能』必中 capacity_forecast").toContain("capacity_forecast");
  });
});
