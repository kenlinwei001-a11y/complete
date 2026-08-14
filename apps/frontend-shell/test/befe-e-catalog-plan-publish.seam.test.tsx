import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createIntent, fetchPlans } from "@/api/endpoints";
import { db } from "@/mocks/db";
import { PACKAGE_ID } from "@/mocks/ids";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-BEFE-E ② · **执行计划「建得出 · 改不了 · 发不了」的接缝门**
 * （门 `befe-seam:check` 载体②；断点 `G-BE-FE-SEAM-DEAD`）：
 *
 *     `PUT  /api/v1/catalog/plans/:planId`          agentcore `server.ts:653`（requireRole catalog_admin）
 *     `POST /api/v1/catalog/plans/:planId/publish`  agentcore `server.ts:661`（同上）
 *     （前端经 `/b/v1` 别名重写打同一处 —— `deploy/nginx.conf` 与 server 的 rewriteUrl 表）
 *
 * ── 这条门要证的那件事：**这是一条真死路，不是"少个编辑器"** ──────────────────────
 * `CatalogPage` 的「＋新建执行计划」造出 `status:"DRAFT"`（agentcore `catalog/service.ts:238`）+
 * 一份写死的两步骨架。意图侧照样能保存、能发布 —— 发布前校验走
 * `resolvePlanByRef(..., {forValidation:true})`（service.ts:191），该档**允许回落到未发布的最高版本**
 * （service.ts:76-79）。而**执行期**解析走缺省档 `resolvePlanForIntent`（service.ts:82），
 * 只认 `status === "PUBLISHED"`（service.ts:74），拿不到 `return undefined`。
 * ⇒ **意图发布成功、屏上一片绿、真跑起来永远解析不到计划**。两条端点零前端调用方 = 这条链没有出口。
 *
 * ── 为什么**不** `vi.mock("@/api/endpoints")` ──────────────────────────────────
 * 那会把病灶所在的那一跳一起 mock 掉。本文件走真 endpoints，在 MSW 层拦真 URL + 真 body/method。
 *
 * ── MSW 桩与后端为何不会漂移 ──────────────────────────────────────────────────
 * 三条状态机判据照抄后端 `catalog/service.ts:243/:271/:276`，**一条都不放宽**：
 * 非 DRAFT 改/发 → 409 `INVALID_STATE`；步骤不以 `render_answer` 收尾 → 400 `PLAN_VALIDATION_ERROR`。
 * 桩放宽了，"发不出去时屏上说什么"这一支就永远测不到，而那正是用户最常撞的墙。
 */

const readRepoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * 造一个 **DRAFT** 意图并选中它（计划区的编辑动作只对 DRAFT 意图开放 —— `editable` 判据）。
 * 种子里 4 条意图全是 PUBLISHED，所以必须先建一条；建的这一步走真 API（`createIntent`），
 * 不是往 mock db 里塞，免得绕开后端形状。
 */
async function openDraftIntent(): Promise<string> {
  const key = "befe_e_probe_intent";
  await createIntent(PACKAGE_ID, {
    key, name: "WO-BEFE-E 探针意图", description: "", examples: [], slots: [],
    planId: "", riskLevel: "READ", owner: "admin", enabledViews: "*",
  });
  renderApp("/admin/catalog");
  await waitFor(() => expect(screen.getByTestId(`intent-${key}`)).toBeTruthy());
  await userEvent.click(screen.getByTestId(`intent-${key}`));
  await screen.findByTestId("intent-editor");
  return key;
}

/** 建一个 DRAFT 计划并把绑定切到它上面（走屏上的真按钮，不是往 db 里塞）。 */
async function createAndBindDraft(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  const before = new Set((await fetchPlans(PACKAGE_ID)).map((p) => p.id));
  await user.click(screen.getByTestId("plan-create"));
  await waitFor(() => expect(screen.getByTestId("plan-editor").getAttribute("data-plan-status")).toBe("DRAFT"));
  const created = (await fetchPlans(PACKAGE_ID)).find((p) => !before.has(p.id))!;
  expect(created, "「＋新建执行计划」没造出新行 ⇒ 后面全是空胜").toBeTruthy();
  return created.id;
}

