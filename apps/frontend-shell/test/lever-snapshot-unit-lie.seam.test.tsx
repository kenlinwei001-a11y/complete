import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * `G-LEVER-SNAPSHOT-UNIT-LIE` 收口 · **前端半的接缝测试**（渲染真组件 · 咬真出线 payload）。
 *
 * ══ 为什么这条不能只在 datacore 那边测 ═══════════════════════════════════════
 * 姊妹测 `apps/datacore/test/lever-snapshot-unit.seam.test.ts` 咬的是「量纲断言函数」
 * 与「后端审批面」；但**假绿第 9 形态**（`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）的教训是
 * ——**测试咬的是函数不是链路**：断言函数再绿，也证明不了 `RiskBoardView` 那一行
 * 真的改成了 `tightnessPeak`。生产调用点没被咬到，改回 `capWanP50: card.peak`
 * 照样全绿。故本测**渲染真页面、点真按钮、捕获真的出线 payload**。
 *
 * ══ 三组判据 ═══════════════════════════════════════════════════════════════
 *   ① 产能页采纳 → 出线 payload 的 snapshot 是 `risk_tightness`，
 *      带 `tightnessPeak`，且**没有** `capWanP50/capWanP90`（不许编数）；
 *   ② 出线 payload 带齐 `plan_change` 的必填位 `versionId`/`reason`
 *      —— 缺了真后端 400（datacore 侧那条判据③钉的就是这个），
 *      而 MSW 桩不校验 ⇒ 只在这一层是看不出来的，所以这条判据必须写在**出线内容**上；
 *   ③ **源文本判据**（治「改回去还绿」）：两个调用点的 `snapshot=` 字面量必须带 `kind`，
 *      且产能页那处**不许**出现 `capWanP50: card.peak` 这个原病灶形态。
 */

async function openChangzhou(): Promise<void> {
  loginAs("planner");
  renderApp("/v/risk");
  const card = await screen.findByTestId("risk-card-常州");
  fireEvent.click(card);
  await screen.findByTestId("risk-detail-常州");
}

/** 捕获采纳时**真正发出去**的 ActionDraft 请求体。 */
function captureAdopt(): { get: () => { actionTypeKey?: string; payload?: Record<string, unknown>; submit?: boolean } | null } {
  let captured: { actionTypeKey?: string; payload?: Record<string, unknown>; submit?: boolean } | null = null;
  server.use(
    http.post("*/a/v1/action-drafts", async ({ request }) => {
      captured = (await request.json()) as { actionTypeKey?: string; payload?: Record<string, unknown>; submit?: boolean };
      return HttpResponse.json({ draftId: "act-snapshot-unit", status: "PENDING_APPROVAL" }, { status: 201 });
    }),
  );
  return { get: () => captured };
}

const SRC = (rel: string): string => readFileSync(resolve(__dirname, "..", "src", rel), "utf8");

describe("G-LEVER-SNAPSHOT-UNIT-LIE · 产能页采纳写进审批留痕的那份快照", () => {
  it("判据①② 点采纳 → 出线 payload 记的是张力峰值（不是假产能数），且带齐 plan_change 必填位", async () => {
    const cap = captureAdopt();
    const user = userEvent.setup();
    await openChangzhou();

    // 拨一个真杠杆（杠杆集来自 discoverLevers 真对象），再点面板自己的「采纳」。
    const slider = await screen.findByTestId("lever-slider-oee_current");
    fireEvent.change(slider, { target: { value: "0.95" } });
    await user.click(await screen.findByTestId("lever-adopt"));
    await waitFor(() => expect(cap.get()).not.toBeNull());

    const body = cap.get()!;
    expect(body.actionTypeKey).toBe("plan_change");
    expect(body.submit).toBe(true);

    const payload = body.payload as Record<string, unknown>;
    const snapshot = payload.snapshot as Record<string, unknown>;

    // 判据① —— 留痕里记的是**张力**，用它自己的名字。
    expect(snapshot.kind).toBe("risk_tightness");
    expect(typeof snapshot.tightnessPeak).toBe("number");
    // 张力是 0–100 指数：值域自证（这也是当初判定「它不可能是万套/窗口」的那条算术判据）。
    expect(snapshot.tightnessPeak as number).toBeGreaterThanOrEqual(0);
    expect(snapshot.tightnessPeak as number).toBeLessThanOrEqual(100);
    // **不许编数**：本屏拿不到真产能 ⇒ 留痕里就不许出现产能字段。
    expect(snapshot, "留痕里冒出了 capWanP50 —— 这正是本断点的原样").not.toHaveProperty("capWanP50");
    expect(snapshot, "留痕里冒出了 capWanP90 —— 这正是本断点的原样").not.toHaveProperty("capWanP90");

    // 判据② —— `plan_change` 的后端必填位（少了真后端 400，草稿卡在 DRAFT 进不了审批链）。
    expect(payload.versionId, "缺 versionId ⇒ 真后端 400（MSW 桩不校验，所以只能在出线内容上断言）").toBeTruthy();
    expect(payload.reason, "缺 reason ⇒ 真后端 400").toBeTruthy();
  });

  it("判据③ 源文本：两个调用点都带 kind，且产能页不许再出现 `capWanP50: card.peak`", () => {
    const risk = SRC("views/RiskBoardView.tsx");
    const proj = SRC("views/sim/ProjectSimView.tsx");

    // 金丝雀：先自证读到的是**真文件**（读空/读错文件时下面的否定断言会假绿）。
    expect(risk, "没读到 RiskBoardView 源码 —— 下面的否定断言不可信").toContain("DynamicLeverPanel");
    expect(proj, "没读到 ProjectSimView 源码 —— 下面的否定断言不可信").toContain("DynamicLeverPanel");

    // 剥注释再判：本文件与源码注释里都会引用病灶原文，不剥就会自己命中自己。
    const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const riskCode = strip(risk);
    const projCode = strip(proj);

    // 病灶原样：`capWanP50: card.peak` —— 改回去这一条当场红。
    expect(riskCode, "产能页又把张力塞进 capWanP50 了（G-LEVER-SNAPSHOT-UNIT-LIE 复发）").not.toMatch(/capWanP(50|90)\s*:\s*card\.peak/);
    // 两个调用点的 snapshot 都必须走判别式联合（没有 kind = 回到扁平形状 = 病回来了）。
    expect(riskCode).toMatch(/snapshot=\{\{\s*kind:\s*"risk_tightness"/);
    expect(projCode).toMatch(/snapshot=\{\{\s*kind:\s*"capacity_forecast"/);
    // 面板写 payload 前必须过运行时量纲断言（删掉它 = 拆掉本次收口的机器判据）。
    expect(strip(SRC("views/sim/DynamicLeverPanel.tsx"))).toContain("assertLeverAdoptSnapshot(");
  });
});
