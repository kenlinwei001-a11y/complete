import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { fetchActionDraft, fetchActionDraftAudit, fetchActionDrafts } from "@/api/endpoints";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { checkedTree, factHits } from "./factlock";

/**
 * WO-BEFE-B ① · **行动与审批**组里 R4 最要命的两条「后端注册了、前端零调用」端点
 * （门 `befe-seam:check` 载体②；断点 `G-BE-FE-SEAM-DEAD`）：
 *
 *   `GET  /a/v1/action-drafts/:id/audit`   —— R4 留痕**读端**（后端 actions.ts:822 算好了没人看）
 *   `POST /a/v1/action-drafts/:id/cancel`  —— 审批链的**放弃**分支（后端 actions.ts:753）
 *
 * ── 派单的头号推断被实测推翻，此处留证 ────────────────────────────────────────
 * 派单写：「approve/reject/cancel/submit 四个审批动作全部前端零调用 ⇒ 今天审批只能 curl」。
 * **前两个是假阳性**：前端走的是后端 `app.ts:3993` 那条**别名** `POST …/:id/decision`
 * （`endpoints.ts:897 decideActionDraft`），ActionsPage 的批准/驳回按钮一直是通的。
 * 门报「零调用」没错——它按 URL 字面量算，而前端确实一次都没写过 `/approve`、`/reject` 这两个串。
 * 真缺口只有 audit 与 cancel 两条。**接线前必须先分诊，否则会去接两条本就通的路。**
 *
 * ── 为什么**不** `vi.mock("@/api/endpoints")` ────────────────────────────────
 * 那会把病灶所在的那一跳一起 mock 掉：URL 模板、body 序列化根本不参与，断言恒绿而缺口仍在。
 * 本文件走**真 endpoints**，在 MSW 层拦**真实 URL + 真实 body**，咬的是链路不是函数。
 *
 * ── SEAM 判据：状态**真的迁走**，不是"按钮能点" ──────────────────────────────
 * 每条都从真实渲染出来的可见控件驱动，并在动作后**重新打一次真 GET** 确认后端态变了
 * （`PENDING_APPROVAL → APPROVED` / `→ CANCELLED`），而不是只断言屏上文案。
 */

/**
 * `ConfirmModal` 的确认按钮（`components/ui/Modal.tsx:107`，文案 `zh.common.confirm` = 「确认」）。
 * ⚠️ 别写死「确定」——本仓用的是「确认」，写错会以 15s 超时收场，看起来像"按钮是死的"，
 * 实则是探针找错了元素。这里按 role 取按钮而不是按文本，免得撞上正文里同样含「确认」的提示语。
 */
const confirmButton = () => screen.findByRole("button", { name: "确认" });

/** 打开 /admin/actions 并选中第一行草稿（真 route → 真列表 → 真详情）。 */
async function openFirstDraft(status = "PENDING_APPROVAL"): Promise<string> {
  renderApp("/admin/actions");
  const sel = (await screen.findByLabelText("状态筛选")) as HTMLSelectElement;
  if (sel.value !== status) fireEvent.change(sel, { target: { value: status } });
  const drafts = await fetchActionDrafts(status);
  expect(drafts.length, `状态 ${status} 一条草稿都没有 ⇒ 下面全是空胜`).toBeGreaterThan(0);
  const id = drafts[0]!.id;
  fireEvent.click(await screen.findByTestId(`draft-${id}`));
  await screen.findByTestId("draft-detail");
  return id;
}

