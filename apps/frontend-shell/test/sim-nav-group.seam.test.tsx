import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NAV_GROUPS,
  CONSOLIDATED_INTO_SANDBOX,
  GROUP_CONSOLIDATION_EXEMPT,
  ROUTE_NO_NAV,
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
 * ══════════════════════════════════════════════════════════════════════════════
 * ⚠ WO-SIM-NAV-UNIFIED（2026-08-26）· 上面那个 Y **已被下一条产品裁决取代**
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 仓主原话：「把推演沙盘+4个页面结合在一个页面。base 页面是一个大量的指标卡片……」
 * ⇒ 四个台**不再各占一条导航位**，降为统一推演控制台（`/v/sim-unified`）的页签；
 *   「推演」组之首改挂合并壳 `{ kind:"route", key:"sim-unified", label:"统一推演控制台" }`。
 *
 * **本文件因此有四条断言被反转**（A4 / A5 / §0.3 / B1），逐条理由写在各自 `it()` 里。
 * 反转的**不是**判据本身，而是判据要守的那个形态：
 *   · 旧形态「四页必须单列且不许被滤掉」——当时它们在任何控制台里都没有落点，藏 = 删；
 *   · 新形态「四页必须**仍登记在组里**（受检面/名册）、但带 `consolidatedWhen` + 进收编表
 *     ⇒ 屏上不单列、页面一个没删」。
 *
 * ⚠ **A1/A2/A3 一个字都不能改**：它们守的是「四个键仍在分组表里」——
 *   这条在新形态下**更重要**了。`scripts/lib/sim-page-roster.mjs` 的判据 R3 读的就是这张表，
 *   而这四页**只经 R3 一条路进推演页名册**（实测 R1/R2/R4/R5 全不含）。
 *   若有人图省事把四条删掉，名册 17 → 13，`check-edge-active-mounts.mjs` 的缩水棘轮才会红，
 *   而 UX 判据门会**悄悄少检四页**。故「删条目」与「带 consolidatedWhen」在屏上一样、在受检面上天差地别。
 *
 * ══ 本文件咬什么、不咬什么（说清楚，免得被当成比它更强的证据）════════════════════
 *
 * 咬的是**分组表这一半**：四个键在不在「推演」组、会不会再掉进兜底桶、
 * 收编的两半（`consolidatedWhen` + `CONSOLIDATED_INTO_SANDBOX`）齐不齐、组内文案有没有重名。
 *
 * **不**咬「真 DOM 里这四条渲染出来了」。⚠ 上一版这里写的理由是「`fixtures.ts` 的 `allViews`
 * **不含**这四个键 ⇒ 任何渲染断言都是空转」——**该理由已于 WO-SIM-NAV-UNIFIED 失效**：
 * 那一单为满足门判据⑧b（收编项必须仍在 mock allViews 里，否则"路由仍可达"的断言是哑门）
 * 已把四个键补进 `fixtures.ts`，并把它们的 featureKey 映到 `sim.sandbox`（与后端
 * `features.ts` 的 `VIEW_FEATURE_MAP` 同口径）。今天 mock **会**下发这四页，
 * 只是它们随即被 `consolidatedWhen` 隐藏 —— 这正是本文件 A4 现在要断言的那条链。
 * 屏上那一半仍由 **`apps/datacore/test/workspace-sim-console.seam.test.ts` §A/§D** 咬真下发。
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

/**
 * 「推演」组沙盘开着时**屏上可见**的文案：route 项取内联 label，view 项取后端 title。
 *
 * `ignoreConsolidation`（WO-SIM-NAV-UNIFIED 新增）= **不施加 `consolidatedWhen` 过滤**，
 * 即"假如这一组一条都没被收编，屏上会是哪些文案"。它有两个用途，都不是为了放宽判据：
 *  ① §0.3 的**抽取器金丝雀**：收编之后真实可见集只剩 2 条，用它做下界会把
 *     「文案抽取塌了」和「收编生效了」读成同一件事 —— 那正是本仓最恨的
 *     「拿一个看起来相关的数字当判据」。故金丝雀改在**未收编集**上取下界。
 *  ② B1 的**变异反证**：证明「重名探测器 + 标题抽取」这条链今天仍然是活的 ——
 *     把 `sim-console` 的标题换回旧值「推演沙盘」，在未收编集上必须当场报重名。
 *     这同时说明了收编**为什么**消除了歧义：不是名字改好了，是那条目根本不出现了。
 */
