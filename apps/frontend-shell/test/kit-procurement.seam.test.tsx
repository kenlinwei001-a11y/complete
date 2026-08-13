import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "@/App";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import {
  buildKitOrderVMs,
  isKitReadinessTable,
  LEG_LABEL,
} from "@/components/Answer/kitProcurement";
import { PROCUREMENT_LEGS, PROCUREMENT_LEG_STATUSES, type Answer } from "@platform/contracts";
import { db, type MockTask } from "@/mocks/db";
import realBlock from "./kit-readiness.real-block.json";

/**
 * SEAM 门 · 真载荷驱动（WO-S08-KIT-PROCUREMENT-FE）
 *
 * `kit-readiness.real-block.json` **不是手写的**，是 2026-08-07 从真链路原样抓下来的答案块：
 *   内存态 datacore（SEED_DEMO=1 · seed 42）
 *     → `POST /a/v1/solvers/kit_readiness/invoke {"args":{"fromDay":1,"toDay":14}}`（真求解）
 *     → agentcore `dist/workflow/executor.js` 的 `summarizeSolverOutput()`（真投影，未改一字）
 *     → 取其中的 table 块（前 2 行）
 *
 * 它咬的是**接缝**而不是我这半：引擎改了输出字段、或 agentcore 改了投影规则
 * （列名取法 / `cellOf` 的对象数组分支），这道门当场红 —— 而不是等到用户在答案里
 * 又看见一坨 JSON 才发现。
 *
 * ⚠ 这份载荷同时是「今天真数据长什么样」的实证：seed 42 下**四段全部实测**，
 *   一个 `EMPTY` 段都没有（合成数据把四段的真源都填齐了）。所以 EMPTY 的表现由
 *   `kit-procurement-answer.test.tsx` 的构造载荷覆盖，这里只如实断言"真数据里没有"。
 */

const COLUMNS = realBlock.columns as string[];
const ROWS = realBlock.rows as (string | number | null)[][];

function realAnswer(): Answer {
  return {
    trustLevel: "VERIFIED_WORKFLOW",
    unverifiedNumerics: false,
    blocks: [{ type: "table", columns: COLUMNS, rows: ROWS, provId: "prov-real" }],
    provenance: [
      { id: "prov-real", source: "TOOL_RESULT", toolCallId: "tc-real", toolName: "invoke_solver:kit_readiness", outputPath: "$.rows" },
    ],
  };
}

function renderReal(taskId: string) {
  const answer = realAnswer();
  db.tasks.set(taskId, {
    id: taskId,
    query: "下周哪些订单缺料开不了工？",
    context: {},
    plan: { segments: [], path: "WORKFLOW", finalAnswer: answer },
    status: "COMPLETED",
    clarificationRounds: 0,
    createdAt: "",
  } as MockTask);
  return render(
    <AppProviders>
      <MemoryRouter>
        <AnswerCard answer={answer} taskId={taskId} />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("SEAM · 真 kit_readiness 答案块 → 采购四段渲染", () => {
  it("① 真载荷的列名签名认得出（agentcore 改了列名取法这里就红）", () => {
    expect(isKitReadinessTable(COLUMNS)).toBe(true);
    // 实测：列名 = Object.keys(rows[0])，首行可结算 ⇒ 没有 earliestKitDayReason 这一列
    expect(COLUMNS).toEqual(["orderId", "kitRatio", "shortItems", "advice", "earliestKitDay", "earliestKitDayStatus"]);
  });

  it("② 真载荷里那坨转义 JSON 拆得回来，且每项四段齐全、状态都是契约里的合法态", () => {
    const orders = buildKitOrderVMs(COLUMNS, ROWS);
    expect(orders).not.toBeNull();
    expect(orders!.length).toBe(ROWS.length);
    let itemCount = 0;
    for (const o of orders!) {
      for (const it of o.items) {
        itemCount++;
        expect(it.legs.map((l) => l.leg)).toEqual([...PROCUREMENT_LEGS]);
        for (const l of it.legs) expect(PROCUREMENT_LEG_STATUSES).toContain(l.status);
      }
    }
    // 真数据里确实有缺料项（不是"解析成功但一项没有"这种假绿）
    expect(itemCount).toBeGreaterThan(0);
  });

  it("③ 真载荷渲染到屏上：四段段名 + 责任方 + 关键段横幅都在", () => {
    renderReal("task-seam-1");
    const panel = screen.getByTestId("kit-procurement");
    for (const leg of PROCUREMENT_LEGS) expect(panel.textContent).toContain(LEG_LABEL[leg]);
    // 至少一个关键段横幅（真数据四段全实测 ⇒ 必有）
    expect(panel.querySelectorAll('[data-testid^="kit-critical-"]').length).toBeGreaterThan(0);
    // 「该找谁」榜非空
    expect(within(screen.getByTestId("kit-who-to-call")).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("④ 真载荷下表格不再是一坨 JSON（本单要治的那个病的直接判据）", () => {
    renderReal("task-seam-2");
    const table = screen.getByTestId("answer-table");
    // ⚠ 别拿 "MEASURED" 当判据：它是 `earliestKitDayStatus` 这一列的**合法取值**，本来就该显。
    //   （首版这么写过，被这条门自己抓了出来。）
    for (const token of ['"leg"', '"ownerRef"', "supplier_production", '"status"']) {
      expect(table.textContent).not.toContain(token);
    }
    expect(table.textContent).toContain("缺 ");
  });

  it("⑤ 如实记账：seed 42 的真数据里四段全实测，没有一个 EMPTY 段", () => {
    const orders = buildKitOrderVMs(COLUMNS, ROWS)!;
    const statuses = orders.flatMap((o) => o.items.flatMap((i) => i.legs.map((l) => l.status)));
    expect(statuses).toContain("MEASURED");
    expect(statuses).not.toContain("EMPTY");
    // 也如实记：真数据里**有** NOT_APPLICABLE（境内直供无清关环节）
    expect(statuses).toContain("NOT_APPLICABLE");
  });

  it("⑥ 引擎自报的汇总与契约唯一实现在真载荷上完全对得上（口径同源的实证）", () => {
    const orders = buildKitOrderVMs(COLUMNS, ROWS)!;
    for (const o of orders) {
      for (const it of o.items) {
        expect(it.criticalAgreement).toBe("AGREE");
        expect(it.ownerAgreement).toBe("AGREE");
        expect(it.totalAgreement).toBe("AGREE");
      }
    }
  });
});