describe("WO-BEFE-E ② 执行计划改 / 发（PUT …/plans/:id · POST …/plans/:id/publish）", () => {
  beforeEach(() => {
    loginAs("planner");
  });
  afterEach(() => cleanup());

  /**
   * ⚠ **本条断言在 WO-BEFE-CLEANUP 被改过一次，改的理由必须记下来**（否则后人会以为判据被放宽了）。
   *
   * 原文只有一句 `expect(warn.textContent).toContain("执行期解析不到")` ——
   * 它把「**状态**在不在第一层」和「**后果**说没说清」压成了同一句断言。
   * 分层改造（口径/后果降 `?` 浮层，规范 §2 R-UI-3）之后这一句当场报红，
   * 而它报红的原因**不是诚实位没了**，是它换了承载层。
   *
   * 判据因此拆成两半，**两半都比原来严**：
   *   · 第一层：状态词「DRAFT 未发布」必须**默认可见**（不点就得知道这条链是断的）；
   *   · 浮层：后果（执行期解析不到 / latest 只认已发布）必须**默认不在 DOM、hover 后真可见**。
   * 少任何一半都说明分层做坏了 —— 前者少 = 状态被一起降走，后者少 = 内容被删。
   */
  it("②-A 用户看得到那条死路：DRAFT 状态在第一层，后果在 `?` 浮层（默认不可见·hover 后可见）", async () => {
    const user = userEvent.setup();
    await openDraftIntent();
    await createAndBindDraft(user);

    // ── 第一层：状态词常驻可见，不需要任何交互。
    const warn = screen.getByTestId("plan-draft-warning");
    expect(warn).toBeVisible();
    expect(warn.textContent, "状态词跟着解释一起降走了 ⇒ 用户不点就不知道链断了").toContain("DRAFT 未发布");
    expect(screen.getByTestId("plan-editor-status").textContent).toBe("DRAFT");

    // ── 浮层：后果默认**不在 DOM**（不是 hidden）。
    expect(
      screen.queryByTestId("info-body-catalog-risk-draft"),
      "后果默认就摊在第一层 ⇒ 分层没做",
    ).toBeNull();

    // ── 真 hover 才出来，且原文那句后果一个字没丢（D4 守恒：降层 ≠ 删除）。
    await user.hover(screen.getByTestId("info-catalog-risk-draft"));
    const body = await screen.findByTestId("info-body-catalog-risk-draft");
    expect(body).toBeVisible();
    expect(body.textContent, "后果被删了，不是降层").toContain("执行期解析不到");
  });

  it("②-B 真 URL + 真 method/body：改步骤 → PUT …/catalog/plans/<id>，body.steps = 编辑框里那份", async () => {
    const user = userEvent.setup();
    const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
    await openDraftIntent();
    const planId = await createAndBindDraft(user);

    server.use(
      http.put("*/b/v1/catalog/plans/:planId", async ({ request }) => {
        calls.push({ url: request.url, method: request.method, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({ id: planId, packageId: PACKAGE_ID, key: "probe_key", version: 1, status: "DRAFT", steps: [] });
      }),
    );

    const editor = screen.getByTestId("plan-steps-editor") as HTMLTextAreaElement;
    // ⚠ 用 `fireEvent.change` 而不是 `user.type`：userEvent 把 `{` 当**按键描述符**解析
    //   （`{Enter}` 那一套），JSON 里的花括号会直接抛 "Expected key descriptor"。
    //   这里要输入的是一整段 JSON 文本，粘贴语义正是 change。
    // 刻意一份**与骨架完全不同**的步骤：body 里若还是骨架，说明发的是写死的默认值。
    fireEvent.change(editor, { target: { value: '[{"id":"probe","type":"render_answer","params":{"blocks":[]}}]' } });
    await user.click(screen.getByTestId("plan-save"));

    await waitFor(() => expect(calls.length, "点了保存一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url, `打错端点：${calls[0]!.url}`).toContain(`/catalog/plans/${planId}`);
    expect(calls[0]!.body).toEqual({ steps: [{ id: "probe", type: "render_answer", params: { blocks: [] } }] });
  });

  it("②-C 效果层（本门的要害）：发布 → 计划真的从 DRAFT 变 PUBLISHED，影响面来自响应", async () => {
    const user = userEvent.setup();
    await openDraftIntent();
    const planId = await createAndBindDraft(user);

    // 骨架已以 render_answer 收尾（CatalogPage `createPlanMut` 的模板），故这一发应当成功。
    await user.click(screen.getByTestId("plan-publish"));

    // ★ 后端侧真变了（读的是真 `GET …/plans`，不是读组件 state）。
    await waitFor(async () => {
      const truth = (await fetchPlans(PACKAGE_ID)).find((p) => p.id === planId)!;
      expect(truth.status, "发布后后端仍是 DRAFT ⇒ 只改了屏，没改库").toBe("PUBLISHED");
    });
    // ★ 屏上跟着变：DRAFT 警示消失、状态徽章翻绿、编辑按钮收起（PUBLISHED 不可改，后端 409）。
    await waitFor(() => expect(screen.getByTestId("plan-editor-status").textContent).toBe("PUBLISHED"));
    expect(screen.queryByTestId("plan-draft-warning"), "已发布还挂着「执行期解析不到」⇒ 诚实位说谎了").toBeNull();
    expect(screen.queryByTestId("plan-publish"), "PUBLISHED 还留着发布按钮 ⇒ 点了必 409").toBeNull();
    // ★ 影响面是**响应里**那个数（引用它的意图数），不是前端数出来的。
    const impact = screen.getByTestId("plan-publish-impact");
    expect(within(impact).getByTestId("plan-impact-intents").textContent).toBe(
      String(db.intents.filter((i) => i.status !== "RETIRED" && i.planId === planId).length),
    );
  });

  it("②-D 后端校验失败不许吞：步骤不以 render_answer 收尾 → 400 原文亮在屏上，状态仍是 DRAFT", async () => {
    const user = userEvent.setup();
    await openDraftIntent();
    const planId = await createAndBindDraft(user);

    const editor = screen.getByTestId("plan-steps-editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '[{"id":"s1","type":"query_objects","params":{"objectType":"Order","filter":{}}}]' } });
    await user.click(screen.getByTestId("plan-save"));
    await waitFor(async () => {
      const truth = (await fetchPlans(PACKAGE_ID)).find((p) => p.id === planId)!;
      expect(truth.steps.length, "保存没落到后端 ⇒ 下面的发布失败测的不是这份步骤").toBe(1);
    });

    await user.click(screen.getByTestId("plan-publish"));
    const box = await screen.findByTestId("plan-publish-error");
    // 后端原文（`render_answer` 收尾）必须照显，不许换成一句"发布失败"。
    expect(box.textContent).toContain("render_answer");
    // ★ 失败后状态不许被前端乐观翻绿。
    const truth = (await fetchPlans(PACKAGE_ID)).find((p) => p.id === planId)!;
    expect(truth.status).toBe("DRAFT");
    expect(screen.getByTestId("plan-editor-status").textContent).toBe("DRAFT");
  });

  it("②-E JSON 写坏了当场说、且不发请求（把 400 换成一句本地原文错误）", async () => {
    const user = userEvent.setup();
    let putHits = 0;
    await openDraftIntent();
    await createAndBindDraft(user);
    server.use(
      http.put("*/b/v1/catalog/plans/:planId", () => {
        putHits += 1;
        return HttpResponse.json({});
      }),
    );

    const editor = screen.getByTestId("plan-steps-editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "not json at all" } });
    await user.click(screen.getByTestId("plan-save"));

    expect((await screen.findByTestId("plan-steps-error")).textContent).toContain("解析失败");
    expect(putHits, "JSON 都没解析成功还发了请求 ⇒ 把本地错误推给了后端").toBe(0);
  });

  it("②-F 不是死组件：`PlanEditor` 真的挂在 CatalogPage，两条 URL 真在 endpoints.ts 里", () => {
    const page = readRepoFile("../src/pages/admin/CatalogPage.tsx");
    expect(page.length, "CatalogPage.tsx 读到了空内容——路径漂了，先修路径再看结论").toBeGreaterThan(1000);
    expect(page).toContain("<PlanEditor plan=");
    expect(page).toContain("publishPlan");
    expect(page).toContain("updatePlan");

    const eps = readRepoFile("../src/api/endpoints.ts");
    // 金丝雀：先抓一个**已知必在**的同族 URL；抓不到说明读法坏了，而不是端点没接。
    expect(eps, "金丝雀未中 ⇒ 读法坏了，下面的「不存在」全部不可信").toContain("/b/v1/catalog/packages/${packageId}/plans");
    expect(eps).toContain("/b/v1/catalog/plans/${encodeURIComponent(planId)}`");
    expect(eps).toContain("/b/v1/catalog/plans/${encodeURIComponent(planId)}/publish`");
  });
});
