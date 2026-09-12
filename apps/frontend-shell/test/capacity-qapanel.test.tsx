import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-CAPACITY-QAPANEL-REAL-NL · 产能页「模板问答」与「真对话」的**可分辨性**组合测。
 *
 * ── 守的命题（不是「组件还在」）─────────────────────────────────────────────────
 * 本页同屏并列两个输入框：上面 `QaPanel`（关键词匹配·浏览器本地派生）、下面 `CapacityLiveDialog`
 * （真 NL·经 `askCapacityLive` → orchestrator → 真求解器）。二者此前**外观一样、标题同以 💬 开头**，
 * 且模板框匹配不上时返回一句**读起来像答案**的兜底文 ⇒ 用户无从判断自己那句到底被理解了没有。
 * 本文件咬的就是这件事的三个可证伪面：
 *   ① 匹配不上 → 屏上是**没匹配上**这个**状态**，不是一条答案（`data-qa-state="miss"`）；
 *   ② 匹配得上 → 答案与改前**逐字一致**（不许把已能回答的问题弄丢）；
 *   ③ 两条路可分辨 **且有路可走** —— 模板框有种类记号、真对话框没有，
 *      点「转到下方真对话」焦点**真的落在真对话的输入框上**（不是只有一个按钮在那儿）。
 *
 * ── 变异反证（本文件的存在理由）────────────────────────────────────────────────
 * 把 `QA_KIND_MARK` 那一行记号删掉 ⇒ T3 红；
 * 把 `answer()` 的兜底支改回旧的「已知本卡真值：…」⇒ T1 红。
 * 两条都红在**行为**上（状态/焦点/文案），不是红在「组件不见了」。
 */

/** 常州卡真值（`src/mocks/fixtures.ts` RISK_TIMELINE）：peak 96 · crossDay 5 · 两张单两家客户。 */
const CZ = {
  factor: "化成柜张力",
  peak: 96,
  crossDay: 5,
  threshold: 85,
  custs: ["蔚途汽车", "极光新能源"],
  sos: ["SO-10001", "SO-10004"],
};

async function openChangzhou(): Promise<void> {
  loginAs("planner");
  renderApp("/v/risk");
  const card = await screen.findByTestId("risk-card-常州");
  fireEvent.click(card);
  await screen.findByTestId("risk-detail-常州");
}

