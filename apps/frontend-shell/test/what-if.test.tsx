import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { queryClient } from "@/store/queryClient";

/**
 * WO · 通用假设推演页 generic_inference 前端接线（选对象/属性 → 填假设值 → before/after deltas·KILL-MOCK）。
 * deltas 表 / 影响面计数全部从真 `invokeSolver('generic_inference')` 输出渲染，零写死数字——改假设值 →
 * 求解器重算 → deltas 随之变（本页仅忠实投影）。对象/类型列表从真 REST 取，不写死。
 */

/** 选一个对象类型 → 选第一个真对象 → 选属性 → 填假设值。返回 run 按钮。 */
async function fillHypothesis(propKey: string, value: string): Promise<HTMLElement> {
  const typeSelect = await screen.findByTestId("wi-type-select");
  fireEvent.change(typeSelect, { target: { value: "Base" } });

  // 对象列表异步加载（真 /a/v1/objects?type=Base）—— 等有真对象选项再选第一个。
  const objSelect = await screen.findByTestId("wi-object-select");
  await waitFor(() => {
    const opts = within(objSelect).getAllByRole("option") as HTMLOptionElement[];
    expect(opts.filter((o) => o.value !== "").length).toBeGreaterThan(0);
  });
  const realOpts = (within(objSelect).getAllByRole("option") as HTMLOptionElement[]).filter((o) => o.value !== "");
  fireEvent.change(objSelect, { target: { value: realOpts[0]!.value } });

  fireEvent.change(screen.getByTestId("wi-prop-select"), { target: { value: propKey } });
  fireEvent.change(screen.getByTestId("wi-value-input"), { target: { value } });
  return screen.getByTestId("wi-run") as HTMLElement;
}