describe("WO-BEFE-B ① R4 留痕读端 GET /a/v1/action-drafts/:id/audit", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("①-A 用户点得到：进 /admin/actions 选中草稿 → 留痕块渲染，事件逐条来自那次响应", async () => {
    const id = await openFirstDraft();

    await screen.findByTestId("audit-trail");
    const expected = await fetchActionDraftAudit(id);
    // 金丝雀：种子里这条草稿必须真有事件，否则「逐条相等」是空胜。
    expect(expected.events.length, "留痕事件为空 ⇒ 这条用例证明不了任何事").toBeGreaterThan(0);

    const box = await screen.findByTestId("audit-events");
    expect(box.getAttribute("data-count")).toBe(String(expected.events.length));
    expected.events.forEach((e, i) => {
      expect(screen.getByTestId(`audit-event-${i}`).textContent).toBe(e.event);
    });
  });

  it("①-B 真 URL：打的是 `/a/v1/action-drafts/<id>/audit`（不是 /decision，也不是列表）", async () => {
    const calls: { url: string; method: string }[] = [];
    server.use(
      http.get("*/a/v1/action-drafts/:id/audit", ({ request, params }) => {
        calls.push({ url: request.url, method: request.method });
        return HttpResponse.json({
          draft: { id: params.id },
          steps: [],
          executionResult: null,
          // 刻意与默认桩**完全不同**的一组：屏上若还显种子事件，就是没读响应。
          events: [{ event: "action.probe_one", payload: { draftId: params.id }, at: "2026-06-12T09:59:00Z", status: "SENT" }],
        });
      }),
    );

    const id = await openFirstDraft();
    await waitFor(() => expect(calls.length, "选中草稿一个 audit 请求都没发 ⇒ 入口仍是死的").toBeGreaterThan(0));
    expect(calls[0]!.method).toBe("GET");
    expect(decodeURIComponent(calls[0]!.url)).toContain(`/a/v1/action-drafts/${id}/audit`);

    // 屏上是响应里那条，不是种子那条（证明是投影响应而不是本地拼串）。
    expect((await screen.findByTestId("audit-event-0")).textContent).toBe("action.probe_one");
  });

  it("①-C 诚实空：`executionResult:null` 显「未执行」，事件空数组显「尚无事件」——不许塌成 0/空白", async () => {
    server.use(
      http.get("*/a/v1/action-drafts/:id/audit", ({ params }) =>
        HttpResponse.json({ draft: { id: params.id }, steps: [], executionResult: null, events: [] }),
      ),
    );
    await openFirstDraft();

    expect((await screen.findByTestId("audit-not-executed")).textContent).toContain("未执行");
    expect((await screen.findByTestId("audit-no-events")).textContent).toContain("尚无");
    // ★ 反证：诚实空不许渲染成"有内容"。
    expect(screen.queryByTestId("audit-events"), "空事件却渲染了事件容器 ⇒ 里面是编的行").toBeNull();
    expect(screen.queryByTestId("audit-execution"), "null 执行结果被渲染成了值").toBeNull();
  });

  /**
   * ①-D 接缝真驱动：把**整条审批链**走完，断言状态真的离开 PENDING_APPROVAL。
   *
   * ⚠️ 这里有一条实测出来的领域事实，第一版断言就栽在它上面：种子草稿 `act-001` 的
   * `approvalSteps` 是**两步**（`seq1 planner` → `seq2 admin`，见 `mocks/fixtures.ts:ACTION_DRAFTS`）。
   * 批一次只是**推进到下一步**，状态**仍然**是 PENDING_APPROVAL —— 这是对的，不是 bug
   * （后端 `actions.ts:676` 同语义：还有 next 步就 emit `action.pending_approval` 并留在原状态）。
   * 所以"批准后状态必须迁走"这句话，只有在**最后一步**批完才成立。一步就断言会误报"审批链没跑"。
   */
  it("①-D 接缝真驱动：走完整条审批链 → 状态真的离开 PENDING_APPROVAL，且留痕多出 action.approved", async () => {
    const id = await openFirstDraft();
    const before = await fetchActionDraftAudit(id);
    const beforeApproved = before.events.filter((e) => e.event === "action.approved").length;
    const steps = (await fetchActionDraft(id)).approvalSteps.length;
    expect(steps, "审批链为空 ⇒ 这条用例证明不了什么").toBeGreaterThan(0);

    // 逐步批完（每批一次详情面板会关闭 ⇒ 重新选中那一行）。
    for (let i = 0; i < steps; i++) {
      if (i > 0) {
        fireEvent.click(await screen.findByTestId(`draft-${id}`));
        await screen.findByTestId("draft-detail");
      }
      fireEvent.click(await screen.findByTestId("approve-btn"));
      fireEvent.click(await confirmButton());
      // 等这一步真的落到后端再批下一步，否则会对着同一个 pending step 连点两次。
      await waitFor(async () => {
        const d = await fetchActionDraft(id);
        expect(d.approvalSteps.filter((s) => s.decision).length, `第 ${i + 1} 步没落库`).toBe(i + 1);
      });
    }

    // ★ 后端态真的迁走了（不是屏上文案变了）。
    const done = await fetchActionDraft(id);
    expect(done.status, "整条链批完状态还留在 PENDING_APPROVAL ⇒ 审批链没真跑").not.toBe("PENDING_APPROVAL");
    // ★ 留痕跟着长（audit 读的是真事件流，不是静态清单）。
    const after = await fetchActionDraftAudit(id);
    expect(after.events.filter((e) => e.event === "action.approved").length).toBeGreaterThan(beforeApproved);
  });
});

