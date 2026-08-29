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

/**
 * 选一个对象类型 → 选第一个真对象 → 选属性 → 填假设值。
 *
 * ⚠ **WO-SANDBOX-53CELLS 起本函数不再返回按钮，因为按钮没有了**（判据 U1「改输入即重演」）。
 * 本页此前有一个 `wi-run` 提交闸：四项填完还得点它，`run()` 才命令式调求解器。
 * 判据点名的正是那个东西，且它的失败模式最坏 ——
 * **用户改完假设值不点，屏上还挂着上一次的结果，且分辨不出**。
 * 改后假设直接进 `queryKey`，填完/改完即重算，所以调用方只管填、不管点。
 */
async function fillHypothesis(propKey: string, value: string): Promise<void> {
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
}

describe("WO · 通用假设推演页 generic_inference", () => {
  it("C1 · 调真 solver 出 deltas：选对象/属性 + 假设值 → before/after 表 + 影响面计数", async () => {
    loginAs("planner");
    renderApp("/v/what-if");
    await fillHypothesis("util", "2"); // 数值属性 → 桩 after = 100*2 = 200 / 上游 900+200 = 1100

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
    await fillHypothesis("util", "2");
    const deltas = await screen.findByTestId("wi-deltas");
    expect(within(deltas).getByText("200")).toBeInTheDocument();
    expect(within(deltas).getByText("1100")).toBeInTheDocument();

    // 改假设值 2 → 5 → 重跑 → after 200→500 / 1100→1400（旧值消失）。
    fireEvent.change(screen.getByTestId("wi-value-input"), { target: { value: "5" } });
    // ⚠ 这里**不点任何东西** —— 判据 U1 要的就是「改完即重演」。
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
    await fillHypothesis("util", "0.5");

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
    await fillHypothesis("util", "99");
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
    await fillHypothesis("util", "99");
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

  /**
   * 判据 **U1「改输入即重演」**（`docs/PRD-harness-ux-adoption.md` §2）。
   *
   * 这条**替换**了原来那条「未选齐时推演按钮禁用（不空跑）」——
   * 原条断言的是提交闸的**禁用态**，而判据要的是提交闸**不存在**。
   * 两者不可能同时成立，所以这不是把测试改松，是判据换了：
   * 原条守的性质（未填齐不空跑）由本条的第二段照样咬住，只是判据从「按钮禁用」
   * 换成了「求解器一次都没被调」—— 后者才是那句话真正想说的东西。
   */
  it("U1 · 提交闸不存在（无 wi-run），且未填齐时求解器一次都不调（不空跑）", async () => {
    loginAs("planner");
    cleanup();
    queryClient.clear();
    let calls = 0;
    server.use(
      http.post("*/a/v1/solvers/generic_inference/invoke", () => {
        calls += 1;
        return HttpResponse.json({ data: { deltas: [], rows: [], affectedObjects: 0, count: 0, rootTypes: [] }, snapshotVersion: "ov-gi" });
      }),
    );
    renderApp("/v/what-if");
    expect(await screen.findByTestId("what-if")).toBeInTheDocument();
    // ⚠ 必须先等表单真渲染出来再断言「按钮不在」——
    // 类型列表还在加载时整块表单都不渲染，那时 `queryByTestId("wi-run")` **恒为 null**，
    // 拿它当「提交闸没了」的证据是假绿（第一版就是这么写的，靠 `wi-live-state` 找不到才暴露）。
    await screen.findByTestId("wi-type-select");

    // ① 提交闸不存在 —— 判据 U1 的结构判据（「不存在必须先点某个按钮结果才更新的中间态」）。
    expect(screen.queryByTestId("wi-run")).toBeNull();
    // 屏上留的是**状态记号**（在算 / 已按当前假设算出），它不控制任何东西。
    expect(screen.getByTestId("wi-live-state")).toBeInTheDocument();

    // ② 仅选类型、未选对象/属性/值 → 不空跑（原条「按钮禁用」守的就是这个性质，换成直接咬调用次数）。
    fireEvent.change(screen.getByTestId("wi-type-select"), { target: { value: "Base" } });
    await waitFor(() => expect(screen.getByTestId("wi-object-select")).toBeInTheDocument());
    expect(calls).toBe(0);
    expect(screen.queryByTestId("wi-result")).toBeNull();

    // ③ 金丝雀：填齐之后**不点任何东西**，求解器必须被调到 —— 否则上面两条会被一个「永远不调」的实现骗绿。
    await fillHypothesis("util", "2");
    await waitFor(() => expect(calls).toBeGreaterThan(0));
  });
});