describe("WO · 通用假设推演页 generic_inference", () => {
  it("C1 · 调真 solver 出 deltas：选对象/属性 + 假设值 → before/after 表 + 影响面计数", async () => {
    loginAs("planner");
    renderApp("/v/what-if");
    const run = await fillHypothesis("util", "2"); // 数值属性 → 桩 after = 100*2 = 200 / 上游 900+200 = 1100
    fireEvent.click(run);

    // 影响面计数（真 solver 输出：affectedObjects=2 · count=2）
    await screen.findByTestId("wi-result");
    expect(screen.getByTestId("wi-affected-count")).toHaveTextContent("2");
    expect(screen.getByTestId("wi-delta-count")).toHaveTextContent("2");
    // before/after 表（after 真值 200 / 1100，before 100 / 1000）
    const deltas = screen.getByTestId("wi-deltas");
    expect(within(deltas).getByText("200")).toBeInTheDocument();
    expect(within(deltas).getByText("1100")).toBeInTheDocument();
    expect(within(deltas).getByText("capacity_h")).toBeInTheDocument();
    // 变化方向从真值算（100→200 = ▲ +100，纯投影非写死）
    expect(within(deltas).getAllByText(/▲ \+100/).length).toBeGreaterThan(0);
  });

  it("C2 · 改假设值 → deltas 变（求解器重算·前端纯投影）", async () => {
    loginAs("planner");
    renderApp("/v/what-if");
    const run = await fillHypothesis("util", "2");
    fireEvent.click(run);
    const deltas = await screen.findByTestId("wi-deltas");
    expect(within(deltas).getByText("200")).toBeInTheDocument();
    expect(within(deltas).getByText("1100")).toBeInTheDocument();

    // 改假设值 2 → 5 → 重跑 → after 200→500 / 1100→1400（旧值消失）。
    fireEvent.change(screen.getByTestId("wi-value-input"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("wi-run"));
    await waitFor(() => expect(within(screen.getByTestId("wi-deltas")).getByText("500")).toBeInTheDocument());
    const deltas2 = screen.getByTestId("wi-deltas");
    expect(within(deltas2).getByText("1400")).toBeInTheDocument();
    expect(within(deltas2).queryByText("200")).toBeNull();
    expect(within(deltas2).queryByText("1100")).toBeNull();
  });

  it("C3 · KILL-MOCK：页面纯投影 solver 响应（喂显式 payload → 逐字渲，零写死）", async () => {
    loginAs("planner");
    // 覆盖 invoke handler：返回与默认桩不同的显式 deltas —— 证页面无任何写死数字。
    server.use(
      http.post("*/a/v1/solvers/generic_inference/invoke", () =>
        HttpResponse.json({
          data: {
            deltas: [{ objId: "obj-Widget-7", type: "Widget", prop: "yield_rate", before: 0.9, after: 0.42 }],
            rows: [{ objectId: "obj-Widget-7", type: "Widget", prop: "yield_rate", before: 0.9, after: 0.42 }],
            affectedObjects: 3,
            count: 1,
            rootTypes: ["Widget"],
          },
          snapshotVersion: "ov-gi",
        }),
      ),
    );
    renderApp("/v/what-if");
    const run = await fillHypothesis("util", "0.5");
    fireEvent.click(run);

    await screen.findByTestId("wi-result");
    expect(screen.getByTestId("wi-affected-count")).toHaveTextContent("3");
    expect(screen.getByTestId("wi-delta-count")).toHaveTextContent("1");
    expect(screen.getByTestId("wi-root-types")).toHaveTextContent("Widget");
    // 逐字投影响应行（objId / prop / before / after）
    const row = screen.getByTestId("wi-delta-row-obj-Widget-7-yield_rate");
    expect(within(row).getByTestId("wi-before-obj-Widget-7-yield_rate")).toHaveTextContent("0.9");
    expect(within(row).getByTestId("wi-after-obj-Widget-7-yield_rate")).toHaveTextContent("0.42");
    // 0.9→0.42 = ▼ 下降（方向从真值算）
    expect(within(row).getByTestId("wi-diff-obj-Widget-7-yield_rate")).toHaveTextContent("▼");
  });

  it("诚实空态：solver 返回空 deltas → 「无下游影响」，不编造影响面", async () => {
    loginAs("planner");
    server.use(
      http.post("*/a/v1/solvers/generic_inference/invoke", () =>
        HttpResponse.json({ data: { deltas: [], rows: [], affectedObjects: 0, count: 0, rootTypes: ["Base"] }, snapshotVersion: "ov-gi" }),
      ),
    );
    renderApp("/v/what-if");
    const run = await fillHypothesis("util", "99");
    fireEvent.click(run);
    expect(await screen.findByTestId("wi-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("wi-deltas")).toBeNull();
    expect(screen.queryByTestId("wi-impact")).toBeNull();
  });

  /**
   * **降层 ≠ 删除**（WO-UI-BURNDOWN-21 · `docs/CONVENTION-ui-information-layering.md` §1）
   *
   * 上面那条只咬「空态出没出来」，它**证明不了**空态里那段病因说明还在 ——
   * 整段删掉它照样绿。故本条按规范 §1 的三判据 + 一条反向断言逐条咬。
   *
   * ⚠ 判据写法：`InfoPopover` 在 `open===false` 时**根本不渲染**，
   * 所以「默认不可见」必须写 `toBeNull()`；写 `not.toBeVisible()` 会让 jest-dom 自己抛错，
   * 那是**测试报错**，不是判据成立。
   */
  it("空态的病因说明降进 `?` 浮层：默认不在 DOM、hover 后原文一字不少、且不许还留在第一层", async () => {
    loginAs("planner");
    server.use(
      http.post("*/a/v1/solvers/generic_inference/invoke", () =>
        HttpResponse.json({ data: { deltas: [], rows: [], affectedObjects: 0, count: 0, rootTypes: ["Base"] }, snapshotVersion: "ov-gi" }),
      ),
    );
    renderApp("/v/what-if");
    fireEvent.click(await fillHypothesis("util", "99"));
    const empty = await screen.findByTestId("wi-empty");

    // ① 结论 + 可见记号都在第一层
    expect(empty.textContent).toContain("该假设无下游影响");
    const trigger = screen.getByTestId("info-wi-empty-why");
    expect(trigger).toBeVisible();

    // ② 正文默认不在 DOM
    expect(screen.queryByTestId("wi-empty-why-body")).toBeNull();

    // ④ 反向：病因说明不许还摆在第一层（否则「既留第一层又抄一份进浮层」也会全绿）
    expect(empty.textContent, "长说明还留在第一层 ⇒ 没降层").not.toContain("此属性可能没有下游派生链");

    // ③ hover 之后原文逐字取得回来
    await userEvent.hover(trigger);
    const body = await screen.findByTestId("wi-empty-why-body");
    expect(body).toBeVisible();
    expect(body.textContent).toContain("前向重算后未产生任何派生字段变化");
    expect(body.textContent).toContain("此属性可能没有下游派生链，或假设值不改变任何派生结果");
    expect(body.textContent).toContain("诚实空态，不编造影响面");
  });

  it("专用 route /v/what-if 可达 + 未选齐时推演按钮禁用（不空跑）", async () => {
    loginAs("planner");
    cleanup();
    queryClient.clear();
    renderApp("/v/what-if");
    expect(await screen.findByTestId("what-if")).toBeInTheDocument();
    // 仅选类型、未选对象/属性/值 → run 禁用。
    fireEvent.change(await screen.findByTestId("wi-type-select"), { target: { value: "Base" } });
    expect(screen.getByTestId("wi-run")).toBeDisabled();
  });
});