describe("WO-BEFE-B ① 撤回 POST /a/v1/action-drafts/:id/cancel", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("①-E 用户点得到 + 状态真迁走：点「撤回」→ 确认 → 后端草稿变 CANCELLED", async () => {
    const id = await openFirstDraft();
    const before = await fetchActionDraft(id);
    expect(before.status, "起点就不是待审批 ⇒ 这条用例证明不了撤回").toBe("PENDING_APPROVAL");

    fireEvent.click(await screen.findByTestId("cancel-btn"));
    fireEvent.click(await confirmButton());

    // ★ SEAM 判据：重新打真 GET，后端状态真的是 CANCELLED。
    await waitFor(async () => {
      const d = await fetchActionDraft(id);
      expect(d.status, "点了撤回后端状态没变 ⇒ 按钮是死的").toBe("CANCELLED");
    });
  });

  it("①-F 真 URL + 真方法：POST `/a/v1/action-drafts/<id>/cancel`（不是 decision 别名）", async () => {
    const calls: { url: string; method: string }[] = [];
    server.use(
      http.post("*/a/v1/action-drafts/:id/cancel", ({ request, params }) => {
        calls.push({ url: request.url, method: request.method });
        return HttpResponse.json({ id: params.id, status: "CANCELLED", approvalSteps: [], origin: {}, payload: {} });
      }),
    );
    const id = await openFirstDraft();
    fireEvent.click(await screen.findByTestId("cancel-btn"));
    fireEvent.click(await confirmButton());

    await waitFor(() => expect(calls.length, "点了撤回一个请求都没发").toBe(1));
    expect(calls[0]!.method).toBe("POST");
    expect(decodeURIComponent(calls[0]!.url)).toContain(`/a/v1/action-drafts/${id}/cancel`);
    // ★ 撤回**不许**顺手打审批别名（那就是绕开 R4 把放弃当成了通过）。
    expect(decodeURIComponent(calls[0]!.url)).not.toContain("/decision");
  });

  it("①-G R4 红线：撤回后 CANCELLED 在筛选里查得到，且它**不是**通过态", async () => {
    const id = await openFirstDraft();
    fireEvent.click(await screen.findByTestId("cancel-btn"));
    fireEvent.click(await confirmButton());
    await waitFor(async () => expect((await fetchActionDraft(id)).status).toBe("CANCELLED"));

    // 撤回后的草稿必须在 CANCELLED 这一档查得到（否则"撤回成功"没有任何可核查落点）。
    const cancelled = await fetchActionDrafts("CANCELLED");
    expect(cancelled.map((d) => d.id)).toContain(id);
    // ★ 反证核心：撤回**没有**把它变成 APPROVED/EXECUTED —— 放弃分支绝不等于通过分支。
    const approved = await fetchActionDrafts("APPROVED");
    expect(approved.map((d) => d.id), "撤回把草稿送进了已批准 ⇒ 绕开了 R4 审批链").not.toContain(id);
    const executed = await fetchActionDrafts("EXECUTED");
    expect(executed.map((d) => d.id), "撤回触发了执行 ⇒ 真值可能被写").not.toContain(id);
  });

  it("①-H 状态闸：已 EXECUTED 的草稿不渲染撤回按钮（后端 actions.ts:753 同判据）", async () => {
    // 造一份 EXECUTED 草稿，确认按钮**不出现**（而不是出现一个点了会 409 的死按钮）。
    server.use(
      http.get("*/a/v1/action-drafts", () =>
        HttpResponse.json([
          {
            id: "act-exec-1", tenantId: "t", actionTypeKey: "probe", payload: {},
            origin: { userId: "usr-planner" }, status: "EXECUTED", approvalSteps: [],
            createdAt: "2026-06-10T08:00:00Z", updatedAt: "2026-06-10T08:00:00Z",
          },
        ]),
      ),
    );
    renderApp("/admin/actions");
    fireEvent.change(await screen.findByLabelText("状态筛选"), { target: { value: "EXECUTED" } });
    fireEvent.click(await screen.findByTestId("draft-act-exec-1"));
    await screen.findByTestId("draft-detail");
    expect(screen.queryByTestId("cancel-btn"), "EXECUTED 还给撤回按钮 ⇒ 状态闸没接").toBeNull();
  });
});

