import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NAV_GROUPS,
  CONSOLIDATED_INTO_SANDBOX,
  GROUP_CONSOLIDATION_EXEMPT,
} from "@/pages/ShellLayout";

/**
 * WO-SIM-NAV-GROUP · 指控台四页归「推演」组 + 同名歧义消除 —— 前端那一半。
 *
 * ══ 今天的行为是 X，应该是 Y（仓主真服务真浏览器登录 demo/admin 实测，附截图）══════
 *
 * **X**：`ShellLayout.NAV_GROUPS` 里 `sim-console` / `sim-conduction` / `sim-attribution` /
 *       `sim-optimize` **一条都没登记**，而后端 `synthetic/service.ts` 的 `seedViewConfigs`
 *       照样把这四个键连同 label 派进 `workspace.navigation`（group=business）。
 *       `UnifiedNav` 归完组后，没被 `usedViews` 认领的项**全部**落 `leftover`
 *       → 推进 `{ title: "其它" }` 兜底桶。于是左栏是：
 *         · 「推演」组 → 推演沙盘（旧 route `/v/sim-sandbox`）、接单可行性、接单组合、产能推演…
 *         · 「其它」组 → **推演沙盘**（新 viewKey `sim-console`，路由 `/v/sim-console`）、
 *           传导识别、损失归因、方案寻优
 *       两条**同名**条目指向两个不同页面 —— 屏上直接可见的缺陷。
 *
 * **Y**：四页登记进「推演」组（`kind:"view"`，决策链序）；同名歧义在**后端那一份标题**上消除
 *       （`sandbox-console.ts` 的 `SANDBOX_CONSOLE_VIEWS`：`sim-console` →「推演指控台」），
 *       旧 `/v/sim-sandbox` 一个字不动。
 *
 * ══ 本文件咬什么、不咬什么（说清楚，免得被当成比它更强的证据）════════════════════
 *
 * 咬的是**分组表这一半**：四个键在不在「推演」组、会不会再掉进兜底桶、
 * 有没有被 `CONSOLIDATED_INTO_SANDBOX` / `consolidatedWhen` 顺手滤掉、组内文案有没有重名。
 *
 * **不**咬「真 DOM 里这四条渲染出来了」——`src/mocks/fixtures.ts` 的 `allViews` 至今
 * **不含**这四个键（实测：`grep -n "sim-console" apps/frontend-shell/src/mocks/fixtures.ts` 零命中，
 * 金丝雀 `grep -n "chain-line-map"` 同文件有命中 ⇒ 是真没有，不是 grep 坏了）。
 * mock 里不下发 ⇒ `renderApp()` 走 MSW 时侧栏本来就没有这四条，任何"渲染出来了"的断言都是**空转**。
 * 屏上那一半由 **`apps/datacore/test/workspace-sim-console.seam.test.ts` §A/§D** 咬：
 * 它打真 `GET /a/v1/me/workspace`，拿真下发的 label，与本文件这张表的内联 route label 合起来算重名。
 * （mock 与生产在这四个键上不同形 —— 那是本单**范围边界之外**的既有欠账，已在交单报告里点名。）
 *
 * R6 确定性：纯结构断言 + 读源码，无时钟、无随机、无网络。
 */

/* ══ §0 真值源：后端那份标题声明表（不写死 —— 派单给的名字是线索不是结论）══════════ */

/** 仓根（自 cwd 向上找 `pnpm-workspace.yaml`）—— 同 `chain-line-map.seam.test.tsx` 的既有做法。 */
const REPO_ROOT = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error(`[sim-nav-group.seam] 找不到仓根（自 ${process.cwd()} 向上未见 pnpm-workspace.yaml）`);
})();

const SANDBOX_CONSOLE_PATH = join(REPO_ROOT, "apps/datacore/src/synthetic/sandbox-console.ts");

