import { Suspense } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GraphViewDescSchema } from "@platform/contracts";
import { AppProviders } from "@/App";
import { ViewConfigVMSchema, type ViewConfigVM } from "@/api/types";
import { getRenderer } from "@/views/registry";
import { loginAs } from "./utils";

/**
 * WO-GRAPH-DESC-CONTRACT · SEAM —— 断点 `G-GRAPH-DESC-CONTRACT-SPLIT`（图谱八视角描述卡生产态一张都不渲染）。
 *
 * ── 这道门为什么必须是 SEAM，不能是组件测 ───────────────────────────────────────
 * 断点**不在组件里**：`OntologyGraphView` 一直能渲染描述卡 —— 给它对的 props 它当然渲染。
 * 断点在**接缝**：后端把描述写进 `ViewConfig.layout.description`（链接还是裸字符串 `descriptionLink`），
 * 前端从 `ViewConfig.options.desc` / `.descLink{to,label}` 读 ⇒ 恒 `undefined` ⇒ `{desc && …}` 恒不渲染。
 *
 * **它凭什么全绿了这么久**：MSW mock（`src/mocks/fixtures.ts`）一直写的是**对的**形状，生产写的是**错的**，
 * 于是「测试实参」与「生产实参」交集为空 —— CLAUDE.md 铁律 0.5 判据 #6 点名的那种坑。
 * 所以本文件**一个字节都不吃 mock 的 ViewConfig**：
 *
 *   ① **载荷 = 生产真下发的字节**：`fixtures/workspace-graph-views-live.json` 是内存态 datacore
 *      （`SEED_DEMO=1` · seed 42）真调 `GET /a/v1/me/workspace` 抓下来的 `views[]` 中全部 `graph-*`。
 *      里面没有一个我发明的 viewKey / desc 文案。
 *   ② **解析 = 真前端 schema**：过 `ViewConfigVMSchema`（App 真正用的那一个），不手搓对象。
 *   ③ **渲染 = 真 renderer，且经注册表取**：`getRenderer("ontology-graph")` —— 直接 `import` 组件只能证明
 *      「函数能跑」，证明不了「接线了」（本仓有过实现有/测试有/全绿/零生产调用方的假绿第 9 形态）。
 *   ④ **断言 = 屏上有描述原文**：拿 fixture 里那段中文逐字去 DOM 里找，不是断言「desc 不为 undefined」。
 *
 * ── 覆盖率不许"做 1 个当做 8 个" ─────────────────────────────────────────────
 * 八视角**逐个**独立用例（`it.each`），外加一条「就是 8 个、键名逐个对上」的清单断言。
 * 少做一个 ⇒ 清单断言红；某一个渲染不出 ⇒ 那一条独立红。
 * （本仓假绿第 12 形态：测试对覆盖率全盲 —— 「N 个里做了 1 个」和「做满 N 个」同色。）
 *
 * ── 陈旧 fixture 的反制 ──────────────────────────────────────────────────────
 * 抓取式 fixture 自带一个风险：后端改回错的形状、而没人重抓 ⇒ 本文件照样绿。
 * 该缺口由**后端侧**的新鲜度门堵：`apps/datacore/test/planviews.test.ts` 断言真 workspace 的 `graph-*`
 * 与本 fixture **深相等**。两道门合起来才闭环：后端漂移→那边红，前端漂移→这边红。
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

const LIVE = JSON.parse(
  readFileSync(join(TEST_DIR, "fixtures/workspace-graph-views-live.json"), "utf8"),
) as { _capture: Record<string, string>; views: Record<string, unknown>[] };

/** §7.18 八视角的规范键（后端 VIEW_DEFS 的 §7.18 段）。少一个即清单断言红。 */
const VIEWPOINT_KEYS = [
  "graph-agent",
  "graph-all",
  "graph-backbone",
  "graph-flow",
  "graph-loop",
  "graph-mvp",
  "graph-solver",
  "graph-source",
] as const;

/** 「本体图谱」——非 §7.18 视角，是 BUILTIN_VIEWS 里的本体浏览器入口（G-GRAPH-ENTRY-DUP 的另一半）。 */
const BROWSER_KEY = "graph";

/** fixture 里应有的全部键 = 本体浏览器 + 八视角。 */
const EXPECTED_KEYS = [BROWSER_KEY, ...VIEWPOINT_KEYS] as const;

/** 真前端 schema 解析真后端字节 —— 这一步本身就是接缝的一半。 */
const VIEWS: ViewConfigVM[] = LIVE.views.map((v) => ViewConfigVMSchema.parse(v));
const byKey = new Map(VIEWS.map((v) => [v.key, v]));

/**
 * 探针：描述卡的字段有没有（又）漂回 `layout`。
 * ⚠ 金丝雀与主断言**共用这一份实现** —— 各抄一份正则的金丝雀是装饰品（改主逻辑时它拿旧的去测、照样绿）。
 */