describe("WO-CAPACITY-QAPANEL-REAL-NL · 模板问答 ≠ 真对话", () => {
  it("T1 问一句模板覆盖不到的话 → 屏上是「没匹配上」这个状态，**不是**一条伪装成答案的兜底文", async () => {
    const user = userEvent.setup();
    await openChangzhou();

    const panel = await screen.findByTestId("risk-qa-panel");
    // 起手是 idle（还没问）——三态必须分得开，不许把「没问过」和「答上了」混成一个。
    expect(within(panel).getByTestId("risk-qa-answer")).toHaveAttribute("data-qa-state", "idle");

    // 这句正是用户会打进上面这个框、而只有下面真对话答得了的那类问题（what-if）。
    await user.type(within(panel).getByTestId("risk-qa-input"), "化成良率降到 92% 产能少多少？");
    await user.click(within(panel).getByTestId("risk-qa-ask"));

    const ans = within(panel).getByTestId("risk-qa-answer");
    await waitFor(() => expect(ans).toHaveAttribute("data-qa-state", "miss"));
    // 病灶原文：旧兜底支返回「已知本卡真值：峰值 96 · T+5 越线 …可问：…」——读起来像答案。
    // 这三条断言就是钉死那句话不许回来（改回去 ⇒ 本用例红在这里）。
    expect(ans).not.toHaveTextContent("已知本卡真值");
    expect(ans).not.toHaveTextContent(String(CZ.peak));
    expect(ans).toHaveTextContent("没匹配上");
    // 没匹配上时必须同时说清「本框认哪几个词」——否则用户不知道下一句该怎么问。
    expect(within(panel).getByTestId("risk-qa-unmatched")).toBeInTheDocument();
  });

  it("T2 问模板覆盖得到的四句 → 答案与改前**逐字一致**（真值来自本卡求解器输出·不许弄丢）", async () => {
    const user = userEvent.setup();
    await openChangzhou();
    const panel = await screen.findByTestId("risk-qa-panel");
    const ans = within(panel).getByTestId("risk-qa-answer");

    // ① 客户：数字与名单都来自 card.affectedOrders 去重（非写死示意）。
    await user.click(within(panel).getByTestId("qa-chip-影响哪些客户？"));
    await waitFor(() => expect(ans).toHaveAttribute("data-qa-state", "hit"));
    expect(ans).toHaveTextContent(`受威胁客户 ${CZ.custs.length} 家：${CZ.custs.join("、")}`);

    // ② 订单：批数 + 单号逐字。
    await user.click(within(panel).getByTestId("qa-chip-哪些订单受影响？"));
    await waitFor(() => expect(ans).toHaveTextContent(`受影响订单 ${CZ.sos.length} 批`));
    for (const so of CZ.sos) expect(ans).toHaveTextContent(so);

    // ③ 为什么越线：因子 + 越线日 + 阈值 + 峰值张力。
    await user.click(within(panel).getByTestId("qa-chip-为什么会越线？"));
    await waitFor(() => expect(ans).toHaveTextContent(CZ.factor));
    expect(ans).toHaveTextContent(`预计 T+${CZ.crossDay} 越线（阈值 ${CZ.threshold}）`);
    expect(ans).toHaveTextContent(`峰值张力 ${CZ.peak}`);

    // ④ 最坏后果：客户数 / 订单批数 / 最早越线日。
    await user.click(within(panel).getByTestId("qa-chip-最坏后果是什么？"));
    await waitFor(() => expect(ans).toHaveTextContent("最坏后果"));
    expect(ans).toHaveTextContent(`${CZ.custs.length} 家客户 / ${CZ.sos.length} 批订单受影响`);
    expect(ans).toHaveTextContent(`最早 T+${CZ.crossDay} 越线`);

    // 四句全程都是 hit —— 「诚实降级」不许拿「把答不上的都标成没匹配」当省事的实现。
    expect(ans).toHaveAttribute("data-qa-state", "hit");
  });

  it("T3 真假两条路可分辨 **且有路可走**：模板框带种类记号 · 真对话框不带 · 点「转到真对话」焦点真的落过去", async () => {
    const user = userEvent.setup();
    await openChangzhou();

    const panel = await screen.findByTestId("risk-qa-panel");
    const dialog = await screen.findByTestId("capacity-live-dialog-changzhou");

    // ① 记号在第一层（不点就看得见），且**只有模板框有** —— 记号删掉 ⇒ 这三行当场红。
    const kind = within(panel).getByTestId("risk-qa-kind");
    expect(kind).toBeVisible();
    expect(kind).toHaveTextContent("模板问答");
    expect(within(dialog).queryByTestId("risk-qa-kind")).toBeNull();

    // ② 两个框的提交动作不同名（「匹配」vs「提问」）——同屏两个按钮不许长成一句话。
    const tplAsk = within(panel).getByTestId("risk-qa-ask").textContent ?? "";
    const liveAsk = within(dialog).getByTestId("capacity-live-ask").textContent ?? "";
    expect(tplAsk).not.toBe(liveAsk);

    // ③ **路是通的**：点它 → 焦点落在真对话的输入框上（不是只摆一个按钮在那儿）。
    const liveInput = within(dialog).getByTestId("capacity-live-input");
    expect(document.activeElement).not.toBe(liveInput);
    await user.click(within(panel).getByTestId("risk-qa-escalate"));
    await waitFor(() => expect(document.activeElement).toBe(liveInput));

    // ④ 落过去之后那条真路照常能用（这才叫「进真对话的路」，不是把人送到一个死框里）。
    await user.type(liveInput, "化成良率降到 92% 产能少多少？");
    await user.click(within(dialog).getByTestId("capacity-live-ask"));
    const liveAns = await screen.findByTestId("capacity-live-answer");
    await waitFor(() => expect(liveAns).toHaveTextContent("92"));
    expect(within(dialog).getByTestId("capacity-live-solver")).toBeInTheDocument();
  });

  it("T4 第一层只放记号与状态，完整口径在 `?` 浮层里（不点看不见·点了才出现）", async () => {
    const user = userEvent.setup();
    await openChangzhou();
    const panel = await screen.findByTestId("risk-qa-panel");

    // 「非智能问答 / 同源求解器」这类整句口径**不在**第一层。
    expect(panel.textContent ?? "").not.toContain("非智能问答");
    // 但它没被删——记号在第一层，正文在浮层（规范 §1：允许降到浮层、绝不允许删除）。
    const trigger = within(panel).getByTestId("info-risk-qa-disclosure-info");
    expect(trigger).toBeVisible();
    expect(screen.queryByTestId("info-body-risk-qa-disclosure-info")).toBeNull();
    await user.hover(trigger);
    const body = await screen.findByTestId("info-body-risk-qa-disclosure-info");
    expect(body).toHaveTextContent("非智能问答");
    expect(body).toHaveTextContent("关键词匹配");
  });
});
