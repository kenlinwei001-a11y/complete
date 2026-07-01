import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

/**
 * WO-1C-PARSE（G-progress）：EXTRACTING 文档在审核台渲染抽取进度条 (done+failed)/total + failed 徽章。
 * 直接把一份 EXTRACTING + extractProgress 的 doc 放进 mock db，选中它 → 断言 ruledoc-progress 渲染。
 */
describe("F9b · 规则文档抽取进度条", () => {
  it("EXTRACTING 文档渲染 ruledoc-progress（done+failed/total）+ failed 徽章", async () => {
    // 抽取中的文档放在列表首位 → 审核台默认选中它（doc = docs[0]），无需手动切换 select。
    db.ruleDocs.unshift({
      id: "doc-extracting",
      filename: "抽取中的制度.md",
      status: "EXTRACTING",
      createdAt: new Date().toISOString(),
      segments: [
        { idx: 0, heading: "一", text: "第一段规则文本。", spanStart: 0, spanEnd: 8 },
        { idx: 1, heading: "二", text: "第二段规则文本。", spanStart: 9, spanEnd: 17 },
        { idx: 2, heading: "三", text: "第三段规则文本。", spanStart: 18, spanEnd: 26 },
        { idx: 3, heading: "四", text: "第四段规则文本。", spanStart: 27, spanEnd: 35 },
      ],
      extractProgress: { total: 4, done: 2, failed: 1, updatedAt: new Date().toISOString() },
    });

    loginAs("planner");
    renderApp("/admin/rule-docs");

    const progress = await screen.findByTestId("ruledoc-progress");
    // (done+failed)/total = (2+1)/4 = 3/4
    expect(screen.getByTestId("ruledoc-progress-count")).toHaveTextContent("3/4");
    // failed 徽章
    expect(screen.getByTestId("ruledoc-progress-failed")).toHaveTextContent("失败 1");
    // EXTRACTING 徽章仍在
    expect(screen.getByTestId("rule-doc-extracting")).toBeInTheDocument();
    expect(progress).toBeInTheDocument();
  });
});
