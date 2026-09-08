import { describe, expect, it } from "vitest";
import { SHARED_FEATURE_NAMES, assertSharedFeatureNames, type FeatureDef } from "@platform/contracts";
// ── 三份注册表的**真入口**（不是把三个字面量并排比：这里 import 的是各服务自己在跑的那个数组）──
import { FEATURE_REGISTRY as AGENTCORE_REGISTRY } from "../../agentcore/src/features/registry.js";
import { FEATURE_REGISTRY as DATACORE_REGISTRY } from "../../datacore/src/features.js";
import { FEATURE_REGISTRY as MOCK_REGISTRY } from "../src/mocks/fixtures";

/**
 * WO-VIEWNAME-SINGLE-SOURCE · SEAM-GATE：**一个功能键只许有一个名字**。
 *
 * ── 为什么必须是接缝测试，各半 unit 测不出来 ──────────────────────────────────
 * 分叉长在**三份注册表之间**，每一份自己看都是自洽的：AgentCore 写「经营驾驶舱」、
 * DataCore 写「驾驶舱」、mock 写「驾驶舱」，三份各自的 unit 全绿，而用户在
 * 「功能开通配置」页看到的与 AgentCore 里写的不是一回事。**绿测试 ≠ 能用·断在接缝**。
 *
 * ── 判据取值走真入口 ────────────────────────────────────────────────────────
 * 三个 `FEATURE_REGISTRY` 都是各服务**运行时真在用**的那个数组（AgentCore 的
 * `featureEnabled`/`intentAllowed`、DataCore 的 `resolveForUser`、mock 的
 * `/a/v1/features/registry` 桩都从它取）。所以这里比的是**运行时值**，不是源码字面量 ——
 * 谁把名字改成计算表达式、改成别处 import、改成条件分支，一样逃不掉。
 *
 * ── 三条判据 ────────────────────────────────────────────────────────────────
 *   ① 同一个键在 ≥2 份注册表里的名字**逐字节相同**（治的就是本 WO 的病）；
 *   ② 这样的键**必须在册里**（`SHARED_FEATURE_NAMES`）—— 否则「以后新加的跨服务键」
 *      又会退回三份手抄，机制形同虚设。这条是把"根治"钉死的那一条；
 *   ③ 册里不许有**死键**（一份注册表都不声明）—— 册膨胀成第二份全量注册表就没意义了。
 *
 * ── 本门为什么覆盖得比 `check-stale-claims` 的 STALE-8 宽 ────────────────────
 * 实测（2026-08-14）：STALE-8 的槽位正则是 `key: "view.<无点 slug>", name: "…"`，
 * 于是它**只看得见 2 条**分叉；本门按运行时键全集比，当场抓出 **8 条**——
 * 多出来的 6 条它一条都看不见：`view.project-sim.whatif`（slug 带点）、
 * `shell.query-dock` / `qos.agent-fallback` / `admin.plan-builder` /
 * `qos.reasoning-trace` / `qos.multi-intent-l2-decompose`（`view.` 以外的前缀）。
 * 形态照铁律 0.6：**「我用『门报了 2 条』当作『只有 2 条』的证据，而前者并不度量后者」**。
 */

type Row = { readonly source: string; readonly name: string };

/** 判据本体（**纯函数** —— 金丝雀就靠它能被单独喂样例，不许各抄一份逻辑）。 */
export function judgeNameForks(byKey: Map<string, Row[]>): string[] {
  const out: string[] = [];
  for (const [key, rows] of byKey) {
    if (rows.length < 2) continue;
    const distinct = [...new Set(rows.map((r) => r.name))];
    if (distinct.length > 1) {
      out.push(`${key}：${rows.map((r) => `${r.source}="${r.name}"`).join(" ≠ ")}`);
    }
  }
  return out;
}

const REGISTRIES: ReadonlyArray<readonly [string, readonly FeatureDef[]]> = [
  ["agentcore", AGENTCORE_REGISTRY],
  ["datacore", DATACORE_REGISTRY],
  ["frontend-mock", MOCK_REGISTRY],
];

