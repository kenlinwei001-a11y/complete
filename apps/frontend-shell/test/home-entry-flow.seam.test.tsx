import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { NAV_GROUPS } from "@/pages/ShellLayout";
import { EVENT_GUIDES, SYNONYMS_BY_SNO } from "@/config/eventGuidance";
import { enrichScenarioCardsForSearch, type ScenarioCardVM } from "@/api/endpoints";

/**
 * WO-HOME-ENTRY-FLOW · 首页入口与遇事指引的接缝。
 *
 * ══ 它咬的是什么（不是"函数对不对"，是"两个集合对不对得上"）════════════════════════
 *
 * 本单修的病是一个**接缝**病：左导航（`ShellLayout.UnifiedNav`）认三种 kind，
 * 而首页（`HomePage`）只渲染 `workspace.navigation`（= 只装得下 `kind:"view"`）。
 * 两边的集合从根上不同 ⇒ 真浏览器实测：侧栏有、首页没有的正好是三个 `kind:"route"` 项
 * （统一推演控制台 / 推演沙盘 / 事件影响与对策）。
 *
 * 故本文件的断言一律落在**两侧集合的关系**上，不落在"某个键在不在"这种写死的清单上 ——
 * 写死清单的话，下次谁在 NAV_GROUPS 里加第四个 route 项，这里照样绿，病原地复发。
 * 判据用「首页 ⊇ 侧栏该显示的 route 项」这条**关系**，对未来新增的键同样有效。
 *
 * ⚠ 每条断言都配金丝雀：报「首页没有 X」这类否定结论之前，先拿一个**确定有**的
 *   （`dash` / 经营驾驶舱）用同一把尺子量一遍。金丝雀不中 ⇒ 结论是「量法坏了」，
 *   不许报「首页少了东西」。这条纪律本单在真浏览器里踩过一次实账：
 *   `assertNoMock` 把端口 4001/4002 写死在正则里，换端口取证时报 `realHits: 0`，
 *   读起来和「页面在走 mock」一模一样。
 */
describe("WO-HOME-ENTRY-FLOW · 首页入口 ⊇ 侧栏 route 项 + 遇事指引", () => {
  it("首页把 kind:\"route\" 的导航项也铺出来（含统一推演控制台），且 view 项一个不丢", async () => {
    loginAs("admin");
    renderApp("/");
    await screen.findByTestId("home-page");

    // 金丝雀：一个我**确定**首页有的 view 项。它若也不中 ⇒ 这把尺子坏了，下面的否定结论一律作废。
    expect(screen.getByTestId("home-view-dash")).toBeInTheDocument();

    // 关系断言：NAV_GROUPS 里**该显示**的 route 项，首页必须都有。
    // 「该显示」的规则与 UnifiedNav 逐字相同：feature 关→隐藏；consolidatedWhen 开→隐藏。
    // 本测试环境（mock fixtures）里 sim.sandbox 的开关态由 fixtures 决定，故这里只断言
    // **无条件显示**的那批（既不带 feature 也不带 consolidatedWhen）——它们在任何租户态下都必须在。
    const alwaysVisibleRoutes = NAV_GROUPS.flatMap((g) => g.items)
      .filter((it): it is Extract<(typeof NAV_GROUPS)[number]["items"][number], { kind: "route" }> => it.kind === "route")
      .filter((it) => !it.feature && !it.consolidatedWhen);

    // 金丝雀：这批不许是空的 —— 空集合会让下面的 for 循环一次都不跑，然后"全过"。
    expect(alwaysVisibleRoutes.length).toBeGreaterThan(0);
    // 主流程起点必须在这批里（它正是真浏览器实测中首页缺掉的那一个）。
    expect(alwaysVisibleRoutes.map((r) => r.key)).toContain("sim-unified");

    for (const r of alwaysVisibleRoutes) {
      const el = screen.getByTestId(`home-view-${r.key}`);
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute("href", `/v/${r.key}`);
      // 文案取 NAV_GROUPS 里那一份，不许首页另写一份（第二份真相源 = 下次漂移的种子）
      expect(el).toHaveTextContent(r.label);
    }
  });

  it("遇事指引区：每条都给出「该点哪个」，且指到一张真在册的场景卡", async () => {
    loginAs("admin");
    renderApp("/");
    await screen.findByTestId("home-page");

    const box = await screen.findByTestId("home-event-guidance");
    // 金丝雀：指引表非空（空表会让下面逐条断言全部跳过，然后"全过"）
    expect(EVENT_GUIDES.length).toBeGreaterThan(0);

    // 「物料延期该点哪个」这个问题必须在屏上有答案 —— 这是本单的靶心。
    const materialGuide = EVENT_GUIDES.find((g) => g.key === "material-delay");
    expect(materialGuide).toBeDefined();
    expect(materialGuide!.synonyms).toContain("物料延期");

    const chip = within(box).getByTestId("home-event-material-delay");
    expect(chip).toHaveTextContent(materialGuide!.event);
    expect(chip).toHaveTextContent(materialGuide!.answer);
    // 答案里必须点名一个**具体入口**，不是"去推演一下"这种废话
    expect(materialGuide!.answer).toMatch(/【.+】/);
  });

  it("⌘K 同义词在数据侧补进可搜文本：面板搜的那几个字段真的含事件词，且不重复累加", () => {
    // 面板的检索面是 [name, triggerQuestion, sNo, summary]（CommandPalette 那一行）。
    // 新字段它一个字都读不到 ⇒ 同义词必须落在这四个字段里，否则就是"加了等于没加"的假绿。
    const card: ScenarioCardVM = {
      sNo: "S08",
      name: "物料齐套分析",
      view: "risk",
      intentKey: "kit_analysis",
      triggerQuestion: "下周哪些订单缺料开不了工？",
      riskLevel: "COMPUTE",
      summary: "解读齐套分析",
      willProduceDraft: false,
      presetContext: { targetView: "risk", selectedObjects: [], slotPresets: {} },
    };

    const once = enrichScenarioCardsForSearch([card]);
    expect(once[0].summary).toContain("物料延期");
    // 原文不许被吃掉（同义词是**追加**，不是替换）
    expect(once[0].summary).toContain("解读齐套分析");
    // 纯函数：不许原地改缓存对象（react-query 的 items 会被反复读）
    expect(card.summary).toBe("解读齐套分析");

    // 幂等：同一份数据被 enrich 两次（react-query 重取/重渲染）不许越滚越长
    const twice = enrichScenarioCardsForSearch(once);
    expect(twice[0].summary).toBe(once[0].summary);

    // 金丝雀：没有登记同义词的卡**原样返回** —— 若这条也变了，说明我在给所有卡乱加词
    const other: ScenarioCardVM = { ...card, sNo: "S99", summary: "不该被动" };
    expect(SYNONYMS_BY_SNO["S99"]).toBeUndefined();
    expect(enrichScenarioCardsForSearch([other])[0].summary).toBe("不该被动");
  });
});
