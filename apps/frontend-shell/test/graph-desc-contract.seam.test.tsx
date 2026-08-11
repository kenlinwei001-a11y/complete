import { Suspense } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

/** 八视角的规范键（后端 VIEW_DEFS 的 §7.18 段）。少一个即清单断言红。 */
const EXPECTED_KEYS = [
  "graph-agent",
  "graph-all",
  "graph-backbone",
  "graph-flow",
  "graph-loop",
  "graph-mvp",
  "graph-solver",
  "graph-source",
] as const;

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

  it("清单：真后端下发的 graph-* 恰好是这 8 个（做 1 个与做满 8 个必须不同色）", () => {
    expect([...byKey.keys()].sort()).toEqual([...EXPECTED_KEYS]);
    expect(VIEWS).toHaveLength(EXPECTED_KEYS.length);
    expect(VIEWS.every((v) => v.renderer === "ontology-graph")).toBe(true);
  });

  it("契约：8 个视角的描述全部落在 options（契约 GraphViewDescSchema），layout 里一个都不剩", () => {
    for (const v of VIEWS) {
      const parsed = GraphViewDescSchema.parse(v.options ?? {});
      expect(parsed.desc, `${v.key}: 后端没下发 options.desc`).toBeTruthy();
      expect(
        strayDescKeysInLayout(v),
        `${v.key}: 描述卡字段又漂回 layout（= G-GRAPH-DESC-CONTRACT-SPLIT 复发）`,
      ).toEqual([]);
    }
  });

  it.each([...EXPECTED_KEYS])("%s：真后端的 desc 原文渲染进 descCard", async (key) => {
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
    expect(mockGraphViews.map((v) => v.key).sort()).toEqual([...EXPECTED_KEYS]);
    for (const mv of mockGraphViews) {
      const parsed = GraphViewDescSchema.parse(mv.options ?? {});
      expect(parsed.desc, `mock ${mv.key}: 缺 options.desc`).toBeTruthy();
      expect(strayDescKeysInLayout(mv), `mock ${mv.key}: 描述卡字段落在 layout`).toEqual([]);
    }
  });
});
