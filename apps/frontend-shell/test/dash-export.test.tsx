import { describe, expect, it, vi } from "vitest";
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
    // WO-GAP-NORMALIZE 病③b：表头 5 列 → 6 列，末列「口径」（金值变化，理由见 DashboardView 头注）。
    expect(rows[1]).toEqual(["经营指标", "目标", "实际", "偏差", "越线", "口径"]);
    // 越线行标记；两条样例都**未声明** basis ⇒ 末列留空串（不补默认口径）。
    expect(rows[2]).toEqual(["毛利率", 16, 14.2, -1.8, "越线", ""]);
    expect(rows[3]).toEqual(["util", 85, 88, 3, "", ""]);
    // 问题段
    expect(rows).toContainEqual(["待解决的问题", "影响单数", "财务影响(亿)"]);
    expect(rows).toContainEqual(["储能结构毛利倒挂", 5, 2.3]);
    // CSV 可序列化（越线中文不破坏）
    expect(toCsv(rows)).toContain("毛利率,16,14.2,-1.8,越线");
  });

  /**
   * WO-GAP-NORMALIZE 病③b · 口径**真的随指标进 CSV**，且「没声明」与「声明了」分得开。
   * 上一条用的两条样例都没有 basis，只能证明留空不炸；这条才咬住「有 basis 时它出现在末列」。
   */
  it("buildDashExportRows：basis 落末列；未声明者留空而非补默认；全角逗号不劈单元格", () => {
    const rows = buildDashExportRows(
      [
        // 真后端 Metric.basis 的实际形态（全角「，」+「·」，实测取自 metric_rollup 下发）。
        { name: "营收", target: 700, actual: 415.6, delta: -284.4, miss: true, basis: "成交侧 · 订单簿计划年成交额，不含需求预测" },
        { name: "毛利", target: 112, actual: 118.9, delta: 6.9, miss: false, basis: null },
      ],
      [],
    );
    expect(rows[2]).toEqual(["营收", 700, 415.6, -284.4, "越线", "成交侧 · 订单簿计划年成交额，不含需求预测"]);
    expect(rows[3]).toEqual(["毛利", 112, 118.9, 6.9, "", ""]); // basis:null ⇒ 空串，不是 "null"
    // 全角「，」**不是** CSV 分隔符，故 csvCell 不加引号，整段仍是一个单元格 ——
    // 断言写成「必须被引号包住」会是假的（csvCell 只对 ASCII `,` 引号化）。
    const csv = toCsv(rows);
    expect(csv).toContain("越线,成交侧 · 订单簿计划年成交额，不含需求预测");
    expect(csv).not.toContain('"成交侧');
    // 反证同一把尺子有鉴别力：换成 ASCII 逗号就**必须**被引号裹起来，否则会劈成两列。
    expect(csvCell("成交侧, 订单簿")).toBe('"成交侧, 订单簿"');
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
