import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-U6-ACTION-FROM-CONCLUSION · 判据 U6「结论即动作」× `what-if` —— **前端半接缝**。
 *
 * 病灶：这一页第一层写着「不落库、纯试算」（那句话是真的），于是用户看完 before/after 之后
 * **无处可去** —— 想真的改这个值，得记下参数、另找一张页面重填一遍。判据表因此记「不符合」。
 *
 * 本测断言的**不是**「有一个按钮」，而是那条链上唯一会骗人的那一段：
 * 点下去发出的 `POST /a/v1/action-drafts`，其 `payload` 里的**参数就是屏上那份假设**
 * —— 对象 id 取自下拉框当前选中的那一项（不是写死串）、`patch` 的键就是选中的 propKey、
 * 值经 `coerce` 后是 **number 2** 而不是字符串 `"2"`。
 *
 * ⛔ 本测**刻意不**断言 mutation 被调用过 / 按钮存在 —— 那两件事在 payload 全空时照样绿，
 *    正是 `G-ACTION-NOOP-EXEC`（全链绿、留痕齐全、真值一字节没动）的形态。
 * 后端半（审批 → 真写对象 → **换一条路**读回字段真的变了）见
 * `apps/datacore/test/action-adopt-hypothesis.seam.test.ts`。
 */

interface CapturedDraft {
  actionTypeKey?: string;
  payload?: Record<string, unknown>;
  submit?: boolean;
}

function captureDrafts(): { captured: CapturedDraft[] } {
  const captured: CapturedDraft[] = [];
  server.use(
    http.post("*/a/v1/action-drafts", async ({ request }) => {
      captured.push((await request.json()) as CapturedDraft);
      return HttpResponse.json({ draftId: "act-wi-adopt", status: "PENDING_APPROVAL" }, { status: 201 });
    }),
  );
  return { captured };
}

/** 填一份假设，并把**下拉框当前真正选中的那个 objectId** 回给调用方（用它对账，不写死 id）。 */
async function fillHypothesis(propKey: string, value: string): Promise<string> {
  const typeSelect = await screen.findByTestId("wi-type-select");
  fireEvent.change(typeSelect, { target: { value: "Base" } });

  const objSelect = await screen.findByTestId("wi-object-select");
  await waitFor(() => {
    const opts = within(objSelect).getAllByRole("option") as HTMLOptionElement[];
    expect(opts.filter((o) => o.value !== "").length).toBeGreaterThan(0);
  });
  const realOpts = (within(objSelect).getAllByRole("option") as HTMLOptionElement[]).filter((o) => o.value !== "");
  const objectId = realOpts[0]!.value;
  fireEvent.change(objSelect, { target: { value: objectId } });

  fireEvent.change(screen.getByTestId("wi-prop-select"), { target: { value: propKey } });
  fireEvent.change(screen.getByTestId("wi-value-input"), { target: { value } });
  return objectId;
}

describe("WO-U6 · what-if 结论即动作 → 对象数据变更 ActionDraft", () => {
  it("头号判据：点「采纳该假设」→ 草稿真发出，且 patch 就是屏上那份假设（键=选中属性·值=强制类型后的数）", async () => {
    const { captured } = captureDrafts();
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/what-if");

    const objectId = await fillHypothesis("util", "2");
    await screen.findByTestId("wi-result");

    const btn = await screen.findByTestId("wi-adopt-hypothesis");
    expect(btn).not.toBeDisabled();
    await user.click(btn);

    await waitFor(() => expect(captured.length).toBe(1));
    const draft = captured[0]!;
    expect(draft.actionTypeKey, "必须落在既有的对象写入动作类型上（R4 真值经 Action）").toBe("对象数据变更");
    expect(draft.submit, "必须直进审批链，不是存个草稿了事").toBe(true);

    const p = draft.payload!;
    expect(p.source).toBe("what-if");
    expect(p.objectType).toBe("Base");
    // ★ 对象 id 取自下拉框当前选中项 —— 写死一个 id 也能让这行绿，所以拿 DOM 里那个值来对
    expect(p.objectId).toBe(objectId);

    // ★★ 本测的核心：patch 里那一格 = 用户选的 propKey + 用户填的值，且**已过类型强制**。
    const patch = p.patch as Record<string, unknown>;
    expect(patch, "payload.patch 不存在 —— 结论没有被带进动作").toBeTruthy();
    expect(Object.keys(patch), "patch 必须恰好带用户选中的那一格，不多不少").toEqual(["util"]);
    expect(patch.util, "假设值必须以 number 落进 patch；写成字符串 '2' 会让下游派生算术全变 NaN").toBe(2);
    expect(typeof patch.util).toBe("number");

    // 量纲：patch 那一格的量纲取本体 PropertyDef.unit（Base.util = %），与屏上属性下拉里标的同源。
    expect(p.propUnit, "patch 的量纲必须随行 —— 屏上标 % 而载荷不带，审批人无从判断这个 2 是什么").toBe("%");

    // paramsSchema 必填项，且必须带着**这次的结论**（影响面计数）而不是一句通用套话。
    expect(typeof p.reason).toBe("string");
    expect(String(p.reason)).toContain("util");
    expect(String(p.reason)).toContain("2");

    // 结论快照：两项都是无量纲计数，与带量纲的 patch 分处不同字段（防 G-LEVER-SNAPSHOT-UNIT-LIE）。
    const impact = p.impact as Record<string, unknown>;
    expect(impact.affectedObjects, "= 屏上「受影响对象」那个数（求解器真算）").toBe(2);
    expect(impact.changedDerivedFields, "= 屏上「派生字段变化」那个数").toBe(2);
    const prov = p.provenance as Record<string, unknown>;
    expect(prov.solver).toBe("generic_inference");
    expect(prov.snapshotVersion, "快照版本必须随行 —— 否则无从复算这次采纳时看到的那份结论").toBe("ov-gi");
  });

  it("改了假设再采纳：payload 跟着屏上走（2 → 5），不许把上一次的旧参数采纳出去", async () => {
    const { captured } = captureDrafts();
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/what-if");

    await fillHypothesis("util", "2");
    await screen.findByTestId("wi-result");
    // 改假设值：本页无提交闸，改完即重演（判据 U1）——等结果区真的换成新一轮再采纳。
    fireEvent.change(screen.getByTestId("wi-value-input"), { target: { value: "5" } });
    await waitFor(() => expect(within(screen.getByTestId("wi-deltas")).getByText("500")).toBeInTheDocument());

    await user.click(await screen.findByTestId("wi-adopt-hypothesis"));
    await waitFor(() => expect(captured.length).toBe(1));
    const patch = captured[0]!.payload!.patch as Record<string, unknown>;
    expect(patch.util, "采纳到的是旧假设 = 用户以为改了、其实签的是上一版").toBe(5);
  });

  it("字符串属性：不做数值强制（name = '常州东'原样落 patch，不许被 Number() 变成 NaN）", async () => {
    const { captured } = captureDrafts();
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/what-if");

    await fillHypothesis("name", "常州东");
    await screen.findByTestId("wi-result");
    await user.click(await screen.findByTestId("wi-adopt-hypothesis"));

    await waitFor(() => expect(captured.length).toBe(1));
    const patch = captured[0]!.payload!.patch as Record<string, unknown>;
    expect(patch.name).toBe("常州东");
    expect(typeof patch.name).toBe("string");
  });
});
