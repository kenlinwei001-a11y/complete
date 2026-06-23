import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { useSessionStore } from "@/store/sessionStore";
import { db } from "@/mocks/db";

/** jsdom Blob 无 .text() → FileReader 读取 */
const readBlob = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(b);
  });

/** 捕获 Blob 下载（jsdom 无 createObjectURL；锚点 click 改为 no-op 防 jsdom 导航） */
function captureDownloads(): { blobs: Blob[]; restore: () => void } {
  const blobs: Blob[] = [];
  const urlAny = URL as unknown as Record<string, unknown>;
  const origCreate = urlAny.createObjectURL;
  const origRevoke = urlAny.revokeObjectURL;
  urlAny.createObjectURL = (b: Blob) => {
    blobs.push(b);
    return "blob:mock";
  };
  urlAny.revokeObjectURL = () => undefined;
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  return {
    blobs,
    restore: () => {
      urlAny.createObjectURL = origCreate;
      urlAny.revokeObjectURL = origRevoke;
      clickSpy.mockRestore();
    },
  };
}

describe("F27 · 业务建模映射表（§7.20 图谱内功能）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("全屏弹层：按数据域分组 + 列齐全 + 规则徽章可点；行点击关闭并在图谱定位", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/graph");

    await user.click(await screen.findByTestId("graph-mapping-btn"));
    const overlay = await screen.findByTestId("mapping-overlay");

    // 分组组头行
    for (const d of ["工厂", "产品", "产能", "求解器", "智能体"]) {
      expect(within(overlay).getByTestId(`mapping-group-${d}`)).toBeInTheDocument();
    }
    // 列齐全
    const table = within(overlay).getByTestId("mapping-table");
    for (const col of ["对象", "类型", "源系统", "关键属性", "适用规则", "派生公式", "血缘"]) {
      expect(within(table).getByText(col)).toBeInTheDocument();
    }
    // 血缘摘要（连接器·数据集·字段数）
    expect(within(table).getByTestId("mapping-row-Base")).toHaveTextContent("ERP 主数据 · plants · 12 字段");
    // 规则徽章可点开 expression
    await user.click(within(table).getByTestId("mapping-rule-Base-C05"));
    expect(await screen.findByTestId("mapping-rule-expression")).toHaveTextContent("SUSTAIN(产线.utilization > 95, 3)");

    // 行点击 → 关闭弹层 + 图谱定位高亮该节点（检查器 + selectedObjects）
    await user.click(within(table).getByTestId("mapping-row-Base"));
    await waitFor(() => expect(screen.queryByTestId("mapping-overlay")).not.toBeInTheDocument());
    expect(await screen.findByTestId("graph-inspector")).toHaveTextContent("基地");
    expect(useSessionStore.getState().selectedObjects).toEqual([
      expect.objectContaining({ objectId: "n-base", label: "基地" }),
    ]);
  });

  it("四注册表段（PRD-IND-map §4.5-③）：关系类型/规则/Action/事件分段表渲染", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/graph");
    await user.click(await screen.findByTestId("graph-mapping-btn"));
    await screen.findByTestId("mapping-table");

    const regs = await screen.findByTestId("mapping-registries");
    // 4 段都在
    expect(within(regs).getByTestId("mapping-reg-link-table")).toBeInTheDocument();
    expect(within(regs).getByTestId("mapping-reg-rule-table")).toBeInTheDocument();
    expect(within(regs).getByTestId("mapping-reg-action-table")).toBeInTheDocument();
    expect(within(regs).getByTestId("mapping-reg-event-table")).toBeInTheDocument();
    // Action 注册表逐字（采纳产能保障方案 + C10 审批人）
    expect(within(regs).getByTestId("mapping-reg-action-row-采纳产能保障方案")).toHaveTextContent("生产工单MO");
    // 事件对象表（到货间隙 ← WMS/ERP）
    expect(within(regs).getByTestId("mapping-reg-event-row-到货间隙")).toHaveTextContent("WMS/ERP");
    // 关系类型（model_producible_at N:N）
    expect(within(regs).getByTestId("mapping-reg-link-row-model_producible_at")).toHaveTextContent("N:N");
  });

  it("导出 CSV 与自包含 HTML（标题/导出时间/同源脚注）内容抽查", async () => {
    const user = userEvent.setup();
    const dl = captureDownloads();
    try {
      loginAs("planner");
      renderApp("/v/graph");
      await user.click(await screen.findByTestId("graph-mapping-btn"));
      await screen.findByTestId("mapping-table");

      await user.click(screen.getByTestId("mapping-export-csv"));
      expect(dl.blobs).toHaveLength(1);
      const csv = await readBlob(dl.blobs[0]!);
      expect(csv).toContain("对象,类型,数据域,源系统,关键属性,适用规则,派生公式,血缘");
      expect(csv).toContain("基地(Base)");
      expect(csv).toContain("ERP 主数据 · plants · 12 字段");

      await user.click(screen.getByTestId("mapping-export-html"));
      expect(dl.blobs).toHaveLength(2);
      const html = await readBlob(dl.blobs[1]!);
      expect(html).toContain("<title>业务建模映射表</title>");
      expect(html).toContain("导出时间：");
      expect(html).toContain("所有数字派生自同一本体");
      expect(html).toContain("<code>Base</code>");
    } finally {
      dl.restore();
    }
  });

  it("act.export 关闭 → 导出按钮消失（映射表本身仍可用）", async () => {
    const user = userEvent.setup();
    db.tenantOverrides["act.export"] = false;
    loginAs("planner");
    renderApp("/v/graph");

    await user.click(await screen.findByTestId("graph-mapping-btn"));
    await screen.findByTestId("mapping-table");
    expect(screen.queryByTestId("mapping-export-csv")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mapping-export-html")).not.toBeInTheDocument();
  });
});