function collect(): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const [source, defs] of REGISTRIES) {
    for (const d of defs) {
      const rows = m.get(d.key) ?? [];
      // 同一份注册表内重复键（不该有）只取第一条，免得把包内重复误报成跨服务分叉
      if (rows.some((r) => r.source === source)) continue;
      rows.push({ source, name: d.name });
      m.set(d.key, rows);
    }
  }
  return m;
}

describe("SEAM · 功能名单一真相源（三份注册表 × 同一个键 = 同一个名字）", () => {
  it("金丝雀：判据本体对**已知分叉**必咬、对一致必不咬、对单份键必不咬", () => {
    // 必咬（否则下面那条「零分叉」的否定结论是工具坏了，不是代码干净）
    expect(
      judgeNameForks(
        new Map([["view.__canary__", [{ source: "a", name: "甲" }, { source: "b", name: "乙" }]]]),
      ),
    ).toHaveLength(1);
    // 必不咬
    expect(
      judgeNameForks(
        new Map([["view.__ok__", [{ source: "a", name: "同" }, { source: "b", name: "同" }]]]),
      ),
    ).toHaveLength(0);
    // 只被一份注册表声明的本地键：判据射程之外，不许误咬
    expect(judgeNameForks(new Map([["view.__solo__", [{ source: "a", name: "独" }]]]))).toHaveLength(0);
  });

  it("金丝雀：三份注册表都真的读到了（否则 0 分叉是因为数组是空的）", () => {
    for (const [source, defs] of REGISTRIES) {
      expect(defs.length, `${source} 注册表读到 0 条 ⇒ import 坏了，不是"没有分叉"`).toBeGreaterThan(30);
      expect(defs.some((d) => d.key === "view.dash"), `${source} 缺 view.dash ⇒ 读到的不是功能册`).toBe(true);
    }
    const byKey = collect();
    expect(byKey.get("view.dash")?.length, "view.dash 该被三份都声明").toBe(3);
  });

  it("① 同一个键在 ≥2 份注册表里的名字逐字节相同", () => {
    expect(judgeNameForks(collect())).toEqual([]);
  });

  it("② 跨服务键必须在册里（`SHARED_FEATURE_NAMES`），且名字取自册", () => {
    const byKey = collect();
    const crossService = [...byKey].filter(([, rows]) => rows.length > 1).map(([k]) => k);
    // 实测 61 条（2026-08-14）。这个数只是"看得见"的锚，判据是下面两条断言而非数字本身。
    expect(crossService.length).toBeGreaterThanOrEqual(61);

    const unregistered = crossService.filter((k) => !(k in SHARED_FEATURE_NAMES));
    expect(
      unregistered,
      "这些键被 ≥2 份注册表声明却不在跨服务册里 —— 各写各的只是今天恰好还没写歪。" +
        "修法：把它们加进 packages/contracts/src/feature-names.ts 的 SHARED_FEATURE_NAMES",
    ).toEqual([]);

    for (const key of crossService) {
      for (const row of byKey.get(key) ?? []) {
        expect(row.name, `${key} 在 ${row.source} 里的名字与册不符`).toBe(SHARED_FEATURE_NAMES[key]);
      }
    }
  });

  it("③ 册里没有死键（每个键至少被一份注册表声明）", () => {
    const known = collect();
    const dead = Object.keys(SHARED_FEATURE_NAMES).filter((k) => !known.has(k));
    expect(dead, "册里这些键没有任何注册表声明 —— 册在膨胀成第二份全量注册表").toEqual([]);
  });

  it("构造期自查有牙：喂一条与册不符的条目 ⇒ 当场抛并点名该键", () => {
    expect(() =>
      assertSharedFeatureNames(
        [{ key: "view.dash", name: "经营驾驶舱", level: "VIEW", defaultOn: true }],
        "canary",
      ),
    ).toThrow(/view\.dash/);
    // 册外的本地键原样放行（不是"什么都咬"的哑门）
    expect(() =>
      assertSharedFeatureNames(
        [{ key: "view.dash.widget.gwh", name: "随便什么", level: "BLOCK", defaultOn: true }],
        "canary",
      ),
    ).not.toThrow();
  });
});
