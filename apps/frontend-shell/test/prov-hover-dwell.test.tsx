import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "@/App";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import { ANSWER_A2 } from "@/mocks/fixtures";
import { db, type MockTask } from "@/mocks/db";
import { PROV_MARK_HOVER_DELAY_MS } from "@/components/Provenance/ProvTrigger";
import { computePopoverPlacement, POPOVER_EST_HEIGHT } from "@/components/Provenance/ProvenancePopover";
import type { Answer } from "@platform/contracts";

/**
 * POLISH-P3-BUNDLE ① 真栈复验根因齿：叙事 ⟦ref⟧ sup 角标在真后端栈（真答案·prov_ULID 标记）hover 不出浮层。
 * 真因（真栈实证·非 reviewer 猜测的"双渲染源"）：真答案 narrative sup 与结构块 sup **本就同一渲染源**
 * （皆 ProvMark，都挂 onMouseEnter）；断点在**浮层落位**——角标处于视口下部时旧 `top=min(bottom+8, innerH-320)`
 * 上钳致浮层盖住触发角标 → 悬停态非钉住浮层触发 mouseleave→cancel→关，与 re-enter 形成 ~160ms 抖动，
 * 150ms 驻留定时器永等不到。KPI/表头角标位置靠上、浮层落其下不遮，故独叙事小角标失效。
 * 修：computePopoverPlacement 下方放不下即上翻（bottom 锚定），浮层绝不遮触发点。
 */
const REAL_PROV = "prov_01KWS3TCM5NQVQJEWCASMYXTK9"; // prov_<ULID> 真答案形状（≠ mock 的 prov-a2-x 连字号）

// 真 affected_orders 答案形状：table 块 + 叙事 text 块（⟦ref:prov_ULID⟧ 指同一 provId），逐字对齐真栈投影。
const ANSWER_REAL_SHAPE: Answer = {
  trustLevel: "VERIFIED_WORKFLOW",
  unverifiedNumerics: false,
  blocks: [
    { type: "table", columns: ["订单", "数量"], rows: [["SO-1", 60]], provId: REAL_PROV },
    { type: "text", markdown: `受影响订单共 6 张，明细见上表 ⟦ref:${REAL_PROV}⟧。` },
  ],
  provenance: [
    {
      id: REAL_PROV,
      source: "TOOL_RESULT",
      toolCallId: "tc-real-1",
      toolName: "invoke_solver:affected_orders",
      outputPath: "$.data.rows",
      snapshotVersion: "1.2",
    } as Answer["provenance"][number],
  ],
};

/**
 * PROV-HOVER-DWELL 齿检（治理批次小注①）：叙事 ⟦ref⟧ sup 角标是小靶，旧 300ms 驻留 + 无热区扩大
 * → hover 难命中（需驻留/点按才出浮层）。治：驻留缩短至 150ms（PROV_MARK_HOVER_DELAY_MS）+
 * .mark::after 热区外扩（CSS·真浏览器证）。齿钉：
 *   ① hover 角标 → 400ms 内浮层出现（WO 验收口径原文）；
 *   ② 驻留常量 = 150ms（< 旧 300ms·复原即红）；
 *   ③ hover 移开（未钉住）→ 浮层关闭；click 钉住仍在（设计内交互不回归）。
 */

function seedTask(taskId: string, answer: Answer): void {
  db.tasks.set(taskId, {
    id: taskId,
    query: "q",
    context: {},
    plan: { segments: [], path: "WORKFLOW", finalAnswer: answer },
    status: "COMPLETED",
    clarificationRounds: 0,
    createdAt: "",
  } as MockTask);
}