function visibleSimGroupLabels(
  overrideTitle?: { key: string; title: string },
  ignoreConsolidation = false,
): string[] {
  const out: string[] = [];
  for (const it of simGroup!.items) {
    if (it.kind === "admin") continue;
    // `consolidatedWhen` 命中（sim.sandbox 开着）⇒ 该条目不出现（见 UnifiedNav :543 / :500）
    if (!ignoreConsolidation && it.consolidatedWhen === "sim.sandbox") continue;
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

  it("0.3 · 文案抽取没塌：**未收编集**至少 5 条（收编后的真实可见集只剩 2 条，不能拿它当抽取器下界）", () => {
    // ⚠ WO-SIM-NAV-UNIFIED 反转点：上一版这条断言的是 `visibleSimGroupLabels().length >= 5`。
    //   四个台收编之后真实可见集 = 统一推演控制台 + 推演沙盘 = **2 条**，旧下界必然红。
    //   但**不许**把下界从 5 改成 2 了事：那样一来「抽取器坏了（抽出 0 条）」与
    //   「收编生效了（剩 2 条）」在同一个数字上不可区分 —— 金丝雀会跟着被测对象一起塌。
    //   故金丝雀移到**未收编集**上：它不随收编状态变化，只随抽取器好坏变化。
    expect(
      visibleSimGroupLabels(undefined, true).length,
      "「推演」组在未收编集上算出的文案仍过少 ⇒ 文案抽取塌了，重名检查会变成空数组比空数组",
    ).toBeGreaterThanOrEqual(5);
    // 收编后的真实可见集单独断言（这是产品形态，不是金丝雀）：合并壳 + 旧沙盘，各一条，不多不少。
    expect(
      visibleSimGroupLabels(),
      "「推演」组沙盘开着时的可见条目不是「统一推演控制台 + 推演沙盘」两条 ⇒ IA 又长回去了",
    ).toEqual(["统一推演控制台", "推演沙盘"]);
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

  it("A4 · 收编的**两半必须齐**：四个键各带 consolidatedWhen:\"sim.sandbox\" ⊗ 各在 CONSOLIDATED_INTO_SANDBOX 里", () => {
    // ⚠ WO-SIM-NAV-UNIFIED 反转点：上一版断言的是「**不**在收编表里、**不**带 consolidatedWhen」。
    //   那条判据守的是「四页没有落点，藏起来 = 删掉」。今天四页在合并壳里有落点
    //   （三页是真页签、`sim-console` 的首屏由卡墙取代），故收编成立，判据随之反转。
    //   反转后守的是门 `nav-group-coverage:check` 判据⑧f 那条规则：**两张表不许各写一半** ——
    //   只写 `consolidatedWhen` = 条目会隐藏，却没有任何一处声明「它在控制台里点哪能到」，
    //   那就是「删入口了事」披了张皮。
    for (const key of CONSOLE_KEYS) {
      const item = simGroup!.items.find((it) => it.key === key)!;
      // 用 `in` 收窄而不是 `as`：`NavItemRef` 的 `kind:"admin"` 那一支结构上没有 consolidatedWhen，
      // 直接取属性 tsc 会报 TS2339（vitest 不做类型检查，只有 typecheck 会红）。
      expect(
        "consolidatedWhen" in item ? item.consolidatedWhen : undefined,
        `${key} 没带 consolidatedWhen ⇒ 沙盘开着时它仍单列 = 与合并壳里的页签构成重复入口`,
      ).toBe("sim.sandbox");
      const entry = CONSOLIDATED_INTO_SANDBOX[key];
      expect(entry, `${key} 不在 CONSOLIDATED_INTO_SANDBOX ⇒ 判据⑧f RC=1（收编只写了一半）`).toBeTruthy();
      // `via` 必须是 view-defs：写成 workspace.views 会被 sim-page-roster 的排除判据 X1
      // 当成「沙盘内部构件」踢出推演页名册 ⇒ UX 判据与挂载点门从此对这四页恒绿（漏检永远绿）。
      expect(
        entry?.via,
        `${key} 的 via 不是 "view-defs" —— 它走后端增量视图桶；写成 workspace.views 会把它踢出推演页名册`,
      ).toBe("view-defs");
      expect(
        entry?.where.trim().length ?? 0,
        `${key} 的 where 不足 6 字（判据⑧d：写不出「点哪里」= 没真收编）`,
      ).toBeGreaterThanOrEqual(6);
    }
  });

  it("A4b · 条件收编必须**先于**无条件收编生效（否则沙盘关着的租户会连页面一起丢）", () => {
    // 这条守的是 `UnifiedNav` 里两行过滤的**顺序**（ShellLayout :541-545）：
    //   const when = conditionalConsolidation.get(key);
    //   if (when !== undefined) return !featureOn(workspace, when);   // ← 条件收编，先
    //   return !CONSOLIDATED_INTO_SANDBOX[key];                        // ← 无条件收编，后
    // 四个台**两张表都在**。若顺序反了（先查无条件表），它们会被**无条件**滤掉 ——
    // 沙盘关着时本该回退单列的语义当场失效。上一版 A4 担心的正是这一条，
    // 当时的修法是「不许进收编表」；今天的修法是「进表，但靠顺序保证条件分支赢」。
    // 断言落在**源码顺序**上（纯结构、无渲染），与门判据⑧a 的免责条件同源。
    const shellSrc = readFileSync(join(REPO_ROOT, "apps/frontend-shell/src/pages/ShellLayout.tsx"), "utf8");
    const condIdx = shellSrc.indexOf("if (when !== undefined) return !featureOn(workspace, when);");
    const uncondIdx = shellSrc.indexOf("return !CONSOLIDATED_INTO_SANDBOX[key];");
    expect(condIdx, "找不到条件收编那一行 ⇒ 本条断言失去被测对象（抽取器坏了，不许读成「顺序对」）").toBeGreaterThan(-1);
    expect(uncondIdx, "找不到无条件收编那一行 ⇒ 同上").toBeGreaterThan(-1);
    expect(
      condIdx,
      "无条件收编排在了条件收编**前面** ⇒ 四个台会被无条件滤掉，沙盘关着时它们连回退单列都没有",
    ).toBeLessThan(uncondIdx);
  });

  it("A5 · 四条**陈旧豁免必须已删**，合并壳自己则必须登记（判据⑨ 的账要平）", () => {
    // ⚠ WO-SIM-NAV-UNIFIED 反转点：上一版断言四个键**必须**在 GROUP_CONSOLIDATION_EXEMPT 里。
    //   那四条豁免的原文理由是「再带 consolidatedWhen 会让它开关两态都不出现 = 页面从导航里蒸发」——
    //   四个键现在**确实带着** consolidatedWhen，理由已成假命题，留着就是自相矛盾的记号。
    //   ⚠ 这四条**不是被门逼着删的**：判据⑨ 的陈旧检测 `groupExemptUsed`
    //     （check-nav-group-coverage.mjs :1225-1230）只要该项还在组里就记作「已用」，
    //     **不看它是否已带 consolidatedWhen**——文档写了这一半，实现里没有。故由本条断言来守。
    for (const key of CONSOLE_KEYS) {
      expect(
        GROUP_CONSOLIDATION_EXEMPT[`推演::${key}`],
        `推演::${key} 的豁免还挂着，而该项已带 consolidatedWhen ⇒ 自相矛盾的陈旧豁免（门看不见这一态）`,
      ).toBeUndefined();
    }
    // 合并壳自己不可能被自己收编 ⇒ 它必须**有**豁免，否则判据⑨ RC=1。
    const why = GROUP_CONSOLIDATION_EXEMPT["推演::sim-unified"];
    expect(why, "推演::sim-unified 没登记豁免 ⇒ 判据⑨ RC=1（组的收编承诺被它掏空）").toBeTruthy();
    expect(why!.trim().length, "推演::sim-unified 的理由不足 10 字").toBeGreaterThanOrEqual(10);
  });

  it("A6 · 合并壳是本组**主入口**：kind:\"route\"、排在首位、且不在 ROUTE_NO_NAV 里", () => {
    const first = simGroup!.items[0];
    expect(first, "「推演」组是空的 ⇒ 本条断言失去被测对象").toBeTruthy();
    expect(first!.kind, "「推演」组第一项不是 kind:\"route\" ⇒ 主入口被挪走了").toBe("route");
    expect(first!.key, "「推演」组第一项不是 sim-unified ⇒ 合并壳不再是主入口").toBe("sim-unified");
    expect(
      first!.kind === "route" ? first!.label : undefined,
      "合并壳的导航文案变了 —— 它与旧沙盘「推演沙盘」必须不同名（两条并排时靠名词本身区分）",
    ).toBe("统一推演控制台");
    expect(
      ROUTE_NO_NAV["sim-unified"],
      "sim-unified 还挂在 ROUTE_NO_NAV 里，而它已经有导航条目了 ⇒ 陈旧豁免，门判据④ RC=1",
    ).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §B 重名 —— 左导航里不许出现两条同名条目
 * ══════════════════════════════════════════════════════════════════════════════ */

describe("WO-SIM-NAV-GROUP · §B 导航里没有重名条目", () => {
  it("B1 · 变异反证：在**未收编集**上把 sim-console 的标题换回「推演沙盘」，探测器必须当场报重名", () => {
    // ⚠ WO-SIM-NAV-UNIFIED 反转点：上一版在**真实可见集**上做这个变异。四个台收编之后
    //   `sim-console` 根本不出现在可见集里 ⇒ 换成什么标题都不会重名 ⇒ 旧断言必然红。
    //   **但不许因此把 B1 删掉**：删了就没有任何东西证明「重名探测器 + 标题抽取」还是活的，
    //   B2 的绿会退化成「空数组比空数组」——那正是本文件 §0 金丝雀存在的理由。
    //   故变异改在未收编集上做：它同时证明了两件事 ——
    //     ① 探测器与抽取器都没瞎（旧标题一放回去就报重名）；
    //     ② 今天不重名**不是因为名字改好了，而是因为那条目根本不出现** ——
    //        这正是收编相对「改名」更强的地方，也是 B2 现在为什么恒绿的真实原因。
    expect(
      duplicateLabels(visibleSimGroupLabels({ key: "sim-console", title: "推演沙盘" }, true)),
      "换回旧标题后探测器仍说「无重名」⇒ 探测器或标题抽取是哑的，B2 的绿不构成证据",
    ).toContain("推演沙盘");
  });

  it("B1b · 收编确实消除了歧义：同一个旧标题放回**真实可见集**，不再构成重名", () => {
    // 与 B1 是一对：同样的变异、同样的探测器，只是施加在收编生效之后的可见集上。
    // 两条一起读才说得清「歧义为什么没了」——不是探测器瞎了（B1 证明它没瞎），是条目不在了。
    expect(
      duplicateLabels(visibleSimGroupLabels({ key: "sim-console", title: "推演沙盘" })),
      "sim-console 已收编却仍在可见集里参与重名计算 ⇒ consolidatedWhen 没生效",
    ).toEqual([]);
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