/**
 * 抽 `SANDBOX_CONSOLE_VIEWS` 的 `{ key, title, renderer }` 三元组。
 *
 * 逐行去注释：本仓注释密度下「注释里抄了一行声明」会被读成真声明 ——
 * 本文件要抽的那张表，其头注里就**逐字引用了**旧标题「推演沙盘」，不去注释会当场把旧值抽回来。
 */
function parseSandboxConsoleViews(src: string): { key: string; title: string; renderer: string }[] {
  const out: { key: string; title: string; renderer: string }[] = [];
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    const m = t.match(/\{\s*key:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*renderer:\s*"([^"]+)"\s*\}/);
    if (m) out.push({ key: m[1]!, title: m[2]!, renderer: m[3]! });
  }
  return out;
}

const backendSrc = readFileSync(SANDBOX_CONSOLE_PATH, "utf8");
const backendViews = parseSandboxConsoleViews(backendSrc);
const backendTitleOf = new Map(backendViews.map((v) => [v.key, v.title]));

/** 决策链序（= 后端声明顺序，两侧同序才读得成一条链）。 */
const CONSOLE_KEYS = ["sim-console", "sim-conduction", "sim-attribution", "sim-optimize"] as const;

const simGroup = NAV_GROUPS.find((g) => g.title === "推演");

/** `UnifiedNav` 的 `usedViews` 上界：分组表里所有 `kind:"view"` 的键 —— 其补集就是「其它」兜底桶。 */
function groupedViewKeys(groups: typeof NAV_GROUPS): Set<string> {
  return new Set(groups.flatMap((g) => g.items).filter((it) => it.kind === "view").map((it) => it.key));
}

/** 重名探测（唯一实现 —— 变异反证与真断言共用，抄第二份就是装饰品）。 */
function duplicateLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  for (const l of labels) seen.set(l, (seen.get(l) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([l]) => l).sort();
}