/**
 * ①-K～M · `POST /a/v1/action-drafts/:id/submit`
 *
 * **这一条是分诊翻案来的，留证于此**：初判「已有等价入口」（`createActionDraft` 默认自动提交），
 * 沿调用链再追一层后推翻（铁律 0.5）——
 *   `apps/datacore/src/decision/kernel.ts:175` 的 `decisions/:id/commit` 明确以 `submit:false` 建单 ⇒ DRAFT；
 *   而前端**真在走**这条 commit 路（`apps/frontend-shell/src/views/DecisionPlayView.tsx:630`）；
 *   后端 `actions.submit()` 的**唯一**调用方是 `app.ts:3898` 这条 HTTP 端点，它前端零调用
 *   ⇒ 决策台落下来的草稿卡在 DRAFT，**推不动、也列不出来**（`STATUSES` 里当时连 DRAFT 都没有）。
 */
describe("WO-BEFE-B ① 提交审批 POST /a/v1/action-drafts/:id/submit（分诊翻案）", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("①-K DRAFT 态草稿必须**列得出来**（缺席筛选 = 决策台落的单在界面上不存在）", async () => {
    const drafts = await fetchActionDrafts("DRAFT");
    expect(drafts.length, "没有 DRAFT 态草稿 ⇒ 这组用例证明不了什么").toBeGreaterThan(0);

    renderApp("/admin/actions");
    fireEvent.change(await screen.findByLabelText("状态筛选"), { target: { value: "DRAFT" } });
    for (const d of drafts) {
      expect(await screen.findByTestId(`draft-${d.id}`), `DRAFT 草稿 ${d.id} 在列表里找不到`).toBeInTheDocument();
    }
  });

  it("①-L 接缝真驱动：DRAFT 点「提交审批」→ 后端状态真的迁到 PENDING_APPROVAL", async () => {
    const id = (await fetchActionDrafts("DRAFT"))[0]!.id;
    renderApp("/admin/actions");
    fireEvent.change(await screen.findByLabelText("状态筛选"), { target: { value: "DRAFT" } });
    fireEvent.click(await screen.findByTestId(`draft-${id}`));
    await screen.findByTestId("draft-detail");

    fireEvent.click(await screen.findByTestId("submit-btn"));

    // ★ SEAM 判据：重打真 GET，后端真的进了审批链。
    await waitFor(async () => {
      const d = await fetchActionDraft(id);
      expect(d.status, "点了提交后端还停在 DRAFT ⇒ 草稿仍推不动").toBe("PENDING_APPROVAL");
    });
  });

  it("①-M 真 URL + 真方法：POST `…/<id>/submit`（不是 decision 别名——那会跳过提交期校验）", async () => {
    const calls: { url: string; method: string }[] = [];
    server.use(
      http.post("*/a/v1/action-drafts/:id/submit", ({ request, params }) => {
        calls.push({ url: request.url, method: request.method });
        return HttpResponse.json({ id: params.id, status: "PENDING_APPROVAL", approvalSteps: [], origin: {}, payload: {} });
      }),
    );
    const id = (await fetchActionDrafts("DRAFT"))[0]!.id;
    renderApp("/admin/actions");
    fireEvent.change(await screen.findByLabelText("状态筛选"), { target: { value: "DRAFT" } });
    fireEvent.click(await screen.findByTestId(`draft-${id}`));
    fireEvent.click(await screen.findByTestId("submit-btn"));

    await waitFor(() => expect(calls.length, "点了提交一个请求都没发").toBe(1));
    expect(calls[0]!.method).toBe("POST");
    expect(decodeURIComponent(calls[0]!.url)).toContain(`/a/v1/action-drafts/${id}/submit`);
    // ★ 提交**不许**走审批别名：那等于把"送进审批链"做成了"直接批准"，绕开 R4。
    expect(decodeURIComponent(calls[0]!.url)).not.toContain("/decision");
  });

  it("①-N 提交按钮只在 DRAFT 出现：PENDING_APPROVAL 的草稿不给提交入口（避免重复提交）", async () => {
    await openFirstDraft("PENDING_APPROVAL");
    expect(screen.queryByTestId("submit-btn"), "非 DRAFT 还给提交按钮 ⇒ 状态闸没接").toBeNull();
  });
});

