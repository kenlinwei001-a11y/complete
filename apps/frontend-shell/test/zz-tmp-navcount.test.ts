// TEMPORARY measurement rig for WO-SIM-GATE-DECOUPLE — deleted before final commit.
// 数法：复刻 `UnifiedNav` 的装配循环，但**判定本体全部调用 ShellLayout 导出的真函数**
// （`NAV_GROUPS` / `isViewConsolidatedAway` / `isRouteRefHidden` / `visibleAdminPages`）——
// 即被本单改动的那一半是真的，只有 20 行装配循环是镜像。
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { NAV_GROUPS, isViewConsolidatedAway, isRouteRefHidden } from "../src/pages/ShellLayout";
import { visibleAdminPages } from "../src/pages/adminRegistry";

const DUMP = process.env.NAVDUMP_IN ?? "/tmp/navdump";
const ROLES = ["admin", "planner", "catalog_admin"];

type WS = {
  features: string[];
  navigation: { key: string; label?: string; group?: string; viewKey?: string }[];
};

/** 复刻 UnifiedNav 的装配：返回屏上真正渲染出来的叶项键（含「其它」兜底桶）。 */
function renderedNavKeys(ws: WS): string[] {
  const workspace = ws as never; // featureOn 只读 .features
  const allViews = ws.navigation.filter((it) => it.group !== "admin");
  const views = allViews.filter((it) => !isViewConsolidatedAway(it.viewKey ?? it.key, workspace));
  const viewByKey = new Map(views.map((it) => [it.viewKey ?? it.key, it]));
  const adminPages = visibleAdminPages(ROLES);
  const adminByPath = new Map(adminPages.map((p) => [p.path, p]));
  const usedViews = new Set<string>();
  const usedAdmin = new Set<string>();
  const out: string[] = [];

  for (const g of NAV_GROUPS) {
    const links: string[] = [];
    for (const ref of g.items) {
      if (ref.kind === "route") {
        if (isRouteRefHidden(ref, workspace)) continue;
        links.push(`r:${ref.key}`);
      } else if (ref.kind === "view") {
        if (!viewByKey.get(ref.key)) continue;
        usedViews.add(ref.key);
        links.push(`v:${ref.key}`);
      } else {
        if (!adminByPath.get(ref.key)) continue;
        usedAdmin.add(ref.key);
        links.push(`a:${ref.key}`);
      }
    }
    out.push(...links); // 空组自动隐藏 ⇒ 组为空时本来就没有叶项
  }
  for (const it of views) if (!usedViews.has(it.viewKey ?? it.key)) out.push(`v:${it.viewKey ?? it.key}`);
  for (const p of adminPages) if (!usedAdmin.has(p.path)) out.push(`a:${p.path}`);
  return out;
}

/** NAV_GROUPS 里所有带 consolidatedWhen 的项（本单要让它们在页面闸关掉时全部现身）。 */
const CONSOLIDATED_ITEMS = NAV_GROUPS.flatMap((g) =>
  g.items.filter((it) => "consolidatedWhen" in it && it.consolidatedWhen !== undefined).map((it) => it.key),
);

describe("zz-tmp navcount", () => {
  it("counts rendered nav leaf items per scenario", () => {
    // eslint-disable-next-line no-console
    console.log(`[NAVCOUNT] 带收编标记的导航项共 ${CONSOLIDATED_ITEMS.length} 条: ${CONSOLIDATED_ITEMS.join(",")}`);

    for (const f of ["s0-default", "s1-pagegate-off", "s2-capability-off"]) {
      const p = `${DUMP}/${f}.json`;
      if (!existsSync(p)) {
        // eslint-disable-next-line no-console
        console.log(`[NAVCOUNT] ${f}: (无此场景快照 —— 该场景在当前代码下不可达)`);
        continue;
      }
      const ws = JSON.parse(readFileSync(p, "utf8")) as WS;
      const keys = renderedNavKeys(ws);
      const shown = CONSOLIDATED_ITEMS.filter((k) => keys.includes(`v:${k}`) || keys.includes(`r:${k}`));
      // eslint-disable-next-line no-console
      console.log(
        `[NAVCOUNT] ${f}: 导航叶项=${keys.length} | 收编项现身=${shown.length}/${CONSOLIDATED_ITEMS.length} [${shown.join(",")}]` +
          ` | 沙盘入口=${keys.includes("r:sim-sandbox") ? "在" : "消失"}` +
          ` | 控制台入口=${keys.includes("r:sim-unified") ? "在" : "消失"}`,
      );
    }

    // ── 数法金丝雀（双向，缺一向就分不出「尺子坏了」与「真没有」）──────────────
    const s0 = JSON.parse(readFileSync(`${DUMP}/s0-default.json`, "utf8")) as WS;
    const k0 = renderedNavKeys(s0);
    // 正向：一个我确定可见的项（统一推演控制台 route，无 feature、无 consolidatedWhen）必须被数到
    expect(k0, "正向金丝雀：sim-unified 应当可见").toContain("r:sim-unified");
    // 负向：一个我确定被隐藏的项（what-if 带 consolidatedWhen，且该键此刻为开）必须数不到
    expect(k0, "负向金丝雀：what-if 此刻应被收编隐藏").not.toContain("r:what-if");
    // eslint-disable-next-line no-console
    console.log(`[NAVCOUNT] 金丝雀 双向通过（正:r:sim-unified 在 / 负:r:what-if 不在）· S0 总数=${k0.length}`);
  });
});