function renderAnswer(taskId: string, answer: Answer) {
  seedTask(taskId, answer);
  return render(
    <AppProviders>
      <MemoryRouter>
        <AnswerCard answer={answer} taskId={taskId} />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("PROV-HOVER-DWELL · 叙事 sup 角标 hover 驻留（150ms·400ms 内出浮层）", () => {
  afterEach(() => cleanup());

  it("hover 角标 400ms 内浮层出现（未点击·非钉住态无关闭按钮）", async () => {
    const user = userEvent.setup();
    renderAnswer("task-hover-dwell", ANSWER_A2);
    await user.hover(screen.getByTestId("prov-mark-prov-a2-3"));
    // WO 验收口径：hover 400ms → popover shown（驻留 150ms + 渲染余量 < 400ms 上界）。
    await waitFor(() => expect(screen.getByTestId("prov-popover")).toBeInTheDocument(), { timeout: 400 });
    // hover 态非钉住：无 ✕ 关闭按钮（钉住才有）。
    expect(screen.queryByLabelText("关闭")).toBeNull();
  });

  it("驻留常量缩短为 150ms（复原 300ms 即红）", () => {
    expect(PROV_MARK_HOVER_DELAY_MS).toBe(150);
    expect(PROV_MARK_HOVER_DELAY_MS).toBeLessThan(300);
  });

  it("hover 移开（未钉住）→ 浮层关闭；click 钉住 → 出关闭按钮（设计内交互不回归）", async () => {
    const user = userEvent.setup();
    renderAnswer("task-hover-dwell-2", ANSWER_A2);
    const mark = screen.getByTestId("prov-mark-prov-a2-3");
    await user.hover(mark);
    await waitFor(() => expect(screen.getByTestId("prov-popover")).toBeInTheDocument(), { timeout: 400 });
    await user.unhover(mark);
    await waitFor(() => expect(screen.queryByTestId("prov-popover")).toBeNull());
    // click 钉住不变（小注明确"click 钉住为设计内"）。
    await user.click(mark);
    const pop = await screen.findByTestId("prov-popover");
    expect(pop).toBeInTheDocument();
    expect(screen.getByLabelText("关闭")).toBeInTheDocument();
  });
});

describe("POLISH-P3-BUNDLE ① · 真答案形状（prov_ULID）经渲染路径 → 叙事 sup 单一渲染源挂 ProvTrigger hover", () => {
  afterEach(() => cleanup());

  it("真答案 text 块 ⟦ref:prov_ULID⟧ 与 table 块同源渲染为 ProvMark（同 provId 两处角标皆挂 hover）", async () => {
    const user = userEvent.setup();
    renderAnswer("task-real-shape", ANSWER_REAL_SHAPE);
    // 单一渲染源：table 表头角标 + 叙事文本角标，皆 ProvMark、同 provId、同 testid。
    const marks = screen.getAllByTestId(`prov-mark-${REAL_PROV}`);
    expect(marks.length).toBe(2);
    // 叙事角标（在 <p> 段落里，非表头）——真栈失效者。它必须真挂 ProvTrigger 的 hover。
    const narrative = marks.find((m) => m.closest("p") !== null);
    expect(narrative).toBeTruthy();
    expect(narrative!.tagName).toBe("SUP");
    expect(narrative!.getAttribute("role")).toBe("button"); // 是 ProvMark，不是裸 <sup>
    await user.hover(narrative!);
    // 真答案形状的叙事 sup hover → 浮层出现（若把 text 路径的 ⟦ref⟧ 退回裸文本/不挂 ProvTrigger 即红）。
    await waitFor(() => expect(screen.getByTestId("prov-popover")).toBeInTheDocument(), { timeout: 400 });
    // 浮层头部展示真 provId（== 后端 provenance[0].id == 角标 provId）。
    expect(screen.getByTestId("prov-popover").textContent).toContain(REAL_PROV);
  });
});

describe("POLISH-P3-BUNDLE ① · computePopoverPlacement 根因守卫（浮层绝不遮触发角标 → 悬停不抖）", () => {
  const VP = { w: 1280, h: 900 };

  it("角标处于视口下部（下方放不下）→ 上翻（above·bottom 锚定），浮层落触发点上方、不遮盖", () => {
    // 叙事小角标真栈坐标：y≈705（>innerH-320=580 的旧 bug 区）。
    const rect = { top: 700, bottom: 711, left: 782 };
    const p = computePopoverPlacement(rect, VP);
    expect(p.placement).toBe("above");
    expect(p.style.top).toBeUndefined();
    expect(p.style.bottom).toBe(VP.h - rect.top + 8); // bottom 锚定到触发点上沿
    // 上翻后浮层下沿 = innerH - bottom = rect.top - 8 < rect.top → 绝不与触发角标交叠。
    const popoverBottomY = VP.h - (p.style.bottom as number);
    expect(popoverBottomY).toBeLessThan(rect.top);
  });

  it("角标靠上（下方放得下）→ 下方（below·top=bottom+8），维持既有行为（KPI/表头角标不回归）", () => {
    const rect = { top: 460, bottom: 471, left: 1220 };
    const p = computePopoverPlacement(rect, VP);
    expect(p.placement).toBe("below");
    expect(p.style.top).toBe(rect.bottom + 8);
    expect(p.style.bottom).toBeUndefined();
  });

  it("旧实现回归即红：下部角标若仍按 below+上钳（top=min(bottom+8,innerH-EST)）会盖住角标——本函数必判 above", () => {
    const rect = { top: 705, bottom: 716, left: 782 };
    const oldTop = Math.min(rect.bottom + 8, VP.h - POPOVER_EST_HEIGHT); // 旧公式：580，落在 rect(705) 之上→遮盖
    expect(oldTop).toBeLessThan(rect.top); // 证实旧公式确实会遮盖触发角标
    expect(computePopoverPlacement(rect, VP).placement).toBe("above"); // 新实现规避
  });
});