/** 「推演」组沙盘开着时**屏上可见**的文案：route 项取内联 label，view 项取后端 title。 */
function visibleSimGroupLabels(overrideTitle?: { key: string; title: string }): string[] {
  const out: string[] = [];
  for (const it of simGroup!.items) {
    if (it.kind === "admin") continue;
    // `consolidatedWhen` 命中（sim.sandbox 开着）⇒ 该条目不出现（见 UnifiedNav :412 / :395）
    if (it.consolidatedWhen === "sim.sandbox") continue;
    if (it.kind === "route") {
      out.push(it.label);
      continue;
    }
    const title = overrideTitle?.key === it.key ? overrideTitle.title : backendTitleOf.get(it.key);
    if (title) out.push(title); // 非本族的 view 项标题不在这个文件里，跳过（下面 §0.3 有覆盖率下界兜着）
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * §0 金丝雀 —— 报否定结论前先自证工具（铁律 0.6）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe("WO-SIM-NAV-GROUP · §0 金丝雀（不中就报「工具坏了」，不许报「已经归好组了」）", () => {
  it("0.1 · 后端标题抽取器没瞎：读得到文件、恰好四条、含已知必中键 sim-console", () => {
    expect(backendSrc.length, `读不到 ${SANDBOX_CONSOLE_PATH} ⇒ 工具坏了`).toBeGreaterThan(500);
    expect(
      backendViews.map((v) => v.key),
      "SANDBOX_CONSOLE_VIEWS 一条都没抽出来 ⇒ **抽取器坏了**，不许读成「后端没声明标题」",
    ).toContain("sim-console");
    expect(backendViews, "后端声明表不是四条 ⇒ 本文件的被测对象已失真").toHaveLength(4);
    // 去注释真的在生效：该文件头注**逐字引用了**旧标题「推演沙盘」，抽出来的却必须是新值
    expect(
      backendSrc.includes("推演沙盘"),
      "头注里那段「为什么改名」的说明不见了 ⇒ 本条金丝雀失去被测对象（不是错误，但要知道）",
    ).toBe(true);
    expect(
      backendTitleOf.get("sim-console"),
      "抽取器把注释里引用的旧标题抽回来了 ⇒ 去注释没生效，下面所有重名断言不可信",
    ).not.toBe("推演沙盘");
  });

  it("0.2 · 「推演」组真的存在且非空（组没了 ⇒ 下面每条都在空集合上跑，恒真恒绿）", () => {
    expect(simGroup, "NAV_GROUPS 里没有「推演」组 ⇒ 本文件全部空转").toBeTruthy();
    expect(simGroup!.items.length, "组里项数过少 ⇒ 被测面不对").toBeGreaterThanOrEqual(9);
    // 已知必中：旧沙盘那条 route（本单要与之区分的就是它）
    const old = simGroup!.items.find((it) => it.kind === "route" && it.key === "sim-sandbox");
    expect(old, "「推演」组里没有 sim-sandbox route ⇒ 被测对象已变，重名断言失去依据").toBeTruthy();
  });

  it("0.3 · 文案覆盖率下界：本组可见文案至少 5 条（抽不出文案会让重名检查恒绿）", () => {
    expect(
      visibleSimGroupLabels().length,
      "「推演」组算出的可见文案过少 ⇒ 文案抽取塌了，重名检查会变成空数组比空数组",
    ).toBeGreaterThanOrEqual(5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §A 归组 —— 四个 viewKey 落「推演」组，不再落「其它」兜底桶
 * ══════════════════════════════════════════════════════════════════════════════ */

describe("WO-SIM-NAV-GROUP · §A 四个 viewKey 落在「推演」组", () => {
  it("A1 · 四个键全在「推演」组，且都是 kind:\"view\"（挂成 route 会被 nav 门判据⑤ 咬住）", () => {
    for (const key of CONSOLE_KEYS) {
      const item = simGroup!.items.find((it) => it.key === key);
      expect(item, `${key} 不在「推演」组 ⇒ 它会落回「其它」兜底桶（本单要修的就是这个）`).toBeTruthy();
      expect(
        item!.kind,
        `${key} 挂成了 ${item!.kind} —— 它没有 App.tsx 专用静态 route，只有 v/:viewKey 通用分发`,
      ).toBe("view");
    }
  });

  it("A2 · 顺序即决策链：四个键在组内保持「现状 → 传导 → 归因 → 寻优」，且与后端声明同序", () => {
    const inGroup = simGroup!.items.map((it) => it.key).filter((k) => (CONSOLE_KEYS as readonly string[]).includes(k));
    expect(inGroup, "组内顺序被打乱 ⇒ 四条连读不再是一条决策链").toEqual([...CONSOLE_KEYS]);
    expect(
      backendViews.map((v) => v.key),
      "后端声明顺序与前端归组顺序漂了 ⇒ 两侧各写一半（本仓 #99/#110 的病根）",
    ).toEqual([...CONSOLE_KEYS]);
  });

  it("A3 · 反证：把四个键从分组表里拿掉，兜底桶判据必须当场把它们抓回来（否则 A1 是哑的）", () => {
    const grouped = groupedViewKeys(NAV_GROUPS);
    for (const key of CONSOLE_KEYS) expect(grouped.has(key), `${key} 不在归组键集里`).toBe(true);
    // 变异：模拟"没人登记"的那一版分组表
    const mutated = groupedViewKeys(
      NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((it) => !(CONSOLE_KEYS as readonly string[]).includes(it.key)),
      })),
    );
    const fallen = CONSOLE_KEYS.filter((k) => !mutated.has(k));
    expect(
      fallen,
      "把四个键删掉后判据仍说它们已归组 ⇒ 判据是哑的，A1 的绿不构成证据",
    ).toEqual([...CONSOLE_KEYS]);
  });

  it("A4 · 不许被两条过滤顺手滤掉：不在收编表里，也不带 consolidatedWhen", () => {
    for (const key of CONSOLE_KEYS) {
      expect(
        CONSOLIDATED_INTO_SANDBOX[key],
        `${key} 进了 CONSOLIDATED_INTO_SANDBOX ⇒ UnifiedNav :397 会无条件滤掉它，归组白归`,
      ).toBeUndefined();
      const item = simGroup!.items.find((it) => it.key === key)!;
      expect(
        item.consolidatedWhen,
        `${key} 带了 consolidatedWhen —— 它的受控键就是 sim.sandbox 本身：` +
          `沙盘开则被这条隐藏、沙盘关则后端根本不下发 ⇒ **两态都不出现**，等于把页面从 IA 里抹掉`,
      ).toBeUndefined();
    }
  });

  it("A5 · 判据⑨ 的账要平：四个键逐条登记在 GROUP_CONSOLIDATION_EXEMPT，且理由不是占位符", () => {
    for (const key of CONSOLE_KEYS) {
      const why = GROUP_CONSOLIDATION_EXEMPT[`推演::${key}`];
      expect(
        why,
        `推演::${key} 没登记豁免 ⇒ scripts/check-nav-group-coverage.mjs 判据⑨ RC=1（组的收编承诺被掏空）`,
      ).toBeTruthy();
      expect(why!.trim().length, `推演::${key} 的理由不足 10 字（"待定/TODO" 不是理由）`).toBeGreaterThanOrEqual(10);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §B 重名 —— 左导航里不许出现两条同名条目
 * ══════════════════════════════════════════════════════════════════════════════ */

describe("WO-SIM-NAV-GROUP · §B 导航里没有重名条目", () => {
  it("B1 · 变异反证：把 sim-console 的标题换回「推演沙盘」，探测器必须当场报重名", () => {
    expect(
      duplicateLabels(visibleSimGroupLabels({ key: "sim-console", title: "推演沙盘" })),
      "换回旧标题后探测器仍说「无重名」⇒ 探测器是哑的，B2 的绿不构成证据",
    ).toContain("推演沙盘");
  });

  it("B2 · 真断言：「推演」组沙盘开着时可见的条目文案两两不重名", () => {
    expect(
      duplicateLabels(visibleSimGroupLabels()),
      "「推演」组里出现重名条目 —— 用户扫一眼分不出点哪个",
    ).toEqual([]);
  });

  it("B3 · 旧页一个字没动：sim-sandbox 仍是 label「推演沙盘」+ feature「sim.sandbox」", () => {
    const old = simGroup!.items.find((it) => it.kind === "route" && it.key === "sim-sandbox");
    expect(old, "旧沙盘 route 条目不见了 —— 本单明令不动它").toBeTruthy();
    expect(
      old!.kind === "route" ? old!.label : undefined,
      "改的是旧页而不是新页 —— 方向反了（`/v/sim-sandbox` 是既有产品行为）",
    ).toBe("推演沙盘");
    expect(
      old!.kind === "route" ? old!.feature : undefined,
      "旧沙盘的暗发 entitlement 被动过了（关 → 入口消失，R3 不泄露存在性）",
    ).toBe("sim.sandbox");
  });

  it("B4 · 新标题不与任何内联 route label 相撞（不只是不撞「推演沙盘」这一条）", () => {
    const routeLabels = NAV_GROUPS.flatMap((g) => g.items)
      .filter((it): it is Extract<typeof it, { kind: "route" }> => it.kind === "route")
      .map((it) => it.label);
    expect(routeLabels.length, "一条 route label 都没抽到 ⇒ 本条空转").toBeGreaterThanOrEqual(4);
    for (const key of CONSOLE_KEYS) {
      const title = backendTitleOf.get(key)!;
      expect(routeLabels, `${key} 的标题「${title}」与某条专用 route 的 label 撞了`).not.toContain(title);
    }
  });
});
