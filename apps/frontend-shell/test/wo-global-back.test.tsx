import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { loginAs, renderApp } from "./utils";
import { submitQuery } from "@/api/endpoints";
import { PACKAGE_ID } from "@/mocks/fixtures";

// DrillBack 单测：mock useNavigate 为 spy，真跑组件的 idx 兜底分支（非断言 state 变量）。
const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (importActual) => {
  const actual = await importActual<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateSpy };
});

// 在 mock 之后 import 被测组件（工厂已 hoist）。
import { DrillBack } from "@/components/DrillBack";

describe("WO-GLOBAL-BACK · R17 统一下钻回退 DrillBack", () => {
  const origState = window.history.state;
  beforeEach(() => navigateSpy.mockClear());
  afterEach(() => {
    cleanup();
    window.history.replaceState(origState, "");
  });

  it("有历史（idx>0）→ 点返回真走 navigate(-1)（浏览器后退语义）", async () => {
    const user = userEvent.setup();
    // 模拟 react-router 维护的历史索引：本页非栈首
    window.history.replaceState({ idx: 3 }, "");
    render(
      <MemoryRouter>
        <DrillBack testId="ut-back" fallbackTo="/home" />
      </MemoryRouter>,
    );
    // 返回按钮真渲染在 DOM 中，文案含「返回」
    const btn = screen.getByTestId("ut-back");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("返回");
    await user.click(btn);
    expect(navigateSpy).toHaveBeenCalledWith(-1);
    expect(navigateSpy).not.toHaveBeenCalledWith("/home");
  });

  it("无历史（idx=0，直链/刷新落地）→ 点返回走 fallbackTo（不退出站点）", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ idx: 0 }, "");
    render(
      <MemoryRouter>
        <DrillBack testId="ut-back" fallbackTo="/scenarios" />
      </MemoryRouter>,
    );
    await user.click(screen.getByTestId("ut-back"));
    expect(navigateSpy).toHaveBeenCalledWith("/scenarios");
    expect(navigateSpy).not.toHaveBeenCalledWith(-1);
  });

  it("history.state 缺省（idx 未定义）→ 视作栈首走 fallbackTo（含无 fallbackTo 时兜底根路径）", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "");
    render(
      <MemoryRouter>
        <DrillBack testId="ut-back" />
      </MemoryRouter>,
    );
    await user.click(screen.getByTestId("ut-back"));
    expect(navigateSpy).toHaveBeenCalledWith("/");
  });

  it("面包屑 trail 真渲染：有 to 的节点可点跳转，末项纯文本", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ idx: 1 }, "");
    render(
      <MemoryRouter>
        <DrillBack testId="ut-back" trail={[{ label: "经营驾驶舱", to: "/v/dash" }, { label: "订单全链聚合" }]} />
      </MemoryRouter>,
    );
    expect(screen.getByText("经营驾驶舱")).toBeInTheDocument();
    expect(screen.getByText("订单全链聚合")).toBeInTheDocument();
    await user.click(screen.getByText("经营驾驶舱"));
    expect(navigateSpy).toHaveBeenCalledWith("/v/dash");
  });
});

describe("WO-GLOBAL-BACK · 死路页真渲染返回按钮（整页下钻回退）", () => {
  afterEach(cleanup);

  it("对象 360（/o/:typeKey/:objectKey）顶部真出现 o360-back 返回按钮", async () => {
    loginAs("planner");
    renderApp("/o/Base/常州");
    await screen.findByTestId("object-360");
    const back = await screen.findByTestId("o360-back");
    expect(back).toBeInTheDocument();
    expect(back).toHaveTextContent("返回");
  });

  it("任务详情（/tasks/:taskId）顶部真出现 task-back 返回按钮", async () => {
    loginAs("planner");
    const res = await submitQuery(
      { packageId: PACKAGE_ID, query: "影响哪些订单？", context: { view: "risk", selectedObjects: [], filters: {} } },
      "idem-wo-global-back-task",
    );
    renderApp(`/tasks/${res.taskId}`);
    const back = await screen.findByTestId("task-back");
    await waitFor(() => expect(back).toBeInTheDocument());
    expect(back).toHaveTextContent("返回");
  });
});
