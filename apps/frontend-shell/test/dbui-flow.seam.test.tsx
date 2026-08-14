import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-DBUI-FLOW · 数据构建主流程**接缝驱动测试**（前端半）。
 *
 * 咬死仓主原话里的每一条：
 *   「输入故事脚本 - 显示目前缺少的信息 - 人工触发创建 - 开始创建 -
 *     完成创建（显示创建的信息）- 人工确定入库或选择下载」
 *   「模拟的数据是否可以入库，需要系统再次复验自检，因为人不清楚系统里面的数据现状，是否有冲突等等」
 *   「需要展示具体创建了哪些数据详情（表格形式），而不只是说创建了 XX 数据」
 *
 * 接缝在哪：**前端第 ⑥ 步的裁决按钮 → 后端 promote 的 decisions 入参**。
 * 只测前端渲染不算驱动接缝，所以这里必须走到「不裁决 → 入库按钮真的按不下去」为止。
 */
describe("WO-DBUI-FLOW · 数据构建六步主流程（接缝：裁决 → 入库）", () => {
  it("第一屏第一个可交互控件就是故事脚本输入（不是合成模板）", async () => {
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const page = screen.getByTestId("data-builder-page");

    // 判据不是「脚本框存在」（它改前也存在，只是在第二屏），而是**它在所有可交互控件里排第一**。
    const interactive = page.querySelectorAll("input, textarea, select, button, a[href]");
    expect(interactive.length).toBeGreaterThan(0); // 金丝雀：真的选到了控件，不是空集恒真
    const first = interactive[0] as HTMLElement;
    expect(first.getAttribute("data-testid")).toBe("dbf-script");
    expect(first.tagName.toLowerCase()).toBe("textarea");

    // 六步全部可见（未完成的置灰但可见——让人知道后面还有什么）
    for (const k of ["input", "gap", "confirm", "building", "done", "commit"]) {
      expect(screen.getByTestId(`dbf-step-${k}`)).toBeTruthy();
    }
    // 开始前只有一个「开始」，不是 5 个入口
    expect(screen.getByTestId("dbf-start").textContent).toContain("开始");
  });

  it("走完六步：开始 → 读出什么·缺什么 → 开始创建 → 明细表 → 复验 → 入库与下载同时在屏", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");

    // ① → ②：一个「开始」，先零副作用读一遍
    await user.click(screen.getByTestId("dbf-start"));
    const stepGap = await screen.findByTestId("dbf-step-gap");
    expect(stepGap.getAttribute("data-state")).not.toBe("locked");
    // 「读出来什么」：分组卡片
    expect(await within(stepGap).findByTestId("dbf-read-对象类型")).toBeTruthy();
    // 「还缺什么」提到一等位置（改前埋在「展开七阶段 → 点进 gap 那一步」三层之下）
    expect(within(stepGap).getByTestId("dbf-missing")).toBeTruthy();

    // ③：人工确认才开始创建
    await user.click(await screen.findByTestId("dbf-build"));

    // ⑤：逐条明细**表格**（不是「创建了 XX 条」）
    const table = await screen.findByTestId("dbf-artifact-table", undefined, { timeout: 5000 });
    expect(table.querySelector("table")).toBeTruthy();
    // REUSED 必须和 CREATED 一样显示出来（"复用了既有的" 正是"人不清楚系统里面的数据现状"的正面回答）
    expect(within(table).getByTestId("dbf-artifact-action-affected_orders").textContent).toContain("复用既有");
    expect(within(table).getByTestId("dbf-artifact-action-Order").textContent).toContain("新建");
    // DRAFT 一眼可辨且**有文字**（不能只靠颜色：色觉障碍 + 浅色皮都收不到颜色传的信息）
    expect(within(table).getByTestId("dbf-artifact-intent-risk_inference").textContent).toContain("草稿（未生效）");
    // 深链来自契约单源 MODULE_REGISTRY，前端不重定义
    const ontologyRow = within(table).getByTestId("dbf-artifact-objectType-Order");
    expect(within(ontologyRow).getByText("去核对 →").getAttribute("href")).toBe("/admin/modeling");

    // 汇总条（波及面）与明细表（具体是哪些）**两个都在** —— 回答的是两个不同问题
    expect(screen.getByTestId("dbf-module-summary")).toBeTruthy();

    // ⑥：入库与下载**同时**在屏
    const commit = await screen.findByTestId("dbf-step-commit");
    expect(within(commit).getByTestId("dbf-promote")).toBeTruthy();
    expect(within(commit).getByTestId("dbf-download")).toBeTruthy();
  });

  it("入库前复验：三类冲突分开报 + 逐条给既有值/将写值/建议动作 + 世界漂移提示", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    await user.click(screen.getByTestId("dbf-start"));
    await user.click(await screen.findByTestId("dbf-build"));
    await screen.findByTestId("dbf-artifact-table", undefined, { timeout: 5000 });

    await user.click(await screen.findByTestId("dbf-precheck"));
    const res = await screen.findByTestId("dbf-precheck-result");

    // 三类**各自**有数，不是一个合计数 —— 合成一个数等于让人无法裁决
    expect(within(res).getByTestId("dbf-count-type").textContent).toContain("1");
    expect(within(res).getByTestId("dbf-count-linkdiff").textContent).toContain("1");
    expect(within(res).getByTestId("dbf-count-linksame").textContent).toContain("1");

    // 「会改掉既有定义」那一类被单独标成"必须你来定"，与"写了个一样的"分开
    const diff = within(res).getByTestId("dbf-conflict-order_of_customer");
    expect(diff.getAttribute("data-kind")).toBe("LINK_SAME_KEY_DIFF_DEF");
    expect(within(diff).getByTestId("dbf-conflict-blocking-order_of_customer")).toBeTruthy();
    const same = within(res).getByTestId("dbf-conflict-line_of_base");
    expect(same.getAttribute("data-kind")).toBe("LINK_SAME_KEY_SAME_DEF");
    expect(within(same).queryByTestId("dbf-conflict-blocking-line_of_base")).toBeNull();

    // 每条给：既有值 / 将写值 / 建议动作
    const row = within(diff).getByTestId("dbf-conflict-row-order_of_customer-终点类型");
    expect(row.textContent).toContain("Account"); // 库里现在是
    expect(row.textContent).toContain("Customer"); // 这次要写成
    expect(within(diff).getByTestId("dbf-decide-order_of_customer-USE")).toBeTruthy();
    expect(within(diff).getByTestId("dbf-decide-order_of_customer-MERGE")).toBeTruthy();

    // 建域后世界变了 → 明确提示且说明变在哪（T1 vs T2）
    const drift = within(res).getByTestId("dbf-drift");
    expect(drift.textContent).toContain("建完之后库里变过了");
    expect(drift.textContent).toContain("比对现状");
  });

  it("接缝：没裁决 → 入库按钮按不下去；裁决后 → 真调后端 promote 并带上 decisions", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    await user.click(screen.getByTestId("dbf-start"));
    await user.click(await screen.findByTestId("dbf-build"));
    await screen.findByTestId("dbf-artifact-table", undefined, { timeout: 5000 });
    await user.click(await screen.findByTestId("dbf-precheck"));
    await screen.findByTestId("dbf-precheck-result");

    // 无裁决 ⇒ 入库被堵住，且屏上说清还差几处（**不是**静默按默认动作写）
    const promoteBtn = screen.getByTestId("dbf-promote") as HTMLButtonElement;
    expect(promoteBtn.disabled).toBe(true);
    expect(screen.getByTestId("dbf-pending-decisions").textContent).toContain("1");

    // 人裁决「沿用库里既有的」⇒ 放行
    await user.click(screen.getByTestId("dbf-decide-order_of_customer-USE"));
    expect((screen.getByTestId("dbf-promote") as HTMLButtonElement).disabled).toBe(false);

    // 真入库 —— 后端 mock 校验 decisions 必须带上 linkType:order_of_customer，否则 400。
    // 这就是接缝：前端的裁决按钮 → 后端 promote 的 decisions 入参，任一半漏即红。
    await user.click(screen.getByTestId("dbf-promote"));
    const promoted = await screen.findByTestId("dbf-promoted", undefined, { timeout: 5000 });
    expect(promoted.textContent).toContain("已入库");
    // 诚实位：复用了库里既有的哪些、按裁决保留了哪些既有关系 —— 改前这两批一个字都不显示
    expect(promoted.textContent).toContain("复用了库里既有的 Order");
    expect(promoted.textContent).toContain("保留了既有关系 order_of_customer");
  });

  it("屏上不出现区号，也不出现给开发看的话", async () => {
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const text = screen.getByTestId("data-builder-page").textContent ?? "";

    // 金丝雀：先证明真的取到了页面文本，不是空串恒真
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("数据构建");

    expect(text).not.toMatch(/区[0-9]/);
    for (const jargon of ["三页归一", "厂商中立", "自成长收编"]) {
      expect(text).not.toContain(jargon);
    }
  });
});