describe("WO-BEFE-B ① 不是死组件 · 分诊结论可复验", () => {
  it("①-I 两条 URL 模板真在前端生产代码里；且 approve/reject 走的确实是 /decision 别名", () => {
    // 金丝雀：先抓一个已知必在的串，抓不到说明是读法坏了而不是端点没接（铁律 0.6）。
    const fe = checkedTree("apps/frontend-shell/src", "/a/v1/action-drafts", 100);
    expect(factHits(fe, "/a/v1/action-drafts"), "金丝雀未中 ⇒ 扫描坏了，下面一切结论作废").not.toEqual([]);

    expect(factHits(fe, "}/audit`"), "audit URL 模板没了 ⇒ 前端拼不出留痕请求").not.toEqual([]);
    expect(factHits(fe, "}/cancel`"), "cancel URL 模板没了").not.toEqual([]);
    expect(factHits(fe, "}/submit`"), "submit URL 模板没了 ⇒ DRAFT 草稿又推不动了").not.toEqual([]);
    // ★ 分诊结论落成可执行断言：批准/驳回**本来就通**，走的是 /decision 别名。
    //   哪天有人把它改成直连 /approve，这条会红——那是后端别名与前端的对齐点，值得钉住。
    expect(factHits(fe, "}/decision`"), "decision 别名没了 ⇒ 批准/驳回断链").not.toEqual([]);
  });

  it("①-J 留痕块真的被 ActionsPage 挂载（不是「实现有、零渲染得到」）", () => {
    const fe = checkedTree("apps/frontend-shell/src/pages/admin", "ActionsPage", 5);
    expect(factHits(fe, "<AuditTrail draftId={draft.id} />"), "AuditTrail 没被渲染 ⇒ 实现有但点不到").not.toEqual([]);
    expect(factHits(fe, "cancelActionDraft"), "cancel 没被任何组件调用").not.toEqual([]);
  });
});
