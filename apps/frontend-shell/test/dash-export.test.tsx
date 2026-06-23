import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { csvCell, toCsv } from "../src/views/exportCsv";
import { buildDashExportRows } from "../src/views/DashboardView";

/**
 * PRD-cockpit §8 P5「导出」：经营驾驶舱导出 CSV（经营指标 + 待解决问题）。
 * 纯函数确定性 + CSV 注入防护；集成冒烟确认按钮触发下载。
 */
describe("dash 导出 · CSV", () => {
  it("csvCell：公式注入防护（非数字 =/@/-cmd 前缀加 '）+ 数字豁免（负数不误伤）+ 引号/逗号/换行转义", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-cmd|calc")).toBe("'-cmd|calc"); // 非数字危险前缀
    expect(csvCell(-1.8)).toBe("-1.8"); // 负数豁免（不误伤）
    expect(csvCell("-1.8")).toBe("-1.8"); // 负数字符串也豁免
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("常州")).toBe("常州");
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });

  it("toCsv：行→\\r\\n 连接、确定性", () => {
    const csv = toCsv([["a", "b"], ["c", "d"]]);
    expect(csv).toBe("a,b\r\nc,d");
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe(csv); // 确定性
  });

  it("buildDashExportRows：经营指标表头+越线标记 + 问题表头+数据", () => {
    const rows = buildDashExportRows(
      [{ name: "毛利率", target: 16, actual: 14.2, delta: -1.8, miss: true }, { key: "util", target: 85, actual: 88, delta: 3, miss: false }],
      [{ title: "储能结构毛利倒挂", orderCount: 5, financeImpact: 2.3 }],
    );
    // 含标题行 + 指标表头
    expect(rows[0]).toEqual(["经营驾驶舱导出"]);
    expect(rows[1]).toEqual(["经营指标", "目标", "实际", "偏差", "越线"]);
    // 越线行标记
    expect(rows[2]).toEqual(["毛利率", 16, 14.2, -1.8, "越线"]);
    expect(rows[3]).toEqual(["util", 85, 88, 3, ""]);
    // 问题段
    expect(rows).toContainEqual(["待解决的问题", "影响单数", "财务影响(亿)"]);
    expect(rows).toContainEqual(["储能结构毛利倒挂", 5, 2.3]);
    // CSV 可序列化（越线中文不破坏）
    expect(toCsv(rows)).toContain("毛利率,16,14.2,-1.8,越线");
  });

  it("集成：dash 有导出按钮，点击触发下载（URL.createObjectURL 被调）", async () => {
    const createSpy = vi.fn(() => "blob:dash");
    const revokeSpy = vi.fn();
    // jsdom 不实现 createObjectURL；注入 spy 验证下载路径被执行（allSettled 容错，solver mock 缺失也走到下载）
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeSpy;
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/dash");
    const btn = await screen.findByTestId("dash-export");
    await user.click(btn);
    expect(createSpy).toHaveBeenCalled();
  });
});
