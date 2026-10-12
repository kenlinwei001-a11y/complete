/**
 * WO-TITLE-DIVERGENCE · **同一 widget key 在 mock 与真后端的 title/unit 逐字节相等**（接缝测试）。
 *
 * ── 为什么有这条测试 ──────────────────────────────────────────────────────────
 * ① aop-base：后端 unit「亿」（battery.ts revenueOf = 万套×元/套 ÷ 10000 ⇒ 亿；
 *    base-registry revenue.unit 亦为「亿」），mock fixtures 写「万」——屏上数字含义差 4 个数量级。
 * ② oee-trend：后端 title「OEE 14 日趋势」，mock 写「OEE 7日趋势」——实测两侧数据都是 14 天
 *    （query days:14 · MSW 桩 TS_AGG_POINTS 长 14），错的只是文案。
 * 两条都在 `fixtures.ts` 自称「与后端 DASH_LAYOUT 同步，门A 守不漂」的注释底下活着——
 * 门A（check-cockpit-widgets.mjs）只查 widget type 在不在，一个字的文案都不比。
 * 本测试就是把那句话变成机器可验的断言。
 *
 * ── 与门的关系 ────────────────────────────────────────────────────────────────
 * 判据实现**不在这里另写一份**：抽取与比对都从 `scripts/lib/widget-copy.mjs` 动态 import，
 * 与 `mock-fidelity:check` 载体③ 是同一份代码（铁律 0.6：各抄一份 = 装饰品）。
 * 门管「进仓前拦住」，本测试管「四包 test 里红出来」——两条路咬的是同一条缝。
 *
 * §1 金丝雀：判据自身没瞎（变异输入必须判出分叉，相同输入必须判零分叉）。
 * §2 真源接缝：读两侧真文件，同 key widget 的 title/unit 逐字节相等；
 *    交集非空是下界断言——交集若空，「逐字节相等」恒真，那是哑门。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");
const LIB = join(REPO_ROOT, "scripts/lib/widget-copy.mjs");
const MOCK_FIXTURES = join(REPO_ROOT, "apps/frontend-shell/src/mocks/fixtures.ts");
const BACKEND_SERVICE = join(REPO_ROOT, "apps/datacore/src/synthetic/service.ts");

type WidgetEntry = { key: string; title: string; type: string; unit?: string; line: number };
type WidgetDiff = { field: string; mock: unknown; backend: unknown };
type Lib = {
  widgetEntries: (src: string) => WidgetEntry[];
  compareWidget: (a: WidgetEntry, b: WidgetEntry) => WidgetDiff[];
};

/** 判据从**共享实现**取 —— 与 mock-fidelity:check 载体③ 同一份代码，不另抄。 */
async function loadLib(): Promise<Lib> {
  return (await import(/* @vite-ignore */ LIB)) as Lib;
}

describe("§1 · 判据自身没瞎（金丝雀先说话）", () => {
  it("相同文案判零分叉 · unit 万vs亿必咬 · title 差字必咬 · 一侧缺 unit 必咬", async () => {
    const { compareWidget } = await loadLib();
    const base: WidgetEntry = { key: "aop-base", title: "AOP 基准营收 (亿)", type: "kpi", unit: "亿", line: 1 };
    expect(compareWidget(base, { ...base })).toEqual([]);
    // ① 的变异原形：单位 万 vs 亿
    const unitDiff = compareWidget({ ...base, unit: "万" }, { ...base });
    expect(unitDiff).toHaveLength(1);
    expect(unitDiff[0]!.field).toBe("unit");
    // ② 的变异原形：标题 7日 vs 14 日
    const titleDiff = compareWidget(
      { key: "oee-trend", title: "OEE 7日趋势", type: "chart", line: 1 },
      { key: "oee-trend", title: "OEE 14 日趋势", type: "chart", line: 1 },
    );
    expect(titleDiff).toHaveLength(1);
    expect(titleDiff[0]!.field).toBe("title");
    // 一侧缺 unit ⇒ KPI 数字没量纲，也算分叉
    expect(compareWidget({ ...base, unit: undefined }, { ...base })).toHaveLength(1);
  });

  it("抽取器形状判据：widget 收得进，视图条目/feature 条目收不进", async () => {
    const { widgetEntries } = await loadLib();
    const src = [
      `const a = { key: "w1", type: "kpi", title: "可供给 (万)", unit: "万", query: { kind: "solver", solverKey: "x" } };`,
      // 视图条目：有 key/title 但无 type/query ⇒ 不是 widget，不许收（否则 aop 旧入口会被误配）
      `const b = { key: "aop", title: "年度规划（旧）", renderer: "aop", layout: {} };`,
      // feature 条目：无 title ⇒ 不许收
      `const c = { key: "view.aop", name: "年度规划（旧入口）", level: "VIEW", defaultOn: true };`,
    ].join("\n");
    const got = widgetEntries(src);
    expect(got.map((w) => w.key)).toEqual(["w1"]);
    expect(got[0]!.unit).toBe("万");
  });
});

describe("§2 · 真源接缝：同 key widget 的 title/unit 两侧逐字节相等", () => {
  it("mock fixtures ↔ datacore service.ts 全交集零分叉", async () => {
    const { widgetEntries, compareWidget } = await loadLib();
    const mockWidgets = widgetEntries(readFileSync(MOCK_FIXTURES, "utf8"));
    const beWidgets = widgetEntries(readFileSync(BACKEND_SERVICE, "utf8"));

    // 🐤 金丝雀：两侧都得真抽到，且 ①② 修过的那两个 key 必须在场——
    //    抽不到 ⇒ 下面「零分叉」是因为没得比，不许报绿。
    expect(mockWidgets.length).toBeGreaterThanOrEqual(10);
    expect(beWidgets.length).toBeGreaterThanOrEqual(10);
    for (const k of ["aop-base", "oee-trend"]) {
      expect(mockWidgets.some((w) => w.key === k), `mock 侧抽不到 ${k}`).toBe(true);
      expect(beWidgets.some((w) => w.key === k), `后端侧抽不到 ${k}`).toBe(true);
    }

    const beByKey = new Map(beWidgets.map((w) => [w.key, w]));
    const shared = mockWidgets.filter((m) => beByKey.has(m.key));
    // 🔴 下界断言：交集若空，「逐字节相等」恒真——那是哑门，不是绿。
    expect(shared.length, "两侧 widget key 交集为空 ⇒ 本测试什么都没证明").toBeGreaterThanOrEqual(10);

    const diffs: string[] = [];
    for (const m of shared) {
      for (const d of compareWidget(m, beByKey.get(m.key)!)) {
        diffs.push(
          `${m.key}.${d.field}: mock=${JSON.stringify(d.mock) ?? "（无）"} vs 后端=${JSON.stringify(d.backend) ?? "（无）"}`,
        );
      }
    }
    expect(diffs, `mock 与真后端的 widget 文案分叉：\n${diffs.join("\n")}`).toEqual([]);
  });
});