const strayDescKeysInLayout = (v: { layout?: Record<string, unknown> }): string[] =>
  ["description", "descriptionLink", "desc", "descLink"].filter((k) => k in (v.layout ?? {}));

async function renderViewpoint(view: ViewConfigVM): Promise<void> {
  loginAs("planner");
  const Renderer = getRenderer("ontology-graph");
  if (!Renderer) throw new Error("renderer 注册表里没有 ontology-graph —— 接线断了，不是断言写错");
  render(
    <AppProviders>
      <MemoryRouter>
        <Suspense fallback={<div>loading</div>}>
          <Renderer view={view} />
        </Suspense>
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByTestId("ontology-svg");
}

describe("SEAM · 图谱八视角描述卡：后端真下发的形状 → 真 renderer → 屏上有描述原文", () => {
  it("金丝雀：探针与清单本身是好的（报否定结论前先自证工具·铁律 0.6）", () => {
    // ① 漂移探针必须能抓到「描述落在 layout」这一形态——抓不到就是探针坏了，不是代码干净。
    expect(strayDescKeysInLayout({ layout: { description: "旧形状" } })).toEqual(["description"]);
    expect(strayDescKeysInLayout({ layout: { descriptionLink: "/admin/calibration" } })).toEqual(["descriptionLink"]);
    // ② fixture 确实是抓来的生产字节，不是空壳。
    expect(LIVE._capture.what).toContain("/a/v1/me/workspace");
    expect(LIVE.views.length).toBeGreaterThan(0);
  });

  it("清单：真后端下发的是「本体图谱」+ 八视角（做 1 个与做满 9 个必须不同色）", () => {
    expect([...byKey.keys()].sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(VIEWS).toHaveLength(EXPECTED_KEYS.length);
    expect(VIEWS.every((v) => v.renderer === "ontology-graph")).toBe(true);
    expect([...byKey.keys()].filter((k) => k.startsWith("graph-")).sort()).toEqual([...VIEWPOINT_KEYS]);
  });

  it("契约：9 张卡的描述全部落在 options（契约 GraphViewDescSchema），layout 里一个都不剩", () => {
    // 基数下限**必须写在本条用例里**：上一条的 toHaveLength 保护不到这一条 ——
    // 门按用例切分，人也一样，fixture 抓空时这条会一圈不跑而照样绿（"9 张"与"0 张"同色）。
    expect(VIEWS).toHaveLength(EXPECTED_KEYS.length);
    for (const v of VIEWS) {
      const parsed = GraphViewDescSchema.parse(v.options ?? {});
      expect(parsed.desc, `${v.key}: 后端没下发 options.desc`).toBeTruthy();
      expect(
        strayDescKeysInLayout(v),
        `${v.key}: 描述卡字段又漂回 layout（= G-GRAPH-DESC-CONTRACT-SPLIT 复发）`,
      ).toEqual([]);
    }
  });

  it.each([...EXPECTED_KEYS])("%s：真后端的 desc 原文渲染进 descCard", async (key: string) => {
    const view = byKey.get(key)!;
    const expectedDesc = GraphViewDescSchema.parse(view.options ?? {}).desc!;
    await renderViewpoint(view);

    const card = screen.getByTestId("graph-desc-card");
    // 咬**原文**，不是咬「非空」——文案换了/被截断/被写死成别的都要红。
    expect(card).toHaveTextContent(expectedDesc);
  });

  it("graph-loop：descLink 是 {to,label} 对象 —— 裸字符串渲染不出可点文字", async () => {
    const view = byKey.get("graph-loop")!;
    const { descLink } = GraphViewDescSchema.parse(view.options ?? {});
    expect(descLink, "后端没下发 descLink").toBeTruthy();
    await renderViewpoint(view);

    const link = within(screen.getByTestId("graph-desc-card")).getByTestId("graph-desc-link");
    expect(link).toHaveAttribute("href", descLink!.to);
    expect(link).toHaveTextContent(descLink!.label);
  });

  it("mock 与生产同形状：MSW fixture 也走 options.desc（mock 比生产'对'同样是骗人）", async () => {
    // 这一条防的是反向漂移：修完生产、mock 却留在老形状（或反之）——两边任一走偏，这里红。
    const { GRAPH_VIEWPOINTS } = await import("@/mocks/fixtures");
    const mockGraphViews = GRAPH_VIEWPOINTS as { key: string; layout?: Record<string, unknown>; options?: Record<string, unknown> }[];
    expect(mockGraphViews.map((v) => v.key).sort()).toEqual([...VIEWPOINT_KEYS]);
    for (const mv of mockGraphViews) {
      const parsed = GraphViewDescSchema.parse(mv.options ?? {});
      expect(parsed.desc, `mock ${mv.key}: 缺 options.desc`).toBeTruthy();
      expect(strayDescKeysInLayout(mv), `mock ${mv.key}: 描述卡字段落在 layout`).toEqual([]);
    }
  });
});

/**
 * ── G-GRAPH-ENTRY-DUP：「本体图谱」与「图谱·全景」必须真的是两张图 ──────────────────
 *
 * 病灶：`graph` 此前零配置，而 `graph-all` 显式带的 `{colorBy:"domain", layoutSeed:42}`
 * **恰好等于前端默认值** ⇒ 六个消费分支全同 ⇒ 两个导航入口渲染输出**完全相同**。
 *
 * 所以这一组的断言判据必须是**渲染出来的东西**，不是配置字段：
 *   ✗ `expect(graph.options.graphOptions).toBeTruthy()` —— 「配了一组等于默认值的参数」照样绿，
 *      而那正是今天这个 bug 的形态（配置存在 ≠ 有效果）。
 *   ✓ 两个 ViewConfig 分别喂给**真 renderer**，取**可见节点的明暗指纹**，断言两者不同 +
 *      断言差异**恰好是语义所要的那一处**（推演层/编排层在本体图谱里退居背景）。
 */
describe("SEAM · G-GRAPH-ENTRY-DUP：本体图谱 ≠ 图谱·全景（咬渲染差异，不咬配置字段）", () => {
  /** 一次渲染的可观察指纹：每个节点 id → 是否淡出。渲染若写死，两个入口的指纹必然相同。 */
  function dimFingerprint(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const el of document.querySelectorAll<HTMLElement>("[data-testid^='graph-node-']")) {
      const id = el.getAttribute("data-testid")!.replace(/^graph-node-/, "");
      out[id] = (el.getAttribute("class") ?? "").includes("dim");
    }
    return out;
  }

  async function fingerprintOf(key: string): Promise<Record<string, boolean>> {
    await renderViewpoint(byKey.get(key)!);
    const fp = dimFingerprint();
    expect(Object.keys(fp).length, `${key}: 一个节点都没渲染出来 —— 指纹无意义`).toBeGreaterThan(0);
    cleanup();
    return fp;
  }

  it("金丝雀：指纹函数确实在度量明暗（否则下面的'不同'毫无意义）", async () => {
    // 拿一个**已知会淡出**的视角（graph-source：非源数据节点淡出）与全景比 —— 两者指纹必不同。
    // 这条不中 ⇒ 指纹函数坏了，不许把下面的结论当数。
    const source = await fingerprintOf("graph-source");
    const all = await fingerprintOf("graph-all");
    expect(Object.values(source).some(Boolean), "graph-source 一个淡出节点都没有，指纹函数没在度量 dim").toBe(true);
    expect(source).not.toEqual(all);
  });

  it("两个入口渲染输出必须不同（配成等于默认值 ⇒ 这里当场红）", async () => {
    const browser = await fingerprintOf(BROWSER_KEY);
    const panorama = await fingerprintOf("graph-all");
    expect(Object.keys(browser).sort()).toEqual(Object.keys(panorama).sort()); // 同一张底图
    expect(browser, "「本体图谱」与「图谱·全景」渲染输出完全相同 = G-GRAPH-ENTRY-DUP 复发").not.toEqual(panorama);
  });

  it("差异恰是语义所要的那一处：本体图谱里求解器/智能体退居背景，全景里三层齐亮", async () => {
    const browser = await fingerprintOf(BROWSER_KEY);
    const panorama = await fingerprintOf("graph-all");

    // 本体图谱：业务对象亮，求解器/智能体淡出
    expect(browser["n-base"], "本体图谱：业务对象不该淡出").toBe(false);
    expect(browser["n-solver-cap"], "本体图谱：求解器应淡出（推演层不是本视角主角）").toBe(true);
    expect(browser["n-agent"], "本体图谱：智能体应淡出（编排层不是本视角主角）").toBe(true);

    // 全景：三层一律全亮（它自述是"对象类型 + 求解器 + 智能体一张图"）
    expect(panorama["n-base"]).toBe(false);
    expect(panorama["n-solver-cap"], "全景：求解器不该淡出").toBe(false);
    expect(panorama["n-agent"], "全景：智能体不该淡出").toBe(false);

    // 求解器/智能体仍**渲染**（只是淡），本体图谱是浏览器不该藏东西——点得到才能看绑定关系。
    expect(Object.keys(browser)).toContain("n-solver-cap");
    expect(Object.keys(browser)).toContain("n-agent");
  });

  it("描述卡也把区别说给用户听（两个入口的 desc 原文不同）", () => {
    const browserDesc = GraphViewDescSchema.parse(byKey.get(BROWSER_KEY)!.options ?? {}).desc;
    const panoramaDesc = GraphViewDescSchema.parse(byKey.get("graph-all")!.options ?? {}).desc;
    expect(browserDesc).toBeTruthy();
    expect(panoramaDesc).toBeTruthy();
    expect(browserDesc).not.toEqual(panoramaDesc);
  });
});
